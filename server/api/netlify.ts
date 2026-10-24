// Netlify runtime: deals, locks and jobs live in one Blobs store, and work runs in a background function.
//
// A request to change a deal claims the deal's lock and queues a job. The browser then starts the background
// function with the job id and polls until the job is done. Netlify retries a background function that crashes,
// so a job is claimed (queued -> running) with a conditional write and errors are caught, never thrown.

import { randomUUID } from "node:crypto";
import type { Scenario } from "../engine/types";
import type { Negotiation } from "../negotiation/types";
import { busyMessage, checkWork, executeWork, lockKey, type Deal, type Locks, type Reply, type Runtime, type Store, type WorkRequest } from "./routes";
import { summarize, type ScenarioSummary } from "./summary";
import type { KV } from "./kv";

/** A background function runs for at most 15 minutes. A lock or job older than this belongs to a dead run. */
export const RUN_LIMIT_MS = 16 * 60_000;
/** The browser starts the job right after queueing it. One still queued after this was never started. */
export const START_LIMIT_MS = 2 * 60_000;

/** Production and previews must never share data: previews would overwrite real deals. */
export function storeName(deployContext: string | undefined): string {
  return deployContext === "production" ? "negotiator" : "negotiator-preview";
}

/** One player's deals, under players/<player>/deals/<id>. */
export class KvStore implements Store {
  private prefix: string;

  constructor(
    private kv: KV,
    player: string,
  ) {
    this.prefix = `players/${player}/deals/`;
  }

  async get(id: string): Promise<Deal | null> {
    return (await this.kv.get<Deal>(`${this.prefix}${id}`))?.value ?? null;
  }

  async saveScenario(s: Scenario): Promise<void> {
    await this.kv.set(`${this.prefix}${s.id}`, { scenario: s, negotiation: null } satisfies Deal, { metadata: { ...summarize(s, null) } });
  }

  async saveNegotiation(s: Scenario, n: Negotiation): Promise<void> {
    await this.kv.set(`${this.prefix}${s.id}`, { scenario: s, negotiation: n } satisfies Deal, { metadata: { ...summarize(s, n) } });
  }

  async list(limit = 50): Promise<ScenarioSummary[]> {
    const keys = await this.kv.keys(this.prefix);
    const summaries = (await Promise.all(keys.map((k) => this.kv.getMetadata(k)))).filter((m): m is ScenarioSummary & Record<string, unknown> => Boolean(m?.id));
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async all(): Promise<Deal[]> {
    const keys = await this.kv.keys(this.prefix);
    const deals = (await Promise.all(keys.map((k) => this.kv.get<Deal>(k)))).flatMap((d) => (d ? [d.value] : []));
    return deals.sort((a, b) => a.scenario.createdAt.localeCompare(b.scenario.createdAt));
  }

  async delete(id: string): Promise<boolean> {
    if (!(await this.kv.getMetadata(`${this.prefix}${id}`))) return false;
    await this.kv.delete(`${this.prefix}${id}`);
    return true;
  }

  async deleteAll(): Promise<number> {
    const keys = await this.kv.keys(this.prefix);
    await Promise.all(keys.map((k) => this.kv.delete(k)));
    return keys.length;
  }
}

interface Lock {
  jobId: string;
  at: number;
}

export class KvLocks implements Locks {
  constructor(
    private kv: KV,
    private now = () => Date.now(),
  ) {}

  private live(lock: Lock | undefined): boolean {
    return Boolean(lock) && this.now() - lock!.at < RUN_LIMIT_MS;
  }

  async claim(key: string, jobId: string): Promise<boolean> {
    const lock: Lock = { jobId, at: this.now() };
    if (await this.kv.set(`locks/${key}`, lock, { onlyIfNew: true })) return true;
    const held = await this.kv.get<Lock>(`locks/${key}`);
    if (held && this.live(held.value)) return false;
    // A stale lock from a run that died: take it over, but only if nobody else did first.
    return held ? this.kv.set(`locks/${key}`, lock, { onlyIfMatch: held.etag }) : this.kv.set(`locks/${key}`, lock, { onlyIfNew: true });
  }

