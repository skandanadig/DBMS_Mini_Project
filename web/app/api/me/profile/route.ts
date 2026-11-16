import type { RowDataPacket } from "mysql2/promise";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { type CandidateProfile, ProfileInput } from "@/lib/contracts";
import { query, withTransaction } from "@/lib/db";
import { errors, readJson, toErrorResponse } from "@/lib/errors";
import { requestGraphSync } from "@/lib/sync-trigger";

export const dynamic = "force-dynamic";

async function loadProfile(candidateId: number): Promise<CandidateProfile> {
  const rows = await query<RowDataPacket[]>(
    `SELECT u.user_id, u.name, u.email, cd.phone, cd.location, cd.experience_years, cd.resume_url, cd.headline, cd.bio
       FROM users u JOIN candidates cd ON cd.candidate_id = u.user_id
      WHERE u.user_id = ?`,
    [candidateId],
  );
  const r = rows[0];
  if (!r) throw errors.notFound("Candidate profile not found.");
  return {
    candidateId: r.user_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    location: r.location,
    experienceYears: Number(r.experience_years),
    resumeUrl: r.resume_url,
    headline: r.headline,
    bio: r.bio,
  };
}

/** GET /api/me/profile (Candidate, self) */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req, ["Candidate"]);
    return NextResponse.json(await loadProfile(user.userId));
  } catch (e) {
    return toErrorResponse(e);
  }
}

const blankToNull = (v: string | null | undefined) => (v === undefined || v === null || v === "" ? null : v);

/**
 * PUT /api/me/profile (Candidate, self)
 * users.name and the candidates row are updated in ONE transaction.
 * Format rules are enforced by MySQL CHECK constraints (phone pattern,
 * resume URL, 0-60 years); a violation rolls back both updates and is
 * returned as 422 DB_RULE with the constraint name.
 */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth(req, ["Candidate"]);
    const input = ProfileInput.parse(await readJson(req));

    await withTransaction(async (conn) => {
      await conn.query("UPDATE users SET name = ? WHERE user_id = ?", [input.name, user.userId]);
      await conn.query(
        `UPDATE candidates
            SET phone = ?, location = ?, experience_years = ?, resume_url = ?, headline = ?, bio = ?
          WHERE candidate_id = ?`,
        [
          blankToNull(input.phone),
          blankToNull(input.location),
          input.experienceYears,
          blankToNull(input.resumeUrl),
          blankToNull(input.headline),
          blankToNull(input.bio),
          user.userId,
        ],
      );
    });
    requestGraphSync(); // name / location / experience are mirrored in Neo4j

    return NextResponse.json(await loadProfile(user.userId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
