/**
 * `P5-T16`: the related mode's view model, from hand-built pipeline outputs.
 *
 * Plain Node, no network, no key and no Zotero. The pipeline is a stand-in, so a pass
 * here says what the window is told about a result and nothing about any service.
 * The document's half, including that a citation context reaches the page as plain
 * text, is `test/unit/ui/searchDialog.test.ts`'s "P5-T16" block.
 */

import { describe, expect, it, vi } from "vitest";

import type { SerializedError } from "../../../src/core/errors";
import type { CancellationToken } from "../../../src/core/jobQueue/cancellation";
import {
  CompositeProgressReporter,
  type ProgressSnapshot,
} from "../../../src/core/jobQueue/progress";
import type { Logger } from "../../../src/core/logger";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { RelationKind } from "../../../src/model/related";
import type {
  SearchImportInput,
  SearchImportOutput,
} from "../../../src/pipeline/searchImport/types";
import { PREFS } from "../../../src/prefs/schema";
import type {
  RelatedGeneratorId,
  RelatedGeneratorState,
  RelatedGeneratorStatus,
} from "../../../src/pipeline/related/generators";
import { validateRelatedInput } from "../../../src/pipeline/related/relatedPipeline";
import type { ReasonChip } from "../../../src/pipeline/related/score";
import type {
  RelatedCancelled,
  RelatedChoose,
  RelatedFailed,
  RelatedInput,
  RelatedOutput,
  RelatedPipeline,
  RelatedRow,
  RelatedRows,
} from "../../../src/pipeline/related/types";
import {
  createRelatedViewModel,
  dotsOf,
  failureView,
  initialRelatedViewState,
  RELATED_SCORE_DOTS,
  type RelatedViewState,
  type RelatedWindowView,
} from "../../../src/ui/viewModels/relatedViewModel";

function workOf(n: number, extra: Partial<CanonicalWork> = {}): CanonicalWork {
  return {
    workKey: `key-${String(n)}`,
    ids: { doi: `10.1000/p${String(n)}` },
    type: "journal-article",
    title: `Paper ${String(n)}`,
    authors: [{ family: `Author${String(n)}` }],
    publishedDate: { year: 2022, iso: "2022" },
    ...extra,
  } as unknown as CanonicalWork;
}

function edge(kind: RelationKind): RelatedRow["edges"][number] {
  return {
    generator: "pmra",
    sourceId: "pubmed",
    limit: 20,
    edge: { kind, rank: 1, contexts: [] },
  } as unknown as RelatedRow["edges"][number];
}

function row(n: number, extra: Partial<RelatedRow> = {}): RelatedRow {
  return {
    work: workOf(n),
    records: [],
    edges: [edge("reference")],
    score: 0.5,
    chips: [{ id: "cited-by-seed" }],
    outsideWindow: false,
    inLibrary: false,
    ...extra,
  } as unknown as RelatedRow;
}

function status(
  generator: RelatedGeneratorId,
  state: RelatedGeneratorState,
  extra: Partial<RelatedGeneratorStatus> = {},
): RelatedGeneratorStatus {
  return {
    generator,
    sourceId: "pubmed",
    state,
    records: 0,
    fromCache: false,
    warnings: [],
    ...extra,
  } as RelatedGeneratorStatus;
}

function rowsOutput(
  rows: readonly RelatedRow[],
  extra: Partial<RelatedRows> = {},
): RelatedRows {
  return {
    outcome: "succeeded",
    ending: "rows",
    stageReached: "Done",
    seedFailures: [],
    seed: { work: workOf(0), matchedByTitle: false },
    rows,
    statuses: [],
    keyNotice: false,
    similarity: { space: "specter_v2" },
    hydration: {},
    links: [],
    flags: [],
    ...extra,
  } as unknown as RelatedRows;
}

const CHOOSE: RelatedChoose = {
  outcome: "succeeded",
  ending: "choose",
  stageReached: "ResolvingSeed",
  seedFailures: [],
  candidates: [
    workOf(1, { containerTitle: "Nature" }),
    workOf(2, { title: "Another paper" }),
  ],
};

const CANCELLED: RelatedCancelled = {
  outcome: "cancelled",
  stageReached: "Generating",
  seedFailures: [],
};

/** A search pipeline's answer to an import, as a write report. */
function wroteOutput(
  write: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): SearchImportOutput {
  return {
    outcome: "succeeded",
    write: {
      created: 2,
      linkedExisting: 1,
      skipped: 0,
      failed: 0,
      abstractCoveragePercent: 50,
      ...write,
    },
    ...extra,
  } as unknown as SearchImportOutput;
}

function failedOutput(
  error: Partial<SerializedError>,
  statuses: RelatedFailed["statuses"] = [],
): RelatedFailed {
  return {
    outcome: "failed",
    stageReached: "Generating",
    seedFailures: [],
    statuses,
    error: {
      code: "SOURCE",
      messageKey: "rh-error-source",
      detail: "secret detail s2-citations",
      retryable: true,
      ...error,
    },
  };
}

/** A pipeline, a job factory and a window, each recording what it was given. */
function world(
  answer: (
    input: RelatedInput,
  ) => Promise<RelatedOutput> | RelatedOutput = () => rowsOutput([row(1)]),
  importAnswer: (
    input: SearchImportInput,
  ) => Promise<SearchImportOutput> | SearchImportOutput = () => wroteOutput(),
) {
  const inputs: RelatedInput[] = [];
  const tokens: CancellationToken[] = [];
  const openOptions: unknown[] = [];
  const done = vi.fn<(outcome: string, message?: string) => void>();
  const dispose = vi.fn();
  const unsubscribed = vi.fn();
  let listener: ((snapshot: ProgressSnapshot) => void) | undefined;
  const run = vi.fn(async (input: RelatedInput): Promise<RelatedOutput> => {
    inputs.push(input);
    return answer(input);
  });
  const pipeline = {
    id: "related",
    validate: validateRelatedInput,
    run,
  } as unknown as RelatedPipeline;
  const openJob = vi.fn((options: { readonly token: CancellationToken }) => {
    openOptions.push(options);
    tokens.push(options.token);
    return Promise.resolve({
      context: {} as never,
      progress: {
        reporter: { done },
        events: {
          subscribe(next: (snapshot: ProgressSnapshot) => void) {
            listener = next;
            return unsubscribed;
          },
        },
      },
      dispose,
    });
  });
  const warn = vi.fn();
  const info = vi.fn();
  const importInputs: SearchImportInput[] = [];
  const importRun = vi.fn(
    async (input: SearchImportInput): Promise<SearchImportOutput> => {
      importInputs.push(input);
      return importAnswer(input);
    },
  );
  const linkToSeed = vi.fn(() => true);
  const seedLibraryId = vi.fn((_id: number): Promise<number | undefined> =>
    Promise.resolve(4),
  );
  const model = createRelatedViewModel({
    pipeline,
    jobs: { openJob },
    logger: { warn, info } as unknown as Logger,
    keyRequestUrl: "https://example.org/key",
    imports: {
      pipeline: { run: importRun } as never,
      listCollections: () => [{ id: 12, name: "Listed" }] as never,
      linkToSeed,
      seedLibraryId,
    },
  });
  const states: RelatedViewState[] = [];
  const view: RelatedWindowView = { render: (state) => states.push(state) };
  return {
    model,
    host: model.host,
    view,
    states,
    inputs,
    tokens,
    openOptions,
    openJob,
    run,
    done,
    dispose,
    unsubscribed,
    warn,
    info,
    importInputs,
    importRun,
    linkToSeed,
    seedLibraryId,
    last: () => model.state(),
    emit: (snapshot: Partial<ProgressSnapshot>) => {
      listener?.(snapshot as ProgressSnapshot);
    },
  };
}

