import type { Market, MarketTemperature, RegionKind } from "./types";
import { Rng } from "./rng";

interface Region {
  region: string;
  municipality: string;
  kind: RegionKind;
  /** Illustrative 2026 benchmark for a detached home, CAD. */
  benchmark: number;
  weight: number;
  fsas: string[]; // postal code forward sortation areas
  depositPct: number;
}

// Weighted toward the GTA, with regular Ottawa, Southwestern Ontario, cottage country and the North.
const REGIONS: Region[] = [
  { region: "Toronto (East York)", municipality: "Toronto", kind: "toronto", benchmark: 1_350_000, weight: 4, fsas: ["M4C", "M4G", "M4J"], depositPct: 5 },
  { region: "Toronto (Etobicoke)", municipality: "Toronto", kind: "toronto", benchmark: 1_300_000, weight: 3, fsas: ["M8V", "M9A", "M8Y"], depositPct: 5 },
  { region: "Toronto (Scarborough)", municipality: "Toronto", kind: "toronto", benchmark: 1_150_000, weight: 3, fsas: ["M1E", "M1K", "M1P"], depositPct: 5 },
  { region: "Toronto (Downtown)", municipality: "Toronto", kind: "toronto", benchmark: 1_700_000, weight: 3, fsas: ["M5A", "M5V", "M6J"], depositPct: 5 },
  { region: "Toronto (North York)", municipality: "Toronto", kind: "toronto", benchmark: 1_600_000, weight: 3, fsas: ["M2N", "M3B", "M2M"], depositPct: 5 },
  { region: "Mississauga", municipality: "Mississauga", kind: "gta", benchmark: 1_250_000, weight: 3, fsas: ["L5B", "L5M", "L4Z"], depositPct: 5 },
  { region: "Brampton", municipality: "Brampton", kind: "gta", benchmark: 1_050_000, weight: 3, fsas: ["L6P", "L6R", "L7A"], depositPct: 5 },
  { region: "Oakville", municipality: "Oakville", kind: "gta", benchmark: 1_600_000, weight: 2, fsas: ["L6H", "L6J", "L6M"], depositPct: 5 },
  { region: "Vaughan", municipality: "Vaughan", kind: "gta", benchmark: 1_450_000, weight: 2, fsas: ["L4H", "L4J", "L6A"], depositPct: 5 },
  { region: "Markham", municipality: "Markham", kind: "gta", benchmark: 1_450_000, weight: 2, fsas: ["L3P", "L6B", "L6C"], depositPct: 5 },
  { region: "Richmond Hill", municipality: "Richmond Hill", kind: "gta", benchmark: 1_500_000, weight: 1.5, fsas: ["L4B", "L4C", "L4S"], depositPct: 5 },
  { region: "Durham (Whitby)", municipality: "Whitby", kind: "gta", benchmark: 900_000, weight: 2, fsas: ["L1M", "L1N", "L1R"], depositPct: 4 },
  { region: "Durham (Oshawa)", municipality: "Oshawa", kind: "gta", benchmark: 780_000, weight: 2, fsas: ["L1G", "L1H", "L1K"], depositPct: 4 },
  { region: "Hamilton", municipality: "Hamilton", kind: "city", benchmark: 800_000, weight: 2.5, fsas: ["L8L", "L8M", "L9A"], depositPct: 3 },
  { region: "Burlington", municipality: "Burlington", kind: "gta", benchmark: 1_150_000, weight: 1.5, fsas: ["L7L", "L7M", "L7R"], depositPct: 5 },
  { region: "Kitchener-Waterloo", municipality: "Kitchener", kind: "city", benchmark: 780_000, weight: 2, fsas: ["N2H", "N2L", "N2M"], depositPct: 3 },
  { region: "Guelph", municipality: "Guelph", kind: "city", benchmark: 850_000, weight: 1, fsas: ["N1E", "N1G", "N1H"], depositPct: 3 },
  { region: "Ottawa", municipality: "Ottawa", kind: "city", benchmark: 720_000, weight: 3, fsas: ["K1S", "K2G", "K1V"], depositPct: 3 },
  { region: "London", municipality: "London", kind: "city", benchmark: 620_000, weight: 2, fsas: ["N5V", "N6C", "N6G"], depositPct: 3 },
  { region: "Windsor", municipality: "Windsor", kind: "city", benchmark: 560_000, weight: 1.5, fsas: ["N8W", "N9A", "N9G"], depositPct: 3 },
  { region: "Niagara (St. Catharines)", municipality: "St. Catharines", kind: "small_city", benchmark: 650_000, weight: 1.5, fsas: ["L2M", "L2N", "L2T"], depositPct: 3 },
  { region: "Barrie", municipality: "Barrie", kind: "small_city", benchmark: 800_000, weight: 1.5, fsas: ["L4M", "L4N"], depositPct: 3 },
  { region: "Kingston", municipality: "Kingston", kind: "small_city", benchmark: 620_000, weight: 1, fsas: ["K7K", "K7L", "K7M"], depositPct: 3 },
  { region: "Peterborough", municipality: "Peterborough", kind: "small_city", benchmark: 650_000, weight: 1, fsas: ["K9H", "K9J", "K9K"], depositPct: 3 },
  { region: "Prince Edward County", municipality: "Picton", kind: "cottage", benchmark: 750_000, weight: 0.7, fsas: ["K0K"], depositPct: 3 },
  { region: "Muskoka", municipality: "Bracebridge", kind: "cottage", benchmark: 1_000_000, weight: 1, fsas: ["P1L", "P1H", "P0B"], depositPct: 3 },
  { region: "Haliburton", municipality: "Minden Hills", kind: "cottage", benchmark: 800_000, weight: 0.6, fsas: ["K0M"], depositPct: 3 },
  { region: "Collingwood and Blue Mountains", municipality: "Collingwood", kind: "cottage", benchmark: 950_000, weight: 0.7, fsas: ["L9Y"], depositPct: 3 },
  { region: "Greater Sudbury", municipality: "Sudbury", kind: "north", benchmark: 450_000, weight: 0.8, fsas: ["P3A", "P3E", "P3N"], depositPct: 2 },
  { region: "Thunder Bay", municipality: "Thunder Bay", kind: "north", benchmark: 380_000, weight: 0.6, fsas: ["P7A", "P7B", "P7C"], depositPct: 2 },
  { region: "Sault Ste. Marie", municipality: "Sault Ste. Marie", kind: "north", benchmark: 320_000, weight: 0.4, fsas: ["P6A", "P6B", "P6C"], depositPct: 2 },
  { region: "North Bay", municipality: "North Bay", kind: "north", benchmark: 450_000, weight: 0.4, fsas: ["P1A", "P1B", "P1C"], depositPct: 2 },
];

