import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { JobInput } from "@/lib/contracts";
import { readJson, toErrorResponse } from "@/lib/errors";
import { createJob } from "@/lib/recruiter";
import { requestGraphSync } from "@/lib/sync-trigger";

/**
 * POST /api/recruiter/jobs (Recruiter) - create a posting + required skills in
 * one transaction. The company comes from the recruiter's own profile.
 * CHECK / FK violations roll back the whole posting (422 DB_RULE).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req, ["Recruiter"]);
    const input = JobInput.parse(await readJson(req));
    const jobId = await createJob(user, input);
    requestGraphSync();
    return NextResponse.json({ jobId }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
