// Builds the contract calendar from the accepted terms and the scenario's ground truth.

import type { Scenario } from "../engine/types";
import { Rng } from "../engine/rng";
import { addDays } from "../engine/properties";
import type { Terms } from "../negotiation/terms";
import type { Deadline, ScheduledEvent, Transaction } from "./types";

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000);
}

export function dateOf(tx: Pick<Transaction, "effectiveDate">, day: number): string {
  return addDays(tx.effectiveDate, day);
}

/** Simulated hours since the scenario started → calendar date (the day starts at 9 AM). */
export function effectiveDateFor(s: Scenario, simHours: number): string {
  return addDays(s.startDate, Math.floor((9 + simHours) / 24));
}

const HOA_TYPES = new Set(["condo", "townhouse", "co_op"]);

export function createTransaction(s: Scenario, terms: Terms, simHours: number): Transaction {
  const rng = new Rng(s.seed ^ 0x7f4a7c15);
  const effectiveDate = effectiveDateFor(s, simHours);
  const closingDay = Math.max(7, daysBetween(effectiveDate, terms.closingDate));
  const financed = terms.loanType !== "cash";
  const gt = s.groundTruth;

  const inspectionDeadlineDay = terms.inspectionDays;
  const hasAppraisal = financed || terms.appraisal !== "waived";
  const appraisalDay = hasAppraisal ? Math.max(5, Math.min(rng.int(12, 18), closingDay - 6)) : null;
  const appraisalDeadlineDay = appraisalDay !== null && terms.appraisal !== "waived" ? Math.min(appraisalDay + 4, closingDay - 2) : null;
  const financingDeadlineDay = financed && terms.financingDays !== null ? Math.min(terms.financingDays, closingDay - 1) : null;

  const schedule: ScheduledEvent[] = [];
  const add = (day: number, kind: ScheduledEvent["kind"], ref: string | null = null) =>
    schedule.push({ id: `${kind}-${ref ?? schedule.length}`, day: Math.max(1, Math.min(day, closingDay)), kind, ref, fired: false });

  add(2, "earnest_money");
  if (inspectionDeadlineDay !== null) add(Math.max(2, Math.min(inspectionDeadlineDay - 3, 5)), "inspection_report");
  else if (HOA_TYPES.has(s.property.type)) add(5, "hoa_documents");
  add(Math.min(10, closingDay - 10), "title_commitment");
  if (appraisalDay !== null) add(appraisalDay, "appraisal");
  if (financed) for (const e of gt.financing) add(Math.min(e.dayOffset, closingDay - 2), "loan_event", e.id);
  if (financed) add(closingDay - 3, "clear_to_close");
  const botSide = s.userRole === "buyer_agent" ? "seller" : "buyer";
  gt.clientEvents.forEach((e, i) => {
    if (e.side !== botSide) return;
    if (e.phase === "inspection" && inspectionDeadlineDay !== null) add(Math.max(2, Math.min(inspectionDeadlineDay - 3, 5)), "client_event", String(i));
    if (e.phase === "closing") add(closingDay - 6, "client_event", String(i));
  });
  gt.competingOffers.forEach((o, i) => {
    if (o.phase === "under_contract") add(Math.min(3 + o.arrivesDay, closingDay - 8), "backup_offer", String(i));
  });
  add(closingDay - 1, "walkthrough");
  add(closingDay, "closing");
  schedule.sort((a, b) => a.day - b.day);

  const deadlines: Deadline[] = [{ id: "earnest_money", label: "Earnest money due", day: 3, status: "upcoming", consequence: "Buyer is in default if it isn't deposited." }];
  if (inspectionDeadlineDay !== null)
    deadlines.push({ id: "inspection", label: s.market.customs.optionPeriod ? "Option period ends" : "Inspection period ends", day: inspectionDeadlineDay, status: "upcoming", consequence: "Buyer accepts the property as-is and loses the right to cancel for condition." });
  if (appraisalDeadlineDay !== null)
    deadlines.push({ id: "appraisal", label: "Appraisal contingency ends", day: appraisalDeadlineDay, status: "upcoming", consequence: "Buyer must close at the contract price even if the appraisal is low." });
  if (financingDeadlineDay !== null)
    deadlines.push({ id: "financing", label: "Financing contingency ends", day: financingDeadlineDay, status: "upcoming", consequence: "If the loan falls through after this, the buyer's earnest money is at risk." });
  deadlines.push({ id: "closing", label: "Closing", day: closingDay, status: "upcoming", consequence: "Whoever can't perform is in default." });
  deadlines.sort((a, b) => a.day - b.day);

  return {
    effectiveDate,
    day: 0,
    originalTerms: structuredClone(terms),
    terms: structuredClone(terms),
    closingDay,
    contingencies: {
      inspection: inspectionDeadlineDay === null ? "waived" : "active",
      appraisal: !hasAppraisal ? "n/a" : terms.appraisal === "waived" ? "waived" : "active",
      financing: !financed ? "n/a" : terms.financingDays === null ? "waived" : "active",
      homeSale: terms.homeSaleContingency ? "active" : "n/a",
    },
    inspectionDeadlineDay,
    appraisalDeadlineDay,
    financingDeadlineDay,
    loanStatus: financed ? "processing" : "n/a",
    earnestMoneyDeposited: false,
    appraisedValue: null,
    buyerGapCash: 0,
    repairsAgreed: 0,
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

/** Moves the closing date, and the walkthrough, clear-to-close and closing events with it. */
export function moveClosing(tx: Transaction, newDate: string): void {
  const newDay = daysBetween(tx.effectiveDate, newDate);
  const shift = newDay - tx.closingDay;
  tx.terms.closingDate = newDate;
  tx.closingDay = newDay;
  for (const e of tx.schedule) {
    if (!e.fired && (e.kind === "walkthrough" || e.kind === "closing" || e.kind === "clear_to_close")) e.day += shift;
  }
  tx.schedule.sort((a, b) => a.day - b.day);
  const closing = tx.deadlines.find((d) => d.id === "closing");
  if (closing) closing.day = newDay;
  tx.deadlines.sort((a, b) => a.day - b.day);
}
