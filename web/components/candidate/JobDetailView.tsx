"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card } from "@/components/ui";
import { ApiError, api, formatDate, formatSalary } from "@/lib/api-client";
import type { ApplyResponse, JobDetail, JobMatchResponse, SkillState } from "@/lib/contracts";
import { Loading, ScoreBar, SkillChips, StatusBadge } from "./display";

const STATE_LABEL: Record<SkillState, string> = { MET: "Meets", BELOW_LEVEL: "Below level", MISSING: "Missing" };
const STATE_DOT: Record<SkillState, string> = { MET: "bg-green-500", BELOW_LEVEL: "bg-amber-500", MISSING: "bg-red-500" };

export function JobDetailView({ jobId, role }: { jobId: number; role: string | null }) {
  const isCandidate = role === "Candidate";
  const [job, setJob] = useState<JobDetail | null>(null);
  const [match, setMatch] = useState<JobMatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyMsg, setApplyMsg] = useState<{ tone: "success" | "error"; text: string; needsProfile?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setJob(await api<JobDetail>(`/api/jobs/${jobId}`));
      if (isCandidate) setMatch(await api<JobMatchResponse>(`/api/jobs/${jobId}/match`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [jobId, isCandidate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply() {
    setBusy(true);
    setApplyMsg(null);
    try {
      const r = await api<ApplyResponse>(`/api/jobs/${jobId}/apply`, { method: "POST" });
      setApplyMsg({ tone: "success", text: `${r.message} (application #${r.applicationId})` });
      await load();
    } catch (e) {
      const msg = (e as Error).message;
      setApplyMsg({ tone: "error", text: msg, needsProfile: e instanceof ApiError && /resume/i.test(msg) });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!job) return <Loading />;

  const states = Object.fromEntries((match?.skills ?? []).map((s) => [s.skillId, s.state]));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <Link href="/jobs" className="text-sm text-brand-700 hover:underline">
            ← All jobs
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{job.title}</h1>
          <p className="text-slate-600">
            {job.companyName} · {job.industry} · {job.location}
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {job.employmentType} · {formatSalary(job.salaryMin, job.salaryMax)} · posted {formatDate(job.postedDate)} by {job.recruiterName}
          </p>
          {job.status !== "OPEN" && (
            <div className="mt-3">
              <Alert tone="info">This posting is {job.status.toLowerCase()} and no longer accepts applications.</Alert>
            </div>
          )}
          <p className="mt-4 whitespace-pre-line text-slate-800">{job.description}</p>
          <h2 className="mt-6 mb-2 font-semibold">Required skills</h2>
          <SkillChips skills={job.skills} states={match ? states : undefined} />
          <p className="mt-2 text-xs text-slate-500">Dashed = optional. Hover a skill to see the required level.</p>
        </Card>

        {match && (
          <Card>
            <h2 className="mb-3 font-semibold">Skill gap analysis</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Skill</th>
                    <th className="py-1 pr-3 font-medium">Required</th>
                    <th className="py-1 pr-3 font-medium">You</th>
                    <th className="py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {match.skills.map((s) => (
                    <tr key={s.skillId}>
                      <td className="py-1.5 pr-3">
                        {s.name} {!s.mandatory && <span className="text-xs text-slate-400">(optional)</span>}
                      </td>
                      <td className="py-1.5 pr-3">{s.requiredLevel}</td>
                      <td className="py-1.5 pr-3">{s.candidateLevel ?? "—"}</td>
                      <td className="py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${STATE_DOT[s.state]}`} aria-hidden />
                          {STATE_LABEL[s.state]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {match.related.length > 0 && (
              <>
                <h3 className="mt-5 mb-1 text-sm font-semibold">How the skill graph sees your gaps</h3>
                <ul className="space-y-1 text-sm text-slate-700">
                  {match.related.map((r) => (
                    <li key={r.skill}>
                      <strong>{r.skill}</strong>
                      {r.impliedBySubskill
                        ? " — implied by a more specific skill you have"
                        : r.via.length
                          ? ` — related to your ${r.via[0]} (path ${r.via.join(" → ")}, similarity ${r.similarity})`
                          : " — no related skill in your profile yet"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        )}
      </div>

      <aside className="space-y-6">
        {isCandidate && (
          <Card>
            <h2 className="mb-3 font-semibold">Your fit</h2>
            <div className="space-y-3">
              <ScoreBar label="SQL match (exact skills)" value={match?.exactScore ?? job.matchScore ?? null} />
              <ScoreBar label="Graph match (+ related skills)" value={match?.graphScore ?? null} tone="violet" />
            </div>
            {match && !match.graphAvailable && (
              <p className="mt-2 text-xs text-amber-700">Skill graph unavailable right now — showing the SQL score only.</p>
            )}

            <div className="mt-5 space-y-3">
              {job.application ? (
                <div className="text-sm">
                  <p className="mb-1 text-slate-600">You applied on {formatDate(job.application.appliedDate)}.</p>
                  <StatusBadge status={job.application.status} />{" "}
                  <Link href="/me/applications" className="ml-1 text-brand-700 hover:underline">
                    Track it
                  </Link>
                </div>
              ) : (
                <Button className="w-full" onClick={apply} disabled={busy || job.status !== "OPEN"}>
                  {busy ? "Submitting…" : "Apply now"}
                </Button>
              )}
              {applyMsg && (
                <Alert tone={applyMsg.tone}>
                  {applyMsg.text}{" "}
                  {applyMsg.needsProfile && (
                    <Link href="/me/profile" className="font-medium underline">
                      Add a resume link
                    </Link>
                  )}
                </Alert>
              )}
            </div>
          </Card>
        )}

        {match && match.referrals.length > 0 && (
          <Card>
            <h2 className="mb-2 font-semibold">Possible referrals</h2>
            <ul className="space-y-2 text-sm">
              {match.referrals.map((r) => (
                <li key={r.referrer}>
                  <strong>{r.referrer}</strong> worked at {r.company} ({r.degrees}° connection)
                  <p className="text-xs text-slate-500">{r.chain.join(" → ")}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!role && (
          <Card>
            <p className="text-sm text-slate-700">
              <Link href={`/login?next=/jobs/${jobId}`} className="font-medium text-brand-700 hover:underline">
                Sign in as a candidate
              </Link>{" "}
              to see your match score and apply.
            </p>
          </Card>
        )}
      </aside>
    </div>
  );
}
