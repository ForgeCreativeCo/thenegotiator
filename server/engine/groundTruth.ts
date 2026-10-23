import type {
  BuyerBrief,
  ClientEvent,
  Comp,
  CompetingOffer,
  Disclosure,
  Finding,
  GroundTruth,
  HiddenDifficulty,
  LoanEvent,
  Market,
  Property,
  PropertyType,
  Severity,
  SellerBrief,
  Surprise,
  TitleIssue,
} from "./types";
import { Rng, roundPrice } from "./rng";
import { isCondo } from "./properties";

interface FindingTemplate {
  system: string;
  title: string;
  severity: Severity;
  cost: [number, number];
  minAge?: number;
  maxYear?: number;
  minYear?: number;
  requires?: (p: Property) => boolean;
  source?: Finding["source"];
  insurance?: boolean;
}

const isHouse = (p: Property) => !["condo_apartment", "co_op", "vacant_land"].includes(p.type);

// Ontario housing stock: the things home inspectors, insurers and lawyers actually find here.
const FINDINGS: FindingTemplate[] = [
  { system: "Electrical", title: "Active knob-and-tube wiring in the original part of the house; most insurers won't cover it until it's replaced", severity: "major", cost: [12_000, 30_000], maxYear: 1950, requires: isHouse, insurance: true },
  { system: "Electrical", title: "Aluminum branch wiring; insurers require an ESA inspection and pigtailing", severity: "moderate", cost: [3_000, 9_000], minYear: 1965, maxYear: 1978, requires: isHouse, insurance: true },
  { system: "Electrical", title: "60-amp service and an overloaded panel", severity: "moderate", cost: [3_500, 7_000], maxYear: 1965, requires: isHouse },
  { system: "Heating", title: "Underground oil tank on the property, not decommissioned; removal and soil testing needed before most insurers will bind", severity: "major", cost: [10_000, 35_000], maxYear: 1975, requires: (p) => isHouse(p) && p.water === "municipal", insurance: true },
  { system: "Heating", title: "Furnace is 22 years old with a cracked heat exchanger", severity: "safety", cost: [5_000, 9_000], minAge: 18, requires: isHouse },
  { system: "Plumbing", title: "Lead water service pipe from the street", severity: "moderate", cost: [3_000, 8_000], maxYear: 1955, requires: (p) => isHouse(p) && p.water === "municipal" },
  { system: "Plumbing", title: "Galvanized steel supply lines with low water pressure", severity: "moderate", cost: [6_000, 14_000], maxYear: 1960, requires: isHouse },
  { system: "Plumbing", title: "Kitec plumbing (subject to a class-action recall); full replacement recommended", severity: "major", cost: [8_000, 18_000], minYear: 1995, maxYear: 2007 },
  { system: "Plumbing", title: "Cast-iron drain stack cracked; tree roots in the sewer lateral on the camera scope", severity: "major", cost: [8_000, 22_000], maxYear: 1975, requires: (p) => isHouse(p) && p.sewer === "municipal" },
  { system: "Insulation", title: "Possible UFFI (urea formaldehyde foam insulation) in exterior walls", severity: "moderate", cost: [3_000, 15_000], minYear: 1970, maxYear: 1982, requires: isHouse },
  { system: "Insulation", title: "Vermiculite insulation in the attic (may contain asbestos)", severity: "moderate", cost: [6_000, 15_000], maxYear: 1990, requires: isHouse },
  { system: "Structure", title: "Cracked foundation wall with active water seepage in the basement", severity: "major", cost: [10_000, 30_000], minAge: 25, requires: isHouse },
  { system: "Moisture", title: "Damp basement: efflorescence, high moisture readings, and a failed weeping tile section", severity: "moderate", cost: [5_000, 18_000], minAge: 20, requires: isHouse },
  { system: "Roof", title: "Asphalt shingles near the end of their life; ice damming stains at the eaves", severity: "major", cost: [10_000, 22_000], minAge: 18, requires: isHouse },
  { system: "Roof", title: "Flat roof membrane blistered over the rear addition", severity: "moderate", cost: [4_000, 9_000], minAge: 15, requires: isHouse },
  { system: "Chimney", title: "Chimney needs repointing; wood stove has no WETT certificate", severity: "moderate", cost: [2_000, 6_000], minAge: 25, requires: isHouse },
  { system: "Pests", title: "Evidence of termite activity (this area is in a municipal termite zone)", severity: "major", cost: [3_000, 15_000], requires: (p) => isHouse(p) && p.address.municipality === "Toronto" },
  { system: "Environmental", title: "Signs of a past marijuana grow operation: mould, rewired circuits, vents through the roof", severity: "major", cost: [15_000, 50_000], requires: isHouse },
  { system: "Environmental", title: "Radon test reading of 260 Bq/m³ (Health Canada guideline is 200)", severity: "moderate", cost: [2_000, 3_500], requires: isHouse },
  { system: "Exterior", title: "Rotted deck ledger and failing railings", severity: "safety", cost: [3_000, 9_000], minAge: 12, requires: isHouse },
  { system: "Windows", title: "Original single-pane windows with failed storms", severity: "minor", cost: [2_000, 6_000], minAge: 40, requires: isHouse },
  { system: "Electrical", title: "Missing GFCI protection and double-tapped breakers", severity: "minor", cost: [400, 1_500] },
  { system: "Plumbing", title: "Water heater past its rated life", severity: "minor", cost: [1_500, 3_000], minAge: 10, requires: (p) => !p.rentalItems.some((r) => /water/i.test(r.item)) },
  { system: "Permits", title: "Basement apartment and added bathroom built without permits", severity: "moderate", cost: [4_000, 20_000], minAge: 10, requires: (p) => p.basement === "apartment" || p.basement === "finished" },
  { system: "Well", title: "Well water fails the bacteriological test (E. coli present)", severity: "safety", cost: [1_500, 6_000], requires: (p) => p.water === "well", source: "water_septic" },
  { system: "Well", title: "Well flow test shows 2 gallons per minute, below what a lender will accept", severity: "major", cost: [6_000, 20_000], requires: (p) => p.water === "well", source: "water_septic" },
  { system: "Septic", title: "Septic bed is saturated and failing; replacement needs a permit", severity: "major", cost: [20_000, 45_000], minAge: 20, requires: (p) => p.sewer === "septic", source: "water_septic" },
  { system: "Septic", title: "Septic tank overdue for pumping; baffle cracked", severity: "minor", cost: [800, 2_500], requires: (p) => p.sewer === "septic", source: "water_septic" },
];