const TEMPERATURE_STATS: Record<MarketTemperature, { dom: [number, number]; ratio: [number, number]; inventory: [number, number] }> = {
  hot: { dom: [5, 14], ratio: [1.01, 1.08], inventory: [0.8, 2] },
  balanced: { dom: [18, 35], ratio: [0.975, 1.005], inventory: [3, 5] },
  cold: { dom: [40, 90], ratio: [0.93, 0.97], inventory: [5.5, 9] },
};

export function generateMarket(rng: Rng): Market {
  const region = rng.weighted(REGIONS.map((r) => [r, r.weight] as const));
  const temperature = rng.weighted<MarketTemperature>([
    ["hot", region.kind === "toronto" || region.kind === "gta" ? 0.35 : 0.25],
    ["balanced", 0.4],
    ["cold", region.kind === "north" ? 0.4 : 0.25],
  ]);
  const stats = TEMPERATURE_STATS[temperature];
  return {
    region: region.region,
    municipality: region.municipality,
    regionKind: region.kind,
    temperature,
    benchmarkPrice: region.benchmark,
    avgDaysOnMarket: rng.int(stats.dom[0], stats.dom[1]),
    listToSaleRatio: Number(rng.range(stats.ratio[0], stats.ratio[1]).toFixed(3)),
    monthsOfInventory: Number(rng.range(stats.inventory[0], stats.inventory[1]).toFixed(1)),
    mortgageRate: Number(rng.range(3.9, 5.4).toFixed(2)),
    torontoMltt: region.municipality === "Toronto",
    typicalDepositPct: temperature === "hot" ? Math.max(region.depositPct, 5) : region.depositPct,
    offerNightsCommon: temperature === "hot" && (region.kind === "toronto" || region.kind === "gta" || region.kind === "city"),
  };
}

const LETTERS = "ABCEGHJKLMNPRSTVWXYZ";

export function postalCodeFor(market: Market, rng: Rng): string {
  const region = REGIONS.find((r) => r.region === market.region);
  const fsa = rng.pick(region?.fsas ?? ["M4C"]);
  return `${fsa} ${rng.int(1, 9)}${rng.pick(LETTERS.split(""))}${rng.int(0, 9)}`;
}
