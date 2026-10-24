// The API, independent of where it runs. Express (local dev) and Netlify Functions are thin adapters over this.
//
// Reads answer straight away. Anything that changes a deal is a WorkRequest: it may call Claude, so it can take
// longer than a serverless request is allowed to run. Each runtime decides how to submit work: locally it runs
// inline, on Netlify it is queued as a background job that the browser polls.

import { generateScenario, hasClaudeCredentials } from "../scenarioService";
import { userView } from "../engine/views";
import type { Scenario } from "../engine/types";
import { ActionError, applyUserAction, offerNightView, startNegotiation, type UserAction } from "../negotiation/engine";
import { negotiationView, newNegotiation, type Negotiation } from "../negotiation/types";
import { applyTxAction, contractSignedNote, transactionClientView, type TxAction } from "../transaction/engine";
import { createTransaction } from "../transaction/schedule";
import { askMentor } from "../coach/mentor";
import { buildDebrief, debriefAvailable } from "../coach/debrief";
import { buildProgress } from "../coach/progress";
import type { ScenarioSummary } from "./summary";
import { clientView } from "../client/engine";
import { newClientState } from "../client/types";

export interface Deal {
  scenario: Scenario;
  negotiation: Negotiation | null;
}

export interface Store {
  get(id: string): Promise<Deal | null>;
  saveScenario(s: Scenario): Promise<void>;
  saveNegotiation(s: Scenario, n: Negotiation): Promise<void>;
  /** Newest first. */
  list(limit?: number): Promise<ScenarioSummary[]>;
  /** Oldest first. */
  all(): Promise<Deal[]>;
  delete(id: string): Promise<boolean>;
  deleteAll(): Promise<number>;
}

/** One deal does one thing at a time. */
export interface Locks {
  isLocked(key: string): Promise<boolean>;
  anyLocked(): Promise<boolean>;
}

export interface Reply {
  status: number;
  body: unknown;
}

export type WorkRequest =
  | { kind: "create" }
  | { kind: "start"; id: string }
  | { kind: "act"; id: string; action: UserAction }
  | { kind: "tx"; id: string; action: TxAction }
  | { kind: "mentor"; id: string; question: string }
  | { kind: "debrief"; id: string };

export interface Runtime {
  store: Store;
  locks: Locks;
  submit(work: WorkRequest): Promise<Reply>;
}

/** Each person's deals are kept apart by the name they enter, sent with every request. */
export const PLAYER_HEADER = "x-player";

/** A stable key for a player's name (sent URI-encoded): lowercase letters, digits and dashes, accents dropped.
 * Names with no Latin letters at all get a key from their characters' code points. Null if the name is blank. */
export function playerKey(raw: string | null | undefined): string | null {
  let name = raw ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not encoded; use as is.
  }
  name = name.trim().toLowerCase();
  if (!name) return null;
  const key = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return key || `u-${Array.from(name.replace(/\s+/g, ""), (c) => c.codePointAt(0)!.toString(36)).join("-")}`.slice(0, 40);
}

export const NEEDS_NAME: Reply = { status: 400, body: { error: "Tell us your name first." } };

const ok = (body: unknown): Reply => ({ status: 200, body });
const fail = (status: number, error: string, details?: string[]): Reply => ({ status, body: details ? { error, details } : { error } });

/** The negotiation as the browser sees it, including the transaction once under contract. */
function viewFor(s: Scenario, n: Negotiation) {
  if (n.status === "under_contract" && !n.transaction) {
    const accepted = n.offers.find((o) => o.id === n.acceptedOfferId);
    if (accepted) n.transaction = createTransaction(s, accepted.terms, n.simHours);
  }
  if (n.transaction) contractSignedNote(s, n);
  return negotiationView(n, n.transaction ? transactionClientView(s, n.transaction) : null, offerNightView(s, n), clientView(s, n));
}

export function lockKey(work: WorkRequest): string | null {
  return work.kind === "create" ? null : work.id;
}

export function busyMessage(work: WorkRequest): string {
  return work.kind === "mentor" || work.kind === "debrief" ? "Still working on the last request." : "The other agent is still responding.";
}

/** Reads a work request from an untrusted body. The engine validates the actions themselves. */
export function parseWork(body: unknown): WorkRequest | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.kind === "create") return { kind: "create" };
  if (typeof b.id !== "string" || !b.id) return null;
  switch (b.kind) {
    case "start":
    case "debrief":
      return { kind: b.kind, id: b.id };
    case "act":
    case "tx":
      return b.action && typeof b.action === "object" ? ({ kind: b.kind, id: b.id, action: b.action } as WorkRequest) : null;
    case "mentor":
      return { kind: "mentor", id: b.id, question: String(b.question ?? "").trim() };
    default:
      return null;
  }
}

/** The quick checks, so a bad request fails before anything is queued. Null means the work can go ahead. */
export async function checkWork(store: Store, work: WorkRequest): Promise<Reply | null> {
  if (work.kind === "create") return null;
  const deal = await store.get(work.id);
  if (!deal) return fail(404, "Scenario not found");
  if (work.kind === "mentor") {
    if (!deal.negotiation) return fail(404, "Start the negotiation first.");
    if (!work.question) return fail(422, "Ask a question first.");
  }
  if (work.kind === "debrief") {
    if (!deal.negotiation) return fail(404, "Scenario not found");
    if (!debriefAvailable(deal.negotiation)) return fail(409, "The debrief opens when the deal is finished.");
  }
  return null;
}

