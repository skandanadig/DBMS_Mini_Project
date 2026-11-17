import { type NextRequest, NextResponse } from "next/server";
import { retryOutboxEvents } from "@/lib/admin";
import { requireAuth } from "@/lib/auth";
import { OutboxRetryInput } from "@/lib/contracts";
import { readJson, toErrorResponse } from "@/lib/errors";
import { requestGraphSync } from "@/lib/sync-trigger";

/** POST /api/admin/outbox/retry {eventIds} (Admin) - FAILED -> PENDING with a fresh attempt budget, then sync. */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    const { eventIds } = OutboxRetryInput.parse(await readJson(req));
    const retried = await retryOutboxEvents(eventIds);
    if (retried > 0) requestGraphSync();
    return NextResponse.json({ retried });
  } catch (e) {
    return toErrorResponse(e);
  }
}
