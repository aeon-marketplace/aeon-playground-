"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Alert, Badge, Card, EmptyState, FieldLabel } from "@/components/ui";
import { describeClientError, requestJson } from "@/lib/client/api";
import type { SelectableModel } from "@/lib/providers/runtime";
import { cn, formatDuration, formatTokens } from "@/lib/utils";

type Mode = "chat" | "image";

type Usage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type ChatMeta = {
  providerName: string;
  modelId: string;
  latencyMs: number;
  usage: Usage;
  usageAvailable: boolean;
  finishReason: string | null;
  requestId: string | null;
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: ChatMeta;
};

type ChatResponse = {
  runId: string;
  model: {
    ref: string;
    providerId: string;
    providerName: string;
    modelId: string;
    kind: string;
  };
  output: string;
  latencyMs: number;
  usage: Usage;
  usageAvailable: boolean;
  finishReason: string | null;
  requestId: string | null;
};

type ImageResponse = {
  runId: string;
  url: string;
  width: number;
  height: number;
  latencyMs: number;
  modelRef: string;
};

type GeneratedImage = {
  runId: string;
  url: string;
  width: number;
  height: number;
  latencyMs: number;
  prompt: string;
  modelName: string;
};

type UiError = { message: string; code?: string; details?: string };

function accessText(accessType: string): string {
  if (accessType === "free") return "Free";
  if (accessType === "limited-free") return "Limited free";
  return "BYOK";
}

function usageSummary(meta: ChatMeta): string {
  if (!meta.usageAvailable) return "Usage not reported by this provider";
  const parts: string[] = [];
  if (meta.usage.promptTokens !== null) {
    parts.push(`${formatTokens(meta.usage.promptTokens)} in`);
  }
  if (meta.usage.completionTokens !== null) {
    parts.push(`${formatTokens(meta.usage.completionTokens)} out`);
  }
  if (meta.usage.totalTokens !== null) {
    parts.push(`${formatTokens(meta.usage.totalTokens)} total`);
  }
  return parts.length > 0 ? `Tokens: ${parts.join(" · ")}` : "Usage not reported";
}

