// The user's own client: what they haven't told you yet, and the conversation with them.

import type Anthropic from "@anthropic-ai/sdk";
import type { ConditionKey, Side } from "../engine/types";

export type Topic = "price" | "timing" | "deposit" | "conditions" | "inspection" | "chattels" | "fixtures" | "financing" | "competition" | "motivation";

export type Requirement =
  | { kind: "chattel"; item: string; match: string }
  | { kind: "exclude_fixture"; item: string; match: string }
  | { kind: "condition_min_days"; key: ConditionKey; days: number }
  | { kind: "deposit_timing"; timing: "herewith" | "upon_acceptance" }
  | { kind: "min_deposit_pct"; pct: number };

export type FactEffect =
  /** A buyer's ceiling rises, or a seller's floor drops, by this much once uncovered (and only on these dates). */
  | { kind: "room"; amount: number; completionBy?: string; completionFrom?: string }
  /** A buyer stretches in a bidding war. Can only come out once they know there are competing offers. */
  | { kind: "room_competition"; amount: number }
  /** Something they won't sign without, uncovered or not. */
  | { kind: "require"; requirement: Requirement; refusal: string }
  | { kind: "context" };

/** Something the client hasn't told their agent. Code decides it; the scenario keeps it hidden until the debrief. */
export interface ClientFact {
  id: string;
  side: Side;
  topics: Topic[];
  /** Third person, for the debrief. */
  summary: string;
  /** The client's own words when it comes out. */
  says: string;
  effect: FactEffect;
}

export type UncoveredHow = "asked" | "refusal" | "presented";

/** A surprise from the user's own client after acceptance, set by the hidden client volatility. */
export interface OwnClientEvent {
  id: string;
  kind: "cold_feet" | "partner" | "remorse" | "later_date";
  /** cold_feet and partner block the next signature until the agent talks it through; the others are unprompted messages. */
  blocking: boolean;
  /** The client's words when it happens. */
  says: string;
  /** The client's words once the agent has talked to them. */
  settles: string;
  /** Third person, for the debrief. */
  summary: string;
}

export interface ClientMessage {
  id: string;
  at: number;
  speaker: "user" | "client" | "system";
  text: string;
  kind: "chat" | "review" | "present" | "direction";
  verdict?: "signed" | "reluctant" | "refused";
  details?: string[];
  offerId?: string;
  /** The untold fact this message brought out. */
  factId?: string;
}

export interface ClientState {
  /** On for every deal started since the client conversation existed; older saved deals and engine tests skip the signature check. */
  reviewRequired: boolean;
  messages: ClientMessage[];
  uncovered: { factId: string; how: UncoveredHow; at: number }[];
  /** Offers from the other side (and "offer-night" for the listing side's review) shown to the client. */
  presented: string[];
  /** The last document the client signed, by its signature key. Used once. */
  signature: { key: string; at: number } | null;
  /** The listing client's written direction on disclosing offer contents. */
  direction: "count_only" | "details" | null;
  /** Private to the server: the client's Claude conversation, append-only. */
  llmHistory: Anthropic.Beta.BetaMessageParam[];
  /** Offline dialogue lines the client has used in this deal, so they don't repeat themselves. */
  usedLines?: string[];
  /** Surprises that have happened (absent until the first one). */
  events?: { id: string; status: "active" | "settled"; at: number }[];
}

/** What the browser sees: the conversation and what you've learned, never the facts still untold. */
export interface ClientView {
  reviewRequired: boolean;
  messages: ClientMessage[];
  learned: { factId: string; how: UncoveredHow; says: string }[];
  presented: string[];
  direction: ClientState["direction"];
}

export function newClientState(reviewRequired: boolean): ClientState {
  return { reviewRequired, messages: [], uncovered: [], presented: [], signature: null, direction: null, llmHistory: [] };
}
