import { type NextRequest, NextResponse } from "next/server";
import { listAuditLogs } from "@/lib/admin";
import { requireAuth } from "@/lib/auth";
import { AuditLogQuery } from "@/lib/contracts";
import { toErrorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/admin/audit-logs?status=&q=&page= (Admin) - trigger-written status history, newest first. */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    return NextResponse.json(await listAuditLogs(AuditLogQuery.parse(raw)));
  } catch (e) {
    return toErrorResponse(e);
  }
}
