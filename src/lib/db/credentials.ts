import { decryptSecret, encryptSecret, secretAad } from "@/lib/crypto/secrets";
import { getDb } from "@/lib/db";
import type { CredentialRow } from "@/lib/db/types";
import type { ModelDefinition, ProviderDefinition } from "@/lib/providers/types";

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
    verifiedAt: row.verified_at,
    verificationError: row.verification_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProviderCredentials(userId: string): PublicCredential[] {
  const rows = getDb()
    .prepare("SELECT * FROM provider_credentials WHERE user_id = ? ORDER BY provider_id")
    .all(userId) as unknown as CredentialRow[];
  return rows.map(toPublicCredential);
}

export function getProviderCredentialRow(
  userId: string,
  providerId: string,
): CredentialRow | undefined {
  return getDb()
    .prepare("SELECT * FROM provider_credentials WHERE user_id = ? AND provider_id = ?")
    .get(userId, providerId) as CredentialRow | undefined;
}

import { ensureUserExists } from "@/lib/db/users";

export function saveProviderCredential(
  userId: string,
  providerId: string,
  apiKey: string,
  verification: {
    verified: boolean;
    models: string[];
    error: string | null;
    keyHint: string;
  },
): void {
  const db = getDb();
  try {
    ensureUserExists(userId);
  } catch {
    // best effort
  }
  const existing = getProviderCredentialRow(userId, providerId);
  const id = existing?.id ?? crypto.randomUUID();
  const encrypted = encryptSecret(apiKey, secretAad(userId, "provider", id));
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO provider_credentials
        (id, user_id, provider_id, ciphertext, iv, tag, key_hint, verified, verified_models, verified_at, verification_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         tag = excluded.tag,
         key_hint = excluded.key_hint,
         verified = excluded.verified,
         verified_models = excluded.verified_models,
         verified_at = excluded.verified_at,
         verification_error = excluded.verification_error,
         updated_at = excluded.updated_at`,
    ).run(
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
    );
  } catch (error) {
    try {
      ensureUserExists(userId);
      db.prepare(
        `INSERT INTO provider_credentials
          (id, user_id, provider_id, ciphertext, iv, tag, key_hint, verified, verified_models, verified_at, verification_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider_id) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           tag = excluded.tag,
           key_hint = excluded.key_hint,
           verified = excluded.verified,
           verified_models = excluded.verified_models,
           verified_at = excluded.verified_at,
           verification_error = excluded.verification_error,
           updated_at = excluded.updated_at`,
      ).run(
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
      );
    } catch {
      throw error;
    }
  }
}

export function deleteProviderCredential(userId: string, providerId: string): void {
  getDb()
    .prepare("DELETE FROM provider_credentials WHERE user_id = ? AND provider_id = ?")
    .run(userId, providerId);
}

export function setProviderVerification(
  userId: string,
  providerId: string,
  verification: { verified: boolean; models: string[]; error: string | null },
): void {
  getDb()
    .prepare(
      `UPDATE provider_credentials
       SET verified = ?, verified_models = ?, verified_at = ?, verification_error = ?, updated_at = ?
       WHERE user_id = ? AND provider_id = ?`,
    )
    .run(
      verification.verified ? 1 : 0,
      JSON.stringify(verification.models),
      verification.verified ? Date.now() : null,
      verification.error,
      Date.now(),
      userId,
      providerId,
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
  return `Key verified · ${credential.verifiedModels.length} model IDs returned`;
}
