/**
 * Structured output: a schema-constrained call returns a validated object or
 * throws — never prose, never a half-parsed shape, and never a repair loop.
 *
 * **Scope.** `P3-T12` steps 3–6. Callers: `summarizeItem` (`P3-T25`) and
 * relevance screening (`P3-T27`), each through `completeJSON` over the
 * router's `chat()` (`docs/06` §6.4's `generateStructured` is this function,
 * not a second adapter member). The four adapters translate
 * `responseFormat.kind === "json_schema"` into their native field (`docs/03`
 * §7.1–§7.5); the one adapter whose models may lack structured output,
 * OpenRouter (`docs/12` §18.2's "frequently needed" row), calls
 * {@link withSchemaInPrompt} for such a model.
 *
 * ## The order, and its bound (`docs/12` §18.3, `docs/03` §14.5)
 *
 * 1. **The call.** A truncated answer (`finishReason: "length"`) throws
 *    `LLMError` at once: half a JSON object is not repairable, and the fix is
 *    a larger output limit, not a second spend. A content-filter stop throws
 *    `ContentFilterError` at once (an adapter usually throws it itself, from
 *    `mapProviderError` on the 2xx, and that propagates unchanged). Neither
 *    is ever repaired or retried.
 * 2. **{@link parseOrRepair}.** {@link tryParseJson} (fences stripped, else
 *    the outermost balanced `{…}`) and {@link validateAgainstSchema}. Valid:
 *    done. Otherwise **one** repair call — `docs/12` §18.3's prompt, verbatim,
 *    at temperature 0 — and the repaired text is parsed and validated the same
 *    way. Still invalid: `StructuredOutputError`.
 * 3. **One full retry** of the original request at temperature 0. Truncation
 *    and refusal are checked again. Valid: done. Otherwise
 *    `StructuredOutputError(providerId, modelId, …)` — the item fails.
 *
 * So a call costs at most **three** requests, and the bound is in the code's
 * shape (two straight-line fallbacks), not in a counter. **The repair is the
 * prompt, not the loop:** `StructuredOutputError` is excluded from the
 * transport's retry set by class (`isRetriedAutomatically` in
 * `src/core/http/retry.ts`, `P3-T38`), and nothing here catches any other
 * error class.
 *
 * ## What reaches an error's context
 *
 * `docs/12` §18.3: `ctx` "MUST already be redacted by the thrower", and the
 * model's output reaches a log "only when `logRequestBodies` is on". So a
 * thrown `StructuredOutputError` always carries the validator's error lines
 * and the output lengths, and carries the outputs themselves only when the
 * caller passes {@link CompleteJsonOptions.includeBodies} (the caller reads
 * `logRequestBodies`; `llm/` reads no preference). Every string goes through
 * `redactText` (`src/core/provenance.ts`) — the one gate over `KEY_PATTERNS`.
 *
 * ## Not here
 *
 * - `docs/12` §18.4's invariants a schema cannot express (overwrite
 *   `itemKey`, `[[key]]` scope, numerals in the source) are the callers'
 *   (`P3-T25`, `P3-T27`).
 * - Budget reservation is the adapter's or `P3-T16`'s; every request here goes
 *   through `chat()` with the caller's `LLMCallContext`.
 */

import {
  ConfigurationError,
  ContentFilterError,
  LLMError,
  StructuredOutputError,
} from "../../core/errors";
import { redactText } from "../../core/provenance";
import type { ProviderId } from "../../model/ids";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LLMCallContext,
  LLMProvider,
  LLMRouter,
  Usage,
} from "../types";

import {
  assertSupportedSchema,
  type JsonSchema,
  validateAgainstSchema,
} from "./schemaValidate";

// ---------------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------------

/** `ChatRequest.responseFormat`'s `json_schema` member. */
export type JsonSchemaFormat = Extract<
  NonNullable<ChatRequest["responseFormat"]>,
  { readonly kind: "json_schema" }
>;

/** A request that asks for one JSON object matching a schema. */
export type StructuredRequest = ChatRequest & {
  readonly responseFormat: JsonSchemaFormat;
};

/**
 * What a structured call goes through: an adapter (`LLMProvider`) or the
 * router (`LLMRouter`, the pipelines' `PipelineContext.llm`). Only `chat` and
 * the provider's id are used.
 */
export type JsonChatTarget =
  Pick<LLMProvider, "id" | "chat"> | Pick<LLMRouter, "activeProvider" | "chat">;

/** Options for {@link completeJSON} and {@link parseOrRepair}. */
export interface CompleteJsonOptions {
  /**
   * Put the model's outputs, redacted, into a thrown
   * `StructuredOutputError`'s context. The caller passes the
   * `logRequestBodies` preference (`docs/12` §18.3). Default `false`: the
   * context then carries the error lines and the output lengths only.
   */
  readonly includeBodies?: boolean;
}

