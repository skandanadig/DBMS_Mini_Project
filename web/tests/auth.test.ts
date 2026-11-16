import { SignJWT } from "jose";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as register } from "@/app/api/auth/register/route";
import { requireAuth } from "@/lib/auth";
import { assertCandidateSelf, assertRecruiterOwnsApplication, assertRecruiterOwnsJob } from "@/lib/authz";
import type { SessionUser } from "@/lib/contracts";
import { closePool, query } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { signSession } from "@/lib/session";
import { cleanupTestUsers, makeRequest, sessionTokenFrom, testEmail } from "./helpers";

const PASSWORD = "Password@123"; // seeded demo password
const ADMIN: SessionUser = { userId: 1, role: "Admin", name: "System Administrator" };
const SARAH: SessionUser = { userId: 2, role: "Recruiter", name: "Sarah Jenkins" }; // owns jobs 1, 2, 13
const ARUN: SessionUser = { userId: 3, role: "Recruiter", name: "Arun Kumar" };
const RAHUL: SessionUser = { userId: 5, role: "Candidate", name: "Rahul Sharma" };

async function expectAppError(p: Promise<unknown> | (() => unknown), code: AppError["code"]) {
  const run = typeof p === "function" ? Promise.resolve().then(p) : p;
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await closePool();
});

