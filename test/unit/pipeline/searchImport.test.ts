import { describe, expect, it } from "vitest";

import { createManualClock, type Clock } from "../../../src/core/clock";
import {
  OperationCancelledError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import {
  createCancellationTokenSource,
  type CancellationToken,
} from "../../../src/core/jobQueue/cancellation";
import {
  CompositeProgressReporter,
  createObservableProgressSink,
  type ObservableProgressSink,
  type ProgressSnapshot,
} from "../../../src/core/jobQueue/progress";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import {
  normalizeDoi,
  normalizePmid,
  type SourceId,
} from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  createPipelineRegistry,
  registerPipelines,
} from "../../../src/pipeline/registry";
import {
  createSearchImportPipeline,
  liftToCanonicalWorks,
  outcomeFromReports,
  PARTIAL_IMPORT_NOTE_PREFIX,
  SEARCH_IMPORT_VALIDATION_KEYS,
  validateSearchImportInput,
} from "../../../src/pipeline/searchImport/searchImportPipeline";
import {
  SEARCH_IMPORT_STAGE_KEYS,
  SEARCH_IMPORT_STAGES,
} from "../../../src/pipeline/searchImport/stages";
import type {
  SearchImportBatchResult,
  SearchImportInput,
  SearchImportSourceReport,
  SearchImportTarget,
  SearchImportWriteSession,
  SearchImportWriter,
} from "../../../src/pipeline/searchImport/types";
import {
  stageSlices,
  type PipelineContext,
  type StageDescriptor,
} from "../../../src/pipeline/types";
import { createPubmedRecordMapper } from "../../../src/sources/pubmed/mapper";
import { createPubmedSource } from "../../../src/sources/pubmed/pubmedSource";
import { createSourceRegistry } from "../../../src/sources/registry";
import { recencyWindow } from "../../../src/sources/shared/recency";
import type {
  LiteratureSource,
  SourceCallContext,
  SourceCapabilities,
  SourceQuery,
} from "../../../src/sources/types";

/**
 * `P1-T16`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network**.
 *
 * ## What runs against real modules, and what against doubles
 *
 * This matters more here than on any previous card, because a pipeline test that
 * stubs every stage asserts the wiring diagram and nothing else. So:
 *
 * **Real, in the fetch half.** The "end to end" block below wires the real
 * `createPubmedSource`, the real `createPubmedRecordMapper`, the real
 * `createHttpClient` (with its real `User-Agent`, timeout and limiter seams) and
 * the real pipeline over a **transport** that returns real-shaped `esearch` JSON
 * and `efetch` XML. Nothing between the `SourceQuery` the pipeline builds and
 * the `CanonicalWork` it hands the writer is a test double: the query is rendered
 * by `P1-T08`'s builder, the response is parsed by `P1-T09`'s validator, the XML
 * is mapped by `P1-T10`'s mapper, and the records are lifted by `Merging`. The
 * only substitution is the two bytes-on-the-wire boundaries — the HTTP transport
 * and the XML parser, which Node has no `DOMParser` for.
 *
 * **Real, everywhere.** `CompositeProgressReporter` and its observable sink, so
 * every progress assertion is against the tree `P1-T15` shipped rather than
 * against a recording mock; `createCancellationTokenSource`, so cancellation is
 * the real cooperative token; `createSourceRegistry`,
 * `createPipelineRegistry` / `registerPipelines`; `createLogger`;
 * `createManualClock`; `recencyWindow`, `resolveDateFilterMode` and
 * `applyClientRecencyFilter`.
 *
 * **A double, deliberately.** The Zotero write surface
 * ({@link SearchImportWriter}). `src/zotero/importer.ts` reaches `Zotero.DB`,
 * `Zotero.Schema` and `Zotero.Items`, and `docs/13` §2.1 says that a unit test
 * wanting a richer Zotero fake is a signal the code belongs in an integration
 * test. `test/integration/zotero/importer.spec.ts` already covers the real
 * writer; what is under test *here* is the ordering, the cancellation points and
 * the counting, which are the pipeline's and not Zotero's.
 *
 * **A double where the point is to control failure.** Sources that throw on a
 * chosen page, that yield no records, or that declare `dateFilter: false`. A real
 * PubMed adapter cannot be made to fail on page 2 without a transport script that
 * would itself be the double, one layer further down.
 *
 * ## Which assertions would survive replacing a real stage with a stub
 *
 * Stated explicitly, because it is the honest question about a pipeline test:
 *
 * - **Would survive** (they are about the pipeline's own logic): every stage
 *   ordering, cancellation and counting assertion; the weight arithmetic; the
 *   outcome table; `validate()`; `selectedRecordIds`.
 * - **Would not survive** (they fail the moment a real stage is swapped for a
 *   stub): the `esearch`/`efetch` URLs the real adapter issues, the PMIDs and
 *   titles that come out of the real mapper, `workKey` being `pmid:…` because
 *   `buildWorkKey` put it there, and the progress snapshots' numeric `fraction`
 *   values, which are produced by the real reporter's slice arithmetic.
 */

// ===========================================================================
// Harness
// ===========================================================================

/** A reporter plus the stream its snapshots land on. */
interface Progress {
  readonly reporter: CompositeProgressReporter;
  readonly events: ObservableProgressSink;
  readonly snapshots: ProgressSnapshot[];
}

function createProgress(clock: Clock, token?: CancellationToken): Progress {
  const events = createObservableProgressSink();
  const snapshots: ProgressSnapshot[] = [];
  const reporter = new CompositeProgressReporter({
    clock,
    sinks: [events, { update: (s) => void snapshots.push(s) }],
    // The leading-edge throttle would drop intermediate paints
    // (`PROGRESS_REPAINT_INTERVAL_MS` is 250 ms and the manual clock does not
    // advance), so it is disabled: this test wants every transition, not a
    // repaint budget, and `P1-T15`'s own suite owns the throttle.
    throttleMs: 0,
    ...(token !== undefined && { token }),
  });
  return { reporter, events, snapshots };
}

/** A `PipelineContext` whose seven unbuilt members are `undefined`, as shipped. */
function createContext(options: {
  readonly clock: Clock;
  readonly token: CancellationToken;
  readonly progress: CompositeProgressReporter;
  readonly sources: ReturnType<typeof createSourceRegistry>;
  readonly checkpoints?: unknown[];
}): PipelineContext {
  return {
    jobId: "test-job",
    token: options.token,
    progress: options.progress,
    logger: createLogger({ sink: NULL_LOG_SINK, clock: options.clock }),
    clock: options.clock,
    sources: options.sources,
    cache: undefined,
    budget: undefined,
    llm: undefined,
    tts: undefined,
    zotero: undefined,
    config: undefined,
    privacy: undefined,
    checkpoint: (state: unknown): Promise<void> => {
      options.checkpoints?.push(state);
      return Promise.resolve();
    },
    resumeState: undefined,
  };
}

