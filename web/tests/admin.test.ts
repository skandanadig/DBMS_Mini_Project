import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as auditLogs } from "@/app/api/admin/audit-logs/route";
import { GET as companies } from "@/app/api/admin/companies/route";
import { POST as retryOutbox } from "@/app/api/admin/outbox/retry/route";
import { GET as outbox } from "@/app/api/admin/outbox/route";
import { POST as syncOutbox } from "@/app/api/admin/outbox/sync/route";
import { GET as overview } from "@/app/api/admin/overview/route";
import { PUT as updateSkill } from "@/app/api/admin/skills/[id]/route";
import { GET as adminSkills, POST as createSkill } from "@/app/api/admin/skills/route";
import { GET as listUsers, POST as createUser } from "@/app/api/admin/users/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as recruiterDashboard } from "@/app/api/recruiter/dashboard/route";
import type { AdminOverview } from "@/lib/contracts";
import { closePool, getPool, query } from "@/lib/db";
import { processOutbox } from "@/lib/graph-sync";
import { closeDriver, getDriver } from "@/lib/neo4j";
import { signSession } from "@/lib/session";
import { waitForGraphSync } from "@/lib/sync-trigger";
import { cleanupTestUsers, makeRequest, sessionTokenFrom, testEmail } from "./helpers";

/** Admin-only features: privileged account creation, taxonomy, audit trail, outbox monitor. */

const ADMIN = { userId: 1, role: "Admin" as const, name: "System Administrator" };
const SARAH = { userId: 2, role: "Recruiter" as const, name: "Sarah Jenkins" };
const RAHUL = { userId: 5, role: "Candidate" as const, name: "Rahul Sharma" };
const SKILL_PREFIX = "VITEST";
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

let adminToken = "";
const req = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
  makeRequest(path, { token: adminToken, ...init });

async function neo4jSkill(id: number) {
  const session = getDriver().session();
  try {
    const r = await session.run("MATCH (s:Skill {id: $id}) RETURN s.name AS name, s.category AS category", { id });
    return r.records[0]?.toObject() ?? null;
  } finally {
    await session.close();
  }
}

async function cleanupSkills() {
  await waitForGraphSync();
  const rows = await query<RowDataPacket[]>("SELECT skill_id FROM skills WHERE skill_name LIKE ?", [`${SKILL_PREFIX}%`]);
  const ids = rows.map((r) => String(r.skill_id));
  await query("DELETE FROM graph_sync_outbox WHERE entity_type = 'SKILL' AND entity_id = '1' AND last_error = 'vitest'");
  if (ids.length === 0) return;
  await query("DELETE FROM skills WHERE skill_name LIKE ?", [`${SKILL_PREFIX}%`]);
  await processOutbox(); // apply the SKILL DELETE events to Neo4j
  await query("DELETE FROM graph_sync_outbox WHERE entity_type = 'SKILL' AND entity_id IN (?)", [ids]);
}

beforeAll(async () => {
  adminToken = await signSession(ADMIN);
  await cleanupTestUsers();
  await cleanupSkills();
});
afterAll(async () => {
  await cleanupTestUsers();
  await cleanupSkills();
  await Promise.all([closePool(), closeDriver()]);
});

