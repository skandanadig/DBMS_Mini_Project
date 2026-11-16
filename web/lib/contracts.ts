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

// ---- Candidate features (Member B, Phase 5) -------------------------------
const PositiveId = z.coerce.number().int().positive();

export const JobSort = z.enum(["relevance", "newest", "salary", "match"]);
export type JobSort = z.infer<typeof JobSort>;

/** GET /api/jobs query string */
export const JobSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  location: z.string().trim().max(100).optional(),
  type: EmploymentType.optional(),
  minSalary: z.coerce.number().min(0).max(100_000_000).optional(),
  skillId: PositiveId.optional(),
  sort: JobSort.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
export type JobSearchQuery = z.infer<typeof JobSearchQuery>;

export interface JobSkill {
  skillId: number;
  name: string;
  requiredLevel: ProficiencyLevel;
  mandatory: boolean;
}

export interface JobSummary {
  jobId: number;
  title: string;
  companyName: string;
  industry: string;
  location: string;
  employmentType: EmploymentType;
  salaryMin: number;
  salaryMax: number;
  postedDate: string;
  applicantCount: number;
  skills: JobSkill[];
  relevance?: number;
  /** Only for a signed-in candidate: MySQL fn_match_score */
  matchScore?: number;
}

export interface JobListResponse {
  data: JobSummary[];
  page: number;
  pageSize: number;
  total: number;
  facets: { locations: string[]; employmentTypes: string[] };
}

export interface JobDetail extends JobSummary {
  description: string;
  status: JobStatus;
  recruiterName: string;
  /** Only for a signed-in candidate */
  application?: { applicationId: number; status: ApplicationStatus; appliedDate: string } | null;
}

export type SkillState = "MET" | "BELOW_LEVEL" | "MISSING";

export interface JobMatchResponse {
  jobId: number;
  exactScore: number; // MySQL fn_match_score
  skills: Array<JobSkill & { candidateLevel: ProficiencyLevel | null; state: SkillState }>;
  graphAvailable: boolean;
  graphScore: number | null; // Neo4j, adds related/implied credit
  related: Array<{ skill: string; mandatory: boolean; impliedBySubskill: boolean; via: string[]; similarity: number | null }>;
  referrals: Array<{ referrer: string; company: string; degrees: number; chain: string[] }>;
}

export interface ApplyResponse {
  applicationId: number;
  statusCode: "SUCCESS";
  message: string;
}

export interface CandidateApplication {
  applicationId: number;
  jobId: number;
  jobTitle: string;
  companyName: string;
  jobLocation: string;
  jobStatus: JobStatus;
  status: ApplicationStatus;
  matchScore: number;
  appliedDate: string;
  timeline: Array<{ oldStatus: ApplicationStatus | null; newStatus: ApplicationStatus; changedAt: string; changedBy: string | null; remarks: string | null }>;
}

export const ProfileInput = z.object({
  name: z.string().trim().min(1).max(100),
  // Format rules (phone pattern, URL, experience range) are enforced by MySQL
  // CHECK constraints; here we only bound sizes so the DB can do its job.
  phone: z.string().trim().max(20).nullable().optional(),
  location: z.string().trim().max(100).nullable().optional(),
  experienceYears: z.coerce.number().min(-100).max(999),
  resumeUrl: z.string().trim().max(500).nullable().optional(),
  headline: z.string().trim().max(150).nullable().optional(),
  bio: z.string().trim().max(5000).nullable().optional(),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export interface CandidateProfile {
  candidateId: number;
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  experienceYears: number;
  resumeUrl: string | null;
  headline: string | null;
  bio: string | null;
}

export const CandidateSkillInput = z.object({
  skillId: PositiveId,
  proficiency: ProficiencyLevel,
  years: z.coerce.number().min(0).max(60),
});
export type CandidateSkillInput = z.infer<typeof CandidateSkillInput>;

export interface CandidateSkill {
  skillId: number;
  name: string;
  category: string;
  proficiency: ProficiencyLevel;
  years: number;
}

export interface SkillOption {
  skillId: number;
  name: string;
  category: string;
}

export interface RecommendationsResponse {
  graphAvailable: boolean;
  jobs: Array<{ jobId: number; title: string; company: string; exactScore: number; graphScore: number }>;
  learnNext: Array<{ skill: string; openJobsNeedingIt: number; proximity: number; builtOnExisting: boolean; priority: number }>;
}
