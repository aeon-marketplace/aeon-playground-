import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  enforceRateLimit,
  jsonError,
  readJson,
  requireApiUser,
} from "@/lib/http/api";
import {
  decryptCustomKey,
  deleteCustomModel,
  getCustomModelRow,
  setCustomModelVerification,
  toPublicCustomModel,
  updateCustomModel,
} from "@/lib/db/custom-models";
import { safeVerificationError, verifyCustomEndpoint } from "@/lib/providers/verify";
import { validateCustomBaseUrl } from "@/lib/security/endpoint";
import { customModelUpdateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const deleted = deleteCustomModel(user.id, id);
    if (!deleted) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Custom model not found." } },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    enforceRateLimit(`custom-edit:${user.id}`, 10, 60_000);
    const { id } = await context.params;
    const existing = getCustomModelRow(user.id, id);
    if (!existing) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Custom model not found." } },
        { status: 404 },
      );
    }
    const body = customModelUpdateSchema.parse(await readJson(request));
    const baseUrl = await validateCustomBaseUrl(body.baseUrl);
    const updated = updateCustomModel(user.id, id, {
      name: body.name,
      baseUrl,
      modelId: body.modelId,
      apiKey: body.apiKey || undefined,
      clearApiKey: body.clearApiKey,
    });
    if (!updated) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Custom model not found." } },
        { status: 404 },
      );
    }

    let verificationError: string | null = null;
    try {
      const row = getCustomModelRow(user.id, id);
      if (!row) {
        return NextResponse.json(
          { error: { code: "internal_error", message: "Custom model could not be reloaded." } },
          { status: 500 },
        );
      }
      await verifyCustomEndpoint({
        baseUrl,
        modelId: body.modelId,
        apiKey: decryptCustomKey(row),
      });
      setCustomModelVerification(user.id, id, { verified: true, error: null });
    } catch (error) {
      verificationError = safeVerificationError(error);
      setCustomModelVerification(user.id, id, { verified: false, error: verificationError });
    }

    const row = getCustomModelRow(user.id, id);
    return NextResponse.json({
      ok: true,
      model: row ? toPublicCustomModel(row) : null,
      verified: row?.verified === 1,
      verificationError,
      note:
        row?.verified === 1
          ? "Changes saved and the endpoint was verified with a real chat-completion request."
          : "Changes saved, but the connection test failed. It is not selectable until verification succeeds.",
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    enforceRateLimit(`custom-verify:${user.id}`, 10, 60_000);
    const { id } = await context.params;
    const row = getCustomModelRow(user.id, id);
    if (!row) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Custom model not found." } },
        { status: 404 },
      );
    }
    const baseUrl = await validateCustomBaseUrl(row.base_url);
    try {
      await verifyCustomEndpoint({
        baseUrl,
        modelId: row.model_id,
        apiKey: decryptCustomKey(row),
      });
      setCustomModelVerification(user.id, id, { verified: true, error: null });
      const updated = getCustomModelRow(user.id, id);
      return NextResponse.json({
        ok: true,
        model: updated ? toPublicCustomModel(updated) : null,
      });
    } catch (error) {
      const message = safeVerificationError(error);
      setCustomModelVerification(user.id, id, { verified: false, error: message });
      return NextResponse.json(
        { error: { code: "verification_failed", message } },
        { status: 422 },
      );
    }
  } catch (error) {
    return jsonError(error);
  }
}
