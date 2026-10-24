// Opens the Netlify runtime on the Blobs store for this deploy's context (production or preview).

import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { blobKV } from "./kv";
import { netlifyRuntime, storeName, type NetlifyRuntime } from "./netlify";

export function runtimeFor(context: Context): NetlifyRuntime {
  return netlifyRuntime(blobKV(getStore({ name: storeName(context.deploy?.context), consistency: "strong" })));
}
