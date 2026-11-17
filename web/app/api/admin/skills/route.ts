import { type NextRequest, NextResponse } from "next/server";
import { createSkill, listSkillsWithUsage } from "@/lib/admin";
import { requireAuth } from "@/lib/auth";
import { SkillUpsertInput } from "@/lib/contracts";
import { readJson, toErrorResponse } from "@/lib/errors";
import { requestGraphSync } from "@/lib/sync-trigger";

export const dynamic = "force-dynamic";

/** GET /api/admin/skills (Admin) - taxonomy with usage counts. */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    return NextResponse.json({ data: await listSkillsWithUsage() });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** POST /api/admin/skills (Admin) - new skill; duplicate name -> 409 (UNIQUE). Mirrored to Neo4j via the outbox. */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    const skillId = await createSkill(SkillUpsertInput.parse(await readJson(req)));
    requestGraphSync();
    return NextResponse.json({ skillId }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
