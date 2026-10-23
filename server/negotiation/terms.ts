// The terms of an offer or sign-back, modelled on the structure of the OREA Agreement of Purchase and Sale.

import { z } from "zod";
import type { ConditionKey, Scenario } from "../engine/types";
import { isCondo } from "../engine/properties";
import { roundPrice } from "../engine/rng";
import { FINANCING_LABELS, conditionLabel, displayDate, money } from "../narrative/format";

export const FINANCING_TYPES = ["cash", "insured", "conventional", "alternative"] as const;
export const CONDITION_KEYS = ["financing", "inspection", "status_certificate", "lawyer_review", "insurance", "sale_of_property", "water_septic"] as const;

export const TermsSchema = z.object({
  price: z.number().describe("Purchase price in Canadian dollars."),
  deposit: z.number().describe("Deposit in dollars, held in the listing brokerage's trust account."),
  depositTiming: z.enum(["herewith", "upon_acceptance"]).describe("herewith = submitted with the offer; upon_acceptance = within 24 hours of acceptance."),
  irrevocableHours: z.number().int().describe("Hours the offer stays open for acceptance."),
  completionDate: z.string().describe("Completion (closing) date, YYYY-MM-DD."),
  financing: z.enum(FINANCING_TYPES),
  downPaymentPct: z.number(),
  conditions: z.array(z.object({ key: z.enum(CONDITION_KEYS), days: z.number().int().describe("Banking days after acceptance to waive or fulfil.") })).describe("Schedule A conditions for the buyer's benefit. An empty list is a firm offer."),
  chattels: z.string().describe("Chattels included, e.g. 'Fridge, stove, dishwasher, washer, dryer'."),
  fixturesExcluded: z.string().describe("Fixtures excluded, or 'None'."),
  rentalItemsBuyout: z.boolean().describe("true = the seller pays out the rental contracts before completion; false = the buyer assumes them."),
  preClosingVisits: z.number().int().describe("Number of visits the buyer may make before completion, usually 2 or 3."),
  specialTerms: z.array(z.object({ key: z.string(), value: z.string() })).describe("Property-specific terms, keyed by the term keys in the scenario."),
});

export type Terms = z.infer<typeof TermsSchema>;
export type TermsCondition = Terms["conditions"][number];

/** Conditions that make sense for this property. */
export function applicableConditions(s: Pick<Scenario, "property">): ConditionKey[] {
  const keys: ConditionKey[] = ["financing", "inspection"];
  if (isCondo(s.property.type) || s.property.potlFee) keys.push("status_certificate");
  if (s.property.water !== "municipal" || s.property.sewer !== "municipal") keys.push("water_septic");
  keys.push("lawyer_review", "insurance", "sale_of_property");
  return keys;
}

export function rentalBuyoutTotal(s: Pick<Scenario, "property">): number {
  return s.property.rentalItems.reduce((sum, r) => sum + r.buyoutCost, 0);
}

export function conditionDays(t: Terms, key: ConditionKey): number | null {
  return t.conditions.find((c) => c.key === key)?.days ?? null;
}

/** A standard first offer from the buyer's side: list price, typical deposit, standard conditions. */
export function defaultBuyerTerms(s: Scenario, overrides: Partial<Terms> = {}): Terms {
  const b = s.buyer;
  const price = s.property.listPrice;
  const conditions: TermsCondition[] = [];
  if (b.financing !== "cash") conditions.push({ key: "financing", days: 5 });
  if (s.property.type !== "new_construction") conditions.push({ key: "inspection", days: 5 });
  if (applicableConditions(s).includes("status_certificate")) conditions.push({ key: "status_certificate", days: 5 });
  if (applicableConditions(s).includes("water_septic")) conditions.push({ key: "water_septic", days: 7 });
  if (b.needsSaleCondition) conditions.push({ key: "sale_of_property", days: 30 });
  return {
    price,
    deposit: roundPrice((price * s.market.typicalDepositPct) / 100),
    depositTiming: "upon_acceptance",
    irrevocableHours: 24,
    completionDate: b.idealClose,
    financing: b.financing,
    downPaymentPct: b.financing === "cash" ? 100 : b.downPaymentPct,
    conditions,
    chattels: s.property.type === "vacant_land" ? "None" : "Fridge, stove, dishwasher, washer, dryer, all electrical light fixtures, all window coverings",
    fixturesExcluded: "None",
    rentalItemsBuyout: false,
    preClosingVisits: s.property.type === "vacant_land" ? 0 : 2,
    specialTerms: s.typeSpecificTerms.map((t) => ({ key: t.key, value: "" })),
    ...overrides,
  };
}

