import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import type {
  ApplicationStatus,
  EmploymentType,
  JobDetail,
  JobListResponse,
  JobSearchQuery,
  JobSkill,
  JobStatus,
  JobSummary,
  ProficiencyLevel,
  SessionUser,
  SkillState,
} from "./contracts";
import { query } from "./db";
import { errors } from "./errors";
import { SESSION_COOKIE, verifySession } from "./session";

/**
 * Job-board data access (Member B). Parameterised SQL only; ORDER BY comes
 * from a whitelist, never from user input.
 */

/** Route segment id -> positive integer, otherwise 404. */
export function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw errors.notFound();
  return n;
}

/**
 * Public routes show extra, personal data (own match score / application)
 * when a Candidate is signed in. A token is enough here: the data shown is
 * only ever the token owner's own. Protected routes use requireAuth().
 */
export async function optionalCandidate(req: NextRequest): Promise<SessionUser | null> {
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return s?.role === "Candidate" ? s : null;
}

/**
 * User text -> safe BOOLEAN MODE expression: keep letters/digits, prefix-match
 * each term ("kube" finds "kubernetes"). Operators typed by the user (+ - " *
 * ~ < > ( )) are stripped, so they cannot change the query semantics.
 * InnoDB ignores tokens shorter than 3 characters.
 */
export function toFulltextQuery(q: string | undefined): string | null {
  if (!q) return null;
  const terms = q
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  return terms.length ? terms.map((t) => `${t}*`).join(" ") : null;
}

const ORDER_BY = {
  relevance: "relevance DESC, j.posted_date DESC",
  newest: "j.posted_date DESC",
  salary: "j.salary_max DESC, j.posted_date DESC",
  match: "match_score DESC, j.posted_date DESC",
} as const;

async function skillsForJobs(jobIds: number[]): Promise<Map<number, JobSkill[]>> {
  const map = new Map<number, JobSkill[]>();
  if (jobIds.length === 0) return map;
  const rows = await query<RowDataPacket[]>(
    `SELECT js.job_id, s.skill_id, s.skill_name, js.required_level, js.is_mandatory
       FROM job_skills js JOIN skills s ON s.skill_id = js.skill_id
      WHERE js.job_id IN (?)
      ORDER BY js.is_mandatory DESC, s.skill_name`,
    [jobIds],
  );
  for (const r of rows) {
    const list = map.get(r.job_id) ?? [];
    list.push({ skillId: r.skill_id, name: r.skill_name, requiredLevel: r.required_level, mandatory: Boolean(r.is_mandatory) });
    map.set(r.job_id, list);
  }
  return map;
}

function toSummary(r: RowDataPacket, skills: Map<number, JobSkill[]>): JobSummary {
  return {
    jobId: r.job_id,
    title: r.job_title,
    companyName: r.company_name,
    industry: r.industry,
    location: r.location,
    employmentType: r.employment_type as EmploymentType,
    salaryMin: Number(r.salary_min),
    salaryMax: Number(r.salary_max),
    postedDate: new Date(r.posted_date).toISOString(),
    applicantCount: Number(r.applicant_count),
    skills: skills.get(r.job_id) ?? [],
    ...(r.relevance !== undefined && r.relevance !== null ? { relevance: Number(Number(r.relevance).toFixed(4)) } : {}),
    ...(r.match_score !== undefined && r.match_score !== null ? { matchScore: Number(r.match_score) } : {}),
  };
}

