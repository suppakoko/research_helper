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
 *    `OperationCancelledError`. **Only the `BadRequestError` carries the
 *    response body** (`P2-T35`), redacted through `src/core/provenance.ts`'s
 *    `redactText` before it is attached, because some hosts put their own
 *    structured error in a 4xx body — arXiv's Atom error feed arrives as HTTP
 *    400 — and the adapter is the only layer that can read it. The
 *    classification itself is unchanged for every status and every host
 *    **unless the request carries {@link HttpOptions.mapErrorResponse}**
 *    (`P3-T38`, `plan/00` §6 item 244, owner, 2026-10-20): then, for a status
 *    of 400 or above, that hook is asked first — with the body already through
 *    `redactText` — and an error it returns is thrown in place of the class
 *    above, *inside* the attempt, so the retry decision below is taken on it.
 *    That is how an LLM adapter makes a spend-cap 429 a `QuotaExceededError`
 *    that ends the request after one attempt. No literature adapter passes one.
 * 3. **Retry**, through `./retry.ts`, over the retryable classes only and
 *    never over a `TimeoutError` (`plan/00` §6 item 230, 2026-10-20), with the
 *    delay coming from `Retry-After` or from the host's injected jitter, and
 *    inside a 90-second total budget per request (`./retry.ts`'s
 *    `REQUEST_BUDGET_MS`, `plan/00` §6 item 233, 2026-10-21) that starts when
 *    the first attempt is handed to the transport. The
 *    `Retry-After` parse is `src/core/rateLimit/backoff.ts`'s and is the only one
 *    in the codebase (`P1-T26`).
 * 4. **Logging**, at `info`, of `{ method, host, path, status, ms }` with the URL
 *    put through `src/core/errors.ts`'s `redactUrl` (`P1-T02`).
 * 5. **Adoption of the host's advertised limits** (`P1-T26`). Every response is
 *    offered to `src/core/rateLimit/hostLimiter.ts`'s `adoptAdvertisedLimits`,
 *    which is the caller `docs/07` §7.3 described — "`reconfigure()` is called
 *    from those headers on every response" — and which nothing called until this
 *    card, because reading a response header needs a response and `P1-T04` could
 *    not touch this path.
 *
 * 6. **A streaming mode** (`P3-T11`, `docs/07` §4.3's dated note "the
 *    streaming contract", 2026-10-21). A request that carries
 *    {@link HttpOptions.onBodyText} is the same request — same limiter slot,
 *    retry, timeout, classification, logging and redaction — whose 2xx body
 *    is also handed over **as it arrives**, through `docs/01` §8.4.1's XHR
 *    path: `requestObserver` plus a `progress` listener over the *cumulative*
 *    `responseText`, sliced from a cursor so each character is delivered once.
 *    Measured 2026-09-30 (`P0-T16`, spike `V-8`): that is the sandbox-viable
 *    path, with `responseType: "text"` and the listener added with
 *    `addEventListener` — assigning `xhr.onprogress` loses the handler, because
 *    `http.js` may assign to that slot afterwards. The one difference from a
 *    plain request is that **an attempt that has delivered any text is never
 *    retried**: a second attempt would hand the caller the text again.
 *    *Corrected 2026-10-21: this paragraph said streaming was "still not here"
 *    because the one-shot {@link HttpResponse} could not carry it; the callback
 *    beside it can, so no second HTTP stack was needed.*
 *
 *    **A stream's two time limits** (`plan/00` §6 item 268(c), owner,
 *    2026-10-22; `docs/07` §4.3's note "a stream's two time limits"). The
 *    request's `timeoutMs` is the XHR `timeout` and bounds the whole exchange,
 *    as for any request. A streamed request may add
 *    {@link HttpOptions.idleTimeoutMs}: the client counts on its injected
 *    clock from the moment the attempt is handed to the transport, restarts
 *    the count whenever the body grows, and aborts the request through
 *    `cancellerReceiver` when the count runs out. Either expiry is a
 *    `TimeoutError` on the normal path. **No timeout is ever set to zero or
 *    lifted from the progress handler** (`docs/01` §8.4.1 records that other
 *    plugins do; the no-hang rule forbids it).
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
  type ResearchHelperError,
  TimeoutError,
  UpstreamServerError,
} from "../errors";
import {
  type CancellationToken,
  createCancellationTokenSource,
} from "../jobQueue/cancellation";
import type { Logger } from "../logger";
import { redactText } from "../provenance";
import { parseRetryAfter } from "../rateLimit/backoff";
import {
  adoptAdvertisedLimits,
  PMC_IDCONV_HOST,
} from "../rateLimit/hostLimiter";
import type { RateLimiterConfig } from "../rateLimit/tokenBucket";

