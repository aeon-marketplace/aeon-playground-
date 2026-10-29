import { NextResponse } from "next/server";
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  jsonError,
  readJson,
} from "@/lib/http/api";
import { getCurrentUser } from "@/lib/auth/session";
import {
  decryptProviderKey,
  getProviderCredentialRow,
  setProviderVerification,
} from "@/lib/db/credentials";
import { getProvider } from "@/lib/providers/registry";
import { verifyPollinations } from "@/lib/providers/pollinations";
import { getOllamaDiscovery, clearOllamaCache } from "@/lib/providers/runtime";
import { safeVerificationError, verifyProviderKey } from "@/lib/providers/verify";
import { ProviderError } from "@/lib/providers/errors";
import { providerTestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    enforceRateLimit(
      user ? `provider-test:${user.id}` : `provider-test:public:${getClientIp(request)}`,
      user ? 12 : 6,
      60_000,
    );
    const body = providerTestSchema.parse(await readJson(request));
    const provider = getProvider(body.providerId);
    if (!provider) {
      return NextResponse.json(
        { error: { code: "unknown_provider", message: "Unknown provider." } },
        { status: 404 },
      );
    }

    if ((!user || user.isAnonymous) && provider.adapter === "ollama") {
      throw new ApiError(
        401,
        "operator_only",
        "Server-local Ollama testing is available to signed-in accounts only (public visitor sessions cannot use it).",
      );
    }

    if (!user && provider.requiresKey) {
      throw new ApiError(
        400,
        "needs_key",
        `Add and verify your own ${provider.name} API key in API Keys first. Anonymous sessions can do this without creating an account.`,
      );
    }

    if (provider.adapter === "ollama") {
      if (body.refresh) clearOllamaCache();
      const discovery = await getOllamaDiscovery({ force: true });
      if (!discovery.online) {
        return NextResponse.json({
          ok: false,
          providerId: provider.id,
          status: "offline",
          message:
            discovery.error ??
            "Ollama is not reachable. Install and start Ollama, then try again.",
          models: [],
          checkedAt: discovery.checkedAt,
          setupSteps: provider.setupSteps,
        });
      }
      return NextResponse.json({
        ok: true,
        providerId: provider.id,
        status: "online",
        message:
          discovery.models.length > 0
            ? `Ollama is running with ${discovery.models.length} installed model${discovery.models.length === 1 ? "" : "s"}.`
            : "Ollama is running, but no models are installed yet. Run `ollama pull llama3.2`.",
        models: discovery.models,
        checkedAt: discovery.checkedAt,
        setupSteps: provider.setupSteps,
      });
    }

    if (!provider.requiresKey) {
      try {
        const verification = await verifyPollinations();
        return NextResponse.json({
          ok: true,
          providerId: provider.id,
          status: "available",
          message: `Reached the keyless endpoint. ${verification.models.length} model IDs were listed.`,
          modelCount: verification.models.length,
          verifiedModels: verification.models,
          checkedAt: verification.checkedAt,
        });
      } catch (error) {
        return NextResponse.json(
          {
            ok: false,
            providerId: provider.id,
            status: "error",
            message: safeVerificationError(error),
          },
          { status: 200 },
        );
      }
    }

    if (!user) {
      throw new ApiError(
        400,
        "needs_key",
        "Add and verify your own provider key in API Keys first. Anonymous sessions can do this without creating an account.",
      );
    }

    const row = getProviderCredentialRow(user.id, provider.id);
    if (!row) {
      return NextResponse.json(
        {
          ok: false,
          providerId: provider.id,
          status: "needs_key",
          message: `Add and verify your ${provider.name} API key on the API Keys page first.`,
        },
        { status: 200 },
      );
    }

    try {
      const apiKey = decryptProviderKey(row);
      const verification = await verifyProviderKey(provider.id, apiKey);
      setProviderVerification(user.id, provider.id, {
        verified: true,
        models: verification.models,
        error: null,
      });
      return NextResponse.json({
        ok: true,
        providerId: provider.id,
        status: "connected",
        message: `Connection test passed. ${verification.models.length} model IDs returned for your key.`,
        verifiedModels: verification.models,
        modelCount: verification.models.length,
        checkedAt: verification.checkedAt,
      });
    } catch (error) {
      const message = safeVerificationError(error);
      setProviderVerification(user.id, provider.id, {
        verified: false,
        models: [],
        error: message,
      });
      return NextResponse.json({
        ok: false,
        providerId: provider.id,
        status: "failed",
        message,
        code: error instanceof ProviderError ? `provider_${error.code}` : "verification_failed",
      });
    }
  } catch (error) {
    return jsonError(error);
  }
}
