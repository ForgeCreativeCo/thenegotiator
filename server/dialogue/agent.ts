// What the opposing agent says offline: its moves in its own temperament, and answers to what the user asks.
// Answers can carry real information, but only what a RECO registrant could share: never their client's limit,
// never a misrepresentation, and how much else they share follows the hidden "withholding" setting.

import type { Scenario } from "../engine/types";
import { displayDate, money } from "../narrative/format";
import { botSide } from "../negotiation/strategy";
import { cap, say, type Fill } from "./pick";

type Temperament = Scenario["difficulty"]["temperament"];

export interface AgentContext {
  s: Scenario;
  used?: string[];
  seed: number;
}

function clients(s: Scenario): string {
  return botSide(s) === "seller" ? "my sellers" : "my buyers";
}

function base(s: Scenario): Fill {
  const who = clients(s);
  return { who, Who: cap(who), street: s.property.address.street, me: s.narrative.opposingAgent.name.split(" ")[0] };
}

function line(c: AgentContext, pool: string, lines: readonly string[], extra: Fill = {}): string {
  return say(pool, lines, { ...base(c.s), ...extra }, c.used, c.seed);
}

const t = (c: AgentContext): Temperament => c.s.difficulty.temperament;

// ---------- Moves ----------

const OPENERS: Record<Temperament, string[]> = {
  collaborative: ["Thanks for sending this over.", "Appreciate you working with us on this.", "Thanks, I think we're getting somewhere.", "Good to hear from you.", "Thanks for the quick turnaround.", "I appreciate the effort on this one."],
  professional: ["Thanks for the offer.", "Received, thank you.", "Thanks. I reviewed this with {who}.", "Thanks, I've gone over it with {who}.", "Thank you. {Who} have had a look.", "Got your paperwork, thanks."],
  cagey: ["Got it.", "Thanks. Interesting.", "I took a look.", "Okay.", "Hm. I've had a look.", "Right. I've shown {who}."],
  hardball: ["Look,", "I'll be straight with you.", "Let's not waste each other's time.", "I'll keep this short.", "Let's be realistic here.", "Here's the thing."],
};

const FIRST_OFFER = [
  "Hi, it's {me}. Sending over an offer from {who} on {street}:",
  "Hi, {me} here. {Who} would like to make an offer on {street}:",
  "Good morning. {me} here with an offer on {street} from {who}:",
  "Hi there, it's {me}. Attached is {who}' offer on {street}:",
];

const COUNTER_LEAD: Record<Temperament, string[]> = {
  collaborative: ["We're countering at {price}.", "{Who} can come to {price}.", "We've moved to {price}.", "{Who} are signing back at {price}."],
  professional: ["We're countering at {price}.", "{Who} are signing back at {price}.", "Our counter is {price}.", "The sign-back is at {price}."],
  cagey: ["{price}.", "{Who} will do {price}.", "We're at {price} now.", "Counter's {price}."],
  hardball: ["{price}. That's where we are.", "We're at {price}.", "{Who} are at {price}, and that's a real number.", "The counter is {price}."],
};

const SELLER_REASONS = [
  "The comps support it.",
  "We've had good activity on this one.",
  "It's priced right for the condition.",
  "{comp} sold for {compPrice}, and this one shows better.",
  "Look at what's sold nearby: {comp} went for {compPrice}.",
  "It's been kept up well, and buyers can see that.",
  "Turnkey homes like this don't come up often on {street}.",
];

const BUYER_REASONS = [
  "That's where the comps put it.",
  "My buyers are being realistic about the work this needs.",
  "That's a strong offer in this market.",
  "{comp} sold for {compPrice}, and that one needed less work.",
  "It's a {age}-year-old house, and my buyers are pricing that in.",
  "It's a fair number for what it is.",
  "My buyers are stretching as it is.",
];

const CHANGES = ["We also need to adjust {changes}.", "We've also changed {changes}.", "A couple of other changes: {changes}.", "Note the other changes: {changes}."];

