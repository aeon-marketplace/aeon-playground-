import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openAICompatibleChat,
  openAICompatibleStream,
} from "@/lib/providers/openai-compatible";
import { geminiChat, geminiAdapter } from "@/lib/providers/gemini";
import {
  discoverOllama,
  listOllamaModels,
  ollamaChat,
  ollamaStream,
} from "@/lib/providers/ollama";
import { parseSseJson, readSseData } from "@/lib/providers/stream";
import { ProviderError } from "@/lib/providers/errors";
import { throwForHttpError } from "@/lib/providers/http";
import { generatePollinationsImage } from "@/lib/providers/pollinations";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function sseResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseChat = {
  providerName: "test-provider",
  endpoint: "https://api.example.com/v1/chat/completions",
  providerId: "test",
  modelId: "test-model",
  messages: [{ role: "user" as const, content: "Hello" }],
  temperature: 0.3,
  maxTokens: 64,
};

describe("HTTP and image error safety", () => {
  it("does not decode binary error bodies into provider error details", async () => {
    const response = new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]), {
      status: 502,
      headers: { "content-type": "image/jpeg" },
    });
    await expect(throwForHttpError(response, "pollinations")).rejects.toMatchObject({
      code: "server",
      details: "The provider returned HTTP 502 with a binary (image/jpeg) body.",
    });
  });

  it("reports the Pollinations anonymous image slot as a rate limit with Retry-After", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 402,
        headers: { "content-type": "image/jpeg", "retry-after": "45" },
      }),
    );
    await expect(
      generatePollinationsImage({ prompt: "test", width: 512, height: 512 }),
    ).rejects.toMatchObject({
      code: "rate_limit",
      retryAfterSeconds: 45,
    });
  });
});

describe("OpenAI-compatible adapter", () => {
  it("parses text, usage, finish reason, and request id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "req_123",
        model: "test-model-v1",
        choices: [
          { message: { role: "assistant", content: "Hello back" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
      }),
    );

    const result = await openAICompatibleChat({ ...baseChat, apiKey: "sk-test-123456789" });

    expect(result.text).toBe("Hello back");
    expect(result.finishReason).toBe("stop");
    expect(result.requestId).toBe("req_123");
    expect(result.providerModelId).toBe("test-model-v1");
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
    expect(result.usageAvailable).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(baseChat.endpoint);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-123456789");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "test-model",
      messages: baseChat.messages,
      temperature: 0.3,
      max_tokens: 64,
      stream: false,
    });
  });

  it("reports missing usage instead of inventing it", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      }),
    );
    const result = await openAICompatibleChat(baseChat);
    expect(result.usageAvailable).toBe(false);
    expect(result.usage).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it("maps an HTTP 401 to an auth error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "Invalid key" } }, { status: 401 }),
    );
    await expect(openAICompatibleChat({ ...baseChat, apiKey: "sk-test-123456789" })).rejects.toMatchObject(
      { code: "auth" },
    );
  });

  it("maps 429 with retry-after", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { message: "Rate limited" } },
        { status: 429, headers: { "retry-after": "9" } },
      ),
    );
    try {
      await openAICompatibleChat(baseChat);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe("rate_limit");
      expect((error as ProviderError).retryAfterSeconds).toBe(9);
    }
  });

  it("rejects redirects", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302 }));
    await expect(openAICompatibleChat(baseChat)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("rejects empty choices and empty messages", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [] }));
    await expect(openAICompatibleChat(baseChat)).rejects.toMatchObject({
      code: "invalid_response",
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
    );
    await expect(openAICompatibleChat(baseChat)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("maps content-filter completions to content_blocked", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "" }, finish_reason: "content_filter" }],
      }),
    );
    await expect(openAICompatibleChat(baseChat)).rejects.toMatchObject({
      code: "content_blocked",
    });
  });

  it("rejects non-JSON responses", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(openAICompatibleChat(baseChat)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("supports array content parts", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: { content: [{ type: "text", text: "part one " }, { text: "part two" }] },
            finish_reason: "stop",
          },
        ],
      }),
    );
    const result = await openAICompatibleChat(baseChat);
    expect(result.text).toBe("part one part two");
  });
});