const CAPABILITIES: SourceCapabilities = {
  keywordSearch: true,
  relatedByWork: false,
  lookupById: [],
  abstractsInSearch: true,
  citationGraph: false,
  dateFilter: true,
  maxPageSize: 2,
  maxTotalResults: undefined,
  benefitsFromApiKey: false,
};

/**
 * One record, with just enough of `CanonicalWork` to be liftable.
 *
 * The identifiers go through `normalizePmid` / `normalizeDoi` rather than being
 * cast: `ExternalIds` declares both as branded strings, and `buildWorkKey`'s own
 * doc says to normalize *before* populating them, "because a case-variant DOI
 * here would produce a key that no later read reproduces". A cast would make the
 * `workKey` assertions below prove nothing about the real path.
 */
function record(
  sourceId: SourceId,
  nativeId: string,
  overrides: {
    readonly abstract?: string;
    readonly year?: number;
    readonly doi?: string;
  } = {},
): SourceRecord {
  const pmid = normalizePmid(nativeId);
  const doi = overrides.doi === undefined ? null : normalizeDoi(overrides.doi);
  return {
    id: `${sourceId}:${nativeId}`,
    sourceId,
    nativeId,
    work: {
      ids: {
        ...(doi !== null && { doi }),
        ...(pmid !== null && { pmid }),
      },
      type: "journal-article",
      title: `Title ${nativeId}`,
      authors: [{ family: "Lee", given: "A" }],
      ...(overrides.abstract !== undefined && { abstract: overrides.abstract }),
      ...(overrides.year !== undefined && {
        publishedDate: {
          year: overrides.year,
          iso: String(overrides.year),
        },
      }),
    },
    retrievedAtEpochMs: 1,
    missingFields: [],
  };
}

/** What {@link stubSource} was asked to do. */
interface StubSourceOptions {
  readonly id: SourceId;
  /** One array per page. `searchAll` yields each page's records in order. */
  readonly pages: readonly (readonly SourceRecord[])[];
  /** Throw instead of yielding this page (0-based). */
  readonly throwOnPage?: number;
  readonly error?: Error;
  readonly dateFilter?: boolean;
  /** Yield this many records, then wait for `gate` before the next. */
  readonly gateAfter?: number;
  readonly gate?: () => void;
}

/** A `LiteratureSource` that can be made to fail on a chosen page. */
function stubSource(options: StubSourceOptions): LiteratureSource {
  const seen: SourceQuery[] = [];
  return {
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
      seen.push(query);
      let emitted = 0;
      for (const [index, page] of options.pages.entries()) {
        ctx.token.throwIfCancelled();
        if (index === options.throwOnPage) {
          throw (
            options.error ??
            new UpstreamServerError(500, `upstream ${options.id} exploded`)
          );
        }
        for (const item of page) {
          yield item;
          emitted += 1;
          if (emitted === options.gateAfter) options.gate?.();
        }
      }
    },
    explainQuery: (query: SourceQuery) =>
      `${options.id}:${JSON.stringify(query.terms)}`,
  };
}

/** What a run's writer did, in order. */
interface WriterLog {
  readonly opened: SearchImportTarget[];
  readonly batches: readonly CanonicalWork[][];
  readonly notes: string[];
}

interface StubWriterOptions {
  /** Throw from `openTarget`. */
  readonly failOpen?: Error;
  /** Throw from the Nth `writeBatch` (0-based). */
  readonly failBatch?: number;
  /**
   * Called **after** batch `index` has been written; may cancel the run.
   *
   * After rather than before, and the session deliberately does **not** check
   * its own token, so that the only thing standing between a cancel and the next
   * batch is the pipeline's own `throwIfCancelled()`. A writer that checks for
   * itself — and both the real `importWorks` and an earlier version of this stub
   * do — masks the pipeline's check completely: measured, removing
   * `ctx.token.throwIfCancelled()` from the write loop then broke **no** test.
   * The thing under test here is the pipeline's §7.4 checkpoint, so the double
   * must not also provide it.
   */
  readonly afterBatch?: (index: number) => void;
  /** Called after the collection is resolved, before the first batch. */
  readonly afterOpen?: () => void;
  /** Throw from `notePartialImport`. */
  readonly failNote?: Error;
  readonly collectionCreated?: boolean;
}

function stubWriter(options: StubWriterOptions = {}): {
  readonly writer: SearchImportWriter;
  readonly log: WriterLog;
} {
  const log: WriterLog = { opened: [], batches: [], notes: [] };
  let batchIndex = -1;
  const writer: SearchImportWriter = {
    openTarget(
      target: SearchImportTarget,
      token: CancellationToken,
    ): Promise<SearchImportWriteSession> {
      token.throwIfCancelled();
      log.opened.push(target);
      if (options.failOpen !== undefined) throw options.failOpen;
      const session: SearchImportWriteSession = {
        libraryId: 1,
        collectionKey: "COLLKEY1",
        collectionCreated: options.collectionCreated ?? true,
        writeBatch(
          works: readonly CanonicalWork[],
          _batchToken: CancellationToken,
        ): Promise<SearchImportBatchResult> {
          batchIndex += 1;
          if (batchIndex === options.failBatch) {
            throw new UpstreamServerError(500, "write failed");
          }
          (log.batches as CanonicalWork[][]).push([...works]);
          const result = {
            created: works.length,
            linkedExisting: 0,
            skipped: 0,
            failed: 0,
            createdWithAbstract: works.filter(
              (w) => w.abstract !== undefined && w.abstract !== "",
            ).length,
          };
          // See `afterBatch`'s doc: deliberately no `throwIfCancelled()` here.
          options.afterBatch?.(batchIndex);
          return Promise.resolve(result);
        },
        notePartialImport(note: string): Promise<void> {
          if (options.failNote !== undefined) throw options.failNote;
          log.notes.push(note);
          return Promise.resolve();
        },
      };
      options.afterOpen?.();
      return Promise.resolve(session);
    },
  };
  return { writer, log };
}

const BASE_INPUT: SearchImportInput = {
  query: "crispr",
  sourceIds: ["pubmed"],
  limit: 10,
  dateFilter: "none",
};

/** Build everything one run needs. */
function harness(options: {
  readonly sources: readonly LiteratureSource[];
  readonly writer?: SearchImportWriter;
  readonly writeBatchSize?: number;
}): {
  readonly pipeline: ReturnType<typeof createSearchImportPipeline>;
  readonly ctx: PipelineContext;
  readonly progress: Progress;
  readonly clock: ReturnType<typeof createManualClock>;
  readonly source: ReturnType<typeof createCancellationTokenSource>;
  readonly checkpoints: unknown[];
} {
  const clock = createManualClock(1_000);
  const source = createCancellationTokenSource();
  const progress = createProgress(clock, source.token);
  const registry = createSourceRegistry();
  for (const s of options.sources) registry.register(s);
  const checkpoints: unknown[] = [];
  const pipeline = createSearchImportPipeline({
    writer: options.writer ?? stubWriter().writer,
    writeBatchSize: options.writeBatchSize ?? 50,
  });
  return {
    pipeline,
    progress,
    clock,
    source,
    checkpoints,
    ctx: createContext({
      clock,
      token: source.token,
      progress: progress.reporter,
      sources: registry,
      checkpoints,
    }),
  };
}

