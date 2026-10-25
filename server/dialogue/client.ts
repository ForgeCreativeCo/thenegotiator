// What the user's own client says offline, in one of four personalities read from their story:
// anxious, analytical, emotional or blunt. Code decides every decision and number; this only words it.
// Lines use voice tokens so they work for one client ("I") or a couple ("we").

import type { Scenario } from "../engine/types";
import { displayDate, money } from "../narrative/format";
import type { Topic } from "../client/types";
import { Rng } from "../engine/rng";
import { say, type Fill } from "./pick";

export type ClientStyle = "anxious" | "analytical" | "emotional" | "blunt";

export interface ClientCtx {
  s: Scenario;
  used?: string[];
  seed: number;
}

function story(s: Scenario) {
  return s.userRole === "buyer_agent" ? s.narrative.buyerStory : s.narrative.sellerStory;
}

function brief(s: Scenario) {
  return s.userRole === "buyer_agent" ? s.buyer : s.seller;
}

/** The client's personality, read from their story's quirks, or from the scenario's seed when the quirks don't say. */
export function clientStyle(s: Scenario): ClientStyle {
  const quirks = story(s).quirks.join(" ");
  if (/anxious|nervous|worr|spouse|parents|defers/i.test(quirks)) return "anxious";
  if (/housesigma|research|in writing|spreadsheet|numbers|data/i.test(quirks)) return "analytical";
  if (/personally|love|memor|heart|emotional/i.test(quirks)) return "emotional";
  if (/won|blunt|direct|impatient|competitive/i.test(quirks)) return "blunt";
  return new Rng(s.seed ^ 0x57e1e).pick(["anxious", "analytical", "emotional", "blunt"] as const);
}

/** Voice tokens: {We} {we} {our} {us} {Weare} {weare} {Weve} {weve} {Well} {well} {Wed} {wed}. */
function voice(s: Scenario): Fill {
  const plural = /\band\b|&/i.test(story(s).clientNames);
  return plural
    ? { We: "We", we: "we", our: "our", Our: "Our", us: "us", Weare: "We're", weare: "we're", Weve: "We've", weve: "we've", Well: "We'll", well: "we'll", Wed: "We'd", wed: "we'd" }
    : { We: "I", we: "I", our: "my", Our: "My", us: "me", Weare: "I'm", weare: "I'm", Weve: "I've", weve: "I've", Well: "I'll", well: "I'll", Wed: "I'd", wed: "I'd" };
}

function line(c: ClientCtx, pool: string, byStyle: Record<ClientStyle, readonly string[]>, extra: Fill = {}): string {
  const style = clientStyle(c.s);
  return say(`client:${pool}:${style}`, byStyle[style], { ...voice(c.s), ...extra }, c.used, c.seed);
}

// ---------- Answers to the agent's questions ----------

