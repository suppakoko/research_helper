import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeZotero } from "../../setup/zotero-global";
import {
  adoptPrefObserverHandle,
  createRetryFor,
  createResumedJobRunner,
  createScope,
  createSpendResumeGuards,
  createZoteroLogSink,
  installServices,
  registration,
  type Scope,
  type ServiceGraphOptions,
} from "../../../src/bootstrap/container";
import type { PluginDatabaseSource } from "../../../src/bootstrap/pluginDatabase";
import { registerProviders } from "../../../src/bootstrap/registerProviders";
import type { CacheBlobStore } from "../../../src/core/cache/sqliteCache";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import {
  createMemoryPrefStore,
  type PrefObserverHandle,
  type PrefScalar,
  type PrefStore,
} from "../../../src/core/config";
import {
  BudgetExceededError,
  ConfigurationError,
  MissingCredentialError,
  NetworkError,
  OfflineError,
  OperationCancelledError,
  RateLimitError,
  StorageError,
  TimeoutError,
  UpstreamServerError,
} from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  createHttpClient,
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
import { createJobRecord } from "../../../src/core/jobQueue/jobRecord";
import {
  createLogger,
  LOG_PREFIX,
  type LogSink,
} from "../../../src/core/logger";
import {
  ARXIV_HOST,
  BIORXIV_HOST,
  createHostLimiterRegistry,
  CROSSREF_HOST,
  EBI_HOST,
  HOST_POLICIES,
  LLM_HOSTS,
  LLM_RETRY_BUDGET,
  NCBI_HOST,
  PMC_IDCONV_HOST,
  SEMANTICSCHOLAR_HOST,
  NCBI_KEY_PRESENT_PREF,
  peekHostLimiters,
  resetHostLimiters,
  type HostLimiterRegistry,
} from "../../../src/core/rateLimit/hostLimiter";
import { TokenBucket } from "../../../src/core/rateLimit/tokenBucket";
import type { SecretStore } from "../../../src/core/secretStore";
import { L10N_PROGRESS_HEADLINE } from "../../../src/i18n/keys";
import { reloadingUserPriceStore } from "../../../src/llm/shared/modelCatalogue";
import type { ChatRequest } from "../../../src/llm/types";
import type { TrendReport } from "../../../src/model/trend";
import type { Usage } from "../../../src/model/usage";
import {
  ceilingStopOf,
  createSessionSpendCounter,
} from "../../../src/pipeline/shared/budget";
import { getPrefStore, setPrefStore } from "../../../src/prefs";
import type { SqlConnection, SqlParam } from "../../../src/zotero/db";
import type { ProgressWindowHandle } from "../../../src/zotero/progressWindow";
import { debug as zoteroDebug } from "../../../src/zotero/zoteroApi";

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
 *
 * **§7 is `P1-T32`'s** — the four seams `P1-T25` bound from inside its own two
 * files. Three of its criteria are measured there and the fourth is measured
 * half here:
 *
 * - criterion 1 (`error()` reaches `Zotero.logError`) and criterion 2 (a line
 *   carries its mapped level) are asserted **on the fake `Zotero` global**,
 *   through `src/zotero/zoteroApi.ts`'s facades, because the second argument
 *   and the second channel are things the sink cannot be observed to have from
 *   above it;
 * - criterion 5 (one prefix) is likewise asserted on the string that reached
 *   `Zotero.debug`, not on the string the sink was handed — the duplicate
 *   prefix was added *by the facade*, so a test that stopped at the sink could
 *   not see it;
 * - criterion 4's *resolution* half is `test/integration/l10n.spec.ts`'s,
 *   because it needs a live `L10nRegistry`. What is here is that
 *   `installServices` awaits the resolver, uses what it returns, and makes the
 *   fallback **visible in the log** instead of silent.
 *
 * §5's third test is `P1-T03`'s refusal guard, kept and annotated: `P1-T32`'s
 * discriminated handle makes it redundant rather than wrong.
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
      // it, and the handle is what `unregister` receives. Tagged
      // `"scoped-registration"` since `P1-T32`, which is the whole of item 4 —
      // the tag, not the arity, is what tells the root to *run* this rather
      // than treat it as an undo.
      return {
        kind: "scoped-registration",
        register: registration<number>({
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
        }),
      };
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
    // `docs/07` §7.3's rows for the hosts the registered adapters talk to:
    // NCBI (`P1-T04`), Europe PMC (`P2-T03`, wired by `P2-T32`), Crossref
    // (`P2-T04`), arXiv (`P2-T06`), Semantic Scholar (`P2-T05`) and
    // bioRxiv/medRxiv (`P2-T07`, one host). Phase 1 pinned this at one host;
    // the pin went with the second adapter. Last, the NCBI ID Converter's
    // host (owner, 2026-10-19, `plan/00` §6 item 214), which the writer's
    // PMCID route calls through this same client. Then the four LLM hosts
    // (owner, 2026-10-21, `plan/00` §6 item 260), one row each.
    expect(graph.limiters.hosts).toEqual([
      NCBI_HOST,
      EBI_HOST,
      CROSSREF_HOST,
      ARXIV_HOST,
      SEMANTICSCHOLAR_HOST,
      BIORXIV_HOST,
      PMC_IDCONV_HOST,
      LLM_HOSTS.openrouter,
      LLM_HOSTS.openai,
      LLM_HOSTS.anthropic,
      LLM_HOSTS.gemini,
    ]);
    for (const host of Object.values(LLM_HOSTS)) {
      expect(graph.limiters.limiterFor(host), host).toBeDefined();
    }
    expect(graph.limiters.limiterFor(PMC_IDCONV_HOST)).toBeDefined();
    expect(graph.limiters.limiterFor(NCBI_HOST)).toBeDefined();
    expect(graph.limiters.limiterFor(EBI_HOST)).toBeDefined();
    expect(graph.limiters.limiterFor(CROSSREF_HOST)).toBeDefined();
    expect(graph.limiters.limiterFor(ARXIV_HOST)).toBeDefined();
    expect(graph.limiters.limiterFor(SEMANTICSCHOLAR_HOST)).toBeDefined();
    expect(graph.limiters.limiterFor(BIORXIV_HOST)).toBeDefined();
    // `registerSources()` was handed every adapter, in `SOURCE_IDS` order —
    // the order the search dialog's Databases row renders (`docs/08` §4.2).
    // Semantic Scholar (`P2-T05`) lands after arXiv in the host table but
    // before it in `SOURCE_IDS`, which is the order that matters here.
    expect(graph.sources.list().map((source) => source.id)).toEqual([
      "pubmed",
      "europepmc",
      "crossref",
      "semanticscholar",
      "arxiv",
      "biorxiv",
      "medrxiv",
    ]);
    expect(graph.sources.list().map((source) => source.displayNameKey)).toEqual(
      [
        "research-helper-source-pubmed",
        "research-helper-source-europepmc",
        "research-helper-source-crossref",
        "research-helper-source-semanticscholar",
        "research-helper-source-arxiv",
        "research-helper-source-biorxiv",
        "research-helper-source-medrxiv",
      ],
    );
    // bioRxiv and medRxiv (`P2-T07`) are two sources on one host: both name
    // §7.3's `api.biorxiv.org` row, and the registry hands both the same
    // bucket — identity, not equality, so together they stay under 1/s.
    const biorxivKey = graph.sources.get("biorxiv")?.rateLimitKey;
    const medrxivKey = graph.sources.get("medrxiv")?.rateLimitKey;
    expect(biorxivKey).toBe(BIORXIV_HOST);
    expect(medrxivKey).toBe(BIORXIV_HOST);
    const biorxivBucket = graph.limiters.limiterFor(biorxivKey ?? "");
    expect(biorxivBucket).toBeDefined();
    expect(graph.limiters.limiterFor(medrxivKey ?? "")).toBe(biorxivBucket);
    expect(graph.sources.get("biorxiv")).not.toBe(graph.sources.get("medrxiv"));
    // The Semantic Scholar adapter paces on §7.3's `api.semanticscholar.org`
    // bucket through the client — 0.9/s with or without a key.
    expect(graph.sources.get("semanticscholar")?.rateLimitKey).toBe(
      SEMANTICSCHOLAR_HOST,
    );
    // The arXiv adapter paces on §7.3's `export.arxiv.org` bucket through the
    // client, which is the one place the three-second rule is enforced.
    expect(graph.sources.get("arxiv")?.rateLimitKey).toBe(ARXIV_HOST);
    // The Crossref adapter paces on the same bucket the client does, so its
    // header-driven `reconfigure()` lands on the limiter that actually paces.
    expect(graph.sources.get("crossref")?.rateLimitKey).toBe(CROSSREF_HOST);
    // Every disposable is in the scope, not merely constructed.
    expect(h.scope.size).toBeGreaterThan(0);

    await h.scope.unregisterAll();
  });

  // `docs/07` §4.2 (`P2-T34`): `citationGraph` means "this adapter exposes
  // `findRelated`". Owner, 2026-10-15 (`plan/00` §6 item 184): the flag says
  // what the shipped adapter does, not what its service could do, so every
  // registered source is held to it — a flag flips only by adding the method.
  it("declares citationGraph exactly when the adapter exposes findRelated, for every registered source", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    const sources = graph.sources.list();
    expect(sources).toHaveLength(7);
    for (const source of sources) {
      expect(
        source.capabilities.citationGraph,
        `${source.id}: citationGraph vs findRelated`,
      ).toBe(typeof source.findRelated === "function");
    }
    await h.scope.unregisterAll();
  });

  // `P3-T34` (`plan/00` §6 item 250): the root builds the job queue with no
  // store when no database is passed (P3-T33 attaches it from the database
  // installServices opens) and, until P3-T15/T16 fill them, no other
  // resume guard and no notifier — so no interrupted job can resume.
  // `skipCached` is P3-T26's, passed since 2026-10-23; `egress` (P3-T15) is
  // installed by P3-T35. `confirm` and `ceilings` wait for P3-T29's
  // remaining-work estimate and the notifier is P3-T29's.
  it("builds the job queue storeless, with every resume guard and the notifier present (P4-T18)", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    expect(graph.jobs.attached).toBe(false);
    // `P3-T29` (2026-10-29) supplies the notifier (`createJobNoticeRouter`);
    // `P4-T18` (2026-11-01) the remaining-work estimate `confirm` and
    // `ceilings` judge by (`remainingFromCheckpoint`), so an interrupted
    // report job can resume once they pass.
    expect(graph.jobs.missingResumePrerequisites()).toStrictEqual([]);
    expect(graph.pipelines.list().map((p) => p.id)).toContain("trendReport");
    await h.scope.unregisterAll();
  });

  it("registers the related pipeline (P5-T14)", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    const related = graph.pipelines.get("related");
    expect(related?.id).toBe("related");
    expect(related?.resumable).toBe(false);
    await h.scope.unregisterAll();
  });

  it("registers the recommend pipeline (P5-T25)", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    const recommend = graph.pipelines.get("recommend");
    expect(recommend?.id).toBe("recommend");
    expect(recommend?.resumable).toBe(false);
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
    // teardown order: the resumed report runs (`P4-T20` step 0c: stopped
    // before the database closes under them), the plugin database (`P3-T33`,
    // step 6c — its connection closes after its own recovery and stores),
    // then surfaces, then client, then observer, then registry, then the
    // PrefStore last.
    expect(live[0]).toBe("resumed trend-report runs (P4-T20)");
    expect(live[1]).toBe(
      "the plugin database (research-helper.sqlite), its cache and its job store",
    );
    expect(live[2]).toBe("job progress reporters and their surfaces");
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
    //
    // **`P1-T32` made this test redundant, and it is kept rather than
    // deleted** — it is `P1-T03`'s measurement's regression guard, and the
    // thing it guards against is a *leak*, which is still the worst outcome.
    // What makes it redundant is that `PrefObserverHandle` is now a
    // discriminated union, so an untagged handle is a compile error at every
    // `PrefStore.observe` implementation; the `as` below is the only way left
    // to produce one, and it stands in for the untyped edges the guard exists
    // for (a handle crossing the sandbox boundary, or a `PrefStore` built in
    // untyped code). Before the tag, this assertion described a reachable
    // runtime state; now it describes what happens when the type system has
    // already been circumvented. The cast is what proves the redundancy: if it
    // compiled without one, the union would not be doing its job.
    await expect(
      adoptPrefObserverHandle(
        scope,
        {} as unknown as PrefObserverHandle,
        "an unbindable handle",
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(scope.size).toBe(0);
  });

  it("refuses the opposite tag rather than silently undoing a registration", async () => {
    const scope = createScope({
      description: "mis-tagged handle test",
      onError: () => undefined,
      strict: true,
    });

    // The defect the tag exists to stop, stated as a test: a handle that *is*
    // callable — the shape the old arity check happily bound — but carries no
    // tag the root understands. Arity could not distinguish this from a real
    // registration; `kind` refuses it, and nothing is recorded in the scope,
    // so the observer is not leaked and not silently unsubscribed either.
    const miscallable = Object.assign(
      () => {
        throw new Error("a mis-tagged handle must never be called");
      },
      { kind: "registration" as const },
    );
    await expect(
      adoptPrefObserverHandle(
        scope,
        miscallable as unknown as PrefObserverHandle,
        "a third convention",
      ),
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

// ---------------------------------------------------------------------------
// 7. `P1-T32` — the four platform seams the composition root could not reach
// ---------------------------------------------------------------------------

/**
 * Every argument list `Zotero.debug` was called with since the last clear.
 *
 * The *platform* call, not the sink call: the point of these assertions is
 * what a user pasting a debug log into a bug report actually sees, which is
 * the string and the level that crossed the facade.
 */
function zoteroDebugCalls(): unknown[][] {
  return FakeZotero.debug.mock.calls.map((call) => [...call]);
}

/** The `Error` objects `Zotero.logError` was called with since the last clear. */
function zoteroLogErrorCalls(): Error[] {
  return FakeZotero.logError.mock.calls.map((call) => call[0] as Error);
}

/** Only the lines that came from `createLogger` — one JSON payload each. */
function productLogLines(): string[] {
  return zoteroDebugCalls()
    .map((call) => String(call[0]))
    .filter((line) => line.includes('"lvl":'));
}

describe("P1-T32: the real LogSink reaches both of §10.3's channels", () => {
  beforeEach(() => {
    FakeZotero.debug.mockClear();
    FakeZotero.logError.mockClear();
  });

  it("criterion 1: an error() line reaches Zotero.logError through the facade", async () => {
    // The seam with the user-visible cost. `docs/07` §10.3 routes
    // `Logger.error()` to `Zotero.logError()` "so the entry reaches the
    // Mozilla error console and `Zotero.getErrors()`", and before this card
    // `Zotero.logError` was named nowhere in `src/zotero/` — so an error the
    // bug-report instructions tell the user to paste was not there.
    const h = harness({ logSink: createZoteroLogSink() });
    const graph = await installServices(h.scope, h.options);

    graph.logger.error("efetch failed", { status: 502 });

    const reported = zoteroLogErrorCalls();
    expect(reported).toHaveLength(1);
    const err = must(reported[0], "the reported Error");
    // `Zotero.logError` takes an `Error`, not a string (`zotero-types@4.1.3`).
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('"lvl":"error"');
    expect(err.message).toContain("efetch failed");

    await h.scope.unregisterAll();
  });

  it("criterion 1: only error() opens the second channel", async () => {
    // §10.3 says `error()` *additionally* calls it. A `warn` that also landed
    // in `Zotero.getErrors()` would fill its 25-entry ring buffer with
    // non-errors and push the real ones out.
    const h = harness(
      { logSink: createZoteroLogSink() },
      { logLevel: "debug" },
    );
    const graph = await installServices(h.scope, h.options);

    graph.logger.warn("retrying");
    graph.logger.info("installed");
    graph.logger.debug("shape");
    expect(zoteroLogErrorCalls()).toEqual([]);

    graph.logger.error("gave up");
    expect(zoteroLogErrorCalls()).toHaveLength(1);

    await h.scope.unregisterAll();
  });

  it("criterion 2: each line carries its mapped Zotero level as debug()'s second argument", async () => {
    // `docs/07` §10.3's table — `error -> 1`, `warn -> 2`, `info -> 3`,
    // `debug -> 4`, lower = more severe — passed "straight through as
    // `Zotero.debug`'s second argument". `zoteroApi.debug()` had no second
    // argument until this card, so every line of ours landed at Zotero's
    // default 3 and `extensions.zotero.debug.level` could not filter by our
    // severity at all.
    const h = harness(
      { logSink: createZoteroLogSink() },
      { logLevel: "debug" },
    );
    const graph = await installServices(h.scope, h.options);
    FakeZotero.debug.mockClear();

    graph.logger.error("e");
    graph.logger.warn("w");
    graph.logger.info("i");
    graph.logger.debug("d");

    // One `Zotero.debug` per line, in order, each with its level. The
    // `logError` channel is a separate call and does not appear here.
    expect(zoteroDebugCalls().map((call) => call[1])).toEqual([1, 2, 3, 4]);

    await h.scope.unregisterAll();
  });

  it("criterion 5: a product log line carries exactly one prefix, end to end", async () => {
    // Measured on the string that reached `Zotero.debug`, not on the string
    // the sink was handed: the second prefix was added *by the facade*, so a
    // test that stopped at the sink could not see it. Before this card every
    // product line read
    //   [research-helper] [research_helper] {"t":...}
    // — two prefixes differing by one character, so a grep for either found
    // half the lines of the other.
    const h = harness(
      { logSink: createZoteroLogSink() },
      { logLevel: "debug" },
    );
    const graph = await installServices(h.scope, h.options);
    FakeZotero.debug.mockClear();

    graph.logger.info("services installed", { hosts: 1 });

    const lines = productLogLines();
    expect(lines).toHaveLength(1);
    const line = must(lines[0], "the product log line");
    expect(line.startsWith(`${LOG_PREFIX} `)).toBe(true);
    expect(line.split(LOG_PREFIX)).toHaveLength(2);
    // The retired spelling must not come back by either route.
    expect(line).not.toContain("[research-helper]");
    // And the remainder is still §10.3's single-line JSON payload.
    expect(JSON.parse(line.slice(LOG_PREFIX.length + 1))).toMatchObject({
      lvl: "info",
      msg: "services installed",
      hosts: 1,
    });

    await h.scope.unregisterAll();
  });

  it("criterion 5: a bare facade call is still prefixed once", () => {
    // The other half of the idempotent prefix: `createSpikeArticle()` and the
    // integration specs call `debug()` with an unprefixed message and must
    // keep getting one prefix, not zero.
    zoteroDebug("a bare message");
    const calls = zoteroDebugCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([`${LOG_PREFIX} a bare message`]);
  });
});

describe("P1-T32: the progress headline resolves rather than defaulting to a brand name", () => {
  beforeEach(() => {
    FakeZotero.debug.mockClear();
    FakeZotero.logError.mockClear();
  });

  it("awaits the resolver and gives the popup the resolved string", async () => {
    // `installServices` is the last `await` before the factory, and `forJob`
    // is synchronous because `docs/07` §7.7 raises one popup per job — so a
    // resolver that is not awaited *here* cannot be awaited at all.
    const h = harness({
      progressHeadline: {
        messageId: L10N_PROGRESS_HEADLINE,
        resolve: () => Promise.resolve("리서치 헬퍼"),
        fallback: "Research Helper",
      },
    });
    const graph = await installServices(h.scope, h.options);

    // `openProgressWindow` is called lazily, on the job first update.
    graph.progress
      .forJob("searchImport", { openOn: "progress" })
      .reporter.setProgress(1, 2);
    expect(must(h.windows[0], "the popup").events).toContain(
      "headline:리서치 헬퍼",
    );

    await h.scope.unregisterAll();
  });

  it("falls back visibly, with the message id in the log, when it resolves in no locale", async () => {
    // `P1-T32` `Do` step 4: "do not fall back to a brand name silently, which
    // is what today's code does with a comment". The fallback is still used —
    // a headline-less popup is worse than an English one — but the
    // substitution is now a `warn` line in the debug log a bug report carries,
    // naming the id so the three different causes (missing message, bundle
    // never inserted, locale chain that does not end in en-US) are
    // diagnosable.
    const h = harness({
      progressHeadline: {
        messageId: L10N_PROGRESS_HEADLINE,
        resolve: () => Promise.resolve(undefined),
        fallback: "Research Helper",
      },
    });
    const graph = await installServices(h.scope, h.options);

    // `openProgressWindow` is called lazily, on the job first update.
    graph.progress
      .forJob("searchImport", { openOn: "progress" })
      .reporter.setProgress(1, 2);
    expect(must(h.windows[0], "the popup").events).toContain(
      "headline:Research Helper",
    );

    const warned = h.sink.lines.filter((line) =>
      line.includes(L10N_PROGRESS_HEADLINE),
    );
    expect(warned).toHaveLength(1);
    expect(must(warned[0], "the warn line")).toContain('"lvl":"warn"');

    await h.scope.unregisterAll();
  });

  it("does not fail startup when the resolver throws", async () => {
    // A string that did not resolve must not cost the user their menus.
    const h = harness({
      progressHeadline: {
        messageId: L10N_PROGRESS_HEADLINE,
        resolve: () => Promise.reject(new Error("L10nRegistry not ready")),
        fallback: "Research Helper",
      },
    });
    const graph = await installServices(h.scope, h.options);

    expect(graph.progress.openJobs).toBe(0);
    const warned = h.sink.lines.filter((line) =>
      line.includes(L10N_PROGRESS_HEADLINE),
    );
    expect(warned).toHaveLength(1);
    expect(must(warned[0], "the warn line")).toContain(
      "L10nRegistry not ready",
    );

    await h.scope.unregisterAll();
  });

  it("still accepts a literal, which is what a test with no Fluent passes", async () => {
    const h = harness({ progressHeadline: "Research Helper" });
    const graph = await installServices(h.scope, h.options);

    // `openProgressWindow` is called lazily, on the job first update.
    graph.progress
      .forJob("searchImport", { openOn: "progress" })
      .reporter.setProgress(1, 2);
    expect(must(h.windows[0], "the popup").events).toContain(
      "headline:Research Helper",
    );
    expect(
      h.sink.lines.filter((line) => line.includes(L10N_PROGRESS_HEADLINE)),
    ).toEqual([]);

    await h.scope.unregisterAll();
  });
});

// ---------------------------------------------------------------------------
// P2-T04: the Crossref adapter is wired with the two things only this root has
// ---------------------------------------------------------------------------

describe("P2-T04: installServices hands Crossref the contact preference and the host's own bucket", () => {
  /** A transport answering one Crossref `/works` page from the polite pool. */
  function createCrossrefTransport(clock: ManualClock): FakeTransport {
    const calls: RecordedCall[] = [];
    const body = JSON.stringify({
      status: "ok",
      "message-type": "work-list",
      "message-version": "1.0.0",
      message: {
        "total-results": 1,
        items: [
          {
            DOI: "10.1234/wired",
            type: "journal-article",
            title: ["Wired"],
            issued: { "date-parts": [[2024]] },
          },
        ],
        "items-per-page": 1,
      },
    });
    const xhr: HttpTransportXhr = {
      status: 200,
      responseText: body,
      responseURL: "",
      getAllResponseHeaders: () =>
        [
          "x-api-pool: polite-array",
          "x-rate-limit-limit: 3",
          "x-rate-limit-interval: 1s",
          "x-concurrency-limit: 3",
        ].join("\r\n"),
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

  it("sends the user's contactEmail as mailto and reconfigures the shared bucket from the response headers", async () => {
    const clock = createManualClock();
    const transport = createCrossrefTransport(clock);
    const h = harness(
      { transport, clock },
      { contactEmail: "reader@example.org" },
    );
    const graph = await installServices(h.scope, h.options);
    const crossref = graph.sources.get("crossref");
    if (crossref === undefined) throw new Error("crossref is not registered");
    const bucket = bucketOf(graph.limiters, CROSSREF_HOST);
    // `docs/07` §7.3's static starting point, before any response.
    expect(bucket.currentConfig.ratePerSecond).toBe(2);

    const page = await crossref.search(
      { terms: { kind: "term", value: "wired" }, limit: 1 },
      { token: createCancellationTokenSource().token },
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["10.1234/wired"]);
    const url = new URL(must(transport.calls[0], "the Crossref call").url);
    expect(url.host).toBe(CROSSREF_HOST);
    // D10: the user's address in `mailto`; the maintainer's stays in the
    // `User-Agent` the client adds.
    expect(url.searchParams.get("mailto")).toBe("reader@example.org");
    expect(
      must(transport.calls[0], "the Crossref call").options.headers?.[
        "User-Agent"
      ],
    ).toMatch(/mailto:suppakoko@gmail\.com/u);
    // The header-driven row: the polite pool's 3/s landed on the very bucket
    // the client paces with — raised from 2, which the client alone never does.
    expect(bucket.currentConfig).toEqual({
      ratePerSecond: 3,
      burst: 2,
      maxConcurrent: 3,
    });

    // The preference is read on every request, so a change needs no restart.
    h.prefs.set("contactEmail", "");
    await crossref.search(
      { terms: { kind: "term", value: "wired" }, limit: 1 },
      { token: createCancellationTokenSource().token },
    );
    expect(
      new URL(must(transport.calls[1], "the second call").url).searchParams.get(
        "mailto",
      ),
    ).toBe("suppakoko@gmail.com");

    await h.scope.unregisterAll();
  });
});

// ---------------------------------------------------------------------------
// Item 228: §7.3's retry cells reach the shipped client (owner, 2026-10-20)
// ---------------------------------------------------------------------------

describe("item 228: installServices supplies docs/07 §7.3's retry policy", () => {
  interface ScriptedAnswer {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    /**
     * How long the host takes to answer, on the manual clock (item 233's slow
     * refusal). Absent, the answer is immediate.
     */
    readonly afterMs?: number;
  }

  /**
   * A transport whose answer is chosen per call, by URL and by the call's
   * index among calls to that same URL. It reads the clock itself, so a gap
   * between two calls is an observation of when each reached the wire.
   *
   * An `Error` answer is thrown the way `Zotero.HTTP.request` throws one —
   * a `StubTimeoutException` is what the client maps to `TimeoutError`
   * (item 230).
   */
  function createScriptedTransport(
    clock: ManualClock,
    answer: (url: string, nth: number) => ScriptedAnswer | Error,
    onCall?: (url: string) => void,
  ): FakeTransport {
    const calls: RecordedCall[] = [];
    const perUrl = new Map<string, number>();
    return {
      calls,
      request(_method, url, options) {
        calls.push({ url, options, atMs: clock.now() });
        const nth = perUrl.get(url) ?? 0;
        perUrl.set(url, nth + 1);
        onCall?.(url);
        const scripted = answer(url, nth);
        if (scripted instanceof Error) return Promise.reject(scripted);
        const { status, headers = {}, afterMs } = scripted;
        const xhr: HttpTransportXhr = {
          status,
          responseText: "",
          responseURL: "",
          getAllResponseHeaders: () =>
            Object.entries(headers)
              .map(([name, value]) => `${name}: ${value}`)
              .join("\r\n"),
        };
        return afterMs === undefined
          ? Promise.resolve(xhr)
          : clock.sleep(afterMs).then(() => xhr);
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

  /** Install a graph over `transport`, with every log line kept. */
  async function installOver(
    clock: ManualClock,
    transport: FakeTransport,
  ): Promise<{
    h: Harness;
    graph: Awaited<ReturnType<typeof installServices>>;
  }> {
    const h = harness({ transport, clock }, { logLevel: "debug" });
    const graph = await installServices(h.scope, h.options);
    return { h, graph };
  }

  /** Settle `promise` by stepping the clock, and hand back what it did. */
  async function settle(
    clock: ManualClock,
    promise: Promise<unknown>,
    maxSteps = 40_000,
  ): Promise<{ value?: unknown; error?: unknown }> {
    let outcome: { value?: unknown; error?: unknown } | undefined;
    promise.then(
      (value: unknown) => {
        outcome = { value };
      },
      (error: unknown) => {
        outcome = { error };
      },
    );
    await runUntil(clock, () => outcome !== undefined, maxSteps);
    return must(outcome, "the request's outcome");
  }

  /** The JSON payloads of every sink line whose `msg` is `msg`. */
  function linesWith(
    sink: { readonly lines: readonly string[] },
    msg: string,
  ): Record<string, unknown>[] {
    return sink.lines
      .filter((line) => line.includes(`"msg":"${msg}"`))
      .map(
        (line) =>
          JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown>,
      );
  }

  it("retries a 503 to each row's own attempt cap, first wait exactly its base (every HOST_POLICIES row)", async () => {
    for (const row of HOST_POLICIES) {
      const budget = must(row.retry, `${row.host}'s retry cells`);
      const clock = createManualClock();
      const transport = createScriptedTransport(clock, () => ({ status: 503 }));
      const { h } = await installOver(clock, transport);

      const outcome = await settle(
        clock,
        httpRequest({ method: "GET", url: `https://${row.host}/x` }),
      );

      expect(outcome.error, row.host).toBeInstanceOf(UpstreamServerError);
      // §7.3's attempt cap counts the first attempt: 3 → 3 requests, and
      // an LLM row's 5 (`LLM_RETRY_BUDGET`, item 260) → 5.
      expect(transport.calls, row.host).toHaveLength(budget.maxAttempts);
      expect(transport.calls, row.host).toHaveLength(
        row.retry === LLM_RETRY_BUDGET ? 5 : 3,
      );
      const at = transport.calls.map((call) => call.atMs);
      const t0 = must(at[0], "the first call");
      // `withRetry` enters the first retry with `prevDelayMs = 0`, so the
      // first wait is exactly `base`; the second is a draw over
      // `[base, min(cap, 3 × base)]` (§7.3's cost table). **And the retry
      // still waits for the bucket**: measured on the first run, arXiv's
      // first retry reached the wire at 3031 ms, not its 3000 ms base,
      // because a token at 0.33/s takes 3030.3 ms to refill. So the first gap
      // is the larger of the two, give or take the one-tick stepping.
      const tokenMs = Math.ceil(1000 / row.withoutKey.ratePerSecond);
      const firstGap = must(at[1], "the second call") - t0;
      const expected = Math.max(budget.baseMs, tokenMs);
      expect(firstGap, row.host).toBeGreaterThanOrEqual(expected);
      expect(firstGap, row.host).toBeLessThanOrEqual(expected + 1);
      const second = must(at[2], "the third call") - must(at[1], "call 2");
      expect(second, row.host).toBeGreaterThanOrEqual(
        Math.max(budget.baseMs, tokenMs),
      );
      expect(second, row.host).toBeLessThanOrEqual(
        Math.max(Math.min(budget.capMs, budget.baseMs * 3), tokenMs) + 1,
      );
      // One retry fewer than the attempts, each announced at `warn` with the
      // wait it took: two on a literature row, four on an LLM row.
      expect(
        linesWith(h.sink, "http retry").map((line) => line.attempt),
        row.host,
      ).toEqual(
        Array.from({ length: budget.maxAttempts - 1 }, (_, i) => i + 1),
      );

      await h.scope.unregisterAll();
    }
  });

  it("stops retrying as soon as an attempt succeeds", async () => {
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, (_url, nth) => ({
      status: nth === 0 ? 502 : 200,
    }));
    const { h } = await installOver(clock, transport);

    const outcome = await settle(
      clock,
      httpRequest({ method: "GET", url: ncbiUrl("esearch.fcgi") }),
    );

    expect(outcome.error).toBeUndefined();
    expect(outcome.value).toMatchObject({ status: 200 });
    expect(transport.calls).toHaveLength(2);
    await h.scope.unregisterAll();
  });

  it("does not retry the classes docs/07 §10.1 marks non-retryable: 400, 401, 403, 404", async () => {
    for (const status of [400, 401, 403, 404]) {
      const clock = createManualClock();
      const transport = createScriptedTransport(clock, () => ({ status }));
      const { h } = await installOver(clock, transport);

      const outcome = await settle(
        clock,
        httpRequest({ method: "GET", url: ncbiUrl("esearch.fcgi") }),
      );

      expect(outcome.error, String(status)).toBeDefined();
      expect(transport.calls, String(status)).toHaveLength(1);
      expect(linesWith(h.sink, "http retry"), String(status)).toEqual([]);
      await h.scope.unregisterAll();
    }
  });

  it("makes exactly one attempt to a host with no §7.3 row", async () => {
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, () => ({ status: 503 }));
    const { h, graph } = await installOver(clock, transport);
    expect(graph.limiters.policyFor("example.test")).toBeUndefined();

    const outcome = await settle(
      clock,
      httpRequest({ method: "GET", url: "https://example.test/a" }),
    );

    expect(outcome.error).toBeInstanceOf(UpstreamServerError);
    expect(transport.calls).toHaveLength(1);
    await h.scope.unregisterAll();
  });

  it("attempts a timeout once and never retries it, on every HOST_POLICIES row (item 230)", async () => {
    for (const row of HOST_POLICIES) {
      const budget = must(row.retry, `${row.host}'s retry cells`);
      // A row that allowed one attempt anyway would pass vacuously.
      expect(budget.maxAttempts, row.host).toBeGreaterThan(1);
      const clock = createManualClock();
      const transport = createScriptedTransport(
        clock,
        () => new StubTimeoutException("timed out"),
      );
      const { h } = await installOver(clock, transport);

      const outcome = await settle(
        clock,
        httpRequest({ method: "GET", url: `https://${row.host}/x` }),
      );

      expect(outcome.error, row.host).toBeInstanceOf(TimeoutError);
      expect(transport.calls, row.host).toHaveLength(1);
      expect(linesWith(h.sink, "http retry"), row.host).toEqual([]);
      // The rule is the retry policy's, not the error's: §10.1's flag, which
      // the Search window's Retry button reads, still says a retry could
      // succeed — on the live error and on its serialized form.
      const error = outcome.error as TimeoutError;
      expect(error.retryable, row.host).toBe(true);
      expect(error.toSerialized().retryable, row.host).toBe(true);
      await h.scope.unregisterAll();
    }
  });

  it("ends the loop at a timeout on a later attempt: a 503, one wait, the timeout (item 230)", async () => {
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, (_url, nth) =>
      nth === 0 ? { status: 503 } : new StubTimeoutException("timed out"),
    );
    const { h } = await installOver(clock, transport);

    const outcome = await settle(
      clock,
      httpRequest({ method: "GET", url: ncbiUrl("esearch.fcgi") }),
    );

    expect(outcome.error).toBeInstanceOf(TimeoutError);
    // NCBI's attempt cap is 3; the timeout on attempt 2 stops it there.
    expect(transport.calls).toHaveLength(2);
    expect(linesWith(h.sink, "http retry").map((line) => line.attempt)).toEqual(
      [1],
    );
    await h.scope.unregisterAll();
  });

  it("still retries a 429, a 5xx, an offline and a network failure to every row's attempt cap (item 230)", async () => {
    const cases: readonly {
      readonly name: string;
      readonly answer: () => ScriptedAnswer | Error;
      readonly expected: abstract new (...args: never[]) => Error;
    }[] = [
      // No `Retry-After`, so the waits are the row's own jitter.
      {
        name: "429",
        answer: () => ({ status: 429 }),
        expected: RateLimitError,
      },
      {
        name: "500",
        answer: () => ({ status: 500 }),
        expected: UpstreamServerError,
      },
      {
        name: "offline",
        answer: () => new StubBrowserOfflineException("offline"),
        expected: OfflineError,
      },
      // Status 0 is "no HTTP response at all" (`client.ts`'s header).
      {
        name: "network",
        answer: () => ({ status: 0 }),
        expected: NetworkError,
      },
    ];
    for (const row of HOST_POLICIES) {
      const budget = must(row.retry, `${row.host}'s retry cells`);
      for (const { name, answer, expected } of cases) {
        const label = `${row.host} ${name}`;
        const clock = createManualClock();
        const transport = createScriptedTransport(clock, answer);
        const { h } = await installOver(clock, transport);

        const outcome = await settle(
          clock,
          httpRequest({ method: "GET", url: `https://${row.host}/x` }),
        );

        expect(outcome.error, label).toBeInstanceOf(expected);
        expect(outcome.error, label).not.toBeInstanceOf(TimeoutError);
        expect(transport.calls, label).toHaveLength(budget.maxAttempts);
        expect(
          linesWith(h.sink, "http retry").map((line) => line.attempt),
          label,
        ).toEqual(
          Array.from({ length: budget.maxAttempts - 1 }, (_, i) => i + 1),
        );
        await h.scope.unregisterAll();
      }
    }
  });

  it("ends arXiv's measured slow refusal at the 90-second budget: two attempts, not three (item 233)", async () => {
    // `P0-T21`: arXiv 429s took up to 46 s to fail, with no Retry-After.
    // Through the real composition root, the arXiv row allows three attempts;
    // the budget ends the request after two, at about 95 s, with the second
    // 429. Before item 233 this was three attempts and up to 150 s.
    const row = must(
      HOST_POLICIES.find((policy) => policy.host === ARXIV_HOST),
      "the arXiv row",
    );
    expect(must(row.retry, "arXiv's retry cells").maxAttempts).toBe(3);
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, () => ({
      status: 429,
      afterMs: 46_000,
    }));
    const { h } = await installOver(clock, transport);
    const t0 = clock.now();
    let endedAt: number | undefined;

    const outcome = await settle(
      clock,
      httpRequest({
        method: "GET",
        url: `https://${ARXIV_HOST}/api/query?search_query=all:crispr`,
      }).finally(() => {
        endedAt = clock.now();
      }),
      200_000,
    );

    expect(outcome.error).toBeInstanceOf(RateLimitError);
    expect(transport.calls).toHaveLength(2);
    const at = transport.calls.map((call) => call.atMs);
    expect(must(at[0], "the first call")).toBe(t0);
    // 46 s for the refusal, then the row's 3000 ms base wait.
    const gap = must(at[1], "the second call") - t0;
    expect(gap).toBeGreaterThanOrEqual(49_000);
    expect(gap).toBeLessThanOrEqual(49_001);
    const elapsed = must(endedAt, "the end") - t0;
    expect(elapsed).toBeGreaterThanOrEqual(95_000);
    expect(elapsed).toBeLessThanOrEqual(95_002);
    expect(linesWith(h.sink, "http retry").map((line) => line.attempt)).toEqual(
      [1],
    );
    const spent = linesWith(h.sink, "http retry budget spent");
    expect(spent.map((line) => line.attempt)).toEqual([2]);
    expect(must(spent[0], "the budget line").host).toBe(ARXIV_HOST);
    expect(clock.pending).toBe(0);
    await h.scope.unregisterAll();
  });

  it("waits a 429's Retry-After rather than the jitter, and ends in RateLimitError", async () => {
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, () => ({
      status: 429,
      headers: { "Retry-After": "5" },
    }));
    const { h } = await installOver(clock, transport);

    const outcome = await settle(
      clock,
      httpRequest({ method: "GET", url: ncbiUrl("esearch.fcgi") }),
    );

    expect(outcome.error).toBeInstanceOf(RateLimitError);
    expect(transport.calls).toHaveLength(3);
    const at = transport.calls.map((call) => call.atMs);
    // Never before the server's figure. The second gap measured 5001 ms on
    // the first run: the penalty and the wait both end at the same instant
    // and the bucket releases on the next tick, so the bound is a range
    // narrower than the 400 ms pacing interval, not an equality.
    for (const gap of [
      must(at[1], "call 2") - must(at[0], "call 1"),
      must(at[2], "call 3") - must(at[1], "call 2"),
    ]) {
      expect(gap).toBeGreaterThanOrEqual(5000);
      expect(gap).toBeLessThan(5400);
    }
    // The wait the loop chose is the server's, not the 1000 ms base.
    expect(linesWith(h.sink, "http retry").map((line) => line.delayMs)).toEqual(
      [5000, 5000],
    );
    await h.scope.unregisterAll();
  });

  it("waits a 503's Retry-After rather than the jitter", async () => {
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, (_url, nth) =>
      nth === 0
        ? { status: 503, headers: { "Retry-After": "7" } }
        : { status: 200 },
    );
    const { h } = await installOver(clock, transport);

    const outcome = await settle(
      clock,
      httpRequest({ method: "GET", url: ncbiUrl("esearch.fcgi") }),
    );

    expect(outcome.value).toMatchObject({ status: 200 });
    const at = transport.calls.map((call) => call.atMs);
    expect(must(at[1], "call 2") - must(at[0], "call 1")).toBe(7000);
    expect(linesWith(h.sink, "http retry").map((line) => line.delayMs)).toEqual(
      [7000],
    );
    await h.scope.unregisterAll();
  });

  it("sends every retry through the host's bucket: one run() per attempt", async () => {
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, () => ({ status: 503 }));
    const { h, graph } = await installOver(clock, transport);
    const bucket = bucketOf(graph.limiters, NCBI_HOST);
    const run = vi.spyOn(bucket, "run");

    await settle(
      clock,
      httpRequest({ method: "GET", url: ncbiUrl("esearch.fcgi") }),
    );

    expect(transport.calls).toHaveLength(3);
    expect(run).toHaveBeenCalledTimes(3);
    run.mockRestore();
    await h.scope.unregisterAll();
  });

  it("holds a retry behind another request's Retry-After penalty on the same host", async () => {
    // Request A fails with a bare 503 and would retry after 1000 ms. Request
    // B, paced 400 ms behind it, is refused with `429 Retry-After: 10`, which
    // `penalize`s the whole host until B's answer + 10 s. A retry that went
    // through the bucket waits for that; one that bypassed it would reach the
    // wire at 1000 ms.
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, (url, nth) => {
      if (url.endsWith("a.fcgi")) return { status: nth === 0 ? 503 : 200 };
      return nth === 0
        ? { status: 429, headers: { "Retry-After": "10" } }
        : { status: 200 };
    });
    const { h } = await installOver(clock, transport);
    const t0 = clock.now();

    const a = httpRequest({ method: "GET", url: ncbiUrl("a.fcgi") });
    const b = httpRequest({ method: "GET", url: ncbiUrl("b.fcgi") });
    const both = await settle(clock, Promise.all([a, b]));

    expect(both.error).toBeUndefined();
    const aCalls = transport.calls.filter((call) =>
      call.url.endsWith("a.fcgi"),
    );
    const bCalls = transport.calls.filter((call) =>
      call.url.endsWith("b.fcgi"),
    );
    expect(aCalls).toHaveLength(2);
    expect(bCalls).toHaveLength(2);
    const penaltyEnds = must(bCalls[0], "B's first call").atMs + 10_000;
    expect(must(aCalls[0], "A's first call").atMs).toBe(t0);
    expect(must(aCalls[1], "A's retry").atMs).toBeGreaterThanOrEqual(
      penaltyEnds,
    );
    await h.scope.unregisterAll();
  });

  it("stops at once when the job is cancelled during a retry's wait", async () => {
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, () => ({ status: 503 }));
    const { h } = await installOver(clock, transport);
    const source = createCancellationTokenSource();

    let outcome: unknown;
    const pending = httpRequest({
      method: "GET",
      url: ncbiUrl("esearch.fcgi"),
      token: source.token,
    }).catch((error: unknown) => {
      outcome = error;
    });
    await flush();
    // The first attempt failed and the loop is sleeping its 1000 ms.
    expect(transport.calls).toHaveLength(1);
    expect(outcome).toBeUndefined();

    source.cancel({ kind: "user" });
    await flush();

    // Settled without the clock moving, and nothing more reached the wire.
    expect(outcome).toBeInstanceOf(OperationCancelledError);
    clock.advance(60_000);
    await flush();
    await pending;
    expect(transport.calls).toHaveLength(1);
    await h.scope.unregisterAll();
  });

  it("does not schedule a retry for an attempt that failed after the job was cancelled", async () => {
    const clock = createManualClock();
    const source = createCancellationTokenSource();
    // The cancel lands while the attempt is on the wire, and the host then
    // answers 503: a retryable class, but the job has already been stopped.
    const transport = createScriptedTransport(
      clock,
      () => ({ status: 503 }),
      () => {
        source.cancel({ kind: "user" });
      },
    );
    const { h } = await installOver(clock, transport);

    let outcome: unknown;
    const pending = httpRequest({
      method: "GET",
      url: ncbiUrl("esearch.fcgi"),
      token: source.token,
    }).catch((error: unknown) => {
      outcome = error;
    });
    // Settles on its own: nothing waits on the clock.
    await pending;

    expect(outcome).toBeInstanceOf(OperationCancelledError);
    expect(transport.calls).toHaveLength(1);
    // No wait was scheduled, so no retry was announced either.
    expect(linesWith(h.sink, "http retry")).toEqual([]);
    expect(clock.pending).toBe(0);
    await pending;
    await h.scope.unregisterAll();
  });

  it("logs every retried attempt redacted exactly as the first", async () => {
    const clock = createManualClock();
    const transport = createScriptedTransport(clock, () => ({ status: 503 }));
    const { h } = await installOver(clock, transport);
    const secret = "0123456789abcdef0123456789abcdef";

    await settle(
      clock,
      httpRequest({
        method: "GET",
        url: ncbiUrl(`esearch.fcgi?db=pubmed&term=x&api_key=${secret}`),
      }),
    );

    expect(transport.calls).toHaveLength(3);
    const requests = linesWith(h.sink, "http request");
    expect(requests).toHaveLength(3);
    // One redacted form, identical on every attempt.
    expect(new Set(requests.map((line) => line.url)).size).toBe(1);
    expect(String(must(requests[0], "the first line").url)).not.toContain(
      secret,
    );
    expect(linesWith(h.sink, "http retry")).toHaveLength(2);
    for (const line of h.sink.lines) expect(line).not.toContain(secret);
    await h.scope.unregisterAll();
  });

  it("createRetryFor hands out each row's cells, and nothing for a host without a row or a limiter", () => {
    const registry = createHostLimiterRegistry({ clock: createManualClock() });
    const retryFor = createRetryFor(registry, () => 1);
    for (const row of HOST_POLICIES) {
      const budget = must(row.retry, `${row.host}'s retry cells`);
      const policy = must(retryFor(row.host), `${row.host}'s policy`);
      expect(policy.maxAttempts, row.host).toBe(budget.maxAttempts);
      // `random = 1` gives each draw's upper end: base, then min(cap, 3×base).
      expect(policy.nextDelayMs(0, 1), row.host).toBe(budget.baseMs);
      expect(policy.nextDelayMs(budget.baseMs, 2), row.host).toBe(
        Math.min(budget.capMs, budget.baseMs * 3),
      );
      // One policy object per host.
      expect(retryFor(row.host)).toBe(policy);
    }
    expect(retryFor("example.test")).toBeUndefined();
    expect(retryFor("api.openalex.org")).toBeUndefined();

    // A row with retry cells but no limiter gets no policy: an unpaced
    // retry is the one `docs/07` §7.4 forbids.
    const unpaced = createRetryFor({
      policyFor: (host) => registry.policyFor(host),
      limiterFor: () => undefined,
    });
    expect(unpaced(NCBI_HOST)).toBeUndefined();
  });
});

