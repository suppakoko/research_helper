import { afterEach, describe, expect, it, vi } from "vitest";

import { registerProviders } from "../../../src/bootstrap/registerProviders";
import { type Clock, createManualClock } from "../../../src/core/clock";
import {
  AuthenticationError,
  ConfigurationError,
  ContentFilterError,
  LLMError,
  MissingCredentialError,
  OperationCancelledError,
  QuotaExceededError,
  RateLimitError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpMethod,
  type HttpOptions,
  type HttpResponse,
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
  chatViaGenerateContent,
  createGeminiProvider,
  GEMINI_API_KEY_HEADER,
  GEMINI_HOST,
  GEMINI_SECRET_ID,
  type GeminiProviderDeps,
} from "../../../src/llm/gemini/geminiProvider";
import {
  buildInteractionBody,
  type Effort,
  mapEffortToThinkingLevel,
  toOpenApiSchema,
} from "../../../src/llm/gemini/mapper";
import {
  classifyTier,
  createGeminiTierDetector,
  DOCUMENTED_PAID_SIGNALS,
} from "../../../src/llm/gemini/tierDetect";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import type { ChatRequest, LLMCallContext } from "../../../src/llm/types";
import { Secret } from "../../../src/prefs/secrets";
import { mockSettings } from "../../helpers/mockLLM";

/**
 * `P3-T10`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network and
 * no live Gemini call** (gate `G-06` governs any live one; this card makes
 * none).
 *
 * **Every response body below is hand-built and synthetic**, transcribed from
 * the shapes `docs/03` documents — §4.4 (the Interactions answer), §9.3 (the
 * model list), §11.5 (the error envelope) — and `docs/04` §2.4 (the legacy
 * `generateContent` envelope). None was recorded from Google; the recorded
 * fixtures are `P3-T30`'s. Where `docs/03` records no shape (an Interactions
 * safety block, a Gemini spend cap) no body is invented here.
 *
 * **Every key is synthetic and built at run time** in the documented Google
 * key shape (`AIza` + 35 characters, `KEY_PATTERNS` in `src/core/errors.ts`),
 * so the redactor would recognise one if it leaked, and no key-shaped literal
 * sits in the source.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000;
const MODEL = "gemini-3.8-flash";
const BASE = "https://generativelanguage.googleapis.com";
const INTERACTIONS_URL = `${BASE}/v1beta/interactions`;
const MODELS_URL = `${BASE}/v1beta/models`;
const UA =
  "research_helper/9.9.9 (https://example.test; mailto:x@example.test)";

/** A synthetic Google-shaped key, different on every call. */
function syntheticKey(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let tail = "";
  for (let i = 0; i < 35; i += 1) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)] ?? "x";
  }
  return ["AI", "za"].join("") + tail;
}

/** A `SecretStore` over a map. `undefined` value = no Gemini key stored. */
function memorySecrets(
  geminiKey: string | undefined,
): SecretStore & { gets: number } {
  const values = new Map<SecretId, string>();
  if (geminiKey !== undefined) values.set(GEMINI_SECRET_ID, geminiKey);
  const store = {
    backend: "os-keychain" as const,
    unattended: true,
    gets: 0,
    get(id: SecretId) {
      store.gets += 1;
      return Promise.resolve(values.get(id));
    },
    set(id: SecretId, value: string) {
      values.set(id, value);
      return Promise.resolve();
    },
    clear(id: SecretId) {
      values.delete(id);
      return Promise.resolve();
    },
    has(id: SecretId) {
      return Promise.resolve(values.has(id));
    },
    listStoredIds() {
      return Promise.resolve([...values.keys()]);
    },
    clearAll() {
      const n = values.size;
      values.clear();
      return Promise.resolve(n);
    },
  };
  return store;
}

interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly options: HttpTransportOptions;
}

class StubZoteroException extends Error {}

