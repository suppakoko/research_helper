/**
 * `P5-T12`: the related-paper generators, their union and hydration.
 *
 * Plain Node, no network. Most tests use hand-written stand-in adapters, because
 * what is under test is the run around them. The block "on the shipped adapters"
 * runs the real adapters over recorded Europe PMC, PubMed and Crossref bodies; the
 * Semantic Scholar adapter there is real too, and its transport fails the test if it
 * is asked anything. Semantic Scholar's own answers are never replayed here: its
 * fixtures are stand-ins until `P5-T31` (`plan/00` §6 item 335(a)).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  NO_CACHE,
  type Cache,
  type CacheSetOptions,
} from "../../../src/core/cache/cache";
import { createManualClock } from "../../../src/core/clock";
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
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import type { SecretStore } from "../../../src/core/secretStore";
import {
  CROSSREF_HOST,
  EBI_HOST,
  NCBI_HOST,
  SEMANTICSCHOLAR_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import type { ExternalIds, SourceId } from "../../../src/model/ids";
import { merge } from "../../../src/model/merge";
import type { RelationEdge } from "../../../src/model/related";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  RELATED_GENERATORS,
  RELATED_HYDRATION_RESERVE,
  RELATED_REQUEST_BUDGET,
  runRelatedGenerators as runShippedGenerators,
  semanticScholarIdsOf,
  type RelatedGenerationResult,
  type RelatedGeneratorOptions,
  type RelatedGeneratorContext,
  type RelatedGeneratorId,
  type RelatedGeneratorState,
} from "../../../src/pipeline/related/generators";
import {
  RELATED_NEGATIVE_TTL_MS,
  RELATED_TTL_MS,
  relatedCacheKey,
} from "../../../src/pipeline/shared/relatedFetch";
import { RequestBudget } from "../../../src/pipeline/shared/requestBudget";
import { createCrossrefSource } from "../../../src/sources/crossref/crossrefSource";
import { createCrossrefRecordMapper } from "../../../src/sources/crossref/mapper";
import { createEuropePmcSource } from "../../../src/sources/europepmc/europepmcSource";
import { createEuropePmcRecordMapper } from "../../../src/sources/europepmc/mapper";
import { createPubmedSource } from "../../../src/sources/pubmed/pubmedSource";
import { createSourceRegistry } from "../../../src/sources/registry";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import {
  createSemanticScholarSource,
  toEmbeddingPaperId,
  toSemanticScholarId,
} from "../../../src/sources/semanticscholar/semanticscholarSource";
import type {
  LiteratureSource,
  RelatedPage,
  RelatedQuery,
} from "../../../src/sources/types";
import { CROSSREF_DOI_WITH_REFERENCES } from "../../support/crossrefRecordedRequests";
import { EUROPEPMC_RELATED_SEED_PMID } from "../../support/europepmcRecordedRequests";

const NOW = 1_700_000_000_000;
const DOI = "10.1000/seed";
const PMID = "1000001";

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

/** A title no other number's title is near, so only identifiers can join records. */
function titleOf(n: number): string {
  return `${TITLE_WORDS[n % TITLE_WORDS.length] ?? ""} study ${String(n)} ${String(n * 7919)}`;
}

function rec(
  sourceId: SourceId,
  nativeId: string,
  work: Partial<SourceRecord["work"]> = {},
  extra: Partial<SourceRecord> = {},
): SourceRecord {
  return {
    id: `${sourceId}:${nativeId}`,
    sourceId,
    nativeId,
    work: {
      ids: {},
      type: "journal-article",
      title: `Paper ${nativeId}`,
      authors: [{ family: "Author" }],
      ...work,
    },
    retrievedAtEpochMs: NOW,
    missingFields: [],
    ...extra,
  };
}

/** A paper with this DOI and a title of its own, seen by `sourceId`. */
function paper(
  sourceId: SourceId,
  n: number,
  extra: Partial<SourceRecord["work"]> = {},
): SourceRecord {
  return rec(sourceId, `n${String(n)}`, {
    ids: { doi: `10.1000/p${String(n)}` } as ExternalIds,
    title: titleOf(n),
    abstract: `Abstract of paper ${String(n)}.`,
    ...extra,
  });
}

/** What a Crossref reference row holds (`docs/07` §4.2's `P5-T09` note). */
function bareDoi(n: number): SourceRecord {
  const doi = `10.1000/p${String(n)}`;
  return rec(
    "crossref",
    doi,
    { ids: { doi } as ExternalIds, type: "other", title: "", authors: [] },
    { missingFields: ["title", "authors", "type"] },
  );
}

function pageOf(
  records: readonly SourceRecord[],
  edge: (index: number) => RelationEdge,
  warnings: readonly string[] = [],
): RelatedPage {
  return {
    records,
    edges: records.map((_, index) => edge(index)),
    totalAvailable: records.length,
    nextCursor: undefined,
    warnings,
  };
}

const EMPTY: RelatedPage = pageOf([], () => ({ kind: "citation", rank: 1 }));

type Answer =
  RelatedPage | Error | ((query: RelatedQuery) => Promise<RelatedPage>);

type StrategyAnswers = Partial<
  Record<NonNullable<RelatedQuery["strategy"]>, Answer>
>;

interface StandIn {
  readonly source: LiteratureSource;
  readonly findRelated: ReturnType<typeof vi.fn>;
  readonly lookup: ReturnType<typeof vi.fn>;
}

const HOST_OF: Readonly<Partial<Record<SourceId, string>>> = {
  semanticscholar: SEMANTICSCHOLAR_HOST,
  pubmed: NCBI_HOST,
  europepmc: EBI_HOST,
  crossref: CROSSREF_HOST,
};

function standIn(
  id: SourceId,
  answers: StrategyAnswers,
  lookup?: (ids: readonly Partial<ExternalIds>[]) => readonly SourceRecord[],
): StandIn {
  const findRelated = vi.fn((query: RelatedQuery): Promise<RelatedPage> => {
    const answer = answers[query.strategy ?? "auto"] ?? EMPTY;
    if (answer instanceof Error) return Promise.reject(answer);
    if (typeof answer === "function") return answer(query);
    return Promise.resolve(answer);
  });
  const lookupFn = vi.fn((ids: readonly Partial<ExternalIds>[]) =>
    Promise.resolve(lookup?.(ids) ?? []),
  );
  const source = {
    id,
    rateLimitKey: HOST_OF[id] ?? id,
    findRelated,
    ...(id === "pubmed" || id === "crossref" ? {} : { lookup: lookupFn }),
  } as unknown as LiteratureSource;
  return { source, findRelated, lookup: lookupFn };
}

interface MemoryCache {
  readonly cache: Cache;
  readonly sets: { key: string; value: unknown; options?: CacheSetOptions }[];
}

function memoryCache(): MemoryCache {
  const held = new Map<string, unknown>();
  const sets: MemoryCache["sets"] = [];
  return {
    sets,
    cache: {
      ...NO_CACHE,
      get: <T>(_namespace: string, key: string) =>
        Promise.resolve(held.get(key) as T | undefined),
      set: (_namespace, key, value, options) => {
        held.set(key, value);
        sets.push({ key, value, ...(options !== undefined && { options }) });
        return Promise.resolve();
      },
    },
  };
}

function contextOf(
  sources: readonly StandIn[] | readonly LiteratureSource[],
  overrides: Partial<RelatedGeneratorContext> = {},
): RelatedGeneratorContext {
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
    } as unknown as RelatedGeneratorContext["config"],
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    clock,
    token: createCancellationTokenSource().token,
    ...overrides,
  };
}

/**
 * The stand-ins answer `lookup`, so this reads Semantic Scholar's records from there
 * unless a test passes the option itself, as the shipped-adapter tests do.
 */
function runRelatedGenerators(
  seed: Parameters<typeof runShippedGenerators>[0],
  ctx: RelatedGeneratorContext,
  options: Omit<RelatedGeneratorOptions, "lookupSemanticScholar"> &
    Partial<Pick<RelatedGeneratorOptions, "lookupSemanticScholar">>,
): Promise<RelatedGenerationResult> {
  return runShippedGenerators(seed, ctx, {
    lookupSemanticScholar: (ids, call) => {
      const source = ctx.sources.get("semanticscholar");
      return source?.lookup?.call(source, ids, call) ?? Promise.resolve([]);
    },
    ...options,
  });
}

const keyed = {
  hasSemanticScholarKey: () => Promise.resolve(true),
};
const keyless = {
  hasSemanticScholarKey: () => Promise.resolve(false),
};

function stateOf(
  result: RelatedGenerationResult,
  generator: RelatedGeneratorId,
): RelatedGeneratorState | undefined {
  return result.statuses.find((row) => row.generator === generator)?.state;
}

function rowOf(result: RelatedGenerationResult, generator: RelatedGeneratorId) {
  const row = result.statuses.find((entry) => entry.generator === generator);
  if (row === undefined) throw new Error(`no row for ${generator}`);
  return row;
}

function candidateWithDoi(result: RelatedGenerationResult, doi: string) {
  const found = result.candidates.find((c) => c.work.ids.doi === doi);
  if (found === undefined) throw new Error(`no candidate for ${doi}`);
  return found;
}

/**
 * Seven generators on four stand-ins, each list holding `shared` and one paper of
 * its own, numbered by generator.
 */
function everyGeneratorAnswering(shared = 500) {
  const list = (
    sourceId: SourceId,
    own: number,
    kind: RelationEdge["kind"],
    extra: Partial<RelationEdge> = {},
  ) =>
    pageOf([paper(sourceId, shared), paper(sourceId, own)], (index) => ({
      kind,
      rank: index + 1,
      ...extra,
    }));
  const s2 = standIn("semanticscholar", {
    recommendations: list("semanticscholar", 1, "recommendation"),
    citations: list("semanticscholar", 3, "citation", {
      contexts: ["as shown by [12]"],
    }),
    references: list("semanticscholar", 4, "reference"),
  });
  const pubmed = standIn("pubmed", {
    similar: list("pubmed", 2, "similar", { score: 0.5 }),
  });
  const epmc = standIn("europepmc", {
    citations: list("europepmc", 5, "citation"),
    references: list("europepmc", 6, "reference"),
  });
  const crossref = standIn("crossref", {
    references: pageOf([bareDoi(shared), bareDoi(7)], (index) => ({
      kind: "reference",
      rank: index + 1,
    })),
  });
  return { s2, pubmed, epmc, crossref, all: [s2, pubmed, epmc, crossref] };
}

const SEED = { ids: { doi: DOI, pmid: PMID } as ExternalIds };

function plenty(): RequestBudget {
  return new RequestBudget(100);
}

// ---------------------------------------------------------------------------
// Done-when 1: the union holds each generator's edges on merged works
// ---------------------------------------------------------------------------

