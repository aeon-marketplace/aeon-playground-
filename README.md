# AI Playground

A self-hosted, AEON-branded, dark emerald/teal workbench for testing **free, limited-free, local, and bring-your-own-key (BYOK) AI models** without pretending that an unavailable model works.

The default deployment needs **no provider account, API key, or local user account**: visitors can open the playground immediately and run the live-verified Pollinations text model and image model. **`/playground` is the single workbench** for both **Text Generation** and **Image Generation**; switching tasks updates the provider/model selectors and results in place without navigation. The old `/playground/image` URL remains as a compatibility redirect to `/playground?task=image`. The **Playground** entry appears once in the navigation. Keyless public use is restricted to an explicit server-side allowlist (`PUBLIC_MODEL_REFS`). Every visitor gets **10 successful generations per day** (shared across text, image, comparison, and model tests), counted server-side and reset at **00:00 Asia/Kolkata**; a request that fails at validation, authentication, the provider, or a timeout never consumes the allowance. Living in one browser/device keeps that identity; clearing cookies or switching browsers creates a new visitor identity. Visitors may also add their **own** provider keys or custom OpenAI-compatible endpoints without registering; those credentials are bound to an anonymous, encrypted server-side visitor session. Optional local accounts add persistent server history, settings, password management, and Ollama access. Installed Ollama models are discovered automatically and labelled **LOCAL — NO HOSTED API FEE**, but are never available to anonymous visitor sessions.

The AEON wordmark and app icons are generated reproducibly from the supplied brand image by `scripts/build-brand-assets.mjs`. The wordmark keeps its original proportions and is tinted for the dark theme; `icon.png` and `apple-icon.png` letterbox it rather than stretching it.

Every model exposes independent facts: compatibility with the selected task (**SUPPORTED FOR THIS PLAYGROUND** or **UNSUPPORTED FOR THIS PLAYGROUND**), availability (including **AVAILABLE**, **TEMPORARILY UNAVAILABLE**, **RATE LIMITED**, **INVALID KEY / ACCESS DENIED**, **PAYMENT / CREDITS REQUIRED**, **DEPRECATED**, **UNAVAILABLE**, and **NOT VERIFIED**), provider pricing (**FREE VERIFIED**, **LIMITED FREE**, **PRICING UNVERIFIED**, **PAID / CREDITS REQUIRED**, or **LOCAL — NO HOSTED API FEE**), free-tier eligibility, this session's access (**USER KEY REQUIRED**, **ACCOUNT LIMITED**, or **NOT APPLICABLE** when the app has no operation for the model), and real inference (**INFERENCE TESTED**, **INFERENCE UNTESTED**, or a failure state). The default **Model Catalog** is a **free-model view**: it lists only routes with positive evidence of **FREE** or **LIMITED FREE** inference for the configured integration and an implemented task. Paid-only, user-key-required, unverified, unsupported, and confirmed-unavailable records are retained, never deleted, and remain available in **`/models?view=all`** and on their detail pages.

The Playground intentionally reduces access to one short label — **FREE**, **LIMITED FREE**, **USER KEY REQUIRED**, **PAID**, or **UNAVAILABLE** — plus model name and provider. Both task views show only compatible, implemented routes with positive evidence that the exact model is free or limited-free (or locally hosted with no provider fee). Paid, unavailable, unsupported, and pricing-unverified entries never enter the selector, even when paid BYOK is enabled. Compatible untested routes stay eligible after their exact model ID appears in a verified key. The full technical evidence, exact IDs, limitations, and lifecycle notices remain on the model detail pages.

> **Core rule:** a model is selectable only when its provider, concrete model ID, endpoint, and access method are known; key-based models also require the exact ID in the visitor's verified provider list. That is **access evidence**, not proof of inference: the UI separately labels **Key verified · untested** and **Inference tested**. A **no-session** visitor is restricted to the explicit keyless allowlist. An **anonymous visitor session** may also use its own verified BYOK credentials and custom endpoints, but still cannot use Ollama or a non-allowlisted keyless model. There is no automatic fallback to another model, a paid variant, an operator key, or a paid account.

---

## Current verification status

Provider checks last verified: **2026-10-29** for live access and inference. Exact model IDs, provider ownership, endpoints, and free-tier policy were re-checked against provider responses and official metadata on that date. Unlisted combinations remain **UNTESTED**.

| Provider | Models exposed by this build | Access | Live status in this build | Notes |
| --- | --- | --- | --- | --- |
| Pollinations | `openai-fast` | LIMITED FREE | **Verified** — real non-streamed chat completion on 2026-10-29 (HTTP 200, 13-character reply, 803 ms) and streamed completions in earlier passes | Anonymous text limit observed: **1 reply every 30 seconds per IP**; a busy shared slot can still return `402 payment_required` |
| Pollinations | Classic image (`flux` ref) | LIMITED FREE | **Verified** — real 256×256 JPEG data URL on 2026-10-29 with valid JPEG SOI/EOI bytes; earlier 512×512 JPEG in 8.32 s (provider metadata model `sana`) | One anonymous image at a time, about 45 s apart; HTTP 402/429 means the free slot is busy and must not be read as proof that payment is required |
| Google Gemini | Discovered Gemini text IDs (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, …) | BYOK / PROVIDER KEY | **Key listing and generation verified** — ListModels returned 60 IDs; direct `generateContent` returned HTTP 200 for `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, and `gemini-3.1-flash-lite`; `gemini-3.8-flash` returned HTTP 503 (high demand) | `gemini-2.5-flash` and `gemini-2.5-flash-lite` are still returned by ListModels but `generateContent` returns **HTTP 404 “no longer available to new users”** for this account; they are marked account-restricted/unavailable with the exact provider message and are hidden from the default catalog. ListModels presence is not access proof. |
| Groq | `openai/gpt-oss-120b`, `openai/gpt-oss-20b` | LIMITED FREE | **Key required; live response verified with a caveat** — the Free-plan IDs returned HTTP 200, but with a small token budget the provider placed the answer in `reasoning` and left `content` empty; the adapter now surfaces reasoning instead of reporting a false empty response | Discovery marks only exact official Free-plan table entries as free; other `/models` results stay unverified and hidden from the default catalog |
| OpenRouter | Discovered exact `:free` zero-priced text-output models | LIMITED FREE | **Metadata verified; live inference currently blocked** — public `/models` returned 463 models and 16 exact `:free` variants on 2026-10-27; live free Gemma routes returned upstream HTTP 429 during the 2026-10-29 pass | Requires a visitor key. Auto-router IDs, non-text-output models, paid variants, unknown prices, and the safety classifier stay out of the default catalog |
| Hugging Face | Router chat models such as `openai/gpt-oss-120b` | BYOK / PROVIDER KEY | **Credential limitation** — the saved token has zero inference credits; every router chat attempt returned **HTTP 402**. A Hugging Face public repository is not hosted free inference | Paid route; `ALLOW_PAID_BYOK=false`; not in the default free catalog |
| Cloudflare Workers AI | Account text-generation models plus documented `@cf/meta/llama-3.1-8b-instruct` and `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | LIMITED FREE · BYOK | **Not live-tested** — no account ID/token was available. Credential parsing, the account-scoped model-search path, clear malformed-pair rejection, and runtime routing are implemented and tested | Save the credential as `<account_id>:<api_token>`; a bare token works only when `CLOUDFLARE_ACCOUNT_ID` is set. Workers AI includes a shared 10,000-Neuron daily allocation |
| OpenAI | `gpt-6-luna` | BYOK / PROVIDER KEY | **No credential** — no OpenAI key was present; no live inference attempted | Paid route; no free tier; `ALLOW_PAID_BYOK=false`; retained in the advanced catalog view only |
| Ollama (local) | Models installed on your machine | LOCAL — NO HOSTED API FEE | **Discovered dynamically** — daemon offline on this build machine | No static placeholder models; unavailable to anonymous sessions |