/** Normalizes terms from a form or the LLM: rounds money, sorts and de-duplicates conditions. */
export function normalizeTerms(t: Terms): Terms {
  const seen = new Set<string>();
  const conditions = t.conditions
    .filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)))
    .map((c) => ({ key: c.key, days: Math.max(1, Math.round(c.days)) }))
    .sort((a, b) => CONDITION_KEYS.indexOf(a.key) - CONDITION_KEYS.indexOf(b.key));
  return {
    ...t,
    price: Math.round(t.price),
    deposit: Math.max(0, Math.round(t.deposit)),
    irrevocableHours: Math.max(1, Math.round(t.irrevocableHours)),
    downPaymentPct: t.financing === "cash" ? 100 : t.downPaymentPct,
    conditions: t.financing === "cash" ? conditions.filter((c) => c.key !== "financing") : conditions,
    chattels: t.chattels.trim() || "None",
    fixturesExcluded: t.fixturesExcluded.trim() || "None",
    preClosingVisits: Math.max(0, Math.min(5, Math.round(t.preClosingVisits))),
    specialTerms: t.specialTerms.map((x) => ({ key: x.key, value: x.value.trim() })),
  };
}

export interface TermLine {
  key: string;
  label: string;
  value: string;
}

type DescribeContext = Pick<Scenario, "typeSpecificTerms" | "property">;

export function describeTerms(t: Terms, s: DescribeContext): TermLine[] {
  const lines: TermLine[] = [
    { key: "price", label: "Price", value: money(t.price) },
    { key: "deposit", label: "Deposit", value: `${money(t.deposit)} ${t.depositTiming === "herewith" ? "herewith" : "upon acceptance"}` },
    { key: "irrevocable", label: "Irrevocable", value: `${t.irrevocableHours} hours` },
    { key: "completionDate", label: "Completion", value: displayDate(t.completionDate) },
    { key: "financing", label: "Buyer's financing", value: t.financing === "cash" ? "Cash" : `${FINANCING_LABELS[t.financing]}, ${t.downPaymentPct}% down` },
  ];
  for (const key of applicableConditions(s)) {
    if (key === "financing" && t.financing === "cash") continue;
    const days = conditionDays(t, key);
    lines.push({ key: `condition:${key}`, label: `${conditionLabel(key, s.property.type)} condition`, value: days === null ? "None" : `${days} banking days` });
  }
  lines.push(
    { key: "chattels", label: "Chattels included", value: t.chattels },
    { key: "fixturesExcluded", label: "Fixtures excluded", value: t.fixturesExcluded },
  );
  if (s.property.rentalItems.length) lines.push({ key: "rentalItems", label: "Rental items", value: t.rentalItemsBuyout ? `Seller pays out (${money(rentalBuyoutTotal(s))})` : "Buyer assumes" });
  lines.push({ key: "preClosingVisits", label: "Pre-closing visits", value: String(t.preClosingVisits) });
  for (const term of s.typeSpecificTerms) {
    const value = t.specialTerms.find((x) => x.key === term.key)?.value;
    lines.push({ key: `special:${term.key}`, label: term.label, value: value || "Not addressed" });
  }
  return lines;
}

export function termsEqual(a: Terms, b: Terms): boolean {
  return JSON.stringify(normalizeTerms(a)) === JSON.stringify(normalizeTerms(b));
}

export function termsSummary(t: Terms, s: DescribeContext): string {
  return describeTerms(t, s)
    .map((l) => `${l.label}: ${l.value}`)
    .join("; ");
}
