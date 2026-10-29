import type { AccessType, FreeTierEligibility, PricingStatus } from "@/lib/providers/types";
import type { RuntimeStatus } from "@/lib/providers/runtime";

export const SIMPLE_ACCESS_LABELS = [
  "FREE — Tested",
  "FREE — Untested",
  "LIMITED FREE — Tested",
  "LIMITED FREE — Untested",
  "USER KEY REQUIRED",
  "PAID",
  "UNAVAILABLE",
] as const;

export type SimpleAccessLabel = (typeof SIMPLE_ACCESS_LABELS)[number];

type AccessEvidence = {
  accessType: AccessType;
  paid: boolean;
  pricing: { status: PricingStatus };
  freeTier: { eligibility: FreeTierEligibility };
  status?: RuntimeStatus;
};

const UNAVAILABLE_STATUSES: RuntimeStatus[] = [
  "unsupported",
  "deprecated",
  "model_unavailable",
  "not_public",
  "config_error",
  "offline",
  "auth_failed",
  "access_denied",
  "temporary_failure",
  "rate_limited",
  "quota_exhausted",
  "request_failed",
];

/**
 * A paid route is never eligible for the default playground selector. Keep
 * this separate from pricing status so an untested model is never called paid
 * merely because its price is unknown.
 */
export function isPaidRoute(
  model: Pick<AccessEvidence, "paid" | "pricing" | "status">,
): boolean {
  return (
    model.paid ||
    model.pricing.status === "verified-paid" ||
    model.status === "payment_required" ||
    model.status === "disabled_paid"
  );
}

/**
 * Positive free-evidence gate used by every playground selector. Absence of
 * bad metadata is not proof of free access: a hosted route needs both the
 * exact model price and an eligible/limited free allowance to be verified.
 * Locally hosted models are the one explicit exception: their verified
 * no-provider-fee pricing is the evidence.
 */
export function hasVerifiedFreeSelectorAccess(model: AccessEvidence): boolean {
  if (isPaidRoute(model)) return false;
  if (model.pricing.status === "local-no-fee") return true;
  return (
    model.pricing.status === "verified-free" &&
    (model.freeTier.eligibility === "eligible" ||
      model.freeTier.eligibility === "limited")
  );
}

export function isUnavailableStatus(status: RuntimeStatus | undefined): boolean {
  return Boolean(status && UNAVAILABLE_STATUSES.includes(status));
}

/**
 * The playground deliberately shows one short label. Detailed pricing,
 * access, and inference evidence stays in the Model Catalog.
 *
 * `inferenceTested` is true only when a real inference request succeeded for
 * this exact model (`accessEvidence === "inference_tested"`). Metadata,
 * discovery, a valid key, or a registry verification flag alone never count
 * as a successful test. Missing or ambiguous evidence is labelled Untested.
 */
export function simpleAccessLabel(
  model: AccessEvidence,
  inferenceTested?: boolean,
): SimpleAccessLabel {
  const tested = Boolean(inferenceTested);
  const suffix = tested ? " — Tested" : " — Untested";

  // 1. Paid routes are never eligible for free labeling.
  if (isPaidRoute(model)) return "PAID";

  // 2. Unavailable status takes precedence.
  if (isUnavailableStatus(model.status)) {
    return "UNAVAILABLE";
  }

  // 3. Locally hosted models have no provider fee.
  if (model.pricing.status === "local-no-fee") return `FREE${suffix}`;

  // 4. Verified-free pricing with eligible/limited free tier.
  if (model.pricing.status === "verified-free") {
    const hasFreeAllowance =
      model.freeTier.eligibility === "eligible" ||
      model.freeTier.eligibility === "limited";
    if (!hasFreeAllowance) return "UNAVAILABLE";
    const limited =
      model.accessType === "limited-free" || model.freeTier.eligibility === "limited";
    return limited ? `LIMITED FREE${suffix}` : `FREE${suffix}`;
  }

  // 5. Access type checks - these routes have specific labeling.
  if (model.accessType === "local") return `FREE${suffix}`;
  if (model.accessType === "byok") return "USER KEY REQUIRED";
  if (model.accessType === "unavailable") return "UNAVAILABLE";

  // 6. Free/limited-free access types without verified pricing.
  //    These are not presented as verified free without pricing evidence.
  if (model.accessType === "free" || model.accessType === "limited-free") {
    // If pricing is unverified, do not present as free access.
    if (model.pricing.status === "unverified") return "UNAVAILABLE";
    // If pricing is verified-free, the logic above should have caught it.
    // Fall through to user-key-required for safety.
    return "USER KEY REQUIRED";
  }

  // 7. Default: pricing unverified or unknown, present as key required.
  return "USER KEY REQUIRED";
}

export function simpleAccessRank(label: SimpleAccessLabel): number {
  switch (label) {
    case "FREE — Tested":
    case "FREE — Untested":
      return 0;
    case "LIMITED FREE — Tested":
    case "LIMITED FREE — Untested":
      return 1;
    case "USER KEY REQUIRED":
      return 2;
    case "PAID":
      return 3;
    case "UNAVAILABLE":
      return 4;
  }
}
