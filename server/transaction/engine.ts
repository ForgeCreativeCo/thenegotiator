// Runs the deal from contract to closing: advances the calendar, fires events from the ground truth,
// runs the post-contract negotiations, enforces deadlines, and closes or terminates the deal.

import { randomUUID } from "node:crypto";
import type { Scenario, Side } from "../engine/types";
import { Rng } from "../engine/rng";
import { displayDate, money } from "../narrative/format";
import { maxCreditPct } from "../negotiation/constraints";
import { ActionError, pushMessage, userSide } from "../negotiation/engine";
import { botSide } from "../negotiation/strategy";
import type { Negotiation } from "../negotiation/types";
import { dateOf, daysBetween, moveClosing } from "./schedule";
import {
  botOpeningRequest,
  botRespond,
  buyerGapAbility,
  isMoneyIssue,
  latestCloseLimit,
  repairReference,
  sellerGiveLimit,
  sellerGiven,
  userClientObjections,
  type BotMove,
} from "./policy";
import { draftMessage, voice } from "./voice";
import type { Issue, IssueKind, Outcome, Proposal, Report, ScheduledEvent, Settlement, Transaction, TransactionView } from "./types";
import { transactionView } from "./types";

export type TxAction =
  | { type: "advance"; mode: "next" | "day" }
  | { type: "propose"; issueId: string; amount?: number; closingDate?: string; form?: Proposal["form"]; text?: string }
  | { type: "accept"; issueId: string; text?: string }
  | { type: "reject"; issueId: string; text?: string }
  | { type: "withdraw"; issueId: string; text?: string }
  | { type: "terminate"; text?: string }
  | { type: "request_date_change"; closingDate: string; text?: string }
  | { type: "message"; text: string };

export type Voice = typeof voice;

const LABELS: Record<IssueKind, string> = {
  repairs: "Repair request",
  appraisal: "Low appraisal",
  title: "Title problem",
  walkthrough: "Walkthrough problem",
  extension: "Closing extension",
  date_change: "Closing date change",
  possession: "Seller possession after closing",
  loan: "Loan denied",
  kickout: "Kick-out notice",
};

// ---------- Clock and messages ----------

function setClock(s: Scenario, n: Negotiation, tx: Transaction, hourOfDay = 10): void {
  const hours = (daysBetween(s.startDate, tx.effectiveDate) + tx.day) * 24 + (hourOfDay - 9);
  n.simHours = Math.max(n.simHours + 0.25, hours);
}

function note(s: Scenario, n: Negotiation, tx: Transaction, text: string, event?: "deal" | "walk" | "competing_offer" | "client_update"): void {
  setClock(s, n, tx);
  pushMessage(n, { speaker: "system", text, event });
}

// ---------- Issues ----------

function openIssue(tx: Transaction, kind: IssueKind, requester: Side, fields: Partial<Issue> & { detail: string }): Issue {
  const issue: Issue = {
    id: randomUUID(),
    kind,
    title: LABELS[kind],
    requester,
    responder: requester === "buyer" ? "seller" : "buyer",
    openedDay: tx.day,
    deadlineDay: null,
    status: "open",
    proposals: [],
    reference: 0,
    neededDate: null,
    findingIds: [],
    rightUntilDay: null,
    ...fields,
  };
  tx.issues.push(issue);
  return issue;
}

function lastFrom(issue: Issue, side: Side): Proposal | null {
  return [...issue.proposals].reverse().find((p) => p.by === side) ?? null;
}

function uncoveredGap(tx: Transaction): number {
  return tx.appraisedValue === null ? 0 : Math.max(0, tx.terms.price - tx.appraisedValue);
}

/**
 * The appraiser's number. Appraisers usually land on the contract price when it's supportable;
 * they come in low mainly when the buyer paid more than the ground-truth value supports.
 */
function appraise(s: Scenario, price: number): number {
  const value = s.groundTruth.appraisedValue;
  const tolerance = { clean: 0.05, typical: 0.035, rough: 0.015 }[s.difficulty.eventVolatility];
  if (price > value * (1 + tolerance)) return value;
  if (price >= value) return price;
  return Math.round((price + (value - price) * 0.3) / 1000) * 1000;
}

/** Puts an agreed amendment into the contract. */
function applyAgreement(s: Scenario, n: Negotiation, tx: Transaction, issue: Issue, p: Proposal): void {
  issue.status = "agreed";
  const t = tx.terms;
  let summary: string | null = null;
  switch (issue.kind) {
    case "repairs":
    case "title":
    case "walkthrough": {
      if (p.form === "price_reduction") t.price -= p.amount;
      else if (p.form === "repairs") tx.repairsAgreed += p.amount;
      else {
        const cap = Math.floor((t.price * maxCreditPct(t.loanType)) / 100);
        const credit = Math.min(p.amount, Math.max(0, cap - t.sellerCredit));
        t.sellerCredit += credit;
        if (credit < p.amount) {
          t.price -= p.amount - credit;
          summary = `${credit ? `${money(credit)} seller credit and ` : ""}${money(p.amount - credit)} price reduction.`;
          note(s, n, tx, `The lender caps seller credits at ${maxCreditPct(t.loanType)}% of price, so ${credit ? `${money(credit)} is a credit and ` : ""}${money(p.amount - credit)} becomes a price reduction instead.`);
        }
      }
      break;
    }
    case "appraisal":
      t.price -= p.amount;
      tx.buyerGapCash = uncoveredGap(tx);
      break;
    case "extension":
    case "date_change":
      if (p.closingDate) moveClosing(tx, p.closingDate);
      break;
    case "possession":
      t.rentBackDays = p.amount;
      break;
    case "kickout":
      tx.contingencies.homeSale = "removed";
      break;
    case "loan":
      break;
  }
  note(s, n, tx, `Amendment signed: ${summary ?? describeAgreement(issue, p)}`, "deal");
}

