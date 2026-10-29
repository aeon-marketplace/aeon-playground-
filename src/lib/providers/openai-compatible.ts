import { ProviderError, mapNetworkError, redactSecret } from "@/lib/providers/errors";
import {
  assertNoRedirect,
  extractOpenAIReasoning,
  extractOpenAIText,
  joinUrl,
  parseJson,
  parseOpenAIUsage,
  readResponseText,
  throwForHttpError,
} from "@/lib/providers/http";
import type {
  ChatInput,
  ChatResult,
  ProviderAdapter,
  VerificationResult,
} from "@/lib/providers/types";
import { parseSseJson, readSseData } from "@/lib/providers/stream";

type ChatArgs = Omit<ChatInput, "baseUrl"> & {
  baseUrl?: string;
  providerName: string;
  endpoint: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export async function openAICompatibleChat(args: ChatArgs): Promise<ChatResult> {
  const {
    endpoint,
    providerName,
    apiKey,
    modelId,
    messages,
    temperature,
    maxTokens,
    timeoutMs = 60_000,
  } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...args.headers,
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: false,
  };
  if (typeof temperature === "number") body.temperature = temperature;
  if (typeof maxTokens === "number") body.max_tokens = maxTokens;

  const started = performance.now();
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw mapNetworkError(error, providerName, apiKey);
  }
  assertNoRedirect(res, providerName);
  if (!res.ok) await throwForHttpError(res, providerName, apiKey);

  const text = await readResponseText(res);
  const data = parseJson(text, providerName);
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError("invalid_response", "Provider returned no choices.", {
      provider: providerName,
    });
  }
  const first = choices[0] as Record<string, unknown>;
  const message = first.message;
  const content = extractOpenAIText(message) || extractOpenAIReasoning(message);
  const finishReason = typeof first.finish_reason === "string" ? first.finish_reason : null;
  if (!content && finishReason === "content_filter") {
    throw new ProviderError("content_blocked", undefined, { provider: providerName });
  }
  if (!content) {
    throw new ProviderError("invalid_response", "Provider returned an empty message.", {
      provider: providerName,
    });
  }

  const { usage, available } = parseOpenAIUsage(data.usage);
  return {
    text: content,
    usage,
    usageAvailable: available,
    requestId:
      (typeof data.id === "string" ? data.id : null) ??
      res.headers.get("x-request-id") ??
      null,
    providerModelId: typeof data.model === "string" ? data.model : null,
    finishReason,
    latencyMs: Math.round(performance.now() - started),
  };
}

export async function openAICompatibleStream(args: ChatArgs & { onDelta: (text: string) => void; signal?: AbortSignal }): Promise<ChatResult> {
  const {
    endpoint,
    providerName,
    apiKey,
    modelId,
    messages,
    temperature,
    maxTokens,
    timeoutMs = 120_000,
    onDelta,
  } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...args.headers,
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (typeof temperature === "number") body.temperature = temperature;
  if (typeof maxTokens === "number") body.max_tokens = maxTokens;

  const started = performance.now();
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
      signal: args.signal
        ? AbortSignal.any([AbortSignal.timeout(timeoutMs), args.signal])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw mapNetworkError(error, providerName, apiKey);
  }
  assertNoRedirect(res, providerName);
  if (!res.ok) await throwForHttpError(res, providerName, apiKey);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    // Some compatible providers ignore stream=true and return one JSON body.
    const text = await readResponseText(res);
    const data = parseJson(text, providerName);
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = (choices[0] ?? {}) as Record<string, unknown>;
    const content = extractOpenAIText(first.message) || extractOpenAIReasoning(first.message);
    if (!content) {
      throw new ProviderError("invalid_response", "Provider returned an empty message.", {
        provider: providerName,
      });
    }
    onDelta(content);
    const { usage, available } = parseOpenAIUsage(data.usage);
    return {
      text: content,
      usage,
      usageAvailable: available,
      requestId:
        (typeof data.id === "string" ? data.id : null) ?? res.headers.get("x-request-id") ?? null,
      providerModelId: typeof data.model === "string" ? data.model : null,
      finishReason: typeof first.finish_reason === "string" ? first.finish_reason : null,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  let text = "";
  let reasoning = "";
  let finishReason: string | null = null;
  let requestId: string | null = res.headers.get("x-request-id");
  let providerModelId: string | null = null;
  let usage = {
    promptTokens: null as number | null,
    completionTokens: null as number | null,
    totalTokens: null as number | null,
  };
  let usageAvailable = false;

  await readSseData(res, (payload) => {
    const data = parseSseJson(payload, providerName);
    if (typeof data.error === "string") {
      throw new ProviderError("server", redactSecret(data.error.slice(0, 400)), {
        provider: providerName,
      });
    }
    if (typeof data.id === "string" && !requestId) requestId = data.id;
    if (typeof data.model === "string") providerModelId = data.model;
    if (data.usage) {
      const parsed = parseOpenAIUsage(data.usage);
      usage = parsed.usage;
      usageAvailable = parsed.available;
    }
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = (choices[0] ?? {}) as Record<string, unknown>;
    if (typeof first.finish_reason === "string") finishReason = first.finish_reason;
    const piece = extractOpenAIText(first.delta) || extractOpenAIText(first.message);
    if (piece) {
      text += piece;
      onDelta(piece);
    } else {
      reasoning += extractOpenAIReasoning(first.delta) || extractOpenAIReasoning(first.message);
    }
  });

  // Reasoning-only output is real provider content. Surface it once instead of
  // failing with a misleading "empty message" error.
  if (!text.trim() && reasoning.trim()) {
    text = reasoning;
    onDelta(reasoning);
  }

  if (!text.trim()) {
    if (finishReason === "content_filter") {
      throw new ProviderError("content_blocked", undefined, { provider: providerName });
    }
    throw new ProviderError("invalid_response", "Provider returned an empty streamed message.", {
      provider: providerName,
    });
  }
  return {
    text,
    usage,
    usageAvailable,
    requestId,
    providerModelId,
    finishReason,
    latencyMs: Math.round(performance.now() - started),
  };
}

