import type { LoanType, PropertyType } from "../engine/types";
import { PROPERTY_TYPES } from "../engine/properties";

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function typeLabel(type: PropertyType): string {
  return PROPERTY_TYPES[type].label;
}

export const LOAN_LABELS: Record<LoanType, string> = {
  cash: "cash",
  conventional: "conventional loan",
  fha: "FHA loan",
  va: "VA loan",
  usda: "USDA loan",
  jumbo: "jumbo loan",
};

export const MOTIVATION_LABELS: Record<string, string> = {
  relocation: "relocating for work",
  divorce: "selling as part of a divorce",
  estate: "selling a parent's estate",
  downsizing: "downsizing",
  upsizing: "moving up to a bigger home",
  financial_strain: "under financial pressure",
  investor_exit: "an investor cashing out",
  retirement_move: "retiring and moving away",
  tired_landlord: "a tired landlord ready to be done",
  builder: "a builder selling a new home",
  testing_the_market: "testing the market with no real need to sell",
  first_time: "first-time buyers",
  growing_family: "a growing family needing more space",
  move_up: "moving up from a starter home",
  downsizer: "empty nesters downsizing",
  investor: "an investor",
  lease_ending: "renters whose lease is ending",
  dream_home_builder: "planning to build their dream home",
};
