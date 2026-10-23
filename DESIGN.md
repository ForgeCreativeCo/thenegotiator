# The Negotiator: Design Draft

A practice tool for negotiating residential real estate deals with an AI opposing agent: a 30-year veteran who closes 30 to 40 transactions a year. Each deal runs from first offer through closing (or until it falls apart).

## Decisions so far

| Topic | Decision |
|---|---|
| Scope | From offer through **closing**. Contingencies can turn up issues, be waived, or cause the deal to fall through. |
| Markets | Random: hot, balanced, cold; urban, suburban, rural; low to high price ranges. |
| Property types | All residential (see below). |
| Offer format | Free chat **plus** a structured offer/counter form that updates the term sheet. |
| Coaching | A mentor you can ask during the deal, **plus** a debrief at the end. |
| Difficulty | Random mix, **not shown** until the debrief. |
| Users | Single user, running locally. |

---

## 1. Four layers of information

| Layer | Who sees it | Purpose |
|---|---|---|
| **Public** | Both agents | Listing, MLS data, comps, disclosures, market stats |
| **Your client's brief** | You (and your mentor) | Motivations, limits, deadlines, quirks |
| **Bot's client's brief** | Bot only | The same for the other side |
| **Ground truth** | Nobody, until events reveal it | The house's real condition, the real appraised value, the buyer's real loan risk, title problems |

Ground truth is decided **when the scenario is generated**. That makes the inspection, appraisal and underwriting outcomes fixed facts that you discover, not dice rolled to punish you. Waiving the inspection doesn't make the bad roof go away; it just means you find out at closing, or after.

All four layers are revealed in the debrief.

## 2. Scenario generation

The work is split so the numbers always add up:

