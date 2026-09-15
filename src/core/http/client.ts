/**
 * `HttpClient` — the one door every literature-API and LLM request goes
 * through.
 *
 * **Scope.** `P0-T15` spike version: `User-Agent` (D10), `anon: true`, an
 * explicit timeout, docs/07 §7.4's three overrides of Zotero's retry and
 * status machinery, and mapping of Zotero's exception classes to one typed
 * error. `plan/README.md` §4 lists this path among the sixteen a later card
 * `create`s again as the shipped module. Not here yet, on purpose: the
 * per-host rate limiter (`src/core/rateLimit/`), retry (`retry.ts`),
 * `CancellationToken` wiring through `cancellerReceiver` (`P0-T17` proves it),
 * redacted structured logging (`src/core/logger.ts`) and docs/07 §10.1's error
 * hierarchy (`src/core/errors.ts`).
 *
 * ## Why the transport is injected
 *
 * docs/07 §2.2 describes this file as a "facade over Zotero.HTTP.request", and
 * §7.4's excerpt calls `Zotero.HTTP.request` inline. But §2.3 says `core/`
 * names **no Zotero global** — "where `core/` needs a platform capability
 * (prefs, files, HTTP, clock) it declares a *port* interface and receives an
 * implementation via the container" — and `eslint.config.js` enforces that
 * with `no-restricted-globals`. So this file declares {@link HttpTransport},
 * a structural description of exactly the part of `Zotero.HTTP` it uses, and
 * the composition root hands it `Zotero.HTTP`. The facade logic — every
 * option, the header policy, the exception mapping — still lives here and is
 * Node-testable.
 *
 * ## Option set (docs/07 §7.4 owns it)
 *
 * - `successCodes: false` — every HTTP status resolves; callers classify it
 *   (docs/03 §14.4: the error body is what the taxonomy mapper needs).
 * - `noRetryOnThrottle: true`, `errorDelayMax: 0` — Zotero's own 429/5xx retry
 *   loop is off; a retry below the per-host token bucket is one the limiter
 *   cannot pace (docs/01 §8.1).
 * - `timeout` — `timeoutMs ?? 60_000`, never Zotero's 30 s default (docs/01
 *   §12 gotcha 14). `0` ("no timeout") is refused.
 * - `anon: true` — no ambient cookies on a bearer-token call (docs/01 §8.1).
 * - `logBodyLength: 0` — **not in §7.4's excerpt; added here.** Read from
 *   Zotero 10.0.2's `xpcom/http.js`: `_requestInternal` writes the first
 *   `logBodyLength` characters (default 1024) of every string body to
 *   `Zotero.debug`, unconditionally. An LLM body is the user's prompt and
 *   paper content; docs/07 §10.3 allows bodies in the debug log only behind
 *   `logRequestBodies`, and docs/01 §12 gotcha 15 forbids them outright.
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
 *    which `successCodes: false` never does. So status 0 is mapped to a
 *    `NETWORK` error here, and `SecurityException` is effectively unreachable
 *    through this option set.
 * 2. `UnexpectedStatusException` is likewise unreachable with
 *    `successCodes: false`; if one surfaces anyway it carries the
 *    `XMLHttpRequest`, and is turned back into an ordinary response.
 */

/** HTTP methods this client issues. */
export type HttpMethod = "GET" | "POST" | "HEAD";

/**
 * What a caller may ask for. Everything else — `User-Agent`, `anon`, the
 * retry and status overrides — is policy, not a per-call choice.
 */
export interface HttpRequestOptions {
  /**
   * Request headers. A caller-supplied `User-Agent` (any case) is discarded:
   * D10 fixes that header on every request to every host.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request body, already serialized. Set `Content-Type` yourself. */
  readonly body?: string;
  /** Milliseconds; default {@link DEFAULT_TIMEOUT_MS}. Must be > 0. */
  readonly timeoutMs?: number;
}

/** A completed HTTP exchange, whatever its status. */
export interface HttpResponse {
  /** HTTP status, 100–599. Status 0 is never returned; it is an `HttpError`. */
  readonly status: number;
  /** Final URL after redirects. */
  readonly url: string;
  /** Response body as text. */
  readonly body: string;
  /** The raw CRLF-delimited header block from the XHR. */
  readonly rawHeaders: string;
  /**
   * Case-insensitive response-header lookup. Repeated headers are joined with
   * `", "`. `Headers` is deliberately not used: docs/01 §2.3's measured list
   * of sandbox globals does not include it.
   */
  header(name: string): string | undefined;
}

/** The facade. */
export interface HttpClient {
  request(
    method: HttpMethod,
    url: string,
    options?: HttpRequestOptions,
  ): Promise<HttpResponse>;
}