// ===========================================================================
// 1. Stage declaration and the weight → fraction conversion
// ===========================================================================

describe("stage declaration", () => {
  it("declares docs/07 §12.1's seven states, in order", () => {
    expect(SEARCH_IMPORT_STAGE_KEYS).toEqual([
      "planning",
      "fetching",
      "merging",
      "deduping",
      "backfillingAbstracts",
      "creatingCollection",
      "writingItems",
    ]);
  });

  it("weights sum to exactly 1 (criterion 5, first half)", () => {
    const sum = SEARCH_IMPORT_STAGES.reduce((t, s) => t + s.weight, 0);
    // `toBe`, not `toBeCloseTo`: this particular decimal set is exact in
    // IEEE-754, which `STAGE_WEIGHT_SUM_EPSILON`'s own comment records — and an
    // exact assertion is what notices if someone re-tunes the weights into a
    // set that is not.
    expect(sum).toBe(1);
  });

  it("gives every stage a distinct research-helper- label id", () => {
    const keys = SEARCH_IMPORT_STAGES.map((s) => s.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys)
      expect(key.startsWith("research-helper-")).toBe(true);
  });

  it("builds contiguous slices whose last `to` is exactly 1", () => {
    const slices = stageSlices(SEARCH_IMPORT_STAGES);
    expect(slices[0]?.from).toBe(0);
    expect(slices.at(-1)?.to).toBe(1);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i]?.from).toBe(slices[i - 1]?.to);
    }
  });

  it("pins the last `to` at exactly 1 for a weight set that is not exact", () => {
    // The shipped weights sum to exactly `1` in IEEE-754, so `from + weight`
    // already lands on `1` for them and a mutation that drops the `last ? 1`
    // clamp breaks nothing. Measured: this decimal set sums to
    // `1.0000000000000002`, which is inside `STAGE_WEIGHT_SUM_EPSILON` and so is
    // accepted — and whose accumulated last `to` is **not** 1. This is the
    // assertion that makes the clamp load-bearing rather than decorative, for
    // whichever later card re-tunes the weights.
    const inexact: StageDescriptor[] = [
      { key: "a", labelKey: "x", weight: 0.02 },
      { key: "b", labelKey: "x", weight: 0.55 },
      { key: "c", labelKey: "x", weight: 0.01 },
      { key: "d", labelKey: "x", weight: 0.02 },
      { key: "e", labelKey: "x", weight: 0.05 },
      { key: "f", labelKey: "x", weight: 0.02 },
      { key: "g", labelKey: "x", weight: 0.33 },
    ];
    expect(inexact.reduce((t, s) => t + s.weight, 0)).not.toBe(1);
    expect(stageSlices(inexact).at(-1)?.to).toBe(1);
  });

  it("rejects a weight list that does not sum to 1 rather than rescaling it", () => {
    const bad: StageDescriptor[] = [
      { key: "a", labelKey: "x", weight: 0.5 },
      { key: "b", labelKey: "y", weight: 0.2 },
    ];
    expect(() => stageSlices(bad)).toThrow(/sum to 0.7, not 1/);
  });

  it("rejects an empty stage list and a negative weight", () => {
    expect(() => stageSlices([])).toThrow(/at least one stage/);
    expect(() =>
      stageSlices([{ key: "a", labelKey: "x", weight: -1 }]),
    ).toThrow(/weight -1/);
  });
});

// ===========================================================================
// 2. validate() and estimate()
// ===========================================================================

describe("validate", () => {
  it("accepts a well-formed fetch input", () => {
    expect(validateSearchImportInput(BASE_INPUT)).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("rejects an empty query, no source, and a limit outside §8.5's range", () => {
    const result = validateSearchImportInput({
      ...BASE_INPUT,
      query: "   ",
      sourceIds: [],
      limit: 201,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.field)).toEqual([
      "query",
      "sourceIds",
      "limit",
    ]);
    expect(result.errors.map((e) => e.messageKey)).toEqual([
      SEARCH_IMPORT_VALIDATION_KEYS.emptyQuery,
      SEARCH_IMPORT_VALIDATION_KEYS.noSources,
      SEARCH_IMPORT_VALIDATION_KEYS.limitOutOfRange,
    ]);
  });

  it("takes the limit range from the preference schema, not from a literal", () => {
    // `docs/07` §8.5's row is 10–200, inclusive. Both ends accepted, both
    // neighbours rejected — which is what makes this an assertion about the
    // schema rather than about two numbers retyped here.
    for (const limit of [10, 200]) {
      expect(validateSearchImportInput({ ...BASE_INPUT, limit }).ok).toBe(true);
    }
    for (const limit of [9, 201, 10.5]) {
      expect(validateSearchImportInput({ ...BASE_INPUT, limit }).ok).toBe(
        false,
      );
    }
  });

  it("needs no query or source when records are supplied, but needs a target", () => {
    const records = [record("pubmed", "1")];
    expect(
      validateSearchImportInput({
        ...BASE_INPUT,
        query: "",
        sourceIds: [],
        records,
        target: { collectionName: "C" },
      }).ok,
    ).toBe(true);
    const noTarget = validateSearchImportInput({
      ...BASE_INPUT,
      query: "",
      sourceIds: [],
      records,
    });
    expect(noTarget.ok).toBe(false);
    expect(noTarget.errors[0]?.messageKey).toBe(
      SEARCH_IMPORT_VALIDATION_KEYS.noTarget,
    );
  });
});

describe("estimate", () => {
  it("counts two round trips per page and no cost", async () => {
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [] })],
    });
    // `maxPageSize` is 2 on the stub, limit 10 → 5 pages → 10 requests.
    const estimate = await h.pipeline.estimate(BASE_INPUT, h.ctx);
    expect(estimate.externalRequests).toBe(10);
    expect(estimate.itemCount).toBe(10);
    // `undefined`, not `0`: "we do not know" is not "it is free".
    expect(estimate.estimatedCostUsd).toBeUndefined();
    expect(estimate.estimatedInputTokens).toBe(0);
  });
});

// ===========================================================================
// 3. The outcome table (criteria 1 and 2)
// ===========================================================================

