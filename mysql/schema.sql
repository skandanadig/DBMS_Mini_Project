-- =============================================================================
-- SKILLMATCH: Intelligent Job and Skill Matching Platform
-- Database: MySQL 8.0+
-- File: schema.sql
-- Description: Complete relational schema with DDL, Constraints, Indexes,
--              Views, Stored Procedures, Triggers, and Transactions.
-- Designed for PES University DBMS Experiential Learning - Level 3 Project
-- =============================================================================

CREATE DATABASE IF NOT EXISTS skillmatch_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE skillmatch_db;

-- -----------------------------------------------------------------------------
-- 0. CLEANUP (Drop in reverse dependency order for idempotent execution)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_application_status_update;
DROP TRIGGER IF EXISTS trg_prevent_apply_closed_job;
DROP PROCEDURE IF EXISTS sp_submit_application;
DROP PROCEDURE IF EXISTS sp_update_application_status;
DROP PROCEDURE IF EXISTS sp_get_recruiter_analytics;
DROP VIEW IF EXISTS vw_recruiter_pipeline;
DROP VIEW IF EXISTS vw_candidate_applications;
DROP VIEW IF EXISTS vw_top_demanded_skills;
DROP TABLE IF EXISTS application_audit_logs;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS job_skills;
DROP TABLE IF EXISTS candidate_skills;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS recruiters;
DROP TABLE IF EXISTS candidates;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS users;

