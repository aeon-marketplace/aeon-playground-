import { ProviderError } from "@/lib/providers/errors";

const MAX_STREAM_CHARS = 8 * 1024 * 1024;

/**
 * Read a text/event-stream response and call `onData` for each `data:` payload.
 * Stops on the SSE `[DONE]` sentinel. Never follows redirects (the response is
 * already open) and caps the total stream size.
 */
export async function readSseData(
  res: Response,
  onData: (data: string) => void,
): Promise<void> {
  if (!res.body) {
    throw new ProviderError("invalid_response", "Provider returned no stream body.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_STREAM_CHARS) {
        throw new ProviderError("invalid_response", "Provider stream exceeded the 8 MB limit.");
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const dataLines = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        const data = dataLines.join("\n");
        if (data === "[DONE]") return;
        onData(data);
      }
    }
    // Flush a final event that was not followed by a blank line.
    const remaining = buffer.trim();
    if (remaining) {
      const data = remaining
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") onData(data);
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseSseJson(data: string, provider: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProviderError("invalid_response", `${provider} sent an invalid stream event.`);
  }
}