const REJECT: Record<Temperament, string[]> = {
  collaborative: ["{Who} aren't able to respond to that number. Can we find something closer to the comps?", "That one's too far apart for {who} to sign back. Help me find a number I can take to them.", "I took it to {who}, but it's too far from where they need to be. Let's keep talking."],
  professional: ["{Who} aren't going to respond to that number. Come back with something closer to the comps and we can talk.", "{Who} have declined to sign back at that price.", "That isn't a number {who} can work with. I'd look at the comps again."],
  cagey: ["{Who} passed on that.", "That's not going to get a response.", "No. They didn't even want to counter it."],
  hardball: ["That's not a serious offer. {Who} won't respond to it.", "We're not going to dignify that with a counter. Come back with a real number.", "No. Look at the comps and come back when you're ready to do a deal."],
};

const ACCEPT: Record<Temperament, string[]> = {
  collaborative: ["{Who} accept. Congratulations, we have a deal! I'll get the signed agreement back to you within the hour.", "Good news: {who} have signed. Congratulations, it's a deal.", "We have a deal. {Who} are thrilled. Signed copy coming your way."],
  professional: ["{Who} accept. I'll get the signed agreement back to you within the hour. Congratulations, we have a deal.", "Accepted. Signed agreement to follow shortly.", "{Who} have accepted. I'll send the signed copy and the deposit details."],
  cagey: ["They've signed.", "Accepted. Paperwork's on its way.", "Done. {Who} accept."],
  hardball: ["Fine. {Who} accept. Signed agreement to follow.", "Deal. Let's get it done.", "{Who} will take it. Paperwork's coming."],
};

const WALK: Record<Temperament, string[]> = {
  collaborative: ["I don't think we're going to get there. {Who} have gone as far as they can. If anything changes on your side, give me a call.", "I'm sorry, but {who} are going to step away. It's been a pleasure working with you, and my door's open."],
  professional: ["I don't think we're going to get there. {Who} have gone as far as they can. If anything changes on your side, give me a call.", "{Who} have decided not to continue. Thanks for your time on this."],
  cagey: ["We're done here. {Who} are moving on.", "{Who} are out. Thanks."],
  hardball: ["We're too far apart. {Who} are walking. Call me if your clients get realistic.", "That's it for us. Good luck."],
};

const HOLD_TAIL: Record<Temperament, string[]> = {
  collaborative: ["Where we are right now is {price}. Send me something in writing and I'll present it right away.", "We're at {price} at the moment. Put something in writing and I'll take it straight to {who}.", "{price} is where things stand. I'm happy to present anything you send."],
  professional: ["Where we are right now is {price}. Send me something in writing and I'll present it right away.", "Our position is {price}. I'll present anything in writing.", "We're at {price}. Anything in writing gets presented promptly."],
  cagey: ["We're at {price}. Put it in writing.", "{price}. Send me an offer if you want an answer.", "It's {price} for now."],
  hardball: ["We're at {price}. Talk is cheap: put it in writing.", "{price}. Send me something real.", "Our number is {price}. Make an offer or don't."],
};

function age(s: Scenario): number {
  return Math.max(1, new Date(`${s.startDate}T12:00:00Z`).getUTCFullYear() - s.property.yearBuilt);
}

/** The comp that best argues the agent's side, if any comp argues it at all against `position`. */
function support(c: AgentContext, position: number): { values: Fill; supports: boolean } {
  const comps = [...c.s.comps].sort((a, b) => a.soldPrice - b.soldPrice);
  const seller = botSide(c.s) === "seller";
  const comp = seller ? comps[comps.length - 1] : comps[0];
  const supports = Boolean(comp) && (seller ? comp.soldPrice >= position * 0.97 : comp.soldPrice <= position * 1.03);
  return { values: { comp: comp?.address ?? "the house down the street", compPrice: money(comp?.soldPrice ?? c.s.property.listPrice), age: age(c.s) }, supports };
}

const SELLER_GENERAL = ["Comps only tell part of the story. This one's in better shape than most.", "You won't find another like it on {street} at this price.", "It's priced right for what it is."];
const BUYER_GENERAL = ["Comps only tell part of the story. This one isn't worth a premium.", "My buyers have looked at plenty of houses. This is a fair number.", "It's a fair offer for what it is."];

