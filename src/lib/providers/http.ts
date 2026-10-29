import { mapHttpError, ProviderError, redactSecret } from "@/lib/providers/errors";
import type { TokenUsage } from "@/lib/providers/types";

export function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.search = "";
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) {
    pathname = pathname.slice(0, -"/chat/completions".length);
  }
  return `${url.origin}${pathname}`;
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function readResponseText(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > 8 * 1024 * 1024) {
    throw new ProviderError("invalid_response", "Provider response exceeded the 8 MB limit.");
  }
  const text = await res.text();
  if (text.length > 8 * 1024 * 1024) {
    throw new ProviderError("invalid_response", "Provider response exceeded the 8 MB limit.");
  }
  return text;
}

export async function throwForHttpError(
  res: Response,
  provider: string,
  apiKey?: string,
): Promise<never> {
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  // Image and other binary error bodies must never be decoded as text or
  // echoed into error details. Keep a safe, short explanation instead.
  const textual =
    contentType === "" ||
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.startsWith("application/x-www-form-urlencoded");
  const body = textual
    ? await readResponseText(res).catch(() => "")
    : `The provider returned HTTP ${res.status} with a binary (${contentType.split(";")[0] || "unknown"}) body.`;
  throw mapHttpError(res.status, body, provider, apiKey, res.headers);
}

export function parseJson(text: string, provider: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProviderError("invalid_response", undefined, {
      provider,
      details: redactSecret(text.slice(0, 300)),
    });
  }
}

export function extractOpenAIText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;
  const content = record.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const text = (part as Record<string, unknown>).text;
          if (typeof text === "string") return text;
        }
        return "";
      })
      .join("");
  }
  if (typeof record.refusal === "string") return record.refusal;
  return "";
}

/**
 * Some reasoning models (notably GPT-OSS on Groq) put the whole response in a
 * `reasoning` field and leave `content` empty when the token budget is small.
 * This is real provider output, so it may be shown rather than discarded.
 */
export function extractOpenAIReasoning(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;
  for (const key of ["reasoning", "reasoning_content"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function parseOpenAIUsage(usage: unknown): { usage: TokenUsage; available: boolean } {
  if (!usage || typeof usage !== "object") {
    return {
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      available: false,
    };
  }
  const record = usage as Record<string, unknown>;
  const prompt = numberOrNull(record.prompt_tokens ?? record.input_tokens);
  const completion = numberOrNull(record.completion_tokens ?? record.output_tokens);
  const total =
    numberOrNull(record.total_tokens) ??
    (prompt !== null && completion !== null ? prompt + completion : null);
  return {
    usage: { promptTokens: prompt, completionTokens: completion, totalTokens: total },
    available: prompt !== null || completion !== null || total !== null,
  };
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function assertNoRedirect(res: Response, provider: string) {
  if (res.status >= 300 && res.status < 400) {
    throw new ProviderError(
      "invalid_request",
      "The provider returned an HTTP redirect. Redirects are not followed.",
      { provider, status: res.status },
    );
  }
}
