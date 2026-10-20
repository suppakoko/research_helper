/**
 * The Anthropic Messages API's wire shapes, and the pure mapping between them
 * and `docs/07` §4.3's provider-agnostic types.
 *
 * **Scope.** `P3-T09`. Nothing here sends a request, reads a key or a clock,
 * or throws on a provider failure: `./anthropicProvider.ts` does all of that,
 * and hands this file only parsed JSON. Every function is pure so the wire
 * shape can be asserted exactly by a unit test (`test/unit/llm/anthropic.test.ts`).
 *
 * **Authority.** `docs/03-llm-provider-integration.md`:
 *
 * - §3.3: `max_tokens` is **required** and `system` is a **top-level field**,
 *   never a message with `role: "system"`.
 * - §3.4: `content` is an array of blocks, filtered for `type === "text"`;
 *   truncation is `stop_reason: "max_tokens"`; a refusal is
 *   `stop_reason: "refusal"` with HTTP 200 (`mapProviderError` turns that into
 *   `ContentFilterError` before this file is asked to read `content`); total
 *   input is `input_tokens + cache_creation_input_tokens +
 *   cache_read_input_tokens`.
 * - §7.2: structured output through `output_config.format`
 *   (`{ type: "json_schema", schema }`), never the deprecated top-level
 *   `output_format`; the strict-tool pattern (one tool with the schema as its
 *   `input_schema`, `strict: true`, the answer read from `tool_use.input`) is
 *   the fallback for a model that lacks structured outputs.
 * - §9.2: each model carries `max_input_tokens` (the context window) and
 *   `max_tokens` (the output cap); there is **no `context_window` field**. The
 *   list is paginated by `has_more` / `last_id`.
 * - §10.1: `POST /v1/messages/count_tokens` is exact and free.
 * - §14.3: usage is summed across the cache fields, and a flat `text` string
 *   is returned, never a block array.
 *
 * **Shapes `docs/03` does not print, and where they come from.** The
 * `count_tokens` answer (`{ "input_tokens": N }`), the list envelope's `data`
 * array and the `after_id` query parameter that carries `last_id` to the next
 * page, and the capability leaf `capabilities.structured_outputs.supported`
 * are taken from the bundled Anthropic API reference (`claude-api` skill,
 * `shared/token-counting.md` and `shared/models.md`), not invented. The
 * `P3-T09` report records them for the documents.
 *
 * **What is deliberately not sent.** `temperature` and `topP`: `docs/03`
 * §14.2's Anthropic sketch sends neither, and the bundled reference records
 * that current Claude models reject sampling parameters with HTTP 400.
 * `seed`, `routing` and `traceId` have no Anthropic meaning; `traceId` is never
 * sent upstream (`docs/07` §4.3). No `anthropic-version` other than
 * `2023-06-01` is ever written (`docs/03` §3.2: "not a date you should bump").
 */

import type {
  ChatRequest,
  ChatResponse,
  ModelDataPolicy,
  ModelInfo,
  Usage,
} from "../types";

// ---------------------------------------------------------------------------
// 1. Constants — docs/03 §3.1, §3.2, §9.2
// ---------------------------------------------------------------------------

/** `docs/03` §3.2: required on every request, and never bumped. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** `docs/03` §3.1: text generation. */
export const MESSAGES_PATH = "/v1/messages";

/** `docs/03` §3.1 and §10.1: exact, free token counting. */
export const COUNT_TOKENS_PATH = "/v1/messages/count_tokens";

/** `docs/03` §3.1 and §9.2: the model list. */
export const MODELS_PATH = "/v1/models";

/**
 * Anthropic's data handling for API traffic, `docs/09` §3.3: not used for
 * training by default, deleted within 30 days. `note` is empty because it is
 * user-visible text, which the egress-disclosure card (`P3-T15`) writes and
 * localizes; the longer retention for flagged traffic is §3.3's to explain.
 */
export const ANTHROPIC_DATA_POLICY: ModelDataPolicy = Object.freeze({
  trainsOnInputByDefault: "no",
  retention: Object.freeze({ days: 30, note: "" }),
  policyUrl:
    "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training",
});

// ---------------------------------------------------------------------------
// 2. The request body — docs/03 §3.3, §7.2
// ---------------------------------------------------------------------------

/** One turn of `messages`: Anthropic has no `system` role there. */
export interface AnthropicMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** The strict tool of `docs/03` §7.2's fallback path. */
export interface AnthropicStrictTool {
  readonly name: string;
  readonly input_schema: object;
  readonly strict: true;
}

/** The `POST /v1/messages` body this adapter sends. */
export interface AnthropicMessagesBody {
  readonly model: string;
  /** Always present: `docs/03` §3.3 makes it required. */
  readonly max_tokens: number;
  /** Top level, never a message (`docs/03` §3.3). */
  readonly system?: string;
  readonly messages: readonly AnthropicMessage[];
  readonly stop_sequences?: readonly string[];
  readonly output_config?: {
    readonly format: { readonly type: "json_schema"; readonly schema: object };
  };
  readonly tools?: readonly AnthropicStrictTool[];
  readonly tool_choice?: { readonly type: "tool"; readonly name: string };
}

