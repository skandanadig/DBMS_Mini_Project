import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, getPool, query } from "@/lib/db";
import {
  graphEntries,
  processOutbox,
  rebuildGraph,
  SYNC_LOCK_NAME,
  verifyGraph,
} from "@/lib/graph-sync";
import { closeDriver, getDriver } from "@/lib/neo4j";
import { requestGraphSync, waitForGraphSync } from "@/lib/sync-trigger";
import { TEST_DOMAIN, testEmail } from "./helpers";

/**
 * MySQL -> Neo4j outbox sync (plan item 4):
 *  - every change type reaches the graph; graph == MySQL afterwards
 *  - replaying the ENTIRE outbox (twice) leaves the graph unchanged
 *  - a failing event blocks later events (ordering), then is parked as FAILED
 *  - only one worker runs at a time (MySQL advisory lock)
 *  - full rebuild repairs drift without touching graph-only relationships
 * Runs against the Docker MySQL + Neo4j. Test rows use @vitest.local
 * accounts and 'VITEST' job titles and are removed afterwards.
 */

const JOB_PREFIX = "VITEST";
let startEventId = 0;

async function cypher<T = Record<string, unknown>>(q: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const session = getDriver().session();
  try {
    const res = await session.run(q, params);
    return res.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

async function drain() {
  const r = await processOutbox();
  expect(r.lockAcquired).toBe(true);
  expect(r.blockedAt).toBeUndefined();
  return r;
}

async function graphOnlyCounts(): Promise<Record<string, number>> {
  const rows = await cypher<{ t: string; n: number }>(
    `MATCH ()-[r:RELATED_TO|SUBSKILL_OF|WORKED_AT|CONNECTED_TO]->() RETURN type(r) AS t, count(*) AS n ORDER BY t`,
  );
  return Object.fromEntries(rows.map((r) => [r.t, r.n]));
}

async function createCandidate(location: string): Promise<number> {
  const [u] = await getPool().query<ResultSetHeader>(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Sync Tester', ?, 'x', 'Candidate')",
    [testEmail("sync")],
  );
  await query("INSERT INTO candidates (candidate_id, location, experience_years, resume_url) VALUES (?, ?, 2.0, NULL)", [
    u.insertId,
    location,
  ]);
  return u.insertId;
}

async function cleanup() {
  await query("DELETE FROM jobs WHERE job_title LIKE ?", [`${JOB_PREFIX}%`]);
  await query("DELETE FROM users WHERE email LIKE ?", [`%@${TEST_DOMAIN}`]);
  await query("DELETE FROM graph_sync_outbox WHERE entity_id = '424242'"); // poison event
  await processOutbox(); // apply the DELETE events so the graph is clean too
}

beforeAll(async () => {
  await cleanup();
  const rows = await query<RowDataPacket[]>("SELECT COALESCE(MAX(event_id), 0) AS m FROM graph_sync_outbox");
  startEventId = Number(rows[0].m);
});

afterAll(async () => {
  await cleanup();
  await query("DELETE FROM graph_sync_outbox WHERE event_id > ?", [startEventId]);
  await Promise.all([closePool(), closeDriver()]);
});

// ---------------------------------------------------------------------------
describe("incremental sync", () => {
  it("drains the outbox and leaves the graph identical to MySQL", async () => {
    await drain();
    const v = await verifyGraph();
    expect(v.missingInGraph).toEqual([]);
    expect(v.extraInGraph).toEqual([]);
  });

  it("applies candidate inserts, updates and deletes", async () => {
    const id = await createCandidate("Pune, India");
    await query(
      "INSERT INTO candidate_skills (candidate_id, skill_id, proficiency_level, years_experience) VALUES (?, 3, 'Advanced', 2.0), (?, 9, 'Beginner', 0.5)",
      [id, id],
    );
    await drain();

    let [node] = await cypher<{ name: string; location: string; skills: number }>(
      "MATCH (c:Candidate {id: $id}) RETURN c.name AS name, c.location AS location, COUNT { (c)-[:HAS_SKILL]->() } AS skills",
      { id },
    );
    expect(node).toEqual({ name: "Sync Tester", location: "Pune, India", skills: 2 });

    await query("UPDATE users SET name = 'Sync Renamed' WHERE user_id = ?", [id]);
    await query("UPDATE candidates SET location = 'Remote' WHERE candidate_id = ?", [id]);
    await query("UPDATE candidate_skills SET proficiency_level = 'Expert' WHERE candidate_id = ? AND skill_id = 3", [id]);
    await query("DELETE FROM candidate_skills WHERE candidate_id = ? AND skill_id = 9", [id]);
    await drain();

    [node] = await cypher("MATCH (c:Candidate {id: $id}) RETURN c.name AS name, c.location AS location, COUNT { (c)-[:HAS_SKILL]->() } AS skills", { id });
    expect(node).toEqual({ name: "Sync Renamed", location: "Remote", skills: 1 });
    const [h] = await cypher<{ p: string }>("MATCH (:Candidate {id: $id})-[h:HAS_SKILL]->(:Skill {id: 3}) RETURN h.proficiency AS p", { id });
    expect(h.p).toBe("Expert");

    // Deleting the USER cascades to candidates in MySQL without firing the
    // candidates trigger; the users AFTER DELETE trigger covers it.
    await query("DELETE FROM users WHERE user_id = ?", [id]);
    await drain();
    expect(await cypher("MATCH (c:Candidate {id: $id}) RETURN c", { id })).toHaveLength(0);
    expect((await verifyGraph()).ok).toBe(true);
  });

  it("links a job to the company derived through its recruiter and tracks status", async () => {
    const [j] = await getPool().query<ResultSetHeader>(
      `INSERT INTO jobs (recruiter_id, job_title, description, location, salary_min, salary_max)
       VALUES (11, ?, 'Sync test job', 'Pune, India', 100, 200)`,
      [`${JOB_PREFIX} Sync Job`],
    );
    await query("INSERT INTO job_skills (job_id, skill_id, required_level, is_mandatory) VALUES (?, 3, 'Advanced', TRUE)", [j.insertId]);
    await drain();

    const [row] = await cypher<{ company: string; status: string; mandatory: boolean }>(
      `MATCH (j:Job {id: $id})-[:OFFERED_BY]->(co:Company), (j)-[r:REQUIRES_SKILL]->(:Skill {id: 3})
       RETURN co.name AS company, j.status AS status, r.is_mandatory AS mandatory`,
      { id: j.insertId },
    );
    expect(row).toEqual({ company: "DataNest Analytics", status: "OPEN", mandatory: true });

    await query("UPDATE jobs SET status = 'CLOSED' WHERE job_id = ?", [j.insertId]);
    await drain();
    const [after] = await cypher<{ status: string }>("MATCH (j:Job {id: $id}) RETURN j.status AS status", { id: j.insertId });
    expect(after.status).toBe("CLOSED");
  });

  it("requestGraphSync() runs the worker in the background for API routes", async () => {
    const id = await createCandidate("Chennai, India");
    requestGraphSync();
    requestGraphSync(); // coalesced: at most one extra run
    await waitForGraphSync();
    expect(await cypher("MATCH (c:Candidate {id: $id}) RETURN c", { id })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("idempotency", () => {
  it("replaying the entire outbox twice leaves the graph unchanged", async () => {
    await drain();
    const before = await graphEntries();
    const graphOnlyBefore = await graphOnlyCounts();

    for (let round = 0; round < 2; round++) {
      await query("UPDATE graph_sync_outbox SET status = 'PENDING', processed_at = NULL WHERE status = 'DONE'");
      const r = await drain();
      expect(r.applied + r.skipped).toBeGreaterThan(200);
      expect(await graphEntries()).toEqual(before);
    }
    expect(await graphOnlyCounts()).toEqual(graphOnlyBefore);
    expect((await verifyGraph()).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("failure handling and concurrency", () => {
  it("a failing event blocks later events, then is parked as FAILED and the queue moves on", async () => {
    await drain();
    const [bad] = await getPool().query<ResultSetHeader>(
      `INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
       VALUES ('JOB', '424242', 'UPSERT', JSON_OBJECT('id', 424242))`, // missing title/status/company
    );
    const id = await createCandidate("Delhi, India"); // a valid event AFTER the poison one

    const first = await processOutbox({ maxAttempts: 2 });
    expect(first.blockedAt?.eventId).toBe(bad.insertId);
    expect(await cypher("MATCH (c:Candidate {id: $id}) RETURN c", { id })).toHaveLength(0); // ordering preserved

    const second = await processOutbox({ maxAttempts: 2 });
    expect(second.failed).toBe(1);
    expect(second.blockedAt).toBeUndefined();
    expect(await cypher("MATCH (c:Candidate {id: $id}) RETURN c", { id })).toHaveLength(1);

    const rows = await query<RowDataPacket[]>("SELECT status, attempts, last_error FROM graph_sync_outbox WHERE event_id = ?", [bad.insertId]);
    expect(rows[0]).toMatchObject({ status: "FAILED", attempts: 2 });
    expect(rows[0].last_error).toMatch(/title|status|company_id/);
  });

  it("only one worker can run at a time (MySQL GET_LOCK)", async () => {
    const holder = await getPool().getConnection();
    try {
      const [got] = await holder.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [SYNC_LOCK_NAME]);
      expect(Number(got[0].got)).toBe(1);
      const r = await processOutbox();
      expect(r.lockAcquired).toBe(false);
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [SYNC_LOCK_NAME]);
      holder.release();
    }
    expect((await processOutbox()).lockAcquired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("full rebuild", () => {
  it("repairs drift in mirrored data and keeps graph-only relationships", async () => {
    await drain();
    const graphOnlyBefore = await graphOnlyCounts();

    // Simulate drift: lost relationship, stray node, edited property
    await cypher("MATCH (:Candidate {id: 5})-[h:HAS_SKILL]->(:Skill {id: 1}) DELETE h");
    await cypher("CREATE (:Skill {id: 99999, name: 'Stray skill', category: 'Test'})");
    await cypher("MATCH (j:Job {id: 1}) SET j.title = 'Tampered title'");

    const drift = await verifyGraph();
    expect(drift.ok).toBe(false);
    expect(drift.missingInGraph.some((k) => k.startsWith("HAS_SKILL 5->1"))).toBe(true);
    expect(drift.extraInGraph.some((k) => k.startsWith("Skill 99999"))).toBe(true);

    await rebuildGraph();
    const after = await verifyGraph();
    expect(after.missingInGraph).toEqual([]);
    expect(after.extraInGraph).toEqual([]);
    expect(await graphOnlyCounts()).toEqual(graphOnlyBefore);
  });
});
