import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { mockLLMRouter } from "../../helpers/mockLLM";
import { buildPipelineSet } from "../../../src/bootstrap/registerPipelines";
import { NO_CACHE } from "../../../src/core/cache/cache";
import { createManualClock, type Clock } from "../../../src/core/clock";
import { createDeferred, Semaphore } from "../../../src/core/concurrency";
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
import { redactSearchProvenance } from "../../../src/core/provenance";
import type { CanonicalWork, WorkType } from "../../../src/model/canonicalWork";
import {
  normalizeDoi,
  normalizePmid,
  type ExternalIds,
  type SourceId,
} from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  createPipelineRegistry,
  registerPipelines,
} from "../../../src/pipeline/registry";
import {
  createSearchImportPipeline,
  PARTIAL_IMPORT_NOTE_PREFIX,
  SEARCH_IMPORT_VALIDATION_KEYS,
  validateSearchImportInput,
} from "../../../src/pipeline/searchImport/searchImportPipeline";
import {
  dedupeAndMerge,
  dedupeAndMergeAsync,
  fetchStateFromReports,
  lookupOnlySourceIds,
  NETWORK_METADATA_POOL_SIZE,
  SEARCH_IMPORT_STAGE_KEYS,
  SEARCH_IMPORT_STAGES,
} from "../../../src/pipeline/searchImport/stages";
import type {
  SearchImportBatchResult,
  SearchImportInput,
  SearchImportOutput,
  SearchImportPathCounts,
  SearchImportSourceReport,
  SearchImportTarget,
  SearchImportWriteSession,
  SearchImportWriter,
} from "../../../src/pipeline/searchImport/types";
import {
  stageSlices,
  type Pipeline,
  type PipelineContext,
  type StageDescriptor,
} from "../../../src/pipeline/types";
import { createPubmedRecordMapper } from "../../../src/sources/pubmed/mapper";
import { createPubmedSource } from "../../../src/sources/pubmed/pubmedSource";
import { createSourceRegistry } from "../../../src/sources/registry";
import {
  DEDUP_YIELD_EVERY_COMPARISONS,
  dedupeRecords,
  TIER_CONFIDENCE,
} from "../../../src/sources/shared/dedupe";
import { recencyWindow } from "../../../src/sources/shared/recency";
import type {
  LiteratureSource,
  SourceCallContext,
  SourceCapabilities,
  SourceQuery,
} from "../../../src/sources/types";
import { buildProvenance } from "../../../src/ui/viewModels/searchImportViewModel";
import { renderProvenanceNoteHtml } from "../../../src/zotero/notes";

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
    cache: NO_CACHE,
    budget: undefined,
    llm: mockLLMRouter(),
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
    /** Defaults to `Title ${nativeId}`; the dedup fixtures share one. */
    readonly title?: string;
    readonly type?: WorkType;
    /** `CanonicalWork.relatedVersionIds` — a preprint that knows its paper. */
    readonly related?: ExternalIds;
  } = {},
): SourceRecord {
  // A non-numeric `nativeId` yields no PMID, which is how the dedup fixtures
  // below get a record with no identifier at all.
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
      type: overrides.type ?? "journal-article",
      title: overrides.title ?? `Title ${nativeId}`,
      authors: [{ family: "Lee", given: "A" }],
      ...(overrides.abstract !== undefined && { abstract: overrides.abstract }),
      ...(overrides.related !== undefined && {
        relatedVersionIds: overrides.related,
      }),
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
  /** Yield this many records, then call `gate` and await `hold` before the next. */
  readonly gateAfter?: number;
  readonly gate?: () => void;
  /**
   * Awaited after `gateAfter` records, so a test can keep the source *in
   * flight* — permit held, deadline armed — until it chooses to let it finish.
   * `P2-T27`'s concurrency assertions need two sources parked here at once.
   */
  readonly hold?: () => Promise<void>;
  /**
   * Called when `searchAll` is entered, before the first page, with the call
   * context the pipeline handed the source — so a test can report progress the
   * way a real adapter does.
   */
  readonly onStart?: (ctx: SourceCallContext) => void;
  /**
   * `capabilities.keywordSearch`. `false` makes the stub a lookup-only source
   * like bioRxiv and medRxiv (item 204). Omitted, `true`.
   */
  readonly keywordSearch?: boolean;
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
      ...(options.keywordSearch !== undefined && {
        keywordSearch: options.keywordSearch,
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
      options.onStart?.(ctx);
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
          if (emitted === options.gateAfter) {
            options.gate?.();
            if (options.hold !== undefined) await options.hold();
          }
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
  /**
   * Strategy B's counts for batch `index` (item 212), as the real writer
   * returns them when `useTranslators` is on. Omitted, or `undefined` for a
   * batch, the result carries no `importPaths` — the shipped default.
   */
  readonly importPaths?: (index: number) => SearchImportPathCounts | undefined;
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
          const paths = options.importPaths?.(batchIndex);
          const result: SearchImportBatchResult = {
            ...(paths !== undefined && { importPaths: paths }),
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

/**
 * Let every pending microtask and the macrotask queue drain once.
 *
 * The fan-out's admissions happen in microtasks (`Semaphore.acquire`, the
 * async generators' first `next()`); one timer tick is enough for every source
 * that *can* start to have started and nothing more to happen until a gate is
 * released. Same helper as `fanout.test.ts`'s.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Build everything one run needs. */
function harness(options: {
  readonly sources: readonly LiteratureSource[];
  readonly writer?: SearchImportWriter;
  readonly writeBatchSize?: number;
  /**
   * The `network-metadata` pool. Omitted, the harness builds one at §7.2's
   * size — the pipeline itself takes no default since `P2-T28`.
   */
  readonly pool?: Semaphore;
  /** `Merging`'s yield (`P2-T30`); omitted, the pipeline's default runs. */
  readonly yieldToEventLoop?: () => Promise<void>;
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
    pool: options.pool ?? new Semaphore(NETWORK_METADATA_POOL_SIZE),
    ...(options.yieldToEventLoop !== undefined && {
      yieldToEventLoop: options.yieldToEventLoop,
    }),
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

  /** A ladder database that can answer the backfill's batched lookup. */
  const withLookup = (id: SourceId): LiteratureSource => ({
    ...stubSource({ id, pages: [] }),
    lookup: () => Promise.resolve([]),
  });

  it("charges nothing to a lookup-only source, which sends no request during a search (item 180)", async () => {
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [] }),
        stubSource({ id: "biorxiv", pages: [], keywordSearch: false }),
        stubSource({ id: "medrxiv", pages: [], keywordSearch: false }),
      ],
    });
    const estimate = await h.pipeline.estimate(
      { ...BASE_INPUT, sourceIds: ["pubmed", "biorxiv", "medrxiv"] },
      h.ctx,
    );
    // PubMed's 5 pages × 2; bioRxiv and medRxiv nothing.
    expect(estimate.externalRequests).toBe(10);
    // And no items either (item 229, owner 2026-10-19): a lookup-only source
    // yields no record on a keyword run, so only PubMed's `limit` counts.
    // Before the fix this read 30 — `limit × three ticked sources`.
    expect(estimate.itemCount).toBe(BASE_INPUT.limit);
    expect(estimate.itemCount).toBe(10);
  });

  it("charges nothing to the import of a preview's own works, which sends no request (item 229)", async () => {
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [] }),
        withLookup("europepmc"),
        withLookup("semanticscholar"),
      ],
    });
    const records = [record("pubmed", "1"), record("pubmed", "2")];
    const works = dedupeAndMerge(records, 1).works;
    expect(works).toHaveLength(2);
    // Exactly what `toPipelineInput` builds for the window's Import button
    // after a preview: the ticked sources and `limit` are still there, and so
    // are the preview's records and works.
    const sourceIds: SourceId[] = ["pubmed", "europepmc", "semanticscholar"];
    const fetched = await h.pipeline.estimate(
      { ...BASE_INPUT, sourceIds, limit: 150 },
      h.ctx,
    );
    // The same ticks without supplied works: three searches and a backfill.
    expect(fetched.externalRequests).toBeGreaterThan(0);

    const estimate = await h.pipeline.estimate(
      {
        ...BASE_INPUT,
        sourceIds,
        limit: 150,
        records,
        works,
        target: { collectionName: "C" },
      },
      h.ctx,
    );
    // `Searching`, `Fetching` and `Merging` take what was supplied and
    // `BackfillingAbstracts` returns at once on this path, so nothing is
    // sent. Before the fix this charged the same as `fetched`.
    expect(estimate.externalRequests).toBe(0);
    expect(estimate.itemCount).toBe(works.length);
    expect(estimate.estimatedCostUsd).toBeUndefined();
  });

  /**
   * Sources that record what a run asks of them: `searchAll` entries for a
   * searching source, `lookup` calls for a ladder database (item 231).
   */
  function countingSources(): {
    readonly sources: LiteratureSource[];
    readonly searches: SourceId[];
    readonly lookups: SourceId[];
  } {
    const searches: SourceId[] = [];
    const lookups: SourceId[] = [];
    const searching = (id: SourceId): LiteratureSource =>
      stubSource({ id, pages: [], onStart: () => searches.push(id) });
    const ladder = (id: SourceId): LiteratureSource => ({
      ...searching(id),
      lookup: () => {
        lookups.push(id);
        return Promise.resolve([]);
      },
    });
    return {
      sources: [
        searching("pubmed"),
        ladder("europepmc"),
        ladder("semanticscholar"),
        stubSource({ id: "biorxiv", pages: [], keywordSearch: false }),
        stubSource({ id: "medrxiv", pages: [], keywordSearch: false }),
      ],
      searches,
      lookups,
    };
  }

  it("charges no search to an import of supplied records without works, and still counts its backfill (item 231)", async () => {
    const counted = countingSources();
    const h = harness({ sources: counted.sources });
    // DOIs and no abstracts, so the backfill pass really asks the ladder.
    const records = [
      record("pubmed", "1", { doi: "10.1000/a" }),
      record("pubmed", "2", { doi: "10.1000/b" }),
    ];
    const sourceIds: SourceId[] = ["pubmed", "europepmc", "semanticscholar"];
    const input: SearchImportInput = {
      ...BASE_INPUT,
      sourceIds,
      limit: 150,
      records,
      target: { collectionName: "C" },
    };

    const estimate = await h.pipeline.estimate(input, h.ctx);
    // No search: `Fetching` takes the records as given. The backfill does
    // run on this path (only a preview's own `works` skip it), over at most
    // one work per record: ceil(2 / 100) Europe PMC + ceil(2 / 100) S2 = 2.
    // Before item 231 this read 460 — the same as searching 150 per source.
    expect(estimate.externalRequests).toBe(2);
    expect(estimate.itemCount).toBe(records.length);

    // Measured, not only read: the run sends no search and does backfill,
    // within the estimate.
    const out = await h.pipeline.run(input, h.ctx);
    expect(out.outcome).toBe("succeeded");
    expect(counted.searches).toStrictEqual([]);
    expect(counted.lookups.length).toBeGreaterThan(0);
    expect(counted.lookups.length).toBeLessThanOrEqual(
      estimate.externalRequests,
    );

    // With no ladder database ticked there is nothing to charge at all.
    const plain = await h.pipeline.estimate(
      { ...input, sourceIds: ["pubmed"] },
      h.ctx,
    );
    expect(plain.externalRequests).toBe(0);
  });

  it("charges nothing to an input validate() rejects, which run() fails before any request (item 231)", async () => {
    const invalid: readonly [string, SearchImportInput][] = [
      ["empty query", { ...BASE_INPUT, query: "  " }],
      ["limit out of range", { ...BASE_INPUT, limit: 201 }],
      [
        "works without records",
        {
          ...BASE_INPUT,
          works: dedupeAndMerge([record("pubmed", "1")], 1).works,
        },
      ],
      [
        "records without a target",
        { ...BASE_INPUT, records: [record("pubmed", "1")] },
      ],
    ];
    for (const [name, base] of invalid) {
      const counted = countingSources();
      const h = harness({ sources: counted.sources });
      const input: SearchImportInput = {
        ...base,
        sourceIds: ["pubmed", "europepmc", "semanticscholar"],
      };
      expect(validateSearchImportInput(input).ok, name).toBe(false);

      const estimate = await h.pipeline.estimate(input, h.ctx);
      expect(estimate.externalRequests, name).toBe(0);
      expect(estimate.itemCount, name).toBe(0);

      const out = await h.pipeline.run(input, h.ctx);
      expect(out.outcome, name).toBe("failed");
      expect(counted.searches, name).toStrictEqual([]);
      expect(counted.lookups, name).toStrictEqual([]);
    }
  });

  it("charges nothing when no ticked source can search: each lookup-only or without an adapter (item 231)", async () => {
    const counted = countingSources();
    const h = harness({ sources: counted.sources });
    // bioRxiv and medRxiv are lookup-only; Crossref has no adapter here.
    const input: SearchImportInput = {
      ...BASE_INPUT,
      sourceIds: ["biorxiv", "medrxiv", "crossref"],
      limit: 150,
    };
    expect(validateSearchImportInput(input).ok).toBe(true);

    const estimate = await h.pipeline.estimate(input, h.ctx);
    expect(estimate.externalRequests).toBe(0);
    expect(estimate.itemCount).toBe(0);

    await h.pipeline.run(input, h.ctx);
    expect(counted.searches).toStrictEqual([]);
    expect(counted.lookups).toStrictEqual([]);
  });

  it("adds the backfill's worst case — one request per 100 works per ticked ladder database (item 198)", async () => {
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [] }),
        withLookup("europepmc"),
        withLookup("semanticscholar"),
        stubSource({ id: "biorxiv", pages: [], keywordSearch: false }),
      ],
    });
    const estimate = await h.pipeline.estimate(
      {
        ...BASE_INPUT,
        sourceIds: ["pubmed", "europepmc", "semanticscholar", "biorxiv"],
        limit: 150,
      },
      h.ctx,
    );
    // Search: three searching sources × ceil(150 / 2) pages × 2 = 450.
    // Backfill: at most 150 × 3 = 450 works → 5 Europe PMC + 5 S2 = 10.
    expect(estimate.externalRequests).toBe(460);
  });

  it("charges no backfill to a ladder database the user did not tick (item 194)", async () => {
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [] }),
        withLookup("europepmc"),
        withLookup("semanticscholar"),
      ],
    });
    const estimate = await h.pipeline.estimate(
      { ...BASE_INPUT, sourceIds: ["pubmed"], limit: 150 },
      h.ctx,
    );
    expect(estimate.externalRequests).toBe(150);
    const one = await h.pipeline.estimate(
      { ...BASE_INPUT, sourceIds: ["pubmed", "europepmc"], limit: 150 },
      h.ctx,
    );
    // 2 × 150 search + ceil(300 / 100) Europe PMC.
    expect(one.externalRequests).toBe(303);
  });
});

