import type { UserView } from "../../server/engine/views";
import type { ScenarioSummary } from "../../server/db";

export type { UserView, ScenarioSummary };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({ error: `The API server isn't responding (${response.status}). Is it running?` }));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  status: () => request<{ storyWriter: "claude" | "offline" }>("/api/status"),
  createScenario: () => request<{ view: UserView; warnings: string[] }>("/api/scenarios", { method: "POST" }),
  listScenarios: () => request<ScenarioSummary[]>("/api/scenarios"),
  getScenario: (id: string) => request<{ view: UserView }>(`/api/scenarios/${id}`),
};
