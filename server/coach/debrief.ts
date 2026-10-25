// The debrief: reveals both sides and the hidden facts, scores the outcome, the process, and RECO compliance,
// and gives the veteran's critique (Claude when available, otherwise built from the scores).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { BuyerBrief, ClientStory, Finding, HiddenDifficulty, Scenario, SellerBrief } from "../engine/types";
import { displayDate, money } from "../narrative/format";
import { netPrice } from "../negotiation/constraints";
import type { Negotiation } from "../negotiation/types";
import { hasClaudeCredentials } from "../scenarioService";
import { complianceScore, reviewCompliance, type ComplianceFlag } from "./compliance";
import { clientFacts } from "../client/facts";
import { acceptedCompetitor, allCompetitors } from "../negotiation/listing";
import type { UncoveredHow } from "../client/types";

const MODEL = process.env.BOT_MODEL || "claude-opus-5-5";

export interface Critique {
  wentWell: string[];
  toImprove: string[];
  keyMoment: string;
  source: "claude" | "offline";
}

export interface Debrief {
  outcome: { kind: string; label: string; summary: string };
  scores: { outcome: number; process: number; compliance: number; overall: number };
  dealSpace: { sellerFloor: number; buyerCeiling: number; listPrice: number; marketValue: number; possible: boolean; finalNet: number | null; yourShare: number | null };
  clients: { seller: { brief: SellerBrief; story: ClientStory }; buyer: { brief: BuyerBrief; story: ClientStory } };
  yourSide: "buyer" | "seller";
  difficulty: HiddenDifficulty;
  hidden: {
    appraisedValue: number;
    findings: (Finding & { revealed: boolean })[];
    titleIssues: string[];
    loanEvents: string[];
    visitSurprises: string[];
    competingOffers: { label: string; price: number; strength: string; conditions: string; status: string }[];
  };
  agentReasoning: { at: number; message: string; note: string; source: string }[];
  /** What your own client never told you up front, and how (or whether) you found out. */
  clientFacts: { summary: string; how: UncoveredHow | "never" }[];
  processNotes: { good: boolean; text: string }[];
  compliance: ComplianceFlag[];
  critique: Critique;
}

export function debriefAvailable(n: Negotiation): boolean {
  return n.status === "dead" || n.status === "lost" || n.status === "sold_to_other" || (n.transaction !== null && n.transaction.status !== "active");
}

/** The user's client's final net price, when a deal was done. */
function finalNet(s: Scenario, n: Negotiation): number | null {
  const tx = n.transaction;
  if (tx?.status === "closed") {
    const base = netPrice(s, tx.terms) - tx.creditsOnClosing - tx.repairsAgreed;
    return base;
  }
  if (n.status === "sold_to_other") {
    const c = acceptedCompetitor(n) ?? n.offerNight?.competitors.find((x) => x.id === n.offerNight?.outcome?.competitorId);
    return c ? netPrice(s, c.terms) : null;
  }
  return null;
}

function outcomeOf(s: Scenario, n: Negotiation): Debrief["outcome"] {
  const tx = n.transaction;
  if (n.status === "sold_to_other") {
    const c = acceptedCompetitor(n) ?? n.offerNight?.competitors.find((x) => x.id === n.offerNight?.outcome?.competitorId);
    const what = c ? `${c.label} at ${money(c.terms.price)}` : "a competing offer";
    return { kind: "sold_to_other", label: "Sold to another buyer", summary: tx?.outcome ? `After the first agreement ended (${tx.outcome.reason.replace(/\.$/, "")}), your sellers sold to ${what}.` : `Your sellers accepted ${what}.` };
  }
  if (tx?.outcome) {
    const labels = { completed: "Completed", void: "Null and void", terminated: "Terminated", buyer_default: "Buyer default", seller_default: "Seller default" };
    return { kind: tx.outcome.kind, label: labels[tx.outcome.kind], summary: tx.outcome.reason };
  }
  if (n.status === "lost") return { kind: "lost", label: "Lost to another buyer", summary: "Another buyer won the property." };
  return { kind: "dead", label: n.endedBy === "user" ? "You walked away" : `${s.narrative.opposingAgent.name} walked away`, summary: "No agreement was reached." };
}

