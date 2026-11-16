import neo4j, { type Driver } from "neo4j-driver";
import { env } from "./env";

/**
 * Neo4j connection (created in Phase 3 for the health check).
 * Graph queries live in lib/graph-queries.ts (Member B, Phase 4+).
 * One driver per server process; the driver manages its own session pool.
 */
const globalForNeo4j = globalThis as unknown as { __skillmatchNeo4j?: Driver };

export function getDriver(): Driver {
  if (!globalForNeo4j.__skillmatchNeo4j) {
    const e = env();
    globalForNeo4j.__skillmatchNeo4j = neo4j.driver(e.NEO4J_URI, neo4j.auth.basic(e.NEO4J_USER, e.NEO4J_PASSWORD), {
      disableLosslessIntegers: true, // return JS numbers for ids/counts
      connectionTimeout: 5_000,
    });
  }
  return globalForNeo4j.__skillmatchNeo4j;
}

export async function closeDriver(): Promise<void> {
  if (globalForNeo4j.__skillmatchNeo4j) {
    await globalForNeo4j.__skillmatchNeo4j.close();
    globalForNeo4j.__skillmatchNeo4j = undefined;
  }
}
