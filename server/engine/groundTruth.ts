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

interface FindingTemplate {
  system: string;
  title: string;
  severity: Severity;
  cost: [number, number];
  minAge?: number;
  types?: PropertyType[]; // limits to these types; omitted = any building
  requires?: (p: Property) => boolean;
  detectableBy?: Finding["detectableBy"];
}

const FINDINGS: FindingTemplate[] = [
  { system: "Roof", title: "Roof covering near end of life; several lifted and cracked shingles", severity: "major", cost: [9_000, 22_000], minAge: 18 },
  { system: "Roof", title: "Active leak at chimney flashing with stained decking in attic", severity: "moderate", cost: [800, 3_500], minAge: 10 },
  { system: "HVAC", title: "Furnace heat exchanger shows cracking; carbon monoxide risk", severity: "safety", cost: [4_500, 9_000], minAge: 15 },
  { system: "HVAC", title: "AC condenser is 19+ years old and short-cycling", severity: "moderate", cost: [4_000, 8_500], minAge: 15 },
  { system: "Plumbing", title: "Polybutylene supply lines throughout", severity: "major", cost: [6_000, 14_000], minAge: 28, requires: (p) => p.yearBuilt >= 1978 && p.yearBuilt <= 1995 },
  { system: "Plumbing", title: "Water heater past expected life, no expansion tank", severity: "minor", cost: [1_400, 2_600], minAge: 8 },
  { system: "Plumbing", title: "Cast-iron drain stack cracked; sewer gas odor in basement", severity: "moderate", cost: [2_500, 7_000], minAge: 45 },
  { system: "Sewer", title: "Sewer scope shows root intrusion and a belly in the lateral line", severity: "major", cost: [6_000, 18_000], minAge: 30, requires: (p) => p.sewer === "public", detectableBy: "specialist" },
  { system: "Electrical", title: "Federal Pacific Stab-Lok panel", severity: "safety", cost: [2_200, 4_500], minAge: 35, requires: (p) => p.yearBuilt >= 1955 && p.yearBuilt <= 1990 },
  { system: "Electrical", title: "Ungrounded two-prong outlets and some knob-and-tube wiring", severity: "safety", cost: [5_000, 15_000], minAge: 70 },
  { system: "Electrical", title: "Missing GFCI protection in kitchen and baths; double-tapped breakers", severity: "minor", cost: [350, 1_200] },
  { system: "Structure", title: "Stair-step cracking in foundation wall with signs of movement", severity: "major", cost: [8_000, 35_000], minAge: 20, detectableBy: "specialist" },
  { system: "Structure", title: "Sagging floor joists over crawlspace; prior DIY sistering", severity: "moderate", cost: [3_000, 9_000], minAge: 35 },
  { system: "Moisture", title: "Efflorescence and active water intrusion in basement corner", severity: "moderate", cost: [3_500, 12_000], minAge: 15 },
  { system: "Moisture", title: "Mold growth on attic sheathing from bathroom fans venting into attic", severity: "moderate", cost: [2_500, 6_500], minAge: 5 },
  { system: "Environmental", title: "Radon test result 7.8 pCi/L (action level is 4.0)", severity: "moderate", cost: [1_200, 2_500], detectableBy: "specialist" },
  { system: "Environmental", title: "Suspected asbestos wrap on old heating ducts", severity: "moderate", cost: [1_500, 5_000], minAge: 45 },
  { system: "Pests", title: "Active subterranean termite activity with damage to sill plate", severity: "major", cost: [2_500, 12_000], detectableBy: "specialist" },
  { system: "Exterior", title: "Wood rot at window sills and trim; failing caulk", severity: "minor", cost: [800, 4_000], minAge: 10 },
  { system: "Exterior", title: "Deck ledger not flashed or properly bolted", severity: "safety", cost: [1_500, 6_000], minAge: 8 },
  { system: "Interior", title: "Several windows with failed seals (fogging)", severity: "minor", cost: [600, 3_000], minAge: 12 },
  { system: "Permits", title: "Finished basement and added bathroom done without permits", severity: "moderate", cost: [2_000, 10_000], minAge: 10 },
  { system: "Well", title: "Well water tests positive for coliform bacteria", severity: "moderate", cost: [800, 3_500], requires: (p) => p.water === "well", detectableBy: "specialist" },
  { system: "Well", title: "Well pump flow rate marginal (3 gpm)", severity: "moderate", cost: [1_500, 8_000], requires: (p) => p.water === "well", detectableBy: "specialist" },
  { system: "Septic", title: "Septic drain field saturated; system failing", severity: "major", cost: [12_000, 35_000], minAge: 20, requires: (p) => p.sewer === "septic", detectableBy: "specialist" },
  { system: "Septic", title: "Septic tank overdue for pumping; cracked baffle", severity: "minor", cost: [600, 1_800], requires: (p) => p.sewer === "septic", detectableBy: "specialist" },
  { system: "Solar", title: "Leased solar panels with 14 years remaining; buyer must qualify to assume the lease", severity: "moderate", cost: [0, 0], requires: (p) => p.features.includes("solar panels (leased)") },
  { system: "Pool", title: "Pool pump failing and plaster etched", severity: "moderate", cost: [3_000, 9_000], minAge: 8, requires: (p) => p.features.includes("pool") },
];

