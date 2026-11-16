import { cookies } from "next/headers";
import type { SessionUser } from "./contracts";
import { SESSION_COOKIE, verifySession } from "./session";

/**
 * Session for Server Components (navigation, page greetings).
 * Display only - data access still goes through API routes that call
 * requireAuth().
 */
export async function getServerSession(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}
