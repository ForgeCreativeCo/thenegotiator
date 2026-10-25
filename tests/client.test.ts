import { beforeAll, describe, expect, it } from "vitest";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Role, Scenario } from "../server/engine/types";
import { userView } from "../server/engine/views";
import { offlineTurn } from "../server/negotiation/botOffline";
import { ActionError, applyUserAction, startNegotiation, type BotPlayer, type UserAction } from "../server/negotiation/engine";
import { newNegotiation, type Negotiation } from "../server/negotiation/types";
import { netPrice, setNet } from "../server/negotiation/constraints";
import { defaultBuyerTerms, type Terms } from "../server/negotiation/terms";
import { clientFacts, extraRoom, requirementProblems } from "../server/client/facts";
import { clientView, clientViolations, topicsIn } from "../server/client/engine";
import { newClientState, type ClientFact } from "../server/client/types";
import { reviewCompliance } from "../server/coach/compliance";

const offlinePlayer: BotPlayer = async (s, rec, ctx, _h, round) => ({ ...offlineTurn(s, rec, ctx.userTerms, round, ctx.clientUpdate), source: "offline", issues: [] });

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

function scenario(role: Role, seed: number, filter: (s: Scenario) => boolean = () => true): Scenario {
  for (let i = seed; i < seed + 5_000; i++) {
    const p = generateParams({ seed: i, startDate: "2026-10-23", role });
    const s: Scenario = { ...p, id: `s${i}`, createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
    if (p.difficulty.dealSpace !== "none" && filter(s)) return s;
  }
  throw new Error("No matching scenario");
}

function withClient(s: Scenario): Negotiation {
  return { ...newNegotiation(s.id), client: newClientState(true) };
}

async function act(s: Scenario, n: Negotiation, action: UserAction): Promise<void> {
  await applyUserAction(s, n, action, offlinePlayer);
}

async function refused(s: Scenario, n: Negotiation, action: UserAction): Promise<string> {
  try {
    await act(s, n, action);
  } catch (e) {
    if (e instanceof ActionError) return e.message;
    throw e;
  }
  throw new Error(`Expected ${action.type} to be refused`);
}

/** Terms that meet every hidden requirement. */
function satisfy(s: Scenario, t: Terms): Terms {
  const out = structuredClone(t);
  for (const f of clientFacts(s)) {
    if (f.effect.kind !== "require") continue;
    const r = f.effect.requirement;
    if (r.kind === "chattel") out.chattels = `${out.chattels}, ${r.item}`;
    if (r.kind === "exclude_fixture") out.fixturesExcluded = r.item;
    if (r.kind === "deposit_timing") out.depositTiming = r.timing;
    if (r.kind === "min_deposit_pct") out.deposit = Math.ceil((out.price * r.pct) / 100 / 1000) * 1000;
    if (r.kind === "condition_min_days") out.conditions = out.conditions.map((c) => (c.key === r.key ? { ...c, days: Math.max(c.days, r.days) } : c));
  }
  return out;
}

const lastClient = (n: Negotiation) => n.client!.messages.filter((m) => m.speaker === "client").at(-1)!;

describe("untold client facts", () => {
  it("gives every client 2-4, never past a buyer's pre-approval, and keeps them out of the user's view", () => {
    for (let seed = 1; seed <= 400; seed++) {
      for (const role of ["buyer_agent", "seller_agent"] as Role[]) {
        const p = generateParams({ seed, startDate: "2026-10-23", role });
        const facts = p.clientFacts!;
        expect(facts.length).toBeGreaterThanOrEqual(2);
        expect(facts.length).toBeLessThanOrEqual(4);
        expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
        const room = facts.reduce((sum, f) => sum + (f.effect.kind === "room" || f.effect.kind === "room_competition" ? f.effect.amount : 0), 0);
        if (role === "buyer_agent" && p.buyer.preapprovalAmount !== null) expect(p.buyer.reservationPrice + room).toBeLessThanOrEqual(p.buyer.preapprovalAmount);
        if (role === "seller_agent") expect(p.seller.reservationPrice - room).toBeGreaterThan(p.seller.mortgagePayoff);
        const s: Scenario = { ...p, id: "x", createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
        const view = JSON.stringify(userView(s));
        for (const f of facts) expect(view).not.toContain(f.says);
      }
    }
  });

  it("matches questions to topics", () => {
    expect(topicsIn("When do you need to close?")).toContain("timing");
    expect(topicsIn("How much of a deposit can you put down?")).toContain("deposit");
    expect(topicsIn("Should the hot tub stay with the house?")).toContain("chattels");
    expect(topicsIn("Is there anything else I should know?")).toEqual(["motivation"]);
  });
});

describe("client conversation", () => {
  it("brings out an untold fact when you ask about its topic, and only that one", async () => {
    const s = scenario("buyer_agent", 30, (x) => clientFacts(x).some((f) => f.id === "require-deposit-timing"));
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    await act(s, n, { type: "client_message", text: "Can you give a deposit with the offer?" });
    expect(n.client!.uncovered.map((u) => u.factId)).toEqual(["require-deposit-timing"]);
    expect(lastClient(n).text).toContain("GIC");
    // Asking again doesn't repeat it.
    await act(s, n, { type: "client_message", text: "And the deposit amount?" });
    expect(n.client!.uncovered).toHaveLength(1);
    expect(clientView(s, n)!.learned[0].how).toBe("asked");
  });

  it("open questions bring out background, never money", async () => {
    const s = scenario("buyer_agent", 60, (x) => clientFacts(x).some((f) => f.effect.kind === "context") && clientFacts(x).some((f) => f.effect.kind === "room"));
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    await act(s, n, { type: "client_message", text: "Is there anything else I should know?" });
    const found = clientFacts(s).filter((f) => n.client!.uncovered.some((u) => u.factId === f.id));
    expect(found.map((f) => f.effect.kind)).toEqual(["context"]);
  });

  it("requires the client's signature on every offer, and uses it up", async () => {
    const s = scenario("buyer_agent", 90, (x) => !x.offerNight);
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    const terms = satisfy(s, setNet("buyer", s, defaultBuyerTerms(s), Math.round(s.buyer.reservationPrice * 0.9)));
    expect(await refused(s, n, { type: "offer", terms })).toMatch(/haven't signed/);

    await act(s, n, { type: "client_review", pending: { type: "offer", terms } });
    expect(lastClient(n).verdict).toBe("signed");
    // A different document needs its own signature.
    expect(await refused(s, n, { type: "offer", terms: { ...terms, price: terms.price - 1_000 } })).toMatch(/haven't signed/);
    await act(s, n, { type: "offer", terms });
    expect(n.offers.filter((o) => o.by === "buyer")).toHaveLength(1);
    expect(n.client!.signature).toBeNull();
  });

  it("refuses a draft that breaks a hidden requirement, and that's how the agent learns of it", async () => {
    const s = scenario("buyer_agent", 120, (x) => !x.offerNight && clientFacts(x).some((f) => f.id === "require-chattel"));
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    const base = setNet("buyer", s, defaultBuyerTerms(s), Math.round(s.buyer.reservationPrice * 0.9));
    const terms = satisfy(s, base);
    const fact = clientFacts(s).find((f) => f.id === "require-chattel")!;
    const without = { ...terms, chattels: base.chattels };
    await act(s, n, { type: "client_review", pending: { type: "offer", terms: without } });
    const reply = lastClient(n);
    expect(reply.verdict).toBe("refused");
    expect(reply.text).toContain(fact.says);
    expect(n.client!.uncovered).toEqual([expect.objectContaining({ factId: fact.id, how: "refusal" })]);
    expect(n.client!.signature).toBeNull();
  });

  it("signs reluctantly at the limit, and refuses past it until room is uncovered", async () => {
    const s = scenario("buyer_agent", 150, (x) => !x.offerNight && clientFacts(x).some((f) => f.id === "room-timing"));
    const fact = clientFacts(s).find((f) => f.id === "room-timing")! as ClientFact & { effect: { kind: "room"; amount: number; completionBy: string } };
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    const base = satisfy(s, { ...defaultBuyerTerms(s), completionDate: fact.effect.completionBy > s.buyer.earliestClose ? s.buyer.earliestClose : fact.effect.completionBy });
    const atLimit = setNet("buyer", s, base, s.buyer.reservationPrice);
    await act(s, n, { type: "client_review", pending: { type: "offer", terms: atLimit } });
    expect(lastClient(n).verdict).toBe("reluctant");

    const stretch = setNet("buyer", s, base, s.buyer.reservationPrice + fact.effect.amount);
    expect(clientViolations(s, n, stretch).some((v) => v.startsWith("Price"))).toBe(true);
    await act(s, n, { type: "client_message", text: "If we could close sooner, would that change the price you'd pay?" });
    expect(n.client!.uncovered.map((u) => u.factId)).toContain("room-timing");
    expect(extraRoom(s, ["room-timing"], stretch)).toBe(fact.effect.amount);
    expect(clientViolations(s, n, stretch).some((v) => v.startsWith("Price"))).toBe(false);
    // The room only applies on its dates.
    const late = { ...stretch, completionDate: s.buyer.latestClose };
    if (s.buyer.latestClose > fact.effect.completionBy) expect(clientViolations(s, n, late).some((v) => v.startsWith("Price"))).toBe(true);
  });

  it("presents the other side's offer, and flags answering one you never presented", async () => {
    const s = scenario("seller_agent", 200, (x) => !x.offerNight);
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    const theirs = n.offers.find((o) => o.by === "buyer")!;
    expect(theirs).toBeDefined();
    const signBack = satisfy(s, setNet("seller", s, theirs.terms, Math.max(s.seller.reservationPrice, netPrice(s, theirs.terms)) + 20_000));
    await act(s, n, { type: "client_review", pending: { type: "offer", terms: signBack } });
    expect(lastClient(n).verdict).not.toBe("refused");
    await act(s, n, { type: "offer", terms: signBack });
    expect(reviewCompliance(s, n).some((f) => f.rule === "client_duty" && /without presenting/.test(f.title))).toBe(true);

    const n2 = withClient(s);
    await startNegotiation(s, n2, offlinePlayer);
    await act(s, n2, { type: "client_present", offerId: n2.offers[0].id });
    expect(n2.client!.presented).toContain(n2.offers[0].id);
    expect(await refused(s, n2, { type: "client_present", offerId: n2.offers[0].id })).toMatch(/already presented/);
    await act(s, n2, { type: "client_review", pending: { type: "offer", terms: signBack } });
    await act(s, n2, { type: "offer", terms: signBack });
    expect(reviewCompliance(s, n2).some((f) => f.rule === "client_duty")).toBe(false);
  });

  it("flags pressuring your client and legal advice to them, but not ordinary advice", async () => {
    const s = scenario("buyer_agent", 240, (x) => !x.offerNight);
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    await act(s, n, { type: "client_message", text: "I'd suggest we open at $20,000 under list, backed by the comps." });
    expect(reviewCompliance(s, n).filter((f) => f.rule === "client_duty")).toEqual([]);
    await act(s, n, { type: "client_message", text: "Honestly, you need to stretch past your budget or you'll lose it." });
    await act(s, n, { type: "client_message", text: "Legally the sellers can sue you if you back out." });
    const flags = reviewCompliance(s, n);
    expect(flags.some((f) => f.rule === "client_duty" && f.title === "Pressured your client")).toBe(true);
    expect(flags.some((f) => f.rule === "legal_advice" && /your client/.test(f.title))).toBe(true);
  });

  it("needs the sellers' written direction before disclosing offer contents on offer night", async () => {
    const s = scenario("seller_agent", 1, (x) => x.offerNight?.sellerDisclosure === "details");
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    // The listing side doesn't start as an offer night: the sellers decide, here to hold offers.
    expect(n.offerNight ?? null).toBeNull();
    expect(n.messages.some((m) => /Agree with your sellers how offers will be handled/.test(m.text))).toBe(true);
    await act(s, n, { type: "client_hold", hold: true });
    expect(n.offerNight!.phase).toBe("registration");
    expect(await refused(s, n, { type: "set_disclosure", disclosure: "details" })).toMatch(/written direction/);
    await act(s, n, { type: "client_direction" });
    expect(n.client!.direction).toBe("details");
    await act(s, n, { type: "set_disclosure", disclosure: "details" });
    expect(n.offerNight!.disclosure).toBe("details");
  });

  it("leaves deals without the client conversation as they were", async () => {
    const s = scenario("buyer_agent", 90, (x) => !x.offerNight);
    const n = newNegotiation(s.id);
    await startNegotiation(s, n, offlinePlayer);
    const terms = setNet("buyer", s, defaultBuyerTerms(s), Math.round(s.buyer.reservationPrice * 0.9));
    expect(requirementProblems(s, terms).length).toBeGreaterThanOrEqual(0);
    await act(s, n, { type: "offer", terms });
    expect(n.offers.some((o) => o.by === "buyer")).toBe(true);
  });
});