const TYPE_ISSUES: Partial<Record<PropertyType, FindingTemplate[]>> = {
  condo: [
    { system: "HOA", title: "Board minutes discuss a pending special assessment for balcony and facade repairs", severity: "major", cost: [8_000, 30_000] },
    { system: "HOA", title: "Reserve study shows the association is about 35% funded", severity: "moderate", cost: [0, 0] },
    { system: "HOA", title: "Building has pending litigation against the original developer", severity: "major", cost: [0, 0] },
  ],
  townhouse: [{ system: "HOA", title: "Shared roof section due for replacement; cost split among three owners", severity: "moderate", cost: [4_000, 9_000] }],
  co_op: [
    { system: "Co-op", title: "Building's underlying mortgage refinances next year at a higher rate; maintenance may rise", severity: "moderate", cost: [0, 0] },
    { system: "Co-op", title: "Local Law facade inspection found unsafe conditions; assessment likely", severity: "major", cost: [6_000, 20_000] },
  ],
  multifamily: [
    { system: "Leases", title: "Upper unit's actual rent is $150/month less than the rent roll shows", severity: "moderate", cost: [0, 0] },
    { system: "Leases", title: "One tenant's security deposit is not accounted for", severity: "minor", cost: [1_000, 2_500] },
    { system: "Code", title: "Third unit lacks a certificate of occupancy as a legal dwelling", severity: "major", cost: [5_000, 25_000] },
  ],
  manufactured: [
    { system: "Foundation", title: "Foundation does not meet HUD permanent foundation guide; engineer cert will fail", severity: "major", cost: [4_000, 12_000] },
    { system: "Title", title: "Manufacturer's title was never retired; home is still personal property", severity: "moderate", cost: [500, 2_000] },
  ],
  new_construction: [
    { system: "Builder", title: "Completion date slips 6 to 10 weeks due to cabinet and window backorders", severity: "moderate", cost: [0, 0] },
    { system: "Builder", title: "Final grading slopes toward the foundation on one side", severity: "moderate", cost: [1_500, 4_000] },
  ],
  rural_acreage: [
    { system: "Survey", title: "Neighbor's fence and shed sit 30 feet inside the property line", severity: "moderate", cost: [0, 5_000] },
    { system: "Access", title: "No recorded easement for the shared gravel drive", severity: "major", cost: [2_000, 8_000] },
  ],
  land: [
    { system: "Soil", title: "Perc test fails at the planned site; engineered septic required", severity: "major", cost: [15_000, 40_000] },
    { system: "Utilities", title: "Power is 1,800 feet away; utility quotes a line extension", severity: "major", cost: [18_000, 45_000] },
    { system: "Zoning", title: "Setbacks and a wetland buffer shrink the buildable area by half", severity: "moderate", cost: [0, 0] },
  ],
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
    detectableBy: t.detectableBy ?? "general_inspection",
  };
}