describe("outcomeFromReports", () => {
  const report = (
    sourceId: SourceId,
    recordsRetrieved: number,
    failed: boolean,
  ): SearchImportSourceReport => ({
    sourceId,
    transmittedQuery: "q",
    requestedLimit: 10,
    dateFilterApplied: "none",
    recordsRetrieved,
    droppedOutOfWindow: 0,
    keptWithoutDate: 0,
    recordsDeduplicatedAway: 0,
    error: failed
      ? {
          code: "UPSTREAM_SERVER",
          messageKey: "rh-error-upstream",
          detail: "x",
          retryable: true,
        }
      : undefined,
    warnings: [],
  });

  it("is `succeeded` when nothing errored", () => {
    expect(outcomeFromReports([report("pubmed", 3, false)])).toBe("succeeded");
  });

  it("is `partial` for one source that errored after yielding records", () => {
    // The one-source regression: counting any error as a failed source makes
    // this `failed` and throws page 1 away.
    expect(outcomeFromReports([report("pubmed", 2, true)])).toBe("partial");
  });

  it("is `failed` only when every source errored and nothing came back", () => {
    expect(outcomeFromReports([report("pubmed", 0, true)])).toBe("failed");
    expect(
      outcomeFromReports([
        report("pubmed", 0, true),
        report("crossref", 0, true),
      ]),
    ).toBe("failed");
    expect(
      outcomeFromReports([
        report("pubmed", 0, true),
        report("crossref", 4, false),
      ]),
    ).toBe("partial");
  });
});

describe("partial failure across sources (criterion 1, FR-9)", () => {
  it("keeps page 1, warns naming the source, and completes the import", async () => {
    const writer = stubWriter();
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [[record("pubmed", "11"), record("pubmed", "12")], []],
          throwOnPage: 1,
        }),
      ],
      writer: writer.writer,
    });

    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "Run 1" } },
      h.ctx,
    );

    // The run did **not** fail and it did import. `"partial"` rather than the
    // literal `"succeeded"` is deliberate: FR-9 requires a banner naming the
    // failed source, and an outcome of plain `"succeeded"` would give the window
    // nothing to raise it from. See this card's report.
    expect(out.outcome).toBe("partial");
    expect(out.records.map((r) => r.nativeId)).toEqual(["11", "12"]);
    expect(out.write?.created).toBe(2);
    expect(out.stageReached).toBe("writingItems");

    // Exactly one warning, and it names the source and the error class.
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("pubmed");
    expect(out.warnings[0]).toContain("UPSTREAM_SERVER");

    // The typed error survives on that source's report, which is what
    // `SourceProvenance.error` is filled from.
    expect(out.perSource).toHaveLength(1);
    expect(out.perSource[0]?.error?.code).toBe("UPSTREAM_SERVER");
    expect(out.perSource[0]?.recordsRetrieved).toBe(2);
  });

  it("keeps the other source's results when one fails outright", async () => {
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[]], throwOnPage: 0 }),
        stubSource({ id: "crossref", pages: [[record("crossref", "9")]] }),
      ],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "crossref"] },
      h.ctx,
    );
    expect(out.outcome).toBe("partial");
    expect(out.records.map((r) => r.sourceId)).toEqual(["crossref"]);
  });
});

describe("all sources failing (criterion 2)", () => {
  it("is `failed`, carries each source's typed error, and writes nothing", async () => {
    const writer = stubWriter();
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [[]],
          throwOnPage: 0,
          error: new UpstreamServerError(503, "pubmed down"),
        }),
        stubSource({
          id: "crossref",
          pages: [[]],
          throwOnPage: 0,
          error: new UpstreamServerError(500, "crossref also down"),
        }),
      ],
      writer: writer.writer,
    });

    const out = await h.pipeline.run(
      {
        ...BASE_INPUT,
        sourceIds: ["pubmed", "crossref"],
        target: { collectionName: "Never created" },
      },
      h.ctx,
    );

    expect(out.outcome).toBe("failed");
    expect(out.error?.code).toBe("SOURCE");
    expect(out.perSource.map((r) => r.sourceId)).toEqual([
      "pubmed",
      "crossref",
    ]);
    for (const report of out.perSource) {
      expect(report.error?.code).toBe("UPSTREAM_SERVER");
      expect(report.error?.httpStatus).toBeTypeOf("number");
    }
    // §12.1's `Fetching --> Failed` is checked *before* `CreatingCollection`, so
    // a run that reached no database does not leave an empty collection behind.
    expect(writer.log.opened).toEqual([]);
    expect(out.write).toBeUndefined();
  });

  it("reports a selected source with no adapter without failing the run", async () => {
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "arxiv"] },
      h.ctx,
    );
    expect(out.outcome).toBe("partial");
    expect(out.warnings.some((w) => w.includes("arxiv"))).toBe(true);
    const arxiv = out.perSource.find((r) => r.sourceId === "arxiv");
    expect(arxiv?.error?.code).toBe("CONFIGURATION");
  });
});

// ===========================================================================
// 4. Cancellation (criteria 3 and 4, docs/07 §7.4, FR-10)
// ===========================================================================

describe("cancellation during Fetching (criterion 3, FR-10)", () => {
  it("creates zero items and zero collections", async () => {
    const writer = stubWriter();
    let cancel: () => void = () => undefined;
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [
            [record("pubmed", "1"), record("pubmed", "2")],
            [record("pubmed", "3")],
          ],
          gateAfter: 1,
          gate: () => cancel(),
        }),
      ],
      writer: writer.writer,
    });
    cancel = () => h.source.cancel({ kind: "user" });

    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "Never created" } },
      h.ctx,
    );

    expect(out.outcome).toBe("cancelled");
    expect(out.cancellationKind).toBe("user");
    expect(out.stageReached).toBe("fetching");
    // FR-10, verbatim: "no items are created".
    expect(writer.log.opened).toEqual([]);
    expect(writer.log.batches).toEqual([]);
    expect(out.write).toBeUndefined();
    // And the cancelled source is **not** reported as a failed source.
    expect(out.perSource).toEqual([]);
  });

  it("does not let a cancelled source look like a failed source", async () => {
    // Two sources; the first is cancelled mid-flight. The second must not be
    // asked, and neither must be marked failed.
    let asked = 0;
    const second = stubSource({ id: "crossref", pages: [[]] });
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [[record("pubmed", "1"), record("pubmed", "2")]],
          gateAfter: 1,
          gate: () => h.source.cancel({ kind: "shutdown" }),
        }),
        {
          ...second,
          searchAll(query: SourceQuery, ctx: SourceCallContext) {
            asked += 1;
            return second.searchAll(query, ctx);
          },
        },
      ],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "crossref"] },
      h.ctx,
    );
    expect(out.outcome).toBe("cancelled");
    expect(out.cancellationKind).toBe("shutdown");
    expect(asked).toBe(0);
  });
});

