/**
 * Live verification for the only provider that works without an account.
 * Run with: npm run verify:pollinations
 */
const textUrl = "https://text.pollinations.ai/openai";
const imageUrl = "https://image.pollinations.ai/prompt";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function verifyModels() {
  const res = await fetch("https://text.pollinations.ai/models", {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) fail(`model list returned HTTP ${res.status}`);
  const models = await res.json();
  const model = models.find((m) => m.name === "openai-fast");
  if (!model) fail("openai-fast is not present in the live model list");
  console.log(`OK model list: openai-fast (${model.description ?? "no description"})`);
  console.log(`   tier=${model.tier ?? "unknown"} text=${Boolean(model.input_modalities?.includes("text"))}`);
}

async function verifyChat() {
  const started = performance.now();
  const res = await fetch(textUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "openai-fast",
      messages: [{ role: "user", content: "Reply with exactly: PLAYGROUND_OK" }],
      max_tokens: 20,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) fail(`chat returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.includes("PLAYGROUND_OK")) {
    fail(`unexpected chat content: ${JSON.stringify(text)}`);
  }
  console.log(`OK chat (${Math.round(performance.now() - started)} ms): ${text.trim()}`);
  console.log(`   usage=${JSON.stringify(data.usage ?? null)}`);
}

async function verifyImage() {
  const prompt = encodeURIComponent("a minimal red cube on a white table");
  const res = await fetch(`${imageUrl}/${prompt}?width=256&height=256&model=flux&nologo=true`, {
    signal: AbortSignal.timeout(90_000),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) fail(`image returned HTTP ${res.status}`);
  if (!type.startsWith("image/")) fail(`image returned non-image content-type: ${type}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) fail(`image response was too small (${bytes.byteLength} bytes)`);
  console.log(`OK image: ${type}, ${bytes.byteLength} bytes`);
}

try {
  await verifyModels();
  await verifyChat();
  await verifyImage();
  console.log("\nPollinations free tier verified end-to-end.");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
