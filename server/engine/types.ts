// Scenario data model. See DESIGN.md section 1 for the four information layers.

export type Role = "buyer_agent" | "seller_agent";
export type Side = "buyer" | "seller";

export type MarketTemperature = "hot" | "balanced" | "cold";
export type MetroType = "urban" | "suburban" | "rural";
export type ClosingCustom = "escrow" | "attorney" | "title_company";

export type PropertyType =
  | "single_family"
  | "condo"
  | "townhouse"
  | "co_op"
  | "multifamily"
  | "manufactured"
  | "new_construction"
  | "rural_acreage"
  | "land";

export type LoanType = "cash" | "conventional" | "fha" | "va" | "usda" | "jumbo";

// ---------- Public layer ----------

export interface Market {
  city: string;
  state: string;
  stateCode: string;
  metroType: MetroType;
  temperature: MarketTemperature;
  medianPrice: number;
  avgDaysOnMarket: number;
  listToSaleRatio: number; // e.g. 1.03 = homes sell 3% over list on average
  monthsOfInventory: number;
  mortgageRate: number; // 30-year fixed, percent
  customs: {
    closing: ClosingCustom;
    optionPeriod: boolean; // Texas-style paid option period instead of an inspection contingency
    disclosure: "seller_disclosure" | "caveat_emptor";
    typicalEarnestMoneyPct: number;
    transferTaxPct: number;
    whoPaysTransferTax: "seller" | "buyer" | "split";
  };
}

export interface Unit {
  label: string;
  beds: number;
  baths: number;
  monthlyRent: number | null; // null = vacant or owner-occupied
  leaseEnds: string | null;
}

export interface Hoa {
  monthlyDues: number;
  includes: string[];
  reserveFundStatus: "strong" | "adequate" | "underfunded";
  rentalCap: boolean;
  fhaApproved: boolean | null; // condos only
}

export interface Property {
  type: PropertyType;
  address: { street: string; city: string; stateCode: string; zip: string };
  beds: number;
  baths: number;
  sqft: number;
  lotAcres: number;
  yearBuilt: number;
  condition: 1 | 2 | 3 | 4 | 5; // 1 = needs major work, 5 = like new
  stories: number;
  garage: string;
  heating: string;
  cooling: string;
  water: "public" | "well";
  sewer: "public" | "septic";
  features: string[];
  hoa: Hoa | null;
  units: Unit[] | null; // multifamily only
  annualTaxes: number;
  listPrice: number;
  originalListPrice: number;
  daysOnMarket: number;
  priceHistory: { date: string; event: string; price: number }[];
  /** Type-specific facts: lot rent, flip tax, builder name, zoning, etc. */
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
  distanceMiles: number;
  notes: string;
}

export interface Disclosure {
  item: string;
  detail: string;
}

/** Extra deal terms this property type brings into the negotiation. */
export interface TypeSpecificTerm {
  key: string;
  label: string;
  description: string;
}

// ---------- Confidential client briefs ----------

export interface Preferences {
  // Relative weights, summing to 1. Used by the utility function in later build steps.
  price: number;
  timing: number;
  certainty: number;
  repairs: number;
  possession: number;
}

export interface ClientBriefBase {
  side: Side;
  motivation: string; // machine key, e.g. "relocation"
  urgency: 1 | 2 | 3 | 4 | 5;
  preferences: Preferences;
  earliestClose: string; // ISO date
  latestClose: string;
  idealClose: string;
}

export interface SellerBrief extends ClientBriefBase {
  side: "seller";
  /** Lowest price the seller will sign at, before any credits. Enforced in code. */
  reservationPrice: number;
  /** Most they'll give back in credits and repairs combined. */
  maxConcessions: number;
  mortgagePayoff: number;
  needsRentBackDays: number; // 0 = none
  willingToFinanceRepairs: boolean;
  acceptableLoanTypes: LoanType[];
  /** Whether they'll accept a buyer whose purchase depends on selling another home. */
  acceptsHomeSaleContingency: boolean;
}

export interface BuyerBrief extends ClientBriefBase {
  side: "buyer";
  /** Highest price the buyer will sign at. Enforced in code. */
  reservationPrice: number;
  preapprovalAmount: number | null; // null for cash
  loanType: LoanType;
  downPaymentPct: number;
  /** Cash available beyond down payment and closing costs; limits appraisal-gap coverage. */
  cashReserves: number;
  maxAppraisalGapCoverage: number;
  homeToSell: { status: "none" | "listed" | "under_contract" | "not_yet_listed"; equity: number } | null;
  leaseEndsOn: string | null;
  mustHaves: string[];
  willingToWaive: ("inspection" | "appraisal" | "financing")[];
}

export type ClientBrief = SellerBrief | BuyerBrief;

/** Words the LLM writes for a client brief. */
export interface ClientStory {
  clientNames: string;
  backstory: string;
  motivationStory: string;
  whatTheyveToldYou: string; // first-person-ish notes from the client meeting
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
  disclosed: boolean; // was it already in the seller's disclosures?
  sellerKnew: boolean;
  detectableBy: "general_inspection" | "specialist" | "walkthrough";
}

export interface LoanEvent {
  id: string;
  kind: "rate_lock_expiry" | "dti_issue" | "employment_change" | "underwriting_condition" | "condo_project_review" | "loan_denial";
  dayOffset: number; // days after contract acceptance
  severity: "nuisance" | "delay" | "deal_threatening";
  summary: string;
}

export interface TitleIssue {
  id: string;
  kind: "unreleased_lien" | "missing_heir" | "boundary_encroachment" | "hoa_lien" | "judgment_lien" | "easement";
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
  arrivesDay: number; // days after the scenario starts (pre-contract) or after acceptance (backup/kick-out)
  phase: "pre_contract" | "under_contract";
  strength: "weak" | "comparable" | "strong";
  price: number;
}

export interface ClientEvent {
  side: Side;
  phase: "negotiation" | "inspection" | "closing";
  summary: string;
}

export interface GroundTruth {
  marketValue: number;
  appraisedValue: number;
  inspectionFindings: Finding[];
  typeSpecificIssues: Finding[];
  financing: LoanEvent[];
  titleIssues: TitleIssue[];
  walkthroughSurprises: Surprise[];
  competingOffers: CompetingOffer[];
  clientEvents: ClientEvent[];
}

// ---------- Hidden difficulty ----------

export type DealSpace = "wide" | "normal" | "narrow" | "none";

export interface HiddenDifficulty {
  /** -1 = user's client holds the leverage, +1 = the bot's client does. */
  leverage: number;
  temperament: "collaborative" | "professional" | "cagey" | "hardball";
  /** 0 = concedes in tiny steps, 1 = generous steps. */
  concessionPace: number;
  bluffing: "never" | "subtle" | "active";
  clientVolatility: "steady" | "nervous" | "erratic";
  eventVolatility: "clean" | "typical" | "rough";
  dealSpace: DealSpace;
  /** Overall label shown in the debrief. */
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
  publicBio: string; // what the user can see
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
  /** Initial situation from the user's side: what has happened before the first move. */
  openingSituation: { buyer_agent: string; seller_agent: string };
}

export interface ScenarioParams {
  seed: number;
  startDate: string; // the simulated "today" when the scenario begins
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
}

export interface Scenario extends ScenarioParams {
  id: string;
  createdAt: string;
  narrative: Narrative;
  narrativeSource: "claude" | "offline";
}
