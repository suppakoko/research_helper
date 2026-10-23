/**
 * `P1-T39` — the Search & Import window's view model at layer 1.
 *
 * ## What this file is for
 *
 * `src/ui/viewModels/searchImportViewModel.ts` decides every one of `docs/08`
 * §8.4's five panel states, folds `docs/08` §8.3's error table, and composes
 * `FR-8`'s provenance record. Before this file its arithmetic was reached from
 * exactly one place — `test/integration/searchDialog-flow.spec.ts`, which needs
 * a live Zotero and whose own header measures three load-sensitive failures
 * (`plan/00` §6 item 20). `test/unit/ui/searchImportViewModel-export.test.ts`
 * (`P1-T36`) covers one member, `exportProvenance`, and the retained record's
 * lifetime. Everything else was a Zotero launch away.
 *
 * So what is here is the **arithmetic**: the error table, the selection
 * round-trip, the latching and the per-source attribution — `P1-T22`'s own four
 * names for the assertions an integration suite cannot make cheaply.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, no Zotero global, no network, no DOM.
 * Nothing under `src/zotero/` is imported. The view model's six required
 * dependencies are a pipeline double, a job-factory double, a logger over a
 * capturing sink, two version strings and a fixed clock.
 *
 * ## What is deliberately not here
 *
 * - **No snapshot test.** A snapshot of a view state records what the code
 *   does, not what it should do (`P1-T39`'s fourth **Do NOT**).
 * - **Nothing that needs the platform.** The integration spec reads a real file
 *   back off disk, resolves real Fluent bundles through a real `document.l10n`,
 *   and writes into a real library. None of that is copied here; where an
 *   assertion below looks like one of that spec's, it is the same *calculation*
 *   asserted on the value rather than on the window.
 * - **No type-level claim asserted at run time.** {@link message}'s whole
 *   reason to exist is that `FluentArgsParam` makes a message's argument object
 *   required at *compile* time. A test cannot observe that; what it can observe
 *   is the value that reaches `data-l10n-args`, which is what section 2 does.
 *
 * ## Nothing here is a real credential
 *
 * {@link NCBI_SHAPED_KEY} is 32 hexadecimal characters, built in this file,
 * matching nothing that exists. The length is the point: `src/core/errors.ts`'s
 * last-resort pattern starts at 40, so **no redactor in this project can clean
 * this shape** — which is exactly why
 * {@link EMPTY_HEADLINE_OMITTED} keeps the query off the screen instead of
 * redacting it. A test that put a 48-character run through the gate would be
 * measuring the gate; this one measures the omission.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createSystemClock } from "../../../src/core/clock";
import { TimeoutError, type SerializedError } from "../../../src/core/errors";
import type { CancellationToken } from "../../../src/core/jobQueue/cancellation";
import type { ProgressSnapshot } from "../../../src/core/jobQueue/progress";
import { createLogger } from "../../../src/core/logger";
import {
  toSearchParams,
  type MergeDecision,
  type ProvenanceStore,
  type SearchProvenance,
} from "../../../src/core/provenance";
import type {
  Author,
  CanonicalWork,
  WorkType,
} from "../../../src/model/canonicalWork";
import { normalizeDoi, type Doi, type SourceId } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import type {
  SearchImportInput,
  SearchImportOutcome,
  SearchImportOutput,
  SearchImportSourceReport,
  SearchImportWriteReport,
} from "../../../src/pipeline/searchImport/types";
import type { Pipeline, PipelineContext } from "../../../src/pipeline/types";
import { NEW_COLLECTION_VALUE } from "../../../src/ui/dialogs/searchDialog";
import type {
  SearchWindowQuery,
  SearchWindowRecord,
} from "../../../src/ui/dialogs/searchDialog";
import type { RunEstimate } from "../../../src/pipeline/shared/estimate";
import type { CostDialogOutcome } from "../../../src/ui/dialogs/costConfirmDialog";
import {
  belowThreshold,
  buildProvenance,
  createSearchImportViewModel,
  screeningCostLine,
  screeningNeedsConfirmation,
  screeningResultCount,
  screeningThreshold,
  type ScreeningEstimateRequest,
  importPathLines,
  importSummary,
  errorDetails,
  errorView,
  everySearchFailed,
  initialViewState,
  isLookupOnly,
  message,
  roleLine,
  sourceStatusLine,
  tierLabel,
  toPipelineInput,
  toWindowRecords,
  windowSources,
  DEDUP_TIER_NAME_KEYS,
  EMPTY_HEADLINE_OMITTED,
  ERROR_DETAIL_FIELDS,
  ERROR_ROWS,
  KEY_NOTICE_SOURCE_ID,
  UNRENDERABLE_ERROR_ROWS,
  type CollectionDescriptor,
  type RerunCollection,
  type KeyStatus,
  type MessageFormatter,
  type SearchResultRow,
  type MessageRef,
  type SearchImportJobFactory,
  type SearchImportViewModel,
  type SearchImportViewModelDeps,
  type SearchViewState,
  type SourceDescriptor,
} from "../../../src/ui/viewModels/searchImportViewModel";

// ---------------------------------------------------------------------------
// 1. Fixtures and builders
// ---------------------------------------------------------------------------

/** 32 hexadecimal characters — an NCBI key's shape, and nobody's key. */
const NCBI_SHAPED_KEY = "0123456789abcdef".repeat(2);

/** The localized database name the window would have resolved. */
const DATABASE = "PubMed";

const STATUS = 503;

const PLUGIN_VERSION = "0.0.2-test";
const ZOTERO_VERSION = "10.0.3-test";
const NOW = 1_760_000_000_000;

const DOI = normalizeDoi("10.1056/nejmoa2300709");
if (DOI === null) {
  throw new Error("test fixtures must normalize");
}

/** One DOI-tier merge, as `stages.ts`'s `mergeDecisionsOf` writes it (`P2-T34`). */
const DOI_DECISION: MergeDecision = {
  workKey: `doi:${DOI}`,
  tier: "doi",
  confidence: 1,
  evidence: { doi: DOI },
};

/**
 * One `SerializedError`, as a pipeline outcome carries it.
 *
 * `detail` and `stack` default to text carrying {@link NCBI_SHAPED_KEY},
 * because the two members {@link ERROR_DETAIL_FIELDS} excludes are the two that
 * can carry one — so every assertion over an error below is also an assertion
 * that the free text did not leak.
 */
function failure(
  code: string,
  options: {
    readonly retryable?: boolean;
    readonly httpStatus?: number;
    readonly detail?: string;
    readonly stack?: string;
  } = {},
): SerializedError {
  const { httpStatus, stack } = options;
  return {
    code,
    messageKey: `rh-error-${code.toLowerCase()}`,
    detail:
      options.detail ??
      `GET https://eutils.ncbi.nlm.nih.gov/esearch?api_key=${NCBI_SHAPED_KEY}`,
    retryable: options.retryable ?? false,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(stack === undefined ? {} : { stack }),
  };
}

/** One `SourceRecord`, in the shape a mapper produces. */
function record(options: {
  readonly sourceId: SourceId;
  readonly nativeId: string;
  readonly title: string;
  readonly year?: number;
  readonly doi?: Doi;
  readonly type?: WorkType;
  readonly authors?: readonly Author[];
}): SourceRecord {
  const { year, doi } = options;
  return {
    id: `${options.sourceId}:${options.nativeId}`,
    sourceId: options.sourceId,
    nativeId: options.nativeId,
    work: {
      ids: doi === undefined ? {} : { doi },
      type: options.type ?? "journal-article",
      title: options.title,
      authors: options.authors ?? [{ family: "Kim", given: "Jisoo" }],
      ...(year === undefined
        ? {}
        : { publishedDate: { year, iso: String(year) } }),
    },
    retrievedAtEpochMs: NOW,
    missingFields: [],
  };
}

/** One per-source report, as `searchImport` returns it. */
function report(options: {
  readonly sourceId: SourceId;
  readonly recordsRetrieved?: number;
  readonly deduplicatedAway?: number;
  readonly error?: SerializedError;
  readonly transmittedQuery?: string;
}): SearchImportSourceReport {
  const { error } = options;
  return {
    sourceId: options.sourceId,
    transmittedQuery: options.transmittedQuery ?? "term=crispr",
    requestedLimit: 25,
    dateFilterApplied: "server",
    recordsRetrieved: options.recordsRetrieved ?? 0,
    droppedOutOfWindow: 0,
    keptWithoutDate: 0,
    recordsDeduplicatedAway: options.deduplicatedAway ?? 0,
    error,
    warnings: [],
  };
}

/** One write report, as the write half returns it. */
function writeReport(options: {
  readonly created: number;
  readonly linkedExisting?: number;
  readonly collectionKey?: string;
}): SearchImportWriteReport {
  return {
    libraryId: 1,
    collectionKey: options.collectionKey ?? "AAAA1111",
    collectionName: "RH P1-T39",
    collectionCreated: true,
    created: options.created,
    linkedExisting: options.linkedExisting ?? 0,
    skipped: 0,
    failed: 0,
    abstractCoveragePercent: 100,
    partialNoteRecorded: false,
  };
}

/** One `searchImport` output. */
function output(options: {
  readonly outcome: SearchImportOutcome;
  readonly records?: readonly SourceRecord[];
  /**
   * The merged works, one per record (`P2-T31`). Omitted, the output carries
   * none — the shape of a run that stopped before `Merging`, which most of
   * this file's fixtures are about (they are `stageReached: "fetching"`).
   */
  readonly works?: readonly CanonicalWork[];
  /** `Merging`'s FR-50 scenario 2 record (`P2-T34`). Omitted, `[]`. */
  readonly mergeDecisions?: readonly MergeDecision[];
  readonly perSource?: readonly SearchImportSourceReport[];
  readonly error?: SerializedError;
  readonly write?: SearchImportWriteReport;
}): SearchImportOutput {
  const { error, write } = options;
  return {
    outcome: options.outcome,
    stageReached: "fetching",
    records: options.records ?? [],
    works: options.works ?? [],
    // Required since `P2-T31`; a fixture that constructs the type names them.
    flags: [],
    links: [],
    mergeDecisions: options.mergeDecisions ?? [],
    perSource: options.perSource ?? [],
    write,
    error,
    warnings: [],
    cancellationKind: undefined,
  };
}

/**
 * The `CanonicalWork` a two-source merge of `record` would produce, with a
 * second source in `seenIn` and a won field in `fieldOrigin` — the two facts
 * `P2-T31` is about. Built by hand: this file does not run the pipeline, it
 * checks what the view model hands it.
 */
function mergedWork(record: SourceRecord, alsoIn: SourceId): CanonicalWork {
  return {
    workKey: `doi:${record.work.ids.doi ?? record.id}`,
    ids: record.work.ids,
    type: record.work.type,
    title: record.work.title,
    authors: record.work.authors,
    abstract: `An abstract ${alsoIn} supplied`,
    provenance: {
      recordIds: [record.id, `${alsoIn}:other`],
      fieldOrigin: { abstract: alsoIn },
      seenIn: [record.sourceId, alsoIn],
    },
    normalizedAtEpochMs: NOW,
  };
}

function query(overrides: Partial<SearchWindowQuery> = {}): SearchWindowQuery {
  return {
    mode: "keyword",
    keyword: "ionizable lipid nanoparticle",
    fromYear: 2024,
    toYear: 2026,
    maxResults: 25,
    sources: ["pubmed", "crossref"],
    filter: "",
    hideExisting: true,
    duplicates: "skip",
    collectionID: `${NEW_COLLECTION_VALUE}:RH P1-T39`,
    ...overrides,
  };
}

/** One progress snapshot, with only the members `onSnapshot` reads. */
function snapshot(options: {
  readonly currentStageKey?: string;
  readonly completed?: number;
  readonly total?: number;
  readonly fraction?: number;
}): ProgressSnapshot {
  return {
    status: "running",
    completed: options.completed ?? 0,
    total: options.total,
    fraction: options.fraction,
    message: "",
    currentStageKey: options.currentStageKey,
    warnings: [],
    startedAtEpochMs: NOW,
    etaSeconds: undefined,
  };
}

// ---------------------------------------------------------------------------
// 2. The doubles, and the harness over them
// ---------------------------------------------------------------------------

/** One queued pipeline run: the snapshots it publishes, then its output. */
interface Run {
  readonly snapshots?: readonly ProgressSnapshot[];
  readonly output: SearchImportOutput;
  /** Press Cancel while this run is in flight, as the user's Escape does. */
  readonly cancelMidRun?: boolean;
}

interface Harness {
  readonly model: SearchImportViewModel;
  /** Every state the connected view was handed, in order. */
  readonly states: SearchViewState[];
  /** Every line the logger emitted. */
  readonly lines: string[];
  /** Detach the recording view, as the window's unload does. */
  readonly detach: () => void;
  /**
   * The cancellation token each job was started with.
   *
   * The real `createCancellationTokenSource` is used by the view model, so
   * these are real tokens and `cancel()` is observable on them — the one part
   * of FR-10 that is arithmetic rather than platform behaviour.
   */
  readonly tokens: CancellationToken[];
  /**
   * The input each queued run was started with, in order — what the view
   * model handed the pipeline, which is the only observable `P2-T31`'s
   * "pass the preview's works back" leaves at this layer.
   */
  readonly inputs: SearchImportInput[];
  /**
   * The outcome each job's progress reporter was closed with — what the
   * progress popup is told (`docs/07` §7.7), in order (item 204).
   */
  readonly doneOutcomes: string[];
}

/**
 * Build a view model over doubles and connect a recording view.
 *
 * No `formatter` is supplied, so every source display name falls back to its
 * `sourceId` — the documented degradation, and the one that keeps this file out
 * of Fluent's way. The *ids* are what the document localizes; a resolved string
 * is the integration spec's business.
 */
function harness(options: {
  readonly runs: readonly Run[];
  readonly sources?: readonly SourceDescriptor[];
  readonly collections?: readonly CollectionDescriptor[];
  readonly isExisting?: (item: SourceRecord) => boolean;
  /** FR-2's third scenario's port (`P2-T14`). Omitted, the port is unbound. */
  readonly keyStatus?: () => KeyStatus;
  /** Further ports, bound as given (`P2-T17`: the store and the lookup). */
  readonly extra?: Partial<SearchImportViewModelDeps>;
  /** The document's `document.l10n`, handed over on connect (item 206). */
  readonly formatter?: MessageFormatter;
}): Harness {
  const states: SearchViewState[] = [];
  const lines: string[] = [];
  const tokens: CancellationToken[] = [];
  const inputs: SearchImportInput[] = [];
  const doneOutcomes: string[] = [];
  const listeners: ((item: ProgressSnapshot) => void)[] = [];
  const queue = [...options.runs];
  /**
   * The model, once it exists.
   *
   * A holder rather than a `let`, because the pipeline stub below closes over
   * it and is itself a dependency of the model's construction: the Cancel press
   * happens inside `run()`, which only runs after the model has been built.
   */
  const built: { model?: SearchImportViewModel } = {};

  const pipeline: Pipeline<SearchImportInput, SearchImportOutput> = {
    id: "searchImport",
    displayNameKey: "research-helper-pipeline-search-import",
    stages: [],
    validate: () => ({ ok: true, errors: [] }),
    // Never called: `runJob` runs the pipeline directly.
    estimate: () =>
      Promise.resolve({
        itemCount: 0,
        externalRequests: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedCostUsd: undefined,
        estimatedDurationSeconds: 0,
        notesKeys: [],
      }),
    run: (input: SearchImportInput) => {
      inputs.push(input);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error("the stub pipeline ran out of queued runs");
      }
      // Published from inside `run()`, which is where the real reporter fires:
      // the subscription is live by now and the output has not arrived.
      for (const item of next.snapshots ?? []) {
        for (const listener of [...listeners]) listener(item);
      }
      // Cancel while the job is still open, which is the only moment the
      // window's Cancel button and its Escape key can be pressed.
      if (next.cancelMidRun === true) built.model?.cancel();
      return Promise.resolve(next.output);
    },
    resumable: false,
  };

  const jobs: SearchImportJobFactory = {
    forJob: (job) => ({
      jobId: "job-1",
      context: (() => {
        tokens.push(job.token);
        return { token: job.token } as unknown as PipelineContext;
      })(),
      progress: {
        reporter: {
          done: (outcome: string): void => {
            doneOutcomes.push(outcome);
          },
        },
        events: {
          subscribe: (listener: (item: ProgressSnapshot) => void) => {
            listeners.push(listener);
            return (): void => {
              listeners.splice(listeners.indexOf(listener), 1);
            };
          },
        },
      },
      dispose: (): void => undefined,
    }),
  };

  const { sources, collections, isExisting, keyStatus } = options;
  const deps: SearchImportViewModelDeps = {
    pipeline,
    jobs,
    logger: createLogger({
      sink: {
        write: (line: string) => {
          lines.push(line);
        },
      },
      clock: createSystemClock(),
      level: "debug",
    }),
    pluginVersion: PLUGIN_VERSION,
    zoteroVersion: ZOTERO_VERSION,
    clock: { now: () => NOW },
    ...(sources === undefined ? {} : { listSources: () => sources }),
    ...(collections === undefined
      ? {}
      : { listCollections: () => collections }),
    ...(isExisting === undefined ? {} : { isExisting }),
    ...(keyStatus === undefined ? {} : { semanticScholarKeyStatus: keyStatus }),
    ...options.extra,
  };

  const model = createSearchImportViewModel(deps);
  built.model = model;
  const detach = model.connect({
    render: (state: SearchViewState) => {
      states.push(state);
    },
    ...(options.formatter === undefined
      ? {}
      : { formatter: options.formatter }),
  });
  return { model, states, lines, detach, tokens, inputs, doneOutcomes };
}

