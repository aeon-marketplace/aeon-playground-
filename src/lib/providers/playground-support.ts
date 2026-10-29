import type { ModelCapability } from "@/lib/providers/types";

export const PLAYGROUNDS = ["text", "image"] as const;

export type PlaygroundId = (typeof PLAYGROUNDS)[number];
export type PlaygroundOperation = "chat" | "image";

export const PLAYGROUND_LABELS: Record<PlaygroundId, string> = {
  text: "Text-to-text",
  image: "Text-to-image",
};

export function operationForPlayground(playground: PlaygroundId): PlaygroundOperation {
  return playground === "image" ? "image" : "chat";
}

/**
 * The operations this app actually implements for a model. Compatibility is
 * intentionally per playground: a model can be usable in one playground and
 * unsupported in another.
 */
export function supportedPlaygroundOperations(
  providerId: string,
  capabilities: ModelCapability[],
): PlaygroundOperation[] {
  const operations: PlaygroundOperation[] = [];
  // Safety/guardrail models can accept text and return text classifications,
  // but they are not general-purpose chat models. Keep this explicit even if a
  // future discovery adapter accidentally includes both capabilities.
  if (capabilities.includes("text") && !capabilities.includes("safety")) {
    operations.push("chat");
  }
  // Image generation is currently implemented only by the Pollinations route.
  // Other providers may expose image models, but this app must not pretend it
  // can execute them through the image playground.
  if (providerId === "pollinations" && capabilities.includes("image")) {
    operations.push("image");
  }
  return operations;
}

export function isCompatibleWithPlayground(
  providerId: string,
  capabilities: ModelCapability[],
  playground: PlaygroundId,
): boolean {
  return supportedPlaygroundOperations(providerId, capabilities).includes(
    operationForPlayground(playground),
  );
}

/**
 * Legacy single-operation helper retained for server routing and existing
 * callers. Chat is preferred when a model exposes both operations; per-scope
 * catalog actions use supportedPlaygroundOperations instead.
 */
export function playgroundOperation(
  providerId: string,
  capabilities: ModelCapability[],
): PlaygroundOperation | null {
  return supportedPlaygroundOperations(providerId, capabilities)[0] ?? null;
}
