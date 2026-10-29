import { getEnv } from "@/lib/env";
import { mapNetworkError, ProviderError, redactSecret } from "@/lib/providers/errors";
import { safeFetch } from "@/lib/security/ssrf";
import type { VerificationResult } from "@/lib/providers/types";

/**
 * Cloudflare Workers AI.
 *
 * Workers AI is addressed per account:
 *   https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1
 *
 * The account ID is not a secret, but it is required for every request. This
 * app stores the account ID together with the API token as
 * `<account_id>:<api_token>` in the encrypted credential store, so a public
 * visitor can use their own Cloudflare account without operator configuration.
 * If CLOUDFLARE_ACCOUNT_ID is set, a bare token is also accepted.
 */

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const MODELS_PAGE_SIZE = 100;
const MAX_PAGES = 2;
const REQUEST_TIMEOUT_MS = 15_000;

export type CloudflareCredential = {
  accountId: string;
  apiToken: string;
};

export function isCloudflareAccountId(value: string): boolean {
  return ACCOUNT_ID_PATTERN.test(value.trim());
}

function invalidCredentialMessage(): string {
  return (
    "Cloudflare needs both an account ID and an API token. Save the credential as " +
    "`<account_id>:<api_token>` (32-character account ID, then a colon, then the token), " +
    "or ask the operator to set CLOUDFLARE_ACCOUNT_ID and save only the token."
  );
}

export function parseCloudflareCredential(raw: string): CloudflareCredential {
  const value = raw.trim();
  if (!value) {
    throw new ProviderError("auth", invalidCredentialMessage());
  }

  const separator = value.indexOf(":");
  if (separator > 0) {
    const accountId = value.slice(0, separator).trim();
    const apiToken = value.slice(separator + 1).trim();
    if (isCloudflareAccountId(accountId) && apiToken.length >= 20) {
      return { accountId: accountId.toLowerCase(), apiToken };
    }
    throw new ProviderError("auth", invalidCredentialMessage());
  }

  const defaultAccountId = getEnv().cloudflareAccountId;
  if (defaultAccountId && value.length >= 20) {
    return { accountId: defaultAccountId, apiToken: value };
  }
  throw new ProviderError("auth", invalidCredentialMessage());
}

export function cloudflareBaseUrl(accountId: string): string {
  if (!isCloudflareAccountId(accountId)) {
    throw new ProviderError("config", "The Cloudflare account ID is not 32 hexadecimal characters.");
  }
  return `https://api.cloudflare.com/client/v4/accounts/${accountId.toLowerCase()}/ai/v1`;
}

type CloudflareModelEntry = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  task?: { id?: unknown; name?: unknown } | null;
};

type CloudflareEnvelope = {
  success?: boolean;
  result?: unknown;
  errors?: Array<{ code?: number; message?: string }>;
};

function errorMessageFromEnvelope(text: string, apiToken: string): string {
  try {
    const data = JSON.parse(text) as CloudflareEnvelope;
    const first = Array.isArray(data.errors) ? data.errors[0] : undefined;
    if (first?.message) return redactSecret(first.message.slice(0, 500), apiToken);
  } catch {
    // Fall through to a redacted body excerpt.
  }
  return redactSecret(text.slice(0, 500), apiToken);
}

async function fetchModelsPage(
  accountId: string,
  apiToken: string,
  page: number,
): Promise<CloudflareModelEntry[]> {
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search` +
    `?page=${page}&per_page=${MODELS_PAGE_SIZE}`;

  let response: Response;
  try {
    response = await safeFetch(
      url,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiToken}`,
        },
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
      getEnv().allowInsecureLocalEndpoints,
    );
  } catch (error) {
    throw mapNetworkError(error, "cloudflare", apiToken);
  }

  const text = await response.text();
  if (!response.ok) {
    const extra = {
      status: response.status,
      provider: "cloudflare",
      details: errorMessageFromEnvelope(text, apiToken) || undefined,
    };
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        "auth",
        `Cloudflare rejected the account ID or API token (HTTP ${response.status}). Check both values and that the token has the Workers AI permission.`,
        extra,
      );
    }
    if (response.status === 429) {
      throw new ProviderError(
        "rate_limit",
        "Cloudflare rate-limited the model list request (HTTP 429). Try again later.",
        extra,
      );
    }
    if (response.status >= 500) {
      throw new ProviderError(
        "server",
        `Cloudflare's model list is temporarily unavailable (HTTP ${response.status}).`,
        extra,
      );
    }
    throw new ProviderError(
      "invalid_request",
      `Cloudflare rejected the model list request (HTTP ${response.status}).`,
      extra,
    );
  }

  let data: CloudflareEnvelope;
  try {
    data = JSON.parse(text) as CloudflareEnvelope;
  } catch {
    throw new ProviderError("invalid_response", "Cloudflare returned a model list that was not valid JSON.");
  }

  if (data.success === false) {
    throw new ProviderError(
      "auth",
      "Cloudflare did not accept the account ID or API token. Check both values and token permissions.",
      { provider: "cloudflare", details: errorMessageFromEnvelope(text, apiToken) || undefined },
    );
  }

  const result = data.result;
  if (Array.isArray(result)) return result as CloudflareModelEntry[];
  if (result && typeof result === "object") {
    const models = (result as { models?: unknown }).models;
    if (Array.isArray(models)) return models as CloudflareModelEntry[];
  }
  return [];
}

function taskLabel(entry: CloudflareModelEntry): string {
  const task = entry.task;
  if (!task) return "";
  const name = typeof task.name === "string" ? task.name : "";
  const id = typeof task.id === "string" ? task.id : "";
  return `${name} ${id}`.toLowerCase();
}

/**
 * Only text-generation models can be used by this app's chat adapter. Image,
 * embedding, classification, speech, and reranking models are excluded rather
 * than offered as broken chat routes.
 */
export function isCloudflareChatModel(entry: CloudflareModelEntry): boolean {
  const id = typeof entry.name === "string" ? entry.name : "";
  if (!id.startsWith("@cf/")) return false;
  const task = taskLabel(entry);
  if (task) {
    return /text generation|text-generation|conversational/.test(task);
  }
  return !/embed|bge|rerank|image|diffus|flux|sdxl|whisper|tts|audio|vision|translate|classif|detect/i.test(
    id,
  );
}

export type CloudflareModelList = {
  accountId: string;
  modelIds: string[];
  checkedAt: number;
};

/** List the text-generation models available to this account and token. */
export async function listCloudflareTextModels(rawCredential: string): Promise<CloudflareModelList> {
  const credential = parseCloudflareCredential(rawCredential);
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const entries = await fetchModelsPage(credential.accountId, credential.apiToken, page);
    for (const entry of entries) {
      if (!isCloudflareChatModel(entry)) continue;
      const id = typeof entry.name === "string" ? entry.name.trim() : "";
      if (!id) continue;
      seen.add(id);
    }
    if (entries.length < MODELS_PAGE_SIZE) break;
  }

  return {
    accountId: credential.accountId,
    modelIds: Array.from(seen).sort(),
    checkedAt: Date.now(),
  };
}

export async function verifyCloudflareCredential(rawCredential: string): Promise<VerificationResult> {
  const list = await listCloudflareTextModels(rawCredential);
  return {
    models: list.modelIds,
    checkedAt: list.checkedAt,
  };
}
