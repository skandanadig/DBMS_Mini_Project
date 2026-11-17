-- =============================================================================
-- SKILLMATCH: Intelligent Job and Skill Matching Platform
-- Database: MySQL 8.0+
-- File: 02_seed_data.sql
-- Description: Realistic seed data for demo, testing DDL, DML, and analytics.
--
-- All demo accounts use the password:  Password@123
-- (stored as a real bcrypt hash, cost 10, so the web app can log in with them)
--
-- Applications are NOT inserted with hard-coded statuses/audit rows any more:
-- they are inserted as APPLIED and then advanced through
-- sp_update_application_status, so the state-machine trigger, the audit
-- trigger and the outbox triggers all run exactly as they will in the app.
-- =============================================================================

USE skillmatch_db;

SET @pwd = '$2a$10$lJVhJKVTbz0HhMhX8V5Tv.rtIHxBrlXa/U2cB8NZNmjEI53cTQFr6';

-- -----------------------------------------------------------------------------
-- 1. USERS
-- -----------------------------------------------------------------------------
INSERT INTO users (user_id, name, email, password_hash, role) VALUES
-- Admin
(1,  'System Administrator', 'admin@skillmatch.io',          @pwd, 'Admin'),
-- Recruiters
(2,  'Sarah Jenkins',        'sarah.j@techcorp.com',         @pwd, 'Recruiter'),
(3,  'Arun Kumar',           'arun.k@cloudscale.io',         @pwd, 'Recruiter'),
(4,  'Priya Nair',           'priya.n@fintechglobal.com',    @pwd, 'Recruiter'),
(11, 'Meghna Rao',           'meghna.r@datanest.ai',         @pwd, 'Recruiter'),
(12, 'Rajesh Iyer',          'rajesh.i@shopsphere.in',       @pwd, 'Recruiter'),
(13, 'Ann Thomas',           'ann.t@medicore.health',        @pwd, 'Recruiter'),
-- Candidates
(5,  'Rahul Sharma',         'rahul.sharma@gmail.com',       @pwd, 'Candidate'),
(6,  'Ananya Sen',           'ananya.sen@outlook.com',       @pwd, 'Candidate'),
(7,  'David Chen',           'david.chen@yahoo.com',         @pwd, 'Candidate'),
(8,  'Neha Patel',           'neha.patel@gmail.com',         @pwd, 'Candidate'),
(9,  'Vikram Malhotra',      'vikram.m@gmail.com',           @pwd, 'Candidate'),
(10, 'Fatima Al-Mansoor',    'fatima.m@gmail.com',           @pwd, 'Candidate'),
(14, 'Karthik Reddy',        'karthik.reddy@gmail.com',      @pwd, 'Candidate'),
(15, 'Sneha Iyer',           'sneha.iyer@outlook.com',       @pwd, 'Candidate'),
(16, 'Arjun Mehta',          'arjun.mehta@gmail.com',        @pwd, 'Candidate'),
(17, 'Divya Krishnan',       'divya.k@gmail.com',            @pwd, 'Candidate'),
(18, 'Rohan Gupta',          'rohan.gupta@yahoo.com',        @pwd, 'Candidate'),
(19, 'Meera Joshi',          'meera.joshi@gmail.com',        @pwd, 'Candidate'),
(20, 'Siddharth Rao',        'sid.rao@protonmail.com',       @pwd, 'Candidate'),
(21, 'Aisha Khan',           'aisha.khan@gmail.com',         @pwd, 'Candidate'),
(22, 'Nikhil Verma',         'nikhil.verma@outlook.com',     @pwd, 'Candidate'),
(23, 'Pooja Desai',          'pooja.desai@gmail.com',        @pwd, 'Candidate'),
(24, 'Imran Sheikh',         'imran.sheikh@gmail.com',       @pwd, 'Candidate'),
(25, 'Lakshmi Menon',        'lakshmi.menon@gmail.com',      @pwd, 'Candidate'),
(26, 'Varun Bhat',           'varun.bhat@yahoo.com',         @pwd, 'Candidate'),
(27, 'Kavya Pillai',         'kavya.pillai@gmail.com',       @pwd, 'Candidate');