function outcomeScore(s: Scenario, n: Negotiation, outcome: Debrief["outcome"], net: number | null, possible: boolean): { score: number; share: number | null } {
  const seller = s.userRole === "seller_agent";
  const room = Math.max(1, s.buyer.reservationPrice - s.seller.reservationPrice);
  if (net !== null) {
    const share = Math.max(0, Math.min(1, seller ? (net - s.seller.reservationPrice) / room : (s.buyer.reservationPrice - net) / room));
    return { score: Math.round(30 + 70 * share), share };
  }
  switch (outcome.kind) {
    case "dead":
      return { score: !possible ? 100 : n.endedBy === "user" ? 25 : 20, share: null };
    case "lost": {
      const best = Math.max(0, ...n.offers.filter((o) => o.by === "buyer").map((o) => netPrice(s, o.terms)));
      return { score: !possible ? 70 : best >= s.buyer.reservationPrice * 0.98 ? 55 : 20, share: null };
    }
    case "void": {
      const tx = n.transaction!;
      const letFail = /chose not to waive|won't waive/i.test(tx.outcome!.reason);
      return { score: seller ? 40 : letFail ? 70 : 30, share: null };
    }
    case "terminated":
      return { score: 60, share: null };
    case "buyer_default":
      return { score: seller ? 50 : 0, share: null };
    case "seller_default":
      return { score: seller ? 0 : 50, share: null };
    default:
      return { score: 50, share: null };
  }
}