function describeAgreement(issue: Issue, p: Proposal): string {
  switch (issue.kind) {
    case "extension":
    case "date_change":
      return `closing moves to ${displayDate(p.closingDate!)}.`;
    case "possession":
      return `seller keeps possession ${p.amount} days after closing.`;
    case "kickout":
      return "buyer removes the home-sale contingency.";
    case "appraisal":
      return p.amount > 0 ? `price reduced by ${money(p.amount)}.` : "price stays; buyer covers the shortfall.";
    default:
      return p.amount > 0 ? `${money(p.amount)} ${p.form === "price_reduction" ? "price reduction" : p.form === "repairs" ? "in seller repairs before closing" : "seller credit"}.` : "no changes.";
  }
}

/** Ends an issue without agreement. */
function closeIssue(s: Scenario, n: Negotiation, tx: Transaction, issue: Issue, status: "withdrawn" | "lapsed"): void {
  issue.status = status;
  const why = status === "lapsed" ? "The deadline passed" : "The request was dropped";
  switch (issue.kind) {
    case "repairs":
      note(s, n, tx, `${why} on the repair request. The buyer takes those items as-is.`);
      break;
    case "appraisal":
      tx.buyerGapCash = uncoveredGap(tx);
      note(s, n, tx, `${why} on the appraisal. The price stays ${money(tx.terms.price)} and the buyer must bring ${money(tx.buyerGapCash)} extra cash to cover the shortfall.`);
      break;
    case "kickout":
      if (status === "lapsed" && issue.proposals.length > 0) terminate(s, n, tx, "terminated", "The buyer didn't remove the home-sale contingency within 72 hours of the kick-out notice, so the contract is released.", "returned_to_buyer");
      break;
    case "loan":
      note(s, n, tx, "The financing contingency window has closed without a termination. If the buyer can't close, their earnest money goes to the seller.");
      break;
    default:
      note(s, n, tx, `${why} on ${issue.title.toLowerCase()}.`);
  }
}

// ---------- Termination and closing ----------

export interface TerminationRight {
  key: string;
  label: string;
  untilDay: number;
}

export function terminationRights(tx: Transaction): TerminationRight[] {
  const rights: TerminationRight[] = [];
  if (tx.status !== "active") return rights;
  if (tx.contingencies.inspection === "active" && tx.inspectionDeadlineDay !== null && tx.day <= tx.inspectionDeadlineDay) {
    rights.push({ key: "inspection", label: "Inspection contingency", untilDay: tx.inspectionDeadlineDay });
  }
  for (const issue of tx.issues) {
    if (issue.status !== "open" || issue.rightUntilDay === null || tx.day > issue.rightUntilDay) continue;
    if (issue.kind === "repairs" && rights.some((r) => r.key === "inspection")) continue;
    rights.push({ key: issue.id, label: issue.kind === "loan" ? "Financing contingency" : issue.kind === "appraisal" ? "Appraisal contingency" : issue.kind === "kickout" ? "Home-sale contingency" : issue.kind === "title" ? "Title objection" : "HOA document review", untilDay: issue.rightUntilDay });
  }
  return rights;
}

function terminate(s: Scenario, n: Negotiation, tx: Transaction, kind: Outcome["kind"], reason: string, earnestMoney: Outcome["earnestMoney"]): void {
  if (tx.status !== "active") return;
  tx.status = kind === "closed" ? "closed" : "terminated";
  tx.outcome = { kind, day: tx.day, reason, earnestMoney };
  for (const issue of tx.issues) if (issue.status === "open") issue.status = "withdrawn";
  const em = money(tx.terms.earnestMoney);
  const emText = earnestMoney === "returned_to_buyer" ? `The buyer's ${em} earnest money is returned.` : earnestMoney === "released_to_seller" ? `The buyer's ${em} earnest money goes to the seller.` : "";
  note(s, n, tx, `${reason} ${emText}`.trim(), "walk");
}

