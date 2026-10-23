import type { UserView } from "../../server/engine/views";
import type { ScenarioSummary } from "../../server/db";
import type { NegotiationView } from "../../server/negotiation/types";
import type { UserAction } from "../../server/negotiation/engine";
import type { TxAction } from "../../server/transaction/engine";
import type { MentorEntry } from "../../server/negotiation/types";
import type { Debrief } from "../../server/coach/debrief";

export type { UserView, ScenarioSummary, NegotiationView, UserAction, TxAction, MentorEntry, Debrief };

export class ApiError extends Error {
  constructor(
    message: string,
    public details: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({ error: `The API server isn't responding (${response.status}). Is it running?` }));
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, body.details ?? []);
  return body as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

export const api = {
  status: () => request<{ storyWriter: "claude" | "offline" }>("/api/status"),
  createScenario: () => post<{ view: UserView; warnings: string[] }>("/api/scenarios"),
  listScenarios: () => request<ScenarioSummary[]>("/api/scenarios"),
  getScenario: (id: string) => request<{ view: UserView }>(`/api/scenarios/${id}`),
  getNegotiation: (id: string) => request<{ negotiation: NegotiationView | null }>(`/api/scenarios/${id}/negotiation`),
  startNegotiation: (id: string) => post<{ negotiation: NegotiationView }>(`/api/scenarios/${id}/negotiation/start`),
  actTx: (id: string, action: TxAction) => post<{ negotiation: NegotiationView }>(`/api/scenarios/${id}/transaction/actions`, action),
  mentorLog: (id: string) => request<{ log: MentorEntry[] }>(`/api/scenarios/${id}/mentor`),
  askMentor: (id: string, question: string) => post<{ log: MentorEntry[] }>(`/api/scenarios/${id}/mentor`, { question }),
  debrief: (id: string) => request<{ debrief: Debrief }>(`/api/scenarios/${id}/debrief`),
  act: (id: string, action: UserAction) => post<{ negotiation: NegotiationView }>(`/api/scenarios/${id}/negotiation/actions`, action),
};