function answer(c: ClientCtx, topic: Topic | "greeting" | "thanks" | "opinion" | "statement" | "unclear", competitionKnown: boolean): string {
  const s = c.s;
  const b = brief(s);
  const buyer = b.side === "buyer";
  const f: Fill = { limit: money(b.reservationPrice), ideal: displayDate(b.idealClose), earliest: displayDate(b.earliestClose), latest: displayDate(b.latestClose), street: s.property.address.street };
  switch (topic) {
    case "price":
      return buyer
        ? line(c, "price-buyer", {
            anxious: ["{limit} is already scary for {us}. Please don't go past it.", "{We} said {limit}, and honestly even that keeps {us} up at night."],
            analytical: ["{limit} is the ceiling. {Weve} run the numbers on the carrying costs and that's where it breaks.", "The model says {limit}. Above that the monthly payment doesn't work."],
            emotional: ["{We} love it, but {limit} is all {we} have. Please make it work.", "It's {our} dream house, but {limit} is the limit. {We} can't stretch any further."],
            blunt: ["{limit}. Not a dollar more.", "Max is {limit}. You know that."],
          }, f)
        : line(c, "price-seller", {
            anxious: ["{We} really can't go under {limit}. {We} need it for what comes next.", "Below {limit} and {we} don't know how {we}'d manage."],
            analytical: ["{limit} is the floor. After the mortgage, commission and moving costs, anything less doesn't make sense.", "{Weve} worked it out: {limit} is the minimum net that works."],
            emotional: ["{Weve} put so much into this house. {limit} is the least {we} can accept.", "{We} can't let it go for less than {limit}. Not after everything."],
            blunt: ["{limit}. That's the bottom.", "Nothing under {limit}. Period."],
          }, f);
    case "timing":
      return line(c, "timing", {
        anxious: ["Around {ideal} would be best. Anything between {earliest} and {latest}, but the sooner {we} know, the better.", "{ideal} if possible. {We} can't go past {latest}, though. That would be a disaster."],
        analytical: ["Ideal is {ideal}. The workable window is {earliest} to {latest}.", "{earliest} to {latest} works, with {ideal} as the target."],
        emotional: ["{ideal} would be perfect for {us}. Between {earliest} and {latest} works.", "{Wed} love to be settled by {ideal}. Anything from {earliest} to {latest} is okay."],
        blunt: ["{ideal}. {earliest} to {latest} at a stretch.", "Between {earliest} and {latest}. {ideal} is best."],
      }, f);
    case "deposit":
      return buyer
        ? line(c, "deposit-buyer", {
            anxious: ["A normal deposit is fine, but {we} lose it if something goes wrong, right? Let's be careful.", "{We} can do the usual deposit. Is it safe until closing?"],
            analytical: ["The usual {typical}% is fine. It's held in trust, and it's part of the down payment anyway.", "{typical}% is the norm here, so let's match it."],
            emotional: ["Whatever shows them {weare} serious about this house.", "{Well} do the normal deposit. {We} want them to know {we} mean it."],
            blunt: ["Standard deposit. Don't overdo it.", "The usual. Next question."],
          }, { typical: s.market.typicalDepositPct })
        : line(c, "deposit-seller", {
            anxious: ["{Wed} want at least {pct}%. What if they walk?", "At least {pct}%, please. {We} need to know they're committed."],
            analytical: ["Minimum {pct}%. It's the only real protection if they default.", "{pct}% or more. That's standard risk management."],
            emotional: ["At least {pct}%. {We} want buyers who are really committed to this home.", "{pct}% at least. {We} don't want to go through a failed sale."],
            blunt: ["{pct}% minimum.", "At least {pct}%. Non-negotiable."],
          }, { pct: s.seller.minDepositPct });
    case "inspection":
    case "conditions":
    case "financing": {
      if (!buyer) {
        return line(c, "conditions-seller", {
          anxious: ["Conditions make {us} nervous. No more than {days} banking days, please.", "Keep them short, {days} banking days at most. {We} can't be in limbo."],
          analytical: ["{days} banking days maximum on any condition. Longer just adds risk.", "Short conditions: {days} banking days. Firm is better if it's close on price."],
          emotional: ["{Wed} rather not have conditions hanging over {us}. {days} banking days at most.", "Please keep it simple. {days} banking days, no more."],
          blunt: ["{days} banking days. Max.", "Short conditions or firm. {days} days tops."],
        }, { days: s.seller.maxConditionDays });
      }
      const waive = b.willingToWaive.map((w) => w.replace("_", " "));
      return waive.length
        ? line(c, "conditions-buyer-flex", {
            anxious: ["If {we} really have to, {we}'d drop the {waive} condition. But only if you think it's safe.", "{We} could go without {waive}, but it makes {us} nervous."],
            analytical: ["{We} can waive {waive} if it wins the deal. Everything else stays.", "{waive} is the only one {wed} give up, and only to compete."],
            emotional: ["{Wed} give up {waive} if that's what it takes to get this house.", "For this house? {We} could live without the {waive} condition."],
            blunt: ["{We} can drop {waive}. Nothing else.", "Drop {waive} if you need to. Keep the rest."],
          }, { waive: waive.join(" or ") })
        : line(c, "conditions-buyer-firm", {
            anxious: ["{We} need {our} conditions. Going in firm would terrify {us}.", "Please keep the conditions. {We} can't risk it."],
            analytical: ["Conditions stay in. Financing and inspection protect the deposit.", "{We} need the conditions. The risk of going firm isn't worth it."],
            emotional: ["{We} need to know the house is sound before {we} commit. The conditions stay.", "{We} can't go in blind. {We} need {our} conditions."],
            blunt: ["Conditions stay.", "No firm offers. Keep the conditions."],
          });
    }
    case "chattels":
      return line(c, `chattels-${buyer ? "buyer" : "seller"}`, buyer
        ? { anxious: ["The usual appliances, please. {We} can't afford new ones right away.", "Appliances should come with it, right?"], analytical: ["Standard appliances included. Anything else is a bonus.", "Appliances in. That's worth a few thousand."], emotional: ["The appliances, and anything that makes it feel like home on day one.", "Whatever comes with it, {well} take."], blunt: ["Appliances stay. That's it.", "Usual appliances."] }
        : { anxious: ["The appliances can stay. Is that normal?", "{Well} leave the appliances. Is anything else expected?"], analytical: ["Appliances can stay; it's priced in.", "Standard appliances stay. Anything else we discuss."], emotional: ["The appliances can stay. Someone should enjoy them.", "Leave the appliances for them."], blunt: ["Appliances stay.", "They can have the appliances."] });
    case "fixtures":
      return line(c, "fixtures", {
        anxious: ["{We} can't think of anything else. Should {we} be worried?", "Nothing else comes to mind. Did {we} miss something?"],
        analytical: ["Nothing else to exclude that {we} can think of.", "No other fixtures to deal with."],
        emotional: ["Nothing else, really.", "{We} can't think of anything else."],
        blunt: ["No.", "Nothing else."],
      });
    case "competition":
      if (!buyer) return line(c, "competition-seller", { anxious: ["Do you think more offers will come in?", "Is that good? Should {we} wait for more?"], analytical: ["Competition is good. Get them to sharpen their pencils.", "Use it. Tell them the true number and let them compete."], emotional: ["Really? People love it that much?", "That's wonderful to hear."], blunt: ["Good. Get the best one.", "Make them compete."] });
      return competitionKnown
        ? line(c, "competition-known", { anxious: ["Other offers? That makes {us} so nervous. But {our} number is {our} number.", "Oh no. Do {we} still have a chance?"], analytical: ["Then {we} need {our} strongest terms, not just price.", "Expected in this market. Let's compete on terms."], emotional: ["{We} can't lose this one. What do {we} do?", "Please don't let {us} lose it."], blunt: ["Then let's win it. Within {our} number.", "Fine. Make {our} offer count."] })
        : line(c, "competition-unknown", { anxious: ["Are there other offers? Let {us} know if you hear anything.", "Do you think others are looking at it?"], analytical: ["Do you know if there's other interest?", "Any data on other offers?"], emotional: ["{We} hope nobody else wants it as much as {we} do.", "Is anyone else interested?"], blunt: ["Any competition?", "Others looking?"] });
    case "motivation":
      return line(c, "motivation", {
        anxious: ["{told} {We} just want this to go smoothly.", "{told} It's a lot, honestly."],
        analytical: ["{told} That's the whole picture.", "{told}"],
        emotional: ["{told} It means a lot to {us}.", "{told} This is a big moment for {us}."],
        blunt: ["{told}", "{told} That's it."],
      }, { told: story(s).whatTheyveToldYou.split(/(?<=\.)\s/)[0] ?? "" });
    case "greeting":
      return line(c, "greeting", { anxious: ["Hi! Any news?", "Hi. Is everything okay?"], analytical: ["Hi. What's the update?", "Hello. Where are we?"], emotional: ["Hi! So good to hear from you.", "Hello! {Weve} been thinking about the house all day."], blunt: ["Hi. What's up?", "Yes?"] });
    case "thanks":
      return line(c, "thanks", { anxious: ["Thank you. {We} really appreciate you.", "Thanks. It helps to hear that."], analytical: ["Thanks. That's useful.", "Appreciated."], emotional: ["Thank you so much. Really.", "You're the best. Thank you."], blunt: ["Thanks.", "Good."] });
    case "opinion":
      return line(c, "opinion", { anxious: ["{We} trust you. What would you do?", "{Weare} not sure. What do you recommend?"], analytical: ["What do the numbers say? Give {us} your recommendation and your reasoning.", "Lay out the options and {well} decide."], emotional: ["What does your gut say?", "{We} just want the house. What do you think?"], blunt: ["You tell {us}. That's your job.", "What's your recommendation?"] });
    case "statement":
      return line(c, "statement", { anxious: ["Okay. Thanks for keeping {us} posted. Let {us} know the moment anything changes.", "Okay. Keep {us} in the loop, please."], analytical: ["Noted. Thanks.", "Understood. Keep {us} posted."], emotional: ["Thanks for telling {us}. Fingers crossed!", "Okay! Thanks for the update."], blunt: ["Got it.", "Okay."] });
    case "unclear":
      return line(c, "unclear", { anxious: ["Sorry, {weare} not sure what you mean. Is something wrong?", "{Weare} confused. What do you need from {us}?"], analytical: ["Can you be more specific?", "What exactly are you asking?"], emotional: ["Sorry, what do you mean?", "{Weare} not sure {we} follow."], blunt: ["Meaning what?", "Be specific."] });
  }
}

