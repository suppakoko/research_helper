/**
 * The recommendation generators: from a profile to the merged union, under one
 * request budget, every generator kept on the merged work (`plan/08` `P5-T23`).
 * `docs/05` §7.3's dated note holds this file's decisions and arithmetic; `docs/07`
 * §12.5's `Generating` note says what {@link RecommendGenerationResult.state} means.
 *
 * **Caller.** {@link runRecommendGenerators} is called by `recommendPipeline.ts`
 * (`P5-T25`), which constructs the run's `RequestBudget`, passes the typed
 * adapters and the key probe from `installServices`, the negatives from
 * `recentNegatives`, and hands the survivors to `P5-T24`. This file constructs a
 * `RequestBudget` only when none is passed, and every type it exports.
 *
 * **Order of a run.** Plan each generator in `GENERATOR_VALUE_ORDER` (cache, then
 * budget); only then send, concurrently across hosts and serially within one
 * (`docs/05` §9.4); merge the union. Everything goes cache → budget → limiter, and the
 * limiter is the adapters' `HttpClient` (`plan/08` §0.2 items 20 and 21).
 *
 * **Without a key nothing here asks Semantic Scholar** (`plan/08` §0.2 item 19):
 * generator (a) reads `no-key` before any request, (c) goes to Europe PMC, and (d)
 * leaves it off its source list.
 *
 * **Nothing is filled in or filtered here** (`docs/05` §9.1 item 2), and no sentence
 * is built: a status row is ids and codes, and its only prose is the adapters' own
 * `warnings`.
 */

import { OperationCancelledError, RateLimitError } from "../../core/errors";
import type { Semaphore } from "../../core/concurrency";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { ExternalIds, SourceId } from "../../model/ids";
import type { CollectionProfile, ProfileSeed } from "../../model/profile";
import type {
  RecommendationDiscovery,
  RecommendationStrategy,
} from "../../model/recommendation";
import type { SourceRecord } from "../../model/sourceRecord";
import { PUBMED_ELINK_MAX_SEEDS } from "../../sources/pubmed/elink";
import {
  EFETCH_MAX_IDS_PER_CALL,
  type PubmedSource,
} from "../../sources/pubmed/pubmedSource";
import { identifierKeys } from "../../sources/semanticscholar/recommendations";
import {
  toSemanticScholarId,
  type SemanticScholarSource,
} from "../../sources/semanticscholar/semanticscholarSource";
import { normalizeTitle } from "../../sources/shared/dedupe";
import type { RecencyWindow } from "../../sources/shared/recency";
import type {
  LiteratureSource,
  QueryNode,
  SourceCallContext,
  SourcePage,
} from "../../sources/types";
import { semanticScholarIdsOf } from "../related/generators";
import {
  dedupeAndMergeAsync,
  fanOut,
  serialize,
  type DedupeMergeResult,
  type MergedWork,
} from "../searchImport/stages";
import type { SearchImportFetchState } from "../searchImport/types";
import {
  cachedRelated,
  readRelated,
  relatedCacheDeps,
  writeRelated,
  type RelatedCacheDeps,
  type RelatedCacheKey,
  type RelatedOutcome,
  type RelatedSignalKind,
} from "../shared/relatedFetch";
import {
  GENERATOR_VALUE_ORDER,
  RequestBudget,
  type BudgetedGenerator,
} from "../shared/requestBudget";
import type { PipelineContext } from "../types";

import { rankedTerms } from "./profile";
import { MAX_NEGATIVES } from "./seeds";

/** `docs/05` §9.3's sketch. A starting value. */
export const RECOMMEND_REQUEST_BUDGET = 40;
/** What (d), (c) and arXiv leave for the metadata fill-in. A starting value. */
export const RECOMMEND_HYDRATION_RESERVE = 2;
/** `plan/08` §0.4 line 27. */
export const RECOMMEND_MAX_TOPIC_REQUESTS = 4;
/** (a), each request: `docs/05` §7.3's `limit=200`. */
export const RECOMMEND_LIMIT = 200;
/** (a), one batch, one POST and the retry a too-large answer can cost. */
export const RECOMMEND_REQUESTS_PER_TOPIC = 3;
/** (b), neighbours per seed; `P5-T12`'s figure, so the two share cache entries. */
export const RECOMMEND_SIMILAR_LIMIT = 100;
/** (c): `docs/05` §7.3's "top 10 seeds". */
export const RECOMMEND_CITATION_SEEDS = 10;
/** (c), citers per seed; `P5-T12`'s figure, so the two share cache entries. */
export const RECOMMEND_CITATION_LIMIT = 100;
/** (d). `suggestedQueries` has no `maxItems`. A starting value. */
export const RECOMMEND_MAX_KEYWORD_QUERIES = 3;
/** (d): `docs/05` §7.3's "top 5 profile terms". */
export const RECOMMEND_KEYWORD_TERMS = 5;
/** (d), records per source per query. A starting value. */
export const RECOMMEND_KEYWORD_LIMIT = 50;
/** (e): `plan/08` `P5-T23` step 1. */
export const RECOMMEND_WATCH_AUTHORS = 5;
/** (e): `plan/08` `P5-T23` step 1. */
export const RECOMMEND_WATCH_DAYS = 90;
/** (e): inside `docs/05` §7.3's 50–200. A starting value. */
export const RECOMMEND_WATCH_LIMIT = 100;

