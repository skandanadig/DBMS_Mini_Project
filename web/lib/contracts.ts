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

// ---- Recruiter features (Member A, Phase 6) --------------------------------
/**
 * Mirrors trg_validate_status_transition (MySQL is the enforcer; the UI only
 * uses this to offer valid next steps).
 */
export const NEXT_STATUSES: Record<ApplicationStatus, ApplicationStatus[]> = {
  APPLIED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["INTERVIEW_SCHEDULED", "REJECTED"],
  INTERVIEW_SCHEDULED: ["OFFERED", "REJECTED"],
  OFFERED: [],
  REJECTED: [],
};

export const JobSkillInput = z.object({
  skillId: PositiveId,
  requiredLevel: ProficiencyLevel,
  mandatory: z.boolean(),
});

/**
 * Create/update a posting. Business ranges (salary_max >= salary_min >= 0,
 * title >= 3 chars, archived is terminal) are enforced by MySQL CHECK
 * constraints and triggers - zod only bounds types and sizes.
 */
export const JobInput = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(5000),
  location: z.string().trim().min(1).max(100),
  employmentType: EmploymentType,
  salaryMin: z.coerce.number().finite(),
  salaryMax: z.coerce.number().finite(),
  status: JobStatus.optional(),
  skills: z
    .array(JobSkillInput)
    .max(20)
    .refine((s) => new Set(s.map((x) => x.skillId)).size === s.length, "Each skill can be listed only once."),
});
export type JobInput = z.infer<typeof JobInput>;

export interface RecruiterDashboard {
  company: { companyId: number; companyName: string };
  kpis: { openJobs: number; totalApplicants: number; inReview: number; interviews: number; offers: number; avgMatchScore: number };
  funnel: Array<{ stage: ApplicationStatus; count: number }>;
  pipeline: Array<{
    jobId: number;
    jobTitle: string;
    jobStatus: JobStatus;
    postedDate: string;
    daysOpen: number;
    totalApplicants: number;
    avgMatchScore: number;
    underReview: number;
    interviews: number;
    offers: number;
    rejected: number;
    offerRatePct: number | null;
  }>;
  hardToFillSkills: Array<{ jobId: number; jobTitle: string; skill: string; requiredLevel: ProficiencyLevel; qualifiedCandidates: number }>;
}

export interface Applicant {
  applicationId: number;
  candidateId: number;
  name: string;
  email: string;
  location: string | null;
  experienceYears: number;
  status: ApplicationStatus;
  appliedDate: string;
  scoreAtApply: number;
  currentScore: number;
  sqlRank: number; // RANK() among applicants by current fn_match_score
  resumeUrl: string | null;
  nextStatuses: ApplicationStatus[];
}

export interface RankingRow {
  candidateId: number;
  name: string;
  experienceYears: number;
  sqlScore: number;
  sqlRank: number;
  graphScore: number | null;
  graphRank: number | null;
  rankChange: number | null; // + = graph ranks this candidate higher
  hasApplied: boolean;
}

export interface ApplicantsResponse {
  job: { jobId: number; title: string; status: JobStatus };
  applicants: Applicant[];
  ranking: {
    graphAvailable: boolean;
    rows: RankingRow[]; // union of the SQL top-N and graph top-N talent pool
    topN: number;
    overlap: number; // candidates in both top-N lists
  };
}

export const StatusUpdateInput = z.object({
  status: ApplicationStatus,
  remarks: z.string().trim().max(255).optional(),
});
export type StatusUpdateInput = z.infer<typeof StatusUpdateInput>;

// ---- Admin features (Member B, Phase 7) -------------------------------------
/**
 * Admin-created accounts. Candidate is deliberately excluded: candidates use
 * public registration, Recruiter/Admin accounts exist ONLY via this path.
 */
export const AdminCreateUserInput = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("Recruiter"),
    name: z.string().trim().min(1).max(100),
    email: z.email("Enter a valid email address.").max(150).transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(72),
    companyId: PositiveId,
    designation: z.string().trim().min(1).max(100),
  }),
  z.object({
    role: z.literal("Admin"),
    name: z.string().trim().min(1).max(100),
    email: z.email("Enter a valid email address.").max(150).transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(72),
  }),
]);
export type AdminCreateUserInput = z.infer<typeof AdminCreateUserInput>;

export const AdminUserQuery = z.object({
  role: Role.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export interface AdminUserRow {
  userId: number;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  companyName: string | null; // recruiters
  designation: string | null; // recruiters
  activity: number; // applications (candidate) or postings (recruiter)
}

export interface Paged<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const SkillUpsertInput = z.object({
  skillName: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(50),
});
export type SkillUpsertInput = z.infer<typeof SkillUpsertInput>;

export interface AdminSkillRow extends SkillOption {
  candidates: number;
  jobs: number;
  openJobs: number;
}

export const AuditLogQuery = z.object({
  status: ApplicationStatus.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface AuditLogRow {
  logId: number;
  applicationId: number;
  jobTitle: string;
  candidateName: string;
  oldStatus: ApplicationStatus | null;
  newStatus: ApplicationStatus;
  changedBy: string | null;
  changedByRole: Role | null;
  changedAt: string;
  remarks: string | null;
}

export const OutboxStatus = z.enum(["PENDING", "DONE", "FAILED"]);
export const OutboxQuery = z.object({
  status: OutboxStatus.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface OutboxRow {
  eventId: number;
  entityType: string;
  entityId: string;
  op: "UPSERT" | "DELETE";
  status: z.infer<typeof OutboxStatus>;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
  payload: unknown;
}

export const OutboxRetryInput = z.object({
  eventIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
});

export interface OutboxSyncResponse {
  sync: { lockAcquired: boolean; applied: number; skipped: number; failed: number; remainingPending: number; blockedAt?: { eventId: number; error: string } };
  verify: { ok: boolean; mysqlEntries: number; graphEntries: number; missingInGraph: string[]; extraInGraph: string[] };
}

export interface AdminOverview {
  users: Record<Role, number>;
  jobs: Record<JobStatus, number>;
  applications: Record<ApplicationStatus, number>;
  topDemandedSkills: Array<{ skillId: number; name: string; category: string; demandingJobs: number; mandatoryIn: number }>;
  outbox: Record<z.infer<typeof OutboxStatus>, number>;
}
