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
    latencyMs: row.latency_ms,
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
    createdAt: row.created_at,
  };
}

/**
 * Return a run ID for the UI. Anonymous visitor runs are intentionally not
 * persisted: public visitors get browser-local history, while signed-in users
 * keep the existing account-scoped SQLite history.
 */
export function recordRunForViewer(
  userId: string | null,
  input: Omit<NewRun, "userId">,
): string {
  if (!userId || isAnonymousUserId(userId)) return randomUUID();
  return recordRun({ ...input, userId });
}

export function recordRun(input: NewRun): string {
  const id = randomUUID();
  // Defensive: an account row must exist before inserting a foreign-keyed run.
  // This cannot create a session or authenticate anyone; it only guarantees the
  // already-authenticated id has its row.
  ensureUserExists(input.userId);
  getDb()
    .prepare(
      `INSERT INTO test_runs
        (id, user_id, kind, group_id, model_ref, provider_id, model_id, prompt, output, status,
         error_code, error_message, latency_ms, prompt_tokens, completion_tokens, total_tokens,
         usage_available, provider_request_id, image_path, access_type, provider_name, model_name,
         system_prompt, image_width, image_height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    );
  return id;
}

export function listRuns(userId: string, limit = 100): PublicRun[] {
  const capped = Math.min(Math.max(limit, 1), 500);
  const rows = getDb()
    .prepare("SELECT * FROM test_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, capped) as unknown as TestRunRow[];
  return rows.map(toPublicRun);
}

export function listRunGroups(userId: string, limit = 500): PublicRun[] {
  return listRuns(userId, limit);
}

export function countRuns(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM test_runs WHERE user_id = ?")
    .get(userId) as { count: number };
  return Number(row.count);
}

export function clearHistory(userId: string): number {
  const result = getDb().prepare("DELETE FROM test_runs WHERE user_id = ?").run(userId);
  return Number(result.changes);
}

export function getRun(userId: string, id: string): PublicRun | undefined {
  const row = getDb()
    .prepare("SELECT * FROM test_runs WHERE user_id = ? AND id = ?")
    .get(userId, id) as TestRunRow | undefined;
  return row ? toPublicRun(row) : undefined;
}

/** Delete one run owned by the user. Returns the stored image path, if any. */
export function deleteRun(userId: string, id: string): { deleted: boolean; imagePath: string | null } {
  const row = getDb()
    .prepare("SELECT image_path FROM test_runs WHERE user_id = ? AND id = ?")
    .get(userId, id) as { image_path: string | null } | undefined;
  if (!row) return { deleted: false, imagePath: null };
  const result = getDb()
    .prepare("DELETE FROM test_runs WHERE user_id = ? AND id = ?")
    .run(userId, id);
  return { deleted: Number(result.changes) > 0, imagePath: row.image_path };
}

export function listImagePaths(userId: string): string[] {
  const rows = getDb()
    .prepare("SELECT image_path FROM test_runs WHERE user_id = ? AND image_path IS NOT NULL")
    .all(userId) as Array<{ image_path: string }>;
  return rows.map((row) => row.image_path);
}