/** The two sources every state-machine test below asks. */
const TWO_SOURCES: readonly SourceDescriptor[] = [
  { id: "pubmed", displayNameKey: "research-helper-source-pubmed" },
  { id: "crossref", displayNameKey: "research-helper-source-crossref" },
];

/** The panel sequence, with consecutive repeats collapsed. */
function panels(states: readonly SearchViewState[]): readonly string[] {
  return states
    .map((state) => state.panel)
    .filter((panel, at, all) => at === 0 || all[at - 1] !== panel);
}

// ===========================================================================
// 3. `message` — one Fluent lookup, as data
// ===========================================================================

describe("P1-T39 — message()", () => {
  it("carries the id and only the arguments the caller supplied", () => {
    // A message with placeables: the object reaches `data-l10n-args` verbatim.
    expect(
      message("rh-error-auth", { provider: DATABASE, status: 401 }),
    ).toStrictEqual({
      id: "rh-error-auth",
      args: { provider: DATABASE, status: 401 },
    });

    // A message without placeables: `args` is `undefined`, **not** an empty
    // object, because the document sets no `data-l10n-args` at all in that
    // case — a stale argument object left on an element is one of the two
    // defects `P1-T20` measured in a live window.
    const plain = message("rh-error-offline");
    expect(plain).toStrictEqual({ id: "rh-error-offline", args: undefined });
    expect(Object.hasOwn(plain, "args")).toBe(true);
    expect(plain.args).toBeUndefined();
  });
});

// ===========================================================================
// 4. `errorView` — docs/08 §8.3's table
// ===========================================================================

/**
 * The §8.3 row each renderable code draws, and the actions that row offers.
 *
 * Written out rather than read back from {@link ERROR_ROWS}: a loop that built
 * its expectation by calling the table's own `ref` would compare the
 * implementation with itself and pass against any message id at all.
 */
const EXPECTED_ROWS: Readonly<
  Record<
    string,
    {
      readonly ref: MessageRef;
      readonly retry: boolean;
      readonly prefs: boolean;
    }
  >
> = {
  MISSING_CREDENTIAL: {
    ref: {
      id: "rh-error-missing-credential",
      args: { provider: DATABASE },
    },
    retry: false,
    prefs: true,
  },
  CONFIGURATION: {
    ref: { id: "rh-error-configuration", args: undefined },
    retry: false,
    prefs: true,
  },
  AUTHENTICATION: {
    ref: { id: "rh-error-auth", args: { provider: DATABASE, status: STATUS } },
    retry: false,
    prefs: true,
  },
  AUTHORIZATION: {
    ref: {
      id: "rh-error-forbidden",
      args: { provider: DATABASE, status: STATUS },
    },
    retry: false,
    prefs: true,
  },
  QUOTA_EXCEEDED: {
    ref: { id: "rh-error-quota", args: { provider: DATABASE } },
    retry: false,
    prefs: true,
  },
  OFFLINE: {
    ref: { id: "rh-error-offline", args: undefined },
    retry: true,
    prefs: false,
  },
  UPSTREAM_SERVER: {
    ref: {
      id: "rh-error-upstream",
      args: { database: DATABASE, status: STATUS },
    },
    retry: true,
    prefs: false,
  },
  PARSE: {
    ref: { id: "rh-error-parse", args: { database: DATABASE } },
    retry: true,
    prefs: false,
  },
  ZOTERO_API: {
    ref: { id: "rh-error-zotero", args: undefined },
    retry: false,
    prefs: false,
  },
  STORAGE: {
    ref: { id: "rh-error-storage", args: undefined },
    retry: false,
    prefs: false,
  },
  BAD_REQUEST: {
    ref: { id: "rh-error-bad-request", args: { database: DATABASE } },
    retry: false,
    prefs: false,
  },
  // Item 232 (owner, 2026-10-21): a 429 refused after the client's retries.
  // §8.3's action is "Retry now"; never Preferences.
  RATE_LIMIT: {
    ref: {
      id: "research-helper-search-error-rate-limit",
      args: { database: DATABASE },
    },
    retry: true,
    prefs: false,
  },
};

describe("P1-T39 — errorView() over docs/08 §8.3's table", () => {
  it("draws every renderable row, and the row's own two actions", () => {
    // The table and this file's expectation name the same codes, so a row
    // added to one without the other is a failure here rather than a row
    // nothing asserts.
    expect(Object.keys(ERROR_ROWS).toSorted()).toStrictEqual(
      Object.keys(EXPECTED_ROWS).toSorted(),
    );

    for (const [code, expected] of Object.entries(EXPECTED_ROWS)) {
      // `retryable: true` on every error, so a row whose §8.3 verdict is "no
      // retry" cannot pass by inheriting the thrower's verdict instead.
      const view = errorView(
        failure(code, { httpStatus: STATUS, retryable: true }),
        DATABASE,
      );
      expect(view.ref, code).toStrictEqual(expected.ref);
      expect(view.retry, code).toBe(expected.retry);
      expect(view.prefs, code).toBe(expected.prefs);

      // And the other way round: a mapped row's actions are the table's, so
      // flipping the error's own verdict changes nothing.
      const flipped = errorView(
        failure(code, { httpStatus: STATUS, retryable: false }),
        DATABASE,
      );
      expect(flipped.retry, code).toBe(expected.retry);
      expect(flipped.prefs, code).toBe(expected.prefs);
    }
  });

  it("supplies 0 for a status the error does not carry", () => {
    // `{ $status }` is declared by `rh-error-auth`, so the argument cannot be
    // omitted; an absent HTTP status becomes 0 rather than `undefined` painted
    // at the user as the literal string.
    expect(errorView(failure("AUTHENTICATION"), DATABASE).ref).toStrictEqual({
      id: "rh-error-auth",
      args: { provider: DATABASE, status: 0 },
    });
    expect(errorView(failure("UPSTREAM_SERVER"), DATABASE).ref).toStrictEqual({
      id: "rh-error-upstream",
      args: { database: DATABASE, status: 0 },
    });
  });

  it("sends every row this build cannot render to the generic row", () => {
    // The two §8.3 rows `UNRENDERABLE_ERROR_ROWS`' doc comment names. Listed
    // here as well so that the day one of them becomes renderable — a row in
    // `ERROR_ROWS`, or a member dropped from the constant — this test fails and
    // says to come here too. `RATE_LIMIT` left the list with item 232.
    expect([...UNRENDERABLE_ERROR_ROWS].toSorted()).toStrictEqual([
      "NETWORK",
      "TIMEOUT",
    ]);
    // Guards the loop below against a constant emptied by accident, which
    // would make every assertion in it vacuous.
    expect(UNRENDERABLE_ERROR_ROWS.length).toBeGreaterThan(0);

    for (const code of UNRENDERABLE_ERROR_ROWS) {
      expect(Object.keys(ERROR_ROWS), code).not.toContain(code);
      const view = errorView(
        failure(code, { retryable: true, httpStatus: 429 }),
        DATABASE,
      );
      // NFR-14's first two requirements: what failed, and which service.
      expect(view.ref, code).toStrictEqual({
        id: "rh-error-source",
        args: { database: DATABASE },
      });
      // No invented countdown, no Preferences button, and Retry exactly when
      // the thrower said a retry could plausibly succeed.
      expect(view.retry, code).toBe(true);
      expect(view.prefs, code).toBe(false);
      expect(errorView(failure(code), DATABASE).retry, code).toBe(false);
    }
  });

  it("still offers Retry after a timeout, which the client no longer retries by itself (item 230)", () => {
    // The real class, serialized the way a pipeline outcome carries it — not a
    // hand-built `failure(...)` — so the verdict under test is §10.1's own
    // `retryable` flag on `TimeoutError`. Item 230 (owner, 2026-10-20) moved
    // the "no automatic retry" rule into the retry policy precisely so this
    // flag, and the button it draws, stay as they were.
    const serialized = new TimeoutError(
      60_000,
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
    ).toSerialized();
    expect(serialized.code).toBe("TIMEOUT");
    expect(serialized.retryable).toBe(true);
    const view = errorView(serialized, DATABASE);
    expect(view.retry).toBe(true);
    expect(view.ref).toStrictEqual({
      id: "rh-error-source",
      args: { database: DATABASE },
    });
  });

  it("falls back to the generic row for a code the table never heard of", () => {
    const view = errorView(failure("A_CODE_NOBODY_DECLARED"), DATABASE);
    expect(view.ref).toStrictEqual({
      id: "rh-error-source",
      args: { database: DATABASE },
    });
    expect(view.retry).toBe(false);
    expect(view.prefs).toBe(false);
    expect(
      errorView(failure("A_CODE_NOBODY_DECLARED", { retryable: true }), "arXiv")
        .retry,
    ).toBe(true);
  });
});

// ===========================================================================
// 5. `errorDetails` — NFR-14's disclosure
// ===========================================================================

