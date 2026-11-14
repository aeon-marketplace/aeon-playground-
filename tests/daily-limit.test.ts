import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDbForTests, getDb } from "@/lib/db";
import {
  commitDailyMessages,
  getDailyUsage,
  newServerRequestId,
  releaseDailyMessages,
  reserveDailyMessages,
} from "@/lib/usage/daily-limit";
import {
  DAILY_LIMIT_MESSAGE,
  DAILY_MESSAGE_LIMIT,
  createDailyUsage,
  dailyUsageCounter,
  fullDailyUsage,
  istDayKey,
  istResetAt,
} from "@/lib/usage/policy";

/** 2026-10-27 12:00:00 IST. */
const NOON_IST = Date.parse("2026-10-27T06:30:00.000Z");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function requestIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, () => `${prefix}-${newServerRequestId()}`);
}

/** Reserve and immediately commit a successful generation. */
async function succeed(userId: string, now = NOON_IST, count = 1) {
  const ids = requestIds("ok", count);
  const reservation = await reserveDailyMessages({ userId, requestIds: ids, now });
  expect(reservation.status).toBe("reserved");
  return await commitDailyMessages({ userId, requestIds: ids, now });
}

describe("daily generation policy math", () => {
  it("uses midnight Asia/Kolkata for day keys and resets", async () => {
    const lastMomentOfDay = Date.parse("2026-10-27T18:29:59.999Z");
    expect(istDayKey(lastMomentOfDay)).toBe("2026-10-27");
    // 18:30Z is exactly 00:00 IST on the next calendar day.
    expect(istResetAt(lastMomentOfDay)).toBe(Date.parse("2026-10-27T18:30:00.000Z"));

    const firstMomentOfNextDay = Date.parse("2026-10-27T18:30:00.000Z");
    expect(istDayKey(firstMomentOfNextDay)).toBe("2026-10-28");
    expect(istResetAt(firstMomentOfNextDay)).toBe(Date.parse("2026-10-28T18:30:00.000Z"));
  });

  it("renders the exact used/remaining counter and exhaustion message", async () => {
    expect(DAILY_MESSAGE_LIMIT).toBe(10);
    expect(dailyUsageCounter(fullDailyUsage(NOON_IST))).toBe(
      "0/10 used · 10 remaining today",
    );
    expect(dailyUsageCounter(createDailyUsage(3, NOON_IST))).toBe(
      "3/10 used · 7 remaining today",
    );
    expect(createDailyUsage(9, NOON_IST).exhausted).toBe(false);
    expect(createDailyUsage(10, NOON_IST).exhausted).toBe(true);
    expect(DAILY_LIMIT_MESSAGE).toBe(
      "You've used all 10 successful generations for today. Your limit resets at midnight IST.",
    );
  });

  it("clamps impossible stored counts instead of returning negative remaining", async () => {
    expect(createDailyUsage(-5, NOON_IST).used).toBe(0);
    expect(createDailyUsage(99, NOON_IST).remaining).toBe(0);
    expect(createDailyUsage(99, NOON_IST).exhausted).toBe(true);
  });
});

