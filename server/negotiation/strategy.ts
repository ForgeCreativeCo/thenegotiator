// The opposing agent's negotiating policy. Code decides what the bot is allowed to do and recommends a move;
// the LLM (or the offline writer) decides how to say it and may adjust within the limits computed here.

import type { HiddenDifficulty, Scenario, Side } from "../engine/types";
import { Rng, roundPrice } from "../engine/rng";
import { defaultBuyerTerms, type Terms } from "./terms";
import { netFor, priceForNet, repairTerms, setNet, violations } from "./constraints";
import type { BotAction, Negotiation, Offer } from "./types";

export function botSide(s: Scenario): Side {
  return s.userRole === "buyer_agent" ? "seller" : "buyer";
}

/** +1 when higher net is better for the bot's client (seller), -1 when lower is better (buyer). */
function direction(side: Side): 1 | -1 {
  return side === "seller" ? 1 : -1;
}

const TEMPERAMENT = {
  collaborative: { stepScale: 1.25, fatigueRound: 4, walkRound: 10, rejectsLowballs: false },
  professional: { stepScale: 1, fatigueRound: 5, walkRound: 9, rejectsLowballs: false },
  cagey: { stepScale: 0.8, fatigueRound: 6, walkRound: 9, rejectsLowballs: false },
  hardball: { stepScale: 0.6, fatigueRound: 7, walkRound: 7, rejectsLowballs: true },
} satisfies Record<HiddenDifficulty["temperament"], unknown>;

export const MAX_BOT_ROUNDS = 12;

function roundNet(n: number): number {
  return n < 1_000_000 ? Math.round(n / 500) * 500 : Math.round(n / 1_000) * 1_000;
}

export function reservationNet(s: Scenario): number {
  return botSide(s) === "seller" ? s.seller.reservationPrice : s.buyer.reservationPrice;
}

/** The bot's starting position (net). */
export function aspiration(s: Scenario): number {
  const side = botSide(s);
  const r = reservationNet(s);
  const list = s.property.listPrice;
  const rng = new Rng(s.seed ^ 0xa5a5a5);
  const t = s.difficulty.temperament;
  if (side === "seller") {
    return roundNet(Math.max(list, r * 1.02));
  }
  const tempAdj = t === "hardball" ? -0.02 : t === "collaborative" ? 0.01 : 0;
  const discount = { hot: rng.range(-0.02, 0.005), balanced: rng.range(0.02, 0.04), cold: rng.range(0.05, 0.09) }[s.market.temperature] - tempAdj;
  const anchor = list * (1 - discount);
  return roundNet(Math.min(Math.max(list * 0.85, anchor), r * 0.97));
}

function lastOfferBy(n: Negotiation, side: Side): Offer | null {
  for (let i = n.offers.length - 1; i >= 0; i--) if (n.offers[i].by === side) return n.offers[i];
  return null;
}

function previousOfferBy(n: Negotiation, side: Side): Offer | null {
  let seen = false;
  for (let i = n.offers.length - 1; i >= 0; i--) {
    if (n.offers[i].by !== side) continue;
    if (seen) return n.offers[i];
    seen = true;
  }
  return null;
}

export interface Recommendation {
  action: BotAction;
  terms: Terms | null;
  /** The bot's client's floor (seller) or ceiling (buyer), as a net price. */
  reservationNet: number;
  /** The bot's current position before this turn, as a net and as the price on its last offer (or the list price). */
  currentNet: number;
  currentPrice: number;
  /** Largest concession (in net dollars) allowed this turn. */
  maxConcession: number;
  /** Whether accepting the user's open offer is permitted this turn. */
  acceptAllowed: boolean;
  walkAllowed: boolean;
  userOfferViolations: string[];
  reasoning: string;
}

/** The bot's first offer when it represents the buyer. */
export function openingOffer(s: Scenario): Terms {
  const rng = new Rng(s.seed ^ 0x51ed);
  const net = aspiration(s);
  let terms = defaultBuyerTerms(s, { closingDate: s.buyer.idealClose });
  if (s.market.temperature === "cold" && rng.chance(0.6)) terms.sellerCredit = roundPrice(net * 0.015);
  if (s.market.temperature === "hot" && s.buyer.willingToWaive.includes("appraisal")) {
    terms.appraisal = "gap_coverage";
    terms.appraisalGapCoverage = s.buyer.maxAppraisalGapCoverage;
  }
  return setNet("buyer", s, terms, net);
}

