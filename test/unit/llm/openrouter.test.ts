import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  registerProviders,
  type LLMServices,
} from "../../../src/bootstrap/registerProviders";
import { type Clock } from "../../../src/core/clock";
import { createMemoryPrefStore } from "../../../src/core/config";
import {
  BadRequestError,
  ConfigurationError,
  ContentFilterError,
  LLMError,
  MissingCredentialError,
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
import { createLogger } from "../../../src/core/logger";
import {
  LLM_ATTEMPT_TIMEOUT_MS,
  LLM_RETRY_BUDGET,
} from "../../../src/core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../../src/core/secretStore";
import {
  createBaseUrlResolver,
  DEFAULT_BASE_URLS,
} from "../../../src/llm/shared/baseUrl";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import {
  parseOpenRouterCatalogue,
  perMillionTokens,
} from "../../../src/llm/openrouter/catalogue";
import {
  mapFinishReason,
  OPENROUTER_GUARDRAIL_CAUSE,
  OPENROUTER_GUARDRAIL_REMEDIES,
} from "../../../src/llm/openrouter/mapper";
import {
  createOpenRouterProvider,
  type OpenRouterProvider,
  type OpenRouterProviderDeps,
} from "../../../src/llm/openrouter/openRouterProvider";
import type { ChatRequest, LLMCallContext } from "../../../src/llm/types";
import { setPrefStore } from "../../../src/prefs";

/**
 * `P3-T07`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no
 * real time, no real key.
 *
 * **Every fixture below is SYNTHETIC — hand-built from the shapes `docs/03`
 * records, never recorded from a live call.** The answer is §5.4's, the
 * catalogue entry §9.4's, the error envelope `{ error: { code, message } }`
 * the one `test/unit/llm/errorMap.test.ts` uses for OpenRouter. The card's
 * Done-when says "recorded" for the catalogue and the guardrail 404; recorded
 * fixtures are `P3-T30`'s, behind the owner's spend gate (`plan/04` §0.2
 * items 6–7), so these stand in for them and say so.
 *
 * The key is built at run time from pieces and only ever lives in the memory
 * keystore below.
 */

const SYNTHETIC_KEY = ["sk", "or", "v1", "0123456789abcdef".repeat(4)].join(
  "-",
);
const MODEL = "test-author/test-model";
const NOW = 1_788_899_084_000;

/** `docs/03` §5.4's answer, hand-built. SYNTHETIC. */
const SYNTHETIC_ANSWER = {
  id: "gen-synthetic",
  object: "chat.completion",
  created: 1788899084,
  model: MODEL,
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: "This randomized trial found ...",
      },
    },
  ],
  usage: {
    prompt_tokens: 412,
    completion_tokens: 118,
    total_tokens: 530,
    cost: 0.000752,
    is_byok: false,
  },
  system_fingerprint: null,
};

/** `docs/03` §9.4's entry, hand-built, under the `{ data }` envelope. SYNTHETIC. */
const SYNTHETIC_CATALOGUE = {
  data: [
    {
      id: "test-author/long-context-model",
      canonical_slug: "test-author/long-context-model-20260903",
      name: "Test: Long Context",
      created: 1788552838,
      context_length: 1050000,
      architecture: {
        modality: "text+image+file->text",
        input_modalities: ["file", "image", "text"],
        output_modalities: ["text"],
        tokenizer: "GPT",
      },
      pricing: {
        prompt: "0.00001",
        completion: "0.00005",
        input_cache_read: "0.000001",
        input_cache_write: "0.0000125",
        overrides: [
          {
            min_prompt_tokens: 272000,
            prompt: "0.00002",
            completion: "0.000075",
          },
        ],
      },
      top_provider: {
        context_length: 1050000,
        max_completion_tokens: 128000,
        is_moderated: true,
      },
      supported_parameters: [
        "reasoning",
        "response_format",
        "structured_outputs",
        "max_tokens",
      ],
    },
    {
      id: MODEL,
      name: "Test: Plain",
      context_length: 32000,
      pricing: { prompt: "0.0000003", completion: "0.0000025" },
      top_provider: { context_length: 32000, max_completion_tokens: 256 },
      // `response_format` without `structured_outputs`: not schema-capable
      // (`docs/03` §7.4 item 1 filters on `structured_outputs`).
      supported_parameters: ["max_tokens", "response_format"],
    },
    {
      // Prices as JSON numbers, and no output cap: neither is guessed at.
      id: "test-author/numeric-prices",
      context_length: 8000,
      pricing: { prompt: 0.000001, completion: 0.000002 },
      top_provider: { max_completion_tokens: null },
    },
    // No context window and no id: both skipped.
    { id: "test-author/no-window", pricing: { prompt: "0", completion: "0" } },
    { name: "no id at all", context_length: 1000 },
  ],
};