**Runtime verification on 2026-10-29:** the production build at `http://localhost:3000` served one **Playground** page, one **Model Catalog**, one **API Keys** page, and one **Test History** page; the main navigation contains exactly those four items. The default free catalog rendered **7** models (2 Pollinations + 1 Gemini + 1 Groq + 1 OpenRouter + 2 Cloudflare), the provider filter listed all **8** configured providers, and `/models?view=all` retained every diagnostic record. Live evidence in this pass: an anonymous Pollinations text reply (HTTP 200, charged exactly one), a real JPEG image (HTTP 200, valid bytes, charged exactly one, counter persisted after refresh), a missing-key request that failed **without** changing usage, an invalid Groq key rejected with an accurate auth error, a malformed Cloudflare pair rejected with a clear format message, a duplicate `x-request-id` rejected with **HTTP 409** without another charge, and a seeded tenth generation that blocked the next call with **HTTP 429 `daily_limit_reached`**, `used: 10`, `remaining: 0`. A second, independent image run confirmed `used 0 → 1` and `initialUsage.used = 1` on a full `/playground?task=image` refresh.

The **Model Catalog** page is the authoritative view of model access for the default free-only catalog. **`/models?view=all`** exposes the full retained registry, including paid-only, user-key-required, unverified, unsupported, deprecated, and confirmed-unavailable records. With no session it adds the public allowlist and public OpenRouter metadata; an anonymous visitor session adds that visitor's verified provider credentials and custom endpoints; a signed-in account also adds account-scoped history/settings and Ollama. Exact evidence and limitations remain on every detail page.

### What "verified" means here

- **Pollinations text** was checked with `GET /models` and a real `POST /openai` completion containing `PLAYGROUND_OK`. The most recent production check on 2026-10-29 returned HTTP 200 with a 13-character reply in 803 ms and charged exactly one daily generation.
- **Pollinations image** was checked with a real `/prompt/...` request returning `image/jpeg` bytes. The anonymous tier permits one image at a time, about 45 seconds apart; the adapter reports HTTP 402/429 with `Retry-After` and never renders a paid image card as a successful generation. The 2026-10-29 run returned a valid JPEG data URL, charged once, and persisted `used: 1` across a full page refresh.
- **Gemini** was checked against both ListModels and `generateContent`. The **actual cause of `provider_model_unavailable`** was not an invalid model ID or a bad endpoint: `gemini-2.5-flash` and `gemini-2.5-flash-lite` are still returned by ListModels, but `generateContent` returns **HTTP 404 “This model … is no longer available to new users.”** Those records are retained, marked account-restricted/unavailable with the exact provider text, and hidden from the default catalog. The current replacements verified with HTTP 200 are `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, and `gemini-3.1-flash-lite`; `gemini-3.8-flash` returned HTTP 503 (high demand). ListModels presence is **not** access proof.
- **Groq** was checked with a real key. `openai/gpt-oss-120b` and `openai/gpt-oss-20b` returned HTTP 200. With a small completion budget, Groq placed the answer in the `reasoning` field and left `content` empty; the adapter now surfaces reasoning instead of reporting a false “empty response”. This is real provider behavior, not mocked success.
- **OpenRouter** metadata was re-checked on 2026-10-27: 463 models total and 16 exact `:free` variants, all with zero prompt/completion prices and text output. Fifteen are general-chat routes; one (`nvidia/nemotron-3.5-content-safety:free`) is a specialized safety classifier and is excluded from the default catalog because this app has no matching playground operation. On 2026-10-29 the live free Gemma routes returned upstream HTTP 429, so current per-model inference is **BLOCKED**, not claimed as working.
- **Hugging Face** is a paid inference router in this app. The saved token had zero credits and every router chat attempt returned **HTTP 402**; a public Hugging Face repository is not the same thing as hosted free inference, and a ChatGPT subscription is not API billing. Hugging Face records stay in the advanced catalog and never enter the default free view.
- **Cloudflare Workers AI** uses the account-scoped endpoint `https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1`. No account ID/token was available on this machine, so live inference is **BLOCKED**. Credential parsing (including `<account_id>:<api_token>`), model search, clear error mapping for malformed pairs, and runtime routing are implemented and tested. The daily 10,000-Neuron allocation is shared by the whole account.
- **Layered evidence:** the catalog distinguishes *discovered* metadata, *key verified* (the model ID appears in the provider's list), and *inference tested* (a real request succeeded for that exact ID). A validated key is shown as **Key verified · untested** until the per-model **Test** action or a playground run records success.
- **Ollama** models are not hard-coded. The server calls `GET /api/tags`, lists only installed models, and labels them **LOCAL — NO HOSTED API FEE**. If the daemon is offline, no local model is offered. Discovery and streaming are unit-tested; no daemon was available on the verification machine, so live local inference is **NOT TESTED**.
- **Comparison needs two selectable models.** A default install has one selectable keyless text model, so the Compare page correctly refuses to run until a second verified provider key or custom endpoint exists. It will not duplicate a model just to make the page look functional.

Free-tier limits, model IDs, and regional availability can change at any time. Provider responses—not the registry—decide whether a request succeeds.

---

## Features

- **Playground** — one navigation entry and one page at `/playground`. A **Text Generation** / **Image Generation** task selector updates the provider/model selectors and results in place, with no navigation. `/playground/image` is a compatibility redirect. Both tasks share one server-confirmed daily allowance and display `X/10 used · Y remaining today` with the exact reset notice.
- **Dashboard** — `/dashboard` redirects to the Playground; public access does not require an account. Signed-in accounts still get account-scoped model/provider state and server history.
- **Text Generation** — provider/model selectors, one simple access label, a catalog-details link, temperature and supported parameters, optional system instruction, large prompt, streaming or non-streaming runs, stop, retry, regenerate, clear, copy, export, quick templates, and conversation history. Technical IDs and evidence stay in the catalog. Anonymous conversations are stored in browser-local history.
- **Image Generation** — prompt, negative prompt where supported, model/provider, one simple access label, dimensions and aspect ratios, seed where supported, generate/retry/cancel, real previews, download, copy prompt, duration, explicit errors, and image history. Anonymous images are returned as data URLs and kept in browser-local history.
- **Model Catalog** — one all-provider catalog whose default view lists only models with verified **FREE** or **LIMITED FREE** inference for a configured integration and an implemented task. Paid-only, user-key-required, unverified, unsupported, and confirmed-unavailable records stay in the registry, detail pages, and `/models?view=all`. Compact responsive cards show the model name, provider, one access badge, a one-line description, verified capabilities, key requirement, and a **Test** action that opens the unified Playground with that exact model requested and the matching task selected. Search, provider, and access filters work together; the empty state states plainly that no qualifying free model matched. Specialized safety/guardrail models expose no general-chat route and stay out of the default catalog without a provider request or substitute model. Exact IDs, lifecycle evidence, limitations, and scope-specific actions remain on model detail pages.
- **Providers** — every provider's icon, modalities, access categories, connection status, setup steps, docs, quota notes, and real Test Connection.
- **My Models** — add and edit your own OpenAI-compatible HTTPS endpoint and model ID without creating an account. Saving runs a real connection test; failures remain explicitly unverified and unselectable until a retry succeeds. Editing preserves the saved key by default, allows replacement or removal, resets verification, and immediately re-tests. SSRF protection applies to every save, test, and edit. Custom endpoints are always **BYOK / PROVIDER KEY**, never assumed free.
- **API Keys** — one clean page for provider credentials. **Save** encrypts the credential server-side with AES-256-GCM and marks it **Saved — not verified** without making a provider call; **Verify** performs the live provider check and marks it **Verified** or **Verification failed** with the provider's reason. Only masked hints reach the browser; replace, remove, and re-verify are explicit actions. Anonymous visitor sessions can use a key without registering; an account is not required.
- **Model Comparison** — one prompt across 2–4 models with real latency/usage, per-result access badges, partial-failure handling, copy/export, quota warning, and no paid run without explicit authorization.
- **Test History** — signed-in accounts get owner-scoped server history; anonymous visitors get browser-local history with the same status, latency, usage, error, search/filter, copy/export, and delete controls. Local image data stays in the browser and is pruned to fit storage limits.
- **Settings** — default model and system prompt work for a visitor session; password change, account information, and account deletion are account-only.
- **Responsive layout** — the main navigation contains exactly **Playground**, **Model Catalog**, **API Keys**, and **Test History**, with a collapsible desktop sidebar, mobile drawer, clear top navigation, and accessible focus/contrast states across desktop, tablet, and mobile. Providers, Comparison, My Models, and Settings remain reachable by direct URL without adding navigation clutter.
- **Optional local accounts** — public use needs no registration. Accounts add persistent server history, account settings/password management, and Ollama access. There is no third-party identity provider, email verification, or self-service password reset.

---

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS 4
- `node:sqlite` (built into Node.js; no external database driver)
- Zod validation
- Vitest
- `undici` for SSRF-safe custom-endpoint requests

Requires **Node.js 24 or newer** (tested with Node 24.22).

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create .env.local with random AUTH_SECRET and ENCRYPTION_KEY values
npm run setup

# 3. Start the development server
npm run dev
```