describe("P1-T39 — errorDetails()", () => {
  it("emits exactly the fields ERROR_DETAIL_FIELDS names, in order", () => {
    const errors = [
      failure("UPSTREAM_SERVER", { httpStatus: STATUS }),
      failure("OFFLINE"),
    ];
    const lines = errorDetails(errors);

    // Derived from the constant rather than transcribed from it: a field added
    // to `ERROR_DETAIL_FIELDS` that `errorDetails` does not emit fails here,
    // and so does a field `errorDetails` emits that the constant does not name.
    const fromConstant = errors.flatMap((error) =>
      ERROR_DETAIL_FIELDS.flatMap((field) => {
        const value = error[field];
        return value === undefined ? [] : [String(value)];
      }),
    );
    expect(lines).toStrictEqual(fromConstant);

    // And the concrete shape, so a constant and an implementation that drifted
    // together are still caught: the code, then the status, per error, with an
    // absent status contributing no line at all.
    expect(lines).toStrictEqual(["UPSTREAM_SERVER", String(STATUS), "OFFLINE"]);
    expect(errorDetails([])).toStrictEqual([]);
  });

  it("carries machine values only — the meaning of ERROR_DETAIL_FIELDS", () => {
    // `detail` is free text built from the failing request and `stack` is a
    // trace; `src/core/provenance.ts`'s gate cannot clean a 32-character key
    // out of either, which is why neither is in the constant.
    const lines = errorDetails([
      failure("UPSTREAM_SERVER", {
        httpStatus: STATUS,
        stack: `at request (https://eutils.nlm.nih.gov/?api_key=${NCBI_SHAPED_KEY})`,
      }),
    ]);
    const text = lines.join("\n");
    expect(text).not.toContain(NCBI_SHAPED_KEY);
    expect(text).not.toContain("api_key");
    expect(text).not.toContain("nlm.nih.gov");
    expect(text).not.toContain("at request");
    // Every line is a machine value: a closed enumeration member, or a number.
    for (const line of lines) {
      expect(
        /^[A-Z_]+$|^[0-9]+$/.test(line),
        `${line} is neither a code nor a number`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// 6. `initialViewState` — docs/08 §8.4's INITIAL
// ===========================================================================

describe("P1-T39 — initialViewState()", () => {
  it("is §8.4's INITIAL: nothing drawn, nothing running, nothing latched", () => {
    expect(initialViewState()).toStrictEqual({
      panel: "initial",
      running: false,
      sources: [],
      records: undefined,
      recordsRevision: 0,
      emptyHeadline: undefined,
      error: undefined,
      warnings: [],
      notices: [],
      status: undefined,
      databaseProgress: undefined,
      progressPercent: undefined,
      cancelVisible: false,
      // P3-T27: no search has been screened yet.
      screening: undefined,
    });

    // A fresh object per call, and fresh arrays with it. A shared literal would
    // make two windows — or two tests — write into one state.
    const first = initialViewState();
    const second = initialViewState();
    expect(first).not.toBe(second);
    expect(first.sources).not.toBe(second.sources);
  });
});

// ===========================================================================
// 7. `toWindowRecords` — docs/07 §5.1 as the table's rows
// ===========================================================================

describe("P1-T39 — toWindowRecords()", () => {
  it("keys each row on the record's own id and names its database", () => {
    const rows = toWindowRecords(
      [
        record({
          sourceId: "pubmed",
          nativeId: "40123456",
          title: "Ionizable lipid design",
          year: 2025,
          doi: DOI,
          type: "preprint",
          authors: [{ family: "Chen" }, { family: "Novak", given: "Ana" }],
        }),
        record({
          sourceId: "crossref",
          nativeId: "10.1/x",
          title: "A record with no year and no DOI",
        }),
      ],
      new Map([["pubmed", DATABASE]]),
      undefined,
    );

    const first = rows[0] as SearchWindowRecord;
    expect(first.key).toBe("pubmed:40123456");
    expect(first.title).toBe("Ionizable lipid design");
    expect(first.authors).toStrictEqual([
      { family: "Chen" },
      { family: "Novak", given: "Ana" },
    ]);
    expect(first.year).toBe(2025);
    expect(first.sourceLabels).toStrictEqual([DATABASE]);
    // The `WorkType` token, not a localized string: no bundle declares a
    // work-type vocabulary, and minting English here would break `P1-T20`.
    expect(first.typeLabel).toBe("preprint");
    expect(first.doi).toBe(DOI);
    // No `isExisting` port: no row is marked as already in the library.
    expect(first.existing).toBe(false);

    const second = rows[1] as SearchWindowRecord;
    // The source's own id is the fallback label, never an empty cell.
    expect(second.sourceLabels).toStrictEqual(["crossref"]);
    // `year` is absent rather than `undefined`, so the Year cell draws empty
    // instead of the string "undefined".
    expect(Object.hasOwn(second, "year")).toBe(false);
    expect(second.doi).toBe("");
    expect(rows).toHaveLength(2);
  });

  it("marks a row existing only when the probe says so", () => {
    const rows = toWindowRecords(
      [
        record({ sourceId: "pubmed", nativeId: "1", title: "Already here" }),
        record({ sourceId: "pubmed", nativeId: "2", title: "New" }),
      ],
      new Map(),
      (item) => item.nativeId === "1",
    );
    expect(rows.map((row) => row.existing)).toStrictEqual([true, false]);
  });
});

// ===========================================================================
// 8. `toPipelineInput` — the window's query as the pipeline's input
// ===========================================================================

describe("P1-T39 — toPipelineInput()", () => {
  it("builds FR-3's window from the two year menulists", () => {
    const input = toPipelineInput(query(), undefined, undefined);
    expect(input.query).toBe("ionizable lipid nanoparticle");
    expect(input.limit).toBe(25);
    expect(input.dateFilter).toStrictEqual({
      fromYear: 2024,
      toYear: 2026,
      fromDate: "2024-01-01",
      toDate: "2026-12-31",
      label: "2024 – 2026",
    });
    // A preview: no target and no records, and both members absent rather than
    // present-and-undefined, because the pipeline branches on `records`.
    expect(Object.hasOwn(input, "target")).toBe(false);
    expect(Object.hasOwn(input, "records")).toBe(false);
  });

  it("orders the two years, whichever way the user set them", () => {
    const input = toPipelineInput(
      query({ fromYear: 2026, toYear: 2024 }),
      undefined,
      undefined,
    );
    // Reversed menulists must not produce an empty window that silently
    // matches nothing.
    expect(input.dateFilter).toStrictEqual({
      fromYear: 2024,
      toYear: 2026,
      fromDate: "2024-01-01",
      toDate: "2026-12-31",
      label: "2024 – 2026",
    });
  });

  it("asks no date filter when a year is not a whole number", () => {
    expect(
      toPipelineInput(query({ fromYear: Number.NaN }), undefined, undefined)
        .dateFilter,
    ).toBe("none");
    expect(
      toPipelineInput(query({ toYear: 2026.5 }), undefined, undefined)
        .dateFilter,
    ).toBe("none");
  });

  it("drops a checkbox value that is not a registered source id", () => {
    const input = toPipelineInput(
      query({ sources: ["pubmed", "not-a-source", "crossref", ""] }),
      undefined,
      undefined,
    );
    // `SourceId` is a closed union; a value from the document that is not one
    // would reach an adapter lookup that has nothing to find.
    expect(input.sourceIds).toStrictEqual(["pubmed", "crossref"]);
  });

  it("passes the target and the held records through for the write half", () => {
    const held = [record({ sourceId: "pubmed", nativeId: "1", title: "Held" })];
    const input = toPipelineInput(
      query(),
      { collectionName: "RH P1-T39", selectedRecordIds: ["pubmed:1"] },
      held,
    );
    expect(input.target).toStrictEqual({
      collectionName: "RH P1-T39",
      selectedRecordIds: ["pubmed:1"],
    });
    expect(input.records).toBe(held);
    // No works were given, so none are claimed: the pipeline merges the
    // records itself, as it did before `P2-T31`.
    expect("works" in input).toBe(false);
  });

  it("P2-T31: passes the preview's works through beside its records, the same objects", () => {
    const first = record({ sourceId: "pubmed", nativeId: "1", title: "Held" });
    const held = [first];
    const works = [mergedWork(first, "crossref")];
    const input = toPipelineInput(
      query(),
      { collectionName: "RH P1-T39", selectedRecordIds: ["pubmed:1"] },
      held,
      works,
    );
    expect(input.records).toBe(held);
    expect(input.works).toBe(works);
  });

  it("P2-T34: passes the preview's merge decisions beside its works, and never without them", () => {
    const first = record({ sourceId: "pubmed", nativeId: "1", title: "Held" });
    const works = [mergedWork(first, "crossref")];
    const decisions = [DOI_DECISION];
    const target = {
      collectionName: "RH P1-T39",
      selectedRecordIds: ["pubmed:1"],
    };
    const withWorks = toPipelineInput(
      query(),
      target,
      [first],
      works,
      decisions,
    );
    expect(withWorks.mergeDecisions).toBe(decisions);
    // Without works the pipeline merges the records itself and records its own
    // decisions, so handing back the preview's would describe a different run.
    const without = toPipelineInput(
      query(),
      target,
      [first],
      undefined,
      decisions,
    );
    expect("mergeDecisions" in without).toBe(false);
  });
});

// ===========================================================================
// 8b. `P2-T31` — the import hands back the merged works the table showed
// ===========================================================================

describe("P2-T31 — runImport() passes the preview's works back", () => {
  const pubmed = record({
    sourceId: "pubmed",
    nativeId: "1",
    title: "Shared",
    doi: DOI,
  });
  const other = record({ sourceId: "pubmed", nativeId: "2", title: "Alone" });

  /** The window's Import press over every row the search drew. */
  function importAll(h: Harness): Promise<void> {
    const rows = h.model.state.records ?? [];
    return h.model.runImport({ ...query(), records: rows });
  }

  it("hands the pipeline the preview's records and works, by reference, so the written item is the merged work", async () => {
    const works = [mergedWork(pubmed, "crossref"), mergedWork(other, "pubmed")];
    const preview = output({
      outcome: "succeeded",
      records: [pubmed, other],
      works,
      perSource: [report({ sourceId: "pubmed", recordsRetrieved: 2 })],
    });
    const h = harness({
      runs: [
        { output: preview },
        {
          output: output({
            outcome: "succeeded",
            write: writeReport({ created: 2 }),
          }),
        },
      ],
      sources: TWO_SOURCES,
    });
    await h.model.runSearch(query());
    await importAll(h);

    expect(h.inputs).toHaveLength(2);
    const imported = h.inputs[1];
    // The same arrays the pipeline returned, not copies and not re-derived:
    // `works[i]` still belongs to `records[i]`, and every contributing source
    // and won field the table showed is what the write half receives.
    expect(imported?.records).toBe(preview.records);
    expect(imported?.works).toBe(works);
    expect(imported?.works?.[0]?.provenance.seenIn).toStrictEqual([
      "pubmed",
      "crossref",
    ]);
    expect(imported?.works?.[0]?.provenance.fieldOrigin).toStrictEqual({
      abstract: "crossref",
    });
    expect(imported?.target?.selectedRecordIds).toStrictEqual([
      pubmed.id,
      other.id,
    ]);
  });

  it("P2-T34: hands the preview's merge decisions back with its works, so the import's provenance records them", async () => {
    const works = [mergedWork(pubmed, "crossref"), mergedWork(other, "pubmed")];
    const decisions = [DOI_DECISION];
    const preview = output({
      outcome: "succeeded",
      records: [pubmed, other],
      works,
      mergeDecisions: decisions,
      perSource: [report({ sourceId: "pubmed", recordsRetrieved: 2 })],
    });
    const h = harness({
      runs: [
        { output: preview },
        {
          output: output({
            outcome: "succeeded",
            write: writeReport({ created: 2 }),
          }),
        },
      ],
      sources: TWO_SOURCES,
    });
    await h.model.runSearch(query());
    await importAll(h);
    expect(h.inputs[1]?.mergeDecisions).toBe(decisions);
  });

  it("hands back no works when the search stopped before Merging and so published none aligned with its records", async () => {
    // A cancelled fetch carries the fetch output and an empty `works`; handing
    // that pair back would be rejected as misaligned, so the import sends the
    // records alone and the pipeline merges them itself.
    const cancelled = output({
      outcome: "cancelled",
      records: [pubmed, other],
      perSource: [report({ sourceId: "pubmed", recordsRetrieved: 2 })],
    });
    const h = harness({
      runs: [
        { output: cancelled },
        {
          output: output({
            outcome: "succeeded",
            write: writeReport({ created: 2 }),
          }),
        },
      ],
      sources: TWO_SOURCES,
    });
    await h.model.runSearch(query());
    expect(h.model.state.records).toHaveLength(2);
    await importAll(h);

    const imported = h.inputs[1];
    expect(imported?.records).toBe(cancelled.records);
    expect(imported?.works).toBeUndefined();
  });
});

// ===========================================================================
// 9. `sourceStatusLine` — docs/08 §4.6's per-database row
// ===========================================================================

describe("P1-T39 — sourceStatusLine()", () => {
  it("counts a succeeded source and carries its displayNameKey", () => {
    const line = sourceStatusLine(
      report({ sourceId: "pubmed", recordsRetrieved: 12 }),
      { id: "pubmed", displayNameKey: "research-helper-source-pubmed" },
      DATABASE,
    );
    expect(line).toStrictEqual({
      sourceId: "pubmed",
      // The id, not the resolved string: the document sets it as a
      // `data-l10n-id`, so the database name is never minted here.
      nameId: "research-helper-source-pubmed",
      outcome: "succeeded",
      detail: {
        id: "research-helper-search-source-results",
        args: { count: 12 },
      },
    });

    // An unregistered source still gets a line; the name is left to the
    // document rather than guessed.
    expect(
      sourceStatusLine(
        report({ sourceId: "arxiv", recordsRetrieved: 0 }),
        undefined,
        "arXiv",
      ),
    ).toStrictEqual({
      sourceId: "arxiv",
      nameId: "",
      outcome: "succeeded",
      detail: {
        id: "research-helper-search-source-results",
        args: { count: 0 },
      },
    });
  });

  it("carries §8.3's row itself on a failed source, not a concatenation", () => {
    const line = sourceStatusLine(
      report({
        sourceId: "pubmed",
        recordsRetrieved: 0,
        error: failure("OFFLINE", { retryable: true }),
      }),
      { id: "pubmed", displayNameKey: "research-helper-source-pubmed" },
      DATABASE,
    );
    expect(line.outcome).toBe("failed");
    // Not `research-helper-search-source-failed`, whose `$reason` is "an
    // already-localized rh-error-* string, never a message id" — which this
    // module cannot produce without a formatter. So the row travels as its own
    // message and `docs/08` §10.3's no-concatenation rule holds.
    expect(line.detail).toStrictEqual({
      id: "rh-error-offline",
      args: undefined,
    });
    expect(line.detail.id).not.toBe("research-helper-search-source-failed");
  });
});

// ===========================================================================
// 10. `buildProvenance` — FR-8's record, and §5.3's per-source attribution
// ===========================================================================

/** The `meta` block the import handler supplies. */
const META = {
  runId: "run-1",
  pluginVersion: PLUGIN_VERSION,
  zoteroVersion: ZOTERO_VERSION,
  startedAt: "2026-10-13T00:00:00.000Z",
  finishedAt: "2026-10-13T00:00:07.000Z",
};

/** The input the import half ran with. */
function importInput(
  overrides: Partial<SearchImportInput> = {},
): SearchImportInput {
  return {
    query: "crispr delivery",
    sourceIds: ["pubmed"],
    limit: 25,
    dateFilter: {
      fromYear: 2024,
      toYear: 2026,
      fromDate: "2024-01-01",
      toDate: "2026-12-31",
      label: "2024 – 2026",
    },
    ...overrides,
  };
}

describe("P1-T39 — buildProvenance()", () => {
  it("attributes the run's imports to the one source that contributed", () => {
    const provenance: SearchProvenance = buildProvenance(
      output({
        outcome: "succeeded",
        records: [record({ sourceId: "pubmed", nativeId: "1", title: "A" })],
        perSource: [
          report({ sourceId: "pubmed", recordsRetrieved: 9 }),
          // Asked, contributed nothing: not a contributor, so it is not the
          // one the total belongs to.
          report({ sourceId: "crossref", recordsRetrieved: 0 }),
        ],
        write: writeReport({ created: 7, linkedExisting: 2 }),
      }),
      importInput(),
      META,
    );

    // FR-51 reports created and linked-existing separately; §5.3's
    // `recordsImported` is the run's write total, which is their sum.
    expect(provenance.totals.imported).toBe(9);
    expect(provenance.perSource[0]?.recordsImported).toBe(9);
    expect(provenance.perSource[1]?.recordsImported).toBe(0);
    expect(provenance.totals.retrieved).toBe(1);
    expect(provenance.targetLibraryId).toBe(1);
    expect(provenance.targetCollectionKey).toBe("AAAA1111");
  });

  it("attributes nothing when two sources contributed", () => {
    const provenance = buildProvenance(
      output({
        outcome: "succeeded",
        records: [
          record({ sourceId: "pubmed", nativeId: "1", title: "A" }),
          record({ sourceId: "crossref", nativeId: "2", title: "B" }),
        ],
        perSource: [
          report({ sourceId: "pubmed", recordsRetrieved: 4 }),
          report({ sourceId: "crossref", recordsRetrieved: 3 }),
        ],
        write: writeReport({ created: 7 }),
      }),
      importInput({ sourceIds: ["pubmed", "crossref"] }),
      META,
    );

    // `importWorks` batches works and cannot trace a created item back to the
    // record it came from, so a per-source figure would be a number nobody
    // measured. A zero beside a non-zero run total reads as "not attributed".
    expect(provenance.perSource.map((entry) => entry.recordsImported)).toEqual([
      0, 0,
    ]);
    expect(provenance.totals.imported).toBe(7);
  });

  it("writes the four fields the pipeline cannot supply as empty, not guessed", () => {
    const provenance = buildProvenance(
      output({
        outcome: "succeeded",
        perSource: [
          report({
            sourceId: "pubmed",
            recordsRetrieved: 2,
            deduplicatedAway: 1,
            transmittedQuery: "term=crispr",
            error: failure("PARSE", { retryable: true }),
          }),
        ],
      }),
      importInput({ dateFilter: "none" }),
      META,
    );

    const entry = provenance.perSource[0];
    // `SearchImportSourceReport` carries none of these four, and `searchAll`
    // cannot reach them. **Needs a card**, as this function's doc says.
    expect(entry?.endpointBaseUrl).toBe("");
    expect(entry?.transmittedUrl).toBe("");
    expect(entry?.rawHitCount).toBeUndefined();
    expect(entry?.sourceExtras).toBeUndefined();
    // What it does carry is carried through unchanged, error included.
    expect(entry?.transmittedQuery).toBe("term=crispr");
    expect(entry?.recordsDeduplicatedAway).toBe(1);
    expect(entry?.dateFilterApplied).toBe("server");
    expect(entry?.error?.code).toBe("PARSE");

    // No write half: a preview's record targets nothing rather than library 1.
    expect(provenance.targetLibraryId).toBe(0);
    expect(provenance.targetCollectionKey).toBeUndefined();
    expect(provenance.totals.imported).toBe(0);
    // FR-3: "the provenance record states dateFilter: none".
    expect(provenance.dateFilter).toBe("none");
    expect(provenance.schemaVersion).toBe(1);
    expect(provenance.runId).toBe("run-1");
    expect(provenance.userQuery).toBe("crispr delivery");
    expect(provenance.startedAt).toBe(META.startedAt);
    expect(provenance.finishedAt).toBe(META.finishedAt);
  });

  it("P2-T34: records the run's merge decisions — tier and confidence — as FR-50 scenario 2 asks", () => {
    const provenance = buildProvenance(
      output({ outcome: "succeeded", mergeDecisions: [DOI_DECISION] }),
      importInput(),
      META,
    );
    expect(provenance.mergeDecisions).toStrictEqual([DOI_DECISION]);
    expect(provenance.mergeDecisions[0]?.tier).toBe("doi");
    expect(provenance.mergeDecisions[0]?.confidence).toBe(1);
    // And `[]`, not absent, for a run that merged nothing.
    expect(
      buildProvenance(output({ outcome: "succeeded" }), importInput(), META)
        .mergeDecisions,
    ).toStrictEqual([]);
  });

  it("records the resolved window as two ISO bounds", () => {
    const provenance = buildProvenance(
      output({ outcome: "succeeded" }),
      importInput(),
      META,
    );
    expect(provenance.dateFilter).toStrictEqual({
      fromIso: "2024-01-01",
      toIso: "2026-12-31",
    });
  });
});

// ===========================================================================
// 11. The state machine, over doubles
// ===========================================================================

describe("P1-T39 — the run's panels, in order", () => {
  it("goes INITIAL → SEARCHING → RESULTS, and lowers Cancel at the end", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          snapshots: [snapshot({ currentStageKey: "pubmed", completed: 2 })],
          output: output({
            outcome: "succeeded",
            records: [
              record({ sourceId: "pubmed", nativeId: "1", title: "A" }),
            ],
            perSource: [report({ sourceId: "pubmed", recordsRetrieved: 1 })],
          }),
        },
      ],
    });

    await h.model.runSearch(query());

    expect(panels(h.states)).toStrictEqual(["initial", "searching", "results"]);

    // Cancel is drawn exactly while a job is in flight: `docs/08` §4.4 puts it
    // in the status bar beside the bar, and a window that keeps it after the
    // run has nothing left to cancel.
    for (const state of h.states) {
      expect(state.cancelVisible).toBe(state.running);
    }
    const last = h.states[h.states.length - 1] as SearchViewState;
    expect(last.running).toBe(false);
    expect(last.cancelVisible).toBe(false);
    // The run's transient surfaces are cleared, not left on the last value.
    expect(last.status).toBeUndefined();
    expect(last.databaseProgress).toBeUndefined();
    expect(last.progressPercent).toBeUndefined();
    expect(last.error).toBeUndefined();
    expect(h.model.state.panel).toBe("results");
  });

  it("shows EMPTY for a run that found nothing, and RESULTS otherwise", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          output: output({
            outcome: "succeeded",
            records: [],
            perSource: [report({ sourceId: "pubmed", recordsRetrieved: 0 })],
          }),
        },
      ],
    });
    await h.model.runSearch(query());
    expect(h.model.state.panel).toBe("empty");
    expect(h.model.state.records).toStrictEqual([]);
  });

  it("shows results plus FR-9's banner when one of two sources failed", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          output: output({
            outcome: "partial",
            records: [
              record({ sourceId: "pubmed", nativeId: "1", title: "A" }),
            ],
            perSource: [
              report({ sourceId: "pubmed", recordsRetrieved: 1 }),
              report({
                sourceId: "crossref",
                error: failure("OFFLINE", { retryable: true }),
              }),
            ],
          }),
        },
      ],
    });

    await h.model.runSearch(query());

    // A *completed* run: one panel plus a non-blocking banner, never the error
    // panel and never a modal.
    expect(h.model.state.panel).toBe("results");
    expect(h.model.state.error).toBeUndefined();
    expect(h.model.state.warnings).toStrictEqual([
      {
        id: "research-helper-search-state-partial",
        args: { failed: 1, succeeded: 1 },
      },
    ]);
    // The §4.6 list keeps both sources, one of each outcome.
    expect(h.model.state.sources.map((line) => line.outcome)).toStrictEqual([
      "succeeded",
      "failed",
    ]);
  });

  it("headlines a wholly failed run and folds the two actions", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          output: output({
            outcome: "failed",
            // A record carried on a failed outcome, deliberately: the table is
            // emptied by the error branch rather than left showing rows, and
            // with `records: []` in the fixture the assertion below could not
            // tell the two apart.
            records: [
              record({ sourceId: "pubmed", nativeId: "1", title: "A" }),
            ],
            perSource: [
              report({
                sourceId: "pubmed",
                error: failure("OFFLINE", { retryable: true }),
              }),
              report({
                sourceId: "crossref",
                error: failure("MISSING_CREDENTIAL", { httpStatus: 401 }),
              }),
            ],
          }),
        },
      ],
    });

    await h.model.runSearch(query());
    const error = h.model.state.error;

    expect(h.model.state.panel).toBe("error");
    expect(error?.headline).toStrictEqual({
      id: "research-helper-search-state-error",
      args: undefined,
    });
    // Only the failed sources are listed under the headline.
    expect(error?.lines.map((line) => line.sourceId)).toStrictEqual([
      "pubmed",
      "crossref",
    ]);
    // Retry because OFFLINE offers it; Open Preferences because
    // MISSING_CREDENTIAL offers it. Both are an `or` across the rows, so one
    // actionable source is enough to draw the button.
    expect(error?.retry).toBe(true);
    expect(error?.openPreferences).toBe(true);
    expect(error?.details).toStrictEqual([
      "OFFLINE",
      "MISSING_CREDENTIAL",
      "401",
    ]);
    // The table is emptied rather than left showing the previous run's rows.
    expect(h.model.state.records).toStrictEqual([]);
  });

  it("does not blame the network for a run that asked nobody", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          output: output({
            outcome: "failed",
            perSource: [],
            error: failure("CONFIGURATION"),
          }),
        },
      ],
    });

    await h.model.runSearch(query({ keyword: "" }));

    // `Planning` rejected the input before any source was asked, so the
    // headline is that error's own §8.3 row. "Could not reach any database"
    // would be exactly the misleading primary text NFR-14 forbids.
    expect(h.model.state.error?.headline).toStrictEqual({
      id: "rh-error-configuration",
      args: undefined,
    });
    expect(h.model.state.error?.lines).toStrictEqual([]);
    expect(h.model.state.error?.openPreferences).toBe(true);
    expect(h.model.state.error?.retry).toBe(false);
  });
});

