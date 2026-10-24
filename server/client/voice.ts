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

const MODEL = process.env.BOT_MODEL || "claude-opus-5-5";

export function story(s: Scenario) {
  return s.userRole === "buyer_agent" ? s.narrative.buyerStory : s.narrative.sellerStory;
}

function brief(s: Scenario) {
  return s.userRole === "buyer_agent" ? s.buyer : s.seller;
}

/** "We" for a couple or family, "I" for one person. */
function voiceOf(s: Scenario) {
  const plural = /\band\b|&/i.test(story(s).clientNames);
  return plural ? { we: "we", We: "We", our: "our", us: "us" } : { we: "I", We: "I", our: "my", us: "me" };
}

// ---------- Drafts ----------

export function chatDraft(s: Scenario, text: string, topics: Topic[], revealed: ClientFact | null, competitionKnown: boolean): string {
  if (revealed) return revealed.says;
  const v = voiceOf(s);
  const b = brief(s);
  const window = `${displayDate(b.earliestClose)} and ${displayDate(b.latestClose)}`;
  const topic = topics[0];
  switch (topic) {
    case "price":
      return b.side === "buyer" ? `${v.We} told you ${money(b.reservationPrice)} is the most ${v.we} can do, and ${v.we} meant it.` : `${v.We} can't go below ${money(b.reservationPrice)}. That's ${v.our} bottom line.`;
    case "timing":
      return `Ideally ${v.we}'d complete around ${displayDate(b.idealClose)}. Anything between ${window} works for ${v.us}.`;
    case "deposit":
      return b.side === "buyer" ? `${v.We} can put down a normal deposit for this area.` : `${v.We}'d want at least ${b.minDepositPct}% as a deposit.`;
    case "inspection":
    case "conditions":
    case "financing":
      if (b.side === "seller") return `${v.We} don't want to give anyone more than ${b.maxConditionDays} banking days on a condition.`;
      return b.willingToWaive.length ? `If ${v.we} have to, ${v.we}'d go without the ${b.willingToWaive.map((w) => w.replace("_", " ")).join(" or ")} condition. Nothing else.` : `${v.We} need ${v.our} conditions. ${v.We}'re not going in firm.`;
    case "chattels":
      return b.side === "buyer" ? "The usual appliances should come with it. Nothing else comes to mind." : "The usual appliances can stay.";
    case "fixtures":
      return "Nothing else comes to mind.";
    case "competition":
      if (b.side === "seller") return "Just get us the best offer you can.";
      return competitionKnown ? `Other offers? That makes ${v.us} nervous, but ${v.our} number is ${v.our} number.` : "Are there other offers? Let us know if you hear anything.";
    case "motivation":
      return story(s).whatTheyveToldYou.split(/(?<=\.)\s/)[0] ?? "You know where we stand.";
    default:
      return text.includes("?") ? `Sorry, ${v.we === "I" ? "I'm" : "we're"} not sure what you mean. What do you need from ${v.us}?` : `Okay, thanks for keeping ${v.us} posted.`;
  }
}

export interface ReviewAssessment {
  verdict: "signed" | "reluctant" | "refused";
  document: string;
  problems: string[];
  /** Hidden requirements this draft broke, and whether this is the first the agent has heard of them. */
  requirements: { fact: ClientFact; isNew: boolean }[];
}

export function reviewDraft(s: Scenario, a: ReviewAssessment): string {
  const v = voiceOf(s);
  const told = a.requirements.map((r) => (r.isNew ? r.fact.says : r.fact.effect.kind === "require" ? `And remember: ${requirementLabel(r.fact.effect.requirement)}.` : "")).filter(Boolean);
  if (a.verdict === "refused") {
    const others = a.problems.length - a.requirements.length;
    return [`${v.We} can't sign this ${a.document} as it is.`, ...told, others > 0 ? `It's outside what ${v.we} told you ${v.we} can do.` : ""].filter(Boolean).join(" ");
  }
  if (a.verdict === "reluctant") return `Okay, ${v.we}'ll sign the ${a.document}. But that's as far as ${v.we} go. Please don't come back asking for more.`;
  return `This ${a.document} looks right. ${v.We}'ve signed it. Go ahead.`;
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

export function presentDraft(s: Scenario, a: PresentAssessment): string {
  const v = voiceOf(s);
  const list = s.property.listPrice;
  const parts: string[] = [];
  if (a.count && a.count > 1) parts.push(`${a.count} offers! Walk ${v.us} through them. The best price is ${money(a.price)}.`);
  if (a.priceGap > list * 0.05) parts.push(s.userRole === "buyer_agent" ? `${money(a.price)}? That's not even close to what ${v.we} can do.` : `${money(a.price)}? That's insulting.`);
  else if (a.priceGap > 0) parts.push(`${money(a.price)} is more ${s.userRole === "buyer_agent" ? "than" : "of a drop than"} ${v.we} can do, but it's not crazy. Can you get them closer?`);
  else if (!a.count || a.count <= 1) parts.push(`${money(a.price)}. ${v.We} could live with that.`);
  if (a.otherProblems > 0 && a.priceGap <= 0) parts.push(`Some of the other terms don't work for ${v.us}, though.`);
  for (const m of a.missing) parts.push(m.isNew ? m.fact.says : m.fact.effect.kind === "require" ? `And it doesn't have the ${requirementLabel(m.fact.effect.requirement)}.` : "");
  return parts.filter(Boolean).join(" ");
}

export function directionDraft(s: Scenario, direction: "count_only" | "details"): string {
  const v = voiceOf(s);
  return direction === "details"
    ? `If sharing what's in the other offers gets ${v.us} a better price, do it. You have ${v.our} direction in writing.`
    : `Just tell them how many offers there are. ${v.We} don't want the details of anyone's offer going around. That's ${v.our} direction, in writing.`;
}

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
