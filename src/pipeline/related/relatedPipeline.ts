/**
 * The `related` pipeline: `docs/07` §12.2's state machine, run (`plan/08` `P5-T14`).
 * §12.2's note "As built 2026-11-05" and `docs/05` §6.1's hold this file's decisions.
 *
 * **Caller and constructor.** `buildPipelineSet` (`src/bootstrap/registerPipelines.ts`)
 * constructs it from what `installServices` passes in; the search window's host runs
 * it (`P5-T16`). Nothing here names `Zotero` or writes to the library: reads arrive
 * through {@link RelatedLibrary}.
 *
 * **One similarity space per run.** The key probe chooses it, once. A work without a
 * vector scores 0 and nothing falls back per candidate.
 *
 * **The key gate.** Every Semantic Scholar probe and record read goes through
 * `hasUsableApiKey` and `lookupKeyed` (`plan/00` §6 item 339(b)), so a key store that
 * says yes over a blank or unreadable value reads as a run with no key.
 */

import { OperationCancelledError } from "../../core/errors";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { CrossrefSource } from "../../sources/crossref/crossrefSource";
import type { PmcidConverter } from "../../sources/pubmed/idConverter";
import { identifierKeys } from "../../sources/semanticscholar/recommendations";
import {
  SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS,
  type SemanticScholarSource,
} from "../../sources/semanticscholar/semanticscholarSource";
import {
  buildLibraryIndex as buildTitleIndex,
  matchAgainstLibrary,
  type LibraryIndex as TitleIndex,
} from "../../sources/shared/dedupe";
import { recencyWindow } from "../../sources/shared/recency";
import type { LibraryIndex } from "../../zotero/libraryIndex";
import { serialize } from "../searchImport/stages";
import {
  cosine,
  ensureEmbeddings,
  type EnsureEmbeddingsDeps,
  type EnsuredEmbeddings,
} from "../shared/embeddings";
import { lexicalSpace, type LexicalWork } from "../shared/lexical";
import {
  stageSlices,
  type PipelineContext,
  type PipelineEstimate,
  type StageDescriptor,
  type StageSlice,
  type ValidationResult,
} from "../types";
import {
  RELATED_GENERATORS,
  RELATED_REQUEST_BUDGET,
  runRelatedGenerators,
  type RelatedGeneratorState,
  type RelatedGeneratorStatus,
} from "./generators";
import {
  scoreRelatedCandidates,
  type ScoredRelatedCandidate,
  type SimilarityFn,
} from "./score";
import {
  expandSeedIds,
  resolveSeed,
  SeedUnresolvedError,
  type ResolvedSeed,
  type SeedResolverDeps,
  type SeedSourceFailure,
} from "./seed";
import type {
  RelatedFailed,
  RelatedInput,
  RelatedLibrary,
  RelatedOutput,
  RelatedPipeline,
  RelatedRow,
  RelatedSeedItem,
  RelatedSimilarityReport,
} from "./types";

/** The menu entry's own string, as every stage's label: the trend report's precedent. */
export const RELATED_DISPLAY_NAME_KEY =
  "research-helper-menu-item-find-related";

/** `docs/07` §12.2's states. `Generating` holds `Hydrating`, as `runRelatedGenerators` does. */
export type RelatedStageKey =
  | "ResolvingSeed"
  | "ExpandingIds"
  | "Generating"
  | "FetchingVectors"
  | "Scoring"
  | "Filtering"
  | "MarkingRows";

function stage(key: RelatedStageKey, weight: number): StageDescriptor {
  return Object.freeze({ key, labelKey: RELATED_DISPLAY_NAME_KEY, weight });
}

/** The weights are starting values, not a measurement. */
export const RELATED_STAGES: readonly StageDescriptor[] = Object.freeze([
  stage("ResolvingSeed", 0.05),
  stage("ExpandingIds", 0.05),
  stage("Generating", 0.6),
  stage("FetchingVectors", 0.15),
  stage("Scoring", 0.05),
  stage("Filtering", 0.05),
  stage("MarkingRows", 0.05),
]);

/**
 * Types that are not a paper to read (`docs/07` §12.2's note, decision 4). `"other"`
 * stays, because Europe PMC's relation rows often carry it.
 */
export const RELATED_EXCLUDED_TYPES: readonly CanonicalWork["type"][] =
  Object.freeze(["dataset"] as const);

/** A title match asks two services; expansion asks Semantic Scholar and the converter. */
const SEED_RESOLUTION_REQUESTS = 2;
const SEED_EXPANSION_REQUESTS = 2;

/** Generator states where nothing was sent, so neither a success nor a failure. */
const DID_NOT_RUN: ReadonlySet<RelatedGeneratorState> = new Set([
  "no-key",
  "over-budget",
  "could-not-ask",
]);
const FAILED: ReadonlySet<RelatedGeneratorState> = new Set([
  "failed",
  "rate-limited",
]);

