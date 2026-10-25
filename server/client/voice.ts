// How the user's client words things. Code decides what they say; this writes it.
// Offline, the drafts below are the words. With an API key, Claude rewrites the draft in the client's voice.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Scenario } from "../engine/types";
import { displayDate, money } from "../narrative/format";
import { hasClaudeCredentials } from "../scenarioService";
import type { Negotiation } from "../negotiation/types";
import type { ClientFact, Topic } from "./types";
import { requirementLabel } from "./facts";
import { clientChatDraft, clientDirectionDraft, clientHoldDraft, clientPresentDraft, clientReviewDraft, type ClientCtx } from "../dialogue/client";

const MODEL = process.env.BOT_MODEL || "claude-opus-5-5";

export function story(s: Scenario) {
  return s.userRole === "buyer_agent" ? s.narrative.buyerStory : s.narrative.sellerStory;
}

function brief(s: Scenario) {
  return s.userRole === "buyer_agent" ? s.buyer : s.seller;
}

/** The dialogue context for this deal's client: their personality, and lines already used so they don't repeat. */
function ctxOf(s: Scenario, n: Negotiation): ClientCtx {
  return { s, used: n.client ? (n.client.usedLines ??= []) : undefined, seed: s.seed + (n.client?.messages.length ?? 0) * 17 };
}

// ---------- Drafts ----------

export function chatDraft(s: Scenario, n: Negotiation, text: string, topics: Topic[], revealed: ClientFact | null, competitionKnown: boolean): string {
  return clientChatDraft(ctxOf(s, n), text, topics, revealed, competitionKnown);
}

export interface ReviewAssessment {
  verdict: "signed" | "reluctant" | "refused";
  document: string;
  problems: string[];
  /** Hidden requirements this draft broke, and whether this is the first the agent has heard of them. */
  requirements: { fact: ClientFact; isNew: boolean }[];
}

function reminders(items: { fact: ClientFact; isNew: boolean }[], known: (label: string) => string): string[] {
  return items.map((r) => (r.isNew ? r.fact.says : r.fact.effect.kind === "require" ? known(requirementLabel(r.fact.effect.requirement)) : "")).filter(Boolean);
}

export function reviewDraft(s: Scenario, n: Negotiation, a: ReviewAssessment): string {
  const told = reminders(a.requirements, (label) => `And remember: ${label}.`);
  return clientReviewDraft(ctxOf(s, n), a.verdict, a.document, told, a.problems.length > a.requirements.length);
}

export interface PresentAssessment {
  label: string;
  price: number;
  /** Positive: past the client's limit by this much. */
  priceGap: number;
  otherProblems: number;
  missing: { fact: ClientFact; isNew: boolean }[];
  /** For the listing side's offer night: how many offers. */
  count?: number;
}

export function presentDraft(s: Scenario, n: Negotiation, a: PresentAssessment): string {
  return clientPresentDraft(ctxOf(s, n), a, reminders(a.missing, (label) => `And it doesn't have the ${label}.`));
}

export function holdDraft(s: Scenario, n: Negotiation, hold: boolean): string {
  return clientHoldDraft(ctxOf(s, n), hold);
}

export function directionDraft(s: Scenario, n: Negotiation, direction: "count_only" | "details"): string {
  return clientDirectionDraft(ctxOf(s, n), direction);
}

/** For the transaction module: this deal's client dialogue context. */
export { ctxOf as clientCtx };

// ---------- Claude ----------

function systemPrompt(s: Scenario): string {
  const st = story(s);
  const b = brief(s);
  return [
    `You are ${st.clientNames}, ${s.userRole === "buyer_agent" ? "buying" : "selling"} ${s.property.address.street} in ${s.property.address.municipality}, Ontario. You're talking to your own real estate agent, who represents you.`,
    `Your story: ${st.backstory} ${st.motivationStory}`,
    `What you've told your agent: ${st.whatTheyveToldYou}`,
    st.quirks.length ? `How you come across: ${st.quirks.join("; ")}.` : "",
    `Your limit: ${b.side === "buyer" ? `you won't pay more than ${money(b.reservationPrice)}` : `you won't take less than ${money(b.reservationPrice)}`}. Completion between ${displayDate(b.earliestClose)} and ${displayDate(b.latestClose)}.`,
    "Every decision you make is decided for you in each request, along with a draft of what to say. Rewrite the draft in your own voice: natural, a little personal, 1-4 sentences, no markdown. Keep every number, date and decision exactly as in the draft. Never mention a number that isn't in the draft or the request. Don't reveal anything else you haven't said before.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const VoiceSchema = z.object({ message: z.string().describe("What you say to your agent. Plain prose, 1-4 sentences.") });

const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(k|K)?/g;

function amounts(text: string): Set<number> {
  return new Set([...text.matchAll(AMOUNT)].map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1_000 : 1)));
}

/** The client's words: the draft offline, or Claude's rewrite when it keeps to the draft's numbers. */
export async function clientVoice(s: Scenario, n: Negotiation, situation: string, draft: string): Promise<{ text: string; source: "claude" | "offline" }> {
  if (!hasClaudeCredentials() || !n.client) return { text: draft, source: "offline" };
  const history = n.client.llmHistory;
  history.push({ role: "user", content: `${situation}\n\nPRIVATE: Draft of what you say: "${draft}"\nRewrite it in your own voice.` });
  try {
    const stream = new Anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: systemPrompt(s),
      output_config: { effort: "low", format: betaZodOutputFormat(VoiceSchema) },
      messages: history,
    });
    const response = await stream.finalMessage();
    history.push({ role: "assistant", content: response.content });
    const text = response.stop_reason === "end_turn" ? response.parsed_output?.message : undefined;
    const allowed = new Set([...amounts(draft), ...amounts(situation)]);
    if (text && [...amounts(text)].every((a) => allowed.has(a))) return { text, source: "claude" };
  } catch (error) {
    console.warn(`Claude client voice failed, using draft: ${(error as Error).message}`);
    history.push({ role: "assistant", content: JSON.stringify({ message: draft }) });
  }
  return { text: draft, source: "offline" };
}
