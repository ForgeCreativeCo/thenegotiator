import type { CondoInfo, Market, Property, PropertyType, RegionKind, RentalItem, TypeSpecificTerm, Unit } from "./types";
import { Rng, listingPrice, roundPrice } from "./rng";
import { postalCodeFor } from "./markets";

interface TypeProfile {
  label: string;
  /** Price relative to the region's detached benchmark. */
  priceFactor: [number, number];
  beds: [number, number];
  sqftPerBed: [number, number];
  yearBuilt: [number, number];
  styles: string[];
  weight: Record<RegionKind, number>;
  terms: TypeSpecificTerm[];
}

export const PROPERTY_TYPES: Record<PropertyType, TypeProfile> = {
  detached: {
    label: "Detached house",
    priceFactor: [0.8, 1.25],
    beds: [2, 5],
    sqftPerBed: [400, 650],
    yearBuilt: [1910, 2020],
    styles: ["2-storey", "bungalow", "backsplit", "sidesplit", "1.5-storey"],
    weight: { toronto: 3, gta: 5, city: 6, small_city: 6, cottage: 2, north: 6 },
    terms: [],
  },
  semi_detached: {
    label: "Semi-detached house",
    priceFactor: [0.72, 0.88],
    beds: [2, 4],
    sqftPerBed: [380, 520],
    yearBuilt: [1905, 2015],
    styles: ["2-storey", "bungalow", "backsplit"],
    weight: { toronto: 3, gta: 3, city: 2, small_city: 1, cottage: 0, north: 1 },
    terms: [{ key: "mutual_drive", label: "Shared wall and mutual drive", description: "Acknowledges the party wall and any shared driveway or drain rights-of-way registered on title." }],
  },
  freehold_townhouse: {
    label: "Freehold townhouse",
    priceFactor: [0.65, 0.82],
    beds: [2, 4],
    sqftPerBed: [400, 550],
    yearBuilt: [1975, 2022],
    styles: ["2-storey", "3-storey"],
    weight: { toronto: 1, gta: 4, city: 3, small_city: 2, cottage: 0, north: 0.5 },
    terms: [{ key: "potl", label: "Common elements (POTL)", description: "Whether the town is on a parcel of tied land with a common elements fee, and the buyer's review of the condo documents for it." }],
  },
  condo_townhouse: {
    label: "Condo townhouse",
    priceFactor: [0.55, 0.72],
    beds: [2, 4],
    sqftPerBed: [380, 500],
    yearBuilt: [1972, 2020],
    styles: ["2-storey", "3-storey", "stacked"],
    weight: { toronto: 1.5, gta: 2, city: 2, small_city: 1, cottage: 0, north: 0.3 },
    terms: [{ key: "parking_locker", label: "Parking and locker", description: "Which parking spaces and lockers are included, and whether they're owned units or exclusive use." }],
  },
  condo_apartment: {
    label: "Condo apartment",
    priceFactor: [0.38, 0.65],
    beds: [0, 3],
    sqftPerBed: [400, 600],
    yearBuilt: [1970, 2024],
    styles: ["apartment"],
    weight: { toronto: 6, gta: 3, city: 2.5, small_city: 1, cottage: 0.3, north: 0.5 },
    terms: [{ key: "parking_locker", label: "Parking and locker", description: "Which parking spaces and lockers are included, and whether they're owned units or exclusive use." }],
  },
  multiplex: {
    label: "Duplex or triplex",
    priceFactor: [1.0, 1.35],
    beds: [4, 8],
    sqftPerBed: [330, 450],
    yearBuilt: [1900, 1985],
    styles: ["2-storey", "2.5-storey"],
    weight: { toronto: 1.5, gta: 0.7, city: 2, small_city: 1, cottage: 0, north: 1 },
    terms: [
      { key: "tenancies", label: "Tenancies", description: "Buyer assumes the existing tenancies, or the seller delivers a unit vacant. Under the Residential Tenancies Act only a purchaser who will live there can give an N12 notice." },
      { key: "rent_deposits", label: "Last month's rent deposits", description: "Tenants' last month's rent deposits and interest credited to the buyer on completion." },
      { key: "legal_units", label: "Legal units", description: "Whether the seller makes any warranty that the units are legal or legally non-conforming." },
    ],
  },
  cottage: {
    label: "Cottage or waterfront",
    priceFactor: [0.7, 2.2],
    beds: [2, 5],
    sqftPerBed: [300, 500],
    yearBuilt: [1950, 2018],
    styles: ["bungalow", "1.5-storey", "A-frame", "2-storey"],
    weight: { toronto: 0, gta: 0, city: 0, small_city: 0.5, cottage: 7, north: 1.5 },
    terms: [
      { key: "waterfront_chattels", label: "Dock, boats and contents", description: "Which waterfront and recreational items convey: dock, boat lift, boats, furniture." },
      { key: "shore_road", label: "Shore road allowance", description: "Whether the shore road allowance in front of the property has been closed and purchased." },
      { key: "road_access", label: "Road access", description: "Year-round municipal road, or a private or seasonal road with a road association." },
    ],
  },
  rural_acreage: {
    label: "Rural acreage",
    priceFactor: [0.8, 1.6],
    beds: [2, 5],
    sqftPerBed: [400, 650],
    yearBuilt: [1880, 2018],
    styles: ["2-storey", "bungalow", "farmhouse"],
    weight: { toronto: 0, gta: 0, city: 0.5, small_city: 1.5, cottage: 2, north: 2 },
    terms: [
      { key: "survey", label: "Survey", description: "Whether the seller provides an existing survey, or the buyer orders a new one." },
      { key: "outbuildings", label: "Outbuildings and equipment", description: "Barns, shops and any equipment that convey." },
    ],
  },
  vacant_land: {
    label: "Vacant land",
    priceFactor: [0.12, 0.45],
    beds: [0, 0],
    sqftPerBed: [0, 0],
    yearBuilt: [0, 0],
    styles: ["vacant land"],
    weight: { toronto: 0, gta: 0.2, city: 0.4, small_city: 1, cottage: 1.5, north: 1.5 },
    terms: [
      { key: "due_diligence", label: "Due diligence", description: "Buyer's review of zoning, building permits, conservation authority rules, and septic permit feasibility." },
      { key: "survey", label: "Survey", description: "Whether the seller provides an existing survey, or the buyer orders a new one." },
    ],
  },
  new_construction: {
    label: "New construction (freehold)",
    priceFactor: [1.0, 1.3],
    beds: [3, 5],
    sqftPerBed: [450, 650],
    yearBuilt: [2026, 2027],
    styles: ["2-storey", "bungalow"],
    weight: { toronto: 0, gta: 2, city: 1.5, small_city: 1.5, cottage: 0.5, north: 0.3 },
    terms: [
      { key: "tarion", label: "Tarion warranty and closing dates", description: "Tarion enrolment, firm or tentative closing date, and delayed-closing compensation under the Tarion addendum." },
      { key: "upgrades", label: "Upgrades", description: "Which design-centre upgrades are included in the price." },
      { key: "hst", label: "HST", description: "HST included in the price, with the new-housing rebate assigned to the builder." },
    ],
  },
  land_lease_home: {
    label: "Home in a land-lease community",
    priceFactor: [0.18, 0.35],
    beds: [2, 3],
    sqftPerBed: [350, 480],
    yearBuilt: [1985, 2022],
    styles: ["bungalow"],
    weight: { toronto: 0, gta: 0, city: 0, small_city: 0.5, cottage: 1, north: 0.5 },
    terms: [
      { key: "park_approval", label: "Park approval", description: "The community operator must approve the buyer and assign or issue a new land lease." },
      { key: "land_lease_fee", label: "Land lease fee", description: "The monthly land lease fee and what it covers." },
    ],
  },
  co_op: {
    label: "Co-op apartment",
    priceFactor: [0.35, 0.55],
    beds: [1, 3],
    sqftPerBed: [400, 550],
    yearBuilt: [1925, 1975],
    styles: ["apartment"],
    weight: { toronto: 0.4, gta: 0, city: 0, small_city: 0, cottage: 0, north: 0 },
    terms: [{ key: "board_approval", label: "Board approval", description: "The co-op board must approve the buyer after a financial review and interview; the buyer is buying shares, not land." }],
  },
};

