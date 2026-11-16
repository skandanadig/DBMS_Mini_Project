import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATCH as patchStatus } from "@/app/api/recruiter/applications/[id]/status/route";
import { GET as dashboard } from "@/app/api/recruiter/dashboard/route";
import { GET as applicants } from "@/app/api/recruiter/jobs/[id]/applicants/route";
import type { ApplicantsResponse, RecruiterDashboard } from "@/lib/contracts";
import { closePool, getPool, query } from "@/lib/db";
import { processOutbox } from "@/lib/graph-sync";
import { closeDriver } from "@/lib/neo4j";
import { signSession } from "@/lib/session";
import { cleanupCandidatesAndGraph, createTestCandidate } from "./candidate-fixtures";
import { makeRequest } from "./helpers";

/** Recruiter dashboard, applicants with SQL vs graph ranking, status changes via the procedure. */

const SARAH = { userId: 2, role: "Recruiter" as const, name: "Sarah Jenkins" }; // jobs 1, 2, 13
const ARUN = { userId: 3, role: "Recruiter" as const, name: "Arun Kumar" };
const RAHUL = { userId: 5, role: "Candidate" as const, name: "Rahul Sharma" };
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  await cleanupCandidatesAndGraph();
  await processOutbox(); // graph ranking needs Neo4j in sync
});
afterAll(async () => {
  await cleanupCandidatesAndGraph();
  await Promise.all([closePool(), closeDriver()]);
});

describe("GET /api/recruiter/dashboard", () => {
  it("aggregates the recruiter's own pipeline (view + stored procedure + audit-trail funnel)", async () => {
    const res = await dashboard(makeRequest("/api/recruiter/dashboard", { token: await signSession(SARAH) }));
    const body = (await res.json()) as RecruiterDashboard;
    expect(body.company.companyName).toBe("TechCorp Solutions");
    expect(body.pipeline.map((p) => p.jobId).sort((a, b) => a - b)).toEqual([1, 2, 13]);
    expect(body.kpis).toMatchObject({ openJobs: 3, totalApplicants: 10, inReview: 2, interviews: 2, offers: 1 });
    // ever-reached counts: every application was APPLIED; 6 reached review, 3 interview, 1 offer
    expect(body.funnel).toEqual([
      { stage: "APPLIED", count: 10 },
      { stage: "UNDER_REVIEW", count: 6 },
      { stage: "INTERVIEW_SCHEDULED", count: 3 },
      { stage: "OFFERED", count: 1 },
    ]);
  });

  it("is recruiter-only", async () => {
    expect((await dashboard(makeRequest("/api/recruiter/dashboard", { token: await signSession(RAHUL) }))).status).toBe(403);
    expect((await dashboard(makeRequest("/api/recruiter/dashboard"))).status).toBe(401);
  });
});

describe("GET /api/recruiter/jobs/:id/applicants", () => {
  it("ranks applicants with RANK() and compares SQL vs graph ranking of the talent pool", async () => {
    const res = await applicants(makeRequest("/api/recruiter/jobs/1/applicants", { token: await signSession(SARAH) }), ctx(1));
    const body = (await res.json()) as ApplicantsResponse;

    expect(body.applicants).toHaveLength(5);
    expect(body.applicants[0]).toMatchObject({ name: "Rahul Sharma", sqlRank: 1, currentScore: 90, status: "INTERVIEW_SCHEDULED" });
    expect(body.applicants[0].nextStatuses).toEqual(["OFFERED", "REJECTED"]);

    const { ranking } = body;
    expect(ranking.graphAvailable).toBe(true);
    expect(ranking.overlap).toBeGreaterThan(0);
    const byName = Object.fromEntries(ranking.rows.map((r) => [r.name, r]));
    expect(byName["Rahul Sharma"]).toMatchObject({ sqlRank: 1, graphRank: 1, hasApplied: true });
    // Meera and Vikram tie in SQL (60.00); the graph separates them via related skills
    expect(byName["Meera Joshi"]).toMatchObject({ sqlScore: 60, sqlRank: 2, graphScore: 67, graphRank: 2 });
    expect(byName["Vikram Malhotra"]).toMatchObject({ sqlRank: 2, graphRank: 3 });
    // Kavya (SQL 10%, tied 7th) earns related-skill credit in the graph (28.4%)
    // and overtakes Karthik (SQL 20%, 6th), whose skills have no related paths
    expect(byName["Kavya Pillai"]).toMatchObject({ sqlRank: 7, graphRank: 6, rankChange: 1 });
    expect(byName["Karthik Reddy"]).toMatchObject({ sqlRank: 6, graphRank: 7, rankChange: -1 });
  });

  it("only the owning recruiter can see applicants", async () => {
    expect((await applicants(makeRequest("/api/recruiter/jobs/1/applicants", { token: await signSession(ARUN) }), ctx(1))).status).toBe(403);
    expect((await applicants(makeRequest("/api/recruiter/jobs/999999/applicants", { token: await signSession(SARAH) }), ctx(999999))).status).toBe(404);
  });
});

describe("PATCH /api/recruiter/applications/:id/status", () => {
  async function newApplication(): Promise<number> {
    const c = await createTestCandidate();
    const [r] = await getPool().query<ResultSetHeader>("INSERT INTO applications (job_id, candidate_id) VALUES (13, ?)", [c.id]);
    return r.insertId;
  }
  const patch = async (user: typeof SARAH, id: number, body: unknown) => {
    const res = await patchStatus(makeRequest(`/api/recruiter/applications/${id}/status`, { method: "PATCH", token: await signSession(user), body }), ctx(id));
    return { status: res.status, body: await res.json() };
  };

  it("moves the application through the procedure and audits remarks + recruiter", async () => {
    const id = await newApplication();
    const r = await patch(SARAH, id, { status: "UNDER_REVIEW", remarks: "Strong TypeScript portfolio" });
    expect(r).toMatchObject({ status: 200, body: { status: "UNDER_REVIEW", nextStatuses: ["INTERVIEW_SCHEDULED", "REJECTED"] } });

    const [log] = await query<RowDataPacket[]>(
      "SELECT old_status, new_status, changed_by, remarks FROM application_audit_logs WHERE application_id = ? ORDER BY log_id DESC LIMIT 1",
      [id],
    );
    expect(log).toEqual({ old_status: "APPLIED", new_status: "UNDER_REVIEW", changed_by: 2, remarks: "Strong TypeScript portfolio" });
  });

  it("an invalid transition is rejected by the MySQL trigger (422)", async () => {
    const id = await newApplication();
    const r = await patch(SARAH, id, { status: "OFFERED" });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toBe("Invalid status transition: APPLIED -> OFFERED.");
  });

  it("another recruiter gets 403, unknown application 404, bad status 400", async () => {
    const id = await newApplication();
    expect((await patch(ARUN, id, { status: "UNDER_REVIEW" })).status).toBe(403);
    expect((await patch(SARAH, 999999, { status: "UNDER_REVIEW" })).status).toBe(404);
    expect((await patch(SARAH, id, { status: "HIRED" })).status).toBe(400);
    const [row] = await query<RowDataPacket[]>("SELECT status FROM applications WHERE application_id = ?", [id]);
    expect(row.status).toBe("APPLIED");
  });
});