describe("the union", () => {
  it("Done when: a DOI seed's union holds each generator's edges on merged works", async () => {
    const { all } = everyGeneratorAnswering();
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyed,
      budget: plenty(),
    });

    const shared = candidateWithDoi(result, "10.1000/p500");
    expect(shared.edges.map((edge) => edge.generator).sort()).toEqual(
      RELATED_GENERATORS.map((definition) => definition.id).sort(),
    );
    expect(result.statuses.map((row) => row.state)).toEqual(
      RELATED_GENERATORS.map(() => "answered"),
    );
    // Each list's own paper is its own candidate, on that list's edge alone.
    for (const [n, generator] of [
      [1, "s2-recommendations"],
      [2, "pmra"],
      [3, "s2-citations"],
      [4, "s2-references"],
      [5, "europepmc-citations"],
      [6, "europepmc-references"],
    ] as const) {
      const own = candidateWithDoi(result, `10.1000/p${String(n)}`);
      expect(own.edges.map((edge) => edge.generator)).toEqual([generator]);
    }
    expect([...shared.work.provenance.seenIn].sort()).toEqual([
      "crossref",
      "europepmc",
      "pubmed",
      "semanticscholar",
    ]);
  });

  it("carries each edge's kind, rank, score, contexts, source and asked length", async () => {
    const { all } = everyGeneratorAnswering();
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyed,
      budget: plenty(),
    });
    const edges = candidateWithDoi(result, "10.1000/p500").edges;
    const of = (generator: RelatedGeneratorId) =>
      edges.find((edge) => edge.generator === generator);

    expect(of("s2-recommendations")).toEqual({
      generator: "s2-recommendations",
      sourceId: "semanticscholar",
      limit: 200,
      edge: { kind: "recommendation", rank: 1 },
    });
    expect(of("pmra")?.edge).toEqual({ kind: "similar", rank: 1, score: 0.5 });
    expect(of("s2-citations")?.edge.contexts).toEqual(["as shown by [12]"]);
    expect(of("crossref-references")?.sourceId).toBe("crossref");
    expect(of("crossref-references")?.limit).toBe(100);
  });

  it("asks each generator once, by its own strategy, never auto", async () => {
    const { s2, pubmed, epmc, crossref, all } = everyGeneratorAnswering();
    await runRelatedGenerators(SEED, contextOf(all), {
      ...keyed,
      budget: plenty(),
    });
    const strategies = (mock: ReturnType<typeof vi.fn>) =>
      mock.mock.calls
        .map(([query]) => (query as RelatedQuery).strategy ?? "none")
        .sort();
    expect(strategies(s2.findRelated)).toEqual([
      "citations",
      "recommendations",
      "references",
    ]);
    expect(strategies(pubmed.findRelated)).toEqual(["similar"]);
    expect(strategies(epmc.findRelated)).toEqual(["citations", "references"]);
    expect(strategies(crossref.findRelated)).toEqual(["references"]);
  });

  it("sends docs/05 §6.1's limits", async () => {
    const { s2, pubmed, all } = everyGeneratorAnswering();
    await runRelatedGenerators(SEED, contextOf(all), {
      ...keyed,
      budget: plenty(),
    });
    const limitFor = (strategy: string) =>
      s2.findRelated.mock.calls
        .map(([query]) => query as RelatedQuery)
        .find((query) => query.strategy === strategy)?.limit;
    expect(limitFor("recommendations")).toBe(200);
    expect(limitFor("references")).toBe(100);
    expect(limitFor("citations")).toBe(100);
    expect((pubmed.findRelated.mock.calls[0]?.[0] as RelatedQuery).limit).toBe(
      100,
    );
  });

  it("keeps two edges for one record two calls of one source returned, and its id once", async () => {
    const same = paper("semanticscholar", 9);
    const s2 = standIn("semanticscholar", {
      recommendations: pageOf([same], () => ({
        kind: "recommendation",
        rank: 3,
      })),
      citations: pageOf([same], () => ({ kind: "citation", rank: 8 })),
    });
    const result = await runRelatedGenerators(SEED, contextOf([s2]), keyed);
    const candidate = candidateWithDoi(result, "10.1000/p9");
    expect(candidate.edges.map((edge) => edge.edge.rank)).toEqual([3, 8]);
    expect(candidate.work.provenance.recordIds).toEqual([same.id]);
    expect(candidate.records).toHaveLength(1);
  });

  it("leaves out a record that has no edge at its index", async () => {
    const pubmed = standIn("pubmed", {
      similar: {
        ...pageOf([paper("pubmed", 2)], () => ({ kind: "similar", rank: 1 })),
        records: [paper("pubmed", 2), paper("pubmed", 3)],
      },
    });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed]),
      keyless,
    );
    expect(result.candidates.map((c) => c.work.ids.doi)).toEqual([
      "10.1000/p2",
    ]);
  });

  it("keeps the fuller of two copies of one record", async () => {
    const thin = paper("semanticscholar", 9, { abstract: undefined } as never);
    const thinRecord = { ...thin, missingFields: ["abstract"] };
    const full = paper("semanticscholar", 9, { abstract: "The full one." });
    const s2 = standIn("semanticscholar", {
      recommendations: pageOf([thinRecord], () => ({
        kind: "recommendation",
        rank: 1,
      })),
      citations: pageOf([full], () => ({ kind: "citation", rank: 1 })),
      references: pageOf([thinRecord], () => ({ kind: "reference", rank: 1 })),
    });
    const result = await runRelatedGenerators(SEED, contextOf([s2]), {
      ...keyed,
      budget: plenty(),
    });
    expect(candidateWithDoi(result, "10.1000/p9").work.abstract).toBe(
      "The full one.",
    );
  });

  it("leads with the best generator's records, whichever host answers first", async () => {
    let releaseS2 = (): void => undefined;
    const s2Gate = new Promise<void>((done) => {
      releaseS2 = done;
    });
    const s2 = standIn("semanticscholar", {
      recommendations: async () => {
        await s2Gate;
        return pageOf([paper("semanticscholar", 1)], () => ({
          kind: "recommendation",
          rank: 1,
        }));
      },
    });
    const pubmed = standIn("pubmed", {
      similar: () => {
        releaseS2();
        return Promise.resolve(
          pageOf([paper("pubmed", 2)], () => ({ kind: "similar", rank: 1 })),
        );
      },
    });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed, s2]),
      keyed,
    );
    expect(result.candidates.map((c) => c.work.ids.doi)).toEqual([
      "10.1000/p1",
      "10.1000/p2",
    ]);
  });

  it("returns the links and flags of the last merge", async () => {
    const preprint = rec("europepmc", "PPR/PPR1", {
      type: "preprint",
      title: titleOf(1),
      ids: { doi: "10.1101/2020.01.01.111111" } as ExternalIds,
      publishedDate: { year: 2020, iso: "2020" },
    });
    const published = rec("pubmed", "2", {
      title: titleOf(1),
      ids: { doi: "10.1000/published" } as ExternalIds,
      publishedDate: { year: 2021, iso: "2021" },
    });
    const pubmed = standIn("pubmed", {
      similar: pageOf([published], () => ({ kind: "similar", rank: 1 })),
    });
    const epmc = standIn("europepmc", {
      citations: pageOf([preprint], () => ({ kind: "citation", rank: 1 })),
    });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed, epmc]),
      keyless,
    );
    expect(result.links.length).toBeGreaterThan(0);
    expect(result.candidates).toHaveLength(2);
  });

  it("returns the flags of the last merge", async () => {
    // One title across the preprint boundary, and no DOI to conflict: a flag.
    const preprint = rec("europepmc", "PPR/PPR2", {
      type: "preprint",
      title: titleOf(1),
      publishedDate: { year: 2020, iso: "2020" },
    });
    const published = rec("pubmed", "2", {
      title: titleOf(1),
      ids: { doi: "10.1000/published" } as ExternalIds,
      publishedDate: { year: 2020, iso: "2020" },
    });
    const pubmed = standIn("pubmed", {
      similar: pageOf([published], () => ({ kind: "similar", rank: 1 })),
    });
    const epmc = standIn("europepmc", {
      citations: pageOf([preprint], () => ({ kind: "citation", rank: 1 })),
    });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed, epmc]),
      keyless,
    );
    expect(result.flags.length).toBeGreaterThan(0);
    expect(result.candidates).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Done-when 2: one generator failing
// ---------------------------------------------------------------------------

