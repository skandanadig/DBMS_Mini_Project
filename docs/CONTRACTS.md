# SkillMatch: Shared Contracts & File Ownership

This document is the **agreement between Member A and Member B** before parallel development.
Anything listed here may only change if both members agree, and the change is recorded in the changelog at the bottom.

| Member | Owns |
| :--- | :--- |
| **Member A** | Infra, MySQL schema/procedures/tests, auth & RBAC core, recruiter features |
| **Member B** | Neo4j model & queries, MySQL→Neo4j sync worker, candidate features, admin features |

---

## 1. Roles & Session

| Role | How the account is created | Can do |
| :--- | :--- | :--- |
| `Candidate` | Public `POST /api/auth/register` (**the only role that can self-register**) | Manage own profile & skills, search jobs, apply, see own applications & recommendations |
| `Recruiter` | Created by an Admin (`POST /api/admin/users`) and linked to one company | Manage **own** jobs, review applicants of **own** jobs, change application status |
| `Admin` | Created by an Admin, or seeded | Manage users, skills taxonomy, view audit logs, outbox status, platform analytics |

**Session:** JWT (HS256, signed with `JWT_SECRET`) stored in an httpOnly cookie named `sm_session`.
The cookie is `SameSite=Lax`, `Secure` in production, and lasts 8 hours.

```ts
// JWT payload (iss "skillmatch", aud "skillmatch-web")
type SessionClaims = {
  sub: string;                          // users.user_id as a string (JWT spec)
  role: 'Candidate' | 'Recruiter' | 'Admin';
  name: string;
  iat: number; exp: number;
};
// What route handlers receive (lib/contracts.ts)
type SessionUser = { userId: number; role: Role; name: string };
```

**Authorization rule:** every protected route handler calls `requireAuth(req, [roles])` (in `web/lib/auth.ts`), and then runs its ownership check against MySQL.
`requireAuth` also re-reads the user from MySQL, so a token for a deleted user, or one whose role no longer matches, is rejected with 401.
`web/proxy.ts` (Next.js 16's replacement for `middleware.ts`) only redirects UI pages. It is **not** a security boundary.

| Helper (`web/lib/authz.ts`) | Rule (checked with a SQL lookup on every call) |
| :--- | :--- |
| `assertRecruiterOwnsJob(user, jobId)` | `jobs.recruiter_id = user.userId`; 404 if the job is missing |
| `assertRecruiterOwnsApplication(user, applicationId)` | `applications → jobs.recruiter_id = user.userId`; 404 if missing |
| `assertCandidateSelf(user, candidateId)` | `user.userId = candidateId` |

An Admin passes every ownership check. A Candidate never passes a recruiter check.

## 2. API Conventions

- All routes live under `/api`. Request and response bodies are JSON. Inputs are validated with zod schemas exported from `web/lib/contracts.ts`.
- **Success:** the resource object, or for lists: `{ data: T[], page: number, pageSize: number, total: number }`.
- **Error** (always this shape):

```json
{ "error": { "code": "FORBIDDEN", "message": "Human readable text", "details": {} } }
```

| `code` | HTTP | When |
| :--- | :--- | :--- |
| `VALIDATION` | 400 | zod validation failed |
| `UNAUTHENTICATED` | 401 | No session, or an invalid/expired session |
| `FORBIDDEN` | 403 | Wrong role, or the ownership check failed |
| `NOT_FOUND` | 404 | The entity doesn't exist (or isn't visible to the caller) |
| `CONFLICT` | 409 | Duplicate (MySQL `ER_DUP_ENTRY` 1062, or SP status `DUPLICATE`) |
| `DB_RULE` | 422 | A database business rule rejected the request: `SIGNAL SQLSTATE '45000'` (trigger/SP), CHECK violation 3819, or FK violation 1451/1452. The DB message is passed through. |
| `INTERNAL` | 500 | Anything else (logged on the server; generic message to the client) |

`web/lib/errors.ts` maps mysql2 errors to these codes. Every route ends with `catch (e) { return toErrorResponse(e) }`.

## 3. API Route Table