/** Run one output through a connected model and return the state it leaves. */
async function drawn(output: RelatedOutput): Promise<RelatedViewState> {
  const w = world(() => output);
  w.host.connect(w.view);
  await w.host.run(7);
  return w.last();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("P5-T16: the Relation column's chips", () => {
  const relationOf = async (chips: readonly ReasonChip[], lexical = false) => {
    const state = await drawn(
      rowsOutput([row(1, { chips })], {
        similarity: { space: lexical ? "lexical" : "specter_v2" },
      }),
    );
    return state.records?.[0]?.related.chips ?? [];
  };

  it.each([
    ["cites-seed", "research-helper-search-related-chip-cites-seed"],
    ["cited-by-seed", "research-helper-search-related-chip-cited-by-seed"],
    ["recommended", "research-helper-search-related-chip-recommended"],
    ["similar-pubmed", "research-helper-search-related-chip-similar-pubmed"],
  ] as const)("words %s through its own message", async (id, messageId) => {
    const [chip] = await relationOf([{ id }]);
    expect(chip?.ref).toStrictEqual({ id: messageId, args: undefined });
    expect(chip?.text).toBeUndefined();
  });

  it("carries similarity with two decimals", async () => {
    const [chip] = await relationOf([{ id: "similar", similarity: 0.8123 }]);
    expect(chip?.ref).toStrictEqual({
      id: "research-helper-search-related-chip-similar",
      args: { value: "0.81" },
    });
  });

  it("says basic similarity on a run in the lexical space", async () => {
    const [chip] = await relationOf(
      [{ id: "similar", similarity: 0.14 }],
      true,
    );
    expect(chip?.ref).toStrictEqual({
      id: "research-helper-search-related-chip-basic-similarity",
      args: { value: "0.14" },
    });
  });

  it("keeps a citation context out of every message and its arguments", async () => {
    const context = 'as shown <img src="x" onerror="alert(1)"> &amp; here';
    const [chip] = await relationOf([{ id: "citation-context", context }]);
    expect(chip?.text).toBe(context);
    expect(chip?.ref).toStrictEqual({
      id: "research-helper-search-related-chip-context-label",
      args: undefined,
    });
    expect(JSON.stringify(chip?.ref)).not.toContain("img");
  });

  it("stacks a row's reasons in the pipeline's order", async () => {
    const chips = await relationOf([
      { id: "cites-seed" },
      { id: "recommended" },
      { id: "citation-context", context: "words" },
    ]);
    expect(chips.map((chip) => chip.ref.id)).toStrictEqual([
      "research-helper-search-related-chip-cites-seed",
      "research-helper-search-related-chip-recommended",
      "research-helper-search-related-chip-context-label",
    ]);
  });
});

describe("P5-T16: in-library and out-of-window rows", () => {
  it("marks a library row as existing and leaves it unticked (FR-16)", async () => {
    const state = await drawn(rowsOutput([row(1, { inLibrary: true })]));
    expect(state.records?.[0]).toMatchObject({
      key: "key-1",
      existing: true,
      startsTicked: false,
    });
    expect(state.records?.[0]?.related.outsideWindow).toBe(false);
  });

  it("marks an out-of-window row, in words, and leaves it unticked (FR-18)", async () => {
    const state = await drawn(rowsOutput([row(1, { outsideWindow: true })]));
    const first = state.records?.[0];
    expect(first?.startsTicked).toBe(false);
    expect(first?.existing).toBe(false);
    expect(first?.related.outsideWindow).toBe(true);
    expect(first?.related.chips.map((chip) => chip.ref.id)).toStrictEqual([
      "research-helper-search-related-chip-cited-by-seed",
      "research-helper-search-related-chip-outside-window",
    ]);
  });

  it("ticks an ordinary row and an undated row", async () => {
    const undated = row(2, {
      work: workOf(2, { publishedDate: undefined } as never),
    });
    const state = await drawn(rowsOutput([row(1), undated]));
    expect(state.records?.map((record) => record.startsTicked)).toStrictEqual([
      true,
      true,
    ]);
    expect(state.records?.[0]?.year).toBe(2022);
    expect(state.records?.[1]).not.toHaveProperty("year");
  });

  it("keeps the pipeline's order, older rows included", async () => {
    const state = await drawn(
      rowsOutput([
        row(1, { score: 0.9, outsideWindow: true }),
        row(2, { score: 0.5 }),
        row(3, { score: 0.1, outsideWindow: true }),
        row(4, { score: 0.05 }),
      ]),
    );
    expect(state.records?.map((record) => record.key)).toStrictEqual([
      "key-1",
      "key-2",
      "key-3",
      "key-4",
    ]);
  });

  it("copies the work's title and authors, and no hidden column's text", async () => {
    const state = await drawn(rowsOutput([row(1)]));
    expect(state.records?.[0]).toMatchObject({
      title: "Paper 1",
      authors: [{ family: "Author1" }],
      sourceLabels: [],
      typeLabel: "",
      doi: "",
    });
  });
});

describe("P5-T16: the score's dots", () => {
  it.each([
    [1, 1, 5],
    [0.81, 1, 5],
    [0.8, 1, 4],
    [0.5, 1, 3],
    [0.2, 1, 1],
    [0.001, 1, 1],
    [0.14, 0.14, 5],
    [0, 1, 0],
    [-1, 1, 0],
    [1, 0, 0],
    [Number.NaN, 1, 0],
    [2, 1, 5],
  ])("score %d of highest %d draws %d", (score, highest, dots) => {
    expect(dotsOf(score, highest)).toBe(dots);
  });

  it("draws out of five", () => {
    expect(RELATED_SCORE_DOTS).toBe(5);
  });

  it("is relative to the run, so a keyless list's best row is full", async () => {
    const state = await drawn(
      rowsOutput([row(1, { score: 0.1 }), row(2, { score: 0.05 })], {
        similarity: { space: "lexical" },
      }),
    );
    expect(state.records?.map((r) => r.related.dots)).toStrictEqual([5, 3]);
    expect(state.records?.[1]?.related.scoreRef).toStrictEqual({
      id: "research-helper-search-related-score",
      args: { dots: 3 },
    });
  });

  it("takes the highest score wherever it is in the list", async () => {
    const state = await drawn(
      rowsOutput([row(1, { score: 0.1 }), row(2, { score: 0.5 })]),
    );
    expect(state.records?.map((r) => r.related.dots)).toStrictEqual([1, 5]);
  });

  it("shows no score for a row with no reason, even out of window", async () => {
    const state = await drawn(
      rowsOutput([row(1, { chips: [], outsideWindow: true, score: 0.9 })]),
    );
    expect(state.records?.[0]?.related.dots).toBe(0);
    expect(state.records?.[0]?.related.scoreRef).toBeUndefined();
  });
});

describe("P5-T16: Include counts", () => {
  it("starts on the bare labels", () => {
    const { includeLabels } = initialRelatedViewState().related;
    expect(includeLabels).toStrictEqual({
      reference: {
        id: "research-helper-search-related-include-reference",
        args: undefined,
      },
      citation: {
        id: "research-helper-search-related-include-citation",
        args: undefined,
      },
      recommendation: {
        id: "research-helper-search-related-include-recommendation",
        args: undefined,
      },
      similar: {
        id: "research-helper-search-related-include-similar",
        args: undefined,
      },
    });
  });

  it("counts rows by the kinds on their edges, once each", async () => {
    const state = await drawn(
      rowsOutput([
        row(1, {
          edges: [edge("reference"), edge("reference"), edge("similar")],
        }),
        row(2, { edges: [edge("citation"), edge("reference")] }),
        row(3, { edges: [edge("recommendation")] }),
        row(4, { edges: [edge("recommendation")] }),
      ]),
    );
    expect(state.related.includeLabels).toStrictEqual({
      reference: {
        id: "research-helper-search-related-include-reference-count",
        args: { count: 2 },
      },
      citation: {
        id: "research-helper-search-related-include-citation-count",
        args: { count: 1 },
      },
      recommendation: {
        id: "research-helper-search-related-include-recommendation-count",
        args: { count: 2 },
      },
      similar: {
        id: "research-helper-search-related-include-similar-count",
        args: { count: 1 },
      },
    });
    expect(state.records?.[0]?.related.kinds).toStrictEqual([
      "reference",
      "similar",
    ]);
  });
});

describe("P5-T16: one status row per list", () => {
  it.each([
    ["s2-recommendations"],
    ["pmra"],
    ["s2-citations"],
    ["s2-references"],
    ["europepmc-citations"],
    ["europepmc-references"],
    ["crossref-references"],
  ] as const)("names %s by its own message", async (generator) => {
    const state = await drawn(
      rowsOutput([], { statuses: [status(generator, "not-indexed")] }),
    );
    expect(state.sources[0]).toMatchObject({
      sourceId: generator,
      nameId: `research-helper-search-related-generator-${generator}`,
    });
  });

  it.each([
    ["no-key", "research-helper-search-related-source-no-key", "succeeded"],
    [
      "not-indexed",
      "research-helper-search-related-source-not-indexed",
      "succeeded",
    ],
    [
      "could-not-ask",
      "research-helper-search-related-source-could-not-ask",
      "succeeded",
    ],
    [
      "over-budget",
      "research-helper-search-related-source-over-budget",
      "succeeded",
    ],
    [
      "rate-limited",
      "research-helper-search-related-source-rate-limited",
      "failed",
    ],
  ] as const)("reads %s", async (state, id, outcome) => {
    const drawnState = await drawn(
      rowsOutput([], { statuses: [status("pmra", state)] }),
    );
    expect(drawnState.sources[0]?.detail).toStrictEqual({
      id,
      args: undefined,
    });
    expect(drawnState.sources[0]?.outcome).toBe(outcome);
  });

  it("gives an answered list its count, from the shared message", async () => {
    const state = await drawn(
      rowsOutput([], {
        statuses: [status("pmra", "answered", { records: 12 })],
      }),
    );
    expect(state.sources[0]?.detail).toStrictEqual({
      id: "research-helper-search-source-results",
      args: { count: 12 },
    });
    expect(state.sources[0]?.outcome).toBe("succeeded");
  });

  it("gives a failed list its machine code and nothing else", async () => {
    const state = await drawn(
      rowsOutput([], {
        statuses: [
          status("pmra", "failed", { errorCode: "UPSTREAM_SERVER" }),
          status("s2-citations", "failed"),
        ],
      }),
    );
    expect(state.sources.map((line) => line.detail)).toStrictEqual([
      {
        id: "research-helper-search-related-source-failed",
        args: { code: "UPSTREAM_SERVER" },
      },
      {
        id: "research-helper-search-related-source-failed",
        args: { code: "SOURCE" },
      },
    ]);
    expect(state.sources[0]?.outcome).toBe("failed");
  });
});

describe("P5-T16: the keyless notice and the banner", () => {
  it("shows the key link when the run itself found no key", async () => {
    const state = await drawn(rowsOutput([row(1)], { keyNotice: true }));
    expect(state.related.keyRequestUrl).toBe("https://example.org/key");
  });

  it("shows nothing when the run had a key", async () => {
    const state = await drawn(rowsOutput([row(1)], { keyNotice: false }));
    expect(state.related.keyRequestUrl).toBeUndefined();
  });

  it("publishes no export control's notices, only warnings", async () => {
    const state = await drawn(
      rowsOutput([row(1)], {
        seed: { work: workOf(0), matchedByTitle: true },
      }),
    );
    expect(state.notices).toStrictEqual([]);
    expect(state.warnings.map((line) => line.id)).toStrictEqual([
      "research-helper-search-related-matched-by-title",
    ]);
  });

  it("warns when a seed service failed", async () => {
    const state = await drawn(
      rowsOutput([row(1)], {
        seedFailures: [{ source: "crossref", step: "title" }] as never,
      }),
    );
    expect(state.warnings.map((line) => line.id)).toStrictEqual([
      "research-helper-search-related-seed-failures",
    ]);
  });

  it.each([
    ["no-store", "research-helper-search-related-similarity-no-store"],
    ["fetch-failed", "research-helper-search-related-similarity-fetch-failed"],
  ] as const)("words the similarity notice %s", async (notice, id) => {
    const state = await drawn(
      rowsOutput([row(1)], {
        similarity: { space: "lexical", notice },
      }),
    );
    expect(state.warnings.map((line) => line.id)).toStrictEqual([id]);
  });
});

describe("P5-T16: panels", () => {
  it("shows the table for rows, with Cancel gone", async () => {
    const state = await drawn(rowsOutput([row(1)]));
    expect(state).toMatchObject({
      panel: "results",
      running: false,
      cancelVisible: false,
      progressPercent: undefined,
      status: undefined,
      emptyHeadline: undefined,
      error: undefined,
    });
  });

  it("shows its own empty line for no rows", async () => {
    const state = await drawn(rowsOutput([]));
    expect(state.panel).toBe("empty");
    expect(state.emptyHeadline).toStrictEqual({
      id: "research-helper-search-related-state-empty",
      args: undefined,
    });
  });

  it("says it is working while the run goes, on the panel that says what will appear", async () => {
    const gate = deferred<RelatedOutput>();
    const w = world(() => gate.promise);
    w.host.connect(w.view);
    const running = w.host.run(7);
    expect(w.last()).toMatchObject({
      panel: "initial",
      running: true,
      cancelVisible: true,
      progressPercent: 0,
      status: {
        id: "research-helper-search-related-status-running",
      },
    });
    gate.resolve(rowsOutput([row(1)]));
    await running;
    expect(w.last().running).toBe(false);
  });

  it("moves the revision so the table is replaced, and clears it for a new run", async () => {
    const w = world();
    w.host.connect(w.view);
    expect(w.last().recordsRevision).toBe(0);
    await w.host.run(7);
    const first = w.last().recordsRevision;
    expect(first).toBeGreaterThan(0);
    const during = w.states.find((state) => state.running);
    expect(during?.records).toStrictEqual([]);
    expect(during?.recordsRevision).toBeLessThan(first);
    await w.host.retry();
    expect(w.last().recordsRevision).toBeGreaterThan(first);
    // The new run's empty table is itself a new revision, or the window keeps
    // the old rows on screen under a run that has not answered.
    const second = w.states.filter((state) => state.running).at(-1);
    expect(second?.recordsRevision).toBeGreaterThan(first);
  });

  it("clears the last run's empty line and error while a new run goes", async () => {
    const gate = deferred<RelatedOutput>();
    let answer: () => Promise<RelatedOutput> | RelatedOutput = () =>
      rowsOutput([]);
    const w = world(() => answer());
    w.host.connect(w.view);
    await w.host.run(7);
    expect(w.last().emptyHeadline).toBeDefined();
    answer = () => failedOutput({});
    await w.host.retry();
    expect(w.last().error).toBeDefined();
    answer = () => gate.promise;
    const running = w.host.retry();
    expect(w.last().emptyHeadline).toBeUndefined();
    expect(w.last().error).toBeUndefined();
    gate.resolve(rowsOutput([]));
    await running;
  });

  it("clears the last run's banner and rows while a new run goes", async () => {
    const gate = deferred<RelatedOutput>();
    let answer: () => Promise<RelatedOutput> | RelatedOutput = () =>
      rowsOutput([row(1)], {
        keyNotice: true,
        statuses: [status("pmra", "answered")],
        seed: { work: workOf(0), matchedByTitle: true },
      });
    const w = world(() => answer());
    w.host.connect(w.view);
    await w.host.run(7);
    expect(w.last().warnings).toHaveLength(1);
    answer = () => gate.promise;
    const running = w.host.retry();
    expect(w.last()).toMatchObject({
      warnings: [],
      sources: [],
      error: undefined,
      records: [],
    });
    expect(w.last().related.keyRequestUrl).toBeUndefined();
    expect(w.last().related.includeLabels.reference.id).toBe(
      "research-helper-search-related-include-reference",
    );
    gate.resolve(rowsOutput([]));
    await running;
  });

  it("folds progress into the bar, in bounds, and ignores an unknown fraction", async () => {
    const gate = deferred<RelatedOutput>();
    const w = world(() => gate.promise);
    w.host.connect(w.view);
    const running = w.host.run(7);
    await flush();
    w.emit({ fraction: 0.426 });
    expect(w.last().progressPercent).toBe(43);
    w.emit({ fraction: 3 });
    expect(w.last().progressPercent).toBe(100);
    w.emit({ fraction: -1 });
    expect(w.last().progressPercent).toBe(0);
    w.emit({ fraction: 0.5 });
    w.emit({});
    expect(w.last().progressPercent).toBe(50);
    gate.resolve(rowsOutput([]));
    await running;
    expect(w.unsubscribed).toHaveBeenCalledTimes(1);
  });
});

describe("P5-T16: how a run is started", () => {
  it("opens one job, with no record, and validates first", async () => {
    const w = world();
    w.host.connect(w.view);
    await w.host.run(7);
    expect(w.openOptions).toHaveLength(1);
    expect(w.openOptions[0]).toMatchObject({
      pipelineId: "related",
      openOn: "completion",
    });
    expect(w.openOptions[0]).not.toHaveProperty("record");
    expect(w.inputs).toStrictEqual([{ seedItemID: 7 }]);
  });

  it.each([[0], [-1], [1.5], [Number.NaN], [undefined]])(
    "refuses seed id %s before opening a job",
    async (id) => {
      const w = world();
      w.host.connect(w.view);
      await w.host.run(id as number);
      expect(w.openJob).not.toHaveBeenCalled();
      expect(w.run).not.toHaveBeenCalled();
      expect(w.last()).toMatchObject({
        panel: "error",
        running: false,
        cancelVisible: false,
        error: {
          headline: { id: "rh-error-seed-gone" },
          retry: false,
          openPreferences: false,
        },
      });
    },
  );

  it("words a validation error it does not know generically", async () => {
    const w = world();
    const pipeline = {
      validate: () => ({
        ok: false,
        errors: [{ field: "x", messageKey: "rh-error-something" }],
      }),
      run: vi.fn(),
    } as unknown as RelatedPipeline;
    const model = createRelatedViewModel({
      pipeline,
      jobs: { openJob: vi.fn() } as never,
      logger: { warn: vi.fn() } as unknown as Logger,
      keyRequestUrl: "u",
      imports: {} as never,
    });
    model.host.connect(w.view);
    await model.host.run(7);
    expect(model.state().error?.headline.id).toBe(
      "research-helper-search-related-state-failed",
    );
  });

  it("ignores a second run while one is going", async () => {
    const gate = deferred<RelatedOutput>();
    const w = world(() => gate.promise);
    w.host.connect(w.view);
    const first = w.host.run(7);
    await w.host.run(8);
    expect(w.warn).toHaveBeenCalledTimes(1);
    expect(w.openJob).toHaveBeenCalledTimes(1);
    gate.resolve(rowsOutput([]));
    await first;
  });

  it("can start again once a run has ended", async () => {
    const w = world();
    w.host.connect(w.view);
    await w.host.run(7);
    await w.host.run(8);
    expect(w.warn).not.toHaveBeenCalled();
    expect(w.inputs.map((input) => input.seedItemID)).toStrictEqual([7, 8]);
  });
});

describe("P5-T16: FR-14's title-match list", () => {
  it("offers the candidates and asks", async () => {
    const state = await drawn(CHOOSE);
    expect(state.panel).toBe("choose");
    expect(state.running).toBe(false);
    expect(state.related.candidates).toStrictEqual([
      {
        key: "key-1",
        title: "Paper 1",
        authors: [{ family: "Author1" }],
        venue: "Nature",
        year: 2022,
        doi: "10.1000/p1",
      },
      {
        key: "key-2",
        title: "Another paper",
        authors: [{ family: "Author2" }],
        year: 2022,
        doi: "10.1000/p2",
      },
    ]);
  });

  it("warns about a seed service on the way to the list", async () => {
    const state = await drawn({
      ...CHOOSE,
      seedFailures: [{ source: "crossref", step: "title" }] as never,
    });
    expect(state.warnings.map((line) => line.id)).toStrictEqual([
      "research-helper-search-related-seed-failures",
    ]);
  });

  it("raises no toast for a run that is asking, and closes its job", async () => {
    const w = world(() => CHOOSE);
    w.host.connect(w.view);
    await w.host.run(7);
    expect(w.done).not.toHaveBeenCalled();
    expect(w.dispose).toHaveBeenCalledTimes(1);
    expect(w.unsubscribed).toHaveBeenCalledTimes(1);
  });

  it("goes on with the pick as chosenSeed, and still sends the seed item", async () => {
    let answer: RelatedOutput = CHOOSE;
    const w = world(() => answer);
    w.host.connect(w.view);
    await w.host.run(7);
    answer = rowsOutput([row(1)]);
    await w.host.pick("key-2");
    expect(w.inputs[1]).toStrictEqual({
      seedItemID: 7,
      chosenSeed: CHOOSE.candidates[1],
    });
    expect(w.last().panel).toBe("results");
    expect(w.last().related.candidates).toStrictEqual([]);
  });

  it("ignores a key it did not offer", async () => {
    const w = world(() => CHOOSE);
    w.host.connect(w.view);
    await w.host.run(7);
    await w.host.pick("key-99");
    expect(w.inputs).toHaveLength(1);
    expect(w.warn).toHaveBeenCalledTimes(1);
  });

  it("ignores a pick before any run", async () => {
    const w = world();
    w.host.connect(w.view);
    await w.host.pick("key-1");
    expect(w.run).not.toHaveBeenCalled();
  });

  it("does not keep the offer once the next run has started", async () => {
    let answer: RelatedOutput = CHOOSE;
    const w = world(() => answer);
    w.host.connect(w.view);
    await w.host.run(7);
    answer = rowsOutput([row(1)]);
    await w.host.retry();
    await w.host.pick("key-1");
    expect(w.inputs).toHaveLength(2);
  });

  it("forgets the offer when the window reconnects", async () => {
    const w = world(() => CHOOSE);
    w.host.connect(w.view);
    await w.host.run(7);
    w.host.connect(w.view);
    await w.host.pick("key-1");
    expect(w.inputs).toHaveLength(1);
  });
});

describe("P5-T16: failures", () => {
  it.each([
    ["rh-error-seed-gone"],
    ["rh-error-seed-no-identifier"],
    ["rh-error-seed-no-match"],
  ])("draws %s with no button", (messageKey) => {
    const view = failureView({
      code: "SEED_UNRESOLVED",
      messageKey,
      detail: "d",
      retryable: false,
    });
    expect(view).toStrictEqual({
      headline: { id: messageKey, args: undefined },
      lines: [],
      details: ["SEED_UNRESOLVED"],
      retry: false,
      openPreferences: false,
    });
  });

  it("draws every list failing as could-not-reach, with Retry, and never the detail", async () => {
    const state = await drawn(
      failedOutput({ httpStatus: 503 }, [
        status("pmra", "failed", { errorCode: "UPSTREAM_SERVER" }),
      ]),
    );
    expect(state.panel).toBe("error");
    expect(state.error).toStrictEqual({
      headline: {
        id: "research-helper-search-state-error",
        args: undefined,
      },
      lines: [],
      details: ["SOURCE", "503"],
      retry: true,
      openPreferences: false,
    });
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0]?.outcome).toBe("failed");
    expect(JSON.stringify(state)).not.toContain("secret detail");
  });

  it("uses the shared row for a code that names no database", () => {
    const view = failureView({
      code: "OFFLINE",
      messageKey: "rh-error-offline",
      detail: "d",
      retryable: true,
    });
    expect(view.headline.id).toBe("rh-error-offline");
    expect(view.retry).toBe(true);
    expect(view.details).toStrictEqual(["OFFLINE"]);
  });

  it("offers Preferences for a configuration failure", () => {
    const view = failureView({
      code: "CONFIGURATION",
      messageKey: "rh-error-configuration",
      detail: "d",
      retryable: false,
    });
    expect(view.openPreferences).toBe(true);
    expect(view.retry).toBe(false);
  });

  it.each([
    ["ZOTERO_API", "rh-error-zotero"],
    ["STORAGE", "rh-error-storage"],
  ])("draws %s through its row", (code, id) => {
    const view = failureView({
      code,
      messageKey: id,
      detail: "d",
      retryable: false,
    });
    expect(view.headline.id).toBe(id);
    expect(view.retry).toBe(false);
  });

  it.each([[true], [false]])(
    "follows the error's own retryable (%s) for any other code",
    (retryable) => {
      const view = failureView({
        code: "UPSTREAM_SERVER",
        messageKey: "rh-error-upstream",
        detail: "d",
        retryable,
      });
      expect(view.headline.id).toBe(
        "research-helper-search-related-state-failed",
      );
      expect(view.retry).toBe(retryable);
      expect(view.openPreferences).toBe(false);
      expect(view.details).toStrictEqual(["UPSTREAM_SERVER"]);
    },
  );

  it("closes the job as failed, with no toast", async () => {
    const w = world(() => failedOutput({}));
    w.host.connect(w.view);
    await w.host.run(7);
    expect(w.done).toHaveBeenCalledWith("failed", undefined);
    expect(w.dispose).toHaveBeenCalledTimes(1);
  });

  it("warns about a seed service on a failed run", async () => {
    const state = await drawn({
      ...failedOutput({}),
      seedFailures: [{ source: "crossref", step: "title" }] as never,
    });
    expect(state.warnings).toHaveLength(1);
  });

  it("closes the surfaces and says so when the pipeline rejects", async () => {
    const w = world(() => Promise.reject(new Error("defect")));
    w.host.connect(w.view);
    await expect(w.host.run(7)).rejects.toThrow("defect");
    expect(w.dispose).toHaveBeenCalledTimes(1);
    expect(w.unsubscribed).toHaveBeenCalledTimes(1);
    expect(w.last()).toMatchObject({
      panel: "error",
      running: false,
      cancelVisible: false,
      error: {
        headline: { id: "research-helper-search-related-state-failed" },
        retry: true,
      },
    });
    // And it can run again.
    await expect(w.host.retry()).rejects.toThrow("defect");
    expect(w.run).toHaveBeenCalledTimes(2);
  });

  it("says so when the job cannot be opened, and can run again", async () => {
    const w = world();
    w.host.connect(w.view);
    w.openJob.mockImplementationOnce(() => Promise.reject(new Error("no job")));
    await expect(w.host.run(7)).rejects.toThrow("no job");
    expect(w.run).not.toHaveBeenCalled();
    expect(w.last()).toMatchObject({
      panel: "error",
      running: false,
      cancelVisible: false,
      error: { retry: true },
    });
    await w.host.retry();
    expect(w.run).toHaveBeenCalledTimes(1);
  });

  it("draws nothing when a left run's job fails to open", async () => {
    const gate = deferred<never>();
    const w = world();
    const detach = w.host.connect(w.view);
    w.openJob.mockImplementationOnce(() => gate.promise);
    const running = w.host.run(7);
    detach();
    const count = w.states.length;
    gate.reject(new Error("no job"));
    await expect(running).rejects.toThrow("no job");
    expect(w.states).toHaveLength(count);
  });

  it("draws nothing when a left run's pipeline rejects", async () => {
    const gate = deferred<RelatedOutput>();
    const w = world(() => gate.promise);
    const detach = w.host.connect(w.view);
    const running = w.host.run(7);
    await flush();
    detach();
    const count = w.states.length;
    gate.reject(new Error("defect"));
    await expect(running).rejects.toThrow("defect");
    expect(w.states).toHaveLength(count);
    expect(w.dispose).toHaveBeenCalledTimes(1);
  });

  it("draws nothing in the new window when a left run's pipeline rejects", async () => {
    const gate = deferred<RelatedOutput>();
    const w = world(() => gate.promise);
    w.host.connect(w.view);
    const running = w.host.run(7);
    await flush();
    const fresh: RelatedViewState[] = [];
    w.host.connect({ render: (state) => fresh.push(state) });
    const count = fresh.length;
    gate.reject(new Error("defect"));
    await expect(running).rejects.toThrow("defect");
    expect(fresh).toHaveLength(count);
    expect(w.last().panel).toBe("initial");
  });
});

