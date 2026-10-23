// How the opposing agent words its moves after the contract. Code decides the move; this writes the message.
// With an API key, Claude rewrites the draft in the agent's voice, continuing the same conversation.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Scenario } from "../engine/types";
import { displayDate, money } from "../narrative/format";
import { hasClaudeCredentials } from "../scenarioService";
import { systemPrompt } from "../negotiation/botClaude";
import type { Negotiation } from "../negotiation/types";
import type { BotMove } from "./policy";
import type { Issue } from "./types";

const MODEL = process.env.BOT_MODEL || "claude-opus-5-5";

const ISSUE_NOUN: Record<Issue["kind"], string> = {
  repairs: "the inspection items",
  appraisal: "the appraisal",
  title: "the title issue",
  walkthrough: "what we found at the walkthrough",
  extension: "the closing date",
  date_change: "the closing date",
  possession: "possession after closing",
  loan: "the loan",
  kickout: "the home-sale contingency",
};

function amountPhrase(move: BotMove, issue: Issue): string {
  if (issue.kind === "extension" || issue.kind === "date_change") return move.closingDate ? `closing on ${displayDate(move.closingDate)}` : "";
  if (issue.kind === "possession") return `${move.amount} days of possession after closing`;
  const form = move.form === "price_reduction" ? "a price reduction" : move.form === "repairs" ? "repairs done before closing" : "a closing-cost credit";
  return `${money(move.amount)} as ${form}`;
}

/** A plain-spoken draft of the move. */
export function draftMessage(s: Scenario, issue: Issue, move: BotMove): string {
  const clients = s.userRole === "buyer_agent" ? "my sellers" : "my buyers";
  const Clients = clients.charAt(0).toUpperCase() + clients.slice(1);
  const noun = ISSUE_NOUN[issue.kind];
  switch (move.kind) {
    case "request":
      if (issue.kind === "kickout") return `Heads up: we've received another offer, so this is formal notice under the kick-out clause. Your buyers have 72 hours to remove the home-sale contingency or release the contract.`;
      if (issue.kind === "extension") return `We need to move closing to ${displayDate(move.closingDate!)}. ${issue.detail} Can your clients sign an extension?`;
      return `About ${noun}: ${Clients} are asking for ${amountPhrase(move, issue)}. ${issue.detail}`;
    case "counter":
      return `${Clients} reviewed it. We can do ${amountPhrase(move, issue)} on ${noun}.`;
    case "accept":
      if (issue.kind === "kickout") return `${Clients} will remove the home-sale contingency. We're staying in.`;
      return `${Clients} agree${move.amount || move.closingDate ? ` to ${amountPhrase(move, issue)}` : ""}. I'll send the amendment over for signatures.`;
    case "reject":
      return `${Clients} won't agree to that on ${noun}. That's where they are.`;
    case "withdraw":
      if (issue.kind === "appraisal") return `Understood. ${Clients} will have to find a way to cover the gap. If they can't, they won't be able to close.`;
      return `Understood. ${Clients} will move forward without it.`;
    case "terminate":
      return issue.kind === "kickout"
        ? `${Clients} can't remove the contingency right now, so we'll release. Sorry it didn't work out.`
        : `I'm sorry to do this, but ${clients} are terminating under the contract. I'll send the release and the earnest money paperwork.`;
    case "wait":
      return "";
  }
}

const VoiceSchema = z.object({ message: z.string().describe("What you say to the other agent. Plain prose, 1-4 sentences, no markdown.") });

/** Rewrites the draft in the agent's voice with Claude when available; otherwise returns the draft. */
export async function voice(s: Scenario, n: Negotiation, situation: string, decision: string, draft: string): Promise<string> {
  if (!hasClaudeCredentials()) return draft;
  const history = n.llmHistory;
  history.push({
    role: "user",
    content: `[Under contract] ${situation}\n\nPRIVATE: Your move is already decided: ${decision}\nDraft of what to say: "${draft}"\nRewrite it in your own voice. Keep every number, date and decision exactly as in the draft, don't add new offers, and don't reveal your client's limits.`,
  });
  try {
    const stream = new Anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: systemPrompt(s),
      output_config: { effort: "low", format: betaZodOutputFormat(VoiceSchema) },
      messages: history,
    });
    const response = await stream.finalMessage();
    history.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "end_turn" && response.parsed_output) return response.parsed_output.message;
  } catch (error) {
    console.warn(`Claude voice failed, using draft: ${(error as Error).message}`);
    history.push({ role: "assistant", content: JSON.stringify({ message: draft }) });
  }
  return draft;
}
