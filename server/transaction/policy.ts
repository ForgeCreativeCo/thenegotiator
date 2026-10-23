// Client limits and the opposing agent's policy for negotiations after acceptance.
// The same limits apply to the bot's client and to the user's own client.

import type { Finding, Scenario, Side } from "../engine/types";
import { addDays } from "../engine/properties";
import { displayDate, money } from "../narrative/format";
import { netPrice } from "../negotiation/constraints";
import type { Issue, Proposal, Transaction } from "./types";

export function allFindings(s: Scenario): Finding[] {
  return [...s.groundTruth.inspectionFindings, ...s.groundTruth.typeSpecificIssues];
}

export function midCost(f: Finding): number {
  return Math.round((f.repairCostLow + f.repairCostHigh) / 2);
}

/**
 * What findings are realistically worth to the buyer. Findings with no repair cost
 * (a lawsuit against the condo corporation, a Tarion delay, a below-market tenant) are valued as a risk discount.
 */
export function repairReference(findings: Finding[], price: number): number {
  const weight = { minor: 0.3, moderate: 1, major: 1, safety: 1 } as const;
  const riskPct = { minor: 0, moderate: 0.005, major: 0.012, safety: 0.01 } as const;
  const total = findings.reduce((sum, f) => sum + (midCost(f) > 0 ? midCost(f) * weight[f.severity] : price * riskPct[f.severity]), 0);
  return Math.round(total / 250) * 250;
}

const MONEY_KINDS = new Set(["repairs", "appraisal", "title", "visit"]);
const DATE_KINDS = new Set(["extension", "date_change"]);

export function isMoneyIssue(issue: Pick<Issue, "kind">): boolean {
  return MONEY_KINDS.has(issue.kind);
}

export function isDateIssue(issue: Pick<Issue, "kind">): boolean {
  return DATE_KINDS.has(issue.kind);
}

export function agreedAmount(issue: Issue): number {
  if (issue.status !== "agreed") return 0;
  return [...issue.proposals].reverse().find((p) => p.kind === "accept")?.amount ?? 0;
}

/** Dollars the seller has already given in amendments, excluding one issue. */
export function sellerGiven(tx: Transaction, excludeIssueId?: string): number {
  return tx.issues.filter((i) => isMoneyIssue(i) && i.id !== excludeIssueId).reduce((sum, i) => sum + agreedAmount(i), 0);
}

/**
 * The most a seller will give back in total after acceptance to keep the deal together.
 * Real defects and a low lender appraisal reset what the house is worth, so sellers bend past their original floor for them.
 */
export function sellerGiveLimit(s: Scenario, tx: Transaction): number {
  const room = Math.max(0, netPrice(s, tx.originalTerms) - s.seller.reservationPrice);
  const weights = { repairs: 0.6, appraisal: 0.6, title: 0.5, visit: 1 } as const;
  let fromIssues = 0;
  for (const issue of tx.issues) if (isMoneyIssue(issue)) fromIssues += issue.reference * weights[issue.kind as keyof typeof weights];
  const backupFactor = tx.backupOffer ? 0.7 : 1;
  // A seller can't concede past their equity: they still have to discharge the mortgage and pay closing costs.
  const equityCap = Math.max(0, netPrice(s, tx.originalTerms) - s.seller.mortgagePayoff - tx.originalTerms.price * 0.03);
  return Math.round(Math.min((room + fromIssues) * backupFactor, equityCap) / 250) * 250;
}

export function sellerRemaining(s: Scenario, tx: Transaction, issue: Issue): number {
  return Math.max(0, sellerGiveLimit(s, tx) - sellerGiven(tx, issue.id));
}

/** Extra cash the buyer can bring to cover a low lender appraisal. */
export function buyerGapAbility(s: Scenario): number {
  return Math.min(s.buyer.cashReserves, s.buyer.maxAppraisalGapCoverage);
}

export function latestCloseLimit(s: Scenario, side: Side): string {
  return addDays(side === "seller" ? s.seller.latestClose : s.buyer.latestClose, 14);
}

