/**
 * The related-paper generators: from a resolved seed to merged, hydrated
 * candidates that each keep every edge that found them (`plan/08` `P5-T12`).
 * `docs/05` §6.1's dated note holds this file's decisions and the one measurement
 * it could not make; `docs/07` §12.2's note names what it returns.
 *
 * **Caller.** {@link runRelatedGenerators} is called by `relatedPipeline.ts`
 * (`P5-T14`), which passes the job's `PipelineContext`, the seed `resolveSeed`
 * gave (`P5-T11`) and the key probe `installServices` hands in. This file
 * constructs {@link RequestBudget} (one per run, unless the caller passes its own)
 * and every type it exports.
 *
 * **Order of a run.** Expand the seed; plan each generator in
 * {@link RELATED_GENERATORS}' order (cache, then budget), so a short budget goes to
 * the best generators however fast each host answers; run them concurrently across
 * hosts and serially within one (`docs/05` §9.4); merge the union; hydrate only what
 * the merged works lack; fill in abstracts. Everything goes cache → budget → limiter,
 * and the limiter is the adapters' `HttpClient` (`plan/08` §0.2 items 20 and 21).
 *
 * **One call per named strategy, never `"auto"`.** `"auto"` hides a failed route in
 * a warning, and `cachedRelated` would then store the partial page.
 *
 * **Without a key nothing here asks Semantic Scholar** (`plan/08` §0.2 item 19): its
 * generators read `no-key` before any request, hydration leaves it out, and so does
 * `backfillAbstracts`' `selected`. **A probe can be wrong, so its records come through
 * {@link RelatedGeneratorOptions.lookupSemanticScholar}**, which sends nothing without
 * a key it can read (`plan/00` §6 item 339(b)). The registry's plain `lookup` is the
 * keyword window's and is never called for this source here.
 *
 * **No sentence is built here.** A status row is an id and a code for the window
 * to word (`P5-T16`). The only prose on a row is the adapter's own `warnings`.
 */

import { OperationCancelledError, RateLimitError } from "../../core/errors";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import {
  normalizeArxivId,
  type ExternalIds,
  type SourceId,
} from "../../model/ids";
import type { RelationEdge } from "../../model/related";
import type { SourceRecord } from "../../model/sourceRecord";
import { ARXIV_DOI_PREFIX } from "../../sources/arxiv/mapper";
import { EUROPEPMC_DOI_LOOKUP_BATCH } from "../../sources/europepmc/query";
import { identifierKeys } from "../../sources/semanticscholar/recommendations";
import { SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT } from "../../sources/semanticscholar/query";
import {
  ARXIV_DATACITE_DOI,
  toSemanticScholarId,
  type SemanticScholarSource,
} from "../../sources/semanticscholar/semanticscholarSource";
import type {
  LiteratureSource,
  RelatedPage,
  RelatedQuery,
  SourceCallContext,
} from "../../sources/types";
import {
  ABSTRACT_BACKFILL_LADDER,
  backfillAbstracts,
  type AbstractBackfillReport,
} from "../searchImport/backfill";
import {
  dedupeAndMergeAsync,
  serialize,
  type DedupeMergeResult,
  type MergedWork,
} from "../searchImport/stages";
import {
  cachedRelated,
  readRelated,
  relatedCacheDeps,
  writeRelated,
  writeRelatedMissing,
  type RelatedCacheDeps,
  type RelatedCacheKey,
  type RelatedOutcome,
  type RelatedSignalKind,
} from "../shared/relatedFetch";
import { RequestBudget } from "../shared/requestBudget";
import type { PipelineContext } from "../types";

/**
 * The most requests one run sends: the top of `docs/05` §6.1's 5–8.
 * **A starting value, not a measurement;** `P5-T30`'s live run can first test it.
 */
export const RELATED_REQUEST_BUDGET = 8;

/**
 * Of {@link RELATED_REQUEST_BUDGET}, what the first wave leaves for hydration and
 * the abstract fill-in: 200 works at about 100 identifiers a request. A starting
 * value too.
 */
