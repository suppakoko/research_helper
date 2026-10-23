import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { registerProviders } from "../../../src/bootstrap/registerProviders";
import type { Clock } from "../../../src/core/clock";
import {
  AuthenticationError,
  ContentFilterError,
  LLMError,
  MissingCredentialError,
  OperationCancelledError,
  QuotaExceededError,
  type ResearchHelperError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
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
  buildResponsesBody,
  clampMaxOutputTokens,
  isChatModelId,
  UNKNOWN_TOKEN_LIMIT,
} from "../../../src/llm/openai/mapper";
import {
  createOpenAiProvider,
  OPENAI_SECRET_ID,
} from "../../../src/llm/openai/openAiProvider";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import { toFiveLevelEffort } from "../../../src/llm/shared/effort";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type {
  ChatRequest,
  Effort,
  LLMCallContext,
  LLMProvider,
} from "../../../src/llm/types";
import { Secret } from "../../../src/prefs/secrets";
import { mockSettings } from "../../helpers/mockLLM";

/**
 * `P3-T08`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no
 * real time, no real key.
 *
 * **Every body below is hand-built and synthetic**, from the shapes
 * `docs/03-llm-provider-integration.md` records — §2.3 (request), §2.4
 * (response), §2.6 (reasoning tokens), §7.1 (`text.format`), §9.1
 * (`GET /v1/models`) and §11.5 (errors). None is a recorded live response:
 * recorded fixtures and contract tests are `P3-T30`'s, under the owner's gate
 * with a stated spend (`plan/04` §0.2 item 6). The transport is a fake that
 * never opens a socket, so the documented host in a URL below is a string only.
 *
 * **The key is synthetic and built at run time**, in the `sk-proj-` shape
 * `KEY_PATTERNS` (`src/core/errors.ts`) recognises, so a leak would show and
 * the redactor is exercised on a realistic value.
 */

const KEY = [
  "sk",
  "proj",
  `synthetic${"X".repeat(24)}${Date.now().toString(36)}`,
].join("-");
const MODEL = "test-model-a";
const NOW = 1_700_000_000_000;
const UA =
  "research_helper/9.9.9 (https://example.test; mailto:x@example.test)";

class StubZoteroException extends Error {}

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

