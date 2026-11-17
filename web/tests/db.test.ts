import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, getPool, query, withConnection, withTransaction } from "@/lib/db";
import { toAppError } from "@/lib/errors";
import {
  callProcedureOn,
  getRecruiterAnalytics,
  submitApplication,
  updateApplicationStatus,
} from "@/lib/procedures";
import { cleanupTestUsers, testEmail } from "./helpers";

/**
 * Data-access layer guarantees (plan items 2 and 8):
 *  - CALL + OUT-parameter SELECT run on one connection and leave no
 *    session variables behind on the pooled connection
 *  - failures never return a connection with an open transaction
 *  - withTransaction rolls back on error
 */

/**
 * Proves a connection is NOT inside an open transaction: a row written on it
 * must be immediately visible from a different pooled connection (it can
 * only be, if it was auto-committed). Uses behaviour rather than
 * information_schema.innodb_trx, which needs the PROCESS privilege that the
 * least-privilege app user deliberately does not have.
 */
async function assertNoOpenTransaction(conn: Parameters<Parameters<typeof withConnection>[0]>[0]): Promise<void> {
  const email = testEmail("txprobe");
  await conn.query("INSERT INTO users (name, email, password_hash) VALUES ('Tx Probe', ?, 'x')", [email]);
  const other = await getPool().getConnection();
  try {
    const [rows] = await other.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users WHERE email = ?", [email]);
    expect(Number(rows[0].n)).toBe(1);
  } finally {
    other.release();
  }
}

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await closePool();
});

describe("callProcedure / OUT parameters", () => {
  it("returns OUT values from sp_submit_application business failures", async () => {
    await expect(submitApplication(23, 12)).resolves.toMatchObject({ statusCode: "FAILED", applicationId: null }); // no resume
    await expect(submitApplication(7, 5)).resolves.toMatchObject({ statusCode: "FAILED" }); // closed job
    await expect(submitApplication(7, 999999)).resolves.toMatchObject({ statusCode: "NOT_FOUND" });
  });

  it("does not leave OUT session variables on the pooled connection", async () => {
    await withConnection(async (conn) => {
      const { out } = await callProcedureOn<{ applicationId: number | null; statusCode: string; message: string }>(
        conn,
        "sp_submit_application",
        [7, 999999],
        ["applicationId", "statusCode", "message"],
      );
      expect(out.statusCode).toBe("NOT_FOUND");

      const [rows] = await conn.query<RowDataPacket[]>("SELECT @sm_out_0 AS a, @sm_out_1 AS b, @sm_out_2 AS c");
      expect(rows[0]).toEqual({ a: null, b: null, c: null });
    });
  });

  it("keeps concurrent calls isolated (each gets its own OUT values)", async () => {
    const results = await Promise.all([
      submitApplication(23, 12),
      submitApplication(7, 999999),
      submitApplication(999999, 1),
      submitApplication(7, 5),
    ]);
    expect(results.map((r) => r.message)).toEqual([
      "Candidate profile must have a valid resume before applying.",
      "Job posting does not exist.",
      "Candidate does not exist.",
      "Cannot apply: Job posting is currently not active.",
    ]);
  });

  it("submits successfully for a candidate with a resume (DB computes match score)", async () => {
    const email = testEmail("apply");
    const [u] = await getPool().query<ResultSetHeader>(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Apply Test', ?, 'x', 'Candidate')",
      [email],
    );
    await query("INSERT INTO candidates (candidate_id, resume_url) VALUES (?, 'https://cdn.skillmatch.io/resumes/t.pdf')", [u.insertId]);
    await query("INSERT INTO candidate_skills (candidate_id, skill_id, proficiency_level) VALUES (?, 3, 'Beginner')", [u.insertId]);

    const result = await submitApplication(u.insertId, 12);
    expect(result.statusCode).toBe("SUCCESS");
    expect(result.applicationId).toBeGreaterThan(0);

    const rows = await query<RowDataPacket[]>("SELECT status, match_score FROM applications WHERE application_id = ?", [result.applicationId]);
    expect(rows[0]).toMatchObject({ status: "APPLIED", match_score: 33.33 });

    await expect(submitApplication(u.insertId, 12)).resolves.toMatchObject({ statusCode: "DUPLICATE" });
  });
});

describe("errors raised inside procedures", () => {
  it("maps a SIGNAL from sp_update_application_status to DB_RULE and leaves no open transaction", async () => {
    const rows = await query<RowDataPacket[]>("SELECT application_id FROM applications WHERE job_id = 1 LIMIT 1");
    const appId = rows[0].application_id as number;

    await withConnection(async (conn) => {
      const err = await callProcedureOn(conn, "sp_update_application_status", [appId, "OFFERED", "x", 3], ["rowsAffected"]).then(
        () => null,
        (e: unknown) => e,
      );
      const appErr = toAppError(err);
      expect(appErr.code).toBe("DB_RULE");
      expect(appErr.message).toBe("Recruiter does not own this job posting.");
      await assertNoOpenTransaction(conn);
    });
  });

  it("returns 0 rows for an unknown application", async () => {
    await expect(updateApplicationStatus(999999, "UNDER_REVIEW", null, 1)).resolves.toBe(0);
  });

  it("rejects an invalid state transition through the procedure", async () => {
    const rows = await query<RowDataPacket[]>("SELECT application_id FROM applications WHERE status = 'OFFERED' LIMIT 1");
    const err = await updateApplicationStatus(rows[0].application_id, "REJECTED", "x", 1).catch((e: unknown) => e);
    expect(toAppError(err)).toMatchObject({ code: "DB_RULE", message: "Invalid status transition: OFFERED -> REJECTED." });
  });
});

