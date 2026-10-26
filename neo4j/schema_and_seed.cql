// =============================================================================
// SKILLMATCH: Intelligent Job and Skill Matching Platform
// Database: Neo4j Graph Database (Cypher 5.x / 4.x)
// File: schema_and_seed.cql
// Description: Graph schema, constraints, ontology seed data, and advanced
//              graph traversal & recommendation algorithms.
// =============================================================================

// -----------------------------------------------------------------------------
// 1. UNIQUE CONSTRAINTS & INDEXES
// -----------------------------------------------------------------------------
CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS 
FOR (c:Candidate) REQUIRE c.id IS UNIQUE;

CREATE CONSTRAINT job_id_unique IF NOT EXISTS 
FOR (j:Job) REQUIRE j.id IS UNIQUE;

CREATE CONSTRAINT skill_id_unique IF NOT EXISTS 
FOR (s:Skill) REQUIRE s.id IS UNIQUE;

CREATE CONSTRAINT skill_name_unique IF NOT EXISTS 
FOR (s:Skill) REQUIRE s.name IS UNIQUE;

CREATE CONSTRAINT company_id_unique IF NOT EXISTS 
FOR (cp:Company) REQUIRE cp.id IS UNIQUE;

// -----------------------------------------------------------------------------
// 2. CLEAR EXISTING GRAPH DATA (Optional / Clean slate execution)
// -----------------------------------------------------------------------------
MATCH (n) DETACH DELETE n;

// -----------------------------------------------------------------------------
// 3. CREATE SKILL TAXONOMY & RELATIONSHIPS (Knowledge Graph)
// -----------------------------------------------------------------------------
CREATE 
  (s1:Skill {id: 1, name: 'JavaScript', category: 'Languages'}),
  (s2:Skill {id: 2, name: 'TypeScript', category: 'Languages'}),
  (s3:Skill {id: 3, name: 'Python', category: 'Languages'}),
  (s4:Skill {id: 4, name: 'React', category: 'Frontend'}),
  (s5:Skill {id: 5, name: 'Next.js', category: 'Frontend'}),
  (s6:Skill {id: 6, name: 'Node.js', category: 'Backend'}),
  (s7:Skill {id: 7, name: 'Express.js', category: 'Backend'}),
  (s8:Skill {id: 8, name: 'FastAPI', category: 'Backend'}),
  (s9:Skill {id: 9, name: 'MySQL', category: 'Database'}),
  (s10:Skill {id: 10, name: 'PostgreSQL', category: 'Database'}),
  (s11:Skill {id: 11, name: 'Neo4j', category: 'Database'}),
  (s12:Skill {id: 12, name: 'Docker', category: 'DevOps'}),
  (s13:Skill {id: 13, name: 'Kubernetes', category: 'DevOps'}),
  (s14:Skill {id: 14, name: 'AWS', category: 'Cloud'}),
  (s15:Skill {id: 15, name: 'GraphQL', category: 'API/Backend'}),
  (s16:Skill {id: 16, name: 'Tailwind CSS', category: 'Frontend'});

// Create inter-skill relationships (Taxonomy & Related Skill Graph)
CREATE 
  (s1)-[:RELATED_TO {weight: 0.95}]->(s2),
  (s2)-[:RELATED_TO {weight: 0.90}]->(s1),
  (s4)-[:RELATED_TO {weight: 0.90}]->(s5),
  (s5)-[:RELATED_TO {weight: 0.85}]->(s4),
  (s4)-[:RELATED_TO {weight: 0.80}]->(s16),
  (s6)-[:RELATED_TO {weight: 0.95}]->(s7),
  (s3)-[:RELATED_TO {weight: 0.85}]->(s8),
  (s9)-[:RELATED_TO {weight: 0.80}]->(s10),
  (s10)-[:RELATED_TO {weight: 0.80}]->(s9),
  (s9)-[:RELATED_TO {weight: 0.70}]->(s11),
  (s12)-[:RELATED_TO {weight: 0.95}]->(s13),
  (s13)-[:RELATED_TO {weight: 0.85}]->(s14),
  (s6)-[:RELATED_TO {weight: 0.75}]->(s15);

