/**
 * `HttpClient` — the one door every literature-API and LLM request goes
 * through, and `docs/13` §2.2's single outbound choke point.
 *
 * **Scope.** `P1-T05`, the shipped module. `plan/README.md` §4 lists this path
 * among the sixteen a Phase 1 card `create`s again over a Phase 0 spike, and
 * "the later card wins". Everything `P0-T15`/`P0-T16`/`P0-T17` measured is
 * carried forward unchanged — the injected transport, `anon: true`,
 * `successCodes: false`, `noRetryOnThrottle: true`, `errorDelayMax: 0`,
 * `logBodyLength: 0`, the {@link HttpError} codes and the `cancelRequested`
 * flag that keeps an aborted request from being classified as a network failure
 * — and four things are added:
 *
 * 1. **Pacing.** {@link HttpClientDeps.limiterFor} is asked for the host's
 *    limiter and the request is issued *inside* its `run()` — §4.1's scope that
 *    holds one of the host's `maxConcurrent` slots for the call's lifetime and
 *    waits for `cost` tokens before it starts (`docs/07` §7.4 step ordering,
 *    §7.3's one-bucket-per-host rule, `P1-T27`). The retry backoff sits outside
 *    it, so a sleeping attempt holds no slot.
 * 2. **Classification.** Every status and every transport exception becomes a
 *    `docs/07` §10.1 class: `AuthenticationError` 401, `AuthorizationError` 403,
 *    `RateLimitError` 429, `UpstreamServerError` 5xx, `BadRequestError` other
 *    4xx, `TimeoutError`, `OfflineError`, `NetworkError`,
 *    `OperationCancelledError`.
 * 3. **Retry**, through `./retry.ts`, over the retryable classes only, with the
 *    delay coming from `Retry-After` or from the host's injected jitter.
 * 4. **Logging**, at `info`, of `{ method, host, path, status, ms }` with the URL
 *    put through `src/core/errors.ts`'s `redactUrl` (`P1-T02`).
 *
 * Streaming is still not here: `docs/01` §8.4.1 needs `requestObserver` plus a
 * `progress` listener over a *cumulative* `responseText`, which is a different
 * response contract from this facade's one-shot {@link HttpResponse}. Measured
 * 2026-09-30 (`P0-T16`): the sandbox-viable path is XHR with
 * `responseType: "text"` and a listener added with `addEventListener` inside
 * `requestObserver` — assigning `xhr.onprogress` loses the handler, because
 * `http.js` may assign to that slot afterwards. `docs/03` §6.5 owns the shape.
 *
 * ## Why the transport is injected
 *
 * `docs/07` §2.2 describes this file as a "facade over Zotero.HTTP.request", and
 * §7.4's excerpt calls `Zotero.HTTP.request` inline. But §2.3 says `core/` names
 * **no Zotero global** — "where `core/` needs a platform capability (prefs,
 * files, HTTP, clock) it declares a *port* interface and receives an
 * implementation via the container" — and `eslint.config.js` enforces that with
 * `no-restricted-globals`. So this file declares {@link HttpTransport}, a
 * structural description of exactly the part of `Zotero.HTTP` it uses, and
 * `src/zotero/zoteroApi.ts`'s `createZoteroHttpTransport()` supplies it. The
 * facade logic — every option, the header policy, the exception mapping, the
 * classification, the retry — still lives here and is Node-testable.
 *
 * ## Why the *timeout* is injected too
 *
 * `docs/07` §8.5 makes `timeoutSeconds × 1000` the `timeout` passed to
 * `Zotero.HTTP.request`, and `P1-T05`'s **Do NOT** forbids both Zotero's 30 000
 * ms default and a hardcoded 60 000. But the typed reader for that pref is
 * `src/prefs/index.ts`, and §2.3 plus `eslint.config.js`'s
 * `research-helper/layering/core` rule forbid `core/` from importing `prefs/`.
 * So {@link HttpClientDeps.timeoutMs} accepts a **function**, and the
 * composition root passes `() => getPref("timeoutSeconds") * 1000`. A getter
 * rather than a value because §8.5's pane writes the pref live.
 *
 * ## Option set (docs/07 §7.4 owns it)
 *
 * - `successCodes: false` — every HTTP status resolves; this file classifies it
 *   (docs/03 §14.4: the error body is what the taxonomy mapper needs).
 * - `noRetryOnThrottle: true`, `errorDelayMax: 0` — Zotero's own 429/5xx retry
 *   loop is off; a retry below the per-host token bucket is one the limiter
 *   cannot pace (docs/01 §8.1, docs/07 §7.4).
 * - `timeout` — from the `timeoutSeconds` pref; `0` ("no timeout") is refused.
 * - `anon: true` — no ambient cookies on a bearer-token call (docs/01 §8.1).
 * - `responseType` — from the caller, defaulting to `"text"`. `docs/07` §7.4
 *   records as *verified* that Zotero does not validate it: the whole of the
 *   handling is `if (options.responseType) xmlhttp.responseType = …`.
 * - `logBodyLength: 0` — **not in §7.4's excerpt; added by `P0-T15`.** Read from
 *   Zotero 10.0.2's `xpcom/http.js`: `_requestInternal` writes the first
 *   `logBodyLength` characters (default 1024) of every string body to
 *   `Zotero.debug`, unconditionally. An LLM body is the user's prompt and paper
 *   content; `docs/01` §12 gotcha 15 forbids that outright.
 * - `debug` is never passed (docs/09 §2.1).
 *
 * ## Two platform facts the mapping is written around
 *
 * Both read from Zotero 10.0.2's `chrome/content/zotero/xpcom/http.js`:
 *
 * 1. With `successCodes: false`, a request that got **no HTTP response at all**
 *    (DNS failure, refused connection, TLS/certificate failure) *resolves* with
 *    `status === 0`. The status-0 branch that would call `checkSecurity()` and
 *    throw `SecurityException` only runs when the status is judged a failure,
 *    which `successCodes: false` never does. So status 0 is a `NETWORK` outcome
 *    here, and `SecurityException` is effectively unreachable through this
 *    option set.
 * 2. `UnexpectedStatusException` is likewise unreachable with
 *    `successCodes: false`; if one surfaces anyway it carries the
 *    `XMLHttpRequest`, and is turned back into an ordinary response.
 */

