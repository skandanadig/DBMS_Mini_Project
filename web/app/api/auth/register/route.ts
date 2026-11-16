import type { ResultSetHeader } from "mysql2/promise";
import { type NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { type AuthResponse, RegisterInput, type SessionUser } from "@/lib/contracts";
import { withTransaction } from "@/lib/db";
import { errors, readJson, toErrorResponse } from "@/lib/errors";
import { setSessionCookie, signSession } from "@/lib/session";

/**
 * POST /api/auth/register  (public)
 * Creates a Candidate account only. Any attempt to self-register as
 * Recruiter/Admin is rejected with 403; those accounts are created by an
 * Admin via /api/admin/users. The users + candidates rows are inserted in
 * one transaction (MySQL triggers verify the subtype matches the role).
 */
export async function POST(req: NextRequest) {
  try {
    const input = RegisterInput.parse(await readJson(req));

    if (input.role !== undefined && input.role !== "Candidate") {
      throw errors.forbidden(
        "Public registration can only create Candidate accounts. Recruiter and Admin accounts are created by an administrator.",
      );
    }

    const passwordHash = await hashPassword(input.password);

    const userId = await withTransaction(async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'Candidate')",
        [input.name, input.email, passwordHash],
      );
      await conn.query("INSERT INTO candidates (candidate_id) VALUES (?)", [result.insertId]);
      return result.insertId;
    });

    const user: SessionUser = { userId, role: "Candidate", name: input.name };
    const res = NextResponse.json<AuthResponse>(
      { user: { userId, name: input.name, email: input.email, role: "Candidate" } },
      { status: 201 },
    );
    setSessionCookie(res, await signSession(user));
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
