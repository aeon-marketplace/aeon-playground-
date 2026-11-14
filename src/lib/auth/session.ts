import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { getEnv, type AppEnv } from "@/lib/env";
import { ANONYMOUS_USER_ID_PREFIX } from "@/lib/auth/ids";
import { ensureUserExists } from "@/lib/db/users";
import { hashToken } from "@/lib/crypto/secrets";
import type { SessionRow } from "@/lib/db/types";
import type { PublicUser } from "@/lib/db/users";

export const SESSION_COOKIE = "fap_session";
export const ANON_SESSION_COOKIE = "fap_anon_session";

export type AuthUser = PublicUser & { isAnonymous?: boolean };

function cookieSettings(env: AppEnv) {
  const crossSite = env.embedded || env.embedAllowedOrigins.length > 0;
  return {
    httpOnly: true,
    secure: crossSite ? true : process.env.NODE_ENV === "production",
    sameSite: crossSite ? ("none" as const) : ("lax" as const),
    partitioned: crossSite,
    path: "/",
  };
}

export async function createSession(userId: string): Promise<string> {
  const env = getEnv();
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token, env.authSecret);
  const now = Date.now();
  const expiresAt = now + env.sessionTtlDays * 24 * 60 * 60 * 1000;
  await db.query("DELETE FROM sessions WHERE expires_at < $1", [now]);
  await db.query("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)", [
    id,
    userId,
    expiresAt,
    now,
  ]);
  return token;
}

export async function setSessionCookie(token: string) {
  const env = getEnv();
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    ...cookieSettings(env),
    maxAge: env.sessionTtlDays * 24 * 60 * 60,
  });
}

export async function destroyCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const env = getEnv();
      const id = hashToken(token, env.authSecret);
      await getDb().query("DELETE FROM sessions WHERE id = $1", [id]);
    } catch {
      // Clearing the cookie is still the right action if env is misconfigured.
    }
  }
  store.delete(SESSION_COOKIE);
}

export async function clearAnonymousSessionCookie() {
  const store = await cookies();
  store.delete(ANON_SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const env = getEnv();
      const sessionId = hashToken(token, env.authSecret);
      const result = await getDb().query(
        `SELECT s.id, s.user_id, s.expires_at, s.created_at, u.email, u.created_at AS user_created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1`,
        [sessionId],
      );
      const row = result.rows[0] as
        | (SessionRow & { email: string; user_created_at: number | string })
        | undefined;
      if (row && Number(row.expires_at) >= Date.now()) {
        return { id: row.user_id, email: row.email, createdAt: Number(row.user_created_at) };
      }
      if (row && Number(row.expires_at) < Date.now()) {
        await getDb().query("DELETE FROM sessions WHERE id = $1", [sessionId]);
      }
    } catch {
      // Fall through to anonymous session
    }
  }
  const anonToken = store.get(ANON_SESSION_COOKIE)?.value;
  if (anonToken) {
    try {
      const env = getEnv();
      const anonId = hashToken(anonToken, env.authSecret);
      const userId = `${ANONYMOUS_USER_ID_PREFIX}${anonId.slice(0, 32)}`;
      try {
        await ensureUserExists(userId);
      } catch {
        // A database problem is reported by the feature that needs it.
      }
      return {
        id: userId,
        email: "visitor@local",
        createdAt: Date.now(),
        isAnonymous: true,
      };
    } catch {
      // ignore
    }
  }
  return null;
}

export async function getAnonymousUserId(): Promise<string | null> {
  const store = await cookies();
  const anonToken = store.get(ANON_SESSION_COOKIE)?.value;
  if (anonToken) {
    try {
      const env = getEnv();
      const anonId = hashToken(anonToken, env.authSecret);
      return `${ANONYMOUS_USER_ID_PREFIX}${anonId.slice(0, 32)}`;
    } catch {
      // ignore
    }
  }
  return null;
}

export async function createAnonymousSession(): Promise<string> {
  const store = await cookies();
  const env = getEnv();
  const token = randomBytes(32).toString("base64url");
  const anonId = hashToken(token, env.authSecret);
  store.set(ANON_SESSION_COOKIE, token, {
    ...cookieSettings(env),
    maxAge: 60 * 60 * 24 * 7,
  });
  const userId = `${ANONYMOUS_USER_ID_PREFIX}${anonId.slice(0, 32)}`;
  try {
    await ensureUserExists(userId);
  } catch {
    // Reported by the feature that needs the database.
  }
  return userId;
}

export async function getOrCreateAnonymousUserId(): Promise<string> {
  const existing = await getAnonymousUserId();
  if (existing) return existing;
  return createAnonymousSession();
}
