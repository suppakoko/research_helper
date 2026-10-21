import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerProviders } from "../../../src/bootstrap/registerProviders";
import type { Clock } from "../../../src/core/clock";
import {
  AuthenticationError,
  ConfigurationError,
  ContentFilterError,
  LLMError,
  MissingCredentialError,
  OperationCancelledError,
  QuotaExceededError,
  RateLimitError,
  type ResearchHelperError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { retryPolicyFromBudget } from "../../../src/core/http/retry";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import {
  LLM_ATTEMPT_TIMEOUT_MS,
  LLM_RETRY_BUDGET,
} from "../../../src/core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../../src/core/secretStore";
import {
  ANTHROPIC_HOST,
  ANTHROPIC_SECRET_ID,
  createAnthropicProvider,
  type AnthropicProvider,
} from "../../../src/llm/anthropic/anthropicProvider";
import {
  ANTHROPIC_VERSION,
  toMessagesBody,
  toUsage,
} from "../../../src/llm/anthropic/mapper";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import { ANTHROPIC_SPEND_CAP_CODE } from "../../../src/llm/shared/errorMap";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type {
  ChatRequest,
  Effort,
  LLMCallContext,
  LLMProvider,
} from "../../../src/llm/types";
import { mockSettings } from "../../helpers/mockLLM";

/**
 * `P3-T09`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no
 * real time, and no real key.
 *
 * **Every response body below is SYNTHETIC** — hand-built from the shapes
 * `docs/03` §3.4, §7.2, §9.2, §10.1 and §11.1 print (the `count_tokens`
 * answer and the list envelope's `data` / `after_id` from the bundled
 * Anthropic API reference, as `src/llm/anthropic/mapper.ts`'s header says).
 * None is a recorded live response: no live call may be made for this card
 * (`plan/04` §0.2 item 6), and recorded fixtures are `P3-T30`'s, under the
 * owner's gate with a stated spend.
 *
 * **The key is synthetic too, and built at run time**, so no key-shaped
 * literal sits in the source. It carries Anthropic's `sk-ant-` prefix so the
 * redactor's vendor pattern is exercised, not only the catch-all.
 */

const SYNTHETIC_KEY = [
  "sk",
  "ant",
  "api03",
  `SYNTHETIC${"0".repeat(12)}${String(1234567890 * 7)}notakey`,
].join("-");

const BASE = "https://api.anthropic.com";
const MODEL = "claude-sonnet-5";
const UA =
  "research_helper/9.9.9 (https://example.test; mailto:x@example.test)";
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

// ---------------------------------------------------------------------------
// Fakes: transport, clock, keystore, logger
// ---------------------------------------------------------------------------

interface Answer {
  readonly status: number;
  readonly body?: string;
  readonly headers?: string;
}

interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly options: HttpTransportOptions;
}

class StubZoteroException extends Error {}

/** A transport that answers call `i` with `answers[i]` (the last repeats) and records each request. */
function scriptedTransport(
  answers: readonly Answer[],
): HttpTransport & { readonly sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  return {
    sent,
    request(method, url, options) {
      const answer = answers[Math.min(sent.length, answers.length - 1)];
      sent.push({ method, url, options });
      const xhr: HttpTransportXhr = {
        status: answer?.status ?? 0,
        responseText: answer?.body ?? "",
        responseURL: url,
        getAllResponseHeaders: () => answer?.headers ?? "",
      };
      return Promise.resolve(xhr);
    },
    UnexpectedStatusException:
      StubZoteroException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: StubZoteroException,
    BrowserOfflineException: StubZoteroException,
    SecurityException: StubZoteroException,
    CancelledException: StubZoteroException,
  };
}

