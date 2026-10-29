import { ProviderError, mapNetworkError } from "@/lib/providers/errors";
import {
  assertNoRedirect,
  readResponseText,
  throwForHttpError,
} from "@/lib/providers/http";
import { openAICompatibleChat, openAICompatibleStream } from "@/lib/providers/openai-compatible";
import type {
  ChatInput,
  ChatResult,
  ChatStreamInput,
  ImageInput,
  ImageResult,
  ProviderAdapter,
  VerificationResult,
} from "@/lib/providers/types";

const TEXT_URL = "https://text.pollinations.ai/openai";
const MODELS_URL = "https://text.pollinations.ai/models";
const IMAGE_BASE = "https://image.pollinations.ai/prompt";

export function pollinationsChat(input: ChatInput): Promise<ChatResult> {
  return openAICompatibleChat({
    ...input,
    providerName: "pollinations",
    endpoint: TEXT_URL,
    maxTokens: input.maxTokens ?? 1024,
  });
}

export function pollinationsStream(input: ChatStreamInput): Promise<ChatResult> {
  return openAICompatibleStream({
    ...input,
    providerName: "pollinations",
    endpoint: TEXT_URL,
    maxTokens: input.maxTokens ?? 1024,
  });
}

export async function verifyPollinations(): Promise<VerificationResult> {
  let res: Response;
  try {
    res = await fetch(MODELS_URL, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw mapNetworkError(error, "pollinations");
  }
  assertNoRedirect(res, "pollinations");
  if (!res.ok) await throwForHttpError(res, "pollinations");
  const raw = await readResponseText(res);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderError("invalid_response", "Pollinations model list was not JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new ProviderError("invalid_response", "Pollinations model list had an unexpected shape.");
  }
  const models = parsed
    .map((entry) =>
      entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string"
        ? ((entry as Record<string, unknown>).name as string)
        : null,
    )
    .filter((id): id is string => Boolean(id));
  return { models, checkedAt: Date.now() };
}

export async function generatePollinationsImage(
  input: ImageInput & { modelId?: string },
): Promise<ImageResult> {
  const modelId = input.modelId || "flux";
  const params = new URLSearchParams({
    width: String(input.width),
    height: String(input.height),
    model: modelId,
    nologo: "true",
  });
  if (typeof input.seed === "number") params.set("seed", String(input.seed));
  const url = `${IMAGE_BASE}/${encodeURIComponent(input.prompt)}?${params.toString()}`;

  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "manual",
      signal: input.signal
        ? AbortSignal.any([AbortSignal.timeout(120_000), input.signal])
        : AbortSignal.timeout(120_000),
      headers: { accept: "image/*" },
    });
  } catch (error) {
    throw mapNetworkError(error, "pollinations");
  }
  assertNoRedirect(res, "pollinations");
  if (res.status === 402 || res.status === 429) {
    const rawRetry = res.headers.get("retry-after");
    const retry = rawRetry ? Number(rawRetry) : Number.NaN;
    const retryAfterSeconds = Number.isFinite(retry) && retry >= 0 ? Math.ceil(retry) : undefined;
    throw new ProviderError(
      "rate_limit",
      retryAfterSeconds
        ? `Pollinations' anonymous image tier allows one image at a time. Retry in about ${retryAfterSeconds}s.`
        : "Pollinations' anonymous image tier allows one image at a time, at least 45 seconds apart. Wait and try again.",
      {
        status: res.status,
        provider: "pollinations",
        retryAfterSeconds,
        details:
          "The anonymous classic image endpoint returned HTTP 402/429. This is the free-slot rate limit, not proof that a paid plan is required.",
      },
    );
  }
  if (!res.ok) await throwForHttpError(res, "pollinations");

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new ProviderError("invalid_response", "Image provider did not return an image.", {
      provider: "pollinations",
      details: `content-type: ${contentType}`,
    });
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > 12 * 1024 * 1024) {
    throw new ProviderError("invalid_response", "Image exceeded the 12 MB limit.");
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 12 * 1024 * 1024) {
    throw new ProviderError("invalid_response", "Image size was empty or exceeded the 12 MB limit.");
  }
  return {
    bytes,
    contentType: contentType.split(";")[0].trim(),
    latencyMs: Math.round(performance.now() - started),
    finalUrl: url,
  };
}

export const pollinationsAdapter: ProviderAdapter = {
  chat: pollinationsChat,
  verifyKey: verifyPollinations,
};
