// Progress across all practice deals: per-deal scores from the debrief, plus totals and trends.

import type { Negotiation } from "../negotiation/types";
import type { Role, Scenario } from "../engine/types";
import type { ComplianceFlag } from "./compliance";
import { buildDebrief, debriefAvailable } from "./debrief";

export interface ProgressDeal {
  id: string;
  createdAt: string;
  role: Role;
  region: string;
  propertyType: string;
  listPrice: number;
  status: "not_started" | "in_progress" | "finished";
  outcome: string | null;
  scores: { overall: number; outcome: number; process: number; compliance: number } | null;
  difficulty: string | null;
  complianceRules: ComplianceFlag["rule"][];
}

export interface Progress {
  deals: ProgressDeal[];
  totals: {
    played: number;
    finished: number;
    completed: number;
    averageOverall: number | null;
    recentOverall: number | null;
    breaches: number;
    byRole: Record<Role, { finished: number; averageOverall: number | null }>;
    byRule: Record<ComplianceFlag["rule"], number>;
  };
}

function average(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

export async function buildProgress(entries: { scenario: Scenario; negotiation: Negotiation | null }[]): Promise<Progress> {
  const deals: ProgressDeal[] = [];
  const byRule: Progress["totals"]["byRule"] = { confidentiality: 0, misrepresentation: 0, disclosure_direction: 0, client_instructions: 0, legal_advice: 0, count_rule: 0, client_duty: 0 };
  let breaches = 0;
  let completed = 0;
  for (const { scenario: s, negotiation: n } of entries) {
    const base = { id: s.id, createdAt: s.createdAt, role: s.userRole, region: s.market.region, propertyType: s.property.type, listPrice: s.property.listPrice };
    if (!n || n.messages.length === 0) {
      deals.push({ ...base, status: "not_started", outcome: null, scores: null, difficulty: null, complianceRules: [] });
      continue;
    }
    if (!debriefAvailable(n)) {
      deals.push({ ...base, status: "in_progress", outcome: null, scores: null, difficulty: null, complianceRules: [] });
      continue;
    }
    // Offline scoring only: the progress page never calls Claude.
    const d = await buildDebrief(s, n, false);
    for (const f of d.compliance) {
      byRule[f.rule]++;
      if (f.severity === "breach") breaches++;
    }
    if (d.outcome.kind === "completed" || d.outcome.kind === "sold_to_other") completed++;
    deals.push({ ...base, status: "finished", outcome: d.outcome.label, scores: d.scores, difficulty: d.difficulty.rating, complianceRules: d.compliance.map((f) => f.rule) });
  }
  const finished = deals.filter((d) => d.scores);
  const overall = finished.map((d) => d.scores!.overall);
  const roleStats = (role: Role) => {
    const mine = finished.filter((d) => d.role === role);
    return { finished: mine.length, averageOverall: average(mine.map((d) => d.scores!.overall)) };
  };
  return {
    deals,
    totals: {
      played: deals.filter((d) => d.status !== "not_started").length,
      finished: finished.length,
      completed,
      averageOverall: average(overall),
      recentOverall: average(overall.slice(-5)),
      breaches,
      byRole: { buyer_agent: roleStats("buyer_agent"), seller_agent: roleStats("seller_agent") },
      byRule,
    },
  };
}
