import { getEnv } from "@/lib/env";
import { isAnonymousUserId } from "@/lib/auth/ids";
import {
  decryptProviderKey,
  getProviderCredentialRow,
  listProviderCredentials,
  parseVerifiedModels,
} from "@/lib/db/credentials";
import {
  getCustomModelRow,
  listVerifiedCustomModels,
  type PublicCustomModel,
} from "@/lib/db/custom-models";
import { decryptCustomKey } from "@/lib/db/custom-models";
import { listModelTestResults } from "@/lib/db/model-tests";
import { cloudflareBaseUrl, parseCloudflareCredential } from "@/lib/providers/cloudflare";
import { PROVIDERS, getProvider, getRegistryModel, MODELS } from "@/lib/providers/registry";
import { ProviderError } from "@/lib/providers/errors";
import {
  DISCOVERY_PROVIDER_IDS,
  discoverAllProviders,
  discoverProviderModels,
  type DiscoveryProviderId,
} from "@/lib/providers/discovery";
import type {
  AccessType,
  AvailabilityState,
  ChatMessage,
  ChatResult,
  ChatStreamInput,
  ImageResult,
  InferenceAvailability,
  ModelCapability,
  ModelDefinition,
  ModelFreeTierMetadata,
  ModelInferenceTest,
  ModelPricingMetadata,
  UserAccessState,
  VerificationState,
} from "@/lib/providers/types";
import {
  operationForPlayground,
  playgroundOperation,
  supportedPlaygroundOperations,
  type PlaygroundId,
  type PlaygroundOperation,
} from "@/lib/providers/playground-support";
import {
  hasVerifiedFreeSelectorAccess,
  simpleAccessLabel,
  simpleAccessRank,
  type SimpleAccessLabel,
} from "@/lib/providers/playground-access";
export {
  isCompatibleWithPlayground,
  operationForPlayground,
  playgroundOperation,
  supportedPlaygroundOperations,
} from "@/lib/providers/playground-support";
export type { PlaygroundId, PlaygroundOperation } from "@/lib/providers/playground-support";
import { openAICompatibleChat, openAICompatibleStream } from "@/lib/providers/openai-compatible";
import {
  generatePollinationsImage,
  pollinationsChat,
  pollinationsStream,
} from "@/lib/providers/pollinations";
import { geminiChat, geminiStream } from "@/lib/providers/gemini";
import { discoverOllama, ollamaChat, ollamaStream, type OllamaDiscovery } from "@/lib/providers/ollama";
import { safeFetch } from "@/lib/security/ssrf";

export type RuntimeStatus =
  | "available"
  | "untested"
  | "requires_key"
  | "disabled_paid"
  | "auth_failed"
  | "access_denied"
  | "rate_limited"
  | "quota_exhausted"
  | "payment_required"
  | "temporary_failure"
  | "request_failed"
  | "model_unavailable"
  | "config_error"
  | "unverified"
  | "unsupported"
  | "deprecated"
  | "offline"
  | "not_public";

export type RuntimeUserAccess = {
  state: UserAccessState;
  detail: string;
};

export type RuntimeInference = {
  state: InferenceAvailability;
  detail: string;
};

export type RuntimeAvailability = {
  state: AvailabilityState;
  detail: string;
};

export type ModelAccessEvidence =
  | "inference_tested"
  | "model_accessible"
  | "key_verified"
  | "discovered"
  | "not_applicable"
  | "unavailable"
  | "unverified";

export const ACCESS_EVIDENCE_LABELS: Record<ModelAccessEvidence, string> = {
  inference_tested: "Inference tested",
  model_accessible: "Model accessible",
  key_verified: "Key verified · untested",
  discovered: "Discovered only",
  not_applicable: "Not applicable",
  unavailable: "Unavailable",
  unverified: "Unverified",
};

export type RuntimeModel = ModelDefinition & {
  providerName: string;
  providerIcon: string;
  providerRequiresKey: boolean;
  status: RuntimeStatus;
  statusLabel: string;
  statusDetail: string;
  connected: boolean;
  operation: "chat" | "image" | null;
  supportedOperations: PlaygroundOperation[];
  canOpen: boolean;
  canTest: boolean;
  openDisabledReason: string | null;
  testDisabledReason: string | null;
  pricing: ModelPricingMetadata;
  freeTier: ModelFreeTierMetadata;
  availability: RuntimeAvailability;
  userAccess: RuntimeUserAccess;
  inference: RuntimeInference;
  accessEvidence: ModelAccessEvidence;
  accessEvidenceLabel: string;
  accessEvidenceDetail: string;
  replacementModelRef?: string;
  replacementAvailable?: boolean;
  inferenceTestedAt?: number;
  inferenceTestLatencyMs?: number | null;
  inferenceTestError?: string | null;
};

export type SelectableModel = {
  ref: string;
  providerId: string;
  providerName: string;
  providerIcon: string;
  modelId: string;
  name: string;
  description: string;
  capabilities: ModelCapability[];
  accessType: AccessType;
  source: "registry" | "custom";
  contextWindow?: number;
  image?: ModelDefinition["image"];
  streaming: boolean;
  parameters: string[];
  rateLimits?: string;
  docsUrl?: string;
  verificationState: VerificationState;
  playgroundLabel: SimpleAccessLabel;
};

export type CredentialStatus = { verified: boolean; models: string[] };

export type ModelTarget = {
  modelRef: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  baseUrl: string;
  apiKey?: string;
  kind: "registry" | "custom" | "local";
  customId?: string;
  paid: boolean;
  accessType: AccessType;
  capabilities: ModelCapability[];
  image?: ModelDefinition["image"];
  streaming: boolean;
  parameters: string[];
};

function pricingFor(model: ModelDefinition): ModelPricingMetadata {
  if (model.pricing) return model.pricing;
  const source = {
    checkedAt: model.verification.checkedAt,
    sourceUrl: model.docsUrl ?? model.verification.docsUrl,
  };
  if (model.accessType === "local") {
    return {
      status: "local-no-fee",
      detail:
        "No provider API fee applies because this model runs locally. Hardware, electricity, and storage costs still apply.",
      ...source,
    };
  }
  if (model.accessType === "free" || model.accessType === "limited-free") {
    return {
      status: "unverified",
      detail:
        "This route is categorized as free by provider metadata, but no exact model price was confirmed. Free access is not assumed.",
      ...source,
    };
  }
  if (model.accessType === "unavailable") {
    return {
      status: "not-applicable",
      detail:
        "No current price applies because this model is shut down, deprecated, or not callable through this app.",
      ...source,
    };
  }
  if (model.paid) {
    return {
      status: "verified-paid",
      detail:
        "This documented route is paid or credit-based. Actual charges depend on your account and usage.",
      ...source,
    };
  }
  return {
    status: "unverified",
    detail:
      "No current public price was confirmed for this exact model. This is not a guarantee of free access.",
    ...source,
  };
}

