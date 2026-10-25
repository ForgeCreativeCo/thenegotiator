// Plays hundreds of randomized deals on both sides offline and checks the invariants: no crashes, the other agent
// always answers an offer or sign-back, never two accepted agreements, no open competing offers after acceptance.
// Run: npx tsx server/scripts/fuzzDeals.ts

import { generateParams } from "../engine/params";
import { writeOfflineNarrative } from "../narrative/offline";
import type { Role, Scenario } from "../engine/types";
import { Rng } from "../engine/rng";
import { offlineTurn } from "../negotiation/botOffline";
import { ActionError, applyUserAction, startNegotiation, type BotPlayer, type UserAction } from "../negotiation/engine";
import { newNegotiation, type Negotiation } from "../negotiation/types";
import { newClientState } from "../client/types";
import { allCompetitors } from "../negotiation/listing";
import { setNet } from "../negotiation/constraints";
import { defaultBuyerTerms, type Terms } from "../negotiation/terms";
import { clientFacts, meetsRequirement } from "../client/facts";

delete process.env.ANTHROPIC_API_KEY;
const player: BotPlayer = async (s, rec, ctx, _h, round) => ({ ...offlineTurn(s, rec, ctx.userTerms, round, ctx.clientUpdate, { userText: ctx.userText, used: ctx.usedLines, competing: ctx.competingOffers }), source: "offline", issues: [] });

const problems: string[] = [];
const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

/** Terms the user's client would sign: within the brief and meeting hidden requirements. */
function goodTerms(s: Scenario, base: Terms, net: number): Terms {
  const me = s.userRole === "buyer_agent" ? "buyer" : "seller";
  const b = me === "buyer" ? s.buyer : s.seller;
  let t: Terms = { ...setNet(me, s, base, Math.round(net)), completionDate: b.idealClose };
  if (me === "seller") t.deposit = Math.max(t.deposit, Math.ceil((t.price * s.seller.minDepositPct) / 100 / 1000) * 1000);
  for (const f of clientFacts(s)) {
    if (f.effect.kind !== "require") continue;
    const r = f.effect.requirement;
    if (meetsRequirement(r, t)) continue;
    if (r.kind === "chattel") t = { ...t, chattels: `${t.chattels}, ${r.item}` };
    if (r.kind === "exclude_fixture") t = { ...t, fixturesExcluded: r.item };
    if (r.kind === "deposit_timing") t = { ...t, depositTiming: r.timing };
    if (r.kind === "min_deposit_pct") t = { ...t, deposit: Math.ceil((t.price * r.pct) / 100 / 1000) * 1000 };
    if (r.kind === "condition_min_days") t = { ...t, conditions: t.conditions.map((c) => (c.key === r.key ? { ...c, days: Math.max(c.days, r.days) } : c)) };
  }
  return t;
}

async function step(s: Scenario, n: Negotiation, a: UserAction, signed: boolean): Promise<boolean> {
  try {
    if (signed) {
      await applyUserAction(s, n, { type: "client_review", pending: a }, player);
      if (n.client!.messages.at(-1)!.verdict === "refused") {
        bump(`client-refused:${a.type}`);
        return false;
      }
    }
    const before = n.messages.length;
    const normal = n.status === "negotiating" && !(n.offerNight && n.offerNight.phase !== "done");
    await applyUserAction(s, n, a, player);
    bump(`ok:${a.type}`);
    // An offer or sign-back to the buyer the agents are negotiating with always gets an answer from the other agent.
    if (a.type === "offer" && normal && n.status === "negotiating" && !(n.offerNight && n.offerNight.phase !== "done") && !n.messages.slice(before).some((m) => m.speaker === "bot")) problems.push(`${s.id}: no reply to ${a.type}`);
    return true;
  } catch (e) {
    if (e instanceof ActionError) {
      bump(`refused:${a.type}: ${e.message.slice(0, 70)}`);
      return false;
    }
    problems.push(`${s.id}: ${a.type} threw ${(e as Error).stack?.split("\n").slice(0, 3).join(" | ")}`);
    return false;
  }
}

function invariants(s: Scenario, n: Negotiation, where: string) {
  const competitorsSeen = new Set([...allCompetitors(n), ...(n.offerNight?.competitors ?? [])]);
  const accepted = n.offers.filter((o) => o.status === "accepted").length + [...competitorsSeen].filter((c) => c.status === "accepted").length;
  if (accepted > 1) problems.push(`${s.id} ${where}: ${accepted} accepted agreements`);
  if (n.status === "under_contract" && [...competitorsSeen].some((c) => c.status === "registered" && c.registeredAt <= n.simHours)) problems.push(`${s.id} ${where}: a competing offer is still open after acceptance`);
  if (n.listing?.signBackOut && n.status !== "negotiating") problems.push(`${s.id} ${where}: sign-back out after the deal ended`);
}

