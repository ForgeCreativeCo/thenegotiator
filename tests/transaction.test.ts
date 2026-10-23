import { describe, expect, it } from "vitest";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Scenario } from "../server/engine/types";
import { createTransaction } from "../server/transaction/schedule";
import { applyTxAction, conditionReady, releaseOptions, type Voice } from "../server/transaction/engine";
import { sellerGiveLimit, sellerGiven, userClientObjections } from "../server/transaction/policy";
import { landTransferTax } from "../server/transaction/landTransferTax";
import { ActionError, userSide } from "../server/negotiation/engine";
import { newNegotiation, type Negotiation } from "../server/negotiation/types";
import { repairTerms } from "../server/negotiation/constraints";
import { defaultBuyerTerms } from "../server/negotiation/terms";
import type { Issue } from "../server/transaction/types";

const draftVoice: Voice = async (_s, _n, _situation, _decision, draft) => draft;
const SEEDS = Array.from({ length: 300 }, (_, i) => i * 6_151 + 3);

function scenario(seed: number): Scenario | null {
  const p = generateParams({ seed, startDate: "2026-10-23" });
  if (p.difficulty.dealSpace === "none") return null;
  return { ...p, id: `s${seed}`, createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
}

/** An accepted agreement at the midpoint of the deal space, with the buyer's usual conditions. */
function accepted(s: Scenario): Negotiation {
  const n = newNegotiation(s.id);
  const mid = Math.round((s.seller.reservationPrice + s.buyer.reservationPrice) / 2);
  const overlap = s.seller.earliestClose > s.buyer.earliestClose ? s.seller.earliestClose : s.buyer.earliestClose;
  let terms = defaultBuyerTerms(s, { price: mid, completionDate: overlap, deposit: Math.ceil((mid * s.seller.minDepositPct) / 100 / 1000) * 1000 });
  terms = repairTerms("buyer", s, terms);
  terms.conditions = terms.conditions.map((c) => ({ ...c, days: c.key === "sale_of_property" ? c.days : Math.min(c.days, s.seller.maxConditionDays) }));
  terms.price = mid;
  n.status = "under_contract";
  n.transaction = createTransaction(s, terms, 0);
  return n;
}

async function tryAction(s: Scenario, n: Negotiation, action: Parameters<typeof applyTxAction>[2]): Promise<boolean> {
  try {
    await applyTxAction(s, n, action, draftVoice);
    return true;
  } catch (e) {
    if (e instanceof ActionError) return false;
    throw e;
  }
}

/** A sensible simulated user for whichever side the scenario assigns. */
async function userMove(s: Scenario, n: Negotiation, issue: Issue): Promise<boolean> {
  const tx = n.transaction!;
  const me = userSide(s);
  const last = issue.proposals[issue.proposals.length - 1];
  const theirs = last && last.by !== me ? last : null;
  const isDate = issue.kind === "extension" || issue.kind === "date_change";
  if (issue.proposals.length === 0 && issue.requester === me) {
    if (issue.kind === "loan") return releaseOptions(tx).some((o) => o.key === "financing") ? tryAction(s, n, { type: "release", key: "financing" }) : false;
    return tryAction(s, n, { type: "propose", issueId: issue.id, amount: issue.reference, closingDate: isDate ? (issue.neededDate ?? undefined) : undefined });
  }
  if (!theirs) return false;
  if (issue.kind === "escape_clause") return tryAction(s, n, { type: "accept", issueId: issue.id });
  if (theirs.kind === "reject") return issue.requester === me ? tryAction(s, n, { type: "withdraw", issueId: issue.id }) : false;
  const ok = userClientObjections(s, tx, issue, me, theirs.amount, theirs.closingDate).length === 0;
  if (ok && (me === "seller" || theirs.amount >= issue.reference * 0.5 || isDate || issue.kind === "condition_extension")) return tryAction(s, n, { type: "accept", issueId: issue.id });
  if (me === "seller" && (isDate || issue.kind === "condition_extension")) return tryAction(s, n, { type: "reject", issueId: issue.id });
  const counter = Math.round((theirs.amount + (me === "seller" ? 0 : issue.reference)) / 2);
  if (await tryAction(s, n, { type: "propose", issueId: issue.id, amount: counter, closingDate: theirs.closingDate ?? undefined })) return true;
  return issue.requester === me ? tryAction(s, n, { type: "withdraw", issueId: issue.id }) : tryAction(s, n, { type: "reject", issueId: issue.id });
}

/** The user's buyer waives or fulfils each condition once its results are in. */
async function handleConditions(s: Scenario, n: Negotiation): Promise<boolean> {
  const tx = n.transaction!;
  if (userSide(s) !== "buyer") return false;
  for (const c of tx.conditions.filter((x) => x.status === "pending")) {
    const ready = conditionReady(tx, c.key);
    if (ready && (await tryAction(s, n, { type: "condition", key: c.key, how: ready === "fulfilled" ? "fulfil" : "waive" }))) return true;
  }
  return false;
}

async function playToEnd(s: Scenario): Promise<Negotiation> {
  const n = accepted(s);
  const tx = n.transaction!;
  for (let step = 0; step < 300 && tx.status === "active"; step++) {
    let acted = false;
    for (const issue of tx.issues.filter((i) => i.status === "open")) {
      if (await userMove(s, n, issue)) {
        acted = true;
        break;
      }
    }
    if (!acted) acted = await handleConditions(s, n);
    if (!acted) await applyTxAction(s, n, { type: "advance", mode: "next" }, draftVoice);
  }
  return n;
}

describe("land transfer tax", () => {
  it("matches Ontario and Toronto brackets and first-time buyer refunds", () => {
    expect(landTransferTax(500_000, false, false)).toEqual({ provincial: 6_475, municipal: 0, firstTimeRebate: 0, total: 6_475 });
    expect(landTransferTax(500_000, true, false).total).toBe(12_950);
    expect(landTransferTax(500_000, true, true).total).toBe(12_950 - 4_000 - 4_475);
    expect(landTransferTax(1_000_000, false, false).provincial).toBe(16_475);
    expect(landTransferTax(2_500_000, false, false).provincial).toBe(36_475 + 12_500);
  });
});

describe("acceptance to completion", () => {
  it("every deal ends completed, void, terminated, or in default, with the deposit handled correctly", async () => {
    const outcomes: Record<string, number> = {};
    for (const seed of SEEDS) {
      const s = scenario(seed);
      if (!s) continue;
      const n = await playToEnd(s);
      const tx = n.transaction!;
      expect(tx.status, `seed ${seed}`).not.toBe("active");
      const o = tx.outcome!;
      outcomes[o.kind] = (outcomes[o.kind] ?? 0) + 1;
      if (o.kind === "completed") {
        expect(tx.firm, `seed ${seed}`).toBe(true);
        expect(tx.conditions.every((c) => c.status === "waived" || c.status === "fulfilled")).toBe(true);
        expect(tx.settlement!.landTransferTax.total).toBeGreaterThanOrEqual(0);
        expect(tx.loanStatus).not.toBe("declined");
        expect(o.deposit).toBe("applied_on_completion");
      }
      if (o.kind === "void" || o.kind === "terminated" || o.kind === "seller_default") expect(o.deposit).toBe("returned_to_buyer");
      if (o.kind === "buyer_default") {
        expect(o.deposit).toBe("forfeited_to_seller");
        expect(o.damagesExposure).not.toBeNull();
      }
      // A backup offer arriving later lowers the limit for new requests, not for amendments already signed.
      if (userSide(s) === "buyer") expect(sellerGiven(tx), `seed ${seed}`).toBeLessThanOrEqual(sellerGiveLimit(s, { ...tx, backupOffer: false }) + 1);
      if (tx.originalTerms.conditions.every((c) => c.key !== "inspection")) expect(tx.reports.some((r) => r.kind === "inspection")).toBe(false);
    }
    expect(outcomes.completed ?? 0).toBeGreaterThan(SEEDS.length * 0.5);
  });

  it("a buyer who does nothing lets the conditions fail: null and void, deposit returned", async () => {
    for (const seed of SEEDS) {
      const s = scenario(seed);
      if (!s || s.userRole !== "buyer_agent") continue;
      const n = accepted(s);
      const tx = n.transaction!;
      if (!tx.conditions.length) continue;
      while (tx.status === "active") await applyTxAction(s, n, { type: "advance", mode: "day" }, draftVoice);
      expect(tx.outcome?.kind).toBe("void");
      expect(tx.outcome?.deposit).toBe("returned_to_buyer");
      return;
    }
    throw new Error("No suitable scenario found");
  });

  it("a firm buyer can't walk away without defaulting", async () => {
    for (const seed of SEEDS) {
      const s = scenario(seed);
      if (!s || s.userRole !== "buyer_agent") continue;
      const n = accepted(s);
      const tx = n.transaction!;
      for (const c of tx.conditions) c.status = "waived";
      tx.firm = true;
      expect(releaseOptions(tx)).toEqual([]);
      expect(await tryAction(s, n, { type: "release", key: "inspection" })).toBe(false);
      expect(tx.status).toBe("active");
      return;
    }
  });

  it("financing can't be fulfilled without a mortgage commitment", async () => {
    for (const seed of SEEDS) {
      const s = scenario(seed);
      if (!s || s.userRole !== "buyer_agent" || s.buyer.financing === "cash") continue;
      const n = accepted(s);
      if (!n.transaction!.conditions.some((c) => c.key === "financing")) continue;
      expect(await tryAction(s, n, { type: "condition", key: "financing", how: "fulfil" })).toBe(false);
      return;
    }
  });
});