On Windows PowerShell, if `npm.ps1` is blocked by execution policy, run:

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
& "C:\Program Files\nodejs\npm.cmd" run dev
```

Open <http://localhost:3000> and use the starter Pollinations models immediately — no account or AI provider key is required. The homepage redirects to `/playground`. You can add your own provider keys and custom endpoints from **API Keys** / **My Models** without registering; those are stored against an encrypted anonymous visitor session. Create a local account only if you want persistent server-side history, account settings/password management, or Ollama access.

`npm run setup` writes `.env.local` once and refuses to overwrite an existing file. It never requests or includes provider keys. Provider keys are entered only in the in-app **API Keys** page and are never returned as plaintext. Anonymous session credentials expire with the 7-day visitor session cookie (or when you clear cookies/sign in); they are not transferred to an account.

### Verify the keyless provider

```bash
npm run verify:pollinations
```

This performs a live model-list request, a real chat completion, and a real image request. It can fail legitimately when the anonymous Pollinations tier is busy or rate-limited. The live text endpoint has been observed to allow only one reply every 30 seconds per IP.

### Run the full local checks

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

---

## Environment variables

Start from [`.env.example`](.env.example). All values are placeholders; never commit real secrets.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `APP_URL` | No | `http://localhost:3000` | Public origin used for same-origin request checks. Use the exact HTTPS origin in production. |
| `AUTH_SECRET` | **Yes** | — | At least 32 random characters; used to HMAC session tokens. |
| `ENCRYPTION_KEY` | **Yes** | — | Base64-encoded 32-byte key used for AES-256-GCM encryption of provider/custom-endpoint keys. |
| `DATABASE_PATH` | No | `./data/playground.db` | SQLite file. Its parent directory and `images/` subdirectory are created automatically. |
| `ALLOW_REGISTRATION` | No | `true` | Set `false` when the deployment should not create new local accounts. Public playground access does not require registration. |
| `ALLOW_INSECURE_LOCAL_ENDPOINTS` | No | `false` | Allows plain-HTTP localhost/private custom endpoints for local OpenAI-compatible servers. Weakens SSRF protection; Ollama uses `OLLAMA_BASE_URL` instead. |
| `ALLOW_PAID_BYOK` | No | `false` | Enables paid OpenAI/Hugging Face BYOK access. Paid models remain disabled otherwise. |
| `SESSION_TTL_DAYS` | No | `7` | Session lifetime. |
| `CHAT_RATE_LIMIT_PER_MINUTE` | No | `20` | Per-user chat request limit per minute. |
| `PUBLIC_MODEL_REFS` | No | `pollinations::openai-fast,pollinations::flux` | Comma-separated anonymous allowlist. Each ref must be keyless, non-paid, and live-verified. Set to `none` to disable public inference. |
| `PUBLIC_CHAT_RATE_LIMIT_PER_MINUTE` | No | `6` | Per-IP anonymous chat and streaming limit per minute. |
| `PUBLIC_IMAGE_RATE_LIMIT_PER_MINUTE` | No | `2` | Per-IP anonymous image limit per minute. |
| `PUBLIC_COMPARE_RATE_LIMIT_PER_MINUTE` | No | `4` | Per-IP anonymous comparison limit per minute. |
| `OLLAMA_BASE_URL` | No | `http://127.0.0.1:11434` | Local Ollama daemon. Models are discovered from `GET /api/tags`; nothing is hard-coded. |
| `OLLAMA_DISCOVERY_TIMEOUT_MS` | No | `2500` | Discovery timeout. An offline daemon produces an offline state, not fake models. |
| `CLOUDFLARE_ACCOUNT_ID` | No | — | Optional operator-wide 32-character Cloudflare account ID. Visitors normally save `<account_id>:<api_token>` themselves; when this is set, a bare Workers AI API token is also accepted. |

Generate the two secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`AUTH_SECRET` can be any random string of at least 32 characters. `ENCRYPTION_KEY` must decode to exactly 32 bytes.

Changing `ENCRYPTION_KEY` makes previously stored provider/custom-endpoint keys unreadable. Changing `AUTH_SECRET` invalidates existing sessions. Key rotation is not automated.

---

## Public access and operator controls

Anonymous requests are intentionally narrow:

- Only refs in `PUBLIC_MODEL_REFS` can run. An empty or unset variable uses the two verified Pollinations defaults; `none` disables public inference.
- A ref must also be keyless, non-paid, in the live-verified registry, and image-capable/ text-capable as appropriate. An allowlist entry cannot promote a key-based, paid, custom, or Ollama model.
- Public text, streaming, image, and comparison requests are rate-limited per client IP. Request sizes, prompts, timeouts, and streaming responses remain capped server-side.
- Provider keys, custom endpoints, environment details, settings, account data, and other users' history are never exposed. A visitor may test only their own saved key; Ollama testing requires a signed-in account.
- Conversation outputs, comparison results, and images are not persisted as server history. Text, comparison, and image history stays in browser localStorage; image data URLs can be pruned when storage is full. The daily usage counter and request-ID idempotency records are the exception: they are persisted server-side so the limit survives refreshes and applies across routes.
- Public image responses use a base64 data URL instead of an owner-scoped image route.
- BYOK keys and custom endpoints are available to a visitor session without signing in. An account adds persistent server history, account settings/password management, and Ollama access; it is not required for BYOK. The app never falls back from a public model to an operator key or paid model.
- Anonymous visitor sessions are keyed by an httpOnly cookie and isolated from each other. They are not accounts and are never rendered as a signed-in identity.

To expose a different public model, add its exact registry ref to `PUBLIC_MODEL_REFS` and confirm it is keyless, non-paid, and live-verified. Do not put provider keys or secrets in `NEXT_PUBLIC_*` variables; none are used for inference.

