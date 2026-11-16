"use client";

import Link from "next/link";
import { type FormEvent, use, useCallback, useEffect, useState } from "react";
import { EmptyState, Loading, PageHeader, StatusBadge } from "@/components/candidate/display";
import { Alert, Button, Card } from "@/components/ui";
import { api, formatDate } from "@/lib/api-client";
import type { Applicant, ApplicantsResponse, ApplicationStatus } from "@/lib/contracts";

const label = (s: ApplicationStatus) => s.replaceAll("_", " ").toLowerCase();

function StatusControl({ applicant, onDone }: { applicant: Applicant; onDone: (msg: { tone: "success" | "error"; text: string }) => void }) {
  const [busy, setBusy] = useState(false);
  if (applicant.nextStatuses.length === 0) return <span className="text-xs text-slate-500">final</span>;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(`/api/recruiter/applications/${applicant.applicationId}/status`, {
        method: "PATCH",
        json: { status: f.get("status"), remarks: String(f.get("remarks") ?? "") },
      });
      onDone({ tone: "success", text: `${applicant.name}: moved to ${label(f.get("status") as ApplicationStatus)}.` });
    } catch (err) {
      onDone({ tone: "error", text: `${applicant.name}: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <select name="status" aria-label={`Next status for ${applicant.name}`} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
        {applicant.nextStatuses.map((s) => (
          <option key={s} value={s}>
            {label(s)}
          </option>
        ))}
      </select>
      <input name="remarks" placeholder="Remarks (saved in audit log)" maxLength={255} className="w-44 rounded-md border border-slate-300 px-2 py-1 text-xs" />
      <Button type="submit" disabled={busy} className="px-2.5 py-1 text-xs">
        Update
      </Button>
    </form>
  );
}

function RankChange({ change }: { change: number | null }) {
  if (change === null) return <span className="text-slate-400">—</span>;
  if (change === 0) return <span className="text-slate-500">same</span>;
  return change > 0 ? (
    <span className="font-medium text-green-700">▲ {change} higher in graph</span>
  ) : (
    <span className="font-medium text-slate-600">▼ {-change} lower in graph</span>
  );
}

export default function ApplicantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ApplicantsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(() => {
    api<ApplicantsResponse>(`/api/recruiter/jobs/${id}/applicants`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const { ranking } = data;

  return (
    <div className="space-y-6">
      <PageHeader title={data.job.title} subtitle={`Posting is ${data.job.status.toLowerCase()} · ${data.applicants.length} applicant${data.applicants.length === 1 ? "" : "s"}`}>
        <div className="flex gap-3 text-sm">
          <Link href={`/recruiter/jobs/${id}/edit`} className="text-brand-700 hover:underline">
            Edit posting
          </Link>
          <Link href="/recruiter" className="text-brand-700 hover:underline">
            Dashboard
          </Link>
        </div>
      </PageHeader>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card>
        <h2 className="mb-1 font-semibold">Applicants</h2>
        <p className="mb-3 text-xs text-slate-500">
          Ranked with SQL <code>RANK()</code> over the current <code>fn_match_score</code>. Status changes go through{" "}
          <code>sp_update_application_status</code>; MySQL rejects invalid transitions.
        </p>
        {data.applicants.length === 0 ? (
          <EmptyState title="No applications yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">#</th>
                  <th className="py-1 pr-3 font-medium">Candidate</th>
                  <th className="py-1 pr-3 text-right font-medium">Match now</th>
                  <th className="py-1 pr-3 text-right font-medium">At apply</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 font-medium">Next step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.applicants.map((a) => (
                  <tr key={a.applicationId} className="align-top">
                    <td className="py-2 pr-3 tabular-nums">{a.sqlRank}</td>
                    <td className="py-2 pr-3">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-slate-500">
                        {a.experienceYears} yrs · {a.location ?? "—"} · applied {formatDate(a.appliedDate)}
                        {a.resumeUrl && (
                          <>
                            {" · "}
                            <a href={a.resumeUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                              resume
                            </a>
                          </>
                        )}
                      </p>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{a.currentScore.toFixed(1)}%</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{a.scoreAtApply.toFixed(1)}%</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="py-2">
                      <StatusControl
                        applicant={a}
                        onDone={(m) => {
                          setMsg(m);
                          load();
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Talent pool: SQL ranking vs graph ranking</h2>
        <p className="mb-3 text-xs text-slate-500">
          SQL scores only exact skills (<code>fn_match_score</code>). The Neo4j score also credits related skills (RELATED_TO) and more
          specific skills (SUBSKILL_OF), so a candidate with adjacent experience can move up. Showing the union of both top {ranking.topN}{" "}
          lists; {ranking.overlap} candidates appear in both.
        </p>
        {!ranking.graphAvailable && <Alert tone="info">The skill graph is unavailable - graph columns are empty.</Alert>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Candidate</th>
                <th className="py-1 pr-3 text-right font-medium">SQL score</th>
                <th className="py-1 pr-3 text-right font-medium">SQL rank</th>
                <th className="py-1 pr-3 text-right font-medium">Graph score</th>
                <th className="py-1 pr-3 text-right font-medium">Graph rank</th>
                <th className="py-1 pr-3 font-medium">Change</th>
                <th className="py-1 font-medium">Applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {ranking.rows.map((r) => (
                <tr key={r.candidateId}>
                  <td className="py-1.5 pr-3">
                    {r.name} <span className="text-xs text-slate-500">· {r.experienceYears} yrs</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right">{r.sqlScore.toFixed(1)}%</td>
                  <td className="py-1.5 pr-3 text-right">{r.sqlRank}</td>
                  <td className="py-1.5 pr-3 text-right">{r.graphScore === null ? "—" : `${r.graphScore.toFixed(1)}%`}</td>
                  <td className="py-1.5 pr-3 text-right">{r.graphRank ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    <RankChange change={r.rankChange} />
                  </td>
                  <td className="py-1.5">{r.hasApplied ? "Yes" : <span className="text-slate-400">No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
