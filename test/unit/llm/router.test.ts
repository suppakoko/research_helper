/**
 * `P3-T06`: the `LLMProvider` contract, the registry, the router, the
 * base-URL resolver and the mock harness.
 *
 * No test here reaches a network or a model. Every provider is
 * `test/helpers/mockLLM.ts`'s scripted, in-process mock, and the one test that
 * builds the whole service graph hands `installServices` a transport that
 * records requests and must record none.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockModel,
  mockSettings,
} from "../../helpers/mockLLM";
import { createScope, installServices } from "../../../src/bootstrap/container";
import {
  createPrefLLMSettings,
  PROVIDER_PREF_NAMES,
  registerProviders,
} from "../../../src/bootstrap/registerProviders";
import { createManualClock } from "../../../src/core/clock";
import {
  createMemoryPrefStore,
  type PrefScalar,
} from "../../../src/core/config";
import {
  BudgetExceededError,
  ConfigurationError,
  ContextLengthExceededError,
  MissingCredentialError,
  OperationCancelledError,
  RateLimitError,
  StructuredOutputError,
} from "../../../src/core/errors";
import type {
  HttpExceptionClass,
  HttpTransport,
  HttpTransportXhr,
} from "../../../src/core/http/client";
import { isRetriedAutomatically } from "../../../src/core/http/retry";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { createLogger, type LogSink } from "../../../src/core/logger";
import { createLLMProviderRegistry } from "../../../src/llm/registry";
import {
  createLLMRouter,
  providerModelPref,
  REPORT_MODEL_PREF,
  SCREENING_MODEL_PREF,
  SUMMARY_MODEL_PREF,
} from "../../../src/llm/router";
import {
  createBaseUrlResolver,
  DEFAULT_BASE_URLS,
} from "../../../src/llm/shared/baseUrl";
import type {
  BudgetGuard,
  ChatRequest,
  ChatStreamChunk,
  LLMCallContext,
  LLMProvider,
  LLMRouter,
  ModelPurpose,
} from "../../../src/llm/types";
import type { ProviderId } from "../../../src/model/ids";
import { setPrefStore } from "../../../src/prefs";
import { PREF_KEYS } from "../../../src/prefs/keys";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");

const PROVIDERS: readonly ProviderId[] = [
  "openrouter",
  "openai",
  "gemini",
  "anthropic",
];

afterEach(() => {
  setPrefStore(undefined);
});

/** A context with a live token and nothing else. */
function callContext(extra: Partial<LLMCallContext> = {}): LLMCallContext {
  return { token: createCancellationTokenSource().token, ...extra };
}

/** A minimal request for `model`. */
function request(model = "mock-small", content = "hello"): ChatRequest {
  return {
    model,
    messages: [{ role: "user", content }],
    traceId: "t-1",
  };
}