/** Does the work. The caller holds the deal's lock. */
export async function executeWork(store: Store, work: WorkRequest): Promise<Reply> {
  const refused = await checkWork(store, work);
  if (refused) return refused;
  try {
    if (work.kind === "create") {
      const { scenario, warnings } = await generateScenario();
      await store.saveScenario(scenario);
      for (const warning of warnings) console.warn(warning);
      return { status: 201, body: { view: userView(scenario), warnings } };
    }
    const deal = (await store.get(work.id))!;
    const s = deal.scenario;
    // New deals require the client to sign everything before it goes out.
    const n = deal.negotiation ?? { ...newNegotiation(s.id), client: newClientState(true) };

    if (work.kind === "mentor") {
      const { answer, source } = await askMentor(s, n, work.question);
      (n.mentorLog ??= []).push({ at: n.simHours, question: work.question, answer, source });
      await store.saveNegotiation(s, n);
      return ok({ log: n.mentorLog });
    }
    if (work.kind === "debrief") {
      const debrief = await buildDebrief(s, n);
      await store.saveNegotiation(s, n);
      return ok({ debrief });
    }

    try {
      if (work.kind === "start") await startNegotiation(s, n);
      else if (work.kind === "act") {
        await startNegotiation(s, n);
        await applyUserAction(s, n, work.action);
      } else await applyTxAction(s, n, work.action);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      // Refused attempts are part of the record the debrief reviews.
      const action = work.kind === "start" ? "unknown" : String((work.action as { type?: string }).type ?? "unknown");
      (n.attempts ??= []).push({ at: n.simHours, action, message: error.message, details: error.details });
      await store.saveNegotiation(s, n);
      return fail(422, error.message, error.details);
    }
    const view = viewFor(s, n);
    await store.saveNegotiation(s, n);
    return ok({ negotiation: view });
  } catch (error) {
    console.error(error);
    return fail(500, (error as Error).message);
  }
}

// ---------- Routes ----------

export interface Route {
  method: "GET" | "POST" | "DELETE";
  /** Express-style, e.g. /api/scenarios/:id */
  path: string;
  /** Answers without a player name. */
  public?: boolean;
  handle(rt: Runtime, params: Record<string, string>, body: unknown): Promise<Reply>;
}

export const ROUTES: Route[] = [
  { method: "GET", path: "/api/status", public: true, handle: async () => ok({ storyWriter: hasClaudeCredentials() ? "claude" : "offline" }) },

  { method: "GET", path: "/api/scenarios", handle: async (rt) => ok(await rt.store.list()) },

  {
    method: "GET",
    path: "/api/scenarios/:id",
    handle: async (rt, { id }) => {
      const deal = await rt.store.get(id);
      // Only the user's view leaves the server. The full scenario (other side's brief, ground truth, difficulty) stays here.
      return deal ? ok({ view: userView(deal.scenario) }) : fail(404, "Scenario not found");
    },
  },

  {
    method: "GET",
    path: "/api/scenarios/:id/negotiation",
    handle: async (rt, { id }) => {
      const deal = await rt.store.get(id);
      if (!deal?.negotiation) return ok({ negotiation: null });
      const view = viewFor(deal.scenario, deal.negotiation);
      // Viewing can add the agreement timeline. Don't write over a turn that is running right now.
      if (!(await rt.locks.isLocked(id))) await rt.store.saveNegotiation(deal.scenario, deal.negotiation);
      return ok({ negotiation: view });
    },
  },

  { method: "GET", path: "/api/scenarios/:id/mentor", handle: async (rt, { id }) => ok({ log: (await rt.store.get(id))?.negotiation?.mentorLog ?? [] }) },

  {
    method: "POST",
    path: "/api/work",
    handle: async (rt, _p, body) => {
      const work = parseWork(body);
      return work ? rt.submit(work) : fail(400, "Unknown request.");
    },
  },

  {
    method: "GET",
    path: "/api/progress",
    handle: async (rt) => {
      try {
        return ok(await buildProgress(await rt.store.all()));
      } catch (error) {
        console.error(error);
        return fail(500, (error as Error).message);
      }
    },
  },

  {
    method: "DELETE",
    path: "/api/scenarios/:id",
    handle: async (rt, { id }) => ((await rt.locks.isLocked(id)) ? fail(409, "That deal is busy. Try again in a moment.") : ok({ deleted: await rt.store.delete(id) })),
  },

  {
    method: "DELETE",
    path: "/api/scenarios",
    handle: async (rt) => {
      // Only this player's deals: someone else's running turn doesn't block them.
      for (const d of await rt.store.all()) if (await rt.locks.isLocked(d.scenario.id)) return fail(409, "A deal is busy. Try again in a moment.");
      return ok({ deleted: await rt.store.deleteAll() });
    },
  },
];

/** Matches a request path against the route table. */
export function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.replace(/\/+$/, "").split("/");
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const pattern = route.path.split("/");
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (pattern.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), parts[i] !== "") : p === parts[i]))) return { route, params };
  }
  return null;
}