export function generateFindings(rng: Rng, property: Property, difficulty: HiddenDifficulty, startYear: number) {
  findingCounter = 0;
  const age = property.yearBuilt ? startYear - property.yearBuilt : 0;
  const isBuilding = property.type !== "land";

  const eligible = isBuilding
    ? FINDINGS.filter((t) => (t.minAge ?? 0) <= age && (!t.requires || t.requires(property)) && property.type !== "new_construction")
    : [];
  const baseCount = { 1: 6, 2: 4, 3: 3, 4: 2, 5: 1 }[property.condition];
  const volatilityBonus = { clean: -2, typical: 0, rough: 2 }[difficulty.eventVolatility];
  const count = Math.max(0, Math.min(eligible.length, baseCount + volatilityBonus + rng.int(-1, 1)));

  // In a "clean" scenario skip the costliest findings so the house really is clean.
  const pool = difficulty.eventVolatility === "clean" ? eligible.filter((t) => t.severity !== "major") : eligible;
  const inspectionFindings = rng.sample(pool, count).map((t) => toFinding(rng, t, rng.chance(0.3)));

  const typePool = TYPE_ISSUES[property.type] ?? [];
  const typeChance = { clean: 0.15, typical: 0.45, rough: 0.8 }[difficulty.eventVolatility];
  const typeSpecificIssues = typePool.length && rng.chance(typeChance) ? rng.sample(typePool, rng.int(1, difficulty.eventVolatility === "rough" ? 2 : 1)).map((t) => toFinding(rng, t, rng.chance(0.15))) : [];

  return { inspectionFindings, typeSpecificIssues };
}

/** The seller's disclosure form: everything disclosed, plus routine items. */
export function buildDisclosures(market: Market, property: Property, findings: Finding[]): Disclosure[] {
  if (market.customs.disclosure === "caveat_emptor") {
    return [{ item: "Disclosure regime", detail: `${market.state} is largely a buyer-beware state. The seller has provided limited disclosures and sells as-is with respect to defects not actively concealed.` }]
      .concat(findings.filter((f) => f.disclosed).map((f) => ({ item: f.system, detail: f.title })));
  }
  const disclosures: Disclosure[] = findings.filter((f) => f.disclosed).map((f) => ({ item: f.system, detail: f.title }));
  if (property.yearBuilt && property.yearBuilt < 1978) disclosures.push({ item: "Lead-based paint", detail: "Home built before 1978; seller has no reports of lead-based paint hazards. Lead disclosure addendum required." });
  if (property.features.includes("solar panels (leased)")) disclosures.push({ item: "Solar", detail: "Solar panels are leased; lease transfer required." });
  if (property.hoa) disclosures.push({ item: "HOA", detail: `Dues are $${property.hoa.monthlyDues}/month. Resale certificate available on request.` });
  if (disclosures.length === 0) disclosures.push({ item: "General", detail: "Seller is not aware of any material defects." });
  return disclosures;
}

export function generateComps(rng: Rng, property: Property, marketValue: number, market: Market, startDate: Date): Comp[] {
  const count = rng.int(3, 5);
  const comps: Comp[] = [];
  for (let i = 0; i < count; i++) {
    const sizeFactor = rng.range(0.88, 1.12);
    const price = roundPrice(marketValue * sizeFactor * rng.range(0.95, 1.05));
    const daysAgo = rng.int(15, 170);
    comps.push({
      address: `${rng.int(100, 9899)} ${rng.pick(["Elm", "Pine", "Ridge", "Valley", "Park", "Hill", "Creek", "Mill"])} ${rng.pick(["St", "Ave", "Dr", "Ln"])}`,
      soldDate: new Date(startDate.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10),
      soldPrice: price,
      beds: property.type === "land" ? 0 : Math.max(1, property.beds + rng.int(-1, 1)),
      baths: property.type === "land" ? 0 : Math.max(1, property.baths + rng.pick([-0.5, 0, 0, 0.5])),
      sqft: property.type === "land" ? 0 : Math.round((property.sqft * sizeFactor) / 10) * 10,
      daysOnMarket: Math.max(1, Math.round(market.avgDaysOnMarket * rng.range(0.4, 1.6))),
      distanceMiles: Number(rng.range(0.1, property.type === "rural_acreage" || property.type === "land" ? 6 : 1.2).toFixed(1)),
      notes: rng.pick(["Similar condition", "Updated kitchen and baths", "Needed work; sold as-is", "Multiple offers", "Larger lot", "Busier street", "Seller paid closing costs", "Price reduced twice before selling"]),
    });
  }
  return comps.sort((a, b) => b.soldDate.localeCompare(a.soldDate));
}