-- -----------------------------------------------------------------------------
-- 2. COMPANIES
-- -----------------------------------------------------------------------------
INSERT INTO companies (company_id, company_name, industry, location, website) VALUES
(1, 'TechCorp Solutions',     'Enterprise Software',  'Bengaluru, India', 'https://techcorp.example.com'),
(2, 'CloudScale Networks',    'Cloud & DevOps',       'Hyderabad, India', 'https://cloudscale.example.com'),
(3, 'FinTech Global',         'Financial Technology', 'Mumbai, India',    'https://fintechglobal.example.com'),
(4, 'DataNest Analytics',     'Data & AI',            'Pune, India',      'https://datanest.example.com'),
(5, 'ShopSphere',             'E-commerce',           'Bengaluru, India', 'https://shopsphere.example.com'),
(6, 'MediCore Health Systems','HealthTech',           'Chennai, India',   'https://medicore.example.com');

-- -----------------------------------------------------------------------------
-- 3. RECRUITERS
-- -----------------------------------------------------------------------------
INSERT INTO recruiters (recruiter_id, company_id, designation) VALUES
(2,  1, 'Senior Talent Partner'),
(3,  2, 'Lead Technical Recruiter'),
(4,  3, 'Head of Engineering Talent'),
(11, 4, 'Talent Acquisition Manager'),
(12, 5, 'Technical Recruiter'),
(13, 6, 'HR Business Partner');

