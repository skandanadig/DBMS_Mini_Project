import type { RowDataPacket } from "mysql2/promise";
import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";

/** Every account created by the test suites uses this email domain. */
export const TEST_DOMAIN = "vitest.local";

let counter = 0;
export function testEmail(tag: string): string {
  counter += 1;
  return `${tag}.${Date.now()}.${counter}@${TEST_DOMAIN}`;
}

export function makeRequest(
  path: string,
  init: { method?: string; body?: unknown; rawBody?: string; token?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (init.body !== undefined || init.rawBody !== undefined) headers.set("content-type", "application/json");
  if (init.token) headers.set("cookie", `${SESSION_COOKIE}=${init.token}`);
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers,
    body: init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
}

/** Read the session token that a route set on its response. */
export function sessionTokenFrom(res: Response): string | undefined {
  const header = res.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return match?.[1] || undefined;
}

/** Remove users created by tests (cascades to candidates, skills, applications)
 *  and the outbox events their rows produced. */
export async function cleanupTestUsers(): Promise<void> {
  const rows = await query<RowDataPacket[]>("SELECT user_id FROM users WHERE email LIKE ?", [`%@${TEST_DOMAIN}`]);
  const ids = rows.map((r) => String(r.user_id));
  if (ids.length === 0) return;
  await query("DELETE FROM users WHERE email LIKE ?", [`%@${TEST_DOMAIN}`]);
  await query(
    `DELETE FROM graph_sync_outbox
      WHERE (entity_type = 'CANDIDATE' AND entity_id IN (?))
         OR (entity_type = 'CANDIDATE_SKILL' AND SUBSTRING_INDEX(entity_id, ':', 1) IN (?))`,
    [ids, ids],
  );
}
