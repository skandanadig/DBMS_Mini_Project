# SkillMatch: Final QA Report

**Date:** 17 Nov 2026 · **Scope:** a concurrency fix in `sp_update_application_status`, plus end-to-end verification of the frontend, API, RBAC and both databases.

Every result below was observed in an actual run. Status meanings:
- **PASS:** executed automatically and passed.
- **FAIL:** executed and failed.
- **MANUAL PASS:** checked by eye.
- **NOT TESTED:** not executed.

---

## 1. Stored-procedure concurrency fix

**Problem.** `sp_update_application_status` read the application's job owner, the acting user's role and the application's existence **before** `START TRANSACTION`, without locks, and only then updated the row. That left a time-of-check/time-of-use gap: the job or application could be deleted, or an admin's role changed, between the check and the write.

**Fix** (`mysql/01_schema.sql`):

1. Validate the status value first. This reads no data.
2. `START TRANSACTION`.
3. Lock in **parent → child order**:
   - `users` row of the actor: `FOR SHARE`
   - `jobs` row: `FOR SHARE`
   - `applications` row: `FOR UPDATE`
   - Re-check that the application still exists under the lock.
4. Run the authorization checks (unknown actor / candidate / non-owning recruiter) **on the locked rows**.
5. `UPDATE` (the state-machine and audit triggers run in the same transaction), then `COMMIT`.

Every error goes through `EXIT HANDLER … ROLLBACK; RESIGNAL`. A missing application still returns `p_rows_affected = 0` for any actor.

**Why this lock order.** Every other writer goes parent → child as well:
- `sp_submit_application` locks `jobs` and then inserts `applications`.
- The profile route updates `users` and then `candidates`.
- FK cascades run parent → child.

Using the same order rules out deadlock cycles. Shared locks on the user and job rows let updates to *different* applications of the same job proceed in parallel; only the one application row is locked exclusively.

**Unchanged:** schema, ER model, constraints, scoring, the procedure's signature and its error messages.

## 2. Files changed

| File | Change | Why |
| :--- | :--- | :--- |
| `mysql/01_schema.sql` | `sp_update_application_status` rewritten as above | Concurrency fix |
| `mysql/06_tests.sql` | +3 tests: P16 unknown actor, P17 rejected updates write no audit rows, P18 missing application → 0 rows for any actor | Required coverage |
| `web/tests/db.test.ts` | +5 tests: the procedure waits on locked job / user / application rows; simultaneous identical updates are serialised; updates of different applications don't block each other | Concurrency tests (they need two real connections) |
| `web/app/recruiter/page.tsx`, `web/app/admin/users/page.tsx` | `min-w-0` on one grid card each | **Genuine bug:** pages scrolled horizontally on mobile (474px and 539px wide at a 390px viewport) |
| `web/app/icon.svg` (new) | 32×32 favicon | **Genuine bug:** `/favicon.ico` returned 404, putting a console error on every page load |
| `README.md`, `docs/PROJECT_REPORT.md`, `docs/ER_DIAGRAM_AND_RELATIONAL_SCHEMA.md` | Test counts, plus the locking described in the procedure's row | Keep the docs accurate |
| `docs/FINAL_QA_REPORT.md` (new) | This report | n/a |

No dependencies, features, scoring logic or demo credentials were changed.

## 3. SQL test results: `mysql/06_tests.sql`

| Check | Status |
| :--- | :--- |
| Clean init (`docker compose down -v` then `up`): `01_schema.sql` + `02_seed_data.sql`, 0 errors | PASS |
| `06_tests.sql`: **54 / 54** (was 51), run 3 times, including on the clean database | PASS |
| Owning recruiter updates (P07), audit row carries remarks + changed_by (P08) | PASS |
| Non-owning recruiter (P09), candidate (P10), invalid status (P11), invalid transition (P12), unknown actor (P16) rejected | PASS |
| Rejected calls left status unchanged (P13) and **wrote no audit rows** (P17: before = 2, after = 2) | PASS |
| Missing application → 0 rows (P14), also when the actor is a candidate (P18) | PASS |
| Admin may update any application (P15) | PASS |
| Fixtures cleaned up; suite re-runnable (Z01) | PASS |

## 4. Application test results: `npm test` (Vitest, real MySQL + Neo4j)

**109 / 109 PASS** across 9 files (was 104; +5 concurrency tests), run on the clean database.

| New concurrency test (`db.test.ts`) | Status | Against the *old* procedure |
| :--- | :--- | :--- |
| Waits for a lock held on the **job row** (1 s timeout → error 1205; no change, no audit row; succeeds after release) | PASS | **FAIL**: the old code read the job owner without a lock and went ahead. This test detects the race and passes only with the fix. |
| Waits for a lock held on the **acting user's row** | PASS | PASS: the old `UPDATE`'s FK check on `status_changed_by` also waited on this row, so this is a regression guard, not proof of the fix |
| Waits for a lock held on the **application row** | PASS | PASS: the old `UPDATE` also locks this row (regression guard) |
| 3 simultaneous identical updates → exactly **one** audit row, final status correct | PASS | n/a |
| Updates of *different* applications of the same job don't block each other | PASS | n/a |

