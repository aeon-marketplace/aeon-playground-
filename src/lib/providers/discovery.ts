import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import { listCloudflareTextModels } from "@/lib/providers/cloudflare";
import { getProvider } from "@/lib/providers/registry";
import { safeFetch } from "@/lib/security/ssrf";
import type {
  ModelCapability,
  ModelDefinition,
  ModelFreeTierMetadata,
  ModelPricingMetadata,
  ModelReleaseStage,
  ModelReplacement,
} from "@/lib/providers/types";

/**
 * Model discovery.
 *
 * Only providers with an official, documented listing endpoint are queried.
 * Providers that require authentication (Groq, Gemini, Hugging Face) are only
 * queried with the visitor's own verified key. The returned models are
 * definitions only: they are evaluated by the runtime catalog, which decides
 * whether the visitor can actually select them.
 *
 * Nothing here ever returns fabricated models or fake availability. Failures
 * are surfaced to the caller with a safe, secret-free error message.
 */

export const DISCOVERY_PROVIDER_IDS = [
  "openrouter",
  "groq",
  "gemini",
  "huggingface",
  "cloudflare",
] as const;

export type DiscoveryProviderId = (typeof DISCOVERY_PROVIDER_IDS)[number];

export type ProviderDiscovery = {
  providerId: DiscoveryProviderId;
  providerName: string;
  models: ModelDefinition[];
  error: string | null;
  authenticated: boolean;
  checkedAt: number;
  cached: boolean;
};

type CacheEntry = { at: number; models: ModelDefinition[] };

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_MODELS_PER_PROVIDER = 150;
const REQUEST_TIMEOUT_MS = 8_000;

const cache = new Map<string, CacheEntry>();

function cacheKey(providerId: DiscoveryProviderId, apiKey?: string): string {
  if (!apiKey) return `${providerId}:public`;
  const digest = createHash("sha256").update(apiKey).digest("hex").slice(0, 32);
  return `${providerId}:key:${digest}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeError(status: number | null): string {
  if (status === null) return "Discovery request failed before a response was received.";
  if (status === 401 || status === 403) {
    return `The provider rejected the saved credential (HTTP ${status}). Re-verify or replace the key.`;
  }
  if (status === 429) return "The provider rate-limited the discovery request (HTTP 429).";
  return `The provider's model list request failed (HTTP ${status}).`;
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const env = getEnv();
  let response: Response;
  try {
    response = await safeFetch(
      url,
      {
        headers: { accept: "application/json", ...headers },
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
      env.allowInsecureLocalEndpoints,
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, error: "The provider's model list request timed out." };
    }
    return { ok: false, error: "The provider's model list could not be reached." };
  }
  if (!response.ok) return { ok: false, error: safeError(response.status) };
  try {
    return { ok: true, json: (await response.json()) as unknown };
  } catch {
    return { ok: false, error: "The provider returned a model list that was not valid JSON." };
  }
}

