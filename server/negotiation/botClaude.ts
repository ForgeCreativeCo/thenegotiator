// The opposing agent, played by Claude within limits the strategy computes.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Scenario } from "../engine/types";
import { LOAN_LABELS, MOTIVATION_LABELS, money, typeLabel } from "../narrative/format";
import { TermsSchema, normalizeTerms, termsSummary, type Terms } from "./terms";
import { botSide, validateBotCounter, type Recommendation } from "./strategy";
import type { BotTurn } from "./botOffline";

const MODEL = process.env.BOT_MODEL || "claude-opus-5-5";

const BotTurnSchema = z.object({
  internalNote: z.string().describe("Your private reasoning for this move: what you think the other side wants and why you chose this. Never shown to the other agent."),
  action: z.enum(["counter", "accept", "reject", "hold", "walk"]),
  terms: TermsSchema.nullable().describe("Full terms of your counteroffer when action is counter; otherwise null."),
  message: z.string().describe("What you say to the other agent, as a phone call or text. Plain prose, no markdown."),
});

export function systemPrompt(s: Scenario): string {
  const side = botSide(s);
  const agent = s.narrative.opposingAgent;
  const client = side === "seller" ? s.seller : s.buyer;
  const story = side === "seller" ? s.narrative.sellerStory : s.narrative.buyerStory;
  const p = s.property;
  const otherRole = side === "seller" ? "buyer's agent" : "listing agent";

  const clientNumbers =
    client.side === "seller"
      ? `- Lowest net price they will sign (price minus seller credits and warranty): ${money(client.reservationPrice)}. NEVER reveal this number or hint how close you are to it.
- Most they'll give in credits and warranty combined: ${money(client.maxConcessions)}
- Mortgage payoff: ${money(client.mortgagePayoff)}
- Closing window: ${client.earliestClose} to ${client.latestClose}, ideally ${client.idealClose}
- Rent-back needed after closing: ${client.needsRentBackDays ? `${client.needsRentBackDays} days` : "none"}
- Acceptable financing: ${client.acceptableLoanTypes.map((l) => LOAN_LABELS[l]).join(", ")}
- Home sale contingency: ${client.acceptsHomeSaleContingency ? "would consider" : "will not accept"}`
      : `- Highest net price they will sign (price minus seller credits): ${money(client.reservationPrice)}. NEVER reveal this number or hint how close you are to it.
- Financing: ${client.loanType === "cash" ? "cash" : `${LOAN_LABELS[client.loanType]}, ${client.downPaymentPct}% down, pre-approved to ${money(client.preapprovalAmount ?? 0)}`}
- Cash reserves: ${money(client.cashReserves)}; could cover an appraisal gap up to ${money(client.maxAppraisalGapCoverage)}
- Willing to waive: ${client.willingToWaive.length ? client.willingToWaive.join(", ") : "nothing"}
- Closing window: ${client.earliestClose} to ${client.latestClose}, ideally ${client.idealClose}${client.leaseEndsOn ? `; lease ends ${client.leaseEndsOn}` : ""}
- Home to sell: ${client.homeToSell ? `${client.homeToSell.status.replace(/_/g, " ")}` : "none"}
- Must-haves: ${client.mustHaves.join(", ")}`;

  return `You are ${agent.name} of ${agent.brokerage}, a residential real estate agent with ${agent.yearsExperience} years of experience who closes ${agent.dealsPerYear} transactions a year. You represent the ${side} of ${p.address.street}, ${p.address.city}, ${p.address.stateCode}. The other agent, the ${otherRole}, is a person practicing their negotiation skills against you. Play the role fully and realistically; never mention that this is a simulation.

YOUR VOICE
${agent.voice}
Phrases you tend to use: ${agent.signaturePhrases.join(" / ")}
Temperament: ${s.difficulty.temperament}. Bluffing: ${s.difficulty.bluffing === "never" ? "never bluff; you don't imply things that aren't true" : s.difficulty.bluffing === "subtle" ? "you may be vague about other interest or your client's flexibility, but never state a falsehood about a specific written offer" : "you may imply other interest or firmness that isn't real, but never invent a specific written offer with numbers"}.

HOW YOU NEGOTIATE
- You are protective of your client and you know the business cold. Justify numbers with the comps and market data.
- Trade terms, don't just split prices: closing dates, rent-backs, credits, contingency lengths, inclusions.
- Probe for what the other side's client really needs. Use anything they reveal.
- Keep messages short and natural, like a real call or text between agents: usually 2-5 sentences. No markdown, no bullet lists.
- Each turn you receive a private note from your own deal analysis with the move it recommends and hard limits. You may choose a different action or adjust terms, but you MUST stay inside the limits; violations are rejected and you'll have to redo the turn.
- When you counter, "terms" must contain the complete counteroffer (every field), and your message must match those terms exactly. Use specialTerms keys exactly as listed under property-specific terms.
- When you accept, you accept the other side's latest offer exactly as written; set terms to null.

YOUR CLIENT (confidential)
${story.clientNames}. ${story.backstory} ${story.motivationStory}
What they told you: ${story.whatTheyveToldYou}
Situation: ${MOTIVATION_LABELS[client.motivation] ?? client.motivation}; urgency ${client.urgency} of 5.
${clientNumbers}
Non-negotiables: ${story.nonNegotiables.join("; ")}
Soft spots: ${story.softSpots.join("; ")}
Quirks: ${story.quirks.join("; ")}

THE PROPERTY (public)
${typeLabel(p.type)}. ${p.type === "land" ? `${p.lotAcres} acres` : `${p.beds} bed, ${p.baths} bath, ${p.sqft} sq ft, built ${p.yearBuilt}`}. Listed at ${money(p.listPrice)} (originally ${money(p.originalListPrice)}), ${p.daysOnMarket} days on market.
Listing remarks: ${s.narrative.listingRemarks}
Comps: ${s.comps.map((c) => `${c.address} sold ${c.soldDate} for ${money(c.soldPrice)} (${c.sqft} sq ft, ${c.notes})`).join("; ")}
Disclosures: ${s.disclosures.map((d) => `${d.item}: ${d.detail}`).join("; ")}
Market: ${s.market.temperature}, ${s.market.avgDaysOnMarket} average days on market, ${Math.round(s.market.listToSaleRatio * 1000) / 10}% sale-to-list, ${s.market.monthsOfInventory} months of inventory, rates around ${s.market.mortgageRate}%. ${s.narrative.marketSnapshot}
Local customs: closings by ${s.market.customs.closing.replace("_", " ")}; ${s.market.customs.optionPeriod ? "a paid option period is customary instead of an inspection contingency; " : ""}typical earnest money ${s.market.customs.typicalEarnestMoneyPct}%.
Property-specific terms: ${s.typeSpecificTerms.length ? s.typeSpecificTerms.map((t) => `${t.key} (${t.label}: ${t.description})`).join("; ") : "none"}`;
}

