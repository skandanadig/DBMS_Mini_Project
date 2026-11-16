import type { RowDataPacket } from "mysql2/promise";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { assertRecruiterOwnsApplication } from "@/lib/authz";
import { NEXT_STATUSES, type ApplicationStatus, StatusUpdateInput } from "@/lib/contracts";
import { query } from "@/lib/db";
import { errors, readJson, toErrorResponse } from "@/lib/errors";
import { parseId } from "@/lib/jobs";
import { updateApplicationStatus } from "@/lib/procedures";

/**
 * PATCH /api/recruiter/applications/:id/status (owner recruiter)
 * Ownership is checked here AND again inside sp_update_application_status;
 * the state machine is enforced by trg_validate_status_transition (422 on an
 * invalid move). The audit trigger records remarks + who made the change.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req, ["Recruiter"]);
    const applicationId = parseId((await params).id);
    await assertRecruiterOwnsApplication(user, applicationId);
    const input = StatusUpdateInput.parse(await readJson(req));

    const rows = await updateApplicationStatus(applicationId, input.status, input.remarks || null, user.userId);
    if (rows === 0) throw errors.notFound("Application not found.");

    const [app] = await query<RowDataPacket[]>("SELECT status FROM applications WHERE application_id = ?", [applicationId]);
    const status = app.status as ApplicationStatus;
    return NextResponse.json({ applicationId, status, nextStatuses: NEXT_STATUSES[status], rowsAffected: rows });
  } catch (e) {
    return toErrorResponse(e);
  }
}
