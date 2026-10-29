"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Clipboard,
  Download,
  Info,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Square,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { ProviderMark, SimpleAccessBadge } from "@/components/access";
import { Alert, Card, EmptyState, FieldLabel } from "@/components/ui";
import { describeClientError } from "@/lib/client/api";
import { appendLocalRun } from "@/lib/client/local-history";
import type { SelectableModel } from "@/lib/providers/runtime";
import { dailyUsageCounter, DAILY_LIMIT_MESSAGE, type DailyUsage } from "@/lib/usage/policy";
import { cn, formatDuration, formatTokens } from "@/lib/utils";

type Usage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type ChatMeta = {
  providerName: string;
  modelId: string;
  latencyMs: number;
  usage: Usage;
  usageAvailable: boolean;
  finishReason: string | null;
  requestId: string | null;
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: ChatMeta;
  error?: boolean;
};

type ChatResponse = {
  runId: string;
  model: { providerName: string; modelId: string };
  output: string;
  latencyMs: number;
  usage: Usage;
  usageAvailable: boolean;
  finishReason: string | null;
  requestId: string | null;
  dailyUsage?: DailyUsage;
};

type UiError = { message: string; code?: string; details?: string };

const EMPTY_USAGE: Usage = { promptTokens: null, completionTokens: null, totalTokens: null };

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const TEMPLATES = [
  {
    label: "Explain simply",
    prompt: "Explain the following concept in plain language with one concrete example:\n\n",
  },
  {
    label: "Summarize",
    prompt: "Summarize the following text in five concise bullet points. Flag anything uncertain:\n\n",
  },
  {
    label: "Review code",
    prompt:
      "Review the following code. List correctness bugs first, then security issues, then simpler alternatives. Be specific and reference line snippets:\n\n",
  },
  {
    label: "Rewrite",
    prompt: "Rewrite the following text to be clearer and more concise while keeping the meaning:\n\n",
  },
  {
    label: "Brainstorm",
    prompt: "Brainstorm ten practical ideas for the following goal. Group them by effort level:\n\n",
  },
];

