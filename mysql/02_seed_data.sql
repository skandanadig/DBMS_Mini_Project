-- =============================================================================
-- SKILLMATCH: Intelligent Job and Skill Matching Platform
-- Database: MySQL 8.0+
-- File: seed_data.sql
-- Description: Realistic seed data for demo, testing DDL, DML, and analytics.
-- =============================================================================

USE skillmatch_db;

-- -----------------------------------------------------------------------------
-- 1. SEED USERS (Password hashes for demo; plain text for reference: 'Password@123')
-- -----------------------------------------------------------------------------
INSERT INTO users (user_id, name, email, password_hash, role) VALUES
-- Admins
(1, 'System Administrator', 'admin@skillmatch.io', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Admin'),

-- Recruiters
(2, 'Sarah Jenkins', 'sarah.j@techcorp.com', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Recruiter'),
(3, 'Arun Kumar', 'arun.k@cloudscale.io', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Recruiter'),
(4, 'Priya Nair', 'priya.n@fintechglobal.com', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Recruiter'),

-- Candidates
(5, 'Rahul Sharma', 'rahul.sharma@gmail.com', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Candidate'),
(6, 'Ananya Sen', 'ananya.sen@outlook.com', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Candidate'),
(7, 'David Chen', 'david.chen@yahoo.com', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Candidate'),
(8, 'Neha Patel', 'neha.patel@gmail.com', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Candidate'),
(9, 'Vikram Malhotra', 'vikram.m@gmail.com', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Candidate'),
(10, 'Fatima Al-Mansoor', 'fatima.m@gmail.com', '$2a$10$wT8K4Z4uF8Hn3F...hashed', 'Candidate');

-- -----------------------------------------------------------------------------
-- 2. SEED COMPANIES
-- -----------------------------------------------------------------------------
INSERT INTO companies (company_id, company_name, industry, location, website) VALUES
(1, 'TechCorp Solutions', 'Enterprise Software', 'Bengaluru, India', 'https://techcorp.example.com'),
(2, 'CloudScale Networks', 'Cloud & DevOps', 'Hyderabad, India', 'https://cloudscale.example.com'),
(3, 'FinTech Global', 'Financial Technology', 'Mumbai, India', 'https://fintechglobal.example.com');

-- -----------------------------------------------------------------------------
-- 3. SEED RECRUITERS
-- -----------------------------------------------------------------------------
INSERT INTO recruiters (recruiter_id, company_id, designation) VALUES
(2, 1, 'Senior Talent Partner'),
(3, 2, 'Lead Technical Recruiter'),
(4, 3, 'Head of Engineering Talent');

-- -----------------------------------------------------------------------------
-- 4. SEED CANDIDATES
-- -----------------------------------------------------------------------------
INSERT INTO candidates (candidate_id, phone, location, experience_years, resume_url, headline, bio) VALUES
(5, '+91-9876543210', 'Bengaluru, India', 4.5, 'https://cdn.skillmatch.io/resumes/rahul_sharma.pdf', 'Full Stack Developer | React, Node.js & MySQL', 'Passionate full-stack developer with 4+ years building high-throughput SaaS applications.'),
(6, '+91-9876543211', 'Bengaluru, India', 2.0, 'https://cdn.skillmatch.io/resumes/ananya_sen.pdf', 'Junior Backend Engineer | Python & Django', 'CSE graduate interested in distributed systems, REST APIs and graph databases.'),
(7, '+91-9876543212', 'Hyderabad, India', 6.0, 'https://cdn.skillmatch.io/resumes/david_chen.pdf', 'Senior DevOps & Cloud Architect | AWS, Docker, K8s', 'Expert in infrastructure as code, CI/CD pipelines, container orchestration, and multi-cloud systems.'),
(8, '+91-9876543213', 'Pune, India', 3.0, 'https://cdn.skillmatch.io/resumes/neha_patel.pdf', 'Data Engineer & Database Specialist | SQL & Neo4j', 'Focuses on relational schema modeling, ETL pipelines, and graph query optimization.'),
(9, '+91-9876543214', 'Delhi, India', 5.0, 'https://cdn.skillmatch.io/resumes/vikram_m.pdf', 'Frontend Specialist | Next.js, TypeScript, Tailwind', 'UI/UX enthusiast obsessed with web performance, responsive design, and state management.'),
(10, '+91-9876543215', 'Remote', 1.5, 'https://cdn.skillmatch.io/resumes/fatima_m.pdf', 'Associate AI & Data Analyst | Python, PyTorch', 'Fresh talent exploring machine learning algorithms, embeddings, and vector similarity search.');

-- -----------------------------------------------------------------------------
-- 5. SEED SKILLS (Ontology mapped to Neo4j)
-- -----------------------------------------------------------------------------
INSERT INTO skills (skill_id, skill_name, category) VALUES
(1, 'JavaScript', 'Languages'),
(2, 'TypeScript', 'Languages'),
(3, 'Python', 'Languages'),
(4, 'React', 'Frontend'),
(5, 'Next.js', 'Frontend'),
(6, 'Node.js', 'Backend'),
(7, 'Express.js', 'Backend'),
(8, 'FastAPI', 'Backend'),
(9, 'MySQL', 'Database'),
(10, 'PostgreSQL', 'Database'),
(11, 'Neo4j', 'Database'),
(12, 'Docker', 'DevOps'),
(13, 'Kubernetes', 'DevOps'),
(14, 'AWS', 'Cloud'),
(15, 'GraphQL', 'API/Backend'),
(16, 'Tailwind CSS', 'Frontend');

-- -----------------------------------------------------------------------------
-- 6. SEED CANDIDATE_SKILLS
-- -----------------------------------------------------------------------------
INSERT INTO candidate_skills (candidate_id, skill_id, proficiency_level, years_experience) VALUES
-- Rahul Sharma (Full Stack)
(5, 1, 'Expert', 4.5),
(5, 2, 'Advanced', 3.0),
(5, 4, 'Expert', 4.0),
(5, 5, 'Advanced', 2.5),
(5, 6, 'Advanced', 3.5),
(5, 9, 'Intermediate', 3.0),
(5, 16, 'Expert', 3.0),

-- Ananya Sen (Junior Backend)
(6, 3, 'Advanced', 2.0),
(6, 8, 'Intermediate', 1.5),
(6, 9, 'Intermediate', 2.0),
(6, 10, 'Beginner', 1.0),

-- David Chen (Senior DevOps)
(7, 3, 'Intermediate', 3.0),
(7, 12, 'Expert', 6.0),
(7, 13, 'Expert', 5.0),
(7, 14, 'Expert', 6.0),

-- Neha Patel (Data / Graph)
(8, 3, 'Advanced', 3.0),
(8, 9, 'Expert', 3.5),
(8, 10, 'Advanced', 3.0),
(8, 11, 'Advanced', 2.0),

-- Vikram Malhotra (Frontend UI)
(9, 1, 'Expert', 5.0),
(9, 2, 'Expert', 4.0),
(9, 4, 'Expert', 5.0),
(9, 5, 'Expert', 3.5),
(9, 16, 'Expert', 4.0);

-- -----------------------------------------------------------------------------
-- 7. SEED JOBS
-- -----------------------------------------------------------------------------
INSERT INTO jobs (job_id, recruiter_id, company_id, job_title, description, location, employment_type, salary_min, salary_max, status) VALUES
(1, 2, 1, 'Senior Full Stack Engineer', 'Join TechCorp to scale our B2B SaaS platform using Next.js, Node.js, and MySQL.', 'Bengaluru, India', 'Full-time', 1800000.00, 2600000.00, 'OPEN'),
(2, 2, 1, 'Frontend UI/UX Specialist', 'Looking for a Next.js and Tailwind wizard to build elegant design systems.', 'Bengaluru, India', 'Full-time', 1200000.00, 1800000.00, 'OPEN'),
(3, 3, 2, 'Principal Cloud & DevOps Architect', 'Drive Kubernetes containerization and AWS infrastructure at CloudScale.', 'Hyderabad, India', 'Full-time', 2400000.00, 3600000.00, 'OPEN'),
(4, 4, 3, 'Graph Data Engineer', 'Design high-speed Neo4j graph schemas and ETL flows for anti-fraud detection.', 'Mumbai, India', 'Full-time', 1600000.00, 2200000.00, 'OPEN'),
(5, 3, 2, 'Legacy PHP Maintenance Engineer', 'Maintain deprecated internal tooling.', 'Remote', 'Contract', 600000.00, 800000.00, 'CLOSED');

-- -----------------------------------------------------------------------------
-- 8. SEED JOB_SKILLS
-- -----------------------------------------------------------------------------
INSERT INTO job_skills (job_id, skill_id, required_level, is_mandatory) VALUES
-- Job 1: Senior Full Stack Engineer
(1, 2, 'Advanced', TRUE),    -- TypeScript (Mandatory)
(1, 4, 'Advanced', TRUE),    -- React (Mandatory)
(1, 5, 'Intermediate', TRUE),-- Next.js (Mandatory)
(1, 6, 'Intermediate', TRUE),-- Node.js (Mandatory)
(1, 9, 'Intermediate', FALSE),-- MySQL (Optional)
(1, 12, 'Beginner', FALSE),  -- Docker (Optional)

-- Job 2: Frontend UI/UX Specialist
(2, 1, 'Advanced', TRUE),    -- JavaScript (Mandatory)
(2, 4, 'Expert', TRUE),      -- React (Mandatory)
(2, 5, 'Advanced', TRUE),    -- Next.js (Mandatory)
(2, 16, 'Expert', TRUE),     -- Tailwind CSS (Mandatory)

-- Job 3: Principal Cloud & DevOps Architect
(3, 12, 'Expert', TRUE),     -- Docker (Mandatory)
(3, 13, 'Expert', TRUE),     -- Kubernetes (Mandatory)
(3, 14, 'Expert', TRUE),     -- AWS (Mandatory)
(3, 3, 'Intermediate', FALSE),-- Python (Optional)

-- Job 4: Graph Data Engineer
(4, 9, 'Advanced', TRUE),    -- MySQL (Mandatory)
(4, 11, 'Advanced', TRUE),   -- Neo4j (Mandatory)
(4, 3, 'Advanced', TRUE),    -- Python (Mandatory)
(4, 10, 'Intermediate', FALSE); -- PostgreSQL (Optional)

-- -----------------------------------------------------------------------------
-- 9. SEED APPLICATIONS
-- -----------------------------------------------------------------------------
INSERT INTO applications (application_id, job_id, candidate_id, status, match_score, resume_snapshot_url) VALUES
(1, 1, 5, 'INTERVIEW_SCHEDULED', 92.50, 'https://cdn.skillmatch.io/resumes/rahul_sharma.pdf'),
(2, 2, 9, 'OFFERED', 98.00, 'https://cdn.skillmatch.io/resumes/vikram_m.pdf'),
(3, 3, 7, 'UNDER_REVIEW', 95.00, 'https://cdn.skillmatch.io/resumes/david_chen.pdf'),
(4, 4, 8, 'APPLIED', 88.50, 'https://cdn.skillmatch.io/resumes/neha_patel.pdf'),
(5, 1, 9, 'APPLIED', 75.00, 'https://cdn.skillmatch.io/resumes/vikram_m.pdf');

-- -----------------------------------------------------------------------------
-- 10. SEED INITIAL AUDIT LOGS
-- -----------------------------------------------------------------------------
INSERT INTO application_audit_logs (application_id, old_status, new_status, remarks) VALUES
(1, 'APPLIED', 'UNDER_REVIEW', 'Candidate passed initial automated skill screening'),
(1, 'UNDER_REVIEW', 'INTERVIEW_SCHEDULED', 'Technical round 1 scheduled with recruiter Sarah'),
(2, 'APPLIED', 'UNDER_REVIEW', 'Portfolio verified'),
(2, 'UNDER_REVIEW', 'OFFERED', 'Outstanding performance in UI design coding challenge'),
(3, 'APPLIED', 'UNDER_REVIEW', 'Cloud certifications validated');
