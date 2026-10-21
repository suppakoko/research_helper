/**
 * OpenRouter's wire shapes, both directions, for the Chat Completions surface.
 *
 * **Scope.** `P3-T07` steps 2–4 and 6. `./openRouterProvider.ts` sends and
 * reads; this file only builds request bodies and reads answers, so every
 * function here is pure and Node-testable.
 *
 * **Authority.** The request is `docs/03` §5.3's, the answer §5.4's, the
 * `provider` routing block `docs/09` §3.4 rules 1 and 2 plus `docs/03` §7.4
 * and §15.3, and the normalization rules `docs/03` §14.3's table. The types
 * are `docs/07` §4.3's (`src/llm/types.ts`), never `docs/03` §14.1's sketch
 * names.
 *
 * ## The `provider` block — on every request
 *
 * | Field | When | Why |
 * |---|---|---|
 * | `require_parameters: true` | `responseFormat.kind === "json_schema"` | `docs/03` §7.4: without it a non-supporting endpoint ignores `response_format` and returns prose |
 * | `data_collection: "deny"` | always, in every privacy mode | decision D6, `docs/09` §3.4 rule 1 and §3.5's table |
 * | `zdr: true` | strict privacy mode, or `routing.requireZeroRetention` | `docs/09` §3.4 rule 1 |
 * | `only` | `routing.allowProviders`, when non-empty | `docs/03` §15.3, `docs/09` §3.3 |
 * | `ignore` | `routing.denyProviders`, when non-empty | same |
 *
 * `routing.requireNoTraining` adds nothing: `data_collection: "deny"` is
 * already on every request.
 *
 * ## `reasoning.effort`
 *
 * `ChatRequest.effort` (`docs/07` §4.3, owner, 2026-10-21, `plan/00` §6
 * item 262(a)) is sent as `reasoning: { effort }`, the field `docs/03`
 * §14.2's OpenRouter sketch sends. The sketch forwards the shared level
 * unmapped, which §14.3 forbids for every adapter ("do not pass the string
 * through blind"); the level is therefore folded by `toFiveLevelEffort`
 * (`none` and `minimal` → `low`), the scale §9.4's catalogue entry lists
 * as `supported_efforts` (`low` … `max`). With no effort, no `reasoning`
 * is sent and the route's own default applies. Per-model
 * `supported_efforts` is not read: the catalogue parser does not keep it.
 *
 * ## Deliberately absent
 *
 * - **`response_format` for `{ kind: "json" }`.** `docs/03` documents only
 *   the `json_schema` shape for OpenRouter (§7.4, §7.5); a bare JSON mode is
 *   not recorded, so it is not guessed at. The answer is still parsed into
 *   `ChatResponse.json` when it is JSON (`docs/07` §4.3: "Providers without
 *   native support get prompt coercion" — the prompt layer's job).
 * - **`sort`, `allow_fallbacks`, `order`.** `docs/03` §15.3 lists them as
 *   recommendations with defaults OpenRouter already applies; `ChatRequest`
 *   carries no field for them, and the card's steps do not ask for them.
 * - **`servedBy`.** `docs/03` §5.4's answer names no upstream; the routing
 *   metadata exists only under `X-OpenRouter-Metadata: enabled` (§5.2), whose
 *   answer shape is not recorded. It is `undefined` rather than guessed.
 */

import { PrivacyRoutingError, redact } from "../../core/errors";
import { PROJECT_URL, TOOL_NAME } from "../../core/http/userAgent";
import type { ProviderId } from "../../model/ids";
import { type FiveLevelEffort, toFiveLevelEffort } from "../shared/effort";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderRoutingHints,
  Usage,
} from "../types";

/** This adapter's `ProviderId`. */
export const OPENROUTER_PROVIDER_ID = "openrouter" satisfies ProviderId;

/**
 * Paths relative to the base URL, which already ends in `/api/v1`
 * (`docs/03` §5.1; `src/llm/shared/baseUrl.ts`'s `DEFAULT_BASE_URLS`).
 * Joined by {@link joinBaseUrl}, so the `/api/v1` segment is never doubled
 * (`P3-T06` report, Contradiction 8).
 */
export const CHAT_COMPLETIONS_PATH = "chat/completions";
/** The public catalogue, `GET /api/v1/models` (`docs/03` §9.4). */
export const MODELS_PATH = "models";

