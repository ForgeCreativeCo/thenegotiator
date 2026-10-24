// Step 1 of scenario generation: code decides every number. The LLM only writes the story around them.

import type { MarketTemperature, OfferNightSetup, Role, ScenarioParams } from "./types";
import { Rng, newSeed } from "./rng";
import { generateMarket } from "./markets";
import { PROPERTY_TYPES, generateProperty, isoDate } from "./properties";
import { generateBriefs, generateDifficulty } from "./briefs";
import { buildDisclosures, generateComps, generateFindings, generateGroundTruth } from "./groundTruth";
import { generateClientFacts, generateOwnClientEvents } from "../client/facts";

export interface GenerateOptions {
  seed?: number;
  startDate?: string;
  role?: Role; // for tests; normally random
}

export function generateParams(options: GenerateOptions = {}): ScenarioParams {
  const seed = options.seed ?? newSeed();
  const rng = new Rng(seed);
  const startDate = options.startDate ?? isoDate(new Date());
  const start = new Date(`${startDate}T12:00:00Z`);

  const userRole: Role = options.role ?? (rng.chance(0.5) ? "buyer_agent" : "seller_agent");
  const market = generateMarket(rng);
  const { property, marketValue } = generateProperty(rng, market, start);
  const difficulty = generateDifficulty(rng);
  const { seller, buyer } = generateBriefs({ rng, market, property, marketValue, difficulty, userRole, startDate });

  const findings = generateFindings(rng, property, difficulty, start.getUTCFullYear());
  const groundTruth = generateGroundTruth({
    rng,
    market,
    property,
    marketValue,
    seller,
    buyer,
    difficulty,
    botSide: userRole === "buyer_agent" ? "seller" : "buyer",
    findings,
  });

  const params: ScenarioParams = {
    seed,
    startDate,
    market,
    property,
    comps: generateComps(rng, property, marketValue, market, start),
    disclosures: buildDisclosures(property, [...findings.inspectionFindings, ...findings.typeSpecificIssues]),
    typeSpecificTerms: PROPERTY_TYPES[property.type].terms,
    userRole,
    seller,
    buyer,
    groundTruth,
    difficulty,
    offerNight: generateOfferNight(seed, market.offerNightsCommon, market.temperature, groundTruth.competingOffers.filter((o) => o.phase === "pre_contract").length),
  };
  return { ...params, clientFacts: generateClientFacts(params), ownClientEvents: generateOwnClientEvents(params) };
}

/** Hot GTA-style listings with real competing interest hold offers until a review night. Uses its own random stream. */
function generateOfferNight(seed: number, common: boolean, temperature: MarketTemperature, competitors: number): OfferNightSetup | null {
  if (!common || temperature !== "hot" || competitors === 0) return null;
  const rng = new Rng(seed ^ 0x0ff3e7);
  return {
    reviewAtHours: rng.int(2, 5) * 24 + 10,
    preemptives: rng.chance(0.4) ? "considered" : "not_accepted",
    sellerDisclosure: rng.chance(0.25) ? "details" : "count_only",
  };
}
