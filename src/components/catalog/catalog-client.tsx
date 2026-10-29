"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  FlaskConical,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  CatalogAccessBadge,
  ProviderMark,
} from "@/components/access";
import { Badge, Card, EmptyState, FieldLabel } from "@/components/ui";
import { describeClientError, requestJson } from "@/lib/client/api";
import {
  CATALOG_ACCESS_STATUSES,
  catalogAccessRank,
  catalogAccessStatus,
  matchesCatalogAccess,
  type CatalogAccessFilter,
  type CatalogAccessStatus,
} from "@/lib/providers/catalog-view";
import {
  operationForPlayground,
  type PlaygroundId,
} from "@/lib/providers/playground-support";
import type { RuntimeModel } from "@/lib/providers/runtime";
import type { ModelCapability } from "@/lib/providers/types";

type CatalogProviderOption = {
  id: string;
  name: string;
};

const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  text: "Text",
  "vision-input": "Image input",
  image: "Image generation",
  "audio-input": "Audio input",
  "audio-output": "Audio output",
  transcription: "Transcription",
  embeddings: "Embeddings",
  safety: "Safety / moderation",
  video: "Video",
  other: "Other",
};

const ACCESS_OPTION_LABELS: Record<CatalogAccessStatus, string> = {
  free: "Free",
  "limited-free": "Limited Free",
  "user-key-required": "User Key Required",
  paid: "Paid",
  unverified: "Unverified",
  unavailable: "Unavailable",
};

function accessOptions(advanced: boolean): Array<{ value: CatalogAccessFilter; label: string }> {
  // The default catalog only contains routes with verified FREE or LIMITED
  // FREE access. Every other retained status is available in the advanced view.
  const statuses = advanced
    ? CATALOG_ACCESS_STATUSES
    : (["free", "limited-free"] as const);
  return [
    { value: "all", label: "All free access labels" },
    ...statuses.map((status) => ({ value: status, label: ACCESS_OPTION_LABELS[status] })),
  ];
}

function openHref(ref: string, playground: PlaygroundId): string {
  return `/playground?task=${playground}&ref=${encodeURIComponent(ref)}`;
}

function preferredPlaygroundForModel(
  model: RuntimeModel,
  preferred: PlaygroundId,
): PlaygroundId | null {
  if (model.supportedOperations.includes(operationForPlayground(preferred))) {
    return preferred;
  }
  if (model.supportedOperations.includes("chat")) return "text";
  if (model.supportedOperations.includes("image")) return "image";
  return null;
}

function detailHref(model: RuntimeModel, playground: PlaygroundId | null): string {
  const base = `/models/detail?ref=${encodeURIComponent(model.ref)}`;
  return playground ? `${base}&playground=${playground}` : base;
}

