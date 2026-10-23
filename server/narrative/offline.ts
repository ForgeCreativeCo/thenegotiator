// Template story writer used when no Anthropic API key is configured, or when the Claude call fails.
// Plainer than Claude's output, but uses only engine-generated numbers.

import type { BuyerBrief, ClientStory, Narrative, ScenarioParams, SellerBrief } from "../engine/types";
import { Rng } from "../engine/rng";
import { FINANCING_LABELS, MOTIVATION_LABELS, money, typeLabel } from "./format";

const FIRST = ["Dana", "Luis", "Priya", "Marcus", "Elaine", "Tom", "Keisha", "Ben", "Rosa", "Arjun", "Mei", "Caleb", "Nora", "Andre", "Grace", "Wei", "Fatima", "Liam", "Sofia", "Daniel"];
const LAST = ["Ortega", "Whitfield", "Nakamura", "Brennan", "Okafor", "Lindqvist", "Patel", "Tremblay", "Kowalski", "Singh", "MacDonald", "Chen", "Gagnon", "Rossi"];
const AGENT_FIRST = ["Margaret", "Bill", "Carol", "Ray", "Linda", "Frank", "Deb", "Gary", "Sandra", "Paul"];
const BROKERAGES = ["Keystone Realty Inc., Brokerage", "Hearthside Properties Ltd., Brokerage", "Benchmark Real Estate Inc., Brokerage", "Cornerstone Home Partners, Brokerage", "Lakeshore Realty Ltd., Brokerage"];

function clientNames(rng: Rng): { names: string; plural: boolean } {
  const last = rng.pick(LAST);
  if (rng.chance(0.65)) {
    const [a, b] = rng.sample(FIRST, 2);
    return { names: `${a} and ${b} ${last}`, plural: true };
  }
  return { names: `${rng.pick(FIRST)} ${last}`, plural: false };
}

function article(word: string): string {
  return /^[aeiou8]/i.test(word) || /^1[18]/.test(word) ? "an" : "a";
}

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function urgencyWords(u: number): string {
  return ["no rush at all", "some flexibility", "a real timeline", "a tight timeline", "an urgent need to get this done"][u - 1];
}

function sellerStory(rng: Rng, s: SellerBrief, p: ScenarioParams): ClientStory {
  const names = s.motivation === "builder" ? `${p.property.extras.builder ?? "The builder"} (sales manager ${rng.pick(FIRST)} ${rng.pick(LAST)})` : clientNames(rng).names;
  return {
    clientNames: names,
    backstory: `${names}, ${s.motivation === "builder" ? "builder" : "owner"} of ${p.property.address.street}. Situation: ${MOTIVATION_LABELS[s.motivation] ?? s.motivation}.`,
    motivationStory: `They have ${urgencyWords(s.urgency)}. Ideally completion is around ${longDate(s.idealClose)}, and ${s.boughtElsewhere ? "it can't move much because they've bought firm elsewhere" : `no later than ${longDate(s.latestClose)}`}.`,
    whatTheyveToldYou: `"We won't go below ${money(s.reservationPrice)}. ${s.mortgagePayoff > 0 ? `We owe about ${money(s.mortgagePayoff)} on the mortgage.` : "There's no mortgage on it."} We want a real deposit, at least ${s.minDepositPct}%. Keep any conditions short, ${s.maxConditionDays} banking days at most.${s.acceptsSaleCondition ? "" : " We won't take an offer conditional on the buyer selling their house."}"`,
    softSpots: [s.boughtElsewhere ? "A completion date that matches our purchase" : "A clean, firm offer", "A buyer who clearly loves the house", "A strong deposit"],
    nonNegotiables: [`Price at or above ${money(s.reservationPrice)}`, `Completion between ${longDate(s.earliestClose)} and ${longDate(s.latestClose)}`],
    quirks: [rng.pick(["Checks HouseSigma daily", "Takes inspection requests personally", "Wants every answer in writing", "Defers to their spouse on money"])],
  };
}