---

## Daily generation limit

Every visitor gets **exactly 10 successful generations per calendar day in Asia/Kolkata (IST)**. The allowance is shared across **text, image, comparison, and model-test requests**, across every provider and model, and regardless of which Playground task is active. It is intentionally not a per-model quota.

- The Playground displays `X/10 used · Y remaining today` (for example `3/10 used · 7 remaining today`). When exhausted it shows the exact message **“You've used all 10 successful generations for today. Your limit resets at midnight IST.”** Inputs, Generate/Send, and other generation actions are disabled in both task views.
- The day rolls over at **00:00 Asia/Kolkata**, computed server-side from epoch time with the fixed UTC+05:30 offset. No timezone database is required. A refresh, provider switch, model switch, task switch, new browser tab, or route change does **not** reset the counter.
- **Successful-only counting:** validation and model resolution run first, then the server **reserves** capacity atomically in SQLite (`BEGIN IMMEDIATE`) immediately before the provider call. The reservation does **not** increment `used`. When the provider returns a successful result the server **commits** exactly one generation (or one per successful model in a comparison); if the provider fails, times out, is rate-limited, returns an auth/payment error, or the request is aborted, the reservation is **released** and the allowance is unchanged. Invalid bodies, unsupported/ineligible models, missing keys, cross-origin writes, and duplicate submissions never reach a reservation.
- In-flight reservations temporarily count toward the cap so concurrent requests cannot overshoot it. A crashed request that never commits or releases is reclaimed after **15 minutes** without charging the visitor.
- Clients send a per-submit `x-request-id`. The server stores accepted IDs for 7 days and rejects a reused ID with `409 duplicate_request` without incrementing again. This prevents double-clicks and network replays from consuming two generations. The 10-generation limit is checked in the same transaction, so concurrent requests cannot overrun it.
- Bypass resistance: `/api/chat`, `/api/chat/stream`, `/api/images`, `/api/compare` (one reservation per resolved model), and `/api/models/test` all use the same shared counter. Calling a provider route directly, switching Playground tasks, or using the catalog's **Test** action does not avoid it.
- **Anonymous identity limitation:** an anonymous visitor is identified by an httpOnly session cookie. Clearing cookies, using a private window, or switching browsers/devices creates a new identity with a fresh daily allowance. This is a known limitation of anonymous access; it is not presented as tamper-proof. A signed-in account is identified by its account session.
- **Provider charges:** using your own provider key does not make provider usage free. Any quota, credit, or billing charges on your provider account are **your responsibility**, and the app never silently falls back to a paid model, another provider, or the operator’s key. Free-tier limits can change without notice.

The limit is a fixed policy constant (`DAILY_MESSAGE_LIMIT = 10` in `src/lib/usage/policy.ts`) rather than an environment variable, so it cannot be lowered or raised accidentally per deployment.

---

## Provider setup and access rules

### Pollinations (no key)

- Text: `https://text.pollinations.ai/openai`, model `openai-fast`.
- Images: `https://image.pollinations.ai/prompt` (Classic API). The classic service documents one image model and a shared per-IP slot.
- Anonymous requests are shared and rate-limited: one image at a time, at least 45 seconds apart. A 402 is treated as a free-slot rate limit, not as proof that payment is required.
- The app records real failures. It never substitutes a placeholder image or a different model. Legacy image entries that are not in the current Classic API contract are marked unavailable.

### Cloudflare Workers AI (limited free, BYOK)

1. In the Cloudflare dashboard, copy your **32-character account ID**.
2. Create an API token with the **Workers AI** permission.
3. Open **API Keys**, choose **Cloudflare Workers AI**, and save the credential as `<account_id>:<api_token>`.
4. Press **Verify**. The server lists the text-generation models available to that account and marks the credential verified. Only those exact IDs become selectable for text generation.

Workers AI includes a **10,000-Neuron daily allocation** shared by the whole account on both the Free and Paid plans; usage beyond it is billed on paid plans. Image, embedding, classification, speech, and reranking models are excluded because this app does not implement those operations. If the operator sets `CLOUDFLARE_ACCOUNT_ID`, a bare API token is also accepted. Live Cloudflare inference was **not tested** on this machine because no account credential was available; malformed credentials are rejected with a clear format message.

### Ollama (local, no API fee)

1. Install Ollama from <https://ollama.com/download> and start it (the installer normally runs `ollama serve`).
2. Pull at least one model, for example `ollama pull llama3.2`.
3. Leave `OLLAMA_BASE_URL` at the default, or point it at another daemon.
4. Open **Providers** and use **Test Connection**, or open **Model Catalog** and refresh. Installed models appear with **LOCAL — NO HOSTED API FEE**.
5. Select one in the Text Generation task. Streaming is supported through `/api/chat`.

Local models are discovered only from the running daemon. If Ollama is offline, no local model is shown as connected, and the app never falls back to a cloud model. Hardware, electricity, and storage costs still apply.

### Streaming

The Text Generation task can stream tokens through `/api/chat/stream`. Adapters exist for OpenAI-compatible providers, Gemini, Ollama, and Pollinations. Streaming stops when you press **Stop**, records partial failures, and persists the completed run. Non-streaming `/api/chat` remains available. Image generation is always a single real request.

### Provider keys

1. Open **API Keys**.
2. Choose a provider, paste your own key, and press **Save**. The credential is encrypted with AES-256-GCM and stored immediately as **Saved — not verified**. Saving makes no provider call.
3. Press **Verify**. The server performs a real provider request:
   - OpenAI-compatible providers: `GET /models`
   - Gemini: ListModels
   - Cloudflare: account-scoped Workers AI model search
4. On success the credential becomes **Verified** with the model IDs the provider returned. On failure it becomes **Verification failed** with the provider's reason, and no success is claimed.
5. A model becomes selectable only when its exact model ID appears in **this visitor session or account's** verified model list. It starts as **Key verified · untested**; use the catalog **Test** action to record real inference evidence for that exact model.

No account is required. The browser only ever receives a masked hint, never the key or its plaintext. Deleting or replacing a key re-evaluates model availability immediately.

OpenAI and Hugging Face are paid providers in this app. They remain disabled unless the operator sets `ALLOW_PAID_BYOK=true`. Even then, saving a key does not bypass billing checks or provider quotas, and the app never silently charges you.

### Custom OpenAI-compatible endpoints

No account is required. The endpoint is owned by the current visitor session or account and expires with an anonymous session. The form creates that session on the first successful save.

- Base URL must be an absolute HTTPS URL, normally on port 443.
- Query strings, fragments, and embedded credentials are rejected.
- Private, loopback, link-local, and reserved IP ranges are blocked (SSRF protection).
- Redirects are disabled.
- DNS is checked both when saving and at connection time to reduce rebinding risk.
- The model is stored as verified only after a real chat-completion connection test succeeds.

For local development only, set `ALLOW_INSECURE_LOCAL_ENDPOINTS=true` to allow plain-HTTP localhost endpoints for a non-Ollama OpenAI-compatible server. Turn it back off before exposing the app. Ollama is a first-class local provider and uses `OLLAMA_BASE_URL` without weakening custom-endpoint SSRF rules.

### Model comparison

Comparison requires **2–4 distinct selectable models**. Each model runs independently, and each card reports its own success or explicit error. There is no fabricated comparison result when only one model is available. A common way to unlock comparison is to verify a second provider key or add a verified custom endpoint.

---

## Security model

