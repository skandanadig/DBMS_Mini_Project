import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { assertRecruiterOwnsJob } from "@/lib/authz";
import type { ApplicantsResponse } from "@/lib/contracts";
import { toErrorResponse } from "@/lib/errors";
import { parseId } from "@/lib/jobs";
import { getApplicants } from "@/lib/recruiter";

export const dynamic = "force-dynamic";

/**
 * GET /api/recruiter/jobs/:id/applicants (owner)
 *  applicants: ranked with RANK() over the current fn_match_score
 *  ranking:    talent pool ranked by SQL (fn_match_score) and by Neo4j
 *              (graph score with related/implied skills), side by side
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req, ["Recruiter"]);
    const jobId = parseId((await params).id);
    await assertRecruiterOwnsJob(user, jobId);
    return NextResponse.json<ApplicantsResponse>(await getApplicants(jobId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
