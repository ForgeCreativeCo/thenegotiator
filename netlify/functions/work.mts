// Background function: runs one queued job (a turn, a scenario, the mentor or the debrief) for up to 15 minutes.
// The browser starts it at /.netlify/functions/work with { jobId } and polls /api/jobs/:id for the result.

import type { Config, Context } from "@netlify/functions";
import { runtimeFor } from "../../server/api/blobs";

export default async (req: Request, context: Context) => {
  const { jobId } = ((await req.json().catch(() => null)) ?? {}) as { jobId?: unknown };
  if (typeof jobId === "string") await runtimeFor(context).runJob(jobId);
};

export const config: Config = { background: true };
