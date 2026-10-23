import type { BuyerBrief, DealSpace, FinancingType, HiddenDifficulty, Market, Preferences, Property, Role, SellerBrief } from "./types";
import { Rng, roundPrice } from "./rng";
import { addDays } from "./properties";

// ---------- Hidden difficulty ----------

export function generateDifficulty(rng: Rng): HiddenDifficulty {
  const leverage = Number(rng.range(-1, 1).toFixed(2));
  const temperament = rng.weighted<HiddenDifficulty["temperament"]>([["collaborative", 0.2], ["professional", 0.4], ["cagey", 0.25], ["hardball", 0.15]]);
  const concessionPace = Number(rng.range(0.1, 0.9).toFixed(2));
  const withholding = rng.weighted<HiddenDifficulty["withholding"]>([["open", 0.4], ["reserved", 0.4], ["guarded", 0.2]]);
  const clientVolatility = rng.weighted<HiddenDifficulty["clientVolatility"]>([["steady", 0.55], ["nervous", 0.3], ["erratic", 0.15]]);
  const eventVolatility = rng.weighted<HiddenDifficulty["eventVolatility"]>([["clean", 0.25], ["typical", 0.5], ["rough", 0.25]]);
  const dealSpace = rng.weighted<DealSpace>([["wide", 0.25], ["normal", 0.4], ["narrow", 0.25], ["none", 0.1]]);

  const score =
    leverage * 1.5 +
    { collaborative: -1, professional: 0, cagey: 1, hardball: 2 }[temperament] +
    (0.5 - concessionPace) * 2 +
    { open: 0, reserved: 0.5, guarded: 1 }[withholding] +
    { steady: 0, nervous: 0.5, erratic: 1 }[clientVolatility] +
    { clean: -0.5, typical: 0, rough: 1 }[eventVolatility] +
    { wide: -1.5, normal: 0, narrow: 1.5, none: 2.5 }[dealSpace];
  const rating: HiddenDifficulty["rating"] = score < 0 ? "easy" : score < 2.5 ? "moderate" : score < 5 ? "hard" : "brutal";
  return { leverage, temperament, concessionPace, withholding, clientVolatility, eventVolatility, dealSpace, rating };
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
  return Math.max(1, Math.min(5, Math.round(base + leverageAgainst * 1.2 + rng.range(-0.6, 0.6)))) as 1 | 2 | 3 | 4 | 5;
}

// ---------- Seller ----------

const SELLER_MOTIVATIONS: Record<string, { urgency: number; boosts: Partial<Preferences> }> = {
  relocation: { urgency: 4, boosts: { timing: 0.8, certainty: 0.5 } },
  separation: { urgency: 3.5, boosts: { certainty: 0.8, price: 0.3 } },
  estate: { urgency: 3, boosts: { certainty: 0.4, repairs: 0.8 } },
  downsizing: { urgency: 2, boosts: { price: 0.5, possession: 0.6 } },
  bought_firm_elsewhere: { urgency: 4.5, boosts: { timing: 1, certainty: 0.8 } },
  financial_strain: { urgency: 4.5, boosts: { certainty: 0.6, timing: 0.6 } },
  investor_exit: { urgency: 2, boosts: { price: 1, repairs: 0.4 } },
  retirement_move: { urgency: 2.5, boosts: { price: 0.6, possession: 0.4 } },
  tired_landlord: { urgency: 3, boosts: { certainty: 0.6, repairs: 0.6 } },
  builder: { urgency: 2.5, boosts: { price: 0.8, certainty: 0.5 } },
  testing_the_market: { urgency: 1, boosts: { price: 1.2 } },
};