/** A clock whose waits return at once and are recorded. */
function recordingClock(): Clock & { readonly slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    now: () => NOW,
    sleep: (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

/** An in-memory `SecretStore` that counts its reads. */
function memoryStore(
  initial: string | undefined,
): SecretStore & { gets: number; value: string | undefined } {
  const store = {
    backend: "os-keychain" as const,
    unattended: true,
    gets: 0,
    value: initial,
    get(id: SecretId) {
      store.gets += 1;
      return Promise.resolve(
        id === ANTHROPIC_SECRET_ID ? store.value : undefined,
      );
    },
    set(_id: SecretId, value: string) {
      store.value = value;
      return Promise.resolve();
    },
    clear() {
      store.value = undefined;
      return Promise.resolve();
    },
    has(id: SecretId) {
      return Promise.resolve(
        id === ANTHROPIC_SECRET_ID && store.value !== undefined,
      );
    },
    listStoredIds() {
      return Promise.resolve(
        store.value === undefined ? [] : [ANTHROPIC_SECRET_ID],
      );
    },
    clearAll() {
      const had = store.value === undefined ? 0 : 1;
      store.value = undefined;
      return Promise.resolve(had);
    },
  };
  return store;
}

/** A logger that keeps every line **unredacted**, so the adapter's own redaction is what is tested. */
function capturingLogger(): Logger & { readonly lines: unknown[] } {
  const lines: unknown[] = [];
  const logger: Logger & { readonly lines: unknown[] } = {
    lines,
    child: () => logger,
    error: (msg, ctx) => lines.push({ msg, ctx }),
    warn: (msg, ctx) => lines.push({ msg, ctx }),
    info: (msg, ctx) => lines.push({ msg, ctx }),
    debug: (msg, ctx) => lines.push({ msg, ctx }),
    time: (_msg, fn) => fn(),
  };
  return logger;
}

interface Harness {
  readonly provider: AnthropicProvider;
  readonly transport: ReturnType<typeof scriptedTransport>;
  readonly clock: ReturnType<typeof recordingClock>;
  readonly store: ReturnType<typeof memoryStore>;
  readonly logger: ReturnType<typeof capturingLogger>;
}

/**
 * The adapter over a **real** `createHttpClient`, with the LLM rows' retry
 * budget for the host — exactly what `createRetryFor` builds from a row
 * carrying `retry: LLM_RETRY_BUDGET` — and a fake transport.
 */
function harness(
  answers: readonly Answer[],
  options: { key?: string | undefined; noStore?: boolean } = {},
): Harness {
  const transport = scriptedTransport(answers);
  const clock = recordingClock();
  const store = memoryStore("key" in options ? options.key : SYNTHETIC_KEY);
  const logger = capturingLogger();
  const http = createHttpClient({
    transport,
    userAgent: UA,
    clock,
    retryFor: () => retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 0),
  });
  const provider = createAnthropicProvider({
    secrets: options.noStore === true ? undefined : store,
    baseUrls: createBaseUrlResolver({ override: () => "" }),
    http,
    clock,
    logger,
  });
  return { provider, transport, clock, store, logger };
}

function ctx(): LLMCallContext {
  return { token: createCancellationTokenSource().token };
}

function request(extra: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: MODEL,
    messages: [
      {
        role: "system",
        content: "You are a biomedical literature summarizer.",
      },
      { role: "user", content: "Summarize this abstract in 3 sentences." },
    ],
    maxOutputTokens: 512,
    traceId: "trace-must-not-leave",
    ...extra,
  };
}

function sentBody(sent: SentRequest | undefined): unknown {
  return JSON.parse(sent?.options.body ?? "null") as unknown;
}

// ---------------------------------------------------------------------------
// SYNTHETIC bodies, docs/03 §3.4, §7.2, §9.2, §10.1, §11.1
// ---------------------------------------------------------------------------

function messageBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: MODEL,
    content: [{ type: "text", text: "This randomized trial found ..." }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 412,
      output_tokens: 118,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...extra,
  });
}

function anthropicError(
  type: string,
  details?: Record<string, unknown>,
): string {
  return JSON.stringify({
    type: "error",
    error: { type, message: "synthetic", ...(details && { details }) },
  });
}

function modelObject(
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "model",
    id,
    display_name: `Display ${id}`,
    created_at: "2026-03-01T00:00:00Z",
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
    capabilities: { structured_outputs: { supported: true } },
    ...extra,
  };
}

function modelsPage(
  data: readonly Record<string, unknown>[],
  hasMore: boolean,
): string {
  return JSON.stringify({
    data,
    has_more: hasMore,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  });
}

const OK = (body: string): Answer => ({ status: 200, body });

// ---------------------------------------------------------------------------
// Wire shape — docs/03 §3.2, §3.3, §7.2
// ---------------------------------------------------------------------------