/**
 * `P3-T02` step 2: `installSecretStore` reconciles every key-presence flag,
 * not only NCBI's.
 *
 * `src/zotero/keychain.ts` cannot load in plain Node, so the container's
 * dynamic import of it is replaced for these tests only (`vi.doMock`, then a
 * fresh module graph). The replacement holds no key and touches no keystore;
 * the real reconciliation is exercised in
 * `test/integration/zotero/keychain.spec.ts`.
 */
describe("installSecretStore (P3-T02)", () => {
  const KEYCHAIN = "../../../src/zotero/keychain";

  type InstallSecretStore =
    typeof import("../../../src/bootstrap/container").installSecretStore;

  interface FakeKeychain {
    readonly probeAndRecordBackend: ReturnType<typeof vi.fn>;
    readonly createKeychainSecretStore: ReturnType<typeof vi.fn>;
    readonly reconcileKeyPresence: ReturnType<typeof vi.fn>;
    readonly refreshKeyPresence: ReturnType<typeof vi.fn>;
  }

  function fakeKeychain(tierOne: boolean): FakeKeychain {
    return {
      probeAndRecordBackend: vi.fn(() =>
        Promise.resolve(
          tierOne
            ? { backend: "os-keychain", elapsedMs: 0 }
            : {
                backend: "unavailable",
                failure: "encrypt-threw",
                detail: "Error: synthetic",
                elapsedMs: 0,
              },
        ),
      ),
      createKeychainSecretStore: vi.fn(() => ({ backend: "os-keychain" })),
      reconcileKeyPresence: vi.fn(() =>
        Promise.resolve(
          new Map([
            ["openrouterKeyPresent", true],
            ["ncbiKeyPresent", false],
          ]),
        ),
      ),
      refreshKeyPresence: vi.fn(() => Promise.resolve(false)),
    };
  }

  function recordingLogger(): Parameters<InstallSecretStore>[0] & {
    readonly lines: { level: string; msg: string; ctx: unknown }[];
  } {
    const lines: { level: string; msg: string; ctx: unknown }[] = [];
    const at =
      (level: string) =>
      (msg: string, ctx?: Record<string, unknown>): void => {
        lines.push({ level, msg, ctx });
      };
    const logger = {
      lines,
      error: at("error"),
      warn: at("warn"),
      info: at("info"),
      debug: at("debug"),
      child: () => logger,
      time: <T>(_msg: string, fn: () => Promise<T>) => fn(),
    };
    return logger;
  }

  async function loadWith(keychain: FakeKeychain): Promise<InstallSecretStore> {
    vi.resetModules();
    vi.doMock(KEYCHAIN, () => keychain);
    return (await import("../../../src/bootstrap/container"))
      .installSecretStore;
  }

  afterEach(() => {
    vi.doUnmock(KEYCHAIN);
    vi.resetModules();
  });

  it("reconciles every flag once after a tier-1 probe, and returns the store", async () => {
    const keychain = fakeKeychain(true);
    const installSecretStore = await loadWith(keychain);
    const logger = recordingLogger();

    const secrets = await installSecretStore(logger);

    expect(secrets).toEqual({ backend: "os-keychain" });
    expect(keychain.reconcileKeyPresence).toHaveBeenCalledTimes(1);
    expect(keychain.refreshKeyPresence).not.toHaveBeenCalled();
    expect(logger.lines).toEqual([
      {
        level: "debug",
        msg: "key-presence flags reconciled from the keystore",
        ctx: { flags: { openrouterKeyPresent: true, ncbiKeyPresent: false } },
      },
    ]);
  });

  it("still returns the store when reconciliation throws, and warns once", async () => {
    const keychain = fakeKeychain(true);
    keychain.reconcileKeyPresence.mockImplementation(() =>
      Promise.reject(new Error("login store unreadable")),
    );
    const installSecretStore = await loadWith(keychain);
    const logger = recordingLogger();

    const secrets = await installSecretStore(logger);

    expect(secrets).toEqual({ backend: "os-keychain" });
    expect(logger.lines.map((line) => line.level)).toEqual(["warn"]);
    expect(logger.lines[0]?.msg).toContain("key-presence flags");
  });

  it("reconciles nothing and returns no store when the probe fails", async () => {
    const keychain = fakeKeychain(false);
    const installSecretStore = await loadWith(keychain);

    const secrets = await installSecretStore(recordingLogger());

    expect(secrets).toBeUndefined();
    expect(keychain.createKeychainSecretStore).not.toHaveBeenCalled();
    expect(keychain.reconcileKeyPresence).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// P3-T33 — the plugin database opens once, inside installServices
// ---------------------------------------------------------------------------

/**
 * A real SQLite (`node:sqlite`) behind `src/zotero/db.ts`'s port, as
 * `test/unit/core/provenanceRerun.test.ts` builds one, plus a recorder of the
 * order the lifetime events happen in.
 */
function sqliteDatabase(options: { readonly failOpen?: boolean } = {}): {
  readonly source: PluginDatabaseSource;
  readonly db: DatabaseSync;
  readonly events: string[];
} {
  const db = new DatabaseSync(":memory:");
  const events: string[] = [];
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  const connection: SqlConnection = {
    queryAsync(sql, params) {
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params) {
      const row = db.prepare(sql).get(...bind(params));
      return Promise.resolve(row === undefined ? false : Object.values(row)[0]);
    },
    async executeTransaction(func) {
      db.exec("BEGIN");
      try {
        const result = await func();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    closeDatabase() {
      events.push("close");
      db.close();
      return Promise.resolve();
    },
  };
  const files = new Map<string, string>();
  const blobs: CacheBlobStore = {
    write: (name, text) => Promise.resolve(void files.set(name, text)),
    read: (name) => Promise.resolve(files.get(name)),
    remove: (name) => Promise.resolve(void files.delete(name)),
    list: () => Promise.resolve([...files.keys()]),
  };
  return {
    db,
    events,
    source: {
      open: () => {
        events.push("open");
        if (options.failOpen === true) throw new Error("database is locked");
        return connection;
      },
      path: () => "/data/research-helper.sqlite",
      blobs,
    },
  };
}

/** Let the background open-and-migrate and the job-store attach settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((done) => setImmediate(done));
  }
}

describe("P3-T33 — installServices opens the plugin database once and shares it (plan/00 §6 item 249)", () => {
  it("opens the one connection inside installServices, migrates it in the background, and gives it to the job store and the cache", async () => {
    const database = sqliteDatabase();
    const h = harness({ pluginDatabase: database.source });
    const graph = await installServices(h.scope, h.options);
    // Opened in line, before installServices returned — and only once.
    expect(database.events).toStrictEqual(["open"]);

    const open = await graph.database.ready;
    expect(open).toMatchObject({
      path: "/data/research-helper.sqlite",
      schemaFrom: 0,
      // 4 since plan/00 §6 item 265 (b) appended `user_price`; 5 since P3-T15
      // appended `collection_settings`; 6 since P3-T25 appended `summary`; 7
      // since P4-T14 appended `report`; 10 since P5-T03 appended its three tables.
      schemaVersion: 10,
    });
    await settle();
    expect(graph.jobs.attached).toBe(true);
    // The job store's recovery ran over the same connection: nothing to do.
    expect(await graph.jobs.list()).toStrictEqual([]);

    // The cache is the one every job's context carries, on the same file.
    const token = createCancellationTokenSource().token;
    const job = graph.pipelineContext.forJob({
      pipelineId: "searchImport",
      token,
    });
    expect(job.context.cache).toBe(graph.cache);
    job.dispose();
    await graph.cache.set("report", "k", { a: 1 });
    expect(await graph.cache.get("report", "k")).toStrictEqual({ a: 1 });
    expect(
      database.db.prepare("SELECT COUNT(*) AS n FROM cache_entry").get(),
    ).toMatchObject({ n: 1 });
    // The provenance store is on the same connection too.
    await open?.provenance.findProvenanceByCollection(1, "ABCD2345");
    expect(database.events).toStrictEqual(["open"]);

    // §9.4's deferred startup prune is scheduled on the graph's clock.
    expect(h.clock.pending).toBeGreaterThan(0);

    // Teardown: recovery awaited, store detached, then the connection closed.
    const detach = vi.spyOn(graph.jobs, "detachStore");
    detach.mockImplementation(() => {
      database.events.push("detach");
    });
    await h.scope.unregisterAll();
    expect(database.events).toStrictEqual(["open", "detach", "close"]);
    expect(h.clock.pending).toBe(0);
    expect(h.errors).toStrictEqual([]);
    // After teardown the cache is inert rather than reaching a closed file.
    expect(await graph.cache.get("report", "k")).toBeUndefined();
  });

  it("detaches the job store for real before the connection closes", async () => {
    const database = sqliteDatabase();
    const h = harness({ pluginDatabase: database.source });
    const graph = await installServices(h.scope, h.options);
    await graph.database.ready;
    await settle();
    expect(graph.jobs.attached).toBe(true);
    await h.scope.unregisterAll();
    expect(graph.jobs.attached).toBe(false);
    expect(database.events).toStrictEqual(["open", "close"]);
  });

  // `P4-T14`: the report store is built on the one connection, beside the
  // summary store, and handed out the same way — nothing once teardown began.
  it("builds the report store on the one connection and hands out nothing after teardown (P4-T14)", async () => {
    const database = sqliteDatabase();
    const markdownFiles = new Map<string, string>();
    const h = harness({
      pluginDatabase: {
        ...database.source,
        reportFiles: {
          write: (id, text) => {
            markdownFiles.set(id, text);
            return Promise.resolve();
          },
          read: (id) => Promise.resolve(markdownFiles.get(id)),
          exists: (id) => Promise.resolve(markdownFiles.has(id)),
          remove: (id) => {
            markdownFiles.delete(id);
            return Promise.resolve();
          },
        },
      },
    });
    const graph = await installServices(h.scope, h.options);
    const store = await graph.database.reports();
    expect(store).toBeDefined();
    const report = {
      id: "rpt-container-1",
      libraryID: 1,
      collectionKey: "COLL2345",
      generatedAtEpochMs: 5,
      markdown: "# Research Trends: X\n",
      sections: [],
      bibliography: [],
      warnings: [],
    } as unknown as TrendReport;
    await store?.put(report);
    expect(
      database.db.prepare("SELECT id, note_key FROM report").all(),
    ).toMatchObject([{ id: "rpt-container-1", note_key: null }]);
    expect((await store?.get("rpt-container-1"))?.markdown).toBe(
      "# Research Trends: X\n",
    );
    expect(database.events).toStrictEqual(["open"]);
    await h.scope.unregisterAll();
    expect(await graph.database.reports()).toBeUndefined();
  });

  // `P3-T26`: `docs/07` §9.3 trigger 1, run once the cache is usable.
  it("compares the shipped prompt versions once the database is ready, invalidates a MINOR-bumped prompt's entries, keeps a PATCH-bumped one's, and writes the set once", async () => {
    const database = sqliteDatabase();
    let release: (versions: Record<string, string>) => void = () => undefined;
    const loaded = new Promise<Record<string, string>>((resolve) => {
      release = resolve;
    });
    const h = harness(
      { pluginDatabase: database.source, promptVersions: () => loaded },
      {
        "cache.lastSeenPromptVersions": JSON.stringify({
          PAPER_SUMMARY_ABSTRACT: "1.0.0",
          CHUNK_MAP: "1.0.0",
        }),
      },
    );
    const graph = await installServices(h.scope, h.options);
    await graph.database.ready;
    // The summary cache tags by MAJOR.MINOR line (item 273(a)).
    await graph.cache.set("summary", "old", 1, {
      tags: ["promptVersion:PAPER_SUMMARY_ABSTRACT@1.0"],
    });
    await graph.cache.set("summary", "kept", 2, {
      tags: ["promptVersion:CHUNK_MAP@1.0"],
    });

    // A MINOR bump goes; a PATCH bump keeps its entries (docs/12 §17.2).
    const shipped = { PAPER_SUMMARY_ABSTRACT: "1.1.0", CHUNK_MAP: "1.0.1" };
    release(shipped);
    await settle();
    expect(await graph.cache.get("summary", "old")).toBeUndefined();
    expect(await graph.cache.get("summary", "kept")).toBe(2);
    expect(
      JSON.parse(String(h.prefs.get("cache.lastSeenPromptVersions"))),
    ).toStrictEqual(shipped);

    await h.scope.unregisterAll();
    expect(database.events).toStrictEqual(["open", "close"]);
    expect(h.errors).toStrictEqual([]);
  });

  it("keeps startup standing when the database cannot open: no job store, an inert cache, one error line", async () => {
    const database = sqliteDatabase({ failOpen: true });
    const h = harness({ pluginDatabase: database.source });
    const graph = await installServices(h.scope, h.options);
    expect(await graph.database.ready).toBeUndefined();
    await settle();
    expect(graph.jobs.attached).toBe(false);
    await graph.cache.set("report", "k", 1);
    expect(await graph.cache.get("report", "k")).toBeUndefined();
    expect(
      h.sink.lines.filter((line) => line.includes("could not be opened")),
    ).toHaveLength(1);
    await h.scope.unregisterAll();
    expect(h.errors).toStrictEqual([]);
  });

  it("has no database and schedules nothing when none is passed (a unit test of the graph)", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    expect(await graph.database.ready).toBeUndefined();
    expect(graph.jobs.attached).toBe(false);
    expect(h.clock.pending).toBe(0);
    await h.scope.unregisterAll();
  });
});

// ---------------------------------------------------------------------------
// P3-T35 — every job's context carries the real members
// ---------------------------------------------------------------------------

describe("P3-T35 — every job's PipelineContext carries a real cache, budget, llm, config, privacy and checkpoint", () => {
  /** `docs/03` §12.1's Sonnet row, reached through OpenRouter's slug. */
  const DOCUMENTED_SLUG = "anthropic/claude-sonnet-5";

  function chatRequest(model: string): ChatRequest {
    return {
      model,
      messages: [{ role: "user", content: "hello" }],
      maxOutputTokens: 10_000,
      traceId: "p3-t35",
    };
  }

  function usage(costUsd: number): Usage {
    return {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      costUsd,
    };
  }

  it("fills every member but tts and zotero from what installServices built once", async () => {
    const h = harness({}, { "privacy.mode": "full" });
    const graph = await installServices(h.scope, h.options);
    const token = createCancellationTokenSource().token;
    const job = graph.pipelineContext.forJob({
      pipelineId: "searchImport",
      token,
    });
    const { context } = job;
    expect(context.cache).toBe(graph.cache);
    expect(context.llm).toBe(graph.llm.router);
    expect(context.config).toBe(graph.config);
    expect(context.budget).toBe(job.budget);
    expect(context.budget.spentUsd).toBe(0);
    // A job over no collection runs under the global mode, which is
    // `loadPrivacyPolicy`'s rule for it.
    expect(context.privacy.mode).toBe("full");
    expect(context.tts).toBeUndefined();
    expect(context.zotero).toBeUndefined();
    // No record, so nothing to write into: the no-op stays.
    expect(job.checkpoints).toBeUndefined();
    await expect(context.checkpoint({ stage: 1 })).resolves.toBeUndefined();
    expect(context.resumeState).toBeUndefined();
    job.dispose();
    await h.scope.unregisterAll();
    expect(h.errors).toStrictEqual([]);
  });

  it("reads preferences through ctx.config, live and with getPref's fallback", async () => {
    const h = harness();
    const graph = await installServices(h.scope, h.options);
    const job = graph.pipelineContext.forJob({
      pipelineId: "searchImport",
      token: createCancellationTokenSource().token,
    });
    const { config } = job.context;
    expect(Object.isFrozen(config)).toBe(true);
    // docs/07 §8.5's defaults.
    expect(config.get("privacyMode")).toBe("balanced");
    expect(config.get("runMaxSessionSpendCents")).toBe(500);
    h.prefs.set("privacy.mode", "strict");
    expect(config.get("privacyMode")).toBe("strict");
    h.prefs.set("privacy.mode", "nonsense");
    expect(config.get("privacyMode")).toBe("balanced");
    job.dispose();
    await h.scope.unregisterAll();
  });

  it("gives two jobs distinct run counters over the same session counter", async () => {
    const session = createSessionSpendCounter();
    const h = harness({ sessionSpend: session });
    const graph = await installServices(h.scope, h.options);
    expect(graph.sessionSpend).toBe(session);
    const token = createCancellationTokenSource().token;
    const first = graph.pipelineContext.forJob({
      pipelineId: "summarize",
      token,
    });
    const second = await graph.pipelineContext.openJob({
      pipelineId: "summarize",
      token,
    });
    expect(first.budget).not.toBe(second.budget);

    first.budget
      .reserveCall({ inputTokens: 100, outputTokens: 10, costUsd: 0.25 })
      .settle(usage(0.25));
    expect(first.context.budget.spentUsd).toBe(0.25);
    expect(second.context.budget.spentUsd).toBe(0);
    expect(session.totals.costUsd).toBe(0.25);
    expect(second.budget.usage().session).toStrictEqual(session.totals);

    second.budget
      .reserveCall({ inputTokens: 100, outputTokens: 10, costUsd: 0.5 })
      .settle(usage(0.5));
    expect(first.budget.spentUsd).toBe(0.25);
    expect(second.budget.spentUsd).toBe(0.5);
    expect(first.budget.usage().session.costUsd).toBe(0.75);
    first.dispose();
    second.dispose();
    await h.scope.unregisterAll();
  });

  it("budgets the one router: a call carrying ctx.budget is refused before it is sent; one without it is refused too (item 278(a))", async () => {
    const h = harness({}, { "run.maxSpendCents": 1 });
    const graph = await installServices(h.scope, h.options);
    const token = createCancellationTokenSource().token;
    const job = graph.pipelineContext.forJob({
      pipelineId: "summarize",
      token,
    });
    const { llm, budget } = job.context;

    // Priced from the documented table: 10,000 output tokens at $10/M pass a
    // 1-cent run ceiling, so nothing is sent.
    let refused: unknown;
    await llm
      .chat(chatRequest(DOCUMENTED_SLUG), { token, budget })
      .catch((error: unknown) => {
        refused = error;
      });
    expect(refused).toBeInstanceOf(BudgetExceededError);
    expect(ceilingStopOf(refused)?.ceiling).toBe("run");
    expect(h.transport.calls).toHaveLength(0);
    expect(budget.spentUsd).toBe(0);

    // Without the guard the router refuses before anything else, the key
    // lookup included (owner, 2026-10-23, plan/00 §6 item 278(a): fail
    // closed). Not a ceiling, so the job runner never reads it as one.
    const unbudgeted = await llm
      .chat(chatRequest(DOCUMENTED_SLUG), { token })
      .catch((error: unknown) => error);
    expect(unbudgeted).toBeInstanceOf(ConfigurationError);
    expect(unbudgeted).not.toBeInstanceOf(MissingCredentialError);
    expect(ceilingStopOf(unbudgeted)).toBeUndefined();
    // A model the table does not list is unpriced: it passes the ceiling and
    // the router then refuses for the key; its reservation is released.
    await expect(
      llm.chat(chatRequest("test-author/unlisted-model"), { token, budget }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
    expect(h.transport.calls).toHaveLength(0);
    expect(job.budget.binding()?.reservedUsd).toBe(0);
    job.dispose();
    await h.scope.unregisterAll();
  });

  it("prices every reservation from graph.modelPrices (item 278(b)): the documented table at first, the user's price once read — at startup and after a change — and no catalogue request at startup", async () => {
    const database = sqliteDatabase();
    const h = harness(
      { pluginDatabase: database.source },
      { "run.maxSpendCents": 1 },
    );
    const graph = await installServices(h.scope, h.options);
    expect(graph.modelPrices.loaded).toBe(false);
    const documented = graph.modelPrices.pricesFor(
      "openrouter",
      DOCUMENTED_SLUG,
    );
    expect(documented?.source).toBe("documented-table");
    // The startup read: a row already in user_price when the database opens.
    await graph.database.ready;
    database.db
      .prepare(
        "INSERT INTO user_price (provider_id, model_id, input_per_mtok_usd, " +
          "output_per_mtok_usd, cached_input_per_mtok_usd, as_of) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("openrouter", DOCUMENTED_SLUG, 0, 0, null, Date.UTC(2026, 9, 23));
    await settle();
    expect(
      graph.modelPrices.pricesFor("openrouter", DOCUMENTED_SLUG)?.source,
    ).toBe("user-override");
    // Startup and that read sent nothing (item 279(c)).
    expect(h.transport.calls).toHaveLength(0);
    expect(graph.modelPrices.loaded).toBe(false);

    const token = createCancellationTokenSource().token;
    const job = graph.pipelineContext.forJob({
      pipelineId: "summarize",
      token,
    });
    const { llm, budget } = job.context;
    // At $0/M the reservation is $0, so the 1-cent ceiling passes and the
    // router refuses only for the missing key; nothing is reserved after.
    await expect(
      llm.chat(chatRequest(DOCUMENTED_SLUG), { token, budget }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
    expect(job.budget.binding()?.reservedUsd).toBe(0);

    // A change through the pane's store surface reaches the next reservation.
    const store = reloadingUserPriceStore(
      graph.database.prices,
      graph.modelPrices,
    );
    await store.delete("openrouter", DOCUMENTED_SLUG);
    await expect(
      llm.chat(chatRequest(DOCUMENTED_SLUG), { token, budget }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    await store.upsert({
      providerId: "openrouter",
      modelId: DOCUMENTED_SLUG,
      inputPerMTokUsd: 0,
      outputPerMTokUsd: 0,
      asOfEpochMs: Date.UTC(2026, 9, 23),
    });
    await expect(
      llm.chat(chatRequest(DOCUMENTED_SLUG), { token, budget }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
    expect(h.transport.calls).toHaveLength(0);
    job.dispose();
    await h.scope.unregisterAll();
  });

  it("binds a queued job's checkpoint() and resumeState to its record, and starts its run counter from the record's usage", async () => {
    const database = sqliteDatabase();
    const h = harness({ pluginDatabase: database.source });
    const graph = await installServices(h.scope, h.options);
    await graph.database.ready;
    await settle();
    const token = createCancellationTokenSource().token;
    const record = await graph.jobs.enqueue("summarize", { collection: "X" });

    const job = await graph.pipelineContext.openJob({
      pipelineId: "summarize",
      token,
      record,
    });
    expect(job.jobId).toBe(record.id);
    expect(job.context.jobId).toBe(record.id);
    expect(job.context.resumeState).toBeUndefined();
    const writer = must(job.checkpoints, "the checkpoint writer");

    const first = { version: 1, completed: ["a"], failed: [], pending: ["b"] };
    const later = {
      version: 1,
      completed: ["a", "b"],
      failed: [],
      pending: [],
    };
    await job.context.checkpoint(first);
    expect(await graph.jobs.readCheckpoint(record.id)).toStrictEqual(first);
    // docs/07 §7.6: at most one write per 2 s; the held state waits for a
    // flush (or for the next write the throttle allows).
    await job.context.checkpoint(later);
    expect(await graph.jobs.readCheckpoint(record.id)).toStrictEqual(first);
    await writer.flush();
    expect(await graph.jobs.readCheckpoint(record.id)).toStrictEqual(later);
    job.dispose();

    // A resumed job reads its checkpoint back, and its run counter starts
    // from what earlier attempts spent.
    await graph.jobs.addUsage(record.id, {
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.5,
    });
    const stored = must(await graph.jobs.get(record.id), "the stored record");
    const resumed = await graph.pipelineContext.openJob({
      pipelineId: "summarize",
      token,
      record: stored,
    });
    expect(resumed.context.resumeState).toStrictEqual(later);
    expect(resumed.budget.spentUsd).toBe(0.5);
    resumed.dispose();

    // A record cannot be opened as another pipeline.
    await expect(
      graph.pipelineContext.openJob({
        pipelineId: "searchImport",
        token,
        record,
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);

    await h.scope.unregisterAll();
    expect(h.errors).toStrictEqual([]);
  });

  it("applies a collection's privacy override, which only tightens, and fails closed to strict on a row it cannot read", async () => {
    const database = sqliteDatabase();
    const h = harness(
      { pluginDatabase: database.source },
      { "privacy.mode": "balanced" },
    );
    const graph = await installServices(h.scope, h.options);
    await graph.database.ready;
    const token = createCancellationTokenSource().token;
    const modeOf = async (collectionKey?: string): Promise<string> => {
      const job = await graph.pipelineContext.openJob({
        pipelineId: "summarize",
        token,
        ...(collectionKey !== undefined && {
          collection: { libraryID: 1, collectionKey },
        }),
      });
      job.dispose();
      return job.context.privacy.mode;
    };

    await graph.collectionSettings.put(1, "STRICT23", {
      privacyMode: "strict",
    });
    await graph.collectionSettings.put(1, "LOOSE234", { privacyMode: "full" });
    expect(
      database.db
        .prepare("SELECT COUNT(*) AS n FROM collection_settings")
        .get(),
    ).toMatchObject({ n: 2 });
    expect(await modeOf("STRICT23")).toBe("strict");
    // An override never loosens the global mode.
    expect(await modeOf("LOOSE234")).toBe("balanced");
    expect(await modeOf("NOROW234")).toBe("balanced");
    expect(await modeOf()).toBe("balanced");

    // A stored row that is not a JSON object reads as strict, never as "no
    // override".
    database.db
      .prepare(
        "INSERT INTO collection_settings (library_id, collection_key, json) " +
          "VALUES (1, 'BROKEN23', 'not json')",
      )
      .run();
    expect(await modeOf("BROKEN23")).toBe("strict");

    await h.scope.unregisterAll();
    expect(h.errors).toStrictEqual([]);
  });

  it("gives a job over an item's collections the strictest of their overrides and the global mode (plan/00 §6 item 305(a))", async () => {
    const database = sqliteDatabase();
    const h = harness(
      { pluginDatabase: database.source },
      { "privacy.mode": "balanced" },
    );
    const graph = await installServices(h.scope, h.options);
    await graph.database.ready;
    const token = createCancellationTokenSource().token;
    await graph.collectionSettings.put(1, "STRICT23", {
      privacyMode: "strict",
    });
    await graph.collectionSettings.put(1, "LOOSE234", { privacyMode: "full" });
    const modeOf = async (...keys: string[]): Promise<string> => {
      const job = await graph.pipelineContext.openJob({
        pipelineId: "summarize",
        token,
        itemCollections: keys.map((collectionKey) => ({
          libraryID: 1,
          collectionKey,
        })),
      });
      job.dispose();
      return job.context.privacy.mode;
    };

    // A strict collection under a balanced global mode: strict.
    expect(await modeOf("STRICT23")).toBe("strict");
    // Two collections: the stricter, in either order.
    expect(await modeOf("LOOSE234", "STRICT23")).toBe("strict");
    expect(await modeOf("STRICT23", "LOOSE234")).toBe("strict");
    // An override never loosens; no collection is the global mode.
    expect(await modeOf("LOOSE234", "NOROW234")).toBe("balanced");
    expect(await modeOf()).toBe("balanced");

    await h.scope.unregisterAll();
    expect(h.errors).toStrictEqual([]);
  });

  it("gives a collection job a strict policy when there is no database, and writes nothing", async () => {
    const h = harness({}, { "privacy.mode": "full" });
    const graph = await installServices(h.scope, h.options);
    const token = createCancellationTokenSource().token;
    const overCollection = await graph.pipelineContext.openJob({
      pipelineId: "summarize",
      token,
      collection: { libraryID: 1, collectionKey: "ABCD2345" },
    });
    expect(overCollection.context.privacy.mode).toBe("strict");
    expect(
      h.sink.lines.filter((line) => line.includes("strict privacy mode")),
    ).toHaveLength(1);
    const overNone = await graph.pipelineContext.openJob({
      pipelineId: "summarize",
      token,
    });
    expect(overNone.context.privacy.mode).toBe("full");
    await expect(
      graph.collectionSettings.put(1, "ABCD2345", { privacyMode: "strict" }),
    ).rejects.toBeInstanceOf(StorageError);
    overCollection.dispose();
    overNone.dispose();
    await h.scope.unregisterAll();
  });

  it("builds the confirm and ceilings resume guards only once a remaining-work estimate exists, over the session counter it is given", async () => {
    const h = harness();
    await installServices(h.scope, h.options);
    const session = createSessionSpendCounter();
    expect(createSpendResumeGuards({ session })).toStrictEqual({});

    const record = createJobRecord({
      id: "job-1",
      pipelineId: "summarize",
      input: {},
      createdAtEpochMs: 0,
      createdByPluginVersion: "1.2.3",
    });
    const guards = createSpendResumeGuards({
      session,
      remaining: () => Promise.resolve({ calls: 2, costUsd: 0.02 }),
    });
    const confirm = must(guards.confirm, "the confirm guard");
    const ceilings = must(guards.ceilings, "the ceilings guard");
    // Under summary.confirmAboveCents and the 500-cent session ceiling.
    await expect(confirm(record)).resolves.toStrictEqual({ proceed: true });
    await expect(ceilings(record)).resolves.toStrictEqual({ proceed: true });
    // The session counter it was given is the one it judges by.
    session.add({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 4.99,
      estimated: false,
    });
    await expect(ceilings(record)).resolves.toStrictEqual({
      proceed: false,
      pauseReason: "budget-stop",
    });
    await h.scope.unregisterAll();
  });

  it("hands the OpenRouter adapter the global privacy mode, read on every request", async () => {
    const clock = createManualClock();
    const transport = createFakeTransport(clock);
    const http = createHttpClient({
      transport,
      userAgent:
        "research_helper/9.9.9 (https://example.test; mailto:x@example.test)",
      clock,
    });
    // Synthetic, built at run time; never a real key.
    const key = ["sk", "or", "v1", "0123456789abcdef".repeat(4)].join("-");
    const secrets: SecretStore = {
      backend: "session-only",
      unattended: true,
      get: (id) => Promise.resolve(id === "llm.openrouter" ? key : undefined),
      set: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      has: (id) => Promise.resolve(id === "llm.openrouter"),
      listStoredIds: () => Promise.resolve(["llm.openrouter"]),
      clearAll: () => Promise.resolve(0),
    };
    let mode: "strict" | "balanced" | "full" = "strict";
    const services = registerProviders({
      logger: createLogger({ sink: createCapturingSink(), clock }),
      http,
      secrets,
      privacyMode: () => mode,
    });
    const openrouter = must(services.registry.get("openrouter"), "OpenRouter");
    const token = createCancellationTokenSource().token;
    const providerBlock = async (): Promise<unknown> => {
      // The fake transport answers "ok", which is no answer; only the body
      // that went out is looked at.
      await openrouter
        .chat(chatRequest("test-author/test-model"), { token })
        .catch(() => undefined);
      const body = transport.calls.at(-1)?.options.body;
      return (JSON.parse(String(body)) as { provider: unknown }).provider;
    };
    expect(await providerBlock()).toStrictEqual({
      data_collection: "deny",
      zdr: true,
    });
    mode = "balanced";
    expect(await providerBlock()).toStrictEqual({ data_collection: "deny" });
  });

  it("passes registerProviders the global privacy.mode, read on every call", async () => {
    const PROVIDERS = "../../../src/bootstrap/registerProviders";
    let passed: (() => string) | undefined;
    vi.resetModules();
    vi.doMock(PROVIDERS, async (importOriginal) => {
      const actual =
        await importOriginal<
          typeof import("../../../src/bootstrap/registerProviders")
        >();
      return {
        ...actual,
        registerProviders: (
          deps: Parameters<typeof actual.registerProviders>[0],
        ) => {
          passed = deps.privacyMode;
          return actual.registerProviders(deps);
        },
      };
    });
    try {
      const fresh = await import("../../../src/bootstrap/container");
      const h = harness({}, { "privacy.mode": "strict" });
      await fresh.installServices(h.scope, h.options);
      const privacyMode = must(passed, "the privacy-mode getter");
      expect(privacyMode()).toBe("strict");
      h.prefs.set("privacy.mode", "full");
      expect(privacyMode()).toBe("full");
      await h.scope.unregisterAll();
    } finally {
      vi.doUnmock(PROVIDERS);
      vi.resetModules();
    }
  });
});

// P4-T20 step 0c (plan/00 §6 items 322(e), 324(a); P4-T18 finding 5): the
// runner of the jobs recover() re-queues stops every run at plugin teardown.
describe("P4-T20 step 0c — createResumedJobRunner", () => {
  it("runs a re-queued report job on a deferred surface the window can find, and stopAll cancels it as a shutdown and waits for it", async () => {
    const clock = createManualClock();
    const record = {
      ...createJobRecord({
        id: "trendReport-1",
        pipelineId: "trendReport",
        input: { libraryID: 1, collectionKey: "COLLKEY1", language: "en" },
        createdAtEpochMs: 0,
        createdByPluginVersion: "0.0.0-test",
      }),
    };
    let ended: string | undefined;
    let started: (() => void) | undefined;
    const startedRun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pipeline = {
      id: "trendReport",
      resumable: true,
      run: (
        _input: unknown,
        ctx: {
          readonly token: {
            onCancelled(cb: (r: { kind: string }) => void): () => void;
          };
        },
      ) =>
        new Promise((resolve) => {
          started?.();
          ctx.token.onCancelled((reason) => {
            ended = reason.kind;
            resolve({ outcome: "interrupted" });
          });
        }),
    };
    const disposed: string[] = [];
    const runner = createResumedJobRunner({
      jobs: () => ({ get: () => Promise.resolve(record) }),
      pipelines: () => ({ list: () => [pipeline] }) as never,
      openJob: (options) =>
        Promise.resolve({
          jobId: record.id,
          context: { token: options.token },
          checkpoints: {
            flush: () => (disposed.push("flush"), Promise.resolve()),
          },
          dispose: () => disposed.push("dispose"),
        } as never),
      logger: createLogger({ sink: createCapturingSink(), clock }),
    });
    runner.run(record.id);
    await startedRun;
    const found = runner.find(1, "COLLKEY1");
    expect(found?.jobId).toBe(record.id);
    expect(runner.surfaceOf(record.id)).toBe(found?.surface);
    await runner.stopAll();
    expect(ended).toBe("shutdown");
    expect(disposed).toEqual(["flush", "dispose"]);
    expect(runner.find(1, "COLLKEY1")).toBeUndefined();
    expect(found?.surface.output).toEqual({ outcome: "interrupted" });
    // After teardown began nothing new is run.
    runner.run(record.id);
    await Promise.resolve();
    expect(runner.find(1, "COLLKEY1")).toBeUndefined();
  });
});
