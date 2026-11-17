import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/LogoutButton";
import { Badge } from "@/components/ui";
import type { Role } from "@/lib/contracts";
import { getServerSession } from "@/lib/server-session";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkillMatch",
  description: "Intelligent job and skill matching on MySQL + Neo4j",
};

const NAV_BY_ROLE: Record<Role, Array<{ href: string; label: string }>> = {
  Candidate: [
    { href: "/jobs", label: "Jobs" },
    { href: "/me/recommendations", label: "For you" },
    { href: "/me/applications", label: "My applications" },
    { href: "/me/skills", label: "My skills" },
    { href: "/me/profile", label: "Profile" },
  ],
  Recruiter: [
    { href: "/recruiter", label: "Dashboard" },
    { href: "/jobs", label: "Job board" },
  ],
  Admin: [
    { href: "/admin", label: "Overview" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/outbox", label: "Graph sync" },
    { href: "/jobs", label: "Job board" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  const links = session ? NAV_BY_ROLE[session.role] : [{ href: "/jobs", label: "Jobs" }];

  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-lg font-semibold text-brand-700">
              SkillMatch
            </Link>
            <ul className="flex flex-wrap gap-4 text-sm text-slate-600">
              {links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-slate-900">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="ml-auto flex items-center gap-3 text-sm">
              {session ? (
                <>
                  <span className="text-slate-700">{session.name}</span>
                  <Badge>{session.role}</Badge>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <Link href="/login" className="text-slate-700 hover:text-slate-900">
                    Sign in
                  </Link>
                  <Link
                    href="/register"
                    className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
                  >
                    Create account
                  </Link>
                </>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
