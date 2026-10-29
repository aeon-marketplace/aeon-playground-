import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  jsonError,
} from "@/lib/http/api";
import { getAnonymousUserId, getCurrentUser } from "@/lib/auth/session";
import { getDiscoveryReport } from "@/lib/providers/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Force-refresh provider model discovery for the current visitor.
 *
 * Providers that require authentication are queried only with that visitor's
 * saved, verified key. Providers without a key are reported as skipped rather
 * than treated as empty successes. No secrets are returned.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    // This endpoint only reads public metadata or the visitor's own verified
    // credentials. It does not create a session or an account.
    const user = await getCurrentUser();
    const userId = user?.id ?? (await getAnonymousUserId());
    enforceRateLimit(`discover:${getClientIp(request)}`, 6, 60_000);

    const providers = await getDiscoveryReport(userId, { force: true });
    return NextResponse.json({
      ok: providers.every((provider) => provider.error === null),
      providers: providers.map((provider) => ({
        providerId: provider.providerId,
        providerName: provider.providerName,
        authenticated: provider.authenticated,
        count: provider.models.length,
        error: provider.error,
        checkedAt: provider.checkedAt,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
