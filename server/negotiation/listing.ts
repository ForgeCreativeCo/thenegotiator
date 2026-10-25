// Multiple offers outside an offer night. One accepted agreement at a time, ever: unaccepted offers can stack up,
// accepting one releases every other buyer, and only one sign-back can be out at once.
// When the sellers decide to hold offers, the listing turns into an offer night and that flow takes over.

import type { Scenario } from "../engine/types";
import { Rng, roundPrice } from "../engine/rng";
import { money } from "../narrative/format";
import { TermsSchema, normalizeTerms, type Terms } from "./terms";
import { sellerViolations } from "./constraints";
import { buildCompetitors, competitorAccepts, offerScore, type CompetitorOffer, type OfferNightState } from "./offerNight";
import type { Negotiation } from "./types";
import { ActionError, pushMessage, simTime, userSide, type UserAction } from "./engine";
import { clientViolations, requireSignature } from "../client/engine";
import { listingLines, type AgentContext } from "../dialogue/agent";

export interface ListingState {
  /** How offers are handled. "held" means the listing has become an offer night. */
  mode: "any_time" | "held";
  /** The sellers' written decision on how offers are handled (only when the user is the listing agent). */
  decided: boolean;
  /** Competing buyers while offers are taken any time. Moved into the offer night when offers are held. */
  competitors: CompetitorOffer[];
  /** The one sign-back that's out to a competing buyer, and when they'll answer. */
  signBackOut: { competitorId: string; terms: Terms; answerAt: number } | null;
  /** The user has told every agent with an offer how many offers there are. */
  countDisclosed: boolean;
  /** The user signed back or accepted with two or more written offers before telling the agents the count. */
  actedBeforeCount: boolean;
  disclosure: "count_only" | "details";
  /** Released buyers invited back after a collapse, and what they said. */
  invites: { competitorId: string; at: number; result: "returned" | "moved_on" }[];
  acceptedCompetitorId: string | null;
}

export const LISTING_ACTIONS = ["accept_competitor", "signback_competitor", "decline_competitor", "wait", "tell_count", "set_disclosure", "invite_back"] as const;

export function isListingAction(type: string): boolean {
  return (LISTING_ACTIONS as readonly string[]).includes(type);
}

export function newListing(s: Scenario): ListingState {
  return { mode: "any_time", decided: false, competitors: buildCompetitors(s, null), signBackOut: null, countDisclosed: false, actedBeforeCount: false, disclosure: "count_only", invites: [], acceptedCompetitorId: null };
}

/** Every competing buyer, wherever they are now (the listing, or the offer night it became). */
export function allCompetitors(n: Negotiation): CompetitorOffer[] {
  return [...(n.listing?.competitors ?? []), ...(n.listing?.mode === "held" ? (n.offerNight?.competitors ?? []) : [])];
}

/** Competing offers that have arrived and are still open, while offers are taken any time. */
export function liveCompetitors(n: Negotiation): CompetitorOffer[] {
  if (!n.listing || n.listing.mode !== "any_time") return [];
  return n.listing.competitors.filter((c) => c.status === "registered" && c.registeredAt <= n.simHours);
}

/** Written offers on the property right now: the competing ones plus the buyer the agents are negotiating with. */
export function writtenOfferCount(s: Scenario, n: Negotiation): number {
  const buyerOffer = [...n.offers].reverse().find((o) => o.by === "buyer" && (o.status === "open" || o.status === "countered"));
  return liveCompetitors(n).length + (buyerOffer ? 1 : 0);
}

/** The next 7 p.m. review at least a day away. */
export function nextReviewTime(simHours: number): number {
  let review = Math.ceil((simHours + 24 - 10) / 24) * 24 + 10;
  if (review < simHours + 24) review += 24;
  return review;
}

const ctx = (s: Scenario, n: Negotiation): AgentContext => ({ s, used: (n.usedLines ??= []), seed: s.seed + n.messages.length * 13 });

