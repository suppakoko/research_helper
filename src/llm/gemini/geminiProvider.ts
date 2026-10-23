/**
 * The Gemini adapter, over the Interactions API.
 *
 * **Scope.** `P3-T10`. `registerProviders` in
 * `src/bootstrap/registerProviders.ts` constructs it once, with the shared
 * `HttpClient`, the `SecretStore` and the base-URL resolver, and registers it
 * with the provider registry; `docs/07` §4.3's `LLMRouter` is the only thing
 * that calls {@link GeminiProvider.chat}. `P3-T15` calls
 * {@link GeminiProvider.detectTier}.
 *
 * **Authority.** `docs/03` §4 (the Interactions API), §9.3 (the model list),
 * §11.3/§11.5 (errors); `docs/09` §1.3, §2.1, §3.3 and §3.4 rule 4. Shapes are
 * read and written by `./mapper.ts`; this file only sends.
 *
 * ## The key: a header, never the URL
 *
 * Gemini also accepts `?key=…` in the query string. It is **never** used
 * (`docs/03` §1.3 and §4.2): a URL lands in logs, in `Zotero.debug()` output
 * and in crash reports. The key is read from the `SecretStore` on every
 * request, wrapped in `Secret` at once, and `expose()`d exactly once, in
 * {@link geminiHeaders}, into `x-goog-api-key`. A header map is only ever
 * logged through `loggableHeaders`, the one header redactor
 * (`src/core/errors.ts`).
 *
 * ## Errors and retries: the shared path, with no loop here
 *
 * Every request carries `mapErrorResponse`, which hands an error answer to
 * `mapProviderError` (`src/llm/shared/errorMap.ts`) inside the HTTP client's
 * own attempt (`P3-T38`, `plan/00` §6 item 244). The retry loop is the
 * client's `withRetry`, under the host row's budget; this file has none. Each
 * request waits up to `LLM_ATTEMPT_TIMEOUT_MS` (3 minutes, item 240; a
 * stream instead 3 minutes without new text and 15 in all,
 * `llmAttemptTimeouts`, item 268(c); a key Test's request instead one
 * attempt of at most 15 s, never retried, `LLM_KEY_TEST_ATTEMPT`, item
 * 279(b)). A 2xx is
 * also handed to `mapProviderError`, outside any loop, for the refusal row.
 *
 * **Two Gemini shapes are not documented and are not guessed at**
 * (`plan/reports/P3-T05.md`, Contradiction 9): a spend cap distinct from
 * `RESOURCE_EXHAUSTED` (so a Gemini 429 is an ordinary, retried rate limit),
 * and what the Interactions API returns when safety blocks an answer (so such
 * a block is recognised only if it arrives as a non-`completed` status, which
 * is refused as an `LLMError`, or in the legacy fields `mapProviderError`
 * already reads).
 *
 * ## Not built here
 *
 * - *(Corrected 2026-10-23, `P3-T14`: `validateCredentials()` was listed
 *   here as that card's and refused; it now sends the model-list call.)*
 * - *(Corrected 2026-10-21: streaming was listed here as `P3-T11`'s; that
 *   card added `chatStream`, whose Interactions payload shapes are
 *   assumptions — see `createGeminiStreamDecoder` in `../shared/sse.ts`.)*
 * - Spend reservation (`LLMCallContext.budget`) has no decided enforcer yet
 *   (`P3-T16`); this adapter does not call it.
 */

import { createSystemClock, type Clock } from "../../core/clock";
import {
  LLMError,
  loggableHeaders,
  MissingCredentialError,
  OperationCancelledError,
  ResearchHelperError,
  UpstreamError,
} from "../../core/errors";
import {
  httpRequest,
  type HttpClient,
  type HttpMethod,
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
import { DEFAULT_BASE_URLS, type BaseUrlResolver } from "../shared/baseUrl";
import { isKeyAcceptedFailure, mapProviderError } from "../shared/errorMap";
import { createGeminiStreamDecoder, streamChat } from "../shared/sse";
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
  buildGenerateContentBody,
  buildInteractionBody,
  parseJsonObject,
  readGenerateContent,
  readInteraction,
  readModelList,
  type InteractionReading,
  type InteractionRefusal,
} from "./mapper";
import {
  createGeminiTierDetector,
  type GeminiTier,
  type GeminiTierDetector,
} from "./tierDetect";

/** The keystore id this adapter reads (`SECRET_IDS`, `src/core/secretStore.ts`). */
export const GEMINI_SECRET_ID: SecretId = "llm.gemini";