// ===========================================================================
// 3. The outcome table (criteria 1 and 2)
// ===========================================================================

describe("fetchStateFromReports — the one state function kept (P2-T27 step 3)", () => {
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
    expect(fetchStateFromReports([report("pubmed", 3, false)])).toBe(
      "succeeded",
    );
  });

  it("is `partial` for one source that errored after yielding records", () => {
    // The one-source regression `P1-T16`'s first criterion guards: counting
    // any error as a failed source makes this `failed` and throws page 1 away.
    expect(fetchStateFromReports([report("pubmed", 2, true)])).toBe("partial");
  });

  it("is `failed` only when every source failed (docs/07 §12.1's edge)", () => {
    expect(fetchStateFromReports([report("pubmed", 0, true)])).toBe("failed");
    expect(
      fetchStateFromReports([
        report("pubmed", 0, true),
        report("crossref", 0, true),
      ]),
    ).toBe("failed");
    expect(
      fetchStateFromReports([
        report("pubmed", 0, true),
        report("crossref", 4, false),
      ]),
    ).toBe("partial");
  });

  it("counts a healthy source with zero hits as succeeded, so its errored neighbour is `partial`", () => {
    // The one case the retired `outcomeFromReports` read the other way
    // (`failed`, because nothing was productive). §12.1's edge is
    // `Fetching --> Failed : all sources failed`; an empty result set is not a
    // failure, so this is `PartialFetch`, not `Failed`.
    expect(
      fetchStateFromReports([
        report("pubmed", 0, true),
        report("crossref", 0, false),
      ]),
    ).toBe("partial");
  });

  it("leaves lookup-only sources out of 'every source failed' (item 204)", () => {
    const lookupOnly = new Set<SourceId>(["biorxiv", "medrxiv"]);
    const quiet = [report("biorxiv", 0, false), report("medrxiv", 0, false)];
    // The default seven: five searching sources failed, the two servers asked
    // nothing. `failed`, as the window's `everySearchFailed` reads it.
    const fiveFailed = (
      ["pubmed", "europepmc", "crossref", "semanticscholar", "arxiv"] as const
    ).map((id) => report(id, 0, true));
    expect(fetchStateFromReports([...fiveFailed, ...quiet], lookupOnly)).toBe(
      "failed",
    );
    // Without the set every report counts, which is the reading before item
    // 204 — and still the reading for a caller that passes none.
    expect(fetchStateFromReports([...fiveFailed, ...quiet])).toBe("partial");
    // One searching source healthy, even with zero hits: still `partial`.
    expect(
      fetchStateFromReports(
        [report("pubmed", 0, true), report("crossref", 0, false), ...quiet],
        lookupOnly,
      ),
    ).toBe("partial");
    // A searching source that yielded before failing is degraded, not failed.
    expect(
      fetchStateFromReports([report("pubmed", 2, true), ...quiet], lookupOnly),
    ).toBe("partial");
  });

  it("still counts a lookup-only source that yielded, and keeps the old reading when only such sources were asked", () => {
    const lookupOnly = new Set<SourceId>(["biorxiv"]);
    // A record from a lookup-only source is a record: the run is not `failed`.
    expect(
      fetchStateFromReports(
        [report("pubmed", 0, true), report("biorxiv", 1, false)],
        lookupOnly,
      ),
    ).toBe("partial");
    // A real failure on a lookup-only source beside failed searching ones.
    expect(
      fetchStateFromReports(
        [report("pubmed", 0, true), report("biorxiv", 0, true)],
        lookupOnly,
      ),
    ).toBe("failed");
    // Only lookup-only sources asked: every report counts, as before.
    expect(
      fetchStateFromReports([report("biorxiv", 0, true)], lookupOnly),
    ).toBe("failed");
    expect(
      fetchStateFromReports(
        [report("biorxiv", 0, true), report("medrxiv", 0, false)],
        new Set<SourceId>(["biorxiv", "medrxiv"]),
      ),
    ).toBe("partial");
  });

  it("reads lookup-only from the capability, never from the id", () => {
    expect([
      ...lookupOnlySourceIds([
        stubSource({ id: "pubmed", pages: [] }),
        stubSource({ id: "biorxiv", pages: [], keywordSearch: false }),
        // An id that is usually lookup-only, declared as searching.
        stubSource({ id: "medrxiv", pages: [], keywordSearch: true }),
      ]),
    ]).toStrictEqual(["biorxiv"]);
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

  it("is `failed`, and creates no collection, when every searching source failed beside the two quiet servers (item 204)", async () => {
    const writer = stubWriter();
    const searching = [
      "pubmed",
      "europepmc",
      "crossref",
      "semanticscholar",
      "arxiv",
    ] as const;
    const h = harness({
      sources: [
        ...searching.map((id) =>
          stubSource({
            id,
            pages: [[]],
            throwOnPage: 0,
            error: new UpstreamServerError(503, `${id} down`),
          }),
        ),
        // bioRxiv and medRxiv as the shipped adapters behave on a keyword
        // run: no request, no record, no error.
        stubSource({ id: "biorxiv", pages: [], keywordSearch: false }),
        stubSource({ id: "medrxiv", pages: [], keywordSearch: false }),
      ],
      writer: writer.writer,
    });

    const out = await h.pipeline.run(
      {
        ...BASE_INPUT,
        sourceIds: [...searching, "biorxiv", "medrxiv"],
        target: { collectionName: "Never created either" },
      },
      h.ctx,
    );

    expect(out.outcome).toBe("failed");
    expect(out.stageReached).toBe("fetching");
    expect(out.error?.code).toBe("SOURCE");
    // The detail names the sources that failed, not the two that did not.
    expect(out.error?.detail).toBe(
      `every selected database failed: ${searching.join(", ")}`,
    );
    expect(
      out.perSource.filter((r) => r.error === undefined).map((r) => r.sourceId),
    ).toStrictEqual(["biorxiv", "medrxiv"]);
    // Before item 204 this run was `partial` and went on to open the target.
    expect(writer.log.opened).toEqual([]);
    expect(out.write).toBeUndefined();
  });

  it("stays `partial` when one searching source survives beside the quiet servers", async () => {
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[]], throwOnPage: 0 }),
        stubSource({ id: "crossref", pages: [[record("crossref", "5")]] }),
        stubSource({ id: "biorxiv", pages: [], keywordSearch: false }),
      ],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "crossref", "biorxiv"] },
      h.ctx,
    );
    expect(out.outcome).toBe("partial");
    expect(out.records.map((r) => r.sourceId)).toEqual(["crossref"]);
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
// 3a. Strategy B's counts reach the write report (item 212)
// ===========================================================================

