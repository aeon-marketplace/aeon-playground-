import { ProviderError, mapNetworkError, redactSecret } from "@/lib/providers/errors";
import {
  assertNoRedirect,
  parseJson,
  readResponseText,
  throwForHttpError,
} from "@/lib/providers/http";
import type {
  ChatInput,
  ChatMessage,
  ChatResult,
  ChatStreamInput,
  ProviderAdapter,
  VerificationResult,
} from "@/lib/providers/types";
import { parseSseJson, readSseData } from "@/lib/providers/stream";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function toGeminiContents(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
}

export async function geminiChat(input: ChatInput): Promise<ChatResult> {
  const apiKey = input.apiKey;
  if (!apiKey) {
    throw new ProviderError("config", "A Gemini API key is required.");
  }
  const modelId = input.modelId.replace(/^models\//, "");
  const systemText = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents = toGeminiContents(input.messages);
  if (contents.length === 0) {
    throw new ProviderError("invalid_request", "At least one user message is required.");
  }

  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  const generationConfig: Record<string, unknown> = {};
  if (typeof input.temperature === "number") generationConfig.temperature = input.temperature;
  if (typeof input.maxTokens === "number") generationConfig.maxOutputTokens = input.maxTokens;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  const endpoint = `${BASE_URL}/models/${encodeURIComponent(modelId)}:generateContent`;
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw mapNetworkError(error, "gemini", apiKey);
  }
  assertNoRedirect(res, "gemini");
  if (!res.ok) await throwForHttpError(res, "gemini", apiKey);

  const raw = await readResponseText(res);
  const data = parseJson(raw, "gemini");
  const promptFeedback = data.promptFeedback as Record<string, unknown> | undefined;
  if (promptFeedback?.blockReason) {
    throw new ProviderError(
      "content_blocked",
      `Gemini blocked the prompt (${String(promptFeedback.blockReason)}).`,
      { provider: "gemini" },
    );
  }
  const candidates = data.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new ProviderError("invalid_response", "Gemini returned no candidates.", {
      provider: "gemini",
      details: redactSecret(raw.slice(0, 300), apiKey),
    });
  }
  const candidate = candidates[0] as Record<string, unknown>;
  const finishReason = typeof candidate.finishReason === "string" ? candidate.finishReason : null;
  const content = candidate.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((part) =>
          part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
            ? ((part as Record<string, unknown>).text as string)
            : "",
        )
        .join("")
    : "";
  if (!text) {
    if (finishReason && /SAFETY|BLOCKLIST|PROHIBITED_CONTENT|SPII/i.test(finishReason)) {
      throw new ProviderError("content_blocked", undefined, { provider: "gemini" });
    }
    throw new ProviderError("invalid_response", "Gemini returned an empty message.", {
      provider: "gemini",
    });
  }

  const usageMeta = data.usageMetadata as Record<string, unknown> | undefined;
  const promptTokens = numberOrNull(usageMeta?.promptTokenCount);
  const completionTokens = numberOrNull(usageMeta?.candidatesTokenCount);
  const totalTokens = numberOrNull(usageMeta?.totalTokenCount);
  return {
    text,
    usage: { promptTokens, completionTokens, totalTokens },
    usageAvailable: promptTokens !== null || completionTokens !== null || totalTokens !== null,
    requestId: typeof data.responseId === "string" ? data.responseId : null,
    providerModelId: typeof data.modelVersion === "string" ? data.modelVersion : modelId,
    finishReason,
    latencyMs: Math.round(performance.now() - started),
  };
}

