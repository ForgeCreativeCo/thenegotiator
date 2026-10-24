// Local dev server: Express over the shared routes, with SQLite storage and inline work.

import express from "express";
import { SqliteStore } from "./db";
import { hasClaudeCredentials } from "./scenarioService";
import { ROUTES } from "./api/routes";
import { localRuntime } from "./api/local";

const app = express();
const runtime = localRuntime(new SqliteStore());
app.use(express.json());

for (const route of ROUTES) {
  const method = route.method === "GET" ? "get" : route.method === "POST" ? "post" : "delete";
  app[method](route.path, async (req, res) => {
    const reply = await route.handle(runtime, req.params as Record<string, string>, req.body);
    res.status(reply.status).json(reply.body);
  });
}

const port = Number(process.env.API_PORT) || 3001;
app.listen(port, () => {
  console.log(`The Negotiator API on http://localhost:${port} (story writer: ${hasClaudeCredentials() ? "Claude" : "offline"})`);
});