function pickSellerMotivation(rng: Rng, property: Property): string {
  if (property.type === "new_construction") return "builder";
  if (property.type === "vacant_land") return rng.weighted([["investor_exit", 3], ["estate", 2], ["financial_strain", 1], ["retirement_move", 1.5]]);
  const pool: [string, number][] = [
    ["relocation", 2.5], ["separation", 1.5], ["estate", 1.5], ["downsizing", 2], ["bought_firm_elsewhere", 2.5],
    ["financial_strain", 1], ["retirement_move", 1.5], ["testing_the_market", 0.8],
  ];
  if (property.type === "multiplex") pool.push(["tired_landlord", 4], ["investor_exit", 3]);
  if (property.type === "condo_apartment") pool.push(["investor_exit", 2]);
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
  const midpoint = marketValue * (1 + leverageS * 0.035 + rng.range(-0.01, 0.01));
  const gap = dealSpaceGap(rng, difficulty.dealSpace);
  const seller = generateSeller(ctx, roundPrice(midpoint * (1 - gap / 2)), leverageS);
  const buyer = generateBuyer(ctx, roundPrice(midpoint * (1 + gap / 2)), -leverageS);

  // When a deal should be possible, make sure nothing outside price makes it impossible.
  if (difficulty.dealSpace !== "none") {
    if (buyer.needsSaleCondition) seller.acceptsSaleCondition = true;
    if (buyer.latestClose < addDays(seller.earliestClose, 7)) buyer.latestClose = addDays(seller.earliestClose, 7);
    if (seller.latestClose < addDays(buyer.earliestClose, 7)) seller.latestClose = addDays(buyer.earliestClose, 7);
    const availableCash = (buyer.reservationPrice * (buyer.financing === "cash" ? 100 : buyer.downPaymentPct)) / 100 + buyer.cashReserves;
    if ((buyer.reservationPrice * seller.minDepositPct) / 100 > availableCash) seller.minDepositPct = Math.max(1, Math.floor((availableCash / buyer.reservationPrice) * 100));
  }
  for (const brief of [seller, buyer]) {
    if (brief.latestClose < addDays(brief.earliestClose, 7)) brief.latestClose = addDays(brief.earliestClose, 7);
    if (brief.idealClose < brief.earliestClose) brief.idealClose = brief.earliestClose;
    if (brief.idealClose > brief.latestClose) brief.idealClose = brief.latestClose;
  }
  return { seller, buyer };
}

