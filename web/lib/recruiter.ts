import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  type Applicant,
  type ApplicantsResponse,
  type ApplicationStatus,
  type JobInput,
  type JobStatus,
  NEXT_STATUSES,
  type RankingRow,
  type RecruiterDashboard,
  type SessionUser,
} from "./contracts";
import { query, withTransaction } from "./db";
import { errors } from "./errors";
import { rankCandidatesForJob } from "./graph-queries";
import { getRecruiterAnalytics } from "./procedures";

/** Recruiter data access (Member A). Ownership is checked by the routes (lib/authz.ts). */

const FUNNEL_STAGES: ApplicationStatus[] = ["APPLIED", "UNDER_REVIEW", "INTERVIEW_SCHEDULED", "OFFERED"];

export async function getDashboard(recruiterId: number): Promise<RecruiterDashboard> {
  const [companyRows, kpiRows, viewRows, reachedRows, analytics] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT c.company_id, c.company_name FROM recruiters r JOIN companies c ON c.company_id = r.company_id
        WHERE r.recruiter_id = ?`,
      [recruiterId],
    ),
    // KPIs aggregated over the vw_recruiter_pipeline view
    query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(job_status = 'OPEN'), 0) AS open_jobs,
              COALESCE(SUM(total_applicants), 0)    AS total_applicants,
              COALESCE(SUM(under_review_count), 0)  AS in_review,
              COALESCE(SUM(interview_count), 0)     AS interviews,
              COALESCE(SUM(offer_count), 0)         AS offers,
              COALESCE(ROUND(SUM(avg_match_score * total_applicants) / NULLIF(SUM(total_applicants), 0), 2), 0) AS avg_match
         FROM vw_recruiter_pipeline
        WHERE recruiter_id = ?`,
      [recruiterId],
    ),
    query<RowDataPacket[]>("SELECT job_id, posted_date FROM vw_recruiter_pipeline WHERE recruiter_id = ?", [recruiterId]),
    // Funnel = applications that ever REACHED each stage, read from the audit trail
    query<RowDataPacket[]>(
      `SELECT l.new_status AS stage, COUNT(DISTINCT l.application_id) AS reached
         FROM application_audit_logs l
         JOIN applications a ON a.application_id = l.application_id
         JOIN jobs j ON j.job_id = a.job_id
        WHERE j.recruiter_id = ?
        GROUP BY l.new_status`,
      [recruiterId],
    ),
    getRecruiterAnalytics(recruiterId), // stored procedure, two result sets
  ]);

  if (!companyRows[0]) throw errors.notFound("Recruiter profile not found.");
  const k = kpiRows[0];
  const posted = new Map(viewRows.map((r) => [r.job_id as number, new Date(r.posted_date).toISOString()]));
  const reached = new Map(reachedRows.map((r) => [r.stage as string, Number(r.reached)]));

  return {
    company: { companyId: companyRows[0].company_id, companyName: companyRows[0].company_name },
    kpis: {
      openJobs: Number(k.open_jobs),
      totalApplicants: Number(k.total_applicants),
      inReview: Number(k.in_review),
      interviews: Number(k.interviews),
      offers: Number(k.offers),
      avgMatchScore: Number(k.avg_match),
    },
    funnel: FUNNEL_STAGES.map((stage) => ({ stage, count: reached.get(stage) ?? 0 })),
    pipeline: analytics.funnel.map((r) => ({
      jobId: r.job_id,
      jobTitle: r.job_title,
      jobStatus: r.job_status as JobStatus,
      postedDate: posted.get(r.job_id) ?? "",
      daysOpen: Number(r.days_open),
      totalApplicants: Number(r.total_applicants),
      avgMatchScore: Number(r.avg_match_score),
      underReview: Number(r.under_review),
      interviews: Number(r.interviewing),
      offers: Number(r.offered),
      rejected: Number(r.rejected),
      offerRatePct: r.offer_rate_pct === null ? null : Number(r.offer_rate_pct),
    })),
    hardToFillSkills: analytics.hardToFillSkills.map((r) => ({
      jobId: r.job_id,
      jobTitle: r.job_title,
      skill: r.skill_name,
      requiredLevel: r.required_level,
      qualifiedCandidates: Number(r.qualified_candidates),
    })),
  };
}

// ---------------------------------------------------------------------------
// Job create / update (one transaction each; triggers write outbox events)
// ---------------------------------------------------------------------------
async function writeSkills(conn: PoolConnection, jobId: number, skills: JobInput["skills"]): Promise<void> {
  const keep = skills.map((s) => s.skillId);
  if (keep.length) {
    await conn.query("DELETE FROM job_skills WHERE job_id = ? AND skill_id NOT IN (?)", [jobId, keep]);
  } else {
    await conn.query("DELETE FROM job_skills WHERE job_id = ?", [jobId]);
  }
  for (const s of skills) {
    await conn.query(
      `INSERT INTO job_skills (job_id, skill_id, required_level, is_mandatory) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE required_level = VALUES(required_level), is_mandatory = VALUES(is_mandatory)`,
      [jobId, s.skillId, s.requiredLevel, s.mandatory],
    );
  }
}

/** The company is never supplied: it is derived from the recruiter (3NF). */
export async function createJob(recruiter: SessionUser, input: JobInput): Promise<number> {
  return withTransaction(async (conn) => {
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO jobs (recruiter_id, job_title, description, location, employment_type, salary_min, salary_max, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recruiter.userId,
        input.title,
        input.description,
        input.location,
        input.employmentType,
        input.salaryMin,
        input.salaryMax,
        input.status ?? "OPEN",
      ],
    );
    await writeSkills(conn, res.insertId, input.skills);
    return res.insertId;
  });
}

