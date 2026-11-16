"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Loading, PageHeader } from "@/components/candidate/display";
import { Alert, Button, Card, Field } from "@/components/ui";
import { api, fieldErrors } from "@/lib/api-client";
import type { CandidateProfile } from "@/lib/contracts";

export default function ProfilePage() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CandidateProfile>("/api/me/profile")
      .then(setProfile)
      .catch((e: Error) => setMsg({ tone: "error", text: e.message }));
  }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErrs({});
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    try {
      const updated = await api<CandidateProfile>("/api/me/profile", {
        method: "PUT",
        json: {
          name: get("name"),
          phone: get("phone"),
          location: get("location"),
          experienceYears: get("experienceYears") || "0",
          resumeUrl: get("resumeUrl"),
          headline: get("headline"),
          bio: get("bio"),
        },
      });
      setProfile(updated);
      setMsg({ tone: "success", text: "Profile saved." });
    } catch (err) {
      setErrs(fieldErrors(err));
      // DB_RULE errors carry the CHECK constraint that rejected the value
      setMsg({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return msg ? <Alert>{msg.text}</Alert> : <Loading />;

  return (
    <div className="max-w-2xl">
      <PageHeader title="My profile" subtitle="A resume link is required before you can apply (checked by the stored procedure)." />
      <Card>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          {msg && (
            <div className="sm:col-span-2">
              <Alert tone={msg.tone}>{msg.text}</Alert>
            </div>
          )}
          <Field id="name" name="name" label="Full name" defaultValue={profile.name} required error={errs.name} />
          <Field id="email" name="email" label="Email (login)" defaultValue={profile.email} disabled />
          <Field id="phone" name="phone" label="Phone" placeholder="+91-9876543210" defaultValue={profile.phone ?? ""} error={errs.phone} />
          <Field id="location" name="location" label="Location" defaultValue={profile.location ?? ""} error={errs.location} />
          <Field
            id="experienceYears"
            name="experienceYears"
            type="number"
            step="0.5"
            min="0"
            label="Experience (years)"
            defaultValue={profile.experienceYears}
            error={errs.experienceYears}
          />
          <Field
            id="resumeUrl"
            name="resumeUrl"
            label="Resume URL"
            placeholder="https://…"
            defaultValue={profile.resumeUrl ?? ""}
            error={errs.resumeUrl}
          />
          <Field id="headline" name="headline" label="Headline" className="sm:col-span-2" defaultValue={profile.headline ?? ""} error={errs.headline} />
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">About you</span>
            <textarea
              name="bio"
              rows={4}
              defaultValue={profile.bio ?? ""}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
