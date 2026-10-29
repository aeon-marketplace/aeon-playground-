import { afterEach, describe, expect, it } from "vitest";
import { ANONYMOUS_USER_ID_PREFIX, isAnonymousUserId } from "@/lib/auth/ids";
import { MODELS, getProvider } from "@/lib/providers/registry";
import {
  getPlaygroundModels,
  getSelectableModels,
  isPublicModelRef,
  resolveModelTarget,
} from "@/lib/providers/runtime";

const originalRefs = process.env.PUBLIC_MODEL_REFS;

afterEach(() => {
  if (originalRefs === undefined) {
    delete process.env.PUBLIC_MODEL_REFS;
  } else {
    process.env.PUBLIC_MODEL_REFS = originalRefs;
  }
});

describe("public model access", () => {
  it("selects only explicitly allowlisted, keyless, verified models", async () => {
    process.env.PUBLIC_MODEL_REFS = "pollinations::openai-fast,pollinations::flux";
    const models = await getSelectableModels(null);
    expect(models.map((model) => model.ref).sort()).toEqual([
      "pollinations::flux",
      "pollinations::openai-fast",
    ]);
    expect(models.every((model) => getProvider(model.providerId)?.requiresKey === false)).toBe(
      true,
    );

    const text = await getPlaygroundModels(null, "text");
    const image = await getPlaygroundModels(null, "image");
    expect(text.map((model) => model.ref)).toEqual(["pollinations::openai-fast"]);
    expect(image.map((model) => model.ref)).toEqual(["pollinations::flux"]);
    expect(text[0]?.playgroundLabel).toBe("LIMITED FREE — Tested");
    expect(image[0]?.playgroundLabel).toBe("LIMITED FREE — Tested");
  });

  it("disables public execution when the allowlist is set to none", async () => {
    process.env.PUBLIC_MODEL_REFS = "none";
    await expect(getSelectableModels(null)).resolves.toEqual([]);
    await expect(resolveModelTarget(null, "pollinations::openai-fast")).rejects.toMatchObject({
      code: "config",
    });
  });

  it("rejects key-based models for anonymous visitors", async () => {
    process.env.PUBLIC_MODEL_REFS = "pollinations::openai-fast";
    const keyModel = MODELS.find((model) => getProvider(model.providerId)?.requiresKey);
    expect(keyModel).toBeDefined();
    await expect(resolveModelTarget(null, keyModel!.ref)).rejects.toMatchObject({
      code: "config",
    });
  });

  it("rejects custom and unknown refs for anonymous visitors", async () => {
    process.env.PUBLIC_MODEL_REFS = "pollinations::openai-fast";
    await expect(resolveModelTarget(null, "custom::anything")).rejects.toMatchObject({
      code: "config",
    });
    await expect(resolveModelTarget(null, "ollama::qwen3:8b")).rejects.toMatchObject({
      code: "config",
    });
  });

  it("does not let an anonymous visitor session run Ollama", async () => {
    const anonId = `${ANONYMOUS_USER_ID_PREFIX}test-visitor`;
    expect(isAnonymousUserId(anonId)).toBe(true);
    await expect(resolveModelTarget(anonId, "ollama::qwen3:8b")).rejects.toMatchObject({
      code: "config",
    });
  });

  it("does not let an anonymous visitor session run a non-allowlisted keyless model", async () => {
    process.env.PUBLIC_MODEL_REFS = "none";
    const anonId = `${ANONYMOUS_USER_ID_PREFIX}test-visitor`;
    await expect(
      resolveModelTarget(anonId, "pollinations::openai-fast"),
    ).rejects.toMatchObject({
      code: "config",
    });
  });

  it("resolves an enabled keyless model without an account", async () => {
    process.env.PUBLIC_MODEL_REFS = "pollinations::openai-fast";
    expect(isPublicModelRef("pollinations::openai-fast")).toBe(true);
    const target = await resolveModelTarget(null, "pollinations::openai-fast");
    expect(target).toMatchObject({
      providerId: "pollinations",
      modelRef: "pollinations::openai-fast",
      paid: false,
    });
  });
});
