import type { RowDataPacket } from "mysql2/promise";
import { type NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { type AuthResponse, LoginInput, type Role } from "@/lib/contracts";
import { query } from "@/lib/db";
import { errors, readJson, toErrorResponse } from "@/lib/errors";
import { setSessionCookie, signSession } from "@/lib/session";

/** POST /api/auth/login  (public) - sets the httpOnly session cookie. */
export async function POST(req: NextRequest) {
  try {
    const input = LoginInput.parse(await readJson(req));

    const rows = await query<RowDataPacket[]>(
      "SELECT user_id, name, email, password_hash, role FROM users WHERE email = ?",
      [input.email],
    );
    const row = rows[0];

    // Same message (and same bcrypt work) for unknown email and wrong password
    const ok = await verifyPassword(input.password, row ? (row.password_hash as string) : null);
    if (!row || !ok) throw errors.unauthenticated("Invalid email or password.");

    const user = { userId: row.user_id as number, name: row.name as string, role: row.role as Role };
    const res = NextResponse.json<AuthResponse>({ user: { ...user, email: row.email as string } });
    setSessionCookie(res, await signSession(user));
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
