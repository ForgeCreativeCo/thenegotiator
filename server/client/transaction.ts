// The user's own client after acceptance: signing waivers, notices, releases and amendments, hearing the other
// side's requests, and the client's own surprises (cold feet, a partner, second thoughts, a later date).

import type { Scenario } from "../engine/types";
import { displayDate, money } from "../narrative/format";
import { ActionError, pushMessage, userSide } from "../negotiation/engine";
import type { Negotiation } from "../negotiation/types";
import { isDateIssue, isMoneyIssue, userClientObjections } from "../transaction/policy";
import type { Issue, Proposal, Transaction } from "../transaction/types";
import type { TxAction } from "../transaction/engine";
import { clientFacts } from "./facts";
import { clientOf, pushClient, topicsIn, uncover } from "./engine";
import { chatDraft, clientCtx, clientVoice } from "./voice";
import { clientTxLines } from "../dialogue/client";
import type { OwnClientEvent } from "./types";

const SIGNED_ACTIONS = ["condition", "release", "request_condition_extension", "request_date_change", "propose", "accept"] as const;
const AMENDMENTS = ["request_condition_extension", "request_date_change", "propose", "accept"];

export function needsTxSignature(action: TxAction): boolean {
  return (SIGNED_ACTIONS as readonly string[]).includes(action.type);
}

function issueOf(tx: Transaction, id: string): Issue {
  const issue = tx.issues.find((i) => i.id === id && i.status === "open");
  if (!issue) throw new ActionError("That issue isn't open.");
  return issue;
}

function lastProposal(issue: Issue): Proposal | null {
  return issue.proposals[issue.proposals.length - 1] ?? null;
}

/** What a signing action puts in front of the other side, and a key that identifies it exactly. */
function txDocument(tx: Transaction, action: TxAction): { label: string; key: string } {
  const key = JSON.stringify(action, (k, v) => (k === "text" ? undefined : v));
  switch (action.type) {
    case "condition": {
      const c = tx.conditions.find((x) => x.key === action.key);
      return { label: `${action.how === "waive" ? "waiver (Form 123)" : "notice of fulfilment (Form 124)"} on the ${c?.label.toLowerCase() ?? action.key} condition`, key };
    }
    case "release":
      return { label: "mutual release", key };
    case "request_condition_extension":
      return { label: "amendment extending the condition", key };
    case "request_date_change":
      return { label: `amendment moving completion to ${displayDate(action.closingDate)}`, key };
    case "propose":
      return { label: `proposal on ${issueOf(tx, action.issueId).title.toLowerCase()}`, key };
    case "accept":
      return { label: `amendment on ${issueOf(tx, action.issueId).title.toLowerCase()}`, key };
    default:
      throw new ActionError("That doesn't need your client's signature.");
  }
}

/** Called by the transaction engine before a signed document goes out. Uses up the signature. */
export function requireTxSignature(s: Scenario, n: Negotiation, action: TxAction): void {
  const c = n.client;
  if (!c?.reviewRequired || !needsTxSignature(action) || !n.transaction) return;
  const doc = txDocument(n.transaction, action);
  if (c.signature?.key !== doc.key) throw new ActionError(`Your ${userSide(s) === "buyer" ? "buyers haven't" : "sellers haven't"} signed this ${doc.label}. Review it with them first.`);
  c.signature = null;
}

// ---------- Surprises ----------

function ownEvents(s: Scenario): OwnClientEvent[] {
  return s.ownClientEvents ?? [];
}

function eventState(n: Negotiation, id: string) {
  return clientOf(n).events?.find((e) => e.id === id) ?? null;
}

/** Starts a surprise: the client says it, and the agent's transcript notes that the client got in touch. */
async function startEvent(s: Scenario, n: Negotiation, e: OwnClientEvent): Promise<void> {
  const c = clientOf(n);
  (c.events ??= []).push({ id: e.id, status: "active", at: n.simHours });
  const { text } = await clientVoice(s, n, "[You reach out to your agent unprompted]", e.says);
  pushClient(n, { speaker: "client", text, kind: "chat" });
  pushMessage(n, { speaker: "system", text: `Your ${userSide(s) === "buyer" ? "buyers" : "sellers"} sent you a message. Open the conversation with them to answer.`, event: "client_update" });
}

/** Unprompted surprises, checked after each step of the transaction. */
export async function txClientTriggers(s: Scenario, n: Negotiation): Promise<void> {
  const tx = n.transaction;
  if (!n.client?.reviewRequired || !tx || tx.status !== "active") return;
  for (const e of ownEvents(s)) {
    if (eventState(n, e.id)) continue;
    if (e.kind === "later_date" && tx.day >= 1) await startEvent(s, n, e);
    if (e.kind === "remorse" && tx.firm && tx.firmDay !== null && tx.day > tx.firmDay) await startEvent(s, n, e);
  }
}

// ---------- The client's decision ----------