describe("P1-T39 — cancel(), and the view that detaches", () => {
  it("requests cancellation on the running job's own token (FR-10)", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          snapshots: [snapshot({ currentStageKey: "pubmed", completed: 2 })],
          cancelMidRun: true,
          output: output({
            outcome: "cancelled",
            records: [],
            perSource: [report({ sourceId: "pubmed", recordsRetrieved: 2 })],
          }),
        },
      ],
    });

    // Pressing Cancel with nothing running is not an error: the document's
    // Escape handler reads `running`, but a host driven directly may not.
    expect(() => {
      h.model.cancel();
    }).not.toThrow();

    await h.model.runSearch(query());

    // One job, one cancellation source, and the reason is the user's.
    // `cancel()` is synchronous and the token's callbacks run inside it, so the
    // 2 s budget FR-10 sets belongs to the HTTP layer alone.
    expect(h.tokens).toHaveLength(1);
    expect(h.tokens[0]?.isCancellationRequested).toBe(true);
    expect(h.tokens[0]?.reason).toStrictEqual({ kind: "user" });

    // A cancelled search wrote nothing, so §8.3's CANCELLED row reports zero
    // imported rather than the window pretending nothing happened.
    expect(h.model.state.status).toStrictEqual({
      id: "rh-error-cancelled",
      args: { imported: 0 },
    });
    expect(h.model.state.running).toBe(false);
    // Nothing was fetched, so there is no table to show and the window goes
    // back to INITIAL rather than drawing an empty results panel.
    expect(h.model.state.panel).toBe("initial");
  });

  it("stops rendering into a detached view, and only that one", async () => {
    const succeeded: Run = {
      output: output({
        outcome: "succeeded",
        records: [record({ sourceId: "pubmed", nativeId: "1", title: "A" })],
        perSource: [report({ sourceId: "pubmed", recordsRetrieved: 1 })],
      }),
    };

    // One window, which unloads before the run finishes. Its `render` must not
    // be called again: the document it belongs to is gone.
    const alone = harness({ sources: TWO_SOURCES, runs: [succeeded] });
    const atUnload = alone.states.length;
    alone.detach();
    await alone.model.runSearch(query());
    expect(alone.states).toHaveLength(atUnload);
    // The run still completed; only the painting stopped.
    expect(alone.model.state.panel).toBe("results");

    // Two windows. The second connect replaces the first as the view, and the
    // first window's later detach must leave the second alone — a detach that
    // blanked whichever view happened to be current would freeze a live window.
    const two = harness({ sources: TWO_SOURCES, runs: [succeeded] });
    const second: SearchViewState[] = [];
    two.model.connect({
      render: (state: SearchViewState) => {
        second.push(state);
      },
    });
    const secondOnConnect = second.length;
    two.detach();
    await two.model.runSearch(query());
    expect(second.length).toBeGreaterThan(secondOnConnect);
    expect((second.at(-1) as SearchViewState).panel).toBe("results");
  });
});

describe("P1-T39 — a second run, and the selection that survives it", () => {
  it("replaces the first run's rows and bumps the revision once per run", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          output: output({
            outcome: "succeeded",
            records: [
              record({ sourceId: "pubmed", nativeId: "1", title: "A" }),
              record({ sourceId: "pubmed", nativeId: "2", title: "B" }),
            ],
            perSource: [report({ sourceId: "pubmed", recordsRetrieved: 2 })],
          }),
        },
        {
          snapshots: [
            snapshot({ currentStageKey: "pubmed", completed: 1 }),
            snapshot({ currentStageKey: "pubmed", completed: 3 }),
            snapshot({ currentStageKey: "crossref", completed: 1 }),
          ],
          output: output({
            outcome: "succeeded",
            records: [
              record({ sourceId: "crossref", nativeId: "9", title: "C" }),
            ],
            perSource: [report({ sourceId: "crossref", recordsRetrieved: 1 })],
          }),
        },
      ],
    });

    await h.model.runSearch(query());
    expect(h.model.state.recordsRevision).toBe(1);
    const firstRows = h.model.state.records;
    expect(firstRows?.map((row) => row.key)).toStrictEqual([
      "pubmed:1",
      "pubmed:2",
    ]);

    const mark = h.states.length;
    await h.model.runSearch(query());

    // **The invariant the selection depends on.** The document re-applies the
    // rows only when `recordsRevision` changes, and rebuilding the table resets
    // the selection — so a user who unticked five rows would watch them come
    // back four times a second if a progress snapshot bumped it. Every state
    // published while the second run was fetching carries the first run's
    // revision and the very same rows array.
    const whileSearching = h.states
      .slice(mark)
      .filter((state) => state.panel === "searching");
    expect(whileSearching.length).toBeGreaterThan(3);
    for (const state of whileSearching) {
      expect(state.recordsRevision).toBe(1);
      expect(state.records).toBe(firstRows);
    }

    // Then exactly one bump, and the new rows replace the old ones rather than
    // being appended to them.
    expect(h.model.state.recordsRevision).toBe(2);
    expect(h.model.state.records?.map((row) => row.key)).toStrictEqual([
      "crossref:9",
    ]);
  });
});

describe("P1-T39 — the latched per-database counts", () => {
  it("keeps a finished source's count while the next one is searching", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          snapshots: [
            snapshot({
              currentStageKey: "pubmed",
              completed: 12,
              fraction: 0.25,
            }),
            snapshot({
              currentStageKey: "crossref",
              completed: 5,
              fraction: 0.555,
            }),
            snapshot({
              currentStageKey: "crossref",
              completed: 9,
              fraction: 1.3,
            }),
          ],
          output: output({
            outcome: "succeeded",
            records: [
              record({ sourceId: "pubmed", nativeId: "1", title: "A" }),
            ],
            perSource: [
              report({ sourceId: "pubmed", recordsRetrieved: 12 }),
              report({ sourceId: "crossref", recordsRetrieved: 9 }),
            ],
          }),
        },
      ],
    });

    await h.model.runSearch(query());

    const searching = h.states.filter((state) => state.panel === "searching");
    // The run's own publish, then one per snapshot.
    expect(searching).toHaveLength(4);
    const [start, first, second, third] = searching as [
      SearchViewState,
      SearchViewState,
      SearchViewState,
      SearchViewState,
    ];

    // Before any snapshot: both asked sources are listed as searching, with no
    // count, and `5 of 7 databases` has nothing to say yet.
    expect(start.sources.map((line) => line.outcome)).toStrictEqual([
      "searching",
      "searching",
    ]);
    expect(start.databaseProgress).toBeUndefined();

    // While PubMed is in flight it stays "searching" even though it has
    // reported 12 — a source that is still being read is not finished.
    expect(first.sources.map((line) => line.outcome)).toStrictEqual([
      "searching",
      "searching",
    ]);
    expect(first.databaseProgress).toStrictEqual({
      id: "research-helper-search-progress-databases",
      args: { done: 0, total: 2 },
    });
    expect(first.status).toStrictEqual({
      id: "research-helper-search-status-searching",
      args: { database: "pubmed" },
    });
    expect(first.progressPercent).toBe(25);

    // The fetch moves on: PubMed's last count is latched and shown as a
    // result, which is how a finished source shows `✓ N results` before
    // `output.perSource` arrives at the end of the run.
    expect(second.sources[0]).toStrictEqual({
      sourceId: "pubmed",
      nameId: "research-helper-source-pubmed",
      outcome: "succeeded",
      detail: {
        id: "research-helper-search-source-results",
        args: { count: 12 },
      },
    });
    expect(second.sources[1]?.outcome).toBe("searching");
    expect(second.databaseProgress).toStrictEqual({
      id: "research-helper-search-progress-databases",
      args: { done: 1, total: 2 },
    });
    // 0.555 → 55.5 → 56: rounded, not truncated.
    expect(second.progressPercent).toBe(56);

    // A later snapshot for Crossref does not disturb PubMed's latched 12, and
    // a fraction above 1 is clamped rather than drawn as 130%.
    expect(third.sources[0]?.detail.args).toStrictEqual({ count: 12 });
    expect(third.sources[1]?.outcome).toBe("searching");
    expect(third.databaseProgress).toStrictEqual({
      id: "research-helper-search-progress-databases",
      args: { done: 1, total: 2 },
    });
    expect(third.progressPercent).toBe(100);
  });

  it("lists only the databases the run asked, and clears them per run", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          snapshots: [snapshot({ currentStageKey: "pubmed", completed: 12 })],
          output: output({
            outcome: "succeeded",
            records: [
              record({ sourceId: "pubmed", nativeId: "1", title: "A" }),
            ],
            perSource: [report({ sourceId: "pubmed", recordsRetrieved: 12 })],
          }),
        },
        {
          snapshots: [snapshot({ currentStageKey: "crossref", completed: 1 })],
          output: output({
            outcome: "succeeded",
            records: [],
            perSource: [report({ sourceId: "crossref", recordsRetrieved: 0 })],
          }),
        },
      ],
    });

    // Only PubMed is checked, so only PubMed may be drawn as being searched:
    // listing a database the user unchecked claims a search nobody asked for.
    await h.model.runSearch(query({ sources: ["pubmed"] }));
    const firstRun = h.states.filter((state) => state.panel === "searching");
    for (const state of firstRun) {
      expect(state.sources.map((line) => line.sourceId)).toStrictEqual([
        "pubmed",
      ]);
    }

    const mark = h.states.length;
    await h.model.runSearch(query({ sources: ["crossref"] }));
    const second = h.states
      .slice(mark)
      .filter((state) => state.panel === "searching");
    // `[0]` is the run's own publish, which sets the list but leaves
    // `databaseProgress` alone; `[1]` is the first snapshot, which is the first
    // state that counts databases.
    const start = second[0] as SearchViewState;
    const counted = second[1] as SearchViewState;
    expect(start.sources.map((line) => line.sourceId)).toStrictEqual([
      "crossref",
    ]);
    expect(start.sources[0]?.outcome).toBe("searching");
    // The previous run's latched 12 is gone: a new run starts with nothing
    // counted. Were it kept, PubMed would still be a finished database here —
    // `done` would read 1 of 1 before Crossref had returned anything, and the
    // §4.6 list would credit Crossref's run with PubMed's results.
    expect(counted.sources).toHaveLength(1);
    expect(counted.sources[0]?.outcome).toBe("searching");
    expect(counted.databaseProgress).toStrictEqual({
      id: "research-helper-search-progress-databases",
      args: { done: 0, total: 1 },
    });
  });
});

// ===========================================================================
// 12. The two security constants, by their meaning
// ===========================================================================

describe("P1-T39 — EMPTY_HEADLINE_OMITTED, as behaviour", () => {
  it("never populates the EMPTY headline, and never shows the query", async () => {
    const pasted = `crispr ${NCBI_SHAPED_KEY}`;
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          snapshots: [snapshot({ currentStageKey: "pubmed", completed: 0 })],
          output: output({
            outcome: "succeeded",
            records: [],
            perSource: [report({ sourceId: "pubmed", recordsRetrieved: 0 })],
          }),
        },
      ],
    });

    await h.model.runSearch(query({ keyword: pasted }));

    expect(h.model.state.panel).toBe("empty");
    // The member exists so the decision is visible in the type; it is never
    // filled, because `research-helper-search-state-empty` interpolates
    // `{ $query }` verbatim and a window's text is read by screenshots.
    expect(h.model.state.emptyHeadline).toBeUndefined();

    // **And nothing else carries the query either.** 32 hexadecimal characters
    // is below `src/core/errors.ts`'s 40-character last-resort pattern, so no
    // redactor in this project could clean this value — the omission is the
    // whole protection, and this asserts the omission over every state the
    // window was handed rather than over one member.
    for (const state of h.states) {
      const text = JSON.stringify(state);
      expect(text).not.toContain(NCBI_SHAPED_KEY);
      expect(text).not.toContain("crispr");
    }
    // The constant says where the decision is written down, so the next person
    // to look finds the reasoning rather than re-deciding it.
    expect(EMPTY_HEADLINE_OMITTED).toContain(
      "src/ui/viewModels/searchImportViewModel.ts",
    );
  });
});

describe("P1-T39 — ERROR_DETAIL_FIELDS, as behaviour", () => {
  it("puts machine values in the disclosure and free text nowhere", async () => {
    const h = harness({
      sources: TWO_SOURCES,
      runs: [
        {
          output: output({
            outcome: "failed",
            perSource: [
              report({
                sourceId: "pubmed",
                error: failure("UPSTREAM_SERVER", {
                  httpStatus: STATUS,
                  retryable: true,
                  stack: `at request (https://eutils.nlm.nih.gov/?api_key=${NCBI_SHAPED_KEY})`,
                }),
              }),
            ],
          }),
        },
      ],
    });

    await h.model.runSearch(query());

    // NFR-14's details disclosure: the machine code and the HTTP status, each
    // on its own line, with no prose between them.
    expect(h.model.state.error?.details).toStrictEqual([
      "UPSTREAM_SERVER",
      String(STATUS),
    ]);

    // The failing request's URL, the key inside it and the stack reach no
    // published state at all — not the disclosure, not the headline, not the
    // per-source line. `detail` is free text built from the failing request
    // and `redact()` does not catch a 32-character key inside it.
    for (const state of h.states) {
      const text = JSON.stringify(state);
      expect(text).not.toContain(NCBI_SHAPED_KEY);
      expect(text).not.toContain("api_key");
      expect(text).not.toContain("nlm.nih.gov");
      expect(text).not.toContain("at request");
    }
    // NFR-14 again: never a stack trace on the screen.
    expect(JSON.stringify(h.model.state)).not.toContain("stack");
  });
});

// ===========================================================================
// P2-T14 — chips, badges, per-source status, the role row and FR-2's notice
//
// Every assertion below is against a scripted pipeline output: the fan-out,
// the cascade and the adapters are other cards' and are not run here. What is
// asserted is what this view model *draws* from what they publish.
// ===========================================================================

/** `docs/07` §8.5's seven, in the registry's order, with `P2-T07`'s capability. */
const SEVEN_SOURCES: readonly SourceDescriptor[] = [
  { id: "pubmed", displayNameKey: "research-helper-source-pubmed" },
  { id: "europepmc", displayNameKey: "research-helper-source-europepmc" },
  { id: "crossref", displayNameKey: "research-helper-source-crossref" },
  {
    id: "semanticscholar",
    displayNameKey: "research-helper-source-semanticscholar",
  },
  { id: "arxiv", displayNameKey: "research-helper-source-arxiv" },
  {
    id: "biorxiv",
    displayNameKey: "research-helper-source-biorxiv",
    keywordSearch: false,
  },
  {
    id: "medrxiv",
    displayNameKey: "research-helper-source-medrxiv",
    keywordSearch: false,
  },
];

const SEVEN_IDS: readonly SourceId[] = [
  "pubmed",
  "europepmc",
  "crossref",
  "semanticscholar",
  "arxiv",
  "biorxiv",
  "medrxiv",
];

/** A merged work for `representative`, seen in `seenIn`, holding `recordIds`. */
function workOf(
  representative: SourceRecord,
  seenIn: readonly SourceId[],
  recordIds: readonly string[] = [representative.id],
): CanonicalWork {
  return {
    workKey: `hash:${representative.id}`,
    ids: representative.work.ids,
    type: representative.work.type,
    title: representative.work.title,
    authors: representative.work.authors,
    provenance: { recordIds, fieldOrigin: {}, seenIn },
    normalizedAtEpochMs: NOW,
  };
}

type FlagPair = SearchImportOutput["flags"][number];
type LinkPair = SearchImportOutput["links"][number];

function flag(
  a: SourceRecord,
  b: SourceRecord,
  confidence: number,
  tier: FlagPair["decision"]["tier"] = "title-fuzzy",
): FlagPair {
  return {
    a,
    b,
    decision: { verdict: "flag", tier, confidence, evidence: {} },
  };
}

/** The role row, as `roleLine` builds it, for one of the two servers. */
function role(sourceId: "biorxiv" | "medrxiv"): unknown {
  return {
    sourceId,
    nameId: `research-helper-source-${sourceId}`,
    outcome: "role",
    detail: { id: "research-helper-search-source-role", args: undefined },
  };
}

