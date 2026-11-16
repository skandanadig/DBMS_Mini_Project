import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

/** POST /api/auth/logout - clears the session cookie (idempotent). */
export async function POST() {
  const res = new NextResponse(null, { status: 204 });
  clearSessionCookie(res);
  return res;
}