const CONDO_TYPES = new Set<PropertyType>(["condo_apartment", "condo_townhouse"]);
const RURAL_TYPES = new Set<PropertyType>(["cottage", "rural_acreage", "vacant_land"]);

export function isCondo(type: PropertyType): boolean {
  return CONDO_TYPES.has(type);
}

export function isRural(type: PropertyType): boolean {
  return RURAL_TYPES.has(type);
}

const STREETS = [
  "Maple", "Oak", "Cedar", "Willow", "Birch", "Sumach", "Glenwood", "Bloor", "Danforth", "Pape", "Lakeshore", "Kingsway",
  "Elgin", "Wellington", "Queen", "Victoria", "Albert", "Colborne", "Dundas", "Brock", "Simcoe", "Huron", "Erie", "Ontario",
  "Thornhill", "Cumberland", "Sherbourne", "Ashdale", "Glebeholme", "Riverdale", "Hillcrest", "Woodbine",
];
const SUFFIXES = ["St", "Ave", "Rd", "Dr", "Cres", "Blvd", "Crt", "Way", "Gate", "Lane"];

function streetAddress(rng: Rng, type: PropertyType): string {
  const n = rng.int(10, 2899);
  if (type === "condo_apartment" || type === "co_op") return `${rng.int(10, 3500)} ${rng.pick(STREETS)} ${rng.pick(SUFFIXES)}, Unit ${rng.int(2, 38)}${String(rng.int(1, 18)).padStart(2, "0")}`;
  if (type === "condo_townhouse") return `${rng.int(1, 120)}-${n} ${rng.pick(STREETS)} ${rng.pick(SUFFIXES)}`;
  if (type === "cottage") return `${rng.int(1000, 3999)} ${rng.pick(["Lake of Bays", "Kennisis Lake", "Gull Lake", "Clear Lake", "Sparrow Lake", "Lake Joseph"])} Rd`;
  if (type === "rural_acreage" || type === "vacant_land") return `${rng.int(1000, 9999)} Concession ${rng.int(2, 14)}`;
  if (type === "land_lease_home") return `${rng.int(1, 240)} ${rng.pick(["Pine Ridge", "Sandy Shores", "Maple Grove", "Riverview"])} Park Lane`;
  return `${n} ${rng.pick(STREETS)} ${rng.pick(SUFFIXES)}`;
}

