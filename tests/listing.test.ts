import { beforeAll, describe, expect, it } from "vitest";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Role, Scenario } from "../server/engine/types";
import { offlineTurn } from "../server/negotiation/botOffline";
import { ActionError, applyUserAction, startNegotiation, type BotPlayer, type UserAction } from "../server/negotiation/engine";
import { newNegotiation, type Negotiation } from "../server/negotiation/types";
import { newClientState } from "../server/client/types";
import { clientFacts } from "../server/client/facts";
import { allCompetitors, liveCompetitors, listingView } from "../server/negotiation/listing";
import { reviewCompliance } from "../server/coach/compliance";
import { buildDebrief } from "../server/coach/debrief";
import type { Terms } from "../server/negotiation/terms";

const offlinePlayer: BotPlayer = async (s, rec, ctx, _h, round) => ({ ...offlineTurn(s, rec, ctx.userTerms, round, ctx.clientUpdate, { userText: ctx.userText, used: ctx.usedLines, competing: ctx.competingOffers }), source: "offline", issues: [] });

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

function scenario(role: Role, filter: (s: Scenario) => boolean, from = 1): Scenario {
  for (let seed = from; seed < from + 20_000; seed++) {
    const p = generateParams({ seed, startDate: "2026-10-25", role });
    const s: Scenario = { ...p, id: `s${seed}`, createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
    if (p.difficulty.dealSpace !== "none" && filter(s)) return s;
  }
  throw new Error("No matching scenario");
}

const competitors = (s: Scenario) => s.groundTruth.competingOffers.filter((o) => o.phase === "pre_contract");
/** The first competing buyer to arrive is one the sellers could sign as is. */
const firstIsSignable = (s: Scenario) => {
  const first = [...competitors(s)].sort((a, b) => a.arrivesDay - b.arrivesDay)[0];
  return Boolean(first) && first.strength !== "weak" && first.price >= s.seller.reservationPrice && competitors(s).filter((o) => o.arrivesDay === first.arrivesDay).length === 1;
};

function withClient(s: Scenario): Negotiation {
  return { ...newNegotiation(s.id), client: newClientState(true) };
}

const act = (s: Scenario, n: Negotiation, a: UserAction) => applyUserAction(s, n, a, offlinePlayer);

async function refused(s: Scenario, n: Negotiation, a: UserAction): Promise<string> {
  try {
    await act(s, n, a);
  } catch (e) {
    if (e instanceof ActionError) return e.message;
    throw e;
  }
  throw new Error(`Expected ${a.type} to be refused`);
}

/** Review with the sellers, then send: the normal way anything with legal effect goes out. */
async function signAndSend(s: Scenario, n: Negotiation, a: UserAction): Promise<void> {
  await act(s, n, { type: "client_review", pending: a });
  const reply = n.client!.messages.filter((m) => m.speaker === "client").at(-1)!;
  expect(reply.verdict, reply.details?.join("; ")).not.toBe("refused");
  await act(s, n, a);
}

async function waitForCompetitor(s: Scenario, n: Negotiation): Promise<void> {
  for (let i = 0; i < 30 && !liveCompetitors(n).length; i++) await act(s, n, { type: "wait" });
  expect(liveCompetitors(n).length).toBeGreaterThan(0);
}

/** A listing scenario with competing buyers, and sellers without hidden requirements, so competing terms sign as they are. */
function listingWithCompetitors(extra: (s: Scenario) => boolean = () => true): Scenario {
  const s = scenario("seller_agent", (x) => competitors(x).length >= 1 && extra(x));
  return { ...s, clientFacts: clientFacts(s).filter((f) => f.effect.kind !== "require") };
}

describe("competing offers on the listing side", () => {
  it("arrive as real offers, are presented, and are hidden from nobody but their ceilings", async () => {
    const s = listingWithCompetitors();
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    expect(n.listing?.mode).toBe("any_time");
    expect(n.offerNight ?? null).toBeNull();
    await waitForCompetitor(s, n);
    const c = liveCompetitors(n)[0];
    expect(n.messages.some((m) => m.text.startsWith(`${c.label} arrived`))).toBe(true);
    const view = listingView(s, n)!;
    expect(JSON.stringify(view)).not.toContain("maxPrice");
    expect(JSON.stringify(view)).not.toContain("strength");
    await act(s, n, { type: "client_present", competitorId: c.id });
    expect(n.client!.presented).toContain(`competitor:${c.id}`);
  });

  it("allows only one agreement: accepting a competing offer ends the deal and releases everyone else", async () => {
    const s = listingWithCompetitors((x) => competitors(x).length >= 2 && firstIsSignable(x));
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    await waitForCompetitor(s, n);
    const c = liveCompetitors(n)[0];
    const accept: UserAction = { type: "accept_competitor", competitorId: c.id };
    expect(await refused(s, n, accept)).toMatch(/haven't signed/);
    await act(s, n, { type: "client_present", competitorId: c.id });
    await signAndSend(s, n, accept);
    expect(n.status).toBe("sold_to_other");
    expect(allCompetitors(n).filter((x) => x.status === "accepted")).toHaveLength(1);
    expect(n.offers.some((o) => o.status === "open" || o.status === "registered")).toBe(false);
    expect(await refused(s, n, { type: "accept", text: "" })).toMatch(/over/);
    const d = await buildDebrief(s, n, false);
    expect(d.outcome.label).toBe("Sold to another buyer");
    expect(d.dealSpace.finalNet).not.toBeNull();
  });

  it("allows only one sign-back out at a time", async () => {
    const s = listingWithCompetitors(firstIsSignable);
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    await waitForCompetitor(s, n);
    const c = liveCompetitors(n)[0];
    await act(s, n, { type: "client_present", competitorId: c.id });
    const signBack: UserAction = { type: "signback_competitor", competitorId: c.id, terms: { ...c.terms, price: c.terms.price + 1_000, irrevocableHours: 6 } as Terms };
    await signAndSend(s, n, signBack);
    expect(n.listing!.signBackOut?.competitorId).toBe(c.id);
    // The buyer the agents were negotiating with can't be accepted or signed back meanwhile.
    const theirs = [...n.offers].reverse().find((o) => o.by === "buyer" && o.status === "open");
    if (theirs) expect(await refused(s, n, { type: "accept" })).toMatch(/sign-back out/);
    await act(s, n, { type: "wait" });
    expect(n.listing!.signBackOut).toBeNull();
    expect(["sold_to_other", "negotiating"]).toContain(n.status);
    if (n.status === "negotiating") expect(c.status).toBe("withdrawn");
  });

  it("releases competing buyers when the sellers accept the buyer they were negotiating with", async () => {
    const s = listingWithCompetitors();
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    await waitForCompetitor(s, n);
    const theirs = [...n.offers].reverse().find((o) => o.by === "buyer" && o.status === "open");
    if (!theirs) return;
    for (const c of liveCompetitors(n)) await act(s, n, { type: "client_present", competitorId: c.id });
    await act(s, n, { type: "client_present", offerId: theirs.id }).catch(() => {});
    await act(s, n, { type: "client_review", pending: { type: "accept" } });
    if (n.client!.messages.filter((m) => m.speaker === "client").at(-1)!.verdict === "refused") return;
    await act(s, n, { type: "accept" });
    expect(n.status).toBe("under_contract");
    expect(allCompetitors(n).filter((c) => c.registeredAt <= n.simHours).every((c) => c.status !== "registered")).toBe(true);
    expect(n.messages.some((m) => /told the property is sold/.test(m.text))).toBe(true);
  });

  it("lets the sellers decide to hold offers, which turns the listing into an offer night", async () => {
    const s = listingWithCompetitors();
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    await act(s, n, { type: "client_hold", hold: true });
    expect(n.listing!.mode).toBe("held");
    expect(n.offerNight!.phase).toBe("registration");
    expect(n.offerNight!.reviewAtHours).toBeGreaterThanOrEqual(24);
    expect(n.offers.filter((o) => o.by === "buyer").at(-1)!.status).toBe("registered");
    expect(n.client!.messages.some((m) => /signed a written decision: hold offers/.test(m.text))).toBe(true);
    expect(await refused(s, n, { type: "client_hold", hold: false })).toMatch(/already being held/);
  });

  it("brings released buyers back after a collapse, as a fresh offer", async () => {
    const s = listingWithCompetitors((x) => competitors(x).some((o) => o.strength === "strong"));
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    for (let i = 0; i < 30 && !liveCompetitors(n).some((c) => c.strength === "strong"); i++) await act(s, n, { type: "wait" });
    const strong = liveCompetitors(n).find((c) => c.strength === "strong")!;
    // Release everyone as an acceptance would, then the deal collapses.
    for (const c of allCompetitors(n)) if (c.status === "registered" && c.registeredAt <= n.simHours) Object.assign(c, { status: "released", releasedAt: n.simHours });
    n.status = "dead";
    expect(listingView(s, n)!.canRelist).toBe(true);
    await act(s, n, { type: "invite_back", competitorId: strong.id });
    const invite = n.listing!.invites[0];
    expect(invite.competitorId).toBe(strong.id);
    if (invite.result === "returned") {
      expect(strong.status).toBe("registered");
      await act(s, n, { type: "client_present", competitorId: strong.id });
      await signAndSend(s, n, { type: "accept_competitor", competitorId: strong.id });
      expect(n.status).toBe("sold_to_other");
    } else {
      expect(strong.status).toBe("moved_on");
    }
    expect(await refused(s, n, { type: "invite_back", competitorId: strong.id })).toBeTruthy();
  });

  it("flags offers never presented, and acting before telling the agents the count", async () => {
    const s = listingWithCompetitors();
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    await waitForCompetitor(s, n);
    const c = liveCompetitors(n)[0];
    await act(s, n, { type: "decline_competitor", competitorId: c.id });
    let flags = reviewCompliance(s, n);
    expect(flags.some((f) => f.rule === "client_duty" && f.title.includes(c.label) && f.severity === "breach")).toBe(true);
    const theirs = [...n.offers].reverse().find((o) => o.by === "buyer" && o.status === "open");
    const other = liveCompetitors(n)[0];
    if (theirs && other) {
      const counter = { ...theirs.terms, price: theirs.terms.price + 5_000 };
      await act(s, n, { type: "client_review", pending: { type: "offer", terms: counter } });
      if (n.client!.messages.filter((m) => m.speaker === "client").at(-1)!.verdict !== "refused") {
        await act(s, n, { type: "offer", terms: counter });
        flags = reviewCompliance(s, n);
        expect(flags.some((f) => f.rule === "count_rule")).toBe(true);
      }
    }
  });

  it("tells every agent the true count", async () => {
    const s = listingWithCompetitors();
    const n = withClient(s);
    await startNegotiation(s, n, offlinePlayer);
    await waitForCompetitor(s, n);
    const count = listingView(s, n)!.writtenOffers;
    if (count < 2) {
      expect(await refused(s, n, { type: "tell_count" })).toMatch(/only one/);
      return;
    }
    await act(s, n, { type: "tell_count" });
    expect(n.listing!.countDisclosed).toBe(true);
    expect(n.messages.some((m) => m.text.includes(`there are ${count} written offers`))).toBe(true);
  });
});

describe("competing offers on the buyer side", () => {
  it("the listing side holds offers or sells to the other buyer when competition arrives", async () => {
    let held = 0;
    let lost = 0;
    for (let from = 1; from < 4_000 && (held === 0 || lost === 0); from += 97) {
      const s = scenario("buyer_agent", (x) => competitors(x).length >= 1 && !x.offerNight, from);
      const n = withClient(s);
      await startNegotiation(s, n, offlinePlayer);
      for (let i = 0; i < 60 && n.status === "negotiating" && n.listing!.mode === "any_time" && !n.listing!.competitors.some((c) => c.registeredAt <= n.simHours); i++) {
        await act(s, n, { type: "message", text: "Any update on your side?" });
      }
      if (n.status === "lost") {
        lost++;
        expect(n.messages.some((m) => /Another buyer.s offer was accepted/.test(m.text))).toBe(true);
      }
      if (n.listing!.mode === "held") {
        held++;
        expect(n.offerNight!.phase).toBe("registration");
        expect(n.offerNight!.countDisclosed).toBe(true);
      }
    }
    expect(held + lost).toBeGreaterThan(0);
  });
});