describe("the Messages request on the wire (docs/03 §3.2–§3.3)", () => {
  it("puts system at the top level and always sends max_tokens (snapshot)", async () => {
    const { provider, transport } = harness([OK(messageBody())]);

    await provider.chat(request(), ctx());

    expect(transport.sent).toHaveLength(1);
    const [sent] = transport.sent;
    expect(sent?.method).toBe("POST");
    expect(sent?.url).toBe(`${BASE}/v1/messages`);
    expect(sentBody(sent)).toStrictEqual({
      model: MODEL,
      max_tokens: 512,
      system: "You are a biomedical literature summarizer.",
      messages: [
        { role: "user", content: "Summarize this abstract in 3 sentences." },
      ],
    });
  });

  it("sends docs/03 §3.2's four headers, the key only as x-api-key", async () => {
    const { provider, transport } = harness([OK(messageBody())]);

    await provider.chat(request(), ctx());

    const headers = transport.sent[0]?.options.headers ?? {};
    expect(headers["x-api-key"]).toBe(SYNTHETIC_KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(ANTHROPIC_VERSION).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers.Authorization).toBeUndefined();
    expect(transport.sent[0]?.url).not.toContain(SYNTHETIC_KEY);
    expect(transport.sent[0]?.options.body).not.toContain(SYNTHETIC_KEY);
  });

  it("sends no system message, no context_window, no sampling field and no trace id", async () => {
    const { provider, transport } = harness([OK(messageBody())]);

    await provider.chat(
      request({ temperature: 0.2, topP: 0.9, seed: 7, stop: ["###"] }),
      ctx(),
    );

    const body = sentBody(transport.sent[0]) as Record<string, unknown>;
    const messages = body.messages as { role: string }[];
    expect(messages.every((m) => m.role !== "system")).toBe(true);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("seed");
    expect(body).not.toHaveProperty("output_format");
    expect(body.stop_sequences).toStrictEqual(["###"]);
    expect(transport.sent[0]?.options.body).not.toContain(
      "trace-must-not-leave",
    );
  });

  it("lifts every system message, in order, into one top-level system", async () => {
    const { provider, transport } = harness([OK(messageBody())]);

    await provider.chat(
      request({
        messages: [
          { role: "system", content: "Rubric." },
          { role: "user", content: "Paper." },
          { role: "system", content: "Answer in English." },
        ],
      }),
      ctx(),
    );

    const body = sentBody(transport.sent[0]) as Record<string, unknown>;
    expect(body.system).toBe("Rubric.\n\nAnswer in English.");
    expect(body.messages).toStrictEqual([{ role: "user", content: "Paper." }]);
  });

  it("passes the 3-minute LLM attempt timeout to the transport", async () => {
    const { provider, transport } = harness([OK(messageBody())]);

    await provider.chat(request(), ctx());

    expect(transport.sent[0]?.options.timeout).toBe(LLM_ATTEMPT_TIMEOUT_MS);
    expect(LLM_ATTEMPT_TIMEOUT_MS).toBe(180_000);
  });

  it("uses a valid base-URL override, joining the path without doubling it", async () => {
    const transport = scriptedTransport([OK(messageBody())]);
    const clock = recordingClock();
    const provider = createAnthropicProvider({
      secrets: memoryStore(SYNTHETIC_KEY),
      baseUrls: createBaseUrlResolver({
        override: () => "https://gateway.example.test/anthropic/",
      }),
      http: createHttpClient({ transport, userAgent: UA, clock }),
      clock,
    });

    await provider.chat(request(), ctx());

    expect(transport.sent[0]?.url).toBe(
      "https://gateway.example.test/anthropic/v1/messages",
    );
  });
});

describe("max_tokens is never omitted and never invented (docs/03 §3.3, §14.3)", () => {
  it("refuses a request with no max_tokens and no catalogue entry, before reading the key or sending", async () => {
    const { provider, transport, store } = harness([OK(messageBody())]);
    const getsBefore = store.gets;

    const { maxOutputTokens: _omitted, ...withoutMax } = request();
    const error = await provider
      .chat(withoutMax, ctx())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConfigurationError);
    expect(transport.sent).toHaveLength(0);
    expect(store.gets).toBe(getsBefore);
  });

  it("clamps to the catalogue's output cap, and uses the cap when the request has none", async () => {
    const { provider, transport } = harness([
      OK(modelsPage([modelObject(MODEL, { max_tokens: 1000 })], false)),
      OK(messageBody()),
    ]);
    await provider.listModels(ctx());

    await provider.chat(request({ maxOutputTokens: 5000 }), ctx());
    const { maxOutputTokens: _omitted, ...withoutMax } = request();
    await provider.chat(withoutMax, ctx());

    expect(
      (sentBody(transport.sent[1]) as { max_tokens: number }).max_tokens,
    ).toBe(1000);
    expect(
      (sentBody(transport.sent[2]) as { max_tokens: number }).max_tokens,
    ).toBe(1000);
  });
});

