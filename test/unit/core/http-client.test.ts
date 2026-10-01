import { afterEach, describe, expect, it } from "vitest";

import { createManualClock, createSystemClock } from "../../../src/core/clock";
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
  TimeoutError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  DEFAULT_TIMEOUT_MS,
  getHttpClient,
  HttpError,
  httpRequest,
  setHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpMethod,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
  type RateLimiterPort,
} from "../../../src/core/http/client";
import {
  isRetryableError,
  parseRetryAfterMs,
  withRetry,
  type RetryPolicy,
} from "../../../src/core/http/retry";
import {
  MAINTAINER_EMAIL,
  NCBI_EUTILS_HOST,
} from "../../../src/core/http/userAgent";
import {
  createCancellationTokenSource,
  type CancellationReason,
} from "../../../src/core/jobQueue/cancellation";
import { createLogger, type LogSink } from "../../../src/core/logger";
import { TokenBucket } from "../../../src/core/rateLimit/tokenBucket";

/**
 * `P1-T05`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network — the
 * transport is a stub, which is the property `docs/13` §2.2 requires of this
 * module ("replaceable by a replay transport").
 *
 * Every acceptance criterion of the card is measured here except the
 * `User-Agent` regex, which is in `userAgent.test.ts`:
 *
 * 1. 429 + `Retry-After: 2` → `RateLimitError`, `retryAfterMs === 2000`, one
 *    `penalize`.
 * 2. a 404 is not retried; a 503 is retried to the per-host cap and then throws
 *    `UpstreamServerError`.
 * 3. cancelling the token mid-flight invokes the `cancellerReceiver` function and
 *    rejects with `OperationCancelledError`.
 * 5. no request to `eutils.ncbi.nlm.nih.gov` can carry a different `email`.
 *
 * `retry.ts` is tested from this file rather than from one of its own: the
 * card's `Files` list names no `retry` test, and its `Verify with` filters on
 * `http`, so a `retry.test.ts` would not be run by the command that gates the
 * card.
 */

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** Zotero's exception classes, as `instanceof` needs them (`docs/01` §8.1). */
class StubTimeoutException extends Error {}
class StubBrowserOfflineException extends Error {}
class StubCancelledException extends Error {}
class StubSecurityException extends Error {}
class StubUnexpectedStatusException extends Error {
  constructor(readonly xmlhttp: HttpTransportXhr) {
    super("unexpected status");
  }
}

interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly options: HttpTransportOptions;
}

interface StubTransport extends HttpTransport {
  readonly calls: RecordedCall[];
}

/** A transport whose every call is recorded and answered by `handler`. */
function createStubTransport(
  handler: (call: RecordedCall, index: number) => Promise<HttpTransportXhr>,
): StubTransport {
  const calls: RecordedCall[] = [];
  return {
    calls,
    request(method, url, options) {
      calls.push({ method, url, options });
      return handler({ method, url, options }, calls.length - 1);
    },
    UnexpectedStatusException:
      StubUnexpectedStatusException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: StubTimeoutException,
    BrowserOfflineException: StubBrowserOfflineException,
    SecurityException: StubSecurityException,
    CancelledException: StubCancelledException,
  };
}

/** A resolved `XMLHttpRequest`, as the client reads one. */
function stubXhr(init: {
  status: number;
  body?: string;
  headers?: Readonly<Record<string, string>>;
  url?: string;
}): HttpTransportXhr {
  const headers = Object.entries(init.headers ?? {});
  return {
    status: init.status,
    responseText: init.body ?? "",
    responseURL: init.url ?? "",
    getAllResponseHeaders: () =>
      headers.map(([name, value]) => `${name}: ${value}`).join("\r\n"),
  };
}

interface StubLimiter extends RateLimiterPort {
  readonly acquired: (number | undefined)[];
  readonly penalties: { untilEpochMs: number; reason: string }[];
}

/**
 * A limiter that only records. Pacing itself is `P1-T04`'s to test, and the
 * concurrency cap `P1-T27`'s — this stub's `run` enforces nothing, it just calls
 * `acquire` and then the work, which is what every pre-`P1-T27` assertion in this
 * file was written against.
 */
