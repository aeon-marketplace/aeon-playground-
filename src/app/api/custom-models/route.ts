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
import {
  createCustomModel,
  getCustomModelRow,
  listCustomModels,
  setCustomModelVerification,
  toPublicCustomModel,
} from "@/lib/db/custom-models";
import { validateCustomBaseUrl } from "@/lib/security/endpoint";
import { safeVerificationError, verifyCustomEndpoint } from "@/lib/providers/verify";
import { customModelSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const userId = user?.id ?? (await getAnonymousUserId());
    return NextResponse.json({ models: userId ? await listCustomModels(userId) : [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceRateLimit(`custom-create-ip:${getClientIp(request)}`, 20, 60_000);
    const body = customModelSchema.parse(await readJson(request));
    const baseUrl = await validateCustomBaseUrl(body.baseUrl);
    // Custom endpoints are available without an account. The first successful
    // save creates the anonymous visitor session that owns the endpoint.
    const user = await getCurrentUser();
    const userId = user?.id ?? (await getOrCreateAnonymousUserId());
    enforceRateLimit(`custom-create:${userId}`, 10, 60_000);
    const id = await createCustomModel(userId, {
      name: body.name,
      baseUrl,
      modelId: body.modelId,
      apiKey: body.apiKey || undefined,
    });

    let verificationError: string | null = null;
    try {
      await verifyCustomEndpoint({
        baseUrl,
        modelId: body.modelId,
        apiKey: body.apiKey || undefined,
      });
      await setCustomModelVerification(userId, id, { verified: true, error: null });
    } catch (error) {
      verificationError = safeVerificationError(error);
      await setCustomModelVerification(userId, id, { verified: false, error: verificationError });
    }

    const row = await getCustomModelRow(userId, id);
    if (!row) {
      return NextResponse.json(
        { error: { code: "internal_error", message: "Custom model could not be saved." } },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        model: toPublicCustomModel(row),
        verified: row.verified === 1,
        verificationError,
        note:
          row.verified === 1
            ? "Saved and verified with a real chat-completion request."
            : "Saved, but the connection test failed. It is not selectable until verification succeeds.",
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
