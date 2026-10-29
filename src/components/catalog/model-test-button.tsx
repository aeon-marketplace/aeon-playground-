"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { describeClientError, requestJson } from "@/lib/client/api";
import type { PlaygroundId } from "@/lib/providers/playground-support";
import { cn } from "@/lib/utils";

export default function ModelTestButton({
  modelRef,
  modelId,
  playground,
  canTest,
  disabledReason,
  className,
}: {
  modelRef: string;
  modelId: string;
  playground: PlaygroundId;
  canTest: boolean;
  disabledReason: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "green" | "red"; text: string } | null>(
    null,
  );

  async function testModel() {
    if (!canTest) return;
    setTesting(true);
    setFeedback(null);
    try {
      const result = await requestJson<{
        ok: boolean;
        operation: "chat" | "image";
        latencyMs: number;
        output?: string;
      }>("/api/models/test", {
        method: "POST",
        body: JSON.stringify({ modelRef, playground }),
      });
      setFeedback({
        tone: "green",
        text: `Real ${result.operation} request succeeded in ${result.latencyMs} ms.`,
      });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: "red", text: describeClientError(error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <span className={cn("inline-flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        onClick={testModel}
        disabled={!canTest || testing}
        className="btn btn-secondary"
        title={
          disabledReason ??
          "Make one real inference request against this exact model for the selected playground"
        }
        aria-label={
          canTest
            ? `Test ${modelId} for the selected playground`
            : `Test unavailable: ${disabledReason ?? "not available"}`
        }
      >
        {testing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FlaskConical className="h-4 w-4" />
        )}
        {testing ? "Testing…" : "Test inference"}
      </button>
      {feedback ? (
        <span
          className={cn(
            "max-w-xs rounded-lg border px-2.5 py-1.5 text-[11px] leading-5",
            feedback.tone === "green"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
              : "border-red-400/25 bg-red-400/10 text-red-200",
          )}
        >
          {feedback.text}
        </span>
      ) : null}
    </span>
  );
}
