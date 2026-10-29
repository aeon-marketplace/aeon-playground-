import { getProvider } from "@/lib/providers/registry";
import { verifyCloudflareCredential } from "@/lib/providers/cloudflare";
import { ProviderError, redactSecret } from "@/lib/providers/errors";
import { geminiAdapter } from "@/lib/providers/gemini";
import { verifyOpenAICompatibleKey } from "@/lib/providers/openai-compatible";
import { verifyPollinations } from "@/lib/providers/pollinations";
import { openAICompatibleChat } from "@/lib/providers/openai-compatible";
import { verifyOllama } from "@/lib/providers/ollama";
import { safeFetch } from "@/lib/security/ssrf";
import { getEnv } from "@/lib/env";
import type { VerificationResult } from "@/lib/providers/types";

export async function verifyProviderKey(
  providerId: string,
  apiKey: string,
): Promise<VerificationResult> {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new ProviderError("config", "Unknown provider.");
  }
  if (provider.adapter === "ollama") {
    return verifyOllama(getEnv().ollamaBaseUrl);
  }
  if (!provider.requiresKey) {
    return verifyPollinations();
  }
  if (provider.id === "gemini") {
    return geminiAdapter.verifyKey({ apiKey, baseUrl: provider.baseUrl });
  }
  if (provider.id === "cloudflare") {
    // Cloudflare needs an account ID as well as the token. The credential is
    // stored as `<account_id>:<token>` or a bare token when the operator has
    // configured CLOUDFLARE_ACCOUNT_ID.
    return verifyCloudflareCredential(apiKey);
  }
  return verifyOpenAICompatibleKey({
    apiKey,
    baseUrl: provider.baseUrl,
    providerId: provider.id,
    appUrl: getEnv().appUrl,
  });
}

export async function verifyCustomEndpoint(input: {
  baseUrl: string;
  modelId: string;
  apiKey?: string;
}): Promise<{ latencyMs: number; text: string }> {
  const env = getEnv();
  const started = performance.now();
  const result = await openAICompatibleChat({
    providerName: "custom",
    endpoint: `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    providerId: "custom",
    modelId: input.modelId,
    messages: [
      {
        role: "user",
        content: "This is a connection test. Reply with the single word OK.",
      },
    ],
    temperature: 0,
    maxTokens: 16,
    apiKey: input.apiKey,
    fetchImpl: (url, init) =>
      safeFetch(
        typeof url === "string" ? url : url.toString(),
        init as RequestInit,
        env.allowInsecureLocalEndpoints,
      ) as unknown as Promise<Response>,
  });
  return {
    latencyMs: Math.round(performance.now() - started),
    text: result.text,
  };
}

export function safeVerificationError(error: unknown): string {
  if (error instanceof ProviderError) {
    return redactSecret(`${error.message}${error.details ? ` (${error.details})` : ""}`);
  }
  return "Connection test failed.";
}