const OPINION = /\b(what do you think|should (we|i)|thoughts|your (call|view)|recommend|how do you feel|happy with)\b/i;

/** Answers to up to two things the agent raised, or a revealed fact in the client's own words first. */
export function clientChatDraft(c: ClientCtx, text: string, topics: Topic[], revealed: { says: string; topics?: Topic[] } | null, competitionKnown: boolean): string {
  const parts: string[] = [];
  if (revealed) parts.push(revealed.says);
  const greeting = /^\s*(hi|hello|hey|good (morning|afternoon|evening))\b/i.test(text);
  const thanks = /\b(thanks|thank you)\b/i.test(text);
  // A revealed fact answers its own topics; anything else they asked still gets an answer.
  const asked = topics.filter((t) => !revealed?.topics?.includes(t)).slice(0, revealed ? 1 : 2);
  for (const topic of asked) parts.push(answer(c, topic, competitionKnown));
  if (!revealed && !asked.length) {
    if (greeting) parts.push(answer(c, "greeting", competitionKnown));
    if (OPINION.test(text)) parts.push(answer(c, "opinion", competitionKnown));
    else if (thanks) parts.push(answer(c, "thanks", competitionKnown));
    else if (!greeting) parts.push(answer(c, text.includes("?") ? "unclear" : "statement", competitionKnown));
  }
  return parts.join(" ");
}