function freeTierFor(model: ModelDefinition): ModelFreeTierMetadata {
  if (model.freeTier) return model.freeTier;
  const source = {
    sourceUrl: model.docsUrl ?? model.verification.docsUrl,
  };
  if (model.accessType === "local") {
    return {
      eligibility: "not-applicable",
      detail:
        "This is not a provider free tier. It runs locally with no API fee, but hardware costs remain.",
      ...source,
    };
  }
  if (model.accessType === "free") {
    return {
      eligibility: "unverified",
      detail:
        "This route is categorized as free by provider metadata, but its free allowance was not confirmed for this exact model.",
      ...source,
    };
  }
  if (model.accessType === "limited-free") {
    return {
      eligibility: "unverified",
      detail:
        "This route is categorized as limited-free by provider metadata, but its free allowance and limits were not confirmed for this exact model.",
      ...source,
    };
  }
  if (model.accessType === "unavailable") {
    return {
      eligibility: "not-applicable",
      detail: "Free-tier eligibility does not apply to a non-selectable model.",
      ...source,
    };
  }
  if (model.paid) {
    return {
      eligibility: "not-eligible",
      detail: "The provider does not publish a free allowance for this paid route.",
      ...source,
    };
  }
  return {
    eligibility: "unverified",
    detail:
      "No current free-tier eligibility was confirmed for this exact model and account.",
    ...source,
  };
}

type TestFailure = {
  status: RuntimeStatus;
  statusLabel: string;
  inference: InferenceAvailability;
  userAccess: UserAccessState;
};

function classifyTestFailure(test: ModelInferenceTest): TestFailure {
  const raw = (test.errorCode ?? "").replace(/^provider_/, "");
  const message = (test.errorMessage ?? "").toLowerCase();
  const paymentSignal =
    /payment|billing|insufficient credit|credit balance|requires? (a )?paid|upgrade (to|your) plan/.test(
      message,
    );

  if (raw === "auth") {
    return {
      status: "auth_failed",
      statusLabel: "Invalid key",
      inference: "auth-failure",
      userAccess: "key-invalid",
    };
  }
  if (raw === "forbidden") {
    return {
      status: "access_denied",
      statusLabel: "Access denied",
      inference: "auth-failure",
      userAccess: "account-limited",
    };
  }
  if (raw === "rate_limit" || raw === "rate_limited") {
    return {
      status: "rate_limited",
      statusLabel: "Rate limited",
      inference: "rate-limited",
      userAccess: "ready",
    };
  }
  if (raw === "payment_required" || (raw === "quota" && paymentSignal)) {
    return {
      status: "payment_required",
      statusLabel: "Payment required",
      inference: "payment-required",
      userAccess: "payment-restricted",
    };
  }
  if (raw === "quota") {
    return {
      status: "quota_exhausted",
      statusLabel: "Quota exhausted",
      inference: "quota-exhausted",
      userAccess: "ready",
    };
  }
  if (raw === "timeout" || raw === "network" || raw === "server" || raw === "invalid_response") {
    return {
      status: "temporary_failure",
      statusLabel: "Temporary provider failure",
      inference: "temporary-failure",
      userAccess: "ready",
    };
  }
  if (raw === "unsupported_model") {
    return {
      status: "unsupported",
      statusLabel: "Unsupported or missing",
      inference: "unsupported",
      userAccess: "unavailable",
    };
  }
  if (raw === "model_unavailable") {
    return {
      status: "model_unavailable",
      statusLabel: "Model not available to account",
      inference: "model-unavailable",
      userAccess: "account-limited",
    };
  }
  if (raw === "invalid_request" || raw === "content_blocked") {
    return {
      status: "request_failed",
      statusLabel: "Request rejected",
      inference: "request-failed",
      userAccess: "ready",
    };
  }
  if (raw === "config") {
    return {
      status: "config_error",
      statusLabel: "Configuration error",
      inference: "config-error",
      userAccess: "unknown",
    };
  }
  return {
    status: "unverified",
    statusLabel: "Test failed",
    inference: "unknown",
    userAccess: "unknown",
  };
}

function userAccessFor(
  status: RuntimeStatus,
  model: ModelDefinition,
  credential: CredentialStatus | undefined,
  test: ModelInferenceTest | undefined,
  statusDetail: string,
): RuntimeUserAccess {
  const note = model.userAccessNote ? ` ${model.userAccessNote}` : "";
  switch (status) {
    case "available":
    case "untested":
    case "rate_limited":
    case "quota_exhausted":
    case "temporary_failure":
    case "request_failed":
    case "unverified":
      return {
        state: "ready",
        detail: `The required provider/key route is available for this session.${note}`,
      };
    case "requires_key":
      if (credential && !credential.verified) {
        return {
          state: "key-invalid",
          detail: `Your saved key failed verification. Replace or re-verify it.${note}`,
        };
      }
      if (credential?.verified) {
        return {
          state: "account-limited",
          detail: `Your key was accepted, but the provider did not return this exact model ID for the current account.${note}`,
        };
      }
      return {
        state: "key-required",
        detail: `Connect and verify a provider key to check this model for this session or account.${note}`,
      };
    case "auth_failed":
      return {
        state: "key-invalid",
        detail: test?.errorMessage ?? statusDetail,
      };
    case "access_denied":
      return {
        state: "account-limited",
        detail: test?.errorMessage ?? statusDetail,
      };
    case "model_unavailable":
      return {
        state: "account-limited",
        detail: test?.errorMessage ?? statusDetail,
      };
    case "payment_required":
    case "disabled_paid":
      return { state: "payment-restricted", detail: statusDetail };
    case "unsupported":
      return { state: "not-applicable", detail: statusDetail };
    case "deprecated":
      return { state: "unavailable", detail: statusDetail };
    case "offline":
      return { state: "offline", detail: statusDetail };
    case "not_public":
      return { state: "not-public", detail: statusDetail };
    case "config_error":
      return { state: "unknown", detail: statusDetail };
  }
}