describe("P5-T16: Retry", () => {
  it("repeats the last input, a pick included", async () => {
    let answer: RelatedOutput = CHOOSE;
    const w = world(() => answer);
    w.host.connect(w.view);
    await w.host.run(7);
    answer = failedOutput({});
    await w.host.pick("key-1");
    answer = rowsOutput([row(1)]);
    await w.host.retry();
    expect(w.inputs[2]).toStrictEqual({
      seedItemID: 7,
      chosenSeed: CHOOSE.candidates[0],
    });
  });

  it("does nothing before any run", async () => {
    const w = world();
    w.host.connect(w.view);
    await w.host.retry();
    expect(w.run).not.toHaveBeenCalled();
  });

  it("does nothing after the window has reconnected", async () => {
    const w = world();
    w.host.connect(w.view);
    await w.host.run(7);
    w.host.connect(w.view);
    await w.host.retry();
    expect(w.run).toHaveBeenCalledTimes(1);
  });
});

describe("P5-T16: Cancel", () => {
  it("cancels the run's token and draws the outcome", async () => {
    const gate = deferred<RelatedOutput>();
    const w = world(() => gate.promise);
    w.host.connect(w.view);
    const running = w.host.run(7);
    await flush();
    expect(w.tokens[0]?.isCancellationRequested).toBe(false);
    w.host.cancel();
    expect(w.tokens[0]?.isCancellationRequested).toBe(true);
    gate.resolve(CANCELLED);
    await running;
    expect(w.last()).toMatchObject({
      panel: "initial",
      running: false,
      cancelVisible: false,
      status: { id: "research-helper-search-related-status-cancelled" },
    });
    expect(w.done).toHaveBeenCalledWith("cancelled", undefined);
    expect(w.dispose).toHaveBeenCalledTimes(1);
  });

  it("warns about a seed service on a cancelled run", async () => {
    const state = await drawn({
      ...CANCELLED,
      seedFailures: [{ source: "crossref", step: "title" }] as never,
    });
    expect(state.warnings).toHaveLength(1);
  });

  it("does nothing with no run", () => {
    const w = world();
    w.host.connect(w.view);
    expect(() => {
      w.host.cancel();
    }).not.toThrow();
  });
});

