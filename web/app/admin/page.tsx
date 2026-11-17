"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loading, PageHeader } from "@/components/candidate/display";
import { Alert, Card } from "@/components/ui";
import { api } from "@/lib/api-client";
import type { AdminOverview } from "@/lib/contracts";

function Tile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value.toLocaleString("en-IN")}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AdminOverview>("/api/admin/overview")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const maxDemand = Math.max(1, ...data.topDemandedSkills.map((s) => s.demandingJobs));

  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" subtitle="Live counts from MySQL; skill demand from the vw_top_demanded_skills view." />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Key figures">
        <Tile label="Users" value={sum(data.users)} sub={`${data.users.Candidate} candidates · ${data.users.Recruiter} recruiters · ${data.users.Admin} admins`} />
        <Tile label="Open jobs" value={data.jobs.OPEN} sub={`${data.jobs.CLOSED} closed · ${data.jobs.ARCHIVED} archived`} />
        <Tile label="Applications" value={sum(data.applications)} sub={`${data.applications.OFFERED} offered · ${data.applications.REJECTED} rejected`} />
        <Tile label="Graph sync backlog" value={data.outbox.PENDING} sub={`${data.outbox.FAILED} failed · ${data.outbox.DONE} done`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 font-semibold">Most demanded skills</h2>
          <p className="mb-4 text-xs text-slate-500">Open jobs requiring each skill (mandatory count in brackets).</p>
          <ul className="space-y-2.5" aria-label="Most demanded skills">
            {data.topDemandedSkills.map((s) => (
              <li
                key={s.skillId}
                className="grid grid-cols-[8.5rem_1fr] items-center gap-3 text-sm"
                title={`${s.name}: required by ${s.demandingJobs} open jobs, mandatory in ${s.mandatoryIn}`}
              >
                <span className="truncate text-slate-700">{s.name}</span>
                <span className="flex items-center gap-2">
                  <span className="h-3 rounded-r bg-series-1" style={{ width: `${(s.demandingJobs / maxDemand) * 100}%` }} />
                  <span className="whitespace-nowrap font-medium">
                    {s.demandingJobs} <span className="font-normal text-slate-500">({s.mandatoryIn})</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Applications by status</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {Object.entries(data.applications).map(([status, n]) => (
                <tr key={status}>
                  <td className="py-1.5 capitalize text-slate-700">{status.replaceAll("_", " ").toLowerCase()}</td>
                  <td className="py-1.5 text-right font-medium">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-sm">
            <Link href="/admin/audit" className="text-brand-700 hover:underline">
              Open the audit log
            </Link>{" "}
            ·{" "}
            <Link href="/admin/outbox" className="text-brand-700 hover:underline">
              Graph sync monitor
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
