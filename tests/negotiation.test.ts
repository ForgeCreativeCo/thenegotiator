import { describe, expect, it } from "vitest";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Scenario, Side } from "../server/engine/types";
import { defaultBuyerTerms, type Terms } from "../server/negotiation/terms";
import { netFor, repairTerms, setNet, violations } from "../server/negotiation/constraints";
import { botSide, reservationNet } from "../server/negotiation/strategy";
import { offlineTurn } from "../server/negotiation/botOffline";
import { ActionError, applyUserAction, startNegotiation, userSide, type BotPlayer } from "../server/negotiation/engine";
import { newNegotiation, type Negotiation } from "../server/negotiation/types";

const START = "2026-10-23";
const SEEDS = Array.from({ length: 400 }, (_, i) => i * 104_729 + 7);

function scenario(seed: number): Scenario {
  const params = generateParams({ seed, startDate: START });
  return { ...params, id: `s${seed}`, createdAt: START, narrative: writeOfflineNarrative(params), narrativeSource: "offline" };
}

const offlinePlayer: BotPlayer = async (s, rec, ctx, _history, round) => ({ ...offlineTurn(s, rec, ctx.userTerms, round, ctx.clientUpdate), source: "offline", issues: [] });

/** Terms both clients should sign when a deal is possible: midpoint price, the buyer's required conditions kept short. */
function midpointTerms(s: Scenario): Terms {
  const mid = Math.round((s.seller.reservationPrice + s.buyer.reservationPrice) / 2);
  const overlapStart = s.seller.earliestClose > s.buyer.earliestClose ? s.seller.earliestClose : s.buyer.earliestClose;
  let t = defaultBuyerTerms(s, { price: mid, deposit: Math.ceil((mid * s.seller.minDepositPct) / 100 / 1000) * 1000, completionDate: overlapStart });
  t = repairTerms("buyer", s, t);
  t.conditions = t.conditions.map((c) => ({ ...c, days: c.key === "sale_of_property" ? c.days : Math.min(c.days, s.seller.maxConditionDays) }));
  t.price = mid;
  return t;
}

describe("client sign-off rules", () => {
  it("a deal exists whenever the scenario says one should", () => {
    const failures: string[] = [];
    for (const seed of SEEDS) {
      const s = scenario(seed);
      if (s.difficulty.dealSpace === "none") continue;
      const t = midpointTerms(s);
      const problems = [...violations("seller", s, t), ...violations("buyer", s, t)];
      if (problems.length) failures.push(`seed ${seed}: ${problems.join("; ")}`);
    }
    expect(failures, failures.slice(0, 5).join("\n")).toEqual([]);
  });

  it("repairTerms fixes every non-price problem for that side", () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const s = scenario(seed);
      for (const side of ["buyer", "seller"] as Side[]) {
        const messy = defaultBuyerTerms(s, { completionDate: "2030-01-01", conditions: [{ key: "inspection", days: 60 }, { key: "sale_of_property", days: 30 }], deposit: 0, preClosingVisits: 9 });
        const fixed = setNet(side, s, messy, reservationNetFor(s, side));
        expect(violations(side, s, fixed), `seed ${seed} ${side}`).toEqual([]);
      }
    }
  });
});

function reservationNetFor(s: Scenario, side: Side): number {
  return side === "seller" ? s.seller.reservationPrice : s.buyer.reservationPrice;
}

/** A simulated user who concedes steadily toward their own limit and accepts anything signable near their target. */
async function playOut(s: Scenario, concession = 0.3): Promise<Negotiation> {
  const n = newNegotiation(s.id);
  await startNegotiation(s, n, offlinePlayer);
  const mine = userSide(s);
  const dir = mine === "seller" ? 1 : -1;
  const myLimit = reservationNetFor(s, mine);
  let position = mine === "buyer" ? Math.min(s.property.listPrice * 0.94, myLimit) : Math.max(s.property.listPrice, myLimit);

  for (let i = 0; i < 20 && n.status === "negotiating"; i++) {
    const theirs = [...n.offers].reverse().find((o) => o.by !== mine && o.status === "open");
    if (theirs && violations(mine, s, theirs.terms).length === 0 && dir * (netFor(s, theirs.terms) - position) >= 0) {
      await applyUserAction(s, n, { type: "accept" }, offlinePlayer);
      break;
    }
    const base = theirs?.terms ?? defaultBuyerTerms(s);
    const terms = setNet(mine, s, base, Math.round(position));
    await applyUserAction(s, n, { type: "offer", text: "Here's our offer.", terms }, offlinePlayer);
    position = position + (myLimit - position) * concession;
  }
  return n;
}

describe("opposing agent", () => {
  it("never counters or accepts outside its client's limits, and never retrades", async () => {
    for (const seed of SEEDS.slice(0, 250)) {
      const s = scenario(seed);
      const n = await playOut(s);
      const side = botSide(s);
      const dir = side === "seller" ? 1 : -1;
      let last: number | null = null;
      for (const offer of n.offers.filter((o) => o.by === side)) {
        expect(violations(side, s, offer.terms), `seed ${seed}`).toEqual([]);
        const net = netFor(s, offer.terms);
        if (last !== null) expect(dir * (net - last), `seed ${seed} retrade`).toBeLessThanOrEqual(reservationNet(s) * 0.002);
        last = net;
      }
      if (n.status === "under_contract") {
        const accepted = n.offers.find((o) => o.id === n.acceptedOfferId)!;
        expect(violations("seller", s, accepted.terms), `seed ${seed} seller`).toEqual([]);
        expect(violations("buyer", s, accepted.terms), `seed ${seed} buyer`).toEqual([]);
      }
    }
  });

  it("reaches a deal with a reasonable user when one is possible, and never when it isn't", async () => {
    let possible = 0;
    let closed = 0;
    for (const seed of SEEDS.slice(0, 250)) {
      const s = scenario(seed);
      const n = await playOut(s);
      if (s.difficulty.dealSpace === "none") {
        expect(n.status, `seed ${seed}`).not.toBe("under_contract");
      } else {
        possible++;
        if (n.status === "under_contract") closed++;
      }
    }
    expect(closed / possible).toBeGreaterThan(0.85);
  });

  it("opens with an offer when it represents the buyer", async () => {
    const s = SEEDS.map(scenario).find((x) => x.userRole === "seller_agent")!;
    const n = newNegotiation(s.id);
    await startNegotiation(s, n, offlinePlayer);
    expect(n.offers).toHaveLength(1);
    expect(n.offers[0].by).toBe("buyer");
    expect(violations("buyer", s, n.offers[0].terms)).toEqual([]);
  });
});

describe("user's own client", () => {
  it("refuses to sign an offer outside the brief", async () => {
    const s = SEEDS.map(scenario).find((x) => x.userRole === "buyer_agent")!;
    const n = newNegotiation(s.id);
    await startNegotiation(s, n, offlinePlayer);
    const terms = defaultBuyerTerms(s, { price: s.buyer.reservationPrice + 50_000 });
    await expect(applyUserAction(s, n, { type: "offer", terms }, offlinePlayer)).rejects.toBeInstanceOf(ActionError);
    expect(n.offers).toHaveLength(0);
  });
});
