import type { RowDataPacket } from "mysql2/promise";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import type { JobMatchResponse } from "@/lib/contracts";
import { query } from "@/lib/db";
import { errors, toErrorResponse } from "@/lib/errors";
import { graphScores, referralPaths, relatedForMissingSkills } from "@/lib/graph-queries";
import { parseId, skillBreakdown } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/:id/match (Candidate, self)
 * SQL: fn_match_score + per-skill MET / BELOW_LEVEL / MISSING breakdown (source of truth).
 * Graph: graph-enhanced score, related skills for gaps, referral paths.
 * If Neo4j is unreachable the SQL part is still returned (graphAvailable=false).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req, ["Candidate"]);
    const jobId = parseId((await params).id);

    const exists = await query<RowDataPacket[]>("SELECT 1 FROM jobs WHERE job_id = ?", [jobId]);
    if (exists.length === 0) throw errors.notFound("Job not found.");

    const sql = await skillBreakdown(user.userId, jobId);

    let graph: Pick<JobMatchResponse, "graphAvailable" | "graphScore" | "related" | "referrals"> = {
      graphAvailable: false,
      graphScore: null,
      related: [],
      referrals: [],
    };
    try {
      const [scores, related, referrals] = await Promise.all([
        graphScores({ candidateId: user.userId, jobId }),
        relatedForMissingSkills(user.userId, jobId),
        referralPaths(user.userId, jobId),
      ]);
      graph = { graphAvailable: true, graphScore: scores[0]?.graphScore ?? null, related, referrals };
    } catch (e) {
      console.warn("[match] Neo4j unavailable, returning SQL-only result:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json<JobMatchResponse>({ jobId, ...sql, ...graph });
  } catch (e) {
    return toErrorResponse(e);
  }
}
