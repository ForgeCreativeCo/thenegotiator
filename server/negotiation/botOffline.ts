// Template-driven opposing agent, used when no API key is configured or a Claude turn fails validation.
// The moves come from the strategy; the words come from the dialogue pools (server/dialogue/agent.ts).

import type { Scenario } from "../engine/types";
import { describeTerms, type Terms } from "./terms";
import { money } from "../narrative/format";
import type { Recommendation } from "./strategy";
import type { BotAction } from "./types";
import { agentLines, agentReply, agentSideAnswers, type AgentContext } from "../dialogue/agent";

export interface BotTurn {
  action: BotAction;
  terms: Terms | null;
  message: string;
  internalNote: string;
}

/** Optional context for richer replies: what the user wrote, lines already used this deal, and real competing offers. */
export interface OfflineExtras {
  userText?: string;
  used?: string[];
  competing?: number | null;
}

function changes(before: Terms | null, after: Terms, s: Scenario): string[] {
  if (!before) return [];
  const a = describeTerms(before, s);
  return describeTerms(after, s)
    .filter((line, i) => line.key !== "price" && line.value !== a[i]?.value)
    .map((line) => `${line.label.toLowerCase()}: ${line.value}`);
}

export function offlineTurn(s: Scenario, rec: Recommendation, userTerms: Terms | null, round: number, clientUpdate: string | null, extras: OfflineExtras = {}): BotTurn {
  const c: AgentContext = { s, used: extras.used, seed: s.seed + round * 7919 };
  const update = clientUpdate ? ` One more thing: ${clientUpdate.charAt(0).toLowerCase()}${clientUpdate.slice(1)}` : "";
  const note = rec.reasoning;

  switch (rec.action) {
    case "accept":
      return { action: "accept", terms: null, message: `${agentLines.opener(c)} ${agentLines.accept(c)}`, internalNote: note };
    case "walk":
      return { action: "walk", terms: null, message: agentLines.walk(c), internalNote: note };
    case "reject":
      return { action: "reject", terms: null, message: `${agentLines.opener(c)} ${agentLines.reject(c)}`, internalNote: note };
    case "hold": {
      const text = extras.userText?.trim();
      const reply = text
        ? agentReply(c, text, { currentPrice: rec.currentPrice, currentNet: rec.currentNet, reservationNet: rec.reservationNet, competing: extras.competing ?? null })
        : agentLines.holdTail(c, rec.currentPrice);
      return { action: "hold", terms: null, message: `${reply}${update}`, internalNote: note };
    }
    case "counter": {
      const t = rec.terms!;
      const changed = changes(userTerms, t, s);
      const lead = userTerms ? `${agentLines.opener(c)} ${agentLines.counterLead(c, t.price)}` : `${agentLines.firstOffer(c)} ${money(t.price)}.`;
      const answer = extras.userText?.trim() ? agentSideAnswers(c, extras.userText, { currentPrice: t.price, currentNet: rec.currentNet, reservationNet: rec.reservationNet, competing: extras.competing ?? null }) : "";
      const extra = answer ? ` ${answer}` : "";
      return {
        action: "counter",
        terms: t,
        message: `${lead} ${agentLines.counterReason(c, t.price)}${changed.length ? ` ${agentLines.changes(c, changed.join("; "))}` : ""}${extra}${update}`,
        internalNote: note,
      };
    }
  }
}
