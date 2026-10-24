// Every /api request on Netlify. Reads answer here; changes are queued as jobs for the "work" background function.

import type { Config, Context } from "@netlify/functions";
import { NEEDS_NAME, PLAYER_HEADER, matchRoute, playerKey, type Reply } from "../../server/api/routes";
import { runtimeFor } from "../../server/api/blobs";

export default async (req: Request, context: Context) => {
  let reply: Reply;
  try {
    const player = playerKey(req.headers.get(PLAYER_HEADER));
    const rt = runtimeFor(context, player ?? "");
    const { pathname } = new URL(req.url);
    const job = pathname.match(/^\/api\/jobs\/([^/]+)\/?$/);
    if (req.method === "GET" && job) reply = await rt.jobStatus(decodeURIComponent(job[1]));
    else {
      const match = matchRoute(req.method, pathname);
      const body = req.method === "POST" ? await req.json().catch(() => null) : null;
      if (!match) reply = { status: 404, body: { error: "Not found" } };
      else if (!player && !match.route.public) reply = NEEDS_NAME;
      else reply = await match.route.handle(rt, match.params, body);
    }
  } catch (error) {
    console.error(error);
    reply = { status: 500, body: { error: (error as Error).message } };
  }
  return Response.json(reply.body, { status: reply.status });
};

export const config: Config = { path: "/api/*" };
