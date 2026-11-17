import { type NextRequest, NextResponse } from "next/server";
import { listOutbox } from "@/lib/admin";
import { requireAuth } from "@/lib/auth";
import { OutboxQuery } from "@/lib/contracts";
import { toErrorResponse } from "@/lib/errors";
import { outboxStats } from "@/lib/graph-sync";

export const dynamic = "force-dynamic";

/** GET /api/admin/outbox?status=&page= (Admin) - MySQL -> Neo4j event queue with per-status counts. */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const [page, stats] = await Promise.all([listOutbox(OutboxQuery.parse(raw)), outboxStats()]);
    return NextResponse.json({ ...page, stats });
  } catch (e) {
    return toErrorResponse(e);
  }
}
