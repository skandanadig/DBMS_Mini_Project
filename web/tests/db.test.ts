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