interface TxReview {
  verdict: "signed" | "reluctant" | "refused";
  reasons: string[];
  /** What the client says, before Claude's rewrite. */
  draft: string;
}

function hasReasonToEnd(s: Scenario, tx: Transaction): boolean {
  const serious = tx.revealedFindingIds.some((id) => [...s.groundTruth.inspectionFindings, ...s.groundTruth.typeSpecificIssues].some((f) => f.id === id && (f.severity === "major" || f.severity === "safety")));
  return serious || tx.issues.some((i) => i.status === "open") || tx.loanStatus === "declined" || (tx.appraisedValue !== null && tx.appraisedValue < tx.terms.price);
}

function unresolvedSeriousFindings(s: Scenario, tx: Transaction): boolean {
  const all = [...s.groundTruth.inspectionFindings, ...s.groundTruth.typeSpecificIssues];
  const serious = tx.revealedFindingIds.filter((id) => all.some((f) => f.id === id && (f.severity === "major" || f.severity === "safety")));
  const settled = tx.issues.some((i) => i.kind === "repairs" && i.status === "agreed");
  return serious.length > 0 && !settled;
}

async function decide(s: Scenario, n: Negotiation, tx: Transaction, action: TxAction): Promise<TxReview> {
  const me = userSide(s);
  const cc = clientCtx(s, n);
  const goingFirm = action.type === "condition" && tx.conditions.filter((c) => c.status === "pending").length === 1;

  // A surprise that blocks this signature starts now, or is still waiting for the agent to talk it through.
  for (const e of ownEvents(s).filter((x) => x.blocking)) {
    const applies = (e.kind === "cold_feet" && goingFirm) || (e.kind === "partner" && AMENDMENTS.includes(action.type));
    const state = eventState(n, e.id);
    if (!applies || state?.status === "settled") continue;
    if (!state) (clientOf(n).events ??= []).push({ id: e.id, status: "active", at: n.simHours });
    return { verdict: "refused", reasons: ["Your client wants to talk it through before signing. Answer them in your conversation with them."], draft: e.says };
  }

  if (action.type === "release") {
    const remorse = eventState(n, "remorse");
    if (!hasReasonToEnd(s, tx) && !remorse) return { verdict: "refused", reasons: ["Your client doesn't want to end the deal."], draft: clientTxLines.releaseRefuse(cc, me === "buyer" ? "house" : "sale") };
    return { verdict: "signed", reasons: [], draft: clientTxLines.releaseSign(cc) };
  }

  if (action.type === "condition") {
    if (action.how === "fulfil") return { verdict: "signed", reasons: [], draft: goingFirm ? clientTxLines.firm(cc) : clientTxLines.fulfil(cc) };
    if (action.key === "financing" && tx.loanStatus !== "approved") {
      return { verdict: "reluctant", reasons: [], draft: clientTxLines.financingReluctant(cc) };
    }
    if (action.key === "inspection" && unresolvedSeriousFindings(s, tx)) {
      const nervous = clientFacts(s).find((f) => f.id === "context-inspection");
      if (nervous) {
        const isNew = uncover(n, nervous, "refusal");
        return { verdict: "refused", reasons: ["Your client won't waive with serious findings unresolved."], draft: `${isNew ? `${nervous.says} ` : ""}${clientTxLines.inspectionRefuse(cc)}` };
      }
      return { verdict: "reluctant", reasons: [], draft: clientTxLines.inspectionWorried(cc) };
    }
    return { verdict: "signed", reasons: [], draft: goingFirm ? clientTxLines.firm(cc) : clientTxLines.waived(cc) };
  }

  // Amendments: their limits after acceptance.
  const issue = action.type === "propose" || action.type === "accept" ? issueOf(tx, action.issueId) : null;
  const theirs = issue && action.type === "accept" ? lastProposal(issue) : null;
  const amount = action.type === "propose" ? Math.max(0, Math.round(action.amount ?? 0)) : action.type === "request_condition_extension" ? action.days : (theirs?.amount ?? 0);
  const closingDate = action.type === "request_date_change" ? action.closingDate : action.type === "propose" ? (action.closingDate ?? null) : (theirs?.closingDate ?? null);
  const kind = issue ?? { kind: action.type === "request_date_change" ? ("date_change" as const) : ("condition_extension" as const), id: "new" };
  const objections = userClientObjections(s, tx, kind, me, issue && !isMoneyIssue(issue) && issue.kind !== "condition_extension" ? 0 : amount, closingDate);
  if (objections.length) return { verdict: "refused", reasons: objections, draft: clientTxLines.amendmentRefused(cc, objections[0]) };
  return { verdict: "signed", reasons: [], draft: clientTxLines.amendmentSigned(cc, Boolean(issue && isDateIssue(issue)) || action.type === "request_date_change") };
}

// ---------- Actions ----------

