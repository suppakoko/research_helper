/**
 * Gemini's wire shapes: the request bodies this adapter sends and the answers
 * it reads, for both API surfaces.
 *
 * **Scope.** `P3-T10` steps 1–4 and 6. Pure functions only: nothing here sends
 * a request, reads a key or retries. `./geminiProvider.ts` is the only caller.
 *
 * **Authority.** `docs/03` §4.3–§4.5 (the Interactions API and the legacy
 * `generateContent` shape), §7.3 (structured output on each surface), §9.3
 * (the model list) and §14.2/§14.3 (the adapter sketch and the normalisation
 * rules). Types come from `docs/07` §4.3 through `../types.ts`, never from
 * `docs/03` §14.1's working sketch (`plan/README.md` §5 rule 3).
 *
 * **The two surfaces never share a serializer** (`docs/03` §4.5): the
 * Interactions API is snake_case (`system_instruction`, `generation_config`,
 * `max_output_tokens`), the legacy surface camelCase (`systemInstruction`,
 * `generationConfig`, `maxOutputTokens`), and a field spelt for the other one
 * is silently ignored. Each surface below has its own builder and its own
 * reader.
 *
 * ## Assumptions about shapes `docs/03` does not record
 *
 * Each is marked `ASSUMPTION` where it is made, and listed in
 * `plan/reports/P3-T10.md`:
 *
 * 1. A conversation of more than one non-system message is sent as `input`
 *    in `docs/03` §14.2's sketch shape, `{ role, parts: [{ text }] }`, with the
 *    role passed through. §4.3 documents only the plain-string `input` that a
 *    single user message uses.
 * 2. `responseFormat: { kind: "json" }` (no schema) is sent as
 *    `response_format: { type: "text", mime_type: "application/json" }`;
 *    §7.3 shows that object only with a `schema`.
 * 3. An interaction whose `status` is `incomplete` is read as a truncated
 *    answer (`finishReason: "length"`), as §14.2's sketch does.
 * 4. The model list's entries are under a top-level `models` array; §9.3
 *    names the entries' fields but not the envelope, nor any paging.
 * 5. Every listed model is marked as supporting JSON Schema output and
 *    streaming: §9.3's entries carry no capability flag for either, and §7.3
 *    and §6.3 describe both as features of the API surface.
 * 6. The Interactions API's answer when safety stops a reply is **not**
 *    recorded (`plan/reports/P3-T05.md`, Contradiction 9). Nothing here
 *    recognises one. A body that is not `completed` or `incomplete` is
 *    refused by {@link readInteraction} without reading its content, as §4.4
 *    says ("Check for `completed` before reading content").
 */

import { redact } from "../../core/errors";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Effort,
  ModelDataPolicy,
  ModelInfo,
  Usage,
} from "../types";

// ---------------------------------------------------------------------------
// 1. Small readers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(
  record: Record<string, unknown> | undefined,
  name: string,
): Record<string, unknown> | undefined {
  const value = record?.[name];
  return isRecord(value) ? value : undefined;
}

function arrayAt(
  record: Record<string, unknown> | undefined,
  name: string,
): readonly unknown[] {
  const value = record?.[name];
  return Array.isArray(value) ? value : [];
}

function stringAt(
  record: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = record?.[name];
  return typeof value === "string" ? value : undefined;
}

function countAt(
  record: Record<string, unknown> | undefined,
  name: string,
): number | undefined {
  const value = record?.[name];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Parse a response body as a JSON object, or `undefined` when it is not one.
 *
 * @param body - the response text
 * @returns the object, or `undefined`
 */
export function parseJsonObject(
  body: string,
): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 2. Effort → thinking_level (step 2)
// ---------------------------------------------------------------------------

// The shared effort scale is `Effort` in `../types.ts` (`docs/07` §4.3,
// owner, 2026-10-21, `plan/00` §6 item 262(a)); this file's local copy was
// removed that day. `ChatRequest.effort` reaches the wire as
// `generation_config.thinking_level` through {@link mapEffortToThinkingLevel}.

/** `generation_config.thinking_level`'s four values (`docs/03` §4.3). */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/**
 * Map the shared effort scale onto Gemini's four thinking levels.
 *
 * `xhigh` and `max` are **never forwarded** (`P3-T10` **Do NOT**): Gemini has
 * no such level and would answer 400 (§14.3). They map to `high`; `none` maps
 * to `minimal`, Gemini's lowest.
 *
 * @param effort - the shared effort level
 * @returns the thinking level to send
 */
export function mapEffortToThinkingLevel(effort: Effort): ThinkingLevel {
  switch (effort) {
    case "none":
    case "minimal":
      return "minimal";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
    case "max":
      return "high";
  }
}

// ---------------------------------------------------------------------------
// 3. The Interactions API (steps 1 and 3)
// ---------------------------------------------------------------------------

/** The system prompt: every `system` message, joined, or `undefined`. */
function systemText(messages: readonly ChatMessage[]): string | undefined {
  const parts = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content);
  return parts.length === 0 ? undefined : parts.join("\n\n");
}

