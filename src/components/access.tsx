import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui";
import {
  AVAILABILITY_LABELS,
  FREE_TIER_LABELS,
  INFERENCE_LABELS,
  PRICING_LABELS,
  USER_ACCESS_LABELS,
} from "@/lib/providers/access-labels";
import {
  CATALOG_ACCESS_LABELS,
  type CatalogAccessStatus,
} from "@/lib/providers/catalog-view";
import { ACCESS_LABELS } from "@/lib/providers/registry";
import type { SimpleAccessLabel } from "@/lib/providers/playground-access";
import type {
  AccessType,
  AvailabilityState,
  FreeTierEligibility,
  InferenceAvailability,
  PricingStatus,
  ProviderIcon,
  UserAccessState,
} from "@/lib/providers/types";

const ACCESS_TONES: Record<AccessType, Tone> = {
  free: "green",
  "limited-free": "amber",
  local: "teal",
  byok: "violet",
  unavailable: "slate",
};

export function accessTone(accessType: AccessType): Tone {
  return ACCESS_TONES[accessType] ?? "slate";
}

export function AccessBadge({
  accessType,
  className,
}: {
  accessType: AccessType;
  className?: string;
}) {
  return (
    <Badge tone={accessTone(accessType)} className={className}>
      {ACCESS_LABELS[accessType]}
    </Badge>
  );
}

const SIMPLE_ACCESS_TONES: Record<SimpleAccessLabel, Tone> = {
  "FREE — Tested": "green",
  "FREE — Untested": "green",
  "LIMITED FREE — Tested": "amber",
  "LIMITED FREE — Untested": "amber",
  "USER KEY REQUIRED": "violet",
  PAID: "red",
  UNAVAILABLE: "slate",
};

export function SimpleAccessBadge({
  label,
  className,
}: {
  label: SimpleAccessLabel;
  className?: string;
}) {
  return (
    <Badge tone={SIMPLE_ACCESS_TONES[label]} className={className}>
      {label}
    </Badge>
  );
}

const CATALOG_ACCESS_TONES: Record<CatalogAccessStatus, Tone> = {
  free: "green",
  "limited-free": "amber",
  "user-key-required": "violet",
  paid: "red",
  unavailable: "slate",
  unverified: "neutral",
};

export function CatalogAccessBadge({
  status,
  inferenceTested,
  className,
}: {
  status: CatalogAccessStatus;
  inferenceTested?: boolean;
  className?: string;
}) {
  const tested = Boolean(inferenceTested);
  const label =
    tested && (status === "free" || status === "limited-free")
      ? `${CATALOG_ACCESS_LABELS[status]} — Tested`
      : CATALOG_ACCESS_LABELS[status];
  return (
    <Badge tone={CATALOG_ACCESS_TONES[status]} className={className}>
      {label}
    </Badge>
  );
}

export function CompatibilityBadge({
  supported,
  className,
  title,
}: {
  supported: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <Badge tone={supported ? "green" : "slate"} className={className} title={title}>
      {supported ? "SUPPORTED FOR THIS PLAYGROUND" : "UNSUPPORTED FOR THIS PLAYGROUND"}
    </Badge>
  );
}

const AVAILABILITY_TONES: Record<AvailabilityState, Tone> = {
  available: "green",
  "temporarily-unavailable": "amber",
  "rate-limited": "amber",
  "invalid-key": "red",
  "payment-required": "red",
  deprecated: "red",
  unavailable: "red",
  "not-verified": "amber",
  "not-applicable": "slate",
};

export function AvailabilityBadge({
  state,
  className,
}: {
  state: AvailabilityState;
  className?: string;
}) {
  return (
    <Badge tone={AVAILABILITY_TONES[state]} className={className}>
      {AVAILABILITY_LABELS[state]}
    </Badge>
  );
}

const PRICING_TONES: Record<PricingStatus, Tone> = {
  "verified-free": "green",
  "verified-paid": "amber",
  "local-no-fee": "teal",
  unverified: "red",
  "not-applicable": "slate",
};

