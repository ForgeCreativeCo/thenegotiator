import type { ConditionKey, FinancingType, PropertyType } from "../engine/types";
import { PROPERTY_TYPES } from "../engine/properties";

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

export function displayDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function typeLabel(type: PropertyType): string {
  return PROPERTY_TYPES[type].label;
}

export const FINANCING_LABELS: Record<FinancingType, string> = {
  cash: "cash",
  insured: "insured mortgage (CMHC)",
  conventional: "conventional mortgage",
  alternative: "B-lender mortgage",
};

export const CONDITION_LABELS: Record<ConditionKey, string> = {
  financing: "Financing",
  inspection: "Home inspection",
  status_certificate: "Status certificate review",
  lawyer_review: "Lawyer's review",
  insurance: "Insurance",
  sale_of_property: "Sale of buyer's property",
  water_septic: "Water and septic",
};

/** Vacant land has a due diligence condition rather than a home inspection. */
export function conditionLabel(key: ConditionKey, type: PropertyType): string {
  return key === "inspection" && type === "vacant_land" ? "Due diligence" : CONDITION_LABELS[key];
}

export const MOTIVATION_LABELS: Record<string, string> = {
  relocation: "relocating for work",
  separation: "selling after a separation",
  estate: "selling a parent's estate",
  downsizing: "downsizing",
  bought_firm_elsewhere: "already bought another home firm",
  financial_strain: "under financial pressure",
  investor_exit: "an investor cashing out",
  retirement_move: "retiring and moving away",
  tired_landlord: "a tired landlord ready to be done",
  builder: "a builder selling inventory",
  testing_the_market: "testing the market with no real need to sell",
  first_time: "first-time buyers",
  growing_family: "a growing family needing more space",
  move_up: "moving up from a starter home",
  downsizer: "empty nesters downsizing",
  investor: "an investor",
  lease_ending: "renters whose lease is ending",
  newcomer: "newcomers to Canada buying their first home here",
  cottage_seeker: "looking for a family cottage",
  home_builder: "planning to build a home",
};