| Method & path | Roles | Ownership | Request → Response | Owner |
| :--- | :--- | :--- | :--- | :--- |
| `POST /api/auth/register` | public | Role forced to `Candidate`; any `role` in the body is ignored | `{name,email,password}` → `{user}` | A |
| `POST /api/auth/login` | public | n/a | `{email,password}` → `{user}` + sets cookie | A |
| `POST /api/auth/logout` | any | n/a | none → `204` | A |
| `GET /api/auth/me` | any | n/a | → `{user, profile}` (role-specific profile) | A |
| `GET /api/health` | public | n/a | → `{status, mysql, neo4j}`; 503 if either database is down | A |
| `GET /api/jobs` | public | n/a | `?q=&location=&type=&minSalary=&skillId=&page=` → paged `JobSummary` | B |
| `GET /api/jobs/:id` | public | n/a | → `JobDetail` (incl. required skills) | B |
| `GET /api/jobs/:id/match` | Candidate | self | → `{score, matched[], missing[], related[]}` (SQL `fn_match_score` + Neo4j skill gap) | B |
| `POST /api/jobs/:id/apply` | Candidate | self | none → `{applicationId, statusCode, message}` (from `sp_submit_application`) | B |
| `GET /api/me/applications` | Candidate | self | → `CandidateApplication[]` (from `vw_candidate_applications`) + audit trail | B |
| `GET/PUT /api/me/profile` | Candidate | self | `CandidateProfile` | B |
| `GET/POST/DELETE /api/me/skills` | Candidate | self | `{skillId, proficiency, years}` | B |
| `GET /api/me/recommendations` | Candidate | self | → `{jobs: RecommendedJob[], referrals: ReferralPath[]}` (Neo4j) | B |
| `GET /api/recruiter/dashboard` | Recruiter | own jobs | → `vw_recruiter_pipeline` rows + `sp_get_recruiter_analytics` | A |
| `POST /api/recruiter/jobs` | Recruiter | company = the recruiter's own company | `JobInput` → `{jobId}` | A |
| `PUT /api/recruiter/jobs/:id` | Recruiter | `assertRecruiterOwnsJob` | `JobInput` (incl. `status`) → `JobDetail` | A |
| `GET /api/recruiter/jobs/:id/applicants` | Recruiter | `assertRecruiterOwnsJob` | → `{sqlRanking: Ranked[], graphRanking: Ranked[]}` | A |
| `PATCH /api/recruiter/applications/:id/status` | Recruiter | `assertRecruiterOwnsApplication` | `{status, remarks}` → `{rowsAffected}` (from `sp_update_application_status`) | A |
| `GET/POST /api/admin/users` | Admin | n/a | create Recruiter/Admin: `{name,email,password,role,companyId?,designation?}` | B |
| `GET/POST/PUT /api/admin/skills` | Admin | n/a | `{skillName, category}` | B |
| `GET /api/admin/audit-logs` | Admin | n/a | paged `application_audit_logs` | B |
| `GET /api/admin/outbox` | Admin | n/a | `?status=` paged `graph_sync_outbox` | B |
| `POST /api/admin/outbox/retry` | Admin | n/a | `{eventIds[]}`: resets FAILED events → PENDING | B |

## 4. MySQL Contract (target schema after Phase 1)

Changes from the current schema:

- **`jobs.company_id` removed.** A job's company is always found through `jobs.recruiter_id → recruiters.company_id → companies`. Queries must join through `recruiters`.
- **`applications`** gains `status_changed_by INT NULL` (FK → `users.user_id`, ON DELETE SET NULL) and `status_remarks VARCHAR(255) NULL`. They hold the metadata for the most recent status change and are read by the audit trigger. **No session variables are used for auditing.**
- **`application_audit_logs`** gains `changed_by INT NULL` (FK → `users.user_id`, ON DELETE SET NULL).
- **New table `graph_sync_outbox`** (see §6).
- FULLTEXT indexes on `jobs(job_title, description)` and `candidates(headline, bio)`.

Database objects the app may call (all others are internal):

| Object | Signature | Used by |
| :--- | :--- | :--- |
| `sp_submit_application` | `(IN candidate_id, IN job_id, OUT application_id, OUT status_code, OUT message)`. `status_code` ∈ `SUCCESS, FAILED, DUPLICATE, NOT_FOUND, ERROR`. The match score is computed inside the procedure with `fn_match_score`. | B |
| `sp_update_application_status` | `(IN application_id, IN new_status, IN remarks, IN changed_by, OUT rows_affected)` | A |
| `sp_get_recruiter_analytics` | `(IN recruiter_id)` → result set | A |
| `fn_match_score` | `(candidate_id, job_id) RETURNS DECIMAL(5,2)` | A, B |
| `vw_recruiter_pipeline`, `vw_candidate_applications`, `vw_top_demanded_skills`, `vw_job_match_leaderboard` | views | A, B |

**Connection rules (`web/lib/db.ts`, `web/lib/procedures.ts`):**

1. A stored procedure with OUT parameters is **always** called on one acquired connection. The sequence is:
   - `const conn = await pool.getConnection()`
   - `SET @o1=NULL, @o2=NULL, ...` (clears any values left on the pooled connection)
   - `CALL sp(?, ?, @o1, @o2, ...)`
   - `SELECT @o1, @o2, ...`
   - `conn.release()` in `finally`
2. A multi-statement transaction in the app uses `conn.beginTransaction()`, `conn.commit()`, `conn.rollback()` in `catch`, and `conn.release()` in `finally`.
3. Never call `pool.query()` for anything that depends on session state.

## 5. Neo4j Contract (graph model)