function conversation(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.role !== "system");
}

/**
 * The `POST /v1beta/interactions` body for one request (`docs/03` §4.3).
 *
 * - `store: false` on **every** body: `docs/09` §3.3 lists the Interactions
 *   API without it among the things that break zero data retention.
 * - `system_instruction` carries the system messages; the model, never a key.
 * - `generation_config` carries only fields §4.3's list names:
 *   `max_output_tokens`, `seed`, `stop_sequences`, `thinking_level`.
 *   `temperature` and `topP` are **not** in that list and are not sent.
 * - `thinking_level` is `request.effort` through
 *   {@link mapEffortToThinkingLevel} (owner, 2026-10-21, `plan/00` §6 item
 *   262(a)); with no effort, none is sent and Gemini's own default applies.
 * - `traceId` and `routing` are never sent (§4.3: "never sent upstream";
 *   routing hints are OpenRouter's).
 * - No Context Caching, no File API, no Google Search grounding: each breaks
 *   ZDR (`docs/09` §3.3), and nothing here can produce them.
 *
 * @param request - the provider-agnostic request
 * @returns the JSON body, as an object
 */
export function buildInteractionBody(
  request: ChatRequest,
): Record<string, unknown> {
  const system = systemText(request.messages);
  const turns = conversation(request.messages);
  const generationConfig: Record<string, unknown> = {
    ...(request.maxOutputTokens !== undefined && {
      max_output_tokens: request.maxOutputTokens,
    }),
    ...(request.seed !== undefined && { seed: request.seed }),
    ...(request.stop !== undefined &&
      request.stop.length > 0 && { stop_sequences: [...request.stop] }),
    ...(request.effort !== undefined && {
      thinking_level: mapEffortToThinkingLevel(request.effort),
    }),
  };
  const single = turns.length === 1 && turns[0]?.role === "user";
  return {
    model: request.model,
    ...(system !== undefined && { system_instruction: system }),
    // §4.3 documents a plain string. ASSUMPTION 1 (module header): more than
    // one turn goes in §14.2's sketch shape.
    input: single
      ? turns[0]?.content
      : turns.map((message) => ({
          role: message.role,
          parts: [{ text: message.content }],
        })),
    ...(Object.keys(generationConfig).length > 0 && {
      generation_config: generationConfig,
    }),
    ...interactionResponseFormat(request),
    store: false,
  };
}

/** `response_format` per `docs/03` §7.3, or nothing for plain text. */
function interactionResponseFormat(
  request: ChatRequest,
): Record<string, unknown> {
  const format = request.responseFormat;
  if (format === undefined || format.kind === "text") return {};
  if (format.kind === "json") {
    // ASSUMPTION 2 (module header): §7.3 shows this object only with a schema.
    return {
      response_format: { type: "text", mime_type: "application/json" },
    };
  }
  return {
    response_format: {
      type: "text",
      mime_type: "application/json",
      // Lowercase JSON Schema types, as written: §7.3.
      schema: format.schema,
    },
  };
}

/** Why {@link readInteraction} refused a body. */
export interface InteractionRefusal {
  readonly refused: true;
  /** The interaction's `status`, redacted, or `"missing"`. */
  readonly status: string;
}

/** What {@link readInteraction} read from a usable body. */
export type InteractionReading = Omit<ChatResponse, "latencyMs" | "raw">;

/**
 * The text of every `model_output` step's `text` parts, in order
 * (`docs/03` §4.4: "Filter for `model_output`").
 */
function modelOutputText(raw: Record<string, unknown>): string {
  return arrayAt(raw, "steps")
    .filter(isRecord)
    .filter((step) => stringAt(step, "type") === "model_output")
    .flatMap((step) => arrayAt(step, "content"))
    .filter(isRecord)
    .filter((part) => stringAt(part, "type") === "text")
    .map((part) => stringAt(part, "text") ?? "")
    .join("");
}

/**
 * `usage`'s documented fields (`docs/03` §4.4) onto `docs/07` §5.1's `Usage`.
 *
 * `total_thought_tokens` has no `Usage` member and is not added to
 * `outputTokens`: §4.4 leaves open whether `total_output_tokens` already
 * includes it. Gemini reports no cost, so `costUsd` is `undefined`.
 */