describe("structured output (docs/03 §7.2)", () => {
  const SCHEMA = {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
    additionalProperties: false,
  };
  const schemaRequest = request({
    responseFormat: {
      kind: "json_schema",
      name: "paper_summary",
      schema: SCHEMA,
    },
  });

  it("sends output_config.format, never output_format, and parses the JSON text block", async () => {
    const { provider, transport } = harness([
      OK(
        messageBody({
          content: [{ type: "text", text: '{"summary":"It worked."}' }],
        }),
      ),
    ]);

    const answer = await provider.chat(schemaRequest, ctx());

    const body = sentBody(transport.sent[0]) as Record<string, unknown>;
    expect(body.output_config).toStrictEqual({
      format: { type: "json_schema", schema: SCHEMA },
    });
    expect(body).not.toHaveProperty("output_format");
    expect(body).not.toHaveProperty("tools");
    expect(answer.json).toStrictEqual({ summary: "It worked." });
  });

  it("leaves json undefined for an answer that does not parse, for the repair path", async () => {
    const { provider } = harness([
      OK(messageBody({ content: [{ type: "text", text: "not json" }] })),
    ]);

    const answer = await provider.chat(schemaRequest, ctx());

    expect(answer.text).toBe("not json");
    expect(answer.json).toBeUndefined();
  });

  it("falls back to one strict tool when the catalogue says the model lacks structured outputs", async () => {
    const { provider, transport } = harness([
      OK(
        modelsPage(
          [
            modelObject(MODEL, {
              capabilities: { structured_outputs: { supported: false } },
            }),
          ],
          false,
        ),
      ),
      OK(
        messageBody({
          content: [
            {
              type: "tool_use",
              id: "toolu_synthetic",
              name: "paper_summary",
              input: { summary: "Via the tool." },
            },
          ],
          stop_reason: "tool_use",
        }),
      ),
    ]);
    await provider.listModels(ctx());

    const answer = await provider.chat(schemaRequest, ctx());

    const body = sentBody(transport.sent[1]) as Record<string, unknown>;
    expect(body).not.toHaveProperty("output_config");
    expect(body.tools).toStrictEqual([
      { name: "paper_summary", input_schema: SCHEMA, strict: true },
    ]);
    expect(body.tool_choice).toStrictEqual({
      type: "tool",
      name: "paper_summary",
    });
    expect(answer.json).toStrictEqual({ summary: "Via the tool." });
    expect(answer.finishReason).toBe("stop");
  });
});

// ---------------------------------------------------------------------------
// Effort — docs/03 §3.6, §14.2; owner, 2026-10-21, plan/00 §6 item 262(a)
// ---------------------------------------------------------------------------

describe("ChatRequest.effort as output_config.effort (docs/03 §3.6, item 262)", () => {
  const SCHEMA = { type: "object", properties: { s: { type: "string" } } };

  it("folds none and minimal to low, passes the other five through, and adds nothing without an effort", () => {
    const expected: Record<Effort, string> = {
      none: "low",
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    };
    for (const [effort, level] of Object.entries(expected)) {
      const body = toMessagesBody(
        request({ effort: effort as Effort }),
        512,
        "output_config",
      );
      expect(body.output_config, effort).toStrictEqual({ effort: level });
      expect(body, effort).not.toHaveProperty("thinking");
    }
    const plain = toMessagesBody(request(), 512, "output_config");
    expect(plain).not.toHaveProperty("output_config");
    expect(JSON.stringify(plain)).not.toContain("effort");
  });

  it("sends it on the wire, beside output_config.format under a schema and beside the strict tool", async () => {
    const schemaRequest = request({
      effort: "minimal",
      responseFormat: { kind: "json_schema", name: "s", schema: SCHEMA },
    });
    const { provider, transport } = harness([
      OK(messageBody()),
      OK(messageBody({ content: [{ type: "text", text: '{"s":"x"}' }] })),
    ]);

    await provider.chat(request({ effort: "low" }), ctx());
    await provider.chat(schemaRequest, ctx());

    const plain = sentBody(transport.sent[0]) as Record<string, unknown>;
    expect(plain.output_config).toStrictEqual({ effort: "low" });
    expect(plain).not.toHaveProperty("thinking");
    const structured = sentBody(transport.sent[1]) as Record<string, unknown>;
    expect(structured.output_config).toStrictEqual({
      format: { type: "json_schema", schema: SCHEMA },
      effort: "low",
    });
    // The strict-tool fallback carries no format, so effort stands alone.
    expect(
      toMessagesBody(schemaRequest, 512, "strict_tool").output_config,
    ).toStrictEqual({ effort: "low" });
  });

  it("sends no effort to the exact counter: docs/03 §10.1 documents none", async () => {
    const { provider, transport } = harness([OK('{"input_tokens":7}')]);

    await provider.countTokensExact(request({ effort: "high" }), ctx());

    expect(JSON.stringify(sentBody(transport.sent[0]))).not.toContain("effort");
  });
});

