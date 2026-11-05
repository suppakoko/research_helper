/**
 * The `recommend` pipeline: `docs/07` §12.5's state machine, run (`plan/08` `P5-T25`).
 * §12.5's note "As built 2026-11-05" holds this file's decisions.
 *
 * **Caller and constructor.** `buildPipelineSet` (`src/bootstrap/registerPipelines.ts`)
 * constructs it from what `installServices` passes in; the window's host runs it
 * (`P5-T26`), and `P5-T27` reads its rows and calls `reject`. Nothing here names `Zotero`
 * or writes to the library: reads arrive through `RecommendLibrary`.
 *
 * **Two jobs, one pipeline** (`plan/08` §0.4 line 20). "Profile only" ends with the
 * profile and sends no candidate request. "Edited profile in" comes with what the user
 * changed and ends with rows.
 *
 * **The key gate.** The key is probed once, through `hasUsableApiKey`, and every record
 * read goes through `lookupKeyed` (`plan/00` §6 item 339(b)). With no key nothing here
 * calls Semantic Scholar: the keyword generator's source list and the abstract ladder
 * are narrowed by that one answer.
 *
 * **One request budget per run,** shared by the generators and the fill-in. Vector
 * batches are not counted in it (`docs/05` §9.3).
 *
 * **The store is written with one action.** `reject` is the only write of what a user did
 * (`plan/08` §0.2 item 27), and no row is stored with a `userAction`.
 */

import {
  OperationCancelledError,
  PolicyViolationError,
  ResearchHelperError,
} from "../../core/errors";
import type { Semaphore } from "../../core/concurrency";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { CanonicalWork } from "../../model/canonicalWork";
import {
  isSourceId,
  normalizeDoi,
  type ExternalIds,
  type SourceId,
} from "../../model/ids";
import type { CollectionProfile } from "../../model/profile";
import type { SourceRecord } from "../../model/sourceRecord";
import { CROSSREF_DOI_LOOKUP_BATCH } from "../../sources/crossref/references";
import { EUROPEPMC_DOI_LOOKUP_BATCH } from "../../sources/europepmc/query";
import type { PubmedSource } from "../../sources/pubmed/pubmedSource";
import { SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT } from "../../sources/semanticscholar/query";
import { identifierKeys } from "../../sources/semanticscholar/recommendations";
import {
  ARXIV_DATACITE_DOI,
  SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS,
  toSemanticScholarId,
  type SemanticScholarSource,
} from "../../sources/semanticscholar/semanticscholarSource";
import { recencyWindow } from "../../sources/shared/recency";
import type {
  LiteratureSource,
  RelatedPage,
  SourceCallContext,
} from "../../sources/types";
import {
  collectionProfileId,
  recommendationId,
  type CollectionProfileStore,
  type RecommendationStore,
} from "../../zotero/db";
import type { LibraryIndex } from "../../zotero/libraryIndex";
import {
  RELATED_GENERATORS,
  semanticScholarIdsOf,
} from "../related/generators";
import {
  ABSTRACT_BACKFILL_LADDER,
  backfillAbstracts,
} from "../searchImport/backfill";
import {
  dedupeAndMergeAsync,
  serialize,
  type DedupeMergeResult,
} from "../searchImport/stages";
import { ceilingStopOf, suggestedLimitUsd } from "../shared/budget";
import { withEgressLog, type EgressLogEntry } from "../shared/egressDisclosure";
import {
  ensureEmbeddings,
  type EnsureEmbeddingsDeps,
  type EnsuredEmbeddings,
} from "../shared/embeddings";
import {
  readRelated,
  relatedCacheDeps,
  writeRelated,
  writeRelatedMissing,
  type RelatedCacheDeps,
  type RelatedCacheKey,
} from "../shared/relatedFetch";
import { RequestBudget } from "../shared/requestBudget";
import { isRunBudgetGuard } from "../summarize/summarizePipeline";
import {
  stageSlices,
  type PipelineContext,
  type PipelineEstimate,
  type StageDescriptor,
  type StageSlice,
  type ValidationResult,
} from "../types";
import {
  RECOMMEND_REQUEST_BUDGET,
  runRecommendGenerators,
  type RecommendCandidate,
  type RecommendFinding,
  type RecommendGeneratorStatus,
} from "./generators";
import {
  addedAtByWorkKey,
  buildProfileStats,
  membershipHash,
  persistProfile,
  readProfileCollection,
  type RecommendLibrary,
} from "./profile";
import {
  planProfileCall,
  runProfileCall,
  type ProfileCallDeps,
  type ProfileCallOutcome,
  type ProfileCallSurface,
  type ProfileHeuristicReason,
} from "./profileCall";
import {
  contentFilters,
  diversify,
  identifierFilters,
  readDismissed,
  recommendOwnership,
  scoreRecommendations,
  type RecommendDropReason,
  type RecommendReferences,
} from "./score";
import { recentNegatives, withTopicsAndSeeds } from "./seeds";
import type {
  RecommendFailed,
  RecommendFillInReport,
  RecommendInput,
  RecommendOutput,
  RecommendPipeline,
  RecommendProfileResult,
  RecommendRows,
  RecommendSimilarityReport,
  RecommendSurface,
} from "./types";

/**
 * The menu entry's own string, as every stage's label: the related pipeline's precedent.
 * `P5-T26` added this string with the menu entry.
 */
export const RECOMMEND_DISPLAY_NAME_KEY =
  "research-helper-menu-collection-recommend";

/**
 * `docs/07` §12.5's states. `Generating` holds `PartialResults` and `Merging`, as
 * `runRecommendGenerators` does.
 */
export type RecommendStageKey =
  | "ProfileCheck"
  | "BuildingStats"
  | "Centroids"
  | "ProfileCall"
  | "ApplyingStoredEdits"
  | "StoringEdits"
  | "Generating"
  | "IdentifierFilters"
  | "FillingMetadata"
  | "FetchingVectors"
  | "ContentFilters"
  | "Scoring"
  | "Diversifying";