function generateFinancingEvents(rng: Rng, buyer: BuyerBrief, property: Property, difficulty: HiddenDifficulty): LoanEvent[] {
  if (buyer.loanType === "cash") return [];
  const events: LoanEvent[] = [];
  const chance = { clean: 0.1, typical: 0.35, rough: 0.75 }[difficulty.eventVolatility];
  const pool: Omit<LoanEvent, "id" | "dayOffset">[] = [
    { kind: "underwriting_condition", severity: "nuisance", summary: "Underwriter asks for a letter of explanation on a large deposit and two more months of bank statements." },
    { kind: "rate_lock_expiry", severity: "delay", summary: "Rate lock expires before the scheduled closing; extending it costs about 0.25% of the loan." },
    { kind: "dti_issue", severity: "deal_threatening", summary: "Buyer financed a car after pre-approval; debt-to-income ratio now exceeds the program limit." },
    { kind: "employment_change", severity: "deal_threatening", summary: "Buyer's employer announces a restructuring; lender requires a fresh verification of employment." },
  ];
  if (property.type === "condo" && (buyer.loanType === "fha" || buyer.loanType === "va")) {
    pool.push({ kind: "condo_project_review", severity: "deal_threatening", summary: "Condo project is not on the approved list for the buyer's loan program; a single-unit approval is needed." });
  }
  for (const template of pool) {
    if (rng.chance(chance / 2)) events.push({ ...template, id: `l${events.length + 1}`, dayOffset: rng.int(7, 28) });
  }
  if (difficulty.eventVolatility === "rough" && rng.chance(0.15)) {
    events.push({ id: `l${events.length + 1}`, kind: "loan_denial", severity: "deal_threatening", dayOffset: rng.int(20, 30), summary: "Underwriting denies the loan as structured. Buyer may qualify with a larger down payment or a different program." });
  }
  return events;
}

function generateTitleIssues(rng: Rng, seller: SellerBrief, property: Property, difficulty: HiddenDifficulty): TitleIssue[] {
  const chance = { clean: 0.05, typical: 0.2, rough: 0.5 }[difficulty.eventVolatility];
  if (!rng.chance(chance)) return [];
  const pool: Omit<TitleIssue, "id">[] = [
    { kind: "unreleased_lien", resolvable: true, daysToResolve: rng.int(5, 20), summary: "A mortgage paid off in a prior refinance was never released of record." },
    { kind: "judgment_lien", resolvable: true, daysToResolve: rng.int(7, 25), summary: "A contractor's judgment lien against the seller must be paid from proceeds." },
    { kind: "boundary_encroachment", resolvable: rng.chance(0.7), daysToResolve: rng.int(10, 40), summary: "Survey shows the driveway crosses onto the neighbor's lot." },
  ];
  if (seller.motivation === "estate") pool.push({ kind: "missing_heir", resolvable: true, daysToResolve: rng.int(20, 60), summary: "One heir has not signed the deed; probate court approval is needed." });
  if (property.hoa) pool.push({ kind: "hoa_lien", resolvable: true, daysToResolve: rng.int(3, 10), summary: "HOA has a lien for unpaid dues and late fees." });
  if (property.lotAcres > 1) pool.push({ kind: "easement", resolvable: true, daysToResolve: rng.int(5, 15), summary: "An unrecorded utility easement crosses the back of the property." });
  return [{ ...rng.pick(pool), id: "t1" }];
}

function generateWalkthroughSurprises(rng: Rng, property: Property, difficulty: HiddenDifficulty): Surprise[] {
  if (property.type === "land") return [];
  const chance = { clean: 0.05, typical: 0.25, rough: 0.55 }[difficulty.eventVolatility];
  if (!rng.chance(chance)) return [];
  const pool = [
    { summary: "Movers gouged the hardwood floors in the hallway and dining room.", costToFix: rng.int(1_500, 4_000) },
    { summary: "Seller took the dining room chandelier, which was not excluded in the contract.", costToFix: rng.int(600, 2_500) },
    { summary: "Agreed repairs were done by the seller's nephew instead of a licensed contractor; no receipts.", costToFix: rng.int(1_000, 6_000) },
    { summary: "Dishwasher leaks and the garage door opener no longer works.", costToFix: rng.int(700, 1_800) },
    { summary: "Seller left a garage and basement full of belongings and old paint cans.", costToFix: rng.int(800, 2_000) },
  ];
  return [{ ...rng.pick(pool), id: "w1" }];
}

