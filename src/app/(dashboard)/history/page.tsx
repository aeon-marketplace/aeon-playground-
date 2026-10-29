import Link from "next/link";
import { MessageSquare } from "lucide-react";
import HistoryClient from "@/components/history/history-client";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { countRuns, listRuns } from "@/lib/db/runs";

export const metadata = { title: "Test History" };
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  // Anonymous visitor runs are kept in browser storage, never in SQLite.
  const account = user && !user.isAnonymous ? user : null;
  const runs = account ? listRuns(account.id, 200) : [];
  const total = account ? countRuns(account.id) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={account ? "Audit trail" : "Browser-local trail"}
        title="Test History"
        description={
          account
            ? "Every chat, comparison run, and image request is recorded with real status, latency, and usage where the provider reports it. History is private to your account."
            : "Your public-session history is stored only in this browser — no account is required. Prompts, results, and generated image data never enter the server-side history database. Deleting entries removes them from this browser."
        }
        actions={
          <Link href="/playground" className="btn btn-secondary">
            <MessageSquare className="h-4 w-4" />
            Open Playground
          </Link>
        }
      />
      <HistoryClient initialRuns={runs} initialTotal={total} localOnly={!account} />
    </div>
  );
}