import type { Clock } from "../clock";
import { createSystemClock } from "../clock";
import {
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  ConfigurationError,
  NetworkError,
  OfflineError,
  OperationCancelledError,
  PolicyViolationError,
  RateLimitError,
  redactUrl,
  TimeoutError,
  UpstreamServerError,
} from "../errors";
import type { CancellationToken } from "../jobQueue/cancellation";
import type { Logger } from "../logger";

import { parseRetryAfterMs, type RetryPolicy, withRetry } from "./retry";
import { MAINTAINER_EMAIL, NCBI_EUTILS_HOST, TOOL_NAME } from "./userAgent";

/** HTTP methods this client issues. */
export type HttpMethod = "GET" | "POST" | "HEAD";

/**
 * XHR `responseType` values this facade passes through.
 *
 * `docs/07` §7.4 (verified) records that `Zotero.HTTP.request` does not validate
 * the value, so the union is a *policy* choice rather than a platform limit:
 * these are the four `docs/01` §8.4.1 and `docs/04` §4 name. `"text"` is the
 * default and the only one for which {@link HttpResponse.body} is guaranteed —
 * XHR's `responseText` getter throws for any other value, so `body` is `""`.
 */
export type HttpResponseType =
  "text" | "json" | "document" | "arraybuffer" | "blob";

/**
 * What a caller may ask for. Everything else — `User-Agent`, `anon`, the retry
 * and status overrides, `logBodyLength` — is policy, not a per-call choice.
 */
export interface HttpOptions {
  /**
   * Request headers. A caller-supplied `User-Agent` (any case) is discarded:
   * D10 fixes that header on every request to every host.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request body, already serialized. Set `Content-Type` yourself. */
  readonly body?: string;
  /**
   * Milliseconds. Defaults to the `timeoutSeconds` pref via
   * {@link HttpClientDeps.timeoutMs}. Must be > 0: Zotero reads `0` as "no
   * timeout" and a hung LLM call must not be possible (`docs/01` §12 gotcha 14).
   */
  readonly timeoutMs?: number;
  /** XHR `responseType`; defaults to `"text"`. */
  readonly responseType?: HttpResponseType;
  /**
   * Cooperative cancellation. `docs/07` §7.4: checked before the request is
   * issued, wired to `cancellerReceiver` while it is in flight, and
   * unsubscribed in a `finally`. A cancelled request rejects with
   * `OperationCancelledError`.
   */
  readonly token?: CancellationToken;
  /** Token-bucket cost for this call; `docs/07` §4.1's `acquire(cost)`. */
  readonly cost?: number;
  /**
   * Receives a function that aborts this request — the raw `cancellerReceiver`
   * primitive of `docs/01` §8.1, passed through.
   *
   * Prefer {@link HttpOptions.token}: this exists for `P0-T17`'s probes and for
   * a caller that holds no token. The sandbox has **no `AbortController`**
   * (measured, `docs/01` §2.3), which is why cancellation goes through this
   * callback and not an `AbortSignal`.
   *
   * Zotero calls the receiver once, synchronously, before the request is sent.
   * Calling the function afterwards aborts the underlying channel; the function
   * handed out is wrapped so the client knows a cancel was asked for (see
   * {@link createHttpClient}).
   */
  readonly onCanceller?: (cancel: () => void) => void;
}

