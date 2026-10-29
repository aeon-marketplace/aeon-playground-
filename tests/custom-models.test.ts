import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/lib/db";
import {
  createCustomModel,
  decryptCustomKey,
  getCustomModelRow,
  setCustomModelVerification,
  toPublicCustomModel,
  updateCustomModel,
} from "@/lib/db/custom-models";
import { customModelUpdateSchema } from "@/lib/validation/schemas";

const ownerId = "custom-owner";
const otherUserId = "custom-other";
const databasePath = path.join(os.tmpdir(), `free-ai-playground-test-${randomUUID()}.db`);

beforeAll(() => {
  process.env.DATABASE_PATH = databasePath;
  closeDbForTests();
  const db = getDb();
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    ownerId,
    "owner@example.test",
    "not-a-real-password-hash",
    now,
  );
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    otherUserId,
    "other@example.test",
    "not-a-real-password-hash",
    now,
  );
});

afterAll(() => {
  closeDbForTests();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

describe("custom model editing", () => {
  it("keeps, replaces, and removes encrypted keys while resetting verification", () => {
    const id = createCustomModel(ownerId, {
      name: "Original endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/original",
      apiKey: "sk-original-1234",
    });
    const initial = getCustomModelRow(ownerId, id);
    expect(initial).toBeDefined();
    expect(initial && decryptCustomKey(initial)).toBe("sk-original-1234");
    expect(initial?.key_hint).toContain("1234");

    setCustomModelVerification(ownerId, id, { verified: true, error: null });
    expect(getCustomModelRow(ownerId, id)?.verified).toBe(1);

    expect(
      updateCustomModel(ownerId, id, {
        name: "Renamed endpoint",
        baseUrl: "https://api.example.test/v1/",
        modelId: "example/original",
      }),
    ).toBe(true);
    const renamed = getCustomModelRow(ownerId, id);
    expect(renamed?.name).toBe("Renamed endpoint");
    expect(renamed?.base_url).toBe("https://api.example.test/v1");
    expect(renamed?.verified).toBe(0);
    expect(renamed?.verification_error).toBeNull();
    expect(renamed && decryptCustomKey(renamed)).toBe("sk-original-1234");

    updateCustomModel(ownerId, id, {
      name: "Replaced endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/replaced",
      apiKey: "sk-replaced-5678",
    });
    const replaced = getCustomModelRow(ownerId, id);
    expect(replaced?.model_id).toBe("example/replaced");
    expect(replaced?.key_hint).toContain("5678");
    expect(replaced && decryptCustomKey(replaced)).toBe("sk-replaced-5678");
    expect(replaced?.verified).toBe(0);

    updateCustomModel(ownerId, id, {
      name: "Replaced endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/replaced",
      clearApiKey: true,
    });
    const cleared = getCustomModelRow(ownerId, id);
    expect(cleared?.ciphertext).toBeNull();
    expect(cleared?.iv).toBeNull();
    expect(cleared?.tag).toBeNull();
    expect(cleared?.key_hint).toBeNull();
    expect(cleared && decryptCustomKey(cleared)).toBeUndefined();

    const publicModel = cleared ? toPublicCustomModel(cleared) : null;
    expect(publicModel && JSON.stringify(publicModel)).not.toContain("sk-replaced-5678");
  });

  it("does not let another owner edit a custom model", () => {
    const id = createCustomModel(ownerId, {
      name: "Owned endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/owned",
    });
    expect(
      updateCustomModel(otherUserId, id, {
        name: "Hijacked",
        baseUrl: "https://api.example.test/v1",
        modelId: "example/hijacked",
      }),
    ).toBe(false);
    expect(getCustomModelRow(ownerId, id)?.name).toBe("Owned endpoint");
    expect(getCustomModelRow(otherUserId, id)).toBeUndefined();
  });

  it("rejects a replacement key combined with key removal", () => {
    const parsed = customModelUpdateSchema.safeParse({
      name: "Endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/model",
      apiKey: "sk-new-key",
      clearApiKey: true,
    });
    expect(parsed.success).toBe(false);

    const defaults = customModelUpdateSchema.parse({
      name: "Endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/model",
    });
    expect(defaults.apiKey).toBe("");
    expect(defaults.clearApiKey).toBe(false);
  });
});
