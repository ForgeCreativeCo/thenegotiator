# The Negotiator: Design

A practice tool for negotiating **Ontario** residential real estate deals with an AI opposing agent: a RECO-registered broker with 30 years of experience who closes 30 to 40 transactions a year. Each deal runs from first offer through completion (or until it falls apart).

> **Jurisdiction.** Everything follows Ontario practice under the *Trust in Real Estate Services Act, 2002* (TRESA) and the RECO Code of Ethics, using the structure of the standard OREA forms. Clause wording in the app is written in plain language, not copied from OREA forms (they're copyrighted). This is a training simulation, not legal advice; rules are simplified where noted.

## Decisions so far

| Topic | Decision |
|---|---|
| Jurisdiction | **Ontario only.** All US concepts (escrow, title companies, appraisal contingencies, state customs) are removed. |
| Scope | From offer through **completion**. Conditions can turn up issues, be waived, be fulfilled, or make the deal null and void. |
| Markets | Mixed Ontario regions (GTA weighted heaviest), random market temperature, prices in CAD. |
| Property types | All Ontario residential types (see below). |
| Offer format | Free chat **plus** a structured offer and sign-back form modelled on the OREA Agreement of Purchase and Sale. |
| Offer nights | **Included**: held offers, registered offers, bully offers, sign-backs, and improvement rounds. |
| Coaching | A mentor during the deal, **plus** a debrief at the end that also grades **RECO compliance**. |
| Difficulty | Random mix, **not shown** until the debrief. |
| Users | A small group sharing one site behind a password. Each person enters their name and sees only their own deals and progress (honour system, no accounts). Offline only: no API key. |
| Your own client | A **conversation with your client**: they review and sign every document before it goes out, you present the other side's offers to them, and they know things you have to ask about. Their decisions are made in code; Claude writes their words. |

---

## 1. Four layers of information

| Layer | Who sees it | Purpose |
|---|---|---|
| **Public** | Both agents | MLS listing, comps, Seller Property Information Statement (if the seller provided one), market stats, offer-night instructions |
| **Your client's brief** | You (and your mentor) | Motivations, limits, dates, quirks |
| **Bot's client's brief** | Bot only | The same for the other side |
| **Ground truth** | Nobody, until events reveal it | The property's real condition, the lender's appraisal, the buyer's real mortgage risk, title problems, real competing offers |

Ground truth is fixed when the scenario is generated. A firm offer doesn't make the knob-and-tube wiring go away; it means your buyer owns it.

The scenario assumes the paperwork before the first offer is done: your client has the **RECO Information Guide**, and you have a signed **Buyer Representation Agreement** or **Listing Agreement**. You and the opposing agent are at different brokerages, so there's no multiple representation.

## 2. Ontario markets

Regions with benchmark prices (CAD, illustrative for 2026) and local character. A region's weight sets how often it comes up.

| Region | Weight | Benchmark detached | Notes |
|---|---|---|---|
| Toronto | High | ~$1.4M | Municipal land transfer tax on top of the provincial tax; offer nights are common; condo-heavy |
| Mississauga, Brampton, Oakville, Vaughan, Markham, Richmond Hill | High | $1.0M–1.5M | 905 suburbs; semis and freehold towns are common |
| Durham (Oshawa, Whitby, Ajax, Pickering) | Medium | ~$850k | Commuter market; lots of new construction |
| Hamilton, Burlington | Medium | $800k–1.1M | Older housing stock (knob-and-tube, lead water service pipes) |
| Kitchener-Waterloo, Cambridge, Guelph | Medium | $750k–850k | Student rentals and duplexes |
| Ottawa | Medium | ~$700k | Its own market rhythm; government buyers |
| London, Windsor, Niagara (St. Catharines, Welland) | Medium | $550k–650k | More balanced markets |
| Barrie, Orillia, Collingwood | Low | $800k–900k | Commuter and recreational mix |
| Kingston, Peterborough, Belleville, Prince Edward County | Low | $600k–750k | Rural edges and waterfront |
| Muskoka, Haliburton, the Kawarthas (cottage country) | Low | ~$1.0M | Waterfront, septic, wells, seasonal roads, shore road allowances |
| Sudbury, Thunder Bay, Sault Ste. Marie, North Bay | Low | $300k–450k | Cold markets, large lots, rural services |

Market temperature (hot, balanced, cold) is drawn at random, as now, and sets days on market, sale-to-list ratio, inventory, and how often offers are held for an offer night.

## 3. Property types

| Type | Ontario-specific terms and risks |
|---|---|
| Detached | Baseline. Older homes: knob-and-tube or aluminum wiring (insurance), galvanized pipes, lead water service, UFFI, underground oil tank, vermiculite |
| **Semi-detached** | Shared wall; party-wall maintenance; some older semis share a drain or a mutual driveway (right-of-way) |
| Freehold townhouse | Sometimes a common elements condominium (POTL) with monthly fees |
| Condo townhouse | **Status certificate**, maintenance fees, exclusive-use areas |
| Condo apartment | **Status certificate** (special assessments, reserve fund, lawsuits, rules on pets and short-term rentals), parking and locker (owned or exclusive use), **Kitec plumbing** in 1995–2007 buildings |
| Duplex or triplex | Leases and tenants under the *Residential Tenancies Act*: the buyer must take on the tenancies, and only a purchaser who will live there can give notice to end one (Form N12). Legal versus non-conforming units; fire code retrofit |
| Cottage or waterfront | Well (water potability and flow), septic, seasonal or private road, shore road allowance, conservation authority permits, wood stove (WETT inspection) |
| Rural acreage or farm | Well, septic, severance rules, zoning, outbuildings |
| Vacant land | Zoning, severance, septic permit feasibility, utilities, conservation authority |
| New construction (freehold) | Builder's agreement, **Tarion** warranty, firm and tentative closing dates with **delayed-closing compensation**, HST included in price with the new-housing rebate assigned to the builder |
| Mobile home in a land-lease community | Monthly land lease fee, park approval of the buyer, financing is harder |
| Co-op apartment (rare, Toronto only) | Board approval, share purchase rather than land, limited financing |

## 4. The offer: Agreement of Purchase and Sale

Offers and sign-backs use the structure of OREA **Form 100** (Form 101 for condos), with Schedule A for conditions and extra clauses:

- **Price** and **deposit**: the deposit is paid "upon acceptance" (within 24 hours) or "herewith". It's held in the **listing brokerage's trust account**. Typical: 5% in the GTA; 2–5% or a fixed amount elsewhere.
- **Irrevocable** date and time: the offer is open until then. A sign-back carries its own irrevocable time.
- **Completion date**, usually 30–90 days out. Possession is on completion.
- **Requisition date** for title searches.
- **Chattels included**, **fixtures excluded**, and **rental items** (hot water tank, furnace or water softener rentals the buyer assumes).
- **HST**: "included in the price, if applicable" (relevant for new construction).
- **Conditions** in Schedule A, each with a deadline (typically 5 banking days):
  - Financing (covers the lender's appraisal)
  - Home inspection
  - Status certificate review (condos)
  - Lawyer's review
  - Insurance
  - Sale of the buyer's property, with a **72-hour escape clause**
  - Water and septic inspections (rural)
- **Pre-closing visits**: typically 2 or 3 visits before completion.
- **Seller's repairs** before completion, if negotiated.

**How a sign-back works:** the other side changes terms on your offer and initials, or writes a new offer, and returns it with a new irrevocable time. When the irrevocable time passes without acceptance, the offer is dead.

**Seller credits and home warranties** (US practice) are removed. In Ontario the money usually moves through the price, either up front or in an Amendment. A "credit on closing" is possible but lenders must approve it.

## 5. Offer nights (multiple offers)

Common in hot markets and in Toronto especially. Ground truth decides whether competing offers are real, how many there are, and how strong.

- **The listing says offers are held**, for example "Offers reviewed Tuesday at 7 PM; no pre-emptive offers" or "pre-emptive offers welcome".
- **Registered offers.** A buyer's agent registers an offer. Under the Code of Ethics, the listing brokerage must tell every party with a competing written offer **how many competing offers there are**, and that number is always true.
- **Bully offers.** A buyer submits early with a short irrevocable time and pressures the seller to decide before offer night.
- **Offer transparency (TRESA).** The seller may direct the listing brokerage to disclose the contents of competing offers. Without that direction, the details stay confidential.
- **The seller's options on offer night:** accept one offer, sign back one, or **send all of them back to improve**. Then there's a second round with a new deadline.
- **When you represent the buyer**, you compete against hidden real offers. You learn only the count, whatever the seller chooses to disclose, and whether you won.
- **When you represent the seller**, you run offer night: you receive the bot buyer's offer and the competing offers, choose disclosure (with your seller's direction), and decide.

The brokerage must keep copies of all written offers, which is the safeguard against phantom offers. The opposing agent **never invents an offer**.

## 6. After acceptance: conditional, firm, completion

There's a simulated calendar, and condition deadlines count **banking days** (weekends skipped). You move time forward.

```
ACCEPTED (conditional) ─► deposit due within 24 hours
        │
        ├─ Financing: lender's appraisal; mortgage approval or decline
        ├─ Home inspection: report from ground truth; renegotiation by Amendment
        ├─ Status certificate: special assessments, reserve fund, lawsuits
        ├─ Lawyer's review, insurance (e.g. knob-and-tube or an oil tank makes insurance hard)
        ├─ Sale of the buyer's property: 72-hour escape clause if the seller gets another offer
        │
        │  Each condition must be WAIVED or FULFILLED (Waiver Form 123 / Notice of Fulfilment Form 124)
        │  by its deadline, or the agreement is NULL AND VOID and the deposit is returned in full.
        ▼
FIRM ─► requisition date: buyer's lawyer searches title; seller must answer valid objections
        │   (if the seller can't fix a valid objection and the buyer won't waive it, the deal ends and the deposit is returned)
        ├─ pre-closing visits (damage, missing chattels, rental items)
        ├─ Amendments (Form 120) for any change: price, completion date, repairs
        ▼
COMPLETION ─► lawyers exchange funds and documents electronically; buyer pays land transfer tax;
              statement of adjustments (property tax, condo fees, rental items); keys released
```

The big change from the US version: **if the buyer does nothing by a condition's deadline, the deal ends and the deposit comes back.** Doing nothing protects the buyer, so the pressure falls on the **seller** to get waivers on time, and on the buyer to waive only when they're truly ready.

**Renegotiating after inspection:** the buyer can't waive the inspection condition and come back for more later, so any repair negotiation happens *before* the waiver, by Amendment: a price reduction, seller repairs before completion, or occasionally a credit on closing that the lender approves.

**Low appraisal:** this sits inside the financing condition. If the buyer is still conditional, they can renegotiate or let the deal die. If they're firm, they must make up the difference.

**Defaults:** a buyer who can't complete **forfeits the deposit, and the seller can sue for damages** if the property resells for less. The debrief shows the buyer's exposure. A seller who can't complete returns the deposit and may face a damages claim too.

**New construction:** Tarion delayed-closing rules apply. The builder can set a new tentative or firm date with proper notice and pays compensation for delays. New condos bought from a builder have a **10-day cooling-off period**, but this simulation uses freehold builder inventory, so it doesn't come up.

## 7. Costs and the settlement summary

- **Land transfer tax (buyer).** Ontario brackets: 0.5% up to $55k, 1% to $250k, 1.5% to $400k, 2% to $2M, 2.5% above $2M (for homes with one or two single-family residences). First-time buyers get a refund of up to $4,000. **Toronto's municipal tax** follows the same brackets with higher luxury brackets above $3M; first-time buyers get a refund of up to $4,475.
- **Mortgage.** CMHC insurance is required with less than 20% down, and is available only on homes under $1.5M. Buyers qualify under the stress test, and first-time buyers and new builds can get a 30-year amortization.
- **Statement of adjustments:** property taxes, condo fees and prepaid utilities, prorated to completion.
- **Seller's side:** mortgage discharge and penalty. Commissions aren't shown; they're outside the negotiation.

## 8. The opposing agent (the bot)

A RECO-registered broker with 30 years of experience and 30 to 40 deals a year, at a fictional brokerage. The persona, guardrails and hard limits work the same as before, plus these **Code of Ethics constraints**:

- **Never misrepresents**: no phantom offers, no false statements about the property or other offers. "Hardball" means firm and terse, never dishonest. The old "bluffing" setting becomes how much the agent **withholds**, which is allowed: it can stay vague about its client's flexibility.
- **Never discloses its client's confidential information** (motivation, bottom line) without direction.
- **Tells you the true number of competing offers** on offer night.
- **Discloses material facts it knows about the property.** If its seller knows about a latent defect that makes the property dangerous, the agent won't hide it, but it won't volunteer every repair either.

## 9. Mentor, debrief and RECO compliance

**Mentor:** the same as before, with Ontario-specific coaching. For example: "Don't waive financing until you have the commitment in writing, including the appraisal."

**Debrief:** reveals all four layers and the bot's reasoning, then scores you on:
- **Outcome**: your client's result compared with the range of possible deals
- **Process**: deadlines, conditions, how you handled offer night
- **RECO compliance**, flagged from your messages and actions:
  - Disclosing your client's confidential information (bottom line, motivation, other offers) without direction
  - Misrepresenting facts: claiming offers that don't exist, or misstating the property or market
  - Failing to tell your seller about every offer, or the count rule on offer night
  - Pushing your client past their instructions; your client already refuses to sign, but trying it gets noted
  - Advising outside your expertise (for example, legal advice instead of "talk to your lawyer")

## 10. Interface

The same three columns. The term sheet becomes an **APS summary**: deposit, irrevocable time, completion date, conditions with deadlines, chattels and fixtures, rental items. The calendar shows condition deadlines in banking days, the requisition date, pre-closing visits, and completion.

## 11. Build order

1. ~~Scenario engine~~ (built; US version)
2. ~~Offer and counter negotiation~~ (built; US version)
3. ~~Contract to closing~~ (built; US version)
4. ~~Ontario conversion~~ (built)
5. ~~Offer nights~~ (built)
6. ~~Mentor and debrief, with RECO compliance scoring~~ (built)
7. ~~Deal history and polish~~ (built)

## 12. Hosting

Netlify, private to the project owner (Project visibility: Private). The API is one set of handlers (`server/api/routes.ts`) behind two adapters: Express with SQLite for local dev, Netlify Functions with Blobs when hosted.

- **Reads** answer straight away in the `api` function.
- **Changes** may call Claude, which can outlast a 60-second function, so each one is a job: claim the deal's lock, queue the job, and return its id. The page starts the `work` background function (up to 15 minutes) and polls the job. A job moves queued → running with a conditional write, so Netlify's retry of a crashed run can't play a turn twice.
- **Dead runs**: a job still queued after 2 minutes or running after 16 is ended with an error, and its lock frees. A lock older than 16 minutes can be taken over.
- **Storage**: one Blobs record per deal (scenario plus negotiation), with a summary in its metadata for the past-deals list. Production and previews use separate stores.

## 13. Your client

You talk to your own client as well as the opposing agent. As with the opposing agent, **code decides what the client does** (sign or refuse, what they reveal, whether their instructions change) and Claude only writes their words, in the voice from their story. Offline, templates write the words.

### Decisions

| Topic | Decision |
|---|---|
| Review | **Required** for anything with legal effect: offers, sign-backs, acceptances, offer-night registrations and pre-emptive offers, accepting or signing back a competing offer. Phase B adds waivers, amendments and mutual releases. |
| What the client knows | The brief is what they told you at intake. Each client also has **2–4 untold facts** that come out only when you ask about the topic, or when one blocks a signature. The debrief shows what you found and what you missed. |
| Changing instructions | Only when new facts give them a reason, such as uncovering an untold fact or learning there are competing offers. Pushing them past their interest is flagged. |
| Surprises | Your own client can have events too, tied to the hidden difficulty (phase B: cold feet before waiving, a spouse who disagrees, buyer's remorse). |
| Phases | **A**: the negotiation and offer nights. **B**: acceptance to completion. |

### Untold facts

Generated with the scenario (code decides every number), for the user's client only:

- **More room**: a buyer could go higher, or a seller lower, under a condition. For example, "We'd find another $12,000 if we could close by Dec 15", or a buyer who'd stretch in a bidding war (only once they know there are competing offers). The room only applies once you've uncovered it, and never past a buyer's pre-approval.
- **A hidden requirement**: something they won't sign without, such as a chattel included, a fixture excluded, a longer inspection period, a larger deposit, or the deposit timing. It surfaces in their own words if a draft breaks it, or when you present an offer that doesn't meet it.
- **Context**: a worry or background fact (for example, nervous about older houses after a bad experience). Phase B uses these.

What you ask is matched to topics (price, timing, deposit, conditions, inspection, chattels, fixtures, financing, competition, motivation). A question on a topic brings out one untold fact on it. Open questions ("anything else I should know?") bring out background, not money.

### Actions

- **Review with client**: every signing action goes through the client first. They sign, sign reluctantly (close to their limit), or refuse with their reasons. The engine refuses an unsigned document.
- **Present an offer**: show them the other side's offer or sign-back. They react to it against their real limits, and raise any untold requirement it misses. On the listing side, presenting the registered offers on offer night covers all of them.
- **Written direction** (listing side, offer night): you ask the sellers how much to disclose to competing buyers. Until you have their direction, you can only share the number of offers.
- **Chat**: ask them anything. Client chat takes no simulated time.

### Scoring

- **Compliance** (new rule, *duty to your client*): responding to an offer you never presented, pressuring your client past their limits, and legal advice to your own client. The existing confidentiality checks apply only to what you tell the other side.
- **Process**: part of the score is how many untold facts you uncovered by asking, versus learning them from a refusal or never.

### Phase B: after acceptance

- **Signatures**: waivers (Form 123), notices of fulfilment (Form 124), mutual releases, and every amendment (repair or price proposals, accepting the other side's proposal, condition extensions, completion date changes) go past the client first, the same way as offers. Declining or dropping a request is an instruction, not a signature.
- **What the client decides** (in code):
  - Waiving financing before the mortgage commitment: they sign, reluctantly.
  - Waiving the inspection with serious findings unresolved: they sign reluctantly, or refuse if they're nervous about repairs (an untold background fact, which the refusal brings out).
  - A mutual release with no reason (no open issue, no serious findings, no mortgage or appraisal problem): they refuse. They still want the house, or the sale.
  - Amendments: their limits after acceptance, as before.
- **Presenting**: the other side's requests and counters on an issue are presented to the client before you answer them.
- **Surprises from your own client**, by the hidden client volatility (steady: none; nervous: one; erratic: two):
  - *Cold feet* (buyer): refuses the last waiver that would make the deal firm, until you talk it through with them.
  - *A partner who isn't on board*: refuses the first amendment until you talk it through.
  - *Second thoughts after firm*: messages you unprompted, asking whether they can get out. Encouraging them to walk away from a firm deal is flagged; it means a lost deposit and a damages claim.
  - *A later date* (seller): messages you unprompted after acceptance, asking for a later completion.
  - Any reply to the client settles a blocking surprise. The debrief notes surprises you never answered.

## 14. Offline dialogue

Without an API key, every word comes from dialogue pools in `server/dialogue/`. Code still decides every move and number.

- **No repeats**: each deal records the lines it has used, and a line isn't used again until its whole pool has been (`pick.ts`). The order is seeded, so a deal replays the same way.
- **The opposing agent** (`agent.ts`, `transaction.ts`) words its moves in its hidden temperament (collaborative, professional, cagey, hardball) and answers what you ask: motivation, timing, price, comps, condition, other offers, deposit, conditions, financing, inclusions, plus greetings, thanks and pushback.
  - What it shares follows its hidden *withholding* setting: open agents share their client's timing window and a hint of motivation and flexibility, reserved ones share less, guarded ones almost nothing.
  - It never states its client's limit or private finances, never shares a vulnerable motivation (separation, financial strain), only cites a comp when it supports its side, and is truthful about competing offers.
  - After acceptance it answers from the deal's state: conditions, open issues, the appraisal, the mortgage, the deposit and completion.
- **Your clients** (`client.ts`) speak in one of four personalities read from their story's quirks: anxious, analytical, emotional or blunt. They answer up to two topics per message, react to greetings, thanks, updates and "what do you think?", and word every review, presentation, direction and signature after acceptance in that personality.

## 15. Multiple offers

**One accepted agreement at a time, ever.** Unaccepted offers can stack up. Accepting one (even conditionally) releases every other buyer. Nothing lets two agreements exist at once.

### Listing side (you represent the sellers)

- **How offers are handled is the sellers' written decision**, on your recommendation: *any time*, or *hold offers until a review time* (an offer night). It can be made when the listing starts or later, including once a second offer arrives. Holding turns the listing into an offer night: every live offer is registered for the review, and the existing offer-night flow takes over.
- **Competing buyers are real.** Each arrives as a written offer with its own terms, irrevocable time and hidden ceiling (code decides them). You present it to your sellers, and with their signature accept it, sign it back, decline it, or let it expire.
- **Only one sign-back can be out at a time.** A competing buyer answers a sign-back a few hours later. Until then, no other sign-back or acceptance can go out; you can wait for the answer.
- **Two or more written offers** bring the RECO rules in: you tell every agent with an offer the true count (one action covers all of them), and contents are shared only on the sellers' written direction.
- **Accepting one offer releases the others**, and their agents are told the property is sold conditionally or firm. If the accepted deal collapses, you can invite released buyers back. Code decides who is still interested: stronger offers, released recently, come back with a fresh offer; others have moved on. A buyer who comes back is handled like any competing offer.
- **The escape clause stays**: it's notice under the existing agreement, and the other offer stays unaccepted.

### Buyer side (you represent a buyer)

- The listing agent truthfully tells you how many offers there are.
- When another buyer's offer arrives, the listing side may switch to holding offers until a review time (your current offer is registered for it), or accept the other buyer's offer if it's clearly better and signable. Then you've lost the property.

### Scoring

- Compliance: an arrived offer you never presented to your sellers; acting with two or more offers before telling the agents the count; offer contents shared without written direction.
- Process notes: how offers were handled, and whether you invited buyers back after a collapse.

Deals saved before this keep their old behaviour.
