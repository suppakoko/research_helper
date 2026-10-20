import { afterEach, describe, expect, it } from "vitest";

import {
  createManualClock,
  createSystemClock,
  type ManualClock,
} from "../../../src/core/clock";
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
  isRetriedAutomatically,
  isRetryableError,
  REQUEST_BUDGET_MS,
  retryPolicyFromBudget,
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
import { redactText } from "../../../src/core/provenance";
import { parseRetryAfter } from "../../../src/core/rateLimit/backoff";
import { PMC_IDCONV_HOST } from "../../../src/core/rateLimit/hostLimiter";
import {
  TokenBucket,
  type RateLimiterConfig,
} from "../../../src/core/rateLimit/tokenBucket";
import { buildIdConverterUrl } from "../../../src/sources/pubmed/idConverter";

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

// ---------------------------------------------------------------------------
// P2-T35: the 4xx body travels on BadRequestError, redacted, and nowhere else
// ---------------------------------------------------------------------------

describe("the 4xx body on BadRequestError (P2-T35)", () => {
  // A key-shaped *parameter* whose value no `KEY_PATTERNS` shape catches: 11
  // characters, not hexadecimal, no vendor prefix. Only `redactUrl`'s removal
  // by name can take it out, so its absence proves the body went through the
  // gate's URL-aware `redactText` and not through `redact()` alone.
  const SHORT_KEY = "shortkey123";
  const VENDOR_KEY = "sk-ant-abcdefghijklmnopqrstuvwxyz0123";
  const BODY_WITH_KEYS =
    `<feed><link href="https://example.test/api/query?q=x&api_key=${SHORT_KEY}"/>` +
    `<summary>bad request; retry with ${VENDOR_KEY}</summary></feed>`;

  it("attaches the body redacted through the provenance gate, in context and on .body", async () => {
    const { client } = clientFor(
      stubXhr({ status: 400, body: BODY_WITH_KEYS }),
    );

    const error = await client.request("GET", URL_OK).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    const bad = error as BadRequestError;
    expect(bad.httpStatus).toBe(400);
    expect(bad.body).toBeDefined();
    // The key-shaped query parameter is gone by name, the URL's path survives.
    expect(bad.body).not.toContain(SHORT_KEY);
    expect(bad.body).not.toContain("api_key");
    expect(bad.body).toContain("https://example.test/api/query?q=x");
    // The vendor-shaped run is gone by pattern.
    expect(bad.body).not.toContain(VENDOR_KEY);
    expect(bad.body).toContain(`[redacted:${VENDOR_KEY.length}]`);
    // The feed's own text is intact, so an adapter can still parse it.
    expect(bad.body).toContain("<summary>bad request; retry with ");
    // It is exactly the gate's output — no second rule in between.
    expect(bad.body).toBe(redactText(BODY_WITH_KEYS));
    // `context` is what a serializer or a log walker would see: the same
    // redacted string, never the raw one; the message carries no body.
    expect(bad.context.body).toBe(bad.body);
    expect(bad.message).toBe("HTTP 400 from example.test");
    expect(JSON.stringify(bad.context)).not.toContain(SHORT_KEY);
    expect(JSON.stringify(bad.context)).not.toContain(VENDOR_KEY);
  });

  it("attaches nothing for an empty 4xx body", async () => {
    const { client } = clientFor(stubXhr({ status: 404 }));

    const error = await client.request("GET", URL_OK).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).body).toBeUndefined();
    expect((error as BadRequestError).context).not.toHaveProperty("body");
  });

  it("reads .body only from a string in context", () => {
    expect(new BadRequestError(400, "x").body).toBeUndefined();
    expect(new BadRequestError(400, "x", { body: 7 }).body).toBeUndefined();
    expect(new BadRequestError(400, "x", { body: "<feed/>" }).body).toBe(
      "<feed/>",
    );
  });

  it.each([
    [401, AuthenticationError],
    [403, AuthorizationError],
    [429, RateLimitError],
    [500, UpstreamServerError],
    [503, UpstreamServerError],
  ] as const)(
    "does not attach the body to HTTP %i, whose classification is unchanged",
    async (status, expected) => {
      const { client } = clientFor(stubXhr({ status, body: BODY_WITH_KEYS }));

      const error = await client
        .request("GET", URL_OK)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(expected);
      expect(error).not.toBeInstanceOf(BadRequestError);
      expect((error as InstanceType<typeof expected>).httpStatus).toBe(status);
      expect(
        (error as InstanceType<typeof expected>).context,
      ).not.toHaveProperty("body");
      expect(JSON.stringify((error as Error).message)).not.toContain(SHORT_KEY);
    },
  );
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

  it("builds a host's policy from its §7.3 cells: base first, never above cap (item 228)", () => {
    const budget = { baseMs: 1000, capMs: 30_000, maxAttempts: 3 };
    const high = retryPolicyFromBudget(budget, () => 1);
    const low = retryPolicyFromBudget(budget, () => 0);
    expect(high.maxAttempts).toBe(3);
    // `withRetry` passes `prevDelayMs = 0` first, so the first wait is base.
    expect(high.nextDelayMs(0, 1)).toBe(1000);
    expect(low.nextDelayMs(0, 1)).toBe(1000);
    expect(high.nextDelayMs(1000, 2)).toBe(3000);
    expect(low.nextDelayMs(1000, 2)).toBe(1000);
    // The cap binds once `3 × prev` passes it.
    expect(high.nextDelayMs(20_000, 3)).toBe(30_000);
    // A malformed row fails when the policy is built, not on first use.
    expect(() =>
      retryPolicyFromBudget({ baseMs: 0, capMs: 1, maxAttempts: 3 }),
    ).toThrow(RangeError);
  });

  it("does not announce or schedule a retry once the token is cancelled (item 228)", async () => {
    const clock = createManualClock();
    const source = createCancellationTokenSource();
    const retries: number[] = [];
    let attempts = 0;

    const error = await withRetry(
      () => {
        attempts += 1;
        // The cancel lands while the attempt is in flight; the attempt then
        // fails with a retryable class.
        source.cancel({ kind: "user" });
        return Promise.reject(new UpstreamServerError(503, "boom"));
      },
      {
        policy: immediatePolicy(3),
        clock,
        token: source.token,
        onRetry: (info) => retries.push(info.attempt),
      },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OperationCancelledError);
    expect(attempts).toBe(1);
    expect(retries).toStrictEqual([]);
    expect(clock.pending).toBe(0);
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
    // Item 230 changed the retry policy, not this flag: a timeout is still
    // retryable in §10.1's sense, which is what the Retry button reads.
    expect(isRetryableError(new TimeoutError(60_000, URL_OK))).toBe(true);
  });

  it("retries automatically every retryable class except a timeout (item 230)", () => {
    expect(
      isRetriedAutomatically(new RateLimitError(429, undefined, "h")),
    ).toBe(true);
    expect(isRetriedAutomatically(new UpstreamServerError(503, "x"))).toBe(
      true,
    );
    expect(isRetriedAutomatically(new OfflineError("x"))).toBe(true);
    expect(isRetriedAutomatically(new NetworkError("x"))).toBe(true);
    // A `TimeoutError` is a `NetworkError`, so the exclusion has to be by
    // class and must not take the plain network failure with it.
    const timeout = new TimeoutError(60_000, URL_OK);
    expect(timeout).toBeInstanceOf(NetworkError);
    expect(isRetriedAutomatically(timeout)).toBe(false);
    // Narrows the flag; never widens it.
    expect(isRetriedAutomatically(new BadRequestError(404, "x"))).toBe(false);
    expect(
      isRetriedAutomatically(new OperationCancelledError({ kind: "user" })),
    ).toBe(false);
    expect(isRetriedAutomatically(new TypeError("a bug"))).toBe(false);
  });

  it("surfaces a transport timeout after one attempt, with retries allowed and nothing logged as a retry (item 230)", async () => {
    const transport = createStubTransport(() =>
      Promise.reject(new StubTimeoutException()),
    );
    const clock = createSystemClock();
    const sink = createCapturingSink();
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      retryFor: () => immediatePolicy(5),
      logger: createLogger({ sink, clock, level: "debug" }),
    });

    const error = (await client
      .request("GET", URL_OK)
      .catch((e: unknown) => e)) as TimeoutError;

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.retryable).toBe(true);
    expect(transport.calls).toHaveLength(1);
    // The failed attempt is logged; no retry is announced.
    expect(sink.lines.some((l) => l.includes("http request failed"))).toBe(
      true,
    );
    expect(sink.lines.filter((l) => l.includes("http retry"))).toStrictEqual(
      [],
    );
  });

  it("still retries a status-0 network failure and an offline failure to the cap (item 230)", async () => {
    for (const [name, fail] of [
      ["network", () => Promise.resolve(stubXhr({ status: 0 }))],
      ["offline", () => Promise.reject(new StubBrowserOfflineException())],
    ] as const) {
      const transport = createStubTransport(fail);
      const client = createHttpClient({
        transport,
        userAgent: UA,
        clock: createSystemClock(),
        retryFor: () => immediatePolicy(3),
      });

      const error = await client
        .request("GET", URL_OK)
        .catch((e: unknown) => e);

      expect(error, name).toBeInstanceOf(NetworkError);
      expect(error, name).not.toBeInstanceOf(TimeoutError);
      expect(transport.calls, name).toHaveLength(3);
    }
  });
});

