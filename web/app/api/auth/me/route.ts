import type { RowDataPacket } from "mysql2/promise";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/contracts";
import { query } from "@/lib/db";
import { errors, toErrorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/auth/me  (any signed-in role) - account + role-specific profile. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const rows = await query<RowDataPacket[]>(
      `SELECT u.user_id, u.name, u.email, u.role, u.created_at,
              cd.location, cd.experience_years, cd.headline, cd.resume_url,
              r.company_id, r.designation, co.company_name
         FROM users u
         LEFT JOIN candidates cd ON cd.candidate_id = u.user_id
         LEFT JOIN recruiters r  ON r.recruiter_id = u.user_id
         LEFT JOIN companies co  ON co.company_id = r.company_id
        WHERE u.user_id = ?`,
      [session.userId],
    );
    const row = rows[0];
    if (!row) throw errors.unauthenticated();

    let profile: MeResponse["profile"];
    if (row.role === "Candidate") {
      profile = {
        kind: "Candidate",
        location: row.location,
        experienceYears: Number(row.experience_years ?? 0),
        headline: row.headline,
        hasResume: Boolean(row.resume_url),
      };
    } else if (row.role === "Recruiter") {
      profile = {
        kind: "Recruiter",
        companyId: row.company_id,
        companyName: row.company_name,
        designation: row.designation,
      };
    } else {
      profile = { kind: "Admin" };
    }

    return NextResponse.json<MeResponse>({
      user: {
        userId: row.user_id,
        name: row.name,
        email: row.email,
        role: row.role,
        createdAt: new Date(row.created_at).toISOString(),
      },
      profile,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
