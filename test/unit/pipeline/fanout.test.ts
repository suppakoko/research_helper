import { describe, expect, it } from "vitest";

import { createManualClock, type ManualClock } from "../../../src/core/clock";
import { createDeferred, Semaphore } from "../../../src/core/concurrency";
import {
  OperationCancelledError,
  RateLimitError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createCancellationTokenSource,
  type CancellationReason,
  type CancellationToken,
} from "../../../src/core/jobQueue/cancellation";
import {
  CompositeProgressReporter,
  type ProgressReporter,
} from "../../../src/core/jobQueue/progress";
import { createLogger } from "../../../src/core/logger";
import { normalizePmid, type SourceId } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  fanOut,
  fetchStateFromReports,
  NETWORK_METADATA_POOL_SIZE,
  PER_SOURCE_TIMEOUT_MS,
  type FanOutOptions,
} from "../../../src/pipeline/searchImport/stages";
import type { SearchImportSourceReport } from "../../../src/pipeline/searchImport/types";
import { parseUserQuery } from "../../../src/sources/shared/queryParse";
import { recencyWindow } from "../../../src/sources/shared/recency";
import type {
  LiteratureSource,
  SourceCallContext,
  SourceCapabilities,
  SourceQuery,
} from "../../../src/sources/types";

/**
 * `P2-T02`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network**,
 * no fake timers — time is the injected `ManualClock`.
 *
 * ## What is real and what is a double
 *
 * **Real:** `fanOut` and `fetchStateFromReports`; `Semaphore` (the
 * `network-metadata` pool); `createCancellationTokenSource`, so the per-source
 * token linking and the deadline's cancellation are the shipped primitives;
 * `CompositeProgressReporter`, so the reporter-route for page warnings is the
 * real tree; `createManualClock`, so "20 s" is the real `Clock.sleep` contract
 * driven by `advance()`; `recencyWindow`, `resolveDateFilterMode` and
 * `applyClientRecencyFilter` through `fanOut`'s own calls.
 *
 * **A double, because the point is to control failure:** every
 * `LiteratureSource`. A source that 500s, 429s with `Retry-After`, hangs until
 * cancelled, hangs *ignoring* cancellation, or settles late. A real adapter
 * cannot be made to do these on demand without a transport script that would
 * itself be the double, one layer further down.
 *
 * ## The mutation that matters most
 *
 * One source's failure leaking into another's result. Every test in section 1
 * asserts the healthy sources' reports **field by field** against what they
 * would carry with no failing neighbour, not merely that "some" records came
 * back.
 */

// ===========================================================================
// Harness
// ===========================================================================

const CAPABILITIES: SourceCapabilities = {
  keywordSearch: true,
  query: {
    or: true,
    not: true,
    phrase: true,
    fields: ["title", "abstract", "author"],
  },
  relatedByWork: false,
  lookupById: [],
  abstractsInSearch: true,
  citationGraph: false,
  dateFilter: true,
  filters: { languages: false, openAccess: false },
  maxPageSize: 100,
  maxTotalResults: undefined,
  benefitsFromApiKey: false,
};

function record(
  sourceId: SourceId,
  nativeId: string,
  year?: number,
): SourceRecord {
  const pmid = normalizePmid(nativeId);
  return {
    id: `${sourceId}:${nativeId}`,
    sourceId,
    nativeId,
    work: {
      ids: { ...(pmid !== null && { pmid }) },
      type: "journal-article",
      title: `Title ${nativeId}`,
      authors: [{ family: "Lee", given: "A" }],
      ...(year !== undefined && {
        publishedDate: { year, iso: String(year) },
      }),
    },
    retrievedAtEpochMs: 1,
    missingFields: [],
  };
}

/** How one fake source behaves, page by page. */
interface FakeSourceOptions {
  readonly id: SourceId;
  /** Records to yield, in order, before `then` happens. */
  readonly yields?: readonly SourceRecord[];
  /** What happens after the yields. Default: finish normally. */
  readonly then?:
    | { kind: "throw"; error: Error }
    /** Wait for the run to cancel this source's token, then reject with it. */
    | { kind: "hang" }
    /** Never settle, and ignore the token entirely. */
    | { kind: "hang-ignoring-token" }
    /**
     * Wait for the cancel, then reject with a *typed upstream error* rather
     * than the cancellation — the shape an abort takes when it surfaces as a
     * transport failure.
     */
    | { kind: "hang-misreporting" }
    /** Like `hang`, but reject `delayMs` of real time after the cancel. */
    | { kind: "hang-then-late-reject"; delayMs: number }
    /** Block until the test releases the gate, then finish. */
    | { kind: "gate"; gate: Promise<void> }
    /**
     * Ignore the token entirely: wait for `gate`, yield `extra`, then block
     * forever. Models an adapter that keeps producing after a cancel.
     */
    | {
        kind: "gate-then-yield-forever";
        gate: Promise<void>;
        extra: SourceRecord;
      };
  readonly dateFilter?: boolean;
  /** Page warnings the adapter raises through `ctx.progress.warn`. */
  readonly pageWarnings?: readonly string[];
  /** Make `explainQuery` throw, to test a failure before `searchAll` runs. */
  readonly explainThrows?: Error;
}

