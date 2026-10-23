/**
 * The OpenAI adapter: `docs/07` §4.3's `LLMProvider` over the Responses API.
 *
 * **Scope.** `P3-T08`. OpenAI goes through the same internal path as every
 * other provider — the router (`src/llm/router.ts`), the one HTTP client
 * (`src/core/http/client.ts`), the one error map
 * (`src/llm/shared/errorMap.ts`) — and differs only here. The wire shapes are
 * `./mapper.ts`'s pure functions. Constructed and registered by
 * `registerProviders` in `src/bootstrap/registerProviders.ts`, the single
 * wiring point (`docs/07` §11.2 step 9).
 *
 * **Endpoints.** `POST {base}/responses` and `GET {base}/models`, where
 * `{base}` comes from the base-URL resolver (`src/llm/shared/baseUrl.ts`). The
 * documented base, `https://api.openai.com/v1`, already ends in `/v1`, so a
 * path is appended as `/responses`, never `/v1/responses` (`P3-T06`
 * contradiction 8); an override is a gateway's own base and is used as given.
 *
 * **Retries and waits (`P3-T38`, `plan/00` §6 item 244).** There is no retry
 * loop here. Every request carries `mapErrorResponse`, which hands a 400-or-
 * above answer to `mapProviderError` inside the client's attempt, so a spend
 * cap (`insufficient_quota`) ends after one attempt as `QuotaExceededError`
 * while an ordinary 429 is retried by the client's one `withRetry`. A 2xx is
 * handed to `mapProviderError` here, outside the loop, for the refusal row.
 * Every request waits up to `LLM_ATTEMPT_TIMEOUT_MS` (3 minutes, item 240);
 * a streamed one has 3 minutes without new text and 15 in all instead
 * (`llmAttemptTimeouts`, item 268(c)). A key Test's request instead makes one
 * attempt of at most 15 s, never retried (`LLM_KEY_TEST_ATTEMPT`; owner,
 * 2026-10-23, `plan/00` §6 item 279(b)).
 *
 * **Streaming (`P3-T11`).** `chatStream` sends `chat`'s body with
 * `stream: true` through the same `send`, in the client's streaming mode, and
 * reads it with `createOpenAiStreamDecoder` (`../shared/sse.ts`): no `[DONE]`
 * on this API, so `response.completed` / `response.incomplete` end the stream.
 *
 * **The key (D5, `docs/09` §2.1).** Read from the `SecretStore` on every call,
 * wrapped in `Secret` at once, and exposed exactly once, in
 * {@link authorizationHeaders}. A missing key is `MissingCredentialError` with
 * no request sent. The only header record ever logged has been through
 * `loggableHeaders` (`src/core/errors.ts`), the one redactor's header form.
 *
 * **`isConfigured()` is synchronous; the keystore is not.** `docs/07` §4.3
 * makes `isConfigured()` return a plain boolean, and every `SecretStore`
 * member returns a promise. So `isConfigured()` answers whether a keystore is
 * installed at all (`installServices` passes `undefined` when the startup
 * probe did not reach tier 1), and the key itself is looked up in that
 * keystore by `chat()` and `listModels()` before any request — the router has
 * already required `openai.keyPresent`. A cached presence answer was rejected:
 * after a key is entered it would stay "absent" for one call.
 */

import type { Clock } from "../../core/clock";
import { createSystemClock } from "../../core/clock";
import {
  LLMError,
  loggableHeaders,
  MissingCredentialError,
  OperationCancelledError,
  ResearchHelperError,
  UpstreamError,
} from "../../core/errors";
import {
  type ErrorResponseMapper,
  type HttpClient,
  httpRequest,
  type HttpResponse,
} from "../../core/http/client";
import type { Logger } from "../../core/logger";
import {
  LLM_KEY_TEST_ATTEMPT,
  llmAttemptTimeouts,
  type LlmAttemptLimits,
} from "../../core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../core/secretStore";
import { Secret } from "../../prefs/secrets";
import { type BaseUrlResolver, DEFAULT_BASE_URLS } from "../shared/baseUrl";
import { isKeyAcceptedFailure, mapProviderError } from "../shared/errorMap";
import { createOpenAiStreamDecoder, streamChat } from "../shared/sse";
import { estTokens } from "../shared/tokenEstimate";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  CredentialCheckResult,
  LLMCallContext,
  LLMProvider,
  ModelInfo,
} from "../types";

import {
  buildResponsesBody,
  parseResponsesJson,
  type ResponsesRequestBody,
  toChatResponse,
  toModelInfos,
} from "./mapper";

/** This adapter's `ProviderId`. */
export const OPENAI_PROVIDER_ID = "openai";

/** The keystore id this adapter reads (`docs/09` §1.7's `SecretId`). */
export const OPENAI_SECRET_ID: SecretId = "llm.openai";

/** `POST /v1/responses`, relative to a base that already ends in `/v1` (`docs/03` §2.1). */
export const RESPONSES_PATH = "/responses";

