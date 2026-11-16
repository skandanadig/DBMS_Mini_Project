"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { api, formatDate, formatSalary } from "@/lib/api-client";
import type { JobListResponse, SkillOption } from "@/lib/contracts";
import { EmptyState, Loading, PageHeader, SkillChips } from "./display";

const SORTS = [
  { value: "", label: "Best first" },
  { value: "relevance", label: "Relevance (search)" },
  { value: "match", label: "My match score" },
  { value: "newest", label: "Newest" },
  { value: "salary", label: "Highest salary" },
];

const selectCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export function JobBoard({ isCandidate }: { isCandidate: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [result, setResult] = useState<JobListResponse | null>(null);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const qs = sp.toString();

  useEffect(() => {
    api<SkillOption[]>("/api/skills").then(setSkills).catch(() => setSkills([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api<JobListResponse>(`/api/jobs?${qs}`)
      .then((r) => !cancelled && setResult(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [qs]);

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (!("page" in next)) params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    update(Object.fromEntries(["q", "location", "type", "minSalary", "skillId", "sort"].map((k) => [k, String(f.get(k) ?? "")])));
  }

  const page = result?.page ?? 1;
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title="Job board"
        subtitle="Full-text search over job titles and descriptions (MySQL FULLTEXT) with filters."
      />

      <form onSubmit={onSearch} key={qs} className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-6">
        <label className="md:col-span-2">
          <span className="sr-only">Search</span>
          <input
            name="q"
            defaultValue={sp.get("q") ?? ""}
            placeholder="Search e.g. kubernetes, react, payments"
            className={selectCls}
          />
        </label>
        <select name="location" defaultValue={sp.get("location") ?? ""} className={selectCls} aria-label="Location">
          <option value="">Any location</option>
          {result?.facets.locations.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <select name="type" defaultValue={sp.get("type") ?? ""} className={selectCls} aria-label="Employment type">
          <option value="">Any type</option>
          {result?.facets.employmentTypes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select name="skillId" defaultValue={sp.get("skillId") ?? ""} className={selectCls} aria-label="Required skill">
          <option value="">Any skill</option>
          {skills.map((s) => (
            <option key={s.skillId} value={s.skillId}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="minSalary" defaultValue={sp.get("minSalary") ?? ""} className={selectCls} aria-label="Minimum salary">
          <option value="">Any salary</option>
          {[1_000_000, 1_500_000, 2_000_000, 3_000_000].map((v) => (
            <option key={v} value={v}>
              Pays up to ₹{v / 100_000} L or more
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sp.get("sort") ?? ""} className={`${selectCls} md:col-span-2`} aria-label="Sort">
          {SORTS.filter((s) => isCandidate || s.value !== "match").map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="flex gap-2 md:col-span-4 md:justify-end">
          <Button type="button" variant="secondary" onClick={() => router.push(pathname)}>
            Clear
          </Button>
          <Button type="submit">Search</Button>
        </div>
      </form>

      {error && <Alert>{error}</Alert>}
      {!result && !error && <Loading />}
      {result && result.data.length === 0 && (
        <EmptyState title="No open jobs match these filters.">Try fewer filters or a shorter search term.</EmptyState>
      )}

      {result && result.data.length > 0 && (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {result.total} open job{result.total === 1 ? "" : "s"}
          </p>
          <ul className="space-y-3">
            {result.data.map((j) => (
              <li key={j.jobId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-500">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/jobs/${j.jobId}`} className="text-lg font-semibold text-slate-900 hover:text-brand-700">
                      {j.title}
                    </Link>
                    <p className="text-sm text-slate-600">
                      {j.companyName} · {j.location} · {j.employmentType}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{formatSalary(j.salaryMin, j.salaryMax)}</p>
                  </div>
                  <div className="text-right text-sm">
                    {j.matchScore !== undefined && (
                      <p>
                        <span className="text-2xl font-bold tabular-nums text-brand-700">{j.matchScore.toFixed(0)}%</span>
                        <span className="block text-xs text-slate-500">your match</span>
                      </p>
                    )}
                    {j.relevance !== undefined && <p className="text-xs text-slate-500">relevance {j.relevance.toFixed(2)}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <SkillChips skills={j.skills} />
                  <p className="text-xs text-slate-500">
                    Posted {formatDate(j.postedDate)} · {j.applicantCount} applicant{j.applicantCount === 1 ? "" : "s"}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pagination">
              <Button variant="secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                Previous
              </Button>
              <span className="text-sm text-slate-600">
                Page {page} of {pages}
              </span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
                Next
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
