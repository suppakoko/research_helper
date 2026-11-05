/**
 * `P5-T14`: the related pipeline's stages, endings and wiring.
 *
 * Plain Node, no network. `resolveSeed`, `expandSeedIds`, `runRelatedGenerators`,
 * `ensureEmbeddings`, `scoreRelatedCandidates` and both library matchers are the real
 * ones; the sources and the library are stand-ins. Semantic Scholar's answers here are
 * hand-written, so a pass says what this pipeline does with them and nothing about the
 * service (`plan/00` §6 item 335(a); `P5-T31`).
 */

import { describe, expect, it, vi } from "vitest";

import {
  buildPipelineSet,
  libraryItemFieldsOf,
} from "../../../src/bootstrap/registerPipelines";
import { NO_CACHE } from "../../../src/core/cache/cache";
import { createManualClock } from "../../../src/core/clock";
import {
  BadRequestError,
  ConfigurationError,
  OperationCancelledError,
  RateLimitError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type { HttpClient } from "../../../src/core/http/client";
import {
  createCancellationTokenSource,
  type CancellationToken,
} from "../../../src/core/jobQueue/cancellation";
import {
  CompositeProgressReporter,
  type ProgressSnapshot,
} from "../../../src/core/jobQueue/progress";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import { SEMANTICSCHOLAR_HOST } from "../../../src/core/rateLimit/hostLimiter";
import type { SecretStore } from "../../../src/core/secretStore";
import { MAIN_WINDOW_MESSAGE_IDS } from "../../../src/i18n/keys";
import type { CanonicalWork, WorkType } from "../../../src/model/canonicalWork";
import type { ExternalIds, SourceId } from "../../../src/model/ids";
import type { RelationEdge } from "../../../src/model/related";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  RELATED_GENERATORS,
  RELATED_REQUEST_BUDGET,
} from "../../../src/pipeline/related/generators";
import {
  createRelatedPipeline,
  RELATED_DISPLAY_NAME_KEY,
  RELATED_EXCLUDED_TYPES,
  RELATED_STAGES,
  validateRelatedInput,
  type RelatedPipelineDeps,
} from "../../../src/pipeline/related/relatedPipeline";
import { isCheckedByDefault } from "../../../src/pipeline/related/score";
import type {
  RelatedInput,
  RelatedOutput,
  RelatedPipeline,
  RelatedRow,
  RelatedRows,
} from "../../../src/pipeline/related/types";
import { UNWIRED_BUDGET_GUARD } from "../../../src/pipeline/shared/budget";
import type { EnsureEmbeddingsDeps } from "../../../src/pipeline/shared/embeddings";
import { lexicalSpace } from "../../../src/pipeline/shared/lexical";
import { createPrivacyPolicy } from "../../../src/pipeline/shared/privacyPolicy";
import { stageSlices, type PipelineContext } from "../../../src/pipeline/types";
import { createSourceRegistry } from "../../../src/sources/registry";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import {
  createSemanticScholarSource,
  SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS,
} from "../../../src/sources/semanticscholar/semanticscholarSource";
import type { LibraryItemFields } from "../../../src/sources/shared/dedupe";
import type {
  LiteratureSource,
  RelatedPage,
  RelatedQuery,
} from "../../../src/sources/types";
import type { LibraryIndex } from "../../../src/zotero/libraryIndex";
import { mockLLMRouter } from "../../helpers/mockLLM";

const NOW = Date.UTC(2023, 5, 1);
const SEED_DOI = "10.1000/seed";
const SEED_ITEM_ID = 7;
const LIBRARY_ID = 3;
const DIMENSIONS = 768;

// ---------------------------------------------------------------------------
// Records, pages and stand-in sources
// ---------------------------------------------------------------------------

const WORDS = [
  "ionizable lipid nanoparticles",
  "endosomal escape mechanisms",
  "hepatocyte gene editing",
  "ribosome profiling atlas",
  "protein folding landscapes",
  "microbiome metabolite signalling",
  "cortical interneuron development",
  "kinase inhibitor resistance",
];

function titleOf(n: number): string {
  return `${WORDS[n % WORDS.length] ?? ""} study ${String(n)} ${String(n * 7919)}`;
}

function paper(
  sourceId: SourceId,
  n: number,
  work: Partial<SourceRecord["work"]> = {},
): SourceRecord {
  return {
    id: `${sourceId}:n${String(n)}`,
    sourceId,
    nativeId: `n${String(n)}`,
    work: {
      ids: { doi: `10.1000/p${String(n)}` } as ExternalIds,
      type: "journal-article",
      title: titleOf(n),
      abstract: `Abstract of paper ${String(n)}.`,
      authors: [{ family: `Author${String(n)}` }],
      publishedDate: { year: 2022, iso: "2022" },
      ...work,
    },
    retrievedAtEpochMs: NOW,
    missingFields: [],
  };
}

function pageOf(
  records: readonly SourceRecord[],
  kind: RelationEdge["kind"] = "citation",
): RelatedPage {
  return {
    records,
    edges: records.map((_, index) => ({ kind, rank: index + 1 })),
    totalAvailable: records.length,
    nextCursor: undefined,
    warnings: [],
  };
}

type Answer =
  RelatedPage | Error | ((query: RelatedQuery) => Promise<RelatedPage>);
type Answers = Partial<Record<NonNullable<RelatedQuery["strategy"]>, Answer>>;

function standIn(
  id: SourceId,
  answers: Answers,
  answerLookup: (
    ids: readonly Partial<ExternalIds>[],
  ) => readonly SourceRecord[] = () => [],
) {
  const lookup = vi.fn((ids: readonly Partial<ExternalIds>[]) =>
    Promise.resolve(answerLookup(ids)),
  );
  const findRelated = vi.fn((query: RelatedQuery): Promise<RelatedPage> => {
    const answer = answers[query.strategy ?? "auto"] ?? pageOf([]);
    if (answer instanceof Error) return Promise.reject(answer);
    return typeof answer === "function"
      ? answer(query)
      : Promise.resolve(answer);
  });
  const source = {
    id,
    rateLimitKey: `${id}.example`,
    findRelated,
    lookup,
  } as unknown as LiteratureSource;
  return { source, findRelated, lookup };
}

/** A unit vector at `angle` radians in the first two of 768 dimensions. */
function vectorAt(angle: number): readonly number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[0] = Math.cos(angle);
  values[1] = Math.sin(angle);
  return values;
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

function indexHolding(
  byDoi: Readonly<Record<string, number>> = {},
  byWorkKey: Readonly<Record<string, number>> = {},
): LibraryIndex {
  return {
    libraryID: LIBRARY_ID,
    byDoi: new Map(Object.entries(byDoi)),
    byPmid: new Map(),
    byArxiv: new Map(),
    byWorkKey: new Map(Object.entries(byWorkKey)),
    stats: { searchCount: 1, itemsScanned: 0, trashedSkipped: 0, elapsedMs: 0 },
    findExisting(ids, workKey) {
      const byId = ids.doi === undefined ? undefined : byDoi[ids.doi];
      if (byId !== undefined) return { itemID: byId, matchedOn: "doi" };
      const byKey = workKey === undefined ? undefined : byWorkKey[workKey];
      return byKey === undefined
        ? undefined
        : { itemID: byKey, matchedOn: "workKey" };
    },
  };
}

function workOf(extra: Partial<CanonicalWork> = {}): CanonicalWork {
  return {
    workKey: `doi:${SEED_DOI}`,
    ids: { doi: SEED_DOI } as ExternalIds,
    type: "journal-article",
    title: "The seed paper itself",
    authors: [{ family: "Seedauthor" }],
    provenance: { recordIds: [], fieldOrigin: {}, seenIn: [] },
    normalizedAtEpochMs: NOW,
    ...extra,
  } as CanonicalWork;
}

// ---------------------------------------------------------------------------
// A world: sources, library, store, context
// ---------------------------------------------------------------------------

