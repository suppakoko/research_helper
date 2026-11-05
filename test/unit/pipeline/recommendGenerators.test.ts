/**
 * `P5-T23`: the recommendation generators, their budget and their union.
 *
 * Plain Node, no network. Most tests use hand-written stand-in adapters, because what
 * is under test is the run around them. The block "on the shipped adapters" runs the
 * real PubMed, Europe PMC and Crossref adapters over recorded bodies, with PubMed's
 * `efetch` stubbed; the Semantic Scholar adapter there is real too, and its transport
 * fails the test if it is asked anything. Semantic Scholar's own answers are never
 * replayed here: its fixtures are stand-ins until `P5-T31` (`plan/00` §6 item 335(a)),
 * so nothing below is evidence about that service.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { NO_CACHE, type Cache } from "../../../src/core/cache/cache";
import { createManualClock } from "../../../src/core/clock";
import { Semaphore } from "../../../src/core/concurrency";
import {
  BadRequestError,
  OperationCancelledError,
  RateLimitError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type {
  HttpClient,
  HttpOptions,
  HttpResponse,
} from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  CompositeProgressReporter,
  NULL_PROGRESS_SINK,
  type ProgressReporter,
} from "../../../src/core/jobQueue/progress";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import {
  CROSSREF_HOST,
  EBI_HOST,
  NCBI_HOST,
  SEMANTICSCHOLAR_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import type { ExternalIds, SourceId } from "../../../src/model/ids";
import type { ProfileSeed } from "../../../src/model/profile";
import type { RecommendationStrategy } from "../../../src/model/recommendation";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  RECOMMEND_CITATION_LIMIT,
  RECOMMEND_CITATION_SEEDS,
  RECOMMEND_HYDRATION_RESERVE,
  RECOMMEND_KEYWORD_LIMIT,
  RECOMMEND_KEYWORD_TERMS,
  RECOMMEND_LIMIT,
  RECOMMEND_MAX_KEYWORD_QUERIES,
  RECOMMEND_MAX_TOPIC_REQUESTS,
  RECOMMEND_REQUEST_BUDGET,
  RECOMMEND_REQUESTS_PER_TOPIC,
  RECOMMEND_SIMILAR_LIMIT,
  RECOMMEND_WATCH_AUTHORS,
  RECOMMEND_WATCH_DAYS,
  RECOMMEND_WATCH_LIMIT,
  recommendKeywordQueries,
  runRecommendGenerators,
  type RecommendGeneratorContext,
  type RecommendGeneratorInput,
  type RecommendGeneratorOptions,
  type RecommendGeneratorProfile,
  type RecommendGenerationResult,
  type RecommendGeneratorState,
} from "../../../src/pipeline/recommend/generators";
import { MAX_NEGATIVES } from "../../../src/pipeline/recommend/seeds";
import { relatedCacheKey } from "../../../src/pipeline/shared/relatedFetch";
import { RequestBudget } from "../../../src/pipeline/shared/requestBudget";
import { createCrossrefSource } from "../../../src/sources/crossref/crossrefSource";
import { createCrossrefRecordMapper } from "../../../src/sources/crossref/mapper";
import { createEuropePmcSource } from "../../../src/sources/europepmc/europepmcSource";
import { createEuropePmcRecordMapper } from "../../../src/sources/europepmc/mapper";
import { createPubmedSource } from "../../../src/sources/pubmed/pubmedSource";
import { createSourceRegistry } from "../../../src/sources/registry";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import { createSemanticScholarSource } from "../../../src/sources/semanticscholar/semanticscholarSource";
import { recencyWindow } from "../../../src/sources/shared/recency";
import type {
  LiteratureSource,
  RelatedPage,
  RelatedQuery,
  SourceQuery,
} from "../../../src/sources/types";
import { EUROPEPMC_RELATED_SEED_PMID } from "../../support/europepmcRecordedRequests";
import { PUBMED_ELINK_SEED_PMIDS } from "../../support/pubmedRecordedRequests";

const NOW = Date.UTC(2026, 10, 5, 12);
const WINDOW = recencyWindow(3, { now: () => NOW });
const ARXIV_HOST = "export.arxiv.org";

// ---------------------------------------------------------------------------
// Records and stand-in adapters
// ---------------------------------------------------------------------------

const TITLE_WORDS = [
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
  return `${TITLE_WORDS[n % TITLE_WORDS.length] ?? ""} study ${String(n)} ${String(n * 7919)}`;
}

function paper(
  sourceId: SourceId,
  n: number,
  extra: Partial<SourceRecord> = {},
): SourceRecord {
  return {
    id: `${sourceId}:n${String(n)}`,
    sourceId,
    nativeId: `n${String(n)}`,
    work: {
      ids: { doi: `10.1000/p${String(n)}` } as ExternalIds,
      type: "journal-article",
      title: titleOf(n),
      authors: [{ family: "Author" }],
    },
    retrievedAtEpochMs: NOW,
    missingFields: [],
    ...extra,
  };
}

function pageOf(
  records: readonly SourceRecord[],
  warnings: readonly string[] = [],
): RelatedPage {
  return {
    records,
    edges: records.map((_, index) => ({
      kind: "citation",
      rank: index + 1,
    })),
    totalAvailable: records.length,
    nextCursor: undefined,
    warnings,
  };
}

const HOST_OF: Readonly<Partial<Record<SourceId, string>>> = {
  semanticscholar: SEMANTICSCHOLAR_HOST,
  pubmed: NCBI_HOST,
  europepmc: EBI_HOST,
  crossref: CROSSREF_HOST,
  arxiv: ARXIV_HOST,
};

type KeywordAnswer = readonly SourceRecord[] | Error;

interface SearchStub {
  readonly source: LiteratureSource;
  /** Every `searchAll`, in order. */
  readonly searches: SourceQuery[];
  /** Every `search`, in order. */
  readonly direct: SourceQuery[];
  readonly findRelated: ReturnType<typeof vi.fn>;
}

/** A registered source, as `fanOut` and the registry read it. */
function searchStub(
  id: SourceId,
  options: {
    readonly keyword?: (query: SourceQuery) => KeywordAnswer;
    readonly warn?: string;
    readonly keywordSearch?: boolean;
    readonly related?: (query: RelatedQuery) => Promise<RelatedPage>;
    readonly direct?: () => Promise<RelatedPage>;
    readonly onSearch?: () => void;
  } = {},
): SearchStub {
  const searches: SourceQuery[] = [];
  const direct: SourceQuery[] = [];
  const findRelated = vi.fn(
    options.related ?? (() => Promise.resolve(pageOf([]))),
  );
  const source = {
    id,
    rateLimitKey: HOST_OF[id] ?? id,
    capabilities: {
      keywordSearch: options.keywordSearch ?? true,
      dateFilter: true,
    },
    explainQuery: () => "explained",
    findRelated,
    search: (query: SourceQuery) => {
      direct.push(query);
      return options.direct?.() ?? Promise.resolve(pageOf([]));
    },
    async *searchAll(
      query: SourceQuery,
      ctx: { progress?: ProgressReporter },
    ): AsyncGenerator<SourceRecord> {
      searches.push(query);
      options.onSearch?.();
      await Promise.resolve();
      if (options.warn !== undefined) ctx.progress?.warn(options.warn);
      const answer = options.keyword?.(query) ?? [];
      if (answer instanceof Error) throw answer;
      yield* answer;
    },
  } as unknown as LiteratureSource;
  return { source, searches, direct, findRelated };
}

function s2Stub(
  overrides: {
    readonly recommend?: () => Promise<RelatedPage>;
    readonly findRelated?: (query: RelatedQuery) => Promise<RelatedPage>;
  } = {},
) {
  return {
    rateLimitKey: SEMANTICSCHOLAR_HOST,
    recommend: vi.fn(
      overrides.recommend ??
        ((): Promise<RelatedPage> =>
          Promise.resolve(pageOf([paper("semanticscholar", 1)]))),
    ),
    findRelated: vi.fn(
      overrides.findRelated ??
        ((): Promise<RelatedPage> =>
          Promise.resolve(pageOf([paper("semanticscholar", 2)]))),
    ),
  };
}

function pubmedStub(
  answer?: (
    pmids: readonly string[],
  ) => Promise<readonly (RelatedPage & { seedPmid: string })[]>,
) {
  return {
    rateLimitKey: NCBI_HOST,
    findSimilarForSeeds: vi.fn(
      answer ??
        ((pmids: readonly string[]) =>
          Promise.resolve(
            pmids.map((seedPmid) => ({
              seedPmid,
              ...pageOf([paper("pubmed", 3)]),
            })),
          )),
    ),
  };
}

interface MemoryCache {
  readonly cache: Cache;
  readonly keys: string[];
  readonly values: unknown[];
}

function memoryCache(): MemoryCache {
  const held = new Map<string, unknown>();
  const keys: string[] = [];
  const values: unknown[] = [];
  return {
    keys,
    values,
    cache: {
      ...NO_CACHE,
      get: <T>(_namespace: string, key: string) =>
        Promise.resolve(held.get(key) as T | undefined),
      set: (_namespace, key, value) => {
        held.set(key, value);
        keys.push(key);
        values.push(value);
        return Promise.resolve();
      },
    },
  };
}

function seed(
  n: number,
  topicIndex?: number,
  extra: Partial<ExternalIds> = {},
): ProfileSeed {
  return {
    ids: {
      doi: `10.2000/s${String(n)}`,
      pmid: String(5000 + n),
      ...extra,
    } as ExternalIds,
    ...(topicIndex !== undefined && { topicIndex }),
  };
}

function seedsOf(count: number, topicIndex?: number): readonly ProfileSeed[] {
  return Array.from({ length: count }, (_, n) => seed(n, topicIndex));
}

const QUIET_PROFILE: RecommendGeneratorProfile = {
  seeds: [],
  centroids: [],
  topAuthors: [],
  termWeights: {},
  suggestedQueries: [],
  origin: "heuristic",
};

function profileWith(
  overrides: Partial<RecommendGeneratorProfile>,
): RecommendGeneratorProfile {
  return { ...QUIET_PROFILE, ...overrides };
}

function centroids(k: number): readonly (readonly number[])[] {
  return Array.from({ length: k }, () => [1, 0]);
}

function contextOf(
  sources: readonly (SearchStub | LiteratureSource)[],
  overrides: Partial<RecommendGeneratorContext> = {},
): RecommendGeneratorContext {
  const registry = createSourceRegistry();
  for (const entry of sources) {
    registry.register("source" in entry ? entry.source : entry);
  }
  const clock = createManualClock(NOW);
  return {
    sources: registry,
    cache: NO_CACHE,
    config: {
      get: (name: string) => name === "cacheEnabled",
    } as unknown as RecommendGeneratorContext["config"],
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    clock,
    token: createCancellationTokenSource().token,
    ...overrides,
  };
}

function reporter(): ProgressReporter {
  return new CompositeProgressReporter({
    clock: createManualClock(NOW),
    sinks: [NULL_PROGRESS_SINK],
  });
}

interface Setup {
  readonly profile?: RecommendGeneratorProfile;
  readonly negatives?: RecommendGeneratorInput["negatives"];
  readonly sourceIds?: readonly SourceId[];
  readonly sources?: readonly (SearchStub | LiteratureSource)[];
  readonly hasKey?: boolean | (() => Promise<boolean>);
  readonly s2?: ReturnType<typeof s2Stub>;
  readonly pubmed?: ReturnType<typeof pubmedStub>;
  readonly budget?: RequestBudget;
  readonly context?: Partial<RecommendGeneratorContext>;
  readonly progress?: ProgressReporter;
}