function generateSeller(ctx: BriefContext, reservationPrice: number, leverage: number): SellerBrief {
  const { rng, property, marketValue, startDate, market } = ctx;
  const motivation = pickSellerMotivation(rng, property);
  const profile = SELLER_MOTIVATIONS[motivation];
  const urgency = urgencyFrom(rng, profile.urgency, -leverage);
  const equityShare = motivation === "financial_strain" ? rng.range(0.82, 0.93) : motivation === "estate" || motivation === "builder" ? 0 : rng.range(0, 0.7);
  const boughtElsewhere = motivation === "bought_firm_elsewhere";
  // Ontario completions usually run 30–90 days; a seller who bought firm elsewhere has a fixed date.
  const idealOffset = boughtElsewhere ? rng.int(35, 75) : urgency >= 4 ? rng.int(30, 45) : rng.int(45, 90);
  return {
    side: "seller",
    motivation,
    urgency,
    preferences: preferences(rng, profile.boosts),
    earliestClose: addDays(startDate, boughtElsewhere ? idealOffset - 3 : Math.max(21, idealOffset - rng.int(15, 30))),
    idealClose: addDays(startDate, idealOffset),
    latestClose: addDays(startDate, idealOffset + (boughtElsewhere ? 3 : rng.int(10, 40))),
    reservationPrice,
    mortgagePayoff: roundPrice(Math.min(reservationPrice * 0.94, marketValue * equityShare)),
    minDepositPct: Math.max(1, Math.round(market.typicalDepositPct * rng.range(0.5, 1))),
    maxConditionDays: { hot: rng.int(3, 5), balanced: rng.int(5, 10), cold: rng.int(10, 15) }[market.temperature],
    acceptsSaleCondition: market.temperature === "cold" ? rng.chance(0.6) : rng.chance(0.12),
    boughtElsewhere,
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
  newcomer: { urgency: 3.5, boosts: { certainty: 0.6, timing: 0.5 } },
  cottage_seeker: { urgency: 2, boosts: { price: 0.6, possession: 0.4 } },
  home_builder: { urgency: 2, boosts: { certainty: 0.5, price: 0.4 } },
};

function pickBuyerMotivation(rng: Rng, property: Property): string {
  if (property.type === "vacant_land") return rng.weighted([["home_builder", 4], ["investor", 2]]);
  if (property.type === "cottage") return rng.weighted([["cottage_seeker", 5], ["downsizer", 1]]);
  if (property.type === "multiplex") return rng.weighted([["investor", 4], ["first_time", 2]]);
  return rng.weighted([["first_time", 3], ["relocation", 1.5], ["growing_family", 2], ["move_up", 2], ["downsizer", 1.5], ["investor", 1], ["lease_ending", 1.5], ["newcomer", 1]]);
}

/** Ontario financing: insured mortgages need under 20% down and a price under $1.5M. */
function pickFinancing(rng: Rng, motivation: string, price: number, property: Property): { financing: FinancingType; downPaymentPct: number } {
  if (property.type === "vacant_land") return rng.chance(0.7) ? { financing: "cash", downPaymentPct: 100 } : { financing: "conventional", downPaymentPct: 35 };
  if (property.type === "co_op") return { financing: "conventional", downPaymentPct: rng.pick([35, 50]) };
  if (motivation === "downsizer" && rng.chance(0.5)) return { financing: "cash", downPaymentPct: 100 };
  if (motivation === "investor") return rng.chance(0.3) ? { financing: "cash", downPaymentPct: 100 } : { financing: "conventional", downPaymentPct: rng.pick([20, 25, 35]) };
  const insurable = price < 1_500_000 && property.type !== "land_lease_home";
  if ((motivation === "first_time" || motivation === "newcomer" || motivation === "lease_ending") && insurable && rng.chance(0.75)) {
    return { financing: "insured", downPaymentPct: price <= 500_000 ? rng.pick([5, 10, 15]) : rng.pick([10, 15]) };
  }
  if (rng.chance(0.08)) return { financing: "alternative", downPaymentPct: rng.pick([20, 25]) };
  return { financing: "conventional", downPaymentPct: rng.pick([20, 20, 25, 30, 40]) };
}

function generateBuyer(ctx: BriefContext, reservationPrice: number, leverage: number): BuyerBrief {
  const { rng, property, startDate, market } = ctx;
  const motivation = pickBuyerMotivation(rng, property);
  const profile = BUYER_MOTIVATIONS[motivation];
  const urgency = urgencyFrom(rng, profile.urgency, -leverage);
  const { financing, downPaymentPct } = pickFinancing(rng, motivation, reservationPrice, property);
  const cashReserves = roundPrice(reservationPrice * (financing === "cash" ? rng.range(0.02, 0.15) : rng.range(0.015, 0.05)));

  const hasHome = (motivation === "move_up" || motivation === "downsizer" || motivation === "relocation") && rng.chance(0.55);
  const homeStatus = hasHome ? rng.pick(["listed", "sold_firm", "not_yet_listed"] as const) : null;
  const needsSaleCondition = homeStatus === "listed" || homeStatus === "not_yet_listed" ? rng.chance(market.temperature === "cold" ? 0.7 : 0.35) : false;
  const leaseEnds = motivation === "lease_ending" || ((motivation === "first_time" || motivation === "newcomer") && rng.chance(0.6));

  const willingToWaive: BuyerBrief["willingToWaive"] = [];
  if (market.temperature === "hot") {
    if (rng.chance(0.45)) willingToWaive.push("inspection"); // often after a pre-inspection
    if (rng.chance(0.35) || financing === "cash") willingToWaive.push("financing");
    if (rng.chance(0.3)) willingToWaive.push("status_certificate");
  } else if (financing === "cash") {
    willingToWaive.push("financing");
  }

  // Ontario completions are typically 30–90 days.
  const idealOffset = urgency >= 4 ? rng.int(30, 45) : rng.int(45, 75);
  const leaseEndOffset = leaseEnds ? rng.int(35, 90) : 0;
  return {
    side: "buyer",
    motivation,
    urgency,
    preferences: preferences(rng, profile.boosts),
    earliestClose: addDays(startDate, financing === "cash" ? 21 : rng.int(30, 40)),
    idealClose: addDays(startDate, leaseEnds ? Math.min(idealOffset, leaseEndOffset) : idealOffset),
    latestClose: addDays(startDate, leaseEnds ? leaseEndOffset + rng.int(0, 10) : idealOffset + rng.int(15, 45)),
    reservationPrice,
    preapprovalAmount: financing === "cash" ? null : roundPrice(reservationPrice * rng.range(1, 1.1)),
    financing,
    downPaymentPct,
    cashReserves,
    maxAppraisalGapCoverage: willingToWaive.includes("financing") ? roundPrice(cashReserves * rng.range(0.4, 0.8)) : roundPrice(cashReserves * rng.range(0, 0.3)),
    firstTimeBuyer: motivation === "first_time" || (motivation === "newcomer" && rng.chance(0.8)) || (motivation === "lease_ending" && rng.chance(0.6)),
    homeToSell: homeStatus ? { status: homeStatus, equity: roundPrice(reservationPrice * rng.range(0.15, 0.5)) } : null,
    needsSaleCondition,
    leaseEndsOn: leaseEnds ? addDays(startDate, leaseEndOffset) : null,
    mustHaves: rng.sample(property.type === "vacant_land" ? ["buildable envelope", "hydro at the road", "privacy", "year-round access"] : ["move-in ready", "good schools", "home office", "parking", "near transit", "yard", "main-floor bedroom"], 2),
    willingToWaive,
  };
}