describe("P5-T16: the toast", () => {
  it("words the count through the window's formatter", async () => {
    const formatMessages = vi.fn(() =>
      Promise.resolve([{ value: "2 results · 1 new" }]),
    );
    const w = world(() => rowsOutput([row(1), row(2, { inLibrary: true })]));
    w.host.connect({ ...w.view, formatter: { formatMessages } });
    await w.host.run(7);
    expect(formatMessages).toHaveBeenCalledWith([
      {
        id: "research-helper-search-result-count",
        args: { total: 2, new: 1 },
      },
    ]);
    expect(w.done).toHaveBeenCalledWith("succeeded", "2 results · 1 new");
  });

  it("goes without when there is no formatter", async () => {
    const w = world();
    w.host.connect(w.view);
    await w.host.run(7);
    expect(w.done).toHaveBeenCalledWith("succeeded", undefined);
  });

  it("goes without when the formatter fails or has no value", async () => {
    const failing = world();
    failing.host.connect({
      ...failing.view,
      formatter: { formatMessages: () => Promise.reject(new Error("x")) },
    });
    await failing.host.run(7);
    expect(failing.done).toHaveBeenCalledWith("succeeded", undefined);

    const blank = world();
    blank.host.connect({
      ...blank.view,
      formatter: { formatMessages: () => Promise.resolve([{ value: null }]) },
    });
    await blank.host.run(7);
    expect(blank.done).toHaveBeenCalledWith("succeeded", undefined);
  });

  it("raises nothing when the window closed while it was being worded", async () => {
    const gate = deferred<{ value: string }[]>();
    const w = world();
    const detach = w.host.connect({
      ...w.view,
      formatter: { formatMessages: () => gate.promise },
    });
    const running = w.host.run(7);
    await flush();
    detach();
    gate.resolve([{ value: "text" }]);
    await running;
    expect(w.done).not.toHaveBeenCalled();
    expect(w.dispose).toHaveBeenCalledTimes(1);
  });

  it("raises one toast when Retry starts while the last one was being worded", async () => {
    const gate = deferred<{ value: string }[]>();
    const w = world();
    w.host.connect({
      ...w.view,
      formatter: {
        formatMessages: vi
          .fn()
          .mockReturnValueOnce(gate.promise)
          .mockResolvedValue([{ value: "second" }]),
      },
    });
    const first = w.host.run(7);
    await flush();
    await w.host.retry();
    gate.resolve([{ value: "first" }]);
    await first;
    expect(w.done).toHaveBeenCalledTimes(1);
    expect(w.done).toHaveBeenCalledWith("succeeded", "second");
    expect(w.dispose).toHaveBeenCalledTimes(2);
  });
});

