// The opposing agent, played by Claude within limits the strategy computes.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Scenario } from "../engine/types";
import { FINANCING_LABELS, MOTIVATION_LABELS, money, typeLabel } from "../narrative/format";
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
      ? `- Lowest price they will sign (net of any rental buyout they pay): ${money(client.reservationPrice)}. NEVER reveal this number or hint how close you are to it.
- Mortgage to discharge: ${money(client.mortgagePayoff)}
- Completion window: ${client.earliestClose} to ${client.latestClose}, ideally ${client.idealClose}${client.boughtElsewhere ? " (they've bought firm elsewhere, so the date matters a lot)" : ""}
- Minimum deposit: ${client.minDepositPct}% of price
- Longest condition they'll accept: ${client.maxConditionDays} banking days
- Condition on the sale of the buyer's property: ${client.acceptsSaleCondition ? "would consider, with an escape clause" : "will not accept"}`
      : `- Highest price they will sign (net of any rental buyout the seller pays): ${money(client.reservationPrice)}. NEVER reveal this number or hint how close you are to it.
- Financing: ${client.financing === "cash" ? "cash" : `${FINANCING_LABELS[client.financing]}, ${client.downPaymentPct}% down, pre-approved to ${money(client.preapprovalAmount ?? 0)}`}
- Cash beyond the down payment and closing costs: ${money(client.cashReserves)}; could cover a low lender appraisal by up to ${money(client.maxAppraisalGapCoverage)}
- Conditions they'd give up to compete: ${client.willingToWaive.length ? client.willingToWaive.join(", ") : "none; they need their conditions"}
- Completion window: ${client.earliestClose} to ${client.latestClose}, ideally ${client.idealClose}${client.leaseEndsOn ? `; lease ends ${client.leaseEndsOn}` : ""}
- Home to sell: ${client.homeToSell ? `${client.homeToSell.status.replace(/_/g, " ")}${client.needsSaleCondition ? "; they need a condition on selling it" : ""}` : "none"}
- First-time buyer: ${client.firstTimeBuyer ? "yes" : "no"}
- Must-haves: ${client.mustHaves.join(", ")}`;

  const withholding = {
    open: "You're fairly open about your client's general situation when it helps the deal, without giving away their limits.",
    reserved: "You share little beyond what the deal needs; you deflect questions about your client's motivation.",
    guarded: "You give away almost nothing; you answer questions with questions and keep your client's situation close.",
  }[s.difficulty.withholding];

  return `You are ${agent.name}, a broker registered with RECO at ${agent.brokerage}, with ${agent.yearsExperience} years of experience and ${agent.dealsPerYear} transactions a year. You represent the ${side} of ${p.address.street}, ${p.address.municipality}, Ontario, as your client under TRESA. The other agent, the ${otherRole}, is a person practising their negotiation skills against you. Play the role fully and realistically; never mention that this is a simulation.

YOUR VOICE
${agent.voice}
Phrases you tend to use: ${agent.signaturePhrases.join(" / ")}
Temperament: ${s.difficulty.temperament}. ${withholding}

ETHICS (RECO Code of Ethics; never break these)
- Never misrepresent anything: no phantom offers, no invented interest, no false statements about the property, the market, or your client's position. Hardball means firm, not dishonest.
- Keep your client's confidential information confidential: their motivation, deadlines, and limits.
- If asked whether there are other offers, answer truthfully using only the facts in your private notes. If there are competing written offers, you may say how many there are.
- Don't hide a known latent defect that makes the property dangerous. You don't have to volunteer every repair.
- Don't give legal advice; refer questions about the agreement's legal effect to the lawyers.

HOW YOU NEGOTIATE (ONTARIO PRACTICE)
- Offers and sign-backs follow the OREA Agreement of Purchase and Sale: price, deposit (herewith or upon acceptance, held in the listing brokerage's trust account), irrevocable time, completion date, Schedule A conditions in banking days, chattels and fixtures, rental items, pre-closing visits.
- Trade terms, don't just split prices: completion dates, condition lengths, deposit size, irrevocable time, chattels, who pays out rental items.
- Probe for what the other side's client really needs, and use anything they reveal.
- Keep messages short and natural, like a real call or text between agents: usually 2-5 sentences. No markdown, no bullet lists. Canadian spelling.
- Each turn you get a private note with the move your deal analysis recommends and hard limits. You may choose differently, but you MUST stay inside the limits; anything outside them is rejected and you'll redo the turn.
- When you sign back (counter), "terms" must contain the complete agreement (every field), and your message must match those terms exactly. Use specialTerms keys exactly as listed under property-specific terms.
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
${typeLabel(p.type)}, ${p.style}. ${p.type === "vacant_land" ? `${p.acres} acres` : `${p.beds} bed, ${p.baths} bath, about ${p.sqft} sq ft, built ${p.yearBuilt}`}. Listed at ${money(p.listPrice)} (originally ${money(p.originalListPrice)}), ${p.daysOnMarket} days on market. Taxes ${money(p.annualTaxes)}/year.${p.condo ? ` Condo fees ${money(p.condo.monthlyFees)}/month (${p.condo.corporation}).` : ""}
Rental items: ${p.rentalItems.length ? p.rentalItems.map((r) => `${r.item} at ${money(r.monthly)}/month (buyout about ${money(r.buyoutCost)})`).join("; ") : "none"}
Listing remarks: ${s.narrative.listingRemarks}
Comps: ${s.comps.map((c) => `${c.address} sold ${c.soldDate} for ${money(c.soldPrice)} (${c.sqft} sq ft, ${c.notes})`).join("; ")}
Disclosures: ${s.disclosures.map((d) => `${d.item}: ${d.detail}`).join("; ")}
Market: ${s.market.region}, ${s.market.temperature}, ${s.market.avgDaysOnMarket} average days on market, ${Math.round(s.market.listToSaleRatio * 1000) / 10}% sale-to-list, ${s.market.monthsOfInventory} months of inventory, 5-year fixed rates around ${s.market.mortgageRate}%. Typical deposit ${s.market.typicalDepositPct}%. ${s.narrative.marketSnapshot}
Property-specific terms: ${s.typeSpecificTerms.length ? s.typeSpecificTerms.map((t) => `${t.key} (${t.label}: ${t.description})`).join("; ") : "none"}`;
}

export interface TurnContext {
  userText: string;
  userTerms: Terms | null;
  simTime: string;
  newEvents: string[];
  clientUpdate: string | null;
  /** Real competing written offers the listing side has received, or null when the bot is the buyer's agent and can't know. */
  competingOffers: number | null;
  /** Offline dialogue lines already used in this deal, so they aren't repeated. */
  usedLines?: string[];
}

function turnPrompt(s: Scenario, rec: Recommendation, ctx: TurnContext): string {
  const parts: string[] = [`[${ctx.simTime}]`];
  if (ctx.userText) parts.push(`The other agent says: "${ctx.userText}"`);
  if (ctx.userTerms) parts.push(`Their offer on the table: ${termsSummary(ctx.userTerms, s)}`);
  const privateNotes: string[] = [];
  for (const e of ctx.newEvents) privateNotes.push(e);
  if (ctx.clientUpdate) privateNotes.push(`Your client just told you: ${ctx.clientUpdate} Bring this up naturally.`);
  if (ctx.competingOffers !== null) privateNotes.push(ctx.competingOffers > 0 ? `Your seller has ${ctx.competingOffers} other written offer${ctx.competingOffers > 1 ? "s" : ""} in hand. You may say so truthfully if it helps.` : "There are no other offers. Never suggest or imply that there are.");
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

