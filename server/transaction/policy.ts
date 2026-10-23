// Client limits and the opposing agent's policy for negotiations after the contract is signed.
// The same limits apply to the bot's client and to the user's own client.

import type { Finding, Scenario, Side } from "../engine/types";
import { addDays } from "../engine/properties";
import { money } from "../narrative/format";
import { sellerNet } from "../negotiation/constraints";
import type { Issue, Proposal, Transaction } from "./types";

export function allFindings(s: Scenario): Finding[] {
  return [...s.groundTruth.inspectionFindings, ...s.groundTruth.typeSpecificIssues];
}

export function midCost(f: Finding): number {
  return Math.round((f.repairCostLow + f.repairCostHigh) / 2);
}

/**
 * What the findings in a repair issue are realistically worth to the buyer. Findings with no repair cost
 * (a pending lawsuit, a construction delay, an underfunded HOA) are valued as a risk discount on the price.
 */
export function repairReference(findings: Finding[], price: number): number {
  const weight = { minor: 0.3, moderate: 1, major: 1, safety: 1 } as const;
  const riskPct = { minor: 0, moderate: 0.005, major: 0.012, safety: 0.01 } as const;
  const total = findings.reduce((sum, f) => sum + (midCost(f) > 0 ? midCost(f) * weight[f.severity] : price * riskPct[f.severity]), 0);
  return Math.round(total / 250) * 250;
}

const MONEY_KINDS = new Set(["repairs", "appraisal", "title", "walkthrough"]);

export function isMoneyIssue(issue: Issue): boolean {
  return MONEY_KINDS.has(issue.kind);
}

export function agreedAmount(issue: Issue): number {
  if (issue.status !== "agreed") return 0;
  const accepted = [...issue.proposals].reverse().find((p) => p.kind === "accept");
  return accepted?.amount ?? 0;
}

/** Dollars the seller has already given in post-contract amendments, excluding one issue. */
export function sellerGiven(tx: Transaction, excludeIssueId?: string): number {
  return tx.issues.filter((i) => isMoneyIssue(i) && i.id !== excludeIssueId).reduce((sum, i) => sum + agreedAmount(i), 0);
}

/**
 * The most a seller will give back in total after the contract to keep the deal together.
 * Real defects and a low appraisal reset what the house is worth, so sellers bend past their original floor for them.
 */
export function sellerGiveLimit(s: Scenario, tx: Transaction): number {
  const room = Math.max(0, sellerNet(tx.originalTerms) - s.seller.reservationPrice);
  const weights = { repairs: 0.6, appraisal: 0.6, title: 0.5, walkthrough: 1 } as const;
  let fromIssues = 0;
  for (const issue of tx.issues) if (isMoneyIssue(issue)) fromIssues += issue.reference * weights[issue.kind as keyof typeof weights];
  const backupFactor = tx.backupOffer ? 0.7 : 1;
  return Math.round(((room + fromIssues) * backupFactor) / 250) * 250;
}

export function sellerRemaining(s: Scenario, tx: Transaction, issue: Issue): number {
  return Math.max(0, sellerGiveLimit(s, tx) - sellerGiven(tx, issue.id));
}

/** Extra cash the buyer can bring to cover an appraisal shortfall. */
export function buyerGapAbility(s: Scenario, tx: Transaction): number {
  const contractCoverage = tx.originalTerms.appraisal === "gap_coverage" ? tx.originalTerms.appraisalGapCoverage : 0;
  return Math.min(s.buyer.cashReserves, Math.max(contractCoverage, s.buyer.maxAppraisalGapCoverage));
}

export function latestCloseLimit(s: Scenario, side: Side): string {
  return addDays(side === "seller" ? s.seller.latestClose : s.buyer.latestClose, 14);
}