const DAY_MS = 864e5;
const SEMANTIC_SCHOLAR: SourceId = "semanticscholar";
const EUROPE_PMC: SourceId = "europepmc";
const PUBMED: SourceId = "pubmed";
const ARXIV: SourceId = "arxiv";

/** A source's requests per keyword query, when not 1. `esearch`, then `efetch`. */
const KEYWORD_REQUESTS: Readonly<Partial<Record<SourceId, number>>> = {
  [PUBMED]: 2,
};

type SeedIds = Partial<ExternalIds>;

/**
 * What became of one generator:
 *   - `answered`: everything it asked answered, live or cached, possibly empty.
 *   - `partial`: some answered, and some failed or ran past the budget.
 *   - `no-key`: Semantic Scholar without a key. Nothing was sent; not a failure.
 *   - `not-indexed`: the source does not hold what it was asked (a 404).
 *   - `could-not-ask`: it had nothing to ask with, or an empty page with a warning
 *     came back. Never cached (`plan/00` §6 item 332(c)).
 *   - `rate-limited`: a `RateLimitError` after the client's retries.
 *   - `over-budget`: the budget did not reach it; nothing was sent.
 *   - `failed`: anything else, with its code.
 */
export type RecommendGeneratorState =
  | "answered"
  | "partial"
  | "no-key"
  | "not-indexed"
  | "could-not-ask"
  | "rate-limited"
  | "over-budget"
  | "failed";

/** One row per generator. Read by `P5-T25` and `P5-T26`. */
export interface RecommendGeneratorStatus {
  readonly generator: RecommendationStrategy;
  readonly state: RecommendGeneratorState;
  /** The sources it asked or meant to ask, each once, in spending order. */
  readonly sourceIds: readonly SourceId[];
  /** Records it returned, before the merge. */
  readonly records: number;
  /** Requests or seeds the cache answered. */
  readonly fromCache: number;
  /** Requests or seeds the budget did not reach. */
  readonly overBudget: number;
  /** The adapters' own warnings. */
  readonly warnings: readonly string[];
  /** The first `SerializedError.code` among its failures. */
  readonly errorCode?: string;
}

/** One list that found a work. `RecommendationDiscovery` plus (a)'s topic group. */
export interface RecommendFinding extends RecommendationDiscovery {
  /** The topic group whose request found it, only on (a)'s, only when k > 1. */
  readonly topicGroup?: number;
}

/** A merged work and every list that found it. */
export interface RecommendCandidate extends MergedWork {
  /** One per list, so a seed count can be read off it. Never empty. */
  readonly discoveredVia: readonly RecommendFinding[];
}

/** What {@link runRecommendGenerators} hands `recommendPipeline.ts`. */
export interface RecommendGenerationResult {
  /** In spending order, so the best generator's records lead. */
  readonly candidates: readonly RecommendCandidate[];
  /** One row per generator, in `docs/05` §7.3's order, (a) to (e). */
  readonly statuses: readonly RecommendGeneratorStatus[];
  /** Which edge leaves `docs/07` §12.5's `Generating`. */
  readonly state: SearchImportFetchState;
  /** Whether the run had a Semantic Scholar key, read once at its start. */
  readonly hadKey: boolean;
  readonly links: DedupeMergeResult["links"];
  readonly flags: DedupeMergeResult["flags"];
}

/** What the keyword queries read from a profile. */
export type RecommendKeywordProfile = Pick<
  CollectionProfile,
  "termWeights" | "suggestedQueries" | "origin" | "userEdits"
>;

/** What the run reads from a profile. */
export type RecommendGeneratorProfile = RecommendKeywordProfile &
  Pick<CollectionProfile, "seeds" | "centroids" | "topAuthors">;