function usageSummary(meta: ChatMeta): string {
  if (!meta.usageAvailable) return "Usage not reported";
  const parts: string[] = [];
  if (meta.usage.promptTokens !== null) parts.push(`${formatTokens(meta.usage.promptTokens)} in`);
  if (meta.usage.completionTokens !== null) parts.push(`${formatTokens(meta.usage.completionTokens)} out`);
  if (meta.usage.totalTokens !== null) parts.push(`${formatTokens(meta.usage.totalTokens)} total`);
  return parts.length > 0 ? `Tokens: ${parts.join(" · ")}` : "Usage not reported";
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

export default function TextPlayground({
  models,
  defaultModelRef,
  defaultSystemPrompt,
  isAuthenticated,
  usage,
  onUsageChange,
  requestedError = null,
}: {
  models: SelectableModel[];
  defaultModelRef: string | null;
  defaultSystemPrompt: string;
  isAuthenticated: boolean;
  usage: DailyUsage;
  onUsageChange: (usage: DailyUsage) => void;
  requestedError?: string | null;
}) {
  const textModels = useMemo(
    () => models.filter((model) => model.capabilities.includes("text")),
    [models],
  );

  const [modelRef, setModelRef] = useState(defaultModelRef ?? textModels[0]?.ref ?? "");
  // A model requested from the catalog that cannot be used must never be
  // silently replaced. Sending stays blocked until the visitor explicitly
  // dismisses the notice and chooses a selectable model. The page keys this
  // component by the requested ref, so navigation resets this state.
  const [requestedBlock, setRequestedBlock] = useState(Boolean(requestedError));
  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [streaming, setStreaming] = useState(true);

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const exhausted = usage.exhausted;

  const abortRef = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const selected =
    textModels.find((model) => model.ref === modelRef) ?? textModels[0] ?? null;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, loading]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function applyDailyUsage(value: unknown) {
    const candidate = value as Partial<DailyUsage> | null | undefined;
    if (
      candidate &&
      typeof candidate.limit === "number" &&
      typeof candidate.used === "number" &&
      typeof candidate.remaining === "number" &&
      typeof candidate.exhausted === "boolean"
    ) {
      onUsageChange(candidate as DailyUsage);
    }
  }

  function buildMessages(conversation: ChatTurn[]) {
    return [
      ...(systemPrompt.trim()
        ? [{ role: "system" as const, content: systemPrompt.trim() }]
        : []),
      ...conversation.map((turn) => ({ role: turn.role, content: turn.content })),
    ];
  }

  function recordLocalChat(args: {
    conversation: ChatTurn[];
    status: "success" | "error";
    runId?: string;
    output?: string;
    latencyMs?: number | null;
    usage?: Usage;
    usageAvailable?: boolean;
    requestId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }) {
    if (isAuthenticated || !selected) return;
    const prompt =
      [...args.conversation].reverse().find((turn) => turn.role === "user")?.content ?? "";
    appendLocalRun({
      id: args.runId,
      kind: "chat",
      modelRef: selected.ref,
      providerId: selected.providerId,
      modelId: selected.modelId,
      prompt,
      output: args.output ?? null,
      status: args.status,
      latencyMs: args.latencyMs ?? null,
      promptTokens: args.usage?.promptTokens ?? null,
      completionTokens: args.usage?.completionTokens ?? null,
      totalTokens: args.usage?.totalTokens ?? null,
      usageAvailable: args.usageAvailable ?? false,
      providerRequestId: args.requestId ?? null,
      accessType: selected.accessType,
      providerName: selected.providerName,
      modelName: selected.name,
      systemPrompt: systemPrompt.trim() || null,
      errorCode: args.errorCode ?? null,
      errorMessage: args.errorMessage ?? null,
    });
  }

  async function runConversation(conversation: ChatTurn[]) {
    if (!selected || exhausted) return;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = newRequestId();

    const assistantId = `assistant-${Date.now()}`;
    const useStream = streaming && selected.streaming;

    if (useStream) {
      setTurns([...conversation, { id: assistantId, role: "assistant", content: "" }]);
    }

    try {
      const payload = {
        modelRef: selected.ref,
        messages: buildMessages(conversation),
        temperature,
        maxTokens,
      };

      if (!useStream) {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as
          | ChatResponse
          | {
              error?: { code?: string; message?: string; details?: string };
              runId?: string;
              dailyUsage?: DailyUsage;
            }
          | null;
        if (!response.ok || !data || (data as { error?: unknown }).error) {
          const failed = data as
            | {
                error?: { code?: string; message?: string; details?: string };
                runId?: string;
                dailyUsage?: DailyUsage;
              }
            | null;
          applyDailyUsage(failed?.dailyUsage);
          const err = failed?.error;
          throw Object.assign(new Error(err?.message ?? "The request failed."), {
            code: err?.code,
            details: err?.details,
            runId: failed?.runId,
            dailyUsage: failed?.dailyUsage,
          });
        }
        const payloadData = data as ChatResponse;
        applyDailyUsage(payloadData.dailyUsage);
        recordLocalChat({
          conversation,
          status: "success",
          runId: payloadData.runId,
          output: payloadData.output,
          latencyMs: payloadData.latencyMs,
          usage: payloadData.usage,
          usageAvailable: payloadData.usageAvailable,
          requestId: payloadData.requestId,
        });
        setTurns([
          ...conversation,
          {
            id: `assistant-${payloadData.runId}`,
            role: "assistant",
            content: payloadData.output,
            meta: {
              providerName: payloadData.model.providerName,
              modelId: payloadData.model.modelId,
              latencyMs: payloadData.latencyMs,
              usage: payloadData.usage,
              usageAvailable: payloadData.usageAvailable,
              finishReason: payloadData.finishReason,
              requestId: payloadData.requestId,
            },
          },
        ]);
        return;
      }

      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": requestId },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | {
              error?: { code?: string; message?: string; details?: string };
              dailyUsage?: DailyUsage;
            }
          | null;
        applyDailyUsage(data?.dailyUsage);
        throw Object.assign(new Error(data?.error?.message ?? "The request failed."), {
          code: data?.error?.code,
          details: data?.error?.details,
          dailyUsage: data?.dailyUsage,
        });
      }
      if (!response.body) {
        throw new Error("The server returned no stream body.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let meta: ChatMeta | null = null;
      let streamError: UiError | null = null;
      let streamRunId: string | undefined;

      const applyTurn = () => {
        setTurns([
          ...conversation,
          {
            id: assistantId,
            role: "assistant",
            content: assistantText,
            meta: meta ?? undefined,
            error: streamError ? true : undefined,
          },
        ]);
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            const parsed = parseSseBlock(block);
            if (!parsed) continue;
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(parsed.data) as Record<string, unknown>;
            } catch {
              continue;
            }
            applyDailyUsage(data.dailyUsage);
            if (parsed.event === "delta" && typeof data.text === "string") {
              assistantText += data.text;
              applyTurn();
            } else if (parsed.event === "done") {
              streamRunId = typeof data.runId === "string" ? data.runId : undefined;
              meta = {
                providerName: selected.providerName,
                modelId: selected.modelId,
                latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : 0,
                usage: (data.usage as Usage) ?? EMPTY_USAGE,
                usageAvailable: data.usageAvailable === true,
                finishReason: typeof data.finishReason === "string" ? data.finishReason : null,
                requestId: typeof data.requestId === "string" ? data.requestId : null,
              };
              applyTurn();
            } else if (parsed.event === "error") {
              streamRunId = typeof data.runId === "string" ? data.runId : undefined;
              streamError = {
                code: typeof data.code === "string" ? data.code : undefined,
                message:
                  typeof data.message === "string" ? data.message : "The provider request failed.",
              };
              setError(streamError);
              applyTurn();
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (streamError && !assistantText) {
        setTurns(conversation);
      }
      if (streamError) {
        recordLocalChat({
          conversation,
          status: "error",
          runId: streamRunId,
          errorCode: streamError.code ?? "provider_error",
          errorMessage: streamError.message,
        });
      } else if (meta) {
        recordLocalChat({
          conversation,
          status: "success",
          runId: streamRunId,
          output: assistantText,
          latencyMs: meta.latencyMs,
          usage: meta.usage,
          usageAvailable: meta.usageAvailable,
          requestId: meta.requestId,
        });
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        setError({ message: "Generation stopped.", code: "aborted" });
      } else {
        applyDailyUsage((caught as { dailyUsage?: DailyUsage } | null)?.dailyUsage);
        const described = describeClientError(caught);
        setError(described);
        setTurns(conversation);
        const failed = caught as { runId?: string } | null;
        recordLocalChat({
          conversation,
          status: "error",
          runId: failed?.runId,
          errorCode: described.code ?? "request_failed",
          errorMessage: described.message,
        });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const prompt = input.trim();
    if (!prompt || loading || !selected || requestedBlock || exhausted) return;
    const userTurn: ChatTurn = { id: `user-${Date.now()}`, role: "user", content: prompt };
    const conversation = [...turns, userTurn];
    setTurns(conversation);
    setInput("");
    await runConversation(conversation);
  }

  async function regenerate() {
    if (loading || requestedBlock || exhausted) return;
    const lastUserIndex = [...turns].reverse().findIndex((turn) => turn.role === "user");
    if (lastUserIndex === -1) return;
    const index = turns.length - 1 - lastUserIndex;
    const conversation = turns.slice(0, index + 1);
    setTurns(conversation);
    await runConversation(conversation);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clear() {
    abortRef.current?.abort();
    setTurns([]);
    setInput("");
    setError(null);
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError({ message: "Clipboard access was blocked by the browser." });
    }
  }

  function exportTranscript() {
    const lines = [
      "# AI Playground transcript",
      "",
      `- Model: ${selected?.name ?? "unknown"} (${selected?.modelId ?? "unknown"})`,
      `- Provider: ${selected?.providerName ?? "unknown"}`,
      `- Access: ${selected?.accessType ?? "unknown"}`,
      `- Exported: ${new Date().toISOString()}`,
      "",
      "## System instruction",
      "",
      systemPrompt.trim() || "(none)",
      "",
      "## Conversation",
      "",
    ];
    for (const turn of turns) {
      lines.push(turn.role === "user" ? "### User" : "### Assistant");
      lines.push("");
      lines.push(turn.content);
      if (turn.meta) {
        lines.push("");
        lines.push(
          `_${turn.meta.providerName} · ${turn.meta.modelId} · ${formatDuration(turn.meta.latencyMs)} · ${usageSummary(turn.meta)}_`,
        );
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `playground-transcript-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const canRegenerate = !loading && !exhausted && turns.some((turn) => turn.role === "user");
  const supportsTemperature = selected ? selected.parameters.includes("temperature") : true;
  const supportsMaxTokens = selected ? selected.parameters.includes("max_tokens") : true;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      {requestedError && requestedBlock ? (
        <div className="lg:col-span-2">
          <Alert tone="amber" title="Requested model is not selectable">
            <div className="space-y-2">
              <p>{requestedError}</p>
              <p>
                The selector currently shows{" "}
                <strong>{selected?.name ?? "no text model"}</strong>. No message has been sent and
                no different model will be used automatically.
              </p>
              <button
                type="button"
                onClick={() => setRequestedBlock(false)}
                className="btn btn-secondary px-2.5 py-1 text-xs"
              >
                I understand — use the selector
              </button>
            </div>
          </Alert>
        </div>
      ) : null}
      <Card className="flex min-h-[640px] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {selected ? <ProviderMark icon={selected.providerIcon} name={selected.providerName} /> : null}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-white">
                  {selected?.name ?? "No text model"}
                </p>
                {selected ? <SimpleAccessBadge label={selected.playgroundLabel} /> : null}
              </div>
              <p className="truncate text-[11px] text-slate-500">
                {selected
                  ? selected.providerName
                  : "No compatible text model is currently selectable"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={regenerate}
              disabled={!canRegenerate}
              className="btn btn-ghost px-2.5 py-1.5 text-xs"
              title="Regenerate the last response"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={turns.length === 0 && !input}
              className="btn btn-ghost px-2.5 py-1.5 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
          {turns.length === 0 && !loading ? (
            <EmptyState
              icon={<Sparkles className="h-5 w-5" />}
              title={selected ? "Start a real conversation" : "No selectable text model"}
              action={
                !selected ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {isAuthenticated ? (
                      <Link href="/api-keys" className="btn btn-primary">
                        Add an API key
                      </Link>
                    ) : (
                      <Link href="/models" className="btn btn-primary">
                        Browse model catalog
                      </Link>
                    )}
                    <Link href="/providers" className="btn btn-secondary">
                      Provider setup
                    </Link>
                  </div>
                ) : undefined
              }
            >
              {selected
                ? `Messages go directly to ${selected.providerName}. Responses stream when the provider supports it. Up to 30 messages or 30,000 characters per request.${isAuthenticated ? "" : " Results are saved in this browser's local history."}`
                : isAuthenticated
                  ? "Verify a provider key, start Ollama locally, or add your own OpenAI-compatible endpoint to enable text generation."
                  : "No text model is enabled for public use. The deployment operator can enable a keyless verified model with PUBLIC_MODEL_REFS."}
            </EmptyState>
          ) : null}

          {turns.map((turn) => (
            <div
              key={turn.id}
              className={cn("animate-fade-up flex", turn.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[94%] rounded-2xl border px-4 py-3 sm:max-w-[86%]",
                  turn.role === "user"
                    ? "border-blue-400/25 bg-blue-500/10"
                    : turn.error
                      ? "border-red-400/25 bg-red-400/5"
                      : "border-white/10 bg-white/[0.035]",
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                    {turn.role === "user" ? "You" : "Model"}
                  </p>
                  {turn.role === "assistant" && turn.content ? (
                    <button
                      type="button"
                      onClick={() => copy(turn.content, turn.id)}
                      className="text-slate-600 transition hover:text-blue-300"
                      aria-label="Copy response"
                    >
                      {copiedId === turn.id ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Clipboard className="h-3 w-3" />
                      )}
                    </button>
                  ) : null}
                </div>
                <div className="prose-output text-slate-100">
                  {turn.content || (loading && turn.role === "assistant" ? "…" : "")}
                </div>
                {turn.meta ? (
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/8 pt-2 text-[10px] text-slate-500">
                    <span>{turn.meta.providerName}</span>
                    <span className="font-mono">{turn.meta.modelId}</span>
                    <span>{formatDuration(turn.meta.latencyMs)}</span>
                    <span>{usageSummary(turn.meta)}</span>
                    {turn.meta.finishReason ? (
                      <span className="capitalize">finish: {turn.meta.finishReason}</span>
                    ) : null}
                    {turn.meta.requestId ? (
                      <span className="truncate" title={turn.meta.requestId}>
                        req: {turn.meta.requestId.slice(0, 18)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {loading ? (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl border border-blue-400/20 bg-blue-500/[0.06] px-4 py-3 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-blue-300" />
                {streaming ? "Streaming from" : "Waiting for"} {selected?.providerName ?? "provider"}…
              </div>
            </div>
          ) : null}
          <div ref={transcriptEndRef} />
        </div>

        <div className="border-t border-white/8 bg-black/25 px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 font-medium",
                exhausted ? "text-amber-300" : "text-slate-400",
              )}
            >
              <MessageSquare className="h-3 w-3" />
              {dailyUsageCounter(usage)}
            </span>
            <span className="text-slate-600">
              Shared by text, image, comparison, and connection tests.
            </span>
          </div>
          {exhausted ? (
            <Alert tone="amber" title="Daily limit reached" className="mb-3">
              {DAILY_LIMIT_MESSAGE}
            </Alert>
          ) : null}
          {error && error.code !== "daily_limit_reached" ? (
            <Alert
              tone={error.code === "aborted" ? "neutral" : "red"}
              title={error.code ? `Request failed (${error.code})` : "Request failed"}
              className="mb-3"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {error.message}
                  {error.details ? (
                    <span className="mt-1 block text-xs opacity-80">{error.details}</span>
                  ) : null}
                </span>
                {canRegenerate && error.code !== "aborted" ? (
                  <button
                    type="button"
                    onClick={regenerate}
                    className="btn btn-secondary px-2.5 py-1 text-xs"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                ) : null}
              </span>
            </Alert>
          ) : null}
          <form ref={formRef} onSubmit={submit} className="flex items-end gap-2">
            <textarea
              aria-label="Prompt"
              className="field max-h-56 min-h-[64px] flex-1 resize-y"
              placeholder={
                selected
                  ? "Send a message… (Enter to send, Shift+Enter for a new line)"
                  : "No text model available"
              }
              value={input}
              maxLength={8000}
              disabled={!selected || loading || requestedBlock || exhausted}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
            />
            {loading ? (
              <button
                type="button"
                onClick={stop}
                className="btn btn-danger h-[64px] w-[64px] shrink-0 p-0"
                aria-label="Stop generation"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!selected || !input.trim() || requestedBlock || exhausted}
                className="btn btn-primary h-[64px] w-[64px] shrink-0 p-0"
                aria-label="Send message"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            )}
          </form>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <Info className="h-3 w-3 shrink-0" />
              Do not send secrets or confidential data to anonymous free tiers.
            </span>
            <span>
              {turns.filter((turn) => turn.role === "user").length} turn
              {turns.filter((turn) => turn.role === "user").length === 1 ? "" : "s"} ·{" "}
              {streaming && selected?.streaming ? "streaming on" : "streaming off"}
            </span>
          </div>
        </div>
      </Card>

      <aside className="order-first space-y-4 lg:order-last lg:sticky lg:top-6 lg:self-start">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-semibold text-white">Model & access</h2>
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              <div>
                <FieldLabel htmlFor="text-provider">Provider</FieldLabel>
                <select
                  id="text-provider"
                  className="field"
                  value={selected?.providerId ?? ""}
                  onChange={(event) => {
                    const providerId = event.target.value;
                    const first = textModels.find((model) => model.providerId === providerId);
                    if (first) {
                      setModelRef(first.ref);
                      setRequestedBlock(false);
                    }
                  }}
                  disabled={textModels.length === 0}
                >
                  {Array.from(new Set(textModels.map((model) => model.providerId))).map((providerId) => {
                    const providerName = textModels.find((m) => m.providerId === providerId)?.providerName ?? providerId;
                    return (
                      <option key={providerId} value={providerId}>
                        {providerName}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <FieldLabel htmlFor="text-model">Model</FieldLabel>
                <select
                  id="text-model"
                  className="field"
                  value={selected?.ref ?? ""}
                  onChange={(event) => {
                    setModelRef(event.target.value);
                    setRequestedBlock(false);
                  }}
                  disabled={textModels.length === 0}
                >
                  {textModels
                    .filter((model) => (selected ? model.providerId === selected.providerId : true))
                    .map((model) => (
                      <option key={model.ref} value={model.ref}>
                        {model.name} — {model.playgroundLabel}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {selected ? (
              <div className="rounded-xl border border-white/8 bg-black/25 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-white">{selected.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {selected.providerName}
                    </p>
                  </div>
                  <SimpleAccessBadge label={selected.playgroundLabel} />
                </div>
                <Link
                  href={`/models/detail?ref=${encodeURIComponent(selected.ref)}&playground=text`}
                  className="mt-2 inline-flex text-[11px] text-blue-300 hover:text-blue-200"
                >
                  View catalog details
                </Link>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-semibold text-white">Request settings</h2>
          </div>
          <div className="space-y-3">
            <div>
              <FieldLabel htmlFor="system-prompt" hint={`${systemPrompt.length}/4000`}>
                System instruction (optional)
              </FieldLabel>
              <textarea
                id="system-prompt"
                className="field min-h-[84px] resize-y text-xs"
                maxLength={4000}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder="Optional behavior, tone, or constraints"
              />
            </div>
            <div>
              <FieldLabel htmlFor="text-temperature" hint={supportsTemperature ? temperature.toFixed(2) : "unsupported"}>
                Temperature
              </FieldLabel>
              <input
                id="text-temperature"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                disabled={!supportsTemperature}
                onChange={(event) => setTemperature(Number(event.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
            <div>
              <FieldLabel htmlFor="text-max-tokens" hint={supportsMaxTokens ? "1–4096" : "unsupported"}>
                Max output tokens
              </FieldLabel>
              <input
                id="text-max-tokens"
                type="number"
                min={1}
                max={4096}
                value={maxTokens}
                disabled={!supportsMaxTokens}
                onChange={(event) =>
                  setMaxTokens(Math.min(4096, Math.max(1, Number(event.target.value) || 1)))
                }
                className="field"
              />
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
              <span>
                <span className="block text-xs font-medium text-slate-200">Stream response</span>
                <span className="block text-[10px] text-slate-500">
                  {selected && !selected.streaming
                    ? "This model does not support streaming."
                    : "Show tokens as the provider sends them."}
                </span>
              </span>
              <input
                type="checkbox"
                checked={streaming}
                disabled={Boolean(selected && !selected.streaming)}
                onChange={(event) => setStreaming(event.target.checked)}
                className="h-4 w-4 accent-blue-500"
              />
            </label>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-semibold text-white">Quick templates</h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => setInput((current) => template.prompt + current)}
                className="rounded-full border border-white/10 bg-white/[0.02] px-2.5 py-1 text-[11px] text-slate-400 transition hover:border-blue-400/30 hover:text-blue-200"
              >
                {template.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={exportTranscript}
              disabled={turns.length === 0}
              className="btn btn-secondary px-2.5 py-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
            <button
              type="button"
              onClick={() =>
                copy(
                  turns.map((turn) => `${turn.role === "user" ? "You" : "Model"}: ${turn.content}`).join("\n\n"),
                  "all",
                )
              }
              disabled={turns.length === 0}
              className="btn btn-secondary px-2.5 py-1.5 text-xs"
            >
              <Clipboard className="h-3.5 w-3.5" />
              {copiedId === "all" ? "Copied" : "Copy all"}
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={turns.length === 0 && !input}
              className="btn btn-ghost px-2.5 py-1.5 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </Card>

        <Alert tone="amber" title="Access policy">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Free and limited-free text routes appear first. Compatible untested models
              appear only after your provider key is verified. Paid, unsupported, and unavailable
              models stay in the Model Catalog; none is selected automatically. When you use your
              own provider key, any charges on that provider account are your responsibility — this
              app never falls back to a different model or the operator&apos;s key.
            </span>
          </span>
        </Alert>
      </aside>
    </div>
  );
}
