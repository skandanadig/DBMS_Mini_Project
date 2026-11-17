"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/skills", label: "Skills" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/outbox", label: "Graph sync" },
];

/** Secondary navigation for the admin area (Member B). */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Admin sections" className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? path === "/admin" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