describe("P2-T14 — source chips from provenance.seenIn (step 2)", () => {
  it("renders one chip per contributing source: three sources, three chips", () => {
    const representative = record({
      sourceId: "pubmed",
      nativeId: "1",
      title: "Found three times",
    });
    const [row] = toWindowRecords(
      [representative],
      new Map([
        ["pubmed", "PubMed"],
        ["crossref", "Crossref"],
        ["europepmc", "Europe PMC"],
      ]),
      undefined,
      {
        works: [workOf(representative, ["pubmed", "crossref", "europepmc"])],
        flags: [],
        links: [],
      },
    ) as [SearchResultRow];

    expect(row.sourceIds).toStrictEqual(["pubmed", "crossref", "europepmc"]);
    expect(row.sourceLabels).toStrictEqual([
      "PubMed",
      "Crossref",
      "Europe PMC",
    ]);
  });

  it("falls back to the representative's own source when no aligned works exist", () => {
    const first = record({ sourceId: "pubmed", nativeId: "1", title: "A" });
    const rows = toWindowRecords(
      [first, record({ sourceId: "crossref", nativeId: "2", title: "B" })],
      new Map(),
      undefined,
      // One work for two records: misaligned, so it is not read at all.
      { works: [workOf(first, ["pubmed", "arxiv"])], flags: [], links: [] },
    );
    expect(rows.map((row) => row.sourceIds)).toStrictEqual([
      ["pubmed"],
      ["crossref"],
    ]);
  });

  it("draws the preview's chips in the published table after a search", async () => {
    const a = record({ sourceId: "pubmed", nativeId: "1", title: "A" });
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: output({
            outcome: "succeeded",
            records: [a],
            works: [workOf(a, ["pubmed", "crossref", "semanticscholar"])],
            perSource: [
              report({ sourceId: "pubmed", recordsRetrieved: 1 }),
              report({ sourceId: "crossref", recordsRetrieved: 1 }),
              report({ sourceId: "semanticscholar", recordsRetrieved: 1 }),
            ],
          }),
        },
      ],
    });
    await h.model.runSearch(
      query({ sources: ["pubmed", "crossref", "semanticscholar"] }),
    );
    const rows = h.model.state.records ?? [];
    // No formatter is connected, so each label is the id (the documented
    // fallback), one per contributing source.
    expect(rows[0]?.sourceLabels).toStrictEqual([
      "pubmed",
      "crossref",
      "semanticscholar",
    ]);
  });
});

describe("P2-T14 — the duplicate badge on a flagged pair (step 3)", () => {
  const a = record({ sourceId: "pubmed", nativeId: "1", title: "Lipid A" });
  const b = record({ sourceId: "crossref", nativeId: "2", title: "Lipid A." });
  const c = record({ sourceId: "arxiv", nativeId: "3", title: "Other" });
  const singles = (): readonly CanonicalWork[] => [
    workOf(a, ["pubmed"]),
    workOf(b, ["crossref"]),
    workOf(c, ["arxiv"]),
  ];

  it("badges both rows of a flagged pair, naming the tier and the score, and keeps them two rows", () => {
    const rows = toWindowRecords([a, b, c], new Map(), undefined, {
      works: singles(),
      flags: [flag(a, b, 0.873)],
      links: [],
    });

    // Never pre-merged: three records in, three rows out, three keys.
    expect(rows.map((row) => row.key)).toStrictEqual([a.id, b.id, c.id]);
    const expected = {
      id: "research-helper-search-row-duplicate",
      args: { tier: "title-fuzzy", score: 87 },
    };
    expect(rows[0]?.duplicate).toStrictEqual({
      withKeys: [b.id],
      ref: expected,
    });
    expect(rows[1]?.duplicate).toStrictEqual({
      withKeys: [a.id],
      ref: expected,
    });
    expect(rows[2]?.duplicate).toBeUndefined();
    // A flag is not a link.
    expect(rows.every((row) => row.linked === undefined)).toBe(true);
  });

  it("finds the row of a flagged record the cascade merged into another work", () => {
    // `b` was merged into `a`'s work, so `a`'s row stands for it: the pair
    // (b, c) badges `a`'s row and `c`'s row, and the pair (a, b) lands on one
    // row and is dropped — already merged, nothing to review.
    const rows = toWindowRecords([a, c], new Map(), undefined, {
      works: [
        workOf(a, ["pubmed", "crossref"], [a.id, b.id]),
        workOf(c, ["arxiv"]),
      ],
      flags: [flag(b, c, 0.75, "version-link"), flag(a, b, 0.9)],
      links: [],
    });
    expect(rows[0]?.duplicate?.withKeys).toStrictEqual([c.id]);
    expect(rows[1]?.duplicate?.withKeys).toStrictEqual([a.id]);
    expect(rows[0]?.duplicate?.ref.args).toStrictEqual({
      tier: "version-link",
      score: 75,
    });
  });

  it("keeps the strongest pair's tooltip when a row is flagged twice", () => {
    const rows = toWindowRecords([a, b, c], new Map(), undefined, {
      works: singles(),
      flags: [flag(a, b, 0.86), flag(a, c, 0.97, "title-exact")],
      links: [],
    });
    expect(rows[0]?.duplicate?.withKeys).toStrictEqual([b.id, c.id]);
    expect(rows[0]?.duplicate?.ref.args).toStrictEqual({
      tier: "title-exact",
      score: 97,
    });
  });

  it("names the tier in words when its name was resolved, and falls back to the id only without one (item 206)", () => {
    const rows = toWindowRecords([a, b, c], new Map(), undefined, {
      works: singles(),
      flags: [flag(a, b, 0.873)],
      links: [],
      tierNames: new Map([["title-fuzzy", "close title match"]]),
    });
    expect(rows[0]?.duplicate?.ref.args).toStrictEqual({
      tier: "close title match",
      score: 87,
    });
    expect(tierLabel("title-exact", new Map())).toBe("title-exact");
    expect(tierLabel(null, undefined)).toBe("");
  });

  it("names every tier that can flag or link, each with a searchDialog bundle message (item 206)", () => {
    expect(Object.keys(DEDUP_TIER_NAME_KEYS).sort()).toStrictEqual([
      "title-exact",
      "title-fuzzy",
      "version-link",
    ]);
    const bundle = enUsSearchDialog();
    for (const id of Object.values(DEDUP_TIER_NAME_KEYS)) {
      expect(bundle.get(id)?.trim(), id).not.toBe("");
      expect(bundle.get(id), id).toBeDefined();
    }
  });

  it("hands the duplicate tooltip the bundle's tier name, resolved through the connected formatter (item 206)", async () => {
    const bundle = enUsSearchDialog();
    const formatter: MessageFormatter = {
      formatMessages: (keys) =>
        Promise.resolve(
          keys.map((key) => {
            const value = bundle.get(key.id);
            return value === undefined ? undefined : { value };
          }),
        ),
    };
    const h = harness({
      sources: SEVEN_SOURCES,
      formatter,
      runs: [
        {
          output: {
            ...output({
              outcome: "succeeded",
              records: [a, b, c],
              works: singles(),
              perSource: [report({ sourceId: "pubmed", recordsRetrieved: 3 })],
            }),
            flags: [flag(a, b, 0.873)],
          },
        },
      ],
    });
    await h.model.runSearch(query({ sources: ["pubmed"] }));
    const rows = h.model.state.records ?? [];
    const name = bundle.get(DEDUP_TIER_NAME_KEYS["title-fuzzy"]);
    expect(name).toBeDefined();
    expect(rows[0]?.duplicate?.ref.args).toStrictEqual({
      tier: name,
      score: 87,
    });
    expect(rows[0]?.duplicate?.ref.args).not.toMatchObject({
      tier: "title-fuzzy",
    });
  });

  it("marks a linked pair with the linked badge, by work key", () => {
    const link: LinkPair = {
      aWorkKey: `hash:${a.id}`,
      bWorkKey: `hash:${c.id}`,
      preprintWorkKey: `hash:${c.id}`,
      decision: {
        verdict: "link",
        tier: "version-link",
        confidence: 1,
        evidence: {},
      },
    };
    const rows = toWindowRecords([a, b, c], new Map(), undefined, {
      works: singles(),
      flags: [],
      links: [link],
    });
    expect(rows[0]?.linked).toStrictEqual({
      withKeys: [c.id],
      ref: { id: "research-helper-search-row-linked", args: undefined },
    });
    expect(rows[2]?.linked?.withKeys).toStrictEqual([a.id]);
    expect(rows[1]?.linked).toBeUndefined();
  });

  it("item 146: the import of a preview leaves the preview's badges drawn", async () => {
    const works = [workOf(a, ["pubmed"]), workOf(b, ["crossref"])];
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: {
            ...output({
              outcome: "succeeded",
              records: [a, b],
              works,
              perSource: [
                report({ sourceId: "pubmed", recordsRetrieved: 1 }),
                report({ sourceId: "crossref", recordsRetrieved: 1 }),
              ],
            }),
            flags: [flag(a, b, 0.88)],
          },
        },
        {
          // The import's own output: `flags` and `links` empty by design.
          output: output({
            outcome: "succeeded",
            records: [a, b],
            works,
            write: writeReport({ created: 2 }),
          }),
        },
      ],
    });
    await h.model.runSearch(query());
    const before = h.model.state.records;
    expect(before?.filter((row) => row.duplicate !== undefined)).toHaveLength(
      2,
    );
    const revision = h.model.state.recordsRevision;

    await h.model.runImport({ ...query(), records: before ?? [] });

    expect(h.inputs).toHaveLength(2);
    expect(h.model.state.recordsRevision).toBe(revision);
    expect(h.model.state.records).toBe(before);
    expect(
      h.model.state.records?.filter((row) => row.duplicate !== undefined),
    ).toHaveLength(2);
  });
});

describe("P2-T14 — the per-source status block and the ⊕ role row (step 4)", () => {
  it("draws one line per selected source, and the two lookup-only servers as their role from the first frame", async () => {
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          snapshots: [
            snapshot({ currentStageKey: "pubmed", completed: 43 }),
            // A snapshot naming bioRxiv must not turn its role into a count.
            snapshot({ currentStageKey: "biorxiv", completed: 0 }),
            snapshot({ currentStageKey: "crossref", completed: 50 }),
          ],
          output: output({
            outcome: "succeeded",
            records: [
              record({ sourceId: "pubmed", nativeId: "1", title: "A" }),
            ],
            perSource: SEVEN_IDS.map((sourceId) =>
              report({
                sourceId,
                recordsRetrieved:
                  sourceId === "biorxiv" || sourceId === "medrxiv" ? 0 : 3,
              }),
            ),
          }),
        },
      ],
    });

    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));

    const searching = h.states.filter((state) => state.panel === "searching");
    expect(searching.length).toBeGreaterThan(1);
    for (const state of searching) {
      // One line per selected source, in registry order.
      expect(state.sources.map((line) => line.sourceId)).toStrictEqual([
        ...SEVEN_IDS,
      ]);
      expect(state.sources[5]).toStrictEqual(role("biorxiv"));
      expect(state.sources[6]).toStrictEqual(role("medrxiv"));
    }
    // Independently: PubMed has latched its 43 while Crossref is in flight,
    // and the other three are still searching.
    const last = searching.at(-1);
    expect(last?.sources.map((line) => line.outcome)).toStrictEqual([
      "succeeded",
      "searching",
      "searching",
      "searching",
      "searching",
      "role",
      "role",
    ]);
    expect(last?.sources[0]?.detail.args).toStrictEqual({ count: 43 });

    // The final block: five counts and two roles — never a zero for the two.
    expect(h.model.state.sources.map((line) => line.outcome)).toStrictEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
      "role",
      "role",
    ]);
    for (const state of h.states) {
      for (const line of state.sources.filter((item) =>
        ["biorxiv", "medrxiv"].includes(item.sourceId),
      )) {
        expect(line.outcome).toBe("role");
        expect(line.detail.id).toBe("research-helper-search-source-role");
        expect(line.detail.args).toBeUndefined();
      }
    }
  });

  it("draws a real failure on a lookup-only server as an error, not as its role", () => {
    const biorxiv = SEVEN_SOURCES[5];
    const line = sourceStatusLine(
      report({
        sourceId: "biorxiv",
        error: failure("UPSTREAM_SERVER", { httpStatus: 503, retryable: true }),
      }),
      biorxiv,
      "bioRxiv",
    );
    expect(line.outcome).toBe("failed");
    expect(line.detail).toStrictEqual({
      id: "rh-error-upstream",
      args: { database: "bioRxiv", status: 503 },
    });
    // And a clean report on the same server is its role, not "0 results".
    expect(
      sourceStatusLine(report({ sourceId: "biorxiv" }), biorxiv, "bioRxiv"),
    ).toStrictEqual(role("biorxiv"));
    expect(roleLine("medrxiv", "research-helper-source-medrxiv")).toStrictEqual(
      role("medrxiv"),
    );
    expect(isLookupOnly(SEVEN_SOURCES[0])).toBe(false);
    expect(isLookupOnly(undefined)).toBe(false);
  });

  it("does not count the two servers among the sources results came from", async () => {
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: output({
            outcome: "partial",
            records: [
              record({ sourceId: "pubmed", nativeId: "1", title: "A" }),
            ],
            perSource: [
              report({ sourceId: "pubmed", recordsRetrieved: 1 }),
              report({
                sourceId: "crossref",
                error: failure("OFFLINE", { retryable: true }),
              }),
              report({ sourceId: "biorxiv" }),
              report({ sourceId: "medrxiv" }),
            ],
          }),
        },
      ],
    });
    await h.model.runSearch(
      query({ sources: ["pubmed", "crossref", "biorxiv", "medrxiv"] }),
    );
    expect(h.model.state.panel).toBe("results");
    expect(h.model.state.warnings).toStrictEqual([
      {
        id: "research-helper-search-state-partial",
        args: { failed: 1, succeeded: 1 },
      },
    ]);
  });
});

describe("P2-T14 — the all-failed state (step 5)", () => {
  it("draws §4.6's all-failed panel when every searching source failed, although the two servers make the run 'partial'", async () => {
    const searchingIds: readonly SourceId[] = SEVEN_IDS.filter(
      (id) => id !== "biorxiv" && id !== "medrxiv",
    );
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: output({
            // `fetchStateFromReports`' verdict: two reports carry no error.
            outcome: "partial",
            perSource: SEVEN_IDS.map((sourceId) =>
              searchingIds.includes(sourceId)
                ? report({
                    sourceId,
                    error:
                      sourceId === "semanticscholar"
                        ? failure("AUTHORIZATION", { httpStatus: 403 })
                        : failure("OFFLINE", { retryable: true }),
                  })
                : report({ sourceId }),
            ),
          }),
        },
      ],
    });

    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));

    expect(h.model.state.panel).toBe("error");
    const error = h.model.state.error;
    expect(error?.headline.id).toBe("research-helper-search-state-error");
    // One line per failed source, each carrying its database's name id.
    expect(error?.lines.map((line) => line.sourceId)).toStrictEqual(
      searchingIds,
    );
    expect(error?.lines.map((line) => line.nameId)).toStrictEqual(
      searchingIds.map((id) => `research-helper-source-${id}`),
    );
    // §8.3's AUTHORIZATION row offers Open Preferences; OFFLINE offers Retry.
    expect(error?.openPreferences).toBe(true);
    expect(error?.retry).toBe(true);
    expect(h.model.state.warnings).toStrictEqual([]);
  });

  it("decides 'every search failed' from the capability, never from the two servers", () => {
    const failedPubmed = report({
      sourceId: "pubmed",
      error: failure("OFFLINE"),
    });
    const quietBiorxiv = report({ sourceId: "biorxiv" });
    expect(everySearchFailed([failedPubmed, quietBiorxiv], SEVEN_SOURCES)).toBe(
      true,
    );
    // Only the two servers asked: nothing that searches failed.
    expect(everySearchFailed([quietBiorxiv], SEVEN_SOURCES)).toBe(false);
    // A searching source that yielded before it failed is degraded, not failed.
    expect(
      everySearchFailed(
        [
          report({
            sourceId: "pubmed",
            recordsRetrieved: 2,
            error: failure("OFFLINE"),
          }),
          quietBiorxiv,
        ],
        SEVEN_SOURCES,
      ),
    ).toBe(false);
    expect(
      everySearchFailed(
        [failedPubmed, report({ sourceId: "crossref", recordsRetrieved: 1 })],
        SEVEN_SOURCES,
      ),
    ).toBe(false);
  });
});

