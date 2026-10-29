import { ProviderError, mapNetworkError, redactSecret } from "@/lib/providers/errors";
import { readResponseText, throwForHttpError, numberOrNull } from "@/lib/providers/http";
import type {
  ChatInput,
  ChatResult,
  ChatStreamInput,
  TokenUsage,
  VerificationResult,
} from "@/lib/providers/types";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type OllamaModel = {
  id: string;
  name: string;
  sizeBytes: number | null;
  parameterSize: string | null;
  quantization: string | null;
  modifiedAt: string | null;
};

export type OllamaDiscovery = {
  online: boolean;
  baseUrl: string;
  models: OllamaModel[];
  error: string | null;
  checkedAt: number;
};

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, signal]);
  }
  return timeout;
}

function normalizeName(value: string): string {
  return value.replace(/^models\//, "").trim();
}

export async function listOllamaModels(
  baseUrl: string,
  timeoutMs = 2500,
): Promise<OllamaModel[]> {
  const endpoint = `${trimBase(baseUrl)}/api/tags`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: combineSignals(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw mapNetworkError(error, "ollama");
  }
  if (!res.ok) await throwForHttpError(res, "ollama");
  const raw = await readResponseText(res);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderError("invalid_response", "Ollama /api/tags did not return JSON.");
  }
  const models =
    parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).models)
      ? ((parsed as Record<string, unknown>).models as unknown[])
      : [];
  const seen = new Set<string>();
  const result: OllamaModel[] = [];
  for (const entry of models) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const rawName =
      typeof record.name === "string"
        ? record.name
        : typeof record.model === "string"
          ? record.model
          : null;
    if (!rawName) continue;
    const id = normalizeName(rawName);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const details =
      record.details && typeof record.details === "object"
        ? (record.details as Record<string, unknown>)
        : {};
    result.push({
      id,
      name: id,
      sizeBytes: numberOrNull(record.size),
      parameterSize: typeof details.parameter_size === "string" ? details.parameter_size : null,
      quantization: typeof details.quantization_level === "string" ? details.quantization_level : null,
      modifiedAt: typeof record.modified_at === "string" ? record.modified_at : null,
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function discoverOllama(
  baseUrl: string,
  timeoutMs = 2500,
): Promise<OllamaDiscovery> {
  const checkedAt = Date.now();
  try {
    const models = await listOllamaModels(baseUrl, timeoutMs);
    return { online: true, baseUrl: trimBase(baseUrl), models, error: null, checkedAt };
  } catch (error) {
    const message =
      error instanceof ProviderError
        ? error.message
        : error instanceof Error
          ? redactSecret(error.message)
          : "Ollama could not be reached.";
    return {
      online: false,
      baseUrl: trimBase(baseUrl),
      models: [],
      error: message,
      checkedAt,
    };
  }
}

export async function verifyOllama(baseUrl: string): Promise<VerificationResult> {
  const models = await listOllamaModels(baseUrl);
  return { models: models.map((model) => model.id), checkedAt: Date.now() };
}

function buildMessages(input: ChatInput) {
  return input.messages.map((message) => ({ role: message.role, content: message.content }));
}

function buildOptions(input: ChatInput) {
  const options: Record<string, unknown> = {};
  if (typeof input.temperature === "number") options.temperature = input.temperature;
  if (typeof input.maxTokens === "number") options.num_predict = input.maxTokens;
  return options;
}

function usageFrom(prompt: unknown, completion: unknown): { usage: TokenUsage; available: boolean } {
  const promptTokens = numberOrNull(prompt);
  const completionTokens = numberOrNull(completion);
  const totalTokens =
    promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : (promptTokens ?? completionTokens);
  return {
    usage: { promptTokens, completionTokens, totalTokens },
    available: promptTokens !== null || completionTokens !== null,
  };
}

export async function ollamaChat(input: ChatInput): Promise<ChatResult> {
  const baseUrl = trimBase(input.baseUrl);
  const endpoint = `${baseUrl}/api/chat`;
  const body = {
    model: input.modelId,
    messages: buildMessages(input),
    stream: false,
    options: buildOptions(input),
  };
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: combineSignals(120_000, input.signal),
    });
  } catch (error) {
    throw mapNetworkError(error, "ollama");
  }
  if (!res.ok) await throwForHttpError(res, "ollama");
  const raw = await readResponseText(res);
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad shape");
    data = parsed as Record<string, unknown>;
  } catch {
    throw new ProviderError("invalid_response", "Ollama /api/chat returned an unexpected payload.", {
      details: redactSecret(raw.slice(0, 300)),
    });
  }
  if (typeof data.error === "string") {
    throw new ProviderError("server", redactSecret(data.error.slice(0, 400)));
  }
  const message =
    data.message && typeof data.message === "object"
      ? (data.message as Record<string, unknown>)
      : {};
  const text = typeof message.content === "string" ? message.content : "";
  if (!text.trim()) {
    throw new ProviderError("invalid_response", "Ollama returned an empty message.");
  }
  const { usage, available } = usageFrom(data.prompt_eval_count, data.eval_count);
  return {
    text,
    usage,
    usageAvailable: available,
    requestId: null,
    providerModelId: typeof data.model === "string" ? data.model : input.modelId,
    finishReason: typeof data.done_reason === "string" ? data.done_reason : null,
    latencyMs: Math.round(performance.now() - started),
  };
}

export async function ollamaStream(input: ChatStreamInput): Promise<ChatResult> {
  const baseUrl = trimBase(input.baseUrl);
  const endpoint = `${baseUrl}/api/chat`;
  const body = {
    model: input.modelId,
    messages: buildMessages(input),
    stream: true,
    options: buildOptions(input),
  };
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: combineSignals(120_000, input.signal),
    });
  } catch (error) {
    throw mapNetworkError(error, "ollama");
  }
  if (!res.ok) await throwForHttpError(res, "ollama");
  if (!res.body) {
    throw new ProviderError("invalid_response", "Ollama returned no stream body.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let bytes = 0;
  let promptCount: unknown = null;
  let completionCount: unknown = null;
  let finishReason: string | null = null;
  let providerModelId: string | null = input.modelId;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new ProviderError("invalid_response", "Ollama stream exceeded the 8 MB limit.");
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: Record<string, unknown>;
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (!parsed || typeof parsed !== "object") continue;
          event = parsed as Record<string, unknown>;
        } catch {
          throw new ProviderError("invalid_response", "Ollama stream contained invalid JSON.");
        }
        if (typeof event.error === "string") {
          throw new ProviderError("server", redactSecret(event.error.slice(0, 400)));
        }
        if (typeof event.model === "string") providerModelId = event.model;
        const message =
          event.message && typeof event.message === "object"
            ? (event.message as Record<string, unknown>)
            : {};
        if (typeof message.content === "string" && message.content) {
          text += message.content;
          input.onDelta(message.content);
        }
        if (typeof event.done_reason === "string") finishReason = event.done_reason;
        if (event.done === true) {
          promptCount = event.prompt_eval_count ?? promptCount;
          completionCount = event.eval_count ?? completionCount;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!text.trim()) {
    throw new ProviderError("invalid_response", "Ollama stream returned an empty message.");
  }
  const { usage, available } = usageFrom(promptCount, completionCount);
  return {
    text,
    usage,
    usageAvailable: available,
    requestId: null,
    providerModelId,
    finishReason,
    latencyMs: Math.round(performance.now() - started),
  };
}