function inferenceFor(
  status: RuntimeStatus,
  providerId: string,
  model: ModelDefinition,
  test: ModelInferenceTest | undefined,
  statusDetail: string,
): RuntimeInference {
  if (test?.status === "success" && (status === "available" || status === "untested")) {
    return {
      state: "tested",
      detail: `A real inference request succeeded for this exact model${
        test.latencyMs !== null ? ` in ${test.latencyMs} ms` : ""
      }.`,
    };
  }
  switch (status) {
    case "available":
      if (providerId === "ollama") {
        return {
          state: "untested",
          detail:
            "The local model is installed and listed, but no inference test is recorded in this session.",
        };
      }
      return {
        state: "verified-recorded",
        detail:
          model.verification.evidence ??
          "Live inference evidence is recorded for this deployment, but this session has not re-tested it.",
      };
    case "untested":
      return { state: "untested", detail: statusDetail };
    case "requires_key":
      return {
        state: "untested",
        detail: "No inference request was made because the key/access check has not passed.",
      };
    case "rate_limited":
      return { state: "rate-limited", detail: test?.errorMessage ?? statusDetail };
    case "quota_exhausted":
      return { state: "quota-exhausted", detail: test?.errorMessage ?? statusDetail };
    case "payment_required":
    case "disabled_paid":
      return { state: "payment-required", detail: statusDetail };
    case "auth_failed":
    case "access_denied":
      return { state: "auth-failure", detail: test?.errorMessage ?? statusDetail };
    case "temporary_failure":
      return { state: "temporary-failure", detail: test?.errorMessage ?? statusDetail };
    case "request_failed":
      return { state: "request-failed", detail: test?.errorMessage ?? statusDetail };
    case "model_unavailable":
      return { state: "model-unavailable", detail: test?.errorMessage ?? statusDetail };
    case "config_error":
      return { state: "config-error", detail: statusDetail };
    case "unsupported":
      return { state: "unsupported", detail: statusDetail };
    case "deprecated":
      return { state: "deprecated", detail: statusDetail };
    case "offline":
      return { state: "offline", detail: statusDetail };
    case "not_public":
      return { state: "not-public", detail: statusDetail };
    case "unverified":
      return { state: "unknown", detail: test?.errorMessage ?? statusDetail };
  }
}

function availabilityFor(
  status: RuntimeStatus,
  credential: CredentialStatus | undefined,
  statusDetail: string,
  operation: "chat" | "image" | null,
): RuntimeAvailability {
  switch (status) {
    case "available":
      return {
        state: "available",
        detail:
          "This exact provider/model route has current evidence or a successful request. Availability does not imply free access or future uptime.",
      };
    case "untested":
      return {
        state: "not-verified",
        detail:
          "The model is listed for this key/account, but no real inference request has succeeded yet. Untested is not broken.",
      };
    case "requires_key":
      if (credential && !credential.verified) {
        return {
          state: "invalid-key",
          detail: "The saved provider key failed verification. Replace or re-verify it before relying on this model.",
        };
      }
      if (credential?.verified) {
        return {
          state: "unavailable",
          detail:
            "The provider accepted the key but did not return this exact model ID for the current account. It may be unavailable to this account.",
        };
      }
      return {
        state: "not-verified",
        detail:
          "No provider key is connected for this session, so this model route has not been verified.",
      };
    case "rate_limited":
    case "quota_exhausted":
      return {
        state: "rate-limited",
        detail:
          "A request quota or rate limit was reached. This is a usage limit, not proof that the model is permanently unavailable.",
      };
    case "auth_failed":
    case "access_denied":
      return {
        state: "invalid-key",
        detail: statusDetail,
      };
    case "payment_required":
    case "disabled_paid":
      return {
        state: "payment-required",
        detail: statusDetail,
      };
    case "temporary_failure":
    case "offline":
      return {
        state: "temporarily-unavailable",
        detail:
          "The last attempt failed with a timeout, network error, server error, or offline runtime. Retry later; a single failure is not permanent unavailability.",
      };
    case "request_failed":
      return {
        state: "available",
        detail:
          "The provider responded, but the request content or parameters were rejected. The route itself is reachable.",
      };
    case "model_unavailable":
    case "not_public":
    case "config_error":
      return {
        state: "unavailable",
        detail: statusDetail,
      };
    case "deprecated":
      return {
        state: "deprecated",
        detail: statusDetail,
      };
    case "unsupported":
      return operation === null
        ? {
            state: "not-applicable",
            detail:
              "This app does not implement an operation for this model, so provider/model availability is not applicable.",
          }
        : { state: "unavailable", detail: statusDetail };
    case "unverified":
      return {
        state: "not-verified",
        detail: statusDetail,
      };
  }
}

function actionFlags(
  status: RuntimeStatus,
  operation: "chat" | "image" | null,
  statusDetail: string,
): {
  canOpen: boolean;
  canTest: boolean;
  openDisabledReason: string | null;
  testDisabledReason: string | null;
} {
  const compatible = operation !== null;
  const openable = compatible && (status === "available" || status === "untested");
  const testableStatuses: RuntimeStatus[] = [
    "available",
    "untested",
    "unverified",
    "rate_limited",
    "quota_exhausted",
    "payment_required",
    "temporary_failure",
    "request_failed",
    "model_unavailable",
  ];
  const testable = compatible && testableStatuses.includes(status);
  return {
    canOpen: openable,
    canTest: testable,
    openDisabledReason: openable
      ? null
      : compatible
        ? statusDetail
        : "No chat or image operation is implemented for this model's input/output type.",
    testDisabledReason: testable
      ? null
      : compatible
        ? statusDetail
        : "No compatible Test operation is implemented for this model.",
  };
}

function unsupportedOperationMessage(capabilities: ModelCapability[]): string {
  if (capabilities.includes("safety")) {
    return "This model is specialized for safety classification, not general chat. It stays in the catalog but is not available in this playground. No provider request was made.";
  }
  return "This app does not implement this model's input or output type. No provider request was made.";
}

