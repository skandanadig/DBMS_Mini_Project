-- =============================================================================
-- SKILLMATCH: Important Queries, DML & Advanced Feature Demonstration
-- File: 03_queries_and_tests.sql
-- Description: Demonstration queries matching the PES rubric
--   A. Core DML (INSERT / UPDATE / DELETE / SELECT)
--   B. GROUP BY + HAVING aggregations
--   C. Subqueries (correlated, nested, NOT EXISTS / relational division)
--   D. Views
--   E. Stored procedures & transactions
--   F. Triggers (business-rule errors)
--   G. Window functions & CTEs
--   H. Full-text search
--   I. SQL candidate ranking (compare with Neo4j ranking in neo4j/queries.cql)
--
-- Safe to re-run: DML is idempotent or reports DUPLICATE / no-op.
-- Run: docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t' < mysql/03_queries_and_tests.sql
-- =============================================================================

USE skillmatch_db;

-- =============================================================================
-- SECTION A: CORE DML OPERATIONS (INSERT, UPDATE, DELETE, SELECT)
-- =============================================================================

-- A1. INSERT (upsert) a candidate skill
INSERT INTO candidate_skills (candidate_id, skill_id, proficiency_level, years_experience)
VALUES (10, 3, 'Intermediate', 1.5)
ON DUPLICATE KEY UPDATE years_experience = 1.5;

-- A2. UPDATE job details
UPDATE jobs
SET salary_max = 2800000.00
WHERE job_id = 1;

-- A3. DELETE an obsolete skill from a candidate
DELETE FROM candidate_skills
WHERE candidate_id = 6 AND skill_id = 10;

-- A4. SELECT with multi-table INNER and LEFT JOINs
--     (company is reached through the recruiter: jobs -> recruiters -> companies)
SELECT
    j.job_id,
    j.job_title,
    c.company_name,
    u.name AS recruiter_name,
    COUNT(js.skill_id) AS total_skills_required
FROM jobs j
INNER JOIN recruiters r ON j.recruiter_id = r.recruiter_id
INNER JOIN companies c ON r.company_id = c.company_id
INNER JOIN users u ON r.recruiter_id = u.user_id
LEFT JOIN job_skills js ON j.job_id = js.job_id
GROUP BY j.job_id, j.job_title, c.company_name, u.name
ORDER BY j.job_id;

-- =============================================================================
-- SECTION B: AGGREGATIONS WITH GROUP BY AND HAVING
-- =============================================================================

-- B1. Companies whose OPEN jobs offer an average minimum salary above 10 LPA
SELECT
    c.company_name,
    c.industry,
    COUNT(j.job_id) AS active_jobs_count,
    ROUND(AVG(j.salary_min), 2) AS avg_min_salary,
    ROUND(AVG(j.salary_max), 2) AS avg_max_salary
FROM companies c
JOIN recruiters r ON r.company_id = c.company_id
JOIN jobs j ON j.recruiter_id = r.recruiter_id
WHERE j.status = 'OPEN'
GROUP BY c.company_id, c.company_name, c.industry
HAVING active_jobs_count >= 1 AND avg_min_salary > 1000000
ORDER BY avg_min_salary DESC;

-- B2. Skill categories with at least 3 candidates at Advanced level or above
SELECT
    s.category,
    COUNT(DISTINCT cs.candidate_id) AS strong_candidates,
    ROUND(AVG(cs.years_experience), 1) AS avg_years
FROM candidate_skills cs
JOIN skills s ON s.skill_id = cs.skill_id
WHERE cs.proficiency_level IN ('Advanced', 'Expert')
GROUP BY s.category
HAVING strong_candidates >= 3
ORDER BY strong_candidates DESC;

-- =============================================================================
-- SECTION C: ADVANCED SUBQUERIES (Correlated & Nested)
-- =============================================================================

-- C1. Relational division: candidates who possess ALL mandatory skills of Job 1
SELECT
    u.user_id,
    u.name,
    u.email,
    cd.experience_years
FROM candidates cd
JOIN users u ON cd.candidate_id = u.user_id
WHERE NOT EXISTS (
    SELECT js.skill_id
    FROM job_skills js
    WHERE js.job_id = 1 AND js.is_mandatory = TRUE
      AND js.skill_id NOT IN (
          SELECT cs.skill_id
          FROM candidate_skills cs
          WHERE cs.candidate_id = cd.candidate_id
      )
);

-- C2. Jobs paying above the average max salary of all OPEN jobs
SELECT job_id, job_title, salary_max
FROM jobs
WHERE status = 'OPEN'
  AND salary_max > (SELECT AVG(salary_max) FROM jobs WHERE status = 'OPEN')