/**
 * `P0-T15`'s name for {@link HttpOptions}, kept as an alias.
 *
 * `P1-T05` step 1 names the type `HttpOptions`, matching `docs/07` §7.4's
 * excerpt (`opts: HttpOptions`). The spike called it `HttpRequestOptions` and
 * `src/core/jobQueue/cancellation.ts`'s header links to that name.
 */
export type HttpRequestOptions = HttpOptions;

/**
 * One request, as {@link httpRequest} takes it.
 *
 * `docs/13` §2.2's replay transport hashes `{ method, url-with-keys-redacted,
 * body }` out of exactly this shape.
 */
export interface HttpRequest extends HttpOptions {
  readonly method: HttpMethod;
  readonly url: string;
}

/** A completed HTTP exchange, whatever its status. */
export interface HttpResponse {
  /** HTTP status, 100–599. Status 0 is never returned; it is an error. */
  readonly status: number;
  /** Final URL after redirects. */
  readonly url: string;
  /**
   * Response body as text. `""` when `responseType` was not `"text"`, because
   * XHR's `responseText` getter throws for every other value.
   */
  readonly body: string;
  /** The raw CRLF-delimited header block from the XHR. */
  readonly rawHeaders: string;
  /**
   * Case-insensitive response-header lookup. Repeated headers are joined with
   * `", "`. `Headers` is deliberately not used: `docs/01` §2.3's measured list
   * of sandbox globals does not include it.
   */
  header(name: string): string | undefined;
}

/** The facade. `docs/13` §2.2's single outbound choke point. */
export interface HttpClient {
  request(
    method: HttpMethod,
    url: string,
    options?: HttpOptions,
  ): Promise<HttpResponse>;
}

// ---------------------------------------------------------------------------
// The port: exactly the slice of `Zotero.HTTP` this client uses.
// Shapes follow typings/zotero-augment.d.ts §2 (docs/01 §8.1), so
// `Zotero.HTTP` is assignable to `HttpTransport` without a cast.
// ---------------------------------------------------------------------------

/** The option subset passed to `Zotero.HTTP.request`. `docs/01` §8.1. */
export interface HttpTransportOptions {
  body?: string;
  headers?: Record<string, string>;
  responseType?: HttpResponseType;
  successCodes?: number[] | false;
  timeout?: number;
  errorDelayMax?: number;
  noRetryOnThrottle?: boolean;
  anon?: boolean;
  logBodyLength?: number;
  /** `docs/01` §8.1; `docs/07` §7.4 makes it the cancellation mechanism. */
  cancellerReceiver?: (cancel: () => void) => void;
}

/** The members of the resolved `XMLHttpRequest` this client reads. */
export interface HttpTransportXhr {
  readonly status: number;
  /** `string | null` in Gecko 140's DOM typings; *throws* unless text. */
  readonly responseText: string | null;
  readonly responseURL: string;
  getAllResponseHeaders(): string;
}

/**
 * A `Zotero.HTTP` exception class, as `instanceof` needs it: only the prototype
 * is declared (typings/zotero-augment.d.ts, `HTTPExceptionClass`).
 */
export interface HttpExceptionClass<T extends Error = Error> extends Function {
  readonly prototype: T;
}

/** `Zotero.HTTP`, as far as this client is concerned. */
export interface HttpTransport {
  request(
    method: string,
    url: string,
    options: HttpTransportOptions,
  ): Promise<HttpTransportXhr>;
  readonly UnexpectedStatusException: HttpExceptionClass<
    Error & { readonly xmlhttp: HttpTransportXhr }
  >;
  readonly TimeoutException: HttpExceptionClass;
  readonly BrowserOfflineException: HttpExceptionClass;
  readonly SecurityException: HttpExceptionClass;
  readonly CancelledException: HttpExceptionClass;
}

/** `P1-T05` step 1's name for {@link HttpTransport}. */
export type Transport = HttpTransport;