/** Which of the three steps produced the value. */
export type JsonOutcome = "direct" | "repaired" | "retried";

/** A validated value and what it cost. */
export interface CompletedJson<T> {
  /** The parsed, schema-valid value. */
  readonly value: T;
  /** The answer the value was read from (the repair's, when repaired). */
  readonly response: ChatResponse;
  /** Summed over every request made; a field is `undefined` if any answer lacked it. */
  readonly usage: Usage;
  /** Requests made: 1, 2 or 3. */
  readonly calls: number;
  readonly outcome: JsonOutcome;
}

/** What {@link parseOrRepair} returns. */
export interface ParsedOrRepaired {
  readonly value: unknown;
  /** The repair call's answer, or `undefined` when `raw` was valid as it stood. */
  readonly repair: ChatResponse | undefined;
}

// ---------------------------------------------------------------------------
// 2. Parsing: the fence stripper and the balanced-brace extractor
// ---------------------------------------------------------------------------

/**
 * `docs/03` §14.5's `stripCodeFence`, widened to a fence that prose
 * surrounds: the body of the first ```` ``` ```` or ```` ```json ```` block,
 * else the trimmed text.
 *
 * @param text - a model's answer
 * @returns the text inside the first code fence, or the trimmed text
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  // One pattern serves both: a fence that is the whole text is also the first fence.
  const fenced = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1] !== undefined) return fenced[1].trim();
  return trimmed;
}

/** The index just past the `}` closing the `{` at `start`, or -1. Strings and escapes respected. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function parseOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * `docs/12` §18.3's `tryParse`: strip code fences; parse; else take the
 * outermost balanced `{…}` that parses (`docs/06` §6.4's fallback order).
 *
 * @param text - a model's answer
 * @returns the parsed value, or `undefined` when nothing in it parses
 */
