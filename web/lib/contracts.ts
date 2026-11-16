import { z } from "zod";

/**
 * Shared request/response contracts (docs/CONTRACTS.md).
 * Owned by Member A; Member B adds schemas for candidate/admin routes here.
 */

// ---- Enums mirrored from MySQL ---------------------------------------------
export const Role = z.enum(["Candidate", "Recruiter", "Admin"]);
export type Role = z.infer<typeof Role>;

export const ApplicationStatus = z.enum(["APPLIED", "UNDER_REVIEW", "INTERVIEW_SCHEDULED", "OFFERED", "REJECTED"]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

export const ProficiencyLevel = z.enum(["Beginner", "Intermediate", "Advanced", "Expert"]);
export type ProficiencyLevel = z.infer<typeof ProficiencyLevel>;

export const JobStatus = z.enum(["OPEN", "CLOSED", "ARCHIVED"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const EmploymentType = z.enum(["Full-time", "Part-time", "Contract", "Internship", "Remote"]);
export type EmploymentType = z.infer<typeof EmploymentType>;

// ---- Session ---------------------------------------------------------------
/** The authenticated user as seen by route handlers (decoded from the JWT). */
export interface SessionUser {
  userId: number;
  role: Role;
  name: string;
}

// ---- Auth ------------------------------------------------------------------
const Email = z
  .email("Enter a valid email address.")
  .max(150)
  .transform((v) => v.toLowerCase());

export const RegisterInput = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  email: Email,
  // bcrypt only uses the first 72 bytes of a password
  password: z.string().min(8, "Password must be at least 8 characters.").max(72),
  // Accepted only so an attempt to self-assign a privileged role can be
  // rejected explicitly with 403; the account is always created as Candidate.
  role: z.string().optional(),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: Email,
  password: z.string().min(1, "Password is required.").max(72),
});
export type LoginInput = z.infer<typeof LoginInput>;

export interface PublicUser {
  userId: number;
  name: string;
  email: string;
  role: Role;
}

export interface AuthResponse {
  user: PublicUser;
}

export interface MeResponse {
  user: PublicUser & { createdAt: string };
  profile:
    | { kind: "Candidate"; location: string | null; experienceYears: number; headline: string | null; hasResume: boolean }
    | { kind: "Recruiter"; companyId: number; companyName: string; designation: string }
    | { kind: "Admin" };
}
