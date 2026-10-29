import { describe, expect, it } from "vitest";
import {
  mapHttpError,
  mapNetworkError,
  parseProviderErrorBody,
  ProviderError,
  redactSecret,
} from "@/lib/providers/errors";
import {
  assertNoRedirect,
  extractOpenAIText,
  joinUrl,
  normalizeBaseUrl,
  parseOpenAIUsage,
} from "@/lib/providers/http";
import { publicError } from "@/lib/http/api";
import {
  AVAILABILITY_LABELS,
  FREE_TIER_LABELS,
  INFERENCE_LABELS,
  PRICING_LABELS,
} from "@/lib/providers/access-labels";
import {
  CATALOG_ACCESS_LABELS,
  CATALOG_ACCESS_STATUSES,
  CATALOG_VIEWS,
  CATALOG_VIEW_LABELS,
  catalogAccessRank,
  catalogAccessStatus,
  catalogViewCounts,
  filterDefaultCatalogModels,
  isCompatibleForCatalog,
  isDefaultCatalogModel,
  matchesCatalogAccess,
  matchesCatalogView,
} from "@/lib/providers/catalog-view";
import {
  hasVerifiedFreeSelectorAccess,
  simpleAccessLabel,
} from "@/lib/providers/playground-access";
import {
  GROQ_FREE_PLAN_MODEL_IDS,
  geminiModelPolicy,
  isOpenRouterFreeVariant,
  isSafetyModel,
} from "@/lib/providers/discovery";
import {
  isCompatibleWithPlayground,
  supportedPlaygroundOperations,
} from "@/lib/providers/playground-support";
import {
  buildLocalModels,
  evaluateRegistryModels,
  selectPlaygroundModels,
} from "@/lib/providers/runtime";
import {
  ACCESS_LABELS,
  accessLabel,
  getProvider,
  getRegistryModel,
  MODELS,
  PROVIDERS,
} from "@/lib/providers/registry";
import type { ModelDefinition, ModelInferenceTest } from "@/lib/providers/types";

describe("provider error mapping", () => {
  it("maps authentication failures", () => {
    const error = mapHttpError(401, '{"error":{"message":"bad key"}}', "test");
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("auth");
    expect(error.status).toBe(401);
  });

  it("recognizes invalid keys returned as HTTP 400 or 403", () => {
    expect(
      mapHttpError(
        400,
        '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
        "gemini",
      ).code,
    ).toBe("auth");
    expect(
      mapHttpError(
        403,
        '{"error":{"message":"The provided API key is expired.","status":"PERMISSION_DENIED"}}',
        "gemini",
      ).code,
    ).toBe("auth");
    expect(mapHttpError(400, '{"error":{"message":"Billing required"}}', "gemini").code).toBe(
      "payment_required",
    );
    expect(mapHttpError(400, '{"error":{"message":"Quota exhausted"}}', "gemini").code).toBe(
      "quota",
    );
  });

  it("separates payment restrictions from quota exhaustion", () => {
    expect(mapHttpError(402, "", "test").code).toBe("payment_required");
    expect(
      mapHttpError(403, '{"error":{"message":"insufficient credit"}}', "test").code,
    ).toBe("payment_required");
    expect(
      mapHttpError(403, '{"error":{"message":"quota exhausted"}}', "test").code,
    ).toBe("quota");
    expect(mapHttpError(403, '{"error":{"message":"forbidden"}}', "test").code).toBe("forbidden");
    expect(
      mapHttpError(403, '{"error":{"message":"free tier not available in your region"}}', "test")
        .code,
    ).toBe("forbidden");
  });

  it("maps rate limits and preserves retry-after", () => {
    const headers = new Headers({ "retry-after": "12" });
    const error = mapHttpError(429, "", "test", undefined, headers);
    expect(error.code).toBe("rate_limit");
    expect(error.retryAfterSeconds).toBe(12);
    expect(error.message).toContain("12s");
  });

  it("classifies 429 quota and payment bodies separately from short-term rate limits", () => {
    expect(mapHttpError(429, "daily limit reached", "test").code).toBe("quota");
    expect(mapHttpError(429, "billing required", "test").code).toBe("payment_required");
    expect(mapHttpError(429, "too many requests", "test").code).toBe("rate_limit");
  });

  it("preserves retry-after on 429 rate limit errors", () => {
    const headers = new Headers({ "retry-after": "30" });
    const error = mapHttpError(429, "", "test", undefined, headers);
    expect(error.code).toBe("rate_limit");
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.message).toContain("30s");
  });

  it("classifies 429 with quota-exhausted message as quota", () => {
    expect(mapHttpError(429, "quota exhausted", "test").code).toBe("quota");
    expect(mapHttpError(429, "monthly quota exceeded", "test").code).toBe("quota");
  });

  it("classifies 429 with rate-limited message as rate_limit", () => {
    expect(mapHttpError(429, "rate limit exceeded", "test").code).toBe("rate_limit");
    expect(mapHttpError(429, "too many requests", "test").code).toBe("rate_limit");
  });

  it("maps provider_forbidden error with HTTP 403", () => {
    const error = mapHttpError(403, "{\"error\":{\"message\":\"access denied\"}}", "test");
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("forbidden");
    expect(error.status).toBe(403);
  });

  it("maps auth failures from 401 status", () => {
    const error = mapHttpError(401, '{"error":{"message":"invalid credentials"}}', "test");
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("auth");
    expect(error.status).toBe(401);
  });

  it("maps auth failures from invalid key message in 400", () => {
    expect(
      mapHttpError(
        400,
        '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key."}}',
        "gemini",
      ).code,
    ).toBe("auth");
    expect(
      mapHttpError(
        403,
        '{"error":{"message":"The provided API key is expired."}}',
        "gemini",
      ).code,
    ).toBe("auth");
  });

  it("maps quota exhaustion from 403 status", () => {
    expect(
      mapHttpError(
        403,
        '{"error":{"message":"quota exhausted"}}',
        "test",
      ).code,
    ).toBe("quota");
    expect(
      mapHttpError(
        403,
        '{"error":{"message":"daily quota exceeded"}}',
        "test",
      ).code,
    ).toBe("quota");
  });

  it("maps model_unavailable from 404 status with model message", () => {
    expect(
      mapHttpError(
        404,
        '{"error":{"message":"model not found"}}',
        "test",
      ).code,
    ).toBe("model_unavailable");
    expect(
      mapHttpError(
        400,
        '{"error":{"message":"unknown model"}}',
        "test",
      ).code,
    ).toBe("model_unavailable");
  });

  it("maps context length exceeded as invalid_request", () => {
    const context = mapHttpError(
      400,
      '{"error":{"message":"maximum context length exceeded"}}',
      "test",
    );
    expect(context.code).toBe("invalid_request");
    expect(context.message).toContain("context window");
  });

  it("maps safety blocks as content_blocked", () => {
    expect(
      mapHttpError(
        400,
        '{"error":{"message":"blocked by safety policy"}}',
        "test",
      ).code,
    ).toBe("content_blocked");
  });

  it("maps server errors (500-599) as server errors", () => {
    expect(mapHttpError(500, "boom", "test").code).toBe("server");
    expect(mapHttpError(503, "unavailable", "test").code).toBe("server");
  });

  it("maps network/timeout errors appropriately", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(mapNetworkError(timeout, "test").code).toBe("timeout");
    expect(mapNetworkError(new Error("fetch failed"), "test").code).toBe("network");
    expect(mapNetworkError("odd", "test").code).toBe("network");
  });

  it("maps missing models and context errors", () => {
    expect(
      mapHttpError(404, '{"error":{"message":"model not found"}}', "test").code,
    ).toBe("model_unavailable");
    expect(
      mapHttpError(400, '{"error":{"message":"unknown model"}}', "test").code,
    ).toBe("model_unavailable");
    const context = mapHttpError(400, '{"error":{"message":"maximum context length exceeded"}}', "test");
    expect(context.code).toBe("invalid_request");
    expect(context.message).toContain("context window");
  });

  it("maps safety blocks and server failures", () => {
    expect(
      mapHttpError(400, '{"error":{"message":"blocked by safety policy"}}', "test").code,
    ).toBe("content_blocked");
    expect(mapHttpError(500, "boom", "test").code).toBe("server");
    expect(mapHttpError(503, "unavailable", "test").code).toBe("server");
  });

  it("redacts API keys from provider details", () => {
    const key = "sk-live-abcdefghijklmnop";
    const error = mapHttpError(
      401,
      JSON.stringify({ error: { message: `Invalid key ${key}` } }),
      "test",
      key,
    );
    expect(error.details).not.toContain(key);
    expect(error.details).toContain("[REDACTED]");
  });

  it("parses provider bodies defensively", () => {
    expect(parseProviderErrorBody('{"error":{"message":"x","code":"y"}}')).toEqual({
      message: "x",
      code: "y",
    });
    expect(parseProviderErrorBody('{"error":"plain"}')).toEqual({ message: "plain" });
    expect(parseProviderErrorBody("not json")).toEqual({ message: "not json" });
    expect(parseProviderErrorBody("")).toEqual({});
  });

  it("redacts common key shapes", () => {
    expect(redactSecret("key sk-abcdefghijklmnop")).toBe("key [REDACTED]");
    expect(redactSecret("key gsk_abcdefghijklmnop")).toBe("key [REDACTED]");
    expect(redactSecret("key AIzaabcdefghijklmnop")).toBe("key [REDACTED]");
    expect(redactSecret("nothing secret")).toBe("nothing secret");
  });

  it("maps network and timeout errors", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(mapNetworkError(timeout, "test").code).toBe("timeout");
    expect(mapNetworkError(new Error("fetch failed"), "test").code).toBe("network");
    expect(mapNetworkError("odd", "test").code).toBe("network");
  });
});

