// =============================================================================
// SKILLMATCH: Graph queries (Neo4j 5.x / Cypher 5)
// File: queries.cql
// Description: Parameterised graph queries used by the web app and the demo.
//   Q0  Sanity checks (graph integrity)
//   Q1  Skill-gap analysis for a candidate and a job
//   Q2  Related-skill partial credit for the missing skills (multi-hop)
//   Q3  Graph-enhanced candidate ranking for a job  (compare with SQL ranking)
//   Q4  Referral path to the hiring company (shortestPath)
//   Q5  Job recommendations for a candidate
//   Q6  NoSQL aggregation: skill supply vs demand, category roll-up
//   Q7  "Learn next" skill suggestions for a candidate
//
// Scoring conventions shared with MySQL fn_match_score:
//   level: Beginner=1, Intermediate=2, Advanced=3, Expert=4
//   weight: mandatory=2, optional=1
//   direct credit = min(candidate_level / required_level, 1)
// Graph-only extras (Q3/Q5) for a required skill the candidate LACKS:
//   implied credit = 0.8 if the candidate has a skill that is SUBSKILL_OF it
//                    (Next.js -> React -> JavaScript)
//   related credit = 0.5 * best product of RELATED_TO weights over <= 2 hops
//   credit = max(direct, implied, related)
// Hence exactScore (Q3) == MySQL fn_match_score, and graphScore >= exactScore.
//
// Run all (cypher-shell supports :param):
//   docker compose exec neo4j sh -c 'cypher-shell -u neo4j -p "$SM_NEO4J_PASSWORD" -f /scripts/queries.cql'
// In Neo4j Browser (http://localhost:7474) run the :param lines first, then any query.
// =============================================================================

// Demo defaults (change freely):
//   19 Meera Joshi vs job 1 Senior Full Stack Engineer - lacks Node.js but knows GraphQL
//   23 Pooja Desai - two hops away from a TechCorp alumnus
//   17 Divya Krishnan - junior MERN developer, close to TypeScript / Next.js
:param candidateId => 19;
:param jobId => 1;
:param referralCandidateId => 23;
:param learnerId => 17;

// -----------------------------------------------------------------------------
// Q0. SANITY CHECKS - every node is labelled and every mirrored entity is linked
// -----------------------------------------------------------------------------
MATCH (n)
RETURN count(n) AS totalNodes,
       count(CASE WHEN size(labels(n)) = 0 THEN 1 END) AS unlabeledNodes,
       count(CASE WHEN n:Job AND NOT (n)-[:OFFERED_BY]->(:Company) THEN 1 END) AS jobsWithoutCompany;

// -----------------------------------------------------------------------------
// Q1. SKILL-GAP ANALYSIS for ($candidateId, $jobId)
// Pattern matching + OPTIONAL MATCH + conditional aggregation into lists
// -----------------------------------------------------------------------------
WITH {Beginner: 1, Intermediate: 2, Advanced: 3, Expert: 4} AS lvl
MATCH (c:Candidate {id: $candidateId})
MATCH (j:Job {id: $jobId})-[req:REQUIRES_SKILL]->(s:Skill)
OPTIONAL MATCH (c)-[h:HAS_SKILL]->(s)
WITH c, j, s, req, h, lvl,
     CASE WHEN h IS NULL THEN 'MISSING'
          WHEN lvl[h.proficiency] >= lvl[req.required_level] THEN 'MET'
          ELSE 'BELOW_LEVEL' END AS state,
     CASE WHEN req.is_mandatory THEN 2.0 ELSE 1.0 END AS w,
     CASE WHEN h IS NULL THEN 0.0
          WHEN toFloat(lvl[h.proficiency]) / lvl[req.required_level] > 1 THEN 1.0
          ELSE toFloat(lvl[h.proficiency]) / lvl[req.required_level] END AS credit
RETURN c.name AS candidate,
       j.title AS job,
       count(s) AS totalRequired,
       collect(CASE WHEN state = 'MET' THEN s.name END) AS met,
       collect(CASE WHEN state = 'BELOW_LEVEL'
                    THEN s.name + ' (has ' + h.proficiency + ', needs ' + req.required_level + ')' END) AS belowLevel,
       collect(CASE WHEN state = 'MISSING'
                    THEN s.name + CASE WHEN req.is_mandatory THEN ' [mandatory]' ELSE ' [optional]' END END) AS missing,
       round(100.0 * sum(w * credit) / sum(w), 2) AS exactScore;

// -----------------------------------------------------------------------------
// Q2. RELATED-SKILL PARTIAL CREDIT for the skills the candidate is missing
// Variable-length traversal (:Skill)-[:RELATED_TO*1..2]-(:Skill), path weight =
// product of edge weights; also checks the SUBSKILL_OF hierarchy.
// -----------------------------------------------------------------------------
MATCH (c:Candidate {id: $candidateId})
MATCH (j:Job {id: $jobId})-[req:REQUIRES_SKILL]->(need:Skill)
WHERE NOT (c)-[:HAS_SKILL]->(need)
OPTIONAL MATCH p = (c)-[:HAS_SKILL]->(:Skill)-[:RELATED_TO*1..2]-(need)
WITH c, need, req, p,
     CASE WHEN p IS NULL THEN null
          ELSE reduce(x = 1.0, r IN relationships(p)[1..] | x * r.weight) END AS similarity