function baseDefinition(
  providerId: DiscoveryProviderId,
  modelId: string,
  input: {
    name: string;
    description: string;
    accessType: ModelDefinition["accessType"];
    paid: boolean;
    method: string;
    evidence: string;
    limitations: string[];
    capabilities?: ModelCapability[];
    contextWindow?: number;
    maxOutputTokens?: number;
    parameters?: string[];
    streaming?: boolean;
    rateLimits: string;
    releaseStage?: ModelReleaseStage;
    aliases?: string[];
    unavailableReason?: string;
    shutdownDate?: string;
    replacement?: ModelReplacement;
    pricing?: ModelPricingMetadata;
    freeTier?: ModelFreeTierMetadata;
    userAccessNote?: string;
    docsUrl?: string;
  },
): ModelDefinition {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider ${providerId}`);
  return {
    ref: `${providerId}::${modelId}`,
    providerId,
    modelId,
    name: input.name,
    description: input.description,
    capabilities: input.capabilities ?? ["text"],
    accessType: input.accessType,
    paid: input.paid,
    verification: {
      state: "discovered",
      method: input.method,
      checkedAt: today(),
      evidence: input.evidence,
      docsUrl: input.docsUrl ?? provider.docsUrl,
    },
    limitations: input.limitations,
    parameters: input.parameters ?? ["temperature", "max_tokens"],
    streaming: input.streaming ?? true,
    rateLimits: input.rateLimits,
    docsUrl: input.docsUrl ?? provider.docsUrl,
    contextWindow: input.contextWindow,
    inputTokenLimit: input.contextWindow,
    outputTokenLimit: input.maxOutputTokens,
    releaseStage: input.releaseStage,
    shutdownDate: input.shutdownDate,
    replacement: input.replacement,
    pricing: input.pricing,
    freeTier: input.freeTier,
    userAccessNote: input.userAccessNote,
    aliases: input.aliases,
    unavailableReason: input.unavailableReason,
  };
}

function releaseStageFor(id: string, description = ""): ModelReleaseStage {
  const lower = `${id} ${description}`.toLowerCase();
  if (/deprecat|shut down|rerout/.test(lower)) return "deprecated";
  if (/-latest$/.test(id)) return "latest-alias";
  if (/experimental|exp$/.test(id)) return "experimental";
  if (/preview/.test(id)) return "preview";
  return "stable";
}

type OpenRouterModel = {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
  };
  top_provider?: {
    max_completion_tokens?: number | null;
  };
};

function isZeroPrice(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === 0;
}

export function isOpenRouterFreeVariant(
  model: Pick<OpenRouterModel, "id" | "pricing">,
): boolean {
  // The :free suffix is not proof by itself, and a zero price alone is not an
  // official free variant. Require both the exact :free model ID and a
  // zero-price listing for every charge that applies to a text request.
  const id = typeof model.id === "string" ? model.id.trim() : "";
  if (!id.toLowerCase().endsWith(":free")) return false;
  const request = model.pricing?.request;
  return (
    isZeroPrice(model.pricing?.prompt) &&
    isZeroPrice(model.pricing?.completion) &&
    (request === undefined || request.trim() === "" || isZeroPrice(request))
  );
}

/**
 * Safety/guardrail models return classifications rather than conversational
 * text. Text output alone therefore does not make them general chat models.
 * Match identifiers first, then only unambiguous "guardrail model" wording in
 * the provider description, to avoid classifying ordinary models merely
 * because their docs discuss safety filters.
 */
export function isSafetyModel(id: string, description = ""): boolean {
  const identifier = id.toLowerCase();
  if (
    /(?:^|[/_.:-])(?:content[-_. ]?safety|safety|guard(?:rail)?|safeguard|moderation|moderator)(?:$|[:/_.-])/.test(
      identifier,
    )
  ) {
    return true;
  }
  return /(?:guardrail|content[- ]safety|safety[- ]classification|moderation|moderator)\s+(?:model|classifier)/i.test(
    description,
  );
}

function openRouterCapabilities(model: OpenRouterModel): ModelCapability[] {
  const safety = isSafetyModel(
    model.id ?? "",
    `${model.name ?? ""} ${model.description ?? ""}`,
  );
  const capabilities: ModelCapability[] = safety ? ["safety"] : ["text"];
  const inputs = model.architecture?.input_modalities ?? [];
  if (Array.isArray(inputs)) {
    if (inputs.includes("image") || inputs.includes("video")) capabilities.push("vision-input");
    if (inputs.includes("audio")) capabilities.push("audio-input");
  }
  const modality = model.architecture?.modality ?? "";
  if (modality.startsWith("image+")) capabilities.push("vision-input");
  if (modality.startsWith("audio+")) capabilities.push("audio-input");
  return capabilities;
}

function openRouterSupportsText(model: OpenRouterModel): boolean {
  const id = model.id ?? "";
  // OpenRouter's own router IDs choose an arbitrary downstream model. Offering
  // them would violate the no-silent-substitution rule, so they are excluded.
  if (id.startsWith("openrouter/")) return false;
  const output = model.architecture?.output_modalities;
  if (Array.isArray(output)) {
    if (!output.includes("text")) return false;
    // A model that also emits audio or images is not a text-chat endpoint for
    // this adapter, even if the listing calls it text-capable.
    if (output.some((modality) => modality !== "text")) return false;
  } else {
    const modality = model.architecture?.modality ?? "";
    if (!modality.endsWith("->text")) return false;
  }
  const input = model.architecture?.input_modalities;
  if (Array.isArray(input) && !input.includes("text")) return false;
  return true;
}

async function discoverOpenRouter(apiKey: string | undefined): Promise<ModelDefinition[]> {
  const provider = getProvider("openrouter");
  if (!provider) return [];
  const headers: Record<string, string> = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const result = await fetchJson(`${provider.baseUrl.replace(/\/+$/, "")}/models`, headers);
  if (!result.ok) throw new DiscoveryFailure(result.error);
  const data = (result.json as { data?: unknown }).data;
  const list = Array.isArray(data) ? (data as OpenRouterModel[]) : [];

  const models: ModelDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!id || seen.has(id)) continue;
    if (!isOpenRouterFreeVariant(entry)) continue;
    if (!openRouterSupportsText(entry)) continue;
    seen.add(id);
    const capabilities = openRouterCapabilities(entry);
    models.push(
      baseDefinition("openrouter", id, {
        name: entry.name || id,
        description:
          entry.description ||
          "OpenRouter chat model with a zero-price listing, discovered from the public /models endpoint.",
        capabilities,
        accessType: "limited-free",
        paid: false,
        pricing: {
          status: "verified-free",
          detail:
            "OpenRouter's public metadata lists this exact variant at $0 prompt and completion price. Account credits and free-model request caps still apply.",
          checkedAt: today(),
          sourceUrl: "https://openrouter.ai/docs",
        },
        freeTier: {
          eligibility: "limited",
          detail:
            "The zero-price listing is free, but accounts under 10 purchased credits are limited to 20 requests/min and 50 requests/day.",
          sourceUrl: "https://openrouter.ai/docs",
        },
        method: "Public OpenRouter /models metadata",
        evidence: `Listed on openrouter.ai with $0 prompt, completion, and request pricing${
          id.endsWith(":free") ? " on an explicit :free variant" : ""
        }.`,
        limitations: [
          "Requires an OpenRouter API key; inference is not tested by discovery.",
          "Free-model request caps apply (published as 20 requests/min and 50 requests/day for accounts under 10 purchased credits).",
          "Only zero-priced text-output variants are offered; paid variants and OpenRouter's auto-router are excluded.",
          capabilities.includes("safety")
            ? "Specialized safety/moderation model: it classifies inputs or responses and is retained in the catalog without a general chat route."
            : capabilities.includes("vision-input")
              ? "Accepts image/video input at the provider API; this app's text playground sends text only."
              : "Text input only; this model was not classified as accepting images or audio.",
          "Only this exact model ID is used; no fallback model is selected.",
        ],
        contextWindow:
          typeof entry.context_length === "number" ? entry.context_length : undefined,
        maxOutputTokens:
          typeof entry.top_provider?.max_completion_tokens === "number"
            ? entry.top_provider.max_completion_tokens
            : undefined,
        releaseStage: releaseStageFor(id, `${entry.name ?? ""} ${entry.description ?? ""}`),
        rateLimits: "Free-model caps apply; exact limits depend on account status.",
      }),
    );
    if (models.length >= MAX_MODELS_PER_PROVIDER) break;
  }
  return models;
}

class DiscoveryFailure extends Error {}

function groqCapabilities(id: string): ModelCapability[] {
  if (isSafetyModel(id)) return ["safety"];
  if (/whisper|transcribe/i.test(id)) return ["transcription"];
  if (/(?:^|[/_-])(?:tts|playai|orpheus)(?:$|[/_-])/i.test(id)) {
    return ["audio-output"];
  }
  return ["text"];
}

/**
 * Groq's Free plan rate-limit table is the only official per-model free
 * evidence we have. The authenticated /models endpoint lists paid and
 * enterprise models too, so appearing there is not proof of free access.
 */
export const GROQ_FREE_PLAN_MODEL_IDS = new Set([
  "canopylabs/orpheus-arabic-saudi",
  "canopylabs/orpheus-v1-english",
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-prompt-guard-2-86m",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-safeguard-20b",
  "qwen/qwen3.8-27b",
  "whisper-large-v3",
  "whisper-large-v3-turbo",
]);

async function discoverGroq(apiKey: string): Promise<ModelDefinition[]> {
  const provider = getProvider("groq");
  if (!provider) return [];
  const result = await fetchJson(`${provider.baseUrl.replace(/\/+$/, "")}/models`, {
    authorization: `Bearer ${apiKey}`,
  });
  if (!result.ok) throw new DiscoveryFailure(result.error);
  const data = (result.json as { data?: Array<{ id?: string }> }).data;
  const list = Array.isArray(data) ? data : [];

  const models: ModelDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const capabilities = groqCapabilities(id);
    const specialized = !capabilities.includes("text");
    const freePlan = GROQ_FREE_PLAN_MODEL_IDS.has(id);
    models.push(
      baseDefinition("groq", id, {
        name: id,
        description: specialized
          ? "Specialized Groq model returned by the authenticated /openai/v1/models endpoint; this app does not implement its operation."
          : freePlan
            ? "Groq chat model returned by the authenticated /openai/v1/models endpoint and listed in Groq's Free plan rate-limit table."
            : "Groq model returned by the authenticated /openai/v1/models endpoint. Its Free plan eligibility is not established by the listing.",
        capabilities,
        accessType: freePlan ? "limited-free" : "byok",
        paid: false,
        pricing: freePlan
          ? {
              status: "verified-free",
              detail:
                "Groq's official Free plan rate-limit table lists this exact model ID. Your organization's plan and current limits decide the actual route.",
              checkedAt: today(),
              sourceUrl: "https://console.groq.com/docs/rate-limits",
            }
          : {
              status: "unverified",
              detail:
                "The authenticated /models endpoint lists this model, but Groq's official Free plan rate-limit table does not. No free access is assumed.",
              checkedAt: today(),
              sourceUrl: "https://console.groq.com/docs/rate-limits",
            },
        freeTier: freePlan
          ? {
              eligibility: "limited",
              detail:
                "Free-plan limits apply per organization and can change. The exact model must also be available to your key.",
              sourceUrl: "https://console.groq.com/docs/rate-limits",
            }
          : {
              eligibility: "unverified",
              detail:
                "Free-plan eligibility for this discovered model was not confirmed. It remains retained but is excluded from the default free catalog.",
              sourceUrl: "https://console.groq.com/docs/rate-limits",
            },
        method:
          "Authenticated Groq /openai/v1/models listing + official Free plan rate-limit table",
        evidence: freePlan
          ? "Returned by Groq's model list for the saved API key and listed in Groq's official Free plan rate-limit table."
          : "Returned by Groq's model list for the saved API key; no matching Free plan entry was found.",
        limitations: [
          specialized
            ? "Retained in the catalog, but this app implements only chat completion and Pollinations image generation for this model's operation."
            : "Inference is not tested by discovery. A failed chat request is reported as-is.",
          freePlan
            ? "Free-plan limits apply per organization and can change."
            : "No verified free-tier metadata; the default catalog excludes this record.",
          "Only this exact model ID is used; no fallback model is selected.",
        ],
        rateLimits: freePlan
          ? "Free plan limits apply (see Groq documentation)."
          : "Plan-dependent; free eligibility not verified.",
      }),
    );
    if (models.length >= MAX_MODELS_PER_PROVIDER) break;
  }
  return models;
}

const GEMINI_DEPRECATIONS_URL = "https://ai.google.dev/gemini-api/docs/deprecations";
const GEMINI_MODELS_URL = "https://ai.google.dev/gemini-api/docs/models";
const GEMINI_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing";

type GeminiModelPolicy = {
  releaseStage?: ModelReleaseStage;
  pricing?: ModelPricingMetadata;
  freeTier?: ModelFreeTierMetadata;
  userAccessNote?: string;
  shutdownDate?: string;
  replacement?: ModelReplacement;
  unavailableReason?: string;
  contextWindow?: number;
  outputTokenLimit?: number;
  docsUrl?: string;
};

const GEMINI_FREE_PRICING: ModelPricingMetadata = {
  status: "verified-free",
  detail:
    "Google's current pricing page lists a free tier at no charge for this model, alongside a paid tier. Region, account, and quota conditions still apply.",
  checkedAt: "2026-10-22",
  sourceUrl: GEMINI_PRICING_URL,
};

const GEMINI_LIMITED_FREE_TIER: ModelFreeTierMetadata = {
  eligibility: "limited",
  detail:
    "Google publishes a free tier, but free-tier rate limits, regional availability, account eligibility, and data-use terms apply. This is not a guarantee of unlimited free access.",
  sourceUrl: GEMINI_PRICING_URL,
};

const GEMINI_NO_CURRENT_PRICE: ModelPricingMetadata = {
  status: "not-applicable",
  detail:
    "No current API price applies because Google documents this model as shut down or rerouted.",
  checkedAt: "2026-10-22",
  sourceUrl: GEMINI_PRICING_URL,
};

const GEMINI_NO_FREE_TIER_APPLICABLE: ModelFreeTierMetadata = {
  eligibility: "not-applicable",
  detail: "Free-tier eligibility does not apply to a shut-down or rerouted model.",
  sourceUrl: GEMINI_PRICING_URL,
};

const GEMINI_UNVERIFIED_AGENT_PRICING: ModelPricingMetadata = {
  status: "unverified",
  detail:
    "This is an Interactions API agent route. Google's current price and free-tier eligibility for this exact agent route were not verified by this app.",
  checkedAt: "2026-10-22",
  sourceUrl: GEMINI_PRICING_URL,
};

const GEMINI_UNVERIFIED_AGENT_FREE_TIER: ModelFreeTierMetadata = {
  eligibility: "unverified",
  detail:
    "Free-tier eligibility for this Interactions API agent was not confirmed. No free access is assumed.",
  sourceUrl: GEMINI_PRICING_URL,
};

function geminiReplacement(
  modelId: string,
  note: string,
): ModelReplacement {
  return {
    modelId,
    note,
    docsUrl: GEMINI_DEPRECATIONS_URL,
  };
}

const GEMINI_MODEL_POLICIES: Record<string, GeminiModelPolicy> = {
  "gemini-3.8-flash": {
    releaseStage: "stable",
    pricing: GEMINI_FREE_PRICING,
    freeTier: GEMINI_LIMITED_FREE_TIER,
    docsUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "Google lists this as a stable model. Your key must return the exact ID, and free-tier quotas, region, and account eligibility still apply.",
  },
  "gemini-2.5-flash": {
    releaseStage: "stable",
    pricing: GEMINI_FREE_PRICING,
    freeTier: {
      ...GEMINI_LIMITED_FREE_TIER,
      detail:
        "Google lists free-tier token pricing, but API access to 2.5 Flash is limited to accounts that actively used it in the past. A live generateContent request from this app's account returned HTTP 404.",
    },
    docsUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "Google is limiting API access to 2.5 models to accounts that actively used them in the past. The live API returned HTTP 404: this model is no longer available to new users.",
    unavailableReason:
      "Live generateContent returned HTTP 404 for this exact ID: \"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash.\" ListModels still lists it, but the provider will not serve it to this account.",
    replacement: geminiReplacement(
      "gemini-3.8-flash",
      "Google's 2.5 Flash API response directs new users to gemini-3.8-flash. This app does not substitute it automatically.",
    ),
  },
  "gemini-2.5-flash-lite": {
    releaseStage: "stable",
    pricing: GEMINI_FREE_PRICING,
    freeTier: {
      ...GEMINI_LIMITED_FREE_TIER,
      detail:
        "Google lists free-tier token pricing, but API access to 2.5 models is limited to accounts that actively used them in the past. A live generateContent request returned HTTP 404.",
    },
    docsUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "Google is limiting API access to 2.5 models to accounts that actively used them in the past. The live API returned HTTP 404 for this exact ID.",
    unavailableReason:
      "Live generateContent returned HTTP 404: this 2.5 model is no longer available to new users even though ListModels still lists it. Google directs new code to a current model.",
    replacement: geminiReplacement(
      "gemini-3.5-flash-lite",
      "A current Flash-Lite model. This app never substitutes it automatically.",
    ),
  },
  "gemini-2.5-pro": {
    releaseStage: "stable",
    pricing: GEMINI_FREE_PRICING,
    freeTier: {
      ...GEMINI_LIMITED_FREE_TIER,
      detail:
        "Google lists free-tier token pricing, but API access to 2.5 models is limited to accounts that actively used them in the past.",
    },
    docsUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "Google is limiting API access to 2.5 models to accounts that actively used them in the past. The live API returned HTTP 404 for 2.5 Flash and Flash-Lite; 2.5 Pro is treated as account-restricted until a real request succeeds.",
    unavailableReason:
      "The 2.5 family is restricted to accounts that actively used these models in the past. Live requests for sibling 2.5 models returned HTTP 404 for new users, so this entry is retained but not selectable until a real request succeeds.",
    replacement: geminiReplacement(
      "gemini-3.8-flash",
      "Google's current Flash model. This app never substitutes it automatically.",
    ),
  },
  "gemini-3.6-flash": {
    releaseStage: "stable",
    pricing: GEMINI_FREE_PRICING,
    freeTier: GEMINI_LIMITED_FREE_TIER,
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "Live generateContent returned HTTP 200 for this exact ID. Free-tier quotas, region, and account eligibility still apply.",
  },
  "gemini-3.5-flash": {
    releaseStage: "stable",
    pricing: GEMINI_FREE_PRICING,
    freeTier: GEMINI_LIMITED_FREE_TIER,
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "Live generateContent returned HTTP 200 for this exact ID. Free-tier quotas, region, and account eligibility still apply.",
  },
  "gemini-3.5-flash-lite": {
    releaseStage: "stable",
    pricing: GEMINI_FREE_PRICING,
    freeTier: GEMINI_LIMITED_FREE_TIER,
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "Live generateContent returned HTTP 200 for this exact ID. Free-tier quotas, region, and account eligibility still apply.",
  },
  "gemini-3.1-flash-lite": {
    releaseStage: "stable",
    pricing: GEMINI_FREE_PRICING,
    freeTier: GEMINI_LIMITED_FREE_TIER,
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "Live generateContent returned HTTP 200 for this exact ID. Free-tier quotas, region, and account eligibility still apply.",
  },
  "gemini-2.5-computer-use-preview-10-2025": {
    releaseStage: "deprecated",
    shutdownDate: "2026-07-28",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.8-flash",
      "Google lists gemini-3.8-flash as the recommended replacement. That model supports Computer Use Preview at the provider, but this app still implements text chat only.",
    ),
    unavailableReason:
      "Google shut down gemini-2.5-computer-use-preview-10-2025 on July 28, 2026. It must not be called. The documented replacement is gemini-3.8-flash, but this app does not implement computer-use actions and never substitutes models automatically.",
    docsUrl:
      "https://ai.google.dev/gemini-api/docs/models/gemini-2.5-computer-use-preview-10-2025",
  },
  "deep-research-preview-04-2026": {
    releaseStage: "preview",
    pricing: GEMINI_UNVERIFIED_AGENT_PRICING,
    freeTier: GEMINI_UNVERIFIED_AGENT_FREE_TIER,
    docsUrl:
      "https://ai.google.dev/gemini-api/docs/models/deep-research-preview-04-2026",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "This is an Interactions API agent, not a generateContent chat model. This app does not implement its agent operations.",
    unavailableReason:
      "Google exposes Deep Research preview through the Interactions API. This app implements chat completion and Pollinations image generation only, so no agent request is made and no chat model is substituted.",
  },
  "deep-research-max-preview-04-2026": {
    releaseStage: "preview",
    pricing: GEMINI_UNVERIFIED_AGENT_PRICING,
    freeTier: GEMINI_UNVERIFIED_AGENT_FREE_TIER,
    docsUrl: "https://ai.google.dev/gemini-api/docs/models/deep-research-preview-04-2026",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "This is the maximum-comprehensiveness Deep Research agent on the Interactions API. This app does not implement agent operations.",
    unavailableReason:
      "Google exposes Deep Research Max through the Interactions API. This app implements chat completion and Pollinations image generation only, so no agent request is made.",
  },
  "antigravity-preview-09-2026": {
    releaseStage: "preview",
    pricing: GEMINI_UNVERIFIED_AGENT_PRICING,
    freeTier: GEMINI_UNVERIFIED_AGENT_FREE_TIER,
    docsUrl:
      "https://ai.google.dev/gemini-api/docs/models/antigravity-preview-09-2026",
    contextWindow: 1048576,
    outputTokenLimit: 65536,
    userAccessNote:
      "Google exposes Antigravity as an Interactions API agent. Its documentation lists about 135K effective compacted context, not an unlimited 1M working window. This app does not implement agent operations.",
    unavailableReason:
      "Antigravity Agent Preview is an Interactions API agent. This app implements chat completion and Pollinations image generation only, so no agent request is made.",
  },
  "gemini-3.1-flash-lite-preview": {
    releaseStage: "deprecated",
    shutdownDate: "2026-05-25",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.1-flash-lite",
      "Google lists gemini-3.1-flash-lite as the stable replacement. This app never substitutes it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-3.1-flash-lite-preview on May 25, 2026. The documented replacement is gemini-3.1-flash-lite; this app does not substitute models automatically.",
  },
  "deep-research-pro-preview-12-2025": {
    releaseStage: "deprecated",
    shutdownDate: "2026-10-23",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "deep-research-preview-04-2026",
      "Google lists deep-research-preview-04-2026 as the replacement. This app does not substitute it automatically and does not implement the Interactions API agent.",
    ),
    unavailableReason:
      "Google shut down deep-research-pro-preview-12-2025 on October 23, 2026. The documented replacement is deep-research-preview-04-2026, but this app does not silently reroute requests.",
  },
  "antigravity-preview-05-2026": {
    releaseStage: "deprecated",
    shutdownDate: "2026-10-05",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "antigravity-preview-09-2026",
      "Google lists antigravity-preview-09-2026 as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down antigravity-preview-05-2026 on October 5, 2026. The documented replacement is antigravity-preview-09-2026, but this app does not silently reroute requests.",
  },
  "gemini-3-pro-preview": {
    releaseStage: "deprecated",
    shutdownDate: "2026-03-09",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.1-pro-preview",
      "Google lists gemini-3.1-pro-preview as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-3-pro-preview on March 9, 2026. The documented replacement is gemini-3.1-pro-preview; this app does not substitute models automatically.",
  },
  "gemini-2.0-flash": {
    releaseStage: "deprecated",
    shutdownDate: "2026-06-01",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.6-flash",
      "Google lists gemini-3.6-flash as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.0-flash on June 1, 2026. The documented replacement is gemini-3.6-flash; this app does not substitute models automatically.",
  },
  "gemini-2.0-flash-001": {
    releaseStage: "deprecated",
    shutdownDate: "2026-06-01",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.6-flash",
      "Google lists gemini-3.6-flash as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.0-flash-001 on June 1, 2026. The documented replacement is gemini-3.6-flash; this app does not substitute models automatically.",
  },
  "gemini-2.0-flash-lite": {
    releaseStage: "deprecated",
    shutdownDate: "2026-06-01",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.1-flash-lite",
      "Google lists gemini-3.1-flash-lite as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.0-flash-lite on June 1, 2026. The documented replacement is gemini-3.1-flash-lite; this app does not substitute models automatically.",
  },
  "gemini-2.0-flash-lite-001": {
    releaseStage: "deprecated",
    shutdownDate: "2026-06-01",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.1-flash-lite",
      "Google lists gemini-3.1-flash-lite as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.0-flash-lite-001 on June 1, 2026. The documented replacement is gemini-3.1-flash-lite; this app does not substitute models automatically.",
  },
  "gemini-2.5-flash-preview-05-20": {
    releaseStage: "deprecated",
    shutdownDate: "2025-11-18",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.6-flash",
      "Google lists gemini-3.6-flash as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.5-flash-preview-05-20 on November 18, 2025. The documented replacement is gemini-3.6-flash; this app does not substitute models automatically.",
  },
  "gemini-2.5-flash-preview-09-25": {
    releaseStage: "deprecated",
    shutdownDate: "2026-02-17",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.6-flash",
      "Google lists gemini-3.6-flash as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.5-flash-preview-09-25 on February 17, 2026. The documented replacement is gemini-3.6-flash; this app does not substitute models automatically.",
  },
  "gemini-2.5-flash-lite-preview-09-2025": {
    releaseStage: "deprecated",
    shutdownDate: "2026-03-31",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.1-flash-lite",
      "Google lists gemini-3.1-flash-lite as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.5-flash-lite-preview-09-2025 on March 31, 2026. The documented replacement is gemini-3.1-flash-lite; this app does not substitute models automatically.",
  },
  "gemini-2.5-pro-preview-03-25": {
    releaseStage: "deprecated",
    shutdownDate: "2025-12-02",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.1-pro-preview",
      "Google lists gemini-3.1-pro-preview as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.5-pro-preview-03-25 on December 2, 2025. The documented replacement is gemini-3.1-pro-preview; this app does not substitute models automatically.",
  },
  "gemini-2.5-pro-preview-05-06": {
    releaseStage: "deprecated",
    shutdownDate: "2025-12-02",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.1-pro-preview",
      "Google lists gemini-3.1-pro-preview as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.5-pro-preview-05-06 on December 2, 2025. The documented replacement is gemini-3.1-pro-preview; this app does not substitute models automatically.",
  },
  "gemini-2.5-pro-preview-06-05": {
    releaseStage: "deprecated",
    shutdownDate: "2025-12-02",
    pricing: GEMINI_NO_CURRENT_PRICE,
    freeTier: GEMINI_NO_FREE_TIER_APPLICABLE,
    replacement: geminiReplacement(
      "gemini-3.1-pro-preview",
      "Google lists gemini-3.1-pro-preview as the replacement. This app does not substitute it automatically.",
    ),
    unavailableReason:
      "Google shut down gemini-2.5-pro-preview-06-05 on December 2, 2025. The documented replacement is gemini-3.1-pro-preview; this app does not substitute models automatically.",
  },
};

export function geminiModelPolicy(modelId: string): GeminiModelPolicy | undefined {
  return GEMINI_MODEL_POLICIES[modelId];
}

function geminiCapabilities(
  id: string,
  methods: string[],
  description: string,
): ModelCapability[] {
  const lower = `${id} ${description}`.toLowerCase();
  if (id === "aqa" || methods.includes("generateAnswer")) return ["other"];
  if (isSafetyModel(id, description)) return ["safety"];
  if (id.includes("embedding") || methods.includes("embedContent")) return ["embeddings"];
  if (id.includes("transcribe")) return ["transcription"];
  if (id.includes("lyria") || id.includes("tts")) return ["audio-output"];
  if (methods.includes("bidiGenerateContent") || lower.includes("live")) {
    return ["audio-input", "audio-output"];
  }
  if (id.includes("image") || id.includes("nano-banana")) return ["image"];
  if (id.includes("omni") || id.includes("veo")) return ["video"];
  if (
    /computer-use|deep-research|antigravity|robotics/.test(id) ||
    methods.length === 0
  ) {
    return ["other"];
  }
  if (lower.includes("multimodal") || lower.includes("vision")) {
    return ["text", "vision-input"];
  }
  return ["text"];
}

async function discoverGemini(apiKey: string): Promise<ModelDefinition[]> {
  const provider = getProvider("gemini");
  if (!provider) return [];
  const result = await fetchJson(
    `${provider.baseUrl.replace(/\/+$/, "")}/models?pageSize=1000`,
    { "x-goog-api-key": apiKey },
  );
  if (!result.ok) throw new DiscoveryFailure(result.error);
  const data = (result.json as {
    models?: Array<{
      name?: string;
      displayName?: string;
      description?: string;
      supportedGenerationMethods?: string[];
      inputTokenLimit?: number;
      outputTokenLimit?: number;
      version?: string;
      temperature?: number;
      maxTemperature?: number;
    }>;
  }).models;
  const list = Array.isArray(data) ? data : [];

  const models: ModelDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const fullName = typeof entry.name === "string" ? entry.name : "";
    if (!fullName) continue;
    const id = fullName.replace(/^models\//, "");
    if (!id || seen.has(id)) continue;
    const methods = Array.isArray(entry.supportedGenerationMethods)
      ? entry.supportedGenerationMethods
      : [];
    const capabilities = geminiCapabilities(id, methods, entry.description ?? "");
    const policy = GEMINI_MODEL_POLICIES[id];
    const descriptionSaysDeprecated = /deprecated|shut down|rerout/i.test(
      entry.description ?? "",
    );
    const deprecated =
      policy?.releaseStage === "deprecated" || descriptionSaysDeprecated;
    const textChat = capabilities.includes("text");
    const releaseStage =
      policy?.releaseStage ??
      (deprecated ? "deprecated" : releaseStageFor(id, entry.description ?? ""));
    const freeTier =
      policy?.freeTier ??
      (deprecated ? GEMINI_NO_FREE_TIER_APPLICABLE : undefined);
    const pricing =
      policy?.pricing ??
      (deprecated ? GEMINI_NO_CURRENT_PRICE : undefined);
    const unavailableReason =
      policy?.unavailableReason ??
      (deprecated
        ? "Google's model metadata or lifecycle documentation marks this model as shut down or rerouted. It may still appear in ListModels, but it is not offered for inference here and is never replaced automatically."
        : undefined);
    const verifiedFree =
      pricing?.status === "verified-free" &&
      (freeTier?.eligibility === "eligible" || freeTier?.eligibility === "limited");
    const accessType = unavailableReason
      ? "unavailable"
      : deprecated
        ? "unavailable"
        : verifiedFree
          ? "limited-free"
          : "byok";
    const limitations = [
      capabilities.includes("text")
        ? "Text inference is not tested by discovery. Use the Test action to make one real request."
        : "This app's playgrounds do not implement this model's output type.",
      deprecated
        ? "Google documents this model as shut down or rerouted; it is not selectable."
        : "Access is evaluated separately from pricing. A key listing does not prove free-tier eligibility or successful inference.",
      capabilities.includes("vision-input")
        ? "The provider supports multimodal input; this app's text playground sends text only."
        : "Only this exact model ID is used; no fallback model is selected.",
    ];
    if (policy?.userAccessNote && !deprecated) {
      limitations.push(policy.userAccessNote);
    }
    if (freeTier?.eligibility === "unverified") {
      limitations.push("Free-tier eligibility for this exact agent route was not confirmed; no free access is assumed.");
    }
    if (policy?.replacement) {
      limitations.push(
        `Google lists ${policy.replacement.modelId} as the recommended replacement. It is never selected or called automatically; this app does not implement every operation that replacement supports.`,
      );
    }
    seen.add(id);
    models.push(
      baseDefinition("gemini", id, {
        name: entry.displayName || id,
        description:
          entry.description ||
          "Google Gemini model returned by the authenticated ListModels endpoint.",
        capabilities,
        accessType,
        paid: false,
        method: "Authenticated Gemini ListModels call",
        evidence: `Returned by generativelanguage.googleapis.com. Supported methods: ${
          methods.length > 0 ? methods.join(", ") : "none reported"
        }.${policy?.shutdownDate ? ` Google documents shutdown on ${policy.shutdownDate}.` : ""}`,
        limitations,
        contextWindow:
          typeof entry.inputTokenLimit === "number"
            ? entry.inputTokenLimit
            : policy?.contextWindow,
        maxOutputTokens:
          typeof entry.outputTokenLimit === "number"
            ? entry.outputTokenLimit
            : policy?.outputTokenLimit,
        parameters: textChat ? ["temperature", "max_tokens"] : [],
        streaming: Boolean(textChat && methods.includes("generateContent")),
        releaseStage,
        shutdownDate: policy?.shutdownDate,
        replacement: policy?.replacement,
        pricing,
        freeTier,
        userAccessNote: policy?.userAccessNote,
        docsUrl: policy?.docsUrl ?? GEMINI_MODELS_URL,
        unavailableReason,
        rateLimits:
          "Google publishes RPM/TPM/RPD limits per model; free-tier limits can be zero for some models.",
      }),
    );
    if (models.length >= MAX_MODELS_PER_PROVIDER) break;
  }
  return models;
}

async function discoverHuggingFace(apiKey: string): Promise<ModelDefinition[]> {
  const provider = getProvider("huggingface");
  if (!provider) return [];
  const result = await fetchJson(`${provider.baseUrl.replace(/\/+$/, "")}/models`, {
    authorization: `Bearer ${apiKey}`,
  });
  if (!result.ok) throw new DiscoveryFailure(result.error);
  const data = (result.json as { data?: Array<{ id?: string }> }).data;
  const list = Array.isArray(data) ? data : [];

  const models: ModelDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!id || seen.has(id)) continue;
    // The router also lists image and speech models. This app only implements
    // chat completions, so only chat-style IDs are advertised.
    if (/image|diffus|flux|sdxl|stable-|whisper|tts|audio|embed/i.test(id)) continue;
    seen.add(id);
    models.push(
      baseDefinition("huggingface", id, {
        name: id,
        description: "Model routed by Hugging Face Inference Providers, returned by /v1/models.",
        accessType: "byok",
        paid: true,
        pricing: {
          status: "verified-paid",
          detail:
            "Hugging Face Inference Providers are pay-as-you-go or consume PRO/Team credits. Actual charges depend on the routed provider and your account.",
          checkedAt: today(),
          sourceUrl: "https://huggingface.co/docs/inference-providers",
        },
        freeTier: {
          eligibility: "not-eligible",
          detail:
            "The router is not a no-cost free tier. A free account generally needs credits or a PRO plan.",
          sourceUrl: "https://huggingface.co/docs/inference-providers",
        },
        method: "Authenticated Hugging Face router /v1/models listing",
        evidence: "Returned by router.huggingface.co for the saved token.",
        limitations: [
          "Not a free tier: usage can consume paid or PRO-included credits.",
          "Inference is not tested by discovery. A failed request is reported as-is.",
          "Requires the operator to enable ALLOW_PAID_BYOK=true.",
          "Only this exact model ID is used; no provider or model fallback.",
        ],
        rateLimits: "Credit-based; remaining quota is not exposed by this endpoint.",
      }),
    );
    if (models.length >= MAX_MODELS_PER_PROVIDER) break;
  }
  return models;
}

async function discoverCloudflare(apiKey: string): Promise<ModelDefinition[]> {
  let modelIds: string[];
  try {
    modelIds = (await listCloudflareTextModels(apiKey)).modelIds;
  } catch (error) {
    throw new DiscoveryFailure(
      error instanceof Error
        ? error.message
        : "Cloudflare's model list could not be read.",
    );
  }

  return modelIds.slice(0, MAX_MODELS_PER_PROVIDER).map((id) =>
    baseDefinition("cloudflare", id, {
      name: id,
      description:
        "Text-generation model available to this Cloudflare account, returned by Workers AI's model search.",
      accessType: "limited-free",
      paid: false,
      pricing: {
        status: "verified-free",
        detail:
          "Cloudflare includes 10,000 Neurons per day on the Workers Free and Workers Paid plans. Usage beyond the daily allocation is billed on paid plans.",
        checkedAt: today(),
        sourceUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
      },
      freeTier: {
        eligibility: "limited",
        detail:
          "The daily 10,000-Neuron allocation is shared by the whole account. When it is exhausted, requests fail until it resets unless paid usage is enabled.",
        sourceUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
      },
      method: "Authenticated Cloudflare Workers AI model search",
      evidence:
        "Returned by /accounts/<account_id>/ai/models/search for the saved account ID and token.",
      limitations: [
        "The account-wide daily Neuron allowance applies to every Workers AI model.",
        "Inference is not tested by discovery. A failed request is reported as-is.",
        "Only text-generation models are listed; image and embedding models are excluded.",
        "Only this exact model ID is used; no provider or model fallback.",
      ],
      streaming: false,
      rateLimits: "Account-wide daily Neuron allocation plus Cloudflare rate limits.",
      docsUrl: "https://developers.cloudflare.com/workers-ai/models/",
    }),
  );
}

/**
 * Query one provider. A missing credential is not an error: it means the
 * provider cannot be discovered for this visitor, so an empty list is returned.
 */
export async function discoverProviderModels(
  providerId: DiscoveryProviderId,
  options: { apiKey?: string; force?: boolean } = {},
): Promise<ProviderDiscovery> {
  const provider = getProvider(providerId);
  const providerName = provider?.name ?? providerId;
  const requiresKey = providerId !== "openrouter";
  const apiKey = options.apiKey;
  const authenticated = Boolean(apiKey);

  if (requiresKey && !apiKey) {
    return {
      providerId,
      providerName,
      models: [],
      error: null,
      authenticated: false,
      checkedAt: Date.now(),
      cached: false,
    };
  }

  const key = cacheKey(providerId, apiKey);
  const entry = cache.get(key);
  if (!options.force && entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return {
      providerId,
      providerName,
      models: entry.models,
      error: null,
      authenticated,
      checkedAt: entry.at,
      cached: true,
    };
  }

  try {
    let models: ModelDefinition[];
    if (providerId === "openrouter") models = await discoverOpenRouter(apiKey);
    else if (providerId === "groq") models = await discoverGroq(apiKey!);
    else if (providerId === "gemini") models = await discoverGemini(apiKey!);
    else if (providerId === "cloudflare") models = await discoverCloudflare(apiKey!);
    else models = await discoverHuggingFace(apiKey!);

    cache.set(key, { at: Date.now(), models });
    return {
      providerId,
      providerName,
      models,
      error: null,
      authenticated,
      checkedAt: Date.now(),
      cached: false,
    };
  } catch (error) {
    const message =
      error instanceof DiscoveryFailure
        ? error.message
        : "The provider's model list could not be read.";
    // Fall back to the last successful list for this credential, but say so.
    if (entry) {
      return {
        providerId,
        providerName,
        models: entry.models,
        error: `${message} Showing the last successful list from this session.`,
        authenticated,
        checkedAt: entry.at,
        cached: true,
      };
    }
    return {
      providerId,
      providerName,
      models: [],
      error: message,
      authenticated,
      checkedAt: Date.now(),
      cached: false,
    };
  }
}

export async function discoverAllProviders(
  apiKeys: Partial<Record<DiscoveryProviderId, string>> = {},
  options: { force?: boolean } = {},
): Promise<ProviderDiscovery[]> {
  return Promise.all(
    DISCOVERY_PROVIDER_IDS.map((providerId) =>
      discoverProviderModels(providerId, { apiKey: apiKeys[providerId], force: options.force }),
    ),
  );
}
