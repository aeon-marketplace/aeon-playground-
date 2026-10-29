import { isUnavailableStatus, isPaidRoute } from "@/lib/providers/playground-access";
import {
  isCompatibleWithPlayground,
  operationForPlayground,
  type PlaygroundId,
} from "@/lib/providers/playground-support";
import type { RuntimeModel, RuntimeStatus } from "@/lib/providers/runtime";

export { isPaidRoute } from "@/lib/providers/playground-access";

export const CATALOG_ACCESS_STATUSES = [
  "free",
  "limited-free",
  "user-key-required",
  "paid",
  "unavailable",
  "unverified",
] as const;

export type CatalogAccessStatus = (typeof CATALOG_ACCESS_STATUSES)[number];

export type CatalogAccessFilter = "all" | CatalogAccessStatus;

export const CATALOG_ACCESS_LABELS: Record<CatalogAccessStatus, string> = {
  free: "FREE",
  "limited-free": "LIMITED FREE",
  "user-key-required": "USER KEY REQUIRED",
  paid: "PAID",
  unavailable: "UNAVAILABLE",
  unverified: "UNVERIFIED",
};

const CATALOG_ACCESS_RANK: Record<CatalogAccessStatus, number> = {
  free: 0,
  "limited-free": 1,
  "user-key-required": 2,
  paid: 3,
  unverified: 4,
  unavailable: 5,
};

type CatalogAccessEvidence = Pick<
  RuntimeModel,
  "accessType" | "paid" | "pricing" | "freeTier" | "status"
>;

/**
 * Every retained record uses one scannable access label. Runtime failures and
 * paid routes take precedence, while missing or inconclusive
 * pricing/availability is explicitly UNVERIFIED rather than being inferred as
 * free from a provider-wide free tier. Default catalog visibility is a
 * separate positive-evidence gate below.
 */
export function catalogAccessStatus(
  model: CatalogAccessEvidence,
): CatalogAccessStatus {
  if (isPaidRoute(model)) return "paid";
  // "unsupported" means this app does not implement the model's operation. It
  // does not mean the provider route is unavailable. Keep the access badge
  // accurate (for example, a free safety classifier stays LIMITED FREE) while
  // the compatibility view and actions remain disabled.
  if (
    model.accessType === "unavailable" ||
    (model.status !== "unsupported" && isUnavailableStatus(model.status))
  ) {
    return "unavailable";
  }
  if (model.status === "unverified") return "unverified";

  // A keyed route is usable with the visitor's own key. Check this before
  // pricing so a free-tier-byok route is labelled honestly rather than PAID or
  // silently treated as keyless free access.
  if (model.accessType === "byok") return "user-key-required";

  if (model.pricing.status === "local-no-fee") return "free";
  if (model.pricing.status === "verified-paid") return "paid";
  if (model.pricing.status === "verified-free") {
    const hasFreeAllowance =
      model.freeTier.eligibility === "eligible" ||
      model.freeTier.eligibility === "limited";
    if (!hasFreeAllowance) return "unverified";
    return model.accessType === "limited-free" ||
      model.freeTier.eligibility === "limited"
      ? "limited-free"
      : "free";
  }

  return "unverified";
}

export function catalogAccessRank(status: CatalogAccessStatus): number {
  return CATALOG_ACCESS_RANK[status];
}

export function matchesCatalogAccess(
  model: CatalogAccessEvidence,
  access: CatalogAccessFilter,
): boolean {
  return access === "all" || catalogAccessStatus(model) === access;
}

export const CATALOG_VIEWS = [
  "compatible",
  "free",
  "limited-free",
  "all",
  "unsupported",
  "unavailable",
  "untested",
  "paid",
  "pricing-unverified",
] as const;

export type CatalogView = (typeof CATALOG_VIEWS)[number];

export const CATALOG_VIEW_LABELS: Record<CatalogView, string> = {
  compatible: "Compatible models",
  free: "Free",
  "limited-free": "Limited free",
  all: "All models",
  unsupported: "Unsupported",
  unavailable: "Unavailable",
  untested: "Untested",
  paid: "Paid or credits required",
  "pricing-unverified": "Pricing unverified",
};

export const CATALOG_VIEW_DESCRIPTIONS: Record<CatalogView, string> = {
  compatible:
    "The default view: the selected playground's operation is implemented, and the route is not currently unsupported, deprecated, confirmed unavailable, or blocked by payment.",
  free:
    "Compatible models with verified zero-price access and no documented free-tier cap on the selected route. Account, region, and provider policy conditions may still apply.",
  "limited-free":
    "Compatible models with verified zero-price access plus a documented cap, quota, credit allowance, or eligibility limit. Free access is not unlimited or guaranteed.",
  all:
    "Every retained or discovered entry, including unsupported, deprecated, unavailable, paid, and pricing-unverified models. Availability and lifecycle are not hidden.",
  unsupported:
    "Models that cannot perform the selected playground's operation. This app does not send an incompatible request or invent support for agent, computer-use, audio, video, or research APIs.",
  unavailable:
    "Models with a current failure or lifecycle restriction on the configured route: outages, rate limits, credential problems, or documented deprecation. Temporary failures are not reclassified as permanent.",
  untested:
    "Compatible models without a successful real inference test for the exact provider/model ID. Untested is not the same as broken.",
  paid:
    "Compatible routes that require payment, credits, billing, or an upgraded plan. A paid route is never selected as a fallback.",
  "pricing-unverified":
    "Models whose current pricing or free-tier eligibility could not be confirmed. No free access is assumed from missing or stale metadata.",
};