/** What `installServices` hands in. `buildPipelineSet` builds it. */
export interface RelatedPipelineDeps {
  readonly library: RelatedLibrary;
  readonly semanticscholar: Pick<
    SemanticScholarSource,
    "hasUsableApiKey" | "lookupKeyed" | "matchTitle" | "fetchEmbeddings"
  >;
  readonly crossref: Pick<CrossrefSource, "matchTitle">;
  readonly convertPmcids: PmcidConverter;
  /** `undefined`: no plugin database, so this run has no vectors. */
  readonly embeddings: () => Promise<EnsureEmbeddingsDeps["store"] | undefined>;
}

/**
 * `docs/07` §4.5's `validate()`: a whole item id above 0. Cheap, so whether the item
 * still exists is the run's question (`SeedUnresolvedError`, reason `"gone"`).
 *
 * @param input - the run's input
 * @returns `ok`, or the one error
 */
export function validateRelatedInput(input: RelatedInput): ValidationResult {
  return Number.isInteger(input.seedItemID) && input.seedItemID > 0
    ? { ok: true, errors: [] }
    : {
        ok: false,
        errors: [{ field: "seedItemID", messageKey: "rh-error-seed-gone" }],
      };
}

/** §12.2's `Generating --> Failed`: something ran, and all of it failed. */
function everyGeneratorFailed(
  statuses: readonly RelatedGeneratorStatus[],
): boolean {
  const ran = statuses.filter(({ state }) => !DID_NOT_RUN.has(state));
  return ran.length > 0 && ran.every(({ state }) => FAILED.has(state));
}

/**
 * The seed as the lexical space reads it. A title match's work is the merged record
 * and may lack the item's abstract, so the item's own text comes first.
 */
function seedTextOf(item: CanonicalWork, expanded: CanonicalWork): LexicalWork {
  const abstract = item.abstract ?? expanded.abstract;
  const subjects = item.subjects ?? expanded.subjects;
  return {
    title: item.title.trim() === "" ? expanded.title : item.title,
    ...(abstract !== undefined && { abstract }),
    ...(subjects !== undefined && { subjects }),
  };
}

function lexicalSimilarity(
  seedText: LexicalWork,
  candidates: readonly CanonicalWork[],
): SimilarityFn {
  const space = lexicalSpace([seedText, ...candidates]);
  const seedVector = space.vector(seedText);
  return (work) => space.cosine(seedVector, space.vector(work));
}

/** `docs/05` §7.4's rescale of SPECTER2's cosine; 0 when either vector is missing. */
function specterSimilarity(
  vectors: EnsuredEmbeddings["vectors"],
  seedKey: string,
): SimilarityFn {
  const seedVector = vectors.get(seedKey);
  return (work) => {
    const vector = vectors.get(work.workKey);
    return seedVector === undefined || vector === undefined
      ? 0
      : (cosine(seedVector, vector) + 1) / 2;
  };
}

/** Drop the seed and the excluded types. Order and `outsideWindow` rows are kept. */
function filterRows(
  scored: readonly ScoredRelatedCandidate[],
  seedKeys: ReadonlySet<string>,
  seedIdKeys: ReadonlySet<string>,
): readonly ScoredRelatedCandidate[] {
  return scored.filter(({ work }) => {
    if (seedKeys.has(work.workKey)) return false;
    if (identifierKeys(work.ids).some((key) => seedIdKeys.has(key))) {
      return false;
    }
    return !RELATED_EXCLUDED_TYPES.includes(work.type);
  });
}

/** The item a row is, by identifier first. A `"link"` or `"flag"` is not ownership. */
function existingItemOf(
  row: ScoredRelatedCandidate,
  index: LibraryIndex,
  titles: TitleIndex,
): number | undefined {
  const byIdentifier = index.findExisting(row.work.ids, row.work.workKey);
  if (byIdentifier !== undefined) return byIdentifier.itemID;
  const [record] = row.records;
  if (record === undefined) return undefined;
  const match = matchAgainstLibrary({ ...record, work: row.work }, titles);
  return match?.decision.verdict === "match" ? match.itemID : undefined;
}

function markRows(
  rows: readonly ScoredRelatedCandidate[],
  index: LibraryIndex,
  titles: TitleIndex,
  seedItemID: number,
): readonly RelatedRow[] {
  return rows.flatMap((row): RelatedRow[] => {
    const existingItemID = existingItemOf(row, index, titles);
    if (existingItemID === seedItemID) return [];
    return [
      existingItemID === undefined
        ? { ...row, inLibrary: false }
        : { ...row, inLibrary: true, existingItemID },
    ];
  });
}