function extractModelIds(data: unknown): string[] {
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : ({} as Record<string, unknown>);
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(record.models)
        ? record.models
        : null;
  if (!raw) {
    throw new ProviderError("invalid_response", "Provider model list has an unexpected shape.");
  }
  const ids = raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const id = (entry as Record<string, unknown>).id;
        const name = (entry as Record<string, unknown>).name;
        return typeof id === "string" ? id : typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((id): id is string => Boolean(id))
    .map((id) => id.replace(/^models\//, ""));
  return Array.from(new Set(ids)).slice(0, 500);
}

export async function verifyOpenAICompatibleKey(input: {
  apiKey: string;
  baseUrl: string;
  providerId?: string;
  appUrl?: string;
}): Promise<VerificationResult> {
  const providerId = input.providerId ?? "openai-compatible";
  const headers: Record<string, string> = {
    authorization: `Bearer ${input.apiKey}`,
    accept: "application/json",
  };
  if (providerId === "openrouter") {
    headers["http-referer"] = input.appUrl ?? "http://localhost:3000";
    headers["x-title"] = "AI Playground";
  }

  if (providerId === "openrouter") {
    let keyRes: Response;
    try {
      keyRes = await fetch(joinUrl(input.baseUrl, "/key"), {
        headers,
        signal: AbortSignal.timeout(30_000),
        redirect: "manual",
      });
    } catch (error) {
      throw mapNetworkError(error, providerId, input.apiKey);
    }
    assertNoRedirect(keyRes, providerId);
    if (!keyRes.ok) await throwForHttpError(keyRes, providerId, input.apiKey);
  }

  let res: Response;
  try {
    res = await fetch(joinUrl(input.baseUrl, "/models"), {
      headers,
      signal: AbortSignal.timeout(30_000),
      redirect: "manual",
    });
  } catch (error) {
    throw mapNetworkError(error, providerId, input.apiKey);
  }
  assertNoRedirect(res, providerId);
  if (!res.ok) await throwForHttpError(res, providerId, input.apiKey);
  const text = await readResponseText(res);
  const data = JSON.parse(text) as unknown;
  return { models: extractModelIds(data), checkedAt: Date.now() };
}

export function createOpenAICompatibleAdapter(providerName: string, baseUrl: string): ProviderAdapter {
  return {
    chat(input) {
      return openAICompatibleChat({
        ...input,
        providerName,
        endpoint: joinUrl(baseUrl, "/chat/completions"),
      });
    },
    verifyKey(input) {
      return verifyOpenAICompatibleKey({
        ...input,
        baseUrl,
        providerId: input.providerId,
      });
    },
  };
}
