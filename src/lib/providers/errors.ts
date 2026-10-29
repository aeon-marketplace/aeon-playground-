export type ProviderErrorCode =
  | "auth"
  | "forbidden"
  | "rate_limit"
  | "quota"
  | "payment_required"
  | "model_unavailable"
  | "unsupported_model"
  | "invalid_request"
  | "content_blocked"
  | "timeout"
  | "network"
  | "invalid_response"
  | "server"
  | "config";

const FRIENDLY: Record<ProviderErrorCode, string> = {
  auth: "Authentication failed. Check that the API key is valid and active.",
  forbidden: "The provider denied access to this model or account.",
  rate_limit: "The provider rate limit was reached. Wait and try again.",
  quota: "The provider quota is exhausted. Wait for the quota window to reset or review the account limit.",
  payment_required:
    "The provider requires payment, billing, or an upgraded plan for this request.",
  model_unavailable:
    "The provider does not make this exact model available to the current account. Check the model ID, account access, and lifecycle notice.",
  unsupported_model: "This app does not implement an operation for this model.",
  invalid_request: "The provider rejected the request as invalid.",
  content_blocked: "The provider blocked the response under its safety policy.",
  timeout: "The provider did not respond before the request timed out.",
  network: "Could not reach the provider. Check network access and the endpoint.",
  invalid_response: "The provider returned an unexpected response format.",
  server: "The provider reported a server error. Try again later.",
  config: "This model or provider is not configured for use.",
};

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly provider?: string;
  readonly retryAfterSeconds?: number;
  readonly details?: string;

  constructor(
    code: ProviderErrorCode,
    message?: string,
    extra: {
      status?: number;
      provider?: string;
      retryAfterSeconds?: number;
      details?: string;
    } = {},
  ) {
    super(message ?? FRIENDLY[code]);
    this.name = "ProviderError";
    this.code = code;
    this.status = extra.status;
    this.provider = extra.provider;
    this.retryAfterSeconds = extra.retryAfterSeconds;
    this.details = extra.details;
  }
}

export function redactSecret(text: string, secret?: string): string {
  let result = text;
  if (secret && secret.length >= 6) {
    result = result.split(secret).join("[REDACTED]");
  }
  return result.replace(/\b(sk|gsk|hf|AIza)[-_A-Za-z0-9]{12,}\b/g, "[REDACTED]");
}

function retryAfter(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

export function parseProviderErrorBody(text: string): { message?: string; code?: string } {
  if (!text) return {};
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const error = data.error as Record<string, unknown> | string | undefined;
    if (typeof error === "string") return { message: error };
    if (error && typeof error === "object") {
      return {
        message:
          typeof error.message === "string"
            ? error.message
            : typeof data.message === "string"
              ? data.message
              : undefined,
        code: typeof error.code === "string" ? error.code : undefined,
      };
    }
    if (typeof data.message === "string") return { message: data.message };
    return {};
  } catch {
    return { message: text };
  }
}

export function mapHttpError(
  status: number,
  bodyText: string,
  provider: string,
  apiKey?: string,
  headers?: Headers,
): ProviderError {
  const parsed = parseProviderErrorBody(bodyText);
  const low = `${parsed.code ?? ""} ${parsed.message ?? bodyText}`.toLowerCase();
  const details = redactSecret((parsed.message ?? bodyText).slice(0, 600), apiKey);
  const extra = {
    status,
    provider,
    details: details || undefined,
    retryAfterSeconds: headers ? retryAfter(headers) : undefined,
  };

  if (status === 401) {
    return new ProviderError("auth", undefined, extra);
  }
  if (status === 402) {
    return new ProviderError("payment_required", undefined, extra);
  }
  if (status === 429) {
    if (/quota|daily limit|monthly limit|token limit|requests? per day|rpd/.test(low)) {
      return new ProviderError("quota", undefined, extra);
    }
    if (/billing|payment|insufficient credit|credit balance|upgrade/.test(low)) {
      return new ProviderError("payment_required", undefined, extra);
    }
    return new ProviderError(
      "rate_limit",
      extra.retryAfterSeconds
        ? `The provider rate limit was reached. Retry in about ${extra.retryAfterSeconds}s.`
        : undefined,
      extra,
    );
  }
  if (status === 408 || status === 504) {
    return new ProviderError("timeout", undefined, extra);
  }
  if (status === 404) {
    if (/model|not found|does not exist|not available/.test(low)) {
      return new ProviderError("model_unavailable", undefined, extra);
    }
    return new ProviderError("invalid_request", undefined, extra);
  }
  if (status === 400 || status === 422) {
    if (
      /api[ _-]?key.*(not valid|invalid|expired|revoked|disabled)|invalid.*api[ _-]?key/.test(low)
    ) {
      return new ProviderError("auth", undefined, extra);
    }
    if (/billing|payment|insufficient credit|credit balance|paid plan|upgrade/.test(low)) {
      return new ProviderError("payment_required", undefined, extra);
    }
    if (/quota|exhaust|daily limit|monthly limit|limit reached/.test(low)) {
      return new ProviderError("quota", undefined, extra);
    }
    if (/context length|maximum context|too many tokens|token limit/.test(low)) {
      return new ProviderError(
        "invalid_request",
        "The prompt is longer than the model's context window.",
        extra,
      );
    }
    if (/model.*(not|unsupported|does not exist)|unknown model/.test(low)) {
      return new ProviderError("model_unavailable", undefined, extra);
    }
    if (/safety|blocked|content filter|policy violation/.test(low)) {
      return new ProviderError("content_blocked", undefined, extra);
    }
    return new ProviderError("invalid_request", undefined, extra);
  }
  if (status === 403) {
    if (
      /api[ _-]?key.*(not valid|invalid|expired|revoked|disabled)|invalid.*api[ _-]?key|authentication/.test(
        low,
      )
    ) {
      return new ProviderError("auth", undefined, extra);
    }
    if (/billing|payment|insufficient credit|credit balance|paid plan|upgrade/.test(low)) {
      return new ProviderError("payment_required", undefined, extra);
    }
    if (/quota|exhaust|daily limit|monthly limit|limit reached/.test(low)) {
      return new ProviderError("quota", undefined, extra);
    }
    if (/safety|blocked|content|policy/.test(low)) {
      return new ProviderError("content_blocked", undefined, extra);
    }
    return new ProviderError("forbidden", undefined, extra);
  }
  if (status >= 500) {
    return new ProviderError("server", undefined, extra);
  }
  return new ProviderError("invalid_request", undefined, extra);
}

export function mapNetworkError(error: unknown, provider: string, apiKey?: string): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return new ProviderError("timeout", undefined, { provider });
    }
    const message = redactSecret(error.message, apiKey);
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network|socket/i.test(message)) {
      return new ProviderError("network", undefined, { provider, details: message });
    }
    return new ProviderError("network", undefined, { provider, details: message });
  }
  return new ProviderError("network", undefined, { provider });
}
