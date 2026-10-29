import { getDb } from "@/lib/db";
import { ensureUserExists } from "@/lib/db/users";
import type { ModelInferenceTest } from "@/lib/providers/types";

type ModelTestRow = {
  model_ref: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
  tested_at: number;
};

function toResult(row: ModelTestRow): ModelInferenceTest {
  return {
    status: row.status === "success" ? "success" : "error",
    errorCode: row.error_code,
    errorMessage: row.error_message,
    latencyMs: row.latency_ms,
    testedAt: row.tested_at,
  };
}

export function listModelTestResults(userId: string): Map<string, ModelInferenceTest> {
  const rows = getDb()
    .prepare("SELECT * FROM model_test_results WHERE user_id = ?")
    .all(userId) as unknown as ModelTestRow[];
  return new Map(rows.map((row) => [row.model_ref, toResult(row)]));
}

export function saveModelTestResult(
  userId: string,
  modelRef: string,
  result: Omit<ModelInferenceTest, "testedAt"> & { testedAt?: number },
): void {
  try {
    ensureUserExists(userId);
  } catch {
    // Best effort. The test response is still returned to the caller.
  }
  const testedAt = result.testedAt ?? Date.now();
  getDb()
    .prepare(
      `INSERT INTO model_test_results
        (user_id, model_ref, status, error_code, error_message, latency_ms, tested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, model_ref) DO UPDATE SET
         status = excluded.status,
         error_code = excluded.error_code,
         error_message = excluded.error_message,
         latency_ms = excluded.latency_ms,
         tested_at = excluded.tested_at`,
    )
    .run(
      userId,
      modelRef,
      result.status,
      result.errorCode,
      result.errorMessage,
      result.latencyMs,
      testedAt,
    );
}

export function clearModelTestResults(userId: string, providerId?: string): void {
  if (providerId) {
    getDb()
      .prepare("DELETE FROM model_test_results WHERE user_id = ? AND model_ref LIKE ?")
      .run(userId, `${providerId}::%`);
    return;
  }
  getDb().prepare("DELETE FROM model_test_results WHERE user_id = ?").run(userId);
}