ORDER BY similarity DESC
WITH c, need, req,
     collect(CASE WHEN p IS NOT NULL
                  THEN {via: [n IN nodes(p)[1..] | n.name], similarity: round(similarity, 3)} END)[0..3] AS bestPaths
RETURN need.name AS missingSkill,
       req.is_mandatory AS mandatory,
       EXISTS { (c)-[:HAS_SKILL]->(:Skill)-[:SUBSKILL_OF*1..2]->(need) } AS impliedBySubskill,
       bestPaths
ORDER BY mandatory DESC, missingSkill;

// -----------------------------------------------------------------------------
// Q3. GRAPH-ENHANCED CANDIDATE RANKING for $jobId
// exactScore uses only direct HAS_SKILL edges (identical to MySQL
// fn_match_score); graphScore adds implied (SUBSKILL_OF) and related
// (RELATED_TO) credit for skills the candidate does not list explicitly.
// -----------------------------------------------------------------------------
WITH {Beginner: 1, Intermediate: 2, Advanced: 3, Expert: 4} AS lvl
MATCH (j:Job {id: $jobId})-[req:REQUIRES_SKILL]->(r:Skill)
MATCH (c:Candidate)
OPTIONAL MATCH (c)-[h:HAS_SKILL]->(r)
WITH j, c, r,
     CASE WHEN req.is_mandatory THEN 2.0 ELSE 1.0 END AS w,
     CASE WHEN h IS NULL THEN 0.0
          WHEN toFloat(lvl[h.proficiency]) / lvl[req.required_level] > 1 THEN 1.0
          ELSE toFloat(lvl[h.proficiency]) / lvl[req.required_level] END AS direct
WITH j, c, w, direct,
     CASE WHEN direct = 0.0 AND EXISTS { (c)-[:HAS_SKILL]->(:Skill)-[:SUBSKILL_OF*1..2]->(r) }
          THEN 0.8 ELSE 0.0 END AS implied,
     CASE WHEN direct = 0.0
          THEN COLLECT { MATCH p = (c)-[:HAS_SKILL]->(:Skill)-[:RELATED_TO*1..2]-(r)
                         RETURN reduce(x = 1.0, rel IN relationships(p)[1..] | x * rel.weight) }
          ELSE [] END AS sims
WITH j, c, w, direct, implied,
     0.5 * reduce(m = 0.0, s IN sims | CASE WHEN s > m THEN s ELSE m END) AS related
WITH j, c, w, direct,
     CASE WHEN implied >= related THEN implied ELSE related END AS inferred
WITH j, c,
     sum(w) AS totalWeight,
     sum(w * direct) AS directWeight,
     sum(w * CASE WHEN direct >= inferred THEN direct ELSE inferred END) AS graphWeight
WITH j, c,
     round(100.0 * directWeight / totalWeight, 2) AS exactScore,
     round(100.0 * graphWeight / totalWeight, 2) AS graphScore
RETURN j.title AS job,
       c.id AS candidateId,
       c.name AS candidate,
       c.experience_years AS experience,
       exactScore,
       graphScore,
       round(graphScore - exactScore, 2) AS graphBoost
ORDER BY graphScore DESC, exactScore DESC, experience DESC
LIMIT 10;

// -----------------------------------------------------------------------------
// Q4. REFERRAL PATH: shortest chain of CONNECTED_TO links (<= 3 hops) from a
// candidate to anyone who has WORKED_AT the company offering $jobId.
// (The old query put WORKED_AT inside shortestPath, which Cypher does not
//  allow; the referrer is now matched first and the path found separately.)
// -----------------------------------------------------------------------------
MATCH (c:Candidate {id: $referralCandidateId})
MATCH (:Job {id: $jobId})-[:OFFERED_BY]->(co:Company)
MATCH (ref:Candidate)-[:WORKED_AT]->(co)
WHERE ref <> c
MATCH p = shortestPath((c)-[:CONNECTED_TO*1..3]-(ref))
RETURN c.name AS applicant,
       co.name AS company,
       ref.name AS referrer,
       length(p) AS degreesOfSeparation,
       [n IN nodes(p) | n.name] AS connectionChain
ORDER BY degreesOfSeparation
LIMIT 5;

