import type { NextConfig } from "next";

// Database/JWT settings come from the repo-root `.env`, loaded at runtime
// by lib/env.ts -> lib/load-root-env.ts.

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Node-only database drivers stay as runtime requires on the server.
  serverExternalPackages: ["mysql2", "neo4j-driver"],
};

export default nextConfig;
