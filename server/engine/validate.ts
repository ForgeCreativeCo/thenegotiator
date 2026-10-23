// Consistency checks for generated scenarios. Returns a list of problems; empty = valid.

import type { Narrative, ScenarioParams } from "./types";

export function validateParams(p: ScenarioParams): string[] {
  const problems: string[] = [];
  const { seller, buyer, difficulty, property, groundTruth } = p;
  const zopa = buyer.reservationPrice - seller.reservationPrice;

  if (difficulty.dealSpace === "none" && zopa >= 0) problems.push(`Deal space is "none" but buyer max ${buyer.reservationPrice} >= seller min ${seller.reservationPrice}`);
  if (difficulty.dealSpace !== "none" && zopa < 0) problems.push(`Deal space is "${difficulty.dealSpace}" but buyer max ${buyer.reservationPrice} < seller min ${seller.reservationPrice}`);
  if (seller.mortgagePayoff >= seller.reservationPrice) problems.push("Seller's mortgage payoff exceeds their reservation price");
  if (buyer.preapprovalAmount !== null && buyer.preapprovalAmount < buyer.reservationPrice) problems.push("Buyer's pre-approval is below their reservation price");
  if (property.listPrice <= 0) problems.push("List price must be positive");
  if (groundTruth.appraisedValue <= 0) problems.push("Appraised value must be positive");

  for (const brief of [seller, buyer]) {
    if (!(brief.earliestClose <= brief.idealClose && brief.idealClose <= brief.latestClose)) problems.push(`${brief.side} closing dates are out of order`);
    const weightSum = Object.values(brief.preferences).reduce((a, b) => a + b, 0);
    if (Math.abs(weightSum - 1) > 0.01) problems.push(`${brief.side} preference weights sum to ${weightSum}`);
  }
  if (difficulty.dealSpace !== "none" && (seller.latestClose < buyer.earliestClose || buyer.latestClose < seller.earliestClose)) {
    problems.push("Closing windows do not overlap even though a deal should be possible");
  }
  return problems;
}

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(k|K|m|M|million)?/g;

/** Every dollar amount the story is allowed to mention. */
export function allowedAmounts(p: ScenarioParams): number[] {
  const amounts: number[] = [
    p.property.listPrice,
    p.property.originalListPrice,
    p.property.annualTaxes,
    p.market.medianPrice,
    ...p.property.priceHistory.map((h) => h.price),
    ...p.comps.map((c) => c.soldPrice),
  ];
  if (p.property.hoa) amounts.push(p.property.hoa.monthlyDues);
  for (const unit of p.property.units ?? []) if (unit.monthlyRent) amounts.push(unit.monthlyRent);
  for (const value of Object.values(p.property.extras)) if (typeof value === "number") amounts.push(value);
  for (const brief of [p.seller, p.buyer]) {
    amounts.push(brief.reservationPrice);
    if (brief.side === "seller") amounts.push(brief.mortgagePayoff, brief.maxConcessions);
    else {
      amounts.push(brief.cashReserves, brief.maxAppraisalGapCoverage);
      if (brief.preapprovalAmount) amounts.push(brief.preapprovalAmount);
      if (brief.homeToSell) amounts.push(brief.homeToSell.equity);
    }
  }
  return amounts;
}

function parseAmount(digits: string, suffix: string | undefined): number {
  const base = Number(digits.replace(/,/g, ""));
  if (!suffix) return base;
  return suffix.toLowerCase() === "k" ? base * 1_000 : base * 1_000_000;
}

/**
 * The story must not invent numbers. Small amounts (under $2,500) are allowed freely,
 * since stories mention things like a $300 utility bill; larger amounts must be within 1.5%
 * of a number the engine generated, or of a generated amount scaled for "k"/"million" shorthand.
 */
export function findInventedAmounts(narrative: Narrative, p: ScenarioParams): string[] {
  const allowed = allowedAmounts(p);
  const text = JSON.stringify(narrative);
  const invented: string[] = [];
  for (const match of text.matchAll(MONEY)) {
    const value = parseAmount(match[1], match[2]);
    if (value < 2_500) continue;
    const ok = allowed.some((a) => Math.abs(a - value) <= Math.max(a * 0.015, 1_000));
    if (!ok) invented.push(match[0].trim());
  }
  return invented;
}