// -----------------------------------------------------------------------------
// Q5. JOB RECOMMENDATIONS for $candidateId (OPEN jobs, same scoring as Q3)
// -----------------------------------------------------------------------------
WITH {Beginner: 1, Intermediate: 2, Advanced: 3, Expert: 4} AS lvl
MATCH (c:Candidate {id: $candidateId})
MATCH (j:Job {status: 'OPEN'})-[req:REQUIRES_SKILL]->(r:Skill)
OPTIONAL MATCH (c)-[h:HAS_SKILL]->(r)
WITH c, j, r,
     CASE WHEN req.is_mandatory THEN 2.0 ELSE 1.0 END AS w,
     CASE WHEN h IS NULL THEN 0.0
          WHEN toFloat(lvl[h.proficiency]) / lvl[req.required_level] > 1 THEN 1.0
          ELSE toFloat(lvl[h.proficiency]) / lvl[req.required_level] END AS direct
WITH c, j, w, direct,
     CASE WHEN direct = 0.0 AND EXISTS { (c)-[:HAS_SKILL]->(:Skill)-[:SUBSKILL_OF*1..2]->(r) }
          THEN 0.8 ELSE 0.0 END AS implied,
     CASE WHEN direct = 0.0
          THEN COLLECT { MATCH p = (c)-[:HAS_SKILL]->(:Skill)-[:RELATED_TO*1..2]-(r)
                         RETURN reduce(x = 1.0, rel IN relationships(p)[1..] | x * rel.weight) }
          ELSE [] END AS sims
WITH c, j, w, direct, implied,
     0.5 * reduce(m = 0.0, s IN sims | CASE WHEN s > m THEN s ELSE m END) AS related
WITH c, j, w, direct, CASE WHEN implied >= related THEN implied ELSE related END AS inferred
WITH c, j,
     round(100.0 * sum(w * direct) / sum(w), 2) AS exactScore,
     round(100.0 * sum(w * CASE WHEN direct >= inferred THEN direct ELSE inferred END) / sum(w), 2) AS graphScore
MATCH (j)-[:OFFERED_BY]->(co:Company)
RETURN c.name AS candidate, j.id AS jobId, j.title AS job, co.name AS company, exactScore, graphScore
ORDER BY graphScore DESC, exactScore DESC
LIMIT 5;

// -----------------------------------------------------------------------------
// Q6a. NoSQL AGGREGATION: skill supply (candidates) vs demand (OPEN jobs)
// COUNT {} subqueries + degree of each skill in the similarity graph
// -----------------------------------------------------------------------------
MATCH (s:Skill)
WITH s,
     COUNT { (s)<-[:HAS_SKILL]-(:Candidate) } AS supply,
     COUNT { (s)<-[:REQUIRES_SKILL]-(:Job {status: 'OPEN'}) } AS demand,
     COUNT { (s)-[:RELATED_TO]-(:Skill) } AS relatedDegree
WHERE demand > 0
RETURN s.category AS category,
       s.name AS skill,
       supply,
       demand,
       CASE WHEN supply = 0 THEN null ELSE round(toFloat(demand) / supply, 2) END AS demandPerCandidate,
       relatedDegree
ORDER BY demandPerCandidate DESC, demand DESC
LIMIT 10;

// -----------------------------------------------------------------------------
// Q6b. NoSQL AGGREGATION: demand roll-up per skill category
// -----------------------------------------------------------------------------
MATCH (j:Job {status: 'OPEN'})-[req:REQUIRES_SKILL]->(s:Skill)
RETURN s.category AS category,
       count(*) AS requirements,
       sum(CASE WHEN req.is_mandatory THEN 1 ELSE 0 END) AS mandatory,
       count(DISTINCT j) AS jobs,
       collect(DISTINCT s.name) AS skills
ORDER BY requirements DESC;

// -----------------------------------------------------------------------------
// Q7. "LEARN NEXT": skills $learnerId lacks, ranked by OPEN-job demand and by
// how close they are (RELATED_TO weight) to skills the candidate already has
// -----------------------------------------------------------------------------
MATCH (c:Candidate {id: $learnerId})
MATCH (j:Job {status: 'OPEN'})-[req:REQUIRES_SKILL]->(s:Skill)
WHERE NOT (c)-[:HAS_SKILL]->(s)
WITH c, s,
     count(DISTINCT j) AS demand,
     sum(CASE WHEN req.is_mandatory THEN 1 ELSE 0 END) AS mandatoryIn
WITH c, s, demand, mandatoryIn,
     COLLECT { MATCH (c)-[:HAS_SKILL]->(:Skill)-[r:RELATED_TO]-(s) RETURN r.weight } AS sims,
     EXISTS { (c)-[:HAS_SKILL]->(:Skill)-[:SUBSKILL_OF]->(s) } AS builtOnExisting
WITH c, s, demand, mandatoryIn, builtOnExisting,
     reduce(m = 0.0, x IN sims | CASE WHEN x > m THEN x ELSE m END) AS proximity
RETURN c.name AS candidate,
       s.name AS learnNext,
       demand AS openJobsNeedingIt,
       mandatoryIn,
       proximity,
       builtOnExisting,
       round(demand * (1 + proximity + CASE WHEN builtOnExisting THEN 0.5 ELSE 0 END), 2) AS priority
ORDER BY priority DESC, learnNext
LIMIT 5;
