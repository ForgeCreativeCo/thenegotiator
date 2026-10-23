import express from "express";
import { ScenarioStore } from "./db";
import { generateScenario, hasClaudeCredentials } from "./scenarioService";
import { userView } from "./engine/views";
import type { Scenario } from "./engine/types";
import { ActionError, applyUserAction, offerNightView, startNegotiation, type UserAction } from "./negotiation/engine";
import { negotiationView, newNegotiation, type Negotiation } from "./negotiation/types";
import { applyTxAction, contractSignedNote, transactionClientView, type TxAction } from "./transaction/engine";
import { createTransaction } from "./transaction/schedule";
import { askMentor } from "./coach/mentor";
import { buildDebrief, debriefAvailable } from "./coach/debrief";

/** The negotiation as the browser sees it, including the transaction once under contract. */
function viewFor(s: Scenario, n: Negotiation) {
  if (n.status === "under_contract" && !n.transaction) {
    const accepted = n.offers.find((o) => o.id === n.acceptedOfferId);
    if (accepted) n.transaction = createTransaction(s, accepted.terms, n.simHours);
  }
  if (n.transaction) contractSignedNote(s, n);
  return negotiationView(n, n.transaction ? transactionClientView(s, n.transaction) : null, offerNightView(s, n));
}

const app = express();
const store = new ScenarioStore();
app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json({ storyWriter: hasClaudeCredentials() ? "claude" : "offline" });
});

app.post("/api/scenarios", async (_req, res) => {
  try {
    const { scenario, warnings } = await generateScenario();
    store.save(scenario);
    for (const warning of warnings) console.warn(warning);
    res.status(201).json({ view: userView(scenario), warnings });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/scenarios", (_req, res) => {
  res.json(store.list());
});

app.get("/api/scenarios/:id", (req, res) => {
  const scenario = store.get(req.params.id);
  if (!scenario) {
    res.status(404).json({ error: "Scenario not found" });
    return;
  }
  // Only the user's view leaves the server. The full scenario (other side's brief, ground truth, difficulty) stays here.
  res.json({ view: userView(scenario) });
});

// ---------- Negotiation ----------

const busy = new Set<string>();

/** Loads the scenario and its negotiation, runs `work` with a per-scenario lock, saves, and responds with the user's view. */
async function withNegotiation(req: express.Request, res: express.Response, work: (s: Scenario, n: Negotiation) => Promise<void>) {
  const id = String(req.params.id);
  const scenario = store.get(id);
  if (!scenario) {
    res.status(404).json({ error: "Scenario not found" });
    return;
  }
  if (busy.has(id)) {
    res.status(409).json({ error: "The other agent is still responding." });
    return;
  }
  busy.add(id);
  const negotiation = store.getNegotiation(id) ?? newNegotiation(id);
  try {
    await work(scenario, negotiation);
    const view = viewFor(scenario, negotiation);
    store.saveNegotiation(negotiation);
    res.json({ negotiation: view });
  } catch (error) {
    if (error instanceof ActionError) {
      // Refused attempts are part of the record the debrief reviews.
      (negotiation.attempts ??= []).push({ at: negotiation.simHours, action: String((req.body as { type?: string })?.type ?? "unknown"), message: error.message, details: error.details });
      store.saveNegotiation(negotiation);
      res.status(422).json({ error: error.message, details: error.details });
    } else {
      console.error(error);
      res.status(500).json({ error: (error as Error).message });
    }
  } finally {
    busy.delete(id);
  }
}

app.get("/api/scenarios/:id/negotiation", (req, res) => {
  const scenario = store.get(req.params.id);
  const negotiation = store.getNegotiation(req.params.id);
  if (!scenario || !negotiation) {
    res.json({ negotiation: null });
    return;
  }
  const view = viewFor(scenario, negotiation);
  store.saveNegotiation(negotiation);
  res.json({ negotiation: view });
});

app.post("/api/scenarios/:id/negotiation/start", (req, res) => withNegotiation(req, res, (s, n) => startNegotiation(s, n)));

app.post("/api/scenarios/:id/negotiation/actions", (req, res) =>
  withNegotiation(req, res, async (s, n) => {
    await startNegotiation(s, n);
    await applyUserAction(s, n, req.body as UserAction);
  }),
);

app.post("/api/scenarios/:id/transaction/actions", (req, res) => withNegotiation(req, res, (s, n) => applyTxAction(s, n, req.body as TxAction)));

// ---------- Mentor and debrief ----------

app.get("/api/scenarios/:id/mentor", (req, res) => {
  res.json({ log: store.getNegotiation(req.params.id)?.mentorLog ?? [] });
});

app.post("/api/scenarios/:id/mentor", async (req, res) => {
  const id = String(req.params.id);
  const scenario = store.get(id);
  const negotiation = store.getNegotiation(id);
  const question = String((req.body as { question?: string })?.question ?? "").trim();
  if (!scenario || !negotiation) return void res.status(404).json({ error: "Start the negotiation first." });
  if (!question) return void res.status(422).json({ error: "Ask a question first." });
  if (busy.has(id)) return void res.status(409).json({ error: "Still working on the last request." });
  busy.add(id);
  try {
    const { answer, source } = await askMentor(scenario, negotiation, question);
    (negotiation.mentorLog ??= []).push({ at: negotiation.simHours, question, answer, source });
    store.saveNegotiation(negotiation);
    res.json({ log: negotiation.mentorLog });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: (error as Error).message });
  } finally {
    busy.delete(id);
  }
});

app.get("/api/scenarios/:id/debrief", async (req, res) => {
  const scenario = store.get(req.params.id);
  const negotiation = store.getNegotiation(req.params.id);
  if (!scenario || !negotiation) return void res.status(404).json({ error: "Scenario not found" });
  if (!debriefAvailable(negotiation)) return void res.status(409).json({ error: "The debrief opens when the deal is finished." });
  try {
    const debrief = await buildDebrief(scenario, negotiation);
    store.saveNegotiation(negotiation);
    res.json({ debrief });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: (error as Error).message });
  }
});

const port = Number(process.env.API_PORT) || 3001;
app.listen(port, () => {
  console.log(`The Negotiator API on http://localhost:${port} (story writer: ${hasClaudeCredentials() ? "Claude" : "offline"})`);
});