/** What one fake observed. */
interface FakeSourceLog {
  readonly queries: SourceQuery[];
  readonly cancelReasons: CancellationReason[];
  started: number;
  settled: number;
}

function fakeSource(options: FakeSourceOptions): {
  readonly source: LiteratureSource;
  readonly log: FakeSourceLog;
} {
  const log: FakeSourceLog = {
    queries: [],
    cancelReasons: [],
    started: 0,
    settled: 0,
  };
  const source: LiteratureSource = {
    id: options.id,
    displayNameKey: `research-helper-source-${options.id}`,
    capabilities: {
      ...CAPABILITIES,
      ...(options.dateFilter !== undefined && {
        dateFilter: options.dateFilter,
      }),
    },
    rateLimitKey: `${options.id}.example.org`,
    isConfigured: () => true,
    healthCheck: () =>
      Promise.resolve({ ok: true, messageKey: "ok", latencyMs: 0 }),
    search: () =>
      Promise.resolve({
        records: [],
        totalAvailable: undefined,
        nextCursor: undefined,
        warnings: [],
      }),
    async *searchAll(query: SourceQuery, ctx: SourceCallContext) {
      log.queries.push(query);
      log.started += 1;
      try {
        for (const warning of options.pageWarnings ?? []) {
          ctx.progress?.warn(warning);
        }
        for (const item of options.yields ?? []) {
          ctx.token.throwIfCancelled();
          yield item;
        }
        const then = options.then;
        if (then === undefined) return;
        switch (then.kind) {
          case "throw":
            throw then.error;
          case "hang":
            await new Promise<never>((_, reject) => {
              ctx.token.onCancelled((reason) => {
                log.cancelReasons.push(reason);
                reject(new OperationCancelledError(reason));
              });
            });
            return;
          case "hang-ignoring-token":
            await new Promise<never>(() => undefined);
            return;
          case "hang-misreporting":
            await new Promise<never>((_, reject) => {
              ctx.token.onCancelled((reason) => {
                log.cancelReasons.push(reason);
                reject(new UpstreamServerError(500, "connection aborted"));
              });
            });
            return;
          case "gate-then-yield-forever":
            await then.gate;
            yield then.extra;
            await new Promise<never>(() => undefined);
            return;
          case "hang-then-late-reject":
            await new Promise<never>((_, reject) => {
              ctx.token.onCancelled((reason) => {
                log.cancelReasons.push(reason);
                setTimeout(() => {
                  reject(new OperationCancelledError(reason));
                }, then.delayMs);
              });
            });
            return;
          case "gate":
            await then.gate;
            return;
        }
      } finally {
        log.settled += 1;
      }
    },
    explainQuery: (query: SourceQuery) => {
      if (options.explainThrows !== undefined) throw options.explainThrows;
      return `${options.id}:${JSON.stringify(query.terms)}`;
    },
  };
  return { source, log };
}

/** Everything one `fanOut` call needs, with the real reporter tree underneath. */
function harness(
  sources: readonly LiteratureSource[],
  overrides: Partial<Omit<FanOutOptions, "sources">> = {},
): {
  readonly options: FanOutOptions;
  readonly clock: ManualClock;
  readonly cancel: ReturnType<typeof createCancellationTokenSource>;
  readonly root: CompositeProgressReporter;
  readonly stage: ProgressReporter;
  /** Every line the fan-out logged, verbatim. */
  readonly logs: readonly string[];
} {
  const clock = createManualClock(1_000);
  const cancel = createCancellationTokenSource();
  const root = new CompositeProgressReporter({
    clock,
    sinks: [],
    throttleMs: 0,
    token: cancel.token,
  });
  const stage = root.child("fetching", 0.05, 0.5);
  const logs: string[] = [];
  return {
    clock,
    cancel,
    root,
    stage,
    logs,
    options: {
      sources,
      input: { query: "crispr", limit: 10, dateFilter: "none" },
      token: cancel.token,
      clock,
      progress: stage,
      logger: createLogger({
        sink: {
          write: (line) => {
            logs.push(line);
          },
        },
        clock,
      }),
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
      ...overrides,
    },
  };
}

/**
 * Let everything already queued run: one macrotask turn drains every
 * microtask the pool, the generators and the token callbacks have queued,
 * however many hops deep. Real time, not the manual clock — nothing here
 * sleeps on it.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Attach a settled-flag to a promise without consuming its rejection. */
