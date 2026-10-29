import Link from "next/link";
import { KeyRound, LayoutGrid, Plug } from "lucide-react";
import CompareClient from "@/components/compare/compare-client";
import { Alert, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { getSelectableModels } from "@/lib/providers/runtime";

export const metadata = { title: "Model Comparison" };
export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const user = await getCurrentUser();
  const models = (await getSelectableModels(user?.id ?? null)).filter((model) =>
    model.capabilities.includes("text"),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Side by side"
        title="Model Comparison"
        description={
          user
            ? "Send one prompt to two to four verified models in parallel and compare real latency, usage, and failure modes. No result is synthesized or substituted."
            : "Compare real models side by side without creating an account. Add your own provider key to compare BYOK models; results are kept in this browser's local history."
        }
        actions={
          <>
            <Link href="/api-keys" className="btn btn-secondary">
              <KeyRound className="h-4 w-4" />
              API keys
            </Link>
            <Link href="/my-models" className="btn btn-secondary">
              <Plug className="h-4 w-4" />
              Custom endpoints
            </Link>
            <Link href="/models" className="btn btn-primary">
              <LayoutGrid className="h-4 w-4" />
              Model catalog
            </Link>
          </>
        }
      />

      {models.length < 2 ? (
        <Alert tone="amber" title="Two selectable text models are required">
          Only {models.length} text model{models.length === 1 ? " is" : "s are"} currently
          selectable for this session. Verify a provider key or a custom endpoint to compare;
          anonymous sessions can do both without creating an account. This app will not duplicate a
          model or invent a second result.
        </Alert>
      ) : null}

      <CompareClient
        models={models}
        isAuthenticated={Boolean(user && !user.isAnonymous)}
      />
    </div>
  );
}
