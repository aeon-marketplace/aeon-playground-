import type {
  AvailabilityState,
  FreeTierEligibility,
  InferenceAvailability,
  PricingStatus,
  UserAccessState,
} from "@/lib/providers/types";

export const PRICING_LABELS: Record<PricingStatus, string> = {
  "verified-free": "FREE VERIFIED",
  "verified-paid": "PAID / CREDITS REQUIRED",
  "local-no-fee": "LOCAL — NO HOSTED API FEE",
  unverified: "PRICING UNVERIFIED",
  "not-applicable": "PRICING NOT APPLICABLE",
};

export const FREE_TIER_LABELS: Record<FreeTierEligibility, string> = {
  eligible: "FREE TIER AVAILABLE",
  limited: "LIMITED FREE",
  "not-eligible": "NO FREE TIER",
  unverified: "FREE TIER UNVERIFIED",
  "not-applicable": "FREE TIER N/A",
};

export const AVAILABILITY_LABELS: Record<AvailabilityState, string> = {
  available: "AVAILABLE",
  "temporarily-unavailable": "TEMPORARILY UNAVAILABLE",
  "rate-limited": "RATE LIMITED",
  "invalid-key": "INVALID KEY / ACCESS DENIED",
  "payment-required": "PAYMENT / CREDITS REQUIRED",
  deprecated: "DEPRECATED",
  unavailable: "UNAVAILABLE",
  "not-verified": "NOT VERIFIED",
  "not-applicable": "NOT APPLICABLE",
};

export const USER_ACCESS_LABELS: Record<UserAccessState, string> = {
  ready: "ACCESS READY",
  "key-required": "USER KEY REQUIRED",
  "key-invalid": "KEY INVALID",
  "account-limited": "ACCOUNT LIMITED",
  "payment-restricted": "PAYMENT RESTRICTED",
  "not-public": "NOT PUBLIC",
  offline: "OFFLINE",
  "not-applicable": "NOT APPLICABLE",
  unavailable: "UNAVAILABLE",
  unknown: "ACCESS UNKNOWN",
};

export const INFERENCE_LABELS: Record<InferenceAvailability, string> = {
  tested: "INFERENCE TESTED",
  "verified-recorded": "INFERENCE VERIFIED (RECORDED)",
  untested: "INFERENCE UNTESTED",
  "temporary-failure": "TEMPORARY FAILURE",
  "auth-failure": "AUTH FAILED",
  "rate-limited": "RATE LIMITED",
  "quota-exhausted": "QUOTA EXHAUSTED",
  "payment-required": "PAYMENT REQUIRED",
  "request-failed": "REQUEST FAILED",
  "config-error": "CONFIG ERROR",
  unsupported: "UNSUPPORTED FOR THIS PLAYGROUND",
  "model-unavailable": "MODEL NOT AVAILABLE",
  deprecated: "DEPRECATED",
  offline: "OFFLINE",
  "not-public": "NOT PUBLIC",
  unknown: "INFERENCE UNKNOWN",
};

export const PRICING_DESCRIPTIONS: Record<PricingStatus, string> = {
  "verified-free":
    "The provider's current public pricing lists no charge for the relevant tier. Account, region, quota, and rate limits still apply.",
  "verified-paid":
    "The provider's current public pricing lists a paid rate or credit consumption. Your final bill depends on your account and usage.",
  "local-no-fee":
    "There is no provider API fee because the model runs locally. Hardware, electricity, and storage costs still apply.",
  unverified:
    "No current public price was confirmed for this exact model. This is not a guarantee of free access.",
  "not-applicable":
    "No current price applies because this model is shut down, deprecated, or not callable through this app.",
};

export const FREE_TIER_DESCRIPTIONS: Record<FreeTierEligibility, string> = {
  eligible:
    "A free allowance is published for this model and no account restriction was recorded, but provider quotas still apply.",
  limited:
    "A free allowance or zero-price listing exists, but quota, rate, region, account, or legacy-access restrictions may limit it.",
  "not-eligible":
    "The provider does not publish a free allowance for this model, or this app classifies the route as paid.",
  unverified:
    "No current free-tier eligibility was confirmed for this exact model and account.",
  "not-applicable":
    "Free-tier eligibility does not apply because the model is local, shut down, or unsupported here.",
};

export const AVAILABILITY_DESCRIPTIONS: Record<AvailabilityState, string> = {
  available:
    "The provider/model route has current evidence or a successful request. This does not guarantee free access or future uptime.",
  "temporarily-unavailable":
    "The route or runtime currently fails with a timeout, network error, server error, or recoverable outage. Do not treat a single failure as permanent disappearance.",
  "rate-limited":
    "A provider request quota or rate limit was reached. This is a usage limit, not proof that the model is gone.",
  "invalid-key":
    "The saved key was rejected or the account is not permitted to use this route. Replace or re-verify the credential before retrying.",
  "payment-required":
    "The applicable provider route requires payment, billing, credits, or an upgraded plan. No paid fallback is used automatically.",
  deprecated:
    "The provider documents this model as deprecated or shut down. Its details are retained for transparency, and it is not called automatically.",
  unavailable:
    "The configured route is confirmed unusable or unavailable for this exact model. It remains visible in the catalog for research.",
  "not-verified":
    "There is not yet enough evidence to classify provider/model availability. This is not the same as broken or permanently unavailable.",
  "not-applicable":
    "Availability is not applicable to an operation this app cannot execute for the selected playground.",
};

export const USER_ACCESS_DESCRIPTIONS: Record<UserAccessState, string> = {
  ready: "The required key/account route is available for this session.",
  "key-required": "A provider key or account connection is required before this model can be used.",
  "key-invalid": "The saved provider key was rejected. Replace or re-verify it before testing.",
  "account-limited":
    "The provider did not confirm this exact model for the current account or key.",
  "payment-restricted":
    "This access route is blocked because it is paid and paid BYOK is disabled, or the provider requires billing/payment.",
  "not-public": "This keyless model is not on the operator's public allowlist.",
  offline: "The local runtime or provider endpoint cannot currently be reached.",
  "not-applicable":
    "User access is not applicable because this app does not implement an operation for this model.",
  unavailable: "The model is shut down or deprecated.",
  unknown: "User-specific access could not be established from the available evidence.",
};

export const INFERENCE_DESCRIPTIONS: Record<InferenceAvailability, string> = {
  tested: "A real inference request succeeded for this exact model in this session.",
  "verified-recorded":
    "A real inference result is recorded as deployment evidence, but this session has not re-tested it.",
  untested: "No real inference request is recorded for this exact model in this session.",
  "temporary-failure":
    "The last inference attempt failed with a timeout, network error, server error, or invalid response.",
  "auth-failure": "The last inference attempt failed because the key or account was rejected.",
  "rate-limited": "The last inference attempt was rate-limited. Wait and try again.",
  "quota-exhausted": "The last inference attempt failed because the quota or credit balance is exhausted.",
  "payment-required": "The provider requires payment, billing, or an upgraded plan for this request.",
  "request-failed": "The provider rejected the request as invalid or blocked it under a safety policy.",
  "model-unavailable":
    "The provider did not make this exact model available to the current account. This is an account/model access result, not an unsupported playground operation.",
  "config-error": "The model is not configured for use in this session, or the selected route is disabled.",
  unsupported: "This app does not implement an operation for this model's input or output type.",
  deprecated: "The provider documents this model as shut down or deprecated.",
  offline: "The runtime needed for this model is offline.",
  "not-public": "This model is not enabled for public sessions.",
  unknown: "The last inference attempt failed and its cause could not be classified.",
};
