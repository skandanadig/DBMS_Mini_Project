import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as jobDetail } from "@/app/api/jobs/[id]/route";
import { GET as jobMatch } from "@/app/api/jobs/[id]/match/route";
import { GET as listJobs } from "@/app/api/jobs/route";
import { GET as recommendations } from "@/app/api/me/recommendations/route";
import { DELETE as deleteSkill, GET as getSkills, POST as addSkill } from "@/app/api/me/skills/route";
import { GET as skillOptions } from "@/app/api/skills/route";
import type { JobSummary } from "@/lib/contracts";
import { closePool, query } from "@/lib/db";
import { processOutbox } from "@/lib/graph-sync";
import { closeDriver, getDriver } from "@/lib/neo4j";
import { waitForGraphSync } from "@/lib/sync-trigger";
import { cleanupCandidatesAndGraph, createTestCandidate, params, tokenFor } from "./candidate-fixtures";
import { makeRequest } from "./helpers";

/** Job board (FULLTEXT + filters), job detail, SQL+graph match, recommendations, skills CRUD. */

const RAHUL = { userId: 5, role: "Candidate" as const, name: "Rahul Sharma" };
const MEERA = { userId: 19, role: "Candidate" as const, name: "Meera Joshi" };
const POOJA = { userId: 23, role: "Candidate" as const, name: "Pooja Desai" };
const SARAH = { userId: 2, role: "Recruiter" as const, name: "Sarah Jenkins" };

async function search(qs: string, token?: string) {
  const res = await listJobs(makeRequest(`/api/jobs?${qs}`, { token }));
  return { status: res.status, body: await res.json() };
}
const ids = (data: JobSummary[]) => data.map((j) => j.jobId).sort((a, b) => a - b);

beforeAll(async () => {
  await cleanupCandidatesAndGraph();
  await processOutbox(); // graph assertions need Neo4j in sync with MySQL
});
afterAll(async () => {
  await cleanupCandidatesAndGraph();
  await Promise.all([closePool(), closeDriver()]);
});

