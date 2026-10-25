// What the opposing agent says after acceptance, offline: its moves on each issue in its own temperament,
// and answers to the user's messages from the state of the deal. Code decides every move and number.

import type { Scenario } from "../engine/types";
import { displayDate, money } from "../narrative/format";
import { botSide } from "../negotiation/strategy";
import type { Issue, Transaction } from "../transaction/types";
import type { BotMove } from "../transaction/policy";
import { cap, say, type Fill } from "./pick";

type Temperament = Scenario["difficulty"]["temperament"];

export interface TxAgentContext {
  s: Scenario;
  used?: string[];
  seed: number;
}

const NOUN: Record<Issue["kind"], string> = {
  repairs: "the findings",
  appraisal: "the appraisal",
  condition_extension: "the condition date",
  loan: "the mortgage",
  escape_clause: "the sale-of-property condition",
  title: "the title requisition",
  visit: "what came up at the pre-closing visit",
  extension: "the completion date",
  date_change: "the completion date",
};

function amountPhrase(move: BotMove, issue: Issue): string {
  if (issue.kind === "extension" || issue.kind === "date_change") return move.closingDate ? `completion on ${displayDate(move.closingDate)}` : "";
  if (issue.kind === "condition_extension") return `${move.amount} more banking days`;
  const form = move.form === "repairs" ? "repairs done before completion" : move.form === "credit" ? "a credit on closing" : "a price reduction by amendment";
  return `${money(move.amount)} as ${form}`;
}

function fills(c: TxAgentContext, issue: Issue, move: BotMove): Fill {
  const who = botSide(c.s) === "seller" ? "my sellers" : "my buyers";
  return { who, Who: cap(who), noun: NOUN[issue.kind], what: amountPhrase(move, issue), detail: issue.detail, date: move.closingDate ? displayDate(move.closingDate) : "", days: move.amount };
}

function pick(c: TxAgentContext, pool: string, byTemperament: Record<Temperament, readonly string[]>, f: Fill): string {
  const t = c.s.difficulty.temperament;
  return say(`tx:${pool}:${t}`, byTemperament[t], f, c.used, c.seed);
}

