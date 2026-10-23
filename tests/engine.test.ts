import { describe, expect, it } from "vitest";
import { generateParams } from "../server/engine/params";
import { validateParams, findInventedAmounts } from "../server/engine/validate";
import { userView } from "../server/engine/views";
import { writeOfflineNarrative } from "../server/narrative/offline";
import type { PropertyType, Scenario, ScenarioParams } from "../server/engine/types";

const SEEDS = Array.from({ length: 2000 }, (_, i) => i * 7919 + 13);
const START = "2026-10-23";

function scenarioFrom(params: ScenarioParams): Scenario {
  return { ...params, id: "test", createdAt: "2026-10-23T00:00:00Z", narrative: writeOfflineNarrative(params), narrativeSource: "offline" };
}

describe("parameter generation", () => {
  it("is deterministic for a given seed", () => {
    expect(generateParams({ seed: 42, startDate: START })).toEqual(generateParams({ seed: 42, startDate: START }));
  });

  it("produces valid parameters across many seeds", () => {
    const failures: string[] = [];
    for (const seed of SEEDS) {
      const problems = validateParams(generateParams({ seed, startDate: START }));
      if (problems.length) failures.push(`seed ${seed}: ${problems.join("; ")}`);
    }
    // A small failure rate is tolerable (the service redraws), but it should be rare.
    expect(failures.length / SEEDS.length, failures.slice(0, 5).join("\n")).toBeLessThan(0.01);
  });

  it("covers every property type, both roles, and every difficulty rating", () => {
    const types = new Set<PropertyType>();
    const roles = new Set<string>();
    const ratings = new Set<string>();
    for (const seed of SEEDS) {
      const p = generateParams({ seed, startDate: START });
      types.add(p.property.type);
      roles.add(p.userRole);
      ratings.add(p.difficulty.rating);
    }
    expect(types.size).toBe(9);
    expect(roles).toEqual(new Set(["buyer_agent", "seller_agent"]));
    expect(ratings).toEqual(new Set(["easy", "moderate", "hard", "brutal"]));
  });

  it("makes no-deal scenarios impossible on price and other scenarios possible", () => {
    for (const seed of SEEDS.slice(0, 500)) {
      const p = generateParams({ seed, startDate: START });
      const zopa = p.buyer.reservationPrice - p.seller.reservationPrice;
      if (p.difficulty.dealSpace === "none") expect(zopa).toBeLessThan(0);
      else expect(zopa).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the deal near market value", () => {
    for (const seed of SEEDS.slice(0, 500)) {
      const p = generateParams({ seed, startDate: START });
      const value = p.groundTruth.marketValue;
      expect(p.seller.reservationPrice / value).toBeGreaterThan(0.9);
      expect(p.buyer.reservationPrice / value).toBeLessThan(1.1);
    }
  });

  it("gives type-specific terms and features to special property types", () => {
    for (const seed of SEEDS.slice(0, 500)) {
      const p = generateParams({ seed, startDate: START });
      if (p.property.type === "condo") expect(p.property.hoa).not.toBeNull();
      if (p.property.type === "multifamily") expect(p.property.units?.length).toBeGreaterThanOrEqual(2);
      if (p.property.type === "land") expect(p.property.beds).toBe(0);
      if (p.property.type !== "single_family") expect(p.typeSpecificTerms.length).toBeGreaterThan(0);
      if (p.buyer.loanType === "cash") expect(p.groundTruth.financing).toEqual([]);
    }
  });
});

describe("user view", () => {
  it("never includes the other side's brief, ground truth, or difficulty", () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const scenario = scenarioFrom(generateParams({ seed, startDate: START }));
      const view = userView(scenario);
      const json = JSON.stringify(view);
      const other = scenario.userRole === "buyer_agent" ? scenario.seller : scenario.buyer;
      const otherStory = scenario.userRole === "buyer_agent" ? scenario.narrative.sellerStory : scenario.narrative.buyerStory;

      expect(view.yourClient.brief.side).toBe(scenario.userRole === "buyer_agent" ? "buyer" : "seller");
      expect(json).not.toContain("groundTruth");
      expect(json).not.toContain("difficulty");
      expect(json).not.toContain(otherStory.whatTheyveToldYou);
      expect(json).not.toContain("signaturePhrases");
      if (other.reservationPrice !== view.yourClient.brief.reservationPrice) {
        expect(json).not.toContain(`"reservationPrice":${other.reservationPrice}`);
      }
      for (const finding of scenario.groundTruth.inspectionFindings.filter((f) => !f.disclosed)) {
        expect(json).not.toContain(finding.title);
      }
    }
  });
});

describe("invented amount check", () => {
  it("accepts the offline narrative and flags a made-up price", () => {
    const params = generateParams({ seed: 99, startDate: START });
    const narrative = writeOfflineNarrative(params);
    expect(findInventedAmounts(narrative, params)).toEqual([]);
    const tampered = { ...narrative, listingRemarks: `${narrative.listingRemarks} Seller paid $9,876,543 for upgrades.` };
    expect(findInventedAmounts(tampered, params)).toEqual(["$9,876,543"]);
  });
});