/**
 * The slice of `docs/07` §4.1's `RateLimiter` this client calls.
 *
 * Declared as a narrow port rather than imported, for the same reason
 * {@link HttpTransport} is: the request path needs a few members and nothing
 * else. `P1-T04`'s `TokenBucket` — which implements §4.1's `RateLimiter` in full,
 * including `tryAcquire`, `reconfigure` and `stats` — is structurally assignable
 * to this, so the composition root needs no adapter and no cast, and `core/http`
 * does not have to compile against `core/rateLimit` to be tested.
 *
 * §4.1 remains the authority for the interface; nothing is *redeclared* here,
 * only the used subset is named.
 *
 * **`run` is required, not optional (`P1-T27`, 2026-10-01).** It is what enforces
 * `RateLimiterConfig.maxConcurrent`: §4.1's `acquire` resolves `void` and so can
 * never report that a request ended. An optional `run` would mean a limiter could
 * be injected here that paces rate and silently ignores the concurrency cap —
 * which is the defect `P1-T27` exists to remove, one layer down. `acquire` stays
 * on the port because `run` is defined in terms of it and because a 429's
 * `penalize` needs the same object.
 */
export interface RateLimiterPort {
  /** Stable identifier, normally the API host. */
  readonly key: string;
  /** Wait until `cost` tokens are available, then consume them. */
  acquire(cost?: number, token?: CancellationToken): Promise<void>;
  /**
   * Run `fn` holding one of the host's `maxConcurrent` slots for its lifetime,
   * having first waited for `cost` tokens. `docs/07` §4.1.
   */
  run<T>(
    fn: () => Promise<T>,
    cost?: number,
    token?: CancellationToken,
  ): Promise<T>;
  /**
   * Apply a server-directed pause. `docs/07` §7.3: "Any 429 or 503 with
   * `Retry-After` calls `limiter.penalize(now + retryAfterMs, …)`, which parks
   * *every* waiter on that host."
   */
  penalize(untilEpochMs: number, reason: string): void;
}

// ---------------------------------------------------------------------------
// The transport-level error
// ---------------------------------------------------------------------------

/**
 * Transport-level failure codes. The strings are `docs/07` §10.1's `code` values
 * for `NetworkError` and its subclasses and for `OperationCancelledError`, so
 * the mapping in {@link createHttpClient} is one to one.
 */
export type HttpErrorCode = "OFFLINE" | "TIMEOUT" | "CANCELLED" | "NETWORK";

/**
 * Which platform signal produced the error: one of Zotero's exception classes,
 * or `"status-0"` for a request that resolved with no HTTP response (see the
 * file header, platform fact 1).
 */
export type HttpErrorSource =
  | "BrowserOfflineException"
  | "TimeoutException"
  | "CancelledException"
  | "SecurityException"
  | "status-0";

/**
 * A request that produced no HTTP response, as the *transport* saw it.
 *
 * `P0-T15`/`P0-T17` measured these four codes and their sources, and they are
 * kept because they say strictly more than §10.1's class does — which Zotero
 * exception fired, and whether a status-0 resolve was an abort or a network
 * failure. The shipped client no longer *throws* this: it becomes the `cause` of
 * the §10.1 class it maps to, so a debug bundle keeps the platform detail while
 * every caller sees the documented hierarchy. An HTTP error *status* is not an
 * `HttpError` either — it is an {@link HttpResponse} this file classifies.
 *
 * The message and fields carry the method, the URL's origin and path (never its
 * query string, which may hold a key — `docs/09` §2.1) and the timeout. No
 * header and no body is ever copied onto it.
 */
export class HttpError extends Error {
  override readonly name = "HttpError";
  readonly code: HttpErrorCode;
  readonly source: HttpErrorSource;
  /** Whether retrying without user intervention could plausibly succeed. */
  readonly retryable: boolean;
  readonly method: HttpMethod;
  /** Origin + path only. */
  readonly url: string;
  readonly timeoutMs: number;

  constructor(init: {
    code: HttpErrorCode;
    source: HttpErrorSource;
    method: HttpMethod;
    url: string;
    timeoutMs: number;
    cause?: unknown;
  }) {
    const where = `${init.method} ${urlForDisplay(init.url)}`;
    super(`${describe(init.code, init.timeoutMs)}: ${where}`, {
      cause: init.cause,
    });
    this.code = init.code;
    this.source = init.source;
    this.retryable = init.code !== "CANCELLED";
    this.method = init.method;
    this.url = urlForDisplay(init.url);
    this.timeoutMs = init.timeoutMs;
  }
}

