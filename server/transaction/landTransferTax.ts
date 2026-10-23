// Ontario land transfer tax, plus Toronto's municipal tax. Rates as of 2026 for homes with one or two
// single-family residences; first-time buyer refunds capped at $4,000 (Ontario) and $4,475 (Toronto).

import type { LandTransferTax } from "./types";

type Bracket = [upTo: number, rate: number];

const ONTARIO: Bracket[] = [
  [55_000, 0.005],
  [250_000, 0.01],
  [400_000, 0.015],
  [2_000_000, 0.02],
  [Infinity, 0.025],
];

// Toronto matches Ontario up to $3M, then adds luxury brackets.
const TORONTO: Bracket[] = [
  [55_000, 0.005],
  [250_000, 0.01],
  [400_000, 0.015],
  [2_000_000, 0.02],
  [3_000_000, 0.025],
  [4_000_000, 0.035],
  [5_000_000, 0.045],
  [10_000_000, 0.055],
  [20_000_000, 0.065],
  [Infinity, 0.075],
];

function bracketTax(price: number, brackets: Bracket[]): number {
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of brackets) {
    if (price <= lower) break;
    tax += (Math.min(price, upTo) - lower) * rate;
    lower = upTo;
  }
  return Math.round(tax);
}

export function landTransferTax(price: number, toronto: boolean, firstTimeBuyer: boolean): LandTransferTax {
  const provincial = bracketTax(price, ONTARIO);
  const municipal = toronto ? bracketTax(price, TORONTO) : 0;
  const firstTimeRebate = firstTimeBuyer ? Math.min(provincial, 4_000) + (toronto ? Math.min(municipal, 4_475) : 0) : 0;
  return { provincial, municipal, firstTimeRebate, total: provincial + municipal - firstTimeRebate };
}

/** CMHC mortgage insurance premium as a share of the loan, by down payment (standard 25-year amortization). */
export function cmhcPremiumRate(downPaymentPct: number): number {
  if (downPaymentPct >= 20) return 0;
  if (downPaymentPct >= 15) return 0.028;
  if (downPaymentPct >= 10) return 0.031;
  return 0.04;
}
