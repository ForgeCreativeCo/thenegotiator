// Whether a client will sign a set of terms. These are the hard limits from each client's brief,
// enforced in code for the opposing agent's client and for the user's own client.

import type { BuyerBrief, Scenario, SellerBrief, Side } from "../engine/types";
import { isCondo } from "../engine/properties";
import { roundPrice } from "../engine/rng";
import { CONDITION_LABELS, FINANCING_LABELS, displayDate, money } from "../narrative/format";
import { applicableConditions, conditionDays, rentalBuyoutTotal, type Terms } from "./terms";

/** CMHC-insured mortgages aren't available at this price or above. */
export const INSURED_PRICE_CAP = 1_500_000;
export const MAX_PRE_CLOSING_VISITS = 3;

/** Price net of the rental buyout the seller agrees to pay. Both sides measure deals by this. */
export function netPrice(s: Pick<Scenario, "property">, t: Terms): number {
  return t.price - (t.rentalItemsBuyout ? rentalBuyoutTotal(s) : 0);
}

function availableCash(b: BuyerBrief, price: number): number {
  return b.financing === "cash" ? price + b.cashReserves : (price * b.downPaymentPct) / 100 + b.cashReserves;
}

export function sellerViolations(s: SellerBrief, t: Terms, scenario: Scenario): string[] {
  const v: string[] = [];
  if (netPrice(scenario, t) < s.reservationPrice) v.push(`Price ${t.rentalItemsBuyout ? "net of the rental buyout " : ""}is ${money(netPrice(scenario, t))}, below the seller's floor of ${money(s.reservationPrice)}`);
  if (t.completionDate < s.earliestClose || t.completionDate > s.latestClose) v.push(`Completion on ${displayDate(t.completionDate)} is outside the seller's window (${displayDate(s.earliestClose)} to ${displayDate(s.latestClose)})`);
  if (t.deposit < (t.price * s.minDepositPct) / 100) v.push(`The seller wants a deposit of at least ${s.minDepositPct}% (${money((t.price * s.minDepositPct) / 100)})`);
  for (const c of t.conditions) {
    if (c.key === "sale_of_property") continue;
    if (c.days > s.maxConditionDays) v.push(`The seller won't give more than ${s.maxConditionDays} banking days on the ${CONDITION_LABELS[c.key].toLowerCase()} condition`);
  }
  if (conditionDays(t, "sale_of_property") !== null && !s.acceptsSaleCondition) v.push("The seller won't accept a condition on the sale of the buyer's property");
  if (t.preClosingVisits > MAX_PRE_CLOSING_VISITS) v.push(`The seller won't allow more than ${MAX_PRE_CLOSING_VISITS} pre-closing visits`);
  return v;
}

export function buyerViolations(b: BuyerBrief, t: Terms, scenario: Scenario): string[] {
  const v: string[] = [];
  if (netPrice(scenario, t) > b.reservationPrice) v.push(`Price ${t.rentalItemsBuyout ? "net of the rental buyout " : ""}is ${money(netPrice(scenario, t))}, above the buyer's ceiling of ${money(b.reservationPrice)}`);
  if (b.preapprovalAmount !== null && t.price > b.preapprovalAmount) v.push(`Price is above the buyer's ${money(b.preapprovalAmount)} pre-approval`);
  if (t.financing !== b.financing) v.push(`The buyer is financing with ${b.financing === "cash" ? "cash" : `their ${FINANCING_LABELS[b.financing]}`}`);
  if (t.financing !== "cash" && t.downPaymentPct !== b.downPaymentPct) v.push(`The buyer is putting ${b.downPaymentPct}% down`);
  if (t.financing === "insured" && t.price >= INSURED_PRICE_CAP) v.push(`Insured mortgages aren't available at ${money(INSURED_PRICE_CAP)} or more`);
  if (t.completionDate < b.earliestClose || t.completionDate > b.latestClose) v.push(`Completion on ${displayDate(t.completionDate)} is outside the buyer's window (${displayDate(b.earliestClose)} to ${displayDate(b.latestClose)})`);
  if (t.financing !== "cash" && conditionDays(t, "financing") === null && !b.willingToWaive.includes("financing")) v.push("The buyer won't go without a financing condition");
  if (scenario.property.type !== "new_construction" && conditionDays(t, "inspection") === null && !b.willingToWaive.includes("inspection")) v.push("The buyer won't go without an inspection condition");
  if (isCondo(scenario.property.type) && conditionDays(t, "status_certificate") === null && !b.willingToWaive.includes("status_certificate")) v.push("The buyer won't go without a status certificate review");
  if (applicableConditions(scenario).includes("water_septic") && conditionDays(t, "water_septic") === null && !b.willingToWaive.includes("inspection")) v.push("The buyer won't go without a water and septic condition");
  if (b.needsSaleCondition && conditionDays(t, "sale_of_property") === null) v.push("The buyer can't buy without a condition on selling their home");
  if (t.deposit > availableCash(b, t.price)) v.push(`The deposit is more than the buyer has available (${money(availableCash(b, t.price))})`);
  return v;
}