interface WorldOptions {
  readonly keyed?: boolean;
  /** `null`: the item is gone. */
  readonly item?: CanonicalWork | null;
  readonly s2?: Answers;
  readonly pubmed?: Answers;
  readonly epmc?: Answers;
  readonly crossrefGraph?: Answers;
  readonly byDoi?: Readonly<Record<string, number>>;
  readonly byWorkKey?: Readonly<Record<string, number>>;
  readonly titleItems?: readonly LibraryItemFields[];
  readonly matchTitle?: () => Promise<readonly SourceRecord[]>;
  readonly lookupKeyed?: () => Promise<readonly SourceRecord[]>;
  readonly convert?: RelatedPipelineDeps["convertPmcids"];
  /** `"none"`: no store. `"reject"`: opening it rejects. */
  readonly store?: "memory" | "none" | "reject";
  /** Angle per id sent; an id not here comes back with no vector. */
  readonly angles?: Readonly<Record<string, number>>;
  readonly fetchFails?: Error;
  readonly fetchKeyed?: boolean;
  readonly readSeedFails?: Error;
  readonly libraryIndexFails?: Error;
}

function worldOf(options: WorldOptions = {}) {
  const keyed = options.keyed ?? false;
  const events: string[] = [];
  const s2 = standIn("semanticscholar", options.s2 ?? {});
  const pubmed = standIn("pubmed", options.pubmed ?? {});
  // A DOI-only seed gets its PMID from Europe PMC's `lookup`, or that source has no
  // route to it (`P5-T12`). Papers numbered `p<n>` are not seeds.
  const epmc = standIn("europepmc", options.epmc ?? {}, (ids) =>
    ids.flatMap(({ doi }) =>
      doi === undefined || /\/p\d/u.test(doi)
        ? []
        : [
            paper("europepmc", 99_999, {
              ids: { doi, pmid: "888888" } as ExternalIds,
            }),
          ],
    ),
  );
  const crossrefGraph = standIn("crossref", options.crossrefGraph ?? {});
  const registry = createSourceRegistry();
  for (const { source } of [s2, pubmed, epmc, crossrefGraph]) {
    registry.register(source);
  }

  const evictions: ((workKey: string) => boolean)[] = [];
  const store: EnsureEmbeddingsDeps["store"] = {
    getMany: () => Promise.resolve(new Map()),
    putMany: () => Promise.resolve(),
    evictToCap(isInLibrary) {
      evictions.push(isInLibrary);
      return Promise.resolve({ evicted: 0, bytes: 0 } as never);
    },
  };
  const embeddings = vi.fn(() => {
    if (options.store === "none") return Promise.resolve(undefined);
    if (options.store === "reject") {
      return Promise.reject(new Error("no database"));
    }
    return Promise.resolve(store);
  });

  const fetchEmbeddings = vi.fn((ids: readonly string[]) => {
    events.push("fetch");
    if (options.fetchFails !== undefined) {
      return Promise.reject(options.fetchFails);
    }
    const angles = options.angles ?? {};
    const held = ids.flatMap((id) => {
      const angle = angles[id];
      return angle === undefined ? [] : [[id, vectorAt(angle)] as const];
    });
    return Promise.resolve({
      keyed: options.fetchKeyed ?? true,
      vectors: new Map(held),
      withoutVector: ids.filter((id) => angles[id] === undefined),
    });
  });
  const hasUsableApiKey = vi.fn(() => Promise.resolve(keyed));
  const lookupKeyed = vi.fn(
    options.lookupKeyed ??
      (() => Promise.resolve([] as readonly SourceRecord[])),
  );
  const s2MatchTitle = vi.fn(
    options.matchTitle ??
      (() => Promise.resolve([] as readonly SourceRecord[])),
  );
  const crossrefMatchTitle = vi.fn(
    options.matchTitle ??
      (() => Promise.resolve([] as readonly SourceRecord[])),
  );
  const convertPmcids = vi.fn<RelatedPipelineDeps["convertPmcids"]>(
    options.convert ?? (() => Promise.resolve(new Map())),
  );

  const item = options.item === undefined ? workOf() : options.item;
  const readSeed = vi.fn(() =>
    options.readSeedFails !== undefined
      ? Promise.reject(options.readSeedFails)
      : Promise.resolve(
          item === null ? undefined : { work: item, libraryID: LIBRARY_ID },
        ),
  );
  const libraryIndex = vi.fn(() =>
    options.libraryIndexFails !== undefined
      ? Promise.reject(options.libraryIndexFails)
      : Promise.resolve(indexHolding(options.byDoi, options.byWorkKey)),
  );
  const libraryItems = vi.fn(() =>
    Promise.resolve(options.titleItems ?? ([] as readonly LibraryItemFields[])),
  );

  const deps: RelatedPipelineDeps = {
    library: { readSeed, libraryIndex, libraryItems },
    semanticscholar: {
      hasUsableApiKey,
      lookupKeyed,
      matchTitle: s2MatchTitle,
      fetchEmbeddings,
    },
    crossref: { matchTitle: crossrefMatchTitle },
    convertPmcids,
    embeddings,
  };

  const clock = createManualClock(NOW);
  const snapshots: ProgressSnapshot[] = [];
  const reporter = new CompositeProgressReporter({
    clock,
    sinks: [{ update: (snapshot) => void snapshots.push(snapshot) }],
    throttleMs: 0,
  });
  const stages: string[] = [];
  const contextWith = (
    token: CancellationToken,
    onStage?: (stage: string) => void,
  ): PipelineContext => ({
    jobId: "test-job",
    token,
    progress: reporter,
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    clock,
    sources: registry,
    cache: NO_CACHE,
    budget: UNWIRED_BUDGET_GUARD,
    llm: mockLLMRouter(),
    tts: undefined,
    zotero: undefined,
    config: {
      get: ((name: string) =>
        name === "searchYears"
          ? 5
          : false) as unknown as PipelineContext["config"]["get"],
    },
    privacy: createPrivacyPolicy("strict"),
    checkpoint(state) {
      const { stage } = state as { readonly stage: string };
      stages.push(stage);
      events.push(`stage:${stage}`);
      onStage?.(stage);
      return Promise.resolve();
    },
    resumeState: undefined,
  });
  const pipeline: RelatedPipeline = createRelatedPipeline(deps);
  const run = (
    input: Partial<RelatedInput> = {},
    token: CancellationToken = createCancellationTokenSource().token,
    onStage?: (stage: string) => void,
  ): Promise<RelatedOutput> =>
    pipeline.run(
      { seedItemID: SEED_ITEM_ID, ...input },
      contextWith(token, onStage),
    );

  return {
    deps,
    events,
    stages,
    snapshots,
    evictions,
    pipeline,
    run,
    contextWith,
    s2,
    pubmed,
    epmc,
    crossrefGraph,
    embeddings,
    fetchEmbeddings,
    hasUsableApiKey,
    lookupKeyed,
    s2MatchTitle,
    crossrefMatchTitle,
    convertPmcids,
    readSeed,
    libraryIndex,
    libraryItems,
  };
}

function expectRows(output: RelatedOutput): RelatedRows {
  if (output.outcome !== "succeeded" || output.ending !== "rows") {
    throw new Error(`expected rows, got ${JSON.stringify(output)}`);
  }
  return output;
}

function expectFailed(output: RelatedOutput) {
  if (output.outcome !== "failed") {
    throw new Error(`expected failed, got ${output.outcome}`);
  }
  return output;
}

function rowWithDoi(rows: readonly RelatedRow[], doi: string): RelatedRow {
  const row = rows.find(({ work }) => work.ids.doi === doi);
  if (row === undefined) throw new Error(`no row for ${doi}`);
  return row;
}

function papers(count: number, from = 100): readonly SourceRecord[] {
  return Array.from({ length: count }, (_, i) => paper("europepmc", from + i));
}

const ONE_LIST: Answers = { citations: pageOf(papers(3)) };

// ---------------------------------------------------------------------------
// Done when
// ---------------------------------------------------------------------------

