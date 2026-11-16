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
| [`neo4j/schema_and_seed.cql`](neo4j/schema_and_seed.cql) | Constraints/indexes; idempotent `MERGE` seed mirrored from MySQL (skills, companies, candidates, jobs, `HAS_SKILL`, `REQUIRES_SKILL`, `OFFERED_BY`) plus graph-only `RELATED_TO`, `SUBSKILL_OF`, `WORKED_AT`, `CONNECTED_TO` | Graph (NoSQL) |
| [`web/`](web/) | Next.js 16 app: API route handlers, JWT auth with RBAC in every route, MySQL pool + stored-procedure helper, Neo4j driver, Vitest integration tests | Web / API |
| [`neo4j/queries.cql`](neo4j/queries.cql) | 7 parameterised queries: skill gap, related-skill credit, graph ranking, referral path, job recommendations, supply/demand aggregation, learn-next | Graph (NoSQL) |

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
| **MySQL → Neo4j sync** | `graph_sync_outbox` + triggers, worker `web/lib/graph-sync.ts` | Transactional outbox, single worker (advisory lock), ordered and idempotent replay, poison events parked as FAILED, full rebuild/verify. See [`docs/GRAPH_SYNC.md`](docs/GRAPH_SYNC.md). |
| **NoSQL Concept 1: Graph Traversal** | `neo4j/queries.cql` Q2–Q5 | Variable-length `RELATED_TO*1..2` / `SUBSKILL_OF*1..2` traversal with path-weight products, `shortestPath` referrals, graph-enhanced ranking. |
| **NoSQL Concept 2: Aggregation** | `neo4j/queries.cql` Q6–Q7 | `COUNT {}` / `COLLECT {}` subqueries, skill supply vs demand, category roll-up. |
| **SQL vs Graph consistency** | Q3 `exactScore` vs MySQL `fn_match_score` | Identical for all 240 open-job × candidate pairs; `graphScore` adds credit for related/implied skills. |

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
With Docker (the `neo4j/` folder is mounted at `/scripts`):

```bash
# Seed the graph (idempotent - safe to re-run)
docker compose exec neo4j sh -c 'cypher-shell -u neo4j -p "$SM_NEO4J_PASSWORD" -f /scripts/schema_and_seed.cql'
# Run all demo queries
docker compose exec neo4j sh -c 'cypher-shell -u neo4j -p "$SM_NEO4J_PASSWORD" -f /scripts/queries.cql'
```

Or open **Neo4j Browser** at `http://localhost:7474` (user `neo4j`, password from `.env`), paste
[`neo4j/schema_and_seed.cql`](neo4j/schema_and_seed.cql), then run the `:param` lines and any query from
[`neo4j/queries.cql`](neo4j/queries.cql) to see the graph visualisation.

### 3. Web app (Next.js 16)

Requirements: **Node.js ≥ 22.12**, the databases running (step 0), and a real `JWT_SECRET` in the root `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # paste into .env as JWT_SECRET=...
```

```bash
cd web
npm install          # web/.npmrc sets legacy-peer-deps (works around an npm 10.9 crash on vitest's optional peers)
npm run dev          # http://localhost:3000
npm test             # Vitest integration tests against the Docker MySQL + Neo4j (42 tests)
npm run sync:graph   # apply pending MySQL changes to Neo4j, then verify both stores match
npm run sync:graph -- --watch    # keep syncing every 5 s (handy during a demo)
npm run sync:graph -- --full     # rebuild mirrored graph data from MySQL, then sync
npm run typecheck
npm run build && npm start
```

The app reads the **same root `.env`** as docker compose: there is no separate `web/.env`.
Health check: `http://localhost:3000/api/health` (200 when MySQL and Neo4j are both reachable).
Demo logins (password `Password@123`): `admin@skillmatch.io`, `sarah.j@techcorp.com` (recruiter), `rahul.sharma@gmail.com` (candidate).
