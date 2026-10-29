import { getAnonymousUserId, getCurrentUser } from "@/lib/auth/session";
import UnifiedPlayground, {
  type PlaygroundTask,
} from "@/components/playground/unified-playground";
import type { ImageRecord } from "@/components/playground/image-playground";
import { listRuns } from "@/lib/db/runs";
import { getSettings } from "@/lib/db/settings";
import { isPaidRoute } from "@/lib/providers/playground-access";
import { getPlaygroundModels, getRuntimeCatalog } from "@/lib/providers/runtime";
import type { AccessType } from "@/lib/providers/types";
import { getDailyUsage } from "@/lib/usage/daily-limit";
import { fullDailyUsage } from "@/lib/usage/policy";

export const metadata = { title: "Playground" };
export const dynamic = "force-dynamic";

const ACCESS_TYPES: AccessType[] = ["free", "limited-free", "local", "byok", "unavailable"];

function asAccessType(value: string | null): AccessType | null {
  return value && ACCESS_TYPES.includes(value as AccessType) ? (value as AccessType) : null;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[]; task?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedRef = firstParam(params.ref);
  const requestedTaskParam = firstParam(params.task);
  const user = await getCurrentUser();
  const account = user && !user.isAnonymous ? user : null;
  const usageUserId = user?.id ?? (await getAnonymousUserId());

  const [textModels, imageModels] = await Promise.all([
    getPlaygroundModels(user?.id ?? null, "text"),
    getPlaygroundModels(user?.id ?? null, "image"),
  ]);

  const dailyUsage = usageUserId ? getDailyUsage(usageUserId) : fullDailyUsage();
  const settings = user
    ? getSettings(user.id)
    : { defaultModelRef: null, defaultSystemPrompt: "", updatedAt: 0 };

  const requestedText = requestedRef
    ? (textModels.find((model) => model.ref === requestedRef)?.ref ?? null)
    : null;
  const requestedImage = requestedRef
    ? (imageModels.find((model) => model.ref === requestedRef)?.ref ?? null)
    : null;

  const initialTask: PlaygroundTask =
    requestedTaskParam === "image" || requestedTaskParam === "text"
      ? requestedTaskParam
      : requestedImage && !requestedText
        ? "image"
        : "text";

  // A catalog link can name a model that the current session cannot select. The
  // notice belongs to the task the visitor asked for; it never replaces the
  // requested model or silently runs a different one.
  const requestedErrorTask: PlaygroundTask | null = requestedRef
    ? requestedTaskParam === "image" || requestedTaskParam === "text"
      ? requestedTaskParam
      : requestedText
        ? "text"
        : requestedImage
          ? "image"
          : initialTask
    : null;

  async function requestedErrorFor(task: PlaygroundTask): Promise<string | null> {
    if (!requestedRef || requestedErrorTask !== task) return null;
    const selectable = task === "text" ? requestedText : requestedImage;
    if (selectable) return null;

    let detail = "It is not in this deployment's model registry.";
    const catalog = await getRuntimeCatalog(user?.id ?? null);
    const entry = catalog.find((model) => model.ref === requestedRef);
    if (entry) {
      detail = isPaidRoute(entry)
        ? "Paid routes are never added to playground selectors, even when the operator enables paid BYOK. Inspect availability in the catalog; they cannot be run here."
        : `${entry.statusLabel}: ${entry.statusDetail}`;
    }
    return `The catalog requested “${requestedRef}”. ${detail}`;
  }

  const [requestedTextError, requestedImageError] = await Promise.all([
    requestedErrorFor("text"),
    requestedErrorFor("image"),
  ]);

  const defaultTextRef =
    requestedText ??
    textModels.find((model) => model.ref === settings.defaultModelRef)?.ref ??
    textModels[0]?.ref ??
    null;
  const defaultImageRef = requestedImage ?? imageModels[0]?.ref ?? null;

  const initialImages: ImageRecord[] = account
    ? listRuns(account.id, 200)
        .filter((run) => run.kind === "image" && run.imagePath)
        .slice(0, 12)
        .map((run) => ({
          runId: run.id,
          url: `/api/images/${run.id}`,
          width: run.imageWidth ?? 512,
          height: run.imageHeight ?? 512,
          latencyMs: run.latencyMs,
          prompt: run.prompt,
          modelName: run.modelName ?? run.modelId,
          accessType: asAccessType(run.accessType),
        }))
    : [];

  return (
    <UnifiedPlayground
      textModels={textModels}
      imageModels={imageModels}
      defaultTextRef={defaultTextRef}
      defaultImageRef={defaultImageRef}
      defaultSystemPrompt={settings.defaultSystemPrompt}
      initialImages={initialImages}
      isAuthenticated={Boolean(account)}
      initialUsage={dailyUsage}
      initialTask={initialTask}
      requestedRef={requestedRef}
      requestedTextError={requestedTextError}
      requestedImageError={requestedImageError}
    />
  );
}
