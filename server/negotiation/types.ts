import type Anthropic from "@anthropic-ai/sdk";
import type { Side } from "../engine/types";
import type { Terms } from "./terms";

export type NegotiationStatus = "negotiating" | "under_contract" | "dead";
export type BotAction = "counter" | "accept" | "reject" | "hold" | "walk";
export type UserActionType = "message" | "offer" | "accept" | "walk";

export interface Offer {
  id: string;
  by: Side;
  terms: Terms;
  status: "open" | "countered" | "accepted" | "rejected" | "expired";
  at: number; // simulated hours since the scenario started
}

export interface NegotiationMessage {
  id: string;
  speaker: "user" | "bot" | "system";
  at: number;
  text: string;
  action?: BotAction | UserActionType;
  offerId?: string;
  event?: "competing_offer" | "deal" | "walk" | "client_update";
}

export interface BotTurnRecord {
  messageId: string;
  source: "claude" | "offline";
  internalNote: string;
  recommended: BotAction;
  validationIssues: string[];
}

export interface Negotiation {
  scenarioId: string;
  status: NegotiationStatus;
  simHours: number;
  messages: NegotiationMessage[];
  offers: Offer[];
  /** Private to the server: the bot's reasoning per turn, shown in the debrief. */
  botTurns: BotTurnRecord[];
  /** Private to the server: the exact Claude conversation, kept append-only. */
  llmHistory: Anthropic.Beta.BetaMessageParam[];
  announcedEvents: string[];
  acceptedOfferId: string | null;
  endedBy: "user" | "bot" | null;
}

/** What the browser receives. */
export interface NegotiationView {
  status: NegotiationStatus;
  simHours: number;
  messages: NegotiationMessage[];
  offers: Offer[];
  acceptedOfferId: string | null;
  endedBy: Negotiation["endedBy"];
}

export function negotiationView(n: Negotiation): NegotiationView {
  return { status: n.status, simHours: n.simHours, messages: n.messages, offers: n.offers, acceptedOfferId: n.acceptedOfferId, endedBy: n.endedBy };
}

export function newNegotiation(scenarioId: string): Negotiation {
  return { scenarioId, status: "negotiating", simHours: 0, messages: [], offers: [], botTurns: [], llmHistory: [], announcedEvents: [], acceptedOfferId: null, endedBy: null };
}
