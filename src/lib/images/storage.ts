import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function imagesDirectory(): string {
  return path.join(path.dirname(getEnv().databasePath), "images");
}

export async function saveImage(bytes: Uint8Array, contentType: string): Promise<string> {
  const extension = EXTENSIONS[contentType] ?? "jpg";
  const filename = `${randomUUID()}.${extension}`;
  const directory = imagesDirectory();
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), bytes, { mode: 0o600 });
  return filename;
}

export async function readStoredImage(
  filename: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const safeName = path.basename(filename);
  if (safeName !== filename || !/^[a-f0-9-]+\.(jpg|png|webp)$/.test(safeName)) return null;
  try {
    const bytes = await readFile(path.join(imagesDirectory(), safeName));
    const extension = path.extname(safeName).slice(1);
    const contentType =
      extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    return { bytes, contentType };
  } catch {
    return null;
  }
}

export async function deleteStoredImage(filename: string): Promise<void> {
  const safeName = path.basename(filename);
  if (safeName !== filename) return;
  await unlink(path.join(imagesDirectory(), safeName)).catch(() => undefined);
}
