"use client";

import Image from "next/image";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Download,
  Eye,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { AccessBadge } from "@/components/access";
import { Alert, Badge, Card, EmptyState, FieldLabel, Stat } from "@/components/ui";
import { describeClientError, requestJson } from "@/lib/client/api";
import {
  clearLocalRuns,
  deleteLocalRun,
  readLocalRuns,
  subscribeLocalHistory,
} from "@/lib/client/local-history";
import type { PublicRun } from "@/lib/db/runs";
import type { AccessType } from "@/lib/providers/types";
import { cn, formatDateTime, formatDuration, formatTokens } from "@/lib/utils";

type KindFilter = "all" | "chat" | "compare" | "image";
type StatusFilter = "all" | "success" | "error";

type HistoryRun = PublicRun & { imageUrl?: string | null };
type HistoryResponse = { runs: HistoryRun[]; total: number };

const EMPTY_LOCAL_RUNS: HistoryRun[] = [];

const ACCESS_TYPES: AccessType[] = ["free", "limited-free", "local", "byok", "unavailable"];

function asAccessType(value: string | null): AccessType | null {
  return value && ACCESS_TYPES.includes(value as AccessType) ? (value as AccessType) : null;
}

function kindTone(kind: string): "cyan" | "teal" | "green" | "neutral" {
  if (kind === "chat") return "cyan";
  if (kind === "compare") return "teal";
  if (kind === "image") return "green";
  return "neutral";
}

function runLabel(run: PublicRun): string {
  if (run.kind === "image") return "Image";
  if (run.kind === "compare") return "Compare";
  return "Chat";
}

export function runMarkdown(run: HistoryRun): string {
  const lines = [
    `### ${runLabel(run)} — ${run.status}`,
    "",
    `- Timestamp: ${new Date(run.createdAt).toISOString()}`,
    `- Provider: ${run.providerName ?? run.providerId} (${run.providerId})`,
    `- Model: ${run.modelName ?? run.modelId} (${run.modelId})`,
    `- Access category at test time: ${run.accessType ?? "not recorded"}`,
    `- Latency: ${formatDuration(run.latencyMs)}`,
    `- Usage: ${
      run.usageAvailable
        ? `${formatTokens(run.totalTokens)} total (${formatTokens(run.promptTokens)} in / ${formatTokens(run.completionTokens)} out)`
        : "not reported"
    }`,
  ];
  if (run.groupId) lines.push(`- Group: ${run.groupId}`);
  if (run.providerRequestId) lines.push(`- Provider request ID: ${run.providerRequestId}`);
  lines.push("", "#### Prompt", "", run.prompt || "—");
  if (run.systemPrompt) lines.push("", "#### System instruction", "", run.systemPrompt);
  if (run.status === "success" && run.output) {
    lines.push("", "#### Output", "", run.output);
  }
  if (run.status !== "success") {
    lines.push("", "#### Error", "", `${run.errorCode ?? "error"}: ${run.errorMessage ?? ""}`);
  }
  if (run.kind === "image" && run.status === "success") {
    lines.push(
      "",
      `#### Image`,
      "",
      run.imageUrl ? "Image is stored in this browser's local history." : `/api/images/${run.id}`,
    );
  }
  return lines.join("\n");
}