export default function CatalogClient({
  models,
  providers,
  defaultPlayground = "text",
  advanced = false,
}: {
  models: RuntimeModel[];
  providers: CatalogProviderOption[];
  defaultPlayground?: PlaygroundId;
  advanced?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [access, setAccess] = useState<CatalogAccessFilter>("all");
  const [provider, setProvider] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return models
      .filter((model) => {
        if (provider !== "all" && model.providerId !== provider) return false;
        if (!matchesCatalogAccess(model, access)) return false;
        if (term) {
          const haystack =
            `${model.name} ${model.modelId} ${model.providerName} ${model.description}`.toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const accessDifference =
          catalogAccessRank(catalogAccessStatus(a)) -
          catalogAccessRank(catalogAccessStatus(b));
        if (accessDifference !== 0) return accessDifference;
        if (a.providerName !== b.providerName) {
          return a.providerName.localeCompare(b.providerName);
        }
        return a.name.localeCompare(b.name);
      });
  }, [models, provider, access, search]);

  const hasFilters = Boolean(search.trim()) || access !== "all" || provider !== "all";

  function clearFilters() {
    setSearch("");
    setAccess("all");
    setProvider("all");
  }

  function refreshModels() {
    setRefreshing(true);
    setRefreshError(null);
    void requestJson<{
      ok: boolean;
      providers: Array<{
        providerName: string;
        authenticated: boolean;
        count: number;
        error: string | null;
      }>;
    }>("/api/models/discover", { method: "POST" })
      .then((result) => {
        const failures = result.providers.filter((entry) => entry.error);
        if (failures.length > 0) {
          setRefreshError(
            `Some providers could not be refreshed: ${failures
              .map((entry) => entry.providerName)
              .join(", ")}. No models were invented for them.`,
          );
        }
      })
      .catch((error) => {
        setRefreshError(describeClientError(error).message);
      })
      .finally(() => {
        setRefreshing(false);
      });
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {advanced
                ? "All recorded models"
                : "Verified free and limited-free models"}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              {advanced
                ? "Every retained, discovered, unsupported, deprecated, paid, or currently unavailable record. This diagnostic view never removes data, and no model is selected automatically."
                : "Only models with verified FREE or LIMITED FREE inference for a configured route. Paid-only, user-key-required, unverified, unsupported, and confirmed-unavailable records remain in the registry and the advanced view. Provider charges on your own key are your responsibility."}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshModels}
            disabled={refreshing}
            className="btn btn-secondary px-2.5 py-1.5 text-xs"
            title="Refresh provider model lists"
            aria-label="Refresh provider model lists"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_240px]">
          <div>
            <FieldLabel htmlFor="catalog-search">Search</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="catalog-search"
                className="field pl-9"
                placeholder="Model, provider, or ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="catalog-access">Access</FieldLabel>
            <select
              id="catalog-access"
              className="field"
              value={access}
              onChange={(event) => setAccess(event.target.value as CatalogAccessFilter)}
            >
              {accessOptions(advanced).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="catalog-provider">Provider</FieldLabel>
            <select
              id="catalog-provider"
              className="field"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="all">All Providers</option>
              {providers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5" aria-live="polite">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Showing {filtered.length} of {models.length} {advanced ? "recorded" : "free"} models
          </span>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-slate-400 transition hover:text-blue-200"
            >
              <X className="h-3 w-3" />
              Clear filters
            </button>
          ) : null}
        </div>

        {refreshError ? (
          <p role="alert" className="mt-2 text-[11px] leading-5 text-red-300">
            {refreshError}
          </p>
        ) : null}
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-5 w-5" />}
          title="No models match these filters"
          action={
            hasFilters ? (
              <button type="button" onClick={clearFilters} className="btn btn-secondary">
                Clear filters
              </button>
            ) : undefined
          }
        >
          Try another search, access filter, or provider. The default view lists only
          models with a verified FREE or LIMITED FREE route. Other retained records stay
          in the advanced view, and a provider appears only when it has qualifying
          models for this session.
        </EmptyState>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((model) => (
            <CatalogModelCard
              key={model.ref}
              model={model}
              preferredPlayground={defaultPlayground}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogModelCard({
  model,
  preferredPlayground,
}: {
  model: RuntimeModel;
  preferredPlayground: PlaygroundId;
}) {
  const playground = preferredPlaygroundForModel(model, preferredPlayground);
  const accessStatus = catalogAccessStatus(model);
  const hasImplementedRoute = Boolean(playground);
  const disabledReason = hasImplementedRoute
    ? model.openDisabledReason ?? model.testDisabledReason
    : "No chat or image playground is implemented for this model";

  const capabilities = Array.from(new Set(model.capabilities));

  return (
    <Card className="surface-hover flex h-full min-w-0 flex-col gap-3 p-3.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <ProviderMark icon={model.providerIcon} name={model.providerName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <Link
              href={detailHref(model, playground)}
              className="min-w-0 truncate text-sm font-medium text-white transition hover:text-blue-200"
              title={`View details for ${model.name}`}
            >
              {model.name}
            </Link>
            <CatalogAccessBadge
              status={accessStatus}
              inferenceTested={model.accessEvidence === "inference_tested"}
              className="shrink-0 whitespace-nowrap"
            />
          </div>
          <p
            className="mt-0.5 truncate text-[11px] text-slate-500"
            title={model.providerName}
          >
            {model.providerName}
          </p>
        </div>
      </div>

      <p className="truncate text-xs text-slate-400" title={model.description}>
        {model.description}
      </p>

      {capabilities.length > 0 ? (
        <div className="flex flex-wrap gap-1" aria-label="Supported capabilities">
          {capabilities.map((capability) => (
            <Badge
              key={capability}
              tone="slate"
              className="px-1.5 py-0 text-[10px] text-slate-300"
            >
              {CAPABILITY_LABELS[capability]}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="min-h-5 min-w-0">
          {model.providerRequiresKey ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
              <KeyRound className="h-3 w-3 shrink-0" />
              API key required
            </span>
          ) : null}
        </div>
        <div className="ml-auto shrink-0">
          {hasImplementedRoute && playground ? (
            <Link
              href={openHref(model.ref, playground)}
              className="btn btn-primary px-3 py-1.5 text-xs"
              title={
                disabledReason
                  ? `Open this exact model in the unified playground. ${disabledReason}`
                  : "Open this exact model in the unified playground"
              }
              aria-label={`Test ${model.modelId} in the ${playground} playground`}
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Test
            </Link>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