function stage(key: RecommendStageKey, weight: number): StageDescriptor {
  return Object.freeze({ key, labelKey: RECOMMEND_DISPLAY_NAME_KEY, weight });
}

/** The weights are starting values, not a measurement. */
export const RECOMMEND_STAGES: readonly StageDescriptor[] = Object.freeze([
  stage("ProfileCheck", 0.02),
  stage("BuildingStats", 0.05),
  stage("Centroids", 0.1),
  stage("ProfileCall", 0.1),
  stage("ApplyingStoredEdits", 0.01),
  stage("StoringEdits", 0.01),
  stage("Generating", 0.4),
  stage("IdentifierFilters", 0.02),
  stage("FillingMetadata", 0.1),
  stage("FetchingVectors", 0.1),
  stage("ContentFilters", 0.01),
  stage("Scoring", 0.05),
  stage("Diversifying", 0.03),
]);

/**
 * The surface of a run with no window: it declines every question, so nothing is spent.
 * `RecommendPipeline.run` uses it.
 */
export const HEADLESS_RECOMMEND_SURFACE: RecommendSurface = Object.freeze({
  confirm: () => Promise.resolve({ kind: "cancelled" as const }),
  ask: () => Promise.resolve("cancel" as const),
});

const SEMANTIC_SCHOLAR: SourceId = "semanticscholar";
const EUROPE_PMC: SourceId = "europepmc";
const CROSSREF: SourceId = "crossref";

/** Identifiers one `lookup` request carries; the adapters' own batch sizes. */
const LOOKUP_BATCH: Readonly<Partial<Record<SourceId, number>>> = {
  [EUROPE_PMC]: EUROPEPMC_DOI_LOOKUP_BATCH,
  [SEMANTIC_SCHOLAR]: SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT,
  [CROSSREF]: CROSSREF_DOI_LOOKUP_BATCH,
};

/** The generators whose cached answers hold a work's reference list. */
const REFERENCE_GENERATORS = RELATED_GENERATORS.filter(
  ({ signal }) => signal === "references",
);

/** The egress log, as `recordEgress` writes it: no record exists to carry it. */
export type RecommendEgressRecord = Pick<
  RecommendInput,
  "libraryID" | "collectionKey" | "mode"
> & { readonly egress: EgressLogEntry };

/** What `installServices` hands in. `buildPipelineSet` builds it. */
export interface RecommendPipelineDeps {
  readonly library: RecommendLibrary;
  readonly semanticscholar: Pick<
    SemanticScholarSource,
    | "hasUsableApiKey"
    | "lookupKeyed"
    | "fetchEmbeddings"
    | "rateLimitKey"
    | "recommend"
    | "findRelated"
  >;
  readonly pubmed: Pick<PubmedSource, "rateLimitKey" | "findSimilarForSeeds">;
  /** `docs/07` §7.2's `network-metadata` pool, for the generators' `fanOut`. */
  readonly pool: Semaphore;
  /** `undefined`: no plugin database. Likewise for the two below. */
  readonly profiles: () => Promise<
    Pick<CollectionProfileStore, "get" | "put"> | undefined
  >;
  readonly recommendations: () => Promise<
    Pick<RecommendationStore, "put" | "reject" | "listRejected"> | undefined
  >;
  readonly embeddings: () => Promise<EnsureEmbeddingsDeps["store"] | undefined>;
  /** `PROMPT_REGISTRY` arrives lazily, as the summarize pipeline's does. */
  readonly profileCall: Omit<ProfileCallDeps, "prompts"> & {
    readonly prompts: () => Promise<ProfileCallDeps["prompts"]>;
  };
  /** The clock `reject` stamps, which has no job's context. */
  readonly clock: { now(): number };
  /**
   * Writes the egress log before a request goes. A rejection stops the request and
   * fails the run (`docs/07` §12.5 item 8, corrected 2026-11-05). Absent: `egress` on
   * the ending only.
   */
  readonly recordEgress?: (record: RecommendEgressRecord) => Promise<void>;
}

/**
 * `docs/07` §4.5's `validate()`. Cheap, so whether the collection exists and has enough
 * items is the run's question.
 *
 * @param input - the run's input
 * @returns `ok`, or the errors
 */
export function validateRecommendInput(
  input: RecommendInput,
): ValidationResult {
  const errors: { field: string; messageKey: string }[] = [];
  const bad = (field: string): void => {
    errors.push({ field, messageKey: "rh-error-configuration" });
  };
  if (!Number.isInteger(input.libraryID) || input.libraryID <= 0) {
    bad("libraryID");
  }
  if (input.collectionKey.trim() === "") bad("collectionKey");
  if (input.mode === "edited-profile") {
    if (
      input.profile.id !==
      collectionProfileId(input.libraryID, input.collectionKey)
    ) {
      bad("profile");
    }
    if (
      !Number.isFinite(input.exploration) ||
      input.exploration < 0 ||
      input.exploration > 1
    ) {
      bad("exploration");
    }
  } else if (input.mode !== "profile-only") {
    bad("mode");
  }
  return { ok: errors.length === 0, errors };
}

/** The same test `P5-T12`'s lookup makes: blank is absent. */
function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

// ---------------------------------------------------------------------------
// The metadata fill-in: `related/generators.ts`' per-identifier cache, for survivors
// ---------------------------------------------------------------------------

/** One fill-in's working set. */
interface FillInRun {
  readonly ctx: PipelineContext;
  readonly cache: RelatedCacheDeps;
  readonly budget: RequestBudget;
  readonly call: SourceCallContext;
  readonly lookupSemanticScholar: RecommendPipelineDeps["semanticscholar"]["lookupKeyed"];
  /** What this run's lookups answered, so a failing cache does not ask twice. */
  readonly answered: Map<string, readonly SourceRecord[]>;
  readonly sent: Set<string>;
  readonly unsent: Set<string>;
}

function lookupEntry(
  sourceId: SourceId,
  ids: Partial<ExternalIds>,
): Partial<ExternalIds> | undefined {
  if (sourceId === SEMANTIC_SCHOLAR) {
    const asked = semanticScholarIdsOf(ids);
    return toSemanticScholarId(asked) === undefined ? undefined : asked;
  }
  if (!present(ids.doi)) return undefined;
  if (sourceId === CROSSREF && ARXIV_DATACITE_DOI.test(ids.doi)) {
    return undefined;
  }
  return { doi: ids.doi };
}

