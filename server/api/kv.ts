// The small slice of a key-value store the Netlify runtime needs, so it can be tested without Netlify.

import type { Store as BlobStore } from "@netlify/blobs";

export type Metadata = Record<string, unknown>;

export interface KV {
  get<T>(key: string): Promise<{ value: T; etag: string } | null>;
  getMetadata(key: string): Promise<Metadata | null>;
  /** False when a condition (onlyIfNew / onlyIfMatch) stopped the write. */
  set(key: string, value: unknown, options?: { metadata?: Metadata; onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<boolean>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export function blobKV(store: BlobStore): KV {
  return {
    async get<T>(key: string) {
      const entry = await store.getWithMetadata(key, { type: "json" });
      return entry ? { value: entry.data as T, etag: entry.etag ?? "" } : null;
    },
    async getMetadata(key) {
      return (await store.getMetadata(key))?.metadata ?? null;
    },
    async set(key, value, options = {}) {
      const { metadata, onlyIfNew, onlyIfMatch } = options;
      const conditions = onlyIfNew ? { onlyIfNew: true as const } : onlyIfMatch ? { onlyIfMatch } : {};
      const result = await store.setJSON(key, value, { metadata, ...conditions });
      return result.modified;
    },
    async delete(key) {
      await store.delete(key);
    },
    async keys(prefix) {
      return (await store.list({ prefix })).blobs.map((b) => b.key);
    },
  };
}

/** In-memory KV with the same conditional-write behaviour, for tests. */
export class MemoryKV implements KV {
  private data = new Map<string, { value: string; etag: string; metadata: Metadata }>();
  private version = 0;

  async get<T>(key: string) {
    const entry = this.data.get(key);
    return entry ? { value: JSON.parse(entry.value) as T, etag: entry.etag } : null;
  }

  async getMetadata(key: string) {
    return this.data.get(key)?.metadata ?? null;
  }

  async set(key: string, value: unknown, options: { metadata?: Metadata; onlyIfNew?: boolean; onlyIfMatch?: string } = {}) {
    const existing = this.data.get(key);
    if (options.onlyIfNew && existing) return false;
    if (options.onlyIfMatch !== undefined && existing?.etag !== options.onlyIfMatch) return false;
    this.data.set(key, { value: JSON.stringify(value), etag: `"${++this.version}"`, metadata: options.metadata ?? {} });
    return true;
  }

  async delete(key: string) {
    this.data.delete(key);
  }

  async keys(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}
