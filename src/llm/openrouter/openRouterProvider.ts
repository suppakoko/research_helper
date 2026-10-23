/**
 * The OpenRouter adapter — `docs/07` §4.3's `LLMProvider` over OpenRouter's
 * Chat Completions surface, and the default provider (decision D6).
 *
 * **Scope.** `P3-T07`. Registered by `registerProviders` in
 * `src/bootstrap/registerProviders.ts` (`docs/07` §11.2 step 9) and reached
 * only through `docs/07` §4.3's `LLMRouter` (`src/llm/router.ts`). Wire shapes
 * live in `./mapper.ts`, the catalogue parse in `./catalogue.ts`; this file
 * reads the key, sends, and classifies.
 *
 * ## One door, one retry loop, one error mapping
 *
 * Every request goes through the shared `HttpClient` (`src/core/http/
 * client.ts`, `docs/03` §14.4 and `docs/13` §2.2's single choke point) — by
 * default the installed one through `httpRequest`, the name a replay transport
 * substitutes. Each request carries what `P3-T38`'s note on the card asks for
 * (`plan/00` §6 item 244):
 *
 * - `mapErrorResponse`, which calls `mapProviderError`
 *   (`src/llm/shared/errorMap.ts`) for an answer of 400 or above **inside**
 *   the attempt — so OpenRouter's 402 spend cap ends after one attempt as
 *   `QuotaExceededError` while an ordinary 429 is still retried. A chat
 *   request's hook first asks {@link isGuardrailNotFound} (`docs/09` §3.4
 *   rule 2) and returns {@link openRouterGuardrailError} for that 404;
 * - `timeoutMs: LLM_ATTEMPT_TIMEOUT_MS` (3 minutes, item 240), or for a
 *   stream 15 minutes in all and 3 without new text (`llmAttemptTimeouts`,
 *   item 268(c)); a key Test's requests instead carry
 *   `LLM_KEY_TEST_ATTEMPT`, one attempt of at most 15 s, never retried
 *   (owner, 2026-10-23, `plan/00` §6 item 279(b));
 * - the job's cancellation token.
 *
 * This file writes no retry loop: the retry budget belongs to the host's
 * `HOST_POLICIES` row (`retry: LLM_RETRY_BUDGET`, 1/s, burst 1, at most 3 in
 * flight; owner, 2026-10-21, `plan/00` §6 item 260), which `createRetryFor`
 * in `src/bootstrap/container.ts` hands the client. *(Corrected 2026-10-21:
 * this said the row was not added, the card's open line on LLM request rates
 * being unresolved.)* A 2xx is handed to
 * `mapProviderError` here, outside the loop, for the refusal row
 * (`finish_reason: "content_filter"` → `ContentFilterError`).
 *
 * ## The key
 *
 * Read from the `SecretStore` port (`src/core/secretStore.ts`) under
 * `llm.openrouter`, wrapped at once in `Secret` (`src/prefs/secrets.ts`,
 * `P3-T01`) and exposed in exactly one place, {@link openRouterHeaders}. A
 * header object reaches the log only through `loggableHeaders`
 * (`src/core/errors.ts`). No key is read from a preference, a file or the
 * environment (D5). The catalogue request carries **no** key: `GET
 * /api/v1/models` is public (`docs/03` §9.4), so none is sent.
 *
 * {@link OpenRouterProvider.isConfigured} answers from the keystore
 * (`P3-T06` report, Contradiction 12), through a remembered `SecretStore.has`
 * answer because the interface member is synchronous: `false` with no store
 * or after the store said "absent", otherwise `true` — and `chat()` reads the
 * key itself and throws `MissingCredentialError` before any request when it
 * is not there.
 *
 * ## Not here
 *
 * - *(Corrected 2026-10-23, `P3-T14`: `validateCredentials` was listed here
 *   as that card's and threw. It now sends `GET /api/v1/key` with the key,
 *   then reads the public catalogue, without the key, for `models`.)*
 * - *(Corrected 2026-10-21: streaming was listed here as `P3-T11`'s. That
 *   card added `chatStream`, which sends `chat`'s body — one builder,
 *   `chatBody` — with `stream: true`.)*
 * - Budget enforcement (`LLMCallContext.budget`) is `P3-T16`'s.
 * - *(Corrected 2026-10-21, `P3-T15`: this said the effective privacy mode
 *   was `P3-T15`'s and absent until then.)* A job's mode reaches the body per
 *   request: `routingHints(mode)` (`src/pipeline/shared/privacyPolicy.ts`)
 *   sets `ChatRequest.routing.requireZeroRetention` in strict mode, and
 *   `chatBody` sends it as `provider.zdr: true` for `chat` and `chatStream`
 *   alike — so a collection stricter than the global mode is honoured.
 *   {@link OpenRouterProviderDeps.privacyMode} is the global floor; the
 *   composition root does not pass it yet (`P3-T35`), so `balanced` holds.
 */

