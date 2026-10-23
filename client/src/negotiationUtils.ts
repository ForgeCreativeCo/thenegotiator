import type { NegotiationView, UserView } from "./api";
import type { Offer } from "../../server/negotiation/types";
import type { Terms } from "../../server/negotiation/terms";
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

/** Starting point for the offer form: the most recent offer on the table, or standard terms for a first offer. */
export function startingTerms(view: UserView, n: NegotiationView | null): Terms {
  const last = n?.offers[n.offers.length - 1];
  if (last) return structuredClone(last.terms);
  const p = view.public;
  const brief = view.yourClient.brief;
  const buyer = brief.side === "buyer" ? brief : null;
  const loanType = buyer?.loanType ?? "conventional";
  return {
    price: p.property.listPrice,
    earnestMoney: Math.round((p.property.listPrice * p.market.customs.typicalEarnestMoneyPct) / 100 / 500) * 500,
    loanType,
    downPaymentPct: buyer?.downPaymentPct ?? 20,
    sellerCredit: 0,
    closingDate: brief.idealClose,
    rentBackDays: 0,
    inspectionDays: p.property.type === "land" ? 30 : 10,
    appraisal: loanType === "cash" ? "waived" : "full",
    appraisalGapCoverage: 0,
    financingDays: loanType === "cash" ? null : 21,
    homeSaleContingency: false,
    homeWarranty: 0,
    inclusions: p.property.type === "land" ? "None" : "Refrigerator, range, dishwasher, microwave",
    specialTerms: p.typeSpecificTerms.map((t) => ({ key: t.key, value: "" })),
  };
}

export function simClock(startDate: string, hours: number): string {
  const date = new Date(new Date(`${startDate}T09:00:00Z`).getTime() + hours * 3_600_000);
  return date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}
