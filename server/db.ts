import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import type { Scenario } from "./engine/types";

export interface ScenarioSummary {
  id: string;
  createdAt: string;
  role: Scenario["userRole"];
  city: string;
  stateCode: string;
  propertyType: Scenario["property"]["type"];
  listPrice: number;
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
      )
    `);
  }

  save(scenario: Scenario): void {
    this.db.prepare("INSERT INTO scenarios (id, created_at, data) VALUES (?, ?, ?)").run(scenario.id, scenario.createdAt, JSON.stringify(scenario));
  }

  get(id: string): Scenario | null {
    const row = this.db.prepare("SELECT data FROM scenarios WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Scenario) : null;
  }

  list(limit = 50): ScenarioSummary[] {
    const rows = this.db.prepare("SELECT data FROM scenarios ORDER BY created_at DESC LIMIT ?").all(limit) as { data: string }[];
    return rows.map(({ data }) => {
      const s = JSON.parse(data) as Scenario;
      return { id: s.id, createdAt: s.createdAt, role: s.userRole, city: s.market.city, stateCode: s.market.stateCode, propertyType: s.property.type, listPrice: s.property.listPrice };
    });
  }
}
