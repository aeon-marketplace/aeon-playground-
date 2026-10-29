import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  jsonError,
  readJson,
} from "@/lib/http/api";
import {
  getAnonymousUserId,
  getCurrentUser,
  getOrCreateAnonymousUserId,
} from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import {
  getProviderCredentialRow,
  listProviderCredentials,
  saveProviderCredential,
} from "@/lib/db/credentials";
import { clearModelTestResults } from "@/lib/db/model-tests";
import { getProvider } from "@/lib/providers/registry";
import { maskSecret } from "@/lib/crypto/secrets";
import { providerKeySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const userId = user?.id ?? (await getAnonymousUserId());
    return NextResponse.json({
      credentials: userId ? listProviderCredentials(userId) : [],
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const env = getEnv();
    enforceRateLimit(`key-save-ip:${getClientIp(request)}`, 20, 60_000);
    const body = providerKeySchema.parse(await readJson(request));
    const provider = getProvider(body.providerId);
    if (!provider) {
      return NextResponse.json(
        { error: { code: "unknown_provider", message: "Unknown provider." } },
        { status: 404 },
      );
    }
    if (!provider.requiresKey) {
      return NextResponse.json(
        {
          error: {
            code: "no_key_required",
            message: `${provider.name} does not require an API key.`,
          },
        },
        { status: 400 },
      );
    }

    // Saving and verifying are separate operations. Persist the key encrypted
    // and report only a masked hint. Verification happens on explicit request.
    const userId = user?.id ?? (await getOrCreateAnonymousUserId());
    enforceRateLimit(`key-save:${userId}`, 10, 60_000);
    saveProviderCredential(userId, provider.id, body.apiKey, {
      verified: false,
      models: [],
      error: null,
      keyHint: maskSecret(body.apiKey),
    });
    clearModelTestResults(userId, provider.id);
    const saved = getProviderCredentialRow(userId, provider.id);
    return NextResponse.json({
      ok: true,
      providerId: provider.id,
      keyHint: saved?.key_hint ?? maskSecret(body.apiKey),
      verified: false,
      status: "saved_unverified",
      verifiedModels: [],
      modelCount: 0,
      note: "Key saved but not verified. Press Verify to check it with the provider.",
      paidWarning:
        provider.paid && !env.allowPaidByok
          ? "This is a paid provider. Paid BYOK is disabled by the operator, so its models remain unavailable."
          : undefined,
    });
  } catch (error) {
    return jsonError(error);
  }
}