// ---------- Reviews, presenting, direction ----------

export function clientReviewDraft(c: ClientCtx, verdict: "signed" | "reluctant" | "refused", document: string, told: string[], outsideLimits: boolean): string {
  const f = { doc: document };
  if (verdict === "refused") {
    const open = line(c, "review-refuse", {
      anxious: ["{We} can't sign this {doc}. {Weare} sorry.", "No, {we} can't sign the {doc} like this. It scares {us}."],
      analytical: ["{We} won't sign this {doc} as written.", "This {doc} doesn't work. Here's why."],
      emotional: ["{We} can't sign this {doc}. It doesn't feel right.", "{Weare} sorry, {we} can't put {our} name on this {doc}."],
      blunt: ["Not signing this {doc}.", "No. Not this {doc}."],
    }, f);
    const limits = outsideLimits ? line(c, "review-limits", { anxious: ["It's outside what {we} told you {we} can do.", "{We} told you where {our} limits are."], analytical: ["It's outside the parameters {we} gave you.", "It breaks the limits {we} agreed on."], emotional: ["It's more than {we} said {we} could do.", "{We} told you {our} limits, remember?"], blunt: ["It's outside {our} instructions.", "You know {our} limits."] }) : "";
    return [open, ...told, limits].filter(Boolean).join(" ");
  }
  if (verdict === "reluctant")
    return line(c, "review-reluctant", {
      anxious: ["Okay, {well} sign the {doc}. But that's as far as {we} go. Please don't come back asking for more.", "{Well} sign it, but {weare} really nervous about this one."],
      analytical: ["Signed. That's {our} limit on this {doc}, though. There's nothing left.", "{Well} sign the {doc}, but it's at the edge of what works."],
      emotional: ["Okay. {Well} sign it. It's a stretch, but {we} want this.", "{Weve} signed the {doc}, but it hurts a little."],
      blunt: ["Fine. Signed. That's the end of the line.", "Signed. Don't ask for more."],
    }, f);
  return line(c, "review-signed", {
    anxious: ["This {doc} looks right. {Weve} signed it. Go ahead, and let {us} know as soon as you hear.", "Okay, signed. Fingers crossed!"],
    analytical: ["This {doc} looks right. Signed. Send it.", "Terms check out. {Weve} signed the {doc}."],
    emotional: ["Signed! This is so exciting.", "{Weve} signed the {doc}. Let's do this!"],
    blunt: ["Signed. Send it.", "Done. Go."],
  }, f);
}

