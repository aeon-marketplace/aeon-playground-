"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  ServerOff,
  Wifi,
} from "lucide-react";
import { AccessBadge, ProviderMark } from "@/components/access";
import { Alert, Badge, Card } from "@/components/ui";
import { describeClientError, requestJson } from "@/lib/client/api";
import type { AccessType, ModelCapability } from "@/lib/providers/types";

export type ProviderCardData = {
  id: string;
  name: string;
  description: string;
  icon: string;
  docsUrl: string;
  keyUrl?: string;
  websiteUrl: string;
  requiresKey: boolean;
  paid: boolean;
  accessText: string;
  accessTypes: AccessType[];
  modalities: ModelCapability[];
  streaming: boolean;
  freeTierSummary: string;
  rateLimitNote: string;
  setupSteps: string[];
  envVar?: string;
  limitations: string[];
  modelCount: number;
  selectableCount: number;
  verifiedModels: string[];
  connected: boolean;
  canTest: boolean;
  liveStatus: string;
  liveDetail: string;
};

type TestResult = {
  ok: boolean;
  status: string;
  message: string;
  models?: Array<{ id: string }>;
  verifiedModels?: string[];
};

export default function ProvidersClient({
  providers,
}: {
  providers: ProviderCardData[];
}) {
  const router = useRouter();
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});

  async function testConnection(provider: ProviderCardData) {
    setTesting(provider.id);
    setResults((current) => {
      const next = { ...current };
      delete next[provider.id];
      return next;
    });
    try {
      const result = await requestJson<TestResult>("/api/providers/test", {
        method: "POST",
        body: JSON.stringify({ providerId: provider.id, refresh: true }),
      });
      setResults((current) => ({ ...current, [provider.id]: result }));
      router.refresh();
    } catch (error) {
      const described = describeClientError(error);
      setResults((current) => ({
        ...current,
        [provider.id]: {
          ok: false,
          status: "failed",
          message: described.message,
        },
      }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {providers.map((provider) => {
        const result = results[provider.id];
        const busy = testing === provider.id;
        return (
          <Card key={provider.id} className="flex flex-col p-4 sm:p-5" strong>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <ProviderMark icon={provider.icon} name={provider.name} size="lg" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h2 className="text-base font-semibold text-white">{provider.name}</h2>
                    {provider.accessTypes.map((accessType) => (
                      <AccessBadge key={accessType} accessType={accessType} />
                    ))}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                    <span
                      className={`inline-flex items-center gap-1 ${
                        provider.connected ? "text-emerald-300" : "text-amber-300"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          provider.connected ? "bg-emerald-400 pulse-dot" : "bg-amber-400"
                        }`}
                      />
                      {provider.liveStatus}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{provider.modalities.join(" / ")}</span>
                    {provider.streaming ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Streaming</span>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {provider.paid ? <Badge tone="violet">Paid possible</Badge> : null}
                {!provider.requiresKey ? <Badge tone="teal">No key</Badge> : null}
              </div>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-400">{provider.description}</p>

            <div className="mt-3 rounded-xl border border-white/8 bg-black/25 px-3 py-2.5">
              <p className="text-[11px] leading-5 text-slate-400">{provider.freeTierSummary}</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                <span className="font-medium text-slate-400">Limits:</span> {provider.rateLimitNote}
              </p>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-white/8 bg-white/[0.02] px-2 py-1.5">
                <p className="text-sm font-semibold text-white">{provider.modelCount}</p>
                <p className="text-[10px] text-slate-500">in catalog</p>
              </div>
              <div className="rounded-lg border border-blue-400/20 bg-blue-500/[0.06] px-2 py-1.5">
                <p className="text-sm font-semibold text-blue-200">{provider.selectableCount}</p>
                <p className="text-[10px] text-slate-500">selectable</p>
              </div>
              <div className="rounded-lg border border-white/8 bg-white/[0.02] px-2 py-1.5">
                <p className="text-sm font-semibold text-white">{provider.verifiedModels.length}</p>
                <p className="text-[10px] text-slate-500">key-verified IDs</p>
              </div>
            </div>

            {provider.verifiedModels.length > 0 ? (
              <details className="mt-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-medium text-slate-400">
                  Model IDs returned by your account
                </summary>
                <div className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                  {provider.verifiedModels.slice(0, 120).map((modelId) => (
                    <code
                      key={modelId}
                      className="rounded border border-white/8 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                    >
                      {modelId}
                    </code>
                  ))}
                </div>
              </details>
            ) : null}

            <details className="mt-3 text-[11px] text-slate-500" open={!provider.connected}>
              <summary className="cursor-pointer font-medium text-slate-400">Setup instructions</summary>
              <ol className="mt-2 space-y-1.5">
                {provider.setupSteps.map((step, index) => (
                  <li key={step} className="flex gap-2 leading-5">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[9px] text-slate-400">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              {provider.envVar ? (
                <p className="mt-2 text-[10px] text-slate-500">
                  Server env: <code className="text-blue-300">{provider.envVar}</code>
                </p>
              ) : null}
            </details>

            <details className="mt-2 text-[11px] text-slate-500">
              <summary className="cursor-pointer font-medium text-slate-400">Known limitations</summary>
              <ul className="mt-2 space-y-1">
                {provider.limitations.map((limitation) => (
                  <li key={limitation} className="flex gap-2 leading-5">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                    {limitation}
                  </li>
                ))}
              </ul>
            </details>

            {provider.liveDetail ? (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-slate-500">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-300/70" />
                {provider.liveDetail}
              </p>
            ) : null}

            {result ? (
              <Alert
                tone={result.ok ? "green" : "amber"}
                title={`Connection test: ${result.status}`}
                className="mt-3"
              >
                {result.message}
                {result.models && result.models.length > 0 ? (
                  <p className="mt-1 text-[11px] opacity-80">
                    Installed models: {result.models.map((model) => model.id).join(", ")}
                  </p>
                ) : null}
              </Alert>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => testConnection(provider)}
                disabled={busy || !provider.canTest}
                title={
                  provider.canTest
                    ? undefined
                    : "Add a provider key in API Keys first (no account required). Server-local Ollama requires a signed-in account."
                }
                className="btn btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : provider.canTest ? (
                  provider.connected ? (
                    <Wifi className="h-3.5 w-3.5" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )
                ) : (
                  <KeyRound className="h-3.5 w-3.5" />
                )}
                {busy
                  ? "Testing…"
                  : !provider.canTest
                    ? "Connect key first"
                    : provider.connected
                      ? "Test connection"
                      : "Test & refresh"}
              </button>
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost px-2.5 py-1.5 text-xs"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Docs
              </a>
              {provider.keyUrl ? (
                <a
                  href={provider.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost px-2.5 py-1.5 text-xs"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Get key
                </a>
              ) : null}
              <a
                href={provider.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost px-2.5 py-1.5 text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Website
              </a>
              {provider.connected ? (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  Ready
                </span>
              ) : (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-500">
                  <ServerOff className="h-3 w-3" />
                  No selectable model
                </span>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
