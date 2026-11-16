"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { EmptyState, Loading, PageHeader } from "@/components/candidate/display";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/api-client";
import type { CandidateSkill, ProficiencyLevel, SkillOption } from "@/lib/contracts";

const LEVELS: ProficiencyLevel[] = ["Beginner", "Intermediate", "Advanced", "Expert"];
const inputCls = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export default function MySkillsPage() {
  const [mine, setMine] = useState<CandidateSkill[] | null>(null);
  const [options, setOptions] = useState<SkillOption[]>([]);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ data: CandidateSkill[] }>("/api/me/skills")
      .then((r) => setMine(r.data))
      .catch((e: Error) => setMsg({ tone: "error", text: e.message }));
    api<SkillOption[]>("/api/skills").then(setOptions).catch(() => undefined);
  }, []);

  const byCategory = useMemo(() => {
    const groups = new Map<string, SkillOption[]>();
    for (const o of options) groups.set(o.category, [...(groups.get(o.category) ?? []), o]);
    return [...groups.entries()];
  }, [options]);

  async function run(action: () => Promise<{ data: CandidateSkill[] }>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      setMine((await action()).data);
      setMsg({ tone: "success", text: `${ok} Your skill graph updates within a few seconds.` });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(
      () =>
        api("/api/me/skills", {
          method: "POST",
          json: { skillId: f.get("skillId"), proficiency: f.get("proficiency"), years: f.get("years") || 0 },
        }),
      "Skill saved.",
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="My skills" subtitle="Stored in MySQL and mirrored to the Neo4j skill graph through the outbox." />
      {msg && (
        <div className="mb-4">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}

      <Card className="mb-6">
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Skill</span>
            <select name="skillId" required className={inputCls}>
              {byCategory.map(([cat, list]) => (
                <optgroup key={cat} label={cat}>
                  {list.map((s) => (
                    <option key={s.skillId} value={s.skillId}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Level</span>
            <select name="proficiency" defaultValue="Intermediate" className={inputCls}>
              {LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Years</span>
            <input name="years" type="number" min="0" max="60" step="0.5" defaultValue="1" className={`${inputCls} w-24`} />
          </label>
          <Button type="submit" disabled={busy}>
            Add / update
          </Button>
        </form>
      </Card>

      {!mine && !msg && <Loading />}
      {mine?.length === 0 && <EmptyState title="No skills yet.">Add your skills to get match scores and recommendations.</EmptyState>}
      {mine && mine.length > 0 && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {mine.map((s) => (
              <li key={s.skillId} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="font-medium">{s.name}</span> <span className="text-slate-500">· {s.category}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="text-slate-700">
                    {s.proficiency} · {s.years} yr{s.years === 1 ? "" : "s"}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${s.name}`}
                    onClick={() => run(() => api(`/api/me/skills?skillId=${s.skillId}`, { method: "DELETE" }), "Skill removed.")}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
