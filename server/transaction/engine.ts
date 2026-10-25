// Runs the deal from acceptance to completion under Ontario practice: conditions waived or fulfilled by their
// deadlines (or the agreement is null and void), firm, title requisitions, pre-closing visits, and completion.

import { randomUUID } from "node:crypto";
import type { ConditionKey, Finding, Scenario, Side } from "../engine/types";
import { Rng } from "../engine/rng";
import { displayDate, money } from "../narrative/format";
import { ActionError, pushMessage, userSide } from "../negotiation/engine";
import { botSide } from "../negotiation/strategy";
import { rentalBuyoutTotal } from "../negotiation/terms";
import type { Negotiation } from "../negotiation/types";
import { dateOf, daysBetween, extendCondition, moveClosing } from "./schedule";
import {
  allFindings,
  botOpeningRequest,
  botRespond,
  buyerGapAbility,
  isDateIssue,
  isMoneyIssue,
  latestCloseLimit,
  repairReference,
  sellerGiveLimit,
  sellerGiven,
  userClientObjections,
  type BotMove,
} from "./policy";
import { cmhcPremiumRate, landTransferTax } from "./landTransferTax";
import { voice } from "./voice";
import type { ConditionState, Issue, IssueKind, Outcome, Proposal, Report, ScheduledEvent, Settlement, Transaction, TransactionView } from "./types";
import { transactionView } from "./types";
import { agentTxDraft, agentTxReply } from "../dialogue/transaction";
import { applyTxClientAction, requireTxSignature, txClientTriggers } from "../client/transaction";

export type TxAction =
  | { type: "advance"; mode: "next" | "day" }
  | { type: "propose"; issueId: string; amount?: number; closingDate?: string; form?: Proposal["form"]; text?: string }
  | { type: "accept"; issueId: string; text?: string }
  | { type: "reject"; issueId: string; text?: string }
  | { type: "withdraw"; issueId: string; text?: string }
  | { type: "condition"; key: ConditionKey; how: "waive" | "fulfil"; text?: string }
  | { type: "release"; key: string; text?: string }
  | { type: "request_condition_extension"; key: ConditionKey; days: number; text?: string }
  | { type: "request_date_change"; closingDate: string; text?: string }
  | { type: "message"; text: string }
  | { type: "client_message"; text: string }
  | { type: "client_review"; pending: TxAction }
  | { type: "client_present"; issueId: string };

export type Voice = typeof voice;

