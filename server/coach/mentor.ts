// The mentor: a veteran Ontario broker the user can ask at any point. It sees only what the user sees:
// the public listing, the user's own client, the transcript and the deal state. Never the other side.

import Anthropic from "@anthropic-ai/sdk";
import type { Scenario } from "../engine/types";
import { userView } from "../engine/views";
import { displayDate, money } from "../narrative/format";
import { netPrice } from "../negotiation/constraints";
import { offerNightView } from "../negotiation/engine";
import type { Negotiation } from "../negotiation/types";
import { termsSummary } from "../negotiation/terms";
import { transactionClientView } from "../transaction/engine";
import { dateOf } from "../transaction/schedule";
import { hasClaudeCredentials } from "../scenarioService";
import { clientView } from "../client/engine";

const MODEL = process.env.BOT_MODEL || "claude-opus-5-5";

const SYSTEM = `You are a mentor to a RECO-registered Ontario real estate salesperson who is practising a negotiation in a simulator. You are a broker with 30 years of experience.

- Answer the question they asked, briefly and practically: 3-6 sentences, plain prose, no markdown headings.
- You only know what they know: the public listing, their own client's confidential brief, the transcript, and the deal state you're given. You do NOT know the other side's limits or the hidden facts; never guess them as if you did.
- Use Ontario practice: the Agreement of Purchase and Sale, deposits, sign-backs, irrevocable times, conditions that must be waived or fulfilled by their deadline, amendments, requisitions, completion, land transfer tax, offer nights.
- Hold them to the RECO Code of Ethics and TRESA: protect their client's confidential information, never misrepresent (no phantom offers), disclose the number of competing offers when they're the listing side, only disclose offer contents with the seller's written direction, act within their client's instructions, and send legal questions to the lawyers.
- Don't do the negotiation for them. Suggest a next move and the reasoning, then let them decide. Canadian spelling.`;