function describe(code: HttpErrorCode, timeoutMs: number): string {
  switch (code) {
    case "OFFLINE":
      return "Zotero is offline";
    case "TIMEOUT":
      return `Request timed out after ${timeoutMs} ms`;
    case "CANCELLED":
      return "Request cancelled";
    case "NETWORK":
      return "No HTTP response (network, DNS, TLS or security failure)";
  }
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/**
 * The fallback timeout, used only when no `timeoutSeconds` getter is injected
 * (spikes, probes, unit tests).
 *
 * It is `docs/07` §8.5's shipped default for that pref expressed in
 * milliseconds, not an independent constant: the product path reads the pref,
 * and `P1-T05`'s **Do NOT** — "do not hardcode 60 000" — is about *that* path.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** What {@link createHttpClient} needs. */
export interface HttpClientDeps {
  /** `Zotero.HTTP`, from `src/zotero/zoteroApi.ts`. */
  readonly transport: HttpTransport;
  /** From `buildUserAgent()` in `./userAgent`. D10. */
  readonly userAgent: string;
  /**
   * `timeoutSeconds × 1000` (`docs/07` §8.5). A function is read on every
   * request so a live pref change takes effect without a restart; a number is
   * accepted for a probe. Defaults to {@link DEFAULT_TIMEOUT_MS}.
   */
  readonly timeoutMs?: number | (() => number);
  /**
   * The host's token bucket — `P1-T04`'s `hostLimiter` registry. `docs/07` §7.3:
   * one bucket per host, shared by every job. Returning `undefined` means "this
   * host is unpaced", which is only correct for a probe.
   */
  readonly limiterFor?: (host: string) => RateLimiterPort | undefined;
  /**
   * The host's retry policy: §7.3's per-host attempt cap and the jitter from
   * `src/core/rateLimit/backoff.ts`. Absent means a single attempt.
   */
  readonly retryFor?: (host: string) => RetryPolicy | undefined;
  /** Supplies `now()` for `Retry-After`/durations and `sleep()` for backoff. */
  readonly clock?: Clock;
  /** Where the per-request `info` line goes. */
  readonly logger?: Logger;
}

/**
 * Build the client.
 *
 * The request path is `docs/07` §7.4's, in its order: check the token, acquire
 * from the host limiter, issue with §7.4's option set and `cancellerReceiver`
 * wired to `token.onCancelled`, unsubscribe in a `finally`, classify, log.
 *
 * @param deps - see {@link HttpClientDeps}
 * @returns the {@link HttpClient}
 */
export function createHttpClient(deps: HttpClientDeps): HttpClient {
  const { transport, userAgent } = deps;
  if (userAgent.trim() === "") {
    throw new RangeError("userAgent must be non-empty (decision D10)");
  }
  const clock = deps.clock ?? createSystemClock();
  const timeoutSource = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultTimeoutMs =
    typeof timeoutSource === "function" ? timeoutSource : () => timeoutSource;

  return {
    async request(method, url, options = {}) {
      const timeoutMs = options.timeoutMs ?? defaultTimeoutMs();
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        // Zotero reads 0 as "no timeout"; a hung LLM call must not be possible.
        throw new RangeError(`timeoutMs must be > 0, got ${timeoutMs}`);
      }

      // D10 before anything else: a request that must not be sent must not be
      // paced, logged or counted either.
      assertContactPolicy(url);

      const host = hostOf(url);
      const limiter = deps.limiterFor?.(host);
      const policy = deps.retryFor?.(host);

      /**
       * One attempt, from the moment a slot and a token have been granted.
       *
       * Everything inside runs while the host's `maxConcurrent` slot is held —
       * including `classify`, so a 429's `penalize` lands before the slot is
       * given up. The retry *backoff*, by contrast, is outside: a request
       * sleeping between attempts holds no slot, or one host's `Retry-After`
       * would idle the cap for its whole duration.
       */
      const issueAndClassify = async (): Promise<HttpResponse> => {
        const startedMs = clock.now();
        let response: HttpResponse;
        try {
          response = await issue(
            transport,
            userAgent,
            method,
            url,
            options,
            timeoutMs,
          );
        } catch (e) {
          // A request that never got a status still gets a line: without one,
          // the offline and timeout paths are invisible in a debug log.
          logExchange(
            deps.logger,
            method,
            url,
            host,
            undefined,
            clock.now() - startedMs,
            e,
          );
          throw e;
        }
        logExchange(
          deps.logger,
          method,
          url,
          host,
          response.status,
          clock.now() - startedMs,
          undefined,
        );
        return classify(response, host, limiter, clock.now(), options.token);
      };

      const attemptOnce = async (): Promise<HttpResponse> => {
        // §7.4 point 1: a job cancelled while queued must not reach the wire.
        options.token?.throwIfCancelled();
        // §7.4 step ordering: pace first, then issue. `run` takes the host's
        // concurrency slot, then `cost` tokens, then calls the function — and
        // releases the slot in a `finally`, so a rejecting or cancelled request
        // gives it back (`docs/07` §4.1, `P1-T27`). Both waits reject with
        // OperationCancelledError if the token fires (§7.4 point 2).
        //
        // An absent limiter means "this host is unpaced", which `docs/07` §7.3's
        // registry only answers for a host with no policy row — correct for a
        // probe, and the one case where no cap exists to enforce.
        if (limiter === undefined) return issueAndClassify();
        return limiter.run(issueAndClassify, options.cost ?? 1, options.token);
      };

      if (policy === undefined) return attemptOnce();
      return withRetry(attemptOnce, {
        policy,
        clock,
        ...(options.token !== undefined && { token: options.token }),
        onRetry: ({ attempt, delayMs }) => {
          deps.logger?.warn("http retry", {
            method,
            host,
            path: pathOf(url),
            attempt,
            delayMs,
          });
        },
      });
    },
  };
}