function createStubLimiter(key = "example.test"): StubLimiter {
  const acquired: (number | undefined)[] = [];
  const penalties: { untilEpochMs: number; reason: string }[] = [];
  const limiter: StubLimiter = {
    key,
    acquired,
    penalties,
    acquire(cost) {
      acquired.push(cost);
      return Promise.resolve();
    },
    async run(fn, cost, token) {
      await limiter.acquire(cost, token);
      return fn();
    },
    penalize(untilEpochMs, reason) {
      penalties.push({ untilEpochMs, reason });
    },
  };
  return limiter;
}

/** Let every already-queued microtask run. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

/** A capturing {@link LogSink} plus the lines it received. */
function createCapturingSink(): LogSink & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write(line) {
      lines.push(line);
    },
  };
}

const UA =
  "research_helper/9.9.9 (https://example.test; mailto:x@example.test)";
const URL_OK = "https://example.test/v1/thing";

/** A client over a transport that always answers with one scripted response. */
function clientFor(
  xhr: HttpTransportXhr,
  extra: Partial<Parameters<typeof createHttpClient>[0]> = {},
): { client: HttpClient; transport: StubTransport } {
  const transport = createStubTransport(() => Promise.resolve(xhr));
  return {
    transport,
    client: createHttpClient({ transport, userAgent: UA, ...extra }),
  };
}

afterEach(() => {
  setHttpClient(undefined);
});

// ---------------------------------------------------------------------------
// 1. The option set — docs/07 §7.4
// ---------------------------------------------------------------------------

