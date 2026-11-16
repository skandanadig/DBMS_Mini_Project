import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as apply } from "@/app/api/jobs/[id]/apply/route";
import { GET as myApplications } from "@/app/api/me/applications/route";
import { closePool, query } from "@/lib/db";
import { closeDriver } from "@/lib/neo4j";
import { cleanupCandidatesAndGraph, createTestCandidate, params, tokenFor } from "./candidate-fixtures";
import { makeRequest } from "./helpers";

/**
 * POST /api/jobs/:id/apply -> sp_submit_application (ACID transaction).
 * Every business outcome of the procedure, RBAC, and concurrency.
 */

const SARAH = { userId: 2, role: "Recruiter" as const, name: "Sarah Jenkins" };
const applyAs = (token: string | undefined, jobId: number | string) =>
  apply(makeRequest(`/api/jobs/${jobId}/apply`, { method: "POST", token }), params(jobId));

beforeAll(cleanupCandidatesAndGraph);
afterAll(async () => {
  await cleanupCandidatesAndGraph();
  await Promise.all([closePool(), closeDriver()]);
});

describe("POST /api/jobs/:id/apply", () => {
  it("SUCCESS -> 201; the DB computes the match score and writes the first audit row", async () => {
    // Python Beginner only; job 12 needs Python, MySQL, Pandas (all Beginner, mandatory) -> 33.33
    const c = await createTestCandidate({ skills: [[3, "Beginner"]] });
    const res = await applyAs(c.token, 12);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ statusCode: "SUCCESS" });

    const [app] = await query<RowDataPacket[]>("SELECT status, match_score, resume_snapshot_url FROM applications WHERE application_id = ?", [body.applicationId]);
    expect(app).toMatchObject({ status: "APPLIED", match_score: 33.33, resume_snapshot_url: "https://cdn.skillmatch.io/resumes/vitest.pdf" });

    const list = await (await myApplications(makeRequest("/api/me/applications", { token: c.token }))).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ jobId: 12, status: "APPLIED", companyName: "MediCore Health Systems" });
    expect(list.data[0].timeline).toEqual([expect.objectContaining({ oldStatus: null, newStatus: "APPLIED", remarks: "Application submitted" })]);

    // DUPLICATE -> 409
    const dup = await applyAs(c.token, 12);
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toMatchObject({ code: "CONFLICT", details: { statusCode: "DUPLICATE" } });
  });

  it("FAILED (closed job) -> 422 with the procedure's message", async () => {
    const c = await createTestCandidate();
    const res = await applyAs(c.token, 5);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({
      code: "DB_RULE",
      message: "Cannot apply: Job posting is currently not active.",
      details: { statusCode: "FAILED" },
    });
  });

  it("FAILED (no resume) -> 422 and nothing is inserted", async () => {
    const c = await createTestCandidate({ resume: false });
    const res = await applyAs(c.token, 1);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("Candidate profile must have a valid resume before applying.");
    const rows = await query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM applications WHERE candidate_id = ?", [c.id]);
    expect(rows[0].n).toBe(0);
  });

  it("NOT_FOUND -> 404 for a missing job; malformed ids are 404 too", async () => {
    const c = await createTestCandidate();
    expect((await applyAs(c.token, 999999)).status).toBe(404);
    expect((await applyAs(c.token, "abc")).status).toBe(404);
  });

  it("RBAC: recruiters get 403, anonymous users 401", async () => {
    expect((await applyAs(await tokenFor(SARAH), 1)).status).toBe(403);
    expect((await applyAs(undefined, 1)).status).toBe(401);
    expect((await myApplications(makeRequest("/api/me/applications", { token: await tokenFor(SARAH) }))).status).toBe(403);
  });

  it("concurrent double-submit: exactly one succeeds (row lock + UNIQUE constraint)", async () => {
    const c = await createTestCandidate();
    const results = await Promise.all([applyAs(c.token, 9), applyAs(c.token, 9), applyAs(c.token, 9)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    const rows = await query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM applications WHERE candidate_id = ? AND job_id = 9", [c.id]);
    expect(rows[0].n).toBe(1);
  });
});