/** What every ending reports, as the run has it so far. */
interface RunState {
  stageReached: RelatedStageKey;
  reporter: ProgressReporter | undefined;
  seedFailures: SeedSourceFailure[];
  statuses: readonly RelatedGeneratorStatus[];
}

/**
 * `docs/07` §4.5's pipeline over §12.2.
 *
 * @param deps - the Zotero reads, the typed adapters, the converter and the vector store
 * @returns the pipeline, with `id` `"related"` and `resumable` `false`
 * @throws RangeError if {@link RELATED_STAGES}' weights do not sum to 1
 */
export function createRelatedPipeline(
  deps: RelatedPipelineDeps,
): RelatedPipeline {
  const slices = new Map<string, StageSlice>(
    stageSlices(RELATED_STAGES).map((slice) => [slice.stage.key, slice]),
  );

  /** §7.4's check between stages, then this stage's reporter and checkpoint. */
  async function enterStage(
    state: RunState,
    ctx: PipelineContext,
    key: RelatedStageKey,
  ): Promise<ProgressReporter> {
    ctx.token.throwIfCancelled();
    state.reporter?.done("succeeded");
    state.stageReached = key;
    const slice = slices.get(key) as StageSlice;
    state.reporter = ctx.progress.child(key, slice.from, slice.to);
    await ctx.checkpoint({ stage: key });
    return state.reporter;
  }

  function failed(
    state: RunState,
    error: RelatedFailed["error"],
  ): RelatedFailed {
    return {
      outcome: "failed",
      stageReached: state.stageReached,
      seedFailures: state.seedFailures,
      statuses: state.statuses,
      error,
    };
  }

  /**
   * One `ensureEmbeddings` pass, or `undefined` for a run with no store. It protects
   * what the library holds, by stored work key or by identifier, because an item this
   * plugin did not write has no stored key.
   */
  async function fetchVectors(
    works: readonly CanonicalWork[],
    seedKeys: ReadonlySet<string>,
    index: () => Promise<LibraryIndex>,
    ctx: PipelineContext,
  ): Promise<EnsuredEmbeddings | undefined> {
    const store = await deps.embeddings().catch((error: unknown) => {
      ctx.logger.warn("related: the vector store could not be opened", {
        code: serialize(error).code,
      });
      return undefined;
    });
    if (store === undefined) return undefined;
    const library = await index();
    const owned = new Set(seedKeys);
    for (const work of works) {
      if (library.findExisting(work.ids, work.workKey) !== undefined) {
        owned.add(work.workKey);
      }
    }
    return ensureEmbeddings(
      {
        source: deps.semanticscholar,
        store,
        clock: ctx.clock,
        logger: ctx.logger,
        isInLibrary: (workKey) =>
          library.byWorkKey.has(workKey) || owned.has(workKey),
      },
      works,
      "specter_v2",
      { token: ctx.token },
    );
  }

  /** From the read item to the seed, or the window's list to pick from. */
  async function seedOf(
    input: RelatedInput,
    item: RelatedSeedItem,
    seedDeps: SeedResolverDeps,
    state: RunState,
    ctx: PipelineContext,
  ): Promise<ResolvedSeed | readonly CanonicalWork[]> {
    if (input.chosenSeed !== undefined) {
      return { work: input.chosenSeed, matchedByTitle: true };
    }
    const resolution = await resolveSeed(item.work, seedDeps, {
      token: ctx.token,
    });
    state.seedFailures.push(...resolution.failures);
    if (resolution.kind === "choose") return resolution.candidates;
    await enterStage(state, ctx, "ExpandingIds");
    return resolution.seed;
  }

  async function runStages(
    input: RelatedInput,
    ctx: PipelineContext,
    state: RunState,
  ): Promise<RelatedOutput> {
    const call = { token: ctx.token };
    const seedDeps: SeedResolverDeps = {
      semanticscholar: deps.semanticscholar,
      crossref: deps.crossref,
      convertPmcids: deps.convertPmcids,
      clock: ctx.clock,
    };

    // A pick starts at `ExpandingIds`; the item is read either way.
    await enterStage(
      state,
      ctx,
      input.chosenSeed === undefined ? "ResolvingSeed" : "ExpandingIds",
    );
    const item = await deps.library.readSeed(input.seedItemID);
    if (item === undefined) throw new SeedUnresolvedError("gone");

    const seed = await seedOf(input, item, seedDeps, state, ctx);
    if (!("work" in seed)) {
      state.reporter?.done("succeeded");
      return {
        outcome: "succeeded",
        ending: "choose",
        stageReached: state.stageReached,
        seedFailures: state.seedFailures,
        candidates: seed,
      };
    }
    const expanded = await expandSeedIds(seed.work, seedDeps, call);
    state.seedFailures.push(...expanded.failures);

    const generating = await enterStage(state, ctx, "Generating");
    const generated = await runRelatedGenerators(
      { ids: expanded.work.ids },
      ctx,
      {
        hasSemanticScholarKey: () => deps.semanticscholar.hasUsableApiKey(),
        lookupSemanticScholar: (ids, lookupCall) =>
          deps.semanticscholar.lookupKeyed(ids, lookupCall),
        progress: generating,
      },
    );
    state.statuses = generated.statuses;
    if (everyGeneratorFailed(generated.statuses)) {
      const generators = generated.statuses.map(({ generator }) => generator);
      return failed(state, {
        code: "SOURCE",
        messageKey: "rh-error-source",
        detail: `every related generator that ran failed: ${generators.join(", ")}`,
        retryable: true,
      });
    }

    const { libraryID } = item;
    const seedKeys = new Set([item.work.workKey, expanded.work.workKey]);
    const candidateWorks = generated.candidates.map(({ work }) => work);
    let libraryIndex: Promise<LibraryIndex> | undefined;
    const index = (): Promise<LibraryIndex> =>
      (libraryIndex ??= deps.library.libraryIndex(libraryID));

    let vectors: EnsuredEmbeddings | undefined;
    if (generated.hadKey) {
      await enterStage(state, ctx, "FetchingVectors");
      vectors = await fetchVectors(
        [expanded.work, ...candidateWorks],
        seedKeys,
        index,
        ctx,
      );
    }

    await enterStage(state, ctx, "Scoring");
    const scored = scoreRelatedCandidates(generated.candidates, {
      similarity:
        vectors === undefined
          ? lexicalSimilarity(
              seedTextOf(item.work, expanded.work),
              candidateWorks,
            )
          : specterSimilarity(vectors.vectors, expanded.work.workKey),
      window: recencyWindow(ctx.config.get("searchYears"), ctx.clock),
    });

    await enterStage(state, ctx, "Filtering");
    const kept = filterRows(
      scored,
      seedKeys,
      new Set(identifierKeys(generated.seedIds)),
    );

    await enterStage(state, ctx, "MarkingRows");
    const rows = markRows(
      kept,
      await index(),
      buildTitleIndex(await deps.library.libraryItems(libraryID)),
      input.seedItemID,
    );
    state.reporter?.done("succeeded");

    return {
      outcome: "succeeded",
      ending: "rows",
      stageReached: state.stageReached,
      seedFailures: state.seedFailures,
      seed: { ...seed, work: expanded.work },
      rows,
      statuses: generated.statuses,
      keyNotice: !generated.hadKey || vectors?.keyed === false,
      similarity: similarityReport(generated.hadKey, vectors),
      hydration: generated.hydration,
      links: generated.links,
      flags: generated.flags,
    };
  }

  return {
    id: "related",
    displayNameKey: RELATED_DISPLAY_NAME_KEY,
    stages: RELATED_STAGES,
    resumable: false,
    validate: validateRelatedInput,

    async estimate(input): Promise<PipelineEstimate> {
      const keyed = await deps.semanticscholar.hasUsableApiKey();
      const works = RELATED_GENERATORS.reduce(
        (sum, { limit }) => sum + limit,
        1,
      );
      return {
        itemCount: 1,
        externalRequests:
          (input.chosenSeed === undefined ? SEED_RESOLUTION_REQUESTS : 0) +
          SEED_EXPANSION_REQUESTS +
          RELATED_REQUEST_BUDGET +
          (keyed ? Math.ceil(works / SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS) : 0),
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        // `undefined`, not `0`: no priced call, as the search pipeline says.
        estimatedCostUsd: undefined,
        estimatedDurationSeconds: 0,
        notesKeys: [],
      };
    },

    async run(input, ctx): Promise<RelatedOutput> {
      const state: RunState = {
        stageReached: "ResolvingSeed",
        reporter: undefined,
        seedFailures: [],
        statuses: [],
      };
      try {
        return await runStages(input, ctx, state);
      } catch (caught) {
        if (caught instanceof OperationCancelledError) {
          return {
            outcome: "cancelled",
            stageReached: state.stageReached,
            seedFailures: state.seedFailures,
          };
        }
        const error = serialize(caught);
        ctx.logger.warn("related: the run failed", {
          stage: state.stageReached,
          code: error.code,
        });
        return failed(state, error);
      }
    },
  };
}

function similarityReport(
  hadKey: boolean,
  vectors: EnsuredEmbeddings | undefined,
): RelatedSimilarityReport {
  if (vectors === undefined) {
    return {
      space: "lexical",
      ...(hadKey && { notice: "no-store" as const }),
    };
  }
  return {
    space: "specter_v2",
    ...(vectors.failure !== undefined && {
      notice: "fetch-failed" as const,
      error: vectors.failure.toSerialized(),
    }),
  };
}
