"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  GitCompare,
  Loader2,
  Sparkles,
} from "lucide-react";
import { AccessBadge } from "@/components/access";
import { Alert, Badge, Card, EmptyState, FieldLabel } from "@/components/ui";
import { describeClientError, requestJson } from "@/lib/client/api";
import { appendLocalRuns } from "@/lib/client/local-history";
import type { SelectableModel } from "@/lib/providers/runtime";
import { cn, formatDuration, formatTokens } from "@/lib/utils";

type Usage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type CompareResult = {
  runId?: string;
  modelRef: string;
  providerId: string;
  providerName: string;
  modelId: string;
  status: "success" | "error";
  output?: string;
  latencyMs?: number;
  usage?: Usage;
  usageAvailable?: boolean;
  requestId?: string | null;
  error?: { code: string; message: string; details?: string };
};

type CompareResponse = { groupId: string; results: CompareResult[] };

type UiError = { message: string; code?: string; details?: string };

function usageLine(result: CompareResult): string {
  if (!result.usageAvailable || !result.usage) return "Usage not reported";
  const parts: string[] = [];
  if (result.usage.promptTokens !== null) parts.push(`${formatTokens(result.usage.promptTokens)} in`);
  if (result.usage.completionTokens !== null) {
    parts.push(`${formatTokens(result.usage.completionTokens)} out`);
  }
  if (result.usage.totalTokens !== null) parts.push(`${formatTokens(result.usage.totalTokens)} total`);
  return parts.length > 0 ? parts.join(" · ") : "Usage not reported";
}