function run(setup: Setup = {}) {
  const s2 = setup.s2 ?? s2Stub();
  const pubmed = setup.pubmed ?? pubmedStub();
  const hasKey = setup.hasKey ?? true;
  const options: RecommendGeneratorOptions = {
    hasSemanticScholarKey:
      typeof hasKey === "function" ? hasKey : () => Promise.resolve(hasKey),
    adapters: {
      semanticScholar:
        s2 as unknown as RecommendGeneratorOptions["adapters"]["semanticScholar"],
      pubmed:
        pubmed as unknown as RecommendGeneratorOptions["adapters"]["pubmed"],
    },
    pool: new Semaphore(4),
    progress: setup.progress ?? reporter(),
    ...(setup.budget !== undefined && { budget: setup.budget }),
  };
  const result = runRecommendGenerators(
    {
      profile: setup.profile ?? QUIET_PROFILE,
      negatives: setup.negatives ?? [],
      sourceIds: setup.sourceIds ?? [],
      dateFilter: WINDOW,
    },
    contextOf(setup.sources ?? [], setup.context),
    options,
  );
  return { result, s2, pubmed };
}

function row(
  result: RecommendGenerationResult,
  generator: RecommendationStrategy,
) {
  const found = result.statuses.find((one) => one.generator === generator);
  if (found === undefined) throw new Error(`no row for ${generator}`);
  return found;
}

function stateOf(
  result: RecommendGenerationResult,
  generator: RecommendationStrategy,
): RecommendGeneratorState {
  return row(result, generator).state;
}

function strategiesOf(
  result: RecommendGenerationResult,
): readonly RecommendationStrategy[] {
  return [
    ...new Set(
      result.candidates.flatMap((candidate) =>
        candidate.discoveredVia.map((finding) => finding.strategy),
      ),
    ),
  ];
}

function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolveIt) => {
    settle = resolveIt;
  });
  return { promise, settle };
}

// ---------------------------------------------------------------------------
// Done when
// ---------------------------------------------------------------------------