async function collect(
  stream: AsyncIterable<ChatStreamChunk>,
): Promise<ChatStreamChunk[]> {
  const out: ChatStreamChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

/** A router over the typed prefs, as `registerProviders` builds it, with a memory `PrefStore`. */
function routerOverPrefs(
  prefs: Readonly<Record<string, PrefScalar>>,
  providers: readonly LLMProvider[] = [],
): LLMRouter {
  setPrefStore(createMemoryPrefStore(prefs));
  const settings = createPrefLLMSettings();
  const registry = createLLMProviderRegistry(settings);
  for (const provider of providers) registry.register(provider);
  return createLLMRouter({ registry, settings });
}

// ---------------------------------------------------------------------------
// 1. The contract is docs/07 §4.3's
// ---------------------------------------------------------------------------

/** `export interface|type` name → its two-space-indented member names. */
function declarations(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of source.split(/\r?\n/)) {
    const head = /^export (?:interface|type) (\w+)/.exec(line);
    if (head?.[1] !== undefined) {
      current = [];
      out.set(head[1], current);
      continue;
    }
    if (line.startsWith("}")) {
      current = undefined;
      continue;
    }
    const member = /^ {2}(?:readonly )?(\w+\??)\s*[:(]/.exec(line);
    if (current !== undefined && member?.[1] !== undefined) {
      current.push(member[1]);
    }
  }
  return out;
}

/** The TypeScript blocks of `docs/07` §4.3, joined. */
function section43Blocks(): string {
  const doc = readFileSync(
    resolve(ROOT, "docs/07-architecture-and-data-model.md"),
    "utf8",
  );
  const start = doc.indexOf("### 4.3 `LLMProvider`");
  const end = doc.indexOf("### 4.4 `TTSProvider`");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const section = doc.slice(start, end);
  return [...section.matchAll(/```ts\r?\n([\s\S]*?)```/g)]
    .map((match) => match[1] ?? "")
    .join("\n");
}

describe("src/llm/types.ts transcribes docs/07 §4.3 (P3-T06 step 1)", () => {
  it("declares every §4.3 interface and type, with the same members, and nothing else", () => {
    const doc = declarations(section43Blocks());
    const src = declarations(
      readFileSync(resolve(ROOT, "src/llm/types.ts"), "utf8"),
    );
    // The §4.3 blocks include the router's surface (owner, item 248).
    expect([...doc.keys()]).toEqual(
      expect.arrayContaining(["LLMProvider", "LLMRouter", "ModelPurpose"]),
    );
    expect(Object.fromEntries(src)).toEqual(Object.fromEntries(doc));
  });

  it("lets a stub implement every LLMProvider member, optional ones included", async () => {
    const stub: LLMProvider = {
      id: "openai",
      displayNameKey: "rh-stub",
      rateLimitKey: "api.openai.com",
      isConfigured: () => true,
      validateCredentials: () =>
        Promise.resolve({ ok: true, messageKey: "rh-stub" }),
      listModels: () => Promise.resolve([]),
      getModel: () => undefined,
      chat: () => Promise.resolve(chatResponse("stub")),
      async *chatStream() {
        yield await Promise.resolve({ deltaText: "s", done: true });
      },
      embed: () => Promise.resolve([[0.1, 0.2]]),
      countTokens: () => 1,
    };
    const members = declarations(section43Blocks()).get("LLMProvider") ?? [];
    expect(members).toEqual([
      "id",
      "displayNameKey",
      "rateLimitKey",
      "isConfigured",
      "validateCredentials",
      "listModels",
      "getModel",
      "chat",
      "chatStream?",
      "embed?",
      "countTokens",
    ]);
    for (const member of members) {
      expect(stub).toHaveProperty(member.replace("?", ""));
    }
    expect(await stub.chat(request(), callContext())).toMatchObject({
      text: "stub",
    });
  });
});

// ---------------------------------------------------------------------------
// 2. The three model chains, over a stubbed PrefStore (step 3)
// ---------------------------------------------------------------------------

describe("resolveModel walks docs/12 §18.5's chains through the typed prefs", () => {
  it("cheap and standard: summaryModel, then <provider>.model", () => {
    for (const tier of ["cheap", "standard"] as const) {
      expect(
        routerOverPrefs({
          "openrouter.model": "or/base",
          summaryModel: "or/summary",
          reportModel: "or/report",
          "screening.model": "or/screen",
        }).resolveModel(tier),
      ).toEqual({
        providerId: "openrouter",
        modelId: "or/summary",
        fromPref: "summaryModel",
      });
      expect(
        routerOverPrefs({
          "openrouter.model": "or/base",
          reportModel: "or/report",
          "screening.model": "or/screen",
        }).resolveModel(tier),
      ).toEqual({
        providerId: "openrouter",
        modelId: "or/base",
        fromPref: "openrouter.model",
      });
    }
  });

  it("strong: reportModel, then <provider>.model — never summaryModel", () => {
    expect(
      routerOverPrefs({
        "openrouter.model": "or/base",
        summaryModel: "or/summary",
        reportModel: "or/report",
      }).resolveModel("strong"),
    ).toMatchObject({ modelId: "or/report", fromPref: "reportModel" });
    expect(
      routerOverPrefs({
        "openrouter.model": "or/base",
        summaryModel: "or/summary",
      }).resolveModel("strong"),
    ).toMatchObject({ modelId: "or/base", fromPref: "openrouter.model" });
  });

  it("screening: screening.model, then summaryModel, then <provider>.model — never reportModel", () => {
    const all = {
      "openrouter.model": "or/base",
      summaryModel: "or/summary",
      reportModel: "or/report",
    };
    expect(
      routerOverPrefs({ ...all, "screening.model": "or/screen" }).resolveModel(
        "screening",
      ),
    ).toMatchObject({ modelId: "or/screen", fromPref: "screening.model" });
    expect(routerOverPrefs(all).resolveModel("screening")).toMatchObject({
      modelId: "or/summary",
      fromPref: "summaryModel",
    });
    expect(
      routerOverPrefs({
        "openrouter.model": "or/base",
        reportModel: "or/report",
      }).resolveModel("screening"),
    ).toMatchObject({ modelId: "or/base", fromPref: "openrouter.model" });
  });

  it("reads the active provider from llmProvider and its own <provider>.model", () => {
    const router = routerOverPrefs({
      llmProvider: "anthropic",
      "openrouter.model": "or/base",
      "anthropic.model": "claude-x",
    });
    expect(router.activeProvider()).toBe("anthropic");
    expect(router.resolveModel("strong")).toEqual({
      providerId: "anthropic",
      modelId: "claude-x",
      fromPref: "anthropic.model",
    });
  });

  it("falls back to the schema's llmProvider default for a value outside the set", () => {
    expect(routerOverPrefs({ llmProvider: "bogus" }).activeProvider()).toBe(
      "openrouter",
    );
  });

  it("treats a whitespace-only link as empty, and reads prefs on every call", () => {
    const store = createMemoryPrefStore({
      "openrouter.model": "or/base",
      summaryModel: "   ",
    });
    setPrefStore(store);
    const settings = createPrefLLMSettings();
    const router = createLLMRouter({
      registry: createLLMProviderRegistry(settings),
      settings,
    });
    expect(router.resolveModel("cheap").modelId).toBe("or/base");
    store.set("summaryModel", "or/summary");
    expect(router.resolveModel("cheap").modelId).toBe("or/summary");
  });

  it("throws ConfigurationError, inventing no model, when every link is empty", () => {
    const router = routerOverPrefs({ "openrouter.model": "" });
    for (const purpose of [
      "cheap",
      "standard",
      "strong",
      "screening",
    ] satisfies ModelPurpose[]) {
      expect(() => router.resolveModel(purpose)).toThrow(ConfigurationError);
    }
  });

  it("uses the §8.5 key strings src/prefs/keys.ts declares", () => {
    expect(SUMMARY_MODEL_PREF).toBe(PREF_KEYS.summaryModel);
    expect(REPORT_MODEL_PREF).toBe(PREF_KEYS.reportModel);
    expect(SCREENING_MODEL_PREF).toBe(PREF_KEYS.screeningModel);
    for (const id of PROVIDERS) {
      const names = PROVIDER_PREF_NAMES[id];
      expect(providerModelPref(id)).toBe(PREF_KEYS[names.model]);
      expect(PREF_KEYS[names.model]).toBe(`${id}.model`);
      expect(PREF_KEYS[names.baseUrl]).toBe(`${id}.baseUrl`);
      expect(PREF_KEYS[names.keyPresent]).toBe(`${id}.keyPresent`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Dispatch: FR-33, no silent failover, zero requests (step 4)
// ---------------------------------------------------------------------------

describe("the router dispatches to the active provider only", () => {
  it("throws MissingCredentialError and issues zero requests when no key is configured", async () => {
    const mock = mockLLM([chatResponse("never")]);
    const router = routerOverPrefs({}, [mock]);

    await expect(router.chat(request(), callContext())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    await expect(
      collect(router.chatStream(request(), callContext())),
    ).rejects.toBeInstanceOf(MissingCredentialError);
    expect(mock.calls).toHaveLength(0);
  });

  it("throws MissingCredentialError, zero requests, when the adapter says it is not configured", async () => {
    const mock = mockLLM([chatResponse("never")], { configured: false });
    const router = routerOverPrefs({ "openrouter.keyPresent": true }, [mock]);

    await expect(router.chat(request(), callContext())).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    expect(mock.calls).toHaveLength(0);
  });

  it("does not fail over to a configured provider when the active one has no key", async () => {
    const openrouter = mockLLM([chatResponse("wrong destination")]);
    const router = routerOverPrefs(
      { llmProvider: "openai", "openrouter.keyPresent": true },
      [openrouter],
    );

    const error: unknown = await router
      .chat(request(), callContext())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MissingCredentialError);
    expect((error as MissingCredentialError).providerId).toBe("openai");
    expect(openrouter.calls).toHaveLength(0);
  });

  it("throws ConfigurationError, not a credential error, for a key flag with no adapter", async () => {
    const router = routerOverPrefs({
      "gemini.keyPresent": true,
      llmProvider: "gemini",
    });
    const error: unknown = await router
      .chat(request(), callContext())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error).not.toBeInstanceOf(MissingCredentialError);
  });

  it("awaits beforeSend before the adapter, on chat and chatStream", async () => {
    const mock = mockLLM([chatResponse("one"), chatResponse("two")]);
    const router = routerOverPrefs({ "openrouter.keyPresent": true }, [mock]);
    const seen: number[] = [];
    const beforeSend = async (): Promise<void> => {
      await Promise.resolve();
      seen.push(mock.calls.length);
    };
    const ctx = { ...callContext(), beforeSend };
    await router.chat(request(), ctx);
    await collect(router.chatStream(request(), ctx));
    expect(seen).toEqual([0, 1]);
    expect(mock.calls).toHaveLength(2);
  });

  it("does not call beforeSend when the key check refuses, and a rejection sends nothing", async () => {
    const mock = mockLLM([chatResponse("never")]);
    const beforeSend = vi.fn(() => Promise.resolve());
    await expect(
      routerOverPrefs({}, [mock]).chat(request(), {
        ...callContext(),
        beforeSend,
      }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
    await expect(
      collect(
        routerOverPrefs({}, [mock]).chatStream(request(), {
          ...callContext(),
          beforeSend,
        }),
      ),
    ).rejects.toBeInstanceOf(MissingCredentialError);
    expect(beforeSend).not.toHaveBeenCalled();

    const router = routerOverPrefs({ "openrouter.keyPresent": true }, [mock]);
    await expect(
      router.chat(request(), {
        ...callContext(),
        beforeSend: () => Promise.reject(new Error("no log")),
      }),
    ).rejects.toThrow("no log");
    expect(mock.calls).toHaveLength(0);
  });

  it("throws OperationCancelledError, zero requests, for a cancelled token", async () => {
    const mock = mockLLM([chatResponse("never")]);
    const router = routerOverPrefs({ "openrouter.keyPresent": true }, [mock]);
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });

    await expect(
      router.chat(request(), { token: cts.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(mock.calls).toHaveLength(0);
  });

  it("checks the token itself, before an adapter that would not check it is called", async () => {
    // mockLLM checks the token too, so this adapter deliberately does not:
    // the router's own check is the only thing between it and a request.
    let reached = 0;
    const careless: LLMProvider = {
      ...mockLLM([chatResponse("never")]),
      chat: () => {
        reached += 1;
        return Promise.resolve(chatResponse("sent anyway"));
      },
    };
    const router = mockLLMRouter(
      [careless],
      mockSettings({ keyPresent: { openrouter: true } }),
    );
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });

    await expect(
      router.chat(request(), { token: cts.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    await expect(
      collect(router.chatStream(request(), { token: cts.token })),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(reached).toBe(0);
  });

  it("sends a configured call to the active provider with the request unchanged", async () => {
    const openrouter = mockLLM([chatResponse("from openrouter")]);
    const anthropic = mockLLM([chatResponse("from anthropic")], {
      id: "anthropic",
    });
    const router = routerOverPrefs(
      {
        llmProvider: "anthropic",
        "anthropic.keyPresent": true,
        "openrouter.keyPresent": true,
      },
      [openrouter, anthropic],
    );
    const sent = request(router.resolveModel("standard").modelId);

    const response = await router.chat(sent, callContext());

    expect(response.text).toBe("from anthropic");
    expect(anthropic.calls).toHaveLength(1);
    expect(anthropic.calls[0]?.request).toBe(sent);
    expect(openrouter.calls).toHaveLength(0);
  });

  it("chatStream falls back to one terminal chunk from chat when the provider has no chatStream", async () => {
    const mock = mockLLM([chatResponse("whole answer")]);
    const router = mockLLMRouter(
      [mock],
      mockSettings({ keyPresent: { openrouter: true } }),
    );

    const chunks = await collect(router.chatStream(request(), callContext()));

    expect(chunks).toEqual([
      {
        deltaText: "whole answer",
        done: true,
        usage: chatResponse("whole answer").usage,
      },
    ]);
    expect(mock.calls).toHaveLength(1);
  });

  it("chatStream passes a provider's own stream through", async () => {
    const mock = mockLLM([chatResponse("two words")], { streaming: true });
    const router = mockLLMRouter(
      [mock],
      mockSettings({ keyPresent: { openrouter: true } }),
    );

    const chunks = await collect(router.chatStream(request(), callContext()));

    expect(chunks.map((chunk) => chunk.deltaText).join("")).toBe("two words");
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1);
    // Item 268(d): the provider's own word-by-word stream, not the `chat`
    // fallback's single terminal chunk, which the assertions above also pass.
    expect(chunks).toEqual([
      { deltaText: "two ", done: false },
      { deltaText: "words", done: false },
      {
        deltaText: "",
        done: true,
        usage: chatResponse("two words").usage,
      },
    ]);
  });

  it("chatStream falls back to chat for a model whose catalogue says supportsStreaming: false, though the provider streams", async () => {
    const mock = mockLLM([chatResponse("two words")], {
      streaming: true,
      models: [mockModel("mock-small", { supportsStreaming: false })],
    });
    const router = mockLLMRouter(
      [mock],
      mockSettings({ keyPresent: { openrouter: true } }),
    );

    const chunks = await collect(router.chatStream(request(), callContext()));

    expect(chunks).toEqual([
      {
        deltaText: "two words",
        done: true,
        usage: chatResponse("two words").usage,
      },
    ]);
    expect(mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. The registry (step 2)
// ---------------------------------------------------------------------------

describe("the LLM provider registry", () => {
  it("refuses a second adapter for the same ProviderId", () => {
    const registry = createLLMProviderRegistry(mockSettings());
    registry.register(mockLLM([chatResponse("a")]));
    expect(() => registry.register(mockLLM([chatResponse("b")]))).toThrow(
      /already registered for "openrouter"/,
    );
    expect(registry.list()).toHaveLength(1);
  });

  it("is configured only with the key flag, an adapter, and the adapter's agreement", () => {
    const flags: Partial<Record<ProviderId, boolean>> = { openrouter: true };
    const registry = createLLMProviderRegistry(
      mockSettings({ keyPresent: flags }),
    );
    expect(registry.isConfigured("openrouter")).toBe(false); // no adapter
    registry.register(mockLLM([chatResponse("a")]));
    registry.register(mockLLM([chatResponse("b")], { id: "openai" }));
    registry.register(
      mockLLM([chatResponse("c")], { id: "gemini", configured: false }),
    );
    expect(registry.isConfigured("openrouter")).toBe(true);
    expect(registry.isConfigured("openai")).toBe(false); // no key flag
    flags.gemini = true;
    expect(registry.isConfigured("gemini")).toBe(false); // adapter disagrees
    flags.openrouter = false; // read on every call, never cached
    expect(registry.isConfigured("openrouter")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Base URLs (step 5)
// ---------------------------------------------------------------------------

describe("resolveBaseUrl and the effective host", () => {
  function resolver(overrides: Partial<Record<ProviderId, string>>): {
    resolve: ReturnType<typeof createBaseUrlResolver>;
    lines: string[];
  } {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => void lines.push(line) };
    const logger = createLogger({ sink, clock: createManualClock() });
    return {
      resolve: createBaseUrlResolver({
        override: (id) => overrides[id] ?? "",
        logger,
      }),
      lines,
    };
  }

  it("transcribes docs/03's four documented base URLs", () => {
    const doc = readFileSync(
      resolve(ROOT, "docs/03-llm-provider-integration.md"),
      "utf8",
    );
    const bases = [...doc.matchAll(/^Base: `(https:\/\/[^`]+)`/gm)].map(
      (match) => match[1],
    );
    expect(new Set(Object.values(DEFAULT_BASE_URLS))).toEqual(new Set(bases));
  });

  it("returns the documented default when the preference is empty", () => {
    const { resolve: r } = resolver({});
    for (const id of PROVIDERS) {
      expect(r.resolveBaseUrl(id)).toBe(DEFAULT_BASE_URLS[id]);
    }
  });

  it("returns a valid https:// override, without its trailing slash", () => {
    const { resolve: r, lines } = resolver({
      openai: "https://gateway.example.org/openai",
      anthropic: "https://proxy.example.org:8443/a/",
    });
    expect(r.resolveBaseUrl("openai")).toBe(
      "https://gateway.example.org/openai",
    );
    expect(r.resolveBaseUrl("anthropic")).toBe(
      "https://proxy.example.org:8443/a",
    );
    expect(r.effectiveHost("openai")).toBe("gateway.example.org");
    expect(r.effectiveHost("anthropic")).toBe("proxy.example.org:8443");
    expect(r.effectiveHost("gemini")).toBe("generativelanguage.googleapis.com");
    expect(lines).toHaveLength(0);
  });

  it("returns the default for http://, and logs the refusal once without the value", () => {
    const { resolve: r, lines } = resolver({
      openrouter: "http://insecure.example.org/v1",
    });
    expect(r.resolveBaseUrl("openrouter")).toBe(DEFAULT_BASE_URLS.openrouter);
    expect(r.resolveBaseUrl("openrouter")).toBe(DEFAULT_BASE_URLS.openrouter);
    expect(r.effectiveHost("openrouter")).toBe("openrouter.ai");
    const warns = lines.filter((line) => line.includes("baseUrl"));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("not-https");
    expect(warns[0]).not.toContain("insecure.example.org");
  });

  it("refuses an override carrying credentials, a query, or not a URL at all", () => {
    const { resolve: r, lines } = resolver({
      openai: "https://user:secret@gateway.example.org",
      gemini: "https://gateway.example.org/?key=abc",
      anthropic: "not a url",
    });
    expect(r.resolveBaseUrl("openai")).toBe(DEFAULT_BASE_URLS.openai);
    expect(r.resolveBaseUrl("gemini")).toBe(DEFAULT_BASE_URLS.gemini);
    expect(r.resolveBaseUrl("anthropic")).toBe(DEFAULT_BASE_URLS.anthropic);
    expect(lines.join("\n")).not.toContain("secret");
    expect(lines.join("\n")).toContain("carries-credentials");
  });

  it("is wired by registerProviders over the <provider>.baseUrl preference", () => {
    setPrefStore(
      createMemoryPrefStore({ "openai.baseUrl": "https://gw.example.org/v1" }),
    );
    const { baseUrls } = registerProviders({
      logger: createLogger({
        sink: { write: () => undefined },
        clock: createManualClock(),
      }),
    });
    expect(baseUrls.resolveBaseUrl("openai")).toBe("https://gw.example.org/v1");
    expect(baseUrls.resolveBaseUrl("openrouter")).toBe(
      DEFAULT_BASE_URLS.openrouter,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. The composition root (step 7)
// ---------------------------------------------------------------------------

class StubException extends Error {}

describe("installServices builds the LLM layer (P3-T06 step 7)", () => {
  it("constructs the registry and router, and puts that router in every job's context", async () => {
    const requests: string[] = [];
    const xhr: HttpTransportXhr = {
      status: 200,
      responseText: "",
      responseURL: "",
      getAllResponseHeaders: () => "",
    };
    const stub = StubException as unknown as HttpExceptionClass;
    const transport: HttpTransport = {
      request(_method, url) {
        requests.push(url);
        return Promise.resolve(xhr);
      },
      UnexpectedStatusException: stub as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
      TimeoutException: stub,
      BrowserOfflineException: stub,
      SecurityException: stub,
      CancelledException: stub,
    };
    const scopeErrors: unknown[] = [];
    const scope = createScope({
      description: "p3-t06 root",
      onError: (_message, error) => void scopeErrors.push(error),
      strict: true,
    });
    const graph = await installServices(scope, {
      transport,
      prefs: createMemoryPrefStore({ "openrouter.model": "or/base" }),
      version: "1.2.3",
      progressHeadline: "Research Helper",
      clock: createManualClock(),
      openProgressWindow: () => {
        throw new Error("no progress popup is expected in this test");
      },
    });
    try {
      // Each adapter card (`P3-T07`–`P3-T10`) registers one adapter here.
      expect(graph.llm.registry.get("openai")?.id).toBe("openai");
      expect(graph.llm.router.activeProvider()).toBe("openrouter");
      expect(graph.llm.router.resolveModel("cheap").modelId).toBe("or/base");

      const cts = createCancellationTokenSource();
      const first = graph.pipelineContext.forJob({
        pipelineId: "summarize",
        token: cts.token,
        openOn: "completion",
      });
      const second = graph.pipelineContext.forJob({
        pipelineId: "summarize",
        token: cts.token,
        openOn: "completion",
      });
      expect(first.context.llm).toBe(graph.llm.router);
      expect(second.context.llm).toBe(graph.llm.router);

      // The job passes its own guard: the shared router refuses a call
      // without one (owner, 2026-10-23, plan/00 §6 item 278(a)).
      await expect(
        first.context.llm.chat(request("or/base"), {
          token: cts.token,
          budget: first.context.budget,
        }),
      ).rejects.toBeInstanceOf(MissingCredentialError);
      expect(requests).toEqual([]);
      first.dispose();
      second.dispose();
    } finally {
      await scope.unregisterAll();
    }
    expect(scopeErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. The mock harness (step 8): docs/13 §2.2's scenarios
// ---------------------------------------------------------------------------

describe("mockLLM, the scripted in-process provider", () => {
  const configured = (): ReturnType<typeof mockSettings> =>
    mockSettings({ keyPresent: { openrouter: true } });

  it("drives a five-call script with one RateLimitError and one StructuredOutputError", async () => {
    const mock = mockLLM([
      chatResponse('{"n":1}'),
      new RateLimitError(429, 1000, "openrouter"),
      chatResponse('{"n":3}'),
      new StructuredOutputError("openrouter", "mock-small", "not JSON"),
      chatResponse('{"n":5}'),
    ]);
    const router = mockLLMRouter([mock], configured());
    const outcomes: unknown[] = [];
    for (let i = 0; i < 5; i += 1) {
      outcomes.push(
        await router
          .chat(request(), callContext())
          .then((response) => response.json)
          .catch((error: unknown) => error),
      );
    }

    expect(mock.calls.map((call) => call.index)).toEqual([1, 2, 3, 4, 5]);
    expect(outcomes[0]).toEqual({ n: 1 });
    expect(outcomes[1]).toBeInstanceOf(RateLimitError);
    expect(outcomes[2]).toEqual({ n: 3 });
    expect(outcomes[3]).toBeInstanceOf(StructuredOutputError);
    expect(outcomes[4]).toEqual({ n: 5 });
    // The transport retries the rate limit; the parse failure is the repair
    // prompt's to retry, never the transport's (P3-T38, item 244).
    expect(isRetriedAutomatically(outcomes[1])).toBe(true);
    expect(isRetriedAutomatically(outcomes[3])).toBe(false);
    expect(mock.remaining()).toBe(0);
  });

  it("retry-then-succeed and context-length: errors are thrown after the call is recorded", async () => {
    const mock = mockLLM([
      new RateLimitError(429, undefined, "openrouter"),
      new ContextLengthExceededError("openrouter", "mock-small", "too long"),
      chatResponse("short enough"),
    ]);
    const router = mockLLMRouter([mock], configured());

    await expect(router.chat(request(), callContext())).rejects.toBeInstanceOf(
      RateLimitError,
    );
    await expect(
      router.chat(request("mock-small", "x".repeat(1000)), callContext()),
    ).rejects.toBeInstanceOf(ContextLengthExceededError);
    const shrunk = await router.chat(request("mock-small", "x"), callContext());

    expect(shrunk.text).toBe("short enough");
    expect(mock.calls).toHaveLength(3);
    expect(mock.calls[2]?.request.messages[0]?.content).toBe("x");
  });

  it("budget stop: a guard that refuses the reservation stops the call before it is recorded", async () => {
    const limitUsd = 0.01;
    let spentUsd = 0;
    const guard: BudgetGuard = {
      reserve() {
        if (spentUsd >= limitUsd) {
          throw new BudgetExceededError("budget reached");
        }
      },
      settle() {
        spentUsd += 0.005;
      },
      get spentUsd() {
        return spentUsd;
      },
      limitUsd,
    };
    const mock = mockLLM([chatResponse("ok")]);
    const router = mockLLMRouter([mock], configured());

    const done: number[] = [];
    for (let item = 1; item <= 5; item += 1) {
      try {
        await router.chat(request(), callContext({ budget: guard }));
        done.push(item);
      } catch (error) {
        expect(error).toBeInstanceOf(BudgetExceededError);
        break;
      }
    }
    expect(done).toEqual([1, 2]);
    expect(mock.calls).toHaveLength(2);
  });

  it("cancel at 87/200: the 87th call is never issued and 86 are kept", async () => {
    const cts = createCancellationTokenSource();
    const mock = mockLLM([chatResponse("summary")]);
    const router = mockLLMRouter([mock], configured());

    const kept: number[] = [];
    let stoppedAt: number | undefined;
    for (let item = 1; item <= 200; item += 1) {
      if (item === 87) cts.cancel({ kind: "user" });
      try {
        await router.chat(request(), { token: cts.token });
        kept.push(item);
      } catch (error) {
        expect(error).toBeInstanceOf(OperationCancelledError);
        stoppedAt = item;
        break;
      }
    }
    expect(stoppedAt).toBe(87);
    expect(kept).toHaveLength(86);
    expect(mock.calls).toHaveLength(86);
  });

  it("schema violation: a scripted function can answer with malformed JSON", async () => {
    const mock = mockLLM([
      () => chatResponse("{not json"),
      (call) => chatResponse(`{"repairedOnCall":${String(call.index)}}`),
    ]);
    const router = mockLLMRouter([mock], configured());

    const bad = await router.chat(request(), callContext());
    const good = await router.chat(request(), callContext());

    expect(bad.json).toBeUndefined();
    expect(good.json).toEqual({ repairedOnCall: 2 });
  });

  it("counts tokens with the one heuristic and refuses an empty script", () => {
    const mock = mockLLM([chatResponse("x")]);
    expect(mock.countTokens("abcdefghijklmnopqrstuvwxyz0123456789a", "m")).toBe(
      10,
    );
    expect(() => mockLLM([])).toThrow(RangeError);
  });
});
