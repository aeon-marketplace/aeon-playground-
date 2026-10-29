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

/**
 * Requests retained for duplicate detection. A retried request ID is rejected
 * while it is retained; after this window the same ID may be accepted again.
 * Client-generated IDs are unique per submit, so this only affects accidental
 * network replays or deliberately reused IDs.
 */
const REQUEST_ID_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A reservation only protects an in-flight provider call. If a process dies
 * before committing or releasing it, the reservation expires and the visitor's
 * successful-generation allowance is not reduced.
 */
const PENDING_RETENTION_MS = 15 * 60 * 1000;

type UsageRow = { used: number };
type PendingRow = { request_id: string };

export type DailyReservation =
  | { status: "reserved"; usage: DailyUsage; requestIds: string[] }
  | { status: "duplicate"; usage: DailyUsage; requestIds: string[] }
  | { status: "limit"; usage: DailyUsage };

/**
 * Read-only usage for page rendering and response payloads.
 *
 * `used` counts successful generations only. In-flight reservations are tracked
 * separately so a failed provider call never consumes the visitor's allowance.
 */
export function getDailyUsage(
  userId: string | null,
  now: number = Date.now(),
): DailyUsage {
  if (!userId) return fullDailyUsage(now);

  const row = getDb()
    .prepare("SELECT used FROM daily_usage WHERE user_id = ? AND day_key = ?")
    .get(userId, istDayKey(now)) as UsageRow | undefined;
  return createDailyUsage(row?.used ?? 0, now);
}

function pendingCount(userId: string, dayKey: string, now: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM daily_usage_pending
       WHERE user_id = ? AND day_key = ? AND created_at >= ?`,
    )
    .get(userId, dayKey, now - PENDING_RETENTION_MS) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

/**
 * Atomically reserve capacity for one or more provider calls.
 *
 * The reservation does NOT increment the successful-generation counter. It only
 * prevents concurrent requests from overshooting the daily limit. Call
 * `commitDailyMessages` after a real provider success and `releaseDailyMessages`
 * on any failure, timeout, or abort.
 */
export function reserveDailyMessages(input: {
  userId: string;
  requestIds: string[];
  now?: number;
}): DailyReservation {
  const now = input.now ?? Date.now();
  const dayKey = istDayKey(now);
  const requestIds = Array.from(new Set(input.requestIds));
  if (requestIds.length === 0 || requestIds.length !== input.requestIds.length) {
    throw new Error("A generation reservation needs unique request IDs.");
  }

  ensureUserExists(input.userId);
  const db = getDb();

  // Keep the idempotency table bounded without touching current-day rows.
  db.prepare(
    "DELETE FROM daily_request_ids WHERE user_id = ? AND created_at < ?",
  ).run(input.userId, now - REQUEST_ID_RETENTION_MS);
  // Expire abandoned in-flight reservations (crashed worker, killed process).
  db.prepare(
    "DELETE FROM daily_usage_pending WHERE user_id = ? AND created_at < ?",
  ).run(input.userId, now - PENDING_RETENTION_MS);

  db.exec("BEGIN IMMEDIATE");
  try {
    const placeholders = requestIds.map(() => "?").join(", ");
    const completed = db
      .prepare(
        `SELECT request_id FROM daily_request_ids
         WHERE user_id = ? AND request_id IN (${placeholders})`,
      )
      .all(input.userId, ...requestIds) as PendingRow[];
    const pending = db
      .prepare(
        `SELECT request_id FROM daily_usage_pending
         WHERE user_id = ? AND request_id IN (${placeholders})`,
      )
      .all(input.userId, ...requestIds) as PendingRow[];

    const row = db
      .prepare("SELECT used FROM daily_usage WHERE user_id = ? AND day_key = ?")
      .get(input.userId, dayKey) as UsageRow | undefined;
    const used = row?.used ?? 0;

    if (completed.length > 0 || pending.length > 0) {
      const duplicateIds = [...completed, ...pending].map((entry) => entry.request_id);
      db.exec("COMMIT");
      return {
        status: "duplicate",
        usage: createDailyUsage(used, now),
        requestIds: duplicateIds,
      };
    }

    const active = pendingCount(input.userId, dayKey, now);
    if (used + active + requestIds.length > DAILY_MESSAGE_LIMIT) {
      db.exec("COMMIT");
      return { status: "limit", usage: createDailyUsage(used, now) };
    }

    const insertPending = db.prepare(
      `INSERT INTO daily_usage_pending (user_id, request_id, day_key, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    for (const requestId of requestIds) {
      insertPending.run(input.userId, requestId, dayKey, now);
    }

    db.exec("COMMIT");
    return {
      status: "reserved",
      usage: createDailyUsage(used, now),
      requestIds,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Record successful generations. Only request IDs that were reserved can be
 * committed, and repeating a commit is idempotent so a retried response never
 * charges the same logical request twice.
 */
export function commitDailyMessages(input: {
  userId: string;
  requestIds: string[];
  now?: number;
}): DailyUsage {
  const now = input.now ?? Date.now();
  const dayKey = istDayKey(now);
  const db = getDb();

  db.exec("BEGIN IMMEDIATE");
  try {
    let credited = 0;
    const checkCompleted = db.prepare(
      "SELECT request_id FROM daily_request_ids WHERE user_id = ? AND request_id = ?",
    );
    const insertCompleted = db.prepare(
      `INSERT INTO daily_request_ids (user_id, request_id, day_key, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    const deletePending = db.prepare(
      "DELETE FROM daily_usage_pending WHERE user_id = ? AND request_id = ?",
    );

    for (const requestId of Array.from(new Set(input.requestIds))) {
      const already = checkCompleted.get(input.userId, requestId) as
        | PendingRow
        | undefined;
      if (already) continue;
      insertCompleted.run(input.userId, requestId, dayKey, now);
      deletePending.run(input.userId, requestId);
      credited += 1;
    }

    if (credited > 0) {
      db.prepare(
        `INSERT INTO daily_usage (user_id, day_key, used, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, day_key)
         DO UPDATE SET used = used + excluded.used, updated_at = excluded.updated_at`,
      ).run(input.userId, dayKey, credited, now);
    }

    const row = db
      .prepare("SELECT used FROM daily_usage WHERE user_id = ? AND day_key = ?")
      .get(input.userId, dayKey) as UsageRow | undefined;
    db.exec("COMMIT");
    return createDailyUsage(row?.used ?? 0, now);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Drop in-flight reservations after a provider failure, timeout, abort, or
 * rejected request. Successful-generation counts are never touched.
 */
export function releaseDailyMessages(input: {
  userId: string;
  requestIds: string[];
}): void {
  const db = getDb();
  const statement = db.prepare(
    "DELETE FROM daily_usage_pending WHERE user_id = ? AND request_id = ?",
  );
  for (const requestId of Array.from(new Set(input.requestIds))) {
    statement.run(input.userId, requestId);
  }
}

/** Generate a server-side request ID for clients that did not supply one. */
export function newServerRequestId(): string {
  return randomUUID();
}