/**
 * Issue one request and map every transport exception to a §10.1 class.
 *
 * Everything the platform can do other than "resolve with an HTTP status" is
 * handled here, so the caller above only has to classify a status.
 */
async function issue(
  transport: HttpTransport,
  userAgent: string,
  method: HttpMethod,
  url: string,
  options: HttpOptions,
  timeoutMs: number,
): Promise<HttpResponse> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (name.toLowerCase() !== "user-agent") headers[name] = value;
  }
  headers["User-Agent"] = userAgent;

  // Set by the wrappers below when a cancel is actually asked for. It exists
  // because a cancelled request may not surface as `CancelledException` at all
  // — `successCodes: false` makes a request with no HTTP response *resolve*
  // with status 0 (file header, platform fact 1), and an abort is precisely
  // such a request. Without this flag a cancelled request would be classified
  // `NETWORK`, which `docs/07` §10.1 forbids: cancellation is a distinct
  // outcome, not a transport failure. Measured by `P0-T17`.
  let cancelRequested = false;
  const { token, onCanceller } = options;
  // §7.4's `unsubscribe` box: assigned inside `cancellerReceiver`, called in
  // the `finally` below so a finished request stops holding a listener on a
  // long-lived token (`docs/01` §12 gotcha 10).
  const subscription: { off: (() => void) | undefined } = { off: undefined };

  const wireCanceller =
    token !== undefined || onCanceller !== undefined
      ? (cancel: () => void) => {
          const abort = (): void => {
            cancelRequested = true;
            cancel();
          };
          onCanceller?.(abort);
          if (token !== undefined) {
            subscription.off = token.onCancelled(abort);
            // `onCancelled` fires immediately for an already-cancelled token,
            // which is §7.4's `if (opts.token?.isCancellationRequested) c()`.
          }
        }
      : undefined;

  const transportOptions: HttpTransportOptions = {
    headers,
    responseType: options.responseType ?? "text",
    timeout: timeoutMs,
    successCodes: false,
    noRetryOnThrottle: true,
    errorDelayMax: 0,
    anon: true,
    logBodyLength: 0,
    ...(options.body !== undefined && { body: options.body }),
    ...(wireCanceller !== undefined && { cancellerReceiver: wireCanceller }),
  };

  let xhr: HttpTransportXhr;
  try {
    xhr = await transport.request(method, url, transportOptions);
  } catch (e) {
    const asHttp = (code: HttpErrorCode, source: HttpErrorSource): HttpError =>
      new HttpError({ code, source, method, url, timeoutMs, cause: e });
    if (e instanceof transport.UnexpectedStatusException) {
      xhr = e.xmlhttp; // unreachable with successCodes: false; see header
    } else if (e instanceof transport.BrowserOfflineException) {
      throw toHierarchy(asHttp("OFFLINE", "BrowserOfflineException"), token);
    } else if (e instanceof transport.TimeoutException) {
      throw toHierarchy(asHttp("TIMEOUT", "TimeoutException"), token);
    } else if (e instanceof transport.CancelledException) {
      throw toHierarchy(asHttp("CANCELLED", "CancelledException"), token);
    } else if (e instanceof transport.SecurityException) {
      throw toHierarchy(asHttp("NETWORK", "SecurityException"), token);
    } else {
      throw e; // not a transport failure: a bug, surfaced unchanged
    }
  } finally {
    subscription.off?.();
  }

  if (xhr.status === 0) {
    throw toHierarchy(
      new HttpError({
        code: cancelRequested ? "CANCELLED" : "NETWORK",
        source: "status-0",
        method,
        url,
        timeoutMs,
      }),
      token,
    );
  }
  return toHttpResponse(xhr, url, options.responseType ?? "text");
}

