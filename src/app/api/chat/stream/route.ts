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
import { resolveModelTarget, runTargetChatStream } from "@/lib/providers/runtime";
import { chatSchema } from "@/lib/validation/schemas";
import { beginGeneration } from "@/lib/usage/http";
import type { DailyUsage } from "@/lib/usage/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StreamEvent =
  | { event: "meta"; data: Record<string, unknown> }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: Record<string, unknown> }
  | {
      event: "error";
      data: { code: string; message: string; runId?: string; dailyUsage?: DailyUsage };
    };

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const userId = user?.id ?? null;
    const env = getEnv();
    const isPublic = !userId || isAnonymousUserId(userId);
    enforceRateLimit(
      isPublic ? `chat-stream:public:${getClientIp(request)}` : `chat-stream:${userId}`,
      isPublic ? env.publicChatRateLimitPerMinute : env.chatRateLimitPerMinute,
      60_000,
    );
    const body = chatSchema.parse(await readJson(request));

    const prompt =
      body.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
    const systemPrompt =
      body.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n") || null;

    // Resolve before opening the stream so access errors are normal JSON responses.
    const target = await resolveModelTarget(userId, body.modelRef);
    // Reserve after validation/model resolution, before the provider call.
    const generation = await beginGeneration(request);
    const dailyUsage = generation.usage;

    const encoder = new TextEncoder();
    const send = (
      controller: ReadableStreamDefaultController<Uint8Array>,
      event: StreamEvent,
    ): void => {
      controller.enqueue(encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`));
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const emit = (event: StreamEvent) => {
          if (closed) return;
          try {
            send(controller, event);
          } catch {
            closed = true;
          }
        };

        emit({
          event: "meta",
          data: {
            modelRef: target.modelRef,
            providerId: target.providerId,
            providerName: target.providerName,
            modelId: target.modelId,
            modelName: target.modelName,
            accessType: target.accessType,
            kind: target.kind,
            streaming: true,
            dailyUsage,
          },
        });

        try {
          const result = await runTargetChatStream(
            target,
            body.messages,
            body.temperature,
            body.maxTokens,
            (text) => emit({ event: "delta", data: { text } }),
            request.signal,
          );
          const completedUsage = generation.commit();
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
          emit({
            event: "done",
            data: {
              runId,
              latencyMs: result.latencyMs,
              usage: result.usage,
              usageAvailable: result.usageAvailable,
              finishReason: result.finishReason,
              requestId: result.requestId,
              dailyUsage: completedUsage,
            },
          });
        } catch (error) {
          generation.release();
          const history = providerErrorForHistory(error);
          const { body: errorBody } = publicError(error);
          let runId: string | undefined;
          try {
            runId = recordRunForViewer(userId, {
              kind: "chat",
              modelRef: target.modelRef,
              providerId: target.providerId,
              modelId: target.modelId,
              prompt,
              status: "error",
              errorCode: history.code,
              errorMessage: history.message,
              usageAvailable: false,
              accessType: target.accessType,
              providerName: target.providerName,
              modelName: target.modelName,
              systemPrompt,
            });
          } catch {
            // History logging must never mask the streaming error.
          }
          emit({
            event: "error",
            data: {
              code: errorBody.error.code,
              message: errorBody.error.message,
              runId,
              dailyUsage: generation.usage,
            },
          });
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed or cancelled by the client.
          }
        }
      },
      cancel() {
        // The client disconnected. The request signal aborts the provider call.
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
