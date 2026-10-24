// Opens the Netlify runtime on the Blobs store for this deploy's context (production or preview).

import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { blobKV } from "./kv";
import { netlifyRuntime, storeName, type NetlifyRuntime } from "./netlify";

/** The runtime for one player (empty for requests that don't need one, like polling a job or running it). */
export function runtimeFor(context: Context, player = ""): NetlifyRuntime {
  return netlifyRuntime(blobKV(getStore({ name: storeName(context.deploy?.context), consistency: "strong" })), player);
}
