// What each participant is allowed to see. The browser only ever receives a UserView.

import type { BuyerBrief, ClientStory, Comp, Disclosure, Market, Property, Role, Scenario, SellerBrief, TypeSpecificTerm } from "./types";

export interface PublicView {
  startDate: string;
  market: Market;
  property: Property;
  comps: Comp[];
  disclosures: Disclosure[];
  typeSpecificTerms: TypeSpecificTerm[];
  listingHeadline: string;
  listingRemarks: string;
  neighborhood: string;
  marketSnapshot: string;
}

export interface UserView {
  id: string;
  createdAt: string;
  role: Role;
  public: PublicView;
  yourClient: { brief: SellerBrief | BuyerBrief; story: ClientStory };
  opposingAgent: { name: string; brokerage: string; yearsExperience: number; dealsPerYear: number; publicBio: string };
  openingSituation: string;
  narrativeSource: Scenario["narrativeSource"];
}

export function publicView(s: Scenario): PublicView {
  return {
    startDate: s.startDate,
    market: s.market,
    property: s.property,
    comps: s.comps,
    disclosures: s.disclosures,
    typeSpecificTerms: s.typeSpecificTerms,
    listingHeadline: s.narrative.listingHeadline,
    listingRemarks: s.narrative.listingRemarks,
    neighborhood: s.narrative.neighborhood,
    marketSnapshot: s.narrative.marketSnapshot,
  };
}

export function userView(s: Scenario): UserView {
  const isBuyerAgent = s.userRole === "buyer_agent";
  const agent = s.narrative.opposingAgent;
  return {
    id: s.id,
    createdAt: s.createdAt,
    role: s.userRole,
    public: publicView(s),
    yourClient: isBuyerAgent ? { brief: s.buyer, story: s.narrative.buyerStory } : { brief: s.seller, story: s.narrative.sellerStory },
    opposingAgent: { name: agent.name, brokerage: agent.brokerage, yearsExperience: agent.yearsExperience, dealsPerYear: agent.dealsPerYear, publicBio: agent.publicBio },
    openingSituation: s.narrative.openingSituation[s.userRole],
    narrativeSource: s.narrativeSource,
  };
}
