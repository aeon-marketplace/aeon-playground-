import type { PublicRun } from "@/lib/db/runs";

/**
 * Browser-local history for anonymous visitors.
 *
 * This stores prompts, model metadata, outputs, and (for image runs) the
 * generated data URL. It never stores provider API keys, session tokens, or
 * any other server secret.
 */
export type LocalRun = PublicRun & { imageUrl?: string | null };

export type LocalRunInput = {
  id?: string;
  kind: "chat" | "compare" | "image";
  groupId?: string | null;
  modelRef: string;
  providerId: string;
  modelId: string;
  prompt: string;
  output?: string | null;
  status: "success" | "error";
  errorCode?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  usageAvailable?: boolean;
  providerRequestId?: string | null;
  accessType?: string | null;
  providerName?: string | null;
  modelName?: string | null;
  systemPrompt?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageUrl?: string | null;
};

export const LOCAL_HISTORY_KEY = "fap-local-history-v1";
const MAX_RUNS = 50;
const MAX_SERIALIZED_LENGTH = 4_500_000;
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedRuns: LocalRun[] = [];

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeLocalHistory(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") return () => listeners.delete(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCAL_HISTORY_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function id(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function validRun(value: unknown): value is LocalRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.id === "string" &&
    typeof run.kind === "string" &&
    typeof run.modelRef === "string" &&
    typeof run.providerId === "string" &&
    typeof run.modelId === "string" &&
    typeof run.prompt === "string" &&
    (run.status === "success" || run.status === "error") &&
    typeof run.createdAt === "number"
  );
}

export function readLocalRuns(): LocalRun[] {
  const store = storage();
  if (!store) return cachedRuns;
  try {
    const raw = store.getItem(LOCAL_HISTORY_KEY);
    if (raw === cachedRaw) return cachedRuns;
    cachedRaw = raw;
    if (!raw) {
      cachedRuns = [];
      return cachedRuns;
    }
    const parsed = JSON.parse(raw) as unknown;
    cachedRuns = Array.isArray(parsed)
      ? parsed
          .filter(validRun)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, MAX_RUNS)
      : [];
    return cachedRuns;
  } catch {
    cachedRaw = undefined;
    cachedRuns = [];
    return cachedRuns;
  }
}

function persist(runs: LocalRun[]): void {
  const store = storage();
  if (!store) return;
  let current = runs
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_RUNS);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (current.length === 0) {
      try {
        store.removeItem(LOCAL_HISTORY_KEY);
        notify();
      } catch {
        // Ignore storage failures.
      }
      return;
    }

    const serialized = JSON.stringify(current);
    if (serialized.length <= MAX_SERIALIZED_LENGTH) {
      try {
        store.setItem(LOCAL_HISTORY_KEY, serialized);
        notify();
        return;
      } catch {
        // Quota exceeded; remove the oldest image payload first.
      }
    }

    const oldestImageIndex = [...current]
      .map((run, index) => ({ run, index }))
      .reverse()
      .find((entry) => Boolean(entry.run.imageUrl))?.index;
    if (oldestImageIndex !== undefined) {
      current = current.filter((_, index) => index !== oldestImageIndex);
    } else if (current.length > 1) {
      current = current.slice(0, Math.max(1, current.length - 1));
    } else {
      try {
        store.removeItem(LOCAL_HISTORY_KEY);
        notify();
      } catch {
        // Ignore storage failures.
      }
      return;
    }
  }
}

function buildRun(input: LocalRunInput): LocalRun {
  return {
    id: input.id ?? id(),
    kind: input.kind,
    groupId: input.groupId ?? null,
    modelRef: input.modelRef,
    providerId: input.providerId,
    modelId: input.modelId,
    prompt: input.prompt.slice(0, 20_000),
    output: input.output ?? null,
    status: input.status,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    latencyMs: input.latencyMs ?? null,
    promptTokens: input.promptTokens ?? null,
    completionTokens: input.completionTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    usageAvailable: input.usageAvailable ?? false,
    providerRequestId: input.providerRequestId ?? null,
    imagePath: null,
    accessType: input.accessType ?? null,
    providerName: input.providerName ?? null,
    modelName: input.modelName ?? null,
    systemPrompt: input.systemPrompt ?? null,
    imageWidth: input.imageWidth ?? null,
    imageHeight: input.imageHeight ?? null,
    imageUrl: input.imageUrl ?? null,
    createdAt: Date.now(),
  };
}

export function appendLocalRuns(inputs: LocalRunInput[]): LocalRun[] {
  if (inputs.length === 0) return readLocalRuns();
  const created = inputs.map(buildRun);
  const next = [...created, ...readLocalRuns()];
  persist(next);
  return created;
}

export function appendLocalRun(input: LocalRunInput): LocalRun {
  return appendLocalRuns([input])[0]!;
}

export function deleteLocalRun(runId: string): void {
  persist(readLocalRuns().filter((run) => run.id !== runId));
}

export function clearLocalRuns(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(LOCAL_HISTORY_KEY);
    notify();
  } catch {
    // Ignore storage failures.
  }
}
