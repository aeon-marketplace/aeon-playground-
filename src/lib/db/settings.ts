import { getDb } from "@/lib/db";
import type { UserSettingsRow } from "@/lib/db/types";
import { ensureUserExists } from "@/lib/db/users";

export type UserSettings = {
  defaultModelRef: string | null;
  defaultSystemPrompt: string;
  updatedAt: number;
};

export function getSettings(userId: string): UserSettings {
  const db = getDb();
  try {
    ensureUserExists(userId);
  } catch {
    // best effort
  }
  let row = db
    .prepare("SELECT * FROM user_settings WHERE user_id = ?")
    .get(userId) as UserSettingsRow | undefined;
  if (!row) {
    const now = Date.now();
    try {
      db.prepare(
        "INSERT INTO user_settings (user_id, default_model_ref, default_system_prompt, updated_at) VALUES (?, NULL, '', ?)",
      ).run(userId, now);
    } catch {
      // If FK still fails, ensure user and retry once
      try {
        ensureUserExists(userId);
        db.prepare(
          "INSERT INTO user_settings (user_id, default_model_ref, default_system_prompt, updated_at) VALUES (?, NULL, '', ?)",
        ).run(userId, now);
      } catch {
        // ignore
      }
    }
    row = {
      user_id: userId,
      default_model_ref: null,
      default_system_prompt: "",
      updated_at: now,
    };
  }
  return {
    defaultModelRef: row.default_model_ref,
    defaultSystemPrompt: row.default_system_prompt,
    updatedAt: row.updated_at,
  };
}

export function updateSettings(
  userId: string,
  input: { defaultModelRef?: string | null; defaultSystemPrompt?: string },
): UserSettings {
  const current = getSettings(userId);
  const defaultModelRef =
    input.defaultModelRef === undefined ? current.defaultModelRef : input.defaultModelRef;
  const defaultSystemPrompt =
    input.defaultSystemPrompt === undefined
      ? current.defaultSystemPrompt
      : input.defaultSystemPrompt;
  getDb()
    .prepare(
      "UPDATE user_settings SET default_model_ref = ?, default_system_prompt = ?, updated_at = ? WHERE user_id = ?",
    )
    .run(defaultModelRef, defaultSystemPrompt, Date.now(), userId);
  return getSettings(userId);
}