/** Problems with the user's client signing off on this proposal or acceptance. Empty = OK. */
export function userClientObjections(s: Scenario, tx: Transaction, issue: Issue, side: Side, amount: number, closingDate: string | null): string[] {
  const problems: string[] = [];
  if (isMoneyIssue(issue) && side === "seller") {
    const limit = sellerGiveLimit(s, tx);
    const given = sellerGiven(tx, issue.id);
    if (given + amount > limit) problems.push(`Your sellers will give at most ${money(limit)} in total after the contract to keep this deal together${given ? ` (${money(given)} is already agreed)` : ""}.`);
  }
  if (issue.kind === "appraisal" && side === "buyer") {
    const gapLeft = Math.max(0, tx.terms.price - amount - (tx.appraisedValue ?? tx.terms.price));
    const ability = buyerGapAbility(s, tx);
    if (gapLeft > ability) problems.push(`That leaves your buyers covering ${money(gapLeft)} of the shortfall in cash; they can bring at most ${money(ability)}.`);
  }
  if (closingDate) {
    const limit = latestCloseLimit(s, side);
    if (closingDate > limit) problems.push(`Your ${side === "seller" ? "sellers" : "buyers"} can't close later than ${limit}.`);
    if (closingDate <= addDays(tx.effectiveDate, tx.day + 2)) problems.push("That closing date is too soon to be workable.");
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

function defaultForm(issue: Issue): Proposal["form"] {
  if (issue.kind === "appraisal") return "price_reduction";
  if (isMoneyIssue(issue)) return "credit";
  return null;
}

/** What the bot asks for when it is the requester and makes the first move. */
export function botOpeningRequest(s: Scenario, tx: Transaction, issue: Issue, clientNote: string | null): BotMove {
  const factor = ASK_FACTOR[s.difficulty.temperament] * (clientNote && /cold feet/i.test(clientNote) ? 1.4 : 1);
  switch (issue.kind) {
    case "repairs":
    case "title":
    case "walkthrough":
      return { kind: "request", amount: round250(issue.reference * (issue.kind === "walkthrough" ? 1 : factor)), closingDate: null, form: "credit", reasoning: `Ask for about ${money(issue.reference * factor)} against an estimated ${money(issue.reference)}.` };
    case "appraisal":
      return { kind: "request", amount: issue.reference, closingDate: null, form: "price_reduction", reasoning: "Ask the seller to bring the price down to the appraised value." };
    case "extension":
      return { kind: "request", amount: 0, closingDate: issue.neededDate, form: null, reasoning: "Ask for the extension needed to close." };
    case "date_change":
    case "possession":
      return { kind: "request", amount: issue.reference, closingDate: issue.neededDate, form: null, reasoning: "Pass along the client's request." };
    case "loan":
      return { kind: "terminate", amount: 0, closingDate: null, form: null, reasoning: "The loan is dead and the financing contingency is still active. Terminate and get the earnest money back." };
    case "kickout":
      return { kind: "request", amount: 0, closingDate: null, form: null, reasoning: "Notify the buyer they must remove the home-sale contingency or release the contract." };
  }
}

/** The bot's reply when the user has made the latest move on an issue. */
export function botRespond(s: Scenario, tx: Transaction, issue: Issue, botSide: Side, clientNote: string | null, canTerminate: boolean): BotMove {
  const userSide: Side = botSide === "seller" ? "buyer" : "seller";
  const theirs = lastBy(issue, userSide);
  const mine = lastBy(issue, botSide);
  const myCount = issue.proposals.filter((p) => p.by === botSide && p.kind !== "accept").length;
  const pace = s.difficulty.concessionPace;
  const wait = (reasoning: string): BotMove => ({ kind: "wait", amount: 0, closingDate: null, form: null, reasoning });
  if (!theirs) return wait("Nothing new to respond to.");

  // ---- Date issues ----
  if (issue.kind === "extension" || issue.kind === "date_change") {
    if (issue.requester === botSide) {
      if (theirs.kind === "reject") return wait("They refused the date change. Nothing more to do but see what happens at closing.");
      const ok = theirs.closingDate && (!issue.neededDate || theirs.closingDate >= issue.neededDate);
      return ok ? { kind: "accept", amount: 0, closingDate: theirs.closingDate, form: null, reasoning: "Their date works." } : { kind: "reject", amount: 0, closingDate: null, form: null, reasoning: "Their date doesn't give us enough time." };
    }
    const limit = addDays(botSide === "seller" ? s.seller.latestClose : s.buyer.latestClose, 10);
    if (theirs.closingDate && theirs.closingDate <= limit) return { kind: "accept", amount: 0, closingDate: theirs.closingDate, form: null, reasoning: "The new date is inside what my client can live with." };
    if (myCount === 0 && limit > tx.terms.closingDate) return { kind: "counter", amount: 0, closingDate: limit, form: null, reasoning: "Offer the latest date my client can accept." };
    return { kind: "reject", amount: 0, closingDate: null, form: null, reasoning: "My client can't push closing that far." };
  }

  if (issue.kind === "possession") {
    if (issue.requester === botSide) return theirs.kind === "reject" ? { kind: "withdraw", amount: 0, closingDate: null, form: null, reasoning: "They said no; drop it." } : { kind: "accept", amount: theirs.amount, closingDate: null, form: null, reasoning: "Take what they offer." };
    const tolerance = s.buyer.urgency >= 4 ? 3 : 10;
    if (theirs.amount <= tolerance) return { kind: "accept", amount: theirs.amount, closingDate: null, form: null, reasoning: "A short rent-back is fine." };
    if (myCount === 0) return { kind: "counter", amount: tolerance, closingDate: null, form: null, reasoning: `My buyers can live with ${tolerance} days at most.` };
    return { kind: "reject", amount: 0, closingDate: null, form: null, reasoning: "Too long." };
  }

  if (issue.kind === "kickout") {
    // The bot is the buyer here; user is the seller who sent the notice.
    const canRemove = s.buyer.homeToSell?.status === "under_contract" || !s.buyer.homeToSell;
    return canRemove ? { kind: "accept", amount: 0, closingDate: null, form: null, reasoning: "Our sale is firm enough; remove the contingency and stay in the deal." } : { kind: "terminate", amount: 0, closingDate: null, form: null, reasoning: "We can't remove the contingency without our sale being firm; release the contract." };
  }

  // ---- Money issues ----
  if (botSide === "seller") {
    // Bot is the seller responding to the buyer's request.
    const ask = theirs.amount;
    const rem = sellerRemaining(s, tx, issue);
    const upset = issue.kind === "repairs" && clientNote && /offended|threatens/i.test(clientNote) && myCount === 0;
    if (upset) return { kind: "reject", amount: 0, closingDate: null, form: null, reasoning: "My seller took the request personally. Push back hard first." };
    if (rem <= 0) return { kind: "reject", amount: 0, closingDate: null, form: null, reasoning: "My seller has nothing left to give. It's as-is." };
    if (ask <= rem && (ask <= rem * 0.5 || ask <= issue.reference * 0.5)) return { kind: "accept", amount: ask, closingDate: null, form: theirs.form, reasoning: "A reasonable request we can absorb. Take it and keep the deal together." };
    if (myCount >= 3) return ask <= rem * 0.8 ? { kind: "accept", amount: ask, closingDate: null, form: theirs.form, reasoning: "We've gone back and forth enough; this is within reach." } : { kind: "reject", amount: 0, closingDate: null, form: null, reasoning: "Final answer. My seller won't go further." };
    const counter = round250(Math.min(rem, mine && mine.kind !== "reject" ? (mine.amount + ask) / 2 : ask * (0.35 + 0.35 * pace)));
    if (counter >= ask * 0.95 && ask <= rem) return { kind: "accept", amount: ask, closingDate: null, form: theirs.form, reasoning: "We're close enough to accept." };
    return { kind: "counter", amount: counter, closingDate: null, form: theirs.form ?? defaultForm(issue), reasoning: `Counter at ${money(counter)}; my seller's remaining room is limited.` };
  }

  // Bot is the buyer; the user (seller) countered or refused its request.
  const ability = buyerGapAbility(s, tx);
  const need =
    issue.kind === "appraisal" ? Math.max(0, issue.reference - ability) : round250(issue.reference * (issue.kind === "repairs" ? 0.6 : issue.kind === "title" ? 0.5 : 0.6) * (clientNote && /cold feet/i.test(clientNote) ? 1.4 : 1));
  const offered = theirs.kind === "reject" ? 0 : theirs.amount;
  if (offered >= need) return { kind: "accept", amount: offered, closingDate: null, form: theirs.form, reasoning: "That covers what my buyers need." };
  const final = theirs.kind === "reject" || myCount >= 3;
  if (final) {
    if (offered >= need * 0.75) return offered > 0 ? { kind: "accept", amount: offered, closingDate: null, form: theirs.form, reasoning: "Not everything we wanted, but enough to move forward." } : { kind: "withdraw", amount: 0, closingDate: null, form: null, reasoning: "We'll proceed without it." };
    if (canTerminate) return { kind: "terminate", amount: 0, closingDate: null, form: null, reasoning: `The seller won't cover enough (${money(offered)} against the ${money(need)} my buyers need) and we still have the right to walk.` };
    return offered > 0 ? { kind: "accept", amount: offered, closingDate: null, form: theirs.form, reasoning: "No right to walk anymore; take what's offered." } : { kind: "withdraw", amount: 0, closingDate: null, form: null, reasoning: "No right to walk anymore; proceed." };
  }
  const counter = round250(mine && mine.kind !== "reject" ? (mine.amount + offered) / 2 : (need + offered) / 2);
  return { kind: "counter", amount: Math.max(counter, need), closingDate: null, form: mine?.form ?? defaultForm(issue), reasoning: `Counter at ${money(Math.max(counter, need))}; my buyers need at least ${money(need)}.` };
}
