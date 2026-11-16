import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withConnection } from "./db";
import type { ApplicationStatus } from "./contracts";

/**
 * Stored-procedure calls (docs/CONTRACTS.md section 4, rule 1).
 *
 * MySQL OUT parameters are returned through session user variables
 * (@var), which live on ONE connection. With a pool, running `CALL` and
 * `SELECT @var` as two separate pool.query() calls could hit two different
 * connections and read another request's values. So every call here:
 *   1. acquires one connection,
 *   2. resets its OUT variables to NULL,
 *   3. runs CALL and SELECT @out on that same connection,
 *   4. rolls back if anything failed (never return a connection mid-transaction),
 *   5. resets the OUT variables again and releases the connection.
 */

const PROC_NAME = /^sp_[a-z0-9_]+$/;
const OUT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ProcedureResult<TOut> {
  out: TOut;
  resultSets: RowDataPacket[][];
}

/** Call a procedure on a connection the caller already holds. */
export async function callProcedureOn<TOut extends Record<string, unknown>>(
  conn: PoolConnection,
  name: string,
  inArgs: unknown[],
  outNames: ReadonlyArray<keyof TOut & string> = [],
): Promise<ProcedureResult<TOut>> {
  if (!PROC_NAME.test(name)) throw new Error(`Invalid procedure name: ${name}`);
  for (const n of outNames) if (!OUT_NAME.test(n)) throw new Error(`Invalid OUT parameter name: ${n}`);

  const vars = outNames.map((_, i) => `@sm_out_${i}`);
  const resetSql = vars.length ? `SET ${vars.map((v) => `${v} = NULL`).join(", ")}` : null;

  try {
    if (resetSql) await conn.query(resetSql);

    const placeholders = [...inArgs.map(() => "?"), ...vars].join(", ");
    const [raw] = await conn.query(`CALL ${name}(${placeholders})`, inArgs);

    let out = {} as TOut;
    if (vars.length) {
      const select = vars.map((v, i) => `${v} AS \`${outNames[i]}\``).join(", ");
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${select}`);
      out = rows[0] as TOut;
    }

    // mysql2 returns [resultSet1, resultSet2, ..., ResultSetHeader] for CALL
    const resultSets = Array.isArray(raw) ? (raw.filter((r) => Array.isArray(r)) as RowDataPacket[][]) : [];
    return { out, resultSets };
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    if (resetSql) await conn.query(resetSql).catch(() => undefined);
  }
}

/** Acquire a pooled connection, call the procedure, release. */
export function callProcedure<TOut extends Record<string, unknown>>(
  name: string,
  inArgs: unknown[],
  outNames: ReadonlyArray<keyof TOut & string> = [],
): Promise<ProcedureResult<TOut>> {
  return withConnection((conn) => callProcedureOn<TOut>(conn, name, inArgs, outNames));
}

// ---------------------------------------------------------------------------
// Typed wrappers for the procedures in mysql/01_schema.sql
// ---------------------------------------------------------------------------

export type SubmitStatusCode = "SUCCESS" | "FAILED" | "DUPLICATE" | "NOT_FOUND" | "ERROR";

export interface SubmitApplicationResult {
  applicationId: number | null;
  statusCode: SubmitStatusCode;
  message: string;
}

/** sp_submit_application: business failures come back as status codes, not exceptions. */
export async function submitApplication(candidateId: number, jobId: number): Promise<SubmitApplicationResult> {
  const { out } = await callProcedure<{ applicationId: number | null; statusCode: SubmitStatusCode; message: string }>(
    "sp_submit_application",
    [candidateId, jobId],
    ["applicationId", "statusCode", "message"],
  );
  return {
    applicationId: out.applicationId === null ? null : Number(out.applicationId),
    statusCode: out.statusCode,
    message: out.message,
  };
}

/**
 * sp_update_application_status: authorization (owner recruiter / admin),
 * status validation and state-machine violations are raised by MySQL as
 * SIGNAL 45000 errors (mapped to DB_RULE by lib/errors.ts).
 * Returns rows affected (0 = application not found).
 */
export async function updateApplicationStatus(
  applicationId: number,
  newStatus: ApplicationStatus,
  remarks: string | null,
  changedBy: number,
): Promise<number> {
  const { out } = await callProcedure<{ rowsAffected: number }>(
    "sp_update_application_status",
    [applicationId, newStatus, remarks, changedBy],
    ["rowsAffected"],
  );
  return Number(out.rowsAffected);
}

export interface RecruiterAnalytics {
  funnel: RowDataPacket[];
  hardToFillSkills: RowDataPacket[];
}

/** sp_get_recruiter_analytics: two result sets. */
export async function getRecruiterAnalytics(recruiterId: number): Promise<RecruiterAnalytics> {
  const { resultSets } = await callProcedure("sp_get_recruiter_analytics", [recruiterId]);
  return { funnel: resultSets[0] ?? [], hardToFillSkills: resultSets[1] ?? [] };
}
