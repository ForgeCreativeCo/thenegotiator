// Runs the negotiation: applies the user's moves, advances the simulated clock, fires events,
// and plays the opposing agent's turn.

import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Scenario, Side } from "../engine/types";
import { Rng } from "../engine/rng";
import { money } from "../narrative/format";
import { TermsSchema, normalizeTerms, type Terms } from "./terms";
import { violations } from "./constraints";
import { botSide, recommend, type Recommendation } from "./strategy";
import { offlineTurn, type BotTurn } from "./botOffline";
import { claudeTurn, type TurnContext } from "./botClaude";
import type { Negotiation, NegotiationMessage, Offer, OfferNightView, UserActionType } from "./types";
import { sellerViolations } from "./constraints";
import { botBuyerBid, botBuyerTerms, competitorAccepts, disclosedSummary, improveCompetitors, initOfferNight, offerScore, rankOffers, registeredCompetitors, sellerDecision, type OfferNightState } from "./offerNight";
import { hasClaudeCredentials } from "../scenarioService";
import { createTransaction } from "../transaction/schedule";

function acceptedTerms(n: Negotiation): Terms {
  return n.offers.find((o) => o.id === n.acceptedOfferId)!.terms;
}

export interface UserAction {
  type: UserActionType;
  text?: string;
  terms?: Terms;
  /** A bully offer made before offer night. */
  preemptive?: boolean;
  competitorId?: string;
  disclosure?: "count_only" | "details";
}

export class ActionError extends Error {
  constructor(
    message: string,
    public details: string[] = [],
  ) {
    super(message);
  }
}

export type BotPlayer = (s: Scenario, rec: Recommendation, ctx: TurnContext, history: Anthropic.Beta.BetaMessageParam[], round: number) => Promise<BotTurn & { source: "claude" | "offline"; issues: string[] }>;

/** Claude when credentials exist, falling back to the offline agent if a turn fails. */
export const defaultBotPlayer: BotPlayer = async (s, rec, ctx, history, round) => {
  if (hasClaudeCredentials()) {
    try {
      const turn = await claudeTurn(s, rec, ctx, history);
      return { ...turn, source: "claude" };
    } catch (error) {
      console.warn(`Claude bot turn failed, using offline agent: ${(error as Error).message}`);
      const turn = offlineTurn(s, rec, ctx.userTerms, round, ctx.clientUpdate);
      // Keep the Claude conversation append-only and alternating.
      history.push({ role: "assistant", content: JSON.stringify({ action: turn.action, terms: turn.terms, message: turn.message }) });
      return { ...turn, source: "offline", issues: [(error as Error).message] };
    }
  }
  return { ...offlineTurn(s, rec, ctx.userTerms, round, ctx.clientUpdate), source: "offline", issues: [] };
};

export function userSide(s: Scenario): Side {
  return s.userRole === "buyer_agent" ? "buyer" : "seller";
}

