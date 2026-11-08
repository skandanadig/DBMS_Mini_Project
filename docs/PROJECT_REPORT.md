# SkillMatch - Project Overview & Execution Report

**Project Title:** SkillMatch: Intelligent Multi-Paradigm Job & Skill Matching Platform  
**Course:** DBMS Experiential Learning – Level 3 Project  
**Institution:** PES University, Department of Computer Science and Engineering  
**Faculty In-Charge:** Dr. Nagasundari S  

---

## 1. Project Objectives
SkillMatch is an enterprise-grade job matching and talent discovery platform engineered to address the impedance mismatch between unstructured talent acquisition and structured applicant lifecycle management.
Instead of being a standard CRUD application, SkillMatch combines:
1. **Relational Database Management System (MySQL 8.0+)** for ACID-compliant transaction processing, role-based authorization, referential integrity, and automated audit trails.
2. **Graph NoSQL Database (Neo4j 5.0+)** for semantic skill taxonomy navigation, multi-hop transitive skill expansion (e.g. knowing *PyTorch* infers *Python* and *Deep Learning*), candidate graph scoring, and referral network analysis.

---

## 2. Functional Requirements
- **Role-Based Access Control (RBAC):** Distinct workflows for Candidates, Recruiters, and Admins.
- **Job Lifecycle & Hiring Pipeline:** Posting, managing, and tracking applications through 5 distinct statuses (`APPLIED`, `UNDER_REVIEW`, `INTERVIEW_SCHEDULED`, `OFFERED`, `REJECTED`).
- **Atomic Application Submissions:** ACID-compliant stored procedure (`sp_submit_application`) ensuring resume validation, active-job checks, and automated audit logging in a single atomic transaction.
- **Business Rule Triggers:** Database-level constraints and triggers preventing applications to closed jobs (`trg_prevent_apply_closed_job`) and tracking all status updates in immutable audit logs (`trg_audit_application_status_update`).
- **Graph-Powered Skill & Gap Matching:** Multi-hop Cypher queries calculating candidate fit percentage and pinpointing exact missing mandatory skills.

---

## 3. Technology Stack & Database Justification

| Layer / Technology | Role in Architecture | Technical Justification |
| :--- | :--- | :--- |
| **MySQL 8.0+** | Transactional Relational Core | Enforces strong referential integrity across 10 tables in 3NF/BCNF, guarantees serializable/repeatable read ACID isolation, prevents duplicate applications, and automates audit trails via triggers. |
| **Neo4j 5.0+** | Skill & Referral Graph | Relational databases suffer severe performance degradation (exponential JOIN cost) on recursive recursive multi-hop traversals. Neo4j executes pointer-chasing graph queries in milliseconds to find 2-hop related skills and network referrals. |
| **Next.js 14+ / React** | Frontend & API Layer | Server-side rendering, type-safe API route handlers, and separation of client components and database queries. |
| **Git / GitHub** | Source Control | Structured commits, multi-developer collaboration, and rubric compliance documentation. |

---

## 4. Database Design & Relational Schema Summary

### Relational Schema (MySQL 3NF)
- **`users`** (<ins>`user_id`</ins>, `name`, `email`, `password_hash`, `role`, `created_at`, `updated_at`)
- **`candidates`** (<ins>`candidate_id`*</ins>, `phone`, `location`, `experience_years`, `resume_url`, `headline`, `bio`)
- **`companies`** (<ins>`company_id`</ins>, `company_name`, `industry`, `location`, `website`, `created_at`)
- **`recruiters`** (<ins>`recruiter_id`*</ins>, `company_id`*, `designation`)
- **`skills`** (<ins>`skill_id`</ins>, `skill_name`, `category`)
- **`candidate_skills`** (<ins>`candidate_id`*</ins>, <ins>`skill_id`*</ins>, `proficiency_level`, `years_experience`)
- **`jobs`** (<ins>`job_id`</ins>, `recruiter_id`*, `company_id`*, `job_title`, `description`, `location`, `employment_type`, `salary_min`, `salary_max`, `posted_date`, `status`)
- **`job_skills`** (<ins>`job_id`*</ins>, <ins>`skill_id`*</ins>, `required_level`, `is_mandatory`)
- **`applications`** (<ins>`application_id`</ins>, `job_id`*, `candidate_id`*, `applied_date`, `status`, `match_score`, `resume_snapshot_url`)
- **`application_audit_logs`** (<ins>`log_id`</ins>, `application_id`*, `old_status`, `new_status`, `changed_at`, `remarks`)