describe("P2-T14 — FR-2's Semantic Scholar no-key notice (step 6)", () => {
  const REQUEST_URL = "https://example.invalid/request-a-key";

  it("marks Semantic Scholar, and only it, when no key is present", () => {
    const listed = windowSources(SEVEN_SOURCES, {
      present: false,
      requestUrl: REQUEST_URL,
    });
    expect(
      listed.filter((source) => source.keyNotice).map((source) => source.id),
    ).toStrictEqual([KEY_NOTICE_SOURCE_ID]);
    expect(
      listed.find((source) => source.id === KEY_NOTICE_SOURCE_ID)
        ?.keyRequestUrl,
    ).toBe(REQUEST_URL);
    expect(
      listed.filter((source) => source.keyRequestUrl !== undefined),
    ).toHaveLength(1);
    // The capability travels with the list unchanged.
    expect(listed.map((source) => source.keywordSearch)).toStrictEqual(
      SEVEN_SOURCES.map((source) => source.keywordSearch),
    );
  });

  it("draws no notice when a key is present, or when nothing reports either way", () => {
    for (const key of [{ present: true, requestUrl: REQUEST_URL }, undefined]) {
      expect(
        windowSources(SEVEN_SOURCES, key).some((source) => source.keyNotice),
      ).toBe(false);
    }
  });

  it("hands the window the notice through the host, read on every call", () => {
    let present = false;
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [],
      keyStatus: () => ({ present, requestUrl: REQUEST_URL }),
    });
    const noticed = (): readonly string[] =>
      h.model.host
        .listSources()
        .filter((source) => source.keyNotice)
        .map((source) => source.id);
    expect(noticed()).toStrictEqual(["semanticscholar"]);
    present = true;
    expect(noticed()).toStrictEqual([]);
  });
});

describe("P2-T14 — the window's ticked set reaches the sources preference (step 1)", () => {
  it("forwards registered ids only, through the port", () => {
    const saved: (readonly SourceId[])[] = [];
    const h = harness({ sources: SEVEN_SOURCES, runs: [] });
    // The harness binds no write port: the host degrades to a no-op.
    expect(() => {
      h.model.host.saveSources(["pubmed"]);
    }).not.toThrow();

    const model = createSearchImportViewModel({
      pipeline: {} as unknown as SearchImportViewModelDeps["pipeline"],
      jobs: {} as unknown as SearchImportJobFactory,
      logger: createLogger({
        sink: { write: () => undefined },
        clock: createSystemClock(),
        level: "debug",
      }),
      pluginVersion: PLUGIN_VERSION,
      zoteroVersion: ZOTERO_VERSION,
      clock: { now: () => NOW },
      saveSources: (ids) => {
        saved.push(ids);
      },
    });
    model.host.saveSources(["pubmed", "toString", "biorxiv", "openalex-ish"]);
    expect(saved).toStrictEqual([["pubmed", "biorxiv"]]);
  });
});

// ---------------------------------------------------------------------------
// P2-T17 — FR-12's re-run: the row after the note, the seed, the summary
// ---------------------------------------------------------------------------

/** One `putProvenance` call, as the recording store saw it. */
interface StoredRow {
  readonly record: SearchProvenance;
  readonly libraryId: number;
  readonly collectionKey: string | undefined;
  readonly noteKey: string | undefined;
}

/**
 * A `ProvenanceStore` that records every write — and, through `events`, the
 * order of note and row — and answers reads from what it holds, latest last.
 */
function recordingStore(events: string[] = []): ProvenanceStore & {
  readonly rows: StoredRow[];
} {
  const rows: StoredRow[] = [];
  return {
    rows,
    putProvenance(record, libraryId, collectionKey, noteKey) {
      events.push(`row:${noteKey ?? "none"}`);
      rows.push({ record, libraryId, collectionKey, noteKey });
      return Promise.resolve();
    },
    findProvenanceByCollection(libraryId, collectionKey) {
      const found = rows.filter(
        (row) =>
          row.libraryId === libraryId && row.collectionKey === collectionKey,
      );
      return Promise.resolve(found[found.length - 1]?.record);
    },
  };
}

/** The collection the menu was invoked on, as the composition root finds it. */
const RERUN_COLLECTION: RerunCollection = {
  libraryId: 1,
  collectionKey: "AAAA1111",
  name: "CRISPR delivery / 2026 screen",
};

/** A stored record whose window predates `currentYear − 2` (§4.6 rule 2). */
const STORED: SearchProvenance = {
  schemaVersion: 1,
  runId: "1700000000000-1",
  pluginVersion: PLUGIN_VERSION,
  zoteroVersion: ZOTERO_VERSION,
  startedAt: "2026-03-14T09:00:00.000Z",
  finishedAt: "2026-03-14T09:00:30.000Z",
  userQuery: "lipid nanoparticle CRISPR delivery",
  dateFilter: { fromIso: "2019-01-01", toIso: "2021-12-31" },
  targetLibraryId: 1,
  targetCollectionKey: "AAAA1111",
  perSource: [
    {
      sourceId: "pubmed",
      endpointBaseUrl: "",
      transmittedQuery: "term=x",
      transmittedUrl: "",
      dateFilterApplied: "server",
      requestedLimit: 40,
      rawHitCount: undefined,
      recordsRetrieved: 40,
      recordsDeduplicatedAway: 0,
      recordsImported: 40,
      error: undefined,
      sourceExtras: undefined,
    },
  ],
  totals: { retrieved: 142, deduplicatedAway: 0, imported: 37 },
  mergeDecisions: [],
};

/** One fetched record, and the two outputs a search-then-import produces. */
const RERUN_RECORD = record({
  sourceId: "pubmed",
  nativeId: "1",
  title: "In vivo editing",
  doi: DOI,
});
const FETCHED = output({
  outcome: "succeeded",
  records: [RERUN_RECORD],
  perSource: [report({ sourceId: "pubmed", recordsRetrieved: 1 })],
});
const WRITTEN = output({
  outcome: "succeeded",
  write: writeReport({ created: 1 }),
});

/** Search, then import every row the search published. */
async function searchThenImport(
  h: Harness,
  mode: "keyword" | "rerun" = "keyword",
): Promise<void> {
  await h.model.runSearch(query({ mode }));
  await h.model.runImport({
    ...query({ mode }),
    records: h.model.state.records ?? [],
  });
}

describe("P2-T17 — the run's search_provenance row (step 4)", () => {
  it("writes the row after the note, carrying the note's key, once per import", async () => {
    const events: string[] = [];
    const store = recordingStore(events);
    const h = harness({
      runs: [{ output: FETCHED }, { output: WRITTEN }],
      sources: TWO_SOURCES,
      extra: {
        provenanceStore: store,
        writeProvenanceNote: () => {
          events.push("note");
          return Promise.resolve("NOTE7777");
        },
      },
    });
    await searchThenImport(h);

    expect(events).toStrictEqual(["note", "row:NOTE7777"]);
    expect(store.rows).toHaveLength(1);
    const [row] = store.rows;
    expect(row?.libraryId).toBe(1);
    expect(row?.collectionKey).toBe("AAAA1111");
    expect(row?.noteKey).toBe("NOTE7777");
    expect(row?.record.targetCollectionKey).toBe("AAAA1111");
    expect(row?.record.userQuery).toBe(query().keyword);
  });

  it("records the search's sources on the import's row, since an import run asks none", async () => {
    // `WRITTEN` reports no source, exactly as the real pipeline does when it
    // is handed records; the search before it asked PubMed.
    expect(WRITTEN.perSource).toStrictEqual([]);
    const store = recordingStore();
    const h = harness({
      runs: [{ output: FETCHED }, { output: WRITTEN }],
      sources: TWO_SOURCES,
      extra: { provenanceStore: store },
    });
    await searchThenImport(h);
    const entries = store.rows[0]?.record.perSource ?? [];
    expect(
      entries.map((entry) => [
        entry.sourceId,
        entry.requestedLimit,
        entry.recordsRetrieved,
        entry.recordsImported,
      ]),
    ).toStrictEqual([["pubmed", 25, 1, 1]]);
    // …which is what a re-run reads its databases and its limit from.
    const params = toSearchParams(store.rows[0]!.record, {
      advanceDateWindow: false,
      now: NOW,
    });
    expect(params.sourceIds).toStrictEqual(["pubmed"]);
    expect(params.requestedLimit).toBe(25);
  });

  it("still writes the row, with no note key, when the note fails", async () => {
    const store = recordingStore();
    const h = harness({
      runs: [{ output: FETCHED }, { output: WRITTEN }],
      sources: TWO_SOURCES,
      extra: {
        provenanceStore: store,
        writeProvenanceNote: () => Promise.reject(new Error("note refused")),
      },
    });
    await searchThenImport(h);
    expect(store.rows.map((row) => row.noteKey)).toStrictEqual([undefined]);
  });

  it("keeps the summary when the row cannot be written, and says so in the log", async () => {
    const h = harness({
      runs: [{ output: FETCHED }, { output: WRITTEN }],
      sources: TWO_SOURCES,
      extra: {
        provenanceStore: {
          putProvenance: () => Promise.reject(new Error("locked")),
          findProvenanceByCollection: () => Promise.resolve(undefined),
        },
      },
    });
    await searchThenImport(h);
    expect(h.model.state.status?.id).toBe("research-helper-import-summary");
    expect(h.lines.join("\n")).toContain("row could not be written");
  });
});

describe("P2-T17 — loadRerun() seeds the window from the row (steps 3, 6, 7)", () => {
  it("returns both date choices, the banner's facts and the recorded parameters", async () => {
    const store = recordingStore();
    await store.putProvenance(STORED, 1, "AAAA1111", "NOTE0001");
    const asked: number[] = [];
    const h = harness({
      runs: [],
      extra: {
        provenanceStore: store,
        findCollection: (id) => {
          asked.push(id);
          return RERUN_COLLECTION;
        },
      },
    });

    const seed = await h.model.host.loadRerun(4242);
    expect(asked).toStrictEqual([4242]);
    expect(seed).toStrictEqual({
      collectionID: 4242,
      collectionName: RERUN_COLLECTION.name,
      recordedAt: STORED.finishedAt,
      databases: 1,
      retrieved: 142,
      imported: 37,
      asRecorded: toSearchParams(STORED, {
        advanceDateWindow: false,
        now: NOW,
      }),
      advanced: toSearchParams(STORED, { advanceDateWindow: true, now: NOW }),
    });
    expect(seed?.asRecorded.dateWindow).toStrictEqual({
      fromIso: "2019-01-01",
      toIso: "2021-12-31",
    });
    expect(seed?.advanced.dateWindow).toMatchObject({ fromIso: "2019-01-01" });
  });

  it("returns the view to INITIAL with an empty table, so the re-run panel is what shows", async () => {
    const store = recordingStore();
    await store.putProvenance(STORED, 1, "AAAA1111", undefined);
    const h = harness({
      runs: [{ output: FETCHED }, { output: WRITTEN }],
      sources: TWO_SOURCES,
      extra: {
        provenanceStore: store,
        findCollection: () => RERUN_COLLECTION,
        provenanceFiles: { writeTextFile: () => Promise.resolve(undefined) },
      },
    });
    await searchThenImport(h);
    expect(h.model.state.panel).toBe("results");
    const before = h.model.state.recordsRevision;

    await h.model.loadRerun(4242);
    expect(h.model.state.panel).toBe("initial");
    expect(h.model.state.records).toStrictEqual([]);
    expect(h.model.state.notices).toStrictEqual([]);
    expect(h.model.state.recordsRevision).toBeGreaterThan(before);
    expect(await h.model.exportProvenance("/tmp/x.json")).toBe("no-record");
  });

  it("returns nothing — and the window opens unseeded — with no row, no store or no collection", async () => {
    const empty = harness({
      runs: [],
      extra: {
        provenanceStore: recordingStore(),
        findCollection: () => RERUN_COLLECTION,
      },
    });
    expect(await empty.model.loadRerun(1)).toBeUndefined();

    const noStore = harness({
      runs: [],
      extra: { findCollection: () => RERUN_COLLECTION },
    });
    expect(await noStore.model.loadRerun(1)).toBeUndefined();

    const store = recordingStore();
    await store.putProvenance(STORED, 1, "AAAA1111", undefined);
    const noCollection = harness({
      runs: [],
      extra: { provenanceStore: store, findCollection: () => undefined },
    });
    expect(await noCollection.model.loadRerun(1)).toBeUndefined();
  });
});

describe("P2-T17 — toPipelineInput() runs the re-run's exact window", () => {
  it("sends the recorded bounds verbatim, not re-derived from the two years", () => {
    const input = toPipelineInput(
      query({
        fromYear: 2019,
        toYear: 2021,
        dateWindow: { fromIso: "2019-01-01", toIso: "2021-12-31" },
      }),
      undefined,
      undefined,
    );
    expect(input.dateFilter).toStrictEqual({
      fromYear: 2019,
      toYear: 2021,
      fromDate: "2019-01-01",
      toDate: "2021-12-31",
      label: "2019 – 2021",
    });
  });

  it("ends an advanced window on today, not on 31 December", () => {
    const input = toPipelineInput(
      query({ dateWindow: { fromIso: "2019-01-01", toIso: "2026-10-15" } }),
      undefined,
      undefined,
    );
    expect(input.dateFilter).toMatchObject({
      fromDate: "2019-01-01",
      toDate: "2026-10-15",
    });
  });

  it('runs All years as dateFilter "none", and ignores a window it cannot read', () => {
    expect(
      toPipelineInput(query({ dateWindow: "all-years" }), undefined, undefined)
        .dateFilter,
    ).toBe("none");
    expect(
      toPipelineInput(
        query({
          fromYear: 2024,
          toYear: 2026,
          dateWindow: { fromIso: "2019", toIso: "2021-12-31" },
        }),
        undefined,
        undefined,
      ).dateFilter,
    ).toMatchObject({ fromDate: "2024-01-01", toDate: "2026-12-31" });
  });
});

describe("P2-T17 — the re-run's import summary (step 9, docs/08 §4.6 rule 4)", () => {
  it("reads Imported 0 · Already present 40 · 0 failed when all 40 are still present", () => {
    expect(
      importSummary(writeReport({ created: 0, linkedExisting: 40 }), true),
    ).toStrictEqual({
      id: "research-helper-search-import-summary-rerun",
      args: { imported: 0, present: 40, failed: 0 },
    });
  });

  it("counts records skipped as duplicates as already present too", () => {
    const write: SearchImportWriteReport = {
      ...writeReport({ created: 9, linkedExisting: 100 }),
      skipped: 28,
      failed: 1,
    };
    expect(importSummary(write, true).args).toStrictEqual({
      imported: 9,
      present: 128,
      failed: 1,
    });
  });

  it("keeps FR-51's linked/skipped line for a keyword run", () => {
    expect(
      importSummary(writeReport({ created: 3, linkedExisting: 2 }), false),
    ).toStrictEqual({
      id: "research-helper-import-summary",
      args: { imported: 3, linked: 2, skipped: 0, failed: 0 },
    });
  });

  it("publishes the rule-4 line for an import made from the re-run state", async () => {
    const h = harness({
      runs: [
        { output: FETCHED },
        {
          output: output({
            outcome: "succeeded",
            write: writeReport({ created: 0, linkedExisting: 40 }),
          }),
        },
      ],
      sources: TWO_SOURCES,
    });
    await searchThenImport(h, "rerun");
    expect(h.model.state.status).toStrictEqual({
      id: "research-helper-search-import-summary-rerun",
      args: { imported: 0, present: 40, failed: 0 },
    });
  });
});

describe("P2-T17 — a re-run writes a new record and leaves the original alone (step 10)", () => {
  it("adds a second row with a different runId; the first row's record is unchanged", async () => {
    const store = recordingStore();
    const h = harness({
      runs: [
        { output: FETCHED },
        { output: WRITTEN },
        { output: FETCHED },
        {
          output: output({
            outcome: "succeeded",
            write: writeReport({ created: 0, linkedExisting: 1 }),
          }),
        },
      ],
      sources: TWO_SOURCES,
      extra: {
        provenanceStore: store,
        findCollection: () => RERUN_COLLECTION,
      },
    });
    await searchThenImport(h);
    const original = structuredClone(store.rows[0]?.record);

    const seed = await h.model.loadRerun(4242);
    expect(seed?.asRecorded.userQuery).toBe(query().keyword);
    await searchThenImport(h, "rerun");

    expect(store.rows).toHaveLength(2);
    expect(store.rows[1]?.record.runId).not.toBe(store.rows[0]?.record.runId);
    expect(store.rows[0]?.record).toStrictEqual(original);
  });
});

// ===========================================================================
// Follow-ups 204 and 212 (2026-10-16)
// ===========================================================================

