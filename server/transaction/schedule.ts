// Builds the deal calendar from the accepted Agreement of Purchase and Sale and the scenario's ground truth.

import type { Scenario } from "../engine/types";
import { Rng } from "../engine/rng";
import { addBankingDays, addDays, isCondo } from "../engine/properties";
import { conditionLabel } from "../narrative/format";
import type { Terms } from "../negotiation/terms";
import type { ConditionState, Deadline, ScheduledEvent, Transaction } from "./types";

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000);
}

export function dateOf(tx: Pick<Transaction, "effectiveDate">, day: number): string {
  return addDays(tx.effectiveDate, day);
}

/** Simulated hours since the scenario started → calendar date (each day starts at 9 AM). */
export function effectiveDateFor(s: Scenario, simHours: number): string {
  return addDays(s.startDate, Math.floor((9 + simHours) / 24));
}

/** Calendar day (from the effective date) of a deadline N banking days after acceptance. */
export function bankingDeadlineDay(effectiveDate: string, bankingDays: number): number {
  return daysBetween(effectiveDate, addBankingDays(effectiveDate, bankingDays));
}

export function createTransaction(s: Scenario, terms: Terms, simHours: number): Transaction {
  const rng = new Rng(s.seed ^ 0x7f4a7c15);
  const effectiveDate = effectiveDateFor(s, simHours);
  const closingDay = Math.max(10, daysBetween(effectiveDate, terms.completionDate));
  const gt = s.groundTruth;
  const financed = terms.financing !== "cash";

  const conditions: ConditionState[] = terms.conditions.map((c) => ({
    key: c.key,
    label: conditionLabel(c.key, s.property.type),
    deadlineDay: Math.min(bankingDeadlineDay(effectiveDate, c.days), closingDay - 3),
    status: "pending",
  }));
  const deadlineOf = (key: string) => conditions.find((c) => c.key === key)?.deadlineDay ?? null;

  const schedule: ScheduledEvent[] = [];
  const add = (day: number, kind: ScheduledEvent["kind"], ref: string | null = null) =>
    schedule.push({ id: `${kind}-${ref ?? schedule.length}`, day: Math.max(1, Math.min(day, closingDay)), kind, ref, fired: false });
  const early = (key: string, preferred: number) => {
    const deadline = deadlineOf(key);
    return deadline === null ? preferred : Math.max(1, Math.min(preferred, deadline - 1));
  };

  add(1, "deposit");
  if (deadlineOf("lawyer_review") !== null) add(early("lawyer_review", 2), "lawyer_review");
  if (deadlineOf("inspection") !== null) add(early("inspection", 2), "inspection_report");
  // A condo's status certificate is reviewed in the condition period if there is one; otherwise the buyer's lawyer gets it before closing.
  if (isCondo(s.property.type) || s.property.potlFee) add(deadlineOf("status_certificate") !== null ? early("status_certificate", 3) : closingDay - 14, "status_certificate");
  if (deadlineOf("water_septic") !== null) add(early("water_septic", 4), "water_septic");
  if (deadlineOf("insurance") !== null) add(early("insurance", 3), "insurance_quote");
  if (financed) {
    add(early("financing", 3), "lender_appraisal");
    for (const e of gt.financing) add(Math.min(e.dayOffset, closingDay - 4), "loan_event", e.id);
    const commitment = early("financing", 4);
    add(Math.max(commitment, ...gt.financing.map((e) => Math.min(e.dayOffset, closingDay - 4) + (e.severity === "nuisance" ? 0 : 1))), "mortgage_commitment");
  }
  if (deadlineOf("sale_of_property") !== null && s.buyer.homeToSell) {
    const sells = s.buyer.homeToSell.status === "sold_firm" ? 1 : rng.chance({ hot: 0.85, balanced: 0.65, cold: 0.45 }[s.market.temperature]) ? rng.int(4, 40) : null;
    if (sells !== null) add(sells, "buyer_home_sold");
  }
  const botSide = s.userRole === "buyer_agent" ? "seller" : "buyer";
  gt.clientEvents.forEach((e, i) => {
    if (e.side !== botSide) return;
    if (e.phase === "conditional" && deadlineOf("inspection") !== null) add(early("inspection", 2), "client_event", String(i));
    if (e.phase === "completion") add(closingDay - 8, "client_event", String(i));
  });
  gt.competingOffers.forEach((o, i) => {
    if (o.phase === "under_contract") add(Math.min(2 + o.arrivesDay, closingDay - 10), "backup_offer", String(i));
  });
  const lastCondition = Math.max(0, ...conditions.map((c) => c.deadlineDay));
  const requisitionDay = Math.max(lastCondition + 1, closingDay - 15);
  add(requisitionDay, "requisition");
  if (terms.preClosingVisits > 0) add(closingDay - 2, "pre_closing_visit");
  add(closingDay, "completion");
  schedule.sort((a, b) => a.day - b.day);

  const deadlines: Deadline[] = [{ id: "deposit", label: "Deposit due (within 24 hours)", day: 1, status: "upcoming", consequence: "The seller can treat the agreement as ended if the deposit isn't paid." }];
  for (const c of conditions) {
    deadlines.push({ id: `condition:${c.key}`, label: `${c.label} condition: waive or fulfil`, day: c.deadlineDay, status: "upcoming", consequence: "If it isn't waived or fulfilled in writing by the deadline, the agreement is null and void and the deposit is returned." });
  }
  deadlines.push({ id: "requisition", label: "Requisition date (title search)", day: requisitionDay, status: "upcoming", consequence: "The buyer's lawyer must submit title requisitions by this date." });
  deadlines.push({ id: "completion", label: "Completion", day: closingDay, status: "upcoming", consequence: "A party who can't complete is in default." });
  deadlines.sort((a, b) => a.day - b.day);

  return {
    effectiveDate,
    day: 0,
    originalTerms: structuredClone(terms),
    terms: structuredClone(terms),
    closingDay,
    conditions,
    firm: conditions.length === 0,
    firmDay: conditions.length === 0 ? 0 : null,
    requisitionDay,
    loanStatus: financed ? "processing" : "n/a",
    depositPaid: false,
    appraisedValue: null,
    buyerGapCash: 0,
    repairsAgreed: 0,
    creditsOnClosing: 0,
    priceReductions: 0,
    buyerHomeSold: s.buyer.homeToSell?.status === "sold_firm",
    backupOffer: false,
    revealedFindingIds: [],
    deadlines,
    issues: [],
    reports: [],
    schedule,
    status: "active",
    outcome: null,
    settlement: null,
  };
}

