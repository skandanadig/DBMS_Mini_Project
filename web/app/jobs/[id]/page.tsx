import { notFound } from "next/navigation";
import { JobDetailView } from "@/components/candidate/JobDetailView";
import { getServerSession } from "@/lib/server-session";

export const metadata = { title: "Job · SkillMatch" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, getServerSession()]);
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) notFound();
  return <JobDetailView jobId={jobId} role={session?.role ?? null} />;
}
