import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import type { Role, SessionUser } from "./contracts";
import { query } from "./db";
import { errors } from "./errors";
import { SESSION_COOKIE, verifySession } from "./session";

/**
 * Authentication for route handlers. EVERY protected API route calls
 * requireAuth() itself - proxy.ts only redirects UI pages and is not a
 * security boundary.
 */

const BCRYPT_COST = 10;
// Hash of a random string: compared against when the email is unknown so
// "no such user" and "wrong password" take the same time.
const DUMMY_HASH = "$2a$10$lJVhJKVTbz0HhMhX8V5Tv.rtIHxBrlXa/U2cB8NZNmjEI53cTQFr6";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  const ok = await bcrypt.compare(plain, hash ?? DUMMY_HASH);
  return hash !== null && ok;
}

/**
 * Verify the session cookie, re-check the user in MySQL (deleted users and
 * stale roles are rejected), then enforce the allowed roles.
 * @throws AppError UNAUTHENTICATED (401) or FORBIDDEN (403)
 */
export async function requireAuth(req: NextRequest, roles?: readonly Role[]): Promise<SessionUser> {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw errors.unauthenticated();

  const rows = await query<RowDataPacket[]>("SELECT role, name FROM users WHERE user_id = ?", [session.userId]);
  if (rows.length === 0 || rows[0].role !== session.role) {
    throw errors.unauthenticated("Your session is no longer valid. Please sign in again.");
  }

  if (roles && !roles.includes(session.role)) {
    throw errors.forbidden(`This action requires the ${roles.join(" or ")} role.`);
  }
  return { ...session, name: rows[0].name as string };
}