// ---------------------------------------------------------------------------
// Response — docs/03 §3.4, §14.3
// ---------------------------------------------------------------------------

describe("the Messages answer (docs/03 §3.4, §14.3)", () => {
  it("joins the text blocks, skips a thinking block, and maps end_turn to stop", async () => {
    const { provider } = harness([
      OK(
        messageBody({
          content: [
            { type: "thinking", thinking: "", signature: "sig" },
            { type: "text", text: "First. " },
            { type: "text", text: "Second." },
          ],
        }),
      ),
    ]);

    const answer = await provider.chat(request(), ctx());

    expect(answer.text).toBe("First. Second.");
    expect(answer.finishReason).toBe("stop");
    expect(answer.model).toBe(MODEL);
    expect(answer.servedBy).toBeUndefined();
    expect(answer.json).toBeUndefined();
  });

  it("maps max_tokens to length: truncation arrives as HTTP 200", async () => {
    const { provider } = harness([
      OK(messageBody({ stop_reason: "max_tokens" })),
    ]);

    const answer = await provider.chat(request(), ctx());

    expect(answer.finishReason).toBe("length");
  });

  it("sums the cache fields: total input is greater than input_tokens", async () => {
    const { provider } = harness([
      OK(
        messageBody({
          usage: {
            input_tokens: 412,
            output_tokens: 118,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 1500,
          },
        }),
      ),
    ]);

    const { usage } = await provider.chat(request(), ctx());

    expect(usage.inputTokens).toBe(412 + 100 + 1500);
    expect(usage.inputTokens).toBeGreaterThan(412);
    expect(usage.outputTokens).toBe(118);
    expect(usage.totalTokens).toBe(412 + 100 + 1500 + 118);
    expect(usage.costUsd).toBeUndefined();
  });

  it("counts an absent cache field as zero, and an absent input_tokens as unknown", () => {
    expect(toUsage({ input_tokens: 10, output_tokens: 2 }).inputTokens).toBe(
      10,
    );
    expect(toUsage({ output_tokens: 2 }).inputTokens).toBeUndefined();
    expect(toUsage({ output_tokens: 2 }).totalTokens).toBeUndefined();
  });

  it("throws ContentFilterError for an HTTP-200 refusal, and does not read content", async () => {
    const { provider, transport } = harness([
      OK(
        messageBody({
          content: [],
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "bio" },
        }),
      ),
    ]);

    const error = await provider
      .chat(request(), ctx())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ContentFilterError);
    expect((error as ResearchHelperError).retryable).toBe(false);
    expect(transport.sent).toHaveLength(1);
  });

  it("throws LLMError for a 2xx body that is not JSON, without copying the body", async () => {
    const { provider } = harness([
      OK("<html>proxy page with user text</html>"),
    ]);

    const error = await provider
      .chat(request(), ctx())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LLMError);
    expect(JSON.stringify((error as LLMError).toSerialized())).not.toContain(
      "user text",
    );
  });
});

// ---------------------------------------------------------------------------
// The showcase: docs/03 §11.5 traps 1 and 3, through the real client
// ---------------------------------------------------------------------------

