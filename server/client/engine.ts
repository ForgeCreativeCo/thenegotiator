// The conversation with the user's own client: reviewing and signing documents, presenting the other side's
// offers, written direction on offer night, and questions that bring out what the client hasn't said.

import { randomUUID } from "node:crypto";
import type { Scenario } from "../engine/types";
import { money } from "../narrative/format";
import { TermsSchema, normalizeTerms, type Terms } from "../negotiation/terms";
import { netPrice, violations } from "../negotiation/constraints";
import { registeredCompetitors } from "../negotiation/offerNight";
import type { Negotiation, Offer } from "../negotiation/types";
import { ActionError, userSide, type UserAction } from "../negotiation/engine";
import { clientFacts, extraRoom, requirementProblems, withClientAuthority } from "./facts";
import { chatDraft, clientVoice, directionDraft, presentDraft, reviewDraft, story, type PresentAssessment } from "./voice";
import { newClientState, type ClientFact, type ClientMessage, type ClientState, type ClientView, type Topic, type UncoveredHow } from "./types";

export const CLIENT_ACTIONS = ["client_message", "client_review", "client_present", "client_direction"] as const;

export function isClientAction(type: string): boolean {
  return (CLIENT_ACTIONS as readonly string[]).includes(type);
}

/** The client state, created on first use. Deals saved before it existed don't require signatures. */
export function clientOf(n: Negotiation): ClientState {
  return (n.client ??= newClientState(false));
}

function uncoveredIds(n: Negotiation): string[] {
  return (n.client?.uncovered ?? []).map((u) => u.factId);
}

export function uncover(n: Negotiation, fact: ClientFact, how: UncoveredHow): boolean {
  const c = clientOf(n);
  if (c.uncovered.some((u) => u.factId === fact.id)) return false;
  c.uncovered.push({ factId: fact.id, how, at: n.simHours });
  return true;
}

export function pushClient(n: Negotiation, m: Omit<ClientMessage, "id" | "at">): ClientMessage {
  const message = { id: randomUUID(), at: n.simHours, ...m };
  clientOf(n).messages.push(message);
  return message;
}

/** Everything the user's client won't sign in these terms: their brief (with any room they've given), plus their untold
 * requirements. Deals without the client conversation (saved before it, or engine simulations) use the brief alone. */
export function clientViolations(s: Scenario, n: Negotiation, terms: Terms): string[] {
  const brief = violations(userSide(s), withClientAuthority(s, uncoveredIds(n), terms), terms);
  return [...brief, ...activeRequirements(s, n, terms).map((p) => p.message)];
}

function activeRequirements(s: Scenario, n: Negotiation, terms: Terms) {
  return n.client?.reviewRequired ? requirementProblems(s, terms) : [];
}

// ---------- Documents and signatures ----------

interface Document {
  label: string;
  terms: Terms;
  key: string;
  /** The other side's offer this document accepts, if any. */
  offerId?: string;
}

