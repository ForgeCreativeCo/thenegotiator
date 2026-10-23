import { describe, expect, it } from "vitest";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Role, Scenario } from "../server/engine/types";
import { reviewCompliance, complianceScore } from "../server/coach/compliance";
import { buildDebrief } from "../server/coach/debrief";
import { offlineAdvice } from "../server/coach/mentor";
import { offlineTurn } from "../server/negotiation/botOffline";
import { applyUserAction, pushMessage, startNegotiation, type BotPlayer } from "../server/negotiation/engine";
import { newNegotiation, type Negotiation } from "../server/negotiation/types";
import { netPrice, setNet, violations } from "../server/negotiation/constraints";
import { defaultBuyerTerms } from "../server/negotiation/terms";
import { applyTxAction, conditionReady } from "../server/transaction/engine";

const offlinePlayer: BotPlayer = async (s, rec, ctx, _h, round) => ({ ...offlineTurn(s, rec, ctx.userTerms, round, ctx.clientUpdate), source: "offline", issues: [] });
const draft = async (_s: unknown, _n: unknown, _a: string, _b: string, d: string) => d;

function scenario(role: Role, seed = 11): Scenario {
  for (let i = seed; ; i++) {
    const p = generateParams({ seed: i, startDate: "2026-10-23", role });
    if (p.difficulty.dealSpace === "none") continue;
    return { ...p, offerNight: null, id: `s${i}`, createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
  }
}

function said(n: Negotiation, text: string): void {
  pushMessage(n, { speaker: "user", text, action: "message" });
}

describe("RECO compliance review", () => {
  it("flags a disclosed limit and motivation, but not an ordinary offer price", () => {
    const s = scenario("buyer_agent");
    const n = newNegotiation(s.id);
    said(n, `We're offering $${(s.buyer.reservationPrice - 40_000).toLocaleString("en-CA")} with a 5-day inspection.`);
    expect(reviewCompliance(s, n)).toEqual([]);
    said(n, `Honestly my buyers' max is $${s.buyer.reservationPrice.toLocaleString("en-CA")}.`);
    said(n, "They're desperate, they need to move by the end of the month.");
    const flags = reviewCompliance(s, n);
    expect(flags.filter((f) => f.rule === "confidentiality")).toHaveLength(2);
    expect(complianceScore(flags)).toBe(50);
  });

  it("flags phantom offers from the listing side, but not a truthful 'no other offers'", () => {
    const s = scenario("seller_agent");
    const n = newNegotiation(s.id);
    said(n, "There are no other offers right now, but the showings have been steady.");
    expect(reviewCompliance(s, n).filter((f) => f.rule === "misrepresentation")).toEqual([]);
    said(n, "We have three other offers coming in tonight.");
    expect(reviewCompliance(s, n).some((f) => f.rule === "misrepresentation" && f.severity === "breach")).toBe(true);
  });

  it("cautions against legal advice", () => {
    const s = scenario("seller_agent");
    const n = newNegotiation(s.id);
    said(n, "If your buyers back out, legally my sellers can sue them.");
    expect(reviewCompliance(s, n).some((f) => f.rule === "legal_advice")).toBe(true);
  });
});

/** Plays a buyer-side deal: offer near the limit, accept their counter when signable, then handle conditions. */
async function playBuyerDeal(s: Scenario): Promise<Negotiation> {
  const n = newNegotiation(s.id);
  await startNegotiation(s, n, offlinePlayer);
  let net = s.property.listPrice * 0.95;
  for (let i = 0; i < 10 && n.status === "negotiating"; i++) {
    const theirs = [...n.offers].reverse().find((o) => o.by === "seller" && o.status === "open");
    if (theirs && violations("buyer", s, theirs.terms).length === 0 && netPrice(s, theirs.terms) <= s.buyer.reservationPrice) {
      await applyUserAction(s, n, { type: "accept" }, offlinePlayer);
      break;
    }
    await applyUserAction(s, n, { type: "offer", terms: setNet("buyer", s, theirs?.terms ?? defaultBuyerTerms(s), Math.round(Math.min(net, s.buyer.reservationPrice))) }, offlinePlayer);
    net += (s.buyer.reservationPrice - net) * 0.4;
  }
  for (let i = 0; i < 200 && n.transaction?.status === "active"; i++) {
    const tx = n.transaction;
    const ready = tx.conditions.find((c) => c.status === "pending" && conditionReady(tx, c.key));
    if (ready) await applyTxAction(s, n, { type: "condition", key: ready.key, how: conditionReady(tx, ready.key) === "fulfilled" ? "fulfil" : "waive" }, draft);
    else {
      const open = tx.issues.find((x) => x.status === "open" && x.requester === "buyer" && x.proposals.length === 0);
      if (open) await applyTxAction(s, n, { type: "withdraw", issueId: open.id }, draft);
      else await applyTxAction(s, n, { type: "advance", mode: "next" }, draft);
    }
  }
  return n;
}

describe("debrief", () => {
  it("reveals both sides and scores a finished deal", async () => {
    let checked = 0;
    for (let seed = 1; seed < 400 && checked < 8; seed += 37) {
      const s = scenario("buyer_agent", seed);
      const n = await playBuyerDeal(s);
      if (n.status === "negotiating" || n.transaction?.status === "active") continue;
      const d = await buildDebrief(s, n, false);
      checked++;
      for (const score of Object.values(d.scores)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
      expect(d.clients.seller.brief.reservationPrice).toBe(s.seller.reservationPrice);
      expect(d.agentReasoning.length).toBeGreaterThan(0);
      expect(d.critique.wentWell.length).toBeGreaterThan(0);
      expect(d.critique.source).toBe("offline");
      if (n.transaction?.status === "closed") expect(d.dealSpace.finalNet).not.toBeNull();
    }
    expect(checked).toBeGreaterThan(3);
  });

  it("isn't available while the deal is still running", async () => {
    const s = scenario("buyer_agent");
    const n = newNegotiation(s.id);
    await startNegotiation(s, n, offlinePlayer);
    await expect(buildDebrief(s, n, false)).rejects.toThrow();
  });
});

describe("mentor", () => {
  it("gives advice from the user's side only, never the other side's limit", async () => {
    for (const role of ["buyer_agent", "seller_agent"] as Role[]) {
      const s = scenario(role, 21);
      const n = newNegotiation(s.id);
      await startNegotiation(s, n, offlinePlayer);
      const advice = offlineAdvice(s, n);
      expect(advice.length).toBeGreaterThan(40);
      const other = role === "buyer_agent" ? s.seller.reservationPrice : s.buyer.reservationPrice;
      expect(advice).not.toContain(other.toLocaleString("en-CA"));
    }
  });
});

describe("progress", () => {
  it("scores finished deals and counts unfinished ones without scoring them", async () => {
    const entries: { scenario: Scenario; negotiation: Negotiation | null }[] = [];
    for (let seed = 1; seed < 400 && entries.filter((e) => e.negotiation && e.negotiation.status !== "negotiating").length < 3; seed += 41) {
      const s = scenario("buyer_agent", seed);
      entries.push({ scenario: s, negotiation: await playBuyerDeal(s) });
    }
    entries.push({ scenario: scenario("seller_agent", 5), negotiation: null });
    const { buildProgress } = await import("../server/coach/progress");
    const p = await buildProgress(entries);
    expect(p.deals).toHaveLength(entries.length);
    expect(p.deals.at(-1)!.status).toBe("not_started");
    const scored = p.deals.filter((d) => d.scores);
    expect(scored.length).toBe(p.totals.finished);
    expect(p.totals.averageOverall).not.toBeNull();
    expect(p.totals.byRole.buyer_agent.finished).toBe(p.totals.finished);
  });
});
