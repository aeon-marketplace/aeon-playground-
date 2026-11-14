import { getDb } from "@/lib/db";
import type { UserSettingsRow } from "@/lib/db/types";
import { ensureUserExists } from "@/lib/db/users";

export type UserSettings = {
  defaultModelRef: string | null;
  defaultSystemPrompt: string;
  updatedAt: number;
};

export async function getSettings(userId: string): Promise<UserSettings> {
  const db = getDb();
  try {
    await ensureUserExists(userId);
  } catch {
    // best effort
  }
  const result = await db.query("SELECT * FROM user_settings WHERE user_id = $1", [userId]);
  let row = result.rows[0] as UserSettingsRow | undefined;
  if (!row) {
    const now = Date.now();
    try {
      await db.query(
        "INSERT INTO user_settings (user_id, default_model_ref, default_system_prompt, updated_at) VALUES ($1, NULL, '', $2)",
        [userId, now],
      );
    } catch {
      try {
        await ensureUserExists(userId);
        await db.query(
          "INSERT INTO user_settings (user_id, default_model_ref, default_system_prompt, updated_at) VALUES ($1, NULL, '', $2)",
          [userId, now],
        );
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
    updatedAt: Number(row.updated_at),
  };
}

export async function updateSettings(
  userId: string,
  input: { defaultModelRef?: string | null; defaultSystemPrompt?: string },
): Promise<UserSettings> {
  const current = await getSettings(userId);
  const defaultModelRef =
    input.defaultModelRef === undefined ? current.defaultModelRef : input.defaultModelRef;
  const defaultSystemPrompt =
    input.defaultSystemPrompt === undefined
      ? current.defaultSystemPrompt
      : input.defaultSystemPrompt;
  await getDb().query(
    "UPDATE user_settings SET default_model_ref = $1, default_system_prompt = $2, updated_at = $3 WHERE user_id = $4",
    [defaultModelRef, defaultSystemPrompt, Date.now(), userId],
  );
  return await getSettings(userId);
}
