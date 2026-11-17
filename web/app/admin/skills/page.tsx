"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Loading, PageHeader } from "@/components/candidate/display";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/api-client";
import type { AdminSkillRow } from "@/lib/contracts";

const inputCls = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export default function AdminSkillsPage() {
  const [skills, setSkills] = useState<AdminSkillRow[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ data: AdminSkillRow[] }>("/api/admin/skills")
      .then((r) => setSkills(r.data))
      .catch((e: Error) => setMsg({ tone: "error", text: e.message }));
  }, []);
  useEffect(load, [load]);

  async function save(e: FormEvent<HTMLFormElement>, skillId?: number) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = { skillName: f.get("skillName"), category: f.get("category") };
    setBusy(true);
    setMsg(null);
    try {
      if (skillId) await api(`/api/admin/skills/${skillId}`, { method: "PUT", json: body });
      else await api("/api/admin/skills", { method: "POST", json: body });
      setMsg({ tone: "success", text: `Skill ${skillId ? "updated" : "added"}. The Neo4j skill graph updates within a few seconds.` });
      setEditing(null);
      if (!skillId) form.reset();
      load();
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const categories = [...new Set((skills ?? []).map((s) => s.category))];

  return (
    <div className="space-y-6">
      <PageHeader title="Skill taxonomy" subtitle="Stored in MySQL (unique names) and mirrored to Neo4j :Skill nodes through the outbox." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card>
        <form onSubmit={(e) => save(e)} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">New skill</span>
            <input name="skillName" required maxLength={80} placeholder="e.g. Rust" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Category</span>
            <input name="category" required maxLength={50} list="skill-categories" placeholder="e.g. Languages" className={inputCls} />
            <datalist id="skill-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <Button type="submit" disabled={busy}>
            Add skill
          </Button>
        </form>
      </Card>

      {!skills ? (
        <Loading />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Skill</th>
                  <th className="py-1 pr-3 font-medium">Category</th>
                  <th className="py-1 pr-3 text-right font-medium">Candidates</th>
                  <th className="py-1 pr-3 text-right font-medium">All jobs</th>
                  <th className="py-1 pr-3 text-right font-medium">Open jobs</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {skills.map((s) =>
                  editing === s.skillId ? (
                    <tr key={s.skillId}>
                      <td colSpan={6} className="py-2">
                        <form onSubmit={(e) => save(e, s.skillId)} className="flex flex-wrap items-center gap-2">
                          <input name="skillName" defaultValue={s.name} required maxLength={80} aria-label="Skill name" className={inputCls} />
                          <input name="category" defaultValue={s.category} required maxLength={50} list="skill-categories" aria-label="Category" className={inputCls} />
                          <Button type="submit" disabled={busy}>Save</Button>
                          <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={s.skillId}>
                      <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                      <td className="py-1.5 pr-3 text-slate-700">{s.category}</td>
                      <td className="py-1.5 pr-3 text-right">{s.candidates}</td>
                      <td className="py-1.5 pr-3 text-right">{s.jobs}</td>
                      <td className="py-1.5 pr-3 text-right">{s.openJobs}</td>
                      <td className="py-1.5 text-right">
                        <Button variant="ghost" onClick={() => setEditing(s.skillId)}>Edit</Button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
