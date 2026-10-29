"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  Check,
  Clipboard,
  Download,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { ProviderMark, SimpleAccessBadge } from "@/components/access";
import { Alert, Card, EmptyState, FieldLabel } from "@/components/ui";
import { describeClientError } from "@/lib/client/api";
import { appendLocalRun } from "@/lib/client/local-history";
import type { AccessType } from "@/lib/providers/types";
import type { SelectableModel } from "@/lib/providers/runtime";
import { dailyUsageCounter, DAILY_LIMIT_MESSAGE, type DailyUsage } from "@/lib/usage/policy";
import { formatDuration } from "@/lib/utils";

export type ImageRecord = {
  runId: string;
  url: string;
  width: number;
  height: number;
  latencyMs: number | null;
  prompt: string;
  modelName: string;
  accessType?: AccessType | null;
  seed?: number | null;
};

type ImageResponse = {
  runId: string;
  url: string;
  width: number;
  height: number;
  latencyMs: number;
  modelRef: string;
  dailyUsage?: DailyUsage;
};

type UiError = { message: string; code?: string; details?: string };

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const RATIOS = [
  { label: "1:1 square", width: 512, height: 512 },
  { label: "4:3 landscape", width: 768, height: 576 },
  { label: "3:4 portrait", width: 576, height: 768 },
  { label: "16:9 wide", width: 1024, height: 576 },
  { label: "9:16 tall", width: 576, height: 1024 },
];

const PROMPT_IDEAS = [
  "A brutalist observatory on a mossy cliff at dawn, volumetric fog, cinematic",
  "Isometric cutaway of a cozy programmer workspace, warm lamps, tiny plants",
  "Abstract emerald and charcoal fluid simulation, high detail, studio lighting",
  "Retro terminal interface floating in a dark forest, fireflies, soft glow",
];

