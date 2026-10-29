import Link from "next/link";
import { KeyRound, RefreshCw, Server, ShieldCheck } from "lucide-react";
import ProvidersClient, { type ProviderCardData } from "@/components/providers/providers-client";
import { Alert, Card, PageHeader, Stat } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { listProviderCredentials } from "@/lib/db/credentials";
import { PROVIDERS } from "@/lib/providers/registry";
import { getOllamaDiscovery, getRuntimeCatalog } from "@/lib/providers/runtime";

export const metadata = { title: "Providers" };
export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const user = await getCurrentUser();
  // Anonymous sessions can add keys and custom endpoints, so they get the full
  // management UI. Only server-local Ollama stays operator-controlled.
  const hasSession = Boolean(user);
  const isOperator = Boolean(user && !user.isAnonymous);

  const catalog = await getRuntimeCatalog(user?.id ?? null);
  const credentials = user ? listProviderCredentials(user.id) : [];
  const ollama = isOperator ? await getOllamaDiscovery() : null;

  const providers: ProviderCardData[] = PROVIDERS.map((provider) => {
    const models = catalog.filter((model) => model.providerId === provider.id);
    const selectable = models.filter(
      (model) => model.status === "available" || model.status === "untested",
    );
    const inferenceTested = models.filter(
      (model) => model.accessEvidence === "inference_tested",
    );
    const credential = credentials.find((entry) => entry.providerId === provider.id);
    const connected = selectable.length > 0;

    let liveStatus = "Not connected";
    let liveDetail = "";
    if (connected) {
      liveStatus = inferenceTested.length > 0 ? "Connected" : "Key verified · untested";
      liveDetail =
        inferenceTested.length > 0
          ? `${inferenceTested.length} model${inferenceTested.length === 1 ? "" : "s"} passed a real inference test.`
          : "Model IDs were returned by the provider list, but no model has a recorded inference test.";
    } else if (provider.adapter === "ollama") {
      liveStatus = "Ollama offline";
      liveDetail = isOperator
        ? (ollama?.error ??
          "Start Ollama on the server, pull a model, then use Test & refresh. No local model is marked connected while the daemon is offline.")
        : "Server-local Ollama is available to signed-in accounts, not public visitor sessions. On a public deployment, set ALLOW_REGISTRATION=false after creating operator accounts.";
    } else if (provider.requiresKey && !credential) {
      liveStatus = "Needs key";
      liveDetail = `Add and verify your own ${provider.name} API key in API Keys. Anonymous sessions can do this without an account. No model is usable until the key reports it.`;
    } else if (provider.requiresKey && credential && !credential.verified) {
      liveStatus = "Key unverified";
      liveDetail = credential.verificationError ?? "The saved key has not passed verification.";
    } else if (provider.paid) {
      liveStatus = "Paid disabled";
      liveDetail =
        "This provider is paid. Paid BYOK stays disabled unless the operator sets ALLOW_PAID_BYOK=true.";
    } else if (provider.requiresKey) {
      liveStatus = "Key verified";
      liveDetail =
        "Your key is verified, but none of the registry model IDs were returned for this session or account.";
    }

    return {
      id: provider.id,
      name: provider.name,
      description: provider.description,
      icon: provider.icon,
      docsUrl: provider.docsUrl,
      keyUrl: provider.keyUrl,
      websiteUrl: provider.websiteUrl,
      requiresKey: provider.requiresKey,
      paid: provider.paid,
      accessText: provider.accessLabel,
      accessTypes: provider.accessTypes,
      modalities: provider.modalities,
      streaming: provider.streaming,
      freeTierSummary: provider.freeTierSummary,
      rateLimitNote: provider.rateLimitNote,
      setupSteps: provider.setupSteps,
      envVar: provider.envVar,
      limitations: provider.limitations,
      modelCount: models.length,
      selectableCount: selectable.length,
      verifiedModels: Array.from(new Set(credential?.verifiedModels ?? [])),
      connected,
      canTest: provider.adapter === "ollama" ? isOperator : hasSession || !provider.requiresKey,
      liveStatus,
      liveDetail,
    };
  });

  const connectedCount = providers.filter((provider) => provider.connected).length;
  const keyProviders = PROVIDERS.filter((provider) => provider.requiresKey);
  const verifiedKeys = keyProviders.filter((provider) =>
    credentials.some((credential) => credential.providerId === provider.id && credential.verified),
  ).length;
  const totalSelectable = catalog.filter(
    (model) => model.status === "available" || model.status === "untested",
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Access control"
        title="Providers"
        description={
          hasSession
            ? "Every provider is listed with its modalities, access category, connection state, setup steps, quota notes, and documentation. Test Connection makes a real request; nothing is marked connected without evidence."
            : "See which providers power this deployment, which are public, and what each requires. You can add your own provider key without creating an account; server-local Ollama requires a signed-in account, so keep registration closed on public deployments."
        }
        actions={
          <>
            <Link href="/api-keys" className="btn btn-secondary">
              <KeyRound className="h-4 w-4" />
              API keys
            </Link>
            <Link href="/models" className="btn btn-primary">
              <Server className="h-4 w-4" />
              Open catalog
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Providers" value={PROVIDERS.length} hint="Registry entries" />
        <Stat
          label="Connected"
          value={connectedCount}
          hint="At least one selectable model"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <Stat
          label="Keys verified"
          value={hasSession ? `${verifiedKeys}/${keyProviders.length}` : `—/${keyProviders.length}`}
          hint={hasSession ? "BYOK providers in this session" : "Add a key to verify"}
        />
        <Stat
          label="Selectable models"
          value={totalSelectable}
          hint="For this session"
        />
      </div>

      <Alert tone="teal" title="How access categories work">
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>
            <strong className="text-emerald-200">FREE TIER</strong> — no paid usage expected
          </span>
          <span>
            <strong className="text-amber-200">LIMITED FREE</strong> — quota or rate limit applies
          </span>
          <span>
            <strong className="text-cyan-200">LOCAL — NO API FEE</strong> — runs on your hardware
          </span>
          <span>
            <strong className="text-violet-200">BYOK</strong> — your key, paid or credit-based
          </span>
          <span>
            <strong className="text-slate-400">UNAVAILABLE</strong> — not usable here
          </span>
        </span>
      </Alert>

      <ProvidersClient providers={providers} />

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <RefreshCw className="mt-0.5 h-4 w-4 text-blue-300" />
            <div>
              <h2 className="text-sm font-semibold text-white">Connection tests are real</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                {hasSession
                  ? "A connection test calls the provider with your saved credentials or the local Ollama daemon. Results update the stored verification state and refresh this page. No test simulates success, and no provider is retried against a paid fallback."
                  : "Keyless connection tests call the provider directly. Add a key in API Keys (no account required) to test a BYOK provider; server-local Ollama requires a signed-in account. No test simulates success, and no provider is retried against a paid fallback."}
              </p>
            </div>
          </div>
          <Link href="/models" className="btn btn-secondary px-3 py-1.5 text-xs">
            Review all access states
          </Link>
        </div>
      </Card>
    </div>
  );
}