function watch<T>(promise: Promise<T>): { settled(): boolean } {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return { settled: () => settled };
}

/** The report fields a healthy source must carry regardless of its neighbours. */
function healthyReport(
  id: SourceId,
  recordsRetrieved: number,
): Partial<SearchImportSourceReport> {
  return {
    sourceId: id,
    requestedLimit: 10,
    dateFilterApplied: "none",
    recordsRetrieved,
    droppedOutOfWindow: 0,
    keptWithoutDate: 0,
    recordsDeduplicatedAway: 0,
    error: undefined,
    warnings: [],
  };
}

// ===========================================================================
// 1. Failure isolation — criterion 1, FR-9, the phase's third finishing condition
// ===========================================================================

describe("one source failing does not touch another (criterion 1, FR-9)", () => {
  function fourSources() {
    const broken = fakeSource({
      id: "crossref",
      then: {
        kind: "throw",
        error: new UpstreamServerError(500, "crossref is down"),
      },
    });
    const throttled = fakeSource({
      id: "arxiv",
      then: {
        kind: "throw",
        error: new RateLimitError(429, 30_000, "export.arxiv.org"),
      },
    });
    const healthyA = fakeSource({
      id: "pubmed",
      yields: [record("pubmed", "1"), record("pubmed", "2")],
    });
    const healthyB = fakeSource({
      id: "europepmc",
      yields: [record("europepmc", "3")],
    });
    return { broken, throttled, healthyA, healthyB };
  }

  it("returns both healthy result sets, two warning rows, and state partial", async () => {
    const { broken, throttled, healthyA, healthyB } = fourSources();
    const h = harness([
      healthyA.source,
      broken.source,
      throttled.source,
      healthyB.source,
    ]);

    const result = await fanOut(h.options);

    expect(result.state).toBe("partial");
    // Both healthy result sets, intact and in source order.
    expect(result.records.map((r) => r.id)).toEqual([
      "pubmed:1",
      "pubmed:2",
      "europepmc:3",
    ]);
    // The healthy reports carry exactly what they would with no failing
    // neighbour — this is the field-by-field leak check.
    expect(result.perSource[0]).toMatchObject(healthyReport("pubmed", 2));
    expect(result.perSource[3]).toMatchObject(healthyReport("europepmc", 1));
    // The transmitted query is what the source's own `explainQuery` renders
    // for the query it was asked (docs/07 §4.2), whatever shape the parser
    // gives the tree.
    expect(result.perSource[0]?.transmittedQuery).toBe(
      healthyA.source.explainQuery(healthyA.log.queries[0] as SourceQuery),
    );

    // The two failed sources each carry their own typed error and nothing
    // else's.
    const crossref = result.perSource[1];
    const arxiv = result.perSource[2];
    expect(crossref?.error).toMatchObject({
      code: "UPSTREAM_SERVER",
      httpStatus: 500,
      retryable: true,
    });
    expect(crossref?.recordsRetrieved).toBe(0);
    expect(arxiv?.error).toMatchObject({
      code: "RATE_LIMIT",
      httpStatus: 429,
      retryable: true,
    });
    expect(arxiv?.recordsRetrieved).toBe(0);

    // Two warning rows, each naming its source and error class (FR-9's banner).
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/^crossref: UPSTREAM_SERVER/),
    );
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/^arxiv: RATE_LIMIT/),
    );
    expect(crossref?.warnings).toEqual([
      expect.stringMatching(/^crossref: UPSTREAM_SERVER/),
    ]);
    expect(arxiv?.warnings).toEqual([
      expect.stringMatching(/^arxiv: RATE_LIMIT/),
    ]);
    // And the banners reached the stage's reporter, so the run's warning list
    // carries them (docs/07 §4.1 `warn`: "recorded in the JobRecord's
    // warnings").
    expect(h.root.snapshot.warnings).toHaveLength(2);
    // Exactly the two failures were logged, each naming its source.
    const failureLines = h.logs.filter((line) =>
      line.includes("a source failed"),
    );
    expect(failureLines).toHaveLength(2);
    expect(failureLines.join("\n")).toContain("crossref");
    expect(failureLines.join("\n")).toContain("arxiv");
  });

  it("a 429 does not delay or park the healthy sources (no retry at this layer)", async () => {
    const { throttled, healthyA, healthyB } = fourSources();
    const h = harness([throttled.source, healthyA.source, healthyB.source]);

    const pending = watch(fanOut(h.options));
    await settle();

    // Nothing slept: a `Retry-After` of 30 s was reported, not honoured here —
    // the host's retry budget is `src/core/http/retry.ts`'s and has already
    // been spent by the time an error reaches the fan-out.
    expect(h.clock.pending).toBe(0);
    expect(pending.settled()).toBe(true);
  });

  it("a source whose explainQuery throws fails alone, before any request", async () => {
    const bad = fakeSource({
      id: "crossref",
      explainThrows: new Error("render failed"),
    });
    const good = fakeSource({ id: "pubmed", yields: [record("pubmed", "1")] });
    const h = harness([bad.source, good.source]);

    const result = await fanOut(h.options);

    expect(result.state).toBe("partial");
    expect(bad.log.started).toBe(0);
    expect(result.perSource[0]?.error).toMatchObject({
      code: "UNTYPED",
      detail: "Error",
    });
    expect(result.perSource[1]).toMatchObject(healthyReport("pubmed", 1));
    expect(result.records.map((r) => r.id)).toEqual(["pubmed:1"]);
  });

  it("keeps what a source yielded before it failed, and calls it partial", async () => {
    const degraded = fakeSource({
      id: "pubmed",
      yields: [record("pubmed", "1"), record("pubmed", "2")],
      then: { kind: "throw", error: new UpstreamServerError(502, "page 2") },
    });
    const h = harness([degraded.source]);

    const result = await fanOut(h.options);

    expect(result.state).toBe("partial");
    expect(result.records.map((r) => r.id)).toEqual(["pubmed:1", "pubmed:2"]);
    expect(result.perSource[0]?.recordsRetrieved).toBe(2);
    expect(result.perSource[0]?.error?.code).toBe("UPSTREAM_SERVER");
  });
});

