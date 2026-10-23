import { describe, expect, it } from "vitest";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Role, Scenario } from "../server/engine/types";
import { offlineTurn } from "../server/negotiation/botOffline";
import { ActionError, applyUserAction, offerNightView, startNegotiation, type BotPlayer, type UserAction } from "../server/negotiation/engine";
import { newNegotiation, type Negotiation } from "../server/negotiation/types";
import { setNet, violations } from "../server/negotiation/constraints";
import { defaultBuyerTerms } from "../server/negotiation/terms";

const offlinePlayer: BotPlayer = async (s, rec, ctx, _h, round) => ({ ...offlineTurn(s, rec, ctx.userTerms, round, ctx.clientUpdate), source: "offline", issues: [] });

/** Offer-night scenarios for the given role, found by scanning seeds. */
function offerNightScenarios(role: Role, count: number): Scenario[] {
  const found: Scenario[] = [];
  for (let seed = 1; found.length < count && seed < 40_000; seed++) {
    const p = generateParams({ seed, startDate: "2026-10-23", role });
    if (!p.offerNight) continue;
    found.push({ ...p, id: `s${seed}`, createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" });
  }
  return found;
}

async function act(s: Scenario, n: Negotiation, action: UserAction): Promise<boolean> {
  try {
    await applyUserAction(s, n, action, offlinePlayer);
    return true;
  } catch (e) {
    if (e instanceof ActionError) return false;
    throw e;
  }
}

/** A buyer's offer at a given net price that the user's own client will sign. */
function buyerOffer(s: Scenario, net: number) {
  return setNet("buyer", s, defaultBuyerTerms(s, { depositTiming: "herewith" }), Math.round(net));
}

describe("offer night setup", () => {
  it("only happens in hot markets where offer nights are common and there are competing buyers", () => {
    for (let seed = 1; seed < 3_000; seed++) {
      const p = generateParams({ seed, startDate: "2026-10-23" });
      if (!p.offerNight) continue;
      expect(p.market.temperature).toBe("hot");
      expect(p.market.offerNightsCommon).toBe(true);
      expect(p.groundTruth.competingOffers.some((o) => o.phase === "pre_contract")).toBe(true);
    }
    expect(offerNightScenarios("buyer_agent", 5)).toHaveLength(5);
  });
});

describe("offer night as the buyer's agent", () => {
  it("runs registration, review, and improvement to a decision, never accepting an offer the seller won't sign", async () => {
    const outcomes: Record<string, number> = {};
    for (const s of offerNightScenarios("buyer_agent", 60)) {
      const n = newNegotiation(s.id);
      await startNegotiation(s, n, offlinePlayer);
      expect(offerNightView(s, n)!.competingCount).toBeNull(); // nothing disclosed until they register
      expect(await act(s, n, { type: "offer", terms: buyerOffer(s, s.buyer.reservationPrice * 0.97) })).toBe(true);
      expect(offerNightView(s, n)!.competingCount).not.toBeNull(); // the count rule
      await act(s, n, { type: "review" });
      if (n.offerNight!.phase === "improvement") {
        expect(await act(s, n, { type: "offer", terms: buyerOffer(s, s.buyer.reservationPrice) })).toBe(true);
        await act(s, n, { type: "review" });
      }
      outcomes[n.status] = (outcomes[n.status] ?? 0) + 1;
      expect(["under_contract", "lost", "negotiating"]).toContain(n.status);
      if (n.status === "under_contract") expect(violations("seller", s, n.offers.find((o) => o.id === n.acceptedOfferId)!.terms)).toEqual([]);
      // A buyer never sees competitors' contents unless the seller directed disclosure.
      if (s.offerNight!.sellerDisclosure === "count_only") expect(offerNightView(s, n)!.competitors).toEqual([]);
    }
    expect(outcomes.under_contract ?? 0).toBeGreaterThan(0);
    expect(outcomes.lost ?? 0).toBeGreaterThan(0);
  });

  it("a buyer who doesn't register loses the property", async () => {
    const s = offerNightScenarios("buyer_agent", 1)[0];
    const n = newNegotiation(s.id);
    await startNegotiation(s, n, offlinePlayer);
    await act(s, n, { type: "review" });
    if (n.offerNight!.phase === "improvement") await act(s, n, { type: "review" });
    expect(n.status).toBe("lost");
  });

  it("pre-emptive offers are turned away when the listing says so", async () => {
    const s = offerNightScenarios("buyer_agent", 40).find((x) => x.offerNight!.preemptives === "not_accepted")!;
    const n = newNegotiation(s.id);
    await startNegotiation(s, n, offlinePlayer);
    await act(s, n, { type: "offer", preemptive: true, terms: buyerOffer(s, s.buyer.reservationPrice) });
    expect(n.status).toBe("negotiating");
    expect(n.offers.at(-1)!.status).toBe("rejected");
  });
});

describe("offer night as the listing agent", () => {
  it("presents all offers, allows one improvement round, and lets the seller accept the best", async () => {
    let soldToOther = 0;
    for (const s of offerNightScenarios("seller_agent", 40)) {
      const n = newNegotiation(s.id);
      await startNegotiation(s, n, offlinePlayer);
      if (n.offers.at(-1)?.preemptive) expect(await act(s, n, { type: "decline" })).toBe(true);
      // Registered offers stay sealed until the review.
      expect(await act(s, n, { type: "accept" })).toBe(false);
      expect(await act(s, n, { type: "review" })).toBe(true);
      const view = offerNightView(s, n)!;
      expect(view.competitors.length).toBeGreaterThan(0);
      if (s.offerNight!.sellerDisclosure === "count_only") expect(await act(s, n, { type: "set_disclosure", disclosure: "details" })).toBe(false);
      const firstBid = n.offers.filter((o) => o.by === "buyer" && o.status === "registered").at(-1)!.terms.price;
      expect(await act(s, n, { type: "improve" })).toBe(true);
      const secondBid = n.offers.filter((o) => o.by === "buyer" && o.status === "registered").at(-1)!.terms.price;
      expect(secondBid).toBeGreaterThanOrEqual(firstBid);
      expect(secondBid).toBeLessThanOrEqual(s.buyer.reservationPrice);
      expect(await act(s, n, { type: "improve" })).toBe(false); // only once

      // Take the best signable competitor if there is one, otherwise the bot buyer.
      const best = offerNightView(s, n)!.competitors.filter((c) => c.terms && violations("seller", s, c.terms).length === 0).sort((a, b) => b.price - a.price)[0];
      if (best && best.price > secondBid) {
        expect(await act(s, n, { type: "accept_competitor", competitorId: best.id })).toBe(true);
        expect(n.status).toBe("sold_to_other");
        soldToOther++;
      } else if (await act(s, n, { type: "accept" })) {
        expect(n.status).toBe("under_contract");
      }
    }
    expect(soldToOther).toBeGreaterThan(0);
  });
});