- Passwords are hashed with `scrypt`; sessions use random tokens stored as HMAC hashes.
- Session cookies are `HttpOnly`, `SameSite=Lax`, path-scoped, and `Secure` in production.
- State-changing API routes verify the request origin and reject cross-site requests.
- Provider and custom-endpoint keys are encrypted with **AES-256-GCM**; authenticated additional data binds each record to its user and record ID.
- Key material is never returned to the browser, written to URLs, or logged. Only masked hints are listed, and provider errors are redacted before display or persistence.
- Binary provider error bodies (for example an image returned with HTTP 402) are never decoded into text or echoed to the browser; only the status and content type are summarized.
- All provider calls happen server-side. The browser never receives a provider key or a signed provider URL.
- Chat, image, comparison, streaming, key, custom-model, and account operations validate payloads with Zod and enforce body/prompt/response limits and timeouts.
- Streaming responses are capped at 8 MB, and provider redirects are rejected rather than followed.
- Custom endpoints use HTTPS validation, public-address DNS checks, no redirects, and a connection-time guard against private/reserved addresses.
- Responses include CSP, frame-denial, MIME-sniffing, referrer, and permissions headers.
- Signed-in account operations are rate-limited per user; no-session and anonymous-session chat, streaming, image, and comparison requests use the public per-IP limits. Public inference also enforces the server-side keyless allowlist.
- Anonymous visitor sessions can list, create, update, and delete **only their own** keys, custom endpoints, and settings. They cannot read another session's data, server history, account data, or Ollama models. Account password/deletion routes return `account_required` for anonymous sessions.
- Provider tests for key-based providers without any session return `needs_key` guidance; Ollama tests require a signed-in account. No test marks a provider connected without a real provider response.
- Paid models have no hidden fallback and never enter either Playground task selector, even when paid BYOK is enabled. They remain in the registry and their detail pages are still accessible and appear in **`/models?view=all`** with a **PAID** label; they are selectable in Settings/Compare only when `ALLOW_PAID_BYOK=true`, the visitor verified the exact model ID with their own key, and the visitor explicitly selects it there.
- The **10-successful-generation** daily limit is enforced server-side in SQLite and shared by every generation route. In-flight reservations count toward the cap, but usage increments only after a provider success; failures, timeouts, aborts, and auth/payment errors release the reservation. It is independent of the in-memory per-IP rate limits and survives process restarts and page refreshes. Anonymous identities are cookie-based and can be reset by clearing cookies or changing browser/device (documented above).

### Security limitations you should know

- Rate limits are **in memory and per process**. They reset on restart and do not coordinate across multiple app instances. Use a reverse-proxy/WAF rate limit as well for public deployments.
- `X-Forwarded-For` is trusted for client-IP rate limiting. Bind the app to localhost behind a trusted proxy; do not expose it directly.
- There is no email verification, password reset, 2FA, admin role, or audit-log UI.
- Anonymous visitor sessions create normal `users` rows so their keys/custom endpoints can be foreign-keyed. Rows for abandoned sessions are **not garbage-collected automatically**; schedule cleanup if you operate a busy public instance. Anonymous keys are encrypted but persist until the session row is removed.
- Ollama is exposed to **signed-in accounts**, not anonymous sessions. Because registration is enabled by default, set `ALLOW_REGISTRATION=false` after creating operator account(s) on a public deployment; otherwise any visitor can create an account and use server-local Ollama.
- SQLite is single-node. This app is not designed for horizontal scaling with multiple app replicas sharing one database file, and it is **not suitable for stateless/serverless hosting** without replacing SQLite and local image storage with durable shared services.
- The CSP uses inline styles/scripts required by the current Next.js setup; it is not a nonce-based strict CSP.
- Signed-in test history and images are private to the owning account, but there is no at-rest encryption for prompts, outputs, or image files. Protect the data directory and backups. Anonymous history is held in the visitor's browser localStorage and is not encrypted at rest by the app.
- No secrets are committed. `.env.local`, `data/`, SQLite files, images, and build output are gitignored.

---

## Theme

The interface now uses a dark navy AEON-style token set defined in src/app/globals.css: navy backgrounds, slate/navy surfaces, blue primary accent, cyan secondary accent, and blue focus rings. Emerald/teal classes were removed from theme accents; green, amber, and red are intentionally retained only for success, warning, and error states. Layout, navigation, spacing, typography, icons, and responsive behaviour were not redesigned. Because no eferences/aeon-reference.png was available in this repository, an exact visual match to the reference cannot be claimed.

## Embedding

Embedding is opt-in and disabled by default:

- Set EMBEDDED=true only when the app is served in a cross-site iframe.
- Set EMBED_ALLOWED_ORIGINS=https://www.example.com,https://app.example.org to the exact origins that may frame the app.
- Leave EMBED_ALLOWED_ORIGINS empty to keep X-Frame-Options: DENY and rame-ancestors 'none'.
- Use * only if every site should be allowed to frame the app.
- Cross-site embedding requires HTTPS. Browsers may still block third-party cookies, so anonymous limits and saved keys may not persist in some browsers.

## Deployment

### Single-node production

```bash
npm ci
npm run build
APP_URL=https://play.example.com \
AUTH_SECRET='...' \
ENCRYPTION_KEY='...' \
DATABASE_PATH=/var/lib/ai-playground/playground.db \
ALLOW_REGISTRATION=false \
ALLOW_PAID_BYOK=false \
npm start
```

Set environment variables through your process manager or a non-committed env file. Use a persistent volume for the directory containing `DATABASE_PATH`; generated images live in an `images/` directory beside it.

Run the built app with `npm start` after `npm run build` (or use a process manager such as systemd or PM2). Keep the working directory at the project root so `.next/` and local data resolve correctly.

**Hosting limit:** the app writes SQLite and account-owned image files to local disk. This works on a single VM/container with a persistent volume. It does **not** work reliably on Vercel, Netlify, or other ephemeral/serverless platforms: database rows, encrypted visitor keys, accounts, and images can disappear between instances. Choose a platform with a persistent filesystem or migrate storage before deploying there. Anonymous browser-local history is stored client-side and is not affected by this limit.

### HTTPS reverse proxy

Run the app on loopback and terminate TLS at a trusted reverse proxy. `APP_URL` must be the exact public HTTPS origin.

**Caddy example**