/** The listing switches to holding offers: every live offer is registered for a review, and the offer night takes over. */
export function holdOffers(s: Scenario, n: Negotiation, reviewAtHours: number): OfferNightState {
  const listing = n.listing!;
  const registered = listing.competitors
    .filter((c) => c.status === "registered" && (c.expiresAt === undefined || c.expiresAt >= n.simHours || c.registeredAt > n.simHours))
    .map((c) => ({ ...c, registeredAt: Math.min(c.registeredAt, reviewAtHours - 1), expiresAt: undefined, terms: { ...c.terms, irrevocableHours: 3 } }));
  const state: OfferNightState = { reviewAtHours, preemptives: "not_accepted", disclosure: listing.disclosure, phase: "registration", competitors: registered, improvementDeadlineHours: null, countDisclosed: listing.countDisclosed || userSide(s) === "buyer", outcome: null };
  listing.competitors = listing.competitors.filter((c) => !registered.some((r) => r.id === c.id));
  listing.mode = "held";
  listing.signBackOut = null;
  n.offerNight = state;
  // The buyer the agents were negotiating with: their latest offer is registered for the review.
  const buyerOffer = [...n.offers].reverse().find((o) => o.by === "buyer" && (o.status === "open" || o.status === "countered"));
  if (buyerOffer) buyerOffer.status = "registered";
  for (const o of n.offers) if (o.by === "seller" && o.status === "open") o.status = "expired";
  return state;
}

