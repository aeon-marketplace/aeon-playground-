import { NextResponse } from "next/server";
import {
  ApiError,
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
import { saveModelTestResult } from "@/lib/db/model-tests";
import {
  isCompatibleWithPlayground,
  operationForPlayground,
  playgroundOperation,
  resolveModelTarget,
  runTargetChat,
  runTargetImage,
} from "@/lib/providers/runtime";
import { modelTestSchema } from "@/lib/validation/schemas";
import { beginGeneration, type GenerationReservation } from "@/lib/usage/http";
import type { DailyUsage } from "@/lib/usage/policy";

export const runtime = "nodejs";

const TEST_PROMPT = "Reply with exactly: PLAYGROUND_OK";
const TEST_TIMEOUT_MS = 60_000;

export async function POST(request: Request) {
  let userId: string | null = null;
  let modelRef = "";
  let dailyUsage: DailyUsage | null = null;
  let generation: GenerationReservation | null = null;
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    userId = user?.id ?? null;
    const isPublic = !userId || isAnonymousUserId(userId);
    enforceRateLimit(
      isPublic ? `model-test:public:${getClientIp(request)}` : `model-test:${userId}`,
      isPublic ? 5 : 10,
      60_000,
    );
    const body = modelTestSchema.parse(await readJson(request));
    modelRef = body.modelRef;
    const target = await resolveModelTarget(userId, modelRef);
    if (
      body.playground &&
      !isCompatibleWithPlayground(target.providerId, target.capabilities, body.playground)
    ) {
      return NextResponse.json(
        {
          error: {
            code: "unsupported_model",
            message:
              "UNSUPPORTED FOR THIS PLAYGROUND. No incompatible provider request was made.",
          },
        },
        { status: 400 },
      );
    }
    const operation = body.playground
      ? operationForPlayground(body.playground)
      : playgroundOperation(target.providerId, target.capabilities);
    if (!operation) {
      return NextResponse.json(
        {
          error: {
            code: "unsupported_model",
            message:
              "This app does not implement this model's input or output type. No provider request was made.",
          },
        },
        { status: 400 },
      );
    }

    // Connection tests consume the same visitor allowance as playground runs.
    generation = await beginGeneration(request);
    dailyUsage = generation.usage;

    if (operation === "chat") {
      const result = await runTargetChat(
        target,
        [{ role: "user", content: TEST_PROMPT }],
        0,
        512,
        AbortSignal.timeout(TEST_TIMEOUT_MS),
      );
      dailyUsage = await generation.commit();
      if (userId) {
        await saveModelTestResult(userId, target.modelRef, {
          status: "success",
          errorCode: null,
          errorMessage: null,
          latencyMs: result.latencyMs,
        });
      }
      return NextResponse.json({
        ok: true,
        modelRef: target.modelRef,
        providerId: target.providerId,
        modelId: target.modelId,
        operation,
        latencyMs: result.latencyMs,
        output: result.text.slice(0, 200),
        usage: result.usage,
        finishReason: result.finishReason,
        providerModelId: result.providerModelId,
        dailyUsage,
      });
    }

    const result = await runTargetImage(target, {
      prompt: "A small solid green square, flat vector icon, no text",
      width: 512,
      height: 512,
      // Pollinations caches by URL. A fresh seed ensures this is a real
      // generation attempt rather than a cached image from an earlier test.
      seed: Math.floor(Math.random() * 2_147_483_647),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    dailyUsage = await generation.commit();
    if (userId) {
      await saveModelTestResult(userId, target.modelRef, {
        status: "success",
        errorCode: null,
        errorMessage: null,
        latencyMs: result.latencyMs,
      });
    }
    return NextResponse.json({
      ok: true,
      modelRef: target.modelRef,
      providerId: target.providerId,
      modelId: target.modelId,
      operation,
      latencyMs: result.latencyMs,
      bytes: result.bytes.byteLength,
      contentType: result.contentType,
      dailyUsage,
    });
  } catch (error) {
    if (generation) {
      try {
        await generation.release();
      } catch {
        // Never mask the original error if cleanup also fails.
      }
      dailyUsage = generation.usage;
    }
    const rejectedByAllowance =
      error instanceof ApiError &&
      (error.code === "daily_limit_reached" || error.code === "duplicate_request");
    const history = providerErrorForHistory(error);
    if (userId && modelRef && !rejectedByAllowance) {
      try {
        await saveModelTestResult(userId, modelRef, {
          status: "error",
          errorCode: history.code,
          errorMessage: history.message,
          latencyMs: null,
        });
      } catch {
        // Testing must still return the provider error if persistence fails.
      }
    }
    if (dailyUsage) {
      const { status, body } = publicError(error);
      const response = NextResponse.json({ ...body, dailyUsage }, { status });
      if (body.error.retryAfterSeconds) {
        response.headers.set("retry-after", String(body.error.retryAfterSeconds));
      }
      return response;
    }
    return jsonError(error);
  }
}
