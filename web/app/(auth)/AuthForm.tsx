"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import type { ApiErrorBody } from "@/lib/errors";

type Mode = "login" | "register";

/** Only allow same-site relative redirects (prevents open redirects). */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(e.currentTarget);
    const body = Object.fromEntries(form.entries());

    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      router.push(safeNext(searchParams.get("next")));
      router.refresh();
      return;
    }

    const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
    setError(data?.error.message ?? "Request failed.");
    if (data?.error.code === "VALIDATION" && Array.isArray(data.error.details)) {
      const map: Record<string, string> = {};
      for (const d of data.error.details as Array<{ path: string; message: string }>) map[d.path] ??= d.message;
      setFieldErrors(map);
    }
    setBusy(false);
  }

  const isRegister = mode === "register";

  return (
    <Card className="mx-auto w-full max-w-md">
      <h1 className="mb-1 text-xl font-semibold">{isRegister ? "Create a candidate account" : "Sign in"}</h1>
      <p className="mb-5 text-sm text-slate-600">
        {isRegister
          ? "Recruiter and admin accounts are created by an administrator."
          : "Use your SkillMatch email and password."}
      </p>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {isRegister && <Field id="name" name="name" label="Full name" autoComplete="name" required error={fieldErrors.name} />}
        <Field id="email" name="email" type="email" label="Email" autoComplete="email" required error={fieldErrors.email} />
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          minLength={isRegister ? 8 : undefined}
          required
          error={fieldErrors.password}
        />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-600">
        {isRegister ? (
          <>
            Already registered?{" "}
            <Link href="/login" className="text-brand-700 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/register" className="text-brand-700 hover:underline">
              Create a candidate account
            </Link>
          </>
        )}
      </p>
    </Card>
  );
}
