import type { RowDataPacket } from "mysql2/promise";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import type { ApplicationStatus, CandidateApplication, JobStatus } from "@/lib/contracts";
import { query } from "@/lib/db";
import { toErrorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/me/applications (Candidate, self) - vw_candidate_applications + audit trail. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req, ["Candidate"]);

    const [apps, logs] = await Promise.all([
      query<RowDataPacket[]>(
        `SELECT application_id, job_id, job_title, company_name, job_location, job_status,
                application_status, match_score, applied_date
           FROM vw_candidate_applications
          WHERE candidate_id = ?
          ORDER BY applied_date DESC`,
        [user.userId],
      ),
      query<RowDataPacket[]>(
        `SELECT l.application_id, l.old_status, l.new_status, l.changed_at, l.remarks, u.name AS changed_by
           FROM application_audit_logs l
           JOIN applications a ON a.application_id = l.application_id
           LEFT JOIN users u ON u.user_id = l.changed_by
          WHERE a.candidate_id = ?
          ORDER BY l.log_id`,
        [user.userId],
      ),
    ]);

    const data: CandidateApplication[] = apps.map((a) => ({
      applicationId: a.application_id,
      jobId: a.job_id,
      jobTitle: a.job_title,
      companyName: a.company_name,
      jobLocation: a.job_location,
      jobStatus: a.job_status as JobStatus,
      status: a.application_status as ApplicationStatus,
      matchScore: Number(a.match_score),
      appliedDate: new Date(a.applied_date).toISOString(),
      timeline: logs
        .filter((l) => l.application_id === a.application_id)
        .map((l) => ({
          oldStatus: l.old_status,
          newStatus: l.new_status,
          changedAt: new Date(l.changed_at).toISOString(),
          changedBy: l.changed_by,
          remarks: l.remarks,
        })),
    }));

    return NextResponse.json({ data });
  } catch (e) {
    return toErrorResponse(e);
  }
}
