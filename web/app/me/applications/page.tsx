"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, Loading, PageHeader, StatusBadge } from "@/components/candidate/display";
import { Alert, Card } from "@/components/ui";
import { api, formatDate } from "@/lib/api-client";
import type { CandidateApplication } from "@/lib/contracts";

export default function MyApplicationsPage() {
  const [apps, setApps] = useState<CandidateApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ data: CandidateApplication[] }>("/api/me/applications")
      .then((r) => setApps(r.data))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader
        title="My applications"
        subtitle="Status history comes from the MySQL audit trail written by triggers on every change."
      />
      {error && <Alert>{error}</Alert>}
      {!apps && !error && <Loading />}
      {apps?.length === 0 && (
        <EmptyState title="You have not applied to any jobs yet.">
          <Link href="/jobs" className="text-brand-700 hover:underline">
            Browse open jobs
          </Link>
        </EmptyState>
      )}
      <ul className="space-y-4">
        {apps?.map((a) => (
          <li key={a.applicationId}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/jobs/${a.jobId}`} className="text-lg font-semibold hover:text-brand-700">
                    {a.jobTitle}
                  </Link>
                  <p className="text-sm text-slate-600">
                    {a.companyName} · {a.jobLocation} · applied {formatDate(a.appliedDate)}
                    {a.jobStatus !== "OPEN" && <> · posting {a.jobStatus.toLowerCase()}</>}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={a.status} />
                  <p className="mt-1 text-xs text-slate-500">match at apply time: {a.matchScore.toFixed(1)}%</p>
                </div>
              </div>
              <ol className="mt-4 space-y-2 border-l-2 border-slate-200 pl-4">
                {a.timeline.map((t, i) => (
                  <li key={i} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" aria-hidden />
                    <span className="font-medium">{t.newStatus.replaceAll("_", " ").toLowerCase()}</span>
                    <span className="text-slate-500">
                      {" "}
                      · {formatDate(t.changedAt)}
                      {t.changedBy && <> · by {t.changedBy}</>}
                    </span>
                    {t.remarks && <p className="text-slate-600">{t.remarks}</p>}
                  </li>
                ))}
              </ol>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
