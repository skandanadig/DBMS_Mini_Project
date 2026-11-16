"use client";

import { use, useEffect, useState } from "react";
import { Loading, PageHeader } from "@/components/candidate/display";
import { JobForm } from "@/components/recruiter/JobForm";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api-client";
import type { JobDetail } from "@/lib/contracts";

export default function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<JobDetail>(`/api/recruiter/jobs/${id}`) // 403 unless you own the posting
      .then(setJob)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <div>
      <PageHeader title="Edit posting" subtitle={job?.title} />
      {error && <Alert>{error}</Alert>}
      {!job && !error && <Loading />}
      {job && <JobForm job={job} />}
    </div>
  );
}