/** A transport that answers call `i` with `answers[i]` (the last repeats) and records each call. */
function scriptedTransport(
  answers: readonly Answer[],
): HttpTransport & { readonly sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  return {
    sent,
    request(method, url, options) {
      const answer = answers[Math.min(sent.length, answers.length - 1)];
      sent.push({ method, url, options: options ?? {} });
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

/** A clock whose waits return at once; `now()` advances by `step` per read. */
function steppingClock(step = 0): Clock & { readonly slept: number[] } {
  const slept: number[] = [];
  let t = NOW;
  return {
    slept,
    now: () => {
      const value = t;
      t += step;
      return value;
    },
    sleep: (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

/** A real client with the LLM rows' budget, as `createRetryFor` would give an LLM row. */
function llmClient(transport: HttpTransport, clock: Clock): HttpClient {
  return createHttpClient({
    transport,
    userAgent: UA,
    clock,
    retryFor: () => retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 0),
  });
}

/** An in-memory `SecretStore` holding `values`. */
function memorySecrets(
  values: Partial<Record<SecretId, string>> = { [OPENAI_SECRET_ID]: KEY },
): SecretStore & { readonly gets: SecretId[] } {
  const gets: SecretId[] = [];
  const store = new Map(Object.entries(values)) as Map<SecretId, string>;
  return {
    gets,
    backend: "os-keychain",
    unattended: true,
    get(id) {
      gets.push(id);
      return Promise.resolve(store.get(id));
    },
    set(id, value) {
      store.set(id, value);
      return Promise.resolve();
    },
    clear(id) {
      store.delete(id);
      return Promise.resolve();
    },
    has(id) {
      return Promise.resolve(store.has(id));
    },
    listStoredIds() {
      return Promise.resolve([...store.keys()]);
    },
    clearAll() {
      const n = store.size;
      store.clear();
      return Promise.resolve(n);
    },
  };
}

/** A logger that records raw contexts, with no redaction of its own. */
function recordingLogger(): Logger & {
  readonly lines: { msg: string; ctx?: Record<string, unknown> }[];
} {
  const lines: { msg: string; ctx?: Record<string, unknown> }[] = [];
  const record = (msg: string, ctx?: Record<string, unknown>): void => {
    lines.push(ctx === undefined ? { msg } : { msg, ctx });
  };
  const logger: Logger & { readonly lines: typeof lines } = {
    lines,
    child: () => logger,
    error: record,
    warn: record,
    info: record,
    debug: record,
    time: (_msg, fn) => fn(),
  };
  return logger;
}

function ctx(): LLMCallContext {
  return { token: createCancellationTokenSource().token };
}

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: MODEL,
    messages: [
      {
        role: "system",
        content: "You are a biomedical literature summarizer.",
      },
      { role: "user", content: "Summarize this abstract in 3 sentences." },
    ],
    traceId: "trace-1",
    ...overrides,
  };
}

/** `docs/03` §2.4's response, with a reasoning item before the message (its first parsing note). */
function responsesBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "resp_synthetic",
    object: "response",
    created_at: 1788899084,
    status: "completed",
    model: MODEL,
    output: [
      { type: "reasoning", id: "rs_synthetic", summary: [] },
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "This randomized trial " },
          { type: "output_text", text: "found a benefit." },
        ],
      },
    ],
    usage: {
      input_tokens: 412,
      output_tokens: 118,
      total_tokens: 530,
      output_tokens_details: { reasoning_tokens: 64 },
    },
    incomplete_details: null,
    ...overrides,
  });
}

interface Harness {
  readonly provider: LLMProvider;
  readonly transport: ReturnType<typeof scriptedTransport>;
  readonly clock: ReturnType<typeof steppingClock>;
  readonly secrets: ReturnType<typeof memorySecrets>;
  readonly logger: ReturnType<typeof recordingLogger>;
}

function harness(
  answers: readonly Answer[],
  options: {
    secrets?: SecretStore | null;
    baseUrl?: string;
    clockStep?: number;
  } = {},
): Harness {
  const transport = scriptedTransport(answers);
  const clock = steppingClock(options.clockStep ?? 0);
  const secrets = memorySecrets();
  const logger = recordingLogger();
  const provider = createOpenAiProvider({
    http: llmClient(transport, clock),
    secrets:
      options.secrets === null ? undefined : (options.secrets ?? secrets),
    baseUrls: createBaseUrlResolver({ override: () => options.baseUrl ?? "" }),
    clock,
    logger,
  });
  return { provider, transport, clock, secrets, logger };
}