/** The only header the key travels in (`docs/03` §4.2). */
export const GEMINI_API_KEY_HEADER = "x-goog-api-key";

/** The documented host, `docs/03` §4.1; the adapter's `rateLimitKey`. */
export const GEMINI_HOST = new URL(DEFAULT_BASE_URLS.gemini).host;

/** `POST` — text generation, current surface (`docs/03` §4.1). */
export const INTERACTIONS_PATH = "/v1beta/interactions";

/** `GET` — the model list (`docs/03` §9.3). */
export const MODELS_PATH = "/v1beta/models";

/**
 * The provider's display-name message id. A literal, for the reason the
 * source adapters' display-name keys are: `src/llm/**` importing
 * `src/i18n/**` would add a dependency edge `docs/07` §2.3 does not have.
 *
 * `src/i18n/keys.ts` declares it in `MAIN_WINDOW_MESSAGE_IDS` and on
 * `KO_PRESENT`: provider names are not translated (`docs/08` §10.3), so both
 * bundles carry the English name (owner, 2026-10-21, `plan/00` §6 item
 * 262(b)). `test/unit/i18n/keys.test.ts` compares this copy with that list.
 */
export const GEMINI_DISPLAY_NAME_KEY = "research-helper-provider-gemini";

/** The installed client, reached through `httpRequest` on every call. */
const INSTALLED_CLIENT: HttpClient = {
  request: (method, url, options) => httpRequest({ method, url, ...options }),
};

/**
 * The preference pane's success id (`P1-T44`'s `testOk` in
 * `src/ui/prefs/preferencesPane.ts`), spelled out because `llm/` may not
 * import `ui/`. `test/unit/llm/validateCredentials.test.ts` asserts all four
 * adapters return the pane's value (`P3-T14`).
 */
const TEST_OK_MESSAGE_KEY = "research-helper-prefs-test-ok";

/** The model id a model-list error is reported against. */
const MODEL_LIST_ID = "(model list)";

/** What the adapter is built from. */
export interface GeminiProviderDeps {
  /**
   * The one outbound choke point (`src/core/http/client.ts`). Absent, the
   * installed client is used through `httpRequest` (`docs/13` §2.2's
   * substitution point).
   */
  readonly http?: HttpClient | undefined;
  /** Tier 1 or session store; `undefined` when no backend is available. */
  readonly secrets: SecretStore | undefined;
  /** `registerProviders`' resolver: `gemini.baseUrl`, else `docs/03` §4.1. */
  readonly baseUrls: BaseUrlResolver;
  /** For `latencyMs`. Defaults to the system clock. */
  readonly clock?: Clock;
  readonly logger?: Logger;
  /** Defaults to {@link createGeminiTierDetector} with no evidence source. */
  readonly tier?: GeminiTierDetector;
}

/** `docs/07` §4.3's `LLMProvider`, plus the tier the free-tier warning reads. */
export interface GeminiProvider extends LLMProvider {
  readonly id: "gemini";
  /** `docs/09` §3.4 rule 4. `"free-or-unknown"` whenever it cannot tell. */
  detectTier(): Promise<GeminiTier>;
  /** Call when the stored Gemini key changes: the tier is decided again. */
  keyChanged(): void;
}

/**
 * The request headers: the key, from its `Secret`, and the content type.
 *
 * The **only** `expose()` in this adapter. Nothing else reads the key.
 *
 * @param key - the wrapped key
 * @returns the headers to send
 */
export function geminiHeaders(key: Secret): Record<string, string> {
  return {
    [GEMINI_API_KEY_HEADER]: key.expose(),
    "Content-Type": "application/json",
  };
}

/** The shared sending path of {@link createGeminiProvider} and {@link chatViaGenerateContent}. */
interface GeminiTransport {
  readonly clock: Clock;
  url(path: string): string;
  send(
    method: HttpMethod,
    url: string,
    modelId: string,
    body: Record<string, unknown> | undefined,
    ctx: LLMCallContext,
    onBodyText?: (text: string) => void,
    /** A key Test's `LLM_KEY_TEST_ATTEMPT` (item 279(b)); else `llmAttemptTimeouts`. */
    limits?: LlmAttemptLimits,
  ): Promise<HttpResponse>;
}