**Note on `rowsAffected`.** The mysql2 driver connects with `CLIENT_FOUND_ROWS` (confirmed in `mysql2/lib/connection_config.js`), so `ROW_COUNT()` reports *matched* rows, not *changed* rows. The serialization test therefore asserts on the audit trail, which is the real invariant.

## 5. Typecheck, build, audit, sync

| Check | Status |
| :--- | :--- |
| `npm run typecheck` | PASS (exit 0) |
| `npm run build` (Next.js 16.4.5 production build) | PASS |
| `npm audit` | PASS: 0 vulnerabilities |
| `npm run sync:graph` then `npm run sync:graph -- --verify` | PASS: 224 / 224 mirrored entries IN SYNC, exit 0 |

## 6. Frontend pages and workflows tested

**How:** a scripted browser session (Playwright driving the installed Microsoft Edge, headless) against a **production build** (`next start`) and the **real** databases, with fresh demo data before each run.
- It clicks and types through the UI.
- It records every console message, uncaught page error, hydration warning and 5xx response, and scans every `/api/*` response for password hashes.
- The demo password was passed through an environment variable and never logged.
- **63 / 63 PASS on two consecutive full runs** (`qa-run1` and `qa-run2`). The table below is generated from run 2's results file.

| ID | Check | Status |
| :--- | :--- | :--- |
| A1 | Home page renders with demo accounts and sign-in links | PASS |
| A1b | Favicon is served (no 404 console error on page load) | PASS |
| A2 | Public job board lists 12 open jobs, no personal match score | PASS |
| A3 | Signed-out `/me/applications`, `/me/skills`, `/me/profile`, `/me/recommendations`, `/recruiter`, `/recruiter/jobs/new`, `/admin`, `/admin/outbox` each redirect to `/login?next=` (8 checks) | PASS |
| A4 | All 23 protected API endpoints return 401 when signed out | PASS |
| A5 | Register form shows field errors for invalid input | PASS |
| A6 | Register a new candidate via the UI → signed in as Candidate | PASS |
| A7 | New candidate: empty states on applications and skills | PASS |
| A8 | New candidate without resume: Apply shows the procedure's message + profile link | PASS |
| A9 | Sign out clears the session | PASS |
| A10 | Wrong password shows an error and stays on /login | PASS |
| C1 | Meera logs in through the login form; candidate nav shown | PASS |
| C2 | Search "kube" via the form returns only the two OPEN Kubernetes jobs | PASS |
| C3 | Filter by type Internship returns the internship only | PASS |
| C4 | Signed-in job board shows personal match scores sorted high to low | PASS |
| C5 | Pagination: Next goes to page 2 and back | PASS |
| C6 | Job 1 detail: SQL 60.0% vs graph 67.0%, Node.js missing, related via GraphQL, referral path | PASS |
| C7 | Values on job 1 match the API (exactScore / graphScore) | PASS |
| C8 | Apply to job 12 from the job page → success message, status shown, no stale button | PASS |
| C9 | Applying again returns 409 DUPLICATE | PASS |
| C10 | My applications shows the new application with its timeline | PASS |
| C11–C12 | Add a skill, then remove it; the list updates without reload | PASS |
| C13 | Profile: invalid phone shows the MySQL CHECK message; value not saved | PASS |
| C14 | Profile: valid headline change is saved and reloads | PASS |
| C15 | Recommendations page loads graph jobs (none already applied) + learn-next | PASS |
| C16 | Candidate opening the recruiter / admin area is sent home with "not available for your role" (2 checks) | PASS |
| C17 | Candidate calling recruiter/admin APIs gets 403 | PASS |
| R1 | Sarah logs in; dashboard KPIs match the API | PASS |
| R2 | Post a job through the form (with a skill) → lands on its applicants page (empty state) | PASS |
| R3 | Invalid salary range: form shows `chk_salary_range` and no job is created | PASS |
| R4 | Edit the job (title + CLOSED) → dashboard shows the update | PASS |
| R5 | Archive, then reopening is blocked by the MySQL trigger (message shown) | PASS |
| R6 | Applicants page: ranked table + SQL vs graph ranking table | PASS |
| R7 | Move an applicant to under review with remarks → table updates | PASS |
| R8 | Invalid transition via API is rejected with 422 | PASS |
| R9 | Another recruiter's job: applicants and edit pages show 403 messages | PASS |
| R10 | Another recruiter's job / application via API → 403 | PASS |
| R11 | Recruiter opening candidate/admin pages is denied | PASS |
| X1 | The candidate's timeline shows the recruiter's change and remarks (audit trigger) | PASS |
| D1 | Admin logs in; overview figures match the API | PASS |
| D2 | Create a recruiter through the form → success, appears in the user list | PASS |
| D3 | The new recruiter can sign in and sees their company's dashboard | PASS |
| D4 | Duplicate email in the create form shows a 409 message | PASS |
| D5 | Skills: add a skill, then rename it | PASS |
| D6 | Duplicate skill name shows the readable 409 message | PASS |
| D7 | Audit log: search finds the recruiter's remark, with role | PASS |
| D8 | Audit log: status filter shows only OFFERED entries | PASS |
| D9 | Graph sync: "Sync now & verify" reports IN SYNC | PASS |
| D10 | FAILED outbox event is listed, retried from the UI, then applied (no longer FAILED) | PASS |
| D11 | Admin opening candidate/recruiter pages is denied | PASS |
| E1 | No uncaught page errors or hydration errors on any page | PASS |
| E2 | No HTTP 5xx responses during the whole run | PASS |
| E3 | No API response contains a password hash | PASS |

