import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import type { SkillOption } from "@/lib/contracts";
import { query } from "@/lib/db";
import { toErrorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/skills (public) - skill taxonomy for filters and forms. */
export async function GET() {
  try {
    const rows = await query<RowDataPacket[]>("SELECT skill_id, skill_name, category FROM skills ORDER BY category, skill_name");
    return NextResponse.json<SkillOption[]>(rows.map((r) => ({ skillId: r.skill_id, name: r.skill_name, category: r.category })));
  } catch (e) {
    return toErrorResponse(e);
  }
}
