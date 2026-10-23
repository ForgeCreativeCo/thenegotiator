// Whether a client will sign a set of terms. These rules are the hard limits from each client's brief,
// enforced in code for the opposing agent's client and for the user's own client.

import type { BuyerBrief, Scenario, SellerBrief, Side } from "../engine/types";
import { roundPrice } from "../engine/rng";
import { LOAN_LABELS, money } from "../narrative/format";
import type { Terms } from "./terms";

export const LIMITS = {
  maxInspectionDays: 21,
  maxInspectionDaysLand: 45,
  maxFinancingDays: 30,
  maxRentBackDays: 60,
  minEarnestMoneyPct: 0.5,
};

/** Seller's net before closing costs: price minus everything the seller pays to the buyer. */
export function sellerNet(t: Terms): number {
  return t.price - t.sellerCredit - t.homeWarranty;
}

/** Buyer's effective price: price minus credits received. */
export function buyerNet(t: Terms): number {
  return t.price - t.sellerCredit;
}

/** Lender cap on seller credits as a percent of price. */
export function maxCreditPct(loanType: Terms["loanType"]): number {
  return { cash: 100, conventional: 3, jumbo: 3, fha: 6, usda: 6, va: 4 }[loanType];
}

export function sellerViolations(s: SellerBrief, t: Terms, scenario: Scenario): string[] {
  const v: string[] = [];
  if (sellerNet(t) < s.reservationPrice) v.push(`Net to seller is ${money(sellerNet(t))}, below their floor of ${money(s.reservationPrice)}`);
  if (t.sellerCredit + t.homeWarranty > s.maxConcessions) v.push(`Seller credits and warranty total ${money(t.sellerCredit + t.homeWarranty)}, more than the ${money(s.maxConcessions)} they'll give`);
  if (t.closingDate < s.earliestClose || t.closingDate > s.latestClose) v.push(`Closing on ${t.closingDate} is outside the seller's window (${s.earliestClose} to ${s.latestClose})`);
  if (s.needsRentBackDays > 0 && t.rentBackDays < s.needsRentBackDays) v.push(`Seller needs a ${s.needsRentBackDays}-day rent-back`);
  if (!s.acceptableLoanTypes.includes(t.loanType)) v.push(`Seller won't accept ${LOAN_LABELS[t.loanType]} financing`);
  if (t.homeSaleContingency && !s.acceptsHomeSaleContingency) v.push("Seller won't accept a home sale contingency");
  if (t.earnestMoney < (t.price * LIMITS.minEarnestMoneyPct) / 100) v.push(`Earnest money under ${LIMITS.minEarnestMoneyPct}% of price is too thin for the seller`);
  const maxInspection = scenario.property.type === "land" ? LIMITS.maxInspectionDaysLand : LIMITS.maxInspectionDays;
  if (t.inspectionDays !== null && t.inspectionDays > maxInspection) v.push(`Seller won't give more than ${maxInspection} days for inspections`);
  if (t.financingDays !== null && t.financingDays > LIMITS.maxFinancingDays) v.push(`Seller won't give more than ${LIMITS.maxFinancingDays} days for financing`);
  return v;
}

export function buyerViolations(b: BuyerBrief, t: Terms): string[] {
  const v: string[] = [];
  if (buyerNet(t) > b.reservationPrice) v.push(`Price net of credits is ${money(buyerNet(t))}, above the buyer's ceiling of ${money(b.reservationPrice)}`);
  if (b.preapprovalAmount !== null && t.price > b.preapprovalAmount) v.push(`Price is above the buyer's ${money(b.preapprovalAmount)} pre-approval`);
  if (t.loanType !== b.loanType) v.push(`Buyer is financing with ${LOAN_LABELS[b.loanType]}, not ${LOAN_LABELS[t.loanType]}`);
  if (t.loanType !== "cash" && t.downPaymentPct !== b.downPaymentPct) v.push(`Buyer is putting ${b.downPaymentPct}% down`);
  if (t.sellerCredit > (t.price * maxCreditPct(t.loanType)) / 100) v.push(`Lender caps seller credits at ${maxCreditPct(t.loanType)}% of price`);
  if (t.closingDate < b.earliestClose || t.closingDate > b.latestClose) v.push(`Closing on ${t.closingDate} is outside the buyer's window (${b.earliestClose} to ${b.latestClose})`);
  if (t.rentBackDays > LIMITS.maxRentBackDays) v.push(`Buyer won't allow a rent-back longer than ${LIMITS.maxRentBackDays} days`);
  if (t.inspectionDays === null && !b.willingToWaive.includes("inspection")) v.push("Buyer won't waive the inspection");
  if (t.appraisal === "waived" && t.loanType !== "cash" && !b.willingToWaive.includes("appraisal")) v.push("Buyer won't waive the appraisal contingency");
  if (t.appraisal === "gap_coverage" && t.appraisalGapCoverage > b.maxAppraisalGapCoverage) v.push(`Buyer can cover at most ${money(b.maxAppraisalGapCoverage)} of an appraisal gap`);
  if (t.loanType !== "cash" && t.financingDays === null && !b.willingToWaive.includes("financing")) v.push("Buyer won't waive the financing contingency");
  const cashAvailable = (t.price * (t.loanType === "cash" ? 0 : b.downPaymentPct)) / 100 + b.cashReserves;
  if (t.loanType !== "cash" && t.earnestMoney > cashAvailable) v.push(`Earnest money exceeds the buyer's available cash (${money(cashAvailable)})`);
  return v;
}

