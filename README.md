# The Negotiator

Practice negotiating residential real estate deals against a 30-year veteran agent. See [DESIGN.md](DESIGN.md) for the full design.

## Status

**All seven build steps are done**, following Ontario practice under TRESA and the RECO Code of Ethics.

- **Scenarios**: a random Ontario region (GTA weighted heaviest) and market, any residential type (detached, semi, freehold or condo town, condo apartment, duplex/triplex with tenants, cottage, rural acreage, vacant land, new construction, land-lease home, co-op). You're randomly the buyer's agent or the listing agent, with your client's confidential brief.
- **Negotiation**: offers and sign-backs structured like the OREA Agreement of Purchase and Sale: price, deposit (herewith or upon acceptance), irrevocable time, completion date, Schedule A conditions in banking days, chattels and fixtures, rental items, pre-closing visits. Your own client refuses to sign anything outside their brief. The opposing agent never misrepresents and tells the truth about competing offers.
- **Acceptance to completion**: conditions must be waived (Form 123) or fulfilled (Form 124) by their deadlines, or the agreement is null and void and the deposit comes back. Repair negotiations happen by Amendment before waiving. Then firm, title requisitions, pre-closing visits, and completion with land transfer tax (Ontario and Toronto, with first-time buyer refunds) and a statement of adjustments. A buyer who can't complete forfeits the deposit and faces a damages claim.
- **Offer nights**: in hot GTA-style markets with real competing buyers, the listing holds offers until a review night. Buyers register (and learn the true number of competing offers), may try a pre-emptive bully offer if the listing considers them, and the seller can accept, sign back, or send everyone back to improve once. Offer contents are only disclosed on the seller's written direction (TRESA). You can win, lose to another buyer, or, as the listing agent, sell to a competing buyer.
- **Your client**: a second conversation with your own client. They review and sign every offer, sign-back and acceptance before it goes out, and refuse with their reasons. You present the other side's offers to them, and on offer night the sellers give you their written direction on disclosure. Each client has 2–4 things they didn't mention at intake (more room on price under a condition, a requirement they won't sign without, or background) that come out when you ask about the topic. The debrief shows what you found and what you missed, and compliance checks your duty to your client. Phase B (waivers, amendments and cold feet after acceptance) is still to come.
- **Mentor**: ask a 30-year broker for advice at any point. It sees only what you see (never the other side), and coaches on Ontario practice and the RECO Code of Ethics. Without an API key it gives rule-based coaching from the deal state.
- **Debrief**: when a deal ends, both clients' briefs, the hidden facts (findings, appraisal, mortgage and title problems, competing buyers), the difficulty settings, and the opposing agent's reasoning for every move are revealed. You get scores for outcome (where you landed in the deal space), process, and **RECO compliance**: confidential information disclosed, phantom offers or misstated offer counts, offer contents shared without the seller's direction, legal advice, and attempts to go outside your client's instructions, each with the quote that triggered it. A veteran's critique closes it out (written by Claude with an API key).
- **Progress**: a page with your finished deals, average and recent scores, a score trend, compliance flags by rule, and every deal in a table (filter by role, open any deal, delete one, or clear all practice deals).

## Setup

Requires Node 22.13 or newer (it uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY
npm run dev            # API on :3001, app on http://localhost:5173
```

Without an API key, scenarios still work, but their stories come from a plainer built-in template writer instead of Claude.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Runs the API server and the web app with hot reload |
| `npm test` | Runs the tests: scenario consistency and information leaks across 2,000 seeds, plus simulated negotiations and full contract-to-closing runs checking the agent never breaks its client's limits |
| `npm run typecheck` | Type-checks everything |
| `npm run generate -- --seed 123 [--offline]` | Prints one full scenario **including hidden layers**, for inspecting the generator |
| `npx tsx server/scripts/simStats.ts` | Plays simulated users against the offline agent and prints close rates and outcomes, for tuning difficulty |

## How a scenario is built

1. **Code sets every number** (`server/engine/`): market, property, comps, both clients' limits, hidden difficulty, and ground truth (inspection findings, appraisal, loan, title and walkthrough events, competing offers). Scenarios are reproducible from their seed.
2. **Claude writes the story** (`server/narrative/claude.ts`): listing copy, client backstories, and the opposing agent's persona. A check rejects any dollar amount the engine didn't produce, and Claude gets one chance to fix it.
3. **The opposing agent plays within code-enforced limits** (`server/negotiation/`). Each turn, the strategy computes the move it recommends, the most it may concede, and whether accepting or walking is allowed. Claude writes the message and may choose differently, but any counter below its client's floor, any backward move, or any oversized concession is rejected and redone. Without an API key, a template agent plays the recommended move.
4. **After the contract, code decides the opposing agent's moves** (`server/transaction/`) from its client's limits, and Claude only rewrites the message in the agent's voice. Sellers will give more than their original floor for real defects or a low appraisal, but only so much.
5. **Ontario rules** live in `server/negotiation/constraints.ts` (who will sign what), `server/transaction/` (conditions, requisitions, completion) and `server/transaction/landTransferTax.ts`.
6. **Only your view leaves the server** (`server/engine/views.ts`). The other side's brief, ground truth, and difficulty stay in server storage: SQLite (`data/`) locally, Netlify Blobs when hosted.

## Hosting on Netlify

The same API runs in two places (`server/api/routes.ts`):

| | Local (`npm run dev`) | Netlify |
|---|---|---|
| Server | Express (`server/index.ts`) | Functions: `netlify/functions/api.mts` for every `/api` request, `work.mts` as a background function |
| Storage | SQLite in `data/` | Netlify Blobs: one record per deal, plus jobs and locks (`server/api/netlify.ts`) |
| Changes to a deal | Run inline | Queued as a job. The page starts the background function (up to 15 minutes, so long Claude calls fit) and polls `/api/jobs/:id` |

Production uses the Blobs store `negotiator`, and previews and branch deploys use `negotiator-preview`, so a preview never touches real deals.

### Setup

1. In Netlify, add a new project and import this GitHub repo (branch `main`). `netlify.toml` sets the build.
2. Under Project configuration → Environment variables, add `ANTHROPIC_API_KEY` with its scope including **Functions**. Optionally add `SCENARIO_MODEL` and `BOT_MODEL`.
3. Under Project configuration → General → Visitor access → Project visibility, make sure it's **Private**. Otherwise anyone with the URL can spend your Claude credits.

Every push to `main` then redeploys.