/** Everyone else is told the property has sold. Called whenever an agreement is accepted. */
export function releaseOthers(s: Scenario, n: Negotiation, firm: boolean, exceptCompetitorId?: string): void {
  if (!n.listing) return;
  let released = 0;
  for (const c of allCompetitors(n)) {
    if (c.id === exceptCompetitorId || c.status !== "registered" || c.registeredAt > n.simHours) continue;
    c.status = "released";
    c.releasedAt = n.simHours;
    released++;
  }
  n.listing.signBackOut = null;
  if (released && userSide(s) === "seller") pushMessage(n, { speaker: "system", text: `The other ${released === 1 ? "buyer's agent was" : `${released} buyers' agents were`} told the property is sold${firm ? "" : " conditionally"}.` });
}

/** The sale to a competing buyer: the one agreement, and the end of this deal. */
function sellToCompetitor(s: Scenario, n: Negotiation, c: CompetitorOffer, terms: Terms): void {
  c.terms = terms;
  c.status = "accepted";
  n.listing!.acceptedCompetitorId = c.id;
  releaseOthers(s, n, terms.conditions.length === 0, c.id);
  for (const o of n.offers) if (o.status === "open" || o.status === "registered") o.status = "rejected";
  n.status = "sold_to_other";
  n.endedBy = "user";
  pushMessage(n, { speaker: "system", text: `Your sellers accepted ${c.label} at ${money(terms.price)}, ${terms.conditions.length ? "conditional" : "firm"}.${n.transaction ? "" : ` ${s.narrative.opposingAgent.name}'s buyers are told they weren't successful.`}`, event: "deal" });
}

/** Time passes on the listing: offers arrive, expire, and a sign-back gets its answer. The opposing listing agent reacts to new competition. */
export function listingTick(s: Scenario, n: Negotiation): void {
  const listing = n.listing;
  if (!listing || listing.mode !== "any_time" || n.status !== "negotiating") return;
  const seller = userSide(s) === "seller";

  for (const c of listing.competitors) {
    const key = `listing-arrived:${c.id}`;
    if (c.status !== "registered" || c.registeredAt > n.simHours || n.announcedEvents.includes(key)) continue;
    n.announcedEvents.push(key);
    if (seller) {
      pushMessage(n, { speaker: "system", text: `${c.label} arrived from another buyer's agent: ${money(c.terms.price)}, ${c.terms.conditions.length ? "conditional" : "firm"}, irrevocable until ${simTime(s, c.expiresAt ?? n.simHours + 12)}. Present it to your sellers.`, event: "competing_offer" });
    } else if (botReactsToCompetition(s, n, c)) {
      return;
    }
  }

  if (seller) {
    for (const c of listing.competitors) {
      if (c.status === "registered" && c.expiresAt !== undefined && c.expiresAt < n.simHours && listing.signBackOut?.competitorId !== c.id) {
        c.status = "expired";
        pushMessage(n, { speaker: "system", text: `${c.label}'s irrevocable time ran out. The offer has lapsed.` });
      }
    }
    const out = listing.signBackOut;
    if (out && out.answerAt <= n.simHours) {
      const c = listing.competitors.find((x) => x.id === out.competitorId)!;
      listing.signBackOut = null;
      if (competitorAccepts(c, out.terms)) {
        pushMessage(n, { speaker: "system", text: `${c.label}'s buyers accepted your sign-back.` });
        sellToCompetitor(s, n, c, out.terms);
      } else {
        c.status = "withdrawn";
        pushMessage(n, { speaker: "system", text: `${c.label}'s buyers declined your sign-back and withdrew.` });
      }
    }
  } else {
    // The other buyers' offers lapse quietly when the listing side doesn't act on them.
    for (const c of listing.competitors) if (c.status === "registered" && c.expiresAt !== undefined && c.expiresAt < n.simHours) c.status = "expired";
  }
}

/** The opposing listing agent, when another buyer's offer arrives: take a clearly better signable offer, or hold offers, or carry on. */
function botReactsToCompetition(s: Scenario, n: Negotiation, c: CompetitorOffer): boolean {
  const userOffer = [...n.offers].reverse().find((o) => o.by === "buyer" && (o.status === "open" || o.status === "countered")) ?? null;
  const signable = sellerViolations(s.seller, c.terms, s).length === 0;
  const beats = !userOffer || offerScore(s, c.terms) > offerScore(s, userOffer.terms) + s.property.listPrice * 0.01;
  if (c.strength === "strong" && signable && beats) {
    c.status = "accepted";
    n.listing!.acceptedCompetitorId = c.id;
    for (const o of n.offers) if (o.status === "open" || o.status === "registered" || o.status === "countered") o.status = o.by === "buyer" ? "rejected" : "expired";
    n.status = "lost";
    n.endedBy = "bot";
    pushMessage(n, { speaker: "bot", text: listingLines.soldElsewhere(ctx(s, n)), action: "walk" });
    pushMessage(n, { speaker: "system", text: "Another buyer's offer was accepted. Your buyers lost the property.", event: "walk" });
    return true;
  }
  const temperament = s.difficulty.temperament;
  const holds = s.market.temperature === "hot" || temperament === "hardball" || temperament === "cagey" || new Rng(s.seed ^ 0x401d).chance(0.35);
  if (holds && userOffer) {
    const review = nextReviewTime(n.simHours);
    holdOffers(s, n, review);
    const count = n.offerNight!.competitors.filter((x) => x.registeredAt <= n.simHours).length;
    pushMessage(n, { speaker: "bot", text: listingLines.holdNow(ctx(s, n), simTime(s, review), `${count === 1 ? "another offer" : `${count} other offers`}`), action: "hold" });
    return true;
  }
  return false;
}

// ---------- The listing agent's actions (the user represents the sellers) ----------

function competitorById(n: Negotiation, id: string | undefined): CompetitorOffer {
  const c = n.listing?.competitors.find((x) => x.id === id);
  if (!c) throw new ActionError("That offer isn't available.");
  return c;
}

function liveOne(n: Negotiation, id: string | undefined): CompetitorOffer {
  const c = competitorById(n, id);
  if (c.status !== "registered" || c.registeredAt > n.simHours) throw new ActionError(`${c.label} isn't open any more.`);
  return c;
}

function noSignBackOut(n: Negotiation): void {
  const out = n.listing?.signBackOut;
  if (!out) return;
  const c = n.listing!.competitors.find((x) => x.id === out.competitorId);
  throw new ActionError(`You have a sign-back out to ${c?.label ?? "another buyer"}. Wait for their answer first: two sign-backs out could both be accepted.`);
}

function parseTerms(input: unknown): Terms {
  const parsed = TermsSchema.safeParse(input);
  if (!parsed.success) throw new ActionError("Those terms are incomplete.", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  return normalizeTerms(parsed.data);
}

/** Notes acting with two or more offers before the agents were told how many there are (Code of Ethics). */
export function noteCountRule(s: Scenario, n: Negotiation): void {
  const listing = n.listing;
  if (listing && userSide(s) === "seller" && !listing.countDisclosed && writtenOfferCount(s, n) >= 2) listing.actedBeforeCount = true;
}

/** After the accepted deal collapsed (or the buyer walked), the listing side can still deal with other buyers. */
export function canRelist(s: Scenario, n: Negotiation): boolean {
  if (!n.listing || userSide(s) !== "seller" || n.status === "sold_to_other") return false;
  return n.status === "dead" || (n.transaction !== null && n.transaction.status === "terminated");
}

export function applyListingAction(s: Scenario, n: Negotiation, action: UserAction): void {
  const listing = n.listing;
  if (!listing) throw new ActionError("That isn't available on this deal.");
  if (userSide(s) !== "seller") throw new ActionError("Only the listing side handles competing offers.");
  const relisting = canRelist(s, n);
  if (listing.mode === "held" && !relisting && action.type !== "set_disclosure") throw new ActionError("Offers are being held for the review. Use the offer night controls.");
  const text = (action.text ?? "").trim();

  switch (action.type) {
    case "wait": {
      const out = listing.signBackOut;
      const nextArrival = Math.min(...listing.competitors.filter((c) => c.status === "registered" && c.registeredAt > n.simHours).map((c) => c.registeredAt), Infinity);
      const target = out ? out.answerAt : Number.isFinite(nextArrival) ? nextArrival : n.simHours + 4;
      n.simHours = Math.max(n.simHours + 1, target);
      pushMessage(n, { speaker: "system", text: `It's ${simTime(s, n.simHours)}.` });
      listingTick(s, n);
      return;
    }
    case "tell_count": {
      const count = relisting ? liveCompetitors(n).length : writtenOfferCount(s, n);
      if (count < 2) throw new ActionError("There's only one written offer, so there's no count to share yet.");
      listing.countDisclosed = true;
      pushMessage(n, { speaker: "user", text: text || `For transparency: we have ${count} written offers on the property.`, action: "message" });
      pushMessage(n, { speaker: "system", text: `You told every buyer's agent with an offer that there are ${count} written offers.` });
      return;
    }
    case "set_disclosure": {
      if (action.disclosure === "details" && !n.client?.direction) throw new ActionError("Ask your sellers for their written direction first. Until you have it, you can only share how many offers there are.");
      if (action.disclosure === "details" && n.client?.direction !== "details") throw new ActionError("Your sellers directed you to share only the number of offers.");
      listing.disclosure = action.disclosure ?? "count_only";
      if (n.offerNight && listing.mode === "held") n.offerNight.disclosure = listing.disclosure;
      pushMessage(n, { speaker: "system", text: listing.disclosure === "details" ? "On your sellers' written direction, the contents of the offers will be shared with every buyer's agent who has made one." : "Only the number of offers will be shared." });
      return;
    }
    case "decline_competitor": {
      const c = liveOne(n, action.competitorId);
      if (listing.signBackOut?.competitorId === c.id) throw new ActionError("You've signed that one back. Wait for their answer.");
      c.status = "declined";
      pushMessage(n, { speaker: "system", text: `You let ${c.label}'s agent know your sellers won't be accepting it.` });
      return;
    }
    case "accept_competitor": {
      noSignBackOut(n);
      const c = liveOne(n, action.competitorId);
      const problems = clientViolations(s, n, c.terms);
      if (problems.length) throw new ActionError("Your sellers won't sign this.", problems);
      requireSignature(s, n, action);
      noteCountRule(s, n);
      sellToCompetitor(s, n, c, c.terms);
      return;
    }
    case "signback_competitor": {
      noSignBackOut(n);
      const c = liveOne(n, action.competitorId);
      const terms = parseTerms(action.terms);
      const problems = clientViolations(s, n, terms);
      if (problems.length) throw new ActionError("Your sellers won't sign this.", problems);
      requireSignature(s, n, action);
      noteCountRule(s, n);
      const answerAt = n.simHours + new Rng(s.seed + n.messages.length).int(2, 5);
      listing.signBackOut = { competitorId: c.id, terms, answerAt };
      // While it's out, the other side's open offer can't also be signed back or accepted.
      pushMessage(n, { speaker: "system", text: `Sign-back sent to ${c.label}'s agent at ${money(terms.price)}. They'll answer by ${simTime(s, answerAt)}. Until then, no other sign-back or acceptance can go out.` });
      return;
    }
    case "invite_back": {
      if (!relisting) throw new ActionError("You can invite buyers back only if the deal falls through.");
      const c = competitorById(n, action.competitorId);
      if (c.status === "registered" || c.status === "accepted") throw new ActionError(`${c.label} already has an offer in.`);
      if (listing.invites.some((i) => i.competitorId === c.id)) throw new ActionError(`You've already asked ${c.label}'s agent.`);
      const sinceDays = ((n.transaction ? n.transaction.day * 24 : 0) + n.simHours - (c.releasedAt ?? c.registeredAt)) / 24;
      const rng = new Rng(s.seed ^ (c.id.length * 7919 + Math.floor(sinceDays)));
      const window = { strong: 14, comparable: 9, weak: 5 }[c.strength];
      const chance = { strong: 0.85, comparable: 0.6, weak: 0.35 }[c.strength];
      const back = sinceDays <= window && rng.chance(chance);
      listing.invites.push({ competitorId: c.id, at: n.simHours, result: back ? "returned" : "moved_on" });
      pushMessage(n, { speaker: "user", text: text || `The deal on the property fell through. Are ${c.label}'s buyers still interested?`, action: "message" });
      if (!back) {
        c.status = "moved_on";
        pushMessage(n, { speaker: "system", text: `${c.label}'s agent says their buyers have moved on.` });
        return;
      }
      const price = Math.min(c.maxPrice, roundPrice(c.terms.price * 0.99));
      const completion = s.seller.idealClose > c.terms.completionDate ? s.seller.idealClose : c.terms.completionDate;
      c.terms = { ...c.terms, price, completionDate: completion, irrevocableHours: 24 };
      c.status = "registered";
      c.registeredAt = n.simHours;
      c.expiresAt = n.simHours + 24;
      pushMessage(n, { speaker: "system", text: `${c.label}'s buyers are still interested: a fresh offer at ${money(price)}, irrevocable until ${simTime(s, c.expiresAt)}. Present it to your sellers.`, event: "competing_offer" });
      return;
    }
    default:
      throw new ActionError("That isn't available right now.");
  }
}

// ---------- View ----------

export interface CompetitorView {
  id: string;
  label: string;
  terms: Terms;
  status: CompetitorOffer["status"];
  /** When offers are taken any time: the end of its irrevocable time. */
  expiresAt: string | null;
  invited: "returned" | "moved_on" | null;
}

/** What the listing user sees: each arrived offer's terms and status. Never a buyer's ceiling or strength. */
export interface ListingView {
  mode: ListingState["mode"];
  decided: boolean;
  competitors: CompetitorView[];
  signBackOut: { competitorId: string; label: string; price: number; answerAt: string } | null;
  writtenOffers: number;
  countDisclosed: boolean;
  disclosure: ListingState["disclosure"];
  canRelist: boolean;
}

export function listingView(s: Scenario, n: Negotiation): ListingView | null {
  const listing = n.listing;
  if (!listing || userSide(s) !== "seller") return null;
  const arrived = allCompetitors(n).filter((c) => c.registeredAt <= n.simHours || c.status !== "registered");
  const out = listing.signBackOut;
  const outC = out ? arrived.find((c) => c.id === out.competitorId) : undefined;
  return {
    mode: listing.mode,
    decided: listing.decided,
    competitors: arrived.map((c) => ({ id: c.id, label: c.label, terms: c.terms, status: c.status, expiresAt: c.expiresAt !== undefined ? simTime(s, c.expiresAt) : null, invited: listing.invites.find((i) => i.competitorId === c.id)?.result ?? null })),
    signBackOut: out && outC ? { competitorId: out.competitorId, label: outC.label, price: out.terms.price, answerAt: simTime(s, out.answerAt) } : null,
    writtenOffers: writtenOfferCount(s, n),
    countDisclosed: listing.countDisclosed,
    disclosure: listing.disclosure,
    canRelist: canRelist(s, n),
  };
}

/** For the debrief: the competing buyer the sellers sold to, if any. */
export function acceptedCompetitor(n: Negotiation): CompetitorOffer | null {
  const id = n.listing?.acceptedCompetitorId;
  return id ? (allCompetitors(n).find((c) => c.id === id) ?? null) : null;
}

