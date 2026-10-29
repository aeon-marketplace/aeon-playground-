/**
 * Visitor test-message policy.
 *
 * This module is intentionally free of server-only imports so the playground
 * client can share the exact counter text and reset rules without bundling the
 * database layer.
 */

export const DAILY_MESSAGE_LIMIT = 10;
export const DAILY_RESET_LABEL = "midnight IST";
export const DAILY_LIMIT_MESSAGE =
  "You've used all 10 successful generations for today. Your limit resets at midnight IST.";

/**
 * Asia/Kolkata is UTC+05:30 all year (there is no daylight-saving change), so
 * plain arithmetic is deterministic and testable without a timezone database.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type DailyUsage = {
  limit: number;
  used: number;
  remaining: number;
  dayKey: string;
  /** Epoch milliseconds of the next 00:00 Asia/Kolkata. */
  resetAt: number;
  resetLabel: string;
  exhausted: boolean;
};

/** Calendar date in Asia/Kolkata, formatted YYYY-MM-DD. */
export function istDayKey(now: number = Date.now()): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Epoch milliseconds of the next midnight in Asia/Kolkata after `now`. */
export function istResetAt(now: number = Date.now()): number {
  const shifted = new Date(now + IST_OFFSET_MS);
  const nextMidnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  );
  return nextMidnightUtc - IST_OFFSET_MS;
}

export function createDailyUsage(used: number, now: number = Date.now()): DailyUsage {
  const safeUsed = Math.max(0, Math.min(DAILY_MESSAGE_LIMIT, Math.trunc(used)));
  return {
    limit: DAILY_MESSAGE_LIMIT,
    used: safeUsed,
    remaining: DAILY_MESSAGE_LIMIT - safeUsed,
    dayKey: istDayKey(now),
    resetAt: istResetAt(now),
    resetLabel: DAILY_RESET_LABEL,
    exhausted: safeUsed >= DAILY_MESSAGE_LIMIT,
  };
}

/** Full allowance for a visitor who has not used a message today. */
export function fullDailyUsage(now: number = Date.now()): DailyUsage {
  return createDailyUsage(0, now);
}

/** Exact counter text required by the playground UI. */
export function dailyUsageCounter(usage: DailyUsage): string {
  return `${usage.used}/${usage.limit} used · ${usage.remaining} remaining today`;
}
