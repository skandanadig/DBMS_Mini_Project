import { type NextRequest, NextResponse } from "next/server";
import { updateSkill } from "@/lib/admin";
import { requireAuth } from "@/lib/auth";
import { SkillUpsertInput } from "@/lib/contracts";
import { readJson, toErrorResponse } from "@/lib/errors";
import { parseId } from "@/lib/jobs";
import { requestGraphSync } from "@/lib/sync-trigger";

/** PUT /api/admin/skills/:id (Admin) - rename / re-categorise; the change reaches Neo4j via the outbox. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req, ["Admin"]);
    const skillId = parseId((await params).id);
    await updateSkill(skillId, SkillUpsertInput.parse(await readJson(req)));
    requestGraphSync();
    return NextResponse.json({ skillId });
  } catch (e) {
    return toErrorResponse(e);
  }
}