describe("Strategy B's import-path counts (item 212)", () => {
  /** One batch's counts, as the writer returns them with translators on. */
  const paths = (
    viaTranslators: number,
    handMapped: number,
    lookupError: number,
  ): SearchImportPathCounts => ({
    viaTranslators,
    handMapped,
    fallbackReasons: {
      "no-identifier": handMapped - lookupError,
      "lookup-error": lookupError,
      "no-translators": 0,
      "no-result": 0,
      timeout: 0,
    },
  });

  const threeBatches = (): readonly SourceRecord[][] => [
    [record("pubmed", "1"), record("pubmed", "2")],
    [record("pubmed", "3"), record("pubmed", "4")],
    [record("pubmed", "5")],
  ];

  it("sums every batch's counts into the write report", async () => {
    const counts = [paths(1, 1, 1), paths(2, 0, 0), paths(0, 1, 0)];
    const writer = stubWriter({ importPaths: (index) => counts[index] });
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: threeBatches() })],
      writer: writer.writer,
      writeBatchSize: 2,
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "Strategy B" } },
      h.ctx,
    );
    expect(writer.log.batches).toHaveLength(3);
    expect(out.write?.importPaths).toStrictEqual({
      viaTranslators: 3,
      handMapped: 2,
      fallbackReasons: {
        "no-identifier": 1,
        "lookup-error": 1,
        "no-translators": 0,
        "no-result": 0,
        timeout: 0,
      },
    });
  });

  it("carries no importPaths at all when no batch did — the shipped default", async () => {
    const writer = stubWriter();
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: threeBatches() })],
      writer: writer.writer,
      writeBatchSize: 2,
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "Strategy A" } },
      h.ctx,
    );
    expect(out.write?.created).toBe(5);
    expect(out.write).toBeDefined();
    expect(Object.keys(out.write ?? {})).not.toContain("importPaths");
  });

  it("keeps the counts of the batches written before a cancel", async () => {
    let cancel = (): void => undefined;
    const writer = stubWriter({
      importPaths: () => paths(2, 0, 0),
      afterBatch: (index) => {
        if (index === 0) cancel();
      },
    });
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: threeBatches() })],
      writer: writer.writer,
      writeBatchSize: 2,
    });
    cancel = () => h.source.cancel({ kind: "user" });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, target: { collectionName: "Cancelled B" } },
      h.ctx,
    );
    expect(out.outcome).toBe("cancelled");
    expect(out.write?.importPaths?.viaTranslators).toBe(2);
  });
});

// ===========================================================================
// 3b. The fan-out wiring (P2-T27): concurrency, the pool, the zero-hit case
// ===========================================================================

const SRC_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src",
);

/** Every `.ts` file under `src/` whose text contains `needle`, repository-relative. */
function sourceFilesContaining(needle: string): string[] {
  return readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .filter((file) => readFileSync(file, "utf8").includes(needle))
    .map((file) => relative(SRC_DIR, file).replaceAll("\\", "/"))
    .sort((a, b) => a.localeCompare(b));
}

