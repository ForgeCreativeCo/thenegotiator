import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { generateParams } from "../server/engine/params";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { Role, Scenario } from "../server/engine/types";
import { createTransaction } from "../server/transaction/schedule";
import { addDays } from "../server/engine/properties";
import { applyTxAction, type TxAction, type Voice } from "../server/transaction/engine";
import { ActionError } from "../server/negotiation/engine";
import { newNegotiation, type Negotiation } from "../server/negotiation/types";
import { repairTerms } from "../server/negotiation/constraints";
import { defaultBuyerTerms } from "../server/negotiation/terms";
import { newClientState } from "../server/client/types";
import { reviewCompliance } from "../server/coach/compliance";
import type { Issue } from "../server/transaction/types";

const draftVoice: Voice = async (_s, _n, _situation, _decision, draft) => draft;

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

function scenario(role: Role, from: number, filter: (s: Scenario) => boolean = () => true): Scenario {
  for (let seed = from; seed < from + 5_000; seed++) {
    const p = generateParams({ seed, startDate: "2026-10-23", role });
    const s: Scenario = { ...p, id: `s${seed}`, createdAt: "", narrative: writeOfflineNarrative(p), narrativeSource: "offline" };
    if (p.difficulty.dealSpace !== "none" && !p.offerNight && filter(s)) return s;
  }
  throw new Error("No matching scenario");
}

/** An accepted agreement with the client conversation on. */
function accepted(s: Scenario): Negotiation {
  const n: Negotiation = { ...newNegotiation(s.id), client: newClientState(true) };
  const mid = Math.round((s.seller.reservationPrice + s.buyer.reservationPrice) / 2);
  const overlap = s.seller.earliestClose > s.buyer.earliestClose ? s.seller.earliestClose : s.buyer.earliestClose;
  let terms = defaultBuyerTerms(s, { price: mid, completionDate: overlap, deposit: Math.ceil((mid * s.seller.minDepositPct) / 100 / 1000) * 1000 });
  terms = repairTerms("buyer", s, terms);
  terms.conditions = terms.conditions.filter((c) => c.key !== "sale_of_property").map((c) => ({ ...c, days: Math.min(c.days, s.seller.maxConditionDays) }));
  terms.price = mid;
  n.status = "under_contract";
  n.transaction = createTransaction(s, terms, 0);
  return n;
}

const act = (s: Scenario, n: Negotiation, a: TxAction) => applyTxAction(s, n, a, draftVoice);

async function refused(s: Scenario, n: Negotiation, a: TxAction): Promise<string> {
  try {
    await act(s, n, a);
  } catch (e) {
    if (e instanceof ActionError) return e.message;
    throw e;
  }
  throw new Error(`Expected ${a.type} to be refused`);
}

const lastClient = (n: Negotiation) => n.client!.messages.filter((m) => m.speaker === "client").at(-1)!;
const withEvents = (kinds: string[]) => (s: Scenario) => kinds.every((k) => (s.ownClientEvents ?? []).some((e) => e.kind === k));
const without = (kinds: string[]) => (s: Scenario) => !(s.ownClientEvents ?? []).some((e) => kinds.includes(e.kind));

describe("your own client's surprises", () => {
  it("come with the hidden client volatility: none, one, or two", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const p = generateParams({ seed, startDate: "2026-10-23" });
      expect(p.ownClientEvents).toHaveLength({ steady: 0, nervous: 1, erratic: 2 }[p.difficulty.clientVolatility]);
    }
  });
});