describe("cancellation during WritingItems (criterion 4, docs/07 §7.4)", () => {
  it("keeps what is written, keeps the collection, and reports a count", async () => {
    const records = Array.from({ length: 5 }, (_v, i) =>
      record("pubmed", String(i + 1), { abstract: "a" }),
    );
    let cancelRun: () => void = () => undefined;
    const writer = stubWriter({
      // Cancel once batch 0 is written. The session does not check its own
      // token, so if the pipeline skips §7.4's per-batch check, batches 1 and 2
      // are written too and `created` reads 5 instead of 2.
      afterBatch: (index) => {
        if (index === 0) cancelRun();
      },
    });
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [records] })],
      writer: writer.writer,
      writeBatchSize: 2,
    });
    cancelRun = () => h.source.cancel({ kind: "user" });

    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "Kept" } },
      h.ctx,
    );

    expect(out.outcome).toBe("cancelled");
    expect(out.stageReached).toBe("writingItems");
    // Batch 0's two items are kept and the remaining three are never written.
    // Nothing is rolled back — §7.4: "deleting user-visible items on cancel is
    // surprising and destructive".
    expect(writer.log.batches).toHaveLength(1);
    expect(out.write?.created).toBe(2);
    // The collection is kept, and it carries §7.4's partial note.
    expect(out.write?.collectionKey).toBe("COLLKEY1");
    expect(out.write?.partialNoteRecorded).toBe(true);
    expect(writer.log.notes).toHaveLength(1);
    expect(writer.log.notes[0]).toContain(PARTIAL_IMPORT_NOTE_PREFIX);
    expect(writer.log.notes[0]).toContain("items created: 2");
    expect(writer.log.notes[0]).toContain("cancelled");
  });

  it("keeps the collection when the cancel lands before the first batch", async () => {
    const writer = stubWriter({
      afterOpen: () => cancelRun(),
    });
    let cancelRun: () => void = () => undefined;
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
      writer: writer.writer,
    });
    cancelRun = () => h.source.cancel({ kind: "user" });

    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "Empty but kept" } },
      h.ctx,
    );
    expect(out.outcome).toBe("cancelled");
    // The collection was created by `CreatingCollection` and is **not** removed:
    // §7.4 has no rollback for either half.
    expect(writer.log.opened).toHaveLength(1);
    expect(out.write?.created).toBe(0);
    expect(out.write?.partialNoteRecorded).toBe(true);
  });

  it("a note writer that throws does not change the outcome", async () => {
    let cancelRun: () => void = () => undefined;
    const writer = stubWriter({
      failNote: new Error("description is read-only"),
      afterBatch: (index) => {
        if (index === 0) cancelRun();
      },
    });
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [[record("pubmed", "1"), record("pubmed", "2")]],
        }),
      ],
      writer: writer.writer,
      writeBatchSize: 1,
    });
    cancelRun = () => h.source.cancel({ kind: "user" });

    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    expect(out.outcome).toBe("cancelled");
    expect(out.write?.created).toBe(1);
    expect(out.write?.partialNoteRecorded).toBe(false);
  });

  it("an already-cancelled token stops the run in Planning", async () => {
    const writer = stubWriter();
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
      writer: writer.writer,
    });
    h.source.cancel({ kind: "timeout", ms: 2000 });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    expect(out.outcome).toBe("cancelled");
    expect(out.cancellationKind).toBe("timeout");
    expect(out.stageReached).toBe("planning");
    expect(writer.log.opened).toEqual([]);
  });
});

describe("a Zotero write error (docs/07 §12.1 `WritingItems --> Failed`)", () => {
  it("fails without undoing the batch that succeeded", async () => {
    const writer = stubWriter({ failBatch: 1 });
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [
            [
              record("pubmed", "1"),
              record("pubmed", "2"),
              record("pubmed", "3"),
            ],
          ],
        }),
      ],
      writer: writer.writer,
      writeBatchSize: 1,
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    expect(out.outcome).toBe("failed");
    expect(out.error?.code).toBe("UPSTREAM_SERVER");
    expect(out.write?.created).toBe(1);
    expect(out.write?.partialNoteRecorded).toBe(true);
    expect(writer.log.notes[0]).toContain("failed");
  });
});

// ===========================================================================
// 5. The progress tree (criterion 5, second half)
// ===========================================================================

describe("the progress tree", () => {
  it("reaches exactly 100 % on success", async () => {
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    expect(out.outcome).toBe("succeeded");
    // Produced by the real `CompositeProgressReporter`'s slice arithmetic, not
    // by anything this test computes.
    expect(h.progress.events.latest?.fraction).toBe(1);
  });

  it("reaches 100 % on a preview run too, where two stages are skipped", async () => {
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
    });
    const out = await h.pipeline.run(BASE_INPUT, h.ctx);
    expect(out.outcome).toBe("succeeded");
    expect(out.write).toBeUndefined();
    expect(h.progress.events.latest?.fraction).toBe(1);
  });

  it("stops short of 100 % when the run is cancelled", async () => {
    let cancel: () => void = () => undefined;
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [[record("pubmed", "1"), record("pubmed", "2")]],
          gateAfter: 1,
          gate: () => cancel(),
        }),
      ],
    });
    cancel = () => h.source.cancel({ kind: "user" });
    await h.pipeline.run(BASE_INPUT, h.ctx);
    const fraction = h.progress.events.latest?.fraction ?? 1;
    expect(fraction).toBeLessThan(1);
  });

  it("visits every stage key in declaration order", async () => {
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
    });
    await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    const visited: string[] = [];
    for (const snapshot of h.progress.snapshots) {
      const key = snapshot.currentStageKey;
      if (key !== undefined && visited.at(-1) !== key) visited.push(key);
    }
    // The per-source child reporter is named after the source, so the fetch
    // stage shows up as `pubmed` too; the seven stage keys must all appear, in
    // their declared order, among them.
    const stageOnly = visited.filter((k) =>
      (SEARCH_IMPORT_STAGE_KEYS as readonly string[]).includes(k),
    );
    expect(stageOnly).toEqual([...SEARCH_IMPORT_STAGE_KEYS]);
  });

  it("keeps WritingItems determinate across batches (P1-T15's increment trap)", async () => {
    // `P1-T15` measured that `setProgress(completed)` with `total` omitted
    // **resets a known total to indeterminate**, because §4.1 says
    // "total === undefined means indeterminate". The trap is invisible after the
    // stage finishes — `done("succeeded")` overwrites `completed` and `fraction`
    // either way — so it has to be caught *during* the write, which is where a
    // user would see the bar go blank halfway through an import.
    const records = Array.from({ length: 5 }, (_v, i) =>
      record("pubmed", String(i + 1)),
    );
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [records] })],
      writeBatchSize: 2,
    });
    await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    const duringWrite = h.progress.snapshots.filter(
      (s) => s.currentStageKey === "writingItems",
    );
    expect(duringWrite.length).toBeGreaterThan(1);
    for (const snapshot of duringWrite) {
      expect(snapshot.total).toBeDefined();
    }
  });

  it("checkpoints at every stage boundary (§4.5), as a no-op", async () => {
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
    });
    await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    expect(h.checkpoints).toEqual(
      SEARCH_IMPORT_STAGE_KEYS.map((stage) => ({ stage })),
    );
  });
});

// ===========================================================================
// 6. Merging, Deduping and the lift
// ===========================================================================

