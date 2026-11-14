import { decryptSecret, encryptSecret, secretAad } from "@/lib/crypto/secrets";
import { getDb } from "@/lib/db";
import type { CredentialRow } from "@/lib/db/types";
import type { ModelDefinition, ProviderDefinition } from "@/lib/providers/types";
import { ensureUserExists } from "@/lib/db/users";

export type PublicCredential = {
  providerId: string;
  keyHint: string;
  verified: boolean;
  verifiedModels: string[];
  verifiedAt: number | null;
  verificationError: string | null;
  createdAt: number;
  updatedAt: number;
};

export function parseVerifiedModels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function toPublicCredential(row: CredentialRow): PublicCredential {
  return {
    providerId: row.provider_id,
    keyHint: row.key_hint,
    verified: row.verified === 1,
    verifiedModels: parseVerifiedModels(row.verified_models),
    verifiedAt: row.verified_at === null ? null : Number(row.verified_at),
    verificationError: row.verification_error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function listProviderCredentials(userId: string): Promise<PublicCredential[]> {
  const result = await getDb().query(
    "SELECT * FROM provider_credentials WHERE user_id = $1 ORDER BY provider_id",
    [userId],
  );
  return (result.rows as unknown as CredentialRow[]).map(toPublicCredential);
}

export async function getProviderCredentialRow(
  userId: string,
  providerId: string,
): Promise<CredentialRow | undefined> {
  const result = await getDb().query(
    "SELECT * FROM provider_credentials WHERE user_id = $1 AND provider_id = $2",
    [userId, providerId],
  );
  return result.rows[0] as CredentialRow | undefined;
}

export async function saveProviderCredential(
  userId: string,
  providerId: string,
  apiKey: string,
  verification: {
    verified: boolean;
    models: string[];
    error: string | null;
    keyHint: string;
  },
): Promise<void> {
  const db = getDb();
  try {
    await ensureUserExists(userId);
  } catch {
    // best effort
  }
  const existing = await getProviderCredentialRow(userId, providerId);
  const id = existing?.id ?? crypto.randomUUID();
  const encrypted = encryptSecret(apiKey, secretAad(userId, "provider", id));
  const now = Date.now();
  const sql = `
    INSERT INTO provider_credentials
      (id, user_id, provider_id, ciphertext, iv, tag, key_hint, verified, verified_models, verified_at, verification_error, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT(user_id, provider_id) DO UPDATE SET
      ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      tag = excluded.tag,
      key_hint = excluded.key_hint,
      verified = excluded.verified,
      verified_models = excluded.verified_models,
      verified_at = excluded.verified_at,
      verification_error = excluded.verification_error,
      updated_at = excluded.updated_at
  `;
  const params = [
    id,
    userId,
    providerId,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.tag,
    verification.keyHint,
    verification.verified ? 1 : 0,
    JSON.stringify(verification.models),
    verification.verified ? now : null,
    verification.error,
    existing?.created_at ?? now,
    now,
  ];
  try {
    await db.query(sql, params);
  } catch (error) {
    try {
      await ensureUserExists(userId);
      await db.query(sql, params);
    } catch {
      throw error;
    }
  }
}

export async function deleteProviderCredential(userId: string, providerId: string): Promise<void> {
  await getDb().query("DELETE FROM provider_credentials WHERE user_id = $1 AND provider_id = $2", [
    userId,
    providerId,
  ]);
}

export async function setProviderVerification(
  userId: string,
  providerId: string,
  verification: { verified: boolean; models: string[]; error: string | null },
): Promise<void> {
  const now = Date.now();
  await getDb().query(
    `UPDATE provider_credentials
     SET verified = $1, verified_models = $2, verified_at = $3, verification_error = $4, updated_at = $5
     WHERE user_id = $6 AND provider_id = $7`,
    [
      verification.verified ? 1 : 0,
      JSON.stringify(verification.models),
      verification.verified ? now : null,
      verification.error,
      now,
      userId,
      providerId,
    ],
  );
}

export function decryptProviderKey(row: CredentialRow): string {
  return decryptSecret(
    { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag },
    secretAad(row.user_id, "provider", row.id),
  );
}

export function modelMatchesCredential(model: ModelDefinition, credential: PublicCredential): boolean {
  return credential.verified && credential.verifiedModels.includes(model.modelId);
}

export function providerAccessSummary(
  provider: ProviderDefinition,
  credential: PublicCredential | undefined,
): string {
  if (!provider.requiresKey) return "Ready without a key";
  if (!credential) return "Add your API key to check its model list";
  if (!credential.verified) return "Key saved but rejected by the provider";
  return `Key verified — ${credential.verifiedModels.length} model IDs returned`;
}