-- -----------------------------------------------------------------------------
-- 4. CANDIDATES  (23 Pooja Desai intentionally has NO resume)
-- -----------------------------------------------------------------------------
INSERT INTO candidates (candidate_id, phone, location, experience_years, resume_url, headline, bio) VALUES
(5,  '+91-9876543210', 'Bengaluru, India', 4.5, 'https://cdn.skillmatch.io/resumes/rahul_sharma.pdf',  'Full Stack Developer | React, Node.js & MySQL', 'Passionate full-stack developer with 4+ years building high-throughput SaaS applications.'),
(6,  '+91-9876543211', 'Bengaluru, India', 2.0, 'https://cdn.skillmatch.io/resumes/ananya_sen.pdf',    'Junior Backend Engineer | Python & FastAPI', 'CSE graduate interested in distributed systems, REST APIs and graph databases.'),
(7,  '+91-9876543212', 'Hyderabad, India', 6.0, 'https://cdn.skillmatch.io/resumes/david_chen.pdf',    'Senior DevOps & Cloud Architect | AWS, Docker, K8s', 'Expert in infrastructure as code, CI/CD pipelines, container orchestration, and multi-cloud systems.'),
(8,  '+91-9876543213', 'Pune, India',      3.0, 'https://cdn.skillmatch.io/resumes/neha_patel.pdf',    'Data Engineer & Database Specialist | SQL & Neo4j', 'Focuses on relational schema modeling, ETL pipelines, and graph query optimization.'),
(9,  '+91-9876543214', 'Delhi, India',     5.0, 'https://cdn.skillmatch.io/resumes/vikram_m.pdf',      'Frontend Specialist | Next.js, TypeScript, Tailwind', 'UI/UX enthusiast obsessed with web performance, responsive design, and state management.'),
(10, '+91-9876543215', 'Remote',           1.5, 'https://cdn.skillmatch.io/resumes/fatima_m.pdf',      'Associate AI & Data Analyst | Python, PyTorch', 'Fresh talent exploring machine learning algorithms, embeddings, and vector similarity search.'),
(14, '+91-9876543216', 'Hyderabad, India', 5.0, 'https://cdn.skillmatch.io/resumes/karthik_reddy.pdf', 'Java Backend Engineer | Spring Boot, Kafka', 'Builds event-driven payment microservices with Spring Boot, Kafka and MySQL.'),
(15, '+91-9876543217', 'Bengaluru, India', 3.0, 'https://cdn.skillmatch.io/resumes/sneha_iyer.pdf',    'Machine Learning Engineer | PyTorch, Pandas', 'Trains and deploys deep learning models for recommendation and computer vision.'),
(16, '+91-9876543218', 'Pune, India',      4.0, 'https://cdn.skillmatch.io/resumes/arjun_mehta.pdf',   'Go & Cloud Engineer | Kubernetes, Terraform', 'Writes Go microservices and manages Kubernetes clusters with Terraform on AWS.'),
(17, '+91-9876543219', 'Chennai, India',   1.0, 'https://cdn.skillmatch.io/resumes/divya_k.pdf',       'Junior MERN Developer', 'Recent graduate building React and Node.js apps backed by MongoDB.'),
(18, '+91-9876543220', 'Delhi, India',     4.0, 'https://cdn.skillmatch.io/resumes/rohan_gupta.pdf',   'Data Engineer | Kafka, PostgreSQL, Python', 'Designs streaming data pipelines with Kafka and batch ETL into PostgreSQL warehouses.'),
(19, '+91-9876543221', 'Remote',           3.0, 'https://cdn.skillmatch.io/resumes/meera_joshi.pdf',   'Frontend Engineer | React, TypeScript, GraphQL', 'Builds accessible design systems and GraphQL-powered dashboards.'),
(20, '+91-9876543222', 'Bengaluru, India', 7.0, 'https://cdn.skillmatch.io/resumes/sid_rao.pdf',       'Site Reliability Engineer | Kubernetes, Terraform, AWS', 'Runs large Kubernetes fleets; focused on observability, incident response and automation.'),
(21, '+91-9876543223', 'Mumbai, India',    2.5, 'https://cdn.skillmatch.io/resumes/aisha_khan.pdf',    'Backend Developer | Python, FastAPI, PostgreSQL', 'Builds REST APIs with FastAPI, PostgreSQL and Redis caching.'),
(22, '+91-9876543224', 'Bengaluru, India', 8.0, 'https://cdn.skillmatch.io/resumes/nikhil_verma.pdf',  'Senior Java Architect | Spring, Kafka, Redis', 'Leads backend architecture for high-volume transaction systems.'),
(23, '+91-9876543225', 'Pune, India',      0.0, NULL,                                                  'Fresher | Python & SQL', 'Final-year student learning Python and SQL; resume not uploaded yet.'),
(24, '+91-9876543226', 'Hyderabad, India', 4.0, 'https://cdn.skillmatch.io/resumes/imran_sheikh.pdf',  'Full Stack Engineer | TypeScript, Node.js, MongoDB', 'Ships full-stack products end to end with TypeScript, Express and MongoDB.'),
(25, '+91-9876543227', 'Chennai, India',   6.0, 'https://cdn.skillmatch.io/resumes/lakshmi_menon.pdf', 'Data Scientist | Machine Learning, Python', 'Applies statistical modelling and machine learning to healthcare and retail data.'),
(26, '+91-9876543228', 'Remote',           1.5, 'https://cdn.skillmatch.io/resumes/varun_bhat.pdf',    'Junior DevOps Engineer | Docker, AWS', 'Automates builds and deployments with Docker and GitHub Actions.'),
(27, '+91-9876543229', 'Mumbai, India',    3.0, 'https://cdn.skillmatch.io/resumes/kavya_pillai.pdf',  'Graph Data Engineer | Neo4j, Python', 'Models knowledge graphs in Neo4j and builds Python ETL from relational sources.');

-- -----------------------------------------------------------------------------
-- 5. SKILLS (ontology mirrored as :Skill nodes in Neo4j)
-- -----------------------------------------------------------------------------
INSERT INTO skills (skill_id, skill_name, category) VALUES
(1,  'JavaScript',       'Languages'),
(2,  'TypeScript',       'Languages'),
(3,  'Python',           'Languages'),
(4,  'React',            'Frontend'),
(5,  'Next.js',          'Frontend'),
(6,  'Node.js',          'Backend'),
(7,  'Express.js',       'Backend'),
(8,  'FastAPI',          'Backend'),
(9,  'MySQL',            'Database'),
(10, 'PostgreSQL',       'Database'),
(11, 'Neo4j',            'Database'),
(12, 'Docker',           'DevOps'),
(13, 'Kubernetes',       'DevOps'),
(14, 'AWS',              'Cloud'),
(15, 'GraphQL',          'API/Backend'),
(16, 'Tailwind CSS',     'Frontend'),
(17, 'Java',             'Languages'),
(18, 'Spring Boot',      'Backend'),
(19, 'Go',               'Languages'),
(20, 'Redis',            'Database'),
(21, 'MongoDB',          'Database'),
(22, 'Terraform',        'DevOps'),
(23, 'PyTorch',          'AI/ML'),
(24, 'Machine Learning', 'AI/ML'),
(25, 'Pandas',           'Data'),
(26, 'Apache Kafka',     'Data Engineering');