// -----------------------------------------------------------------------------
// 4. CREATE COMPANIES
// -----------------------------------------------------------------------------
CREATE 
  (c1:Company {id: 1, name: 'TechCorp Solutions', location: 'Bengaluru, India'}),
  (c2:Company {id: 2, name: 'CloudScale Networks', location: 'Hyderabad, India'}),
  (c3:Company {id: 3, name: 'FinTech Global', location: 'Mumbai, India'});

// -----------------------------------------------------------------------------
// 5. CREATE CANDIDATE NODES & CONNECT TO SKILLS
// -----------------------------------------------------------------------------
CREATE 
  (cand5:Candidate {id: 5, name: 'Rahul Sharma', location: 'Bengaluru, India', experience_years: 4.5}),
  (cand6:Candidate {id: 6, name: 'Ananya Sen', location: 'Bengaluru, India', experience_years: 2.0}),
  (cand7:Candidate {id: 7, name: 'David Chen', location: 'Hyderabad, India', experience_years: 6.0}),
  (cand8:Candidate {id: 8, name: 'Neha Patel', location: 'Pune, India', experience_years: 3.0}),
  (cand9:Candidate {id: 9, name: 'Vikram Malhotra', location: 'Delhi, India', experience_years: 5.0}),
  (cand10:Candidate {id: 10, name: 'Fatima Al-Mansoor', location: 'Remote', experience_years: 1.5});

// Candidate Skills
CREATE
  -- Rahul Sharma (Full Stack)
  (cand5)-[:HAS_SKILL {proficiency: 'Expert', years: 4.5}]->(s1),
  (cand5)-[:HAS_SKILL {proficiency: 'Advanced', years: 3.0}]->(s2),
  (cand5)-[:HAS_SKILL {proficiency: 'Expert', years: 4.0}]->(s4),
  (cand5)-[:HAS_SKILL {proficiency: 'Advanced', years: 2.5}]->(s5),
  (cand5)-[:HAS_SKILL {proficiency: 'Advanced', years: 3.5}]->(s6),
  (cand5)-[:HAS_SKILL {proficiency: 'Intermediate', years: 3.0}]->(s9),
  (cand5)-[:HAS_SKILL {proficiency: 'Expert', years: 3.0}]->(s16),

  -- Ananya Sen (Junior Backend)
  (cand6)-[:HAS_SKILL {proficiency: 'Advanced', years: 2.0}]->(s3),
  (cand6)-[:HAS_SKILL {proficiency: 'Intermediate', years: 1.5}]->(s8),
  (cand6)-[:HAS_SKILL {proficiency: 'Intermediate', years: 2.0}]->(s9),

  -- David Chen (Senior DevOps)
  (cand7)-[:HAS_SKILL {proficiency: 'Intermediate', years: 3.0}]->(s3),
  (cand7)-[:HAS_SKILL {proficiency: 'Expert', years: 6.0}]->(s12),
  (cand7)-[:HAS_SKILL {proficiency: 'Expert', years: 5.0}]->(s13),
  (cand7)-[:HAS_SKILL {proficiency: 'Expert', years: 6.0}]->(s14),

  -- Neha Patel (Data / Graph)
  (cand8)-[:HAS_SKILL {proficiency: 'Advanced', years: 3.0}]->(s3),
  (cand8)-[:HAS_SKILL {proficiency: 'Expert', years: 3.5}]->(s9),
  (cand8)-[:HAS_SKILL {proficiency: 'Advanced', years: 3.0}]->(s10),
  (cand8)-[:HAS_SKILL {proficiency: 'Advanced', years: 2.0}]->(s11),

  -- Vikram Malhotra (Frontend UI)
  (cand9)-[:HAS_SKILL {proficiency: 'Expert', years: 5.0}]->(s1),
  (cand9)-[:HAS_SKILL {proficiency: 'Expert', years: 4.0}]->(s2),
  (cand9)-[:HAS_SKILL {proficiency: 'Expert', years: 5.0}]->(s4),
  (cand9)-[:HAS_SKILL {proficiency: 'Expert', years: 3.5}]->(s5),
  (cand9)-[:HAS_SKILL {proficiency: 'Expert', years: 4.0}]->(s16);

