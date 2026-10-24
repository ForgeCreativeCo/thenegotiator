// Untold facts about the user's own client, and how they change what the client will sign.
// Generated with the scenario from its own random stream, so existing scenarios keep their numbers.

import type { BuyerBrief, ScenarioParams, SellerBrief, Scenario } from "../engine/types";
import { Rng } from "../engine/rng";
import { addDays, isCondo } from "../engine/properties";
import { CONDITION_LABELS, displayDate, money } from "../narrative/format";
import { conditionDays, type Terms } from "../negotiation/terms";
import type { ClientFact, Requirement } from "./types";

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

const CHATTELS_HOUSE = [
  { item: "hot tub", match: "hot tub" },
  { item: "garden shed", match: "shed" },
  { item: "chest freezer in the basement", match: "freezer" },
  { item: "backyard play structure", match: "play structure" },
];
const CHATTELS_ANY = [{ item: "wall-mounted TV in the living room", match: "tv" }];
const FIXTURES = [
  { item: "dining room chandelier", match: "chandelier", why: "It was my grandmother's." },
  { item: "workbench in the garage", match: "workbench", why: "My father built it." },
  { item: "custom drapery rods in the living room", match: "drapery", why: "We had them made for our next place." },
];

export function generateClientFacts(p: ScenarioParams): ClientFact[] {
  const rng = new Rng(p.seed ^ 0xc11e47);
  return p.userRole === "buyer_agent" ? buyerFacts(rng, p, p.buyer) : sellerFacts(rng, p, p.seller);
}

function buyerFacts(rng: Rng, p: ScenarioParams, b: BuyerBrief): ClientFact[] {
  const facts: ClientFact[] = [];
  const house = !isCondo(p.property.type) && p.property.type !== "vacant_land";
  const gap = b.preapprovalAmount === null ? b.reservationPrice * 0.04 : b.preapprovalAmount - b.reservationPrice;

  const timingRoom = roundTo(Math.min(gap * 0.6, b.reservationPrice * rng.range(0.015, 0.03)), 1_000);
  if (timingRoom >= 3_000) {
    const by = [b.earliestClose, addDays(b.idealClose, -rng.int(7, 14))].sort().at(-1)!;
    facts.push({
      id: "room-timing",
      side: "buyer",
      topics: ["price", "timing"],
      summary: `They'd pay up to ${money(timingRoom)} more for completion on or before ${displayDate(by)}${b.leaseEndsOn ? ", since it saves them carrying rent and a mortgage" : ""}.`,
      says: `Honestly, if we could close on or before ${displayDate(by)}, we'd find another ${money(timingRoom)}. ${b.leaseEndsOn ? "Paying rent and a mortgage at the same time would cost us more than that." : "Dragging this out costs us more than that."}`,
      effect: { kind: "room", amount: timingRoom, completionBy: by },
    });
  }
  const bidRoom = roundTo(Math.min(gap - timingRoom, b.reservationPrice * rng.range(0.015, 0.03)), 1_000);
  if (p.offerNight && bidRoom >= 3_000) {
    facts.push({
      id: "room-competition",
      side: "buyer",
      topics: ["price", "competition"],
      summary: `In a bidding war they'd go ${money(bidRoom)} over their stated limit.`,
      says: `If it really is a bidding war, we talked about it last night. We could go ${money(bidRoom)} over what we told you. Not a dollar more.`,
      effect: { kind: "room_competition", amount: bidRoom },
    });
  }

  const requirements: ClientFact[] = [];
  if (p.property.type !== "vacant_land") {
    const chattel = rng.pick(house ? [...CHATTELS_HOUSE, ...CHATTELS_ANY] : CHATTELS_ANY);
    requirements.push({
      id: "require-chattel",
      side: "buyer",
      topics: ["chattels"],
      summary: `They won't buy unless the ${chattel.item} is included.`,
      says: `One thing we didn't mention: we really need the ${chattel.item} included. We priced out buying one and it's not in the budget.`,
      effect: { kind: "require", requirement: { kind: "chattel", item: chattel.item, match: chattel.match }, refusal: `They won't sign unless the ${chattel.item} is included in the chattels` },
    });
  }
  const inspectionDays = Math.min(7, p.seller.maxConditionDays);
  if (p.property.type !== "new_construction" && !b.willingToWaive.includes("inspection") && inspectionDays > 5) {
    requirements.push({
      id: "require-inspection-days",
      side: "buyer",
      topics: ["inspection", "conditions", "timing"],
      summary: `They need at least ${inspectionDays} banking days for the inspection, because the inspector they trust is booked up.`,
      says: `The inspector we trust is booked solid this week. We need at least ${inspectionDays} banking days on the inspection.`,
      effect: { kind: "require", requirement: { kind: "condition_min_days", key: "inspection", days: inspectionDays }, refusal: `They need at least ${inspectionDays} banking days on the inspection condition` },
    });
  }
  requirements.push({
    id: "require-deposit-timing",
    side: "buyer",
    topics: ["deposit"],
    summary: "Their deposit money is in a GIC that matures next week, so they can't give a deposit with the offer.",
    says: "Our deposit is sitting in a GIC that matures next week. We can't hand over a cheque with the offer. It has to be upon acceptance.",
    effect: { kind: "require", requirement: { kind: "deposit_timing", timing: "upon_acceptance" }, refusal: "They can't give the deposit with the offer; it has to be upon acceptance" },
  });
  facts.push(...rng.sample(requirements, rng.int(1, 2)));

  const context: ClientFact[] = [
    {
      id: "context-inspection",
      side: "buyer",
      topics: ["inspection", "motivation"],
      summary: "They lost money on a roof in their last home and are nervous about anything that needs work.",
      says: "We got burned on a roof in our last place. Anything that needs major work makes us really nervous.",
      effect: { kind: "context" },
    },
    {
      id: "context-parents",
      side: "buyer",
      topics: ["financing", "motivation"],
      summary: "Their parents are helping with the down payment and want to see the house before it goes firm.",
      says: "My parents are helping with the down payment, and they'll want to walk through it before anything goes firm.",
      effect: { kind: "context" },
    },
  ];
  if (facts.length < 4 && (facts.length < 2 || rng.chance(0.5))) facts.push(rng.pick(context));
  return facts.slice(0, 4);
}