import { REQUEST_BUDGET_MS, type RetryPolicy, withRetry } from "./retry";
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
  /**
   * Reads an error answer **before** the client classifies it. `P3-T38`
   * (`plan/00` §6 item 244, owner, 2026-10-20; `docs/07` §7.3's dated note
   * "An LLM host's error answer is read before the retry decision").
   *
   * Absent — which is every literature adapter — the client classifies every
   * status itself, exactly as before. Present, it is called once per attempt
   * whose status is 400 or above, inside that attempt, **after** the host's
   * advertised limits are adopted and after a 429/503 `Retry-After` has
   * `penalize`d the host, and **before** the client picks a class. An error it
   * returns is thrown instead of the client's own, so `withRetry` decides on
   * it: a `retryable: false` class such as `QuotaExceededError` ends the
   * request after one attempt. `undefined` leaves the client's class in place.
   *
   * Per request rather than per host, because the LLM adapters'
   * `mapProviderError` (`src/llm/shared/errorMap.ts`) needs the request's
   * model id, which a `HOST_POLICIES` row does not know — and a row in
   * `src/core/` could not import that function anyway.
   *
   * The hook never sees the raw body: see {@link ErrorResponseMapper}.
   */
  readonly mapErrorResponse?: ErrorResponseMapper;
  /**
   * Streaming mode (`P3-T11`): receives the response body **as it arrives**,
   * in order, each character exactly once.
   *
   * Only a 2xx body is delivered — an error answer is still read whole and
   * classified exactly as without this option — and the concatenation of
   * every call equals the resolved {@link HttpResponse.body}. Requires
   * `responseType` `"text"` (the default); any other value is refused with a
   * `RangeError` before anything is sent, because XHR exposes no partial body
   * for it (`docs/01` §8.4.1 mechanic 1).
   *
   * Everything else is a plain request's: the host's slot is held for the
   * whole stream, the timeout bounds the whole stream, a cancel aborts it. An
   * attempt that has delivered any text is **not retried**; its error is
   * thrown unchanged. Called from the XHR's `progress` event, so it must not
   * throw and should only queue the text.
   */
  readonly onBodyText?: (text: string) => void;
  /**
   * Streaming mode only: the longest the body may go **without growing**, in
   * milliseconds (`plan/00` §6 item 268(c), owner, 2026-10-22).
   *
   * Counted on the client's clock from the moment the attempt is handed to
   * the transport, and restarted each time the body grows, so a host that
   * sends nothing at all is cut after this long too. When the count runs out
   * the request is aborted through `cancellerReceiver` and the attempt fails
   * with `TimeoutError`, whose `timeoutMs` is this value; a timeout is never
   * retried. {@link HttpOptions.timeoutMs} still bounds the whole exchange.
   * Refused with a `RangeError`, before anything is sent, without
   * {@link HttpOptions.onBodyText} or when not a positive finite number: it is
   * never a way to turn a limit off.
   */
  readonly idleTimeoutMs?: number;
}

/**
 * {@link HttpOptions.mapErrorResponse}'s shape.
 *
 * `response` is the answer as the client received it **except that its
 * `body` has already been put through `src/core/provenance.ts`'s
 * `redactText`** — the same gate `classify`'s `BadRequestError` body passes —
 * so a hook cannot attach an unredacted body to anything it builds.
 * `nowEpochMs` is the client's injected `clock.now()`, for an HTTP-date
 * `Retry-After`. The `Retry-After` parse itself stays `parseRetryAfter` in
 * `src/core/rateLimit/backoff.ts`; a hook that needs one calls that.
 *
 * Whatever the hook returns must already be redacted (`ResearchHelperError.
 * context`'s rule). A hook that throws instead of returning has its error
 * surface unchanged, which is not retried unless it is a retryable §10.1 class.
 */
