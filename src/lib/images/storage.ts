import { del, get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function saveImage(bytes: Uint8Array, contentType: string): Promise<string> {
  const extension = EXTENSIONS[contentType] ?? "jpg";
  const pathname = `images/${randomUUID()}.${extension}`;
  const blob = await put(pathname, Buffer.from(bytes), {
    access: "private",
    contentType,
  });
  return blob.url;
}

export async function readStoredImage(
  url: string,
): Promise<{ stream: ReadableStream; contentType: string } | null> {
  try {
    const result = await get(url, { access: "private" });
    if (!result || !result.stream) return null;
    return {
      stream: result.stream,
      contentType: result.blob.contentType || "image/jpeg",
    };
  } catch {
    return null;
  }
}

export async function deleteStoredImage(url: string): Promise<void> {
  try {
    await del(url);
  } catch {
    // Ignore missing blobs.
  }
}
