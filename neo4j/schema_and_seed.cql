// =============================================================================
// SKILLMATCH: Intelligent Job and Skill Matching Platform
// Database: Neo4j 5.x (Cypher 5)
// File: schema_and_seed.cql
// Description: Graph constraints/indexes and seed data.
//
// DATA OWNERSHIP (see docs/CONTRACTS.md section 5)
//   * Mirrored from MySQL (MySQL is the source of truth):
//       (:Skill) (:Company) (:Candidate) (:Job)
//       [:HAS_SKILL] [:REQUIRES_SKILL] [:OFFERED_BY]
//     The values below were exported from mysql/02_seed_data.sql, so the
//     graph starts in sync. Later changes arrive through the MySQL outbox
//     (graph_sync_outbox) and are applied with the same idempotent MERGEs.
//   * Graph-only (curated ontology / social data that has no MySQL table):
//       [:RELATED_TO {weight}]  [:SUBSKILL_OF]  [:WORKED_AT]  [:CONNECTED_TO]
//
// WHY THE REWRITE: the previous script used `--` comments (invalid Cypher)
// and re-used variables (s1, cand5, j1 ...) across `;`-separated statements.
// Variables do not survive between statements, so `(s1)` in a later CREATE
// silently created NEW empty, unlabeled nodes. Every statement here is
// self-contained: it MATCHes the nodes it needs by id, and MERGE makes the
// whole script idempotent (safe to run any number of times).
//
// Run:
//   docker compose exec neo4j sh -c 'cypher-shell -u neo4j -p "$SM_NEO4J_PASSWORD" -f /scripts/schema_and_seed.cql'
// =============================================================================

// -----------------------------------------------------------------------------
// 1. CONSTRAINTS & INDEXES
// -----------------------------------------------------------------------------
CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS FOR (c:Candidate) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT job_id_unique IF NOT EXISTS FOR (j:Job) REQUIRE j.id IS UNIQUE;
CREATE CONSTRAINT skill_id_unique IF NOT EXISTS FOR (s:Skill) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT skill_name_unique IF NOT EXISTS FOR (s:Skill) REQUIRE s.name IS UNIQUE;
CREATE CONSTRAINT company_id_unique IF NOT EXISTS FOR (cp:Company) REQUIRE cp.id IS UNIQUE;

CREATE INDEX skill_category_idx IF NOT EXISTS FOR (s:Skill) ON (s.category);
CREATE INDEX job_status_idx IF NOT EXISTS FOR (j:Job) ON (j.status);
CREATE INDEX candidate_location_idx IF NOT EXISTS FOR (c:Candidate) ON (c.location);

// -----------------------------------------------------------------------------
// 2. CLEAN SLATE (demo convenience - removes every node and relationship)
// -----------------------------------------------------------------------------
MATCH (n) DETACH DELETE n;

// =============================================================================
// 3. MIRRORED FROM MYSQL
// =============================================================================

// ---- Skills (skills table) --------------------------------------------------
UNWIND [
  {id: 1, name: 'JavaScript', category: 'Languages'},
  {id: 2, name: 'TypeScript', category: 'Languages'},
  {id: 3, name: 'Python', category: 'Languages'},
  {id: 4, name: 'React', category: 'Frontend'},
  {id: 5, name: 'Next.js', category: 'Frontend'},
  {id: 6, name: 'Node.js', category: 'Backend'},
  {id: 7, name: 'Express.js', category: 'Backend'},
  {id: 8, name: 'FastAPI', category: 'Backend'},
  {id: 9, name: 'MySQL', category: 'Database'},
  {id: 10, name: 'PostgreSQL', category: 'Database'},
  {id: 11, name: 'Neo4j', category: 'Database'},
  {id: 12, name: 'Docker', category: 'DevOps'},
  {id: 13, name: 'Kubernetes', category: 'DevOps'},
  {id: 14, name: 'AWS', category: 'Cloud'},
  {id: 15, name: 'GraphQL', category: 'API/Backend'},
  {id: 16, name: 'Tailwind CSS', category: 'Frontend'},
  {id: 17, name: 'Java', category: 'Languages'},
  {id: 18, name: 'Spring Boot', category: 'Backend'},
  {id: 19, name: 'Go', category: 'Languages'},
  {id: 20, name: 'Redis', category: 'Database'},
  {id: 21, name: 'MongoDB', category: 'Database'},
  {id: 22, name: 'Terraform', category: 'DevOps'},
  {id: 23, name: 'PyTorch', category: 'AI/ML'},
  {id: 24, name: 'Machine Learning', category: 'AI/ML'},
  {id: 25, name: 'Pandas', category: 'Data'},
  {id: 26, name: 'Apache Kafka', category: 'Data Engineering'}
] AS row
MERGE (s:Skill {id: row.id})
SET s.name = row.name, s.category = row.category;

