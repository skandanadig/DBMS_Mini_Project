-- =============================================================================
-- SKILLMATCH: DDL evolution demo (ALTER / DROP / RENAME)
-- File: 04_alter_demo.sql
-- Description: Demonstrates schema evolution on a live, populated database.
--   Every change is verified and then REVERTED, so the script leaves the
--   schema exactly as 01_schema.sql created it and is safe to re-run.
--   (If interrupted midway, reset with `docker compose down -v; docker compose up -d`.)
--
-- Run: docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t' < mysql/04_alter_demo.sql
-- =============================================================================

USE skillmatch_db;

-- -----------------------------------------------------------------------------
-- 1. ALTER TABLE ... ADD COLUMN (with DEFAULT so existing rows are backfilled)
-- -----------------------------------------------------------------------------
ALTER TABLE jobs
    ADD COLUMN openings SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER salary_max;

SELECT job_id, job_title, openings FROM jobs ORDER BY job_id LIMIT 5;

-- -----------------------------------------------------------------------------
-- 2. ALTER TABLE ... MODIFY (change default) and RENAME COLUMN
--    (done BEFORE adding the CHECK: MySQL refuses to rename/drop a column
--     that a CHECK constraint references - error 3959)
-- -----------------------------------------------------------------------------
ALTER TABLE jobs MODIFY COLUMN openings SMALLINT UNSIGNED NOT NULL DEFAULT 2;
ALTER TABLE jobs RENAME COLUMN openings TO vacancies;

SHOW COLUMNS FROM jobs LIKE 'vacancies';

-- -----------------------------------------------------------------------------
-- 3. ALTER TABLE ... ADD CONSTRAINT (CHECK) and prove it is enforced
-- -----------------------------------------------------------------------------
ALTER TABLE jobs
    ADD CONSTRAINT chk_jobs_vacancies CHECK (vacancies BETWEEN 1 AND 100);

UPDATE jobs SET vacancies = 3 WHERE job_id = 1;
-- UPDATE jobs SET vacancies = 500 WHERE job_id = 1;   -- would fail: Check constraint 'chk_jobs_vacancies' is violated.
-- ALTER TABLE jobs RENAME COLUMN vacancies TO seats;  -- would fail: error 3959 (column used by a CHECK)

SELECT CONSTRAINT_NAME, CHECK_CLAUSE
FROM information_schema.CHECK_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'skillmatch_db' AND CONSTRAINT_NAME = 'chk_jobs_vacancies';

-- -----------------------------------------------------------------------------
-- 4. ADD / DROP INDEX
-- -----------------------------------------------------------------------------
ALTER TABLE jobs ADD INDEX idx_jobs_location (location);
SHOW INDEX FROM jobs WHERE Key_name = 'idx_jobs_location';
EXPLAIN SELECT job_id FROM jobs WHERE location = 'Pune, India';
ALTER TABLE jobs DROP INDEX idx_jobs_location;

-- -----------------------------------------------------------------------------
-- 5. ALTER VIEW (add a column), then restore the original definition
-- -----------------------------------------------------------------------------
ALTER VIEW vw_top_demanded_skills AS
SELECT
    s.skill_id,
    s.skill_name,
    s.category,
    COUNT(js.job_id) AS demanding_jobs_count,
    SUM(CASE WHEN js.is_mandatory = TRUE THEN 1 ELSE 0 END) AS mandatory_in_jobs,
    ROUND(AVG(j.salary_max), 0) AS avg_max_salary          -- new column
FROM skills s
JOIN job_skills js ON s.skill_id = js.skill_id
JOIN jobs j ON js.job_id = j.job_id
WHERE j.status = 'OPEN'
GROUP BY s.skill_id, s.skill_name, s.category;

SELECT * FROM vw_top_demanded_skills ORDER BY avg_max_salary DESC LIMIT 5;

CREATE OR REPLACE VIEW vw_top_demanded_skills AS
SELECT
    s.skill_id,
    s.skill_name,
    s.category,
    COUNT(js.job_id) AS demanding_jobs_count,
    SUM(CASE WHEN js.is_mandatory = TRUE THEN 1 ELSE 0 END) AS mandatory_in_jobs
FROM skills s
JOIN job_skills js ON s.skill_id = js.skill_id
JOIN jobs j ON js.job_id = j.job_id
WHERE j.status = 'OPEN'
GROUP BY s.skill_id, s.skill_name, s.category;

-- -----------------------------------------------------------------------------
-- 6. CREATE -> ALTER (add FK) -> RENAME -> DROP a scratch table
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS job_tags;
DROP TABLE IF EXISTS job_labels;

CREATE TABLE job_tags (
    job_id INT NOT NULL,
    tag VARCHAR(40) NOT NULL,
    PRIMARY KEY (job_id, tag)
) ENGINE=InnoDB;

ALTER TABLE job_tags
    ADD CONSTRAINT fk_job_tags_job FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE;

INSERT INTO job_tags VALUES (1, 'hybrid'), (1, 'saas'), (7, 'research');
-- INSERT INTO job_tags VALUES (9999, 'x');   -- would fail: FK constraint (no job 9999)

RENAME TABLE job_tags TO job_labels;
SELECT * FROM job_labels;
DROP TABLE job_labels;

-- -----------------------------------------------------------------------------
-- 7. REVERT: DROP CHECK + DROP COLUMN (schema back to 01_schema.sql)
-- -----------------------------------------------------------------------------
ALTER TABLE jobs DROP CHECK chk_jobs_vacancies;   -- the CHECK must go before its column
ALTER TABLE jobs DROP COLUMN vacancies;

SHOW COLUMNS FROM jobs;