// ---------------------------------------------------------------------------
// The port: exactly the slice of `Zotero.HTTP` this client uses.
// Shapes follow typings/zotero-augment.d.ts §2 (docs/01 §8.1), so
// `Zotero.HTTP` is assignable to `HttpTransport` without a cast.
// ---------------------------------------------------------------------------

/** The option subset passed to `Zotero.HTTP.request`. docs/01 §8.1. */
export interface HttpTransportOptions {
  body?: string;
  headers?: Record<string, string>;
  responseType?: "text";
  successCodes?: number[] | false;
  timeout?: number;
  errorDelayMax?: number;
  noRetryOnThrottle?: boolean;
  anon?: boolean;
  logBodyLength?: number;
}

/** The members of the resolved `XMLHttpRequest` this client reads. */
export interface HttpTransportXhr {
  readonly status: number;
  /** `string | null` in Gecko 140's DOM typings. */
  readonly responseText: string | null;
  readonly responseURL: string;
  getAllResponseHeaders(): string;
}

/**
 * A `Zotero.HTTP` exception class, as `instanceof` needs it: only the
 * prototype is declared (typings/zotero-augment.d.ts, `HTTPExceptionClass`).
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

// ---------------------------------------------------------------------------
// The typed error
// ---------------------------------------------------------------------------

/**
 * Transport-level failure codes. The strings are docs/07 §10.1's `code`
 * values for `NetworkError` and its subclasses and for
 * `OperationCancelledError`, so the Phase 1 hierarchy can map them one to one.
 */
export type HttpErrorCode = "OFFLINE" | "TIMEOUT" | "CANCELLED" | "NETWORK";

/**
 * Which platform signal produced the error: one of Zotero's exception
 * classes, or `"status-0"` for a request that resolved with no HTTP response
 * (see the file header, platform fact 1).
 */
export type HttpErrorSource =
  | "BrowserOfflineException"
  | "TimeoutException"
  | "CancelledException"
  | "SecurityException"
  | "status-0";

/**
 * A request that produced no HTTP response. An HTTP error status is *not* an
 * `HttpError` — it is an {@link HttpResponse} the caller classifies.
 *
 * The message and fields carry the method, the URL's origin and path (never
 * its query string, which may hold a key — docs/09 §2.1) and the timeout. No
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

/** docs/07 §7.4: `timeout: opts.timeoutMs ?? 60_000`. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Build the client.
 *
 * @param deps.transport - `Zotero.HTTP`, supplied by the composition root
 * @param deps.userAgent - from `buildUserAgent()` in `./userAgent`
 */
export function createHttpClient(deps: {
  readonly transport: HttpTransport;
  readonly userAgent: string;
}): HttpClient {
  const { transport, userAgent } = deps;
  if (userAgent.trim() === "") {
    throw new RangeError("userAgent must be non-empty (decision D10)");
  }

  return {
    async request(method, url, options = {}) {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        // Zotero reads 0 as "no timeout"; a hung LLM call must not be possible.
        throw new RangeError(`timeoutMs must be > 0, got ${timeoutMs}`);
      }

      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        if (name.toLowerCase() !== "user-agent") headers[name] = value;
      }
      headers["User-Agent"] = userAgent;

      const transportOptions: HttpTransportOptions = {
        headers,
        responseType: "text",
        timeout: timeoutMs,
        successCodes: false,
        noRetryOnThrottle: true,
        errorDelayMax: 0,
        anon: true,
        logBodyLength: 0,
        ...(options.body !== undefined && { body: options.body }),
      };

      let xhr: HttpTransportXhr;
      try {
        xhr = await transport.request(method, url, transportOptions);
      } catch (e) {
        const fail = (code: HttpErrorCode, source: HttpErrorSource) =>
          new HttpError({ code, source, method, url, timeoutMs, cause: e });
        if (e instanceof transport.UnexpectedStatusException) {
          xhr = e.xmlhttp; // unreachable with successCodes: false; see header
        } else if (e instanceof transport.BrowserOfflineException) {
          throw fail("OFFLINE", "BrowserOfflineException");
        } else if (e instanceof transport.TimeoutException) {
          throw fail("TIMEOUT", "TimeoutException");
        } else if (e instanceof transport.CancelledException) {
          throw fail("CANCELLED", "CancelledException");
        } else if (e instanceof transport.SecurityException) {
          throw fail("NETWORK", "SecurityException");
        } else {
          throw e; // not a transport failure: a bug, surfaced unchanged
        }
      }

      if (xhr.status === 0) {
        throw new HttpError({
          code: "NETWORK",
          source: "status-0",
          method,
          url,
          timeoutMs,
        });
      }
      return toHttpResponse(xhr, url);
    },
  };
}

function toHttpResponse(
  xhr: HttpTransportXhr,
  requestUrl: string,
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
    body: xhr.responseText ?? "",
    rawHeaders,
    header: (name) => byName.get(name.toLowerCase()),
  };
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