export function evaluateRegistryModels(
  credentials: Map<string, CredentialStatus>,
  allowPaidByok: boolean,
  extraModels: ModelDefinition[] = [],
  testResults: Map<string, ModelInferenceTest> = new Map(),
): RuntimeModel[] {
  const extrasByRef = new Map(extraModels.map((model) => [model.ref, model]));
  const staticRefs = new Set(MODELS.map((model) => model.ref));

  // A static entry wins for its documented access policy, but live provider
  // metadata should still enrich it instead of being discarded.
  const mergedStatic = MODELS.map((model) => {
    const extra = extrasByRef.get(model.ref);
    if (!extra) return model;
    return {
      ...model,
      capabilities: Array.from(new Set([...model.capabilities, ...extra.capabilities])),
      contextWindow: extra.contextWindow ?? model.contextWindow,
      inputTokenLimit: extra.inputTokenLimit ?? model.inputTokenLimit,
      outputTokenLimit: extra.outputTokenLimit ?? model.outputTokenLimit,
      maxOutputTokens: extra.maxOutputTokens ?? model.maxOutputTokens,
      releaseStage: extra.releaseStage ?? model.releaseStage,
      shutdownDate: extra.shutdownDate ?? model.shutdownDate,
      replacement: extra.replacement ?? model.replacement,
      pricing: model.pricing ?? extra.pricing,
      freeTier: model.freeTier ?? extra.freeTier,
      userAccessNote: model.userAccessNote ?? extra.userAccessNote,
      unavailableReason: extra.unavailableReason ?? model.unavailableReason,
      verification: {
        ...model.verification,
        evidence: [model.verification.evidence, extra.verification.evidence]
          .filter(Boolean)
          .join(" "),
      },
    };
  });
  const uniqueExtras = extraModels.filter((model) => !staticRefs.has(model.ref));
  const allModelRefs = new Set(
    [...mergedStatic, ...uniqueExtras].map((model) => model.ref),
  );

  return [...mergedStatic, ...uniqueExtras].map((model) => {
    const provider = getProvider(model.providerId);
    if (!provider) throw new Error(`Unknown provider for model ${model.ref}`);
    const credential = credentials.get(provider.id);
    const credentialReady = Boolean(
      credential?.verified && credential.models.includes(model.modelId),
    );
    const test = testResults.get(model.ref);
    const supportedOperations = supportedPlaygroundOperations(
      provider.id,
      model.capabilities,
    );
    const operation = supportedOperations[0] ?? null;
    const unsupportedReason =
      model.unavailableReason ??
      (operation === null ? unsupportedOperationMessage(model.capabilities) : null);

    let status: RuntimeStatus;
    let statusLabel: string;
    let statusDetail: string;
    let accessEvidence: ModelAccessEvidence;
    let accessEvidenceDetail: string;
    let connected = false;

    if (model.releaseStage === "deprecated" || Boolean(model.shutdownDate)) {
      status = "deprecated";
      statusLabel = "Deprecated / shut down";
      statusDetail =
        model.unavailableReason ??
        `Google documents this model as shut down${
          model.shutdownDate ? ` on ${model.shutdownDate}` : ""
        }. It is not offered for inference here${
          model.replacement
            ? `; the documented replacement is ${model.replacement.modelId}, which is never selected automatically.`
            : "."
        }`;
      accessEvidence = "unavailable";
      accessEvidenceDetail = statusDetail;
    } else if (unsupportedReason) {
      status = "unsupported";
      statusLabel = "Unsupported for this playground";
      statusDetail = unsupportedReason;
      accessEvidence = "not_applicable";
      accessEvidenceDetail = unsupportedReason;
    } else if (model.paid && !allowPaidByok) {
      status = "disabled_paid";
      statusLabel = "Paid disabled";
      statusDetail =
        "This route is paid or credit-based. Paid BYOK is disabled unless the operator sets ALLOW_PAID_BYOK=true.";
      accessEvidence = "unavailable";
      accessEvidenceDetail = statusDetail;
    } else if (provider.adapter === "ollama") {
      if (model.verification.state === "verified") {
        status = "available";
        statusLabel = "Discovered locally";
        statusDetail = "Discovered from your running Ollama daemon. No API fee.";
        accessEvidence = test?.status === "success" ? "inference_tested" : "model_accessible";
        accessEvidenceDetail =
          test?.status === "success"
            ? "A real inference request succeeded."
            : "Installed locally and listed by Ollama; no inference test is recorded.";
        connected = true;
      } else {
        status = "offline";
        statusLabel = "Ollama offline";
        statusDetail = "Ollama could not be reached, so this local model was not listed.";
        accessEvidence = "unavailable";
        accessEvidenceDetail = statusDetail;
      }
    } else if (!provider.requiresKey) {
      if (test?.status === "error") {
        const failure = classifyTestFailure(test);
        status = failure.status;
        statusLabel = failure.statusLabel;
        statusDetail = test.errorMessage ?? "The last inference test failed.";
        accessEvidence = "unavailable";
        accessEvidenceDetail = statusDetail;
      } else if (model.verification.state === "verified" || test?.status === "success") {
        status = "available";
        statusLabel = "Inference tested";
        statusDetail = "A real request succeeded for this exact model. No key required.";
        accessEvidence = "inference_tested";
        accessEvidenceDetail = test
          ? `Your last test succeeded in ${test.latencyMs ?? "?"} ms.`
          : model.verification.evidence ?? "Live-tested for this deployment.";
        connected = true;
      } else {
        status = "unverified";
        statusLabel = "Unverified";
        statusDetail = "This keyless model has not been verified.";
        accessEvidence = "unverified";
        accessEvidenceDetail = statusDetail;
      }
    } else if (credentialReady) {
      accessEvidence = "key_verified";
      accessEvidenceDetail =
        "Your provider key was accepted and this model ID appears in its list. This does not prove per-model inference access.";
      if (test?.status === "success") {
        status = "available";
        statusLabel = "Inference tested";
        statusDetail = `A real request succeeded against this exact model in ${
          test.latencyMs ?? "?"
        } ms.`;
        accessEvidence = "inference_tested";
        accessEvidenceDetail = statusDetail;
        connected = true;
      } else if (test?.status === "error") {
        const failure = classifyTestFailure(test);
        status = failure.status;
        statusLabel = failure.statusLabel;
        statusDetail = test.errorMessage ?? "The last inference test failed.";
        accessEvidence = "unavailable";
        accessEvidenceDetail = statusDetail;
        connected =
          failure.status !== "auth_failed" && failure.status !== "access_denied";
      } else {
        status = "untested";
        statusLabel = "Key verified · untested";
        statusDetail =
          "Your key was accepted and returned this model ID. Run Test to make one real request before relying on it.";
        connected = true;
      }
    } else if (credential) {
      status = "requires_key";
      statusLabel = "Needs verification";
      statusDetail = credential.verified
        ? "Your key is saved, but this model ID was not returned by the provider for this session or account."
        : "Your key is saved but failed verification. Re-verify or replace it.";
      accessEvidence = credential.verified ? "unavailable" : "unverified";
      accessEvidenceDetail = statusDetail;
    } else {
      status = "requires_key";
      statusLabel = "Needs key";
      statusDetail = `Connect your ${provider.name} API key to check this model for this session or account.`;
      accessEvidence = model.verification.state === "discovered" ? "discovered" : "unverified";
      accessEvidenceDetail =
        model.verification.state === "discovered"
          ? "Provider metadata lists this model; no key or inference test is available for it."
          : statusDetail;
    }

    const pricing = pricingFor(model);
    const freeTier = freeTierFor(model);
    const availability = availabilityFor(status, credential, statusDetail, operation);
    const userAccess = userAccessFor(status, model, credential, test, statusDetail);
    const inference = inferenceFor(status, provider.id, model, test, statusDetail);
    const flags = actionFlags(status, operation, statusDetail);
    const replacementModelRef = model.replacement
      ? `${model.providerId}::${model.replacement.modelId}`
      : undefined;

    return {
      ...model,
      providerName: provider.name,
      providerIcon: provider.icon,
      providerRequiresKey: provider.requiresKey,
      status,
      statusLabel,
      statusDetail,
      connected,
      operation,
      supportedOperations,
      canOpen: flags.canOpen,
      canTest: flags.canTest,
      openDisabledReason: flags.openDisabledReason,
      testDisabledReason: flags.testDisabledReason,
      pricing,
      freeTier,
      availability,
      userAccess,
      inference,
      accessEvidence,
      accessEvidenceLabel: ACCESS_EVIDENCE_LABELS[accessEvidence],
      accessEvidenceDetail,
      replacementModelRef,
      replacementAvailable: replacementModelRef
        ? allModelRefs.has(replacementModelRef)
        : undefined,
      inferenceTestedAt: test?.testedAt,
      inferenceTestLatencyMs: test?.latencyMs ?? null,
      inferenceTestError: test?.errorCode ? test.errorMessage : null,
    };
  });
}