/** The id part of a cache key. A test holds it to what `runRelatedGenerators` writes. */
function cacheIdOf(
  sourceId: SourceId,
  asked: Partial<ExternalIds>,
): readonly string[] {
  if (sourceId !== SEMANTIC_SCHOLAR) return identifierKeys(asked);
  const id = toSemanticScholarId(asked);
  return id === undefined ? [] : [id];
}

function metadataKey(
  sourceId: SourceId,
  asked: Partial<ExternalIds>,
): RelatedCacheKey {
  return { sourceId, ids: cacheIdOf(sourceId, asked) };
}

function withoutRaw(record: SourceRecord): SourceRecord {
  const { raw: _dropped, ...kept } = record;
  return kept;
}

/**
 * `lookup` behind `docs/05` §9.2's `metadata` lifetime: hits cost nothing, misses take what
 * budget is left, one no record answers is remembered as missing, and those past the budget
 * are counted. The same entries `runRelatedGenerators` reads and writes (`P5-T12`).
 *
 * @throws whatever `lookup` throws; nothing is remembered for that batch
 */
async function lookupThroughCache(
  run: FillInRun,
  source: LiteratureSource,
  wanted: readonly Partial<ExternalIds>[],
): Promise<readonly SourceRecord[]> {
  const { lookup } = source;
  if (lookup === undefined) return [];

  const records: SourceRecord[] = [];
  const misses = new Map<string, Partial<ExternalIds>>();
  for (const ids of wanted) {
    const asked = lookupEntry(source.id, ids);
    if (asked === undefined) continue;
    const id = `${source.id} ${cacheIdOf(source.id, asked).join(" ")}`;
    const known = run.answered.get(id);
    if (known !== undefined) {
      records.push(...known);
      continue;
    }
    const hit = await readRelated<readonly SourceRecord[]>(
      run.cache,
      "metadata",
      metadataKey(source.id, asked),
    );
    if (hit === undefined) misses.set(id, asked);
    else if (hit.outcome === "value") records.push(...hit.value);
  }

  const batch = LOOKUP_BATCH[source.id] ?? 1;
  const share = run.budget.takeUpTo(Math.ceil(misses.size / batch));
  const entries = [...misses];
  const toSend = entries.slice(0, share * batch);
  for (const [id] of entries.slice(toSend.length)) run.unsent.add(id);
  if (toSend.length === 0) return records;

  for (const [id] of toSend) run.sent.add(id);
  const toAsk = toSend.map(([, asked]) => asked);
  const answers = await (source.id === SEMANTIC_SCHOLAR
    ? run.lookupSemanticScholar(toAsk, run.call)
    : lookup.call(source, toAsk, run.call));
  for (const [id, asked] of toSend) {
    const keys = identifierKeys(asked);
    const matches = answers
      .filter((record) =>
        identifierKeys(record.work.ids).some((key) => keys.includes(key)),
      )
      .map(withoutRaw);
    const key = metadataKey(source.id, asked);
    const stored =
      matches.length === 0
        ? await writeRelatedMissing(run.cache, "metadata", key)
        : await writeRelated<readonly SourceRecord[]>(
            run.cache,
            "metadata",
            key,
            matches,
          );
    const value = stored.outcome === "value" ? stored.value : [];
    records.push(...value);
    run.answered.set(id, value);
  }
  return records;
}

/** What `sourceId`'s `lookup` is worth asking this work for (`docs/05` §6.1's note). */
function worthAsking(
  sourceId: SourceId,
  candidate: RecommendCandidate,
): boolean {
  if (!present(candidate.work.title)) return true;
  return sourceId === SEMANTIC_SCHOLAR && !present(candidate.work.abstract);
}

/** `discoveredVia`'s lists, each once, when a fill-in has joined two candidates. */
function distinctFindings(
  findings: readonly RecommendFinding[],
): readonly RecommendFinding[] {
  const seen = new Map<string, RecommendFinding>();
  for (const finding of findings) {
    const key = `${finding.sourceId} ${finding.strategy} ${String(finding.topicGroup)}`;
    if (!seen.has(key)) seen.set(key, finding);
  }
  return [...seen.values()];
}

/** {@link fillInSurvivors}' answer. */
interface FilledIn {
  readonly candidates: readonly RecommendCandidate[];
  readonly report: RecommendFillInReport;
  /** Present when a lookup's record changed the merge. */
  readonly merged?: DedupeMergeResult;
}

/**
 * `docs/07` §12.5's `FillingMetadata`, for `identifierFilters`' survivors only. Semantic
 * Scholar only with a key; Europe PMC and Crossref for a missing title; then the abstract
 * ladder. A record that joins no candidate is dropped, and so is a work still untitled.
 *
 * @throws OperationCancelledError when the token is cancelled
 */
