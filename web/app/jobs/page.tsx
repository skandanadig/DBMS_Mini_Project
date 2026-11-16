import { Suspense } from "react";
import { JobBoard } from "@/components/candidate/JobBoard";
import { getServerSession } from "@/lib/server-session";

export const metadata = { title: "Jobs · SkillMatch" };

export default async function JobsPage() {
  const session = await getServerSession();
  return (
    <Suspense>
      <JobBoard isCandidate={session?.role === "Candidate"} />
    </Suspense>
  );
}
