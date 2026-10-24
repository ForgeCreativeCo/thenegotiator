// Scenario data model for Ontario residential deals. See DESIGN.md section 1 for the four information layers.

import type { ClientFact, OwnClientEvent } from "../client/types";

export type Role = "buyer_agent" | "seller_agent";
export type Side = "buyer" | "seller";

export type MarketTemperature = "hot" | "balanced" | "cold";
export type RegionKind = "toronto" | "gta" | "city" | "small_city" | "cottage" | "north";

export type PropertyType =
  | "detached"
  | "semi_detached"
  | "freehold_townhouse"
  | "condo_townhouse"
  | "condo_apartment"
  | "multiplex"
  | "cottage"
  | "rural_acreage"
  | "vacant_land"
  | "new_construction"
  | "land_lease_home"
  | "co_op";

/** insured = CMHC-insured (under 20% down); conventional = 20%+ down; alternative = B lender or private. */
export type FinancingType = "cash" | "insured" | "conventional" | "alternative";

export type ConditionKey = "financing" | "inspection" | "status_certificate" | "lawyer_review" | "insurance" | "sale_of_property" | "water_septic";

// ---------- Public layer ----------

export interface Market {
  region: string; // e.g. "Toronto (East York)"
  municipality: string; // e.g. "Toronto"
  regionKind: RegionKind;
  temperature: MarketTemperature;
  /** Benchmark price for a detached home in this region. */
  benchmarkPrice: number;
  avgDaysOnMarket: number;
  listToSaleRatio: number; // e.g. 1.03 = homes sell 3% over list on average
  monthsOfInventory: number;
  mortgageRate: number; // 5-year fixed, percent
  /** Toronto charges a municipal land transfer tax on top of Ontario's. */
  torontoMltt: boolean;
  typicalDepositPct: number;
  offerNightsCommon: boolean;
}

export interface Unit {
  label: string;
  beds: number;
  baths: number;
  monthlyRent: number | null; // null = vacant or owner-occupied
  tenancy: "month_to_month" | "fixed_term" | "vacant" | "owner";
  tenantSince: string | null;
}

export interface CondoInfo {
  corporation: string; // e.g. "TSCC 1234"
  monthlyFees: number;
  includes: string[];
  reserveFundStatus: "strong" | "adequate" | "underfunded";
  parking: "owned" | "exclusive_use" | "none";
  locker: boolean;
  petRestrictions: boolean;
  shortTermRentalBan: boolean;
}

/** Equipment the seller rents (common in Ontario); the buyer assumes the contract unless negotiated otherwise. */
export interface RentalItem {
  item: string;
  monthly: number;
  buyoutCost: number;
}

export interface Property {
  type: PropertyType;
  address: { street: string; municipality: string; province: "ON"; postalCode: string };
  style: string; // "2-storey", "bungalow", "backsplit", "apartment"
  beds: number;
  baths: number;
  sqft: number;
  lotFrontageFt: number | null;
  lotDepthFt: number | null;
  acres: number | null;
  yearBuilt: number;
  condition: 1 | 2 | 3 | 4 | 5; // 1 = needs major work, 5 = like new
  basement: "finished" | "unfinished" | "apartment" | "none";
  parking: string;
  heating: string;
  cooling: string;
  water: "municipal" | "well" | "lake";
  sewer: "municipal" | "septic";
  features: string[];
  condo: CondoInfo | null;
  /** Monthly fee for a freehold town on a common elements condominium (POTL). */
  potlFee: number | null;
  units: Unit[] | null;
  rentalItems: RentalItem[];
  annualTaxes: number;
  listPrice: number;
  originalListPrice: number;
  daysOnMarket: number;
  priceHistory: { date: string; event: string; price: number }[];
  /** Whether the seller filled out a Seller Property Information Statement (optional in Ontario). */
  spisProvided: boolean;
  /** Type-specific facts: lot fee, builder, zoning, road access, etc. */
  extras: Record<string, string | number | boolean>;
}

export interface Comp {
  address: string;
  soldDate: string;
  soldPrice: number;
  beds: number;
  baths: number;
  sqft: number;
  daysOnMarket: number;
  distanceKm: number;
  notes: string;
}

export interface Disclosure {
  item: string;
  detail: string;
}

/** Extra terms this property type brings into the negotiation. */
export interface TypeSpecificTerm {
  key: string;
  label: string;
  description: string;
}

// ---------- Confidential client briefs ----------

export interface Preferences {
  price: number;
  timing: number;
  certainty: number;
  repairs: number;
  possession: number;
}

export interface ClientBriefBase {
  side: Side;
  motivation: string;
  urgency: 1 | 2 | 3 | 4 | 5;
  preferences: Preferences;
  /** Completion (closing) window. */
  earliestClose: string;
  latestClose: string;
  idealClose: string;
}

export interface SellerBrief extends ClientBriefBase {
  side: "seller";
  /** Lowest price the seller will sign at, net of any rental buyouts they agree to pay. Enforced in code. */
  reservationPrice: number;
  mortgagePayoff: number;
  minDepositPct: number;
  /** Longest condition period (banking days) the seller will accept on any condition. */
  maxConditionDays: number;
  acceptsSaleCondition: boolean;
  /** The seller has bought another home firm, so their completion window is fixed. */
  boughtElsewhere: boolean;
}