```caddyfile
play.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Nginx example**

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Use HTTPS in production: session cookies are marked `Secure`. Do not expose the Node process directly to the internet.

### Operations

- Public use and BYOK need no accounts. If you want Ollama or persistent server history, create the operator account(s), then set `ALLOW_REGISTRATION=false` on a public deployment so visitors cannot create accounts.
- Back up SQLite (preferably with SQLite's online backup mechanism or while the app is stopped) and the sibling `images/` directory together. Anonymous visitor keys/settings/custom endpoints live in SQLite; anonymous browser-local history is not part of the backup.
- Keep durable copies of `AUTH_SECRET` and `ENCRYPTION_KEY`. Losing the encryption key makes stored provider keys unrecoverable.
- Watch provider errors in Test History; quota, rate-limit, auth, timeout, unsupported-model, and network failures are mapped to distinct API error codes.
- Provider limits are external and can change without notice.

---

## API routes

All mutating routes require a same-origin browser request. "Visitor session" means either an anonymous httpOnly-cookie session or a signed-in account; every query is owner-scoped. "Account" means a real account, never an anonymous session. Ollama is account-only and should be limited to the operator by disabling registration on public deployments. Every successful generation reservation returns a `dailyUsage` object; an exhausted allowance returns **HTTP 429** with code `daily_limit_reached`, the exact reset message, and that object. A reused `x-request-id` returns **HTTP 409** with code `duplicate_request`.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public (if enabled) | Create a local account and session |
| `POST` | `/api/auth/login` | Public | Sign in and drop any anonymous session |
| `POST` | `/api/auth/logout` | Public | Destroy the account session |
| `POST` | `/api/anon-session` | Public | Idempotently ensure an anonymous visitor session (never replaces one) |
| `POST` | `/api/chat` | Public allowlist / visitor session / account | Real non-streaming text completion |
| `POST` | `/api/chat/stream` | Public allowlist / visitor session / account | Real streamed completion (SSE: `meta`, `delta`, `done`, `error`) |
| `POST` | `/api/compare` | Public allowlist / visitor session / account | Run 2–4 models with independent results |
| `POST` | `/api/images` | Public allowlist / visitor session / account | Real image generation; data URL for anonymous visitors |
| `GET` | `/api/images/[id]` | Account owner only | Account-owned generated image |
| `GET`, `DELETE` | `/api/history` | Visitor session / account | Owner-scoped runs (anonymous server history is always empty) |
| `DELETE` | `/api/history/[id]` | Visitor session / account | Delete one owned run and its image |
| `GET` | `/api/keys` | Visitor session / account | List masked credentials for the current owner |
| `POST` | `/api/keys` | Visitor session / account | Save an encrypted provider credential as **not verified**; may create a visitor session; no provider call |
| `POST` | `/api/keys/verify` | Visitor session / account | Perform a live provider verification for a saved key and update its status |
| `DELETE` | `/api/keys/[providerId]` | Visitor session / account | Delete an owned provider key |
| `GET`, `POST` | `/api/custom-models` | Visitor session / account | List custom models; create and test one |
| `POST`, `DELETE` | `/api/custom-models/[id]` | Visitor session / account | Re-test or delete an owned custom model |
| `POST` | `/api/models/discover` | Public / visitor session | Force-refresh public and owner-keyed model discovery |
| `POST` | `/api/models/test` | Public allowlist / visitor session / account | Test one exact model for the selected playground; incompatible operations return `unsupported_model` before any provider call |
| `POST` | `/api/providers/test` | Public keyless / visitor session keys / account Ollama | Real provider test, refresh, and verification |
| `GET`, `PATCH` | `/api/settings` | Visitor session / account | Read or update defaults; may create a visitor session |
| `POST` | `/api/account/password` | Account only | Change password and renew session |
| `DELETE` | `/api/account` | Account only | Delete account and owned data |
| `GET` | `/api/health` | Public | Liveness check |

Errors use a stable shape:

```json
{
  "error": {
    "code": "provider_rate_limit",
    "message": "The provider rate limit was reached. Retry later.",
    "retryAfterSeconds": 30
  }
}
```

Common provider codes include `provider_auth`, `provider_rate_limit`, `provider_quota`, `provider_payment_required`, `provider_timeout`, `provider_network`, `provider_invalid_response`, `provider_model_unavailable`, and `unsupported_model`. A provider's 404 model-availability error is reported as `provider_model_unavailable`, separately from this app's `unsupported_model` guard for an unimplemented operation. Configuration, public-allowlist, and selection failures are reported as `model_unavailable` instead of calling a different model. A key-based provider test without any session returns `needs_key`; Ollama tests from an anonymous session or no session return `operator_only` (signed-in account required). Daily-limit failures use `daily_limit_reached`; replayed submission IDs use `duplicate_request`.

---

## Project layout

```text
src/
  app/
    (dashboard)/           Public app shell: Playground, Catalog, Providers,
                           Comparison, History, My Models, API Keys, Settings;
                           the legacy Dashboard route redirects to /playground
    api/                   Route handlers (chat, streaming, images, providers, keys, history)
    login/, register/      Optional local auth pages
  components/              Workbenches, catalog, providers, keys, custom models,
                           comparison, history, settings, shell, and shared UI
  lib/client/              Browser-local anonymous history (no secrets)
  lib/
    auth/                  scrypt passwords and hashed sessions
    crypto/                AES-GCM key encryption and masking
    db/                    SQLite migration and repositories
    http/                  Origin checks, rate limits, error mapping
    images/                Owner-scoped image storage
    providers/             Registry, access labels, adapters (OpenAI-compatible,
                           Gemini, Ollama, Pollinations, Cloudflare Workers AI),
                           streaming, runtime gating
    security/              SSRF checks and in-memory rate limiting
    usage/                 Daily 10-success policy, IST reset math, atomic
                           SQLite reservations, commit/release, request-ID idempotency
    validation/            Zod schemas
scripts/
  setup-env.mjs            Generate .env.local with random secrets
  verify-pollinations.mjs  Live keyless provider check