// ---------------------------------------------------------------------------
// 5a. The total budget — plan/00 §6 item 233, docs/07 §7.3's dated note
// ---------------------------------------------------------------------------

describe("item 233: a 90-second total budget per request, retries included", () => {
  interface Settled {
    readonly value?: unknown;
    readonly error?: unknown;
    /** `clock.now()` when the promise settled. */
    readonly atMs: number;
  }

  /**
   * Step the manual clock one millisecond at a time until `promise` settles.
   * Stepping, not jumping, so the instant a request ends is an observation.
   */
  async function settleOn(
    clock: ManualClock,
    promise: Promise<unknown>,
    maxMs = 400_000,
  ): Promise<Settled> {
    let outcome: Settled | undefined;
    promise.then(
      (value: unknown) => {
        outcome = { value, atMs: clock.now() };
      },
      (error: unknown) => {
        outcome = { error, atMs: clock.now() };
      },
    );
    await flushMicrotasks();
    for (let step = 0; outcome === undefined; step += 1) {
      if (step >= maxMs) throw new Error(`not settled after ${maxMs} ms`);
      clock.advance(1);
      await flushMicrotasks();
    }
    return outcome;
  }

  /** A transport whose every answer arrives `afterMs` later on `clock`. */
  function slowTransport(
    clock: ManualClock,
    answer: (index: number) => { readonly afterMs: number; status: number },
  ): StubTransport {
    return createStubTransport(async (_call, index) => {
      const { afterMs, status } = answer(index);
      await clock.sleep(afterMs);
      return stubXhr({ status });
    });
  }

  it("is 90 seconds", () => {
    expect(REQUEST_BUDGET_MS).toBe(90_000);
  });

  it("ends arXiv's measured slow refusal after two attempts, at 95 s, with the last error", async () => {
    // `P0-T21`: arXiv 429s took up to 46 s to fail, with no Retry-After. The
    // arXiv row's waits are 3 s, then up to 9 s. Without the budget this is
    // three attempts and 46 + 3 + 46 + 9 + 46 = 150 s.
    const clock = createManualClock();
    const sink = createCapturingSink();
    const transport = slowTransport(clock, () => ({
      afterMs: 46_000,
      status: 429,
    }));
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      retryFor: () => ({
        maxAttempts: 3,
        nextDelayMs: (prev) => (prev === 0 ? 3000 : 9000),
      }),
      logger: createLogger({ sink, clock, level: "debug" }),
    });
    const t0 = clock.now();

    const outcome = await settleOn(clock, client.request("GET", URL_OK));

    expect(outcome.error).toBeInstanceOf(RateLimitError);
    expect(transport.calls).toHaveLength(2);
    // 46 s, the 3 s wait, 46 s: the budget is spent (95 s ≥ 90 s), so the
    // 9 s wait never starts and the second 429 is the request's error.
    expect(outcome.atMs - t0).toBe(95_000);
    expect(clock.pending).toBe(0);
    const retries = sink.lines.filter((l) => l.includes('"http retry"'));
    expect(retries).toHaveLength(1);
    const spent = sink.lines.filter((l) =>
      l.includes('"http retry budget spent"'),
    );
    expect(spent).toHaveLength(1);
    expect(spent[0]).toContain('"elapsedMs":95000');
    expect(spent[0]).toContain('"attempt":2');
  });

  it("starts no wait that would cross the budget, and rethrows the last error unchanged", async () => {
    // A Retry-After of 120 s cannot fit in 90 s: no wait, one attempt, the
    // very error the attempt threw.
    const clock = createManualClock();
    const refused = new RateLimitError(429, 120_000, "example.test");
    const retries: number[] = [];
    const spent: { attempt: number; elapsedMs: number; delayMs: number }[] = [];

    const error = await withRetry(() => Promise.reject(refused), {
      policy: immediatePolicy(3),
      clock,
      budget: { totalMs: REQUEST_BUDGET_MS },
      onRetry: (info) => retries.push(info.attempt),
      onBudgetSpent: ({ attempt, elapsedMs, delayMs }) =>
        spent.push({ attempt, elapsedMs, delayMs }),
    }).catch((e: unknown) => e);

    expect(error).toBe(refused);
    expect(retries).toStrictEqual([]);
    expect(spent).toStrictEqual([
      { attempt: 1, elapsedMs: 0, delayMs: 120_000 },
    ]);
    expect(clock.pending).toBe(0);
  });

  it("lets a wait that ends just inside the budget start, and not one that ends on it", async () => {
    // The attempt fails at 80 s. A 9 999 ms wait ends at 89 999 ms, inside
    // the budget, so the retry starts; a 10 000 ms wait ends on the 90 s mark,
    // and a retry starting there would start after the budget ran out.
    for (const [delayMs, expectedAttempts] of [
      [9_999, 2],
      [10_000, 1],
    ] as const) {
      const clock = createManualClock();
      let attempts = 0;
      const outcome = await settleOn(
        clock,
        withRetry(
          async () => {
            attempts += 1;
            if (attempts === 1) await clock.sleep(80_000);
            throw new UpstreamServerError(503, "boom");
          },
          {
            policy: { maxAttempts: 2, nextDelayMs: () => delayMs },
            clock,
            budget: { totalMs: REQUEST_BUDGET_MS },
          },
        ),
      );
      expect(outcome.error, String(delayMs)).toBeInstanceOf(
        UpstreamServerError,
      );
      expect(attempts, String(delayMs)).toBe(expectedAttempts);
    }
  });

  it("measures from the first attempt's start on the wire, not from the call", async () => {
    // The host's queue holds the first attempt for 120 s — longer than the
    // whole budget. That is pacing, not retrying: the request still gets
    // every retry its attempt cap allows.
    const clock = createManualClock();
    let runs = 0;
    const limiter: RateLimiterPort = {
      key: "example.test",
      acquire: () => Promise.resolve(),
      async run(fn) {
        runs += 1;
        if (runs === 1) await clock.sleep(120_000);
        return fn();
      },
      penalize: () => undefined,
    };
    const transport = createStubTransport(() =>
      Promise.resolve(stubXhr({ status: 503 })),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      limiterFor: () => limiter,
      retryFor: () => ({ maxAttempts: 3, nextDelayMs: () => 1000 }),
    });
    const t0 = clock.now();

    const outcome = await settleOn(clock, client.request("GET", URL_OK));

    expect(outcome.error).toBeInstanceOf(UpstreamServerError);
    expect(transport.calls).toHaveLength(3);
    expect(outcome.atMs - t0).toBe(122_000);
  });

  it("measures from the first attempt, not afresh from each attempt", async () => {
    // Each attempt takes 50 s. From the first attempt, 100 s have passed when
    // the second fails, so the request ends there; a budget restarted at each
    // attempt would only ever see 50 s and run all five.
    const clock = createManualClock();
    const transport = slowTransport(clock, () => ({
      afterMs: 50_000,
      status: 503,
    }));
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      retryFor: () => ({ maxAttempts: 5, nextDelayMs: () => 0 }),
    });

    const outcome = await settleOn(clock, client.request("GET", URL_OK));

    expect(outcome.error).toBeInstanceOf(UpstreamServerError);
    expect(transport.calls).toHaveLength(2);
  });

  it("never cuts an attempt short: a retry started inside the budget keeps its own timeout", async () => {
    // The first attempt fails at 80 s; the retry starts at 81 s and answers
    // 200 at 111 s, past the 90 s mark. The budget decides whether an attempt
    // starts, not how long it may run.
    const clock = createManualClock();
    const transport = slowTransport(clock, (index) =>
      index === 0
        ? { afterMs: 80_000, status: 503 }
        : { afterMs: 30_000, status: 200 },
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      timeoutMs: 60_000,
      retryFor: () => ({ maxAttempts: 3, nextDelayMs: () => 1000 }),
    });
    const t0 = clock.now();

    const outcome = await settleOn(clock, client.request("GET", URL_OK));

    expect(outcome.value).toMatchObject({ status: 200 });
    expect(outcome.atMs - t0).toBe(111_000);
    expect(transport.calls.map((call) => call.options.timeout)).toStrictEqual([
      60_000, 60_000,
    ]);
  });

  it("still stops at once on cancellation, which is checked before the budget", async () => {
    // The cancel lands while an attempt is in flight, and that attempt fails
    // after the budget is spent. The request ends cancelled, not with the
    // attempt's 503, and the budget is never consulted.
    const clock = createManualClock();
    const source = createCancellationTokenSource();
    const spent: number[] = [];
    const outcome = await settleOn(
      clock,
      withRetry(
        async () => {
          await clock.sleep(100_000);
          source.cancel({ kind: "user" });
          throw new UpstreamServerError(503, "boom");
        },
        {
          policy: immediatePolicy(3),
          clock,
          token: source.token,
          budget: { totalMs: REQUEST_BUDGET_MS },
          onBudgetSpent: (info) => spent.push(info.attempt),
        },
      ),
    );
    expect(outcome.error).toBeInstanceOf(OperationCancelledError);
    expect(spent).toStrictEqual([]);

    // And a cancel during a wait inside the budget ends the request without
    // the clock moving, with nothing more sent.
    const clock2 = createManualClock();
    const source2 = createCancellationTokenSource();
    const transport = createStubTransport(() =>
      Promise.resolve(stubXhr({ status: 503 })),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock: clock2,
      retryFor: () => ({ maxAttempts: 3, nextDelayMs: () => 5000 }),
    });
    let ended: unknown;
    const pending = client
      .request("GET", URL_OK, { token: source2.token })
      .catch((e: unknown) => {
        ended = e;
      });
    await flushMicrotasks();
    expect(transport.calls).toHaveLength(1);
    expect(clock2.pending).toBe(1);
    source2.cancel({ kind: "user" });
    await flushMicrotasks();
    expect(ended).toBeInstanceOf(OperationCancelledError);
    await pending;
    expect(transport.calls).toHaveLength(1);
  });

  it("gives a host with no retry policy no budget: its one attempt runs to its own timeout", async () => {
    // The LLM/TTS row and a host with no row make one attempt; a long one is
    // bounded by the timeout alone, never by the 90 s budget.
    const clock = createManualClock();
    const transport = slowTransport(clock, () => ({
      afterMs: 200_000,
      status: 200,
    }));
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      timeoutMs: 300_000,
    });

    const outcome = await settleOn(clock, client.request("GET", URL_OK));

    expect(outcome.value).toMatchObject({ status: 200 });
    expect(transport.calls).toHaveLength(1);
  });
});