/** `GET /v1/models`, relative to the same base (`docs/03` §9.1). */
export const MODELS_PATH = "/models";

/**
 * The provider's display-name message id, `research-helper-provider-<id>`
 * like the other three adapters'. A literal, for the reason the source
 * adapters' display-name keys are: `src/llm/**` importing `src/i18n/**` would
 * add a dependency edge `docs/07` §2.3 does not have.
 *
 * `src/i18n/keys.ts` declares it in `MAIN_WINDOW_MESSAGE_IDS` and on
 * `KO_PRESENT`: provider names are not translated (`docs/08` §10.3), so both
 * bundles carry the English name (owner, 2026-10-21, `plan/00` §6 item
 * 262(b)). Until that date it was `research-helper-llm-provider-openai`, the
 * one id off the scheme. `test/unit/i18n/keys.test.ts` compares this copy
 * with that list.
 */
export const OPENAI_DISPLAY_NAME_KEY = "research-helper-provider-openai";

/**
 * The preference pane's success id (`P1-T44`'s `testOk` in
 * `src/ui/prefs/preferencesPane.ts`), spelled out because `llm/` may not
 * import `ui/`. `test/unit/llm/validateCredentials.test.ts` asserts all four
 * adapters return the pane's value (`P3-T14`).
 */
const TEST_OK_MESSAGE_KEY = "research-helper-prefs-test-ok";

/** The documented host, the `rateLimitKey` (`docs/03` §2.1). */
export const OPENAI_RATE_LIMIT_KEY = new URL(DEFAULT_BASE_URLS.openai).host;

/** What {@link createOpenAiProvider} needs. */
export interface OpenAiProviderDeps {
  /**
   * The HTTP client. Defaults to the installed one, through `httpRequest` —
   * `docs/13` §2.2's substitution point, which `P3-T30`'s replay transport
   * replaces. A unit test injects one over a fake transport.
   */
  readonly http?: HttpClient | undefined;
  /** The tier-1 keystore, or `undefined` when this build has none. */
  readonly secrets: SecretStore | undefined;
  /** `registerProviders`' resolver; asked on every request. */
  readonly baseUrls: BaseUrlResolver;
  /** For `latencyMs` and `mapProviderError`'s `Retry-After`. Defaults to the system clock. */
  readonly clock?: Clock;
  /** Debug lines; headers only through `loggableHeaders`. */
  readonly logger?: Logger;
}

/**
 * The request headers, with the key. **The one `expose()` call site** of this
 * adapter (`docs/09` §2.1, `P3-T01`).
 *
 * @param key - the wrapped key
 * @returns `Authorization` and, for a body, `Content-Type` (`docs/03` §2.2)
 */
export function authorizationHeaders(
  key: Secret,
  withBody: boolean,
): Record<string, string> {
  return {
    Authorization: `Bearer ${key.expose()}`,
    ...(withBody && { "Content-Type": "application/json" }),
  };
}

/**
 * Join a base URL and a path without a doubled slash or a doubled `/v1`.
 *
 * @param base - a resolved base URL, no trailing slash
 * @param path - {@link RESPONSES_PATH} or {@link MODELS_PATH}
 * @returns the request URL
 */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Build the OpenAI adapter.
 *
 * @param deps - see {@link OpenAiProviderDeps}
 * @returns the `LLMProvider`
 */
