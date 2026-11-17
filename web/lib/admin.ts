import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { hashPassword } from "./auth";
import type {
  AdminCreateUserInput,
  AdminOverview,
  AdminSkillRow,
  AdminUserRow,
  ApplicationStatus,
  AuditLogRow,
  JobStatus,
  OutboxRow,
  Paged,
  PublicUser,
  Role,
  SkillUpsertInput,
} from "./contracts";
import { query, withTransaction } from "./db";
import { errors } from "./errors";

/** Admin data access (Member B). Every caller has passed requireAuth(req, ["Admin"]). */

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function listUsers(p: { role?: Role; q?: string; page: number; pageSize: number }): Promise<Paged<AdminUserRow>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (p.role) {
    where.push("u.role = ?");
    params.push(p.role);
  }
  if (p.q) {
    where.push("(u.name LIKE ? OR u.email LIKE ?)");
    params.push(`%${p.q}%`, `%${p.q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, total] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT u.user_id, u.name, u.email, u.role, u.created_at, c.company_name, r.designation,
              CASE u.role
                WHEN 'Candidate' THEN (SELECT COUNT(*) FROM applications a WHERE a.candidate_id = u.user_id)
                WHEN 'Recruiter' THEN (SELECT COUNT(*) FROM jobs j WHERE j.recruiter_id = u.user_id)
                ELSE 0 END AS activity
         FROM users u
         LEFT JOIN recruiters r ON r.recruiter_id = u.user_id
         LEFT JOIN companies c ON c.company_id = r.company_id
         ${whereSql}
        ORDER BY FIELD(u.role, 'Admin', 'Recruiter', 'Candidate'), u.name
        LIMIT ? OFFSET ?`,
      [...params, p.pageSize, (p.page - 1) * p.pageSize],
    ),
    query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM users u ${whereSql}`, params),
  ]);

  return {
    data: rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      role: r.role as Role,
      createdAt: new Date(r.created_at).toISOString(),
      companyName: r.company_name,
      designation: r.designation,
      activity: Number(r.activity),
    })),
    page: p.page,
    pageSize: p.pageSize,
    total: Number(total[0].n),
  };
}

/**
 * The ONLY way Recruiter/Admin accounts come into existence. users + the
 * recruiters subtype row are written in one transaction; MySQL triggers
 * verify the subtype matches the role, the FK verifies the company.
 */
export async function createPrivilegedUser(input: AdminCreateUserInput): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  const userId = await withTransaction(async (conn) => {
    const [res] = await conn.query<ResultSetHeader>(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [input.name, input.email, passwordHash, input.role],
    );
    if (input.role === "Recruiter") {
      await conn.query("INSERT INTO recruiters (recruiter_id, company_id, designation) VALUES (?, ?, ?)", [
        res.insertId,
        input.companyId,
        input.designation,
      ]);
    }
    return res.insertId;
  });
  return { userId, name: input.name, email: input.email, role: input.role };
}

export async function listCompanies(): Promise<Array<{ companyId: number; companyName: string; industry: string }>> {
  const rows = await query<RowDataPacket[]>("SELECT company_id, company_name, industry FROM companies ORDER BY company_name");
  return rows.map((r) => ({ companyId: r.company_id, companyName: r.company_name, industry: r.industry }));
}

// ---------------------------------------------------------------------------
// Skills taxonomy (changes flow to Neo4j through the skills outbox triggers)
// ---------------------------------------------------------------------------
export async function listSkillsWithUsage(): Promise<AdminSkillRow[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT s.skill_id, s.skill_name, s.category,
            (SELECT COUNT(*) FROM candidate_skills cs WHERE cs.skill_id = s.skill_id) AS candidates,
            (SELECT COUNT(*) FROM job_skills js WHERE js.skill_id = s.skill_id) AS jobs,
            COALESCE(d.demanding_jobs_count, 0) AS open_jobs
       FROM skills s
       LEFT JOIN vw_top_demanded_skills d ON d.skill_id = s.skill_id
      ORDER BY s.category, s.skill_name`,
  );
  return rows.map((r) => ({
    skillId: r.skill_id,
    name: r.skill_name,
    category: r.category,
    candidates: Number(r.candidates),
    jobs: Number(r.jobs),
    openJobs: Number(r.open_jobs),
  }));
}

export async function createSkill(input: SkillUpsertInput): Promise<number> {
  const res = await query<ResultSetHeader>("INSERT INTO skills (skill_name, category) VALUES (?, ?)", [input.skillName, input.category]);
  return res.insertId;
}

export async function updateSkill(skillId: number, input: SkillUpsertInput): Promise<void> {
  const res = await query<ResultSetHeader>("UPDATE skills SET skill_name = ?, category = ? WHERE skill_id = ?", [
    input.skillName,
    input.category,
    skillId,
  ]);
  if (res.affectedRows === 0) throw errors.notFound("Skill not found.");
}

