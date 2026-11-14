import { getCurrentUser, getOrCreateAnonymousUserId } from "@/lib/auth/session";
import { ApiError, readRequestId } from "@/lib/http/api";
import {
  commitDailyMessages,
  newServerRequestId,
  releaseDailyMessages,
  reserveDailyMessages,
} from "@/lib/usage/daily-limit";
import { DAILY_LIMIT_MESSAGE, type DailyUsage } from "@/lib/usage/policy";

export type VisitorIdentity = {
  userId: string;
  isAnonymous: boolean;
};

export type GenerationReservation = VisitorIdentity & {
  usage: DailyUsage;
  requestIds: string[];
  commit(count?: number): Promise<DailyUsage>;
  release(): Promise<void>;
};

export async function resolveVisitorIdentity(): Promise<VisitorIdentity> {
  const user = await getCurrentUser();
  if (user) {
    return { userId: user.id, isAnonymous: Boolean(user.isAnonymous) };
  }
  return { userId: await getOrCreateAnonymousUserId(), isAnonymous: true };
}

function requestIdsFor(requestId: string | null, count: number): string[] {
  const base = requestId ?? newServerRequestId();
  if (count <= 1) return [base];
  return Array.from({ length: count }, (_, index) => `${base}:${index + 1}`);
}

export async function reserveGeneration(input: {
  userId: string;
  requestId: string | null;
  count?: number;
  now?: number;
}): Promise<GenerationReservation> {
  const count = Math.max(1, Math.trunc(input.count ?? 1));
  const reservation = await reserveDailyMessages({
    userId: input.userId,
    requestIds: requestIdsFor(input.requestId, count),
    now: input.now,
  });

  if (reservation.status === "limit") {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((reservation.usage.resetAt - Date.now()) / 1000),
    );
    throw new ApiError(429, "daily_limit_reached", DAILY_LIMIT_MESSAGE, {
      retryAfterSeconds,
      details:
        "The 10-successful-generation allowance is shared by text, image, comparison, and connection tests. Failed provider calls do not consume it.",
      extra: { dailyUsage: reservation.usage },
    });
  }

  if (reservation.status === "duplicate") {
    throw new ApiError(
      409,
      "duplicate_request",
      "This request was already submitted. Change the prompt or model before trying again.",
      {
        details:
          "Duplicate submissions are rejected without using another generation.",
        extra: { dailyUsage: reservation.usage },
      },
    );
  }

  return {
    userId: input.userId,
    isAnonymous: false,
    usage: reservation.usage,
    requestIds: reservation.requestIds,
    commit: async (commitCount?: number) => {
      const billed = reservation.requestIds.slice(
        0,
        Math.max(0, Math.min(reservation.requestIds.length, Math.trunc(commitCount ?? reservation.requestIds.length))),
      );
      const usage = await commitDailyMessages({
        userId: input.userId,
        requestIds: billed,
        now: input.now,
      });
      const unbilled = reservation.requestIds.filter((id) => !billed.includes(id));
      if (unbilled.length > 0) {
        await releaseDailyMessages({ userId: input.userId, requestIds: unbilled });
      }
      return usage;
    },
    release: async () =>
      await releaseDailyMessages({
        userId: input.userId,
        requestIds: reservation.requestIds,
      }),
  };
}

export async function beginGeneration(
  request: Request,
  options: { count?: number } = {},
): Promise<GenerationReservation> {
  const identity = await resolveVisitorIdentity();
  const reservation = await reserveGeneration({
    userId: identity.userId,
    requestId: readRequestId(request),
    count: options.count,
  });
  return { ...reservation, ...identity };
}