const LABELS: Record<IssueKind, string> = {
  repairs: "Price adjustment for findings",
  appraisal: "Low lender appraisal",
  condition_extension: "Condition extension",
  loan: "Mortgage declined",
  escape_clause: "Escape clause notice",
  title: "Title requisition",
  visit: "Pre-closing visit problem",
  extension: "Completion extension",
  date_change: "Completion date change",
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
    conditionKey: null,
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

function pendingCondition(tx: Transaction, key: ConditionKey | null): ConditionState | null {
  if (!key) return null;
  return tx.conditions.find((c) => c.key === key && c.status === "pending") ?? null;
}

function conditionLabel(tx: Transaction, key: ConditionKey): string {
  return (tx.conditions.find((c) => c.key === key)?.label ?? key).toLowerCase();
}

/** Puts an agreed Amendment (Form 120) into the agreement. */
function applyAgreement(s: Scenario, n: Negotiation, tx: Transaction, issue: Issue, p: Proposal): void {
  issue.status = "agreed";
  let summary: string;
  switch (issue.kind) {
    case "repairs":
    case "title":
    case "visit":
      if (p.form === "repairs") {
        tx.repairsAgreed += p.amount;
        summary = `seller to complete ${money(p.amount)} of repairs before completion.`;
      } else if (p.form === "credit") {
        tx.creditsOnClosing += p.amount;
        summary = `${money(p.amount)} credit to the buyer on closing${tx.terms.financing !== "cash" ? " (the buyer's lender must be told and approve it)" : ""}.`;
      } else {
        tx.terms.price -= p.amount;
        tx.priceReductions += p.amount;
        if (tx.appraisedValue !== null) tx.buyerGapCash = uncoveredGap(tx);
        summary = `price reduced by ${money(p.amount)} to ${money(tx.terms.price)}.`;
      }
      break;
    case "appraisal":
      tx.terms.price -= p.amount;
      tx.priceReductions += p.amount;
      tx.buyerGapCash = uncoveredGap(tx);
      summary = p.amount > 0 ? `price reduced by ${money(p.amount)} to ${money(tx.terms.price)}.` : "price stays; the buyer covers the shortfall.";
      break;
    case "extension":
    case "date_change":
      if (p.closingDate) moveClosing(tx, p.closingDate);
      summary = `completion moves to ${displayDate(tx.terms.completionDate)}.`;
      break;
    case "condition_extension":
      if (issue.conditionKey) extendCondition(tx, issue.conditionKey, p.amount);
      summary = `the ${issue.conditionKey ? conditionLabel(tx, issue.conditionKey) : ""} condition is extended to ${displayDate(dateOf(tx, tx.conditions.find((c) => c.key === issue.conditionKey)?.deadlineDay ?? tx.day))}.`;
      break;
    case "escape_clause":
      setCondition(s, n, tx, "sale_of_property", "waived");
      return;
    case "loan":
      return;
  }
  note(s, n, tx, `Amendment signed: ${summary}`, "deal");
}

/** Ends an issue without agreement. */
function closeIssue(s: Scenario, n: Negotiation, tx: Transaction, issue: Issue, status: "withdrawn" | "lapsed"): void {
  issue.status = status;
  switch (issue.kind) {
    case "repairs":
      note(s, n, tx, "No price adjustment was agreed. If the buyer waives, they take those items as they are.");
      break;
    case "appraisal":
      tx.buyerGapCash = uncoveredGap(tx);
      note(s, n, tx, `No price change on the appraisal. The price stays ${money(tx.terms.price)} and the buyer must bring ${money(tx.buyerGapCash)} more cash on closing.`);
      break;
    case "escape_clause":
      if (status === "lapsed" && issue.proposals.length > 0) failCondition(s, n, tx, "sale_of_property", "The buyer didn't waive the sale-of-property condition within 72 hours of the escape clause notice.");
      break;
    case "loan":
    case "condition_extension":
      break;
    default:
      note(s, n, tx, `${issue.title}: ${status === "lapsed" ? "time ran out" : "dropped"} without an agreement.`);
  }
}

// ---------- Conditions, termination, completion ----------

function setCondition(s: Scenario, n: Negotiation, tx: Transaction, key: ConditionKey, how: "waived" | "fulfilled"): void {
  const condition = tx.conditions.find((c) => c.key === key);
  if (!condition || condition.status !== "pending") return;
  condition.status = how;
  const deadline = tx.deadlines.find((d) => d.id === `condition:${key}`);
  if (deadline) deadline.status = "met";
  for (const issue of tx.issues) if (issue.status === "open" && issue.conditionKey === key && issue.kind !== "appraisal") issue.status = "withdrawn";
  note(s, n, tx, `${how === "waived" ? "Waiver (Form 123)" : "Notice of Fulfilment (Form 124)"} delivered: ${condition.label.toLowerCase()} condition.`);
  if (tx.conditions.every((c) => c.status !== "pending")) {
    tx.firm = true;
    tx.firmDay = tx.day;
    note(s, n, tx, `All conditions are satisfied. The deal is firm${s.userRole === "seller_agent" ? ": sold firm" : ""}.`, "deal");
  }
}

/** A condition wasn't waived or fulfilled: the agreement is null and void and the deposit comes back. */
function failCondition(s: Scenario, n: Negotiation, tx: Transaction, key: ConditionKey, reason: string): void {
  const condition = tx.conditions.find((c) => c.key === key);
  if (condition) condition.status = "failed";
  end(s, n, tx, { kind: "void", reason: `${reason} The agreement is null and void.`, deposit: "returned_to_buyer", damagesExposure: null });
}

function end(s: Scenario, n: Negotiation, tx: Transaction, o: Omit<Outcome, "day">): void {
  if (tx.status !== "active") return;
  tx.status = o.kind === "completed" ? "closed" : "terminated";
  tx.outcome = { ...o, day: tx.day };
  for (const issue of tx.issues) if (issue.status === "open") issue.status = "withdrawn";
  const deposit = money(tx.terms.deposit);
  const depositText = o.deposit === "returned_to_buyer" ? `The ${deposit} deposit is returned to the buyer in full.` : o.deposit === "forfeited_to_seller" ? `The buyer forfeits the ${deposit} deposit.` : "";
  const damages = o.damagesExposure ? ` The seller could also sue for about ${money(o.damagesExposure)} more (resale shortfall and carrying costs).` : "";
  note(s, n, tx, `${o.reason} ${depositText}${damages}`.trim(), o.kind === "completed" ? "deal" : "walk");
}

export interface ReleaseOption {
  key: string;
  label: string;
  untilDay: number;
}

/** Ways the buyer can end the deal without defaulting: let a pending condition fail, or a title objection. */
export function releaseOptions(tx: Transaction): ReleaseOption[] {
  if (tx.status !== "active") return [];
  const options: ReleaseOption[] = tx.conditions.filter((c) => c.status === "pending").map((c) => ({ key: c.key, label: `${c.label} condition`, untilDay: c.deadlineDay }));
  for (const issue of tx.issues) {
    if (issue.kind === "title" && issue.status === "open" && issue.rightUntilDay !== null && tx.day <= issue.rightUntilDay) options.push({ key: issue.id, label: "Title objection the seller can't answer", untilDay: issue.rightUntilDay });
  }
  return options;
}

function damagesExposure(s: Scenario, tx: Transaction): number {
  const resale = s.groundTruth.marketValue * { hot: 1, balanced: 0.98, cold: 0.95 }[s.market.temperature];
  return Math.round(Math.max(0, tx.terms.price - resale) + tx.terms.price * 0.005);
}

function settlement(s: Scenario, tx: Transaction): Settlement {
  const t = tx.terms;
  const financed = t.financing !== "cash";
  const basis = financed && tx.appraisedValue !== null ? Math.min(t.price, tx.appraisedValue) : t.price;
  const loan = financed ? Math.round(basis * (1 - t.downPaymentPct / 100)) : 0;
  const cmhcPremium = t.financing === "insured" ? Math.round(loan * cmhcPremiumRate(t.downPaymentPct)) : 0;
  const rentalBuyout = t.rentalItemsBuyout ? rentalBuyoutTotal(s) : 0;
  const ltt = landTransferTax(t.price, s.market.torontoMltt, s.buyer.firstTimeBuyer);
  // The seller has usually paid the year's taxes; the buyer reimburses the days after completion.
  const completion = new Date(`${t.completionDate}T12:00:00Z`);
  const yearEnd = new Date(Date.UTC(completion.getUTCFullYear(), 11, 31, 12));
  const propertyTaxAdjustment = Math.round((s.property.annualTaxes * Math.max(0, (yearEnd.getTime() - completion.getTime()) / 86_400_000)) / 365);
  const legal = Math.round(2_000 + t.price * 0.001);
  const downPayment = t.price - loan;
  return {
    completionDate: t.completionDate,
    price: t.price,
    depositApplied: t.deposit,
    priceAdjustments: tx.priceReductions,
    creditsOnClosing: tx.creditsOnClosing,
    repairsBySeller: tx.repairsAgreed,
    rentalBuyout,
    propertyTaxAdjustment,
    landTransferTax: ltt,
    mortgageAmount: loan + cmhcPremium,
    cmhcPremium,
    downPayment,
    buyerLegalAndOtherCosts: legal,
    buyerBalanceDueOnClosing: Math.max(0, downPayment - t.deposit - tx.creditsOnClosing + propertyTaxAdjustment) + ltt.total + legal,
    sellerProceedsBeforeCommission: t.price - tx.creditsOnClosing - tx.repairsAgreed - rentalBuyout + propertyTaxAdjustment - s.seller.mortgagePayoff,
    sellerMortgageDischarge: s.seller.mortgagePayoff,
  };
}

function attemptCompletion(s: Scenario, n: Negotiation, tx: Transaction): void {
  for (const issue of tx.issues) if (issue.status === "open" && (issue.kind === "visit" || issue.kind === "date_change")) closeIssue(s, n, tx, issue, "lapsed");
  const extension = tx.issues.find((i) => i.kind === "extension" && i.status === "open");
  if (extension) {
    if (extension.requester === "buyer") return end(s, n, tx, { kind: "buyer_default", reason: "Completion day arrived, the buyer wasn't ready, and no extension was signed. The buyer is in default.", deposit: "forfeited_to_seller", damagesExposure: damagesExposure(s, tx) });
    return end(s, n, tx, { kind: "seller_default", reason: "Completion day arrived and the seller couldn't give good title, with no extension signed. The seller is in default.", deposit: "returned_to_buyer", damagesExposure: null });
  }
  const title = tx.issues.find((i) => i.kind === "title" && i.status === "open");
  if (title) title.status = "lapsed";
  if (tx.loanStatus === "declined") return end(s, n, tx, { kind: "buyer_default", reason: "The buyer's mortgage was declined after they went firm. They can't complete and are in default.", deposit: "forfeited_to_seller", damagesExposure: damagesExposure(s, tx) });
  if (tx.buyerGapCash > buyerGapAbility(s)) return end(s, n, tx, { kind: "buyer_default", reason: `The buyer couldn't bring the ${money(tx.buyerGapCash)} needed to cover the low appraisal. They can't complete and are in default.`, deposit: "forfeited_to_seller", damagesExposure: damagesExposure(s, tx) });

  tx.status = "closed";
  tx.settlement = settlement(s, tx);
  tx.outcome = { kind: "completed", day: tx.day, reason: "The lawyers exchanged funds and documents and the transfer was registered.", deposit: "applied_on_completion", damagesExposure: null };
  setClock(s, n, tx, 15);
  pushMessage(n, { speaker: "system", text: `Completed! The transfer registered at ${money(tx.terms.price)}, and the seller's lawyer released the keys.`, event: "deal" });
  const surprise = s.groundTruth.visitSurprises[0];
  if (surprise && tx.terms.preClosingVisits === 0) note(s, n, tx, `After moving in, the buyer finds: ${surprise.summary} With no pre-closing visit, there's nothing left to negotiate.`);
}

// ---------- Events ----------

function revealFindings(tx: Transaction, findings: Finding[]): void {
  for (const f of findings) if (!tx.revealedFindingIds.includes(f.id)) tx.revealedFindingIds.push(f.id);
}

function addReport(tx: Transaction, report: Omit<Report, "id" | "day">): void {
  tx.reports.push({ id: randomUUID(), day: tx.day, ...report });
}

function findingsSummary(findings: Finding[]): string {
  const serious = findings.filter((f) => f.severity !== "minor");
  return findings.length ? `${findings.length} item${findings.length > 1 ? "s" : ""}, ${serious.length} significant.` : "Nothing significant.";
}

/** Reports findings found under a condition, and opens a negotiation tied to that condition if it's still open. */
function conditionFindings(s: Scenario, n: Negotiation, tx: Transaction, key: ConditionKey, kind: Report["kind"], title: string, findings: Finding[]): void {
  revealFindings(tx, findings);
  addReport(tx, { kind, title, summary: findings.length ? `${findingsSummary(findings)} Estimated cost ${money(findings.reduce((a, f) => a + f.repairCostLow, 0))} to ${money(findings.reduce((a, f) => a + f.repairCostHigh, 0))}.` : "No concerns.", findings, value: null });
  const condition = pendingCondition(tx, key);
  note(s, n, tx, `${title}: ${findings.length ? `${findingsSummary(findings)} See Reports in the deal file.` : "no concerns."}${findings.length && !condition ? " There's no open condition to negotiate under." : ""}`);
  if (findings.length && condition) {
    openIssue(tx, "repairs", "buyer", {
      title: `${LABELS.repairs} (${title.toLowerCase()})`,
      detail: findings.map((f) => f.title).slice(0, 3).join("; ") + (findings.length > 3 ? "; and more" : ""),
      reference: repairReference(findings, tx.terms.price),
      findingIds: findings.map((f) => f.id),
      deadlineDay: condition.deadlineDay,
      conditionKey: key,
    });
  }
}

/** The lender's appraiser usually supports the price; it comes in low mainly when the buyer overpaid. */
function appraise(s: Scenario, price: number): number {
  const value = s.groundTruth.appraisedValue;
  const tolerance = { clean: 0.05, typical: 0.035, rough: 0.015 }[s.difficulty.eventVolatility];
  if (price > value * (1 + tolerance)) return value;
  if (price >= value) return price;
  return Math.round((price + (value - price) * 0.3) / 1000) * 1000;
}

function fireEvent(s: Scenario, n: Negotiation, tx: Transaction, e: ScheduledEvent): void {
  e.fired = true;
  const gt = s.groundTruth;
  const rng = new Rng(s.seed + e.day * 31 + tx.issues.length);
  const typeFindings = (source: Finding["source"]) => gt.typeSpecificIssues.filter((f) => f.source === source);
  switch (e.kind) {
    case "deposit": {
      tx.depositPaid = true;
      const d = tx.deadlines.find((x) => x.id === "deposit");
      if (d) d.status = "met";
      note(s, n, tx, `The ${money(tx.terms.deposit)} deposit was delivered to the listing brokerage and is held in its trust account.`);
      break;
    }
    case "lawyer_review":
      addReport(tx, { kind: "lawyer", title: "Lawyer's review", summary: "The buyer's lawyer reviewed the agreement and has no concerns.", findings: [], value: null });
      note(s, n, tx, "The buyer's lawyer reviewed the agreement and has no concerns.");
      break;
    case "inspection_report":
      conditionFindings(s, n, tx, "inspection", "inspection", s.property.type === "vacant_land" ? "Due diligence report" : "Home inspection report", [...gt.inspectionFindings.filter((f) => f.source === "home_inspection"), ...typeFindings("home_inspection")]);
      break;
    case "status_certificate":
      conditionFindings(s, n, tx, "status_certificate", "status_certificate", "Status certificate", typeFindings("status_certificate"));
      break;
    case "water_septic":
      conditionFindings(s, n, tx, "water_septic", "water_septic", "Water and septic tests", gt.inspectionFindings.filter((f) => f.source === "water_septic"));
      break;
    case "insurance_quote":
      conditionFindings(s, n, tx, "insurance", "insurance", "Home insurance quote", allFindings(s).filter((f) => f.affectsInsurance));
      break;
    case "lender_appraisal": {
      tx.appraisedValue = appraise(s, tx.terms.price);
      const gap = uncoveredGap(tx);
      addReport(tx, { kind: "appraisal", title: "Lender's appraisal", summary: gap > 0 ? `Appraised at ${money(tx.appraisedValue)}, ${money(gap)} below the ${money(tx.terms.price)} price.` : `Appraised at ${money(tx.appraisedValue)}, supporting the price.`, findings: [], value: tx.appraisedValue });
      if (gap <= 0) {
        note(s, n, tx, `The lender's appraisal came in at ${money(tx.appraisedValue)}. It supports the price.`);
        break;
      }
      const financing = pendingCondition(tx, "financing");
      tx.buyerGapCash = gap;
      note(s, n, tx, `The lender's appraisal came in at ${money(tx.appraisedValue)}, ${money(gap)} short of the price. The lender will only lend against the appraised value.${financing ? "" : " The buyer has no financing condition, so they must make up the difference."}`);
      openIssue(tx, "appraisal", "buyer", { detail: `The lender appraised ${money(gap)} below the price.`, reference: gap, deadlineDay: financing?.deadlineDay ?? null, conditionKey: financing ? "financing" : null });
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
      const resolveChance = event.kind === "mortgage_declined" ? 0.3 : { clean: 0.92, typical: 0.78, rough: 0.55 }[s.difficulty.eventVolatility];
      const resolved = event.severity === "delay" || rng.chance(resolveChance);
      const financing = pendingCondition(tx, "financing");
      if (resolved) {
        note(s, n, tx, `Lender update: ${event.summary} It's workable, but it takes a few more days.`);
        const commitment = tx.schedule.find((x) => x.kind === "mortgage_commitment" && !x.fired);
        if (commitment) commitment.day = Math.max(commitment.day, tx.day + 2);
      } else {
        tx.loanStatus = "declined";
        note(s, n, tx, `Lender update: ${event.summary} The mortgage has been declined.${financing ? ` The financing condition is still open until ${displayDate(dateOf(tx, financing.deadlineDay))}.` : " The buyer is firm, so they must find other financing or default."}`);
        if (financing) openIssue(tx, "loan", "buyer", { detail: event.summary, conditionKey: "financing", deadlineDay: financing.deadlineDay });
      }
      break;
    }
    case "mortgage_commitment":
      if (tx.loanStatus === "declined") break;
      tx.loanStatus = "approved";
      note(s, n, tx, "The buyer's lender issued a mortgage commitment.");
      break;
    case "buyer_home_sold":
      tx.buyerHomeSold = true;
      note(s, n, tx, s.userRole === "buyer_agent" ? "Your buyers' home has sold firm. The sale-of-property condition can now be fulfilled." : "The buyers' agent reports their home has sold firm.");
      break;
    case "client_event": {
      const event = gt.clientEvents[Number(e.ref)];
      if (!event) break;
      if (/push completion back/i.test(event.summary)) {
        openIssue(tx, "date_change", "seller", { detail: event.summary, neededDate: dateOf(tx, tx.closingDay + 5) });
      } else if (/move completion up/i.test(event.summary)) {
        const earlier = dateOf(tx, Math.max(tx.day + 7, tx.closingDay - 7));
        if (earlier < tx.terms.completionDate) openIssue(tx, "date_change", "buyer", { detail: event.summary, neededDate: earlier });
      } else {
        n.announcedEvents.push(`tx-client:${event.summary}`);
      }
      break;
    }
    case "backup_offer": {
      const offer = gt.competingOffers[Number(e.ref)];
      tx.backupOffer = true;
      if (s.userRole === "seller_agent") note(s, n, tx, `Another buyer's agent registered an offer at ${offer ? money(offer.price) : "a similar price"}. It can only be accepted as a backup to this deal.`, "competing_offer");
      const sale = pendingCondition(tx, "sale_of_property");
      if (sale) openIssue(tx, "escape_clause", "seller", { detail: "The seller has another acceptable offer and can trigger the escape clause: the buyer gets 72 hours to waive the sale-of-property condition or the agreement ends.", deadlineDay: tx.day + 3, conditionKey: "sale_of_property" });
      break;
    }
    case "requisition": {
      const issue = gt.titleIssues[0];
      const lawyerFindings = typeFindings("lawyer");
      addReport(tx, { kind: "title", title: "Title search and requisitions", summary: [issue?.summary, ...lawyerFindings.map((f) => f.title)].filter(Boolean).join(" ") || "Title is clear apart from standard registrations.", findings: lawyerFindings, value: null });
      revealFindings(tx, lawyerFindings);
      if (!issue && !lawyerFindings.length) note(s, n, tx, "The buyer's lawyer searched title and found no problems.");
      if (issue?.resolvable) {
        const curedDay = tx.day + issue.daysToResolve;
        if (curedDay >= tx.closingDay - 1) {
          note(s, n, tx, `Title requisition: ${issue.summary} The seller's lawyer needs about ${issue.daysToResolve} days to answer it, past completion.`);
          openIssue(tx, "extension", "seller", { detail: `The seller's lawyer needs about ${issue.daysToResolve} days: ${issue.summary}`, neededDate: dateOf(tx, curedDay + 2) });
        } else {
          note(s, n, tx, `Title requisition: ${issue.summary} The seller's lawyer expects to answer it before completion.`);
        }
      } else if (issue) {
        note(s, n, tx, `Title requisition: ${issue.summary} The seller can't fully answer it.`);
        openIssue(tx, "title", "buyer", { detail: issue.summary, reference: Math.round((tx.terms.price * 0.015) / 250) * 250, rightUntilDay: tx.closingDay - 1 });
      }
      for (const f of lawyerFindings) {
        note(s, n, tx, `Title requisition: ${f.title}`);
        openIssue(tx, "title", "buyer", { detail: f.title, reference: repairReference([f], tx.terms.price), findingIds: [f.id], rightUntilDay: tx.closingDay - 1 });
      }
      if (!tx.conditions.some((c) => c.key === "insurance") && allFindings(s).some((f) => f.affectsInsurance)) note(s, n, tx, "The buyer's insurer will only bind coverage with a surcharge until the wiring or oil tank issue is fixed.");
      break;
    }
    case "pre_closing_visit": {
      const surprise = gt.visitSurprises[0];
      addReport(tx, { kind: "visit", title: "Pre-closing visit", summary: surprise ? surprise.summary : "Everything is as agreed.", findings: [], value: surprise?.costToFix ?? null });
      if (surprise) {
        note(s, n, tx, `Pre-closing visit: ${surprise.summary}`);
        openIssue(tx, "visit", "buyer", { detail: surprise.summary, reference: surprise.costToFix, deadlineDay: tx.closingDay });
      } else {
        note(s, n, tx, "Pre-closing visit: everything is as agreed.");
      }
      break;
    }
    case "completion":
      attemptCompletion(s, n, tx);
      break;
  }
}

/** Applies what happens when deadlines pass before `day`. */
function lapseDeadlines(s: Scenario, n: Negotiation, tx: Transaction, day: number): void {
  for (const c of tx.conditions) {
    if (c.status === "pending" && c.deadlineDay < day) {
      failCondition(s, n, tx, c.key, `The ${c.label.toLowerCase()} condition wasn't waived or fulfilled by ${displayDate(dateOf(tx, c.deadlineDay))}.`);
      return;
    }
  }
  for (const d of tx.deadlines) if (d.status === "upcoming" && d.day < day && d.id !== "completion") d.status = d.id.startsWith("condition:") ? "met" : "passed";
  for (const issue of tx.issues) if (issue.status === "open" && issue.deadlineDay !== null && issue.deadlineDay < day) closeIssue(s, n, tx, issue, "lapsed");
}

export function nextStopDay(tx: Transaction): number | null {
  if (tx.status !== "active") return null;
  const days = [
    ...tx.schedule.filter((e) => !e.fired).map((e) => e.day),
    ...tx.conditions.filter((c) => c.status === "pending").map((c) => c.deadlineDay),
    ...tx.deadlines.filter((d) => d.status === "upcoming").map((d) => d.day),
    ...tx.issues.filter((i) => i.status === "open" && i.deadlineDay !== null).map((i) => i.deadlineDay!),
  ].filter((d) => d > tx.day);
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

/** Whether a condition's results are in, so the buyer can waive or fulfil it. */
export function conditionReady(tx: Transaction, key: ConditionKey): "waived" | "fulfilled" | null {
  if (tx.issues.some((i) => i.status === "open" && i.conditionKey === key)) return null;
  const fired = (kind: ScheduledEvent["kind"]) => tx.schedule.some((e) => e.kind === kind && e.fired);
  switch (key) {
    case "financing":
      return tx.loanStatus === "approved" ? "fulfilled" : null;
    case "inspection":
      return fired("inspection_report") ? "waived" : null;
    case "status_certificate":
      return fired("status_certificate") ? "waived" : null;
    case "water_septic":
      return fired("water_septic") ? "waived" : null;
    case "insurance":
      return fired("insurance_quote") ? "fulfilled" : null;
    case "lawyer_review":
      return fired("lawyer_review") ? "fulfilled" : null;
    case "sale_of_property":
      return tx.buyerHomeSold ? "fulfilled" : null;
  }
}

async function botActs(s: Scenario, n: Negotiation, tx: Transaction, speak: Voice): Promise<void> {
  const bot = botSide(s);
  const waiting = new Set<string>();
  for (let guard = 0; guard < 12 && tx.status === "active"; guard++) {
    const issue = tx.issues.find((i) => botMoveDue(i, bot) && !waiting.has(i.id));
    if (!issue) break;
    const canLetFail = bot === "buyer" && (pendingCondition(tx, issue.conditionKey) !== null || (issue.kind === "title" && issue.rightUntilDay !== null && tx.day <= issue.rightUntilDay));
    let m: BotMove = issue.proposals.length === 0 ? botOpeningRequest(s, tx, issue, botClientNote(n)) : botRespond(s, tx, issue, bot, botClientNote(n), canLetFail);
    if (m.kind === "terminate" && !canLetFail && issue.kind !== "escape_clause") m = { kind: "withdraw", amount: 0, closingDate: null, form: null, reasoning: "No condition left to rely on; proceed." };
    if (issue.kind === "loan" && !canLetFail) m = { kind: "wait", amount: 0, closingDate: null, form: null, reasoning: "No financing condition left; look for another lender." };
    if (m.kind === "wait") {
      waiting.add(issue.id);
      continue;
    }
    const situation = `${issue.title}: ${issue.detail} Price ${money(tx.terms.price)}, completion ${displayDate(tx.terms.completionDate)}.`;
    const text = await speak(s, n, situation, m.reasoning, agentTxDraft({ s, used: (n.usedLines ??= []), seed: s.seed + tx.day * 131 + issue.proposals.length }, issue, m));
    setClock(s, n, tx, 14);
    pushMessage(n, { speaker: "bot", text, action: m.kind === "terminate" || m.kind === "withdraw" ? "walk" : m.kind === "accept" ? "accept" : m.kind === "reject" ? "reject" : "counter" });
    n.botTurns.push({ messageId: n.messages[n.messages.length - 1].id, source: "offline", internalNote: m.reasoning, recommended: "hold", validationIssues: [] });

    if (m.kind === "terminate") {
      if (issue.kind === "title") end(s, n, tx, { kind: "terminated", reason: "The buyer wouldn't waive a valid title objection the seller couldn't answer, so the agreement ends.", deposit: "returned_to_buyer", damagesExposure: null });
      else failCondition(s, n, tx, issue.conditionKey ?? "inspection", `The buyer won't waive the ${conditionLabel(tx, issue.conditionKey ?? "inspection")} condition.`);
      return;
    }
    if (m.kind === "withdraw") {
      closeIssue(s, n, tx, issue, "withdrawn");
      continue;
    }
    const proposal: Proposal = { id: randomUUID(), by: bot, day: tx.day, kind: m.kind, amount: m.amount, closingDate: m.closingDate, form: m.form, note: text };
    if (m.kind === "accept") {
      const theirs = lastFrom(issue, bot === "seller" ? "buyer" : "seller");
      proposal.amount = theirs?.amount ?? m.amount;
      proposal.closingDate = theirs?.closingDate ?? m.closingDate;
      proposal.form = theirs?.form ?? m.form;
      issue.proposals.push(proposal);
      applyAgreement(s, n, tx, issue, proposal);
    } else {
      issue.proposals.push(proposal);
    }
  }

  // The bot's buyer waives or fulfils each condition once its results are in, and asks for more time when the lender is slow.
  if (bot === "buyer" && tx.status === "active") {
    for (const c of tx.conditions) {
      if (c.status !== "pending") continue;
      const ready = conditionReady(tx, c.key);
      if (ready) {
        setClock(s, n, tx, 15);
        pushMessage(n, { speaker: "bot", text: `${ready === "waived" ? "Waiver" : "Notice of Fulfilment"} on the ${c.label.toLowerCase()} condition is attached.`, action: "accept" });
        setCondition(s, n, tx, c.key, ready);
      } else if (c.key === "financing" && c.deadlineDay - tx.day <= 1 && tx.loanStatus === "processing" && !tx.issues.some((i) => i.kind === "condition_extension" && i.conditionKey === "financing")) {
        openIssue(tx, "condition_extension", "buyer", { detail: "The lender hasn't issued the commitment yet.", reference: 3, conditionKey: "financing", deadlineDay: c.deadlineDay });
        await botActs(s, n, tx, speak);
        return;
      }
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
  if (!tx) throw new ActionError("This deal isn't under agreement.");
  if (tx.status !== "active") throw new ActionError("This deal is finished.");
  if (action.type === "client_message" || action.type === "client_review" || action.type === "client_present") return applyTxClientAction(s, n, action);
  const me = userSide(s);
  const them: Side = me === "buyer" ? "seller" : "buyer";
  const text = ("text" in action ? action.text : "")?.trim() ?? "";
  const say = (fallback: string, kind: "message" | "offer" | "accept" | "walk" = "message") => {
    setClock(s, n, tx);
    pushMessage(n, { speaker: "user", text: text || fallback, action: kind });
  };

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
        await txClientTriggers(s, n);
      }
      return;
    }
    case "message": {
      if (!text) throw new ActionError("Write a message first.");
      say(text);
      const open = tx.issues.filter((i) => i.status === "open").map((i) => i.title).join(", ") || "nothing open right now";
      const pending = tx.conditions.filter((c) => c.status === "pending").map((c) => c.label).join(", ") || "none";
      const reply = await speak(s, n, `The other agent says: "${text}". Open items: ${open}. Conditions still pending: ${pending}.`, "Reply helpfully and briefly. Don't change any position or make new offers in this message.", agentTxReply({ s, used: (n.usedLines ??= []), seed: s.seed + n.messages.length * 7 }, text, tx, s.difficulty.withholding));
      setClock(s, n, tx, 13);
      pushMessage(n, { speaker: "bot", text: reply, action: "hold" });
      return;
    }
    case "condition": {
      if (me !== "buyer") throw new ActionError("Only the buyer waives or fulfils conditions.");
      const condition = pendingCondition(tx, action.key);
      if (!condition) throw new ActionError("That condition isn't pending.");
      if (action.how === "fulfil" && action.key === "financing" && tx.loanStatus !== "approved") throw new ActionError("Your buyers don't have a mortgage commitment yet, so the financing condition isn't fulfilled. You can only waive it, and that puts the deposit at risk if the mortgage falls through.");
      if (action.how === "fulfil" && action.key === "sale_of_property" && !tx.buyerHomeSold) throw new ActionError("Your buyers' home hasn't sold yet, so the condition isn't fulfilled.");
      if (action.key === "sale_of_property" && action.how === "waive" && !tx.buyerHomeSold && s.buyer.needsSaleCondition) throw new ActionError("Your buyers won't waive the sale condition before their home sells. They can't carry two properties.");
      requireTxSignature(s, n, action);
      say(`${action.how === "waive" ? "Waiver" : "Notice of Fulfilment"} on the ${condition.label.toLowerCase()} condition is attached.`, "accept");
      setCondition(s, n, tx, action.key, action.how === "waive" ? "waived" : "fulfilled");
      break;
    }
    case "release": {
      if (me !== "buyer") throw new ActionError("Only the buyer can end the deal under a condition.");
      const option = releaseOptions(tx).find((o) => o.key === action.key);
      if (!option) throw new ActionError("That isn't available. Walking away without a condition would put your buyers in default.");
      requireTxSignature(s, n, action);
      say("My buyers won't be waiving. Please have your sellers sign the mutual release.", "walk");
      if (tx.issues.some((i) => i.id === action.key)) end(s, n, tx, { kind: "terminated", reason: "The buyer wouldn't waive a valid title objection the seller couldn't answer, so the agreement ends.", deposit: "returned_to_buyer", damagesExposure: null });
      else failCondition(s, n, tx, action.key as ConditionKey, `The buyer chose not to waive the ${option.label.toLowerCase()}.`);
      return;
    }
    case "request_condition_extension": {
      if (me !== "buyer") throw new ActionError("Only the buyer asks for more time on a condition.");
      const condition = pendingCondition(tx, action.key);
      if (!condition) throw new ActionError("That condition isn't pending.");
      const days = Math.max(1, Math.round(action.days));
      requireTxSignature(s, n, action);
      const issue = openIssue(tx, "condition_extension", "buyer", { detail: text || `More time on the ${condition.label.toLowerCase()} condition.`, reference: days, conditionKey: action.key, deadlineDay: condition.deadlineDay });
      issue.proposals.push({ id: randomUUID(), by: me, day: tx.day, kind: "request", amount: days, closingDate: null, form: null, note: text });
      say(`Can we extend the ${condition.label.toLowerCase()} condition by ${days} banking days?`, "offer");
      break;
    }
    case "request_date_change": {
      const objections = userClientObjections(s, tx, { kind: "date_change", id: "new" }, me, 0, action.closingDate);
      if (objections.length) throw new ActionError("Your clients won't sign that.", objections);
      requireTxSignature(s, n, action);
      const issue = openIssue(tx, "date_change", me, { detail: text || `Move completion to ${displayDate(action.closingDate)}.`, neededDate: action.closingDate });
      issue.proposals.push({ id: randomUUID(), by: me, day: tx.day, kind: "request", amount: 0, closingDate: action.closingDate, form: null, note: text });
      say(`We'd like to move completion to ${displayDate(action.closingDate)}.`, "offer");
      break;
    }
    case "propose": {
      const issue = findIssue(tx, action.issueId);
      if (issue.proposals.length === 0 && issue.requester !== me) throw new ActionError("Wait for the other side's request first.");
      if (issue.proposals.length > 0 && issue.proposals[issue.proposals.length - 1].by === me) throw new ActionError("You've made the latest proposal on this. Wait for their reply.");
      const isDate = isDateIssue(issue);
      if (isDate && !action.closingDate) throw new ActionError("Pick a completion date.");
      const amount = Math.max(0, Math.round(action.amount ?? 0));
      const objections = userClientObjections(s, tx, issue, me, isDate ? 0 : amount, isDate ? action.closingDate! : null);
      if (objections.length) throw new ActionError("Your clients won't sign that.", objections);
      requireTxSignature(s, n, action);
      const form = isMoneyIssue(issue) ? (action.form ?? "price_reduction") : null;
      issue.proposals.push({ id: randomUUID(), by: me, day: tx.day, kind: issue.proposals.length === 0 ? "request" : "counter", amount, closingDate: action.closingDate ?? null, form, note: text });
      const what = isDate ? `completion on ${displayDate(action.closingDate!)}` : issue.kind === "condition_extension" ? `${amount} more banking days` : issue.kind === "escape_clause" ? "notice under the escape clause" : `${money(amount)} ${form === "repairs" ? "in seller repairs" : form === "credit" ? "credit on closing" : "price reduction"}`;
      say(`On ${issue.title.toLowerCase()}: ${what}.`, "offer");
      break;
    }
    case "accept": {
      const issue = findIssue(tx, action.issueId);
      const theirs = lastFrom(issue, them);
      if (!theirs || theirs.kind === "reject" || issue.proposals[issue.proposals.length - 1].by !== them) throw new ActionError("There's no proposal from the other side to accept.");
      if (issue.kind === "escape_clause" && !tx.buyerHomeSold && s.buyer.needsSaleCondition) throw new ActionError("Your buyers can't waive the sale condition before their home sells. They'd be carrying two properties.");
      const objections = userClientObjections(s, tx, issue, me, isMoneyIssue(issue) || issue.kind === "condition_extension" ? theirs.amount : 0, theirs.closingDate);
      if (objections.length) throw new ActionError("Your clients won't sign that.", objections);
      requireTxSignature(s, n, action);
      const proposal: Proposal = { ...theirs, id: randomUUID(), by: me, day: tx.day, kind: "accept", note: text };
      issue.proposals.push(proposal);
      say(issue.kind === "escape_clause" ? "My buyers will waive the sale-of-property condition." : "Agreed. I'll send the amendment.", "accept");
      applyAgreement(s, n, tx, issue, proposal);
      break;
    }
    case "reject": {
      const issue = findIssue(tx, action.issueId);
      const last = issue.proposals[issue.proposals.length - 1];
      if (!last || last.by !== them) throw new ActionError("There's nothing from the other side to decline.");
      if (issue.kind === "escape_clause") throw new ActionError("You can't decline an escape clause notice. Waive the condition, or let the agreement end.");
      issue.proposals.push({ id: randomUUID(), by: me, day: tx.day, kind: "reject", amount: 0, closingDate: null, form: null, note: text });
      say("My clients won't agree to that.");
      break;
    }
    case "withdraw": {
      const issue = findIssue(tx, action.issueId);
      if (issue.requester !== me) throw new ActionError("Only the side that raised this can drop it.");
      say("We'll move forward without it.");
      closeIssue(s, n, tx, issue, "withdrawn");
      break;
    }
  }
  await botActs(s, n, tx, speak);
  await txClientTriggers(s, n);
}

/** The deal timeline, posted once when the agreement is accepted. */
export function contractSignedNote(s: Scenario, n: Negotiation): void {
  const tx = n.transaction;
  if (!tx || tx.day !== 0 || n.messages.some((m) => m.text.startsWith("Agreement timeline"))) return;
  const parts = [`Agreement timeline: accepted ${displayDate(tx.effectiveDate)}, completion ${displayDate(tx.terms.completionDate)}.`];
  for (const d of tx.deadlines) if (d.id !== "completion") parts.push(`${d.label}: ${displayDate(dateOf(tx, d.day))}.`);
  parts.push(tx.conditions.length ? "The deal is conditional until every condition is waived or fulfilled." : "This is a firm deal.");
  pushMessage(n, { speaker: "system", text: parts.join(" ") });
}

// ---------- View ----------

export interface TransactionClientView extends TransactionView {
  today: string;
  closingDateDisplay: string;
  nextStop: { day: number; date: string } | null;
  releaseOptions: ReleaseOption[];
  guidance: Record<string, string>;
  conditionGuidance: Record<string, string>;
  sellerGiveLimit: number | null;
  sellerGiven: number | null;
  deadlineDates: Record<string, string>;
  eventLabels: { day: number; date: string; label: string; done: boolean }[];
}

export function transactionClientView(s: Scenario, tx: Transaction): TransactionClientView {
  const me = userSide(s);
  const guidance: Record<string, string> = {};
  for (const issue of tx.issues) {
    if (issue.status !== "open") continue;
    const cond = pendingCondition(tx, issue.conditionKey);
    const leverage = cond ? ` The ${cond.label.toLowerCase()} condition is open until ${displayDate(dateOf(tx, cond.deadlineDay))}; ${me === "buyer" ? "your buyers can still let it fail" : "the buyers can still let it fail"}.` : "";
    if (isMoneyIssue(issue) && me === "seller") {
      guidance[issue.id] = `Your sellers will give up to ${money(Math.max(0, sellerGiveLimit(s, tx) - sellerGiven(tx, issue.id)))} more to keep this deal together. Estimated value: ${money(issue.reference)}.${leverage}`;
    } else if (issue.kind === "appraisal" && me === "buyer") {
      guidance[issue.id] = `Your buyers can bring up to ${money(buyerGapAbility(s))} in extra cash toward the shortfall.${leverage}`;
    } else if (isMoneyIssue(issue)) {
      guidance[issue.id] = `Estimated value: ${money(issue.reference)}.${leverage}`;
    } else if (isDateIssue(issue)) {
      guidance[issue.id] = `Your clients can complete as late as ${displayDate(latestCloseLimit(s, me))}.${issue.neededDate ? ` The earliest workable date is ${displayDate(issue.neededDate)}.` : ""}`;
    } else if (issue.kind === "escape_clause" && me === "buyer") {
      guidance[issue.id] = tx.buyerHomeSold ? "Your buyers' home has sold, so they can safely waive the condition." : "Your buyers' home hasn't sold. Waiving means they could end up owning two homes, so they won't. If they don't waive in time, the agreement ends and the deposit comes back.";
    } else if (issue.kind === "loan") {
      guidance[issue.id] = cond ? `Let the financing condition fail by ${displayDate(dateOf(tx, cond.deadlineDay))} to get the deposit back.` : "The buyers are firm. If they can't complete, they lose the deposit and may be sued for damages.";
    } else if (issue.kind === "condition_extension") {
      guidance[issue.id] = me === "seller" ? `Your sellers will give at most ${s.seller.boughtElsewhere || tx.backupOffer ? 2 : s.seller.maxConditionDays} more banking days.` : "Extending gives the lender time; the seller doesn't have to agree.";
    }
  }
  const conditionGuidance: Record<string, string> = {};
  if (me === "buyer") {
    for (const c of tx.conditions) {
      if (c.status !== "pending") continue;
      const ready = conditionReady(tx, c.key);
      conditionGuidance[c.key] = ready
        ? c.key === "financing"
          ? "Mortgage commitment received. You can fulfil it."
          : "The results are in. Waive or fulfil it when your buyers are satisfied."
        : c.key === "financing"
          ? "Waiting on the lender. Waiving before the commitment puts the deposit at risk."
          : c.key === "sale_of_property"
            ? "Waiting for your buyers' home to sell."
            : "Waiting on results.";
    }
  }
  const next = nextStopDay(tx);
  const labels: Partial<Record<ScheduledEvent["kind"], string>> = {
    deposit: "Deposit delivered",
    lawyer_review: "Lawyer's review",
    inspection_report: "Home inspection",
    status_certificate: "Status certificate",
    water_septic: "Water and septic tests",
    insurance_quote: "Insurance quote",
    lender_appraisal: "Lender's appraisal",
    mortgage_commitment: "Mortgage commitment",
    pre_closing_visit: "Pre-closing visit",
  };
  const eventLabels = tx.schedule.flatMap((e) => (labels[e.kind] ? [{ day: e.day, date: dateOf(tx, e.day), label: labels[e.kind]!, done: e.fired }] : []));
  const deadlineDates: Record<string, string> = {};
  for (const d of tx.deadlines) deadlineDates[d.id] = dateOf(tx, d.day);
  return {
    ...transactionView(tx),
    today: dateOf(tx, tx.day),
    closingDateDisplay: displayDate(tx.terms.completionDate),
    nextStop: next === null ? null : { day: next, date: dateOf(tx, next) },
    releaseOptions: me === "buyer" ? releaseOptions(tx) : [],
    guidance,
    conditionGuidance,
    sellerGiveLimit: me === "seller" ? sellerGiveLimit(s, tx) : null,
    sellerGiven: me === "seller" ? sellerGiven(tx) : null,
    deadlineDates,
    eventLabels,
  };
}
