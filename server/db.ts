import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import type { Scenario } from "./engine/types";
import type { Negotiation } from "./negotiation/types";
import type { Deal, Store } from "./api/routes";
import { summarize, type ScenarioSummary } from "./api/summary";

export type { ScenarioSummary };

/** Local dev storage: a SQLite file under data/. */
export class SqliteStore implements Store {
  private db: DatabaseSync;

  constructor(path = "data/negotiator.db") {
    if (path !== ":memory:") mkdirSync("data", { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scenarios (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS negotiations (
        scenario_id TEXT PRIMARY KEY REFERENCES scenarios(id),
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
  }

  async saveScenario(scenario: Scenario): Promise<void> {
    this.db.prepare("INSERT INTO scenarios (id, created_at, data) VALUES (?, ?, ?)").run(scenario.id, scenario.createdAt, JSON.stringify(scenario));
  }

  async get(id: string): Promise<Deal | null> {
    const row = this.db.prepare("SELECT s.data AS s, n.data AS n FROM scenarios s LEFT JOIN negotiations n ON n.scenario_id = s.id WHERE s.id = ?").get(id) as { s: string; n: string | null } | undefined;
    return row ? toDeal(row) : null;
  }

  async saveNegotiation(_s: Scenario, n: Negotiation): Promise<void> {
    this.db
      .prepare("INSERT INTO negotiations (scenario_id, updated_at, data) VALUES (?, ?, ?) ON CONFLICT(scenario_id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data")
      .run(n.scenarioId, new Date().toISOString(), JSON.stringify(n));
  }

  async list(limit = 50): Promise<ScenarioSummary[]> {
    const rows = this.db.prepare("SELECT s.data AS s, n.data AS n FROM scenarios s LEFT JOIN negotiations n ON n.scenario_id = s.id ORDER BY s.created_at DESC LIMIT ?").all(limit) as { s: string; n: string | null }[];
    return rows.map((r) => {
      const { scenario, negotiation } = toDeal(r);
      return summarize(scenario, negotiation);
    });
  }

  async all(): Promise<Deal[]> {
    const rows = this.db.prepare("SELECT s.data AS s, n.data AS n FROM scenarios s LEFT JOIN negotiations n ON n.scenario_id = s.id ORDER BY s.created_at ASC").all() as { s: string; n: string | null }[];
    return rows.map(toDeal);
  }

  async delete(id: string): Promise<boolean> {
    this.db.prepare("DELETE FROM negotiations WHERE scenario_id = ?").run(id);
    return this.db.prepare("DELETE FROM scenarios WHERE id = ?").run(id).changes > 0;
  }

  async deleteAll(): Promise<number> {
    this.db.exec("DELETE FROM negotiations");
    return Number(this.db.prepare("DELETE FROM scenarios").run().changes);
  }
}

function toDeal(row: { s: string; n: string | null }): Deal {
  return { scenario: JSON.parse(row.s) as Scenario, negotiation: row.n ? (JSON.parse(row.n) as Negotiation) : null };
}
