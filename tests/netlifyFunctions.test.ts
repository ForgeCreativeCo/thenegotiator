// Runs the real Netlify function entry points against Netlify's local Blobs server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import type { Context } from "@netlify/functions";
import api from "../netlify/functions/api.mts";
import work from "../netlify/functions/work.mts";

let server: BlobsServer;
let directory: string;

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  directory = mkdtempSync(join(tmpdir(), "negotiator-blobs-"));
  const token = "test-token";
  server = new BlobsServer({ directory, token });
  const { port } = await server.start();
  const edgeURL = `http://localhost:${port}`;
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL, uncachedEdgeURL: edgeURL, siteID: "site-1", token })).toString("base64");
});

afterAll(async () => {
  await server?.stop();
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  rmSync(directory, { recursive: true, force: true });
});

const context = (deployContext: string) => ({ deploy: { context: deployContext, id: "d1", published: true } }) as unknown as Context;

async function apiCall(method: string, path: string, body?: unknown, deployContext = "production", player: string | null = "Pat Morgan") {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(player ? { "x-player": player } : {}) };
  const req = new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await api(req, context(deployContext));
  return { status: res.status, body: (await res.json()) as any };
}

/** What the browser does: submit, start the background function, poll. */
async function doWork(job: unknown, deployContext = "production") {
  const queued = await apiCall("POST", "/api/work", job, deployContext);
  expect(queued.status).toBe(202);
  await work(new Request("http://localhost/.netlify/functions/work", { method: "POST", body: JSON.stringify({ jobId: queued.body.jobId }) }), context(deployContext));
  const polled = await apiCall("GET", `/api/jobs/${queued.body.jobId}`, undefined, deployContext);
  expect(polled.body.status).toBe("done");
  return polled.body.reply as { status: number; body: any };
}

describe("Netlify functions on Blobs", () => {
  it("plays a deal through jobs and keeps previews apart from production", async () => {
    expect((await apiCall("GET", "/api/status")).body.storyWriter).toBe("offline");

    const created = await doWork({ kind: "create" });
    expect(created.status).toBe(201);
    const id = created.body.view.id;

    const started = await doWork({ kind: "start", id });
    expect(started.status).toBe(200);
    expect(started.body.negotiation.messages.length).toBeGreaterThan(0);

    const refused = await doWork({ kind: "act", id, action: { type: "message", text: "" } });
    expect(refused.status).toBe(422);

    const list = await apiCall("GET", "/api/scenarios");
    expect(list.body.map((s: { id: string }) => s.id)).toEqual([id]);
    expect((await apiCall("GET", `/api/scenarios/${id}/negotiation`)).body.negotiation.messages.length).toBeGreaterThan(0);
    expect((await apiCall("GET", "/api/progress")).body.deals).toHaveLength(1);

    // A preview deploy sees none of production's deals.
    expect((await apiCall("GET", "/api/scenarios", undefined, "deploy-preview")).body).toEqual([]);

    expect((await apiCall("DELETE", `/api/scenarios/${id}`)).body.deleted).toBe(true);
    expect((await apiCall("GET", "/api/scenarios")).body).toEqual([]);
    expect((await apiCall("GET", "/api/nothing-here")).status).toBe(404);
  });

  it("keeps each player's deals to themselves, and asks for a name first", async () => {
    expect((await apiCall("GET", "/api/scenarios", undefined, "production", null)).status).toBe(400);
    expect((await apiCall("GET", "/api/status", undefined, "production", null)).status).toBe(200);
    const id = (await doWork({ kind: "create" })).body.view.id;
    const other = (name: string, method: string, path: string) => apiCall(method, path, undefined, "production", name);
    expect((await other("Sam Lee", "GET", "/api/scenarios")).body).toEqual([]);
    expect((await other("Sam Lee", "GET", `/api/scenarios/${id}`)).status).toBe(404);
    expect((await other("Sam Lee", "DELETE", "/api/scenarios")).body.deleted).toBe(0);
    // The same name, typed differently, is the same player.
    expect((await other("  pat MORGAN ", "GET", "/api/scenarios")).body.map((s: { id: string }) => s.id)).toContain(id);
  });

  it("refuses a second change to a busy deal", async () => {
    const id = (await doWork({ kind: "create" })).body.view.id;
    const first = await apiCall("POST", "/api/work", { kind: "start", id });
    expect(first.status).toBe(202);
    const second = await apiCall("POST", "/api/work", { kind: "start", id });
    expect(second.status).toBe(409);
    await work(new Request("http://localhost/.netlify/functions/work", { method: "POST", body: JSON.stringify({ jobId: first.body.jobId }) }), context("production"));
    expect((await apiCall("POST", "/api/work", { kind: "start", id })).status).toBe(202);
  });
});