/**
 * The guardrail 404. SYNTHETIC: `docs/09` §3.3 marks the sentence
 * **Unverified** (seen only in search excerpts), and the envelope is the
 * OpenRouter error shape of `errorMap.test.ts`. The code keys off the status
 * and `error.code`, never the sentence.
 */
const GUARDRAIL_SENTENCE =
  "No endpoints available matching your guardrail restrictions and data policy";
const SYNTHETIC_GUARDRAIL_404 = {
  error: { code: 404, message: GUARDRAIL_SENTENCE },
};

class StubZoteroException extends Error {}

interface Answer {
  readonly status: number;
  readonly body?: string;
}

interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly options: HttpTransportOptions;
}

/** A transport that answers call `i` with `answers[i]` (the last repeats) and records each. */
function scriptedTransport(
  answers: readonly Answer[],
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

/** A clock that advances 25 ms per read and never really sleeps. */
function steppingClock(): Clock & { readonly slept: number[] } {
  const slept: number[] = [];
  let t = NOW;
  return {
    slept,
    now: () => {
      t += 25;
      return t;
    },
    sleep: (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

/** A memory keystore, with a count of `get` calls. */
function memoryStore(
  initial: Partial<Record<SecretId, string>> = {},
): SecretStore & { readonly gets: SecretId[] } {
  const values = new Map<SecretId, string>(
    Object.entries(initial) as [SecretId, string][],
  );
  const gets: SecretId[] = [];
  return {
    gets,
    backend: "os-keychain",
    unattended: true,
    get(id) {
      gets.push(id);
      return Promise.resolve(values.get(id));
    },
    set(id, value) {
      values.set(id, value);
      return Promise.resolve();
    },
    clear(id) {
      values.delete(id);
      return Promise.resolve();
    },
    has(id) {
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
    maxOutputTokens: 512,
    traceId: "trace-must-not-leave",
    ...overrides,
  };
}

interface Harness {
  readonly provider: OpenRouterProvider;
  readonly transport: ReturnType<typeof scriptedTransport>;
  readonly clock: ReturnType<typeof steppingClock>;
  readonly store: ReturnType<typeof memoryStore>;
  readonly logLines: string[];
}

function harness(
  answers: readonly Answer[],
  options: {
    readonly withRetry?: boolean;
    readonly baseUrl?: string;
    readonly store?: ReturnType<typeof memoryStore> | null;
    readonly privacyMode?: OpenRouterProviderDeps["privacyMode"];
  } = {},
): Harness {
  const transport = scriptedTransport(answers);
  const clock = steppingClock();
  const http: HttpClient = createHttpClient({
    transport,
    userAgent:
      "research_helper/9.9.9 (https://example.test; mailto:x@example.test)",
    clock,
    ...(options.withRetry === true && {
      retryFor: () => retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 0),
    }),
  });
  const logLines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => logLines.push(line) },
    clock,
    level: "debug",
  });
  const store =
    options.store === null
      ? undefined
      : (options.store ?? memoryStore({ "llm.openrouter": SYNTHETIC_KEY }));
  const provider = createOpenRouterProvider({
    secrets: store,
    baseUrls: createBaseUrlResolver({
      override: () => options.baseUrl ?? "",
    }),
    http,
    clock,
    logger,
    ...(options.privacyMode !== undefined && {
      privacyMode: options.privacyMode,
    }),
  });
  return {
    provider,
    transport,
    clock,
    store: store ?? memoryStore(),
    logLines,
  };
}

const OK = { status: 200, body: JSON.stringify(SYNTHETIC_ANSWER) };

function sentBody(h: Harness, index = 0): unknown {
  const body = h.transport.calls[index]?.options.body;
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as unknown;
}

// ---------------------------------------------------------------------------
// 1. The request
// ---------------------------------------------------------------------------

describe("OpenRouter chat(): the request on the wire (P3-T07 steps 1–3)", () => {
  it("sends the exact body for a fixed prompt, with data_collection: deny and no require_parameters", async () => {
    const h = harness([OK]);
    await h.provider.chat(request({ temperature: 0.2, seed: 7 }), ctx());

    expect(h.transport.calls).toHaveLength(1);
    expect(h.transport.calls[0]?.options.body).toBe(
      JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: "You are a biomedical literature summarizer.",
          },
          { role: "user", content: "Summarize this abstract in 3 sentences." },
        ],
        max_tokens: 512,
        temperature: 0.2,
        seed: 7,
        provider: { data_collection: "deny" },
      }),
    );
  });

  it("adds response_format and require_parameters: true under json_schema", async () => {
    const h = harness([OK]);
    const schema = {
      type: "object",
      properties: { tldr: { type: "string" } },
      required: ["tldr"],
    };
    await h.provider.chat(
      request({
        responseFormat: { kind: "json_schema", name: "summary", schema },
      }),
      ctx(),
    );

    expect(h.transport.calls[0]?.options.body).toBe(
      JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: "You are a biomedical literature summarizer.",
          },
          { role: "user", content: "Summarize this abstract in 3 sentences." },
        ],
        max_tokens: 512,
        response_format: {
          type: "json_schema",
          json_schema: { name: "summary", strict: true, schema },
        },
        provider: { require_parameters: true, data_collection: "deny" },
      }),
    );
  });

  it("never sends response_format without require_parameters, and sends neither for kind text or json", async () => {
    const h = harness([OK]);
    await h.provider.chat(request({ responseFormat: { kind: "text" } }), ctx());
    await h.provider.chat(request({ responseFormat: { kind: "json" } }), ctx());
    for (const index of [0, 1]) {
      const body = sentBody(h, index) as Record<string, unknown>;
      expect(body).not.toHaveProperty("response_format");
      expect(body.provider).toStrictEqual({ data_collection: "deny" });
    }
  });

  it("adds zdr: true in strict mode and leaves it out in balanced and full mode", async () => {
    const strict = harness([OK], { privacyMode: () => "strict" });
    await strict.provider.chat(request(), ctx());
    expect((sentBody(strict) as { provider: unknown }).provider).toStrictEqual({
      data_collection: "deny",
      zdr: true,
    });

    for (const mode of ["balanced", "full"] as const) {
      const h = harness([OK], { privacyMode: () => mode });
      await h.provider.chat(request(), ctx());
      expect((sentBody(h) as { provider: unknown }).provider).toStrictEqual({
        data_collection: "deny",
      });
    }

    // No mode supplied yet (P3-T15): balanced.
    const unset = harness([OK]);
    await unset.provider.chat(request(), ctx());
    expect(
      (sentBody(unset) as { provider: object }).provider,
    ).not.toHaveProperty("zdr");
  });

  it("maps allowProviders/denyProviders onto only/ignore, requireZeroRetention onto zdr, and drops empty lists", async () => {
    const h = harness([OK]);
    await h.provider.chat(
      request({
        routing: {
          requireNoTraining: true,
          requireZeroRetention: true,
          allowProviders: ["anthropic", "openai"],
          denyProviders: ["some-upstream"],
        },
      }),
      ctx(),
    );
    await h.provider.chat(
      request({ routing: { allowProviders: [], denyProviders: [] } }),
      ctx(),
    );

    expect((sentBody(h, 0) as { provider: unknown }).provider).toStrictEqual({
      data_collection: "deny",
      zdr: true,
      only: ["anthropic", "openai"],
      ignore: ["some-upstream"],
    });
    expect((sentBody(h, 1) as { provider: unknown }).provider).toStrictEqual({
      data_collection: "deny",
    });
  });

  it("never sends traceId upstream", async () => {
    const h = harness([OK]);
    await h.provider.chat(request(), ctx());
    expect(h.transport.calls[0]?.options.body).not.toContain(
      "trace-must-not-leave",
    );
  });

  it("posts to <base>/chat/completions without doubling /api/v1, also behind a gateway override", async () => {
    const plain = harness([OK]);
    await plain.provider.chat(request(), ctx());
    expect(plain.transport.calls[0]?.method).toBe("POST");
    expect(plain.transport.calls[0]?.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(DEFAULT_BASE_URLS.openrouter).toBe("https://openrouter.ai/api/v1");

    const gateway = harness([OK], {
      baseUrl: "https://gw.example.test/openrouter/api/v1/",
    });
    await gateway.provider.chat(request(), ctx());
    expect(gateway.transport.calls[0]?.url).toBe(
      "https://gw.example.test/openrouter/api/v1/chat/completions",
    );
    expect(gateway.provider.rateLimitKey).toBe("gw.example.test");
    expect(plain.provider.rateLimitKey).toBe("openrouter.ai");
  });

  it("sends the bearer key, Content-Type and both attribution titles, and logs headers only redacted", async () => {
    const h = harness([OK]);
    await h.provider.chat(request(), ctx());

    const headers = h.transport.calls[0]?.options.headers ?? {};
    expect(headers.Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["HTTP-Referer"]).toBe(
      "https://github.com/suppakoko/research_helper",
    );
    expect(headers["X-Title"]).toBe("research_helper");
    expect(headers["X-OpenRouter-Title"]).toBe("research_helper");

    const log = h.logLines.join("\n");
    expect(log).toContain("openrouter request");
    expect(log).toContain("[redacted:");
    expect(log).not.toContain(SYNTHETIC_KEY);
    expect(log).not.toContain(SYNTHETIC_KEY.slice(-24));
  });

  it("passes LLM_ATTEMPT_TIMEOUT_MS as the attempt's timeout", async () => {
    const h = harness([OK]);
    await h.provider.chat(request(), ctx());
    expect(h.transport.calls[0]?.options.timeout).toBe(LLM_ATTEMPT_TIMEOUT_MS);
    expect(LLM_ATTEMPT_TIMEOUT_MS).toBe(180_000);
  });

  it("clamps max_tokens to the catalogue's output cap once the model is known", async () => {
    const h = harness([
      { status: 200, body: JSON.stringify(SYNTHETIC_CATALOGUE) },
      OK,
    ]);
    await h.provider.listModels(ctx());
    expect(h.provider.getModel(MODEL)?.maxOutputTokens).toBe(256);

    await h.provider.chat(request({ maxOutputTokens: 4096 }), ctx());
    expect((sentBody(h, 1) as { max_tokens: number }).max_tokens).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// 2. The key
// ---------------------------------------------------------------------------

describe("OpenRouter: the key (P3-T07 step 1, P3-T06 Contradiction 12)", () => {
  it("throws MissingCredentialError with zero requests when the keystore holds no key, or there is none", async () => {
    const empty = harness([OK], { store: memoryStore() });
    await expect(empty.provider.chat(request(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(empty.transport.calls).toHaveLength(0);

    const none = harness([OK], { store: null });
    await expect(none.provider.chat(request(), ctx())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(none.transport.calls).toHaveLength(0);
  });

  it("isConfigured() answers from the keystore", async () => {
    expect(harness([OK], { store: null }).provider.isConfigured()).toBe(false);

    const absent = harness([OK], { store: memoryStore() });
    await absent.provider.refreshKeyPresence();
    expect(absent.provider.isConfigured()).toBe(false);

    const store = memoryStore();
    const later = harness([OK], { store });
    await later.provider.refreshKeyPresence();
    expect(later.provider.isConfigured()).toBe(false);
    await store.set("llm.openrouter", SYNTHETIC_KEY);
    await later.provider.refreshKeyPresence();
    expect(later.provider.isConfigured()).toBe(true);

    await store.clear("llm.openrouter");
    await later.provider.refreshKeyPresence();
    expect(later.provider.isConfigured()).toBe(false);
  });

  it("never lets an older keystore answer overwrite a newer one", async () => {
    const store = memoryStore();
    const answers: ((stored: boolean) => void)[] = [];
    const slow: SecretStore = {
      ...store,
      has: () =>
        new Promise<boolean>((resolve) => {
          answers.push(resolve);
        }),
    };
    const h = harness([OK], { store: null });
    const provider = createOpenRouterProvider({
      secrets: slow,
      baseUrls: createBaseUrlResolver({ override: () => "" }),
      http: { request: () => Promise.reject(new Error("no request expected")) },
      clock: h.clock,
    });
    // answers[0] is the construction-time question; ask twice more.
    const older = provider.refreshKeyPresence();
    const newer = provider.refreshKeyPresence();
    answers[2]?.(false);
    await newer;
    answers[1]?.(true);
    answers[0]?.(true);
    await older;
    expect(provider.isConfigured()).toBe(false);
  });

  it("calls expose() in exactly one place: the header builder", () => {
    const dir = join(process.cwd(), "src", "llm", "openrouter");
    const sites = readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) => {
        const text = readFileSync(join(dir, name), "utf8");
        return [...text.matchAll(/\.expose\(\)/g)].map(() => name);
      });
    expect(sites).toStrictEqual(["openRouterProvider.ts"]);
    const text = readFileSync(join(dir, "openRouterProvider.ts"), "utf8");
    const builder = /function openRouterHeaders\([^)]*\)[^{]*\{[^}]*\}/.exec(
      text,
    );
    expect(builder?.[0]).toContain(".expose()");
  });

  it("sends no key to the public catalogue", async () => {
    const h = harness([
      { status: 200, body: JSON.stringify(SYNTHETIC_CATALOGUE) },
    ]);
    await h.provider.listModels(ctx());
    expect(h.transport.calls[0]?.method).toBe("GET");
    expect(h.transport.calls[0]?.url).toBe(
      "https://openrouter.ai/api/v1/models",
    );
    const headers = h.transport.calls[0]?.options.headers ?? {};
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain(
      "authorization",
    );
    expect(JSON.stringify(h.transport.calls[0])).not.toContain(SYNTHETIC_KEY);
    expect(h.store.gets).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The answer
// ---------------------------------------------------------------------------

describe("OpenRouter chat(): the answer (P3-T07 step 4)", () => {
  it("normalizes §5.4's answer, with usage.cost reaching Usage unrounded", async () => {
    const cost = 0.000123456789012345;
    const h = harness([
      {
        status: 200,
        body: JSON.stringify({
          ...SYNTHETIC_ANSWER,
          usage: { ...SYNTHETIC_ANSWER.usage, cost },
        }),
      },
    ]);
    const response = await h.provider.chat(request(), ctx());

    expect(response.text).toBe("This randomized trial found ...");
    expect(response.finishReason).toBe("stop");
    expect(response.model).toBe(MODEL);
    expect(response.json).toBeUndefined();
    expect(response.servedBy).toBeUndefined();
    expect(response.usage).toStrictEqual({
      inputTokens: 412,
      outputTokens: 118,
      totalTokens: 530,
      costUsd: cost,
    });
    expect(response.usage.costUsd).toBe(cost);
    expect(response.latencyMs).toBeGreaterThan(0);
    expect(response.raw).toMatchObject({ id: "gen-synthetic" });
  });

  it("leaves absent usage fields undefined rather than zero", async () => {
    const h = harness([
      {
        status: 200,
        body: JSON.stringify({ ...SYNTHETIC_ANSWER, usage: undefined }),
      },
    ]);
    const response = await h.provider.chat(request(), ctx());
    expect(response.usage).toStrictEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
      costUsd: undefined,
    });
  });

  it("maps every finish_reason docs/03 §5.4 lists", () => {
    expect(mapFinishReason("stop")).toBe("stop");
    expect(mapFinishReason("length")).toBe("length");
    expect(mapFinishReason("tool_calls")).toBe("tool_use");
    expect(mapFinishReason("content_filter")).toBe("content_filter");
    expect(mapFinishReason("error")).toBe("other");
    expect(mapFinishReason(undefined)).toBe("other");
  });

  it("reports a truncated answer as finishReason length", async () => {
    const truncated = structuredClone(SYNTHETIC_ANSWER);
    truncated.choices[0]!.finish_reason = "length";
    const h = harness([{ status: 200, body: JSON.stringify(truncated) }]);
    expect((await h.provider.chat(request(), ctx())).finishReason).toBe(
      "length",
    );
  });

  it("throws ContentFilterError for an HTTP-200 content_filter answer, after one call", async () => {
    const filtered = structuredClone(SYNTHETIC_ANSWER);
    filtered.choices[0]!.finish_reason = "content_filter";
    const h = harness([{ status: 200, body: JSON.stringify(filtered) }], {
      withRetry: true,
    });
    await expect(h.provider.chat(request(), ctx())).rejects.toBeInstanceOf(
      ContentFilterError,
    );
    expect(h.transport.calls).toHaveLength(1);
  });

  it("parses JSON text into json under json_schema, and leaves it undefined when it does not parse", async () => {
    const withJson = structuredClone(SYNTHETIC_ANSWER);
    withJson.choices[0]!.message.content = '{"tldr":"ok"}';
    const notJson = structuredClone(SYNTHETIC_ANSWER);
    notJson.choices[0]!.message.content = "prose, not JSON";
    const h = harness([
      { status: 200, body: JSON.stringify(withJson) },
      { status: 200, body: JSON.stringify(notJson) },
    ]);
    const format = {
      kind: "json_schema" as const,
      name: "summary",
      schema: { type: "object" },
    };
    const first = await h.provider.chat(
      request({ responseFormat: format }),
      ctx(),
    );
    const second = await h.provider.chat(
      request({ responseFormat: format }),
      ctx(),
    );
    expect(first.json).toStrictEqual({ tldr: "ok" });
    expect(second.json).toBeUndefined();
    expect(second.text).toBe("prose, not JSON");
  });

  it("throws LLMError, without copying the body, for a 200 that is not JSON or has no choices", async () => {
    const h = harness([
      { status: 200, body: "<html>secret paper text</html>" },
      { status: 200, body: JSON.stringify({ choices: [] }) },
    ]);
    const first = (await h.provider
      .chat(request(), ctx())
      .catch((e: unknown) => e)) as LLMError;
    expect(first).toBeInstanceOf(LLMError);
    expect(first.message).not.toContain("secret paper text");
    await expect(h.provider.chat(request(), ctx())).rejects.toBeInstanceOf(
      LLMError,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Errors, through the shipped client (P3-T38's hook)
// ---------------------------------------------------------------------------

describe("OpenRouter: errors through mapErrorResponse (P3-T07 steps 4 and 6, P3-T38)", () => {
  it("turns a 402 spend cap into QuotaExceededError after exactly one call, with five attempts allowed", async () => {
    const h = harness(
      [
        {
          status: 402,
          body: JSON.stringify({
            error: { code: 402, message: "Insufficient credits" },
          }),
        },
      ],
      { withRetry: true },
    );
    await expect(h.provider.chat(request(), ctx())).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    expect(h.transport.calls).toHaveLength(1);
    expect(h.clock.slept).toStrictEqual([]);
  });

  it("still retries an ordinary 429 under the client's budget", async () => {
    const h = harness(
      [
        {
          status: 429,
          body: JSON.stringify({ error: { code: 429, message: "slow down" } }),
        },
        OK,
      ],
      { withRetry: true },
    );
    const response = await h.provider.chat(request(), ctx());
    expect(response.text).toBe("This randomized trial found ...");
    expect(h.transport.calls).toHaveLength(2);
  });

  it("maps the synthetic guardrail 404 onto BadRequestError naming the cause and both remedies", async () => {
    const h = harness(
      [{ status: 404, body: JSON.stringify(SYNTHETIC_GUARDRAIL_404) }],
      { withRetry: true, privacyMode: () => "strict" },
    );
    const error = (await h.provider
      .chat(request(), ctx())
      .catch((e: unknown) => e)) as BadRequestError;

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.httpStatus).toBe(404);
    expect(error.context.cause).toBe(OPENROUTER_GUARDRAIL_CAUSE);
    expect(error.context.remedies).toStrictEqual([
      ...OPENROUTER_GUARDRAIL_REMEDIES,
    ]);
    expect(error.context.restrictions).toStrictEqual([
      "data_collection: deny",
      "zdr",
    ]);
    expect(error.message).toMatch(/choose a different model/i);
    expect(error.message).toMatch(/relax the privacy setting in preferences/i);
    expect(error.message).toMatch(/retain or train/i);
    expect(error.message).not.toContain(GUARDRAIL_SENTENCE);
    expect(h.transport.calls).toHaveLength(1);
  });

  it("keys the guardrail off status and error.code, never the sentence", async () => {
    const sentenceOnly = harness([
      {
        status: 404,
        body: JSON.stringify({ error: { message: GUARDRAIL_SENTENCE } }),
      },
    ]);
    const plain = (await sentenceOnly.provider
      .chat(request(), ctx())
      .catch((e: unknown) => e)) as ResearchHelperError;
    expect(plain).toBeInstanceOf(BadRequestError);
    expect(plain.context.cause).toBeUndefined();

    const codeOnly = harness([
      {
        status: 404,
        body: JSON.stringify({ error: { code: 404, message: "anything" } }),
      },
    ]);
    const guard = (await codeOnly.provider
      .chat(request(), ctx())
      .catch((e: unknown) => e)) as ResearchHelperError;
    expect(guard.context.cause).toBe(OPENROUTER_GUARDRAIL_CAUSE);
  });

  it("treats a 404 for a model the fetched catalogue does not list as an ordinary not-found", async () => {
    const h = harness([
      { status: 200, body: JSON.stringify(SYNTHETIC_CATALOGUE) },
      { status: 404, body: JSON.stringify(SYNTHETIC_GUARDRAIL_404) },
    ]);
    await h.provider.listModels(ctx());
    const error = (await h.provider
      .chat(request({ model: "test-author/not-in-catalogue" }), ctx())
      .catch((e: unknown) => e)) as ResearchHelperError;
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.context.cause).toBeUndefined();
  });

  it("keeps the synthetic key out of every error it builds", async () => {
    const h = harness([
      {
        status: 404,
        body: JSON.stringify({
          error: { code: 404, message: `bad key ${SYNTHETIC_KEY}` },
        }),
      },
    ]);
    const error = (await h.provider
      .chat(request(), ctx())
      .catch((e: unknown) => e)) as ResearchHelperError;
    const everything = JSON.stringify([
      error.message,
      error.context,
      error.stack,
      error.toSerialized(),
    ]);
    expect(everything).not.toContain(SYNTHETIC_KEY);
  });
});

// ---------------------------------------------------------------------------
// 5. The catalogue
// ---------------------------------------------------------------------------

describe("OpenRouter listModels(): the public catalogue (P3-T07 step 5)", () => {
  it("prices from strings × 1e6, keeps overrides, reads caps and the structured-output flag", async () => {
    const h = harness([
      { status: 200, body: JSON.stringify(SYNTHETIC_CATALOGUE) },
    ]);
    const models = await h.provider.listModels(ctx());
    const long = models.find((m) => m.id === "test-author/long-context-model");
    const source = SYNTHETIC_CATALOGUE.data[0]!.pricing!;

    expect(long?.inputCostPerMTokUsd).toBe(Number(source.prompt) * 1e6);
    expect(long?.outputCostPerMTokUsd).toBe(Number(source.completion) * 1e6);
    expect(long?.contextWindowTokens).toBe(1050000);
    expect(long?.maxOutputTokens).toBe(128000);
    expect(long?.supportsJsonSchema).toBe(true);
    expect(long?.displayName).toBe("Test: Long Context");
    expect(long?.dataPolicy.trainsOnInputByDefault).toBe("unknown");
    expect(long?.dataPolicy.retention.days).toBe("unknown");
    expect(models.find((m) => m.id === MODEL)?.supportsJsonSchema).toBe(false);

    const entries = parseOpenRouterCatalogue(SYNTHETIC_CATALOGUE).entries;
    expect(entries[0]?.priceOverrides).toStrictEqual([
      {
        minPromptTokens: 272000,
        inputCostPerMTokUsd: Number("0.00002") * 1e6,
        outputCostPerMTokUsd: Number("0.000075") * 1e6,
      },
    ]);
  });

  it("listCatalogue() returns the same entries, overrides included, and fills getModel", async () => {
    const h = harness([
      { status: 200, body: JSON.stringify(SYNTHETIC_CATALOGUE) },
    ]);
    expect(h.provider.getModel(MODEL)).toBeUndefined();
    const entries = await h.provider.listCatalogue(ctx());
    expect(entries.map((e) => e.model.id)).toStrictEqual([
      "test-author/long-context-model",
      MODEL,
      "test-author/numeric-prices",
    ]);
    expect(entries[0]?.priceOverrides).toHaveLength(1);
    expect(h.provider.getModel(MODEL)?.contextWindowTokens).toBe(32000);
  });

  it("never coerces a JSON-number price, falls back to the context window for a missing cap, and skips unusable entries", () => {
    const { entries, skipped } = parseOpenRouterCatalogue(SYNTHETIC_CATALOGUE);
    const numeric = entries.find(
      (e) => e.model.id === "test-author/numeric-prices",
    );
    expect(numeric?.model.inputCostPerMTokUsd).toBeUndefined();
    expect(numeric?.model.outputCostPerMTokUsd).toBeUndefined();
    expect(numeric?.model.maxOutputTokens).toBe(8000);
    expect(skipped).toBe(2);

    expect(perMillionTokens("0")).toBe(0);
    expect(perMillionTokens("-1")).toBeUndefined();
    expect(perMillionTokens("abc")).toBeUndefined();
    expect(perMillionTokens(0.00001)).toBeUndefined();
    expect(
      parseOpenRouterCatalogue([SYNTHETIC_CATALOGUE.data[1]]).entries,
    ).toHaveLength(1);
    expect(parseOpenRouterCatalogue({ nothing: true }).entries).toStrictEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// 6. The rest of the contract, and the wiring
// ---------------------------------------------------------------------------

describe("OpenRouter: the rest of LLMProvider, and registerProviders (P3-T07 Files)", () => {
  afterEach(() => {
    setPrefStore(undefined);
  });

  it("countTokens delegates to the one heuristic", () => {
    const h = harness([OK]);
    const text = "A randomized trial of 120 patients.";
    expect(h.provider.countTokens(text, MODEL)).toBe(estTokens(text));
  });

  it("validateCredentials is P3-T14's: it rejects with ConfigurationError and sends nothing", async () => {
    const h = harness([OK]);
    await expect(h.provider.validateCredentials(ctx())).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(h.transport.calls).toHaveLength(0);
  });

  it("is registered by registerProviders with the store and client it is given", async () => {
    setPrefStore(createMemoryPrefStore({ "openrouter.keyPresent": true }));
    const transport = scriptedTransport([OK]);
    const services: LLMServices = registerProviders({
      logger: createLogger({
        sink: { write: () => undefined },
        clock: steppingClock(),
      }),
      http: createHttpClient({
        transport,
        userAgent:
          "research_helper/9.9.9 (https://example.test; mailto:x@example.test)",
        clock: steppingClock(),
      }),
      secrets: memoryStore({ "llm.openrouter": SYNTHETIC_KEY }),
    });
    const adapter = services.registry.get("openrouter");
    expect(adapter?.id).toBe("openrouter");
    expect(adapter?.displayNameKey).toBe("research-helper-provider-openrouter");
    expect(adapter?.rateLimitKey).toBe("openrouter.ai");

    const response = await adapter!.chat(request(), ctx());
    expect(response.usage.costUsd).toBe(0.000752);
    expect(transport.calls[0]?.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });
});
