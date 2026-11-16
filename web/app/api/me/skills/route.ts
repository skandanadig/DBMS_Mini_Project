import type { RowDataPacket } from "mysql2/promise";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { type CandidateSkill, CandidateSkillInput, type ProficiencyLevel } from "@/lib/contracts";
import { query } from "@/lib/db";
import { errors, readJson, toErrorResponse } from "@/lib/errors";
import { requestGraphSync } from "@/lib/sync-trigger";

export const dynamic = "force-dynamic";

async function listSkills(candidateId: number): Promise<CandidateSkill[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT s.skill_id, s.skill_name, s.category, cs.proficiency_level, cs.years_experience
       FROM candidate_skills cs JOIN skills s ON s.skill_id = cs.skill_id
      WHERE cs.candidate_id = ?
      ORDER BY FIELD(cs.proficiency_level, 'Expert', 'Advanced', 'Intermediate', 'Beginner'), s.skill_name`,
    [candidateId],
  );
  return rows.map((r) => ({
    skillId: r.skill_id,
    name: r.skill_name,
    category: r.category,
    proficiency: r.proficiency_level as ProficiencyLevel,
    years: Number(r.years_experience),
  }));
}

/** GET /api/me/skills (Candidate, self) */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req, ["Candidate"]);
    return NextResponse.json({ data: await listSkills(user.userId) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/**
 * POST /api/me/skills (Candidate, self) - add or update one skill (upsert).
 * An unknown skillId is rejected by the FK constraint (422 DB_RULE).
 * The outbox trigger records the change; Neo4j is updated in the background.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req, ["Candidate"]);
    const input = CandidateSkillInput.parse(await readJson(req));
    await query(
      `INSERT INTO candidate_skills (candidate_id, skill_id, proficiency_level, years_experience)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE proficiency_level = VALUES(proficiency_level), years_experience = VALUES(years_experience)`,
      [user.userId, input.skillId, input.proficiency, input.years],
    );
    requestGraphSync();
    return NextResponse.json({ data: await listSkills(user.userId) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** DELETE /api/me/skills?skillId=N (Candidate, self) */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth(req, ["Candidate"]);
    const skillId = Number(req.nextUrl.searchParams.get("skillId"));
    if (!Number.isInteger(skillId) || skillId <= 0) throw errors.validation("skillId query parameter is required.");

    const rows = await query<{ affectedRows: number }>(
      "DELETE FROM candidate_skills WHERE candidate_id = ? AND skill_id = ?",
      [user.userId, skillId],
    );
    if (rows.affectedRows === 0) throw errors.notFound("You do not have this skill.");
    requestGraphSync();
    return NextResponse.json({ data: await listSkills(user.userId) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
