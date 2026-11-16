import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import neo4j, { type ManagedTransaction, type Session } from "neo4j-driver";
import { z } from "zod";
import { withConnection } from "./db";
import { getDriver } from "./neo4j";

/**
 * MySQL -> Neo4j synchronisation (transactional outbox consumer).
 * See docs/CONTRACTS.md section 6 and docs/GRAPH_SYNC.md.
 *
 * Guarantees
 *  - Single worker: a MySQL advisory lock (GET_LOCK) ensures only one
 *    consumer runs at a time, so events are applied strictly in event_id order.
 *  - Ordering on failure: the batch stops at the first failing event
 *    (head-of-line), so a later change to the same entity can never overtake
 *    an earlier one. After `maxAttempts` failures the event is parked as
 *    FAILED (with last_error) and the queue moves on.
 *  - At-least-once + idempotent apply: the Neo4j write happens before the
 *    event is marked DONE. A crash in between re-applies the event later;
 *    every write is MERGE/SET or a delete of something that may already be
 *    gone, so applying an event twice has the same effect as once.
 *  - Eventual consistency: MySQL is the source of truth; the graph lags
 *    until the worker runs.
 */

export const SYNC_LOCK_NAME = "skillmatch_graph_sync";

// ---------------------------------------------------------------------------
// Event payloads (written by the outbox triggers in mysql/01_schema.sql)
// ---------------------------------------------------------------------------
const Id = z.coerce.number().int().positive();
const Num = z.coerce.number();

const SkillPayload = z.object({ id: Id, name: z.string().min(1), category: z.string().min(1) });
const CandidatePayload = z.object({
  id: Id,
  name: z.string().min(1),
  location: z.string().nullable(),
  experience_years: Num,
});
const JobPayload = z.object({
  id: Id,
  title: z.string().min(1),
  location: z.string().min(1),
  status: z.enum(["OPEN", "CLOSED", "ARCHIVED"]),
  company_id: Id,
});
const CandidateSkillPayload = z.object({ candidate_id: Id, skill_id: Id, proficiency: z.string().min(1), years: Num });
const JobSkillPayload = z.object({
  job_id: Id,
  skill_id: Id,
  required_level: z.string().min(1),
  is_mandatory: z.union([z.boolean(), z.number()]).transform((v) => v === true || v === 1),
});

export type EntityType = "CANDIDATE" | "SKILL" | "CANDIDATE_SKILL" | "JOB" | "JOB_SKILL";

export interface OutboxEvent {
  event_id: number;
  entity_type: EntityType;
  entity_id: string;
  op: "UPSERT" | "DELETE";
  payload: unknown;
  attempts: number;
}

type ApplyOutcome = "applied" | "skipped";

const int = (n: number) => neo4j.int(n);

/** "5:12" -> [5, 12] */
function compositeKey(entityId: string): [number, number] {
  const [a, b] = entityId.split(":").map((p) => Id.parse(p));
  if (a === undefined || b === undefined) throw new Error(`Invalid composite entity_id: ${entityId}`);
  return [a, b];
}

async function companyRow(conn: PoolConnection, companyId: number) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT company_id, company_name, industry, location FROM companies WHERE company_id = ?",
    [companyId],
  );
  return rows[0];
}

async function upsertJob(
  tx: ManagedTransaction,
  job: z.infer<typeof JobPayload>,
  company: RowDataPacket | undefined,
): Promise<void> {
  await tx.run("MERGE (j:Job {id: $id}) SET j.title = $title, j.location = $location, j.status = $status", {
    id: int(job.id),
    title: job.title,
    location: job.location,
    status: job.status,
  });
  if (!company) return;
  // Companies have no outbox trigger: their row is read through from MySQL.
  await tx.run(
    `MERGE (co:Company {id: $cid})
       SET co.name = $name, co.industry = $industry, co.location = $location
     WITH co
     MATCH (j:Job {id: $jid})
     OPTIONAL MATCH (j)-[old:OFFERED_BY]->(other:Company) WHERE other.id <> $cid
     DELETE old
     WITH DISTINCT j, co
     MERGE (j)-[:OFFERED_BY]->(co)`,
    {
      cid: int(company.company_id),
      name: company.company_name,
      industry: company.industry,
      location: company.location,
      jid: int(job.id),
    },
  );
}

