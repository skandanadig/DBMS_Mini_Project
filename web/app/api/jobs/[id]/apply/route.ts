import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import type { ApplyResponse } from "@/lib/contracts";
import { AppError, toErrorResponse } from "@/lib/errors";
import { parseId } from "@/lib/jobs";
import { submitApplication } from "@/lib/procedures";

/**
 * POST /api/jobs/:id/apply (Candidate, self)
 * Delegates to the ACID stored procedure sp_submit_application, which locks
 * the job row, validates resume / job status / duplicates, inserts the
 * application (triggers compute match score + audit row) and commits.
 * Business outcomes come back as status codes and are mapped to HTTP:
 *   SUCCESS 201 | DUPLICATE 409 | NOT_FOUND 404 | FAILED 422 | ERROR 500
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req, ["Candidate"]);
    const jobId = parseId((await params).id);

    const result = await submitApplication(user.userId, jobId);
    const details = { statusCode: result.statusCode };

    switch (result.statusCode) {
      case "SUCCESS":
        return NextResponse.json<ApplyResponse>(
          { applicationId: result.applicationId!, statusCode: "SUCCESS", message: result.message },
          { status: 201 },
        );
      case "DUPLICATE":
        throw new AppError("CONFLICT", result.message, details);
      case "NOT_FOUND":
        throw new AppError("NOT_FOUND", result.message, details);
      case "FAILED":
        throw new AppError("DB_RULE", result.message, details);
      default:
        console.error("[apply] sp_submit_application ERROR:", result.message);
        throw new AppError("INTERNAL", "The application could not be submitted. Please try again.", details);
    }
  } catch (e) {
    return toErrorResponse(e);
  }
}