/** Problems with the user's client signing off on this proposal or acceptance. Empty = OK. */
export function userClientObjections(s: Scenario, tx: Transaction, issue: Pick<Issue, "kind" | "id">, side: Side, amount: number, closingDate: string | null): string[] {
  const problems: string[] = [];
  if (isMoneyIssue(issue) && side === "seller") {
    const limit = sellerGiveLimit(s, tx);
    const given = sellerGiven(tx, issue.id);
    if (given + amount > limit) problems.push(`Your sellers will give at most ${money(limit)} in total after acceptance to keep this deal together${given ? ` (${money(given)} is already agreed)` : ""}.`);
  }
  if (issue.kind === "appraisal" && side === "buyer") {
    const gapLeft = Math.max(0, tx.terms.price - amount - (tx.appraisedValue ?? tx.terms.price));
    const ability = buyerGapAbility(s);
    if (gapLeft > ability) problems.push(`That leaves your buyers covering ${money(gapLeft)} of the shortfall in cash; they can bring at most ${money(ability)}.`);
  }
  if (issue.kind === "condition_extension" && side === "seller" && s.seller.boughtElsewhere && amount > 3) problems.push("Your sellers have bought firm elsewhere and won't give more than 3 extra banking days.");
  if (closingDate) {
    const limit = latestCloseLimit(s, side);
    if (closingDate > limit) problems.push(`Your ${side === "seller" ? "sellers" : "buyers"} can't complete later than ${displayDate(limit)}.`);
    if (closingDate <= addDays(tx.effectiveDate, tx.day + 2)) problems.push("That completion date is too soon to be workable.");
  }
  return problems;
}

// ---------- The opposing agent ----------

export interface BotMove {
  kind: Proposal["kind"] | "terminate" | "withdraw" | "wait";
  amount: number;
  closingDate: string | null;
  form: Proposal["form"];
  reasoning: string;
}

function round250(n: number): number {
  return Math.round(n / 250) * 250;
}

const ASK_FACTOR = { collaborative: 0.85, professional: 1, cagey: 1.1, hardball: 1.25 } as const;

function lastBy(issue: Issue, side: Side): Proposal | null {
  return [...issue.proposals].reverse().find((p) => p.by === side) ?? null;
}

const move = (kind: BotMove["kind"], reasoning: string, extra: Partial<BotMove> = {}): BotMove => ({ kind, amount: 0, closingDate: null, form: null, reasoning, ...extra });

/** What the bot asks for when it is the requester and makes the first move. */
export function botOpeningRequest(s: Scenario, tx: Transaction, issue: Issue, clientNote: string | null): BotMove {
  const factor = ASK_FACTOR[s.difficulty.temperament] * (clientNote && /cold feet/i.test(clientNote) ? 1.4 : 1);
  switch (issue.kind) {
    case "repairs":
    case "title":
      // Nobody credibly asks for more than about 30% of the price; past that, buyers walk instead.
      return move("request", `Ask for about ${money(Math.min(issue.reference * factor, tx.terms.price * 0.3))} against an estimated ${money(issue.reference)}, before waiving the condition.`, { amount: round250(Math.min(issue.reference * factor, tx.terms.price * 0.3)), form: "price_reduction" });
    case "visit":
      return move("request", "Ask for the cost of putting things right, as a credit on closing.", { amount: issue.reference, form: "credit" });
    case "appraisal":
      return move("request", "Ask the seller to bring the price down to the appraised value.", { amount: issue.reference, form: "price_reduction" });
    case "extension":
    case "date_change":
      return move("request", "Ask for the completion date we need.", { closingDate: issue.neededDate });
    case "condition_extension":
      return move("request", "Ask for a few more banking days on the condition.", { amount: issue.reference });
    case "loan":
      return move("terminate", "The mortgage is declined and the financing condition is still open. Let it fail so the deposit comes back.");
    case "escape_clause":
      return move("request", "Give notice under the escape clause: the buyer has 72 hours to waive the sale-of-property condition.");
  }
}