/** One run's request. */
export interface RecommendGeneratorInput {
  readonly profile: RecommendGeneratorProfile;
  /** `recentNegatives`' answer, newest first. */
  readonly negatives: readonly SeedIds[];
  /** The `sources` preference's members, resolved by the caller. */
  readonly sourceIds: readonly SourceId[];
  /** `recencyWindow(searchYears, clock)`, resolved by the caller. */
  readonly dateFilter: RecencyWindow;
}

/** What the run reads from its job. `PipelineContext` satisfies it. */
export type RecommendGeneratorContext = Pick<
  PipelineContext,
  "sources" | "cache" | "config" | "logger" | "clock" | "token"
>;

/** The two adapter-specific calls, as the typed instances from `installServices`. */
export interface RecommendGeneratorAdapters {
  readonly semanticScholar: Pick<
    SemanticScholarSource,
    "rateLimitKey" | "recommend" | "findRelated"
  >;
  readonly pubmed: Pick<PubmedSource, "rateLimitKey" | "findSimilarForSeeds">;
}

/** What the caller supplies beside the input and the context. */
export interface RecommendGeneratorOptions {
  /**
   * `SemanticScholarSource.hasUsableApiKey`, the same read a keyed call makes (`plan/00`
   * §6 item 339(b)). It matters most for (d), whose search path sends without a key.
   * Read once; a probe that fails counts as no key.
   */
  readonly hasSemanticScholarKey: () => Promise<boolean>;
  readonly adapters: RecommendGeneratorAdapters;
  /** `docs/07` §7.2's `network-metadata` pool, for `fanOut`. */
  readonly pool: Semaphore;
  /** The stage's reporter, for `fanOut`. */
  readonly progress: ProgressReporter;
  /** Defaults to a new one of {@link RECOMMEND_REQUEST_BUDGET}. */
  readonly budget?: RequestBudget;
}

/** One ask's end. A failed keyword source can still have records. */
interface Settled {
  readonly state: Exclude<RecommendGeneratorState, "partial">;
  readonly records: readonly SourceRecord[];
  readonly fromCache: boolean;
  readonly warnings: readonly string[];
  readonly errorCode?: string;
}

/** One thing a generator asks, in spending order. */
interface Slot {
  readonly finding: RecommendFinding;
  settled?: Settled;
}

interface QueuedAsk {
  readonly slot: Slot;
  readonly send: () => Promise<Settled>;
}

interface Run {
  readonly input: RecommendGeneratorInput;
  readonly ctx: RecommendGeneratorContext;
  readonly options: RecommendGeneratorOptions;
  readonly cache: RelatedCacheDeps;
  readonly budget: RequestBudget;
  readonly call: SourceCallContext;
  readonly hasKey: boolean;
  readonly slots: Slot[];
  readonly queues: Map<string, QueuedAsk[]>;
}

/** What is worth caching and keeping of an answer. A `RelatedPage` satisfies it. */
type Found = Pick<SourcePage, "records" | "warnings">;

/** An empty page with a warning: thrown so that `cachedRelated` stores nothing. */
class CouldNotAsk extends Error {
  constructor(readonly warnings: readonly string[]) {
    super("could not ask");
  }
}

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function withoutRaw(record: SourceRecord): SourceRecord {
  const { raw: _dropped, ...kept } = record;
  return kept;
}

function foundWithoutRaw<T extends Found>(page: T): T {
  return { ...page, records: page.records.map(withoutRaw) };
}

function emptyWithWarning(page: Found): boolean {
  return page.records.length === 0 && page.warnings.length > 0;
}

function plainly(state: Settled["state"], warnings: readonly string[] = []) {
  return { state, records: [], fromCache: false, warnings } satisfies Settled;
}

function settledFrom(answer: RelatedOutcome<Found>): Settled {
  if (answer.outcome === "missing") {
    return { ...plainly("not-indexed"), fromCache: answer.fromCache };
  }
  return {
    state: "answered",
    records: answer.value.records,
    fromCache: answer.fromCache,
    warnings: answer.value.warnings,
  };
}

const RATE_LIMIT_CODE = new RateLimitError(429, undefined, "").code;

function failure(code: string, records: readonly SourceRecord[] = []): Settled {
  return {
    state: code === RATE_LIMIT_CODE ? "rate-limited" : "failed",
    records,
    fromCache: false,
    warnings: [],
    errorCode: code,
  };
}

