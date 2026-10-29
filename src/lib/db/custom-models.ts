import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret, secretAad } from "@/lib/crypto/secrets";
import { getDb } from "@/lib/db";
import type { CustomModelRow } from "@/lib/db/types";
import { normalizeBaseUrl } from "@/lib/providers/http";

export type PublicCustomModel = {
  id: string;
  name: string;
  baseUrl: string;
  modelId: string;
  keyHint: string | null;
  capabilities: string[];
  verified: boolean;
  verifiedAt: number | null;
  verificationError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CustomModelInput = {
  name: string;
  baseUrl: string;
  modelId: string;
  apiKey?: string;
};

export type CustomModelUpdateInput = CustomModelInput & {
  clearApiKey?: boolean;
};

function parseCapabilities(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    // Fall through to text.
  }
  return ["text"];
}

export function toPublicCustomModel(row: CustomModelRow): PublicCustomModel {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    modelId: row.model_id,
    keyHint: row.key_hint,
    capabilities: parseCapabilities(row.capabilities),
    verified: row.verified === 1,
    verifiedAt: row.verified_at,
    verificationError: row.verification_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCustomModels(userId: string): PublicCustomModel[] {
  const rows = getDb()
    .prepare("SELECT * FROM custom_models WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as unknown as CustomModelRow[];
  return rows.map(toPublicCustomModel);
}

export function listVerifiedCustomModels(userId: string): PublicCustomModel[] {
  return listCustomModels(userId).filter((model) => model.verified);
}

export function getCustomModelRow(userId: string, id: string): CustomModelRow | undefined {
  return getDb()
    .prepare("SELECT * FROM custom_models WHERE user_id = ? AND id = ?")
    .get(userId, id) as CustomModelRow | undefined;
}

export function createCustomModel(userId: string, input: CustomModelInput): string {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const key = input.apiKey?.trim() || null;
  let ciphertext: string | null = null;
  let iv: string | null = null;
  let tag: string | null = null;
  let keyHint: string | null = null;
  if (key) {
    const encrypted = encryptSecret(key, secretAad(userId, "custom", id));
    ciphertext = encrypted.ciphertext;
    iv = encrypted.iv;
    tag = encrypted.tag;
    keyHint = `••••${key.slice(-4)}`;
  }
  db.prepare(
    `INSERT INTO custom_models
      (id, user_id, name, base_url, model_id, ciphertext, iv, tag, key_hint, capabilities, verified, verified_at, verification_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
  ).run(
    id,
    userId,
    input.name,
    baseUrl,
    input.modelId,
    ciphertext,
    iv,
    tag,
    keyHint,
    JSON.stringify(["text"]),
    now,
    now,
  );
  return id;
}

export function updateCustomModel(
  userId: string,
  id: string,
  input: CustomModelUpdateInput,
): boolean {
  const existing = getCustomModelRow(userId, id);
  if (!existing) return false;

  const now = Date.now();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const newKey = input.apiKey?.trim() || null;
  const replaceKey = Boolean(newKey);
  const clearKey = Boolean(input.clearApiKey) && !replaceKey;

  if (replaceKey && newKey) {
    const encrypted = encryptSecret(newKey, secretAad(userId, "custom", id));
    getDb()
      .prepare(
        `UPDATE custom_models
            SET name = ?, base_url = ?, model_id = ?, ciphertext = ?, iv = ?, tag = ?,
                key_hint = ?, verified = 0, verified_at = NULL, verification_error = NULL,
                updated_at = ?
          WHERE user_id = ? AND id = ?`,
      )
      .run(
        input.name,
        baseUrl,
        input.modelId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        `••••${newKey.slice(-4)}`,
        now,
        userId,
        id,
      );
    return true;
  }

  if (clearKey) {
    getDb()
      .prepare(
        `UPDATE custom_models
            SET name = ?, base_url = ?, model_id = ?, ciphertext = NULL, iv = NULL, tag = NULL,
                key_hint = NULL, verified = 0, verified_at = NULL, verification_error = NULL,
                updated_at = ?
          WHERE user_id = ? AND id = ?`,
      )
      .run(input.name, baseUrl, input.modelId, now, userId, id);
    return true;
  }

  getDb()
    .prepare(
      `UPDATE custom_models
          SET name = ?, base_url = ?, model_id = ?, verified = 0, verified_at = NULL,
              verification_error = NULL, updated_at = ?
        WHERE user_id = ? AND id = ?`,
    )
    .run(input.name, baseUrl, input.modelId, now, userId, id);
  return true;
}

export function setCustomModelVerification(
  userId: string,
  id: string,
  verification: { verified: boolean; error: string | null },
): void {
  getDb()
    .prepare(
      `UPDATE custom_models SET verified = ?, verified_at = ?, verification_error = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      verification.verified ? 1 : 0,
      verification.verified ? Date.now() : null,
      verification.error,
      Date.now(),
      userId,
      id,
    );
}

export function deleteCustomModel(userId: string, id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM custom_models WHERE user_id = ? AND id = ?")
    .run(userId, id);
  return result.changes > 0;
}

export function decryptCustomKey(row: CustomModelRow): string | undefined {
  if (!row.ciphertext || !row.iv || !row.tag) return undefined;
  return decryptSecret(
    { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag },
    secretAad(row.user_id, "custom", row.id),
  );
}
