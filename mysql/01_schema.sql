-- =============================================================================
-- SKILLMATCH: Intelligent Job and Skill Matching Platform
-- Database: MySQL 8.0+
-- File: 01_schema.sql
-- Description: Complete relational schema with DDL, Constraints, Indexes,
--              Full-text search, Views, Functions, Stored Procedures,
--              Triggers, Transactions and a transactional outbox for
--              MySQL -> Neo4j synchronisation.
-- Designed for PES University DBMS Experiential Learning - Level 3 Project
--
-- Run order: 01_schema.sql -> 02_seed_data.sql (both auto-run by Docker),
--            then 03..06 manually (see README).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. CLEAN SLATE
-- Dropping the whole database (instead of object-by-object) guarantees the
-- script is idempotent and never leaves stale triggers/views behind.
-- Schema-level GRANTs for the app user are stored by database name in
-- mysql.db, so they survive the drop/re-create.
-- -----------------------------------------------------------------------------
DROP DATABASE IF EXISTS skillmatch_db;

CREATE DATABASE skillmatch_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE skillmatch_db;

-- =============================================================================
-- TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ENTITY: USERS (Superclass / base account table for all platform roles)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('Candidate', 'Recruiter', 'Admin') NOT NULL DEFAULT 'Candidate',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uk_users_email UNIQUE (email),
    CONSTRAINT chk_users_name_not_blank CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT chk_email_format CHECK (
        REGEXP_LIKE(email, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')
    )
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 2. ENTITY: CANDIDATES (Subtype of USERS - disjoint, partial specialization)
-- -----------------------------------------------------------------------------
CREATE TABLE candidates (
    candidate_id INT PRIMARY KEY,
    phone VARCHAR(20),
    location VARCHAR(100),
    experience_years DECIMAL(3, 1) NOT NULL DEFAULT 0.0,
    resume_url VARCHAR(500),
    headline VARCHAR(150),
    bio TEXT,
    CONSTRAINT fk_candidates_user FOREIGN KEY (candidate_id)
        REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT chk_experience_range CHECK (experience_years BETWEEN 0.0 AND 60.0),
    CONSTRAINT chk_candidate_phone CHECK (phone IS NULL OR REGEXP_LIKE(phone, '^\\+?[0-9 -]{7,20}$')),
    CONSTRAINT chk_candidate_resume_url CHECK (resume_url IS NULL OR resume_url LIKE 'http%://%')
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 3. ENTITY: COMPANIES (Organizations posting jobs)
-- -----------------------------------------------------------------------------
CREATE TABLE companies (
    company_id INT AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(150) NOT NULL,
    industry VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    website VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_company_name UNIQUE (company_name),
    CONSTRAINT chk_company_website CHECK (website IS NULL OR website LIKE 'http%://%')
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 4. ENTITY: RECRUITERS (Subtype of USERS - disjoint, partial specialization)
-- -----------------------------------------------------------------------------
CREATE TABLE recruiters (
    recruiter_id INT PRIMARY KEY,
    company_id INT NOT NULL,
    designation VARCHAR(100) NOT NULL,
    CONSTRAINT fk_recruiters_user FOREIGN KEY (recruiter_id)
        REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_recruiters_company FOREIGN KEY (company_id)
        REFERENCES companies(company_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 5. ENTITY: SKILLS (Taxonomy of technical skills; mirrored as :Skill in Neo4j)
-- -----------------------------------------------------------------------------
CREATE TABLE skills (
    skill_id INT AUTO_INCREMENT PRIMARY KEY,
    skill_name VARCHAR(80) NOT NULL,
    category VARCHAR(50) NOT NULL, -- e.g. Frontend, Backend, Database, Cloud, AI/ML
    CONSTRAINT uk_skill_name UNIQUE (skill_name),
    CONSTRAINT chk_skill_name_not_blank CHECK (CHAR_LENGTH(TRIM(skill_name)) > 0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 6. ASSOCIATIVE ENTITY: CANDIDATE_SKILLS (M:N between Candidate & Skill)
-- -----------------------------------------------------------------------------
CREATE TABLE candidate_skills (
    candidate_id INT NOT NULL,
    skill_id INT NOT NULL,
    proficiency_level ENUM('Beginner', 'Intermediate', 'Advanced', 'Expert') NOT NULL DEFAULT 'Intermediate',
    years_experience DECIMAL(3, 1) NOT NULL DEFAULT 1.0,
    PRIMARY KEY (candidate_id, skill_id),
    CONSTRAINT fk_cskills_candidate FOREIGN KEY (candidate_id)
        REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    CONSTRAINT fk_cskills_skill FOREIGN KEY (skill_id)
        REFERENCES skills(skill_id) ON DELETE CASCADE,
    CONSTRAINT chk_cskills_years CHECK (years_experience BETWEEN 0.0 AND 60.0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 7. ENTITY: JOBS (Job postings by recruiters)
--
-- NORMALIZATION NOTE: the earlier design stored jobs.company_id as well as
-- jobs.recruiter_id. Because recruiter_id -> company_id (recruiters table),
-- that created the transitive dependency job_id -> recruiter_id -> company_id
-- (a 3NF violation) and allowed a job's company to disagree with its
-- recruiter's company. The company is now always derived via
-- jobs -> recruiters -> companies.
-- Trade-off (documented): if a recruiter moves company, their existing jobs
-- move with them. Recruiter re-assignment is treated as a rare administrative
-- action; the outbox trigger on recruiters re-syncs those jobs to Neo4j.
-- -----------------------------------------------------------------------------
CREATE TABLE jobs (
    job_id INT AUTO_INCREMENT PRIMARY KEY,
    recruiter_id INT NOT NULL,
    job_title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(100) NOT NULL,
    employment_type ENUM('Full-time', 'Part-time', 'Contract', 'Internship', 'Remote') NOT NULL DEFAULT 'Full-time',
    salary_min DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    salary_max DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    posted_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('OPEN', 'CLOSED', 'ARCHIVED') NOT NULL DEFAULT 'OPEN',
    CONSTRAINT fk_jobs_recruiter FOREIGN KEY (recruiter_id)
        REFERENCES recruiters(recruiter_id) ON DELETE RESTRICT,
    CONSTRAINT chk_salary_range CHECK (salary_max >= salary_min AND salary_min >= 0),
    CONSTRAINT chk_job_title_length CHECK (CHAR_LENGTH(TRIM(job_title)) >= 3)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 8. ASSOCIATIVE ENTITY: JOB_SKILLS (M:N between Job & Skill)
-- -----------------------------------------------------------------------------
CREATE TABLE job_skills (
    job_id INT NOT NULL,
    skill_id INT NOT NULL,
    required_level ENUM('Beginner', 'Intermediate', 'Advanced', 'Expert') NOT NULL DEFAULT 'Intermediate',
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (job_id, skill_id),
    CONSTRAINT fk_jskills_job FOREIGN KEY (job_id)
        REFERENCES jobs(job_id) ON DELETE CASCADE,
    CONSTRAINT fk_jskills_skill FOREIGN KEY (skill_id)
        REFERENCES skills(skill_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 9. ENTITY: APPLICATIONS (Job applications submitted by candidates)
--
-- status_changed_by / status_remarks describe the MOST RECENT status change.
-- They are set in the same UPDATE as the status and read by the audit
-- trigger, so audit metadata never travels through session variables
-- (which would leak between requests on pooled connections).
-- match_score and resume_snapshot_url are snapshots taken at apply time.
-- -----------------------------------------------------------------------------
CREATE TABLE applications (
    application_id INT AUTO_INCREMENT PRIMARY KEY,
    job_id INT NOT NULL,
    candidate_id INT NOT NULL,
    applied_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('APPLIED', 'UNDER_REVIEW', 'INTERVIEW_SCHEDULED', 'OFFERED', 'REJECTED') NOT NULL DEFAULT 'APPLIED',
    match_score DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    resume_snapshot_url VARCHAR(500),
    status_changed_by INT NULL,
    status_remarks VARCHAR(255) NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uk_job_candidate UNIQUE (job_id, candidate_id),
    CONSTRAINT fk_apps_job FOREIGN KEY (job_id)
        REFERENCES jobs(job_id) ON DELETE CASCADE,
    CONSTRAINT fk_apps_candidate FOREIGN KEY (candidate_id)
        REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    CONSTRAINT fk_apps_changed_by FOREIGN KEY (status_changed_by)
        REFERENCES users(user_id) ON DELETE SET NULL,
    CONSTRAINT chk_match_score CHECK (match_score BETWEEN 0.00 AND 100.00)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 10. AUDIT TABLE: APPLICATION_AUDIT_LOGS (Status transition history)
-- -----------------------------------------------------------------------------
CREATE TABLE application_audit_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    old_status ENUM('APPLIED', 'UNDER_REVIEW', 'INTERVIEW_SCHEDULED', 'OFFERED', 'REJECTED') NULL,
    new_status ENUM('APPLIED', 'UNDER_REVIEW', 'INTERVIEW_SCHEDULED', 'OFFERED', 'REJECTED') NOT NULL,
    changed_by INT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks VARCHAR(255),
    CONSTRAINT fk_audit_application FOREIGN KEY (application_id)
        REFERENCES applications(application_id) ON DELETE CASCADE,
    CONSTRAINT fk_audit_changed_by FOREIGN KEY (changed_by)
        REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 11. TRANSACTIONAL OUTBOX: GRAPH_SYNC_OUTBOX (MySQL -> Neo4j events)
--
-- Rows are written by triggers in the SAME transaction as the business
-- change, so an event exists if and only if the change committed.
-- A worker applies PENDING events to Neo4j with idempotent MERGE / DETACH
-- DELETE and marks them DONE (or FAILED after 5 attempts).
-- Consistency model: eventual - Neo4j may lag MySQL until the worker runs.
-- -----------------------------------------------------------------------------
CREATE TABLE graph_sync_outbox (
    event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    entity_type ENUM('CANDIDATE', 'SKILL', 'CANDIDATE_SKILL', 'JOB', 'JOB_SKILL') NOT NULL,
    entity_id VARCHAR(64) NOT NULL,          -- '5' or '5:12' for composite keys
    op ENUM('UPSERT', 'DELETE') NOT NULL,
    payload JSON NULL,                       -- row snapshot at trigger time (NULL for DELETE)
    status ENUM('PENDING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    last_error VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,
    CONSTRAINT chk_outbox_attempts CHECK (attempts >= 0)
) ENGINE=InnoDB;

-- =============================================================================
-- INDEXES FOR PERFORMANCE OPTIMIZATION (Advanced Concept: Indexing)
-- (InnoDB already indexes every PK, UNIQUE and FK column.)
-- =============================================================================
CREATE INDEX idx_jobs_status_posted ON jobs(status, posted_date DESC);   -- job feed: WHERE status ORDER BY posted_date
CREATE INDEX idx_apps_job_status ON applications(job_id, status);         -- recruiter pipeline filters
CREATE INDEX idx_apps_cand_status ON applications(candidate_id, status);  -- candidate dashboard filters
CREATE INDEX idx_cand_skills_level ON candidate_skills(skill_id, proficiency_level); -- "who knows skill X at level >= Y"
CREATE INDEX idx_outbox_status ON graph_sync_outbox(status, event_id);    -- worker: next PENDING events in order

-- =============================================================================
-- FULL-TEXT SEARCH INDEXES (Advanced Concept: Full-text search)
-- =============================================================================
CREATE FULLTEXT INDEX ft_jobs_text ON jobs(job_title, description);
CREATE FULLTEXT INDEX ft_candidates_profile ON candidates(headline, bio);

-- =============================================================================
-- STORED FUNCTION (Advanced Concept: Functions)
-- =============================================================================

-- fn_match_score: weighted skill match of a candidate against a job (0-100).
--   * mandatory skill weight = 2, optional skill weight = 1
--   * credit per skill = min(candidate_level / required_level, 1)
--     where Beginner=1, Intermediate=2, Advanced=3, Expert=4; missing = 0
--   * score = 100 * SUM(weight * credit) / SUM(weight)
DELIMITER //
CREATE FUNCTION fn_match_score(p_candidate_id INT, p_job_id INT)
RETURNS DECIMAL(5,2)
READS SQL DATA
BEGIN
    DECLARE v_score DECIMAL(9,4);

    SELECT 100 * SUM(
               IF(js.is_mandatory, 2, 1) *
               LEAST(
                   COALESCE(FIELD(cs.proficiency_level, 'Beginner', 'Intermediate', 'Advanced', 'Expert'), 0) /
                   FIELD(js.required_level, 'Beginner', 'Intermediate', 'Advanced', 'Expert'),
                   1)
           ) / SUM(IF(js.is_mandatory, 2, 1))
      INTO v_score
      FROM job_skills js
      LEFT JOIN candidate_skills cs
             ON cs.skill_id = js.skill_id
            AND cs.candidate_id = p_candidate_id
     WHERE js.job_id = p_job_id;

    RETURN ROUND(COALESCE(v_score, 0), 2);
END //
DELIMITER ;

-- =============================================================================
-- DATABASE VIEWS (Advanced Concept: Views)
-- =============================================================================

-- View 1: Job board listing (company derived via recruiter - see jobs note)
CREATE VIEW vw_job_listings AS
SELECT
    j.job_id,
    j.job_title,
    j.description,
    j.location,
    j.employment_type,
    j.salary_min,
    j.salary_max,
    j.posted_date,
    j.status,
    j.recruiter_id,
    u.name AS recruiter_name,
    c.company_id,
    c.company_name,
    c.industry,
    (SELECT COUNT(*) FROM job_skills js WHERE js.job_id = j.job_id) AS required_skill_count,
    (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.job_id) AS applicant_count
FROM jobs j
JOIN recruiters r ON j.recruiter_id = r.recruiter_id
JOIN users u ON r.recruiter_id = u.user_id
JOIN companies c ON r.company_id = c.company_id;

-- View 2: Recruiter Hiring Pipeline with Aggregations (JOIN, GROUP BY, conditional SUM)
CREATE VIEW vw_recruiter_pipeline AS
SELECT
    j.job_id,
    j.job_title,
    j.recruiter_id,
    c.company_id,
    c.company_name,
    j.status AS job_status,
    j.posted_date,
    COUNT(a.application_id) AS total_applicants,
    COALESCE(ROUND(AVG(a.match_score), 2), 0.00) AS avg_match_score,
    SUM(CASE WHEN a.status = 'UNDER_REVIEW' THEN 1 ELSE 0 END) AS under_review_count,
    SUM(CASE WHEN a.status = 'INTERVIEW_SCHEDULED' THEN 1 ELSE 0 END) AS interview_count,
    SUM(CASE WHEN a.status = 'OFFERED' THEN 1 ELSE 0 END) AS offer_count,
    SUM(CASE WHEN a.status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_count
FROM jobs j
JOIN recruiters r ON j.recruiter_id = r.recruiter_id
JOIN companies c ON r.company_id = c.company_id
LEFT JOIN applications a ON j.job_id = a.job_id
GROUP BY j.job_id, j.job_title, j.recruiter_id, c.company_id, c.company_name, j.status, j.posted_date;

-- View 3: Candidate Applications Dashboard
CREATE VIEW vw_candidate_applications AS
SELECT
    a.application_id,
    a.candidate_id,
    u.name AS candidate_name,
    j.job_id,
    j.job_title,
    c.company_name,
    j.location AS job_location,
    j.employment_type,
    j.salary_min,
    j.salary_max,
    j.status AS job_status,
    a.applied_date,
    a.status AS application_status,
    a.match_score,
    a.last_updated
FROM applications a
JOIN jobs j ON a.job_id = j.job_id
JOIN recruiters r ON j.recruiter_id = r.recruiter_id
JOIN companies c ON r.company_id = c.company_id
JOIN users u ON a.candidate_id = u.user_id;

-- View 4: Top Demanded Skills in OPEN job postings
-- (ORDER BY removed from the view definition: ordering belongs to the
--  querying statement; the old HAVING > 0 was redundant after an inner JOIN.)
CREATE VIEW vw_top_demanded_skills AS
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

-- View 5: SQL candidate ranking per OPEN job (window function over fn_match_score)
-- Used for the SQL-vs-Neo4j ranking comparison.
CREATE VIEW vw_job_match_leaderboard AS
SELECT
    t.job_id,
    t.job_title,
    t.candidate_id,
    t.candidate_name,
    t.experience_years,
    t.match_score,
    t.has_applied,
    RANK() OVER (PARTITION BY t.job_id ORDER BY t.match_score DESC) AS rank_in_job
FROM (
    SELECT
        j.job_id,
        j.job_title,
        cd.candidate_id,
        u.name AS candidate_name,
        cd.experience_years,
        fn_match_score(cd.candidate_id, j.job_id) AS match_score,
        EXISTS (SELECT 1 FROM applications a
                 WHERE a.job_id = j.job_id AND a.candidate_id = cd.candidate_id) AS has_applied
    FROM jobs j
    CROSS JOIN candidates cd
    JOIN users u ON u.user_id = cd.candidate_id
    WHERE j.status = 'OPEN'
) t;

-- =============================================================================
-- TRIGGERS (Advanced Concept: Triggers)
-- =============================================================================

DELIMITER //

-- ---- Specialization integrity: subtype row must match users.role ----------
CREATE TRIGGER trg_candidate_role_check
BEFORE INSERT ON candidates
FOR EACH ROW
BEGIN
    IF (SELECT role FROM users WHERE user_id = NEW.candidate_id) <> 'Candidate' THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Only users with role Candidate can have a candidate profile.';
    END IF;
END //

CREATE TRIGGER trg_recruiter_role_check
BEFORE INSERT ON recruiters
FOR EACH ROW
BEGIN
    IF (SELECT role FROM users WHERE user_id = NEW.recruiter_id) <> 'Recruiter' THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Only users with role Recruiter can have a recruiter profile.';
    END IF;
END //

CREATE TRIGGER trg_users_role_immutable
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
    IF NEW.role <> OLD.role
       AND (EXISTS (SELECT 1 FROM candidates WHERE candidate_id = OLD.user_id)
            OR EXISTS (SELECT 1 FROM recruiters WHERE recruiter_id = OLD.user_id)) THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Cannot change the role of a user who already has a candidate/recruiter profile.';
    END IF;
END //

-- ---- Jobs: lifecycle rules ---------------------------------------------------
--   OPEN <-> CLOSED (a recruiter may pause and reopen a posting)
--   OPEN / CLOSED -> ARCHIVED, and ARCHIVED is terminal
--   a job can never be moved to another recruiter
CREATE TRIGGER trg_job_status_rules
BEFORE UPDATE ON jobs
FOR EACH ROW
BEGIN
    IF NEW.recruiter_id <> OLD.recruiter_id THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'A job posting cannot be transferred to another recruiter.';
    END IF;
    IF OLD.status = 'ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Archived job postings cannot be reopened.';
    END IF;
END //

-- ---- Applications: business rules ------------------------------------------

-- Trigger 1 (original): Prevent applying to CLOSED or ARCHIVED jobs
CREATE TRIGGER trg_prevent_apply_closed_job
BEFORE INSERT ON applications
FOR EACH ROW
BEGIN
    DECLARE v_job_status VARCHAR(20);

    SELECT status INTO v_job_status
    FROM jobs
    WHERE job_id = NEW.job_id;

    IF v_job_status IS NULL THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Error: Job posting does not exist.';
    ELSEIF v_job_status <> 'OPEN' THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Error: Cannot apply to a job that is CLOSED or ARCHIVED.';
    END IF;
END //

-- Trigger 2: Database-maintained defaults for a new application
-- (runs after trg_prevent_apply_closed_job). Every application starts in
-- APPLIED; match score and resume snapshot are computed by the DB, not
-- trusted from the client.
CREATE TRIGGER trg_application_insert_defaults
BEFORE INSERT ON applications
FOR EACH ROW
FOLLOWS trg_prevent_apply_closed_job
BEGIN
    SET NEW.status = 'APPLIED';
    SET NEW.status_changed_by = NULL;
    SET NEW.status_remarks = NULL;
    SET NEW.match_score = fn_match_score(NEW.candidate_id, NEW.job_id);
    IF NEW.resume_snapshot_url IS NULL THEN
        SET NEW.resume_snapshot_url = (SELECT resume_url FROM candidates
                                        WHERE candidate_id = NEW.candidate_id);
    END IF;
END //

-- Trigger 3: Audit row for every new application
CREATE TRIGGER trg_log_application_insert
AFTER INSERT ON applications
FOR EACH ROW
BEGIN
    INSERT INTO application_audit_logs (application_id, old_status, new_status, changed_by, remarks)
    VALUES (NEW.application_id, NULL, NEW.status, NEW.candidate_id, 'Application submitted');
END //

-- Trigger 4: Application state machine + immutable keys
--   APPLIED -> UNDER_REVIEW | REJECTED
--   UNDER_REVIEW -> INTERVIEW_SCHEDULED | REJECTED
--   INTERVIEW_SCHEDULED -> OFFERED | REJECTED
--   OFFERED, REJECTED are terminal
CREATE TRIGGER trg_validate_status_transition
BEFORE UPDATE ON applications
FOR EACH ROW
BEGIN
    DECLARE v_msg VARCHAR(255);

    IF NEW.job_id <> OLD.job_id OR NEW.candidate_id <> OLD.candidate_id THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'The job or candidate of an existing application cannot be changed.';
    END IF;

    IF NEW.status <> OLD.status THEN
        IF NOT (
               (OLD.status = 'APPLIED'             AND NEW.status IN ('UNDER_REVIEW', 'REJECTED'))
            OR (OLD.status = 'UNDER_REVIEW'        AND NEW.status IN ('INTERVIEW_SCHEDULED', 'REJECTED'))
            OR (OLD.status = 'INTERVIEW_SCHEDULED' AND NEW.status IN ('OFFERED', 'REJECTED'))
        ) THEN
            SET v_msg = CONCAT('Invalid status transition: ', OLD.status, ' -> ', NEW.status, '.');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        -- Stale-metadata guard: if a status change did not supply new
        -- remarks/changed_by (e.g. an ad-hoc UPDATE), don't let the previous
        -- change's metadata be copied into the new audit row.
        IF NEW.status_remarks <=> OLD.status_remarks
           AND NEW.status_changed_by <=> OLD.status_changed_by THEN
            SET NEW.status_remarks = NULL;
            SET NEW.status_changed_by = NULL;
        END IF;
    END IF;
END //

-- Trigger 5 (original, extended): Automated audit trail on status change.
-- Reads who/why from the row itself - no session variables.
CREATE TRIGGER trg_audit_application_status_update
AFTER UPDATE ON applications
FOR EACH ROW
BEGIN
    IF OLD.status <> NEW.status THEN
        INSERT INTO application_audit_logs (application_id, old_status, new_status, changed_by, remarks)
        VALUES (
            NEW.application_id,
            OLD.status,
            NEW.status,
            NEW.status_changed_by,
            COALESCE(NEW.status_remarks, CONCAT('Status updated from ', OLD.status, ' to ', NEW.status))
        );
    END IF;
END //

-- ---- Outbox triggers (MySQL -> Neo4j sync) ----------------------------------
-- NOTE: MySQL does not fire triggers for rows removed by FK cascades.
-- Cascaded child deletes are covered by the parent's DELETE event, which the
-- worker applies with DETACH DELETE (removing the child relationships too).

-- Skills
CREATE TRIGGER trg_outbox_skill_ins AFTER INSERT ON skills FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('SKILL', NEW.skill_id, 'UPSERT',
            JSON_OBJECT('id', NEW.skill_id, 'name', NEW.skill_name, 'category', NEW.category));
END //

CREATE TRIGGER trg_outbox_skill_upd AFTER UPDATE ON skills FOR EACH ROW
BEGIN
    IF NOT (NEW.skill_name <=> OLD.skill_name AND NEW.category <=> OLD.category) THEN
        INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
        VALUES ('SKILL', NEW.skill_id, 'UPSERT',
                JSON_OBJECT('id', NEW.skill_id, 'name', NEW.skill_name, 'category', NEW.category));
    END IF;
END //

CREATE TRIGGER trg_outbox_skill_del AFTER DELETE ON skills FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('SKILL', OLD.skill_id, 'DELETE', NULL);
END //

-- Candidates (name lives in users)
CREATE TRIGGER trg_outbox_candidate_ins AFTER INSERT ON candidates FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('CANDIDATE', NEW.candidate_id, 'UPSERT',
            JSON_OBJECT('id', NEW.candidate_id,
                        'name', (SELECT name FROM users WHERE user_id = NEW.candidate_id),
                        'location', NEW.location,
                        'experience_years', NEW.experience_years));
END //

CREATE TRIGGER trg_outbox_candidate_upd AFTER UPDATE ON candidates FOR EACH ROW
BEGIN
    IF NOT (NEW.location <=> OLD.location AND NEW.experience_years <=> OLD.experience_years) THEN
        INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
        VALUES ('CANDIDATE', NEW.candidate_id, 'UPSERT',
                JSON_OBJECT('id', NEW.candidate_id,
                            'name', (SELECT name FROM users WHERE user_id = NEW.candidate_id),
                            'location', NEW.location,
                            'experience_years', NEW.experience_years));
    END IF;
END //

CREATE TRIGGER trg_outbox_candidate_del AFTER DELETE ON candidates FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('CANDIDATE', OLD.candidate_id, 'DELETE', NULL);
END //

-- Users: candidate renamed / candidate account deleted (cascade won't fire the candidates trigger)
CREATE TRIGGER trg_outbox_user_upd AFTER UPDATE ON users FOR EACH ROW
BEGIN
    IF NEW.name <> OLD.name AND NEW.role = 'Candidate' THEN
        INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
        SELECT 'CANDIDATE', cd.candidate_id, 'UPSERT',
               JSON_OBJECT('id', cd.candidate_id, 'name', NEW.name,
                           'location', cd.location, 'experience_years', cd.experience_years)
          FROM candidates cd
         WHERE cd.candidate_id = NEW.user_id;
    END IF;
END //

CREATE TRIGGER trg_outbox_user_del AFTER DELETE ON users FOR EACH ROW
BEGIN
    IF OLD.role = 'Candidate' THEN
        INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
        VALUES ('CANDIDATE', OLD.user_id, 'DELETE', NULL);
    END IF;
END //

-- Candidate skills
CREATE TRIGGER trg_outbox_cskill_ins AFTER INSERT ON candidate_skills FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('CANDIDATE_SKILL', CONCAT(NEW.candidate_id, ':', NEW.skill_id), 'UPSERT',
            JSON_OBJECT('candidate_id', NEW.candidate_id, 'skill_id', NEW.skill_id,
                        'proficiency', NEW.proficiency_level, 'years', NEW.years_experience));
END //

CREATE TRIGGER trg_outbox_cskill_upd AFTER UPDATE ON candidate_skills FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('CANDIDATE_SKILL', CONCAT(NEW.candidate_id, ':', NEW.skill_id), 'UPSERT',
            JSON_OBJECT('candidate_id', NEW.candidate_id, 'skill_id', NEW.skill_id,
                        'proficiency', NEW.proficiency_level, 'years', NEW.years_experience));
END //

CREATE TRIGGER trg_outbox_cskill_del AFTER DELETE ON candidate_skills FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('CANDIDATE_SKILL', CONCAT(OLD.candidate_id, ':', OLD.skill_id), 'DELETE', NULL);
END //

-- Jobs (company derived through recruiter)
CREATE TRIGGER trg_outbox_job_ins AFTER INSERT ON jobs FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('JOB', NEW.job_id, 'UPSERT',
            JSON_OBJECT('id', NEW.job_id, 'title', NEW.job_title, 'location', NEW.location,
                        'status', NEW.status,
                        'company_id', (SELECT company_id FROM recruiters WHERE recruiter_id = NEW.recruiter_id)));
END //

CREATE TRIGGER trg_outbox_job_upd AFTER UPDATE ON jobs FOR EACH ROW
BEGIN
    IF NOT (NEW.job_title <=> OLD.job_title AND NEW.location <=> OLD.location
            AND NEW.status <=> OLD.status AND NEW.recruiter_id <=> OLD.recruiter_id) THEN
        INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
        VALUES ('JOB', NEW.job_id, 'UPSERT',
                JSON_OBJECT('id', NEW.job_id, 'title', NEW.job_title, 'location', NEW.location,
                            'status', NEW.status,
                            'company_id', (SELECT company_id FROM recruiters WHERE recruiter_id = NEW.recruiter_id)));
    END IF;
END //

CREATE TRIGGER trg_outbox_job_del AFTER DELETE ON jobs FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('JOB', OLD.job_id, 'DELETE', NULL);
END //

-- Recruiter moved to another company: their jobs' OFFERED_BY edge changes
CREATE TRIGGER trg_outbox_recruiter_upd AFTER UPDATE ON recruiters FOR EACH ROW
BEGIN
    IF NEW.company_id <> OLD.company_id THEN
        INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
        SELECT 'JOB', j.job_id, 'UPSERT',
               JSON_OBJECT('id', j.job_id, 'title', j.job_title, 'location', j.location,
                           'status', j.status, 'company_id', NEW.company_id)
          FROM jobs j
         WHERE j.recruiter_id = NEW.recruiter_id;
    END IF;
END //

-- Job skills
CREATE TRIGGER trg_outbox_jskill_ins AFTER INSERT ON job_skills FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('JOB_SKILL', CONCAT(NEW.job_id, ':', NEW.skill_id), 'UPSERT',
            JSON_OBJECT('job_id', NEW.job_id, 'skill_id', NEW.skill_id,
                        'required_level', NEW.required_level, 'is_mandatory', NEW.is_mandatory = 1));
END //

CREATE TRIGGER trg_outbox_jskill_upd AFTER UPDATE ON job_skills FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('JOB_SKILL', CONCAT(NEW.job_id, ':', NEW.skill_id), 'UPSERT',
            JSON_OBJECT('job_id', NEW.job_id, 'skill_id', NEW.skill_id,
                        'required_level', NEW.required_level, 'is_mandatory', NEW.is_mandatory = 1));
END //

CREATE TRIGGER trg_outbox_jskill_del AFTER DELETE ON job_skills FOR EACH ROW
BEGIN
    INSERT INTO graph_sync_outbox (entity_type, entity_id, op, payload)
    VALUES ('JOB_SKILL', CONCAT(OLD.job_id, ':', OLD.skill_id), 'DELETE', NULL);
END //

DELIMITER ;

-- =============================================================================
-- STORED PROCEDURES & TRANSACTIONS (Advanced Concepts: Procedures, Transactions)
--
-- Calling convention for the app (see docs/CONTRACTS.md): CALL and the
-- SELECT of the OUT variables must run on the SAME acquired connection, and
-- the OUT variables are reset to NULL before the CALL.
-- =============================================================================

-- Stored Procedure 1: Safe application submission (ACID transaction)
--   status codes: SUCCESS | FAILED | DUPLICATE | NOT_FOUND | ERROR
DELIMITER //
CREATE PROCEDURE sp_submit_application(
    IN p_candidate_id INT,
    IN p_job_id INT,
    OUT p_application_id INT,
    OUT p_status_code VARCHAR(20),
    OUT p_message VARCHAR(255)
)
proc_label: BEGIN
    DECLARE v_candidate_count INT DEFAULT 0;
    DECLARE v_resume_url VARCHAR(500);
    DECLARE v_job_count INT DEFAULT 0;
    DECLARE v_job_status VARCHAR(20);
    DECLARE v_existing_app INT DEFAULT 0;
    DECLARE v_error_text VARCHAR(255);

    -- Race-condition duplicate (UNIQUE(job_id, candidate_id) violation)
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        ROLLBACK;
        SET p_application_id = NULL;
        SET p_status_code = 'DUPLICATE';
        SET p_message = 'Candidate has already applied for this position.';
    END;

    -- Any other SQL error: undo everything and report the DB message
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 v_error_text = MESSAGE_TEXT;
        ROLLBACK;
        SET p_application_id = NULL;
        SET p_status_code = 'ERROR';
        SET p_message = v_error_text;
    END;

    SET p_application_id = NULL;
    SET p_status_code = NULL;
    SET p_message = NULL;

    START TRANSACTION;

    -- 1. Candidate must exist and have a resume
    --    (aggregate always returns one row, so a missing candidate is
    --     detected explicitly instead of silently leaving variables NULL)
    SELECT COUNT(*), MAX(resume_url) INTO v_candidate_count, v_resume_url
      FROM candidates
     WHERE candidate_id = p_candidate_id;

    IF v_candidate_count = 0 THEN
        ROLLBACK;
        SET p_status_code = 'NOT_FOUND';
        SET p_message = 'Candidate does not exist.';
        LEAVE proc_label;
    END IF;

    IF v_resume_url IS NULL OR v_resume_url = '' THEN
        ROLLBACK;
        SET p_status_code = 'FAILED';
        SET p_message = 'Candidate profile must have a valid resume before applying.';
        LEAVE proc_label;
    END IF;

    -- 2. Job must exist and be OPEN. FOR UPDATE locks the job row so a
    --    recruiter cannot close the job between this check and the INSERT.
    SELECT COUNT(*) INTO v_job_count FROM jobs WHERE job_id = p_job_id;

    IF v_job_count = 0 THEN
        ROLLBACK;
        SET p_status_code = 'NOT_FOUND';
        SET p_message = 'Job posting does not exist.';
        LEAVE proc_label;
    END IF;

    SELECT status INTO v_job_status FROM jobs WHERE job_id = p_job_id FOR UPDATE;

    IF v_job_status <> 'OPEN' THEN
        ROLLBACK;
        SET p_status_code = 'FAILED';
        SET p_message = 'Cannot apply: Job posting is currently not active.';
        LEAVE proc_label;
    END IF;

    -- 3. Friendly duplicate check (UNIQUE constraint is the real guarantee)
    SELECT COUNT(*) INTO v_existing_app
      FROM applications
     WHERE candidate_id = p_candidate_id AND job_id = p_job_id;

    IF v_existing_app > 0 THEN
        ROLLBACK;
        SET p_status_code = 'DUPLICATE';
        SET p_message = 'Candidate has already applied for this position.';
        LEAVE proc_label;
    END IF;

    -- 4. Insert. Triggers compute match_score + resume snapshot and write
    --    the initial audit row inside this same transaction.
    INSERT INTO applications (job_id, candidate_id) VALUES (p_job_id, p_candidate_id);
    SET p_application_id = LAST_INSERT_ID();

    COMMIT;

    SET p_status_code = 'SUCCESS';
    SET p_message = 'Application submitted successfully.';
END //
DELIMITER ;

-- Stored Procedure 2: Application status change with authorization + audit
--   * validates the new status value
--   * the acting user must be an Admin, or the Recruiter who owns the job
--   * remarks/changed_by are written in the same UPDATE and picked up by
--     trg_audit_application_status_update
--   * invalid transitions are rejected by trg_validate_status_transition
--   * p_rows_affected = 0 when the application does not exist
DELIMITER //
CREATE PROCEDURE sp_update_application_status(
    IN p_application_id INT,
    IN p_new_status VARCHAR(30),
    IN p_remarks VARCHAR(255),
    IN p_changed_by INT,
    OUT p_rows_affected INT
)
proc_label: BEGIN
    DECLARE v_app_count INT DEFAULT 0;
    DECLARE v_job_owner INT;
    DECLARE v_actor_role VARCHAR(20);
    DECLARE v_msg VARCHAR(255);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SET p_rows_affected = 0;

    IF p_new_status IS NULL OR p_new_status NOT IN
       ('APPLIED', 'UNDER_REVIEW', 'INTERVIEW_SCHEDULED', 'OFFERED', 'REJECTED') THEN
        SET v_msg = CONCAT('Invalid application status: ', COALESCE(p_new_status, 'NULL'), '.');
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;

    SELECT COUNT(*), MAX(j.recruiter_id) INTO v_app_count, v_job_owner
      FROM applications a
      JOIN jobs j ON j.job_id = a.job_id
     WHERE a.application_id = p_application_id;

    IF v_app_count = 0 THEN
        LEAVE proc_label;
    END IF;

    SELECT MAX(role) INTO v_actor_role FROM users WHERE user_id = p_changed_by;

    IF v_actor_role IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unknown acting user.';
    ELSEIF v_actor_role = 'Candidate' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Candidates cannot change application status.';
    ELSEIF v_actor_role = 'Recruiter' AND v_job_owner <> p_changed_by THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recruiter does not own this job posting.';
    END IF;

    START TRANSACTION;

    UPDATE applications
       SET status = p_new_status,
           status_changed_by = p_changed_by,
           status_remarks = p_remarks
     WHERE application_id = p_application_id;

    SET p_rows_affected = ROW_COUNT();

    COMMIT;
END //
DELIMITER ;

-- Stored Procedure 3: Recruiter analytics (two result sets)
--   Result 1: per-job hiring funnel (GROUP BY, conditional aggregates)
--   Result 2: hard-to-fill mandatory skills on the recruiter's OPEN jobs
--             (GROUP BY ... HAVING qualified_candidates < 3)
DELIMITER //
CREATE PROCEDURE sp_get_recruiter_analytics(IN p_recruiter_id INT)
BEGIN
    SELECT
        j.job_id,
        j.job_title,
        j.status AS job_status,
        DATEDIFF(NOW(), j.posted_date) AS days_open,
        COUNT(a.application_id) AS total_applicants,
        COALESCE(ROUND(AVG(a.match_score), 2), 0.00) AS avg_match_score,
        SUM(a.status = 'APPLIED') AS applied,
        SUM(a.status = 'UNDER_REVIEW') AS under_review,
        SUM(a.status = 'INTERVIEW_SCHEDULED') AS interviewing,
        SUM(a.status = 'OFFERED') AS offered,
        SUM(a.status = 'REJECTED') AS rejected,
        ROUND(100 * SUM(a.status = 'OFFERED') / NULLIF(COUNT(a.application_id), 0), 2) AS offer_rate_pct
    FROM jobs j
    LEFT JOIN applications a ON a.job_id = j.job_id
    WHERE j.recruiter_id = p_recruiter_id
    GROUP BY j.job_id, j.job_title, j.status, j.posted_date
    ORDER BY j.posted_date DESC;

    SELECT
        j.job_id,
        j.job_title,
        s.skill_name,
        js.required_level,
        COUNT(cs.candidate_id) AS qualified_candidates
    FROM jobs j
    JOIN job_skills js ON js.job_id = j.job_id AND js.is_mandatory = TRUE
    JOIN skills s ON s.skill_id = js.skill_id
    LEFT JOIN candidate_skills cs
           ON cs.skill_id = js.skill_id
          AND FIELD(cs.proficiency_level, 'Beginner', 'Intermediate', 'Advanced', 'Expert')
           >= FIELD(js.required_level, 'Beginner', 'Intermediate', 'Advanced', 'Expert')
    WHERE j.recruiter_id = p_recruiter_id
      AND j.status = 'OPEN'
    GROUP BY j.job_id, j.job_title, s.skill_id, s.skill_name, js.required_level
    HAVING qualified_candidates < 3
    ORDER BY qualified_candidates ASC, j.job_id;
END //
DELIMITER ;