describe("Done when", () => {
  it("a budget of 12 runs (a) and (b) fully and (c) for the seeds the budget allows", async () => {
    const budget = new RequestBudget(12);
    const { result, s2, pubmed } = run({
      budget,
      profile: profileWith({ seeds: seedsOf(15) }),
    });
    const done = await result;

    expect(s2.recommend).toHaveBeenCalledTimes(1);
    expect(s2.recommend.mock.calls[0]?.slice(0, 1)).toEqual([
      seedsOf(15).map((one) => one.ids),
    ]);
    // Every one of the ten seeds elink takes: 1 + 5 requests.
    expect(pubmed.findSimilarForSeeds.mock.calls[0]?.[0]).toHaveLength(10);
    // 12 − 3 − 6 = 3, and (c) leaves the reserve of 2.
    expect(s2.findRelated).toHaveBeenCalledTimes(1);
    expect(row(done, "forward-citations").overBudget).toBe(
      RECOMMEND_CITATION_SEEDS - 1,
    );
    expect(stateOf(done, "forward-citations")).toBe("partial");
    expect(done.state).toBe("partial");
    expect(budget.remaining).toBe(RECOMMEND_HYDRATION_RESERVE);
  });

  it("at a budget of 12, a two-topic profile still runs (a) and (b) fully, and (c) gets nothing", async () => {
    const budget = new RequestBudget(12);
    const { result, s2, pubmed } = run({
      budget,
      profile: profileWith({
        centroids: centroids(2),
        seeds: [...seedsOf(5, 0), seed(5, 1), seed(6, 1), seed(7, 1)].map(
          (one, index) => ({ ...one, ids: seed(index).ids }),
        ),
      }),
    });
    const done = await result;
    expect(s2.recommend).toHaveBeenCalledTimes(2);
    expect(pubmed.findSimilarForSeeds.mock.calls[0]?.[0]).toHaveLength(8);
    expect(s2.findRelated).not.toHaveBeenCalled();
    expect(stateOf(done, "forward-citations")).toBe("over-budget");
  });

  it("at a budget of 12, three topic groups leave (b) short: it degrades by seeds", async () => {
    const budget = new RequestBudget(12);
    const { result, s2, pubmed } = run({
      budget,
      profile: profileWith({
        centroids: centroids(3),
        seeds: [0, 1, 2].flatMap((topic) =>
          [0, 1, 2, 3].map((n) => seed(topic * 4 + n, topic)),
        ),
      }),
    });
    const done = await result;
    expect(s2.recommend).toHaveBeenCalledTimes(3);
    // 3 left: 1 elink + 2 efetch cover 4 seeds at limit 100.
    expect(pubmed.findSimilarForSeeds.mock.calls[0]?.[0]).toHaveLength(4);
    expect(row(done, "similar").overBudget).toBe(6);
    expect(budget.remaining).toBe(0);
  });

  it("at a budget of 12, (e) and (d) rank above (c), so (c) gets what they leave", async () => {
    const budget = new RequestBudget(12);
    const epmc = searchStub("europepmc", {
      keyword: () => [paper("europepmc", 40)],
    });
    const { result, s2 } = run({
      budget,
      sources: [epmc],
      sourceIds: ["europepmc"],
      profile: profileWith({
        seeds: seedsOf(15),
        topAuthors: [{ name: "Doudna J", count: 3 }],
        termWeights: { editing: 1 },
      }),
    });
    const done = await result;
    expect(epmc.direct).toHaveLength(1);
    // 12 − 3 − 6 − 1 = 2, all of it the reserve, so (d) and (c) send nothing.
    expect(epmc.searches).toHaveLength(0);
    expect(stateOf(done, "keyword-search")).toBe("over-budget");
    expect(s2.findRelated).not.toHaveBeenCalled();
    expect(budget.remaining).toBe(RECOMMEND_HYDRATION_RESERVE);
  });

  it("with every Semantic Scholar call refused, (b), (d) and (e) still return candidates", async () => {
    const refused = new BadRequestError(403, "refused", {});
    const s2 = s2Stub({
      recommend: () => Promise.reject(refused),
      findRelated: () => Promise.reject(refused),
    });
    const s2Search = searchStub("semanticscholar", { keyword: () => refused });
    const epmc = searchStub("europepmc", {
      keyword: () => [paper("europepmc", 41)],
      direct: () => Promise.resolve(pageOf([paper("europepmc", 42)])),
    });
    const { result, pubmed } = run({
      s2,
      sources: [epmc, s2Search],
      sourceIds: ["semanticscholar", "europepmc"],
      profile: profileWith({
        seeds: seedsOf(3),
        topAuthors: [{ name: "Doudna J", count: 3 }],
        termWeights: { editing: 1 },
      }),
    });
    const done = await result;

    expect(s2.recommend).toHaveBeenCalled();
    expect(s2.findRelated).toHaveBeenCalled();
    expect(s2Search.searches).toHaveLength(1);
    expect(pubmed.findSimilarForSeeds).toHaveBeenCalled();
    expect(stateOf(done, "recommendations")).toBe("failed");
    expect(stateOf(done, "forward-citations")).toBe("failed");
    expect(row(done, "recommendations").errorCode).toBe(refused.code);
    expect(stateOf(done, "similar")).toBe("answered");
    expect(stateOf(done, "author-watch")).toBe("answered");
    expect(stateOf(done, "keyword-search")).toBe("partial");
    expect(strategiesOf(done)).toEqual(
      expect.arrayContaining(["similar", "keyword-search", "author-watch"]),
    );
    expect(done.candidates).toHaveLength(3);
    expect(done.state).toBe("partial");
  });

  it("a two-topic profile makes two (a) POSTs, and every candidate from them records its topic group", async () => {
    const answers = [
      paper("semanticscholar", 10),
      paper("semanticscholar", 11),
    ];
    let call = 0;
    const s2 = s2Stub({
      recommend: () => {
        const record = answers[call] as SourceRecord;
        call += 1;
        return Promise.resolve(pageOf([record]));
      },
    });
    const zero = [seed(0, 0), seed(1, 0)];
    const one = [seed(2, 1), seed(3, 1)];
    const negatives = [seed(9).ids];
    const { result } = run({
      s2,
      negatives,
      profile: profileWith({
        centroids: centroids(2),
        seeds: [zero[0], one[0], zero[1], one[1]] as ProfileSeed[],
      }),
    });
    const done = await result;

    expect(s2.recommend).toHaveBeenCalledTimes(2);
    expect(s2.recommend.mock.calls[0]?.slice(0, 3)).toEqual([
      zero.map((one_) => one_.ids),
      negatives,
      RECOMMEND_LIMIT,
    ]);
    expect(s2.recommend.mock.calls[1]?.slice(0, 3)).toEqual([
      one.map((one_) => one_.ids),
      negatives,
      RECOMMEND_LIMIT,
    ]);
    const findingsOf = (n: number) =>
      done.candidates
        .find((candidate) => candidate.work.title === titleOf(n))
        ?.discoveredVia.filter(
          (finding) => finding.strategy === "recommendations",
        );
    expect(findingsOf(10)).toEqual([
      {
        strategy: "recommendations",
        sourceId: "semanticscholar",
        topicGroup: 0,
      },
    ]);
    expect(findingsOf(11)).toEqual([
      {
        strategy: "recommendations",
        sourceId: "semanticscholar",
        topicGroup: 1,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// (a) Semantic Scholar's recommender
// ---------------------------------------------------------------------------

describe("the request sizes", () => {
  it("are the recorded starting values", () => {
    expect(RECOMMEND_LIMIT).toBe(200);
    expect(RECOMMEND_KEYWORD_LIMIT).toBe(50);
    expect(RECOMMEND_WATCH_LIMIT).toBe(100);
  });
});

describe("generator (a)", () => {
  it("keeps a warning that came beside records", async () => {
    const done = await run({
      s2: s2Stub({
        recommend: () =>
          Promise.resolve(
            pageOf([paper("semanticscholar", 12)], ["three lost"]),
          ),
      }),
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(stateOf(done, "recommendations")).toBe("answered");
    expect(row(done, "recommendations").warnings).toEqual(["three lost"]);
  });

  it("remembers a 404, and says the cache answered", async () => {
    const memory = memoryCache();
    const setup = {
      s2: s2Stub({
        recommend: () =>
          Promise.reject(new BadRequestError(404, "none resolved", {})),
      }),
      context: { cache: memory.cache },
      profile: profileWith({ seeds: seedsOf(1) }),
    };
    await run(setup).result;
    expect(setup.s2.recommend).toHaveBeenCalledTimes(1);
    const again = await run(setup).result;
    expect(setup.s2.recommend).toHaveBeenCalledTimes(1);
    expect(stateOf(again, "recommendations")).toBe("not-indexed");
    expect(row(again, "recommendations").fromCache).toBe(1);
  });

  it("stores no `raw` in the cache", async () => {
    const memory = memoryCache();
    await run({
      s2: s2Stub({
        recommend: () =>
          Promise.resolve(
            pageOf([paper("semanticscholar", 13, { raw: { big: true } })]),
          ),
      }),
      pubmed: pubmedStub((pmids) =>
        Promise.resolve(
          pmids.map((seedPmid) => ({
            seedPmid,
            ...pageOf([paper("pubmed", 14, { raw: { big: true } })]),
          })),
        ),
      ),
      context: { cache: memory.cache },
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(memory.values.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(memory.values)).not.toContain("big");
  });

  it("at k = 1 sends every seed once and records no topic group", async () => {
    const { result, s2 } = run({
      profile: profileWith({
        centroids: centroids(1),
        seeds: [seed(0, 0), seed(1, 0), seed(2)],
      }),
    });
    const done = await result;
    expect(s2.recommend).toHaveBeenCalledTimes(1);
    expect((s2.recommend.mock.calls[0] as unknown[])[0]).toHaveLength(3);
    const finding = done.candidates[0]?.discoveredVia[0];
    expect(finding).toEqual({
      strategy: "recommendations",
      sourceId: "semanticscholar",
    });
  });

  it("with no centroids sends every seed once", async () => {
    const { result, s2 } = run({
      profile: profileWith({ seeds: seedsOf(4) }),
    });
    await result;
    expect((s2.recommend.mock.calls[0] as unknown[])[0]).toHaveLength(4);
  });

  it("leaves a seed with no topic out of a multi-topic request", async () => {
    const { result, s2 } = run({
      profile: profileWith({
        centroids: centroids(2),
        seeds: [seed(0, 0), seed(1, 1), seed(2)],
      }),
    });
    await result;
    expect(
      s2.recommend.mock.calls.map(
        (call) => (call as unknown[])[0] as readonly unknown[],
      ),
    ).toEqual([[seed(0).ids], [seed(1).ids]]);
  });

  it("makes at most four requests, lowest topic first, whatever the stored k", async () => {
    expect(RECOMMEND_MAX_TOPIC_REQUESTS).toBe(4);
    const { result, s2 } = run({
      budget: new RequestBudget(100),
      profile: profileWith({
        centroids: centroids(5),
        seeds: [4, 3, 2, 1, 0].map((topic) => seed(topic, topic)),
      }),
    });
    await result;
    expect(
      s2.recommend.mock.calls.map(
        (call) => (call as unknown[])[0] as readonly unknown[],
      ),
    ).toEqual([0, 1, 2, 3].map((n) => [seed(n).ids]));
  });

  it("charges three requests a group, and a group it cannot pay for reads over budget", async () => {
    expect(RECOMMEND_REQUESTS_PER_TOPIC).toBe(3);
    const budget = new RequestBudget(5);
    const { result, s2 } = run({
      budget,
      profile: profileWith({
        centroids: centroids(2),
        seeds: [seed(0, 0), seed(1, 1)],
      }),
    });
    const done = await result;
    expect(s2.recommend).toHaveBeenCalledTimes(1);
    expect(stateOf(done, "recommendations")).toBe("partial");
    expect(row(done, "recommendations").overBudget).toBe(1);
    // The other two go to (b), whose seeds are two here.
    expect(budget.remaining).toBe(0);
  });

  it("sends an arXiv DOI as the arXiv id, for positives and negatives alike", async () => {
    const preprint = { doi: "10.48550/arXiv.2401.00001" } as ExternalIds;
    const { result, s2 } = run({
      negatives: [preprint],
      profile: profileWith({ seeds: [{ ids: preprint }] }),
    });
    await result;
    const [positives, negatives] = s2.recommend.mock.calls[0] as unknown as [
      unknown,
      unknown,
    ];
    expect(positives).toEqual([{ arxivId: "2401.00001" }]);
    expect(negatives).toEqual([{ arxivId: "2401.00001" }]);
    expect(s2.findRelated.mock.calls[0]?.[0]).toMatchObject({
      ids: { arxivId: "2401.00001" },
    });
  });

  it("sends at most ten negatives, each with an identifier the service reads", async () => {
    expect(MAX_NEGATIVES).toBe(10);
    const many = Array.from(
      { length: 12 },
      (_, n) => seed(n).ids,
    ) as ExternalIds[];
    const { result, s2 } = run({
      negatives: [{}, ...many],
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    await result;
    const negatives = s2.recommend.mock.calls[0] as unknown as [
      unknown,
      readonly unknown[],
    ];
    expect(negatives[1]).toEqual(many.slice(0, 9));
  });

  it("reads could-not-ask with no request when no seed has an identifier", async () => {
    const { result, s2 } = run({
      profile: profileWith({ seeds: [{ ids: {} }] }),
    });
    const done = await result;
    expect(s2.recommend).not.toHaveBeenCalled();
    expect(stateOf(done, "recommendations")).toBe("could-not-ask");
    expect(row(done, "recommendations").sourceIds).toEqual(["semanticscholar"]);
  });

  it("reads not-indexed on a 404 and could-not-ask on an empty page with a warning", async () => {
    const notHeld = run({
      s2: s2Stub({
        recommend: () =>
          Promise.reject(new BadRequestError(404, "none resolved", {})),
      }),
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    expect(stateOf(await notHeld.result, "recommendations")).toBe(
      "not-indexed",
    );

    const empty = run({
      s2: s2Stub({
        recommend: () => Promise.resolve(pageOf([], ["no identifier"])),
      }),
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    const done = await empty.result;
    expect(stateOf(done, "recommendations")).toBe("could-not-ask");
    expect(row(done, "recommendations").warnings).toEqual(["no identifier"]);
  });
});

// ---------------------------------------------------------------------------
// (b) PubMed's similar articles
// ---------------------------------------------------------------------------

describe("generator (b)", () => {
  it("asks one call over at most ten distinct PMIDs, in stored order, at limit 100", async () => {
    const seeds = [
      { ids: { doi: "10.1/no-pmid" } as ExternalIds },
      seed(0),
      ...seedsOf(12),
    ];
    const { result, pubmed } = run({ profile: profileWith({ seeds }) });
    await result;
    expect(pubmed.findSimilarForSeeds).toHaveBeenCalledTimes(1);
    const [pmids, options] = pubmed.findSimilarForSeeds.mock
      .calls[0] as unknown as [readonly string[], { limit: number }];
    expect(pmids).toEqual(
      Array.from({ length: 10 }, (_, n) => String(5000 + n)),
    );
    expect(options).toEqual({ limit: RECOMMEND_SIMILAR_LIMIT });
  });

  it("charges one elink and one efetch per 200 neighbours", async () => {
    for (const [seeds, spent] of [
      [1, 2],
      [2, 2],
      [3, 3],
      [10, 6],
    ] as const) {
      const budget = new RequestBudget(100);
      const { result } = run({
        budget,
        hasKey: false,
        profile: profileWith({ seeds: seedsOf(seeds) }),
      });
      await result;
      expect(100 - budget.remaining).toBe(spent);
    }
  });

  it("takes fewer seeds on a short budget, and none on a budget of 1", async () => {
    const two = run({
      budget: new RequestBudget(2),
      hasKey: false,
      profile: profileWith({ seeds: seedsOf(5) }),
    });
    const done = await two.result;
    expect(two.pubmed.findSimilarForSeeds.mock.calls[0]?.[0]).toHaveLength(2);
    expect(row(done, "similar").overBudget).toBe(3);

    const budget = new RequestBudget(1);
    const one = run({
      budget,
      hasKey: false,
      profile: profileWith({ seeds: seedsOf(5) }),
    });
    const short = await one.result;
    expect(one.pubmed.findSimilarForSeeds).not.toHaveBeenCalled();
    expect(stateOf(short, "similar")).toBe("over-budget");
    expect(budget.remaining).toBe(1);

    const none = run({
      budget: new RequestBudget(0),
      hasKey: false,
      profile: profileWith({ seeds: seedsOf(5) }),
    });
    await none.result;
    expect(none.pubmed.findSimilarForSeeds).not.toHaveBeenCalled();
  });

  it("treats an empty identifier as none, in (b) and in (c)", async () => {
    const epmc = searchStub("europepmc");
    const { result, pubmed } = run({
      hasKey: false,
      sources: [epmc],
      profile: profileWith({
        seeds: [{ ids: { pmid: "", pmcid: "", doi: "10.1/x" } as ExternalIds }],
      }),
    });
    await result;
    expect(pubmed.findSimilarForSeeds).not.toHaveBeenCalled();
    expect(
      epmc.findRelated.mock.calls.map(
        (call) => ((call as unknown[])[0] as RelatedQuery).ids,
      ),
    ).toEqual([{ doi: "10.1/x" }]);
  });

  it("caches per seed, so a later run asks only what it has not seen", async () => {
    const memory = memoryCache();
    const first = run({
      hasKey: false,
      context: { cache: memory.cache },
      profile: profileWith({ seeds: seedsOf(2) }),
    });
    await first.result;
    expect(memory.keys).toContain(
      relatedCacheKey("pmra", {
        sourceId: "pubmed",
        ids: ["pmid:5000"],
        params: { strategy: "similar", limit: RECOMMEND_SIMILAR_LIMIT },
      }),
    );

    const second = run({
      hasKey: false,
      context: { cache: memory.cache },
      profile: profileWith({ seeds: seedsOf(3) }),
    });
    const done = await second.result;
    expect(second.pubmed.findSimilarForSeeds.mock.calls[0]?.[0]).toEqual([
      "5002",
    ]);
    expect(row(done, "similar").fromCache).toBe(2);
    expect(done.candidates).toHaveLength(1);
  });

  it("does not cache an empty page with a warning, and says it could not ask when none answered", async () => {
    const memory = memoryCache();
    const { result } = run({
      hasKey: false,
      context: { cache: memory.cache },
      pubmed: pubmedStub((pmids) =>
        Promise.resolve(
          pmids.map((seedPmid) => ({
            seedPmid,
            ...pageOf([], [`no list for ${seedPmid}`]),
          })),
        ),
      ),
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    const done = await result;
    expect(memory.keys).toEqual([]);
    expect(stateOf(done, "similar")).toBe("could-not-ask");
    expect(row(done, "similar").warnings).toEqual(["no list for 5000"]);
  });

  it("caches an empty page with no warning, and keeps a warning beside records", async () => {
    const memory = memoryCache();
    const { result } = run({
      hasKey: false,
      context: { cache: memory.cache },
      pubmed: pubmedStub(() =>
        Promise.resolve([
          { seedPmid: "5000", ...pageOf([]) },
          { seedPmid: "5001", ...pageOf([paper("pubmed", 9)], ["two lost"]) },
        ]),
      ),
      profile: profileWith({ seeds: seedsOf(2) }),
    });
    const done = await result;
    expect(memory.keys).toHaveLength(2);
    expect(stateOf(done, "similar")).toBe("answered");
    expect(row(done, "similar").warnings).toEqual(["two lost"]);
    expect(row(done, "similar").records).toBe(1);
  });

  it("reads failed when the call throws, and rate-limited on a RateLimitError", async () => {
    const failed = run({
      hasKey: false,
      pubmed: pubmedStub(() =>
        Promise.reject(new UpstreamServerError(503, "down")),
      ),
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    expect(stateOf(await failed.result, "similar")).toBe("failed");

    const limited = run({
      hasKey: false,
      pubmed: pubmedStub(() =>
        Promise.reject(new RateLimitError(429, undefined, NCBI_HOST)),
      ),
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    expect(stateOf(await limited.result, "similar")).toBe("rate-limited");
  });

  it("reads could-not-ask when no seed has a PMID", async () => {
    const { result, pubmed } = run({
      profile: profileWith({
        seeds: [{ ids: { doi: "10.1/x" } as ExternalIds }],
      }),
    });
    const done = await result;
    expect(pubmed.findSimilarForSeeds).not.toHaveBeenCalled();
    expect(stateOf(done, "similar")).toBe("could-not-ask");
  });
});

// ---------------------------------------------------------------------------
// (c) Forward citations
// ---------------------------------------------------------------------------

describe("generator (c)", () => {
  it("keyed: asks Semantic Scholar for the citations of the first ten seeds, in order", async () => {
    const { result, s2 } = run({
      budget: new RequestBudget(100),
      profile: profileWith({ seeds: seedsOf(12) }),
    });
    await result;
    expect(s2.findRelated).toHaveBeenCalledTimes(RECOMMEND_CITATION_SEEDS);
    const queries = s2.findRelated.mock.calls.map(
      (call) => (call as unknown[])[0] as RelatedQuery,
    );
    expect(queries[0]).toEqual({
      ids: seed(0).ids,
      limit: RECOMMEND_CITATION_LIMIT,
      strategy: "citations",
    });
    expect(queries[9]?.ids).toEqual(seed(9).ids);
  });

  it("keyless: asks Europe PMC, with the PMID when there is one, and never Semantic Scholar", async () => {
    const epmc = searchStub("europepmc", {
      related: () => Promise.resolve(pageOf([paper("europepmc", 50)])),
    });
    const { result, s2 } = run({
      hasKey: false,
      sources: [epmc],
      profile: profileWith({
        seeds: [
          seed(0),
          { ids: { pmcid: "PMC1", doi: "10.1/a" } as ExternalIds },
          { ids: { doi: "10.1/b" } as ExternalIds },
          { ids: { arxivId: "2401.00001" } as ExternalIds },
        ],
      }),
    });
    const done = await result;
    expect(s2.findRelated).not.toHaveBeenCalled();
    expect(
      epmc.findRelated.mock.calls.map(
        (call) => ((call as unknown[])[0] as RelatedQuery).ids,
      ),
    ).toEqual([{ pmid: "5000" }, { pmcid: "PMC1" }, { doi: "10.1/b" }]);
    expect(row(done, "forward-citations").sourceIds).toEqual(["europepmc"]);
    expect(
      done.candidates.find((one) => one.work.title === titleOf(50))
        ?.discoveredVia[0],
    ).toEqual({
      strategy: "forward-citations",
      sourceId: "europepmc",
    });
  });

  it("keyless: a seed with a DOI alone costs two, and a cheaper one still fits behind it", async () => {
    const epmc = searchStub("europepmc");
    const budget = new RequestBudget(RECOMMEND_HYDRATION_RESERVE + 1);
    const { result } = run({
      budget,
      hasKey: false,
      sources: [epmc],
      profile: profileWith({
        seeds: [
          { ids: { doi: "10.1/b" } as ExternalIds },
          { ids: { pmcid: "PMC1" } as ExternalIds },
        ],
      }),
    });
    const done = await result;
    expect(
      epmc.findRelated.mock.calls.map(
        (call) => ((call as unknown[])[0] as RelatedQuery).ids,
      ),
    ).toEqual([{ pmcid: "PMC1" }]);
    expect(row(done, "forward-citations").overBudget).toBe(1);
    expect(budget.remaining).toBe(RECOMMEND_HYDRATION_RESERVE);
  });

  it("keyless: a seed with a PMID costs one", async () => {
    const epmc = searchStub("europepmc");
    const budget = new RequestBudget(2 + RECOMMEND_HYDRATION_RESERVE + 1);
    const { result } = run({
      budget,
      hasKey: false,
      sources: [epmc],
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    await result;
    expect(epmc.findRelated).toHaveBeenCalledTimes(1);
    expect(budget.remaining).toBe(RECOMMEND_HYDRATION_RESERVE);
  });

  it("keyed: every seed costs one, DOI or not", async () => {
    const budget = new RequestBudget(
      RECOMMEND_REQUESTS_PER_TOPIC + RECOMMEND_HYDRATION_RESERVE + 2,
    );
    const { result, s2 } = run({
      budget,
      profile: profileWith({
        seeds: [
          { ids: { doi: "10.1/a" } as ExternalIds },
          { ids: { doi: "10.1/b" } as ExternalIds },
        ],
      }),
    });
    await result;
    expect(s2.findRelated).toHaveBeenCalledTimes(2);
  });

  it("keyless: reads could-not-ask when Europe PMC is not registered", async () => {
    const { result } = run({
      hasKey: false,
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    const done = await result;
    expect(stateOf(done, "forward-citations")).toBe("could-not-ask");
    expect(stateOf(done, "author-watch")).toBe("could-not-ask");
  });

  it("shares its cache entries with the related run's", async () => {
    const memory = memoryCache();
    const keyed = run({
      context: { cache: memory.cache },
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    await keyed.result;
    expect(memory.keys).toContain(
      relatedCacheKey("citations", {
        sourceId: "semanticscholar",
        ids: ["DOI:10.2000/s0"],
        params: { strategy: "citations", limit: 100 },
      }),
    );
    const epmc = searchStub("europepmc");
    const keyless = run({
      hasKey: false,
      sources: [epmc],
      context: { cache: memory.cache },
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    await keyless.result;
    expect(memory.keys).toContain(
      relatedCacheKey("citations", {
        sourceId: "europepmc",
        ids: ["pmid:5000"],
        params: { strategy: "citations", limit: 100 },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// (d) The keyword queries
// ---------------------------------------------------------------------------

describe("recommendKeywordQueries", () => {
  const terms = {
    editing: 5,
    "base editing": 4,
    lipid: 3,
    nanoparticle: 2,
    delivery: 1,
    hepatocyte: 0.5,
  };

  it("joins the top five terms by weight into one quoted OR query", () => {
    expect(RECOMMEND_KEYWORD_TERMS).toBe(5);
    expect(
      recommendKeywordQueries(profileWith({ termWeights: terms })),
    ).toEqual([
      '"editing" OR "base editing" OR "lipid" OR "nanoparticle" OR "delivery"',
    ]);
  });

  it("has no query for a profile with no term", () => {
    expect(recommendKeywordQueries(QUIET_PROFILE)).toEqual([]);
  });

  it("takes the suggested queries when the LLM ran, at most three, one query each", () => {
    expect(RECOMMEND_MAX_KEYWORD_QUERIES).toBe(3);
    expect(
      recommendKeywordQueries(
        profileWith({
          origin: "llm",
          termWeights: terms,
          suggestedQueries: ["a one", "b two", "c three", "d four"],
        }),
      ),
    ).toEqual(["a one", "b two", "c three"]);
  });

  it("falls back to the terms when the LLM's list is empty", () => {
    const [query] = recommendKeywordQueries(
      profileWith({ origin: "llm", termWeights: { editing: 1 } }),
    );
    expect(query).toBe('"editing"');
  });

  it("does not read suggested queries on a heuristic profile", () => {
    expect(
      recommendKeywordQueries(
        profileWith({
          origin: "heuristic",
          termWeights: { editing: 1 },
          suggestedQueries: ["stale"],
        }),
      ),
    ).toEqual(['"editing"']);
  });

  it("drops a removed term from the terms, through normalizeTitle", () => {
    expect(
      recommendKeywordQueries(
        profileWith({
          termWeights: { editing: 2, lipid: 1 },
          userEdits: { removedTerms: ["  EDITING "], addedTerms: [] },
        }),
      ),
    ).toEqual(['"lipid"']);
  });

  it("puts added terms first, each once, and within the five", () => {
    expect(
      recommendKeywordQueries(
        profileWith({
          termWeights: terms,
          userEdits: {
            removedTerms: [],
            addedTerms: ["Prime editing", "  ", "Lipid"],
          },
        }),
      ),
    ).toEqual([
      '"Prime editing" OR "Lipid" OR "editing" OR "base editing" OR "nanoparticle"',
    ]);
  });

  it("a term both added and removed stays out", () => {
    expect(
      recommendKeywordQueries(
        profileWith({
          termWeights: { lipid: 1 },
          userEdits: { removedTerms: ["prime"], addedTerms: ["Prime"] },
        }),
      ),
    ).toEqual(['"lipid"']);
  });

  it("drops a suggested query holding a removed term as whole words only", () => {
    expect(
      recommendKeywordQueries(
        profileWith({
          origin: "llm",
          termWeights: { fallback: 1 },
          suggestedQueries: [
            "Base Editing in mice",
            "rebase editing tools",
            "lipid delivery",
          ],
          userEdits: { removedTerms: ["base editing"], addedTerms: [] },
        }),
      ),
    ).toEqual(["rebase editing tools", "lipid delivery"]);
  });

  it("an LLM profile with every suggestion removed falls back to the terms", () => {
    expect(
      recommendKeywordQueries(
        profileWith({
          origin: "llm",
          termWeights: { fallback: 1 },
          suggestedQueries: ["lipid"],
          userEdits: { removedTerms: ["lipid"], addedTerms: [] },
        }),
      ),
    ).toEqual(['"fallback"']);
  });

  it("gives added terms one query of their own ahead of the suggestions, inside the cap", () => {
    expect(
      recommendKeywordQueries(
        profileWith({
          origin: "llm",
          suggestedQueries: ["a one", "b two", "c three"],
          userEdits: { removedTerms: [], addedTerms: ["x", "y"] },
        }),
      ),
    ).toEqual(['"x" OR "y"', "a one", "b two"]);
  });

  it("cannot break a quoted phrase with a quotation mark", () => {
    expect(
      recommendKeywordQueries(
        profileWith({
          userEdits: { removedTerms: [], addedTerms: ['"a" OR b'] },
        }),
      ),
    ).toEqual(['"a  OR b"']);
  });
});

describe("generator (d)", () => {
  const profile = profileWith({ termWeights: { editing: 1 } });

  it("fans out to each selected source with the recency window and its limit", async () => {
    const crossref = searchStub("crossref", {
      keyword: () => [paper("crossref", 60)],
    });
    const epmc = searchStub("europepmc", {
      keyword: () => [paper("europepmc", 61)],
    });
    const { result } = run({
      sources: [crossref, epmc],
      sourceIds: ["crossref", "europepmc"],
      profile,
    });
    const done = await result;
    expect(crossref.searches).toEqual([
      {
        terms: { kind: "term", value: "editing", phrase: true },
        limit: RECOMMEND_KEYWORD_LIMIT,
        fromDate: WINDOW.fromDate,
        toDate: WINDOW.toDate,
      },
    ]);
    expect(epmc.searches).toHaveLength(1);
    expect(stateOf(done, "keyword-search")).toBe("answered");
    expect(row(done, "keyword-search").sourceIds).toEqual([
      "crossref",
      "europepmc",
    ]);
    expect(row(done, "keyword-search").records).toBe(2);
    expect(done.candidates.map((one) => one.discoveredVia)).toEqual([
      [{ strategy: "keyword-search", sourceId: "crossref" }],
      [{ strategy: "keyword-search", sourceId: "europepmc" }],
    ]);
  });

  it("asks a source only for what is selected", async () => {
    const crossref = searchStub("crossref");
    const epmc = searchStub("europepmc");
    const { result } = run({
      sources: [crossref, epmc],
      sourceIds: ["europepmc"],
      profile,
    });
    await result;
    expect(crossref.searches).toHaveLength(0);
    expect(epmc.searches).toHaveLength(1);
  });

  it("keyless: drops Semantic Scholar before any request; keyed: asks it", async () => {
    const s2Search = searchStub("semanticscholar");
    const keyless = run({
      hasKey: false,
      sources: [s2Search],
      sourceIds: ["semanticscholar"],
      profile,
    });
    await keyless.result;
    expect(s2Search.searches).toHaveLength(0);

    const keyed = run({
      sources: [s2Search],
      sourceIds: ["semanticscholar"],
      profile,
    });
    await keyed.result;
    expect(s2Search.searches).toHaveLength(1);
  });

  it("never asks a lookup-only source or OpenAlex, and reads could-not-ask for one not registered", async () => {
    const biorxiv = searchStub("biorxiv", { keywordSearch: false });
    const openalex = searchStub("openalex");
    const { result } = run({
      sources: [biorxiv, openalex],
      sourceIds: ["biorxiv", "openalex", "crossref"],
      profile,
    });
    const done = await result;
    expect(biorxiv.searches).toHaveLength(0);
    expect(openalex.searches).toHaveLength(0);
    expect(stateOf(done, "keyword-search")).toBe("could-not-ask");
    expect(row(done, "keyword-search").sourceIds).toEqual(["crossref"]);
  });

  it("charges PubMed two per query, and any other source one", async () => {
    const pubmedSearch = searchStub("pubmed");
    const crossref = searchStub("crossref");
    const budget = new RequestBudget(100);
    const { result } = run({
      budget,
      hasKey: false,
      sources: [pubmedSearch, crossref],
      sourceIds: ["pubmed"],
      profile,
    });
    await result;
    expect(100 - budget.remaining).toBe(2);

    const other = new RequestBudget(100);
    const second = run({
      budget: other,
      hasKey: false,
      sources: [pubmedSearch, crossref],
      sourceIds: ["crossref"],
      profile,
    });
    await second.result;
    expect(100 - other.remaining).toBe(1);
  });

  it("leaves the reserve, spends first on the first query, and counts the rest over budget", async () => {
    const crossref = searchStub("crossref");
    const epmc = searchStub("europepmc");
    const budget = new RequestBudget(RECOMMEND_HYDRATION_RESERVE + 3);
    const { result } = run({
      budget,
      hasKey: false,
      sources: [crossref, epmc],
      sourceIds: ["crossref", "europepmc"],
      profile: profileWith({
        origin: "llm",
        suggestedQueries: ["first", "second"],
      }),
    });
    const done = await result;
    // Two sources for the first query, and the second query's first source.
    expect(crossref.searches.map((one) => one.terms)).toEqual([
      { kind: "term", value: "first" },
      { kind: "term", value: "second" },
    ]);
    expect(epmc.searches.map((one) => one.terms)).toEqual([
      { kind: "term", value: "first" },
    ]);
    expect(row(done, "keyword-search").overBudget).toBe(1);
    expect(stateOf(done, "keyword-search")).toBe("partial");
    expect(budget.remaining).toBe(RECOMMEND_HYDRATION_RESERVE);
  });

  it("spends on arXiv after forward citations: a short budget leaves it out", async () => {
    const arxiv = searchStub("arxiv");
    const budget = new RequestBudget(
      RECOMMEND_REQUESTS_PER_TOPIC + 2 + RECOMMEND_HYDRATION_RESERVE + 1,
    );
    const { result, s2 } = run({
      budget,
      sources: [arxiv],
      sourceIds: ["arxiv"],
      profile: profileWith({
        termWeights: { editing: 1 },
        seeds: seedsOf(1),
      }),
    });
    await result;
    expect(s2.findRelated).toHaveBeenCalledTimes(1);
    expect(arxiv.searches).toHaveLength(0);

    const roomy = run({
      sources: [arxiv],
      sourceIds: ["arxiv"],
      profile,
    });
    await roomy.result;
    expect(arxiv.searches).toHaveLength(1);
  });

  it("caches an answer per source and query, without `raw`, under its window", async () => {
    const memory = memoryCache();
    const crossref = searchStub("crossref", {
      keyword: () => [paper("crossref", 62, { raw: { big: true } })],
    });
    const setup = {
      hasKey: false,
      sources: [crossref],
      sourceIds: ["crossref"] as SourceId[],
      context: { cache: memory.cache },
      profile,
    };
    await run(setup).result;
    expect(crossref.searches).toHaveLength(1);
    expect(memory.keys).toContain(
      relatedCacheKey("keyword-search", {
        sourceId: "crossref",
        ids: [],
        params: {
          query: '"editing"',
          limit: RECOMMEND_KEYWORD_LIMIT,
          fromDate: WINDOW.fromDate,
          toDate: WINDOW.toDate,
        },
      }),
    );
    expect(JSON.stringify(memory.values)).not.toContain("big");

    const budget = new RequestBudget(0);
    const second = await run({ ...setup, budget }).result;
    expect(crossref.searches).toHaveLength(1);
    expect(row(second, "keyword-search").fromCache).toBe(1);
    expect(second.candidates).toHaveLength(1);
  });

  it("does not cache a failure, keeps what came before it, and reads failed with its code", async () => {
    const memory = memoryCache();
    let answered = 0;
    const crossref = searchStub("crossref", {
      keyword: () => {
        answered += 1;
        return new UpstreamServerError(503, "down");
      },
    });
    const { result } = run({
      hasKey: false,
      sources: [crossref],
      sourceIds: ["crossref"],
      context: { cache: memory.cache },
      profile,
    });
    const done = await result;
    expect(answered).toBe(1);
    expect(memory.keys).toEqual([]);
    expect(stateOf(done, "keyword-search")).toBe("failed");
    expect(row(done, "keyword-search").errorCode).toBe(
      new UpstreamServerError(503, "down").code,
    );
    expect(row(done, "keyword-search").warnings).toHaveLength(1);
  });

  it("does not cache an empty answer with a warning, and caches a warning beside records", async () => {
    const memory = memoryCache();
    const empty = searchStub("crossref", { warn: "approximate" });
    const first = await run({
      hasKey: false,
      sources: [empty],
      sourceIds: ["crossref"],
      context: { cache: memory.cache },
      profile,
    }).result;
    expect(memory.keys).toEqual([]);
    expect(stateOf(first, "keyword-search")).toBe("could-not-ask");
    expect(row(first, "keyword-search").warnings).toEqual(["approximate"]);

    const held = searchStub("crossref", {
      warn: "approximate",
      keyword: () => [paper("crossref", 63)],
    });
    const second = await run({
      hasKey: false,
      sources: [held],
      sourceIds: ["crossref"],
      context: { cache: memory.cache },
      profile,
    }).result;
    expect(memory.keys).toHaveLength(1);
    expect(stateOf(second, "keyword-search")).toBe("answered");
  });

  it("gives each request its own slice of the stage's progress", async () => {
    const crossref = searchStub("crossref");
    const parent = reporter();
    const child = vi.spyOn(parent, "child");
    const { result } = run({
      hasKey: false,
      sources: [crossref],
      sourceIds: ["crossref"],
      progress: parent,
      profile: profileWith({
        origin: "llm",
        suggestedQueries: ["first", "second"],
      }),
    });
    await result;
    // (a) no-key, (e) could-not-ask, (c) could-not-ask, then the two queries'.
    const slots = 3 + 2;
    expect(child.mock.calls).toEqual([
      ["crossref", 2 / slots, 3 / slots],
      ["crossref", 3 / slots, 4 / slots],
    ]);
  });
});

// ---------------------------------------------------------------------------
// (e) The frequent-author watch
// ---------------------------------------------------------------------------

describe("generator (e)", () => {
  const authors = ["A", "B", "C", "D", "E", "F"].map((name, index) => ({
    name,
    count: 10 - index,
  }));

  it("sends one Europe PMC query, OR-ing the top five authors over the last 90 days", async () => {
    expect(RECOMMEND_WATCH_AUTHORS).toBe(5);
    expect(RECOMMEND_WATCH_DAYS).toBe(90);
    const epmc = searchStub("europepmc", {
      direct: () => Promise.resolve(pageOf([paper("europepmc", 70)])),
    });
    const budget = new RequestBudget(10);
    const { result } = run({
      budget,
      hasKey: false,
      sources: [epmc],
      profile: profileWith({ topAuthors: authors }),
    });
    const done = await result;
    expect(epmc.direct).toEqual([
      {
        terms: {
          kind: "or",
          children: ["A", "B", "C", "D", "E"].map((value) => ({
            kind: "term",
            field: "author",
            phrase: true,
            value,
          })),
        },
        limit: RECOMMEND_WATCH_LIMIT,
        fromDate: "2026-08-07",
        toDate: "2026-11-05",
      },
    ]);
    expect(budget.remaining).toBe(9);
    expect(stateOf(done, "author-watch")).toBe("answered");
    expect(done.candidates[0]?.discoveredVia).toEqual([
      { strategy: "author-watch", sourceId: "europepmc" },
    ]);
  });

  it("reads could-not-ask with no request when the profile has no author", async () => {
    const epmc = searchStub("europepmc");
    const { result } = run({ hasKey: false, sources: [epmc] });
    const done = await result;
    expect(epmc.direct).toHaveLength(0);
    expect(stateOf(done, "author-watch")).toBe("could-not-ask");
  });

  it("is answered by the cache for free, and a different author list is a different entry", async () => {
    const memory = memoryCache();
    const epmc = searchStub("europepmc");
    const setup = {
      hasKey: false,
      sources: [epmc],
      context: { cache: memory.cache },
    };
    await run({
      ...setup,
      profile: profileWith({ topAuthors: authors }),
    }).result;
    const budget = new RequestBudget(0);
    const again = await run({
      ...setup,
      budget,
      profile: profileWith({ topAuthors: authors }),
    }).result;
    expect(epmc.direct).toHaveLength(1);
    expect(row(again, "author-watch").fromCache).toBe(1);

    await run({
      ...setup,
      profile: profileWith({ topAuthors: authors.slice(1) }),
    }).result;
    expect(epmc.direct).toHaveLength(2);
  });

  it("keys its entry on the authors, the limit and both dates", async () => {
    const memory = memoryCache();
    const epmc = searchStub("europepmc");
    await run({
      hasKey: false,
      sources: [epmc],
      context: { cache: memory.cache },
      profile: profileWith({ topAuthors: authors.slice(0, 2) }),
    }).result;
    expect(memory.keys).toContain(
      relatedCacheKey("keyword-search", {
        sourceId: "europepmc",
        ids: [],
        params: {
          authors: "A\nB",
          limit: RECOMMEND_WATCH_LIMIT,
          fromDate: "2026-08-07",
          toDate: "2026-11-05",
        },
      }),
    );
  });

  it("may spend into the reserve: the reserve binds only (c) and (d)", async () => {
    const epmc = searchStub("europepmc");
    const budget = new RequestBudget(1);
    await run({
      budget,
      hasKey: false,
      sources: [epmc],
      profile: profileWith({ topAuthors: authors }),
    }).result;
    expect(epmc.direct).toHaveLength(1);
    expect(budget.remaining).toBe(0);
  });

  it("reads over-budget on an empty budget", async () => {
    const epmc = searchStub("europepmc");
    const { result } = run({
      hasKey: false,
      budget: new RequestBudget(0),
      sources: [epmc],
      profile: profileWith({ topAuthors: authors }),
    });
    const done = await result;
    expect(epmc.direct).toHaveLength(0);
    expect(stateOf(done, "author-watch")).toBe("over-budget");
  });
});

// ---------------------------------------------------------------------------
// The run around them
// ---------------------------------------------------------------------------

describe("the budget", () => {
  it("defaults to 40, and a one-topic keyed run on the default sources spends 38", async () => {
    expect(RECOMMEND_REQUEST_BUDGET).toBe(40);
    const budget = new RequestBudget(RECOMMEND_REQUEST_BUDGET);
    const ids: SourceId[] = [
      "pubmed",
      "europepmc",
      "crossref",
      "semanticscholar",
      "arxiv",
      "biorxiv",
      "medrxiv",
    ];
    const sources = ids.map((id) =>
      searchStub(id, {
        keywordSearch: id !== "biorxiv" && id !== "medrxiv",
      }),
    );
    const { result, s2 } = run({
      budget,
      sources,
      sourceIds: ids,
      profile: profileWith({
        origin: "llm",
        suggestedQueries: ["first", "second", "third"],
        seeds: seedsOf(15),
        topAuthors: [{ name: "A", count: 2 }],
      }),
    });
    const done = await result;
    expect(budget.remaining).toBe(2);
    expect(s2.findRelated).toHaveBeenCalledTimes(RECOMMEND_CITATION_SEEDS);
    expect(row(done, "keyword-search").overBudget).toBe(0);
    expect(done.state).toBe("succeeded");
  });

  it("uses a budget of 40 when none is passed: four topic groups spend 34, (c) gets four seeds, arXiv none", async () => {
    const ids: SourceId[] = [
      "pubmed",
      "europepmc",
      "crossref",
      "semanticscholar",
      "arxiv",
    ];
    const sources = ids.map((id) => searchStub(id));
    const seeds = Array.from({ length: 12 }, (_, n) => seed(n, n % 4));
    const { result, s2, pubmed } = run({
      sources,
      sourceIds: ids,
      profile: profileWith({
        origin: "llm",
        suggestedQueries: ["first", "second", "third"],
        centroids: centroids(4),
        seeds,
        topAuthors: [{ name: "A", count: 2 }],
      }),
    });
    const done = await result;
    expect(s2.recommend).toHaveBeenCalledTimes(4);
    expect(pubmed.findSimilarForSeeds.mock.calls[0]?.[0]).toHaveLength(10);
    expect(s2.findRelated).toHaveBeenCalledTimes(4);
    expect(sources[4]?.searches).toHaveLength(0);
    expect(row(done, "forward-citations").overBudget).toBe(6);
    expect(stateOf(done, "keyword-search")).toBe("partial");
  });

  it("plans in value order however fast each host answers", async () => {
    // (a) never answers until (b) has been asked, and the budget covers only those two.
    const gate = deferred<RelatedPage>();
    const s2 = s2Stub({ recommend: () => gate.promise });
    const pubmed = pubmedStub((pmids) => {
      gate.settle(pageOf([paper("semanticscholar", 1)]));
      return Promise.resolve(
        pmids.map((seedPmid) => ({ seedPmid, ...pageOf([]) })),
      );
    });
    const budget = new RequestBudget(5);
    const done = await run({
      s2,
      pubmed,
      budget,
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(s2.recommend).toHaveBeenCalledTimes(1);
    expect(pubmed.findSimilarForSeeds).toHaveBeenCalledTimes(1);
    expect(s2.findRelated).not.toHaveBeenCalled();
    expect(row(done, "forward-citations").overBudget).toBe(1);
    // 3 for (a) and 2 for (b): the order of planning, not of answering.
    expect(budget.remaining).toBe(0);
  });

  it("gives a generator's budget to (a) before (b)", async () => {
    const { result, s2, pubmed } = run({
      budget: new RequestBudget(3),
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    await result;
    expect(s2.recommend).toHaveBeenCalledTimes(1);
    expect(pubmed.findSimilarForSeeds).not.toHaveBeenCalled();
  });

  it("gives (e) its one request before (d)", async () => {
    const crossref = searchStub("crossref");
    const epmc = searchStub("europepmc");
    const { result } = run({
      hasKey: false,
      budget: new RequestBudget(1 + RECOMMEND_HYDRATION_RESERVE),
      sources: [crossref, epmc],
      sourceIds: ["crossref"],
      profile: profileWith({
        termWeights: { editing: 1 },
        topAuthors: [{ name: "A", count: 2 }],
      }),
    });
    await result;
    expect(epmc.direct).toHaveLength(1);
    expect(crossref.searches).toHaveLength(0);
  });

  it("charges nothing for what the cache answers, so a second run spends nothing", async () => {
    const memory = memoryCache();
    const epmc = searchStub("europepmc");
    const setup = {
      sources: [epmc],
      sourceIds: ["europepmc"] as SourceId[],
      context: { cache: memory.cache },
      profile: profileWith({
        seeds: seedsOf(2),
        termWeights: { editing: 1 },
        topAuthors: [{ name: "A", count: 2 }],
      }),
    };
    const first = run(setup);
    await first.result;
    const budget = new RequestBudget(0);
    const second = run({ ...setup, budget });
    const done = await second.result;
    expect(second.s2.recommend).not.toHaveBeenCalled();
    expect(second.s2.findRelated).not.toHaveBeenCalled();
    expect(second.pubmed.findSimilarForSeeds).not.toHaveBeenCalled();
    for (const generator of [
      "recommendations",
      "similar",
      "forward-citations",
      "keyword-search",
      "author-watch",
    ] as const) {
      expect(row(done, generator).overBudget).toBe(0);
      expect(row(done, generator).fromCache).toBeGreaterThan(0);
    }
    expect(budget.remaining).toBe(0);
  });

  it("keys (a)'s entry on its seeds and its negatives", async () => {
    const memory = memoryCache();
    const profile = profileWith({ seeds: seedsOf(1) });
    const context = { cache: memory.cache };
    const first = run({ profile, context, negatives: [seed(9).ids] });
    await first.result;
    expect(memory.keys).toContain(
      relatedCacheKey("s2-recommendations", {
        sourceId: "semanticscholar",
        ids: ["DOI:10.2000/s0"],
        negativeIds: ["DOI:10.2000/s9"],
        params: { limit: RECOMMEND_LIMIT },
      }),
    );
    const changed = run({ profile, context, negatives: [] });
    await changed.result;
    expect(changed.s2.recommend).toHaveBeenCalledTimes(1);
  });

  it("does not read the cache when the preference is off", async () => {
    const memory = memoryCache();
    const off = {
      cache: memory.cache,
      config: {
        get: () => false,
      } as unknown as RecommendGeneratorContext["config"],
    };
    const profile = profileWith({ seeds: seedsOf(1) });
    await run({ profile, context: off }).result;
    expect(memory.keys).toEqual([]);
  });
});

describe("hosts", () => {
  it("runs across hosts at once and within one host in order", async () => {
    const order: string[] = [];
    const gate = deferred<RelatedPage>();
    const s2 = s2Stub({
      recommend: async () => {
        order.push("recommend");
        const page = await gate.promise;
        order.push("recommend answered");
        return page;
      },
      findRelated: () => {
        order.push("citations");
        return Promise.resolve(pageOf([]));
      },
    });
    const pubmed = pubmedStub((pmids) => {
      order.push("similar");
      gate.settle(pageOf([]));
      return Promise.resolve(
        pmids.map((seedPmid) => ({ seedPmid, ...pageOf([]) })),
      );
    });
    await run({
      s2,
      pubmed,
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    // Only (b) can open (a)'s gate, so a run with one queue would never finish; and
    // (c), behind (a) on the same host, waits for its answer.
    expect(order).toContain("similar");
    expect(order.slice(-2)).toEqual(["recommend answered", "citations"]);
  });

  it("stops asking a host once it answers RateLimitError, on the rest of its queue only", async () => {
    const limited = new RateLimitError(429, undefined, SEMANTICSCHOLAR_HOST);
    const s2 = s2Stub({
      recommend: () => Promise.reject(limited),
    });
    const s2Search = searchStub("semanticscholar");
    const { result, pubmed } = run({
      s2,
      sources: [s2Search],
      sourceIds: ["semanticscholar"],
      profile: profileWith({
        seeds: seedsOf(3),
        termWeights: { editing: 1 },
      }),
    });
    const done = await result;
    expect(s2.recommend).toHaveBeenCalledTimes(1);
    expect(s2.findRelated).not.toHaveBeenCalled();
    expect(s2Search.searches).toHaveLength(0);
    expect(stateOf(done, "recommendations")).toBe("rate-limited");
    expect(row(done, "recommendations").errorCode).toBe(limited.code);
    expect(stateOf(done, "forward-citations")).toBe("rate-limited");
    expect(row(done, "forward-citations").errorCode).toBeUndefined();
    expect(stateOf(done, "keyword-search")).toBe("rate-limited");
    expect(pubmed.findSimilarForSeeds).toHaveBeenCalledTimes(1);
    expect(stateOf(done, "similar")).toBe("answered");
  });

  it("stops after a keyword search's RateLimitError as well", async () => {
    const limited = new RateLimitError(429, undefined, EBI_HOST);
    const epmc = searchStub("europepmc", { keyword: () => limited });
    const { result } = run({
      hasKey: false,
      sources: [epmc],
      sourceIds: ["europepmc"],
      profile: profileWith({
        origin: "llm",
        suggestedQueries: ["first", "second"],
      }),
    });
    const done = await result;
    expect(epmc.searches).toHaveLength(1);
    expect(stateOf(done, "keyword-search")).toBe("rate-limited");
  });

  it("goes on after any other failure", async () => {
    let calls = 0;
    const s2 = s2Stub({
      findRelated: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new UpstreamServerError(503, "down"))
          : Promise.resolve(pageOf([paper("semanticscholar", 20)]));
      },
    });
    const { result } = run({
      s2,
      profile: profileWith({ seeds: seedsOf(2) }),
    });
    const done = await result;
    expect(calls).toBe(2);
    expect(stateOf(done, "forward-citations")).toBe("partial");
    expect(row(done, "forward-citations").errorCode).toBe(
      new UpstreamServerError(503, "down").code,
    );
  });
});

describe("the key probe", () => {
  it("keyless: nothing reaches Semantic Scholar and its row reads no key", async () => {
    const { result, s2 } = run({
      hasKey: false,
      profile: profileWith({ seeds: seedsOf(2) }),
    });
    const done = await result;
    expect(s2.recommend).not.toHaveBeenCalled();
    expect(s2.findRelated).not.toHaveBeenCalled();
    expect(done.hadKey).toBe(false);
    expect(stateOf(done, "recommendations")).toBe("no-key");
    expect(row(done, "recommendations").sourceIds).toEqual(["semanticscholar"]);
  });

  it("a probe that fails counts as no key", async () => {
    const { result, s2 } = run({
      hasKey: () => Promise.reject(new Error("locked")),
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    const done = await result;
    expect(done.hadKey).toBe(false);
    expect(s2.recommend).not.toHaveBeenCalled();
  });

  it("reads the probe once", async () => {
    const probe = vi.fn(() => Promise.resolve(true));
    const done = await run({
      hasKey: probe,
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(probe).toHaveBeenCalledTimes(1);
    expect(done.hadKey).toBe(true);
  });
});

describe("the union", () => {
  it("keeps every generator on the merged work, across sources", async () => {
    const shared = "10.1000/shared";
    const onShared = (sourceId: SourceId, n: number) =>
      paper(sourceId, n, {
        work: {
          ...paper(sourceId, n).work,
          ids: { doi: shared } as ExternalIds,
        },
      });
    const epmc = searchStub("europepmc", {
      keyword: () => [onShared("europepmc", 30)],
    });
    const { result } = run({
      s2: s2Stub({
        recommend: () =>
          Promise.resolve(pageOf([onShared("semanticscholar", 31)])),
      }),
      pubmed: pubmedStub((pmids) =>
        Promise.resolve(
          pmids.map((seedPmid) => ({
            seedPmid,
            ...pageOf([onShared("pubmed", 32)]),
          })),
        ),
      ),
      sources: [epmc],
      sourceIds: ["europepmc"],
      profile: profileWith({
        seeds: seedsOf(1),
        termWeights: { editing: 1 },
      }),
    });
    const done = await result;
    const merged = done.candidates.find(
      (candidate) => candidate.work.ids.doi === shared,
    );
    expect(merged?.discoveredVia).toEqual([
      { strategy: "recommendations", sourceId: "semanticscholar" },
      { strategy: "similar", sourceId: "pubmed" },
      { strategy: "keyword-search", sourceId: "europepmc" },
    ]);
  });

  it("lists one record found twice once in the merge and twice in discoveredVia", async () => {
    const shared = paper("semanticscholar", 33);
    const { result } = run({
      s2: s2Stub({ findRelated: () => Promise.resolve(pageOf([shared])) }),
      profile: profileWith({ seeds: seedsOf(2) }),
    });
    const done = await result;
    const candidate = done.candidates.find(
      (one) => one.work.title === titleOf(33),
    );
    expect(candidate?.records).toHaveLength(1);
    expect(candidate?.discoveredVia).toEqual([
      { strategy: "forward-citations", sourceId: "semanticscholar" },
      { strategy: "forward-citations", sourceId: "semanticscholar" },
    ]);
  });

  it("keeps the first copy of a record found twice when neither is fuller", async () => {
    const copy = (abstract: string) =>
      paper("semanticscholar", 35, {
        work: { ...paper("semanticscholar", 35).work, abstract },
      });
    const answers = [copy("First."), copy("Second.")];
    const done = await run({
      s2: s2Stub({
        findRelated: () =>
          Promise.resolve(pageOf([answers.shift() as SourceRecord])),
      }),
      profile: profileWith({ seeds: seedsOf(2) }),
    }).result;
    expect(
      done.candidates.find((one) => one.work.title === titleOf(35))?.work
        .abstract,
    ).toBe("First.");
  });

  it("keeps the fuller copy of a record found twice", async () => {
    const thin = paper("semanticscholar", 34, {
      missingFields: ["abstract"],
    });
    const full = paper("semanticscholar", 34, {
      work: { ...paper("semanticscholar", 34).work, abstract: "Full." },
    });
    const answers = [thin, full, thin];
    const { result } = run({
      s2: s2Stub({
        findRelated: () =>
          Promise.resolve(pageOf([answers.shift() as SourceRecord])),
      }),
      profile: profileWith({ seeds: seedsOf(3) }),
    });
    const done = await result;
    const candidate = done.candidates.find(
      (one) => one.work.title === titleOf(34),
    );
    expect(candidate?.work.abstract).toBe("Full.");
  });

  it("leads with the best generator's records, whichever host finished first", async () => {
    const gate = deferred<RelatedPage>();
    const s2 = s2Stub({ recommend: () => gate.promise });
    const pubmed = pubmedStub((pmids) => {
      gate.settle(pageOf([paper("semanticscholar", 35)]));
      return Promise.resolve(
        pmids.map((seedPmid) => ({
          seedPmid,
          ...pageOf([paper("pubmed", 36)]),
        })),
      );
    });
    const done = await run({
      s2,
      pubmed,
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(done.candidates[0]?.work.title).toBe(titleOf(35));
  });

  it("passes the merge's links and flags through", async () => {
    const title =
      "A shared title about ribosome profiling across human tissues";
    const preprint = (n: number, related?: ExternalIds) =>
      paper("europepmc", n, {
        work: {
          ...paper("europepmc", n).work,
          ids: { doi: `10.1101/2024.01.01.${String(n)}` } as ExternalIds,
          type: "preprint",
          ...(related === undefined
            ? { title }
            : { relatedVersionIds: related }),
        },
      });
    const published = paper("semanticscholar", 38, {
      work: { ...paper("semanticscholar", 38).work, title },
    });
    const done = await run({
      s2: s2Stub({
        recommend: () =>
          Promise.resolve(
            pageOf([
              paper("semanticscholar", 39),
              preprint(37, { doi: "10.1000/p39" } as ExternalIds),
              published,
              preprint(36),
            ]),
          ),
      }),
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    // Named as the other's version, so linked; only a title match, so flagged.
    expect(done.links).toHaveLength(1);
    expect(done.flags).toHaveLength(1);
  });

  it("stamps the merge with the clock", async () => {
    const done = await run({
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(done.candidates[0]?.work.normalizedAtEpochMs).toBe(NOW);
  });

  it("is empty, and quiet, on a profile that can ask nothing", async () => {
    const done = await run().result;
    expect(done.candidates).toEqual([]);
    expect(done.statuses.map((one) => one.generator)).toEqual([
      "recommendations",
      "similar",
      "forward-citations",
      "keyword-search",
      "author-watch",
    ]);
    expect(stateOf(done, "keyword-search")).toBe("could-not-ask");
    expect(row(done, "keyword-search").sourceIds).toEqual([]);
    expect(done.state).toBe("succeeded");
  });
});

describe("state, docs/07 §12.5's Generating edges", () => {
  const down = new UpstreamServerError(503, "down");
  const failing = {
    s2: s2Stub({
      recommend: () => Promise.reject(down),
      findRelated: () => Promise.reject(down),
    }),
    pubmed: pubmedStub(() => Promise.reject(down)),
    profile: profileWith({ seeds: seedsOf(1) }),
  };

  it("failed: every generator that ran failed and none yielded a record", async () => {
    expect((await run(failing).result).state).toBe("failed");
  });

  it("failed holds through a generator that could not ask, and through rate limits", async () => {
    const limited = new RateLimitError(429, undefined, NCBI_HOST);
    const done = await run({
      ...failing,
      pubmed: pubmedStub(() => Promise.reject(limited)),
    }).result;
    expect(stateOf(done, "author-watch")).toBe("could-not-ask");
    expect(done.state).toBe("failed");
  });

  it("partial: a failure beside an answer, even an empty one", async () => {
    const done = await run({
      ...failing,
      pubmed: pubmedStub((pmids) =>
        Promise.resolve(pmids.map((seedPmid) => ({ seedPmid, ...pageOf([]) }))),
      ),
    }).result;
    expect(stateOf(done, "similar")).toBe("answered");
    expect(done.state).toBe("partial");
  });

  it("partial: a failed keyword source that had already yielded a record", async () => {
    const crossref = {
      ...searchStub("crossref"),
      source: {
        ...searchStub("crossref").source,
        async *searchAll() {
          await Promise.resolve();
          yield paper("crossref", 80);
          throw down;
        },
      } as unknown as LiteratureSource,
    };
    const done = await run({
      hasKey: false,
      sources: [crossref],
      sourceIds: ["crossref"],
      pubmed: pubmedStub(() => Promise.reject(down)),
      profile: profileWith({
        seeds: seedsOf(1),
        termWeights: { editing: 1 },
      }),
    }).result;
    expect(stateOf(done, "keyword-search")).toBe("failed");
    expect(row(done, "keyword-search").records).toBe(1);
    expect(done.candidates).toHaveLength(1);
    expect(done.state).toBe("partial");
  });

  it("partial: no key, or short of budget, with nothing failed", async () => {
    const noKey = await run({
      hasKey: false,
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(noKey.state).toBe("partial");

    const short = await run({
      budget: new RequestBudget(0),
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(short.state).toBe("partial");
  });

  it("partial: one generator wholly short of budget beside an answer", async () => {
    const done = await run({
      budget: new RequestBudget(RECOMMEND_REQUESTS_PER_TOPIC + 3 + 2),
      profile: profileWith({ seeds: seedsOf(3) }),
    }).result;
    expect(stateOf(done, "forward-citations")).toBe("over-budget");
    expect(stateOf(done, "similar")).toBe("answered");
    expect(done.state).toBe("partial");
  });

  it("succeeded: not-indexed and could-not-ask are not failures", async () => {
    const done = await run({
      s2: s2Stub({
        recommend: () => Promise.reject(new BadRequestError(404, "no", {})),
        findRelated: () => Promise.reject(new BadRequestError(404, "no", {})),
      }),
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(stateOf(done, "recommendations")).toBe("not-indexed");
    expect(done.state).toBe("succeeded");
  });

  it("failed: a keyless run whose every other generator failed or could not ask", async () => {
    const done = await run({
      hasKey: false,
      pubmed: pubmedStub(() => Promise.reject(down)),
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(stateOf(done, "recommendations")).toBe("no-key");
    expect(done.state).toBe("failed");
  });

  it("failed: what did not fail never ran, for want of budget", async () => {
    const done = await run({
      s2: s2Stub({ recommend: () => Promise.reject(down) }),
      budget: new RequestBudget(RECOMMEND_REQUESTS_PER_TOPIC),
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(stateOf(done, "similar")).toBe("over-budget");
    expect(done.state).toBe("failed");
  });

  it("a row whose asks failed and then hit a rate limit reads failed", async () => {
    const answers: Error[] = [
      down,
      new RateLimitError(429, undefined, SEMANTICSCHOLAR_HOST),
    ];
    const done = await run({
      s2: s2Stub({
        findRelated: () => Promise.reject(answers.shift() as Error),
      }),
      profile: profileWith({ seeds: seedsOf(2) }),
    }).result;
    expect(answers).toEqual([]);
    expect(stateOf(done, "forward-citations")).toBe("failed");
    expect(row(done, "forward-citations").errorCode).toBe(down.code);
  });

  it("a row with an answer and a rate limit reads partial", async () => {
    const limited = new RateLimitError(429, undefined, SEMANTICSCHOLAR_HOST);
    let calls = 0;
    const done = await run({
      s2: s2Stub({
        findRelated: () => {
          calls += 1;
          return calls === 1
            ? Promise.resolve(pageOf([paper("semanticscholar", 21)]))
            : Promise.reject(limited);
        },
      }),
      profile: profileWith({ seeds: seedsOf(2) }),
    }).result;
    expect(stateOf(done, "forward-citations")).toBe("partial");
  });

  it("a row with a 404 and nothing to ask with reads not-indexed", async () => {
    const done = await run({
      s2: s2Stub({
        recommend: () => Promise.reject(new BadRequestError(404, "no", {})),
      }),
      profile: profileWith({
        centroids: centroids(2),
        seeds: [{ ids: {}, topicIndex: 0 }, seed(1, 1)],
      }),
    }).result;
    expect(stateOf(done, "recommendations")).toBe("not-indexed");
  });

  it("a row with no answer gives failure first, then budget, then not-indexed", async () => {
    const twoCitations = new RequestBudget(
      RECOMMEND_REQUESTS_PER_TOPIC + 3 + RECOMMEND_HYDRATION_RESERVE + 2,
    );
    const notHeld = await run({
      s2: s2Stub({
        findRelated: () => Promise.reject(new BadRequestError(404, "no", {})),
      }),
      budget: twoCitations,
      profile: profileWith({ seeds: seedsOf(3) }),
    }).result;
    expect(row(notHeld, "forward-citations").overBudget).toBe(1);
    expect(stateOf(notHeld, "forward-citations")).toBe("over-budget");

    const onlyNotHeld = await run({
      s2: s2Stub({
        findRelated: () => Promise.reject(new BadRequestError(404, "no", {})),
      }),
      profile: profileWith({ seeds: seedsOf(1) }),
    }).result;
    expect(stateOf(onlyNotHeld, "forward-citations")).toBe("not-indexed");

    let calls = 0;
    const mixed = s2Stub({
      findRelated: () => {
        calls += 1;
        return Promise.reject(
          calls === 1 ? new BadRequestError(404, "no", {}) : down,
        );
      },
    });
    const done = await run({
      s2: mixed,
      budget: new RequestBudget(
        RECOMMEND_REQUESTS_PER_TOPIC + 3 + RECOMMEND_HYDRATION_RESERVE + 2,
      ),
      profile: profileWith({ seeds: seedsOf(3) }),
    }).result;
    expect(calls).toBe(2);
    expect(stateOf(done, "forward-citations")).toBe("failed");
  });
});

describe("cancellation", () => {
  it("rejects before anything when already cancelled", async () => {
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });
    const probe = vi.fn(() => Promise.resolve(true));
    const { result, s2 } = run({
      hasKey: probe,
      context: { token: source.token },
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    await expect(result).rejects.toBeInstanceOf(OperationCancelledError);
    expect(probe).not.toHaveBeenCalled();
    expect(s2.recommend).not.toHaveBeenCalled();
  });

  it("sends nothing more on a host once cancelled, though the request in hand answered", async () => {
    const source = createCancellationTokenSource();
    const s2 = s2Stub({
      recommend: () => {
        source.cancel({ kind: "user" });
        return Promise.resolve(pageOf([paper("semanticscholar", 15)]));
      },
    });
    const { result } = run({
      s2,
      context: { token: source.token },
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    await expect(result).rejects.toBeInstanceOf(OperationCancelledError);
    expect(s2.findRelated).not.toHaveBeenCalled();
  });

  it("does not merge after a cancel during the last request", async () => {
    const source = createCancellationTokenSource();
    const s2 = s2Stub({
      recommend: () => {
        source.cancel({ kind: "user" });
        return Promise.resolve(pageOf([paper("semanticscholar", 16)]));
      },
    });
    const { result } = run({
      s2,
      budget: new RequestBudget(RECOMMEND_REQUESTS_PER_TOPIC),
      context: { token: source.token },
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    await expect(result).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("rejects when cancelled mid-run, after the other hosts settle, and sends nothing more", async () => {
    const source = createCancellationTokenSource();
    const s2 = s2Stub({
      recommend: () => {
        source.cancel({ kind: "user" });
        return Promise.reject(new OperationCancelledError({ kind: "user" }));
      },
    });
    let similarSettled = false;
    const pubmed = pubmedStub(async (pmids) => {
      await new Promise((resolveIt) => setTimeout(resolveIt, 5));
      similarSettled = true;
      return pmids.map((seedPmid) => ({ seedPmid, ...pageOf([]) }));
    });
    const { result } = run({
      s2,
      pubmed,
      context: { token: source.token },
      profile: profileWith({ seeds: seedsOf(1) }),
    });
    await expect(result).rejects.toBeInstanceOf(OperationCancelledError);
    expect(s2.findRelated).not.toHaveBeenCalled();
    expect(similarSettled).toBe(true);
  });

  it("carries a cancellation out of (b) and (d)", async () => {
    const cancelled = new OperationCancelledError({ kind: "user" });
    await expect(
      run({
        hasKey: false,
        pubmed: pubmedStub(() => Promise.reject(cancelled)),
        profile: profileWith({ seeds: seedsOf(1) }),
      }).result,
    ).rejects.toBe(cancelled);

    const source = createCancellationTokenSource();
    const crossref = searchStub("crossref", {
      onSearch: () => {
        source.cancel({ kind: "user" });
      },
    });
    await expect(
      run({
        hasKey: false,
        sources: [crossref],
        sourceIds: ["crossref"],
        context: { token: source.token },
        profile: profileWith({ termWeights: { editing: 1 } }),
      }).result,
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

// ---------------------------------------------------------------------------
// On the shipped adapters
// ---------------------------------------------------------------------------

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures",
);

function recordedBody(dir: string, scenario: string): string {
  const folder = resolve(FIXTURES, dir);
  for (const name of readdirSync(folder)) {
    if (!name.endsWith("_meta.json")) continue;
    const meta = JSON.parse(readFileSync(resolve(folder, name), "utf8")) as {
      scenario?: string;
    };
    if (meta.scenario !== scenario) continue;
    const exchange = JSON.parse(
      readFileSync(
        resolve(folder, name.replace("_meta.json", ".json")),
        "utf8",
      ),
    ) as { body: string };
    return exchange.body;
  }
  throw new Error(`no ${dir} fixture for scenario "${scenario}"`);
}

function ok(url: string, body: string): HttpResponse {
  return { status: 200, url, body, rawHeaders: "", header: () => undefined };
}

describe("on the shipped adapters, without a key", () => {
  function shippedAdapters() {
    const clock = createManualClock(NOW);
    const s2Requests: string[] = [];
    const ebi: string[] = [];
    const http: HttpClient = {
      request(_method, url, options?: HttpOptions) {
        const host = new URL(url).hostname;
        if (host === SEMANTICSCHOLAR_HOST) {
          s2Requests.push(url);
          return Promise.reject(new Error(`asked Semantic Scholar: ${url}`));
        }
        if (host === CROSSREF_HOST) {
          return Promise.resolve(
            ok(url, recordedBody("crossref", "search-typical")),
          );
        }
        if (host === NCBI_HOST) {
          if (url.includes("elink.fcgi")) {
            return Promise.resolve(
              ok(url, recordedBody("pubmed/related", "elink-two-seeds")),
            );
          }
          if (url.includes("esearch.fcgi")) {
            return Promise.resolve(
              ok(url, recordedBody("pubmed", "search-typical")),
            );
          }
          // No neighbour's `efetch` was recorded, so the mapper below is a stub.
          const params = new URLSearchParams(
            options?.body ?? url.slice(url.indexOf("?") + 1),
          );
          return Promise.resolve(ok(url, `IDS:${params.get("id") ?? ""}`));
        }
        if (host === EBI_HOST) {
          const params = new URLSearchParams(
            options?.body ?? url.slice(url.indexOf("?") + 1),
          );
          ebi.push(
            url.includes("/citations")
              ? "citations"
              : (params.get("query") ?? ""),
          );
          return Promise.resolve(
            ok(
              url,
              url.includes("/citations")
                ? recordedBody("europepmc/related", "citations")
                : recordedBody("europepmc", "search-typical"),
            ),
          );
        }
        return Promise.reject(new Error(`no service at ${url}`));
      },
    };
    const s2 = createSemanticScholarSource({
      http,
      clock,
      mapRecords: createSemanticScholarRecordMapper({ clock }),
    });
    const pubmed = createPubmedSource({
      http,
      clock,
      mapRecords: (body: string) =>
        body
          .slice(4)
          .split(",")
          .filter((pmid) => pmid !== "")
          .map((pmid) => ({
            ...paper("pubmed", Number(pmid)),
            id: `pubmed:${pmid}`,
            nativeId: pmid,
            work: {
              ...paper("pubmed", Number(pmid)).work,
              ids: { pmid } as ExternalIds,
            },
          })),
    });
    const sources: LiteratureSource[] = [
      s2,
      pubmed,
      createEuropePmcSource({
        http,
        clock,
        mapRecords: createEuropePmcRecordMapper({ clock }),
      }),
      createCrossrefSource({
        http,
        clock,
        mapRecords: createCrossrefRecordMapper({
          clock,
          parseXml: () => ({ documentElement: null }),
        }),
      }),
    ];
    return { s2, pubmed, sources, s2Requests, ebi };
  }

  const profile = profileWith({
    seeds: [
      {
        ids: {
          pmid: PUBMED_ELINK_SEED_PMIDS[0],
          doi: "10.1000/seed-a",
        } as ExternalIds,
      },
      {
        ids: {
          pmid: PUBMED_ELINK_SEED_PMIDS[1],
        } as ExternalIds,
      },
      { ids: { pmid: EUROPEPMC_RELATED_SEED_PMID } as ExternalIds },
    ],
    termWeights: { "prime editing": 2, lipid: 1 },
    topAuthors: [
      { name: "Doudna J", count: 3 },
      { name: "Liu DR", count: 2 },
    ],
  });

  async function shippedRun() {
    const adapters = shippedAdapters();
    const options: RecommendGeneratorOptions = {
      hasSemanticScholarKey: () => adapters.s2.hasUsableApiKey(),
      adapters: { semanticScholar: adapters.s2, pubmed: adapters.pubmed },
      pool: new Semaphore(4),
      progress: reporter(),
    };
    const result = await runRecommendGenerators(
      {
        profile,
        negatives: [{ doi: "10.1000/dismissed" } as ExternalIds],
        sourceIds: ["pubmed", "europepmc", "crossref", "semanticscholar"],
        dateFilter: WINDOW,
      },
      contextOf(adapters.sources),
      options,
    );
    return { result, ...adapters };
  }

  it("Done when: makes no request to api.semanticscholar.org, (d) included, on a transport that fails there", async () => {
    const { result, s2Requests } = await shippedRun();
    expect(s2Requests).toEqual([]);
    expect(result.hadKey).toBe(false);
    expect(stateOf(result, "recommendations")).toBe("no-key");
    expect(stateOf(result, "similar")).toBe("answered");
    expect(stateOf(result, "forward-citations")).toBe("answered");
    expect(stateOf(result, "keyword-search")).toBe("answered");
    expect(stateOf(result, "author-watch")).toBe("answered");
    expect(row(result, "keyword-search").sourceIds).toEqual([
      "pubmed",
      "europepmc",
      "crossref",
    ]);
    expect(result.state).toBe("partial");
    expect(strategiesOf(result)).toEqual(
      expect.arrayContaining([
        "similar",
        "forward-citations",
        "keyword-search",
        "author-watch",
      ]),
    );
    expect(strategiesOf(result)).not.toContain("recommendations");
    for (const candidate of result.candidates) {
      expect(candidate.discoveredVia.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("sends docs/05 §7.3's author query and the keyword query to Europe PMC", async () => {
    const { ebi } = await shippedRun();
    expect(ebi).toContain(
      '(AUTH:"Doudna J" OR AUTH:"Liu DR") AND (FIRST_PDATE:[2026-08-07 TO 2026-11-05])',
    );
    expect(ebi).toContain(
      `("prime editing" OR "lipid") AND (FIRST_PDATE:[${WINDOW.fromDate} TO ${WINDOW.toDate}])`,
    );
    expect(ebi.filter((sent) => sent === "citations")).toHaveLength(3);
  });

  it("sends no dismissed identifier without a key, because (a) is the only one that does", async () => {
    const { ebi } = await shippedRun();
    expect(ebi.join(" ")).not.toContain("dismissed");
  });
});
