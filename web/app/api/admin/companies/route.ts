import { type NextRequest, NextResponse } from "next/server";
import { listCompanies } from "@/lib/admin";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/admin/companies (Admin) - for the "create recruiter" form. */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    return NextResponse.json(await listCompanies());
  } catch (e) {
    return toErrorResponse(e);
  }
}
