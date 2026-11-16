import type { RowDataPacket } from "mysql2/promise";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import type { RecommendationsResponse } from "@/lib/contracts";
import { query } from "@/lib/db";
import { toErrorResponse } from "@/lib/errors";
import { graphScores, learnNext } from "@/lib/graph-queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/recommendations (Candidate, self) - Neo4j
 *   jobs:      OPEN jobs ranked by graph score, excluding jobs already applied
 *              to (applications live in MySQL only)
 *   learnNext: missing skills ranked by demand and closeness to current skills
 * Eventually consistent with MySQL; graphAvailable=false if Neo4j is down.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req, ["Candidate"]);
    const applied = await query<RowDataPacket[]>("SELECT job_id FROM applications WHERE candidate_id = ?", [user.userId]);
    const appliedIds = new Set(applied.map((r) => r.job_id as number));

    try {
      const [scores, learn] = await Promise.all([
        graphScores({ candidateId: user.userId, openOnly: true }),
        learnNext(user.userId, 5),
      ]);
      const jobs = scores
        .filter((s) => !appliedIds.has(s.jobId) && s.graphScore > 0)
        .slice(0, 6)
        .map((s) => ({ jobId: s.jobId, title: s.jobTitle, company: s.company ?? "", exactScore: s.exactScore, graphScore: s.graphScore }));
      return NextResponse.json<RecommendationsResponse>({ graphAvailable: true, jobs, learnNext: learn });
    } catch (e) {
      console.warn("[recommendations] Neo4j unavailable:", e instanceof Error ? e.message : e);
      return NextResponse.json<RecommendationsResponse>({ graphAvailable: false, jobs: [], learnNext: [] });
    }
  } catch (e) {
    return toErrorResponse(e);
  }
}
