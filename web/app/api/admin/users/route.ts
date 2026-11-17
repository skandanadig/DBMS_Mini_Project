import { type NextRequest, NextResponse } from "next/server";
import { createPrivilegedUser, listUsers } from "@/lib/admin";
import { requireAuth } from "@/lib/auth";
import { AdminCreateUserInput, AdminUserQuery } from "@/lib/contracts";
import { readJson, toErrorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

const queryObject = (req: NextRequest) => Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));

/** GET /api/admin/users?role=&q=&page=&pageSize= (Admin) */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    return NextResponse.json(await listUsers(AdminUserQuery.parse(queryObject(req))));
  } catch (e) {
    return toErrorResponse(e);
  }
}

/**
 * POST /api/admin/users (Admin) - create a Recruiter (with company) or Admin.
 * This is the only way privileged accounts are created; public registration
 * always produces Candidates. Unknown company -> 422 (FK), duplicate email -> 409.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req, ["Admin"]);
    const input = AdminCreateUserInput.parse(await readJson(req));
    return NextResponse.json({ user: await createPrivilegedUser(input) }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
