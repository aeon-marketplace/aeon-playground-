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

beforeAll(async () => {
  await closeDbForTests();
  const db = getDb();
  const now = Date.now();
  await db.query("INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)", [
    ownerId,
    "owner@example.test",
    "not-a-real-password-hash",
    now,
  ]);
  await db.query("INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)", [
    otherUserId,
    "other@example.test",
    "not-a-real-password-hash",
    now,
  ]);
});

afterAll(async () => {
  await closeDbForTests();
});

describe("custom model editing", () => {
  it("keeps, replaces, and removes encrypted keys while resetting verification", async () => {
    const id = await createCustomModel(ownerId, {
      name: "Original endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/original",
      apiKey: "sk-original-1234",
    });
    const initial = await getCustomModelRow(ownerId, id);
    expect(initial).toBeDefined();
    expect(initial && await decryptCustomKey(initial)).toBe("sk-original-1234");
    expect(initial?.key_hint).toContain("1234");

    await setCustomModelVerification(ownerId, id, { verified: true, error: null });
    expect((await getCustomModelRow(ownerId, id))?.verified).toBe(1);

    expect(
      await updateCustomModel(ownerId, id, {
        name: "Renamed endpoint",
        baseUrl: "https://api.example.test/v1/",
        modelId: "example/original",
      }),
    ).toBe(true);
    const renamed = await getCustomModelRow(ownerId, id);
    expect(renamed?.name).toBe("Renamed endpoint");
    expect(renamed?.base_url).toBe("https://api.example.test/v1");
    expect(renamed?.verified).toBe(0);
    expect(renamed?.verification_error).toBeNull();
    expect(renamed && await decryptCustomKey(renamed)).toBe("sk-original-1234");

    await updateCustomModel(ownerId, id, {
      name: "Replaced endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/replaced",
      apiKey: "sk-replaced-5678",
    });
    const replaced = await getCustomModelRow(ownerId, id);
    expect(replaced?.model_id).toBe("example/replaced");
    expect(replaced?.key_hint).toContain("5678");
    expect(replaced && await decryptCustomKey(replaced)).toBe("sk-replaced-5678");
    expect(replaced?.verified).toBe(0);

    await updateCustomModel(ownerId, id, {
      name: "Replaced endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/replaced",
      clearApiKey: true,
    });
    const cleared = await getCustomModelRow(ownerId, id);
    expect(cleared?.ciphertext).toBeNull();
    expect(cleared?.iv).toBeNull();
    expect(cleared?.tag).toBeNull();
    expect(cleared?.key_hint).toBeNull();
    expect(cleared && await decryptCustomKey(cleared)).toBeUndefined();

    const publicModel = cleared ? toPublicCustomModel(cleared) : null;
    expect(publicModel && JSON.stringify(publicModel)).not.toContain("sk-replaced-5678");
  });

  it("does not let another owner edit a custom model", async () => {
    const id = await createCustomModel(ownerId, {
      name: "Owned endpoint",
      baseUrl: "https://api.example.test/v1",
      modelId: "example/owned",
    });
    expect(
      await updateCustomModel(otherUserId, id, {
        name: "Hijacked",
        baseUrl: "https://api.example.test/v1",
        modelId: "example/hijacked",
      }),
    ).toBe(false);
    expect((await getCustomModelRow(ownerId, id))?.name).toBe("Owned endpoint");
    expect(await getCustomModelRow(otherUserId, id)).toBeUndefined();
  });

  it("rejects a replacement key combined with key removal", async () => {
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
