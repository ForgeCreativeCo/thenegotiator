// The one-line summary of a deal shown in the past-deals list.

import type { Scenario } from "../engine/types";
import type { Negotiation, NegotiationStatus } from "../negotiation/types";

export interface ScenarioSummary {
  id: string;
  createdAt: string;
  role: Scenario["userRole"];
  region: string;
  municipality: string;
  propertyType: Scenario["property"]["type"];
  listPrice: number;
  status: NegotiationStatus | "closed" | "terminated";
}

export function summarize(s: Scenario, n: Negotiation | null): ScenarioSummary {
  const tx = n?.transaction?.status;
  return {
    id: s.id,
    createdAt: s.createdAt,
    role: s.userRole,
    region: s.market.region,
    municipality: s.property.address.municipality,
    propertyType: s.property.type,
    listPrice: s.property.listPrice,
    status: n?.status === "sold_to_other" ? "sold_to_other" : tx === "closed" || tx === "terminated" ? tx : (n?.status ?? "negotiating"),
  };
}