tests/                     Vitest suites
```

---

## Tests and verification

Automated tests cover SSRF validation (including multi-address DNS lookups), endpoint sanitization, rate limits, password/session crypto, secret encryption and key isolation, provider error mapping (invalid keys, payment versus quota, model availability, 404/429/server), runtime gating and access labels, the six catalog access statuses, default-catalog visibility and the `/models?view=all` retention view, official Groq Free-plan discovery allowlisting, safety/guardrail classification and chat exclusion, strict verified-free selector eligibility across all eight providers, deprecated/unsupported action guards, not-applicable access/evidence states, public allowlist enforcement, no-session rejection of keyed/custom/Ollama refs, anonymous-session rejection of Ollama and non-allowlisted keyless refs, Ollama discovery/offline behavior, Cloudflare credential parsing/model filtering, SSE parsing and streaming/non-streaming fallbacks, image error paths, owner-scoped history reads/deletes, and the daily limit (IST boundary/reset math, exact counter text, successful-only commit/release, pending-cap overshoot prevention, 10 successes + 11th blocked, per-visitor isolation, shared text/image/compare/test counter, duplicate-ID replay rejection, partial comparison commits, abandoned-reservation reclaim, atomic batch limits, and 7-day idempotency retention).

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

Manual end-to-end verification performed for this build on 2026-10-25 through 2026-10-29:

1. Browser route sweep: `/` redirected to `/playground`; `/playground`, `/playground/image`, `/models`, model details, `/compare`, `/providers`, `/api-keys`, `/my-models`, `/history`, `/settings`, `/login`, and `/register` rendered without runtime/hydration errors. An unknown route returned the expected 404. Console errors were empty except the expected 404 resource.
2. With an anonymous visitor cookie present, `/login` and `/register` remained reachable; `/api-keys` showed the no-account alert and `/settings` identified the public session. This verifies the anonymous-cookie redirect regression is fixed.
3. Requested paid, unknown, and unavailable model refs showed an explicit “Requested model is not selectable” notice and left the default model unselected for sending. No request was sent and no substitute model was chosen.
4. No-session API behavior: `/api/settings` GET returned defaults (200), `/api/keys` GET returned an empty list without creating a session, `/api/models/discover` returned public metadata without a cookie, an invalid custom endpoint returned 422 without creating a session, paid/Ollama chat refs returned `model_unavailable` without a provider call, and a cross-origin write returned 403.
5. Session lifecycle: `/api/anon-session` created one cookie on first POST and returned `created:false` with no new cookie on repeat. A settings PATCH with no cookie created a session and persisted values; subsequent settings/keys reads did not replace it.
6. Account lifecycle: registered a disposable local account, loaded account settings, logged out, logged in again with an anonymous cookie present, confirmed the anonymous cookie was cleared, confirmed an anonymous session cannot delete an account (`403 account_required`), deleted the account with its password, and confirmed the old credentials then fail (`401 invalid_credentials`).
7. Public gates: anonymous Ollama testing returned `401 operator_only`; a non-allowlisted/Ollama chat returned `model_unavailable`; paid BYOK is disabled. An invalid OpenAI key was rejected with `provider_auth` before any credential/session was stored.
8. Live providers: anonymous Pollinations chat returned `PLAYGROUND_OK` with real usage and request metadata (about 3.9 s); streaming returned SSE `meta`/`delta`/`done` with `STREAM_OK` (about 8 s); image generation returned a real JPEG data URL. The final pass re-ran a production chat (`PROD_OK`), a UI chat answer, streaming SSE, and a 512x512 image. OpenRouter discovery returned **17** zero-priced text-output records with no error, including one safety classifier excluded from chat.
9. Custom endpoints: using a temporary local OpenAI-compatible mock and `ALLOW_INSECURE_LOCAL_ENDPOINTS=true` on a controlled test instance, an anonymous session saved a custom endpoint only after a real chat test (`201`, verified), custom chat returned `MOCK_OK` with usage, a second visitor session could not list, chat with, or delete it, and the owner deleted it successfully. The plain-HTTP loopback default was then restored (`ALLOW_INSECURE_LOCAL_ENDPOINTS=false`) and the mock was stopped.
10. Dependency audit: `npm audit` reports **0 vulnerabilities** after upgrading `undici` to 7.30.1, `zod` to 4.6.7, and `vitest` to 4.1.12.
11. Free-catalog verification (2026-10-27, production build on port 3001): `/models` showed **19 of 19 free models**, all labelled **LIMITED FREE**, with provider counts **Pollinations 2**, **Google Gemini 1**, **Groq 1**, **OpenRouter 15**, and no Hugging Face, OpenAI, or Ollama entries (no qualifying free route or live local model). No PAID, USER KEY REQUIRED, UNVERIFIED, or UNAVAILABLE label appeared in the default view. The access filter offered **All free access labels**, **Free**, and **Limited Free**; the provider filter listed **All Providers** plus all seven configured providers. Combining **Pollinations + Limited Free** showed 2 models, searching `gemini` showed 1, a no-match search produced the explicit empty state, and clearing filters restored 19. Every card had a **Test** action linking to `/playground` with the matching `task` and `ref`. **`/models?view=all`** showed **23 of 23 recorded models**, adding PAID, USER KEY REQUIRED, and UNAVAILABLE records plus the extra filter labels; hidden records' detail routes still returned HTTP 200, confirming filtering rather than deletion. Browser console errors were empty. OpenRouter's official `/api/v1/models` reported **463** models and **16** exact `:free` variants on this date; one specialized safety route is excluded from the default catalog, leaving the 15 rendered OpenRouter cards. This is metadata eligibility, not per-model live inference. (Historical counts from 2026-10-27; the current build has **8 providers** and **7 default-catalog models** — see item 20.)
12. Responsive and selector verification (2026-10-26, current production build): headless Chromium at viewport widths **390**, **768**, and **1280** CSS pixels produced **1**, **2**, and **3** catalog columns respectively. At each width document `scrollWidth` equaled `clientWidth` (380/380, 758/758, 1270/1270 with the test profile's scrollbar), no card or visible control crossed the viewport, and `/playground` and `/playground/image` had no horizontal overflow at mobile, tablet, or desktop widths. Console errors, page exceptions, and failed requests were empty. Without a provider key, the only Text-to-text model was `pollinations::openai-fast` (**LIMITED FREE**) and the only Text-to-image model was `pollinations::flux` (**LIMITED FREE**). The image selector contained no image-input or non-generation models. Requesting Flux from the text playground returned `unsupported_model` without an incompatible provider request.
13. Gemini live key verification: saving the valid key returned 200 with 60 discovered IDs. Saving an obviously invalid key returned 422 `provider_auth`; the previously verified credential remained verified with 60 IDs. Gemini 3.8 timed out at the app's 60 s limit, at 150 s directly, and at 120 s with `thinkingLevel: "low"`. Gemini 3.5 returned HTTP 200 after about 84.8 s but only the truncated partial `PLAYGROUND_` with finish reason `MAX_TOKENS`; the provider reported `modelVersion: gemini-3.6-flash`. Gemini 2.5 generation returned 404 account-availability for the tested new account and now maps to `provider_model_unavailable`, not an unsupported-operation result. The keyed catalog then showed **ACCOUNT LIMITED** and **MODEL NOT AVAILABLE** for 2.5 Flash. (Superseded by the corrected 2026-10-29 evidence in item 20.)
14. Disabled requests: unsupported Lyria audio and deprecated Computer Use returned errors without any provider request. The deprecated Computer Use replacement is `gemini-3.8-flash`, and Gemini 2.5 Flash carries the provider-directed replacement link `gemini-3.8-flash`, displayed in the keyed catalog after the 404; neither is selected automatically.
15. Selector and labeling verification (2026-10-26, fresh dev server and clean browser profile): the no-key text page offered only `pollinations::openai-fast`, showed **LIMITED FREE** once in the header and once in the model card, and exposed no exact-ID/rate-limit/description clutter. The image page offered only `pollinations::flux`, showed **LIMITED FREE** once in each intended place, and had no one-option image-count control. Exact `?ref=pollinations::openai-fast` and `?ref=pollinations::flux` selections worked. Requesting paid `openai::gpt-6-luna` showed the explicit non-selectable notice, did not send a request, and stated that no different model would be used automatically. The paid notice now also states that paid routes never enter playground selectors even when paid BYOK is enabled.
16. My Models edit coverage: automated database tests create a custom endpoint with an encrypted key, confirm the public response never contains the secret, verify key retention and decryption after a rename, replacement with a new encrypted key, explicit key removal, verification reset on edit, and owner isolation. The update schema rejects sending a replacement key and key removal together. A live PATCH against a real custom endpoint was **NOT VERIFIED** because `ALLOW_INSECURE_LOCAL_ENDPOINTS` was restored to `false` and no public HTTPS mock was available.
17. Safety/guardrail classification (2026-10-27): `openrouter::nvidia/nemotron-3.5-content-safety:free` is a free exact `:free` variant but has no general-chat operation, so it is **excluded from the default catalog**. Its direct detail route still returns HTTP 200 and retains the accurate safety/moderation evidence. Earlier request-level verification confirmed that chat and model-test routes reject it with `unsupported_model` without making a provider request or substituting a model. The default catalog count is therefore 15 OpenRouter general-chat routes, not 16 free variants.
18. Final production smoke and live checks (2026-10-26): `next build` and `next start` on port 3001 served the full route sweep, with `/dashboard` redirecting to `/playground` and an unknown route returning 404. Pollinations chat returned `PROD_OK` with usage; the production UI streamed `PROD_UI_OK` with usage and previously answered the roses question correctly; SSE returned `meta`/`delta`/`done`; and a 512x512 image returned a real JPEG data URL. Production CSP omitted `unsafe-eval`, security headers were present, `X-Powered-By` was absent, and a cross-origin write returned 403 `cross_origin`.
19. Unified Playground, branding, and daily-limit verification (2026-10-27, production build on port 3001): `/playground` rendered one **Playground** page with **Text Generation** / **Image Generation** task tabs, the AEON wordmark, and a server-confirmed counter. Switching to Image Generation changed the URL to `?task=image`, task-filtered the provider/model selectors, and preserved the text prompt when switching back; no navigation or remount lost results. The navigation contained one `/playground` link, and `/playground/image?ref=…` returned `307` to `/playground?task=image&ref=…`. A real anonymous Pollinations chat returned `AEON OK` with **315 in / 37 out / 352 total** tokens in about 8 s, changing the counter **10/10 → 9/10**. A real 512×512 JPEG image followed in **8.32 s** with provider metadata `sana`, changing the shared counter **9/10 → 8/10**; the image view showed the same counter. Reloading kept **8/10**. The remaining allowance was then exercised with real requests: exactly **10** reservations were accepted and the 11th returned **HTTP 429 `daily_limit_reached`** with `used: 10`, `remaining: 0`, the exact reset message, and `resetAt` at midnight IST. One request that reached the provider and failed with `402 provider_payment_required` consumed its reservation under the policy in effect at that time; the current build is **successful-only** and releases such a reservation (see item 20). Both task views then showed **0/10**, the exact exhaustion message, and disabled Send/Generate controls. A fresh no-cookie visitor rendered **10/10**, confirming visitor isolation. `/api/anon-session` was idempotent, `/api/keys` returned `{credentials:[]}`, browser console output was empty, and no `sk-...`, bearer token, or key material appeared in the DOM, network URLs, or the server log. Exact 10-accept/11-block, duplicate-ID replay, concurrent batches, failure counting, and the IST midnight reset are also covered by the automated suite rather than a real-clock browser wait.
20. Corrected availability and successful-only accounting (2026-10-29, production build on port 3000): the original `provider_model_unavailable` failure was traced to Google `gemini-2.5-flash` and `gemini-2.5-flash-lite`, which ListModels still returns but `generateContent` rejects with **HTTP 404 “no longer available to new users”**. Those records now carry the exact provider message and are hidden from the default catalog. Direct generation returned HTTP 200 for `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, and `gemini-3.1-flash-lite`; `gemini-3.8-flash` returned HTTP 503 high demand. The app exposed **8 providers** and a **7-model** default free catalog including **2 Cloudflare Workers AI** text models. The main navigation contained exactly **Playground, Model Catalog, API Keys, Test History**. Save stored a Groq key as **Saved — not verified** with no provider call and a masked hint; Verify rejected the fake key with **HTTP 422** and an accurate auth message; a malformed Cloudflare credential was rejected with a clear `<account_id>:<api_token>` format message. A missing-key request failed without changing usage. Live Pollinations text returned HTTP 200 and charged exactly one. A duplicate `x-request-id` returned **HTTP 409** with no second charge. Live Pollinations image returned HTTP 200 with valid JPEG SOI/EOI bytes and charged exactly one; an independent run showed `used 0 → 1` and `initialUsage.used = 1` after a full `/playground?task=image` refresh. A failed image attempt did not charge. With usage seeded to 10, the next request returned **HTTP 429 `daily_limit_reached`** with `used: 10` and `remaining: 0`. Typecheck, lint, **159 tests across 9 files**, and the production build all passed.