export const RELATED_HYDRATION_RESERVE = 2;

const SEMANTIC_SCHOLAR: SourceId = "semanticscholar";
const EUROPE_PMC: SourceId = "europepmc";

/** One generator of `docs/05` §6.1, as its dated note lists them. */
export type RelatedGeneratorId =
  | "s2-recommendations"
  | "pmra"
  | "s2-citations"
  | "s2-references"
  | "europepmc-citations"
  | "europepmc-references"
  | "crossref-references";

type SeedIds = Partial<ExternalIds>;

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * `ids` as Semantic Scholar should be asked: a `10.48550/arXiv.*` DOI goes out as
 * the arXiv id alone (`plan/00` §6 item 337(c)), because `P2-T05` measured that
 * `/paper/batch` does not resolve such a DOI and a `DOI:` 404 would be remembered
 * as "not indexed" for 7 days. Any other `ids` is returned as it is. The ids-object
 * form of `toEmbeddingPaperId` (`P5-T20`), because `findRelated` and `lookup` read
 * `ExternalIds`, not a prefixed string; a test holds the two to one answer. Unlike that
 * function, it also reads the id out of the DOI when `arxivId` is absent, as on a
 * Crossref row.
 *
 * @param ids - a seed's or a work's identifiers
 * @returns what to pass as `RelatedQuery.ids` or to `lookup`
 */
export function semanticScholarIdsOf(ids: SeedIds): SeedIds {
  const { doi } = ids;
  if (doi === undefined || !ARXIV_DATACITE_DOI.test(doi)) return ids;
  const arxivId = present(ids.arxivId)
    ? ids.arxivId
    : normalizeArxivId(doi.slice(ARXIV_DOI_PREFIX.length));
  if (arxivId !== null) return { arxivId };
  const { doi: _unresolvable, ...rest } = ids;
  return rest;
}

function askSemanticScholar(ids: SeedIds): SeedIds | undefined {
  const asked = semanticScholarIdsOf(ids);
  return toSemanticScholarId(asked) === undefined ? undefined : asked;
}

function askPubmed(ids: SeedIds): SeedIds | undefined {
  return present(ids.pmid) ? { pmid: ids.pmid } : undefined;
}

/** `docs/02` §4.7's order: PMID, PMCID, or a DOI the adapter must look up first. */
function askEuropePmc(ids: SeedIds): SeedIds | undefined {
  if (present(ids.pmid)) return { pmid: ids.pmid };
  if (present(ids.pmcid)) return { pmcid: ids.pmcid };
  return present(ids.doi) ? { doi: ids.doi } : undefined;
}

function askCrossref(ids: SeedIds): SeedIds | undefined {
  return present(ids.doi) ? { doi: ids.doi } : undefined;
}

function europePmcRequests(ids: SeedIds): number {
  return present(ids.pmid) || present(ids.pmcid) ? 1 : 2;
}

interface GeneratorDefinition {
  readonly id: RelatedGeneratorId;
  readonly sourceId: SourceId;
  readonly strategy: NonNullable<RelatedQuery["strategy"]>;
  readonly signal: RelatedSignalKind;
  /** The list length asked for. `docs/05` §6.1's, or 100 where it gives none. */
  readonly limit: number;
  /** The identifiers that go out, or `undefined` when the seed lacks them. */
  readonly ask: (ids: SeedIds) => SeedIds | undefined;
  /** What one call can send. */
  readonly requests: (ids: SeedIds) => number;
  /** The Semantic Scholar list this stands in for when that list fails. */
  readonly fallbackFor?: RelatedGeneratorId;
  /** What a fallback must leave behind: its records are useless unhydrated. */
  readonly leavesInFallback?: number;
}

