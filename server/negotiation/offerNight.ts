// Offer nights: the listing holds offers until a review time, buyers register, the seller reviews them together,
// and may send them all back to improve. Competing buyers come from the scenario's hidden ground truth.
// These are pure helpers; the negotiation engine runs the flow.

import type { CompetingOffer, ConditionKey, Scenario } from "../engine/types";
import { Rng, roundPrice } from "../engine/rng";
import { netPrice, sellerViolations } from "./constraints";
import { defaultBuyerTerms, type Terms } from "./terms";

export interface CompetitorOffer {
  id: string;
  /** How the seller's side refers to it, e.g. "Offer B". */
  label: string;
  strength: CompetingOffer["strength"];
  terms: Terms;
  /** The most this buyer would pay if pushed (hidden from everyone). */
  maxPrice: number;
  registeredAt: number;
  /**
   * registered = a live written offer; accepted; released = told the property sold to someone else;
   * declined = the sellers said no; expired = its irrevocable time ran out; withdrawn = the buyer walked
   * (after a sign-back they wouldn't take); moved_on = invited back after a collapse but no longer interested.
   */
  status: "registered" | "accepted" | "released" | "declined" | "expired" | "withdrawn" | "moved_on";
  /** When offers are taken any time: the end of the irrevocable time. */
  expiresAt?: number;
  /** When this buyer was told the property sold to someone else. */
  releasedAt?: number;
}

export type OfferNightPhase = "registration" | "review" | "improvement" | "final_review" | "done";

export interface OfferNightState {
  reviewAtHours: number;
  preemptives: "not_accepted" | "considered";
  /** What the listing side tells competing buyers: always the count; the contents only on the seller's direction. */
  disclosure: "count_only" | "details";
  phase: OfferNightPhase;
  competitors: CompetitorOffer[];
  improvementDeadlineHours: number | null;
  /** The listing side has told the buyers' agents how many offers there are (Code of Ethics). */
  countDisclosed: boolean;
  outcome: null | { kind: "user_offer_accepted" | "bot_offer_accepted" | "competitor_accepted" | "continued_with_sign_back" | "preemptive_accepted"; competitorId?: string };
}

const LABELS = ["B", "C", "D", "E", "F", "G", "H"];

/** A competing buyer's offer, built from the hidden ground truth. Stronger buyers go firmer and higher. */
function competitorTerms(s: Scenario, o: CompetingOffer, rng: Rng): Terms {
  const conditions: Terms["conditions"] =
    o.strength === "strong" ? [] : o.strength === "comparable" ? (rng.chance(0.5) ? [] : [{ key: "financing" as ConditionKey, days: 3 }]) : [{ key: "financing", days: 5 }, { key: "inspection", days: 5 }];
  return defaultBuyerTerms(s, {
    price: o.price,
    deposit: roundPrice(o.price * (o.strength === "weak" ? 0.03 : 0.05)),
    depositTiming: o.strength === "weak" ? "upon_acceptance" : "herewith",
    irrevocableHours: 3,
    completionDate: s.seller.idealClose,
    financing: "conventional",
    downPaymentPct: 20,
    conditions,
  });
}

/**
 * The competing buyers from the scenario's hidden ground truth. For an offer night they register before the review;
 * when offers are taken any time (reviewAt null) they arrive on their own schedule with a 12-hour irrevocable.
 */
export function buildCompetitors(s: Scenario, reviewAt: number | null): CompetitorOffer[] {
  const rng = new Rng(s.seed ^ 0xb1d5);
  const built = s.groundTruth.competingOffers
    .filter((o) => o.phase === "pre_contract")
    .map((o, i) => {
      const terms = competitorTerms(s, o, rng);
      const arrives = o.arrivesDay * 12 + 2;
      const c: CompetitorOffer = {
        id: `competitor-${i}`,
        label: `Offer ${LABELS[i] ?? i + 2}`,
        strength: o.strength,
        terms: reviewAt === null ? { ...terms, irrevocableHours: 12 } : terms,
        maxPrice: roundPrice(o.price * (1 + { weak: 0.01, comparable: 0.025, strong: 0.04 }[o.strength])),
        registeredAt: reviewAt === null ? arrives : Math.min(arrives, reviewAt - 1),
        status: "registered",
      };
      if (reviewAt === null) c.expiresAt = arrives + 12;
      return c;
    });
  // Label them in the order they arrive: Offer B is the first competing offer.
  [...built].sort((a, b) => a.registeredAt - b.registeredAt).forEach((c, i) => (c.label = `Offer ${LABELS[i] ?? i + 2}`));
  return built;
}

export function initOfferNight(s: Scenario): OfferNightState | null {
  if (!s.offerNight) return null;
  const reviewAt = s.offerNight.reviewAtHours;
  return { reviewAtHours: reviewAt, preemptives: s.offerNight.preemptives, disclosure: "count_only", phase: "registration", competitors: buildCompetitors(s, reviewAt), improvementDeadlineHours: null, countDisclosed: false, outcome: null };
}

export function registeredCompetitors(state: OfferNightState, simHours: number): CompetitorOffer[] {
  return state.competitors.filter((c) => c.status === "registered" && c.registeredAt <= simHours);
}