const TYPE_ISSUES: Partial<Record<PropertyType, FindingTemplate[]>> = {
  condo_apartment: [
    { system: "Status certificate", title: "Special assessment of about $9,000 per unit approved for garage membrane repairs", severity: "major", cost: [7_000, 11_000], source: "status_certificate" },
    { system: "Status certificate", title: "Reserve fund study shows a shortfall; the budget projects a 12% fee increase next year", severity: "moderate", cost: [0, 0], source: "status_certificate" },
    { system: "Status certificate", title: "The corporation is in litigation with the developer over cladding defects", severity: "major", cost: [0, 0], source: "status_certificate" },
    { system: "Status certificate", title: "The parking space is exclusive use, not an owned unit as the listing implied", severity: "moderate", cost: [0, 0], source: "status_certificate" },
  ],
  condo_townhouse: [
    { system: "Status certificate", title: "Special assessment of about $6,500 per unit coming for roof replacements", severity: "major", cost: [5_500, 7_500], source: "status_certificate" },
    { system: "Status certificate", title: "Reserve fund study shows a shortfall; fees likely to rise 10–15%", severity: "moderate", cost: [0, 0], source: "status_certificate" },
  ],
  semi_detached: [{ system: "Title", title: "Shared drain with the attached semi, with no registered agreement", severity: "moderate", cost: [2_000, 8_000], source: "lawyer" }],
  multiplex: [
    { system: "Zoning", title: "Third unit isn't a legal unit; fire code retrofit required to keep renting it", severity: "major", cost: [15_000, 40_000] },
    { system: "Tenancies", title: "Upper unit's tenant has paid $1,100 a month since 2014, well below market, and won't leave voluntarily", severity: "moderate", cost: [0, 0] },
  ],
  cottage: [
    { system: "Title", title: "Shore road allowance in front of the cottage was never closed; the dock and bunkie sit on municipal land", severity: "major", cost: [8_000, 25_000], source: "lawyer" },
    { system: "Permits", title: "Bunkie and deck built without permits from the township or conservation authority", severity: "moderate", cost: [3_000, 12_000] },
  ],
  rural_acreage: [{ system: "Survey", title: "The neighbour's fence and shed sit 10 metres inside the boundary", severity: "moderate", cost: [0, 5_000], source: "lawyer" }],
  vacant_land: [
    { system: "Due diligence", title: "Soil testing shows a conventional septic won't be approved; an engineered system is needed", severity: "major", cost: [25_000, 50_000] },
    { system: "Due diligence", title: "Most of the lot is regulated by the conservation authority; the building envelope is small", severity: "major", cost: [0, 0] },
  ],
  new_construction: [
    { system: "Builder", title: "Builder issues a Tarion notice moving the closing date back 60 days", severity: "moderate", cost: [0, 0] },
    { system: "Builder", title: "Pre-delivery inspection shows unfinished grading and drywall deficiencies", severity: "minor", cost: [1_000, 4_000] },
  ],
  land_lease_home: [{ system: "Land lease", title: "The community is raising the land lease fee 8% next year", severity: "moderate", cost: [0, 0] }],
};

