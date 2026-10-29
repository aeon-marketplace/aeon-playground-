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
import { getEnv } from "@/lib/env";
import { ProviderError } from "@/lib/providers/errors";
import { resolveModelTarget, runTargetChat } from "@/lib/providers/runtime";
import { chatSchema } from "@/lib/validation/schemas";
import { recordRun, recordRunForViewer } from "@/lib/db/runs";
import { beginGeneration, type GenerationReservation } from "@/lib/usage/http";
import type { DailyUsage } from "@/lib/usage/policy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let userId: string | null = null;
  let prompt = "";
  let modelRef = "";
  let targetMeta = { providerId: "unknown", modelId: "unknown" };
  let dailyUsage: DailyUsage | null = null;
  let generation: GenerationReservation | null = null;
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    userId = user?.id ?? null;
    const env = getEnv();
    const isPublic = !userId || isAnonymousUserId(userId);
    enforceRateLimit(
      isPublic ? `chat:public:${getClientIp(request)}` : `chat:${userId}`,
      isPublic ? env.publicChatRateLimitPerMinute : env.chatRateLimitPerMinute,
      60_000,
    );
    const body = chatSchema.parse(await readJson(request));
    modelRef = body.modelRef;
    prompt = body.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
    const systemPrompt =
      body.messages.filter((message) => message.role === "system").map((m) => m.content).join("\n\n") ||
      null;
    const target = await resolveModelTarget(userId, body.modelRef);
    targetMeta = { providerId: target.providerId, modelId: target.modelId };

    // Reserve after validation/model resolution and before the provider call.
    generation = await beginGeneration(request);
    dailyUsage = generation.usage;

    try {
      const result = await runTargetChat(
        target,
        body.messages,
        body.temperature,
        body.maxTokens,
        request.signal,
      );
      dailyUsage = generation.commit();
      const runId = recordRunForViewer(userId, {
        kind: "chat",
        modelRef: target.modelRef,
        providerId: target.providerId,
        modelId: target.modelId,
        prompt,
        output: result.text,
        status: "success",
        latencyMs: result.latencyMs,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        usageAvailable: result.usageAvailable,
        providerRequestId: result.requestId,
        accessType: target.accessType,
        providerName: target.providerName,
        modelName: target.modelName,
        systemPrompt,
      });
      return NextResponse.json({
        runId,
        model: {
          ref: target.modelRef,
          providerId: target.providerId,
          providerName: target.providerName,
          modelId: target.modelId,
          kind: target.kind,
        },
        output: result.text,
        latencyMs: result.latencyMs,
        usage: result.usage,
        usageAvailable: result.usageAvailable,
        finishReason: result.finishReason,
        requestId: result.requestId,
        dailyUsage,
      });
    } catch (error) {
      generation.release();
      dailyUsage = generation.usage;
      const history = providerErrorForHistory(error);
      const runId = recordRunForViewer(userId, {
        kind: "chat",
        modelRef: target.modelRef,
        providerId: target.providerId,
        modelId: target.modelId,
        prompt,
        status: "error",
        errorCode: history.code,
        errorMessage: history.message,
        latencyMs: error instanceof ProviderError ? undefined : null,
        usageAvailable: false,
        accessType: target.accessType,
        providerName: target.providerName,
        modelName: target.modelName,
        systemPrompt,
      });
      const { status, body: errorBody } = publicError(error);
      return NextResponse.json({ ...errorBody, runId, dailyUsage }, { status });
    }
  } catch (error) {
    if (generation) {
      try {
        generation.release();
      } catch {
        // Never mask the original error if cleanup also fails.
      }
    }
    const rejectedByAllowance =
      error instanceof ApiError &&
      (error.code === "daily_limit_reached" || error.code === "duplicate_request");
    if (userId && !isAnonymousUserId(userId) && !rejectedByAllowance) {
      const history = providerErrorForHistory(error);
      try {
        recordRun({
          userId,
          kind: "chat",
          modelRef: modelRef || "unknown",
          providerId: targetMeta.providerId,
          modelId: targetMeta.modelId,
          prompt,
          status: "error",
          errorCode: history.code,
          errorMessage: history.message,
          usageAvailable: false,
        });
      } catch {
        // Never mask the original error if history logging also fails.
      }
    }
    return jsonError(error);
  }
}