export async function geminiStream(input: ChatStreamInput): Promise<ChatResult> {
  const apiKey = input.apiKey;
  if (!apiKey) {
    throw new ProviderError("config", "A Gemini API key is required.");
  }
  const modelId = input.modelId.replace(/^models\//, "");
  const systemText = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents = toGeminiContents(input.messages);
  if (contents.length === 0) {
    throw new ProviderError("invalid_request", "At least one user message is required.");
  }

  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  const generationConfig: Record<string, unknown> = {};
  if (typeof input.temperature === "number") generationConfig.temperature = input.temperature;
  if (typeof input.maxTokens === "number") generationConfig.maxOutputTokens = input.maxTokens;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  const endpoint = `${BASE_URL}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: input.signal
        ? AbortSignal.any([AbortSignal.timeout(120_000), input.signal])
        : AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw mapNetworkError(error, "gemini", apiKey);
  }
  assertNoRedirect(res, "gemini");
  if (!res.ok) await throwForHttpError(res, "gemini", apiKey);
  if (!res.body) {
    throw new ProviderError("invalid_response", "Gemini returned no stream body.", {
      provider: "gemini",
    });
  }

  let text = "";
  let finishReason: string | null = null;
  let requestId: string | null = null;
  let providerModelId: string | null = modelId;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let totalTokens: number | null = null;

  await readSseData(res, (payload) => {
    const data = parseSseJson(payload, "gemini");
    const promptFeedback = data.promptFeedback as Record<string, unknown> | undefined;
    if (promptFeedback?.blockReason) {
      throw new ProviderError(
        "content_blocked",
        `Gemini blocked the prompt (${String(promptFeedback.blockReason)}).`,
        { provider: "gemini" },
      );
    }
    if (typeof data.responseId === "string") requestId = data.responseId;
    if (typeof data.modelVersion === "string") providerModelId = data.modelVersion;
    const usageMeta = data.usageMetadata as Record<string, unknown> | undefined;
    promptTokens = numberOrNull(usageMeta?.promptTokenCount) ?? promptTokens;
    completionTokens = numberOrNull(usageMeta?.candidatesTokenCount) ?? completionTokens;
    totalTokens = numberOrNull(usageMeta?.totalTokenCount) ?? totalTokens;

    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const candidate = (candidates[0] ?? {}) as Record<string, unknown>;
    if (typeof candidate.finishReason === "string") finishReason = candidate.finishReason;
    const content = candidate.content as Record<string, unknown> | undefined;
    const parts = content?.parts;
    if (!Array.isArray(parts)) return;
    for (const part of parts) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as Record<string, unknown>).text === "string"
      ) {
        const piece = (part as Record<string, unknown>).text as string;
        if (piece) {
          text += piece;
          input.onDelta(piece);
        }
      }
    }
  });

  if (!text) {
    if (finishReason && /SAFETY|BLOCKLIST|PROHIBITED_CONTENT|SPII/i.test(finishReason)) {
      throw new ProviderError("content_blocked", undefined, { provider: "gemini" });
    }
    throw new ProviderError("invalid_response", "Gemini returned an empty streamed message.", {
      provider: "gemini",
    });
  }

  return {
    text,
    usage: { promptTokens, completionTokens, totalTokens },
    usageAvailable: promptTokens !== null || completionTokens !== null || totalTokens !== null,
    requestId,
    providerModelId,
    finishReason,
    latencyMs: Math.round(performance.now() - started),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function verifyGeminiKey(input: {
  apiKey: string;
}): Promise<VerificationResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/models?pageSize=1000`, {
      headers: { "x-goog-api-key": input.apiKey, accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw mapNetworkError(error, "gemini", input.apiKey);
  }
  assertNoRedirect(res, "gemini");
  if (!res.ok) await throwForHttpError(res, "gemini", input.apiKey);
  const raw = await readResponseText(res);
  const data = parseJson(raw, "gemini");
  const models = Array.isArray(data.models) ? data.models : [];
  const ids = models
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const model = entry as Record<string, unknown>;
      const name = typeof model.name === "string" ? model.name.replace(/^models\//, "") : null;
      const methods = Array.isArray(model.supportedGenerationMethods)
        ? model.supportedGenerationMethods
        : null;
      // ListModels returns the catalog for this key, not proof that every model
      // can be invoked. Keep all IDs so the catalog can classify text, image,
      // audio, embedding, and live-only entries honestly.
      if (methods && methods.length === 0) return null;
      return name;
    })
    .filter((id): id is string => Boolean(id));
  return { models: Array.from(new Set(ids)).slice(0, 500), checkedAt: Date.now() };
}

export const geminiAdapter: ProviderAdapter = {
  chat(input) {
    return geminiChat(input);
  },
  verifyKey(input) {
    return verifyGeminiKey({ apiKey: input.apiKey });
  },
};