function sentBody(sent: SentRequest | undefined): Record<string, unknown> {
  return JSON.parse(sent?.options.body ?? "null") as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Steps 1–3: the request
// ---------------------------------------------------------------------------

describe("the Responses API request (P3-T08 steps 1–3)", () => {
  it("sends one POST to {base}/responses, without doubling the base's /v1", async () => {
    const h = harness([{ status: 200, body: responsesBody() }]);

    await h.provider.chat(request(), ctx());

    expect(h.transport.sent).toHaveLength(1);
    expect(h.transport.sent[0]?.method).toBe("POST");
    expect(h.transport.sent[0]?.url).toBe(
      "https://api.openai.com/v1/responses",
    );
    expect(h.transport.sent[0]?.url).not.toContain("/v1/v1");
  });

  it("joins a gateway override's own base, trailing slash and all, the same way", async () => {
    const h = harness([{ status: 200, body: responsesBody() }], {
      baseUrl: "https://gateway.example.test/openai/v1/",
    });

    await h.provider.chat(request(), ctx());

    expect(h.transport.sent[0]?.url).toBe(
      "https://gateway.example.test/openai/v1/responses",
    );
  });

  it("wire shape: max_output_tokens present, max_tokens absent, system as an input entry", async () => {
    const h = harness([{ status: 200, body: responsesBody() }]);

    await h.provider.chat(
      request({ maxOutputTokens: 512, temperature: 0.2 }),
      ctx(),
    );

    const body = sentBody(h.transport.sent[0]);
    expect(body).toStrictEqual({
      model: MODEL,
      input: [
        {
          role: "system",
          content: "You are a biomedical literature summarizer.",
        },
        { role: "user", content: "Summarize this abstract in 3 sentences." },
      ],
      max_output_tokens: 512,
      temperature: 0.2,
    });
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("system");
    expect(body).not.toHaveProperty("response_format");
  });

  it("puts a JSON schema at text.format with strict: true, never at response_format", async () => {
    const h = harness([{ status: 200, body: responsesBody() }]);
    const schema = {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    };

    await h.provider.chat(
      request({
        responseFormat: { kind: "json_schema", name: "paper_summary", schema },
      }),
      ctx(),
    );

    const body = sentBody(h.transport.sent[0]);
    expect(body["text"]).toStrictEqual({
      format: {
        type: "json_schema",
        name: "paper_summary",
        strict: true,
        schema,
      },
    });
    expect(body).not.toHaveProperty("response_format");
  });

  it("sends no text.format for plain text or for kind json (no documented Responses shape)", () => {
    expect(
      buildResponsesBody(request({ responseFormat: { kind: "text" } })),
    ).not.toHaveProperty("text");
    expect(
      buildResponsesBody(request({ responseFormat: { kind: "json" } })),
    ).not.toHaveProperty("text");
  });

  it("drops topP, stop, seed, routing and traceId: docs/03 records no Responses field for them", () => {
    const body = buildResponsesBody(
      request({
        topP: 0.9,
        stop: ["END"],
        seed: 7,
        routing: { requireNoTraining: true },
      }),
    );
    expect(Object.keys(body).sort()).toStrictEqual(["input", "model"]);
    expect(JSON.stringify(body)).not.toContain("trace-1");
  });

  it("clamps max_output_tokens to a known model limit, and never to an unknown one", () => {
    expect(clampMaxOutputTokens(9000, 4096)).toBe(4096);
    expect(clampMaxOutputTokens(512, 4096)).toBe(512);
    expect(clampMaxOutputTokens(9000, UNKNOWN_TOKEN_LIMIT)).toBe(9000);
    expect(clampMaxOutputTokens(9000, undefined)).toBe(9000);
    expect(clampMaxOutputTokens(undefined, 4096)).toBeUndefined();
    expect(
      buildResponsesBody(request({ maxOutputTokens: 9000 }), {
        maxOutputTokensLimit: 4096,
      }).max_output_tokens,
    ).toBe(4096);
  });

  it("maps an Effort of minimal (and none) to low, not forwarded; the other five pass through", () => {
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
      expect(toFiveLevelEffort(effort as Effort)).toBe(level);
      expect(
        buildResponsesBody(request({ effort: effort as Effort })).reasoning,
        effort,
      ).toStrictEqual({ effort: level });
    }
    const body = buildResponsesBody(request({ effort: "minimal" }));
    expect(body.reasoning).toStrictEqual({ effort: "low" });
    expect(JSON.stringify(body)).not.toContain("minimal");
    expect(buildResponsesBody(request())).not.toHaveProperty("reasoning");
  });

  it("sends ChatRequest.effort as reasoning.effort on the wire, and no reasoning when it is absent (item 262)", async () => {
    const h = harness([
      { status: 200, body: responsesBody() },
      { status: 200, body: responsesBody() },
      { status: 200, body: responsesBody() },
    ]);

    await h.provider.chat(request({ effort: "low" }), ctx());
    await h.provider.chat(request({ effort: "none" }), ctx());
    await h.provider.chat(request(), ctx());

    expect(sentBody(h.transport.sent[0]).reasoning).toStrictEqual({
      effort: "low",
    });
    expect(sentBody(h.transport.sent[1]).reasoning).toStrictEqual({
      effort: "low",
    });
    expect(sentBody(h.transport.sent[2])).not.toHaveProperty("reasoning");
  });
});