export async function updateJob(jobId: number, input: JobInput): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE jobs
          SET job_title = ?, description = ?, location = ?, employment_type = ?,
              salary_min = ?, salary_max = ?, status = COALESCE(?, status)
        WHERE job_id = ?`,
      [input.title, input.description, input.location, input.employmentType, input.salaryMin, input.salaryMax, input.status ?? null, jobId],
    );
    await writeSkills(conn, jobId, input.skills);
  });
}

// ---------------------------------------------------------------------------
// Applicants + SQL vs graph ranking
// ---------------------------------------------------------------------------
const TOP_N = 10;

/** Competition ranking (1, 2, 2, 4 ...) - same semantics as SQL RANK(). */
function competitionRanks<T>(rows: T[], score: (r: T) => number): Map<T, number> {
  const ranks = new Map<T, number>();
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    ranks.set(r, i > 0 && prev !== undefined && score(prev) === score(r) ? ranks.get(prev)! : i + 1);
  });
  return ranks;
}

export async function getApplicants(jobId: number): Promise<ApplicantsResponse> {
  const [jobRows, applicantRows, poolRows] = await Promise.all([
    query<RowDataPacket[]>("SELECT job_id, job_title, status FROM jobs WHERE job_id = ?", [jobId]),
    query<RowDataPacket[]>(
      `SELECT t.*, RANK() OVER (ORDER BY t.current_score DESC) AS sql_rank
         FROM (SELECT a.application_id, a.candidate_id, u.name, u.email, cd.location, cd.experience_years,
                      cd.resume_url, a.status, a.applied_date, a.match_score,
                      fn_match_score(a.candidate_id, a.job_id) AS current_score
                 FROM applications a
                 JOIN users u ON u.user_id = a.candidate_id
                 JOIN candidates cd ON cd.candidate_id = a.candidate_id
                WHERE a.job_id = ?) t
        ORDER BY sql_rank, t.applied_date`,
      [jobId],
    ),
    // Whole talent pool, SQL side: fn_match_score + RANK() window function
    query<RowDataPacket[]>(
      `SELECT t.candidate_id, u.name, cd.experience_years, t.score,
              RANK() OVER (ORDER BY t.score DESC) AS rnk,
              EXISTS (SELECT 1 FROM applications a WHERE a.job_id = ? AND a.candidate_id = t.candidate_id) AS has_applied
         FROM (SELECT candidate_id, fn_match_score(candidate_id, ?) AS score FROM candidates) t
         JOIN candidates cd ON cd.candidate_id = t.candidate_id
         JOIN users u ON u.user_id = t.candidate_id
        ORDER BY rnk, cd.experience_years DESC`,
      [jobId, jobId],
    ),
  ]);
  const job = jobRows[0];
  if (!job) throw errors.notFound("Job not found.");

  const applicants: Applicant[] = applicantRows.map((r) => ({
    applicationId: r.application_id,
    candidateId: r.candidate_id,
    name: r.name,
    email: r.email,
    location: r.location,
    experienceYears: Number(r.experience_years),
    status: r.status as ApplicationStatus,
    appliedDate: new Date(r.applied_date).toISOString(),
    scoreAtApply: Number(r.match_score),
    currentScore: Number(r.current_score),
    sqlRank: Number(r.sql_rank),
    resumeUrl: r.resume_url,
    nextStatuses: NEXT_STATUSES[r.status as ApplicationStatus],
  }));

  // Graph side (Neo4j) - optional, eventually consistent
  let graph: Awaited<ReturnType<typeof rankCandidatesForJob>> = [];
  let graphAvailable = true;
  try {
    graph = await rankCandidatesForJob(jobId);
  } catch (e) {
    graphAvailable = false;
    console.warn("[applicants] Neo4j unavailable:", e instanceof Error ? e.message : e);
  }
  const graphRanks = competitionRanks(graph, (g) => g.graphScore);
  const graphById = new Map(graph.map((g) => [g.candidateId, { score: g.graphScore, rank: graphRanks.get(g)! }]));

  const sqlTop = new Set(poolRows.slice(0, TOP_N).map((r) => r.candidate_id as number));
  const graphTop = new Set(graph.slice(0, TOP_N).map((g) => g.candidateId));
  const ids = new Set([...sqlTop, ...graphTop]);

  const rows: RankingRow[] = poolRows
    .filter((r) => ids.has(r.candidate_id))
    .map((r) => {
      const g = graphById.get(r.candidate_id);
      const sqlRank = Number(r.rnk);
      return {
        candidateId: r.candidate_id,
        name: r.name,
        experienceYears: Number(r.experience_years),
        sqlScore: Number(r.score),
        sqlRank,
        graphScore: g?.score ?? null,
        graphRank: g?.rank ?? null,
        rankChange: g ? sqlRank - g.rank : null,
        hasApplied: Boolean(r.has_applied),
      };
    })
    .sort((a, b) => (a.graphRank ?? Infinity) - (b.graphRank ?? Infinity) || a.sqlRank - b.sqlRank);

  return {
    job: { jobId: job.job_id, title: job.job_title, status: job.status as JobStatus },
    applicants,
    ranking: {
      graphAvailable,
      rows,
      topN: TOP_N,
      overlap: [...sqlTop].filter((id) => graphTop.has(id)).length,
    },
  };
}