function interactionUsage(raw: Record<string, unknown>): Usage {
  const usage = recordAt(raw, "usage");
  return {
    inputTokens: countAt(usage, "total_input_tokens"),
    outputTokens: countAt(usage, "total_output_tokens"),
    totalTokens: countAt(usage, "total_tokens"),
    costUsd: undefined,
  };
}

/** Parse `text` as JSON when the request asked for JSON; else `undefined`. */
function jsonOf(request: ChatRequest, text: string): unknown {
  const kind = request.responseFormat?.kind;
  if (kind !== "json" && kind !== "json_schema") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Validation and the repair prompt are `P3-T12`'s; an unparsable answer
    // is reported as "no JSON", not thrown here.
    return undefined;
  }
}

/**
 * Read one Interactions answer (`docs/03` §4.4).
 *
 * Content is read only when `status` is `completed` (`finishReason: "stop"`)
 * or `incomplete` (`"length"`, ASSUMPTION 3). Any other status —
 * `failed`, `cancelled`, `budget_exceeded`, `requires_action`, a still
 * running one, or none — is refused without reading content; the caller
 * turns the refusal into an `LLMError`.
 *
 * @param raw - the parsed answer
 * @param request - the request it answers
 * @returns the reading, or the refusal
 */
export function readInteraction(
  raw: Record<string, unknown>,
  request: ChatRequest,
): InteractionReading | InteractionRefusal {
  const status = stringAt(raw, "status");
  if (status !== "completed" && status !== "incomplete") {
    return {
      refused: true,
      status: status === undefined ? "missing" : redact(status),
    };
  }
  const text = modelOutputText(raw);
  return {
    text,
    json: jsonOf(request, text),
    model: stringAt(raw, "model") ?? request.model,
    finishReason: status === "completed" ? "stop" : "length",
    usage: interactionUsage(raw),
    servedBy: undefined,
  };
}

// ---------------------------------------------------------------------------
// 4. The legacy `generateContent` surface (step 6)
// ---------------------------------------------------------------------------

/**
 * A JSON Schema with lowercase types, as the legacy surface wants it:
 * uppercase OpenAPI type names (`OBJECT`, `STRING`, `ARRAY`), `docs/03` §7.3 —
 * "The adapter must own a schema translation step for the legacy path."
 *
 * Every string-valued `type` key is upper-cased, at every depth; nothing
 * else changes. A property *named* `type` has an object value and is walked
 * into, not upper-cased.
 *
 * @param schema - a JSON Schema
 * @returns a translated copy; `schema` is not touched
 */
export function toOpenApiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toOpenApiSchema);
  if (!isRecord(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(schema)) {
    out[name] =
      name === "type" && typeof value === "string"
        ? value.toUpperCase()
        : toOpenApiSchema(value);
  }
  return out;
}

/**
 * The legacy `POST /v1beta/models/{model}:generateContent` body
 * (`docs/03` §4.5, camelCase throughout).
 *
 * `assistant` turns are sent with role `model`, the role the legacy surface
 * answers with (`docs/04` §2.4's response). The model id goes in the URL, not
 * the body. There is no `store` field on this surface.
 *
 * @param request - the provider-agnostic request
 * @returns the JSON body, as an object
 */
export function buildGenerateContentBody(
  request: ChatRequest,
): Record<string, unknown> {
  const system = systemText(request.messages);
  const format = request.responseFormat;
  const generationConfig: Record<string, unknown> = {
    ...(request.maxOutputTokens !== undefined && {
      maxOutputTokens: request.maxOutputTokens,
    }),
    ...(request.temperature !== undefined && {
      temperature: request.temperature,
    }),
    ...(format !== undefined &&
      format.kind !== "text" && { responseMimeType: "application/json" }),
    ...(format?.kind === "json_schema" && {
      responseSchema: toOpenApiSchema(format.schema),
    }),
  };
  return {
    ...(system !== undefined && {
      systemInstruction: { parts: [{ text: system }] },
    }),
    contents: conversation(request.messages).map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
  };
}

/**
 * Read one legacy answer: `candidates[0].content.parts[].text` and
 * `usageMetadata` (`docs/03` §4.4's notes and §6.3; `docs/04` §2.4 shows the
 * full envelope, `totalTokenCount` included).
 *
 * A blocked answer (`finishReason: SAFETY`, `promptFeedback.blockReason`) is
 * not read here: the caller runs `mapProviderError` on every 2xx first, which
 * recognises those fields.
 *
 * @param raw - the parsed answer
 * @param request - the request it answers
 * @returns the reading
 */
