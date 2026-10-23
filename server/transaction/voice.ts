// How the opposing agent words its moves after acceptance. Code decides the move; this writes the message.
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
  repairs: "the findings",
  appraisal: "the appraisal",
  condition_extension: "the condition date",
  loan: "the mortgage",
  escape_clause: "the sale-of-property condition",
  title: "the title requisition",
  visit: "what came up at the pre-closing visit",
  extension: "the completion date",
  date_change: "the completion date",
};

function amountPhrase(move: BotMove, issue: Issue): string {
  if (issue.kind === "extension" || issue.kind === "date_change") return move.closingDate ? `completion on ${displayDate(move.closingDate)}` : "";
  if (issue.kind === "condition_extension") return `${move.amount} more banking days`;
  const form = move.form === "repairs" ? "repairs done before completion" : move.form === "credit" ? "a credit on closing" : "a price reduction by amendment";
  return `${money(move.amount)} as ${form}`;
}

/** A plain-spoken draft of the move. */
export function draftMessage(s: Scenario, issue: Issue, move: BotMove): string {
  const clients = s.userRole === "buyer_agent" ? "my sellers" : "my buyers";
  const Clients = clients.charAt(0).toUpperCase() + clients.slice(1);
  const noun = ISSUE_NOUN[issue.kind];
  switch (move.kind) {
    case "request":
      if (issue.kind === "escape_clause") return "This is notice under the escape clause: my sellers have another offer they're prepared to accept. Your buyers have 72 hours to waive the sale-of-property condition, or the agreement ends and the deposit is returned.";
      if (issue.kind === "extension") return `We need to move completion to ${displayDate(move.closingDate!)}. ${issue.detail} Can your clients sign an amendment?`;
      if (issue.kind === "condition_extension") return `${Clients} need ${move.amount} more banking days on the condition. ${issue.detail} Will your clients sign an amendment extending it?`;
      return `About ${noun}: ${Clients} are asking for ${amountPhrase(move, issue)} before they'll waive. ${issue.detail}`;
    case "counter":
      return `${Clients} reviewed it. We can do ${amountPhrase(move, issue)} on ${noun}.`;
    case "accept":
      if (issue.kind === "escape_clause") return `${Clients} will waive the sale-of-property condition. We're staying in.`;
      return `${Clients} agree${move.amount || move.closingDate ? ` to ${amountPhrase(move, issue)}` : ""}. I'll send the amendment over for signatures.`;
    case "reject":
      return `${Clients} won't agree to that on ${noun}. That's where they are.`;
    case "withdraw":
      if (issue.kind === "appraisal") return `Understood. ${Clients} will have to find the cash to cover the shortfall. If they can't, they won't be able to complete.`;
      return `Understood. ${Clients} will move forward without it.`;
    case "terminate":
      return issue.kind === "escape_clause"
        ? `${Clients} can't waive the condition until their home sells, so the agreement will end. Please have your sellers sign the mutual release so the deposit can go back.`
        : `I'm sorry, but ${clients} won't be waiving the condition, so the agreement is null and void. I'll send the mutual release for the deposit.`;
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
    content: `[Accepted agreement] ${situation}\n\nPRIVATE: Your move is already decided: ${decision}\nDraft of what to say: "${draft}"\nRewrite it in your own voice. Keep every number, date and decision exactly as in the draft, don't add new offers, and don't reveal your client's limits.`,
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