describe("P5-T16: closing and re-opening the window", () => {
  it("draws the clean state on connect", () => {
    const w = world();
    w.host.connect(w.view);
    expect(w.states).toHaveLength(1);
    expect(w.states[0]?.panel).toBe("initial");
    expect(w.states[0]?.recordsRevision).toBe(0);
  });

  it("forgets the last run's rows on a new connect", async () => {
    const w = world();
    w.host.connect(w.view);
    await w.host.run(7);
    w.host.connect(w.view);
    expect(w.last().records).toBeUndefined();
    expect(w.last().recordsRevision).toBe(0);
  });

  it("cancels a running run on detach and drops what it says", async () => {
    const gate = deferred<RelatedOutput>();
    const w = world(() => gate.promise);
    const detach = w.host.connect(w.view);
    const running = w.host.run(7);
    await flush();
    detach();
    expect(w.tokens[0]?.isCancellationRequested).toBe(true);
    const count = w.states.length;
    w.emit({ fraction: 0.5 });
    gate.resolve(rowsOutput([row(1)]));
    await running;
    expect(w.states).toHaveLength(count);
    expect(w.done).not.toHaveBeenCalled();
    expect(w.dispose).toHaveBeenCalledTimes(1);
    expect(w.unsubscribed).toHaveBeenCalledTimes(1);
  });

  it("cancels a running run on a new connect, whose window can run at once", async () => {
    const gate = deferred<RelatedOutput>();
    let answer: () => Promise<RelatedOutput> | RelatedOutput = () =>
      gate.promise;
    const w = world(() => answer());
    w.host.connect(w.view);
    const stale = w.host.run(7);
    await flush();

    const fresh: RelatedViewState[] = [];
    w.host.connect({ render: (state) => fresh.push(state) });
    expect(w.tokens[0]?.isCancellationRequested).toBe(true);
    answer = () => rowsOutput([row(2)]);
    await w.host.run(8);
    expect(w.last().records?.[0]?.key).toBe("key-2");
    expect(w.warn).not.toHaveBeenCalled();

    // The old run answers late, and draws nothing over the new one.
    const before = fresh.length;
    gate.resolve(rowsOutput([row(1)]));
    await stale;
    expect(fresh).toHaveLength(before);
    expect(w.last().records?.[0]?.key).toBe("key-2");
    expect(w.done).toHaveBeenCalledTimes(1);
  });

  it("does not draw a left run's progress in the new window", async () => {
    const gate = deferred<RelatedOutput>();
    const w = world(() => gate.promise);
    w.host.connect(w.view);
    const running = w.host.run(7);
    await flush();
    const fresh: RelatedViewState[] = [];
    w.host.connect({ render: (state) => fresh.push(state) });
    const count = fresh.length;
    w.emit({ fraction: 0.5 });
    expect(fresh).toHaveLength(count);
    expect(w.last().progressPercent).toBeUndefined();
    gate.resolve(rowsOutput([]));
    await running;
  });

  it("keeps hold of the new window's run when the left one ends", async () => {
    const gates = [deferred<RelatedOutput>(), deferred<RelatedOutput>()];
    let at = 0;
    const w = world(() => {
      const gate = gates[at];
      at += 1;
      return (gate as (typeof gates)[number]).promise;
    });
    w.host.connect(w.view);
    const left = w.host.run(7);
    await flush();
    w.host.connect(w.view);
    const going = w.host.run(8);
    await flush();
    gates[0]?.resolve(rowsOutput([]));
    await left;
    // Cancel still reaches the run going, and a third run is still refused.
    w.host.cancel();
    expect(w.tokens[1]?.isCancellationRequested).toBe(true);
    await w.host.run(9);
    expect(w.run).toHaveBeenCalledTimes(2);
    gates[1]?.resolve(CANCELLED);
    await going;
  });

  it("does not let an old document's detach take the new window's view", async () => {
    const w = world();
    const detachOld = w.host.connect(w.view);
    const fresh: RelatedViewState[] = [];
    w.host.connect({ render: (state) => fresh.push(state) });
    detachOld();
    await w.host.run(7);
    expect(fresh.at(-1)?.panel).toBe("results");
  });

  it("does not cancel the new window's run from an old document's detach", async () => {
    const gate = deferred<RelatedOutput>();
    const w = world(() => gate.promise);
    const detachOld = w.host.connect(w.view);
    w.host.connect({ render: () => undefined });
    const running = w.host.run(7);
    await flush();
    detachOld();
    expect(w.tokens[0]?.isCancellationRequested).toBe(false);
    gate.resolve(rowsOutput([]));
    await running;
    expect(w.done).toHaveBeenCalledTimes(1);
  });

  it("stops drawing after detach", async () => {
    const w = world();
    const detach = w.host.connect(w.view);
    detach();
    const count = w.states.length;
    await w.host.run(7);
    expect(w.states).toHaveLength(count);
  });

  it("drops a run left while its job was still opening, and closes that job", async () => {
    const gate = deferred<never>();
    const w = world();
    const detach = w.host.connect(w.view);
    const realOpen = w.openJob.getMockImplementation();
    w.openJob.mockImplementationOnce(
      (options: { readonly token: CancellationToken }) =>
        gate.promise.catch(() => realOpen?.(options)) as never,
    );
    const running = w.host.run(7);
    detach();
    gate.reject(new Error("release"));
    await running;
    expect(w.run).not.toHaveBeenCalled();
    expect(w.dispose).toHaveBeenCalledTimes(1);
  });
});