/** Observations about how the user negotiated, good and bad. */
function processNotes(s: Scenario, n: Negotiation): { good: boolean; text: string }[] {
  const notes: { good: boolean; text: string }[] = [];
  const side = s.userRole === "buyer_agent" ? "buyer" : "seller";
  const limit = side === "buyer" ? s.buyer.reservationPrice : s.seller.reservationPrice;
  const mine = n.offers.filter((o) => o.by === side && !o.preemptive);
  const theirs = n.offers.filter((o) => o.by !== side);
  const anchor = side === "buyer" ? s.property.listPrice : (theirs[0] ? netPrice(s, theirs[0].terms) : s.property.listPrice);

  if (mine.length) {
    const first = netPrice(s, mine[0].terms);
    const total = Math.abs(limit - first);
    const room = Math.abs(limit - anchor) || 1;
    if (total / room < 0.15 && !n.offerNight) notes.push({ good: false, text: `Your first offer (${money(first)}) was within ${money(total)} of your client's limit, leaving almost no room to trade.` });
    else notes.push({ good: true, text: `Your first offer (${money(first)}) left yourself room to move.` });
    if (mine.length >= 2) {
      const steps = mine.slice(1).map((o, i) => Math.abs(netPrice(s, o.terms) - netPrice(s, mine[i].terms)));
      const firstStep = steps[0];
      const later = steps.slice(1);
      if (later.length && later.every((x) => x <= firstStep)) notes.push({ good: true, text: "Your concessions got smaller each round, which signals you're near your limit." });
      if (later.some((x) => x > firstStep * 1.5)) notes.push({ good: false, text: "You made a bigger concession late in the negotiation, which tells the other side there's more to come." });
    }
    const traded = mine.some((o, i) => i > 0 && (o.terms.completionDate !== mine[i - 1].terms.completionDate || o.terms.deposit !== mine[i - 1].terms.deposit || o.terms.conditions.length !== mine[i - 1].terms.conditions.length || o.terms.rentalItemsBuyout !== mine[i - 1].terms.rentalItemsBuyout));
    notes.push(traded ? { good: true, text: "You traded on terms (dates, deposit, conditions, rental items), not just price." } : { good: false, text: "Every move was on price alone. Completion dates, deposits, conditions and rental items are currency too." });
  }
  if (n.offerNight) {
    const registered = n.offers.some((o) => o.by === side && (o.status === "registered" || o.status === "expired" || o.status === "accepted" || o.status === "rejected"));
    if (side === "buyer" && !registered) notes.push({ good: false, text: "You never registered an offer for offer night." });
    const firm = n.offers.filter((o) => o.by === "buyer" && side === "buyer").some((o) => o.terms.conditions.length <= 1);
    if (side === "buyer") notes.push(firm ? { good: true, text: "You kept conditions tight for a competitive offer night." } : { good: false, text: "Your offer-night offers carried several conditions, which rank lower against firm offers." });
    if (side === "seller") {
      const night = n.offerNight;
      const improved = n.messages.some((m) => m.speaker === "user" && /back to improve/i.test(m.text));
      if (improved) notes.push({ good: true, text: "You sent all offers back to improve, which drew out better terms." });
      const prices = [...night.competitors.map((c) => c.terms.price), ...n.offers.filter((o) => o.by === "buyer").map((o) => o.terms.price)];
      const best = Math.max(0, ...prices);
      const won = night.outcome?.competitorId ? night.competitors.find((c) => c.id === night.outcome!.competitorId)?.terms.price : n.offers.find((o) => o.id === n.acceptedOfferId)?.terms.price;
      if (won !== undefined) {
        notes.push(
          won >= best
            ? { good: true, text: `You accepted the strongest offer on the table (${money(won)}).` }
            : { good: false, text: `You accepted ${money(won)} when ${money(best)} was on the table. Price isn't everything, but you should be able to explain the trade-off to your sellers.` },
        );
      }
      if (night.preemptives === "not_accepted" && n.offers.some((o) => o.preemptive && o.status === "accepted")) notes.push({ good: false, text: "You accepted a pre-emptive offer after telling the market there would be none. That's unfair to the other buyers and invites a complaint." });
    }
  }
  const tx = n.transaction;
  if (tx) {
    const iWaive = n.messages.findIndex((m) => /delivered: financing condition/i.test(m.text) && /Waiver/.test(m.text));
    const iCommit = n.messages.findIndex((m) => /issued a mortgage commitment/i.test(m.text));
    if (side === "buyer" && iWaive >= 0 && (iCommit < 0 || iWaive < iCommit)) notes.push({ good: false, text: "You waived financing before the mortgage commitment came in, putting the deposit at risk." });
    if (side === "buyer" && tx.outcome?.kind === "void" && /wasn't waived or fulfilled/.test(tx.outcome.reason)) notes.push({ good: false, text: "A condition lapsed because nothing was delivered by the deadline. If you meant to keep the deal, waive or fulfil on time; if not, say so in writing." });
    const repairIssues = tx.issues.filter((i) => i.kind === "repairs" && i.status === "agreed");
    for (const issue of repairIssues) {
      const got = [...issue.proposals].reverse().find((p) => p.kind === "accept")?.amount ?? 0;
      const pct = issue.reference ? got / issue.reference : 0;
      if (side === "buyer") notes.push(pct >= 0.6 ? { good: true, text: `You recovered ${money(got)} on findings worth about ${money(issue.reference)}.` } : { good: false, text: `You settled for ${money(got)} on findings worth about ${money(issue.reference)}.` });
      else notes.push(pct <= 0.6 ? { good: true, text: `You held the repair concession to ${money(got)} on findings worth about ${money(issue.reference)}.` } : { good: false, text: `You gave ${money(got)} on findings worth about ${money(issue.reference)}.` });
    }
    if (tx.status === "closed") notes.push({ good: true, text: "You got the deal through to completion." });
  }

  // Discovery: what you found out from your own client by asking.
  const facts = clientFacts(s);
  if (n.client?.reviewRequired && facts.length) {
    const how = (id: string) => n.client!.uncovered.find((u) => u.factId === id)?.how ?? "never";
    const asked = facts.filter((f) => how(f.id) === "asked").length;
    const missed = facts.filter((f) => how(f.id) === "never");
    const late = facts.filter((f) => how(f.id) === "refusal");
    if (asked * 2 >= facts.length) notes.push({ good: true, text: `You asked the right questions: your client told you ${asked} of the ${facts.length} things they hadn't mentioned up front.` });
    if (late.length) notes.push({ good: false, text: `You learned about ${late.length === 1 ? "a requirement" : `${late.length} requirements`} only when your client refused to sign. Ask about the deposit, chattels, fixtures and conditions before you draft.` });
    const missedRoom = missed.filter((f) => f.effect.kind === "room" || f.effect.kind === "room_competition");
    if (missedRoom.length) notes.push({ good: false, text: `Your client had room you never found out about: ${missedRoom.map((f) => f.summary.replace(/\.$/, "")).join("; ")}.` });
    else if (missed.length) notes.push({ good: false, text: `Your client had ${missed.length} thing${missed.length === 1 ? "" : "s"} on their mind you never asked about.` });
  }
  // Multiple offers on the listing side: how they were handled, and whether released buyers were brought back.
  if (n.listing && side === "seller") {
    const arrived = allCompetitors(n).filter((c) => c.registeredAt <= n.simHours || c.status !== "registered");
    if (arrived.length) notes.push(n.listing.mode === "held" ? { good: true, text: "With competing buyers in play, you and your sellers held offers for a review, so everyone competed at once." } : { good: true, text: `You handled ${arrived.length === 1 ? "a competing offer" : `${arrived.length} competing offers`} as they came in.` });
    const returned = n.listing.invites.filter((i) => i.result === "returned").length;
    const collapsed = n.transaction?.status === "terminated" || n.status === "dead";
    if (returned) notes.push({ good: true, text: `After the deal fell through, you brought back ${returned === 1 ? "a buyer" : `${returned} buyers`} who'd made offers.` });
    else if (collapsed && arrived.some((c) => c.status === "released" || c.status === "expired" || c.status === "declined") && !n.listing.invites.length) notes.push({ good: false, text: "When the deal fell through, you didn't go back to the buyers who had made offers. They're your fastest path to a new agreement." });
  }

  // Surprises from your own client after acceptance.
  for (const e of s.ownClientEvents ?? []) {
    const state = n.client?.events?.find((x) => x.id === e.id);
    if (!state) continue;
    notes.push(state.status === "settled" ? { good: true, text: `${e.summary} You talked them through it.` } : { good: false, text: `${e.summary} You never answered them.` });
  }
  return notes;
}

function offlineCritique(s: Scenario, notes: Debrief["processNotes"], flags: ComplianceFlag[], outcome: Debrief["outcome"], dealSpace: Debrief["dealSpace"]): Critique {
  const good = notes.filter((x) => x.good).map((x) => x.text);
  const bad = [...flags.filter((f) => f.severity === "breach").map((f) => `${f.title}. ${f.detail}`), ...notes.filter((x) => !x.good).map((x) => x.text)];
  let keyMoment: string;
  if (!dealSpace.possible) keyMoment = "There was no price both clients could sign. Recognizing that early and protecting your client was the job here.";
  else if (dealSpace.yourShare !== null) keyMoment = `You landed at ${money(dealSpace.finalNet!)}, capturing ${Math.round(dealSpace.yourShare * 100)}% of the room between the seller's floor (${money(dealSpace.sellerFloor)}) and the buyer's ceiling (${money(dealSpace.buyerCeiling)}).`;
  else keyMoment = `${outcome.label}: ${outcome.summary}`;
  return {
    wentWell: good.length ? good.slice(0, 3) : ["You stayed engaged and kept your client's instructions in view."],
    toImprove: bad.length ? bad.slice(0, 3) : ["Look for more terms to trade before conceding on price."],
    keyMoment,
    source: "offline",
  };
}

const CritiqueSchema = z.object({
  wentWell: z.array(z.string()).describe("Exactly three specific things the user did well, citing what they did."),
  toImprove: z.array(z.string()).describe("Exactly three specific things to fix, each with what to do instead. Include any RECO compliance problems."),
  keyMoment: z.string().describe("The single moment where the user gained or lost the most, and what a veteran would have done."),
});

async function claudeCritique(s: Scenario, n: Negotiation, summary: object): Promise<Critique | null> {
  if (!hasClaudeCredentials()) return null;
  try {
    const toClient = (n.client?.messages ?? []).map((m) => `[${m.speaker === "user" ? "user to own client" : m.speaker === "client" ? "own client" : "system"}] ${m.text}`);
    const transcript = [...n.messages.map((m) => `[${m.speaker}] ${m.text}`), ...toClient].join("\n");
    const stream = new Anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: `You are a veteran Ontario real estate broker (30 years, 30-40 deals a year) coaching a RECO-registered salesperson after a practice negotiation. Be direct, specific and kind. Ground every point in what actually happened in the transcript and the revealed facts. Use Ontario practice and the RECO Code of Ethics; never US terms. Canadian spelling.`,
      output_config: { effort: "medium", format: betaZodOutputFormat(CritiqueSchema) },
      messages: [{ role: "user", content: `The user represented the ${s.userRole === "buyer_agent" ? "buyer" : "seller"}.\n\nDebrief data (both sides revealed):\n${JSON.stringify(summary, null, 2)}\n\nTranscript:\n${transcript}` }],
    });
    const response = await stream.finalMessage();
    if (response.stop_reason !== "end_turn" || !response.parsed_output) return null;
    return { ...response.parsed_output, source: "claude" };
  } catch (error) {
    console.warn(`Claude critique failed, using offline critique: ${(error as Error).message}`);
    return null;
  }
}