| Element | Key / properties | Source in MySQL |
| :--- | :--- | :--- |
| `(:Candidate)` | `id` (unique) = candidate_id, `name`, `location`, `experience_years` | `candidates` + `users` |
| `(:Job)` | `id` (unique), `title`, `location`, `status` | `jobs` |
| `(:Company)` | `id` (unique), `name`, `industry`, `location` | `companies` |
| `(:Skill)` | `id` (unique), `name` (unique), `category` (indexed) | `skills` |
| `(:Candidate)-[:HAS_SKILL {proficiency, years}]->(:Skill)` | | `candidate_skills` |
| `(:Job)-[:REQUIRES_SKILL {required_level, is_mandatory}]->(:Skill)` | | `job_skills` |
| `(:Job)-[:OFFERED_BY]->(:Company)` | | `jobs → recruiters → companies` |
| `(:Skill)-[:RELATED_TO {weight}]->(:Skill)` | | graph-only (curated ontology) |
| `(:Skill)-[:SUBSKILL_OF]->(:Skill)` | | graph-only (curated ontology) |
| `(:Candidate)-[:WORKED_AT {since}]->(:Company)` | | graph-only (seeded demo data) |
| `(:Candidate)-[:CONNECTED_TO]-(:Candidate)` | | graph-only (seeded demo data) |

Rules:

- **MySQL is the source of truth** for every node and relationship marked with a MySQL source.
- Graph-only relationships exist only in Neo4j.
- All writes use `MERGE` on `id`, so replaying a write is safe.

## 6. Outbox Event Contract (MySQL → Neo4j)

```sql
graph_sync_outbox(
  event_id     BIGINT AUTO_INCREMENT PK,
  entity_type  ENUM('CANDIDATE','SKILL','CANDIDATE_SKILL','JOB','JOB_SKILL'),
  entity_id    VARCHAR(64),          -- e.g. '5' or '5:12' for composite keys
  op           ENUM('UPSERT','DELETE'),
  payload      JSON,                 -- full row snapshot at trigger time (NULL for DELETE)
  status       ENUM('PENDING','DONE','FAILED') DEFAULT 'PENDING',
  attempts     INT DEFAULT 0,
  last_error   VARCHAR(500),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL
)
```

How it works:

- Rows are written by AFTER INSERT/UPDATE/DELETE triggers in the **same transaction** as the business write.
- The worker (`web/scripts/sync-graph.ts`, owned by B) processes `PENDING` events in `event_id` order:
  - success sets `DONE`;
  - an error increments `attempts` and stores `last_error`;
  - when `attempts >= 5`, the event becomes `FAILED`.
- **Consistency model:** eventual. Neo4j can lag behind MySQL until the worker runs. Graph-backed UI panels show data "as of last sync".

## 7. File Ownership

| Path | Owner |
| :--- | :--- |
| `docker-compose.yml`, `.env.example`, `.gitignore` | A |
| `mysql/01_schema.sql` … `mysql/06_tests.sql` | A |
| `neo4j/schema_and_seed.cql`, `neo4j/queries.cql` | B |
| `docs/CONTRACTS.md` | A + B (changes need both) |
| `web/package.json`, `web/next.config.*`, `web/tsconfig.json`, `web/vitest.config.ts` | A |
| `web/lib/db.ts`, `web/lib/procedures.ts`, `web/lib/auth.ts`, `web/lib/authz.ts`, `web/lib/session.ts`, `web/lib/server-session.ts`, `web/lib/errors.ts`, `web/lib/contracts.ts`, `web/lib/env.ts`, `web/lib/load-root-env.ts`, `web/proxy.ts` | A |
| `web/lib/neo4j.ts` (driver; created by A in Phase 3, extended by B), `web/lib/graph-queries.ts`, `web/scripts/sync-graph.ts` | B |
| `web/app/(auth)/**`, `web/app/api/auth/**` | A |
| `web/app/recruiter/**`, `web/app/api/recruiter/**` | A |
| `web/app/jobs/**`, `web/app/me/**`, `web/app/api/jobs/**`, `web/app/api/me/**` | B |
| `web/app/admin/**`, `web/app/api/admin/**` | B |
| `web/components/ui/**` (shared primitives) | A creates them; B may add to them |
| `web/tests/auth.test.ts`, `db.test.ts`, `constraints.test.ts`, `helpers.ts` | A |
| `web/tests/procedures.test.ts`, `rollback.test.ts`, `sync.test.ts` | B |
| `docs/PROJECT_REPORT.md`, `README.md` | A + B |
| `docs/ER_DIAGRAM_AND_RELATIONAL_SCHEMA.md` | A |
| `docs/RANKING_COMPARISON.md` | B |

## Changelog

| Date | Change | Agreed by |
| :--- | :--- | :--- |
| 2026-11-16 | Initial contracts (Phase 0) | A, B |
| 2026-11-16 | Phase 2: `Company.industry` and `WORKED_AT.since` added. Graph scoring rule fixed: `exactScore` must equal MySQL `fn_match_score`; `graphScore` adds implied credit 0.8 (`SUBSKILL_OF`) or related credit 0.5 × path weight (`RELATED_TO`) for missing skills | A, B |
| 2026-11-16 | Phase 3 (Next.js 16): `middleware.ts` → `proxy.ts`. JWT `sub` is a string. `authz` helpers take the `SessionUser`. New A-owned files: `session.ts`, `server-session.ts`, `env.ts`, `load-root-env.ts`, `tests/db.test.ts`. `lib/neo4j.ts` was created by A for `/api/health`. Added public `GET /api/health`. | A, B |
