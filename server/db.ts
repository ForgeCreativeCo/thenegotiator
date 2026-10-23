import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import type { Scenario } from "./engine/types";
import type { Negotiation, NegotiationStatus } from "./negotiation/types";

export interface ScenarioSummary {
  id: string;
  createdAt: string;
  role: Scenario["userRole"];
  region: string;
  municipality: string;
  propertyType: Scenario["property"]["type"];
  listPrice: number;
  status: NegotiationStatus | "closed" | "terminated";
}

export class ScenarioStore {
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

  save(scenario: Scenario): void {
    this.db.prepare("INSERT INTO scenarios (id, created_at, data) VALUES (?, ?, ?)").run(scenario.id, scenario.createdAt, JSON.stringify(scenario));
  }

  get(id: string): Scenario | null {
    const row = this.db.prepare("SELECT data FROM scenarios WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Scenario) : null;
  }

  getNegotiation(scenarioId: string): Negotiation | null {
    const row = this.db.prepare("SELECT data FROM negotiations WHERE scenario_id = ?").get(scenarioId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Negotiation) : null;
  }

  saveNegotiation(n: Negotiation): void {
    this.db
      .prepare("INSERT INTO negotiations (scenario_id, updated_at, data) VALUES (?, ?, ?) ON CONFLICT(scenario_id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data")
      .run(n.scenarioId, new Date().toISOString(), JSON.stringify(n));
  }

  list(limit = 50): ScenarioSummary[] {
    const rows = this.db
      .prepare("SELECT s.data, json_extract(n.data, '$.status') AS status, json_extract(n.data, '$.transaction.status') AS tx_status FROM scenarios s LEFT JOIN negotiations n ON n.scenario_id = s.id ORDER BY s.created_at DESC LIMIT ?")
      .all(limit) as { data: string; status: NegotiationStatus | null; tx_status: string | null }[];
    return rows.map(({ data, status, tx_status }) => {
      const s = JSON.parse(data) as Scenario;
      return { id: s.id, createdAt: s.createdAt, role: s.userRole, region: s.market.region, municipality: s.property.address.municipality, propertyType: s.property.type, listPrice: s.property.listPrice, status: tx_status === "closed" || tx_status === "terminated" ? tx_status : (status ?? "negotiating") };
    });
  }

  /** Every scenario with its negotiation (if started), oldest first. */
  all(): { scenario: Scenario; negotiation: Negotiation | null }[] {
    const rows = this.db.prepare("SELECT s.data AS s, n.data AS n FROM scenarios s LEFT JOIN negotiations n ON n.scenario_id = s.id ORDER BY s.created_at ASC").all() as { s: string; n: string | null }[];
    return rows.map((r) => ({ scenario: JSON.parse(r.s) as Scenario, negotiation: r.n ? (JSON.parse(r.n) as Negotiation) : null }));
  }

  delete(id: string): boolean {
    this.db.prepare("DELETE FROM negotiations WHERE scenario_id = ?").run(id);
    return this.db.prepare("DELETE FROM scenarios WHERE id = ?").run(id).changes > 0;
  }

  deleteAll(): number {
    this.db.exec("DELETE FROM negotiations");
    return Number(this.db.prepare("DELETE FROM scenarios").run().changes);
  }
}
