// RECO Code of Ethics review of the user's conduct, from their messages and the actions they tried.
// These are heuristics that flag likely problems with the quote that triggered them; the debrief explains each one.

import type { Scenario } from "../engine/types";
import { money } from "../narrative/format";
import type { Negotiation, NegotiationMessage } from "../negotiation/types";
import { unpresentedTxProposals } from "../client/transaction";

export interface ComplianceFlag {
  rule: "confidentiality" | "misrepresentation" | "disclosure_direction" | "client_instructions" | "legal_advice" | "count_rule" | "client_duty";
  severity: "breach" | "caution" | "note";
  title: string;
  detail: string;
  quote: string | null;
  at: number | null;
}

const MONEY = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|K|m|M|million)?\b/g;
const LIMIT_WORDS = /\b(max|maximum|top|ceiling|bottom line|floor|lowest|absolute|limit|walk-?away|budget|pre-?approv|approved (for|up to)|owe|mortgage balance|most (they|my clients?|my buyers?|my sellers?) (can|will|would))/i;

const MOTIVATION_TELLS: Record<string, RegExp> = {
  separation: /\b(divorc|separat)/i,
  estate: /\b(estate|passed away|died|probate)\b/i,
  financial_strain: /\b(financial (trouble|pressure|difficult)|behind on|can'?t afford|power of sale|foreclos)/i,
  bought_firm_elsewhere: /\b(bought (another|a new)|already bought|firm on (another|their new)|their (new|other) (house|home) closes)/i,
  relocation: /\b(relocat|transferr?ed|moving for (work|a job)|new job)/i,
  lease_ending: /\blease (ends|is up|expires|runs out)/i,
  investor_exit: /\b(need the (cash|money)|cash(ing)? out)/i,
};
const URGENCY_TELLS = /\b(desperate|need to sell fast|have to sell|must sell|need to (move|close) (by|before)|in a (real )?hurry|running out of time|can'?t wait)/i;
const OTHER_OFFERS = /\b(other offers?|multiple offers|another offer|competing offers?|lots of interest|other buyers)/i;
const PRESSURE = /\b((go|stretch|pay|spend) (over|above|beyond|past) (your|the|their) (budget|limit|max(imum)?|number|pre-?approval)|you('ll| will) (lose|regret)|(have|need) to (accept|take|sign) (it|this)|take it or leave it|last chance|don't think,? just sign|you('re| are) being (greedy|unreasonable|silly))/i;
const WALK_AWAY = /\b((just|you (can|could)|go ahead and|feel free to) (walk away|back out|get out|cancel|pull out)|don'?t (close|complete)|refuse to close)\b/i;
const LEGAL_ADVICE =/\b(legally|the law (says|requires)|(you|they) (can|could|will) sue|take (you|them) to court|lawsuit)\b/i;

function parseMoney(digits: string, suffix: string | undefined): number {
  const base = Number(digits.replace(/,/g, ""));
  if (!suffix) return base;
  return /k/i.test(suffix) ? base * 1_000 : base * 1_000_000;
}

function amountsIn(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => parseMoney(m[1], m[2])).filter((n) => n >= 1_000);
}

function near(a: number, b: number, tolerance = 0.005): boolean {
  return b > 0 && Math.abs(a - b) <= b * tolerance;
}

function quote(m: { text: string }): string {
  return m.text.length > 180 ? `${m.text.slice(0, 177)}…` : m.text;
}

/** How many competing offers the user's side actually had at a point in time. */
function competingCountAt(n: Negotiation, at: number): number {
  if (n.offerNight) return n.offerNight.competitors.filter((c) => c.registeredAt <= at).length;
  return n.messages.filter((m) => m.event === "competing_offer" && m.at <= at).length;
}

export function reviewCompliance(s: Scenario, n: Negotiation): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  const mine = s.userRole === "buyer_agent" ? s.buyer : s.seller;
  const confidential: { value: number; label: string; exact: boolean }[] = [{ value: mine.reservationPrice, label: "your client's limit", exact: false }];
  if (mine.side === "seller") confidential.push({ value: mine.mortgagePayoff, label: "your sellers' mortgage balance", exact: true });
  else {
    if (mine.preapprovalAmount) confidential.push({ value: mine.preapprovalAmount, label: "your buyers' pre-approval", exact: true });
    confidential.push({ value: mine.cashReserves, label: "your buyers' cash reserves", exact: true });
  }
  const motivationTell = MOTIVATION_TELLS[mine.motivation];
  const userMessages = n.messages.filter((m) => m.speaker === "user" && m.text);

  for (const m of userMessages) {
    const amounts = amountsIn(m.text);
    // Confidential numbers: a limit stated as a limit, or private finances stated at all.
    for (const c of confidential) {
      const hit = amounts.find((a) => near(a, c.value, c.exact ? 0.002 : 0.005));
      if (hit !== undefined && (c.exact || LIMIT_WORDS.test(m.text))) {
        flags.push({ rule: "confidentiality", severity: "breach", title: `Disclosed ${c.label}`, detail: `You revealed ${c.label} (${money(c.value)}) to the other agent. A registrant must protect a client's confidential information unless the client directs otherwise.`, quote: quote(m), at: m.at });
        break;
      }
    }
    if ((motivationTell && motivationTell.test(m.text)) || URGENCY_TELLS.test(m.text)) {
      flags.push({ rule: "confidentiality", severity: "breach", title: "Disclosed your client's motivation", detail: "You shared why or how urgently your client needs to deal. That's confidential, and the other side will use it.", quote: quote(m), at: m.at });
    }
    // Offer contents shared without the seller's direction.
    if (s.userRole === "seller_agent" && n.offerNight && n.offerNight.disclosure !== "details") {
      const leaked = n.offerNight.competitors.find((c) => c.registeredAt <= m.at && amounts.some((a) => near(a, c.terms.price, 0.003)));
      if (leaked) flags.push({ rule: "confidentiality", severity: "breach", title: "Disclosed a competing offer's price", detail: `You shared ${leaked.label}'s price with another buyer's agent without your sellers' written direction. Without it, only the number of offers may be disclosed.`, quote: quote(m), at: m.at });
    }
    // Claims about competing offers that weren't true when made.
    if (s.userRole === "seller_agent") {
      const actual = competingCountAt(n, m.at);
      const claimed = m.text.match(/\b(\d+|one|two|three|four|five|six|seven|eight)\s+(other\s+)?(registered\s+)?offers?\b/i);
      const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
      const claimedCount = claimed ? (words[claimed[1].toLowerCase()] ?? Number(claimed[1])) : null;
      if (claimedCount !== null && claimedCount !== actual && claimedCount !== actual + 1) {
        flags.push({ rule: "misrepresentation", severity: "breach", title: "Misstated the number of offers", detail: `You said there were ${claimedCount} offers; there were ${actual} competing offer${actual === 1 ? "" : "s"} at the time. Misrepresenting competing offers is a serious breach of the Code of Ethics.`, quote: quote(m), at: m.at });
      } else if (claimedCount === null && OTHER_OFFERS.test(m.text) && actual === 0 && !/\b(no|any) (other )?offers?\b/i.test(m.text)) {
        flags.push({ rule: "misrepresentation", severity: "breach", title: "Implied competing interest that didn't exist", detail: "You suggested other offers or buyers when there were none. That's a phantom offer, and it's a misrepresentation under the Code of Ethics.", quote: quote(m), at: m.at });
      }
    }
    if (LEGAL_ADVICE.test(m.text)) {
      flags.push({ rule: "legal_advice", severity: "caution", title: "Sounded like legal advice", detail: "Statements about legal rights or remedies belong with the lawyers. Refer the other side, and your client, to legal counsel.", quote: quote(m), at: m.at });
    }
  }

  const attempts = n.attempts ?? [];
  const disclosureTries = attempts.filter((a) => a.action === "set_disclosure");
  if (disclosureTries.length) {
    flags.push({ rule: "disclosure_direction", severity: "caution", title: "Tried to disclose offer contents without direction", detail: "You tried to share the contents of competing offers without your sellers' written direction. The app stopped you; in practice, TRESA requires that direction first.", quote: null, at: disclosureTries[0].at });
  }
  const pushes = attempts.filter((a) => /won't sign|won't|can't/i.test(a.message) && a.action !== "set_disclosure");
  if (pushes.length) {
    flags.push({ rule: "client_instructions", severity: pushes.length >= 3 ? "caution" : "note", title: `Tried ${pushes.length} time${pushes.length === 1 ? "" : "s"} to go outside your client's instructions`, detail: `Your client refused: ${pushes[0].details[0] ?? pushes[0].message}. You must act within your client's lawful instructions; if you think they should move, advise them and get new instructions first.`, quote: null, at: pushes[0].at });
  }
  if (s.userRole === "seller_agent" && n.offerNight && !n.offerNight.countDisclosed) {
    flags.push({ rule: "count_rule", severity: "caution", title: "Didn't tell a registered buyer how many offers there were", detail: "When there are competing written offers, the listing brokerage must disclose the number of offers to every person who has made one.", quote: null, at: null });
  }
  flags.push(...clientDuty(s, n));
  return dedupe(flags);
}

/** Duty to the user's own client: presenting offers, no pressure, no legal advice. Only for deals with the client conversation. */
function clientDuty(s: Scenario, n: Negotiation): ComplianceFlag[] {
  const c = n.client;
  if (!c?.reviewRequired) return [];
  const flags: ComplianceFlag[] = [];
  const mine = s.userRole === "buyer_agent" ? "buyer" : "seller";
  // Every offer from the other side that you answered with your own, without showing it to your client first.
  const answered = n.offers.filter((o) => o.by !== mine && n.offers.some((x) => x.by === mine && x.at >= o.at && x.id !== o.id && n.offers.indexOf(x) > n.offers.indexOf(o)));
  const unpresented = answered.filter((o) => !c.presented.includes(o.id));
  if (unpresented.length) {
    flags.push({ rule: "client_duty", severity: "caution", title: `Answered ${unpresented.length} offer${unpresented.length === 1 ? "" : "s"} without presenting ${unpresented.length === 1 ? "it" : "them"} to your client`, detail: "You must present every offer and sign-back to your client and take their instructions before you respond. Your client decides; you advise.", quote: null, at: unpresented[0].at });
  }
  if (n.offerNight && s.userRole === "seller_agent" && n.status === "sold_to_other" && !c.presented.some((p) => p.startsWith("offer-night"))) {
    flags.push({ rule: "client_duty", severity: "breach", title: "Accepted a competing offer without presenting all the offers", detail: "On offer night, the listing agent presents every registered offer to the sellers before they choose.", quote: null, at: null });
  }
  const txUnpresented = unpresentedTxProposals(s, n);
  if (txUnpresented) {
    flags.push({ rule: "client_duty", severity: "caution", title: `Answered ${txUnpresented} request${txUnpresented === 1 ? "" : "s"} after acceptance without presenting ${txUnpresented === 1 ? "it" : "them"} to your client`, detail: "Amendments change your client's deal. Show them what the other side is asking for and get their instructions before you answer.", quote: null, at: null });
  }
  const remorse = c.events?.find((e) => e.id === "remorse");
  for (const m of c.messages.filter((x) => x.speaker === "user" && x.kind === "chat" && remorse && x.at >= remorse.at)) {
    if (WALK_AWAY.test(m.text)) flags.push({ rule: "client_duty", severity: "breach", title: "Encouraged your client to walk away from a firm deal", detail: "A firm agreement binds your client. Walking away forfeits the deposit and invites a damages claim. Explain the consequences, and send them to their lawyer before they do anything.", quote: quote(m), at: m.at });
  }
  for (const m of c.messages.filter((x) => x.speaker === "user" && x.kind === "chat")) {
    if (PRESSURE.test(m.text)) flags.push({ rule: "client_duty", severity: "breach", title: "Pressured your client", detail: "Advise your client and let them decide. Pushing them past their own limits, or rushing them, puts your interest (closing the deal) ahead of theirs.", quote: quote(m), at: m.at });
    if (LEGAL_ADVICE.test(m.text)) flags.push({ rule: "legal_advice", severity: "caution", title: "Gave your client legal advice", detail: "Questions about legal rights and remedies go to your client's lawyer. Say so, and refer them.", quote: quote(m), at: m.at });
  }
  return flags;
}

/** One flag per rule and quote, so a repeated phrase isn't counted twice. */
function dedupe(flags: ComplianceFlag[]): ComplianceFlag[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const key = `${f.rule}|${f.title}|${f.quote ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function complianceScore(flags: ComplianceFlag[]): number {
  const penalty = flags.reduce((sum, f) => sum + (f.severity === "breach" ? 25 : f.severity === "caution" ? 10 : 0), 0);
  return Math.max(0, 100 - penalty);
}