ORDER BY salary_max DESC;

-- C3. Correlated subquery: each candidate's best-matching OPEN job they have NOT applied to
SELECT
    u.name AS candidate,
    (SELECT j.job_title
       FROM jobs j
      WHERE j.status = 'OPEN'
        AND NOT EXISTS (SELECT 1 FROM applications a
                         WHERE a.job_id = j.job_id AND a.candidate_id = cd.candidate_id)
      ORDER BY fn_match_score(cd.candidate_id, j.job_id) DESC
      LIMIT 1) AS best_unapplied_job
FROM candidates cd
JOIN users u ON u.user_id = cd.candidate_id
ORDER BY u.name;

-- =============================================================================
-- SECTION D: VIEW EXECUTION
-- =============================================================================

SELECT * FROM vw_recruiter_pipeline WHERE recruiter_id = 2;
SELECT * FROM vw_candidate_applications WHERE candidate_id = 5;
SELECT * FROM vw_top_demanded_skills ORDER BY demanding_jobs_count DESC, skill_name LIMIT 10;
SELECT job_id, job_title, company_name, applicant_count FROM vw_job_listings WHERE status = 'OPEN' ORDER BY posted_date DESC;

-- =============================================================================
-- SECTION E: STORED PROCEDURES, FUNCTIONS & TRANSACTIONS
-- =============================================================================

-- E1. Function: weighted skill match
SELECT fn_match_score(5, 1) AS rahul_vs_full_stack, fn_match_score(9, 2) AS vikram_vs_frontend;

-- E2. Transactional submission (candidate 6 -> job 1). On re-run returns DUPLICATE.
SET @new_app_id = NULL, @status_code = NULL, @message = NULL;
CALL sp_submit_application(6, 1, @new_app_id, @status_code, @message);
SELECT @new_app_id AS new_application_id, @status_code AS result_status, @message AS message_text;

-- E3. Business-rule failures returned as status codes (no exception)
SET @a = NULL, @s = NULL, @m = NULL;
CALL sp_submit_application(23, 12, @a, @s, @m);   -- no resume
SELECT 'no resume' AS scenario, @s AS status_code, @m AS message;
CALL sp_submit_application(7, 5, @a, @s, @m);     -- closed job
SELECT 'closed job' AS scenario, @s AS status_code, @m AS message;
CALL sp_submit_application(7, 9999, @a, @s, @m);  -- missing job
SELECT 'missing job' AS scenario, @s AS status_code, @m AS message;

-- E4. Status update by the owning recruiter (Sarah, user 2) with remarks.
--     The audit trigger records who and why.
SET @app_for_update = (SELECT application_id FROM applications WHERE job_id = 1 AND candidate_id = 6);
SET @rows_affected = NULL;
CALL sp_update_application_status(@app_for_update, 'UNDER_REVIEW', 'Shortlisted by HR', 2, @rows_affected);
SELECT @rows_affected AS rows_affected;
SELECT * FROM application_audit_logs WHERE application_id = @app_for_update ORDER BY log_id;

-- E5. Recruiter analytics (two result sets: funnel + hard-to-fill skills)
CALL sp_get_recruiter_analytics(2);

-- =============================================================================
-- SECTION F: TESTING TRIGGERS (each statement below is EXPECTED to fail)
-- The automated PASS/FAIL version of these lives in 06_tests.sql.
-- =============================================================================

-- F1. Apply to CLOSED job 5 -> 'Error: Cannot apply to a job that is CLOSED or ARCHIVED.'
-- INSERT INTO applications (job_id, candidate_id) VALUES (5, 7);

-- F2. Skip states APPLIED -> OFFERED -> 'Invalid status transition: APPLIED -> OFFERED.'
-- UPDATE applications SET status = 'OFFERED' WHERE job_id = 1 AND candidate_id = 9;

-- F3. Recruiter of another company changes status -> 'Recruiter does not own this job posting.'
-- CALL sp_update_application_status(1, 'OFFERED', 'x', 3, @r);

-- F4. Candidate user given a recruiter profile -> 'Only users with role Recruiter ...'
-- INSERT INTO recruiters (recruiter_id, company_id, designation) VALUES (5, 1, 'Fake');

-- =============================================================================
-- SECTION G: WINDOW FUNCTIONS & CTEs
-- =============================================================================

