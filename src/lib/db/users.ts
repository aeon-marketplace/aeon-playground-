import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { UserRow } from "@/lib/db/types";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export type PublicUser = { id: string; email: string; createdAt: number };

export function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

export async function createUser(email: string, password: string): Promise<PublicUser> {
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalized);
  if (existing) {
    throw new Error("An account with that email already exists.");
  }
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    normalized,
    passwordHash,
    Date.now(),
  );
  return { id, email: normalized, createdAt: Date.now() };
}

export function ensureUserExists(userId: string, email?: string): void {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (existing) return;
  const now = Date.now();
  try {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run(userId, email ?? `${userId}@local`, "", now);
  } catch {
    // ignore if unique constraints fail
  }
}

export function findUserByEmail(email: string): UserRow | undefined {
  return getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export async function authenticate(email: string, password: string): Promise<PublicUser | null> {
  const row = findUserByEmail(email);
  if (!row) {
    // Perform a hash to reduce the timing signal for unknown accounts.
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
  const row = findUserById(userId);
  if (!row) return false;
  if (!(await verifyPassword(currentPassword, row.password_hash))) return false;
  const hash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return true;
}

export function deleteUser(userId: string) {
  getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
}
