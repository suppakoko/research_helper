# 03 — LLM Provider Integration Reference

**Project:** `research_helper` (Zotero 10.x bootstrapped plugin, fully client-side)
**Scope:** OpenAI, Anthropic, Google Gemini, OpenRouter — text generation, structured output, streaming, token counting, cost, and a unified adapter design.
**Verified:** 2026-09-08

> **Re-verify before implementing.** Every model ID, price, context window, and endpoint path in this document was checked against live provider documentation on **2026-09-08**. All four providers ship breaking or additive changes on a scale of weeks (Google replaced `generateContent` with the Interactions API in June 2026; OpenAI shipped the GPT-5.6 family in July 2026). **Do not hardcode model IDs or prices into the plugin.** Fetch them at runtime from each provider's models endpoint (§9) and treat the tables here as a snapshot for design and estimation only.

---

## Table of contents

1. [Client-side constraints: CORS, key storage, and the privileged context](#1-client-side-constraints)
2. [OpenAI](#2-openai)
3. [Anthropic (Claude)](#3-anthropic-claude)
4. [Google Gemini](#4-google-gemini)
5. [OpenRouter](#5-openrouter)
6. [Streaming (SSE) comparison](#6-streaming-sse-comparison)
7. [Structured / JSON output comparison](#7-structured--json-output-comparison)
8. [Prompt caching and this plugin's workload](#8-prompt-caching)
9. [Model discovery: populating the model picker dynamically](#9-model-discovery)
10. [Token counting and estimation](#10-token-counting-and-estimation)
11. [Rate limits, error taxonomy, and retry policy](#11-rate-limits-errors-and-retry)
12. [Cost estimation and a worked example](#12-cost-estimation)
13. [Embeddings (for the recommendation feature)](#13-embeddings)
14. [Unified adapter design](#14-unified-adapter-design)
15. [OpenRouter as the universal fallback](#15-openrouter-as-universal-fallback)
16. [Provider default decision table](#16-provider-default-decision-table)
17. [Sources](#sources)

---

## 1. Client-side constraints

### 1.1 CORS in Zotero's privileged context

Zotero 10 plugins run in a **privileged chrome JavaScript context** inside Gecko. Requests issued from that context — via `Zotero.HTTP.request()` or the global `fetch()` available to system principals — are **not subject to the same-origin policy** the way page-content JavaScript is. There is no `Origin` header for a chrome-privileged request, and there is no CORS preflight to fail.

**Practical consequence:** all four providers are callable directly from the plugin. This is the same mechanism existing Zotero translators use to hit arbitrary third-party APIs.

> **Unverified:** The exact behaviour of the global `fetch()` in Zotero 10's plugin sandbox (whether it inherits the system principal or a null principal) should be confirmed empirically on the target build before the adapter layer is frozen. `Zotero.HTTP.request()` is the safer default because it is explicitly a privileged XHR wrapper. Write the transport as a single swappable function (§14.4) so this can be changed in one place.

### 1.2 Provider-side browser-origin restrictions

Two providers have explicit browser-origin behaviour worth knowing even though it should not bite us:

| Provider | Browser-origin behaviour |
| --- | --- |
| **Anthropic** | Requests carrying a browser `Origin` are rejected unless the request also sends `anthropic-dangerous-direct-browser-access: true`. This header was added in Aug 2024 specifically to enable BYOK client-side apps ([simonwillison.net](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/)). From a chrome-privileged context there is no `Origin`, so the header should be unnecessary — **but send it anyway**. It is harmless when not required and it removes an entire failure class if the transport ever changes to something that does set an `Origin` (e.g. an in-app browser view, or a future Zotero sandbox change). |
| **OpenAI** | Historically rejected direct browser calls in the SDK (`dangerouslyAllowBrowser`), but that is an SDK-side guard, not a server-side one. The REST API itself accepts any origin-less request. |
| **Google Gemini / OpenRouter** | No known origin gating; both are commonly called from browser BYOK apps. |

### 1.3 Key exposure — the real risk

Being fully client-side, the plugin never sees a shared key; each user supplies their own. The risks that remain:

1. **Keys must not go in Zotero prefs.** Prefs are serialized as plaintext `user_pref(...)` lines in `prefs.js` in the Zotero **profile** directory (not the data directory — a common documentation error), readable by the user's OS account and swept up by most backup tooling. Store keys instead via `Zotero.OSKeyStore.encrypt()` into `Services.logins`, exactly as Zotero stores its own zotero.org API key. **[09-security-privacy-and-api-keys.md](09-security-privacy-and-api-keys.md) is authoritative** for the storage design, the fallback behavior when the OS keystore is unavailable, and the residual-risk disclosure. Regardless of backend: never log keys, and never put one in a URL query string.
2. **`?key=` in the URL (Gemini).** Gemini accepts the API key as a query parameter. **Do not use it.** URLs land in logs, in `Zotero.debug()` output, in crash reports, and in the debug-output-submission feature Zotero users are routinely asked to run. Always use the `x-goog-api-key` header.
3. **Debug logging.** Zotero's `Zotero.debug()` output is frequently pasted into public forum threads. Redact `Authorization`, `x-api-key`, and `x-goog-api-key` from any request logging the plugin does.
4. **Key scoping.** Recommend in the UI that users create a **dedicated, spend-capped key** per provider for the plugin. All four providers support per-key spend limits (OpenRouter's is the most granular — see §15.4).

---

## 2. OpenAI

### 2.1 Base URL and endpoints

Base: `https://api.openai.com/v1`

| Purpose | Method + path |
| --- | --- |
| Text generation (**current**) | `POST /v1/responses` |
| Text generation (legacy, still supported) | `POST /v1/chat/completions` |
| Model list | `GET /v1/models` |
| Single model metadata | `GET /v1/models/{model}` |
| Embeddings | `POST /v1/embeddings` |
| Text-to-speech | `POST /v1/audio/speech` |
| Batch (50% discount, async) | `POST /v1/batches` |

`gpt-5.6-sol` documents its supported endpoints as **Chat Completions, Responses, and Batch** ([model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol)). For this plugin, **Responses** is the right surface: it is the one OpenAI is actively developing, it exposes `reasoning.effort`, and its structured-output shape (`text.format`) is the current one.

### 2.2 Auth headers

```
Authorization: Bearer sk-...
Content-Type: application/json
OpenAI-Organization: org-...     # optional
OpenAI-Project: proj_...         # optional
```

### 2.3 Minimal request

```json
POST https://api.openai.com/v1/responses

{
  "model": "gpt-5.6-terra",
  "input": [
    { "role": "system", "content": "You are a biomedical literature summarizer." },
    { "role": "user", "content": "Summarize this abstract in 3 sentences:\n\nBackground: ..." }
  ],
  "max_output_tokens": 512,
  "reasoning": { "effort": "low" }
}
```

### 2.4 Minimal response (trimmed)

```json
{
  "id": "resp_68be1f0c2a...",
  "object": "response",
  "created_at": 1788899084,
  "status": "completed",
  "model": "gpt-5.6-terra",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "This randomized trial found ..." }
      ]
    }
  ],
  "usage": {
    "input_tokens": 412,
    "output_tokens": 118,
    "total_tokens": 530
  },
  "incomplete_details": null
}
```

Two parsing notes that trip people up:

- `output` is an **array of items**, and reasoning models emit a `{"type": "reasoning", ...}` item *before* the `message` item. Never read `output[0]`; filter for `type === "message"`, then filter its `content` for `type === "output_text"`.
- Truncation is reported as `status: "incomplete"` with `incomplete_details.reason === "max_output_tokens"` — **not** as an error. Check it explicitly.

### 2.5 Recommended models (verified 2026-09-08)

| Model ID | Tier | Context | Max output | $/1M in | $/1M cached in | $/1M out |
| --- | --- | --- | --- | --- | --- | --- |
| `gpt-6-astra` | Frontier | 1,050,000 | 128,000 | $10.00 | $1.00 | $50.00 |
| `gpt-5.6-sol` | Coding/reasoning flagship | 1,050,000 | 128,000 | $4.00 | $0.40 | $20.00 |
| `gpt-5.6-terra` | Balanced default | 1,050,000 | 128,000 | $2.00 | $0.20 | $12.00 |
| `gpt-5.6-luna` | Cheap/fast | 1,050,000 | 128,000 | $0.20 | $0.02 | $1.20 |

Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [OpenAI models](https://developers.openai.com/api/docs/models), [gpt-5.6-sol model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

Knowledge cutoffs: `gpt-6-astra` 2026-04-30; the GPT-5.6 family 2026-02-16.

**Reasoning effort** on all four: `low | medium | high | xhigh | max`, default `medium`. There is **no `none`/`minimal` level** on this family — OpenAI's model pages list five values starting at `low`, and OpenRouter's catalogue reports `reasoning.mandatory: true` with `supported_efforts: ["max","xhigh","high","medium","low"]` for every `gpt-6-astra` / `gpt-5.6-*` entry (re-checked 2026-09-08). For per-abstract summarization use `low`; for the trend-report synthesis step `medium`/`high` is worth the tokens.

> **Note on a price discrepancy found during verification:** OpenRouter's model catalogue lists `openai/gpt-5.6-sol` at $2.00/$10.00 per 1M, while OpenAI's own pricing page and model page list $4.00/$20.00. `terra` and `luna` agree between the two sources. Trust the provider's own page for native calls, and trust OpenRouter's `pricing` field for OpenRouter-routed calls — they are billing you separately and may genuinely differ. This is a concrete argument for reading prices from the API rather than a constant table.

### 2.6 Reasoning tokens are billed as output

Reasoning-model output tokens include hidden reasoning tokens. `usage.output_tokens` includes them, so cost estimates that assume "output tokens ≈ visible text length" understate cost by 2–5× at `high`/`xhigh` effort. Budget accordingly, and default the summarization pass to a low effort.

---

## 3. Anthropic (Claude)

> Model IDs, pricing, and parameter names in this section come from the bundled `claude-api` skill reference (cached 2026-06-24) cross-checked against [platform.claude.com](https://platform.claude.com/docs/en/api/rate-limits) and the [structured outputs guide](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) on 2026-09-08.

### 3.1 Base URL and endpoints

Base: `https://api.anthropic.com`

| Purpose | Method + path |
| --- | --- |
| Text generation | `POST /v1/messages` |
| Token counting (exact, free) | `POST /v1/messages/count_tokens` |
| Model list | `GET /v1/models` |
| Single model metadata | `GET /v1/models/{model_id}` |
| Batch (50% discount, async) | `POST /v1/messages/batches` |
| Embeddings | **none — Anthropic has no embeddings endpoint** |

### 3.2 Auth headers

```
x-api-key: sk-ant-...
anthropic-version: 2023-06-01
content-type: application/json
anthropic-dangerous-direct-browser-access: true   # belt-and-braces, see §1.2
```

`anthropic-version` is **required** on every request. `2023-06-01` is the current stable version string; it has not changed and is not a date you should bump opportunistically.

### 3.3 Minimal request

```json
POST https://api.anthropic.com/v1/messages

{
  "model": "claude-sonnet-5",
  "max_tokens": 512,
  "system": "You are a biomedical literature summarizer.",
  "messages": [
    { "role": "user", "content": "Summarize this abstract in 3 sentences:\n\nBackground: ..." }
  ]
}
```

`max_tokens` is **required** (unlike OpenAI/Gemini where it is optional). `system` is a **top-level field**, not a message with `role: "system"`.

### 3.4 Minimal response (trimmed)

```json
{
  "id": "msg_01XyZ...",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-5",
  "content": [
    { "type": "text", "text": "This randomized trial found ..." }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 412,
    "output_tokens": 118,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

Parsing notes:

- `content` is an array of blocks. With thinking enabled, a `{"type": "thinking", ...}` block precedes the `text` block. Filter for `type === "text"` and concatenate.
- Truncation is `stop_reason === "max_tokens"`, returned with HTTP 200.
- `stop_reason` can also be `"refusal"` on Opus 4.7 and later (so: every model in §3.5). When it is, `content` may be empty and `stop_details` is populated — `stop_details` is `null` for every other `stop_reason`, so guard before reading it. **Always check `stop_reason` before reading `content`.**
- `usage.input_tokens` counts only tokens *after the last cache breakpoint*. Total input = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Getting this wrong silently under-reports cost by the size of your cached prefix.

### 3.5 Recommended models (verified 2026-09-08)

| Model ID | Tier | Context | Max output | $/1M in | $/1M cache read | $/1M out |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-opus-5` | Frontier | 1,000,000 | 128,000 | $5.00 | $0.50 | $25.00 |
| `claude-sonnet-5` | Balanced default | 1,000,000 | 128,000 | $2.00 | $0.20 | $10.00 |
| `claude-haiku-4-5` | Cheap/fast | 200,000 | 64,000 | $1.00 | $0.10 | $5.00 |
| `claude-fable-5-1` | Most capable | 1,000,000 | 128,000 | $10.00 | $0.25 | $50.00 |

**Do not append date suffixes** to these IDs — `claude-opus-5`, never `claude-opus-5-20260401`. The IDs above are complete as-is.

### 3.6 Thinking / effort

Current Claude models use **adaptive thinking**, not a fixed token budget:

```json
{ "thinking": { "type": "adaptive" }, "output_config": { "effort": "low" } }
```

- `budget_tokens` is **removed** on Opus 5, Sonnet 5, Opus 4.7/4.8, and Fable 5/5.1 — sending it returns a 400. It still works on Haiku 4.5 and earlier models, and survives on Opus 4.6 / Sonnet 4.6 only as a deprecated transitional escape hatch. None of those are models this plugin should default to.
- `effort` lives **inside `output_config`**, not top-level. Values `low | medium | high | xhigh | max`; default `high`.
- On `claude-opus-5` **and `claude-sonnet-5`**, thinking is **on by default** — omitting the `thinking` field runs adaptive thinking. On Opus 4.8/4.7, omitting it runs *without* thinking. This asymmetry matters for cost: on both of the models this plugin recommends, doing nothing means paying for thinking tokens.
- For per-abstract summarization set `output_config: { "effort": "low" }`; this is the single biggest Claude-side cost lever in this plugin.
- **Prefill is removed** on all current models — you cannot seed the assistant turn to force JSON. Use structured outputs (§7.2) instead.

---

## 4. Google Gemini

Google shipped a **new primary API surface** in 2026. Both are live:

| Surface | Status | Path |
| --- | --- | --- |
| **Interactions API** | GA since June 2026; recommended for new projects | `POST /v1beta/interactions` |
| `generateContent` | **Legacy**, "remains fully supported" | `POST /v1beta/models/{model}:generateContent` |

The legacy schema for the *Interactions* API was removed on 2026-06-08; `generateContent` itself was not removed. Sources: [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview), [breaking changes guide](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026).

**Recommendation for research_helper:** implement the **Interactions API** as the primary Gemini path (it is where audio output, structured output, and thinking config now live coherently), and keep `generateContent` as a documented fallback for users pinned to older SDK-equivalent behaviour. The Gemini TTS feature (doc `04`) needs a decision here too — see that document.

### 4.1 Base URL and endpoints

Base: `https://generativelanguage.googleapis.com`

| Purpose | Method + path |
| --- | --- |
| Text generation (current) | `POST /v1beta/interactions` |
| Text generation (legacy) | `POST /v1beta/models/{model}:generateContent` |
| Streaming (legacy) | `POST /v1beta/models/{model}:streamGenerateContent` |
| Model list | `GET /v1beta/models` |
| Single model | `GET /v1beta/models/{model}` |
| Embeddings | `POST /v1beta/models/{model}:embedContent` |
| Batch embeddings | `POST /v1beta/models/{model}:batchEmbedContents` |

### 4.2 Auth headers

```
x-goog-api-key: AIza...
Content-Type: application/json
```

Gemini also accepts `?key=AIza...` as a query parameter. **Do not use it** — see §1.3.

### 4.3 Minimal request — Interactions API

```json
POST https://generativelanguage.googleapis.com/v1beta/interactions

{
  "model": "gemini-3.8-flash",
  "system_instruction": "You are a biomedical literature summarizer.",
  "input": "Summarize this abstract in 3 sentences:\n\nBackground: ...",
  "generation_config": {
    "max_output_tokens": 512,
    "thinking_level": "low"
  }
}
```

Full accepted request fields per the [API reference](https://ai.google.dev/api/interactions-api): `model` (or `agent`), `input` (string | Content | Content[] | Step[]), `system_instruction`, `tools`, `response_format`, `generation_config`, `stream`, `store`, `background`, `labels`, `safety_settings`, `service_tier`, `previous_interaction_id`.

`generation_config` accepts: `max_output_tokens`, `seed`, `stop_sequences`, `thinking_level` (`minimal | low | medium | high`), `thinking_summaries` (`auto | none`), `tool_choice`, `speech_config`, `transcription_config`.

### 4.4 Minimal response — Interactions API (trimmed)

```json
{
  "id": "int_abc123",
  "object": "interaction",
  "model": "gemini-3.8-flash",
  "status": "completed",
  "created": "2026-09-08T07:31:22Z",
  "steps": [
    {
      "type": "model_output",
      "content": [
        { "type": "text", "text": "This randomized trial found ..." }
      ]
    }
  ],
  "usage": {
    "total_input_tokens": 412,
    "total_output_tokens": 118,
    "total_cached_tokens": 0,
    "total_thought_tokens": 44,
    "total_tokens": 574
  }
}
```

Parsing notes:

- The response is a **`steps` array**, not `candidates` (legacy) and not `outputs` (pre-May-2026 Interactions). Step types include `model_output`, `user_input`, `function_call`, `function_result`, `code_execution_call`, `code_execution_result`. Filter for `model_output`.
- A `POST` returns only the *output* steps; a subsequent `GET` on the interaction returns the full timeline including the initial `user_input` step.
- `usage` uses `total_input_tokens` / `total_output_tokens` — **not** the legacy `usageMetadata.promptTokenCount` / `candidatesTokenCount`. Thinking tokens are reported separately as `total_thought_tokens`; confirm empirically whether they are additionally included in `total_output_tokens` for billing.
- `status` can be `in_progress | requires_action | completed | failed | cancelled | incomplete | budget_exceeded | queued`. Check for `completed` before reading content.

### 4.5 Legacy `generateContent` shape (for reference / fallback)

```json
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent

{
  "systemInstruction": { "parts": [{ "text": "You are a biomedical literature summarizer." }] },
  "contents": [
    { "role": "user", "parts": [{ "text": "Summarize this abstract ..." }] }
  ],
  "generationConfig": {
    "maxOutputTokens": 512,
    "temperature": 1.0,
    "responseMimeType": "text/plain"
  }
}
```

Note the case shift: the legacy surface is **camelCase** (`generationConfig`, `maxOutputTokens`, `responseMimeType`, `systemInstruction`), the Interactions API is **snake_case** (`generation_config`, `max_output_tokens`, `system_instruction`). This is the single most common source of silently-ignored fields when porting between them. An adapter that supports both must not share a serializer.

### 4.6 Recommended models (verified 2026-09-08)

| Model ID | Tier | Context | Max output | $/1M in | $/1M out |
| --- | --- | --- | --- | --- | --- |
| `gemini-3.8-flash` | Newest flagship Flash | 1,048,576 | 65,536 | $0.75 → $1.50 | $3.75 → $7.50 |
| `gemini-3.1-pro-preview` | Pro reasoning | 1,048,576 | 65,536 | $2.00¹ | $12.00¹ |
| `gemini-3.5-flash` | Legacy Flash | 1,048,576 | 65,536 | $1.50 | $9.00 |
| `gemini-3.5-flash-lite` | Cheap | 1,048,576 | 65,536 | $0.30 | $2.50 |
| `gemini-3.1-flash-lite` | Cheapest | 1,048,576 | 65,536 | $0.25 | $1.50 |

¹ `gemini-3.1-pro-preview` has a **long-context surcharge tier**: above a 200,000-token prompt the rates step to **$4.00 in / $18.00 out** per 1M ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), re-checked 2026-09-08). This is the same class of trap as `gpt-6-astra`'s 272,000-token tier (§12.3), and the same mitigation applies: prefer per-paper calls over one stuffed call.

This table is a **curated subset**, not the whole Flash line. Google also ships `gemini-3.7-flash` and `gemini-3.6-flash` between 3.5 and 3.8, both listed by OpenRouter at $0.75/$3.75 per 1M. Nothing in the design depends on which of these is picked — that is the point of §9 model discovery — but do not treat `gemini-3.5-flash` as "the previous Flash".

`gemini-3.8-flash` is on **promotional pricing of $0.75/$3.75 per 1M through 31 December 2026**, reverting to $1.50/$7.50 on 1 January 2027 ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)). A plugin that hardcodes $0.75 will start under-reporting cost in January 2027 — another reason to read prices from an API (§9).

Context and max-output figures are cross-checked against OpenRouter's catalogue, which reports `context_length: 1048576` and `max_completion_tokens: 65536` for the Gemini 3.x line.

**Gemini has a genuinely usable free tier**, unlike OpenAI and Anthropic — the lowest-friction first run of the four.

> **Decision (2026-09-08): the default provider is OpenRouter, not Gemini.** The free tier was the argument for Gemini, and it is the same thing that disqualifies it as a *default*: Google trains on free-tier traffic, including the audio of generated reports, and "paid" requires the Cloud **project** to be billing-linked, not merely the account — so a user who accepts a Gemini default and never touches billing is silently shipping their literature and their trend reports to a tier with human review. A default should not be the option whose failure mode is invisible.
>
> OpenRouter instead gives one key for every model, and `GET /api/v1/models` is the only machine-readable price source of the four, which makes the pre-run cost estimate accurate rather than hardcoded. Its cost is that there is no free tier — first use requires credit — and that `data_collection` defaults to `"allow"`, which the plugin must override to `"deny"` on every request (see [09-security-privacy-and-api-keys.md](09-security-privacy-and-api-keys.md)).
>
> Gemini remains **required** for the audio report (F5, [04-audio-report-tts.md](04-audio-report-tts.md)) and stays a first-class choice in the provider picker; it is simply not what a user gets by not choosing.

---

## 5. OpenRouter

### 5.1 Base URL and endpoints

Base: `https://openrouter.ai/api/v1`

| Purpose | Method + path |
| --- | --- |
| Text generation (OpenAI-compatible) | `POST /api/v1/chat/completions` |
| Model catalogue (public, no auth) | `GET /api/v1/models` |
| Endpoints for one model | `GET /api/v1/models/{author}/{slug}/endpoints` |
| Key limits and credit usage | `GET /api/v1/key` |
| Generation stats by id | `GET /api/v1/generation?id=...` |

### 5.2 Auth and attribution headers

```
Authorization: Bearer sk-or-v1-...
Content-Type: application/json
HTTP-Referer: https://github.com/suppakoko/research_helper
X-Title: research_helper
```

> **Unverified — naming of the attribution header.** OpenRouter's [quickstart](https://openrouter.ai/docs/quickstart) currently documents the site-name header as **`X-OpenRouter-Title`**, while `X-Title` is the long-standing name used in the wild and in most integrations. The [chat-completion API reference](https://openrouter.ai/docs/api-reference/chat-completion) lists neither, documenting only `X-OpenRouter-Metadata`. Both `HTTP-Referer` and the title header are **optional** — they only affect leaderboard attribution, never functionality. **Send both `X-Title` and `X-OpenRouter-Title`** until this is settled; unknown headers are ignored.

A genuinely useful documented header is `X-OpenRouter-Metadata: enabled`, which surfaces routing metadata on the response under `openrouter_metadata` (including which upstream endpoint actually served the request). Turn this on in debug builds.

### 5.3 Minimal request

```json
POST https://openrouter.ai/api/v1/chat/completions

{
  "model": "google/gemini-3.8-flash",
  "messages": [
    { "role": "system", "content": "You are a biomedical literature summarizer." },
    { "role": "user", "content": "Summarize this abstract in 3 sentences:\n\nBackground: ..." }
  ],
  "max_tokens": 512,
  "provider": {
    "require_parameters": true,
    "data_collection": "deny",
    "sort": "price"
  }
}
```

### 5.4 Minimal response (trimmed)

```json
{
  "id": "gen-1788899084-AbCdEf",
  "object": "chat.completion",
  "created": 1788899084,
  "model": "google/gemini-3.8-flash",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": { "role": "assistant", "content": "This randomized trial found ..." }
    }
  ],
  "usage": {
    "prompt_tokens": 412,
    "completion_tokens": 118,
    "total_tokens": 530,
    "cost": 0.000752,
    "is_byok": false
  },
  "system_fingerprint": null
}
```

The `usage.cost` field is unique to OpenRouter and is **the actual credit cost of the call in USD**. This is the cheapest reliable cost telemetry available to the plugin — no other provider returns dollars. If a "session cost so far" UI is wanted, OpenRouter gives it for free.

`finish_reason` is normalized by OpenRouter across providers to `stop | length | tool_calls | content_filter | error`.

### 5.5 Model IDs

OpenRouter model slugs are `{author}/{slug}`, optionally with a variant suffix:

- `openai/gpt-5.6-terra`, `anthropic/claude-sonnet-5`, `google/gemini-3.8-flash`
- `:batch` — async batch pricing (50% off): `anthropic/claude-sonnet-5:batch`
- `:nitro` — sort by throughput, priority tier endpoints
- `:floor` — sort by price, flex tier endpoints
- `~openai/gpt-latest` — auto-updating alias to the current OpenAI flagship (used in OpenRouter's own quickstart). Convenient, but it silently changes cost and capability under you; **do not use it as a plugin default.**

The catalogue currently exposes **426 models** (`GET /api/v1/models`, fetched 2026-09-08). The count moves by a few every week; treat it as an order of magnitude, never as a constant.

---

## 6. Streaming (SSE) comparison

All four support `text/event-stream`. The framing is identical; the payloads are not.

### 6.1 OpenAI Responses API

Enable with `"stream": true`. Events are **typed by an `event:` line and by `type` in the JSON**:

```
event: response.created
data: {"type":"response.created","response":{"id":"resp_...","status":"in_progress"}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"This randomized"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":" trial found"}

event: response.completed
data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":412,"output_tokens":118}}}
```

Other documented event types include `response.in_progress`, `response.failed`, `response.output_item.added`, `response.output_item.done`, `response.content_part.added`, `response.content_part.done`, `response.refusal.delta`, `response.refusal.done`, `response.function_call_arguments.delta`, `response.function_call_arguments.done`, and `error`.

**Parsing note:** there is **no `[DONE]` sentinel** on the Responses API — the stream ends after `response.completed`. Legacy Chat Completions *does* send `data: [DONE]`. An adapter supporting both must handle each separately.

Legacy Chat Completions delta shape, for contrast:

```
data: {"choices":[{"index":0,"delta":{"content":"This"},"finish_reason":null}]}
data: [DONE]
```

### 6.2 Anthropic Messages API

Enable with `"stream": true`. Verified event names ([streaming docs](https://platform.claude.com/docs/en/build-with-claude/streaming)): `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, `ping`, `error`.

```
event: message_start
data: {"type": "message_start", "message": {"id": "msg_1nZdL29xx5MUA1yADyHTEsnR8uuvGzszyY", "type": "message", "role": "assistant", "content": [], "model": "claude-opus-5", "stop_reason": null, "stop_sequence": null, "usage": {"input_tokens": 25, "output_tokens": 1}}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: ping
data: {"type": "ping"}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "!"}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": null}, "usage": {"output_tokens": 15}}

event: message_stop
data: {"type": "message_stop"}
```

Parsing notes, in rough order of how likely they are to bite:

1. **`delta.type` discriminates the payload.** `text_delta` → `.text`; `input_json_delta` → `.partial_json` (a *string fragment* of JSON, must be concatenated then parsed); `thinking_delta` → `.thinking`; `signature_delta` → `.signature`. Blindly reading `delta.text` produces `undefined` on tool and thinking streams.
2. **Multiple concurrent blocks.** `index` matters — a response can interleave a thinking block (index 0) and a text block (index 1).
3. **`ping` events carry no data** and must be ignored, not parsed as content.
4. **Errors arrive mid-stream as SSE, with HTTP 200 already sent.** `event: error` / `data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`. A streaming client that only checks HTTP status will treat an overload as a truncated success. This is the most important Anthropic-specific streaming bug to avoid.
5. **Final usage is on `message_delta`**, not `message_stop`. `message_start.usage.output_tokens` is a placeholder (`1`).

### 6.3 Gemini

**Interactions API:** set `"stream": true` in the body. Event names after the May 2026 rename: `interaction.created`, `step.start`, `step.delta`, `step.stop`, `interaction.completed`. (Previously `interaction.start`, `content.delta`, `content.stop`, `interaction.complete` — code written before mid-2026 will silently receive nothing.)

For streamed function calls, `step.start` carries the function *name* and `step.delta` events stream the *arguments* as partial JSON strings — the same accumulate-then-parse pattern as Anthropic's `input_json_delta`.

**Legacy `streamGenerateContent`:** append `?alt=sse` to get SSE framing; without it the endpoint returns a **stream of concatenated JSON array chunks**, not SSE. Each SSE `data:` line is a full `GenerateContentResponse` with a partial `candidates[0].content.parts[0].text`.

### 6.4 OpenRouter

Set `"stream": true`. Emits **OpenAI Chat Completions-shaped** deltas regardless of the upstream provider, terminated by `data: [DONE]`. OpenRouter also emits **SSE comment lines** (`: OPENROUTER PROCESSING`) as keepalives during provider cold starts — a strict SSE parser must skip lines beginning with `:` rather than erroring.

### 6.5 Streaming implementation note for Zotero

`Zotero.HTTP.request()` buffers the whole response and is not suitable for streaming. For SSE either:

- use `fetch()` with `response.body.getReader()` and a manual `TextDecoder` + line splitter, or
- use `XMLHttpRequest` with `onprogress` and slice `responseText` from a saved offset.

The second is uglier but is guaranteed available in the chrome context. **Streaming is optional for this plugin**: the summarization pipeline is a batch job with a progress bar, not a chat UI. Recommend implementing `complete()` first and treating `stream()` as a phase-2 nicety used only for the trend-report generation step, where the user is watching a single long output.

---

## 7. Structured / JSON output comparison

The summarization pipeline should return structured objects (`{summary, methods, population, key_finding, limitations, topics[]}`), not prose to be regex-parsed. All four can do this; the mechanisms differ in strength.

### 7.1 OpenAI — Structured Outputs (strongest)

Responses API:

```json
{
  "model": "gpt-5.6-terra",
  "input": [ ... ],
  "text": {
    "format": {
      "type": "json_schema",
      "name": "paper_summary",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "summary":     { "type": "string" },
          "key_finding": { "type": "string" },
          "topics":      { "type": "array", "items": { "type": "string" } }
        },
        "required": ["summary", "key_finding", "topics"],
        "additionalProperties": false
      }
    }
  }
}
```

Chat Completions uses a different nesting — `response_format.json_schema.{name,schema,strict}`:

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "paper_summary",
      "strict": true,
      "schema": { "...": "..." }
    }
  }
}
```

With `strict: true` the schema must declare **every** property in `required` and set `"additionalProperties": false` at every object level. Optional fields are expressed as `{"type": ["string", "null"]}`. Recursive schemas use `{"$ref": "#"}`.

### 7.2 Anthropic — native structured outputs (`output_config.format`)

Anthropic now has first-class structured outputs; **the old "define a tool and force `tool_choice`" workaround is no longer the recommended path**, and on Fable 5.1 forced `tool_choice` is rejected outright with a 400.

```bash
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-5",
    "max_tokens": 1024,
    "messages": [{ "role": "user", "content": "Summarize this abstract: ..." }],
    "output_config": {
      "format": {
        "type": "json_schema",
        "schema": {
          "type": "object",
          "properties": {
            "summary":     { "type": "string" },
            "key_finding": { "type": "string" },
            "topics":      { "type": "array", "items": { "type": "string" } }
          },
          "required": ["summary", "key_finding", "topics"],
          "additionalProperties": false
        }
      }
    }
  }'
```

The response is a normal `text` block whose `.text` is the JSON string:

```json
{
  "content": [{ "type": "text", "text": "{\"summary\":\"...\",\"key_finding\":\"...\",\"topics\":[\"...\"]}" }],
  "stop_reason": "end_turn"
}
```

Supported on `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`, the Opus 4.x line, and Fable 5/5.1 ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). (No date suffix or wildcard — the IDs are complete as written, per §3.5.)

Two caveats:
- Use `output_config: {format: {...}}`. The older top-level `output_format` parameter is **deprecated**.
- Structured outputs are **incompatible with citations** (`citations: {enabled: true}` on document blocks) — sending both returns 400. Not an issue for this plugin's summarization pass.

The **tool-use JSON pattern** remains as a fallback for older models: define a single tool with the target `input_schema` and read `tool_use.input`. Add `"strict": true` on the tool definition for schema-valid arguments. Always `JSON.parse()` tool inputs — never string-match the serialized form, as escaping varies across models.

### 7.3 Gemini

**Interactions API** — schema goes inside the polymorphic `response_format`:

```json
{
  "model": "gemini-3.8-flash",
  "input": "Summarize this abstract: ...",
  "response_format": {
    "type": "text",
    "mime_type": "application/json",
    "schema": {
      "type": "object",
      "properties": {
        "summary":     { "type": "string" },
        "key_finding": { "type": "string" },
        "topics":      { "type": "array", "items": { "type": "string" } }
      },
      "required": ["summary", "key_finding", "topics"]
    }
  }
}
```

`response_mime_type` as a sibling field was **removed** in May 2026; the MIME type is now a subfield of `response_format`.

**Legacy `generateContent`** — the pre-Interactions shape, still valid on that endpoint:

```json
{
  "generationConfig": {
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "OBJECT",
      "properties": {
        "summary":     { "type": "STRING" },
        "key_finding": { "type": "STRING" },
        "topics":      { "type": "ARRAY", "items": { "type": "STRING" } }
      },
      "required": ["summary", "key_finding", "topics"]
    }
  }
}
```

Note the legacy surface uses **uppercase OpenAPI type names** (`OBJECT`, `STRING`, `ARRAY`) — a JSON Schema written for OpenAI will not port unmodified. The Interactions API uses lowercase JSON Schema types. **The adapter must own a schema translation step for the legacy path.**

### 7.4 OpenRouter — passthrough, with caveats

OpenRouter accepts the OpenAI Chat Completions `response_format.json_schema` shape and translates it for the upstream provider. Supporting providers include OpenAI, Google Gemini, Anthropic, and Fireworks.

The caveats are real and this is where OpenRouter is weakest:

1. **Support is per-endpoint, not per-model.** The same model served by two providers may support structured outputs on one and not the other. Filter the catalogue by `supported_parameters=structured_outputs`.
2. **Silent degradation.** A provider that does not support `response_format` may simply ignore it and return prose. There is no error.
3. **The fix is `provider.require_parameters: true`**, which restricts routing to endpoints that support every parameter in your request. **Always set this when sending `response_format` through OpenRouter.** It is the difference between "structured output" and "usually structured output".
4. **Always validate anyway.** Regardless of provider, the adapter should run the parsed object against the schema client-side and retry once on failure. This costs almost nothing and covers every degradation path.

### 7.5 Summary

| Provider | Mechanism | Guarantee | Field path |
| --- | --- | --- | --- |
| OpenAI (Responses) | Structured Outputs | Strong (constrained decoding) | `text.format` |
| OpenAI (Chat) | Structured Outputs | Strong | `response_format.json_schema` |
| Anthropic | Native structured outputs | Strong | `output_config.format` |
| Anthropic (fallback) | Strict tool use | Strong | `tools[].strict` + `tool_use.input` |
| Gemini (Interactions) | `response_format` + schema | Strong | `response_format.{mime_type,schema}` |
| Gemini (legacy) | `responseSchema` | Strong | `generationConfig.responseSchema` |
| OpenRouter | Passthrough | **Conditional** — requires `require_parameters` | `response_format.json_schema` |

---

## 8. Prompt caching

### 8.1 Why it matters here specifically

`research_helper`'s summarization pass is close to the ideal caching workload: **one long, byte-identical system prompt sent N times with a short varying suffix**. For 100 papers, the system prompt is transmitted 100 times. If it is 1,500 tokens, that is 150,000 input tokens of pure repetition.

### 8.2 Per-provider mechanics

| Provider | Mechanism | Min cacheable prefix | Discount | TTL |
| --- | --- | --- | --- | --- |
| **OpenAI** | Automatic, no opt-in | ~1,024 tokens | 90% off input (e.g. $2.00 → $0.20) | minutes, opaque |
| **Anthropic** | Explicit `cache_control: {"type":"ephemeral"}`, max 4 breakpoints | 512–4,096 tokens, **model-dependent** | ~90% off on read; write costs ~1.25× | 5 min default, 1 h option |
| **Gemini** | Implicit caching (automatic) + explicit `cachedContent` | model-dependent | reported in `usage.total_cached_tokens` | — |
| **OpenRouter** | Passes through upstream caching; `pricing.input_cache_read` / `input_cache_write` exposed per model | inherits upstream | inherits | inherits |

### 8.3 The design consequence for this plugin

**A 400-token system prompt will never cache on any provider.** All three native providers have a minimum cacheable prefix around 1,000+ tokens. This produces a concrete design instruction:

> **Either write a system prompt long enough to cache (≥ ~1,500 tokens — a full rubric with worked examples, which also improves summary quality), or batch multiple abstracts per request so the fixed prefix is amortized differently. Do not write a terse 200-token system prompt and expect caching to help.**

Anthropic's rendering order is `tools` → `system` → `messages`, and caching is a **prefix match**: any byte change anywhere in the prefix invalidates everything after it. Therefore:

- Put the frozen rubric first, place the `cache_control` breakpoint at its end, and put the varying abstract after it.
- **No timestamps, no per-request IDs, no `Date.now()`, no unsorted JSON in the system prompt.** These are the classic silent invalidators.
- Verify with `usage.cache_read_input_tokens`. If it is 0 across repeated calls, caching is not working — treat that as a bug, not a nuance.
- Anthropic ITPM rate limits **exclude** `cache_read_input_tokens`, so caching raises effective throughput as well as lowering cost.

### 8.4 Estimated saving

100 papers × 1,500-token cached system prompt = 150,000 input tokens. On `claude-sonnet-5` at $2.00/1M vs $0.20/1M cache-read, that is **$0.30 → $0.03**, saving $0.27 per run — roughly **70%** of the summarization pass's input cost (the pass is 195,000 input tokens ≈ $0.39 uncached; see §12.2). On `gpt-6-astra` the same saving is $1.50 → $0.15.

---

## 9. Model discovery

**Do not ship a hardcoded model list.** The four provider catalogues changed substantially between the GPT-5 era and September 2026. Fetch at runtime, cache in prefs with a TTL (24 h is reasonable), and fall back to a small bundled default list only if all fetches fail.

### 9.1 OpenAI — `GET /v1/models`

```
GET https://api.openai.com/v1/models
Authorization: Bearer sk-...
```

```json
{
  "object": "list",
  "data": [
    { "id": "gpt-6-astra", "object": "model", "created": 1788552838, "owned_by": "openai" },
    { "id": "gpt-5.6-terra", "object": "model", "created": 1783000000, "owned_by": "openai" }
  ]
}
```

**Limitation:** returns IDs only — **no context window, no pricing, no capability flags**. It also returns embedding, TTS, transcription, and image models mixed in with chat models. The plugin must filter (drop anything matching `/embedding|tts|transcribe|whisper|image|realtime|moderation|audio/`) and get context/pricing elsewhere. This is the weakest discovery endpoint of the four.

### 9.2 Anthropic — `GET /v1/models`

```
GET https://api.anthropic.com/v1/models
x-api-key: sk-ant-...
anthropic-version: 2023-06-01
```

Since March 2026 each model object carries `id`, `display_name`, `created_at`, **`max_input_tokens`** (the context window), **`max_tokens`** (output cap), and **`capabilities`**. There is **no `context_window` field** — the name is `max_input_tokens`. This is enough to drive a model picker and to size the summarization chunker. Pricing is still not exposed.

The endpoint auto-paginates; follow `has_more` / `last_id`.

### 9.3 Gemini — `GET /v1beta/models`

```
GET https://generativelanguage.googleapis.com/v1beta/models
x-goog-api-key: AIza...
```

Returns entries with `name` (`models/gemini-3.8-flash`), `displayName`, `description`, `inputTokenLimit`, `outputTokenLimit`, and `supportedGenerationMethods`. Filter on `supportedGenerationMethods` containing `generateContent` to exclude embedding/TTS-only models. Strip the `models/` prefix before use. Pricing is not exposed.

### 9.4 OpenRouter — `GET /api/v1/models` (the best one)

```
GET https://openrouter.ai/api/v1/models
```

**No authentication required.** Returns the full catalogue (426 entries on 2026-09-08) with everything the other three omit:

```json
{
  "id": "openai/gpt-6-astra",
  "canonical_slug": "openai/gpt-6-astra-20260903",
  "name": "OpenAI: GPT-6 Astra",
  "created": 1788552838,
  "context_length": 1050000,
  "architecture": {
    "modality": "text+image+file->text",
    "input_modalities": ["file", "image", "text"],
    "output_modalities": ["text"],
    "tokenizer": "GPT"
  },
  "pricing": {
    "prompt": "0.00001",
    "completion": "0.00005",
    "input_cache_read": "0.000001",
    "input_cache_write": "0.0000125",
    "overrides": [
      { "min_prompt_tokens": 272000, "prompt": "0.00002", "completion": "0.000075" }
    ]
  },
  "top_provider": { "context_length": 1050000, "max_completion_tokens": 128000, "is_moderated": true },
  "supported_parameters": ["reasoning", "reasoning_effort", "response_format", "structured_outputs", "tools", "tool_choice", "seed", "max_tokens"],
  "reasoning": { "mandatory": true, "default_enabled": true, "supported_efforts": ["max","xhigh","high","medium","low"], "default_effort": "medium" }
}
```

Fields worth exploiting:

- `pricing.prompt` / `pricing.completion` are **per token as decimal strings**. Multiply by 1e6 for $/1M. Parse as strings then convert — they are deliberately not JSON numbers to avoid float issues.
- `pricing.overrides[]` encodes **long-context surcharge tiers** (GPT-6 Astra doubles input price above 272,000 prompt tokens). A cost estimator that ignores `overrides` will under-quote long-context runs.
- `supported_parameters` is the authoritative structured-output capability flag — filter on `structured_outputs` to populate `supportsJSONSchema`.
- `top_provider.max_completion_tokens` gives the output cap.
- `reasoning.supported_efforts` drives an effort dropdown.

**Design recommendation:** use OpenRouter's public catalogue as a **metadata source for all providers**, even when the user is calling that provider natively. It is unauthenticated, it covers OpenAI/Anthropic/Google models under mostly predictable slugs, and it is the only machine-readable price source of the four. Map native ID → OpenRouter slug to enrich the picker with context length and price, and degrade gracefully if a slug is missing.

**The mapping is not pure prefixing, and Anthropic is the exception that will bite you.** OpenAI and Google slugs are the native ID with an author prefix (`gpt-5.6-terra` → `openai/gpt-5.6-terra`, `gemini-3.8-flash` → `google/gemini-3.8-flash`). Anthropic's native IDs use **dashes** for the version separator while OpenRouter uses a **dot**:

| Native Anthropic ID | OpenRouter slug |
| --- | --- |
| `claude-opus-5` | `anthropic/claude-opus-5` |
| `claude-sonnet-5` | `anthropic/claude-sonnet-5` |
| `claude-haiku-4-5` | `anthropic/claude-haiku-4.5` |
| `claude-fable-5-1` | `anthropic/claude-fable-5.1` |

So the rule is: prefix with the author, then rewrite a trailing `-<major>-<minor>` to `-<major>.<minor>`. Naïve prefixing produces a 404 for `claude-haiku-4-5` — which §16 recommends for Anthropic-only users — and for `claude-fable-5-1`. The same dot form applies to the older Opus/Sonnet 4.x slugs. Verified against the live catalogue on 2026-09-08.

---

## 10. Token counting and estimation

### 10.1 Exact counting

| Provider | Method | Cost | Notes |
| --- | --- | --- | --- |
| **Anthropic** | `POST /v1/messages/count_tokens` | Free | Exact, server-side, accepts the full request shape including `system` and `tools`. The only provider with a first-class free counting endpoint. Use it. |
| **OpenAI** | None | — | No count endpoint. Client-side `tiktoken` is impractical to bundle in a Zotero plugin (WASM + BPE ranks ≈ multiple MB) and the encoding for the GPT-5.6/6 family is not documented as a public tiktoken encoding. |
| **Gemini** | `POST /v1beta/models/{model}:countTokens` (legacy surface) | Free | Available on the legacy endpoint. > **Unverified:** whether an Interactions-API equivalent exists. Test `:countTokens` against a current model before relying on it. |
| **OpenRouter** | None pre-flight; `usage` returned post-hoc | — | `usage.cost` after the fact is exact in dollars. |

### 10.2 Recommended estimator

For pre-flight budgeting and chunk sizing, a heuristic is sufficient and avoids bundling a tokenizer:

```ts
/**
 * Rough token estimate. Deliberately conservative (over-estimates).
 * Calibrated for English academic prose; Korean and CJK are denser per character.
 */
function estimateTokens(text: string): number {
  const chars = text.length;
  // Hangul syllables run to U+D7A3 (힣) — a range ending at 힝 (U+D799) drops
  // the last ten syllables. Jamo, kana and CJK ideographs listed explicitly.
  const cjk = (text.match(/[ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힣]/g) || []).length;
  const latin = chars - cjk;
  // ~3.7 chars/token for English academic text; ~1.3 chars/token for Korean/CJK.
  return Math.ceil(latin / 3.7 + cjk / 1.3) + 16; // +16 for message framing overhead
}
```

Rules of thumb for calibration:

- English academic abstract, 250 words ≈ **350 tokens**.
- Korean text is roughly **2.5–3× more token-dense per character** than English. A Korean audio script of the same *spoken duration* as an English one costs meaningfully more input tokens. This matters for doc `04`.
- **Always leave 20% headroom.** Use the estimate to decide chunk boundaries, then trust the server's returned `usage` for actual accounting.

> **Authority note — do not implement the signature below.** `07-architecture-and-data-model.md`
> §4.3 owns the *shipped* `LLMProvider` contract, and there `countTokens` is
> **`countTokens(text: string, modelId: string): number`** — synchronous, taking a plain string,
> returning a bare number described as a "best-effort token count for budgeting" that "falls back to
> a heuristic". The `{ tokens, exact }` shape recommended below (and sketched again in §14.1) is a
> **working design from before that consolidation**, not a second contract. Where the two disagree,
> **doc 07 §4.3 wins** — this is the same rule §14.1's authority note states for the rest of the
> adapter interface. Read the recommendation below for the *policy* it sets, which doc 07 does not
> restate and which still holds in full; take the signature from doc 07 §4.3 when writing code.
>
> Translating the policy onto the shipped signature: because the return value carries no `exact`
> flag, **every `countTokens()` result must be treated as inexact** at the call site — which is the
> conservative reading of the rule below and costs nothing, since the rule already forbids gating
> hard behaviour on an inexact count. Anthropic's exact `/v1/messages/count_tokens` endpoint (§10.1)
> is still worth calling where an exact number is genuinely wanted; it is just not surfaced through
> this interface member.

**Design recommendation (policy, not signature — see the authority note above):** `countTokens()` returns Anthropic's exact count where the provider offers one and the heuristic otherwise. Never gate a hard behaviour (like refusing to send) on a count that may be inexact — only use it for chunk sizing and cost display, and label displayed costs as estimates.

**Correcting the drift.** The heuristic above is fixed, but the error it makes is measurable: every provider returns a `usage` block, so the ratio of estimated to actual input tokens can be accumulated per model and folded back into the next estimate. That rolling correction factor is stored in the **`llm.tokenEstimateCalibration`** preference — a JSON object keyed by model ID, declared with its type, default and write cadence in `07-architecture-and-data-model.md` §8.5 — and applied by `src/llm/shared/tokenEstimate.ts` after `estimateTokens()` and before the 20% headroom. An absent or unparseable entry means "not calibrated yet" and the raw heuristic stands. `06-summarization-and-trend-report.md` §5.1 and `12-prompt-library.md` §11 are the two action items this closes; both previously said "in prefs" without naming a key.

---

## 11. Rate limits, errors, and retry

### 11.1 Anthropic

Limits are per-organization, per-model, by usage tier — RPM, ITPM (input tokens/min), OTPM (output tokens/min) ([rate limits](https://platform.claude.com/docs/en/api/rate-limits)):

| Tier | Model | RPM | ITPM | OTPM |
| --- | --- | --- | --- | --- |
| Start | `claude-opus-5` / `claude-sonnet-5` / `claude-haiku-4-5` | 1,000 | 2,000,000 | 400,000 |
| Build | same | 5,000 | 5,000,000 | 1,000,000 |
| Scale | same | 10,000 | 10,000,000 | 2,000,000 |
| Start | `claude-fable-5-1` (Fable 5.x share one bucket) | 1,000 | 500,000 | 100,000 |
| Build | same | 2,000 | 1,500,000 | 300,000 |
| Scale | same | 4,000 | 4,000,000 | 800,000 |

Even the Start tier is far above what this plugin will generate (100 sequential summarization calls ≈ 195,000 input tokens spread over minutes). **Rate limiting is not a realistic constraint for research_helper on Anthropic** unless the user is on the Evaluation tier (new accounts start below standard limits). Note the **Fable line is roughly 4× tighter** than the Opus/Sonnet line on every tier and is a shared bucket across Fable 5 and 5.1 — worth knowing because §12 lists `claude-fable-5-1`, but it is also the most expensive option here and should never be a default.

Useful response headers: `retry-after`, `anthropic-ratelimit-requests-remaining`, `anthropic-ratelimit-input-tokens-remaining`, `anthropic-ratelimit-tokens-reset` (RFC 3339). Read `retry-after` and honour it rather than guessing.

**Spend-cap 429 is not a rate limit.** When an org hits its monthly spend cap the API returns HTTP 429 with `error.type: "rate_limit_error"` **and no `retry-after` header**, distinguished by `error.details.error_code === "enforced_spend_limit_reached"`. Retrying is futile — it fails until the next month. The plugin must detect this and show a distinct, actionable message ("your Anthropic account has hit its monthly spend cap") rather than spinning in a retry loop.

### 11.2 OpenAI

Per-org RPM/TPM by tier, surfaced in `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens`. Tier-1 accounts (the likely case for an individual researcher who just added $5 of credit) have meaningfully low TPM on flagship models — **assume rate limiting will occur** and make concurrency configurable with a low default.

### 11.3 Gemini

Free tier and Tier 1–3, with limits published per-model in the [AI Studio rate-limit dashboard](https://aistudio.google.com/rate-limit) rather than as a static documentation table. In addition to RPM/TPM/RPD, Gemini enforces **spend-based limits on a rolling 10-minute window**: Tier 1 $10/10 min, Tier 2 $50/10 min, Tier 3 $200/10 min ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)). Exceeding these returns `429 RESOURCE_EXHAUSTED`.

**The free tier's RPD (requests per day) is the binding constraint for this plugin.** A 100-paper collection is 100+ requests; on a free-tier daily cap this can fail mid-run. The pipeline must be **resumable** — persist per-paper summaries as they complete so a rate-limited run picks up where it left off rather than restarting.

### 11.4 OpenRouter

Successful responses **do not include `X-RateLimit-*` headers**. On a 429 for platform limits, the response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. Poll `GET /api/v1/key` for proactive credit monitoring instead (§15.4).

### 11.5 Unified error taxonomy

Map every provider's failure into one of these, and drive retry from the category — never from string matching on the message.

| Category | Retryable | HTTP | OpenAI | Anthropic | Gemini | OpenRouter |
| --- | --- | --- | --- | --- | --- | --- |
| `auth` | No | 401 / 403 | `invalid_api_key` | `authentication_error` | `API_KEY_INVALID`, `PERMISSION_DENIED` | 401 |
| `bad_request` | No | 400 | `invalid_request_error` | `invalid_request_error` | `INVALID_ARGUMENT` | 400 |
| `context_length` | No (chunk instead) | 400 | `context_length_exceeded` | 400 w/ "prompt is too long" | `INVALID_ARGUMENT` w/ token count | 400 |
| `not_found` | No | 404 | `model_not_found` | `not_found_error` | `NOT_FOUND` | 404 |
| `rate_limit` | **Yes** | 429 | `rate_limit_exceeded` | `rate_limit_error` | `RESOURCE_EXHAUSTED` | 429 |
| `spend_cap` | **No** | 429 / 400 | quota exceeded | `error_code: enforced_spend_limit_reached` | quota exceeded | 402 insufficient credits |
| `overloaded` | **Yes** | 529 / 503 | 503 | `overloaded_error` (**529**) | `UNAVAILABLE` (503) | 502 / 503 |
| `server` | **Yes** | 5xx | `api_error` | `api_error` | `INTERNAL` | 5xx |
| `network` | **Yes** | — | timeout / DNS / TLS | same | same | same |
| `content_filter` | No | 200 or 400 | `finish_reason: content_filter` | `stop_reason: "refusal"` | `finishReason: SAFETY` / blocked | `finish_reason: content_filter` |

Three traps worth calling out:

1. **Anthropic overload is HTTP 529**, a non-standard code. Generic `status >= 500` retry logic misses it; generic `status === 503` logic misses it too. Handle 529 explicitly.
2. **Content filtering and refusals return HTTP 200 on every provider.** They must be detected by inspecting `stop_reason` / `finish_reason` / `finishReason`, not by status code. Retrying them is pointless.
3. **`spend_cap` looks exactly like `rate_limit`** (both 429) but is not retryable. Distinguish before retrying, or the plugin will hammer a dead account for minutes.

### 11.6 Retry policy

```ts
const RETRYABLE = new Set(['rate_limit', 'overloaded', 'server', 'network']);

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseMs?: number; capMs?: number } = {}
): Promise<T> {
  const { maxAttempts = 5, baseMs = 1000, capMs = 60_000 } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as LLMError;
      if (!RETRYABLE.has(e.category) || attempt >= maxAttempts - 1) throw e;

      // Honour a server-supplied retry-after over our own backoff.
      // NB: it lives on `opts`, not on the error itself (§14.1 `LLMError`).
      const serverDelay = e.opts.retryAfterSeconds != null
        ? e.opts.retryAfterSeconds * 1000
        : 0;

      // Exponential backoff with full jitter (AWS "Exponential Backoff and Jitter").
      const expo = Math.min(capMs, baseMs * 2 ** attempt);
      const jittered = Math.random() * expo;

      await sleep(Math.max(serverDelay, jittered));
    }
  }
}
```

Policy notes:

- **Full jitter, not "exponential + small random".** With a 100-paper batch and any concurrency, unjittered backoff synchronizes retries into a thundering herd against the same rate limit.
- **`retry-after` always wins** when present. Anthropic and OpenAI both send it; retrying earlier is guaranteed to fail.
- **Keep concurrency low and user-configurable.** Sequential is too slow for 100 papers; 20-way parallel guarantees 429s on any consumer tier. The `llm` worker pool's shipped size and its allowed range are owned by `07-architecture-and-data-model.md` §7.2 and the `concurrency` row of §8.5; do not restate a second figure here.
- **Persist partial progress.** After each successful per-paper summary, write it to the Zotero item (as a child note or an extra-field payload). A run interrupted at paper 73 must resume at 74.
- **Do not retry `context_length`.** Re-chunk and re-issue instead — a retry of the identical oversized request always fails.
- **Total wall-clock budget.** Cap the whole batch (e.g. 30 min) and surface a "N of 100 completed, retry the rest?" state rather than retrying indefinitely.

---

## 12. Cost estimation

### 12.1 Price table (verified 2026-09-08)

| Provider | Model | $/1M input | $/1M cached input | $/1M output |
| --- | --- | --- | --- | --- |
| OpenAI | `gpt-6-astra` | 10.00 | 1.00 | 50.00 |
| OpenAI | `gpt-5.6-sol` | 4.00 | 0.40 | 20.00 |
| OpenAI | `gpt-5.6-terra` | 2.00 | 0.20 | 12.00 |
| OpenAI | `gpt-5.6-luna` | 0.20 | 0.02 | 1.20 |
| Anthropic | `claude-fable-5-1` | 10.00 | 0.25 | 50.00 |
| Anthropic | `claude-opus-5` | 5.00 | 0.50 | 25.00 |
| Anthropic | `claude-sonnet-5` | 2.00 | 0.20 | 10.00 |
| Anthropic | `claude-haiku-4-5` | 1.00 | 0.10 | 5.00 |
| Google | `gemini-3.1-pro-preview` | 2.00² | 0.20 | 12.00² |
| Google | `gemini-3.5-flash` | 1.50 | 0.15 | 9.00 |
| Google | `gemini-3.8-flash` | 0.75¹ | 0.075 | 3.75¹ |
| Google | `gemini-3.5-flash-lite` | 0.30 | 0.03 | 2.50 |
| Google | `gemini-3.1-flash-lite` | 0.25 | 0.025 | 1.50 |

¹ Promotional through 31 December 2026; reverts to $1.50 / $7.50 on 1 January 2027.
² Prompts over 200,000 tokens are billed at $4.00 in / $18.00 out per 1M (§4.6 footnote 1).

**OpenRouter does not mark up per-token inference pricing.** Its FAQ states it plainly: "We never mark-up the pricing of the underlying providers, and you'll always pay the same as the provider's listed price." Revenue comes from a **5.5% fee ($0.80 minimum) on credit purchases** (5% for crypto), not from the per-token rate ([OpenRouter FAQ](https://openrouter.ai/docs/faq), checked 2026-09-08). The catalogue bears this out: `anthropic/claude-sonnet-5` is $2.00/$10.00 and `google/gemini-3.8-flash` is $0.75/$3.75 — identical to the native rates in the table above, and `openai/gpt-5.6-sol` is actually *cheaper* than OpenAI's own list price (§2.5).

So the OpenRouter surcharge is a **one-time ~5.5% on top-up**, not a per-call tax — which is small enough that it does not change any model recommendation in this document. Still read `pricing` from `GET /api/v1/models` for the authoritative OpenRouter-side number, and `usage.cost` from each response for the actual charge; a per-model difference in either direction is possible and the API is the only place it shows up.

**Batch/async pricing is 50% off** on all three native providers (`:batch` on OpenRouter, `/v1/batches` on OpenAI, `/v1/messages/batches` on Anthropic, Gemini Batch API). Since the summarization pass is not latency-sensitive — the user clicks "summarize collection" and goes to make coffee — **a batch mode is a legitimate 50% cost lever and should be a phase-2 feature.** The tradeoff is asynchronous polling and a job-state machine in the plugin.

### 12.2 Worked example: summarize 100 abstracts + write a trend report

**Assumptions** (stated so they can be re-derived):

| Quantity | Value |
| --- | --- |
| Abstract length | 250 words ≈ 350 tokens |
| Item metadata (title, authors, journal, year, DOI) | ≈ 60 tokens |
| Summarization system prompt (rubric + examples) | 1,500 tokens |
| Per-call user framing | ≈ 40 tokens |
| Structured summary output | ≈ 200 tokens |
| Trend-report system prompt | 800 tokens |
| Trend-report output | ≈ 2,500 tokens |
| Reasoning/thinking effort | `low` / `minimal` for summarization |

**Pass A — 100 individual summarization calls (no caching)**

- Input per call: 1,500 + 350 + 60 + 40 = **1,950 tokens** → ×100 = **195,000 input**
- Output per call: 200 → ×100 = **20,000 output**

**Pass B — trend report from the 100 summaries**

- Input: 800 + (100 × 200) = **20,800 tokens**
- Output: **2,500 tokens**

**Totals (no caching): 215,800 input / 22,500 output.**

| Model | Input cost | Output cost | **Total** |
| --- | --- | --- | --- |
| `gpt-6-astra` | $2.158 | $1.125 | **$3.28** |
| `claude-fable-5-1` | $2.158 | $1.125 | **$3.28** |
| `claude-opus-5` | $1.079 | $0.563 | **$1.64** |
| `gpt-5.6-sol` | $0.863 | $0.450 | **$1.31** |
| `gpt-5.6-terra` | $0.432 | $0.270 | **$0.70** |
| `gemini-3.1-pro-preview` | $0.432 | $0.270 | **$0.70** |
| `claude-sonnet-5` | $0.432 | $0.225 | **$0.66** |
| `gemini-3.5-flash` | $0.324 | $0.203 | **$0.53** |
| `claude-haiku-4-5` | $0.216 | $0.113 | **$0.33** |
| `gemini-3.8-flash` | $0.162 | $0.084 | **$0.25** |
| `gemini-3.5-flash-lite` | $0.065 | $0.056 | **$0.12** |
| `gemini-3.1-flash-lite` | $0.054 | $0.034 | **$0.09** |
| `gpt-5.6-luna` | $0.043 | $0.027 | **$0.07** |

**With prompt caching on the 1,500-token system prompt** (99 of 100 calls read from cache: 148,500 cached + 67,300 uncached input):

| Model | Uncached input | Cached input | Output | **Total** | Saving |
| --- | --- | --- | --- | --- | --- |
| `claude-sonnet-5` | $0.135 | $0.030 | $0.225 | **$0.39** | −41% |
| `gpt-5.6-terra` | $0.135 | $0.030 | $0.270 | **$0.43** | −38% |
| `gemini-3.8-flash` | $0.050 | $0.011 | $0.084 | **$0.15** | −41% |
| `gpt-6-astra` | $0.673 | $0.149 | $1.125 | **$1.95** | −41% |

**Caching is worth roughly 40% of total run cost.** It should not be an optional refinement — build the prefix-stable prompt layout in from the start (§8.3).

### 12.3 Cost surprises to guard against

1. **Reasoning tokens.** At `high`/`xhigh` effort, output tokens can be 3–5× the visible text. Running the summarization pass at default effort instead of `low` can triple the output bill. **Default summarization to the lowest effort each provider allows.**
2. **Long-context surcharge tiers.** `gpt-6-astra` doubles input price above 272,000 prompt tokens (from `pricing.overrides` in OpenRouter's catalogue). A "stuff all 100 abstracts into one call" design crosses this threshold and costs more than 100 small calls. Prefer per-paper calls.
3. **Full-text vs. abstracts.** Full text is the **default** under D7 (`summary.fullTextMode: auto`), so price for it rather than treating it as an exception. Per-paper input goes from ~350 tokens (abstract) to ~6,000–8,000 (a typical journal article), and [06-summarization-and-trend-report.md](06-summarization-and-trend-report.md) §5.4 — the authority on this number — gives the whole-run multiplier as **~8× for a typical journal-article corpus** that fits the single-shot budget, rising to **~32×** once papers are long enough to be chunked. The bare per-paper token ratio (~20×) is *not* the run multiplier, because the abstract-mode run also pays for clustering, reduction, report and critique calls that full-text mode does not multiply. Budget against ~32×. The mandatory pre-run cost estimate and the `summary.confirmAboveUSD` confirmation gate are the controls; see §12.3.
4. **Retries are billed.** A failed structured-output parse that triggers a retry doubles that call's cost. Validate cheaply and retry narrowly.

### 12.4 Cost estimator UI recommendation

Before any batch run, show: *"Summarize 100 items with `gemini-3.8-flash` — estimated ~216,000 input + ~23,000 output tokens, roughly **$0.25**. Actual cost may differ; reasoning tokens are not included in this estimate."* Then reconcile against summed `usage` after the run and display the actual. On OpenRouter, use `usage.cost` directly for an exact figure.

---

## 13. Embeddings

The "recommend papers based on an existing collection" feature (brief item 6) benefits from embeddings: embed each paper in the collection, average or cluster to a centroid, embed candidate papers, rank by cosine similarity. This gives semantically-grounded recommendation without an LLM call per candidate.

| Provider | Endpoint | Models | Dimensions | Price |
| --- | --- | --- | --- | --- |
| **OpenAI** | `POST /v1/embeddings` | `text-embedding-3-small`, `text-embedding-3-large`, `text-embedding-ada-002` | 1,536 / 3,072 (both truncatable via `dimensions`) | $0.02 / $0.13 / $0.10 per 1M |
| **Google** | `POST /v1beta/models/{m}:embedContent`, `:batchEmbedContents` | `gemini-embedding-2` (multimodal, recommended), `gemini-embedding-001` (text, legacy) | 128–3,072; recommended 768 / 1,536 / 3,072 | See [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing); Batch API is 50% off |
| **OpenRouter** | — | > **Unverified:** OpenRouter's coverage of embedding endpoints. Its catalogue is chat-oriented; do not assume `/embeddings` passthrough without testing. | — | — |
| **Anthropic** | **none** | — | — | **Anthropic has no embeddings endpoint at all.** |

### 13.1 Gemini embeddings request/response

```json
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent
x-goog-api-key: AIza...

{
  "model": "models/gemini-embedding-2",
  "content": { "parts": [{ "text": "Deep learning for protein structure prediction ..." }] }
}
```

```json
{ "embeddings": [ { "values": [0.0123, -0.0456, 0.0789, "..."] } ] }
```

`gemini-embedding-001` supports a `task_type` parameter (`RETRIEVAL_DOCUMENT`, `RETRIEVAL_QUERY`, `SEMANTIC_SIMILARITY`, `CLUSTERING`, `CLASSIFICATION`, `QUESTION_ANSWERING`, `FACT_VERIFICATION`, `CODE_RETRIEVAL_QUERY`). **`gemini-embedding-2` does not** — you instead prefix the text with a task instruction (e.g. `"task: search result | query: {content}"`). Getting this wrong degrades retrieval quality silently.

### 13.2 Design consequence

**The embedding provider must be selectable independently of the chat provider**, because an Anthropic-only user has no embedding option. Three ways to handle it:

1. Let the user configure an embedding provider separately (OpenAI or Gemini), defaulting to whichever key they already have.
2. Fall back to **lexical similarity** (TF-IDF / BM25 over titles + abstracts, computed entirely in-plugin with no API calls) when no embedding provider is configured. This is free, offline, and surprisingly competitive for same-field paper recommendation. **Recommended as the default.**
3. Fall back to an **LLM-as-ranker**: send candidate titles/abstracts plus the collection profile to the chat model and ask for a ranking. Works with any provider including Anthropic, but costs a real API call per batch of candidates.

**Recommendation:** ship (2) as the zero-config default, offer (1) as an opt-in quality upgrade, and use (3) only as a final re-ranking pass over the top ~20 lexical candidates. This keeps the recommendation feature functional for every provider combination including Anthropic-only.

---

## 14. Unified adapter design

### 14.1 Core interface

> **Authority note.** `07-architecture-and-data-model.md` §4.3 owns the *shipped* `LLMProvider`
> contract — the member names and signatures that `src/llm/types.ts` actually declares
> (`chat`/`chatStream`, `validateCredentials`, `getModel`, `countTokens(text, modelId)`,
> `LLMCallContext`, `BudgetGuard`), and `ModelInfo` with `contextWindowTokens` /
> `inputCostPerMTokUsd` / `outputCostPerMTokUsd` / `supportsJsonSchema`. The sketch below predates
> that consolidation and uses shorter working names (`complete`/`stream`, `validateKey`,
> `contextWindow`, `pricing`, `supportsJSONSchema`). Read it for **what each provider must be able
> to do and how the four differ**; take the exact names from doc 07 §4.3 when writing code. Where
> the two disagree, doc 07 wins.
>
> **The same applies to `LLMError` below, and more sharply.** `07-architecture-and-data-model.md`
> §10.1 owns the shipped error hierarchy: `LLMError` there is a *base class* whose constructor is
> `(providerId, modelId, message, ctx?)`, with `ContextLengthExceededError`, `ContentFilterError`
> and `StructuredOutputError` extending it, and with `AuthenticationError`, `RateLimitError`,
> `QuotaExceededError`, `UpstreamServerError`, `BadRequestError`, `NetworkError` and `TimeoutError`
> as siblings under `ResearchHelperError`. The single flat `LLMError(category, message, opts)`
> sketched below is a **working name for that whole family**, not a second design, and its
> `ErrorCategory` union is §11.5's taxonomy — the thing the adapters normalize onto. Map it as:
>
> | `ErrorCategory` (§11.5) | Shipped class (doc 07 §10.1) |
> | --- | --- |
> | `auth` | `AuthenticationError` (401) / `AuthorizationError` (403) |
> | `bad_request`, `not_found` | `BadRequestError` |
> | `context_length` | `ContextLengthExceededError` |
> | `rate_limit` | `RateLimitError` |
> | `spend_cap` | `QuotaExceededError` |
> | `overloaded`, `server` | `UpstreamServerError` |
> | `network` | `NetworkError`, or `TimeoutError` on a timeout |
> | `content_filter` | `ContentFilterError` |
> | `schema_violation` | `StructuredOutputError` |
> | `unknown` | `LLMError` itself |
>
> `retryable` is a property of the shipped class. §11.6's `RETRYABLE` set — `rate_limit`,
> `overloaded`, `server`, `network` — is exactly the set of categories whose class carries
> `retryable = true` *and* is retried by the generic transport loop. `StructuredOutputError` is
> also `retryable = true` but is deliberately **not** in that set: its retry is the one-shot repair
> prompt in `12-prompt-library.md` §18.3, which is a different mechanism at a different layer, and
> putting it in the transport loop would re-send the same malformed request. Do not write a second
> error class; construct doc 07's.

```ts
// ── Model metadata ───────────────────────────────────────────────────────────

export interface ModelInfo {
  /** Provider-native model ID, e.g. "claude-sonnet-5", "openai/gpt-5.6-terra". */
  id: string;
  /** Human label for the picker. */
  displayName: string;
  /** Max input tokens the model accepts. */
  contextWindow: number;
  /** Max tokens the model will emit in one response. */
  maxOutputTokens: number;
  /** Whether this model+endpoint supports strict JSON-schema-constrained output. */
  supportsJSONSchema: boolean;
  supportsStreaming: boolean;
  /** Reasoning/effort levels, if the model exposes them. */
  supportedEfforts?: Effort[];
  /** USD per 1,000,000 tokens. Undefined when the provider does not publish it. */
  pricing?: {
    inputPer1M: number;
    outputPer1M: number;
    cachedInputPer1M?: number;
  };
}

export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// ── Normalized request / response ────────────────────────────────────────────

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  /** Sent as a top-level system field where the provider has one. */
  system?: string;
  messages: LLMMessage[];
  maxOutputTokens: number;
  temperature?: number;
  /** JSON Schema (draft 2020-12 subset). Adapter translates per provider. */
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
  effort?: Effort;
  /** Mark the system prompt as a cache breakpoint where supported. */
  cacheSystemPrompt?: boolean;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  /** Reasoning/thinking tokens, where reported separately. */
  reasoningTokens?: number;
  /** Actual USD cost, only where the provider reports it (OpenRouter). */
  costUSD?: number;
}

export type StopReason =
  | 'stop'            // natural end
  | 'max_tokens'      // hit the output cap — output is truncated
  | 'refusal'         // model declined
  | 'content_filter'  // provider safety system blocked it
  | 'tool_use'
  | 'error';

export interface CompletionResponse {
  text: string;
  /** Present and validated when `jsonSchema` was requested. */
  parsed?: unknown;
  stopReason: StopReason;
  usage: TokenUsage;
  model: string;
  /** Provider-native response, for debugging. Never rely on its shape. */
  raw: unknown;
}

export interface StreamEvent {
  type: 'text_delta' | 'done' | 'error';
  text?: string;
  usage?: TokenUsage;
  stopReason?: StopReason;
  error?: LLMError;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export type ErrorCategory =
  | 'auth' | 'bad_request' | 'context_length' | 'not_found'
  | 'rate_limit' | 'spend_cap' | 'overloaded' | 'server'
  | 'network' | 'content_filter' | 'schema_violation' | 'unknown';

export class LLMError extends Error {
  constructor(
    public readonly category: ErrorCategory,
    message: string,
    public readonly opts: {
      provider: string;
      httpStatus?: number;
      providerCode?: string;
      retryAfterSeconds?: number;
      /** Actionable, user-facing text — shown in the Zotero UI verbatim. */
      userMessage?: string;
      cause?: unknown;
    }
  ) { super(message); this.name = 'LLMError'; }

  get retryable(): boolean {
    return ['rate_limit', 'overloaded', 'server', 'network'].includes(this.category);
  }
}

// ── The provider contract ────────────────────────────────────────────────────

export interface LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'gemini' | 'openrouter';
  readonly displayName: string;

  /** True if a usable API key is configured. */
  isConfigured(): boolean;

  /** Cheap round-trip to validate the key. Used by the prefs pane. */
  validateKey(): Promise<{ ok: true } | { ok: false; error: LLMError }>;

  /** Live catalogue, TTL-cached by the caller. */
  listModels(): Promise<ModelInfo[]>;

  /** Single-shot completion. */
  complete(req: CompletionRequest): Promise<CompletionResponse>;

  /** Incremental completion. */
  stream(req: CompletionRequest): AsyncIterable<StreamEvent>;

  /**
   * Token count for a request. `exact` is true only where the provider offers
   * a server-side counting endpoint (currently Anthropic, and Gemini's legacy
   * :countTokens). Never gate hard behaviour on an inexact count.
   */
  countTokens(req: CompletionRequest): Promise<{ tokens: number; exact: boolean }>;

  /** Static capability flags, resolved per model where possible. */
  supportsJSONSchema(modelId: string): boolean;
  contextWindow(modelId: string): number;
}
```

### 14.2 Per-provider adapter sketches

Only the parts that actually differ are shown.

**OpenAI (Responses API)**

```ts
class OpenAIProvider implements LLMProvider {
  readonly id = 'openai' as const;

  private body(req: CompletionRequest) {
    const input = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages,
    ];
    return {
      model: req.model,
      input,
      max_output_tokens: req.maxOutputTokens,
      ...(req.temperature != null && { temperature: req.temperature }),
      // Must be mapped, never passed through: the shared Effort union carries
      // 'none' and 'minimal' for the Gemini path, and the Responses API 400s
      // on both — its scale starts at 'low' (§2.5).
      ...(req.effort && { reasoning: { effort: mapEffortToFiveLevel(req.effort) } }),
      ...(req.jsonSchema && {
        text: {
          format: {
            type: 'json_schema',
            name: req.jsonSchema.name,
            strict: req.jsonSchema.strict ?? true,
            schema: req.jsonSchema.schema,
          },
        },
      }),
    };
  }

  private normalize(raw: any): CompletionResponse {
    const msg = raw.output?.find((o: any) => o.type === 'message');
    const text = (msg?.content ?? [])
      .filter((c: any) => c.type === 'output_text')
      .map((c: any) => c.text)
      .join('');
    return {
      text,
      stopReason:
        raw.status === 'incomplete' &&
        raw.incomplete_details?.reason === 'max_output_tokens'
          ? 'max_tokens'
          : 'stop',
      usage: {
        inputTokens: raw.usage?.input_tokens ?? 0,
        outputTokens: raw.usage?.output_tokens ?? 0,
        cachedInputTokens: raw.usage?.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
        reasoningTokens: raw.usage?.output_tokens_details?.reasoning_tokens,
      },
      model: raw.model,
      raw,
    };
  }
  // countTokens → heuristic (exact: false); OpenAI has no counting endpoint.
}

/**
 * OpenAI's `reasoning.effort` and Anthropic's `output_config.effort` share the
 * same 5-level scale; neither has 'none' or 'minimal'. Used by both adapters.
 */
function mapEffortToFiveLevel(
  e: Effort,
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  return e === 'none' || e === 'minimal' ? 'low' : e;
}
```

**Anthropic**

```ts
class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const;

  private headers() {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  private body(req: CompletionRequest) {
    // Cache breakpoint on the system prompt: prefix-stable content first.
    const system = req.system
      ? req.cacheSystemPrompt
        ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }]
        : req.system
      : undefined;

    return {
      model: req.model,
      max_tokens: req.maxOutputTokens,          // REQUIRED on Anthropic
      ...(system && { system }),
      messages: req.messages,
      // Same mapping rule as OpenAI: Anthropic's scale is low…max, so
      // 'none'/'minimal' must be folded to 'low' rather than sent.
      ...(req.effort && { output_config: { effort: mapEffortToFiveLevel(req.effort) } }),
      ...(req.jsonSchema && {
        output_config: {
          ...(req.effort ? { effort: mapEffortToFiveLevel(req.effort) } : {}),
          format: { type: 'json_schema', schema: req.jsonSchema.schema },
        },
      }),
    };
  }

  private normalize(raw: any): CompletionResponse {
    // stop_reason MUST be checked before reading content (refusals emit none).
    const text = (raw.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    const map: Record<string, StopReason> = {
      end_turn: 'stop', max_tokens: 'max_tokens',
      refusal: 'refusal', tool_use: 'tool_use', stop_sequence: 'stop',
    };
    return {
      text,
      stopReason: map[raw.stop_reason] ?? 'stop',
      usage: {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        cachedInputTokens: raw.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: raw.usage.cache_creation_input_tokens ?? 0,
      },
      model: raw.model,
      raw,
    };
  }

  // The only exact counter of the four.
  async countTokens(req: CompletionRequest) {
    const r = await this.post('/v1/messages/count_tokens', {
      model: req.model,
      system: req.system,
      messages: req.messages,
    });
    return { tokens: r.input_tokens as number, exact: true };
  }
}
```

**Gemini (Interactions API)**

```ts
class GeminiProvider implements LLMProvider {
  readonly id = 'gemini' as const;

  private body(req: CompletionRequest) {
    return {
      model: req.model,
      ...(req.system && { system_instruction: req.system }),
      input: req.messages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
      generation_config: {
        max_output_tokens: req.maxOutputTokens,
        ...(req.effort && { thinking_level: mapEffortToThinkingLevel(req.effort) }),
      },
      ...(req.jsonSchema && {
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: req.jsonSchema.schema,   // lowercase JSON Schema types
        },
      }),
    };
  }

  private normalize(raw: any): CompletionResponse {
    const out = (raw.steps ?? []).filter((s: any) => s.type === 'model_output');
    const text = out
      .flatMap((s: any) => s.content ?? [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
    return {
      text,
      stopReason: raw.status === 'completed' ? 'stop'
                : raw.status === 'incomplete' ? 'max_tokens'
                : 'error',
      usage: {
        inputTokens: raw.usage?.total_input_tokens ?? 0,
        outputTokens: raw.usage?.total_output_tokens ?? 0,
        cachedInputTokens: raw.usage?.total_cached_tokens ?? 0,
        cacheWriteTokens: 0,
        reasoningTokens: raw.usage?.total_thought_tokens,
      },
      model: raw.model,
      raw,
    };
  }
}

// Gemini has 4 thinking levels, not 6 efforts.
function mapEffortToThinkingLevel(e: Effort): 'minimal' | 'low' | 'medium' | 'high' {
  switch (e) {
    case 'none': case 'minimal': return 'minimal';
    case 'low':                  return 'low';
    case 'medium':               return 'medium';
    default:                     return 'high';   // high | xhigh | max
  }
}
```

**OpenRouter**

```ts
class OpenRouterProvider implements LLMProvider {
  readonly id = 'openrouter' as const;

  private headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/suppakoko/research_helper',
      // Send both until the header name is settled (see §5.2).
      'X-Title': 'research_helper',
      'X-OpenRouter-Title': 'research_helper',
    };
  }

  private body(req: CompletionRequest) {
    return {
      model: req.model,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        ...req.messages,
      ],
      max_tokens: req.maxOutputTokens,
      ...(req.effort && { reasoning: { effort: req.effort } }),
      ...(req.jsonSchema && {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: req.jsonSchema.name,
            strict: req.jsonSchema.strict ?? true,
            schema: req.jsonSchema.schema,
          },
        },
      }),
      provider: {
        // CRITICAL when jsonSchema is set — otherwise a non-supporting
        // endpoint silently ignores response_format and returns prose.
        ...(req.jsonSchema && { require_parameters: true }),
        data_collection: 'deny',
      },
    };
  }
  // usage.cost gives exact USD — the only provider that does.
}
```

### 14.3 Normalization layer — the five things that must be normalized

| Concern | Divergence | Normalization rule |
| --- | --- | --- |
| **System prompt** | OpenAI: a message with `role: "system"`. Anthropic: top-level `system` (string or block array). Gemini: `system_instruction`. | `CompletionRequest.system` is always a plain string; each adapter places it. |
| **Max output** | `max_output_tokens` / `max_tokens` (**required**) / `generation_config.max_output_tokens` / `max_tokens`. | `maxOutputTokens` is **required** in `CompletionRequest` so the Anthropic path can never omit it. Clamp to `ModelInfo.maxOutputTokens`. |
| **Text extraction** | `output[].content[].text` (filter `message`/`output_text`) / `content[].text` (filter `text`) / `steps[].content[].text` (filter `model_output`) / `choices[0].message.content`. | Every adapter returns a flat `text` string. Never leak block arrays upward. |
| **Usage** | `input_tokens`/`output_tokens` / `input_tokens` + `cache_*` (must be summed) / `total_input_tokens`/`total_output_tokens` / `prompt_tokens`/`completion_tokens`. | Single `TokenUsage`. Anthropic's adapter must **not** present `input_tokens` as total input. |
| **Stop reason** | `status` + `incomplete_details` / `stop_reason` (incl. HTTP-200 `refusal`) / `status` / `finish_reason`. | Single `StopReason` enum. Truncation and refusal must both be visible to the caller. |

Two more that are easy to forget:

- **Effort scales differ.** OpenAI has 5 (`low`…`max`), Anthropic has 5 (`low`…`max`), Gemini has 4 thinking levels (`minimal`…`high`). The shared `Effort` union in §14.1 is the *superset* — it carries `none`/`minimal` only so the Gemini path has somewhere to land. Map through a function in **every** adapter; do not pass the string through blind, or Gemini will 400 on `xhigh` and OpenAI/Anthropic will 400 on `none`/`minimal`.
- **JSON Schema dialects differ.** The Gemini *legacy* path needs uppercase OpenAPI types. If the legacy path is implemented, the adapter owns a `toOpenApiSchema()` translation.

### 14.4 Transport layer

Isolate every HTTP call behind one function so the `Zotero.HTTP` vs `fetch` question (§1.1) is answered in exactly one place:

```ts
export interface HttpResponse { status: number; headers: Headers; text: string; }

export async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<HttpResponse> {
  // Zotero.HTTP.request is the privileged, always-available path.
  // Swap to fetch() here (and only here) if streaming is required.
  const xhr = await Zotero.HTTP.request('POST', url, {
    headers,
    body: JSON.stringify(body),
    responseType: 'text',
    // Never throw on non-2xx: we want the error body for the taxonomy mapping.
    successCodes: false,
    timeout: 120_000,
  });
  return {
    status: xhr.status,
    headers: parseHeaders(xhr.getAllResponseHeaders?.()),
    text: xhr.responseText,
  };
}

/**
 * `getAllResponseHeaders()` returns a raw CRLF-delimited *string*, not a
 * `Headers`. Assigning it straight to `HttpResponse.headers` type-checks under
 * `any` and then fails at runtime the first time the retry logic asks for
 * `retry-after` (§11.6) — which is exactly the path that only runs under load.
 */
function parseHeaders(raw?: string): Headers {
  const h = new Headers();
  for (const line of (raw ?? '').trim().split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) h.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return h;
}
```

Non-2xx must **not** throw at the transport level — the response body carries the provider's error type string, which the taxonomy mapper needs.

**Base URLs are resolved here, not hardcoded in the adapters.** Each adapter asks for its base URL and gets `<provider>.baseUrl` when that preference is non-empty, and the base URL documented in this document otherwise — §2.1 (OpenAI), §3.1 (Anthropic), §4.1 (Gemini), §5.1 (OpenRouter). The preference exists because `10-requirements-and-user-stories.md` FR-29 requires a per-provider override in the preferences pane, for users behind a corporate gateway or an API-compatible proxy; its key, type, default and allowed values are `07-architecture-and-data-model.md` §8.5's, and the control is in `08-ui-ux-spec.md` §7.3's per-provider block. Two rules apply to an overridden base URL: it must be `https://`, and the plugin **must not** send a key to a host the user has not explicitly configured — so the value is validated at write time and the pre-flight egress dialog (`09-security-privacy-and-api-keys.md` §3.6) names the *effective* host, not the provider's default one. The override carries no credential of its own; a proxy requiring separate authentication is out of scope.

### 14.5 Structured-output validation wrapper

Because OpenRouter can silently degrade and any provider can occasionally emit malformed JSON, wrap every schema-constrained call:

```ts
async function completeJSON<T>(
  provider: LLMProvider,
  req: CompletionRequest,
  validate: (v: unknown) => v is T,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await provider.complete(req);

    if (res.stopReason === 'max_tokens') {
      throw new LLMError('bad_request', 'Output truncated before JSON completed', {
        provider: provider.id,
        userMessage: 'The summary was cut off. Try increasing the output token limit.',
      });
    }

    // A refusal or content-filter stop returns HTTP 200 with empty or
    // non-JSON content (§3.4, §11.5). Retrying it is pointless, and the
    // correction turn below would append an empty assistant message, which
    // Anthropic rejects with a 400. Fail here instead.
    if (res.stopReason === 'refusal' || res.stopReason === 'content_filter') {
      throw new LLMError('content_filter', `Model declined: ${res.stopReason}`, {
        provider: provider.id,
        userMessage: 'The model declined to summarize this item. Skipping it.',
      });
    }

    try {
      const parsed = JSON.parse(stripCodeFence(res.text));
      if (validate(parsed)) return parsed;
    } catch { /* fall through to retry */ }

    // Retry once with an explicit correction turn.
    req = {
      ...req,
      messages: [
        ...req.messages,
        { role: 'assistant', content: res.text },
        { role: 'user', content: 'That was not valid JSON matching the schema. Reply with only the JSON object.' },
      ],
    };
  }
  throw new LLMError('schema_violation', 'Model did not produce schema-valid JSON', {
    provider: provider.id,
    userMessage: 'The model returned an unexpected format. Try a different model.',
  });
}

/** Models occasionally wrap JSON in ```json fences despite schema constraints. */
function stripCodeFence(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : s.trim();
}
```

---

## 15. OpenRouter as universal fallback

### 15.1 The case for it

OpenRouter's `POST /api/v1/chat/completions` is OpenAI-Chat-Completions-shaped, so **one adapter reaches the whole catalogue** — 426 models on 2026-09-08 — across every major lab. For `research_helper` this means:

- A user with a single OpenRouter key can use Claude, GPT, and Gemini without three signups. For a researcher who wants to try the plugin, this is a materially lower barrier than obtaining three separate API keys.
- New models appear in the picker with **zero plugin changes** — the catalogue endpoint is the source of truth.
- `usage.cost` gives exact per-call USD, which is the only clean way to build a running-spend display.
- `models: [...]` array and `provider.order` give automatic failover across upstream providers when one is down, which the native adapters cannot do.

### 15.2 The case against it as the *only* path

- **A 5.5% credit-purchase fee** ($0.80 minimum). Note this is *not* a per-token markup — inference is passed through at the provider's listed price (§12.1) — so it is a one-time cost on top-up, not a recurring tax on every call. It is the weakest of the arguments below.
- **Structured outputs degrade silently** without `require_parameters: true` (§7.4). This is the sharpest edge.
- **Provider-specific features are lost or lag.** Anthropic's `output_config.effort`, cache breakpoints, and `thinking.display`; Gemini's `thinking_level` and `response_format` audio; OpenAI's `text.format` — these are exposed unevenly and behind OpenRouter's own normalization.
- **A third party sees every request.** For a research tool handling unpublished work, this is a genuine privacy consideration. Mitigate with `provider.data_collection: "deny"`, and say so in the plugin's privacy note.
- **Extra hop** adds latency and one more thing that can be down.
- **Model IDs are different** (`anthropic/claude-sonnet-5` vs `claude-sonnet-5`), so any saved preference must record the provider alongside the model.

### 15.3 Provider preferences worth setting

```json
{
  "provider": {
    "require_parameters": true,
    "data_collection": "deny",
    "sort": "price",
    "allow_fallbacks": true,
    "order": ["anthropic", "openai", "google-ai-studio"]
  }
}
```

| Field | Recommended | Why |
| --- | --- | --- |
| `require_parameters` | `true` **whenever `response_format` is sent** | Prevents silent structured-output degradation. The single most important setting. |
| `data_collection` | `"deny"` | Excludes providers that may store or train on the content. Appropriate for unpublished research. |
| `sort` | `"price"` (default), user-overridable to `"throughput"` | Batch summarization is cost-sensitive, not latency-sensitive. |
| `allow_fallbacks` | `true` | Resilience. Set `false` only if the user pins a specific provider. |
| `order` | optional | Pin preferred upstreams. |
| `only` / `ignore` | optional | Hard allow/deny lists by provider slug. |

Model-level fallback (distinct from provider-level) uses a `models` array — OpenRouter tries each in priority order if the preceding one errors:

```json
{ "model": "google/gemini-3.8-flash", "models": ["anthropic/claude-haiku-4.5", "openai/gpt-5.6-luna"] }
```

Variant shortcuts: `:nitro` (throughput-sorted, priority tier — a superset of `provider.sort: "throughput"`) and `:floor` (price-sorted, flex tier). **Avoid auto-updating aliases like `~openai/gpt-latest` as a plugin default** — they change cost and behaviour without warning.

### 15.4 Credits and limits

```
GET https://openrouter.ai/api/v1/key
Authorization: Bearer sk-or-v1-...
```

Returns `label`, `limit` (credit cap, `null` = unlimited), `limit_reset`, `limit_remaining`, `usage` (all-time), `usage_daily` / `usage_weekly` / `usage_monthly`, `byok_usage` (+ periodic variants), and `is_free_tier`.

Use this to:
- **Pre-flight a batch:** if `limit_remaining` is less than the estimated cost, warn before starting a 100-paper run rather than failing at paper 60.
- **Show remaining credit** in the prefs pane.
- **Validate a key** cheaply — this endpoint doubles as `validateKey()`.

Rate-limit headers appear only on 429 responses (`X-RateLimit-Limit`, `-Remaining`, `-Reset`); successful responses carry none, so polling `/key` is the only proactive signal.

### 15.5 Recommended posture

**Implement all four adapters, and make OpenRouter the recommended onboarding path.** Concretely:

1. In first-run setup, present OpenRouter first, framed as "one key, all models."
2. Offer native OpenAI / Anthropic / Gemini keys as "already have a key? use it directly — full feature access, and no credit-purchase fee." Do **not** say "cheaper per token": inference is passed through at the provider's listed price (§12.1), and the only difference is OpenRouter's 5.5% top-up fee.
3. When a native call fails with `overloaded` or `server` **and** the user also has an OpenRouter key configured, offer a one-click retry through OpenRouter with the equivalent slug. Do this as an explicit prompt, not silently — a silent provider switch changes cost and data handling and the user should decide.

---

## 16. Provider default decision table

| Criterion | OpenAI | Anthropic | Gemini | OpenRouter |
| --- | --- | --- | --- | --- |
| Free tier for evaluation | No | No | **Yes** | Limited free models |
| Cheapest capable model for 100 abstracts | $0.07 (`luna`) | $0.33 (`haiku-4-5`) | **$0.09–$0.25** | varies |
| Context window | 1.05M | 1M | 1.05M | varies |
| Max output tokens | 128K | 128K | 65K | varies |
| Structured outputs | **Strong** | **Strong** | **Strong** | Conditional |
| Exact token counting | No | **Yes** | Legacy endpoint | No |
| Prompt caching | Automatic | Explicit, most controllable | Implicit + explicit | Passthrough |
| Embeddings | **Yes** | **No** | **Yes** | Unverified |
| Machine-readable pricing | No | No | No | **Yes** |
| Exact per-call cost in response | No | No | No | **Yes** (`usage.cost`) |
| Single key reaches all labs | No | No | No | **Yes** |
| Number of accounts a user must create | 1 | 1 | 1 | **1 (for all)** |

### Recommended defaults

| Situation | Default |
| --- | --- |
| **First run, no keys configured** | Prompt for **OpenRouter** (project default, decided 2026-09-08) — one key reaches every model, and its public price catalogue makes the cost estimate accurate. Present Gemini as the "evaluate at zero cost" alternative, with the non-suppressible free-tier training warning attached (see §4 and `09`). |
| **Bulk summarization (100+ abstracts)** | `gemini-3.8-flash` at `thinking_level: "minimal"`. Best cost-per-quality in the table (~$0.25/100 papers, ~$0.15 with caching) with a 1M context. Alternates: `gpt-5.6-luna` (cheapest at ~$0.07) or `claude-haiku-4-5` (~$0.33). **These are model choices, not provider choices** — on the default OpenRouter path the slug is `google/gemini-3.8-flash` (§9.4); the bare native ID applies only when the user has explicitly picked Gemini as their provider. |
| **Trend-report synthesis** (one call, quality matters) | `claude-sonnet-5` or `gpt-5.6-terra` at `medium` effort. This is a single call over ~21K tokens — a few cents — so spend for quality here (§12.2 Pass B: 20,800 in / 2,500 out ⇒ `claude-sonnet-5` $0.042 + $0.025 = **$0.067**; `gpt-5.6-terra` $0.042 + $0.030 = **$0.072**). Frontier models are defensible and still under $0.35 for this one call: `claude-opus-5` $0.104 + $0.063 = **$0.17**, `gpt-6-astra` $0.208 + $0.125 = **$0.33**. |
| **Audio-script rewriting** (doc `04`) | Same model as the trend report; it is one more short call. |
| **Embeddings for recommendation** | `gemini-embedding-2` if a Gemini key exists, else `text-embedding-3-small`, else in-plugin BM25 (§13.2). |
| **User has only an Anthropic key** | `claude-haiku-4-5` for summarization, `claude-sonnet-5` for the report; disable embedding-based recommendation and fall back to BM25 + LLM re-rank. |
| **Fallback when the chosen provider errors** | OpenRouter with the equivalent slug, offered as an explicit prompt. |

**Two-model split is the design to build.** Use a cheap model for the N-way summarization pass and a stronger model for the single synthesis call. The summarization pass is **~90% of the tokens** (§12.2: Pass A 195,000 + 20,000 = 215,000 of 238,300 total = 90.2%) **and ~90% of the cost** (on `gemini-3.8-flash`, $0.221 of $0.246; on `claude-sonnet-5`, $0.59 of $0.657); the synthesis call is where quality is visible to the user. Expose these as two separate prefs (`summaryModel`, `reportModel`) with sensible linked defaults, not one global model setting. Both ship empty, meaning "use `<provider>.model`"; keys, types and defaults are `07-architecture-and-data-model.md` §8.5's.

**Two, not three.** `07-architecture-and-data-model.md` §8.5 also carries a `screening.model` key, and it is **not** a third tier: it ships empty and falls back to `summaryModel`, existing only so a user can point the one highest-volume call — `RELEVANCE_SCREEN` in `12-prompt-library.md` §3, which owns that fallback — at something cheaper still. Left alone it changes nothing, and `12-prompt-library.md` §18.5's three prompt tiers map onto these same two settings.

---

## Sources

All URLs verified 2026-09-08.

**OpenAI**
- [Pricing](https://developers.openai.com/api/docs/pricing)
- [Models](https://developers.openai.com/api/docs/models)
- [gpt-5.6-sol model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [Responses API reference](https://developers.openai.com/api/docs/api-reference/responses)
- [Streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)
- [Introducing GPT-5.6](https://openai.com/index/gpt-5-6/)

**Anthropic**
- Bundled `claude-api` skill reference (model table cached 2026-06-24) — authoritative for model IDs, pricing, thinking/effort semantics, and structured-output parameter names
- [Rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- [Streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Claude's API now supports CORS requests](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/) — origin of `anthropic-dangerous-direct-browser-access`

**Google Gemini**
- [Models](https://ai.google.dev/gemini-api/docs/models)
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Interactions API reference](https://ai.google.dev/api/interactions-api)
- [Interactions API breaking changes (May 2026)](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026)
- [generateContent reference (legacy)](https://ai.google.dev/api/generate-content)
- [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Interactions API GA announcement](https://blog.google/innovation-and-ai/technology/developers-tools/interactions-api-general-availability/)

**OpenRouter**
- [Quickstart](https://openrouter.ai/docs/quickstart)
- [API reference overview](https://openrouter.ai/docs/api-reference/overview)
- [Chat completion reference](https://openrouter.ai/docs/api-reference/chat-completion)
- [Provider routing](https://openrouter.ai/docs/features/provider-routing)
- [Structured outputs](https://openrouter.ai/docs/features/structured-outputs)
- [Limits / key endpoint](https://openrouter.ai/docs/api-reference/limits)
- [FAQ](https://openrouter.ai/docs/faq) — no per-token markup; 5.5% credit-purchase fee
- Live model catalogue: `GET https://openrouter.ai/api/v1/models` (426 models, fetched 2026-09-08)

**Zotero**
- [Zotero 7 for developers](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [Zotero JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api)