function sellerFacts(rng: Rng, p: ScenarioParams, s: SellerBrief): ClientFact[] {
  const facts: ClientFact[] = [];
  const room = roundTo(s.reservationPrice * rng.range(0.01, 0.025), 1_000);
  const from = addDays(s.latestClose, -rng.int(5, 20));
  if (!s.boughtElsewhere && room >= 3_000 && s.reservationPrice - room > s.mortgagePayoff * 1.02 && from > s.idealClose) {
    facts.push({
      id: "room-timing",
      side: "seller",
      topics: ["price", "timing"],
      summary: `They'd take ${money(room)} less for completion on or after ${displayDate(from)}, to give them time to find their next place.`,
      says: `If the buyers could give us until ${displayDate(from)} to close, we'd take ${money(room)} less. It would save us renting in between.`,
      effect: { kind: "room", amount: room, completionFrom: from },
    });
  }

  const requirements: ClientFact[] = [];
  if (p.property.type !== "vacant_land") {
    const fixture = rng.pick(FIXTURES);
    requirements.push({
      id: "require-fixture",
      side: "seller",
      topics: ["fixtures", "chattels"],
      summary: `They're taking the ${fixture.item} with them, so it has to be excluded.`,
      says: `Before anything goes out: the ${fixture.item} isn't staying. ${fixture.why}`,
      effect: { kind: "require", requirement: { kind: "exclude_fixture", item: fixture.item, match: fixture.match }, refusal: `They won't sign unless the ${fixture.item} is excluded from the fixtures` },
    });
  }
  const pct = Math.min(10, s.minDepositPct + 2);
  const buyerCash = (p.property.listPrice * (p.buyer.financing === "cash" ? 100 : p.buyer.downPaymentPct)) / 100 + p.buyer.cashReserves;
  if (pct > s.minDepositPct && buyerCash >= (p.property.listPrice * pct) / 100) {
    requirements.push({
      id: "require-deposit",
      side: "seller",
      topics: ["deposit"],
      summary: `After a buyer walked on them once, they want a deposit of at least ${pct}%.`,
      says: `We had a buyer walk away on us once. This time we want a real deposit: at least ${pct}%.`,
      effect: { kind: "require", requirement: { kind: "min_deposit_pct", pct }, refusal: `They want a deposit of at least ${pct}%` },
    });
  }
  requirements.push({
    id: "require-deposit-herewith",
    side: "seller",
    topics: ["deposit"],
    summary: "They want the deposit delivered with the offer, not upon acceptance.",
    says: "We want the deposit with the offer, not a promise to pay it later.",
    effect: { kind: "require", requirement: { kind: "deposit_timing", timing: "herewith" }, refusal: "They want the deposit with the offer (herewith), not upon acceptance" },
  });
  facts.push(...rng.sample(requirements, rng.int(1, 2)));

  const context: ClientFact[] = [
    {
      id: "context-financing",
      side: "seller",
      topics: ["financing", "conditions", "motivation"],
      summary: "A neighbour's sale collapsed when the buyer's financing fell through, so they're wary of financing conditions.",
      says: "Our neighbours' sale fell apart last spring when the buyer's mortgage didn't come through. I don't want to go through that.",
      effect: { kind: "context" },
    },
    {
      id: "context-memories",
      side: "seller",
      topics: ["motivation"],
      summary: "They raised their kids in the house and want buyers who'll look after it.",
      says: "We raised our kids here. It sounds silly, but I'd like it to go to people who'll look after it.",
      effect: { kind: "context" },
    },
  ];
  if (facts.length < 4 && (facts.length < 2 || rng.chance(0.5))) facts.push(rng.pick(context));
  return facts.slice(0, 4);
}

