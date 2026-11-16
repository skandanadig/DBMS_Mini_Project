import { processOutbox } from "./graph-sync";

/**
 * Fire-and-forget graph sync for API routes that change mirrored data
 * (candidate skills, jobs, job skills ...). Call it AFTER the MySQL
 * transaction has committed; it never delays or fails the HTTP response.
 * At most one run is in flight per server process; requests that arrive
 * during a run schedule exactly one follow-up run. Across processes the
 * MySQL advisory lock in processOutbox() keeps a single consumer.
 */
const state = globalThis as unknown as { __smSyncRunning?: Promise<void>; __smSyncAgain?: boolean };

export function requestGraphSync(): void {
  if (state.__smSyncRunning) {
    state.__smSyncAgain = true;
    return;
  }
  state.__smSyncRunning = processOutbox()
    .then(() => undefined)
    .catch((e: unknown) => console.error("[graph-sync] background run failed:", e))
    .finally(() => {
      state.__smSyncRunning = undefined;
      if (state.__smSyncAgain) {
        state.__smSyncAgain = false;
        requestGraphSync();
      }
    });
}

/** For tests / graceful shutdown: wait for the in-flight run, if any. */
export async function waitForGraphSync(): Promise<void> {
  while (state.__smSyncRunning) await state.__smSyncRunning;
}
