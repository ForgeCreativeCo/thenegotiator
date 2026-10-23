# The Negotiator

Practice negotiating residential real estate deals against a 30-year veteran agent. See [DESIGN.md](DESIGN.md) for the full design.

## Status

**Build steps 1 and 2 are done.** Click **New scenario** to generate a deal in a random market with a random property type. You're randomly assigned as the buyer's agent or the listing agent, and you see the public listing, comps, disclosures, and your own client's confidential brief.

Then negotiate: chat with the opposing agent, send offers and counters with the full set of terms, and accept or walk away. The term sheet compares both sides' latest positions and highlights open issues. Your own client refuses to sign anything outside their brief. When both sides accept, you're under contract; due diligence through closing arrives in step 3.

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
| `npm test` | Runs the tests: scenario consistency and information leaks across 2,000 seeds, plus simulated negotiations checking the agent never breaks its client's limits |
| `npm run typecheck` | Type-checks everything |
| `npm run generate -- --seed 123 [--offline]` | Prints one full scenario **including hidden layers**, for inspecting the generator |
| `npx tsx server/scripts/simStats.ts` | Plays simulated users against the offline agent and prints close rates and outcomes, for tuning difficulty |

## How a scenario is built

1. **Code sets every number** (`server/engine/`): market, property, comps, both clients' limits, hidden difficulty, and ground truth (inspection findings, appraisal, loan, title and walkthrough events, competing offers). Scenarios are reproducible from their seed.
2. **Claude writes the story** (`server/narrative/claude.ts`): listing copy, client backstories, and the opposing agent's persona. A check rejects any dollar amount the engine didn't produce, and Claude gets one chance to fix it.
3. **The opposing agent plays within code-enforced limits** (`server/negotiation/`). Each turn, the strategy computes the move it recommends, the most it may concede, and whether accepting or walking is allowed. Claude writes the message and may choose differently, but any counter below its client's floor, any backward move, or any oversized concession is rejected and redone. Without an API key, a template agent plays the recommended move.
4. **Only your view leaves the server** (`server/engine/views.ts`). The other side's brief, ground truth, and difficulty stay in the server's SQLite database (`data/`).
