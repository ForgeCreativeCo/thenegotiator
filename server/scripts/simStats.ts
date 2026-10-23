// Ad-hoc: prints negotiation outcome stats for a simulated user. Run with: npx tsx server/scripts/simStats.ts
import { generateParams } from "../engine/params";
import { writeOfflineNarrative } from "../narrative/offline";
import type { Scenario } from "../engine/types";
import { defaultBuyerTerms } from "../negotiation/terms";
import { netFor, setNet, violations } from "../negotiation/constraints";
import { offlineTurn } from "../negotiation/botOffline";
import { applyUserAction, startNegotiation, userSide, type BotPlayer } from "../negotiation/engine";
import { newNegotiation } from "../negotiation/types";

const player: BotPlayer = async (s, rec, ctx, _h, round) => ({ ...offlineTurn(s, rec, ctx.userTerms, round, ctx.clientUpdate), source: "offline", issues: [] });
for (const concession of [0.15, 0.3, 0.6]) {
  const rows: { share: number; rounds: number }[] = [];
  let possible = 0, closed = 0, walked = 0;
  for (let i = 0; i < 400; i++) {
    const p = generateParams({ seed: i * 7 + 1, startDate: "2026-10-23" });
    const s: Scenario = { ...p, id: "x", createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
    if (s.difficulty.dealSpace === "none") continue;
    possible++;
    const n = newNegotiation("x");
    await startNegotiation(s, n, player);
    const mine = userSide(s), dir = mine === "seller" ? 1 : -1;
    const limit = mine === "seller" ? s.seller.reservationPrice : s.buyer.reservationPrice;
    let pos = mine === "buyer" ? Math.min(s.property.listPrice * 0.94, limit) : Math.max(s.property.listPrice, limit);
    for (let k = 0; k < 20 && n.status === "negotiating"; k++) {
      const theirs = [...n.offers].reverse().find((o) => o.by !== mine && o.status === "open");
      if (theirs && !violations(mine, s, theirs.terms).length && dir * (netFor(mine, theirs.terms) - pos) >= 0) { await applyUserAction(s, n, { type: "accept" }, player); break; }
      await applyUserAction(s, n, { type: "offer", terms: setNet(mine, s, theirs?.terms ?? defaultBuyerTerms(s), Math.round(pos)) }, player);
      pos += (limit - pos) * concession;
    }
    if (n.status === "dead") walked++;
    if (n.status !== "under_contract") continue;
    closed++;
    const t = n.offers.find((o) => o.id === n.acceptedOfferId)!.terms;
    const sellerShare = (t.price - t.sellerCredit - s.seller.reservationPrice) / Math.max(1, s.buyer.reservationPrice - s.seller.reservationPrice);
    rows.push({ share: mine === "seller" ? sellerShare : 1 - sellerShare, rounds: n.botTurns.length });
  }
  rows.sort((a, b) => a.share - b.share);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`user concession ${concession}: closed ${closed}/${possible}, walked ${walked}, user's share of deal space median ${rows[rows.length >> 1].share.toFixed(2)}, avg bot rounds ${avg(rows.map((r) => r.rounds)).toFixed(1)}`);
}
