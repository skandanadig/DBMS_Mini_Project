"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, Loading, PageHeader, ScoreBar } from "@/components/candidate/display";
import { Alert, Card } from "@/components/ui";
import { api } from "@/lib/api-client";
import type { RecommendationsResponse } from "@/lib/contracts";

export default function RecommendationsPage() {
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<RecommendationsResponse>("/api/me/recommendations")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader
        title="Recommended for you"
        subtitle="Computed in Neo4j: direct skills plus related (RELATED_TO) and implied (SUBSKILL_OF) skills. Updated shortly after your profile changes."
      />
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Loading />}
      {data && !data.graphAvailable && <Alert tone="info">The skill graph is unavailable right now. Please try again shortly.</Alert>}

      {data?.graphAvailable && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <h2 className="mb-3 font-semibold">Jobs</h2>
            {data.jobs.length === 0 ? (
              <EmptyState title="No new matches.">Add more skills to widen your matches.</EmptyState>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {data.jobs.map((j) => (
                  <li key={j.jobId}>
                    <Card className="h-full">
                      <Link href={`/jobs/${j.jobId}`} className="font-semibold hover:text-brand-700">
                        {j.title}
                      </Link>
                      <p className="mb-3 text-sm text-slate-600">{j.company}</p>
                      <div className="space-y-2">
                        <ScoreBar label="Exact skills" value={j.exactScore} />
                        <ScoreBar label="With related skills" value={j.graphScore} tone="violet" />
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-semibold">Learn next</h2>
            <Card>
              {data.learnNext.length === 0 ? (
                <p className="text-sm text-slate-600">You already cover every skill open jobs ask for.</p>
              ) : (
                <ol className="space-y-3 text-sm">
                  {data.learnNext.map((s, i) => (
                    <li key={s.skill}>
                      <p className="font-medium">
                        {i + 1}. {s.skill}
                      </p>
                      <p className="text-slate-600">
                        Needed by {s.openJobsNeedingIt} open job{s.openJobsNeedingIt === 1 ? "" : "s"}
                        {s.proximity > 0 && <> · close to a skill you have ({Math.round(s.proximity * 100)}% similar)</>}
                        {s.builtOnExisting && <> · builds on what you know</>}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}