-- -----------------------------------------------------------------------------
-- 6. CANDIDATE_SKILLS
-- -----------------------------------------------------------------------------
INSERT INTO candidate_skills (candidate_id, skill_id, proficiency_level, years_experience) VALUES
-- 5 Rahul Sharma (Full Stack)
(5, 1, 'Expert', 4.5), (5, 2, 'Advanced', 3.0), (5, 4, 'Expert', 4.0), (5, 5, 'Advanced', 2.5),
(5, 6, 'Advanced', 3.5), (5, 9, 'Intermediate', 3.0), (5, 16, 'Expert', 3.0),
-- 6 Ananya Sen (Junior Backend)
(6, 3, 'Advanced', 2.0), (6, 8, 'Intermediate', 1.5), (6, 9, 'Intermediate', 2.0), (6, 10, 'Beginner', 1.0),
-- 7 David Chen (Senior DevOps)
(7, 3, 'Intermediate', 3.0), (7, 12, 'Expert', 6.0), (7, 13, 'Expert', 5.0), (7, 14, 'Expert', 6.0),
-- 8 Neha Patel (Data / Graph)
(8, 3, 'Advanced', 3.0), (8, 9, 'Expert', 3.5), (8, 10, 'Advanced', 3.0), (8, 11, 'Advanced', 2.0),
-- 9 Vikram Malhotra (Frontend UI)
(9, 1, 'Expert', 5.0), (9, 2, 'Expert', 4.0), (9, 4, 'Expert', 5.0), (9, 5, 'Expert', 3.5), (9, 16, 'Expert', 4.0),
-- 10 Fatima Al-Mansoor (AI / Data)
(10, 3, 'Intermediate', 1.5), (10, 23, 'Beginner', 0.5), (10, 24, 'Intermediate', 1.0), (10, 25, 'Intermediate', 1.5),
-- 14 Karthik Reddy (Java backend)
(14, 17, 'Expert', 5.0), (14, 18, 'Advanced', 4.0), (14, 9, 'Advanced', 4.0), (14, 26, 'Intermediate', 2.0), (14, 12, 'Intermediate', 2.0),
-- 15 Sneha Iyer (ML engineer)
(15, 3, 'Expert', 3.0), (15, 23, 'Advanced', 2.5), (15, 24, 'Advanced', 3.0), (15, 25, 'Expert', 3.0), (15, 14, 'Beginner', 0.5),
-- 16 Arjun Mehta (Go / cloud)
(16, 19, 'Advanced', 3.0), (16, 12, 'Advanced', 4.0), (16, 13, 'Advanced', 3.0), (16, 14, 'Intermediate', 2.0), (16, 22, 'Intermediate', 1.5),
-- 17 Divya Krishnan (junior MERN)
(17, 1, 'Intermediate', 1.0), (17, 4, 'Intermediate', 1.0), (17, 6, 'Intermediate', 1.0), (17, 21, 'Intermediate', 1.0), (17, 7, 'Beginner', 0.5),
-- 18 Rohan Gupta (data engineer)
(18, 3, 'Advanced', 4.0), (18, 26, 'Advanced', 3.0), (18, 10, 'Advanced', 4.0), (18, 25, 'Advanced', 3.0), (18, 14, 'Intermediate', 2.0),
-- 19 Meera Joshi (frontend)
(19, 2, 'Advanced', 3.0), (19, 4, 'Advanced', 3.0), (19, 5, 'Intermediate', 1.5), (19, 16, 'Advanced', 2.5), (19, 15, 'Intermediate', 2.0),
-- 20 Siddharth Rao (SRE)
(20, 13, 'Expert', 6.0), (20, 22, 'Expert', 5.0), (20, 14, 'Advanced', 6.0), (20, 19, 'Intermediate', 2.0), (20, 12, 'Expert', 7.0),
-- 21 Aisha Khan (Python backend)
(21, 3, 'Advanced', 2.5), (21, 8, 'Advanced', 2.0), (21, 10, 'Intermediate', 2.0), (21, 20, 'Intermediate', 1.5), (21, 12, 'Beginner', 0.5),
-- 22 Nikhil Verma (senior Java)
(22, 17, 'Expert', 8.0), (22, 18, 'Expert', 7.0), (22, 26, 'Advanced', 4.0), (22, 20, 'Advanced', 4.0), (22, 9, 'Advanced', 6.0),
-- 23 Pooja Desai (fresher, no resume)
(23, 3, 'Beginner', 0.5), (23, 9, 'Beginner', 0.5),
-- 24 Imran Sheikh (full stack TS)
(24, 2, 'Advanced', 3.0), (24, 6, 'Advanced', 4.0), (24, 7, 'Advanced', 3.5), (24, 21, 'Advanced', 3.0), (24, 4, 'Intermediate', 2.0),
-- 25 Lakshmi Menon (data scientist)
(25, 3, 'Expert', 6.0), (25, 24, 'Expert', 5.0), (25, 25, 'Expert', 6.0), (25, 23, 'Intermediate', 2.0), (25, 9, 'Intermediate', 3.0),
-- 26 Varun Bhat (junior DevOps)
(26, 12, 'Intermediate', 1.5), (26, 14, 'Beginner', 1.0), (26, 3, 'Intermediate', 1.5), (26, 22, 'Beginner', 0.5),
-- 27 Kavya Pillai (graph data)
(27, 11, 'Advanced', 2.5), (27, 3, 'Advanced', 3.0), (27, 9, 'Advanced', 3.0), (27, 10, 'Intermediate', 2.0), (27, 15, 'Beginner', 0.5);