/**
 * Join a base URL and a relative path with exactly one `/` between them.
 *
 * The base is `BaseUrlResolver.resolveBaseUrl`'s answer — the documented
 * `https://openrouter.ai/api/v1` or a validated gateway override, never with a
 * trailing slash — and it already carries the version segment, so the path is
 * appended to it rather than resolved against the host.
 *
 * @param base - the resolved base URL
 * @param path - a path relative to it, e.g. {@link CHAT_COMPLETIONS_PATH}
 * @returns `base/path`
 */
export function joinBaseUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * `docs/03` §5.2's attribution headers. Optional and functionless: they only
 * affect OpenRouter's leaderboard. **Both** title spellings are sent until the
 * header name is settled (`docs/03` §5.2's "Unverified" note). Values are the
 * project's own constants from `src/core/http/userAgent.ts`, not new literals.
 */
export const OPENROUTER_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    "HTTP-Referer": PROJECT_URL,
    "X-Title": TOOL_NAME,
    "X-OpenRouter-Title": TOOL_NAME,
  });

/**
 * The privacy mode that decides `zdr` (`docs/09` §3.5). `P3-T15` supplies the
 * effective mode; until it lands the adapter is built without one and uses
 * {@link DEFAULT_OPENROUTER_PRIVACY_MODE}.
 */
export type OpenRouterPrivacyMode = "strict" | "balanced" | "full";

/** `docs/07` §8.5's `privacy.mode` default, used until `P3-T15` supplies the mode. */
export const DEFAULT_OPENROUTER_PRIVACY_MODE: OpenRouterPrivacyMode =
  "balanced";

/** `docs/03` §5.3's `provider` block, as this adapter sends it. */
export interface OpenRouterProviderBlock {
  readonly require_parameters?: true;
  readonly data_collection: "deny";
  readonly zdr?: true;
  readonly only?: readonly string[];
  readonly ignore?: readonly string[];
}

/** `docs/03` §7.4's `response_format`, the only structured-output shape sent. */
export interface OpenRouterResponseFormat {
  readonly type: "json_schema";
  readonly json_schema: {
    readonly name: string;
    readonly strict: true;
    readonly schema: object;
  };
}

/** `docs/03` §5.3's request body. */
export interface OpenRouterChatBody {
  readonly model: string;
  readonly messages: readonly {
    readonly role: string;
    readonly content: string;
  }[];
  readonly max_tokens?: number;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly stop?: readonly string[];
  readonly seed?: number;
  readonly reasoning?: { readonly effort: FiveLevelEffort };
  readonly response_format?: OpenRouterResponseFormat;
  readonly provider: OpenRouterProviderBlock;
}

/**
 * The routing block for one request (this module's header table).
 *
 * @param request - the request; only `responseFormat` and `routing` are read
 * @param privacyMode - the effective privacy mode
 * @returns the `provider` block
 */
export function openRouterProviderBlock(
  request: Pick<ChatRequest, "responseFormat" | "routing">,
  privacyMode: OpenRouterPrivacyMode,
): OpenRouterProviderBlock {
  const routing: ProviderRoutingHints = request.routing ?? {};
  const zdr = privacyMode === "strict" || routing.requireZeroRetention === true;
  const only = routing.allowProviders ?? [];
  const ignore = routing.denyProviders ?? [];
  return {
    ...(request.responseFormat?.kind === "json_schema" && {
      require_parameters: true as const,
    }),
    data_collection: "deny",
    ...(zdr && { zdr: true as const }),
    ...(only.length > 0 && { only: [...only] }),
    ...(ignore.length > 0 && { ignore: [...ignore] }),
  };
}

/** What {@link toOpenRouterBody} needs besides the request. */
export interface OpenRouterBodyOptions {
  readonly privacyMode: OpenRouterPrivacyMode;
  /**
   * The model's output cap from the catalogue (`ModelInfo.maxOutputTokens`),
   * when known. `docs/03` §14.3: clamp the request's `maxOutputTokens` to it.
   */
  readonly maxOutputTokensCap?: number;
}

/** A message on the wire: role and content, nothing else. */
function wireMessage(message: ChatMessage): {
  role: string;
  content: string;
} {
  return { role: message.role, content: message.content };
}