export function recommend(s: Scenario, n: Negotiation): Recommendation {
  const side = botSide(s);
  const userSide: Side = side === "seller" ? "buyer" : "seller";
  const dir = direction(side);
  const r = reservationNet(s);
  const temperament = TEMPERAMENT[s.difficulty.temperament];
  const round = n.botTurns.length + 1;

  const botLast = lastOfferBy(n, side);
  const current = botLast ? netFor(side, botLast.terms) : aspiration(s);
  const userOffer = lastOfferBy(n, userSide);
  const openUserOffer = userOffer && userOffer.status === "open" ? userOffer : null;

  const remaining = Math.max(0, dir * (current - r));
  const baseFraction = 0.12 + 0.4 * s.difficulty.concessionPace;

  const base: Omit<Recommendation, "action" | "terms" | "reasoning"> = {
    reservationNet: r,
    currentNet: current,
    currentPrice: botLast ? botLast.terms.price : side === "seller" ? s.property.listPrice : current,
    maxConcession: 0,
    acceptAllowed: false,
    walkAllowed: false,
    userOfferViolations: [],
  };

  if (!openUserOffer) {
    if (side === "buyer" && !botLast) {
      return { ...base, action: "counter", terms: openingOffer(s), reasoning: "Make the buyer's opening offer." };
    }
    return { ...base, action: "hold", terms: null, reasoning: "No new offer on the table. Answer the message and hold your position." };
  }

  const u = netFor(side, openUserOffer.terms);
  const prevUser = previousOfferBy(n, userSide);
  const userMove = prevUser ? dir * (u - netFor(side, prevUser.terms)) : r * 0.01;
  const reciprocity = userMove <= r * 0.0025 ? 0.4 : 1;
  const step = remaining * Math.min(0.85, baseFraction * temperament.stepScale * reciprocity);
  const userViolations = violations(side, s, openUserOffer.terms);
  const userMeetsFloor = dir * (u - r) >= 0;
  const halfway = r + (current - r) / 2;

  const acceptAllowed = userViolations.length === 0 && dir * (u - halfway) >= 0;
  const walkAllowed = round >= temperament.walkRound - 2 && !userMeetsFloor;
  const shared = { ...base, maxConcession: Math.max(step * 1.5, r * 0.0025), acceptAllowed, walkAllowed, userOfferViolations: userViolations };

  // 1. Accept when the user has met the bot's position, or late in the game when the offer is signable.
  const nearAsk = dir * (u - current) >= -r * 0.003;
  const fatigued = round >= temperament.fatigueRound && userMeetsFloor;
  let next = roundNet(current - dir * step);
  if (dir * (next - r) < 0) next = r;
  const counterNoBetter = dir * (u - next) >= 0;
  if (userViolations.length === 0 && (nearAsk || counterNoBetter || fatigued)) {
    return { ...shared, acceptAllowed: true, action: "accept", terms: null, reasoning: nearAsk || counterNoBetter ? "Their offer meets or beats where you'd counter. Take it." : "You've gone several rounds and this is signable. Close it." };
  }

  // 2. Walk when the user stays outside the client's limits for too long.
  if (round >= MAX_BOT_ROUNDS || (round >= temperament.walkRound && !userMeetsFloor && userMove <= r * 0.0025)) {
    return { ...shared, walkAllowed: true, action: "walk", terms: null, reasoning: "Many rounds with no real movement toward a price your client can sign. Walk away politely, leaving the door open." };
  }

  // 3. A hardball agent won't dignify a big lowball with a counter.
  const lowball = dir * (r - u) > r * 0.1;
  if (temperament.rejectsLowballs && lowball && round <= 2) {
    return { ...shared, action: "reject", terms: null, reasoning: "Their offer is a lowball. Reject it without countering and tell them to come back with something serious." };
  }

  // 4. Counter: take their terms, fix anything the client won't sign, and set the price.
  if (dir * (next - u) <= 0) next = u; // never counter past their own number
  const terms = setNet(side, s, openUserOffer.terms, next);
  // A seller would rather give up the credit than counter above their own list price.
  if (side === "seller" && terms.sellerCredit > 0 && terms.price > s.property.listPrice) {
    terms.sellerCredit = Math.max(0, s.property.listPrice - terms.homeWarranty - next);
    terms.price = priceForNet(side, terms, next);
  }
  const unfixable = violations(side, s, terms);
  if (unfixable.length) {
    if (round >= 3) return { ...shared, walkAllowed: true, action: "walk", terms: null, reasoning: `Their offer has terms your client can never accept: ${unfixable.join("; ")}. They haven't fixed it, so walk.` };
    return { ...shared, action: "reject", terms: null, reasoning: `Your client can't accept this no matter the price: ${unfixable.join("; ")}. Tell them what would need to change.` };
  }
  const moved = Math.abs(next - current);
  return {
    ...shared,
    action: "counter",
    terms,
    reasoning:
      userViolations.length > 0 && moved === 0
        ? `Hold your number and fix the terms your client won't accept: ${userViolations.join("; ")}.`
        : `Counter at a net of about ${next.toLocaleString("en-US")} (moving ${moved.toLocaleString("en-US")} from your last position).${userViolations.length ? ` Also fix: ${userViolations.join("; ")}.` : ""}${reciprocity < 1 ? " They barely moved, so you move less too." : ""}`,
  };
}

/** Validates a counter the LLM proposed. Returns problems; empty means it's allowed. */
export function validateBotCounter(s: Scenario, rec: Recommendation, terms: Terms): string[] {
  const side = botSide(s);
  const dir = direction(side);
  const problems = violations(side, s, terms).map((v) => `Your client won't sign this: ${v}`);
  const net = netFor(side, terms);
  if (dir * (net - rec.currentNet) > rec.reservationNet * 0.002) problems.push("You can't move backward from your last position (that's retrading).");
  const concession = dir * (rec.currentNet - net);
  if (concession > rec.maxConcession + 1) problems.push(`That concedes ${Math.round(concession).toLocaleString("en-US")}; the most you can move this turn is ${Math.round(rec.maxConcession).toLocaleString("en-US")}.`);
  if (side === "buyer" && (terms.loanType !== s.buyer.loanType)) problems.push("Loan type must match your buyer's financing.");
  return problems;
}