-- -----------------------------------------------------------------------------
-- 7. JOBS (company is derived from the recruiter)
--    Jobs 14 and 15 start OPEN so they can receive applications, and are
--    closed/archived at the end of this script.
-- -----------------------------------------------------------------------------
INSERT INTO jobs (job_id, recruiter_id, job_title, description, location, employment_type, salary_min, salary_max, posted_date, status) VALUES
(1,  2,  'Senior Full Stack Engineer', 'Join TechCorp to scale our B2B SaaS platform using Next.js, Node.js, TypeScript and MySQL. You will own features end to end.', 'Bengaluru, India', 'Full-time', 1800000.00, 2600000.00, NOW() - INTERVAL 30 DAY, 'OPEN'),
(2,  2,  'Frontend UI/UX Specialist', 'Looking for a Next.js and Tailwind wizard to build elegant, accessible design systems in React.', 'Bengaluru, India', 'Full-time', 1200000.00, 1800000.00, NOW() - INTERVAL 28 DAY, 'OPEN'),
(3,  3,  'Principal Cloud & DevOps Architect', 'Drive Kubernetes containerization and AWS infrastructure at CloudScale. Docker, Kubernetes and AWS expertise required.', 'Hyderabad, India', 'Full-time', 2400000.00, 3600000.00, NOW() - INTERVAL 26 DAY, 'OPEN'),
(4,  4,  'Graph Data Engineer', 'Design high-speed Neo4j graph schemas and Python ETL flows from MySQL for anti-fraud detection.', 'Mumbai, India', 'Full-time', 1600000.00, 2200000.00, NOW() - INTERVAL 25 DAY, 'OPEN'),
(5,  3,  'Legacy PHP Maintenance Engineer', 'Maintain deprecated internal tooling written in PHP.', 'Remote', 'Contract', 600000.00, 800000.00, NOW() - INTERVAL 90 DAY, 'CLOSED'),
(6,  4,  'Java Backend Engineer (Payments)', 'Build low-latency payment microservices with Java, Spring Boot and Apache Kafka. Redis and MySQL experience is a plus.', 'Mumbai, India', 'Full-time', 2000000.00, 3000000.00, NOW() - INTERVAL 21 DAY, 'OPEN'),
(7,  11, 'Machine Learning Engineer', 'Train, evaluate and deploy deep learning models with PyTorch. Strong Python and machine learning fundamentals required.', 'Pune, India', 'Full-time', 1800000.00, 2800000.00, NOW() - INTERVAL 20 DAY, 'OPEN'),
(8,  11, 'Data Engineer (Streaming)', 'Build real-time streaming pipelines on Apache Kafka and load curated data into PostgreSQL with Python.', 'Pune, India', 'Full-time', 1500000.00, 2300000.00, NOW() - INTERVAL 18 DAY, 'OPEN'),
(9,  12, 'MERN Stack Developer', 'Develop storefront features with MongoDB, Express.js, React and Node.js for millions of shoppers.', 'Bengaluru, India', 'Full-time', 900000.00, 1500000.00, NOW() - INTERVAL 15 DAY, 'OPEN'),
(10, 12, 'Site Reliability Engineer', 'Keep our Kubernetes platform reliable. Terraform, AWS and Docker daily; Go for tooling.', 'Bengaluru, India', 'Full-time', 2200000.00, 3200000.00, NOW() - INTERVAL 12 DAY, 'OPEN'),
(11, 13, 'Backend Engineer - Python/FastAPI', 'Build HIPAA-aware healthcare APIs with Python, FastAPI and PostgreSQL. Redis caching and Docker deployments.', 'Chennai, India', 'Full-time', 1100000.00, 1700000.00, NOW() - INTERVAL 10 DAY, 'OPEN'),
(12, 13, 'Junior Data Analyst Internship', 'Six-month internship analysing hospital operations data with Python, Pandas and SQL.', 'Chennai, India', 'Internship', 300000.00, 400000.00, NOW() - INTERVAL 7 DAY, 'OPEN'),
(13, 2,  'Next.js Platform Engineer (Contract)', 'Twelve-month contract to migrate our dashboard to the Next.js App Router with TypeScript and GraphQL.', 'Remote', 'Contract', 1400000.00, 2000000.00, NOW() - INTERVAL 5 DAY, 'OPEN'),
(14, 3,  'Cloud Support Associate', 'Entry-level role supporting customers on AWS and Docker based deployments.', 'Hyderabad, India', 'Full-time', 500000.00, 800000.00, NOW() - INTERVAL 60 DAY, 'OPEN'),
(15, 4,  'Go Microservices Developer', 'Build Go microservices running on Docker and Kubernetes with Redis caching.', 'Mumbai, India', 'Full-time', 1500000.00, 2100000.00, NOW() - INTERVAL 75 DAY, 'OPEN');