describe("the spend-cap 429 and the 529 overload, through the real HTTP client (docs/03 §11.5)", () => {
  const SPEND_CAP = anthropicError("rate_limit_error", {
    error_code: ANTHROPIC_SPEND_CAP_CODE,
  });
  const OVERLOADED = anthropicError("overloaded_error");

  it("ends a spend-cap 429 after one attempt as QuotaExceededError, with five attempts allowed", async () => {
    const { provider, transport, clock } = harness([
      { status: 429, body: SPEND_CAP },
    ]);

    const error = await provider
      .chat(request(), ctx())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuotaExceededError);
    expect((error as QuotaExceededError).messageKey).toBe("rh-error-quota");
    expect((error as QuotaExceededError).retryable).toBe(false);
    expect(LLM_RETRY_BUDGET.maxAttempts).toBe(5);
    expect(transport.sent).toHaveLength(1);
    expect(clock.slept).toStrictEqual([]);
  });

  it("does not retry the spend cap from the exact counter either: one call, then the heuristic", async () => {
    const { provider, transport } = harness([{ status: 429, body: SPEND_CAP }]);

    const counted = await provider.countTokensExact(request(), ctx());

    expect(transport.sent).toHaveLength(1);
    expect(counted).toBe(
      estTokens(
        request()
          .messages.map((m) => m.content)
          .join(""),
      ),
    );
  });

  it("still retries an ordinary 429 as a RateLimitError, honouring Retry-After", async () => {
    const { provider, transport, clock } = harness([
      {
        status: 429,
        body: anthropicError("rate_limit_error"),
        headers: "retry-after: 7\r\n",
      },
      OK(messageBody()),
    ]);

    const answer = await provider.chat(request(), ctx());

    expect(answer.text).toContain("randomized");
    expect(transport.sent).toHaveLength(2);
    expect(clock.slept).toStrictEqual([7000]);
  });

  it("retries a 529 overload as a retryable UpstreamServerError and recovers", async () => {
    const { provider, transport } = harness([
      { status: 529, body: OVERLOADED },
      { status: 529, body: OVERLOADED },
      OK(messageBody()),
    ]);

    const answer = await provider.chat(request(), ctx());

    expect(answer.finishReason).toBe("stop");
    expect(transport.sent).toHaveLength(3);
  });

  it("gives up on a 529 after the five attempts, marked as overload", async () => {
    const { provider, transport, clock } = harness([
      { status: 529, body: OVERLOADED },
    ]);

    const error = (await provider
      .chat(request(), ctx())
      .catch((e: unknown) => e)) as ResearchHelperError;

    expect(error).toBeInstanceOf(UpstreamServerError);
    expect(error.retryable).toBe(true);
    expect(error.context.overloaded).toBe(true);
    expect(error.context.providerId).toBe("anthropic");
    expect(transport.sent).toHaveLength(LLM_RETRY_BUDGET.maxAttempts);
    expect(clock.slept).toHaveLength(LLM_RETRY_BUDGET.maxAttempts - 1);
  });

  it("keeps the synthetic key out of every error and every log line", async () => {
    const { provider, logger } = harness([{ status: 429, body: SPEND_CAP }]);

    const error = (await provider
      .chat(request(), ctx())
      .catch((e: unknown) => e)) as ResearchHelperError;

    const everything = [
      error.message,
      JSON.stringify(error.context),
      error.stack ?? "",
      JSON.stringify(error.toSerialized()),
      JSON.stringify(logger.lines),
    ].join(" ");
    expect(everything).not.toContain(SYNTHETIC_KEY);
    expect(everything).not.toContain("sk-ant-api03");
  });
});

// ---------------------------------------------------------------------------
// The key — D5, docs/09 §2.1
// ---------------------------------------------------------------------------