/** A thrown error as an ask's end. A cancellation goes on up. */
function settledFromThrow(error: unknown): Settled {
  if (error instanceof OperationCancelledError) throw error;
  if (error instanceof CouldNotAsk) {
    return plainly("could-not-ask", error.warnings);
  }
  return failure(serialize(error).code);
}

function addSlot(run: Run, finding: RecommendFinding, settled?: Settled): Slot {
  const slot: Slot = { finding, ...(settled !== undefined && { settled }) };
  run.slots.push(slot);
  return slot;
}

function enqueue(run: Run, host: string, ask: QueuedAsk): void {
  const queue = run.queues.get(host) ?? [];
  queue.push(ask);
  run.queues.set(host, queue);
}

/**
 * The common path: cache, then budget, then a request on `host`'s queue.
 *
 * @param afford - takes the request's budget, or answers `false`
 * @param send - sends it; an empty page with a warning is not cached
 */
async function planAsk(
  run: Run,
  finding: RecommendFinding,
  signal: RelatedSignalKind,
  key: RelatedCacheKey,
  host: string,
  afford: () => boolean,
  send: () => Promise<Found>,
): Promise<void> {
  const hit = await readRelated<Found>(run.cache, signal, key);
  if (hit !== undefined) {
    addSlot(run, finding, settledFrom(hit));
    return;
  }
  if (!afford()) {
    addSlot(run, finding, plainly("over-budget"));
    return;
  }
  enqueue(run, host, {
    slot: addSlot(run, finding),
    send: async () => {
      try {
        const answer = await cachedRelated(run.cache, signal, key, async () => {
          const page = await send();
          if (emptyWithWarning(page)) throw new CouldNotAsk(page.warnings);
          return foundWithoutRaw(page);
        });
        return settledFrom(answer);
      } catch (error) {
        return settledFromThrow(error);
      }
    },
  });
}

function leavingReserve(run: Run, cost: number): boolean {
  return (
    run.budget.remaining - cost >= RECOMMEND_HYDRATION_RESERVE &&
    run.budget.tryTake(cost)
  );
}

function askSemanticScholar(ids: SeedIds): SeedIds | undefined {
  const asked = semanticScholarIdsOf(ids);
  return toSemanticScholarId(asked) === undefined ? undefined : asked;
}

/** `docs/02` §4.7's order: PMID, PMCID, or a DOI the adapter must look up first. */
function askEuropePmc(ids: SeedIds): SeedIds | undefined {
  if (present(ids.pmid)) return { pmid: ids.pmid };
  if (present(ids.pmcid)) return { pmcid: ids.pmcid };
  return present(ids.doi) ? { doi: ids.doi } : undefined;
}

function semanticScholarKeyIds(asked: readonly SeedIds[]): readonly string[] {
  return asked.flatMap((ids) => toSemanticScholarId(ids) ?? []);
}

// ---------------------------------------------------------------------------
// (a) Semantic Scholar's recommender, one request per topic group
// ---------------------------------------------------------------------------

interface TopicGroup {
  readonly topicGroup?: number;
  readonly seeds: readonly ProfileSeed[];
}