/** A world whose jobs are real reporters, and what a popup would be asked to paint. */
function reporting(answer: () => Promise<RelatedOutput>) {
  const w = world(answer);
  const painted: string[] = [];
  const disposedWithTokenLive: boolean[] = [];
  w.openJob.mockImplementation((options) => {
    w.tokens.push(options.token);
    const reporter = new CompositeProgressReporter({
      clock: { now: () => 0 } as never,
      sinks: [
        {
          update: (snapshot) => {
            if (snapshot.status !== "running") painted.push(snapshot.status);
          },
        },
      ],
      token: options.token,
    });
    return Promise.resolve({
      context: {} as never,
      progress: {
        reporter,
        events: { subscribe: () => () => undefined },
      },
      dispose: () => {
        disposedWithTokenLive.push(!options.token.isCancellationRequested);
        reporter.dispose();
      },
    } as never);
  });
  return { w, painted, disposedWithTokenLive };
}

// Found in the integration round of 2026-11-05: a fake job never saw this, because the
// toast comes from the reporter answering its own token, below this model's `current()`.
describe("P5-T16: a left run raises no toast, on the real reporter", () => {
  it("re-opening cancels the run and paints nothing", async () => {
    const gate = deferred<RelatedOutput>();
    const { w, painted, disposedWithTokenLive } = reporting(() => gate.promise);
    w.host.connect(w.view);
    const running = w.host.run(7);
    await flush();
    w.host.connect({ render: vi.fn() });
    expect(w.tokens[0]?.isCancellationRequested).toBe(true);
    expect(disposedWithTokenLive).toEqual([true]);
    gate.resolve(rowsOutput([]));
    await running;
    expect(painted).toEqual([]);
    expect(disposedWithTokenLive).toEqual([true]);
  });

  it("closing cancels the run and paints nothing", async () => {
    const gate = deferred<RelatedOutput>();
    const { w, painted } = reporting(() => gate.promise);
    const detach = w.host.connect(w.view);
    const running = w.host.run(7);
    await flush();
    detach();
    expect(w.tokens[0]?.isCancellationRequested).toBe(true);
    gate.resolve(rowsOutput([]));
    await running;
    expect(painted).toEqual([]);
  });

  it("a window that leaves while the job opens cancels nothing it would have to paint", async () => {
    const gate = deferred<RelatedOutput>();
    const { w, painted, disposedWithTokenLive } = reporting(() => gate.promise);
    const real = w.openJob.getMockImplementation();
    const opening = deferred<void>();
    w.openJob.mockImplementationOnce(async (options) => {
      await opening.promise;
      return real?.(options) as never;
    });
    w.host.connect(w.view);
    const running = w.host.run(7);
    await flush();
    w.host.connect({ render: vi.fn() });
    opening.resolve();
    await running;
    expect(painted).toEqual([]);
    expect(w.run).not.toHaveBeenCalled();
    expect(disposedWithTokenLive).toEqual([true]);
  });

  it("the new window's run still has its toast and its cancel", async () => {
    const gates = [deferred<RelatedOutput>(), deferred<RelatedOutput>()];
    let at = 0;
    const { w, painted } = reporting(() => {
      const gate = gates[at] as (typeof gates)[number];
      at += 1;
      return gate.promise;
    });
    w.host.connect(w.view);
    const first = w.host.run(7);
    await flush();
    w.host.connect(w.view);
    const second = w.host.run(8);
    await flush();
    expect(w.tokens[1]?.isCancellationRequested).toBe(false);
    gates[0]?.resolve(rowsOutput([]));
    await first;
    expect(painted).toEqual([]);
    w.host.cancel();
    expect(w.tokens[1]?.isCancellationRequested).toBe(true);
    expect(painted).toEqual(["cancelled"]);
    gates[1]?.resolve(CANCELLED);
    await second;
  });
});