export default function CompareClient({
  models,
  isAuthenticated,
}: {
  models: SelectableModel[];
  isAuthenticated: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(
    models.slice(0, Math.min(2, models.length)).map((model) => model.ref),
  );
  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [results, setResults] = useState<CompareResult[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const modelByRef = new Map(models.map((model) => [model.ref, model]));
  const hasLimitedFree = selected.some(
    (ref) => modelByRef.get(ref)?.accessType === "limited-free",
  );

  const canSubmit =
    models.length >= 2 && selected.length >= 2 && selected.length <= 4 && prompt.trim().length > 0;

  function toggle(ref: string) {
    setSelected((current) => {
      if (current.includes(ref)) return current.filter((entry) => entry !== ref);
      if (current.length >= 4) return current;
      return [...current, ref];
    });
  }

  async function compare(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const currentPrompt = prompt.trim();
      const data = await requestJson<CompareResponse>("/api/compare", {
        method: "POST",
        body: JSON.stringify({
          modelRefs: selected,
          prompt: currentPrompt,
          systemPrompt,
          temperature,
          maxTokens,
        }),
      });
      setResults(data.results);
      if (!isAuthenticated) {
        appendLocalRuns(
          data.results.map((result) => {
            const model = modelByRef.get(result.modelRef);
            return {
              id: result.runId,
              kind: "compare" as const,
              groupId: data.groupId,
              modelRef: result.modelRef,
              providerId: result.providerId,
              modelId: result.modelId,
              prompt: currentPrompt,
              output: result.status === "success" ? (result.output ?? null) : null,
              status: result.status,
              latencyMs: result.latencyMs ?? null,
              promptTokens: result.usage?.promptTokens ?? null,
              completionTokens: result.usage?.completionTokens ?? null,
              totalTokens: result.usage?.totalTokens ?? null,
              usageAvailable: result.usageAvailable ?? false,
              providerRequestId: result.requestId ?? null,
              accessType: model?.accessType ?? null,
              providerName: result.providerName,
              modelName: model?.name ?? result.modelId,
              systemPrompt: systemPrompt.trim() || null,
              errorCode: result.error?.code ?? null,
              errorMessage: result.error?.message ?? null,
            };
          }),
        );
      }
    } catch (err) {
      setError(describeClientError(err));
    } finally {
      setLoading(false);
    }
  }

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError({ message: "Clipboard access was blocked by the browser." });
    }
  }

  function resultMarkdown(result: CompareResult): string {
    const model = modelByRef.get(result.modelRef);
    const lines = [
      `### ${result.modelId}`,
      "",
      `- Provider: ${result.providerName}`,
      `- Access: ${model?.accessType ?? "unknown"}`,
      `- Status: ${result.status}`,
      `- Latency: ${formatDuration(result.latencyMs)}`,
      `- Usage: ${usageLine(result)}`,
    ];
    if (result.status === "success") {
      lines.push("", result.output ?? "");
    } else {
      lines.push("", `Error: ${result.error?.code ?? "error"} — ${result.error?.message ?? ""}`);
    }
    return lines.join("\n");
  }

  function exportResults() {
    if (!results) return;
    const lines = [
      "# Model comparison",
      "",
      `- Prompt: ${prompt.trim()}`,
      `- System prompt: ${systemPrompt.trim() || "(none)"}`,
      `- Temperature: ${temperature.toFixed(2)}`,
      `- Max tokens: ${maxTokens}`,
      `- Exported: ${new Date().toISOString()}`,
      "",
    ];
    for (const result of results) {
      lines.push(resultMarkdown(result), "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `comparison-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <GitCompare className="h-4 w-4 text-blue-300" />
            Choose 2–4 models
          </h2>
          <span className="text-[11px] text-slate-500">{selected.length} selected</span>
        </div>

        {models.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={<GitCompare className="h-5 w-5" />} title="No text models available">
              Verify a provider key or a custom OpenAI-compatible endpoint first.
            </EmptyState>
          </div>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {models.map((model) => {
              const active = selected.includes(model.ref);
              const atLimit = selected.length >= 4 && !active;
              return (
                <button
                  key={model.ref}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(model.ref)}
                  disabled={atLimit || models.length < 2}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    active
                      ? "border-blue-400/40 bg-blue-500/10"
                      : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.04]",
                    atLimit && "cursor-not-allowed opacity-45",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{model.name}</p>
                      <p className="truncate text-[10px] text-slate-500">{model.providerName}</p>
                    </div>
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                        active
                          ? "border-blue-400 bg-blue-500 text-white"
                          : "border-white/15 bg-white/5 text-transparent",
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </div>
                  <div className="mt-1.5 truncate font-mono text-[10px] text-slate-500">
                    {model.modelId}
                  </div>
                  <div className="mt-2">
                    <AccessBadge accessType={model.accessType} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <form onSubmit={compare} className="space-y-4">
          <div>
            <FieldLabel htmlFor="compare-prompt" hint={`${prompt.length}/8000`}>
              Prompt
            </FieldLabel>
            <textarea
              id="compare-prompt"
              className="field min-h-[120px] resize-y"
              maxLength={8000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask the same question or give the same task to every selected model"
              disabled={loading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <FieldLabel htmlFor="compare-system" hint={`${systemPrompt.length}/4000`}>
                System prompt
              </FieldLabel>
              <textarea
                id="compare-system"
                className="field min-h-[84px] resize-y text-xs"
                maxLength={4000}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder="Optional"
                disabled={loading}
              />
            </div>
            <div>
              <FieldLabel htmlFor="compare-temperature" hint={temperature.toFixed(2)}>
                Temperature
              </FieldLabel>
              <input
                id="compare-temperature"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                onChange={(event) => setTemperature(Number(event.target.value))}
                className="w-full accent-blue-500"
                disabled={loading}
              />
            </div>
            <div>
              <FieldLabel htmlFor="compare-max-tokens" hint="1–4096">
                Max output tokens
              </FieldLabel>
              <input
                id="compare-max-tokens"
                type="number"
                min={1}
                max={4096}
                className="field"
                value={maxTokens}
                onChange={(event) =>
                  setMaxTokens(Math.min(4096, Math.max(1, Number(event.target.value) || 1)))
                }
                disabled={loading}
              />
            </div>
          </div>

          {error ? (
            <Alert
              tone="red"
              title={error.code ? `Comparison failed (${error.code})` : "Comparison failed"}
            >
              {error.message}
              {error.details ? (
                <span className="mt-1 block text-xs opacity-80">{error.details}</span>
              ) : null}
            </Alert>
          ) : null}

          {hasLimitedFree ? (
            <Alert tone="amber" title="One or more selected models use a limited free tier">
              Limited-free providers apply per-IP or per-account quotas. A comparison sends one real
              request per model, in parallel. Some may be rate-limited or slow. No paid fallback is
              attempted.
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={!canSubmit || loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {loading ? "Running all models…" : `Run comparison (${selected.length})`}
            </button>
            {models.length < 2 ? (
              <span className="text-[11px] text-amber-200/80">
                At least two selectable models are required.
              </span>
            ) : selected.length < 2 ? (
              <span className="text-[11px] text-amber-200/80">Select at least two models.</span>
            ) : null}
          </div>
        </form>
      </Card>

      {loading ? (
        <Card className="p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-blue-300" />
            <p className="text-sm text-slate-300">Running {selected.length} real requests in parallel…</p>
            <p className="max-w-md text-[11px] leading-5 text-slate-500">
              Slow or failed models do not block the others. Each panel reports its own latency,
              usage, and error.
            </p>
          </div>
        </Card>
      ) : null}

      {results ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Results</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500">
                {results.filter((result) => result.status === "success").length} of {results.length}{" "}
                succeeded · saved to {isAuthenticated ? "Test History" : "browser-local history"}
              </span>
              <button
                type="button"
                onClick={exportResults}
                className="btn btn-secondary px-2.5 py-1.5 text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
              <button
                type="button"
                onClick={() =>
                  copyText(results.map((result) => resultMarkdown(result)).join("\n\n"), "all")
                }
                className="btn btn-secondary px-2.5 py-1.5 text-xs"
              >
                <Clipboard className="h-3.5 w-3.5" />
                {copiedId === "all" ? "Copied" : "Copy all"}
              </button>
            </div>
          </div>
          <div
            className={cn(
              "grid gap-3",
              results.length > 2 ? "xl:grid-cols-2" : "md:grid-cols-2",
            )}
          >
            {results.map((result) => (
              <Card key={result.modelRef} className="flex flex-col p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-white">{result.modelId}</p>
                      {modelByRef.get(result.modelRef) ? (
                        <AccessBadge
                          accessType={modelByRef.get(result.modelRef)!.accessType}
                        />
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-slate-500">{result.providerName}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {result.status === "success" ? (
                      <Badge tone="green">
                        <CheckCircle2 className="h-3 w-3" />
                        Success
                      </Badge>
                    ) : (
                      <Badge tone="red">
                        <AlertCircle className="h-3 w-3" />
                        Failed
                      </Badge>
                    )}
                    <button
                      type="button"
                      onClick={() => copyText(resultMarkdown(result), result.modelRef)}
                      className="rounded-md p-1 text-slate-500 transition hover:bg-white/5 hover:text-blue-300"
                      aria-label="Copy result"
                      title="Copy result"
                    >
                      {copiedId === result.modelRef ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Clipboard className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex-1 rounded-xl border border-white/8 bg-black/25 p-3">
                  {result.status === "success" ? (
                    <div className="prose-output text-slate-100">{result.output}</div>
                  ) : (
                    <div className="space-y-1 text-xs leading-5 text-red-200">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-red-300/80">
                        {result.error?.code ?? "error"}
                      </p>
                      <p>{result.error?.message ?? "The provider request failed."}</p>
                      {result.error?.details ? (
                        <p className="text-[11px] text-red-200/70">{result.error.details}</p>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  <span>{formatDuration(result.latencyMs)}</span>
                  <span>{usageLine(result)}</span>
                  {result.requestId ? (
                    <span className="truncate" title={result.requestId}>
                      req: {result.requestId.slice(0, 16)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 break-all font-mono text-[10px] text-slate-600">
                  {result.modelRef}
                </p>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