describe("public error response codes", () => {
  it("maps invalid keys to provider_auth with HTTP 422", () => {
    const { status, body } = publicError(
      new ProviderError("auth", "Authentication failed.", { provider: "gemini" }),
    );
    expect(status).toBe(422);
    expect(body.error.code).toBe("provider_auth");
    expect(body.error.message).toBe("Authentication failed.");
  });

  it("maps account restrictions to provider_forbidden with HTTP 403", () => {
    const { status, body } = publicError(
      new ProviderError("forbidden", "Access denied.", { provider: "test" }),
    );
    expect(status).toBe(403);
    expect(body.error.code).toBe("provider_forbidden");
    expect(body.error.message).toBe("Access denied.");
  });

  it("maps provider configuration errors to provider_invalid_request with HTTP 400", () => {
    const { status, body } = publicError(
      new ProviderError("config", "Configuration error.", { provider: "test" }),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe("provider_invalid_request");
    expect(body.error.message).toBe("Configuration error.");
  });

  it("maps unavailable models to provider_model_unavailable with HTTP 404", () => {
    const { status, body } = publicError(
      new ProviderError("model_unavailable", "Model not found.", { provider: "test" }),
    );
    expect(status).toBe(404);
    expect(body.error.code).toBe("provider_model_unavailable");
    expect(body.error.message).toBe("Model not found.");
  });
});

describe("HTTP helpers", () => {
  it("normalizes base URLs", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeBaseUrl("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1",
    );
    expect(normalizeBaseUrl("https://api.example.com/v1?x=1#frag")).toBe(
      "https://api.example.com/v1",
    );
    expect(joinUrl("https://api.example.com/v1/", "/models")).toBe(
      "https://api.example.com/v1/models",
    );
  });

  it("parses token usage with fallbacks", () => {
    expect(parseOpenAIUsage({ prompt_tokens: 2, completion_tokens: 3 })).toEqual({
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      available: true,
    });
    expect(parseOpenAIUsage({ input_tokens: 4, output_tokens: 6, total_tokens: 10 })).toEqual({
      usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      available: true,
    });
    expect(parseOpenAIUsage(null)).toEqual({
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      available: false,
    });
  });

  it("extracts text from string and array content", () => {
    expect(extractOpenAIText({ content: "hello" })).toBe("hello");
    expect(extractOpenAIText({ content: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(extractOpenAIText({ refusal: "no" })).toBe("no");
    expect(extractOpenAIText(null)).toBe("");
  });

  it("rejects redirects instead of following them", () => {
    const redirect = new Response(null, { status: 302 });
    expect(() => assertNoRedirect(redirect, "test")).toThrow(/redirect/i);
  });
});

describe("registry and runtime gating", () => {
  it("has unique model refs and resolvable providers", () => {
    expect(new Set(MODELS.map((model) => model.ref)).size).toBe(MODELS.length);
    for (const model of MODELS) {
      expect(getProvider(model.providerId)).toBeDefined();
      expect(getRegistryModel(model.ref)).toBe(model);
    }
  });

  it("labels access types with the required category names", () => {
    expect(accessLabel("free")).toBe("FREE TIER");
    expect(accessLabel("limited-free")).toBe("LIMITED FREE");
    expect(accessLabel("local")).toBe("LOCAL — NO HOSTED API FEE");
    expect(accessLabel("byok")).toBe("BYOK / PROVIDER KEY");
    expect(accessLabel("unavailable")).toBe("UNAVAILABLE");
    expect(PRICING_LABELS["verified-free"]).toBe("FREE VERIFIED");
    expect(PRICING_LABELS["verified-paid"]).toBe("PAID / CREDITS REQUIRED");
    expect(PRICING_LABELS["local-no-fee"]).toBe("LOCAL — NO HOSTED API FEE");
    expect(FREE_TIER_LABELS.limited).toBe("LIMITED FREE");
    expect(AVAILABILITY_LABELS.available).toBe("AVAILABLE");
    expect(AVAILABILITY_LABELS["temporarily-unavailable"]).toBe("TEMPORARILY UNAVAILABLE");
    expect(AVAILABILITY_LABELS["rate-limited"]).toBe("RATE LIMITED");
    expect(AVAILABILITY_LABELS["invalid-key"]).toBe("INVALID KEY / ACCESS DENIED");
    expect(AVAILABILITY_LABELS["payment-required"]).toBe("PAYMENT / CREDITS REQUIRED");
    expect(AVAILABILITY_LABELS.deprecated).toBe("DEPRECATED");
    expect(AVAILABILITY_LABELS.unavailable).toBe("UNAVAILABLE");
    expect(AVAILABILITY_LABELS["not-verified"]).toBe("NOT VERIFIED");
    expect(Object.keys(ACCESS_LABELS).sort()).toEqual([
      "byok",
      "free",
      "limited-free",
      "local",
      "unavailable",
    ]);
  });

  it("never invents static Ollama models", () => {
    expect(MODELS.some((model) => model.providerId === "ollama")).toBe(false);
    expect(getProvider("ollama")?.requiresKey).toBe(false);
    expect(getProvider("ollama")?.accessTypes).toEqual(["local"]);
  });

  it("classifies discovered Ollama models as local and drops offline discoveries", () => {
    const discovery = {
      online: true,
      baseUrl: "http://127.0.0.1:11434",
      error: null,
      checkedAt: Date.now(),
      models: [
        {
          id: "llama3.2:latest",
          name: "llama3.2:latest",
          sizeBytes: 2019393189,
          parameterSize: "3.2B",
          quantization: "Q4_K_M",
          modifiedAt: "2026-10-01T00:00:00Z",
        },
      ],
    };

    const local = buildLocalModels(discovery);
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({
      ref: "ollama::llama3.2:latest",
      providerId: "ollama",
      modelId: "llama3.2:latest",
      capabilities: ["text"],
      accessType: "local",
      paid: false,
      streaming: true,
    });
    expect(local[0]?.verification.state).toBe("verified");

    expect(buildLocalModels({ ...discovery, online: false, models: [] })).toEqual([]);
  });

  it("marks discovered local models available and connected", () => {
    const local = buildLocalModels({
      online: true,
      baseUrl: "http://127.0.0.1:11434",
      error: null,
      checkedAt: Date.now(),
      models: [
        {
          id: "qwen3:8b",
          name: "qwen3:8b",
          sizeBytes: null,
          parameterSize: null,
          quantization: null,
          modifiedAt: null,
        },
      ],
    });

    const model = evaluateRegistryModels(new Map(), false, local).find(
      (entry) => entry.ref === "ollama::qwen3:8b",
    );
    expect(model).toMatchObject({
      status: "available",
      connected: true,
      accessType: "local",
      providerName: "Ollama (local)",
    });
  });

  it("never reports an offline local model as connected", () => {
    const stale: ModelDefinition = {
      ref: "ollama::stale",
      providerId: "ollama",
      modelId: "stale",
      name: "stale",
      description: "Previously discovered model.",
      capabilities: ["text"],
      accessType: "local",
      paid: false,
      verification: {
        state: "unverified",
        method: "none",
        checkedAt: "2026-10-23",
        evidence: "Not currently discovered.",
        docsUrl: "https://ollama.com/",
      },
      limitations: [],
      parameters: ["temperature", "max_tokens"],
      streaming: true,
    };

    const model = evaluateRegistryModels(new Map(), false, [stale]).find(
      (entry) => entry.ref === "ollama::stale",
    );
    expect(model?.status).toBe("offline");
    expect(model?.connected).toBe(false);
  });

  it("keeps every paid model disabled and disconnected without explicit opt-in", () => {
    for (const model of MODELS.filter((entry) => entry.paid)) {
      expect(model.accessType).toBe("byok");
    }

    const allCredentials = new Map(
      PROVIDERS.filter((provider) => provider.requiresKey).map((provider) => [
        provider.id,
        {
          verified: true,
          models: MODELS.filter((model) => model.providerId === provider.id).map(
            (model) => model.modelId,
          ),
        },
      ]),
    );

    const evaluated = evaluateRegistryModels(allCredentials, false);
    const paid = evaluated.filter((model) => model.paid);
    expect(paid.length).toBeGreaterThan(0);
    for (const model of paid) {
      expect(model.status).toBe("disabled_paid");
      expect(model.connected).toBe(false);
    }
  });

  it("makes only live-verified keyless models selectable without credentials", () => {
    const models = evaluateRegistryModels(new Map(), false);
    const available = models.filter((model) => model.status === "available");
    expect(available.map((model) => model.ref).sort()).toContain("pollinations::flux");
    expect(available.map((model) => model.ref).sort()).toContain("pollinations::openai-fast");
    expect(models.find((model) => model.ref === "gemini::gemini-3.6-flash")?.status).toBe(
      "requires_key",
    );
    expect(models.find((model) => model.ref === "pollinations::flux")).toMatchObject({
      supportedOperations: ["image"],
      availability: { state: "available" },
    });
    expect(models.find((model) => model.ref === "pollinations::openai-fast")).toMatchObject({
      supportedOperations: ["chat"],
      availability: { state: "available" },
    });
    expect(models.find((model) => model.ref === "gemini::gemini-3.6-flash")).toMatchObject({
      supportedOperations: ["chat"],
      availability: { state: "not-verified" },
    });
  });

  it("scopes compatibility to the selected playground", () => {
    expect(supportedPlaygroundOperations("pollinations", ["image"])).toEqual(["image"]);
    expect(supportedPlaygroundOperations("pollinations", ["text", "image"])).toEqual([
      "chat",
      "image",
    ]);
    expect(supportedPlaygroundOperations("gemini", ["image"])).toEqual([]);
    expect(isCompatibleWithPlayground("pollinations", ["image"], "text")).toBe(false);
    expect(isCompatibleWithPlayground("pollinations", ["image"], "image")).toBe(true);
    expect(isCompatibleWithPlayground("gemini", ["text"], "text")).toBe(true);
    expect(isCompatibleWithPlayground("gemini", ["text"], "image")).toBe(false);

    const models = evaluateRegistryModels(new Map(), false);
    const flux = models.find((model) => model.ref === "pollinations::flux");
    const sana = models.find((model) => model.ref === "pollinations::sana");
    const gemini = models.find((model) => model.ref === "gemini::gemini-3.6-flash");
    expect(flux).toBeDefined();
    expect(sana).toBeDefined();
    expect(gemini).toBeDefined();
    expect(flux && isCompatibleForCatalog(flux, "text")).toBe(false);
    expect(flux && isCompatibleForCatalog(flux, "image")).toBe(true);
    expect(sana && isCompatibleForCatalog(sana, "image")).toBe(false);
    expect(gemini && isCompatibleForCatalog(gemini, "text")).toBe(true);
    expect(gemini && isCompatibleForCatalog(gemini, "image")).toBe(false);
  });

  it("keeps safety/guardrail models out of general chat while retaining provider access", () => {
    expect(isSafetyModel("nvidia/nemotron-3.5-content-safety:free")).toBe(true);
    expect(
      isSafetyModel(
        "nvidia/nemotron-3.5-content-safety:free",
        "NVIDIA Nemotron 3.5 Content Safety is a multimodal guardrail model.",
      ),
    ).toBe(true);
    expect(isSafetyModel("meta-llama/llama-guard-4-12b")).toBe(true);
    expect(isSafetyModel("openai/gpt-oss-safeguard-20b")).toBe(true);
    expect(
      isSafetyModel(
        "google/gemma-4-26b-a4b-it:free",
        "A general assistant with safety filters.",
      ),
    ).toBe(false);

    expect(supportedPlaygroundOperations("openrouter", ["safety", "vision-input"])).toEqual([]);
    expect(supportedPlaygroundOperations("openrouter", ["text", "safety"])).toEqual([]);
    expect(isCompatibleWithPlayground("openrouter", ["safety"], "text")).toBe(false);
    expect(isCompatibleWithPlayground("openrouter", ["safety"], "image")).toBe(false);

    const safety: ModelDefinition = {
      ref: "openrouter::nvidia/nemotron-3.5-content-safety:free",
      providerId: "openrouter",
      modelId: "nvidia/nemotron-3.5-content-safety:free",
      name: "NVIDIA: Nemotron 3.5 Content Safety (free)",
      description: "Multimodal guardrail model for safety classification.",
      capabilities: ["safety", "vision-input"],
      accessType: "limited-free",
      paid: false,
      verification: { state: "discovered", method: "Test fixture" },
      limitations: [],
      parameters: ["temperature"],
      streaming: false,
      pricing: { status: "verified-free", detail: "Test fixture" },
      freeTier: { eligibility: "limited", detail: "Test fixture" },
    };
    const models = evaluateRegistryModels(new Map(), false, [safety]);
    const model = models.find((entry) => entry.ref === safety.ref);
    expect(model).toBeDefined();
    if (!model) return;

    expect(model.status).toBe("unsupported");
    expect(model.supportedOperations).toEqual([]);
    expect(model.userAccess.state).toBe("not-applicable");
    expect(model.accessEvidence).toBe("not_applicable");
    expect(model.canOpen).toBe(false);
    expect(model.canTest).toBe(false);
    expect(catalogAccessStatus(model)).toBe("limited-free");
    expect(matchesCatalogView(model, "unsupported", "text")).toBe(true);
    expect(matchesCatalogView(model, "compatible", "text")).toBe(false);
    expect(selectPlaygroundModels(models, "text").map((entry) => entry.ref)).not.toContain(
      safety.ref,
    );
  });

  it("builds default, unsupported, untested, paid, and all-model views independently", () => {
    const models = evaluateRegistryModels(new Map(), false);
    const textCounts = catalogViewCounts(models, "text");
    const imageCounts = catalogViewCounts(models, "image");
    expect(textCounts.compatible).toBeGreaterThan(imageCounts.compatible);
    expect(textCounts.all).toBe(models.length);
    expect(imageCounts.all).toBe(models.length);

    const flux = models.find((model) => model.ref === "pollinations::flux");
    const gemini = models.find((model) => model.ref === "gemini::gemini-3.6-flash");
    const paid = models.find((model) => model.ref === "openai::gpt-6-luna");
    expect(flux).toBeDefined();
    expect(gemini).toBeDefined();
    expect(paid).toBeDefined();
    if (!flux || !gemini || !paid) return;

    expect(matchesCatalogView(flux, "compatible", "text")).toBe(false);
    expect(matchesCatalogView(flux, "unsupported", "text")).toBe(true);
    expect(matchesCatalogView(flux, "compatible", "image")).toBe(true);
    expect(matchesCatalogView(gemini, "compatible", "text")).toBe(true);
    expect(matchesCatalogView(gemini, "untested", "text")).toBe(true);
    expect(matchesCatalogView(gemini, "all", "text")).toBe(true);
    expect(matchesCatalogView(paid, "paid", "text")).toBe(true);
    expect(matchesCatalogView(paid, "compatible", "text")).toBe(false);
    expect(matchesCatalogView(gemini, "limited-free", "text")).toBe(true);
    expect(matchesCatalogView(gemini, "free", "text")).toBe(false);
    expect(matchesCatalogView(flux, "limited-free", "image")).toBe(true);
    expect(CATALOG_VIEW_LABELS.free).toBe("Free");
    expect(CATALOG_VIEW_LABELS["limited-free"]).toBe("Limited free");
    expect(CATALOG_VIEW_LABELS["pricing-unverified"]).toBe("Pricing unverified");
    expect(CATALOG_VIEWS as readonly string[]).not.toContain("verified-free");
  });

  it("keeps the full catalog independent from playground eligibility for all providers", () => {
    const models = evaluateRegistryModels(new Map(), false);
    const providerIds = new Set(models.map((model) => model.providerId));

    expect(PROVIDERS).toHaveLength(8);
    expect(providerIds).toEqual(
      new Set([
        "pollinations",
        "gemini",
        "groq",
        "openrouter",
        "huggingface",
        "cloudflare",
        "openai",
      ]),
    );
    expect(PROVIDERS.map((provider) => provider.name)).toEqual([
      "Pollinations",
      "Google Gemini",
      "Groq",
      "OpenRouter",
      "Hugging Face Inference Providers",
      "Cloudflare Workers AI",
      "OpenAI",
      "Ollama (local)",
    ]);

    for (const model of models) {
      expect(matchesCatalogAccess(model, "all")).toBe(true);
    }

    const gemini = models.find((model) => model.ref === "gemini::gemini-3.6-flash");
    const paid = models.find((model) => model.ref === "openai::gpt-6-luna");
    const pollinations = models.find((model) => model.ref === "pollinations::openai-fast");
    expect(gemini).toBeDefined();
    expect(paid).toBeDefined();
    expect(pollinations).toBeDefined();
    if (!gemini || !paid || !pollinations) return;

    expect(catalogAccessStatus(gemini)).toBe("limited-free");
    expect(matchesCatalogAccess(gemini, "all")).toBe(true);
    expect(matchesCatalogAccess(gemini, "free")).toBe(false);
    expect(matchesCatalogAccess(gemini, "limited-free")).toBe(true);
    expect(catalogAccessStatus(pollinations)).toBe("limited-free");
    expect(catalogAccessStatus(paid)).toBe("paid");
    expect(catalogAccessRank("free")).toBeLessThan(catalogAccessRank("limited-free"));
    expect(CATALOG_ACCESS_STATUSES).toEqual([
      "free",
      "limited-free",
      "user-key-required",
      "paid",
      "unavailable",
      "unverified",
    ]);
    expect(CATALOG_ACCESS_LABELS.unverified).toBe("UNVERIFIED");
    expect(CATALOG_ACCESS_LABELS["user-key-required"]).toBe("USER KEY REQUIRED");
  });

  it("shows only verified free and limited-free models in the default catalog", () => {
    const all = evaluateRegistryModels(new Map(), false);
    const visible = filterDefaultCatalogModels(all);

    expect(visible.map((model) => model.ref)).toEqual([
      "pollinations::openai-fast",
      "pollinations::flux",
      "gemini::gemini-3.6-flash",
      "groq::openai/gpt-oss-120b",
      "openrouter::google/gemma-4-26b-a4b-it:free",
      "cloudflare::@cf/meta/llama-3.1-8b-instruct",
      "cloudflare::@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    ]);
    expect(visible).toHaveLength(7);
    expect(all.length).toBeGreaterThan(visible.length);

    const coveredProviders = new Set(visible.map((model) => model.providerId));
    expect(coveredProviders).toEqual(
      new Set(["pollinations", "gemini", "groq", "openrouter", "cloudflare"]),
    );

    for (const model of visible) {
      expect(isDefaultCatalogModel(model)).toBe(true);
      expect(["free", "limited-free"]).toContain(catalogAccessStatus(model));
      expect(model.supportedOperations.length).toBeGreaterThan(0);
    }

    const visibleRefs = new Set(visible.map((model) => model.ref));
    // Confirmed-unavailable, paid-only, and key-required-for-payment records stay
    // in the registry but not in the default free catalog.
    expect(visibleRefs).not.toContain("pollinations::sana");
    expect(visibleRefs).not.toContain("huggingface::openai/gpt-oss-120b");
    expect(visibleRefs).not.toContain("openai::gpt-6-luna");

    const runtime = visible[0];
    expect(runtime).toBeDefined();
    if (!runtime) return;
    for (const status of [
      "rate_limited",
      "model_unavailable",
      "auth_failed",
      "request_failed",
      "deprecated",
      "not_public",
    ] as const) {
      expect(isDefaultCatalogModel({ ...runtime, status })).toBe(false);
    }
    // Paid-through-BYOK records stay out of the free catalog even when the
    // operator enables paid BYOK. They remain available in the advanced view.
    expect(isDefaultCatalogModel({ ...runtime, status: "disabled_paid" })).toBe(false);
  });

  it("exposes hidden confirmed-unavailable records in the advanced registry view", () => {
    const all = evaluateRegistryModels(new Map(), false);
    const visible = filterDefaultCatalogModels(all);
    const hidden = all.filter((model) => !visible.includes(model));

    expect(all.map((model) => model.ref)).toContain("pollinations::sana");
    expect(hidden.map((model) => model.ref)).toContain("pollinations::sana");
    // Nothing is deleted: every default-visible record is still in the full list.
    for (const model of visible) {
      expect(all.map((entry) => entry.ref)).toContain(model.ref);
    }
  });

  it("labels a keyed free-tier route USER KEY REQUIRED and keeps it out of the free catalog", () => {
    const models = evaluateRegistryModels(new Map(), false);
    const hf = models.find((model) => model.ref === "huggingface::openai/gpt-oss-120b");
    expect(hf).toBeDefined();
    if (!hf) return;

    const keyedFree = {
      ...hf,
      accessType: "byok" as const,
      paid: false,
      status: "requires_key" as const,
      pricing: { ...hf.pricing, status: "verified-free" as const },
      freeTier: { ...hf.freeTier, eligibility: "limited" as const },
    };

    expect(catalogAccessStatus(keyedFree)).toBe("user-key-required");
    expect(CATALOG_ACCESS_LABELS["user-key-required"]).toBe("USER KEY REQUIRED");
    expect(catalogAccessRank("user-key-required")).toBeGreaterThan(
      catalogAccessRank("limited-free"),
    );
    expect(catalogAccessRank("user-key-required")).toBeLessThan(catalogAccessRank("paid"));
    expect(matchesCatalogAccess(keyedFree, "user-key-required")).toBe(true);
    expect(matchesCatalogAccess(keyedFree, "free")).toBe(false);
    expect(isDefaultCatalogModel(keyedFree)).toBe(false);
  });

  it("keeps specialized and pricing-unverified records out of the default free catalog", () => {
    const freePricing = {
      status: "verified-free" as const,
      detail: "Test fixture",
      checkedAt: "2026-10-26",
      sourceUrl: "https://example.test",
    };
    const limitedFreeTier = {
      eligibility: "limited" as const,
      detail: "Test fixture",
      sourceUrl: "https://example.test",
    };
    const safety: ModelDefinition = {
      ref: "openrouter::safety-classifier:free",
      providerId: "openrouter",
      modelId: "safety-classifier:free",
      name: "Free safety classifier fixture",
      description: "Test fixture",
      capabilities: ["safety"],
      accessType: "limited-free",
      paid: false,
      verification: { state: "discovered", method: "Test fixture" },
      limitations: [],
      parameters: [],
      streaming: false,
      pricing: freePricing,
      freeTier: limitedFreeTier,
    };
    const unverified: ModelDefinition = {
      ref: "pollinations::unverified-catalog-test",
      providerId: "pollinations",
      modelId: "unverified-catalog-test",
      name: "Unverified catalog fixture",
      description: "Test fixture",
      capabilities: ["text"],
      accessType: "byok",
      paid: false,
      verification: { state: "discovered", method: "Test fixture" },
      limitations: [],
      parameters: ["temperature"],
      streaming: true,
      pricing: { status: "unverified", detail: "Test fixture" },
      freeTier: { eligibility: "unverified", detail: "Test fixture" },
    };
    const all = evaluateRegistryModels(new Map(), false, [safety, unverified]);
    const visible = filterDefaultCatalogModels(all);
    const safetyRuntime = all.find((model) => model.ref === safety.ref);
    const unverifiedRuntime = all.find((model) => model.ref === unverified.ref);

    expect(safetyRuntime).toBeDefined();
    expect(unverifiedRuntime).toBeDefined();
    if (!safetyRuntime || !unverifiedRuntime) return;
    expect(catalogAccessStatus(safetyRuntime)).toBe("limited-free");
    expect(safetyRuntime.supportedOperations).toEqual([]);
    expect(isDefaultCatalogModel(safetyRuntime)).toBe(false);
    expect(catalogAccessStatus(unverifiedRuntime)).toBe("unverified");
    // Pricing-unverified records stay retained and visible in the advanced
    // view, but they are not part of the default free catalog.
    expect(isDefaultCatalogModel(unverifiedRuntime)).toBe(false);
    expect(visible.map((model) => model.ref)).not.toContain(safety.ref);
    expect(visible.map((model) => model.ref)).not.toContain(unverified.ref);
  });

  it("uses Groq's official Free plan model table instead of the full listing", () => {
    expect(GROQ_FREE_PLAN_MODEL_IDS).toEqual(
      new Set([
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
      ]),
    );
    expect(GROQ_FREE_PLAN_MODEL_IDS.has("llama-3.1-8b-instant")).toBe(false);
  });

  it("marks inconclusive pricing as unverified instead of free", () => {
    const unverified: ModelDefinition = {
      ref: "pollinations::unverified-access-test",
      providerId: "pollinations",
      modelId: "unverified-access-test",
      name: "Unverified access fixture",
      description: "Test fixture",
      capabilities: ["text"],
      accessType: "byok",
      paid: false,
      verification: { state: "discovered", method: "Test fixture" },
      limitations: [],
      parameters: ["temperature"],
      streaming: true,
      pricing: { status: "unverified", detail: "Test fixture" },
      freeTier: { eligibility: "unverified", detail: "Test fixture" },
    };
    const model = evaluateRegistryModels(new Map(), false, [unverified]).find(
      (entry) => entry.ref === unverified.ref,
    );

    expect(model).toBeDefined();
    if (!model) return;
    expect(model.pricing.status).toBe("unverified");
    expect(model.freeTier.eligibility).toBe("unverified");
    expect(catalogAccessStatus(model)).toBe("unverified");
    expect(matchesCatalogAccess(model, "unverified")).toBe(true);
    expect(matchesCatalogAccess(model, "free")).toBe(false);
  });

  it("keeps paid routes out of playground selectors even when paid BYOK is enabled", () => {
    const credentials = new Map([
      ["gemini", { verified: true, models: ["gemini-3.6-flash"] }],
      ["groq", { verified: true, models: ["openai/gpt-oss-120b"] }],
      ["openrouter", { verified: true, models: ["google/gemma-4-26b-a4b-it:free"] }],
      ["huggingface", { verified: true, models: ["openai/gpt-oss-120b"] }],
      ["openai", { verified: true, models: ["gpt-6-luna"] }],
    ]);
    const models = evaluateRegistryModels(credentials, true);
    const text = selectPlaygroundModels(models, "text");
    const image = selectPlaygroundModels(models, "image");

    expect(text[0]?.ref).toBe("pollinations::openai-fast");
    expect(text.map((model) => model.ref)).not.toContain("huggingface::openai/gpt-oss-120b");
    expect(text.map((model) => model.ref)).not.toContain("openai::gpt-6-luna");
    expect(text.map((model) => model.ref)).not.toContain("pollinations::flux");
    expect(text.find((model) => model.ref === "gemini::gemini-3.6-flash")?.playgroundLabel).toBe(
      "LIMITED FREE — Untested",
    );
    expect(
      text.find((model) => model.ref === "openrouter::google/gemma-4-26b-a4b-it:free")
        ?.playgroundLabel,
    ).toBe("LIMITED FREE — Untested");

    expect(image.map((model) => model.ref)).toEqual(["pollinations::flux"]);
    expect(image[0]?.playgroundLabel).toBe("LIMITED FREE — Tested");
  });

  it("keeps pricing-unverified routes out of the playground selector", () => {
    const allowed = {
      ref: "pollinations::pricing-verified-test",
      providerId: "pollinations",
      modelId: "pricing-verified-test",
      name: "Pricing verified test model",
      description: "Test fixture",
      capabilities: ["text" as const],
      accessType: "free" as const,
      paid: false,
      verification: { state: "verified" as const, method: "Test fixture" },
      limitations: [],
      parameters: ["temperature"],
      streaming: true,
      pricing: {
        status: "verified-free" as const,
        detail: "Test fixture",
        checkedAt: "2026-10-26",
        sourceUrl: "https://example.test",
      },
      freeTier: {
        eligibility: "eligible" as const,
        detail: "Test fixture",
        sourceUrl: "https://example.test",
      },
    };
    const unverified = {
      ...allowed,
      ref: "pollinations::pricing-unverified-test",
      modelId: "pricing-unverified-test",
      name: "Pricing unverified test model",
      accessType: "byok" as const,
      pricing: {
        status: "unverified" as const,
        detail: "Test fixture",
        checkedAt: "2026-10-26",
        sourceUrl: "https://example.test",
      },
      freeTier: {
        eligibility: "unverified" as const,
        detail: "Test fixture",
        sourceUrl: "https://example.test",
      },
    };
    const models = evaluateRegistryModels(new Map(), false, [allowed, unverified]);
    const text = selectPlaygroundModels(models, "text");
    expect(text.map((model) => model.ref)).toContain("pollinations::pricing-verified-test");
    expect(text.map((model) => model.ref)).not.toContain(
      "pollinations::pricing-unverified-test",
    );
  });

  it("requires positive verified-free evidence for Gemini and OpenRouter selectors", () => {
    const basePricing = {
      detail: "Test fixture",
      checkedAt: "2026-10-26",
      sourceUrl: "https://example.test",
    };
    const geminiNoCurrentPrice: ModelDefinition = {
      ref: "gemini::gemini-no-current-price-test",
      providerId: "gemini",
      modelId: "gemini-no-current-price-test",
      name: "Gemini no-current-price fixture",
      description: "Test fixture",
      capabilities: ["text"],
      accessType: "limited-free",
      paid: false,
      verification: { state: "verified", method: "Test fixture" },
      limitations: [],
      parameters: ["temperature"],
      streaming: true,
      pricing: { status: "not-applicable", ...basePricing },
      freeTier: { eligibility: "not-applicable", ...basePricing },
    };
    const openRouterNoFreeAllowance: ModelDefinition = {
      ref: "openrouter::fixture/model:free",
      providerId: "openrouter",
      modelId: "fixture/model:free",
      name: "OpenRouter no-free-allowance fixture",
      description: "Test fixture",
      capabilities: ["text"],
      accessType: "limited-free",
      paid: false,
      verification: { state: "verified", method: "Test fixture" },
      limitations: [],
      parameters: ["temperature"],
      streaming: true,
      pricing: { status: "verified-free", ...basePricing },
      freeTier: { eligibility: "not-eligible", ...basePricing },
    };
    const eligibleOpenRouter: ModelDefinition = {
      ...openRouterNoFreeAllowance,
      ref: "openrouter::fixture/eligible:free",
      modelId: "fixture/eligible:free",
      name: "OpenRouter eligible fixture",
      freeTier: { eligibility: "limited", ...basePricing },
    };
    const credentials = new Map([
      [
        "gemini",
        {
          verified: true,
          models: ["gemini-3.6-flash", geminiNoCurrentPrice.modelId],
        },
      ],
      [
        "openrouter",
        {
          verified: true,
          models: [
            "google/gemma-4-26b-a4b-it:free",
            openRouterNoFreeAllowance.modelId,
            eligibleOpenRouter.modelId,
          ],
        },
      ],
    ]);
    const models = evaluateRegistryModels(credentials, false, [
      geminiNoCurrentPrice,
      openRouterNoFreeAllowance,
      eligibleOpenRouter,
    ]);
    const text = selectPlaygroundModels(models, "text");
    const refs = text.map((model) => model.ref);

    expect(refs).not.toContain(geminiNoCurrentPrice.ref);
    expect(refs).not.toContain(openRouterNoFreeAllowance.ref);
    expect(refs).toContain(eligibleOpenRouter.ref);
    expect(
      hasVerifiedFreeSelectorAccess(
        models.find((model) => model.ref === openRouterNoFreeAllowance.ref)!,
      ),
    ).toBe(false);
    expect(
      text.find((model) => model.ref === eligibleOpenRouter.ref)?.playgroundLabel,
    ).toBe("LIMITED FREE — Untested");
  });

  it("recognizes only exact zero-priced OpenRouter :free variants", () => {
    expect(
      isOpenRouterFreeVariant({
        id: "vendor/model:free",
        pricing: { prompt: "0", completion: "0.0" },
      }),
    ).toBe(true);
    expect(
      isOpenRouterFreeVariant({
        id: "vendor/model:free",
        pricing: { prompt: "0", completion: "0", request: "0" },
      }),
    ).toBe(true);
    expect(
      isOpenRouterFreeVariant({
        id: "vendor/model",
        pricing: { prompt: "0", completion: "0" },
      }),
    ).toBe(false);
    expect(
      isOpenRouterFreeVariant({
        id: "vendor/model:free",
        pricing: { prompt: "0.000001", completion: "0" },
      }),
    ).toBe(false);
    expect(
      isOpenRouterFreeVariant({
        id: "vendor/model:free",
        pricing: { prompt: "0", completion: "0", request: "0.01" },
      }),
    ).toBe(false);
  });

  it("uses one simple access label with safe precedence", () => {
    const models = evaluateRegistryModels(new Map(), true);
    const paid = models.find((model) => model.ref === "openai::gpt-6-luna");
    const limited = models.find((model) => model.ref === "pollinations::openai-fast");
    expect(paid && simpleAccessLabel(paid)).toBe("PAID");
    expect(limited && simpleAccessLabel(limited)).toBe("LIMITED FREE — Untested");
    expect(
      limited && simpleAccessLabel(limited, limited.accessEvidence === "inference_tested"),
    ).toBe("LIMITED FREE — Tested");
    expect(
      simpleAccessLabel({
        accessType: "byok",
        paid: false,
        pricing: { status: "unverified" },
        freeTier: { eligibility: "unverified" },
      }),
    ).toBe("USER KEY REQUIRED");
    expect(
      simpleAccessLabel({
        accessType: "local",
        paid: false,
        pricing: { status: "local-no-fee" },
        freeTier: { eligibility: "not-applicable" },
      }),
    ).toBe("FREE — Untested");
    expect(
      simpleAccessLabel(
        {
          accessType: "local",
          paid: false,
          pricing: { status: "local-no-fee" },
          freeTier: { eligibility: "not-applicable" },
        },
        true,
      ),
    ).toBe("FREE — Tested");
    expect(
      simpleAccessLabel({
        accessType: "limited-free",
        paid: false,
        pricing: { status: "verified-free" },
        freeTier: { eligibility: "not-eligible" },
      }),
    ).toBe("UNAVAILABLE");
  });

  it("unlocks a keyed model only when the key confirmed that exact model ID", () => {
    const credentials = new Map([
      ["gemini", { verified: true, models: ["gemini-3.6-flash", "other-model"] }],
    ]);
    const models = evaluateRegistryModels(credentials, false);
    const gemini = models.find((model) => model.ref === "gemini::gemini-3.6-flash");
    expect(gemini?.status).toBe("untested");
    expect(gemini?.statusLabel).toBe("Key verified · untested");
    expect(gemini?.accessEvidence).toBe("key_verified");
    expect(models.find((model) => model.ref === "groq::openai/gpt-oss-120b")?.status).toBe(
      "requires_key",
    );
  });

  it("only marks a keyed model available after a recorded successful inference test", () => {
    const credentials = new Map([
      ["gemini", { verified: true, models: ["gemini-3.6-flash"] }],
    ]);
    const tested = evaluateRegistryModels(credentials, false, [], new Map([
      ["gemini::gemini-3.6-flash", {
        status: "success" as const,
        errorCode: null,
        errorMessage: null,
        latencyMs: 42,
        testedAt: Date.now(),
      }],
    ]));
    const model = tested.find((entry) => entry.ref === "gemini::gemini-3.6-flash");
    expect(model?.status).toBe("available");
    expect(model?.accessEvidence).toBe("inference_tested");
    expect(model?.inferenceTestLatencyMs).toBe(42);
  });

  it("does not enable a keyed model when the key lacks that model ID", () => {
    const credentials = new Map([["gemini", { verified: true, models: ["different-model"] }]]);
    const model = evaluateRegistryModels(credentials, false).find(
      (entry) => entry.ref === "gemini::gemini-3.6-flash",
    );
    expect(model?.status).toBe("requires_key");
    expect(model?.statusDetail).toMatch(/was not returned by the provider/i);
  });

  it("keeps paid models disabled unless the operator opts in", () => {
    const credentials = new Map([["openai", { verified: true, models: ["gpt-6-luna"] }]]);
    const disabled = evaluateRegistryModels(credentials, false).find(
      (model) => model.ref === "openai::gpt-6-luna",
    );
    expect(disabled?.status).toBe("disabled_paid");

    const enabled = evaluateRegistryModels(credentials, true).find(
      (model) => model.ref === "openai::gpt-6-luna",
    );
    expect(enabled?.status).toBe("untested");
  });

  it("reports a saved but unverified key without enabling models", () => {
    const credentials = new Map([["groq", { verified: false, models: ["openai/gpt-oss-120b"] }]]);
    const model = evaluateRegistryModels(credentials, false).find(
      (entry) => entry.ref === "groq::openai/gpt-oss-120b",
    );
    expect(model?.status).toBe("requires_key");
    expect(model?.statusDetail).toMatch(/failed verification/i);
  });

  it("keeps pricing, free-tier eligibility, user access, and inference separate", () => {
    expect(PRICING_LABELS.unverified).toBe("PRICING UNVERIFIED");

    const models = evaluateRegistryModels(new Map(), false);
    const gemini = models.find((entry) => entry.ref === "gemini::gemini-3.6-flash");
    expect(gemini).toMatchObject({
      pricing: { status: "verified-free" },
      freeTier: { eligibility: "limited" },
      userAccess: { state: "key-required" },
      inference: { state: "untested" },
      contextWindow: 1048576,
      inputTokenLimit: 1048576,
      outputTokenLimit: 65536,
      releaseStage: "stable",
      canOpen: false,
      canTest: false,
    });

    const paid = models.find((entry) => entry.ref === "openai::gpt-6-luna");
    expect(paid).toMatchObject({
      status: "disabled_paid",
      pricing: { status: "verified-paid" },
      freeTier: { eligibility: "not-eligible" },
      userAccess: { state: "payment-restricted" },
      inference: { state: "payment-required" },
      canOpen: false,
      canTest: false,
    });
  });

  it("records verified Gemini lifecycle and replacement metadata", () => {
    expect(geminiModelPolicy("gemini-3.6-flash")).toMatchObject({
      releaseStage: "stable",
      contextWindow: 1048576,
      outputTokenLimit: 65536,
    });
    // The official Gemini model page does not list a 3.7 Flash model. Do not
    // invent one; a future discovered ID must remain dynamically evaluated.
    expect(geminiModelPolicy("gemini-3.7-flash")).toBeUndefined();
    expect(geminiModelPolicy("gemini-3.8-flash-tts")).toBeUndefined();
    expect(geminiModelPolicy("gemini-2.5-flash")?.releaseStage).toBe("stable");
    expect(geminiModelPolicy("gemini-2.5-flash")?.userAccessNote).toMatch(/actively used/i);
    expect(geminiModelPolicy("gemini-2.5-flash")?.replacement).toMatchObject({
      modelId: "gemini-3.8-flash",
    });
    expect(geminiModelPolicy("gemini-2.5-computer-use-preview-10-2025")).toMatchObject({
      releaseStage: "deprecated",
      shutdownDate: "2026-07-28",
      replacement: { modelId: "gemini-3.8-flash" },
    });
    expect(geminiModelPolicy("deep-research-preview-04-2026")).toMatchObject({
      releaseStage: "preview",
      pricing: { status: "unverified" },
      contextWindow: 1048576,
      outputTokenLimit: 65536,
    });
    expect(geminiModelPolicy("antigravity-preview-09-2026")?.userAccessNote).toMatch(
      /135K/,
    );
    expect(geminiModelPolicy("deep-research-pro-preview-12-2025")).toMatchObject({
      releaseStage: "deprecated",
      shutdownDate: "2026-10-23",
      replacement: { modelId: "deep-research-preview-04-2026" },
    });
  });

  it("classifies recorded inference failures and keeps retryable actions available", () => {
    const credentials = new Map([
      ["groq", { verified: true, models: ["openai/gpt-oss-120b"] }],
    ]);

    function evaluatedWithFailure(code: string, message: string) {
      const tests = new Map<string, ModelInferenceTest>([
        [
          "groq::openai/gpt-oss-120b",
          {
            status: "error",
            errorCode: code,
            errorMessage: message,
            latencyMs: 10,
            testedAt: Date.now(),
          },
        ],
      ]);
      return evaluateRegistryModels(credentials, false, [], tests).find(
        (entry) => entry.ref === "groq::openai/gpt-oss-120b",
      );
    }

    expect(evaluatedWithFailure("provider_payment_required", "Upgrade required")).toMatchObject({
      status: "payment_required",
      inference: { state: "payment-required" },
      userAccess: { state: "payment-restricted" },
      availability: { state: "payment-required" },
      canTest: true,
      canOpen: false,
    });
    expect(evaluatedWithFailure("provider_rate_limit", "Slow down")).toMatchObject({
      status: "rate_limited",
      inference: { state: "rate-limited" },
      availability: { state: "rate-limited" },
      canTest: true,
    });
    expect(evaluatedWithFailure("provider_quota", "Daily quota exhausted")).toMatchObject({
      status: "quota_exhausted",
      inference: { state: "quota-exhausted" },
      availability: { state: "rate-limited" },
    });
    expect(evaluatedWithFailure("provider_timeout", "Timed out")).toMatchObject({
      status: "temporary_failure",
      inference: { state: "temporary-failure" },
      availability: { state: "temporarily-unavailable" },
      canTest: true,
    });
    expect(evaluatedWithFailure("provider_auth", "Bad key")).toMatchObject({
      status: "auth_failed",
      inference: { state: "auth-failure" },
      userAccess: { state: "key-invalid" },
      availability: { state: "invalid-key" },
      canTest: false,
    });
    expect(
      evaluatedWithFailure(
        "provider_model_unavailable",
        "models/gemini-2.5-flash is no longer available to new users",
      ),
    ).toMatchObject({
      status: "model_unavailable",
      statusLabel: "Model not available to account",
      inference: { state: "model-unavailable" },
      userAccess: { state: "account-limited" },
      availability: { state: "unavailable" },
      canTest: true,
      canOpen: false,
    });
  });

  it("keeps deprecated and unsupported models visible with disabled actions", () => {
    const deprecated: ModelDefinition = {
      ref: "gemini::gemini-2.5-computer-use-preview-10-2025",
      providerId: "gemini",
      modelId: "gemini-2.5-computer-use-preview-10-2025",
      name: "Computer Use Preview",
      description: "Deprecated test model.",
      capabilities: ["other"],
      accessType: "unavailable",
      paid: false,
      releaseStage: "deprecated",
      shutdownDate: "2026-07-28",
      replacement: {
        modelId: "gemini-3.6-flash",
        note: "Never selected automatically.",
        docsUrl: "https://ai.google.dev/gemini-api/docs/deprecations",
      },
      unavailableReason: "Shut down by the provider.",
      verification: {
        state: "unavailable",
        method: "test",
        checkedAt: "2026-10-25",
        evidence: "test",
        docsUrl: "https://ai.google.dev/gemini-api/docs/deprecations",
      },
      limitations: [],
      parameters: [],
      streaming: false,
    };

    const models = evaluateRegistryModels(new Map(), false, [deprecated]);
    expect(models.find((entry) => entry.ref === deprecated.ref)).toMatchObject({
      status: "deprecated",
      canOpen: false,
      canTest: false,
      userAccess: { state: "unavailable" },
      inference: { state: "deprecated" },
      replacement: { modelId: "gemini-3.6-flash" },
    });
    expect(models.find((entry) => entry.ref === "pollinations::sana")).toMatchObject({
      status: "unsupported",
      statusLabel: "Unsupported for this playground",
      availability: { state: "unavailable" },
      canOpen: false,
      canTest: false,
    });
    expect(INFERENCE_LABELS.unsupported).toBe("UNSUPPORTED FOR THIS PLAYGROUND");
  });
});
