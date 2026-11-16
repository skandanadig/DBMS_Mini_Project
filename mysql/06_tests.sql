-- =============================================================================
-- SKILLMATCH: Self-checking database test suite
-- File: 06_tests.sql
-- Description:
--   Automated PASS/FAIL tests for constraints, triggers, stored procedures,
--   the stored function, transaction rollback and the outbox.
--   * Negative tests run the offending statement through dynamic SQL inside
--     a handler and compare the MySQL error number:
--         3819 = CHECK constraint violated     1062 = duplicate key
--         1452 = FK: parent row missing        1451 = FK: row is referenced
--         1265 = invalid ENUM value (strict)   1644 = SIGNAL SQLSTATE '45000'
--   * Fixtures use @test.local accounts and are deleted at the end
--     (including the outbox events they generated), so the seed data is
--     left unchanged and the suite can be re-run.
--   * Final result sets: every test with PASS/FAIL, then a summary row.
--
-- Run (as root, creates helper procedures):
--   docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t' < mysql/06_tests.sql
-- =============================================================================

USE skillmatch_db;

-- -----------------------------------------------------------------------------
-- Test harness
-- -----------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS t_results;
CREATE TEMPORARY TABLE t_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    test VARCHAR(80) NOT NULL,
    result ENUM('PASS', 'FAIL') NOT NULL,
    detail VARCHAR(500)
);

DROP PROCEDURE IF EXISTS t_expect_error;
DROP PROCEDURE IF EXISTS t_assert;
DROP PROCEDURE IF EXISTS t_rollback_probe;

DELIMITER //

-- Runs p_sql and records PASS if it fails with MySQL error p_errno
CREATE PROCEDURE t_expect_error(IN p_name VARCHAR(80), IN p_sql TEXT, IN p_errno INT)
BEGIN
    DECLARE v_errno INT DEFAULT 0;
    DECLARE v_msg VARCHAR(400) DEFAULT '';
    -- SQLWARNING too: in strict mode an invalid ENUM value raises error 1265
    -- but keeps the warning SQLSTATE '01000', which SQLEXCEPTION does not match.
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION, SQLWARNING
    BEGIN
        GET DIAGNOSTICS CONDITION 1 v_errno = MYSQL_ERRNO, v_msg = MESSAGE_TEXT;
    END;

    SET @t_sql = p_sql;
    PREPARE t_stmt FROM @t_sql;
    IF v_errno = 0 THEN
        EXECUTE t_stmt;
        DEALLOCATE PREPARE t_stmt;
    END IF;

    INSERT INTO t_results (test, result, detail)
    VALUES (p_name,
            IF(v_errno = p_errno, 'PASS', 'FAIL'),
            CONCAT('expected errno ', p_errno, ', got ', v_errno,
                   IF(v_msg <> '', CONCAT(' - ', v_msg), '')));
END //

CREATE PROCEDURE t_assert(IN p_name VARCHAR(80), IN p_cond BOOLEAN, IN p_detail VARCHAR(400))
BEGIN
    INSERT INTO t_results (test, result, detail)
    VALUES (p_name, IF(COALESCE(p_cond, FALSE), 'PASS', 'FAIL'), p_detail);
END //