let findingCounter = 0;
function toFinding(rng: Rng, t: FindingTemplate, disclosed: boolean): Finding {
  findingCounter += 1;
  return {
    id: `f${findingCounter}`,
    system: t.system,
    title: t.title,
    severity: t.severity,
    repairCostLow: roundPrice(t.cost[0] * rng.range(0.9, 1.1)),
    repairCostHigh: roundPrice(t.cost[1] * rng.range(0.9, 1.1)),
    disclosed,
    sellerKnew: disclosed || rng.chance(0.35),
    source: t.source ?? "home_inspection",
    affectsInsurance: t.insurance ?? false,
  };
}

export function generateFindings(rng: Rng, property: Property, difficulty: HiddenDifficulty, startYear: number) {
  findingCounter = 0;
  const year = property.yearBuilt;
  const age = year ? startYear - year : 0;
  const eligible =
    property.type === "vacant_land" || property.type === "new_construction"
      ? []
      : FINDINGS.filter((t) => (t.minAge ?? 0) <= age && (t.maxYear === undefined || year <= t.maxYear) && (t.minYear === undefined || year >= t.minYear) && (!t.requires || t.requires(property)));
  const baseCount = { 1: 6, 2: 4, 3: 3, 4: 2, 5: 1 }[property.condition];
  const bonus = { clean: -2, typical: 0, rough: 2 }[difficulty.eventVolatility];
  const pool = difficulty.eventVolatility === "clean" ? eligible.filter((t) => t.severity !== "major") : eligible;
  const count = Math.max(0, Math.min(pool.length, baseCount + bonus + rng.int(-1, 1)));
  const inspectionFindings = rng.sample(pool, count).map((t) => toFinding(rng, t, rng.chance(0.3)));

  const typePool = TYPE_ISSUES[property.type] ?? [];
  const typeChance = { clean: 0.15, typical: 0.45, rough: 0.8 }[difficulty.eventVolatility];
  const typeSpecificIssues = typePool.length && rng.chance(typeChance) ? rng.sample(typePool, rng.int(1, difficulty.eventVolatility === "rough" ? 2 : 1)).map((t) => toFinding(rng, t, rng.chance(0.15))) : [];
  return { inspectionFindings, typeSpecificIssues };
}