/**
 * No-session visitors may only run models that are explicitly listed in
 * PUBLIC_MODEL_REFS and that are keyless, non-paid, and live-verified.
 * Anonymous visitor sessions may additionally use their own verified BYOK
 * credentials and custom endpoints, but never Ollama.
 */
export function isPublicModelRef(
  ref: string,
  enabledRefs: ReadonlySet<string> = new Set(getEnv().publicModelRefs),
): boolean {
  const model = getRegistryModel(ref);
  if (!model || !enabledRefs.has(ref) || model.paid) return false;
  const provider = getProvider(model.providerId);
  if (!provider || provider.requiresKey || provider.paid) return false;
  return model.verification.state === "verified";
}

function withPublicAccess(models: RuntimeModel[]): RuntimeModel[] {
  const enabledRefs = new Set(getEnv().publicModelRefs);
  return models.map((model) => {
    if (model.status !== "available") return model;
    const provider = getProvider(model.providerId);
    // BYOK models are available only through the visitor's own verified key, so
    // the keyless public allowlist does not apply to them. Local Ollama models
    // are never included in a public catalog in the first place.
    if (!provider || provider.requiresKey || provider.paid) return model;
    if (isPublicModelRef(model.ref, enabledRefs)) return model;
    const statusDetail =
      "This keyless model is not on the operator's public allowlist. Ask the operator to enable it with PUBLIC_MODEL_REFS; a provider key does not override the keyless public allowlist.";
    return {
      ...model,
      status: "not_public",
      statusLabel: "Not enabled publicly",
      statusDetail,
      connected: false,
      canOpen: false,
      canTest: false,
      openDisabledReason: statusDetail,
      testDisabledReason: statusDetail,
      availability: { state: "unavailable", detail: statusDetail },
      userAccess: { state: "not-public", detail: statusDetail },
      inference: { state: "not-public", detail: statusDetail },
    };
  });
}

let ollamaCache:
  | { at: number; baseUrl: string; discovery: OllamaDiscovery }
  | null = null;

export async function getOllamaDiscovery(options: { force?: boolean } = {}): Promise<OllamaDiscovery> {
  const env = getEnv();
  const now = Date.now();
  if (
    !options.force &&
    ollamaCache &&
    ollamaCache.baseUrl === env.ollamaBaseUrl &&
    now - ollamaCache.at < 10_000
  ) {
    return ollamaCache.discovery;
  }
  const discovery = await discoverOllama(env.ollamaBaseUrl, env.ollamaDiscoveryTimeoutMs);
  ollamaCache = { at: now, baseUrl: env.ollamaBaseUrl, discovery };
  return discovery;
}

export function clearOllamaCache(): void {
  ollamaCache = null;
}

function localModelDefinition(
  discovery: OllamaDiscovery,
  model: OllamaDiscovery["models"][number],
): ModelDefinition {
  const details = [model.parameterSize, model.quantization].filter(Boolean).join(" · ");
  return {
    ref: `ollama::${model.id}`,
    providerId: "ollama",
    modelId: model.id,
    name: model.id,
    description: `Local Ollama model${details ? ` (${details})` : ""} discovered from ${discovery.baseUrl}. Runs on your own hardware.`,
    capabilities: ["text"],
    accessType: "local",
    paid: false,
    pricing: {
      status: "local-no-fee",
      detail:
        "No provider API fee applies because the model runs on your hardware. Electricity, storage, and hardware costs still apply.",
      checkedAt: new Date(discovery.checkedAt).toISOString().slice(0, 10),
      sourceUrl: "https://ollama.com/",
    },
    freeTier: {
      eligibility: "not-applicable",
      detail:
        "This is not a provider free tier and has no provider quota. Local throughput is the only limit.",
      sourceUrl: "https://ollama.com/",
    },
    verification: {
      state: "verified",
      method: "Discovered from Ollama GET /api/tags",
      checkedAt: new Date(discovery.checkedAt).toISOString().slice(0, 10),
      evidence: `Installed locally and reported by the Ollama daemon at ${discovery.baseUrl}.`,
      docsUrl: "https://ollama.com/",
    },
    limitations: [
      "Runs on your hardware; speed depends on CPU/GPU and model size.",
      "No cloud fallback. If Ollama stops, the model becomes unavailable.",
      "No provider quota and no API fee.",
    ],
    parameters: ["temperature", "max_tokens"],
    streaming: true,
    rateLimits: "No provider quota. Local throughput only.",
    docsUrl: "https://ollama.com/",
  };
}