-- -----------------------------------------------------------------------------
-- 1. ENTITY: USERS (Base account table for all platform roles)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('Candidate', 'Recruiter', 'Admin') NOT NULL DEFAULT 'Candidate',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_email_format CHECK (email LIKE '%_@__%.__%')
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 2. ENTITY: CANDIDATES (Subtype of USERS - Disjoint specialization)
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
    CONSTRAINT chk_experience_non_negative CHECK (experience_years >= 0.0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 3. ENTITY: COMPANIES (Organizations posting jobs)
-- -----------------------------------------------------------------------------
CREATE TABLE companies (
    company_id INT AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(150) NOT NULL UNIQUE,
    industry VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    website VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 4. ENTITY: RECRUITERS (Subtype of USERS - Disjoint specialization)
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
-- 5. ENTITY: SKILLS (Taxonomy of technical and soft skills)
-- -----------------------------------------------------------------------------
CREATE TABLE skills (
    skill_id INT AUTO_INCREMENT PRIMARY KEY,
    skill_name VARCHAR(80) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL -- e.g. Frontend, Backend, Database, Cloud, AI/ML
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 6. ASSOCIATIVE ENTITY: CANDIDATE_SKILL (M:N between Candidate & Skill)
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
    CONSTRAINT chk_cskills_years CHECK (years_experience >= 0.0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 7. ENTITY: JOBS (Job postings by recruiters on behalf of companies)
-- -----------------------------------------------------------------------------
CREATE TABLE jobs (
    job_id INT AUTO_INCREMENT PRIMARY KEY,
    recruiter_id INT NOT NULL,
    company_id INT NOT NULL,
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
    CONSTRAINT fk_jobs_company FOREIGN KEY (company_id)
        REFERENCES companies(company_id) ON DELETE RESTRICT,
    CONSTRAINT chk_salary_range CHECK (salary_max >= salary_min AND salary_min >= 0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 8. ASSOCIATIVE ENTITY: JOB_SKILL (M:N between Job & Skill)
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
-- -----------------------------------------------------------------------------
CREATE TABLE applications (
    application_id INT AUTO_INCREMENT PRIMARY KEY,
    job_id INT NOT NULL,
    candidate_id INT NOT NULL,
    applied_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('APPLIED', 'UNDER_REVIEW', 'INTERVIEW_SCHEDULED', 'OFFERED', 'REJECTED') NOT NULL DEFAULT 'APPLIED',
    match_score DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    resume_snapshot_url VARCHAR(500),
    CONSTRAINT uk_job_candidate UNIQUE (job_id, candidate_id),
    CONSTRAINT fk_apps_job FOREIGN KEY (job_id)
        REFERENCES jobs(job_id) ON DELETE CASCADE,
    CONSTRAINT fk_apps_candidate FOREIGN KEY (candidate_id)
        REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    CONSTRAINT chk_match_score CHECK (match_score BETWEEN 0.00 AND 100.00)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 10. AUDIT TABLE: APPLICATION_AUDIT_LOGS (Tracks status transition history)
-- -----------------------------------------------------------------------------
CREATE TABLE application_audit_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks VARCHAR(255),
    CONSTRAINT fk_audit_application FOREIGN KEY (application_id)
        REFERENCES applications(application_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============================================================================
-- INDEXES FOR PERFORMANCE OPTIMIZATION (Advanced Concept 1)
-- =============================================================================
CREATE INDEX idx_jobs_status_posted ON jobs(status, posted_date DESC);
CREATE INDEX idx_jobs_company ON jobs(company_id);
CREATE INDEX idx_apps_job_status ON applications(job_id, status);
CREATE INDEX idx_apps_cand_status ON applications(candidate_id, status);
CREATE INDEX idx_cand_skills_level ON candidate_skills(skill_id, proficiency_level);

-- =============================================================================
-- DATABASE VIEWS (Advanced Concept 2)
-- =============================================================================

-- View 1: Recruiter Hiring Pipeline with Aggregations (GROUP BY, HAVING, JOIN)
CREATE VIEW vw_recruiter_pipeline AS
SELECT 
    j.job_id,
    j.job_title,
    c.company_name,
    j.status AS job_status,
    j.posted_date,
    COUNT(a.application_id) AS total_applicants,
    COALESCE(AVG(a.match_score), 0.00) AS avg_match_score,
    SUM(CASE WHEN a.status = 'INTERVIEW_SCHEDULED' THEN 1 ELSE 0 END) AS interview_count,
    SUM(CASE WHEN a.status = 'OFFERED' THEN 1 ELSE 0 END) AS offer_count
FROM jobs j
JOIN companies c ON j.company_id = c.company_id
LEFT JOIN applications a ON j.job_id = a.job_id
GROUP BY j.job_id, j.job_title, c.company_name, j.status, j.posted_date;

-- View 2: Candidate Applications Dashboard (Detailed tracking for Candidate UI)
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
    a.applied_date,
    a.status AS application_status,
    a.match_score
FROM applications a
JOIN jobs j ON a.job_id = j.job_id
JOIN companies c ON j.company_id = c.company_id
JOIN candidates cd ON a.candidate_id = cd.candidate_id
JOIN users u ON cd.candidate_id = u.user_id;

-- View 3: Top Demanded Skills in Active Job Postings
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
GROUP BY s.skill_id, s.skill_name, s.category
HAVING demanding_jobs_count > 0
ORDER BY demanding_jobs_count DESC;

-- =============================================================================
-- TRIGGERS (Advanced Concept 3)
-- =============================================================================

-- Trigger 1: Prevent candidates from applying to CLOSED or ARCHIVED jobs
DELIMITER //
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
DELIMITER ;

-- Trigger 2: Automated Audit Trail when Application Status changes
DELIMITER //
CREATE TRIGGER trg_audit_application_status_update
AFTER UPDATE ON applications
FOR EACH ROW
BEGIN
    IF OLD.status <> NEW.status THEN
        INSERT INTO application_audit_logs (application_id, old_status, new_status, remarks)
        VALUES (
            NEW.application_id, 
            OLD.status, 
            NEW.status, 
            CONCAT('Status updated from ', OLD.status, ' to ', NEW.status)
        );
    END IF;
END //
DELIMITER ;

-- =============================================================================
-- STORED PROCEDURES & TRANSACTIONS (Advanced Concept 4)
-- =============================================================================

-- Stored Procedure 1: Safe Application Submission with ACID Transaction
DELIMITER //
CREATE PROCEDURE sp_submit_application(
    IN p_candidate_id INT,
    IN p_job_id INT,
    IN p_match_score DECIMAL(5,2),
    OUT p_application_id INT,
    OUT p_status_code VARCHAR(20),
    OUT p_message VARCHAR(255)
)
proc_label: BEGIN
    DECLARE v_resume_url VARCHAR(500);
    DECLARE v_job_status VARCHAR(20);
    DECLARE v_existing_app INT DEFAULT 0;

    -- Error handler for unexpected SQL exceptions
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_status_code = 'ERROR';
        SET p_message = 'Database transaction failed during application submission.';
    END;

    START TRANSACTION;

    -- 1. Check if candidate exists and has a resume
    SELECT resume_url INTO v_resume_url
    FROM candidates
    WHERE candidate_id = p_candidate_id;

    IF v_resume_url IS NULL OR v_resume_url = '' THEN
        ROLLBACK;
        SET p_status_code = 'FAILED';
        SET p_message = 'Candidate profile must have a valid resume before applying.';
        LEAVE proc_label;
    END IF;

    -- 2. Verify job is OPEN
    SELECT status INTO v_job_status
    FROM jobs
    WHERE job_id = p_job_id;

    IF v_job_status <> 'OPEN' THEN
        ROLLBACK;
        SET p_status_code = 'FAILED';
        SET p_message = 'Cannot apply: Job posting is currently not active.';
        LEAVE proc_label;
    END IF;

    -- 3. Check for duplicate application
    SELECT COUNT(*) INTO v_existing_app
    FROM applications
    WHERE candidate_id = p_candidate_id AND job_id = p_job_id;

    IF v_existing_app > 0 THEN
        ROLLBACK;
        SET p_status_code = 'DUPLICATE';
        SET p_message = 'Candidate has already applied for this position.';
        LEAVE proc_label;
    END IF;

    -- 4. Insert application record
    INSERT INTO applications (job_id, candidate_id, match_score, resume_snapshot_url)
    VALUES (p_job_id, p_candidate_id, p_match_score, v_resume_url);

    SET p_application_id = LAST_INSERT_ID();

    -- 5. Record initial audit entry
    INSERT INTO application_audit_logs (application_id, old_status, new_status, remarks)
    VALUES (p_application_id, NULL, 'APPLIED', 'Application created via stored procedure');

    COMMIT;

    SET p_status_code = 'SUCCESS';
    SET p_message = 'Application submitted successfully.';
END //
DELIMITER ;

-- Stored Procedure 2: Recruiter Application Review & Decision
DELIMITER //
CREATE PROCEDURE sp_update_application_status(
    IN p_application_id INT,
    IN p_new_status VARCHAR(50),
    IN p_remarks VARCHAR(255),
    OUT p_rows_affected INT
)
BEGIN
    UPDATE applications
    SET status = p_new_status
    WHERE application_id = p_application_id;

    SET p_rows_affected = ROW_COUNT();

    -- Note: The trigger trg_audit_application_status_update will automatically
    -- record the old and new status in application_audit_logs!
END //
DELIMITER ;