1. **Code sets the parameters.** Market temperature, property type, price, client motivations, reservation values (each side's walk-away numbers), difficulty settings and ground truth.
2. **The LLM writes the story.** It turns those parameters into a listing description, client backstories, the agent's voice, the inspection report, and so on.
3. **Code checks the story** against the parameters (for example, that the briefs make a deal possible, or deliberately make one barely possible).

### Property types and the extra terms each brings

| Type | Extra terms and contingencies |
|---|---|
| Single-family | Baseline |
| Condo | HOA document review, special assessments, reserve study, FHA approval of the building |
| Townhouse | HOA documents, shared walls and roof responsibility |
| Co-op | Board approval, financial disclosure, flip tax |
| Multifamily (2–4 units) | Rent rolls, leases, estoppels, tenant deposits, rental income for qualifying |
| Manufactured or mobile home | Real property vs. personal property titling, foundation certification, lot rent |
| New construction | Builder addenda, upgrades, completion date slip, builder incentives tied to the builder's lender |
| Rural or acreage | Well and septic inspections, survey, easements, USDA loan |
| Land or lot | Perc test, zoning, utilities access, survey |

### What a scenario contains (simplified)

```ts
Scenario {
  id, seed, createdAt
  market:     { region, temperature, avgDOM, listToSaleRatio, rates, customs }  // customs: attorney state? option period? escrow vs. table closing
  property:   { type, address, specs, yearBuilt, condition, listPrice, dom, priceHistory, disclosures, hoa?, units? }
  comps:      Comp[]
  userRole:   "buyer_agent" | "seller_agent"
  briefs: {
    seller:   ClientBrief   // only one of these is ever sent to the browser before the debrief
    buyer:    ClientBrief
  }
  groundTruth: {
    inspectionFindings: Finding[]      // severity, repair cost range, was it disclosed?
    appraisedValue: number
    financing: { riskEvents: LoanEvent[] }   // e.g. job change, debt-to-income creep, rate lock expiring
    titleIssues: TitleIssue[]
    walkthroughSurprises: Surprise[]
    competingOffers: OfferTiming[]     // whether, when, and how strong
  }
  difficulty: HiddenDifficulty         // see section 5
}

ClientBrief {
  names, backstory, motivation, urgency
  reservation: { price, latestClose, earliestClose, maxConcession, ... }   // walk-away numbers, enforced in code
  preferences: weights over price, timing, certainty, repairs, possession
  nonNegotiables, softSpots, personalityQuirks
  finances?: { preapproval, loanType, downPct, cashReserves, homeToSell? }  // buyer side
  payoff?:   { mortgageBalance, netNeeded }                               // seller side
}
```

## 3. Deal lifecycle (through closing)

There's a **simulated calendar**. Every contingency has a deadline. You move time forward ("Advance to the next deadline", or "Advance 1 day"), and events fire when their dates arrive.

```
LISTING ─► OFFER/COUNTER ─► UNDER CONTRACT
                                │  earnest money due
                                ▼
                     INSPECTION / DUE DILIGENCE ──► buyer terminates? ─► DEAD (earnest money returned)
                                │  repair request / credit / price cut negotiation
                                ▼
                     HOA / CONDO DOCS, RENT ROLLS, SURVEY (type-specific)
                                ▼
                     APPRAISAL ──► low? ─► gap negotiation (cut / cover / split / terminate)
                                ▼
                     FINANCING ──► underwriting conditions, rate lock, loan denial
                                ▼
                     HOME-SALE CONTINGENCY (if any) ──► kick-out clause if another offer comes in
                                ▼
                     TITLE ──► liens, probate, boundary issues
                                ▼
                     FINAL WALKTHROUGH ──► damage, missing items, repairs not done
                                ▼
                     CLOSING ──► close, or extend, or default
```

- **Waived contingencies have real consequences.** If the buyer waived the appraisal contingency and the appraisal comes in low, the buyer must cover the gap or default and risk the earnest money.
- **Amendments:** any change after contract goes through the same offer/counter process as a formal amendment.
- **Missed deadlines:** if a deadline passes without action, the contract's default terms apply (for example, the contingency is deemed waived).
- **Termination** rules follow which contingency was used and whether it was timely. Earnest money disputes are possible.

## 4. The opposing agent (the bot)

### Persona
Thirty years in the business, 30 to 40 closings a year. Calm, direct, a bit folksy, and protective of their client. They know every trick but stay ethical. They run their side like a professional:
- Anchor early and justify numbers with comps.
- Rarely move first and rarely split the difference evenly.
- "Let me run that by my sellers." Some responses come back after a simulated delay.
- Trade terms: "We can do your price if you can close in 21 days."
- Try to find out what your client wants ("Is your buyer flexible on closing?") and **use anything your side leaks**.
- Make deadlines feel real, and in a hot market mention other interest when there is some. They bluff only if the hidden difficulty allows it, and never invent a written offer.

### Guardrails enforced in code
Every bot turn returns structured output:
```ts
{ message: string, action: "counter" | "accept" | "reject" | "walk" | "request_info" | "hold", terms?: Terms, internalNote: string }
```
The server scores `terms` against the bot's client utility function:
- The bot **cannot accept or propose** a deal below its client's reservation value. If it tries, the turn is regenerated.
- Its concessions are capped per round by its difficulty profile, so it can't be talked off a cliff.
- `internalNote` (its private reasoning) is kept and shown in the debrief: "Here's what I was thinking."

### Your client pushes back too
If you agree to terms outside your own client's brief, **your client may refuse to sign**, or sign reluctantly, which costs you points. You're representing someone, not just trying to close.

## 5. Hidden difficulty

These are drawn at random for each scenario and revealed only in the debrief:

| Setting | Easy end | Hard end |
|---|---|---|
| Leverage | The bot's client is desperate | Your client is desperate, the bot's isn't |
| Agent temperament | Collaborative, reveals information | Cagey, anchors hard, uses deadlines strategically |
| Concession pace | Moves in generous steps | Moves in tiny steps, or not at all, on some terms |
| Bluffing | Never | Implies other interest that may or may not exist |
| Client volatility | Steady | The bot's client changes their mind and adds a demand late |
| Event volatility | A clean house and smooth loan | Several ground-truth problems, a low appraisal, underwriting trouble |
| Deal space | Wide gap between the two sides' limits | Very narrow, or **no deal possible at all** (recognizing that and walking away is the right answer) |

## 6. Mentor and debrief

**Mentor (at any time):** a separate persona that sees only what you see: the public layer, your brief and the transcript. It cannot leak the other side's brief. Ask it things like "What's my next move?", "Is this counter reasonable?" or "Should we waive appraisal?"

**Debrief (when the deal closes or dies):**
- All four layers revealed, plus the bot's internal notes for each turn
- **Outcome score:** your client's result compared with the range of deals that were possible
- **Process score:** information you protected or leaked, deadlines met, how you used contingencies, professionalism
- **Veteran's critique:** three things you did well, three things to fix, and a key moment where you could have gained more
- A history of past deals so you can track progress

## 7. Interface (desktop layout)

```
┌──────────────────────┬─────────────────────────────┬─────────────────────────┐
│ DEAL FILE            │ NEGOTIATION                 │ TERM SHEET              │
│ • Listing & photos*  │ chat with the opposing agent│ current terms (diff hl) │
│ • Comps              │                             │ ─────────────────────── │
│ • Disclosures        │ [Make offer / counter] form │ CALENDAR                │
│ • YOUR CLIENT BRIEF  │ [Ask mentor]                │ deadlines, today marker │
│ • Reports (insp, …)  │                             │ [Advance to next date]  │
└──────────────────────┴─────────────────────────────┴─────────────────────────┘
```
\*Photos: probably text descriptions in v1. Generated images are possible later.

## 8. Tech stack

- **Frontend:** Vite + React + TypeScript
- **Backend:** Node + TypeScript (Express or Fastify). It holds all hidden layers and calls the Claude API. The browser only ever receives what your role is allowed to see.
- **Storage:** SQLite (via `better-sqlite3`) for scenarios, transcripts and debriefs
- **LLM:** the Claude API, with an Anthropic API key in a local `.env`. A stronger model writes scenarios and debriefs; the bot's turns may use a faster model to keep the conversation quick (to be decided).
- **Engine:** the state machine, calendar, utility scoring and event firing live in plain TypeScript, so they can be tested without the LLM.

## 9. Build order

1. Scenario engine: parameters and ground truth, LLM story writing, and the endpoint for "your view"
2. Offer/counter negotiation: chat, form, term sheet, bot guardrails and acceptance
3. Under contract: calendar, deadlines, inspection phase
4. Appraisal, financing, title, walkthrough, closing, and how each one can fail
5. Type-specific branches: condo and HOA, multifamily, new construction, land and rural
6. Mentor and debrief, with scoring
7. Deal history and polish