/**
 * Build `docs/03` §5.3's body for one `ChatRequest`.
 *
 * `traceId` is never sent (`docs/07` §4.3: "never sent upstream").
 * `maxOutputTokens` becomes `max_tokens`, clamped to the model's cap when the
 * catalogue knows it, and is omitted when the request has none — OpenRouter,
 * unlike Anthropic, does not require it, and no number is invented.
 *
 * @param request - the normalized request
 * @param options - privacy mode and the optional output cap
 * @returns the body, ready for `JSON.stringify`
 */
export function toOpenRouterBody(
  request: ChatRequest,
  options: OpenRouterBodyOptions,
): OpenRouterChatBody {
  const cap = options.maxOutputTokensCap;
  const maxTokens =
    request.maxOutputTokens === undefined
      ? undefined
      : cap === undefined
        ? request.maxOutputTokens
        : Math.min(request.maxOutputTokens, cap);
  const format = request.responseFormat;
  return {
    model: request.model,
    messages: request.messages.map(wireMessage),
    ...(maxTokens !== undefined && { max_tokens: maxTokens }),
    ...(request.temperature !== undefined && {
      temperature: request.temperature,
    }),
    ...(request.topP !== undefined && { top_p: request.topP }),
    ...(request.stop !== undefined &&
      request.stop.length > 0 && { stop: [...request.stop] }),
    ...(request.seed !== undefined && { seed: request.seed }),
    ...(request.effort !== undefined && {
      reasoning: { effort: toFiveLevelEffort(request.effort) },
    }),
    ...(format?.kind === "json_schema" && {
      response_format: {
        type: "json_schema" as const,
        json_schema: {
          name: format.name,
          strict: true as const,
          schema: format.schema,
        },
      },
    }),
    provider: openRouterProviderBlock(request, options.privacyMode),
  };
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number, or `undefined`. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * `docs/03` §5.4: OpenRouter normalizes `finish_reason` to
 * `stop | length | tool_calls | content_filter | error`. Mapped onto
 * `docs/07` §4.3's union; anything unrecorded is `"other"`.
 *
 * @param raw - `choices[0].finish_reason`
 * @returns the normalized finish reason
 */
export function mapFinishReason(raw: unknown): ChatResponse["finishReason"] {
  switch (raw) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "tool_calls":
      return "tool_use";
    default:
      return "other";
  }
}

/**
 * `docs/03` §5.4's `usage` onto `docs/07` §5.1's `Usage`. `usage.cost` is the
 * call's actual credit cost in US dollars and is passed through **unrounded**
 * (`P3-T07` Done-when); every absent or non-numeric field is `undefined`.
 *
 * @param raw - the answer's `usage` object, if any
 * @returns the normalized usage
 */
export function toUsage(raw: unknown): Usage {
  const usage = isRecord(raw) ? raw : {};
  return {
    inputTokens: finiteNumber(usage.prompt_tokens),
    outputTokens: finiteNumber(usage.completion_tokens),
    totalTokens: finiteNumber(usage.total_tokens),
    costUsd: finiteNumber(usage.cost),
  };
}

/** Everything of a `ChatResponse` the answer body decides. */
export type OpenRouterAnswer = Pick<
  ChatResponse,
  "text" | "json" | "model" | "finishReason" | "usage" | "servedBy"
>;

/**
 * Read `docs/03` §5.4's answer into the normalized fields.
 *
 * `text` is `choices[0].message.content` as a flat string (`docs/03` §14.3:
 * "Never leak block arrays upward"); `""` when the content is absent or not a
 * string. `json` is the parsed text when the request asked for JSON and the
 * text parses, else `undefined` — a parse failure is the repair layer's
 * (`P3-T12`), not a transport error. A refusal is not detected here: the
 * provider calls `mapProviderError` on the 2xx first, which turns
 * `finish_reason: "content_filter"` into `ContentFilterError`.
 *
 * @param parsed - the parsed answer body
 * @param request - the request it answers
 * @returns the normalized fields, or `undefined` when the body has no
 *   `choices[0]` object
 */