**Console messages.** The run logged 10 browser "Failed to load resource" lines. Each is one of the 4xx responses the tests trigger on purpose:
- 400 ×1: validation
- 401 ×1: wrong password
- 403 ×2: another recruiter's job
- 409 ×2: duplicate email and duplicate skill
- 422 ×4: no resume, phone CHECK, salary CHECK, archived reopen

There were **no other console errors**.

**About the first QA run.** The first run reported 12 failures. Investigation showed:
- **10 were bugs in the QA script.**
  - Next.js's hidden route-announcer element (`role="alert"`, in a shadow DOM) matched the script's alert selector first.
  - Exact-whitespace text matching failed on the stat tiles.
  - Some checks raced a client-side re-fetch.
  - "2 open jobs" also matched inside "12 open jobs".

  The checks were made *stricter*, not looser: each one now waits for the specific expected message.
- **2 were genuine** (mobile overflow, favicon 404) and were fixed in the app.

## 7. Responsive testing

| Check | Status |
| :--- | :--- |
| No page-level horizontal overflow on **60 page/viewport combinations**: 20 pages (public, candidate, recruiter, admin) × desktop 1440×900, tablet 768×1024, mobile 390×844 | PASS (after the `min-w-0` fix; it failed before on mobile `/recruiter` and `/admin/users`) |
| Mobile screenshots of the recruiter dashboard, admin users and job detail inspected visually: tables scroll inside their cards, text readable, nothing clipped outside the viewport | MANUAL PASS |
| Remaining tablet/mobile screenshots (captured, overflow-checked) | PASS (automated overflow check); not every one inspected by eye |

## 8. API and RBAC verification

| Check | Status |
| :--- | :--- |
| 23 protected endpoints → 401 when signed out (A4) | PASS |
| Candidate → recruiter/admin APIs 403 (C17); recruiter → another recruiter's job/application 403 (R10); admin routes 200/403/403/401 per role (`admin.test.ts`) | PASS |
| Ownership enforced again inside the DB (P09, and recruiter tests) | PASS |
| Page access by role (C16, R11, D11) and signed-out redirects (A3) | PASS |
| No password hashes in any API response (E3); no 5xx (E2) | PASS |
| Public registration can't create Admin/Recruiter (`auth.test.ts`) | PASS |

## 9. Neo4j synchronisation

| Check | Status |
| :--- | :--- |
| Fresh seed → `sync:graph`: 220 events applied, 224 / 224 IN SYNC | PASS |
| After the UI runs (job, skill, recruiter and profile changes): "Sync now & verify" IN SYNC (D9) | PASS |
| FAILED event retried from the admin UI and applied (D10) | PASS |
| `sync.test.ts` (full-history replay idempotency, poison parking, worker lock, rebuild) within `npm test` | PASS |

## 10. Known limitations / not tested

| Item | Status |
| :--- | :--- |
| Real browsers other than Edge (Chrome, Firefox, Safari), and real phones/tablets: viewports were emulated in Edge | NOT TESTED |
| Screen-reader / keyboard-only navigation (labels and roles exist, but no assistive-technology pass was done) | NOT TESTED |
| Load and performance testing of the web app (database-level `EXPLAIN ANALYZE` exists in `05_performance.sql`) | NOT TESTED |
| A *deterministic* proof of the old race for the user and application rows: the old code's `UPDATE` also waits on those rows, so only the job-row test tells old and new apart | Documented in §4 |
| Network-failure UI states (e.g. API unreachable mid-session) | NOT TESTED |
| The QA browser script lives outside the repository (session scratchpad) and isn't part of `npm test` | n/a |
