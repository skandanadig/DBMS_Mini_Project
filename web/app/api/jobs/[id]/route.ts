import { type NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { getJobDetail, optionalCandidate, parseId } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** GET /api/jobs/:id (public) - job detail; own match score + application for a candidate. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const jobId = parseId((await params).id);
    const candidate = await optionalCandidate(req);
    return NextResponse.json(await getJobDetail(jobId, candidate?.userId ?? null));
  } catch (e) {
    return toErrorResponse(e);
  }
}