const KNOWN_UNAVAILABLE_STATUSES: RuntimeStatus[] = [
  "model_unavailable",
  "not_public",
  "config_error",
  "offline",
  "temporary_failure",
  "rate_limited",
  "quota_exhausted",
  "auth_failed",
  "access_denied",
  "request_failed",
  "deprecated",
];

const DEFAULT_INCOMPATIBLE_STATUSES: RuntimeStatus[] = [
  "unsupported",
  "deprecated",
  "model_unavailable",
  "disabled_paid",
  "payment_required",
  "not_public",
  "config_error",
];

/**
 * Compatibility is scoped to a playground and never inferred from a global
 * "unsupported" flag. A model can be compatible with text-to-image and
 * unsupported for text-to-text, or vice versa.
 */
export function isCompatibleForCatalog(
  model: Pick<RuntimeModel, "status" | "supportedOperations">,
  playground: PlaygroundId,
): boolean {
  return (
    model.status !== "unsupported" &&
    model.supportedOperations.includes(operationForPlayground(playground))
  );
}

export function hasVerifiedFreeEvidence(
  model: Pick<RuntimeModel, "pricing" | "freeTier">,
): boolean {
  const freePricing =
    model.pricing.status === "verified-free" || model.pricing.status === "local-no-fee";
  const freeEligibility =
    model.pricing.status === "local-no-fee" ||
    model.freeTier.eligibility === "eligible" ||
    model.freeTier.eligibility === "limited";
  return freePricing && freeEligibility;
}

const DEFAULT_CATALOG_RUNTIME_STATUSES: RuntimeStatus[] = [
  "available",
  "untested",
  "requires_key",
  "disabled_paid",
  "unverified",
];

/**
 * The default catalog is a free-model view, not a general registry view.
 *
 * A record is visible only when the exact route has positive evidence of FREE
 * or LIMITED FREE inference and this app implements one of its operations.
 * Paid, user-key-required, unverified, unsupported, and confirmed-unavailable
 * records are retained and remain reachable from the advanced view and their
 * detail pages. A `:free` suffix or a provider-wide plan is never enough on its
 * own: pricing and free-tier eligibility must both be verified.
 */
export function isDefaultCatalogModel(model: RuntimeModel): boolean {
  const access = catalogAccessStatus(model);
  return (
    (access === "free" || access === "limited-free") &&
    DEFAULT_CATALOG_RUNTIME_STATUSES.includes(model.status) &&
    model.supportedOperations.length > 0
  );
}

export function filterDefaultCatalogModels(models: RuntimeModel[]): RuntimeModel[] {
  return models.filter(isDefaultCatalogModel);
}

export function hasLimitedFreeTier(
  model: Pick<RuntimeModel, "accessType" | "freeTier">,
): boolean {
  return (
    model.accessType === "limited-free" || model.freeTier.eligibility === "limited"
  );
}

export function isPricingUnverified(
  model: Pick<RuntimeModel, "pricing" | "freeTier">,
): boolean {
  return (
    model.pricing.status === "unverified" ||
    model.freeTier.eligibility === "unverified"
  );
}

export function isDefaultCompatible(
  model: Pick<RuntimeModel, "status" | "supportedOperations">,
  playground: PlaygroundId,
): boolean {
  return (
    isCompatibleForCatalog(model, playground) &&
    !DEFAULT_INCOMPATIBLE_STATUSES.includes(model.status)
  );
}

export function matchesCatalogView(
  model: RuntimeModel,
  view: CatalogView,
  playground: PlaygroundId,
): boolean {
  const compatible = isCompatibleForCatalog(model, playground);

  switch (view) {
    case "compatible":
      return isDefaultCompatible(model, playground);
    case "free":
      return (
        compatible && hasVerifiedFreeEvidence(model) && !hasLimitedFreeTier(model)
      );
    case "limited-free":
      return compatible && hasVerifiedFreeEvidence(model) && hasLimitedFreeTier(model);
    case "all":
      return true;
    case "unsupported":
      return !compatible;
    case "unavailable":
      return compatible && KNOWN_UNAVAILABLE_STATUSES.includes(model.status);
    case "untested":
      return compatible && model.inference.state === "untested";
    case "paid":
      return compatible && isPaidRoute(model);
    case "pricing-unverified":
      return isPricingUnverified(model);
  }
}

export function catalogViewCounts(
  models: RuntimeModel[],
  playground: PlaygroundId,
): Record<CatalogView, number> {
  const counts = Object.fromEntries(
    CATALOG_VIEWS.map((view) => [view, 0]),
  ) as Record<CatalogView, number>;
  for (const model of models) {
    for (const view of CATALOG_VIEWS) {
      if (matchesCatalogView(model, view, playground)) counts[view] += 1;
    }
  }
  return counts;
}

export function isCompatibleModel(
  model: Pick<RuntimeModel, "status" | "supportedOperations">,
  playground: PlaygroundId,
): boolean {
  return isCompatibleForCatalog(model, playground);
}

export function supportsPlayground(
  providerId: string,
  capabilities: RuntimeModel["capabilities"],
  playground: PlaygroundId,
): boolean {
  return isCompatibleWithPlayground(providerId, capabilities, playground);
}
