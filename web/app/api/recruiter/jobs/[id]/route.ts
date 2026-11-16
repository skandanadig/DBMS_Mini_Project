import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { assertRecruiterOwnsJob } from "@/lib/authz";
import { JobInput } from "@/lib/contracts";
import { readJson, toErrorResponse } from "@/lib/errors";
import { getJobDetail, parseId } from "@/lib/jobs";
import { updateJob } from "@/lib/recruiter";
import { requestGraphSync } from "@/lib/sync-trigger";

export const dynamic = "force-dynamic";

/** GET /api/recruiter/jobs/:id (owner) - posting incl. skills, any status, for the edit form. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req, ["Recruiter"]);
    const jobId = parseId((await params).id);
    await assertRecruiterOwnsJob(user, jobId);
    return NextResponse.json(await getJobDetail(jobId, null));
  } catch (e) {
    return toErrorResponse(e);
  }
}

/**
 * PUT /api/recruiter/jobs/:id (owner) - edit fields, status and the skill set
 * in one transaction. Lifecycle rules (ARCHIVED is terminal) are enforced by
 * trg_job_status_rules in MySQL.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req, ["Recruiter"]);
    const jobId = parseId((await params).id);
    await assertRecruiterOwnsJob(user, jobId);
    const input = JobInput.parse(await readJson(req));
    await updateJob(jobId, input);
    requestGraphSync();
    return NextResponse.json(await getJobDetail(jobId, null));
  } catch (e) {
    return toErrorResponse(e);
  }
}