export function buildLocalModels(discovery: OllamaDiscovery): ModelDefinition[] {
  if (!discovery.online) return [];
  return discovery.models.map((model) => localModelDefinition(discovery, model));
}

function isDiscoveryProviderId(id: string): id is DiscoveryProviderId {
  return (DISCOVERY_PROVIDER_IDS as readonly string[]).includes(id);
}

/**
 * Read the visitor's own verified provider keys for authenticated discovery.
 * Keys are decrypted in server memory only and never leave this module.
 */
async function verifiedDiscoveryKeys(
  userId: string,
): Promise<Partial<Record<DiscoveryProviderId, string>>> {
  const keys: Partial<Record<DiscoveryProviderId, string>> = {};
  for (const credential of await listProviderCredentials(userId)) {
    if (!credential.verified) continue;
    if (!isDiscoveryProviderId(credential.providerId)) continue;
    const row = await getProviderCredentialRow(userId, credential.providerId);
    if (!row) continue;
    try {
      keys[credential.providerId] = decryptProviderKey(row);
    } catch {
      // Undecryptable keys (for example after a key rotation) are simply not
      // used for discovery. Status checks will still report them as unusable.
    }
  }
  return keys;
}

export async function discoverModelsForUser(
  userId: string | null,
  options: { force?: boolean } = {},
): Promise<ModelDefinition[]> {
  // OpenRouter's free-model list is public metadata, so the catalog is useful
  // before a visitor has a session. Providers that require a key are only
  // queried when the visitor already has a verified credential.
  const keys = userId ? await verifiedDiscoveryKeys(userId) : {};
  const outcomes = await discoverAllProviders(keys, options);
  return outcomes.flatMap((outcome) => outcome.models);
}

export async function getDiscoveryReport(
  userId: string | null,
  options: { force?: boolean } = {},
) {
  // OpenRouter's listing is public; keyed providers are skipped without keys.
  if (!userId) return discoverAllProviders({}, options);
  return discoverAllProviders(await verifiedDiscoveryKeys(userId), options);
}

export async function findDiscoveredModel(
  userId: string | null,
  ref: string,
): Promise<ModelDefinition | undefined> {
  if (!userId) return undefined;
  const providerId = ref.split("::")[0] ?? "";
  if (!isDiscoveryProviderId(providerId)) return undefined;
  const credential = await getProviderCredentialRow(userId, providerId);
  if (!credential || credential.verified !== 1) return undefined;
  let apiKey: string;
  try {
    apiKey = decryptProviderKey(credential);
  } catch {
    return undefined;
  }
  const outcome = await discoverProviderModels(providerId, { apiKey });
  return outcome.models.find((model) => model.ref === ref);
}

export async function getRuntimeCatalog(userId: string | null): Promise<RuntimeModel[]> {
  const env = getEnv();
  if (!userId) {
    const publicDiscovered = await discoverModelsForUser(null);
    return withPublicAccess(
      evaluateRegistryModels(new Map(), env.allowPaidByok, publicDiscovered),
    );
  }

  const credentials = new Map<string, CredentialStatus>();
  for (const credential of await listProviderCredentials(userId)) {
    credentials.set(credential.providerId, {
      verified: credential.verified,
      models: credential.verifiedModels,
    });
  }

  const discovered = await discoverModelsForUser(userId);
  const testResults = await listModelTestResults(userId);
  if (isAnonymousUserId(userId)) {
    // A visitor session may use its own verified BYOK credentials and custom
    // endpoints, but keyless models and server-local Ollama stay governed by
    // the public allowlist. Ollama is intentionally not listed at all.
    return withPublicAccess(
      evaluateRegistryModels(credentials, env.allowPaidByok, discovered, testResults),
    );
  }

  const ollamaDiscovery = await getOllamaDiscovery();
  return evaluateRegistryModels(
    credentials,
    env.allowPaidByok,
    [...buildLocalModels(ollamaDiscovery), ...discovered],
    testResults,
  );
}

function toSelectableModel(model: RuntimeModel): SelectableModel {
  return {
    ref: model.ref,
    providerId: model.providerId,
    providerName: model.providerName,
    providerIcon: model.providerIcon,
    modelId: model.modelId,
    name: model.name,
    description: model.description,
    capabilities: model.capabilities,
    accessType: model.accessType,
    source: "registry",
    contextWindow: model.contextWindow,
    image: model.image,
    streaming: model.streaming,
    parameters: model.parameters,
    rateLimits: model.rateLimits,
    docsUrl: model.docsUrl ?? model.verification.docsUrl,
    verificationState: model.verification.state,
    playgroundLabel: simpleAccessLabel(
      model,
      model.accessEvidence === "inference_tested",
    ),
  };
}

function customToSelectableModel(model: PublicCustomModel): SelectableModel {
  return {
    ref: `custom::${model.id}`,
    providerId: "custom",
    providerName: "Custom endpoint",
    providerIcon: "custom",
    modelId: model.modelId,
    name: model.name,
    description: `Your verified OpenAI-compatible endpoint at ${model.baseUrl}.`,
    capabilities: ["text"],
    accessType: "byok",
    source: "custom",
    streaming: true,
    parameters: ["temperature", "max_tokens"],
    rateLimits: "Depends on the endpoint you configured.",
    verificationState: "verified",
    playgroundLabel: "USER KEY REQUIRED",
  };
}

/**
 * Builds the deliberately small playground selector set. Paid routes and routes
 * whose price/free-tier status is still unverified remain in the catalog but
 * never enter the playground, even when the operator enables paid BYOK and a
 * key makes the route "available" or "untested".
 *
 * Gemini and OpenRouter use a stricter positive-evidence rule: the exact route
 * must have verified zero pricing *and* an eligible/limited free allowance.
 * Merely lacking an "unverified" flag is not enough. Other providers retain
 * their existing selector behavior.
 */
