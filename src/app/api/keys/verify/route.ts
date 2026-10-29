import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, enforceRateLimit, jsonError, readJson } from "@/lib/http/api";
import { getAnonymousUserId, getCurrentUser } from "@/lib/auth/session";
import { decryptProviderKey, getProviderCredentialRow, setProviderVerification } from "@/lib/db/credentials";
import { clearModelTestResults } from "@/lib/db/model-tests";
import { getProvider } from "@/lib/providers/registry";
import { safeVerificationError, verifyProviderKey } from "@/lib/providers/verify";
import { ProviderError } from "@/lib/providers/errors";

export const runtime = "nodejs";

const schema = z.object({ providerId: z.string().min(1).max(50) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const userId = user?.id ?? (await getAnonymousUserId());
    const { providerId } = schema.parse(await readJson(request));
    const provider = getProvider(providerId);
    if (!provider) {
      return NextResponse.json(
        { error: { code: "unknown_provider", message: "Unknown provider." } },
        { status: 404 },
      );
    }
    if (!userId) {
      return NextResponse.json(
        { error: { code: "key_missing", message: "No saved key for this provider." } },
        { status: 404 },
      );
    }
    enforceRateLimit(`key-verify:${userId}`, 10, 60_000);
    const row = getProviderCredentialRow(userId, providerId);
    if (!row) {
      return NextResponse.json(
        { error: { code: "key_missing", message: "No saved key for this provider." } },
        { status: 404 },
      );
    }
    const apiKey = decryptProviderKey(row);
    try {
      const verification = await verifyProviderKey(providerId, apiKey);
      setProviderVerification(userId, providerId, {
        verified: true,
        models: verification.models,
        error: null,
      });
      clearModelTestResults(userId, providerId);
      return NextResponse.json({
        ok: true,
        verifiedModels: verification.models,
        modelCount: verification.models.length,
      });
    } catch (error) {
      const message = safeVerificationError(error);
      setProviderVerification(userId, providerId, {
        verified: false,
        models: [],
        error: message,
      });
      clearModelTestResults(userId, providerId);
      if (error instanceof ProviderError) {
        return NextResponse.json(
          { error: { code: `provider_${error.code}`, message, details: error.details } },
          { status: 422 },
        );
      }
      return NextResponse.json(
        { error: { code: "verification_failed", message } },
        { status: 422 },
      );
    }
  } catch (error) {
    return jsonError(error);
  }
}