function pickType(rng: Rng, market: Market): PropertyType {
  const entries = (Object.keys(PROPERTY_TYPES) as PropertyType[]).map((t) => [t, PROPERTY_TYPES[t].weight[market.regionKind]] as const).filter(([, w]) => w > 0);
  return rng.weighted(entries);
}

function generateCondo(rng: Rng, market: Market, type: PropertyType, value: number, sqft: number): CondoInfo {
  const prefix = market.municipality === "Toronto" ? "TSCC" : market.municipality === "Ottawa" ? "OCSCC" : rng.pick(["PSCC", "YRSCC", "WCC", "DSCC", "HCC"]);
  const perSqft = rng.range(0.55, 1.0) * (type === "condo_townhouse" ? 0.8 : 1);
  return {
    corporation: `${prefix} ${rng.int(100, 2999)}`,
    monthlyFees: Math.round((sqft * perSqft) / 5) * 5,
    includes: rng.sample(["heat", "water", "hydro", "building insurance", "common elements", "parking", "cable and internet"], rng.int(3, 5)),
    reserveFundStatus: rng.weighted([["strong", 0.35], ["adequate", 0.45], ["underfunded", 0.2]]),
    parking: type === "condo_townhouse" ? "exclusive_use" : rng.weighted([["owned", 0.45], ["exclusive_use", 0.3], ["none", value < 600_000 ? 0.4 : 0.15]]),
    locker: rng.chance(0.6),
    petRestrictions: rng.chance(0.3),
    shortTermRentalBan: rng.chance(0.7),
  };
}

