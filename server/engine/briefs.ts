import type { BuyerBrief, DealSpace, HiddenDifficulty, LoanType, Market, Preferences, Property, Role, SellerBrief } from "./types";
import { Rng, roundPrice } from "./rng";
import { addDays } from "./properties";

// ---------- Hidden difficulty ----------

export function generateDifficulty(rng: Rng): HiddenDifficulty {
  const leverage = Number(rng.range(-1, 1).toFixed(2));
  const temperament = rng.weighted<HiddenDifficulty["temperament"]>([["collaborative", 0.2], ["professional", 0.4], ["cagey", 0.25], ["hardball", 0.15]]);
  const concessionPace = Number(rng.range(0.1, 0.9).toFixed(2));
  const bluffing = rng.weighted<HiddenDifficulty["bluffing"]>([["never", 0.5], ["subtle", 0.35], ["active", 0.15]]);
  const clientVolatility = rng.weighted<HiddenDifficulty["clientVolatility"]>([["steady", 0.55], ["nervous", 0.3], ["erratic", 0.15]]);
  const eventVolatility = rng.weighted<HiddenDifficulty["eventVolatility"]>([["clean", 0.25], ["typical", 0.5], ["rough", 0.25]]);
  const dealSpace = rng.weighted<DealSpace>([["wide", 0.25], ["normal", 0.4], ["narrow", 0.25], ["none", 0.1]]);

  const score =
    leverage * 1.5 +
    { collaborative: -1, professional: 0, cagey: 1, hardball: 2 }[temperament] +
    (0.5 - concessionPace) * 2 +
    { never: 0, subtle: 0.5, active: 1 }[bluffing] +
    { steady: 0, nervous: 0.5, erratic: 1 }[clientVolatility] +
    { clean: -0.5, typical: 0, rough: 1 }[eventVolatility] +
    { wide: -1.5, normal: 0, narrow: 1.5, none: 2.5 }[dealSpace];
  const rating: HiddenDifficulty["rating"] = score < 0 ? "easy" : score < 2.5 ? "moderate" : score < 5 ? "hard" : "brutal";

  return { leverage, temperament, concessionPace, bluffing, clientVolatility, eventVolatility, dealSpace, rating };
}

/** Gap between the buyer's ceiling and the seller's floor, as a fraction of market value. */
export function dealSpaceGap(rng: Rng, space: DealSpace): number {
  switch (space) {
    case "wide":
      return rng.range(0.045, 0.08);
    case "normal":
      return rng.range(0.018, 0.04);
    case "narrow":
      return rng.range(0.003, 0.012);
    case "none":
      return -rng.range(0.015, 0.045);
  }
}

// ---------- Shared helpers ----------

