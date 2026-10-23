// Step 1 of scenario generation: code decides every number. The LLM only writes the story around them.

import type { Role, ScenarioParams } from "./types";
import { Rng, newSeed } from "./rng";
import { generateMarket } from "./markets";
import { PROPERTY_TYPES, generateProperty, isoDate } from "./properties";
import { generateBriefs, generateDifficulty } from "./briefs";
import { buildDisclosures, generateComps, generateFindings, generateGroundTruth } from "./groundTruth";

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
    startDate,
    botSide: userRole === "buyer_agent" ? "seller" : "buyer",
    findings,
  });

  return {
    seed,
    startDate,
    market,
    property,
    comps: generateComps(rng, property, marketValue, market, start),
    disclosures: buildDisclosures(market, property, [...findings.inspectionFindings, ...findings.typeSpecificIssues]),
    typeSpecificTerms: PROPERTY_TYPES[property.type].terms,
    userRole,
    seller,
    buyer,
    groundTruth,
    difficulty,
  };
}
