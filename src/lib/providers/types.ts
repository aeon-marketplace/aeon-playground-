export type AccessType = "free" | "limited-free" | "local" | "byok" | "unavailable";

/**
 * These dimensions are deliberately separate:
 * - pricing: what the provider publishes for this model
 * - free tier: whether a free allowance is published and usable
 * - user access: whether this session/key/account can reach the model
 * - inference: whether a real request for this exact model has succeeded
 *
 * None of them proves the others.
 */
export type PricingStatus =
  | "verified-free"
  | "verified-paid"
  | "local-no-fee"
  | "unverified"
  | "not-applicable";

export type FreeTierEligibility =
  | "eligible"
  | "limited"
  | "not-eligible"
  | "unverified"
  | "not-applicable";

export type AvailabilityState =
  | "available"
  | "temporarily-unavailable"
  | "rate-limited"
  | "invalid-key"
  | "payment-required"
  | "deprecated"
  | "unavailable"
  | "not-verified"
  | "not-applicable";

export type UserAccessState =
  | "ready"
  | "key-required"
  | "key-invalid"
  | "account-limited"
  | "payment-restricted"
  | "not-public"
  | "offline"
  | "not-applicable"
  | "unavailable"
  | "unknown";

export type InferenceAvailability =
  | "tested"
  | "verified-recorded"
  | "untested"
  | "temporary-failure"
  | "auth-failure"
  | "rate-limited"
  | "quota-exhausted"
  | "payment-required"
  | "request-failed"
  | "model-unavailable"
  | "config-error"
  | "unsupported"
  | "deprecated"
  | "offline"
  | "not-public"
  | "unknown";

export type ModelPricingMetadata = {
  status: PricingStatus;
  detail: string;
  checkedAt?: string;
  sourceUrl?: string;
};

export type ModelFreeTierMetadata = {
  eligibility: FreeTierEligibility;
  detail: string;
  sourceUrl?: string;
};

export type ModelReplacement = {
  modelId: string;
  note: string;
  docsUrl?: string;
};

export type ModelCapability =
  | "text"
  | "vision-input"
  | "image"
  | "audio-input"
  | "audio-output"
  | "transcription"
  | "embeddings"
  | "safety"
  | "video"
  | "other";

/**
 * Verification is layered. A provider key or a model listing does not prove
 * that a specific model can be invoked successfully.
 */
export type VerificationState =
  | "verified"
  | "requires_key"
  | "unverified"
  | "discovered"
  | "key_verified"
  | "model_accessible"
  | "inference_tested"
  | "unavailable";

export type ModelReleaseStage =
  | "stable"
  | "preview"
  | "latest-alias"
  | "experimental"
  | "deprecated";

export type ModelInferenceTest = {
  status: "success" | "error";
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  testedAt: number;
};

export type AdapterKind = "pollinations" | "openai-compatible" | "gemini" | "ollama";

export type ProviderIcon =
  | "pollinations"
  | "gemini"
  | "groq"
  | "openrouter"
  | "huggingface"
  | "cloudflare"
  | "openai"
  | "ollama"
  | "custom";

export type ProviderDefinition = {
  id: string;
  name: string;
  description: string;
  adapter: AdapterKind;
  baseUrl: string;
  websiteUrl: string;
  docsUrl: string;
  keyUrl?: string;
  icon: ProviderIcon;
  requiresKey: boolean;
  paid: boolean;
  accessLabel: string;
  accessTypes: AccessType[];
  modalities: ModelCapability[];
  streaming: boolean;
  freeTierSummary: string;
  rateLimitNote: string;
  setupSteps: string[];
  envVar?: string;
  limitations: string[];
};

export type ModelVerification = {
  state: VerificationState;
  method: string;
  checkedAt?: string;
  evidence?: string;
  docsUrl?: string;
};

export type ModelDefinition = {
  ref: string;
  providerId: string;
  modelId: string;
  name: string;
  description: string;
  capabilities: ModelCapability[];
  accessType: AccessType;
  paid: boolean;
  verification: ModelVerification;
  limitations: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  parameters: string[];
  streaming: boolean;
  rateLimits?: string;
  docsUrl?: string;
  unavailableReason?: string;
  releaseStage?: ModelReleaseStage;
  shutdownDate?: string;
  replacement?: ModelReplacement;
  pricing?: ModelPricingMetadata;
  freeTier?: ModelFreeTierMetadata;
  userAccessNote?: string;
  aliases?: string[];
  image?: {
    defaultWidth: number;
    defaultHeight: number;
    maxWidth: number;
    maxHeight: number;
  };
};

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type TokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type ChatResult = {
  text: string;
  usage: TokenUsage;
  usageAvailable: boolean;
  requestId: string | null;
  providerModelId: string | null;
  finishReason: string | null;
  latencyMs: number;
};

export type ChatInput = {
  modelId: string;
  baseUrl: string;
  providerId?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  appUrl?: string;
  allowLoopback?: boolean;
  signal?: AbortSignal;
};

export type ChatStreamInput = ChatInput & {
  onDelta: (text: string) => void;
};

export type VerificationResult = {
  models: string[];
  checkedAt: number;
};

export type ImageInput = {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  negativePrompt?: string;
  signal?: AbortSignal;
};

export type ImageResult = {
  bytes: Uint8Array;
  contentType: string;
  latencyMs: number;
  finalUrl: string;
};

export type ProviderAdapter = {
  chat(input: ChatInput): Promise<ChatResult>;
  verifyKey(input: {
    apiKey: string;
    baseUrl: string;
    providerId?: string;
    appUrl?: string;
  }): Promise<VerificationResult>;
};
