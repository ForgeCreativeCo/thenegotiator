// The deal after acceptance: conditional period, firm, requisitions, pre-closing visits, completion.

import type { ConditionKey, Finding, Side } from "../engine/types";
import type { Terms } from "../negotiation/terms";

export type IssueKind =
  | "repairs" // findings from inspection, status certificate, water/septic, or the insurer, negotiated before waiving
  | "appraisal" // the lender's appraisal came in below the price
  | "condition_extension" // buyer asks for more time on a condition (Amendment)
  | "loan" // mortgage declined; buyer decides whether to let the financing condition fail
  | "escape_clause" // seller has another offer; buyer must waive the sale condition within 72 hours
  | "title" // a title requisition the seller can't answer
  | "visit" // damage or missing chattels found on a pre-closing visit
  | "extension" // move completion because something isn't ready (Amendment)
  | "date_change"; // a client wants a different completion date (Amendment)

/** For money issues: dollars the seller gives. For date issues: a new completion date. For condition extensions: banking days added. */
export interface Proposal {
  id: string;
  by: Side;
  day: number;
  kind: "request" | "counter" | "accept" | "reject";
  amount: number;
  closingDate: string | null;
  form: "credit" | "price_reduction" | "repairs" | null;
  note: string;
}

export interface Issue {
  id: string;
  kind: IssueKind;
  title: string;
  detail: string;
  requester: Side;
  responder: Side;
  openedDay: number;
  deadlineDay: number | null;
  status: "open" | "agreed" | "declined" | "lapsed" | "withdrawn";
  proposals: Proposal[];
  reference: number;
  neededDate: string | null;
  findingIds: string[];
  /** The condition this issue is negotiated under; the buyer can let that condition fail instead. */
  conditionKey: ConditionKey | null;
  /** Kept for title objections, where the buyer can end the deal without a condition. */
  rightUntilDay: number | null;
}

export interface ConditionState {
  key: ConditionKey;
  label: string;
  deadlineDay: number;
  status: "pending" | "waived" | "fulfilled" | "failed";
}

export interface Deadline {
  id: string;
  label: string;
  day: number;
  status: "upcoming" | "met" | "passed";
  consequence: string;
}

export interface ScheduledEvent {
  id: string;
  day: number;
  kind:
    | "deposit"
    | "lawyer_review"
    | "inspection_report"
    | "status_certificate"
    | "water_septic"
    | "insurance_quote"
    | "lender_appraisal"
    | "loan_event"
    | "mortgage_commitment"
    | "buyer_home_sold"
    | "client_event"
    | "backup_offer"
    | "requisition"
    | "pre_closing_visit"
    | "completion";
  ref: string | null;
  fired: boolean;
}

export interface Report {
  id: string;
  day: number;
  kind: "inspection" | "status_certificate" | "water_septic" | "insurance" | "appraisal" | "loan" | "title" | "visit" | "lawyer";
  title: string;
  summary: string;
  findings: Finding[];
  value: number | null;
}

export interface LandTransferTax {
  provincial: number;
  municipal: number;
  firstTimeRebate: number;
  total: number;
}

export interface Settlement {
  completionDate: string;
  price: number;
  depositApplied: number;
  priceAdjustments: number;
  creditsOnClosing: number;
  repairsBySeller: number;
  rentalBuyout: number;
  propertyTaxAdjustment: number;
  landTransferTax: LandTransferTax;
  mortgageAmount: number;
  cmhcPremium: number;
  downPayment: number;
  buyerLegalAndOtherCosts: number;
  buyerBalanceDueOnClosing: number;
  sellerProceedsBeforeCommission: number;
  sellerMortgageDischarge: number;
}

export interface Outcome {
  kind: "completed" | "void" | "terminated" | "buyer_default" | "seller_default";
  day: number;
  reason: string;
  deposit: "applied_on_completion" | "returned_to_buyer" | "forfeited_to_seller";
  /** For a buyer default: what the seller could claim on top of the deposit (resale shortfall and carrying costs). */
  damagesExposure: number | null;
}

export interface Transaction {
  effectiveDate: string;
  day: number;
  originalTerms: Terms;
  terms: Terms;
  closingDay: number;
  conditions: ConditionState[];
  firm: boolean;
  firmDay: number | null;
  requisitionDay: number;
  loanStatus: "n/a" | "processing" | "declined" | "approved";
  depositPaid: boolean;
  appraisedValue: number | null;
  /** Extra cash the buyer must bring because the lender appraised below the price. */
  buyerGapCash: number;
  repairsAgreed: number;
  creditsOnClosing: number;
  priceReductions: number;
  buyerHomeSold: boolean;
  backupOffer: boolean;
  revealedFindingIds: string[];
  deadlines: Deadline[];
  issues: Issue[];
  reports: Report[];
  /** Private to the server: the upcoming events reveal what's coming. */
  schedule: ScheduledEvent[];
  status: "active" | "closed" | "terminated";
  outcome: Outcome | null;
  settlement: Settlement | null;
}

export type TransactionView = Omit<Transaction, "schedule">;

export function transactionView(t: Transaction): TransactionView {
  const { schedule: _schedule, ...rest } = t;
  return rest;
}