export function clientPresentDraft(c: ClientCtx, a: { price: number; priceGap: number; otherProblems: number; count?: number }, told: string[]): string {
  const buyer = c.s.userRole === "buyer_agent";
  const list = c.s.property.listPrice;
  const f = { price: money(a.price), count: a.count ?? 1 };
  const parts: string[] = [];
  if (a.count && a.count > 1) parts.push(line(c, "present-many", { anxious: ["{count} offers! Walk {us} through them. The best price is {price}.", "{count} offers? Okay. The best is {price}? What do {we} do?"], analytical: ["{count} offers. Best price is {price}. Let's compare the terms side by side.", "{count} offers, top price {price}. Show {us} the conditions and deposits."], emotional: ["{count} offers! People really love it. The best is {price}?", "Wow, {count} offers! And {price} at the top."], blunt: ["{count} offers. {price} is the best? Go through them.", "{count}. Top is {price}. Next?"] }, f));
  if (a.priceGap > list * 0.05)
    parts.push(buyer
      ? line(c, "present-far-buyer", { anxious: ["{price}? That's way beyond what {we} can do.", "{price}?! {We} can't. {We} just can't."], analytical: ["{price} is well past {our} ceiling. That's not workable.", "At {price} the numbers don't work at all."], emotional: ["{price}? {Our} hearts sank when you said that.", "That's so far from what {we} can do."], blunt: ["{price}? No chance.", "{price}. Not happening."] }, f)
      : line(c, "present-far-seller", { anxious: ["{price}? That's so low. Are they serious?", "{price}? {We} can't. Is something wrong with the house?"], analytical: ["{price} is well under the comps. That's not a serious offer.", "At {price} the math doesn't work for {us}."], emotional: ["{price}? That's insulting.", "{price}? After everything {weve} put into this house?"], blunt: ["{price}? Insulting.", "{price}. No."] }, f));
  else if (a.priceGap > 0)
    parts.push(line(c, buyer ? "present-close-buyer" : "present-close-seller", { anxious: ["{price} is more than {we} can do, but it's not crazy. Can you get them closer?", "{price}... so close. Can you try?"], analytical: ["{price} is just outside {our} range. A small move gets it done.", "{price}: close, but not there. Push on terms."], emotional: ["{price}. It's close. Please try to bring them the rest of the way.", "So close at {price}! Can you work some magic?"], blunt: ["{price}. Close. Get them the rest of the way.", "Almost. Push."] }, f));
  else if (!a.count || a.count <= 1)
    parts.push(line(c, "present-ok", { anxious: ["{price}. {We} could live with that, if you think it's right.", "{price}? Okay. Is that good?"], analytical: ["{price} works within {our} numbers.", "{price} is inside {our} range. Check the other terms."], emotional: ["{price}! {We} could live with that.", "Oh, {price} feels good."], blunt: ["{price}. Works.", "{price}. Fine."] }, f));
  if (a.otherProblems > 0 && a.priceGap <= 0) parts.push(line(c, "present-terms", { anxious: ["Some of the other terms worry {us}, though.", "But something else in there doesn't sit right."], analytical: ["Some of the other terms don't work for {us}, though.", "Price is fine; some terms aren't."], emotional: ["Some of the other terms don't feel right, though.", "But not everything in there works for {us}."], blunt: ["Other terms are a problem.", "Fix the other terms."] }));
  return [...parts, ...told].filter(Boolean).join(" ");
}