// Candidate previous company associations & candidate networks
CREATE
  (cand5)-[:WORKED_AT]->(c1),
  (cand7)-[:WORKED_AT]->(c2),
  (cand5)-[:CONNECTED_TO]->(cand6),
  (cand5)-[:CONNECTED_TO]->(cand9),
  (cand8)-[:CONNECTED_TO]->(cand7);

// -----------------------------------------------------------------------------
// 6. CREATE JOBS & REQUIRED SKILLS
// -----------------------------------------------------------------------------
CREATE 
  (j1:Job {id: 1, title: 'Senior Full Stack Engineer', location: 'Bengaluru, India', status: 'OPEN'}),
  (j2:Job {id: 2, title: 'Frontend UI/UX Specialist', location: 'Bengaluru, India', status: 'OPEN'}),
  (j3:Job {id: 3, title: 'Principal Cloud & DevOps Architect', location: 'Hyderabad, India', status: 'OPEN'}),
  (j4:Job {id: 4, title: 'Graph Data Engineer', location: 'Mumbai, India', status: 'OPEN'});

CREATE
  -- Job 1 Links
  (j1)-[:OFFERED_BY]->(c1),
  (j1)-[:REQUIRES_SKILL {required_level: 'Advanced', is_mandatory: true}]->(s2),     // TypeScript
  (j1)-[:REQUIRES_SKILL {required_level: 'Advanced', is_mandatory: true}]->(s4),     // React
  (j1)-[:REQUIRES_SKILL {required_level: 'Intermediate', is_mandatory: true}]->(s5), // Next.js
  (j1)-[:REQUIRES_SKILL {required_level: 'Intermediate', is_mandatory: true}]->(s6), // Node.js
  (j1)-[:REQUIRES_SKILL {required_level: 'Intermediate', is_mandatory: false}]->(s9),// MySQL
  (j1)-[:REQUIRES_SKILL {required_level: 'Beginner', is_mandatory: false}]->(s12),   // Docker

  -- Job 2 Links
  (j2)-[:OFFERED_BY]->(c1),
  (j2)-[:REQUIRES_SKILL {required_level: 'Advanced', is_mandatory: true}]->(s1),     // JavaScript
  (j2)-[:REQUIRES_SKILL {required_level: 'Expert', is_mandatory: true}]->(s4),       // React
  (j2)-[:REQUIRES_SKILL {required_level: 'Advanced', is_mandatory: true}]->(s5),     // Next.js
  (j2)-[:REQUIRES_SKILL {required_level: 'Expert', is_mandatory: true}]->(s16),      // Tailwind CSS

  -- Job 3 Links
  (j3)-[:OFFERED_BY]->(c2),
  (j3)-[:REQUIRES_SKILL {required_level: 'Expert', is_mandatory: true}]->(s12),      // Docker
  (j3)-[:REQUIRES_SKILL {required_level: 'Expert', is_mandatory: true}]->(s13),      // Kubernetes
  (j3)-[:REQUIRES_SKILL {required_level: 'Expert', is_mandatory: true}]->(s14),      // AWS
  (j3)-[:REQUIRES_SKILL {required_level: 'Intermediate', is_mandatory: false}]->(s3),// Python

  -- Job 4 Links
  (j4)-[:OFFERED_BY]->(c3),
  (j4)-[:REQUIRES_SKILL {required_level: 'Advanced', is_mandatory: true}]->(s9),      // MySQL
  (j4)-[:REQUIRES_SKILL {required_level: 'Advanced', is_mandatory: true}]->(s11),     // Neo4j
  (j4)-[:REQUIRES_SKILL {required_level: 'Advanced', is_mandatory: true}]->(s3),      // Python
  (j4)-[:REQUIRES_SKILL {required_level: 'Intermediate', is_mandatory: false}]->(s10);// PostgreSQL

