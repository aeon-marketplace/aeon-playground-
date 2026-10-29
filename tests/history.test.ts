import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Point the SQLite layer at a throwaway file before any getDb() call.
const tempDirectory = mkdtempSync(path.join(tmpdir(), "fap-history-"));
process.env.DATABASE_PATH = path.join(tempDirectory, "history.db");

import { closeDbForTests, getDb } from "@/lib/db";
import {
  clearHistory,
  countRuns,
  deleteRun,
  getRun,
  listRuns,
  recordRun,
} from "@/lib/db/runs";

function createUser(id: string, email: string) {
  getDb()
    .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(id, email, "not-a-real-hash", Date.now());
}

describe("test history authorization and metadata", () => {
  beforeAll(() => {
    createUser("user-a", "a@example.test");
    createUser("user-b", "b@example.test");
  });

  afterAll(() => {
    closeDbForTests();
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("stores access category and provider/model metadata at test time", () => {
    const runId = recordRun({
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

    const run = getRun("user-a", runId);
    expect(run).toMatchObject({
      accessType: "limited-free",
      providerName: "Pollinations",
      modelName: "GPT-OSS 20B (Pollinations)",
      systemPrompt: "Be brief.",
      totalTokens: 3,
      usageAvailable: true,
    });
  });

  it("hides and refuses to delete another user's run", () => {
    const runId = recordRun({
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

    expect(getRun("user-b", runId)).toBeUndefined();
    expect(listRuns("user-b")).toEqual([]);

    const denied = deleteRun("user-b", runId);
    expect(denied).toEqual({ deleted: false, imagePath: null });
    expect(getRun("user-a", runId)).toBeDefined();
  });

  it("deletes only the current user's run and returns its image path", () => {
    const runId = recordRun({
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

    expect(deleteRun("user-a", runId)).toEqual({ deleted: true, imagePath: "file.jpg" });
    expect(getRun("user-a", runId)).toBeUndefined();
  });

  it("scopes counts and clearing to the requesting user", () => {
    const beforeB = countRuns("user-b");
    recordRun({
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
    expect(countRuns("user-b")).toBe(beforeB + 1);

    const clearedA = clearHistory("user-a");
    expect(clearedA).toBeGreaterThan(0);
    expect(listRuns("user-a")).toEqual([]);
    expect(countRuns("user-b")).toBe(beforeB + 1);
  });
});