/** A `Zotero.HTTP`-shaped transport answering call `i` with `answers[i]` (the last repeats). */
function scriptedTransport(
  answers: readonly { status: number; body?: string }[],
): HttpTransport & { readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    request(method, url, options) {
      const answer = answers[Math.min(calls.length, answers.length - 1)];
      calls.push({ method, url, options });
      const xhr: HttpTransportXhr = {
        status: answer?.status ?? 0,
        responseText: answer?.body ?? "",
        responseURL: url,
        getAllResponseHeaders: () => "",
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

/**
 * The shipped `createHttpClient`, with the LLM rows' retry budget for Gemini's
 * host. (No `HOST_POLICIES` row for it ships yet — see the card report — so
 * the budget is supplied here the way `createRetryFor` would build it.)
 */
function shippedClient(transport: HttpTransport, clock: Clock): HttpClient {
  return createHttpClient({
    transport,
    userAgent: UA,
    clock,
    retryFor: (host) =>
      host === GEMINI_HOST
        ? retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 0)
        : undefined,
  });
}

/** A fake `HttpClient` that records each request and answers from a script. */
function recordingClient(
  answers: readonly { status: number; body?: string }[],
): HttpClient & {
  readonly requests: {
    method: HttpMethod;
    url: string;
    options: HttpOptions;
  }[];
} {
  const requests: { method: HttpMethod; url: string; options: HttpOptions }[] =
    [];
  return {
    requests,
    request(method, url, options = {}) {
      const answer = answers[Math.min(requests.length, answers.length - 1)];
      requests.push({ method, url, options });
      const response: HttpResponse = {
        status: answer?.status ?? 200,
        url,
        body: answer?.body ?? "",
        rawHeaders: "",
        header: () => undefined,
      };
      if (response.status >= 400) {
        const mapped = options.mapErrorResponse?.(response, NOW);
        return Promise.reject(mapped ?? new Error(`HTTP ${response.status}`));
      }
      return Promise.resolve(response);
    },
  };
}

function capturingLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const write = (msg: string, ctx?: Record<string, unknown>): void => {
    lines.push(`${msg} ${JSON.stringify(ctx ?? {})}`);
  };
  const logger: Logger & { lines: string[] } = {
    lines,
    child: () => logger,
    error: write,
    warn: write,
    info: write,
    debug: write,
    time: (_msg, fn) => fn(),
  };
  return logger;
}

function ctx(): LLMCallContext {
  return { token: createCancellationTokenSource().token };
}

function deps(
  http: HttpClient,
  secrets: SecretStore | undefined,
  extra: Partial<GeminiProviderDeps> = {},
): GeminiProviderDeps {
  return {
    http,
    secrets,
    baseUrls: createBaseUrlResolver({ override: () => "" }),
    clock: createManualClock(NOW),
    ...extra,
  };
}

function chatRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
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
    traceId: "trace-123",
    ...overrides,
  };
}

/** `docs/03` §4.4's answer, synthetic. */
function interaction(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "int_abc123",
    object: "interaction",
    model: MODEL,
    status: "completed",
    created: "2026-09-08T07:31:22Z",
    steps: [
      {
        type: "model_output",
        content: [{ type: "text", text: "This randomized trial found ..." }],
      },
    ],
    usage: {
      total_input_tokens: 412,
      total_output_tokens: 118,
      total_cached_tokens: 0,
      total_thought_tokens: 44,
      total_tokens: 574,
    },
    ...overrides,
  };
}

/** `docs/03` §11.5's Gemini error envelope, synthetic. */
function geminiError(
  code: number,
  status: string,
  message: string,
  reasons: readonly string[] = [],
): string {
  return JSON.stringify({
    error: {
      code,
      message,
      status,
      details: reasons.map((reason) => ({ reason })),
    },
  });
}