/**
 * `docs/07` §10.1's class for a transport-level {@link HttpError}.
 *
 * The `HttpError` is kept as the `cause`, so the debug bundle still records
 * which Zotero exception fired and whether a status-0 resolve was an abort.
 */
function toHierarchy(
  error: HttpError,
  token: CancellationToken | undefined,
): Error {
  switch (error.code) {
    case "CANCELLED":
      // §10.1's constructor takes the reason, not a cause. `{ kind: "user" }`
      // is the fallback for a raw `onCanceller` abort with no token behind it.
      return new OperationCancelledError(token?.reason ?? { kind: "user" });
    case "OFFLINE":
      return new OfflineError(
        error.message,
        { url: error.url, method: error.method },
        { cause: error },
      );
    case "TIMEOUT":
      // §10.1 fixes this constructor as (timeoutMs, url) and redacts the URL
      // itself; the HttpError is not reachable as a cause through it.
      return new TimeoutError(error.timeoutMs, error.url);
    case "NETWORK":
      return new NetworkError(
        error.message,
        { url: error.url, method: error.method, source: error.source },
        { cause: error },
      );
  }
}

/**
 * Turn a status into a §10.1 error, or return the response unchanged.
 *
 * `docs/07` §7.3's `Retry-After` rule is here: a 429 or a 503 carrying the
 * header calls `penalize(now + retryAfterMs, …)`, which parks every waiter on
 * that host, so one job's throttling slows all of them. `penalize` is **not**
 * called when the header is absent — a deadline would have to be invented, and
 * `plan/README.md` §5 rule 4 forbids inventing one.
 */
function classify(
  response: HttpResponse,
  host: string,
  limiter: RateLimiterPort | undefined,
  nowMs: number,
  token: CancellationToken | undefined,
): HttpResponse {
  const { status } = response;
  if (status < 400) {
    // A cancel that landed after the response did is still a cancel: the
    // caller asked to stop, so the body must not be treated as a result.
    token?.throwIfCancelled();
    return response;
  }

  const retryAfterMs =
    status === 429 || status === 503
      ? parseRetryAfterMs(response.header("retry-after"), nowMs)
      : undefined;
  if (retryAfterMs !== undefined) {
    limiter?.penalize(nowMs + retryAfterMs, `HTTP ${status} Retry-After`);
  }

  if (status === 429) {
    throw new RateLimitError(status, retryAfterMs, host);
  }
  if (status === 401) {
    throw new AuthenticationError(status, `HTTP 401 from ${host}`, { host });
  }
  if (status === 403) {
    throw new AuthorizationError(status, `HTTP 403 from ${host}`, { host });
  }
  if (status >= 500) {
    throw new UpstreamServerError(status, `HTTP ${status} from ${host}`, {
      host,
      ...(retryAfterMs !== undefined && { retryAfterMs }),
    });
  }
  throw new BadRequestError(status, `HTTP ${status} from ${host}`, { host });
}

/**
 * `docs/07` §10.3's per-request line. `P1-T05` step 6.
 *
 * `{ method, host, path, status, ms }` are the five fields the card names. A
 * request that produced no status is logged at `warn` with the error instead;
 * `src/core/logger.ts` redacts an `Error`'s message and stack when it walks one.
 */
function logExchange(
  logger: Logger | undefined,
  method: HttpMethod,
  url: string,
  host: string,
  status: number | undefined,
  ms: number,
  error: unknown,
): void {
  if (logger === undefined) return;
  // `redactUrl` is `P1-T02`'s, imported rather than reimplemented (`docs/09`
  // §2.1 has exactly one redactor). `path` carries no query string at all, so
  // even an unknown secret parameter cannot reach the log through it; the
  // redacted full URL is emitted beside it for the cases where the query is
  // what a bug report needs.
  const line = {
    method,
    host,
    path: pathOf(url),
    ms,
    url: redactUrl(url),
  };
  if (status === undefined) {
    logger.warn("http request failed", { ...line, err: error });
    return;
  }
  logger.info("http request", { ...line, status });
}

