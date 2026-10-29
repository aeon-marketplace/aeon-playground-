import type {
  AccessType,
  ModelDefinition,
  ModelFreeTierMetadata,
  ModelPricingMetadata,
  ProviderDefinition,
} from "@/lib/providers/types";

export const ACCESS_LABELS: Record<AccessType, string> = {
  free: "FREE TIER",
  "limited-free": "LIMITED FREE",
  local: "LOCAL — NO HOSTED API FEE",
  byok: "BYOK / PROVIDER KEY",
  unavailable: "UNAVAILABLE",
};

export function accessLabel(accessType: AccessType): string {
  return ACCESS_LABELS[accessType];
}

export function accessDescription(accessType: AccessType): string {
  switch (accessType) {
    case "free":
      return "The provider currently offers a free allowance for this model and the configured account is eligible.";
    case "limited-free":
      return "Free use exists, but a quota, rate limit, credit allowance, or daily cap applies.";
    case "local":
      return "Runs on your own computer. No provider API fee; hardware, electricity, and storage costs still apply.";
    case "byok":
      return "Requires your provider key. Pricing and free-tier eligibility are shown separately and are not inferred from the access route.";
    case "unavailable":
      return "This model or endpoint cannot currently be used with the configured access route.";
  }
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "pollinations",
    name: "Pollinations",
    description:
      "Keyless, OpenAI-compatible text and image generation on a shared anonymous tier. This is the demo provider that works without an account.",
    adapter: "pollinations",
    baseUrl: "https://text.pollinations.ai/openai",
    websiteUrl: "https://pollinations.ai",
    docsUrl: "https://pollinations.ai",
    icon: "pollinations",
    requiresKey: false,
    paid: false,
    accessLabel: "Limited free · no key",
    accessTypes: ["limited-free"],
    modalities: ["text", "image"],
    streaming: true,
    freeTierSummary:
      "Anonymous free tier. No API key or account is required. At verification time the text endpoint allowed 1 reply every 30 seconds per IP; capacity is shared and not guaranteed.",
    rateLimitNote: "Observed text limit: 1 reply every 30 seconds per IP. Image requests have separate limits.",
    setupSteps: [
      "No key or account is required.",
      "Select a Pollinations model in a playground and run it directly.",
      "Expect slower responses and possible rate limiting on the shared tier.",
    ],
    limitations: [
      "Shared anonymous rate limits; requests can be slow or rejected when busy.",
      "Observed text limit: 1 reply every 30 seconds per IP. Image requests have separate limits.",
      "No uptime or data-processing guarantee. Do not send confidential information.",
      "Only the model IDs listed as verified are offered here; no automatic fallback.",
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description:
      "Gemini Developer API. Supports a free tier for eligible models, with quota limits and data-use terms that differ from the paid tier.",
    adapter: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    websiteUrl: "https://ai.google.dev",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    keyUrl: "https://aistudio.google.com/apikey",
    icon: "gemini",
    requiresKey: true,
    paid: false,
    accessLabel: "Limited free · BYOK",
    accessTypes: ["limited-free"],
    modalities: ["text"],
    streaming: true,
    freeTierSummary:
      "Free-tier input/output tokens for eligible models, subject to Google's rate limits and regional availability.",
    rateLimitNote: "Free-tier rate limits vary by model and account. Google publishes RPM/TPM/RPD limits per model.",
    setupSteps: [
      "Create a key in Google AI Studio.",
      "Save it on the API Keys page; the app calls ListModels to verify it.",
      "Models only become selectable if your key returns their exact model ID with generateContent support.",
    ],
    limitations: [
      "Requires your own Google AI Studio API key.",
      "Free-tier rate limits vary by model and account.",
      "Google states that free-tier content may be used to improve its products.",
      "Only models returned by your key's ListModels call are enabled.",
    ],
  },
  {
    id: "groq",
    name: "Groq",
    description:
      "OpenAI-compatible inference on GroqCloud. The Free plan has documented daily and per-minute limits.",
    adapter: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    websiteUrl: "https://groq.com",
    docsUrl: "https://console.groq.com/docs/models",
    keyUrl: "https://console.groq.com/keys",
    icon: "groq",
    requiresKey: true,
    paid: false,
    accessLabel: "Limited free · BYOK",
    accessTypes: ["limited-free"],
    modalities: ["text"],
    streaming: true,
    freeTierSummary:
      "Groq Free plan: for GPT-OSS models, 30 requests/min, 1,000 requests/day, 8K tokens/min, 200K tokens/day (published Oct 2026; exact limits can change).",
    rateLimitNote: "Free-plan RPM/RPD/TPM/TPD limits apply per organization and can change.",
    setupSteps: [
      "Create a GroqCloud API key.",
      "Save it on the API Keys page; the app verifies it against /openai/v1/models.",
      "Select a model only if your key's model list includes it.",
    ],
    limitations: [
      "Requires your own Groq API key.",
      "Free-plan limits apply per organization and can change.",
      "The model must appear in your key's /models response before it is enabled.",
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description:
      "Unified API with explicitly zero-priced model variants. Free variants still require an account API key and have request caps.",
    adapter: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    websiteUrl: "https://openrouter.ai",
    docsUrl: "https://openrouter.ai/docs",
    keyUrl: "https://openrouter.ai/settings/keys",
    icon: "openrouter",
    requiresKey: true,
    paid: false,
    accessLabel: "Limited free · BYOK",
    accessTypes: ["limited-free"],
    modalities: ["text"],
    streaming: true,
    freeTierSummary:
      "Models with IDs ending in :free cost $0. Accounts with under 10 purchased credits are limited to 20 requests/min and 50 requests/day.",
    rateLimitNote: "Free-model caps: 20 requests/min and 50 requests/day under 10 purchased credits.",
    setupSteps: [
      "Create an OpenRouter API key.",
      "Save it on the API Keys page; the app checks /key and /models.",
      "Only explicit :free variants are offered; a paid model is never used as a fallback.",
    ],
    limitations: [
      "Requires your own OpenRouter API key.",
      "Only explicitly :free variants are listed here; paid models are never used automatically.",
      "Free-model caps apply even when a model's listed token price is zero.",
      "The provider may route among upstreams for the same model, but never to a different model.",
    ],
  },
  {
    id: "huggingface",
    name: "Hugging Face Inference Providers",
    description:
      "Routed inference across many providers through an OpenAI-compatible endpoint. This is not a no-cost free tier.",
    adapter: "openai-compatible",
    baseUrl: "https://router.huggingface.co/v1",
    websiteUrl: "https://huggingface.co",
    docsUrl: "https://huggingface.co/docs/inference-providers",
    keyUrl: "https://huggingface.co/settings/tokens",
    icon: "huggingface",
    requiresKey: true,
    paid: true,
    accessLabel: "BYOK · paid / PRO credits",
    accessTypes: ["byok"],
    modalities: ["text"],
    streaming: true,
    freeTierSummary:
      "Pay-as-you-go; PRO and Team plans include monthly inference credits. A free account generally needs credits or a PRO plan.",
    rateLimitNote: "Credit-based. Remaining quota is only shown when the provider exposes it.",
    setupSteps: [
      "Create a fine-grained Hugging Face token with inference permission.",
      "Enable paid BYOK on the server (ALLOW_PAID_BYOK=true) if you accept possible charges.",
      "Save and verify the token on the API Keys page.",
    ],
    limitations: [
      "Requires a fine-grained Hugging Face token with inference permission.",
      "Usage may consume paid credits; this app never calls it automatically.",
      "Model availability and pricing depend on the routed upstream provider.",
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    description:
      "Serverless inference on Cloudflare's global network. The Workers Free plan includes a daily Neuron allowance; usage beyond it is billed. This app uses the account-scoped OpenAI-compatible endpoint.",
    adapter: "openai-compatible",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts",
    websiteUrl: "https://developers.cloudflare.com/workers-ai/",
    docsUrl: "https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/",
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    icon: "cloudflare",
    requiresKey: true,
    paid: false,
    accessLabel: "Limited free · BYOK",
    accessTypes: ["limited-free"],
    modalities: ["text"],
    streaming: false,
    freeTierSummary:
      "Workers AI includes 10,000 Neurons per day on both the Workers Free plan and the Workers Paid plan; usage beyond the daily allocation is billed on paid plans. Model availability and per-model Neuron rates vary.",
    rateLimitNote:
      "The daily Neuron allocation and account-level rate limits apply. Exact limits depend on your Cloudflare plan.",
    setupSteps: [
      "In the Cloudflare dashboard, copy your 32-character account ID.",
      "Create an API token with the Workers AI permission.",
      "Save it as `<account_id>:<api_token>` on the API Keys page. A bare token also works if the operator sets CLOUDFLARE_ACCOUNT_ID.",
      "Press Verify to list the text-generation models available to that account.",
    ],
    envVar: "CLOUDFLARE_ACCOUNT_ID",
    limitations: [
      "Requires a Cloudflare account ID and an API token with Workers AI access.",
      "The free daily Neuron allowance is shared across all Workers AI usage on the account.",
      "Only text-generation models returned by your account are enabled; image and embedding models are not offered here.",
      "No automatic fallback to another model or provider.",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    description:
      "Paid, bring-your-own-key access through the OpenAI-compatible adapter. OpenAI has no free tier in this app.",
    adapter: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    websiteUrl: "https://openai.com",
    docsUrl: "https://platform.openai.com/docs",
    keyUrl: "https://platform.openai.com/api-keys",
    icon: "openai",
    requiresKey: true,
    paid: true,
    accessLabel: "BYOK · paid only",
    accessTypes: ["byok"],
    modalities: ["text"],
    streaming: true,
    freeTierSummary:
      "No free tier. Disabled unless the operator sets ALLOW_PAID_BYOK=true and you verify your own key.",
    rateLimitNote: "Usage is billed to your account. Rate limits depend on your usage tier.",
    setupSteps: [
      "Create an OpenAI API key with billing enabled.",
      "The operator must set ALLOW_PAID_BYOK=true; otherwise every OpenAI model stays disabled.",
      "Save and verify the key on the API Keys page. Nothing runs automatically.",
    ],
    limitations: [
      "Paid only. No free quota is provided by this app.",
      "Disabled by default; paid access requires the operator to opt in.",
      "Requires your own OpenAI API key and available billing.",
    ],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    description:
      "Local inference on your own machine through the Ollama daemon. Models are discovered from the models you actually installed.",
    adapter: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    websiteUrl: "https://ollama.com",
    docsUrl: "https://ollama.com/",
    icon: "ollama",
    requiresKey: false,
    paid: false,
    accessLabel: "Local · no hosted API fee",
    accessTypes: ["local"],
    modalities: ["text"],
    streaming: true,
    freeTierSummary:
      "No provider API fee. The model runs on your hardware; electricity, storage, and hardware costs still apply.",
    rateLimitNote: "No provider quota. Throughput depends on your CPU/GPU and the selected model.",
    setupSteps: [
      "Install Ollama from https://ollama.com/download.",
      "Start it (the installer normally runs `ollama serve` automatically).",
      "Pull a model, for example `ollama pull llama3.2`.",
      "Set OLLAMA_BASE_URL if the daemon is not at http://127.0.0.1:11434.",
      "Reopen the Model Catalog or Providers page to refresh installed models.",
    ],
    envVar: "OLLAMA_BASE_URL",
    limitations: [
      "Only models actually installed in Ollama appear in the catalog.",
      "The app shows an offline state when the daemon cannot be reached.",
      "Hardware, electricity, and storage costs still apply.",
      "No cloud fallback: if Ollama is offline, local models are not runnable.",
    ],
  },
];

const pollinations = PROVIDERS[0]!;

const TEXT_PARAMS = ["temperature", "max_tokens"];

const POLLINATIONS_PRICING: ModelPricingMetadata = {
  status: "verified-free",
  detail:
    "Pollinations currently offers anonymous text and Classic image generation without an API fee. Shared capacity and rate limits are not guaranteed.",
  checkedAt: "2026-10-25",
  sourceUrl: "https://pollinations.ai",
};

const POLLINATIONS_FREE_TIER: ModelFreeTierMetadata = {
  eligibility: "limited",
  detail:
    "Anonymous shared access is free, but text is observed at one reply per 30 seconds per IP and images are limited to one at a time. Availability can change.",
  sourceUrl: "https://github.com/pollinations/pollinations/blob/master/APIDOCS.md",
};

const GEMINI_PRICING: ModelPricingMetadata = {
  status: "verified-free",
  detail:
    "Google's current pricing page lists a free tier at no charge for this model, alongside a paid tier. Region, account, and quota conditions still apply.",
  checkedAt: "2026-10-22",
  sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
};

const GEMINI_FREE_TIER: ModelFreeTierMetadata = {
  eligibility: "limited",
  detail:
    "A free tier is published, but free-tier rate limits, regional availability, account eligibility, and Google's data-use terms apply. This is not a guarantee of unlimited free access.",
  sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
};

const OPENROUTER_FREE_PRICING: ModelPricingMetadata = {
  status: "verified-free",
  detail:
    "OpenRouter's public model metadata lists this exact variant at $0 prompt and completion price. Account credits and free-model request caps still apply.",
  checkedAt: "2026-10-23",
  sourceUrl: "https://openrouter.ai/docs",
};

const OPENROUTER_FREE_TIER: ModelFreeTierMetadata = {
  eligibility: "limited",
  detail:
    "The zero-price listing is free, but accounts under 10 purchased credits are limited to 20 requests/min and 50 requests/day.",
  sourceUrl: "https://openrouter.ai/docs",
};

const CLOUDFLARE_PRICING: ModelPricingMetadata = {
  status: "verified-free",
  detail:
    "Cloudflare includes 10,000 Neurons per day on the Workers Free and Workers Paid plans. Usage beyond the daily allocation is billed on paid plans. Neuron consumption differs per model.",
  checkedAt: "2026-10-26",
  sourceUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
};

const CLOUDFLARE_FREE_TIER: ModelFreeTierMetadata = {
  eligibility: "limited",
  detail:
    "A daily 10,000-Neuron allocation applies to the whole account, not per model. When it is exhausted, requests fail until the allocation resets unless the account has paid usage enabled.",
  sourceUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
};

const PAID_PRICING: ModelPricingMetadata = {
  status: "verified-paid",
  detail:
    "This provider's documented route is paid or credit-based. Actual charges depend on your account and usage.",
  checkedAt: "2026-10-23",
};

const NO_FREE_TIER: ModelFreeTierMetadata = {
  eligibility: "not-eligible",
  detail: "The provider does not publish a free allowance for this model.",
};

const NO_CURRENT_PRICE: ModelPricingMetadata = {
  status: "not-applicable",
  detail:
    "No current price applies because this entry is not callable through the documented API route.",
  checkedAt: "2026-10-25",
};

const NO_FREE_TIER_APPLICABLE: ModelFreeTierMetadata = {
  eligibility: "not-applicable",
  detail: "Free-tier eligibility does not apply to this non-selectable or local entry.",
};

export const MODELS: ModelDefinition[] = [
  {
    ref: "pollinations::openai-fast",
    providerId: pollinations.id,
    modelId: "openai-fast",
    name: "GPT-OSS 20B (Pollinations)",
    description:
      "OpenAI-compatible GPT-OSS 20B reasoning model served on Pollinations' anonymous free tier. Verified with a real completion.",
    capabilities: ["text"],
    accessType: "limited-free",
    paid: false,
    pricing: POLLINATIONS_PRICING,
    freeTier: POLLINATIONS_FREE_TIER,
    verification: {
      state: "verified",
      method: "Live /models listing + live chat completion",
      checkedAt: "2026-10-23",
      evidence:
        "GET /models returned openai-fast at tier=anonymous; POST /openai returned PLAYGROUND_OK with a usage object and provider request ID.",
      docsUrl: "https://pollinations.ai",
    },
    limitations: [
      "Anonymous shared tier; observed text limit of 1 reply per 30 seconds per IP.",
      "Do not send secrets or confidential data.",
      "No automatic fallback if the model is unavailable.",
    ],
    parameters: TEXT_PARAMS,
    streaming: true,
    rateLimits: "Observed: 1 reply / 30 seconds per IP on the anonymous tier.",
    docsUrl: "https://pollinations.ai",
  },
  {
    ref: "pollinations::flux",
    providerId: pollinations.id,
    modelId: "flux",
    name: "Pollinations Classic Image",
    description:
      "Text-to-image generation through Pollinations' anonymous Classic endpoint. The documented service uses one image model and enforces a shared per-IP slot.",
    capabilities: ["image"],
    accessType: "limited-free",
    paid: false,
    pricing: POLLINATIONS_PRICING,
    freeTier: POLLINATIONS_FREE_TIER,
    verification: {
      state: "verified",
      method: "Live image request",
      checkedAt: "2026-10-25",
      evidence:
        "GET /prompt/...?model=flux&width=256&height=256 returned HTTP 200 image/jpeg (10,970 bytes) on 2026-10-25. A concurrent request returned HTTP 402 with Retry-After, which this app reports as a free-slot rate limit.",
      docsUrl: "https://pollinations.ai",
    },
    limitations: [
      "Anonymous Classic tier: one image at a time, at least 45 seconds apart per IP.",
      "Pollinations documents one Classic image model; the model parameter is not part of the current Classic API contract.",
      "Prompt length and dimensions are capped by this app.",
      "No uptime guarantee and no automatic fallback if image generation is unavailable.",
    ],
    parameters: ["width", "height", "seed"],
    streaming: false,
    rateLimits:
      "One anonymous image at a time, at least 45 seconds apart. HTTP 402 includes Retry-After.",
    docsUrl: "https://github.com/pollinations/pollinations/blob/master/APIDOCS.md",
    image: { defaultWidth: 512, defaultHeight: 512, maxWidth: 1024, maxHeight: 1024 },
  },
  {
    ref: "pollinations::sana",
    providerId: pollinations.id,
    modelId: "sana",
    name: "SANA (legacy Pollinations entry)",
    description:
      "Legacy catalog entry for a Pollinations image model name that is not part of the current Classic API contract.",
    capabilities: ["image"],
    accessType: "unavailable",
    paid: false,
    pricing: NO_CURRENT_PRICE,
    freeTier: NO_FREE_TIER_APPLICABLE,
    unavailableReason:
      "Pollinations' current Classic API documents one image model and does not document model=sana. This entry is retained only so old references can be explained; it is not selectable.",
    verification: {
      state: "unavailable",
      method: "Current Pollinations Classic API documentation",
      checkedAt: "2026-10-25",
      evidence:
        "The current Classic API documentation states: one model, one image at a time, at least 45 seconds apart. No model parameter is documented.",
      docsUrl: "https://github.com/pollinations/pollinations/blob/master/APIDOCS.md",
    },
    limitations: [
      "Not part of the documented Classic API; no request is made.",
      "No automatic fallback to the documented image model.",
    ],
    parameters: [],
    streaming: false,
    rateLimits: "Not applicable: entry is not selectable.",
    docsUrl: "https://github.com/pollinations/pollinations/blob/master/APIDOCS.md",
    image: { defaultWidth: 512, defaultHeight: 512, maxWidth: 1024, maxHeight: 1024 },
  },
  {
    ref: "gemini::gemini-3.6-flash",
    providerId: "gemini",
    modelId: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    description:
      "Google's current fast Gemini model. Live generateContent requests succeed for this exact ID; the Gemini API pricing page lists a free tier.",
    capabilities: ["text"],
    accessType: "limited-free",
    paid: false,
    pricing: GEMINI_PRICING,
    freeTier: GEMINI_FREE_TIER,
    verification: {
      state: "requires_key",
      method: "Docs/pricing verified; live generateContent verified, key required",
      checkedAt: "2026-10-29",
      evidence:
        "Live generateContent returned HTTP 200 for this exact ID. Newer 3.8 Flash returned HTTP 503 high demand at the same check, and 2.5 models returned HTTP 404 for new users. Free and paid token pricing are published on Google's pricing page.",
      docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    },
    limitations: [
      "Requires a Gemini API key; unverified until your key's ListModels call includes it.",
      "This app's text playground sends text only.",
      "Free-tier quotas, regional availability, and data-use terms differ from paid.",
      "No automatic fallback to another Gemini model or paid billing.",
    ],
    parameters: TEXT_PARAMS,
    streaming: true,
    rateLimits: "See Google's per-model free-tier RPM/TPM/RPD limits.",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    contextWindow: 1048576,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    maxOutputTokens: 65536,
    releaseStage: "stable",
  },
  {
    ref: "groq::openai/gpt-oss-120b",
    providerId: "groq",
    modelId: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B (Groq)",
    description:
      "OpenAI's open-weight model running on GroqCloud with documented Free-plan limits.",
    capabilities: ["text"],
    accessType: "limited-free",
    paid: false,
    pricing: {
      status: "verified-free",
      detail:
        "Groq publishes a Free plan for GPT-OSS models. The paid Developer plan is also available; your organization's plan and limits decide the actual route.",
      checkedAt: "2026-10-23",
      sourceUrl: "https://console.groq.com/docs/rate-limits",
    },
    freeTier: {
      eligibility: "limited",
      detail:
        "Free-plan limits apply per organization and can change. The model must also appear in your key's model list.",
      sourceUrl: "https://console.groq.com/docs/rate-limits",
    },
    verification: {
      state: "requires_key",
      method: "Docs verified; live verification requires a key",
      checkedAt: "2026-10-23",
      evidence:
        "Listed as a production model in Groq model docs; Free plan limits published on Groq's rate-limit page.",
      docsUrl: "https://console.groq.com/docs/models",
    },
    limitations: [
      "Requires a Groq API key; unverified until your key's /models response includes it.",
      "Free plan limits apply per organization and can change.",
      "No automatic fallback to another Groq model.",
    ],
    parameters: TEXT_PARAMS,
    streaming: true,
    rateLimits: "Free plan: 30 RPM, 1,000 RPD, 8K TPM, 200K TPD (published Oct 2026; can change).",
    docsUrl: "https://console.groq.com/docs/models",
  },
  {
    ref: "openrouter::google/gemma-4-26b-a4b-it:free",
    providerId: "openrouter",
    modelId: "google/gemma-4-26b-a4b-it:free",
    name: "Gemma 4 26B A4B (free)",
    description:
      "OpenRouter's explicitly :free Gemma variant, verified from the public model list as zero-priced.",
    capabilities: ["text"],
    accessType: "limited-free",
    paid: false,
    pricing: OPENROUTER_FREE_PRICING,
    freeTier: OPENROUTER_FREE_TIER,
    verification: {
      state: "requires_key",
      method: "Public /models metadata verified; live chat requires a key",
      checkedAt: "2026-10-23",
      evidence:
        "Present in OpenRouter's public /api/v1/models with prompt and completion prices equal to 0; context length 262,144.",
      docsUrl: "https://openrouter.ai/docs",
    },
    limitations: [
      "Requires an OpenRouter API key; unverified until your key is checked and the model is listed.",
      "Free-model caps: 20 requests/min and 50 requests/day under 10 purchased credits.",
      "Only this :free variant is used; no paid variant or fallback.",
    ],
    parameters: TEXT_PARAMS,
    streaming: true,
    rateLimits: "20 requests/min and 50 requests/day while under 10 purchased credits.",
    docsUrl: "https://openrouter.ai/docs",
    contextWindow: 262144,
  },
  {
    ref: "huggingface::openai/gpt-oss-120b",
    providerId: "huggingface",
    modelId: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B (HF Router)",
    description:
      "Open-weight model available through Hugging Face Inference Providers. Uses your token and may consume paid or PRO-included credits.",
    capabilities: ["text"],
    accessType: "byok",
    paid: true,
    pricing: PAID_PRICING,
    freeTier: NO_FREE_TIER,
    verification: {
      state: "requires_key",
      method: "Docs verified; live verification requires a token",
      checkedAt: "2026-10-23",
      evidence:
        "Model and OpenAI-compatible base URL published in Hugging Face Inference Providers docs.",
      docsUrl: "https://huggingface.co/docs/inference-providers",
    },
    limitations: [
      "Not a free tier: pay-as-you-go, with monthly credits for PRO/Team plans.",
      "Requires an HF token with inference permission.",
      "No automatic fallback across providers or models by this app.",
    ],
    parameters: TEXT_PARAMS,
    streaming: true,
    rateLimits: "Credit-based; no reliable remaining-quota endpoint is exposed here.",
    docsUrl: "https://huggingface.co/docs/inference-providers",
  },
  {
    ref: "cloudflare::@cf/meta/llama-3.1-8b-instruct",
    providerId: "cloudflare",
    modelId: "@cf/meta/llama-3.1-8b-instruct",
    name: "Llama 3.1 8B Instruct (Workers AI)",
    description:
      "Meta's 8B instruction-tuned Llama model served by Cloudflare Workers AI. Uses the account-scoped OpenAI-compatible endpoint.",
    capabilities: ["text"],
    accessType: "limited-free",
    paid: false,
    pricing: CLOUDFLARE_PRICING,
    freeTier: CLOUDFLARE_FREE_TIER,
    verification: {
      state: "requires_key",
      method: "Provider documentation verified; live verification requires an account ID and token",
      checkedAt: "2026-10-26",
      evidence:
        "Model ID is published in Cloudflare's Workers AI model catalog and is callable through the account-scoped OpenAI-compatible /ai/v1/chat/completions route.",
      docsUrl: "https://developers.cloudflare.com/workers-ai/models/",
    },
    limitations: [
      "Requires a Cloudflare account ID and an API token with Workers AI access.",
      "Unverified until your account's model list includes this exact ID.",
      "The account-wide daily Neuron allowance applies; no automatic fallback.",
    ],
    parameters: TEXT_PARAMS,
    streaming: false,
    rateLimits: "Account-wide daily Neuron allocation plus Cloudflare rate limits.",
    docsUrl: "https://developers.cloudflare.com/workers-ai/models/",
  },
  {
    ref: "cloudflare::@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    providerId: "cloudflare",
    modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "Llama 3.3 70B Instruct FP8 Fast (Workers AI)",
    description:
      "Meta's 70B instruction-tuned Llama model in Cloudflare's fast FP8 build. Uses the account-scoped OpenAI-compatible endpoint.",
    capabilities: ["text"],
    accessType: "limited-free",
    paid: false,
    pricing: CLOUDFLARE_PRICING,
    freeTier: CLOUDFLARE_FREE_TIER,
    verification: {
      state: "requires_key",
      method: "Provider documentation verified; live verification requires an account ID and token",
      checkedAt: "2026-10-26",
      evidence:
        "Model ID is published in Cloudflare's Workers AI model catalog and is callable through the account-scoped OpenAI-compatible /ai/v1/chat/completions route.",
      docsUrl: "https://developers.cloudflare.com/workers-ai/models/",
    },
    limitations: [
      "Requires a Cloudflare account ID and an API token with Workers AI access.",
      "Unverified until your account's model list includes this exact ID.",
      "The account-wide daily Neuron allowance applies; no automatic fallback.",
    ],
    parameters: TEXT_PARAMS,
    streaming: false,
    rateLimits: "Account-wide daily Neuron allocation plus Cloudflare rate limits.",
    docsUrl: "https://developers.cloudflare.com/workers-ai/models/",
  },
  {
    ref: "openai::gpt-6-luna",
    providerId: "openai",
    modelId: "gpt-6-luna",
    name: "GPT-6 Luna (OpenAI)",
    description:
      "OpenAI's cost-efficient flagship model. Paid only; available exclusively with your own key when the operator enables paid BYOK.",
    capabilities: ["text"],
    accessType: "byok",
    paid: true,
    pricing: PAID_PRICING,
    freeTier: NO_FREE_TIER,
    verification: {
      state: "requires_key",
      method: "Docs verified; live verification requires a key",
      checkedAt: "2026-10-23",
      evidence:
        "Model ID and context window published in OpenAI's model catalog. Endpoint uses the OpenAI-compatible /v1/chat/completions adapter and must be verified with your key.",
      docsUrl: "https://platform.openai.com/docs/models",
    },
    limitations: [
      "Paid only; disabled unless the operator sets ALLOW_PAID_BYOK=true.",
      "Requires an OpenAI API key with billing enabled.",
      "No free tier and no automatic fallback. Unverified until your key reports this model.",
    ],
    parameters: TEXT_PARAMS,
    streaming: true,
    rateLimits: "Billed usage; rate limits depend on your account usage tier.",
    docsUrl: "https://platform.openai.com/docs/models",
    contextWindow: 1050000,
  },
];

const refSet = new Set(MODELS.map((model) => model.ref));
if (refSet.size !== MODELS.length) {
  throw new Error("Duplicate model ref in registry.");
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

export function getRegistryModel(ref: string): ModelDefinition | undefined {
  return MODELS.find((model) => model.ref === ref);
}

export function modelsForProvider(providerId: string): ModelDefinition[] {
  return MODELS.filter((model) => model.providerId === providerId);
}