function parsedBody(options: { body?: string }): Record<string, unknown> {
  return JSON.parse(options.body ?? "null") as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The wire shape
// ---------------------------------------------------------------------------

describe("the Interactions request on the wire (P3-T10 Done-when)", () => {
  it("carries the key only in x-goog-api-key: never in the URL, the body or another header", async () => {
    const key = syntheticKey();
    const transport = scriptedTransport([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    const provider = createGeminiProvider(
      deps(shippedClient(transport, recordingClock()), memorySecrets(key)),
    );

    await provider.chat(chatRequest(), ctx());

    expect(transport.calls).toHaveLength(1);
    const call = transport.calls[0] as RecordedCall;
    // The snapshot, with the key replaced by a marker.
    expect({
      method: call.method,
      url: call.url,
      headers: { ...call.options.headers, [GEMINI_API_KEY_HEADER]: "<key>" },
      body: parsedBody(call.options),
    }).toStrictEqual({
      method: "POST",
      url: INTERACTIONS_URL,
      headers: {
        [GEMINI_API_KEY_HEADER]: "<key>",
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      body: {
        model: MODEL,
        system_instruction: "You are a biomedical literature summarizer.",
        input: "Summarize this abstract in 3 sentences.",
        generation_config: { max_output_tokens: 512 },
        store: false,
      },
    });
    expect(call.url).not.toMatch(/[?&](key|api_key|token)=/i);
    expect(call.url).not.toContain(key);
    expect(call.options.headers?.[GEMINI_API_KEY_HEADER]).toBe(key);
    const otherHeaders = Object.entries(call.options.headers ?? {}).filter(
      ([name]) => name !== GEMINI_API_KEY_HEADER,
    );
    expect(JSON.stringify(otherHeaders)).not.toContain(key);
    expect(call.options.body).not.toContain(key);
  });

  it("puts store: false on every request body", () => {
    const variants: ChatRequest[] = [
      chatRequest(),
      chatRequest({ messages: [{ role: "user", content: "hi" }] }),
      chatRequest({ responseFormat: { kind: "json" } }),
      chatRequest({
        responseFormat: {
          kind: "json_schema",
          name: "s",
          schema: { type: "object" },
        },
      }),
      chatRequest({
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
          { role: "user", content: "c" },
        ],
      }),
      chatRequest({ maxOutputTokens: undefined as unknown as number }),
    ];
    for (const request of variants) {
      expect(buildInteractionBody(request).store).toBe(false);
    }
  });

  it("puts store: false on the body the adapter actually sends, every time", async () => {
    const client = recordingClient([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    const provider = createGeminiProvider(
      deps(client, memorySecrets(syntheticKey())),
    );
    await provider.chat(chatRequest(), ctx());
    await provider.chat(
      chatRequest({ responseFormat: { kind: "json" } }),
      ctx(),
    );
    expect(client.requests).toHaveLength(2);
    for (const { options } of client.requests) {
      expect(parsedBody(options).store).toBe(false);
    }
  });

  it("sends only documented generation_config fields: seed and stop go, temperature, topP, traceId and routing do not", () => {
    const body = buildInteractionBody(
      chatRequest({
        seed: 7,
        stop: ["END"],
        temperature: 0.2,
        topP: 0.9,
        routing: { requireNoTraining: true },
      }),
    );
    expect(body.generation_config).toStrictEqual({
      max_output_tokens: 512,
      seed: 7,
      stop_sequences: ["END"],
    });
    const text = JSON.stringify(body);
    for (const absent of [
      "temperature",
      "top_p",
      "topP",
      "trace",
      "routing",
      "thinking_level",
      "cached_content",
      "tools",
    ]) {
      expect(text, absent).not.toContain(absent);
    }
  });

  it("asks for JSON under response_format, with the schema's lowercase types kept (docs/03 §7.3)", () => {
    const schema = {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    };
    expect(
      buildInteractionBody(
        chatRequest({
          responseFormat: { kind: "json_schema", name: "summary", schema },
        }),
      ).response_format,
    ).toStrictEqual({ type: "text", mime_type: "application/json", schema });
    expect(
      buildInteractionBody(chatRequest({ responseFormat: { kind: "text" } })),
    ).not.toHaveProperty("response_format");
  });

  it("sends a multi-turn conversation as §14.2's sketch shape (an assumption: §4.3 documents only a string)", () => {
    const body = buildInteractionBody(
      chatRequest({
        messages: [
          { role: "system", content: "S1" },
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
          { role: "system", content: "S2" },
          { role: "user", content: "c" },
        ],
      }),
    );
    expect(body.system_instruction).toBe("S1\n\nS2");
    expect(body.input).toStrictEqual([
      { role: "user", parts: [{ text: "a" }] },
      { role: "assistant", parts: [{ text: "b" }] },
      { role: "user", parts: [{ text: "c" }] },
    ]);
  });

  it("waits up to LLM_ATTEMPT_TIMEOUT_MS and passes the call's cancellation token", async () => {
    const client = recordingClient([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    const provider = createGeminiProvider(
      deps(client, memorySecrets(syntheticKey())),
    );
    const context = ctx();
    await provider.chat(chatRequest(), context);
    const sent = client.requests[0]?.options;
    expect(sent?.timeoutMs).toBe(LLM_ATTEMPT_TIMEOUT_MS);
    expect(sent?.token).toBe(context.token);
    expect(typeof sent?.mapErrorResponse).toBe("function");

    const transport = scriptedTransport([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    await createGeminiProvider(
      deps(shippedClient(transport, recordingClock()), memorySecrets("k")),
    ).chat(chatRequest(), ctx());
    expect(transport.calls[0]?.options.timeout).toBe(LLM_ATTEMPT_TIMEOUT_MS);
  });

  it("sends to the gemini.baseUrl override when one is set, still with the key in the header only", async () => {
    const key = syntheticKey();
    const client = recordingClient([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    const provider = createGeminiProvider({
      ...deps(client, memorySecrets(key)),
      baseUrls: createBaseUrlResolver({
        override: () => "https://gateway.example.test/gemini/",
      }),
    });
    await provider.chat(chatRequest(), ctx());
    expect(client.requests[0]?.url).toBe(
      "https://gateway.example.test/gemini/v1beta/interactions",
    );
    expect(client.requests[0]?.url).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// 2. Reading the answer
// ---------------------------------------------------------------------------

describe("reading an Interactions answer (docs/03 §4.4)", () => {
  async function chatWith(
    body: unknown,
    request: ChatRequest = chatRequest(),
  ): Promise<unknown> {
    const provider = createGeminiProvider(
      deps(
        recordingClient([
          {
            status: 200,
            body: typeof body === "string" ? body : JSON.stringify(body),
          },
        ]),
        memorySecrets(syntheticKey()),
      ),
    );
    return provider.chat(request, ctx()).catch((e: unknown) => e);
  }

  it("takes text from model_output steps' text parts only, and fills Usage", async () => {
    const response = await chatWith(
      interaction({
        steps: [
          { type: "user_input", content: [{ type: "text", text: "PROMPT" }] },
          {
            type: "model_output",
            content: [
              { type: "text", text: "Part one. " },
              { type: "image", data: "IGNORED" },
              { type: "text", text: "Part two." },
            ],
          },
          { type: "function_call", content: [{ type: "text", text: "CALL" }] },
          { type: "model_output", content: [{ type: "text", text: " End." }] },
        ],
      }),
    );
    expect(response).toMatchObject({
      text: "Part one. Part two. End.",
      json: undefined,
      model: MODEL,
      finishReason: "stop",
      usage: {
        inputTokens: 412,
        outputTokens: 118,
        totalTokens: 574,
        costUsd: undefined,
      },
      servedBy: undefined,
      latencyMs: 0,
    });
    expect((response as { raw: unknown }).raw).toMatchObject({
      id: "int_abc123",
    });
  });

  it("parses the text as JSON when JSON was asked for, and leaves json undefined when it is not JSON", async () => {
    const asked = chatRequest({ responseFormat: { kind: "json" } });
    const good = await chatWith(
      interaction({
        steps: [
          {
            type: "model_output",
            content: [{ type: "text", text: '{"summary":"ok"}' }],
          },
        ],
      }),
      asked,
    );
    expect(good).toMatchObject({ json: { summary: "ok" } });
    const bad = await chatWith(interaction(), asked);
    expect(bad).toMatchObject({ json: undefined });
  });

  it("reads an incomplete interaction as a truncated answer", async () => {
    expect(await chatWith(interaction({ status: "incomplete" }))).toMatchObject(
      { finishReason: "length", text: "This randomized trial found ..." },
    );
  });

  it("refuses any other status as an LLMError, without reading the content", async () => {
    for (const status of [
      "failed",
      "cancelled",
      "budget_exceeded",
      "requires_action",
      "in_progress",
      undefined,
    ]) {
      const error = await chatWith(interaction({ status }));
      expect(error, String(status)).toBeInstanceOf(LLMError);
      expect((error as LLMError).retryable).toBe(false);
      expect((error as LLMError).message).not.toContain("randomized");
      expect((error as LLMError).context.interactionStatus).toBe(
        status ?? "missing",
      );
    }
  });

  it("refuses a 2xx body that is not a JSON object", async () => {
    expect(await chatWith("<html>proxy page</html>")).toBeInstanceOf(LLMError);
    expect(await chatWith("[1,2]")).toBeInstanceOf(LLMError);
  });

  it("hands every 2xx to mapProviderError first: a legacy block field is a ContentFilterError", async () => {
    const error = await chatWith(
      interaction({ promptFeedback: { blockReason: "SAFETY" } }),
    );
    expect(error).toBeInstanceOf(ContentFilterError);
  });

  it("measures latency on the injected clock", async () => {
    const clock = createManualClock(NOW);
    const client: HttpClient = {
      request: async () => {
        clock.advance(1234);
        return {
          status: 200,
          url: INTERACTIONS_URL,
          body: JSON.stringify(interaction()),
          rawHeaders: "",
          header: () => undefined,
        };
      },
    };
    const provider = createGeminiProvider({
      ...deps(client, memorySecrets(syntheticKey())),
      clock,
    });
    expect(await provider.chat(chatRequest(), ctx())).toMatchObject({
      latencyMs: 1234,
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Errors, through the shipped HTTP client
// ---------------------------------------------------------------------------

describe("Gemini errors through the shipped HTTP client (P3-T38 pattern)", () => {
  it("retries a 429 RESOURCE_EXHAUSTED as a RateLimitError under LLM_RETRY_BUDGET: Gemini has no documented spend-cap shape", async () => {
    const transport = scriptedTransport([
      {
        status: 429,
        body: geminiError(429, "RESOURCE_EXHAUSTED", "Quota exceeded."),
      },
    ]);
    const clock = recordingClock();
    const error = await createGeminiProvider(
      deps(shippedClient(transport, clock), memorySecrets(syntheticKey())),
    )
      .chat(chatRequest(), ctx())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).not.toBeInstanceOf(QuotaExceededError);
    expect(transport.calls).toHaveLength(LLM_RETRY_BUDGET.maxAttempts);
    expect(clock.slept).toHaveLength(LLM_RETRY_BUDGET.maxAttempts - 1);
  });

  it("ends a 400 API_KEY_INVALID after one call as an AuthenticationError", async () => {
    const transport = scriptedTransport([
      {
        status: 400,
        body: geminiError(400, "INVALID_ARGUMENT", "API key not valid.", [
          "API_KEY_INVALID",
        ]),
      },
    ]);
    const error = await createGeminiProvider(
      deps(
        shippedClient(transport, recordingClock()),
        memorySecrets(syntheticKey()),
      ),
    )
      .chat(chatRequest(), ctx())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(transport.calls).toHaveLength(1);
  });

  it("keeps a synthetic key echoed in an error body out of the error", async () => {
    const key = syntheticKey();
    const transport = scriptedTransport([
      {
        status: 400,
        body: geminiError(400, "INVALID_ARGUMENT", `bad key ${key}`, [
          "API_KEY_INVALID",
          key,
        ]),
      },
    ]);
    const error = (await createGeminiProvider(
      deps(shippedClient(transport, recordingClock()), memorySecrets(key)),
    )
      .chat(chatRequest(), ctx())
      .catch((e: unknown) => e)) as AuthenticationError;
    expect(error).toBeInstanceOf(AuthenticationError);
    const everything = [
      error.message,
      error.stack,
      JSON.stringify(error.context),
      JSON.stringify(error.toSerialized()),
    ].join(" ");
    expect(everything).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// 4. The key
// ---------------------------------------------------------------------------

describe("the Gemini key: the keystore, Secret and the logs", () => {
  it("with no keystore: not configured, and chat throws MissingCredentialError with zero requests", async () => {
    const client = recordingClient([{ status: 200 }]);
    const provider = createGeminiProvider(deps(client, undefined));
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.chat(chatRequest(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    await expect(provider.listModels(ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(client.requests).toHaveLength(0);
  });

  it("with a keystore that holds no Gemini key: not configured once the store answers, and zero requests", async () => {
    const client = recordingClient([{ status: 200 }]);
    const provider = createGeminiProvider(
      deps(client, memorySecrets(undefined)),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.chat(chatRequest(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(client.requests).toHaveLength(0);
  });

  it("treats an empty stored value as no key: MissingCredentialError, zero requests", async () => {
    const client = recordingClient([{ status: 200 }]);
    const provider = createGeminiProvider(deps(client, memorySecrets("")));
    await expect(provider.chat(chatRequest(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(provider.isConfigured()).toBe(false);
    expect(client.requests).toHaveLength(0);
  });

  it("with the key stored: configured, and the key is read from the store on every request", async () => {
    const secrets = memorySecrets(syntheticKey());
    const client = recordingClient([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    const provider = createGeminiProvider(deps(client, secrets));
    await Promise.resolve();
    expect(provider.isConfigured()).toBe(true);
    await provider.chat(chatRequest(), ctx());
    await provider.chat(chatRequest(), ctx());
    expect(secrets.gets).toBe(2);
  });

  it("notices a removed key at the next read", async () => {
    const secrets = memorySecrets(syntheticKey());
    const client = recordingClient([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    const provider = createGeminiProvider(deps(client, secrets));
    await provider.chat(chatRequest(), ctx());
    await secrets.clear(GEMINI_SECRET_ID);
    await expect(provider.chat(chatRequest(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(provider.isConfigured()).toBe(false);
    expect(client.requests).toHaveLength(1);
  });

  it("exposes the Secret exactly once per request", async () => {
    const expose = vi.spyOn(Secret.prototype, "expose");
    const client = recordingClient([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    const provider = createGeminiProvider(
      deps(client, memorySecrets(syntheticKey())),
    );
    await provider.chat(chatRequest(), ctx());
    expect(expose).toHaveBeenCalledTimes(1);
  });

  it("logs headers only through loggableHeaders: no logged line carries the key", async () => {
    const key = syntheticKey();
    const logger = capturingLogger();
    const client = recordingClient([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    const provider = createGeminiProvider({
      ...deps(client, memorySecrets(key)),
      logger,
    });
    await provider.chat(chatRequest(), ctx());
    expect(logger.lines.length).toBeGreaterThan(0);
    const all = logger.lines.join("\n");
    expect(all).not.toContain(key);
    expect(all).toContain(
      `"${GEMINI_API_KEY_HEADER}":"[redacted:${key.length}]"`,
    );
  });

  it("sends nothing for an already cancelled token", async () => {
    const client = recordingClient([{ status: 200 }]);
    const secrets = memorySecrets(syntheticKey());
    const provider = createGeminiProvider(deps(client, secrets));
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });
    await expect(
      provider.chat(chatRequest(), { token: source.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(client.requests).toHaveLength(0);
    expect(secrets.gets).toBe(0);
  });

  it("refuses validateCredentials until P3-T14 builds it, sending nothing", async () => {
    const client = recordingClient([{ status: 200 }]);
    const provider = createGeminiProvider(
      deps(client, memorySecrets(syntheticKey())),
    );
    await expect(provider.validateCredentials(ctx())).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(client.requests).toHaveLength(0);
  });

  it("names its documented host as its rate-limit key", () => {
    const provider = createGeminiProvider(deps(recordingClient([]), undefined));
    expect(provider.id).toBe("gemini");
    expect(provider.rateLimitKey).toBe("generativelanguage.googleapis.com");
    expect(GEMINI_HOST).toBe("generativelanguage.googleapis.com");
  });
});

// ---------------------------------------------------------------------------
// 5. Effort
// ---------------------------------------------------------------------------

describe("the shared effort scale onto thinking_level (step 2)", () => {
  it("maps all seven levels onto Gemini's four, never forwarding xhigh or max", () => {
    const table: Record<Effort, string> = {
      none: "minimal",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "high",
      max: "high",
    };
    for (const [effort, level] of Object.entries(table)) {
      expect(mapEffortToThinkingLevel(effort as Effort), effort).toBe(level);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. The model list
// ---------------------------------------------------------------------------

/** `docs/03` §9.3's entries, synthetic; the `models` envelope is an assumption. */
const MODEL_LIST = {
  models: [
    {
      name: "models/gemini-3.8-flash",
      displayName: "Gemini 3.8 Flash",
      description: "x",
      inputTokenLimit: 1_048_576,
      outputTokenLimit: 65_536,
      supportedGenerationMethods: ["generateContent", "countTokens"],
    },
    {
      name: "models/text-embedding-005",
      displayName: "Embedding",
      inputTokenLimit: 2048,
      outputTokenLimit: 1,
      supportedGenerationMethods: ["embedContent"],
    },
    {
      // TTS is served through generateContent (docs/04 §2.1), so only the id
      // pattern excludes it.
      name: "models/gemini-3.1-flash-tts-preview",
      displayName: "TTS",
      inputTokenLimit: 8192,
      outputTokenLimit: 16_384,
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/gemini-2.5-flash-preview-tts",
      inputTokenLimit: 8192,
      outputTokenLimit: 16_384,
      supportedGenerationMethods: ["generateContent", "countTokens"],
    },
    {
      name: "models/gemini-3.5-flash-lite",
      inputTokenLimit: 1_048_576,
      outputTokenLimit: 65_536,
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/no-limits",
      supportedGenerationMethods: ["generateContent"],
    },
  ],
};

describe("listModels (docs/03 §9.3)", () => {
  it("GETs /v1beta/models with the key in the header only", async () => {
    const key = syntheticKey();
    const transport = scriptedTransport([
      { status: 200, body: JSON.stringify(MODEL_LIST) },
    ]);
    await createGeminiProvider(
      deps(shippedClient(transport, recordingClock()), memorySecrets(key)),
    ).listModels(ctx());
    const call = transport.calls[0] as RecordedCall;
    expect(call.method).toBe("GET");
    expect(call.url).toBe(MODELS_URL);
    expect(call.url).not.toMatch(/[?&](key|api_key|token)=/i);
    expect(call.options.headers?.[GEMINI_API_KEY_HEADER]).toBe(key);
    expect(call.options.body).toBeUndefined();
  });

  it("returns ids without models/, and excludes embedding-only, TTS-only and limitless entries", async () => {
    const provider = createGeminiProvider(
      deps(
        recordingClient([{ status: 200, body: JSON.stringify(MODEL_LIST) }]),
        memorySecrets(syntheticKey()),
      ),
    );
    const models = await provider.listModels(ctx());
    expect(models.map((model) => model.id)).toStrictEqual([
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
    ]);
    for (const model of models) expect(model.id).not.toContain("models/");
    expect(models[0]).toMatchObject({
      displayName: "Gemini 3.8 Flash",
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 65_536,
      inputCostPerMTokUsd: undefined,
      outputCostPerMTokUsd: undefined,
    });
    expect(models[1]?.displayName).toBe("gemini-3.5-flash-lite");
  });

  it("marks every model with the free tier's data policy while the tier is unknown, and serves getModel from the last list", async () => {
    const provider = createGeminiProvider(
      deps(
        recordingClient([{ status: 200, body: JSON.stringify(MODEL_LIST) }]),
        memorySecrets(syntheticKey()),
      ),
    );
    expect(provider.getModel("gemini-3.8-flash")).toBeUndefined();
    const models = await provider.listModels(ctx());
    for (const model of models) {
      expect(model.dataPolicy.trainsOnInputByDefault).toBe("yes");
    }
    expect(provider.getModel("gemini-3.8-flash")).toBe(models[0]);
    expect(provider.getModel("gemini-3.1-flash-tts-preview")).toBeUndefined();
  });

  it("marks the paid tier's policy only when the detector says paid", async () => {
    const provider = createGeminiProvider({
      ...deps(
        recordingClient([{ status: 200, body: JSON.stringify(MODEL_LIST) }]),
        memorySecrets(syntheticKey()),
      ),
      tier: {
        detectTier: () => Promise.resolve("paid"),
        keyChanged: () => undefined,
      },
    });
    const models = await provider.listModels(ctx());
    expect(models[0]?.dataPolicy.trainsOnInputByDefault).toBe("no");
  });

  it("refuses a model list that is not a JSON object", async () => {
    const provider = createGeminiProvider(
      deps(
        recordingClient([{ status: 200, body: "nope" }]),
        memorySecrets(syntheticKey()),
      ),
    );
    await expect(provider.listModels(ctx())).rejects.toBeInstanceOf(LLMError);
  });
});

// ---------------------------------------------------------------------------
// 7. The tier
// ---------------------------------------------------------------------------

describe("detectTier (docs/09 §3.4 rule 4)", () => {
  it("documents no paid signal, so the shipped answer is free-or-unknown and no request is sent", async () => {
    expect(DOCUMENTED_PAID_SIGNALS).toHaveLength(0);
    expect(Object.isFrozen(DOCUMENTED_PAID_SIGNALS)).toBe(true);
    const client = recordingClient([{ status: 200 }]);
    const provider = createGeminiProvider(
      deps(client, memorySecrets(syntheticKey())),
    );
    expect(await provider.detectTier()).toBe("free-or-unknown");
    expect(client.requests).toHaveLength(0);
  });

  it("returns free-or-unknown on inconclusive evidence, including a body that only sounds paid", () => {
    for (const evidence of [
      {},
      {
        status: 429,
        body: JSON.parse(
          geminiError(429, "RESOURCE_EXHAUSTED", "x"),
        ) as unknown,
      },
      { status: 200, body: {} },
      { status: 200, body: "" },
      { status: 200, body: { billing: "active", tier: "paid", paid: true } },
      { status: 200, body: MODEL_LIST, header: () => "paid" },
    ]) {
      expect(classifyTier(evidence)).toBe("free-or-unknown");
    }
  });

  it("answers paid only when a supplied signal proves it, and treats a throwing signal as proving nothing", () => {
    const proves = (): boolean => true;
    const throws = (): boolean => {
      throw new Error("cannot read");
    };
    expect(classifyTier({}, [proves])).toBe("paid");
    expect(classifyTier({}, [throws])).toBe("free-or-unknown");
    expect(classifyTier({}, [() => false])).toBe("free-or-unknown");
  });

  it("decides once per session and again after a key change; a failed gather is not cached", async () => {
    let gathers = 0;
    let fail = true;
    const detector = createGeminiTierDetector({
      gather: () => {
        gathers += 1;
        return fail
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ status: 200 });
      },
      signals: [(evidence) => evidence.status === 200],
    });
    expect(await detector.detectTier()).toBe("free-or-unknown");
    fail = false;
    expect(await detector.detectTier()).toBe("paid");
    expect(await detector.detectTier()).toBe("paid");
    expect(gathers).toBe(2);
    fail = true;
    detector.keyChanged();
    expect(await detector.detectTier()).toBe("free-or-unknown");
    expect(gathers).toBe(3);
  });

  it("drops an answer that a key change overtook", async () => {
    const gate: { release?: () => void; gathers: number } = { gathers: 0 };
    const detector = createGeminiTierDetector({
      gather: () =>
        new Promise((resolve) => {
          gate.gathers += 1;
          gate.release = () => {
            resolve({ status: 200 });
          };
        }),
      signals: [() => true],
    });
    const first = detector.detectTier();
    detector.keyChanged();
    gate.release?.();
    expect(await first).toBe("paid");
    // Not cached: the next call gathers again.
    const second = detector.detectTier();
    gate.release?.();
    expect(await second).toBe("paid");
    expect(gate.gathers).toBe(2);
    // This one was not overtaken, so it is kept.
    expect(await detector.detectTier()).toBe("paid");
    expect(gate.gathers).toBe(2);
  });

  it("is reset by the provider's keyChanged", async () => {
    const keyChanged = vi.fn();
    const provider = createGeminiProvider({
      ...deps(recordingClient([]), memorySecrets(syntheticKey())),
      tier: {
        detectTier: () => Promise.resolve("free-or-unknown"),
        keyChanged,
      },
    });
    provider.keyChanged();
    expect(keyChanged).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 8. The legacy fallback
// ---------------------------------------------------------------------------

describe("the generateContent fallback (step 6)", () => {
  it("is unused by default: chat never reaches :generateContent", async () => {
    const client = recordingClient([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    await createGeminiProvider(
      deps(client, memorySecrets(syntheticKey())),
    ).chat(chatRequest(), ctx());
    expect(client.requests.map((r) => r.url)).toStrictEqual([INTERACTIONS_URL]);
  });

  it("sends the camelCase body to models/{model}:generateContent, key in the header, schema upper-cased", async () => {
    const key = syntheticKey();
    const transport = scriptedTransport([
      {
        status: 200,
        // docs/04 §2.4's envelope, text instead of audio; synthetic.
        body: JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"summary":' }, { text: '"ok"}' }],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 38,
            candidatesTokenCount: 7,
            totalTokenCount: 45,
          },
        }),
      },
    ]);
    const response = await chatViaGenerateContent(
      deps(shippedClient(transport, recordingClock()), memorySecrets(key)),
      chatRequest({
        temperature: 1,
        messages: [
          { role: "system", content: "S" },
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
          { role: "user", content: "c" },
        ],
        responseFormat: {
          kind: "json_schema",
          name: "summary",
          schema: {
            type: "object",
            properties: { summary: { type: "string" } },
          },
        },
      }),
      ctx(),
    );
    const call = transport.calls[0] as RecordedCall;
    expect(call.url).toBe(`${BASE}/v1beta/models/${MODEL}:generateContent`);
    expect(call.url).not.toMatch(/[?&](key|api_key|token)=/i);
    expect(call.options.headers?.[GEMINI_API_KEY_HEADER]).toBe(key);
    expect(call.options.timeout).toBe(LLM_ATTEMPT_TIMEOUT_MS);
    expect(parsedBody(call.options)).toStrictEqual({
      systemInstruction: { parts: [{ text: "S" }] },
      contents: [
        { role: "user", parts: [{ text: "a" }] },
        { role: "model", parts: [{ text: "b" }] },
        { role: "user", parts: [{ text: "c" }] },
      ],
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 1,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { summary: { type: "STRING" } },
        },
      },
    });
    expect(response).toMatchObject({
      text: '{"summary":"ok"}',
      json: { summary: "ok" },
      finishReason: "stop",
      usage: { inputTokens: 38, outputTokens: 7, totalTokens: 45 },
    });
  });

  it("maps a legacy SAFETY finish on a 200 to ContentFilterError", async () => {
    const error = await chatViaGenerateContent(
      deps(
        recordingClient([
          {
            status: 200,
            body: JSON.stringify({
              candidates: [{ finishReason: "SAFETY" }],
            }),
          },
        ]),
        memorySecrets(syntheticKey()),
      ),
      chatRequest(),
      ctx(),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContentFilterError);
  });

  it("translates a schema's types to upper case at every depth, and nothing else", () => {
    const schema = {
      type: "object",
      properties: {
        type: { type: "string", enum: ["object", "string"] },
        list: { type: "array", items: { type: "integer" } },
      },
      required: ["type"],
    };
    const before = JSON.stringify(schema);
    expect(toOpenApiSchema(schema)).toStrictEqual({
      type: "OBJECT",
      properties: {
        type: { type: "STRING", enum: ["object", "string"] },
        list: { type: "ARRAY", items: { type: "INTEGER" } },
      },
      required: ["type"],
    });
    expect(JSON.stringify(schema)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 9. Registration (`registerProviders`, the adapter's caller)
// ---------------------------------------------------------------------------

describe("registerProviders registers the Gemini adapter", () => {
  it("puts it in the registry, and the router sends a Gemini call through it", async () => {
    const key = syntheticKey();
    const transport = scriptedTransport([
      { status: 200, body: JSON.stringify(interaction()) },
    ]);
    const { registry, router } = registerProviders({
      logger: capturingLogger(),
      settings: mockSettings({
        activeProvider: "gemini",
        keyPresent: { gemini: true },
        providerModel: { gemini: MODEL },
      }),
      secrets: memorySecrets(key),
      http: shippedClient(transport, recordingClock()),
    });
    expect(registry.get("gemini")?.id).toBe("gemini");
    await Promise.resolve();
    const response = await router.chat(chatRequest(), ctx());
    expect(response.text).toBe("This randomized trial found ...");
    expect(transport.calls.map((call) => call.url)).toStrictEqual([
      INTERACTIONS_URL,
    ]);
    expect(transport.calls[0]?.options.headers?.[GEMINI_API_KEY_HEADER]).toBe(
      key,
    );
  });
});
