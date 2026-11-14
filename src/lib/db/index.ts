import { mkdirSync } from "node:fs";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { getEnv } from "@/lib/env";

export type SqlRow = Record<string, unknown>;

export type QueryResult = {
  rows: SqlRow[];
  rowCount: number;
};

export type DbClient = {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
};

export type DbAdapter = DbClient & {
  transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_models TEXT,
  verified_at BIGINT,
  verification_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_user ON provider_credentials(user_id);

CREATE TABLE IF NOT EXISTS custom_models (
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
  verified_at BIGINT,
  verification_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_models_user ON custom_models(user_id);

CREATE TABLE IF NOT EXISTS test_runs (
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
  latency_ms BIGINT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  usage_available INTEGER NOT NULL DEFAULT 0,
  provider_request_id TEXT,
  image_path TEXT,
  access_type TEXT,
  provider_name TEXT,
  model_name TEXT,
  system_prompt TEXT,
  image_width INTEGER,
  image_height INTEGER,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_runs_user_created ON test_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_runs_group ON test_runs(group_id);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_model_ref TEXT,
  default_system_prompt TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_test_results (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  latency_ms BIGINT,
  tested_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, model_ref)
);
CREATE INDEX IF NOT EXISTS idx_model_test_results_user ON model_test_results(user_id);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, day_key)
);
CREATE INDEX IF NOT EXISTS idx_daily_usage_day ON daily_usage(day_key);

CREATE TABLE IF NOT EXISTS daily_request_ids (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_request_ids_created ON daily_request_ids(created_at);

CREATE TABLE IF NOT EXISTS daily_usage_pending (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_usage_pending_created ON daily_usage_pending(created_at);
`;

class PgAdapter implements DbAdapter {
  private pool: Pool;
  private schemaReady: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl:
        connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
          ? false
          : { rejectUnauthorized: false },
      max: 10,
    });
  }

  private async ensureSchema() {
    if (!this.schemaReady) {
      this.schemaReady = this.pool.query(SCHEMA_SQL).then(() => undefined);
    }
    await this.schemaReady;
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResult> {
    await this.ensureSchema();
    const result = await this.pool.query(text, params);
    return { rows: result.rows as SqlRow[], rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    const adapter: DbClient = {
      query: async (text, params = []) => {
        const result = await client.query(text, params);
        return { rows: result.rows as SqlRow[], rowCount: result.rowCount ?? 0 };
      },
    };
    try {
      await client.query("BEGIN");
      const value = await fn(adapter);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

class PgliteAdapter implements DbAdapter {
  private db: PGlite;
  private schemaReady: Promise<void> | null = null;

  constructor(dataDir?: string) {
    if (!dataDir || dataDir === "memory" || dataDir === "memory://") {
      this.db = new PGlite();
    } else {
      this.db = new PGlite(dataDir);
    }
  }

  private async ensureSchema() {
    if (!this.schemaReady) {
      this.schemaReady = this.db.exec(SCHEMA_SQL).then(() => undefined);
    }
    await this.schemaReady;
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResult> {
    await this.ensureSchema();
    const result = await this.db.query(text, params);
    return { rows: result.rows as SqlRow[], rowCount: result.affectedRows ?? result.rows.length };
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    await this.ensureSchema();
    const client: DbClient = {
      query: async (text, params = []) => {
        const result = await this.db.query(text, params);
        return { rows: result.rows as SqlRow[], rowCount: result.affectedRows ?? result.rows.length };
      },
    };
    await this.db.query("BEGIN");
    try {
      const value = await fn(client);
      await this.db.query("COMMIT");
      return value;
    } catch (error) {
      await this.db.query("ROLLBACK");
      throw error;
    }
  }

  async close() {
    await this.db.close();
  }
}

const globalForDb = globalThis as unknown as {
  __playgroundDb?: DbAdapter;
};

export function getDb(): DbAdapter {
  if (!globalForDb.__playgroundDb) {
    const env = getEnv();
    if (env.databaseUrl) {
      globalForDb.__playgroundDb = new PgAdapter(env.databaseUrl);
    } else {
      const dataDir = process.env.PGLITE_DATA_DIR || "./data/pglite";
      try {
        mkdirSync(dataDir, { recursive: true });
      } catch {
        // PGlite can create its own parent in most cases.
      }
      globalForDb.__playgroundDb = new PgliteAdapter(dataDir);
    }
  }
  return globalForDb.__playgroundDb;
}

export async function closeDbForTests() {
  await globalForDb.__playgroundDb?.close();
  globalForDb.__playgroundDb = undefined;
}