describe("item 204 — the pipeline's 'failed' reaches the panel and the progress popup", () => {
  const SEARCHING: readonly SourceId[] = [
    "pubmed",
    "europepmc",
    "crossref",
    "semanticscholar",
    "arxiv",
  ];

  it("draws the all-failed panel and closes the job 'failed' when every searching source failed beside the two quiet servers", async () => {
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          // What `createSearchImportPipeline` returns for this run since item
          // 204: `"failed"`, with its run-level SOURCE error.
          output: output({
            outcome: "failed",
            error: failure("SOURCE", { retryable: true }),
            perSource: SEVEN_IDS.map((sourceId) =>
              SEARCHING.includes(sourceId)
                ? report({ sourceId, error: failure("OFFLINE") })
                : report({ sourceId }),
            ),
          }),
        },
      ],
    });
    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));

    expect(h.model.state.panel).toBe("error");
    expect(h.model.state.error?.headline.id).toBe(
      "research-helper-search-state-error",
    );
    expect(h.model.state.error?.lines.map((line) => line.sourceId)).toEqual(
      SEARCHING,
    );
    expect(h.model.state.warnings).toStrictEqual([]);
    // The progress popup is told the run failed — `"partial"` would have
    // been mapped to `"succeeded"` here.
    expect(h.doneOutcomes).toStrictEqual(["failed"]);
  });

  it("still closes a run with one surviving searching source as 'succeeded', with the partial banner", async () => {
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: output({
            outcome: "partial",
            records: [
              record({
                sourceId: "crossref",
                nativeId: "c1",
                title: "Survivor",
              }),
            ],
            perSource: SEVEN_IDS.map((sourceId) =>
              sourceId === "crossref"
                ? report({ sourceId, recordsRetrieved: 1 })
                : SEARCHING.includes(sourceId)
                  ? report({ sourceId, error: failure("OFFLINE") })
                  : report({ sourceId }),
            ),
          }),
        },
      ],
    });
    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));
    expect(h.model.state.panel).toBe("results");
    expect(h.model.state.warnings.map((w) => w.id)).toStrictEqual([
      "research-helper-search-state-partial",
    ]);
    expect(h.doneOutcomes).toStrictEqual(["succeeded"]);
  });
});

describe("item 220 — the all-failed panel decides from the per-source errors", () => {
  const SEARCHING: readonly SourceId[] = [
    "pubmed",
    "europepmc",
    "crossref",
    "semanticscholar",
    "arxiv",
  ];

  /**
   * The seven-source run `createSearchImportPipeline` returns since item 204
   * when every searching source failed: `"failed"`, with the run-level
   * `SOURCE` error whose `retryable: true` would draw Retry on its own.
   */
  function allFailed(
    errorFor: (sourceId: SourceId) => SerializedError,
  ): SearchImportOutput {
    return output({
      outcome: "failed",
      error: failure("SOURCE", { retryable: true }),
      perSource: SEVEN_IDS.map((sourceId) =>
        SEARCHING.includes(sourceId)
          ? report({ sourceId, error: errorFor(sourceId) })
          : report({ sourceId }),
      ),
    });
  }

  it("shows Open Preferences and no Retry when every source failed only on a refused key", async () => {
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: allFailed(() =>
            failure("AUTHORIZATION", { httpStatus: 403 }),
          ),
        },
      ],
    });
    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));

    expect(h.model.state.panel).toBe("error");
    expect(h.model.state.error?.openPreferences).toBe(true);
    expect(h.model.state.error?.retry).toBe(false);
  });

  it("shows Retry alone when every source failed only on being offline", async () => {
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: allFailed(() => failure("OFFLINE", { retryable: true })),
        },
      ],
    });
    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));

    expect(h.model.state.panel).toBe("error");
    expect(h.model.state.error?.retry).toBe(true);
    expect(h.model.state.error?.openPreferences).toBe(false);
  });

  it("shows both buttons for a mixed run of refused keys and offline sources", async () => {
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: allFailed((sourceId) =>
            sourceId === "semanticscholar"
              ? failure("AUTHORIZATION", { httpStatus: 403 })
              : failure("OFFLINE", { retryable: true }),
          ),
        },
      ],
    });
    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));

    expect(h.model.state.panel).toBe("error");
    expect(h.model.state.error?.retry).toBe(true);
    expect(h.model.state.error?.openPreferences).toBe(true);
  });

  it("still shows the run-level error's own action when no source carries an error", async () => {
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          // A run that failed before fetching: no source was asked, so the
          // run-level error is the only one there is.
          output: output({
            outcome: "failed",
            perSource: [],
            error: failure("SOURCE", { retryable: true }),
          }),
        },
      ],
    });
    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));

    expect(h.model.state.panel).toBe("error");
    // `SOURCE` has no `ERROR_ROWS` row, so its action is its own
    // `retryable: true`.
    expect(h.model.state.error?.retry).toBe(true);
    expect(h.model.state.error?.openPreferences).toBe(false);
    expect(h.model.state.error?.details).toStrictEqual(["SOURCE"]);
  });

  it("leaves the run-level error out of the panel's lines when per-source lines exist", async () => {
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: allFailed((sourceId) =>
            sourceId === "semanticscholar"
              ? failure("AUTHORIZATION", { httpStatus: 403 })
              : failure("OFFLINE", { retryable: true }),
          ),
        },
      ],
    });
    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));

    const error = h.model.state.error;
    expect(error?.lines.map((line) => line.sourceId)).toStrictEqual(SEARCHING);
    // One machine code per failed source, in order, and no `SOURCE`.
    expect(error?.details).toStrictEqual([
      "OFFLINE",
      "OFFLINE",
      "OFFLINE",
      "AUTHORIZATION",
      "403",
      "OFFLINE",
    ]);
  });
});

describe("item 232 — a 429 refused after the client's retries has a truthful row", () => {
  const ID = "research-helper-search-error-rate-limit";

  /** A 429 as a pipeline result carries it: serialized, no seconds. */
  const refused = (): SerializedError =>
    failure("RATE_LIMIT", { httpStatus: 429, retryable: true });

  it("draws its own row with the database name, never rh-error-rate-limit's countdown", () => {
    const view = errorView(refused(), DATABASE);

    expect(view.ref).toStrictEqual({ id: ID, args: { database: DATABASE } });
    // Not the §8.3 table's "Retrying in {n}s" message, and no seconds asked
    // for: nothing is retrying when this is shown, and none are carried.
    expect(view.ref.id).not.toBe("rh-error-rate-limit");
    expect(Object.keys(view.ref.args ?? {})).toStrictEqual(["database"]);
    // §8.3's "Retry now", and item 220's rule: never Preferences.
    expect(view.retry).toBe(true);
    expect(view.prefs).toBe(false);
    expect(UNRENDERABLE_ERROR_ROWS).not.toContain("RATE_LIMIT");
  });

  it("ships the owner's wording in the en-US bundle, with the database name and no countdown", () => {
    const text = enUsSearchDialog().get(ID);

    expect(text).toBe(
      "{ $database }: too many requests, refused · try again in a moment",
    );
    expect(text).not.toMatch(/retrying/i);
    expect(text).not.toContain("$seconds");
  });

  it("shows the row in the refused source's status line", () => {
    const line = sourceStatusLine(
      report({ sourceId: "pubmed", error: refused() }),
      { id: "pubmed", displayNameKey: "research-helper-source-pubmed" },
      DATABASE,
    );

    expect(line.outcome).toBe("failed");
    expect(line.nameId).toBe("research-helper-source-pubmed");
    expect(line.detail).toStrictEqual({ id: ID, args: { database: DATABASE } });
  });

  it("draws Retry alone when every searching source was refused with 429 (item 220's rule)", async () => {
    const searching: readonly SourceId[] = [
      "pubmed",
      "europepmc",
      "crossref",
      "semanticscholar",
      "arxiv",
    ];
    const h = harness({
      sources: SEVEN_SOURCES,
      runs: [
        {
          output: output({
            outcome: "failed",
            error: failure("SOURCE", { retryable: true }),
            perSource: SEVEN_IDS.map((sourceId) =>
              searching.includes(sourceId)
                ? report({ sourceId, error: refused() })
                : report({ sourceId }),
            ),
          }),
        },
      ],
    });
    await h.model.runSearch(query({ sources: [...SEVEN_IDS] }));

    const error = h.model.state.error;
    expect(h.model.state.panel).toBe("error");
    expect(error?.retry).toBe(true);
    expect(error?.openPreferences).toBe(false);
    // One line per refused source, each the item-232 row naming its own
    // database.
    expect(error?.lines.map((line) => line.sourceId)).toStrictEqual(searching);
    for (const line of error?.lines ?? []) {
      expect(line.detail.id, line.sourceId).toBe(ID);
      const database = line.detail.args?.database;
      expect(typeof database, line.sourceId).toBe("string");
      expect(database, line.sourceId).not.toBe("");
    }
    // The machine code and the status stay in the disclosure.
    expect(error?.details.slice(0, 2)).toStrictEqual(["RATE_LIMIT", "429"]);
  });
});

describe("item 212 — Strategy B's counts in the import summary", () => {
  const PATHS = {
    viaTranslators: 7,
    handMapped: 3,
    fallbackReasons: {
      "no-identifier": 2,
      "lookup-error": 0,
      "no-translators": 0,
      "no-result": 1,
      timeout: 0,
    },
  } as const;

  it("adds nothing to the notices when Strategy B did not run — byte for byte the summary of before", async () => {
    const h = harness({
      runs: [{ output: FETCHED }, { output: WRITTEN }],
      sources: TWO_SOURCES,
    });
    await searchThenImport(h);
    expect(JSON.stringify(h.model.state.notices)).toBe(
      JSON.stringify([
        {
          id: "research-helper-import-summary",
          args: { imported: 1, linked: 0, skipped: 0, failed: 0 },
        },
        {
          id: "research-helper-import-abstract-coverage",
          args: { percent: 100 },
        },
      ]),
    );
    expect(importPathLines(writeReport({ created: 1 }))).toStrictEqual([]);
  });

  it("draws the path line and one line per reason that sent a record to hand-mapping, after the summary", async () => {
    const h = harness({
      runs: [
        { output: FETCHED },
        {
          output: output({
            outcome: "succeeded",
            write: { ...writeReport({ created: 10 }), importPaths: PATHS },
          }),
        },
      ],
      sources: TWO_SOURCES,
    });
    await searchThenImport(h);
    expect(h.model.state.notices).toStrictEqual([
      message("research-helper-import-summary", {
        imported: 10,
        linked: 0,
        skipped: 0,
        failed: 0,
      }),
      message("research-helper-import-abstract-coverage", { percent: 100 }),
      message("research-helper-import-paths", { translated: 7, handMapped: 3 }),
      message("research-helper-import-fallback-reason", {
        cause: "no-identifier",
        count: 2,
      }),
      message("research-helper-import-fallback-reason", {
        cause: "no-result",
        count: 1,
      }),
    ]);
    // The status line and the toast stay the summary alone.
    expect(h.model.state.status?.id).toBe("research-helper-import-summary");
  });

  it("draws the path line alone when no record fell back", () => {
    expect(
      importPathLines({
        ...writeReport({ created: 4 }),
        importPaths: {
          viaTranslators: 4,
          handMapped: 0,
          fallbackReasons: {
            "no-identifier": 0,
            "lookup-error": 0,
            "no-translators": 0,
            "no-result": 0,
            timeout: 0,
          },
        },
      }),
    ).toStrictEqual([
      message("research-helper-import-paths", { translated: 4, handMapped: 0 }),
    ]);
  });
});

/**
 * The en-US search-window bundle's single-line messages, id → value, read
 * from the shipped file so a test asserts the bundle's text rather than a
 * literal retyped here.
 */
function enUsSearchDialog(): ReadonlyMap<string, string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(
    resolve(
      here,
      "../../../addon/locale/en-US/research-helper-searchDialog.ftl",
    ),
    "utf8",
  );
  const values = new Map<string, string>();
  for (const match of text.matchAll(/^([a-z][a-z0-9-]*) = (.+)$/gm)) {
    const [, id, value] = match;
    if (id !== undefined && value !== undefined) values.set(id, value);
  }
  return values;
}

// ===========================================================================
// P3-T27 — relevance screening in the window (docs/08 §4.2's threshold row)
// ===========================================================================

describe("P3-T27 — relevance screening: the threshold control, per run", () => {
  const ROWS = [
    record({ sourceId: "pubmed", nativeId: "1", title: "On topic" }),
    record({ sourceId: "pubmed", nativeId: "2", title: "Off topic" }),
    record({ sourceId: "pubmed", nativeId: "3", title: "Unscored" }),
  ];

  function screened(
    threshold: number,
    extra: Partial<NonNullable<SearchImportOutput["screening"]>> = {},
  ): SearchImportOutput {
    const verdict = (id: string, score: number) => ({
      id,
      score,
      reason: "Synthetic reason.",
      confidence: "high" as const,
      isPrimaryResearch: true,
      flags: [],
    });
    return {
      ...output({
        outcome: "succeeded",
        records: ROWS,
        perSource: [report({ sourceId: "pubmed", recordsRetrieved: 3 })],
      }),
      screening: {
        threshold,
        verdicts: [verdict("pubmed:1", 90), verdict("pubmed:2", 20)],
        unscored: ["pubmed:3"],
        excluded: threshold > 20 ? ["pubmed:2"] : [],
        modelId: "screen-model",
        error: undefined,
        ...extra,
      },
    };
  }

  /** A pref store the window may read and must never write. */
  function screeningPort(start: number) {
    const store = { threshold: start, reads: 0 };
    return {
      store,
      port: {
        threshold: (): number => {
          store.reads += 1;
          return store.threshold;
        },
        available: (): boolean => true,
        // Item 281(b): priced below summary.confirmAboveCents, so no dialog.
        estimate: (): Promise<RunEstimate> =>
          Promise.resolve(screeningEstimateFixture(0.01, 3)),
        confirmAboveCents: (): number => 200,
      },
    };
  }

  it("opens the control at the preference's value, read on demand (Done-when)", () => {
    const { store, port } = screeningPort(60);
    const h = harness({ runs: [], extra: { screening: port } });
    expect(h.model.host.getPrefs()).toMatchObject({
      screeningThreshold: 60,
      screeningAvailable: true,
    });
    // Read again on the next open: a preference changed in between is seen.
    store.threshold = 45;
    expect(h.model.host.getPrefs()["screeningThreshold"]).toBe(45);
    expect(store.reads).toBe(2);
  });

  it("offers no screening seed without the port, or when the port throws", () => {
    const none = harness({ runs: [] });
    expect(none.model.host.getPrefs()).not.toHaveProperty("screeningThreshold");
    const broken = harness({
      runs: [],
      extra: {
        screening: {
          threshold: () => {
            throw new Error("unreadable");
          },
          available: () => true,
        },
      },
    });
    expect(broken.model.host.getPrefs()).not.toHaveProperty(
      "screeningAvailable",
    );
    expect(broken.lines.join("\n")).toContain("relevance-screening seed");
  });

  it("keeps a per-run change in the run's options and never writes the preference (Done-when)", async () => {
    const { store, port } = screeningPort(60);
    const h = harness({
      runs: [{ output: screened(30) }],
      sources: TWO_SOURCES,
      extra: { screening: port },
    });
    await h.model.runSearch(
      query({ screening: { enabled: true, threshold: 30 } }),
    );
    expect(h.inputs[0]?.screening).toEqual({ threshold: 30 });
    expect(store.threshold).toBe(60);
    // The host has no member that could write it. Its one screening member
    // since item 281(b) prices a query and writes nothing.
    expect(
      Object.keys(h.model.host).filter((k) => /screen|threshold/i.test(k)),
    ).toEqual(["screeningCost"]);
  });

  it("asks for no screening when the box is unticked, and never on an import", async () => {
    const h = harness({
      runs: [
        { output: screened(60) },
        {
          output: output({
            outcome: "succeeded",
            write: writeReport({ created: 3 }),
          }),
        },
      ],
      sources: TWO_SOURCES,
    });
    await h.model.runSearch(
      query({ screening: { enabled: false, threshold: 60 } }),
    );
    expect(h.inputs[0]).not.toHaveProperty("screening");
    await h.model.runImport({
      ...query({ screening: { enabled: true, threshold: 60 } }),
      records: [],
    });
    expect(h.inputs[1]).not.toHaveProperty("screening");
  });

  it("coerces the control's value into docs/07 §8.5's range; an emptied box is 0, which hides nothing", () => {
    expect(screeningThreshold(30)).toBe(30);
    expect(screeningThreshold(150)).toBe(100);
    expect(screeningThreshold(-5)).toBe(0);
    expect(screeningThreshold(59.6)).toBe(60);
    expect(screeningThreshold(Number.NaN)).toBe(0);
    expect(screeningThreshold("")).toBe(0);
    expect(
      toPipelineInput(
        query({ screening: { enabled: true, threshold: Number.NaN } }),
        undefined,
        undefined,
      ).screening,
    ).toEqual({ threshold: 0 });
  });

  it("badges every scored row, leaves the unscored row bare, and says how many were not scored", async () => {
    const h = harness({
      runs: [{ output: screened(60) }],
      sources: TWO_SOURCES,
    });
    await h.model.runSearch(
      query({ screening: { enabled: true, threshold: 60 } }),
    );
    const rows = h.model.state.records ?? [];
    expect(rows.map((r) => r.relevance?.score)).toEqual([90, 20, undefined]);
    expect(rows[0]?.relevance?.ref).toEqual(
      message("research-helper-search-row-relevance", { score: 90 }),
    );
    expect(rows[2]).not.toHaveProperty("relevance");
    expect(h.model.state.screening).toEqual({
      threshold: 60,
      scored: 2,
      unscored: 1,
    });
    expect(h.model.state.warnings).toContainEqual(
      message("research-helper-search-screening-unscored", { count: 1 }),
    );
  });

  it("says screening could not run when it failed, and a later unscreened search clears it", async () => {
    const failed = screened(60, {
      verdicts: [],
      excluded: [],
      unscored: ["pubmed:1", "pubmed:2", "pubmed:3"],
      error: {
        code: "POLICY",
        messageKey: "rh-error-policy",
        detail: "refused",
        retryable: false,
      },
    });
    const h = harness({
      runs: [
        { output: failed },
        { output: output({ outcome: "succeeded", records: ROWS }) },
      ],
      sources: TWO_SOURCES,
      extra: { screening: screeningPort(60).port },
    });
    await h.model.runSearch(
      query({ screening: { enabled: true, threshold: 60 } }),
    );
    expect(h.model.state.warnings).toEqual([
      message("research-helper-search-screening-failed"),
    ]);
    expect(
      (h.model.state.records ?? []).every((r) => r.relevance === undefined),
    ).toBe(true);
    await h.model.runSearch(query());
    expect(h.model.state.screening).toBeUndefined();
    expect(h.model.state.warnings).toEqual([]);
  });

  it("with threshold 0 hides no row, so the import writes every candidate (Done-when)", async () => {
    const h = harness({
      runs: [
        { output: screened(0) },
        {
          output: output({
            outcome: "succeeded",
            write: writeReport({ created: 3 }),
          }),
        },
      ],
      sources: TWO_SOURCES,
    });
    await h.model.runSearch(
      query({ screening: { enabled: true, threshold: 0 } }),
    );
    const rows = h.model.state.records ?? [];
    expect(
      rows.filter(
        (r) =>
          r.relevance !== undefined && belowThreshold(r.relevance.score, 0),
      ),
    ).toEqual([]);
    await h.model.runImport({ ...query(), records: rows });
    expect(h.inputs[1]?.target?.selectedRecordIds).toEqual([
      "pubmed:1",
      "pubmed:2",
      "pubmed:3",
    ]);
  });
});