describe("the fan-out wiring (P2-T27)", () => {
  /**
   * Sources that each yield one record, then hold — permit held, in flight —
   * until `release()`; `started[i]` counts how many times source `i` was asked.
   */
  function heldSources(ids: readonly SourceId[]): {
    readonly sources: LiteratureSource[];
    readonly started: number[];
    readonly release: () => void;
  } {
    const gates = ids.map(() => createDeferred<void>());
    const started = ids.map(() => 0);
    const sources = ids.map((id, i) =>
      stubSource({
        id,
        pages: [[record(id, `${i + 1}0`)], [record(id, `${i + 1}1`)]],
        gateAfter: 1,
        hold: () => gates[i]?.promise ?? Promise.resolve(),
        onStart: () => {
          started[i] = (started[i] ?? 0) + 1;
        },
      }),
    );
    return {
      sources,
      started,
      release: () => {
        for (const gate of gates) gate.resolve();
      },
    };
  }

  it("asks the selected sources concurrently: both in flight before either resolves (FR-9, NFR-2)", async () => {
    const pool = new Semaphore(NETWORK_METADATA_POOL_SIZE);
    const held = heldSources(["pubmed", "crossref"]);
    const h = harness({ sources: held.sources, pool });

    const run = h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "crossref"] },
      h.ctx,
    );
    await settle();

    // Both started, both holding a permit, neither finished. The serial loop
    // this replaced would show `[1, 0]` and three permits free here.
    expect(held.started).toEqual([1, 1]);
    expect(pool.available).toBe(NETWORK_METADATA_POOL_SIZE - 2);
    expect(pool.waiting).toBe(0);

    held.release();
    const out = await run;
    expect(out.outcome).toBe("succeeded");
    // Source order, not completion order.
    expect(out.records.map((r) => r.id)).toEqual([
      "pubmed:10",
      "pubmed:11",
      "crossref:20",
      "crossref:21",
    ]);
    expect(out.perSource.map((r) => r.sourceId)).toEqual([
      "pubmed",
      "crossref",
    ]);
    // Every permit back.
    expect(pool.available).toBe(NETWORK_METADATA_POOL_SIZE);
  });

  it("runs under the injected pool, not one of its own: a one-permit pool serialises the sources", async () => {
    const pool = new Semaphore(1);
    const held = heldSources(["pubmed", "crossref"]);
    const h = harness({ sources: held.sources, pool });

    const run = h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "crossref"] },
      h.ctx,
    );
    await settle();

    // Had the pipeline built its own 4-permit pool, both would have started.
    expect(held.started).toEqual([1, 0]);
    expect(pool.available).toBe(0);
    expect(pool.waiting).toBe(1);

    held.release();
    const out = await run;
    expect(out.outcome).toBe("succeeded");
    expect(held.started).toEqual([1, 1]);
    expect(pool.available).toBe(1);
  });

  it("hands fanOut the Fetching stage's reporter: a source's progress moves the bar inside the Fetching slice", async () => {
    const fetching = stageSlices(SEARCH_IMPORT_STAGES).find(
      (s) => s.stage.key === "fetching",
    );
    expect(fetching).toBeDefined();
    if (fetching === undefined) return;

    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [[record("pubmed", "1")]],
          // Halfway through this source, as a real adapter reports pages.
          onStart: (ctx) => {
            // `SourceCallContext.progress` is optional on the port; the
            // pipeline always supplies one, and `toHaveLength(1)` below is
            // what fails if it ever stops doing so.
            ctx.progress?.setProgress(1, 2);
          },
        }),
      ],
    });
    await h.pipeline.run(BASE_INPUT, h.ctx);

    const fromSource = h.progress.snapshots
      .filter((s) => s.currentStageKey === "pubmed")
      .map((s) => s.fraction);
    expect(fromSource).toHaveLength(1);
    // Mapped into Fetching's slice of the bar. Handed the root reporter
    // instead, the source's child would span the whole bar and this would
    // read 0.5 — the mutant a first sweep of this wiring did not catch.
    expect(fromSource[0]).toBeCloseTo(
      fetching.from + 0.5 * (fetching.to - fetching.from),
      10,
    );
  });

  it("registerPipelines.ts builds the one network-metadata pool, and concurrent runs share it", async () => {
    // Two concurrent runs of the pipeline the composition root ships, four held
    // sources each: eight fetches. One shared pool of `NETWORK_METADATA_POOL_SIZE`
    // admits exactly four; a pool per run (or per call) would admit all eight.
    // `PipelineSet` holds `ErasedPipeline`s; narrowed the way
    // `src/bootstrap/registerUI.ts` narrows the one it takes off the registry.
    const erased = buildPipelineSet({
      writer: stubWriter().writer,
    }).searchImport;
    expect(erased.id).toBe("searchImport");
    const pipeline = erased as Pipeline<SearchImportInput, SearchImportOutput>;
    const held = heldSources(["pubmed", "crossref", "europepmc", "arxiv"]);
    const registry = createSourceRegistry();
    for (const s of held.sources) registry.register(s);
    const contextFor = (): PipelineContext => {
      const clock = createManualClock(1_000);
      const { token } = createCancellationTokenSource();
      return createContext({
        clock,
        token,
        progress: createProgress(clock, token).reporter,
        sources: registry,
      });
    };
    const input: SearchImportInput = {
      ...BASE_INPUT,
      sourceIds: ["pubmed", "crossref", "europepmc", "arxiv"],
    };

    const runs = [
      pipeline.run(input, contextFor()),
      pipeline.run(input, contextFor()),
    ];
    await settle();

    const inFlight = held.started.reduce((sum, n) => sum + n, 0);
    expect(inFlight).toBe(NETWORK_METADATA_POOL_SIZE);

    held.release();
    const outs = await Promise.all(runs);
    expect(outs.map((o) => o.outcome)).toEqual(["succeeded", "succeeded"]);
    expect(held.started.reduce((sum, n) => sum + n, 0)).toBe(8);
  });

  it("the pipeline builds no pool of its own: `src/` constructs the network-metadata pool once, in registerPipelines.ts (P2-T28)", () => {
    // `P2-T27` left `createSearchImportPipeline` a per-instance fallback pool
    // because the flow spec constructed the pipeline without one, which made
    // "omit `pool` in `buildPipelineSet`" an equivalent mutant. `P2-T28` made
    // `SearchImportDeps.pool` required and deleted the fallback: the omission
    // is now a type error, the test above fails at run time (no permit is
    // ever granted), and this pins the other half — the composition root is
    // the one place under `src/` that writes the pool. `tokenBucket.ts`'s
    // `new Semaphore(` is a different pool (docs/07 §7.3's per-host gate).
    expect(
      sourceFilesContaining("new Semaphore(NETWORK_METADATA_POOL_SIZE)"),
    ).toEqual(["bootstrap/registerPipelines.ts"]);
    expect(
      readFileSync(
        resolve(SRC_DIR, "pipeline/searchImport/searchImportPipeline.ts"),
        "utf8",
      ),
    ).not.toContain("new Semaphore(");
  });

  it("one source errored beside a healthy source with zero hits is `partial`, not `failed` (docs/07 §12.1)", async () => {
    // The pipeline-level form of the kept state function's zero-hit case. Under
    // the retired `outcomeFromReports` this run was `failed` and stopped at
    // `Fetching`; §12.1's `PartialFetch --> Merging : continue with what we
    // have` carries it on, and FR-6's collection is created, empty.
    const writer = stubWriter();
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[]], throwOnPage: 0 }),
        stubSource({ id: "crossref", pages: [[]] }),
      ],
      writer: writer.writer,
    });
    const out = await h.pipeline.run(
      {
        ...BASE_INPUT,
        sourceIds: ["pubmed", "crossref"],
        target: { collectionName: "Empty but not failed" },
      },
      h.ctx,
    );

    expect(out.outcome).toBe("partial");
    expect(out.records).toEqual([]);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("pubmed");
    expect(
      out.perSource.map((r) => [r.sourceId, r.error?.code, r.recordsRetrieved]),
    ).toEqual([
      ["pubmed", "UPSTREAM_SERVER", 0],
      ["crossref", undefined, 0],
    ]);
    expect(out.stageReached).toBe("writingItems");
    expect(writer.log.opened).toHaveLength(1);
    expect(out.write?.created).toBe(0);
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
    // Two sources; the first is cancelled mid-flight. Since `P2-T27` the second
    // is asked *concurrently* — the fan-out starts both before either yields —
    // so it is in flight when the cancel lands. What must hold is that neither
    // ends up on the report as a **failed** source and the run is `cancelled`.
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
    // Asked, because the fan-out is concurrent (`P2-T27`); under the serial
    // loop it replaced this read `0`, the second source never being reached.
    expect(asked).toBe(1);
    // And neither source is on the report as failed.
    expect(out.perSource).toEqual([]);
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
  // Phase 1's `liftToCanonicalWorks` was deleted by `P2-T29`; the same two
  // properties are now asserted through the pipeline, whose one lift is
  // `dedupeAndMerge` → `merge()` over a singleton group.
  it("mints workKey from docs/07 §5.1's algorithm and stamps the clock", async () => {
    const h = harness({
      sources: [
        stubSource({
          id: "pubmed",
          pages: [
            [
              record("pubmed", "123", { year: 2024 }),
              record("pubmed", "456", { doi: "10.1234/x", year: 2023 }),
            ],
          ],
        }),
      ],
    });
    const out = await h.pipeline.run(BASE_INPUT, h.ctx);
    // `pmid:` when there is no DOI, `doi:` when there is — `buildWorkKey`'s
    // declared precedence, asserted through the pipeline rather than restated.
    expect(out.works.map((w) => w.workKey)).toEqual([
      "pmid:123",
      "doi:10.1234/x",
    ]);
    // `ctx.clock.now()` at `Merging`, not `record.retrievedAtEpochMs` (1).
    expect(out.works.map((w) => w.normalizedAtEpochMs)).toEqual([
      h.clock.now(),
      h.clock.now(),
    ]);
  });

  it("records one source and claims no contested field", async () => {
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [[record("pubmed", "1")]] })],
    });
    const out = await h.pipeline.run(BASE_INPUT, h.ctx);
    expect(out.works[0]?.provenance).toEqual({
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

  it("Deduping folds two same-DOI records from one source into one work and charges that source (docs/07 §5.3)", async () => {
    // Until `P2-T29` this test asserted the opposite — Phase 1 kept both,
    // under `P1-T16`'s `Do NOT`. Phase 2's cascade (`P2-T09`) now owns the
    // decision, and a DOI match is its first and surest tier.
    const same = [
      record("pubmed", "1", { doi: "10.1234/dup", title: "One work" }),
      record("pubmed", "2", { doi: "10.1234/dup", title: "One work" }),
    ];
    const h = harness({
      sources: [stubSource({ id: "pubmed", pages: [same] })],
    });
    const out = await h.pipeline.run(BASE_INPUT, h.ctx);
    expect(out.records.map((r) => r.id)).toEqual(["pubmed:1"]);
    expect(out.works).toHaveLength(1);
    expect(out.works[0]?.provenance.recordIds).toEqual([
      "pubmed:1",
      "pubmed:2",
    ]);
    expect(out.perSource[0]?.recordsDeduplicatedAway).toBe(1);
  });
});

