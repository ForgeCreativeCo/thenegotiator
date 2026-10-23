import { randomUUID } from "node:crypto";
import type { Narrative, Scenario } from "./engine/types";
import { generateParams, type GenerateOptions } from "./engine/params";
import { validateParams } from "./engine/validate";
import { writeOfflineNarrative } from "./narrative/offline";
import { writeClaudeNarrative } from "./narrative/claude";

export function hasClaudeCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export interface GenerateResult {
  scenario: Scenario;
  warnings: string[];
}

export async function generateScenario(options: GenerateOptions & { offline?: boolean } = {}): Promise<GenerateResult> {
  const warnings: string[] = [];

  // Parameters are cheap; regenerate with a fresh seed if a draw fails validation.
  let params = generateParams(options);
  for (let tries = 0; validateParams(params).length > 0; tries++) {
    if (options.seed !== undefined || tries >= 20) throw new Error(`Scenario parameters failed validation: ${validateParams(params).join("; ")}`);
    params = generateParams({ ...options, seed: undefined });
  }

  let narrative: Narrative;
  let narrativeSource: Scenario["narrativeSource"] = "offline";
  if (!options.offline && hasClaudeCredentials()) {
    try {
      narrative = await writeClaudeNarrative(params);
      narrativeSource = "claude";
    } catch (error) {
      warnings.push(`Claude story writer failed, used the offline writer instead: ${(error as Error).message}`);
      narrative = writeOfflineNarrative(params);
    }
  } else {
    narrative = writeOfflineNarrative(params);
  }

  const scenario: Scenario = { ...params, id: randomUUID(), createdAt: new Date().toISOString(), narrative, narrativeSource };
  return { scenario, warnings };
}