function generateCompetingOffers(rng: Rng, market: Market, property: Property): CompetingOffer[] {
  const chance = { hot: 0.75, balanced: 0.3, cold: 0.08 }[market.temperature];
  if (!rng.chance(chance)) return [];
  const offers: CompetingOffer[] = [];
  const count = market.temperature === "hot" ? rng.int(1, 3) : 1;
  for (let i = 0; i < count; i++) {
    const strength = rng.weighted<CompetingOffer["strength"]>([["weak", 0.35], ["comparable", 0.45], ["strong", 0.2]]);
    const factor = { weak: rng.range(0.94, 0.98), comparable: rng.range(0.98, 1.02), strong: rng.range(1.02, 1.07) }[strength];
    offers.push({
      arrivesDay: rng.int(0, 5),
      phase: rng.chance(0.8) ? "pre_contract" : "under_contract",
      strength,
      price: roundPrice(property.listPrice * factor),
    });
  }
  return offers;
}

function generateClientEvents(rng: Rng, difficulty: HiddenDifficulty, botSide: "buyer" | "seller"): ClientEvent[] {
  const events: ClientEvent[] = [];
  if (difficulty.clientVolatility === "steady") return events;
  const pool =
    botSide === "seller"
      ? [
          { phase: "negotiation", summary: "Seller decides overnight that the washer, dryer and garage fridge are not staying after all." },
          { phase: "inspection", summary: "Seller is offended by the repair request and threatens to put the house back on the market." },
          { phase: "closing", summary: "Seller asks for five extra days of possession after closing because the new house isn't ready." },
          { phase: "negotiation", summary: "Seller's spouse wants $5,000 more than what was agreed in principle." },
        ]
      : [
          { phase: "negotiation", summary: "Buyer's parents, who are gifting part of the down payment, want them to offer less." },
          { phase: "inspection", summary: "Buyer gets cold feet after the inspection and wants a much larger credit." },
          { phase: "closing", summary: "Buyer wants to move closing up a week to avoid paying another month's rent." },
          { phase: "negotiation", summary: "Buyer falls for another listing and wants to slow-walk this negotiation." },
        ];
  const count = difficulty.clientVolatility === "erratic" ? 2 : 1;
  for (const event of rng.sample(pool, count)) events.push({ side: botSide, phase: event.phase as ClientEvent["phase"], summary: event.summary });
  return events;
}

export interface GroundTruthInput {
  rng: Rng;
  market: Market;
  property: Property;
  marketValue: number;
  seller: SellerBrief;
  buyer: BuyerBrief;
  difficulty: HiddenDifficulty;
  startDate: string;
  botSide: "buyer" | "seller";
  findings: { inspectionFindings: Finding[]; typeSpecificIssues: Finding[] };
}

export function generateGroundTruth(input: GroundTruthInput): GroundTruth {
  const { rng, market, property, marketValue, seller, buyer, difficulty } = input;
  // Appraisers lag hot markets, so appraisals land a bit under value there.
  const marketBias = { hot: -0.025, balanced: 0, cold: 0.005 }[market.temperature];
  const volatilitySpread = { clean: 0.012, typical: 0.022, rough: 0.032 }[difficulty.eventVolatility];
  const appraisedValue = roundPrice(marketValue * rng.normal(1 + marketBias + (difficulty.eventVolatility === "rough" ? -0.015 : 0), volatilitySpread));

  return {
    marketValue,
    appraisedValue,
    inspectionFindings: input.findings.inspectionFindings,
    typeSpecificIssues: input.findings.typeSpecificIssues,
    financing: generateFinancingEvents(rng, buyer, property, difficulty),
    titleIssues: generateTitleIssues(rng, seller, property, difficulty),
    walkthroughSurprises: generateWalkthroughSurprises(rng, property, difficulty),
    competingOffers: generateCompetingOffers(rng, market, property),
    clientEvents: generateClientEvents(rng, difficulty, input.botSide),
  };
}
