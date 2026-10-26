# SkillMatch Database Setup & Rubric Compliance Guide

This folder contains the complete, production-ready database definitions for **SkillMatch: Intelligent Job and Skill Matching Platform**, strictly designed according to the **PES University CSE DBMS Experiential Learning - Level 3 Project** specifications.

---

## 📁 File Structure

| File | Purpose | Paradigm |
| :--- | :--- | :--- |
| [`mysql/schema.sql`](mysql/schema.sql) | Complete DDL, Primary/Foreign keys, Constraints, Indexes, Views, Triggers, Stored Procedures, and Transactions | Relational (SQL) |
| [`mysql/seed_data.sql`](mysql/seed_data.sql) | Realistic seed data (Users, Candidates, Recruiters, Companies, Skills, Jobs, Applications, Audit Logs) | Relational (SQL) |
| [`mysql/queries_and_tests.sql`](mysql/queries_and_tests.sql) | DML operations, Multi-table JOINs, GROUP BY/HAVING, Subqueries, Stored Procedure calls, and Trigger error tests | Test Suite / Demo |
| [`neo4j/schema_and_seed.cql`](neo4j/schema_and_seed.cql) | Cypher constraints, Graph Nodes, Relationships (`[:HAS_SKILL]`, `[:REQUIRES_SKILL]`, `[:RELATED_TO]`), and 4 Advanced graph queries | Graph (NoSQL) |

---

## 📋 Evaluation Rubric Checklist & Mapping

| Rubric Requirement | Where It Is Implemented | Description |
| :--- | :--- | :--- |
| **SQL + NoSQL Paradigms** | MySQL + Neo4j | MySQL handles ACID transactions, relational integrity, auth, applications; Neo4j handles multi-hop skill ontology and recommendation graph. |
| **ER Diagram & Relational Schema** | [`mysql/schema.sql`](mysql/schema.sql) | Fully normalized (3NF), Primary & Foreign keys with `ON DELETE CASCADE/RESTRICT`, check constraints. |
| **DDL Statements** | `CREATE`, `ALTER`, `DROP`, Constraints, Indexes | See sections 0-10 of `schema.sql`. |
| **DML Operations** | `INSERT`, `UPDATE`, `DELETE`, `SELECT` | Tested in Section A of `queries_and_tests.sql`. |
| **JOIN, GROUP BY, HAVING, Subqueries** | Sections B & C of `queries_and_tests.sql` | Mandatory skills checker subquery, salary threshold aggregations. |
| **SQL Concept 1: Transactions** | `sp_submit_application` in `schema.sql` | `START TRANSACTION`, rollback on missing resume or closed job, atomic write to `applications` and `application_audit_logs`. |
| **SQL Concept 2: Views** | `vw_recruiter_pipeline`, `vw_candidate_applications`, `vw_top_demanded_skills` | Real-time dashboards with multi-table joins and aggregations. |
| **SQL Concept 3: Triggers** | `trg_prevent_apply_closed_job`, `trg_audit_application_status_update` | Enforces business logic (aborts insert on closed job) and automatic audit log generation. |
| **SQL Concept 4: Stored Procedures** | `sp_submit_application`, `sp_update_application_status` | Procedural business transactions with input/output parameters and error handlers. |
| **SQL Concept 5: Indexing** | Composite indexes on `(status, posted_date)`, `(job_id, status)` | Fast query execution for filter/sort operations. |
| **NoSQL Advanced Concept: Graph Traversal** | `neo4j/schema_and_seed.cql` | 2-hop related skill expansion, weighted candidate ranking, missing skill-gap analysis, and network referral paths. |

---

## 🚀 Execution Instructions

### 1. MySQL Execution
You can run these scripts using **MySQL Workbench**, **phpMyAdmin**, or the **MySQL CLI**:

```bash
# Log in to MySQL (from the project directory)
mysql -u root -p

# 1. Run schema DDL (creates database, tables, triggers, procedures, views)
source mysql/schema.sql;

# 2. Populate realistic seed data
source mysql/seed_data.sql;

# 3. Test verification queries
source mysql/queries_and_tests.sql;
```

### 2. Neo4j Execution
You can run this using **Neo4j Desktop**, **Neo4j Browser** (usually at `http://localhost:7474`), or **cypher-shell**:

1. Open **Neo4j Browser**.
2. Copy and paste the contents of [`neo4j/schema_and_seed.cql`](neo4j/schema_and_seed.cql).
3. Execute the statements to create constraints, populate graph nodes and relationships.
4. Run each of the 4 demo Cypher queries in Section 7 to see graph visualization of skill matching and referrals.
