import { afterEach, describe, expect, it } from "vitest";

import {
  adoptPrefObserverHandle,
  createScope,
  installServices,
  registration,
  type Scope,
  type ServiceGraphOptions,
} from "../../../src/bootstrap/container";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import {
  createMemoryPrefStore,
  type PrefObserverHandle,
  type PrefScalar,
  type PrefStore,
} from "../../../src/core/config";
import { ConfigurationError } from "../../../src/core/errors";
import {
  getHttpClient,
  httpRequest,
  setHttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import {
  MAINTAINER_EMAIL,
  PROJECT_URL,
  TOOL_NAME,
} from "../../../src/core/http/userAgent";
import {
  PROGRESS_REPAINT_INTERVAL_MS,
  type ProgressSnapshot,
} from "../../../src/core/jobQueue/progress";
import type { LogSink } from "../../../src/core/logger";
import {
  NCBI_HOST,
  NCBI_KEY_PRESENT_PREF,
  peekHostLimiters,
  resetHostLimiters,
  type HostLimiterRegistry,
} from "../../../src/core/rateLimit/hostLimiter";
import { TokenBucket } from "../../../src/core/rateLimit/tokenBucket";
import { getPrefStore, setPrefStore } from "../../../src/prefs";
import type { ProgressWindowHandle } from "../../../src/zotero/progressWindow";

/**
 * `P1-T25` — the composition root.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, no Zotero instance, no network. Every
 * platform half is injected into `installServices()` **at the root**, which is
 * what the card's first criterion requires in place of patching a module —
 * and which is only possible because `src/core/http/client.ts`,
 * `src/core/rateLimit/hostLimiter.ts` and `src/core/jobQueue/progress.ts` all
 * take ports.
 *
 * The four criteria, and where each is measured:
 *
 * 1. `httpRequest()` issues through the real transport after startup — §2.
 * 2. a second request to the same host is paced by the registry's bucket,
 *    asserted on the clock — §3.
 * 3. construct → dispose → construct leaves zero surviving registrations,
 *    observers or windows — §4, over five cycles (`P0-T11`'s discipline).
 * 4. typecheck / lint / test exit 0 — the card's `Verify with`.
 *
 * §5 covers `observePref`'s handle, which is `P1-T25` step 3 and has no
 * criterion of its own.
 *
 * **§6 is `P1-T31`'s**, the card that made `ServiceGraph.progress` a per-job
 * factory. Its five behavioural criteria are measured there; the two latches it
 * added to `src/core/jobQueue/progress.ts` are measured in
 * `test/unit/core/progress.test.ts`, and §4's last test — `P1-T25`'s
 * asymmetry assertion — was **updated rather than deleted**, so the fix is
 * visible where the defect was recorded.
 */

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Zotero's exception classes, as `instanceof` needs them (`docs/01` §8.1). */
class StubTimeoutException extends Error {}
class StubBrowserOfflineException extends Error {}
class StubCancelledException extends Error {}
class StubSecurityException extends Error {}
class StubUnexpectedStatusException extends Error {}

interface RecordedCall {
  readonly url: string;
  readonly options: HttpTransportOptions;
  /** The clock reading when the transport was entered. */
  readonly atMs: number;
}

interface FakeTransport extends HttpTransport {
  readonly calls: RecordedCall[];
}

/**
 * A transport that records every call and always answers 200.
 *
 * It reads the clock itself, so the pacing assertion in §3 is an observation
 * of when the request actually reached the wire rather than of when a promise
 * happened to settle.
 */
function createFakeTransport(clock: ManualClock): FakeTransport {
  const calls: RecordedCall[] = [];
  const xhr: HttpTransportXhr = {
    status: 200,
    responseText: "ok",
    responseURL: "",
    getAllResponseHeaders: () => "",
  };
  return {
    calls,
    request(_method, url, options) {
      calls.push({ url, options, atMs: clock.now() });
      return Promise.resolve(xhr);
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

interface FakeProgressWindow extends ProgressWindowHandle {
  readonly events: string[];
  readonly closed: () => boolean;
}

/** A `Zotero.ProgressWindow` that only records. */
function createFakeProgressWindow(): FakeProgressWindow {
  const events: string[] = [];
  let isClosed = false;
  return {
    events,
    closed: () => isClosed,
    show: () => void events.push("show"),
    changeHeadline: (text) => void events.push(`headline:${text}`),
    addLine: (_itemType, text) => {
      events.push(`line:${text}`);
      return {
        setProgress: (percent) => void events.push(`progress:${percent}`),
        setText: (next) => void events.push(`text:${next}`),
        setError: () => void events.push("error"),
      };
    },
    startCloseTimer: (ms) => void events.push(`closeTimer:${ms}`),
    close: () => {
      isClosed = true;
      events.push("close");
    },
  };
}

/**
 * A {@link PrefStore} whose `observe` returns a {@link ScopedRegistration} —
 * the shape `createZoteroPrefStore()` returns, without a Zotero instance.
 *
 * `liveObservers` is what criterion 3's "no observer survives" is measured on:
 * an observer registered without going through the scope, or one the scope
 * failed to undo, shows up as a non-zero count.
 */
function createScopedPrefStore(
  initial: Readonly<Record<string, PrefScalar>> = {},
): PrefStore & {
  readonly values: Map<string, PrefScalar>;
  readonly liveObservers: () => number;
  notify(key: string, value: unknown): void;
} {
  const values = new Map<string, PrefScalar>(Object.entries(initial));
  const live = new Map<
    number,
    { key: string; handler: (value: unknown) => void }
  >();
  let nextId = 1;

  return {
    values,
    liveObservers: () => live.size,
    get: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    clear: (key) => void values.delete(key),
    observe(key, handler): PrefObserverHandle {
      // Exactly `src/zotero/prefStore.ts`'s shape: inert until a `Scope` runs
      // it, and the handle is what `unregister` receives.
      return registration<number>({
        description: `fake pref observer: ${key}`,
        register() {
          const id = nextId;
          nextId += 1;
          live.set(id, { key, handler });
          return id;
        },
        unregister(id) {
          live.delete(id);
        },
      });
    },
    notify(key, value) {
      for (const entry of live.values()) {
        if (entry.key === key) entry.handler(value);
      }
    },
  };
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

/** Let every already-queued microtask run (`tokenBucket.test.ts`'s helper). */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/**
 * Advance the manual clock one millisecond at a time until `done()`.
 *
 * Stepping rather than jumping is what makes an elapsed figure an observation:
 * the loop never tells the bucket when to fire, it only lets time pass.
 */
async function runUntil(
  clock: ManualClock,
  done: () => boolean,
  maxSteps = 20_000,
): Promise<void> {
  await flush();
  for (let steps = 0; !done(); steps += 1) {
    if (steps >= maxSteps) {
      throw new Error(`clock advanced ${maxSteps} ticks without finishing`);
    }
    clock.advance(1);
    await flush();
  }
}

/** Narrow away `undefined` without a non-null assertion. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/**
 * The host's bucket as a {@link TokenBucket}.
 *
 * `HostLimiterRegistry.limiterFor` is typed as `docs/07` §4.1's `RateLimiter`,
 * which declares no reader for the configuration in force — `currentConfig` is
 * one of `TokenBucket`'s two deliberate "beyond §4.1" members.
 * `test/unit/core/tokenBucket.test.ts` narrows the same way.
 */
function bucketOf(limiters: HostLimiterRegistry, host: string): TokenBucket {
  const limiter = must(limiters.limiterFor(host), `a limiter for ${host}`);
  if (!(limiter instanceof TokenBucket)) {
    throw new Error(`the limiter for ${host} is not a TokenBucket`);
  }
  return limiter;
}

interface Harness {
  readonly scope: Scope;
  readonly clock: ManualClock;
  readonly transport: FakeTransport;
  readonly prefs: ReturnType<typeof createScopedPrefStore>;
  /**
   * Every popup the `openProgressWindow` seam has handed out, in order.
   *
   * A list rather than one window since `P1-T31`: the popup is per job
   * (`docs/07` §7.7's "One window per job"), so two jobs must be observable
   * separately — which is exactly what criterion 4 ("the first job's
   * completion does not close surfaces a second job is still using") needs.
   */
  readonly windows: FakeProgressWindow[];
  readonly sink: ReturnType<typeof createCapturingSink>;
  readonly errors: { message: string; error: unknown }[];
  readonly options: ServiceGraphOptions;
}

/**
 * Everything one construct/dispose cycle needs, with a fresh root scope.
 *
 * `strict: true` mirrors `src/addon.ts` in development, so the scope's
 * duplicate-description guard is live in every test here.
 */
function harness(
  overrides: Partial<ServiceGraphOptions> = {},
  initialPrefs: Readonly<Record<string, PrefScalar>> = {},
): Harness {
  const clock = createManualClock();
  const transport = createFakeTransport(clock);
  const prefs = createScopedPrefStore(initialPrefs);
  const windows: FakeProgressWindow[] = [];
  const sink = createCapturingSink();
  const errors: { message: string; error: unknown }[] = [];
  const scope = createScope({
    description: "test root",
    onError: (message, error) => void errors.push({ message, error }),
    strict: true,
  });
  return {
    scope,
    clock,
    transport,
    prefs,
    windows,
    sink,
    errors,
    options: {
      transport,
      prefs,
      version: "1.2.3",
      progressHeadline: "Research Helper",
      logSink: sink,
      clock,
      // A fresh popup per call: the seam is called once per job now.
      openProgressWindow: () => {
        const popup = createFakeProgressWindow();
        windows.push(popup);
        return popup;
      },
      ...overrides,
    },
  };
}

/** A URL on the one host `docs/07` §7.3 gives Phase 1 a policy row for. */
function ncbiUrl(path: string): string {
  return `https://${NCBI_HOST}/entrez/eutils/${path}`;
}

afterEach(() => {
  // Belt and braces: every test tears its graph down through the scope, and
  // these three lines make a test that forgot to unable to poison the next.
  setHttpClient(undefined);
  resetHostLimiters();
  setPrefStore(undefined);
});

// ---------------------------------------------------------------------------
// 1. What the graph installs
// ---------------------------------------------------------------------------

describe("installServices wires the graph Phase 1 built", () => {
  it("installs the PrefStore, the limiter registry and the HTTP client", async () => {
    const h = harness();

    const graph = await installServices(h.scope, h.options);

    expect(getPrefStore()).toBe(h.prefs);
    expect(peekHostLimiters()).toBe(graph.limiters);
    expect(getHttpClient()).toBe(graph.http);
    // `docs/07` §7.3's one row Phase 1 ships.
    expect(graph.limiters.hosts).toEqual([NCBI_HOST]);
    expect(graph.limiters.limiterFor(NCBI_HOST)).toBeDefined();
    // Every disposable is in the scope, not merely constructed.
    expect(h.scope.size).toBeGreaterThan(0);

    await h.scope.unregisterAll();
  });

  it("refuses a second graph rather than pacing a host twice as fast", async () => {
    const first = harness();
    await installServices(first.scope, first.options);

    const second = harness();
    await expect(
      installServices(second.scope, second.options),
    ).rejects.toBeInstanceOf(ConfigurationError);
    // The standing graph is untouched: the guard runs before anything mutates.
    expect(getPrefStore()).toBe(first.prefs);
    expect(second.scope.size).toBe(0);

    await first.scope.unregisterAll();
  });

  it("refuses an unsubstituted User-Agent version (docs/02 §2.2)", async () => {
    const h = harness({ version: "{{version}}" });

    await expect(installServices(h.scope, h.options)).rejects.toBeInstanceOf(
      RangeError,
    );
    // The graph failed on the way up, so nothing global is left installed —
    // except the PrefStore, which is step 1 and is registered with the scope.
    expect(getHttpClient()).toBeUndefined();
    await h.scope.unregisterAll();
    expect(getPrefStore()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Criterion 1 — httpRequest() reaches the real transport
// ---------------------------------------------------------------------------

describe("criterion 1: httpRequest() issues through the installed transport", () => {
  it("delegates the free function to the root's client, with D10 and the pref timeout", async () => {
    // 11 is a legal `timeoutSeconds` (§8.5: 10–600) and is not the default, so
    // reading it proves the getter rather than the fallback.
    const h = harness({}, { timeoutSeconds: 11 });
    await installServices(h.scope, h.options);

    const response = await httpRequest({
      method: "GET",
      url: ncbiUrl("esearch.fcgi?db=pubmed&term=x"),
    });

    expect(response.status).toBe(200);
    expect(h.transport.calls).toHaveLength(1);
    const call = must(h.transport.calls[0], "the recorded transport call");
    // The D10 User-Agent, built from the version the root was given.
    expect(call.options.headers?.["User-Agent"]).toBe(
      `${TOOL_NAME}/1.2.3 (${PROJECT_URL}; mailto:${MAINTAINER_EMAIL})`,
    );
    // `timeoutSeconds` × 1000, read through the getter the root injected —
    // `core/` never imported `src/prefs/` to get it.
    expect(call.options.timeout).toBe(11_000);
    // §7.4's option set survived the wiring.
    expect(call.options.successCodes).toBe(false);
    expect(call.options.anon).toBe(true);

    await h.scope.unregisterAll();
  });

  it("logs the exchange through the sink the root injected", async () => {
    const h = harness({}, { logLevel: "info" });
    await installServices(h.scope, h.options);

    await httpRequest({ method: "GET", url: ncbiUrl("esummary.fcgi") });

    const line = h.sink.lines.find((l) => l.includes('"msg":"http request"'));
    expect(line).toBeDefined();
    expect(line).toContain(NCBI_HOST);

    await h.scope.unregisterAll();
  });

  it("leaves httpRequest() unserviceable again after teardown", async () => {
    const h = harness();
    await installServices(h.scope, h.options);
    await h.scope.unregisterAll();

    expect(() =>
      httpRequest({ method: "GET", url: ncbiUrl("esearch.fcgi") }),
    ).toThrow(ConfigurationError);
  });

  it("logs without throwing once the PrefStore is detached (FR-56)", async () => {
    // The level getter reads `logLevel` on every emit, and `getPref` throws
    // when no store is installed. A logger that threw during or after shutdown
    // would put an error in the debug log, which is what FR-56 forbids.
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    await h.scope.unregisterAll();

    expect(() => graph.logger.error("after teardown")).not.toThrow();
    expect(h.sink.lines.some((l) => l.includes("after teardown"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Criterion 2 — the second request is paced by the registry's bucket
// ---------------------------------------------------------------------------

describe("criterion 2: a second request to one host is paced by its bucket", () => {
  it("holds the second request for the policy's interval, measured on the clock", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    const policy = must(graph.limiters.policyFor(NCBI_HOST), "the NCBI row");
    const t0 = h.clock.now();

    const first = httpRequest({ method: "GET", url: ncbiUrl("a.fcgi") });
    const second = httpRequest({ method: "GET", url: ncbiUrl("b.fcgi") });
    await flush();

    // `burst: 1`, so one token was available and the second caller is parked
    // inside `TokenBucket.acquire` — before the transport, per §7.4's order.
    expect(h.transport.calls).toHaveLength(1);

    await runUntil(h.clock, () => h.transport.calls.length === 2);
    await Promise.all([first, second]);

    // Derived from the shipped §7.3 row, not written as 400, so a change to
    // the policy table fails this loudly instead of silently.
    const intervalMs =
      (policy.withoutKey.burst / policy.withoutKey.ratePerSecond) * 1000;
    expect(intervalMs).toBe(400);
    expect(must(h.transport.calls[0], "call 1").atMs).toBe(t0);
    expect(must(h.transport.calls[1], "call 2").atMs).toBe(t0 + intervalMs);

    await h.scope.unregisterAll();
  });

  it("paces an unregistered host not at all, which is deliberate (P1-T04 rule 4)", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    expect(graph.limiters.limiterFor("example.test")).toBeUndefined();

    const calls = [
      httpRequest({ method: "GET", url: "https://example.test/a" }),
      httpRequest({ method: "GET", url: "https://example.test/b" }),
    ];
    await flush();

    expect(h.transport.calls).toHaveLength(2);
    await Promise.all(calls);
    await h.scope.unregisterAll();
  });
});

// ---------------------------------------------------------------------------
// 4. Criterion 3 — construct → dispose → construct
// ---------------------------------------------------------------------------

describe("criterion 3: the disable/enable cycle leaves nothing standing", () => {
  it("survives five cycles with zero survivors each time (P0-T11, at the root)", async () => {
    for (let cycle = 1; cycle <= 5; cycle += 1) {
      const h = harness();
      const graph = await installServices(h.scope, h.options);

      // A job runs and finishes, so the popup is actually raised. The job
      // asks for `docs/08` §4.4's completion toast, which is what
      // `searchImport` passes, and **never calls `job.dispose()`** — so this
      // also measures that `FR-56` does not depend on a pipeline's `finally`.
      const job = graph.progress.forJob(`cycle ${cycle}`, {
        openOn: "completion",
      });
      job.reporter.setMessage(`cycle ${cycle}`);
      job.reporter.setProgress(1, 2);
      job.reporter.done("succeeded");
      expect(graph.progress.openJobs).toBe(1);
      const popup = must(h.windows[0], "the job's popup");
      expect(popup.events).toContain("show");
      expect(popup.closed()).toBe(false);
      expect(job.events.latest?.status).toBe("succeeded");

      expect(h.prefs.liveObservers()).toBe(1);
      expect(h.scope.size).toBeGreaterThan(0);

      await h.scope.unregisterAll();

      // Registrations: none.
      expect(h.scope.liveHandles()).toEqual([]);
      expect(h.scope.size).toBe(0);
      // Observers: none.
      expect(h.prefs.liveObservers()).toBe(0);
      // Windows: none — the scope disposed the job the pipeline left open, and
      // that closed the popup. One window per job, so one window here.
      expect(h.windows).toHaveLength(1);
      expect(popup.closed()).toBe(true);
      expect(graph.progress.openJobs).toBe(0);
      // Process-wide holders: empty, which is what lets the next cycle
      // construct at all (`installHostLimiters` refuses a second install).
      expect(getHttpClient()).toBeUndefined();
      expect(peekHostLimiters()).toBeUndefined();
      expect(getPrefStore()).toBeUndefined();
      // No teardown threw.
      expect(h.errors).toEqual([]);
    }
  });

  it("tears the graph down in the reverse of the order it went up", async () => {
    const h = harness();
    await installServices(h.scope, h.options);

    const live = h.scope.liveHandles();
    // `liveHandles()` reports most-recently-registered first, which is also
    // teardown order: surfaces, then client, then observer, then registry,
    // then the PrefStore last.
    expect(live[0]).toBe("job progress reporters and their surfaces");
    expect(live[live.length - 1]).toBe("PrefStore (src/prefs)");

    await h.scope.unregisterAll();
  });

  /**
   * **The `P1-T25` asymmetry assertion, updated by `P1-T31` rather than
   * deleted**, so the fix is visible where the defect was recorded.
   *
   * What `P1-T25` measured on 2026-10-01:
   * `CompositeProgressReporter.dispose()` set its own `disposed` flag and
   * disposed its sinks, but the reporter *tree* kept emitting — `ProgressNode`
   * went inert only on `done()` / `root.terminal`, never on disposal — so a
   * job that outlived the plugin still fanned out. The two shipped sinks then
   * disagreed: `ZoteroProgressWindowSink` opened no window because it carried
   * its own `disposed` guard, which is what criterion 3's "no window
   * survives" actually rested on, while `createObservableProgressSink()`
   * cleared `latest` without latching, so the next `update()` repopulated
   * `latest` on a sink nothing could subscribe to.
   *
   * `P1-T31` closed both halves: `dispose()` now sets `root.disposed` and
   * `inert` reads it, and the dialog sink latches. This test now asserts the
   * *symmetry* — and it asserts it on a popup that was really opened, which
   * the `P1-T25` version could not: its `seen` was 0 before teardown and 0
   * after, so "no window survives" was vacuously true there.
   */
  it("latches both sinks after teardown — the P1-T25 asymmetry is gone", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);

    // §7.7's popup behaviour, so a window really is open when teardown comes.
    const job = graph.progress.forJob("outlives the plugin", {
      openOn: "progress",
    });
    job.reporter.setProgress(1, 2);
    const popup = must(h.windows[0], "the job's popup");
    expect(popup.events).toContain("show");
    expect(job.events.latest?.completed).toBe(1);

    await h.scope.unregisterAll();

    expect(popup.closed()).toBe(true);
    const platformCalls = popup.events.length;

    // The job did not notice the plugin going away and keeps reporting.
    h.clock.advance(10_000);
    job.reporter.setProgress(2, 2);
    job.reporter.done("succeeded");

    // The window sink: unchanged behaviour, and now for the structural reason
    // rather than only its own guard — nothing was reopened and nothing was
    // painted into the closed popup.
    expect(h.windows).toHaveLength(1);
    expect(popup.events).toHaveLength(platformCalls);
    // The dialog sink: this is the line that used to read
    // `expect(...latest?.status).toBe("succeeded")` — the snapshot it accepted
    // after its own dispose(). It accepts nothing now.
    expect(job.events.latest).toBeUndefined();
    // And a view that attaches during teardown gets a callable no-op rather
    // than a listener on a dead sink.
    const replayed: ProgressSnapshot[] = [];
    const off = job.events.subscribe((snapshot) => replayed.push(snapshot));
    expect(off).toBeInstanceOf(Function);
    expect(replayed).toEqual([]);
    off();
  });
});

// ---------------------------------------------------------------------------
// 5. Step 3 — observePref's handle becomes a real one
// ---------------------------------------------------------------------------

describe("step 3: observePref's opaque handle is bound to the scope", () => {
  it("registers the ncbi.keyPresent observer and reconfigures the bucket live", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    const policy = must(graph.limiters.policyFor(NCBI_HOST), "the NCBI row");
    const bucket = bucketOf(graph.limiters, NCBI_HOST);

    // One handle per row carrying a key-presence pref, and it was inert until
    // the scope ran it: the fake store counts a live observer only after
    // `installServices` adopted it.
    expect(graph.limiters.observers).toHaveLength(1);
    expect(h.prefs.liveObservers()).toBe(1);

    // A key entered while Zotero is running raises the budget without a
    // restart — `P1-T04` step 5's whole point, reachable only once something
    // runs the handle.
    h.prefs.set(NCBI_KEY_PRESENT_PREF, true);
    h.prefs.notify(NCBI_KEY_PRESENT_PREF, true);

    expect(bucket.currentConfig.ratePerSecond).toBe(
      must(policy.withKey, "the with-key policy").ratePerSecond,
    );

    await h.scope.unregisterAll();

    // And after teardown the observer is gone, so a later pref change cannot
    // reach a registry that no longer exists.
    h.prefs.notify(NCBI_KEY_PRESENT_PREF, false);
    expect(h.prefs.liveObservers()).toBe(0);
  });

  it("accepts the unsubscribe-thunk shape createMemoryPrefStore returns", async () => {
    // The two shipped `PrefStore` implementations return opposite handles —
    // see `adoptPrefObserverHandle`'s doc comment. This asserts the arity-0
    // branch is not mistaken for a registration, which would silently
    // *unsubscribe* the observer that was just installed.
    const store = createMemoryPrefStore();
    const h = harness({ prefs: store });
    const graph = await installServices(h.scope, h.options);
    const bucket = bucketOf(graph.limiters, NCBI_HOST);
    const unkeyed = bucket.currentConfig.ratePerSecond;

    store.set(NCBI_KEY_PRESENT_PREF, true);
    store.notify(NCBI_KEY_PRESENT_PREF, true);
    expect(bucket.currentConfig.ratePerSecond).toBeGreaterThan(unkeyed);

    await h.scope.unregisterAll();

    // The thunk ran, so the handler is detached: a notification after teardown
    // changes nothing.
    store.set(NCBI_KEY_PRESENT_PREF, false);
    store.notify(NCBI_KEY_PRESENT_PREF, false);
    expect(bucket.currentConfig.ratePerSecond).toBeGreaterThan(unkeyed);
  });

  it("refuses a handle it cannot bind rather than leaking the observer", async () => {
    const scope = createScope({
      description: "handle test",
      onError: () => undefined,
      strict: true,
    });

    // `docs/07` §8.5.1's sketched `Symbol` is exactly such a handle: nothing
    // the composition root can undo, which is why `P1-T03` reported it as
    // unreachable.
    await expect(
      adoptPrefObserverHandle(scope, {}, "an unbindable handle"),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(scope.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. `P1-T31` — one reporter per job
// ---------------------------------------------------------------------------

describe("P1-T31: ServiceGraph.progress hands out one reporter per job", () => {
  it("reports a second job after the first ran to done('succeeded')", async () => {
    // **The card's decisive criterion: the assertion that fails today.** With
    // `P1-T25`'s single app-scoped reporter, §4.1's terminal `done()` made
    // every later job a silent no-op — a progress bar that never moved on the
    // second search, with no error anywhere.
    const h = harness();
    const graph = await installServices(h.scope, h.options);

    const first = graph.progress.forJob("job 1", { openOn: "completion" });
    first.reporter.setProgress(1, 1);
    first.reporter.done("succeeded", "Imported 1");
    expect(first.events.latest?.status).toBe("succeeded");
    first.dispose();
    expect(graph.progress.openJobs).toBe(0);

    const second = graph.progress.forJob("job 2", { openOn: "completion" });
    const seen: ProgressSnapshot[] = [];
    second.events.subscribe((snapshot) => seen.push(snapshot));

    second.reporter.setProgress(3, 4);

    // Reported, and *observed* — the sink a status bar subscribes to saw it.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.completed).toBe(3);
    expect(second.events.latest?.completed).toBe(3);
    expect(second.events.latest?.total).toBe(4);
    expect(second.events.latest?.fraction).toBeCloseTo(0.75, 10);
    expect(second.events.latest?.status).toBe("running");
    // And it reaches its own terminal state, so a third job is not special.
    second.reporter.done("succeeded", "Imported 4");
    expect(second.events.latest?.status).toBe("succeeded");
    expect(seen.at(-1)?.message).toBe("Imported 4");

    second.dispose();
    await h.scope.unregisterAll();
  });

  it("keeps two concurrent jobs' counts and stage keys apart", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);

    const a = graph.progress.forJob("searchImport", { openOn: "completion" });
    const b = graph.progress.forJob("related", { openOn: "completion" });
    expect(graph.progress.openJobs).toBe(2);
    expect(a.events).not.toBe(b.events);

    a.reporter.child("fetch", 0, 0.5).setProgress(1, 2);
    b.reporter.child("write", 0.5, 1).setProgress(1, 4);

    expect(a.reporter.snapshot.currentStageKey).toBe("fetch");
    expect(a.reporter.snapshot.completed).toBe(1);
    expect(a.reporter.snapshot.total).toBe(2);
    expect(a.reporter.snapshot.fraction).toBeCloseTo(0.25, 10);
    expect(b.reporter.snapshot.currentStageKey).toBe("write");
    expect(b.reporter.snapshot.completed).toBe(1);
    expect(b.reporter.snapshot.total).toBe(4);
    expect(b.reporter.snapshot.fraction).toBeCloseTo(0.625, 10);

    // Each job's own stream carries only its own job.
    expect(a.events.latest?.currentStageKey).toBe("fetch");
    expect(b.events.latest?.currentStageKey).toBe("write");

    a.dispose();
    b.dispose();
    await h.scope.unregisterAll();
  });

  it("does not close a second job's surfaces when the first one finishes", async () => {
    // The trap that makes the obvious fix wrong: a per-job tree over the
    // *root's* sinks would have had the first job's `dispose()` close the
    // application's popup and clear its stream out from under every other job.
    const h = harness();
    const graph = await installServices(h.scope, h.options);

    const first = graph.progress.forJob("first", { openOn: "progress" });
    const second = graph.progress.forJob("second", { openOn: "progress" });
    first.reporter.setProgress(1, 2);
    second.reporter.setProgress(1, 4);

    // `docs/07` §7.7: one window per job.
    expect(h.windows).toHaveLength(2);
    const firstPopup = must(h.windows[0], "the first job's popup");
    const secondPopup = must(h.windows[1], "the second job's popup");

    first.reporter.done("succeeded", "done 1");
    first.dispose();

    expect(firstPopup.closed()).toBe(true);
    expect(secondPopup.closed()).toBe(false);
    expect(graph.progress.openJobs).toBe(1);

    // The second job still reports, is still observed, and still paints.
    h.clock.advance(PROGRESS_REPAINT_INTERVAL_MS);
    second.reporter.increment();
    expect(second.events.latest?.completed).toBe(2);
    expect(
      secondPopup.events.some((event) => event.startsWith("progress:")),
    ).toBe(true);
    // Nothing of the first job's leaked into the second's stream.
    expect(second.events.latest?.message).toBe("");

    second.dispose();
    await h.scope.unregisterAll();
  });

  it("honours a different openOn per pipeline in one plugin lifetime", async () => {
    // `openOn` is per-pipeline (`docs/07` §7.7's "Choice per pipeline") and
    // used to be set once for the whole application, where `"completion"` was
    // correct only while `searchImport` was Phase 1's only pipeline.
    const h = harness();
    const graph = await installServices(h.scope, h.options);

    // `docs/08` §4.4: nothing is drawn until completion, because progress
    // lives in the search window's status bar.
    const importJob = graph.progress.forJob("searchImport", {
      openOn: "completion",
    });
    importJob.reporter.setProgress(0, 200);
    for (let item = 0; item < 200; item += 1) {
      h.clock.advance(5);
      importJob.reporter.increment();
    }
    expect(h.windows).toHaveLength(0);
    // The status bar's stream saw it all the same.
    expect(importJob.events.latest?.completed).toBeGreaterThan(0);

    // §7.7: a short pipeline with no window of its own opens on first report.
    const related = graph.progress.forJob("related", { openOn: "progress" });
    related.reporter.setProgress(1, 3);
    expect(h.windows).toHaveLength(1);
    expect(must(h.windows[0], "related's popup").events).toContain("show");

    // And the import's toast arrives on completion, in its own window.
    importJob.reporter.done("succeeded", "Imported 200 · 13 failed");
    expect(h.windows).toHaveLength(2);
    expect(must(h.windows[1], "the completion toast").events).toContain(
      "line:Imported 200 · 13 failed",
    );

    importJob.dispose();
    related.dispose();
    await h.scope.unregisterAll();
  });

  it("falls through to the sink's §7.7 default when a job names no openOn", async () => {
    // Deliberately **not** `"completion"`: a default at the composition root
    // is how one pipeline's choice became every pipeline's.
    const h = harness();
    const graph = await installServices(h.scope, h.options);

    const job = graph.progress.forJob("audioReport");
    job.reporter.setProgress(1, 2);

    expect(h.windows).toHaveLength(1);
    expect(must(h.windows[0], "the popup").events).toContain("show");

    job.dispose();
    await h.scope.unregisterAll();
  });

  it("constructs no sink until a job asks for one", async () => {
    // `P1-T25`'s **Do NOT** — "do not construct a second set of sinks at the
    // root" — holds as written, because the root constructs none at all.
    const h = harness();
    const graph = await installServices(h.scope, h.options);

    expect(h.windows).toEqual([]);
    expect(graph.progress.openJobs).toBe(0);

    await h.scope.unregisterAll();
    expect(h.windows).toEqual([]);
  });

  it("disposes a job's surfaces once, however many times it is asked", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);

    const job = graph.progress.forJob("idempotent", { openOn: "progress" });
    job.reporter.setProgress(1, 2);
    const popup = must(h.windows[0], "the job's popup");

    job.dispose();
    job.dispose();
    await h.scope.unregisterAll();

    expect(popup.events.filter((event) => event === "close")).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });
});
