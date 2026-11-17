"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, Loading, PageHeader } from "@/components/candidate/display";
import { Alert, Card } from "@/components/ui";
import { api } from "@/lib/api-client";
import type { ApplicationStatus, RecruiterDashboard } from "@/lib/contracts";

const STAGE_LABEL: Record<ApplicationStatus, string> = {
  APPLIED: "Applied",
  UNDER_REVIEW: "Reached review",
  INTERVIEW_SCHEDULED: "Reached interview",
  OFFERED: "Offered",
  REJECTED: "Rejected",
};

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Ranked horizontal bars in natural stage order, one hue, direct value labels. */
function Funnel({ funnel }: { funnel: RecruiterDashboard["funnel"] }) {
  const max = Math.max(1, ...funnel.map((f) => f.count));
  return (
    <ul className="space-y-3" aria-label="Hiring funnel">
      {funnel.map((f) => {
        const pct = (f.count / max) * 100;
        const conv = funnel[0].count ? Math.round((f.count / funnel[0].count) * 100) : 0;
        return (
          <li key={f.stage} className="group grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3 text-sm" title={`${STAGE_LABEL[f.stage]}: ${f.count} (${conv}% of applicants)`}>
            <span className="text-slate-700">{STAGE_LABEL[f.stage]}</span>
            {/* Full-width track: bar length is a true proportion of the track
                (a bar sharing a flex row with its label gets shrunk unevenly). */}
            <span className="block h-3 w-full">
              <span className="block h-3 rounded-r bg-series-1 transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(pct, f.count ? 2 : 0)}%` }} />
            </span>
            <span className="whitespace-nowrap font-medium text-slate-900">
              {f.count} <span className="font-normal text-slate-500">· {conv}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function RecruiterDashboardPage() {
  const [data, setData] = useState<RecruiterDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<RecruiterDashboard>("/api/recruiter/dashboard")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const { kpis } = data;

  return (
    <div className="space-y-6">
      <PageHeader title={`${data.company.companyName} hiring`} subtitle="Your postings only. Figures come from MySQL views, the analytics stored procedure and the audit trail.">
        <Link href="/recruiter/jobs/new" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Post a job
        </Link>
      </PageHeader>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" aria-label="Key figures">
        <StatTile label="Open jobs" value={String(kpis.openJobs)} />
        <StatTile label="Applicants" value={String(kpis.totalApplicants)} />
        <StatTile label="Under review" value={String(kpis.inReview)} />
        <StatTile label="Interviews" value={String(kpis.interviews)} />
        <StatTile label="Offers" value={String(kpis.offers)} />
        <StatTile label="Avg match" value={`${kpis.avgMatchScore.toFixed(1)}%`} hint="at time of applying" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Postings</h2>
          {data.pipeline.length === 0 ? (
            <EmptyState title="No postings yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Job</th>
                    <th className="py-1 pr-3 text-right font-medium">Applicants</th>
                    <th className="py-1 pr-3 text-right font-medium">Review</th>
                    <th className="py-1 pr-3 text-right font-medium">Interview</th>
                    <th className="py-1 pr-3 text-right font-medium">Offers</th>
                    <th className="py-1 pr-3 text-right font-medium">Avg match</th>
                    <th className="py-1 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {data.pipeline.map((p) => (
                    <tr key={p.jobId}>
                      <td className="py-2 pr-3">
                        <Link href={`/recruiter/jobs/${p.jobId}/applicants`} className="font-medium hover:text-brand-700">
                          {p.jobTitle}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {p.jobStatus.toLowerCase()} · {p.daysOpen} days
                        </p>
                      </td>
                      <td className="py-2 pr-3 text-right">{p.totalApplicants}</td>
                      <td className="py-2 pr-3 text-right">{p.underReview}</td>
                      <td className="py-2 pr-3 text-right">{p.interviews}</td>
                      <td className="py-2 pr-3 text-right">{p.offers}</td>
                      <td className="py-2 pr-3 text-right">{p.avgMatchScore.toFixed(1)}%</td>
                      <td className="py-2 text-right">
                        <Link href={`/recruiter/jobs/${p.jobId}/edit`} className="text-brand-700 hover:underline">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-1 font-semibold">Hiring funnel</h2>
            <p className="mb-4 text-xs text-slate-500">Applications that ever reached each stage (from the audit trail).</p>
            <Funnel funnel={data.funnel} />
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold">Hard-to-fill skills</h2>
            <p className="mb-3 text-xs text-slate-500">Mandatory skills on your open jobs held at the required level by fewer than 3 candidates.</p>
            {data.hardToFillSkills.length === 0 ? (
              <p className="text-sm text-slate-600">None — every mandatory skill has a healthy talent pool.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.hardToFillSkills.map((s) => (
                  <li key={`${s.jobId}-${s.skill}`} className="flex justify-between gap-3">
                    <span>
                      <strong>{s.skill}</strong> <span className="text-slate-500">({s.requiredLevel}) · {s.jobTitle}</span>
                    </span>
                    <span className="whitespace-nowrap tabular-nums">{s.qualifiedCandidates} qualified</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