describe("Merging lifts records to CanonicalWork", () => {
  it("mints workKey from docs/07 §5.1's algorithm and nothing else", () => {
    const works = liftToCanonicalWorks(
      [
        record("pubmed", "123", { year: 2024 }),
        record("pubmed", "456", { doi: "10.1234/x", year: 2023 }),
      ],
      7_777,
    );
    // `pmid:` when there is no DOI, `doi:` when there is — `buildWorkKey`'s
    // declared precedence, asserted through this function rather than restated.
    expect(works[0]?.workKey).toBe("pmid:123");
    expect(works[1]?.workKey).toBe("doi:10.1234/x");
    expect(works.map((w) => w.normalizedAtEpochMs)).toEqual([7_777, 7_777]);
  });

  it("records one source and claims no contested field", () => {
    const works = liftToCanonicalWorks([record("pubmed", "1")], 1);
    expect(works[0]?.provenance).toEqual({
      recordIds: ["pubmed:1"],
      // Empty on purpose: §5.1 defines it as "which source won for each
      // contested field", and with one source nothing was contested.
      fieldOrigin: {},
      seenIn: ["pubmed"],
    });
  });

  it("keeps records and works positionally aligned", async () => {
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [[record("pubmed", "1"), record("pubmed", "2")]],
        }),
      ],
    });
    const out = await h.pipeline.run(BASE_INPUT, h.ctx);
    expect(out.works.map((w) => w.workKey)).toEqual(["pmid:1", "pmid:2"]);
    expect(out.records.map((r) => r.nativeId)).toEqual(["1", "2"]);
  });

  it("Deduping removes nothing in Phase 1 and records 0 (docs/07 §5.3)", async () => {
    // Two records for the same work. Phase 1 must keep both — `P1-T16`'s
    // `Do NOT` and `R-18`: a false merge is the expensive error.
    const same = [
      record("pubmed", "1", { doi: "10.1234/dup" }),
      record("pubmed", "2", { doi: "10.1234/dup" }),
    ];
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [same] })],
    });
    const out = await h.pipeline.run(BASE_INPUT, h.ctx);
    expect(out.records).toHaveLength(2);
    expect(out.perSource[0]?.recordsDeduplicatedAway).toBe(0);
  });
});

// ===========================================================================
// 7. FR-3's date handling
// ===========================================================================

describe("the date filter (part of FR-3)", () => {
  it("passes server-side bounds to a source that declares dateFilter", async () => {
    const seen: SourceQuery[] = [];
    const base = stubSource({
      id: "pubmed",
      pages: [[record("pubmed", "1", { year: 2025 })]],
    });
    const h = harness({
      sources: [
        {
          ...base,
          searchAll(query: SourceQuery, ctx: SourceCallContext) {
            seen.push(query);
            return base.searchAll(query, ctx);
          },
        },
      ],
    });
    const window = recencyWindow(3, { now: () => Date.UTC(2026, 0, 1) });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, dateFilter: window },
      h.ctx,
    );
    expect(seen[0]?.fromDate).toBe(window.fromDate);
    expect(seen[0]?.toDate).toBe(window.toDate);
    expect(out.perSource[0]?.dateFilterApplied).toBe("server");
  });

  it("filters client-side, and records it, for a source that cannot", async () => {
    const window = recencyWindow(3, { now: () => Date.UTC(2026, 0, 1) });
    const seen: SourceQuery[] = [];
    const base = stubSource({
      id: "crossref",
      dateFilter: false,
      pages: [
        [
          record("crossref", "in", { year: 2025 }),
          record("crossref", "out", { year: 1999 }),
          record("crossref", "undated"),
        ],
      ],
    });
    const h = harness({
      sources: [
        {
          ...base,
          searchAll(query: SourceQuery, ctx: SourceCallContext) {
            seen.push(query);
            return base.searchAll(query, ctx);
          },
        },
      ],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["crossref"], dateFilter: window },
      h.ctx,
    );
    // §11.1 step 2's prohibition: no server-side bounds were faked.
    expect(seen[0]?.fromDate).toBeUndefined();
    expect(out.perSource[0]?.dateFilterApplied).toBe("client");
    expect(out.perSource[0]?.droppedOutOfWindow).toBe(1);
    expect(out.perSource[0]?.keptWithoutDate).toBe(1);
    expect(out.records.map((r) => r.nativeId)).toEqual(["in", "undated"]);
  });

  it("records `none` and adds no bounds when the user chose All years", async () => {
    const h = harness({
      sources: [stubSource({ id: "crossref", dateFilter: false, pages: [[]] })],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["crossref"], dateFilter: "none" },
      h.ctx,
    );
    expect(out.perSource[0]?.dateFilterApplied).toBe("none");
  });
});

// ===========================================================================
// 8. The write half's selection and batching
// ===========================================================================

describe("the write half", () => {
  it("writes exactly the checked set, in fetch order", async () => {
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [
            [
              record("pubmed", "1"),
              record("pubmed", "2"),
              record("pubmed", "3"),
            ],
          ],
        }),
      ],
    });
    const writer = stubWriter();
    const pipeline = createSearchImportPipeline({
      writer: writer.writer,
      writeBatchSize: 50,
    });
    const out = await pipeline.run(
      {
        ...BASE_INPUT,
        target: {
          collectionName: "C",
          // Out of order and with an id no record carries, both deliberately.
          selectedRecordIds: ["pubmed:3", "pubmed:1", "pubmed:999"],
        },
      },
      h.ctx,
    );
    expect(writer.log.batches[0]?.map((w) => w.workKey)).toEqual([
      "pmid:1",
      "pmid:3",
    ]);
    expect(out.write?.created).toBe(2);
  });

  it("splits into write batches of the configured size", async () => {
    const records = Array.from({ length: 5 }, (_v, i) =>
      record("pubmed", String(i + 1)),
    );
    const writer = stubWriter();
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [records] })],
      writer: writer.writer,
      writeBatchSize: 2,
    });
    await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    expect(writer.log.batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("imports supplied records without asking any source", async () => {
    let asked = 0;
    const base = stubSource({ id: "pubmed", pages: [[record("pubmed", "x")]] });
    const writer = stubWriter({ collectionCreated: false });
    const h = harness({
      sources: [
        {
          ...base,
          searchAll(query: SourceQuery, ctx: SourceCallContext) {
            asked += 1;
            return base.searchAll(query, ctx);
          },
        },
      ],
      writer: writer.writer,
    });
    const out = await h.pipeline.run(
      {
        ...BASE_INPUT,
        query: "",
        sourceIds: [],
        records: [record("pubmed", "77", { abstract: "a" })],
        target: { collectionName: "Reused" },
      },
      h.ctx,
    );
    expect(asked).toBe(0);
    expect(out.outcome).toBe("succeeded");
    expect(out.write?.created).toBe(1);
    expect(out.write?.collectionCreated).toBe(false);
    expect(out.write?.abstractCoveragePercent).toBe(100);
    expect(out.perSource).toEqual([]);
  });

  it("weights abstract coverage by created items, not by batch", async () => {
    // Batch 1: two records, neither with an abstract. Batch 2: one record with
    // one. Averaging over batches gives 50 %; weighting by items gives 33 %.
    const writer = stubWriter();
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [
            [
              record("pubmed", "1"),
              record("pubmed", "2"),
              record("pubmed", "3", { abstract: "a" }),
            ],
          ],
        }),
      ],
      writer: writer.writer,
      writeBatchSize: 2,
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    expect(out.write?.created).toBe(3);
    expect(out.write?.abstractCoveragePercent).toBe(33);
  });

  it("fails without writing when the collection cannot be created", async () => {
    const writer = stubWriter({ failOpen: new Error("no library") });
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
      writer: writer.writer,
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "C" } },
      h.ctx,
    );
    expect(out.outcome).toBe("failed");
    expect(out.error?.code).toBe("UNTYPED");
    expect(out.stageReached).toBe("creatingCollection");
    expect(writer.log.batches).toEqual([]);
    // No session was opened, so there is no write report and no partial note.
    expect(out.write).toBeUndefined();
    expect(writer.log.notes).toEqual([]);
  });

  it("rejects an invalid input in Planning and touches nothing", async () => {
    const writer = stubWriter();
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
      writer: writer.writer,
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, query: "", target: { collectionName: "C" } },
      h.ctx,
    );
    expect(out.outcome).toBe("failed");
    expect(out.stageReached).toBe("planning");
    expect(out.error?.messageKey).toBe(
      SEARCH_IMPORT_VALIDATION_KEYS.emptyQuery,
    );
    expect(writer.log.opened).toEqual([]);
  });
});

