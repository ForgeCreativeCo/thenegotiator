// Every /api request on Netlify. Reads answer here; changes are queued as jobs for the "work" background function.

import type { Config, Context } from "@netlify/functions";
import { matchRoute, type Reply } from "../../server/api/routes";
import { runtimeFor } from "../../server/api/blobs";

export default async (req: Request, context: Context) => {
  let reply: Reply;
  try {
    const rt = runtimeFor(context);
    const { pathname } = new URL(req.url);
    const job = pathname.match(/^\/api\/jobs\/([^/]+)\/?$/);
    if (req.method === "GET" && job) reply = await rt.jobStatus(decodeURIComponent(job[1]));
    else {
      const match = matchRoute(req.method, pathname);
      const body = req.method === "POST" ? await req.json().catch(() => null) : null;
      reply = match ? await match.route.handle(rt, match.params, body) : { status: 404, body: { error: "Not found" } };
    }
  } catch (error) {
    console.error(error);
    reply = { status: 500, body: { error: (error as Error).message } };
  }
  return Response.json(reply.body, { status: reply.status });
};

export const config: Config = { path: "/api/*" };
