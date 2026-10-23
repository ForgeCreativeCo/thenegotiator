import type { ClosingCustom, Market, MarketTemperature, MetroType } from "./types";
import { Rng } from "./rng";

interface Region {
  city: string;
  state: string;
  stateCode: string;
  metroType: MetroType;
  medianPrice: number;
  zipPrefix: string;
  closing: ClosingCustom;
  optionPeriod?: boolean;
  caveatEmptor?: boolean;
  transferTaxPct: number;
  whoPaysTransferTax: "seller" | "buyer" | "split";
}

// Fictionalized but plausible regional price levels and closing customs.
const REGIONS: Region[] = [
  { city: "Austin", state: "Texas", stateCode: "TX", metroType: "urban", medianPrice: 520_000, zipPrefix: "787", closing: "title_company", optionPeriod: true, transferTaxPct: 0, whoPaysTransferTax: "seller" },
  { city: "New Braunfels", state: "Texas", stateCode: "TX", metroType: "suburban", medianPrice: 390_000, zipPrefix: "781", closing: "title_company", optionPeriod: true, transferTaxPct: 0, whoPaysTransferTax: "seller" },
  { city: "Phoenix", state: "Arizona", stateCode: "AZ", metroType: "urban", medianPrice: 450_000, zipPrefix: "850", closing: "escrow", transferTaxPct: 0, whoPaysTransferTax: "split" },
  { city: "Prescott", state: "Arizona", stateCode: "AZ", metroType: "rural", medianPrice: 560_000, zipPrefix: "863", closing: "escrow", transferTaxPct: 0, whoPaysTransferTax: "split" },
  { city: "Sacramento", state: "California", stateCode: "CA", metroType: "suburban", medianPrice: 560_000, zipPrefix: "958", closing: "escrow", transferTaxPct: 0.11, whoPaysTransferTax: "seller" },
  { city: "San Diego", state: "California", stateCode: "CA", metroType: "urban", medianPrice: 950_000, zipPrefix: "921", closing: "escrow", transferTaxPct: 0.11, whoPaysTransferTax: "seller" },
  { city: "Boise", state: "Idaho", stateCode: "ID", metroType: "suburban", medianPrice: 500_000, zipPrefix: "837", closing: "title_company", transferTaxPct: 0, whoPaysTransferTax: "seller" },
  { city: "Denver", state: "Colorado", stateCode: "CO", metroType: "urban", medianPrice: 610_000, zipPrefix: "802", closing: "title_company", transferTaxPct: 0.01, whoPaysTransferTax: "buyer" },
  { city: "Bend", state: "Oregon", stateCode: "OR", metroType: "suburban", medianPrice: 720_000, zipPrefix: "977", closing: "escrow", transferTaxPct: 0, whoPaysTransferTax: "split" },
  { city: "Spokane", state: "Washington", stateCode: "WA", metroType: "suburban", medianPrice: 420_000, zipPrefix: "992", closing: "escrow", transferTaxPct: 1.28, whoPaysTransferTax: "seller" },
  { city: "Minneapolis", state: "Minnesota", stateCode: "MN", metroType: "urban", medianPrice: 340_000, zipPrefix: "554", closing: "title_company", transferTaxPct: 0.33, whoPaysTransferTax: "seller" },
  { city: "Columbus", state: "Ohio", stateCode: "OH", metroType: "suburban", medianPrice: 300_000, zipPrefix: "432", closing: "title_company", transferTaxPct: 0.4, whoPaysTransferTax: "seller" },
  { city: "Indianapolis", state: "Indiana", stateCode: "IN", metroType: "suburban", medianPrice: 280_000, zipPrefix: "462", closing: "title_company", transferTaxPct: 0, whoPaysTransferTax: "seller" },
  { city: "Kansas City", state: "Missouri", stateCode: "MO", metroType: "urban", medianPrice: 290_000, zipPrefix: "641", closing: "title_company", caveatEmptor: true, transferTaxPct: 0, whoPaysTransferTax: "seller" },
  { city: "Nashville", state: "Tennessee", stateCode: "TN", metroType: "urban", medianPrice: 470_000, zipPrefix: "372", closing: "title_company", transferTaxPct: 0.37, whoPaysTransferTax: "buyer" },
  { city: "Huntsville", state: "Alabama", stateCode: "AL", metroType: "suburban", medianPrice: 330_000, zipPrefix: "358", closing: "title_company", caveatEmptor: true, transferTaxPct: 0.1, whoPaysTransferTax: "buyer" },
  { city: "Atlanta", state: "Georgia", stateCode: "GA", metroType: "urban", medianPrice: 420_000, zipPrefix: "303", closing: "attorney", optionPeriod: true, transferTaxPct: 0.1, whoPaysTransferTax: "seller" },
  { city: "Charleston", state: "South Carolina", stateCode: "SC", metroType: "suburban", medianPrice: 540_000, zipPrefix: "294", closing: "attorney", transferTaxPct: 0.37, whoPaysTransferTax: "seller" },
  { city: "Asheville", state: "North Carolina", stateCode: "NC", metroType: "rural", medianPrice: 480_000, zipPrefix: "288", closing: "attorney", optionPeriod: true, transferTaxPct: 0.2, whoPaysTransferTax: "seller" },
  { city: "Tampa", state: "Florida", stateCode: "FL", metroType: "urban", medianPrice: 420_000, zipPrefix: "336", closing: "title_company", transferTaxPct: 0.7, whoPaysTransferTax: "seller" },
  { city: "Ocala", state: "Florida", stateCode: "FL", metroType: "rural", medianPrice: 310_000, zipPrefix: "344", closing: "title_company", transferTaxPct: 0.7, whoPaysTransferTax: "seller" },
  { city: "Richmond", state: "Virginia", stateCode: "VA", metroType: "suburban", medianPrice: 400_000, zipPrefix: "232", closing: "attorney", caveatEmptor: true, transferTaxPct: 0.33, whoPaysTransferTax: "split" },
  { city: "Philadelphia", state: "Pennsylvania", stateCode: "PA", metroType: "urban", medianPrice: 290_000, zipPrefix: "191", closing: "title_company", transferTaxPct: 4.28, whoPaysTransferTax: "split" },
  { city: "Hartford", state: "Connecticut", stateCode: "CT", metroType: "suburban", medianPrice: 360_000, zipPrefix: "061", closing: "attorney", transferTaxPct: 1.25, whoPaysTransferTax: "seller" },
  { city: "Brooklyn", state: "New York", stateCode: "NY", metroType: "urban", medianPrice: 1_050_000, zipPrefix: "112", closing: "attorney", transferTaxPct: 1.825, whoPaysTransferTax: "seller" },
  { city: "Portland", state: "Maine", stateCode: "ME", metroType: "suburban", medianPrice: 510_000, zipPrefix: "041", closing: "attorney", transferTaxPct: 0.44, whoPaysTransferTax: "split" },
  { city: "Bozeman", state: "Montana", stateCode: "MT", metroType: "rural", medianPrice: 820_000, zipPrefix: "597", closing: "title_company", transferTaxPct: 0, whoPaysTransferTax: "seller" },
  { city: "Albuquerque", state: "New Mexico", stateCode: "NM", metroType: "suburban", medianPrice: 340_000, zipPrefix: "871", closing: "title_company", transferTaxPct: 0, whoPaysTransferTax: "seller" },
  { city: "Salt Lake City", state: "Utah", stateCode: "UT", metroType: "urban", medianPrice: 560_000, zipPrefix: "841", closing: "title_company", caveatEmptor: true, transferTaxPct: 0, whoPaysTransferTax: "seller" },
  { city: "Des Moines", state: "Iowa", stateCode: "IA", metroType: "suburban", medianPrice: 250_000, zipPrefix: "503", closing: "attorney", transferTaxPct: 0.16, whoPaysTransferTax: "seller" },
];

