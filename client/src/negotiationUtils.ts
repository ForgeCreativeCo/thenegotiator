import type { NegotiationView, UserView } from "./api";
import type { Offer } from "../../server/negotiation/types";
import { applicableConditions, type Terms } from "../../server/negotiation/terms";
import type { Side } from "../../server/engine/types";

export function mySide(view: UserView): Side {
  return view.role === "buyer_agent" ? "buyer" : "seller";
}

export function latestOfferBy(n: NegotiationView | null, side: Side): Offer | null {
  if (!n) return null;
  for (let i = n.offers.length - 1; i >= 0; i--) if (n.offers[i].by === side) return n.offers[i];
  return null;
}

export function openOfferFrom(n: NegotiationView | null, side: Side): Offer | null {
  const offer = latestOfferBy(n, side);
  return offer && offer.status === "open" ? offer : null;
}

/** Starting point for the offer form: the most recent offer on the table, or a standard first offer. */
export function startingTerms(view: UserView, n: NegotiationView | null): Terms {
  const last = n?.offers[n.offers.length - 1];
  if (last) return structuredClone(last.terms);
  const p = view.public;
  const brief = view.yourClient.brief;
  const buyer = brief.side === "buyer" ? brief : null;
  const financing = buyer?.financing ?? "conventional";
  const keys = applicableConditions(p);
  const conditions: Terms["conditions"] = [];
  if (financing !== "cash") conditions.push({ key: "financing", days: 5 });
  if (p.property.type !== "new_construction") conditions.push({ key: "inspection", days: 5 });
  if (keys.includes("status_certificate")) conditions.push({ key: "status_certificate", days: 5 });
  if (keys.includes("water_septic")) conditions.push({ key: "water_septic", days: 7 });
  if (buyer?.needsSaleCondition) conditions.push({ key: "sale_of_property", days: 30 });
  return {
    price: p.property.listPrice,
    deposit: Math.round((p.property.listPrice * p.market.typicalDepositPct) / 100 / 1000) * 1000,
    depositTiming: "upon_acceptance",
    irrevocableHours: 24,
    completionDate: brief.idealClose,
    financing,
    downPaymentPct: buyer ? (financing === "cash" ? 100 : buyer.downPaymentPct) : 20,
    conditions,
    chattels: p.property.type === "vacant_land" ? "None" : "Fridge, stove, dishwasher, washer, dryer, all electrical light fixtures, all window coverings",
    fixturesExcluded: "None",
    rentalItemsBuyout: false,
    preClosingVisits: p.property.type === "vacant_land" ? 0 : 2,
    specialTerms: p.typeSpecificTerms.map((t) => ({ key: t.key, value: "" })),
  };
}

export function simClock(startDate: string, hours: number): string {
  const date = new Date(new Date(`${startDate}T09:00:00Z`).getTime() + hours * 3_600_000);
  return date.toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}