describe("withTransaction", () => {
  it("rolls back every statement when the callback throws", async () => {
    const email = testEmail("rollback");
    await expect(
      withTransaction(async (conn) => {
        await conn.query("INSERT INTO users (name, email, password_hash) VALUES ('Rollback', ?, 'x')", [email]);
        await conn.query("INSERT INTO users (name, email, password_hash) VALUES ('Bad', 'not-an-email', 'x')"); // CHECK fails
      }),
    ).rejects.toMatchObject({ errno: 3819 });

    const rows = await query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users WHERE email = ?", [email]);
    expect(rows[0].n).toBe(0);
  });
});

describe("multiple result sets", () => {
  it("sp_get_recruiter_analytics returns the funnel and hard-to-fill skills", async () => {
    const { funnel, hardToFillSkills } = await getRecruiterAnalytics(2);
    expect(funnel.map((r) => r.job_id).sort((a, b) => a - b)).toEqual([1, 2, 13]);
    expect(Array.isArray(hardToFillSkills)).toBe(true);
  });
});

describe("sp_update_application_status concurrency (no time-of-check/time-of-use gap)", () => {
  /** A fresh APPLIED application on Sarah's job 13. */
  async function freshApplication(): Promise<number> {
    const [u] = await getPool().query<ResultSetHeader>(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Lock Test', ?, 'x', 'Candidate')",
      [testEmail("lock")],
    );
    await query("INSERT INTO candidates (candidate_id, resume_url) VALUES (?, 'https://cdn.skillmatch.io/resumes/l.pdf')", [u.insertId]);
    const [a] = await getPool().query<ResultSetHeader>("INSERT INTO applications (job_id, candidate_id) VALUES (13, ?)", [u.insertId]);
    return a.insertId;
  }

  async function auditCount(appId: number): Promise<number> {
    const rows = await query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM application_audit_logs WHERE application_id = ?", [appId]);
    return Number(rows[0].n);
  }

  it.each([
    ["job row", (appId: number) => ["SELECT job_id FROM jobs WHERE job_id = 13 FOR UPDATE", []] as const],
    ["acting user's row", () => ["SELECT user_id FROM users WHERE user_id = 2 FOR UPDATE", []] as const],
    ["application row", (appId: number) => ["SELECT application_id FROM applications WHERE application_id = ? FOR UPDATE", [appId]] as const],
  ])("waits for a lock held on the %s instead of deciding on unlocked data", async (_label, lockSql) => {
    const appId = await freshApplication();
    const before = await auditCount(appId);
    const holder = await getPool().getConnection();
    const caller = await getPool().getConnection();
    try {
      await holder.beginTransaction();
      const [sql, args] = lockSql(appId);
      await holder.query(sql, [...args]);

      // Session setting on a pooled connection: always restored in finally
      await caller.query("SET SESSION innodb_lock_wait_timeout = 1");
      const err = await callProcedureOn(caller, "sp_update_application_status", [appId, "UNDER_REVIEW", "x", 2], ["rowsAffected"]).then(
        () => null,
        (e: unknown) => e as { errno?: number },
      );
      expect(err?.errno).toBe(1205); // ER_LOCK_WAIT_TIMEOUT: the procedure blocked on the lock
    } finally {
      await holder.rollback().catch(() => undefined);
      holder.release();
      await caller.query("SET SESSION innodb_lock_wait_timeout = DEFAULT").catch(() => undefined);
      caller.release();
    }

    // The timed-out call was rolled back: nothing changed, nothing audited
    const [row] = await query<RowDataPacket[]>("SELECT status FROM applications WHERE application_id = ?", [appId]);
    expect(row.status).toBe("APPLIED");
    expect(await auditCount(appId)).toBe(before);

    // Once the lock is released the same update succeeds
    await expect(updateApplicationStatus(appId, "UNDER_REVIEW", "after lock", 2)).resolves.toBe(1);
  });

  it("serialises simultaneous identical updates: one change, one audit row", async () => {
    const appId = await freshApplication();
    const results = await Promise.all([1, 2, 3].map(() => updateApplicationStatus(appId, "UNDER_REVIEW", "parallel", 2)));
    // mysql2 connects with CLIENT_FOUND_ROWS, so ROW_COUNT() reports MATCHED
    // rows: every call sees the (existing) application. The real invariant is
    // that the status changed once, so exactly one audit row was written.
    expect(results).toEqual([1, 1, 1]);
    const rows = await query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM application_audit_logs WHERE application_id = ? AND new_status = 'UNDER_REVIEW'",
      [appId],
    );
    expect(Number(rows[0].n)).toBe(1);
    const [app] = await query<RowDataPacket[]>("SELECT status FROM applications WHERE application_id = ?", [appId]);
    expect(app.status).toBe("UNDER_REVIEW");
  });

  it("concurrent updates of DIFFERENT applications of the same job do not block each other", async () => {
    const [a1, a2] = await Promise.all([freshApplication(), freshApplication()]);
    const holder = await getPool().getConnection();
    try {
      // Hold application a1 exclusively; a2's update (same job, shared job lock) must still go through
      await holder.beginTransaction();
      await holder.query("SELECT application_id FROM applications WHERE application_id = ? FOR UPDATE", [a1]);
      await expect(updateApplicationStatus(a2, "UNDER_REVIEW", "independent", 2)).resolves.toBe(1);
    } finally {
      await holder.rollback().catch(() => undefined);
      holder.release();
    }
  });
});