function settlement(s: Scenario, tx: Transaction): Settlement {
  const t = tx.terms;
  const financed = t.loanType !== "cash";
  const basis = financed && tx.appraisedValue !== null ? Math.min(t.price, tx.appraisedValue) : t.price;
  const loanAmount = financed ? Math.round(basis * (1 - t.downPaymentPct / 100)) : 0;
  const downPayment = t.price - loanAmount;
  const buyerClosingCostsEstimate = Math.round(t.price * (financed ? 0.025 : 0.012));
  const sellerNetBeforeCosts = t.price - t.sellerCredit - t.homeWarranty - tx.repairsAgreed;
  const transferTax = s.market.customs.whoPaysTransferTax === "buyer" ? 0 : (t.price * s.market.customs.transferTaxPct) / 100 / (s.market.customs.whoPaysTransferTax === "split" ? 2 : 1);
  return {
    closingDate: t.closingDate,
    price: t.price,
    sellerCredits: t.sellerCredit,
    homeWarranty: t.homeWarranty,
    sellerNetBeforeCosts,
    sellerMortgagePayoff: s.seller.mortgagePayoff,
    sellerProceedsEstimate: Math.round(sellerNetBeforeCosts - s.seller.mortgagePayoff - transferTax - t.price * 0.01),
    loanAmount,
    downPayment,
    buyerClosingCostsEstimate,
    earnestMoneyApplied: t.earnestMoney,
    buyerCashToClose: Math.max(0, downPayment + buyerClosingCostsEstimate - t.sellerCredit - t.earnestMoney),
    repairsAgreed: tx.repairsAgreed,
  };
}