describe("Done when", () => {
  it("a DOI seed on mocked sources yields at least 20 scored rows, each with a chip", async () => {
    const world = worldOf({
      item: workOf({ ids: { doi: SEED_DOI, pmid: "1000001" } as ExternalIds }),
      epmc: {
        citations: pageOf(papers(15)),
        references: pageOf(papers(15, 200), "reference"),
      },
    });
    const { rows } = expectRows(await world.run());
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const row of rows) {
      expect(row.chips.length).toBeGreaterThanOrEqual(1);
      expect(row.score).toBeGreaterThan(0);
      expect(row.inLibrary).toBe(false);
      expect(row.outsideWindow).toBe(false);
    }
  });

  it("an owned candidate is in the library and unticked, and the seed never appears", async () => {
    const seedRow = paper("europepmc", 1, {
      ids: { doi: SEED_DOI } as ExternalIds,
      title: "The seed paper itself",
    });
    const owned = paper("europepmc", 2);
    const free = paper("europepmc", 3);
    const world = worldOf({
      epmc: { citations: pageOf([seedRow, owned, free]) },
      byDoi: { "10.1000/p2": 55 },
    });
    const { rows } = expectRows(await world.run());

    expect(rows.map(({ work }) => work.ids.doi).sort()).toEqual([
      "10.1000/p2",
      "10.1000/p3",
    ]);
    const ownedRow = rowWithDoi(rows, "10.1000/p2");
    expect(ownedRow.inLibrary).toBe(true);
    expect(ownedRow.existingItemID).toBe(55);
    expect(isCheckedByDefault(ownedRow)).toBe(false);
    const freeRow = rowWithDoi(rows, "10.1000/p3");
    expect(freeRow.inLibrary).toBe(false);
    expect(freeRow).not.toHaveProperty("existingItemID");
    expect(isCheckedByDefault(freeRow)).toBe(true);
  });

  it("cancelling mid-generation ends Cancelled, with nothing read to mark or written", async () => {
    const tokens = createCancellationTokenSource();
    const world = worldOf({
      epmc: {
        citations: () => {
          tokens.cancel({ kind: "user" });
          return Promise.reject(new OperationCancelledError({ kind: "user" }));
        },
      },
    });
    const output = await world.run({}, tokens.token);
    expect(output).toEqual({
      outcome: "cancelled",
      stageReached: "Generating",
      seedFailures: [],
    });
    expect(world.stages.at(-1)).toBe("Generating");
    expect(world.libraryIndex).not.toHaveBeenCalled();
    expect(world.libraryItems).not.toHaveBeenCalled();
    // The Zotero port has no write member, so a write has nowhere to go.
    expect(Object.keys(world.deps.library).sort()).toEqual([
      "libraryIndex",
      "libraryItems",
      "readSeed",
    ]);
  });

  it("a run given chosenSeed makes no seed-resolution call and starts at ExpandingIds", async () => {
    const pick = workOf({
      workKey: "doi:10.1000/picked",
      ids: { doi: "10.1000/picked" } as ExternalIds,
      title: "The picked paper",
    });
    const world = worldOf({
      keyed: true,
      // A title-only item, which would otherwise go to both title services.
      item: workOf({ workKey: "hash:x", ids: {}, title: "A title to match" }),
      epmc: ONE_LIST,
      store: "none",
    });
    const output = expectRows(await world.run({ chosenSeed: pick }));
    expect(world.s2MatchTitle).not.toHaveBeenCalled();
    expect(world.crossrefMatchTitle).not.toHaveBeenCalled();
    expect(world.stages[0]).toBe("ExpandingIds");
    expect(world.stages).not.toContain("ResolvingSeed");
    expect(output.seed.matchedByTitle).toBe(true);
    expect(output.seed.work.ids.doi).toBe("10.1000/picked");
    // It still reaches `expandSeedIds`, with the pick's identifiers.
    expect(world.lookupKeyed.mock.calls).toHaveLength(1);
    expect(JSON.stringify(world.lookupKeyed.mock.calls[0])).toContain(
      "10.1000/picked",
    );
    expect(world.readSeed).toHaveBeenCalledWith(SEED_ITEM_ID);
  });

  it("a keyed run fetches candidate vectors in ⌈n / 200⌉ batches before scoring", async () => {
    const candidates = papers(250, 1000);
    const world = worldOf({
      keyed: true,
      s2: { recommendations: pageOf(candidates, "recommendation") },
    });
    expectRows(await world.run());

    // The seed plus 250 candidates, each with its own identifier.
    const n = 251;
    const expected = Math.ceil(n / SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS);
    expect(expected).toBe(2);
    expect(world.fetchEmbeddings).toHaveBeenCalledTimes(expected);
    const sent = world.fetchEmbeddings.mock.calls.map(([ids]) => ids);
    expect(sent.flat()).toHaveLength(n);
    expect(new Set(sent.flat()).size).toBe(n);
    expect(sent.flat()).toContain(`DOI:${SEED_DOI}`);
    for (const ids of sent) {
      expect(ids.length).toBeLessThanOrEqual(
        SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS,
      );
    }
    const order = world.events.filter(
      (event) => event === "fetch" || event.startsWith("stage:"),
    );
    expect(order.slice(order.indexOf("stage:FetchingVectors"))).toEqual([
      "stage:FetchingVectors",
      "fetch",
      "fetch",
      "stage:Scoring",
      "stage:Filtering",
      "stage:MarkingRows",
    ]);
    expect(order).toContain("stage:Generating");
  });

  it("a keyless run makes no vector call and opens no store", async () => {
    const world = worldOf({ epmc: ONE_LIST });
    const output = expectRows(await world.run());
    expect(world.fetchEmbeddings).not.toHaveBeenCalled();
    expect(world.embeddings).not.toHaveBeenCalled();
    expect(world.stages).not.toContain("FetchingVectors");
    expect(output.keyNotice).toBe(true);
    expect(output.similarity).toEqual({ space: "lexical" });
  });
});

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

describe("the pipeline's declaration", () => {
  it("is docs/07 §12.2's: id, display name, stages, not resumable", () => {
    const { pipeline } = worldOf();
    expect(pipeline.id).toBe("related");
    expect(pipeline.displayNameKey).toBe(RELATED_DISPLAY_NAME_KEY);
    expect(pipeline.resumable).toBe(false);
    expect(pipeline.stages).toBe(RELATED_STAGES);
    expect(RELATED_STAGES.map(({ key }) => key)).toEqual([
      "ResolvingSeed",
      "ExpandingIds",
      "Generating",
      "FetchingVectors",
      "Scoring",
      "Filtering",
      "MarkingRows",
    ]);
    expect(RELATED_STAGES.map(({ weight }) => weight)).toEqual([
      0.05, 0.05, 0.6, 0.15, 0.05, 0.05, 0.05,
    ]);
    expect(stageSlices(RELATED_STAGES).at(-1)?.to).toBe(1);
    expect(Object.isFrozen(RELATED_STAGES)).toBe(true);
    expect(Object.isFrozen(RELATED_STAGES[0])).toBe(true);
    for (const { labelKey } of RELATED_STAGES) {
      expect(labelKey).toBe("research-helper-menu-item-find-related");
    }
    expect(RELATED_EXCLUDED_TYPES).toEqual(["dataset"]);
  });

  it.each([0, -1, 1.5, Number.NaN])("validate refuses %s", (seedItemID) => {
    expect(validateRelatedInput({ seedItemID })).toEqual({
      ok: false,
      errors: [{ field: "seedItemID", messageKey: "rh-error-seed-gone" }],
    });
  });

  it("validate accepts a whole id, and the pipeline uses that function", () => {
    expect(validateRelatedInput({ seedItemID: 1 })).toEqual({
      ok: true,
      errors: [],
    });
    expect(worldOf().pipeline.validate).toBe(validateRelatedInput);
  });

  it("estimates the seed's requests, the budget and, with a key, the vector batches", async () => {
    const works =
      1 + RELATED_GENERATORS.reduce((sum, { limit }) => sum + limit, 0);
    const vectorBatches = Math.ceil(
      works / SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS,
    );
    const estimateOf = async (keyed: boolean, input: RelatedInput) => {
      const world = worldOf({ keyed });
      return world.pipeline.estimate(input, world.contextWith(never()));
    };
    const plain = await estimateOf(false, { seedItemID: 1 });
    expect(plain).toEqual({
      itemCount: 1,
      externalRequests: 2 + 2 + RELATED_REQUEST_BUDGET,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      estimatedCostUsd: undefined,
      estimatedDurationSeconds: 0,
      notesKeys: [],
    });
    expect((await estimateOf(true, { seedItemID: 1 })).externalRequests).toBe(
      2 + 2 + RELATED_REQUEST_BUDGET + vectorBatches,
    );
    expect(
      (await estimateOf(false, { seedItemID: 1, chosenSeed: workOf() }))
        .externalRequests,
    ).toBe(2 + RELATED_REQUEST_BUDGET);
  });

  it("walks every stage in order and leaves the bar at its end", async () => {
    const world = worldOf({ keyed: true, epmc: ONE_LIST });
    expectRows(await world.run());
    expect(world.stages).toEqual(RELATED_STAGES.map(({ key }) => key));
    expect(world.snapshots.at(-1)?.fraction).toBeCloseTo(1, 9);
  });

  it("a keyless run skips only FetchingVectors", async () => {
    const world = worldOf({ epmc: ONE_LIST });
    expectRows(await world.run());
    expect(world.stages).toEqual(
      RELATED_STAGES.map(({ key }) => key).filter(
        (key) => key !== "FetchingVectors",
      ),
    );
    expect(world.snapshots.at(-1)?.fraction).toBeCloseTo(1, 9);
  });

  it("hands the generators the stage's own reporter, with the slice mapped", async () => {
    const world = worldOf({
      // A work with no abstract, so the fill-in reports a step.
      epmc: {
        citations: pageOf([
          paper("europepmc", 300, { abstract: undefined } as never),
        ]),
      },
    });
    expectRows(await world.run());
    expect(
      world.snapshots.some(
        (s) =>
          s.currentStageKey === "Generating" &&
          s.status === "running" &&
          (s.total ?? 0) > 0,
      ),
    ).toBe(true);
  });
});

