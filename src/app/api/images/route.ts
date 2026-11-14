import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  jsonError,
  providerErrorForHistory,
  publicError,
  readJson,
} from "@/lib/http/api";
import { getCurrentUser } from "@/lib/auth/session";
import { isAnonymousUserId } from "@/lib/auth/ids";
import { getEnv } from "@/lib/env";
import { getRegistryModel } from "@/lib/providers/registry";
import { resolveModelTarget, runTargetImage } from "@/lib/providers/runtime";
import { recordRunForViewer } from "@/lib/db/runs";
import { saveImage } from "@/lib/images/storage";
import { imageSchema } from "@/lib/validation/schemas";
import { beginGeneration, type GenerationReservation } from "@/lib/usage/http";
import type { DailyUsage } from "@/lib/usage/policy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let dailyUsage: DailyUsage | null = null;
  let generation: GenerationReservation | null = null;
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const userId = user?.id ?? null;
    const env = getEnv();
    const isPublic = !userId || isAnonymousUserId(userId);
    enforceRateLimit(
      isPublic ? `image:public:${getClientIp(request)}` : `image:${userId}`,
      isPublic ? env.publicImageRateLimitPerMinute : 5,
      60_000,
    );
    const body = imageSchema.parse(await readJson(request));

    const registryModel = getRegistryModel(body.modelRef);
    if (
      !registryModel ||
      registryModel.paid ||
      !registryModel.capabilities.includes("image") ||
      registryModel.verification.state !== "verified" ||
      registryModel.providerId !== "pollinations"
    ) {
      return NextResponse.json(
        {
          error: {
            code: "image_model_unavailable",
            message:
              "Image generation is only enabled for live-verified Pollinations image models. No image request was made.",
          },
        },
        { status: 400 },
      );
    }

    const target = await resolveModelTarget(userId, body.modelRef);
    // Reserve after validation/model resolution, before the provider call.
    generation = await beginGeneration(request);
    dailyUsage = generation.usage;
    // Anonymous visitors keep generated images in the browser (data URL), not
    // on the server filesystem or in the server-side history database.
    const persist = Boolean(userId && !isAnonymousUserId(userId));
    try {
      const image = await runTargetImage(target, {
        prompt: body.prompt,
        width: body.width,
        height: body.height,
        seed: body.seed,
        signal: request.signal,
      });
      const filename = persist ? await saveImage(image.bytes, image.contentType) : null;
      dailyUsage = await generation.commit();
      const runId = await recordRunForViewer(userId, {
        kind: "image",
        modelRef: target.modelRef,
        providerId: target.providerId,
        modelId: target.modelId,
        prompt: body.prompt,
        status: "success",
        latencyMs: image.latencyMs,
        usageAvailable: false,
        imagePath: filename,
        accessType: target.accessType,
        providerName: target.providerName,
        modelName: target.modelName,
        imageWidth: body.width,
        imageHeight: body.height,
      });
      const url = persist
        ? `/api/images/${runId}`
        : `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
      return NextResponse.json({
        runId,
        url,
        width: body.width,
        height: body.height,
        latencyMs: image.latencyMs,
        modelRef: target.modelRef,
        dailyUsage,
      });
    } catch (error) {
      await generation.release();
      dailyUsage = generation.usage;
      const history = providerErrorForHistory(error);
      const runId = await recordRunForViewer(userId, {
        kind: "image",
        modelRef: target.modelRef,
        providerId: target.providerId,
        modelId: target.modelId,
        prompt: body.prompt,
        status: "error",
        errorCode: history.code,
        errorMessage: history.message,
        usageAvailable: false,
        accessType: target.accessType,
        providerName: target.providerName,
        modelName: target.modelName,
        imageWidth: body.width,
        imageHeight: body.height,
      });
      const { status, body: errorBody } = publicError(error);
      return NextResponse.json({ ...errorBody, runId, dailyUsage }, { status });
    }
  } catch (error) {
    if (generation) {
      try {
        await generation.release();
      } catch {
        // Never mask the original error if cleanup also fails.
      }
    }
    return jsonError(error);
  }
}
