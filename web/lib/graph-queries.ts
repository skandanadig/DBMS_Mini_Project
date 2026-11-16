import neo4j from "neo4j-driver";
import { getDriver } from "./neo4j";

/**
 * Graph queries for the app (parameterised versions of neo4j/queries.cql).
 * Scoring rule (docs/CONTRACTS.md, Phase 2 changelog):
 *   exactScore  == MySQL fn_match_score (direct HAS_SKILL only)
 *   graphScore  adds, for a required skill the candidate lacks,
 *               implied credit 0.8 (has a SUBSKILL_OF it) or
 *               related credit 0.5 x best RELATED_TO path weight (<= 2 hops)
 * The graph is eventually consistent with MySQL (docs/GRAPH_SYNC.md).
 */

const int = (n: number) => neo4j.int(n);
const optInt = (n: number | undefined | null) => (n === undefined || n === null ? null : neo4j.int(n));

async function read<T>(cypher: string, params: Record<string, unknown>): Promise<T[]> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const res = await session.executeRead((tx) => tx.run(cypher, params));
    return res.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

const SCORE_CYPHER = `
WITH {Beginner: 1, Intermediate: 2, Advanced: 3, Expert: 4} AS lvl
MATCH (j:Job)-[req:REQUIRES_SKILL]->(r:Skill)
WHERE ($jobId IS NULL OR j.id = $jobId) AND (NOT $openOnly OR j.status = 'OPEN')
MATCH (c:Candidate)
WHERE $candidateId IS NULL OR c.id = $candidateId
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
WITH j, c, w, direct, CASE WHEN implied >= related THEN implied ELSE related END AS inferred
WITH j, c,
     round(100.0 * sum(w * direct) / sum(w), 2) AS exactScore,
     round(100.0 * sum(w * CASE WHEN direct >= inferred THEN direct ELSE inferred END) / sum(w), 2) AS graphScore
OPTIONAL MATCH (j)-[:OFFERED_BY]->(co:Company)
RETURN c.id AS candidateId, c.name AS candidateName, c.experience_years AS experience,
       j.id AS jobId, j.title AS jobTitle, co.name AS company, exactScore, graphScore`;

export interface GraphScore {
  candidateId: number;
  candidateName: string;
  experience: number;
  jobId: number;
  jobTitle: string;
  company: string | null;
  exactScore: number;
  graphScore: number;
}

/** Scores for candidate x job pairs; fix either side (or both) to narrow it. */
export async function graphScores(opts: { candidateId?: number; jobId?: number; openOnly?: boolean }): Promise<GraphScore[]> {
  const rows = await read<GraphScore>(SCORE_CYPHER, {
    candidateId: optInt(opts.candidateId),
    jobId: optInt(opts.jobId),
    openOnly: opts.openOnly ?? false,
  });
  return rows.sort((a, b) => b.graphScore - a.graphScore || b.exactScore - a.exactScore || b.experience - a.experience);
}

/** Graph ranking of every candidate for one job (recruiter view, Phase 6). */
export function rankCandidatesForJob(jobId: number): Promise<GraphScore[]> {
  return graphScores({ jobId });
}

export interface RelatedSkill {
  skill: string;
  mandatory: boolean;
  impliedBySubskill: boolean;
  via: string[];
  similarity: number | null;
}

/** For each required skill the candidate lacks: closest related path (Q2). */
export async function relatedForMissingSkills(candidateId: number, jobId: number): Promise<RelatedSkill[]> {
  return read<RelatedSkill>(
    `MATCH (c:Candidate {id: $cid})
     MATCH (j:Job {id: $jid})-[req:REQUIRES_SKILL]->(need:Skill)
     WHERE NOT (c)-[:HAS_SKILL]->(need)
     OPTIONAL MATCH p = (c)-[:HAS_SKILL]->(:Skill)-[:RELATED_TO*1..2]-(need)
     WITH c, need, req, p,
          CASE WHEN p IS NULL THEN null
               ELSE reduce(x = 1.0, r IN relationships(p)[1..] | x * r.weight) END AS sim
     ORDER BY sim DESC
     WITH c, need, req, collect({via: [n IN nodes(p)[1..] | n.name], sim: sim})[0] AS best
     RETURN need.name AS skill,
            req.is_mandatory AS mandatory,
            EXISTS { (c)-[:HAS_SKILL]->(:Skill)-[:SUBSKILL_OF*1..2]->(need) } AS impliedBySubskill,
            CASE WHEN best.sim IS NULL THEN [] ELSE best.via END AS via,
            CASE WHEN best.sim IS NULL THEN null ELSE round(best.sim, 3) END AS similarity
     ORDER BY mandatory DESC, skill`,
    { cid: int(candidateId), jid: int(jobId) },
  );
}

export interface ReferralPath {
  referrer: string;
  company: string;
  degrees: number;
  chain: string[];
}

/** Shortest CONNECTED_TO chain (<= 3 hops) to someone who worked at the job's company (Q4). */
export async function referralPaths(candidateId: number, jobId: number): Promise<ReferralPath[]> {
  return read<ReferralPath>(
    `MATCH (c:Candidate {id: $cid})
     MATCH (:Job {id: $jid})-[:OFFERED_BY]->(co:Company)
     MATCH (ref:Candidate)-[:WORKED_AT]->(co)
     WHERE ref <> c
     MATCH p = shortestPath((c)-[:CONNECTED_TO*1..3]-(ref))
     RETURN ref.name AS referrer, co.name AS company, length(p) AS degrees, [n IN nodes(p) | n.name] AS chain
     ORDER BY degrees
     LIMIT 3`,
    { cid: int(candidateId), jid: int(jobId) },
  );
}

export interface LearnNext {
  skill: string;
  openJobsNeedingIt: number;
  proximity: number;
  builtOnExisting: boolean;
  priority: number;
}

/** Skills the candidate lacks, ranked by OPEN-job demand and closeness to current skills (Q7). */
export async function learnNext(candidateId: number, limit = 5): Promise<LearnNext[]> {
  return read<LearnNext>(
    `MATCH (c:Candidate {id: $cid})
     MATCH (j:Job {status: 'OPEN'})-[req:REQUIRES_SKILL]->(s:Skill)
     WHERE NOT (c)-[:HAS_SKILL]->(s)
     WITH c, s, count(DISTINCT j) AS demand
     WITH c, s, demand,
          COLLECT { MATCH (c)-[:HAS_SKILL]->(:Skill)-[r:RELATED_TO]-(s) RETURN r.weight } AS sims,
          EXISTS { (c)-[:HAS_SKILL]->(:Skill)-[:SUBSKILL_OF]->(s) } AS builtOnExisting
     WITH s, demand, builtOnExisting, reduce(m = 0.0, x IN sims | CASE WHEN x > m THEN x ELSE m END) AS proximity
     RETURN s.name AS skill, demand AS openJobsNeedingIt, proximity, builtOnExisting,
            round(demand * (1 + proximity + CASE WHEN builtOnExisting THEN 0.5 ELSE 0 END), 2) AS priority
     ORDER BY priority DESC, skill
     LIMIT $limit`,
    { cid: int(candidateId), limit: int(limit) },
  );
}