/** The `POST /v1/messages/count_tokens` body: the same shape without `max_tokens`. */
export type AnthropicCountTokensBody = Omit<
  AnthropicMessagesBody,
  "max_tokens" | "stop_sequences"
>;

/**
 * How a `json_schema` request is expressed on the wire.
 *
 * `output_config` is `docs/03` §7.2's recommended path. `strict_tool` is its
 * fallback "for older models", chosen by the adapter only when the model's
 * catalogue entry says it lacks structured outputs.
 */
export type StructuredOutputMode = "output_config" | "strict_tool";

/**
 * Split `docs/07` §4.3's messages into Anthropic's top-level `system` and its
 * `messages` array.
 *
 * Every `system` message is lifted, in order, and joined with a blank line:
 * Anthropic accepts exactly one system prompt, at the top (`docs/03` §3.3).
 */
export function splitSystem(request: ChatRequest): {
  readonly system: string | undefined;
  readonly messages: readonly AnthropicMessage[];
} {
  const system: string[] = [];
  const messages: AnthropicMessage[] = [];
  for (const message of request.messages) {
    if (message.role === "system") system.push(message.content);
    else messages.push({ role: message.role, content: message.content });
  }
  return {
    system: system.length > 0 ? system.join("\n\n") : undefined,
    messages,
  };
}

/** The structured-output members of a body, or nothing. */
function structuredMembers(
  request: ChatRequest,
  mode: StructuredOutputMode,
): Pick<AnthropicMessagesBody, "output_config" | "tools" | "tool_choice"> {
  const format = request.responseFormat;
  if (format?.kind !== "json_schema") return {};
  if (mode === "output_config") {
    return {
      output_config: { format: { type: "json_schema", schema: format.schema } },
    };
  }
  return {
    tools: [{ name: format.name, input_schema: format.schema, strict: true }],
    tool_choice: { type: "tool", name: format.name },
  };
}

/**
 * The `POST /v1/messages` body for `request`.
 *
 * @param request - the provider-agnostic request
 * @param maxTokens - the `max_tokens` to send; the adapter resolves it and it
 *   is always present
 * @param mode - how a `json_schema` request is expressed; ignored otherwise
 * @returns the body, ready for `JSON.stringify`
 */
export function toMessagesBody(
  request: ChatRequest,
  maxTokens: number,
  mode: StructuredOutputMode,
): AnthropicMessagesBody {
  const { system, messages } = splitSystem(request);
  return {
    model: request.model,
    max_tokens: maxTokens,
    ...(system !== undefined && { system }),
    messages,
    ...(request.stop !== undefined &&
      request.stop.length > 0 && { stop_sequences: [...request.stop] }),
    ...structuredMembers(request, mode),
  };
}

/**
 * The `POST /v1/messages/count_tokens` body for `request` (`docs/03` §10.1:
 * "accepts the full request shape including `system` and `tools`").
 *
 * @param request - the request whose input would be counted
 * @param mode - as {@link toMessagesBody}
 */
export function toCountTokensBody(
  request: ChatRequest,
  mode: StructuredOutputMode,
): AnthropicCountTokensBody {
  const { system, messages } = splitSystem(request);
  return {
    model: request.model,
    ...(system !== undefined && { system }),
    messages,
    ...structuredMembers(request, mode),
  };
}

// ---------------------------------------------------------------------------
// 3. The response — docs/03 §3.4, §14.3
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite, non-negative whole number, or `undefined`. */
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * `docs/03` §3.4's usage block as `docs/07` §5.1's `Usage`.
 *
 * **`input_tokens` is not the total.** It counts only the tokens after the
 * last cache breakpoint; `cache_creation_input_tokens` and
 * `cache_read_input_tokens` are added, an absent cache field counting as 0.
 * Getting this wrong under-reports cost by the size of the cached prefix
 * (`docs/03` §3.4, §14.3). Anthropic reports no cost, so `costUsd` is
 * `undefined`.
 */
export function toUsage(raw: unknown): Usage {
  const usage = isRecord(raw) ? raw : {};
  const uncached = count(usage.input_tokens);
  const inputTokens =
    uncached === undefined
      ? undefined
      : uncached +
        (count(usage.cache_creation_input_tokens) ?? 0) +
        (count(usage.cache_read_input_tokens) ?? 0);
  const outputTokens = count(usage.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined,
    costUsd: undefined,
  };
}

/** `docs/03` §14.2's stop-reason table, onto `ChatResponse.finishReason`. */
export function toFinishReason(
  stopReason: string | undefined,
  mode: StructuredOutputMode | undefined,
): ChatResponse["finishReason"] {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "refusal":
      return "content_filter";
    case "tool_use":
      // The strict-tool fallback ends on `tool_use` by construction: that is
      // the structured answer arriving, not a tool call for the caller.
      return mode === "strict_tool" ? "stop" : "tool_use";
    default:
      return "other";
  }
}

/** Parse text as JSON, or `undefined` when it is not JSON. */
function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
}

