"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { api, fieldErrors } from "@/lib/api-client";
import type { EmploymentType, JobDetail, JobInput, JobStatus, ProficiencyLevel, SkillOption } from "@/lib/contracts";

const TYPES: EmploymentType[] = ["Full-time", "Part-time", "Contract", "Internship", "Remote"];
const LEVELS: ProficiencyLevel[] = ["Beginner", "Intermediate", "Advanced", "Expert"];
const STATUSES: JobStatus[] = ["OPEN", "CLOSED", "ARCHIVED"];
const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

type SkillRow = JobInput["skills"][number];

export function JobForm({ job }: { job?: JobDetail }) {
  const router = useRouter();
  const [options, setOptions] = useState<SkillOption[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>(
    job?.skills.map((s) => ({ skillId: s.skillId, requiredLevel: s.requiredLevel, mandatory: s.mandatory })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SkillOption[]>("/api/skills").then(setOptions).catch(() => undefined);
  }, []);

  const unused = options.filter((o) => !skills.some((s) => s.skillId === o.skillId));
  const setRow = (i: number, patch: Partial<SkillRow>) => setSkills((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrs({});
    const f = new FormData(e.currentTarget);
    const body = {
      title: String(f.get("title")),
      description: String(f.get("description")),
      location: String(f.get("location")),
      employmentType: f.get("employmentType"),
      salaryMin: Number(f.get("salaryMin")),
      salaryMax: Number(f.get("salaryMax")),
      ...(job ? { status: f.get("status") } : {}),
      skills,
    };
    try {
      if (job) {
        await api(`/api/recruiter/jobs/${job.jobId}`, { method: "PUT", json: body });
        router.push("/recruiter");
      } else {
        const r = await api<{ jobId: number }>("/api/recruiter/jobs", { method: "POST", json: body });
        router.push(`/recruiter/jobs/${r.jobId}/applicants`);
      }
      router.refresh();
    } catch (err) {
      // DB_RULE messages name the CHECK constraint / trigger that rejected the data
      setErrs(fieldErrors(err));
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <Field id="title" name="title" label="Job title" className="sm:col-span-2" defaultValue={job?.title} required error={errs.title} />
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Description</span>
          <textarea name="description" rows={5} required defaultValue={job?.description} className={inputCls} />
          {errs.description && <span className="text-xs text-red-600">{errs.description}</span>}
        </label>
        <Field id="location" name="location" label="Location" defaultValue={job?.location} required error={errs.location} />
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Employment type</span>
          <select name="employmentType" defaultValue={job?.employmentType ?? "Full-time"} className={inputCls}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <Field id="salaryMin" name="salaryMin" type="number" step="10000" label="Salary min (₹ / year)" defaultValue={job?.salaryMin ?? 1000000} error={errs.salaryMin} />
        <Field id="salaryMax" name="salaryMax" type="number" step="10000" label="Salary max (₹ / year)" defaultValue={job?.salaryMax ?? 1500000} error={errs.salaryMax} />
        {job && (
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <select name="status" defaultValue={job.status} className={inputCls}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase()}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">Archived postings cannot be reopened (MySQL trigger).</span>
          </label>
        )}

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">Required skills</legend>
          {skills.length === 0 && <p className="text-sm text-slate-500">No skills yet - candidates cannot be matched without them.</p>}
          {skills.map((s, i) => (
            <div key={s.skillId} className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Skill"
                value={s.skillId}
                onChange={(e) => setRow(i, { skillId: Number(e.target.value) })}
                className={`${inputCls} w-auto min-w-40 flex-1`}
              >
                {options
                  .filter((o) => o.skillId === s.skillId || !skills.some((x) => x.skillId === o.skillId))
                  .map((o) => (
                    <option key={o.skillId} value={o.skillId}>
                      {o.name}
                    </option>
                  ))}
              </select>
              <select aria-label="Required level" value={s.requiredLevel} onChange={(e) => setRow(i, { requiredLevel: e.target.value as ProficiencyLevel })} className={`${inputCls} w-auto`}>
                {LEVELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={s.mandatory} onChange={(e) => setRow(i, { mandatory: e.target.checked })} />
                Mandatory
              </label>
              <Button type="button" variant="ghost" onClick={() => setSkills((rows) => rows.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={unused.length === 0}
            onClick={() => setSkills((rows) => [...rows, { skillId: unused[0].skillId, requiredLevel: "Intermediate", mandatory: true }])}
          >
            Add skill
          </Button>
        </fieldset>

        <div className="flex gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : job ? "Save changes" : "Publish posting"}
          </Button>
          <Link href="/recruiter" className="rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
