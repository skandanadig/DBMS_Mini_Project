import type { ReactNode } from "react";
import type { ApplicationStatus, JobSkill, SkillState } from "@/lib/contracts";

/** Small presentational pieces shared by the candidate pages (Member B). */

function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

export function ScoreBar({ label, value, tone = "brand" }: { label: string; value: number | null; tone?: "brand" | "violet" }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums">{value === null ? "—" : `${value.toFixed(1)}%`}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div
          className={cx("h-2 rounded-full transition-all", tone === "brand" ? "bg-brand-500" : "bg-violet-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<ApplicationStatus, string> = {
  APPLIED: "bg-slate-100 text-slate-700",
  UNDER_REVIEW: "bg-amber-50 text-amber-800",
  INTERVIEW_SCHEDULED: "bg-brand-50 text-brand-700",
  OFFERED: "bg-green-50 text-green-800",
  REJECTED: "bg-red-50 text-red-700",
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>
      {status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

const STATE_STYLE: Record<SkillState, string> = {
  MET: "border-green-200 bg-green-50 text-green-800",
  BELOW_LEVEL: "border-amber-200 bg-amber-50 text-amber-800",
  MISSING: "border-red-200 bg-red-50 text-red-700",
};

export function SkillChips({ skills, states }: { skills: JobSkill[]; states?: Record<number, SkillState> }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {skills.map((s) => (
        <li
          key={s.skillId}
          title={`${s.requiredLevel}${s.mandatory ? " · mandatory" : " · optional"}`}
          className={cx(
            "rounded-md border px-2 py-0.5 text-xs",
            states?.[s.skillId] ? STATE_STYLE[states[s.skillId]] : "border-slate-200 bg-white text-slate-700",
            !s.mandatory && "border-dashed",
          )}
        >
          {s.name}
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="py-8 text-center text-sm text-slate-500" role="status">
      {label}
    </p>
  );
}
