/**
 * The Anthropic adapter — `docs/07` §4.3's `LLMProvider` over the Messages API.
 *
 * **Scope.** `P3-T09`. Registered by `registerProviders` in
 * `src/bootstrap/registerProviders.ts` (`docs/07` §11.2 step 9), reached only
 * through `docs/07` §4.3's `LLMRouter` (`src/llm/router.ts`). The wire shapes
 * and their mapping are `./mapper.ts`'s; this file sends, reads the key and
 * classifies.
 *
 * ## One door, one retry loop, one error mapping
 *
 * Every request goes through the shared `HttpClient`
 * (`src/core/http/client.ts`, `docs/13` §2.2's choke point): by default the
 * installed one, through `httpRequest`. Each request carries the three things
 * `P3-T38`'s note on the card asks for (`plan/00` §6 item 244):
 *
 * - `mapErrorResponse`, which calls `mapProviderError`
 *   (`src/llm/shared/errorMap.ts`) for an answer of 400 or above **inside**
 *   the attempt. So the spend-cap 429 (`ANTHROPIC_SPEND_CAP_CODE`, `docs/03`
 *   §11.1) ends after one attempt as `QuotaExceededError`, an ordinary 429 is
 *   still retried as `RateLimitError`, and the non-standard 529 overload
 *   (`docs/03` §11.5 trap 1) is a retryable `UpstreamServerError` marked
 *   `overloaded`;
 * - `timeoutMs: LLM_ATTEMPT_TIMEOUT_MS` (3 minutes, item 240);
 * - the job's cancellation token.
 *
 * The retry budget is not here: it is the host's `HOST_POLICIES` row
 * (`retry: LLM_RETRY_BUDGET`), which `createRetryFor` in
 * `src/bootstrap/container.ts` hands the client. This file writes no retry
 * loop. A 2xx is handed to `mapProviderError` here, outside the loop, for
 * `docs/03` §11.5 trap 2: a refusal arrives as HTTP 200 with
 * `stop_reason: "refusal"` and becomes `ContentFilterError` before `content`
 * is read (§3.4).
 *
 * ## The key
 *
 * Read from the `SecretStore` port (`src/core/secretStore.ts`) under
 * `llm.anthropic`, wrapped at once in `Secret` (`src/prefs/secrets.ts`,
 * `P3-T01`), and exposed in exactly one place, {@link anthropicHeaders}. A
 * header object reaches the log only through `loggableHeaders`
 * (`src/core/errors.ts`), which turns `x-api-key` into `[redacted:<length>]`.
 * No key is read from a preference, a file or the environment (D5).
 * {@link AnthropicProvider.isConfigured} answers from the keystore, not from
 * the `anthropic.keyPresent` flag alone (the registry checks the flag first).
 *
 * ## Token counts
 *
 * `countTokens` is synchronous and is the one heuristic, `estTokens`
 * (`src/llm/shared/tokenEstimate.ts`, `P3-T06`). The exact, free count over
 * `POST /v1/messages/count_tokens` (`docs/03` §10.1) is
 * {@link AnthropicProvider.countTokensExact}, a member of this adapter's own
 * type and **not** of `LLMProvider`: it falls back to the heuristic on any
 * failure, and a caller may use it to calibrate, never to gate (`docs/03`
 * §10.2; `P3-T16`).
 */

import { createSystemClock, type Clock } from "../../core/clock";
import {
  ConfigurationError,
  LLMError,
  loggableHeaders,
  MissingCredentialError,
  OperationCancelledError,
  RateLimitError,
  ResearchHelperError,
  UpstreamError,
} from "../../core/errors";
import {
  httpRequest,
  type ErrorResponseMapper,
  type HttpClient,
  type HttpMethod,
  type HttpResponse,
} from "../../core/http/client";
import type { Logger } from "../../core/logger";
import { LLM_ATTEMPT_TIMEOUT_MS } from "../../core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../core/secretStore";
import { Secret } from "../../prefs/secrets";
import { DEFAULT_BASE_URLS, type BaseUrlResolver } from "../shared/baseUrl";
import { mapProviderError } from "../shared/errorMap";
import { estTokens } from "../shared/tokenEstimate";
import type {
  ChatRequest,
  ChatResponse,
  CredentialCheckResult,
  LLMCallContext,
  LLMProvider,
  ModelInfo,
} from "../types";

import {
  ANTHROPIC_VERSION,
  COUNT_TOKENS_PATH,
  MESSAGES_PATH,
  MODELS_PATH,
  toChatResponse,
  toCountTokensBody,
  toMessagesBody,
  toModelsPage,
  toTokenCount,
  type StructuredOutputMode,
} from "./mapper";