function RunCard({
  run,
  onDelete,
}: {
  run: HistoryRun;
  onDelete: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const success = run.status === "success";
  const accessType = asAccessType(run.accessType);

  async function copy() {
    try {
      await navigator.clipboard.writeText(runMarkdown(run));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the export button still works.
    }
  }

  function exportRun() {
    const blob = new Blob([runMarkdown(run)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `test-run-${run.id.slice(0, 8)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function remove() {
    setDeleting(true);
    try {
      await onDelete(run.id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={kindTone(run.kind)}>
              {run.kind === "image" ? (
                <ImageIcon className="h-3 w-3" />
              ) : (
                <MessageSquare className="h-3 w-3" />
              )}
              {runLabel(run)}
            </Badge>
            {success ? (
              <Badge tone="green">
                <CheckCircle2 className="h-3 w-3" />
                Success
              </Badge>
            ) : (
              <Badge tone="red">
                <XCircle className="h-3 w-3" />
                Failed
              </Badge>
            )}
            {accessType ? <AccessBadge accessType={accessType} /> : null}
            <span className="text-[11px] text-slate-500">{formatDateTime(run.createdAt)}</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-300">
            {run.providerName ?? run.providerId}
            <span className="mx-1.5 text-slate-700">/</span>
            <span className="text-slate-400">{run.modelName ?? run.modelId}</span>
          </p>
          <p className="mt-0.5 break-all font-mono text-[10px] text-slate-500">
            {run.providerId} / {run.modelId}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {formatDuration(run.latencyMs)}
          </span>
          {run.usageAvailable ? (
            <span>
              {formatTokens(run.totalTokens)} tokens
              {run.promptTokens !== null && run.completionTokens !== null ? (
                <span className="text-slate-600">
                  {" "}
                  ({formatTokens(run.promptTokens)} in / {formatTokens(run.completionTokens)} out)
                </span>
              ) : null}
            </span>
          ) : (
            <span>Usage not reported</span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Prompt</p>
          <p
            className={cn(
              "mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-300",
              !expanded && "line-clamp-3",
            )}
          >
            {run.prompt || "—"}
          </p>
        </div>

        {expanded && run.systemPrompt ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              System instruction
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-400">
              {run.systemPrompt}
            </p>
          </div>
        ) : null}

        {success && run.output ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              Output
            </p>
            <div
              className={cn(
                "prose-output mt-1 rounded-xl border border-white/8 bg-black/25 p-3 text-xs text-slate-200",
                !expanded && "max-h-40 overflow-hidden",
              )}
            >
              {run.output}
            </div>
          </div>
        ) : null}

        {!success ? (
          <Alert tone="red">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-red-300/80">
              {run.errorCode ?? "error"}
            </span>
            {run.errorMessage ?? "The request failed without a stored message."}
          </Alert>
        ) : null}

        {run.kind === "image" && success ? (
          <div className="relative h-56 w-full max-w-sm overflow-hidden rounded-xl border border-white/10 bg-black/30">
            <Image
              src={run.imageUrl ?? `/api/images/${run.id}`}
              alt={run.prompt || "Generated image"}
              fill
              unoptimized
              sizes="(max-width: 768px) 90vw, 384px"
              className="object-contain"
            />
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-600">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200"
        >
          <Eye className="h-3 w-3" />
          {expanded ? "Collapse" : "Expand"}
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 text-slate-400 hover:text-blue-200"
        >
          {copied ? <Check className="h-3 w-3" /> : <Clipboard className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={exportRun}
          className="inline-flex items-center gap-1 text-slate-400 hover:text-blue-200"
        >
          <Download className="h-3 w-3" />
          Export
        </button>
        {run.kind === "image" && success ? (
          <a
            href={run.imageUrl ?? `/api/images/${run.id}`}
            download={`image-${run.id}.jpg`}
            className="inline-flex items-center gap-1 text-slate-400 hover:text-blue-200"
          >
            <Download className="h-3 w-3" />
            Image
          </a>
        ) : null}
        {confirmDelete ? (
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="inline-flex items-center gap-1 text-red-300 hover:text-red-200"
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="text-slate-500 hover:text-slate-300"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-red-300"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
        {run.providerRequestId ? (
          <span className="break-all" title={run.providerRequestId}>
            req: {run.providerRequestId}
          </span>
        ) : null}
        {run.groupId ? <span className="break-all">group: {run.groupId.slice(0, 8)}</span> : null}
      </div>
    </Card>
  );
}

export default function HistoryClient({
  initialRuns,
  initialTotal,
  localOnly = false,
}: {
  initialRuns: HistoryRun[];
  initialTotal: number;
  localOnly?: boolean;
}) {
  const router = useRouter();
  const localRuns = useSyncExternalStore(
    subscribeLocalHistory,
    readLocalRuns,
    () => EMPTY_LOCAL_RUNS,
  );
  const [serverRuns, setServerRuns] = useState<HistoryRun[]>(initialRuns);
  const [serverTotal, setServerTotal] = useState(initialTotal);
  const runs = localOnly ? localRuns : serverRuns;
  const total = localOnly ? localRuns.length : serverTotal;
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (kind !== "all" && run.kind !== kind) return false;
      if (status !== "all" && run.status !== status) return false;
      if (!needle) return true;
      return [
        run.prompt,
        run.output ?? "",
        run.modelId,
        run.modelName ?? "",
        run.providerId,
        run.providerName ?? "",
        run.accessType ?? "",
        run.systemPrompt ?? "",
        run.errorMessage ?? "",
      ]
        .join("\n")
        .toLowerCase()
        .includes(needle);
    });
  }, [runs, kind, status, query]);

  const successCount = runs.filter((run) => run.status === "success").length;
  const errorCount = runs.length - successCount;
  const latencies = runs
    .filter((run) => run.status === "success" && typeof run.latencyMs === "number")
    .map((run) => run.latencyMs as number);
  const averageLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : null;

  async function refresh() {
    setRefreshing(true);
    setError(null);
    setMessage(null);
    if (localOnly) {
      setMessage("Local history is already up to date.");
      setRefreshing(false);
      return;
    }
    try {
      const data = await requestJson<HistoryResponse>("/api/history?limit=200");
      setServerRuns(data.runs);
      setServerTotal(data.total);
    } catch (err) {
      setError(describeClientError(err).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function deleteOne(id: string) {
    setError(null);
    setMessage(null);
    if (localOnly) {
      deleteLocalRun(id);
      setMessage("Deleted one local test run.");
      return;
    }
    try {
      await requestJson<{ ok: boolean }>(`/api/history/${id}`, { method: "DELETE" });
      setServerRuns((current) => current.filter((run) => run.id !== id));
      setServerTotal((current) => Math.max(0, current - 1));
      setMessage("Deleted one test run.");
      router.refresh();
    } catch (err) {
      setError(describeClientError(err).message);
      throw err;
    }
  }

  async function clearHistory() {
    setClearing(true);
    setError(null);
    setMessage(null);
    if (localOnly) {
      const deleted = runs.length;
      clearLocalRuns();
      setConfirmClear(false);
      setMessage(
        deleted > 0
          ? `Deleted ${deleted} local history record${deleted === 1 ? "" : "s"}.`
          : "There was no local history to delete.",
      );
      setClearing(false);
      return;
    }
    try {
      const data = await requestJson<{ ok: boolean; deleted: number }>("/api/history", {
        method: "DELETE",
      });
      setServerRuns([]);
      setServerTotal(0);
      setConfirmClear(false);
      setMessage(
        data.deleted > 0
          ? `Deleted ${data.deleted} history record${data.deleted === 1 ? "" : "s"}.`
          : "There was no history to delete.",
      );
      router.refresh();
    } catch (err) {
      setError(describeClientError(err).message);
    } finally {
      setClearing(false);
    }
  }

  function exportFiltered() {
    if (filtered.length === 0) return;
    const header = [
      "# Test history export",
      "",
      `- Exported: ${new Date().toISOString()}`,
      `- Runs: ${filtered.length}`,
      "",
    ];
    const body = filtered.map((run) => runMarkdown(run)).join("\n\n---\n\n");
    const blob = new Blob([[header.join("\n"), body].join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `test-history-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Total runs"
          value={total}
          hint={localOnly ? "Stored in this browser" : "Across all request types"}
        />
        <Stat
          label="Successful"
          value={successCount}
          hint={localOnly ? "In this browser" : "In the latest stored page"}
        />
        <Stat label="Errors" value={errorCount} hint="Real provider or validation errors" />
        <Stat label="Average latency" value={formatDuration(averageLatency)} hint="Successful runs" />
      </div>

      {error ? <Alert tone="red" title="History request failed">{error}</Alert> : null}
      {message ? <Alert tone="green">{message}</Alert> : null}

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px_auto_auto_auto] lg:items-end">
          <div>
            <FieldLabel htmlFor="history-search">Search</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="history-search"
                className="field pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Prompt, output, provider, model, access…"
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="history-kind">Type</FieldLabel>
            <select
              id="history-kind"
              className="field"
              value={kind}
              onChange={(event) => setKind(event.target.value as KindFilter)}
            >
              <option value="all">All types</option>
              <option value="chat">Chat</option>
              <option value="compare">Compare</option>
              <option value="image">Image</option>
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="history-status">Status</FieldLabel>
            <select
              id="history-status"
              className="field"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || clearing}
            className="btn btn-secondary"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
          <button
            type="button"
            onClick={exportFiltered}
            disabled={filtered.length === 0}
            className="btn btn-secondary"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          {confirmClear ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={clearHistory}
                disabled={clearing}
                className="btn btn-danger"
              >
                {clearing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                disabled={clearing}
                className="btn btn-ghost"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={runs.length === 0 || clearing}
              className="btn btn-ghost"
            >
              <Trash2 className="h-4 w-4" />
              Clear all
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Showing {runs.length} of {total} {localOnly ? "local" : "stored"} run
          {total === 1 ? "" : "s"}.{" "}
          {localOnly
            ? "Local history and generated image data stay in this browser and are never attached to a server account."
            : "Deleting a run or clearing history also removes any stored generated images."}
        </p>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-5 w-5" />}
          title={runs.length === 0 ? "No test runs yet" : "No runs match these filters"}
        >
          {runs.length === 0
            ? localOnly
              ? "Run a chat, comparison, or image request in the Playground and the real result will appear in this browser's local history."
              : "Run a chat, comparison, or image request in the Playground and the real result will appear here."
            : "Adjust the search or filters to see stored runs."}
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {filtered.map((run) => (
            <RunCard key={run.id} run={run} onDelete={deleteOne} />
          ))}
        </div>
      )}
    </div>
  );
}