function parseTerms(input: unknown): Terms {
  const parsed = TermsSchema.safeParse(input);
  if (!parsed.success) throw new ActionError("Those terms are incomplete.", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  return normalizeTerms(parsed.data);
}

function theirLatestOffer(s: Scenario, n: Negotiation): Offer | null {
  const theirs = userSide(s) === "buyer" ? "seller" : "buyer";
  return [...n.offers].reverse().find((o) => o.by === theirs && (o.status === "open" || o.status === "registered")) ?? null;
}

/** The document a signing action would put in front of the other side. */
export function documentFor(s: Scenario, n: Negotiation, action: UserAction): Document {
  const key = (parts: object) => JSON.stringify({ type: action.type, ...parts });
  switch (action.type) {
    case "offer": {
      const terms = parseTerms(action.terms);
      const signBack = userSide(s) === "seller" || n.offers.some((o) => o.by !== userSide(s));
      const label = action.preemptive ? "pre-emptive offer" : n.offerNight && n.offerNight.phase !== "done" && userSide(s) === "buyer" ? "offer for offer night" : signBack ? "sign-back" : "offer";
      return { label, terms, key: key({ preemptive: Boolean(action.preemptive), terms }) };
    }
    case "accept": {
      const offer = theirLatestOffer(s, n);
      if (!offer) throw new ActionError("There's no offer from the other side to accept.");
      return { label: "acceptance", terms: offer.terms, key: key({ offerId: offer.id }), offerId: offer.id };
    }
    case "accept_competitor":
    case "signback_competitor": {
      const c = n.offerNight?.competitors.find((x) => x.id === action.competitorId && x.status === "registered");
      if (!c) throw new ActionError("That offer isn't available.");
      const terms = action.type === "accept_competitor" ? c.terms : parseTerms(action.terms);
      return { label: action.type === "accept_competitor" ? `acceptance of ${c.label}` : `sign-back to ${c.label}`, terms, key: key({ competitorId: c.id, terms }) };
    }
    default:
      throw new ActionError("That doesn't need your client's signature.");
  }
}

/** Called by the negotiation engine before anything with legal effect goes out. Uses up the signature. */
export function requireSignature(s: Scenario, n: Negotiation, action: UserAction): void {
  const c = n.client;
  if (!c?.reviewRequired) return;
  const doc = documentFor(s, n, action);
  if (c.signature?.key !== doc.key) throw new ActionError(`Your ${userSide(s) === "buyer" ? "buyers haven't" : "sellers haven't"} signed this ${doc.label}. Review it with them first.`);
  c.signature = null;
}

// ---------- Actions ----------

const TOPIC_WORDS: [Topic, RegExp][] = [
  ["competition", /\b(other offers?|competing|bidding war|multiple offers|competition|offer night|other buyers|bully)\b/i],
  ["price", /\b(price|pay|budget|afford|stretch|higher|lower|how (high|low|much)|less|more money|bottom line|limit|max(imum)?|number)\b/i],
  ["timing", /\b(clos(e|ing)|completion|complete|move|moving|date|when|timeline|lease|possession|soon|time|timing|month|week)\b/i],
  ["deposit", /\b(deposit|cheque|certified|bank draft|down ?payment funds)\b/i],
  ["inspection", /\b(inspect(ion|or)?|furnace|roof|basement|foundation|repairs?|needs work|old house)\b/i],
  ["conditions", /\b(conditions?|firm|waive|waiving|conditional)\b/i],
  ["financing", /\b(mortgage|financing|pre-?approv(al|ed)|lender|bank|parents|down payment)\b/i],
  ["chattels", /\b(appliances?|chattels?|includ(e|ed|ing)|fridge|stove|washer|dryer|hot tub|furniture|shed|freezer|tv|leave behind|stay(s)? with)\b/i],
  ["fixtures", /\b(fixtures?|light(s|ing)?|chandelier|exclud(e|ed|ing)|tak(e|ing) with|workbench|drapes?|drapery|curtains?)\b/i],
  ["motivation", /\b(why|reason|important|matter|priorit(y|ies)|worr(y|ied)|concern(s|ed)?|nervous|anything else|else (i|we) should know|what else|tell me more)\b/i],
];

export function topicsIn(text: string): Topic[] {
  return TOPIC_WORDS.filter(([, re]) => re.test(text)).map(([t]) => t);
}

export function competitionKnown(s: Scenario, n: Negotiation): boolean {
  if (n.offerNight) return n.offerNight.countDisclosed && registeredCompetitors(n.offerNight, n.simHours).length > 0;
  return n.messages.some((m) => m.event === "competing_offer");
}

/** The untold fact a question brings out: the one on the most of its topics. Open questions bring out background only. */
function factFor(s: Scenario, n: Negotiation, topics: Topic[]): ClientFact | null {
  const known = uncoveredIds(n);
  const openOnly = topics.length > 0 && topics.every((t) => t === "motivation");
  const candidates = clientFacts(s)
    .filter((f) => !known.includes(f.id))
    .filter((f) => (openOnly ? f.effect.kind === "context" : true))
    .filter((f) => f.effect.kind !== "room_competition" || competitionKnown(s, n))
    .map((f) => ({ f, score: f.topics.filter((t) => topics.includes(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.f ?? null;
}

const clientsWord = (s: Scenario) => (userSide(s) === "buyer" ? "buyers" : "sellers");

export async function applyClientAction(s: Scenario, n: Negotiation, action: UserAction): Promise<void> {
  const c = clientOf(n);
  const text = (action.text ?? "").trim();
  const names = story(s).clientNames;

  switch (action.type) {
    case "client_message": {
      if (!text) throw new ActionError("Write a message first.");
      pushClient(n, { speaker: "user", text, kind: "chat" });
      const topics = topicsIn(text);
      const fact = factFor(s, n, topics);
      if (fact) uncover(n, fact, "asked");
      const draft = chatDraft(s, n, text, topics, fact, competitionKnown(s, n));
      const { text: reply } = await clientVoice(s, n, `[Your agent says] "${text}"`, draft);
      pushClient(n, { speaker: "client", text: reply, kind: "chat", factId: fact?.id });
      return;
    }

    case "client_review": {
      if (!action.pending) throw new ActionError("There's nothing to review.");
      const doc = documentFor(s, n, action.pending);
      const problems = clientViolations(s, n, doc.terms);
      const requirements = activeRequirements(s, n, doc.terms).map(({ fact }) => ({ fact, isNew: uncover(n, fact, "refusal") }));
      if (doc.offerId && !c.presented.includes(doc.offerId)) c.presented.push(doc.offerId);
      const verdict = problems.length ? "refused" : nearLimit(s, n, doc.terms) ? "reluctant" : "signed";
      c.signature = verdict === "refused" ? null : { key: doc.key, at: n.simHours };
      pushClient(n, { speaker: "user", text: text || `Here's the ${doc.label} at ${money(doc.terms.price)} for you to review.`, kind: "review" });
      const draft = reviewDraft(s, n, { verdict, document: doc.label, problems, requirements });
      const { text: reply } = await clientVoice(s, n, `[Your agent asks you to review and sign the ${doc.label}] Price ${money(doc.terms.price)}. ${verdict === "refused" ? `You refuse: ${problems.join("; ")}.` : verdict === "reluctant" ? "You sign, reluctantly." : "You sign."}`, draft);
      pushClient(n, { speaker: "client", text: reply, kind: "review", verdict, details: problems, factId: requirements.find((r) => r.isNew)?.fact.id });
      return;
    }

    case "client_present": {
      const assessment = presentOffers(s, n, action.offerId);
      pushClient(n, { speaker: "user", text: text || (assessment.count && assessment.count > 1 ? `The registered offers are in. Let's go through all ${assessment.count}.` : `${s.narrative.opposingAgent.name}'s ${assessment.label} came in at ${money(assessment.price)}. Here it is.`), kind: "present", offerId: action.offerId });
      const draft = presentDraft(s, n, assessment);
      const { text: reply } = await clientVoice(s, n, `[Your agent presents the other side's ${assessment.label}] Price ${money(assessment.price)}.`, draft);
      pushClient(n, { speaker: "client", text: reply, kind: "present", offerId: action.offerId, factId: assessment.missing.find((m) => m.isNew)?.fact.id });
      return;
    }

    case "client_direction": {
      if (userSide(s) !== "seller" || !n.offerNight) throw new ActionError("Written direction on disclosure is for the listing side on offer night.");
      if (c.direction) throw new ActionError(`Your sellers have already given you their direction.`);
      c.direction = s.offerNight?.sellerDisclosure ?? "count_only";
      pushClient(n, { speaker: "user", text: text || "Other buyers' agents may ask about the competing offers. How much do you want me to disclose? I'll need your direction in writing.", kind: "direction" });
      const { text: reply } = await clientVoice(s, n, "[Your agent asks for your written direction on disclosing competing offers]", directionDraft(s, n, c.direction));
      pushClient(n, { speaker: "client", text: reply, kind: "direction" });
      pushClient(n, { speaker: "system", text: `${names} signed a written direction: ${c.direction === "details" ? "disclose the contents of competing offers" : "disclose the number of offers only"}.`, kind: "direction" });
      return;
    }

    default:
      throw new ActionError("That isn't available right now.");
  }
}

/** Signs, but grudgingly, when the price is within 1% of list of the client's real limit. */
function nearLimit(s: Scenario, n: Negotiation, terms: Terms): boolean {
  const net = netPrice(s, terms);
  const room = extraRoom(s, uncoveredIds(n), terms);
  const margin = s.property.listPrice * 0.01;
  return userSide(s) === "buyer" ? net >= s.buyer.reservationPrice + room - margin : net <= s.seller.reservationPrice - room + margin;
}

function priceGap(s: Scenario, n: Negotiation, terms: Terms): number {
  const net = netPrice(s, terms);
  const room = extraRoom(s, uncoveredIds(n), terms);
  return userSide(s) === "buyer" ? net - (s.buyer.reservationPrice + room) : s.seller.reservationPrice - room - net;
}

function presentOffers(s: Scenario, n: Negotiation, offerId: string | undefined): PresentAssessment {
  const c = clientOf(n);
  const state = n.offerNight;
  let items: { id: string; label: string; terms: Terms }[];
  if (!offerId) {
    if (userSide(s) !== "seller" || !state || (state.phase !== "review" && state.phase !== "final_review")) throw new ActionError("Choose an offer to present.");
    const theirs = theirLatestOffer(s, n);
    items = [...(theirs ? [{ id: theirs.id, label: "offer", terms: theirs.terms }] : []), ...registeredCompetitors(state, n.simHours).map((x) => ({ id: `competitor:${x.id}`, label: x.label, terms: x.terms }))];
    const key = `offer-night:${state.phase}`;
    if (c.presented.includes(key)) throw new ActionError("You've already presented these offers.");
    c.presented.push(key, ...items.map((i) => i.id));
  } else {
    const offer = n.offers.find((o) => o.id === offerId && o.by !== userSide(s));
    if (!offer) throw new ActionError("That offer isn't from the other side.");
    if (c.presented.includes(offer.id)) throw new ActionError("You've already presented that offer.");
    c.presented.push(offer.id);
    items = [{ id: offer.id, label: offer.preemptive ? "pre-emptive offer" : n.offers.some((o) => o.by === userSide(s) && o.at <= offer.at) ? "sign-back" : "offer", terms: offer.terms }];
  }
  if (!items.length) throw new ActionError("There are no offers to present yet.");
  // The listing side weighs the best of them; one offer is weighed on its own.
  const best = items.reduce((a, b) => (priceGap(s, n, a.terms) <= priceGap(s, n, b.terms) ? a : b));
  const missing = activeRequirements(s, n, best.terms).map(({ fact }) => ({ fact, isNew: uncover(n, fact, "presented") }));
  // Brief problems other than price (the price gets its own reaction).
  const otherProblems = violations(userSide(s), withClientAuthority(s, uncoveredIds(n), best.terms), best.terms).filter((v) => !v.startsWith("Price")).length;
  return { label: items.length > 1 ? "offers" : best.label, price: best.terms.price, priceGap: priceGap(s, n, best.terms), otherProblems, missing, count: items.length };
}

// ---------- View ----------

export function clientView(s: Scenario, n: Negotiation): ClientView | null {
  const c = n.client;
  if (!c) return null;
  const facts = clientFacts(s);
  return {
    reviewRequired: c.reviewRequired,
    messages: c.messages,
    learned: c.uncovered.flatMap((u) => {
      const f = facts.find((x) => x.id === u.factId);
      return f ? [{ factId: u.factId, how: u.how, says: f.says }] : [];
    }),
    presented: c.presented,
    direction: c.direction,
  };
}
