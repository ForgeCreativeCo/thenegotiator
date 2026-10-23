import type Anthropic from "@anthropic-ai/sdk";
import type { Side } from "../engine/types";
import type { Terms } from "./terms";
import type { Transaction } from "../transaction/types";
import type { TransactionClientView } from "../transaction/engine";
import type { OfferNightState } from "./offerNight";
import type { Critique } from "../coach/debrief";

/** lost = the buyer's offer lost on offer night; sold_to_other = the listing side accepted a competing buyer. */
export type NegotiationStatus = "negotiating" | "under_contract" | "dead" | "lost" | "sold_to_other";
export type BotAction = "counter" | "accept" | "reject" | "hold" | "walk";
export type UserActionType = "message" | "offer" | "accept" | "walk" | "review" | "improve" | "decline" | "accept_competitor" | "signback_competitor" | "set_disclosure";

export interface Offer {
  id: string;
  by: Side;
  terms: Terms;
  /** registered = held for offer night, not yet reviewed. */
  status: "open" | "registered" | "countered" | "accepted" | "rejected" | "expired";
  preemptive?: boolean;
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
  /** Created at mutual acceptance; runs from contract to closing. */
  transaction: Transaction | null;
  /** Present when the listing holds offers for an offer night. Absent on older saved negotiations. */
  offerNight?: OfferNightState | null;
  /** Actions the user tried that their client or the rules refused; the debrief reviews them. */
  attempts?: RefusedAttempt[];
  /** Questions to the mentor and the answers. Private to the user; the opposing agent never sees them. */
  mentorLog?: MentorEntry[];
  /** Private to the server: the mentor's Claude conversation, append-only. */
  mentorHistory?: Anthropic.Beta.BetaMessageParam[];
  /** Cached so the debrief doesn't call Claude again on every view. */
  debriefCritique?: Critique;
}

export interface RefusedAttempt {
  at: number;
  action: string;
  message: string;
  details: string[];
}

export interface MentorEntry {
  at: number;
  question: string;
  answer: string;
  source: "claude" | "offline";
}

/** What the browser receives. */
export interface NegotiationView {
  status: NegotiationStatus;
  simHours: number;
  messages: NegotiationMessage[];
  offers: Offer[];
  acceptedOfferId: string | null;
  endedBy: Negotiation["endedBy"];
  transaction: TransactionClientView | null;
  offerNight: OfferNightView | null;
}

export interface OfferNightView {
  reviewAt: string;
  reviewAtHours: number;
  preemptives: OfferNightState["preemptives"];
  phase: OfferNightState["phase"];
  disclosure: OfferNightState["disclosure"];
  /** The listing user's instructions from their seller (TRESA direction). */
  sellerDirection: "count_only" | "details" | null;
  /** How many competing offers this user knows about (null until the count has been disclosed to them). */
  competingCount: number | null;
  competitors: { id: string; label: string; price: number; deposit: number; conditions: string[]; completionDate: string; status: string; terms: Terms | null }[];
  improvementDeadline: string | null;
  outcome: OfferNightState["outcome"];
}

export function negotiationView(n: Negotiation, transaction: TransactionClientView | null = null, offerNight: OfferNightView | null = null): NegotiationView {
  return { status: n.status, simHours: n.simHours, messages: n.messages, offers: n.offers, acceptedOfferId: n.acceptedOfferId, endedBy: n.endedBy, transaction, offerNight };
}

export function newNegotiation(scenarioId: string): Negotiation {
  return { scenarioId, status: "negotiating", simHours: 0, messages: [], offers: [], botTurns: [], llmHistory: [], announcedEvents: [], acceptedOfferId: null, endedBy: null, transaction: null, offerNight: null };
}
