import type { UserView } from "../../server/engine/views";
import type { ScenarioSummary } from "../../server/api/summary";
import type { WorkRequest } from "../../server/api/routes";
import type { NegotiationView } from "../../server/negotiation/types";
import type { UserAction } from "../../server/negotiation/engine";
import type { TxAction } from "../../server/transaction/engine";
import type { MentorEntry } from "../../server/negotiation/types";
import type { Debrief } from "../../server/coach/debrief";
import type { Progress } from "../../server/coach/progress";

export type { UserView, ScenarioSummary, NegotiationView, UserAction, TxAction, MentorEntry, Debrief, Progress };

export class ApiError extends Error {
  constructor(
    message: string,
    public details: string[] = [],
  ) {
    super(message);
  }
}

// ---------- Who's playing ----------

const PLAYER_STORAGE = "negotiator.player";
let player: string | null = null;
try {
  player = localStorage.getItem(PLAYER_STORAGE);
} catch {
  // Storage blocked: the name lasts until the page reloads.
}

export function getPlayer(): string | null {
  return player;
}

export function setPlayer(name: string | null): void {
  player = name?.trim() || null;
  try {
    if (player) localStorage.setItem(PLAYER_STORAGE, player);
    else localStorage.removeItem(PLAYER_STORAGE);
  } catch {
    // Storage blocked: keep it in memory.
  }
}

/** Every request says whose deals it's about. The server keeps each name's deals apart. */
function withPlayer(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(player ? { "x-player": encodeURIComponent(player) } : {}) } };
}

async function parse(response: Response): Promise<{ error?: string; details?: string[]; jobId?: string } & Record<string, unknown>> {
  return response.json().catch(() => ({ error: `The API server isn't responding (${response.status}). Is it running?` }));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, withPlayer(init));
  const body = await parse(response);
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, body.details ?? []);
  return body as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls a background job (Netlify) until it is done, then returns or throws its reply like an ordinary request. */
async function follow<T>(jobId: string): Promise<T> {
  const kick = await fetch("/.netlify/functions/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
  if (!kick.ok) throw new ApiError(`Couldn't start the request (${kick.status}). Try again.`);
  const giveUp = Date.now() + 17 * 60_000;
  for (let wait = 800; Date.now() < giveUp; wait = Math.min(wait * 1.25, 2500)) {
    await sleep(wait);
    const job = await request<{ status: "queued" | "running" | "done"; reply: { status: number; body: { error?: string; details?: string[] } } | null }>(`/api/jobs/${jobId}`);
    if (job.status !== "done" || !job.reply) continue;
    if (job.reply.status >= 400) throw new ApiError(job.reply.body.error ?? `Request failed (${job.reply.status})`, job.reply.body.details ?? []);
    return job.reply.body as T;
  }
  throw new ApiError("The request is taking too long. Reload to see where the deal stands.");
}

/** Anything that changes a deal. Locally it answers directly; on Netlify it answers 202 with a job to follow. */
async function work<T>(job: WorkRequest): Promise<T> {
  const response = await fetch("/api/work", withPlayer({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job) }));
  const body = await parse(response);
  if (response.status === 202 && typeof body.jobId === "string") return follow<T>(body.jobId);
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, body.details ?? []);
  return body as T;
}

export const api = {
  status: () => request<{ storyWriter: "claude" | "offline" }>("/api/status"),
  createScenario: () => work<{ view: UserView; warnings: string[] }>({ kind: "create" }),
  listScenarios: () => request<ScenarioSummary[]>("/api/scenarios"),
  getScenario: (id: string) => request<{ view: UserView }>(`/api/scenarios/${id}`),
  getNegotiation: (id: string) => request<{ negotiation: NegotiationView | null }>(`/api/scenarios/${id}/negotiation`),
  startNegotiation: (id: string) => work<{ negotiation: NegotiationView }>({ kind: "start", id }),
  actTx: (id: string, action: TxAction) => work<{ negotiation: NegotiationView }>({ kind: "tx", id, action }),
  mentorLog: (id: string) => request<{ log: MentorEntry[] }>(`/api/scenarios/${id}/mentor`),
  askMentor: (id: string, question: string) => work<{ log: MentorEntry[] }>({ kind: "mentor", id, question }),
  debrief: (id: string) => work<{ debrief: Debrief }>({ kind: "debrief", id }),
  progress: () => request<Progress>("/api/progress"),
  deleteScenario: (id: string) => request<{ deleted: boolean }>(`/api/scenarios/${id}`, { method: "DELETE" }),
  deleteAll: () => request<{ deleted: number }>("/api/scenarios", { method: "DELETE" }),
  act: (id: string, action: UserAction) => work<{ negotiation: NegotiationView }>({ kind: "act", id, action }),
};
