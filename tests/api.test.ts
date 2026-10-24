import { beforeAll, describe, expect, it } from "vitest";
import { SqliteStore } from "../server/db";
import { localRuntime } from "../server/api/local";
import { matchRoute, playerKey, type Reply, type Runtime } from "../server/api/routes";
import { MemoryKV } from "../server/api/kv";
import { netlifyRuntime, RUN_LIMIT_MS, START_LIMIT_MS, storeName } from "../server/api/netlify";

beforeAll(() => {
  // Every path here is offline: no Claude calls from tests.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

async function call(rt: Runtime, method: string, path: string, body?: unknown): Promise<Reply> {
  const match = matchRoute(method, path);
  if (!match) throw new Error(`No route for ${method} ${path}`);
  return match.route.handle(rt, match.params, body);
}

const body = (r: Reply) => r.body as Record<string, any>;

describe("routes", () => {
  it("matches paths and their parameters", () => {
    expect(matchRoute("GET", "/api/scenarios/abc-1/negotiation")?.params).toEqual({ id: "abc-1" });
    expect(matchRoute("GET", "/api/scenarios/")?.route.path).toBe("/api/scenarios");
    expect(matchRoute("POST", "/api/scenarios/abc")).toBeNull();
  });

  it("runs a deal locally: create, start, refuse, act, list", async () => {
    const rt = localRuntime(new SqliteStore(":memory:"));
    const created = await call(rt, "POST", "/api/work", { kind: "create" });
    expect(created.status).toBe(201);
    const id = body(created).view.id as string;
    // Only the user's view comes back: the other side's brief and the ground truth stay on the server.
    expect(body(created).view.yourClient).toBeDefined();
    expect(JSON.stringify(created.body)).not.toMatch(/groundTruth|reservationPrice.*reservationPrice/);

    expect((await call(rt, "POST", "/api/work", { kind: "start", id })).status).toBe(200);

    const refused = await call(rt, "POST", "/api/work", { kind: "act", id, action: { type: "message", text: "" } });
    expect(refused.status).toBe(422);
    expect((await rt.store.get(id))!.negotiation!.attempts).toHaveLength(1);

    const said = await call(rt, "POST", "/api/work", { kind: "act", id, action: { type: "message", text: "Hello, tell me about the property." } });
    expect(said.status).toBe(200);
    expect(body(said).negotiation.messages.length).toBeGreaterThan(1);

    const list = await call(rt, "GET", "/api/scenarios");
    expect(body(list)).toHaveLength(1);
    expect(body(list)[0].id).toBe(id);
  });

  it("keeps each player's deals apart locally, and the first player takes deals from before players", async () => {
    const db = new SqliteStore(":memory:");
    const legacy = body(await call(localRuntime(db), "POST", "/api/work", { kind: "create" })).view.id;
    const pat = localRuntime(db.forPlayer("pat"));
    const sam = localRuntime(db.forPlayer("sam"));
    expect(body(await call(pat, "GET", "/api/scenarios")).map((s: { id: string }) => s.id)).toEqual([legacy]);
    const samsDeal = body(await call(sam, "POST", "/api/work", { kind: "create" })).view.id;
    expect(body(await call(sam, "GET", "/api/scenarios")).map((s: { id: string }) => s.id)).toEqual([samsDeal]);
    expect((await call(sam, "GET", `/api/scenarios/${legacy}`)).status).toBe(404);
    expect(body(await call(sam, "DELETE", "/api/scenarios")).deleted).toBe(1);
    expect(body(await call(pat, "GET", "/api/scenarios"))).toHaveLength(1);
  });

  it("turns names into stable player keys", () => {
    expect(playerKey("  Pat Morgan ")).toBe("pat-morgan");
    expect(playerKey("PAT  morgan!")).toBe("pat-morgan");
    expect(playerKey(encodeURIComponent("José Núñez"))).toBe("jose-nunez");
    expect(playerKey(encodeURIComponent("李明"))).toMatch(/^u-/);
    expect(playerKey(encodeURIComponent("李明"))).toBe(playerKey(encodeURIComponent(" 李明 ")));
    expect(playerKey("   ")).toBeNull();
    expect(playerKey(undefined)).toBeNull();
  });

  it("refuses bad work before running it", async () => {
    const rt = localRuntime(new SqliteStore(":memory:"));
    expect((await call(rt, "POST", "/api/work", { kind: "nope" })).status).toBe(400);
    expect((await call(rt, "POST", "/api/work", { kind: "start", id: "missing" })).status).toBe(404);
    const id = body(await call(rt, "POST", "/api/work", { kind: "create" })).view.id;
    expect((await call(rt, "POST", "/api/work", { kind: "mentor", id, question: "hi" })).status).toBe(404);
    await call(rt, "POST", "/api/work", { kind: "start", id });
    expect((await call(rt, "POST", "/api/work", { kind: "mentor", id, question: "  " })).status).toBe(422);
    expect((await call(rt, "POST", "/api/work", { kind: "debrief", id })).status).toBe(409);
  });
});

describe("Netlify runtime", () => {
  function setup() {
    let clock = 1_000_000;
    const kv = new MemoryKV();
    const rt = netlifyRuntime(kv, "pat", () => clock);
    return { kv, rt, tick: (ms: number) => (clock += ms) };
  }

  async function finished(rt: ReturnType<typeof setup>["rt"], jobId: string): Promise<Reply> {
    const status = body(await rt.jobStatus(jobId));
    expect(status.status).toBe("done");
    return status.reply as Reply;
  }

  it("keeps production and preview data apart", () => {
    expect(storeName("production")).toBe("negotiator");
    expect(storeName("deploy-preview")).toBe("negotiator-preview");
    expect(storeName("branch-deploy")).toBe("negotiator-preview");
    expect(storeName(undefined)).toBe("negotiator-preview");
  });

  it("queues work as a job, locks the deal, and runs the job once", async () => {
    const { rt } = setup();
    const create = await rt.submit({ kind: "create" });
    expect(create.status).toBe(202);
    await rt.runJob(body(create).jobId);
    const created = await finished(rt, body(create).jobId);
    expect(created.status).toBe(201);
    const id = (created.body as any).view.id as string;

    const start = await rt.submit({ kind: "start", id });
    expect(start.status).toBe(202);
    expect(await rt.locks.isLocked(id)).toBe(true);
    expect(body(await rt.jobStatus(body(start).jobId)).status).toBe("queued");

    // A second change to the same deal waits its turn; deleting it is refused while it's busy.
    expect((await rt.submit({ kind: "act", id, action: { type: "message", text: "Hi" } })).status).toBe(409);
    expect((await call(rt, "DELETE", `/api/scenarios/${id}`)).status).toBe(409);

    await rt.runJob(body(start).jobId);
    const started = await finished(rt, body(start).jobId);
    expect(started.status).toBe(200);
    expect(await rt.locks.isLocked(id)).toBe(false);

    // A retried invocation finds the job done and changes nothing.
    const before = (await rt.store.get(id))!.negotiation!.messages.length;
    await rt.runJob(body(start).jobId);
    expect((await rt.store.get(id))!.negotiation!.messages.length).toBe(before);

    const list = body(await call(rt, "GET", "/api/scenarios"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, status: "negotiating" });
  });

  it("returns refusals through the job and records them", async () => {
    const { rt } = setup();
    const create = await rt.submit({ kind: "create" });
    await rt.runJob(body(create).jobId);
    const id = ((await finished(rt, body(create).jobId)).body as any).view.id;
    const act = await rt.submit({ kind: "act", id, action: { type: "message", text: "" } });
    await rt.runJob(body(act).jobId);
    const reply = await finished(rt, body(act).jobId);
    expect(reply.status).toBe(422);
    expect((reply.body as any).error).toMatch(/message/i);
    expect((await rt.store.get(id))!.negotiation!.attempts).toHaveLength(1);
  });

  it("ends a job that never started and frees the deal", async () => {
    const { rt, tick } = setup();
    const create = await rt.submit({ kind: "create" });
    await rt.runJob(body(create).jobId);
    const id = ((await finished(rt, body(create).jobId)).body as any).view.id;

    const start = await rt.submit({ kind: "start", id });
    tick(START_LIMIT_MS + 1);
    const reply = await finished(rt, body(start).jobId);
    expect(reply.status).toBe(500);
    expect(await rt.locks.isLocked(id)).toBe(false);
    // Starting it late does nothing: the job is already over.
    await rt.runJob(body(start).jobId);
    expect((await rt.store.get(id))!.negotiation).toBeNull();
  });

  it("takes over a lock left by a run that died", async () => {
    const { rt, tick } = setup();
    expect(await rt.locks.claim("deal", "job-a")).toBe(true);
    expect(await rt.locks.claim("deal", "job-b")).toBe(false);
    tick(RUN_LIMIT_MS + 1);
    expect(await rt.locks.isLocked("deal")).toBe(false);
    expect(await rt.locks.claim("deal", "job-b")).toBe(true);
    // The dead run can't release the new owner's lock.
    await rt.locks.release("deal", "job-a");
    expect(await rt.locks.isLocked("deal")).toBe(true);
  });

  it("reports an unknown job", async () => {
    const { rt } = setup();
    expect((await rt.jobStatus("nope")).status).toBe(404);
  });
});