export type ErrorResponseMapper = (
  response: HttpResponse,
  nowEpochMs: number,
) => ResearchHelperError | undefined;

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
  /**
   * `docs/01` §8.1: called with the `XMLHttpRequest` after `open()` and before
   * `send()`, the only moment a `progress` listener can be attached. Passed
   * only in streaming mode ({@link HttpOptions.onBodyText}, `P3-T11`).
   */
  requestObserver?: (xhr: HttpTransportObservedXhr) => void;
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
 * The members of the in-flight `XMLHttpRequest` the streaming mode reads
 * (`P3-T11`). A structural subset, so the real XHR is assignable without a
 * cast and a test can hand in a four-member fake.
 */
export interface HttpTransportObservedXhr {
  /** The HTTP status once headers have arrived; `0` before and on failure. */
  readonly status: number;
  /** The body so far — cumulative, not a delta (`docs/01` §8.4.1 mechanic 3). */
  readonly responseText: string | null;
  /**
   * `addEventListener`, never the `onprogress` slot, which `http.js` may
   * assign after `requestObserver` returns (`P0-T16`).
   */
  addEventListener(type: "progress", listener: () => void): void;
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
 * to this, so the composition root needs no adapter and no cast.
 *
 * **Corrected 2026-10-02 (`P1-T26`): this said `core/http` "does not have to
 * compile against `core/rateLimit` to be tested", and it no longer does not.**
 * That card collapsed the duplicate `Retry-After` parser into
 * `core/rateLimit/backoff.ts` and put the header → policy mapping in
 * `core/rateLimit/hostLimiter.ts`, so this module now imports both. The port
 * still earns its keep — a test injects a four-line object rather than a
 * `TokenBucket`, and §4.1 is not redeclared — but the *module* boundary is gone,
 * deliberately and by the card's own step 1. Nothing in `core/rateLimit/` imports
 * `core/http/`, so there is no cycle.
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
  /**
   * The policy in force, for {@link adoptAdvertisedLimits} (`P1-T26`).
   *
   * **Optional, unlike `run`.** It is not on §4.1's `RateLimiter` at all — it is
   * `TokenBucket.currentConfig`, which exists beyond the interface so a caller
   * can tell what is in force — and a limiter that publishes neither this nor
   * {@link reconfigure} is simply never reconfigured from headers. `run` is
   * required because a limiter that ignores `maxConcurrent` is a silent defect;
   * this one is required of nothing, because `docs/07` §7.3's tables remain the
   * floor when a host advertises nothing.
   */
  readonly currentConfig?: RateLimiterConfig;
  /** §4.1's runtime reconfiguration. Optional for the reason above. */
  reconfigure?(config: RateLimiterConfig): void;
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
  | "status-0"
  // A streamed request whose body stopped growing for `idleTimeoutMs`
  // (`plan/00` §6 item 268(c)): the client aborted it itself.
  | "idle-timeout";

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
   *
   * `src/bootstrap/container.ts` supplies it since 2026-10-20 (`plan/00` §6
   * item 228), from each `HOST_POLICIES` row's `retry` cells and only for a
   * host that also has a limiter, so every retry is paced by that host's
   * bucket: each attempt below re-enters `limiter.run`, waits for a token and
   * for any `Retry-After` penalty, and is logged and classified like the first.
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
      const sink = options.onBodyText;
      if (sink !== undefined && (options.responseType ?? "text") !== "text") {
        // XHR exposes no partial body for any other type (docs/01 §8.4.1).
        throw new RangeError(
          `onBodyText needs responseType "text", got "${options.responseType}"`,
        );
      }
      const { idleTimeoutMs } = options;
      if (idleTimeoutMs !== undefined) {
        // Item 268(c): an idle limit belongs to a stream, and is never a way
        // to switch a limit off.
        if (sink === undefined) {
          throw new RangeError("idleTimeoutMs needs onBodyText");
        }
        if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
          throw new RangeError(
            `idleTimeoutMs must be > 0, got ${idleTimeoutMs}`,
          );
        }
      }
      // Set once any body text has been handed to the caller: from then on a
      // failed attempt must not be retried, or the caller gets the text twice.
      let streamed = false;
      const attemptOptions: HttpOptions =
        sink === undefined
          ? options
          : {
              ...options,
              onBodyText: (text) => {
                streamed = true;
                sink(text);
              },
            };

      // D10 before anything else: a request that must not be sent must not be
      // paced, logged or counted either.
      assertContactPolicy(url);

      const host = hostOf(url);
      const limiter = deps.limiterFor?.(host);
      const policy = deps.retryFor?.(host);
      // Item 233's budget starts here: the instant the first attempt is handed
      // to the transport, after its slot and token. Waiting in the host's
      // queue before the first attempt is pacing, not retrying, and is not
      // charged; every later attempt's queueing is.
      let firstSentMs: number | undefined;

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
        firstSentMs ??= startedMs;
        let response: HttpResponse;
        try {
          response = await issue(
            transport,
            userAgent,
            method,
            url,
            attemptOptions,
            timeoutMs,
            clock,
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
        // `P1-T26` step 2, and §7.3's "reconfigure() is called from those
        // headers on every response". Before `classify`, so it happens on a 429
        // too — the response that says most about the host's limits is the one
        // that refused us.
        adoptLimits(limiter, response, host, deps.logger);
        return classify(
          response,
          host,
          limiter,
          clock.now(),
          options.token,
          options.mapErrorResponse,
        );
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

      // Streaming mode: an attempt that delivered text ends the loop with its
      // own error. `withRetry` decides on the thrown value, so the error is
      // parked and a non-retryable marker thrown in its place; the original is
      // rethrown below, unchanged, with no retry logged or waited for.
      let streamFailure: { readonly error: unknown } | undefined;
      const runAttempt =
        sink === undefined
          ? attemptOnce
          : async (): Promise<HttpResponse> => {
              try {
                return await attemptOnce();
              } catch (error) {
                if (!streamed) throw error;
                streamFailure = { error };
                throw new Error("stream started: not retried", {
                  cause: error,
                });
              }
            };
      try {
        return await withRetry(runAttempt, {
          policy,
          clock,
          ...(options.token !== undefined && { token: options.token }),
          budget: {
            totalMs: REQUEST_BUDGET_MS,
            startedAtMs: () => firstSentMs,
          },
          onRetry: ({ attempt, delayMs }) => {
            deps.logger?.warn("http retry", {
              method,
              host,
              path: pathOf(url),
              attempt,
              delayMs,
            });
          },
          // Without this line a request that stopped short of its attempt cap
          // would look, in a debug bundle, like one the cap ended.
          onBudgetSpent: ({ attempt, elapsedMs, delayMs }) => {
            deps.logger?.warn("http retry budget spent", {
              method,
              host,
              path: pathOf(url),
              attempt,
              elapsedMs,
              delayMs,
            });
          },
        });
      } catch (error) {
        if (streamFailure !== undefined) throw streamFailure.error;
        throw error;
      }
    },
  };
}