// ---- Companies (companies table) --------------------------------------------
UNWIND [
  {id: 1, name: 'TechCorp Solutions', industry: 'Enterprise Software', location: 'Bengaluru, India'},
  {id: 2, name: 'CloudScale Networks', industry: 'Cloud & DevOps', location: 'Hyderabad, India'},
  {id: 3, name: 'FinTech Global', industry: 'Financial Technology', location: 'Mumbai, India'},
  {id: 4, name: 'DataNest Analytics', industry: 'Data & AI', location: 'Pune, India'},
  {id: 5, name: 'ShopSphere', industry: 'E-commerce', location: 'Bengaluru, India'},
  {id: 6, name: 'MediCore Health Systems', industry: 'HealthTech', location: 'Chennai, India'}
] AS row
MERGE (co:Company {id: row.id})
SET co.name = row.name, co.industry = row.industry, co.location = row.location;

// ---- Candidates (candidates + users.name) -----------------------------------
UNWIND [
  {id: 5, name: 'Rahul Sharma', location: 'Bengaluru, India', experience_years: 4.5},
  {id: 6, name: 'Ananya Sen', location: 'Bengaluru, India', experience_years: 2.0},
  {id: 7, name: 'David Chen', location: 'Hyderabad, India', experience_years: 6.0},
  {id: 8, name: 'Neha Patel', location: 'Pune, India', experience_years: 3.0},
  {id: 9, name: 'Vikram Malhotra', location: 'Delhi, India', experience_years: 5.0},
  {id: 10, name: 'Fatima Al-Mansoor', location: 'Remote', experience_years: 1.5},
  {id: 14, name: 'Karthik Reddy', location: 'Hyderabad, India', experience_years: 5.0},
  {id: 15, name: 'Sneha Iyer', location: 'Bengaluru, India', experience_years: 3.0},
  {id: 16, name: 'Arjun Mehta', location: 'Pune, India', experience_years: 4.0},
  {id: 17, name: 'Divya Krishnan', location: 'Chennai, India', experience_years: 1.0},
  {id: 18, name: 'Rohan Gupta', location: 'Delhi, India', experience_years: 4.0},
  {id: 19, name: 'Meera Joshi', location: 'Remote', experience_years: 3.0},
  {id: 20, name: 'Siddharth Rao', location: 'Bengaluru, India', experience_years: 7.0},
  {id: 21, name: 'Aisha Khan', location: 'Mumbai, India', experience_years: 2.5},
  {id: 22, name: 'Nikhil Verma', location: 'Bengaluru, India', experience_years: 8.0},
  {id: 23, name: 'Pooja Desai', location: 'Pune, India', experience_years: 0.0},
  {id: 24, name: 'Imran Sheikh', location: 'Hyderabad, India', experience_years: 4.0},
  {id: 25, name: 'Lakshmi Menon', location: 'Chennai, India', experience_years: 6.0},
  {id: 26, name: 'Varun Bhat', location: 'Remote', experience_years: 1.5},
  {id: 27, name: 'Kavya Pillai', location: 'Mumbai, India', experience_years: 3.0}
] AS row
MERGE (c:Candidate {id: row.id})
SET c.name = row.name, c.location = row.location, c.experience_years = row.experience_years;

