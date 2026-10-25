import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Role, Scenario } from "../server/engine/types";
import { displayDate, money } from "../server/narrative/format";
import { pickLine } from "../server/dialogue/pick";
import { agentLines, agentReply, offerNightLines, type AgentContext } from "../server/dialogue/agent";
import { clientChatDraft, clientDirectionDraft, clientPresentDraft, clientReviewDraft, clientStyle, clientTxLines, type ClientCtx } from "../server/dialogue/client";
import { agentTxDraft, agentTxReply } from "../server/dialogue/transaction";
import { botSide } from "../server/negotiation/strategy";
import { offlineTurn } from "../server/negotiation/botOffline";
import { applyUserAction, startNegotiation, type BotPlayer } from "../server/negotiation/engine";
import { newNegotiation } from "../server/negotiation/types";
import { createTransaction } from "../server/transaction/schedule";
import { defaultBuyerTerms } from "../server/negotiation/terms";
import type { Issue } from "../server/transaction/types";
import type { BotMove } from "../server/transaction/policy";
import type { Topic } from "../server/client/types";

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

function scenarios(count: number): Scenario[] {
  const out: Scenario[] = [];
  for (let seed = 1; out.length < count; seed += 37) {
    for (const role of ["buyer_agent", "seller_agent"] as Role[]) {
      const p = generateParams({ seed, startDate: "2026-10-25", role });
      out.push({ ...p, id: `s${seed}${role}`, createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" });
    }
  }
  return out;
}

const QUESTIONS = [
  "Hi, how are you?",
  "What's their bottom line? Is there any flexibility on price?",
  "Why are they selling?",
  "What's their motivation for buying?",
  "When do they want to close? Any flexibility on the date?",
  "Have you had any other offers or showings?",
  "What deposit are they looking for?",
  "How long a condition period would they accept?",
  "Are the buyers pre-approved? How's their financing?",
  "Any issues with the roof or the basement?",
  "Which appliances stay?",
  "What do the comps say? It seems overpriced.",
  "That's ridiculous, come on.",
  "Thanks for the update.",
  "Can you sharpen your pencil and come down?",
];

/** Text that went wrong: an unfilled placeholder, undefined, NaN, doubled punctuation or spaces. */
function broken(text: string): boolean {
  return /\{\w+\}|undefined|NaN|\s{2,}|\.\.|\s[.,]/.test(text.replace(/[ap]\.m\./g, "am").replace(/\.\.\./g, "…"));
}

describe("dialogue picker", () => {
  it("doesn't repeat a line until every line in the pool has been used", () => {
    const lines = ["a", "b", "c", "d"];
    const used: string[] = [];
    const first = [0, 1, 2, 3].map(() => pickLine("pool", lines, used, 42));
    expect(new Set(first).size).toBe(4);
    const second = [0, 1, 2, 3].map(() => pickLine("pool", lines, used, 42));
    expect(second).toEqual(first);
    // Same seed, fresh deal: the same order.
    expect(pickLine("pool", lines, [], 42)).toBe(first[0]);
  });
});

describe("the opposing agent's dialogue", () => {
  const all = scenarios(160);

  it("never reveals its client's limit or private finances, whatever you ask", () => {
    for (const s of all) {
      const c: AgentContext = { s, used: [], seed: s.seed };
      const bot = botSide(s) === "seller" ? s.seller : s.buyer;
      const secrets = [bot.reservationPrice, ...(bot.side === "seller" ? [bot.mortgagePayoff] : [bot.preapprovalAmount ?? 0, bot.cashReserves])].filter((x) => x > 0 && x !== s.property.listPrice).map(money);
      for (const q of QUESTIONS) {
        const reply = agentReply(c, q, { currentPrice: s.property.listPrice, currentNet: s.property.listPrice, reservationNet: bot.reservationPrice, competing: 0 });
        for (const secret of secrets) expect(reply, `${s.id}: "${q}"`).not.toContain(secret);
        expect(broken(reply), reply).toBe(false);
      }
    }
  });

  it("keeps private motivations private, and shares more when it's open than when it's guarded", () => {
    for (const s of all) {
      const bot = botSide(s) === "seller" ? s.seller : s.buyer;
      const reply = agentReply({ s, used: [], seed: s.seed }, "Why are they moving? When do they want to close?", { currentPrice: s.property.listPrice, currentNet: s.property.listPrice, reservationNet: bot.reservationPrice, competing: 0 });
      expect(reply).not.toMatch(/separat|divorc|financial (trouble|pressure|strain)|power of sale|can'?t afford/i);
      const window = displayDate(bot.latestClose);
      if (s.difficulty.withholding === "guarded") expect(reply).not.toContain(window);
      if (s.difficulty.withholding === "open") expect(reply).toContain(window);
    }
  });

  it("tells the truth about competing offers", () => {
    for (const s of all.filter((x) => botSide(x) === "seller").slice(0, 60)) {
      const ctx = (competing: number) => ({ currentPrice: s.property.listPrice, currentNet: s.property.listPrice, reservationNet: s.seller.reservationPrice, competing });
      const none = agentReply({ s, used: [], seed: s.seed }, "Any other offers?", ctx(0));
      expect(none).not.toMatch(/\b\d+ other\b|honest: there's another offer|other interest in writing/i);
      const two = agentReply({ s, used: [], seed: s.seed }, "Any other offers?", ctx(2));
      if (s.difficulty.withholding !== "guarded") expect(two).toMatch(/\b2 other\b/);
      else expect(two).toMatch(/another offer|other interest/i);
    }
  });

  it("words every move cleanly, in every temperament", () => {
    for (const s of all.slice(0, 80)) {
      const c: AgentContext = { s, used: [], seed: s.seed };
      for (const text of [agentLines.opener(c), agentLines.firstOffer(c), agentLines.counterLead(c, 650_000), agentLines.counterReason(c, 650_000), agentLines.changes(c, "deposit: $30,000"), agentLines.reject(c), agentLines.accept(c), agentLines.walk(c), agentLines.holdTail(c, 650_000), offerNightLines.listingStatus(c, "We're holding offers until Wed.", "there are 2 other registered offers"), offerNightLines.buyerAgentAck(c, false), offerNightLines.register(c), offerNightLines.improve(c), offerNightLines.bully(c, "$700,000", "firm", "$35,000"), offerNightLines.wonIt(c, "3 offers"), offerNightLines.lostIt(c, "3 offers"), offerNightLines.sendBack(c, "3 offers", "Thu, 7 p.m.")]) {
        expect(broken(text), text).toBe(false);
      }
    }
  });

  it("doesn't repeat itself across a negotiation", async () => {
    const s = all.find((x) => botSide(x) === "seller" && !x.offerNight && x.difficulty.dealSpace !== "none")!;
    const player: BotPlayer = async (sc, rec, ctx, _h, round) => ({ ...offlineTurn(sc, rec, ctx.userTerms, round, ctx.clientUpdate, { userText: ctx.userText, used: ctx.usedLines, competing: ctx.competingOffers }), source: "offline", issues: [] });
    const n = newNegotiation(s.id);
    await startNegotiation(s, n, player);
    for (const q of ["Hi there.", "Any flexibility?", "Any flexibility?", "Any flexibility?", "Thanks.", "Thanks."]) await applyUserAction(s, n, { type: "message", text: q }, player);
    const bot = n.messages.filter((m) => m.speaker === "bot").map((m) => m.text);
    expect(new Set(bot).size).toBe(bot.length);
  });
});

describe("the opposing agent after acceptance", () => {
  it("words every move on every kind of issue, and answers questions from the deal's state", () => {
    for (const s of scenarios(40)) {
      const terms = defaultBuyerTerms(s);
      const tx = createTransaction(s, terms, 0);
      const c = { s, used: [] as string[], seed: s.seed };
      const kinds: Issue["kind"][] = ["repairs", "appraisal", "condition_extension", "loan", "escape_clause", "title", "visit", "extension", "date_change"];
      for (const kind of kinds) {
        const issue: Issue = { id: randomUUID(), kind, title: kind, detail: "Details here.", requester: "buyer", responder: "seller", openedDay: 0, deadlineDay: null, status: "open", proposals: [], reference: 10_000, neededDate: null, findingIds: [], conditionKey: null, rightUntilDay: null };
        for (const k of ["request", "counter", "accept", "reject", "withdraw", "terminate"] as BotMove["kind"][]) {
          const text = agentTxDraft(c, issue, { kind: k, amount: 5_000, closingDate: "2027-01-15", form: "credit", reasoning: "" });
          expect(text.length, `${kind}/${k}`).toBeGreaterThan(0);
          expect(broken(text), text).toBe(false);
        }
      }
      for (const q of ["Any update?", "How's the mortgage going?", "When's closing?", "Did the deposit arrive?", "What about the appraisal?", "Ok."]) {
        const reply = agentTxReply(c, q, tx, s.difficulty.withholding);
        expect(broken(reply), reply).toBe(false);
        expect(reply).not.toContain(money(botSide(s) === "seller" ? s.seller.reservationPrice : s.buyer.reservationPrice));
      }
    }
  });
});

describe("your clients' dialogue", () => {
  const topics: Topic[] = ["price", "timing", "deposit", "conditions", "inspection", "chattels", "fixtures", "financing", "competition", "motivation"];

  it("answers every topic in every personality, for one client or a couple", () => {
    const styles = new Set<string>();
    for (const s of scenarios(120)) {
      styles.add(clientStyle(s));
      const c: ClientCtx = { s, used: [], seed: s.seed };
      for (const topic of topics) {
        const text = clientChatDraft(c, "question?", [topic], null, true);
        expect(text.length, topic).toBeGreaterThan(0);
        expect(broken(text), text).toBe(false);
      }
      for (const text of ["Hi!", "Thanks so much.", "What do you think we should do?", "The offer went in this morning.", "Blah?"]) expect(broken(clientChatDraft(c, text, [], null, false))).toBe(false);
      for (const text of [
        clientReviewDraft(c, "refused", "sign-back", ["And remember: deposit with the offer."], true),
        clientReviewDraft(c, "reluctant", "offer", [], false),
        clientReviewDraft(c, "signed", "acceptance", [], false),
        clientPresentDraft(c, { price: 600_000, priceGap: 100_000, otherProblems: 0 }, []),
        clientPresentDraft(c, { price: 600_000, priceGap: 1_000, otherProblems: 1 }, []),
        clientPresentDraft(c, { price: 600_000, priceGap: -5_000, otherProblems: 1, count: 3 }, []),
        clientDirectionDraft(c, "details"),
        clientDirectionDraft(c, "count_only"),
        ...Object.values(clientTxLines).map((f) => (f as (c: ClientCtx, x: string) => string)(c, "$5,000")),
      ]) {
        expect(broken(text), text).toBe(false);
        // A single client never says "we" for themselves in these lines' voice tokens.
        if (!/\band\b|&/i.test((s.userRole === "buyer_agent" ? s.narrative.buyerStory : s.narrative.sellerStory).clientNames)) expect(text).not.toMatch(/\bI're\b|\bme're\b/);
      }
    }
    expect(styles.size).toBe(4);
  });

  it("answers two things in one message", () => {
    const s = scenarios(2)[0];
    const text = clientChatDraft({ s, used: [], seed: 1 }, "When do you want to close, and what deposit?", ["timing", "deposit"], null, false);
    expect(text).toContain(displayDate((s.userRole === "buyer_agent" ? s.buyer : s.seller).idealClose));
    expect(text.split(/(?<=[.!?])\s/).length).toBeGreaterThan(1);
  });
});