export function violations(side: Side, scenario: Scenario, t: Terms): string[] {
  return side === "seller" ? sellerViolations(scenario.seller, t, scenario) : buyerViolations(scenario.buyer, t, scenario);
}

/** Adjusts every non-price term the minimum amount needed for this client to sign. Price is left alone. */
export function repairTerms(side: Side, scenario: Scenario, input: Terms): Terms {
  const t: Terms = { ...input, conditions: input.conditions.map((c) => ({ ...c })), specialTerms: input.specialTerms.map((x) => ({ ...x })) };
  if (side === "seller") {
    const s = scenario.seller;
    if (t.completionDate < s.earliestClose) t.completionDate = s.earliestClose;
    if (t.completionDate > s.latestClose) t.completionDate = s.latestClose;
    if (!s.acceptsSaleCondition) t.conditions = t.conditions.filter((c) => c.key !== "sale_of_property");
    for (const c of t.conditions) if (c.key !== "sale_of_property" && c.days > s.maxConditionDays) c.days = s.maxConditionDays;
    if (t.deposit < (t.price * s.minDepositPct) / 100) t.deposit = Math.ceil((t.price * s.minDepositPct) / 100 / 1000) * 1000;
    if (t.preClosingVisits > MAX_PRE_CLOSING_VISITS) t.preClosingVisits = MAX_PRE_CLOSING_VISITS;
  } else {
    const b = scenario.buyer;
    t.financing = b.financing;
    t.downPaymentPct = b.financing === "cash" ? 100 : b.downPaymentPct;
    if (t.completionDate < b.earliestClose) t.completionDate = b.earliestClose;
    if (t.completionDate > b.latestClose) t.completionDate = b.latestClose;
    const ensure = (key: Terms["conditions"][number]["key"], days: number) => {
      if (conditionDays(t, key) === null) t.conditions.push({ key, days });
    };
    if (b.financing !== "cash" && !b.willingToWaive.includes("financing")) ensure("financing", 5);
    if (b.financing === "cash") t.conditions = t.conditions.filter((c) => c.key !== "financing");
    if (scenario.property.type !== "new_construction" && !b.willingToWaive.includes("inspection")) ensure("inspection", 5);
    if (isCondo(scenario.property.type) && !b.willingToWaive.includes("status_certificate")) ensure("status_certificate", 5);
    if (applicableConditions(scenario).includes("water_septic") && !b.willingToWaive.includes("inspection")) ensure("water_septic", 7);
    if (b.needsSaleCondition) ensure("sale_of_property", 30);
    const cash = availableCash(b, t.price);
    if (t.deposit > cash) t.deposit = Math.floor(cash / 1000) * 1000;
  }
  return t;
}

/** Repairs the terms for this side and sets the price so the side's net lands on `net`. */
export function setNet(side: Side, scenario: Scenario, input: Terms, net: number): Terms {
  // The deposit and pre-approval depend on price, so settle the two together.
  let t = repairTerms(side, scenario, input);
  for (let i = 0; i < 3; i++) {
    t.price = priceForNet(scenario, t, net);
    t = repairTerms(side, scenario, t);
  }
  t.price = priceForNet(scenario, t, net);
  const preapproval = scenario.buyer.preapprovalAmount;
  if (side === "buyer" && preapproval !== null && t.price > preapproval && t.rentalItemsBuyout) {
    t.rentalItemsBuyout = false;
    t.price = priceForNet(scenario, t, net);
  }
  return t;
}

/** The price that lands exactly at a target net, given these terms. */
export function priceForNet(scenario: Pick<Scenario, "property">, t: Terms, net: number): number {
  return net + (t.rentalItemsBuyout ? rentalBuyoutTotal(scenario) : 0);
}

export function netFor(scenario: Pick<Scenario, "property">, t: Terms): number {
  return netPrice(scenario, t);
}
