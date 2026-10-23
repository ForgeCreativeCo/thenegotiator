// Writes the scenario's story with Claude. Numbers come from the engine; Claude only writes words around them.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Narrative, ScenarioParams } from "../engine/types";
import { findInventedAmounts } from "../engine/validate";
import { NarrativeSchema } from "./schema";
import { offerNightWhen } from "./offline";
import { FINANCING_LABELS, MOTIVATION_LABELS, typeLabel } from "./format";

const MODEL = process.env.SCENARIO_MODEL || "claude-opus-5-5";

const SYSTEM_PROMPT = `You write realistic Ontario residential real estate scenarios for a negotiation training simulator used by a working Ontario real estate salesperson.

A game engine has already decided every fact and number. Your job is to write the human story around them: MLS listing copy, the clients' backstories and private instructions to their agents, and the persona of the opposing agent.

Rules:
- This is Ontario, Canada. Use Ontario terms and practice: brokerages and RECO-registered salespeople and brokers, the Agreement of Purchase and Sale, deposits, conditions, completion dates, real estate lawyers, land transfer tax, status certificates, the SPIS. Never use US terms (escrow, earnest money, title company, HOA, contingency, closing costs credit, Realtor® as a title).
- All prices are in Canadian dollars. Use only the dollar amounts, dates, and facts in the scenario data. Do not invent new prices, payoffs, appraisal values, repair costs, or other figures. Rounding a given figure in casual speech ("about $1.2 million") is fine.
- Hidden ground truth (findings the seller did not disclose, the lender's appraisal, mortgage problems, title issues, competing offers) must NOT appear in public listing text or the opening situations. The seller's private notes may mention a problem only if the data says the seller knew about it.
- Public text (headline, remarks, neighbourhood, market snapshot, agent bio) must not reveal either client's private limits or motivations beyond what a real MLS listing would say. Follow RECO advertising rules: no misleading claims.
- Each client's "whatTheyveToldYou" is what they said privately to their own agent. State their limits (price, completion window, deposit, condition limits, and anything else in their brief) the way a real client would, with emotion and personality.
- The opposing agent is a broker with 30 years of experience who closes 30 to 40 transactions a year. Their voice must match the given temperament, and they follow the RECO Code of Ethics. Give them a believable name and a fictional brokerage whose name ends in "Brokerage" (e.g. "Lakeview Realty Inc., Brokerage"). Never use real brokerage names.
- Write like a real person. Avoid cliches like "nestled", "boasts", "dream home awaits". Use Canadian spelling (neighbourhood, centre).
- Use local colour that fits the Ontario region, but don't depend on specific real businesses.`;

function buildPrompt(p: ScenarioParams): string {
  const botSide = p.userRole === "buyer_agent" ? "seller" : "buyer";
  const brief = {
    userRole: p.userRole,
    opposingAgentRepresents: botSide,
    opposingAgentTemperament: p.difficulty.temperament,
    propertyTypeLabel: typeLabel(p.property.type),
    market: p.market,
    property: p.property,
    offerNight: p.offerNight ? { offersReviewed: offerNightWhen(p), preemptiveOffers: p.offerNight.preemptives } : null,
    comps: p.comps,
    disclosures: p.disclosures,
    seller: { ...p.seller, motivationDescription: MOTIVATION_LABELS[p.seller.motivation] },
    buyer: { ...p.buyer, motivationDescription: MOTIVATION_LABELS[p.buyer.motivation], financingDescription: FINANCING_LABELS[p.buyer.financing] },
    hiddenGroundTruth_DoNotRevealPublicly: {
      undisclosedIssuesSellerKnewAbout: [...p.groundTruth.inspectionFindings, ...p.groundTruth.typeSpecificIssues]
        .filter((f) => f.sellerKnew && !f.disclosed)
        .map((f) => f.title),
    },
  };
  return `Write the narrative for this scenario. Scenario data:\n\n${JSON.stringify(brief, null, 2)}`;
}

export class NarrativeError extends Error {}

export async function writeClaudeNarrative(p: ScenarioParams, client = new Anthropic()): Promise<Narrative> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: buildPrompt(p) }];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      output_config: { effort: "medium", format: betaZodOutputFormat(NarrativeSchema) },
      messages,
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") throw new NarrativeError(`Claude declined to write this scenario (${response.stop_details?.category ?? "no category"})`);
    if (response.stop_reason === "max_tokens") throw new NarrativeError("Scenario story was cut off at the token limit");
    const narrative = response.parsed_output;
    if (!narrative) throw new NarrativeError("Claude's response did not match the narrative schema");

    const invented = findInventedAmounts(narrative, p);
    if (invented.length === 0) return narrative;
    if (attempt === 2) throw new NarrativeError(`Story invented dollar amounts: ${invented.join(", ")}`);

    // Append-only correction turn so the second attempt sees what it got wrong.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: `These dollar amounts are not in the scenario data: ${invented.join(", ")}. Rewrite the full narrative using only amounts from the data.`,
    });
  }
  throw new NarrativeError("unreachable");
}