/** What the seller has disclosed: the SPIS if they filled one out, plus what the listing must say. */
export function buildDisclosures(property: Property, findings: Finding[]): Disclosure[] {
  const disclosures: Disclosure[] = [];
  if (!property.spisProvided) {
    disclosures.push({ item: "Seller Property Information Statement", detail: "The seller has not completed an SPIS (it's optional in Ontario). Buyers rely on their own inspection and due diligence." });
  }
  // Known latent defects that make a property dangerous must be disclosed regardless of the SPIS.
  for (const f of findings) {
    if (f.sellerKnew && f.severity === "safety") f.disclosed = true;
    if (f.disclosed) disclosures.push({ item: f.system, detail: f.title });
  }
  if (property.rentalItems.length) disclosures.push({ item: "Rental items", detail: property.rentalItems.map((r) => `${r.item} ($${r.monthly}/month)`).join(", ") + ". Buyer to assume the rental contracts." });
  if (property.condo) disclosures.push({ item: "Condominium", detail: `${property.condo.corporation}. Maintenance fees $${property.condo.monthlyFees}/month. Status certificate available on request.` });
  if (property.units) disclosures.push({ item: "Tenancies", detail: "Tenanted units are subject to the Residential Tenancies Act. Rents and lease terms are in the listing." });
  if (property.spisProvided && disclosures.length === 0) disclosures.push({ item: "SPIS", detail: "The seller reports no known material defects." });
  return disclosures;
}

export function generateComps(rng: Rng, property: Property, marketValue: number, market: Market, startDate: Date): Comp[] {
  const count = rng.int(3, 5);
  const comps: Comp[] = [];
  const rural = property.acres !== null;
  for (let i = 0; i < count; i++) {
    const sizeFactor = rng.range(0.88, 1.12);
    comps.push({
      address: `${rng.int(10, 2899)} ${rng.pick(["Elm", "Pine", "Ridge", "Glen", "Park", "Hill", "Creek", "Mill", "Church", "King"])} ${rng.pick(["St", "Ave", "Rd", "Cres"])}`,
      soldDate: new Date(startDate.getTime() - rng.int(15, 170) * 86_400_000).toISOString().slice(0, 10),
      soldPrice: roundPrice(marketValue * sizeFactor * rng.range(0.95, 1.05)),
      beds: property.type === "vacant_land" ? 0 : Math.max(0, property.beds + rng.int(-1, 1)),
      baths: property.type === "vacant_land" ? 0 : Math.max(1, property.baths + rng.pick([-0.5, 0, 0, 0.5])),
      sqft: property.type === "vacant_land" ? 0 : Math.round((property.sqft * sizeFactor) / 10) * 10,
      daysOnMarket: Math.max(1, Math.round(market.avgDaysOnMarket * rng.range(0.4, 1.6))),
      distanceKm: Number(rng.range(0.2, rural ? 12 : 2).toFixed(1)),
      notes: rng.pick(["Similar condition", "Renovated kitchen and baths", "Needed work; sold as-is", "Multiple offers", "Bigger lot", "Busier street", "Held offers; sold over asking", "Two price reductions before selling"]),
    });
  }
  return comps.sort((a, b) => b.soldDate.localeCompare(a.soldDate));
}