export interface TurnContext {
  userText: string;
  userTerms: Terms | null;
  simTime: string;
  newEvents: string[];
  clientUpdate: string | null;
}

function turnPrompt(s: Scenario, rec: Recommendation, ctx: TurnContext): string {
  const parts: string[] = [`[${ctx.simTime}]`];
  if (ctx.userText) parts.push(`The other agent says: "${ctx.userText}"`);
  if (ctx.userTerms) parts.push(`Their offer on the table: ${termsSummary(ctx.userTerms, s)}`);
  const privateNotes: string[] = [];
  for (const e of ctx.newEvents) privateNotes.push(e);
  if (ctx.clientUpdate) privateNotes.push(`Your client just told you: ${ctx.clientUpdate} Bring this up naturally.`);
  privateNotes.push(`Recommended move: ${rec.action}. ${rec.reasoning}`);
  if (rec.terms) privateNotes.push(`Recommended terms: ${termsSummary(rec.terms, s)}`);
  privateNotes.push(`Your current price: ${money(rec.currentPrice)} (net ${money(rec.currentNet)}). Your client's limit (net): ${money(rec.reservationNet)}. Most you may concede this turn: ${money(rec.maxConcession)}.`);
  if (rec.userOfferViolations.length) privateNotes.push(`Your client will NOT sign their offer as written: ${rec.userOfferViolations.join("; ")}.`);
  privateNotes.push(`Accepting their offer is ${rec.acceptAllowed ? "allowed" : "NOT allowed"} this turn. Walking away is ${rec.walkAllowed || rec.action === "walk" ? "allowed" : "NOT allowed"} this turn.`);
  parts.push(`PRIVATE (only you can see this):\n${privateNotes.map((n) => `- ${n}`).join("\n")}`);
  return parts.join("\n\n");
}

function validateTurn(s: Scenario, rec: Recommendation, turn: z.infer<typeof BotTurnSchema>): string[] {
  switch (turn.action) {
    case "counter":
      if (!turn.terms) return ["A counter needs the full terms."];
      return validateBotCounter(s, rec, normalizeTerms(turn.terms));
    case "accept":
      return rec.acceptAllowed ? [] : ["You can't accept their offer this turn; your client won't sign it or it's too early to take it."];
    case "walk":
      return rec.walkAllowed || rec.action === "walk" ? [] : ["It's too early to walk away. Counter, hold, or reject instead."];
    default:
      return [];
  }
}

export class BotError extends Error {}

/**
 * Plays one turn. Appends to `history` in place (append-only, including thinking blocks), so the caller
 * can persist it. Throws BotError if Claude can't produce a valid turn in two tries.
 */
export async function claudeTurn(s: Scenario, rec: Recommendation, ctx: TurnContext, history: Anthropic.Beta.BetaMessageParam[], client = new Anthropic()): Promise<BotTurn & { issues: string[] }> {
  history.push({ role: "user", content: turnPrompt(s, rec, ctx) });
  const issuesSeen: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: systemPrompt(s),
      output_config: { effort: "medium", format: betaZodOutputFormat(BotTurnSchema) },
      messages: history,
    });
    const response = await stream.finalMessage();
    if (response.stop_reason === "refusal") throw new BotError(`Claude declined this turn (${response.stop_details?.category ?? "no category"})`);
    if (response.stop_reason === "max_tokens") throw new BotError("Bot turn was cut off at the token limit");
    const turn = response.parsed_output;
    history.push({ role: "assistant", content: response.content });
    if (!turn) throw new BotError("Bot response did not match the schema");

    const issues = validateTurn(s, rec, turn);
    if (issues.length === 0) {
      const terms = turn.action === "counter" && turn.terms ? normalizeTerms(turn.terms) : null;
      return { action: turn.action, terms, message: turn.message, internalNote: turn.internalNote, issues: issuesSeen };
    }
    issuesSeen.push(...issues);
    history.push({ role: "user", content: `PRIVATE: That move isn't allowed. ${issues.join(" ")} Redo your turn.` });
  }
  throw new BotError(`Bot turn failed validation twice: ${issuesSeen.join(" ")}`);
}

