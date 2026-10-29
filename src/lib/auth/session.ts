import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { getEnv, type AppEnv } from "@/lib/env";
import { ANONYMOUS_USER_ID_PREFIX } from "@/lib/auth/ids";
import { ensureUserExists } from "@/lib/db/users";
import { hashToken } from "@/lib/crypto/secrets";
import type { SessionRow, UserRow } from "@/lib/db/types";
import type { PublicUser } from "@/lib/db/users";

export const SESSION_COOKIE = "fap_session";
export const ANON_SESSION_COOKIE = "fap_anon_session";

export type AuthUser = PublicUser & { isAnonymous?: boolean };

/**
 * Cross-site iframe sessions need SameSite=None cookies. Chrome also requires
 * Secure and recommends Partitioned (CHIPS) so the visitor's limits and keys
 * stay isolated per embedding site. Keep Lax outside embed mode.
 */
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
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    userId,
    expiresAt,
    now,
  );
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
      getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
    } catch {
      // Clearing the cookie is still the right action if env is misconfigured.
    }
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Drop the anonymous credential after a successful sign-in or registration.
 * Otherwise logging out would silently resurrect keys and custom endpoints
 * saved by a previous anonymous visit to this browser.
 */
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
      const row = getDb()
        .prepare(
          `SELECT s.id, s.user_id, s.expires_at, s.created_at, u.email, u.created_at AS user_created_at
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.id = ?`,
        )
        .get(sessionId) as (SessionRow & { email: string; user_created_at: number }) | undefined;
      if (row && row.expires_at >= Date.now()) {
        return { id: row.user_id, email: row.email, createdAt: row.user_created_at };
      }
      if (row && row.expires_at < Date.now()) {
        getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      }
    } catch {
      // Fall through to anonymous session
    }
  }
  // Check for anonymous session
  const anonToken = store.get(ANON_SESSION_COOKIE)?.value;
  if (anonToken) {
    try {
      const env = getEnv();
      const anonId = hashToken(anonToken, env.authSecret);
      // Anonymous user id is derived from anon session; use a stable anon id
      const userId = `${ANONYMOUS_USER_ID_PREFIX}${anonId.slice(0, 32)}`;
      try {
        // Provider keys, custom endpoints, and preferences are stored against
        // this id, so the users row must exist before any foreign-keyed write.
        ensureUserExists(userId);
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
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  const userId = `${ANONYMOUS_USER_ID_PREFIX}${anonId.slice(0, 32)}`;
  try {
    ensureUserExists(userId);
  } catch {
    // Reported by the feature that needs the database.
  }
  return userId;
}

export async function getOrCreateAnonymousUserId(): Promise<string> {
  const existing = await getAnonymousUserId();
  if (existing) return existing;
  // Route Handlers and Server Actions may set cookies. A Server Component
  // cannot, so fail loudly there rather than writing data under an id the
  // browser will never see again.
  return createAnonymousSession();
}

export function findUserRowForSession(userId: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
}