export const agentLines = {
  opener: (c: AgentContext) => line(c, `opener:${t(c)}`, OPENERS[t(c)]),
  firstOffer: (c: AgentContext) => line(c, "first-offer", FIRST_OFFER),
  counterLead: (c: AgentContext, price: number) => line(c, `counter:${t(c)}`, COUNTER_LEAD[t(c)], { price: money(price) }),
  counterReason: (c: AgentContext, price: number) => {
    const f = support(c, price);
    const seller = botSide(c.s) === "seller";
    // Only the reasons this deal's facts back up: a comp on their side, and the house's age when it's actually old.
    const fits = (r: string) => (!r.includes("{comp}") || f.supports) && (!r.includes("{age}") || age(c.s) >= 15);
    return seller ? line(c, "reason:seller", SELLER_REASONS.filter(fits), f.values) : line(c, "reason:buyer", BUYER_REASONS.filter(fits), f.values);
  },
  changes: (c: AgentContext, changes: string) => line(c, "changes", CHANGES, { changes }),
  reject: (c: AgentContext) => line(c, `reject:${t(c)}`, REJECT[t(c)]),
  accept: (c: AgentContext) => line(c, `accept:${t(c)}`, ACCEPT[t(c)]),
  walk: (c: AgentContext) => line(c, `walk:${t(c)}`, WALK[t(c)]),
  holdTail: (c: AgentContext, price: number) => line(c, `hold:${t(c)}`, HOLD_TAIL[t(c)], { price: money(price) }),
};

// ---------- Offer nights ----------

export const offerNightLines = {
  /** The listing agent answering a registered buyer's agent: the deadline and the true count. */
  listingStatus: (c: AgentContext, where: string, countText: string) =>
    line(c, "night:listing-status", ["{where} Right now {count}. Get your best in.", "{where} As of now, {count}. Make it your best.", "{where} So far {count}. I'd put your best foot forward.", "{where} At the moment {count}. Don't hold back."], { where, count: countText }),
  /** The buyer's agent answering the listing agent. */
  buyerAgentAck: (c: AgentContext, countKnown: boolean) =>
    countKnown
      ? line(c, "night:buyer-ack", ["Thanks, that's helpful. We'll be ready.", "Good to know. We'll have our best in.", "Appreciate the transparency. We'll be there.", "Thanks. My buyers are serious."])
      : line(c, "night:buyer-ask", ["Thanks. How many offers are registered right now?", "Appreciated. Can you tell me how many offers you have?", "Thanks. Are there other registered offers yet?"]),
  register: (c: AgentContext) => line(c, "night:register", ["Our offer is registered with your brokerage for offer night.", "We've registered our offer. Looking forward to the review.", "Offer registered. Please confirm you've received it.", "Our offer's in and registered for the review."]),
  improve: (c: AgentContext) => line(c, "night:improve", ["Here's our improved offer. That's our best.", "Improved offer attached. My buyers have dug deep.", "This is our final, best offer.", "Revised offer attached. There's nothing left after this."]),
  bully: (c: AgentContext, price: string, firm: string, deposit: string) =>
    line(c, "night:bully", ["I know you're holding offers, but my buyers don't want to wait. Here's a pre-emptive offer at {price}, {firm}, {deposit} deposit herewith, irrevocable for 4 hours.", "My buyers want this one now. Pre-emptive offer at {price}, {firm}, {deposit} deposit herewith. It's open for 4 hours.", "Before offer night: my buyers are offering {price}, {firm}, with {deposit} herewith. Irrevocable for 4 hours, so your sellers will need to decide quickly."], { price, firm, deposit }),
  wonIt: (c: AgentContext, count: string) => line(c, "night:won", ["Congratulations: out of {count}, my sellers have accepted yours.", "Good news. Out of {count}, yours is the one. Congratulations.", "My sellers have chosen your offer, out of {count}. Congratulations."], { count }),
  lostIt: (c: AgentContext, count: string) =>
    line(c, "night:lost", ["Thanks for competing. Out of {count}, my sellers have accepted another one. I'm sorry it wasn't your buyers this time.", "I'm sorry. Out of {count}, my sellers went with another. Thanks for your buyers' effort.", "It was close, but out of {count}, my sellers chose another. Thanks for competing."], { count }),
  sendBack: (c: AgentContext, count: string, deadline: string) =>
    line(c, "night:send-back", ["We have {count}. My sellers are sending everyone back to improve. Best offers by {deadline}", "{count} came in. My sellers would like everyone to improve. Best and final by {deadline}", "We've got {count}. My sellers are giving everyone one chance to improve, by {deadline}"], { count, deadline }),
};

