"use client";

import { useEffect, useState } from "react";
import { Loading, PageHeader, StatusBadge } from "@/components/candidate/display";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/api-client";
import type { AuditLogRow, Paged } from "@/lib/contracts";

const STATUSES = ["APPLIED", "UNDER_REVIEW", "INTERVIEW_SCHEDULED", "OFFERED", "REJECTED"] as const;
const inputCls = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export default function AuditLogPage() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AuditLogRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ page: String(page), ...(status ? { status } : {}), ...(q ? { q } : {}) });
    api<Paged<AuditLogRow>>(`/api/admin/audit-logs?${qs}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [status, q, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Application audit log"
        subtitle="Every row is written by MySQL triggers (trg_log_application_insert, trg_audit_application_status_update) - the application code never inserts here."
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <select aria-label="New status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={inputCls}>
            <option value="">Any new status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
          <input aria-label="Search" placeholder="Search candidate, job or remarks" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className={`${inputCls} flex-1`} />
        </div>
        {!data ? (
          <Loading />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">When</th>
                    <th className="py-1 pr-3 font-medium">Application</th>
                    <th className="py-1 pr-3 font-medium">Change</th>
                    <th className="py-1 pr-3 font-medium">By</th>
                    <th className="py-1 font-medium">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {data.data.map((l) => (
                    <tr key={l.logId}>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">{new Date(l.changedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className="py-1.5 pr-3">
                        <p className="font-medium">{l.candidateName}</p>
                        <p className="text-xs text-slate-500">#{l.applicationId} · {l.jobTitle}</p>
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="flex flex-wrap items-center gap-1">
                          {l.oldStatus ? <StatusBadge status={l.oldStatus} /> : <span className="text-xs text-slate-500">new</span>}
                          <span aria-hidden>→</span>
                          <StatusBadge status={l.newStatus} />
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-slate-700">
                        {l.changedBy ?? <span className="text-slate-400">system</span>}
                        {l.changedByRole && <span className="block text-xs text-slate-500">{l.changedByRole}</span>}
                      </td>
                      <td className="py-1.5 text-slate-700">{l.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
              <span>{data.total} entries</span>
              <span className="flex items-center gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                {page} / {pages}
                <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
