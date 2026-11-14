import { getDb } from "@/lib/db";
import { ensureUserExists } from "@/lib/db/users";
import type { ModelInferenceTest } from "@/lib/providers/types";

type ModelTestRow = {
  model_ref: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
  tested_at: number | string;
};

function toResult(row: ModelTestRow): ModelInferenceTest {
  return {
    status: row.status === "success" ? "success" : "error",
    errorCode: row.error_code,
    errorMessage: row.error_message,
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    testedAt: Number(row.tested_at),
  };
}

export async function listModelTestResults(userId: string): Promise<Map<string, ModelInferenceTest>> {
  const result = await getDb().query("SELECT * FROM model_test_results WHERE user_id = $1", [userId]);
  const rows = result.rows as unknown as ModelTestRow[];
  return new Map(rows.map((row) => [row.model_ref, toResult(row)]));
}

export async function saveModelTestResult(
  userId: string,
  modelRef: string,
  result: Omit<ModelInferenceTest, "testedAt"> & { testedAt?: number },
): Promise<void> {
  try {
    await ensureUserExists(userId);
  } catch {
    // Best effort. The test response is still returned to the caller.
  }
  const testedAt = result.testedAt ?? Date.now();
  await getDb().query(
    `INSERT INTO model_test_results
      (user_id, model_ref, status, error_code, error_message, latency_ms, tested_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(user_id, model_ref) DO UPDATE SET
       status = excluded.status,
       error_code = excluded.error_code,
       error_message = excluded.error_message,
       latency_ms = excluded.latency_ms,
       tested_at = excluded.tested_at`,
    [userId, modelRef, result.status, result.errorCode, result.errorMessage, result.latencyMs, testedAt],
  );
}

export async function clearModelTestResults(userId: string, providerId?: string): Promise<void> {
  if (providerId) {
    await getDb().query("DELETE FROM model_test_results WHERE user_id = $1 AND model_ref LIKE $2", [
      userId,
      `${providerId}::%`,
    ]);
    return;
  }
  await getDb().query("DELETE FROM model_test_results WHERE user_id = $1", [userId]);
}