// ---------------------------------------------------------------------------
// The key, the headers and the wait
// ---------------------------------------------------------------------------

describe("the key, the headers and the attempt timeout", () => {
  it("sends the key only as a Bearer Authorization header, and waits up to LLM_ATTEMPT_TIMEOUT_MS", async () => {
    const h = harness([{ status: 200, body: responsesBody() }]);

    await h.provider.chat(request(), ctx());

    const sent = h.transport.sent[0];
    expect(sent?.options.headers?.["Authorization"]).toBe(`Bearer ${KEY}`);
    expect(sent?.options.headers?.["Content-Type"]).toBe("application/json");
    expect(sent?.options.timeout).toBe(LLM_ATTEMPT_TIMEOUT_MS);
    expect(LLM_ATTEMPT_TIMEOUT_MS).toBe(180_000);
    expect(sent?.url).not.toContain(KEY);
    expect(sent?.options.body).not.toContain(KEY);
    expect(h.secrets.gets).toStrictEqual([OPENAI_SECRET_ID]);
  });

  it("reads the key through Secret and calls expose() exactly once per request", async () => {
    const expose = vi.spyOn(Secret.prototype, "expose");
    const h = harness([{ status: 200, body: responsesBody() }]);

    await h.provider.chat(request(), ctx());
    expect(expose).toHaveBeenCalledTimes(1);
    await h.provider.chat(request(), ctx());
    expect(expose).toHaveBeenCalledTimes(2);
  });

  it("has exactly one expose() call site in src/llm/openai/", () => {
    const dir = resolve(__dirname, "../../../src/llm/openai");
    const sites = ["openAiProvider.ts", "mapper.ts"]
      .map((file) => readFileSync(resolve(dir, file), "utf8"))
      .flatMap((text) => text.match(/\.expose\(\)/g) ?? []);
    expect(sites).toHaveLength(1);
  });

  it("logs the request headers only through loggableHeaders: the key never reaches the logger", async () => {
    const h = harness([{ status: 200, body: responsesBody() }]);

    await h.provider.chat(request(), ctx());

    const logged = JSON.stringify(h.logger.lines);
    expect(h.logger.lines.length).toBeGreaterThan(0);
    expect(logged).not.toContain(KEY);
    expect(logged).toContain("[redacted:");
  });

  it("throws MissingCredentialError and sends nothing without a keystore, or without a key in it", async () => {
    const noStore = harness([{ status: 200, body: responsesBody() }], {
      secrets: null,
    });
    expect(noStore.provider.isConfigured()).toBe(false);
    await expect(
      noStore.provider.chat(request(), ctx()),
    ).rejects.toBeInstanceOf(MissingCredentialError);
    expect(noStore.transport.sent).toHaveLength(0);

    const empty = harness([{ status: 200, body: responsesBody() }], {
      secrets: memorySecrets({}),
    });
    expect(empty.provider.isConfigured()).toBe(true);
    await expect(empty.provider.chat(request(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    await expect(empty.provider.listModels(ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(empty.transport.sent).toHaveLength(0);
  });

  it("throws OperationCancelledError and sends nothing for a cancelled token", async () => {
    const h = harness([{ status: 200, body: responsesBody() }]);
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });

    await expect(
      h.provider.chat(request(), { token: source.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(h.transport.sent).toHaveLength(0);
    expect(h.secrets.gets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Steps 4–5: the response
// ---------------------------------------------------------------------------

describe("the Responses API answer (P3-T08 steps 4–5)", () => {
  it("joins the output_text parts of the message item, skipping the reasoning item before it", async () => {
    const h = harness([{ status: 200, body: responsesBody() }]);

    const response = await h.provider.chat(request(), ctx());

    expect(response.text).toBe("This randomized trial found a benefit.");
    expect(response.model).toBe(MODEL);
    expect(response.finishReason).toBe("stop");
    expect(response.json).toBeUndefined();
    expect(response.servedBy).toBeUndefined();
  });

  it("counts reasoning tokens as output: usage.output_tokens is taken whole", async () => {
    const h = harness([{ status: 200, body: responsesBody() }]);

    const { usage } = await h.provider.chat(request(), ctx());

    // 118 includes the 64 reasoning tokens (docs/03 §2.6): not 54, not 182.
    expect(usage).toStrictEqual({
      inputTokens: 412,
      outputTokens: 118,
      totalTokens: 530,
      costUsd: undefined,
    });
  });

  it("a truncated response yields finishReason length, not an error", async () => {
    const h = harness([
      {
        status: 200,
        body: responsesBody({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        }),
      },
    ]);

    const response = await h.provider.chat(request(), ctx());

    expect(response.finishReason).toBe("length");
    expect(response.text).toBe("This randomized trial found a benefit.");
  });

  it("maps any other status onto other", async () => {
    const h = harness([
      { status: 200, body: responsesBody({ status: "in_progress" }) },
    ]);
    expect((await h.provider.chat(request(), ctx())).finishReason).toBe(
      "other",
    );
  });

  it("turns an HTTP-200 refusal part, or a content_filter incompletion, into ContentFilterError", async () => {
    const refusal = harness([
      {
        status: 200,
        body: responsesBody({
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                { type: "refusal", refusal: "I can't help with that." },
              ],
            },
          ],
        }),
      },
    ]);
    await expect(
      refusal.provider.chat(request(), ctx()),
    ).rejects.toBeInstanceOf(ContentFilterError);
    expect(refusal.transport.sent).toHaveLength(1);

    const filtered = harness([
      {
        status: 200,
        body: responsesBody({
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
        }),
      },
    ]);
    await expect(
      filtered.provider.chat(request(), ctx()),
    ).rejects.toBeInstanceOf(ContentFilterError);
  });

  it("parses json when JSON was requested, and leaves it undefined when the text does not parse", async () => {
    const schemaRequest = request({
      responseFormat: { kind: "json_schema", name: "s", schema: {} },
    });
    const good = harness([
      {
        status: 200,
        body: responsesBody({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"summary":"ok"}' }],
            },
          ],
        }),
      },
    ]);
    expect((await good.provider.chat(schemaRequest, ctx())).json).toStrictEqual(
      {
        summary: "ok",
      },
    );

    const bad = harness([{ status: 200, body: responsesBody() }]);
    const response = await bad.provider.chat(schemaRequest, ctx());
    expect(response.json).toBeUndefined();
    expect(response.text).toBe("This randomized trial found a benefit.");
  });

  it("throws LLMError for a 2xx body that is not a JSON object", async () => {
    const h = harness([{ status: 200, body: "<html>gateway</html>" }]);
    const error = await h.provider
      .chat(request(), ctx())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect((error as LLMError).providerId).toBe("openai");
  });

  it("measures latencyMs with the injected clock", async () => {
    const h = harness([{ status: 200, body: responsesBody() }], {
      clockStep: 5,
    });
    const response = await h.provider.chat(request(), ctx());
    expect(response.latencyMs).toBeGreaterThan(0);
    expect(response.latencyMs % 5).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Errors through the one client (P3-T38, plan/00 §6 item 244)
// ---------------------------------------------------------------------------

describe("errors through the shared HTTP client (P3-T38)", () => {
  function openAiError(type: string, code: string, message = "x"): string {
    return JSON.stringify({ error: { message, type, param: null, code } });
  }

  it("ends an insufficient_quota 429 after exactly one transport call, as QuotaExceededError", async () => {
    const h = harness([
      {
        status: 429,
        body: openAiError("insufficient_quota", "insufficient_quota"),
      },
    ]);

    const error = await h.provider
      .chat(request(), ctx())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(h.transport.sent).toHaveLength(1);
    expect(h.clock.slept).toStrictEqual([]);
  });

  it("lets the client retry an ordinary 429, and answers when the second attempt succeeds", async () => {
    const h = harness([
      {
        status: 429,
        body: openAiError("requests", "rate_limit_exceeded"),
      },
      { status: 200, body: responsesBody() },
    ]);

    const response = await h.provider.chat(request(), ctx());

    expect(response.text).toBe("This randomized trial found a benefit.");
    expect(h.transport.sent).toHaveLength(2);
    expect(h.clock.slept).toHaveLength(1);
  });

  it("maps a 401 to AuthenticationError without a retry", async () => {
    const h = harness([
      {
        status: 401,
        body: openAiError("invalid_request_error", "invalid_api_key"),
      },
    ]);
    await expect(h.provider.chat(request(), ctx())).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(h.transport.sent).toHaveLength(1);
  });

  it("keeps the synthetic key out of the error when an error body echoes it", async () => {
    const h = harness([
      {
        status: 401,
        body: openAiError(
          "invalid_request_error",
          "invalid_api_key",
          `Incorrect API key provided: ${KEY}`,
        ),
      },
    ]);
    const error = (await h.provider
      .chat(request(), ctx())
      .catch((e: unknown) => e)) as ResearchHelperError;

    const everything = [
      error.message,
      JSON.stringify(error.context),
      error.stack ?? "",
      JSON.stringify(error.toSerialized()),
    ].join(" ");
    expect(everything).not.toContain(KEY);
  });
});

// ---------------------------------------------------------------------------
// Step 6: listModels
// ---------------------------------------------------------------------------

describe("listModels over GET /v1/models (P3-T08 step 6)", () => {
  /** `docs/03` §9.1's shape, with every kind of non-chat entry it says is mixed in. */
  const CHAT = [
    "gpt-6-astra",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "o-series-test",
  ];
  const NON_CHAT = [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "tts-1",
    "tts-1-hd",
    "gpt-4o-mini-tts",
    "whisper-1",
    "gpt-4o-transcribe",
    "gpt-image-1",
    "dall-e-3",
    "gpt-realtime",
    "gpt-4o-realtime-preview",
    "omni-moderation-latest",
    "text-moderation-stable",
    "gpt-4o-audio-preview",
    "gpt-audio",
  ];
  const LIST = JSON.stringify({
    object: "list",
    data: [...NON_CHAT, ...CHAT, "gpt-5.6-terra"].map((id, i) => ({
      id,
      object: "model",
      created: 1783000000 + i,
      owned_by: "openai",
    })),
  });

  it("sends GET {base}/models with the key, and excludes every embedding, audio, image, realtime and moderation entry", async () => {
    const h = harness([{ status: 200, body: LIST }]);

    const models = await h.provider.listModels(ctx());

    expect(h.transport.sent[0]?.method).toBe("GET");
    expect(h.transport.sent[0]?.url).toBe("https://api.openai.com/v1/models");
    expect(h.transport.sent[0]?.options.headers?.["Authorization"]).toBe(
      `Bearer ${KEY}`,
    );
    expect(h.transport.sent[0]?.options.timeout).toBe(LLM_ATTEMPT_TIMEOUT_MS);
    expect(models.map((model) => model.id)).toStrictEqual(CHAT);
  });

  it("classifies each id by docs/03 §9.1's words plus dall-e", () => {
    for (const id of NON_CHAT) expect(isChatModelId(id), id).toBe(false);
    for (const id of CHAT) expect(isChatModelId(id), id).toBe(true);
  });

  it("marks what the list does not say as not known, and fills OpenAI's data policy from docs/09 §3.3", async () => {
    const h = harness([{ status: 200, body: LIST }]);

    expect(h.provider.getModel("gpt-5.6-terra")).toBeUndefined();
    await h.provider.listModels(ctx());
    const model = h.provider.getModel("gpt-5.6-terra");

    expect(model).toMatchObject({
      id: "gpt-5.6-terra",
      displayName: "gpt-5.6-terra",
      contextWindowTokens: UNKNOWN_TOKEN_LIMIT,
      maxOutputTokens: UNKNOWN_TOKEN_LIMIT,
      supportsJsonSchema: false,
      // Item 268(d): "not known" is written as the value the router streams.
      supportsStreaming: true,
      supportsSystemPrompt: true,
      inputCostPerMTokUsd: undefined,
      outputCostPerMTokUsd: undefined,
      dataPolicy: { trainsOnInputByDefault: "no", retention: { days: 30 } },
    });
    expect(h.provider.getModel("dall-e-3")).toBeUndefined();
  });

  it("does not clamp a request against a listed model whose limit is not known", async () => {
    const h = harness([
      { status: 200, body: LIST },
      { status: 200, body: responsesBody() },
    ]);
    await h.provider.listModels(ctx());

    await h.provider.chat(
      request({ model: "gpt-5.6-terra", maxOutputTokens: 4000 }),
      ctx(),
    );

    expect(sentBody(h.transport.sent[1])["max_output_tokens"]).toBe(4000);
  });
});

// ---------------------------------------------------------------------------
// Step 7: countTokens; and the wiring
// ---------------------------------------------------------------------------

describe("countTokens (P3-T08 step 7) and the wiring", () => {
  it("delegates to estTokens, the one heuristic", () => {
    const { provider } = harness([]);
    for (const text of [
      "",
      "An English abstract.",
      "한국어 초록입니다",
      "中文摘要",
    ]) {
      expect(provider.countTokens(text, MODEL)).toBe(estTokens(text));
    }
  });

  it("is registered by registerProviders and reached through the router like any provider", async () => {
    const transport = scriptedTransport([
      { status: 200, body: responsesBody() },
    ]);
    const clock = steppingClock();
    const { registry, router } = registerProviders({
      logger: recordingLogger(),
      settings: mockSettings({
        activeProvider: "openai",
        keyPresent: { openai: true },
        providerModel: { openai: MODEL },
      }),
      secrets: memorySecrets(),
      http: llmClient(transport, clock),
    });

    expect(registry.get("openai")?.id).toBe("openai");
    expect(registry.isConfigured("openai")).toBe(true);
    const resolved = router.resolveModel("cheap");
    expect(resolved).toMatchObject({ providerId: "openai", modelId: MODEL });

    const response = await router.chat(
      request({ model: resolved.modelId }),
      ctx(),
    );

    expect(response.text).toBe("This randomized trial found a benefit.");
    expect(transport.sent.map((sent) => sent.url)).toStrictEqual([
      "https://api.openai.com/v1/responses",
    ]);
  });

  it("is not configured, and the router sends nothing, when the build has no keystore", async () => {
    const transport = scriptedTransport([
      { status: 200, body: responsesBody() },
    ]);
    const { registry, router } = registerProviders({
      logger: recordingLogger(),
      settings: mockSettings({
        activeProvider: "openai",
        keyPresent: { openai: true },
        providerModel: { openai: MODEL },
      }),
      http: llmClient(transport, steppingClock()),
    });

    expect(registry.isConfigured("openai")).toBe(false);
    await expect(router.chat(request(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(transport.sent).toHaveLength(0);
  });
});