// ===========================================================================
// 6b. The dedup and merge wiring — P2-T29
// ===========================================================================

describe("the dedup and merge wiring (P2-T29)", () => {
  const sharedTitle =
    "Adenine base editors convert A to G in genomic DNA without cleavage";
  const twoSources: SearchImportInput = {
    ...BASE_INPUT,
    sourceIds: ["pubmed", "crossref"],
  };

  /** The same DOI from PubMed (asked first) and Crossref. */
  function sameDoiPair(): {
    readonly pubmed: SourceRecord;
    readonly crossref: SourceRecord;
  } {
    return {
      pubmed: record("pubmed", "40", {
        doi: "10.1000/one",
        title: sharedTitle,
        year: 2024,
        // Both supply one, so the field is *contested* and `fieldOrigin`
        // records the winner; `docs/07` §5.1's abstract rule prefers the
        // longer.
        abstract: "short",
      }),
      crossref: record("crossref", "c40", {
        doi: "10.1000/one",
        title: sharedTitle,
        year: 2024,
        abstract: "Crossref's abstract",
      }),
    };
  }

  it("two sources returning the same DOI yield one work with both in seenIn, charged to the non-representative source (FR-50)", async () => {
    const pair = sameDoiPair();
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[pair.pubmed]] }),
        stubSource({ id: "crossref", pages: [[pair.crossref]] }),
      ],
    });
    const out = await h.pipeline.run(twoSources, h.ctx);

    expect(out.outcome).toBe("succeeded");
    // One row, and it is the group's first record in fetch order.
    expect(out.records).toEqual([pair.pubmed]);
    expect(out.works).toHaveLength(1);
    const work = out.works[0];
    expect(work?.workKey).toBe("doi:10.1000/one");
    expect(new Set(work?.provenance.seenIn)).toEqual(
      new Set(["pubmed", "crossref"]),
    );
    expect(new Set(work?.provenance.recordIds)).toEqual(
      new Set([pair.pubmed.id, pair.crossref.id]),
    );
    // A contested field was won by someone — the merge happened, not a lift.
    expect(work?.abstract).toBe("Crossref's abstract");
    expect(work?.provenance.fieldOrigin["abstract"]).toBe("crossref");

    // `attributeDeduplicatedAway`: the folded record is charged to **its own**
    // source, the representative's source stays at 0, every other member of
    // the report is untouched.
    const bySource = Object.fromEntries(
      out.perSource.map((r) => [r.sourceId, r.recordsDeduplicatedAway]),
    );
    expect(bySource).toEqual({ pubmed: 0, crossref: 1 });
    expect(out.perSource.map((r) => r.recordsRetrieved)).toEqual([1, 1]);
    expect(out.perSource.map((r) => r.error)).toEqual([undefined, undefined]);

    expect(out.flags).toEqual([]);
    expect(out.links).toEqual([]);
  });

  it("a preprint and its published version yield two works, each in the other's relatedVersionIds, and one link (G-16)", async () => {
    const published = record("crossref", "pub", {
      doi: "10.1038/s41586-024-07000-0",
      title: sharedTitle,
      year: 2024,
    });
    const preprintDoi = normalizeDoi("10.1101/2023.12.01.569000");
    const publishedDoi = normalizeDoi("10.1038/s41586-024-07000-0");
    if (preprintDoi === null || publishedDoi === null) {
      throw new Error("fixture DOIs must normalize");
    }
    const preprint = record("biorxiv", "pre", {
      doi: "10.1101/2023.12.01.569000",
      title: sharedTitle,
      type: "preprint",
      year: 2023,
      related: { doi: publishedDoi },
    });
    const h = harness({
      sources: [
        stubSource({ id: "crossref", pages: [[published]] }),
        stubSource({ id: "biorxiv", pages: [[preprint]] }),
      ],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["crossref", "biorxiv"] },
      h.ctx,
    );

    expect(out.works).toHaveLength(2);
    expect(out.records).toEqual([published, preprint]);
    const pub = out.works.find((w) => w.workKey === `doi:${publishedDoi}`);
    const pre = out.works.find((w) => w.workKey === `doi:${preprintDoi}`);
    expect(pub?.relatedVersionIds?.doi).toBe(preprintDoi);
    expect(pre?.relatedVersionIds?.doi).toBe(publishedDoi);
    // Neither absorbed the other.
    expect(pub?.provenance.recordIds).toEqual([published.id]);
    expect(pre?.provenance.recordIds).toEqual([preprint.id]);

    expect(out.links).toHaveLength(1);
    const link = out.links?.[0];
    expect(link?.preprintWorkKey).toBe(`doi:${preprintDoi}`);
    expect(new Set([link?.aWorkKey, link?.bWorkKey])).toEqual(
      new Set([`doi:${publishedDoi}`, `doi:${preprintDoi}`]),
    );
    expect(link?.decision.verdict).toBe("link");
    expect(out.flags).toEqual([]);
    expect(out.perSource.map((r) => r.recordsDeduplicatedAway)).toEqual([0, 0]);
  });

  it("a flagged pair yields two works and one flag, nothing merged (FR-50 scenario 4)", async () => {
    // Same title, same year, no identifier on either side, one a preprint:
    // the cascade's title tier flags it and `docs/02` §11.4's last row says
    // never merge and never link.
    const article = record("pubmed", "art", { title: sharedTitle, year: 2024 });
    const preprint = record("arxiv", "arx", {
      title: sharedTitle,
      type: "preprint",
      year: 2024,
    });
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[article]] }),
        stubSource({ id: "arxiv", pages: [[preprint]] }),
      ],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "arxiv"] },
      h.ctx,
    );

    expect(out.works).toHaveLength(2);
    expect(out.records).toEqual([article, preprint]);
    expect(out.works.every((w) => w.provenance.recordIds.length === 1)).toBe(
      true,
    );
    expect(out.flags).toHaveLength(1);
    const flag = out.flags?.[0];
    expect(flag?.decision.verdict).toBe("flag");
    expect(new Set([flag?.a.id, flag?.b.id])).toEqual(
      new Set([article.id, preprint.id]),
    );
    expect(out.links).toEqual([]);
    expect(out.perSource.map((r) => r.recordsDeduplicatedAway)).toEqual([0, 0]);
  });

  it("selectedWorks' positional contract holds on the merged shape: the representative's id selects the merged work, a folded record's id selects nothing", async () => {
    const pair = sameDoiPair();
    const other = record("pubmed", "41", { title: "A different paper" });
    const writer = stubWriter();
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[pair.pubmed, other]] }),
        stubSource({ id: "crossref", pages: [[pair.crossref]] }),
      ],
      writer: writer.writer,
    });

    // The representative is a row; checking it writes the **merged** work.
    const out = await h.pipeline.run(
      {
        ...twoSources,
        target: { collectionName: "C", selectedRecordIds: [pair.pubmed.id] },
      },
      h.ctx,
    );
    expect(out.records.map((r) => r.id)).toEqual([pair.pubmed.id, other.id]);
    expect(out.works.map((w) => w.workKey)).toEqual([
      "doi:10.1000/one",
      "pmid:41",
    ]);
    const written = writer.log.batches.flat();
    expect(written.map((w) => w.workKey)).toEqual(["doi:10.1000/one"]);
    expect(new Set(written[0]?.provenance.seenIn)).toEqual(
      new Set(["pubmed", "crossref"]),
    );

    // The folded record is no row, so its id is "an id no record carries".
    const h2 = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[pair.pubmed, other]] }),
        stubSource({ id: "crossref", pages: [[pair.crossref]] }),
      ],
      writer: writer.writer,
    });
    const out2 = await h2.pipeline.run(
      {
        ...twoSources,
        target: { collectionName: "C", selectedRecordIds: [pair.crossref.id] },
      },
      h2.ctx,
    );
    expect(out2.write?.created).toBe(0);
    expect(writer.log.batches.flat()).toHaveLength(1);
  });

  it("BackfillingAbstracts runs docs/02 §10.4's batched ladder — one lookup per step, never fetchAbstract (P2-T12)", async () => {
    const pubmed = record("pubmed", "50", {
      doi: "10.1000/fifty",
      title: sharedTitle,
    });
    const crossref = record("crossref", "c50", {
      doi: "10.1000/fifty",
      title: sharedTitle,
    });
    const lonely = record("pubmed", "51", { doi: "10.1000/fifty-one" });
    const calls: { sourceId: SourceId; dois: (string | undefined)[] }[] = [];
    // A ladder source: answers the DOIs in `answers`, records every call, and
    // fails the test if the per-record `fetchAbstract` is ever reached.
    const ladderSource = (
      id: SourceId,
      answers: ReadonlyMap<string, string>,
    ): LiteratureSource => ({
      ...stubSource({ id, pages: [] }),
      lookup(ids): Promise<readonly SourceRecord[]> {
        calls.push({ sourceId: id, dois: ids.map((entry) => entry.doi) });
        return Promise.resolve(
          ids.flatMap((entry) => {
            const abstract =
              entry.doi === undefined ? undefined : answers.get(entry.doi);
            return abstract === undefined || entry.doi === undefined
              ? []
              : [
                  record(id, `${id}-${entry.doi}`, {
                    doi: entry.doi,
                    abstract,
                  }),
                ];
          }),
        );
      },
      fetchAbstract(): Promise<string | undefined> {
        throw new Error("fetchAbstract is one request per record (§10.4)");
      },
    });
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[pubmed, lonely]] }),
        stubSource({ id: "crossref", pages: [[crossref]] }),
        ladderSource(
          "europepmc",
          new Map([["10.1000/fifty", "Europe PMC's abstract"]]),
        ),
        ladderSource(
          "semanticscholar",
          new Map([
            ["10.1000/fifty", "S2's — never used, Europe PMC answered first"],
            ["10.1000/fifty-one", "S2's abstract"],
          ]),
        ),
      ],
    });
    // The ladder asks only ticked databases (owner, 2026-10-15, item 194).
    const out = await h.pipeline.run(
      {
        ...twoSources,
        sourceIds: [...twoSources.sourceIds, "europepmc", "semanticscholar"],
      },
      h.ctx,
    );

    // One batched call per step, in the ladder's order; the second step is
    // asked only about what the first did not answer.
    expect(calls).toEqual([
      {
        sourceId: "europepmc",
        dois: ["10.1000/fifty", "10.1000/fifty-one"],
      },
      { sourceId: "semanticscholar", dois: ["10.1000/fifty-one"] },
    ]);
    const merged = out.works.find((w) => w.ids.doi === "10.1000/fifty");
    expect(merged?.provenance.seenIn).toEqual(["crossref", "pubmed"]);
    expect(merged?.abstract).toBe("Europe PMC's abstract");
    expect(merged?.provenance.fieldOrigin.abstract).toBe("europepmc");
    const single = out.works.find((w) => w.ids.doi === "10.1000/fifty-one");
    expect(single?.abstract).toBe("S2's abstract");
    expect(single?.provenance.fieldOrigin.abstract).toBe("semanticscholar");
  });

  it("restamps normalizedAtEpochMs on a work the backfill changed, and on no other (item 198)", async () => {
    const answered = record("pubmed", "60", { doi: "10.1000/sixty" });
    const unanswered = record("pubmed", "61", { doi: "10.1000/sixty-one" });
    // A holder: the lookup closes over the harness that is built after it.
    const built: { h?: ReturnType<typeof harness> } = {};
    const europepmc: LiteratureSource = {
      ...stubSource({ id: "europepmc", pages: [] }),
      lookup(ids): Promise<readonly SourceRecord[]> {
        // The pass's request takes time: the clock moves past `Merging`'s stamp.
        built.h?.clock.advance(5_000);
        return Promise.resolve(
          ids
            .filter((entry) => entry.doi === "10.1000/sixty")
            .map(() =>
              record("europepmc", "e60", {
                doi: "10.1000/sixty",
                abstract: "Europe PMC's abstract",
              }),
            ),
        );
      },
    };
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[answered, unanswered]] }),
        europepmc,
      ],
    });
    built.h = h;
    const merged = h.clock.now();
    const out = await h.pipeline.run(
      { ...twoSources, sourceIds: ["pubmed", "europepmc"] },
      h.ctx,
    );
    const filled = out.works.find((w) => w.ids.doi === "10.1000/sixty");
    const left = out.works.find((w) => w.ids.doi === "10.1000/sixty-one");
    expect(filled?.abstract).toBe("Europe PMC's abstract");
    expect(left?.abstract).toBeUndefined();
    expect(left?.normalizedAtEpochMs).toBe(merged);
    expect(filled?.normalizedAtEpochMs).toBe(merged + 5_000);
  });
  it("supplied records go through the same merge, so the write half of a preview dedups too", async () => {
    const pair = sameDoiPair();
    const writer = stubWriter();
    const h = harness({ sources: [], writer: writer.writer });
    const out = await h.pipeline.run(
      {
        ...BASE_INPUT,
        query: "",
        sourceIds: [],
        records: [pair.pubmed, pair.crossref],
        target: { collectionName: "C" },
      },
      h.ctx,
    );
    expect(out.outcome).toBe("succeeded");
    expect(out.records).toEqual([pair.pubmed]);
    expect(out.write?.created).toBe(1);
    expect(writer.log.batches.flat().map((w) => w.workKey)).toEqual([
      "doi:10.1000/one",
    ]);
    // No source was asked, so there is no report to stamp.
    expect(out.perSource).toEqual([]);
  });

  it("an all-sources failure returns before Merging with empty flags and links, and the fetch's 0", async () => {
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[]], throwOnPage: 0 }),
        stubSource({ id: "crossref", pages: [[]], throwOnPage: 0 }),
      ],
    });
    const out = await h.pipeline.run(twoSources, h.ctx);
    expect(out.outcome).toBe("failed");
    expect(out.stageReached).toBe("fetching");
    expect(out.flags).toEqual([]);
    expect(out.links).toEqual([]);
    expect(out.perSource.map((r) => r.recordsDeduplicatedAway)).toEqual([0, 0]);
  });
});