// ===========================================================================
// 2. All sources failing — criterion 2
// ===========================================================================

describe("every source failing (criterion 2)", () => {
  it("ends in failed, not partial, with each source's own error", async () => {
    const a = fakeSource({
      id: "pubmed",
      then: { kind: "throw", error: new UpstreamServerError(500, "a") },
    });
    const b = fakeSource({
      id: "crossref",
      then: { kind: "throw", error: new UpstreamServerError(503, "b") },
    });
    const c = fakeSource({
      id: "arxiv",
      then: {
        kind: "throw",
        error: new RateLimitError(429, undefined, "export.arxiv.org"),
      },
    });
    const h = harness([a.source, b.source, c.source]);

    const result = await fanOut(h.options);

    expect(result.state).toBe("failed");
    expect(result.records).toEqual([]);
    expect(result.perSource.map((r) => r.error?.httpStatus)).toEqual([
      500, 503, 429,
    ]);
    expect(result.warnings).toHaveLength(3);
  });

  it("fetchStateFromReports: the three edges, including the empty-but-healthy case", () => {
    const ok = (id: SourceId, n: number): SearchImportSourceReport => ({
      sourceId: id,
      transmittedQuery: "",
      requestedLimit: 10,
      dateFilterApplied: "none",
      recordsRetrieved: n,
      droppedOutOfWindow: 0,
      keptWithoutDate: 0,
      recordsDeduplicatedAway: 0,
      error: undefined,
      warnings: [],
    });
    const failed = (id: SourceId, n: number): SearchImportSourceReport => ({
      ...ok(id, n),
      error: {
        code: "UPSTREAM_SERVER",
        messageKey: "rh-error-upstream",
        detail: "x",
        retryable: true,
      },
    });

    expect(fetchStateFromReports([])).toBe("succeeded");
    expect(fetchStateFromReports([ok("pubmed", 3)])).toBe("succeeded");
    expect(fetchStateFromReports([ok("pubmed", 0)])).toBe("succeeded");
    expect(fetchStateFromReports([failed("pubmed", 0)])).toBe("failed");
    expect(
      fetchStateFromReports([failed("pubmed", 0), failed("crossref", 0)]),
    ).toBe("failed");
    // Degraded, not failed: it yielded before it threw.
    expect(fetchStateFromReports([failed("pubmed", 2)])).toBe("partial");
    expect(
      fetchStateFromReports([failed("pubmed", 0), ok("crossref", 2)]),
    ).toBe("partial");
    // The documented divergence from `outcomeFromReports`: a healthy source
    // that found nothing still succeeded, so §12.1's "all sources failed" is
    // false.
    expect(
      fetchStateFromReports([failed("pubmed", 0), ok("crossref", 0)]),
    ).toBe("partial");
  });
});

// ===========================================================================
// 3. The 20 s per-source deadline — criterion 3, NFR-2
// ===========================================================================

