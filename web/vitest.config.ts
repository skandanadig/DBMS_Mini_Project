import path from "node:path";
import { defineConfig } from "vitest/config";
// The repo-root `.env` is loaded by lib/env.ts, exactly as in the app.

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one MySQL database: run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