/**
 * What the idle watch rejects the race with (`plan/00` §6 item 268(c)). It
 * never leaves {@link issue}: it is turned into a `TimeoutError` there.
 */
class IdleExpired extends Error {
  override readonly name = "IdleExpired";
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
  clock: Clock,
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

  // Item 268(c): a streamed request's idle limit. The raw canceller is kept so
  // an idle expiry can abort the request without it reading as a user cancel.
  const { idleTimeoutMs } = options;
  let transportCancel: (() => void) | undefined;

  const wireCanceller =
    token !== undefined ||
    onCanceller !== undefined ||
    idleTimeoutMs !== undefined
      ? (cancel: () => void) => {
          transportCancel = cancel;
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

  // Streaming mode (`P3-T11`): the cursor into the cumulative `responseText`.
  // `docs/01` §8.4.1 mechanic 3 — slicing from a saved offset keeps the cost
  // linear in the stream, where re-reading the whole text per tick is O(n²).
  const { onBodyText } = options;
  let delivered = 0;
  /** True once the request settled or was aborted: no text after that. */
  let closed = false;
  const deliver = (status: number, text: string | null): void => {
    if (onBodyText === undefined || closed || cancelRequested) return;
    // Only a 2xx streams; an error answer is classified whole, as always.
    if (status < 200 || status >= 300 || text === null) return;
    if (text.length <= delivered) return;
    const slice = text.slice(delivered);
    delivered = text.length;
    onBodyText(slice);
  };
  // The idle count: when the body last grew, and how long it was then. Any
  // growth counts, whatever the status, because "idle" is about the wire.
  let lastGrowthMs = clock.now();
  let seenLength = 0;
  const observeProgress =
    onBodyText === undefined
      ? undefined
      : (observed: HttpTransportObservedXhr): void => {
          observed.addEventListener("progress", () => {
            // No read at all once settled or aborted: a late event is ignored.
            if (closed || cancelRequested) return;
            let text: string | null;
            try {
              text = observed.responseText;
            } catch {
              return; // some states refuse the read; the next tick catches up
            }
            if (text !== null && text.length > seenLength) {
              seenLength = text.length;
              lastGrowthMs = clock.now();
            }
            deliver(observed.status, text);
          });
        };

  // The idle watch. `expiry` rejects when the count runs out, and the request
  // below races it, so the attempt ends on time even if the transport were to
  // ignore the abort. `stop` ends the watch when the request settles.
  const idleWatch =
    idleTimeoutMs === undefined
      ? undefined
      : (() => {
          const stop = createCancellationTokenSource();
          let expire: (reason: unknown) => void = () => undefined;
          const expiry = new Promise<never>((_resolve, reject) => {
            expire = reject;
          });
          const watch = async (): Promise<void> => {
            for (;;) {
              const remaining = lastGrowthMs + idleTimeoutMs - clock.now();
              if (remaining <= 0) break;
              await clock.sleep(remaining, stop.token);
            }
            if (closed || cancelRequested) return;
            // Reject first, then abort: a transport whose cancel rejects at
            // once must not win the race with a cancellation.
            expire(new IdleExpired());
            transportCancel?.();
          };
          return { stop, expiry, watch };
        })();
  const idleTimeout = (): Error =>
    toHierarchy(
      new HttpError({
        code: "TIMEOUT",
        source: "idle-timeout",
        method,
        url,
        timeoutMs: idleTimeoutMs ?? timeoutMs,
      }),
      token,
    );

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
    ...(observeProgress !== undefined && { requestObserver: observeProgress }),
  };