/** What {@link toChatResponse} needs beyond the parsed body. */
export interface ChatResponseContext {
  readonly request: ChatRequest;
  /** The mode the request was sent in; `undefined` for a non-schema request. */
  readonly mode: StructuredOutputMode | undefined;
  readonly latencyMs: number;
}

/**
 * Read a `POST /v1/messages` answer into `docs/07` §4.3's `ChatResponse`.
 *
 * The caller has already ruled out a refusal (`mapProviderError` on the 2xx
 * body, `docs/03` §3.4: "Always check `stop_reason` before reading
 * `content`"). `text` is the `text` blocks concatenated; a `thinking` block is
 * skipped. For a JSON request `json` is the parsed answer, or `undefined` when
 * it does not parse — the repair path is `P3-T12`'s, so nothing is thrown
 * here. On the strict-tool path the answer is the `tool_use` block's `input`.
 *
 * @param raw - the parsed response body
 * @param context - the request, its structured-output mode and the latency
 * @returns the response, or `undefined` when `raw` is not a Messages answer
 */
export function toChatResponse(
  raw: unknown,
  context: ChatResponseContext,
): ChatResponse | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.content)) return undefined;
  const blocks = raw.content.filter(isRecord);
  const { request, mode, latencyMs } = context;

  let answer = blocks
    .filter((block) => block.type === "text")
    .map((block) => text(block.text) ?? "")
    .join("");
  let json: unknown = undefined;

  const kind = request.responseFormat?.kind;
  if (mode === "strict_tool") {
    const tool = blocks.find((block) => block.type === "tool_use");
    if (tool !== undefined && isRecord(tool.input)) {
      json = tool.input;
      answer = JSON.stringify(tool.input);
    }
  } else if (kind === "json" || kind === "json_schema") {
    json = parseJson(answer);
  }

  return {
    text: answer,
    json,
    model: text(raw.model) ?? request.model,
    finishReason: toFinishReason(text(raw.stop_reason), mode),
    usage: toUsage(raw.usage),
    // Anthropic serves its own models; there is no upstream to name.
    servedBy: undefined,
    latencyMs,
    raw,
  };
}

/**
 * The exact count from a `POST /v1/messages/count_tokens` answer
 * (`{ "input_tokens": N }`), or `undefined` when the body is not that.
 */
export function toTokenCount(raw: unknown): number | undefined {
  return isRecord(raw) ? count(raw.input_tokens) : undefined;
}

// ---------------------------------------------------------------------------
// 4. The model list — docs/03 §9.2
// ---------------------------------------------------------------------------

/** One page of `GET /v1/models`, as this adapter reads it. */
export interface ModelsPage {
  readonly models: readonly ModelInfo[];
  /** Model objects that lacked `max_input_tokens` or `max_tokens`, by id. */
  readonly skipped: readonly string[];
  readonly hasMore: boolean;
  readonly lastId: string | undefined;
}

/**
 * One model object as `docs/07` §4.3's `ModelInfo`.
 *
 * `max_input_tokens` → `contextWindowTokens`, `max_tokens` →
 * `maxOutputTokens` (`docs/03` §9.2). An object missing either is not given a
 * guessed number (`plan/README.md` §5 rule 4); it is left out and its id
 * reported. Prices are `undefined`: §9.2 says the endpoint does not expose
 * them, and the pricing table is `P3-T13`'s.
 */
function toModelInfo(raw: Record<string, unknown>): ModelInfo | undefined {
  const id = text(raw.id);
  const contextWindowTokens = count(raw.max_input_tokens);
  const maxOutputTokens = count(raw.max_tokens);
  if (
    id === undefined ||
    contextWindowTokens === undefined ||
    maxOutputTokens === undefined
  ) {
    return undefined;
  }
  const capabilities = isRecord(raw.capabilities) ? raw.capabilities : {};
  const structured = isRecord(capabilities.structured_outputs)
    ? capabilities.structured_outputs
    : {};
  return {
    id,
    displayName: text(raw.display_name) ?? id,
    contextWindowTokens,
    maxOutputTokens,
    supportsJsonSchema: structured.supported === true,
    // `docs/03` §6.2: every Messages API model streams with `stream: true`.
    supportsStreaming: true,
    // `docs/03` §3.3: the top-level `system` field.
    supportsSystemPrompt: true,
    inputCostPerMTokUsd: undefined,
    outputCostPerMTokUsd: undefined,
    dataPolicy: ANTHROPIC_DATA_POLICY,
  };
}

/**
 * Read one `GET /v1/models` page.
 *
 * @param raw - the parsed body
 * @returns the page, or `undefined` when `raw` has no `data` array
 */
export function toModelsPage(raw: unknown): ModelsPage | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.data)) return undefined;
  const models: ModelInfo[] = [];
  const skipped: string[] = [];
  for (const entry of raw.data.filter(isRecord)) {
    const model = toModelInfo(entry);
    if (model !== undefined) models.push(model);
    else skipped.push(text(entry.id) ?? "");
  }
  return {
    models,
    skipped,
    hasMore: raw.has_more === true,
    lastId: text(raw.last_id),
  };
}
