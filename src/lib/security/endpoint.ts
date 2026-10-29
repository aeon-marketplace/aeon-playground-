import { getEnv } from "@/lib/env";
import { normalizeBaseUrl } from "@/lib/providers/http";
import { SsrfError, validateEndpointUrl } from "@/lib/security/ssrf";
import { ApiError } from "@/lib/http/api";

export async function validateCustomBaseUrl(raw: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiError(422, "invalid_endpoint", "Base URL must be a valid absolute URL.");
  }
  if (parsed.search || parsed.hash) {
    throw new ApiError(
      422,
      "invalid_endpoint",
      "Base URL must not contain a query string or fragment.",
    );
  }
  const normalized = normalizeBaseUrl(raw);
  try {
    await validateEndpointUrl(normalized, {
      allowLoopback: getEnv().allowInsecureLocalEndpoints,
    });
  } catch (error) {
    if (error instanceof SsrfError) {
      throw new ApiError(422, "unsafe_endpoint", error.message);
    }
    throw error;
  }
  return normalized;
}