export interface BuyerBrief extends ClientBriefBase {
  side: "buyer";
  /** Highest price the buyer will sign at, net of any rental buyouts the seller pays. Enforced in code. */
  reservationPrice: number;
  preapprovalAmount: number | null; // null for cash
  financing: FinancingType;
  downPaymentPct: number;
  cashReserves: number;
  maxAppraisalGapCoverage: number;
  firstTimeBuyer: boolean;
  homeToSell: { status: "none" | "listed" | "sold_firm" | "not_yet_listed"; equity: number } | null;
  /** The buyer can't buy without first selling their home. */
  needsSaleCondition: boolean;
  leaseEndsOn: string | null;
  mustHaves: string[];
  willingToWaive: ("inspection" | "financing" | "status_certificate")[];
}

export type ClientBrief = SellerBrief | BuyerBrief;

export interface ClientStory {
  clientNames: string;
  backstory: string;
  motivationStory: string;
  whatTheyveToldYou: string;
  softSpots: string[];
  nonNegotiables: string[];
  quirks: string[];
}

// ---------- Ground truth: fixed at generation, revealed through events ----------

export type Severity = "minor" | "moderate" | "major" | "safety";

export interface Finding {
  id: string;
  system: string;
  title: string;
  severity: Severity;
  repairCostLow: number;
  repairCostHigh: number;
  disclosed: boolean;
  sellerKnew: boolean;
  /** Which process reveals it. */
  source: "home_inspection" | "status_certificate" | "water_septic" | "lawyer";
  /** Insurers may refuse or surcharge coverage until it's fixed (knob-and-tube, oil tanks). */
  affectsInsurance: boolean;
}

export interface LoanEvent {
  id: string;
  kind: "income_verification" | "rate_hold_expiry" | "debt_ratios" | "insurer_decline" | "condo_review" | "mortgage_declined";
  dayOffset: number;
  severity: "nuisance" | "delay" | "deal_threatening";
  summary: string;
}

export interface TitleIssue {
  id: string;
  kind: "work_order" | "open_permit" | "encroachment" | "unregistered_easement" | "estate_trustee_needed" | "construction_lien" | "execution";
  resolvable: boolean;
  daysToResolve: number;
  summary: string;
}

export interface Surprise {
  id: string;
  summary: string;
  costToFix: number;
}

export interface CompetingOffer {
  arrivesDay: number;
  phase: "pre_contract" | "under_contract";
  strength: "weak" | "comparable" | "strong";
  price: number;
}

export interface ClientEvent {
  side: Side;
  phase: "negotiation" | "conditional" | "completion";
  summary: string;
}

export interface GroundTruth {
  marketValue: number;
  /** What the lender's appraiser would support for this property. */
  appraisedValue: number;
  inspectionFindings: Finding[];
  typeSpecificIssues: Finding[];
  financing: LoanEvent[];
  titleIssues: TitleIssue[];
  visitSurprises: Surprise[];
  competingOffers: CompetingOffer[];
  clientEvents: ClientEvent[];
}

// ---------- Hidden difficulty ----------

export type DealSpace = "wide" | "normal" | "narrow" | "none";

export interface HiddenDifficulty {
  /** -1 = user's client holds the leverage, +1 = the bot's client does. */
  leverage: number;
  temperament: "collaborative" | "professional" | "cagey" | "hardball";
  concessionPace: number;
  /** How much the agent keeps to itself. It never misrepresents (RECO Code of Ethics). */
  withholding: "open" | "reserved" | "guarded";
  clientVolatility: "steady" | "nervous" | "erratic";
  eventVolatility: "clean" | "typical" | "rough";
  dealSpace: DealSpace;
  rating: "easy" | "moderate" | "hard" | "brutal";
}

// ---------- Opposing agent ----------

export interface AgentPersona {
  name: string;
  brokerage: string;
  yearsExperience: number;
  dealsPerYear: number;
  voice: string;
  signaturePhrases: string[];
  publicBio: string;
}

// ---------- Offer night ----------

/** The listing holds offers until a set review time (common in hot GTA markets). */
export interface OfferNightSetup {
  /** Simulated hours after the scenario starts when offers are reviewed (7 p.m. on review day). */
  reviewAtHours: number;
  preemptives: "not_accepted" | "considered";
  /** The seller's direction under TRESA: disclose only how many offers there are, or their contents too. */
  sellerDisclosure: "count_only" | "details";
}

// ---------- Scenario ----------

export interface Narrative {
  listingHeadline: string;
  listingRemarks: string;
  neighborhood: string;
  marketSnapshot: string;
  sellerStory: ClientStory;
  buyerStory: ClientStory;
  opposingAgent: AgentPersona;
  openingSituation: { buyer_agent: string; seller_agent: string };
}

export interface ScenarioParams {
  seed: number;
  startDate: string;
  market: Market;
  property: Property;
  comps: Comp[];
  disclosures: Disclosure[];
  typeSpecificTerms: TypeSpecificTerm[];
  userRole: Role;
  seller: SellerBrief;
  buyer: BuyerBrief;
  groundTruth: GroundTruth;
  difficulty: HiddenDifficulty;
  /** Absent on scenarios created before offer nights existed. */
  offerNight?: OfferNightSetup | null;
  /** What the user's own client hasn't told them. Hidden until the debrief. Absent on older scenarios. */
  clientFacts?: ClientFact[];
  /** Surprises from the user's own client after acceptance. Hidden until they happen. Absent on older scenarios. */
  ownClientEvents?: OwnClientEvent[];
}

export interface Scenario extends ScenarioParams {
  id: string;
  createdAt: string;
  narrative: Narrative;
  narrativeSource: "claude" | "offline";
}