import { type Clock, createSystemClock } from "../../core/clock";
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
  type HttpMethod,
  type HttpResponse,
  httpRequest,
} from "../../core/http/client";
import type { Logger } from "../../core/logger";
import {
  LLM_KEY_TEST_ATTEMPT,
  llmAttemptTimeouts,
  type LlmAttemptLimits,
} from "../../core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../core/secretStore";
import { Secret } from "../../prefs/secrets";
import type { BaseUrlResolver } from "../shared/baseUrl";
import { isKeyAcceptedFailure, mapProviderError } from "../shared/errorMap";
import { withSchemaInPrompt } from "../shared/jsonMode";
import { createOpenRouterStreamDecoder, streamChat } from "../shared/sse";
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
  type OpenRouterCatalogueEntry,
  parseOpenRouterCatalogue,
} from "./catalogue";
import {
  CHAT_COMPLETIONS_PATH,
  DEFAULT_OPENROUTER_PRIVACY_MODE,
  fromOpenRouterAnswer,
  isGuardrailNotFound,
  joinBaseUrl,
  MODELS_PATH,
  OPENROUTER_ATTRIBUTION_HEADERS,
  OPENROUTER_PROVIDER_ID,
  type OpenRouterChatBody,
  type OpenRouterPrivacyMode,
  type OpenRouterProviderBlock,
  openRouterGuardrailError,
  toOpenRouterBody,
} from "./mapper";

/** The keystore id the key is read from (`docs/09` §1.7). */
export const OPENROUTER_SECRET_ID: SecretId = "llm.openrouter";

/**
 * `GET /api/v1/key`: the key's own metadata and limits, `docs/09` §2.3's Test
 * call for OpenRouter (`P3-T14`). Relative to the base, which ends in `/v1`.
 */
export const KEY_PATH = "/key";

/**
 * The preference pane's success id (`P1-T44`'s `testOk` in
 * `src/ui/prefs/preferencesPane.ts`), spelled out because `llm/` may not
 * import `ui/`. `test/unit/llm/validateCredentials.test.ts` asserts all four
 * adapters return the pane's value (`P3-T14`).
 */
const TEST_OK_MESSAGE_KEY = "research-helper-prefs-test-ok";

/** `LLMError`'s id, for an answer that is neither a 2xx nor an error (`P3-T14`). */
const UNREAD_ANSWER_MESSAGE_KEY = "rh-error-llm";

/**
 * `LLMProvider.displayNameKey`. A literal Fluent id, as the source adapters'
 * are.
 *
 * `src/i18n/keys.ts` declares it in `MAIN_WINDOW_MESSAGE_IDS` and on
 * `KO_PRESENT`: provider names are not translated (`docs/08` §10.3), so both
 * bundles carry the English name (owner, 2026-10-21, `plan/00` §6 item
 * 262(b)). `test/unit/i18n/keys.test.ts` compares this copy with that list.
 */
export const OPENROUTER_DISPLAY_NAME_KEY =
  "research-helper-provider-openrouter";

/** What {@link createOpenRouterProvider} needs. */
export interface OpenRouterProviderDeps {
  /**
   * The installed `SecretStore`, or `undefined` when this build has none (no
   * usable keystore). With none, the adapter is not configured and every chat
   * throws `MissingCredentialError` before any request.
   */
  readonly secrets: SecretStore | undefined;
  /** `src/llm/shared/baseUrl.ts`'s resolver: the override, or `docs/03` §5.1's base. */
  readonly baseUrls: BaseUrlResolver;
  /**
   * The shared client. Defaults to the installed one through `httpRequest`
   * (`docs/13` §2.2's substitution point). A test injects its own.
   */
  readonly http?: HttpClient;
  /** For `latencyMs` and the error hook. Defaults to the system clock. */
  readonly clock?: Clock;
  /**
   * The global privacy mode (`privacy.mode`), read per request (`docs/09`
   * §3.5); absent means {@link DEFAULT_OPENROUTER_PRIVACY_MODE}. A job's
   * stricter collection mode arrives on the request instead, as
   * `routing.requireZeroRetention` (`P3-T15`'s `routingHints`).
   */
  readonly privacyMode?: () => OpenRouterPrivacyMode;
  readonly logger?: Logger;
}