function never(): CancellationToken {
  return createCancellationTokenSource().token;
}

// ---------------------------------------------------------------------------
// Cancellation at every boundary
// ---------------------------------------------------------------------------

describe("cancellation", () => {
  it.each([
    "ResolvingSeed",
    "ExpandingIds",
    "Generating",
    "FetchingVectors",
    "Scoring",
    "Filtering",
  ] as const)(
    "a cancel during %s stops the run at the next boundary",
    async (stage) => {
      const tokens = createCancellationTokenSource();
      const world = worldOf({ keyed: true, epmc: ONE_LIST });
      const output = await world.run({}, tokens.token, (entered) => {
        if (entered === stage) tokens.cancel({ kind: "user" });
      });
      expect(output.outcome).toBe("cancelled");
      expect(output.stageReached).toBe(stage);
      expect(world.stages.at(-1)).toBe(stage);
      expect(world.libraryItems).not.toHaveBeenCalled();
    },
  );

  it("a token cancelled before the run reads nothing", async () => {
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    const world = worldOf();
    const output = await world.run({}, tokens.token);
    expect(output).toEqual({
      outcome: "cancelled",
      stageReached: "ResolvingSeed",
      seedFailures: [],
    });
    expect(world.readSeed).not.toHaveBeenCalled();
    expect(world.stages).toEqual([]);
  });

  it("a cancel in a vector batch is Cancelled, not a similarity notice", async () => {
    const world = worldOf({
      keyed: true,
      epmc: ONE_LIST,
      fetchFails: new OperationCancelledError({ kind: "user" }),
    });
    const output = await world.run();
    expect(output.outcome).toBe("cancelled");
    expect(output.stageReached).toBe("FetchingVectors");
  });
});

// ---------------------------------------------------------------------------
// Seed endings
// ---------------------------------------------------------------------------

describe("the seed", () => {
  const titleOnly = workOf({
    workKey: "hash:x",
    ids: {},
    title: "A title long enough to compare against the candidates here",
  });
  const twoCandidates = (): readonly SourceRecord[] => [
    paper("crossref", 901, {
      ids: { doi: "10.1000/first" } as ExternalIds,
      title: "A title long enough to compare against the candidates here",
    }),
    paper("crossref", 902, {
      ids: { doi: "10.1000/second" } as ExternalIds,
      title: "A title long enough to compare against the candidates here",
      type: "preprint",
    }),
  ];

  it("an item that no longer exists fails with its own message, and asks nothing", async () => {
    const world = worldOf({ item: null, epmc: ONE_LIST });
    const { error, stageReached, statuses } = expectFailed(await world.run());
    expect(error).toMatchObject({
      code: "SEED_UNRESOLVED",
      messageKey: "rh-error-seed-gone",
      retryable: false,
    });
    expect(stageReached).toBe("ResolvingSeed");
    expect(statuses).toEqual([]);
    expect(world.epmc.findRelated).not.toHaveBeenCalled();
    expect(MAIN_WINDOW_MESSAGE_IDS).toContain("rh-error-seed-gone");
  });

  it("an item nothing can be looked up from fails with resolveSeed's error", async () => {
    const world = worldOf({
      item: workOf({ workKey: "h", ids: {}, title: "" }),
    });
    expect(expectFailed(await world.run()).error.messageKey).toBe(
      "rh-error-seed-no-identifier",
    );
  });

  it("a service's own error from the title step fails the run with that error", async () => {
    const world = worldOf({
      item: titleOnly,
      matchTitle: () => Promise.reject(new UpstreamServerError(503, "x")),
    });
    const { error, stageReached } = expectFailed(await world.run());
    expect(error.code).toBe("UPSTREAM_SERVER");
    expect(stageReached).toBe("ResolvingSeed");
  });

  it("an error of no known kind is UNTYPED, with no message of its own", async () => {
    const world = worldOf({ readSeedFails: new TypeError("secret detail") });
    const { error } = expectFailed(await world.run());
    expect(error).toEqual({
      code: "UNTYPED",
      messageKey: "rh-error-source",
      detail: "TypeError",
      retryable: false,
    });
  });

  it("two passing titles end as choose, and no generator runs", async () => {
    const world = worldOf({
      item: titleOnly,
      matchTitle: () => Promise.resolve(twoCandidates()),
      epmc: ONE_LIST,
    });
    const output = await world.run();
    expect(output).toMatchObject({
      outcome: "succeeded",
      ending: "choose",
      stageReached: "ResolvingSeed",
      seedFailures: [],
    });
    if (output.outcome !== "succeeded" || output.ending !== "choose") {
      throw new Error("expected choose");
    }
    expect(output.candidates.map(({ ids }) => ids.doi).sort()).toEqual([
      "10.1000/first",
      "10.1000/second",
    ]);
    expect(world.epmc.findRelated).not.toHaveBeenCalled();
    expect(world.stages).toEqual(["ResolvingSeed"]);
    expect(world.snapshots.at(-1)?.fraction).toBeCloseTo(0.05, 9);
  });

  it("one passing title carries on, marked matched by title", async () => {
    const [first] = twoCandidates();
    const world = worldOf({
      item: titleOnly,
      matchTitle: () => Promise.resolve(first === undefined ? [] : [first]),
      epmc: ONE_LIST,
    });
    const output = expectRows(await world.run());
    expect(output.seed.matchedByTitle).toBe(true);
    expect(output.seed.work.ids.doi).toBe("10.1000/first");
    expect(world.stages.slice(0, 2)).toEqual(["ResolvingSeed", "ExpandingIds"]);
  });

  it("a seed with an identifier is not marked as matched by title", async () => {
    const output = expectRows(await worldOf({ epmc: ONE_LIST }).run());
    expect(output.seed.matchedByTitle).toBe(false);
    expect(output.seedFailures).toEqual([]);
  });

  it("expansion's failures are kept on the ending, and the generators get what it found", async () => {
    const world = worldOf({
      keyed: true,
      store: "none",
      item: workOf({ ids: { doi: SEED_DOI } as ExternalIds }),
      lookupKeyed: () =>
        Promise.resolve([
          paper("semanticscholar", 1, {
            ids: { doi: SEED_DOI, pmid: "424242" } as ExternalIds,
          }),
        ]),
      pubmed: { similar: pageOf([paper("pubmed", 400)], "similar") },
    });
    const output = expectRows(await world.run());
    expect(output.seed.work.ids.pmid).toBe("424242");
    expect(world.pubmed.findRelated).toHaveBeenCalled();
    expect(world.pubmed.findRelated.mock.calls[0]?.[0]?.ids).toEqual({
      pmid: "424242",
    });

    const failing = worldOf({
      keyed: true,
      store: "none",
      epmc: ONE_LIST,
      lookupKeyed: () => Promise.reject(new UpstreamServerError(500, "x")),
    });
    const { seedFailures } = expectRows(await failing.run());
    expect(seedFailures).toHaveLength(1);
    expect(seedFailures[0]).toMatchObject({
      source: "semanticscholar",
      step: "expand",
    });
  });

  it("a title step's failure stays on the ending when another service matched", async () => {
    const [first] = twoCandidates();
    const world = worldOf({
      keyed: true,
      store: "none",
      item: titleOnly,
      epmc: ONE_LIST,
    });
    world.s2MatchTitle.mockImplementation(() =>
      Promise.reject(new UpstreamServerError(500, "x")),
    );
    world.crossrefMatchTitle.mockImplementation(() =>
      Promise.resolve(first === undefined ? [] : [first]),
    );
    const { seedFailures } = expectRows(await world.run());
    expect(seedFailures).toEqual([
      expect.objectContaining({ source: "semanticscholar", step: "title" }),
    ]);
  });

  it("a failure in expansion stays on a later failed ending", async () => {
    const down = new UpstreamServerError(500, "x");
    const world = worldOf({
      keyed: true,
      s2: { recommendations: down, citations: down, references: down },
      pubmed: { similar: down },
      epmc: { citations: down, references: down },
      crossrefGraph: { references: down },
      lookupKeyed: () => Promise.reject(down),
    });
    const { seedFailures } = expectFailed(await world.run());
    expect(seedFailures).toHaveLength(1);
  });

  it("reads the seed through the library, by the id it was given", async () => {
    const world = worldOf({ epmc: ONE_LIST, byDoi: {} });
    expectRows(await world.run());
    expect(world.readSeed).toHaveBeenCalledWith(SEED_ITEM_ID);
    expect(world.libraryIndex).toHaveBeenCalledTimes(1);
    expect(world.libraryIndex).toHaveBeenCalledWith(LIBRARY_ID);
    expect(world.libraryItems).toHaveBeenCalledTimes(1);
    expect(world.libraryItems).toHaveBeenCalledWith(LIBRARY_ID);
  });
});