export function createOpenAiProvider(deps: OpenAiProviderDeps): LLMProvider {
  const clock = deps.clock ?? createSystemClock();
  const http: HttpClient = deps.http ?? {
    request: (method, url, options) => httpRequest({ ...options, method, url }),
  };
  /** The last `listModels()` answer, for `getModel()`; enrichment is `P3-T13`'s. */
  let known = new Map<string, ModelInfo>();

  /** Read the key from the keystore and wrap it; no request without one. */
  async function readKey(): Promise<Secret> {
    const store = deps.secrets;
    if (store === undefined)
      throw new MissingCredentialError(OPENAI_PROVIDER_ID);
    const raw = await store.get(OPENAI_SECRET_ID);
    if (raw === undefined || raw === "") {
      throw new MissingCredentialError(OPENAI_PROVIDER_ID);
    }
    return new Secret(raw);
  }

  /** `P3-T38`'s hook: the error answer, read before the client classifies it. */
  function errorHook(modelId: string): ErrorResponseMapper {
    return (response, nowEpochMs) =>
      mapProviderError(
        OPENAI_PROVIDER_ID,
        modelId,
        response.status,
        (name) => response.header(name),
        response.body,
        nowEpochMs,
      );
  }

  /**
   * The checks every returned answer gets, outside the retry loop: a refusal
   * on a 2xx, a non-2xx the hook left alone, and a body that is not JSON.
   */
  function checkedBody(
    response: HttpResponse,
    modelId: string,
  ): Record<string, unknown> {
    const mapped = mapProviderError(
      OPENAI_PROVIDER_ID,
      modelId,
      response.status,
      (name) => response.header(name),
      response.body,
      clock.now(),
    );
    if (mapped !== undefined) throw mapped;
    const parsed = parseResponsesJson(response.body);
    if (parsed === undefined) {
      throw new LLMError(
        OPENAI_PROVIDER_ID,
        modelId,
        `HTTP ${response.status} from openai: the body is not a JSON object`,
        { httpStatus: response.status },
      );
    }
    return parsed;
  }

  async function send(
    method: "GET" | "POST",
    path: string,
    modelId: string,
    ctx: LLMCallContext,
    body?: string,
    onBodyText?: (text: string) => void,
    limits: LlmAttemptLimits = llmAttemptTimeouts(onBodyText !== undefined),
  ): Promise<HttpResponse> {
    ctx.token.throwIfCancelled();
    const key = await readKey();
    const headers = authorizationHeaders(key, body !== undefined);
    const url = joinUrl(deps.baseUrls.resolveBaseUrl(OPENAI_PROVIDER_ID), path);
    deps.logger?.debug("openai request", {
      method,
      path,
      model: modelId,
      headers: loggableHeaders(headers),
    });
    return http.request(method, url, {
      headers,
      ...(body !== undefined && { body }),
      ...limits,
      token: ctx.token,
      mapErrorResponse: errorHook(modelId),
      ...(onBodyText !== undefined && { onBodyText }),
    });
  }

  /** The Responses API body for `request` (`docs/03` §2.3), one builder for both calls. */
  function responsesBody(request: ChatRequest): ResponsesRequestBody {
    return buildResponsesBody(request, {
      maxOutputTokensLimit: known.get(request.model)?.maxOutputTokens,
    });
  }

  /** `GET /v1/models`; a key Test passes `LLM_KEY_TEST_ATTEMPT` (item 279(b)). */
  async function listModels(
    ctx: LLMCallContext,
    limits?: LlmAttemptLimits,
  ): Promise<readonly ModelInfo[]> {
    const response = await send(
      "GET",
      MODELS_PATH,
      "",
      ctx,
      undefined,
      undefined,
      limits,
    );
    const models = toModelInfos(checkedBody(response, ""));
    known = new Map(models.map((model) => [model.id, model]));
    return models;
  }

  return {
    id: OPENAI_PROVIDER_ID,
    displayNameKey: OPENAI_DISPLAY_NAME_KEY,
    rateLimitKey: OPENAI_RATE_LIMIT_KEY,

    isConfigured(): boolean {
      return deps.secrets !== undefined;
    },

    async validateCredentials(
      ctx: LLMCallContext,
    ): Promise<CredentialCheckResult> {
      // `P3-T14`: `docs/09` §2.3's cheapest authenticated call, `GET
      // /v1/models` — the model list, never a completion, no user content —
      // through the same `send` as every other request. A failure answers
      // with the error's own message key (`docs/07` §4.3's note "as built").
      // One attempt of at most 15 s, never retried (item 279(b)).
      try {
        const models = await listModels(ctx, LLM_KEY_TEST_ATTEMPT);
        return { ok: true, messageKey: TEST_OK_MESSAGE_KEY, models };
      } catch (error) {
        if (error instanceof OperationCancelledError) throw error;
        if (!(error instanceof ResearchHelperError)) throw error;
        const httpStatus =
          error instanceof UpstreamError ? error.httpStatus : undefined;
        return {
          // A 429, or `insufficient_quota` as `QuotaExceededError`, means the
          // key was accepted (`docs/09` §2.3; item 279(a)).
          ok: isKeyAcceptedFailure(error),
          messageKey: error.messageKey,
          ...(httpStatus !== undefined && { httpStatus }),
        };
      }
    },

    listModels: (ctx) => listModels(ctx),

    getModel(modelId: string): ModelInfo | undefined {
      return known.get(modelId);
    },

    async chat(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): Promise<ChatResponse> {
      const body = JSON.stringify(responsesBody(request));
      const started = clock.now();
      const response = await send(
        "POST",
        RESPONSES_PATH,
        request.model,
        ctx,
        body,
      );
      const parsed = checkedBody(response, request.model);
      return toChatResponse(parsed, {
        request,
        latencyMs: Math.max(0, clock.now() - started),
      });
    },

    chatStream(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): AsyncIterable<ChatStreamChunk> {
      // `P3-T11`: the same body with `stream: true` (`docs/03` §6.1), through
      // the same `send` — key, hook, timeout — in the client's streaming mode.
      return streamChat({
        providerId: OPENAI_PROVIDER_ID,
        request,
        token: ctx.token,
        decoder: createOpenAiStreamDecoder(request, () => clock.now()),
        start: (hooks) =>
          send(
            "POST",
            RESPONSES_PATH,
            request.model,
            { ...ctx, token: hooks.token },
            JSON.stringify({ ...responsesBody(request), stream: true }),
            hooks.onBodyText,
          ),
      });
    },

    countTokens(text: string): number {
      // `docs/03` §10.1: OpenAI has no counting endpoint. The one heuristic
      // (`P3-T06`); every result is an estimate at the call site.
      return estTokens(text);
    },
  };
}
