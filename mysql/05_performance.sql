-- =============================================================================
-- SKILLMATCH: Index & query performance demonstration (EXPLAIN ANALYZE)
-- File: 05_performance.sql
-- Description:
--   The seed data (15 jobs, 41 applications) is far too small for the
--   optimizer to prefer an index, so this script builds a throw-away
--   benchmark schema `skillmatch_perf` with the SAME table definitions
--   (CREATE TABLE ... LIKE copies columns, CHECKs and indexes but not
--   triggers/FKs) and bulk-loads 50,000 jobs + 100,000 applications with a
--   recursive CTE. It then compares plans/timings WITH and WITHOUT each index
--   using IGNORE INDEX hints, and finally drops the benchmark schema.
--
--   Must be run as root (creates/drops a schema). Takes ~10-30 seconds.
-- Run: docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t' < mysql/05_performance.sql
-- =============================================================================

DROP DATABASE IF EXISTS skillmatch_perf;
CREATE DATABASE skillmatch_perf CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE skillmatch_perf;

CREATE TABLE jobs LIKE skillmatch_db.jobs;
CREATE TABLE applications LIKE skillmatch_db.applications;

SET SESSION cte_max_recursion_depth = 200000;

-- ---- 50,000 jobs: ~5% OPEN, spread over ~35 days -------------------------
INSERT INTO jobs (job_id, recruiter_id, job_title, description, location, employment_type,
                  salary_min, salary_max, posted_date, status)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50000)
SELECT
    n,
    2,
    CONCAT(ELT(1 + n % 8, 'Backend', 'Frontend', 'Data', 'Cloud', 'Mobile', 'QA', 'Security', 'Platform'),
           ' Engineer ', n),
    CONCAT('Work on ',
           ELT(1 + n % 10, 'payments', 'search', 'analytics', 'billing', 'checkout',
                           'messaging', 'identity', 'logistics', 'pricing', 'kubernetes infrastructure'),
           ' using ',
           ELT(1 + n % 7, 'Java', 'Python', 'Go', 'TypeScript', 'Rust', 'Kotlin', 'Scala'),
           ' and modern tooling.'),
    ELT(1 + n % 6, 'Bengaluru, India', 'Pune, India', 'Hyderabad, India', 'Mumbai, India', 'Chennai, India', 'Remote'),
    'Full-time',
    500000 + (n % 20) * 50000,
    900000 + (n % 20) * 80000,
    NOW() - INTERVAL n MINUTE,
    IF(n % 20 = 0, 'OPEN', IF(n % 3 = 0, 'ARCHIVED', 'CLOSED'))
FROM seq;

-- ---- 100,000 applications over 5,000 candidates ----------------------------
INSERT INTO applications (application_id, job_id, candidate_id, applied_date, status, match_score)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 100000)
SELECT
    n,
    1 + (n % 50000),
    -- second pass over the jobs (n > 50000) shifts candidates by 2500 so
    -- (job_id, candidate_id) stays unique (uk_job_candidate)
    1 + ((n % 5000) + (n DIV 50000) * 2500) % 5000,
    NOW() - INTERVAL n MINUTE,
    ELT(1 + n % 5, 'APPLIED', 'UNDER_REVIEW', 'INTERVIEW_SCHEDULED', 'OFFERED', 'REJECTED'),
    n % 101
FROM seq;

ANALYZE TABLE jobs, applications;

SELECT (SELECT COUNT(*) FROM jobs) AS bench_jobs,
       (SELECT COUNT(*) FROM applications) AS bench_applications;

-- =============================================================================
-- P1. Job feed: newest OPEN jobs  (index idx_jobs_status_posted)
-- =============================================================================
SELECT 'P1a job feed WITH idx_jobs_status_posted' AS experiment;
EXPLAIN ANALYZE
SELECT job_id, job_title, posted_date
FROM jobs
WHERE status = 'OPEN'
ORDER BY posted_date DESC
LIMIT 20;

SELECT 'P1b job feed WITHOUT index (full scan + filesort)' AS experiment;
EXPLAIN ANALYZE
SELECT job_id, job_title, posted_date
FROM jobs IGNORE INDEX (idx_jobs_status_posted)
WHERE status = 'OPEN'
ORDER BY posted_date DESC
LIMIT 20;

-- =============================================================================
-- P2. Candidate dashboard: one candidate's offers  (idx_apps_cand_status)
-- =============================================================================
SELECT 'P2a candidate offers WITH idx_apps_cand_status' AS experiment;
EXPLAIN ANALYZE
SELECT application_id, job_id, applied_date
FROM applications
WHERE candidate_id = 1234 AND status = 'OFFERED';

SELECT 'P2b candidate offers WITHOUT index' AS experiment;
EXPLAIN ANALYZE
SELECT application_id, job_id, applied_date
FROM applications IGNORE INDEX (idx_apps_cand_status)
WHERE candidate_id = 1234 AND status = 'OFFERED';

-- =============================================================================
-- P3. Recruiter pipeline: applicants of one job by status (idx_apps_job_status)
-- =============================================================================
SELECT 'P3a pipeline counts WITH idx_apps_job_status' AS experiment;
EXPLAIN ANALYZE
SELECT status, COUNT(*)
FROM applications
WHERE job_id = 4242
GROUP BY status;

SELECT 'P3b pipeline counts WITHOUT job indexes' AS experiment;
EXPLAIN ANALYZE
SELECT status, COUNT(*)
FROM applications IGNORE INDEX (idx_apps_job_status, uk_job_candidate)
WHERE job_id = 4242
GROUP BY status;

-- =============================================================================
-- P4. Text search: FULLTEXT index vs LIKE '%...%'
-- =============================================================================
-- (rows are returned rather than COUNT(*): a bare FULLTEXT COUNT(*) is
--  answered during optimization and would hide the index access in the plan)
SELECT 'P4a FULLTEXT MATCH ... AGAINST' AS experiment;
EXPLAIN ANALYZE
SELECT job_id, job_title
FROM jobs
WHERE MATCH(job_title, description) AGAINST ('+kubernetes +rust' IN BOOLEAN MODE)
LIMIT 50;

SELECT 'P4b LIKE with leading wildcard (cannot use a B-tree index)' AS experiment;
EXPLAIN ANALYZE
SELECT job_id, job_title
FROM jobs
WHERE description LIKE '%kubernetes%' AND description LIKE '%Rust%'
LIMIT 50;

-- Same answer, different access path:
SELECT
    (SELECT COUNT(*) FROM jobs WHERE MATCH(job_title, description) AGAINST ('+kubernetes +rust' IN BOOLEAN MODE)) AS fulltext_hits,
    (SELECT COUNT(*) FROM jobs WHERE description LIKE '%kubernetes%' AND description LIKE '%Rust%') AS like_hits;

-- =============================================================================
-- P5. Plans of the real application objects (small data, shape only)
-- =============================================================================
USE skillmatch_db;

SELECT 'P5a vw_recruiter_pipeline for one recruiter' AS experiment;
EXPLAIN ANALYZE SELECT * FROM vw_recruiter_pipeline WHERE recruiter_id = 2;

SELECT 'P5b SQL ranking view (fn_match_score per candidate x job)' AS experiment;
EXPLAIN ANALYZE SELECT * FROM vw_job_match_leaderboard WHERE job_id = 1;

-- ---- cleanup ---------------------------------------------------------------
DROP DATABASE skillmatch_perf;
