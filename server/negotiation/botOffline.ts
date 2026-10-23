// Template-driven opposing agent, used when no API key is configured or a Claude turn fails validation.

import type { Scenario } from "../engine/types";
import { Rng } from "../engine/rng";
import { money } from "../narrative/format";
import { describeTerms, type Terms } from "./terms";
import { botSide, type Recommendation } from "./strategy";
import type { BotAction } from "./types";

export interface BotTurn {
  action: BotAction;
  terms: Terms | null;
  message: string;
  internalNote: string;
}

function clients(s: Scenario): string {
  return botSide(s) === "seller" ? "my sellers" : "my buyers";
}

function changes(before: Terms | null, after: Terms, s: Scenario): string[] {
  if (!before) return [];
  const a = describeTerms(before, s);
  return describeTerms(after, s)
    .filter((line, i) => line.key !== "price" && line.value !== a[i]?.value)
    .map((line) => `${line.label.toLowerCase()}: ${line.value}`);
}

export function offlineTurn(s: Scenario, rec: Recommendation, userTerms: Terms | null, round: number, clientUpdate: string | null): BotTurn {
  const rng = new Rng(s.seed + round * 7919);
  const who = clients(s);
  const temperament = s.difficulty.temperament;
  const opener = {
    collaborative: ["Thanks for sending this over.", "Appreciate you working with us on this.", "Thanks, I think we're getting somewhere."],
    professional: ["Thanks for the offer.", "Received, thank you.", "Thanks. I reviewed this with " + who + "."],
    cagey: ["Got it.", "Thanks. Interesting.", "I took a look."],
    hardball: ["Look,", "I'll be straight with you.", "Let's not waste each other's time."],
  }[temperament];
  const update = clientUpdate ? ` One more thing: ${clientUpdate.charAt(0).toLowerCase()}${clientUpdate.slice(1)}` : "";

  switch (rec.action) {
    case "accept":
      return {
        action: "accept",
        terms: null,
        message: `${rng.pick(opener)} ${who.charAt(0).toUpperCase() + who.slice(1)} accept. I'll get the signed contract back to you within the hour. Congratulations, we have a deal.`,
        internalNote: rec.reasoning,
      };
    case "walk":
      return {
        action: "walk",
        terms: null,
        message: `I don't think we're going to get there. ${who.charAt(0).toUpperCase() + who.slice(1)} have gone as far as they can. If anything changes on your side, give me a call.`,
        internalNote: rec.reasoning,
      };
    case "reject":
      return {
        action: "reject",
        terms: null,
        message: `${rng.pick(opener)} ${who.charAt(0).toUpperCase() + who.slice(1)} aren't going to respond to that number. Come back with something closer to the comps and we can talk.`,
        internalNote: rec.reasoning,
      };
    case "hold":
      return {
        action: "hold",
        terms: null,
        message: `Happy to talk it through. Where we are right now is ${money(rec.currentPrice)}. Send me something in writing and I'll present it right away.${update}`,
        internalNote: rec.reasoning,
      };
    case "counter": {
      const t = rec.terms!;
      const changed = changes(userTerms, t, s);
      const why = botSide(s) === "seller"
        ? rng.pick(["The comps support it.", "We've had good activity on this one.", "It's priced right for the condition."])
        : rng.pick(["That's where the comps put it.", "My buyers are being realistic about the work this needs.", "That's a strong offer in this market."]);
      return {
        action: "counter",
        terms: t,
        message: `${userTerms ? `${rng.pick(opener)} We're countering at` : `Hi, it's ${s.narrative.opposingAgent.name.split(" ")[0]}. Sending over an offer from ${who}:`} ${money(t.price)}. ${why}${changed.length ? ` We also need to adjust ${changed.join("; ")}.` : ""}${update}`,
        internalNote: rec.reasoning,
      };
    }
  }
}