// ---- Jobs (jobs; company derived via recruiters -> companies) ---------------
UNWIND [
  {id: 1, title: 'Senior Full Stack Engineer', location: 'Bengaluru, India', status: 'OPEN', company_id: 1},
  {id: 2, title: 'Frontend UI/UX Specialist', location: 'Bengaluru, India', status: 'OPEN', company_id: 1},
  {id: 3, title: 'Principal Cloud & DevOps Architect', location: 'Hyderabad, India', status: 'OPEN', company_id: 2},
  {id: 4, title: 'Graph Data Engineer', location: 'Mumbai, India', status: 'OPEN', company_id: 3},
  {id: 5, title: 'Legacy PHP Maintenance Engineer', location: 'Remote', status: 'CLOSED', company_id: 2},
  {id: 6, title: 'Java Backend Engineer (Payments)', location: 'Mumbai, India', status: 'OPEN', company_id: 3},
  {id: 7, title: 'Machine Learning Engineer', location: 'Pune, India', status: 'OPEN', company_id: 4},
  {id: 8, title: 'Data Engineer (Streaming)', location: 'Pune, India', status: 'OPEN', company_id: 4},
  {id: 9, title: 'MERN Stack Developer', location: 'Bengaluru, India', status: 'OPEN', company_id: 5},
  {id: 10, title: 'Site Reliability Engineer', location: 'Bengaluru, India', status: 'OPEN', company_id: 5},
  {id: 11, title: 'Backend Engineer - Python/FastAPI', location: 'Chennai, India', status: 'OPEN', company_id: 6},
  {id: 12, title: 'Junior Data Analyst Internship', location: 'Chennai, India', status: 'OPEN', company_id: 6},
  {id: 13, title: 'Next.js Platform Engineer (Contract)', location: 'Remote', status: 'OPEN', company_id: 1},
  {id: 14, title: 'Cloud Support Associate', location: 'Hyderabad, India', status: 'CLOSED', company_id: 2},
  {id: 15, title: 'Go Microservices Developer', location: 'Mumbai, India', status: 'ARCHIVED', company_id: 3}
] AS row
MERGE (j:Job {id: row.id})
SET j.title = row.title, j.location = row.location, j.status = row.status
WITH j, row
MATCH (co:Company {id: row.company_id})
MERGE (j)-[:OFFERED_BY]->(co);

// ---- HAS_SKILL (candidate_skills): [candidate_id, skill_id, proficiency, years]
UNWIND [
  [5, 1, 'Expert', 4.5], [5, 2, 'Advanced', 3.0], [5, 4, 'Expert', 4.0], [5, 5, 'Advanced', 2.5], [5, 6, 'Advanced', 3.5], [5, 9, 'Intermediate', 3.0], [5, 16, 'Expert', 3.0],
  [6, 3, 'Advanced', 2.0], [6, 8, 'Intermediate', 1.5], [6, 9, 'Intermediate', 2.0], [6, 10, 'Beginner', 1.0],
  [7, 3, 'Intermediate', 3.0], [7, 12, 'Expert', 6.0], [7, 13, 'Expert', 5.0], [7, 14, 'Expert', 6.0],
  [8, 3, 'Advanced', 3.0], [8, 9, 'Expert', 3.5], [8, 10, 'Advanced', 3.0], [8, 11, 'Advanced', 2.0],
  [9, 1, 'Expert', 5.0], [9, 2, 'Expert', 4.0], [9, 4, 'Expert', 5.0], [9, 5, 'Expert', 3.5], [9, 16, 'Expert', 4.0],
  [10, 3, 'Intermediate', 1.5], [10, 23, 'Beginner', 0.5], [10, 24, 'Intermediate', 1.0], [10, 25, 'Intermediate', 1.5],
  [14, 9, 'Advanced', 4.0], [14, 12, 'Intermediate', 2.0], [14, 17, 'Expert', 5.0], [14, 18, 'Advanced', 4.0], [14, 26, 'Intermediate', 2.0],
  [15, 3, 'Expert', 3.0], [15, 14, 'Beginner', 0.5], [15, 23, 'Advanced', 2.5], [15, 24, 'Advanced', 3.0], [15, 25, 'Expert', 3.0],
  [16, 12, 'Advanced', 4.0], [16, 13, 'Advanced', 3.0], [16, 14, 'Intermediate', 2.0], [16, 19, 'Advanced', 3.0], [16, 22, 'Intermediate', 1.5],
  [17, 1, 'Intermediate', 1.0], [17, 4, 'Intermediate', 1.0], [17, 6, 'Intermediate', 1.0], [17, 7, 'Beginner', 0.5], [17, 21, 'Intermediate', 1.0],
  [18, 3, 'Advanced', 4.0], [18, 10, 'Advanced', 4.0], [18, 14, 'Intermediate', 2.0], [18, 25, 'Advanced', 3.0], [18, 26, 'Advanced', 3.0],
  [19, 2, 'Advanced', 3.0], [19, 4, 'Advanced', 3.0], [19, 5, 'Intermediate', 1.5], [19, 15, 'Intermediate', 2.0], [19, 16, 'Advanced', 2.5],
  [20, 12, 'Expert', 7.0], [20, 13, 'Expert', 6.0], [20, 14, 'Advanced', 6.0], [20, 19, 'Intermediate', 2.0], [20, 22, 'Expert', 5.0],
  [21, 3, 'Advanced', 2.5], [21, 8, 'Advanced', 2.0], [21, 10, 'Intermediate', 2.0], [21, 12, 'Beginner', 0.5], [21, 20, 'Intermediate', 1.5],
  [22, 9, 'Advanced', 6.0], [22, 17, 'Expert', 8.0], [22, 18, 'Expert', 7.0], [22, 20, 'Advanced', 4.0], [22, 26, 'Advanced', 4.0],
  [23, 3, 'Beginner', 0.5], [23, 9, 'Beginner', 0.5],
  [24, 2, 'Advanced', 3.0], [24, 4, 'Intermediate', 2.0], [24, 6, 'Advanced', 4.0], [24, 7, 'Advanced', 3.5], [24, 21, 'Advanced', 3.0],
  [25, 3, 'Expert', 6.0], [25, 9, 'Intermediate', 3.0], [25, 23, 'Intermediate', 2.0], [25, 24, 'Expert', 5.0], [25, 25, 'Expert', 6.0],
  [26, 3, 'Intermediate', 1.5], [26, 12, 'Intermediate', 1.5], [26, 14, 'Beginner', 1.0], [26, 22, 'Beginner', 0.5],
  [27, 3, 'Advanced', 3.0], [27, 9, 'Advanced', 3.0], [27, 10, 'Intermediate', 2.0], [27, 11, 'Advanced', 2.5], [27, 15, 'Beginner', 0.5]
] AS row
MATCH (c:Candidate {id: row[0]})
MATCH (s:Skill {id: row[1]})
MERGE (c)-[h:HAS_SKILL]->(s)
SET h.proficiency = row[2], h.years = row[3];

