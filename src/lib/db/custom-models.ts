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
    verifiedAt: row.verified_at === null ? null : Number(row.verified_at),
    verificationError: row.verification_error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function listCustomModels(userId: string): Promise<PublicCustomModel[]> {
  const result = await getDb().query(
    "SELECT * FROM custom_models WHERE user_id = $1 ORDER BY created_at DESC",
    [userId],
  );
  return (result.rows as unknown as CustomModelRow[]).map(toPublicCustomModel);
}

export async function listVerifiedCustomModels(userId: string): Promise<PublicCustomModel[]> {
  return (await listCustomModels(userId)).filter((model) => model.verified);
}

export async function getCustomModelRow(userId: string, id: string): Promise<CustomModelRow | undefined> {
  const result = await getDb().query("SELECT * FROM custom_models WHERE user_id = $1 AND id = $2", [
    userId,
    id,
  ]);
  return result.rows[0] as CustomModelRow | undefined;
}

export async function createCustomModel(userId: string, input: CustomModelInput): Promise<string> {
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
  await db.query(
    `INSERT INTO custom_models
      (id, user_id, name, base_url, model_id, ciphertext, iv, tag, key_hint, capabilities, verified, verified_at, verification_error, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, NULL, NULL, $11, $12)`,
    [id, userId, input.name, baseUrl, input.modelId, ciphertext, iv, tag, keyHint, JSON.stringify(["text"]), now, now],
  );
  return id;
}

export async function updateCustomModel(
  userId: string,
  id: string,
  input: CustomModelUpdateInput,
): Promise<boolean> {
  const existing = await getCustomModelRow(userId, id);
  if (!existing) return false;

  const now = Date.now();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const newKey = input.apiKey?.trim() || null;
  const replaceKey = Boolean(newKey);
  const clearKey = Boolean(input.clearApiKey) && !replaceKey;

  if (replaceKey && newKey) {
    const encrypted = encryptSecret(newKey, secretAad(userId, "custom", id));
    await getDb().query(
      `UPDATE custom_models
          SET name = $1, base_url = $2, model_id = $3, ciphertext = $4, iv = $5, tag = $6,
              key_hint = $7, verified = 0, verified_at = NULL, verification_error = NULL,
              updated_at = $8
        WHERE user_id = $9 AND id = $10`,
      [input.name, baseUrl, input.modelId, encrypted.ciphertext, encrypted.iv, encrypted.tag, `••••${newKey.slice(-4)}`, now, userId, id],
    );
    return true;
  }

  if (clearKey) {
    await getDb().query(
      `UPDATE custom_models
          SET name = $1, base_url = $2, model_id = $3, ciphertext = NULL, iv = NULL, tag = NULL,
              key_hint = NULL, verified = 0, verified_at = NULL, verification_error = NULL,
              updated_at = $4
        WHERE user_id = $5 AND id = $6`,
      [input.name, baseUrl, input.modelId, now, userId, id],
    );
    return true;
  }

  await getDb().query(
    `UPDATE custom_models
        SET name = $1, base_url = $2, model_id = $3, verified = 0, verified_at = NULL,
            verification_error = NULL, updated_at = $4
      WHERE user_id = $5 AND id = $6`,
    [input.name, baseUrl, input.modelId, now, userId, id],
  );
  return true;
}

export async function setCustomModelVerification(
  userId: string,
  id: string,
  verification: { verified: boolean; error: string | null },
): Promise<void> {
  const now = Date.now();
  await getDb().query(
    `UPDATE custom_models SET verified = $1, verified_at = $2, verification_error = $3, updated_at = $4
     WHERE user_id = $5 AND id = $6`,
    [verification.verified ? 1 : 0, verification.verified ? now : null, verification.error, now, userId, id],
  );
}

export async function deleteCustomModel(userId: string, id: string): Promise<boolean> {
  const result = await getDb().query("DELETE FROM custom_models WHERE user_id = $1 AND id = $2", [
    userId,
    id,
  ]);
  return result.rowCount > 0;
}

export function decryptCustomKey(row: CustomModelRow): string | undefined {
  if (!row.ciphertext || !row.iv || !row.tag) return undefined;
  return decryptSecret(
    { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag },
    secretAad(row.user_id, "custom", row.id),
  );
}
