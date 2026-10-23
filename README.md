# The Negotiator

Practice negotiating residential real estate deals against a 30-year veteran agent. See [DESIGN.md](DESIGN.md) for the full design.

## Status

**Build step 1 (scenario engine) is done.** Click **New scenario** to generate a deal in a random market with a random property type. You're randomly assigned as the buyer's agent or the listing agent, and you see the public listing, comps, disclosures, and your own client's confidential brief. Negotiation arrives in step 2.

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
| `npm test` | Runs the engine tests (2,000 seeds checked for consistency and information leaks) |
| `npm run typecheck` | Type-checks everything |
| `npm run generate -- --seed 123 [--offline]` | Prints one full scenario **including hidden layers**, for inspecting the generator |

## How a scenario is built

1. **Code sets every number** (`server/engine/`): market, property, comps, both clients' limits, hidden difficulty, and ground truth (inspection findings, appraisal, loan, title and walkthrough events, competing offers). Scenarios are reproducible from their seed.
2. **Claude writes the story** (`server/narrative/claude.ts`): listing copy, client backstories, and the opposing agent's persona. A check rejects any dollar amount the engine didn't produce, and Claude gets one chance to fix it.
3. **Only your view leaves the server** (`server/engine/views.ts`). The other side's brief, ground truth, and difficulty stay in the server's SQLite database (`data/`).