export function clientDirectionDraft(c: ClientCtx, direction: "count_only" | "details"): string {
  return direction === "details"
    ? line(c, "direction-details", { anxious: ["If sharing what's in the other offers gets {us} a better price, do it. You have {our} direction in writing.", "Share the details if it helps. Is that allowed? Then yes, in writing."], analytical: ["Disclose the terms. Transparency should push the price up. Direction is in writing.", "Yes, share the offer details. {Weve} signed the direction."], emotional: ["Share them if it helps. You have {our} blessing in writing.", "Go ahead and share. {Weve} put it in writing."], blunt: ["Share the details. It's in writing.", "Disclose them. Signed."] })
    : line(c, "direction-count", { anxious: ["Just tell them how many offers there are. {We} don't want anyone's details going around. That's {our} direction, in writing.", "Only the number, please. {Weve} signed it."], analytical: ["Number of offers only. That's {our} written direction.", "Count only. Signed."], emotional: ["Just the number. Everyone's offer deserves privacy. It's in writing.", "Only how many. {Weve} signed the direction."], blunt: ["Count only. In writing.", "Just the number."] });
}

export function clientHoldDraft(c: ClientCtx, hold: boolean): string {
  return hold
    ? line(c, "hold-yes", { anxious: ["If you think holding offers gets {us} the best result, okay. {Well} sign the decision.", "A review night? It makes {us} nervous, but {we} trust you. Signed."], analytical: ["Agreed. Competition at a set time should maximize the price. Signed.", "Hold them. Let everyone compete at once. Decision signed."], emotional: ["Okay! It's exciting to think people will compete for {our} home. Signed.", "Let's do it. {Weve} signed."], blunt: ["Hold them. Signed.", "Fine. Review them all at once."] })
    : line(c, "hold-no", { anxious: ["Taking offers as they come sounds less stressful. Signed.", "Okay, as they come in. {Well} sign that."], analytical: ["Any time is fine. {Well} evaluate each one on its merits. Signed.", "Agreed: offers as they arrive. Signed."], emotional: ["As they come in is fine with {us}. Signed.", "Okay, {well} see them as they come. Signed."], blunt: ["Any time. Signed.", "Fine. Bring them as they come."] });
}

// ---------- After acceptance ----------