// ---------------------------------------------------------------------------
// Audit trail (application_audit_logs, written only by triggers)
// ---------------------------------------------------------------------------
export async function listAuditLogs(p: { status?: ApplicationStatus; q?: string; page: number; pageSize: number }): Promise<Paged<AuditLogRow>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (p.status) {
    where.push("l.new_status = ?");
    params.push(p.status);
  }
  if (p.q) {
    where.push("(cu.name LIKE ? OR j.job_title LIKE ? OR l.remarks LIKE ?)");
    params.push(`%${p.q}%`, `%${p.q}%`, `%${p.q}%`);
  }
  const from = `FROM application_audit_logs l
    JOIN applications a ON a.application_id = l.application_id
    JOIN jobs j ON j.job_id = a.job_id
    JOIN users cu ON cu.user_id = a.candidate_id
    LEFT JOIN users by_u ON by_u.user_id = l.changed_by
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;

  const [rows, total] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT l.log_id, l.application_id, j.job_title, cu.name AS candidate_name, l.old_status, l.new_status,
              by_u.name AS changed_by, by_u.role AS changed_by_role, l.changed_at, l.remarks
         ${from}
        ORDER BY l.log_id DESC
        LIMIT ? OFFSET ?`,
      [...params, p.pageSize, (p.page - 1) * p.pageSize],
    ),
    query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${from}`, params),
  ]);
  return {
    data: rows.map((r) => ({
      logId: r.log_id,
      applicationId: r.application_id,
      jobTitle: r.job_title,
      candidateName: r.candidate_name,
      oldStatus: r.old_status,
      newStatus: r.new_status,
      changedBy: r.changed_by,
      changedByRole: r.changed_by_role,
      changedAt: new Date(r.changed_at).toISOString(),
      remarks: r.remarks,
    })),
    page: p.page,
    pageSize: p.pageSize,
    total: Number(total[0].n),
  };
}

// ---------------------------------------------------------------------------
// Outbox monitor
// ---------------------------------------------------------------------------
export async function listOutbox(p: { status?: OutboxRow["status"]; page: number; pageSize: number }): Promise<Paged<OutboxRow>> {
  const whereSql = p.status ? "WHERE status = ?" : "";
  const params = p.status ? [p.status] : [];
  const [rows, total] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT event_id, entity_type, entity_id, op, status, attempts, last_error, created_at, processed_at, payload
         FROM graph_sync_outbox ${whereSql}
        ORDER BY event_id DESC
        LIMIT ? OFFSET ?`,
      [...params, p.pageSize, (p.page - 1) * p.pageSize],
    ),
    query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM graph_sync_outbox ${whereSql}`, params),
  ]);
  return {
    data: rows.map((r) => ({
      eventId: Number(r.event_id),
      entityType: r.entity_type,
      entityId: r.entity_id,
      op: r.op,
      status: r.status,
      attempts: Number(r.attempts),
      lastError: r.last_error,
      createdAt: new Date(r.created_at).toISOString(),
      processedAt: r.processed_at ? new Date(r.processed_at).toISOString() : null,
      payload: r.payload,
    })),
    page: p.page,
    pageSize: p.pageSize,
    total: Number(total[0].n),
  };
}

/** Put parked FAILED events back in the queue with a fresh attempt budget. */
export async function retryOutboxEvents(eventIds: number[]): Promise<number> {
  const res = await query<ResultSetHeader>(
    `UPDATE graph_sync_outbox
        SET status = 'PENDING', attempts = 0, last_error = NULL, processed_at = NULL
      WHERE status = 'FAILED' AND event_id IN (?)`,
    [eventIds],
  );
  return res.affectedRows;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function counts<K extends string>(rows: RowDataPacket[], keys: readonly K[]): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const r of rows) if (keys.includes(r.k)) out[r.k as K] = Number(r.n);
  return out;
}

export async function getOverview(): Promise<AdminOverview> {
  const [users, jobs, apps, top, outbox] = await Promise.all([
    query<RowDataPacket[]>("SELECT role AS k, COUNT(*) AS n FROM users GROUP BY role"),
    query<RowDataPacket[]>("SELECT status AS k, COUNT(*) AS n FROM jobs GROUP BY status"),
    query<RowDataPacket[]>("SELECT status AS k, COUNT(*) AS n FROM applications GROUP BY status"),
    query<RowDataPacket[]>(
      `SELECT skill_id, skill_name, category, demanding_jobs_count, mandatory_in_jobs
         FROM vw_top_demanded_skills
        ORDER BY demanding_jobs_count DESC, mandatory_in_jobs DESC, skill_name
        LIMIT 8`,
    ),
    query<RowDataPacket[]>("SELECT status AS k, COUNT(*) AS n FROM graph_sync_outbox GROUP BY status"),
  ]);
  return {
    users: counts(users, ["Candidate", "Recruiter", "Admin"] as const),
    jobs: counts(jobs, ["OPEN", "CLOSED", "ARCHIVED"] as const satisfies readonly JobStatus[]),
    applications: counts(apps, ["APPLIED", "UNDER_REVIEW", "INTERVIEW_SCHEDULED", "OFFERED", "REJECTED"] as const),
    topDemandedSkills: top.map((r) => ({
      skillId: r.skill_id,
      name: r.skill_name,
      category: r.category,
      demandingJobs: Number(r.demanding_jobs_count),
      mandatoryIn: Number(r.mandatory_in_jobs),
    })),
    outbox: counts(outbox, ["PENDING", "DONE", "FAILED"] as const),
  };
}
