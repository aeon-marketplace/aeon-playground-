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
import { getSettings, updateSettings } from "@/lib/db/settings";
import { getSelectableModels } from "@/lib/providers/runtime";
import { settingsSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const userId = user?.id ?? (await getAnonymousUserId());
    if (!userId) {
      return NextResponse.json({
        settings: { defaultModelRef: null, defaultSystemPrompt: "", updatedAt: 0 },
      });
    }
    return NextResponse.json({ settings: await getSettings(userId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    enforceRateLimit(`settings-ip:${getClientIp(request)}`, 30, 60_000);
    const body = settingsSchema.parse(await readJson(request));
    // Preferences can be saved without creating an account. The first valid
    // save creates the anonymous visitor session that owns them.
    const user = await getCurrentUser();
    const userId = user?.id ?? (await getOrCreateAnonymousUserId());
    enforceRateLimit(`settings:${userId}`, 20, 60_000);
    if (body.defaultModelRef) {
      const available = (await getSelectableModels(userId)).some(
        (model) =>
          model.ref === body.defaultModelRef && model.capabilities.includes("text"),
      );
      if (!available) {
        return NextResponse.json(
          {
            error: {
              code: "model_unavailable",
              message:
                "The default model must be a currently available text model for this session or account.",
            },
          },
          { status: 400 },
        );
      }
    }
    const settings = await updateSettings(userId, {
      defaultModelRef: body.defaultModelRef,
      defaultSystemPrompt: body.defaultSystemPrompt,
    });
    return NextResponse.json({ settings });
  } catch (error) {
    return jsonError(error);
  }
}
