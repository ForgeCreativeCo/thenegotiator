import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Scenario } from "../server/engine/types";
import { claudeTurn, BotError } from "../server/negotiation/botClaude";
import { recommend } from "../server/negotiation/strategy";
import { setNet } from "../server/negotiation/constraints";
import { defaultBuyerTerms } from "../server/negotiation/terms";
import { newNegotiation } from "../server/negotiation/types";

function sellerBotScenario(): Scenario {
  for (let seed = 1; ; seed++) {
    const p = generateParams({ seed, startDate: "2026-10-23", role: "buyer_agent" });
    if (p.difficulty.dealSpace === "none") continue;
    return { ...p, id: "t", createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
  }
}

/** A fake Anthropic client that returns the queued parsed outputs in order. */
function fakeClient(outputs: unknown[]) {
  const calls: unknown[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: { messages: unknown[]; system: string }) {
          calls.push(JSON.parse(JSON.stringify({ messages: params.messages, system: params.system })));
          const parsed = outputs.shift();
          return {
            finalMessage: async () => ({ stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: JSON.stringify(parsed) }], parsed_output: parsed }),
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

describe("Claude opposing agent", () => {
  it("rejects a counter below the client's floor, then accepts a valid redo, keeping history append-only", async () => {
    const s = sellerBotScenario();
    const n = newNegotiation(s.id);
    const userTerms = setNet("buyer", s, defaultBuyerTerms(s), Math.round(s.seller.reservationPrice * 0.9));
    n.offers.push({ id: "u1", by: "buyer", terms: userTerms, status: "open", at: 0 });
    const rec = recommend(s, n);

    const tooLow = { ...userTerms, price: Math.round(s.seller.reservationPrice * 0.95) };
    const { client, calls } = fakeClient([
      { internalNote: "cave", action: "counter", terms: tooLow, message: "Fine, take it." },
      { internalNote: "hold firm", action: "hold", terms: null, message: "We're not there yet." },
    ]);
    const history: Anthropic.Beta.BetaMessageParam[] = [];
    const turn = await claudeTurn(s, rec, { userText: "Here's our offer", userTerms, simTime: "Fri", newEvents: [], clientUpdate: null, competingOffers: 0 }, history, client);

    expect(turn.action).toBe("hold");
    expect(turn.issues.join(" ")).toMatch(/won't sign/);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // The second request starts with exactly the messages the first one sent.
    const first = (calls[0] as { messages: unknown[] }).messages;
    const second = (calls[1] as { messages: unknown[] }).messages;
    expect(second.slice(0, first.length)).toEqual(first);
    // The private turn note includes the limit, but the system prompt tells the bot never to reveal it.
    expect((calls[0] as { system: string }).system).toMatch(/NEVER reveal/);
  });

  it("gives up after two invalid turns", async () => {
    const s = sellerBotScenario();
    const n = newNegotiation(s.id);
    const userTerms = setNet("buyer", s, defaultBuyerTerms(s), Math.round(s.seller.reservationPrice * 0.9));
    n.offers.push({ id: "u1", by: "buyer", terms: userTerms, status: "open", at: 0 });
    const rec = recommend(s, n);
    const bad = { internalNote: "", action: "accept", terms: null, message: "Deal!" };
    const { client } = fakeClient([bad, bad]);
    await expect(claudeTurn(s, rec, { userText: "", userTerms, simTime: "Fri", newEvents: [], clientUpdate: null, competingOffers: 0 }, [], client)).rejects.toBeInstanceOf(BotError);
  });
});