describe("P5-T17: importing the ticked rows", () => {
  const rec = (n: number, m = 0) => ({ id: `rec-${String(n)}-${String(m)}` });
  const FOUR = (): RelatedRow[] => [
    row(1, { records: [rec(1), rec(1, 1)] } as never),
    row(2, { records: [rec(2)] } as never),
    row(3, {
      records: [rec(3)],
      inLibrary: true,
      existingItemID: 33,
    } as never),
    row(4, { records: [rec(4)], inLibrary: true } as never),
  ];
  const REQUEST = {
    keys: ["key-1", "key-3"],
    collectionID: "new:Target",
    linkToSeed: true,
  };

  /** A window with four rows drawn from seed 7. */
  async function ready(
    importAnswer?: (
      input: SearchImportInput,
    ) => Promise<SearchImportOutput> | SearchImportOutput,
    extra: Partial<RelatedRows> = {},
  ) {
    const w = world(() => rowsOutput(FOUR(), extra), importAnswer);
    w.host.connect(w.view);
    await w.host.run(7);
    w.done.mockClear();
    w.dispose.mockClear();
    w.unsubscribed.mockClear();
    w.openJob.mockClear();
    w.warn.mockClear();
    return w;
  }

  const inputOf = (w: { importInputs: SearchImportInput[] }) => {
    const input = w.importInputs[0];
    if (input === undefined) throw new Error("nothing was imported");
    return input;
  };

  it("hands the pipeline the ticked rows, aligned, each with its first record", async () => {
    const w = await ready();
    await w.host.importRows(REQUEST);
    const input = inputOf(w);
    expect(input.works?.map((work) => work.workKey)).toStrictEqual([
      "key-1",
      "key-3",
    ]);
    expect(input.records).toStrictEqual([rec(1), rec(3)]);
    expect(input.target?.selectedRecordIds).toBeUndefined();
  });

  it("uses the table's order, not the order of the keys", async () => {
    const w = await ready();
    await w.host.importRows({ ...REQUEST, keys: ["key-3", "key-1"] });
    expect(inputOf(w).works?.map((work) => work.workKey)).toStrictEqual([
      "key-1",
      "key-3",
    ]);
  });

  it("asks no source: a preview import, with a limit in range and no query", async () => {
    const w = await ready();
    await w.host.importRows(REQUEST);
    const input = inputOf(w);
    expect(input.query).toBe("");
    expect(input.sourceIds).toStrictEqual([]);
    expect(input.dateFilter).toBe("none");
    expect(input.limit).toBe(PREFS.maxResults.min);
  });

  it("writes to the named new collection, in the seed's library, with the existing-item policy", async () => {
    const w = await ready();
    await w.host.importRows(REQUEST);
    expect(w.seedLibraryId).toHaveBeenCalledWith(7);
    expect(inputOf(w).target).toMatchObject({
      collectionName: "Target",
      libraryId: 4,
      duplicatePolicy: "link-existing",
    });
  });

  it("writes to a picked collection by its name", async () => {
    const w = await ready();
    await w.host.importRows({ ...REQUEST, collectionID: "12" });
    expect(inputOf(w).target?.collectionName).toBe("Listed");
  });

  it("carries the seed only when the box is ticked", async () => {
    const on = await ready();
    await on.host.importRows(REQUEST);
    expect(inputOf(on).target?.relateTo).toBe(7);

    const off = await ready();
    await off.host.importRows({ ...REQUEST, linkToSeed: false });
    expect(inputOf(off).target).not.toHaveProperty("relateTo");
  });

  it("passes on the item an in-library row was matched to, and only that", async () => {
    const w = await ready();
    await w.host.importRows({ ...REQUEST, keys: ["key-1", "key-3", "key-4"] });
    expect([...(inputOf(w).target?.existingItemIDs ?? [])]).toStrictEqual([
      ["key-3", 33],
    ]);
  });

  it("does not take an item id from a row not in the library", async () => {
    const w = world(() =>
      rowsOutput([row(1, { records: [rec(1)], existingItemID: 9 } as never)]),
    );
    w.host.connect(w.view);
    await w.host.run(7);
    await w.host.importRows({ ...REQUEST, keys: ["key-1"] });
    expect(inputOf(w).target).not.toHaveProperty("existingItemIDs");
  });

  it("opens a searchImport job on this run's token, with its toast at the end only", async () => {
    const w = await ready();
    await w.host.importRows(REQUEST);
    expect(w.openOptions.at(-1)).toMatchObject({
      pipelineId: "searchImport",
      openOn: "completion",
    });
    expect(w.importRun).toHaveBeenCalledTimes(1);
  });

  it("shows the import going, with the table left up", async () => {
    const gate = deferred<SearchImportOutput>();
    const w = await ready(() => gate.promise);
    const going = w.host.importRows(REQUEST);
    expect(w.last()).toMatchObject({
      running: true,
      cancelVisible: true,
      progressPercent: 0,
      panel: "results",
      notices: [],
      status: {
        id: "research-helper-search-status-importing",
        args: { done: 0, total: 2 },
      },
    });
    expect(w.last().records).toHaveLength(4);
    await flush();
    w.emit({ completed: 1, total: 2, fraction: 0.5 });
    expect(w.last().progressPercent).toBe(50);
    expect(w.last().status).toStrictEqual({
      id: "research-helper-search-status-importing",
      args: { done: 1, total: 2 },
    });
    w.emit({ completed: 2, fraction: undefined });
    expect(w.last().progressPercent).toBe(50);
    expect(w.last().status?.args).toStrictEqual({ done: 2, total: 2 });
    gate.resolve(wroteOutput());
    await going;
    expect(w.last().running).toBe(false);
    expect(w.unsubscribed).toHaveBeenCalled();
  });

  it("draws the summary and the coverage, and leaves the rows", async () => {
    const w = await ready();
    await w.host.importRows(REQUEST);
    const state = w.last();
    const summary = {
      id: "research-helper-import-summary",
      args: { imported: 2, linked: 1, skipped: 0, failed: 0 },
    };
    expect(state.notices).toStrictEqual([
      summary,
      {
        id: "research-helper-import-abstract-coverage",
        args: { percent: 50 },
      },
    ]);
    expect(state.status).toStrictEqual(summary);
    expect(state).toMatchObject({
      panel: "results",
      running: false,
      cancelVisible: false,
      progressPercent: undefined,
      warnings: [],
    });
    expect(state.records).toHaveLength(4);
    expect(state.error).toBeUndefined();
    expect(w.dispose).toHaveBeenCalledTimes(1);
  });

  it("adds Strategy B's lines when it ran", async () => {
    const w = await ready(() =>
      wroteOutput({
        importPaths: {
          viaTranslators: 1,
          handMapped: 1,
          fallbackReasons: {},
        },
      }),
    );
    await w.host.importRows(REQUEST);
    expect(w.last().notices.map((notice) => notice.id)).toContain(
      "research-helper-import-paths",
    );
  });

  it("keeps the banner the table already carried, through and after", async () => {
    const gate = deferred<SearchImportOutput>();
    const w = await ready(() => gate.promise, {
      seed: { work: workOf(0), matchedByTitle: true },
    } as Partial<RelatedRows>);
    const titled = "research-helper-search-related-matched-by-title";
    const going = w.host.importRows(REQUEST);
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([titled]);
    gate.resolve(wroteOutput());
    await going;
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([titled]);
  });

  it("says when the link failed, beside a summary that still counts the items", async () => {
    const w = await ready(() =>
      wroteOutput({
        seedLink: {
          linked: 0,
          error: { code: "ZOTERO_API", messageKey: "x", retryable: false },
        },
      }),
    );
    await w.host.importRows(REQUEST);
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      "research-helper-search-related-link-failed",
    ]);
    expect(w.last().notices[0]?.args).toMatchObject({ imported: 2 });
    expect(w.done).toHaveBeenCalledWith("succeeded", undefined);
  });

  it("says nothing about a link that held", async () => {
    const w = await ready(() =>
      wroteOutput({ seedLink: { linked: 3, error: undefined } }),
    );
    await w.host.importRows(REQUEST);
    expect(w.last().warnings).toStrictEqual([]);
  });

  it("reports a cancel before anything was written", async () => {
    const w = await ready(
      () => ({ outcome: "cancelled" }) as unknown as SearchImportOutput,
    );
    await w.host.importRows(REQUEST);
    expect(w.last().status).toStrictEqual({
      id: "rh-error-cancelled",
      args: { imported: 0 },
    });
    expect(w.last().panel).toBe("results");
    expect(w.done).toHaveBeenCalledWith("cancelled", undefined);
  });

  it("reports a cancel after a batch, with what was written", async () => {
    const w = await ready(() => wroteOutput({}, { outcome: "cancelled" }));
    await w.host.importRows(REQUEST);
    expect(w.last().notices[0]).toStrictEqual({
      id: "rh-error-cancelled",
      args: { imported: 2 },
    });
  });

  it("keeps the table and Import when a failure wrote nothing", async () => {
    const w = await ready(
      () =>
        ({
          outcome: "failed",
          error: {
            code: "ZOTERO_API",
            messageKey: "rh-error-zotero-api",
            retryable: false,
          },
        }) as unknown as SearchImportOutput,
    );
    await w.host.importRows(REQUEST);
    const state = w.last();
    expect(state.panel).toBe("results");
    expect(state.error).toBeUndefined();
    expect(state.records).toHaveLength(4);
    expect(state.running).toBe(false);
    expect(state.warnings).toHaveLength(1);
    expect(state.notices).toStrictEqual([]);
    expect(w.done).toHaveBeenCalledWith("failed", undefined);
  });

  it("keeps the headline beside the summary when a failure came after a batch", async () => {
    const w = await ready(() =>
      wroteOutput(
        {},
        {
          outcome: "failed",
          error: {
            code: "ZOTERO_API",
            messageKey: "rh-error-zotero-api",
            retryable: false,
          },
        },
      ),
    );
    await w.host.importRows(REQUEST);
    expect(w.last().warnings).toHaveLength(1);
    expect(w.last().notices[0]?.id).toBe("research-helper-import-summary");
  });

  it("treats a partial import as a finished job", async () => {
    const w = await ready(() => wroteOutput({}, { outcome: "partial" }));
    await w.host.importRows(REQUEST);
    expect(w.done).toHaveBeenCalledWith("succeeded", undefined);
  });

  it("refuses when the seed has left the library, with its own line and no write", async () => {
    const w = await ready();
    w.seedLibraryId.mockResolvedValueOnce(undefined);
    await w.host.importRows(REQUEST);
    expect(w.importRun).not.toHaveBeenCalled();
    expect(w.openJob).not.toHaveBeenCalled();
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      "research-helper-search-related-seed-gone",
    ]);
    expect(w.last()).toMatchObject({ running: false, panel: "results" });
    // The window is not left holding the run.
    await w.host.importRows(REQUEST);
    expect(w.importRun).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a bare new collection", { collectionID: "new" }],
    ["an empty name", { collectionID: "new:  " }],
    ["a collection no longer listed", { collectionID: "99" }],
    ["no rows", { keys: [] }],
    ["only rows the run does not have", { keys: ["nope"] }],
  ])("writes nothing for %s", async (_name, change) => {
    const w = await ready();
    await w.host.importRows({ ...REQUEST, ...change });
    expect(w.importRun).not.toHaveBeenCalled();
    expect(w.seedLibraryId).not.toHaveBeenCalled();
    expect(w.warn).toHaveBeenCalledTimes(1);
    expect(w.last().running).toBe(false);
  });

  it("drops a row with no record, which the pipeline could not align", async () => {
    const w = world(() =>
      rowsOutput([row(1), row(2, { records: [rec(2)] } as never)]),
    );
    w.host.connect(w.view);
    await w.host.run(7);
    await w.host.importRows({ ...REQUEST, keys: ["key-1", "key-2"] });
    expect(inputOf(w).works?.map((work) => work.workKey)).toStrictEqual([
      "key-2",
    ]);
    expect(w.warn).toHaveBeenCalledTimes(1);
  });

  it("writes the rows it knows when one key is unknown, and says so", async () => {
    const w = await ready();
    await w.host.importRows({ ...REQUEST, keys: ["key-1", "nope"] });
    expect(inputOf(w).works).toHaveLength(1);
    expect(w.warn).toHaveBeenCalledTimes(1);
  });

  it("refuses before a run has drawn rows, and after one that drew a new run", async () => {
    const w = world();
    w.host.connect(w.view);
    await w.host.importRows(REQUEST);
    expect(w.importRun).not.toHaveBeenCalled();

    const gate = deferred<RelatedOutput>();
    const second = world(() => gate.promise);
    second.host.connect(second.view);
    const running = second.host.run(7);
    await second.host.importRows(REQUEST);
    expect(second.importRun).not.toHaveBeenCalled();
    gate.resolve(rowsOutput(FOUR()));
    await running;
  });

  it("forgets the rows when a window connects", async () => {
    const w = await ready();
    w.host.connect(w.view);
    await w.host.importRows(REQUEST);
    expect(w.importRun).not.toHaveBeenCalled();
  });

  it("forgets the rows when a new run starts and fails", async () => {
    let calls = 0;
    const w = world(() => {
      calls += 1;
      return calls === 1
        ? rowsOutput(FOUR())
        : failedOutput({ code: "SOURCE" });
    });
    w.host.connect(w.view);
    await w.host.run(7);
    await w.host.retry();
    await w.host.importRows(REQUEST);
    expect(w.importRun).not.toHaveBeenCalled();
  });

  it("imports one thing at a time, from the first click on", async () => {
    const seedGate = deferred<number | undefined>();
    const gate = deferred<SearchImportOutput>();
    const w = await ready(() => gate.promise);
    w.seedLibraryId.mockReturnValueOnce(seedGate.promise);
    const going = w.host.importRows(REQUEST);
    // The first is still reading the seed's library.
    await w.host.importRows(REQUEST);
    expect(w.warn).toHaveBeenCalledTimes(1);
    seedGate.resolve(4);
    await flush();
    await w.host.importRows(REQUEST);
    await w.host.run(8);
    expect(w.importRun).toHaveBeenCalledTimes(1);
    gate.resolve(wroteOutput());
    await going;
  });

  it("can import again once one has ended", async () => {
    const w = await ready();
    await w.host.importRows(REQUEST);
    await w.host.importRows(REQUEST);
    expect(w.importRun).toHaveBeenCalledTimes(2);
  });

  it("cancels the import through the window's Cancel", async () => {
    const gate = deferred<SearchImportOutput>();
    const w = await ready(() => gate.promise);
    const going = w.host.importRows(REQUEST);
    await flush();
    w.host.cancel();
    expect(w.tokens.at(-1)?.isCancellationRequested).toBe(true);
    gate.resolve(wroteOutput({}, { outcome: "cancelled" }));
    await going;
  });

  it("draws nothing for a window that left, and closes the job", async () => {
    const gate = deferred<SearchImportOutput>();
    const w = await ready(() => gate.promise);
    const going = w.host.importRows(REQUEST);
    await flush();
    const newView = { render: vi.fn() };
    w.host.connect(newView);
    newView.render.mockClear();
    w.emit({ completed: 1, total: 2, fraction: 0.5 });
    gate.resolve(wroteOutput());
    await going;
    expect(newView.render).not.toHaveBeenCalled();
    expect(w.done).not.toHaveBeenCalled();
    expect(w.dispose).toHaveBeenCalledTimes(1);
  });

  // Corrected 2026-11-05: it used to open the job and let go of it, and a job opened on
  // the cancelled token raises the toast at once. Below is that, on the real reporter.
  it("opens no job for a window that left while the seed was read", async () => {
    const seedGate = deferred<number | undefined>();
    const w = await ready();
    const opened = w.openJob.mock.calls.length;
    w.seedLibraryId.mockReturnValueOnce(seedGate.promise);
    const going = w.host.importRows(REQUEST);
    w.host.connect({ render: vi.fn() });
    seedGate.resolve(4);
    await going;
    expect(w.importRun).not.toHaveBeenCalled();
    expect(w.openJob).toHaveBeenCalledTimes(opened);
    expect(w.dispose).not.toHaveBeenCalled();
  });

  it("an import the window leaves paints nothing", async () => {
    const importGate = deferred<SearchImportOutput>();
    const { w, painted } = reporting(() => Promise.resolve(rowsOutput(FOUR())));
    w.importRun.mockImplementationOnce(() => importGate.promise);
    w.host.connect(w.view);
    await w.host.run(7);
    painted.length = 0;
    const going = w.host.importRows(REQUEST);
    await flush();
    w.host.connect({ render: vi.fn() });
    importGate.resolve(wroteOutput({}, { outcome: "cancelled" }));
    await going;
    expect(painted).toEqual([]);
  });

  it("an import the window leaves while the seed is read opens no job", async () => {
    const seedGate = deferred<number | undefined>();
    const { w, painted } = reporting(() => Promise.resolve(rowsOutput(FOUR())));
    w.host.connect(w.view);
    await w.host.run(7);
    painted.length = 0;
    const opened = w.openJob.mock.calls.length;
    w.seedLibraryId.mockReturnValueOnce(seedGate.promise);
    const going = w.host.importRows(REQUEST);
    await flush();
    w.host.connect({ render: vi.fn() });
    seedGate.resolve(4);
    await going;
    expect(w.openJob).toHaveBeenCalledTimes(opened);
    expect(painted).toEqual([]);
  });

  it("raises no toast for a window that left while it was being worded", async () => {
    const word = deferred<{ value: string }[]>();
    const w = world(() => rowsOutput(FOUR()));
    w.host.connect({
      render: () => undefined,
      formatter: {
        formatMessages: (keys) =>
          keys[0]?.id === "research-helper-import-summary"
            ? word.promise
            : Promise.resolve([{ value: "x" }]),
      },
    });
    await w.host.run(7);
    w.done.mockClear();
    const going = w.host.importRows(REQUEST);
    await flush();
    w.host.connect({ render: vi.fn() });
    word.resolve([{ value: "too late" }]);
    await going;
    expect(w.done).not.toHaveBeenCalled();
  });

  it("opens no job for a window that left while the seed was read", async () => {
    const seedGate = deferred<number | undefined>();
    const w = await ready();
    w.seedLibraryId.mockReturnValueOnce(seedGate.promise);
    const going = w.host.importRows(REQUEST);
    const newView = { render: vi.fn() };
    w.host.connect(newView);
    newView.render.mockClear();
    seedGate.resolve(undefined);
    await going;
    expect(newView.render).not.toHaveBeenCalled();
    expect(w.importRun).not.toHaveBeenCalled();
  });

  it("closes the job and frees the window on a defect in run(), and rethrows", async () => {
    const w = await ready(() => Promise.reject(new Error("defect")));
    await expect(w.host.importRows(REQUEST)).rejects.toThrow("defect");
    expect(w.dispose).toHaveBeenCalledTimes(1);
    expect(w.last().running).toBe(false);
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      "research-helper-search-related-state-failed",
    ]);
    await w.host.run(7);
    expect(w.warn).not.toHaveBeenCalled();
  });

  it("frees the window when the seed cannot be read, and rethrows", async () => {
    const w = await ready();
    w.seedLibraryId.mockRejectedValueOnce(new Error("no read"));
    await expect(w.host.importRows(REQUEST)).rejects.toThrow("no read");
    expect(w.last().running).toBe(false);
    expect(w.importRun).not.toHaveBeenCalled();
    await w.host.importRows(REQUEST);
    expect(w.importRun).toHaveBeenCalledTimes(1);
  });

  it("raises the summary as the toast", async () => {
    const w = await ready();
    const formatted: unknown[] = [];
    w.host.connect({
      render: () => undefined,
      formatter: {
        formatMessages: (keys) => {
          formatted.push(...keys);
          return Promise.resolve([{ value: "toast words" }]);
        },
      },
    });
    await w.host.run(7);
    formatted.length = 0;
    w.done.mockClear();
    await w.host.importRows(REQUEST);
    expect(formatted).toStrictEqual([
      {
        id: "research-helper-import-summary",
        args: { imported: 2, linked: 1, skipped: 0, failed: 0 },
      },
    ]);
    expect(w.done).toHaveBeenCalledWith("succeeded", "toast words");
  });

  it("clears an import's lines when the run is asked again", async () => {
    const w = await ready();
    await w.host.importRows(REQUEST);
    expect(w.last().notices).not.toStrictEqual([]);
    const gate = deferred<RelatedOutput>();
    w.run.mockImplementationOnce(() => gate.promise);
    const again = w.host.retry();
    expect(w.last().notices).toStrictEqual([]);
    gate.resolve(rowsOutput(FOUR()));
    await again;
  });

  it("logs counts and no record", async () => {
    const w = await ready();
    await w.host.importRows(REQUEST);
    const [line, fields] = w.info.mock.calls.at(-1) as [string, object];
    expect(line).toBe("a related import ended");
    expect(fields).toStrictEqual({
      outcome: "succeeded",
      created: 2,
      linkedExisting: 1,
      linkedToSeed: 0,
    });
  });

  it("reads the box's starting state from the port, each time it is asked", () => {
    const w = world();
    expect(w.host.linkToSeedDefault()).toBe(true);
    w.linkToSeed.mockReturnValue(false);
    expect(w.host.linkToSeedDefault()).toBe(false);
  });
});