// =============================================================================
// 7. ADVANCED CYPHER QUERIES (PES Level 3 Project Showcase)
// =============================================================================

// -----------------------------------------------------------------------------
// QUERY 1: Skill Match & Skill-Gap Analysis for a Specific Candidate and Job
// Demonstrates: Pattern Matching, OPTIONAL MATCH, Aggregations, List Collections
// -----------------------------------------------------------------------------
// Parameters: $candidateId = 5, $jobId = 1
MATCH (c:Candidate {id: 5})
MATCH (j:Job {id: 1})-[:REQUIRES_SKILL]->(req:Skill)
OPTIONAL MATCH (c)-[h:HAS_SKILL]->(req)
WITH c, j, 
     count(req) AS totalRequired,
     count(h) AS matchedCount,
     collect(req.name) AS allRequiredSkills,
     collect(CASE WHEN h IS NOT NULL THEN req.name END) AS matchedSkills,
     collect(CASE WHEN h IS NULL THEN req.name END) AS missingSkills
RETURN 
    c.name AS candidateName,
    j.title AS jobTitle,
    totalRequired,
    matchedCount,
    round((toFloat(matchedCount) / toFloat(totalRequired)) * 100, 2) AS exactMatchPercentage,
    matchedSkills,
    missingSkills;

// -----------------------------------------------------------------------------
// QUERY 2: Graph Neighborhood Recommendation (Related Skills Expansion)
// Explores: 2-Hop graph traversal via (:Skill)-[:RELATED_TO]->(:Skill)
// If candidate doesn't have exact skill, checks if they possess adjacent skills!
// -----------------------------------------------------------------------------
MATCH (c:Candidate {id: 5})
MATCH (j:Job {id: 1})-[r:REQUIRES_SKILL]->(needed:Skill)
WHERE NOT (c)-[:HAS_SKILL]->(needed)
OPTIONAL MATCH (c)-[:HAS_SKILL]->(possessed:Skill)-[rel:RELATED_TO]->(needed)
RETURN 
    c.name AS candidate,
    needed.name AS missingRequiredSkill,
    collect(DISTINCT {possessedSkill: possessed.name, correlationWeight: rel.weight}) AS relatedSkillsFound;

// -----------------------------------------------------------------------------
// QUERY 3: Recruiter Candidate Ranking for a Job Posting
// Orders candidates based on weighted mandatory + optional skill overlaps
// -----------------------------------------------------------------------------
MATCH (j:Job {id: 1})-[r:REQUIRES_SKILL]->(s:Skill)
MATCH (c:Candidate)
OPTIONAL MATCH (c)-[h:HAS_SKILL]->(s)
WITH c, j,
     sum(CASE WHEN r.is_mandatory THEN 2.0 ELSE 1.0 END) AS totalWeight,
     sum(CASE WHEN h IS NOT NULL AND r.is_mandatory THEN 2.0 
              WHEN h IS NOT NULL AND NOT r.is_mandatory THEN 1.0 
              ELSE 0.0 END) AS candidateScore
RETURN 
    c.id AS candidateId,
    c.name AS candidateName,
    c.experience_years AS experience,
    round((candidateScore / totalWeight) * 100, 2) AS matchScorePercentage
ORDER BY matchScorePercentage DESC;

// -----------------------------------------------------------------------------
// QUERY 4: Social Referral Path (1st and 2nd Degree Connection to Hiring Company)
// Finds shortest connection path to employees who worked at the company
// -----------------------------------------------------------------------------
MATCH (c:Candidate {id: 6})
MATCH (targetCompany:Company {name: 'TechCorp Solutions'})
MATCH path = shortestPath((c)-[:CONNECTED_TO*1..3]-(referrer:Candidate)-[:WORKED_AT]->(targetCompany))
RETURN 
    c.name AS applicant,
    referrer.name AS internalReferrer,
    length(path) AS degreesOfSeparation,
    [n in nodes(path) | coalesce(n.name, n.id)] AS connectionChain;