-- -----------------------------------------------------------------------------
-- 8. JOB_SKILLS
-- -----------------------------------------------------------------------------
INSERT INTO job_skills (job_id, skill_id, required_level, is_mandatory) VALUES
-- 1 Senior Full Stack Engineer
(1, 2, 'Advanced', TRUE), (1, 4, 'Advanced', TRUE), (1, 5, 'Intermediate', TRUE), (1, 6, 'Intermediate', TRUE),
(1, 9, 'Intermediate', FALSE), (1, 12, 'Beginner', FALSE),
-- 2 Frontend UI/UX Specialist
(2, 1, 'Advanced', TRUE), (2, 4, 'Expert', TRUE), (2, 5, 'Advanced', TRUE), (2, 16, 'Expert', TRUE),
-- 3 Principal Cloud & DevOps Architect
(3, 12, 'Expert', TRUE), (3, 13, 'Expert', TRUE), (3, 14, 'Expert', TRUE), (3, 3, 'Intermediate', FALSE),
-- 4 Graph Data Engineer
(4, 9, 'Advanced', TRUE), (4, 11, 'Advanced', TRUE), (4, 3, 'Advanced', TRUE), (4, 10, 'Intermediate', FALSE),
-- 5 Legacy PHP (closed; no matching skills in taxonomy)
(5, 9, 'Intermediate', FALSE),
-- 6 Java Backend Engineer
(6, 17, 'Advanced', TRUE), (6, 18, 'Advanced', TRUE), (6, 26, 'Intermediate', TRUE), (6, 9, 'Intermediate', FALSE), (6, 20, 'Intermediate', FALSE),
-- 7 Machine Learning Engineer
(7, 3, 'Advanced', TRUE), (7, 23, 'Advanced', TRUE), (7, 24, 'Advanced', TRUE), (7, 25, 'Intermediate', FALSE), (7, 14, 'Beginner', FALSE),
-- 8 Data Engineer (Streaming)
(8, 3, 'Advanced', TRUE), (8, 26, 'Advanced', TRUE), (8, 10, 'Intermediate', TRUE), (8, 25, 'Intermediate', FALSE), (8, 14, 'Intermediate', FALSE),
-- 9 MERN Stack Developer
(9, 1, 'Intermediate', TRUE), (9, 4, 'Intermediate', TRUE), (9, 6, 'Intermediate', TRUE), (9, 21, 'Intermediate', TRUE), (9, 7, 'Beginner', FALSE),
-- 10 Site Reliability Engineer
(10, 13, 'Advanced', TRUE), (10, 22, 'Advanced', TRUE), (10, 14, 'Intermediate', TRUE), (10, 12, 'Advanced', TRUE), (10, 19, 'Intermediate', FALSE),
-- 11 Backend Engineer - Python/FastAPI
(11, 3, 'Advanced', TRUE), (11, 8, 'Intermediate', TRUE), (11, 10, 'Intermediate', TRUE), (11, 20, 'Beginner', FALSE), (11, 12, 'Beginner', FALSE),
-- 12 Junior Data Analyst Internship
(12, 3, 'Beginner', TRUE), (12, 25, 'Beginner', TRUE), (12, 9, 'Beginner', TRUE),
-- 13 Next.js Platform Engineer
(13, 2, 'Advanced', TRUE), (13, 5, 'Advanced', TRUE), (13, 15, 'Intermediate', FALSE), (13, 16, 'Intermediate', FALSE),
-- 14 Cloud Support Associate
(14, 14, 'Intermediate', TRUE), (14, 12, 'Beginner', TRUE), (14, 3, 'Beginner', FALSE),
-- 15 Go Microservices Developer
(15, 19, 'Advanced', TRUE), (15, 12, 'Intermediate', TRUE), (15, 13, 'Intermediate', FALSE), (15, 20, 'Intermediate', FALSE);

