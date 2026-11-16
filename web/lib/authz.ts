import type { RowDataPacket } from "mysql2/promise";
import type { SessionUser } from "./contracts";
import { query } from "./db";
import { errors } from "./errors";

/**
 * Ownership checks (docs/CONTRACTS.md section 1). Each one does a fresh
 * MySQL lookup on every call. Admins pass every ownership check.
 * The stored procedure sp_update_application_status repeats the recruiter
 * ownership check inside MySQL (defence in depth).
 */

export async function assertRecruiterOwnsJob(user: SessionUser, jobId: number): Promise<void> {
  if (user.role === "Admin") return;
  if (user.role !== "Recruiter") throw errors.forbidden("Only recruiters can manage job postings.");

  const rows = await query<RowDataPacket[]>("SELECT recruiter_id FROM jobs WHERE job_id = ?", [jobId]);
  if (rows.length === 0) throw errors.notFound("Job not found.");
  if (rows[0].recruiter_id !== user.userId) throw errors.forbidden("You can only manage your own job postings.");
}

export async function assertRecruiterOwnsApplication(user: SessionUser, applicationId: number): Promise<void> {
  if (user.role === "Admin") return;
  if (user.role !== "Recruiter") throw errors.forbidden("Only recruiters can review applications.");

  const rows = await query<RowDataPacket[]>(
    `SELECT j.recruiter_id
       FROM applications a
       JOIN jobs j ON j.job_id = a.job_id
      WHERE a.application_id = ?`,
    [applicationId],
  );
  if (rows.length === 0) throw errors.notFound("Application not found.");
  if (rows[0].recruiter_id !== user.userId) {
    throw errors.forbidden("You can only review applications for your own job postings.");
  }
}

export function assertCandidateSelf(user: SessionUser, candidateId: number): void {
  if (user.role === "Admin") return;
  if (user.role !== "Candidate" || user.userId !== candidateId) {
    throw errors.forbidden("You can only access your own candidate profile.");
  }
}