describe("daily generation accounting", () => {
  beforeAll(async () => {
    // Create the visitors up front so per-visitor isolation is explicit.
    for (const id of ["visitor-a", "visitor-b", "visitor-c", "visitor-d"]) {
      await getDb().query("INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)", [
        id,
        `${id}@example.test`,
        "",
        NOON_IST,
      ]);
    }
  });

  afterAll(async () => {
    await closeDbForTests();
  });

  it("reserves capacity without charging until the provider succeeds", async () => {
    const userId = "visitor-a";
    const ids = requestIds("pending", 1);
    const reservation = await reserveDailyMessages({ userId, requestIds: ids, now: NOON_IST });

    expect(reservation.status).toBe("reserved");
    // Nothing has been generated yet, so nothing is used.
    expect(reservation.usage.used).toBe(0);
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(0);

    const committed = await commitDailyMessages({ userId, requestIds: ids, now: NOON_IST });
    expect(committed.used).toBe(1);
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(1);
  });

  it("releases a failed provider call so it never consumes the allowance", async () => {
    const userId = "visitor-d";
    const ids = requestIds("failed", 1);
    const reservation = await reserveDailyMessages({ userId, requestIds: ids, now: NOON_IST });
    expect(reservation.status).toBe("reserved");

    // Simulate a timeout or provider error after the reservation.
    await releaseDailyMessages({ userId, requestIds: ids });

    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(0);
    expect((await getDailyUsage(userId, NOON_IST)).remaining).toBe(10);

    // The visitor can retry the same logical request after the failure.
    const retry = await reserveDailyMessages({ userId, requestIds: ids, now: NOON_IST });
    expect(retry.status).toBe("reserved");
    expect((await commitDailyMessages({ userId, requestIds: ids, now: NOON_IST })).used).toBe(1);
  });

  it("accepts exactly 10 successful generations and blocks the 11th", async () => {
    const userId = "visitor-b";
    for (let index = 0; index < 10; index += 1) {
      expect((await succeed(userId)).used).toBe(index + 1);
    }

    const blocked = await reserveDailyMessages({
      userId,
      requestIds: requestIds("eleven", 1),
      now: NOON_IST,
    });
    expect(blocked.status).toBe("limit");
    expect(blocked.usage.used).toBe(10);
    expect(blocked.usage.remaining).toBe(0);
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(10);
  });

  it("counts in-flight reservations toward the cap to prevent overshoot", async () => {
    const userId = "visitor-c";
    const batch = requestIds("inflight", 10);
    const reserved = await reserveDailyMessages({ userId, requestIds: batch, now: NOON_IST });

    expect(reserved.status).toBe("reserved");
    // In-flight work is reserved but not yet charged.
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(0);

    const blocked = await reserveDailyMessages({
      userId,
      requestIds: requestIds("inflight-extra", 1),
      now: NOON_IST,
    });
    expect(blocked.status).toBe("limit");
    expect(blocked.usage.used).toBe(0);

    // Releasing the in-flight batch restores the full allowance.
    await releaseDailyMessages({ userId, requestIds: batch });
    expect((await getDailyUsage(userId, NOON_IST)).remaining).toBe(10);
  });

  it("rejects a replayed request ID without charging twice", async () => {
    const userId = "visitor-repeat";
    const ids = ["req-repeat-1"];
    expect(
      (await reserveDailyMessages({ userId, requestIds: ids, now: NOON_IST })).status,
    ).toBe("reserved");
    expect((await commitDailyMessages({ userId, requestIds: ids, now: NOON_IST })).used).toBe(1);

    const replay = await reserveDailyMessages({ userId, requestIds: ids, now: NOON_IST });
    expect(replay.status).toBe("duplicate");
    expect(replay.usage.used).toBe(1);

    // A repeated commit (for example a retried response) is idempotent.
    expect((await commitDailyMessages({ userId, requestIds: ids, now: NOON_IST })).used).toBe(1);
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(1);
  });

  it("treats an in-flight request ID as a duplicate", async () => {
    const userId = "visitor-double-submit";
    const ids = ["req-same-submit"];
    expect(
      (await reserveDailyMessages({ userId, requestIds: ids, now: NOON_IST })).status,
    ).toBe("reserved");

    const replay = await reserveDailyMessages({ userId, requestIds: ids, now: NOON_IST });
    expect(replay.status).toBe("duplicate");
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(0);
  });

  it("commits only the successful models in a comparison batch", async () => {
    const userId = "visitor-compare";
    const batch = requestIds("cmp", 3);
    const reserved = await reserveDailyMessages({ userId, requestIds: batch, now: NOON_IST });
    expect(reserved.status).toBe("reserved");
    expect(reserved.usage.used).toBe(0);

    // Two of the three compared models succeeded.
    const usage = await commitDailyMessages({
      userId,
      requestIds: batch.slice(0, 2),
      now: NOON_IST,
    });
    expect(usage.used).toBe(2);

    // The failed slot was never committed; its pending reservation remains until
    // the caller releases it.
    await releaseDailyMessages({ userId, requestIds: batch.slice(2) });
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(2);
  });

  it("shares one counter across every kind of generation request", async () => {
    const userId = "visitor-shared";
    // Different routes pass different request-ID prefixes; all land in the same
    // daily_usage row for the visitor.
    expect((await succeed(userId)).used).toBe(1);
    expect((await succeed(userId)).used).toBe(2);
    expect((await succeed(userId)).used).toBe(3);
    expect((await succeed(userId)).used).toBe(4);
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(4);
    expect(dailyUsageCounter(await getDailyUsage(userId, NOON_IST))).toBe(
      "4/10 used · 6 remaining today",
    );
  });

  it("blocks an oversized batch atomically", async () => {
    const userId = "visitor-batch";
    expect((await succeed(userId)).used).toBe(1);

    const tooLarge = await reserveDailyMessages({
      userId,
      requestIds: requestIds("batch", 10),
      now: NOON_IST,
    });
    expect(tooLarge.status).toBe("limit");
    expect(tooLarge.usage.used).toBe(1);
    // A rejected batch reserves nothing.
    expect((await reserveDailyMessages({ userId, requestIds: requestIds("single", 1), now: NOON_IST })).status).toBe(
      "reserved",
    );
  });

  it("keeps each visitor's allowance isolated", async () => {
    const userA = "isolated-a";
    const userB = "isolated-b";
    for (let index = 0; index < 10; index += 1) await succeed(userA);
    expect((await getDailyUsage(userA, NOON_IST)).used).toBe(10);
    expect((await getDailyUsage(userB, NOON_IST)).used).toBe(0);
    expect(
      (await reserveDailyMessages({ userId: userB, requestIds: ["iso-b-1"], now: NOON_IST })).status,
    ).toBe("reserved");
  });

  it("does not count a rejected batch (duplicate IDs inside one reservation)", async () => {
    const userId = "invalid-batch";
    await expect(
      reserveDailyMessages({
        userId,
        requestIds: ["same-id", "same-id"],
        now: NOON_IST,
      }),
    ).rejects.toThrow(/unique request IDs/);
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(0);
  });

  it("resets at midnight IST and keeps the previous day's row", async () => {
    const userId = "reset-visitor";
    for (let index = 0; index < 10; index += 1) await succeed(userId);
    expect((await getDailyUsage(userId, NOON_IST)).exhausted).toBe(true);

    const justBeforeReset = Date.parse("2026-10-27T18:29:59.999Z");
    expect((await getDailyUsage(userId, justBeforeReset)).used).toBe(10);
    expect((await getDailyUsage(userId, justBeforeReset)).dayKey).toBe("2026-10-27");

    const justAfterReset = Date.parse("2026-10-27T18:30:00.000Z");
    expect((await getDailyUsage(userId, justAfterReset)).used).toBe(0);
    expect((await getDailyUsage(userId, justAfterReset)).remaining).toBe(10);
    expect((await getDailyUsage(userId, justAfterReset)).dayKey).toBe("2026-10-28");

    // A new successful generation after the reset is tracked on the new day.
    expect((await succeed(userId, justAfterReset)).used).toBe(1);
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(10);

    const twoDaysLater = justAfterReset + ONE_DAY_MS;
    expect((await getDailyUsage(userId, twoDaysLater)).used).toBe(0);
  });

  it("expires idempotency records after the retention window", async () => {
    const userId = "retention-visitor";
    const now = NOON_IST;
    const ids = ["retained-id"];
    expect(
      (await reserveDailyMessages({ userId, requestIds: ids, now })).status,
    ).toBe("reserved");
    await commitDailyMessages({ userId, requestIds: ids, now });

    const replay = await reserveDailyMessages({ userId, requestIds: ids, now });
    expect(replay.status).toBe("duplicate");

    // Eight days later the old IDs have been pruned and the day counter reset,
    // so the same ID is treated as a fresh request.
    const later = now + 8 * ONE_DAY_MS;
    const again = await reserveDailyMessages({ userId, requestIds: ["retained-id"], now: later });
    expect(again.status).toBe("reserved");
    expect(again.usage.used).toBe(0);
  });

  it("expires abandoned in-flight reservations", async () => {
    const userId = "abandoned-visitor";
    const ids = requestIds("abandoned", 10);
    expect((await reserveDailyMessages({ userId, requestIds: ids, now: NOON_IST })).status).toBe(
      "reserved",
    );
    expect((await getDailyUsage(userId, NOON_IST)).used).toBe(0);

    // A crashed worker never commits or releases. After the pending retention
    // window the slots are reclaimed without charging the visitor.
    const muchLater = NOON_IST + 6 * ONE_DAY_MS;
    expect((await reserveDailyMessages({
      userId,
      requestIds: requestIds("after-crash", 10),
      now: muchLater,
    })).status).toBe("reserved");
    expect((await getDailyUsage(userId, muchLater)).used).toBe(0);
  });
});