function generateUnits(rng: Rng, totalBeds: number, market: Market, startYear: number): Unit[] {
  const count = totalBeds >= 6 ? 3 : 2;
  const rentPerBed = market.benchmarkPrice * rng.range(0.0011, 0.0016);
  const units: Unit[] = [];
  let remaining = totalBeds;
  for (let i = 0; i < count; i++) {
    const beds = i === count - 1 ? Math.max(1, remaining) : Math.max(1, Math.round(totalBeds / count));
    remaining -= beds;
    const tenancy = i === 0 && rng.chance(0.3) ? "owner" : rng.weighted<Unit["tenancy"]>([["month_to_month", 0.5], ["fixed_term", 0.3], ["vacant", 0.2]]);
    const since = startYear - rng.int(0, 14);
    // Long-term tenants under rent control pay well below market.
    const discount = tenancy === "month_to_month" ? Math.max(0.55, 1 - (startYear - since) * 0.04) : 1;
    units.push({
      label: count === 2 ? (i === 0 ? "Main floor" : "Upper") : ["Lower", "Main floor", "Upper"][i],
      beds,
      baths: 1,
      monthlyRent: tenancy === "vacant" || tenancy === "owner" ? null : Math.round((rentPerBed * beds * discount) / 25) * 25,
      tenancy,
      tenantSince: tenancy === "vacant" || tenancy === "owner" ? null : `${since}`,
    });
  }
  return units;
}

function generateRentalItems(rng: Rng, type: PropertyType): RentalItem[] {
  if (type === "vacant_land" || type === "condo_apartment" || type === "co_op") return [];
  const items: RentalItem[] = [];
  if (rng.chance(0.5)) items.push({ item: "Hot water tank", monthly: rng.int(28, 48), buyoutCost: roundPrice(rng.range(1_200, 3_200)) });
  if (rng.chance(0.15)) items.push({ item: "Furnace and air conditioner", monthly: rng.int(95, 170), buyoutCost: roundPrice(rng.range(6_000, 13_000)) });
  if (rng.chance(0.12)) items.push({ item: "Water softener", monthly: rng.int(25, 45), buyoutCost: roundPrice(rng.range(800, 2_000)) });
  return items;
}

function typeExtras(rng: Rng, type: PropertyType, value: number): Record<string, string | number | boolean> {
  switch (type) {
    case "new_construction":
      return { builder: rng.pick(["Hartwell Homes", "Brookstone Builders", "Crestline Communities", "Pinecrest Homes"]), closingDateType: rng.pick(["firm", "tentative"]), percentComplete: rng.pick([60, 85, 100]), includedUpgrades: roundPrice(value * rng.range(0.01, 0.04)), tarionEnrolled: true };
    case "cottage":
      return { waterfrontFt: rng.int(80, 400), exposure: rng.pick(["west (sunsets)", "south", "east", "north"]), roadAccess: rng.pick(["year-round municipal", "year-round private", "seasonal private"]), shoreRoadAllowanceClosed: rng.chance(0.55), dock: rng.pick(["crib dock", "floating dock", "none"]) };
    case "rural_acreage":
      return { outbuildings: rng.pick(["detached shop", "bank barn", "drive shed", "none"]), zoning: rng.pick(["Rural (RU)", "Agricultural (A1)"]), fenced: rng.chance(0.6) };
    case "vacant_land":
      return { zoning: rng.pick(["Rural Residential (RR)", "Rural (RU)", "Waterfront Residential (WR)"]), hydroAtRoad: rng.chance(0.6), roadFrontageFt: rng.int(150, 900), conservationAuthority: rng.chance(0.5) };
    case "land_lease_home":
      return { landLeaseFeeMonthly: rng.int(550, 900), communityAgeRestriction: rng.chance(0.6) ? "55+" : "none" };
    case "co_op":
      return { maintenanceIncludesTaxes: true, maxFinancingPct: rng.pick([50, 65, 75]) };
    case "multiplex":
      return { separateHydroMeters: rng.chance(0.6), fireCodeRetrofit: rng.chance(0.5) };
    default:
      return {};
  }
}