/** The opposing listing agent, when another buyer's offer arrives while you're negotiating. */
export const listingLines = {
  holdNow: (c: AgentContext, when: string, count: string) =>
    line(c, "listing:hold-now", ["We've received {count}. My sellers will review all offers at {when}. Your offer is registered for the review, and you can improve it before then.", "Heads up: {count} came in. My sellers have decided to review everything together at {when}. Yours is registered; improve it if you want to.", "There's {count} now, so my sellers are holding offers until {when}. Your offer's registered. You can send an improved one before the review."], { when, count }),
  soldElsewhere: (c: AgentContext) =>
    line(c, "listing:sold-elsewhere", ["I'm sorry. Another offer came in and my sellers have accepted it. Thanks for your buyers' interest.", "Bad news, I'm afraid: my sellers accepted another buyer's offer. I'm sorry it didn't work out.", "My sellers have accepted another offer. I'm sorry; I know your buyers were keen."]),
};

// ---------- Answering the user ----------

export type AgentTopic = "greeting" | "thanks" | "pushback" | "motivation" | "timing" | "price" | "comps" | "condition" | "offers" | "deposit" | "conditions" | "financing" | "inclusions";

const AGENT_TOPICS: [AgentTopic, RegExp][] = [
  ["offers", /\b(other offers?|competing|multiple offers|any offers|offers? (in|on the table)|interest|showings?|anyone else|other buyers|looking at other)\b/i],
  ["motivation", /\b(why (are|is) (they|he|she|your)|reason|motivat|moving|selling because|why sell|what'?s (their|the) story|situation)\b/i],
  ["timing", /\b(clos(e|ing)|completion|complete|possession|date|when|timeline|timing|how soon|flexib(le|ility) on (the )?(date|timing))\b/i],
  ["price", /\b(bottom line|lowest|highest|best price|flexib(le|ility)|room|wiggle|negotiable|move on (the )?price|come down|go up|sharpen|budget|how (low|high|much))\b/i],
  ["comps", /\b(comps?|comparables?|sold (for|nearby|down the street)|market value|appraise|overpriced|underpriced|priced|worth)\b/i],
  ["condition", /\b(condition|roof|furnace|basement|foundation|repairs?|updates?|renovat|inspection|issues?|problems?|defects?|disclos|age of)\b/i],
  ["deposit", /\b(deposit|cheque|bank draft|herewith)\b/i],
  ["conditions", /\b(conditions?|firm|waive|conditional)\b/i],
  ["financing", /\b(financ|mortgage|pre-?approv|lender|cash buyer|down payment)\b/i],
  ["inclusions", /\b(appliances?|chattels?|fixtures?|includ|stays?|hot tub|rental|water heater)\b/i],
  ["pushback", /\b(ridiculous|insult|joke|unrealistic|crazy|come on|seriously|lowball|greedy|unreasonable|no way|too (high|low|much))\b/i],
  ["thanks", /\b(thanks|thank you|appreciate|cheers)\b/i],
  ["greeting", /^\s*(hi|hello|hey|good (morning|afternoon|evening))\b|\bhow are you\b/i],
];

export function agentTopicsIn(text: string): AgentTopic[] {
  return AGENT_TOPICS.filter(([, re]) => re.test(text)).map(([topic]) => topic);
}

const MOTIVATION_OPEN: Record<string, string> = {
  bought_firm_elsewhere: "They've bought their next place, so the completion date matters to them as much as the price.",
  relocation: "They're relocating for work, so a clean, certain deal matters to them.",
  estate: "It's an estate sale. The family wants it handled cleanly.",
  downsizing: "They're downsizing. They're ready, but they're not desperate.",
  retirement_move: "They're retiring and moving away, so they'd like a smooth, predictable close.",
  investor_exit: "It's an investment property they're ready to move on from.",
  tired_landlord: "They've been landlords long enough. They'd like to be done with it.",
  builder: "It's builder inventory. They'd like it sold, but they won't give it away.",
  testing_the_market: "Honestly, they're in no hurry. They'll sell if the number's right.",
  first_time: "They're first-time buyers, and they've fallen for this place.",
  growing_family: "They've got a growing family and they need the space.",
  move_up: "They're moving up from their first home.",
  downsizer: "They're empty nesters, downsizing.",
  investor: "They're investors. For them it's about the numbers.",
};
/** Motivations a registrant shouldn't share even with permission: they'd hand the other side leverage over a vulnerable client. */
const PRIVATE_MOTIVATIONS = ["separation", "financial_strain", "lease_ending"];

function share(c: AgentContext): "open" | "reserved" | "guarded" {
  return c.s.difficulty.withholding;
}

function botBrief(c: AgentContext) {
  return botSide(c.s) === "seller" ? c.s.seller : c.s.buyer;
}

function answerTopic(c: AgentContext, topic: AgentTopic, ctx: { currentPrice: number; currentNet: number; reservationNet: number; competing: number | null }): string {
  const s = c.s;
  const level = share(c);
  const brief = botBrief(c);
  const seller = botSide(s) === "seller";
  const k = (name: string) => `${name}:${level}`;
  switch (topic) {
    case "greeting":
      return line(c, `greet:${t(c)}`, {
        collaborative: ["Hi! Good to hear from you.", "Hey, thanks for reaching out.", "Hi there, hope your week's going well."],
        professional: ["Hello, thanks for getting in touch.", "Hi, good to hear from you.", "Good to hear from you."],
        cagey: ["Hi.", "Hey.", "What can I do for you?"],
        hardball: ["Let's get to it.", "Hi. What have you got?", "Go ahead."],
      }[t(c)]);
    case "thanks":
      return line(c, "thanks", ["You're welcome.", "No problem at all.", "Anytime.", "Happy to help."]);
    case "pushback":
      return line(c, `pushback:${t(c)}`, {
        collaborative: ["I hear you. Let's focus on what we can agree on.", "I understand the frustration. Let's see where we can meet.", "Fair enough. Tell me what would work for your clients."],
        professional: ["I understand. Our position is based on the comps.", "Noted. If your clients see it differently, put it in an offer.", "I'll pass that along, but the number stands for now."],
        cagey: ["That's your opinion.", "Okay.", "We'll see."],
        hardball: ["Then make a better offer.", "The market will decide that, not you.", "If that's how your clients feel, they're free to look elsewhere."],
      }[t(c)]);
    case "motivation": {
      const motive = brief.motivation;
      if (level === "open" && !PRIVATE_MOTIVATIONS.includes(motive) && MOTIVATION_OPEN[motive]) return line(c, `motive:${motive}`, [MOTIVATION_OPEN[motive], `With their permission: ${MOTIVATION_OPEN[motive].charAt(0).toLowerCase()}${MOTIVATION_OPEN[motive].slice(1)}`]);
      if (level === "guarded" || PRIVATE_MOTIVATIONS.includes(motive)) return line(c, "motive:guarded", ["I can't get into my clients' reasons. What I can tell you is they'll respond to a clean offer.", "That's their business, not mine to share.", "I'm not going to get into why. Let's talk terms.", "They have their reasons, and I'll leave it at that."]);
      return brief.urgency >= 4
        ? line(c, "motive:reserved-urgent", ["Timing matters to them more than you might think.", "A quick, clean deal would go a long way with them.", "Certainty matters to them right now."])
        : line(c, "motive:reserved-calm", ["They're not in any rush, put it that way.", "They're comfortable waiting for the right deal.", "They don't have to do anything quickly."]);
    }
    case "timing":
      return line(c, k("timing"), {
        open: ["They'd like to complete around {ideal}. Anything between {earliest} and {latest} works for them.", "{ideal} is ideal. They can do anything from {earliest} to {latest}.", "Their window is {earliest} to {latest}, ideally {ideal}."],
        reserved: ["Something around {ideal} would suit them.", "They're thinking {ideal}, give or take.", "{ideal} would be ideal."],
        guarded: ["Put your dates in the offer and I'll take it to them.", "Send me your preferred date and I'll see.", "Timing's negotiable, like everything else. Put it in writing."],
      }[level], { ideal: displayDate(brief.idealClose), earliest: displayDate(brief.earliestClose), latest: displayDate(brief.latestClose) });
    case "price": {
      const room = seller ? ctx.currentNet - ctx.reservationNet : ctx.reservationNet - ctx.currentNet;
      const roomy = room > s.property.listPrice * 0.015;
      const never = line(c, `price-never:${t(c)}`, ["I'm not going to negotiate against {who}. We're at {price}.", "You know I can't tell you their bottom line. We're at {price}.", "I won't speak for where they'll end up. Today, it's {price}.", "Their number is their number. Right now that's {price}."], { price: money(ctx.currentPrice) });
      if (level === "guarded") return never;
      if (level === "open") return `${never} ${roomy ? line(c, "price-room", ["There's some room for the right terms, but not a lot.", "The right offer would get their attention.", "Clean terms could move them a little."]) : line(c, "price-tight", ["We're close to where they need to be.", "There isn't much left in it, honestly.", "They're near the end of what they'll do."])}`;
      return `${never} ${line(c, "price-reserved", ["Make it worth their while and we'll see.", "Show them a reason and I'll take it to them.", "Every offer gets presented."])}`;
    }
    case "comps": {
      const f = support(c, ctx.currentPrice);
      if (!f.supports) return line(c, `comps-general:${seller ? "seller" : "buyer"}`, seller ? SELLER_GENERAL : BUYER_GENERAL, f.values);
      return line(c, `comps:${seller ? "seller" : "buyer"}`, seller
        ? ["{comp} sold for {compPrice}, and this one shows better.", "Look at {comp}: {compPrice}. We're priced in line with that.", "The comps support our number. {comp} went for {compPrice}.", "Have a look at {comp} at {compPrice}. Ours is a better house."]
        : ["{comp} went for {compPrice}, and it needed less work.", "The comps don't support that price. {comp} sold for {compPrice}.", "My buyers have done their homework. {comp} is {compPrice}.", "Look at {comp}: {compPrice}. That's the real market."], f.values);
    }
    case "condition": {
      const d = s.disclosures[0];
      if (seller) {
        if (level === "guarded" || !d) return line(c, "condition:seller-guarded", ["Everything we know is in the disclosures. Your buyers are welcome to inspect.", "It's all disclosed. Get an inspection if you want peace of mind.", "Nothing to add beyond what's disclosed."]);
        return line(c, "condition:seller", ["Everything's disclosed. Worth noting, the {item}: {detail}", "The disclosure covers it. In particular, the {item}: {detail}", "Nothing hidden. See the {item}: {detail}"], { item: d.item, detail: d.detail });
      }
      if (age(s) < 15) return line(c, "condition:buyer-newer", ["It's a newer house, but my buyers will still want an inspection.", "They like the condition. They'll inspect, of course.", "Condition looks good to them. We'll confirm with an inspection."]);
      return line(c, "condition:buyer", ["It's a {age}-year-old house. My buyers are budgeting for some work.", "My buyers liked it, but they've noticed it needs updating.", "They'll want an inspection; it's {age} years old.", "Condition's a factor for them. That's part of their number."], { age: age(s) });
    }
    case "offers": {
      if (!seller) return line(c, `offers:buyer-${level}`, { open: ["This is the one they want.", "They're focused on this one."], reserved: ["They like it, but they're not going to overpay.", "They're interested, but they're disciplined."], guarded: ["They're keeping their options open.", "I'll let them speak for themselves on that."] }[level]);
      const n = ctx.competing ?? 0;
      if (n > 0) return level === "guarded" ? line(c, "offers:some-guarded", ["I'll be honest: there's another offer.", "There's other interest in writing. I can't say more."]) : line(c, "offers:some", [`We have ${n} other offer${n === 1 ? "" : "s"} in hand.`, `There ${n === 1 ? "is" : "are"} ${n} other written offer${n === 1 ? "" : "s"}.`], {});
      return line(c, `offers:none-${level}`, { open: ["No other offers right now.", "Nothing else in writing at the moment.", "No, it's just you for now."], reserved: ["Nothing in writing right now.", "No other written offers today."], guarded: ["Nothing I can share right now. If an offer comes in, you'll hear it from me.", "If there's another offer, I'll tell you."] }[level]);
    }
    case "deposit":
      if (!seller) return line(c, `deposit:buyer-${level}`, { open: ["A {typical}% deposit is fine for them.", "They can do the usual {typical}%."], reserved: ["They'll do a normal deposit.", "A standard deposit, nothing unusual."], guarded: ["It'll be a fair deposit.", "Let's see where the price lands first."] }[level], { typical: s.market.typicalDepositPct });
      return line(c, `deposit:${level}`, { open: ["They'd want at least {pct}%.", "{pct}% minimum, please.", "A deposit of {pct}% or more would make them comfortable."], reserved: ["A real deposit. {typical}% or so is normal here.", "Something in line with the market, around {typical}%."], guarded: ["Make it a deposit that shows they're serious.", "The stronger the deposit, the stronger the offer."] }[level], { pct: s.seller.minDepositPct, typical: s.market.typicalDepositPct });
    case "conditions":
      if (!seller) {
        const needs = ["financing", "inspection"].filter((x) => !s.buyer.willingToWaive.includes(x as "financing" | "inspection"));
        return line(c, `conditions:buyer-${level}`, { open: [needs.length ? `They'll need ${needs.join(" and ")} conditions.` : "They could go firm if everything lines up.", needs.length ? `${cap(needs.join(" and "))} conditions are a must for them.` : "Conditions aren't a must for them."], reserved: ["The usual conditions.", "Standard conditions, nothing unusual."], guarded: ["Standard stuff. You'll see it in the offer.", "Whatever protects them."] }[level]);
      }
      return line(c, `conditions:${level}`, { open: ["Keep conditions to {days} banking days or less.", "{days} banking days is the most they'll give on a condition.", "Short conditions, {days} banking days at most."], reserved: ["Short conditions, please.", "The fewer and shorter, the better."], guarded: ["The cleaner, the better.", "A firm offer always gets the most attention."] }[level], { days: s.seller.maxConditionDays });
    case "financing":
      if (seller) return line(c, "financing:seller", ["That's on your buyers' side. We'll want to see a pre-approval.", "Your buyers' financing is their business; a strong pre-approval helps."]);
      return line(c, `financing:${level}`, { open: [s.buyer.financing === "cash" ? "They're paying cash." : "They're pre-approved, {down}% down. Financing's solid.", s.buyer.financing === "cash" ? "It's a cash purchase." : "Pre-approved, {down}% down."], reserved: ["Financing's in place.", "They're pre-approved."], guarded: ["They're qualified. The financing condition covers the rest.", "Don't worry about their financing."] }[level], { down: s.buyer.downPaymentPct });
    case "inclusions":
      return line(c, "inclusions", seller
        ? ["The appliances stay. Anything else, put it in the offer.", "Standard inclusions. If your buyers want something specific, write it in.", "Everything listed stays. Rentals are as disclosed."]
        : ["My buyers will want the appliances included.", "They'd like everything that's listed to stay.", "The usual inclusions, please."]);
  }
}

/** Answers to what the user asked alongside an offer, leaving out price talk the counter itself covers. */
export function agentSideAnswers(c: AgentContext, text: string, ctx: { currentPrice: number; currentNet: number; reservationNet: number; competing: number | null }): string {
  const skip: AgentTopic[] = ["price", "pushback", "greeting", "thanks"];
  return agentTopicsIn(text)
    .filter((x) => !skip.includes(x))
    .slice(0, 2)
    .map((topic) => answerTopic(c, topic, ctx))
    .join(" ");
}

/** The agent's reply to a message: an answer to up to two things asked, then where things stand. */
export function agentReply(c: AgentContext, text: string, ctx: { currentPrice: number; currentNet: number; reservationNet: number; competing: number | null }): string {
  const topics = agentTopicsIn(text);
  const substantive = topics.filter((x) => x !== "greeting" && x !== "thanks");
  const answers = (substantive.length ? substantive : topics).slice(0, 2).map((topic) => answerTopic(c, topic, ctx));
  // Close with where things stand, unless an answer already said the price.
  const tail = !substantive.length || (substantive.includes("pushback") && !substantive.includes("price")) ? agentLines.holdTail(c, ctx.currentPrice) : "";
  return [...answers, tail].filter(Boolean).join(" ");
}