const TEMPERATURE_STATS: Record<MarketTemperature, { dom: [number, number]; ratio: [number, number]; inventory: [number, number] }> = {
  hot: { dom: [5, 18], ratio: [1.01, 1.06], inventory: [0.8, 2.2] },
  balanced: { dom: [20, 45], ratio: [0.975, 1.005], inventory: [3.5, 5.5] },
  cold: { dom: [55, 120], ratio: [0.92, 0.97], inventory: [6.5, 11] },
};

export function generateMarket(rng: Rng): Market {
  const region = rng.pick(REGIONS);
  const temperature = rng.weighted<MarketTemperature>([
    ["hot", 0.35],
    ["balanced", 0.4],
    ["cold", 0.25],
  ]);
  const stats = TEMPERATURE_STATS[temperature];
  return {
    city: region.city,
    state: region.state,
    stateCode: region.stateCode,
    metroType: region.metroType,
    temperature,
    medianPrice: region.medianPrice,
    avgDaysOnMarket: rng.int(stats.dom[0], stats.dom[1]),
    listToSaleRatio: Number(rng.range(stats.ratio[0], stats.ratio[1]).toFixed(3)),
    monthsOfInventory: Number(rng.range(stats.inventory[0], stats.inventory[1]).toFixed(1)),
    mortgageRate: Number(rng.range(5.6, 7.4).toFixed(2)),
    customs: {
      closing: region.closing,
      optionPeriod: region.optionPeriod ?? false,
      disclosure: region.caveatEmptor ? "caveat_emptor" : "seller_disclosure",
      typicalEarnestMoneyPct: temperature === "hot" ? rng.pick([2, 3, 5]) : rng.pick([1, 1, 2]),
      transferTaxPct: region.transferTaxPct,
      whoPaysTransferTax: region.whoPaysTransferTax,
    },
  };
}

export function zipFor(market: Market, rng: Rng): string {
  const region = REGIONS.find((r) => r.city === market.city && r.stateCode === market.stateCode);
  return `${region?.zipPrefix ?? "000"}${rng.int(0, 9)}${rng.int(0, 9)}`;
}