-- -----------------------------------------------------------------------------
-- 9. APPLICATIONS (41) - inserted as APPLIED, then advanced through the
--    stored procedure so every transition is validated and audited.
-- -----------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS seed_application_targets;
CREATE TEMPORARY TABLE seed_application_targets (
    seq INT AUTO_INCREMENT PRIMARY KEY,
    job_id INT NOT NULL,
    candidate_id INT NOT NULL,
    target_status VARCHAR(30) NOT NULL,
    days_ago INT NOT NULL
);

INSERT INTO seed_application_targets (job_id, candidate_id, target_status, days_ago) VALUES
(1, 5,  'INTERVIEW_SCHEDULED', 27), (1, 9,  'APPLIED', 20), (1, 24, 'UNDER_REVIEW', 18), (1, 19, 'REJECTED', 17), (1, 17, 'APPLIED', 3),
(2, 9,  'OFFERED', 25), (2, 19, 'INTERVIEW_SCHEDULED', 20), (2, 5, 'UNDER_REVIEW', 14),
(3, 7,  'UNDER_REVIEW', 24), (3, 20, 'INTERVIEW_SCHEDULED', 22), (3, 16, 'APPLIED', 9), (3, 26, 'REJECTED', 15),
(4, 8,  'APPLIED', 21), (4, 27, 'UNDER_REVIEW', 19), (4, 6, 'REJECTED', 16),
(6, 14, 'INTERVIEW_SCHEDULED', 19), (6, 22, 'OFFERED', 18), (6, 21, 'REJECTED', 12),
(7, 15, 'INTERVIEW_SCHEDULED', 18), (7, 25, 'OFFERED', 17), (7, 10, 'UNDER_REVIEW', 11),
(8, 18, 'UNDER_REVIEW', 16), (8, 25, 'APPLIED', 10), (8, 6, 'APPLIED', 6),
(9, 17, 'UNDER_REVIEW', 13), (9, 24, 'INTERVIEW_SCHEDULED', 12), (9, 5, 'APPLIED', 4),
(10, 20, 'OFFERED', 11), (10, 16, 'UNDER_REVIEW', 9), (10, 7, 'APPLIED', 5),
(11, 21, 'INTERVIEW_SCHEDULED', 9), (11, 6, 'UNDER_REVIEW', 8), (11, 26, 'REJECTED', 7),
(12, 10, 'APPLIED', 5), (12, 15, 'UNDER_REVIEW', 6),
(13, 9,  'APPLIED', 4), (13, 19, 'APPLIED', 2),
(14, 26, 'REJECTED', 55), (14, 7, 'OFFERED', 58),
(15, 16, 'REJECTED', 70), (15, 20, 'UNDER_REVIEW', 72);

