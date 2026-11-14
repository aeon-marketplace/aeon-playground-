import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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
import { recordRunForViewer } from "@/lib/db/runs";
import {
  resolveModelTarget,
  runTargetChat,
  type ModelTarget,
} from "@/lib/providers/runtime";
import { compareSchema } from "@/lib/validation/schemas";
import { beginGeneration, type GenerationReservation } from "@/lib/usage/http";

export const runtime = "nodejs";

type CompareError = { code: string; message: string; details?: string };

type ResolvedEntry =
  | { ref: string; target: ModelTarget; error: null }
  | { ref: string; target: null; error: unknown };

export async function POST(request: Request) {
  let generation: GenerationReservation | null = null;
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const userId = user?.id ?? null;
    const env = getEnv();
    const isPublic = !userId || isAnonymousUserId(userId);
    enforceRateLimit(
      isPublic ? `compare:public:${getClientIp(request)}` : `compare:${userId}`,
      isPublic ? env.publicCompareRateLimitPerMinute : 10,
      60_000,
    );
    const body = compareSchema.parse(await readJson(request));
    const groupId = randomUUID();
    const messages = [
      ...(body.systemPrompt.trim()
        ? [{ role: "system" as const, content: body.systemPrompt.trim() }]
        : []),
      { role: "user" as const, content: body.prompt },
    ];

    // Resolve every model first so access/validation errors never consume the
    // visitor's allowance. Only models that can actually be called are counted.
    const resolved = await Promise.all<ResolvedEntry>(
      body.modelRefs.map(async (ref) => {
        try {
          return { ref, target: await resolveModelTarget(userId, ref), error: null };
        } catch (error) {
          return { ref, target: null, error };
        }
      }),
    );

    const activeTargets = resolved.flatMap((entry) => (entry.target ? [entry.target] : []));
    if (activeTargets.length === 0) {
      return NextResponse.json({
        groupId,
        results: await Promise.all(resolved.map((entry) => resolutionFailure(userId, groupId, body, entry))),
      });
    }

    // One generation slot per compared model, reserved atomically before any call.
    generation = await beginGeneration(request, {
      count: activeTargets.length,
    });

    const results = await Promise.all(
      resolved.map(async (entry) => {
        if (!entry.target) {
          return resolutionFailure(userId, groupId, body, entry);
        }
        const target = entry.target;
        try {
          const result = await runTargetChat(
            target,
            messages,
            body.temperature,
            body.maxTokens,
          );
          const runId = await recordRunForViewer(userId, {
            kind: "compare",
            groupId,
            modelRef: target.modelRef,
            providerId: target.providerId,
            modelId: target.modelId,
            prompt: body.prompt,
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
            systemPrompt: body.systemPrompt.trim() || null,
          });
          return {
            runId,
            modelRef: target.modelRef,
            providerId: target.providerId,
            providerName: target.providerName,
            modelId: target.modelId,
            accessType: target.accessType,
            status: "success" as const,
            output: result.text,
            latencyMs: result.latencyMs,
            usage: result.usage,
            usageAvailable: result.usageAvailable,
            requestId: result.requestId,
          };
        } catch (error) {
          const history = providerErrorForHistory(error);
          const { body: errorBody } = publicError(error);
          const runId = await recordRunForViewer(userId, {
            kind: "compare",
            groupId,
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
            systemPrompt: body.systemPrompt.trim() || null,
          });
          return {
            runId,
            modelRef: target.modelRef,
            providerId: target.providerId,
            providerName: target.providerName,
            modelId: target.modelId,
            accessType: target.accessType,
            status: "error" as const,
            error: {
              code: errorBody.error.code,
              message: errorBody.error.message,
              details: errorBody.error.details,
            },
          };
        }
      }),
    );

    return NextResponse.json({
      groupId,
      results,
      dailyUsage: await generation.commit(
        results.filter((result) => result.status === "success").length,
      ),
    });
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

async function resolutionFailure(
  userId: string | null,
  groupId: string,
  body: { prompt: string; systemPrompt: string },
  entry: { ref: string; error: unknown },
) {
  const { body: errorBody } = publicError(entry.error);
  const compareError: CompareError = {
    code: errorBody.error.code,
    message: errorBody.error.message,
    details: errorBody.error.details,
  };
  await recordRunForViewer(userId, {
    kind: "compare",
    groupId,
    modelRef: entry.ref,
    providerId: entry.ref.split("::")[0] || "unknown",
    modelId: entry.ref.split("::").slice(1).join("::") || "unknown",
    prompt: body.prompt,
    status: "error",
    errorCode: compareError.code,
    errorMessage: compareError.message,
    usageAvailable: false,
    systemPrompt: body.systemPrompt.trim() || null,
  });
  return {
    modelRef: entry.ref,
    providerId: "unknown",
    providerName: "Unavailable",
    modelId: entry.ref.split("::").slice(1).join("::") || entry.ref,
    status: "error" as const,
    error: compareError,
  };
}
