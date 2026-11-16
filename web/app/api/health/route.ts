import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getDriver } from "@/lib/neo4j";

export const dynamic = "force-dynamic";

interface Check {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

async function timed(fn: () => Promise<unknown>): Promise<Check> {
  const start = performance.now();
  try {
    await fn();
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message.split("\n")[0] : "unreachable",
    };
  }
}

/** GET /api/health (public) - connectivity of both databases. 503 if either is down. */
export async function GET() {
  const [mysql, neo4j] = await Promise.all([
    timed(() => query("SELECT 1")),
    timed(() => getDriver().verifyConnectivity()),
  ]);
  const ok = mysql.ok && neo4j.ok;
  return NextResponse.json({ status: ok ? "ok" : "degraded", mysql, neo4j }, { status: ok ? 200 : 503 });
}
