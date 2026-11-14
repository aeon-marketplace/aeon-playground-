import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { ensureUserExists } from "@/lib/db/users";
import {
  DAILY_MESSAGE_LIMIT,
  createDailyUsage,
  fullDailyUsage,
  istDayKey,
  type DailyUsage,
} from "@/lib/usage/policy";

const REQUEST_ID_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_RETENTION_MS = 15 * 60 * 1000;

type UsageRow = { used: number | string };
type PendingRow = { request_id: string };

export type DailyReservation =
  | { status: "reserved"; usage: DailyUsage; requestIds: string[] }
  | { status: "duplicate"; usage: DailyUsage; requestIds: string[] }
  | { status: "limit"; usage: DailyUsage };

export async function getDailyUsage(
  userId: string | null,
  now: number = Date.now(),
): Promise<DailyUsage> {
  if (!userId) return fullDailyUsage(now);

  const result = await getDb().query(
    "SELECT used FROM daily_usage WHERE user_id = $1 AND day_key = $2",
    [userId, istDayKey(now)],
  );
  const row = result.rows[0] as UsageRow | undefined;
  return createDailyUsage(Number(row?.used ?? 0), now);
}

export async function reserveDailyMessages(input: {
  userId: string;
  requestIds: string[];
  now?: number;
}): Promise<DailyReservation> {
  const now = input.now ?? Date.now();
  const dayKey = istDayKey(now);
  const requestIds = Array.from(new Set(input.requestIds));
  if (requestIds.length === 0 || requestIds.length !== input.requestIds.length) {
    throw new Error("A generation reservation needs unique request IDs.");
  }

  await ensureUserExists(input.userId);
  const db = getDb();

  await db.query("DELETE FROM daily_request_ids WHERE user_id = $1 AND created_at < $2", [
    input.userId,
    now - REQUEST_ID_RETENTION_MS,
  ]);
  await db.query("DELETE FROM daily_usage_pending WHERE user_id = $1 AND created_at < $2", [
    input.userId,
    now - PENDING_RETENTION_MS,
  ]);

  return db.transaction(async (client) => {
    // Serialize per visitor. The users row is locked for the duration of this transaction.
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [input.userId]);

    const completedResult = await client.query(
      `SELECT request_id FROM daily_request_ids
       WHERE user_id = $1 AND request_id = ANY($2::text[])`,
      [input.userId, requestIds],
    );
    const pendingResult = await client.query(
      `SELECT request_id FROM daily_usage_pending
       WHERE user_id = $1 AND request_id = ANY($2::text[])`,
      [input.userId, requestIds],
    );
    const completed = completedResult.rows as PendingRow[];
    const pending = pendingResult.rows as PendingRow[];

    const usageResult = await client.query(
      "SELECT used FROM daily_usage WHERE user_id = $1 AND day_key = $2",
      [input.userId, dayKey],
    );
    const used = Number((usageResult.rows[0] as UsageRow | undefined)?.used ?? 0);

    if (completed.length > 0 || pending.length > 0) {
      const duplicateIds = [...completed, ...pending].map((entry) => entry.request_id);
      return {
        status: "duplicate",
        usage: createDailyUsage(used, now),
        requestIds: duplicateIds,
      };
    }

    const pendingCountResult = await client.query(
      `SELECT COUNT(*) AS count FROM daily_usage_pending
       WHERE user_id = $1 AND day_key = $2 AND created_at >= $3`,
      [input.userId, dayKey, now - PENDING_RETENTION_MS],
    );
    const active = Number((pendingCountResult.rows[0] as { count: string | number }).count ?? 0);

    if (used + active + requestIds.length > DAILY_MESSAGE_LIMIT) {
      return { status: "limit", usage: createDailyUsage(used, now) };
    }

    for (const requestId of requestIds) {
      await client.query(
        `INSERT INTO daily_usage_pending (user_id, request_id, day_key, created_at)
         VALUES ($1, $2, $3, $4)`,
        [input.userId, requestId, dayKey, now],
      );
    }

    return {
      status: "reserved",
      usage: createDailyUsage(used, now),
      requestIds,
    };
  });
}

export async function commitDailyMessages(input: {
  userId: string;
  requestIds: string[];
  now?: number;
}): Promise<DailyUsage> {
  const now = input.now ?? Date.now();
  const dayKey = istDayKey(now);
  const db = getDb();

  await ensureUserExists(input.userId);

  return db.transaction(async (client) => {
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [input.userId]);

    let credited = 0;
    const uniqueIds = Array.from(new Set(input.requestIds));

    for (const requestId of uniqueIds) {
      const completedResult = await client.query(
        "SELECT request_id FROM daily_request_ids WHERE user_id = $1 AND request_id = $2",
        [input.userId, requestId],
      );
      if (completedResult.rows[0]) continue;

      await client.query(
        `INSERT INTO daily_request_ids (user_id, request_id, day_key, created_at)
         VALUES ($1, $2, $3, $4)`,
        [input.userId, requestId, dayKey, now],
      );
      await client.query("DELETE FROM daily_usage_pending WHERE user_id = $1 AND request_id = $2", [
        input.userId,
        requestId,
      ]);
      credited += 1;
    }

    if (credited > 0) {
      await client.query(
        `INSERT INTO daily_usage (user_id, day_key, used, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, day_key)
         DO UPDATE SET used = daily_usage.used + excluded.used, updated_at = excluded.updated_at`,
        [input.userId, dayKey, credited, now],
      );
    }

    const usageResult = await client.query(
      "SELECT used FROM daily_usage WHERE user_id = $1 AND day_key = $2",
      [input.userId, dayKey],
    );
    const used = Number((usageResult.rows[0] as UsageRow | undefined)?.used ?? 0);
    return createDailyUsage(used, now);
  });
}

export async function releaseDailyMessages(input: {
  userId: string;
  requestIds: string[];
}): Promise<void> {
  const db = getDb();
  const uniqueIds = Array.from(new Set(input.requestIds));
  for (const requestId of uniqueIds) {
    await db.query("DELETE FROM daily_usage_pending WHERE user_id = $1 AND request_id = $2", [
      input.userId,
      requestId,
    ]);
  }
}

export function newServerRequestId(): string {
  return randomUUID();
}