/** This adapter's `ProviderId`. */
export const ANTHROPIC_PROVIDER_ID = "anthropic";

/** The keystore id the key is read from (`docs/09` §1.7). */
export const ANTHROPIC_SECRET_ID: SecretId = "llm.anthropic";

/**
 * `LLMProvider.displayNameKey`. A literal, for the reason the source
 * adapters' display-name keys are: `src/llm/**` importing `src/i18n/**` would
 * add a dependency edge `docs/07` §2.3 does not have.
 */
export const ANTHROPIC_DISPLAY_NAME_KEY = "research-helper-provider-anthropic";

/**
 * The documented host (`docs/03` §3.1), which is also this adapter's
 * `rateLimitKey`: the `HOST_POLICIES` row is keyed by it.
 */
export const ANTHROPIC_HOST = new URL(DEFAULT_BASE_URLS.anthropic).host;

/**
 * The pane's existing success id (`P1-T44`, `src/ui/prefs/preferencesPane.ts`
 * `testOk`), spelled out because `llm/` may not import `ui/`. It takes a
 * `time` argument the pane supplies. `P3-T14` owns the Test outcome set.
 */
const TEST_OK_MESSAGE_KEY = "research-helper-prefs-test-ok";

/** What {@link createAnthropicProvider} needs. */
export interface AnthropicProviderDeps {
  /**
   * The installed `SecretStore`, or `undefined` when this build has none (no
   * usable keystore). With none, the adapter is not configured and every call
   * throws `MissingCredentialError` before any request.
   */
  readonly secrets: SecretStore | undefined;
  /** `src/llm/shared/baseUrl.ts`'s resolver: the override, or `docs/03` §3.1's base. */
  readonly baseUrls: BaseUrlResolver;
  /**
   * The shared client. Defaults to the installed one, through `httpRequest`
   * (`docs/13` §2.2's substitution point). A test injects one over a fake
   * transport.
   */
  readonly http?: HttpClient;
  /** For `latencyMs` and the error hook's clock. Defaults to the system clock. */
  readonly clock?: Clock;
  readonly logger?: Logger;
}

/**
 * The Anthropic adapter's own type: `LLMProvider` plus two members the
 * interface deliberately lacks (`P3-T09` **Do NOT**: no member is added to
 * `LLMProvider` for the exact count).
 */
export interface AnthropicProvider extends LLMProvider {
  readonly id: "anthropic";
  /**
   * The exact input-token count of `request` over `POST
   * /v1/messages/count_tokens` (`docs/03` §10.1, free). On any failure —
   * no key, an HTTP error, a body that is not a count — it returns the
   * heuristic, `estTokens` over the request's text. A cancelled token still
   * throws `OperationCancelledError`: a cancel is not a failure to count.
   */
  countTokensExact(request: ChatRequest, ctx: LLMCallContext): Promise<number>;
  /**
   * Ask the keystore whether `llm.anthropic` is stored, and remember the
   * answer for {@link LLMProvider.isConfigured}. Never decrypts
   * (`SecretStore.has`).
   */
  refreshKeyPresence(): Promise<boolean>;
}

/**
 * Build `docs/03` §3.2's headers. **The only `expose()` call in this
 * adapter**: the key leaves its `Secret` here and nowhere else.
 */
