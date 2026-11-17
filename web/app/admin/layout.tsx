import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";

export const metadata = { title: "Admin · SkillMatch" };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <AdminNav />
      {children}
    </div>
  );
}