describe("the key: keystore only, wrapped, exposed once (D5, docs/09 §2.1)", () => {
  it("throws MissingCredentialError and sends nothing when the keystore has no key", async () => {
    const { provider, transport } = harness([OK(messageBody())], {
      key: undefined,
    });

    const error = await provider
      .chat(request(), ctx())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MissingCredentialError);
    expect(transport.sent).toHaveLength(0);
  });

  it("is not configured without a keystore, and follows the keystore's answer", async () => {
    const without = harness([OK(messageBody())], { noStore: true });
    expect(without.provider.isConfigured()).toBe(false);
    await expect(
      without.provider.chat(request(), ctx()),
    ).rejects.toBeInstanceOf(MissingCredentialError);

    const { provider, store } = harness([OK(messageBody())], {
      key: undefined,
    });
    await provider.refreshKeyPresence();
    expect(provider.isConfigured()).toBe(false);

    store.value = SYNTHETIC_KEY;
    await expect(provider.refreshKeyPresence()).resolves.toBe(true);
    expect(provider.isConfigured()).toBe(true);
  });

  it("learns that a key was removed from the keystore when the next call reads it", async () => {
    const { provider, store } = harness([OK(messageBody())]);
    await provider.refreshKeyPresence();
    expect(provider.isConfigured()).toBe(true);

    store.value = undefined;
    await expect(provider.chat(request(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(provider.isConfigured()).toBe(false);
  });

  it("logs the request headers only through loggableHeaders", async () => {
    const { provider, logger } = harness([OK(messageBody())]);

    await provider.chat(request(), ctx());

    const logged = JSON.stringify(logger.lines);
    expect(logged).toContain(`[redacted:${SYNTHETIC_KEY.length}]`);
    expect(logged).toContain("anthropic-version");
    expect(logged).not.toContain(SYNTHETIC_KEY);
  });

  it("calls Secret.expose() in exactly one place in the adapter's source", () => {
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../src/llm/anthropic",
    );
    const sources = ["anthropicProvider.ts", "mapper.ts"].map((file) =>
      readFileSync(join(dir, file), "utf8"),
    );
    const calls = sources.join("\n").match(/\.expose\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Token counts — docs/03 §10.1, §10.2
// ---------------------------------------------------------------------------

describe("token counts (docs/03 §10.1–§10.2)", () => {
  it("countTokens is synchronous and is the one heuristic", () => {
    const { provider } = harness([OK(messageBody())]);
    const text = "Background: a randomized trial of 120 patients.";

    const counted = provider.countTokens(text, MODEL);

    expect(typeof counted).toBe("number");
    expect(counted).toBe(estTokens(text));
  });

  it("lets a stub LLMProvider compile with no exact-count member", () => {
    // Compile-time: the exact counter is not a member of the interface.
    type HasExact = "countTokensExact" extends keyof LLMProvider ? true : false;
    const hasExact: HasExact = false;
    const stub: LLMProvider = {
      id: "anthropic",
      displayNameKey: "x",
      rateLimitKey: ANTHROPIC_HOST,
      isConfigured: () => false,
      validateCredentials: () =>
        Promise.resolve({ ok: false, messageKey: "x" }),
      listModels: () => Promise.resolve([]),
      getModel: () => undefined,
      chat: () => Promise.reject(new Error("stub")),
      countTokens: () => 0,
    };
    expect(hasExact).toBe(false);
    expect(stub.countTokens("abc", MODEL)).toBe(0);
  });

  it("the private exact counter returns the count_tokens answer", async () => {
    const { provider, transport } = harness([OK('{"input_tokens":1234}')]);

    const counted = await provider.countTokensExact(request(), ctx());

    expect(counted).toBe(1234);
    const [sent] = transport.sent;
    expect(sent?.method).toBe("POST");
    expect(sent?.url).toBe(`${BASE}/v1/messages/count_tokens`);
    expect(sentBody(sent)).toStrictEqual({
      model: MODEL,
      system: "You are a biomedical literature summarizer.",
      messages: [
        { role: "user", content: "Summarize this abstract in 3 sentences." },
      ],
    });
  });

  it("falls back to the heuristic on a stubbed failure: HTTP 400, a body that is not a count, no key", async () => {
    const heuristic = estTokens(
      request()
        .messages.map((m) => m.content)
        .join(""),
    );

    const bad = harness([
      { status: 400, body: anthropicError("invalid_request_error") },
    ]);
    await expect(bad.provider.countTokensExact(request(), ctx())).resolves.toBe(
      heuristic,
    );

    const odd = harness([OK('{"tokens":5}')]);
    await expect(odd.provider.countTokensExact(request(), ctx())).resolves.toBe(
      heuristic,
    );

    const keyless = harness([OK('{"input_tokens":1}')], { key: undefined });
    await expect(
      keyless.provider.countTokensExact(request(), ctx()),
    ).resolves.toBe(heuristic);
    expect(keyless.transport.sent).toHaveLength(0);
  });

  it("still throws OperationCancelledError for a cancelled token", async () => {
    const { provider, transport } = harness([OK('{"input_tokens":1}')]);
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });

    await expect(
      provider.countTokensExact(request(), { token: source.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(transport.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// listModels — docs/03 §9.2
// ---------------------------------------------------------------------------

describe("listModels (docs/03 §9.2)", () => {
  it("follows two pages by last_id and returns the union", async () => {
    const { provider, transport } = harness([
      OK(
        modelsPage(
          [modelObject("claude-opus-5"), modelObject("claude-sonnet-5")],
          true,
        ),
      ),
      OK(
        modelsPage(
          [
            modelObject("claude-sonnet-5"),
            modelObject("claude-haiku-4-5", {
              max_input_tokens: 200_000,
              max_tokens: 64_000,
            }),
          ],
          false,
        ),
      ),
    ]);

    const models = await provider.listModels(ctx());

    expect(transport.sent.map((s) => `${s.method} ${s.url}`)).toStrictEqual([
      `GET ${BASE}/v1/models`,
      `GET ${BASE}/v1/models?after_id=claude-sonnet-5`,
    ]);
    expect(models.map((m) => m.id)).toStrictEqual([
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
    const haiku = provider.getModel("claude-haiku-4-5");
    expect(haiku?.contextWindowTokens).toBe(200_000);
    expect(haiku?.maxOutputTokens).toBe(64_000);
    expect(haiku?.supportsJsonSchema).toBe(true);
    expect(haiku?.supportsSystemPrompt).toBe(true);
    expect(haiku?.inputCostPerMTokUsd).toBeUndefined();
    expect(haiku?.dataPolicy.trainsOnInputByDefault).toBe("no");
    expect(transport.sent[0]?.options.headers?.["x-api-key"]).toBe(
      SYNTHETIC_KEY,
    );
  });

  it("never reads context_window, and leaves out a model without max_input_tokens", async () => {
    const { provider } = harness([
      OK(
        modelsPage(
          [
            modelObject("claude-sonnet-5"),
            {
              type: "model",
              id: "claude-legacy",
              display_name: "Legacy",
              context_window: 100_000,
              max_tokens: 4096,
            },
          ],
          false,
        ),
      ),
    ]);

    const models = await provider.listModels(ctx());

    expect(models.map((m) => m.id)).toStrictEqual(["claude-sonnet-5"]);
    expect(provider.getModel("claude-legacy")).toBeUndefined();
  });

  it("refuses a has_more page that does not advance, instead of looping", async () => {
    const { provider, transport } = harness([
      OK(modelsPage([modelObject("claude-sonnet-5")], true)),
    ]);

    const error = await provider.listModels(ctx()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LLMError);
    expect(transport.sent).toHaveLength(2);
  });
});

describe("validateCredentials (docs/09 §2.3; P3-T14 owns the outcome set)", () => {
  it("answers ok with the models over GET /v1/models, never a completion", async () => {
    const { provider, transport } = harness([
      OK(modelsPage([modelObject("claude-sonnet-5")], false)),
    ]);

    const result = await provider.validateCredentials(ctx());

    expect(result.ok).toBe(true);
    expect(result.models?.map((m) => m.id)).toStrictEqual(["claude-sonnet-5"]);
    expect(transport.sent.map((s) => s.url)).toStrictEqual([
      `${BASE}/v1/models`,
    ]);
  });

  it("answers a 401 with the error's own message key and status, and a missing key without a request", async () => {
    const rejected = harness([
      { status: 401, body: anthropicError("authentication_error") },
    ]);
    await expect(
      rejected.provider.validateCredentials(ctx()),
    ).resolves.toStrictEqual({
      ok: false,
      messageKey: new AuthenticationError(401, "x").messageKey,
      httpStatus: 401,
    });

    const absent = harness([OK("{}")], { key: undefined });
    const result = await absent.provider.validateCredentials(ctx());
    expect(result).toStrictEqual({
      ok: false,
      messageKey: "rh-error-missing-credential",
    });
    expect(absent.transport.sent).toHaveLength(0);
  });

  it("counts a 429 as an accepted key", async () => {
    const limited = harness([
      { status: 429, body: anthropicError("rate_limit_error") },
    ]);
    const result = await limited.provider.validateCredentials(ctx());
    expect(result.ok).toBe(true);
    expect(result.messageKey).toBe(
      new RateLimitError(429, undefined, "h").messageKey,
    );
  });
});

// ---------------------------------------------------------------------------
// The caller — `registerProviders` (plan/README.md §5 rule 10)
// ---------------------------------------------------------------------------

describe("registerProviders registers the adapter, and the router reaches it", () => {
  it("dispatches a configured anthropic call through the router to POST /v1/messages", async () => {
    const transport = scriptedTransport([OK(messageBody())]);
    const clock = recordingClock();
    const store = memoryStore(SYNTHETIC_KEY);
    const { registry, router } = registerProviders({
      logger: capturingLogger(),
      settings: mockSettings({
        activeProvider: "anthropic",
        keyPresent: { anthropic: true },
        providerModel: { anthropic: MODEL },
      }),
      secrets: store,
      http: createHttpClient({ transport, userAgent: UA, clock }),
    });

    const adapter = registry.get("anthropic");
    expect(adapter?.rateLimitKey).toBe("api.anthropic.com");
    expect(ANTHROPIC_HOST).toBe("api.anthropic.com");
    await (adapter as AnthropicProvider).refreshKeyPresence();
    expect(registry.isConfigured("anthropic")).toBe(true);

    const answer = await router.chat(request(), ctx());

    expect(answer.text).toContain("randomized");
    expect(transport.sent.map((s) => `${s.method} ${s.url}`)).toStrictEqual([
      `POST ${BASE}/v1/messages`,
    ]);
  });

  it("is not configured, and sends nothing, when the build has no keystore", async () => {
    const transport = scriptedTransport([OK(messageBody())]);
    const { registry, router } = registerProviders({
      logger: capturingLogger(),
      settings: mockSettings({
        activeProvider: "anthropic",
        keyPresent: { anthropic: true },
      }),
      http: createHttpClient({
        transport,
        userAgent: UA,
        clock: recordingClock(),
      }),
    });

    expect(registry.isConfigured("anthropic")).toBe(false);
    await expect(router.chat(request(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(transport.sent).toHaveLength(0);
  });
});