-- G1. Rank applicants inside each job by match score (RANK, DENSE_RANK, ROW_NUMBER)
SELECT
    a.job_id,
    j.job_title,
    u.name AS candidate,
    a.match_score,
    RANK()       OVER w AS rnk,
    DENSE_RANK() OVER w AS dense_rnk,
    ROW_NUMBER() OVER w AS row_num
FROM applications a
JOIN jobs j ON j.job_id = a.job_id
JOIN users u ON u.user_id = a.candidate_id
WINDOW w AS (PARTITION BY a.job_id ORDER BY a.match_score DESC)
ORDER BY a.job_id, rnk;

-- G2. Running total of applications per day + 7-day moving average (frame clause)
WITH daily AS (
    SELECT DATE(applied_date) AS day, COUNT(*) AS apps
    FROM applications
    GROUP BY DATE(applied_date)
)
SELECT
    day,
    apps,
    SUM(apps) OVER (ORDER BY day) AS running_total,
    ROUND(AVG(apps) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS moving_avg_7
FROM daily
ORDER BY day;

-- G3. CTE pipeline: time each application spent before its latest status change (LAG)
WITH transitions AS (
    SELECT
        l.application_id,
        l.new_status,
        l.changed_at,
        LAG(l.changed_at) OVER (PARTITION BY l.application_id ORDER BY l.log_id) AS prev_changed_at
    FROM application_audit_logs l
)
SELECT new_status,
       COUNT(*) AS transitions,
       ROUND(AVG(TIMESTAMPDIFF(SECOND, prev_changed_at, changed_at)), 1) AS avg_seconds_in_prev_state
FROM transitions
WHERE prev_changed_at IS NOT NULL
GROUP BY new_status;

-- G4. Recursive CTE: skill-gap "learning path" - mandatory skills of job 7 each
--     candidate is missing, numbered 1..n per candidate
WITH RECURSIVE nums AS (
    SELECT 1 AS n UNION ALL SELECT n + 1 FROM nums WHERE n < 5
),
gaps AS (
    SELECT cd.candidate_id, s.skill_name,
           ROW_NUMBER() OVER (PARTITION BY cd.candidate_id ORDER BY s.skill_name) AS step
    FROM candidates cd
    JOIN job_skills js ON js.job_id = 7 AND js.is_mandatory = TRUE
    JOIN skills s ON s.skill_id = js.skill_id
    WHERE NOT EXISTS (SELECT 1 FROM candidate_skills cs
                       WHERE cs.candidate_id = cd.candidate_id AND cs.skill_id = js.skill_id)
)
SELECT u.name AS candidate, nums.n AS step, g.skill_name AS learn_next
FROM gaps g
JOIN nums ON nums.n = g.step
JOIN users u ON u.user_id = g.candidate_id
WHERE g.candidate_id IN (10, 15, 25)
ORDER BY u.name, step;

-- =============================================================================
-- SECTION H: FULL-TEXT SEARCH
-- =============================================================================

-- H1. Natural-language relevance search over job title + description
SELECT job_id, job_title,
       ROUND(MATCH(job_title, description) AGAINST ('kubernetes cloud infrastructure' IN NATURAL LANGUAGE MODE), 4) AS relevance
FROM jobs
WHERE MATCH(job_title, description) AGAINST ('kubernetes cloud infrastructure' IN NATURAL LANGUAGE MODE)
ORDER BY relevance DESC;

-- H2. Boolean mode: must mention Python, must not mention internship
SELECT job_id, job_title, status
FROM jobs
WHERE MATCH(job_title, description) AGAINST ('+python -internship' IN BOOLEAN MODE);

-- H3. Search candidate profiles (headline + bio)
SELECT cd.candidate_id, u.name, cd.headline
FROM candidates cd
JOIN users u ON u.user_id = cd.candidate_id
WHERE MATCH(cd.headline, cd.bio) AGAINST ('graph neo4j' IN NATURAL LANGUAGE MODE);

-- =============================================================================
-- SECTION I: SQL CANDIDATE RANKING (compare with Neo4j query 3 in neo4j/queries.cql)
-- =============================================================================

-- I1. Top 5 candidates for Job 1 by weighted skill match (view uses RANK())
SELECT job_id, candidate_id, candidate_name, match_score, rank_in_job, has_applied
FROM vw_job_match_leaderboard
WHERE job_id = 1 AND rank_in_job <= 5
ORDER BY rank_in_job, candidate_name;

-- I2. Outbox backlog waiting to be synced to Neo4j
SELECT entity_type, op, status, COUNT(*) AS events
FROM graph_sync_outbox
GROUP BY entity_type, op, status
ORDER BY entity_type, op;
