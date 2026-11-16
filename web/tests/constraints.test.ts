import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUT as updateJob } from "@/app/api/recruiter/jobs/[id]/route";
import { POST as createJob } from "@/app/api/recruiter/jobs/route";
import type { JobInput } from "@/lib/contracts";
import { closePool, query } from "@/lib/db";
import { closeDriver, getDriver } from "@/lib/neo4j";
import { signSession } from "@/lib/session";
import { waitForGraphSync } from "@/lib/sync-trigger";
import { cleanupTestJobs, makeRequest, TEST_JOB_PREFIX } from "./helpers";

/**
 * Database-level validation through the recruiter API (plan item 6):
 * MySQL CHECK constraints, FKs and triggers reject bad data even though the
 * API's zod schema lets it through, and a rejected multi-row write is rolled
 * back as a whole.
 */

const SARAH = { userId: 2, role: "Recruiter" as const, name: "Sarah Jenkins" }; // TechCorp
const ARUN = { userId: 3, role: "Recruiter" as const, name: "Arun Kumar" };
const RAHUL = { userId: 5, role: "Candidate" as const, name: "Rahul Sharma" };

let n = 0;
const title = (t: string) => `${TEST_JOB_PREFIX} ${t} ${Date.now()}-${++n}`;
const base = (overrides: Partial<JobInput> = {}): JobInput => ({
  title: title("Constraint Job"),
  description: "Created by constraints.test.ts",
  location: "Bengaluru, India",
  employmentType: "Full-time",
  salaryMin: 1_000_000,
  salaryMax: 1_500_000,
  skills: [
    { skillId: 2, requiredLevel: "Advanced", mandatory: true },
    { skillId: 9, requiredLevel: "Intermediate", mandatory: false },
  ],
  ...overrides,
});

async function post(user: typeof SARAH | typeof RAHUL, body: unknown) {
  const res = await createJob(makeRequest("/api/recruiter/jobs", { method: "POST", token: await signSession(user), body }));
  return { status: res.status, body: await res.json() };
}
async function put(user: typeof SARAH, jobId: number, body: unknown) {
  const res = await updateJob(
    makeRequest(`/api/recruiter/jobs/${jobId}`, { method: "PUT", token: await signSession(user), body }),
    { params: Promise.resolve({ id: String(jobId) }) },
  );
  return { status: res.status, body: await res.json() };
}
async function countJobs(t: string) {
  const rows = await query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM jobs WHERE job_title = ?", [t]);
  return Number(rows[0].n);
}

beforeAll(cleanupTestJobs);
afterAll(async () => {
  await cleanupTestJobs();
  await Promise.all([closePool(), closeDriver()]);
});

describe("POST /api/recruiter/jobs", () => {
  it("creates the posting and its skills in one transaction; company is derived from the recruiter", async () => {
    const input = base();
    const { status, body } = await post(SARAH, input);
    expect(status).toBe(201);

    const [row] = await query<RowDataPacket[]>(
      `SELECT j.recruiter_id, j.status, c.company_name, (SELECT COUNT(*) FROM job_skills js WHERE js.job_id = j.job_id) AS skills
         FROM jobs j JOIN recruiters r ON r.recruiter_id = j.recruiter_id JOIN companies c ON c.company_id = r.company_id
        WHERE j.job_id = ?`,
      [body.jobId],
    );
    expect(row).toMatchObject({ recruiter_id: 2, status: "OPEN", company_name: "TechCorp Solutions", skills: 2 });

    await waitForGraphSync(); // outbox -> Neo4j in the background
    const session = getDriver().session();
    try {
      const r = await session.run("MATCH (j:Job {id: $id})-[:OFFERED_BY]->(co:Company) RETURN co.name AS c, COUNT { (j)-[:REQUIRES_SKILL]->() } AS s", { id: body.jobId });
      expect(r.records[0]?.toObject()).toEqual({ c: "TechCorp Solutions", s: 2 });
    } finally {
      await session.close();
    }
  });

  it("CHECK chk_salary_range: salary_max < salary_min -> 422, nothing inserted", async () => {
    const input = base({ salaryMin: 2_000_000, salaryMax: 1_000_000 });
    const { status, body } = await post(SARAH, input);
    expect(status).toBe(422);
    expect(body.error.message).toContain("chk_salary_range");
    expect(await countJobs(input.title)).toBe(0);
  });

  it("CHECK chk_salary_range: negative salary -> 422", async () => {
    const { status } = await post(SARAH, base({ salaryMin: -5, salaryMax: 100 }));
    expect(status).toBe(422);
  });

  it("CHECK chk_job_title_length: a 2-character title -> 422", async () => {
    const { status, body } = await post(SARAH, base({ title: "QA" }));
    expect(status).toBe(422);
    expect(body.error.message).toContain("chk_job_title_length");
  });

  it("FK: an unknown skill rolls back the job row inserted earlier in the same transaction", async () => {
    const input = base({ skills: [{ skillId: 2, requiredLevel: "Advanced", mandatory: true }, { skillId: 99999, requiredLevel: "Expert", mandatory: true }] });
    const { status, body } = await post(SARAH, input);
    expect(status).toBe(422);
    expect(body.error.details).toEqual({ errno: 1452 });
    expect(await countJobs(input.title)).toBe(0);
  });

  it("400 for structurally invalid input (enum, duplicate skills)", async () => {
    expect((await post(SARAH, { ...base(), employmentType: "Freelance" })).status).toBe(400);
    const dup = base({ skills: [{ skillId: 2, requiredLevel: "Advanced", mandatory: true }, { skillId: 2, requiredLevel: "Expert", mandatory: false }] });
    expect((await post(SARAH, dup)).status).toBe(400);
  });

  it("candidates cannot create postings", async () => {
    expect((await post(RAHUL, base())).status).toBe(403);
  });
});

describe("PUT /api/recruiter/jobs/:id", () => {
  it("replaces the skill set and enforces the job lifecycle trigger (ARCHIVED is terminal)", async () => {
    const created = await post(SARAH, base());
    const id = created.body.jobId as number;

    const edited = await put(SARAH, id, base({ title: created.body.title ?? title("Edited"), skills: [{ skillId: 4, requiredLevel: "Expert", mandatory: true }] }));
    expect(edited.status).toBe(200);
    expect(edited.body.skills).toEqual([expect.objectContaining({ skillId: 4, requiredLevel: "Expert", mandatory: true })]);

    expect((await put(SARAH, id, base({ status: "CLOSED" }))).body.status).toBe("CLOSED");
    expect((await put(SARAH, id, base({ status: "OPEN" }))).body.status).toBe("OPEN"); // reopen is allowed
    expect((await put(SARAH, id, base({ status: "ARCHIVED" }))).body.status).toBe("ARCHIVED");

    const reopen = await put(SARAH, id, base({ status: "OPEN" }));
    expect(reopen.status).toBe(422);
    expect(reopen.body.error.message).toBe("Archived job postings cannot be reopened.");
  });

  it("another recruiter cannot edit the posting (403) and missing jobs are 404", async () => {
    expect((await put(ARUN, 1, base())).status).toBe(403);
    expect((await put(SARAH, 999999, base())).status).toBe(404);
    const [row] = await query<RowDataPacket[]>("SELECT job_title FROM jobs WHERE job_id = 1");
    expect(row.job_title).toBe("Senior Full Stack Engineer");
  });
});