/** The spending order: best value per request first, `docs/05` §9.3's order kept. */
export const RELATED_GENERATORS: readonly GeneratorDefinition[] = [
  {
    id: "s2-recommendations",
    sourceId: SEMANTIC_SCHOLAR,
    strategy: "recommendations",
    signal: "s2-recommendations",
    limit: 200,
    ask: askSemanticScholar,
    requests: () => 1,
  },
  {
    id: "pmra",
    sourceId: "pubmed",
    strategy: "similar",
    signal: "pmra",
    limit: 100,
    ask: askPubmed,
    // `elink`, and the one `efetch` that hydrates 100 neighbours in the adapter.
    requests: () => 2,
  },
  {
    id: "s2-citations",
    sourceId: SEMANTIC_SCHOLAR,
    strategy: "citations",
    signal: "citations",
    limit: 100,
    ask: askSemanticScholar,
    requests: () => 1,
  },
  {
    id: "s2-references",
    sourceId: SEMANTIC_SCHOLAR,
    strategy: "references",
    signal: "references",
    limit: 100,
    ask: askSemanticScholar,
    requests: () => 1,
  },
  {
    id: "europepmc-citations",
    sourceId: EUROPE_PMC,
    strategy: "citations",
    signal: "citations",
    limit: 100,
    ask: askEuropePmc,
    requests: europePmcRequests,
    fallbackFor: "s2-citations",
  },
  {
    id: "europepmc-references",
    sourceId: EUROPE_PMC,
    strategy: "references",
    signal: "references",
    limit: 100,
    ask: askEuropePmc,
    requests: europePmcRequests,
    fallbackFor: "s2-references",
  },
  {
    id: "crossref-references",
    sourceId: "crossref",
    strategy: "references",
    signal: "references",
    limit: 100,
    ask: askCrossref,
    requests: () => 1,
    fallbackFor: "s2-references",
    leavesInFallback: 1,
  },
];

/**
 * What became of one generator:
 *   - `answered`: a page, live or cached, possibly empty.
 *   - `no-key`: Semantic Scholar without a key. Nothing was sent, and this is not a
 *     failure (`docs/07` §12.2).
 *   - `not-indexed`: the source was asked, or remembers being asked, and does not
 *     hold the seed (a 404).
 *   - `could-not-ask`: the seed lacks the identifier this source needs, or an empty
 *     page with a warning came back. Never cached (`plan/00` §6 item 332(c)).
 *   - `rate-limited`: a `RateLimitError` after the client's retries.
 *   - `over-budget`: the run's budget did not reach it; nothing was sent.
 *   - `failed`: anything else, with its code.
 */
export type RelatedGeneratorState =
  | "answered"
  | "no-key"
  | "not-indexed"
  | "could-not-ask"
  | "rate-limited"
  | "over-budget"
  | "failed";

/** One per-source status row. Read by `P5-T14` and `P5-T16`. */
export interface RelatedGeneratorStatus {
  readonly generator: RelatedGeneratorId;
  readonly sourceId: SourceId;
  readonly state: RelatedGeneratorState;
  /** Records on the page, before the merge. */
  readonly records: number;
  readonly fromCache: boolean;
  /** The adapter's own warnings, on the page or on an empty answer. */
  readonly warnings: readonly string[];
  /** `SerializedError.code`, for `failed` and `rate-limited`. */
  readonly errorCode?: string;
}

/** One list that returned a work, for `P5-T13`'s terms and chips. */
export interface GeneratorEdge {
  readonly generator: RelatedGeneratorId;
  readonly sourceId: SourceId;
  /** The list length asked for: `docs/05` §6.2's `recScore` divides `rank` by it. */
  readonly limit: number;
  readonly edge: RelationEdge;
}

/** A merged work and every edge that found it. */
export interface RelatedCandidate extends MergedWork {
  /** One per list that returned the work, whichever record it came on. Never empty. */
  readonly edges: readonly GeneratorEdge[];
}

/** One source's hydration that failed; the run went on without it. */
export interface RelatedHydrationFailure {
  readonly sourceId: SourceId;
  readonly code: string;
}

/** What hydration and the abstract fill-in did. */
export interface RelatedHydrationReport {
  /** Distinct identifiers sent to a `lookup`, by the seed's expansion and the fill-in too. */
  readonly sent: number;
  /** Distinct identifiers the budget could not cover, and so were never sent. */
  readonly unsent: number;
  readonly failed: readonly RelatedHydrationFailure[];
  /** Works left out of the candidates because no source gave them a title. */
  readonly untitled: number;
  readonly backfill: AbstractBackfillReport;
  /** `backfillAbstracts`' own lines, one per failed step. */
  readonly warnings: readonly string[];
}