// ---- REQUIRES_SKILL (job_skills): [job_id, skill_id, required_level, is_mandatory]
UNWIND [
  [1, 2, 'Advanced', true], [1, 4, 'Advanced', true], [1, 5, 'Intermediate', true], [1, 6, 'Intermediate', true], [1, 9, 'Intermediate', false], [1, 12, 'Beginner', false],
  [2, 1, 'Advanced', true], [2, 4, 'Expert', true], [2, 5, 'Advanced', true], [2, 16, 'Expert', true],
  [3, 3, 'Intermediate', false], [3, 12, 'Expert', true], [3, 13, 'Expert', true], [3, 14, 'Expert', true],
  [4, 3, 'Advanced', true], [4, 9, 'Advanced', true], [4, 10, 'Intermediate', false], [4, 11, 'Advanced', true],
  [5, 9, 'Intermediate', false],
  [6, 9, 'Intermediate', false], [6, 17, 'Advanced', true], [6, 18, 'Advanced', true], [6, 20, 'Intermediate', false], [6, 26, 'Intermediate', true],
  [7, 3, 'Advanced', true], [7, 14, 'Beginner', false], [7, 23, 'Advanced', true], [7, 24, 'Advanced', true], [7, 25, 'Intermediate', false],
  [8, 3, 'Advanced', true], [8, 10, 'Intermediate', true], [8, 14, 'Intermediate', false], [8, 25, 'Intermediate', false], [8, 26, 'Advanced', true],
  [9, 1, 'Intermediate', true], [9, 4, 'Intermediate', true], [9, 6, 'Intermediate', true], [9, 7, 'Beginner', false], [9, 21, 'Intermediate', true],
  [10, 12, 'Advanced', true], [10, 13, 'Advanced', true], [10, 14, 'Intermediate', true], [10, 19, 'Intermediate', false], [10, 22, 'Advanced', true],
  [11, 3, 'Advanced', true], [11, 8, 'Intermediate', true], [11, 10, 'Intermediate', true], [11, 12, 'Beginner', false], [11, 20, 'Beginner', false],
  [12, 3, 'Beginner', true], [12, 9, 'Beginner', true], [12, 25, 'Beginner', true],
  [13, 2, 'Advanced', true], [13, 5, 'Advanced', true], [13, 15, 'Intermediate', false], [13, 16, 'Intermediate', false],
  [14, 3, 'Beginner', false], [14, 12, 'Beginner', true], [14, 14, 'Intermediate', true],
  [15, 12, 'Intermediate', true], [15, 13, 'Intermediate', false], [15, 19, 'Advanced', true], [15, 20, 'Intermediate', false]
] AS row
MATCH (j:Job {id: row[0]})
MATCH (s:Skill {id: row[1]})
MERGE (j)-[r:REQUIRES_SKILL]->(s)
SET r.required_level = row[2], r.is_mandatory = row[3];