function anthropicHeaders(key: Secret): Record<string, string> {
  return {
    "x-api-key": key.expose(),
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
    // `docs/03` §1.2 and §3.2: belt-and-braces for a request from a browser
    // origin; Zotero's privileged context sends none.
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

/** `P3-T38`'s hook: `mapProviderError` asked inside every attempt. */
function errorHook(modelId: string): ErrorResponseMapper {
  return (response, nowEpochMs) =>
    mapProviderError(
      ANTHROPIC_PROVIDER_ID,
      modelId,
      response.status,
      (name) => response.header(name),
      response.body,
      nowEpochMs,
    );
}

/** The heuristic count of everything a request sends, rounded once. */
function heuristicCount(request: ChatRequest): number {
  return estTokens(request.messages.map((message) => message.content).join(""));
}

/**
 * Build the adapter.
 *
 * @param deps - see {@link AnthropicProviderDeps}
 * @returns the adapter, for `registerProviders` to register
 */
export function createAnthropicProvider(
  deps: AnthropicProviderDeps,
): AnthropicProvider {
  const clock = deps.clock ?? createSystemClock();
  const http: HttpClient = deps.http ?? {
    request: (method, url, options) =>
      httpRequest({ method, url, ...(options ?? {}) }),
  };
  const { logger, baseUrls } = deps;

  /** Models from the last `listModels()`, for `getModel`. */
  let catalogue = new Map<string, ModelInfo>();
  /** The keystore's last answer: `undefined` until one arrives. */
  let presence: boolean | undefined;
  /** Numbers each check and each key read, so an older answer never overwrites a newer one. */
  let latest = 0;
  /** `isConfigured`'s background check, while one is in flight. */
  let background: Promise<boolean> | undefined;

  function refreshKeyPresence(): Promise<boolean> {
    const store = deps.secrets;
    if (store === undefined) {
      presence = false;
      return Promise.resolve(false);
    }
    const ticket = ++latest;
    return store.has(ANTHROPIC_SECRET_ID).then(
      (stored) => {
        if (ticket === latest) presence = stored;
        return stored;
      },
      (error: unknown) => {
        // A keystore that cannot answer has not said "absent"; the next
        // call reads the key itself and fails there if it must.
        if (ticket === latest) presence = undefined;
        logger?.warn("anthropic: keystore presence check failed", {
          err: error,
        });
        return false;
      },
    );
  }

  /** The key, wrapped; `MissingCredentialError` with no request when absent. */
  async function readKey(): Promise<Secret> {
    const store = deps.secrets;
    if (store === undefined) {
      presence = false;
      throw new MissingCredentialError(ANTHROPIC_PROVIDER_ID);
    }
    const ticket = ++latest;
    const raw = await store.get(ANTHROPIC_SECRET_ID);
    if (ticket === latest) presence = raw !== undefined && raw !== "";
    if (raw === undefined || raw === "") {
      throw new MissingCredentialError(ANTHROPIC_PROVIDER_ID);
    }
    return new Secret(raw);
  }

  /** One request through the shared client, with the key, the hook and the 3-minute attempt. */
  async function send(
    method: HttpMethod,
    path: string,
    body: string | undefined,
    modelId: string,
    ctx: LLMCallContext,
  ): Promise<HttpResponse> {
    ctx.token.throwIfCancelled();
    const headers = anthropicHeaders(await readKey());
    logger?.debug("anthropic request", {
      method,
      path,
      headers: loggableHeaders(headers),
    });
    return http.request(
      method,
      `${baseUrls.resolveBaseUrl(ANTHROPIC_PROVIDER_ID)}${path}`,
      {
        headers,
        ...(body !== undefined && { body }),
        timeoutMs: LLM_ATTEMPT_TIMEOUT_MS,
        token: ctx.token,
        mapErrorResponse: errorHook(modelId),
      },
    );
  }

  /**
   * The parsed body of an answer the client returned (status below 400).
   * A 2xx refusal and any 3xx are thrown here, through `mapProviderError`.
   */
  function readAnswer(response: HttpResponse, modelId: string): unknown {
    const failure = mapProviderError(
      ANTHROPIC_PROVIDER_ID,
      modelId,
      response.status,
      (name) => response.header(name),
      response.body,
      clock.now(),
    );
    if (failure !== undefined) throw failure;
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      // The body is never copied: it is the user's material and the model's.
      throw new LLMError(
        ANTHROPIC_PROVIDER_ID,
        modelId,
        `HTTP ${response.status} from anthropic: the body is not JSON`,
        { httpStatus: response.status },
      );
    }
  }

  /** `json_schema`'s wire form for `modelId`, or `undefined` for any other request. */
  function structuredMode(
    request: ChatRequest,
  ): StructuredOutputMode | undefined {
    if (request.responseFormat?.kind !== "json_schema") return undefined;
    // `docs/03` §7.2: `output_config.format` is the path; the strict tool is
    // the fallback for a model the catalogue says lacks structured outputs.
    return catalogue.get(request.model)?.supportsJsonSchema === false
      ? "strict_tool"
      : "output_config";
  }

  /**
   * `max_tokens`, which Anthropic requires (`docs/03` §3.3): the request's
   * own value, clamped to the model's output cap when the catalogue knows it
   * (`docs/03` §14.3); else that cap. With neither, no number is invented
   * (`plan/README.md` §5 rule 4): the call is refused before any request.
   */
  function maxTokensFor(request: ChatRequest): number {
    const cap = catalogue.get(request.model)?.maxOutputTokens;
    if (request.maxOutputTokens !== undefined) {
      return cap === undefined
        ? request.maxOutputTokens
        : Math.min(request.maxOutputTokens, cap);
    }
    if (cap !== undefined) return cap;
    throw new ConfigurationError(
      "anthropic requires max_tokens: set ChatRequest.maxOutputTokens, or " +
        "list the models first so the model's output cap is known",
      { providerId: ANTHROPIC_PROVIDER_ID, modelId: request.model },
    );
  }

  const provider: AnthropicProvider = {
    id: ANTHROPIC_PROVIDER_ID,
    displayNameKey: ANTHROPIC_DISPLAY_NAME_KEY,
    rateLimitKey: ANTHROPIC_HOST,

    isConfigured(): boolean {
      if (deps.secrets === undefined) return false;
      // Keep the answer fresh for the next call; this one uses the last.
      background ??= refreshKeyPresence().finally(() => {
        background = undefined;
      });
      return presence !== false;
    },

    refreshKeyPresence,

    async validateCredentials(
      ctx: LLMCallContext,
    ): Promise<CredentialCheckResult> {
      // `docs/09` §2.3's cheapest authenticated call, `GET /v1/models`, and
      // never a completion. `P3-T14` owns the full outcome set and its
      // persistence; this answers with the error's own message key.
      try {
        const models = await provider.listModels(ctx);
        return { ok: true, messageKey: TEST_OK_MESSAGE_KEY, models };
      } catch (error) {
        if (error instanceof OperationCancelledError) throw error;
        if (!(error instanceof ResearchHelperError)) throw error;
        const httpStatus =
          error instanceof UpstreamError ? error.httpStatus : undefined;
        return {
          // `docs/09` §2.3: a 429 means the key was accepted.
          ok: error instanceof RateLimitError,
          messageKey: error.messageKey,
          ...(httpStatus !== undefined && { httpStatus }),
        };
      }
    },

    async listModels(ctx: LLMCallContext): Promise<readonly ModelInfo[]> {
      // `docs/03` §9.2: follow `has_more` / `last_id`, carried as `after_id`.
      const models = new Map<string, ModelInfo>();
      const seen = new Set<string>();
      let afterId: string | undefined;
      for (;;) {
        const path =
          afterId === undefined
            ? MODELS_PATH
            : `${MODELS_PATH}?after_id=${encodeURIComponent(afterId)}`;
        const response = await send("GET", path, undefined, "", ctx);
        const page = toModelsPage(readAnswer(response, ""));
        if (page === undefined) {
          throw new LLMError(
            ANTHROPIC_PROVIDER_ID,
            "",
            "GET /v1/models from anthropic: not a model list",
            { httpStatus: response.status },
          );
        }
        for (const model of page.models) models.set(model.id, model);
        if (page.skipped.length > 0) {
          logger?.debug(
            "anthropic: models without max_input_tokens or max_tokens left out",
            { skipped: page.skipped },
          );
        }
        if (!page.hasMore) break;
        if (page.lastId === undefined || seen.has(page.lastId)) {
          throw new LLMError(
            ANTHROPIC_PROVIDER_ID,
            "",
            "GET /v1/models from anthropic: has_more without a new last_id",
            { pages: seen.size + 1 },
          );
        }
        seen.add(page.lastId);
        afterId = page.lastId;
      }
      catalogue = models;
      return [...models.values()];
    },

    getModel(modelId: string): ModelInfo | undefined {
      return catalogue.get(modelId);
    },

    async chat(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): Promise<ChatResponse> {
      const mode = structuredMode(request);
      const body = toMessagesBody(
        request,
        maxTokensFor(request),
        mode ?? "output_config",
      );
      const startedMs = clock.now();
      const response = await send(
        "POST",
        MESSAGES_PATH,
        JSON.stringify(body),
        request.model,
        ctx,
      );
      const latencyMs = clock.now() - startedMs;
      const answer = toChatResponse(readAnswer(response, request.model), {
        request,
        mode,
        latencyMs,
      });
      if (answer === undefined) {
        throw new LLMError(
          ANTHROPIC_PROVIDER_ID,
          request.model,
          `HTTP ${response.status} from anthropic: not a Messages answer`,
          { httpStatus: response.status },
        );
      }
      return answer;
    },

    countTokens(text: string): number {
      return estTokens(text);
    },

    async countTokensExact(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): Promise<number> {
      try {
        const body = toCountTokensBody(
          request,
          structuredMode(request) ?? "output_config",
        );
        const response = await send(
          "POST",
          COUNT_TOKENS_PATH,
          JSON.stringify(body),
          request.model,
          ctx,
        );
        const exact = toTokenCount(readAnswer(response, request.model));
        if (exact !== undefined) return exact;
        logger?.debug("anthropic: count_tokens answer had no input_tokens");
      } catch (error) {
        if (error instanceof OperationCancelledError) throw error;
        logger?.debug("anthropic: exact count failed; heuristic used", {
          err: error,
        });
      }
      return heuristicCount(request);
    },
  };

  void refreshKeyPresence();
  return provider;
}
