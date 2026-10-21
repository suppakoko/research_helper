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
 * - `timeoutMs: LLM_ATTEMPT_TIMEOUT_MS` (3 minutes, item 240);
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
 * - `validateCredentials` is `P3-T14`'s (that card modifies this file); it
 *   throws `ConfigurationError` here and sends nothing.
 * - Streaming (`chatStream`) is `P3-T11`'s; the router falls back to `chat`.
 * - Budget enforcement (`LLMCallContext.budget`) is `P3-T16`'s.
 * - The effective privacy mode is `P3-T15`'s; until then
 *   {@link OpenRouterProviderDeps.privacyMode} is absent and `balanced` holds.
 */

import { type Clock, createSystemClock } from "../../core/clock";
import {
  ConfigurationError,
  LLMError,
  loggableHeaders,
  MissingCredentialError,
} from "../../core/errors";
import {
  type ErrorResponseMapper,
  type HttpClient,
  type HttpMethod,
  type HttpResponse,
  httpRequest,
} from "../../core/http/client";
import type { Logger } from "../../core/logger";
import { LLM_ATTEMPT_TIMEOUT_MS } from "../../core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../core/secretStore";
import { Secret } from "../../prefs/secrets";
import type { BaseUrlResolver } from "../shared/baseUrl";
import { mapProviderError } from "../shared/errorMap";
import { withSchemaInPrompt } from "../shared/jsonMode";
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
  type OpenRouterPrivacyMode,
  type OpenRouterProviderBlock,
  openRouterGuardrailError,
  toOpenRouterBody,
} from "./mapper";

/** The keystore id the key is read from (`docs/09` §1.7). */
export const OPENROUTER_SECRET_ID: SecretId = "llm.openrouter";

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
   * The effective privacy mode, read per request (`docs/09` §3.5). `P3-T15`
   * supplies it; absent means {@link DEFAULT_OPENROUTER_PRIVACY_MODE}.
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
        timeoutMs: LLM_ATTEMPT_TIMEOUT_MS,
        token: ctx.token,
        mapErrorResponse: hook,
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

    validateCredentials(): Promise<CredentialCheckResult> {
      return Promise.reject(
        new ConfigurationError(
          "openrouter: validateCredentials() is built by P3-T14 (GET /api/v1/key)",
          { providerId: OPENROUTER_PROVIDER_ID },
        ),
      );
    },

    async listModels(ctx: LLMCallContext): Promise<readonly ModelInfo[]> {
      const entries = await fetchCatalogue(ctx);
      return entries.map((entry) => entry.model);
    },

    listCatalogue: fetchCatalogue,

    getModel(modelId: string): ModelInfo | undefined {
      return catalogue?.get(modelId);
    },

    async chat(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): Promise<ChatResponse> {
      ctx.token.throwIfCancelled();
      const headers = openRouterHeaders(await readKey());
      const cap = catalogue?.get(request.model)?.maxOutputTokens;
      // `P3-T12` step 6: a model the fetched catalogue lists without
      // `structured_outputs` gets the schema in the prompt instead of
      // `response_format` + `require_parameters` (`docs/12` §18.2, `docs/06`
      // §6.4). Unknown (no catalogue yet) keeps the native field.
      const sent =
        catalogue?.get(request.model)?.supportsJsonSchema === false
          ? withSchemaInPrompt(request)
          : request;
      const body = toOpenRouterBody(sent, {
        privacyMode: deps.privacyMode?.() ?? DEFAULT_OPENROUTER_PRIVACY_MODE,
        ...(cap !== undefined && { maxOutputTokensCap: cap }),
      });
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