// ---------------------------------------------------------------------------
// Partial results and Failed
// ---------------------------------------------------------------------------

describe("Generating --> Failed", () => {
  const down = (): Error => new UpstreamServerError(500, "x");

  it("fails when every generator that ran failed", async () => {
    const world = worldOf({
      item: workOf({ ids: { doi: SEED_DOI, pmid: "1" } as ExternalIds }),
      pubmed: { similar: down() },
      epmc: {
        citations: down(),
        references: new RateLimitError(429, undefined, "x"),
      },
      crossrefGraph: { references: down() },
    });
    const { error, statuses, stageReached } = expectFailed(await world.run());
    expect(error).toEqual({
      code: "SOURCE",
      messageKey: "rh-error-source",
      detail: expect.stringContaining("europepmc-citations") as string,
      retryable: true,
    });
    expect(statuses.length).toBe(RELATED_GENERATORS.length);
    expect(stageReached).toBe("Generating");
    expect(world.stages.at(-1)).toBe("Generating");
    expect(world.libraryIndex).not.toHaveBeenCalled();
  });

  it("does not fail when one generator answered, and keeps its rows and the others' status", async () => {
    const world = worldOf({
      item: workOf({ ids: { doi: SEED_DOI, pmid: "1" } as ExternalIds }),
      pubmed: { similar: down() },
      epmc: { citations: pageOf(papers(2)), references: down() },
      crossrefGraph: { references: down() },
    });
    const { rows, statuses } = expectRows(await world.run());
    expect(rows).toHaveLength(2);
    expect(statuses.find(({ generator }) => generator === "pmra")?.state).toBe(
      "failed",
    );
  });

  it("does not fail when nothing ran at all: no identifier any generator can use", async () => {
    const world = worldOf({
      item: workOf({
        workKey: "arxiv:2101.00001",
        ids: { arxivId: "2101.00001" } as ExternalIds,
      }),
    });
    const { rows, statuses } = expectRows(await world.run());
    expect(rows).toEqual([]);
    expect(statuses.map(({ state }) => state)).not.toContain("failed");
  });

  it("no-key rows beside an empty answer are zero rows, not a failure", async () => {
    const { rows, statuses } = expectRows(await worldOf({}).run());
    expect(rows).toEqual([]);
    expect(
      statuses
        .filter(({ state }) => state === "no-key")
        .map((s) => s.generator),
    ).toEqual(["s2-recommendations", "s2-citations", "s2-references"]);
  });

  it("not-indexed is an answer, so it is not a failure", async () => {
    const world = worldOf({
      item: workOf({ ids: { doi: SEED_DOI, pmid: "1" } as ExternalIds }),
      pubmed: { similar: down() },
      epmc: {
        citations: new BadRequestError(404, "not held"),
        references: down(),
      },
      crossrefGraph: { references: down() },
    });
    const { statuses } = expectRows(await world.run());
    expect(
      statuses.find(({ generator }) => generator === "europepmc-citations")
        ?.state,
    ).toBe("not-indexed");
  });
});

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

