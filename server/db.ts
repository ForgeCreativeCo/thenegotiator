import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import type { Scenario } from "./engine/types";
import type { Negotiation } from "./negotiation/types";
import type { Deal, Store } from "./api/routes";
import { summarize, type ScenarioSummary } from "./api/summary";

export type { ScenarioSummary };

function open(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync("data", { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
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
  // Deals belong to a player. Databases from before players existed get the column, with their deals unowned.
  const columns = db.prepare("PRAGMA table_info(scenarios)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "player")) db.exec("ALTER TABLE scenarios ADD COLUMN player TEXT NOT NULL DEFAULT ''");
  return db;
}

/** Local dev storage: a SQLite file under data/, one player's deals at a time. */
export class SqliteStore implements Store {
  private db: DatabaseSync;

  constructor(
    db: DatabaseSync | string = "data/negotiator.db",
    private player = "",
  ) {
    this.db = typeof db === "string" ? open(db) : db;
  }

  /** The same database, scoped to one player. Locally, the first player also takes any deals from before players existed. */
  forPlayer(player: string): SqliteStore {
    this.db.prepare("UPDATE scenarios SET player = ? WHERE player = ''").run(player);
    return new SqliteStore(this.db, player);
  }

  async saveScenario(scenario: Scenario): Promise<void> {
    this.db.prepare("INSERT INTO scenarios (id, created_at, data, player) VALUES (?, ?, ?, ?)").run(scenario.id, scenario.createdAt, JSON.stringify(scenario), this.player);
  }

  async get(id: string): Promise<Deal | null> {
    const row = this.db.prepare("SELECT s.data AS s, n.data AS n FROM scenarios s LEFT JOIN negotiations n ON n.scenario_id = s.id WHERE s.id = ? AND s.player = ?").get(id, this.player) as { s: string; n: string | null } | undefined;
    return row ? toDeal(row) : null;
  }

  async saveNegotiation(_s: Scenario, n: Negotiation): Promise<void> {
    this.db
      .prepare("INSERT INTO negotiations (scenario_id, updated_at, data) VALUES (?, ?, ?) ON CONFLICT(scenario_id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data")
      .run(n.scenarioId, new Date().toISOString(), JSON.stringify(n));
  }

  async list(limit = 50): Promise<ScenarioSummary[]> {
    const rows = this.db.prepare("SELECT s.data AS s, n.data AS n FROM scenarios s LEFT JOIN negotiations n ON n.scenario_id = s.id WHERE s.player = ? ORDER BY s.created_at DESC LIMIT ?").all(this.player, limit) as { s: string; n: string | null }[];
    return rows.map((r) => {
      const { scenario, negotiation } = toDeal(r);
      return summarize(scenario, negotiation);
    });
  }

  async all(): Promise<Deal[]> {
    const rows = this.db.prepare("SELECT s.data AS s, n.data AS n FROM scenarios s LEFT JOIN negotiations n ON n.scenario_id = s.id WHERE s.player = ? ORDER BY s.created_at ASC").all(this.player) as { s: string; n: string | null }[];
    return rows.map(toDeal);
  }

  async delete(id: string): Promise<boolean> {
    if (!(await this.get(id))) return false;
    this.db.prepare("DELETE FROM negotiations WHERE scenario_id = ?").run(id);
    return this.db.prepare("DELETE FROM scenarios WHERE id = ? AND player = ?").run(id, this.player).changes > 0;
  }

  async deleteAll(): Promise<number> {
    this.db.prepare("DELETE FROM negotiations WHERE scenario_id IN (SELECT id FROM scenarios WHERE player = ?)").run(this.player);
    return Number(this.db.prepare("DELETE FROM scenarios WHERE player = ?").run(this.player).changes);
  }
}

function toDeal(row: { s: string; n: string | null }): Deal {
  return { scenario: JSON.parse(row.s) as Scenario, negotiation: row.n ? (JSON.parse(row.n) as Negotiation) : null };
}
