import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Error codes shared by every API route (docs/CONTRACTS.md section 2). */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DB_RULE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DB_RULE: 422,
  INTERNAL: 500,
};

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const errors = {
  validation: (message: string, details?: unknown) => new AppError("VALIDATION", message, details),
  unauthenticated: (message = "Authentication required.") => new AppError("UNAUTHENTICATED", message),
  forbidden: (message = "You do not have permission to perform this action.") => new AppError("FORBIDDEN", message),
  notFound: (message = "Not found.") => new AppError("NOT_FOUND", message),
  conflict: (message: string) => new AppError("CONFLICT", message),
};

/**
 * MySQL errors that mean "a database rule rejected this request":
 * 1644 SIGNAL '45000' (triggers / procedures), 3819 CHECK constraint,
 * 1451 / 1452 foreign keys, 1265 invalid ENUM (strict mode),
 * 1048 NOT NULL, 1406 value too long.
 */
const DB_RULE_ERRNOS = new Set([1644, 3819, 1451, 1452, 1265, 1048, 1406]);

interface MysqlError {
  errno: number;
  sqlState?: string;
  sqlMessage?: string;
}

function isMysqlError(e: unknown): e is MysqlError {
  return typeof e === "object" && e !== null && typeof (e as MysqlError).errno === "number" && "sqlState" in e;
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;

  if (e instanceof ZodError) {
    return new AppError(
      "VALIDATION",
      "Request validation failed.",
      e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }

  if (isMysqlError(e)) {
    if (e.errno === 1062) {
      // Map the violated UNIQUE constraint (named in mysql/01_schema.sql) to a readable message
      const byConstraint: Array<[string, string]> = [
        ["uk_users_email", "An account with this email already exists."],
        ["uk_skill_name", "A skill with this name already exists."],
        ["uk_company_name", "A company with this name already exists."],
        ["uk_job_candidate", "This candidate has already applied for this job."],
      ];
      const message =
        byConstraint.find(([key]) => e.sqlMessage?.includes(key))?.[1] ?? "A record with the same unique value already exists.";
      return new AppError("CONFLICT", message);
    }
    if (DB_RULE_ERRNOS.has(e.errno)) {
      return new AppError("DB_RULE", e.sqlMessage ?? "Rejected by a database rule.", { errno: e.errno });
    }
  }

  return new AppError("INTERNAL", "Something went wrong. Please try again.");
}

/** Convert any thrown value into the standard JSON error response. */
export function toErrorResponse(e: unknown): NextResponse<ApiErrorBody> {
  const err = toAppError(e);
  if (err.code === "INTERNAL") console.error("[api] unexpected error:", e);
  return NextResponse.json(
    { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
    { status: err.status },
  );
}

/** Parse a JSON request body, turning malformed JSON into a VALIDATION error. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw errors.validation("Request body must be valid JSON.");
  }
}