describe("similarity: one space per run", () => {
  const SEED_ID = `DOI:${SEED_DOI}`;
  const similarChip = (row: RelatedRow) =>
    row.chips.find((chip) => chip.id === "similar");

  it("keyed: SPECTER2's cosine, rescaled to [0, 1], by work key", async () => {
    const world = worldOf({
      keyed: true,
      s2: {
        recommendations: pageOf(
          [paper("semanticscholar", 1), paper("semanticscholar", 2)],
          "recommendation",
        ),
      },
      angles: {
        [SEED_ID]: 0,
        "DOI:10.1000/p1": 0,
        "DOI:10.1000/p2": Math.PI / 2,
      },
    });
    const { rows, similarity, keyNotice } = expectRows(await world.run());
    expect(similarity).toEqual({ space: "specter_v2" });
    expect(keyNotice).toBe(false);
    expect(similarChip(rowWithDoi(rows, "10.1000/p1"))).toEqual({
      id: "similar",
      similarity: 1,
    });
    expect(similarChip(rowWithDoi(rows, "10.1000/p2"))?.similarity).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("keyed: a candidate with no vector scores 0, with no lexical fallback", async () => {
    const world = worldOf({
      keyed: true,
      s2: {
        recommendations: pageOf(
          [paper("semanticscholar", 1), paper("semanticscholar", 2)],
          "recommendation",
        ),
      },
      item: workOf({ title: titleOf(2), abstract: "Abstract of paper 2." }),
      angles: { [SEED_ID]: 0, "DOI:10.1000/p1": 0 },
    });
    const { rows } = expectRows(await world.run());
    expect(similarChip(rowWithDoi(rows, "10.1000/p2"))).toBeUndefined();
    expect(similarChip(rowWithDoi(rows, "10.1000/p1"))).toBeDefined();
  });

  it("keyed: a seed with no vector leaves every candidate at 0", async () => {
    const world = worldOf({
      keyed: true,
      s2: {
        recommendations: pageOf(
          [paper("semanticscholar", 1)],
          "recommendation",
        ),
      },
      angles: { "DOI:10.1000/p1": 0 },
    });
    const { rows, similarity } = expectRows(await world.run());
    expect(similarity).toEqual({ space: "specter_v2" });
    expect(similarChip(rowWithDoi(rows, "10.1000/p1"))).toBeUndefined();
  });

  it.each(["none", "reject"] as const)(
    "keyed with store %s: the lexical space, with a notice and no vector call",
    async (store) => {
      const world = worldOf({
        keyed: true,
        store,
        item: workOf({ title: titleOf(1), abstract: "Abstract of paper 1." }),
        epmc: { citations: pageOf([paper("europepmc", 1)]) },
      });
      const { rows, similarity, keyNotice } = expectRows(await world.run());
      expect(similarity).toEqual({ space: "lexical", notice: "no-store" });
      expect(keyNotice).toBe(false);
      expect(world.fetchEmbeddings).not.toHaveBeenCalled();
      expect(world.stages).toContain("FetchingVectors");
      expect(similarChip(rowWithDoi(rows, "10.1000/p1"))).toBeDefined();
    },
  );

  it("a failed batch keeps SPECTER2 and scores 0, with the failure on the notice", async () => {
    const world = worldOf({
      keyed: true,
      item: workOf({ title: titleOf(1), abstract: "Abstract of paper 1." }),
      epmc: { citations: pageOf([paper("europepmc", 1)]) },
      fetchFails: new UpstreamServerError(500, "x"),
    });
    const { rows, similarity } = expectRows(await world.run());
    expect(similarity).toMatchObject({
      space: "specter_v2",
      notice: "fetch-failed",
      error: { code: "UPSTREAM_SERVER" },
    });
    expect(rows).toHaveLength(1);
    expect(similarChip(rowWithDoi(rows, "10.1000/p1"))).toBeUndefined();
  });

  it("the adapter answering keyed false mid-run raises the key notice", async () => {
    const world = worldOf({
      keyed: true,
      epmc: ONE_LIST,
      fetchKeyed: false,
    });
    expect(expectRows(await world.run()).keyNotice).toBe(true);
  });

  it("keyless: the lexical cosine, as it is, between the seed and each candidate", async () => {
    const world = worldOf({
      item: workOf({ title: titleOf(1), abstract: "Abstract of paper 1." }),
      epmc: {
        citations: pageOf([paper("europepmc", 1), paper("europepmc", 2)]),
      },
    });
    const { rows } = expectRows(await world.run());
    const near = similarChip(rowWithDoi(rows, "10.1000/p1"))?.similarity ?? 0;
    const far = similarChip(rowWithDoi(rows, "10.1000/p2"))?.similarity ?? 0;
    expect(near).toBeGreaterThan(far);
    expect(near).toBeCloseTo(1, 6);
  });

  it("keyless: the item's own text is the seed's, even when a title match lacks it", async () => {
    const candidate = paper("europepmc", 1);
    const item = workOf({
      workKey: "hash:y",
      ids: {},
      title: "Seed title that is long enough to compare with the match",
      abstract: candidate.work.abstract ?? "",
    });
    const match = paper("crossref", 910, {
      ids: { doi: "10.1000/matched" } as ExternalIds,
      title: "Seed title that is long enough to compare with the match",
      abstract: "Unrelated matched words about nothing shared here",
    });
    const world = worldOf({
      item,
      matchTitle: () => Promise.resolve([match]),
      epmc: { citations: pageOf([candidate]) },
    });
    const { rows } = expectRows(await world.run());
    expect(
      similarChip(rowWithDoi(rows, "10.1000/p1"))?.similarity ?? 0,
    ).toBeGreaterThan(0);
  });

  it("keyless: a seed item with no text of its own falls back to the resolved work's", async () => {
    const pick = workOf({
      workKey: "doi:10.1000/picked",
      ids: { doi: "10.1000/picked" } as ExternalIds,
      title: titleOf(1),
      abstract: "Abstract of paper 1.",
      subjects: [{ term: "Lipids", scheme: "mesh" }],
    });
    const world = worldOf({
      item: workOf({ workKey: "hash:z", ids: {}, title: "  " }),
      epmc: { citations: pageOf([paper("europepmc", 1)]) },
    });
    const { rows } = expectRows(await world.run({ chosenSeed: pick }));
    expect(
      similarChip(rowWithDoi(rows, "10.1000/p1"))?.similarity ?? 0,
    ).toBeGreaterThan(0.5);
  });

  it("keyless: subjects count, the item's first and the resolved work's otherwise", async () => {
    const mesh = [{ term: "Quasicrystal Lattices", scheme: "mesh" }];
    const candidate = paper("europepmc", 1, {
      title: "Entirely distinct phrasing alpha beta gamma",
      abstract: "Delta epsilon zeta",
      subjects: mesh,
    });
    const other = paper("europepmc", 2, {
      title: "Separate language theta iota kappa",
      abstract: "Lambda mu nu",
    });
    const seedShape = {
      title: "Seed wording omicron pi rho",
      abstract: "Sigma tau upsilon",
    };
    const fromItem = worldOf({
      item: workOf({ ...seedShape, subjects: mesh }),
      epmc: { citations: pageOf([candidate, other]) },
    });
    expect(
      similarChip(
        rowWithDoi(expectRows(await fromItem.run()).rows, "10.1000/p1"),
      )?.similarity ?? 0,
    ).toBeGreaterThan(0);

    const fromPick = worldOf({
      item: workOf({ ...seedShape }),
      epmc: { citations: pageOf([candidate, other]) },
    });
    const { rows } = expectRows(
      await fromPick.run({ chosenSeed: workOf({ subjects: mesh }) }),
    );
    expect(
      similarChip(rowWithDoi(rows, "10.1000/p1"))?.similarity ?? 0,
    ).toBeGreaterThan(0);
  });

  it("protects what the library holds from vector eviction, by work key or identifier", async () => {
    const owned = paper("semanticscholar", 1);
    const free = paper("semanticscholar", 2);
    const world = worldOf({
      keyed: true,
      s2: { recommendations: pageOf([owned, free], "recommendation") },
      byDoi: { "10.1000/p1": 44 },
      byWorkKey: { "doi:10.1000/stored": 45 },
      angles: {
        [SEED_ID]: 0,
        "DOI:10.1000/p1": 0,
        "DOI:10.1000/p2": 0,
      },
    });
    expectRows(await world.run());
    const [isInLibrary] = world.evictions;
    if (isInLibrary === undefined) throw new Error("no eviction was asked");
    expect(isInLibrary(`doi:${SEED_DOI}`)).toBe(true);
    expect(isInLibrary("doi:10.1000/p1")).toBe(true);
    expect(isInLibrary("doi:10.1000/stored")).toBe(true);
    expect(isInLibrary("doi:10.1000/p2")).toBe(false);
  });

  it("a library read that fails while protecting vectors fails the run", async () => {
    const world = worldOf({
      keyed: true,
      epmc: ONE_LIST,
      libraryIndexFails: new ConfigurationError("x"),
    });
    const { error, stageReached } = expectFailed(await world.run());
    expect(error.code).toBe(new ConfigurationError("x").code);
    expect(stageReached).toBe("FetchingVectors");
    expect(world.fetchEmbeddings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Filtering and marking
// ---------------------------------------------------------------------------

describe("filtering", () => {
  it("drops a row carrying the seed's identifier under another work key", async () => {
    const item = workOf({
      ids: { doi: SEED_DOI, pmid: "777" } as ExternalIds,
    });
    const sameByPmid = paper("europepmc", 1, {
      ids: { pmid: "777" } as ExternalIds,
      title: "The seed under another identifier entirely",
    });
    const world = worldOf({
      item,
      epmc: { citations: pageOf([sameByPmid, paper("europepmc", 2)]) },
    });
    const { rows } = expectRows(await world.run());
    expect(rows.map(({ work }) => work.ids.doi)).toEqual(["10.1000/p2"]);
  });

  it("drops a row with the seed item's own work key after a pick", async () => {
    const pick = workOf({
      workKey: "doi:10.1000/picked",
      ids: { doi: "10.1000/picked" } as ExternalIds,
    });
    const item = workOf({ workKey: "pmid:555", ids: {}, title: "Item title" });
    const sameKey = paper("europepmc", 1, {
      ids: { pmid: "555" } as ExternalIds,
      title: "Same key as the seed item here",
    });
    const world = worldOf({
      item,
      epmc: { citations: pageOf([sameKey, paper("europepmc", 2)]) },
    });
    const { rows } = expectRows(await world.run({ chosenSeed: pick }));
    expect(rows.map(({ work }) => work.ids.doi)).toEqual(["10.1000/p2"]);
  });

  it("drops datasets and keeps every other type, other included", async () => {
    const types: readonly WorkType[] = [
      "dataset",
      "other",
      "preprint",
      "journal-article",
    ];
    const world = worldOf({
      epmc: {
        citations: pageOf(
          types.map((type, i) => paper("europepmc", i + 1, { type })),
        ),
      },
    });
    const { rows } = expectRows(await world.run());
    expect(rows.map(({ work }) => work.type).sort()).toEqual(
      ["journal-article", "other", "preprint"].sort(),
    );
  });

  it("keeps an old row, flagged, using the searchYears preference", async () => {
    const old = paper("europepmc", 1, {
      publishedDate: { year: 2010, iso: "2010" },
    });
    const edge = paper("europepmc", 2, {
      publishedDate: { year: 2018, iso: "2018" },
    });
    const inside = paper("europepmc", 3, {
      publishedDate: { year: 2019, iso: "2019" },
    });
    const world = worldOf({
      epmc: { citations: pageOf([old, edge, inside]) },
    });
    const { rows } = expectRows(await world.run());
    expect(rowWithDoi(rows, "10.1000/p1").outsideWindow).toBe(true);
    expect(rowWithDoi(rows, "10.1000/p2").outsideWindow).toBe(true);
    expect(rowWithDoi(rows, "10.1000/p3").outsideWindow).toBe(false);
    expect(isCheckedByDefault(rowWithDoi(rows, "10.1000/p1"))).toBe(false);
  });

  it("keeps the score's order", async () => {
    const world = worldOf({
      epmc: {
        citations: pageOf([
          paper("europepmc", 1, { publishedDate: { year: 2005, iso: "2005" } }),
          paper("europepmc", 2, { publishedDate: { year: 2023, iso: "2023" } }),
        ]),
      },
    });
    const { rows } = expectRows(await world.run());
    expect(rows.map(({ work }) => work.ids.doi)).toEqual([
      "10.1000/p2",
      "10.1000/p1",
    ]);
    expect(rows[0]?.score).toBeGreaterThan(rows[1]?.score ?? 1);
  });
});

describe("marking", () => {
  const TITLE =
    "Ionizable lipid nanoparticles for hepatocyte gene editing in vivo";
  const candidate = paper("europepmc", 1, {
    ids: { doi: "10.1000/nodoi-in-library" } as ExternalIds,
    title: TITLE,
    authors: [{ family: "Shared" }],
    publishedDate: { year: 2021, iso: "2021" },
    containerTitle: "Journal of Lipids",
  });
  const fields = (
    itemID: number,
    extra: Partial<LibraryItemFields> = {},
  ): LibraryItemFields => ({
    itemID,
    deleted: false,
    title: TITLE,
    year: 2021,
    firstAuthorFamily: "Shared",
    containerTitle: "Journal of Lipids",
    ...extra,
  });

  it("a library item with no identifier is found by its title", async () => {
    const world = worldOf({
      epmc: { citations: pageOf([candidate]) },
      titleItems: [fields(66)],
    });
    const { rows } = expectRows(await world.run());
    expect(rows[0]).toMatchObject({ inLibrary: true, existingItemID: 66 });
  });

  it("an identifier match wins over a title match", async () => {
    const world = worldOf({
      epmc: { citations: pageOf([candidate]) },
      byDoi: { "10.1000/nodoi-in-library": 12 },
      titleItems: [fields(66)],
    });
    const { rows } = expectRows(await world.run());
    expect(rows[0]?.existingItemID).toBe(12);
  });

  it("a preprint's published version is a link, so it is not ownership", async () => {
    const preprint = paper("europepmc", 2, {
      ids: { doi: "10.1101/2021.01.01.000002" } as ExternalIds,
      type: "preprint",
      title: TITLE,
      authors: [{ family: "Shared" }],
      publishedDate: { year: 2021, iso: "2021" },
    });
    const world = worldOf({
      epmc: { citations: pageOf([preprint]) },
      titleItems: [
        fields(66, { doi: "10.1000/published-version", isPreprint: false }),
      ],
    });
    const { rows } = expectRows(await world.run());
    expect(rows[0]?.inLibrary).toBe(false);
    expect(rows[0]).not.toHaveProperty("existingItemID");
  });

  it("the seed item, found by title under another identifier, is dropped", async () => {
    const world = worldOf({
      epmc: { citations: pageOf([candidate, paper("europepmc", 2)]) },
      titleItems: [fields(SEED_ITEM_ID)],
    });
    const { rows } = expectRows(await world.run());
    expect(rows.map(({ work }) => work.ids.doi)).toEqual(["10.1000/p2"]);
  });

  it("the seed item, found by identifier, is dropped too", async () => {
    const world = worldOf({
      epmc: {
        citations: pageOf([paper("europepmc", 1), paper("europepmc", 2)]),
      },
      byDoi: { "10.1000/p1": SEED_ITEM_ID },
    });
    const { rows } = expectRows(await world.run());
    expect(rows.map(({ work }) => work.ids.doi)).toEqual(["10.1000/p2"]);
  });

  it("a library read that fails while marking fails the run", async () => {
    const world = worldOf({
      epmc: ONE_LIST,
      libraryIndexFails: new ConfigurationError("x"),
    });
    const { stageReached } = expectFailed(await world.run());
    expect(stageReached).toBe("MarkingRows");
  });

  it("marks a row without changing its score", async () => {
    const free = worldOf({
      epmc: { citations: pageOf([paper("europepmc", 1)]) },
    });
    const owned = worldOf({
      epmc: { citations: pageOf([paper("europepmc", 1)]) },
      byDoi: { "10.1000/p1": 9 },
    });
    expect(expectRows(await owned.run()).rows[0]?.score).toBe(
      expectRows(await free.run()).rows[0]?.score,
    );
  });

  it("carries what the generators report", async () => {
    const world = worldOf({ epmc: ONE_LIST });
    const output = expectRows(await world.run());
    expect(output.hydration).toMatchObject({ failed: [] });
    expect(output.links).toEqual([]);
    expect(output.flags).toEqual([]);
    expect(output.stageReached).toBe("MarkingRows");
    expect(output.rows[0]?.records.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The key gate, through the whole run
// ---------------------------------------------------------------------------

describe("the key gate on the shipped adapter (plan/00 §6 item 339(b))", () => {
  function storeOf(get: () => Promise<string | undefined>): SecretStore {
    return {
      backend: "os-keychain",
      unattended: true,
      get,
      set: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      has: () => Promise.resolve(true),
      listStoredIds: () => Promise.resolve([]),
      clearAll: () => Promise.resolve(0),
    };
  }

  const BROKEN: readonly [string, () => Promise<string | undefined>][] = [
    ["blank", () => Promise.resolve("   ")],
    ["unreadable", () => Promise.reject(new Error("locked"))],
  ];

  it.each(BROKEN)(
    "a store that says yes over a %s value is a keyless run, and nothing is sent",
    async (_name, get) => {
      const clock = createManualClock(NOW);
      const asked: string[] = [];
      const http: HttpClient = {
        request(_method, url) {
          asked.push(url);
          return Promise.reject(new Error(`asked: ${url}`));
        },
      };
      const secrets = storeOf(get);
      const s2 = createSemanticScholarSource({
        http,
        clock,
        mapRecords: createSemanticScholarRecordMapper({ clock }),
        secrets,
      });
      expect(await s2.hasApiKey()).toBe(true);
      const bare = paper("crossref", 7, { title: "" });
      const world = worldOf({
        crossrefGraph: { references: pageOf([bare], "reference") },
        epmc: { citations: pageOf([paper("europepmc", 1)]) },
      });
      const registry = createSourceRegistry();
      for (const { source } of [
        world.pubmed,
        world.epmc,
        world.crossrefGraph,
      ]) {
        registry.register(source);
      }
      registry.register(s2);
      const pipeline = createRelatedPipeline({
        ...world.deps,
        semanticscholar: s2,
      });
      const output = expectRows(
        await pipeline.run(
          { seedItemID: SEED_ITEM_ID },
          { ...world.contextWith(never()), sources: registry },
        ),
      );
      expect(asked.filter((url) => url.includes(SEMANTICSCHOLAR_HOST))).toEqual(
        [],
      );
      expect(output.keyNotice).toBe(true);
      expect(output.similarity).toEqual({ space: "lexical" });
      expect(
        output.statuses.find((row) => row.generator === "s2-citations")?.state,
      ).toBe("no-key");
    },
  );

  it("the pipeline reads Semantic Scholar's records through lookupKeyed only", async () => {
    const world = worldOf({
      keyed: true,
      store: "none",
      item: workOf({ workKey: "pmid:1", ids: { pmid: "1" } as ExternalIds }),
      s2: {
        recommendations: pageOf(
          [paper("semanticscholar", 8, { title: "" })],
          "recommendation",
        ),
      },
    });
    expectRows(await world.run());
    expect(world.s2.lookup).not.toHaveBeenCalled();
    expect(world.lookupKeyed.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe("wiring", () => {
  const writer = {} as never;

  it("buildPipelineSet builds no related pipeline without its dependencies", () => {
    expect(buildPipelineSet({ writer })).not.toHaveProperty("related");
  });

  it("buildPipelineSet hands the adapters, the store and the library to the pipeline", async () => {
    const world = worldOf({ keyed: true, epmc: ONE_LIST, store: "none" });
    const http: HttpClient = {
      request: () => Promise.reject(new Error("no network")),
    };
    const { related } = buildPipelineSet({
      writer,
      related: {
        semanticscholar: world.deps.semanticscholar,
        crossref: world.deps.crossref,
        embeddings: world.deps.embeddings,
        http,
        library: world.deps.library,
      },
    });
    if (related === undefined) throw new Error("no related pipeline");
    expect(related.id).toBe("related");
    const output = expectRows(
      await (related as unknown as RelatedPipeline).run(
        { seedItemID: SEED_ITEM_ID },
        world.contextWith(never()),
      ),
    );
    expect(world.readSeed).toHaveBeenCalled();
    expect(world.hasUsableApiKey).toHaveBeenCalled();
    expect(world.embeddings).toHaveBeenCalled();
    expect(output.similarity.notice).toBe("no-store");
  });

  it("buildPipelineSet builds the PMC converter over the one client", async () => {
    const world = worldOf({
      item: workOf({
        workKey: "pmcid:PMC777",
        ids: { pmcid: "PMC777" } as ExternalIds,
      }),
    });
    const asked: string[] = [];
    const http: HttpClient = {
      request(_method, url) {
        asked.push(url);
        return Promise.reject(new UpstreamServerError(500, "x"));
      },
    };
    const { related } = buildPipelineSet({
      writer,
      related: {
        semanticscholar: world.deps.semanticscholar,
        crossref: world.deps.crossref,
        embeddings: world.deps.embeddings,
        http,
        logger: createLogger({
          sink: NULL_LOG_SINK,
          clock: createManualClock(NOW),
        }),
        library: world.deps.library,
      },
    });
    const output = expectRows(
      await (related as unknown as RelatedPipeline).run(
        { seedItemID: SEED_ITEM_ID },
        world.contextWith(never()),
      ),
    );
    expect(asked.length).toBeGreaterThan(0);
    expect(output.seedFailures[0]).toMatchObject({ source: "pmc-idconv" });
  });

  it("libraryItemFieldsOf reduces a work to what dedupe.ts's index reads", () => {
    expect(
      libraryItemFieldsOf({
        itemID: 5,
        work: workOf({
          ids: {
            doi: "10.1/x",
            pmid: "1",
            pmcid: "PMC2",
            arxivId: "2101.00001",
          } as ExternalIds,
          type: "preprint",
          title: "T",
          authors: [{ family: "F" }, { family: "G" }],
          containerTitle: "C",
          publishedDate: { year: 2020, iso: "2020" },
          onlineDate: { year: 2019, iso: "2019" },
        }),
      }),
    ).toEqual({
      itemID: 5,
      deleted: false,
      doi: "10.1/x",
      pmid: "1",
      pmcid: "PMC2",
      arxivId: "2101.00001",
      title: "T",
      year: 2020,
      firstAuthorFamily: "F",
      containerTitle: "C",
      isPreprint: true,
    });
  });

  it("libraryItemFieldsOf falls back to the online year, and reads no preprint from an article", () => {
    expect(
      libraryItemFieldsOf({
        itemID: 5,
        work: workOf({ onlineDate: { year: 2019, iso: "2019" } }),
      }),
    ).toMatchObject({ year: 2019, isPreprint: false });
  });
});

// ---------------------------------------------------------------------------
// What the first mutation sweep showed was unproved
// ---------------------------------------------------------------------------

describe("corners the sweep found", () => {
  it("each stage finishes the one before it, so the bar stands at the new stage's start", async () => {
    const world = worldOf({ keyed: true, epmc: ONE_LIST });
    const seen = new Map<string, number | undefined>();
    expectRows(
      await world.run({}, never(), (stage) => {
        seen.set(stage, world.snapshots.at(-1)?.fraction);
      }),
    );
    for (const { stage, from } of stageSlices(RELATED_STAGES)) {
      if (from > 0) expect(seen.get(stage.key)).toBeCloseTo(from, 9);
    }
  });

  it("a generator that could not ask does not save a run whose others all failed", async () => {
    const down = new UpstreamServerError(500, "x");
    const world = worldOf({
      // No DOI, so Crossref's list has nothing to ask with.
      item: workOf({ workKey: "pmid:1", ids: { pmid: "1" } as ExternalIds }),
      pubmed: { similar: down },
      epmc: { citations: down, references: down },
    });
    const { statuses } = expectFailed(await world.run());
    expect(
      statuses.find(({ generator }) => generator === "crossref-references")
        ?.state,
    ).toBe("could-not-ask");
  });

  it("after a pick, the pick's work key is protected and its vector is the seed's", async () => {
    const pick = workOf({
      workKey: "doi:10.1000/picked",
      ids: { doi: "10.1000/picked", pmid: "2" } as ExternalIds,
    });
    const world = worldOf({
      keyed: true,
      item: workOf({ workKey: "hash:item", ids: {}, title: "Item title" }),
      s2: {
        recommendations: pageOf(
          [paper("semanticscholar", 1)],
          "recommendation",
        ),
      },
      angles: { "DOI:10.1000/picked": 0, "DOI:10.1000/p1": 0 },
    });
    const { rows } = expectRows(await world.run({ chosenSeed: pick }));
    expect(
      rowWithDoi(rows, "10.1000/p1").chips.find(({ id }) => id === "similar"),
    ).toEqual({ id: "similar", similarity: 1 });
    expect(world.evictions[0]?.("doi:10.1000/picked")).toBe(true);
    expect(world.evictions[0]?.("hash:item")).toBe(true);
  });

  it("a keyed run reads the library's index once, for the vectors and the marks", async () => {
    const world = worldOf({ keyed: true, epmc: ONE_LIST });
    expectRows(await world.run());
    expect(world.libraryIndex).toHaveBeenCalledTimes(1);
  });

  it("keyless: a pick's abstract is the seed's when the item has none", async () => {
    const world = worldOf({
      item: workOf({
        workKey: "hash:item",
        ids: {},
        title: "Omega unrelated wording",
      }),
      epmc: {
        citations: pageOf([
          paper("europepmc", 1, {
            title: "Nothing shared in this heading",
            abstract: "Quasicrystal lattice phonons",
          }),
        ]),
      },
    });
    const { rows } = expectRows(
      await world.run({
        chosenSeed: workOf({
          workKey: "doi:10.1000/picked",
          ids: { doi: "10.1000/picked", pmid: "2" } as ExternalIds,
          abstract: "Quasicrystal lattice phonons",
        }),
      }),
    );
    expect(
      rowWithDoi(rows, "10.1000/p1").chips.some(({ id }) => id === "similar"),
    ).toBe(true);
  });

  it("keyless: the space is built over the seed and the candidates, once", async () => {
    const seedText = { title: "Alpha beta gamma" };
    const near = paper("europepmc", 1, {
      title: "Alpha beta delta",
      abstract: "",
    });
    const far = paper("europepmc", 2, {
      title: "Alpha epsilon zeta",
      abstract: "",
    });
    const world = worldOf({
      item: workOf(seedText),
      epmc: { citations: pageOf([near, far]) },
    });
    const { rows } = expectRows(await world.run());
    const space = lexicalSpace([seedText, ...rows.map(({ work }) => work)]);
    const expected = space.cosine(
      space.vector(seedText),
      space.vector(rowWithDoi(rows, "10.1000/p1").work),
    );
    const chip = rowWithDoi(rows, "10.1000/p1").chips.find(
      ({ id }) => id === "similar",
    );
    expect(chip).toEqual({ id: "similar", similarity: expected });
  });

  it("findExisting is given the row's work key", async () => {
    const world = worldOf({
      epmc: { citations: pageOf([paper("europepmc", 1)]) },
      byWorkKey: { "doi:10.1000/p1": 31 },
    });
    const { rows } = expectRows(await world.run());
    expect(rows[0]?.existingItemID).toBe(31);
  });

  it("the title match reads the merged work, not its first record", async () => {
    const TITLE =
      "Ionizable lipid nanoparticles for hepatocyte gene editing in vivo";
    const ids = { doi: "10.1000/merged" } as ExternalIds;
    const shared = {
      ids,
      authors: [{ family: "Shared" }],
      publishedDate: { year: 2021, iso: "2021" },
    };
    const world = worldOf({
      pubmed: {
        similar: pageOf(
          [paper("pubmed", 1, { ...shared, title: "" })],
          "similar",
        ),
      },
      epmc: {
        citations: pageOf([paper("europepmc", 1, { ...shared, title: TITLE })]),
      },
      titleItems: [
        {
          itemID: 66,
          deleted: false,
          title: TITLE,
          year: 2021,
          firstAuthorFamily: "Shared",
        },
      ],
    });
    const { rows } = expectRows(await world.run());
    expect(rows[0]?.work.title).toBe(TITLE);
    expect(rows[0]?.records[0]?.work.title).toBe("");
    expect(rows[0]?.existingItemID).toBe(66);
  });
});