// ---------------------------------------------------------------------------
describe("GET /api/jobs", () => {
  it("lists only OPEN jobs with pagination and facets", async () => {
    const { body } = await search("pageSize=5");
    expect(body.total).toBe(12); // 15 seeded - 2 CLOSED - 1 ARCHIVED
    expect(body.data).toHaveLength(5);
    expect(body.facets.employmentTypes).toEqual(expect.arrayContaining(["Full-time", "Internship", "Contract"]));
    const page3 = await search("pageSize=5&page=3");
    expect(page3.body.data).toHaveLength(2);
  });

  it("FULLTEXT search with prefix matching ranks relevant OPEN jobs only", async () => {
    const { body } = await search("q=kube");
    expect(ids(body.data)).toEqual([3, 10]); // job 15 (ARCHIVED) also mentions Kubernetes
    expect(body.data[0].relevance).toBeGreaterThan(0);
  });

  it("neutralises boolean-mode operators typed by the user", async () => {
    const { status, body } = await search(`q=${encodeURIComponent('+kubernetes -"aws (*')}`);
    expect(status).toBe(200);
    expect(ids(body.data)).toEqual(expect.arrayContaining([3, 10]));
  });

  it("filters by type, location, minimum salary and required skill", async () => {
    expect(ids((await search("type=Internship")).body.data)).toEqual([12]);
    expect(ids((await search(`location=${encodeURIComponent("Pune, India")}`)).body.data)).toEqual([7, 8]);
    expect(ids((await search("minSalary=3000000")).body.data)).toEqual([3, 6, 10]);
    expect(ids((await search("skillId=17")).body.data)).toEqual([6]); // Java
  });

  it("rejects invalid filter values with 400", async () => {
    expect((await search("type=Freelance")).status).toBe(400);
    expect((await search("pageSize=500")).status).toBe(400);
  });

  it("adds the candidate's own fn_match_score and sorts by it", async () => {
    const { body } = await search("", await tokenFor(RAHUL));
    expect(body.data[0]).toMatchObject({ jobId: 2, matchScore: 100 });
    const scores = body.data.map((j: JobSummary) => j.matchScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect((await search("")).body.data[0].matchScore).toBeUndefined(); // anonymous
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/jobs/:id", () => {
  it("returns details and required skills; personal fields only for candidates", async () => {
    const anon = await (await jobDetail(makeRequest("/api/jobs/1"), params(1))).json();
    expect(anon).toMatchObject({ jobId: 1, companyName: "TechCorp Solutions", status: "OPEN" });
    expect(anon.skills).toHaveLength(6);
    expect(anon.application).toBeUndefined();

    const mine = await (await jobDetail(makeRequest("/api/jobs/1", { token: await tokenFor(RAHUL) }), params(1))).json();
    expect(mine).toMatchObject({ matchScore: 90, application: { status: "INTERVIEW_SCHEDULED" } });
  });

  it("404 for missing or malformed ids", async () => {
    expect((await jobDetail(makeRequest("/api/jobs/999999"), params(999999))).status).toBe(404);
    expect((await jobDetail(makeRequest("/api/jobs/x"), params("x"))).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/jobs/:id/match (SQL + Neo4j)", () => {
  it("SQL breakdown + graph credit for a related skill (Meera vs job 1)", async () => {
    const res = await jobMatch(makeRequest("/api/jobs/1/match", { token: await tokenFor(MEERA) }), params(1));
    const body = await res.json();
    expect(body).toMatchObject({ exactScore: 60, graphAvailable: true, graphScore: 67 });
    expect(body.skills.find((s: { name: string }) => s.name === "Node.js")).toMatchObject({ state: "MISSING", mandatory: true });
    expect(body.related.find((r: { skill: string }) => r.skill === "Node.js")).toMatchObject({ via: ["GraphQL", "Node.js"], similarity: 0.7 });
  });

  it("SQL exactScore equals the graph's exact score for the same pair", async () => {
    const body = await (await jobMatch(makeRequest("/api/jobs/7/match", { token: await tokenFor(RAHUL) }), params(7))).json();
    const [row] = await query<Array<{ s: number }>>("SELECT fn_match_score(5, 7) AS s");
    expect(body.exactScore).toBe(row.s);
    expect(body.graphScore).toBeGreaterThanOrEqual(body.exactScore);
  });

  it("finds a referral path to the hiring company (Pooja -> Ananya -> Rahul @ TechCorp)", async () => {
    const body = await (await jobMatch(makeRequest("/api/jobs/1/match", { token: await tokenFor(POOJA) }), params(1))).json();
    expect(body.referrals[0]).toMatchObject({ referrer: "Rahul Sharma", degrees: 2, chain: ["Pooja Desai", "Ananya Sen", "Rahul Sharma"] });
  });

  it("is candidate-only", async () => {
    expect((await jobMatch(makeRequest("/api/jobs/1/match", { token: await tokenFor(SARAH) }), params(1))).status).toBe(403);
    expect((await jobMatch(makeRequest("/api/jobs/1/match"), params(1))).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/me/recommendations (Neo4j)", () => {
  it("recommends OPEN jobs the candidate has not applied to, plus skills to learn", async () => {
    const body = await (await recommendations(makeRequest("/api/me/recommendations", { token: await tokenFor(MEERA) }))).json();
    expect(body.graphAvailable).toBe(true);
    expect(body.jobs.length).toBeGreaterThan(0);
    const applied = [1, 2, 13]; // Meera's seeded applications
    expect(body.jobs.some((j: { jobId: number }) => applied.includes(j.jobId))).toBe(false);
    expect(body.learnNext.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("/api/me/skills", () => {
  it("adds, updates and removes skills; changes reach Neo4j in the background", async () => {
    const c = await createTestCandidate();
    const post = (body: unknown) => addSkill(makeRequest("/api/me/skills", { method: "POST", token: c.token, body }));

    expect((await post({ skillId: 3, proficiency: "Intermediate", years: 1 })).status).toBe(200);
    let list = await (await post({ skillId: 3, proficiency: "Advanced", years: 2 })).json(); // upsert
    expect(list.data).toEqual([expect.objectContaining({ skillId: 3, proficiency: "Advanced", years: 2 })]);

    await waitForGraphSync();
    const session = getDriver().session();
    try {
      const r = await session.run("MATCH (:Candidate {id: $id})-[h:HAS_SKILL]->(:Skill {id: 3}) RETURN h.proficiency AS p", { id: c.id });
      expect(r.records[0]?.get("p")).toBe("Advanced");
    } finally {
      await session.close();
    }

    const del = await deleteSkill(makeRequest("/api/me/skills?skillId=3", { method: "DELETE", token: c.token }));
    list = await del.json();
    expect(list.data).toEqual([]);
    expect((await deleteSkill(makeRequest("/api/me/skills?skillId=3", { method: "DELETE", token: c.token }))).status).toBe(404);
    expect((await getSkills(makeRequest("/api/me/skills", { token: c.token }))).status).toBe(200);
  });

  it("an unknown skill id is rejected by the FK constraint (422); bad input is 400", async () => {
    const c = await createTestCandidate();
    const res = await addSkill(makeRequest("/api/me/skills", { method: "POST", token: c.token, body: { skillId: 99999, proficiency: "Expert", years: 1 } }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("DB_RULE");
    const bad = await addSkill(makeRequest("/api/me/skills", { method: "POST", token: c.token, body: { skillId: 3, proficiency: "Guru", years: 1 } }));
    expect(bad.status).toBe(400);
  });

  it("is candidate-only; the skill catalogue is public", async () => {
    expect((await getSkills(makeRequest("/api/me/skills", { token: await tokenFor(SARAH) }))).status).toBe(403);
    const catalogue = await (await skillOptions()).json();
    expect(catalogue).toHaveLength(26);
  });
});