describe("the option set docs/07 §7.4 fixes", () => {
  it("disables Zotero's retry and status machinery and stays anonymous", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await client.request("GET", URL_OK);

    const { options } = transport.calls[0]!;
    expect(options.successCodes).toBe(false);
    expect(options.noRetryOnThrottle).toBe(true);
    expect(options.errorDelayMax).toBe(0);
    expect(options.anon).toBe(true);
    // Not in §7.4's excerpt; added by P0-T15 because http.js logs the first
    // `logBodyLength` characters of every string body unconditionally.
    expect(options.logBodyLength).toBe(0);
    // docs/09 §2.1: never passed — and not even nameable on the port.
    expect((options as Record<string, unknown>).debug).toBeUndefined();
  });

  it("defaults responseType to text and passes the caller's through", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await client.request("GET", URL_OK);
    await client.request("GET", URL_OK, { responseType: "json" });

    expect(transport.calls[0]!.options.responseType).toBe("text");
    expect(transport.calls[1]!.options.responseType).toBe("json");
  });

  it("takes timeout from the injected timeoutSeconds getter, not 30 000", async () => {
    let seconds = 45;
    const { client, transport } = clientFor(stubXhr({ status: 200 }), {
      timeoutMs: () => seconds * 1000,
    });

    await client.request("GET", URL_OK);
    seconds = 120;
    await client.request("GET", URL_OK);
    await client.request("GET", URL_OK, { timeoutMs: 5_000 });

    expect(transport.calls[0]!.options.timeout).toBe(45_000);
    // Read on every request: docs/07 §8.5's pane writes the pref live.
    expect(transport.calls[1]!.options.timeout).toBe(120_000);
    expect(transport.calls[2]!.options.timeout).toBe(5_000);
  });

  it("falls back to §8.5's default only when nothing is injected", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await client.request("GET", URL_OK);

    expect(transport.calls[0]!.options.timeout).toBe(DEFAULT_TIMEOUT_MS);
    expect(DEFAULT_TIMEOUT_MS).toBe(60_000);
  });

  it("refuses a non-positive timeout, because Zotero reads 0 as no timeout", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await expect(
      client.request("GET", URL_OK, { timeoutMs: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      client.request("GET", URL_OK, { timeoutMs: -1 }),
    ).rejects.toThrow(RangeError);
    expect(transport.calls).toHaveLength(0);
  });

  it("fixes the User-Agent per D10 and discards a caller's", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await client.request("POST", URL_OK, {
      headers: { "user-agent": "curl/8", Accept: "application/json" },
      body: '{"a":1}',
    });

    const { options } = transport.calls[0]!;
    expect(options.headers?.["User-Agent"]).toBe(UA);
    expect(options.headers?.["user-agent"]).toBeUndefined();
    expect(options.headers?.Accept).toBe("application/json");
    expect(options.body).toBe('{"a":1}');
  });

  it("refuses to be built without a User-Agent", () => {
    const transport = createStubTransport(() =>
      Promise.resolve(stubXhr({ status: 200 })),
    );
    expect(() => createHttpClient({ transport, userAgent: " " })).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The response
// ---------------------------------------------------------------------------

describe("the response", () => {
  it("exposes status, final URL, body and case-insensitive headers", async () => {
    const { client } = clientFor(
      stubXhr({
        status: 200,
        body: "<xml/>",
        url: "https://example.test/v1/redirected",
        headers: { "Content-Type": "text/xml", "X-Rate-Limit-Limit": "10" },
      }),
    );

    const response = await client.request("GET", URL_OK);

    expect(response.status).toBe(200);
    expect(response.url).toBe("https://example.test/v1/redirected");
    expect(response.body).toBe("<xml/>");
    expect(response.header("content-type")).toBe("text/xml");
    expect(response.header("X-RATE-LIMIT-LIMIT")).toBe("10");
    expect(response.header("absent")).toBeUndefined();
    expect(response.rawHeaders).toContain("Content-Type: text/xml");
  });

  it("leaves body empty for a non-text responseType", async () => {
    // XHR's responseText getter throws unless responseType is "" or "text".
    const { client } = clientFor(stubXhr({ status: 200, body: "{}" }));

    const response = await client.request("GET", URL_OK, {
      responseType: "json",
    });

    expect(response.body).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 3. Classification — docs/07 §10.1
// ---------------------------------------------------------------------------

describe("status classification", () => {
  it("throws RateLimitError with retryAfterMs and penalizes once (429)", async () => {
    const clock = createManualClock();
    const limiter = createStubLimiter();
    const transport = createStubTransport(() =>
      Promise.resolve(
        stubXhr({ status: 429, headers: { "Retry-After": "2" } }),
      ),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      limiterFor: () => limiter,
    });

    const error = await client.request("GET", URL_OK).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    const rateLimit = error as RateLimitError;
    expect(rateLimit.retryAfterMs).toBe(2000);
    expect(rateLimit.httpStatus).toBe(429);
    expect(rateLimit.retryable).toBe(true);
    expect(limiter.penalties).toHaveLength(1);
    expect(limiter.penalties[0]!.untilEpochMs).toBe(clock.now() + 2000);
    expect(limiter.penalties[0]!.reason).toContain("429");
  });

  it("penalizes on a 503 that carries Retry-After, and still throws 5xx", async () => {
    const clock = createManualClock();
    const limiter = createStubLimiter();
    const transport = createStubTransport(() =>
      Promise.resolve(
        stubXhr({ status: 503, headers: { "retry-after": "30" } }),
      ),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      limiterFor: () => limiter,
    });

    const error = await client.request("GET", URL_OK).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UpstreamServerError);
    expect(limiter.penalties[0]!.untilEpochMs).toBe(clock.now() + 30_000);
  });

  it("does not invent a penalty deadline when Retry-After is absent", async () => {
    const limiter = createStubLimiter();
    const transport = createStubTransport(() =>
      Promise.resolve(stubXhr({ status: 429 })),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      limiterFor: () => limiter,
    });

    const error = await client.request("GET", URL_OK).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBeUndefined();
    expect(limiter.penalties).toHaveLength(0);
  });

  it.each([
    [401, AuthenticationError, false],
    [403, AuthorizationError, false],
    [400, BadRequestError, false],
    [404, BadRequestError, false],
    [418, BadRequestError, false],
    [500, UpstreamServerError, true],
    [502, UpstreamServerError, true],
  ] as const)(
    "maps HTTP %i onto docs/07 §10.1's class",
    async (status, expected, retryable) => {
      const { client } = clientFor(stubXhr({ status }));

      const error = await client
        .request("GET", URL_OK)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(expected);
      expect((error as InstanceType<typeof expected>).httpStatus).toBe(status);
      expect((error as InstanceType<typeof expected>).retryable).toBe(
        retryable,
      );
    },
  );

  it("returns 2xx and 3xx as responses, not errors", async () => {
    for (const status of [200, 201, 204, 302, 399]) {
      const { client } = clientFor(stubXhr({ status }));
      await expect(client.request("GET", URL_OK)).resolves.toMatchObject({
        status,
      });
    }
  });
});

describe("transport-exception classification", () => {
  it.each([
    [
      "BrowserOfflineException",
      new StubBrowserOfflineException(),
      OfflineError,
    ],
    ["TimeoutException", new StubTimeoutException(), TimeoutError],
    ["SecurityException", new StubSecurityException(), NetworkError],
    [
      "CancelledException",
      new StubCancelledException(),
      OperationCancelledError,
    ],
  ] as const)("maps %s onto §10.1", async (_name, thrown, expected) => {
    const transport = createStubTransport(() => Promise.reject(thrown));
    const client = createHttpClient({ transport, userAgent: UA });

    const error = await client.request("GET", URL_OK).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(expected);
  });

  it("keeps the measured HttpError as the cause, with its code and source", async () => {
    const transport = createStubTransport(() =>
      Promise.reject(new StubBrowserOfflineException()),
    );
    const client = createHttpClient({ transport, userAgent: UA });

    const error = (await client
      .request("GET", `${URL_OK}?api_key=abcdef`)
      .catch((e: unknown) => e)) as OfflineError;

    expect(error).toBeInstanceOf(OfflineError);
    const cause = error.cause as HttpError;
    expect(cause).toBeInstanceOf(HttpError);
    expect(cause.code).toBe("OFFLINE");
    expect(cause.source).toBe("BrowserOfflineException");
    // docs/09 §2.1: the query string never reaches the message or the fields.
    expect(cause.url).toBe("https://example.test/v1/thing");
    expect(cause.message).not.toContain("api_key");
    expect(error.context.url).not.toContain("api_key");
  });

  it("carries the timeout it actually used into TimeoutError", async () => {
    const transport = createStubTransport(() =>
      Promise.reject(new StubTimeoutException()),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      timeoutMs: 12_000,
    });

    const error = (await client
      .request("GET", URL_OK)
      .catch((e: unknown) => e)) as TimeoutError;

    expect(error.timeoutMs).toBe(12_000);
  });

  it("maps a status-0 resolve to NetworkError (platform fact 1)", async () => {
    const { client } = clientFor(stubXhr({ status: 0 }));

    const error = await client.request("GET", URL_OK).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(OfflineError);
    expect((error as NetworkError).retryable).toBe(true);
    expect(((error as NetworkError).cause as HttpError).source).toBe(
      "status-0",
    );
  });

  it("re-throws a non-transport error unchanged", async () => {
    const bug = new TypeError("x is not a function");
    const transport = createStubTransport(() => Promise.reject(bug));
    const client = createHttpClient({ transport, userAgent: UA });

    await expect(client.request("GET", URL_OK)).rejects.toBe(bug);
  });

  it("turns an UnexpectedStatusException back into a response", async () => {
    // Unreachable with successCodes: false, but http.js is the only authority on
    // that and the fallback costs one branch.
    const transport = createStubTransport(() =>
      Promise.reject(
        new StubUnexpectedStatusException(stubXhr({ status: 200, body: "ok" })),
      ),
    );
    const client = createHttpClient({ transport, userAgent: UA });

    await expect(client.request("GET", URL_OK)).resolves.toMatchObject({
      status: 200,
      body: "ok",
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Pacing
// ---------------------------------------------------------------------------

describe("the per-host limiter", () => {
  it("issues inside run(), which acquires first and holds the slot throughout", async () => {
    // `P1-T27`: the request is wrapped in `docs/07` §4.1's `run`, so the host's
    // `maxConcurrent` slot is held for the request's whole lifetime — the span
    // assertion below, not just the "acquire before request" of `P1-T05`.
    const order: string[] = [];
    const limiter = createStubLimiter();
    const paced: RateLimiterPort = {
      key: limiter.key,
      acquire(cost, token) {
        order.push("acquire");
        return limiter.acquire(cost, token);
      },
      async run(fn, cost, token) {
        order.push("slot:taken");
        try {
          await paced.acquire(cost, token);
          return await fn();
        } finally {
          order.push("slot:released");
        }
      },
      penalize: limiter.penalize.bind(limiter),
    };
    const transport = createStubTransport(() => {
      order.push("request");
      return Promise.resolve(stubXhr({ status: 200 }));
    });
    const client = createHttpClient({
      transport,
      userAgent: UA,
      limiterFor: () => paced,
    });

    await client.request("GET", URL_OK, { cost: 3 });

    expect(order).toStrictEqual([
      "slot:taken",
      "acquire",
      "request",
      "slot:released",
    ]);
    expect(limiter.acquired).toStrictEqual([3]);
  });

  it("serialises two overlapping requests at maxConcurrent: 1", async () => {
    // The card's criterion, at the HTTP level and over a *real* `TokenBucket`
    // rather than a stub, with a gated transport: the second request must not
    // reach the wire until the first has settled.
    const clock = createManualClock();
    const limiter = new TokenBucket(
      "example.test",
      { ratePerSecond: 1000, burst: 10, maxConcurrent: 1 },
      clock,
    );
    const open: { resolve: (xhr: HttpTransportXhr) => void }[] = [];
    const transport = createStubTransport(
      () =>
        new Promise<HttpTransportXhr>((resolve) => {
          open.push({ resolve });
        }),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      limiterFor: () => limiter,
    });

    const first = client.request("GET", `${URL_OK}?n=1`);
    const second = client.request("GET", `${URL_OK}?n=2`);
    await flushMicrotasks();

    expect(transport.calls).toHaveLength(1);
    expect(limiter.stats.inFlight).toBe(1);

    // The first one *fails*, which is the case a missing `finally` breaks.
    open[0]!.resolve(stubXhr({ status: 404 }));
    await expect(first).rejects.toBeInstanceOf(BadRequestError);
    await flushMicrotasks();

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]!.url).toBe(`${URL_OK}?n=2`);
    open[1]!.resolve(stubXhr({ status: 200 }));
    await expect(second).resolves.toMatchObject({ status: 200 });
    expect(limiter.stats.inFlight).toBe(0);
  });

  it("gives the slot back when the request is cancelled", async () => {
    const clock = createManualClock();
    const limiter = new TokenBucket(
      "example.test",
      { ratePerSecond: 1000, burst: 10, maxConcurrent: 1 },
      clock,
    );
    const transport = createStubTransport(
      (call, index) =>
        new Promise<HttpTransportXhr>((resolve, reject) => {
          if (index > 0) {
            resolve(stubXhr({ status: 200 }));
            return;
          }
          // Zotero calls the receiver once, synchronously, before sending, and
          // the request then rejects with CancelledException (`P0-T17`).
          call.options.cancellerReceiver?.(() => {
            reject(new StubCancelledException());
          });
        }),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      limiterFor: () => limiter,
    });
    const source = createCancellationTokenSource();

    const first = client.request("GET", `${URL_OK}?n=1`, {
      token: source.token,
    });
    const second = client.request("GET", `${URL_OK}?n=2`);
    await flushMicrotasks();
    expect(transport.calls).toHaveLength(1);
    expect(limiter.stats.inFlight).toBe(1);

    source.cancel({ kind: "user" });
    await expect(first).rejects.toBeInstanceOf(OperationCancelledError);
    await flushMicrotasks();

    expect(transport.calls).toHaveLength(2);
    await expect(second).resolves.toMatchObject({ status: 200 });
    expect(limiter.stats.inFlight).toBe(0);
  });

  it("looks the limiter up by host", async () => {
    const seen: string[] = [];
    const { client } = clientFor(stubXhr({ status: 200 }), {
      limiterFor: (host) => {
        seen.push(host);
        return undefined;
      },
    });

    await client.request(
      "GET",
      `https://${NCBI_EUTILS_HOST}/entrez/eutils/esearch.fcgi?db=pubmed`,
    );

    expect(seen).toStrictEqual([NCBI_EUTILS_HOST]);
  });
});

// ---------------------------------------------------------------------------
// 5. Retry — docs/07 §7.3's shape, with P1-T04's jitter injected
// ---------------------------------------------------------------------------

/** A policy with a fixed, zero delay: the jitter itself is `P1-T04`'s to test. */
function immediatePolicy(maxAttempts: number): RetryPolicy {
  return { maxAttempts, nextDelayMs: () => 0 };
}

describe("retry", () => {
  it("does not retry a 404", async () => {
    const transport = createStubTransport(() =>
      Promise.resolve(stubXhr({ status: 404 })),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock: createSystemClock(),
      retryFor: () => immediatePolicy(4),
    });

    await expect(client.request("GET", URL_OK)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(transport.calls).toHaveLength(1);
  });

  it("retries a 503 to the per-host cap and then throws UpstreamServerError", async () => {
    const transport = createStubTransport(() =>
      Promise.resolve(stubXhr({ status: 503 })),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock: createSystemClock(),
      retryFor: () => immediatePolicy(3),
    });

    await expect(client.request("GET", URL_OK)).rejects.toBeInstanceOf(
      UpstreamServerError,
    );
    expect(transport.calls).toHaveLength(3);
  });

  it("stops retrying as soon as an attempt succeeds", async () => {
    const transport = createStubTransport((_call, index) =>
      Promise.resolve(stubXhr({ status: index === 0 ? 500 : 200 })),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock: createSystemClock(),
      retryFor: () => immediatePolicy(5),
    });

    await expect(client.request("GET", URL_OK)).resolves.toMatchObject({
      status: 200,
    });
    expect(transport.calls).toHaveLength(2);
  });

  it("makes exactly one attempt when no policy is registered for the host", async () => {
    const transport = createStubTransport(() =>
      Promise.resolve(stubXhr({ status: 503 })),
    );
    const client = createHttpClient({ transport, userAgent: UA });

    await expect(client.request("GET", URL_OK)).rejects.toBeInstanceOf(
      UpstreamServerError,
    );
    expect(transport.calls).toHaveLength(1);
  });

  it("waits the server's Retry-After rather than the jitter", async () => {
    const clock = createManualClock();
    const delays: number[] = [];
    const error = new RateLimitError(429, 2000, "example.test");

    const promise = withRetry(() => Promise.reject(error), {
      policy: {
        maxAttempts: 2,
        nextDelayMs: () => {
          delays.push(-1);
          return 999_999;
        },
      },
      clock,
      onRetry: (info) => delays.push(info.delayMs),
    }).catch((e: unknown) => e);

    // The retry is parked on the clock until a test moves it.
    await Promise.resolve();
    expect(clock.pending).toBe(1);
    clock.advance(2000);

    expect(await promise).toBe(error);
    expect(delays).toStrictEqual([2000]);
  });

  it("uses the injected jitter when the server named no delay", async () => {
    const clock = createManualClock();
    const seen: { prev: number; attempt: number }[] = [];
    const promise = withRetry(
      () => Promise.reject(new UpstreamServerError(500, "boom")),
      {
        policy: {
          maxAttempts: 3,
          nextDelayMs: (prev, attempt) => {
            seen.push({ prev, attempt });
            return 100 * attempt;
          },
        },
        clock,
      },
    ).catch((e: unknown) => e);

    await Promise.resolve();
    clock.advance(100);
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(200);
    await expect(promise).resolves.toBeInstanceOf(UpstreamServerError);

    expect(seen).toStrictEqual([
      { prev: 0, attempt: 1 },
      { prev: 100, attempt: 2 },
    ]);
  });

  it("reads retryability off docs/07 §10.1's own flag", () => {
    expect(isRetryableError(new UpstreamServerError(500, "x"))).toBe(true);
    expect(isRetryableError(new RateLimitError(429, undefined, "h"))).toBe(
      true,
    );
    expect(isRetryableError(new NetworkError("x"))).toBe(true);
    expect(isRetryableError(new BadRequestError(404, "x"))).toBe(false);
    expect(isRetryableError(new AuthenticationError(401, "x"))).toBe(false);
    expect(
      isRetryableError(new OperationCancelledError({ kind: "user" })),
    ).toBe(false);
    expect(isRetryableError(new TypeError("a bug"))).toBe(false);
  });
});

describe("parseRetryAfterMs", () => {
  it("reads the delta-seconds form", () => {
    expect(parseRetryAfterMs("2", 0)).toBe(2000);
    expect(parseRetryAfterMs("120", 0)).toBe(120_000);
    expect(parseRetryAfterMs(" 0 ", 0)).toBe(0);
  });

  it("reads the HTTP-date form, relative to the injected clock", () => {
    const nowMs = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    expect(parseRetryAfterMs("Wed, 21 Oct 2015 07:28:30 GMT", nowMs)).toBe(
      30_000,
    );
    // A date already in the past is "retry now", never a negative delay.
    expect(parseRetryAfterMs("Wed, 21 Oct 2015 07:27:00 GMT", nowMs)).toBe(0);
  });

  it("returns undefined for an absent or unusable value", () => {
    expect(parseRetryAfterMs(undefined, 0)).toBeUndefined();
    expect(parseRetryAfterMs("", 0)).toBeUndefined();
    expect(parseRetryAfterMs("soon", 0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Cancellation — docs/07 §7.4
// ---------------------------------------------------------------------------

describe("cancellation", () => {
  it("invokes the cancellerReceiver function and rejects with OperationCancelledError", async () => {
    let cancelInvoked = false;
    let handedOut: (() => void) | undefined;
    const transport = createStubTransport(
      (call) =>
        new Promise<HttpTransportXhr>((_resolve, reject) => {
          // Zotero calls the receiver once, synchronously, before sending.
          call.options.cancellerReceiver?.(() => {
            cancelInvoked = true;
            // Measured 2026-09-30 (P0-T17): the request rejects with
            // CancelledException 0 ms after the canceller is called.
            reject(new StubCancelledException());
          });
          handedOut = () => undefined;
        }),
    );
    const client = createHttpClient({ transport, userAgent: UA });
    const source = createCancellationTokenSource();

    const promise = client.request("GET", URL_OK, { token: source.token });
    await Promise.resolve();
    expect(handedOut).toBeDefined();
    source.cancel({ kind: "user" });

    const error = await promise.catch((e: unknown) => e);
    expect(cancelInvoked).toBe(true);
    expect(error).toBeInstanceOf(OperationCancelledError);
    expect((error as OperationCancelledError).reason).toStrictEqual({
      kind: "user",
    });
    expect((error as OperationCancelledError).retryable).toBe(false);
  });

  it("never reaches the wire when the token is already cancelled", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));
    const source = createCancellationTokenSource();
    source.cancel({ kind: "shutdown" });

    await expect(
      client.request("GET", URL_OK, { token: source.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(transport.calls).toHaveLength(0);
  });

  it("classifies a status-0 resolve after a cancel as CANCELLED, not NETWORK", async () => {
    // P0-T17's reason for the `cancelRequested` flag: an abort can surface as a
    // status-0 *resolve* rather than as CancelledException.
    const transport = createStubTransport(
      (call) =>
        new Promise<HttpTransportXhr>((resolve) => {
          call.options.cancellerReceiver?.(() => {
            resolve(stubXhr({ status: 0 }));
          });
        }),
    );
    const client = createHttpClient({ transport, userAgent: UA });
    const source = createCancellationTokenSource();

    const promise = client.request("GET", URL_OK, { token: source.token });
    await Promise.resolve();
    source.cancel({ kind: "user" });

    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("still aborts through the raw onCanceller primitive", async () => {
    let cancel: (() => void) | undefined;
    const transport = createStubTransport(
      (call) =>
        new Promise<HttpTransportXhr>((_resolve, reject) => {
          call.options.cancellerReceiver?.(() =>
            reject(new StubCancelledException()),
          );
        }),
    );
    const client = createHttpClient({ transport, userAgent: UA });

    const promise = client.request("GET", URL_OK, {
      onCanceller: (c) => {
        cancel = c;
      },
    });
    await Promise.resolve();
    cancel?.();

    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("unsubscribes from the token when the request finishes", async () => {
    // docs/01 §12 gotcha 10: a finished request must not keep a listener on a
    // long-lived token. `dispose()` cannot be relied on to clean up mid-job.
    // The stub calls `cancellerReceiver` the way Zotero does — once,
    // synchronously, before sending — and then answers normally.
    const transport = createStubTransport((call) => {
      call.options.cancellerReceiver?.(() => undefined);
      return Promise.resolve(stubXhr({ status: 200 }));
    });
    const client = createHttpClient({ transport, userAgent: UA });
    const source = createCancellationTokenSource();
    let unsubscribes = 0;
    const token = {
      ...source.token,
      onCancelled: (cb: (reason: CancellationReason) => void) => {
        const off = source.token.onCancelled(cb);
        return () => {
          unsubscribes += 1;
          off();
        };
      },
    };

    await client.request("GET", URL_OK, { token });

    expect(unsubscribes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. D10 — the NCBI contact address
// ---------------------------------------------------------------------------

describe("D10: NCBI receives the maintainer address and no other", () => {
  const eutils = (query: string): string =>
    `https://${NCBI_EUTILS_HOST}/entrez/eutils/esearch.fcgi?${query}`;

  it("refuses a request carrying any other email, before it is issued", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    const error = await client
      .request(
        "GET",
        eutils("db=pubmed&tool=research_helper&email=user@x.test"),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PolicyViolationError);
    expect(transport.calls).toHaveLength(0);
    // The offending address is a user's PII and must not reach Zotero.debug.
    expect((error as PolicyViolationError).message).not.toContain(
      "user@x.test",
    );
    expect(
      JSON.stringify((error as PolicyViolationError).context),
    ).not.toContain("user@x.test");
  });

  it("refuses a request carrying another tool value", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await expect(
      client.request("GET", eutils("db=pubmed&tool=someone-else")),
    ).rejects.toBeInstanceOf(PolicyViolationError);
    expect(transport.calls).toHaveLength(0);
  });

  it("allows the maintainer address", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await client.request(
      "GET",
      eutils(`db=pubmed&tool=research_helper&email=${MAINTAINER_EMAIL}`),
    );

    expect(transport.calls).toHaveLength(1);
  });

  it("leaves other hosts' contact parameters alone", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await client.request(
      "GET",
      "https://api.crossref.org/works?mailto=user@x.test",
    );

    expect(transport.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Logging — docs/07 §10.3, P1-T05 step 6
// ---------------------------------------------------------------------------

describe("logging", () => {
  it("logs method, host, path, status and ms at info, with the URL redacted", async () => {
    const clock = createManualClock();
    const sink = createCapturingSink();
    const logger = createLogger({ sink, clock, level: "info" });
    const { client } = clientFor(stubXhr({ status: 200 }), { clock, logger });

    await client.request("GET", `${URL_OK}?term=cancer&api_key=SECRET-VALUE-1`);

    expect(sink.lines).toHaveLength(1);
    const line = sink.lines[0]!;
    const payload = JSON.parse(line.slice(line.indexOf("{"))) as Record<
      string,
      unknown
    >;
    expect(payload.lvl).toBe("info");
    expect(payload.method).toBe("GET");
    expect(payload.host).toBe("example.test");
    expect(payload.path).toBe("/v1/thing");
    expect(payload.status).toBe(200);
    expect(payload.ms).toBe(0);
    // P1-T02's redactUrl removed the parameter; nothing carries the value.
    expect(line).not.toContain("SECRET-VALUE-1");
    expect(String(payload.url)).toContain("term=cancer");
  });

  it("logs a request that produced no status at warn", async () => {
    const clock = createManualClock();
    const sink = createCapturingSink();
    const logger = createLogger({ sink, clock, level: "info" });
    const transport = createStubTransport(() =>
      Promise.reject(new StubTimeoutException()),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      logger,
    });

    await client.request("GET", URL_OK).catch(() => undefined);

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toContain('"lvl":"warn"');
    expect(sink.lines[0]).not.toContain('"status"');
  });
});

// ---------------------------------------------------------------------------
// 9. `httpRequest` — docs/13 §2.2's substitution point
// ---------------------------------------------------------------------------

describe("httpRequest", () => {
  it("delegates to the installed client", async () => {
    const { client, transport } = clientFor(
      stubXhr({ status: 200, body: "x" }),
    );
    setHttpClient(client);

    const response = await httpRequest({
      method: "POST",
      url: URL_OK,
      body: "{}",
      responseType: "text",
    });

    expect(getHttpClient()).toBe(client);
    expect(response.body).toBe("x");
    expect(transport.calls[0]!.method).toBe("POST");
    expect(transport.calls[0]!.options.body).toBe("{}");
  });

  it("is replaceable by a replay client, which is docs/13 §2.2's requirement", async () => {
    const replayed: string[] = [];
    setHttpClient({
      request(method, url) {
        replayed.push(`${method} ${url}`);
        return Promise.resolve({
          status: 200,
          url,
          body: "fixture",
          rawHeaders: "",
          header: () => undefined,
        });
      },
    });

    await expect(
      httpRequest({ method: "GET", url: URL_OK }),
    ).resolves.toMatchObject({ body: "fixture" });
    expect(replayed).toStrictEqual([`GET ${URL_OK}`]);
  });

  it("fails loudly, and without the query string, when nothing is installed", () => {
    expect(() =>
      httpRequest({ method: "GET", url: `${URL_OK}?api_key=SECRET-VALUE-2` }),
    ).toThrow(ConfigurationError);
    try {
      httpRequest({ method: "GET", url: `${URL_OK}?api_key=SECRET-VALUE-2` });
    } catch (e) {
      expect(JSON.stringify((e as ConfigurationError).context)).not.toContain(
        "SECRET-VALUE-2",
      );
    }
  });

  it("issues no request for a method the facade does not support", () => {
    // Compile-time only: HttpMethod is the closed set docs/01 §8.1's table is
    // read against. This assertion exists so the union is not widened silently.
    const methods: HttpMethod[] = ["GET", "POST", "HEAD"];
    expect(methods).toHaveLength(3);
  });
});