function buyerStory(rng: Rng, b: BuyerBrief): ClientStory {
  const { names, plural } = clientNames(rng);
  const financing = b.financing === "cash" ? "paying cash" : `pre-approved up to ${money(b.preapprovalAmount ?? 0)} for ${article(FINANCING_LABELS[b.financing])} ${FINANCING_LABELS[b.financing]} with ${b.downPaymentPct}% down`;
  return {
    clientNames: names,
    backstory: `${names} ${plural ? "are" : "is"} ${financing}. Situation: ${MOTIVATION_LABELS[b.motivation] ?? b.motivation}.${b.firstTimeBuyer ? " First-time buyers for land transfer tax purposes." : ""}`,
    motivationStory: `They have ${urgencyWords(b.urgency)}.${b.leaseEndsOn ? ` Their lease ends ${longDate(b.leaseEndsOn)}.` : ""}${b.homeToSell ? ` They have a home to sell (${b.homeToSell.status.replace(/_/g, " ")}).` : ""}`,
    whatTheyveToldYou: `"Our absolute top is ${money(b.reservationPrice)}. We have about ${money(b.cashReserves)} in cash beyond the down payment, land transfer tax and legal fees, so we could cover maybe ${money(b.maxAppraisalGapCoverage)} if the lender's appraisal comes in short.${b.willingToWaive.length ? ` We'd go without a ${b.willingToWaive.join(" or ").replace("_", " ")} condition if we had to.` : " We need our conditions."}${b.needsSaleCondition ? " We can't buy until our place sells." : ""}"`,
    softSpots: ["A completion date that fits our move", "Getting the appliances included", "The seller buying out the rental hot water tank"],
    nonNegotiables: [`Price at or below ${money(b.reservationPrice)}`, ...b.mustHaves.slice(0, 1).map((m) => `Must have: ${m}`)],
    quirks: [rng.pick(["Researches everything on HouseSigma", "Very anxious about repairs", "Wants to feel they 'won'", "Parents are heavily involved"])],
  };
}

export function writeOfflineNarrative(p: ScenarioParams): Narrative {
  const rng = new Rng(p.seed ^ 0x5bd1e995);
  const { property, market } = p;
  const kind = typeLabel(property.type).toLowerCase();
  const specs = property.type === "vacant_land" ? `${property.acres} acres of` : `${property.beds} bed, ${property.baths} bath`;
  const sellerS = sellerStory(rng, p.seller, p);
  const buyerS = buyerStory(rng, p.buyer);
  const fees = property.condo ? `Maintenance fees ${money(property.condo.monthlyFees)}/month. ` : property.potlFee ? `POTL fee ${money(property.potlFee)}/month. ` : "";

  return {
    listingHeadline: `${specs} ${kind} in ${market.region}`,
    listingRemarks: `Welcome to ${property.address.street}, ${article(specs)} ${specs} ${kind}${property.yearBuilt ? ` built in ${property.yearBuilt}` : ""}. Highlights include ${property.features.slice(0, 3).join(", ") || "a great location"}. ${fees}Offered at ${money(property.listPrice)}.${market.offerNightsCommon && property.listPrice < p.groundTruth.marketValue ? " Offers reviewed on the date set by the listing brokerage." : ""}`,
    neighborhood: `${market.region.includes(property.address.municipality) ? market.region : `${property.address.municipality} (${market.region})`}, Ontario.`,
    marketSnapshot: `The ${market.region} market is ${market.temperature}: homes average ${market.avgDaysOnMarket} days on market and sell for about ${Math.round(market.listToSaleRatio * 100)}% of the asking price, with ${market.monthsOfInventory} months of inventory.`,
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
        hardball: "Blunt and impatient; anchors hard and holds firm on deadlines.",
      }[p.difficulty.temperament],
      signaturePhrases: ["Let me run that by my clients.", "Help me understand your number.", "I've been doing this a long time."],
      publicBio: `A broker with 30 years in ${market.region} real estate who closes 30 to 40 transactions a year.`,
    },
    openingSituation: {
      buyer_agent: `You represent ${buyerS.clientNames} under a Buyer Representation Agreement, and they have the RECO Information Guide. They've seen ${property.address.street} and want to make an offer. The listing agent is expecting your offer.`,
      seller_agent: `You represent ${sellerS.clientNames} under a Listing Agreement, and they have the RECO Information Guide. ${property.address.street} has been listed ${property.daysOnMarket} days at ${money(property.listPrice)}. A buyer's agent has called to say an offer is coming.`,
    },
  };
}