export async function buildDebrief(s: Scenario, n: Negotiation, useClaude = true): Promise<Debrief> {
  if (!debriefAvailable(n)) throw new Error("The deal isn't finished yet.");
  const outcome = outcomeOf(s, n);
  const possible = s.buyer.reservationPrice >= s.seller.reservationPrice;
  const net = finalNet(s, n);
  const { score: outcomeScoreValue, share } = outcomeScore(s, n, outcome, net, possible);
  const notes = processNotes(s, n);
  const process = Math.max(0, Math.min(100, 70 + notes.reduce((sum, x) => sum + (x.good ? 8 : -10), 0)));
  const flags = reviewCompliance(s, n);
  const compliance = complianceScore(flags);
  const overall = Math.round(outcomeScoreValue * 0.5 + process * 0.25 + compliance * 0.25);
  const dealSpace = { sellerFloor: s.seller.reservationPrice, buyerCeiling: s.buyer.reservationPrice, listPrice: s.property.listPrice, marketValue: s.groundTruth.marketValue, possible, finalNet: net, yourShare: share };

  const revealed = new Set(n.transaction?.revealedFindingIds ?? []);
  const night = n.offerNight;
  const hidden: Debrief["hidden"] = {
    appraisedValue: s.groundTruth.appraisedValue,
    findings: [...s.groundTruth.inspectionFindings, ...s.groundTruth.typeSpecificIssues].map((f) => ({ ...f, revealed: revealed.has(f.id) })),
    titleIssues: s.groundTruth.titleIssues.map((t) => t.summary),
    loanEvents: s.groundTruth.financing.map((l) => l.summary),
    visitSurprises: s.groundTruth.visitSurprises.map((v) => v.summary),
    competingOffers: night
      ? night.competitors.map((c) => ({ label: c.label, price: c.terms.price, strength: c.strength, conditions: c.terms.conditions.length ? c.terms.conditions.map((x) => x.key.replace("_", " ")).join(", ") : "firm", status: c.status }))
      : s.groundTruth.competingOffers.map((o, i) => ({ label: `Buyer ${i + 2}`, price: o.price, strength: o.strength, conditions: "—", status: o.phase === "pre_contract" ? "made an offer" : "backup offer" })),
  };
  const byId = new Map(n.messages.map((m) => [m.id, m]));
  const agentReasoning = n.botTurns.map((t) => {
    const m = byId.get(t.messageId);
    return { at: m?.at ?? 0, message: m?.text ?? "", note: t.internalNote, source: t.source };
  });

  const summaryForCritique = {
    outcome,
    scores: { outcome: outcomeScoreValue, process, compliance },
    dealSpace,
    seller: s.seller,
    buyer: s.buyer,
    difficulty: s.difficulty,
    processNotes: notes,
    clientFacts: clientFacts(s).map((f) => f.summary),
    complianceFlags: flags.map((f) => ({ title: f.title, quote: f.quote })),
    completionDate: n.transaction ? displayDate(n.transaction.terms.completionDate) : null,
  };
  const critique = n.debriefCritique ?? (useClaude ? await claudeCritique(s, n, summaryForCritique) : null) ?? offlineCritique(s, notes, flags, outcome, dealSpace);
  if (critique.source === "claude") n.debriefCritique = critique;

  return {
    outcome,
    scores: { outcome: outcomeScoreValue, process, compliance, overall },
    dealSpace,
    clients: { seller: { brief: s.seller, story: s.narrative.sellerStory }, buyer: { brief: s.buyer, story: s.narrative.buyerStory } },
    yourSide: s.userRole === "buyer_agent" ? "buyer" : "seller",
    difficulty: s.difficulty,
    hidden,
    agentReasoning,
    clientFacts: clientFacts(s).map((f) => ({ summary: f.summary, how: n.client?.uncovered.find((u) => u.factId === f.id)?.how ?? "never" })),
    processNotes: notes,
    compliance: flags,
    critique,
  };
}