function createTransport(
  deps: GeminiProviderDeps,
  onKeyRead: (present: boolean) => void,
): GeminiTransport {
  async function readKey(): Promise<Secret> {
    if (deps.secrets === undefined) {
      onKeyRead(false);
      throw new MissingCredentialError("gemini");
    }
    const value = await deps.secrets.get(GEMINI_SECRET_ID);
    const present = value !== undefined && value !== "";
    onKeyRead(present);
    if (!present) throw new MissingCredentialError("gemini");
    return new Secret(value);
  }

  return {
    clock: deps.clock ?? createSystemClock(),
    url(path: string): string {
      return `${deps.baseUrls.resolveBaseUrl("gemini")}${path}`;
    },
    async send(
      method,
      url,
      modelId,
      body,
      ctx,
      onBodyText,
      limits = llmAttemptTimeouts(onBodyText !== undefined),
    ): Promise<HttpResponse> {
      ctx.token.throwIfCancelled();
      const headers = geminiHeaders(await readKey());
      deps.logger?.debug("gemini request", {
        method,
        headers: loggableHeaders(headers),
      });
      return (deps.http ?? INSTALLED_CLIENT).request(method, url, {
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
        ...limits,
        token: ctx.token,
        mapErrorResponse: (response, nowEpochMs) =>
          mapProviderError(
            "gemini",
            modelId,
            response.status,
            (name) => response.header(name),
            response.body,
            nowEpochMs,
          ),
        ...(onBodyText !== undefined && { onBodyText }),
      });
    },
  };
}

/**
 * Turn a 2xx into a `ChatResponse`, or throw what it means.
 *
 * `mapProviderError` first, for the refusal row; then the body must be a JSON
 * object; then the surface's reader decides.
 */
function finishChat(
  transport: GeminiTransport,
  response: HttpResponse,
  request: ChatRequest,
  startedEpochMs: number,
  read: (
    raw: Record<string, unknown>,
    request: ChatRequest,
  ) => InteractionReading | InteractionRefusal,
): ChatResponse {
  const declined = mapProviderError(
    "gemini",
    request.model,
    response.status,
    (name) => response.header(name),
    response.body,
    transport.clock.now(),
  );
  if (declined !== undefined) throw declined;
  const raw = parseJsonObject(response.body);
  if (raw === undefined) {
    throw new LLMError(
      "gemini",
      request.model,
      "Gemini answered with a body that is not a JSON object",
      { httpStatus: response.status },
    );
  }
  const reading = read(raw, request);
  if ("refused" in reading) {
    throw new LLMError(
      "gemini",
      request.model,
      `Gemini's interaction ended with status ${reading.status}`,
      { interactionStatus: reading.status },
    );
  }
  return {
    ...reading,
    latencyMs: Math.max(0, transport.clock.now() - startedEpochMs),
    raw,
  };
}

/**
 * Build the Gemini adapter.
 *
 * **`isConfigured()` and the keystore.** `docs/07` §4.3 makes it synchronous
 * and the keystore is asynchronous, so the answer is: a store exists, and its
 * last answer about `llm.gemini` was not "absent". That answer is asked for
 * once at construction (`SecretStore.has`, which never decrypts) and updated
 * by every key read. Until it arrives the adapter does not claim the key is
 * missing — the router has already checked `gemini.keyPresent` — and
 * {@link GeminiProvider.chat} reads the key before any request, throwing
 * `MissingCredentialError` with zero requests when it is absent.
 *
 * @param deps - see {@link GeminiProviderDeps}
 * @returns the adapter
 */