// ===========================================================================
// 9. The pipeline registry
// ===========================================================================

describe("the pipeline registry", () => {
  it("registers searchImport and refuses a second registration", () => {
    const pipeline = createSearchImportPipeline({
      writer: stubWriter().writer,
      writeBatchSize: 50,
    });
    const registry = createPipelineRegistry();
    registerPipelines(registry, { searchImport: pipeline });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("searchImport")?.displayNameKey).toBe(
      "research-helper-pipeline-search-import",
    );
    expect(registry.get("summarize")).toBeUndefined();
    expect(() => registry.register(pipeline)).toThrow(/already registered/);
  });

  it("refuses a pipeline whose own id contradicts the key it arrived under", () => {
    const pipeline = createSearchImportPipeline({
      writer: stubWriter().writer,
      writeBatchSize: 50,
    });
    const registry = createPipelineRegistry();
    expect(() =>
      registerPipelines(registry, {
        searchImport: { ...pipeline, id: "summarize" },
      }),
    ).toThrow(/reports id "summarize"/);
  });

  it("declares resumable false, because Phase 3 owns the queue", () => {
    const pipeline = createSearchImportPipeline({
      writer: stubWriter().writer,
      writeBatchSize: 50,
    });
    expect(pipeline.resumable).toBe(false);
    // `compensate` is deliberately absent: §7.4 has nothing to compensate for.
    expect(pipeline.compensate).toBeUndefined();
  });
});

// ===========================================================================
// 10. End to end against the real PubMed adapter, mapper and HTTP client
// ===========================================================================

/** A single `<PubmedArticle>` with the fields the real mapper reads. */
function articleXml(pmid: string, title: string, year: string): string {
  return [
    "<PubmedArticle><MedlineCitation>",
    `<PMID Version="1">${pmid}</PMID>`,
    "<Article><Journal>",
    "<Title>Journal of Testing</Title>",
    `<JournalIssue><PubDate><Year>${year}</Year></PubDate></JournalIssue>`,
    "</Journal>",
    `<ArticleTitle>${title}</ArticleTitle>`,
    `<Abstract><AbstractText>Abstract of ${pmid}.</AbstractText></Abstract>`,
    "<AuthorList><Author><LastName>Kim</LastName><ForeName>J</ForeName>",
    "</Author></AuthorList>",
    "</Article></MedlineCitation>",
    "<PubmedData><ArticleIdList>",
    `<ArticleId IdType="pubmed">${pmid}</ArticleId>`,
    `<ArticleId IdType="doi">10.1234/test.${pmid}</ArticleId>`,
    "</ArticleIdList></PubmedData></PubmedArticle>",
  ].join("");
}

/**
 * A small XML parser satisfying the mapper's `XmlParser` port.
 *
 * Node has no `DOMParser`, so `domParserXml` cannot run here. This handles the
 * subset the fixture above uses — elements, attributes, text — and is
 * deliberately *not* a general parser: `test/unit/sources/pubmed-mapper.test.ts`
 * owns the thorough one, and duplicating it would be a second thing to keep
 * right. Everything else in this block is the shipped module.
 */
function parseXmlForTest(xml: string): { documentElement: TestElement | null } {
  const stack: TestElement[] = [];
  let root: TestElement | null = null;
  let i = 0;
  while (i < xml.length) {
    if (xml.startsWith("<?", i)) {
      i = xml.indexOf("?>", i) + 2;
    } else if (xml.startsWith("</", i)) {
      stack.pop();
      i = xml.indexOf(">", i) + 1;
    } else if (xml[i] === "<") {
      const end = xml.indexOf(">", i);
      const inner = xml.slice(i + 1, end);
      const selfClosing = inner.endsWith("/");
      const body = selfClosing ? inner.slice(0, -1) : inner;
      const space = body.indexOf(" ");
      const name = space === -1 ? body : body.slice(0, space);
      const attrs = new Map<string, string>();
      if (space !== -1) {
        for (const match of body.slice(space).matchAll(/(\w+)="([^"]*)"/g)) {
          attrs.set(match[1] ?? "", match[2] ?? "");
        }
      }
      const element = new TestElement(name, attrs);
      stack.at(-1)?.kids.push(element);
      root ??= element;
      if (!selfClosing) stack.push(element);
      i = end + 1;
    } else {
      const next = xml.indexOf("<", i);
      const text = (next === -1 ? xml.slice(i) : xml.slice(i, next)).trim();
      if (text.length > 0) stack.at(-1)?.kids.push(text);
      i = next === -1 ? xml.length : next;
    }
  }
  return { documentElement: root };
}

class TestElement {
  readonly kids: (TestElement | string)[] = [];
  constructor(
    readonly localName: string,
    private readonly attrs: Map<string, string>,
  ) {}
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  get textContent(): string {
    return this.kids
      .map((k) => (typeof k === "string" ? k : k.textContent))
      .join("");
  }
  get children(): { length: number; item: (i: number) => TestElement | null } {
    const els = this.kids.filter(
      (k): k is TestElement => k !== null && typeof k !== "string",
    );
    return { length: els.length, item: (i) => els[i] ?? null };
  }
}

/** `Zotero.HTTP`'s five exception classes, as `instanceof` needs them. */
class StubHttpException extends Error {}
const EXCEPTIONS = {
  UnexpectedStatusException: StubHttpException as unknown as HttpExceptionClass<
    Error & { readonly xmlhttp: HttpTransportXhr }
  >,
  TimeoutException: StubHttpException as HttpExceptionClass,
  BrowserOfflineException: StubHttpException as HttpExceptionClass,
  SecurityException: StubHttpException as HttpExceptionClass,
  CancelledException: StubHttpException as HttpExceptionClass,
};

