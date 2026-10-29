import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CircleSlash,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import {
  AccessBadge,
  AvailabilityBadge,
  CompatibilityBadge,
  FreeTierBadge,
  InferenceBadge,
  KeyValueRow,
  PricingBadge,
  ProviderMark,
  UserAccessBadge,
} from "@/components/access";
import ModelTestButton from "@/components/catalog/model-test-button";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { isCompatibleForCatalog } from "@/lib/providers/catalog-view";
import {
  PLAYGROUNDS,
  PLAYGROUND_LABELS,
  operationForPlayground,
  type PlaygroundId,
} from "@/lib/providers/playground-support";
import { getProvider } from "@/lib/providers/registry";
import { getRuntimeCatalog } from "@/lib/providers/runtime";
import { formatContext, formatTokens, cn } from "@/lib/utils";

export const metadata = { title: "Model details" };
export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function stateLabel(state: string): string {
  if (state === "verified") return "Live inference evidence recorded";
  if (state === "discovered") return "Provider metadata discovered; inference not tested";
  if (state === "requires_key") {
    return "Documented model; a provider key is required before this session can use it";
  }
  if (state === "unavailable") return "Unavailable or unsupported";
  return "Not verified";
}

export default async function ModelDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[]; playground?: string | string[] }>;
}) {
  const user = await getCurrentUser();

  const params = await searchParams;
  const rawRef = firstParam(params.ref);
  if (!rawRef) notFound();

  const catalog = await getRuntimeCatalog(user?.id ?? null);
  const model = catalog.find((entry) => entry.ref === rawRef);
  if (!model) notFound();

  const provider = getProvider(model.providerId);
  const context = formatContext(model.contextWindow);
  const requestedPlayground = firstParam(params.playground);
  const fallbackPlayground: PlaygroundId = model.supportedOperations.includes("chat")
    ? "text"
    : model.supportedOperations.includes("image")
      ? "image"
      : "text";
  const playground: PlaygroundId =
    requestedPlayground === "image" || requestedPlayground === "text"
      ? requestedPlayground
      : fallbackPlayground;
  const compatible = isCompatibleForCatalog(model, playground);
  const canOpen = compatible && model.canOpen;
  const canTest = compatible && model.canTest;
  const implementsOperation = model.supportedOperations.includes(
    operationForPlayground(playground),
  );
  const incompatibleReason = implementsOperation
    ? `UNSUPPORTED FOR THIS PLAYGROUND: ${model.statusDetail} No provider request is sent.`
    : `UNSUPPORTED FOR THIS PLAYGROUND: ${PLAYGROUND_LABELS[playground]} is not implemented for this exact model. No provider request is sent.`;
  const openDisabledReason = compatible ? model.openDisabledReason : incompatibleReason;
  const testDisabledReason = compatible ? model.testDisabledReason : incompatibleReason;
  const openHref = `/playground?task=${playground}&ref=${encodeURIComponent(model.ref)}`;
  const openLabel = "Open in Playground";
  const replacementModel = model.replacementModelRef
    ? catalog.find((entry) => entry.ref === model.replacementModelRef)
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/models?playground=${playground}`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 transition hover:text-blue-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to catalog
        </Link>
      </div>

      <PageHeader
        eyebrow={provider?.name ?? model.providerName}
        title={model.name}
        description={model.description}
        actions={
          <>
            {canOpen ? (
              <Link href={openHref} className="btn btn-primary">
                {openLabel}
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="btn btn-primary"
                title={openDisabledReason ?? "This model is not selectable."}
              >
                {openLabel}
              </button>
            )}
            <ModelTestButton
              modelRef={model.ref}
              modelId={model.modelId}
              playground={playground}
              canTest={canTest}
              disabledReason={testDisabledReason}
            />
            {model.status === "requires_key" ? (
              <Link href="/api-keys" className="btn btn-secondary">
                <KeyRound className="h-4 w-4" />
                Connect key
              </Link>
            ) : null}
            {model.docsUrl ?? model.verification.docsUrl ? (
              <a
                href={model.docsUrl ?? model.verification.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
              >
                <BookOpen className="h-4 w-4" />
                Docs
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ProviderMark icon={model.providerIcon} name={model.providerName} size="lg" />
        <CompatibilityBadge
          supported={compatible}
          title={
            compatible
              ? `${PLAYGROUND_LABELS[playground]} is implemented for this model. Compatibility is separate from availability.`
              : incompatibleReason
          }
        />
        <AvailabilityBadge state={model.availability.state} />
        <AccessBadge accessType={model.accessType} />
        <PricingBadge status={model.pricing.status} />
        <FreeTierBadge eligibility={model.freeTier.eligibility} />
        <UserAccessBadge state={model.userAccess.state} />
        <InferenceBadge state={model.inference.state} />
        {model.releaseStage && model.releaseStage !== "stable" ? (
          <Badge tone={model.releaseStage === "deprecated" ? "red" : "amber"}>
            {model.releaseStage}
          </Badge>
        ) : null}
        <Badge tone="teal">No paid fallback</Badge>
        {model.streaming ? <Badge tone="teal">Streaming</Badge> : <Badge tone="slate">Non-streaming</Badge>}
      </div>

      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">
          Compatibility, availability, pricing/free tier, access, and inference
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          These are deliberately separate. Compatibility is scoped to the selected playground; a
          supported operation does not prove uptime or free access. A published free price does not
          prove free-tier eligibility, a key listing does not prove model access, and model access
          does not prove successful inference.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-lg border border-white/8 bg-black/20 p-3">
            <CompatibilityBadge supported={compatible} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PLAYGROUNDS.map((option) => {
                const active = playground === option;
                return (
                  <Link
                    key={option}
                    href={`/models/detail?ref=${encodeURIComponent(model.ref)}&playground=${option}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
                      active
                        ? "border-blue-400/40 bg-blue-500/15 text-blue-100"
                        : "border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-slate-200",
                    )}
                  >
                    {PLAYGROUND_LABELS[option]}
                  </Link>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              {compatible
                ? `${PLAYGROUND_LABELS[playground]} is implemented for this exact model. This does not guarantee provider availability, free access, or successful inference.`
                : incompatibleReason}
            </p>
            <p className="mt-1 text-[10px] text-slate-600">
              Implemented operations:{" "}
              {model.supportedOperations.length > 0
                ? model.supportedOperations.join(", ")
                : "none in this app"}
            </p>
          </div>
          <div className="rounded-lg border border-white/8 bg-black/20 p-3">
            <AvailabilityBadge state={model.availability.state} />
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              {model.availability.detail}
            </p>
          </div>
          <div className="rounded-lg border border-white/8 bg-black/20 p-3">
            <PricingBadge status={model.pricing.status} />
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              {model.pricing.detail}
            </p>
            {model.pricing.sourceUrl ? (
              <a
                href={model.pricing.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200"
              >
                Pricing source
                <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : null}
            {model.pricing.checkedAt ? (
              <p className="mt-1 text-[10px] text-slate-600">
                Checked {model.pricing.checkedAt}
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border border-white/8 bg-black/20 p-3">
            <FreeTierBadge eligibility={model.freeTier.eligibility} />
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              {model.freeTier.detail}
            </p>
            {model.freeTier.sourceUrl ? (
              <a
                href={model.freeTier.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200"
              >
                Free-tier source
                <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : null}
          </div>
          <div className="rounded-lg border border-white/8 bg-black/20 p-3">
            <UserAccessBadge state={model.userAccess.state} />
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              {model.userAccess.detail}
            </p>
          </div>
          <div className="rounded-lg border border-white/8 bg-black/20 p-3">
            <InferenceBadge state={model.inference.state} />
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              {model.inference.detail}
            </p>
          </div>
        </div>
      </Card>

      {model.replacement ? (
        <Card className="border-amber-400/20 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <CircleSlash className="h-4 w-4 text-amber-300" />
            <h2 className="text-sm font-semibold text-white">
              Documented replacement — never selected automatically
            </h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Provider metadata lists this separate replacement model ID. It is not auto-selected,
            proxied, or tried as a fallback.
          </p>
          <code className="mt-1 inline-block break-all rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-amber-100">
            {model.replacementModelRef ?? `${model.providerId}::${model.replacement.modelId}`}
          </code>
          <p className="mt-2 text-xs leading-5 text-slate-400">{model.replacement.note}</p>
          {replacementModel ? (
            <Link
              href={`/models/detail?ref=${encodeURIComponent(
                replacementModel.ref,
              )}&playground=${playground}`}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200"
            >
              Inspect separate replacement model
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500">
              This replacement is not currently present in the discovered catalog for this session.
            </p>
          )}
          {model.replacement.docsUrl ? (
            <a
              href={model.replacement.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200"
            >
              Official replacement documentation
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-white">Identity and access</h2>
          <dl className="mt-2">
            <KeyValueRow label="Provider">{model.providerName}</KeyValueRow>
            <KeyValueRow label="Provider ID">
              <code className="font-mono text-[11px]">{model.providerId}</code>
            </KeyValueRow>
            <KeyValueRow label="Model name">{model.name}</KeyValueRow>
            <KeyValueRow label="Exact model ID">
              <code className="break-all font-mono text-[11px]">{model.modelId}</code>
            </KeyValueRow>
            <KeyValueRow label="Registry ref">
              <code className="break-all font-mono text-[11px]">{model.ref}</code>
            </KeyValueRow>
            <KeyValueRow label="Access category">
              <span className="inline-flex items-center gap-1.5">
                <AccessBadge accessType={model.accessType} />
              </span>
            </KeyValueRow>
            <KeyValueRow label="Selected playground">
              {PLAYGROUND_LABELS[playground]}
            </KeyValueRow>
            <KeyValueRow label="Compatibility">
              <CompatibilityBadge supported={compatible} />
            </KeyValueRow>
            <KeyValueRow label="Availability">
              <AvailabilityBadge state={model.availability.state} />
            </KeyValueRow>
            <KeyValueRow label="Pricing">
              <PricingBadge status={model.pricing.status} />
            </KeyValueRow>
            <KeyValueRow label="Free-tier eligibility">
              <FreeTierBadge eligibility={model.freeTier.eligibility} />
            </KeyValueRow>
            <KeyValueRow label="Your access">
              <UserAccessBadge state={model.userAccess.state} />
            </KeyValueRow>
            <KeyValueRow label="Inference">
              <InferenceBadge state={model.inference.state} />
            </KeyValueRow>
            <KeyValueRow label="Runtime status">{model.statusLabel}</KeyValueRow>
            <KeyValueRow label="Status detail">{model.statusDetail}</KeyValueRow>
            {model.shutdownDate ? (
              <KeyValueRow label="Documented shutdown">{model.shutdownDate}</KeyValueRow>
            ) : null}
            <KeyValueRow label="Modalities">{model.capabilities.join(", ")}</KeyValueRow>
            <KeyValueRow label="Access evidence">{model.accessEvidenceLabel}</KeyValueRow>
            <KeyValueRow label="Evidence detail">{model.accessEvidenceDetail}</KeyValueRow>
            {model.inferenceTestedAt ? (
              <KeyValueRow label="Last inference test">
                {new Date(model.inferenceTestedAt).toISOString()}
                {model.inferenceTestLatencyMs !== null
                  ? ` · ${model.inferenceTestLatencyMs} ms`
                  : ""}
              </KeyValueRow>
            ) : null}
            {model.inferenceTestError ? (
              <KeyValueRow label="Inference error">{model.inferenceTestError}</KeyValueRow>
            ) : null}
            <KeyValueRow label="Metadata evidence">
              {stateLabel(model.verification.state)}
            </KeyValueRow>
          </dl>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-white">Capabilities and limits</h2>
          <dl className="mt-2">
            <KeyValueRow label="Context window">{context ?? "Not published in registry"}</KeyValueRow>
            <KeyValueRow label="Input token limit">
              {model.inputTokenLimit ? formatTokens(model.inputTokenLimit) : "Not published"}
            </KeyValueRow>
            <KeyValueRow label="Output token limit">
              {model.outputTokenLimit
                ? formatTokens(model.outputTokenLimit)
                : model.maxOutputTokens
                  ? formatTokens(model.maxOutputTokens)
                  : "Not published"}
            </KeyValueRow>
            <KeyValueRow label="Parameters">
              {model.parameters.length > 0 ? model.parameters.join(", ") : "Not configurable"}
            </KeyValueRow>
            <KeyValueRow label="Streaming">{model.streaming ? "Supported" : "Not supported"}</KeyValueRow>
            <KeyValueRow label="Rate limits">{model.rateLimits ?? "Provider-defined"}</KeyValueRow>
            <KeyValueRow label="Structured output">Not claimed by this app</KeyValueRow>
            <KeyValueRow label="Tool calling">Not claimed by this app</KeyValueRow>
            {model.image ? (
              <KeyValueRow label="Image default">
                {model.image.defaultWidth}×{model.image.defaultHeight}
              </KeyValueRow>
            ) : null}
            {model.image ? (
              <KeyValueRow label="Image maximum">
                {model.image.maxWidth}×{model.image.maxHeight}
              </KeyValueRow>
            ) : null}
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-semibold text-white">Verification source</h2>
          </div>
          <dl className="mt-2">
            <KeyValueRow label="Method">{model.verification.method}</KeyValueRow>
            <KeyValueRow label="Last metadata check">{model.verification.checkedAt ?? "Not recorded"}</KeyValueRow>
            <KeyValueRow label="Metadata evidence">
              {model.verification.evidence ?? "No evidence recorded."}
            </KeyValueRow>
            <KeyValueRow label="Inference evidence">{model.accessEvidenceDetail}</KeyValueRow>
          </dl>
          {model.verification.docsUrl ? (
            <a
              href={model.verification.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200"
            >
              Verification documentation
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <CircleSlash className="h-4 w-4 text-amber-300" />
            <h2 className="text-sm font-semibold text-white">Limitations and unavailable reason</h2>
          </div>
          {model.unavailableReason ? (
            <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs leading-5 text-amber-100">
              {model.unavailableReason}
            </p>
          ) : null}
          <ul className="mt-3 space-y-1.5">
            {model.limitations.map((limitation) => (
              <li key={limitation} className="flex gap-2 text-xs leading-5 text-slate-400">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                {limitation}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {provider ? (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Provider notes</h2>
            <Link
              href="/providers"
              className="text-[11px] text-blue-300 hover:text-blue-200"
            >
              All providers
            </Link>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">{provider.freeTierSummary}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{provider.rateLimitNote}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {provider.accessTypes.map((accessType) => (
              <AccessBadge key={accessType} accessType={accessType} />
            ))}
            {provider.modalities.map((modality) => (
              <Badge key={modality} tone="cyan">
                {modality}
              </Badge>
            ))}
            {provider.requiresKey ? <Badge tone="amber">Requires key</Badge> : <Badge tone="teal">Keyless</Badge>}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
