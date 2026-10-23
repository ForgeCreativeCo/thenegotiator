import express from "express";
import { ScenarioStore } from "./db";
import { generateScenario, hasClaudeCredentials } from "./scenarioService";
import { userView } from "./engine/views";

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

const port = Number(process.env.API_PORT) || 3001;
app.listen(port, () => {
  console.log(`The Negotiator API on http://localhost:${port} (story writer: ${hasClaudeCredentials() ? "Claude" : "offline"})`);
});
