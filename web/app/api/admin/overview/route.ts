import { type NextRequest, NextResponse } from "next/server";
import { getOverview } from "@/lib/admin";
import { requireAuth } from "@/lib/auth";
import type { AdminOverview } from "@/lib/contracts";
import { toErrorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/admin/overview (Admin) - platform counts, top demanded skills (view), outbox health. */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    return NextResponse.json<AdminOverview>(await getOverview());
  } catch (e) {
    return toErrorResponse(e);
  }
}
