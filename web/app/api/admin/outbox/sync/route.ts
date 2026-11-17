import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import type { OutboxSyncResponse } from "@/lib/contracts";
import { toErrorResponse } from "@/lib/errors";
import { processOutbox, verifyGraph } from "@/lib/graph-sync";
import { waitForGraphSync } from "@/lib/sync-trigger";

/**
 * POST /api/admin/outbox/sync (Admin) - run the worker now, then compare
 * every mirrored node/relationship in Neo4j with MySQL.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    await waitForGraphSync(); // let an in-flight background run finish first
    const r = await processOutbox();
    const v = await verifyGraph();
    return NextResponse.json<OutboxSyncResponse>({
      sync: {
        lockAcquired: r.lockAcquired,
        applied: r.applied,
        skipped: r.skipped,
        failed: r.failed,
        remainingPending: r.remainingPending,
        ...(r.blockedAt ? { blockedAt: { eventId: r.blockedAt.eventId, error: r.blockedAt.error } } : {}),
      },
      verify: { ...v, missingInGraph: v.missingInGraph.slice(0, 20), extraInGraph: v.extraInGraph.slice(0, 20) },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
