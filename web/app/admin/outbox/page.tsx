"use client";

import { useCallback, useEffect, useState } from "react";
import { Loading, PageHeader } from "@/components/candidate/display";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/api-client";
import type { OutboxRow, OutboxSyncResponse, Paged } from "@/lib/contracts";

type OutboxPage = Paged<OutboxRow> & { stats: Record<string, number> };
const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-800",
  DONE: "bg-green-50 text-green-800",
  FAILED: "bg-red-50 text-red-700",
};

export default function OutboxPage() {
  const [status, setStatus] = useState("FAILED");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OutboxPage | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<OutboxSyncResponse | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), ...(status ? { status } : {}) });
    api<OutboxPage>(`/api/admin/outbox?${qs}`)
      .then((d) => {
        setData(d);
        setSelected(new Set());
      })
      .catch((e: Error) => setMsg({ tone: "error", text: e.message }));
  }, [status, page]);
  useEffect(load, [load]);

  async function runSync() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<OutboxSyncResponse>("/api/admin/outbox/sync", { method: "POST" });
      setResult(r);
      load();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      const r = await api<{ retried: number }>("/api/admin/outbox/retry", { method: "POST", json: { eventIds: [...selected] } });
      setMsg({ tone: "success", text: `${r.retried} event(s) returned to the queue. They are being applied now.` });
      load();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="MySQL → Neo4j sync"
        subtitle="Transactional outbox: triggers write an event in the same transaction as each change; the worker applies them to Neo4j in order. FAILED events are parked after 5 attempts."
      >
        <Button onClick={runSync} disabled={busy}>
          {busy ? "Working…" : "Sync now & verify"}
        </Button>
      </PageHeader>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {result && (
        <Alert tone={result.verify.ok && !result.sync.blockedAt ? "success" : "error"}>
          {result.sync.lockAcquired
            ? `Applied ${result.sync.applied}, skipped ${result.sync.skipped}, parked ${result.sync.failed}; ${result.sync.remainingPending} pending.`
            : "Another sync worker is running - try again in a moment."}{" "}
          {result.verify.ok
            ? `Graph IN SYNC with MySQL (${result.verify.graphEntries} mirrored nodes and relationships compared).`
            : `Drift: ${result.verify.missingInGraph.length} missing / ${result.verify.extraInGraph.length} extra in the graph.`}
          {result.sync.blockedAt && ` Blocked at event ${result.sync.blockedAt.eventId}: ${result.sync.blockedAt.error}`}
        </Alert>
      )}

      {data && (
        <section className="grid grid-cols-3 gap-3" aria-label="Events by status">
          {(["PENDING", "FAILED", "DONE"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              aria-pressed={status === s}
              className={`rounded-xl border bg-white p-4 text-left ${status === s ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200"}`}
            >
              <p className="text-sm text-slate-600">{s.toLowerCase()}</p>
              <p className="mt-1 text-3xl font-semibold">{data.stats[s] ?? 0}</p>
            </button>
          ))}
        </section>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Showing</span>
            <select aria-label="Status filter" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 px-2 py-1">
              <option value="">all events</option>
              <option value="PENDING">pending</option>
              <option value="FAILED">failed</option>
              <option value="DONE">done</option>
            </select>
          </div>
          {status === "FAILED" && (
            <Button variant="secondary" onClick={retry} disabled={busy || selected.size === 0}>
              Retry selected ({selected.size})
            </Button>
          )}
        </div>

        {!data ? (
          <Loading />
        ) : data.data.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">No {status ? status.toLowerCase() : ""} events.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    {status === "FAILED" && <th className="py-1 pr-2" />}
                    <th className="py-1 pr-3 font-medium">#</th>
                    <th className="py-1 pr-3 font-medium">Event</th>
                    <th className="py-1 pr-3 font-medium">Status</th>
                    <th className="py-1 pr-3 text-right font-medium">Attempts</th>
                    <th className="py-1 pr-3 font-medium">Created</th>
                    <th className="py-1 font-medium">Last error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {data.data.map((e) => (
                    <tr key={e.eventId}>
                      {status === "FAILED" && (
                        <td className="py-1.5 pr-2">
                          <input type="checkbox" aria-label={`Select event ${e.eventId}`} checked={selected.has(e.eventId)} onChange={() => toggle(e.eventId)} />
                        </td>
                      )}
                      <td className="py-1.5 pr-3 tabular-nums">{e.eventId}</td>
                      <td className="py-1.5 pr-3">
                        <code className="text-xs">
                          {e.entityType} {e.op} {e.entityId}
                        </code>
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status]}`}>{e.status.toLowerCase()}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{e.attempts}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">{new Date(e.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td className="max-w-md py-1.5 text-xs text-red-700">{e.lastError}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
              <span>{data.total} events</span>
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