export function createGeminiProvider(deps: GeminiProviderDeps): GeminiProvider {
  let keyKnownPresent: boolean | undefined;
  const transport = createTransport(deps, (present) => {
    keyKnownPresent = present;
  });
  const tier = deps.tier ?? createGeminiTierDetector();
  let lastModels = new Map<string, ModelInfo>();

  /** Ask the store, without decrypting, whether a Gemini key is there. */
  function probeKey(): void {
    if (deps.secrets === undefined) return;
    void deps.secrets.has(GEMINI_SECRET_ID).then(
      (present) => {
        // A key read since the probe started is newer: it wins.
        keyKnownPresent ??= present;
      },
      () => {
        keyKnownPresent ??= false;
      },
    );
  }
  probeKey();

  /** `GET /v1beta/models`; a key Test passes `LLM_KEY_TEST_ATTEMPT` (item 279(b)). */
  async function listModels(
    ctx: LLMCallContext,
    limits?: LlmAttemptLimits,
  ): Promise<readonly ModelInfo[]> {
    const response = await transport.send(
      "GET",
      transport.url(MODELS_PATH),
      MODEL_LIST_ID,
      undefined,
      ctx,
      undefined,
      limits,
    );
    const raw = parseJsonObject(response.body);
    if (raw === undefined) {
      throw new LLMError(
        "gemini",
        MODEL_LIST_ID,
        "Gemini's model list is not a JSON object",
        { httpStatus: response.status },
      );
    }
    const models = readModelList(raw, await tier.detectTier());
    lastModels = new Map(models.map((model) => [model.id, model]));
    return models;
  }

  return {
    id: "gemini",
    displayNameKey: GEMINI_DISPLAY_NAME_KEY,
    rateLimitKey: GEMINI_HOST,

    isConfigured(): boolean {
      return deps.secrets !== undefined && keyKnownPresent !== false;
    },

    async validateCredentials(
      ctx: LLMCallContext,
    ): Promise<CredentialCheckResult> {
      // `P3-T14`: `docs/09` §2.3's call, `GET /v1beta/models` with the key in
      // `x-goog-api-key` — the model list, never a completion and never the
      // `?key=` query — through the same transport as every request. A failure
      // answers with the error's own message key (`docs/07` §4.3's note "as
      // built"); a bad key is HTTP 400 `API_KEY_INVALID`, which
      // `mapProviderError` already reads as `AuthenticationError`.
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
          // `docs/09` §2.3: a 429 means the key was accepted (Gemini has
          // no spend-cap shape of its own; `isKeyAcceptedFailure`, item 279(a)).
          ok: isKeyAcceptedFailure(error),
          messageKey: error.messageKey,
          ...(httpStatus !== undefined && { httpStatus }),
        };
      }
    },

    listModels: (ctx) => listModels(ctx),

    getModel(modelId: string): ModelInfo | undefined {
      return lastModels.get(modelId);
    },

    async chat(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): Promise<ChatResponse> {
      const started = transport.clock.now();
      const response = await transport.send(
        "POST",
        transport.url(INTERACTIONS_PATH),
        request.model,
        buildInteractionBody(request),
        ctx,
      );
      return finishChat(transport, response, request, started, readInteraction);
    },

    chatStream(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): AsyncIterable<ChatStreamChunk> {
      // `P3-T11`: `chat`'s Interactions body with `stream: true` (`docs/03`
      // §6.3), through the same `send`. The payload shapes the decoder reads
      // are ASSUMPTIONS (`createGeminiStreamDecoder`, `../shared/sse.ts`).
      return streamChat({
        providerId: "gemini",
        request,
        token: ctx.token,
        decoder: createGeminiStreamDecoder(request, () =>
          transport.clock.now(),
        ),
        start: (hooks) =>
          transport.send(
            "POST",
            transport.url(INTERACTIONS_PATH),
            request.model,
            { ...buildInteractionBody(request), stream: true },
            { ...ctx, token: hooks.token },
            hooks.onBodyText,
          ),
      });
    },

    countTokens(text: string): number {
      return estTokens(text);
    },

    detectTier(): Promise<GeminiTier> {
      return tier.detectTier();
    },

    keyChanged(): void {
      keyKnownPresent = undefined;
      probeKey();
      tier.keyChanged();
    },
  };
}

/**
 * The legacy `generateContent` fallback (`P3-T10` step 6) — **unused by
 * default**: nothing in the product calls it, and {@link GeminiProvider.chat}
 * never falls back to it on its own.
 *
 * `docs/03` §4 keeps `generateContent` "as a documented fallback for users
 * pinned to older SDK-equivalent behaviour". It sends
 * `POST /v1beta/models/{model}:generateContent` with the camelCase body of
 * `./mapper.ts`'s `buildGenerateContentBody` — its own serializer, never the
 * Interactions one (§4.5) — through the same key header, error hook, timeout
 * and client as the primary path. That surface has no `store` field.
 *
 * @param deps - as for {@link createGeminiProvider}
 * @param request - the provider-agnostic request
 * @param ctx - the call's context
 * @returns the normalised answer
 */
export async function chatViaGenerateContent(
  deps: GeminiProviderDeps,
  request: ChatRequest,
  ctx: LLMCallContext,
): Promise<ChatResponse> {
  const transport = createTransport(deps, () => undefined);
  const started = transport.clock.now();
  const response = await transport.send(
    "POST",
    transport.url(
      `/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
    ),
    request.model,
    buildGenerateContentBody(request),
    ctx,
  );
  return finishChat(transport, response, request, started, readGenerateContent);
}
