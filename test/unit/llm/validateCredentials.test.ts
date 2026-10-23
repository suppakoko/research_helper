/**
 * `P3-T14` — `validateCredentials()` on the four LLM adapters, the Test-key
 * outcome persisted through `src/zotero/keychain.ts`, its reset on rotation,
 * and the mid-job 401 policy in `src/core/jobQueue/queue.ts`.
 *
 * Layer 1 (`docs/13` §2.1): plain Node. **No live request and no live LLM
 * call**: every adapter is built over a fake `HttpClient` that answers from a
 * script and records what it was asked, exactly as each adapter's own test
 * file does. **Every key is synthetic and built at run time**
 * (`sk-rhsyn-p3t14-<random hex>`); none is printed.
 *
 * **Why three platform globals are stubbed.** `src/zotero/keychain.ts` builds
 * its login-info constructor from `Components` in its module body, and its
 * tier-1 functions call `Zotero.OSKeyStore` and `Services.logins`. The stubs
 * are the in-memory fakes `test/unit/zotero/sessionStore.test.ts` uses: a
 * reversible "encryption" that keeps the `oskv1:` prefix, and a login list.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeLogin {
  origin: string;
  httpRealm: string;
  username: string;
  password: string;
}

vi.hoisted(() => {
  const logins: FakeLogin[] = [];
  const globals = globalThis as Record<string, unknown>;
  globals.Components = {
    Constructor: () =>
      function FakeLoginInfo(
        this: FakeLogin,
        origin: string,
        _formActionOrigin: string | null,
        httpRealm: string,
        username: string,
        password: string,
      ): void {
        Object.assign(this, { origin, httpRealm, username, password });
      },
    interfaces: { nsILoginInfo: {} },
  };
  const PREFIX = "oskv1:";
  globals.Zotero = {
    OSKeyStore: {
      encrypt: (value: string): Promise<string> =>
        Promise.resolve(PREFIX + Buffer.from(value, "utf8").toString("base64")),
      decrypt: (value: string): Promise<string> =>
        Promise.resolve(
          Buffer.from(value.slice(PREFIX.length), "base64").toString("utf8"),
        ),
      isEncrypted: (value: string): boolean => value.startsWith(PREFIX),
    },
  };
  globals.Services = {
    logins: {
      initializationPromise: Promise.resolve(),
      searchLoginsAsync: (query: {
        origin: string;
        httpRealm: string;
      }): Promise<FakeLogin[]> =>
        Promise.resolve(
          logins.filter(
            (login) =>
              login.origin === query.origin &&
              login.httpRealm === query.httpRealm,
          ),
        ),
      addLoginAsync: (login: FakeLogin): Promise<void> => {
        logins.push(login);
        return Promise.resolve();
      },
      removeLogin: (login: FakeLogin): void => {
        const at = logins.indexOf(login);
        if (at >= 0) logins.splice(at, 1);
      },
    },
  };
});

import { createManualClock } from "../../../src/core/clock";
import { createMemoryPrefStore } from "../../../src/core/config";
import {
  AuthenticationError,
  AuthorizationError,
  BudgetExceededError,
  NetworkError,
  TimeoutError,
} from "../../../src/core/errors";
import {
  LLM_ATTEMPT_TIMEOUT_MS,
  LLM_KEY_TEST_TIMEOUT_MS,
} from "../../../src/core/rateLimit/hostLimiter";
import type {
  HttpClient,
  HttpMethod,
  HttpOptions,
  HttpResponse,
} from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { JobRow } from "../../../src/core/jobQueue/jobRecord";
import {
  createJobQueue,
  createLlmPool,
  runPooledItems,
  type JobNotifier,
  type JobStore,
} from "../../../src/core/jobQueue/queue";
import { createLogger, type LogSink } from "../../../src/core/logger";
import type { SecretId, SecretStore } from "../../../src/core/secretStore";
import { createAnthropicProvider } from "../../../src/llm/anthropic/anthropicProvider";
import { createGeminiProvider } from "../../../src/llm/gemini/geminiProvider";
import { createOpenAiProvider } from "../../../src/llm/openai/openAiProvider";
import { createOpenRouterProvider } from "../../../src/llm/openrouter/openRouterProvider";
import {
  createBaseUrlResolver,
  DEFAULT_BASE_URLS,
} from "../../../src/llm/shared/baseUrl";
import type {
  CredentialCheckResult,
  LLMProvider,
} from "../../../src/llm/types";
import type { ProviderId } from "../../../src/model/ids";
import { getPref, setPrefStore } from "../../../src/prefs";
import {
  FORBIDDEN_MESSAGE_KEY,
  PREFERENCES_L10N,
  REJECTED_MESSAGE_KEY,
  classifyLlmCheck,
  createPreferencesHost,
  type LlmKeyCheck,
} from "../../../src/ui/prefs/preferencesPane";
import * as keychain from "../../../src/zotero/keychain";

afterAll(() => {
  const globals = globalThis as Record<string, unknown>;
  delete globals.Components;
  delete globals.Zotero;
  delete globals.Services;
});

beforeEach(() => {
  setPrefStore(createMemoryPrefStore());
});

/* ---------------------------------------------------------------- fixtures */

