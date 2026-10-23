// Template story writer used when no Anthropic API key is configured, or when the Claude call fails.
// Plainer than Claude's output, but uses only engine-generated numbers.

import type { BuyerBrief, ClientStory, Narrative, ScenarioParams, SellerBrief } from "../engine/types";
import { Rng } from "../engine/rng";
import { LOAN_LABELS, MOTIVATION_LABELS, money, typeLabel } from "./format";

const FIRST = ["Dana", "Luis", "Priya", "Marcus", "Elaine", "Tom", "Keisha", "Ben", "Rosa", "Hank", "Mei", "Caleb", "Nora", "Andre", "Grace", "Walt"];
const LAST = ["Ortega", "Whitfield", "Nakamura", "Brennan", "Okafor", "Lindqvist", "Delgado", "Harper", "Kowalski", "Reyes", "Abbott", "Sorensen"];
const AGENT_FIRST = ["Margaret", "Bill", "Carol", "Ray", "Linda", "Frank", "Deb", "Gary"];
const BROKERAGES = ["Keystone Realty Group", "Hearthside Properties", "Benchmark Real Estate", "Cornerstone Home Partners", "Main Street Realty"];

function clientNames(rng: Rng): { names: string; plural: boolean } {
  const last = rng.pick(LAST);
  if (rng.chance(0.65)) {
    const [a, b] = rng.sample(FIRST, 2);
    return { names: `${a} and ${b} ${last}`, plural: true };
  }
  return { names: `${rng.pick(FIRST)} ${last}`, plural: false };
}

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function urgencyWords(u: number): string {
  return ["no rush at all", "some flexibility", "a real timeline", "a tight timeline", "an urgent need to get this done"][u - 1];
}

