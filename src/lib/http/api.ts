import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type AuthUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { ProviderError } from "@/lib/providers/errors";
import { checkRateLimit } from "@/lib/security/rate-limit";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: string;
  readonly retryAfterSeconds?: number;
  /** Additional top-level JSON fields returned alongside `error`. */
  readonly extra?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: {
      details?: string;
      retryAfterSeconds?: number;
      extra?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.extra = options.extra;
  }
}

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) {
    throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  }
  return user;
}

export async function requireApiUser(): Promise<AuthUser> {
  return requireUser(await getCurrentUser());
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new ApiError(403, "cross_origin", "Cross-site request blocked.");
  }
  if (!origin) return;
  const allowed = new Set<string>();
  try {
    allowed.add(getEnv().appUrl);
  } catch {
    // Env validation reports its own error later.
  }
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // Ignore malformed request URLs.
  }
  if (!allowed.has(origin)) {
    throw new ApiError(403, "cross_origin", "Request origin is not allowed.");
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "local";
}

export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): void {
  const result = checkRateLimit(key, limit, windowMs);
  if (!result.allowed) {
    throw new ApiError(
      429,
      "rate_limited",
      `Too many requests. Try again in about ${result.retryAfterSeconds}s.`,
      { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > 1_000_000) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Reads the client-generated idempotency key for a generation request.
 *
 * Returns null when the header is absent so the caller can generate its own.
 * A malformed value is rejected rather than silently replaced, so a retry can
 * never be counted twice by accident.
 */
export function readRequestId(request: Request): string | null {
  const raw = request.headers.get("x-request-id");
  if (raw === null) return null;
  const value = raw.trim();
  if (!REQUEST_ID_PATTERN.test(value)) {
    throw new ApiError(
      400,
      "invalid_request_id",
      "The x-request-id header must be 8-128 characters of letters, digits, '.', '_', ':', or '-'.",
    );
  }
  return value;
}

function providerStatus(error: ProviderError): { status: number; code: string } {
  switch (error.code) {
    case "auth":
      return { status: 422, code: "provider_auth" };
    case "forbidden":
      return { status: 403, code: "provider_forbidden" };
    case "rate_limit":
      return { status: 429, code: "provider_rate_limit" };
    case "quota":
      return { status: 402, code: "provider_quota" };
    case "payment_required":
      return { status: 402, code: "provider_payment_required" };
    case "unsupported_model":
      return { status: 404, code: "unsupported_model" };
    case "model_unavailable":
      return { status: 404, code: "provider_model_unavailable" };
    case "content_blocked":
      return { status: 422, code: "content_blocked" };
    case "timeout":
      return { status: 504, code: "provider_timeout" };
    case "network":
      return { status: 502, code: "provider_network" };
    case "server":
      return { status: 502, code: "provider_server" };
    case "invalid_response":
      return { status: 502, code: "provider_invalid_response" };
    case "invalid_request":
      return { status: 422, code: "provider_invalid_request" };
    case "config":
      return { status: 400, code: "provider_invalid_request" };
  }
}

export function publicError(error: unknown): {
  status: number;
  body: {
    error: {
      code: string;
      message: string;
      details?: string;
      retryAfterSeconds?: number;
    };
    [key: string]: unknown;
  };
} {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        ...(error.extra ?? {}),
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          retryAfterSeconds: error.retryAfterSeconds,
        },
      },
    };
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return {
      status: 422,
      body: {
        error: {
          code: "validation_error",
          message: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.",
        },
      },
    };
  }
  if (error instanceof ProviderError) {
    const mapped = providerStatus(error);
    return {
      status: mapped.status,
      body: {
        error: {
          code: mapped.code,
          message: error.message,
          details: error.details,
          retryAfterSeconds: error.retryAfterSeconds,
        },
      },
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (/ENCRYPTION_KEY|AUTH_SECRET|ENCRYPTION|decrypt/i.test(message)) {
    return {
      status: 500,
      body: {
        error: {
          code: "server_configuration",
          message:
            "The server encryption/session configuration is invalid. Check AUTH_SECRET and ENCRYPTION_KEY.",
        },
      },
    };
  }
  console.error("[api] unhandled error", error);
  return {
    status: 500,
    body: {
      error: {
        code: "internal_error",
        message: "An unexpected server error occurred.",
      },
    },
  };
}

export function jsonError(error: unknown): NextResponse {
  const { status, body } = publicError(error);
  const response = NextResponse.json(body, { status });
  if (body.error.retryAfterSeconds) {
    response.headers.set("retry-after", String(body.error.retryAfterSeconds));
  }
  return response;
}

/** A safe, key-redacted summary for the user's own test history. */
export function providerErrorForHistory(error: unknown): { code: string; message: string } {
  if (error instanceof ProviderError) {
    const message = `${error.message}${error.details ? ` — ${error.details}` : ""}`;
    return { code: `provider_${error.code}`, message: message.slice(0, 2000) };
  }
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message.slice(0, 2000) };
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return {
      code: "validation_error",
      message: first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.",
    };
  }
  return { code: "internal_error", message: "An unexpected error occurred." };
}