Final checks for this build: `npm run typecheck`, `npm run lint`, `npm run test` (**159 tests passed across 9 files**), and `npm run build` all pass. A production `next start` smoke test at `http://localhost:3000` served the unified Playground with live Pollinations text and image generation, the shared **successful-only** daily counter, **7 free catalog records** in the default view, **8 providers**, Cloudflare entries, and hidden-record retention in `/models?view=all`. Live OpenRouter general chat returned upstream HTTP 429 and Hugging Face returned HTTP 402 because that account has zero credits; those are reported as blocked, not as successes. OpenAI, Cloudflare Workers AI, and Ollama live inference remain blocked by missing credentials or an offline daemon.

### What is not verified

- **OpenAI live inference — BLOCKED:** no OpenAI API key exists in the database. A ChatGPT subscription is not API billing and does not enable API access.
- **Hugging Face free hosted inference — BLOCKED:** the saved token has zero inference credits; all router chat calls returned HTTP 402. Public model repositories are not hosted inference.
- **Cloudflare Workers AI live inference — BLOCKED:** no account ID/API token was available. Credential parsing, model search, error mapping, and runtime routing are implemented and tested, but no real Workers AI completion was made.
- **Ollama — BLOCKED:** the local daemon was offline on this machine. Discovery/streaming logic is unit-tested.
- **OpenRouter free routes — BLOCKED:** live free Gemma attempts returned upstream HTTP 429 during this pass. Official metadata confirms the 16 exact `:free` variants, but metadata is not inference proof.
- **Gemini 3.8 Flash — PARTIAL:** direct `generateContent` returned HTTP 503 high demand. The other verified Gemini IDs (`3.6-flash`, `3.5-flash`, `3.5-flash-lite`, `3.1-flash-lite`) returned HTTP 200. Model availability can change without notice.
- **Groq output shape — PARTIAL:** the Free-plan GPT-OSS IDs returned HTTP 200, but with a small token budget the answer appeared in `reasoning` and `content` was empty. The adapter now surfaces reasoning; very small budgets may still truncate.
- **Daily-limit live edge cases — PARTIAL:** success-only charging, refresh persistence, duplicate rejection, missing-key failure, failed image, and the 11th-request block were exercised live. Concurrent races, the 15-minute abandoned-reservation reclaim, 7-day ID retention, and the real-clock IST midnight rollover are covered by deterministic unit tests, not by waiting for midnight in a browser.
- **Anonymous daily-limit identity reset:** clearing cookies or switching browsers/devices starts a new allowance by design. This is a documented limitation of anonymous access, not tamper-proof enforcement.
- **Live comparison across two external providers — NOT TESTED:** no second external verified model was available in this pass; the comparison accounting path is unit-tested.
- **Production deployment behind a specific reverse proxy or container platform — NOT TESTED.**

These are reported as unverified rather than simulated as successes.

---

## Troubleshooting

**`AUTH_SECRET is missing or too short`** — run `npm run setup`, or add a 32+ character secret to `.env.local`.

**`ENCRYPTION_KEY is missing` / decrypt errors** — the key is missing or does not decode to 32 bytes. Restoring a different key will not decrypt old saved provider keys.

**`provider_quota` from Pollinations** — the anonymous tier is rate-limited. Wait at least 30 seconds and retry; consider using your own Pollinations key or another provider.

**Cloudflare says the account ID/token pair is invalid** — save the credential as `<account_id>:<api_token>`, where the account ID is exactly 32 hexadecimal characters. A bare token requires `CLOUDFLARE_ACCOUNT_ID` to be set by the operator.

**Gemini returns `provider_model_unavailable` for a 2.5 model** — Google still lists some 2.5 IDs but refuses generation for new accounts with HTTP 404. Use a current verified ID such as `gemini-3.6-flash`; the app never switches models automatically.

**No models in Compare** — verify a second provider key or custom endpoint. A single selectable model is intentionally insufficient.

**Ollama models do not appear** — start the daemon (`ollama serve`), confirm `curl http://127.0.0.1:11434/api/tags` returns installed models, pull one with `ollama pull llama3.2`, then use **Test Connection** or refresh the catalog. If the daemon uses another port, set `OLLAMA_BASE_URL`.

**Streaming stops immediately** — some providers ignore `stream=true`; the OpenAI-compatible adapter falls back to a single JSON body. If the provider returns an error, the run is recorded in Test History with the normalized error code.

**Custom endpoint rejected as unsafe** — use a public HTTPS endpoint. For a non-Ollama local OpenAI-compatible server, temporarily set `ALLOW_INSECURE_LOCAL_ENDPOINTS=true` and use a loopback URL. For Ollama itself, use `OLLAMA_BASE_URL` instead.

**Production login cookie not retained** — serve the app over HTTPS and ensure `APP_URL` matches the public origin exactly.

**Database is locked** — run one app instance per SQLite file. `node:sqlite` has a busy timeout, but it is not a multi-writer database server.

---

## License

No license file is included. Add one before distributing this project.
