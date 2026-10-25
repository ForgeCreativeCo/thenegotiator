// With an API key, Claude rewrites the opposing agent's drafted message after acceptance in its own voice,
// continuing the same conversation. The drafts come from server/dialogue/transaction.ts.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Scenario } from "../engine/types";
import { hasClaudeCredentials } from "../scenarioService";
import { systemPrompt } from "../negotiation/botClaude";
import type { Negotiation } from "../negotiation/types";

const MODEL = process.env.BOT_MODEL || "claude-opus-5-5";

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