describe("the per-source deadline (criterion 3, NFR-2)", () => {
  it("defaults to NFR-2's 20 s", () => {
    expect(PER_SOURCE_TIMEOUT_MS).toBe(20_000);
  });

  it("cuts a source that never responds at 20 s while the other three complete", async () => {
    const hung = fakeSource({ id: "crossref", then: { kind: "hang" } });
    const a = fakeSource({ id: "pubmed", yields: [record("pubmed", "1")] });
    const b = fakeSource({
      id: "europepmc",
      yields: [record("europepmc", "2")],
    });
    const c = fakeSource({ id: "arxiv", yields: [record("arxiv", "3")] });
    const h = harness([a.source, hung.source, b.source, c.source]);

    const run = fanOut(h.options);
    const pending = watch(run);
    await settle();

    // The three healthy sources have finished; the fan-out is waiting on the
    // fourth, and exactly one deadline timer is armed.
    expect(a.log.settled + b.log.settled + c.log.settled).toBe(3);
    expect(pending.settled()).toBe(false);
    expect(h.clock.pending).toBe(1);

    // 19.999 s: still waiting.
    h.clock.advance(19_999);
    await settle();
    expect(pending.settled()).toBe(false);

    // 20 s: cut.
    h.clock.advance(1);
    const result = await run;

    expect(result.state).toBe("partial");
    expect(result.records.map((r) => r.id)).toEqual([
      "pubmed:1",
      "europepmc:2",
      "arxiv:3",
    ]);
    expect(result.perSource[1]).toMatchObject({
      sourceId: "crossref",
      recordsRetrieved: 0,
      error: { code: "TIMEOUT", retryable: true },
    });
    expect(result.perSource[1]?.error?.detail).toContain("20000");
    expect(result.warnings).toEqual([
      expect.stringMatching(/^crossref: TIMEOUT/),
    ]);
    // The timed-out source's *own* token was cancelled with the timeout reason
    // — that is what aborts its in-flight request — and it settled.
    expect(hung.log.cancelReasons).toEqual([{ kind: "timeout", ms: 20_000 }]);
    expect(hung.log.settled).toBe(1);
    // The healthy sources' reports are untouched by the neighbour's timeout.
    expect(result.perSource[0]).toMatchObject(healthyReport("pubmed", 1));
    expect(result.perSource[2]).toMatchObject(healthyReport("europepmc", 1));
    expect(result.perSource[3]).toMatchObject(healthyReport("arxiv", 1));
    // No timer left behind.
    expect(h.clock.pending).toBe(0);
  });

  it("keeps the records a source yielded before its deadline", async () => {
    const slow = fakeSource({
      id: "pubmed",
      yields: [record("pubmed", "1"), record("pubmed", "2")],
      then: { kind: "hang" },
    });
    const h = harness([slow.source], { perSourceTimeoutMs: 5_000 });

    const run = fanOut(h.options);
    await settle();
    h.clock.advance(5_000);
    const result = await run;

    expect(result.records.map((r) => r.id)).toEqual(["pubmed:1", "pubmed:2"]);
    expect(result.perSource[0]).toMatchObject({
      recordsRetrieved: 2,
      error: { code: "TIMEOUT" },
    });
    expect(result.state).toBe("partial");
    expect(slow.log.cancelReasons).toEqual([{ kind: "timeout", ms: 5_000 }]);
  });

  it("stops waiting at the deadline even for an adapter that ignores its token", async () => {
    const stubborn = fakeSource({
      id: "crossref",
      then: { kind: "hang-ignoring-token" },
    });
    const ok = fakeSource({ id: "pubmed", yields: [record("pubmed", "1")] });
    const h = harness([stubborn.source, ok.source]);

    const run = fanOut(h.options);
    await settle();
    h.clock.advance(PER_SOURCE_TIMEOUT_MS);
    const result = await run;

    expect(result.perSource[0]?.error?.code).toBe("TIMEOUT");
    expect(result.perSource[1]).toMatchObject(healthyReport("pubmed", 1));
    // The adapter never settled — it is still hung — and the fan-out did not
    // wait for it.
    expect(stubborn.log.settled).toBe(0);
    // Its pool permit was released at the deadline, not held by the hung
    // adapter: the `TimeoutError` leaves `Semaphore.run` through its `finally`.
    expect(h.options.pool.available).toBe(NETWORK_METADATA_POOL_SIZE);
    expect(h.options.pool.waiting).toBe(0);
  });

  it("disarms the deadline when the source finishes first", async () => {
    const quick = fakeSource({ id: "pubmed", yields: [record("pubmed", "1")] });
    const h = harness([quick.source]);

    await fanOut(h.options);

    expect(h.clock.pending).toBe(0);
    // And advancing past the deadline afterwards changes nothing: no late
    // cancellation reaches a source that already finished.
    h.clock.advance(PER_SOURCE_TIMEOUT_MS + 1);
    await settle();
    expect(quick.log.cancelReasons).toEqual([]);
  });

  it("times each source from when it starts, not from when it is dispatched", async () => {
    // Pool of 1: the second source is parked for the whole of the first's
    // 20 s. If the clock were started at dispatch, it would be cut the instant
    // it was admitted.
    const first = fakeSource({ id: "pubmed", then: { kind: "hang" } });
    const second = fakeSource({
      id: "crossref",
      yields: [record("crossref", "9")],
    });
    const h = harness([first.source, second.source], {
      pool: new Semaphore(1),
    });

    const run = fanOut(h.options);
    await settle();
    expect(second.log.started).toBe(0);

    h.clock.advance(PER_SOURCE_TIMEOUT_MS);
    const result = await run;

    expect(result.perSource[0]?.error?.code).toBe("TIMEOUT");
    expect(result.perSource[1]).toMatchObject(healthyReport("crossref", 1));
    expect(second.log.started).toBe(1);
  });
});

