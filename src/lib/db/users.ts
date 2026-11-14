import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { UserRow } from "@/lib/db/types";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export type PublicUser = { id: string; email: string; createdAt: number };

export function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, createdAt: Number(row.created_at) };
}

export async function createUser(email: string, password: string): Promise<PublicUser> {
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const existing = await db.query("SELECT id FROM users WHERE email = $1", [normalized]);
  if (existing.rows[0]) {
    throw new Error("An account with that email already exists.");
  }
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  await db.query(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)",
    [id, normalized, passwordHash, now],
  );
  return { id, email: normalized, createdAt: now };
}

export async function ensureUserExists(userId: string, email?: string): Promise<void> {
  const db = getDb();
  const existing = await db.query("SELECT id FROM users WHERE id = $1", [userId]);
  if (existing.rows[0]) return;
  const now = Date.now();
  try {
    await db.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)",
      [userId, email ?? `${userId}@local`, "", now],
    );
  } catch {
    // ignore if unique constraints fail
  }
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const result = await getDb().query("SELECT * FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  return result.rows[0] as UserRow | undefined;
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const result = await getDb().query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] as UserRow | undefined;
}

export async function authenticate(email: string, password: string): Promise<PublicUser | null> {
  const row = await findUserByEmail(email);
  if (!row) {
    await verifyPassword(password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA");
    return null;
  }
  const ok = await verifyPassword(password, row.password_hash);
  return ok ? toPublicUser(row) : null;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const db = getDb();
  const row = await findUserById(userId);
  if (!row) return false;
  if (!(await verifyPassword(currentPassword, row.password_hash))) return false;
  const hash = await hashPassword(newPassword);
  await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, userId]);
  await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  return true;
}

export async function deleteUser(userId: string): Promise<void> {
  await getDb().query("DELETE FROM users WHERE id = $1", [userId]);
}