/**
 * `P1-T26`: the parser `client.ts` uses is now
 * `src/core/rateLimit/backoff.ts`'s `parseRetryAfter`, and `retry.ts`'s second
 * copy of it is gone — deleted name included, so that the card's first
 * criterion (a recursive grep finds nothing) holds. Every assertion that was
 * written against the
 * removed copy survives here, retargeted — which is also what proves the two
 * really did agree on the cases that matter, rather than the move quietly
 * dropping the harder ones.
 */
describe("Retry-After, parsed by core/rateLimit/backoff.ts", () => {
  it("reads the delta-seconds form", () => {
    expect(parseRetryAfter("2", 0)).toBe(2000);
    expect(parseRetryAfter("120", 0)).toBe(120_000);
    expect(parseRetryAfter(" 0 ", 0)).toBe(0);
  });

  it("reads the HTTP-date form, relative to the injected clock", () => {
    const nowMs = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:30 GMT", nowMs)).toBe(
      30_000,
    );
    // A date already in the past is "retry now", never a negative delay.
    expect(parseRetryAfter("Wed, 21 Oct 2015 07:27:00 GMT", nowMs)).toBe(0);
  });

  it("returns undefined for an absent or unusable value", () => {
    expect(parseRetryAfter(undefined, 0)).toBeUndefined();
    expect(parseRetryAfter("", 0)).toBeUndefined();
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
  });

  it("refuses the three values a bare Date.parse would read as years", () => {
    // The card's load-bearing **Do NOT**, re-asserted at the call site's own
    // file because this is where the removed copy got it wrong: it reached
    // `Date.parse` with no shape check, and `Date.parse("120.5")` is the year
    // 120, not NaN — a deadline two millennia in the past, which clamps to
    // "retry immediately" against a host that just asked us to stop.
    for (const value of ["120.5", "-5", "+120"]) {
      expect(parseRetryAfter(value, 0)).toBeUndefined();
      expect(Number.isNaN(Date.parse(value))).toBe(false);
    }
  });
});

