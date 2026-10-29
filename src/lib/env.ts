import path from "node:path";

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

export type AppEnv = {
  appUrl: string;
  authSecret: string;
  encryptionKey: string;
  databasePath: string;
  allowRegistration: boolean;
  allowInsecureLocalEndpoints: boolean;
  allowPaidByok: boolean;
  sessionTtlDays: number;
  chatRateLimitPerMinute: number;
  publicChatRateLimitPerMinute: number;
  publicImageRateLimitPerMinute: number;
  publicCompareRateLimitPerMinute: number;
  publicModelRefs: string[];
  ollamaBaseUrl: string;
  ollamaDiscoveryTimeoutMs: number;
  cloudflareAccountId: string | null;
  embedded: boolean;
  embedAllowedOrigins: string[];
};

const DEFAULT_PUBLIC_MODEL_REFS = ["pollinations::openai-fast", "pollinations::flux"];

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100_000) {
    throw new EnvError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value === "") return fallback;
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function originList(value: string | undefined): string[] {
  if (value === undefined || value === "") return [];
  const origins = new Set<string>();
  for (const entry of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    if (entry === "*") {
      origins.add("*");
      continue;
    }
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new EnvError(
        `EMBED_ALLOWED_ORIGINS contains an invalid origin: "${entry}". Use absolute http(s) origins.`,
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new EnvError("EMBED_ALLOWED_ORIGINS entries must use http or https.");
    }
    if (url.username || url.password) {
      throw new EnvError("EMBED_ALLOWED_ORIGINS entries must not contain credentials.");
    }
    origins.add(url.origin);
  }
  return Array.from(origins);
}

export function getEnv(): AppEnv {
  const authSecret = process.env.AUTH_SECRET ?? "";
  const encryptionKey = process.env.ENCRYPTION_KEY ?? "";

  if (authSecret.length < 32) {
    throw new EnvError(
      "AUTH_SECRET is missing or too short (minimum 32 characters). Run `npm run setup` to generate .env.local.",
    );
  }
  if (!encryptionKey) {
    throw new EnvError(
      "ENCRYPTION_KEY is missing. Run `npm run setup` to generate .env.local.",
    );
  }

  const appUrlRaw = process.env.APP_URL || "http://localhost:3000";
  let appUrl: URL;
  try {
    appUrl = new URL(appUrlRaw);
  } catch {
    throw new EnvError("APP_URL must be a valid absolute URL.");
  }
  if (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") {
    throw new EnvError("APP_URL must use http or https.");
  }

  const ollamaRaw = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  let ollamaUrl: URL;
  try {
    ollamaUrl = new URL(ollamaRaw);
  } catch {
    throw new EnvError("OLLAMA_BASE_URL must be a valid absolute URL.");
  }
  if (ollamaUrl.protocol !== "http:" && ollamaUrl.protocol !== "https:") {
    throw new EnvError("OLLAMA_BASE_URL must use http or https.");
  }

  const cloudflareAccountIdRaw = (process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  if (cloudflareAccountIdRaw && !/^[a-f0-9]{32}$/i.test(cloudflareAccountIdRaw)) {
    throw new EnvError(
      "CLOUDFLARE_ACCOUNT_ID must be the 32-character hexadecimal account ID from the Cloudflare dashboard.",
    );
  }

  return {
    appUrl: appUrl.origin,
    authSecret,
    encryptionKey,
    databasePath: path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      process.env.DATABASE_PATH || "./data/playground.db",
    ),
    allowRegistration: bool(process.env.ALLOW_REGISTRATION, true),
    allowInsecureLocalEndpoints: bool(process.env.ALLOW_INSECURE_LOCAL_ENDPOINTS, false),
    allowPaidByok: bool(process.env.ALLOW_PAID_BYOK, false),
    sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 7, "SESSION_TTL_DAYS"),
    chatRateLimitPerMinute: int(process.env.CHAT_RATE_LIMIT_PER_MINUTE, 20, "CHAT_RATE_LIMIT_PER_MINUTE"),
    publicChatRateLimitPerMinute: int(
      process.env.PUBLIC_CHAT_RATE_LIMIT_PER_MINUTE,
      6,
      "PUBLIC_CHAT_RATE_LIMIT_PER_MINUTE",
    ),
    publicImageRateLimitPerMinute: int(
      process.env.PUBLIC_IMAGE_RATE_LIMIT_PER_MINUTE,
      2,
      "PUBLIC_IMAGE_RATE_LIMIT_PER_MINUTE",
    ),
    publicCompareRateLimitPerMinute: int(
      process.env.PUBLIC_COMPARE_RATE_LIMIT_PER_MINUTE,
      4,
      "PUBLIC_COMPARE_RATE_LIMIT_PER_MINUTE",
    ),
    publicModelRefs: list(process.env.PUBLIC_MODEL_REFS, DEFAULT_PUBLIC_MODEL_REFS),
    ollamaBaseUrl: `${ollamaUrl.origin}${ollamaUrl.pathname.replace(/\/+$/, "")}`,
    ollamaDiscoveryTimeoutMs: int(
      process.env.OLLAMA_DISCOVERY_TIMEOUT_MS,
      2500,
      "OLLAMA_DISCOVERY_TIMEOUT_MS",
    ),
    cloudflareAccountId: cloudflareAccountIdRaw
      ? cloudflareAccountIdRaw.toLowerCase()
      : null,
    embedded: bool(process.env.EMBEDDED, false),
    embedAllowedOrigins: originList(process.env.EMBED_ALLOWED_ORIGINS),
  };
}