  async release(key: string, jobId: string): Promise<void> {
    const held = await this.kv.get<Lock>(`locks/${key}`);
    if (held?.value.jobId === jobId) await this.kv.delete(`locks/${key}`);
  }

  async isLocked(key: string): Promise<boolean> {
    return this.live((await this.kv.get<Lock>(`locks/${key}`))?.value);
  }

  async anyLocked(): Promise<boolean> {
    const keys = await this.kv.keys("locks/");
    const locks = await Promise.all(keys.map((k) => this.kv.get<Lock>(k)));
    return locks.some((l) => this.live(l?.value));
  }
}

export interface Job {
  id: string;
  /** Whose deal this is, so the background run opens the right player's store. */
  player: string;
  work: WorkRequest;
  lockKey: string | null;
  status: "queued" | "running" | "done";
  createdAt: number;
  startedAt?: number;
  reply?: Reply;
}

export interface NetlifyRuntime extends Runtime {
  locks: KvLocks;
  /** Runs a queued job. Safe to call twice: the second call finds the job already claimed and does nothing. */
  runJob(jobId: string): Promise<void>;
  /** What the browser polls. Also ends jobs whose run died, so their locks free up. */
  jobStatus(jobId: string): Promise<Reply>;
}

export function netlifyRuntime(kv: KV, player: string, now = () => Date.now()): NetlifyRuntime {
  const store = new KvStore(kv, player);
  const locks = new KvLocks(kv, now);

  async function finish(job: Job, etag: string | null, reply: Reply): Promise<boolean> {
    const done: Job = { ...job, status: "done", reply };
    const written = etag === null ? await kv.set(`jobs/${job.id}`, done) : await kv.set(`jobs/${job.id}`, done, { onlyIfMatch: etag });
    if (written && job.lockKey) await locks.release(job.lockKey, job.id);
    return written;
  }

  return {
    store,
    locks,

    async submit(work) {
      const refused = await checkWork(store, work);
      if (refused) return refused;
      const job: Job = { id: randomUUID(), player, work, lockKey: lockKey(work), status: "queued", createdAt: now() };
      if (job.lockKey && !(await locks.claim(job.lockKey, job.id))) return { status: 409, body: { error: busyMessage(work) } };
      try {
        await kv.set(`jobs/${job.id}`, job);
      } catch (error) {
        if (job.lockKey) await locks.release(job.lockKey, job.id);
        throw error;
      }
      return { status: 202, body: { jobId: job.id } };
    },

    async runJob(jobId) {
      const entry = await kv.get<Job>(`jobs/${jobId}`);
      if (!entry || entry.value.status !== "queued") return;
      const running: Job = { ...entry.value, status: "running", startedAt: now() };
      if (!(await kv.set(`jobs/${jobId}`, running, { onlyIfMatch: entry.etag }))) return;
      let reply: Reply;
      try {
        reply = await executeWork(new KvStore(kv, running.player), running.work);
      } catch (error) {
        console.error(error);
        reply = { status: 500, body: { error: (error as Error).message } };
      }
      try {
        await finish(running, null, reply);
      } catch (error) {
        // Nothing to retry: the poller will time the job out and free the lock.
        console.error(error);
      }
    },

    async jobStatus(jobId) {
      const entry = await kv.get<Job>(`jobs/${jobId}`);
      if (!entry) return { status: 404, body: { error: "That request has expired. Try again." } };
      const job = entry.value;
      if (job.status === "queued" && now() - job.createdAt > START_LIMIT_MS) {
        await finish(job, entry.etag, { status: 500, body: { error: "The request never started. Try again." } });
        return this.jobStatus(jobId);
      }
      if (job.status === "running" && now() - (job.startedAt ?? job.createdAt) > RUN_LIMIT_MS) {
        await finish(job, entry.etag, { status: 504, body: { error: "The request ran out of time. Try again." } });
        return this.jobStatus(jobId);
      }
      return { status: 200, body: { status: job.status, reply: job.reply ?? null } };
    },
  };
}