/** The bot's reply when the user has made the latest move on an issue. */
export function botRespond(s: Scenario, tx: Transaction, issue: Issue, botSide: Side, clientNote: string | null, canLetConditionFail: boolean): BotMove {
  const userSide: Side = botSide === "seller" ? "buyer" : "seller";
  const theirs = lastBy(issue, userSide);
  const mine = lastBy(issue, botSide);
  const myCount = issue.proposals.filter((p) => p.by === botSide && p.kind !== "accept").length;
  if (!theirs) return move("wait", "Nothing new to respond to.");

  if (isDateIssue(issue)) {
    if (issue.requester === botSide) {
      if (theirs.kind === "reject") return move("wait", "They refused the date change. Nothing more to do but see what happens at completion.");
      const ok = theirs.closingDate && (!issue.neededDate || theirs.closingDate >= issue.neededDate);
      return ok ? move("accept", "Their date works.", { closingDate: theirs.closingDate }) : move("reject", "Their date doesn't give us enough time.");
    }
    const limit = addDays(botSide === "seller" ? s.seller.latestClose : s.buyer.latestClose, 10);
    if (theirs.closingDate && theirs.closingDate <= limit) return move("accept", "The new date is inside what my client can live with.", { closingDate: theirs.closingDate });
    if (myCount === 0 && limit > tx.terms.completionDate) return move("counter", "Offer the latest date my client can accept.", { closingDate: limit });
    return move("reject", "My client can't move completion that far.");
  }

  if (issue.kind === "condition_extension") {
    if (issue.requester === botSide) return theirs.kind === "reject" ? move("wait", "They won't extend. We'll have to decide on the condition by the deadline.") : move("accept", "Take the extra time.", { amount: theirs.amount });
    const cap = s.seller.boughtElsewhere || tx.backupOffer ? 2 : s.seller.maxConditionDays;
    if (theirs.amount <= cap) return move("accept", "A short extension keeps the deal alive.", { amount: theirs.amount });
    if (myCount === 0) return move("counter", `My seller can give ${cap} banking days at most.`, { amount: cap });
    return move("reject", "No more time.");
  }

  if (issue.kind === "escape_clause") {
    // The bot is the buyer; the user (seller) gave notice.
    return tx.buyerHomeSold
      ? move("accept", "Our sale is firm; waive the condition and stay in the deal.")
      : move("terminate", "We can't waive the sale condition until our home sells, so the agreement ends and the deposit comes back.");
  }

  // ---- Money issues ----
  if (botSide === "seller") {
    const ask = theirs.amount;
    const rem = sellerRemaining(s, tx, issue);
    if (issue.kind === "repairs" && clientNote && /offended|relist/i.test(clientNote) && myCount === 0) return move("reject", "My seller took the request personally. Push back hard first.");
    if (rem <= 0) return move("reject", "My seller has nothing left to give. It's as-is.");
    if (ask <= rem && (ask <= rem * 0.5 || ask <= issue.reference * 0.5)) return move("accept", "A reasonable request we can absorb. Keep the deal together.", { amount: ask, form: theirs.form });
    if (myCount >= 3) return ask <= rem * 0.8 ? move("accept", "We've gone back and forth enough; this is within reach.", { amount: ask, form: theirs.form }) : move("reject", "Final answer. My seller won't go further.");
    const counter = round250(Math.min(rem, mine && mine.kind !== "reject" ? (mine.amount + ask) / 2 : ask * (0.35 + 0.35 * s.difficulty.concessionPace)));
    if (counter >= ask * 0.95 && ask <= rem) return move("accept", "We're close enough to accept.", { amount: ask, form: theirs.form });
    return move("counter", `Counter at ${money(counter)}; my seller's room is limited.`, { amount: counter, form: theirs.form ?? "price_reduction" });
  }

  // Bot is the buyer; the user (seller) countered or refused.
  const ability = buyerGapAbility(s);
  const need = issue.kind === "appraisal" ? Math.max(0, issue.reference - ability) : round250(issue.reference * (issue.kind === "title" ? 0.5 : 0.6) * (clientNote && /cold feet/i.test(clientNote) ? 1.4 : 1));
  const offered = theirs.kind === "reject" ? 0 : theirs.amount;
  if (offered >= need) return move("accept", "That covers what my buyers need.", { amount: offered, form: theirs.form });
  if (theirs.kind === "reject" || myCount >= 3) {
    if (offered >= need * 0.75) return offered > 0 ? move("accept", "Not everything we wanted, but enough to waive and move on.", { amount: offered, form: theirs.form }) : move("withdraw", "We'll proceed without it.");
    if (canLetConditionFail) return move("terminate", `The seller won't cover enough (${money(offered)} against the ${money(need)} my buyers need), and the condition is still open. Let it fail.`);
    return offered > 0 ? move("accept", "No condition left to rely on; take what's offered.", { amount: offered, form: theirs.form }) : move("withdraw", "No condition left to rely on; proceed.");
  }
  const counter = Math.max(need, round250(mine && mine.kind !== "reject" ? (mine.amount + offered) / 2 : (need + offered) / 2));
  return move("counter", `Counter at ${money(counter)}; my buyers need at least ${money(need)}.`, { amount: counter, form: mine?.form ?? "price_reduction" });
}
