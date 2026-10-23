// The terms of an offer or counteroffer, and helpers to describe and compare them.

import { z } from "zod";
import type { LoanType, Scenario } from "../engine/types";
import { roundPrice } from "../engine/rng";
import { LOAN_LABELS, displayDate, money } from "../narrative/format";

export const LOAN_TYPES = ["cash", "conventional", "fha", "va", "usda", "jumbo"] as const;

export const TermsSchema = z.object({
  price: z.number().describe("Purchase price in dollars."),
  earnestMoney: z.number().describe("Earnest money deposit in dollars."),
  loanType: z.enum(LOAN_TYPES),
  downPaymentPct: z.number(),
  sellerCredit: z.number().describe("Seller-paid credit toward the buyer's closing costs, in dollars."),
  closingDate: z.string().describe("ISO date, YYYY-MM-DD."),
  rentBackDays: z.number().int().describe("Days the seller stays after closing (rent-back). 0 = possession at closing."),
  inspectionDays: z.number().int().nullable().describe("Inspection or option period in days. null = waived."),
  appraisal: z.enum(["full", "gap_coverage", "waived"]).describe("full = buyer can renegotiate or cancel if it appraises low; gap_coverage = buyer covers a shortfall up to appraisalGapCoverage; waived = buyer covers any shortfall."),
  appraisalGapCoverage: z.number().describe("Dollars of appraisal shortfall the buyer will cover. 0 unless appraisal is gap_coverage."),
  financingDays: z.number().int().nullable().describe("Financing contingency in days. null = waived or cash."),
  homeSaleContingency: z.boolean().describe("Purchase depends on the buyer selling their current home."),
  homeWarranty: z.number().describe("Seller-paid home warranty, in dollars. 0 = none."),
  inclusions: z.string().describe("Personal property that conveys, e.g. 'Refrigerator, washer, dryer'."),
  specialTerms: z.array(z.object({ key: z.string(), value: z.string() })).describe("Property-specific terms, keyed by the term keys in the scenario."),
});

export type Terms = z.infer<typeof TermsSchema>;

/** A reasonable first offer from the buyer's side, at list price with standard contingencies. */
export function defaultBuyerTerms(s: Scenario, overrides: Partial<Terms> = {}): Terms {
  const b = s.buyer;
  const price = s.property.listPrice;
  return {
    price,
    earnestMoney: roundPrice((price * s.market.customs.typicalEarnestMoneyPct) / 100),
    loanType: b.loanType,
    downPaymentPct: b.downPaymentPct,
    sellerCredit: 0,
    closingDate: b.idealClose,
    rentBackDays: 0,
    inspectionDays: s.property.type === "land" ? 30 : 10,
    appraisal: b.loanType === "cash" ? "waived" : "full",
    appraisalGapCoverage: 0,
    financingDays: b.loanType === "cash" ? null : 21,
    homeSaleContingency: false,
    homeWarranty: 0,
    inclusions: s.property.type === "land" ? "None" : "Refrigerator, range, dishwasher, microwave",
    specialTerms: s.typeSpecificTerms.map((t) => ({ key: t.key, value: "" })),
    ...overrides,
  };
}

/** Normalizes terms coming from a form or the LLM: rounds money, clears fields that don't apply. */
export function normalizeTerms(t: Terms): Terms {
  const cash = t.loanType === "cash";
  return {
    ...t,
    price: Math.round(t.price),
    earnestMoney: Math.max(0, Math.round(t.earnestMoney)),
    downPaymentPct: cash ? 100 : t.downPaymentPct,
    sellerCredit: Math.max(0, Math.round(t.sellerCredit)),
    rentBackDays: Math.max(0, Math.round(t.rentBackDays)),
    inspectionDays: t.inspectionDays === null ? null : Math.max(0, Math.round(t.inspectionDays)),
    appraisalGapCoverage: t.appraisal === "gap_coverage" ? Math.max(0, Math.round(t.appraisalGapCoverage)) : 0,
    financingDays: cash || t.financingDays === null ? null : Math.max(0, Math.round(t.financingDays)),
    homeWarranty: Math.max(0, Math.round(t.homeWarranty)),
    inclusions: t.inclusions.trim(),
    specialTerms: t.specialTerms.map((x) => ({ key: x.key, value: x.value.trim() })),
  };
}

export interface TermLine {
  key: keyof Terms | `special:${string}`;
  label: string;
  value: string;
}

export function describeTerms(t: Terms, s: Pick<Scenario, "market" | "typeSpecificTerms">): TermLine[] {
  const inspectionLabel = s.market.customs.optionPeriod ? "Option period" : "Inspection";
  const lines: TermLine[] = [
    { key: "price", label: "Price", value: money(t.price) },
    { key: "earnestMoney", label: "Earnest money", value: money(t.earnestMoney) },
    { key: "loanType", label: "Financing", value: t.loanType === "cash" ? "Cash" : `${LOAN_LABELS[t.loanType as LoanType]}, ${t.downPaymentPct}% down` },
    { key: "sellerCredit", label: "Seller credit", value: t.sellerCredit ? money(t.sellerCredit) : "None" },
    { key: "closingDate", label: "Closing", value: displayDate(t.closingDate) },
    { key: "rentBackDays", label: "Possession", value: t.rentBackDays ? `${t.rentBackDays}-day rent-back` : "At closing" },
    { key: "inspectionDays", label: inspectionLabel, value: t.inspectionDays === null ? "Waived" : `${t.inspectionDays} days` },
    {
      key: "appraisal",
      label: "Appraisal",
      value: t.appraisal === "full" ? "Contingent" : t.appraisal === "waived" ? "Waived" : `Buyer covers gap up to ${money(t.appraisalGapCoverage)}`,
    },
    { key: "financingDays", label: "Financing contingency", value: t.loanType === "cash" ? "n/a (cash)" : t.financingDays === null ? "Waived" : `${t.financingDays} days` },
    { key: "homeSaleContingency", label: "Home sale contingency", value: t.homeSaleContingency ? "Yes" : "No" },
    { key: "homeWarranty", label: "Home warranty", value: t.homeWarranty ? `${money(t.homeWarranty)}, seller paid` : "None" },
    { key: "inclusions", label: "Inclusions", value: t.inclusions || "None" },
  ];
  for (const term of s.typeSpecificTerms) {
    const value = t.specialTerms.find((x) => x.key === term.key)?.value;
    lines.push({ key: `special:${term.key}`, label: term.label, value: value || "Not addressed" });
  }
  return lines;
}

/** Keys of the lines that differ between two sets of terms. */
export function changedKeys(before: Terms | null, after: Terms, s: Pick<Scenario, "market" | "typeSpecificTerms">): string[] {
  if (!before) return [];
  const a = describeTerms(before, s);
  const b = describeTerms(after, s);
  return b.filter((line, i) => line.value !== a[i]?.value).map((line) => line.key);
}

export function termsEqual(a: Terms, b: Terms): boolean {
  return JSON.stringify(normalizeTerms(a)) === JSON.stringify(normalizeTerms(b));
}

export function termsSummary(t: Terms, s: Pick<Scenario, "market" | "typeSpecificTerms">): string {
  return describeTerms(t, s)
    .map((l) => `${l.label}: ${l.value}`)
    .join("; ");
}
