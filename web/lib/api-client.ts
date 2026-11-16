import type { ApiErrorBody, ErrorCode } from "./errors";

/** Browser-side helper for calling our /api routes (Member B). */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | "NETWORK",
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "INTERNAL", err?.message ?? `Request failed (${res.status}).`, err?.details);
  }
  return body as T;
}

/** Map of field -> message from a VALIDATION error's details. */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiError && e.code === "VALIDATION" && Array.isArray(e.details)) {
    for (const d of e.details as Array<{ path: string; message: string }>) out[d.path] ??= d.message;
  }
  return out;
}

export function formatSalary(min: number, max: number): string {
  const lakh = (n: number) => `${(n / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`;
  return `₹${lakh(min)} – ${lakh(max)} / yr`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