export function fromOpenRouterAnswer(
  parsed: unknown,
  request: Pick<ChatRequest, "model" | "responseFormat">,
): OpenRouterAnswer | undefined {
  if (!isRecord(parsed)) return undefined;
  const choices = parsed.choices;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  if (!isRecord(first)) return undefined;
  const message = isRecord(first.message) ? first.message : {};
  const text = typeof message.content === "string" ? message.content : "";
  const wantsJson =
    request.responseFormat?.kind === "json" ||
    request.responseFormat?.kind === "json_schema";
  return {
    text,
    json: wantsJson ? parseJson(text) : undefined,
    model: typeof parsed.model === "string" ? parsed.model : request.model,
    finishReason: mapFinishReason(first.finish_reason),
    usage: toUsage(parsed.usage),
    servedBy: undefined,
  };
}

function parseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// The guardrail 404 — docs/09 §3.4 rule 2
// ---------------------------------------------------------------------------

/**
 * The two ways out `docs/09` §3.4 rule 2 requires the message to name, as
 * stable machine values in the error's context.
 */
export const OPENROUTER_GUARDRAIL_REMEDIES = Object.freeze([
  "choose-another-model",
  "relax-privacy-setting",
] as const);

/** The `cause` value a guardrail error carries in its context. */
export const OPENROUTER_GUARDRAIL_CAUSE = "openrouter-routing-restrictions";

/**
 * Whether an error answer is OpenRouter's "no endpoint satisfies your routing
 * restrictions" 404 (`docs/09` §3.3's "practical trap").
 *
 * **Keyed off the status and the body's structured field, never the
 * sentence** (`docs/09` §3.4 rule 2, and §3.3's "Unverified" note on the
 * literal string): HTTP 404 **and** OpenRouter's error envelope
 * `{ error: { code } }` with `code` 404. Every chat request this adapter sends
 * carries a restriction (`data_collection: "deny"`), so a 404 on that path is
 * a routing refusal — unless the model itself is unknown, which the caller
 * rules out with `modelKnownAbsent` from its catalogue.
 *
 * @param status - the HTTP status
 * @param body - the answer body (already through `redactText` in the hook)
 * @param modelKnownAbsent - true when a fetched catalogue does not list the
 *   model, so the 404 means "no such model" instead
 * @returns whether to map it onto the guardrail explanation
 */
export function isGuardrailNotFound(
  status: number,
  body: string,
  modelKnownAbsent: boolean,
): boolean {
  if (status !== 404 || modelKnownAbsent) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(parsed) || !isRecord(parsed.error)) return false;
  const code = parsed.error.code;
  return code === 404 || code === "404";
}

/**
 * The `PrivacyRoutingError` for a guardrail 404, naming the cause and both
 * remedies (`docs/09` §3.4 rule 2).
 *
 * **What the user sees** is its `messageKey`, `rh-error-privacy-routing`,
 * formatted with `$model` (`context.modelId`): a user-facing
 * `BadRequestError` subclass (`docs/07` §10.1, owner, 2026-10-21,
 * `plan/00` §6 item 262(c)). Until that date this returned a plain
 * `BadRequestError`, which is `userFacing = false`, so the explanation
 * reached only the log. The English `message` below stays the
 * **developer** half, and the context's machine values — `cause`,
 * `remedies`, `restrictions` — stay for a surface that wants them.
 *
 * @param modelId - the model the request named
 * @param status - the HTTP status (404)
 * @param block - the `provider` block the request carried
 * @returns the error
 */
export function openRouterGuardrailError(
  modelId: string,
  status: number,
  block: OpenRouterProviderBlock,
): PrivacyRoutingError {
  const restrictions = [
    "data_collection: deny",
    ...(block.zdr === true ? ["zdr"] : []),
    ...(block.only !== undefined ? ["only"] : []),
    ...(block.ignore !== undefined ? ["ignore"] : []),
    ...(block.require_parameters === true ? ["require_parameters"] : []),
  ];
  const safeModel = redact(modelId);
  return new PrivacyRoutingError(
    status,
    `OpenRouter has no endpoint for ${safeModel} that satisfies this request's ` +
      `routing restrictions (${restrictions.join(", ")}). Either choose a ` +
      `different model, or relax the privacy setting in preferences (strict ` +
      `mode adds the zero-data-retention requirement; data_collection: deny is ` +
      `sent in every mode) — relaxing it lets the request reach endpoints ` +
      `that may retain or train on the content.`,
    {
      providerId: OPENROUTER_PROVIDER_ID,
      modelId: safeModel,
      cause: OPENROUTER_GUARDRAIL_CAUSE,
      remedies: [...OPENROUTER_GUARDRAIL_REMEDIES],
      restrictions,
    },
  );
}