describe("client signatures after acceptance", () => {
  it("needs the buyers' signature on a waiver, and signs reluctantly before the mortgage commitment", async () => {
    const s = scenario("buyer_agent", 10, without(["cold_feet", "partner"]));
    const n = accepted(s);
    const tx = n.transaction!;
    expect(tx.conditions.some((c) => c.key === "financing")).toBe(true);
    const waive: TxAction = { type: "condition", key: "financing", how: "waive" };
    expect(await refused(s, n, waive)).toMatch(/haven't signed/);
    await act(s, n, { type: "client_review", pending: waive });
    expect(lastClient(n).verdict).toBe("reluctant");
    await act(s, n, waive);
    expect(tx.conditions.find((c) => c.key === "financing")!.status).toBe("waived");
    expect(n.client!.signature).toBeNull();
  });

  it("won't sign a mutual release with no reason to end the deal", async () => {
    const s = scenario("buyer_agent", 40, without(["cold_feet", "partner", "remorse"]));
    const n = accepted(s);
    const key = n.transaction!.conditions[0].key;
    await act(s, n, { type: "client_review", pending: { type: "release", key } });
    expect(lastClient(n).verdict).toBe("refused");
    expect(lastClient(n).text).toMatch(/still want/);
    expect(await refused(s, n, { type: "release", key })).toMatch(/haven't signed/);
  });

  it("gets cold feet before going firm, until you talk it through", async () => {
    const s = scenario("buyer_agent", 70, (x) => withEvents(["cold_feet"])(x) && without(["partner"])(x));
    const n = accepted(s);
    const tx = n.transaction!;
    const [last, ...rest] = [...tx.conditions].reverse();
    for (const c of rest) {
      const a: TxAction = { type: "condition", key: c.key, how: "waive" };
      await act(s, n, { type: "client_review", pending: a });
      expect(lastClient(n).verdict).not.toBe("refused");
      await act(s, n, a);
    }
    const goFirm: TxAction = { type: "condition", key: last.key, how: "waive" };
    await act(s, n, { type: "client_review", pending: goFirm });
    expect(lastClient(n).verdict).toBe("refused");
    expect(lastClient(n).text).toMatch(/scared/);
    await act(s, n, { type: "client_message", text: "That's normal. You've done your homework, and the inspection and financing are sorted. It's a good house." });
    expect(n.client!.events!.find((e) => e.id === "cold-feet")!.status).toBe("settled");
    await act(s, n, { type: "client_review", pending: goFirm });
    expect(lastClient(n).verdict).not.toBe("refused");
    await act(s, n, goFirm);
    expect(tx.firm).toBe(true);
  });

  it("asks to get out after going firm, and flags an agent who tells them to walk", async () => {
    const s = scenario("buyer_agent", 100, (x) => withEvents(["remorse"])(x) && without(["cold_feet", "partner"])(x));
    const n = accepted(s);
    const tx = n.transaction!;
    for (const c of [...tx.conditions]) {
      const a: TxAction = { type: "condition", key: c.key, how: "waive" };
      await act(s, n, { type: "client_review", pending: a });
      await act(s, n, a);
    }
    expect(tx.firm).toBe(true);
    await act(s, n, { type: "advance", mode: "day" });
    expect(n.client!.events!.some((e) => e.id === "remorse" && e.status === "active")).toBe(true);
    expect(n.messages.some((m) => m.event === "client_update")).toBe(true);
    await act(s, n, { type: "client_message", text: "If you're unhappy, you can just walk away from it." });
    expect(reviewCompliance(s, n).some((f) => f.rule === "client_duty" && /walk away from a firm deal/.test(f.title))).toBe(true);
  });

  it("presents the other side's requests, and flags answering one you didn't present", async () => {
    const s = scenario("seller_agent", 130, without(["partner"]));
    const make = () => {
      const n = accepted(s);
      const tx = n.transaction!;
      const date = addDays(tx.terms.completionDate, 3);
      const issue: Issue = {
        id: randomUUID(), kind: "date_change", title: "Completion date", detail: "The buyers ask to move completion.", requester: "buyer", responder: "seller", openedDay: 0, deadlineDay: null, status: "open",
        proposals: [{ id: randomUUID(), by: "buyer", day: 0, kind: "request", amount: 0, closingDate: date, form: null, note: "" }], reference: 0, neededDate: date, findingIds: [], conditionKey: null, rightUntilDay: null,
      };
      tx.issues.push(issue);
      return { n, issue };
    };

    const a = make();
    await act(s, a.n, { type: "client_present", issueId: a.issue.id });
    expect(a.n.client!.presented).toContain(`issue:${a.issue.id}:${a.issue.proposals[0].id}`);
    await act(s, a.n, { type: "reject", issueId: a.issue.id });
    expect(reviewCompliance(s, a.n).some((f) => f.rule === "client_duty" && /after acceptance/.test(f.title))).toBe(false);

    const b = make();
    await act(s, b.n, { type: "reject", issueId: b.issue.id });
    expect(reviewCompliance(s, b.n).some((f) => f.rule === "client_duty" && /after acceptance/.test(f.title))).toBe(true);
  });

  it("has a partner who isn't on board with the first amendment", async () => {
    const s = scenario("buyer_agent", 160, withEvents(["partner"]));
    const n = accepted(s);
    const c = n.transaction!.conditions[0];
    const extend: TxAction = { type: "request_condition_extension", key: c.key, days: 2 };
    await act(s, n, { type: "client_review", pending: extend });
    expect(lastClient(n).verdict).toBe("refused");
    expect(lastClient(n).text).toMatch(/partner/);
    await act(s, n, { type: "client_message", text: "It's two more days to get the report back properly. Nothing else changes." });
    await act(s, n, { type: "client_review", pending: extend });
    expect(lastClient(n).verdict).toBe("signed");
    await act(s, n, extend);
    expect(n.transaction!.issues.some((i) => i.kind === "condition_extension")).toBe(true);
  });
});