/** The OpenRouter adapter's own type: `LLMProvider` plus three members. */
export interface OpenRouterProvider extends LLMProvider {
  readonly id: "openrouter";
  /**
   * The catalogue with what `ModelInfo` cannot hold — `pricing.overrides[]`
   * and `supported_parameters` — for `P3-T13`'s pricing. Same request as
   * {@link LLMProvider.listModels}, which it also refreshes `getModel` from.
   */
  listCatalogue(
    ctx: LLMCallContext,
  ): Promise<readonly OpenRouterCatalogueEntry[]>;
  /**
   * Ask the keystore whether `llm.openrouter` is stored and remember the
   * answer for {@link LLMProvider.isConfigured}. Never decrypts
   * (`SecretStore.has`).
   */
  refreshKeyPresence(): Promise<boolean>;
}

/**
 * Build `docs/03` §5.2's headers. **The only `expose()` call in this
 * adapter**: the key leaves its `Secret` here and nowhere else.
 *
 * @param key - the wrapped key
 * @returns the request headers
 */
function openRouterHeaders(key: Secret): Record<string, string> {
  return {
    Authorization: `Bearer ${key.expose()}`,
    "Content-Type": "application/json",
    ...OPENROUTER_ATTRIBUTION_HEADERS,
  };
}

/**
 * Build the adapter.
 *
 * @param deps - see {@link OpenRouterProviderDeps}
 * @returns the adapter, for `registerProviders` to register
 */