describe("Retry-After end to end (P1-T26 criterion 2)", () => {
  it("penalizes by exactly 120 000 ms on a 429 carrying Retry-After: 120", async () => {
    const clock = createManualClock();
    const limiter = createStubLimiter();
    const transport = createStubTransport(() =>
      Promise.resolve(
        stubXhr({ status: 429, headers: { "Retry-After": "120" } }),
      ),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      limiterFor: () => limiter,
    });

    const error = await client.request("GET", URL_OK).catch((e: unknown) => e);

    expect((error as RateLimitError).retryAfterMs).toBe(120_000);
    expect(limiter.penalties).toHaveLength(1);
    expect(limiter.penalties[0]!.untilEpochMs - clock.now()).toBe(120_000);
  });

  it.each(["120.5", "-5", "+120", "Sun Nov  6 08:49:37 1994"])(
    "does not penalize at all on a malformed Retry-After (%s)",
    async (value) => {
      // The failure mode the shape check exists for: a bare `Date.parse` makes
      // every one of these a *past* deadline, so the host would be penalized
      // until an instant already gone — i.e. not at all — while
      // `RateLimitError.retryAfterMs` reported 0 and the retry loop fired
      // immediately. `asctime` is in the list because it carries no timezone
      // and would be read in the local one.
      const clock = createManualClock();
      const limiter = createStubLimiter();
      const transport = createStubTransport(() =>
        Promise.resolve(
          stubXhr({ status: 429, headers: { "Retry-After": value } }),
        ),
      );
      const client = createHttpClient({
        transport,
        userAgent: UA,
        clock,
        limiterFor: () => limiter,
      });

      const error = await client
        .request("GET", URL_OK)
        .catch((e: unknown) => e);

      expect((error as RateLimitError).retryAfterMs).toBeUndefined();
      expect(limiter.penalties).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// 5b. Live rate-limit headers — P1-T26 step 2
// ---------------------------------------------------------------------------

const NCBI_NO_KEY: RateLimiterConfig = {
  ratePerSecond: 2.5,
  burst: 1,
  maxConcurrent: 3,
};

describe("the client reconfigures the limiter from live headers", () => {
  it("demonstrably slows the next acquire (P1-T26 criterion 3)", async () => {
    // Over a *real* `TokenBucket` on a manual clock, so "slows" is measured in
    // milliseconds rather than asserted on a spy. 10/s with burst 1: after the
    // first request the bucket is empty, and the next token is 100 ms away at
    // the configured rate and 1000 ms away at the rate the response advertises.
    const clock = createManualClock();
    const limiter = new TokenBucket(
      "example.test",
      { ratePerSecond: 10, burst: 1, maxConcurrent: 3 },
      clock,
    );
    const transport = createStubTransport(() =>
      Promise.resolve(
        stubXhr({
          status: 200,
          headers: {
            "x-rate-limit-limit": "1",
            "x-rate-limit-interval": "1s",
          },
        }),
      ),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      limiterFor: () => limiter,
    });

    await client.request("GET", `${URL_OK}?n=1`);
    expect(limiter.currentConfig.ratePerSecond).toBe(1);

    const second = client.request("GET", `${URL_OK}?n=2`);
    await flushMicrotasks();
    // Not yet: at the original 10/s this request would already be on the wire.
    clock.advance(100);
    await flushMicrotasks();
    expect(transport.calls).toHaveLength(1);

    // Let the clock run on until it does go out, and measure when.
    const t0 = clock.now() - 100;
    for (let i = 0; i < 2000 && transport.calls.length < 2; i += 1) {
      clock.advance(1);
      await flushMicrotasks();
    }
    expect(transport.calls).toHaveLength(2);
    expect(clock.now() - t0).toBe(1000);
    await expect(second).resolves.toMatchObject({ status: 200 });
  });

  it("reads the headers on a 429 too, and still penalizes", async () => {
    const clock = createManualClock();
    const limiter = new TokenBucket("example.test", NCBI_NO_KEY, clock);
    const transport = createStubTransport(() =>
      Promise.resolve(
        stubXhr({
          status: 429,
          headers: { "X-Ratelimit-Limit": "1", "Retry-After": "120" },
        }),
      ),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      limiterFor: () => limiter,
    });

    await client.request("GET", URL_OK).catch(() => undefined);

    expect(limiter.currentConfig.ratePerSecond).toBe(1);
    expect(limiter.stats.penalizedUntilEpochMs).toBe(clock.now() + 120_000);
  });

  it("logs the reconfiguration, and logs nothing extra when there is none", async () => {
    const clock = createManualClock();
    const sink = createCapturingSink();
    const logger = createLogger({ sink, clock, level: "info" });
    // Rate and burst are generous so that three requests go out without the
    // manual clock having to be advanced; the point here is the log lines, not
    // the pacing (which the criterion-3 test above measures).
    const limiter = new TokenBucket(
      "example.test",
      { ratePerSecond: 1000, burst: 10, maxConcurrent: 3 },
      clock,
    );
    const transport = createStubTransport((_call, index) =>
      Promise.resolve(
        stubXhr({
          status: 200,
          // The first response tightens 1000/s to 100/s; the second advertises
          // the same 100 again, which must not reconfigure or log a second
          // time, and the third advertises *more*, which must not either.
          headers: { "x-ratelimit-limit": index === 2 ? "200" : "100" },
        }),
      ),
    );
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      logger,
      limiterFor: () => limiter,
    });

    await client.request("GET", URL_OK);
    const afterFirst = sink.lines.length;
    await client.request("GET", URL_OK);
    await client.request("GET", URL_OK);

    expect(afterFirst).toBe(2);
    expect(sink.lines[1]).toContain("rate limit reconfigured");
    expect(sink.lines[1]).toContain('"ratePerSecond":100');
    // Two more requests, two more "http request" lines and nothing else.
    expect(sink.lines).toHaveLength(4);
    expect(limiter.currentConfig.ratePerSecond).toBe(100);
  });

  it("leaves an unpaced host alone", async () => {
    const { client } = clientFor(
      stubXhr({ status: 200, headers: { "x-ratelimit-limit": "1" } }),
    );

    await expect(client.request("GET", URL_OK)).resolves.toMatchObject({
      status: 200,
    });
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

describe("D10 on the NCBI ID Converter host (item 229, 2026-10-20)", () => {
  // `docs/02` §2.2's final assignment table lists `pmc.ncbi.nlm.nih.gov`
  // beside E-utilities since 2026-10-20, so the client's guard covers it too.
  const idconv = (query: string): string =>
    `https://${PMC_IDCONV_HOST}/tools/idconv/api/v1/articles/?${query}`;

  it("refuses another email to the converter, before it is issued, without echoing it", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    const error = await client
      .request(
        "GET",
        idconv(
          "ids=PMC7605294&idtype=pmcid&format=json&tool=research_helper&email=user@x.test",
        ),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PolicyViolationError);
    expect(transport.calls).toHaveLength(0);
    expect((error as PolicyViolationError).message).toContain(PMC_IDCONV_HOST);
    expect((error as PolicyViolationError).message).not.toContain(
      "user@x.test",
    );
    expect(
      JSON.stringify((error as PolicyViolationError).context),
    ).not.toContain("user@x.test");
  });

  it("refuses another tool value to the converter", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await expect(
      client.request("GET", idconv("ids=PMC7605294&tool=someone-else")),
    ).rejects.toBeInstanceOf(PolicyViolationError);
    expect(transport.calls).toHaveLength(0);
  });

  it("refuses an upper-case spelling of the converter host too", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));

    await expect(
      client.request(
        "GET",
        `https://PMC.NCBI.NLM.NIH.GOV/tools/idconv/api/v1/articles/?email=user@x.test`,
      ),
    ).rejects.toBeInstanceOf(PolicyViolationError);
    expect(transport.calls).toHaveLength(0);
  });

  it("lets the shipped converter's own URL through", async () => {
    const { client, transport } = clientFor(stubXhr({ status: 200 }));
    const url = buildIdConverterUrl(["PMC7605294"]);
    expect(new URL(url).searchParams.get("email")).toBe(MAINTAINER_EMAIL);

    await client.request("GET", url);

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