describe("Gemini adapter", () => {
  const geminiBase = {
    providerId: "gemini",
    providerName: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    modelId: "gemini-3.8-flash",
    messages: [
      { role: "system" as const, content: "Be brief." },
      { role: "user" as const, content: "Hello" },
    ],
    temperature: 0.2,
    maxTokens: 128,
    apiKey: "AIza-test-key-123456",
  };

  it("maps messages, system instructions, and usage", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        responseId: "gemini-req",
        modelVersion: "gemini-3.8-flash-001",
        candidates: [
          {
            content: { parts: [{ text: "Hi " }, { text: "there" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 4,
          candidatesTokenCount: 6,
          totalTokenCount: 10,
        },
      }),
    );

    const result = await geminiChat(geminiBase);

    expect(result.text).toBe("Hi there");
    expect(result.requestId).toBe("gemini-req");
    expect(result.providerModelId).toBe("gemini-3.8-flash-001");
    expect(result.finishReason).toBe("STOP");
    expect(result.usage).toEqual({ promptTokens: 4, completionTokens: 6, totalTokens: 10 });
    expect(result.usageAvailable).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("AIza-test-key-123456");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: "Be brief." }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "Hello" }] }]);
    expect(body.generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 128 });
  });

  it("requires an API key", async () => {
    await expect(geminiChat({ ...geminiBase, apiKey: undefined })).rejects.toMatchObject({
      code: "config",
    });
  });

  it("maps blocked prompts to content_blocked", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ promptFeedback: { blockReason: "SAFETY" } }),
    );
    await expect(geminiChat(geminiBase)).rejects.toMatchObject({ code: "content_blocked" });
  });

  it("maps safety-finished empty candidates to content_blocked", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }],
      }),
    );
    await expect(geminiChat(geminiBase)).rejects.toMatchObject({ code: "content_blocked" });
  });

  it("rejects empty candidates", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ candidates: [] }));
    await expect(geminiChat(geminiBase)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("verifies a key and retains all listed model IDs for classification", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        models: [
          { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding-1", supportedGenerationMethods: ["embedContent"] },
          { name: "models/gemini-other" },
        ],
      }),
    );
    const result = await geminiAdapter.verifyKey({
      apiKey: "AIza-test-key-123456",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    });
    expect(result.models).toEqual(["gemini-3.8-flash", "embedding-1", "gemini-other"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models?pageSize=1000");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "AIza-test-key-123456",
    );
  });
});

describe("SSE parsing", () => {
  it("reads data events, joins multi-line data, and stops at [DONE]", async () => {
    const seen: string[] = [];
    const body = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"choices":{"multi":\n',
      'data: true}}\n\n',
      "data: [DONE]\n\n",
      'data: {"choices":[{"delta":{"content":"never"}}]}\n\n',
    ].join("");

    await readSseData(sseResponse(body), (data) => seen.push(data));

    expect(seen).toEqual([
      '{"choices":[{"delta":{"content":"a"}}]}',
      '{"choices":{"multi":\ntrue}}',
    ]);
  });

  it("flushes a final event without a trailing blank line", async () => {
    const seen: string[] = [];
    await readSseData(sseResponse('data: {"piece":"last"}'), (data) => seen.push(data));
    expect(seen).toEqual(['{"piece":"last"}']);
  });

  it("rejects invalid SSE JSON as an invalid provider response", () => {
    expect(() => parseSseJson("not json", "test")).toThrow(ProviderError);
    expect(() => parseSseJson("[]", "test")).toThrow(ProviderError);
  });
});