/** The agent's words for a move on an issue. */
export function agentTxDraft(c: TxAgentContext, issue: Issue, move: BotMove): string {
  const f = fills(c, issue, move);
  switch (move.kind) {
    case "request":
      if (issue.kind === "escape_clause")
        return say("tx:escape", ["This is notice under the escape clause: my sellers have another offer they're prepared to accept. Your buyers have 72 hours to waive the sale-of-property condition, or the agreement ends and the deposit is returned.", "Formal notice under the escape clause: my sellers have received another acceptable offer. Your buyers have 72 hours to waive their sale-of-property condition, or the agreement is at an end and the deposit is returned."], f, c.used, c.seed);
      if (issue.kind === "extension")
        return pick(c, "ask-extension", {
          collaborative: ["We need to move completion to {date}. {detail} Can your clients sign an amendment? I know it's a hassle.", "I'm sorry to ask, but {who} need completion moved to {date}. {detail} Would your clients sign an amendment?"],
          professional: ["We need to move completion to {date}. {detail} Can your clients sign an amendment?", "{Who} are requesting completion on {date}. {detail} Please let me know if your clients will amend."],
          cagey: ["We need {date} instead. {detail}", "{Who} need completion on {date}. Amendment attached."],
          hardball: ["Completion needs to move to {date}. {detail} Sign the amendment.", "{date} is the new completion date we need. {detail}"],
        }, f);
      if (issue.kind === "condition_extension")
        return pick(c, "ask-cond-ext", {
          collaborative: ["{Who} need {days} more banking days on the condition. {detail} Will your clients sign an amendment extending it?", "Could we get {days} more banking days? {detail} I'd really appreciate it."],
          professional: ["{Who} need {days} more banking days on the condition. {detail} Will your clients sign an amendment extending it?", "We're requesting a {days}-banking-day extension. {detail}"],
          cagey: ["We need {days} more days. {detail}", "{days} more banking days, please. {detail}"],
          hardball: ["We need {days} more banking days. {detail} It's that or we let the condition run out.", "Extend it {days} banking days. {detail}"],
        }, f);
      return pick(c, "ask", {
        collaborative: ["About {noun}: {who} are asking for {what} before they'll waive. {detail} I think that's fair, but let's talk.", "On {noun}, {who} would like {what}. {detail} Open to a conversation."],
        professional: ["About {noun}: {who} are asking for {what} before they'll waive. {detail}", "Regarding {noun}, {who} request {what}. {detail}"],
        cagey: ["{Who} want {what} for {noun}. {detail}", "On {noun}: {what}. {detail}"],
        hardball: ["{Who} need {what} for {noun}, or they won't waive. {detail}", "It's {what} on {noun}. {detail} That's what it takes."],
      }, f);
    case "counter":
      return pick(c, "counter", {
        collaborative: ["{Who} reviewed it. We can do {what} on {noun}. Hopefully that works.", "We've talked it over. {Who} can offer {what} on {noun}."],
        professional: ["{Who} reviewed it. We can do {what} on {noun}.", "Our counter on {noun} is {what}."],
        cagey: ["{what}. That's what we can do on {noun}.", "We'll do {what}."],
        hardball: ["{what} on {noun}. That's generous.", "Best we'll do is {what} on {noun}."],
      }, f);
    case "accept":
      if (issue.kind === "escape_clause") return pick(c, "accept-escape", { collaborative: ["{Who} will waive the sale-of-property condition. We're staying in!"], professional: ["{Who} will waive the sale-of-property condition. We're staying in."], cagey: ["Waiver's attached. We're staying."], hardball: ["{Who} are waiving. We're not going anywhere."] }, f);
      return move.amount || move.closingDate
        ? pick(c, "accept-amount", {
            collaborative: ["{Who} agree to {what}. I'll send the amendment over for signatures. Thanks for working with us.", "Agreed: {what}. Amendment to follow."],
            professional: ["{Who} agree to {what}. I'll send the amendment over for signatures.", "Agreed on {what}. Amendment coming shortly."],
            cagey: ["Fine. {what}. Amendment's coming.", "Agreed."],
            hardball: ["Fine. {what}. Let's move on.", "Agreed. Amendment's coming."],
          }, f)
        : pick(c, "accept-plain", { collaborative: ["{Who} agree. I'll send the amendment over.", "That works. Amendment to follow."], professional: ["{Who} agree. I'll send the amendment over for signatures.", "Agreed."], cagey: ["Fine.", "Agreed."], hardball: ["Fine. Done.", "Agreed. Next."] }, f);
    case "reject":
      return pick(c, "reject", {
        collaborative: ["{Who} won't agree to that on {noun}, I'm afraid. Can we find something in between?", "I took it to {who}, but they can't do that on {noun}."],
        professional: ["{Who} won't agree to that on {noun}. That's where they are.", "{Who} have declined that on {noun}."],
        cagey: ["No.", "{Who} said no on {noun}."],
        hardball: ["Not happening on {noun}.", "No. {Who} won't move on {noun}."],
      }, f);
    case "withdraw":
      if (issue.kind === "appraisal") return pick(c, "withdraw-appraisal", { collaborative: ["Understood. {Who} will have to find the cash to cover the shortfall. If they can't, they won't be able to complete."], professional: ["Understood. {Who} will have to find the cash to cover the shortfall. If they can't, they won't be able to complete."], cagey: ["Fine. They'll cover the shortfall, or they won't close."], hardball: ["Understood. If they can't cover the gap, they won't close."] }, f);
      return pick(c, "withdraw", { collaborative: ["Understood. {Who} will move forward without it.", "Okay, we'll drop it and keep going."], professional: ["Understood. {Who} will move forward without it.", "Request withdrawn."], cagey: ["Fine. Forget it.", "Dropped."], hardball: ["Fine. We'll move on.", "Forget it, then."] }, f);
    case "terminate":
      return issue.kind === "escape_clause"
        ? say("tx:terminate-escape", ["{Who} can't waive the condition until their home sells, so the agreement will end. Please have your sellers sign the mutual release so the deposit can go back.", "Unfortunately {who} can't waive before their home sells. The agreement ends; please send the mutual release so the deposit is returned."], f, c.used, c.seed)
        : pick(c, "terminate", {
            collaborative: ["I'm sorry, but {who} won't be waiving the condition, so the agreement is null and void. I'll send the mutual release for the deposit.", "I'm really sorry. {Who} won't waive, so the deal is null and void. Mutual release to follow."],
            professional: ["I'm sorry, but {who} won't be waiving the condition, so the agreement is null and void. I'll send the mutual release for the deposit.", "{Who} will not be waiving. The agreement is null and void; mutual release to follow."],
            cagey: ["{Who} won't waive. It's over. Release to follow.", "No waiver. The deal's void."],
            hardball: ["{Who} aren't waiving. The deal's dead. Sign the release.", "No waiver. It's null and void."],
          }, f);
    case "wait":
      return "";
  }
}

// ---------- Answers during the transaction ----------

const TOPICS: [string, RegExp][] = [
  ["status", /\b(update|status|where are we|how'?s it going|any news|progress|what'?s next)\b/i],
  ["repairs", /\b(repairs?|findings?|inspection|inspector|credit|fix)\b/i],
  ["appraisal", /\b(apprais)/i],
  ["mortgage", /\b(mortgage|financ|lender|commitment|bank)\b/i],
  ["closing", /\b(clos(e|ing)|completion|keys|possession|move-?in|moving day)\b/i],
  ["deposit", /\b(deposit)\b/i],
  ["thanks", /\b(thanks|thank you|appreciate)\b/i],
];

