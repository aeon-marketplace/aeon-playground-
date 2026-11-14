import { randomUUID } from "node:crypto";
import { isAnonymousUserId } from "@/lib/auth/ids";
import { getDb } from "@/lib/db";
import { ensureUserExists } from "@/lib/db/users";
import type { TestRunRow } from "@/lib/db/types";
import type { AccessType } from "@/lib/providers/types";

export type RunKind = "chat" | "compare" | "image";
export type RunStatus = "success" | "error";

export type NewRun = {
  userId: string;
  kind: RunKind;
  groupId?: string | null;
  modelRef: string;
  providerId: string;
  modelId: string;
  prompt: string;
  output?: string | null;
  status: RunStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  usageAvailable?: boolean;
  providerRequestId?: string | null;
  imagePath?: string | null;
  accessType?: AccessType | null;
  providerName?: string | null;
  modelName?: string | null;
  systemPrompt?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
};

export type PublicRun = {
  id: string;
  kind: string;
  groupId: string | null;
  modelRef: string;
  providerId: string;
  modelId: string;
  prompt: string;
  output: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  usageAvailable: boolean;
  providerRequestId: string | null;
  imagePath: string | null;
  accessType: string | null;
  providerName: string | null;
  modelName: string | null;
  systemPrompt: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  createdAt: number;
};

function toPublicRun(row: TestRunRow): PublicRun {
  return {
    id: row.id,
    kind: row.kind,
    groupId: row.group_id,
    modelRef: row.model_ref,
    providerId: row.provider_id,
    modelId: row.model_id,
    prompt: row.prompt,
    output: row.output,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    usageAvailable: row.usage_available === 1,
    providerRequestId: row.provider_request_id,
    imagePath: row.image_path,
    accessType: row.access_type,
    providerName: row.provider_name,
    modelName: row.model_name,
    systemPrompt: row.system_prompt,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    createdAt: Number(row.created_at),
  };
}

export async function recordRunForViewer(
  userId: string | null,
  input: Omit<NewRun, "userId">,
): Promise<string> {
  if (!userId || isAnonymousUserId(userId)) return randomUUID();
  return await recordRun({ ...input, userId });
}

export async function recordRun(input: NewRun): Promise<string> {
  const id = randomUUID();
  await ensureUserExists(input.userId);
  await getDb().query(
    `INSERT INTO test_runs
      (id, user_id, kind, group_id, model_ref, provider_id, model_id, prompt, output, status,
       error_code, error_message, latency_ms, prompt_tokens, completion_tokens, total_tokens,
       usage_available, provider_request_id, image_path, access_type, provider_name, model_name,
       system_prompt, image_width, image_height, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
    [
      id,
      input.userId,
      input.kind,
      input.groupId ?? null,
      input.modelRef,
      input.providerId,
      input.modelId,
      input.prompt.slice(0, 20_000),
      input.output ?? null,
      input.status,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.latencyMs ?? null,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.totalTokens ?? null,
      input.usageAvailable ? 1 : 0,
      input.providerRequestId ?? null,
      input.imagePath ?? null,
      input.accessType ?? null,
      input.providerName ?? null,
      input.modelName ?? null,
      input.systemPrompt ?? null,
      input.imageWidth ?? null,
      input.imageHeight ?? null,
      Date.now(),
    ],
  );
  return id;
}

export async function listRuns(userId: string, limit = 100): Promise<PublicRun[]> {
  const capped = Math.min(Math.max(limit, 1), 500);
  const result = await getDb().query(
    "SELECT * FROM test_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userId, capped],
  );
  return (result.rows as unknown as TestRunRow[]).map(toPublicRun);
}

export async function listRunGroups(userId: string, limit = 500): Promise<PublicRun[]> {
  return await listRuns(userId, limit);
}

export async function countRuns(userId: string): Promise<number> {
  const result = await getDb().query("SELECT COUNT(*) AS count FROM test_runs WHERE user_id = $1", [userId]);
  return Number((result.rows[0] as { count: string | number }).count);
}

export async function clearHistory(userId: string): Promise<number> {
  const result = await getDb().query("DELETE FROM test_runs WHERE user_id = $1", [userId]);
  return Number(result.rowCount);
}

export async function getRun(userId: string, id: string): Promise<PublicRun | undefined> {
  const result = await getDb().query("SELECT * FROM test_runs WHERE user_id = $1 AND id = $2", [userId, id]);
  const row = result.rows[0] as TestRunRow | undefined;
  return row ? toPublicRun(row) : undefined;
}

export async function deleteRun(
  userId: string,
  id: string,
): Promise<{ deleted: boolean; imagePath: string | null }> {
  const rowResult = await getDb().query("SELECT image_path FROM test_runs WHERE user_id = $1 AND id = $2", [
    userId,
    id,
  ]);
  const row = rowResult.rows[0] as { image_path: string | null } | undefined;
  if (!row) return { deleted: false, imagePath: null };
  const result = await getDb().query("DELETE FROM test_runs WHERE user_id = $1 AND id = $2", [userId, id]);
  return { deleted: result.rowCount > 0, imagePath: row.image_path };
}

export async function listImagePaths(userId: string): Promise<string[]> {
  const result = await getDb().query(
    "SELECT image_path FROM test_runs WHERE user_id = $1 AND image_path IS NOT NULL",
    [userId],
  );
  return result.rows.map((row) => (row as { image_path: string }).image_path);
}