*Full ER diagram, Chen notation, and Crow's foot models are documented in [`docs/ER_DIAGRAM_AND_RELATIONAL_SCHEMA.md`](ER_DIAGRAM_AND_RELATIONAL_SCHEMA.md).*

---

## 5. Advanced Database Concepts Demonstrated (PES Rubric Section 7)

### Concept 1: ACID Transactions (`sp_submit_application`)
Encapsulated in `mysql/schema.sql`, lines 304–380. Executes `START TRANSACTION`, verifies that the candidate has an uploaded resume, confirms that the target job is in `OPEN` status, prevents duplicates, inserts into `applications`, generates an initial record in `application_audit_logs`, and issues `COMMIT` or `ROLLBACK` on `SQLEXCEPTION`.

### Concept 2: Views for Analytics (`vw_recruiter_pipeline`, `vw_candidate_applications`, `vw_top_demanded_skills`)
Encapsulated in `mysql/schema.sql`, lines 198–255. Demonstrates multi-table inner/outer joins with `GROUP BY`, `HAVING`, conditional `SUM(CASE ...)`, and window-like aggregations for real-time dashboards.

### Concept 3: Active Business Triggers (`trg_prevent_apply_closed_job`, `trg_audit_application_status_update`)
- `trg_prevent_apply_closed_job`: Intercepts `BEFORE INSERT` on `applications`, signals SQLSTATE `'45000'` with an error message if the job status is not `OPEN`.
- `trg_audit_application_status_update`: Intercepts `AFTER UPDATE` on `applications`, automatically inserting an audit record into `application_audit_logs` whenever status changes.

### Concept 4: Stored Procedures with Control Flow & Parameters
- `sp_submit_application`: Takes candidate ID, job ID, and match score, and returns an application ID, status code, and descriptive message through `OUT` parameters.
- `sp_update_application_status`: Updates lifecycle states and leverages the database trigger to generate audit trail entries.

### Concept 5: Indexing Strategy
Composite indexes defined on:
- `(status, posted_date)` on `jobs` for feed sorting.
- `(job_id, status)` and `(candidate_id, status)` on `applications` for pipeline filtering.
- `(skill_id, proficiency_level)` on `candidate_skills` for fast skill lookups.

### Concept 6 (NoSQL Graph): 2-Hop Graph Traversal & Missing Skill Analysis
Neo4j Cypher queries in `neo4j/schema_and_seed.cql`:
- Multi-hop skill ontology expansion: `MATCH (c:Candidate)-[:HAS_SKILL]->(s:Skill)-[:RELATED_TO*1..2]-(req:Skill)<-[:REQUIRES_SKILL]-(j:Job)`.
- Gap identification: Pinpointing mandatory skills required by a job that a candidate currently lacks.
- Referral network traversal: Traverses `(:Candidate)-[:WORKED_AT]->(:Company)<-[:WORKED_AT]-(:Candidate)` to locate referral paths.

---

## 6. How to Run & Verify

### MySQL
```bash
mysql -u root -p
source mysql/schema.sql;
source mysql/seed_data.sql;
source mysql/queries_and_tests.sql;
```

### Neo4j
Open Neo4j Browser or Cypher Shell and run:
```cypher
:source neo4j/schema_and_seed.cql
```

### Full Documentation
Review the comprehensive visual models in [`docs/ER_DIAGRAM_AND_RELATIONAL_SCHEMA.md`](ER_DIAGRAM_AND_RELATIONAL_SCHEMA.md).