function attemptClosing(s: Scenario, n: Negotiation, tx: Transaction): void {
  for (const issue of tx.issues) if (issue.status === "open" && (issue.kind === "walkthrough" || issue.kind === "possession" || issue.kind === "date_change")) closeIssue(s, n, tx, issue, "lapsed");

  const extension = tx.issues.find((i) => i.kind === "extension" && i.status === "open");
  if (extension) {
    if (extension.requester === "buyer") return terminate(s, n, tx, "buyer_default", "Closing day arrived, the buyer's side wasn't ready, and no extension was signed. The buyer is in default.", "released_to_seller");
    return terminate(s, n, tx, "seller_default", "Closing day arrived, the seller couldn't deliver clear title, and no extension was signed. The seller is in default.", "returned_to_buyer");
  }
  if (tx.loanStatus === "denied") return terminate(s, n, tx, "buyer_default", "The buyer's loan was denied and the financing contingency had already expired. The buyer can't close and is in default.", "released_to_seller");
  if (tx.buyerGapCash > buyerGapAbility(s, tx)) {
    return terminate(s, n, tx, "buyer_default", `The buyer couldn't bring the ${money(tx.buyerGapCash)} needed to cover the appraisal shortfall. The buyer is in default.`, "released_to_seller");
  }
  tx.status = "closed";
  tx.settlement = settlement(s, tx);
  tx.outcome = { kind: "closed", day: tx.day, reason: "Closed and funded.", earnestMoney: "applied_at_closing" };
  setClock(s, n, tx, 15);
  pushMessage(n, { speaker: "system", text: `Closed! The deal funded at ${money(tx.terms.price)}. Keys are in the buyer's hands${tx.terms.rentBackDays ? ` after the seller's ${tx.terms.rentBackDays}-day rent-back` : ""}.`, event: "deal" });
}

// ---------- Events ----------

function revealFindings(tx: Transaction, ids: string[]): void {
  for (const id of ids) if (!tx.revealedFindingIds.includes(id)) tx.revealedFindingIds.push(id);
}

function addReport(tx: Transaction, report: Omit<Report, "id" | "day">): void {
  tx.reports.push({ id: randomUUID(), day: tx.day, ...report });
}

function fireEvent(s: Scenario, n: Negotiation, tx: Transaction, e: ScheduledEvent): void {
  e.fired = true;
  const gt = s.groundTruth;
  const rng = new Rng(s.seed + e.day * 31 + tx.issues.length);
  switch (e.kind) {
    case "earnest_money": {
      tx.earnestMoneyDeposited = true;
      const d = tx.deadlines.find((x) => x.id === "earnest_money");
      if (d) d.status = "met";
      note(s, n, tx, `The buyer's ${money(tx.terms.earnestMoney)} earnest money was deposited with the ${s.market.customs.closing === "attorney" ? "closing attorney" : s.market.customs.closing === "escrow" ? "escrow company" : "title company"}.`);
      break;
    }
    case "inspection_report": {
      const findings = [...gt.inspectionFindings, ...gt.typeSpecificIssues];
      revealFindings(tx, findings.map((f) => f.id));
      const serious = findings.filter((f) => f.severity !== "minor");
      addReport(tx, {
        kind: "inspection",
        title: s.property.type === "land" ? "Due diligence report" : "Inspection report",
        summary: findings.length ? `${findings.length} item${findings.length > 1 ? "s" : ""} found, ${serious.length} significant. Estimated repairs ${money(findings.reduce((a, f) => a + f.repairCostLow, 0))} to ${money(findings.reduce((a, f) => a + f.repairCostHigh, 0))}.` : "No significant issues found.",
        findings,
        value: null,
      });
      note(s, n, tx, findings.length ? `The inspection report is in: ${findings.length} item${findings.length > 1 ? "s" : ""}, ${serious.length} significant. See Reports in the deal file.` : "The inspection report came back clean.");
      if (findings.length) {
        openIssue(tx, "repairs", "buyer", {
          detail: `Based on the inspection: ${findings.map((f) => f.title).slice(0, 3).join("; ")}${findings.length > 3 ? "; and more" : ""}.`,
          reference: repairReference(findings, tx.terms.price),
          findingIds: findings.map((f) => f.id),
          deadlineDay: tx.inspectionDeadlineDay,
          rightUntilDay: tx.inspectionDeadlineDay,
        });
      }
      break;
    }
    case "hoa_documents": {
      const findings = gt.typeSpecificIssues;
      revealFindings(tx, findings.map((f) => f.id));
      addReport(tx, { kind: "hoa_documents", title: "HOA documents", summary: findings.length ? findings.map((f) => f.title).join("; ") : "Budget, minutes and reserves look normal.", findings, value: null });
      note(s, n, tx, "The HOA documents arrived. See Reports in the deal file.");
      if (findings.length) openIssue(tx, "repairs", "buyer", { detail: findings.map((f) => f.title).join("; "), reference: repairReference(findings, tx.terms.price), findingIds: findings.map((f) => f.id), deadlineDay: tx.day + 5, rightUntilDay: tx.day + 5 });
      break;
    }
    case "title_commitment": {
      const issue = gt.titleIssues[0];
      if (!issue) {
        addReport(tx, { kind: "title", title: "Title commitment", summary: "Clean title. Standard exceptions only.", findings: [], value: null });
        note(s, n, tx, "The title commitment came back clean.");
        break;
      }
      addReport(tx, { kind: "title", title: "Title commitment", summary: issue.summary, findings: [], value: null });
      if (issue.resolvable) {
        const curedDay = tx.day + issue.daysToResolve;
        if (curedDay >= tx.closingDay - 1) {
          note(s, n, tx, `Title problem: ${issue.summary} It will take about ${issue.daysToResolve} days to cure, which runs past closing.`);
          openIssue(tx, "extension", "seller", { detail: `The title company needs about ${issue.daysToResolve} days to cure: ${issue.summary}`, neededDate: dateOf(tx, curedDay + 2) });
        } else {
          note(s, n, tx, `Title problem: ${issue.summary} The title company expects to cure it before closing.`);
        }
      } else {
        note(s, n, tx, `Title problem: ${issue.summary} It can't be fully cured.`);
        openIssue(tx, "title", "buyer", { detail: issue.summary, reference: Math.round((tx.terms.price * 0.015) / 250) * 250, rightUntilDay: tx.closingDay - 1 });
      }
      break;
    }
    case "appraisal": {
      tx.appraisedValue = appraise(s, tx.terms.price);
      const gap = uncoveredGap(tx);
      addReport(tx, { kind: "appraisal", title: "Appraisal", summary: gap > 0 ? `Appraised at ${money(tx.appraisedValue)}, ${money(gap)} below the ${money(tx.terms.price)} contract price.` : `Appraised at ${money(tx.appraisedValue)}, at or above the contract price.`, findings: [], value: tx.appraisedValue });
      if (gap <= 0) {
        if (tx.contingencies.appraisal === "active") tx.contingencies.appraisal = "satisfied";
        const d = tx.deadlines.find((x) => x.id === "appraisal");
        if (d) d.status = "met";
        note(s, n, tx, `The appraisal came in at ${money(tx.appraisedValue)}. No shortfall.`);
        break;
      }
      const covered = tx.originalTerms.appraisal === "gap_coverage" ? Math.min(gap, tx.originalTerms.appraisalGapCoverage) : tx.originalTerms.appraisal === "waived" ? gap : 0;
      tx.buyerGapCash = covered;
      const remaining = gap - covered;
      note(s, n, tx, `The appraisal came in at ${money(tx.appraisedValue)}, ${money(gap)} short of the price.${covered ? ` Under the contract the buyer covers ${money(covered)} of that.` : ""}`);
      if (remaining > 0 || tx.originalTerms.appraisal === "waived") {
        const hasRight = tx.contingencies.appraisal === "active" && remaining > 0;
        openIssue(tx, "appraisal", "buyer", {
          detail: `The appraisal is ${money(gap)} below the contract price.`,
          reference: tx.originalTerms.appraisal === "waived" ? gap : remaining,
          deadlineDay: tx.appraisalDeadlineDay,
          rightUntilDay: hasRight ? tx.appraisalDeadlineDay : null,
        });
      }
      break;
    }
    case "loan_event": {
      const event = gt.financing.find((x) => x.id === e.ref);
      if (!event) break;
      addReport(tx, { kind: "loan", title: "Lender update", summary: event.summary, findings: [], value: null });
      if (event.severity === "nuisance") {
        note(s, n, tx, `Lender update: ${event.summary}`);
        break;
      }
      const resolveChance = event.kind === "loan_denial" ? 0.3 : { clean: 0.92, typical: 0.78, rough: 0.55 }[s.difficulty.eventVolatility];
      const resolved = event.severity === "delay" || rng.chance(resolveChance);
      if (resolved) {
        tx.loanStatus = "conditional";
        const daysNeeded = event.severity === "delay" ? rng.int(5, 9) : rng.int(7, 14);
        if (tx.day + daysNeeded >= tx.closingDay - 1) {
          note(s, n, tx, `Lender update: ${event.summary} It's workable, but the lender needs about ${daysNeeded} more days.`);
          openIssue(tx, "extension", "buyer", { detail: `The lender needs about ${daysNeeded} more days: ${event.summary}`, neededDate: dateOf(tx, tx.day + daysNeeded + 1) });
        } else {
          note(s, n, tx, `Lender update: ${event.summary} The lender expects to work through it before closing.`);
        }
      } else {
        tx.loanStatus = "denied";
        const right = tx.contingencies.financing === "active" && tx.financingDeadlineDay !== null && tx.day <= tx.financingDeadlineDay;
        note(s, n, tx, `Lender update: ${event.summary} The loan has been denied.${right ? ` The financing contingency runs through ${displayDate(dateOf(tx, tx.financingDeadlineDay!))}.` : " The financing contingency is no longer available."}`);
        openIssue(tx, "loan", "buyer", { detail: event.summary, rightUntilDay: right ? tx.financingDeadlineDay : null, deadlineDay: right ? tx.financingDeadlineDay : null });
      }
      break;
    }
    case "clear_to_close": {
      if (tx.loanStatus === "denied") break;
      tx.loanStatus = "clear_to_close";
      if (tx.contingencies.financing === "active") tx.contingencies.financing = "satisfied";
      note(s, n, tx, "The lender issued clear to close.");
      break;
    }
    case "client_event": {
      const event = gt.clientEvents[Number(e.ref)];
      if (!event) break;
      if (/possession/i.test(event.summary)) {
        openIssue(tx, "possession", "seller", { detail: event.summary, reference: 5, rightUntilDay: null });
      } else if (/move closing up/i.test(event.summary)) {
        const earlier = dateOf(tx, Math.max(tx.day + 5, tx.closingDay - 7));
        if (earlier < tx.terms.closingDate) openIssue(tx, "date_change", "buyer", { detail: event.summary, neededDate: earlier });
      } else {
        n.announcedEvents.push(`tx-client:${event.summary}`);
      }
      break;
    }
    case "backup_offer": {
      const offer = gt.competingOffers[Number(e.ref)];
      tx.backupOffer = true;
      if (s.userRole === "seller_agent") note(s, n, tx, `Another buyer's agent submitted a backup offer at ${offer ? money(offer.price) : "a similar price"}.`, "competing_offer");
      if (tx.contingencies.homeSale === "active") {
        openIssue(tx, "kickout", "seller", { detail: "The seller received another offer and is invoking the kick-out clause.", deadlineDay: tx.day + 3, rightUntilDay: tx.day + 3 });
      }
      break;
    }
    case "walkthrough": {
      const surprise = gt.walkthroughSurprises[0];
      addReport(tx, { kind: "walkthrough", title: "Final walkthrough", summary: surprise ? surprise.summary : "Everything is as agreed.", findings: [], value: surprise?.costToFix ?? null });
      if (surprise) {
        note(s, n, tx, `Final walkthrough: ${surprise.summary}`);
        openIssue(tx, "walkthrough", "buyer", { detail: surprise.summary, reference: surprise.costToFix, deadlineDay: tx.closingDay });
      } else {
        note(s, n, tx, "Final walkthrough: everything is as agreed.");
      }
      break;
    }
    case "closing":
      attemptClosing(s, n, tx);
      break;
  }
}

/** Marks deadlines that have passed before `day` and applies what happens when they lapse. */
function lapseDeadlines(s: Scenario, n: Negotiation, tx: Transaction, day: number): void {
  for (const d of tx.deadlines) {
    if (d.status !== "upcoming" || d.day >= day || d.id === "closing") continue;
    d.status = "passed";
    if (d.id === "inspection" && tx.contingencies.inspection === "active") {
      tx.contingencies.inspection = "expired";
      note(s, n, tx, "The inspection period ended. The buyer can no longer cancel for the property's condition.");
    }
    if (d.id === "appraisal" && tx.contingencies.appraisal === "active") tx.contingencies.appraisal = "expired";
    if (d.id === "financing" && tx.contingencies.financing === "active") tx.contingencies.financing = tx.loanStatus === "denied" ? "expired" : "satisfied";
  }
  for (const issue of tx.issues) {
    if (issue.status === "open" && issue.deadlineDay !== null && issue.deadlineDay < day) closeIssue(s, n, tx, issue, "lapsed");
  }
}

/** Days the user can jump to: the next event or deadline. */
export function nextStopDay(tx: Transaction): number | null {
  if (tx.status !== "active") return null;
  const days = [...tx.schedule.filter((e) => !e.fired).map((e) => e.day), ...tx.deadlines.filter((d) => d.status === "upcoming").map((d) => d.day), ...tx.issues.filter((i) => i.status === "open" && i.deadlineDay !== null).map((i) => i.deadlineDay!)].filter((d) => d > tx.day);
  return days.length ? Math.min(...days) : null;
}

// ---------- The opposing agent ----------

function botClientNote(n: Negotiation): string | null {
  const entry = [...n.announcedEvents].reverse().find((e) => e.startsWith("tx-client:"));
  return entry ? entry.slice("tx-client:".length) : null;
}

function botMoveDue(issue: Issue, bot: Side): boolean {
  if (issue.status !== "open") return false;
  if (issue.proposals.length === 0) return issue.requester === bot;
  return issue.proposals[issue.proposals.length - 1].by !== bot;
}

async function botActs(s: Scenario, n: Negotiation, tx: Transaction, speak: Voice): Promise<void> {
  const bot = botSide(s);
  const waiting = new Set<string>();
  for (let guard = 0; guard < 10 && tx.status === "active"; guard++) {
    const issue = tx.issues.find((i) => botMoveDue(i, bot) && !waiting.has(i.id));
    if (!issue) return;
    const rights = terminationRights(tx);
    const canTerminate = bot === "buyer" && rights.some((r) => r.key === issue.id || (issue.kind === "repairs" && r.key === "inspection"));
    let move: BotMove = issue.proposals.length === 0 ? botOpeningRequest(s, tx, issue, botClientNote(n)) : botRespond(s, tx, issue, bot, botClientNote(n), canTerminate);
    if (move.kind === "terminate" && !canTerminate && issue.kind !== "kickout") move = { kind: "withdraw", amount: 0, closingDate: null, form: null, reasoning: "No right to terminate; proceed." };
    if (issue.kind === "loan" && !canTerminate) move = { kind: "wait", amount: 0, closingDate: null, form: null, reasoning: "No financing contingency left; hope the lender comes around." };
    if (move.kind === "wait") {
      waiting.add(issue.id);
      continue;
    }

    const situation = `${issue.title}: ${issue.detail} Contract price ${money(tx.terms.price)}, closing ${displayDate(tx.terms.closingDate)}.`;
    const text = await speak(s, n, situation, move.reasoning, draftMessage(s, issue, move));
    setClock(s, n, tx, 14);
    pushMessage(n, { speaker: "bot", text, action: move.kind === "terminate" || move.kind === "withdraw" ? "walk" : move.kind === "accept" ? "accept" : move.kind === "reject" ? "reject" : "counter" });
    n.botTurns.push({ messageId: n.messages[n.messages.length - 1].id, source: "offline", internalNote: move.reasoning, recommended: "hold", validationIssues: [] });

    if (move.kind === "terminate") {
      terminate(s, n, tx, "terminated", issue.kind === "kickout" ? "The buyer released the contract after the kick-out notice." : `The buyer terminated under the ${issue.kind === "loan" ? "financing" : issue.kind === "appraisal" ? "appraisal" : issue.kind === "title" ? "title" : "inspection"} contingency.`, "returned_to_buyer");
      return;
    }
    if (move.kind === "withdraw") {
      closeIssue(s, n, tx, issue, "withdrawn");
      continue;
    }
    const proposal: Proposal = { id: randomUUID(), by: bot, day: tx.day, kind: move.kind, amount: move.amount, closingDate: move.closingDate, form: move.form, note: text };
    if (move.kind === "accept") {
      const theirs = lastFrom(issue, bot === "seller" ? "buyer" : "seller");
      proposal.amount = theirs?.amount ?? move.amount;
      proposal.closingDate = theirs?.closingDate ?? move.closingDate;
      proposal.form = theirs?.form ?? move.form;
      issue.proposals.push(proposal);
      applyAgreement(s, n, tx, issue, proposal);
    } else {
      issue.proposals.push(proposal);
    }
  }
}

// ---------- User actions ----------

function findIssue(tx: Transaction, id: string): Issue {
  const issue = tx.issues.find((i) => i.id === id);
  if (!issue) throw new ActionError("That issue doesn't exist.");
  if (issue.status !== "open") throw new ActionError("That issue is already settled.");
  return issue;
}

export async function applyTxAction(s: Scenario, n: Negotiation, action: TxAction, speak: Voice = voice): Promise<void> {
  const tx = n.transaction;
  if (!tx) throw new ActionError("This deal isn't under contract.");
  if (tx.status !== "active") throw new ActionError("This deal is finished.");
  const me = userSide(s);
  const them: Side = me === "buyer" ? "seller" : "buyer";
  const text = ("text" in action ? action.text : "")?.trim() ?? "";

  switch (action.type) {
    case "advance": {
      const target = action.mode === "day" ? tx.day + 1 : (nextStopDay(tx) ?? tx.day + 1);
      for (let d = tx.day + 1; d <= target && tx.status === "active"; d++) {
        tx.day = d;
        setClock(s, n, tx, 9);
        lapseDeadlines(s, n, tx, d);
        for (const e of tx.schedule) {
          if (tx.status !== "active") break;
          if (!e.fired && e.day <= d) fireEvent(s, n, tx, e);
        }
        await botActs(s, n, tx, speak);
      }
      return;
    }
    case "message": {
      if (!text) throw new ActionError("Write a message first.");
      setClock(s, n, tx);
      pushMessage(n, { speaker: "user", text, action: "message" });
      const open = tx.issues.filter((i) => i.status === "open").map((i) => i.title).join(", ") || "nothing open right now";
      const reply = await speak(s, n, `The other agent says: "${text}". Open items: ${open}.`, "Reply helpfully and briefly. Don't change any position or make new offers in this message.", "Thanks, noted. I'll keep you posted on our side.");
      setClock(s, n, tx, 13);
      pushMessage(n, { speaker: "bot", text: reply, action: "hold" });
      return;
    }
    case "terminate": {
      if (me !== "buyer") throw new ActionError("Only the buyer can terminate under a contingency.");
      const rights = terminationRights(tx);
      if (!rights.length) throw new ActionError("Your buyers have no contingency that lets them cancel right now. Walking away would forfeit their earnest money, and they won't do that.");
      setClock(s, n, tx);
      pushMessage(n, { speaker: "user", text: text || "My buyers are terminating under the contract.", action: "walk" });
      terminate(s, n, tx, "terminated", `The buyer terminated under the ${rights[0].label.toLowerCase()}.`, "returned_to_buyer");
      return;
    }
    case "request_date_change": {
      const objections = userClientObjections(s, tx, { kind: "date_change" } as Issue, me, 0, action.closingDate);
      if (objections.length) throw new ActionError("Your clients won't sign that.", objections);
      const issue = openIssue(tx, "date_change", me, { detail: text || `Move closing to ${displayDate(action.closingDate)}.`, neededDate: action.closingDate });
      issue.proposals.push({ id: randomUUID(), by: me, day: tx.day, kind: "request", amount: 0, closingDate: action.closingDate, form: null, note: text });
      setClock(s, n, tx);
      pushMessage(n, { speaker: "user", text: text || `We'd like to move closing to ${displayDate(action.closingDate)}.`, action: "offer" });
      break;
    }
    case "propose": {
      const issue = findIssue(tx, action.issueId);
      if (issue.proposals.length === 0 && issue.requester !== me) throw new ActionError("Wait for the other side's request first.");
      if (issue.proposals.length > 0 && issue.proposals[issue.proposals.length - 1].by === me) throw new ActionError("You've already made the latest proposal on this. Wait for their reply.");
      const isDate = issue.kind === "extension" || issue.kind === "date_change";
      if (isDate && !action.closingDate) throw new ActionError("Pick a closing date.");
      const amount = Math.max(0, Math.round(action.amount ?? 0));
      const objections = userClientObjections(s, tx, issue, me, isDate ? 0 : amount, isDate ? action.closingDate! : null);
      if (objections.length) throw new ActionError("Your clients won't sign that.", objections);
      const form = isMoneyIssue(issue) ? (action.form ?? (issue.kind === "appraisal" ? "price_reduction" : "credit")) : null;
      issue.proposals.push({ id: randomUUID(), by: me, day: tx.day, kind: issue.proposals.length === 0 ? "request" : "counter", amount, closingDate: action.closingDate ?? null, form, note: text });
      setClock(s, n, tx);
      pushMessage(n, { speaker: "user", text: text || `On ${issue.title.toLowerCase()}: ${isDate ? `closing on ${displayDate(action.closingDate!)}` : issue.kind === "possession" ? `${amount} days` : `${money(amount)}${form === "price_reduction" ? " price reduction" : form === "repairs" ? " in repairs" : " credit"}`}.`, action: "offer" });
      break;
    }
    case "accept": {
      const issue = findIssue(tx, action.issueId);
      const theirs = lastFrom(issue, them);
      if (!theirs || theirs.kind === "reject" || issue.proposals[issue.proposals.length - 1].by !== them) throw new ActionError("There's no proposal from the other side to accept.");
      const objections = userClientObjections(s, tx, issue, me, isMoneyIssue(issue) ? theirs.amount : 0, theirs.closingDate);
      if (objections.length) throw new ActionError("Your clients won't sign that.", objections);
      const proposal: Proposal = { ...theirs, id: randomUUID(), by: me, day: tx.day, kind: "accept", note: text };
      issue.proposals.push(proposal);
      setClock(s, n, tx);
      pushMessage(n, { speaker: "user", text: text || (issue.kind === "kickout" ? "My buyers will remove the home-sale contingency." : "Agreed."), action: "accept" });
      applyAgreement(s, n, tx, issue, proposal);
      break;
    }
    case "reject": {
      const issue = findIssue(tx, action.issueId);
      const last = issue.proposals[issue.proposals.length - 1];
      if (!last || last.by !== them) throw new ActionError("There's nothing from the other side to decline.");
      if (issue.kind === "kickout") throw new ActionError("You can't decline a kick-out notice. Remove the contingency or terminate.");
      issue.proposals.push({ id: randomUUID(), by: me, day: tx.day, kind: "reject", amount: 0, closingDate: null, form: null, note: text });
      setClock(s, n, tx);
      pushMessage(n, { speaker: "user", text: text || "My clients won't agree to that.", action: "message" });
      break;
    }
    case "withdraw": {
      const issue = findIssue(tx, action.issueId);
      if (issue.requester !== me) throw new ActionError("Only the side that raised this can drop it.");
      setClock(s, n, tx);
      pushMessage(n, { speaker: "user", text: text || "We'll move forward without it.", action: "message" });
      closeIssue(s, n, tx, issue, "withdrawn");
      break;
    }
  }
  await botActs(s, n, tx, speak);
}

/** Runs the bot's opening moves right after the contract is signed (nothing happens until time advances). */
export function contractSignedNote(s: Scenario, n: Negotiation): void {
  const tx = n.transaction;
  if (!tx || tx.day !== 0 || n.messages.some((m) => m.text.startsWith("Contract timeline"))) return;
  const parts = [`Contract timeline: effective ${displayDate(tx.effectiveDate)}, closing ${displayDate(tx.terms.closingDate)}.`];
  for (const d of tx.deadlines) if (d.id !== "closing") parts.push(`${d.label}: ${displayDate(dateOf(tx, d.day))}.`);
  pushMessage(n, { speaker: "system", text: parts.join(" ") });
}

// ---------- View ----------

export interface TransactionClientView extends TransactionView {
  today: string;
  closingDateDisplay: string;
  nextStop: { day: number; date: string } | null;
  rights: TerminationRight[];
  guidance: Record<string, string>;
  sellerGiveLimit: number | null;
  sellerGiven: number | null;
  deadlineDates: Record<string, string>;
  /** Day numbers converted to dates for the calendar. */
  eventLabels: { day: number; date: string; label: string; done: boolean }[];
}

export function transactionClientView(s: Scenario, tx: Transaction): TransactionClientView {
  const me = userSide(s);
  const guidance: Record<string, string> = {};
  for (const issue of tx.issues) {
    if (issue.status !== "open") continue;
    if (isMoneyIssue(issue) && me === "seller") {
      const limit = sellerGiveLimit(s, tx);
      const given = sellerGiven(tx, issue.id);
      guidance[issue.id] = `Your sellers will give up to ${money(Math.max(0, limit - given))} more to keep this deal together. Estimated value of this item: ${money(issue.reference)}.`;
    } else if (issue.kind === "appraisal" && me === "buyer") {
      guidance[issue.id] = `Your buyers can bring up to ${money(buyerGapAbility(s, tx))} in extra cash toward the shortfall.`;
    } else if (isMoneyIssue(issue)) {
      guidance[issue.id] = `Estimated cost: ${money(issue.reference)}.`;
    } else if (issue.kind === "extension" || issue.kind === "date_change") {
      guidance[issue.id] = `Your clients can close as late as ${displayDate(latestCloseLimit(s, me))}.${issue.neededDate ? ` The earliest workable date is ${displayDate(issue.neededDate)}.` : ""}`;
    } else if (issue.kind === "kickout" && me === "buyer") {
      const status = s.buyer.homeToSell?.status;
      guidance[issue.id] = status && status !== "under_contract" ? "Your buyers' home isn't under contract yet. Removing the contingency means they could end up owning two homes." : "Your buyers' sale is firm enough to remove the contingency.";
    } else if (issue.kind === "loan") {
      guidance[issue.id] = issue.rightUntilDay !== null ? `Terminate by ${displayDate(dateOf(tx, issue.rightUntilDay))} to get the earnest money back.` : "The financing contingency is gone. If the loan doesn't come through, the earnest money is at risk.";
    }
  }
  const next = nextStopDay(tx);
  const eventLabels: TransactionClientView["eventLabels"] = [];
  const labels: Partial<Record<ScheduledEvent["kind"], string>> = {
    earnest_money: "Earnest money deposit",
    inspection_report: "Inspection",
    hoa_documents: "HOA documents",
    title_commitment: "Title commitment",
    appraisal: "Appraisal",
    clear_to_close: "Clear to close",
    walkthrough: "Final walkthrough",
    closing: "Closing",
  };
  for (const e of tx.schedule) {
    const label = labels[e.kind];
    if (label) eventLabels.push({ day: e.day, date: dateOf(tx, e.day), label, done: e.fired });
  }
  const deadlineDates: Record<string, string> = {};
  for (const d of tx.deadlines) deadlineDates[d.id] = dateOf(tx, d.day);
  return {
    ...transactionView(tx),
    today: dateOf(tx, tx.day),
    closingDateDisplay: displayDate(tx.terms.closingDate),
    nextStop: next === null ? null : { day: next, date: dateOf(tx, next) },
    rights: me === "buyer" ? terminationRights(tx) : [],
    guidance,
    sellerGiveLimit: me === "seller" ? sellerGiveLimit(s, tx) : null,
    sellerGiven: me === "seller" ? sellerGiven(tx) : null,
    deadlineDates,
    eventLabels,
  };
}

