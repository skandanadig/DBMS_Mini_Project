import { jwtVerify, SignJWT } from "jose";
import type { NextResponse } from "next/server";
import { z } from "zod";
import { Role, type SessionUser } from "./contracts";
import { env } from "./env";

/**
 * Stateless session token (JWT, HS256) stored in an httpOnly cookie.
 * Token-only helpers - no database access - so proxy.ts can use them.
 * Route handlers must use requireAuth() in lib/auth.ts, which also
 * re-checks the user against MySQL.
 */
export const SESSION_COOKIE = "sm_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ISSUER = "skillmatch";
const AUDIENCE = "skillmatch-web";

const Claims = z.object({
  sub: z.string().regex(/^\d+$/),
  role: Role,
  name: z.string(),
});

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().JWT_SECRET);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ role: user.role, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Returns the session user, or null for a missing/invalid/expired/forged token. */
export async function verifySession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const claims = Claims.parse(payload);
    return { userId: Number(claims.sub), role: claims.role, name: claims.name };
  } catch {
    return null;
  }
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_SECONDS });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}