const NOW = Date.UTC(2026, 9, 23, 9, 0, 0);

/** A synthetic, key-shaped value, different on every call. Never printed. */
function syntheticKey(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sk-rhsyn-p3t14-${hex}`;
}

/** Whether `text` holds any eight-character run of `key`. */
function holdsPartOf(text: string, key: string): boolean {
  for (let at = 0; at + 8 <= key.length; at += 1) {
    if (text.includes(key.slice(at, at + 8))) return true;
  }
  return false;
}

function memorySecrets(
  values: Partial<Record<SecretId, string>> = {},
): SecretStore {
  const map = new Map(Object.entries(values) as [SecretId, string][]);
  return {
    backend: "os-keychain",
    unattended: true,
    get: (id) => Promise.resolve(map.get(id)),
    set: (id, value) => {
      map.set(id, value);
      return Promise.resolve();
    },
    clear: (id) => {
      map.delete(id);
      return Promise.resolve();
    },
    has: (id) => Promise.resolve(map.has(id)),
    listStoredIds: () => Promise.resolve([...map.keys()]),
    clearAll: () => {
      const n = map.size;
      map.clear();
      return Promise.resolve(n);
    },
  };
}

type Answer =
  | {
      readonly status: number;
      readonly body?: string;
      readonly headers?: Record<string, string>;
    }
  | { readonly fail: unknown };

interface RecordedRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly options: HttpOptions;
}

/**
 * A fake `HttpClient`: answers from `answers` in order (the last repeats).
 * A status of 400 or above goes through the request's own
 * `mapErrorResponse`, as the shipped client does inside an attempt.
 */
function fakeClient(answers: readonly Answer[]): HttpClient & {
  readonly requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    request(method, url, options = {}) {
      const answer = answers[Math.min(requests.length, answers.length - 1)];
      requests.push({ method, url, options });
      if (answer === undefined) return Promise.reject(new Error("no answer"));
      if ("fail" in answer) return Promise.reject(answer.fail);
      const headers = new Map(
        Object.entries(answer.headers ?? {}).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      );
      const response: HttpResponse = {
        status: answer.status,
        url,
        body: answer.body ?? "",
        rawHeaders: "",
        header: (name) => headers.get(name.toLowerCase()),
      };
      if (response.status >= 400) {
        const mapped = options.mapErrorResponse?.(response, NOW);
        return Promise.reject(mapped ?? new Error(`HTTP ${response.status}`));
      }
      return Promise.resolve(response);
    },
  };
}

function recordingSink(): LogSink & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: (line) => {
      lines.push(line);
    },
    reportError: (line) => {
      lines.push(line);
    },
  };
}

const ctx = () => ({ token: createCancellationTokenSource().token });

/** Each provider's documented host, the only one its key may reach. */
const HOSTS: Record<ProviderId, string> = {
  openrouter: new URL(DEFAULT_BASE_URLS.openrouter).host,
  openai: new URL(DEFAULT_BASE_URLS.openai).host,
  gemini: new URL(DEFAULT_BASE_URLS.gemini).host,
  anthropic: new URL(DEFAULT_BASE_URLS.anthropic).host,
};

/** A successful list answer per provider, SYNTHETIC. */
const LIST_OK: Record<ProviderId, readonly Answer[]> = {
  openai: [
    {
      status: 200,
      body: JSON.stringify({
        object: "list",
        data: [
          { id: "gpt-rhsyn-a", object: "model", created: 1, owned_by: "x" },
        ],
      }),
    },
  ],
  anthropic: [
    {
      status: 200,
      body: JSON.stringify({
        data: [
          {
            type: "model",
            id: "claude-rhsyn-a",
            display_name: "Synthetic",
            created_at: "2026-03-01T00:00:00Z",
            max_input_tokens: 200_000,
            max_tokens: 64_000,
          },
        ],
        has_more: false,
        first_id: "claude-rhsyn-a",
        last_id: "claude-rhsyn-a",
      }),
    },
  ],
  gemini: [
    {
      status: 200,
      body: JSON.stringify({
        models: [
          {
            name: "models/gemini-rhsyn-a",
            displayName: "Synthetic",
            inputTokenLimit: 1_048_576,
            outputTokenLimit: 65_536,
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
    },
  ],
  // GET /api/v1/key, then the public catalogue (no key).
  openrouter: [
    {
      status: 200,
      body: JSON.stringify({ data: { label: "rhsyn", limit: null } }),
    },
    {
      status: 200,
      body: JSON.stringify({
        data: [
          {
            id: "rhsyn/model-a",
            name: "Synthetic A",
            created: 1788552838,
            context_length: 100_000,
            architecture: {
              modality: "text->text",
              input_modalities: ["text"],
              output_modalities: ["text"],
              tokenizer: "GPT",
            },
            pricing: { prompt: "0.000001", completion: "0.000002" },
            top_provider: {
              context_length: 100_000,
              max_completion_tokens: 8000,
              is_moderated: false,
            },
            supported_parameters: ["max_tokens"],
          },
        ],
      }),
    },
  ],
};

const SECRET_OF: Record<ProviderId, SecretId> = {
  openrouter: "llm.openrouter",
  openai: "llm.openai",
  gemini: "llm.gemini",
  anthropic: "llm.anthropic",
};

const PROVIDERS: readonly ProviderId[] = [
  "openrouter",
  "openai",
  "gemini",
  "anthropic",
];

function adapterFor(
  provider: ProviderId,
  http: HttpClient,
  secrets: SecretStore | undefined,
  sink = recordingSink(),
): LLMProvider {
  const clock = createManualClock(NOW);
  const logger = createLogger({ sink, clock, level: "debug" });
  const baseUrls = createBaseUrlResolver({ override: () => "" });
  switch (provider) {
    case "openrouter":
      return createOpenRouterProvider({
        http,
        secrets,
        baseUrls,
        clock,
        logger,
      });
    case "openai":
      return createOpenAiProvider({ http, secrets, baseUrls, clock, logger });
    case "gemini":
      return createGeminiProvider({ http, secrets, baseUrls, clock, logger });
    case "anthropic":
      return createAnthropicProvider({
        http,
        secrets,
        baseUrls,
        clock,
        logger,
      });
  }
}

const errorBody = JSON.stringify({ error: { message: "synthetic" } });

/* ------------------------------------------- 1. the adapters' outcome table */

describe("P3-T14 — validateCredentials() on each adapter (docs/09 §2.3)", () => {
  for (const provider of PROVIDERS) {
    describe(provider, () => {
      it("2xx: ok with the models, over its list endpoint on its own host, the key in a header and never a completion", async () => {
        const key = syntheticKey();
        const client = fakeClient(LIST_OK[provider]);
        const sink = recordingSink();
        const adapter = adapterFor(
          provider,
          client,
          memorySecrets({ [SECRET_OF[provider]]: key }),
          sink,
        );
        const result = await adapter.validateCredentials(ctx());
        expect(result.ok).toBe(true);
        // The pane's own success id: llm/ spells it out, the pane owns it.
        expect(result.messageKey).toBe(PREFERENCES_L10N.testOk);
        expect(result.models?.length).toBeGreaterThan(0);
        expect(client.requests.length).toBeGreaterThan(0);
        for (const request of client.requests) {
          expect(request.method).toBe("GET");
          expect(new URL(request.url).host).toBe(HOSTS[provider]);
          expect(request.url.includes(key)).toBe(false);
          expect(request.options.body).toBeUndefined();
        }
        const first = client.requests[0]!;
        const path = new URL(first.url).pathname;
        expect(path).toBe(
          {
            openrouter: "/api/v1/key",
            openai: "/v1/models",
            gemini: "/v1beta/models",
            anthropic: "/v1/models",
          }[provider],
        );
        // The key goes in its header on the authenticated call only.
        expect(JSON.stringify(first.options.headers)).toContain(key);
        if (provider === "gemini") {
          expect(first.options.headers?.["x-goog-api-key"]).toBe(key);
        }
        if (provider === "openrouter") {
          // The public catalogue carries no key at all.
          expect(client.requests[1]?.options.headers).toBeUndefined();
        }
        expect(holdsPartOf(JSON.stringify(result), key)).toBe(false);
        expect(holdsPartOf(sink.lines.join("\n"), key)).toBe(false);
      });

      it("401: ok false, httpStatus 401, a messageKey distinct from the 403 case; 403: forbidden", async () => {
        const key = syntheticKey();
        const secrets = memorySecrets({ [SECRET_OF[provider]]: key });
        const rejected = await adapterFor(
          provider,
          fakeClient([{ status: 401, body: errorBody }]),
          secrets,
        ).validateCredentials(ctx());
        const forbidden = await adapterFor(
          provider,
          fakeClient([{ status: 403, body: errorBody }]),
          secrets,
        ).validateCredentials(ctx());
        expect(rejected).toEqual({
          ok: false,
          httpStatus: 401,
          messageKey: REJECTED_MESSAGE_KEY,
        });
        expect(forbidden).toEqual({
          ok: false,
          httpStatus: 403,
          messageKey: FORBIDDEN_MESSAGE_KEY,
        });
        expect(rejected.messageKey).not.toBe(forbidden.messageKey);
        expect(classifyLlmCheck(rejected).outcome).toBe("rejected");
        expect(classifyLlmCheck(forbidden).outcome).toBe("forbidden");
        for (const result of [rejected, forbidden]) {
          expect(holdsPartOf(JSON.stringify(result), key)).toBe(false);
        }
      });

      it("429: ok true — the key was accepted", async () => {
        const result = await adapterFor(
          provider,
          fakeClient([{ status: 429, body: errorBody }]),
          memorySecrets({ [SECRET_OF[provider]]: syntheticKey() }),
        ).validateCredentials(ctx());
        expect(result.ok).toBe(true);
        expect(result.httpStatus).toBe(429);
        expect(classifyLlmCheck(result)).toEqual({
          outcome: "ok",
          rateLimited: true,
          noCredit: false,
        });
      });

      it("a network failure or a timeout: no HTTP status, so inconclusive with no answer", async () => {
        for (const fail of [
          new NetworkError("synthetic network failure", {}),
          new TimeoutError(180_000, "https://example.invalid/"),
        ]) {
          const result = await adapterFor(
            provider,
            fakeClient([{ fail }]),
            memorySecrets({ [SECRET_OF[provider]]: syntheticKey() }),
          ).validateCredentials(ctx());
          expect(result.ok).toBe(false);
          expect(result.httpStatus).toBeUndefined();
          expect(classifyLlmCheck(result)).toEqual({
            outcome: "inconclusive",
            reason: "no-answer",
            rateLimited: false,
            noCredit: false,
          });
        }
      });

      it("no key stored: no request at all", async () => {
        const client = fakeClient(LIST_OK[provider]);
        const result = await adapterFor(
          provider,
          client,
          memorySecrets(),
        ).validateCredentials(ctx());
        expect(result.ok).toBe(false);
        expect(client.requests).toEqual([]);
      });
    });
  }

  it("Gemini: a bad key answers HTTP 400 API_KEY_INVALID, which is rejected, not a bad request", async () => {
    const result = await adapterFor(
      "gemini",
      fakeClient([
        {
          status: 400,
          body: JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              details: [{ reason: "API_KEY_INVALID" }],
            },
          }),
        },
      ]),
      memorySecrets({ "llm.gemini": syntheticKey() }),
    ).validateCredentials(ctx());
    expect(result).toEqual({
      ok: false,
      httpStatus: 400,
      messageKey: REJECTED_MESSAGE_KEY,
    });
    expect(classifyLlmCheck(result).outcome).toBe("rejected");
  });

  it("OpenRouter: an accepted key stays ok when the public catalogue fails", async () => {
    const result = await adapterFor(
      "openrouter",
      fakeClient([LIST_OK.openrouter[0]!, { status: 503, body: errorBody }]),
      memorySecrets({ "llm.openrouter": syntheticKey() }),
    ).validateCredentials(ctx());
    expect(result.ok).toBe(true);
    expect(result.models).toBeUndefined();
  });

  it("the pane's two message keys are the error classes' own", () => {
    expect(REJECTED_MESSAGE_KEY).toBe(
      new AuthenticationError(401, "x", {}).messageKey,
    );
    expect(FORBIDDEN_MESSAGE_KEY).toBe(
      new AuthorizationError(403, "x", {}).messageKey,
    );
  });
});

/* ------------------ 1b. owner, 2026-10-23, plan/00 §6 item 279(a) and (b) */

/** Each provider's out-of-credit answer (`docs/03` §11.5), SYNTHETIC. */
const NO_CREDIT: Partial<Record<ProviderId, Answer>> = {
  openai: {
    status: 429,
    body: JSON.stringify({
      error: {
        message: "synthetic",
        type: "insufficient_quota",
        param: null,
        code: "insufficient_quota",
      },
    }),
  },
  anthropic: {
    status: 429,
    body: JSON.stringify({
      type: "error",
      error: {
        type: "rate_limit_error",
        message: "synthetic",
        details: { error_code: "enforced_spend_limit_reached" },
      },
    }),
  },
  openrouter: {
    status: 402,
    body: JSON.stringify({ error: { code: 402, message: "synthetic" } }),
  },
};

describe("item 279 — a key Test: its own out-of-credit line, one 15-second attempt", () => {
  for (const provider of ["openai", "anthropic", "openrouter"] as const) {
    it(`${provider}: an out-of-credit answer is a pass with rh-error-quota, classified noCredit and never rateLimited`, async () => {
      const answer = NO_CREDIT[provider]!;
      const result = await adapterFor(
        provider,
        fakeClient([answer]),
        memorySecrets({ [SECRET_OF[provider]]: syntheticKey() }),
      ).validateCredentials(ctx());
      expect(result).toEqual({
        ok: true,
        messageKey: "rh-error-quota",
        httpStatus: "status" in answer ? answer.status : undefined,
      });
      expect(classifyLlmCheck(result)).toEqual({
        outcome: "ok",
        rateLimited: false,
        noCredit: true,
      });
    });
  }

  for (const provider of PROVIDERS) {
    it(`${provider}: every request of a Test is one attempt of 15 s; listModels outside a Test keeps the 3-minute attempt and the retry budget`, async () => {
      const secrets = memorySecrets({ [SECRET_OF[provider]]: syntheticKey() });
      const tested = fakeClient(LIST_OK[provider]);
      await adapterFor(provider, tested, secrets).validateCredentials(ctx());
      expect(tested.requests.length).toBe(provider === "openrouter" ? 2 : 1);
      for (const request of tested.requests) {
        expect(request.options.timeoutMs).toBe(LLM_KEY_TEST_TIMEOUT_MS);
        expect(request.options.singleAttempt).toBe(true);
      }
      expect(LLM_KEY_TEST_TIMEOUT_MS).toBe(15_000);

      const listed = fakeClient(LIST_OK[provider]);
      await adapterFor(provider, listed, secrets).listModels(ctx());
      expect(listed.requests.length).toBeGreaterThan(0);
      for (const request of listed.requests) {
        expect(request.options.timeoutMs).toBe(LLM_ATTEMPT_TIMEOUT_MS);
        expect(request.options.singleAttempt).toBeUndefined();
      }
    });
  }
});

/* -------------------------------- 2. persisted through the keychain's rows */

describe("P3-T14 — the outcome is persisted in <provider>.lastValidationResult (docs/07 §8.5)", () => {
  function host(provider: ProviderId, client: HttpClient, key: string) {
    const secrets = memorySecrets({ [SECRET_OF[provider]]: key });
    const adapter = adapterFor(provider, client, secrets);
    const sink = recordingSink();
    const clock = createManualClock(NOW);
    return {
      sink,
      clock,
      host: createPreferencesHost({
        secrets,
        request: () => Promise.reject(new Error("no source request expected")),
        getBackendPref: () => "oskeystore",
        providerPrefs: {
          getActiveProvider: () => provider,
          getBaseUrl: () => "",
          setBaseUrl: () => undefined,
        },
        validateLlm: (p): Promise<LlmKeyCheck> =>
          p === provider
            ? adapter.validateCredentials(ctx())
            : Promise.reject(new Error("another provider")),
        validation: {
          read: keychain.readValidation,
          record: keychain.recordValidation,
        },
        clock,
        logger: createLogger({ sink, clock, level: "debug" }),
      }),
    };
  }

  const RESULT_PREF = {
    openrouter: "openrouterLastValidationResult",
    openai: "openaiLastValidationResult",
    gemini: "geminiLastValidationResult",
    anthropic: "anthropicLastValidationResult",
  } as const;
  const AT_PREF = {
    openrouter: "openrouterLastValidatedAt",
    openai: "openaiLastValidatedAt",
    gemini: "geminiLastValidatedAt",
    anthropic: "anthropicLastValidatedAt",
  } as const;

  for (const provider of PROVIDERS) {
    it(`${provider}: ok, rejected and forbidden are stored with the time; the stored record holds no part of the key`, async () => {
      const key = syntheticKey();
      for (const [answer, expected] of [
        [LIST_OK[provider], "ok"],
        [[{ status: 401, body: errorBody }], "rejected"],
        [[{ status: 403, body: errorBody }], "forbidden"],
        [[{ status: 429, body: errorBody }], "ok"],
        [[{ status: 503, body: errorBody }], "inconclusive"],
      ] as const) {
        const h = host(provider, fakeClient(answer), key);
        const report = await h.host.testKey(SECRET_OF[provider]);
        expect(report).toMatchObject({ kind: "tested", outcome: expected });
        expect(getPref(RESULT_PREF[provider])).toBe(expected);
        expect(getPref(AT_PREF[provider])).toBe(new Date(NOW).toISOString());
        const persisted = JSON.stringify(
          keychain.readValidation(SECRET_OF[provider]),
        );
        expect(holdsPartOf(persisted, key)).toBe(false);
        expect(holdsPartOf(JSON.stringify(report), key)).toBe(false);
        expect(holdsPartOf(h.sink.lines.join("\n"), key)).toBe(false);
        // The pane paints the stored result on load.
        const state = await h.host.readState();
        expect(
          state.credentials.find((c) => c.id === SECRET_OF[provider])?.lastTest,
        ).toMatchObject({ outcome: expected });
      }
    });

    it(`${provider}: a simulated network failure leaves lastValidationResult unchanged`, async () => {
      const key = syntheticKey();
      await host(provider, fakeClient(LIST_OK[provider]), key).host.testKey(
        SECRET_OF[provider],
      );
      expect(getPref(RESULT_PREF[provider])).toBe("ok");
      const stamp = getPref(AT_PREF[provider]);
      const failing = host(
        provider,
        fakeClient([{ fail: new NetworkError("synthetic", {}) }]),
        key,
      );
      failing.clock.advance(60_000);
      const report = await failing.host.testKey(SECRET_OF[provider]);
      expect(report).toMatchObject({
        outcome: "inconclusive",
        reason: "no-answer",
      });
      expect(getPref(RESULT_PREF[provider])).toBe("ok");
      expect(getPref(AT_PREF[provider])).toBe(stamp);
    });
  }

  it("item 279(a): an out-of-credit Test reports noCredit (never rateLimited) and stores ok; a rate-limit 429 reports rateLimited", async () => {
    const key = syntheticKey();
    const noCredit = await host(
      "openai",
      fakeClient([NO_CREDIT.openai!]),
      key,
    ).host.testKey("llm.openai");
    expect(noCredit).toMatchObject({ kind: "tested", outcome: "ok" });
    expect(noCredit).toHaveProperty("noCredit", true);
    expect(noCredit).not.toHaveProperty("rateLimited");
    expect(getPref("openaiLastValidationResult")).toBe("ok");
    const limited = await host(
      "openai",
      fakeClient([{ status: 429, body: errorBody }]),
      key,
    ).host.testKey("llm.openai");
    expect(limited).toHaveProperty("rateLimited", true);
    expect(limited).not.toHaveProperty("noCredit");
  });

  it("recordValidation refuses a value outside the enum, and tts.gemini has no rows", () => {
    expect(() =>
      keychain.recordValidation(
        "llm.openai",
        "maybe" as unknown as keychain.ValidationResult,
        "2026-10-23T09:00:00.000Z",
      ),
    ).toThrow(RangeError);
    expect(
      keychain.recordValidation("tts.gemini", "ok", "2026-10-23T09:00:00.000Z"),
    ).toBe(false);
    expect(keychain.readValidation("tts.gemini")).toBeUndefined();
  });

  it("recordValidation refuses, writing nothing, a record the redaction gate would change (P3-T36)", () => {
    keychain.recordValidation("llm.openai", "ok", "2026-10-23T09:00:00.000Z");
    const key = syntheticKey();
    expect(() =>
      keychain.recordValidation("llm.openai", "rejected", `at ${key}`),
    ).toThrow(RangeError);
    expect(keychain.readValidation("llm.openai")).toEqual({
      result: "ok",
      at: "2026-10-23T09:00:00.000Z",
    });
  });
});

/* ------------------------------------------------ 3. reset on rotation, §2.5 */

describe('P3-T14 — rotating or removing a key resets lastValidationResult to "" (docs/09 §2.5)', () => {
  const ids = Object.keys(keychain.VALIDATION_PREFS) as SecretId[];

  function stamp(): void {
    for (const id of ids) {
      keychain.recordValidation(id, "rejected", "2026-10-23T09:00:00.000Z");
    }
  }

  function expectReset(id: SecretId): void {
    expect(keychain.readValidation(id)).toEqual({ result: "", at: "" });
  }

  it("covers the same six credentials as the keyPresent flags", () => {
    expect(ids.sort()).toEqual(
      [
        "llm.anthropic",
        "llm.gemini",
        "llm.openai",
        "llm.openrouter",
        "source.ncbi",
        "source.semanticscholar",
      ].sort(),
    );
  });

  it("tier 1: setSecret and clearSecret reset the pair", async () => {
    for (const id of ids) {
      stamp();
      await keychain.setSecret(id, syntheticKey());
      expectReset(id);
      stamp();
      await keychain.clearSecret(id);
      expectReset(id);
    }
  });

  it("tier 1's store object and tier 2's session store reset it on set, clear and clearAll", async () => {
    for (const store of [
      keychain.createKeychainSecretStore(),
      keychain.createSessionSecretStore(),
    ]) {
      for (const id of ids) {
        stamp();
        await store.set(id, syntheticKey());
        expectReset(id);
        stamp();
        await store.clear(id);
        expectReset(id);
      }
      for (const id of ids) await store.set(id, syntheticKey());
      stamp();
      await store.clearAll();
      for (const id of ids) expectReset(id);
    }
    keychain.clearSessionSecrets();
  });
});

/* ------------------------------------------------ 4. the mid-job 401, §2.4 */

describe("P3-T14 — a mid-job 401 pauses the job once (docs/09 §2.4)", () => {
  function memoryJobStore(): JobStore {
    const rows = new Map<string, JobRow>();
    return {
      put(row) {
        rows.set(row.id, row);
        return Promise.resolve();
      },
      get(id) {
        return Promise.resolve(rows.get(id));
      },
      list(statuses) {
        return Promise.resolve(
          [...rows.values()].filter(
            (row) =>
              statuses === undefined ||
              (statuses as readonly string[]).includes(row.status),
          ),
        );
      },
    };
  }

  async function flush(rounds = 20): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
      await new Promise((done) => setImmediate(done));
    }
  }

  it("leaves a 200-item job paused with credential-required, the key stored, lastValidationResult rejected, and exactly one notification", async () => {
    const clock = createManualClock(NOW);
    const logger = createLogger({ sink: recordingSink(), clock });
    const notices: unknown[] = [];
    const notifier: JobNotifier = {
      paused(record) {
        notices.push(record);
      },
      resumed: () => Promise.resolve(),
    };
    const queue = createJobQueue({
      clock,
      logger,
      pluginVersion: "1.2.3",
      isResumable: () => true,
      notifier,
      newId: () => "job-1",
    });
    queue.attachStore(memoryJobStore());
    const job = await queue.enqueue("summarize", { items: 200 }, {});
    await queue.start(job.id);

    // The key, through the tier-2 store, as a job would hold it.
    const store = keychain.createSessionSecretStore();
    const key = syntheticKey();
    await store.set("llm.openai", key);
    keychain.recordValidation("llm.openai", "ok", "2026-10-22T09:00:00.000Z");

    // Every call meets the adapter's real 401 path.
    const adapter = adapterFor(
      "openai",
      fakeClient([{ status: 401, body: errorBody }]),
      store,
    );
    const items = Array.from({ length: 200 }, (_, i) => `w${String(i + 1)}`);
    let marks = 0;
    const run = runPooledItems({
      jobId: job.id,
      items,
      workKey: (item) => item,
      isDone: () => Promise.resolve(false),
      call: async (_item, token) => {
        await adapter.listModels({ token });
        return "never";
      },
      onResult: () => Promise.resolve(),
      pool: createLlmPool(() => 3),
      queue,
      clock,
      logger,
      onCredentialRejected: (error) => {
        marks += 1;
        keychain.markProviderKeyRejected(
          String(error.context["providerId"]),
          clock.now(),
        );
      },
    });
    await flush();

    const record = await queue.get(job.id);
    expect(record?.status).toBe("paused");
    expect(record?.pauseReason).toBe("credential-required");
    expect(notices).toHaveLength(1);
    expect(marks).toBe(1);
    expect(getPref("openaiLastValidationResult")).toBe("rejected");
    expect(getPref("openaiLastValidatedAt")).toBe(new Date(NOW).toISOString());
    // The key is kept (step 4), and no item was recorded as failed.
    expect(await store.get("llm.openai")).toBe(key);
    await run.cancel();
    const outcome = await run.result;
    expect(outcome.failed).toEqual([]);
    expect(outcome.completed).toBe(0);
    keychain.clearSessionSecrets();
  });

  it("a budget refusal arriving after the 401 does not turn the pause into budget-stop: the key is asked about first", async () => {
    const clock = createManualClock(NOW);
    const logger = createLogger({ sink: recordingSink(), clock });
    const notices: unknown[] = [];
    const queue = createJobQueue({
      clock,
      logger,
      pluginVersion: "1.2.3",
      isResumable: () => true,
      notifier: {
        paused(record) {
          notices.push(record);
        },
        resumed: () => Promise.resolve(),
      },
      newId: () => "job-2",
    });
    queue.attachStore(memoryJobStore());
    const job = await queue.enqueue("summarize", { items: 3 }, {});
    await queue.start(job.id);
    let refuseBudget: () => void = () => undefined;
    const budgetRefusal = new Promise<never>((_, reject) => {
      refuseBudget = () => {
        reject(new BudgetExceededError("synthetic ceiling"));
      };
    });
    budgetRefusal.catch(() => undefined);
    let rejectKey: () => void = () => undefined;
    const keyRefusal = new Promise<never>((_, reject) => {
      rejectKey = () => {
        reject(
          new AuthenticationError(401, "HTTP 401", { providerId: "openai" }),
        );
      };
    });
    keyRefusal.catch(() => undefined);
    let dispatched = 0;
    const run = runPooledItems({
      jobId: job.id,
      items: ["a", "b", "c"],
      workKey: (item) => item,
      isDone: () => Promise.resolve(false),
      call: (item) => {
        dispatched += 1;
        return item === "a" ? keyRefusal : budgetRefusal;
      },
      onResult: () => Promise.resolve(),
      pool: createLlmPool(() => 3),
      queue,
      clock,
      logger,
    });
    await flush(5);
    // All three are in flight; the 401 lands first, the budget refusals after.
    expect(dispatched).toBe(3);
    rejectKey();
    await flush(5);
    refuseBudget();
    await flush();
    const record = await queue.get(job.id);
    expect(record?.pauseReason).toBe("credential-required");
    expect(notices).toHaveLength(1);
    await run.cancel();
    expect((await run.result).failed).toEqual([]);
  });
});

/* ---------------------------------------------- 5. the result's own shape */

describe("P3-T14 — CredentialCheckResult is the pane's LlmKeyCheck", () => {
  it("passes an adapter's answer to the pane unchanged (a compile-time tie, asserted once at run time)", () => {
    const fromAdapter: CredentialCheckResult = {
      ok: true,
      messageKey: PREFERENCES_L10N.testOk,
      httpStatus: 200,
      models: [],
    };
    const forPane: LlmKeyCheck = fromAdapter;
    expect(classifyLlmCheck(forPane).outcome).toBe("ok");
  });
});