-- Explicit transaction whose 2nd statement violates a CHECK constraint:
-- the handler must roll back the 1st statement (and its trigger side effects).
CREATE PROCEDURE t_rollback_probe(IN p_job_id INT, IN p_candidate_id INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
    END;

    START TRANSACTION;
    INSERT INTO applications (job_id, candidate_id) VALUES (p_job_id, p_candidate_id);
    INSERT INTO users (name, email, password_hash) VALUES ('Broken', 'not-an-email', 'x');
    COMMIT;
END //

DELIMITER ;

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------
SET @t_start_event = (SELECT COALESCE(MAX(event_id), 0) FROM graph_sync_outbox);

INSERT INTO users (name, email, password_hash, role) VALUES ('QA Recruiter', 'qa.recruiter@test.local', 'x', 'Recruiter');
SET @t_rec = LAST_INSERT_ID();
INSERT INTO recruiters (recruiter_id, company_id, designation) VALUES (@t_rec, 1, 'QA Recruiter');

INSERT INTO users (name, email, password_hash, role) VALUES ('QA Candidate A', 'qa.cand.a@test.local', 'x', 'Candidate');
SET @t_cand_a = LAST_INSERT_ID();
INSERT INTO candidates (candidate_id, experience_years, resume_url) VALUES (@t_cand_a, 3.0, 'https://cdn.skillmatch.io/resumes/qa_a.pdf');

INSERT INTO users (name, email, password_hash, role) VALUES ('QA Candidate B', 'qa.cand.b@test.local', 'x', 'Candidate');
SET @t_cand_b = LAST_INSERT_ID();
INSERT INTO candidates (candidate_id, experience_years, resume_url) VALUES (@t_cand_b, 1.0, NULL);   -- no resume

INSERT INTO users (name, email, password_hash, role) VALUES ('QA Candidate C', 'qa.cand.c@test.local', 'x', 'Candidate');
SET @t_cand_c = LAST_INSERT_ID();
INSERT INTO candidates (candidate_id, experience_years, resume_url) VALUES (@t_cand_c, 2.0, 'https://cdn.skillmatch.io/resumes/qa_c.pdf');

-- Candidate A: TypeScript Advanced, React Expert (no MySQL)
INSERT INTO candidate_skills (candidate_id, skill_id, proficiency_level, years_experience)
VALUES (@t_cand_a, 2, 'Advanced', 3.0), (@t_cand_a, 4, 'Expert', 3.0);

INSERT INTO jobs (recruiter_id, job_title, description, location, salary_min, salary_max)
VALUES (@t_rec, 'QA Open Job', 'Fixture job for automated tests', 'Remote', 100, 200);
SET @t_job_open = LAST_INSERT_ID();
-- mandatory TS(Adv) + React(Adv), optional MySQL(Int) => A scores (2+2+0)/5 = 80.00
INSERT INTO job_skills (job_id, skill_id, required_level, is_mandatory)
VALUES (@t_job_open, 2, 'Advanced', TRUE), (@t_job_open, 4, 'Advanced', TRUE), (@t_job_open, 9, 'Intermediate', FALSE);

INSERT INTO jobs (recruiter_id, job_title, description, location, salary_min, salary_max, status)
VALUES (@t_rec, 'QA Closed Job', 'Closed fixture job', 'Remote', 100, 200, 'CLOSED');
SET @t_job_closed = LAST_INSERT_ID();

-- =============================================================================
-- 1. CONSTRAINTS (CHECK, UNIQUE, FK, ENUM)
-- =============================================================================
CALL t_expect_error('C01 CHECK email format',
     "INSERT INTO users (name, email, password_hash) VALUES ('Bad', 'not-an-email', 'x')", 3819);
CALL t_expect_error('C02 CHECK blank user name',
     "INSERT INTO users (name, email, password_hash) VALUES ('   ', 'blank@test.local', 'x')", 3819);
CALL t_expect_error('C03 CHECK salary_max >= salary_min',
     CONCAT("INSERT INTO jobs (recruiter_id, job_title, description, location, salary_min, salary_max) VALUES (",
            @t_rec, ", 'Bad salary', 'x', 'Remote', 500, 100)"), 3819);
CALL t_expect_error('C04 CHECK match_score <= 100',
     CONCAT("UPDATE applications SET match_score = 150 WHERE application_id = ",
            (SELECT MIN(application_id) FROM applications)), 3819);
CALL t_expect_error('C05 CHECK experience_years >= 0',
     CONCAT("UPDATE candidates SET experience_years = -1 WHERE candidate_id = ", @t_cand_a), 3819);
CALL t_expect_error('C06 CHECK website must be a URL',
     "UPDATE companies SET website = 'techcorp' WHERE company_id = 1", 3819);
CALL t_expect_error('C07 UNIQUE email',
     "INSERT INTO users (name, email, password_hash) VALUES ('Dup', 'admin@skillmatch.io', 'x')", 1062);
CALL t_expect_error('C08 FK candidate_skills -> missing skill',
     CONCAT("INSERT INTO candidate_skills (candidate_id, skill_id) VALUES (", @t_cand_a, ", 999999)"), 1452);
CALL t_expect_error('C09 FK RESTRICT delete company with recruiters',
     "DELETE FROM companies WHERE company_id = 1", 1451);
CALL t_expect_error('C10 FK RESTRICT delete recruiter with jobs',
     CONCAT("DELETE FROM recruiters WHERE recruiter_id = ", @t_rec), 1451);
CALL t_expect_error('C11 ENUM invalid employment_type',
     CONCAT("UPDATE jobs SET employment_type = 'Freelance' WHERE job_id = ", @t_job_open), 1265);

-- =============================================================================
-- 2. STORED PROCEDURE sp_submit_application + insert triggers
-- =============================================================================
SET @o_id = NULL, @o_code = NULL, @o_msg = NULL;
CALL sp_submit_application(@t_cand_a, @t_job_open, @o_id, @o_code, @o_msg);
SET @t_app = @o_id;
CALL t_assert('P01 submit -> SUCCESS', @o_code = 'SUCCESS' AND @o_id IS NOT NULL, CONCAT_WS(' | ', @o_code, @o_msg));

CALL t_assert('T01 insert trigger forces status APPLIED',
     (SELECT status FROM applications WHERE application_id = @t_app) = 'APPLIED', NULL);
CALL t_assert('T02 insert trigger computes match_score = 80.00',
     (SELECT match_score FROM applications WHERE application_id = @t_app) = 80.00,
     CONCAT('got ', (SELECT match_score FROM applications WHERE application_id = @t_app)));
CALL t_assert('T03 insert trigger snapshots resume_url',
     (SELECT resume_snapshot_url FROM applications WHERE application_id = @t_app) = 'https://cdn.skillmatch.io/resumes/qa_a.pdf', NULL);
CALL t_assert('T04 insert trigger writes NULL -> APPLIED audit row',
     EXISTS (SELECT 1 FROM application_audit_logs
              WHERE application_id = @t_app AND old_status IS NULL AND new_status = 'APPLIED'
                AND changed_by = @t_cand_a), NULL);
CALL t_assert('F01 fn_match_score(A, open job) = 80.00',
     fn_match_score(@t_cand_a, @t_job_open) = 80.00, CONCAT('got ', fn_match_score(@t_cand_a, @t_job_open)));
CALL t_assert('F02 fn_match_score with no skills = 0.00',
     fn_match_score(@t_cand_c, @t_job_open) = 0.00, NULL);

SET @o_id = NULL, @o_code = NULL, @o_msg = NULL;
CALL sp_submit_application(@t_cand_a, @t_job_open, @o_id, @o_code, @o_msg);
CALL t_assert('P02 duplicate application -> DUPLICATE', @o_code = 'DUPLICATE' AND @o_id IS NULL, @o_msg);

CALL t_expect_error('C12 UNIQUE(job_id, candidate_id) on direct insert',
     CONCAT("INSERT INTO applications (job_id, candidate_id) VALUES (", @t_job_open, ", ", @t_cand_a, ")"), 1062);

SET @o_id = NULL, @o_code = NULL, @o_msg = NULL;
CALL sp_submit_application(@t_cand_c, @t_job_closed, @o_id, @o_code, @o_msg);
CALL t_assert('P03 closed job -> FAILED', @o_code = 'FAILED', @o_msg);

SET @o_id = NULL, @o_code = NULL, @o_msg = NULL;
CALL sp_submit_application(@t_cand_c, 999999, @o_id, @o_code, @o_msg);
CALL t_assert('P04 missing job -> NOT_FOUND', @o_code = 'NOT_FOUND', @o_msg);

SET @o_id = NULL, @o_code = NULL, @o_msg = NULL;
CALL sp_submit_application(999999, @t_job_open, @o_id, @o_code, @o_msg);
CALL t_assert('P05 missing candidate -> NOT_FOUND', @o_code = 'NOT_FOUND', @o_msg);

SET @o_id = NULL, @o_code = NULL, @o_msg = NULL;
CALL sp_submit_application(@t_cand_b, @t_job_open, @o_id, @o_code, @o_msg);
CALL t_assert('P06 no resume -> FAILED', @o_code = 'FAILED', @o_msg);

CALL t_assert('R01 failed submissions left no rows behind',
     (SELECT COUNT(*) FROM applications WHERE candidate_id IN (@t_cand_b, @t_cand_c)) = 0, NULL);

-- =============================================================================
-- 3. TRIGGERS (business rules)
-- =============================================================================
CALL t_expect_error('T05 cannot apply to CLOSED job (direct insert)',
     CONCAT("INSERT INTO applications (job_id, candidate_id) VALUES (", @t_job_closed, ", ", @t_cand_c, ")"), 1644);
CALL t_expect_error('T06 recruiter profile for Candidate-role user',
     CONCAT("INSERT INTO recruiters (recruiter_id, company_id, designation) VALUES (", @t_cand_c, ", 1, 'Fake')"), 1644);
CALL t_expect_error('T07 candidate profile for Recruiter-role user',
     CONCAT("INSERT INTO candidates (candidate_id) VALUES (", @t_rec, ")"), 1644);
CALL t_expect_error('T08 role immutable once profile exists',
     CONCAT("UPDATE users SET role = 'Admin' WHERE user_id = ", @t_cand_a), 1644);
CALL t_expect_error('T09 invalid transition APPLIED -> OFFERED',
     CONCAT("UPDATE applications SET status = 'OFFERED' WHERE application_id = ", @t_app), 1644);
CALL t_expect_error('T10 application job_id is immutable',
     CONCAT("UPDATE applications SET job_id = 1 WHERE application_id = ", @t_app), 1644);
CALL t_expect_error('T13 job cannot be transferred to another recruiter',
     CONCAT("UPDATE jobs SET recruiter_id = 3 WHERE job_id = ", @t_job_closed), 1644);
UPDATE jobs SET status = 'ARCHIVED' WHERE job_id = @t_job_closed;
CALL t_expect_error('T14 ARCHIVED job cannot be reopened',
     CONCAT("UPDATE jobs SET status = 'OPEN' WHERE job_id = ", @t_job_closed), 1644);

-- =============================================================================
-- 4. STORED PROCEDURE sp_update_application_status (authz + audit)
-- =============================================================================
SET @o_rows = NULL;
CALL sp_update_application_status(@t_app, 'UNDER_REVIEW', 'QA shortlisted', @t_rec, @o_rows);
CALL t_assert('P07 owner recruiter updates status (1 row)', @o_rows = 1, CONCAT('rows=', @o_rows));
CALL t_assert('P08 audit row carries remarks + changed_by',
     EXISTS (SELECT 1 FROM application_audit_logs
              WHERE application_id = @t_app AND old_status = 'APPLIED' AND new_status = 'UNDER_REVIEW'
                AND remarks = 'QA shortlisted' AND changed_by = @t_rec), NULL);

CALL t_expect_error('P09 non-owner recruiter is rejected',
     CONCAT("CALL sp_update_application_status(", @t_app, ", 'INTERVIEW_SCHEDULED', 'x', 3, @x)"), 1644);
CALL t_expect_error('P10 candidate cannot change status',
     CONCAT("CALL sp_update_application_status(", @t_app, ", 'INTERVIEW_SCHEDULED', 'x', ", @t_cand_a, ", @x)"), 1644);
CALL t_expect_error('P11 invalid status value',
     CONCAT("CALL sp_update_application_status(", @t_app, ", 'HIRED', 'x', ", @t_rec, ", @x)"), 1644);
CALL t_expect_error('P12 invalid transition via procedure (UNDER_REVIEW -> OFFERED)',
     CONCAT("CALL sp_update_application_status(", @t_app, ", 'OFFERED', 'x', ", @t_rec, ", @x)"), 1644);
CALL t_assert('P13 rejected calls did not change status',
     (SELECT status FROM applications WHERE application_id = @t_app) = 'UNDER_REVIEW', NULL);

SET @o_rows = NULL;
CALL sp_update_application_status(999999, 'UNDER_REVIEW', 'x', @t_rec, @o_rows);
CALL t_assert('P14 unknown application -> 0 rows', @o_rows = 0, CONCAT('rows=', @o_rows));

SET @o_rows = NULL;
CALL sp_update_application_status(@t_app, 'INTERVIEW_SCHEDULED', 'Admin override', 1, @o_rows);
CALL t_assert('P15 Admin may update any application', @o_rows = 1, NULL);

-- Stale-metadata guard: an ad-hoc UPDATE without remarks must not reuse the previous remarks
UPDATE applications SET status = 'OFFERED' WHERE application_id = @t_app;
CALL t_assert('T11 ad-hoc status change gets default remarks, NULL changed_by',
     EXISTS (SELECT 1 FROM application_audit_logs
              WHERE application_id = @t_app AND new_status = 'OFFERED'
                AND changed_by IS NULL
                AND remarks = 'Status updated from INTERVIEW_SCHEDULED to OFFERED'), NULL);
CALL t_expect_error('T12 OFFERED is terminal',
     CONCAT("UPDATE applications SET status = 'REJECTED' WHERE application_id = ", @t_app), 1644);

-- =============================================================================
-- 5. TRANSACTION ROLLBACK
-- =============================================================================
SET @t_audit_before = (SELECT COUNT(*) FROM application_audit_logs);
CALL t_rollback_probe(@t_job_open, @t_cand_c);
CALL t_assert('R02 rolled-back transaction left no application',
     NOT EXISTS (SELECT 1 FROM applications WHERE job_id = @t_job_open AND candidate_id = @t_cand_c), NULL);
CALL t_assert('R03 rolled-back transaction left no audit row (trigger side effect undone)',
     (SELECT COUNT(*) FROM application_audit_logs) = @t_audit_before, NULL);

-- =============================================================================
-- 6. OUTBOX (MySQL -> Neo4j events written in the same transaction)
-- =============================================================================
CALL t_assert('O01 candidate_skill insert -> CANDIDATE_SKILL UPSERT event',
     EXISTS (SELECT 1 FROM graph_sync_outbox
              WHERE event_id > @t_start_event AND entity_type = 'CANDIDATE_SKILL'
                AND entity_id = CONCAT(@t_cand_a, ':2') AND op = 'UPSERT' AND status = 'PENDING'), NULL);
CALL t_assert('O02 job insert -> JOB UPSERT event with derived company_id',
     EXISTS (SELECT 1 FROM graph_sync_outbox
              WHERE event_id > @t_start_event AND entity_type = 'JOB'
                AND entity_id = CAST(@t_job_open AS CHAR) AND op = 'UPSERT'
                AND JSON_EXTRACT(payload, '$.company_id') = 1), NULL);

SET @t_ev_before = (SELECT COUNT(*) FROM graph_sync_outbox);
UPDATE candidates SET resume_url = 'https://cdn.skillmatch.io/resumes/qa_a_v2.pdf' WHERE candidate_id = @t_cand_a;
CALL t_assert('O03 graph-irrelevant change (resume_url) emits no event',
     (SELECT COUNT(*) FROM graph_sync_outbox) = @t_ev_before, NULL);

DELETE FROM candidate_skills WHERE candidate_id = @t_cand_a AND skill_id = 4;
CALL t_assert('O04 candidate_skill delete -> DELETE event',
     EXISTS (SELECT 1 FROM graph_sync_outbox
              WHERE event_id > @t_start_event AND entity_type = 'CANDIDATE_SKILL'
                AND entity_id = CONCAT(@t_cand_a, ':4') AND op = 'DELETE'), NULL);

-- -----------------------------------------------------------------------------
-- Cleanup: remove fixtures (cascades) and the outbox events they produced
-- -----------------------------------------------------------------------------
DELETE FROM jobs WHERE recruiter_id = @t_rec;
DELETE FROM users WHERE email LIKE '%@test.local';
DELETE FROM graph_sync_outbox WHERE event_id > @t_start_event;

CALL t_assert('Z01 cleanup removed all fixtures',
     NOT EXISTS (SELECT 1 FROM users WHERE email LIKE '%@test.local'), NULL);

DROP PROCEDURE t_expect_error;
DROP PROCEDURE t_assert;
DROP PROCEDURE t_rollback_probe;

-- -----------------------------------------------------------------------------
-- Report
-- -----------------------------------------------------------------------------
SELECT id, test, result, detail FROM t_results ORDER BY id;

SELECT SUM(result = 'PASS') AS passed,
       SUM(result = 'FAIL') AS failed,
       COUNT(*) AS total,
       IF(SUM(result = 'FAIL') = 0, 'ALL TESTS PASSED', 'SOME TESTS FAILED') AS verdict
FROM t_results;

DROP TEMPORARY TABLE t_results;