function toHttpResponse(
  xhr: HttpTransportXhr,
  requestUrl: string,
  responseType: HttpResponseType,
): HttpResponse {
  const rawHeaders = xhr.getAllResponseHeaders() ?? "";
  const byName = new Map<string, string>();
  for (const line of rawHeaders.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    const prior = byName.get(name);
    byName.set(name, prior === undefined ? value : `${prior}, ${value}`);
  }
  return {
    status: xhr.status,
    url: xhr.responseURL || requestUrl,
    // XHR's `responseText` getter throws `InvalidStateError` unless
    // `responseType` is `""` or `"text"`, so it is only read when it is safe.
    body: responseType === "text" ? (xhr.responseText ?? "") : "",
    rawHeaders,
    header: (name) => byName.get(name.toLowerCase()),
  };
}

// ---------------------------------------------------------------------------
// D10 — the contact-address guard
// ---------------------------------------------------------------------------

/**
 * Refuse a request that would send anything but the maintainer address to NCBI.
 *
 * Decision D10 (`docs/00` §3) and `docs/02` §2.2's final assignment table:
 * `eutils.ncbi.nlm.nih.gov` always receives
 * `tool=research_helper&email=<maintainer>`, "whatever the user has
 * configured", because NBK25497 demands "a complete and valid e-mail address of
 * the software developer and not that of a third-party end user". The
 * `contactEmail` pref must not reach that host at all.
 *
 * It is enforced *here*, at the choke point, rather than trusted to every
 * adapter: `P1-T05`'s fifth acceptance criterion is that **no** test can
 * construct such a request, and a rule that lives in one adapter is a rule the
 * next adapter can forget.
 *
 * The offending value is never put in the message or the context — it is a
 * user's e-mail address, and an error message reaches `Zotero.debug` (`docs/09`
 * §2.1, NFR-16).
 *
 * @throws PolicyViolationError if `tool` or `email` carries anything else
 */
function assertContactPolicy(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return; // an unparseable URL fails in the transport, with its own error
  }
  if (parsed.host.toLowerCase() !== NCBI_EUTILS_HOST) return;

  const email = parsed.searchParams.get("email");
  if (email !== null && email !== MAINTAINER_EMAIL) {
    throw new PolicyViolationError(
      `D10: ${NCBI_EUTILS_HOST} may only receive the maintainer contact ` +
        `address in email=; a different address was supplied`,
      { host: parsed.host, param: "email" },
    );
  }
  const tool = parsed.searchParams.get("tool");
  if (tool !== null && tool !== TOOL_NAME) {
    throw new PolicyViolationError(
      `D10: ${NCBI_EUTILS_HOST} may only receive tool=${TOOL_NAME}`,
      { host: parsed.host, param: "tool" },
    );
  }
}

// ---------------------------------------------------------------------------
// `docs/13` §2.2's entry point
// ---------------------------------------------------------------------------

/**
 * The installed client. Module-scoped for the same reason
 * `src/prefs/index.ts`'s store is: {@link httpRequest} is a free function, and
 * `docs/13` §2.2 fixes it as *the* substitution point — "in contract tests,
 * `httpRequest` is replaced by a replay transport", and §2.3 stubs the same
 * name inside the integration test plugin.
 */
let installed: HttpClient | undefined;

/**
 * Install (or, with `undefined`, remove) the process-wide client.
 *
 * `src/bootstrap/` calls this once at startup with a client built over
 * `src/zotero/zoteroApi.ts`'s transport. A test installs one over a stub and
 * clears it again afterwards.
 *
 * @param client - the client {@link httpRequest} delegates to
 */
export function setHttpClient(client: HttpClient | undefined): void {
  installed = client;
}

/** The installed client, or `undefined`. */
export function getHttpClient(): HttpClient | undefined {
  return installed;
}

/**
 * Issue one request through the installed client.
 *
 * `docs/13` §2.2: "`src/core/http/client.ts` exposes `httpRequest(req):
 * Promise<HttpResponse>` and is the single outbound choke point (this also
 * serves FR-54 redaction and FR-11 headers)." Use this name — it is what the
 * replay transport and the integration stub substitute.
 *
 * @param req - method, url and any {@link HttpOptions}
 * @throws ConfigurationError if no client has been installed, which is a
 *   composition-root bug and never a user-visible condition
 */
export function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  if (installed === undefined) {
    throw new ConfigurationError(
      "no HttpClient installed: src/bootstrap/ must call setHttpClient() " +
        "before any request is issued.",
      { method: req.method, url: redactUrl(req.url) },
    );
  }
  const { method, url, ...options } = req;
  return installed.request(method, url, options);
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Host only, lowercased; `""` when the URL does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

/** Path only — never the query string, which may carry a key. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Origin + path; the query string is dropped because it may carry a key. */
function urlForDisplay(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "<unparseable URL>";
  }
}
