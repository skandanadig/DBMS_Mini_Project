"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Loading, PageHeader } from "@/components/candidate/display";
import { Alert, Badge, Button, Card, Field } from "@/components/ui";
import { api, fieldErrors, formatDate } from "@/lib/api-client";
import type { AdminUserRow, Paged, Role } from "@/lib/contracts";

const inputCls = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

function CreateUserForm({ onCreated }: { onCreated: (msg: string) => void }) {
  const [role, setRole] = useState<"Recruiter" | "Admin">("Recruiter");
  const [companies, setCompanies] = useState<Array<{ companyId: number; companyName: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Array<{ companyId: number; companyName: string }>>("/api/admin/companies").then(setCompanies).catch(() => undefined);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError(null);
    setErrs({});
    try {
      const body = {
        role,
        name: f.get("name"),
        email: f.get("email"),
        password: f.get("password"),
        ...(role === "Recruiter" ? { companyId: f.get("companyId"), designation: f.get("designation") } : {}),
      };
      const r = await api<{ user: { name: string; role: Role } }>("/api/admin/users", { method: "POST", json: body });
      form.reset();
      onCreated(`${r.user.role} account created for ${r.user.name}.`);
    } catch (err) {
      setErrs(fieldErrors(err));
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold">Create a privileged account</h2>
      <p className="mb-4 text-xs text-slate-500">Recruiter and admin accounts can only be created here; public sign-up always creates candidates.</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <fieldset className="flex gap-4 text-sm sm:col-span-2">
          <legend className="sr-only">Role</legend>
          {(["Recruiter", "Admin"] as const).map((r) => (
            <label key={r} className="flex items-center gap-1.5">
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} /> {r}
            </label>
          ))}
        </fieldset>
        <Field id="new-name" name="name" label="Full name" required error={errs.name} />
        <Field id="new-email" name="email" type="email" label="Email" required error={errs.email} />
        <Field id="new-password" name="password" type="password" label="Initial password (min 8)" minLength={8} required error={errs.password} />
        {role === "Recruiter" && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Company</span>
              <select name="companyId" required className={inputCls}>
                {companies.map((c) => (
                  <option key={c.companyId} value={c.companyId}>
                    {c.companyName}
                  </option>
                ))}
              </select>
            </label>
            <Field id="new-designation" name="designation" label="Designation" required error={errs.designation} />
          </>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : `Create ${role.toLowerCase()}`}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function AdminUsersPage() {
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminUserRow> | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), pageSize: "15", ...(role ? { role } : {}), ...(q ? { q } : {}) });
    api<Paged<AdminUserRow>>(`/api/admin/users?${qs}`)
      .then(setData)
      .catch((e: Error) => setMsg({ tone: "error", text: e.message }));
  }, [role, q, page]);
  useEffect(load, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader title="Users" subtitle="All accounts with their role and activity (applications for candidates, postings for recruiters)." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="mb-3 flex flex-wrap gap-2">
            <select aria-label="Filter by role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className={inputCls}>
              <option value="">All roles</option>
              <option>Candidate</option>
              <option>Recruiter</option>
              <option>Admin</option>
            </select>
            <input aria-label="Search name or email" placeholder="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className={`${inputCls} flex-1`} />
          </div>
          {!data ? (
            <Loading />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Name</th>
                      <th className="py-1 pr-3 font-medium">Role</th>
                      <th className="py-1 pr-3 font-medium">Company</th>
                      <th className="py-1 pr-3 text-right font-medium">Activity</th>
                      <th className="py-1 font-medium">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.data.map((u) => (
                      <tr key={u.userId}>
                        <td className="py-1.5 pr-3">
                          <p className="font-medium">{u.name}</p>
                          <p className="text-xs text-slate-500">{u.email}</p>
                        </td>
                        <td className="py-1.5 pr-3">
                          <Badge>{u.role}</Badge>
                        </td>
                        <td className="py-1.5 pr-3 text-slate-700">{u.companyName ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{u.role === "Admin" ? "—" : u.activity}</td>
                        <td className="py-1.5 text-slate-600">{formatDate(u.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                <span>{data.total} users</span>
                <span className="flex items-center gap-2">
                  <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                  {page} / {pages}
                  <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
                </span>
              </div>
            </>
          )}
        </Card>

        <div className="lg:col-span-2">
          <CreateUserForm
            onCreated={(text) => {
              setMsg({ tone: "success", text });
              load();
            }}
          />
        </div>
      </div>
    </div>
  );
}