export function readGenerateContent(
  raw: Record<string, unknown>,
  request: ChatRequest,
): InteractionReading {
  const candidate = arrayAt(raw, "candidates").filter(isRecord)[0];
  const text = arrayAt(recordAt(candidate, "content"), "parts")
    .filter(isRecord)
    .map((part) => stringAt(part, "text") ?? "")
    .join("");
  const finish = stringAt(candidate, "finishReason");
  const usage = recordAt(raw, "usageMetadata");
  return {
    text,
    json: jsonOf(request, text),
    model: request.model,
    finishReason:
      finish === "STOP" ? "stop" : finish === "MAX_TOKENS" ? "length" : "other",
    usage: {
      inputTokens: countAt(usage, "promptTokenCount"),
      outputTokens: countAt(usage, "candidatesTokenCount"),
      totalTokens: countAt(usage, "totalTokenCount"),
      costUsd: undefined,
    },
    servedBy: undefined,
  };
}

// ---------------------------------------------------------------------------
// 5. The model list (step 4)
// ---------------------------------------------------------------------------

/** The `name` prefix §9.3 says to strip. */
export const GEMINI_MODEL_PREFIX = "models/";

/** The generation method §9.3 filters on. */
export const CHAT_GENERATION_METHOD = "generateContent";

/**
 * A TTS model's id, `docs/04` §2.2 ("filter for IDs matching `/-tts/`").
 *
 * Needed beside §9.3's method filter because TTS is itself served through
 * `generateContent` (`docs/04` §2.1, §2.3), so a TTS-only model passes that
 * filter (`plan/reports/P3-T10.md`, Contradictions).
 */
export const TTS_MODEL_ID = /-tts\b/;

/**
 * What the plugin records about Gemini's data handling, per tier
 * (`docs/09` §3.3). Retention is 55 days on both tiers by default; what
 * differs is training and human review.
 */
function geminiDataPolicy(tier: "paid" | "free-or-unknown"): ModelDataPolicy {
  return tier === "paid"
    ? {
        trainsOnInputByDefault: "no",
        retention: {
          days: 55,
          note: "Paid tier: logged 55 days for abuse detection only (docs/09 §3.3).",
        },
        policyUrl: "https://ai.google.dev/gemini-api/terms",
      }
    : {
        trainsOnInputByDefault: "yes",
        retention: {
          days: 55,
          note:
            "Free or unknown tier: Google may use inputs and outputs to improve " +
            "its products, and human reviewers may read them (docs/09 §3.3).",
        },
        policyUrl: "https://ai.google.dev/gemini-api/terms",
      };
}

/**
 * Read `GET /v1beta/models` (`docs/03` §9.3) into `docs/07` §4.3's
 * `ModelInfo`.
 *
 * - Only entries whose `supportedGenerationMethods` contains
 *   `generateContent`, which drops embedding-only models (§9.3).
 * - Not TTS-only entries, by {@link TTS_MODEL_ID} (`docs/04` §2.2).
 * - `models/` stripped from `name`; an entry without a `name` or without a
 *   numeric `inputTokenLimit` and `outputTokenLimit` is skipped rather than
 *   given made-up limits.
 * - No price: §9.3, "Pricing is not exposed", and `plan/README.md` §5 rule 4
 *   forbids hardcoding one.
 * - `dataPolicy` follows the tier; an unknown tier is the free tier
 *   (`docs/09` §3.4 rule 4).
 *
 * @param raw - the parsed answer
 * @param tier - the key's tier, from `./tierDetect.ts`
 * @returns the chat-capable models
 */
export function readModelList(
  raw: Record<string, unknown>,
  tier: "paid" | "free-or-unknown",
): ModelInfo[] {
  const policy = geminiDataPolicy(tier);
  const out: ModelInfo[] = [];
  // ASSUMPTION 4 (module header): the `models` envelope.
  for (const entry of arrayAt(raw, "models").filter(isRecord)) {
    const name = stringAt(entry, "name");
    const methods = arrayAt(entry, "supportedGenerationMethods");
    const input = countAt(entry, "inputTokenLimit");
    const output = countAt(entry, "outputTokenLimit");
    if (name === undefined || input === undefined || output === undefined) {
      continue;
    }
    if (!methods.includes(CHAT_GENERATION_METHOD)) continue;
    const id = name.startsWith(GEMINI_MODEL_PREFIX)
      ? name.slice(GEMINI_MODEL_PREFIX.length)
      : name;
    if (id === "" || TTS_MODEL_ID.test(id)) continue;
    out.push({
      id,
      displayName: stringAt(entry, "displayName") ?? id,
      contextWindowTokens: input,
      maxOutputTokens: output,
      // ASSUMPTION 5 (module header).
      supportsJsonSchema: true,
      supportsStreaming: true,
      supportsSystemPrompt: true,
      inputCostPerMTokUsd: undefined,
      outputCostPerMTokUsd: undefined,
      dataPolicy: policy,
    });
  }
  return out;
}