// ---------------------------------------------------------------------------
describe("RBAC on every admin route", () => {
  const routes: Array<[string, (r: NextRequest) => Promise<Response>]> = [
    ["/api/admin/overview", overview],
    ["/api/admin/users", listUsers],
    ["/api/admin/companies", companies],
    ["/api/admin/skills", adminSkills],
    ["/api/admin/audit-logs", auditLogs],
    ["/api/admin/outbox", outbox],
  ];

  it.each(routes)("%s: admin 200, recruiter/candidate 403, anonymous 401", async (path, handler) => {
    expect((await handler(req(path))).status).toBe(200);
    expect((await handler(makeRequest(path, { token: await signSession(SARAH) }))).status).toBe(403);
    expect((await handler(makeRequest(path, { token: await signSession(RAHUL) }))).status).toBe(403);
    expect((await handler(makeRequest(path))).status).toBe(401);
  });

  it("mutating admin routes are admin-only too", async () => {
    const sarah = await signSession(SARAH);
    const body = { role: "Admin", name: "Mallory", email: testEmail("mallory"), password: "longenough1" };
    expect((await createUser(makeRequest("/api/admin/users", { method: "POST", token: sarah, body }))).status).toBe(403);
    expect((await createSkill(makeRequest("/api/admin/skills", { method: "POST", token: sarah, body: { skillName: "X", category: "Y" } }))).status).toBe(403);
    expect((await syncOutbox(makeRequest("/api/admin/outbox/sync", { method: "POST", token: sarah }))).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/admin/overview", () => {
  it("matches direct SQL counts and the top-demanded-skills view", async () => {
    const body = (await (await overview(req("/api/admin/overview"))).json()) as AdminOverview;
    const [roles] = await query<RowDataPacket[]>("SELECT SUM(role='Candidate') c, SUM(role='Recruiter') r, SUM(role='Admin') a FROM users");
    expect(body.users).toEqual({ Candidate: Number(roles.c), Recruiter: Number(roles.r), Admin: Number(roles.a) });
    const [apps] = await query<RowDataPacket[]>("SELECT COUNT(*) n FROM applications");
    expect(Object.values(body.applications).reduce((a, b) => a + b, 0)).toBe(Number(apps.n));

    const [top] = await query<RowDataPacket[]>(
      "SELECT skill_name, demanding_jobs_count FROM vw_top_demanded_skills ORDER BY demanding_jobs_count DESC, mandatory_in_jobs DESC, skill_name LIMIT 1",
    );
    expect(body.topDemandedSkills[0]).toMatchObject({ name: top.skill_name, demandingJobs: Number(top.demanding_jobs_count) });
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/admin/users (the only way to create Recruiter/Admin accounts)", () => {
  it("creates a recruiter linked to a company who can log in and use the recruiter dashboard", async () => {
    const email = testEmail("recruiter");
    const res = await createUser(
      req("/api/admin/users", { method: "POST", body: { role: "Recruiter", name: "New Recruiter", email, password: "longenough1", companyId: 4, designation: "Talent Partner" } }),
    );
    expect(res.status).toBe(201);
    const { user } = await res.json();
    expect(user).toMatchObject({ role: "Recruiter", email });

    const [row] = await query<RowDataPacket[]>(
      "SELECT u.role, r.company_id, r.designation FROM users u JOIN recruiters r ON r.recruiter_id = u.user_id WHERE u.user_id = ?",
      [user.userId],
    );
    expect(row).toEqual({ role: "Recruiter", company_id: 4, designation: "Talent Partner" });

    const loginRes = await login(makeRequest("/api/auth/login", { method: "POST", body: { email, password: "longenough1" } }));
    expect(loginRes.status).toBe(200);
    const dash = await recruiterDashboard(makeRequest("/api/recruiter/dashboard", { token: sessionTokenFrom(loginRes) }));
    expect((await dash.json()).company.companyName).toBe("DataNest Analytics");
  });

  it("creates an admin without a recruiter profile", async () => {
    const res = await createUser(req("/api/admin/users", { method: "POST", body: { role: "Admin", name: "Second Admin", email: testEmail("admin"), password: "longenough1" } }));
    expect(res.status).toBe(201);
    const { user } = await res.json();
    const rows = await query<RowDataPacket[]>("SELECT 1 FROM recruiters WHERE recruiter_id = ?", [user.userId]);
    expect(rows).toHaveLength(0);
  });

  it("rejects Candidate role and incomplete recruiter input (400)", async () => {
    const base = { name: "X", email: testEmail("bad"), password: "longenough1" };
    expect((await createUser(req("/api/admin/users", { method: "POST", body: { ...base, role: "Candidate" } }))).status).toBe(400);
    expect((await createUser(req("/api/admin/users", { method: "POST", body: { ...base, role: "Recruiter", designation: "x" } }))).status).toBe(400);
  });

  it("unknown company -> 422 (FK) and the users row is rolled back", async () => {
    const email = testEmail("nocompany");
    const res = await createUser(req("/api/admin/users", { method: "POST", body: { role: "Recruiter", name: "Ghost", email, password: "longenough1", companyId: 99999, designation: "x" } }));
    expect(res.status).toBe(422);
    const rows = await query<RowDataPacket[]>("SELECT COUNT(*) n FROM users WHERE email = ?", [email]);
    expect(Number(rows[0].n)).toBe(0);
  });

  it("duplicate email -> 409", async () => {
    const res = await createUser(req("/api/admin/users", { method: "POST", body: { role: "Admin", name: "Dup", email: "sarah.j@techcorp.com", password: "longenough1" } }));
    expect(res.status).toBe(409);
  });

  it("lists and filters users", async () => {
    const recruiters = await (await listUsers(req("/api/admin/users?role=Recruiter&pageSize=100"))).json();
    expect(recruiters.data.every((u: { role: string }) => u.role === "Recruiter")).toBe(true);
    expect(recruiters.data.find((u: { userId: number }) => u.userId === 2)).toMatchObject({ companyName: "TechCorp Solutions", activity: expect.any(Number) });
    const search = await (await listUsers(req("/api/admin/users?q=techcorp"))).json();
    expect(search.data.map((u: { email: string }) => u.email)).toContain("sarah.j@techcorp.com");
  });
});

// ---------------------------------------------------------------------------
describe("/api/admin/skills (taxonomy, mirrored to Neo4j)", () => {
  it("creates and renames a skill; both changes reach the graph through the outbox", async () => {
    const created = await createSkill(req("/api/admin/skills", { method: "POST", body: { skillName: `${SKILL_PREFIX} Rust`, category: "Languages" } }));
    expect(created.status).toBe(201);
    const { skillId } = await created.json();

    const list = await (await adminSkills(req("/api/admin/skills"))).json();
    expect(list.data.find((s: { skillId: number }) => s.skillId === skillId)).toMatchObject({ candidates: 0, jobs: 0, openJobs: 0 });

    await waitForGraphSync();
    expect(await neo4jSkill(skillId)).toEqual({ name: `${SKILL_PREFIX} Rust`, category: "Languages" });

    const renamed = await updateSkill(req(`/api/admin/skills/${skillId}`, { method: "PUT", body: { skillName: `${SKILL_PREFIX} Rust Lang`, category: "Systems" } }), ctx(skillId));
    expect(renamed.status).toBe(200);
    await waitForGraphSync();
    expect(await neo4jSkill(skillId)).toEqual({ name: `${SKILL_PREFIX} Rust Lang`, category: "Systems" });
  });

  it("duplicate name -> 409 (UNIQUE); unknown id -> 404; blank -> 400", async () => {
    const dup = await createSkill(req("/api/admin/skills", { method: "POST", body: { skillName: "Python", category: "Languages" } }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.message).toBe("A skill with this name already exists.");
    expect((await updateSkill(req("/api/admin/skills/999999", { method: "PUT", body: { skillName: `${SKILL_PREFIX} X`, category: "Y" } }), ctx(999999))).status).toBe(404);
    expect((await createSkill(req("/api/admin/skills", { method: "POST", body: { skillName: "   ", category: "Y" } }))).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/admin/audit-logs", () => {
  it("pages through trigger-written history with filters", async () => {
    const offered = await (await auditLogs(req("/api/admin/audit-logs?status=OFFERED&pageSize=100"))).json();
    expect(offered.total).toBeGreaterThan(0);
    expect(offered.data.every((l: { newStatus: string }) => l.newStatus === "OFFERED")).toBe(true);
    expect(offered.data[0]).toMatchObject({ changedByRole: "Recruiter", remarks: expect.any(String) });

    const search = await (await auditLogs(req("/api/admin/audit-logs?q=offer%20released"))).json();
    expect(search.data.length).toBeGreaterThan(0);
    expect((await auditLogs(req("/api/admin/audit-logs?status=HIRED"))).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("outbox monitor", () => {
  it("lists a FAILED event, retries it, and the sync endpoint applies it and verifies the graph", async () => {
    // A parked event whose cause has since been fixed (valid payload for skill 1)
    const [skill] = await query<RowDataPacket[]>("SELECT skill_name, category FROM skills WHERE skill_id = 1");
    const [ins] = await getPool().query<ResultSetHeader>(
      `INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload, status, attempts, last_error, processed_at)
       VALUES ('SKILL', '1', 'UPSERT', JSON_OBJECT('id', 1, 'name', ?, 'category', ?), 'FAILED', 5, 'vitest', NOW())`,
      [skill.skill_name, skill.category],
    );

    const failed = await (await outbox(req("/api/admin/outbox?status=FAILED"))).json();
    expect(failed.data.map((e: { eventId: number }) => e.eventId)).toContain(ins.insertId);
    expect(failed.stats.FAILED).toBeGreaterThanOrEqual(1);

    const retry = await (await retryOutbox(req("/api/admin/outbox/retry", { method: "POST", body: { eventIds: [ins.insertId, 1] } }))).json();
    expect(retry.retried).toBe(1); // event 1 is not FAILED, so it is left alone

    const sync = await (await syncOutbox(req("/api/admin/outbox/sync", { method: "POST" }))).json();
    expect(sync.sync.lockAcquired).toBe(true);
    expect(sync.verify.ok).toBe(true);
    const [row] = await query<RowDataPacket[]>("SELECT status, attempts, last_error FROM graph_sync_outbox WHERE event_id = ?", [ins.insertId]);
    expect(row).toMatchObject({ status: "DONE", last_error: null });

    await query("DELETE FROM graph_sync_outbox WHERE event_id = ?", [ins.insertId]);
  });
});