export function tryParseJson(text: string): unknown {
  const stripped = stripCodeFence(text);
  if (stripped === "") return undefined;
  const direct = parseOrUndefined(stripped);
  if (direct !== undefined) return direct;
  // Prose around the object: try each `{` in turn, outermost first.
  for (
    let start = stripped.indexOf("{");
    start !== -1;
    start = stripped.indexOf("{", start + 1)
  ) {
    const end = balancedEnd(stripped, start);
    if (end === -1) break;
    const candidate = parseOrUndefined(stripped.slice(start, end));
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 3. The prompt-append fallback (`docs/06` §6.4, `docs/12` §18.2)
// ---------------------------------------------------------------------------

/** The heading of the output contract {@link withSchemaInPrompt} appends. */
export const SCHEMA_APPEND_HEADING = "OUTPUT FORMAT:";

/**
 * The instruction {@link withSchemaInPrompt} appends. Model-facing, never shown
 * to the user, so it is not a Fluent string.
 */
export const SCHEMA_APPEND_INSTRUCTION =
  "Reply with only one JSON object that matches the JSON Schema below. No prose, no code fences.";

/**
 * `docs/06` §6.4's universal fallback for a model without structured output:
 * the schema moves from the request's `responseFormat` into the prompt.
 *
 * The contract is appended to the **last user message**, so the system
 * message stays byte-identical across a batch (`docs/12` §18.1 rule 9); a
 * request with no user message gets one. `responseFormat` becomes
 * `{ kind: "json" }`: the adapter sends no structured-output field for it, and
 * still parses the answer into `ChatResponse.json`. Validation is
 * `completeJSON`'s, as for every provider.
 *
 * @param request - any request
 * @returns a `json_schema` request with the schema in the prompt; any other
 *   request unchanged
 */
export function withSchemaInPrompt(request: ChatRequest): ChatRequest {
  const format = request.responseFormat;
  if (format?.kind !== "json_schema") return request;
  const contract = [
    SCHEMA_APPEND_HEADING,
    SCHEMA_APPEND_INSTRUCTION,
    "",
    "SCHEMA:",
    JSON.stringify(format.schema),
  ].join("\n");
  const messages: ChatMessage[] = [...request.messages];
  const last = messages.map((m) => m.role).lastIndexOf("user");
  const target = messages[last];
  if (last === -1 || target === undefined) {
    messages.push({ role: "user", content: contract });
  } else {
    messages[last] = {
      role: "user",
      content: `${target.content}\n\n${contract}`,
    };
  }
  return { ...request, messages, responseFormat: { kind: "json" } };
}

// ---------------------------------------------------------------------------
// 4. The repair call (`docs/12` §18.3)
// ---------------------------------------------------------------------------

/** `docs/12` §18.3's repair system prompt, verbatim. */
export const REPAIR_SYSTEM_PROMPT =
  "You fix malformed JSON. Output only the corrected JSON object. No prose, no fences.";

/**
 * The repair request, `docs/12` §18.3's user text verbatim.
 *
 * It goes to the model that produced `raw`, at temperature 0, as plain text
 * (§18.3's `llm.text`). The original's privacy routing, effort, output limit,
 * seed and trace id are kept: a repair must not route the paper's text
 * anywhere the original could not go.
 *
 * @param original - the structured request that produced `raw`
 * @param raw - the malformed output
 * @param errors - the validator's lines, or `["not valid JSON"]`
 * @returns the repair request
 */
export function buildRepairRequest(
  original: StructuredRequest,
  raw: string,
  errors: readonly string[],
): ChatRequest {
  const user = [
    "This output was supposed to match the schema below but did not.",
    "Fix it. Do not add information that is not already present; if a required field has no value, use null or an empty array.",
    "",
    "ERRORS:",
    errors.join("\n"),
    "",
    "SCHEMA:",
    JSON.stringify(original.responseFormat.schema),
    "",
    "MALFORMED OUTPUT:",
    raw,
  ].join("\n");
  return {
    model: original.model,
    messages: [
      { role: "system", content: REPAIR_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    temperature: 0,
    ...(original.maxOutputTokens !== undefined && {
      maxOutputTokens: original.maxOutputTokens,
    }),
    ...(original.effort !== undefined && { effort: original.effort }),
    ...(original.routing !== undefined && { routing: original.routing }),
    ...(original.seed !== undefined && { seed: original.seed }),
    traceId: original.traceId,
  };
}

// ---------------------------------------------------------------------------
// 5. parseOrRepair and completeJSON
// ---------------------------------------------------------------------------

/** The provider id a structured call is attributed to. */
function providerIdOf(llm: JsonChatTarget): ProviderId {
  return "activeProvider" in llm ? llm.activeProvider() : llm.id;
}

/** Parse and validate one answer's text. */
function judge(
  text: string,
  schema: JsonSchema,
): { readonly value: unknown; readonly errors: readonly string[] } {
  const value = tryParseJson(text);
  if (value === undefined) return { value, errors: ["not valid JSON"] };
  return { value, errors: validateAgainstSchema(value, schema).errors };
}

/** The redacted error context `docs/12` §18.3 asks for. */
function failureContext(
  errors: readonly string[],
  outputs: Readonly<Record<string, string>>,
  options: CompleteJsonOptions,
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    errors: errors.map((line) => redactText(line)),
  };
  for (const [name, text] of Object.entries(outputs)) {
    ctx[`${name}Length`] = text.length;
    if (options.includeBodies === true) ctx[name] = redactText(text);
  }
  return ctx;
}

/**
 * Throw for an answer that must never be repaired or retried: a truncation
 * (`LLMError`) or a content-filter stop (`ContentFilterError`).
 */
function refuseUnrepairable(
  response: ChatResponse,
  providerId: ProviderId,
  request: StructuredRequest,
): void {
  if (response.finishReason === "length") {
    throw new LLMError(
      providerId,
      request.model,
      "Output truncated before the JSON completed (finishReason length); not repaired",
      {
        finishReason: "length",
        maxOutputTokens: request.maxOutputTokens,
        outputLength: response.text.length,
      },
    );
  }
  if (response.finishReason === "content_filter") {
    throw new ContentFilterError(
      providerId,
      request.model,
      "The model declined (finishReason content_filter); not repaired",
      { finishReason: "content_filter" },
    );
  }
}

/**
 * `docs/12` §18.3's `parseOrRepair`: `raw` as it stands if it is valid, else
 * exactly one repair call.
 *
 * `request.model` is the model that produced `raw`, and the repair goes to
 * the same model. A repair answer stopped by a content filter throws
 * `ContentFilterError`; any error `chat()` throws propagates unchanged.
 *
 * @param raw - the output to judge
 * @param request - the structured request that produced it
 * @param llm - the adapter or router that produced it
 * @param ctx - the call context (cancellation, budget)
 * @param options - see {@link CompleteJsonOptions}
 * @returns the valid value, and the repair's answer when one was made
 * @throws StructuredOutputError `(providerId, modelId, message, ctx)` when the
 *   repaired output is still not valid
 */
export async function parseOrRepair(
  raw: string,
  request: StructuredRequest,
  llm: JsonChatTarget,
  ctx: LLMCallContext,
  options: CompleteJsonOptions = {},
): Promise<ParsedOrRepaired> {
  const schema = request.responseFormat.schema as JsonSchema;
  const direct = judge(raw, schema);
  if (direct.errors.length === 0) {
    return { value: direct.value, repair: undefined };
  }

  const providerId = providerIdOf(llm);
  const repair = await llm.chat(
    buildRepairRequest(request, raw, direct.errors),
    ctx,
  );
  if (repair.finishReason === "content_filter") {
    refuseUnrepairable(repair, providerId, request);
  }
  const fixed = judge(repair.text, schema);
  if (fixed.errors.length === 0) return { value: fixed.value, repair };

  throw new StructuredOutputError(
    providerId,
    request.model,
    "JSON repair failed",
    failureContext(fixed.errors, { raw, repaired: repair.text }, options),
  );
}

/** Sum one `Usage` field; `undefined` if any answer lacked it. */
function sumField(
  usages: readonly Usage[],
  field: keyof Usage,
): number | undefined {
  let total = 0;
  for (const usage of usages) {
    const value = usage[field];
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

function sumUsage(responses: readonly ChatResponse[]): Usage {
  const usages = responses.map((r) => r.usage);
  return {
    inputTokens: sumField(usages, "inputTokens"),
    outputTokens: sumField(usages, "outputTokens"),
    totalTokens: sumField(usages, "totalTokens"),
    costUsd: sumField(usages, "costUsd"),
  };
}

/**
 * `docs/03` §14.5's `completeJSON`, in `docs/12` §18.3's order: the call, one
 * repair, one full retry at temperature 0, then fail that item (this module's
 * header).
 *
 * @param llm - the adapter or router to call
 * @param request - a request whose `responseFormat` is `json_schema`
 * @param ctx - the call context
 * @param options - see {@link CompleteJsonOptions}
 * @returns the validated value, the answer it came from, the summed usage
 *   and the request count
 * @throws ConfigurationError, before any request, when the request is not
 *   `json_schema` or its schema is outside the validator's subset
 * @throws LLMError on a truncated answer, ContentFilterError on a refusal —
 *   both before any repair
 * @throws StructuredOutputError `(providerId, modelId, …)` when the retry's
 *   answer is still not valid
 */
export async function completeJSON<T = unknown>(
  llm: JsonChatTarget,
  request: StructuredRequest,
  ctx: LLMCallContext,
  options: CompleteJsonOptions = {},
): Promise<CompletedJson<T>> {
  // A caller outside the type system (or a cast) must not get a free-text call.
  const format = request.responseFormat as { kind?: unknown } | undefined;
  if (format?.kind !== "json_schema") {
    throw new ConfigurationError(
      'completeJSON needs responseFormat { kind: "json_schema" }',
      { model: request.model },
    );
  }
  const schema = request.responseFormat.schema as JsonSchema;
  assertSupportedSchema(schema);
  const providerId = providerIdOf(llm);
  /** Every answer, in order: the usage sum and the request count. */
  const answers: ChatResponse[] = [];
  const counted: Pick<LLMProvider, "id" | "chat"> = {
    id: providerId,
    chat: async (sent, callCtx) => {
      const answer = await llm.chat(sent, callCtx);
      answers.push(answer);
      return answer;
    },
  };

  const finish = (
    value: unknown,
    response: ChatResponse,
    outcome: JsonOutcome,
  ): CompletedJson<T> => ({
    value: value as T,
    response,
    usage: sumUsage(answers),
    calls: answers.length,
    outcome,
  });

  // 1. The call.
  const first = await counted.chat(request, ctx);
  refuseUnrepairable(first, providerId, request);

  // 2. One repair.
  let repairErrors: unknown;
  try {
    const { value, repair } = await parseOrRepair(
      first.text,
      request,
      counted,
      ctx,
      options,
    );
    return repair === undefined
      ? finish(value, first, "direct")
      : finish(value, repair, "repaired");
  } catch (error) {
    if (!(error instanceof StructuredOutputError)) throw error;
    repairErrors = error.context.errors;
  }

  // 3. One full retry of the original at temperature 0. Its answer is not repaired.
  const retry = await counted.chat({ ...request, temperature: 0 }, ctx);
  refuseUnrepairable(retry, providerId, request);
  const judged = judge(retry.text, schema);
  if (judged.errors.length === 0) {
    return finish(judged.value, retry, "retried");
  }

  throw new StructuredOutputError(
    providerId,
    request.model,
    "Model did not produce schema-valid JSON after one repair and one retry",
    {
      ...failureContext(
        judged.errors,
        { raw: first.text, retried: retry.text },
        options,
      ),
      requests: answers.length,
      repairErrors,
    },
  );
}