function generateFinancingEvents(rng: Rng, buyer: BuyerBrief, property: Property, difficulty: HiddenDifficulty): LoanEvent[] {
  if (buyer.financing === "cash") return [];
  const events: LoanEvent[] = [];
  const chance = { clean: 0.1, typical: 0.35, rough: 0.75 }[difficulty.eventVolatility];
  const pool: Omit<LoanEvent, "id" | "dayOffset">[] = [
    { kind: "income_verification", severity: "nuisance", summary: "The lender wants a job letter, two recent pay stubs and the last two years of Notices of Assessment." },
    { kind: "rate_hold_expiry", severity: "delay", summary: "The buyer's rate hold expires before completion; the lender needs a few extra days to re-qualify at today's rate." },
    { kind: "debt_ratios", severity: "deal_threatening", summary: "The buyer financed a car after pre-approval; their debt service ratios now exceed the stress test." },
  ];
  if (buyer.financing === "insured") pool.push({ kind: "insurer_decline", severity: "deal_threatening", summary: "The mortgage insurer won't approve the file as submitted and wants more down payment." });
  if (isCondo(property.type)) pool.push({ kind: "condo_review", severity: "delay", summary: "The lender is reviewing the condo corporation's reserve fund and insurance before approving." });
  for (const template of pool) if (rng.chance(chance / 2)) events.push({ ...template, id: `l${events.length + 1}`, dayOffset: rng.int(2, 6) });
  if (difficulty.eventVolatility === "rough" && rng.chance(0.15)) {
    events.push({ id: `l${events.length + 1}`, kind: "mortgage_declined", severity: "deal_threatening", dayOffset: rng.int(3, 6), summary: "The lender declines the mortgage. A B lender might approve it at a higher rate with a bigger down payment." });
  }
  return events;
}

function generateTitleIssues(rng: Rng, seller: SellerBrief, property: Property, difficulty: HiddenDifficulty): TitleIssue[] {
  const chance = { clean: 0.05, typical: 0.2, rough: 0.5 }[difficulty.eventVolatility];
  if (!rng.chance(chance)) return [];
  const pool: Omit<TitleIssue, "id">[] = [
    { kind: "work_order", resolvable: true, daysToResolve: rng.int(10, 30), summary: "The municipality has an outstanding work order for an unpermitted deck." },
    { kind: "open_permit", resolvable: true, daysToResolve: rng.int(10, 25), summary: "A building permit for the basement renovation was never closed." },
    { kind: "execution", resolvable: true, daysToResolve: rng.int(3, 10), summary: "A writ of execution is registered against someone with the seller's name; the seller's lawyer needs a statutory declaration to clear it." },
    { kind: "encroachment", resolvable: rng.chance(0.6), daysToResolve: rng.int(10, 40), summary: "The survey shows the garage encroaches onto the neighbour's lot." },
    { kind: "construction_lien", resolvable: true, daysToResolve: rng.int(5, 20), summary: "A contractor registered a construction lien for an unpaid renovation bill." },
  ];
  if (seller.motivation === "estate") pool.push({ kind: "estate_trustee_needed", resolvable: true, daysToResolve: rng.int(30, 75), summary: "The seller's estate hasn't received its Certificate of Appointment of Estate Trustee (probate) yet." });
  if (property.type === "semi_detached" || property.acres !== null) pool.push({ kind: "unregistered_easement", resolvable: true, daysToResolve: rng.int(10, 25), summary: "A shared driveway is used without a registered right-of-way." });
  return [{ ...rng.pick(pool), id: "t1" }];
}

function generateVisitSurprises(rng: Rng, property: Property, difficulty: HiddenDifficulty): Surprise[] {
  if (property.type === "vacant_land") return [];
  const chance = { clean: 0.05, typical: 0.25, rough: 0.55 }[difficulty.eventVolatility];
  if (!rng.chance(chance)) return [];
  const pool = [
    { summary: "The dining room light fixture was removed and replaced with a bare bulb, but fixtures weren't excluded.", costToFix: rng.int(500, 2_500) },
    { summary: "Movers gouged the hardwood floors in the hall and living room.", costToFix: rng.int(1_500, 4_000) },
    { summary: "The included dishwasher has been swapped for an older one.", costToFix: rng.int(700, 1_500) },
    { summary: "The basement is full of the seller's belongings and old paint cans.", costToFix: rng.int(800, 2_000) },
    { summary: "Water stains have appeared on the basement ceiling since the inspection.", costToFix: rng.int(1_500, 6_000) },
  ];
  return [{ ...rng.pick(pool), id: "w1" }];
}