/** Moves completion, and the visit and completion events with it. */
export function moveClosing(tx: Transaction, newDate: string): void {
  const newDay = daysBetween(tx.effectiveDate, newDate);
  const shift = newDay - tx.closingDay;
  tx.terms.completionDate = newDate;
  tx.closingDay = newDay;
  for (const e of tx.schedule) if (!e.fired && (e.kind === "pre_closing_visit" || e.kind === "completion")) e.day += shift;
  tx.schedule.sort((a, b) => a.day - b.day);
  const completion = tx.deadlines.find((d) => d.id === "completion");
  if (completion) completion.day = newDay;
  tx.deadlines.sort((a, b) => a.day - b.day);
}

/** Extends a condition's deadline by an Amendment. */
export function extendCondition(tx: Transaction, key: string, bankingDays: number): void {
  const condition = tx.conditions.find((c) => c.key === key);
  if (!condition) return;
  const currentDate = dateOf(tx, condition.deadlineDay);
  condition.deadlineDay = Math.min(daysBetween(tx.effectiveDate, addBankingDays(currentDate, bankingDays)), tx.closingDay - 3);
  const deadline = tx.deadlines.find((d) => d.id === `condition:${key}`);
  if (deadline) deadline.day = condition.deadlineDay;
  tx.deadlines.sort((a, b) => a.day - b.day);
}
