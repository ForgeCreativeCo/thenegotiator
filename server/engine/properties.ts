import type { Hoa, Market, Property, PropertyType, TypeSpecificTerm, Unit } from "./types";
import { Rng, listingPrice, roundPrice } from "./rng";
import { zipFor } from "./markets";

interface TypeProfile {
  label: string;
  /** Price relative to the area's median single-family price. */
  priceFactor: [number, number];
  beds: [number, number];
  sqftPerBed: [number, number];
  lotAcres: [number, number];
  yearBuilt: [number, number];
  /** How likely this type is in each metro type. 0 = never. */
  weight: Record<Market["metroType"], number>;
  hoa: "none" | "optional" | "required";
  terms: TypeSpecificTerm[];
}

export const PROPERTY_TYPES: Record<PropertyType, TypeProfile> = {
  single_family: {
    label: "Single-family home",
    priceFactor: [0.75, 1.6],
    beds: [2, 5],
    sqftPerBed: [420, 700],
    lotAcres: [0.1, 0.5],
    yearBuilt: [1925, 2021],
    weight: { urban: 3, suburban: 6, rural: 3 },
    hoa: "optional",
    terms: [],
  },
  condo: {
    label: "Condominium",
    priceFactor: [0.45, 1.1],
    beds: [1, 3],
    sqftPerBed: [380, 600],
    lotAcres: [0, 0],
    yearBuilt: [1965, 2022],
    weight: { urban: 4, suburban: 2, rural: 0 },
    hoa: "required",
    terms: [
      { key: "hoa_doc_review", label: "HOA document review", description: "Days the buyer has to review the declaration, budget, minutes and reserve study, and cancel if unsatisfied." },
      { key: "special_assessment", label: "Special assessments", description: "Who pays any assessment levied before or after closing." },
      { key: "condo_questionnaire", label: "Lender condo questionnaire", description: "Whether the project meets the buyer's loan program (e.g. FHA approval)." },
    ],
  },
  townhouse: {
    label: "Townhouse",
    priceFactor: [0.6, 1.2],
    beds: [2, 4],
    sqftPerBed: [400, 600],
    lotAcres: [0.02, 0.08],
    yearBuilt: [1975, 2023],
    weight: { urban: 3, suburban: 4, rural: 0 },
    hoa: "required",
    terms: [
      { key: "hoa_doc_review", label: "HOA document review", description: "Days to review the HOA documents and cancel if unsatisfied." },
      { key: "shared_components", label: "Shared walls and roof", description: "Who is responsible for shared roof, wall and party-wall repairs." },
    ],
  },
  co_op: {
    label: "Co-op apartment",
    priceFactor: [0.4, 0.9],
    beds: [1, 3],
    sqftPerBed: [400, 550],
    lotAcres: [0, 0],
    yearBuilt: [1925, 1975],
    weight: { urban: 1.5, suburban: 0, rural: 0 },
    hoa: "required",
    terms: [
      { key: "board_approval", label: "Board approval", description: "The co-op board must approve the buyer after a financial review and interview. The deal is contingent on it." },
      { key: "flip_tax", label: "Flip tax", description: "Transfer fee charged by the co-op; who pays it is negotiable." },
      { key: "financing_limit", label: "Maximum financing", description: "The building caps how much the buyer can finance." },
    ],
  },
  multifamily: {
    label: "Multifamily (2–4 units)",
    priceFactor: [0.9, 1.8],
    beds: [4, 10],
    sqftPerBed: [350, 480],
    lotAcres: [0.08, 0.3],
    yearBuilt: [1900, 1995],
    weight: { urban: 3, suburban: 1.5, rural: 0.3 },
    hoa: "none",
    terms: [
      { key: "rent_roll", label: "Rent roll and leases", description: "Seller provides current leases and a rent roll for buyer review." },
      { key: "estoppels", label: "Tenant estoppels", description: "Signed tenant statements confirming rent, deposits and lease terms." },
      { key: "security_deposits", label: "Security deposit transfer", description: "Tenant deposits credited to the buyer at closing." },
      { key: "delivery_vacancy", label: "Unit delivered vacant", description: "Whether any unit must be vacant at closing (e.g. for an owner-occupant)." },
    ],
  },
  manufactured: {
    label: "Manufactured home",
    priceFactor: [0.25, 0.55],
    beds: [2, 4],
    sqftPerBed: [350, 500],
    lotAcres: [0.15, 2],
    yearBuilt: [1985, 2022],
    weight: { urban: 0, suburban: 1, rural: 3 },
    hoa: "none",
    terms: [
      { key: "foundation_cert", label: "Foundation certification", description: "Engineer's certification that the foundation meets lender requirements." },
      { key: "title_status", label: "Real vs. personal property", description: "Whether the home is titled with the land as real property, which affects financing." },
    ],
  },
  new_construction: {
    label: "New construction",
    priceFactor: [1.0, 1.5],
    beds: [3, 5],
    sqftPerBed: [480, 700],
    lotAcres: [0.12, 0.35],
    yearBuilt: [2026, 2027],
    weight: { urban: 0.5, suburban: 3, rural: 1 },
    hoa: "required",
    terms: [
      { key: "completion_date", label: "Completion date", description: "Builder's estimated completion; what happens if it slips." },
      { key: "upgrades", label: "Upgrades and options", description: "Which design-center upgrades are included in the price." },
      { key: "builder_incentive", label: "Builder incentive", description: "Closing-cost or rate buydown incentive, often tied to the builder's preferred lender." },
      { key: "builder_warranty", label: "Builder warranty", description: "1-2-10 style workmanship, systems and structural warranty." },
    ],
  },
  rural_acreage: {
    label: "Home on acreage",
    priceFactor: [0.9, 1.9],
    beds: [2, 5],
    sqftPerBed: [450, 750],
    lotAcres: [2, 40],
    yearBuilt: [1940, 2020],
    weight: { urban: 0, suburban: 0.7, rural: 5 },
    hoa: "none",
    terms: [
      { key: "well_septic", label: "Well and septic inspections", description: "Water potability, flow rate, and septic system inspections." },
      { key: "survey", label: "Survey", description: "Boundary survey to confirm acreage, fences and easements." },
      { key: "outbuildings", label: "Outbuildings and equipment", description: "Barns, shops, and any equipment or livestock that convey." },
    ],
  },
  land: {
    label: "Residential lot or land",
    priceFactor: [0.12, 0.45],
    beds: [0, 0],
    sqftPerBed: [0, 0],
    lotAcres: [0.25, 20],
    yearBuilt: [0, 0],
    weight: { urban: 0.3, suburban: 1, rural: 3 },
    hoa: "optional",
    terms: [
      { key: "feasibility", label: "Feasibility period", description: "Time to confirm the buyer can build what they want: zoning, setbacks, permits." },
      { key: "perc_test", label: "Perc test", description: "Soil test that determines whether a septic system can be permitted." },
      { key: "utilities", label: "Utility access", description: "Cost and availability of power, water, and road access." },
    ],
  },
};

