import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { SessionUser } from "@/lib/contracts";
import { getPool, query } from "@/lib/db";
import { processOutbox } from "@/lib/graph-sync";
import { signSession } from "@/lib/session";
import { waitForGraphSync } from "@/lib/sync-trigger";
import { TEST_DOMAIN, testEmail } from "./helpers";

/** Candidate fixtures for Phase 5 tests (Member B). */

export interface TestCandidate {
  id: number;
  token: string;
  user: SessionUser;
}

export async function createTestCandidate(opts: {
  name?: string;
  resume?: boolean;
  skills?: Array<[skillId: number, level: string]>;
} = {}): Promise<TestCandidate> {
  const name = opts.name ?? "Vitest Candidate";
  const [u] = await getPool().query<ResultSetHeader>(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, 'x', 'Candidate')",
    [name, testEmail("cand")],
  );
  await query("INSERT INTO candidates (candidate_id, location, experience_years, resume_url) VALUES (?, 'Remote', 1.0, ?)", [
    u.insertId,
    opts.resume === false ? null : "https://cdn.skillmatch.io/resumes/vitest.pdf",
  ]);
  for (const [skillId, level] of opts.skills ?? []) {
    await query("INSERT INTO candidate_skills (candidate_id, skill_id, proficiency_level) VALUES (?, ?, ?)", [u.insertId, skillId, level]);
  }
  const user: SessionUser = { userId: u.insertId, role: "Candidate", name };
  return { id: u.insertId, user, token: await signSession(user) };
}

export const tokenFor = (user: SessionUser) => signSession(user);

/**
 * Delete every @vitest.local user, apply the resulting DELETE events to Neo4j
 * (so no stray nodes remain), then remove those users' outbox history.
 */
export async function cleanupCandidatesAndGraph(): Promise<void> {
  await waitForGraphSync();
  const rows = await query<RowDataPacket[]>("SELECT user_id FROM users WHERE email LIKE ?", [`%@${TEST_DOMAIN}`]);
  const ids = rows.map((r) => String(r.user_id));
  if (ids.length === 0) return;
  await query("DELETE FROM users WHERE email LIKE ?", [`%@${TEST_DOMAIN}`]);
  await processOutbox();
  await query(
    `DELETE FROM graph_sync_outbox
      WHERE (entity_type = 'CANDIDATE' AND entity_id IN (?))
         OR (entity_type = 'CANDIDATE_SKILL' AND SUBSTRING_INDEX(entity_id, ':', 1) IN (?))`,
    [ids, ids],
  );
}

export const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
