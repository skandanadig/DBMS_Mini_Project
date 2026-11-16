import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { getServerSession } from "@/lib/server-session";

const DEMO_ACCOUNTS = [
  { role: "Admin", email: "admin@skillmatch.io" },
  { role: "Recruiter", email: "sarah.j@techcorp.com" },
  { role: "Candidate", email: "rahul.sharma@gmail.com" },
];

export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const [session, params] = await Promise.all([getServerSession(), searchParams]);

  return (
    <div className="space-y-8">
      {params.denied && <Alert>That page is not available for your role.</Alert>}

      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Find the job your skills already fit.</h1>
        <p className="max-w-2xl text-slate-600">
          SkillMatch combines a transactional MySQL core (applications, audit trail, business rules) with a Neo4j skill
          graph (related skills, skill gaps, referrals) to rank candidates and recommend jobs.
        </p>
        {session ? (
          <p className="text-slate-700">
            Signed in as <strong>{session.name}</strong> ({session.role}).
          </p>
        ) : (
          <div className="flex gap-3">
            <Link href="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Create a candidate account
            </Link>
            <Link href="/login" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100">
              Sign in
            </Link>
          </div>
        )}
      </section>

      {!session && (
        <Card className="max-w-xl">
          <h2 className="mb-2 font-semibold">Demo accounts</h2>
          <p className="mb-3 text-sm text-slate-600">
            All seeded accounts use the password <code className="rounded bg-slate-100 px-1">Password@123</code>.
          </p>
          <ul className="space-y-1 text-sm">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <span className="inline-block w-24 text-slate-500">{a.role}</span>
                <code>{a.email}</code>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