export function violations(side: Side, scenario: Scenario, t: Terms): string[] {
  return side === "seller" ? sellerViolations(scenario.seller, t, scenario) : buyerViolations(scenario.buyer, t);
}

/**
 * Adjusts every non-price term the minimum amount needed for this client to sign.
 * Price is left alone; the strategy sets it.
 */
export function repairTerms(side: Side, scenario: Scenario, input: Terms): Terms {
  const t: Terms = { ...input, specialTerms: input.specialTerms.map((x) => ({ ...x })) };
  if (side === "seller") {
    const s = scenario.seller;
    if (t.closingDate < s.earliestClose) t.closingDate = s.earliestClose;
    if (t.closingDate > s.latestClose) t.closingDate = s.latestClose;
    if (s.needsRentBackDays > t.rentBackDays) t.rentBackDays = s.needsRentBackDays;
    if (t.homeSaleContingency && !s.acceptsHomeSaleContingency) t.homeSaleContingency = false;
    const maxInspection = scenario.property.type === "land" ? LIMITS.maxInspectionDaysLand : LIMITS.maxInspectionDays;
    if (t.inspectionDays !== null && t.inspectionDays > maxInspection) t.inspectionDays = maxInspection;
    if (t.financingDays !== null && t.financingDays > LIMITS.maxFinancingDays) t.financingDays = LIMITS.maxFinancingDays;
    if (t.homeWarranty > s.maxConcessions) t.homeWarranty = 0;
    if (t.sellerCredit + t.homeWarranty > s.maxConcessions) t.sellerCredit = Math.max(0, s.maxConcessions - t.homeWarranty);
    const minEm = roundPrice((t.price * 1) / 100);
    if (t.earnestMoney < (t.price * LIMITS.minEarnestMoneyPct) / 100) t.earnestMoney = minEm;
  } else {
    const b = scenario.buyer;
    t.loanType = b.loanType;
    t.downPaymentPct = b.downPaymentPct;
    if (b.loanType === "cash") t.financingDays = null;
    if (t.closingDate < b.earliestClose) t.closingDate = b.earliestClose;
    if (t.closingDate > b.latestClose) t.closingDate = b.latestClose;
    if (t.rentBackDays > LIMITS.maxRentBackDays) t.rentBackDays = LIMITS.maxRentBackDays;
    if (t.inspectionDays === null && !b.willingToWaive.includes("inspection")) t.inspectionDays = 10;
    if (t.appraisal === "waived" && b.loanType !== "cash" && !b.willingToWaive.includes("appraisal")) t.appraisal = b.maxAppraisalGapCoverage > 0 ? "gap_coverage" : "full";
    if (t.appraisal === "gap_coverage") t.appraisalGapCoverage = Math.min(t.appraisalGapCoverage || b.maxAppraisalGapCoverage, b.maxAppraisalGapCoverage);
    if (t.appraisal === "gap_coverage" && t.appraisalGapCoverage === 0) t.appraisal = "full";
    if (b.loanType !== "cash" && t.financingDays === null && !b.willingToWaive.includes("financing")) t.financingDays = 21;
    const maxCredit = Math.floor((t.price * maxCreditPct(t.loanType)) / 100);
    if (t.sellerCredit > maxCredit) t.sellerCredit = maxCredit;
    const cashAvailable = (t.price * (t.loanType === "cash" ? 0 : b.downPaymentPct)) / 100 + b.cashReserves;
    if (t.loanType !== "cash" && t.earnestMoney > cashAvailable) t.earnestMoney = Math.floor(cashAvailable / 100) * 100;
  }
  return t;
}

/**
 * Repairs the terms for this side and sets the price so the side's net lands on `net`.
 * For a financed buyer, credits are trimmed if grossing up the price would exceed the pre-approval.
 */
export function setNet(side: Side, scenario: Scenario, input: Terms, net: number): Terms {
  // Credit caps and earnest money depend on price, so settle the two together.
  let t = repairTerms(side, scenario, input);
  for (let i = 0; i < 3; i++) {
    t.price = priceForNet(side, t, net);
    t = repairTerms(side, scenario, t);
  }
  t.price = priceForNet(side, t, net);
  const preapproval = scenario.buyer.preapprovalAmount;
  if (side === "buyer" && preapproval !== null && t.price > preapproval) {
    t.sellerCredit = Math.max(0, preapproval - net);
    t.price = priceForNet(side, t, net);
  }
  return t;
}

/** The price this side would put on the given terms to land exactly at a target net. */
export function priceForNet(side: Side, t: Terms, net: number): number {
  return side === "seller" ? net + t.sellerCredit + t.homeWarranty : net + t.sellerCredit;
}

export function netFor(side: Side, t: Terms): number {
  return side === "seller" ? sellerNet(t) : buyerNet(t);
}