/** What the user can see, condensed for the mentor. */
function userContext(s: Scenario, n: Negotiation): string {
  const view = userView(s);
  const brief = view.yourClient.brief;
  const parts = [
    `You represent the ${brief.side}. Property: ${view.public.property.address.street}, ${view.public.property.address.municipality} (${view.public.market.region}), listed at ${money(view.public.property.listPrice)}, ${view.public.property.daysOnMarket} days on market. Market: ${view.public.market.temperature}.`,
    `Comps: ${view.public.comps.map((c) => `${money(c.soldPrice)} (${c.notes})`).join("; ")}.`,
    `Your client's brief: ${JSON.stringify(brief)}`,
    `What your client told you: ${view.yourClient.story.whatTheyveToldYou}`,
    `Status: ${n.status}.`,
  ];
  const latest = n.offers.slice(-4).map((o) => `${o.by === brief.side ? "Your side" : "Their side"} (${o.status}): ${termsSummary(o.terms, s)}`);
  if (latest.length) parts.push(`Recent offers:\n${latest.join("\n")}`);
  const night = offerNightView(s, n);
  if (night && night.phase !== "done") parts.push(`Offer night: phase ${night.phase}, review at ${night.reviewAt}, pre-emptives ${night.preemptives}, competing offers known: ${night.competingCount ?? "not disclosed yet"}${night.sellerDirection ? `, seller's direction: ${night.sellerDirection}` : ""}.`);
  if (n.transaction) {
    const tx = transactionClientView(s, n.transaction);
    parts.push(`Agreement: ${tx.firm ? "firm" : "conditional"}, completion ${tx.closingDateDisplay}, today ${displayDate(tx.today)}. Conditions: ${tx.conditions.map((c) => `${c.label} ${c.status}${c.status === "pending" ? ` until ${displayDate(tx.deadlineDates[`condition:${c.key}`])}` : ""}`).join("; ") || "none"}. Open issues: ${tx.issues.filter((i) => i.status === "open").map((i) => `${i.title}: ${i.detail}`).join(" | ") || "none"}.`);
  }
  parts.push(`Last messages:\n${n.messages.slice(-10).map((m) => `[${m.speaker === "user" ? "You" : m.speaker === "bot" ? "Other agent" : "Note"}] ${m.text}`).join("\n")}`);
  // Only what the user has learned from their client. The mentor never knows what the client hasn't said.
  const client = clientView(s, n);
  if (client?.messages.length) {
    if (client.learned.length) parts.push(`What your client has told you since intake: ${client.learned.map((l) => l.says).join(" ")}`);
    parts.push(`Last messages with your client:\n${client.messages.slice(-6).map((m) => `[${m.speaker === "user" ? "You" : m.speaker === "client" ? "Your client" : "Note"}] ${m.text}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

/** Coaching from the deal state, used without an API key or if Claude fails. */
export function offlineAdvice(s: Scenario, n: Negotiation): string {
  const brief = s.userRole === "buyer_agent" ? s.buyer : s.seller;
  const buyer = brief.side === "buyer";
  const tips: string[] = [];
  const tx = n.transaction;
  const night = n.offerNight && n.offerNight.phase !== "done" ? n.offerNight : null;

  if (tx && tx.status === "active") {
    const pending = tx.conditions.filter((c) => c.status === "pending").sort((a, b) => a.deadlineDay - b.deadlineDay);
    if (pending.length && buyer) {
      const c = pending[0];
      tips.push(`Your next deadline is the ${c.label.toLowerCase()} condition on ${displayDate(dateOf(tx, c.deadlineDay))}. If nothing is delivered by then, the deal is null and void; that protects your buyers, but only if that's what they want.`);
      if (pending.some((x) => x.key === "financing") && tx.loanStatus !== "approved") tips.push("Don't waive financing until the commitment is in writing and the appraisal supports the price.");
      if (tx.issues.some((i) => i.status === "open" && i.kind === "repairs")) tips.push("Negotiate the findings before you waive. Once the condition is gone, so is your leverage.");
    } else if (pending.length) {
      tips.push("The buyers hold the conditions. Stay close to their agent, answer requests quickly, and don't concede more than the findings are worth.");
    } else {
      tips.push("You're firm. Watch the requisition date and the pre-closing visits, and keep both clients informed.");
    }
    return tips.join(" ");
  }

  if (night) {
    if (buyer) {
      tips.push(`On offer night, price is only part of it. A firm or lightly conditional offer with a strong deposit herewith ranks well above a slightly higher conditional one.`);
      tips.push(`Your buyers' ceiling is ${money(brief.reservationPrice)}. Decide now what you'd bring in an improvement round so you aren't negotiating against yourself at 9 p.m.`);
      if (n.offerNight!.preemptives === "considered") tips.push("A pre-emptive offer only works if it's strong enough that the sellers would rather not wait. Keep the irrevocable short.");
    } else {
      tips.push("Present every offer to your sellers, and tell each registered buyer's agent the true number of offers. Only share contents if your sellers have directed you to in writing.");
      tips.push("Sending everyone back to improve once is common, but a clear winner should be signed while it's on the table.");
    }
    return tips.join(" ");
  }

  const mine = n.offers.filter((o) => o.by === brief.side);
  const theirs = n.offers.filter((o) => o.by !== brief.side);
  const latest = theirs.length ? netPrice(s, theirs[theirs.length - 1].terms) : null;
  if (latest !== null) {
    // Positive = their latest is worse for your client than your client's limit.
    const beyond = buyer ? latest - brief.reservationPrice : brief.reservationPrice - latest;
    if (beyond <= 0) {
      tips.push(`Their latest (${money(latest)}) is inside your client's limit${beyond < 0 ? ` by ${money(-beyond)}` : ""}. If the other terms work, accepting is reasonable; countering risks the deal for whatever is left on the table, so weigh that with your client.`);
    } else {
      tips.push(`Their latest is ${money(beyond)} outside your client's limit. They need to move, or you need new instructions from your client before you can.`);
    }
  }
  if (n.client?.reviewRequired && !n.client.messages.some((m) => m.kind === "chat")) {
    tips.push("Sit down with your client before you draft anything. Ask about timing, the deposit, what stays and what goes, and what worries them. Clients rarely tell you everything at the first meeting.");
  }
  if (!mine.length) {
    const comps = s.comps.map((c) => c.soldPrice).sort((a, b) => a - b);
    const median = comps[Math.floor(comps.length / 2)];
    tips.push(`The comps centre around ${money(median)} against a ${money(s.property.listPrice)} list price in a ${s.market.temperature} market.`);
    tips.push(buyer ? "Open low enough to leave room to move, and back your number with the comps." : "Counter with a reason. Anchor to the comps and what's special about the property.");
  } else if (latest !== null) {
    tips.push("Make each concession smaller than the last; it signals you're near your limit.");
  }
  tips.push("Trade terms, not just price: completion date, deposit, condition lengths, and who pays out the rental items all have value to someone.");
  tips.push("Keep your client's motivation and limits to yourself, even when it feels like it would help.");
  return tips.join(" ");
}

export async function askMentor(s: Scenario, n: Negotiation, question: string): Promise<{ answer: string; source: "claude" | "offline" }> {
  if (hasClaudeCredentials()) {
    const history = (n.mentorHistory ??= []);
    history.push({ role: "user", content: `Current situation:\n${userContext(s, n)}\n\nMy question: ${question}` });
    try {
      const stream = new Anthropic().beta.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        output_config: { effort: "medium" },
        system: SYSTEM,
        messages: history,
      });
      const response = await stream.finalMessage();
      history.push({ role: "assistant", content: response.content });
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
      if (response.stop_reason === "end_turn" && text) return { answer: text, source: "claude" };
    } catch (error) {
      console.warn(`Claude mentor failed, using offline advice: ${(error as Error).message}`);
      history.push({ role: "assistant", content: "(no answer)" });
    }
  }
  return { answer: offlineAdvice(s, n), source: "offline" };
}