// ===========================================================================
// 6c. The import writes the preview's works — P2-T31
// ===========================================================================

describe("the import of a preview writes the merged works the preview showed (P2-T31)", () => {
  const sharedTitle =
    "Adenine base editors convert A to G in genomic DNA without cleavage";

  /** The same DOI from PubMed (asked first) and Crossref, abstracts contested. */
  function sameDoiPair(): {
    readonly pubmed: SourceRecord;
    readonly crossref: SourceRecord;
  } {
    return {
      pubmed: record("pubmed", "40", {
        doi: "10.1000/one",
        title: sharedTitle,
        year: 2024,
        abstract: "short",
      }),
      crossref: record("crossref", "c40", {
        doi: "10.1000/one",
        title: sharedTitle,
        year: 2024,
        abstract: "Crossref's abstract",
      }),
    };
  }

  /** FR-5's preview over two sources: no target, so nothing is written. */
  async function preview(pair: ReturnType<typeof sameDoiPair>) {
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[pair.pubmed]] }),
        stubSource({ id: "crossref", pages: [[pair.crossref]] }),
      ],
    });
    const out = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "crossref"] },
      h.ctx,
    );
    expect(out.outcome).toBe("succeeded");
    expect(out.works).toHaveLength(1);
    expect(out.write).toBeUndefined();
    return out;
  }

  /** The write half's input, as `searchImportViewModel.ts` builds it. */
  function importInput(
    previewed: SearchImportOutput,
    selectedRecordIds: readonly string[],
    // A boolean rather than an optional `works` with a default: an explicit
    // `undefined` argument takes a default parameter's value, which is how
    // the records-alone case below first ran the works path by accident.
    withWorks = true,
  ): SearchImportInput {
    return {
      ...BASE_INPUT,
      query: "",
      sourceIds: [],
      records: previewed.records,
      ...(withWorks && { works: previewed.works }),
      target: { collectionName: "C", selectedRecordIds },
    };
  }

  it("a two-source same-DOI preview followed by an import of its records and works writes the previewed CanonicalWork: same seenIn, same fieldOrigin, deep-equal", async () => {
    const pair = sameDoiPair();
    const previewed = await preview(pair);
    const shown = previewed.works[0];
    if (shown === undefined) throw new Error("the preview produced no work");
    expect(new Set(shown.provenance.seenIn)).toEqual(
      new Set(["pubmed", "crossref"]),
    );
    expect(shown.provenance.fieldOrigin["abstract"]).toBe("crossref");

    const writer = stubWriter();
    const h = harness({ sources: [], writer: writer.writer });
    const out = await h.pipeline.run(
      importInput(previewed, [pair.pubmed.id]),
      h.ctx,
    );

    expect(out.outcome).toBe("succeeded");
    expect(out.stageReached).toBe("writingItems");
    expect(out.write?.created).toBe(1);
    const written = writer.log.batches.flat();
    expect(written).toHaveLength(1);
    // Deep-equal to the previewed work — and in fact the same object: the
    // pipeline wrote what it was handed, it did not re-derive it.
    expect(written[0]).toStrictEqual(shown);
    expect(written[0]).toBe(shown);
    expect(written[0]?.provenance.seenIn).toStrictEqual(
      shown.provenance.seenIn,
    );
    expect(written[0]?.provenance.fieldOrigin).toStrictEqual(
      shown.provenance.fieldOrigin,
    );
    expect(written[0]?.abstract).toBe("Crossref's abstract");
    // The output is the preview's pair, unchanged, with nothing to review and
    // no source to stamp.
    expect(out.records).toBe(previewed.records);
    expect(out.works).toBe(previewed.works);
    expect(out.flags).toEqual([]);
    expect(out.links).toEqual([]);
    expect(out.perSource).toEqual([]);
  });

  it("the same import with records alone re-merges the representative as a singleton — the narrower write P2-T29 reported and this card closes", async () => {
    const pair = sameDoiPair();
    const previewed = await preview(pair);
    const writer = stubWriter();
    const h = harness({ sources: [], writer: writer.writer });
    const out = await h.pipeline.run(
      importInput(previewed, [pair.pubmed.id], false),
      h.ctx,
    );
    expect(out.outcome).toBe("succeeded");
    const written = writer.log.batches.flat();
    expect(written).toHaveLength(1);
    // One source, no contested field, the shorter abstract: not the preview.
    expect(written[0]?.provenance.seenIn).toStrictEqual(["pubmed"]);
    expect(written[0]?.provenance.fieldOrigin).toStrictEqual({});
    expect(written[0]?.abstract).toBe("short");
    expect(written[0]).not.toStrictEqual(previewed.works[0]);
  });

  it("supplied works are written as given and the cascade is not run: zero yields, the marker survives, the clock is not re-read into the work", async () => {
    const pair = sameDoiPair();
    const previewed = await preview(pair);
    const shown = previewed.works[0];
    if (shown === undefined) throw new Error("the preview produced no work");
    // A work `merge()` could never produce from these records: the title is
    // the marker, the stamp is the preview's, not this run's clock.
    const marked: CanonicalWork = { ...shown, title: "AS GIVEN" };
    const writer = stubWriter();
    let yields = 0;
    const h = harness({
      sources: [],
      writer: writer.writer,
      yieldToEventLoop: () => {
        yields += 1;
        return Promise.resolve();
      },
    });
    // Two records of the same DOI as the "representatives": were the cascade
    // run over them it would compare the pair once and yield at the block
    // boundary; handed works, it compares nothing.
    const out = await h.pipeline.run(
      {
        ...importInput(previewed, [pair.pubmed.id, pair.crossref.id]),
        records: [pair.pubmed, pair.crossref],
        works: [marked, { ...shown, title: "AS GIVEN TOO" }],
      },
      h.ctx,
    );
    expect(out.outcome).toBe("succeeded");
    expect(yields).toBe(0);
    const written = writer.log.batches.flat();
    expect(written.map((w) => w.title)).toEqual(["AS GIVEN", "AS GIVEN TOO"]);
    expect(written[0]?.normalizedAtEpochMs).toBe(shown.normalizedAtEpochMs);
    // Neither array was re-derived.
    expect(out.records).toHaveLength(2);
    expect(out.works).toHaveLength(2);
  });

  it("selectedRecordIds still names representatives: a checked row writes its work, an unchecked one does not", async () => {
    const pair = sameDoiPair();
    const alone = record("pubmed", "41", { title: "A different paper" });
    const h0 = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[pair.pubmed, alone]] }),
        stubSource({ id: "crossref", pages: [[pair.crossref]] }),
      ],
    });
    const previewed = await h0.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "crossref"] },
      h0.ctx,
    );
    expect(previewed.records.map((r) => r.id)).toEqual([
      pair.pubmed.id,
      alone.id,
    ]);

    const writer = stubWriter();
    const h = harness({ sources: [], writer: writer.writer });
    const out = await h.pipeline.run(importInput(previewed, [alone.id]), h.ctx);
    expect(out.write?.created).toBe(1);
    expect(writer.log.batches.flat()).toStrictEqual([previewed.works[1]]);
  });

  it("validate rejects works without records, and works of another length than records", () => {
    const pair = sameDoiPair();
    const previewed: Pick<SearchImportOutput, "records" | "works"> = {
      records: [pair.pubmed],
      works: [],
    };
    const noRecords = validateSearchImportInput({
      ...BASE_INPUT,
      works: [],
      target: { collectionName: "C" },
    });
    expect(noRecords.ok).toBe(false);
    expect(noRecords.errors.map((e) => e.field)).toEqual(["works"]);
    expect(noRecords.errors[0]?.messageKey).toBe(
      SEARCH_IMPORT_VALIDATION_KEYS.worksMisaligned,
    );

    const misaligned = validateSearchImportInput({
      ...BASE_INPUT,
      query: "",
      sourceIds: [],
      records: previewed.records,
      works: previewed.works,
      target: { collectionName: "C" },
    });
    expect(misaligned.ok).toBe(false);
    expect(misaligned.errors.map((e) => e.messageKey)).toEqual([
      SEARCH_IMPORT_VALIDATION_KEYS.worksMisaligned,
    ]);

    // Aligned, with a target: accepted. Aligned, without one: `noTarget`
    // still, and only that.
    const aligned = {
      ...BASE_INPUT,
      query: "",
      sourceIds: [],
      records: [pair.pubmed],
      works: dedupeAndMerge([pair.pubmed], 1).works,
    };
    expect(
      validateSearchImportInput({ ...aligned, target: { collectionName: "C" } })
        .ok,
    ).toBe(true);
    expect(
      validateSearchImportInput(aligned).errors.map((e) => e.messageKey),
    ).toEqual([SEARCH_IMPORT_VALIDATION_KEYS.noTarget]);
  });

  it("SearchImportOutput.flags and .links are required members, checked by the compiler", () => {
    // `P2-T29` had to leave both optional for two `test/unit/ui/*` fixtures
    // outside its list; `P2-T31` closes that. Two compile-time checks, because
    // no runtime assertion can tell `flags: []` from `flags?: []`:
    //
    // 1. Reading the member never yields `undefined` — true only of a required
    //    member, since an optional one reads as `T | undefined`.
    const flagsRequired: undefined extends SearchImportOutput["flags"]
      ? never
      : true = true;
    const linksRequired: undefined extends SearchImportOutput["links"]
      ? never
      : true = true;
    expect(flagsRequired && linksRequired).toBe(true);

    // 2. A literal that omits them does not compile. Were either made optional
    //    again, this directive would become unused and `tsc` would say so
    //    (TS2578), which is the failure that catches the regression.
    const sansFlagsAndLinks = {
      outcome: "succeeded",
      stageReached: "writingItems",
      records: [],
      works: [],
      perSource: [],
      write: undefined,
      warnings: [],
      error: undefined,
      cancellationKind: undefined,
    } as const;
    // @ts-expect-error -- `flags` and `links` are required (P2-T31)
    const incomplete: SearchImportOutput = sansFlagsAndLinks;
    expect(Object.keys(incomplete)).not.toContain("flags");
  });

  it("run() turns a misaligned pair into a failed outcome at Planning and writes nothing", async () => {
    const pair = sameDoiPair();
    const writer = stubWriter();
    const h = harness({ sources: [], writer: writer.writer });
    const out = await h.pipeline.run(
      {
        ...BASE_INPUT,
        query: "",
        sourceIds: [],
        records: [pair.pubmed, pair.crossref],
        works: [],
        target: { collectionName: "C" },
      },
      h.ctx,
    );
    expect(out.outcome).toBe("failed");
    expect(out.stageReached).toBe("planning");
    expect(out.error?.code).toBe("CONFIGURATION");
    expect(out.error?.messageKey).toBe(
      SEARCH_IMPORT_VALIDATION_KEYS.worksMisaligned,
    );
    expect(writer.log.opened).toEqual([]);
    expect(out.write).toBeUndefined();
  });
});