const STREET_NAMES = [
  "Maple", "Oak", "Cedar", "Willow", "Juniper", "Hawthorne", "Sycamore", "Magnolia", "Aspen", "Birch",
  "Ridgeview", "Lakeshore", "Meadowlark", "Briarwood", "Foxglove", "Stonegate", "Kestrel", "Laurel",
  "Harbor", "Summit", "Prairie", "Riverbend", "Canyon", "Orchard", "Whitmore", "Ashford", "Kingsley",
];
const STREET_SUFFIXES = ["St", "Ave", "Ln", "Dr", "Ct", "Way", "Rd", "Pl", "Trail", "Circle"];

function streetAddress(rng: Rng, type: PropertyType): string {
  const number = rng.int(100, 9899);
  const street = `${rng.pick(STREET_NAMES)} ${rng.pick(STREET_SUFFIXES)}`;
  if (type === "condo" || type === "co_op") return `${number} ${street}, Unit ${rng.int(1, 18)}${rng.pick(["A", "B", "C", "D", "F", "G"])}`;
  if (type === "rural_acreage" || type === "land") return `${rng.int(1000, 48999)} ${rng.pick(["County Road", "Ranch Rd", "Old Mill Rd", "Hollow Rd"])} ${rng.int(2, 499)}`;
  return `${number} ${street}`;
}

function pickType(rng: Rng, market: Market): PropertyType {
  const entries = (Object.keys(PROPERTY_TYPES) as PropertyType[])
    .map((type) => [type, PROPERTY_TYPES[type].weight[market.metroType]] as const)
    .filter(([, weight]) => weight > 0);
  return rng.weighted(entries);
}

function generateHoa(rng: Rng, type: PropertyType, value: number): Hoa {
  const base = type === "co_op" ? value * 0.0022 : type === "condo" ? value * 0.0011 : rng.range(40, 180);
  return {
    monthlyDues: Math.round(base / 5) * 5,
    includes:
      type === "co_op"
        ? ["property taxes", "heat", "water", "building insurance", "maintenance"]
        : type === "condo"
          ? rng.sample(["water/sewer", "trash", "exterior insurance", "landscaping", "pool", "fitness center", "reserves"], 4)
          : ["common areas", "landscaping"],
    reserveFundStatus: rng.weighted([
      ["strong", 0.35],
      ["adequate", 0.45],
      ["underfunded", 0.2],
    ]),
    rentalCap: type === "condo" || type === "co_op" ? rng.chance(0.4) : false,
    fhaApproved: type === "condo" ? rng.chance(0.45) : null,
  };
}