export function createOpenRouterProvider(
  deps: OpenRouterProviderDeps,
): OpenRouterProvider {
  const clock = deps.clock ?? createSystemClock();
  const http: HttpClient = deps.http ?? {
    request: (method, url, options) =>
      httpRequest({ method, url, ...(options ?? {}) }),
  };
  const { baseUrls, logger } = deps;

  /** Models from the last catalogue fetch; `undefined` until one succeeds. */
  let catalogue: Map<string, ModelInfo> | undefined;
  /** The keystore's last answer: `undefined` until one arrives. */
  let presence: boolean | undefined;
  /**
   * Numbers each keystore question, so an answer that arrives after a newer
   * question was asked cannot overwrite the newer answer. Every call asks
   * afresh: sharing an in-flight question would hand a caller who asks right
   * after storing a key the answer from before it was stored.
   */
  let asked = 0;

  function refreshKeyPresence(): Promise<boolean> {
    const store = deps.secrets;
    if (store === undefined) {
      presence = false;
      return Promise.resolve(false);
    }
    asked += 1;
    const question = asked;
    return store.has(OPENROUTER_SECRET_ID).then(
      (stored) => {
        if (question === asked) presence = stored;
        return stored;
      },
      (error: unknown) => {
        // A keystore that could not answer has not said "absent"; `chat`
        // reads the key itself and fails there if it must.
        if (question === asked) presence = undefined;
        logger?.warn("openrouter: keystore presence check failed", {
          err: error,
        });
        return false;
      },
    );
  }

  /** The key, wrapped; `MissingCredentialError`, with no request, when absent. */
  async function readKey(): Promise<Secret> {
    const store = deps.secrets;
    if (store === undefined) {
      presence = false;
      throw new MissingCredentialError(OPENROUTER_PROVIDER_ID);
    }
    const raw = await store.get(OPENROUTER_SECRET_ID);
    // The key itself is the freshest answer: supersede any question in flight.
    asked += 1;
    presence = raw !== undefined && raw !== "";
    if (raw === undefined || raw === "") {
      throw new MissingCredentialError(OPENROUTER_PROVIDER_ID);
    }
    return new Secret(raw);
  }

  /**
   * `P3-T38`'s hook for one request. For a chat request (`block` given) the
   * guardrail 404 is recognised first; everything else is `mapProviderError`.
   */
  function errorHook(
    modelId: string,
    block: OpenRouterProviderBlock | undefined,
  ): ErrorResponseMapper {
    return (response, nowEpochMs) => {
      if (block !== undefined) {
        const modelKnownAbsent =
          catalogue !== undefined && !catalogue.has(modelId);
        if (
          isGuardrailNotFound(response.status, response.body, modelKnownAbsent)
        ) {
          return openRouterGuardrailError(modelId, response.status, block);
        }
      }
      return mapProviderError(
        OPENROUTER_PROVIDER_ID,
        modelId,
        response.status,
        (name) => response.header(name),
        response.body,
        nowEpochMs,
      );
    };
  }

  /** One request through the shared client, with the 3-minute attempt and the hook. */
  function send(
    method: HttpMethod,
    path: string,
    headers: Record<string, string> | undefined,
    body: string | undefined,
    hook: ErrorResponseMapper,
    ctx: LLMCallContext,
    onBodyText?: (text: string) => void,
    // A key Test's `LLM_KEY_TEST_ATTEMPT` (item 279(b)).
    limits: LlmAttemptLimits = llmAttemptTimeouts(onBodyText !== undefined),
  ): Promise<HttpResponse> {
    if (headers !== undefined) {
      logger?.debug("openrouter request", {
        method,
        path,
        headers: loggableHeaders(headers),
      });
    }
    return http.request(
      method,
      joinBaseUrl(baseUrls.resolveBaseUrl(OPENROUTER_PROVIDER_ID), path),
      {
        ...(headers !== undefined && { headers }),
        ...(body !== undefined && { body }),
        ...limits,
        token: ctx.token,
        mapErrorResponse: hook,
        ...(onBodyText !== undefined && { onBodyText }),
      },
    );
  }

  /**
   * The parsed body of an answer the client returned (status below 400). A
   * 2xx refusal and any 3xx are thrown here, through `mapProviderError`.
   */
  function readAnswer(response: HttpResponse, modelId: string): unknown {
    const failure = mapProviderError(
      OPENROUTER_PROVIDER_ID,
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
        OPENROUTER_PROVIDER_ID,
        modelId,
        `HTTP ${response.status} from openrouter: the body is not JSON`,
        { httpStatus: response.status },
      );
    }
  }

  async function fetchCatalogue(
    ctx: LLMCallContext,
    limits?: LlmAttemptLimits,
  ): Promise<readonly OpenRouterCatalogueEntry[]> {
    ctx.token.throwIfCancelled();
    // Public endpoint: no key, no headers (`docs/03` §9.4).
    const response = await send(
      "GET",
      MODELS_PATH,
      undefined,
      undefined,
      errorHook("", undefined),
      ctx,
      undefined,
      limits,
    );
    const { entries, skipped } = parseOpenRouterCatalogue(
      readAnswer(response, ""),
    );
    if (skipped > 0) {
      logger?.debug("openrouter: catalogue entries skipped", { skipped });
    }
    catalogue = new Map(entries.map((entry) => [entry.model.id, entry.model]));
    return entries;
  }

  /**
   * The request as sent and its body. One builder for `chat` and
   * `chatStream` (`P3-T11`), so the `provider` block — `data_collection`,
   * `zdr` — can never differ between them.
   */
  function chatBody(request: ChatRequest): {
    sent: ChatRequest;
    body: OpenRouterChatBody;
  } {
    const cap = catalogue?.get(request.model)?.maxOutputTokens;
    // `P3-T12` step 6: a model the fetched catalogue lists without
    // `structured_outputs` gets the schema in the prompt instead of
    // `response_format` + `require_parameters` (`docs/12` §18.2, `docs/06`
    // §6.4). Unknown (no catalogue yet) keeps the native field.
    const sent =
      catalogue?.get(request.model)?.supportsJsonSchema === false
        ? withSchemaInPrompt(request)
        : request;
    // `P3-T15` step 4: `zdr: true` when the global mode is strict, or when the
    // job's policy put `routing.requireZeroRetention` on the request.
    const body = toOpenRouterBody(sent, {
      privacyMode: deps.privacyMode?.() ?? DEFAULT_OPENROUTER_PRIVACY_MODE,
      ...(cap !== undefined && { maxOutputTokensCap: cap }),
    });
    return { sent, body };
  }

  const provider: OpenRouterProvider = {
    id: OPENROUTER_PROVIDER_ID,
    displayNameKey: OPENROUTER_DISPLAY_NAME_KEY,
    /** The host the request goes to: the documented one, or a gateway override's. */
    get rateLimitKey(): string {
      return baseUrls.effectiveHost(OPENROUTER_PROVIDER_ID);
    },

    isConfigured(): boolean {
      if (deps.secrets === undefined) return false;
      // Keep the answer fresh for the next call; this one uses the last.
      void refreshKeyPresence();
      return presence !== false;
    },

    async validateCredentials(
      ctx: LLMCallContext,
    ): Promise<CredentialCheckResult> {
      // `P3-T14`: `docs/09` §2.3's call, `GET /api/v1/key` with the key —
      // key metadata, never a completion, no user content — through the same
      // `send` and hook as every request. A failure answers with the error's
      // own message key (`docs/07` §4.3's note "as built").
      let response: HttpResponse;
      try {
        ctx.token.throwIfCancelled();
        const headers = openRouterHeaders(await readKey());
        // One attempt of at most 15 s, never retried (item 279(b)).
        response = await send(
          "GET",
          KEY_PATH,
          headers,
          undefined,
          errorHook("", undefined),
          ctx,
          undefined,
          LLM_KEY_TEST_ATTEMPT,
        );
      } catch (error) {
        if (error instanceof OperationCancelledError) throw error;
        if (!(error instanceof ResearchHelperError)) throw error;
        const httpStatus =
          error instanceof UpstreamError ? error.httpStatus : undefined;
        return {
          // `docs/09` §2.3: a 429 means the key was accepted, and so does
          // the 402 spend cap, `QuotaExceededError`, with its own pane line
          // (item 279(a)).
          ok: isKeyAcceptedFailure(error),
          messageKey: error.messageKey,
          ...(httpStatus !== undefined && { httpStatus }),
        };
      }
      if (response.status < 200 || response.status >= 300) {
        // The client hands back only answers below 400; a 3xx is not a
        // verdict on the key.
        return {
          ok: false,
          messageKey: UNREAD_ANSWER_MESSAGE_KEY,
          httpStatus: response.status,
        };
      }
      // The key was accepted. The model list is the public catalogue, which
      // carries no key (`docs/03` §9.4); without it the verdict still stands.
      let models: readonly ModelInfo[] | undefined;
      try {
        models = (await fetchCatalogue(ctx, LLM_KEY_TEST_ATTEMPT)).map(
          (entry) => entry.model,
        );
      } catch (error) {
        if (error instanceof OperationCancelledError) throw error;
        logger?.debug("openrouter: key accepted; catalogue unavailable", {
          error: error instanceof Error ? error.name : typeof error,
        });
      }
      return {
        ok: true,
        messageKey: TEST_OK_MESSAGE_KEY,
        httpStatus: response.status,
        ...(models !== undefined && { models }),
      };
    },

    async listModels(ctx: LLMCallContext): Promise<readonly ModelInfo[]> {
      const entries = await fetchCatalogue(ctx);
      return entries.map((entry) => entry.model);
    },

    listCatalogue: (ctx) => fetchCatalogue(ctx),

    getModel(modelId: string): ModelInfo | undefined {
      return catalogue?.get(modelId);
    },

    async chat(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): Promise<ChatResponse> {
      ctx.token.throwIfCancelled();
      const headers = openRouterHeaders(await readKey());
      const { sent, body } = chatBody(request);
      const started = clock.now();
      const response = await send(
        "POST",
        CHAT_COMPLETIONS_PATH,
        headers,
        JSON.stringify(body),
        errorHook(request.model, body.provider),
        ctx,
      );
      const latencyMs = clock.now() - started;
      const parsed = readAnswer(response, request.model);
      const answer = fromOpenRouterAnswer(parsed, sent);
      if (answer === undefined) {
        throw new LLMError(
          OPENROUTER_PROVIDER_ID,
          request.model,
          `HTTP ${response.status} from openrouter: no choices[0] in the answer`,
          { httpStatus: response.status },
        );
      }
      return { ...answer, latencyMs, raw: parsed };
    },

    chatStream(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): AsyncIterable<ChatStreamChunk> {
      // `P3-T11`: `chat`'s body with `stream: true` (`docs/03` §6.4), through
      // the same `send` and hook, read by `createOpenRouterStreamDecoder`.
      return streamChat({
        providerId: OPENROUTER_PROVIDER_ID,
        request,
        token: ctx.token,
        decoder: createOpenRouterStreamDecoder(request, () => clock.now()),
        start: async (hooks) => {
          hooks.token.throwIfCancelled();
          const headers = openRouterHeaders(await readKey());
          const { body } = chatBody(request);
          return send(
            "POST",
            CHAT_COMPLETIONS_PATH,
            headers,
            JSON.stringify({ ...body, stream: true }),
            errorHook(request.model, body.provider),
            { ...ctx, token: hooks.token },
            hooks.onBodyText,
          );
        },
      });
    },

    countTokens(text: string): number {
      return estTokens(text);
    },

    refreshKeyPresence,
  };

  // Ask the keystore once at construction, so the first `isConfigured()` after
  // startup already reflects it when the store answers quickly.
  void refreshKeyPresence();

  return provider;
}