/** A resolved `XMLHttpRequest`, as the real client reads one. */
function xhr(url: string, body: string): HttpTransportXhr {
  return {
    status: 200,
    responseText: body,
    responseURL: url,
    getAllResponseHeaders: () => "Content-Type: text/plain",
  };
}

/** A transport that serves the two E-utilities endpoints and records the URLs. */
function eutilsTransport(pmids: readonly string[]): {
  readonly transport: HttpTransport;
  readonly urls: string[];
} {
  const urls: string[] = [];
  const transport: HttpTransport = {
    ...EXCEPTIONS,
    request(
      _method: string,
      url: string,
      _options: HttpTransportOptions,
    ): Promise<HttpTransportXhr> {
      urls.push(url);
      const body = url.includes("esearch.fcgi")
        ? JSON.stringify({
            header: { type: "esearch", version: "0.3" },
            esearchresult: {
              count: "2",
              retmax: String(pmids.length),
              retstart: "0",
              idlist: [...pmids],
              querytranslation: '"crispr"[All Fields]',
              translationset: [{ from: "crispr", to: '"crispr"[All Fields]' }],
            },
          })
        : `<?xml version="1.0"?><PubmedArticleSet>${pmids
            .map((pmid, index) =>
              articleXml(pmid, `Paper ${String(index + 1)}`, "2025"),
            )
            .join("")}</PubmedArticleSet>`;
      return Promise.resolve(xhr(url, body));
    },
  };
  return { transport, urls };
}

describe("end to end over the real PubMed adapter, mapper and HTTP client", () => {
  function realHarness(pmids: readonly string[]): {
    readonly run: () => Promise<
      Awaited<ReturnType<ReturnType<typeof createSearchImportPipeline>["run"]>>
    >;
    readonly urls: string[];
    readonly writerLog: WriterLog;
    readonly progress: Progress;
  } {
    const clock = createManualClock(1_700_000_000_000);
    const { transport, urls } = eutilsTransport(pmids);
    const http: HttpClient = createHttpClient({
      transport,
      userAgent: "research_helper/0.0.2 (+https://example.org)",
      timeoutMs: () => 60_000,
      clock,
      logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    });
    const sources = createSourceRegistry();
    sources.register(
      createPubmedSource({
        http,
        clock,
        // The real `P1-T10` mapper, with only the XML parse substituted.
        mapRecords: createPubmedRecordMapper({
          clock,
          parseXml: parseXmlForTest,
        }),
      }),
    );
    const writer = stubWriter();
    const tokenSource = createCancellationTokenSource();
    const progress = createProgress(clock, tokenSource.token);
    const pipeline = createSearchImportPipeline({
      writer: writer.writer,
      writeBatchSize: 50,
    });
    const ctx = createContext({
      clock,
      token: tokenSource.token,
      progress: progress.reporter,
      sources,
    });
    return {
      urls,
      writerLog: writer.log,
      progress,
      run: () =>
        pipeline.run(
          {
            query: "crispr",
            sourceIds: ["pubmed"],
            limit: 10,
            dateFilter: "none",
            target: { collectionName: "CRISPR 2025" },
          },
          ctx,
        ),
    };
  }

  it("goes from a typed query to CanonicalWorks handed to the writer", async () => {
    const h = realHarness(["40000001", "40000002"]);
    const out = await h.run();

    expect(out.outcome).toBe("succeeded");
    // Two real round trips, in the real order, at the real endpoints.
    expect(h.urls).toHaveLength(2);
    expect(h.urls[0]).toContain(
      "eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
    );
    expect(h.urls[1]).toContain(
      "eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
    );
    // The real query builder rendered the user's text; nothing here spells it.
    expect(h.urls[0]).toContain("term=crispr");
    expect(h.urls[0]).toContain("retmode=json");
    // No key was configured, so none was sent — the unkeyed path `docs/02` §3.1
    // documents, and the thing NFR-16 cares about.
    expect(h.urls.some((u) => u.includes("api_key"))).toBe(false);
    // The PMIDs reaching `efetch` are the ones `esearch` returned.
    expect(h.urls[1]).toContain("40000001");

    // The real mapper's output, lifted by the real `Merging` stage.
    expect(out.records.map((r) => r.nativeId)).toEqual([
      "40000001",
      "40000002",
    ]);
    expect(out.works.map((w) => w.workKey)).toEqual([
      "doi:10.1234/test.40000001",
      "doi:10.1234/test.40000002",
    ]);
    expect(out.works[0]?.title).toBe("Paper 1");
    expect(out.works[0]?.abstract).toBe("Abstract of 40000001.");
    expect(out.works[0]?.authors[0]?.family).toBe("Kim");

    // And they were handed to the writer as one batch, with the counts the run
    // reports.
    expect(h.writerLog.batches).toHaveLength(1);
    expect(h.writerLog.batches[0]?.map((w) => w.workKey)).toEqual(
      out.works.map((w) => w.workKey),
    );
    expect(out.write?.created).toBe(2);
    expect(out.write?.abstractCoveragePercent).toBe(100);
    expect(h.progress.events.latest?.fraction).toBe(1);

    // §4.2's `explainQuery` is what fills `SourceProvenance.transmittedQuery`,
    // and it is PubMed's own syntax rather than the user's text.
    expect(out.perSource[0]?.transmittedQuery).toContain("crispr");
    expect(out.perSource[0]?.recordsRetrieved).toBe(2);
    // PubMed declares server-side date filtering, and "All years" was asked for.
    expect(out.perSource[0]?.dateFilterApplied).toBe("none");
  });

  it("the real adapter's cancellation path reports `cancelled`, not `failed`", async () => {
    const clock = createManualClock(1);
    const tokenSource = createCancellationTokenSource();
    const transport: HttpTransport = {
      ...EXCEPTIONS,
      request(): Promise<HttpTransportXhr> {
        // Cancel while the request is in flight, which is where FR-10's
        // two-second budget actually bites, and let the real client's token
        // wiring surface it.
        tokenSource.cancel({ kind: "user" });
        return Promise.reject(new OperationCancelledError({ kind: "user" }));
      },
    };
    const http = createHttpClient({
      transport,
      userAgent: "research_helper/0.0.2 (+https://example.org)",
      timeoutMs: () => 1_000,
      clock,
      logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    });
    const sources = createSourceRegistry();
    sources.register(
      createPubmedSource({
        http,
        clock,
        mapRecords: createPubmedRecordMapper({
          clock,
          parseXml: parseXmlForTest,
        }),
      }),
    );
    const writer = stubWriter();
    const progress = createProgress(clock, tokenSource.token);
    const out = await createSearchImportPipeline({
      writer: writer.writer,
      writeBatchSize: 50,
    }).run(
      {
        query: "crispr",
        sourceIds: ["pubmed"],
        limit: 10,
        dateFilter: "none",
        target: { collectionName: "Never created" },
      },
      createContext({
        clock,
        token: tokenSource.token,
        progress: progress.reporter,
        sources,
      }),
    );

    expect(out.outcome).toBe("cancelled");
    expect(out.perSource).toEqual([]);
    expect(writer.log.opened).toEqual([]);
  });
});