const CONDITION_COST: Record<ConditionKey, number> = {
  financing: 0.012,
  inspection: 0.01,
  status_certificate: 0.005,
  water_septic: 0.008,
  lawyer_review: 0.003,
  insurance: 0.003,
  sale_of_property: 0.04,
};

/**
 * How a seller ranks an offer: the price net of rental buyouts, minus the risk of each condition,
 * plus a little for a strong deposit. Offers outside the seller's completion window rank well below.
 */
export function offerScore(s: Scenario, t: Terms): number {
  let score = netPrice(s, t);
  for (const c of t.conditions) score -= t.price * CONDITION_COST[c.key];
  score += t.price * Math.min(t.deposit / t.price, 0.1) * 0.05;
  if (t.depositTiming === "herewith") score += t.price * 0.001;
  if (t.completionDate < s.seller.earliestClose || t.completionDate > s.seller.latestClose) score -= t.price * 0.03;
  return Math.round(score);
}

export interface RankedOffer {
  ref: { kind: "user" | "bot"; offerId: string } | { kind: "competitor"; competitorId: string };
  terms: Terms;
  score: number;
  signable: boolean;
}

export function rankOffers(s: Scenario, entries: Omit<RankedOffer, "score" | "signable">[]): RankedOffer[] {
  return entries
    .map((e) => ({ ...e, score: offerScore(s, e.terms), signable: sellerViolations(s.seller, e.terms, s).length === 0 }))
    .sort((a, b) => b.score - a.score);
}

export type SellerDecision = { kind: "accept"; offer: RankedOffer } | { kind: "improve" } | { kind: "sign_back"; offer: RankedOffer };

/**
 * The opposing listing agent's call on offer night. Round 1: take a clear winner, otherwise send everyone back.
 * Round 2: take the best signable offer, or sign back the best one.
 */
export function sellerDecision(s: Scenario, ranked: RankedOffer[], round: 1 | 2): SellerDecision {
  const best = ranked[0];
  const second = ranked[1];
  const margin = second ? best.score - second.score : Infinity;
  if (round === 1 && ranked.length >= 2 && !(best.signable && margin > s.property.listPrice * 0.015)) return { kind: "improve" };
  const signable = ranked.find((r) => r.signable);
  if (signable) return { kind: "accept", offer: signable };
  return { kind: "sign_back", offer: best };
}

/** Competing buyers improve when sent back: up to their hidden ceiling, and the comparable ones may drop a condition. */
export function improveCompetitors(s: Scenario, state: OfferNightState, rng: Rng, topKnownPrice: number | null): void {
  for (const c of state.competitors) {
    if (c.status !== "registered") continue;
    const bump = { weak: rng.range(0, 0.01), comparable: rng.range(0.01, 0.025), strong: rng.range(0.01, 0.03) }[c.strength];
    let price = roundPrice(c.terms.price * (1 + bump));
    if (state.disclosure === "details" && topKnownPrice && topKnownPrice > price) price = roundPrice(Math.min(c.maxPrice, topKnownPrice + 5_000));
    c.terms = { ...c.terms, price: Math.min(price, c.maxPrice) };
    if (c.strength !== "weak" && rng.chance(0.5)) c.terms.conditions = [];
  }
}

/** Whether a competing buyer accepts a sign-back from the listing side. */
export function competitorAccepts(c: CompetitorOffer, terms: Terms): boolean {
  return terms.price <= c.maxPrice;
}

/** The bot buyer's offer-night bid: competitive from the start, since it knows it's competing. */
export function botBuyerBid(s: Scenario, round: 1 | 2, current: number | null, topKnownPrice: number | null, competitorCount: number): number {
  const r = s.buyer.reservationPrice;
  const list = s.property.listPrice;
  if (round === 1) return roundPrice(Math.min(r * 0.96, list * (1.03 + Math.min(competitorCount, 4) * 0.01)));
  if (topKnownPrice) return roundPrice(Math.min(r, Math.max(current ?? 0, topKnownPrice + 5_000)));
  return roundPrice(Math.min(r, (current ?? list) + (r - (current ?? list)) * Math.min(0.85, 0.4 + competitorCount * 0.1)));
}

/** A competitive bot-buyer offer: drops what the buyer will waive, short conditions, 5% herewith. */
export function botBuyerTerms(s: Scenario, price: number, irrevocableHours: number): Terms {
  const t = defaultBuyerTerms(s, { price, completionDate: s.buyer.idealClose, depositTiming: "herewith", irrevocableHours });
  t.conditions = t.conditions.filter((c) => !(s.buyer.willingToWaive as string[]).includes(c.key)).map((c) => ({ ...c, days: c.key === "sale_of_property" ? c.days : 3 }));
  t.deposit = roundPrice(price * 0.05);
  return t;
}

/** What competing buyers learn when the seller has directed disclosure of offer contents (TRESA). */
export function disclosedSummary(state: OfferNightState): string {
  return state.competitors
    .filter((c) => c.status === "registered")
    .map((c) => `${c.label}: $${c.terms.price.toLocaleString("en-CA")}, ${c.terms.conditions.length ? `conditional on ${c.terms.conditions.map((x) => x.key.replace("_", " ")).join(" and ")}` : "firm"}, deposit $${c.terms.deposit.toLocaleString("en-CA")}`)
    .join("; ");
}
