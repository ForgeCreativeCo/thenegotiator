// The deal after mutual acceptance: contract terms, calendar, contingencies, issues and reports.

import type { Finding, Side } from "../engine/types";
import type { Terms } from "../negotiation/terms";

export type IssueKind =
  | "repairs" // inspection or due-diligence findings
  | "appraisal" // appraisal came in below price
  | "title" // a title defect the seller can't cure
  | "walkthrough" // damage or missing items at the final walkthrough
  | "extension" // move the closing date because something isn't ready
  | "date_change" // a client wants a different closing date
  | "possession" // seller wants extra days after closing
  | "loan" // the loan was denied; buyer decides whether to terminate
  | "kickout"; // seller got another offer; buyer must remove the home-sale contingency or release

/** For money issues: dollars the seller gives. For date issues: a new closing date. For possession: days. */
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
  /** The fair-value reference for money issues (repair estimate, appraisal gap, damage cost). */
  reference: number;
  /** Earliest workable closing date for extension issues. */
  neededDate: string | null;
  findingIds: string[];
  /** While this issue is open, the buyer may terminate under a contingency until this day. */
  rightUntilDay: number | null;
}

export type ContingencyState = "active" | "removed" | "waived" | "expired" | "satisfied" | "n/a";

export interface Deadline {
  id: string;
  label: string;
  day: number;
  status: "upcoming" | "met" | "passed";
  /** What happens when it passes with no action. */
  consequence: string;
}

export interface ScheduledEvent {
  id: string;
  day: number;
  kind:
    | "earnest_money"
    | "inspection_report"
    | "hoa_documents"
    | "title_commitment"
    | "appraisal"
    | "loan_event"
    | "clear_to_close"
    | "client_event"
    | "backup_offer"
    | "walkthrough"
    | "closing";
  ref: string | null; // id of the ground-truth item this event reveals
  fired: boolean;
}

export interface Report {
  id: string;
  day: number;
  kind: "inspection" | "hoa_documents" | "appraisal" | "title" | "loan" | "walkthrough";
  title: string;
  summary: string;
  findings: Finding[];
  value: number | null;
}

export interface Settlement {
  closingDate: string;
  price: number;
  sellerCredits: number;
  homeWarranty: number;
  sellerNetBeforeCosts: number;
  sellerMortgagePayoff: number;
  sellerProceedsEstimate: number;
  loanAmount: number;
  downPayment: number;
  buyerClosingCostsEstimate: number;
  earnestMoneyApplied: number;
  buyerCashToClose: number;
  repairsAgreed: number;
}

export interface Outcome {
  kind: "closed" | "terminated" | "buyer_default" | "seller_default";
  day: number;
  reason: string;
  earnestMoney: "applied_at_closing" | "returned_to_buyer" | "released_to_seller";
}

export interface Transaction {
  effectiveDate: string;
  day: number;
  originalTerms: Terms;
  terms: Terms;
  closingDay: number;
  contingencies: { inspection: ContingencyState; appraisal: ContingencyState; financing: ContingencyState; homeSale: ContingencyState };
  inspectionDeadlineDay: number | null;
  appraisalDeadlineDay: number | null;
  financingDeadlineDay: number | null;
  loanStatus: "n/a" | "processing" | "conditional" | "denied" | "clear_to_close";
  earnestMoneyDeposited: boolean;
  appraisedValue: number | null;
  /** Dollars of appraisal shortfall the buyer has agreed to bring as extra cash. */
  buyerGapCash: number;
  repairsAgreed: number;
  backupOffer: boolean;
  /** Findings revealed to both sides so far. */
  revealedFindingIds: string[];
  deadlines: Deadline[];
  issues: Issue[];
  reports: Report[];
  /** Private to the server: the schedule of upcoming events (it reveals what's coming). */
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