export default function PlaygroundClient({
  models,
  defaultTextRef,
  defaultImageRef,
  defaultSystemPrompt,
}: {
  models: SelectableModel[];
  defaultTextRef: string | null;
  defaultImageRef: string | null;
  defaultSystemPrompt: string;
}) {
  const textModels = useMemo(
    () => models.filter((model) => model.capabilities.includes("text")),
    [models],
  );
  const imageModels = useMemo(
    () => models.filter((model) => model.capabilities.includes("image")),
    [models],
  );

  const [tab, setTab] = useState<Mode>("chat");
  const [textRef, setTextRef] = useState(defaultTextRef ?? textModels[0]?.ref ?? "");
  const [imageRef, setImageRef] = useState(defaultImageRef ?? imageModels[0]?.ref ?? "");
  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<UiError | null>(null);

  const [imagePrompt, setImagePrompt] = useState("");
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [seed, setSeed] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<UiError | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);

  const formRef = useRef<HTMLFormElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const selectedText =
    textModels.find((model) => model.ref === textRef) ?? textModels[0] ?? null;
  const selectedImage =
    imageModels.find((model) => model.ref === imageRef) ?? imageModels[0] ?? null;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, chatLoading]);

  async function sendMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const prompt = input.trim();
    if (!prompt || chatLoading || !selectedText) return;

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
    };
    const conversation = [...turns, userTurn];
    setTurns(conversation);
    setInput("");
    setChatError(null);
    setChatLoading(true);

    try {
      const payload = {
        modelRef: selectedText.ref,
        messages: [
          ...(systemPrompt.trim()
            ? [{ role: "system" as const, content: systemPrompt.trim() }]
            : []),
          ...conversation.map((turn) => ({ role: turn.role, content: turn.content })),
        ],
        temperature,
        maxTokens,
      };
      const data = await requestJson<ChatResponse>("/api/chat", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setTurns((current) => [
        ...current,
        {
          id: `assistant-${data.runId}`,
          role: "assistant",
          content: data.output,
          meta: {
            providerName: data.model.providerName,
            modelId: data.model.modelId,
            latencyMs: data.latencyMs,
            usage: data.usage,
            usageAvailable: data.usageAvailable,
            finishReason: data.finishReason,
            requestId: data.requestId,
          },
        },
      ]);
    } catch (error) {
      setChatError(describeClientError(error));
    } finally {
      setChatLoading(false);
    }
  }

  async function generateImage(event: React.FormEvent) {
    event.preventDefault();
    if (!imagePrompt.trim() || imageLoading || !selectedImage) return;

    let seedValue: number | undefined;
    if (seed.trim()) {
      const parsed = Number(seed);
      if (!Number.isInteger(parsed) || parsed < 0) {
        setImageError({ message: "Seed must be a whole number of 0 or greater." });
        return;
      }
      seedValue = parsed;
    }

    setImageLoading(true);
    setImageError(null);
    try {
      const data = await requestJson<ImageResponse>("/api/images", {
        method: "POST",
        body: JSON.stringify({
          modelRef: selectedImage.ref,
          prompt: imagePrompt.trim(),
          width,
          height,
          ...(seedValue !== undefined ? { seed: seedValue } : {}),
        }),
      });
      setImages((current) =>
        [
          {
            runId: data.runId,
            url: data.url,
            width: data.width,
            height: data.height,
            latencyMs: data.latencyMs,
            prompt: imagePrompt.trim(),
            modelName: selectedImage.name,
          },
          ...current,
        ].slice(0, 6),
      );
    } catch (error) {
      setImageError(describeClientError(error));
    } finally {
      setImageLoading(false);
    }
  }

  const activeModel = tab === "chat" ? selectedText : selectedImage;

  const modelPanel = (
    <div className="space-y-4">
      <div>
        <FieldLabel htmlFor="model-select">Model</FieldLabel>
        <select
          id="model-select"
          className="field"
          value={activeModel?.ref ?? ""}
          onChange={(event) => {
            if (tab === "chat") setTextRef(event.target.value);
            else setImageRef(event.target.value);
          }}
          disabled={(tab === "chat" ? textModels : imageModels).length === 0}
        >
          {(tab === "chat" ? textModels : imageModels).map((model) => (
            <option key={model.ref} value={model.ref}>
              {model.name} · {model.providerName}
            </option>
          ))}
        </select>
      </div>

      {activeModel ? (
        <div className="rounded-xl border border-white/8 bg-black/20 p-3 text-[11px] leading-5 text-slate-400">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="violet">{accessText(activeModel.accessType)}</Badge>
            <Badge tone="green">Selectable now</Badge>
            {activeModel.source === "custom" ? <Badge tone="cyan">Custom</Badge> : null}
          </div>
          <p className="mt-2 break-all font-mono text-[10px] text-slate-500">
            {activeModel.providerId} / {activeModel.modelId}
          </p>
          <p className="mt-2">{activeModel.description}</p>
          {activeModel.contextWindow ? (
            <p className="mt-1 text-slate-500">
              Context window: {formatTokens(activeModel.contextWindow)} tokens
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "chat" ? (
        <>
          <details className="rounded-xl border border-white/8 bg-black/20 p-3" open>
            <summary className="cursor-pointer text-xs font-semibold text-slate-300">
              Request settings
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <FieldLabel htmlFor="system-prompt" hint={`${systemPrompt.length}/4000`}>
                  System prompt
                </FieldLabel>
                <textarea
                  id="system-prompt"
                  className="field min-h-[84px] resize-y text-xs"
                  maxLength={4000}
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  placeholder="Optional instructions for the model"
                />
              </div>
              <div>
                <FieldLabel htmlFor="temperature" hint={temperature.toFixed(2)}>
                  Temperature
                </FieldLabel>
                <input
                  id="temperature"
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={temperature}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                  className="w-full accent-violet-500"
                />
              </div>
              <div>
                <FieldLabel htmlFor="max-tokens" hint="1–4096">
                  Max output tokens
                </FieldLabel>
                <input
                  id="max-tokens"
                  type="number"
                  min={1}
                  max={4096}
                  value={maxTokens}
                  onChange={(event) =>
                    setMaxTokens(
                      Math.min(4096, Math.max(1, Number(event.target.value) || 1)),
                    )
                  }
                  className="field"
                />
              </div>
            </div>
          </details>

          <Alert tone="neutral">
            {selectedText
              ? "Only the selected model is called. Usage, latency, and errors come from the provider response."
              : "No verified text model is selectable yet. Add a provider key or a verified custom endpoint."}
          </Alert>
        </>
      ) : (
        <Alert tone="neutral">
          {selectedImage
            ? "Image generation uses a real provider request. The generated file is stored privately for this account or session and recorded in Test History."
            : "No verified image model is selectable for this account or session."}
        </Alert>
      )}
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("chat")}
            className={cn(
              "btn",
              tab === "chat" ? "btn-primary" : "btn-secondary",
            )}
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </button>
          <button
            type="button"
            onClick={() => setTab("image")}
            className={cn(
              "btn",
              tab === "image" ? "btn-primary" : "btn-secondary",
            )}
          >
            <ImageIcon className="h-4 w-4" />
            Image
          </button>
          <span className="ml-auto text-[11px] text-slate-500">
            {models.length} verified model{models.length === 1 ? "" : "s"} available to your
            account
          </span>
        </div>

        {tab === "chat" ? (
          <Card className="flex min-h-[560px] flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {selectedText?.name ?? "No text model"}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {selectedText
                    ? `${selectedText.providerName} · ${selectedText.modelId}`
                    : "Connect a provider to start"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTurns([]);
                  setChatError(null);
                }}
                disabled={turns.length === 0 || chatLoading}
                className="btn btn-ghost px-2.5 py-1.5 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                New chat
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
              {turns.length === 0 && !chatLoading ? (
                <EmptyState
                  icon={<Sparkles className="h-5 w-5" />}
                  title={selectedText ? "Start a verified conversation" : "No selectable text model"}
                  action={
                    !selectedText ? (
                      <div className="flex flex-wrap justify-center gap-2">
                        <Link href="/api-keys" className="btn btn-primary">
                          Add an API key
                        </Link>
                        <Link href="/my-models" className="btn btn-secondary">
                          Add a custom endpoint
                        </Link>
                      </div>
                    ) : undefined
                  }
                >
                  {selectedText
                    ? `Messages go directly to ${selectedText.providerName}. Free-tier limits and availability are controlled by the provider. Up to 30 messages or 30,000 characters per request.`
                    : "Connect and verify a provider key, or verify your own OpenAI-compatible endpoint, to enable chat."}
                </EmptyState>
              ) : null}

              {turns.map((turn) => (
                <div
                  key={turn.id}
                  className={cn(
                    "animate-fade-up",
                    turn.role === "user" ? "flex justify-end" : "flex justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[92%] rounded-2xl border px-4 py-3 sm:max-w-[85%]",
                      turn.role === "user"
                        ? "border-violet-400/25 bg-violet-500/15"
                        : "border-white/10 bg-white/[0.04]",
                    )}
                  >
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                      {turn.role === "user" ? "You" : "Model"}
                    </p>
                    <div className="prose-output text-slate-100">{turn.content}</div>
                    {turn.meta ? (
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/8 pt-2 text-[10px] text-slate-500">
                        <span>{turn.meta.providerName}</span>
                        <span>{turn.meta.modelId}</span>
                        <span>{formatDuration(turn.meta.latencyMs)}</span>
                        <span>{usageSummary(turn.meta)}</span>
                        {turn.meta.finishReason ? (
                          <span className="capitalize">
                            finish: {turn.meta.finishReason}
                          </span>
                        ) : null}
                        {turn.meta.requestId ? (
                          <span className="truncate" title={turn.meta.requestId}>
                            req: {turn.meta.requestId.slice(0, 18)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              {chatLoading ? (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
                    Waiting for {selectedText?.providerName ?? "provider"}…
                  </div>
                </div>
              ) : null}
              <div ref={transcriptEndRef} />
            </div>

            <div className="border-t border-white/8 bg-black/20 px-4 py-3">
              {chatError ? (
                <Alert
                  tone="red"
                  title={chatError.code ? `Request failed (${chatError.code})` : "Request failed"}
                  className="mb-3"
                >
                  {chatError.message}
                  {chatError.details ? (
                    <span className="mt-1 block text-xs opacity-80">{chatError.details}</span>
                  ) : null}
                </Alert>
              ) : null}
              <form ref={formRef} onSubmit={sendMessage} className="flex items-end gap-2">
                <textarea
                  aria-label="Message"
                  className="field max-h-48 min-h-[52px] flex-1 resize-y"
                  placeholder={
                    selectedText
                      ? "Send a message… (Enter to send, Shift+Enter for a new line)"
                      : "No text model available"
                  }
                  value={input}
                  maxLength={8000}
                  disabled={!selectedText || chatLoading}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      formRef.current?.requestSubmit();
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={!selectedText || chatLoading || !input.trim()}
                  className="btn btn-primary h-[52px] w-[52px] shrink-0 p-0"
                  aria-label="Send message"
                >
                  {chatLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ArrowUp className="h-5 w-5" />
                  )}
                </button>
              </form>
              <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-600">
                <Info className="h-3 w-3 shrink-0" />
                Do not send secrets or confidential data to anonymous free tiers.
              </p>
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="border-b border-white/8 px-4 py-3">
              <p className="text-sm font-semibold text-white">
                {selectedImage?.name ?? "No image model"}
              </p>
              <p className="text-[11px] text-slate-500">
                {selectedImage
                  ? `${selectedImage.providerName} · ${selectedImage.modelId}`
                  : "No live-verified image model is available."}
              </p>
            </div>
            <div className="px-4 py-5">
              {imageError ? (
                <Alert
                  tone="red"
                  title={imageError.code ? `Image failed (${imageError.code})` : "Image failed"}
                  className="mb-4"
                >
                  {imageError.message}
                  {imageError.details ? (
                    <span className="mt-1 block text-xs opacity-80">{imageError.details}</span>
                  ) : null}
                </Alert>
              ) : null}

              {!selectedImage ? (
                <EmptyState
                  icon={<ImageIcon className="h-5 w-5" />}
                  title="No verified image model"
                  action={
                    <Link href="/models" className="btn btn-secondary">
                      Review the model catalog
                    </Link>
                  }
                >
                  Image generation is only enabled for models that passed a live image request.
                  Pollinations FLUX is the only model currently verified for this deployment.
                </EmptyState>
              ) : (
                <form id="image-form" onSubmit={generateImage} className="space-y-4 lg:hidden">
                  <ImageFormFields
                    idPrefix="image-inline"
                    imagePrompt={imagePrompt}
                    setImagePrompt={setImagePrompt}
                    width={width}
                    height={height}
                    setWidth={setWidth}
                    setHeight={setHeight}
                    seed={seed}
                    setSeed={setSeed}
                    loading={imageLoading}
                  />
                  <button
                    type="submit"
                    disabled={imageLoading || !imagePrompt.trim()}
                    className="btn btn-primary w-full"
                  >
                    {imageLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    {imageLoading ? "Generating…" : "Generate image"}
                  </button>
                </form>
              )}

              {images.length === 0 && selectedImage ? (
                <div className="mt-5">
                  <EmptyState
                    icon={<Wand2 className="h-5 w-5" />}
                    title="No images generated yet"
                  >
                    Generated images are stored per account and linked from your Test History. A
                    failed request produces an error, never a placeholder image.
                  </EmptyState>
                </div>
              ) : null}

              {images.length > 0 ? (
                <div className="mt-5 space-y-5">
                  {images.map((imageItem, index) => (
                    <figure key={imageItem.runId} className="animate-fade-up">
                      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                        <Image
                          src={imageItem.url}
                          alt={imageItem.prompt}
                          width={imageItem.width}
                          height={imageItem.height}
                          unoptimized
                          className="h-auto max-h-[640px] w-full object-contain"
                        />
                      </div>
                      <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span className="font-medium text-slate-300">
                          {index === 0 ? "Latest" : `Earlier #${index}`}
                        </span>
                        <span>{imageItem.modelName}</span>
                        <span>
                          {imageItem.width}×{imageItem.height}
                        </span>
                        <span>{formatDuration(imageItem.latencyMs)}</span>
                        <a
                          href={imageItem.url}
                          download={`pollinations-${imageItem.runId}.jpg`}
                          className="text-violet-300 hover:text-violet-200"
                        >
                          Download
                        </a>
                      </figcaption>
                      <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                        {imageItem.prompt}
                      </p>
                    </figure>
                  ))}
                </div>
              ) : null}
            </div>
          </Card>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-semibold text-white">Session setup</h2>
          </div>
          {modelPanel}
        </Card>

        {tab === "image" && selectedImage ? (
          <Card className="hidden p-4 lg:block">
            <form onSubmit={generateImage} className="space-y-4">
              <ImageFormFields
                idPrefix="image-sidebar"
                imagePrompt={imagePrompt}
                setImagePrompt={setImagePrompt}
                width={width}
                height={height}
                setWidth={setWidth}
                setHeight={setHeight}
                seed={seed}
                setSeed={setSeed}
                loading={imageLoading}
              />
              <button
                type="submit"
                disabled={imageLoading || !imagePrompt.trim()}
                className="btn btn-primary w-full"
              >
                {imageLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {imageLoading ? "Generating…" : "Generate image"}
              </button>
            </form>
          </Card>
        ) : null}

        <Alert tone="amber" title="Access policy">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Only models verified for this account or session appear here. There is no automatic fallback to
              a paid model or a different model ID.
            </span>
          </span>
        </Alert>
      </aside>
    </div>
  );
}

function ImageFormFields({
  idPrefix,
  imagePrompt,
  setImagePrompt,
  width,
  height,
  setWidth,
  setHeight,
  seed,
  setSeed,
  loading,
}: {
  idPrefix: string;
  imagePrompt: string;
  setImagePrompt: (value: string) => void;
  width: number;
  height: number;
  setWidth: (value: number) => void;
  setHeight: (value: number) => void;
  seed: string;
  setSeed: (value: string) => void;
  loading: boolean;
}) {
  return (
    <>
      <div>
        <FieldLabel htmlFor={`${idPrefix}-prompt`} hint={`${imagePrompt.length}/2000`}>
          Image prompt
        </FieldLabel>
        <textarea
          id={`${idPrefix}-prompt`}
          className="field min-h-[96px] resize-y"
          maxLength={2000}
          value={imagePrompt}
          onChange={(event) => setImagePrompt(event.target.value)}
          placeholder="Describe the image to generate"
          disabled={loading}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor={`${idPrefix}-width`}>Width</FieldLabel>
          <select
            id={`${idPrefix}-width`}
            className="field"
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
            disabled={loading}
          >
            {[256, 512, 768, 1024].map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel htmlFor={`${idPrefix}-height`}>Height</FieldLabel>
          <select
            id={`${idPrefix}-height`}
            className="field"
            value={height}
            onChange={(event) => setHeight(Number(event.target.value))}
            disabled={loading}
          >
            {[256, 512, 768, 1024].map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <FieldLabel htmlFor={`${idPrefix}-seed`} hint="Optional">
          Seed
        </FieldLabel>
        <input
          id={`${idPrefix}-seed`}
          className="field"
          inputMode="numeric"
          value={seed}
          onChange={(event) => setSeed(event.target.value)}
          placeholder="e.g. 1234"
          disabled={loading}
        />
      </div>
    </>
  );
}