// ===========================================================================
// 4. Cancellation — criterion 4, FR-10
// ===========================================================================

describe("cancelling mid-fan-out (criterion 4, FR-10)", () => {
  it("settles every in-flight adapter promise, then throws the run's cancellation", async () => {
    const sources = (["pubmed", "crossref", "europepmc"] as const).map((id) =>
      fakeSource({ id, then: { kind: "hang" } }),
    );
    // One adapter settles late — 20 ms of real time after the cancel — so a
    // fan-out that reported the cancel before every promise had settled is
    // caught here.
    const late = fakeSource({
      id: "arxiv",
      then: { kind: "hang-then-late-reject", delayMs: 20 },
    });
    const all = [...sources, late];
    const h = harness(all.map((s) => s.source));

    const run = fanOut(h.options);
    await settle();
    expect(all.every((s) => s.log.started === 1)).toBe(true);

    const startedAt = Date.now();
    h.cancel.cancel({ kind: "user" });
    await expect(run).rejects.toBeInstanceOf(OperationCancelledError);
    await expect(run).rejects.toMatchObject({ reason: { kind: "user" } });
    const elapsedMs = Date.now() - startedAt;

    // FR-10: within 2 s. With cooperative doubles this is a formality — the
    // 2 s budget is really the HTTP layer's `cancellerReceiver` — but it is
    // the criterion as written, so it is asserted.
    expect(elapsedMs).toBeLessThan(2_000);
    // Every adapter saw the *run's* reason, through its own linked token.
    for (const s of all) {
      expect(s.log.cancelReasons).toEqual([{ kind: "user" }]);
      expect(s.log.settled).toBe(1);
    }
    // Every deadline was disarmed on the way out.
    expect(h.clock.pending).toBe(0);
    // A cancelled source is not a failed source: nothing was logged as a
    // source failure. (The reporter tree cannot witness this — its token hook
    // has already marked it `done("cancelled")`, so a banner raised now would
    // be dropped silently; the log is the surface that can.)
    expect(h.logs.filter((line) => line.includes("a source failed"))).toEqual(
      [],
    );
  });

  it("stops consuming an adapter that ignores its token at its next record after a cancel", async () => {
    // §7.4 check point 1, at the record: the fan-out's own check is what ends
    // this adapter's consumption, because the adapter never checks for itself.
    const gate = createDeferred<void>();
    const stubborn = fakeSource({
      id: "pubmed",
      yields: [record("pubmed", "1")],
      then: {
        kind: "gate-then-yield-forever",
        gate: gate.promise,
        extra: record("pubmed", "2"),
      },
    });
    const h = harness([stubborn.source]);

    const run = fanOut(h.options);
    await settle();
    h.cancel.cancel({ kind: "user" });
    await settle();
    // The adapter is parked on its gate and has seen nothing; the fan-out is
    // still waiting on it.
    const pending = watch(run);
    expect(pending.settled()).toBe(false);

    // The adapter wakes and yields one more record. The fan-out's per-record
    // check turns that into the cancellation instead of consuming on into the
    // adapter's endless tail.
    gate.resolve();
    await expect(run).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("releases a source still parked behind the pool, which never starts", async () => {
    const running = [
      fakeSource({ id: "pubmed", then: { kind: "hang" } }),
      fakeSource({ id: "crossref", then: { kind: "hang" } }),
    ];
    const parked = [
      fakeSource({ id: "europepmc", yields: [record("europepmc", "1")] }),
      fakeSource({ id: "arxiv", yields: [record("arxiv", "2")] }),
    ];
    const h = harness(
      [...running, ...parked].map((s) => s.source),
      { pool: new Semaphore(2) },
    );

    const run = fanOut(h.options);
    await settle();
    expect(running.map((s) => s.log.started)).toEqual([1, 1]);
    expect(parked.map((s) => s.log.started)).toEqual([0, 0]);
    expect(h.options.pool.waiting).toBe(2);

    h.cancel.cancel({ kind: "user" });
    await expect(run).rejects.toBeInstanceOf(OperationCancelledError);

    expect(parked.map((s) => s.log.started)).toEqual([0, 0]);
    expect(h.options.pool.waiting).toBe(0);
    expect(h.options.pool.available).toBe(2);
  });

  it("does not let a cancelled source look like a failed source", async () => {
    // This adapter throws a *typed upstream error* when its token is
    // cancelled — the shape a real adapter has when an abort surfaces as a
    // transport failure. The run's cancel must still win.
    const misreporting = fakeSource({
      id: "pubmed",
      then: { kind: "hang-misreporting" },
    });
    const h = harness([misreporting.source]);
    const run = fanOut(h.options);
    await settle();

    h.cancel.cancel({ kind: "shutdown" });
    await expect(run).rejects.toBeInstanceOf(OperationCancelledError);
    await expect(run).rejects.toMatchObject({ reason: { kind: "shutdown" } });
    expect(misreporting.log.cancelReasons).toEqual([{ kind: "shutdown" }]);
  });

  it("an already-cancelled token asks no source", async () => {
    const s = fakeSource({ id: "pubmed", yields: [record("pubmed", "1")] });
    const h = harness([s.source]);
    h.cancel.cancel({ kind: "user" });

    await expect(fanOut(h.options)).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
    expect(s.log.started).toBe(0);
  });
});

// ===========================================================================
// 5. The pool, the order, and the query each source is asked
// ===========================================================================

describe("the network-metadata pool and result order", () => {
  it("declares docs/07 §7.2's pool size", () => {
    expect(NETWORK_METADATA_POOL_SIZE).toBe(4);
  });

  it("runs at most `pool.permits` sources at once and still finishes all of them", async () => {
    const gates = Array.from({ length: 5 }, () => createDeferred<void>());
    const ids = [
      "pubmed",
      "crossref",
      "europepmc",
      "arxiv",
      "biorxiv",
    ] as const;
    const fakes = ids.map((id, i) =>
      fakeSource({
        id,
        yields: [record(id, String(i + 1))],
        then: { kind: "gate", gate: gates[i]?.promise ?? Promise.resolve() },
      }),
    );
    const pool = new Semaphore(2);
    const h = harness(
      fakes.map((f) => f.source),
      { pool },
    );

    const run = fanOut(h.options);
    await settle();

    // Two in flight, three parked; the pool is what bounds it.
    expect(fakes.map((f) => f.log.started)).toEqual([1, 1, 0, 0, 0]);
    expect(pool.available).toBe(0);
    expect(pool.waiting).toBe(3);

    gates[0]?.resolve();
    await settle();
    expect(fakes.map((f) => f.log.started)).toEqual([1, 1, 1, 0, 0]);

    for (const gate of gates) gate.resolve();
    const result = await run;

    expect(result.state).toBe("succeeded");
    expect(result.records.map((r) => r.id)).toEqual([
      "pubmed:1",
      "crossref:2",
      "europepmc:3",
      "arxiv:4",
      "biorxiv:5",
    ]);
    expect(pool.available).toBe(2);
  });

  it("returns records and reports in source order, not completion order", async () => {
    const gate = createDeferred<void>();
    const slow = fakeSource({
      id: "pubmed",
      yields: [record("pubmed", "1")],
      then: { kind: "gate", gate: gate.promise },
    });
    const fast = fakeSource({
      id: "crossref",
      yields: [record("crossref", "2")],
    });
    const h = harness([slow.source, fast.source]);

    const run = fanOut(h.options);
    await settle();
    expect(fast.log.settled).toBe(1);
    expect(slow.log.settled).toBe(0);
    gate.resolve();
    const result = await run;

    expect(result.records.map((r) => r.id)).toEqual(["pubmed:1", "crossref:2"]);
    expect(result.perSource.map((r) => r.sourceId)).toEqual([
      "pubmed",
      "crossref",
    ]);
  });

  it("passes the parsed query, the limit and server-side date bounds to a source that filters", async () => {
    const s = fakeSource({ id: "pubmed", dateFilter: true });
    const window = recencyWindow(3, { now: () => Date.UTC(2026, 9, 13) });
    const h = harness([s.source], {
      input: { query: "title:CRISPR", limit: 25, dateFilter: window },
    });

    const result = await fanOut(h.options);

    expect(s.log.queries).toHaveLength(1);
    expect(s.log.queries[0]).toMatchObject({
      limit: 25,
      fromDate: window.fromDate,
      toDate: window.toDate,
    });
    // The tree is `P2-T01`'s parser's, whatever shape that parser gives it —
    // asserted against the parser rather than against one spelling of its
    // output, which is in flux while `P2-T01` lands.
    expect(s.log.queries[0]?.terms).toEqual(parseUserQuery("title:CRISPR"));
    expect(result.perSource[0]).toMatchObject({
      dateFilterApplied: "server",
      requestedLimit: 25,
      transmittedQuery: s.source.explainQuery(s.log.queries[0] as SourceQuery),
    });
  });

  it("filters client-side, and records it, for a source that cannot", async () => {
    const s = fakeSource({
      id: "crossref",
      dateFilter: false,
      yields: [
        record("crossref", "1", 2026),
        record("crossref", "2", 2010),
        record("crossref", "3"),
      ],
    });
    const window = recencyWindow(3, { now: () => Date.UTC(2026, 9, 13) });
    const h = harness([s.source], {
      input: { query: "crispr", limit: 10, dateFilter: window },
    });

    const result = await fanOut(h.options);

    expect(s.log.queries[0]).not.toHaveProperty("fromDate");
    expect(result.records.map((r) => r.id)).toEqual([
      "crossref:1",
      "crossref:3",
    ]);
    expect(result.perSource[0]).toMatchObject({
      dateFilterApplied: "client",
      recordsRetrieved: 3,
      droppedOutOfWindow: 1,
      keptWithoutDate: 1,
    });
  });
});

// ===========================================================================
// 6. Page warnings reach the per-source row — card step 6
// ===========================================================================

describe("SourcePage.warnings reach the per-source status row (step 6)", () => {
  it("records an adapter's page warning on its own report, once, without failing anything", async () => {
    const warned = fakeSource({
      id: "pubmed",
      yields: [record("pubmed", "1")],
      pageWarnings: ["PubMed paginates only the first 9999 records"],
    });
    const quiet = fakeSource({
      id: "crossref",
      yields: [record("crossref", "2")],
    });
    const h = harness([warned.source, quiet.source]);

    const result = await fanOut(h.options);

    expect(result.state).toBe("succeeded");
    expect(result.perSource[0]?.warnings).toEqual([
      "PubMed paginates only the first 9999 records",
    ]);
    expect(result.perSource[0]?.error).toBeUndefined();
    expect(result.perSource[1]?.warnings).toEqual([]);
    // Not repeated at run level — it travelled through the reporter tree once.
    expect(result.warnings).toEqual([]);
    expect(h.root.snapshot.warnings).toEqual([
      "PubMed paginates only the first 9999 records",
    ]);
  });

  it("a failed source's row carries its page warnings and then its banner", async () => {
    const s = fakeSource({
      id: "pubmed",
      pageWarnings: ["truncated"],
      then: { kind: "throw", error: new UpstreamServerError(500, "x") },
    });
    const h = harness([s.source]);

    const result = await fanOut(h.options);

    expect(result.perSource[0]?.warnings).toEqual([
      "truncated",
      expect.stringMatching(/^pubmed: UPSTREAM_SERVER/),
    ]);
    expect(h.root.snapshot.warnings).toEqual([
      "truncated",
      expect.stringMatching(/^pubmed: UPSTREAM_SERVER/),
    ]);
  });
});

// ===========================================================================
// 7. Hygiene
// ===========================================================================

describe("hygiene", () => {
  it("asks nothing and succeeds for an empty source list", async () => {
    const h = harness([]);
    const result = await fanOut(h.options);
    expect(result).toEqual({
      records: [],
      perSource: [],
      warnings: [],
      state: "succeeded",
    });
  });

  it("gives each source a child reporter under the stage", async () => {
    const seen: ProgressReporter[] = [];
    const s = fakeSource({ id: "pubmed", yields: [record("pubmed", "1")] });
    const spying: LiteratureSource = {
      ...s.source,
      async *searchAll(query: SourceQuery, ctx: SourceCallContext) {
        if (ctx.progress !== undefined) seen.push(ctx.progress);
        yield* s.source.searchAll(query, ctx);
      },
    };
    const h = harness([spying]);

    await fanOut(h.options);

    expect(seen).toHaveLength(1);
    // The child is a node of the real tree, labelled with the source id.
    seen[0]?.setMessage("Fetching PubMed page 1 of 1");
    expect(h.root.snapshot.currentStageKey).toBe("pubmed");
  });

  it("unlinks its per-source token from the run token when done", async () => {
    let subscriptions = 0;
    const inner = createCancellationTokenSource();
    const counting: CancellationToken = {
      get isCancellationRequested() {
        return inner.token.isCancellationRequested;
      },
      get reason() {
        return inner.token.reason;
      },
      throwIfCancelled: () => inner.token.throwIfCancelled(),
      onCancelled(cb) {
        subscriptions += 1;
        const off = inner.token.onCancelled(cb);
        return () => {
          subscriptions -= 1;
          off();
        };
      },
      get signal() {
        return inner.token.signal;
      },
    };
    const s = fakeSource({ id: "pubmed", yields: [record("pubmed", "1")] });
    const h = harness([s.source], { token: counting });

    await fanOut(h.options);

    // Every subscription `fanOut` took on the run token was dropped — a live
    // closure on a finished job is `docs/01` §12 gotcha 10.
    expect(subscriptions).toBe(0);
  });
});
