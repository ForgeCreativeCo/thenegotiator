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
import type { Negotiation, NegotiationMessage, Offer, UserActionType } from "./types";
import { hasClaudeCredentials } from "../scenarioService";
import { createTransaction } from "../transaction/schedule";

function acceptedTerms(n: Negotiation): Terms {
  return n.offers.find((o) => o.id === n.acceptedOfferId)!.terms;
}

export interface UserAction {
  type: UserActionType;
  text?: string;
  terms?: Terms;
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
  return date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
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
  pushMessage(n, {
    speaker: "system",
    text: s.userRole === "buyer_agent" ? `You're representing the buyer. Write your offer to ${s.narrative.opposingAgent.name} when you're ready.` : `You're representing the seller. ${s.narrative.opposingAgent.name} is sending over an offer.`,
  });
  if (botSide(s) === "buyer") await runBotTurn(s, n, { userText: "", userTerms: null }, player);
}

export async function applyUserAction(s: Scenario, n: Negotiation, action: UserAction, player: BotPlayer = defaultBotPlayer): Promise<void> {
  if (n.status !== "negotiating") throw new ActionError("This negotiation is over.");
  const mine = userSide(s);
  const theirs = botSide(s);
  const text = (action.text ?? "").trim();

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
      pushMessage(n, { speaker: "system", text: `Mutual acceptance at ${money(theirOffer.terms.price)}. You're under contract.`, event: "deal" });
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
    if (offer.phase !== "pre_contract" || n.announcedEvents.includes(id) || offer.arrivesDay * 12 > n.simHours) return;
    n.announcedEvents.push(id);
    const summary = `Another buyer's agent submitted a ${offer.strength} offer at ${money(offer.price)}.`;
    if (side === "seller") newEvents.push(`${summary} This is real; you may mention it truthfully.`);
    else pushMessage(n, { speaker: "system", text: `${summary} You can use it as leverage, but you can't accept it in this simulation.`, event: "competing_offer" });
  });

  let clientUpdate: string | null = null;
  const update = s.groundTruth.clientEvents.find((e) => e.side === side && e.phase === "negotiation");
  if (update && round === 2 && !n.announcedEvents.includes("client-update")) {
    n.announcedEvents.push("client-update");
    clientUpdate = update.summary;
  }

  const rec = recommend(s, n);
  const ctx: TurnContext = { ...input, simTime: simTime(s, n.simHours), newEvents, clientUpdate };
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
      pushMessage(n, { speaker: "system", text: `Mutual acceptance at ${money(userOffer.terms.price)}. You're under contract.`, event: "deal" });
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