/** OPEN jobs with FULLTEXT search, filters, sorting and pagination. */
export async function searchJobs(params: JobSearchQuery, candidateId: number | null): Promise<JobListResponse> {
  const where: string[] = ["j.status = 'OPEN'"];
  const whereParams: unknown[] = [];
  const ft = toFulltextQuery(params.q);

  if (ft) {
    where.push("MATCH(j.job_title, j.description) AGAINST (? IN BOOLEAN MODE)");
    whereParams.push(ft);
  }
  if (params.location) {
    where.push("j.location = ?");
    whereParams.push(params.location);
  }
  if (params.type) {
    where.push("j.employment_type = ?");
    whereParams.push(params.type);
  }
  if (params.minSalary !== undefined) {
    where.push("j.salary_max >= ?");
    whereParams.push(params.minSalary);
  }
  if (params.skillId) {
    where.push("EXISTS (SELECT 1 FROM job_skills fs WHERE fs.job_id = j.job_id AND fs.skill_id = ?)");
    whereParams.push(params.skillId);
  }

  const sort = params.sort ?? (ft ? "relevance" : candidateId ? "match" : "newest");
  const effectiveSort = sort === "relevance" && !ft ? "newest" : sort === "match" && !candidateId ? "newest" : sort;

  const selectParams: unknown[] = [];
  let extraCols = "";
  if (ft) {
    extraCols += ", MATCH(j.job_title, j.description) AGAINST (? IN BOOLEAN MODE) AS relevance";
    selectParams.push(ft);
  }
  if (candidateId) {
    extraCols += ", fn_match_score(?, j.job_id) AS match_score";
    selectParams.push(candidateId);
  }

  const from = `FROM jobs j
    JOIN recruiters r ON r.recruiter_id = j.recruiter_id
    JOIN companies c ON c.company_id = r.company_id
    WHERE ${where.join(" AND ")}`;

  const offset = (params.page - 1) * params.pageSize;
  const [rows, totalRows, facetRows] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT j.job_id, j.job_title, j.location, j.employment_type, j.salary_min, j.salary_max, j.posted_date,
              c.company_name, c.industry,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.job_id) AS applicant_count
              ${extraCols}
         ${from}
        ORDER BY ${ORDER_BY[effectiveSort]}
        LIMIT ? OFFSET ?`,
      [...selectParams, ...whereParams, params.pageSize, offset],
    ),
    query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${from}`, whereParams),
    query<RowDataPacket[]>(
      `SELECT 'location' AS kind, location AS value FROM jobs WHERE status = 'OPEN'
       UNION SELECT 'type', employment_type FROM jobs WHERE status = 'OPEN'
       ORDER BY kind, value`,
    ),
  ]);

  const skills = await skillsForJobs(rows.map((r) => r.job_id as number));
  return {
    data: rows.map((r) => toSummary(r, skills)),
    page: params.page,
    pageSize: params.pageSize,
    total: Number(totalRows[0].n),
    facets: {
      locations: facetRows.filter((f) => f.kind === "location").map((f) => f.value as string),
      employmentTypes: facetRows.filter((f) => f.kind === "type").map((f) => f.value as string),
    },
  };
}

/** Any job (any status) by id; personal fields for a signed-in candidate. */
export async function getJobDetail(jobId: number, candidateId: number | null): Promise<JobDetail> {
  const rows = await query<RowDataPacket[]>(
    `SELECT v.job_id, v.job_title, v.description, v.location, v.employment_type, v.salary_min, v.salary_max,
            v.posted_date, v.status, v.recruiter_name, v.company_name, v.industry, v.applicant_count
            ${candidateId ? ", fn_match_score(?, v.job_id) AS match_score" : ""}
       FROM vw_job_listings v
      WHERE v.job_id = ?`,
    candidateId ? [candidateId, jobId] : [jobId],
  );
  const row = rows[0];
  if (!row) throw errors.notFound("Job not found.");

  const skills = await skillsForJobs([jobId]);
  let application: JobDetail["application"];
  if (candidateId) {
    const apps = await query<RowDataPacket[]>(
      "SELECT application_id, status, applied_date FROM applications WHERE job_id = ? AND candidate_id = ?",
      [jobId, candidateId],
    );
    application = apps[0]
      ? {
          applicationId: apps[0].application_id,
          status: apps[0].status as ApplicationStatus,
          appliedDate: new Date(apps[0].applied_date).toISOString(),
        }
      : null;
  }

  return {
    ...toSummary(row, skills),
    description: row.description,
    status: row.status as JobStatus,
    recruiterName: row.recruiter_name,
    ...(candidateId ? { application } : {}),
  };
}

const LEVEL: Record<ProficiencyLevel, number> = { Beginner: 1, Intermediate: 2, Advanced: 3, Expert: 4 };

/** Per-skill comparison + MySQL fn_match_score for one candidate and job. */
export async function skillBreakdown(candidateId: number, jobId: number) {
  const [rows, score] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT s.skill_id, s.skill_name, js.required_level, js.is_mandatory, cs.proficiency_level
         FROM job_skills js
         JOIN skills s ON s.skill_id = js.skill_id
         LEFT JOIN candidate_skills cs ON cs.skill_id = js.skill_id AND cs.candidate_id = ?
        WHERE js.job_id = ?
        ORDER BY js.is_mandatory DESC, s.skill_name`,
      [candidateId, jobId],
    ),
    query<RowDataPacket[]>("SELECT fn_match_score(?, ?) AS score", [candidateId, jobId]),
  ]);
  const skills = rows.map((r) => {
    const candidateLevel = (r.proficiency_level ?? null) as ProficiencyLevel | null;
    const required = r.required_level as ProficiencyLevel;
    const state: SkillState = !candidateLevel ? "MISSING" : LEVEL[candidateLevel] >= LEVEL[required] ? "MET" : "BELOW_LEVEL";
    return {
      skillId: r.skill_id as number,
      name: r.skill_name as string,
      requiredLevel: required,
      mandatory: Boolean(r.is_mandatory),
      candidateLevel,
      state,
    };
  });
  return { exactScore: Number(score[0].score), skills };
}
