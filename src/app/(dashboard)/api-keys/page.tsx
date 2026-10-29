import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Alert, PageHeader } from "@/components/ui";
import KeysManager from "@/components/keys/keys-manager";
import { getCurrentUser, getAnonymousUserId } from "@/lib/auth/session";
import { listProviderCredentials } from "@/lib/db/credentials";
import { getEnv } from "@/lib/env";
import { PROVIDERS } from "@/lib/providers/registry";

export const metadata = { title: "API Keys" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const user = await getCurrentUser();
  const userId = user?.id ?? (await getAnonymousUserId());
  const isAnonymous = !user || Boolean(user.isAnonymous);

  const env = getEnv();
  const providers = PROVIDERS.filter((provider) => provider.requiresKey);
  const credentials = userId ? listProviderCredentials(userId) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bring your own key"
        title="API Keys"
        description="Connect provider keys to check which exact model IDs your account can list. Key acceptance does not prove per-model inference or free-tier eligibility; use the catalog Test action for one real request. Storage is isolated per visitor session or account, and raw keys are never returned to the browser."
        actions={
          <>
            <Link href="/models" className="btn btn-secondary">
              <KeyRound className="h-4 w-4" />
              Model catalog
            </Link>
            <Link href="/my-models" className="btn btn-secondary">
              <ShieldCheck className="h-4 w-4" />
              Custom endpoints
            </Link>
          </>
        }
      />

      {isAnonymous ? (
        <Alert tone="violet" title="No account required">
          You can add, verify, update, and remove your own API keys without signing in. Keys are
          encrypted server-side, associated with this anonymous visitor session, and never returned
          as raw keys. They remain valid for this session/browser for up to 7 days. Creating an
          account does not transfer anonymous keys.
        </Alert>
      ) : null}

      <Alert tone="violet" title="Key handling">
        Keys are encrypted server-side with AES-256-GCM before storage and are never sent back to
        the browser. This page only shows a masked hint. Verification performs a real request to
        the provider. Each credential belongs to your session and uses your provider quota; there is
        no server-shared key. Do not paste a key you are not authorized to use.
      </Alert>

      <KeysManager
        providers={providers}
        initialCredentials={credentials}
        allowPaidByok={env.allowPaidByok}
        isAnonymous={isAnonymous}
      />
    </div>
  );
}