function sellerStory(rng: Rng, s: SellerBrief, p: ScenarioParams): ClientStory {
  const names = s.motivation === "builder" ? `${p.property.extras.builder ?? "The builder"} (sales manager ${rng.pick(FIRST)} ${rng.pick(LAST)})` : clientNames(rng).names;
  return {
    clientNames: names,
    backstory: `${names}, ${s.motivation === "builder" ? "builder" : "owner"} of ${p.property.address.street}. Situation: ${MOTIVATION_LABELS[s.motivation] ?? s.motivation}.`,
    motivationStory: `They have ${urgencyWords(s.urgency)}. Ideally they close around ${longDate(s.idealClose)}, and no later than ${longDate(s.latestClose)}.`,
    whatTheyveToldYou: `"We won't go below ${money(s.reservationPrice)}. ${s.mortgagePayoff > 0 ? `We owe about ${money(s.mortgagePayoff)}.` : "There's no mortgage on it."} We could give back up to ${money(s.maxConcessions)} in credits or repairs if we have to, but we'd rather not.${s.needsRentBackDays ? ` We'll need about ${s.needsRentBackDays} days after closing to move out.` : ""}${s.acceptsHomeSaleContingency ? "" : " We don't want a buyer who has to sell a house first."}"`,
    softSpots: [s.needsRentBackDays ? "A free rent-back after closing" : "A clean, quick close", "A buyer who clearly loves the house", "Strong earnest money"],
    nonNegotiables: [`Net price at or above ${money(s.reservationPrice)}`, `Closing no later than ${longDate(s.latestClose)}`],
    quirks: [rng.pick(["Checks Zillow daily", "Takes repair requests personally", "Wants every answer in writing", "Defers to their spouse on money"])],
  };
}

function buyerStory(rng: Rng, b: BuyerBrief): ClientStory {
  const { names, plural } = clientNames(rng);
  const financing = b.loanType === "cash" ? "paying cash" : `pre-approved up to ${money(b.preapprovalAmount ?? 0)} with a ${LOAN_LABELS[b.loanType]} and ${b.downPaymentPct}% down`;
  return {
    clientNames: names,
    backstory: `${names} ${plural ? "are" : "is"} ${financing}. Situation: ${MOTIVATION_LABELS[b.motivation] ?? b.motivation}.`,
    motivationStory: `They have ${urgencyWords(b.urgency)}.${b.leaseEndsOn ? ` Their lease ends ${longDate(b.leaseEndsOn)}.` : ""}${b.homeToSell ? ` They still have a home to sell (${b.homeToSell.status.replace(/_/g, " ")}).` : ""}`,
    whatTheyveToldYou: `"Our absolute top is ${money(b.reservationPrice)}. We have about ${money(b.cashReserves)} in cash beyond the down payment and closing costs, so we could cover maybe ${money(b.maxAppraisalGapCoverage)} if it appraises low. We'd love to close around ${longDate(b.idealClose)}."`,
    softSpots: ["Seller paying some closing costs", "Getting the appliances included", "A flexible closing date"],
    nonNegotiables: [`Price at or below ${money(b.reservationPrice)}`, ...b.mustHaves.slice(0, 1).map((m) => `Must have: ${m}`)],
    quirks: [rng.pick(["Researches everything online", "Very anxious about repairs", "Wants to feel they 'won'", "Parents are heavily involved"])],
  };
}

export function writeOfflineNarrative(p: ScenarioParams): Narrative {
  const rng = new Rng(p.seed ^ 0x5bd1e995);
  const { property, market } = p;
  const kind = typeLabel(property.type).toLowerCase();
  const specs = property.type === "land" ? `${property.lotAcres} acres` : `${property.beds} bed, ${property.baths} bath, ${property.sqft.toLocaleString()} sq ft`;
  const temperament = p.difficulty.temperament;
  const sellerS = sellerStory(rng, p.seller, p);
  const buyerS = buyerStory(rng, p.buyer);

  return {
    listingHeadline: `${specs} ${kind} in ${market.city}`,
    listingRemarks: `Welcome to ${property.address.street}, a ${specs} ${kind}${property.yearBuilt ? ` built in ${property.yearBuilt}` : ""}. Highlights include ${property.features.slice(0, 3).join(", ") || "a great location"}. ${property.hoa ? `HOA dues are ${money(property.hoa.monthlyDues)} per month. ` : ""}Offered at ${money(property.listPrice)}.`,
    neighborhood: `${market.metroType === "urban" ? "An" : "A"} ${market.metroType} part of ${market.city}, ${market.stateCode}.`,
    marketSnapshot: `The ${market.city} market is ${market.temperature}: homes average ${market.avgDaysOnMarket} days on market and sell for about ${Math.round(market.listToSaleRatio * 100)}% of list price, with ${market.monthsOfInventory} months of inventory.`,
    sellerStory: sellerS,
    buyerStory: buyerS,
    opposingAgent: {
      name: `${rng.pick(AGENT_FIRST)} ${rng.pick(LAST)}`,
      brokerage: rng.pick(BROKERAGES),
      yearsExperience: 30,
      dealsPerYear: rng.int(30, 40),
      voice: {
        collaborative: "Warm and straightforward; looks for ways to get both sides to yes.",
        professional: "Polite, efficient, and firm; backs every number with comps.",
        cagey: "Friendly on the surface but reveals almost nothing; answers questions with questions.",
        hardball: "Blunt and impatient; anchors hard and uses deadlines as pressure.",
      }[temperament],
      signaturePhrases: ["Let me run that by my clients.", "Help me understand your number.", "I've been doing this a long time."],
      publicBio: `A 30-year veteran of the ${market.city} market who closes 30 to 40 transactions a year.`,
    },
    openingSituation: {
      buyer_agent: `You represent ${buyerS.clientNames}. They toured ${property.address.street} and want to make an offer. The listing agent is waiting to hear from you.`,
      seller_agent: `You represent ${sellerS.clientNames}, who listed ${property.address.street} ${property.daysOnMarket} days ago at ${money(property.listPrice)}. A buyer's agent has called to say an offer is on the way.`,
    },
  };
}