export function selectPlaygroundModels(
  runtime: RuntimeModel[],
  playground: PlaygroundId,
  customModels: PublicCustomModel[] = [],
): SelectableModel[] {
  const operation = operationForPlayground(playground);
  const registry = runtime
    .filter((model) => {
      if (
        (model.status !== "available" && model.status !== "untested") ||
        !model.supportedOperations.includes(operation)
      ) {
        return false;
      }
      return hasVerifiedFreeSelectorAccess(model);
    })
    .map((model) => ({
      model: toSelectableModel(model),
      statusRank: model.status === "available" ? 0 : 1,
    }));

  const custom =
    playground === "text"
      ? customModels.map((model) => ({
          model: customToSelectableModel(model),
          statusRank: 0,
        }))
      : [];

  return [...registry, ...custom]
    .sort((a, b) => {
      const accessDifference =
        simpleAccessRank(a.model.playgroundLabel) - simpleAccessRank(b.model.playgroundLabel);
      if (accessDifference !== 0) return accessDifference;
      if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
      if (a.model.providerName !== b.model.providerName) {
        return a.model.providerName.localeCompare(b.model.providerName);
      }
      return a.model.name.localeCompare(b.model.name);
    })
    .map((entry) => entry.model);
}

export async function getPlaygroundModels(
  userId: string | null,
  playground: PlaygroundId,
): Promise<SelectableModel[]> {
  const runtime = await getRuntimeCatalog(userId);
  const custom = userId ? await listVerifiedCustomModels(userId) : [];
  return selectPlaygroundModels(runtime, playground, custom);
}

export async function getSelectableModels(userId: string | null): Promise<SelectableModel[]> {
  const registry = (await getRuntimeCatalog(userId))
    .filter(
      (model) =>
        (model.status === "available" || model.status === "untested") &&
        playgroundOperation(model.providerId, model.capabilities) !== null,
    )
    .map<SelectableModel>(toSelectableModel);

  const custom = (userId ? await listVerifiedCustomModels(userId) : []).map<SelectableModel>(
    customToSelectableModel,
  );

  return [...registry, ...custom];
}

export async function resolveModelTarget(
  userId: string | null,
  ref: string,
): Promise<ModelTarget> {
  const env = getEnv();
  if (!userId) {
    const enabledRefs = new Set(env.publicModelRefs);
    if (!isPublicModelRef(ref, enabledRefs)) {
      throw new ProviderError(
        "config",
        "This model is not enabled for public playground use. No provider request was made.",
      );
    }
    const model = getRegistryModel(ref);
    const provider = model ? getProvider(model.providerId) : undefined;
    if (!model || !provider) {
      throw new ProviderError("config", "Unknown model. Select a model from the catalog.");
    }
    if (
      playgroundOperation(provider.id, model.capabilities) === null ||
      model.accessType === "unavailable" ||
      model.unavailableReason ||
      model.releaseStage === "deprecated" ||
      model.shutdownDate
    ) {
      throw new ProviderError(
        "unsupported_model",
        model.unavailableReason ??
          (model.shutdownDate
            ? `Google documents this model as shut down on ${model.shutdownDate}. No provider request was made and no replacement was selected.`
            : unsupportedOperationMessage(model.capabilities)),
      );
    }
    return {
      modelRef: model.ref,
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.modelId,
      modelName: model.name,
      baseUrl: provider.baseUrl,
      kind: "registry",
      paid: false,
      accessType: model.accessType,
      capabilities: model.capabilities,
      image: model.image,
      streaming: model.streaming,
      parameters: model.parameters,
    };
  }

  if (ref.startsWith("custom::")) {
    const id = ref.slice("custom::".length);
    const row = await getCustomModelRow(userId, id);
    if (!row) {
      throw new ProviderError("config", "Custom model not found for this session or account.");
    }
    if (row.verified !== 1) {
      throw new ProviderError(
        "config",
        "This custom model has not passed its connection test. Re-test it in My Models.",
      );
    }
    return {
      modelRef: ref,
      providerId: "custom",
      providerName: "Custom endpoint",
      modelId: row.model_id,
      modelName: row.name,
      baseUrl: row.base_url,
      apiKey: await decryptCustomKey(row),
      kind: "custom",
      customId: row.id,
      paid: false,
      accessType: "byok",
      capabilities: ["text"],
      streaming: true,
      parameters: ["temperature", "max_tokens"],
    };
  }

  if (ref.startsWith("ollama::")) {
    if (isAnonymousUserId(userId)) {
      throw new ProviderError(
        "config",
        "Server-local Ollama is available only to signed-in accounts, not to public sessions.",
      );
    }
    const modelId = ref.slice("ollama::".length);
    const discovery = await getOllamaDiscovery({ force: true });
    if (!discovery.online) {
      throw new ProviderError(
        "network",
        "Ollama is not reachable. Start the daemon or check OLLAMA_BASE_URL.",
      );
    }
    if (!discovery.models.some((model) => model.id === modelId)) {
      throw new ProviderError(
        "unsupported_model",
        "That local model is no longer installed in Ollama. Refresh the catalog.",
      );
    }
    return {
      modelRef: ref,
      providerId: "ollama",
      providerName: "Ollama (local)",
      modelId,
      modelName: modelId,
      baseUrl: env.ollamaBaseUrl,
      kind: "local",
      paid: false,
      accessType: "local",
      capabilities: ["text"],
      streaming: true,
      parameters: ["temperature", "max_tokens"],
    };
  }

  let model = getRegistryModel(ref);
  if (!model) {
    model = await findDiscoveredModel(userId, ref);
  }
  if (!model) {
    const refProvider = ref.split("::")[0] ?? "";
    if (isDiscoveryProviderId(refProvider)) {
      const provider = getProvider(refProvider);
      const credential = await getProviderCredentialRow(userId, refProvider);
      if (!credential || credential.verified !== 1) {
        throw new ProviderError(
          "config",
          `Connect and verify your ${provider?.name ?? refProvider} API key in API Keys before using this model.`,
        );
      }
      throw new ProviderError(
        "unsupported_model",
        "Your provider's current model list does not include this model ID. Refresh the Model Catalog and select it again.",
      );
    }
    throw new ProviderError("config", "Unknown model. Select a model from the catalog.");
  }
  const provider = getProvider(model.providerId);
  if (!provider) throw new ProviderError("config", "Unknown provider.");

  const operation = playgroundOperation(provider.id, model.capabilities);
  if (
    operation === null ||
    model.accessType === "unavailable" ||
    model.unavailableReason ||
    model.releaseStage === "deprecated" ||
    model.shutdownDate
  ) {
    throw new ProviderError(
      "unsupported_model",
      model.unavailableReason ??
        (model.shutdownDate
          ? `Google documents this model as shut down on ${model.shutdownDate}. No provider request was made and no replacement was selected.`
          : unsupportedOperationMessage(model.capabilities)),
    );
  }

  if (model.paid && !env.allowPaidByok) {
    throw new ProviderError(
      "config",
      "Paid BYOK is disabled on this server. No paid model was called.",
    );
  }

  if (!provider.requiresKey) {
    if (isAnonymousUserId(userId) && !isPublicModelRef(model.ref)) {
      throw new ProviderError(
        "config",
        "This keyless model is not enabled for public sessions. No provider request was made.",
      );
    }
    if (model.verification.state !== "verified") {
      throw new ProviderError("config", "This keyless model is not verified.");
    }
    return {
      modelRef: model.ref,
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.modelId,
      modelName: model.name,
      baseUrl: provider.baseUrl,
      kind: "registry",
      paid: false,
      accessType: model.accessType,
      capabilities: model.capabilities,
      image: model.image,
      streaming: model.streaming,
      parameters: model.parameters,
    };
  }

  const credential = await getProviderCredentialRow(userId, provider.id);
  if (!credential || credential.verified !== 1) {
    throw new ProviderError(
      "config",
      `Connect and verify your ${provider.name} API key in API Keys before using this model.`,
    );
  }
  const verifiedModels = parseVerifiedModels(credential.verified_models);
  if (!verifiedModels.includes(model.modelId)) {
    throw new ProviderError(
      "config",
      `Your ${provider.name} key did not report this model ID. The model was not called.`,
    );
  }

  // Cloudflare's endpoint is account-scoped, so the saved credential (account
  // ID plus token) is split here. The token alone is sent to the provider.
  let baseUrl = provider.baseUrl;
  let apiKey = decryptProviderKey(credential);
  if (provider.id === "cloudflare") {
    const parsed = parseCloudflareCredential(apiKey);
    baseUrl = cloudflareBaseUrl(parsed.accountId);
    apiKey = parsed.apiToken;
  }

  return {
    modelRef: model.ref,
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.modelId,
    modelName: model.name,
    baseUrl,
    apiKey,
    kind: "registry",
    paid: model.paid,
    accessType: model.accessType,
    capabilities: model.capabilities,
    image: model.image,
    streaming: model.streaming,
    parameters: model.parameters,
  };
}