describe("P3-T27 — the document's screening rules match the view model's", () => {
  /** `addon/content/searchDialog.js`'s `logic`, evaluated from the shipped bytes. */
  function documentLogic(): {
    belowThreshold(score: number, threshold: number): boolean;
    screeningThreshold(raw: unknown): number;
    screeningCounts(rows: unknown[], threshold: number): unknown;
    screeningSeed(raw: unknown): unknown;
    relevanceOf(raw: unknown): unknown;
    visibleRows(rows: unknown[], view: unknown): { key: string }[];
  } {
    const here = dirname(fileURLToPath(import.meta.url));
    const script = readFileSync(
      resolve(here, "../../../addon/content/searchDialog.js"),
      "utf8",
    );
    const factory = new Function(
      "Zotero",
      "window",
      "document",
      `${script}\nreturn RHSearchWindow;`,
    ) as (
      z: unknown,
      w: unknown,
      d: unknown,
    ) => { logic: ReturnType<typeof documentLogic> };
    return factory(undefined, {}, {}).logic;
  }

  const ref = {
    id: "research-helper-search-row-relevance",
    args: { score: 1 },
  };
  const row = (key: string, score?: number) => ({
    key,
    existing: false,
    filterText: key,
    ...(score === undefined ? {} : { relevance: { score, ref } }),
  });

  it("excludes exactly what belowThreshold excludes, over the whole range", () => {
    const logic = documentLogic();
    for (const threshold of [0, 1, 59, 60, 61, 100]) {
      for (const score of [0, 1, 59, 60, 61, 100]) {
        expect(logic.belowThreshold(score, threshold)).toBe(
          belowThreshold(score, threshold),
        );
      }
      expect(logic.screeningThreshold(threshold)).toBe(
        screeningThreshold(threshold),
      );
    }
    for (const raw of ["", Number.NaN, 150, -3, 42.4]) {
      expect(logic.screeningThreshold(raw)).toBe(screeningThreshold(raw));
    }
  });

  it("hides scored rows below the threshold until Show excluded, never an unscored row, and counts them", () => {
    const logic = documentLogic();
    const rows = [row("a", 90), row("b", 20), row("c")];
    const keys = (view: unknown) =>
      logic.visibleRows(rows, view).map((r) => r.key);
    expect(keys({ filter: "", hideExisting: false })).toEqual(["a", "b", "c"]);
    expect(keys({ filter: "", hideExisting: false, threshold: 60 })).toEqual([
      "a",
      "c",
    ]);
    expect(
      keys({
        filter: "",
        hideExisting: false,
        threshold: 60,
        showExcluded: true,
      }),
    ).toEqual(["a", "b", "c"]);
    expect(keys({ filter: "", hideExisting: false, threshold: 0 })).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(logic.screeningCounts(rows, 60)).toEqual({
      total: 3,
      kept: 2,
      excluded: 1,
    });
    expect(logic.screeningCounts(rows, 0)).toEqual({
      total: 3,
      kept: 3,
      excluded: 0,
    });
  });

  it("offers the row only with a valid threshold from the host, and restates no default", () => {
    const logic = documentLogic();
    expect(
      logic.screeningSeed({ screeningThreshold: 60, screeningAvailable: true }),
    ).toEqual({ available: true, threshold: 60 });
    expect(
      logic.screeningSeed({
        screeningThreshold: 60,
        screeningAvailable: false,
      }),
    ).toEqual({ available: false, threshold: 60 });
    expect(logic.screeningSeed({ screeningAvailable: true })).toEqual({
      available: false,
      threshold: null,
    });
    expect(
      logic.screeningSeed({
        screeningThreshold: "60",
        screeningAvailable: true,
      }),
    ).toEqual({ available: false, threshold: null });
    expect(logic.relevanceOf({ score: 70, ref })).toEqual({ score: 70, ref });
    expect(logic.relevanceOf({ score: "70", ref })).toBeNull();
    expect(logic.relevanceOf(undefined)).toBeNull();
    const here = dirname(fileURLToPath(import.meta.url));
    const script = readFileSync(
      resolve(here, "../../../addon/content/searchDialog.js"),
      "utf8",
    );
    expect(script).not.toMatch(/screening[A-Za-z]*:\s*\{[^}]*default:/);
  });
});

// ===========================================================================
// Item 281(b) — the screening cost beside the checkbox, and P3-T16's dialog
// above summary.confirmAboveCents (owner, 2026-10-24)
// ===========================================================================

/** A screen's estimate as `estimateRelevanceScreen` shapes it. */
function screeningEstimateFixture(
  costUsd: number | undefined,
  items: number,
): RunEstimate {
  const calls = Math.ceil(items / 20);
  const plan = {
    fullTextMode: "never" as const,
    items: [],
    counts: {
      items,
      cached: 0,
      fullText: 0,
      abstractOnly: items,
      metadataOnly: 0,
      chunked: 0,
    },
    calls,
    rawInputTokens: calls * 7_000,
    inputTokens: calls * 8_050,
    outputTokens: items * 100,
    costUsd,
  };
  return {
    modelId: "screen-model",
    selected: plan,
    abstractOnly: plan,
    preselectDowngrade: false,
    pricesAsOfEpochMs: costUsd === undefined ? undefined : 0,
    isEstimate: true,
  };
}

describe("item 281(b) — what a screened search may cost (owner, 2026-10-24)", () => {
  const SEVEN: readonly SourceDescriptor[] = [
    { id: "pubmed", displayNameKey: "research-helper-source-pubmed" },
    { id: "crossref", displayNameKey: "research-helper-source-crossref" },
    {
      id: "biorxiv",
      displayNameKey: "research-helper-source-biorxiv",
      keywordSearch: false,
    },
  ];
  const ROWS = [
    record({ sourceId: "pubmed", nativeId: "1", title: "On topic" }),
  ];
  const screenedQuery = (): SearchWindowQuery =>
    query({ screening: { enabled: true, threshold: 60 } });

  /** A port that records what it was asked, priced at `costUsd`. */
  function costPort(options: {
    readonly costUsd: number | undefined;
    readonly answer?: CostDialogOutcome | Error;
    readonly estimateFails?: boolean;
  }) {
    const asked: ScreeningEstimateRequest[] = [];
    const confirmed: RunEstimate[] = [];
    let release: () => void = () => undefined;
    const port = {
      threshold: (): number => 60,
      available: (): boolean => true,
      estimate: (request: ScreeningEstimateRequest): Promise<RunEstimate> => {
        asked.push(request);
        return options.estimateFails === true
          ? Promise.reject(new Error("no template"))
          : Promise.resolve(
              screeningEstimateFixture(options.costUsd, request.resultCount),
            );
      },
      confirmAboveCents: (): number => 200,
      confirm: (estimate: RunEstimate): Promise<CostDialogOutcome> => {
        confirmed.push(estimate);
        const answer = options.answer;
        if (answer instanceof Error) return Promise.reject(answer);
        return new Promise((resolve) => {
          release = () => {
            resolve(answer ?? { kind: "cancelled" });
          };
          if (answer !== undefined) release();
        });
      },
      locale: (): string => "en-US",
    };
    return { port, asked, confirmed, release: () => release() };
  }

  it("counts the most a search can return: the maximum times the ticked databases that search", () => {
    expect(screeningResultCount(["pubmed", "crossref"], 100, SEVEN)).toBe(200);
    // bioRxiv adds none on a keyword run; an unknown id adds none.
    expect(
      screeningResultCount(["pubmed", "biorxiv", "nope"], 100, SEVEN),
    ).toBe(100);
    // The document's untyped values, held to docs/07 §8.5's range.
    expect(screeningResultCount(["pubmed"], "50", SEVEN)).toBe(50);
    expect(screeningResultCount(["pubmed"], 5000, SEVEN)).toBe(200);
    expect(screeningResultCount(["pubmed"], Number.NaN, SEVEN)).toBe(0);
    expect(screeningResultCount([], 100, SEVEN)).toBe(0);
  });

  it("draws the cost line, or that the price is unknown, or nothing", () => {
    expect(
      screeningCostLine(screeningEstimateFixture(0.4231, 200), 200, "en-US"),
    ).toStrictEqual(
      message("research-helper-search-screening-cost", {
        cost: "$0.42",
        count: 200,
      }),
    );
    expect(
      screeningCostLine(screeningEstimateFixture(undefined, 200), 200, "en-US"),
    ).toStrictEqual(
      message("research-helper-search-screening-cost-unpriced", {
        model: "screen-model",
      }),
    );
    expect(
      screeningCostLine(screeningEstimateFixture(0, 0), 0, "en-US"),
    ).toBeUndefined();
  });

  it("asks above summary.confirmAboveCents or for an unknown price, never at or below it", () => {
    expect(
      screeningNeedsConfirmation(screeningEstimateFixture(2.5, 300), 200),
    ).toBe(true);
    expect(
      screeningNeedsConfirmation(screeningEstimateFixture(2, 300), 200),
    ).toBe(false);
    expect(
      screeningNeedsConfirmation(screeningEstimateFixture(0.4, 300), 200),
    ).toBe(false);
    expect(
      screeningNeedsConfirmation(screeningEstimateFixture(undefined, 300), 200),
    ).toBe(true);
    // Nothing to score sends nothing.
    expect(
      screeningNeedsConfirmation(screeningEstimateFixture(undefined, 0), 200),
    ).toBe(false);
  });

  it("the host prices the window's query: count from its databases and maximum, topic from its keyword", async () => {
    const { port, asked } = costPort({ costUsd: 0.4231 });
    const h = harness({ runs: [], sources: SEVEN, extra: { screening: port } });
    const line = await h.model.host.screeningCost({
      keyword: "ionizable lipid nanoparticle",
      sources: ["pubmed", "crossref", "biorxiv"],
      maxResults: 100,
    });
    expect(asked).toStrictEqual([
      { resultCount: 200, topic: "ionizable lipid nanoparticle" },
    ]);
    expect(line).toStrictEqual(
      message("research-helper-search-screening-cost", {
        cost: "$0.42",
        count: 200,
      }),
    );
    // No estimator, or one that fails: no line.
    const bare = harness({ runs: [], sources: SEVEN });
    expect(
      await bare.model.host.screeningCost({
        keyword: "x",
        sources: ["pubmed"],
        maxResults: 100,
      }),
    ).toBeUndefined();
    const failing = costPort({ costUsd: 1, estimateFails: true });
    const f = harness({
      runs: [],
      sources: SEVEN,
      extra: { screening: failing.port },
    });
    expect(
      await f.model.host.screeningCost({
        keyword: "x",
        sources: ["pubmed"],
        maxResults: 100,
      }),
    ).toBeUndefined();
  });

  it("at or below the threshold, screens with no dialog", async () => {
    const { port, asked, confirmed } = costPort({ costUsd: 1.99 });
    const h = harness({
      runs: [{ output: output({ outcome: "succeeded", records: ROWS }) }],
      sources: TWO_SOURCES,
      extra: { screening: port },
    });
    await h.model.runSearch(screenedQuery());
    expect(asked).toHaveLength(1);
    expect(confirmed).toHaveLength(0);
    expect(h.inputs[0]?.screening).toEqual({ threshold: 60 });
  });

  it("above the threshold, opens P3-T16's dialog with the estimate and screens only once Run is chosen", async () => {
    const run: CostDialogOutcome = {
      kind: "run",
      plan: "selected",
      raise: undefined,
      dontAskAgain: false,
    };
    const { port, confirmed } = costPort({ costUsd: 2.01, answer: run });
    const h = harness({
      runs: [{ output: output({ outcome: "succeeded", records: ROWS }) }],
      sources: TWO_SOURCES,
      extra: { screening: port },
    });
    await h.model.runSearch(screenedQuery());
    expect(confirmed).toHaveLength(1);
    // pubmed and crossref at 25 each: the estimate the dialog shows.
    expect(confirmed[0]?.selected.counts.items).toBe(50);
    expect(confirmed[0]?.selected.costUsd).toBe(2.01);
    expect(h.inputs[0]?.screening).toEqual({ threshold: 60 });
    expect(h.model.state.warnings).toEqual([]);
  });

  it("an unknown price opens the dialog too", async () => {
    const { port, confirmed } = costPort({
      costUsd: undefined,
      answer: { kind: "cancelled" },
    });
    const h = harness({
      runs: [],
      sources: TWO_SOURCES,
      extra: { screening: port },
    });
    await h.model.runSearch(screenedQuery());
    expect(confirmed).toHaveLength(1);
    expect(h.inputs).toHaveLength(0);
  });

  it("Cancel starts nothing: no search, no screening, and the window is redrawn as it was", async () => {
    const { port, confirmed } = costPort({
      costUsd: 5,
      answer: { kind: "cancelled" },
    });
    const h = harness({
      runs: [],
      sources: TWO_SOURCES,
      extra: { screening: port },
    });
    const before = h.states.length;
    await h.model.runSearch(screenedQuery());
    expect(confirmed).toHaveLength(1);
    expect(h.inputs).toHaveLength(0);
    expect(h.states.length).toBe(before + 1);
    expect(h.model.state.running).toBe(false);
    expect(h.model.state.panel).toBe("initial");
  });

  it("a second Search while the dialog is open is ignored, so one dialog asks", async () => {
    const pending = costPort({ costUsd: 5 });
    const h = harness({
      runs: [],
      sources: TWO_SOURCES,
      extra: { screening: pending.port },
    });
    const first = h.model.runSearch(screenedQuery());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.model.runSearch(screenedQuery());
    expect(pending.confirmed).toHaveLength(1);
    expect(h.lines.join("\n")).toContain("already running");
    pending.release();
    await first;
    expect(h.inputs).toHaveLength(0);
  });

  it("with no estimate, or a dialog that cannot open, searches without screening and says so", async () => {
    for (const options of [
      { costUsd: 1, estimateFails: true },
      { costUsd: 5, answer: new Error("no main window") },
    ] as const) {
      const { port } = costPort(options);
      const h = harness({
        runs: [{ output: output({ outcome: "succeeded", records: ROWS }) }],
        sources: TWO_SOURCES,
        extra: { screening: port },
      });
      await h.model.runSearch(screenedQuery());
      expect(h.inputs[0]).not.toHaveProperty("screening");
      expect(h.model.state.warnings).toEqual([
        message("research-helper-search-screening-failed"),
      ]);
    }
    // And with no estimator bound at all.
    const h = harness({
      runs: [{ output: output({ outcome: "succeeded", records: ROWS }) }],
      sources: TWO_SOURCES,
      extra: {
        screening: { threshold: () => 60, available: () => true },
      },
    });
    await h.model.runSearch(screenedQuery());
    expect(h.inputs[0]).not.toHaveProperty("screening");
  });

  it("an unscreened search is never priced", async () => {
    const { port, asked } = costPort({ costUsd: 5 });
    const h = harness({
      runs: [{ output: output({ outcome: "succeeded", records: ROWS }) }],
      sources: TWO_SOURCES,
      extra: { screening: port },
    });
    await h.model.runSearch(query());
    expect(asked).toHaveLength(0);
    expect(h.inputs).toHaveLength(1);
  });

  it("the two new en-US strings say what the line means", () => {
    const bundle = enUsSearchDialog();
    expect(bundle.get("research-helper-search-screening-cost")).toBe(
      "Estimated cost of screening: up to about { $cost } for up to { $count } results",
    );
    expect(bundle.get("research-helper-search-screening-cost-unpriced")).toBe(
      "The price of { $model } is not known, so the cost of screening cannot be estimated.",
    );
  });
});