export function PricingBadge({
  status,
  className,
}: {
  status: PricingStatus;
  className?: string;
}) {
  return (
    <Badge tone={PRICING_TONES[status]} className={className}>
      {PRICING_LABELS[status]}
    </Badge>
  );
}

const FREE_TIER_TONES: Record<FreeTierEligibility, Tone> = {
  eligible: "green",
  limited: "amber",
  "not-eligible": "slate",
  unverified: "red",
  "not-applicable": "slate",
};

export function FreeTierBadge({
  eligibility,
  className,
}: {
  eligibility: FreeTierEligibility;
  className?: string;
}) {
  return (
    <Badge tone={FREE_TIER_TONES[eligibility]} className={className}>
      {FREE_TIER_LABELS[eligibility]}
    </Badge>
  );
}

const USER_ACCESS_TONES: Record<UserAccessState, Tone> = {
  ready: "green",
  "key-required": "amber",
  "key-invalid": "red",
  "account-limited": "amber",
  "payment-restricted": "red",
  "not-public": "slate",
  offline: "slate",
  "not-applicable": "slate",
  unavailable: "slate",
  unknown: "slate",
};

export function UserAccessBadge({
  state,
  className,
}: {
  state: UserAccessState;
  className?: string;
}) {
  return (
    <Badge tone={USER_ACCESS_TONES[state]} className={className}>
      {USER_ACCESS_LABELS[state]}
    </Badge>
  );
}

const INFERENCE_TONES: Record<InferenceAvailability, Tone> = {
  tested: "green",
  "verified-recorded": "teal",
  untested: "amber",
  "temporary-failure": "red",
  "auth-failure": "red",
  "rate-limited": "amber",
  "quota-exhausted": "amber",
  "payment-required": "red",
  "request-failed": "red",
  "model-unavailable": "red",
  "config-error": "red",
  unsupported: "slate",
  deprecated: "red",
  offline: "slate",
  "not-public": "slate",
  unknown: "slate",
};

export function InferenceBadge({
  state,
  className,
}: {
  state: InferenceAvailability;
  className?: string;
}) {
  return (
    <Badge tone={INFERENCE_TONES[state]} className={className}>
      {INFERENCE_LABELS[state]}
    </Badge>
  );
}

const PROVIDER_STYLES: Record<ProviderIcon, { label: string; className: string }> = {
  pollinations: { label: "P", className: "from-blue-400/30 to-cyan-500/20 text-blue-200" },
  gemini: { label: "G", className: "from-sky-400/30 to-indigo-500/20 text-sky-200" },
  groq: { label: "Q", className: "from-orange-400/30 to-rose-500/20 text-orange-200" },
  openrouter: { label: "R", className: "from-violet-400/30 to-fuchsia-500/20 text-violet-200" },
  huggingface: { label: "HF", className: "from-yellow-400/30 to-amber-500/20 text-yellow-200" },
  cloudflare: { label: "CF", className: "from-orange-400/30 to-amber-500/20 text-orange-200" },
  openai: { label: "AI", className: "from-slate-300/25 to-slate-500/20 text-slate-100" },
  ollama: { label: "OL", className: "from-cyan-400/30 to-cyan-500/20 text-cyan-200" },
  custom: { label: "CX", className: "from-blue-400/25 to-violet-500/15 text-blue-200" },
};

export function ProviderMark({
  icon,
  name,
  size = "md",
}: {
  icon: ProviderIcon | string;
  name?: string;
  size?: "sm" | "md" | "lg";
}) {
  const style = PROVIDER_STYLES[(icon as ProviderIcon) in PROVIDER_STYLES ? (icon as ProviderIcon) : "custom"];
  const dims =
    size === "sm" ? "h-6 w-6 text-[9px]" : size === "lg" ? "h-11 w-11 text-xs" : "h-8 w-8 text-[10px]";
  return (
    <span
      aria-hidden="true"
      title={name}
      className={`inline-flex ${dims} shrink-0 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br font-bold tracking-tight ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function KeyValueRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/5 py-2 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="min-w-0 text-xs text-slate-300 sm:text-right">{children}</dd>
    </div>
  );
}
