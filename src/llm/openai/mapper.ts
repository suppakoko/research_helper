/**
 * OpenAI Responses API: the wire shapes, as pure functions.
 *
 * **Scope.** `P3-T08` steps 1–6, the parts that need no network: build the
 * `POST /v1/responses` body from `docs/07` §4.3's `ChatRequest`, read the
 * answer back into a `ChatResponse`, map the shared effort scale onto
 * OpenAI's, and filter `GET /v1/models`. The adapter that sends them is
 * `./openAiProvider.ts`; nothing here sends a request, reads a key or retries.
 *
 * **Authority.** The shapes are `docs/03-llm-provider-integration.md`'s: §2.3
 * (request), §2.4 (response and its two parsing traps), §2.5 (the effort
 * scale), §2.6 (reasoning tokens are output), §7.1 and §7.5 (structured output
 * lives at `text.format`), §9.1 (the model list) and §14.2–§14.3 (the adapter
 * sketch and the five normalizations). The types are `docs/07` §4.3's, which
 * win over `docs/03` §14.1's working names (`plan/README.md` §5 rule 3).
 *
 * **What is not sent, and why.** `ChatRequest.topP`, `.stop` and `.seed` have
 * no Responses-API field in `docs/03` (§2.3, §7.1 and the §14.2 sketch name
 * `model`, `input`, `max_output_tokens`, `temperature`, `reasoning` and
 * `text` only), so they are dropped rather than guessed. `.routing` is
 * OpenRouter's (§4.3: "other providers ignore unknown keys") and `.traceId` is
 * "never sent upstream". `responseFormat: { kind: "json" }` has no documented
 * Responses shape either; it sends no `text.format`, and `P3-T12` owns the
 * prompt coercion §4.3 promises for it.
 */

import { type FiveLevelEffort, toFiveLevelEffort } from "../shared/effort";
import type {
  ChatRequest,
  ChatResponse,
  ModelDataPolicy,
  ModelInfo,
  Usage,
} from "../types";

// ---------------------------------------------------------------------------
// 1. Effort
// ---------------------------------------------------------------------------
//
// `ChatRequest.effort` (`docs/07` §4.3, owner, 2026-10-21, `plan/00` §6 item
// 262(a)) is sent as `reasoning.effort`, folded onto OpenAI's five levels by
// `toFiveLevelEffort` in `../shared/effort.ts`: `none` and `minimal` become
// `low`, because the Responses API rejects both (`docs/03` §2.5, §14.2). This
// file's local `Effort`, `OpenAiEffort` and `toOpenAiEffort` were removed that
// day in favour of the shared type and the shared fold.

// ---------------------------------------------------------------------------
// 2. The request
// ---------------------------------------------------------------------------

/** One entry of the Responses API's `input` array (`docs/03` §2.3). */
export interface ResponsesInputMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** `text.format` for a JSON schema (`docs/03` §7.1). */
export interface ResponsesJsonSchemaFormat {
  readonly type: "json_schema";
  readonly name: string;
  readonly strict: true;
  readonly schema: object;
}

/** The `POST /v1/responses` body this adapter sends (`docs/03` §2.3, §7.1). */
export interface ResponsesRequestBody {
  readonly model: string;
  readonly input: readonly ResponsesInputMessage[];
  readonly max_output_tokens?: number;
  readonly temperature?: number;
  readonly reasoning?: { readonly effort: FiveLevelEffort };
  readonly text?: { readonly format: ResponsesJsonSchemaFormat };
}

/** What {@link buildResponsesBody} needs besides the request. */
export interface ResponsesBodyOptions {
  /**
   * `ModelInfo.maxOutputTokens` for the requested model, when known. A value
   * that is not a positive number means "not known" (see
   * {@link UNKNOWN_TOKEN_LIMIT}) and clamps nothing.
   */
  readonly maxOutputTokensLimit?: number | undefined;
}

/**
 * The output cap to send: the request's, clamped to the model's limit.
 *
 * @param requested - `ChatRequest.maxOutputTokens`
 * @param limit - `ModelInfo.maxOutputTokens`, when known
 * @returns the value for `max_output_tokens`, or `undefined` to omit it
 */
export function clampMaxOutputTokens(
  requested: number | undefined,
  limit: number | undefined,
): number | undefined {
  if (requested === undefined) return undefined;
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return requested;
  }
  return Math.min(requested, limit);
}

/**
 * Build the Responses API body for one `ChatRequest`.
 *
 * - System content stays a `role: "system"` entry of `input`, in its place in
 *   the conversation (`docs/03` §2.3, §14.3's "System prompt" row).
 * - `maxOutputTokens` becomes `max_output_tokens` — never `max_tokens` —
 *   clamped to the model's limit (§14.3's "Max output" row).
 * - A JSON schema goes to `text.format`, never `response_format` (§7.1, §7.5),
 *   with `strict: true` (§14.2).
 * - `request.effort` becomes `reasoning.effort`, folded by
 *   `toFiveLevelEffort` and never forwarded; with no effort, no `reasoning`
 *   is sent and OpenAI's own default applies.
 *
 * @param request - the provider-agnostic request
 * @param options - the model's output limit
 * @returns the body, ready for `JSON.stringify`
 */
