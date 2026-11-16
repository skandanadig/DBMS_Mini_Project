import { type NextRequest, NextResponse } from "next/server";
import type { Role } from "@/lib/contracts";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Next.js 16 Proxy (formerly middleware.ts).
 * UX ONLY: sends signed-out users to /login and wrong-role users home
 * before a protected PAGE renders. It is NOT the security boundary - every
 * API route enforces RBAC itself via requireAuth() + ownership checks.
 */
const PAGE_RULES: ReadonlyArray<{ prefix: string; roles: readonly Role[] }> = [
  { prefix: "/me", roles: ["Candidate"] },
  { prefix: "/recruiter", roles: ["Recruiter"] },
  { prefix: "/admin", roles: ["Admin"] },
];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const rule = PAGE_RULES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (!rule) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if (!rule.roles.includes(session.role)) {
    return NextResponse.redirect(new URL("/?denied=1", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/me/:path*", "/recruiter/:path*", "/admin/:path*"],
};
