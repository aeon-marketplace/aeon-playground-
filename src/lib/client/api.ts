import type { DailyUsage } from "@/lib/usage/policy";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: string;
  readonly retryAfterSeconds?: number;
  readonly dailyUsage?: DailyUsage;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: string,
    retryAfterSeconds?: number,
    dailyUsage?: DailyUsage,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
    this.dailyUsage = dailyUsage;
  }
}

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: string;
    retryAfterSeconds?: number;
  };
  dailyUsage?: DailyUsage;
};

/** Fetch JSON from this app's API and throw a typed error for non-2xx responses. */
export async function requestJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(input, {
    ...init,
    headers,
    cache: "no-store",
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as ErrorPayload | null)?.error;
    throw new ApiClientError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.details,
      error?.retryAfterSeconds,
      (payload as ErrorPayload | null)?.dailyUsage,
    );
  }

  return payload as T;
}

export function describeClientError(error: unknown): {
  message: string;
  code?: string;
  details?: string;
} {
  if (error instanceof ApiClientError) {
    return { message: error.message, code: error.code, details: error.details };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: "An unexpected error occurred." };
}
