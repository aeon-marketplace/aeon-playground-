import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getEnv } from "@/lib/env";

const SCHEMA_VERSION = 5;

function migrate(db: DatabaseSync) {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const current = Number(row.user_version ?? 0);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than this app supports (${SCHEMA_VERSION}).`,
    );
  }
  if (current === SCHEMA_VERSION) return;

  db.exec("BEGIN");
  try {
    if (current < 1) {
      db.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_sessions_user ON sessions(user_id);
        CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

        CREATE TABLE provider_credentials (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          iv TEXT NOT NULL,
          tag TEXT NOT NULL,
          key_hint TEXT NOT NULL,
          verified INTEGER NOT NULL DEFAULT 0,
          verified_models TEXT,
          verified_at INTEGER,
          verification_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(user_id, provider_id)
        );
        CREATE INDEX idx_provider_credentials_user ON provider_credentials(user_id);

        CREATE TABLE custom_models (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          model_id TEXT NOT NULL,
          ciphertext TEXT,
          iv TEXT,
          tag TEXT,
          key_hint TEXT,
          capabilities TEXT NOT NULL DEFAULT 'text',
          verified INTEGER NOT NULL DEFAULT 0,
          verified_at INTEGER,
          verification_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_custom_models_user ON custom_models(user_id);

        CREATE TABLE test_runs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          group_id TEXT,
          model_ref TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          output TEXT,
          status TEXT NOT NULL,
          error_code TEXT,
          error_message TEXT,
          latency_ms INTEGER,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          total_tokens INTEGER,
          usage_available INTEGER NOT NULL DEFAULT 0,
          provider_request_id TEXT,
          image_path TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_test_runs_user_created ON test_runs(user_id, created_at DESC);
        CREATE INDEX idx_test_runs_group ON test_runs(group_id);

        CREATE TABLE user_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          default_model_ref TEXT,
          default_system_prompt TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL
        );
      `);
    }
    if (current < 2) {
      db.exec(`
        ALTER TABLE test_runs ADD COLUMN access_type TEXT;
        ALTER TABLE test_runs ADD COLUMN provider_name TEXT;
        ALTER TABLE test_runs ADD COLUMN model_name TEXT;
        ALTER TABLE test_runs ADD COLUMN system_prompt TEXT;
        ALTER TABLE test_runs ADD COLUMN image_width INTEGER;
        ALTER TABLE test_runs ADD COLUMN image_height INTEGER;
      `);
    }
    if (current < 3) {
      db.exec(`
        CREATE TABLE model_test_results (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          model_ref TEXT NOT NULL,
          status TEXT NOT NULL,
          error_code TEXT,
          error_message TEXT,
          latency_ms INTEGER,
          tested_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, model_ref)
        );
        CREATE INDEX idx_model_test_results_user ON model_test_results(user_id);
      `);
    }
    if (current < 4) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_usage (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          day_key TEXT NOT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, day_key)
        );
        CREATE INDEX idx_daily_usage_day ON daily_usage(day_key);

        CREATE TABLE daily_request_ids (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          day_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, request_id)
        );
        CREATE INDEX idx_daily_request_ids_created ON daily_request_ids(created_at);
      `);
    }
    if (current < 5) {
      // In-flight reservations. The committed `daily_usage.used` counter is
      // only incremented after a real provider success, so failed calls never
      // consume a visitor's successful-generation allowance.
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_usage_pending (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          day_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, request_id)
        );
        CREATE INDEX IF NOT EXISTS idx_daily_usage_pending_created
          ON daily_usage_pending(created_at);
      `);
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (databasePath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  migrate(db);
  return db;
}

const globalForDb = globalThis as unknown as {
  __playgroundDb?: DatabaseSync;
};

export function getDb(): DatabaseSync {
  if (!globalForDb.__playgroundDb) {
    globalForDb.__playgroundDb = openDatabase(getEnv().databasePath);
  }
  return globalForDb.__playgroundDb;
}

export function closeDbForTests() {
  globalForDb.__playgroundDb?.close();
  globalForDb.__playgroundDb = undefined;
}
