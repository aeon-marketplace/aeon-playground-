import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDbForTests, getDb } from "@/lib/db";
import {
  clearHistory,
  countRuns,
  deleteRun,
  getRun,
  listRuns,
  recordRun,
} from "@/lib/db/runs";

async function createUser(id: string, email: string) {
  await getDb().query("INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)", [
    id,
    email,
    "not-a-real-hash",
    Date.now(),
  ]);
}

describe("test history authorization and metadata", () => {
  beforeAll(async () => {
    await createUser("user-a", "a@example.test");
    await createUser("user-b", "b@example.test");
  });

  afterAll(async () => {
    await closeDbForTests();
  });

  it("stores access category and provider/model metadata at test time", async () => {
    const runId = await recordRun({
      userId: "user-a",
      kind: "chat",
      modelRef: "pollinations::openai-fast",
      providerId: "pollinations",
      modelId: "openai-fast",
      providerName: "Pollinations",
      modelName: "GPT-OSS 20B (Pollinations)",
      prompt: "hello",
      output: "world",
      status: "success",
      latencyMs: 123,
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      usageAvailable: true,
      accessType: "limited-free",
      systemPrompt: "Be brief.",
    });

    const run = await getRun("user-a", runId);
    expect(run).toMatchObject({
      accessType: "limited-free",
      providerName: "Pollinations",
      modelName: "GPT-OSS 20B (Pollinations)",
      systemPrompt: "Be brief.",
      totalTokens: 3,
      usageAvailable: true,
    });
  });

  it("hides and refuses to delete another user's run", async () => {
    const runId = await recordRun({
      userId: "user-a",
      kind: "chat",
      modelRef: "pollinations::openai-fast",
      providerId: "pollinations",
      modelId: "openai-fast",
      prompt: "private prompt",
      output: "private output",
      status: "success",
      accessType: "limited-free",
    });

    expect(await getRun("user-b", runId)).toBeUndefined();
    expect(await listRuns("user-b")).toEqual([]);

    const denied = await deleteRun("user-b", runId);
    expect(denied).toEqual({ deleted: false, imagePath: null });
    expect(await getRun("user-a", runId)).toBeDefined();
  });

  it("deletes only the current user's run and returns its image path", async () => {
    const runId = await recordRun({
      userId: "user-a",
      kind: "image",
      modelRef: "pollinations::flux",
      providerId: "pollinations",
      modelId: "flux",
      prompt: "a cat",
      status: "success",
      accessType: "limited-free",
      imagePath: "file.jpg",
      imageWidth: 512,
      imageHeight: 512,
    });

    expect(await deleteRun("user-a", runId)).toEqual({ deleted: true, imagePath: "file.jpg" });
    expect(await getRun("user-a", runId)).toBeUndefined();
  });

  it("scopes counts and clearing to the requesting user", async () => {
    const beforeB = await countRuns("user-b");
    await recordRun({
      userId: "user-b",
      kind: "chat",
      modelRef: "pollinations::openai-fast",
      providerId: "pollinations",
      modelId: "openai-fast",
      prompt: "b prompt",
      status: "error",
      errorCode: "rate_limit",
      errorMessage: "slow down",
      accessType: "limited-free",
    });
    expect(await countRuns("user-b")).toBe(beforeB + 1);

    const clearedA = await clearHistory("user-a");
    expect(clearedA).toBeGreaterThan(0);
    expect(await listRuns("user-a")).toEqual([]);
    expect(await countRuns("user-b")).toBe(beforeB + 1);
  });
});