for (let seed = 1; seed <= 600; seed += 3) {
  for (const role of ["buyer_agent", "seller_agent"] as Role[]) {
    const p = generateParams({ seed, startDate: "2026-10-26", role });
    if (p.difficulty.dealSpace === "none") continue;
    const s: Scenario = { ...p, id: `s${seed}-${role}`, createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
    const n: Negotiation = { ...newNegotiation(s.id), client: newClientState(true) };
    const rng = new Rng(seed * 31 + (role === "buyer_agent" ? 1 : 2));
    try {
      await startNegotiation(s, n, player);
    } catch (e) {
      problems.push(`${s.id}: start threw ${(e as Error).message}`);
      continue;
    }
    bump(n.offerNight ? "start:offer-night" : "start:normal");
    const me = role === "buyer_agent" ? "buyer" : "seller";
    const limit = me === "buyer" ? s.buyer.reservationPrice : s.seller.reservationPrice;
    for (let i = 0; i < 25 && n.status === "negotiating"; i++) {
      const night = n.offerNight && n.offerNight.phase !== "done" ? n.offerNight : null;
      const theirs = [...n.offers].reverse().find((o) => o.by !== me && (o.status === "open" || o.status === "registered"));
      const roll = rng.next();
      const live = (n.listing?.competitors ?? []).filter((c) => c.status === "registered" && c.registeredAt <= n.simHours);
      if (night) {
        if (me === "seller") {
          if (night.phase === "registration") await step(s, n, roll < 0.3 ? { type: "client_direction" } : { type: "review" }, false);
          else if (theirs && roll < 0.5) await step(s, n, { type: "offer", terms: goodTerms(s, theirs.terms, Math.max(limit, theirs.terms.price + 10_000)) }, true);
          else if (night.phase === "review" && roll < 0.8) await step(s, n, { type: "improve" }, false);
          else if (theirs) await step(s, n, { type: "accept" }, true);
          else await step(s, n, { type: "walk" }, false);
        } else if ((night.phase === "registration" || night.phase === "improvement") && roll < 0.6) {
          await step(s, n, { type: "offer", terms: goodTerms(s, defaultBuyerTerms(s, { depositTiming: "herewith" }), limit * (0.95 + rng.next() * 0.05)) }, true);
        } else await step(s, n, { type: "review" }, false);
      } else if (me === "seller") {
        if (live.length && roll < 0.25) {
          const c = live[0];
          await step(s, n, { type: "client_present", competitorId: c.id }, false);
          const r2 = rng.next();
          if (r2 < 0.3) await step(s, n, { type: "accept_competitor", competitorId: c.id }, true);
          else if (r2 < 0.6) await step(s, n, { type: "signback_competitor", competitorId: c.id, terms: goodTerms(s, c.terms, Math.max(limit, c.terms.price + 5_000)) }, true);
          else await step(s, n, { type: "decline_competitor", competitorId: c.id }, false);
        } else if (roll < 0.35 && theirs) await step(s, n, { type: "offer", terms: goodTerms(s, theirs.terms, Math.max(limit, theirs.terms.price + 15_000)) }, true);
        else if (roll < 0.5) await step(s, n, { type: "wait" }, false);
        else if (roll < 0.6) await step(s, n, { type: "client_hold", hold: rng.chance(0.5) }, false);
        else if (roll < 0.65) await step(s, n, { type: "tell_count" }, false);
        else if (roll < 0.8 && theirs) await step(s, n, { type: "accept" }, true);
        else await step(s, n, { type: "message", text: rng.pick(["Any flexibility?", "Why are they moving?", "Thanks."]) }, false);
      } else if (roll < 0.5) {
        await step(s, n, { type: "offer", terms: goodTerms(s, theirs?.terms ?? defaultBuyerTerms(s), limit * (0.9 + rng.next() * 0.1)) }, true);
      } else if (roll < 0.7 && theirs) await step(s, n, { type: "accept" }, true);
      else await step(s, n, { type: "message", text: rng.pick(["Any other offers?", "When do they want to close?", "Hi"]) }, false);
      invariants(s, n, `step ${i}`);
    }
    bump(`end:${n.status}${n.listing?.mode === "held" ? ":held" : ""}`);
  }
}
console.log(JSON.stringify(counts));
console.log(problems.length ? `PROBLEMS (${problems.length}):\n${[...new Set(problems)].slice(0, 25).join("\n")}` : "No problems");