function generateCompetingOffers(rng: Rng, market: Market, property: Property): CompetingOffer[] {
  const chance = { hot: market.offerNightsCommon ? 0.85 : 0.65, balanced: 0.3, cold: 0.08 }[market.temperature];
  if (!rng.chance(chance)) return [];
  const count = market.temperature === "hot" ? rng.int(1, market.offerNightsCommon ? 6 : 3) : 1;
  const offers: CompetingOffer[] = [];
  for (let i = 0; i < count; i++) {
    const strength = rng.weighted<CompetingOffer["strength"]>([["weak", 0.35], ["comparable", 0.45], ["strong", 0.2]]);
    const factor = { weak: rng.range(0.94, 0.99), comparable: rng.range(0.99, 1.04), strong: rng.range(1.04, 1.12) }[strength];
    offers.push({ arrivesDay: rng.int(0, 4), phase: rng.chance(0.85) ? "pre_contract" : "under_contract", strength, price: roundPrice(property.listPrice * factor) });
  }
  return offers;
}

function generateClientEvents(rng: Rng, difficulty: HiddenDifficulty, botSide: "buyer" | "seller"): ClientEvent[] {
  if (difficulty.clientVolatility === "steady") return [];
  const pool =
    botSide === "seller"
      ? [
          { phase: "negotiation", summary: "Seller decides the dining room chandelier is a family heirloom and wants it excluded." },
          { phase: "conditional", summary: "Seller is offended by the request after the inspection and threatens to relist." },
          { phase: "completion", summary: "Seller asks to push completion back five days because their own purchase closing moved." },
          { phase: "negotiation", summary: "Seller's spouse wants $10,000 more than what was agreed in principle." },
        ]
      : [
          { phase: "negotiation", summary: "Buyer's parents, who are gifting part of the down payment, want them to offer less." },
          { phase: "conditional", summary: "Buyer gets cold feet after the inspection and wants a much bigger price reduction." },
          { phase: "completion", summary: "Buyer wants to move completion up a week to avoid paying another month's rent." },
          { phase: "negotiation", summary: "Buyer has seen another listing and wants to slow down this negotiation." },
        ];
  return rng.sample(pool, difficulty.clientVolatility === "erratic" ? 2 : 1).map((e) => ({ side: botSide, phase: e.phase as ClientEvent["phase"], summary: e.summary }));
}

export interface GroundTruthInput {
  rng: Rng;
  market: Market;
  property: Property;
  marketValue: number;
  seller: SellerBrief;
  buyer: BuyerBrief;
  difficulty: HiddenDifficulty;
  botSide: "buyer" | "seller";
  findings: { inspectionFindings: Finding[]; typeSpecificIssues: Finding[] };
}

export function generateGroundTruth(input: GroundTruthInput): GroundTruth {
  const { rng, market, property, marketValue, seller, buyer, difficulty } = input;
  // Appraisers lag hot markets, so the supportable value sits a little under true value there.
  const marketBias = { hot: -0.025, balanced: 0, cold: 0.005 }[market.temperature];
  const spread = { clean: 0.012, typical: 0.022, rough: 0.032 }[difficulty.eventVolatility];
  const appraisedValue = roundPrice(marketValue * rng.normal(1 + marketBias + (difficulty.eventVolatility === "rough" ? -0.015 : 0), spread));
  return {
    marketValue,
    appraisedValue,
    inspectionFindings: input.findings.inspectionFindings,
    typeSpecificIssues: input.findings.typeSpecificIssues,
    financing: generateFinancingEvents(rng, buyer, property, difficulty),
    titleIssues: generateTitleIssues(rng, seller, property, difficulty),
    visitSurprises: generateVisitSurprises(rng, property, difficulty),
    competingOffers: generateCompetingOffers(rng, market, property),
    clientEvents: generateClientEvents(rng, difficulty, input.botSide),
  };
}
