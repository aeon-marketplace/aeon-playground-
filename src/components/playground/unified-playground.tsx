"use client";

import { useEffect, useState } from "react";
import { Image as ImageIcon, MessageSquare } from "lucide-react";
import ImagePlayground, {
  type ImageRecord,
} from "@/components/playground/image-playground";
import TextPlayground from "@/components/playground/text-playground";
import { PageHeader } from "@/components/ui";
import type { SelectableModel } from "@/lib/providers/runtime";
import type { DailyUsage } from "@/lib/usage/policy";
import { cn } from "@/lib/utils";

export type PlaygroundTask = "text" | "image";

const TASKS = [
  {
    id: "text",
    label: "Text Generation",
    icon: MessageSquare,
    description: "Chat with a compatible text model",
  },
  {
    id: "image",
    label: "Image Generation",
    icon: ImageIcon,
    description: "Create an image from a prompt",
  },
] as const;

export default function UnifiedPlayground({
  textModels,
  imageModels,
  defaultTextRef,
  defaultImageRef,
  defaultSystemPrompt,
  initialImages,
  isAuthenticated,
  initialUsage,
  initialTask = "text",
  requestedRef = null,
  requestedTextError = null,
  requestedImageError = null,
}: {
  textModels: SelectableModel[];
  imageModels: SelectableModel[];
  defaultTextRef: string | null;
  defaultImageRef: string | null;
  defaultSystemPrompt: string;
  initialImages: ImageRecord[];
  isAuthenticated: boolean;
  initialUsage: DailyUsage;
  initialTask?: PlaygroundTask;
  requestedRef?: string | null;
  requestedTextError?: string | null;
  requestedImageError?: string | null;
}) {
  const [task, setTask] = useState<PlaygroundTask>(initialTask);
  // One counter for both task views: text, image, comparison, and model-test
  // requests all reserve from the same server-side daily allowance.
  const [usage, setUsage] = useState<DailyUsage>(initialUsage);

  useEffect(() => {
    if (isAuthenticated) return;
    // Establish the anonymous visitor cookie once for the whole page. Both task
    // views are mounted, so this must not run per view.
    void fetch("/api/anon-session", { method: "POST" }).catch(() => {});
  }, [isAuthenticated]);

  function selectTask(next: PlaygroundTask) {
    setTask(next);
    // Keep the URL shareable without a navigation or server render, so mounted
    // results and the selected model survive the switch.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("task", next);
      url.searchParams.delete("ref");
      window.history.replaceState(null, "", url);
    } catch {
      // Ignore environments where history is unavailable.
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="One workbench · two modes"
        title="Playground"
        description={
          isAuthenticated
            ? "Generate text or images with the exact model you choose. Provider and model selectors update with the task, results stay in place when you switch, and every request counts toward one shared daily allowance."
            : "Generate text or images without an account using public free models, or connect your own provider key. Choose a task, provider, and model; results stay in place when you switch tasks. No silent fallback to a different model."
        }
        actions={
          <div
            role="tablist"
            aria-label="Generation task"
            className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1"
          >
            {TASKS.map((entry) => {
              const Icon = entry.icon;
              const selected = entry.id === task;
              const available =
                entry.id === "text" ? textModels.length > 0 : imageModels.length > 0;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`playground-panel-${entry.id}`}
                  id={`playground-tab-${entry.id}`}
                  title={`${entry.description}${available ? "" : " — no model available"}`}
                  onClick={() => selectTask(entry.id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                    selected
                      ? "bg-blue-500/15 text-blue-200 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)]"
                      : "text-slate-400 hover:text-slate-200",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {entry.label}
                  {!available ? (
                    <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">
                      empty
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        }
      />

      <div
        role="tabpanel"
        id="playground-panel-text"
        aria-labelledby="playground-tab-text"
        className={task === "text" ? "" : "hidden"}
      >
        <TextPlayground
          key={requestedRef ?? defaultTextRef ?? "no-text-model"}
          models={textModels}
          defaultModelRef={defaultTextRef}
          defaultSystemPrompt={defaultSystemPrompt}
          isAuthenticated={isAuthenticated}
          usage={usage}
          onUsageChange={setUsage}
          requestedError={requestedTextError}
        />
      </div>

      <div
        role="tabpanel"
        id="playground-panel-image"
        aria-labelledby="playground-tab-image"
        className={task === "image" ? "" : "hidden"}
      >
        <ImagePlayground
          key={requestedRef ?? defaultImageRef ?? "no-image-model"}
          models={imageModels}
          defaultModelRef={defaultImageRef}
          initialImages={initialImages}
          isAuthenticated={isAuthenticated}
          usage={usage}
          onUsageChange={setUsage}
          requestedError={requestedImageError}
        />
      </div>
    </div>
  );
}