export async function applyTxClientAction(s: Scenario, n: Negotiation, action: TxAction): Promise<void> {
  const tx = n.transaction!;
  const c = clientOf(n);
  switch (action.type) {
    case "client_message": {
      const text = action.text.trim();
      if (!text) throw new ActionError("Write a message first.");
      pushClient(n, { speaker: "user", text, kind: "chat" });
      // Talking to them settles a surprise that's waiting on you.
      const waiting = (c.events ?? []).find((e) => e.status === "active");
      const event = waiting ? ownEvents(s).find((e) => e.id === waiting.id) : undefined;
      if (waiting && event) {
        waiting.status = "settled";
        const { text: reply } = await clientVoice(s, n, `[Your agent says] "${text}"`, event.settles);
        pushClient(n, { speaker: "client", text: reply, kind: "chat" });
        return;
      }
      const { text: reply } = await clientVoice(s, n, `[Your agent says] "${text}"`, chatDraft(s, n, text, topicsIn(text), null, false));
      pushClient(n, { speaker: "client", text: reply, kind: "chat" });
      return;
    }

    case "client_review": {
      const pending = action.pending;
      if (!needsTxSignature(pending)) throw new ActionError("That doesn't need your client's signature.");
      const doc = txDocument(tx, pending);
      const review = await decide(s, n, tx, pending);
      c.signature = review.verdict === "refused" ? null : { key: doc.key, at: n.simHours };
      if (pending.type === "accept") presentKey(tx, pending.issueId, c.presented);
      pushClient(n, { speaker: "user", text: `Here's the ${doc.label} for you to review.`, kind: "review" });
      const { text } = await clientVoice(s, n, `[Your agent asks you to sign the ${doc.label}] ${review.verdict === "refused" ? "You won't sign yet." : "You sign."}`, review.draft);
      pushClient(n, { speaker: "client", text, kind: "review", verdict: review.verdict, details: review.verdict === "refused" ? review.reasons : [] });
      return;
    }

    case "client_present": {
      const issue = issueOf(tx, action.issueId);
      const last = lastProposal(issue);
      if (!last || last.by === userSide(s)) throw new ActionError("There's nothing new from the other side on this to present.");
      const key = `issue:${issue.id}:${last.id}`;
      if (c.presented.includes(key)) throw new ActionError("You've already presented this.");
      c.presented.push(key);
      const what = isDateIssue(issue) ? `completion on ${displayDate(last.closingDate ?? tx.terms.completionDate)}` : issue.kind === "condition_extension" ? `${last.amount} more banking days` : isMoneyIssue(issue) ? money(last.amount) : issue.title.toLowerCase();
      pushClient(n, { speaker: "user", text: `${s.narrative.opposingAgent.name} sent ${last.kind === "request" ? "a request" : "a counter"} on ${issue.title.toLowerCase()}: ${what}.`, kind: "present" });
      const { text } = await clientVoice(s, n, `[Your agent presents the other side's ${last.kind} on ${issue.title}] ${what}.`, presentIssueDraft(s, n, tx, issue, last));
      pushClient(n, { speaker: "client", text, kind: "present" });
      return;
    }

    default:
      throw new ActionError("That isn't available right now.");
  }
}

function presentKey(tx: Transaction, issueId: string, presented: string[]): void {
  const issue = tx.issues.find((i) => i.id === issueId);
  const last = issue && lastProposal(issue);
  if (last && !presented.includes(`issue:${issue.id}:${last.id}`)) presented.push(`issue:${issue.id}:${last.id}`);
}

function presentIssueDraft(s: Scenario, n: Negotiation, tx: Transaction, issue: Issue, p: Proposal): string {
  const me = userSide(s);
  const cc = clientCtx(s, n);
  const objections = userClientObjections(s, tx, issue, me, isMoneyIssue(issue) || issue.kind === "condition_extension" ? p.amount : 0, p.closingDate);
  if (objections.length) return clientTxLines.presentNo(cc, objections[0]);
  if (isMoneyIssue(issue) && issue.reference > 0) {
    const share = p.amount / issue.reference;
    if (me === "buyer") return share >= 0.6 ? clientTxLines.presentFairBuyer(cc, money(p.amount)) : clientTxLines.presentLowBuyer(cc, money(p.amount));
    return share <= 0.6 ? clientTxLines.presentOkSeller(cc, money(p.amount)) : clientTxLines.presentHighSeller(cc, money(p.amount));
  }
  if (isDateIssue(issue)) return clientTxLines.presentDate(cc);
  return clientTxLines.presentOther(cc);
}

/** The other side's proposals the user answered without presenting them first. */
export function unpresentedTxProposals(s: Scenario, n: Negotiation): number {
  const tx = n.transaction;
  const c = n.client;
  if (!tx || !c?.reviewRequired) return 0;
  const me = userSide(s);
  let count = 0;
  for (const issue of tx.issues) {
    issue.proposals.forEach((p, i) => {
      const answer = issue.proposals[i + 1];
      if (p.by !== me && answer?.by === me && !c.presented.includes(`issue:${issue.id}:${p.id}`)) count++;
    });
  }
  return count;
}