-- Insert all as APPLIED (triggers compute match_score, resume snapshot, audit row)
INSERT INTO applications (job_id, candidate_id, applied_date)
SELECT job_id, candidate_id, NOW() - INTERVAL days_ago DAY
  FROM seed_application_targets
 ORDER BY seq;

-- Seed-only helper: walk each application along a valid path to its target
--   UNDER_REVIEW        : APPLIED -> UNDER_REVIEW
--   INTERVIEW_SCHEDULED : ... -> UNDER_REVIEW -> INTERVIEW_SCHEDULED
--   OFFERED             : ... -> INTERVIEW_SCHEDULED -> OFFERED
--   REJECTED            : APPLIED -> UNDER_REVIEW -> REJECTED
DROP PROCEDURE IF EXISTS seed_advance_applications;
DELIMITER //
CREATE PROCEDURE seed_advance_applications()
BEGIN
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_app_id INT;
    DECLARE v_target VARCHAR(30);
    DECLARE v_recruiter INT;
    DECLARE v_rows INT;
    DECLARE cur CURSOR FOR
        SELECT a.application_id, t.target_status, j.recruiter_id
          FROM seed_application_targets t
          JOIN applications a ON a.job_id = t.job_id AND a.candidate_id = t.candidate_id
          JOIN jobs j ON j.job_id = t.job_id
         ORDER BY t.seq;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    OPEN cur;
    read_loop: LOOP
        FETCH cur INTO v_app_id, v_target, v_recruiter;
        IF v_done = 1 THEN
            LEAVE read_loop;
        END IF;

        IF v_target IN ('UNDER_REVIEW', 'INTERVIEW_SCHEDULED', 'OFFERED', 'REJECTED') THEN
            CALL sp_update_application_status(v_app_id, 'UNDER_REVIEW',
                 'Passed initial automated skill screening', v_recruiter, v_rows);
        END IF;
        IF v_target IN ('INTERVIEW_SCHEDULED', 'OFFERED') THEN
            CALL sp_update_application_status(v_app_id, 'INTERVIEW_SCHEDULED',
                 'Technical interview scheduled', v_recruiter, v_rows);
        END IF;
        IF v_target = 'OFFERED' THEN
            CALL sp_update_application_status(v_app_id, 'OFFERED',
                 'Cleared all interview rounds - offer released', v_recruiter, v_rows);
        END IF;
        IF v_target = 'REJECTED' THEN
            CALL sp_update_application_status(v_app_id, 'REJECTED',
                 'Skill profile does not meet mandatory requirements', v_recruiter, v_rows);
        END IF;
    END LOOP;
    CLOSE cur;
END //
DELIMITER ;

CALL seed_advance_applications();
DROP PROCEDURE seed_advance_applications;
DROP TEMPORARY TABLE seed_application_targets;

-- The triggers stamped every audit row with NOW(); spread each application's
-- history out from its (back-dated) applied_date, 2 days per step, never in
-- the future, so timelines read realistically. (Window function in a derived
-- table: it is materialised, so updating the same table is allowed.)
UPDATE application_audit_logs l
JOIN (SELECT log_id,
             ROW_NUMBER() OVER (PARTITION BY application_id ORDER BY log_id) - 1 AS step
        FROM application_audit_logs) s ON s.log_id = l.log_id
JOIN applications a ON a.application_id = l.application_id
SET l.changed_at = LEAST(a.applied_date + INTERVAL (s.step * 2) DAY, NOW());

-- Close / archive the historical postings now that their pipelines exist
UPDATE jobs SET status = 'CLOSED'   WHERE job_id = 14;
UPDATE jobs SET status = 'ARCHIVED' WHERE job_id = 15;