/** The agent's reply to a message after acceptance, drawn from the state of the deal. */
export function agentTxReply(c: TxAgentContext, text: string, tx: Transaction, withholding: "open" | "reserved" | "guarded"): string {
  const s = c.s;
  const topics = TOPICS.filter(([, re]) => re.test(text)).map(([k]) => k);
  const who = botSide(s) === "seller" ? "my sellers" : "my buyers";
  const pending = tx.conditions.filter((x) => x.status === "pending").map((x) => x.label.toLowerCase());
  const open = tx.issues.filter((i) => i.status === "open");
  const parts: string[] = [];
  const f: Fill = { who, Who: cap(who), completion: displayDate(tx.terms.completionDate), pending: pending.join(" and "), open: open.map((i) => i.title.toLowerCase()).join(" and ") };
  for (const topic of topics.slice(0, 2)) {
    switch (topic) {
      case "status":
        parts.push(pending.length ? say("txr:status-pending", ["We're still waiting on the {pending} condition{s}.", "Still conditional on {pending}. I'll update you as soon as anything moves.", "{pending} {is} still outstanding."], { ...f, s: pending.length > 1 ? "s" : "", is: pending.length > 1 ? "are" : "is" }, c.used, c.seed) : say("txr:status-firm", ["We're firm. Next up is the lawyers and completion on {completion}.", "All firm. Completion is {completion}.", "Everything's waived or fulfilled. Just the closing on {completion} now."], f, c.used, c.seed));
        if (open.length) parts.push(say("txr:status-open", ["We still need to settle {open}.", "{open} is still on the table."], f, c.used, c.seed));
        break;
      case "repairs":
        parts.push(open.some((i) => i.kind === "repairs") ? say("txr:repairs-open", ["We're working through the findings. Our position's in the last proposal.", "The repairs are still under discussion. Let's settle them."], f, c.used, c.seed) : say("txr:repairs-none", ["Nothing open on repairs right now.", "No repair requests on the table."], f, c.used, c.seed));
        break;
      case "appraisal":
        parts.push(tx.appraisedValue === null ? say("txr:appraisal-wait", ["No appraisal yet.", "The appraisal hasn't come back yet."], f, c.used, c.seed) : withholding === "guarded" && botSide(s) === "buyer" ? say("txr:appraisal-guarded", ["The appraisal's in. We'll let you know if there's anything to discuss.", "We have it. Nothing to report yet."], f, c.used, c.seed) : say("txr:appraisal", ["The appraisal came in at {value}.", "Lender's appraisal: {value}."], { ...f, value: money(tx.appraisedValue) }, c.used, c.seed));
        break;
      case "mortgage":
        if (botSide(s) === "buyer") parts.push(withholding === "guarded" ? say("txr:mortgage-guarded", ["The financing is in progress.", "We'll deal with the financing on our side."], f, c.used, c.seed) : say(`txr:mortgage-${tx.loanStatus}`, { approved: ["The commitment's in. Financing is done.", "We have the mortgage commitment."], processing: ["The lender's still working on it.", "Still waiting on the lender."], declined: ["We've hit a snag with the lender. I'll update you.", "The lender's being difficult. Working on it."], "n/a": ["It's a cash purchase, no mortgage.", "No financing on this one; it's cash."] }[tx.loanStatus], f, c.used, c.seed));
        else parts.push(say("txr:mortgage-seller", ["That's on your buyers' side. Let me know when the commitment's in.", "Your buyers' lender: keep me posted."], f, c.used, c.seed));
        break;
      case "closing":
        parts.push(say("txr:closing", ["Completion is {completion}. The lawyers will sort out the keys.", "We're on track for {completion}.", "{completion} it is. Keys get released through the lawyers that day."], f, c.used, c.seed));
        break;
      case "deposit":
        parts.push(tx.depositPaid ? say("txr:deposit-in", ["The deposit's in trust at our brokerage.", "Deposit received and held in trust."], f, c.used, c.seed) : say("txr:deposit-out", ["We're waiting on the deposit.", "The deposit hasn't arrived yet."], f, c.used, c.seed));
        break;
      case "thanks":
        parts.push(say("txr:thanks", ["You're welcome.", "No problem.", "Anytime."], f, c.used, c.seed));
        break;
    }
  }
  if (!parts.length) parts.push(say(`txr:fallback:${s.difficulty.temperament}`, { collaborative: ["Thanks, noted. I'll keep you posted on our side.", "Got it, thanks. I'll pass that along to {who}.", "Thanks for letting me know."], professional: ["Thanks, noted. I'll keep you posted on our side.", "Noted. I'll update you if anything changes.", "Received, thanks."], cagey: ["Noted.", "Okay.", "Got it."], hardball: ["Noted. Anything else?", "Fine.", "Okay. Let's keep this moving."] }[s.difficulty.temperament], f, c.used, c.seed));
  return parts.join(" ");
}