const FEATURES = [
  "updated kitchen", "quartz counters", "original hardwood", "finished basement", "separate side entrance", "landscaped backyard",
  "deck", "gas fireplace", "primary ensuite", "walk to subway", "steps to the GO station", "near top-rated schools", "detached garage",
  "private drive", "mature trees", "renovated bathrooms", "pot lights", "central vacuum", "EV charger", "solar panels",
];

export interface PropertyResult {
  property: Property;
  marketValue: number;
}

export function generateProperty(rng: Rng, market: Market, startDate: Date): PropertyResult {
  const type = pickType(rng, market);
  const profile = PROPERTY_TYPES[type];
  const isLand = type === "vacant_land";
  const startYear = startDate.getUTCFullYear();

  const beds = isLand ? 0 : rng.int(profile.beds[0], profile.beds[1]);
  const sqft = isLand ? 0 : Math.round((Math.max(1, beds) * rng.range(profile.sqftPerBed[0], profile.sqftPerBed[1]) + rng.range(0, 300)) / 10) * 10;
  const yearBuilt = isLand ? 0 : rng.int(profile.yearBuilt[0], profile.yearBuilt[1]);
  const condition = (type === "new_construction" ? 5 : rng.weighted([[1, 0.08], [2, 0.2], [3, 0.37], [4, 0.25], [5, 0.1]])) as Property["condition"];
  const conditionFactor = { 1: 0.8, 2: 0.9, 3: 1, 4: 1.07, 5: 1.13 }[condition];
  const marketValue = roundPrice(market.benchmarkPrice * rng.range(profile.priceFactor[0], profile.priceFactor[1]) * conditionFactor);

  // In hot Ontario markets many sellers list low to hold an offer night; in cold markets many overprice.
  const strategy = rng.weighted<"under" | "at" | "over" | "way_over">(
    market.temperature === "hot"
      ? [["under", market.offerNightsCommon ? 0.45 : 0.25], ["at", 0.35], ["over", 0.15], ["way_over", 0.05]]
      : market.temperature === "balanced"
        ? [["under", 0.08], ["at", 0.5], ["over", 0.32], ["way_over", 0.1]]
        : [["under", 0.03], ["at", 0.35], ["over", 0.4], ["way_over", 0.22]],
  );
  const pricingFactor = { under: rng.range(0.85, 0.95), at: rng.range(0.99, 1.03), over: rng.range(1.04, 1.09), way_over: rng.range(1.1, 1.18) }[strategy];
  const daysOnMarket = Math.max(0, Math.round(market.avgDaysOnMarket * rng.range(0.2, strategy === "over" || strategy === "way_over" ? 2.6 : 1.3)));
  const listPrice = listingPrice(marketValue * pricingFactor);
  const listedOn = new Date(startDate.getTime() - daysOnMarket * 86_400_000);
  const originalListPrice = daysOnMarket > 30 && pricingFactor > 1.03 ? listingPrice(listPrice * rng.range(1.03, 1.07)) : listPrice;
  const priceHistory: Property["priceHistory"] = [];
  if (type !== "new_construction" && rng.chance(0.5)) {
    const yearsAgo = rng.int(3, 22);
    priceHistory.push({ date: `${startYear - yearsAgo}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`, event: "Sold", price: roundPrice(marketValue * Math.pow(0.95, yearsAgo) * rng.range(0.9, 1.05)) });
  }
  priceHistory.push({ date: isoDate(listedOn), event: "Listed", price: originalListPrice });
  if (originalListPrice !== listPrice) priceHistory.push({ date: isoDate(new Date(listedOn.getTime() + Math.round(daysOnMarket * rng.range(0.4, 0.8)) * 86_400_000)), event: "Price changed", price: listPrice });

  const rural = isRural(type) || type === "land_lease_home";
  const condo = isCondo(type) ? generateCondo(rng, market, type, marketValue, sqft) : null;
  const lot =
    type === "condo_apartment" || type === "co_op" || type === "condo_townhouse"
      ? { front: null, depth: null, acres: null }
      : type === "cottage" || type === "rural_acreage" || type === "vacant_land"
        ? { front: null, depth: null, acres: Number(rng.range(type === "rural_acreage" ? 2 : 0.5, type === "rural_acreage" ? 50 : 5).toFixed(1)) }
        : type === "land_lease_home"
          ? { front: null, depth: null, acres: null }
          : { front: type === "freehold_townhouse" ? rng.int(18, 25) : type === "semi_detached" ? rng.int(20, 30) : rng.int(30, 60), depth: rng.int(95, 150), acres: null };

  const age = isLand ? 0 : startYear - yearBuilt;
  const property: Property = {
    type,
    address: { street: streetAddress(rng, type), municipality: market.municipality, province: "ON", postalCode: postalCodeFor(market, rng) },
    style: rng.pick(profile.styles),
    beds,
    baths: isLand ? 0 : type === "multiplex" ? (beds >= 6 ? 3 : 2) + rng.pick([0, 0, 0.5]) : Math.max(1, Math.round(Math.max(1, beds) * rng.range(0.5, 0.85) * 2) / 2),
    sqft,
    lotFrontageFt: lot.front,
    lotDepthFt: lot.depth,
    acres: lot.acres,
    yearBuilt,
    condition,
    basement: isLand || type === "condo_apartment" || type === "co_op" ? "none" : type === "multiplex" ? "apartment" : rng.weighted([["finished", 0.5], ["unfinished", 0.3], ["apartment", 0.1], ["none", 0.1]]),
    parking: isLand ? "none" : condo ? (condo.parking === "none" ? "No parking" : `1 space (${condo.parking === "owned" ? "owned" : "exclusive use"})`) : rng.pick(["Private drive, 2 spaces", "Mutual drive, 1 space", "Attached garage, 2 spaces", "Detached garage, 1 space", "Street permit parking"]),
    heating: isLand ? "n/a" : age > 70 && rng.chance(0.3) ? rng.pick(["Hot water radiators, gas", "Forced air, oil"]) : rng.pick(["Forced air, gas", "Forced air, gas", "Heat pump", "Baseboard, electric"]),
    cooling: isLand ? "n/a" : rng.pick(["Central air", "Central air", "Ductless mini-splits", "Window units", "None"]),
    water: rural ? (type === "cottage" && rng.chance(0.4) ? "lake" : "well") : "municipal",
    sewer: rural ? "septic" : "municipal",
    features: isLand ? [] : rng.sample(FEATURES, rng.int(3, 6)),
    condo,
    potlFee: type === "freehold_townhouse" && rng.chance(0.4) ? rng.int(90, 260) : null,
    units: type === "multiplex" ? generateUnits(rng, beds, market, startYear) : null,
    rentalItems: generateRentalItems(rng, type),
    annualTaxes: roundPrice(marketValue * (market.torontoMltt ? rng.range(0.006, 0.0075) : rng.range(0.008, 0.014))),
    listPrice,
    originalListPrice,
    daysOnMarket,
    priceHistory,
    spisProvided: rural ? rng.chance(0.6) : rng.chance(0.25),
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

/** Adds banking days (Monday to Friday; statutory holidays are ignored in this simulation). */
export function addBankingDays(iso: string, days: number): string {
  let date = iso;
  let added = 0;
  while (added < days) {
    date = addDays(date, 1);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return date;
}
