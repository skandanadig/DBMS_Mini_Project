import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Load the repo-root `.env` (the same file docker compose uses) into
 * process.env. Variables that are already set (CI, shell exports) are never
 * overridden.
 *
 * Called lazily from lib/env.ts, i.e. in the process that serves requests,
 * so `next dev`, `next start` and vitest all use the same code path.
 * (Loading it from next.config.ts via @next/env did not reach the route
 * handlers under `next start`.) The app and tests run from `web/`.
 */
export function loadRootEnv(): void {
  const file = path.resolve(process.cwd(), "..", ".env");
  if (!existsSync(file)) return;
  const parsed = parseEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
}