function generateUnits(rng: Rng, totalBeds: number, market: Market): Unit[] {
  const count = totalBeds >= 8 ? rng.int(3, 4) : 2;
  const rentPerBed = market.medianPrice * rng.range(0.0022, 0.0032);
  const units: Unit[] = [];
  let remaining = totalBeds;
  for (let i = 0; i < count; i++) {
    const beds = i === count - 1 ? Math.max(1, remaining) : Math.max(1, Math.round(totalBeds / count));
    remaining -= beds;
    const vacant = rng.chance(0.2);
    units.push({
      label: count === 2 ? (i === 0 ? "Lower" : "Upper") : `Unit ${i + 1}`,
      beds,
      baths: 1,
      monthlyRent: vacant ? null : Math.round((rentPerBed * beds * rng.range(0.85, 1.05)) / 25) * 25,
      leaseEnds: vacant ? null : rng.pick(["month-to-month", "2027-01-31", "2027-05-31", "2027-08-31"]),
    });
  }
  return units;
}

function typeExtras(rng: Rng, type: PropertyType, value: number): Record<string, string | number | boolean> {
  switch (type) {
    case "co_op":
      return { flipTaxPct: rng.pick([0, 1, 2, 2, 3]), maxFinancingPct: rng.pick([75, 80, 80, 90]), boardInterviewRequired: true, sublettingAllowed: rng.chance(0.3) };
    case "manufactured":
      return { titledAsRealProperty: rng.chance(0.65), lotRentMonthly: rng.chance(0.3) ? rng.int(350, 750) : 0, make: rng.pick(["Clayton", "Champion", "Palm Harbor", "Fleetwood", "Cavco"]), singleOrDouble: rng.pick(["single-wide", "double-wide", "double-wide", "triple-wide"]) };
    case "new_construction":
      return { builder: rng.pick(["Hartwell Homes", "Brookstone Builders", "Crestline Communities", "Pinecrest Homes"]), estimatedCompletion: rng.pick(["2026-12-15", "2027-01-30", "2027-03-15"]), percentComplete: rng.pick([20, 40, 60, 85, 100]), includedUpgrades: roundPrice(value * rng.range(0.01, 0.04)), builderIncentive: roundPrice(value * rng.range(0.005, 0.02)), preferredLenderRequiredForIncentive: true };
    case "rural_acreage":
      return { outbuildings: rng.pick(["40x60 shop", "barn and run-in shed", "detached garage and greenhouse", "none"]), fenced: rng.chance(0.6), agExemption: rng.chance(0.35), roadMaintenance: rng.pick(["county", "private road agreement", "shared easement"]) };
    case "land":
      return { zoning: rng.pick(["R-1 residential", "agricultural/residential", "rural residential"]), utilitiesAtRoad: rng.pick(["power only", "power and water", "none"]), percTested: rng.chance(0.3), roadFrontageFt: rng.int(80, 900) };
    case "multifamily":
      return { separateMeters: rng.chance(0.6), coinLaundry: rng.chance(0.4) };
    default:
      return {};
  }
}

const FEATURES = [
  "updated kitchen", "quartz counters", "original hardwood floors", "finished basement", "screened porch",
  "fenced backyard", "vaulted ceilings", "primary suite on main", "solar panels (owned)", "solar panels (leased)",
  "new windows", "fireplace", "walk-in pantry", "mature trees", "covered patio", "pool", "home office",
  "mudroom", "EV charger", "mountain views", "walkable to downtown", "corner lot",
];

export interface PropertyResult {
  property: Property;
  marketValue: number;
}