/** What {@link runRelatedGenerators} hands `relatedPipeline.ts`. */
export interface RelatedGenerationResult {
  /** In union order, so the best generator's records lead. */
  readonly candidates: readonly RelatedCandidate[];
  /** One row per generator, in {@link RELATED_GENERATORS}' order. */
  readonly statuses: readonly RelatedGeneratorStatus[];
  /** The seed's identifiers after expansion, for finding the seed among the rows. */
  readonly seedIds: SeedIds;
  /** Whether the run had a Semantic Scholar key, read once at its start. */
  readonly hadKey: boolean;
  readonly links: DedupeMergeResult["links"];
  readonly flags: DedupeMergeResult["flags"];
  readonly hydration: RelatedHydrationReport;
}

/** The seed as generators read it. `resolveSeed`'s identifiers (`P5-T11`). */
export interface RelatedGeneratorSeed {
  readonly ids: SeedIds;
}

/** What the run reads from its job. `PipelineContext` satisfies it. */
export type RelatedGeneratorContext = Pick<
  PipelineContext,
  "sources" | "cache" | "config" | "logger" | "clock" | "token"
>;

/** What the caller supplies beside the context. */
export interface RelatedGeneratorOptions {
  /**
   * `SemanticScholarSource.hasUsableApiKey`, from `installServices` (`P5-T14`). Read
   * once; a probe that fails counts as no key, so it can only send less. It must be the
   * same read as {@link lookupSemanticScholar}'s gate: a yes followed by that lookup's
   * empty answer would store a week of "missing" rows for works the service holds.
   */
  readonly hasSemanticScholarKey: () => Promise<boolean>;
  /**
   * `SemanticScholarSource.lookupKeyed`, for every Semantic Scholar record this run
   * reads. Required, so that a caller cannot fall back on the unkeyed `lookup`.
   */
  readonly lookupSemanticScholar: SemanticScholarSource["lookupKeyed"];
  /** Defaults to a new one of {@link RELATED_REQUEST_BUDGET}. */
  readonly budget?: RequestBudget;
  /** The stage's reporter, handed to `backfillAbstracts`. */
  readonly progress?: ProgressReporter;
}

/** Identifiers one `lookup` request carries; the adapters' own batch sizes. */
const LOOKUP_BATCH: Readonly<Partial<Record<SourceId, number>>> = {
  [EUROPE_PMC]: EUROPEPMC_DOI_LOOKUP_BATCH,
  [SEMANTIC_SCHOLAR]: SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT,
};

interface Run {
  readonly ctx: RelatedGeneratorContext;
  readonly cache: RelatedCacheDeps;
  readonly budget: RequestBudget;
  readonly call: SourceCallContext;
  readonly lookupSemanticScholar: RelatedGeneratorOptions["lookupSemanticScholar"];
  /**
   * What this run's `lookup`s already answered, so the fill-in does not re-ask
   * hydration's identifiers when the cache is off or failing.
   */
  readonly answered: Map<string, readonly SourceRecord[]>;
  readonly sent: Set<string>;
  readonly unsent: Set<string>;
}

function isCancellation(error: unknown): boolean {
  return error instanceof OperationCancelledError;
}

/** `plan/08` `P5-T12` note (4): `raw` must not sit in the cache for 90 days. */
function withoutRaw(record: SourceRecord): SourceRecord {
  const { raw: _dropped, ...kept } = record;
  return kept;
}

function pageWithoutRaw(page: RelatedPage): RelatedPage {
  return { ...page, records: page.records.map(withoutRaw) };
}

// ---------------------------------------------------------------------------
// One per-identifier metadata cache, for hydration and the abstract fill-in
// ---------------------------------------------------------------------------

