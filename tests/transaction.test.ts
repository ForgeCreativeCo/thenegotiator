import { describe, expect, it } from "vitest";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Scenario } from "../server/engine/types";
import { createTransaction } from "../server/transaction/schedule";
import { applyTxAction, terminationRights, type Voice } from "../server/transaction/engine";
import { sellerGiveLimit, sellerGiven, userClientObjections } from "../server/transaction/policy";
import { userSide } from "../server/negotiation/engine";
import { newNegotiation, type Negotiation } from "../server/negotiation/types";
import { setNet } from "../server/negotiation/constraints";
import { defaultBuyerTerms } from "../server/negotiation/terms";
import type { Issue } from "../server/transaction/types";
import { ActionError } from "../server/negotiation/engine";

const draftVoice: Voice = async (_s, _n, _situation, _decision, draft) => draft;
const SEEDS = Array.from({ length: 300 }, (_, i) => i * 6_151 + 3);

function scenario(seed: number): Scenario | null {
  const p = generateParams({ seed, startDate: "2026-10-23" });
  if (p.difficulty.dealSpace === "none") return null;
  return { ...p, id: `s${seed}`, createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
}

/** A contract at the midpoint of the deal space, starting today. */
function underContract(s: Scenario): Negotiation {
  const n = newNegotiation(s.id);
  const mid = Math.round((s.seller.reservationPrice + s.buyer.reservationPrice) / 2);
  const overlap = s.seller.earliestClose > s.buyer.earliestClose ? s.seller.earliestClose : s.buyer.earliestClose;
  let terms = defaultBuyerTerms(s, { closingDate: overlap, rentBackDays: s.seller.needsRentBackDays, earnestMoney: Math.round(mid * 0.01) });
  terms = setNet("buyer", s, terms, mid);
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
  if (issue.proposals.length === 0 && issue.requester === me) {
    if (issue.kind === "loan") return terminationRights(tx).length ? tryAction(s, n, { type: "terminate" }) : false;
    const isDate = issue.kind === "extension" || issue.kind === "date_change";
    return tryAction(s, n, { type: "propose", issueId: issue.id, amount: issue.reference, closingDate: isDate ? (issue.neededDate ?? undefined) : undefined });
  }
  if (!theirs) return false;
  if (issue.kind === "kickout") return (await tryAction(s, n, { type: "accept", issueId: issue.id })) || tryAction(s, n, { type: "terminate" });
  if (theirs.kind === "reject") return issue.requester === me ? tryAction(s, n, { type: "withdraw", issueId: issue.id }) : false;
  const ok = userClientObjections(s, tx, issue, me, theirs.amount, theirs.closingDate).length === 0;
  if (ok && (me === "seller" || theirs.amount >= issue.reference * 0.5 || issue.kind === "extension" || issue.kind === "date_change")) return tryAction(s, n, { type: "accept", issueId: issue.id });
  if (me === "seller" && (issue.kind === "extension" || issue.kind === "date_change" || issue.kind === "possession")) return tryAction(s, n, { type: "reject", issueId: issue.id });
  const counter = Math.round((theirs.amount + (me === "seller" ? 0 : issue.reference)) / 2);
  if (await tryAction(s, n, { type: "propose", issueId: issue.id, amount: counter, closingDate: theirs.closingDate ?? undefined })) return true;
  return issue.requester === me ? tryAction(s, n, { type: "withdraw", issueId: issue.id }) : tryAction(s, n, { type: "reject", issueId: issue.id });
}

async function playToEnd(s: Scenario): Promise<Negotiation> {
  const n = underContract(s);
  const tx = n.transaction!;
  for (let step = 0; step < 200 && tx.status === "active"; step++) {
    let acted = false;
    for (const issue of tx.issues.filter((i) => i.status === "open")) {
      if (await userMove(s, n, issue)) {
        acted = true;
        break;
      }
    }
    if (!acted) await applyTxAction(s, n, { type: "advance", mode: "next" }, draftVoice);
  }
  return n;
}

describe("contract to closing", () => {
  it("every deal ends closed or terminated, with consistent outcomes", async () => {
    const outcomes: Record<string, number> = {};
    for (const seed of SEEDS) {
      const s = scenario(seed);
      if (!s) continue;
      const n = await playToEnd(s);
      const tx = n.transaction!;
      expect(tx.status, `seed ${seed}`).not.toBe("active");
      outcomes[tx.outcome!.kind] = (outcomes[tx.outcome!.kind] ?? 0) + 1;

      if (tx.status === "closed") {
        expect(tx.settlement).not.toBeNull();
        expect(tx.loanStatus).not.toBe("denied");
        expect(tx.outcome!.earnestMoney).toBe("applied_at_closing");
      }
      if (tx.outcome!.kind === "terminated") expect(tx.outcome!.earnestMoney).toBe("returned_to_buyer");
      if (tx.outcome!.kind === "buyer_default") expect(tx.outcome!.earnestMoney).toBe("released_to_seller");
      // The opposing seller never gives more than their limit.
      if (userSide(s) === "buyer") expect(sellerGiven(tx), `seed ${seed}`).toBeLessThanOrEqual(sellerGiveLimit(s, tx) + 1);
      // A waived inspection means no inspection report.
      if (tx.originalTerms.inspectionDays === null) expect(tx.reports.some((r) => r.kind === "inspection")).toBe(false);
      // Hidden schedule never shows up in reports before it fires.
      expect(tx.reports.every((r) => r.day <= tx.day)).toBe(true);
    }
    expect(outcomes.closed ?? 0).toBeGreaterThan(SEEDS.length * 0.5);
  });

  it("an unanswered repair request lapses at the inspection deadline and the buyer takes the house as-is", async () => {
    for (const seed of SEEDS) {
      const s = scenario(seed);
      if (!s || s.userRole !== "buyer_agent" || s.groundTruth.inspectionFindings.length === 0 || s.buyer.loanType === "cash") continue;
      const n = underContract(s);
      const tx = n.transaction!;
      if (tx.inspectionDeadlineDay === null) continue;
      while (tx.day <= tx.inspectionDeadlineDay && tx.status === "active") await applyTxAction(s, n, { type: "advance", mode: "day" }, draftVoice);
      const repairs = tx.issues.find((i) => i.kind === "repairs");
      expect(repairs?.status).toBe("lapsed");
      expect(tx.contingencies.inspection).toBe("expired");
      expect(terminationRights(tx).some((r) => r.key === "inspection")).toBe(false);
      return;
    }
    throw new Error("No suitable scenario found");
  });

  it("the user's buyer can't walk away without a contingency", async () => {
    for (const seed of SEEDS) {
      const s = scenario(seed);
      if (!s || s.userRole !== "buyer_agent") continue;
      const n = underContract(s);
      const tx = n.transaction!;
      tx.contingencies.inspection = "expired";
      expect(await tryAction(s, n, { type: "terminate" })).toBe(false);
      expect(tx.status).toBe("active");
      return;
    }
  });
});