/** Apply one outbox event inside a Neo4j write transaction. */
async function applyEvent(session: Session, conn: PoolConnection, ev: OutboxEvent): Promise<ApplyOutcome> {
  // Read-through data is fetched before opening the Neo4j transaction.
  let jobPayload: z.infer<typeof JobPayload> | undefined;
  let company: RowDataPacket | undefined;
  if (ev.entity_type === "JOB" && ev.op === "UPSERT") {
    jobPayload = JobPayload.parse(ev.payload);
    company = await companyRow(conn, jobPayload.company_id);
  }

  return session.executeWrite(async (tx): Promise<ApplyOutcome> => {
    const del = async (label: string) => {
      await tx.run(`MATCH (n:${label} {id: $id}) DETACH DELETE n`, { id: int(Id.parse(ev.entity_id)) });
      return "applied" as const;
    };

    switch (`${ev.entity_type}:${ev.op}`) {
      case "SKILL:UPSERT": {
        const p = SkillPayload.parse(ev.payload);
        await tx.run("MERGE (s:Skill {id: $id}) SET s.name = $name, s.category = $category", {
          id: int(p.id),
          name: p.name,
          category: p.category,
        });
        return "applied";
      }
      case "SKILL:DELETE":
        return del("Skill");

      case "CANDIDATE:UPSERT": {
        const p = CandidatePayload.parse(ev.payload);
        await tx.run(
          "MERGE (c:Candidate {id: $id}) SET c.name = $name, c.location = $location, c.experience_years = $exp",
          { id: int(p.id), name: p.name, location: p.location, exp: p.experience_years },
        );
        return "applied";
      }
      case "CANDIDATE:DELETE":
        return del("Candidate");

      case "JOB:UPSERT":
        await upsertJob(tx, jobPayload!, company);
        return "applied";
      case "JOB:DELETE":
        return del("Job");

      case "CANDIDATE_SKILL:UPSERT": {
        const p = CandidateSkillPayload.parse(ev.payload);
        // Endpoints are MATCHed, not MERGEd: if the candidate/skill no longer
        // exists (deleted later in the log) the event is a harmless no-op.
        const res = await tx.run(
          `MATCH (c:Candidate {id: $cid}) MATCH (s:Skill {id: $sid})
           MERGE (c)-[h:HAS_SKILL]->(s)
           SET h.proficiency = $proficiency, h.years = $years
           RETURN count(h) AS n`,
          { cid: int(p.candidate_id), sid: int(p.skill_id), proficiency: p.proficiency, years: p.years },
        );
        return res.records[0]?.get("n") > 0 ? "applied" : "skipped";
      }
      case "CANDIDATE_SKILL:DELETE": {
        const [cid, sid] = compositeKey(ev.entity_id);
        await tx.run("MATCH (:Candidate {id: $cid})-[h:HAS_SKILL]->(:Skill {id: $sid}) DELETE h", {
          cid: int(cid),
          sid: int(sid),
        });
        return "applied";
      }

      case "JOB_SKILL:UPSERT": {
        const p = JobSkillPayload.parse(ev.payload);
        const res = await tx.run(
          `MATCH (j:Job {id: $jid}) MATCH (s:Skill {id: $sid})
           MERGE (j)-[r:REQUIRES_SKILL]->(s)
           SET r.required_level = $level, r.is_mandatory = $mandatory
           RETURN count(r) AS n`,
          { jid: int(p.job_id), sid: int(p.skill_id), level: p.required_level, mandatory: p.is_mandatory },
        );
        return res.records[0]?.get("n") > 0 ? "applied" : "skipped";
      }
      case "JOB_SKILL:DELETE": {
        const [jid, sid] = compositeKey(ev.entity_id);
        await tx.run("MATCH (:Job {id: $jid})-[r:REQUIRES_SKILL]->(:Skill {id: $sid}) DELETE r", {
          jid: int(jid),
          sid: int(sid),
        });
        return "applied";
      }

      default:
        throw new Error(`Unsupported outbox event ${ev.entity_type}:${ev.op}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Incremental worker
// ---------------------------------------------------------------------------
export interface SyncOptions {
  batchSize?: number;
  maxAttempts?: number;
  /** Safety valve for a single run. */
  maxBatches?: number;
  log?: (msg: string) => void;
}

export interface SyncResult {
  lockAcquired: boolean;
  applied: number;
  skipped: number;
  failed: number;
  /** Set when the run stopped at a retryable failure (head-of-line). */
  blockedAt?: { eventId: number; attempts: number; error: string };
  remainingPending: number;
}

/** Human-readable, single-line error for outbox.last_error (max 480 chars). */
function errorText(e: unknown): string {
  if (e instanceof z.ZodError) {
    const issues = e.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; ");
    return `Invalid event payload - ${issues}`.slice(0, 480);
  }
  return (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 480);
}

export async function processOutbox(opts: SyncOptions = {}): Promise<SyncResult> {
  const { batchSize = 200, maxAttempts = 5, maxBatches = 100, log = () => undefined } = opts;
  const result: SyncResult = { lockAcquired: false, applied: 0, skipped: 0, failed: 0, remainingPending: 0 };

  return withConnection(async (conn) => {
    // Advisory locks belong to the MySQL session, i.e. to this pooled
    // connection: they MUST be released explicitly before it is returned.
    const [lockRows] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [SYNC_LOCK_NAME]);
    if (Number(lockRows[0].got) !== 1) {
      log("another sync worker holds the lock - skipping this run");
      return result;
    }
    result.lockAcquired = true;

    const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE });
    try {
      batches: for (let b = 0; b < maxBatches; b++) {
        const [events] = await conn.query<RowDataPacket[]>(
          `SELECT event_id, entity_type, entity_id, op, payload, attempts
             FROM graph_sync_outbox
            WHERE status = 'PENDING'
            ORDER BY event_id
            LIMIT ?`,
          [batchSize],
        );
        if (events.length === 0) break;

        for (const row of events as unknown as OutboxEvent[]) {
          try {
            const outcome = await applyEvent(session, conn, row);
            await conn.query(
              `UPDATE graph_sync_outbox
                  SET status = 'DONE', attempts = attempts + 1, last_error = NULL, processed_at = NOW()
                WHERE event_id = ?`,
              [row.event_id],
            );
            if (outcome === "skipped") result.skipped++;
            else result.applied++;
          } catch (e) {
            const attempts = row.attempts + 1;
            const parked = attempts >= maxAttempts;
            const msg = errorText(e);
            await conn.query(
              `UPDATE graph_sync_outbox
                  SET attempts = ?, last_error = ?, status = ?, processed_at = ?
                WHERE event_id = ?`,
              [attempts, msg, parked ? "FAILED" : "PENDING", parked ? new Date() : null, row.event_id],
            );
            console.error(
              `[graph-sync] event ${row.event_id} ${row.entity_type}:${row.op} ${row.entity_id} ` +
                `failed (attempt ${attempts}/${maxAttempts}${parked ? ", parked as FAILED" : ""}): ${msg}`,
            );
            if (parked) {
              result.failed++;
              continue;
            }
            result.blockedAt = { eventId: row.event_id, attempts, error: msg };
            break batches;
          }
        }
      }
    } finally {
      await session.close();
      await conn.query("SELECT RELEASE_LOCK(?)", [SYNC_LOCK_NAME]).catch(() => undefined);
    }

    const [pending] = await conn.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM graph_sync_outbox WHERE status = 'PENDING'",
    );
    result.remainingPending = Number(pending[0].n);
    log(
      `applied=${result.applied} skipped=${result.skipped} failed=${result.failed} ` +
        `pending=${result.remainingPending}${result.blockedAt ? ` blockedAt=${result.blockedAt.eventId}` : ""}`,
    );
    return result;
  });
}

// ---------------------------------------------------------------------------
// Full rebuild + verification (mirrored entities only; graph-only
// RELATED_TO / SUBSKILL_OF / WORKED_AT / CONNECTED_TO are never touched,
// except that deleting a node removes its relationships)
// ---------------------------------------------------------------------------
interface MysqlSnapshot {
  skills: RowDataPacket[];
  companies: RowDataPacket[];
  candidates: RowDataPacket[];
  jobs: RowDataPacket[];
  candidateSkills: RowDataPacket[];
  jobSkills: RowDataPacket[];
}

async function readMysqlSnapshot(): Promise<MysqlSnapshot> {
  return withConnection(async (conn) => {
    // One consistent, read-only snapshot of all six tables.
    await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    try {
      const q = async (sql: string) => (await conn.query<RowDataPacket[]>(sql))[0];
      const snapshot = {
        skills: await q("SELECT skill_id AS id, skill_name AS name, category FROM skills"),
        companies: await q("SELECT company_id AS id, company_name AS name, industry, location FROM companies"),
        candidates: await q(
          `SELECT cd.candidate_id AS id, u.name, cd.location, cd.experience_years
             FROM candidates cd JOIN users u ON u.user_id = cd.candidate_id`,
        ),
        jobs: await q(
          `SELECT j.job_id AS id, j.job_title AS title, j.location, j.status, r.company_id
             FROM jobs j JOIN recruiters r ON r.recruiter_id = j.recruiter_id`,
        ),
        candidateSkills: await q(
          "SELECT candidate_id, skill_id, proficiency_level AS proficiency, years_experience AS years FROM candidate_skills",
        ),
        jobSkills: await q("SELECT job_id, skill_id, required_level, is_mandatory FROM job_skills"),
      };
      await conn.query("COMMIT");
      return snapshot;
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => undefined);
      throw e;
    }
  });
}

export interface RebuildResult {
  skills: number;
  companies: number;
  candidates: number;
  jobs: number;
  hasSkill: number;
  requiresSkill: number;
}

/** Make every MySQL-mirrored node/relationship in Neo4j equal to MySQL. */
export async function rebuildGraph(): Promise<RebuildResult> {
  const s = await readMysqlSnapshot();
  const ids = (rows: RowDataPacket[]) => rows.map((r) => int(r.id));

  const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.executeWrite(async (tx) => {
      await tx.run("UNWIND $rows AS r MERGE (s:Skill {id: r.id}) SET s.name = r.name, s.category = r.category", {
        rows: s.skills.map((r) => ({ id: int(r.id), name: r.name, category: r.category })),
      });
      await tx.run(
        "UNWIND $rows AS r MERGE (co:Company {id: r.id}) SET co.name = r.name, co.industry = r.industry, co.location = r.location",
        { rows: s.companies.map((r) => ({ id: int(r.id), name: r.name, industry: r.industry, location: r.location })) },
      );
      await tx.run(
        "UNWIND $rows AS r MERGE (c:Candidate {id: r.id}) SET c.name = r.name, c.location = r.location, c.experience_years = r.exp",
        { rows: s.candidates.map((r) => ({ id: int(r.id), name: r.name, location: r.location, exp: Number(r.experience_years) })) },
      );
      await tx.run(
        `UNWIND $rows AS r
         MERGE (j:Job {id: r.id}) SET j.title = r.title, j.location = r.location, j.status = r.status
         WITH j, r
         MATCH (co:Company {id: r.company_id})
         OPTIONAL MATCH (j)-[old:OFFERED_BY]->(other:Company) WHERE other.id <> r.company_id
         DELETE old
         WITH DISTINCT j, co
         MERGE (j)-[:OFFERED_BY]->(co)`,
        {
          rows: s.jobs.map((r) => ({
            id: int(r.id),
            title: r.title,
            location: r.location,
            status: r.status,
            company_id: int(r.company_id),
          })),
        },
      );

      // Relationships: upsert the MySQL set, then delete any extra ones
      await tx.run(
        `UNWIND $rows AS r
         MATCH (c:Candidate {id: r.cid}) MATCH (sk:Skill {id: r.sid})
         MERGE (c)-[h:HAS_SKILL]->(sk) SET h.proficiency = r.proficiency, h.years = r.years`,
        {
          rows: s.candidateSkills.map((r) => ({
            cid: int(r.candidate_id),
            sid: int(r.skill_id),
            proficiency: r.proficiency,
            years: Number(r.years),
          })),
        },
      );
      await tx.run(
        `MATCH (c:Candidate)-[h:HAS_SKILL]->(sk:Skill)
         WHERE NOT (toString(c.id) + ':' + toString(sk.id)) IN $keys
         DELETE h`,
        { keys: s.candidateSkills.map((r) => `${r.candidate_id}:${r.skill_id}`) },
      );
      await tx.run(
        `UNWIND $rows AS r
         MATCH (j:Job {id: r.jid}) MATCH (sk:Skill {id: r.sid})
         MERGE (j)-[q:REQUIRES_SKILL]->(sk) SET q.required_level = r.level, q.is_mandatory = r.mandatory`,
        {
          rows: s.jobSkills.map((r) => ({
            jid: int(r.job_id),
            sid: int(r.skill_id),
            level: r.required_level,
            mandatory: Boolean(r.is_mandatory),
          })),
        },
      );
      await tx.run(
        `MATCH (j:Job)-[q:REQUIRES_SKILL]->(sk:Skill)
         WHERE NOT (toString(j.id) + ':' + toString(sk.id)) IN $keys
         DELETE q`,
        { keys: s.jobSkills.map((r) => `${r.job_id}:${r.skill_id}`) },
      );

      // Nodes that no longer exist in MySQL
      await tx.run("MATCH (n:Candidate) WHERE NOT n.id IN $ids DETACH DELETE n", { ids: ids(s.candidates) });
      await tx.run("MATCH (n:Job) WHERE NOT n.id IN $ids DETACH DELETE n", { ids: ids(s.jobs) });
      await tx.run("MATCH (n:Skill) WHERE NOT n.id IN $ids DETACH DELETE n", { ids: ids(s.skills) });
      await tx.run("MATCH (n:Company) WHERE NOT n.id IN $ids DETACH DELETE n", { ids: ids(s.companies) });
    });
  } finally {
    await session.close();
  }

  return {
    skills: s.skills.length,
    companies: s.companies.length,
    candidates: s.candidates.length,
    jobs: s.jobs.length,
    hasSkill: s.candidateSkills.length,
    requiresSkill: s.jobSkills.length,
  };
}

// ---- Verification -----------------------------------------------------------
const fmt = (v: unknown) => (v === null || v === undefined ? "∅" : typeof v === "number" ? String(Number(v)) : String(v));

function mysqlKeys(s: MysqlSnapshot): Set<string> {
  const keys = new Set<string>();
  for (const r of s.skills) keys.add(`Skill ${r.id} | ${r.name} | ${r.category}`);
  for (const r of s.companies) keys.add(`Company ${r.id} | ${r.name} | ${r.industry} | ${fmt(r.location)}`);
  for (const r of s.candidates) keys.add(`Candidate ${r.id} | ${r.name} | ${fmt(r.location)} | ${fmt(r.experience_years)}`);
  for (const r of s.jobs) keys.add(`Job ${r.id} | ${r.title} | ${r.location} | ${r.status} | company ${r.company_id}`);
  for (const r of s.candidateSkills) keys.add(`HAS_SKILL ${r.candidate_id}->${r.skill_id} | ${r.proficiency} | ${fmt(r.years)}`);
  for (const r of s.jobSkills)
    keys.add(`REQUIRES_SKILL ${r.job_id}->${r.skill_id} | ${r.required_level} | ${Boolean(r.is_mandatory)}`);
  return keys;
}

/** Every mirrored node/relationship in Neo4j as a normalised "key | props" string. */
export async function graphEntries(): Promise<Set<string>> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const res = await session.executeRead((tx) =>
      tx.run(
        `CALL () {
           MATCH (n:Skill) RETURN 'Skill ' + n.id + ' | ' + n.name + ' | ' + n.category AS k
           UNION ALL
           MATCH (n:Company) RETURN 'Company ' + n.id + ' | ' + n.name + ' | ' + n.industry + ' | ' + coalesce(n.location, '∅') AS k
           UNION ALL
           MATCH (n:Candidate) RETURN 'Candidate ' + n.id + ' | ' + n.name + ' | ' + coalesce(n.location, '∅') + ' | ' + toString(n.experience_years) AS k
           UNION ALL
           MATCH (n:Job) OPTIONAL MATCH (n)-[:OFFERED_BY]->(co:Company)
           RETURN 'Job ' + n.id + ' | ' + n.title + ' | ' + n.location + ' | ' + n.status + ' | company ' + coalesce(toString(co.id), '∅') AS k
           UNION ALL
           MATCH (c:Candidate)-[h:HAS_SKILL]->(s:Skill) RETURN 'HAS_SKILL ' + c.id + '->' + s.id + ' | ' + h.proficiency + ' | ' + toString(h.years) AS k
           UNION ALL
           MATCH (j:Job)-[r:REQUIRES_SKILL]->(s:Skill) RETURN 'REQUIRES_SKILL ' + j.id + '->' + s.id + ' | ' + r.required_level + ' | ' + toString(r.is_mandatory) AS k
         }
         RETURN k`,
      ),
    );
    // Neo4j prints whole floats as "4.0"; normalise to the MySQL formatting ("4")
    return new Set(res.records.map((r) => (r.get("k") as string).replace(/\b(\d+)\.0\b/g, "$1")));
  } finally {
    await session.close();
  }
}

export interface VerifyResult {
  ok: boolean;
  mysqlEntries: number;
  graphEntries: number;
  missingInGraph: string[];
  extraInGraph: string[];
}

/** Compare every mirrored node/relationship (with properties) in both stores. */
export async function verifyGraph(): Promise<VerifyResult> {
  const [expected, actual] = await Promise.all([readMysqlSnapshot().then(mysqlKeys), graphEntries()]);
  const missingInGraph = [...expected].filter((k) => !actual.has(k)).sort();
  const extraInGraph = [...actual].filter((k) => !expected.has(k)).sort();
  return {
    ok: missingInGraph.length === 0 && extraInGraph.length === 0,
    mysqlEntries: expected.size,
    graphEntries: actual.size,
    missingInGraph,
    extraInGraph,
  };
}

/** Counts per status, for the CLI and the admin page. */
export async function outboxStats(): Promise<Record<string, number>> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT status, COUNT(*) AS n FROM graph_sync_outbox GROUP BY status",
    );
    const stats: Record<string, number> = { PENDING: 0, DONE: 0, FAILED: 0 };
    for (const r of rows) stats[r.status as string] = Number(r.n);
    return stats;
  });
}