describe("OpenAI-compatible streaming", () => {
  it("streams deltas, usage, finish reason, and request id", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        [
          'data: {"id":"req_stream","model":"test-model-v1","choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
      ),
    );

    const deltas: string[] = [];
    const result = await openAICompatibleStream({
      ...baseChat,
      onDelta: (text) => deltas.push(text),
    });

    expect(deltas).toEqual(["Hel", "lo"]);
    expect(result.text).toBe("Hello");
    expect(result.finishReason).toBe("stop");
    expect(result.requestId).toBe("req_stream");
    expect(result.providerModelId).toBe("test-model-v1");
    expect(result.usage).toEqual({ promptTokens: 2, completionTokens: 3, totalTokens: 5 });
    expect(result.usageAvailable).toBe(true);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect((init.headers as Record<string, string>).accept).toBe("text/event-stream");
  });

  it("falls back to a single JSON body when stream=true is ignored", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "req_json",
        choices: [{ message: { content: "whole answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    );

    const deltas: string[] = [];
    const result = await openAICompatibleStream({
      ...baseChat,
      onDelta: (text) => deltas.push(text),
    });

    expect(deltas).toEqual(["whole answer"]);
    expect(result.text).toBe("whole answer");
    expect(result.requestId).toBe("req_json");
    expect(result.usage.totalTokens).toBe(3);
  });

  it("rejects an empty streamed message", async () => {
    fetchMock.mockResolvedValue(
      sseResponse('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'),
    );
    await expect(
      openAICompatibleStream({ ...baseChat, onDelta: () => {} }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("Ollama adapter", () => {
  const tagsPayload = {
    models: [
      {
        name: "models/llama3.2:latest",
        size: 2019393189,
        modified_at: "2026-10-01T00:00:00Z",
        details: { parameter_size: "3.2B", quantization_level: "Q4_K_M" },
      },
      {
        name: "qwen3:8b",
        size: 5000000000,
        details: { parameter_size: "8B", quantization_level: "Q4_0" },
      },
      { name: "qwen3:8b", size: 1 },
      { not_a_name: true },
    ],
  };

  it("discovers installed models, normalizes IDs, and deduplicates", async () => {
    fetchMock.mockResolvedValue(jsonResponse(tagsPayload));

    const models = await listOllamaModels("http://127.0.0.1:11434/");

    expect(models.map((model) => model.id)).toEqual(["llama3.2:latest", "qwen3:8b"]);
    expect(models[0]).toMatchObject({
      parameterSize: "3.2B",
      quantization: "Q4_K_M",
      sizeBytes: 2019393189,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/tags");
    expect(init.redirect).toBe("manual");
  });

  it("reports offline discovery without inventing models", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    const discovery = await discoverOllama("http://127.0.0.1:11434", 1000);
    expect(discovery.online).toBe(false);
    expect(discovery.models).toEqual([]);
    expect(discovery.error).toBeTruthy();
  });

  it("sends chat options and returns local usage", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        model: "llama3.2:latest",
        message: { role: "assistant", content: "local answer" },
        prompt_eval_count: 7,
        eval_count: 4,
        done_reason: "stop",
      }),
    );

    const result = await ollamaChat({
      modelId: "llama3.2:latest",
      baseUrl: "http://127.0.0.1:11434",
      providerId: "ollama",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.1,
      maxTokens: 32,
    });

    expect(result.text).toBe("local answer");
    expect(result.providerModelId).toBe("llama3.2:latest");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 4, totalTokens: 11 });
    expect(result.usageAvailable).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "llama3.2:latest",
      stream: false,
      messages: [{ role: "user", content: "Hi" }],
      options: { temperature: 0.1, num_predict: 32 },
    });
  });

  it("streams NDJSON content and final usage", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        [
          '{"model":"llama3.2:latest","message":{"content":"Lo"},"done":false}\n',
          '{"model":"llama3.2:latest","message":{"content":"cal"},"done":false}\n',
          '{"model":"llama3.2:latest","message":{"content":""},"done":true,',
          '"done_reason":"stop","prompt_eval_count":3,"eval_count":2}\n',
        ].join(""),
        { status: 200, headers: { "content-type": "application/x-ndjson" } },
      ),
    );

    const deltas: string[] = [];
    const result = await ollamaStream({
      modelId: "llama3.2:latest",
      baseUrl: "http://127.0.0.1:11434",
      providerId: "ollama",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.1,
      maxTokens: 32,
      onDelta: (text) => deltas.push(text),
    });

    expect(deltas).toEqual(["Lo", "cal"]);
    expect(result.text).toBe("Local");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
  });
});