function customFetch(): typeof fetch {
  const env = getEnv();
  return ((url: URL | RequestInfo, init?: RequestInit) =>
    safeFetch(
      typeof url === "string" ? url : url.toString(),
      init as RequestInit,
      env.allowInsecureLocalEndpoints,
    ) as unknown as Promise<Response>) as typeof fetch;
}

export async function runTargetChat(
  target: ModelTarget,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const env = getEnv();
  if (!target.capabilities.includes("text") || target.capabilities.includes("safety")) {
    throw new ProviderError(
      "unsupported_model",
      target.capabilities.includes("safety")
        ? "This model is specialized for safety classification, not general chat. No provider request was made."
        : "This model does not expose a text-chat operation in this app. No provider request was made.",
    );
  }
  if (target.kind === "custom") {
    return openAICompatibleChat({
      providerName: "custom",
      endpoint: `${target.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      providerId: "custom",
      modelId: target.modelId,
      messages,
      temperature,
      maxTokens,
      apiKey: target.apiKey,
      appUrl: env.appUrl,
      signal,
      fetchImpl: customFetch(),
    });
  }

  if (target.kind === "local" || target.providerId === "ollama") {
    return ollamaChat({
      modelId: target.modelId,
      baseUrl: target.baseUrl,
      providerId: target.providerId,
      messages,
      temperature,
      maxTokens,
      signal,
    });
  }

  if (target.providerId === "pollinations") {
    return pollinationsChat({
      modelId: target.modelId,
      baseUrl: target.baseUrl,
      providerId: target.providerId,
      messages,
      temperature,
      maxTokens,
      signal,
    });
  }
  if (target.providerId === "gemini") {
    return geminiChat({
      modelId: target.modelId,
      baseUrl: target.baseUrl,
      providerId: target.providerId,
      messages,
      temperature,
      maxTokens,
      apiKey: target.apiKey,
      signal,
    });
  }
  return openAICompatibleChat({
    providerName: target.providerName,
    endpoint: `${target.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    providerId: target.providerId,
    modelId: target.modelId,
    messages,
    temperature,
    maxTokens,
    apiKey: target.apiKey,
    appUrl: env.appUrl,
    signal,
  });
}

export async function runTargetChatStream(
  target: ModelTarget,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const env = getEnv();
  if (!target.capabilities.includes("text") || target.capabilities.includes("safety")) {
    throw new ProviderError(
      "unsupported_model",
      target.capabilities.includes("safety")
        ? "This model is specialized for safety classification, not general chat. No provider request was made."
        : "This model does not expose a text-chat operation in this app. No provider request was made.",
    );
  }
  const base: ChatStreamInput = {
    modelId: target.modelId,
    baseUrl: target.baseUrl,
    providerId: target.providerId,
    messages,
    temperature,
    maxTokens,
    apiKey: target.apiKey,
    signal,
    onDelta,
  };

  if (target.kind === "custom") {
    return openAICompatibleStream({
      ...base,
      providerName: "custom",
      endpoint: `${target.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      appUrl: env.appUrl,
      fetchImpl: customFetch(),
    });
  }
  if (target.kind === "local" || target.providerId === "ollama") {
    return ollamaStream(base);
  }
  if (target.providerId === "pollinations") {
    return pollinationsStream(base);
  }
  if (target.providerId === "gemini") {
    return geminiStream(base);
  }
  return openAICompatibleStream({
    ...base,
    providerName: target.providerName,
    endpoint: `${target.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    appUrl: env.appUrl,
  });
}

export async function runTargetImage(
  target: ModelTarget,
  input: { prompt: string; width: number; height: number; seed?: number; signal?: AbortSignal },
): Promise<ImageResult> {
  if (!target.capabilities.includes("image")) {
    throw new ProviderError(
      "unsupported_model",
      "This model does not expose an image-generation operation in this app. No provider request was made.",
    );
  }
  if (target.providerId === "pollinations") {
    return generatePollinationsImage({
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      seed: input.seed,
      modelId: target.modelId,
      signal: input.signal,
    });
  }
  throw new ProviderError(
    "unsupported_model",
    "This app's image route currently supports Pollinations image models only. No provider request was made.",
  );
}

export function providerList() {
  return PROVIDERS;
}