export function generateProperty(rng: Rng, market: Market, startDate: Date): PropertyResult {
  const type = pickType(rng, market);
  const profile = PROPERTY_TYPES[type];
  const isLand = type === "land";

  const beds = isLand ? 0 : rng.int(profile.beds[0], profile.beds[1]);
  const sqft = isLand ? 0 : Math.round((beds * rng.range(profile.sqftPerBed[0], profile.sqftPerBed[1]) + rng.range(0, 400)) / 10) * 10;
  const yearBuilt = isLand ? 0 : rng.int(profile.yearBuilt[0], profile.yearBuilt[1]);
  const age = isLand ? 0 : startDate.getFullYear() - yearBuilt;
  const condition = (type === "new_construction" ? 5 : rng.weighted([[1, 0.08], [2, 0.2], [3, 0.37], [4, 0.25], [5, 0.1]])) as Property["condition"];

  const conditionFactor = { 1: 0.78, 2: 0.9, 3: 1, 4: 1.07, 5: 1.14 }[condition];
  const metroFactor = market.metroType === "urban" ? 1.05 : 1;
  const marketValue = roundPrice(market.medianPrice * rng.range(profile.priceFactor[0], profile.priceFactor[1]) * conditionFactor * metroFactor);

  // Pricing strategy: in hot markets some sellers underprice to draw multiple offers; in cold markets many overprice.
  const strategy = rng.weighted<"under" | "at" | "over" | "way_over">(
    market.temperature === "hot"
      ? [["under", 0.3], ["at", 0.45], ["over", 0.2], ["way_over", 0.05]]
      : market.temperature === "balanced"
        ? [["under", 0.08], ["at", 0.5], ["over", 0.32], ["way_over", 0.1]]
        : [["under", 0.03], ["at", 0.35], ["over", 0.4], ["way_over", 0.22]],
  );
  const pricingFactor = { under: rng.range(0.94, 0.98), at: rng.range(0.99, 1.03), over: rng.range(1.04, 1.09), way_over: rng.range(1.1, 1.18) }[strategy];

  const daysOnMarket = Math.max(0, Math.round(market.avgDaysOnMarket * rng.range(0.2, strategy === "way_over" || strategy === "over" ? 2.6 : 1.3)));
  let listPrice = listingPrice(marketValue * pricingFactor);
  const priceHistory: Property["priceHistory"] = [];
  const listedOn = new Date(startDate.getTime() - daysOnMarket * 86_400_000);
  const originalListPrice = daysOnMarket > 30 && pricingFactor > 1.03 ? listingPrice(listPrice * rng.range(1.03, 1.07)) : listPrice;
  priceHistory.push({ date: isoDate(listedOn), event: "Listed", price: originalListPrice });
  if (originalListPrice !== listPrice) {
    const reducedOn = new Date(listedOn.getTime() + Math.round(daysOnMarket * rng.range(0.4, 0.8)) * 86_400_000);
    priceHistory.push({ date: isoDate(reducedOn), event: "Price reduced", price: listPrice });
  }
  if (type !== "new_construction" && rng.chance(0.5)) {
    const yearsAgo = rng.int(3, 22);
    priceHistory.unshift({
      date: `${startDate.getFullYear() - yearsAgo}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
      event: "Sold",
      price: roundPrice(marketValue * Math.pow(0.955, yearsAgo) * rng.range(0.9, 1.05)),
    });
  }
  listPrice = Math.max(listPrice, 1000);

  const hoa = profile.hoa === "required" || (profile.hoa === "optional" && rng.chance(market.metroType === "suburban" ? 0.4 : 0.15)) ? generateHoa(rng, type, marketValue) : null;
  const rural = type === "rural_acreage" || type === "land" || (type === "manufactured" && market.metroType === "rural");

  const property: Property = {
    type,
    address: { street: streetAddress(rng, type), city: market.city, stateCode: market.stateCode, zip: zipFor(market, rng) },
    beds,
    baths: isLand ? 0 : Math.max(1, Math.round((beds * rng.range(0.55, 0.85)) * 2) / 2),
    sqft,
    lotAcres: Number(rng.range(profile.lotAcres[0], profile.lotAcres[1]).toFixed(2)),
    yearBuilt,
    condition,
    stories: isLand ? 0 : type === "condo" || type === "co_op" || type === "manufactured" ? 1 : rng.int(1, type === "townhouse" ? 3 : 2),
    garage: isLand ? "none" : type === "condo" || type === "co_op" ? rng.pick(["assigned space", "deeded garage space", "street parking"]) : rng.pick(["1-car attached", "2-car attached", "2-car detached", "carport", "3-car attached"]),
    heating: isLand ? "n/a" : age > 50 ? rng.pick(["gas boiler (radiators)", "oil furnace", "gas forced air"]) : rng.pick(["gas forced air", "heat pump", "electric baseboard"]),
    cooling: isLand ? "n/a" : rng.pick(["central air", "central air", "heat pump", "window units", "mini-splits"]),
    water: rural && rng.chance(0.75) ? "well" : "public",
    sewer: rural && rng.chance(0.8) ? "septic" : "public",
    features: isLand ? [] : rng.sample(FEATURES, rng.int(3, 6)),
    hoa,
    units: type === "multifamily" ? generateUnits(rng, beds, market) : null,
    annualTaxes: roundPrice(marketValue * rng.range(0.006, 0.022)),
    listPrice,
    originalListPrice,
    daysOnMarket,
    priceHistory,
    extras: typeExtras(rng, type, marketValue),
  };

  return { property, marketValue };
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return isoDate(new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * 86_400_000));
}
