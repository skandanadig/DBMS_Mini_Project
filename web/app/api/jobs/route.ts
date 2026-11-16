import { type NextRequest, NextResponse } from "next/server";
import { JobSearchQuery } from "@/lib/contracts";
import { toErrorResponse } from "@/lib/errors";
import { optionalCandidate, searchJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs (public)
 * ?q= (FULLTEXT) &location= &type= &minSalary= &skillId= &sort=relevance|newest|salary|match &page= &pageSize=
 * A signed-in candidate also gets their MySQL fn_match_score per job.
 */
export async function GET(req: NextRequest) {
  try {
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const params = JobSearchQuery.parse(raw);
    const candidate = await optionalCandidate(req);
    return NextResponse.json(await searchJobs(params, candidate?.userId ?? null));
  } catch (e) {
    return toErrorResponse(e);
  }
}