// =============================================================================
// 4. GRAPH-ONLY DATA (no MySQL equivalent)
// =============================================================================

// ---- Skill similarity: RELATED_TO {weight 0..1} ------------------------------
// Stored once per pair and treated as UNDIRECTED by the queries
// (pattern `-[:RELATED_TO]-`): similarity is symmetric.
UNWIND [
  ['JavaScript', 'TypeScript', 0.95],
  ['React', 'Next.js', 0.90],
  ['React', 'Tailwind CSS', 0.60],
  ['React', 'GraphQL', 0.60],
  ['Node.js', 'Express.js', 0.95],
  ['Node.js', 'GraphQL', 0.70],
  ['Node.js', 'MongoDB', 0.60],
  ['Express.js', 'MongoDB', 0.70],
  ['Python', 'FastAPI', 0.85],
  ['Python', 'Pandas', 0.85],
  ['FastAPI', 'PostgreSQL', 0.60],
  ['MySQL', 'PostgreSQL', 0.85],
  ['MySQL', 'Neo4j', 0.50],
  ['PostgreSQL', 'Neo4j', 0.50],
  ['Redis', 'MongoDB', 0.50],
  ['Docker', 'Kubernetes', 0.90],
  ['Kubernetes', 'AWS', 0.70],
  ['Kubernetes', 'Terraform', 0.75],
  ['AWS', 'Terraform', 0.80],
  ['Go', 'Kubernetes', 0.60],
  ['Java', 'Go', 0.50],
  ['Java', 'Spring Boot', 0.90],
  ['Spring Boot', 'Apache Kafka', 0.70],
  ['Java', 'Apache Kafka', 0.60],
  ['Apache Kafka', 'PostgreSQL', 0.55],
  ['PyTorch', 'Machine Learning', 0.95],
  ['Machine Learning', 'Pandas', 0.75]
] AS row
MATCH (a:Skill {name: row[0]})
MATCH (b:Skill {name: row[1]})
MERGE (a)-[r:RELATED_TO]->(b)
SET r.weight = row[2];

// ---- Skill hierarchy: (child)-[:SUBSKILL_OF]->(parent) -----------------------
// Knowing a child implies working knowledge of its parent
// (e.g. a Next.js developer necessarily knows React and JavaScript).
UNWIND [
  ['Next.js', 'React'],
  ['React', 'JavaScript'],
  ['TypeScript', 'JavaScript'],
  ['Node.js', 'JavaScript'],
  ['Express.js', 'Node.js'],
  ['Spring Boot', 'Java'],
  ['FastAPI', 'Python'],
  ['Pandas', 'Python'],
  ['PyTorch', 'Python'],
  ['PyTorch', 'Machine Learning']
] AS row
MATCH (child:Skill {name: row[0]})
MATCH (parent:Skill {name: row[1]})
MERGE (child)-[:SUBSKILL_OF]->(parent);

// ---- Employment history: WORKED_AT -------------------------------------------
UNWIND [
  [5, 1, 2021], [7, 2, 2019], [20, 2, 2018], [22, 3, 2017],
  [14, 3, 2020], [15, 4, 2022], [24, 5, 2021], [25, 6, 2019]
] AS row
MATCH (c:Candidate {id: row[0]})
MATCH (co:Company {id: row[1]})
MERGE (c)-[w:WORKED_AT]->(co)
SET w.since = row[2];

// ---- Professional network: CONNECTED_TO (treated as undirected) -------------
UNWIND [
  [5, 6], [5, 9], [6, 21], [6, 23], [8, 7], [8, 18], [8, 27],
  [9, 19], [19, 17], [17, 24], [16, 20], [16, 26], [10, 15],
  [21, 25], [14, 22]
] AS row
MATCH (a:Candidate {id: row[0]})
MATCH (b:Candidate {id: row[1]})
MERGE (a)-[:CONNECTED_TO]->(b);

// -----------------------------------------------------------------------------
// 5. SUMMARY (expected: 20 Candidate, 15 Job, 26 Skill, 6 Company;
//    94 HAS_SKILL, 63 REQUIRES_SKILL, 15 OFFERED_BY, 0 unlabeled nodes)
// -----------------------------------------------------------------------------
MATCH (n) RETURN labels(n)[0] AS label, count(*) AS nodes ORDER BY label;
MATCH ()-[r]->() RETURN type(r) AS relationship, count(*) AS total ORDER BY relationship;
MATCH (n) WHERE size(labels(n)) = 0 RETURN count(n) AS unlabeled_nodes;