export function simTime(s: Scenario, hours: number): string {
  const date = new Date(new Date(`${s.startDate}T09:00:00Z`).getTime() + hours * 3_600_000);
  return date.toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function lastOpenOffer(n: Negotiation, by: Side): Offer | null {
  const offer = [...n.offers].reverse().find((o) => o.by === by);
  return offer && offer.status === "open" ? offer : null;
}

export function pushMessage(n: Negotiation, m: Omit<NegotiationMessage, "id" | "at">): NegotiationMessage {
  const message = { id: randomUUID(), at: n.simHours, ...m };
  n.messages.push(message);
  return message;
}

function sideLabel(side: Side): string {
  return side === "buyer" ? "buyer" : "seller";
}

/** The opening move. If the bot represents the buyer, it makes the first offer. */
export async function startNegotiation(s: Scenario, n: Negotiation, player: BotPlayer = defaultBotPlayer): Promise<void> {
  if (n.messages.length > 0) return;
  if (s.offerNight && !n.offerNight) n.offerNight = initOfferNight(s);
  pushMessage(n, {
    speaker: "system",
    text: s.userRole === "buyer_agent" ? `You're representing the buyer. ${n.offerNight ? "" : `Write your offer to ${s.narrative.opposingAgent.name} when you're ready.`}`.trim() : `You're representing the seller.${n.offerNight ? "" : ` ${s.narrative.opposingAgent.name} is sending over an offer.`}`,
  });
  if (n.offerNight) return startOfferNight(s, n, n.offerNight);
  if (botSide(s) === "buyer") await runBotTurn(s, n, { userText: "", userTerms: null }, player);
}

export async function applyUserAction(s: Scenario, n: Negotiation, action: UserAction, player: BotPlayer = defaultBotPlayer): Promise<void> {
  if (n.status !== "negotiating") throw new ActionError("This negotiation is over.");
  const mine = userSide(s);
  const theirs = botSide(s);
  const text = (action.text ?? "").trim();
  if (n.offerNight && n.offerNight.phase !== "done") return offerNightAction(s, n, n.offerNight, action, player);

  switch (action.type) {
    case "message": {
      if (!text) throw new ActionError("Write a message first.");
      pushMessage(n, { speaker: "user", text, action: "message" });
      await runBotTurn(s, n, { userText: text, userTerms: null }, player);
      return;
    }
    case "offer": {
      const parsed = TermsSchema.safeParse(action.terms);
      if (!parsed.success) throw new ActionError("Those terms are incomplete.", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      const terms = normalizeTerms(parsed.data);
      const problems = violations(mine, s, terms);
      if (problems.length) throw new ActionError(`Your ${sideLabel(mine)} won't sign this.`, problems);
      const theirOffer = lastOpenOffer(n, theirs);
      if (theirOffer) theirOffer.status = "countered";
      const offer: Offer = { id: randomUUID(), by: mine, terms, status: "open", at: n.simHours };
      n.offers.push(offer);
      pushMessage(n, { speaker: "user", text, action: "offer", offerId: offer.id });
      await runBotTurn(s, n, { userText: text, userTerms: terms }, player);
      return;
    }
    case "accept": {
      const theirOffer = lastOpenOffer(n, theirs);
      if (!theirOffer) throw new ActionError("There's no offer from the other side to accept.");
      const problems = violations(mine, s, theirOffer.terms);
      if (problems.length) throw new ActionError(`Your ${sideLabel(mine)} won't sign this.`, problems);
      theirOffer.status = "accepted";
      n.acceptedOfferId = theirOffer.id;
      n.status = "under_contract";
      n.transaction = createTransaction(s, acceptedTerms(n), n.simHours);
      n.endedBy = "user";
      pushMessage(n, { speaker: "user", text: text || "We accept.", action: "accept", offerId: theirOffer.id });
      pushMessage(n, { speaker: "system", text: `Agreement of Purchase and Sale accepted at ${money(theirOffer.terms.price)}, ${theirOffer.terms.conditions.length ? "conditional" : "firm"}.`, event: "deal" });
      return;
    }
    case "walk": {
      const theirOffer = lastOpenOffer(n, theirs);
      if (theirOffer) theirOffer.status = "rejected";
      n.status = "dead";
      n.endedBy = "user";
      pushMessage(n, { speaker: "user", text: text || "We're going to pass. Thanks for your time.", action: "walk" });
      pushMessage(n, { speaker: "system", text: "You walked away from the deal.", event: "walk" });
      return;
    }
    default:
      throw new ActionError("That isn't available right now.");
  }
}

async function runBotTurn(s: Scenario, n: Negotiation, input: Pick<TurnContext, "userText" | "userTerms">, player: BotPlayer): Promise<void> {
  const round = n.botTurns.length + 1;
  const rng = new Rng(s.seed + round * 104_729);
  const side = botSide(s);
  const hasOffer = Boolean(input.userTerms) || round === 1;
  n.simHours += hasOffer ? rng.int(1, s.difficulty.temperament === "cagey" ? 20 : 8) : rng.int(0, 2) + 0.5;

  // Competing offers that have arrived by now. The listing side hears about them; the buyer's side doesn't.
  const newEvents: string[] = [];
  s.groundTruth.competingOffers.forEach((offer, i) => {
    const id = `competing-${i}`;
    // Offer-night scenarios handle competing buyers through registration instead.
    if (n.offerNight || offer.phase !== "pre_contract" || n.announcedEvents.includes(id) || offer.arrivesDay * 12 > n.simHours) return;
    n.announcedEvents.push(id);
    const summary = `Another buyer's agent submitted a ${offer.strength} offer at ${money(offer.price)}.`;
    if (side === "seller") newEvents.push(`${summary} This is real; you may mention it truthfully.`);
    else pushMessage(n, { speaker: "system", text: `${summary} You can tell the buyer's agent how many competing offers you have, but not their details without your seller's direction.`, event: "competing_offer" });
  });

  let clientUpdate: string | null = null;
  const update = s.groundTruth.clientEvents.find((e) => e.side === side && e.phase === "negotiation");
  if (update && round === 2 && !n.announcedEvents.includes("client-update")) {
    n.announcedEvents.push("client-update");
    clientUpdate = update.summary;
  }

  const rec = recommend(s, n);
  const competingOffers = side === "seller" ? n.announcedEvents.filter((e) => e.startsWith("competing-")).length : null;
  const ctx: TurnContext = { ...input, simTime: simTime(s, n.simHours), newEvents, clientUpdate, competingOffers };
  const turn = await player(s, rec, ctx, n.llmHistory, round);
  const userOffer = lastOpenOffer(n, userSide(s));

  const message = pushMessage(n, { speaker: "bot", text: turn.message, action: turn.action });
  switch (turn.action) {
    case "counter": {
      if (!turn.terms) break;
      if (userOffer) userOffer.status = "countered";
      const offer: Offer = { id: randomUUID(), by: side, terms: turn.terms, status: "open", at: n.simHours };
      n.offers.push(offer);
      message.offerId = offer.id;
      break;
    }
    case "accept": {
      if (!userOffer) break;
      userOffer.status = "accepted";
      message.offerId = userOffer.id;
      n.acceptedOfferId = userOffer.id;
      n.status = "under_contract";
      n.transaction = createTransaction(s, acceptedTerms(n), n.simHours);
      n.endedBy = "bot";
      pushMessage(n, { speaker: "system", text: `Agreement of Purchase and Sale accepted at ${money(userOffer.terms.price)}, ${userOffer.terms.conditions.length ? "conditional" : "firm"}.`, event: "deal" });
      break;
    }
    case "reject":
      if (userOffer) userOffer.status = "rejected";
      break;
    case "walk":
      if (userOffer) userOffer.status = "rejected";
      n.status = "dead";
      n.endedBy = "bot";
      pushMessage(n, { speaker: "system", text: `${s.narrative.opposingAgent.name} walked away from the deal.`, event: "walk" });
      break;
    case "hold":
      break;
  }

  n.botTurns.push({ messageId: message.id, source: turn.source, internalNote: turn.internalNote, recommended: rec.action, validationIssues: turn.issues });
}

// ---------- Offer nights ----------

/** Ends a sentence that may already end in "p.m." or "a.m.". */
function dot(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function enterContract(s: Scenario, n: Negotiation, offer: Offer, endedBy: "user" | "bot"): void {
  offer.status = "accepted";
  n.acceptedOfferId = offer.id;
  n.status = "under_contract";
  n.transaction = createTransaction(s, offer.terms, n.simHours);
  n.endedBy = endedBy;
  pushMessage(n, { speaker: "system", text: `Agreement of Purchase and Sale accepted at ${money(offer.terms.price)}, ${offer.terms.conditions.length ? "conditional" : "firm"}.`, event: "deal" });
}

function releaseCompetitors(state: OfferNightState, exceptId?: string): void {
  for (const c of state.competitors) if (c.status === "registered" && c.id !== exceptId) c.status = "released";
}

function registeredOffer(n: Negotiation, by: Side): Offer | null {
  return [...n.offers].reverse().find((o) => o.by === by && o.status === "registered") ?? null;
}

function roundBid(value: number): number {
  return value < 1_000_000 ? Math.round(value / 1_000) * 1_000 : Math.round(value / 5_000) * 5_000;
}

/** Sets up the offer night and, if the bot represents a buyer, registers its offer or tries a bully. */
async function startOfferNight(s: Scenario, n: Negotiation, state: OfferNightState): Promise<void> {
  const when = simTime(s, state.reviewAtHours);
  const pre = state.preemptives === "considered" ? "Pre-emptive offers will be considered." : "No pre-emptive offers.";
  if (s.userRole === "buyer_agent") {
    pushMessage(n, { speaker: "system", text: `Offer night: the sellers are holding offers until ${dot(when)} ${pre} Register your buyers' offer with the listing brokerage before then${state.preemptives === "considered" ? ", or try a pre-emptive offer" : ""}.` });
    return;
  }
  const direction = s.offerNight?.sellerDisclosure === "details" ? "disclose the contents of competing offers to the buyers' agents (TRESA)" : "disclose only the number of competing offers";
  pushMessage(n, { speaker: "system", text: `Offer night: your sellers are holding offers until ${dot(when)} ${pre} Their written direction is to ${direction}.` });
  n.simHours += 3;
  const bully = state.preemptives === "considered" && (s.buyer.urgency >= 4 || s.difficulty.temperament === "hardball");
  if (bully) {
    const terms = botBuyerTerms(s, roundBid(Math.min(s.buyer.reservationPrice * 0.98, s.property.listPrice * 1.08)), 4);
    const offer: Offer = { id: randomUUID(), by: "buyer", terms, status: "open", at: n.simHours, preemptive: true };
    n.offers.push(offer);
    pushMessage(n, { speaker: "bot", text: `I know you're holding offers, but my buyers don't want to wait. Here's a pre-emptive offer at ${money(terms.price)}, ${terms.conditions.length ? "with short conditions" : "firm"}, ${money(terms.deposit)} deposit herewith, irrevocable for 4 hours.`, action: "offer", offerId: offer.id });
  } else {
    registerBotBid(s, n, 1, null, state.competitors.length);
  }
}

function registerBotBid(s: Scenario, n: Negotiation, round: 1 | 2, topKnown: number | null, competitorCount: number): Offer {
  const previous = registeredOffer(n, "buyer");
  const price = botBuyerBid(s, round, previous?.terms.price ?? null, topKnown, competitorCount);
  if (previous) previous.status = "expired";
  const offer: Offer = { id: randomUUID(), by: "buyer", terms: botBuyerTerms(s, price, 3), status: "registered", at: n.simHours, preemptive: false };
  n.offers.push(offer);
  pushMessage(n, { speaker: "bot", text: round === 1 ? "Our offer is registered with your brokerage for offer night." : "Here's our improved offer. That's our best.", action: "offer", offerId: offer.id });
  return offer;
}

/** The opposing listing agent reviews the registered offers (the user is a buyer's agent). */
async function sellerReviews(s: Scenario, n: Negotiation, state: OfferNightState, round: 1 | 2, player: BotPlayer): Promise<void> {
  const mine = registeredOffer(n, "buyer");
  const competitors = registeredCompetitors(state, n.simHours);
  const ranked = rankOffers(s, [
    ...(mine ? [{ ref: { kind: "user" as const, offerId: mine.id }, terms: mine.terms }] : []),
    ...competitors.map((c) => ({ ref: { kind: "competitor" as const, competitorId: c.id }, terms: c.terms })),
  ]);
  if (!ranked.length) {
    state.phase = "done";
    pushMessage(n, { speaker: "system", text: "No offers were registered. The listing is open for regular offers again." });
    return;
  }
  const decision = sellerDecision(s, ranked, round);
  if (decision.kind === "improve") {
    state.phase = "improvement";
    state.improvementDeadlineHours = n.simHours + 2;
    state.countDisclosed = true;
    state.disclosure = s.offerNight?.sellerDisclosure ?? "count_only";
    const details = state.disclosure === "details" ? ` On my sellers' direction, here are the competing offers: ${disclosedSummary(state)}.` : "";
    pushMessage(n, { speaker: "bot", text: `We have ${plural(ranked.length, "offer")}${mine ? ", including yours" : ""}. My sellers are sending everyone back to improve. Best offers by ${dot(simTime(s, state.improvementDeadlineHours))}${details}`, action: "message" });
    return;
  }
  state.phase = "done";
  const best = decision.offer;
  if (best.ref.kind === "user" && mine) {
    releaseCompetitors(state);
    if (decision.kind === "accept") {
      state.outcome = { kind: "user_offer_accepted" };
      pushMessage(n, { speaker: "bot", text: `Congratulations: out of ${plural(ranked.length, "offer")}, my sellers have accepted yours.`, action: "accept", offerId: mine.id });
      enterContract(s, n, mine, "bot");
    } else {
      state.outcome = { kind: "continued_with_sign_back" };
      mine.status = "open";
      pushMessage(n, { speaker: "system", text: `Your buyers' offer ranked first of ${plural(ranked.length, "offer")}, but not good enough to accept as is. The sellers are signing it back.` });
      await runBotTurn(s, n, { userText: "", userTerms: mine.terms }, player);
    }
    return;
  }
  const ref = best.ref;
  const winner = state.competitors.find((c) => ref.kind === "competitor" && c.id === ref.competitorId)!;
  if (decision.kind === "sign_back" && winner.maxPrice < s.seller.reservationPrice && mine) {
    state.outcome = { kind: "continued_with_sign_back" };
    releaseCompetitors(state);
    mine.status = "open";
    pushMessage(n, { speaker: "system", text: "None of the offers met the sellers' price and the other buyers dropped out. The sellers are signing your buyers' offer back." });
    await runBotTurn(s, n, { userText: "", userTerms: mine.terms }, player);
    return;
  }
  winner.status = "accepted";
  releaseCompetitors(state, winner.id);
  state.outcome = { kind: "competitor_accepted", competitorId: winner.id };
  if (mine) mine.status = "rejected";
  n.status = "lost";
  n.endedBy = "bot";
  pushMessage(n, { speaker: "bot", text: mine ? `Thanks for competing. Out of ${plural(ranked.length, "offer")}, my sellers have accepted another one. I'm sorry it wasn't your buyers this time.` : "My sellers accepted one of the registered offers. Your buyers didn't have an offer in.", action: "walk" });
  pushMessage(n, { speaker: "system", text: "Another buyer won the property.", event: "walk" });
}

async function offerNightAction(s: Scenario, n: Negotiation, state: OfferNightState, action: UserAction, player: BotPlayer): Promise<void> {
  const text = (action.text ?? "").trim();
  const mine = userSide(s);
  const parseTerms = (): Terms => {
    const parsed = TermsSchema.safeParse(action.terms);
    if (!parsed.success) throw new ActionError("Those terms are incomplete.", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    const terms = normalizeTerms(parsed.data);
    const problems = violations(mine, s, terms);
    if (problems.length) throw new ActionError(`Your ${sideLabel(mine)} won't sign this.`, problems);
    return terms;
  };

  if (action.type === "walk") {
    state.phase = "done";
    for (const o of n.offers) if (o.status === "registered" || o.status === "open") o.status = "rejected";
    n.status = "dead";
    n.endedBy = "user";
    pushMessage(n, { speaker: "user", text: text || (mine === "buyer" ? "My buyers are withdrawing." : "My sellers aren't accepting any of the offers."), action: "walk" });
    pushMessage(n, { speaker: "system", text: mine === "buyer" ? "You withdrew from offer night." : "Your sellers rejected all offers. The property stays on the market.", event: "walk" });
    return;
  }

  if (mine === "buyer") return buyerOfferNightAction(s, n, state, action, text, parseTerms, player);
  return sellerOfferNightAction(s, n, state, action, text, parseTerms, player);
}

async function buyerOfferNightAction(s: Scenario, n: Negotiation, state: OfferNightState, action: UserAction, text: string, parseTerms: () => Terms, player: BotPlayer): Promise<void> {
  const count = registeredCompetitors(state, n.simHours).length;
  switch (action.type) {
    case "message": {
      if (!text) throw new ActionError("Write a message first.");
      pushMessage(n, { speaker: "user", text, action: "message" });
      n.simHours += 1;
      state.countDisclosed = true;
      const where = state.phase === "improvement" ? `Improved offers are due by ${simTime(s, state.improvementDeadlineHours!)}` : `We're holding offers until ${simTime(s, state.reviewAtHours)}`;
      pushMessage(n, { speaker: "bot", text: `${dot(where)} Right now there ${count === 1 ? "is" : "are"} ${plural(count, "other registered offer")}. Get your best in.`, action: "hold" });
      return;
    }
    case "offer": {
      if (state.phase !== "registration" && state.phase !== "improvement") throw new ActionError("Offers aren't being taken right now.");
      const terms = parseTerms();
      if (action.preemptive) {
        if (state.phase !== "registration") throw new ActionError("It's too late for a pre-emptive offer.");
        const offer: Offer = { id: randomUUID(), by: "buyer", terms, status: "open", at: n.simHours, preemptive: true };
        n.offers.push(offer);
        pushMessage(n, { speaker: "user", text: text || `Pre-emptive offer attached, irrevocable for ${terms.irrevocableHours} hours.`, action: "offer", offerId: offer.id });
        n.simHours += 2;
        if (state.preemptives === "not_accepted") {
          offer.status = "rejected";
          pushMessage(n, { speaker: "bot", text: `My sellers won't look at anything before ${dot(simTime(s, state.reviewAtHours))} Register it for offer night and it'll be presented with the others.`, action: "reject" });
          return;
        }
        // A seller takes a bully only if it beats what they expect offer night to bring.
        const expected = Math.max(0, ...state.competitors.map((c) => offerScore(s, { ...c.terms, price: c.maxPrice })));
        if (sellerViolations(s.seller, terms, s).length === 0 && offerScore(s, terms) >= expected + s.property.listPrice * 0.01) {
          releaseCompetitors(state);
          state.phase = "done";
          state.outcome = { kind: "preemptive_accepted" };
          pushMessage(n, { speaker: "bot", text: "My sellers have decided to take it. Congratulations. The other registrants will be told the property is sold.", action: "accept", offerId: offer.id });
          enterContract(s, n, offer, "bot");
        } else {
          offer.status = "rejected";
          pushMessage(n, { speaker: "bot", text: `Thanks, but my sellers will wait for offer night. Register before ${simTime(s, state.reviewAtHours)} if you'd like to be considered.`, action: "reject" });
        }
        return;
      }
      const previous = registeredOffer(n, "buyer");
      if (previous) previous.status = "expired";
      const offer: Offer = { id: randomUUID(), by: "buyer", terms, status: "registered", at: n.simHours };
      n.offers.push(offer);
      state.countDisclosed = true;
      pushMessage(n, { speaker: "user", text: text || (state.phase === "improvement" ? "Our improved offer is attached." : "Please register our offer for offer night."), action: "offer", offerId: offer.id });
      pushMessage(n, { speaker: "system", text: `Offer registered with the listing brokerage. The listing agent confirms there ${count === 1 ? "is" : "are"} ${plural(count, "other registered offer")} so far.` });
      return;
    }
    case "review": {
      if (state.phase === "registration") {
        n.simHours = Math.max(n.simHours, state.reviewAtHours);
        pushMessage(n, { speaker: "system", text: `It's ${dot(simTime(s, n.simHours))} The sellers are reviewing the offers.` });
        return sellerReviews(s, n, state, 1, player);
      }
      if (state.phase === "improvement") {
        const mineNow = registeredOffer(n, "buyer");
        improveCompetitors(s, state, new Rng(s.seed ^ 0x1a1a), state.disclosure === "details" && mineNow ? mineNow.terms.price : null);
        n.simHours = Math.max(n.simHours, state.improvementDeadlineHours ?? n.simHours);
        pushMessage(n, { speaker: "system", text: `It's ${dot(simTime(s, n.simHours))} The sellers are reviewing the improved offers.` });
        return sellerReviews(s, n, state, 2, player);
      }
      throw new ActionError("There's nothing to review right now.");
    }
    default:
      throw new ActionError("That isn't available during offer night.");
  }
}

async function sellerOfferNightAction(s: Scenario, n: Negotiation, state: OfferNightState, action: UserAction, text: string, parseTerms: () => Terms, player: BotPlayer): Promise<void> {
  const botOffer = () => [...n.offers].reverse().find((o) => o.by === "buyer" && (o.status === "registered" || o.status === "open")) ?? null;
  switch (action.type) {
    case "message": {
      if (!text) throw new ActionError("Write a message first.");
      pushMessage(n, { speaker: "user", text, action: "message" });
      n.simHours += 1;
      if (/\b(\d+|one|two|three|four|five|six|seven|no)\b[^.]*\boffers?\b/i.test(text)) state.countDisclosed = true;
      pushMessage(n, { speaker: "bot", text: state.countDisclosed ? "Thanks, that's helpful. We'll be ready." : "Thanks. How many offers are registered right now?", action: "hold" });
      return;
    }
    case "set_disclosure": {
      if (action.disclosure === "details" && s.offerNight?.sellerDisclosure !== "details") throw new ActionError("Your sellers haven't directed you in writing to disclose the contents of offers. Without that direction, you can only share how many offers there are.");
      state.disclosure = action.disclosure ?? "count_only";
      pushMessage(n, { speaker: "system", text: state.disclosure === "details" ? "On your sellers' written direction, the contents of the offers will be disclosed to every registered buyer." : "Only the number of offers will be disclosed." });
      return;
    }
    case "decline": {
      const pre = botOffer();
      if (!pre?.preemptive || pre.status !== "open") throw new ActionError("There's no pre-emptive offer to decline.");
      pre.status = "rejected";
      pushMessage(n, { speaker: "user", text: text || "My sellers will wait for offer night. Please register for the review.", action: "message" });
      n.simHours += 1;
      registerBotBid(s, n, 1, null, state.competitors.length);
      return;
    }
    case "accept": {
      const offer = botOffer();
      if (!offer) throw new ActionError("There's no offer from that buyer to accept.");
      if (offer.status === "registered" && state.phase === "registration") throw new ActionError("Registered offers are opened at the review. Go to the offer review first.");
      const problems = violations("seller", s, offer.terms);
      if (problems.length) throw new ActionError("Your seller won't sign this.", problems);
      releaseCompetitors(state);
      state.phase = "done";
      state.outcome = { kind: offer.preemptive ? "preemptive_accepted" : "bot_offer_accepted" };
      pushMessage(n, { speaker: "user", text: text || "My sellers accept. Congratulations.", action: "accept", offerId: offer.id });
      enterContract(s, n, offer, "user");
      return;
    }
    case "offer": {
      // Signing back the bot buyer's offer ends offer night; it becomes a normal back-and-forth.
      const offer = botOffer();
      if (!offer) throw new ActionError("There's no offer from that buyer to sign back.");
      if (offer.status === "registered" && state.phase === "registration") throw new ActionError("Registered offers are opened at the review. Go to the offer review first.");
      const terms = parseTerms();
      offer.status = "countered";
      releaseCompetitors(state);
      state.phase = "done";
      state.outcome = { kind: "continued_with_sign_back" };
      const signBack: Offer = { id: randomUUID(), by: "seller", terms, status: "open", at: n.simHours };
      n.offers.push(signBack);
      pushMessage(n, { speaker: "user", text: text || "We're signing back your offer.", action: "offer", offerId: signBack.id });
      pushMessage(n, { speaker: "system", text: "The other registered buyers are told the sellers are working with one offer." });
      await runBotTurn(s, n, { userText: text, userTerms: terms }, player);
      return;
    }
    case "review": {
      if (state.phase !== "registration") throw new ActionError("Offers are already under review.");
      const pre = botOffer();
      if (pre?.preemptive && pre.status === "open") pre.status = "expired";
      if (!registeredOffer(n, "buyer")) registerBotBid(s, n, 1, null, state.competitors.length);
      n.simHours = Math.max(n.simHours, state.reviewAtHours);
      state.phase = "review";
      state.countDisclosed = true;
      const total = registeredCompetitors(state, n.simHours).length + 1;
      pushMessage(n, { speaker: "system", text: `It's ${dot(simTime(s, n.simHours))} You have ${plural(total, "offer")} to present to your sellers. As the Code of Ethics requires, each registered buyer's agent is told there are ${total}.` });
      return;
    }
    case "improve": {
      if (state.phase !== "review") throw new ActionError("You can only send offers back once, at the first review.");
      state.phase = "final_review";
      state.improvementDeadlineHours = n.simHours + 2;
      const competitors = registeredCompetitors(state, n.simHours);
      const topCompetitor = Math.max(0, ...competitors.map((c) => c.terms.price));
      const botNow = registeredOffer(n, "buyer");
      improveCompetitors(s, state, new Rng(s.seed ^ 0x2b2b), state.disclosure === "details" && botNow ? botNow.terms.price : null);
      pushMessage(n, { speaker: "user", text: text || "My sellers are sending all offers back to improve.", action: "message" });
      n.simHours = state.improvementDeadlineHours;
      registerBotBid(s, n, 2, state.disclosure === "details" ? topCompetitor : null, competitors.length);
      pushMessage(n, { speaker: "system", text: `It's ${dot(simTime(s, n.simHours))} The improved offers are in.` });
      return;
    }
    case "accept_competitor":
    case "signback_competitor": {
      if (state.phase !== "review" && state.phase !== "final_review") throw new ActionError("Offers are opened at the review.");
      const c = state.competitors.find((x) => x.id === action.competitorId && x.status === "registered");
      if (!c) throw new ActionError("That offer isn't available.");
      const terms = action.type === "accept_competitor" ? c.terms : parseTerms();
      const problems = violations("seller", s, terms);
      if (problems.length) throw new ActionError("Your seller won't sign this.", problems);
      if (action.type === "signback_competitor" && !competitorAccepts(c, terms)) {
        c.status = "released";
        pushMessage(n, { speaker: "system", text: `${c.label}'s buyers declined the sign-back and withdrew.` });
        return;
      }
      c.terms = terms;
      c.status = "accepted";
      releaseCompetitors(state, c.id);
      for (const o of n.offers) if (o.status === "registered" || o.status === "open") o.status = "rejected";
      state.phase = "done";
      state.outcome = { kind: "competitor_accepted", competitorId: c.id };
      n.status = "sold_to_other";
      n.endedBy = "user";
      pushMessage(n, { speaker: "system", text: `Your sellers accepted ${c.label} at ${money(terms.price)}, ${terms.conditions.length ? "conditional" : "firm"}. ${s.narrative.opposingAgent.name}'s buyers are told they weren't successful.`, event: "deal" });
      return;
    }
    default:
      throw new ActionError("That isn't available during offer night.");
  }
}

/** What this user can see of the offer night. A buyer sees competing offers only if the seller directed disclosure. */
export function offerNightView(s: Scenario, n: Negotiation): OfferNightView | null {
  const state = n.offerNight;
  if (!state) return null;
  const seller = s.userRole === "seller_agent";
  const visible = [...registeredCompetitors(state, n.simHours), ...state.competitors.filter((c) => c.status === "accepted")];
  const showCompetitors = seller ? state.phase !== "registration" : state.disclosure === "details" && state.phase !== "registration";
  return {
    reviewAt: simTime(s, state.reviewAtHours),
    reviewAtHours: state.reviewAtHours,
    preemptives: state.preemptives,
    phase: state.phase,
    disclosure: state.disclosure,
    sellerDirection: seller ? (s.offerNight?.sellerDisclosure ?? "count_only") : null,
    competingCount: seller || state.countDisclosed ? registeredCompetitors(state, n.simHours).length : null,
    competitors: showCompetitors
      ? visible.map((c) => ({ id: c.id, label: c.label, price: c.terms.price, deposit: c.terms.deposit, conditions: c.terms.conditions.map((x) => x.key), completionDate: c.terms.completionDate, status: c.status, terms: seller ? c.terms : null }))
      : [],
    improvementDeadline: state.improvementDeadlineHours !== null ? simTime(s, state.improvementDeadlineHours) : null,
    outcome: state.outcome,
  };
}
