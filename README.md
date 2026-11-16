# SkillMatch Database Setup & Rubric Compliance Guide

This folder contains the complete, production-ready database definitions for **SkillMatch: Intelligent Job and Skill Matching Platform**, strictly designed according to the **PES University CSE DBMS Experiential Learning - Level 3 Project** specifications.

---

## 📁 File Structure

| File | Purpose | Paradigm |
| :--- | :--- | :--- |
| [`docker-compose.yml`](docker-compose.yml) | Local MySQL 8 + Neo4j 5 stack (schema + seed auto-load on first start) | Infra |
| [`mysql/01_schema.sql`](mysql/01_schema.sql) | DDL, PK/FK, CHECK constraints, indexes, FULLTEXT, views, `fn_match_score`, 3 stored procedures, 26 triggers (business rules, audit, outbox) | Relational (SQL) |
| [`mysql/02_seed_data.sql`](mysql/02_seed_data.sql) | 27 users, 6 companies, 26 skills, 15 jobs, 41 applications advanced through the stored procedure (password `Password@123`) | Relational (SQL) |
| [`mysql/03_queries_and_tests.sql`](mysql/03_queries_and_tests.sql) | DML, JOINs, GROUP BY/HAVING, subqueries, views, procedures, window functions, CTEs, full-text search, SQL ranking | Demo queries |
| [`mysql/04_alter_demo.sql`](mysql/04_alter_demo.sql) | `ALTER TABLE` / `ALTER VIEW` / `RENAME` / `DROP` on the live schema (self-reverting) | DDL demo |
| [`mysql/05_performance.sql`](mysql/05_performance.sql) | `EXPLAIN ANALYZE` with vs without each index on 50k jobs / 100k applications; FULLTEXT vs `LIKE` | Performance |
| [`mysql/06_tests.sql`](mysql/06_tests.sql) | 49 automated PASS/FAIL tests: constraints, triggers, procedures, rollback, outbox | Test suite |
| [`docs/CONTRACTS.md`](docs/CONTRACTS.md) | Shared API/DB/graph contracts and Member A / Member B file ownership | Team agreement |
| [`neo4j/schema_and_seed.cql`](neo4j/schema_and_seed.cql) | Cypher constraints, Graph Nodes, Relationships (`[:HAS_SKILL]`, `[:REQUIRES_SKILL]`, `[:RELATED_TO]`), and 4 Advanced graph queries | Graph (NoSQL) |

---

## 📋 Evaluation Rubric Checklist & Mapping

| Rubric Requirement | Where It Is Implemented | Description |
| :--- | :--- | :--- |
| **SQL + NoSQL Paradigms** | MySQL + Neo4j | MySQL handles ACID transactions, relational integrity, auth, applications; Neo4j handles multi-hop skill ontology and recommendation graph. |
| **ER Diagram & Relational Schema** | [`mysql/01_schema.sql`](mysql/01_schema.sql) | 3NF (redundant `jobs.company_id` removed; company derived via recruiter), PK/FK with `CASCADE/RESTRICT/SET NULL`, CHECK constraints. |
| **DDL Statements** | `CREATE` / `DROP` in `01_schema.sql`, `ALTER` / `RENAME` / `DROP` in `04_alter_demo.sql` | Constraints, indexes, views. |
| **DML Operations** | `INSERT`, `UPDATE`, `DELETE`, `SELECT` | Section A of `03_queries_and_tests.sql`. |
| **JOIN, GROUP BY, HAVING, Subqueries** | Sections B, C, G of `03_queries_and_tests.sql` | Relational division, correlated subqueries, window functions, CTEs (incl. recursive). |
| **Data validation at DB level** | CHECK, UNIQUE, FK, ENUM, triggers | Verified by `06_tests.sql` (49 PASS/FAIL tests). |
| **SQL Concept 1: Transactions** | `sp_submit_application` | `START TRANSACTION`, `SELECT ... FOR UPDATE` on the job row, explicit `ROLLBACK` paths, exit handlers. |
| **SQL Concept 2: Views** | `vw_job_listings`, `vw_recruiter_pipeline`, `vw_candidate_applications`, `vw_top_demanded_skills`, `vw_job_match_leaderboard` | Dashboards with joins, aggregation and `RANK()` window function. |
| **SQL Concept 3: Triggers** | State machine, role/subtype integrity, insert defaults, audit trail, outbox | Business rules enforced in the database; audit metadata read from the row (pool-safe, no session variables). |
| **SQL Concept 4: Stored Procedures & Functions** | `sp_submit_application`, `sp_update_application_status`, `sp_get_recruiter_analytics`, `fn_match_score` | OUT parameters, authorization checks, multiple result sets, weighted scoring function. |
| **SQL Concept 5: Indexing** | Composite B-tree indexes + `EXPLAIN ANALYZE` in `05_performance.sql` | e.g. job feed 0.16 ms with index vs 16 ms full scan + filesort on 50k rows. |
| **SQL Concept 6: Full-text search** | `ft_jobs_text`, `ft_candidates_profile` | Natural-language and boolean `MATCH ... AGAINST` (Section H). |
| **MySQL → Neo4j sync** | `graph_sync_outbox` + outbox triggers | Transactional outbox; events written in the same transaction as the change (eventual consistency). |
| **NoSQL Advanced Concept: Graph Traversal** | `neo4j/schema_and_seed.cql` | 2-hop related skill expansion, weighted candidate ranking, missing skill-gap analysis, and network referral paths. |

---

## 🚀 Execution Instructions

### 0. Start the databases (Docker — recommended)
```bash
cp .env.example .env          # edit the passwords
docker compose up -d          # MySQL runs 01_schema.sql + 02_seed_data.sql automatically on first start
docker compose ps             # wait until both services show "healthy"

# Run the demo/test queries inside the container
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t < /scripts/03_queries_and_tests.sql'
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t < /scripts/04_alter_demo.sql'
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t < /scripts/05_performance.sql'
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t < /scripts/06_tests.sql'   # expect: ALL TESTS PASSED

# Reset everything (re-runs init scripts)
docker compose down -v && docker compose up -d
```

### 1. MySQL Execution (without Docker)
You can run these scripts using **MySQL Workbench**, **phpMyAdmin**, or the **MySQL CLI**:

```bash
# Log in to MySQL (from the project directory)
mysql -u root -p

# 1. Run schema DDL (creates database, tables, triggers, procedures, views)
source mysql/01_schema.sql;

# 2. Populate realistic seed data
source mysql/02_seed_data.sql;

# 3. Test verification queries
source mysql/03_queries_and_tests.sql;
```

### 2. Neo4j Execution
You can run this using **Neo4j Desktop**, **Neo4j Browser** (usually at `http://localhost:7474`), or **cypher-shell**:

1. Open **Neo4j Browser**.
2. Copy and paste the contents of [`neo4j/schema_and_seed.cql`](neo4j/schema_and_seed.cql).
3. Execute the statements to create constraints, populate graph nodes and relationships.
4. Run each of the 4 demo Cypher queries in Section 7 to see graph visualization of skill matching and referrals.