export const clientTxLines = {
  financingReluctant: (c: ClientCtx) => line(c, "tx-fin", { anxious: ["{Well} sign, but the lender hasn't confirmed anything yet. If the mortgage falls through after this, {we} lose the deposit, right? You're sure about this?", "No commitment from the bank yet... {weare} scared, but {well} sign if you say so."], analytical: ["Signing, but noting the risk: no commitment letter yet. If the mortgage fails, the deposit's exposed.", "{Well} sign. For the record, {weare} waiving without a commitment."], emotional: ["{Well} sign. Please tell {us} the bank will come through.", "Okay, signed. {We} just have to trust it'll work out."], blunt: ["Signed. If the bank falls through, that's on {us}. Got it.", "Fine. Signed. Lender better come through."] }),
  inspectionRefuse: (c: ClientCtx) => line(c, "tx-insp-no", { anxious: ["{We} won't waive the inspection until those findings are dealt with.", "Not with those findings sitting there. {We} can't."], analytical: ["Not until the findings are priced and settled. That's a hard no.", "Waiving with open findings makes no sense. Settle them first."], emotional: ["{We} can't waive with those problems hanging over the house.", "Not like this. Those findings scare {us}."], blunt: ["No waiver until the findings are fixed.", "Settle the findings first."] }),
  inspectionWorried: (c: ClientCtx) => line(c, "tx-insp-worried", { anxious: ["Those findings worry {us}. {Well} sign, but this is on the record: {weare} taking them on ourselves.", "{Weare} nervous about those findings, but {well} sign."], analytical: ["Signed. {Weve} factored in the cost of the findings.", "{Well} sign. The findings are {our} problem now; noted."], emotional: ["{Well} sign. {We} love the house, problems and all.", "It's not perfect, but it's going to be {our} home. Signed."], blunt: ["Signed. {Well} deal with the findings.", "Fine. Signed."] } ),
  releaseRefuse: (c: ClientCtx, what: string) => line(c, "tx-release-no", { anxious: ["Why would {we} walk away? {We} still want this {what}. Did something happen?", "Wait, end the deal? Why? {We} still want it."], analytical: ["There's no reason to end it. Nothing's gone wrong.", "Ending it makes no sense. {We} still want this {what}."], emotional: ["No! {We} still want this {what}.", "Walk away? {Weve} already pictured {our} life here."], blunt: ["No. {We} want this {what}.", "Not ending it. Why would {we}?"] }, { what }),
  releaseSign: (c: ClientCtx) => line(c, "tx-release-yes", { anxious: ["Okay. If that's the right call, {well} sign the release.", "If you think it's best... okay. Signed."], analytical: ["Agreed. Signed the release. Make sure the deposit comes back.", "Signed. Confirm the deposit refund, please."], emotional: ["It's sad, but okay. {Weve} signed.", "Okay. It wasn't meant to be. Signed."], blunt: ["Signed. Get the deposit back.", "Done. Release signed."] }),
  fulfil: (c: ClientCtx) => line(c, "tx-fulfil", { anxious: ["Signed. One step closer!", "Okay, signed. What's next?"], analytical: ["Signed. Next deadline?", "Notice signed."], emotional: ["Signed! One step closer.", "Yay, signed!"], blunt: ["Signed.", "Done."] }),
  firm: (c: ClientCtx) => line(c, "tx-firm", { anxious: ["Signed. So that's it, {weare} firm! Is that it?", "Okay... signed. {Weare} firm. Wow."], analytical: ["Signed. That makes it firm. On to completion.", "Firm. Next: requisitions and closing."], emotional: ["Signed. So that's it, {weare} firm!", "{Weare} firm! {We} can't believe it."], blunt: ["Signed. Firm. Good.", "Done. Firm."] }),
  waived: (c: ClientCtx) => line(c, "tx-waived", { anxious: ["Signed. {We} hope that's okay.", "Okay, signed."], analytical: ["Signed.", "Waiver signed."], emotional: ["Signed!", "There you go, signed."], blunt: ["Signed.", "Done."] }),
  amendmentSigned: (c: ClientCtx, isDate: boolean) => (isDate ? line(c, "tx-date-ok", { anxious: ["That date works. Signed.", "Okay, that date's fine. Signed."], analytical: ["Date works. Signed.", "Signed. Update the timeline."], emotional: ["That date works for {us}. Signed!", "Signed. That date's fine."], blunt: ["Date's fine. Signed.", "Signed."] }) : line(c, "tx-amend-ok", { anxious: ["Okay, signed. {We} hope it's the right call.", "Signed. Fingers crossed."], analytical: ["Signed. Numbers still work.", "Amendment signed."], emotional: ["Okay, signed.", "Signed. Let's keep it moving."], blunt: ["Signed.", "Fine. Signed."] })),
  amendmentRefused: (c: ClientCtx, reason: string) => `${line(c, "tx-amend-no", { anxious: ["{We} can't sign that.", "No, {we} can't do that one."], analytical: ["That doesn't work.", "{We} won't sign that."], emotional: ["{We} can't sign that.", "That's not okay with {us}."], blunt: ["No.", "Not signing that."] })} ${reason}`,
  presentNo: (c: ClientCtx, reason: string) => `${line(c, "tx-present-no", { anxious: ["No, {we} can't.", "{We} can't agree to that."], analytical: ["That doesn't work.", "No."], emotional: ["No, {we} can't do that.", "That's not okay."], blunt: ["No.", "Not happening."] })} ${reason}`,
  presentFairBuyer: (c: ClientCtx, amount: string) => line(c, "tx-present-fair-b", { anxious: ["{amount} is fair for what the inspector found, isn't it?", "{amount}. Okay, that seems fair."], analytical: ["{amount} covers most of the estimated repairs. Fair.", "{amount} is in line with the quotes. Acceptable."], emotional: ["{amount}. That's fair, {we} think.", "Okay, {amount} feels fair."], blunt: ["{amount}. Fair.", "{amount}. Take it."] }, { amount }),
  presentLowBuyer: (c: ClientCtx, amount: string) => line(c, "tx-present-low-b", { anxious: ["{amount}? That doesn't come close to covering what the inspector found. Can you push?", "Only {amount}? {Weare} worried that won't be enough."], analytical: ["{amount} covers a fraction of the repair estimates. Push for more.", "{amount} is well below the quotes. Counter."], emotional: ["{amount}? That's not enough to fix everything.", "Only {amount}? That feels unfair."], blunt: ["{amount}? Not enough. Push.", "Too low. Counter."] }, { amount }),
  presentOkSeller: (c: ClientCtx, amount: string) => line(c, "tx-present-ok-s", { anxious: ["{amount}, if it keeps the deal together.", "{amount}... okay, if it saves the deal."], analytical: ["{amount} is reasonable against the findings.", "{amount} is defensible. Fine."], emotional: ["{amount} if it keeps them happy.", "Okay, {amount}. {We} want this done."], blunt: ["{amount}. Fine.", "{amount}. Done."] }, { amount }),
  presentHighSeller: (c: ClientCtx, amount: string) => line(c, "tx-present-high-s", { anxious: ["{amount} feels like a lot. Is that really what it's worth?", "{amount}? That's so much. Do {we} have to?"], analytical: ["{amount} exceeds what the findings justify. Counter lower.", "{amount} is too high for those findings."], emotional: ["{amount}? For those little things?", "That's a lot to ask after everything."], blunt: ["{amount}? Too much.", "Counter lower."] }, { amount }),
  presentDate: (c: ClientCtx) => line(c, "tx-present-date", { anxious: ["That date works for {us}, {we} think.", "Okay, that date's fine."], analytical: ["That date works.", "Date's fine."], emotional: ["That date works for {us}.", "Sure, that date's okay."], blunt: ["Fine.", "Date works."] }),
  presentOther: (c: ClientCtx) => line(c, "tx-present-other", { anxious: ["Okay. What do you think {we} should do?", "Hmm. What would you do?"], analytical: ["Understood. What are the options?", "What's your recommendation?"], emotional: ["Okay. What do you think?", "What should {we} do?"], blunt: ["Your call. Recommend something.", "What do you suggest?"] }),
};