/** One group of every seed at k ≤ 1; else one per `topicIndex`, lowest first. */
function topicGroupsOf(
  profile: RecommendGeneratorProfile,
): readonly TopicGroup[] {
  if (profile.centroids.length <= 1) return [{ seeds: profile.seeds }];
  const groups = new Map<number, ProfileSeed[]>();
  for (const seed of profile.seeds) {
    if (seed.topicIndex === undefined) continue;
    groups.set(seed.topicIndex, [...(groups.get(seed.topicIndex) ?? []), seed]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, RECOMMEND_MAX_TOPIC_REQUESTS)
    .map(([topicGroup, seeds]) => ({ topicGroup, seeds }));
}

async function planRecommendations(run: Run): Promise<void> {
  const finding: RecommendFinding = {
    strategy: "recommendations",
    sourceId: SEMANTIC_SCHOLAR,
  };
  if (!run.hasKey) {
    addSlot(run, finding, plainly("no-key"));
    return;
  }
  const { semanticScholar } = run.options.adapters;
  const negatives = run.input.negatives
    .slice(0, MAX_NEGATIVES)
    .flatMap((ids) => askSemanticScholar(ids) ?? []);
  for (const group of topicGroupsOf(run.input.profile)) {
    const grouped: RecommendFinding =
      group.topicGroup === undefined
        ? finding
        : { ...finding, topicGroup: group.topicGroup };
    const positives = group.seeds.flatMap(
      (seed) => askSemanticScholar(seed.ids) ?? [],
    );
    if (positives.length === 0) {
      addSlot(run, grouped, plainly("could-not-ask"));
      continue;
    }
    await planAsk(
      run,
      grouped,
      "s2-recommendations",
      {
        sourceId: SEMANTIC_SCHOLAR,
        ids: semanticScholarKeyIds(positives),
        negativeIds: semanticScholarKeyIds(negatives),
        params: { limit: RECOMMEND_LIMIT },
      },
      semanticScholar.rateLimitKey,
      () => run.budget.tryTake(RECOMMEND_REQUESTS_PER_TOPIC),
      () =>
        semanticScholar.recommend(
          positives,
          negatives,
          RECOMMEND_LIMIT,
          run.call,
        ),
    );
  }
}

// ---------------------------------------------------------------------------
// (b) PubMed's similar articles, one `elink` over at most 10 seeds
// ---------------------------------------------------------------------------

function similarKey(pmid: string): RelatedCacheKey {
  return {
    sourceId: PUBMED,
    ids: identifierKeys({ pmid } as SeedIds),
    params: { strategy: "similar", limit: RECOMMEND_SIMILAR_LIMIT },
  };
}

/** `elink`, and one `efetch` per 200 neighbours `seeds` seeds could list. */
function similarRequests(seeds: number): number {
  return (
    1 + Math.ceil((seeds * RECOMMEND_SIMILAR_LIMIT) / EFETCH_MAX_IDS_PER_CALL)
  );
}

async function planSimilar(run: Run): Promise<void> {
  const finding: RecommendFinding = { strategy: "similar", sourceId: PUBMED };
  const pmids = [
    ...new Set(run.input.profile.seeds.flatMap((seed) => seed.ids.pmid ?? [])),
  ]
    .filter(present)
    .slice(0, PUBMED_ELINK_MAX_SEEDS);

  const misses: string[] = [];
  for (const pmid of pmids) {
    const hit = await readRelated<Found>(run.cache, "pmra", similarKey(pmid));
    if (hit === undefined) misses.push(pmid);
    else addSlot(run, finding, settledFrom(hit));
  }

  const affordable = Math.floor(
    (Math.max(run.budget.remaining - 1, 0) * EFETCH_MAX_IDS_PER_CALL) /
      RECOMMEND_SIMILAR_LIMIT,
  );
  const asked = misses.slice(0, affordable);
  misses.slice(affordable).forEach(() => {
    addSlot(run, finding, plainly("over-budget"));
  });
  if (asked.length === 0) return;
  run.budget.tryTake(similarRequests(asked.length));

  const { pubmed } = run.options.adapters;
  enqueue(run, pubmed.rateLimitKey, {
    slot: addSlot(run, finding),
    send: async () => {
      try {
        const pages = await pubmed.findSimilarForSeeds(
          asked,
          { limit: RECOMMEND_SIMILAR_LIMIT },
          run.call,
        );
        const records: SourceRecord[] = [];
        for (const page of pages) {
          if (emptyWithWarning(page)) continue;
          // One request over several seeds: each seed's own entry (`relatedFetch.ts`).
          const stored = await writeRelated(
            run.cache,
            "pmra",
            similarKey(page.seedPmid),
            foundWithoutRaw(page),
          );
          if (stored.outcome === "value") records.push(...stored.value.records);
        }
        const warnings = pages.flatMap((page) => page.warnings);
        return records.length === 0 && warnings.length > 0
          ? plainly("could-not-ask", warnings)
          : { state: "answered", records, fromCache: false, warnings };
      } catch (error) {
        return settledFromThrow(error);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// (c) Forward citations of the top seeds
// ---------------------------------------------------------------------------

async function planForwardCitations(run: Run): Promise<void> {
  const sourceId = run.hasKey ? SEMANTIC_SCHOLAR : EUROPE_PMC;
  const finding: RecommendFinding = { strategy: "forward-citations", sourceId };
  const source = run.hasKey
    ? run.options.adapters.semanticScholar
    : run.ctx.sources.get(EUROPE_PMC);
  const findRelated = source?.findRelated;
  if (source === undefined || findRelated === undefined) {
    addSlot(run, finding, plainly("could-not-ask"));
    return;
  }
  const seeds = run.input.profile.seeds
    .flatMap(
      (seed) =>
        (run.hasKey ? askSemanticScholar(seed.ids) : askEuropePmc(seed.ids)) ??
        [],
    )
    .slice(0, RECOMMEND_CITATION_SEEDS);
  for (const asked of seeds) {
    await planAsk(
      run,
      finding,
      "citations",
      {
        sourceId,
        ids: run.hasKey
          ? semanticScholarKeyIds([asked])
          : identifierKeys(asked),
        params: { strategy: "citations", limit: RECOMMEND_CITATION_LIMIT },
      },
      source.rateLimitKey,
      // A Europe PMC call with a DOI alone looks the seed up first (`P5-T07`).
      () =>
        leavingReserve(
          run,
          run.hasKey || present(asked.pmid) || present(asked.pmcid) ? 1 : 2,
        ),
      () =>
        findRelated.call(
          source,
          {
            ids: asked,
            limit: RECOMMEND_CITATION_LIMIT,
            strategy: "citations",
          },
          run.call,
        ),
    );
  }
}

// ---------------------------------------------------------------------------
// (d) Keyword search, one source and one query at a time through `fanOut`
// ---------------------------------------------------------------------------

function quotedAnyOf(terms: readonly string[]): string {
  return terms
    .map((term) => `"${term.replace(/"/gu, " ").trim()}"`)
    .join(" OR ");
}

function holdsWholeWords(query: string, removed: ReadonlySet<string>): boolean {
  const words = ` ${normalizeTitle(query)} `;
  return [...removed].some((term) => words.includes(` ${term} `));
}

/**
 * The run's keyword queries, as `parseUserQuery` reads them: `docs/05` §7.3's note,
 * item 7. Also what `P5-T26`'s notice can show as what is sent.
 *
 * @param profile - the profile, with any `userEdits`
 * @returns at most {@link RECOMMEND_MAX_KEYWORD_QUERIES} queries; none when the
 *   profile has no term at all
 */
export function recommendKeywordQueries(
  profile: RecommendKeywordProfile,
): readonly string[] {
  const removed = new Set(
    (profile.userEdits?.removedTerms ?? []).map(normalizeTitle),
  );
  const kept = (term: string) => !removed.has(normalizeTitle(term));
  const added = (profile.userEdits?.addedTerms ?? []).filter(
    (term) => term.trim() !== "" && kept(term),
  );

  const suggested =
    profile.origin === "llm"
      ? profile.suggestedQueries.filter(
          (query) => !holdsWholeWords(query, removed),
        )
      : [];
  if (suggested.length > 0) {
    return [
      ...(added.length > 0 ? [quotedAnyOf(added)] : []),
      ...suggested,
    ].slice(0, RECOMMEND_MAX_KEYWORD_QUERIES);
  }

  const distinct = new Map<string, string>();
  for (const term of [
    ...added,
    ...rankedTerms(profile.termWeights)
      .map(([term]) => term)
      .filter(kept),
  ]) {
    const key = normalizeTitle(term);
    if (!distinct.has(key)) distinct.set(key, term);
  }
  const top = [...distinct.values()].slice(0, RECOMMEND_KEYWORD_TERMS);
  return top.length === 0 ? [] : [quotedAnyOf(top)];
}

/** One keyword request, through `fanOut`; `P5-T23`'s note says why one at a time. */
async function sendKeyword(
  run: Run,
  source: LiteratureSource,
  query: string,
  key: RelatedCacheKey,
  slot: Slot,
): Promise<Settled> {
  // A slice of the stage per request, so the bar does not start over at each.
  const index = run.slots.indexOf(slot);
  const result = await fanOut({
    sources: [source],
    input: {
      query,
      limit: RECOMMEND_KEYWORD_LIMIT,
      dateFilter: run.input.dateFilter,
    },
    token: run.ctx.token,
    clock: run.ctx.clock,
    progress: run.options.progress.child(
      source.id,
      index / run.slots.length,
      (index + 1) / run.slots.length,
    ),
    logger: run.ctx.logger,
    pool: run.options.pool,
  });
  const records = result.records.map(withoutRaw);
  const warnings = result.perSource.flatMap((report) => report.warnings);
  const error = result.perSource.find(
    (report) => report.error !== undefined,
  )?.error;
  if (error !== undefined) {
    return { ...failure(error.code, records), warnings };
  }
  const found: Found = { records, warnings };
  if (emptyWithWarning(found)) return plainly("could-not-ask", warnings);
  return settledFrom(
    await writeRelated<Found>(run.cache, "keyword-search", key, found),
  );
}

async function planKeyword(run: Run, wantArxiv: boolean): Promise<void> {
  const { fromDate, toDate } = run.input.dateFilter;
  const ids = run.input.sourceIds.filter(
    (id) =>
      id !== "openalex" &&
      (run.hasKey || id !== SEMANTIC_SCHOLAR) &&
      (id === ARXIV) === wantArxiv,
  );
  for (const query of recommendKeywordQueries(run.input.profile)) {
    for (const sourceId of ids) {
      const finding: RecommendFinding = {
        strategy: "keyword-search",
        sourceId,
      };
      const source = run.ctx.sources.get(sourceId);
      if (source === undefined) {
        addSlot(run, finding, plainly("could-not-ask"));
        continue;
      }
      if (!source.capabilities.keywordSearch) continue;

      const key: RelatedCacheKey = {
        sourceId,
        ids: [],
        params: {
          query,
          limit: RECOMMEND_KEYWORD_LIMIT,
          fromDate,
          toDate,
        },
      };
      const hit = await readRelated<Found>(run.cache, "keyword-search", key);
      if (hit !== undefined) {
        addSlot(run, finding, settledFrom(hit));
        continue;
      }
      if (!leavingReserve(run, KEYWORD_REQUESTS[sourceId] ?? 1)) {
        addSlot(run, finding, plainly("over-budget"));
        continue;
      }
      const slot = addSlot(run, finding);
      enqueue(run, source.rateLimitKey, {
        slot,
        send: () => sendKeyword(run, source, query, key, slot),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// (e) The frequent-author watch: one Europe PMC query
// ---------------------------------------------------------------------------

function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

async function planAuthorWatch(run: Run): Promise<void> {
  const finding: RecommendFinding = {
    strategy: "author-watch",
    sourceId: EUROPE_PMC,
  };
  const authors = run.input.profile.topAuthors
    .slice(0, RECOMMEND_WATCH_AUTHORS)
    .map((author) => author.name);
  const source = run.ctx.sources.get(EUROPE_PMC);
  if (source === undefined || authors.length === 0) {
    addSlot(run, finding, plainly("could-not-ask"));
    return;
  }
  const now = run.ctx.clock.now();
  const fromDate = isoDay(now - RECOMMEND_WATCH_DAYS * DAY_MS);
  const toDate = isoDay(now);
  // Built, not parsed, so a name cannot change the query's shape.
  const terms: QueryNode = {
    kind: "or",
    children: authors.map((value) => ({
      kind: "term",
      field: "author",
      phrase: true,
      value,
    })),
  };
  await planAsk(
    run,
    finding,
    "keyword-search",
    {
      sourceId: EUROPE_PMC,
      ids: [],
      params: {
        authors: authors.join("\n"),
        limit: RECOMMEND_WATCH_LIMIT,
        fromDate,
        toDate,
      },
    },
    source.rateLimitKey,
    () => run.budget.tryTake(1),
    () =>
      source.search(
        { terms, limit: RECOMMEND_WATCH_LIMIT, fromDate, toDate },
        run.call,
      ),
  );
}

// ---------------------------------------------------------------------------
// Sending, the union, the rows
// ---------------------------------------------------------------------------

const PLANNERS: Readonly<
  Record<BudgetedGenerator, (run: Run) => Promise<void>>
> = {
  "s2-recommendations": planRecommendations,
  pmra: planSimilar,
  "author-watch": planAuthorWatch,
  "keyword-search": (run) => planKeyword(run, false),
  "forward-citations": planForwardCitations,
  "keyword-arxiv": (run) => planKeyword(run, true),
};

/**
 * One host's requests, in order. After a `RateLimitError` the rest are not sent:
 * the client's retries are spent, and `docs/05` §9.5 warns against firing what
 * is queued behind it.
 */
async function drainQueue(
  run: Run,
  queue: readonly QueuedAsk[],
): Promise<void> {
  let limited = false;
  for (const { slot, send } of queue) {
    run.ctx.token.throwIfCancelled();
    slot.settled = limited ? plainly("rate-limited") : await send();
    limited = slot.settled.state === "rate-limited";
  }
}

async function sendAll(run: Run): Promise<void> {
  const settled = await Promise.allSettled(
    [...run.queues.values()].map((queue) => drainQueue(run, queue)),
  );
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason as Error;
  }
}

/** The union, one record per `SourceRecord.id`, and who found each id. */
function unionOf(slots: readonly Slot[]): {
  readonly records: Map<string, SourceRecord>;
  readonly findings: Map<string, RecommendFinding[]>;
} {
  const records = new Map<string, SourceRecord>();
  const findings = new Map<string, RecommendFinding[]>();
  for (const { finding, settled } of slots) {
    for (const record of settled?.records ?? []) {
      const held = records.get(record.id);
      if (
        held === undefined ||
        record.missingFields.length < held.missingFields.length
      ) {
        records.set(record.id, record);
      }
      findings.set(record.id, [...(findings.get(record.id) ?? []), finding]);
    }
  }
  return { records, findings };
}

/** When nothing answered, the row says the strongest reason, in this order. */
const STATE_ORDER: readonly Settled["state"][] = [
  "no-key",
  "failed",
  "rate-limited",
  "over-budget",
  "not-indexed",
  "could-not-ask",
];

const TROUBLED: ReadonlySet<Settled["state"]> = new Set([
  "failed",
  "rate-limited",
  "over-budget",
]);

/** `docs/05` §7.3's order, (a) to (e). */
const ROW_ORDER: readonly RecommendationStrategy[] = [
  "recommendations",
  "similar",
  "forward-citations",
  "keyword-search",
  "author-watch",
];

function rowOf(
  generator: RecommendationStrategy,
  slots: readonly Slot[],
): RecommendGeneratorStatus {
  const own = slots.filter((slot) => slot.finding.strategy === generator);
  const settled = own.flatMap((slot) => slot.settled ?? []);
  const has = (state: Settled["state"]) =>
    settled.some((one) => one.state === state);
  const errorCode = settled.find(
    (one) => one.errorCode !== undefined,
  )?.errorCode;
  return {
    generator,
    state: has("answered")
      ? settled.some((one) => TROUBLED.has(one.state))
        ? "partial"
        : "answered"
      : (STATE_ORDER.find(has) ?? "could-not-ask"),
    sourceIds: [...new Set(own.map((slot) => slot.finding.sourceId))],
    records: settled.reduce((sum, one) => sum + one.records.length, 0),
    fromCache: settled.filter((one) => one.fromCache).length,
    overBudget: settled.filter((one) => one.state === "over-budget").length,
    warnings: settled.flatMap((one) => one.warnings),
    ...(errorCode !== undefined && { errorCode }),
  };
}

/** `docs/07` §12.5's three edges out of `Generating`. */
function generationState(
  rows: readonly RecommendGeneratorStatus[],
): SearchImportFetchState {
  const failed = (row: RecommendGeneratorStatus) =>
    row.state === "failed" || row.state === "rate-limited";
  const ran = rows.filter(
    (row) =>
      row.state !== "no-key" &&
      row.state !== "over-budget" &&
      row.state !== "could-not-ask",
  );
  if (
    ran.length > 0 &&
    ran.every(failed) &&
    rows.every((row) => row.records === 0)
  ) {
    return "failed";
  }
  return rows.some(
    (row) =>
      failed(row) ||
      row.state === "partial" ||
      row.state === "no-key" ||
      row.state === "over-budget",
  )
    ? "partial"
    : "succeeded";
}

/**
 * Run the generators for one profile and return the merged union.
 *
 * @param input - the profile, the negatives, the sources and the window
 * @param ctx - the job's context
 * @param options - the key probe, the typed adapters, the pool, the reporter, and
 *   optionally the budget
 * @returns the candidates and a status row per generator; a failed generator is a
 *   row, never a rejection
 * @throws OperationCancelledError when the token is cancelled; nothing is written but
 *   cache entries
 */
export async function runRecommendGenerators(
  input: RecommendGeneratorInput,
  ctx: RecommendGeneratorContext,
  options: RecommendGeneratorOptions,
): Promise<RecommendGenerationResult> {
  ctx.token.throwIfCancelled();
  const run: Run = {
    input,
    ctx,
    options,
    cache: relatedCacheDeps(ctx),
    budget: options.budget ?? new RequestBudget(RECOMMEND_REQUEST_BUDGET),
    call: { token: ctx.token },
    hasKey: await options.hasSemanticScholarKey().catch(() => false),
    slots: [],
    queues: new Map(),
  };

  for (const generator of GENERATOR_VALUE_ORDER) {
    await PLANNERS[generator](run);
  }
  await sendAll(run);

  const { records, findings } = unionOf(run.slots);
  const merged = await dedupeAndMergeAsync(
    [...records.values()],
    ctx.clock.now(),
    {
      token: ctx.token,
    },
  );
  const statuses = ROW_ORDER.map((generator) => rowOf(generator, run.slots));
  return {
    candidates: merged.merged.map((entry) => ({
      ...entry,
      discoveredVia: entry.records.flatMap(
        (record) => findings.get(record.id) ?? [],
      ),
    })),
    statuses,
    state: generationState(statuses),
    hadKey: run.hasKey,
    links: merged.links,
    flags: merged.flags,
  };
}