/** The identifiers to send: Europe PMC reads a DOI only (`lookupById: ["doi"]`). */
function lookupEntry(sourceId: SourceId, ids: SeedIds): SeedIds | undefined {
  if (sourceId === SEMANTIC_SCHOLAR) return askSemanticScholar(ids);
  return present(ids.doi) ? { doi: ids.doi } : undefined;
}

function cacheIdOf(sourceId: SourceId, asked: SeedIds): readonly string[] {
  if (sourceId !== SEMANTIC_SCHOLAR) return identifierKeys(asked);
  const id = toSemanticScholarId(asked);
  return id === undefined ? [] : [id];
}

/**
 * `lookup` with `docs/05` §9.2's `metadata` lifetime per identifier: hits cost
 * nothing, misses take what budget is left, and one that no record answers is
 * remembered as missing for 7 days. Identifiers past the budget are counted, not
 * sent, so a run degrades by hydrating fewer works.
 *
 * @throws whatever `lookup` throws; nothing is remembered for that batch
 */
async function lookupThroughCache(
  run: Run,
  source: LiteratureSource,
  wanted: readonly SeedIds[],
): Promise<readonly SourceRecord[]> {
  const { lookup } = source;
  if (lookup === undefined) return [];

  const records: SourceRecord[] = [];
  const misses = new Map<string, SeedIds>();
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

function metadataKey(sourceId: SourceId, asked: SeedIds): RelatedCacheKey {
  return { sourceId, ids: cacheIdOf(sourceId, asked) };
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

interface ExpandedSeed {
  readonly ids: SeedIds;
  /** Europe PMC was asked and has no route to this seed; no call can help. */
  readonly europePmcHasNoRoute: boolean;
}

/**
 * A DOI-only seed gets its PMID and PMCID from one Europe PMC `lookup`, so similar
 * articles can run and Europe PMC's two calls need not each look it up (`plan/08`
 * `P5-T07`). A failed lookup or an empty budget changes nothing.
 */
async function expandSeed(run: Run, ids: SeedIds): Promise<ExpandedSeed> {
  const unchanged = { ids, europePmcHasNoRoute: false };
  if (!present(ids.doi) || present(ids.pmid) || present(ids.pmcid)) {
    return unchanged;
  }
  const source = run.ctx.sources.get(EUROPE_PMC);
  if (source?.lookup === undefined) return unchanged;

  let records: readonly SourceRecord[];
  try {
    records = await lookupThroughCache(run, source, [{ doi: ids.doi }]);
  } catch (error) {
    if (isCancellation(error)) throw error;
    run.ctx.logger.warn("related: the seed could not be expanded", {
      code: serialize(error).code,
    });
    return unchanged;
  }
  if (run.unsent.size > 0) return unchanged;

  const pmid = records.find((r) => present(r.work.ids.pmid))?.work.ids.pmid;
  const pmcid = records.find((r) => present(r.work.ids.pmcid))?.work.ids.pmcid;
  if (pmid === undefined && pmcid === undefined) {
    return { ids, europePmcHasNoRoute: true };
  }
  return {
    ids: {
      ...ids,
      ...(pmid !== undefined && { pmid }),
      ...(pmcid !== undefined && { pmcid }),
    },
    europePmcHasNoRoute: false,
  };
}

// ---------------------------------------------------------------------------
// The generators
// ---------------------------------------------------------------------------

/** One generator's result: its row, and the page when it has one. */
interface GeneratorOutcome {
  readonly status: RelatedGeneratorStatus;
  readonly page?: RelatedPage;
}

type Outcomes = Map<RelatedGeneratorId, GeneratorOutcome>;

/** An empty page with a warning: thrown so that `cachedRelated` stores nothing. */
class CouldNotAsk extends Error {
  constructor(readonly warnings: readonly string[]) {
    super("could not ask");
  }
}

function rowOf(
  definition: GeneratorDefinition,
  state: RelatedGeneratorState,
  extra: Partial<
    Pick<
      RelatedGeneratorStatus,
      "records" | "fromCache" | "warnings" | "errorCode"
    >
  > = {},
): GeneratorOutcome {
  return {
    status: {
      generator: definition.id,
      sourceId: definition.sourceId,
      state,
      records: 0,
      fromCache: false,
      warnings: [],
      ...extra,
    },
  };
}

function outcomeOfAnswer(
  definition: GeneratorDefinition,
  answer: RelatedOutcome<RelatedPage>,
): GeneratorOutcome {
  if (answer.outcome === "missing") {
    return rowOf(definition, "not-indexed", { fromCache: answer.fromCache });
  }
  return {
    ...rowOf(definition, "answered", {
      records: answer.value.records.length,
      fromCache: answer.fromCache,
      warnings: answer.value.warnings,
    }),
    page: answer.value,
  };
}

function cacheKeyOf(
  definition: GeneratorDefinition,
  asked: SeedIds,
): RelatedCacheKey {
  return {
    sourceId: definition.sourceId,
    ids: cacheIdOf(definition.sourceId, asked),
    params: { strategy: definition.strategy, limit: definition.limit },
  };
}

/** A generator that needs a request, and what that request takes. */
interface PendingRequest {
  readonly source: LiteratureSource;
  readonly findRelated: NonNullable<LiteratureSource["findRelated"]>;
  readonly asked: SeedIds;
}

/** A generator's answer when it can have one without a request, or its request. */
async function planGenerator(
  run: Run,
  definition: GeneratorDefinition,
  seed: ExpandedSeed,
  hasKey: boolean,
): Promise<GeneratorOutcome | PendingRequest> {
  if (definition.sourceId === SEMANTIC_SCHOLAR && !hasKey) {
    return rowOf(definition, "no-key");
  }
  const source = run.ctx.sources.get(definition.sourceId);
  const findRelated = source?.findRelated;
  if (source === undefined || findRelated === undefined) {
    return rowOf(definition, "could-not-ask");
  }
  if (definition.sourceId === EUROPE_PMC && seed.europePmcHasNoRoute) {
    return rowOf(definition, "not-indexed");
  }
  const asked = definition.ask(seed.ids);
  if (asked === undefined) return rowOf(definition, "could-not-ask");
  const hit = await readRelated<RelatedPage>(
    run.cache,
    definition.signal,
    cacheKeyOf(definition, asked),
  );
  if (hit !== undefined) return outcomeOfAnswer(definition, hit);
  return { source, findRelated, asked };
}

/**
 * One generator, its budget already taken. Only a cancellation rejects: every other
 * failure is this generator's status row (`docs/05` §9.1 item 4).
 */
async function ask(
  run: Run,
  definition: GeneratorDefinition,
  { source, findRelated, asked }: PendingRequest,
): Promise<GeneratorOutcome> {
  try {
    const answer = await cachedRelated(
      run.cache,
      definition.signal,
      cacheKeyOf(definition, asked),
      async () => {
        const page = await findRelated.call(
          source,
          {
            ids: asked,
            limit: definition.limit,
            strategy: definition.strategy,
          },
          run.call,
        );
        if (page.records.length === 0 && page.warnings.length > 0) {
          throw new CouldNotAsk(page.warnings);
        }
        return pageWithoutRaw(page);
      },
    );
    return outcomeOfAnswer(definition, answer);
  } catch (error) {
    if (isCancellation(error)) throw error;
    if (error instanceof CouldNotAsk) {
      return rowOf(definition, "could-not-ask", { warnings: error.warnings });
    }
    return rowOf(
      definition,
      error instanceof RateLimitError ? "rate-limited" : "failed",
      { errorCode: serialize(error).code },
    );
  }
}

/**
 * Plan `definitions` in order, then run what was planned: concurrently across hosts,
 * serially within one (`docs/05` §9.4). Planning finishes before the first request,
 * so the order decides who gets the budget, not which host answers first.
 *
 * @param leaves - what each generator must leave in the budget
 * @throws OperationCancelledError when the token is cancelled
 */
async function runWave(
  run: Run,
  definitions: readonly GeneratorDefinition[],
  seed: ExpandedSeed,
  hasKey: boolean,
  leaves: (definition: GeneratorDefinition) => number,
  outcomes: Outcomes,
): Promise<void> {
  const queues = new Map<string, (() => Promise<void>)[]>();
  for (const definition of definitions) {
    const plan = await planGenerator(run, definition, seed, hasKey);
    if ("status" in plan) {
      outcomes.set(definition.id, plan);
      continue;
    }
    const cost = definition.requests(seed.ids);
    if (
      run.budget.remaining - cost < leaves(definition) ||
      !run.budget.tryTake(cost)
    ) {
      outcomes.set(definition.id, rowOf(definition, "over-budget"));
      continue;
    }
    const host = plan.source.rateLimitKey;
    const queue = queues.get(host) ?? [];
    queue.push(async () => {
      run.ctx.token.throwIfCancelled();
      outcomes.set(definition.id, await ask(run, definition, plan));
    });
    queues.set(host, queue);
  }

  const settled = await Promise.allSettled(
    [...queues.values()].map(async (queue) => {
      for (const task of queue) await task();
    }),
  );
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason as Error;
  }
}

/**
 * The generators the first wave could not afford whose Semantic Scholar list did not
 * deliver: `docs/05` §6.1's "fallback if S2 429s" and §9.5's ladder. A run with no key
 * has none, since its first wave already planned them.
 */
function fallbacksOf(outcomes: Outcomes): readonly GeneratorDefinition[] {
  return RELATED_GENERATORS.filter((definition) => {
    if (outcomes.get(definition.id)?.status.state !== "over-budget") {
      return false;
    }
    if (definition.fallbackFor === undefined) return false;
    const primary = outcomes.get(definition.fallbackFor)?.status;
    if (primary === undefined || primary.state === "no-key") return false;
    return primary.records === 0;
  });
}

// ---------------------------------------------------------------------------
// Union, merge, hydration
// ---------------------------------------------------------------------------

/** The union, one record per `SourceRecord.id`, with a list of edges per id. */
interface Union {
  readonly records: Map<string, SourceRecord>;
  readonly edges: Map<string, GeneratorEdge[]>;
}

/**
 * Add `record`, keeping the fuller when its id is already there. Two calls to one
 * source can return one record (`plan/08` `P5-T12`'s first note), and the merge would
 * otherwise list its id twice in `provenance.recordIds`.
 */
function addRecord(union: Union, record: SourceRecord): void {
  const held = union.records.get(record.id);
  if (
    held === undefined ||
    record.missingFields.length < held.missingFields.length
  ) {
    union.records.set(record.id, record);
  }
}

function unionOf(outcomes: Outcomes): Union {
  const union: Union = { records: new Map(), edges: new Map() };
  for (const definition of RELATED_GENERATORS) {
    const page = outcomes.get(definition.id)?.page;
    page?.records.forEach((record, index) => {
      const edge = page.edges[index];
      if (edge === undefined) return;
      addRecord(union, record);
      const edges = union.edges.get(record.id) ?? [];
      edges.push({
        generator: definition.id,
        sourceId: definition.sourceId,
        limit: definition.limit,
        edge,
      });
      union.edges.set(record.id, edges);
    });
  }
  return union;
}

function mergeUnion(run: Run, union: Union): Promise<DedupeMergeResult> {
  return dedupeAndMergeAsync([...union.records.values()], run.ctx.clock.now(), {
    token: run.ctx.token,
  });
}

function edgesOf(union: Union, entry: MergedWork): readonly GeneratorEdge[] {
  return entry.records.flatMap((record) => union.edges.get(record.id) ?? []);
}

/** What `sourceId`'s `lookup` is worth asking this work for (`docs/05` §6.1's note). */
function worthAsking(sourceId: SourceId, entry: MergedWork): boolean {
  if (!present(entry.work.title)) return true;
  return sourceId === SEMANTIC_SCHOLAR && !present(entry.work.abstract);
}

/**
 * The fill-in's registry: each adapter's `lookup` behind {@link lookupThroughCache},
 * so what hydration already asked is not asked again.
 */
function cachedLookups(run: Run): Pick<PipelineContext["sources"], "get"> {
  return {
    get(id) {
      const source = run.ctx.sources.get(id);
      if (source?.lookup === undefined) return source;
      return {
        ...source,
        lookup: (ids) => lookupThroughCache(run, source, ids),
      };
    },
  };
}

/**
 * Run the generators for one seed and return the merged, hydrated candidates.
 *
 * @param seed - the resolved seed
 * @param ctx - the job's context
 * @param options - the key probe, and optionally the budget and the reporter
 * @returns the candidates, a status row per generator and what hydration did; a
 *   failed generator or hydration step is a row, never a rejection
 * @throws OperationCancelledError when the token is cancelled; nothing is written
 *   but cache entries
 */
export async function runRelatedGenerators(
  seed: RelatedGeneratorSeed,
  ctx: RelatedGeneratorContext,
  options: RelatedGeneratorOptions,
): Promise<RelatedGenerationResult> {
  ctx.token.throwIfCancelled();
  const run: Run = {
    ctx,
    cache: relatedCacheDeps(ctx),
    budget: options.budget ?? new RequestBudget(RELATED_REQUEST_BUDGET),
    call: { token: ctx.token },
    lookupSemanticScholar: options.lookupSemanticScholar,
    answered: new Map(),
    sent: new Set(),
    unsent: new Set(),
  };
  const hasKey = await options.hasSemanticScholarKey().catch(() => false);
  const expanded = await expandSeed(run, seed.ids);

  const outcomes: Outcomes = new Map();
  await runWave(
    run,
    RELATED_GENERATORS,
    expanded,
    hasKey,
    () => RELATED_HYDRATION_RESERVE,
    outcomes,
  );
  await runWave(
    run,
    fallbacksOf(outcomes),
    expanded,
    hasKey,
    (definition) => definition.leavesInFallback ?? 0,
    outcomes,
  );

  const union = unionOf(outcomes);
  let merged = await mergeUnion(run, union);

  const failed: RelatedHydrationFailure[] = [];
  for (const sourceId of hasKey
    ? [SEMANTIC_SCHOLAR, EUROPE_PMC]
    : [EUROPE_PMC]) {
    const source = ctx.sources.get(sourceId);
    if (source === undefined) continue;
    const wanted = merged.merged
      .filter((entry) => worthAsking(sourceId, entry))
      .map((entry) => entry.work.ids);
    try {
      const records = await lookupThroughCache(run, source, wanted);
      if (records.length > 0) {
        for (const record of records) addRecord(union, record);
        merged = await mergeUnion(run, union);
      }
    } catch (error) {
      if (isCancellation(error)) throw error;
      failed.push({ sourceId, code: serialize(error).code });
    }
  }

  // A record a `lookup` brought that joined no list's work is nobody's candidate.
  const found = merged.merged.filter(
    (entry) => edgesOf(union, entry).length > 0,
  );
  const backfill = await backfillAbstracts(
    found.map((entry) => entry.work),
    {
      sources: cachedLookups(run),
      token: ctx.token,
      logger: ctx.logger,
      selected: ABSTRACT_BACKFILL_LADDER.filter(
        (id) => hasKey || id !== SEMANTIC_SCHOLAR,
      ),
      now: () => ctx.clock.now(),
      ...(options.progress !== undefined && { progress: options.progress }),
    },
  );

  const candidates: RelatedCandidate[] = [];
  let untitled = 0;
  found.forEach((entry, index) => {
    const work = backfill.works[index] ?? entry.work;
    if (!present(work.title)) untitled += 1;
    else candidates.push({ ...entry, work, edges: edgesOf(union, entry) });
  });

  return {
    candidates,
    statuses: RELATED_GENERATORS.flatMap((definition) => {
      const status = outcomes.get(definition.id)?.status;
      return status === undefined ? [] : [status];
    }),
    seedIds: expanded.ids,
    hadKey: hasKey,
    links: merged.links,
    flags: merged.flags,
    hydration: {
      sent: run.sent.size,
      unsent: run.unsent.size,
      failed,
      untitled,
      backfill: backfill.report,
      warnings: backfill.warnings,
    },
  };
}
