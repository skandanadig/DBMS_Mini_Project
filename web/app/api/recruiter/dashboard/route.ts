import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import type { RecruiterDashboard } from "@/lib/contracts";
import { toErrorResponse } from "@/lib/errors";
import { getDashboard } from "@/lib/recruiter";

export const dynamic = "force-dynamic";

/** GET /api/recruiter/dashboard (Recruiter, own jobs only) - views + sp_get_recruiter_analytics. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req, ["Recruiter"]);
    return NextResponse.json<RecruiterDashboard>(await getDashboard(user.userId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