export function clientFacts(s: Pick<Scenario, "clientFacts">): ClientFact[] {
  return s.clientFacts ?? [];
}

export function meetsRequirement(r: Requirement, t: Terms, price = t.price): boolean {
  switch (r.kind) {
    case "chattel":
      return new RegExp(`\\b${r.match}\\b`, "i").test(t.chattels);
    case "exclude_fixture":
      return new RegExp(`\\b${r.match}`, "i").test(t.fixturesExcluded);
    case "condition_min_days": {
      const days = conditionDays(t, r.key);
      return days === null || days >= r.days;
    }
    case "deposit_timing":
      return t.depositTiming === r.timing;
    case "min_deposit_pct":
      return t.deposit >= (price * r.pct) / 100;
  }
}

/** Hidden requirements the terms break. These hold whether or not the agent knows about them. */
export function requirementProblems(s: Pick<Scenario, "clientFacts">, t: Terms): { fact: ClientFact; message: string }[] {
  return clientFacts(s).flatMap((fact) => (fact.effect.kind === "require" && !meetsRequirement(fact.effect.requirement, t) ? [{ fact, message: fact.effect.refusal }] : []));
}

/** Extra room from uncovered facts that applies to these terms. */
export function extraRoom(s: Pick<Scenario, "clientFacts">, uncovered: string[], t: Terms): number {
  let total = 0;
  for (const fact of clientFacts(s)) {
    if (!uncovered.includes(fact.id)) continue;
    const e = fact.effect;
    if (e.kind === "room_competition") total += e.amount;
    if (e.kind === "room" && (!e.completionBy || t.completionDate <= e.completionBy) && (!e.completionFrom || t.completionDate >= e.completionFrom)) total += e.amount;
  }
  return total;
}

/** The scenario as the user's client would sign it: their brief, plus any room they've given their agent. */
export function withClientAuthority(s: Scenario, uncovered: string[], t: Terms): Scenario {
  const room = extraRoom(s, uncovered, t);
  if (!room) return s;
  return s.userRole === "buyer_agent" ? { ...s, buyer: { ...s.buyer, reservationPrice: s.buyer.reservationPrice + room } } : { ...s, seller: { ...s.seller, reservationPrice: s.seller.reservationPrice - room } };
}

export function requirementLabel(r: Requirement): string {
  switch (r.kind) {
    case "chattel":
      return `${r.item} included`;
    case "exclude_fixture":
      return `${r.item} excluded`;
    case "condition_min_days":
      return `${r.days}+ banking days on the ${CONDITION_LABELS[r.key].toLowerCase()} condition`;
    case "deposit_timing":
      return r.timing === "herewith" ? "deposit with the offer" : "deposit upon acceptance";
    case "min_deposit_pct":
      return `deposit of at least ${r.pct}%`;
  }
}
