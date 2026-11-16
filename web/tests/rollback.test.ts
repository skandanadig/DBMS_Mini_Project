import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as apply } from "@/app/api/jobs/[id]/apply/route";
import { GET as getProfile, PUT as putProfile } from "@/app/api/me/profile/route";
import { closePool, query } from "@/lib/db";
import { getDriver } from "@/lib/neo4j";
import { closeDriver } from "@/lib/neo4j";
import { waitForGraphSync } from "@/lib/sync-trigger";
import { cleanupCandidatesAndGraph, createTestCandidate, params } from "./candidate-fixtures";
import { makeRequest } from "./helpers";

/**
 * PUT /api/me/profile updates `users` and `candidates` in ONE transaction.
 * MySQL CHECK constraints are the validation layer for formats; any
 * violation must roll back BOTH tables and surface as 422 DB_RULE.
 */

const valid = {
  name: "Updated Name",
  phone: "+91-9000000000",
  location: "Mysuru, India",
  experienceYears: 3.5,
  resumeUrl: "https://cdn.skillmatch.io/resumes/updated.pdf",
  headline: "Data Engineer",
  bio: "Test bio",
};

const put = (token: string, body: unknown) => putProfile(makeRequest("/api/me/profile", { method: "PUT", token, body }));

async function userName(id: number): Promise<string> {
  const rows = await query<RowDataPacket[]>("SELECT name FROM users WHERE user_id = ?", [id]);
  return rows[0].name;
}

beforeAll(cleanupCandidatesAndGraph);
afterAll(async () => {
  await cleanupCandidatesAndGraph();
  await Promise.all([closePool(), closeDriver()]);
});

describe("PUT /api/me/profile (multi-table transaction)", () => {
  it("updates both tables and the change reaches Neo4j through the outbox", async () => {
    const c = await createTestCandidate({ name: "Before Name" });
    const res = await put(c.token, valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Updated Name", location: "Mysuru, India", experienceYears: 3.5 });

    await waitForGraphSync();
    const session = getDriver().session();
    try {
      const r = await session.run("MATCH (c:Candidate {id: $id}) RETURN c.name AS name, c.location AS location", { id: c.id });
      expect(r.records[0]?.toObject()).toEqual({ name: "Updated Name", location: "Mysuru, India" });
    } finally {
      await session.close();
    }
  });

  it.each([
    ["phone", { phone: "call me!!" }, "chk_candidate_phone"],
    ["resume URL", { resumeUrl: "not-a-url" }, "chk_candidate_resume_url"],
    ["experience range", { experienceYears: 75 }, "chk_experience_range"],
  ])("a CHECK violation (%s) rolls back the users.name change too", async (_label, patch, constraint) => {
    const c = await createTestCandidate({ name: "Original Name" });
    const res = await put(c.token, { ...valid, ...patch });
    expect(res.status).toBe(422);
    const err = (await res.json()).error;
    expect(err.code).toBe("DB_RULE");
    expect(err.message).toContain(constraint);
    expect(await userName(c.id)).toBe("Original Name"); // first UPDATE was rolled back
  });

  it("400 for structurally invalid input (before reaching the DB)", async () => {
    const c = await createTestCandidate();
    const res = await put(c.token, { ...valid, name: "" });
    expect(res.status).toBe(400);
  });

  it("adding a resume through the profile unblocks applying", async () => {
    const c = await createTestCandidate({ resume: false });
    expect((await apply(makeRequest("/api/jobs/12/apply", { method: "POST", token: c.token }), params(12))).status).toBe(422);
    expect((await put(c.token, valid)).status).toBe(200);
    expect((await apply(makeRequest("/api/jobs/12/apply", { method: "POST", token: c.token }), params(12))).status).toBe(201);
    const profile = await (await getProfile(makeRequest("/api/me/profile", { token: c.token }))).json();
    expect(profile.resumeUrl).toBe(valid.resumeUrl);
  });
});
