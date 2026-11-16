import { PageHeader } from "@/components/candidate/display";
import { JobForm } from "@/components/recruiter/JobForm";

export const metadata = { title: "Post a job · SkillMatch" };

export default function NewJobPage() {
  return (
    <div>
      <PageHeader title="Post a job" subtitle="The company is taken from your recruiter profile. Salary and title rules are checked by MySQL." />
      <JobForm />
    </div>
  );
}