describe("a failing generator", () => {
  it("Done when: one generator throwing leaves the others' results and a status row", async () => {
    const { s2, all } = everyGeneratorAnswering();
    s2.findRelated.mockImplementationOnce(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyed,
      budget: plenty(),
    });
    expect(stateOf(result, "s2-recommendations")).toBe("failed");
    expect(rowOf(result, "s2-recommendations").errorCode).toBe(
      new UpstreamServerError(503, "down").code,
    );
    expect(stateOf(result, "pmra")).toBe("answered");
    expect(candidateWithDoi(result, "10.1000/p2").edges).toHaveLength(1);
    expect(result.candidates.some((c) => c.work.ids.doi === "10.1000/p1")).toBe(
      false,
    );
  });

  it.each<[string, Error, RelatedGeneratorState]>([
    ["a 404", new BadRequestError(404, "gone"), "not-indexed"],
    ["a 429", new RateLimitError(429, undefined, "slow down"), "rate-limited"],
    ["a 400", new BadRequestError(400, "bad"), "failed"],
    ["a plain error", new TypeError("bug"), "failed"],
  ])("%s reads as its own row", async (_name, error, state) => {
    const pubmed = standIn("pubmed", { similar: error });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed]),
      keyless,
    );
    expect(stateOf(result, "pmra")).toBe(state);
    expect(result.candidates).toEqual([]);
  });

  it("names the code on a rate-limited row, and none on a not-indexed one", async () => {
    const pubmed = standIn("pubmed", {
      similar: new RateLimitError(429, undefined, "slow down"),
    });
    const epmc = standIn("europepmc", {
      citations: new BadRequestError(404, "gone"),
    });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed, epmc]),
      keyless,
    );
    expect(rowOf(result, "pmra").errorCode).toBe(
      new RateLimitError(429, undefined, "x").code,
    );
    expect(rowOf(result, "europepmc-citations").errorCode).toBeUndefined();
  });

  it("reads an empty page with a warning as could-not-ask, and keeps the warning", async () => {
    const crossref = standIn("crossref", {
      references: { ...EMPTY, warnings: ["Crossref holds no list."] },
    });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([crossref]),
      keyless,
    );
    expect(stateOf(result, "crossref-references")).toBe("could-not-ask");
    expect(rowOf(result, "crossref-references").warnings).toEqual([
      "Crossref holds no list.",
    ]);
  });

  it("reads an empty page with no warning as answered", async () => {
    const pubmed = standIn("pubmed", { similar: EMPTY });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed]),
      keyless,
    );
    expect(stateOf(result, "pmra")).toBe("answered");
    expect(rowOf(result, "pmra").records).toBe(0);
  });

  it("keeps a warning on a page that has records", async () => {
    const pubmed = standIn("pubmed", {
      similar: pageOf(
        [paper("pubmed", 2)],
        () => ({ kind: "similar", rank: 1 }),
        ["one row was odd"],
      ),
    });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed]),
      keyless,
    );
    expect(stateOf(result, "pmra")).toBe("answered");
    expect(rowOf(result, "pmra").warnings).toEqual(["one row was odd"]);
    expect(rowOf(result, "pmra").records).toBe(1);
  });

  it("reads a source this build lacks as could-not-ask, and one with no findRelated too", async () => {
    const bare = {
      id: "crossref",
      rateLimitKey: CROSSREF_HOST,
    } as unknown as LiteratureSource;
    const result = await runRelatedGenerators(SEED, contextOf([bare]), keyed);
    expect(stateOf(result, "crossref-references")).toBe("could-not-ask");
    expect(stateOf(result, "pmra")).toBe("could-not-ask");
  });

  it("gives a row to every generator, in the spending order", async () => {
    const result = await runRelatedGenerators(SEED, contextOf([]), keyless);
    expect(result.statuses.map((row) => row.generator)).toEqual([
      "s2-recommendations",
      "pmra",
      "s2-citations",
      "s2-references",
      "europepmc-citations",
      "europepmc-references",
      "crossref-references",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The seed's identifiers
// ---------------------------------------------------------------------------

describe("what each source is asked with", () => {
  it("skips a source whose identifier the seed lacks, with no call", async () => {
    const { pubmed, crossref, all } = everyGeneratorAnswering();
    const result = await runRelatedGenerators(
      { ids: { arxivId: "2101.00001" } as ExternalIds },
      contextOf(all),
      { ...keyed, budget: plenty() },
    );
    expect(stateOf(result, "pmra")).toBe("could-not-ask");
    expect(stateOf(result, "crossref-references")).toBe("could-not-ask");
    expect(stateOf(result, "europepmc-citations")).toBe("could-not-ask");
    expect(stateOf(result, "s2-references")).toBe("answered");
    expect(pubmed.findRelated).not.toHaveBeenCalled();
    expect(crossref.findRelated).not.toHaveBeenCalled();
  });

  it("gives S2 could-not-ask for a seed with no identifier it reads", async () => {
    const { s2, all } = everyGeneratorAnswering();
    const result = await runRelatedGenerators(
      { ids: { openAlexId: "W1" } as unknown as ExternalIds },
      contextOf(all),
      keyed,
    );
    expect(stateOf(result, "s2-recommendations")).toBe("could-not-ask");
    expect(s2.findRelated).not.toHaveBeenCalled();
  });

  it("sends each source only the identifier it reads", async () => {
    const { pubmed, epmc, crossref, all } = everyGeneratorAnswering();
    await runRelatedGenerators(SEED, contextOf(all), {
      ...keyless,
      budget: plenty(),
    });
    const idsOf = (mock: ReturnType<typeof vi.fn>) =>
      (mock.mock.calls[0]?.[0] as RelatedQuery).ids;
    expect(idsOf(pubmed.findRelated)).toEqual({ pmid: PMID });
    expect(idsOf(epmc.findRelated)).toEqual({ pmid: PMID });
    expect(idsOf(crossref.findRelated)).toEqual({ doi: DOI });
  });

  it("asks Europe PMC by PMCID when there is no PMID", async () => {
    const { epmc, all } = everyGeneratorAnswering();
    await runRelatedGenerators(
      { ids: { doi: DOI, pmcid: "PMC77" } as ExternalIds },
      contextOf(all),
      { ...keyless, budget: plenty() },
    );
    expect((epmc.findRelated.mock.calls[0]?.[0] as RelatedQuery).ids).toEqual({
      pmcid: "PMC77",
    });
    for (const [ids] of epmc.lookup.mock.calls) {
      expect(ids).not.toContainEqual({ doi: DOI });
    }
  });

  it("treats a blank identifier as absent", async () => {
    const { pubmed, crossref, all } = everyGeneratorAnswering();
    const result = await runRelatedGenerators(
      { ids: { doi: "", pmid: "", pmcid: "" } as unknown as ExternalIds },
      contextOf(all),
      keyless,
    );
    expect(stateOf(result, "pmra")).toBe("could-not-ask");
    expect(stateOf(result, "crossref-references")).toBe("could-not-ask");
    expect(stateOf(result, "europepmc-citations")).toBe("could-not-ask");
    expect(pubmed.findRelated).not.toHaveBeenCalled();
    expect(crossref.findRelated).not.toHaveBeenCalled();
  });
});

describe("an arXiv seed (plan/00 §6 item 337(c))", () => {
  const ARXIV_DOI = "10.48550/arXiv.2101.00001";

  it.each([
    ["the DOI's own spelling", ARXIV_DOI],
    ["a lower-case DOI", ARXIV_DOI.toLowerCase()],
  ])("sends ARXIV:, not DOI:, for %s", async (_name: string, doi: string) => {
    const { s2, all } = everyGeneratorAnswering();
    await runRelatedGenerators(
      { ids: { doi } as ExternalIds },
      contextOf(all),
      keyed,
    );
    for (const [query] of s2.findRelated.mock.calls) {
      const ids = (query as RelatedQuery).ids ?? {};
      expect(toSemanticScholarId(ids)).toBe("ARXIV:2101.00001");
      expect(ids.doi).toBeUndefined();
    }
    expect(s2.findRelated).toHaveBeenCalled();
  });

  it("prefers the seed's own arXiv id, and sends it alone", () => {
    expect(
      semanticScholarIdsOf({
        doi: ARXIV_DOI,
        arxivId: "2101.99999",
        pmid: PMID,
      } as ExternalIds),
    ).toEqual({ arxivId: "2101.99999" });
  });

  it("says what toEmbeddingPaperId says for an arXiv record", () => {
    const ids = { doi: ARXIV_DOI, arxivId: "2101.00001" } as ExternalIds;
    expect(toSemanticScholarId(semanticScholarIdsOf(ids))).toBe(
      toEmbeddingPaperId(ids),
    );
    expect(toEmbeddingPaperId(ids)).toBe("ARXIV:2101.00001");
  });

  it("leaves any other DOI as it is, the object itself", () => {
    const ids = { doi: "10.1000/x", pmid: PMID } as ExternalIds;
    expect(semanticScholarIdsOf(ids)).toBe(ids);
    const none = { pmid: PMID } as ExternalIds;
    expect(semanticScholarIdsOf(none)).toBe(none);
  });

  it("falls back to the other identifiers when the DOI's id cannot be read", () => {
    expect(
      semanticScholarIdsOf({
        doi: "10.48550/arXiv.not-an-id",
        pmid: PMID,
      } as ExternalIds),
    ).toEqual({ pmid: PMID });
  });

  it("caches a 404 under the ARXIV: id, so no DOI: answer can be remembered", async () => {
    const memory = memoryCache();
    const s2 = standIn("semanticscholar", {
      recommendations: new BadRequestError(404, "gone"),
    });
    const ctx = contextOf([s2], { cache: memory.cache });
    const asArxiv = await runRelatedGenerators(
      { ids: { doi: ARXIV_DOI } as ExternalIds },
      ctx,
      keyed,
    );
    expect(stateOf(asArxiv, "s2-recommendations")).toBe("not-indexed");
    // The same arXiv id by its other spelling finds that entry...
    const again = await runRelatedGenerators(
      { ids: { arxivId: "2101.00001" } as ExternalIds },
      ctx,
      keyed,
    );
    expect(rowOf(again, "s2-recommendations").fromCache).toBe(true);
    // ...and a `DOI:` request has a key of its own.
    const asDoi = await runRelatedGenerators(
      { ids: { doi: "10.1000/x" } as ExternalIds },
      ctx,
      keyed,
    );
    expect(rowOf(asDoi, "s2-recommendations").fromCache).toBe(false);
  });

  it("hydrates a candidate holding such a DOI by its arXiv id too", async () => {
    const candidate = rec("crossref", ARXIV_DOI.toLowerCase(), {
      ids: { doi: ARXIV_DOI.toLowerCase() } as ExternalIds,
      type: "other",
      title: "",
    });
    const crossref = standIn("crossref", {
      references: pageOf([candidate], () => ({ kind: "reference", rank: 1 })),
    });
    const s2 = standIn("semanticscholar", {}, () => [
      rec("semanticscholar", "abc", {
        ids: {
          doi: ARXIV_DOI.toLowerCase(),
          arxivId: "2101.00001",
        } as ExternalIds,
        title: "Filled in by arXiv id",
        abstract: "Filled.",
      }),
    ]);
    const result = await runRelatedGenerators(SEED, contextOf([s2, crossref]), {
      ...keyed,
      budget: plenty(),
    });
    expect(s2.lookup.mock.calls[0]?.[0]).toEqual([{ arxivId: "2101.00001" }]);
    expect(result.candidates.map((c) => c.work.title)).toEqual([
      "Filled in by arXiv id",
    ]);
  });
});

describe("a DOI-only seed", () => {
  const DOI_ONLY = { ids: { doi: DOI } as ExternalIds };
  const held = (ids: Partial<ExternalIds>) =>
    rec("europepmc", "MED/77", { ids: ids as ExternalIds });

  it("is expanded by one lookup, so similar articles and Europe PMC ask by PMID", async () => {
    const { pubmed, epmc, s2, all } = everyGeneratorAnswering();
    epmc.lookup.mockImplementationOnce(() =>
      Promise.resolve([
        held({ doi: DOI, pmid: "77", pmcid: "PMC77" } as ExternalIds),
      ]),
    );
    const result = await runRelatedGenerators(DOI_ONLY, contextOf(all), {
      ...keyless,
      budget: plenty(),
    });
    expect(epmc.lookup.mock.calls[0]?.[0]).toEqual([{ doi: DOI }]);
    expect((pubmed.findRelated.mock.calls[0]?.[0] as RelatedQuery).ids).toEqual(
      { pmid: "77" },
    );
    expect((epmc.findRelated.mock.calls[0]?.[0] as RelatedQuery).ids).toEqual({
      pmid: "77",
    });
    expect(result.seedIds).toEqual({ doi: DOI, pmid: "77", pmcid: "PMC77" });
    expect(s2.findRelated).not.toHaveBeenCalled();
  });

  it("takes a PMCID alone when that is all it finds", async () => {
    const { epmc, all } = everyGeneratorAnswering();
    epmc.lookup.mockImplementationOnce(() =>
      Promise.resolve([held({ doi: DOI, pmcid: "PMC77" } as ExternalIds)]),
    );
    const result = await runRelatedGenerators(DOI_ONLY, contextOf(all), {
      ...keyless,
      budget: plenty(),
    });
    expect(result.seedIds).toEqual({ doi: DOI, pmcid: "PMC77" });
    expect(stateOf(result, "pmra")).toBe("could-not-ask");
  });

  it("marks Europe PMC not-indexed with no further call when it does not hold the seed", async () => {
    const { pubmed, epmc, all } = everyGeneratorAnswering();
    epmc.lookup.mockImplementation(() => Promise.resolve([]));
    const result = await runRelatedGenerators(DOI_ONLY, contextOf(all), {
      ...keyless,
      budget: plenty(),
    });
    expect(stateOf(result, "europepmc-citations")).toBe("not-indexed");
    expect(stateOf(result, "europepmc-references")).toBe("not-indexed");
    expect(stateOf(result, "pmra")).toBe("could-not-ask");
    expect(epmc.findRelated).not.toHaveBeenCalled();
    expect(pubmed.findRelated).not.toHaveBeenCalled();
    expect(result.seedIds).toEqual({ doi: DOI });
  });

  it("does the same for a record with neither id, such as a preprint", async () => {
    const { epmc, all } = everyGeneratorAnswering();
    epmc.lookup.mockImplementationOnce(() =>
      Promise.resolve([held({ doi: DOI } as ExternalIds)]),
    );
    const result = await runRelatedGenerators(DOI_ONLY, contextOf(all), {
      ...keyless,
      budget: plenty(),
    });
    expect(stateOf(result, "europepmc-citations")).toBe("not-indexed");
    expect(epmc.findRelated).not.toHaveBeenCalled();
  });

  it("still asks Europe PMC by DOI, at its full cost, when the lookup fails", async () => {
    const { epmc, all } = everyGeneratorAnswering();
    epmc.lookup.mockImplementationOnce(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const budget = new RequestBudget(100);
    const result = await runRelatedGenerators(DOI_ONLY, contextOf(all), {
      ...keyless,
      budget,
    });
    expect((epmc.findRelated.mock.calls[0]?.[0] as RelatedQuery).ids).toEqual({
      doi: DOI,
    });
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
    // The expansion 1, two calls at 2 each, Crossref 1; then hydration's 1.
    expect(100 - budget.remaining).toBe(1 + 4 + 1 + 1);
  });

  it("changes nothing when the budget cannot pay for the lookup", async () => {
    const { epmc, all } = everyGeneratorAnswering();
    const result = await runRelatedGenerators(DOI_ONLY, contextOf(all), {
      ...keyless,
      budget: new RequestBudget(0),
    });
    expect(epmc.lookup).not.toHaveBeenCalled();
    expect(stateOf(result, "europepmc-citations")).toBe("over-budget");
  });

  it("does not look up a seed that has a PMID", async () => {
    const { epmc, all } = everyGeneratorAnswering();
    await runRelatedGenerators(SEED, contextOf(all), {
      ...keyless,
      budget: plenty(),
    });
    for (const [ids] of epmc.lookup.mock.calls) {
      expect(ids).not.toContainEqual({ doi: DOI });
    }
  });

  it("remembers the expansion, so a second run spends nothing on it", async () => {
    const memory = memoryCache();
    const { epmc, all } = everyGeneratorAnswering();
    epmc.lookup.mockImplementation((ids: readonly Partial<ExternalIds>[]) =>
      Promise.resolve(
        ids[0]?.doi === DOI
          ? [held({ doi: DOI, pmid: "77" } as ExternalIds)]
          : [],
      ),
    );
    const ctx = contextOf(all, { cache: memory.cache });
    const first = await runRelatedGenerators(DOI_ONLY, ctx, keyless);
    const calls = epmc.lookup.mock.calls.length;
    const second = await runRelatedGenerators(DOI_ONLY, ctx, keyless);
    expect(epmc.lookup.mock.calls.length).toBe(calls);
    expect(second.seedIds).toEqual(first.seedIds);
  });
});

// ---------------------------------------------------------------------------
// Done-when 3 and §0.2 item 19: no key
// ---------------------------------------------------------------------------

describe("without a key", () => {
  it("reads no-key on all three S2 rows, with no call to the adapter at all", async () => {
    const { s2, all } = everyGeneratorAnswering();
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyless,
      budget: plenty(),
    });
    expect(stateOf(result, "s2-recommendations")).toBe("no-key");
    expect(stateOf(result, "s2-citations")).toBe("no-key");
    expect(stateOf(result, "s2-references")).toBe("no-key");
    expect(s2.findRelated).not.toHaveBeenCalled();
    expect(s2.lookup).not.toHaveBeenCalled();
    expect(result.hadKey).toBe(false);
    expect(candidateWithDoi(result, "10.1000/p2").edges).toHaveLength(1);
  });

  it("counts a key probe that fails as no key", async () => {
    const { s2, all } = everyGeneratorAnswering();
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      hasSemanticScholarKey: () => Promise.reject(new Error("store locked")),
    });
    expect(result.hadKey).toBe(false);
    expect(s2.findRelated).not.toHaveBeenCalled();
  });

  it("reports the key on a keyed run, and reads the probe once", async () => {
    const { all } = everyGeneratorAnswering();
    const probe = vi.fn(() => Promise.resolve(true));
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      hasSemanticScholarKey: probe,
    });
    expect(result.hadKey).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("leaves Semantic Scholar out of the abstract fill-in", async () => {
    const lacking = paper("pubmed", 2, { abstract: undefined } as never);
    const pubmed = standIn("pubmed", {
      similar: pageOf([lacking], () => ({ kind: "similar", rank: 1 })),
    });
    const s2 = standIn("semanticscholar", {});
    const epmc = standIn("europepmc", {}, () => []);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([s2, pubmed, epmc]),
      keyless,
    );
    expect(s2.lookup).not.toHaveBeenCalled();
    expect(epmc.lookup).toHaveBeenCalled();
    expect(result.hydration.backfill.steps).toEqual([
      { sourceId: "europepmc", status: "asked", asked: 1, found: 0 },
      {
        sourceId: "semanticscholar",
        status: "not-selected",
        asked: 0,
        found: 0,
      },
    ]);
  });

  it("offers Semantic Scholar to the fill-in on a keyed run", async () => {
    const lacking = paper("pubmed", 2, { abstract: undefined } as never);
    const pubmed = standIn("pubmed", {
      similar: pageOf([lacking], () => ({ kind: "similar", rank: 1 })),
    });
    const s2 = standIn("semanticscholar", {});
    const epmc = standIn("europepmc", {}, () => []);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([s2, pubmed, epmc]),
      { ...keyed, budget: plenty() },
    );
    expect(result.hydration.backfill.steps.map((s) => s.status)).toEqual([
      "asked",
      "asked",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The budget and the fallback wave
// ---------------------------------------------------------------------------

describe("the budget", () => {
  it("is docs/05 §6.1's top figure, with a reserve inside it", () => {
    expect(RELATED_REQUEST_BUDGET).toBeGreaterThanOrEqual(5);
    expect(RELATED_REQUEST_BUDGET).toBeLessThanOrEqual(8);
    expect(RELATED_REQUEST_BUDGET).toBe(8);
    expect(RELATED_HYDRATION_RESERVE).toBe(2);
  });

  it("keeps docs/05 §9.3's relative order, Crossref last", () => {
    const order = RELATED_GENERATORS.map((definition) => definition.id);
    expect(order.indexOf("s2-recommendations")).toBeLessThan(
      order.indexOf("pmra"),
    );
    expect(order.indexOf("pmra")).toBeLessThan(order.indexOf("s2-citations"));
    expect(order.at(-1)).toBe("crossref-references");
  });

  it("uses each signal docs/05 §9.2 has a lifetime for", () => {
    for (const definition of RELATED_GENERATORS) {
      expect(RELATED_TTL_MS[definition.signal]).toBeGreaterThan(0);
    }
    expect(
      Object.fromEntries(RELATED_GENERATORS.map((d) => [d.id, d.signal])),
    ).toEqual({
      "s2-recommendations": "s2-recommendations",
      pmra: "pmra",
      "s2-citations": "citations",
      "s2-references": "references",
      "europepmc-citations": "citations",
      "europepmc-references": "references",
      "crossref-references": "references",
    });
  });

  it("with a key and a healthy S2 spends down to the reserve, and the rest are over budget", async () => {
    const { epmc, crossref, all } = everyGeneratorAnswering();
    const budget = new RequestBudget(RELATED_REQUEST_BUDGET);
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyed,
      budget,
    });
    expect(stateOf(result, "s2-recommendations")).toBe("answered");
    expect(stateOf(result, "pmra")).toBe("answered");
    expect(stateOf(result, "s2-citations")).toBe("answered");
    expect(stateOf(result, "s2-references")).toBe("answered");
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
    expect(stateOf(result, "europepmc-references")).toBe("over-budget");
    expect(stateOf(result, "crossref-references")).toBe("over-budget");
    expect(epmc.findRelated).toHaveBeenCalledTimes(1);
    expect(crossref.findRelated).not.toHaveBeenCalled();
    expect(budget.remaining).toBe(RELATED_HYDRATION_RESERVE);
  });

  it("defaults to RELATED_REQUEST_BUDGET when none is passed", async () => {
    const { all } = everyGeneratorAnswering();
    const result = await runRelatedGenerators(SEED, contextOf(all), keyed);
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
    expect(stateOf(result, "europepmc-references")).toBe("over-budget");
  });

  it("without a key runs all four of its generators inside the budget", async () => {
    const { all } = everyGeneratorAnswering();
    const budget = new RequestBudget(RELATED_REQUEST_BUDGET);
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyless,
      budget,
    });
    expect(stateOf(result, "pmra")).toBe("answered");
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
    expect(stateOf(result, "europepmc-references")).toBe("answered");
    expect(stateOf(result, "crossref-references")).toBe("answered");
    // 2 + 1 + 1 + 1, then one hydration lookup; nothing past the budget.
    expect(budget.remaining).toBe(RELATED_REQUEST_BUDGET - 6);
  });

  it("a keyless DOI-only seed also fits: expansion 1, then 2 + 1 + 1 + 1", async () => {
    const { epmc, all } = everyGeneratorAnswering();
    epmc.lookup.mockImplementationOnce(() =>
      Promise.resolve([
        rec("europepmc", "MED/77", {
          ids: { doi: DOI, pmid: "77" } as ExternalIds,
        }),
      ]),
    );
    const budget = new RequestBudget(RELATED_REQUEST_BUDGET);
    const result = await runRelatedGenerators(
      { ids: { doi: DOI } as ExternalIds },
      contextOf(all),
      { ...keyless, budget },
    );
    expect(
      result.statuses
        .filter((row) => row.sourceId !== "semanticscholar")
        .map((row) => row.state),
    ).toEqual(["answered", "answered", "answered", "answered"]);
  });

  it("charges similar articles two, and refuses them when only one is left above the reserve", async () => {
    const pubmed = standIn("pubmed", { similar: EMPTY });
    const result = await runRelatedGenerators(SEED, contextOf([pubmed]), {
      ...keyless,
      budget: new RequestBudget(RELATED_HYDRATION_RESERVE + 1),
    });
    expect(stateOf(result, "pmra")).toBe("over-budget");
    expect(pubmed.findRelated).not.toHaveBeenCalled();
  });

  it("runs similar articles at exactly two above the reserve", async () => {
    const pubmed = standIn("pubmed", { similar: EMPTY });
    const budget = new RequestBudget(RELATED_HYDRATION_RESERVE + 2);
    const result = await runRelatedGenerators(SEED, contextOf([pubmed]), {
      ...keyless,
      budget,
    });
    expect(stateOf(result, "pmra")).toBe("answered");
    expect(budget.remaining).toBe(RELATED_HYDRATION_RESERVE);
  });

  it("charges a Europe PMC call with no PMID or PMCID two", async () => {
    const { epmc, all } = everyGeneratorAnswering();
    epmc.lookup.mockImplementationOnce(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const result = await runRelatedGenerators(
      { ids: { doi: DOI } as ExternalIds },
      contextOf(all),
      {
        ...keyless,
        // The expansion's 1, one call's 2, the reserve.
        budget: new RequestBudget(1 + 2 + RELATED_HYDRATION_RESERVE),
      },
    );
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
    expect(stateOf(result, "europepmc-references")).toBe("over-budget");
  });

  it("charges a Europe PMC call with a PMCID and no PMID one", async () => {
    const epmc = standIn("europepmc", {});
    const result = await runRelatedGenerators(
      { ids: { doi: DOI, pmcid: "PMC1" } as ExternalIds },
      contextOf([epmc]),
      { ...keyless, budget: new RequestBudget(RELATED_HYDRATION_RESERVE + 1) },
    );
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
  });

  it("plans before anything is sent, so a slow best generator keeps its share", async () => {
    let started = 0;
    const s2 = standIn("semanticscholar", {
      recommendations: () => {
        started += 1;
        return Promise.resolve(EMPTY);
      },
    });
    const pubmed = standIn("pubmed", {
      similar: () => {
        expect(started).toBeLessThanOrEqual(1);
        return Promise.resolve(EMPTY);
      },
    });
    const budget = new RequestBudget(RELATED_HYDRATION_RESERVE + 1);
    const result = await runRelatedGenerators(SEED, contextOf([pubmed, s2]), {
      ...keyed,
      budget,
    });
    expect(stateOf(result, "s2-recommendations")).toBe("answered");
    expect(stateOf(result, "pmra")).toBe("over-budget");
  });
});

describe("the fallback wave (docs/05 §6.1's E, §9.5's ladder)", () => {
  it("runs Europe PMC and Crossref when S2's references fail, spending the reserve", async () => {
    const { s2, epmc, crossref, all } = everyGeneratorAnswering();
    s2.findRelated.mockImplementation((query: RelatedQuery) =>
      query.strategy === "references"
        ? Promise.reject(new RateLimitError(429, undefined, "slow"))
        : Promise.resolve(EMPTY),
    );
    const result = await runRelatedGenerators(SEED, contextOf(all), keyed);
    expect(stateOf(result, "s2-references")).toBe("rate-limited");
    expect(stateOf(result, "europepmc-references")).toBe("answered");
    expect(stateOf(result, "crossref-references")).toBe("over-budget");
    expect(crossref.findRelated).not.toHaveBeenCalled();
    expect(epmc.findRelated).toHaveBeenCalledTimes(2);
  });

  it("lets Crossref run only if one request stays for hydrating its records", async () => {
    const { s2, crossref, all } = everyGeneratorAnswering();
    s2.findRelated.mockImplementation(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const budget = new RequestBudget(RELATED_REQUEST_BUDGET);
    const result = await runRelatedGenerators(
      { ids: { doi: DOI, pmcid: "PMC1" } as ExternalIds },
      contextOf(all),
      { ...keyed, budget },
    );
    // No PMID, so no similar articles: 3 + 1 + 1, then Crossref with 3 left.
    expect(stateOf(result, "pmra")).toBe("could-not-ask");
    expect(stateOf(result, "crossref-references")).toBe("answered");
    expect(crossref.findRelated).toHaveBeenCalledTimes(1);
  });

  it("stands Europe PMC's citations in for S2's when they fail", async () => {
    const { s2, all } = everyGeneratorAnswering();
    s2.findRelated.mockImplementation((query: RelatedQuery) =>
      query.strategy === "citations"
        ? Promise.reject(new UpstreamServerError(503, "down"))
        : Promise.resolve(
            pageOf([paper("semanticscholar", 40)], () => ({
              kind: "reference",
              rank: 1,
            })),
          ),
    );
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyed,
      // S2 3 and similar 2 leave 2, all of it reserve, so the first wave stops there.
      budget: new RequestBudget(7),
    });
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
    expect(stateOf(result, "europepmc-references")).toBe("over-budget");
  });

  it("reaches Crossref through the second wave, leaving its one request", async () => {
    const { s2, crossref, all } = everyGeneratorAnswering();
    s2.findRelated.mockImplementation(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const budget = new RequestBudget(7);
    const result = await runRelatedGenerators(
      { ids: { doi: DOI, pmcid: "PMC1" } as ExternalIds },
      contextOf(all),
      { ...keyed, budget },
    );
    // S2 3, Europe PMC 2: 2 left, all reserve, until the second wave asks for 1 of it.
    expect(stateOf(result, "crossref-references")).toBe("answered");
    expect(crossref.findRelated).toHaveBeenCalledTimes(1);
  });

  it("refuses Crossref at exactly one request left", async () => {
    const { s2, crossref, all } = everyGeneratorAnswering();
    s2.findRelated.mockImplementation(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyed,
      // S2 3, similar 2, Europe PMC 2 in all; 1 left.
      budget: new RequestBudget(8),
    });
    expect(stateOf(result, "europepmc-references")).toBe("answered");
    expect(stateOf(result, "crossref-references")).toBe("over-budget");
    expect(crossref.findRelated).not.toHaveBeenCalled();
  });

  it("runs when S2 answers with nothing, as well as when it fails", async () => {
    const { s2, all } = everyGeneratorAnswering();
    s2.findRelated.mockImplementation(() => Promise.resolve(EMPTY));
    const result = await runRelatedGenerators(SEED, contextOf(all), keyed);
    expect(stateOf(result, "s2-references")).toBe("answered");
    expect(stateOf(result, "europepmc-references")).toBe("answered");
  });

  it("does not run for a list that delivered", async () => {
    const { s2, all } = everyGeneratorAnswering();
    s2.findRelated.mockImplementation((query: RelatedQuery) =>
      query.strategy === "citations"
        ? Promise.reject(new UpstreamServerError(503, "down"))
        : Promise.resolve(
            pageOf([paper("semanticscholar", 4)], () => ({
              kind: "reference",
              rank: 1,
            })),
          ),
    );
    const result = await runRelatedGenerators(SEED, contextOf(all), keyed);
    expect(stateOf(result, "s2-references")).toBe("answered");
    expect(stateOf(result, "europepmc-references")).toBe("over-budget");
  });

  it("does not run on a keyless run, whose reserve stays whole", async () => {
    const { epmc, all } = everyGeneratorAnswering();
    const budget = new RequestBudget(RELATED_HYDRATION_RESERVE + 1);
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyless,
      budget,
    });
    expect(stateOf(result, "pmra")).toBe("over-budget");
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
    expect(stateOf(result, "europepmc-references")).toBe("over-budget");
    expect(epmc.findRelated).toHaveBeenCalledTimes(1);
  });

  it("never second-guesses pmra, which has nothing standing in for it", async () => {
    const { s2, pubmed, all } = everyGeneratorAnswering();
    s2.findRelated.mockImplementation(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const result = await runRelatedGenerators(SEED, contextOf(all), {
      ...keyed,
      budget: new RequestBudget(RELATED_HYDRATION_RESERVE + 1),
    });
    expect(stateOf(result, "pmra")).toBe("over-budget");
    expect(pubmed.findRelated).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

describe("the cache", () => {
  it("answers a second identical run with no request and no budget", async () => {
    const memory = memoryCache();
    const { s2, pubmed, epmc, crossref, all } = everyGeneratorAnswering();
    const ctx = contextOf(all, { cache: memory.cache });
    await runRelatedGenerators(SEED, ctx, { ...keyed, budget: plenty() });
    const calls = () =>
      [s2, pubmed, epmc, crossref].flatMap((a) => a.findRelated.mock.calls)
        .length;
    const before = calls();
    const budget = new RequestBudget(0);
    const second = await runRelatedGenerators(SEED, ctx, { ...keyed, budget });
    expect(calls()).toBe(before);
    expect(second.statuses.every((row) => row.state === "answered")).toBe(true);
    expect(second.statuses.every((row) => row.fromCache)).toBe(true);
    expect(candidateWithDoi(second, "10.1000/p500").edges).toHaveLength(7);
  });

  it("stores each list for its signal's lifetime", async () => {
    const memory = memoryCache();
    const { all } = everyGeneratorAnswering();
    await runRelatedGenerators(SEED, contextOf(all, { cache: memory.cache }), {
      ...keyed,
      budget: plenty(),
    });
    const lifetimes = new Set(memory.sets.map((set) => set.options?.ttlMs));
    expect(lifetimes).toContain(RELATED_TTL_MS["s2-recommendations"]);
    expect(lifetimes).toContain(RELATED_TTL_MS.pmra);
    expect(lifetimes).toContain(RELATED_TTL_MS.citations);
    expect(lifetimes).toContain(RELATED_TTL_MS.references);
  });

  it("keys on the strategy, so a source's two lists do not share an entry", async () => {
    const memory = memoryCache();
    const epmc = standIn("europepmc", {
      citations: pageOf([paper("europepmc", 5)], () => ({
        kind: "citation",
        rank: 1,
      })),
      references: pageOf([paper("europepmc", 6)], () => ({
        kind: "reference",
        rank: 1,
      })),
    });
    const ctx = contextOf([epmc], { cache: memory.cache });
    await runRelatedGenerators(SEED, ctx, keyless);
    const second = await runRelatedGenerators(SEED, ctx, keyless);
    expect(
      second.candidates.map((c) => c.edges.map((e) => e.generator)),
    ).toEqual([["europepmc-citations"], ["europepmc-references"]]);
  });

  it("keys on the identifier it sends, so another seed asks again", async () => {
    const memory = memoryCache();
    const { pubmed, crossref, all } = everyGeneratorAnswering();
    const ctx = contextOf(all, { cache: memory.cache });
    await runRelatedGenerators(SEED, ctx, { ...keyless, budget: plenty() });
    await runRelatedGenerators(
      { ids: { doi: "10.1000/other", pmid: "2" } as ExternalIds },
      ctx,
      { ...keyless, budget: plenty() },
    );
    expect(pubmed.findRelated).toHaveBeenCalledTimes(2);
    expect(crossref.findRelated).toHaveBeenCalledTimes(2);
  });

  it("keys S2's list on the one id it sends, whatever else the seed holds", async () => {
    const memory = memoryCache();
    const s2 = standIn("semanticscholar", {});
    const ctx = contextOf([s2], { cache: memory.cache });
    await runRelatedGenerators(
      { ids: { doi: DOI } as ExternalIds },
      ctx,
      keyed,
    );
    const again = await runRelatedGenerators(SEED, ctx, keyed);
    expect(rowOf(again, "s2-recommendations").fromCache).toBe(true);
  });

  it("keys a list on its strategy and limit, so a longer limit cannot read a shorter list", async () => {
    const memory = memoryCache();
    const s2 = standIn("semanticscholar", {});
    await runRelatedGenerators(
      SEED,
      contextOf([s2], { cache: memory.cache }),
      keyed,
    );
    expect(memory.sets.map((set) => set.key)).toContain(
      relatedCacheKey("s2-recommendations", {
        sourceId: "semanticscholar",
        ids: [`DOI:${DOI}`],
        params: { strategy: "recommendations", limit: 200 },
      }),
    );
  });

  it("remembers a 404 and reads not-indexed from the cache at no cost", async () => {
    const memory = memoryCache();
    const pubmed = standIn("pubmed", {
      similar: new BadRequestError(404, "gone"),
    });
    const ctx = contextOf([pubmed], { cache: memory.cache });
    await runRelatedGenerators(SEED, ctx, keyless);
    const budget = new RequestBudget(0);
    const second = await runRelatedGenerators(SEED, ctx, {
      ...keyless,
      budget,
    });
    expect(pubmed.findRelated).toHaveBeenCalledTimes(1);
    expect(stateOf(second, "pmra")).toBe("not-indexed");
    expect(rowOf(second, "pmra").fromCache).toBe(true);
  });

  it("does not remember a failure, a rate limit or an empty page with a warning", async () => {
    const memory = memoryCache();
    const pubmed = standIn("pubmed", {
      similar: new UpstreamServerError(503, "down"),
    });
    const epmc = standIn("europepmc", {
      citations: new RateLimitError(429, undefined, "slow"),
      references: new UpstreamServerError(503, "down"),
    });
    const crossref = standIn("crossref", {
      references: { ...EMPTY, warnings: ["no list"] },
    });
    const ctx = contextOf([pubmed, epmc, crossref], { cache: memory.cache });
    await runRelatedGenerators(SEED, ctx, keyless);
    expect(memory.sets).toEqual([]);
    await runRelatedGenerators(SEED, ctx, keyless);
    expect(pubmed.findRelated).toHaveBeenCalledTimes(2);
    expect(crossref.findRelated).toHaveBeenCalledTimes(2);
  });

  it("drops raw before anything is stored", async () => {
    const memory = memoryCache();
    const withRaw = {
      ...paper("pubmed", 2),
      raw: { secret: "upstream payload" },
    };
    const pubmed = standIn("pubmed", {
      similar: pageOf([withRaw], () => ({ kind: "similar", rank: 1 })),
    });
    const lacking = {
      ...bareDoi(7),
      raw: { other: "upstream payload" },
    };
    const crossref = standIn("crossref", {
      references: pageOf([lacking], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => [
      {
        ...paper("europepmc", 7),
        raw: { more: "upstream payload" },
      },
    ]);
    await runRelatedGenerators(
      SEED,
      contextOf([pubmed, crossref, epmc], { cache: memory.cache }),
      { ...keyless, budget: plenty() },
    );
    expect(memory.sets.length).toBeGreaterThan(0);
    expect(JSON.stringify(memory.sets)).not.toContain("upstream payload");
  });

  it("honours cache.enabled off", async () => {
    const memory = memoryCache();
    const pubmed = standIn("pubmed", { similar: EMPTY });
    const ctx = contextOf([pubmed], {
      cache: memory.cache,
      config: {
        get: () => false,
      } as unknown as RelatedGeneratorContext["config"],
    });
    await runRelatedGenerators(SEED, ctx, keyless);
    await runRelatedGenerators(SEED, ctx, keyless);
    expect(pubmed.findRelated).toHaveBeenCalledTimes(2);
    expect(memory.sets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Concurrency and cancellation
// ---------------------------------------------------------------------------

describe("concurrency", () => {
  it("runs one host serially and different hosts at once", async () => {
    const running = new Map<string, number>();
    let mostOnOneHost = 0;
    let mostHosts = 0;
    const track =
      (host: string): Answer =>
      async () => {
        running.set(host, (running.get(host) ?? 0) + 1);
        mostOnOneHost = Math.max(mostOnOneHost, running.get(host) ?? 0);
        mostHosts = Math.max(
          mostHosts,
          [...running.values()].filter((n) => n > 0).length,
        );
        await new Promise((done) => setTimeout(done, 5));
        running.set(host, (running.get(host) ?? 0) - 1);
        return EMPTY;
      };
    const s2 = standIn("semanticscholar", {
      recommendations: track("s2"),
      citations: track("s2"),
      references: track("s2"),
    });
    const epmc = standIn("europepmc", {
      citations: track("ebi"),
      references: track("ebi"),
    });
    const pubmed = standIn("pubmed", { similar: track("ncbi") });
    const crossref = standIn("crossref", { references: track("crossref") });
    await runRelatedGenerators(SEED, contextOf([s2, epmc, pubmed, crossref]), {
      ...keyed,
      budget: plenty(),
    });
    expect(mostOnOneHost).toBe(1);
    expect(mostHosts).toBeGreaterThanOrEqual(4);
  });

  it("does not let one host's failure stop the rest of its own queue", async () => {
    const s2 = standIn("semanticscholar", {
      recommendations: new UpstreamServerError(503, "down"),
      citations: pageOf([paper("semanticscholar", 3)], () => ({
        kind: "citation",
        rank: 1,
      })),
    });
    const result = await runRelatedGenerators(SEED, contextOf([s2]), keyed);
    expect(stateOf(result, "s2-recommendations")).toBe("failed");
    expect(stateOf(result, "s2-citations")).toBe("answered");
  });
});

describe("cancellation", () => {
  it("rejects at once when already cancelled, asking nothing", async () => {
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    const { s2, all } = everyGeneratorAnswering();
    const probe = vi.fn(() => Promise.resolve(true));
    await expect(
      runRelatedGenerators(SEED, contextOf(all, { token: tokens.token }), {
        hasSemanticScholarKey: probe,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(probe).not.toHaveBeenCalled();
    expect(s2.findRelated).not.toHaveBeenCalled();
  });

  it("is a rejection, never a status row, when a generator is cancelled", async () => {
    const pubmed = standIn("pubmed", {
      similar: new OperationCancelledError({ kind: "user" }),
    });
    await expect(
      runRelatedGenerators(SEED, contextOf([pubmed]), keyless),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("stops a queue's next call once cancelled", async () => {
    const tokens = createCancellationTokenSource();
    const s2 = standIn("semanticscholar", {
      recommendations: () => {
        tokens.cancel({ kind: "user" });
        return Promise.resolve(EMPTY);
      },
    });
    await expect(
      runRelatedGenerators(SEED, contextOf([s2], { token: tokens.token }), {
        ...keyed,
        budget: plenty(),
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(s2.findRelated).toHaveBeenCalledTimes(1);
  });

  it("rejects when cancelled during the first wave, before any fallback", async () => {
    const tokens = createCancellationTokenSource();
    const pubmed = standIn("pubmed", {
      similar: () => {
        tokens.cancel({ kind: "user" });
        return Promise.resolve(EMPTY);
      },
    });
    await expect(
      runRelatedGenerators(SEED, contextOf([pubmed], { token: tokens.token }), {
        ...keyless,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("hydrates nothing once cancelled during the generators", async () => {
    const tokens = createCancellationTokenSource();
    const crossref = standIn("crossref", {
      references: () => {
        tokens.cancel({ kind: "user" });
        return Promise.resolve(
          pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
        );
      },
    });
    const epmc = standIn("europepmc", {});
    await expect(
      runRelatedGenerators(
        SEED,
        contextOf([crossref, epmc], { token: tokens.token }),
        keyless,
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(epmc.lookup).not.toHaveBeenCalled();
  });

  it("is a rejection when the seed's expansion is cancelled", async () => {
    const epmc = standIn("europepmc", {});
    epmc.lookup.mockImplementation(() =>
      Promise.reject(new OperationCancelledError({ kind: "user" })),
    );
    await expect(
      runRelatedGenerators(
        { ids: { doi: DOI } as ExternalIds },
        contextOf([epmc]),
        keyless,
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("is a rejection when hydration is cancelled", async () => {
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {});
    epmc.lookup.mockImplementation(() =>
      Promise.reject(new OperationCancelledError({ kind: "user" })),
    );
    await expect(
      runRelatedGenerators(SEED, contextOf([crossref, epmc]), keyless),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(epmc.lookup).toHaveBeenCalledTimes(1);
  });

  it("rejects after hydration when cancelled there, before the fill-in", async () => {
    const tokens = createCancellationTokenSource();
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {});
    epmc.lookup.mockImplementation(() => {
      tokens.cancel({ kind: "user" });
      return Promise.resolve([]);
    });
    await expect(
      runRelatedGenerators(
        SEED,
        contextOf([crossref, epmc], { token: tokens.token }),
        keyless,
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(epmc.lookup).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

describe("hydration", () => {
  it("fills a Crossref row from Europe PMC without a key, and takes its type (P5-T09's finding)", async () => {
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => [paper("europepmc", 7)]);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([crossref, epmc]),
      keyless,
    );
    const candidate = candidateWithDoi(result, "10.1000/p7");
    expect(candidate.work.title).toBe(titleOf(7));
    expect(candidate.work.type).toBe("journal-article");
    expect(candidate.edges.map((edge) => edge.generator)).toEqual([
      "crossref-references",
    ]);
    expect(result.hydration.sent).toBe(1);
  });

  it("does not hydrate the raw union: a DOI on two lists is asked once", async () => {
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7), bareDoi(8)], (index) => ({
        kind: "reference",
        rank: index + 1,
      })),
    });
    const epmc = standIn(
      "europepmc",
      {
        citations: pageOf([bareDoi(7)], () => ({ kind: "citation", rank: 1 })),
      },
      () => [paper("europepmc", 7), paper("europepmc", 8)],
    );
    await runRelatedGenerators(SEED, contextOf([crossref, epmc]), keyless);
    expect(epmc.lookup.mock.calls[0]?.[0]).toEqual([
      { doi: "10.1000/p7" },
      { doi: "10.1000/p8" },
    ]);
  });

  it("asks nothing for works that lack nothing, including PubMed's", async () => {
    const pubmed = standIn("pubmed", {
      similar: pageOf([paper("pubmed", 2)], () => ({
        kind: "similar",
        rank: 1,
      })),
    });
    const s2 = standIn("semanticscholar", {});
    const epmc = standIn("europepmc", {});
    await runRelatedGenerators(SEED, contextOf([s2, pubmed, epmc]), {
      ...keyed,
      budget: plenty(),
    });
    expect(s2.lookup).not.toHaveBeenCalled();
    expect(epmc.lookup).not.toHaveBeenCalled();
  });

  it("does not ask about a titled row with no identifier, such as a PPR row", async () => {
    const ppr = rec("europepmc", "PPR/PPR1", {
      type: "preprint",
      title: titleOf(1),
      ids: {} as ExternalIds,
    });
    const epmc = standIn("europepmc", {
      citations: pageOf([ppr], () => ({ kind: "citation", rank: 1 })),
    });
    const result = await runRelatedGenerators(SEED, contextOf([epmc]), keyless);
    expect(epmc.lookup).not.toHaveBeenCalled();
    expect(result.candidates[0]?.work.title).toBe(titleOf(1));
    expect(result.candidates[0]?.work.type).toBe("preprint");
  });

  it("keyed: asks S2 for a missing title or abstract, then Europe PMC for titles only", async () => {
    const noAbstract = paper("semanticscholar", 1, {
      abstract: undefined,
    } as never);
    const s2 = standIn(
      "semanticscholar",
      {
        recommendations: pageOf([noAbstract], () => ({
          kind: "recommendation",
          rank: 1,
        })),
      },
      () => [paper("semanticscholar", 1, { abstract: "From the batch." })],
    );
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => [paper("europepmc", 7)]);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([s2, crossref, epmc]),
      { ...keyed, budget: plenty() },
    );
    expect(s2.lookup.mock.calls[0]?.[0]).toEqual([
      { doi: "10.1000/p1" },
      { doi: "10.1000/p7" },
    ]);
    expect(epmc.lookup.mock.calls[0]?.[0]).toEqual([{ doi: "10.1000/p7" }]);
    expect(candidateWithDoi(result, "10.1000/p1").work.abstract).toBe(
      "From the batch.",
    );
    expect(candidateWithDoi(result, "10.1000/p7").work.title).toBe(titleOf(7));
  });

  it("keyed: does not ask Europe PMC for a title S2 already gave", async () => {
    const s2 = standIn("semanticscholar", {}, () => [
      paper("semanticscholar", 7),
    ]);
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {});
    await runRelatedGenerators(SEED, contextOf([s2, crossref, epmc]), {
      ...keyed,
      budget: plenty(),
    });
    expect(epmc.lookup).not.toHaveBeenCalled();
  });

  it("keyless: does not ask Europe PMC's hydration for an abstract alone (the fill-in does)", async () => {
    const lacking = paper("pubmed", 2, { abstract: undefined } as never);
    const pubmed = standIn("pubmed", {
      similar: pageOf([lacking], () => ({ kind: "similar", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => [
      paper("europepmc", 2, { abstract: "Filled in." }),
    ]);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed, epmc]),
      keyless,
    );
    expect(epmc.lookup).toHaveBeenCalledTimes(1);
    const work = candidateWithDoi(result, "10.1000/p2").work;
    expect(work.abstract).toBe("Filled in.");
    expect(work.provenance.fieldOrigin.abstract).toBe("europepmc");
    expect(result.hydration.backfill.backfilled).toBe(1);
  });

  it("does not re-ask the fill-in what hydration just asked", async () => {
    // Keyed: S2 answers with no abstract, and the fill-in's S2 step reads the cache.
    const memory = memoryCache();
    const noAbstract = paper("semanticscholar", 1, {
      abstract: undefined,
    } as never);
    const s2 = standIn(
      "semanticscholar",
      {
        recommendations: pageOf([noAbstract], () => ({
          kind: "recommendation",
          rank: 1,
        })),
      },
      () => [noAbstract],
    );
    const epmc = standIn("europepmc", {}, () => []);
    await runRelatedGenerators(
      SEED,
      contextOf([s2, epmc], { cache: memory.cache }),
      { ...keyed, budget: plenty() },
    );
    expect(s2.lookup).toHaveBeenCalledTimes(1);
    expect(epmc.lookup).toHaveBeenCalledTimes(1);
  });

  it("leaves out a work no source gave a title, and counts it", async () => {
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7), bareDoi(8)], (index) => ({
        kind: "reference",
        rank: index + 1,
      })),
    });
    const epmc = standIn("europepmc", {}, () => [paper("europepmc", 8)]);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([crossref, epmc]),
      keyless,
    );
    expect(result.candidates.map((c) => c.work.ids.doi)).toEqual([
      "10.1000/p8",
    ]);
    expect(result.hydration.untitled).toBe(1);
  });

  it("makes no candidate of a record a lookup brought that matched nothing asked", async () => {
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => [
      paper("europepmc", 7),
      paper("europepmc", 99),
    ]);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([crossref, epmc]),
      keyless,
    );
    expect(result.candidates.map((c) => c.work.ids.doi)).toEqual([
      "10.1000/p7",
    ]);
  });

  it("joins an answer to the work by identifier, under its own record id", async () => {
    const memory = memoryCache();
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const stray = {
      ...paper("europepmc", 7),
      id: "europepmc:stray",
      nativeId: "stray",
    };
    const epmc = standIn("europepmc", {}, () => [stray]);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([crossref, epmc], { cache: memory.cache }),
      keyless,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.records.map((r) => r.id).sort()).toEqual([
      "crossref:10.1000/p7",
      "europepmc:stray",
    ]);
  });

  it("counts a lookup that failed as sent, and remembers nothing of it", async () => {
    const memory = memoryCache();
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {});
    epmc.lookup.mockImplementation(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const ctx = contextOf([crossref, epmc], { cache: memory.cache });
    const result = await runRelatedGenerators(SEED, ctx, keyless);
    expect(result.hydration.sent).toBe(1);
    expect(result.hydration.unsent).toBe(0);
    epmc.lookup.mockClear();
    await runRelatedGenerators(SEED, ctx, keyless);
    expect(epmc.lookup).toHaveBeenCalled();
  });

  it("makes no candidate of an answer that stays apart from every list's work", async () => {
    const found = paper("pubmed", 2, {
      ids: { doi: "10.1000/p2", pmid: "22" } as ExternalIds,
      abstract: undefined,
    } as never);
    const pubmed = standIn("pubmed", {
      similar: pageOf([found], () => ({ kind: "similar", rank: 1 })),
    });
    // The same PMID under another DOI, naming the first as its other version: a link.
    const s2 = standIn("semanticscholar", {}, () => [
      paper("semanticscholar", 3, {
        ids: { doi: "10.1000/elsewhere", pmid: "22" } as ExternalIds,
        relatedVersionIds: { doi: "10.1000/p2" } as ExternalIds,
      }),
    ]);
    const result = await runRelatedGenerators(SEED, contextOf([s2, pubmed]), {
      ...keyed,
      budget: plenty(),
    });
    expect(result.candidates.map((c) => c.work.ids.doi)).toEqual([
      "10.1000/p2",
    ]);
    expect(result.candidates[0]?.edges).toHaveLength(1);
    expect(result.links.length).toBe(1);
  });

  it("does not spend twice on what hydration asked, with the cache off", async () => {
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => []);
    const budget = new RequestBudget(10);
    await runRelatedGenerators(SEED, contextOf([crossref, epmc]), {
      ...keyless,
      budget,
    });
    expect(epmc.lookup).toHaveBeenCalledTimes(1);
    // Europe PMC's two lists, Crossref's one, and the one lookup.
    expect(budget.remaining).toBe(10 - 3 - 1);
  });

  it("turns a failed lookup into a row and goes on to the next source", async () => {
    const s2 = standIn("semanticscholar", {});
    s2.lookup.mockImplementation(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => [paper("europepmc", 7)]);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([s2, crossref, epmc]),
      { ...keyed, budget: plenty() },
    );
    expect(result.hydration.failed).toEqual([
      {
        sourceId: "semanticscholar",
        code: new UpstreamServerError(503, "x").code,
      },
    ]);
    expect(candidateWithDoi(result, "10.1000/p7").work.title).toBe(titleOf(7));
  });

  describe("a budget shorter than the identifiers", () => {
    const dois = Array.from({ length: 150 }, (_, i) => bareDoi(1000 + i));
    const list = () =>
      standIn("crossref", {
        references: pageOf(dois, (index) => ({
          kind: "reference",
          rank: index + 1,
        })),
      });

    /** Crossref's list in the cache, so the budget given is hydration's alone. */
    async function withListCached(): Promise<MemoryCache> {
      const memory = memoryCache();
      await runRelatedGenerators(
        SEED,
        contextOf([list()], { cache: memory.cache }),
        {
          ...keyless,
          budget: new RequestBudget(RELATED_HYDRATION_RESERVE + 1),
        },
      );
      return memory;
    }

    it("sends the first 100 and counts 50 when it covers one request", async () => {
      const memory = await withListCached();
      const asked: string[] = [];
      const epmc = standIn("europepmc", {}, (ids) => {
        asked.push(...ids.map((entry) => String(entry.doi)));
        return [];
      });
      const budget = new RequestBudget(1);
      const result = await runRelatedGenerators(
        SEED,
        contextOf([list(), epmc], { cache: memory.cache }),
        { ...keyless, budget },
      );
      expect(rowOf(result, "crossref-references").fromCache).toBe(true);
      expect(result.hydration.sent).toBe(100);
      expect(result.hydration.unsent).toBe(50);
      expect(asked.slice(0, 2)).toEqual(["10.1000/p1000", "10.1000/p1001"]);
      expect(asked).toHaveLength(100);
      expect(budget.remaining).toBe(0);
    });

    it("sends all 150 when it covers two requests", async () => {
      const memory = await withListCached();
      const epmc = standIn("europepmc", {}, () => []);
      const budget = new RequestBudget(2);
      const result = await runRelatedGenerators(
        SEED,
        contextOf([list(), epmc], { cache: memory.cache }),
        { ...keyless, budget },
      );
      // One call: the adapter makes the two requests its batches come to.
      expect(epmc.lookup).toHaveBeenCalledTimes(1);
      expect(epmc.lookup.mock.calls[0]?.[0]).toHaveLength(150);
      expect(result.hydration.sent).toBe(150);
      expect(result.hydration.unsent).toBe(0);
      expect(budget.remaining).toBe(0);
    });

    it("sends nothing and counts all 150 when it covers none", async () => {
      const memory = await withListCached();
      const epmc = standIn("europepmc", {}, () => []);
      const result = await runRelatedGenerators(
        SEED,
        contextOf([list(), epmc], { cache: memory.cache }),
        { ...keyless, budget: new RequestBudget(0) },
      );
      expect(epmc.lookup).not.toHaveBeenCalled();
      expect(result.hydration.sent).toBe(0);
      expect(result.hydration.unsent).toBe(150);
      expect(result.hydration.untitled).toBe(150);
    });
  });

  it("goes on without a source's lookup, in expansion, hydration and the fill-in", async () => {
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {});
    const result = await runRelatedGenerators(
      { ids: { doi: DOI } as ExternalIds },
      contextOf([
        crossref.source,
        { ...epmc.source, lookup: undefined } as unknown as LiteratureSource,
      ]),
      keyless,
    );
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
    expect((epmc.findRelated.mock.calls[0]?.[0] as RelatedQuery).ids).toEqual({
      doi: DOI,
    });
    expect(result.hydration.failed).toEqual([]);
    expect(result.hydration.backfill.steps).toContainEqual(
      expect.objectContaining({ sourceId: "europepmc", status: "no-adapter" }),
    );
  });

  it("stores each identifier's own answer: the record, or missing for 7 days", async () => {
    const memory = memoryCache();
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7), bareDoi(8)], (index) => ({
        kind: "reference",
        rank: index + 1,
      })),
    });
    const epmc = standIn("europepmc", {}, () => [paper("europepmc", 8)]);
    await runRelatedGenerators(
      SEED,
      contextOf([crossref, epmc], { cache: memory.cache }),
      keyless,
    );
    const stored = (n: number) =>
      memory.sets.find(
        (set) =>
          set.key ===
          relatedCacheKey("metadata", {
            sourceId: "europepmc",
            ids: [`doi:10.1000/p${String(n)}`],
          }),
      );
    expect(stored(7)?.value).toEqual({ outcome: "missing" });
    expect(stored(7)?.options?.ttlMs).toBe(RELATED_NEGATIVE_TTL_MS);
    expect(stored(8)?.value).toMatchObject({ outcome: "value" });
    expect(stored(8)?.options?.ttlMs).toBe(RELATED_TTL_MS.metadata);
  });

  it("reads a title of spaces as no title", async () => {
    const pubmed = standIn("pubmed", {
      similar: pageOf([paper("pubmed", 2, { title: "   " })], () => ({
        kind: "similar",
        rank: 1,
      })),
    });
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed]),
      keyless,
    );
    expect(result.candidates).toEqual([]);
    expect(result.hydration.untitled).toBe(1);
  });

  it("remembers what a lookup could not find, for its 7 days", async () => {
    const memory = memoryCache();
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => []);
    const ctx = contextOf([crossref, epmc], { cache: memory.cache });
    await runRelatedGenerators(SEED, ctx, keyless);
    await runRelatedGenerators(SEED, ctx, keyless);
    expect(epmc.lookup).toHaveBeenCalledTimes(1);
  });

  it("answers a lookup from the cache the second time, with the record", async () => {
    const memory = memoryCache();
    const crossref = standIn("crossref", {
      references: pageOf([bareDoi(7)], () => ({ kind: "reference", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => [paper("europepmc", 7)]);
    const ctx = contextOf([crossref, epmc], { cache: memory.cache });
    await runRelatedGenerators(SEED, ctx, keyless);
    const second = await runRelatedGenerators(SEED, ctx, {
      ...keyless,
      budget: new RequestBudget(0),
    });
    expect(epmc.lookup).toHaveBeenCalledTimes(1);
    expect(candidateWithDoi(second, "10.1000/p7").work.title).toBe(titleOf(7));
    expect(second.hydration.sent).toBe(0);
  });

  it("passes the reporter to the fill-in, and works without one", async () => {
    const lacking = paper("pubmed", 2, { abstract: undefined } as never);
    const pubmed = standIn("pubmed", {
      similar: pageOf([lacking], () => ({ kind: "similar", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => []);
    const setProgress = vi.fn();
    await runRelatedGenerators(SEED, contextOf([pubmed, epmc]), {
      ...keyless,
      progress: {
        setProgress,
        increment: () => undefined,
        warn: () => undefined,
      } as never,
    });
    expect(setProgress).toHaveBeenCalled();
  });

  it("restamps a work the fill-in changed from the context's clock", async () => {
    const lacking = paper("pubmed", 2, { abstract: undefined } as never);
    const pubmed = standIn("pubmed", {
      similar: pageOf([lacking], () => ({ kind: "similar", rank: 1 })),
    });
    const epmc = standIn("europepmc", {}, () => [
      paper("europepmc", 2, { abstract: "Filled in." }),
    ]);
    const clock = createManualClock(NOW);
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed, epmc], { clock }),
      keyless,
    );
    expect(
      candidateWithDoi(result, "10.1000/p2").work.normalizedAtEpochMs,
    ).toBe(NOW);
  });

  it("reports the fill-in's failed step in its warnings, and still returns the works", async () => {
    const lacking = paper("pubmed", 2, { abstract: undefined } as never);
    const pubmed = standIn("pubmed", {
      similar: pageOf([lacking], () => ({ kind: "similar", rank: 1 })),
    });
    const epmc = standIn("europepmc", {});
    epmc.lookup.mockImplementation(() =>
      Promise.reject(new UpstreamServerError(503, "down")),
    );
    const result = await runRelatedGenerators(
      SEED,
      contextOf([pubmed, epmc]),
      keyless,
    );
    expect(result.hydration.warnings).toHaveLength(1);
    expect(result.candidates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// merge's `type`
// ---------------------------------------------------------------------------

describe("merge reads other as absent when choosing type", () => {
  const minimal = bareDoi(7);

  it("takes a classified type over Crossref's other, though Crossref leads the order", () => {
    const { work } = merge([minimal, paper("europepmc", 7)], NOW);
    expect(work.type).toBe("journal-article");
    expect(work.provenance.fieldOrigin.type).toBeUndefined();
  });

  it("names the winner only when two records classified it", () => {
    const { work } = merge(
      [paper("crossref", 7, { type: "review" }), paper("europepmc", 7)],
      NOW,
    );
    expect(work.type).toBe("review");
    expect(work.provenance.fieldOrigin.type).toBe("crossref");
  });

  it("stays other when no record classified it", () => {
    const { work } = merge(
      [minimal, paper("europepmc", 7, { type: "other" })],
      NOW,
    );
    expect(work.type).toBe("other");
    expect(work.provenance.fieldOrigin.type).toBeUndefined();
  });

  it("leaves a single record's other alone", () => {
    expect(merge([minimal], NOW).work.type).toBe("other");
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
  /** The real adapters; Semantic Scholar's transport records and fails. */
  function shippedAdapters(secrets?: SecretStore) {
    const clock = createManualClock(NOW);
    const s2Requests: string[] = [];
    const ebiRequests: string[] = [];
    const held = (doi: string, n: number) => ({
      id: `9${String(n)}`,
      source: "MED",
      pmid: `9${String(n)}`,
      doi,
      title: `Recorded shape ${doi} ${String(n * 7919)}`,
      authorString: "Author A.",
      pubYear: "2020",
      abstractText: "A filled-in abstract.",
    });
    const http: HttpClient = {
      request(_method, url, options?: HttpOptions) {
        const host = new URL(url).hostname;
        if (host === SEMANTICSCHOLAR_HOST) {
          s2Requests.push(url);
          return Promise.reject(new Error(`asked Semantic Scholar: ${url}`));
        }
        if (host === CROSSREF_HOST) {
          return Promise.resolve(
            ok(url, recordedBody("crossref/related", "work-with-references")),
          );
        }
        if (host === NCBI_HOST) {
          if (url.includes("elink.fcgi")) {
            return Promise.resolve(
              ok(url, recordedBody("pubmed/related", "elink-two-seeds")),
            );
          }
          const params = new URLSearchParams(
            options?.body ?? url.slice(url.indexOf("?") + 1),
          );
          return Promise.resolve(ok(url, `IDS:${params.get("id") ?? ""}`));
        }
        if (host === EBI_HOST) {
          ebiRequests.push(url);
          if (url.includes("/citations")) {
            return Promise.resolve(
              ok(url, recordedBody("europepmc/related", "citations")),
            );
          }
          if (url.includes("/references")) {
            return Promise.resolve(
              ok(url, recordedBody("europepmc/related", "references")),
            );
          }
          // Hand-written, on `lookup`'s `core` shape: no such answer was recorded.
          const params = new URLSearchParams(
            options?.body ?? url.slice(url.indexOf("?") + 1),
          );
          const dois = [
            ...(params.get("query") ?? "").matchAll(/DOI:"([^"]+)"/gu),
          ].map((match) => match[1] ?? "");
          const results = dois.slice(0, 40).map(held);
          return Promise.resolve(
            ok(
              url,
              JSON.stringify({
                hitCount: results.length,
                resultList: { result: results },
              }),
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
      ...(secrets !== undefined && { secrets }),
    });
    const sources: LiteratureSource[] = [
      s2,
      createPubmedSource({
        http,
        clock,
        // No neighbour's `efetch` was recorded (`pubmedElink.test.ts` says why).
        mapRecords: (body: string) =>
          body
            .slice(4)
            .split(",")
            .filter((pmid) => pmid !== "")
            .map((pmid) =>
              rec("pubmed", pmid, {
                ids: { pmid } as ExternalIds,
                title: `PubMed neighbour ${pmid} ${String(Number(pmid) % 9973)}`,
                abstract: "A neighbour's abstract.",
              }),
            ),
      }),
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
    return { s2, sources, s2Requests, ebiRequests };
  }

  const RECORDED_SEED = {
    ids: {
      doi: CROSSREF_DOI_WITH_REFERENCES,
      pmid: EUROPEPMC_RELATED_SEED_PMID,
    } as ExternalIds,
  };

  it("Done when: completes on a transport that fails on Semantic Scholar, its rows reading no key", async () => {
    const { s2, sources, s2Requests } = shippedAdapters();
    const result = await runRelatedGenerators(
      RECORDED_SEED,
      contextOf(sources),
      {
        hasSemanticScholarKey: () => s2.hasUsableApiKey(),
        lookupSemanticScholar: (ids, call) => s2.lookupKeyed(ids, call),
      },
    );

    expect(s2Requests).toEqual([]);
    expect(result.hadKey).toBe(false);
    expect(stateOf(result, "s2-recommendations")).toBe("no-key");
    expect(stateOf(result, "s2-citations")).toBe("no-key");
    expect(stateOf(result, "s2-references")).toBe("no-key");
    expect(stateOf(result, "pmra")).toBe("answered");
    expect(stateOf(result, "europepmc-citations")).toBe("answered");
    expect(stateOf(result, "europepmc-references")).toBe("answered");
    expect(stateOf(result, "crossref-references")).toBe("answered");
    expect(result.hydration.failed).toEqual([]);
    expect(
      result.hydration.backfill.steps.find(
        (step) => step.sourceId === "semanticscholar",
      )?.status ?? "not-reached",
    ).not.toBe("asked");
    expect(result.candidates.length).toBeGreaterThanOrEqual(20);
    for (const candidate of result.candidates) {
      expect(candidate.edges.length).toBeGreaterThanOrEqual(1);
      expect(candidate.work.title.trim()).not.toBe("");
    }
  });

  // `plan/00` §6 item 339(b). Each store says it holds a key.
  const BROKEN_STORES: readonly [string, Partial<SecretStore>][] = [
    ["unreadable", { get: () => Promise.reject(new Error("locked")) }],
    ["blank", { get: () => Promise.resolve("   ") }],
    ["absent", { get: () => Promise.resolve(undefined) }],
  ];

  function storeSayingYes(store: Partial<SecretStore>): SecretStore {
    return {
      has: () => Promise.resolve(true),
      ...store,
    } as unknown as SecretStore;
  }

  it.each(BROKEN_STORES)(
    "a store that says yes over a %s value is a keyless run, and nothing goes to Semantic Scholar",
    async (_name, store) => {
      const { s2, sources, s2Requests } = shippedAdapters(
        storeSayingYes(store),
      );
      expect(await s2.hasApiKey()).toBe(true);
      const result = await runRelatedGenerators(
        RECORDED_SEED,
        contextOf(sources),
        {
          hasSemanticScholarKey: () => s2.hasUsableApiKey(),
          lookupSemanticScholar: (ids, call) => s2.lookupKeyed(ids, call),
        },
      );
      expect(s2Requests).toEqual([]);
      expect(result.hadKey).toBe(false);
      expect(stateOf(result, "s2-citations")).toBe("no-key");
    },
  );

  it.each(BROKEN_STORES)(
    "even under the weak probe, hydration and the fill-in send nothing over a %s value",
    async (_name, store) => {
      const { s2, sources, s2Requests } = shippedAdapters(
        storeSayingYes(store),
      );
      const result = await runRelatedGenerators(
        RECORDED_SEED,
        contextOf(sources),
        {
          hasSemanticScholarKey: () => s2.hasApiKey(),
          lookupSemanticScholar: (ids, call) => s2.lookupKeyed(ids, call),
          budget: new RequestBudget(30),
        },
      );
      expect(result.hadKey).toBe(true);
      expect(result.hydration.sent).toBeGreaterThan(0);
      expect(s2Requests).toEqual([]);
    },
  );

  it("sends Semantic Scholar's records through the option, never the registry's lookup", async () => {
    const lookupSemanticScholar = vi.fn(() =>
      Promise.resolve([] as readonly SourceRecord[]),
    );
    const s2 = standIn("semanticscholar", {
      recommendations: pageOf(
        [paper("semanticscholar", 11, { title: "" })],
        () => ({
          kind: "recommendation",
          rank: 1,
        }),
      ),
    });
    await runRelatedGenerators(SEED, contextOf([s2]), {
      ...keyed,
      lookupSemanticScholar,
    });
    expect(lookupSemanticScholar).toHaveBeenCalled();
    expect(s2.lookup).not.toHaveBeenCalled();
  });

  it("fills Crossref's bare rows through Europe PMC's lookup, and counts what stays bare", async () => {
    const { sources, ebiRequests } = shippedAdapters();
    const result = await runRelatedGenerators(
      RECORDED_SEED,
      contextOf(sources),
      keyless,
    );
    const crossrefOnly = result.candidates.filter((candidate) =>
      candidate.edges.every((edge) => edge.generator === "crossref-references"),
    );
    expect(crossrefOnly.length).toBeGreaterThan(0);
    for (const candidate of crossrefOnly) {
      expect(candidate.work.title).toMatch(/^Recorded shape /u);
      expect(candidate.work.type).not.toBeUndefined();
    }
    expect(result.hydration.untitled).toBeGreaterThan(0);
    expect(result.hydration.sent).toBeGreaterThan(0);
    expect(ebiRequests.some((url) => url.includes("/search"))).toBe(true);
  });

  it("stays inside the default budget", async () => {
    const { sources } = shippedAdapters();
    const budget = new RequestBudget(RELATED_REQUEST_BUDGET);
    const result = await runRelatedGenerators(
      RECORDED_SEED,
      contextOf(sources),
      { ...keyless, budget },
    );
    expect(budget.remaining).toBeGreaterThanOrEqual(0);
    expect(
      result.statuses.filter((row) => row.state === "over-budget"),
    ).toEqual([]);
  });
});