// ===========================================================================
// 6b. Merging yields to the event loop (P2-T30, docs/10 NFR-3)
// ===========================================================================

describe("Merging yields to the event loop (P2-T30)", () => {
  const sharedTitle =
    "Adenine base editors convert A to G in genomic DNA without cleavage";

  /**
   * `P1-T23`'s NFR-1 shape: 100 records in one title block, the set that
   * stalled the main thread 246–274 ms when `Merging` ran it unchunked.
   */
  function oneBlockOfHundred(): SourceRecord[] {
    return Array.from({ length: 100 }, (_, i) =>
      record("pubmed", `p1t23-${String(i + 1)}`, {
        doi: `10.5555/p1t23.${String(i + 1)}`,
        title: `Pre-fetched record ${String(i + 1)} for NFR-1`,
        year: 2025,
      }),
    );
  }

  const paperDoi = normalizeDoi("10.1000/paper");
  if (paperDoi === null) throw new Error("fixture DOI must normalize");

  /** The three P2-T29 shapes plus the two large ones, built once each. */
  const fixtures: readonly (readonly [string, readonly SourceRecord[]])[] = [
    [
      "same DOI from two sources",
      [
        record("pubmed", "40", {
          doi: "10.1000/one",
          title: sharedTitle,
          year: 2024,
          abstract: "short",
        }),
        record("crossref", "c40", {
          doi: "10.1000/one",
          title: sharedTitle,
          year: 2024,
          abstract: "Crossref's abstract",
        }),
      ],
    ],
    [
      "preprint and its published version",
      [
        record("pubmed", "41", {
          doi: "10.1000/paper",
          title: sharedTitle,
          year: 2024,
        }),
        record("crossref", "pre", {
          doi: "10.1101/2023.01.01.000001",
          title: sharedTitle,
          year: 2023,
          type: "preprint",
          related: { doi: paperDoi },
        }),
      ],
    ],
    [
      "a flagged pair",
      [
        record("pubmed", "x1", { title: sharedTitle, year: 2024 }),
        record("crossref", "x2", {
          title:
            "Adenine base editors convert A to G in genomic RNA without cleavage",
          year: 2024,
        }),
      ],
    ],
    ["empty", []],
    ["100 records in one block", oneBlockOfHundred()],
  ];

  it.each(fixtures)(
    "dedupeAndMergeAsync returns what dedupeAndMerge returns on: %s",
    async (_name, records) => {
      const at = 1_234;
      expect(await dedupeAndMergeAsync(records, at)).toEqual(
        dedupeAndMerge(records, at),
      );
    },
  );

  it("run awaits the yielding cascade: one yield per DEDUP_YIELD_EVERY_COMPARISONS comparisons on a 100-record supplied set", async () => {
    const records = oneBlockOfHundred();
    let yields = 0;
    const h = harness({
      sources: [],
      yieldToEventLoop: () => {
        yields += 1;
        return settle();
      },
    });
    const out = await h.pipeline.run(
      {
        ...BASE_INPUT,
        query: "",
        sourceIds: [],
        records,
        target: { collectionName: "C" },
      },
      h.ctx,
    );
    expect(out.outcome).toBe("succeeded");
    expect(out.works).toHaveLength(100);
    const { comparisons } = dedupeRecords(records);
    expect(comparisons).toBeGreaterThan(DEDUP_YIELD_EVERY_COMPARISONS);
    expect(yields).toBe(Math.ceil(comparisons / DEDUP_YIELD_EVERY_COMPARISONS));
  });

  it("makes no yield when the cascade compares nothing", async () => {
    let yields = 0;
    const h = harness({
      sources: [],
      yieldToEventLoop: () => {
        yields += 1;
        return settle();
      },
    });
    const out = await h.pipeline.run(
      {
        ...BASE_INPUT,
        query: "",
        sourceIds: [],
        records: [
          record("pubmed", "a1", { title: "Alpha beta gamma delta epsilon" }),
          record("pubmed", "a2", { title: "Completely unrelated words here" }),
        ],
        target: { collectionName: "C" },
      },
      h.ctx,
    );
    expect(out.outcome).toBe("succeeded");
    expect(out.works).toHaveLength(2);
    expect(yields).toBe(0);
  });

  it("a Cancel during Merging lands at the next yield: the run is cancelled in Merging and nothing is written (FR-10)", async () => {
    const writer = stubWriter();
    let yields = 0;
    let cancel: () => void = () => undefined;
    const h = harness({
      sources: [],
      writer: writer.writer,
      yieldToEventLoop: () => {
        yields += 1;
        if (yields === 1) cancel();
        return settle();
      },
    });
    cancel = () => h.source.cancel({ kind: "user" });
    const out = await h.pipeline.run(
      {
        ...BASE_INPUT,
        query: "",
        sourceIds: [],
        records: oneBlockOfHundred(),
        target: { collectionName: "C" },
      },
      h.ctx,
    );
    expect(out.outcome).toBe("cancelled");
    expect(out.cancellationKind).toBe("user");
    expect(out.stageReached).toBe("merging");
    // Stopped at that yield — no second slice ran.
    expect(yields).toBe(1);
    // Nothing reached the writer: no collection, no batch, no note.
    expect(writer.log.opened).toEqual([]);
    expect(writer.log.batches).toEqual([]);
    expect(out.write).toBeUndefined();
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
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
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
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
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
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
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
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
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
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
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
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
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

// ---------------------------------------------------------------------------
// P2-T34 — FR-50 scenario 2's merge decision reaches the provenance note
// ---------------------------------------------------------------------------

describe("the merge decision reaches the provenance note (P2-T34, FR-50 scenario 2)", () => {
  const sharedTitle =
    "Adenine base editors convert A to G in genomic DNA without cleavage";
  const sameDoi = {
    pubmed: record("pubmed", "40", {
      doi: "10.1000/one",
      title: sharedTitle,
      year: 2024,
    }),
    crossref: record("crossref", "c40", {
      doi: "10.1000/one",
      title: sharedTitle,
      year: 2024,
    }),
  };
  /** What `mergeDecisionsOf` writes for the DOI tier's match of the pair. */
  const DOI_MERGE = {
    workKey: "doi:10.1000/one",
    tier: "doi",
    confidence: TIER_CONFIDENCE.doi,
    evidence: { doi: "10.1000/one" },
  };

  /** The provenance note the view model writes for `out`, through the gate. */
  function noteFor(out: SearchImportOutput, input: SearchImportInput): string {
    const provenance = redactSearchProvenance(
      buildProvenance(out, input, {
        runId: "run-p2t34",
        pluginVersion: "0.0.2-test",
        zoteroVersion: "10.0.3-test",
        startedAt: "2026-10-15T00:00:00.000Z",
        finishedAt: "2026-10-15T00:00:01.000Z",
      }),
    );
    expect(provenance.mergeDecisions).toStrictEqual(out.mergeDecisions);
    return renderProvenanceNoteHtml(provenance);
  }

  it("a two-source same-DOI search and import writes a provenance note whose mergeDecisions names the tier and confidence", async () => {
    const writer = stubWriter();
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[sameDoi.pubmed]] }),
        stubSource({ id: "crossref", pages: [[sameDoi.crossref]] }),
      ],
      writer: writer.writer,
    });
    const input: SearchImportInput = {
      ...BASE_INPUT,
      sourceIds: ["pubmed", "crossref"],
      target: { collectionName: "C", selectedRecordIds: [sameDoi.pubmed.id] },
    };
    const out = await h.pipeline.run(input, h.ctx);

    expect(out.outcome).toBe("succeeded");
    expect(out.write?.created).toBe(1);
    // `run` wrote `MergedWork.decisions` onto the output…
    expect(out.mergeDecisions).toStrictEqual([DOI_MERGE]);
    expect(out.mergeDecisions[0]?.confidence).toBe(1);
    // …and the note names the work, the tier and the confidence.
    const html = noteFor(out, input);
    expect(html).toContain(
      "<h2>Merge decisions</h2><ul><li><code>doi:10.1000/one</code><ul>" +
        "<li><strong>Tier</strong>: <code>doi</code></li>" +
        "<li><strong>Confidence</strong>: 1</li>",
    );
  });

  it("the import of a preview carries the preview's decisions through, and a single-source run records none", async () => {
    const h = harness({
      sources: [
        stubSource({ id: "pubmed", pages: [[sameDoi.pubmed]] }),
        stubSource({ id: "crossref", pages: [[sameDoi.crossref]] }),
      ],
    });
    const previewed = await h.pipeline.run(
      { ...BASE_INPUT, sourceIds: ["pubmed", "crossref"] },
      h.ctx,
    );
    expect(previewed.mergeDecisions).toStrictEqual([DOI_MERGE]);

    const importer = harness({ sources: [] });
    const importInput: SearchImportInput = {
      ...BASE_INPUT,
      query: "",
      sourceIds: [],
      records: previewed.records,
      works: previewed.works,
      mergeDecisions: previewed.mergeDecisions,
      target: { collectionName: "C", selectedRecordIds: [sameDoi.pubmed.id] },
    };
    const imported = await importer.pipeline.run(importInput, importer.ctx);
    expect(imported.outcome).toBe("succeeded");
    // No cascade ran on this path, so the decisions are the preview's, as given.
    expect(imported.mergeDecisions).toBe(previewed.mergeDecisions);
    expect(noteFor(imported, importInput)).toContain(
      "<strong>Tier</strong>: <code>doi</code>",
    );

    // One source, nothing to merge: `[]`, not absent (§5.3).
    const single = harness({
      sources: [stubSource({ id: "pubmed", pages: [[sameDoi.pubmed]] })],
    });
    const alone = await single.pipeline.run(BASE_INPUT, single.ctx);
    expect(alone.mergeDecisions).toStrictEqual([]);
    expect(noteFor(alone, BASE_INPUT)).toContain(
      "<h2>Merge decisions</h2><p>none</p>",
    );
  });
});