  let xhr: HttpTransportXhr;
  try {
    lastGrowthMs = clock.now();
    const sent = transport.request(method, url, transportOptions);
    if (idleWatch === undefined) {
      xhr = await sent;
    } else {
      // A stopped watch rejects with OperationCancelledError: nothing to do.
      idleWatch.watch().catch(() => undefined);
      xhr = await Promise.race([sent, idleWatch.expiry]);
    }
    // The last bytes may arrive with no progress event after them (`P0-T16`).
    // Guarded here: `responseText` throws for a non-text `responseType`.
    if (onBodyText !== undefined) deliver(xhr.status, xhr.responseText);
    closed = true;
  } catch (e) {
    closed = true;
    // The idle limit ran out. The race's rejection is queued before the abort
    // is sent, so the transport's own answer to that abort (a
    // `CancelledException`, or a status-0 resolve) always loses the race.
    if (e instanceof IdleExpired) throw idleTimeout();
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
    // The reason is never read: it only wakes the watch's sleep to end it.
    idleWatch?.stop.cancel({ kind: "user" });
    idleWatch?.stop.dispose();
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
 * Reconfigure the host's limiter from the limits the response advertised.
 *
 * `P1-T26`. The reading, the "only when present" rule and the "only downwards"
 * rule all live in `src/core/rateLimit/hostLimiter.ts` beside §7.3's policy
 * table, because what a host's headers *mean* is policy; this function is the
 * caller §7.3 said existed and `P1-T04` could not write, since reading a
 * response header needs a response and only this layer has one.
 *
 * A limiter is never required to support it — see
 * {@link RateLimiterPort.currentConfig} — and a response that advertised nothing
 * costs one map lookup per header name.
 */
function adoptLimits(
  limiter: RateLimiterPort | undefined,
  response: HttpResponse,
  host: string,
  logger: Logger | undefined,
): void {
  if (limiter === undefined) return;
  const adopted = adoptAdvertisedLimits(limiter, (name) =>
    response.header(name),
  );
  if (adopted === undefined) return;
  // A rate that changed itself is not visible in any other line, and "why did
  // this job slow down" is otherwise unanswerable from a debug bundle.
  logger?.info("rate limit reconfigured from response headers", {
    host,
    ratePerSecond: adopted.ratePerSecond,
    maxConcurrent: adopted.maxConcurrent,
  });
}

/**
 * Turn a status into a §10.1 error, or return the response unchanged.
 *
 * `docs/07` §7.3's `Retry-After` rule is here: a 429 or a 503 carrying the
 * header calls `penalize(now + retryAfterMs, …)`, which parks every waiter on
 * that host, so one job's throttling slows all of them. `penalize` is **not**
 * called when the header is absent — a deadline would have to be invented, and
 * `plan/README.md` §5 rule 4 forbids inventing one.
 *
 * The parse is `src/core/rateLimit/backoff.ts`'s `parseRetryAfter`, the one
 * parser in the codebase since `P1-T26`. Its `HTTP_DATE` shape check is
 * load-bearing here: without it `Date.parse` reads `"120.5"` as the year 120 and
 * this function would hand `penalize` a deadline two millennia in the past,
 * which clamps to "retry immediately" against a host that just asked us to stop.
 *
 * **The request's own mapping comes before the status branches** (`P3-T38`).
 * When the request carries {@link HttpOptions.mapErrorResponse}, it is asked
 * after the `penalize` above — a host that sent `Retry-After` is parked
 * whichever class the answer becomes — and before any class is chosen. The
 * hook gets the answer with its body through `redactText`, never the raw one.
 * Without a hook nothing below changes.
 */
function classify(
  response: HttpResponse,
  host: string,
  limiter: RateLimiterPort | undefined,
  nowMs: number,
  token: CancellationToken | undefined,
  mapErrorResponse: ErrorResponseMapper | undefined,
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
      ? parseRetryAfter(response.header("retry-after"), nowMs)
      : undefined;
  if (retryAfterMs !== undefined) {
    limiter?.penalize(nowMs + retryAfterMs, `HTTP ${status} Retry-After`);
  }

  if (mapErrorResponse !== undefined) {
    // `redactText` before the body leaves this module, so the hook — adapter
    // code — cannot attach an unredacted body to the error it builds. Only
    // `body` is replaced; status, URL and the header lookup are the response's.
    const mapped = mapErrorResponse(
      {
        status: response.status,
        url: response.url,
        body: redactText(response.body),
        rawHeaders: response.rawHeaders,
        header: (name) => response.header(name),
      },
      nowMs,
    );
    if (mapped !== undefined) throw mapped;
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
  // `P2-T35`: the body travels on this one class so an adapter whose host
  // answers a malformed request with its own structured error (arXiv's Atom
  // error feed, HTTP 400) can read it. It is put through the provenance gate's
  // `redactText` — embedded URLs lose their key parameters by name, then the
  // whole text goes through `KEY_PATTERNS` — *before* it is attached, because
  // `ResearchHelperError.context` must already be redacted by the thrower
  // (`docs/09` §2.1). An empty body is not attached at all.
  throw new BadRequestError(status, `HTTP ${status} from ${host}`, {
    host,
    ...(response.body.length > 0 && { body: redactText(response.body) }),
  });
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
 * The NCBI hosts whose `tool`/`email` parameters must carry the maintainer's
 * values (decision D10, `docs/02` §2.2's final assignment table). Both names
 * are imported, not respelled: E-utilities' from `./userAgent`, the ID
 * Converter's from §7.3's policy table in `src/core/rateLimit/hostLimiter.ts`.
 */
const D10_CONTACT_HOSTS: ReadonlySet<string> = new Set([
  NCBI_EUTILS_HOST,
  PMC_IDCONV_HOST,
]);

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
 * **Two NCBI hosts since 2026-10-20** ({@link D10_CONTACT_HOSTS}): the NCBI ID
 * Converter on `pmc.ncbi.nlm.nih.gov` (`src/sources/pubmed/idConverter.ts`,
 * added 2026-10-19) sends the same `tool` and `email`, and `docs/02` §2.2's
 * final assignment table now lists it beside E-utilities (`plan/00` §6
 * item 229). Before that date the converter's address was held only by its
 * own tests.
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
  const host = parsed.host.toLowerCase();
  if (!D10_CONTACT_HOSTS.has(host)) return;

  const email = parsed.searchParams.get("email");
  if (email !== null && email !== MAINTAINER_EMAIL) {
    throw new PolicyViolationError(
      `D10: ${host} may only receive the maintainer contact ` +
        `address in email=; a different address was supplied`,
      { host: parsed.host, param: "email" },
    );
  }
  const tool = parsed.searchParams.get("tool");
  if (tool !== null && tool !== TOOL_NAME) {
    throw new PolicyViolationError(
      `D10: ${host} may only receive tool=${TOOL_NAME}`,
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
