// Local dev runtime: one long-lived process, so work runs inline and the lock is an in-memory set.

import { busyMessage, checkWork, executeWork, lockKey, type Locks, type Reply, type Runtime, type Store, type WorkRequest } from "./routes";

export class MemoryLocks implements Locks {
  private held = new Set<string>();

  claim(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }

  release(key: string): void {
    this.held.delete(key);
  }

  async isLocked(key: string): Promise<boolean> {
    return this.held.has(key);
  }

  async anyLocked(): Promise<boolean> {
    return this.held.size > 0;
  }
}

export function localRuntime(store: Store): Runtime {
  const locks = new MemoryLocks();
  return {
    store,
    locks,
    async submit(work: WorkRequest): Promise<Reply> {
      const refused = await checkWork(store, work);
      if (refused) return refused;
      const key = lockKey(work);
      if (key && !locks.claim(key)) return { status: 409, body: { error: busyMessage(work) } };
      try {
        return await executeWork(store, work);
      } finally {
        if (key) locks.release(key);
      }
    },
  };
}