function preferences(rng: Rng, boosts: Partial<Preferences>): Preferences {
  const raw: Preferences = {
    price: rng.range(0.5, 1.5) + (boosts.price ?? 0),
    timing: rng.range(0.2, 1) + (boosts.timing ?? 0),
    certainty: rng.range(0.2, 1) + (boosts.certainty ?? 0),
    repairs: rng.range(0.1, 0.8) + (boosts.repairs ?? 0),
    possession: rng.range(0.05, 0.5) + (boosts.possession ?? 0),
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  const keys = Object.keys(raw) as (keyof Preferences)[];
  return Object.fromEntries(keys.map((k) => [k, Number((raw[k] / total).toFixed(3))])) as unknown as Preferences;
}

function urgencyFrom(rng: Rng, base: number, leverageAgainst: number): 1 | 2 | 3 | 4 | 5 {
  // leverageAgainst > 0 means this client is the weaker party, so more urgent.
  return Math.max(1, Math.min(5, Math.round(base + leverageAgainst * 1.2 + rng.range(-0.6, 0.6)))) as 1 | 2 | 3 | 4 | 5;
}

// ---------- Seller ----------

const SELLER_MOTIVATIONS: Record<string, { urgency: number; boosts: Partial<Preferences>; rentBack: number }> = {
  relocation: { urgency: 4, boosts: { timing: 0.8, certainty: 0.5 }, rentBack: 0.2 },
  divorce: { urgency: 3.5, boosts: { certainty: 0.8, price: 0.3 }, rentBack: 0.1 },
  estate: { urgency: 3, boosts: { certainty: 0.4, repairs: 0.8 }, rentBack: 0 },
  downsizing: { urgency: 2, boosts: { price: 0.5, possession: 0.6 }, rentBack: 0.5 },
  upsizing: { urgency: 3, boosts: { timing: 0.6, possession: 0.6 }, rentBack: 0.6 },
  financial_strain: { urgency: 4.5, boosts: { certainty: 0.6, timing: 0.6 }, rentBack: 0.2 },
  investor_exit: { urgency: 2, boosts: { price: 1, repairs: 0.4 }, rentBack: 0 },
  retirement_move: { urgency: 2.5, boosts: { price: 0.6, possession: 0.4 }, rentBack: 0.4 },
  tired_landlord: { urgency: 3, boosts: { certainty: 0.6, repairs: 0.6 }, rentBack: 0 },
  builder: { urgency: 2.5, boosts: { price: 0.8, certainty: 0.5 }, rentBack: 0 },
  testing_the_market: { urgency: 1, boosts: { price: 1.2 }, rentBack: 0.3 },
};

function pickSellerMotivation(rng: Rng, property: Property): string {
  if (property.type === "new_construction") return "builder";
  if (property.type === "land") return rng.weighted([["investor_exit", 3], ["estate", 2], ["financial_strain", 1], ["retirement_move", 1.5]]);
  const pool: [string, number][] = [
    ["relocation", 3], ["divorce", 1.5], ["estate", 1.5], ["downsizing", 2], ["upsizing", 2],
    ["financial_strain", 1], ["retirement_move", 1.5], ["testing_the_market", 0.8],
  ];
  if (property.type === "multifamily") pool.push(["tired_landlord", 4], ["investor_exit", 3]);
  return rng.weighted(pool);
}

export interface BriefContext {
  rng: Rng;
  market: Market;
  property: Property;
  marketValue: number;
  difficulty: HiddenDifficulty;
  userRole: Role;
  startDate: string;
}

/** Leverage from the seller's point of view: positive = seller holds leverage. */
export function sellerLeverage(ctx: Pick<BriefContext, "difficulty" | "userRole" | "market">): number {
  const botIsSeller = ctx.userRole === "buyer_agent";
  const fromDifficulty = botIsSeller ? ctx.difficulty.leverage : -ctx.difficulty.leverage;
  const fromMarket = { hot: 0.4, balanced: 0, cold: -0.4 }[ctx.market.temperature];
  return Math.max(-1, Math.min(1, fromDifficulty * 0.7 + fromMarket));
}

export function generateBriefs(ctx: BriefContext): { seller: SellerBrief; buyer: BuyerBrief } {
  const { rng, marketValue, difficulty, startDate } = ctx;
  const leverageS = sellerLeverage(ctx);

  // Where the two reservation prices sit. The seller's leverage moves the midpoint; the deal space sets the gap.
  const midpoint = marketValue * (1 + leverageS * 0.035 + rng.range(-0.01, 0.01));
  const gap = dealSpaceGap(rng, difficulty.dealSpace);
  const sellerReservation = roundPrice(midpoint * (1 - gap / 2));
  const buyerReservation = roundPrice(midpoint * (1 + gap / 2));

  const seller = generateSeller(ctx, sellerReservation, leverageS);
  const buyer = generateBuyer(ctx, buyerReservation, -leverageS);

  // When a deal should be possible, make sure the closing windows overlap by at least a week.
  if (difficulty.dealSpace !== "none") {
    if (buyer.latestClose < addDays(seller.earliestClose, 7)) buyer.latestClose = addDays(seller.earliestClose, 7);
    if (seller.latestClose < addDays(buyer.earliestClose, 7)) seller.latestClose = addDays(buyer.earliestClose, 7);
  }
  for (const brief of [seller, buyer]) {
    if (brief.idealClose < brief.earliestClose) brief.idealClose = brief.earliestClose;
    if (brief.idealClose > brief.latestClose) brief.idealClose = brief.latestClose;
  }
  return { seller, buyer };
}

function generateSeller(ctx: BriefContext, reservationPrice: number, leverage: number): SellerBrief {
  const { rng, property, marketValue, startDate, difficulty } = ctx;
  const motivation = pickSellerMotivation(rng, property);
  const profile = SELLER_MOTIVATIONS[motivation];
  const urgency = urgencyFrom(rng, profile.urgency, -leverage);

  const equityShare = motivation === "financial_strain" ? rng.range(0.82, 0.93) : motivation === "estate" || motivation === "builder" ? 0 : rng.range(0, 0.7);
  const mortgagePayoff = roundPrice(Math.min(reservationPrice * 0.94, marketValue * equityShare));

  const idealOffset = urgency >= 4 ? rng.int(21, 35) : rng.int(30, 60);
  const needsRentBackDays = rng.chance(profile.rentBack) ? rng.pick([7, 14, 30, 45, 60]) : 0;
  const acceptsAll: LoanType[] = ["cash", "conventional", "fha", "va", "usda", "jumbo"];
  const picky = difficulty.temperament === "hardball" || ctx.market.temperature === "hot";

  return {
    side: "seller",
    motivation,
    urgency,
    preferences: preferences(rng, profile.boosts),
    earliestClose: addDays(startDate, urgency >= 4 ? 18 : rng.int(21, 30)),
    idealClose: addDays(startDate, idealOffset),
    latestClose: addDays(startDate, idealOffset + (urgency >= 4 ? rng.int(5, 15) : rng.int(15, 45))),
    reservationPrice,
    maxConcessions: roundPrice(marketValue * rng.range(0.004, 0.012) * (urgency >= 4 ? 2 : 1)),
    mortgagePayoff,
    needsRentBackDays,
    willingToFinanceRepairs: rng.chance(urgency >= 4 ? 0.7 : 0.35),
    acceptableLoanTypes: picky && rng.chance(0.4) ? ["cash", "conventional", "va", "jumbo"] : acceptsAll,
    acceptsHomeSaleContingency: ctx.market.temperature === "cold" ? rng.chance(0.6) : rng.chance(0.15),
  };
}

const BUYER_MOTIVATIONS: Record<string, { urgency: number; boosts: Partial<Preferences> }> = {
  first_time: { urgency: 3, boosts: { price: 0.8, repairs: 0.4 } },
  relocation: { urgency: 4, boosts: { timing: 1, certainty: 0.4 } },
  growing_family: { urgency: 3, boosts: { timing: 0.5, repairs: 0.3 } },
  move_up: { urgency: 2.5, boosts: { timing: 0.4, price: 0.3 } },
  downsizer: { urgency: 2, boosts: { repairs: 0.8, price: 0.2 } },
  investor: { urgency: 1.5, boosts: { price: 1.4, repairs: 0.4 } },
  lease_ending: { urgency: 4.5, boosts: { timing: 1.2 } },
  dream_home_builder: { urgency: 2, boosts: { certainty: 0.5, price: 0.4 } },
};

function pickBuyerMotivation(rng: Rng, property: Property): string {
  if (property.type === "land") return rng.weighted([["dream_home_builder", 4], ["investor", 2]]);
  if (property.type === "multifamily") return rng.weighted([["investor", 4], ["first_time", 2]]);
  return rng.weighted([
    ["first_time", 3], ["relocation", 2], ["growing_family", 2], ["move_up", 2], ["downsizer", 1.5], ["investor", 1], ["lease_ending", 1.5],
  ]);
}

function pickLoanType(rng: Rng, ctx: BriefContext, motivation: string, price: number): LoanType {
  const { property, market } = ctx;
  if (property.type === "land") return rng.chance(0.75) ? "cash" : "conventional";
  if (motivation === "downsizer" && rng.chance(0.5)) return "cash";
  if (motivation === "investor") return rng.chance(0.4) ? "cash" : "conventional";
  if (price > 800_000) return rng.chance(0.25) ? "cash" : "jumbo";
  const options: [LoanType, number][] = [["conventional", 5], ["fha", motivation === "first_time" ? 3 : 1], ["va", 1], ["cash", 1]];
  if (market.metroType === "rural") options.push(["usda", 1.5]);
  if (property.type === "co_op") return "conventional";
  return rng.weighted(options);
}

function generateBuyer(ctx: BriefContext, reservationPrice: number, leverage: number): BuyerBrief {
  const { rng, property, startDate, market } = ctx;
  const motivation = pickBuyerMotivation(rng, property);
  const profile = BUYER_MOTIVATIONS[motivation];
  const urgency = urgencyFrom(rng, profile.urgency, -leverage);
  const loanType = pickLoanType(rng, ctx, motivation, reservationPrice);

  const downPaymentPct = { cash: 100, conventional: rng.pick([5, 10, 15, 20, 20, 25]), fha: 3.5, va: 0, usda: 0, jumbo: rng.pick([10, 20, 25]) }[loanType];
  const cashReserves = roundPrice(reservationPrice * (loanType === "cash" ? rng.range(0.02, 0.15) : rng.range(0.005, 0.05)));
  const preapprovalAmount = loanType === "cash" ? null : roundPrice(reservationPrice * rng.range(1, 1.1));

  const hasHomeToSell = (motivation === "move_up" || motivation === "downsizer" || motivation === "relocation") && rng.chance(0.55);
  const leaseEnds = motivation === "lease_ending" || (motivation === "first_time" && rng.chance(0.6)) || (motivation === "relocation" && rng.chance(0.3));

  const willingToWaive: BuyerBrief["willingToWaive"] = [];
  if (market.temperature === "hot") {
    if (rng.chance(0.35)) willingToWaive.push("inspection");
    if (rng.chance(0.4) && cashReserves > reservationPrice * 0.02) willingToWaive.push("appraisal");
    if (loanType === "cash") willingToWaive.push("financing");
  } else if (loanType === "cash") {
    willingToWaive.push("financing");
  }

  const idealOffset = urgency >= 4 ? rng.int(25, 35) : rng.int(30, 55);
  const leaseEndOffset = leaseEnds ? rng.int(25, 75) : 0;

  return {
    side: "buyer",
    motivation,
    urgency,
    preferences: preferences(rng, profile.boosts),
    earliestClose: addDays(startDate, loanType === "cash" ? 10 : rng.int(21, 30)),
    idealClose: addDays(startDate, leaseEnds ? Math.min(idealOffset, leaseEndOffset) : idealOffset),
    latestClose: addDays(startDate, leaseEnds ? leaseEndOffset + rng.int(0, 10) : idealOffset + rng.int(15, 40)),
    reservationPrice,
    preapprovalAmount,
    loanType,
    downPaymentPct,
    cashReserves,
    maxAppraisalGapCoverage: willingToWaive.includes("appraisal") ? roundPrice(cashReserves * rng.range(0.4, 0.8)) : roundPrice(cashReserves * rng.range(0, 0.3)),
    homeToSell: hasHomeToSell ? { status: rng.pick(["listed", "under_contract", "not_yet_listed"] as const), equity: roundPrice(reservationPrice * rng.range(0.15, 0.5)) } : null,
    leaseEndsOn: leaseEnds ? addDays(startDate, leaseEndOffset) : null,
    mustHaves: rng.sample(property.type === "land" ? ["buildable site", "road access", "privacy", "views"] : ["move-in ready", "good schools", "home office", "yard for the dog", "short commute", "garage", "single-level living"], 2),
    willingToWaive,
  };
}