export default function ImagePlayground({
  models,
  defaultModelRef,
  initialImages,
  isAuthenticated,
  usage,
  onUsageChange,
  requestedError = null,
}: {
  models: SelectableModel[];
  defaultModelRef: string | null;
  initialImages: ImageRecord[];
  isAuthenticated: boolean;
  usage: DailyUsage;
  onUsageChange: (usage: DailyUsage) => void;
  requestedError?: string | null;
}) {
  const imageModels = models.filter((model) => model.capabilities.includes("image"));
  const [modelRef, setModelRef] = useState(defaultModelRef ?? imageModels[0]?.ref ?? "");
  const [requestedBlock, setRequestedBlock] = useState(Boolean(requestedError));
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [ratioIndex, setRatioIndex] = useState(0);
  const [customWidth, setCustomWidth] = useState(512);
  const [customHeight, setCustomHeight] = useState(512);
  const [useCustomSize, setUseCustomSize] = useState(false);
  const [seed, setSeed] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [images, setImages] = useState<ImageRecord[]>(initialImages);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const exhausted = usage.exhausted;
  const [lastRequest, setLastRequest] = useState<{
    prompt: string;
    seed?: number;
    width: number;
    height: number;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const selected = imageModels.find((model) => model.ref === modelRef) ?? imageModels[0] ?? null;

  const width = useCustomSize ? customWidth : RATIOS[ratioIndex]!.width;
  const height = useCustomSize ? customHeight : RATIOS[ratioIndex]!.height;
  const supportsSeed = selected ? selected.parameters.includes("seed") : false;
  const supportsNegative = Boolean(selected && selected.parameters.includes("negative_prompt"));

  function applyDailyUsage(value: unknown) {
    const candidate = value as Partial<DailyUsage> | null | undefined;
    if (
      candidate &&
      typeof candidate.limit === "number" &&
      typeof candidate.used === "number" &&
      typeof candidate.remaining === "number" &&
      typeof candidate.exhausted === "boolean"
    ) {
      onUsageChange(candidate as DailyUsage);
    }
  }

  function readSeed(): number | undefined | null {
    if (!seed.trim()) return undefined;
    const parsed = Number(seed);
    if (!Number.isInteger(parsed) || parsed < 0) return null;
    return parsed;
  }

  function recordLocalImage(args: {
    runId?: string;
    prompt: string;
    width: number;
    height: number;
    status: "success" | "error";
    latencyMs?: number | null;
    imageUrl?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }) {
    if (isAuthenticated || !selected) return;
    appendLocalRun({
      id: args.runId,
      kind: "image",
      modelRef: selected.ref,
      providerId: selected.providerId,
      modelId: selected.modelId,
      prompt: args.prompt,
      output: null,
      status: args.status,
      latencyMs: args.latencyMs ?? null,
      usageAvailable: false,
      accessType: selected.accessType,
      providerName: selected.providerName,
      modelName: selected.name,
      imageWidth: args.width,
      imageHeight: args.height,
      imageUrl: args.imageUrl ?? null,
      errorCode: args.errorCode ?? null,
      errorMessage: args.errorMessage ?? null,
    });
  }

  async function generate(request?: { prompt: string; seed?: number; width: number; height: number }) {
    const effectivePrompt = (request?.prompt ?? prompt).trim();
    if (!effectivePrompt || loading || !selected || requestedBlock || exhausted) return;

    const parsedSeed = request ? request.seed : readSeed();
    if (parsedSeed === null) {
      setError({ message: "Seed must be a whole number of 0 or greater." });
      return;
    }
    const effectiveWidth = request?.width ?? width;
    const effectiveHeight = request?.height ?? height;

    setLoading(true);
    setError(null);
    setLastRequest({
      prompt: effectivePrompt,
      seed: parsedSeed,
      width: effectiveWidth,
      height: effectiveHeight,
    });
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = newRequestId();

    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": requestId },
        body: JSON.stringify({
          modelRef: selected.ref,
          prompt: effectivePrompt,
          negativePrompt: supportsNegative ? negativePrompt.trim() : "",
          count: 1,
          width: effectiveWidth,
          height: effectiveHeight,
          ...(parsedSeed !== undefined ? { seed: parsedSeed } : {}),
        }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as
        | ImageResponse
        | {
            error?: { code?: string; message?: string; details?: string };
            runId?: string;
            dailyUsage?: DailyUsage;
          }
        | null;
      if (!response.ok || !data || (data as { error?: unknown }).error) {
        const failed = data as
          | {
              error?: { code?: string; message?: string; details?: string };
              runId?: string;
              dailyUsage?: DailyUsage;
            }
          | null;
        applyDailyUsage(failed?.dailyUsage);
        const err = failed?.error;
        throw Object.assign(new Error(err?.message ?? "Image generation failed."), {
          code: err?.code,
          details: err?.details,
          runId: failed?.runId,
          dailyUsage: failed?.dailyUsage,
        });
      }
      const payload = data as ImageResponse;
      applyDailyUsage(payload.dailyUsage);
      recordLocalImage({
        runId: payload.runId,
        prompt: effectivePrompt,
        width: payload.width,
        height: payload.height,
        status: "success",
        latencyMs: payload.latencyMs,
        imageUrl: payload.url,
      });
      setImages((current) =>
        [
          {
            runId: payload.runId,
            url: payload.url,
            width: payload.width,
            height: payload.height,
            latencyMs: payload.latencyMs,
            prompt: effectivePrompt,
            modelName: selected.name,
            accessType: selected.accessType,
            seed: parsedSeed ?? null,
          },
          ...current,
        ].slice(0, 12),
      );
    } catch (caught) {
      if (controller.signal.aborted) {
        setError({ message: "Image generation cancelled.", code: "aborted" });
      } else {
        applyDailyUsage((caught as { dailyUsage?: DailyUsage } | null)?.dailyUsage);
        const described = describeClientError(caught);
        setError(described);
        const failed = caught as { runId?: string } | null;
        recordLocalImage({
          runId: failed?.runId,
          prompt: effectivePrompt,
          width: effectiveWidth,
          height: effectiveHeight,
          status: "error",
          errorCode: described.code ?? "request_failed",
          errorMessage: described.message,
        });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function retry() {
    if (!lastRequest || exhausted) return;
    void generate(lastRequest);
  }

  async function copyPrompt(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError({ message: "Clipboard access was blocked by the browser." });
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {requestedError && requestedBlock ? (
        <div className="lg:col-span-2">
          <Alert tone="amber" title="Requested model is not selectable">
            <div className="space-y-2">
              <p>{requestedError}</p>
              <p>
                The selector currently shows{" "}
                <strong>{selected?.name ?? "no image model"}</strong>. No image request has been
                made and no different model will be used automatically.
              </p>
              <button
                type="button"
                onClick={() => setRequestedBlock(false)}
                className="btn btn-secondary px-2.5 py-1 text-xs"
              >
                I understand — use the selector
              </button>
            </div>
          </Alert>
        </div>
      ) : null}
      <Card className="flex min-h-[560px] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {selected ? <ProviderMark icon={selected.providerIcon} name={selected.providerName} /> : null}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-white">
                  {selected?.name ?? "No image model"}
                </p>
                {selected ? <SimpleAccessBadge label={selected.playgroundLabel} /> : null}
              </div>
              <p className="truncate text-[11px] text-slate-500">
                {selected
                  ? selected.providerName
                  : "No compatible image model is available."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {lastRequest ? (
              <button
                type="button"
                onClick={retry}
                disabled={loading || exhausted}
                className="btn btn-ghost px-2.5 py-1.5 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            ) : null}
            {images.length > 0 ? (
              <button
                type="button"
                onClick={() => setImages([])}
                disabled={loading}
                className="btn btn-ghost px-2.5 py-1.5 text-xs"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear gallery
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          {error && error.code !== "daily_limit_reached" ? (
            <Alert
              tone={error.code === "aborted" ? "neutral" : "red"}
              title={error.code ? `Image failed (${error.code})` : "Image failed"}
              className="mb-4"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {error.message}
                  {error.details ? (
                    <span className="mt-1 block text-xs opacity-80">{error.details}</span>
                  ) : null}
                </span>
                {lastRequest && error.code !== "aborted" && !exhausted ? (
                  <button type="button" onClick={retry} className="btn btn-secondary px-2.5 py-1 text-xs">
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                ) : null}
              </span>
            </Alert>
          ) : null}

          {!selected ? (
            <EmptyState
              icon={<ImageIcon className="h-5 w-5" />}
              title="No selectable image model"
              action={
                <Link href="/models" className="btn btn-secondary">
                  Review the model catalog
                </Link>
              }
            >
              {isAuthenticated
                ? "No implemented image route is currently selectable. This app implements image generation only through its verified Pollinations route; paid, unsupported, and unavailable models stay in the catalog."
                : "No image model is enabled for public use. The deployment operator can enable a keyless verified image model with PUBLIC_MODEL_REFS."}
            </EmptyState>
          ) : null}

          {selected && images.length === 0 ? (
            <EmptyState icon={<Wand2 className="h-5 w-5" />} title="No images generated yet">
              {isAuthenticated
                ? "Describe an image, choose dimensions, and generate. The real provider file is stored privately for your account and linked from Test History."
                : "Describe an image, choose dimensions, and generate. The real provider image is returned directly to this browser and saved in local history."}
            </EmptyState>
          ) : null}

          {images.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {images.map((item, index) => (
                <figure key={item.runId} className="animate-fade-up">
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                    <Image
                      src={item.url}
                      alt={item.prompt}
                      width={item.width}
                      height={item.height}
                      unoptimized
                      className="h-auto max-h-[520px] w-full object-contain"
                    />
                  </div>
                  <figcaption className="mt-2 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
                      <span className="font-medium text-slate-300">
                        {index === 0 ? "Latest" : `Earlier #${index}`}
                      </span>
                      <span>
                        {item.width}×{item.height}
                      </span>
                      <span>{formatDuration(item.latencyMs)}</span>
                      {item.seed !== null && item.seed !== undefined ? <span>seed {item.seed}</span> : null}
                    </div>
                    <p className="line-clamp-2 text-[11px] leading-5 text-slate-500">{item.prompt}</p>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px]">
                      <a
                        href={item.url}
                        download={`image-${item.runId}.jpg`}
                        className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </a>
                      <button
                        type="button"
                        onClick={() => copyPrompt(item.prompt, item.runId)}
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-blue-200"
                      >
                        {copiedId === item.runId ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Clipboard className="h-3 w-3" />
                        )}
                        {copiedId === item.runId ? "Copied" : "Copy prompt"}
                      </button>
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      <aside className="order-first space-y-4 lg:order-last lg:sticky lg:top-6 lg:self-start">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-semibold text-white">Image request</h2>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
            className="space-y-3"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="image-provider">Provider</FieldLabel>
                <select
                  id="image-provider"
                  className="field"
                  value={selected?.providerId ?? ""}
                  onChange={(event) => {
                    const providerId = event.target.value;
                    const first = imageModels.find((model) => model.providerId === providerId);
                    if (first) {
                      setModelRef(first.ref);
                      setRequestedBlock(false);
                    }
                  }}
                  disabled={imageModels.length === 0}
                >
                  {Array.from(new Set(imageModels.map((model) => model.providerId))).map((providerId) => {
                    const providerName = imageModels.find((m) => m.providerId === providerId)?.providerName ?? providerId;
                    return (
                      <option key={providerId} value={providerId}>
                        {providerName}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <FieldLabel htmlFor="image-model">Model</FieldLabel>
                <select
                  id="image-model"
                  className="field"
                  value={selected?.ref ?? ""}
                  onChange={(event) => {
                    setModelRef(event.target.value);
                    setRequestedBlock(false);
                  }}
                  disabled={imageModels.length === 0}
                >
                  {imageModels
                    .filter((model) => (selected ? model.providerId === selected.providerId : true))
                    .map((model) => (
                      <option key={model.ref} value={model.ref}>
                        {model.name} — {model.playgroundLabel}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {selected ? (
              <div className="rounded-xl border border-white/8 bg-black/25 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-white">{selected.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {selected.providerName}
                    </p>
                  </div>
                  <SimpleAccessBadge label={selected.playgroundLabel} />
                </div>
                <Link
                  href={`/models/detail?ref=${encodeURIComponent(selected.ref)}&playground=image`}
                  className="mt-2 inline-flex text-[11px] text-blue-300 hover:text-blue-200"
                >
                  View catalog details
                </Link>
              </div>
            ) : null}

            <div>
              <FieldLabel htmlFor="image-prompt" hint={`${prompt.length}/2000`}>
                Prompt
              </FieldLabel>
              <textarea
                id="image-prompt"
                className="field min-h-[110px] resize-y"
                maxLength={2000}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the image: subject, style, lighting, composition"
                disabled={loading || !selected || exhausted}
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {PROMPT_IDEAS.map((idea, index) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => setPrompt(idea)}
                  className="rounded-full border border-white/10 bg-white/[0.02] px-2 py-0.5 text-[10px] text-slate-500 transition hover:border-blue-400/30 hover:text-blue-200"
                >
                  Idea {index + 1}
                </button>
              ))}
            </div>

            <div>
              <FieldLabel htmlFor="image-negative" hint={supportsNegative ? "optional" : "not supported"}>
                Negative prompt
              </FieldLabel>
              <textarea
                id="image-negative"
                className="field min-h-[60px] resize-y"
                value={negativePrompt}
                onChange={(event) => setNegativePrompt(event.target.value)}
                placeholder={supportsNegative ? "Things to avoid" : "Not supported by this model"}
                disabled={!supportsNegative || loading}
              />
            </div>

            <div>
              <FieldLabel htmlFor="image-ratio" hint={useCustomSize ? "custom" : `${width}×${height}`}>
                Aspect ratio
              </FieldLabel>
              <select
                id="image-ratio"
                className="field"
                value={useCustomSize ? "custom" : String(ratioIndex)}
                onChange={(event) => {
                  if (event.target.value === "custom") {
                    setUseCustomSize(true);
                  } else {
                    setUseCustomSize(false);
                    setRatioIndex(Number(event.target.value));
                  }
                }}
                disabled={loading}
              >
                {RATIOS.map((ratio, index) => (
                  <option key={ratio.label} value={index}>
                    {ratio.label} · {ratio.width}×{ratio.height}
                  </option>
                ))}
                <option value="custom">Custom size</option>
              </select>
            </div>

            {useCustomSize ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel htmlFor="image-width" hint="256–1024">
                    Width
                  </FieldLabel>
                  <input
                    id="image-width"
                    type="number"
                    min={256}
                    max={1024}
                    step={64}
                    value={customWidth}
                    onChange={(event) =>
                      setCustomWidth(Math.min(1024, Math.max(256, Number(event.target.value) || 256)))
                    }
                    className="field"
                    disabled={loading}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="image-height" hint="256–1024">
                    Height
                  </FieldLabel>
                  <input
                    id="image-height"
                    type="number"
                    min={256}
                    max={1024}
                    step={64}
                    value={customHeight}
                    onChange={(event) =>
                      setCustomHeight(Math.min(1024, Math.max(256, Number(event.target.value) || 256)))
                    }
                    className="field"
                    disabled={loading}
                  />
                </div>
              </div>
            ) : null}

            <div>
              <FieldLabel htmlFor="image-seed" hint={supportsSeed ? "optional" : "unsupported"}>
                Seed
              </FieldLabel>
              <input
                id="image-seed"
                className="field"
                inputMode="numeric"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                placeholder="e.g. 1234"
                disabled={loading || !supportsSeed}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className={exhausted ? "font-medium text-amber-300" : "font-medium text-slate-400"}>
                {dailyUsageCounter(usage)}
              </span>
              <span className="text-slate-600">Shared text + image allowance</span>
            </div>
            {exhausted ? (
              <Alert tone="amber" title="Daily limit reached">
                {DAILY_LIMIT_MESSAGE}
              </Alert>
            ) : null}

            {loading ? (
              <button type="button" onClick={cancel} className="btn btn-danger w-full">
                <Square className="h-4 w-4" />
                Cancel generation
              </button>
            ) : (
              <button
                type="submit"
                disabled={!selected || !prompt.trim() || requestedBlock || exhausted}
                className="btn btn-primary w-full"
              >
                <Wand2 className="h-4 w-4" />
                Generate image
              </button>
            )}
            {loading ? (
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Waiting for {selected?.providerName ?? "provider"}; image requests can take up to 60–120s.
              </p>
            ) : null}
          </form>
        </Card>

        <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-[11px] text-slate-500">
          <p>
            Image requests go to the selected provider; failures are shown, never replaced with a
            placeholder.{" "}
            {isAuthenticated
              ? "Generated files stay private to your account and appear in Test History."
              : "Generated images stay in this browser and appear in local history."}{" "}
            Pollinations uses a shared anonymous free tier; requests can be rate-limited. If you add
            your own provider key, any charges on that account are your responsibility — this app
            never falls back to a different model or the operator&apos;s key.
          </p>
        </div>
      </aside>
    </div>
  );
}