// ---------------------------------------------------------------------------
describe("POST /api/auth/register", () => {
  it("creates a Candidate user + candidate profile and sets an httpOnly session cookie", async () => {
    const email = testEmail("reg");
    const res = await register(makeRequest("/api/auth/register", { method: "POST", body: { name: "Test User", email, password: "longenough1" } }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ email, role: "Candidate", name: "Test User" });
    expect(res.headers.get("set-cookie")).toMatch(/sm_session=.+HttpOnly/i);

    const rows = await query<RowDataPacket[]>(
      "SELECT u.role, cd.candidate_id FROM users u LEFT JOIN candidates cd ON cd.candidate_id = u.user_id WHERE u.email = ?",
      [email],
    );
    expect(rows[0].role).toBe("Candidate");
    expect(rows[0].candidate_id).toBe(body.user.userId);
  });

  it.each(["Admin", "Recruiter"])("rejects self-registration as %s with 403 and creates no user", async (role) => {
    const email = testEmail(`escalate-${role}`);
    const res = await register(makeRequest("/api/auth/register", { method: "POST", body: { name: "Mallory", email, password: "longenough1", role } }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    expect(sessionTokenFrom(res)).toBeUndefined();
    const rows = await query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users WHERE email = ?", [email]);
    expect(rows[0].n).toBe(0);
  });

  it("accepts an explicit role of Candidate", async () => {
    const res = await register(
      makeRequest("/api/auth/register", { method: "POST", body: { name: "Explicit", email: testEmail("explicit"), password: "longenough1", role: "Candidate" } }),
    );
    expect(res.status).toBe(201);
  });

  it("returns 400 VALIDATION with field details for bad input", async () => {
    const res = await register(makeRequest("/api/auth/register", { method: "POST", body: { name: "", email: "not-an-email", password: "short" } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    const paths = body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "email", "password"]));
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await register(makeRequest("/api/auth/register", { method: "POST", rawBody: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("returns 409 CONFLICT for a duplicate email (MySQL UNIQUE constraint)", async () => {
    const res = await register(makeRequest("/api/auth/register", { method: "POST", body: { name: "Dup", email: "ADMIN@skillmatch.io", password: "longenough1" } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "CONFLICT", message: "An account with this email already exists." });
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/auth/login", () => {
  it("logs in a seeded account (bcrypt hash) and returns its role", async () => {
    const res = await login(makeRequest("/api/auth/login", { method: "POST", body: { email: "admin@skillmatch.io", password: PASSWORD } }));
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ userId: 1, role: "Admin" });
    expect(sessionTokenFrom(res)).toBeTruthy();
  });

  it("rejects a wrong password and an unknown email with the same 401 message", async () => {
    const wrong = await login(makeRequest("/api/auth/login", { method: "POST", body: { email: "admin@skillmatch.io", password: "nope-nope" } }));
    const unknown = await login(makeRequest("/api/auth/login", { method: "POST", body: { email: "ghost@vitest.local", password: "nope-nope" } }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).error.message).toBe((await unknown.json()).error.message);
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/auth/me + session validation", () => {
  it("returns 401 without a cookie", async () => {
    const res = await me(makeRequest("/api/auth/me"));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a garbage token", async () => {
    const res = await me(makeRequest("/api/auth/me", { token: "not.a.jwt" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a token signed with a different secret (forged)", async () => {
    const forged = await new SignJWT({ role: "Admin", name: "Mallory" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("1")
      .setIssuer("skillmatch")
      .setAudience("skillmatch-web")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-completely-different-secret-of-32+chars"));
    const res = await me(makeRequest("/api/auth/me", { token: forged }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired token", async () => {
    const expired = await new SignJWT({ role: "Admin", name: "Admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("1")
      .setIssuer("skillmatch")
      .setAudience("skillmatch-web")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const res = await me(makeRequest("/api/auth/me", { token: expired }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token's role no longer matches MySQL (tampered/stale role)", async () => {
    const token = await signSession({ userId: 5, role: "Admin", name: "Rahul Sharma" });
    const res = await me(makeRequest("/api/auth/me", { token }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a deleted user's still-valid token", async () => {
    const email = testEmail("deleted");
    const reg = await register(makeRequest("/api/auth/register", { method: "POST", body: { name: "Soon Gone", email, password: "longenough1" } }));
    const token = sessionTokenFrom(reg)!;
    const { user } = await reg.json();
    await query("DELETE FROM users WHERE email = ?", [email]);
    // the user is gone, so cleanupTestUsers() can no longer find its outbox events
    await query("DELETE FROM graph_sync_outbox WHERE entity_type = 'CANDIDATE' AND entity_id = ?", [String(user.userId)]);
    const res = await me(makeRequest("/api/auth/me", { token }));
    expect(res.status).toBe(401);
  });

  it("returns the recruiter profile with the company derived through recruiters", async () => {
    const res = await me(makeRequest("/api/auth/me", { token: await signSession(SARAH) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ userId: 2, role: "Recruiter" });
    expect(body.profile).toMatchObject({ kind: "Recruiter", companyId: 1, companyName: "TechCorp Solutions" });
  });

  it("returns the candidate profile", async () => {
    const res = await me(makeRequest("/api/auth/me", { token: await signSession(RAHUL) }));
    expect((await res.json()).profile).toMatchObject({ kind: "Candidate", hasResume: true, experienceYears: 4.5 });
  });
});

// ---------------------------------------------------------------------------
describe("requireAuth role enforcement (used inside every protected route)", () => {
  it("throws FORBIDDEN for a signed-in user with the wrong role", async () => {
    const req = makeRequest("/api/recruiter/dashboard", { token: await signSession(RAHUL) });
    await expectAppError(requireAuth(req, ["Recruiter"]), "FORBIDDEN");
  });

  it("throws UNAUTHENTICATED when there is no session", async () => {
    await expectAppError(requireAuth(makeRequest("/api/recruiter/dashboard"), ["Recruiter"]), "UNAUTHENTICATED");
  });

  it("returns the session user for an allowed role", async () => {
    const req = makeRequest("/api/recruiter/dashboard", { token: await signSession(SARAH) });
    await expect(requireAuth(req, ["Recruiter", "Admin"])).resolves.toMatchObject({ userId: 2, role: "Recruiter" });
  });
});

// ---------------------------------------------------------------------------
describe("ownership checks (lib/authz.ts)", () => {
  it("recruiter owns their job; another recruiter is FORBIDDEN; missing job is NOT_FOUND", async () => {
    await expect(assertRecruiterOwnsJob(SARAH, 1)).resolves.toBeUndefined();
    await expectAppError(assertRecruiterOwnsJob(ARUN, 1), "FORBIDDEN");
    await expectAppError(assertRecruiterOwnsJob(SARAH, 999999), "NOT_FOUND");
  });

  it("candidates cannot pass recruiter ownership checks; admins pass all", async () => {
    await expectAppError(assertRecruiterOwnsJob(RAHUL, 1), "FORBIDDEN");
    await expect(assertRecruiterOwnsJob(ADMIN, 1)).resolves.toBeUndefined();
  });

  it("application ownership follows the job's recruiter", async () => {
    const rows = await query<RowDataPacket[]>("SELECT application_id FROM applications WHERE job_id = 1 LIMIT 1");
    const appId = rows[0].application_id as number;
    await expect(assertRecruiterOwnsApplication(SARAH, appId)).resolves.toBeUndefined();
    await expectAppError(assertRecruiterOwnsApplication(ARUN, appId), "FORBIDDEN");
    await expectAppError(assertRecruiterOwnsApplication(SARAH, 999999), "NOT_FOUND");
  });

  it("candidates may only access their own profile", async () => {
    expect(() => assertCandidateSelf(RAHUL, 5)).not.toThrow();
    await expectAppError(() => assertCandidateSelf(RAHUL, 6), "FORBIDDEN");
    await expectAppError(() => assertCandidateSelf(SARAH, 2), "FORBIDDEN");
    expect(() => assertCandidateSelf(ADMIN, 6)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const res = await logout();
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/sm_session=;.*Max-Age=0/i);
  });
});