export function buildResponsesBody(
  request: ChatRequest,
  options: ResponsesBodyOptions = {},
): ResponsesRequestBody {
  const maxOutputTokens = clampMaxOutputTokens(
    request.maxOutputTokens,
    options.maxOutputTokensLimit,
  );
  const format = request.responseFormat;
  return {
    model: request.model,
    input: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...(maxOutputTokens !== undefined && {
      max_output_tokens: maxOutputTokens,
    }),
    ...(request.temperature !== undefined && {
      temperature: request.temperature,
    }),
    ...(request.effort !== undefined && {
      reasoning: { effort: toFiveLevelEffort(request.effort) },
    }),
    ...(format?.kind === "json_schema" && {
      text: {
        format: {
          type: "json_schema",
          name: format.name,
          strict: true,
          schema: format.schema,
        },
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// 3. The response
// ---------------------------------------------------------------------------

/** A JSON object, as far as this file needs to know. */
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayOf(record: JsonRecord | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function recordOf(
  record: JsonRecord | undefined,
  key: string,
): JsonRecord | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function stringOf(
  record: JsonRecord | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

/** A token count: a finite, non-negative number, else `undefined`. */
function countOf(
  record: JsonRecord | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Parse a 2xx body. Returns `undefined` for a body that is not a JSON object.
 *
 * @param body - the response body as text
 * @returns the parsed object, or `undefined`
 */
export function parseResponsesJson(body: string): JsonRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The answer's text: every `output_text` part of every `message` item, joined.
 *
 * Never `output[0]`: a reasoning model emits a `reasoning` item before the
 * `message` item (`docs/03` §2.4's first parsing note).
 *
 * @param parsed - the parsed response
 * @returns the flat text; `""` when there is none
 */
export function extractOutputText(parsed: JsonRecord): string {
  return arrayOf(parsed, "output")
    .filter(isRecord)
    .filter((item) => stringOf(item, "type") === "message")
    .flatMap((item) => arrayOf(item, "content"))
    .filter(isRecord)
    .filter((part) => stringOf(part, "type") === "output_text")
    .map((part) => stringOf(part, "text") ?? "")
    .join("");
}

/**
 * `docs/07` §5.1's `Usage` from the Responses API's `usage` block.
 *
 * **Reasoning tokens are output.** `usage.output_tokens` already includes the
 * hidden reasoning tokens (`docs/03` §2.6), so it is taken whole: the
 * `output_tokens_details.reasoning_tokens` figure is neither subtracted (which
 * would under-cost the call 2–5× at high effort) nor added (which would count
 * them twice). OpenAI reports no cost, so `costUsd` is `undefined`. Since
 * 2026-11-02 (`P4-T23`) that figure is also kept as `reasoningTokens`, beside
 * `outputTokens` and still inside it; absent when the answer has none.
 *
 * @param parsed - the parsed response
 * @returns the usage
 */
export function extractUsage(parsed: JsonRecord): Usage {
  const usage = recordOf(parsed, "usage");
  const inputTokens = countOf(usage, "input_tokens");
  const outputTokens = countOf(usage, "output_tokens");
  const reported = countOf(usage, "total_tokens");
  const totalTokens =
    reported ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  const reasoningTokens = countOf(
    recordOf(usage, "output_tokens_details"),
    "reasoning_tokens",
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: undefined,
    ...(reasoningTokens !== undefined && { reasoningTokens }),
  };
}

/** `incomplete_details.reason` for a truncated answer (`docs/03` §2.4). */
export const INCOMPLETE_MAX_OUTPUT_TOKENS = "max_output_tokens";

/**
 * `status` plus `incomplete_details` onto `ChatResponse.finishReason`.
 *
 * Truncation is `status: "incomplete"` with reason `max_output_tokens`, and is
 * **not** an error (`docs/03` §2.4's second parsing note), so it is
 * `"length"`. A `content_filter` reason never reaches here in practice: the
 * adapter hands every 2xx to `mapProviderError` first, which throws
 * `ContentFilterError` for it and for a `refusal` part.
 *
 * @param parsed - the parsed response
 * @returns the finish reason
 */
export function toFinishReason(
  parsed: JsonRecord,
): ChatResponse["finishReason"] {
  const status = stringOf(parsed, "status");
  if (status === "completed") return "stop";
  if (status === "incomplete") {
    const reason = stringOf(recordOf(parsed, "incomplete_details"), "reason");
    if (reason === INCOMPLETE_MAX_OUTPUT_TOKENS) return "length";
    if (reason === "content_filter") return "content_filter";
  }
  return "other";
}

/** What {@link toChatResponse} needs besides the body. */
export interface ChatResponseContext {
  /** The request, for the model id and the requested format. */
  readonly request: ChatRequest;
  /** Milliseconds from send to answer, measured by the adapter's clock. */
  readonly latencyMs: number;
}

/**
 * Normalize a parsed Responses API answer (`docs/03` §14.3).
 *
 * `json` is filled only when the request asked for JSON and the text parses;
 * a failure to parse is not an error here — the repair path is `P3-T12`'s.
 *
 * @param parsed - the parsed 2xx body
 * @param context - the request and the measured latency
 * @returns the `ChatResponse`
 */
export function toChatResponse(
  parsed: JsonRecord,
  context: ChatResponseContext,
): ChatResponse {
  const text = extractOutputText(parsed);
  const wantsJson =
    context.request.responseFormat !== undefined &&
    context.request.responseFormat.kind !== "text";
  return {
    text,
    json: wantsJson ? parseJsonText(text) : undefined,
    model: stringOf(parsed, "model") ?? context.request.model,
    finishReason: toFinishReason(parsed),
    usage: extractUsage(parsed),
    servedBy: undefined,
    latencyMs: context.latencyMs,
    raw: parsed,
  };
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 4. The model list
// ---------------------------------------------------------------------------

/**
 * What `GET /v1/models` mixes in with the chat models, and this adapter drops.
 *
 * `docs/03` §9.1's pattern, `/embedding|tts|transcribe|whisper|image|realtime|
 * moderation|audio/`, plus `dall-e`: an image model whose id contains none of
 * those words, which the card's "drop … image entries" covers and §9.1's
 * pattern would let through. Case-insensitive.
 */
export const NON_CHAT_MODEL_PATTERN =
  /embedding|tts|transcribe|whisper|image|realtime|moderation|audio|dall-e/i;

/**
 * `ModelInfo`'s token limits for a model the list does not describe.
 *
 * `GET /v1/models` returns ids only — "no context window, no pricing, no
 * capability flags" (`docs/03` §9.1) — while `docs/07` §4.3 types both limits
 * as plain numbers. `0` means "not known"; {@link clampMaxOutputTokens} ignores
 * it, and enrichment from the OpenRouter catalogue is `P3-T13`'s.
 */
export const UNKNOWN_TOKEN_LIMIT = 0;

/**
 * OpenAI's API data posture, `docs/09` §3.3: no training on API data by
 * default, abuse-monitoring logs kept up to 30 days. `note` is left empty: a
 * free-text English sentence here would be an untranslated user-visible
 * string, and the surface that shows it is `P3-T15`'s.
 */
export const OPENAI_DATA_POLICY: ModelDataPolicy = Object.freeze({
  trainsOnInputByDefault: "no",
  retention: Object.freeze({ days: 30, note: "" }),
  policyUrl: "https://developers.openai.com/api/docs/guides/your-data",
});

/**
 * Whether a listed id is a chat model this adapter offers.
 *
 * @param id - a model id from `GET /v1/models`
 * @returns `false` for an embedding, audio, image, realtime or moderation model
 */
export function isChatModelId(id: string): boolean {
  return !NON_CHAT_MODEL_PATTERN.test(id);
}

/**
 * Read `GET /v1/models`' body into `ModelInfo`s, chat models only.
 *
 * Every field the list does not carry is "not known": both token limits are
 * {@link UNKNOWN_TOKEN_LIMIT}, both prices `undefined`, and
 * `supportsJsonSchema` `false` until `P3-T13` enriches it. A repeated id is
 * kept once, in first-seen order.
 *
 * **`supportsStreaming` is `true`** (`plan/00` §6 item 268(d), owner,
 * 2026-10-22; `docs/07` §4.3's note "'not known' streams"). The field is a
 * boolean and the router reads `false` as "cannot stream", so "not known" is
 * written as the value the router streams, `true`. Until that date this wrote
 * `false`, and every listed OpenAI model took the router's `chat` fallback
 * (`P3-T11` finding 1).
 *
 * @param parsed - the parsed list body
 * @returns the chat models
 */
export function toModelInfos(parsed: JsonRecord): ModelInfo[] {
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  for (const entry of arrayOf(parsed, "data")) {
    if (!isRecord(entry)) continue;
    const id = stringOf(entry, "id");
    if (id === undefined || id === "" || seen.has(id) || !isChatModelId(id)) {
      continue;
    }
    seen.add(id);
    models.push({
      id,
      displayName: id,
      contextWindowTokens: UNKNOWN_TOKEN_LIMIT,
      maxOutputTokens: UNKNOWN_TOKEN_LIMIT,
      supportsJsonSchema: false,
      supportsStreaming: true, // "not known" streams (item 268(d))
      supportsSystemPrompt: true,
      inputCostPerMTokUsd: undefined,
      outputCostPerMTokUsd: undefined,
      dataPolicy: OPENAI_DATA_POLICY,
    });
  }
  return models;
}