async function fillInSurvivors(
  survivors: readonly RecommendCandidate[],
  options: {
    readonly budget: RequestBudget;
    readonly keyed: boolean;
    readonly lookupSemanticScholar: FillInRun["lookupSemanticScholar"];
    readonly progress: ProgressReporter;
  },
  ctx: PipelineContext,
): Promise<FilledIn> {
  const { keyed } = options;
  const run: FillInRun = {
    ctx,
    cache: relatedCacheDeps(ctx),
    budget: options.budget,
    call: { token: ctx.token },
    lookupSemanticScholar: options.lookupSemanticScholar,
    answered: new Map(),
    sent: new Set(),
    unsent: new Set(),
  };
  const records = new Map<string, SourceRecord>();
  const findings = new Map<string, readonly RecommendFinding[]>();
  for (const candidate of survivors) {
    for (const record of candidate.records) {
      records.set(record.id, record);
      findings.set(record.id, candidate.discoveredVia);
    }
  }

  let current = survivors;
  let merged: DedupeMergeResult | undefined;
  const failed: { sourceId: SourceId; code: string }[] = [];
  for (const sourceId of keyed
    ? [SEMANTIC_SCHOLAR, EUROPE_PMC, CROSSREF]
    : [EUROPE_PMC, CROSSREF]) {
    const source = ctx.sources.get(sourceId);
    if (source === undefined) continue;
    const wanted = current
      .filter((candidate) => worthAsking(sourceId, candidate))
      .map((candidate) => candidate.work.ids);
    try {
      const found = await lookupThroughCache(run, source, wanted);
      let changed = false;
      for (const record of found) {
        const held = records.get(record.id);
        if (
          held === undefined ||
          record.missingFields.length < held.missingFields.length
        ) {
          records.set(record.id, record);
          changed = true;
        }
      }
      if (changed) {
        merged = await dedupeAndMergeAsync(
          [...records.values()],
          ctx.clock.now(),
          { token: ctx.token },
        );
        current = merged.merged.flatMap((entry): RecommendCandidate[] => {
          const via = entry.records.flatMap(
            (record) => findings.get(record.id) ?? [],
          );
          return via.length === 0
            ? []
            : [{ ...entry, discoveredVia: distinctFindings(via) }];
        });
      }
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      failed.push({ sourceId, code: serialize(error).code });
    }
  }

  const cachedLookups: Pick<PipelineContext["sources"], "get"> = {
    get(id) {
      const source = ctx.sources.get(id);
      if (source?.lookup === undefined) return source;
      return {
        ...source,
        lookup: (ids) => lookupThroughCache(run, source, ids),
      };
    },
  };
  const backfill = await backfillAbstracts(
    current.map(({ work }) => work),
    {
      sources: cachedLookups,
      token: ctx.token,
      logger: ctx.logger,
      selected: ABSTRACT_BACKFILL_LADDER.filter(
        (id) => keyed || id !== SEMANTIC_SCHOLAR,
      ),
      now: () => ctx.clock.now(),
      progress: options.progress,
    },
  );

  const candidates: RecommendCandidate[] = [];
  let untitled = 0;
  current.forEach((candidate, index) => {
    const work = backfill.works[index] ?? candidate.work;
    if (!present(work.title)) untitled += 1;
    else candidates.push({ ...candidate, work });
  });
  return {
    candidates,
    ...(merged !== undefined && { merged }),
    report: {
      sent: run.sent.size,
      unsent: run.unsent.size,
      failed,
      untitled,
      backfill: backfill.report,
      warnings: backfill.warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// The references: from the cache only (`plan/00` §6 item 346(b))
// ---------------------------------------------------------------------------

/** The DOIs of a work's cached reference lists, or `undefined` when none is cached. */
async function cachedReferenceDois(
  cache: RelatedCacheDeps,
  ids: Partial<ExternalIds>,
): Promise<ReadonlySet<string> | undefined> {
  let dois: Set<string> | undefined;
  for (const definition of REFERENCE_GENERATORS) {
    const asked = definition.ask(ids);
    if (asked === undefined) continue;
    const hit = await readRelated<RelatedPage>(cache, definition.signal, {
      sourceId: definition.sourceId,
      ids: cacheIdOf(definition.sourceId, asked),
      params: { strategy: definition.strategy, limit: definition.limit },
    });
    if (hit?.outcome !== "value") continue;
    dois ??= new Set();
    for (const record of hit.value.records) {
      const doi = normalizeDoi(record.work.ids.doi);
      if (doi !== null) dois.add(doi);
    }
  }
  return dois;
}

/**
 * The survivors' lists first, and the members' only when a survivor has one, so the usual
 * run reads few (`docs/07` §12.5's note, item 11). Sends nothing.
 *
 * @returns what `coupling` reads, or `undefined` when no survivor's list is cached
 */
async function cachedReferences(
  survivors: readonly RecommendCandidate[],
  members: readonly CanonicalWork[],
  ctx: PipelineContext,
): Promise<RecommendReferences | undefined> {
  const cache = relatedCacheDeps(ctx);
  const ofCandidate = new Map<string, ReadonlySet<string>>();
  for (const { work } of survivors) {
    const dois = await cachedReferenceDois(cache, work.ids);
    if (dois !== undefined) ofCandidate.set(work.workKey, dois);
  }
  if (ofCandidate.size === 0) return undefined;
  const ofCollection = new Map<string, ReadonlySet<string>>();
  for (const work of members) {
    const dois = await cachedReferenceDois(cache, work.ids);
    if (dois !== undefined) ofCollection.set(work.workKey, dois);
  }
  return {
    ofCandidate: (workKey) => ofCandidate.get(workKey),
    ofCollection,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** What every ending reports, as the run has it so far. */
interface RunState {
  stageReached: RecommendStageKey;
  reporter: ProgressReporter | undefined;
  statuses: readonly RecommendGeneratorStatus[];
  egress: EgressLogEntry | undefined;
  /** A vector fetch found no key, though the probe found one. */
  keyGone: boolean;
}

/** What `ProfileCheck` read, for the rest of the run. */
interface RunWorld {
  readonly input: RecommendInput;
  readonly ctx: PipelineContext;
  readonly surface: RecommendSurface;
  readonly state: RunState;
  /** `readProfileCollection`'s items and name. */
  readonly collection: Awaited<ReturnType<RecommendLibrary["readCollection"]>>;
  readonly members: readonly CanonicalWork[];
  /** The one probe. */
  readonly keyed: boolean;
  /** Only with a key. */
  readonly vectorStore: EnsureEmbeddingsDeps["store"] | undefined;
  readonly profileStore:
    Pick<CollectionProfileStore, "get" | "put"> | undefined;
  readonly stored: CollectionProfile | undefined;
  /** Once per run, and not at all on a run that does not need it. */
  readonly libraryIndex: () => Promise<LibraryIndex>;
}

/** What the profile half of a run hands on. */
interface ProfileInHand {
  readonly profile: CollectionProfile;
  readonly built: boolean;
  /** For an edited-profile run. */
  readonly rebuilt: boolean;
  readonly vectorsIncomplete: boolean;
  readonly heuristicReason?: ProfileHeuristicReason;
  readonly warningId?: RecommendProfileResult["warningId"];
}

function addDrops(
  ...counts: readonly Readonly<Record<RecommendDropReason, number>>[]
): Readonly<Record<RecommendDropReason, number>> {
  const total: Record<RecommendDropReason, number> = {
    "in-collection": 0,
    dismissed: 0,
    "outside-window": 0,
    "published-version-owned": 0,
    "not-peer-reviewed": 0,
    "no-abstract": 0,
  };
  for (const count of counts) {
    for (const reason of Object.keys(total) as RecommendDropReason[]) {
      total[reason] += count[reason];
    }
  }
  return total;
}

function similarityReport(
  world: Pick<RunWorld, "keyed" | "vectorStore">,
  space: RecommendSimilarityReport["space"],
  vectors: EnsuredEmbeddings | undefined,
): RecommendSimilarityReport {
  if (vectors?.failure !== undefined) {
    return {
      space,
      notice: "fetch-failed",
      error: vectors.failure.toSerialized(),
    };
  }
  if (!world.keyed) return { space };
  if (world.vectorStore === undefined) return { space, notice: "no-store" };
  return vectors === undefined ? { space, notice: "no-vectors" } : { space };
}

/**
 * `docs/07` §4.5's pipeline over §12.5.
 *
 * @param deps - the Zotero reads, the typed adapters, the stores and the call's deps
 * @returns the pipeline, with `id` `"recommend"` and `resumable` `false`
 * @throws RangeError if {@link RECOMMEND_STAGES}' weights do not sum to 1
 */
export function createRecommendPipeline(
  deps: RecommendPipelineDeps,
): RecommendPipeline {
  const slices = new Map<string, StageSlice>(
    stageSlices(RECOMMEND_STAGES).map((slice) => [slice.stage.key, slice]),
  );

  /** §7.4's check between stages, then this stage's reporter and checkpoint. */
  async function enterStage(
    state: RunState,
    ctx: PipelineContext,
    key: RecommendStageKey,
  ): Promise<ProgressReporter> {
    ctx.token.throwIfCancelled();
    state.reporter?.done("succeeded");
    state.stageReached = key;
    const slice = slices.get(key) as StageSlice;
    state.reporter = ctx.progress.child(key, slice.from, slice.to);
    await ctx.checkpoint({ stage: key });
    return state.reporter;
  }

  function ending(state: RunState): {
    readonly stageReached: string;
    readonly egress?: EgressLogEntry;
  } {
    return {
      stageReached: state.stageReached,
      ...(state.egress !== undefined && { egress: state.egress }),
    };
  }

  function failed(
    state: RunState,
    error: RecommendFailed["error"],
    tooFewItems?: RecommendFailed["tooFewItems"],
  ): RecommendFailed {
    return {
      outcome: "failed",
      ...ending(state),
      statuses: state.statuses,
      error,
      ...(tooFewItems !== undefined && { tooFewItems }),
    };
  }

  /** A store that will not open is a run without it. */
  async function opened<T>(
    open: () => Promise<T | undefined>,
    which: string,
    ctx: Pick<PipelineContext, "logger">,
  ): Promise<T | undefined> {
    try {
      return await open();
    } catch (error) {
      ctx.logger.warn(`recommend: the ${which} store could not be opened`, {
        code: serialize(error).code,
      });
      return undefined;
    }
  }

  async function storedProfile(
    store: Pick<CollectionProfileStore, "get">,
    id: string,
    ctx: Pick<PipelineContext, "logger">,
  ): Promise<CollectionProfile | undefined> {
    try {
      return await store.get(id);
    } catch (error) {
      if (!(error instanceof ResearchHelperError)) throw error;
      ctx.logger.warn("recommend: the stored profile could not be read", {
        code: error.code,
      });
      return undefined;
    }
  }

  async function callDeps(): Promise<ProfileCallDeps> {
    return { ...deps.profileCall, prompts: await deps.profileCall.prompts() };
  }

  /**
   * Whether a stored heuristic profile could be better now (`docs/07` §12.5's note, item 2).
   * Plans only: sends nothing and asks nothing.
   */
  async function heuristicCanImprove(
    profile: CollectionProfile,
    world: Pick<RunWorld, "collection" | "ctx">,
  ): Promise<boolean> {
    if (profile.origin !== "heuristic") return false;
    try {
      const plan = await planProfileCall(
        { profile, items: world.collection.items },
        world.ctx,
        await callDeps(),
      );
      return plan.status === "ready" || plan.status === "cached";
    } catch (error) {
      if (error instanceof PolicyViolationError) return false;
      throw error;
    }
  }

  /** `docs/07` §12.5's `ProfileCheck`: the hash, the run's space, and item 2. */
  async function isFresh(
    held: CollectionProfile,
    world: Pick<RunWorld, "input" | "collection" | "ctx" | "vectorStore">,
  ): Promise<boolean> {
    const space = world.vectorStore === undefined ? undefined : "specter_v2";
    if (held.membershipHash !== membershipHash(world.collection.items)) {
      return false;
    }
    if (held.embeddingModel !== space) return false;
    return (
      world.input.mode === "edited-profile" ||
      !(await heuristicCanImprove(held, world))
    );
  }

  /** The vectors of `works`, protecting what the collection and the library hold. */
  async function vectorsFor(
    works: readonly CanonicalWork[],
    store: EnsureEmbeddingsDeps["store"],
    world: Pick<RunWorld, "ctx" | "state" | "members" | "libraryIndex">,
  ): Promise<EnsuredEmbeddings> {
    const { ctx, state } = world;
    const library = await world.libraryIndex();
    const owned = new Set(world.members.map(({ workKey }) => workKey));
    for (const work of works) {
      if (library.findExisting(work.ids, work.workKey) !== undefined) {
        owned.add(work.workKey);
      }
    }
    const ensured = await ensureEmbeddings(
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
    if (!ensured.keyed) state.keyGone = true;
    return ensured;
  }

  /** A store that refuses a profile warns; the run goes on with the one it has. */
  async function storing(
    write: () => Promise<CollectionProfile>,
    fallback: CollectionProfile,
    ctx: Pick<PipelineContext, "logger">,
  ): Promise<CollectionProfile> {
    try {
      return await write();
    } catch (error) {
      if (!(error instanceof ResearchHelperError)) throw error;
      ctx.logger.warn("recommend: the profile could not be stored", {
        code: error.code,
      });
      return fallback;
    }
  }

  /**
   * `runProfileCall`, with §12.5's pause at a spend ceiling: the stage stays pending,
   * "continue" raises the ceiling and calls again, and anything else is `Cancelled`. The
   * user who said yes is not asked the cost question a second time.
   */
  async function profileCallWithPauses(
    profile: CollectionProfile,
    world: Pick<RunWorld, "collection" | "ctx" | "surface" | "input" | "state">,
  ): Promise<ProfileCallOutcome> {
    const { ctx, surface } = world;
    const prompts: ProfileCallDeps = {
      ...(await callDeps()),
      logEgress: (entry) => noteEgress(entry, world),
    };
    let agreed = false;
    const once: ProfileCallSurface = {
      confirm: async (request) => {
        if (agreed)
          return { kind: "run", raise: undefined, dontAskAgain: false };
        const answer = await surface.confirm(request);
        agreed = answer.kind === "run";
        return answer;
      },
    };
    for (;;) {
      try {
        return await runProfileCall(
          { profile, items: world.collection.items },
          ctx,
          prompts,
          once,
        );
      } catch (error) {
        const stop = ceilingStopOf(error);
        const guard = isRunBudgetGuard(ctx.budget) ? ctx.budget : undefined;
        if (stop === undefined || guard === undefined) throw error;
        const raiseToUsd = suggestedLimitUsd(stop, undefined);
        const answer = await surface
          .ask({
            reason: "budget-stop",
            stop,
            remainingUsd: undefined,
            raiseToUsd,
            usage: guard.usage(),
          })
          .catch(() => "cancel" as const);
        if (answer !== "resume") {
          throw new OperationCancelledError({ kind: "user" });
        }
        guard.raiseLimit(stop.ceiling, raiseToUsd);
      }
    }
  }

  /** The log of a request about to go. A failure stops it, so the ending claims none. */
  async function noteEgress(
    egress: EgressLogEntry,
    world: Pick<RunWorld, "input" | "state">,
  ): Promise<void> {
    const { input, state } = world;
    if (deps.recordEgress !== undefined) {
      const { libraryID, collectionKey, mode } = input;
      await deps.recordEgress(
        withEgressLog({ libraryID, collectionKey, mode }, egress),
      );
    }
    state.egress = egress;
  }

  /**
   * §12.5's `BuildingStats` to `ApplyingStoredEdits`.
   *
   * @returns the profile, or `undefined` when the user declined the cost question
   */
  async function buildProfile(
    world: RunWorld,
  ): Promise<ProfileInHand | undefined> {
    const { input, ctx, state, collection, members, profileStore, stored } =
      world;
    const { libraryID, collectionKey } = input;

    await enterStage(state, ctx, "BuildingStats");
    const stats = buildProfileStats({
      libraryID,
      collectionKey,
      collection,
      librarySources: await deps.library.libraryTermSources(libraryID),
      nowEpochMs: ctx.clock.now(),
    });

    await enterStage(state, ctx, "Centroids");
    const ensured =
      world.vectorStore === undefined
        ? undefined
        : await vectorsFor(members, world.vectorStore, world);
    // `P5-T21`'s finding 3: a profile from some of the vectors is not worth keeping.
    const vectorsIncomplete =
      ensured !== undefined &&
      (ensured.failure !== undefined || ensured.notAsked.length > 0);
    const withTopics = withTopicsAndSeeds(stats, {
      works: members,
      addedAt: addedAtByWorkKey(collection.items),
      ...(ensured !== undefined && { vectors: ensured.vectors }),
      nowEpochMs: ctx.clock.now(),
      logger: ctx.logger,
    });

    await enterStage(state, ctx, "ProfileCall");
    const outcome = await profileCallWithPauses(withTopics, world);
    if (outcome.status === "declined") return undefined;

    await enterStage(state, ctx, "ApplyingStoredEdits");
    const edits =
      input.mode === "edited-profile" ? input.edits : stored?.userEdits;
    let profile: CollectionProfile =
      edits === undefined
        ? outcome.profile
        : { ...outcome.profile, userEdits: edits };
    if (profileStore !== undefined && !vectorsIncomplete) {
      const whole = profile;
      profile = await storing(
        () => persistProfile(profileStore, whole),
        whole,
        ctx,
      );
    } else if (
      profileStore !== undefined &&
      input.mode === "edited-profile" &&
      stored !== undefined
    ) {
      // Not this profile, but what the user said stays with the row that is there.
      const row = { ...stored, userEdits: input.edits };
      await storing(() => profileStore.put(row), row, ctx);
    }
    return {
      profile,
      built: true,
      rebuilt: true,
      vectorsIncomplete,
      ...(outcome.status === "heuristic" && {
        heuristicReason: outcome.reason,
        ...(outcome.warningId !== undefined && {
          warningId: outcome.warningId,
        }),
      }),
    };
  }

  /**
   * §12.5's profile half.
   *
   * @returns the profile, or `undefined` when the user declined the cost question
   */
  async function profileFor(
    world: RunWorld,
  ): Promise<ProfileInHand | undefined> {
    const { input, ctx, state, profileStore, stored } = world;
    // Item 5: with no store, what the user saw is what a rebuild would pay to replace.
    const held =
      input.mode === "edited-profile" && profileStore === undefined
        ? input.profile
        : stored;
    if (held === undefined || !(await isFresh(held, world))) {
      return buildProfile(world);
    }
    if (input.mode === "profile-only") {
      await enterStage(state, ctx, "ApplyingStoredEdits");
      return {
        profile: held,
        built: false,
        rebuilt: false,
        vectorsIncomplete: false,
      };
    }

    await enterStage(state, ctx, "StoringEdits");
    const edited = { ...held, userEdits: input.edits };
    return {
      profile:
        profileStore === undefined
          ? edited
          : await storing(() => profileStore.put(edited), edited, ctx),
      built: false,
      // Item 4: another row than the one on screen is something the user did not see.
      rebuilt:
        held.membershipHash !== input.profile.membershipHash ||
        held.builtAtEpochMs !== input.profile.builtAtEpochMs,
      vectorsIncomplete: false,
    };
  }

  /** §12.5's candidate half. */
  async function rowsFor(
    world: RunWorld,
    input: Extract<RecommendInput, { mode: "edited-profile" }>,
    made: ProfileInHand,
  ): Promise<RecommendRows | RecommendFailed> {
    const { ctx, state, collection, members, keyed, vectorStore } = world;
    const { profile } = made;
    const { libraryID } = input;

    const generating = await enterStage(state, ctx, "Generating");
    const budget = new RequestBudget(RECOMMEND_REQUEST_BUDGET);
    const window = recencyWindow(ctx.config.get("searchYears"), ctx.clock);
    const store = await opened(deps.recommendations, "recommendation", ctx);
    const generated = await runRecommendGenerators(
      {
        profile,
        negatives:
          store === undefined
            ? []
            : await recentNegatives(store, profile.id, ctx.logger),
        sourceIds: ctx.config
          .get("sources")
          .split(",")
          .map((id) => id.trim())
          .filter(isSourceId),
        dateFilter: window,
      },
      ctx,
      {
        hasSemanticScholarKey: () => Promise.resolve(keyed),
        adapters: {
          semanticScholar: deps.semanticscholar,
          pubmed: deps.pubmed,
        },
        pool: deps.pool,
        progress: generating,
        budget,
      },
    );
    state.statuses = generated.statuses;
    if (generated.state === "failed") {
      const generators = generated.statuses.map(({ generator }) => generator);
      return failed(state, {
        code: "SOURCE",
        messageKey: "rh-error-source",
        detail: `every recommend generator that ran failed: ${generators.join(", ")}`,
        retryable: true,
      });
    }

    await enterStage(state, ctx, "IdentifierFilters");
    const ownership = recommendOwnership({
      items: collection.items,
      knownWorkKeys: profile.knownWorkKeys,
      libraryIndex: await world.libraryIndex(),
      libraryItems: await deps.library.libraryItems(libraryID),
    });
    const dismissed =
      store === undefined
        ? {
            doi: new Set<string>(),
            pmid: new Set<string>(),
            arxiv: new Set<string>(),
            workKeys: new Set<string>(),
          }
        : await readDismissed(store, profile.id, ctx.logger);
    const filterInput = {
      ownership,
      dismissed,
      showDismissed: input.showDismissed,
      window,
      peerReviewedOnly: input.peerReviewedOnly,
    };
    const first = identifierFilters(generated.candidates, filterInput);

    const filling = await enterStage(state, ctx, "FillingMetadata");
    const filled = await fillInSurvivors(
      first.kept,
      {
        budget,
        keyed,
        lookupSemanticScholar: (ids, call) =>
          deps.semanticscholar.lookupKeyed(ids, call),
        progress: filling,
      },
      ctx,
    );

    let vectors: EnsuredEmbeddings | undefined;
    if (vectorStore !== undefined && profile.centroids.length > 0) {
      await enterStage(state, ctx, "FetchingVectors");
      vectors = await vectorsFor(
        [...members, ...filled.candidates.map(({ work }) => work)],
        vectorStore,
        world,
      );
    }

    await enterStage(state, ctx, "ContentFilters");
    const second = contentFilters(filled.candidates, filterInput);

    await enterStage(state, ctx, "Scoring");
    const references = await cachedReferences(second.kept, members, ctx);
    const scoreStart = ctx.clock.now();
    const scoring = await scoreRecommendations(second.kept, {
      profile,
      works: members,
      vectors: vectors?.vectors ?? new Map(),
      exploration: input.exploration,
      ownership,
      dismissed,
      ...(references !== undefined && { references }),
      nowEpochMs: scoreStart,
      token: ctx.token,
    });
    const scoreMs = ctx.clock.now() - scoreStart;

    await enterStage(state, ctx, "Diversifying");
    const rows = await diversify(scoring, { token: ctx.token });
    if (store !== undefined) {
      try {
        for (const { recommendation } of rows) {
          await store.put(recommendation);
        }
      } catch (error) {
        if (!(error instanceof ResearchHelperError)) throw error;
        ctx.logger.warn("recommend: the rows could not be stored", {
          code: error.code,
        });
      }
    }
    state.reporter?.done("succeeded");

    const dropped = addDrops(first.dropped, second.dropped);
    const couplingRows = rows.filter(
      ({ recommendation }) => recommendation.signals.coupling > 0,
    ).length;
    // `P5-T30` reads this line; `scoreMs` holds `lexicalSpace`'s build on the word space.
    ctx.logger.info("recommend: scored", {
      ...dropped,
      couplingRows,
      space: scoring.similaritySpace,
      scoreMs,
    });

    return {
      outcome: "succeeded",
      ending: "rows",
      ...ending(state),
      profile,
      profileRebuilt: made.rebuilt,
      vectorsIncomplete: made.vectorsIncomplete,
      ...(made.heuristicReason !== undefined && {
        heuristicReason: made.heuristicReason,
      }),
      ...(made.warningId !== undefined && { warningId: made.warningId }),
      rows,
      statuses: generated.statuses,
      keyNotice: !keyed || state.keyGone,
      similarity: similarityReport(world, scoring.similaritySpace, vectors),
      dropped,
      fillIn: filled.report,
      couplingRows,
      links: filled.merged?.links ?? generated.links,
      flags: filled.merged?.flags ?? generated.flags,
    };
  }

  async function runStages(
    input: RecommendInput,
    ctx: PipelineContext,
    surface: RecommendSurface,
    state: RunState,
  ): Promise<RecommendOutput> {
    await enterStage(state, ctx, "ProfileCheck");
    const { libraryID, collectionKey } = input;
    const read = await readProfileCollection(
      deps.library,
      libraryID,
      collectionKey,
    );
    if (read.kind === "too-few-items") {
      const { itemCount, minimum } = read;
      return failed(
        state,
        {
          code: "TOO_FEW_ITEMS",
          messageKey: "rh-error-recommend-too-few-items",
          detail: `the collection has ${String(itemCount)} regular items; the minimum is ${String(minimum)}`,
          retryable: false,
        },
        { itemCount, minimum },
      );
    }

    const keyed = await deps.semanticscholar
      .hasUsableApiKey()
      .catch(() => false);
    const profileStore = await opened(deps.profiles, "profile", ctx);
    let index: Promise<LibraryIndex> | undefined;
    const world: RunWorld = {
      input,
      ctx,
      surface,
      state,
      collection: read.collection,
      members: read.collection.items.map(({ work }) => work),
      keyed,
      vectorStore: keyed
        ? await opened(deps.embeddings, "vector", ctx)
        : undefined,
      profileStore,
      stored:
        profileStore === undefined
          ? undefined
          : await storedProfile(
              profileStore,
              collectionProfileId(libraryID, collectionKey),
              ctx,
            ),
      libraryIndex: () => (index ??= deps.library.libraryIndex(libraryID)),
    };

    const made = await profileFor(world);
    if (made === undefined) {
      return { outcome: "cancelled", ...ending(state) };
    }
    if (input.mode === "edited-profile") return rowsFor(world, input, made);

    state.reporter?.done("succeeded");
    return {
      outcome: "succeeded",
      ending: "profile",
      ...ending(state),
      profile: made.profile,
      built: made.built,
      vectorsIncomplete: made.vectorsIncomplete,
      ...(made.heuristicReason !== undefined && {
        heuristicReason: made.heuristicReason,
      }),
      ...(made.warningId !== undefined && { warningId: made.warningId }),
    };
  }

  /** The estimate's price of the profile call, when one is due. Sends nothing. */
  async function plannedCall(
    input: RecommendInput,
    ctx: PipelineContext,
    world: Pick<RunWorld, "collection">,
  ): Promise<PipelineEstimate | undefined> {
    const { libraryID, collectionKey } = input;
    const stats = buildProfileStats({
      libraryID,
      collectionKey,
      collection: world.collection,
      librarySources: await deps.library.libraryTermSources(libraryID),
      nowEpochMs: ctx.clock.now(),
    });
    let plan;
    try {
      plan = await planProfileCall(
        { profile: stats, items: world.collection.items },
        ctx,
        await callDeps(),
      );
    } catch (error) {
      if (error instanceof PolicyViolationError) return undefined;
      throw error;
    }
    if (plan.status !== "ready") return undefined;
    const { inputTokens, outputTokens, costUsd } = plan.estimate.selected;
    return {
      itemCount: world.collection.items.length,
      externalRequests: 1,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCostUsd: costUsd,
      estimatedDurationSeconds: 0,
      notesKeys: [],
    };
  }

  async function execute(
    input: RecommendInput,
    ctx: PipelineContext,
    surface: RecommendSurface,
  ): Promise<RecommendOutput> {
    const state: RunState = {
      stageReached: "ProfileCheck",
      reporter: undefined,
      statuses: [],
      egress: undefined,
      keyGone: false,
    };
    try {
      return await runStages(input, ctx, surface, state);
    } catch (caught) {
      if (caught instanceof OperationCancelledError) {
        return { outcome: "cancelled", ...ending(state) };
      }
      const error = serialize(caught);
      ctx.logger.warn("recommend: the run failed", {
        stage: state.stageReached,
        code: error.code,
      });
      return failed(state, error);
    }
  }

  return {
    id: "recommend",
    displayNameKey: RECOMMEND_DISPLAY_NAME_KEY,
    stages: RECOMMEND_STAGES,
    resumable: false,
    validate: validateRecommendInput,

    async estimate(input, ctx): Promise<PipelineEstimate> {
      const { libraryID, collectionKey } = input;
      const none: PipelineEstimate = {
        itemCount: 0,
        externalRequests: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        // `undefined`, not `0`: no priced call, as the search pipeline says.
        estimatedCostUsd: undefined,
        estimatedDurationSeconds: 0,
        notesKeys: [],
      };
      const read = await readProfileCollection(
        deps.library,
        libraryID,
        collectionKey,
      );
      if (read.kind === "too-few-items") {
        return { ...none, itemCount: read.itemCount };
      }
      const { collection } = read;
      const keyed = await deps.semanticscholar
        .hasUsableApiKey()
        .catch(() => false);
      const vectorStore = keyed
        ? await opened(deps.embeddings, "vector", ctx)
        : undefined;
      const profileStore = await opened(deps.profiles, "profile", ctx);
      const stored =
        profileStore === undefined
          ? undefined
          : await storedProfile(
              profileStore,
              collectionProfileId(libraryID, collectionKey),
              ctx,
            );
      const held =
        input.mode === "edited-profile" && profileStore === undefined
          ? input.profile
          : stored;
      const fresh =
        held !== undefined &&
        (await isFresh(held, { input, collection, ctx, vectorStore }));
      const call = fresh
        ? undefined
        : await plannedCall(input, ctx, { collection });
      const members = collection.items.length;
      return {
        ...none,
        ...call,
        itemCount: members,
        externalRequests:
          (call?.externalRequests ?? 0) +
          (input.mode === "edited-profile" ? RECOMMEND_REQUEST_BUDGET : 0) +
          // A fresh profile-only run asks for no vector at all.
          (vectorStore !== undefined &&
          (!fresh || input.mode === "edited-profile")
            ? Math.ceil(members / SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS)
            : 0),
      };
    },

    run: (input, ctx) => execute(input, ctx, HEADLESS_RECOMMEND_SURFACE),
    execute,

    async reject(profileId, workKey): Promise<boolean> {
      const store = await deps.recommendations();
      return store === undefined
        ? false
        : store.reject(recommendationId(profileId, workKey), deps.clock.now());
    },
  };
}
