/**
 * `P5-T25`: the recommend pipeline's stages, endings and wiring.
 *
 * Plain Node, no network, no model and no key. The three stores are the shipped ones on
 * real SQLite (`node:sqlite`), migrated by `runMigrations`; `readProfileCollection`,
 * `buildProfileStats`, `withTopicsAndSeeds`, `runProfileCall`, `runRecommendGenerators`,
 * `ensureEmbeddings`, both filters, `scoreRecommendations` and `diversify` are the real
 * ones. Only the sources, the library and the model are stand-ins. Semantic Scholar's answers
 * here are hand-written, so a pass says what this pipeline does with them and nothing about
 * the service (`plan/00` §6 item 335(a); `P5-T31`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import { buildPipelineSet } from "../../../src/bootstrap/registerPipelines";
import type { Cache } from "../../../src/core/cache/cache";
import { createManualClock } from "../../../src/core/clock";
import { Semaphore } from "../../../src/core/concurrency";
import {
  NetworkError,
  OperationCancelledError,
  StorageError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type { HttpClient } from "../../../src/core/http/client";
import {
  createCancellationTokenSource,
  type CancellationToken,
} from "../../../src/core/jobQueue/cancellation";
import { CompositeProgressReporter } from "../../../src/core/jobQueue/progress";
import { createLogger } from "../../../src/core/logger";
import { SEMANTICSCHOLAR_HOST } from "../../../src/core/rateLimit/hostLimiter";
import { MAIN_WINDOW_MESSAGE_IDS } from "../../../src/i18n/keys";
import type { ModelPrices } from "../../../src/llm/shared/pricing";
import type { ModelInfo } from "../../../src/llm/types";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { ExternalIds, SourceId } from "../../../src/model/ids";
import type { CollectionProfile } from "../../../src/model/profile";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import { recommendRoutineStore } from "../../../src/pipeline/recommend/profileCall";
import {
  createRecommendPipeline,
  HEADLESS_RECOMMEND_SURFACE,
  RECOMMEND_DISPLAY_NAME_KEY,
  RECOMMEND_STAGES,
  validateRecommendInput,
  type RecommendEgressRecord,
  type RecommendPipelineDeps,
} from "../../../src/pipeline/recommend/recommendPipeline";
import type {
  RecommendEditedProfileInput,
  RecommendFailed,
  RecommendInput,
  RecommendOutput,
  RecommendProfileResult,
  RecommendRows,
  RecommendSurface,
} from "../../../src/pipeline/recommend/types";
import { runRelatedGenerators } from "../../../src/pipeline/related/generators";
import {
  createBudgetGuard,
  createSessionSpendCounter,
  withBudget,
} from "../../../src/pipeline/shared/budget";
import { createPrivacyPolicy } from "../../../src/pipeline/shared/privacyPolicy";
import {
  readRelated,
  relatedCacheDeps,
} from "../../../src/pipeline/shared/relatedFetch";
import { RequestBudget } from "../../../src/pipeline/shared/requestBudget";
import { stageSlices, type PipelineContext } from "../../../src/pipeline/types";
import { getPref, type PrefName } from "../../../src/prefs";
import { createPromptRegistry } from "../../../src/prompts";
import { createSourceRegistry } from "../../../src/sources/registry";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import { createSemanticScholarSource } from "../../../src/sources/semanticscholar/semanticscholarSource";
import type {
  LiteratureSource,
  RelatedPage,
  SourceQuery,
} from "../../../src/sources/types";
import {
  collectionProfileId,
  createCollectionProfileStore,
  createEmbeddingStore,
  createRecommendationStore,
  recommendationId,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";
import type { CollectionWorkRead } from "../../../src/zotero/itemMapper";
import type { LibraryIndex } from "../../../src/zotero/libraryIndex";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockModel,
  mockSettings,
} from "../../helpers/mockLLM";

const here = dirname(fileURLToPath(import.meta.url));
const promptDir = resolve(here, "../../../src/prompts");
const PROMPTS = createPromptRegistry(
  readdirSync(promptDir)
    .filter((name) => name.endsWith(".md"))
    .map((fileName) => ({
      fileName,
      text: readFileSync(resolve(promptDir, fileName), "utf8"),
    })),
);

const NOW = Date.UTC(2026, 10, 5, 12);
const LIBRARY_ID = 3;
const COLLECTION_KEY = "COLLKEY1";
const PROFILE_ID = collectionProfileId(LIBRARY_ID, COLLECTION_KEY);
const STRONG = "report-model";
const DIMENSIONS = 768;
const PRICES: ModelPrices = {
  inputPerMTokUsd: 1,
  outputPerMTokUsd: 2,
  cachedInputPerMTokUsd: undefined,
  tiers: [],
  asOfEpochMs: 1,
  source: "documented-table",
};
const DEAR: ModelPrices = {
  ...PRICES,
  inputPerMTokUsd: 1_000_000,
  outputPerMTokUsd: 1_000_000,
};
const GOOD_ANSWER = JSON.stringify({
  focusStatement: "Synthetic studies of a made-up intervention.",
  coherence: "Close.",
  coherenceScore: 80,
  coreTopics: [{ topic: "dosing", weight: 1 }],
  inclusionSignals: ["a trial of the intervention"],
  exclusionSignals: [],
  suggestedQueryTerms: ["madeupterm", "dose response"],
});

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------

function memberDoi(n: number): string {
  return `10.1000/m${String(n)}`;
}

function memberItem(n: number): CollectionWorkRead {
  return {
    itemKey: `ITEM${String(n).padStart(4, "0")}`,
    dateModified: "2026-01-01 00:00:00",
    dateAdded: "2025-06-01 00:00:00",
    work: {
      workKey: `doi:${memberDoi(n)}`,
      ids: { doi: memberDoi(n) },
      type: "journal-article",
      title: `Ionizable lipid nanoparticle delivery member ${String(n)}`,
      abstract: `An abstract about lipid delivery ${String(n)}.`,
      authors: [{ family: `Member${String(n)}`, given: "Ann" }],
      containerTitle: "Journal of Fixtures",
      publishedDate: { year: 2024, iso: "2024" },
      provenance: { recordIds: [], fieldOrigin: {}, seenIn: [] },
      normalizedAtEpochMs: 1,
    } as unknown as CanonicalWork,
  };
}

function membersOf(count: number): CollectionWorkRead[] {
  return Array.from({ length: count }, (_, n) => memberItem(n));
}

/** A candidate's record. A name `undefined` in `work` leaves that field out. */
function paper(
  sourceId: SourceId,
  n: number,
  work: Partial<Record<keyof SourceRecord["work"], unknown>> = {},
): SourceRecord {
  const merged: Record<string, unknown> = {
    ids: { doi: `10.1000/p${String(n)}` } as ExternalIds,
    type: "journal-article",
    title: `Hepatocyte gene editing candidate ${String(n)} ${String(n * 7919)}`,
    abstract: `Abstract of candidate ${String(n)}.`,
    authors: [{ family: `Author${String(n)}`, given: "Bo" }],
    publishedDate: { year: 2026, iso: "2026" },
    ...work,
  };
  for (const name of Object.keys(merged)) {
    if (merged[name] === undefined) Reflect.deleteProperty(merged, name);
  }
  return {
    id: `${sourceId}:n${String(n)}`,
    sourceId,
    nativeId: `n${String(n)}`,
    work: merged as unknown as SourceRecord["work"],
    retrievedAtEpochMs: NOW,
    missingFields: [],
  };
}

function pageOf(records: readonly SourceRecord[]): RelatedPage {
  return {
    records,
    edges: records.map((_, index) => ({
      kind: "recommendation" as const,
      rank: index + 1,
    })),
    totalAvailable: records.length,
    nextCursor: undefined,
    warnings: [],
  };
}

/** A unit vector at `angle` radians in the first two of 768 dimensions. */
function vectorAt(angle: number): readonly number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[0] = Math.cos(angle);
  values[1] = Math.sin(angle);
  return values;
}

// ---------------------------------------------------------------------------
// Real stores on real SQLite
// ---------------------------------------------------------------------------

async function migratedConnection(): Promise<
  SqlConnection & { readonly db: DatabaseSync }
> {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  const connection = {
    db,
    queryAsync(sql: string, params?: readonly SqlParam[]) {
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql: string, params?: readonly SqlParam[]) {
      const row = db.prepare(sql).get(...bind(params));
      return Promise.resolve(row === undefined ? false : Object.values(row)[0]);
    },
    async executeTransaction<T>(func: () => Promise<T>): Promise<T> {
      db.exec("BEGIN");
      try {
        const result = await func();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    closeDatabase() {
      db.close();
      return Promise.resolve();
    },
  } as unknown as SqlConnection & { readonly db: DatabaseSync };
  await runMigrations(connection);
  return connection;
}

function memoryCache(): Cache & { readonly gets: string[] } {
  const entries = new Map<string, unknown>();
  const gets: string[] = [];
  const id = (namespace: string, key: string): string => `${namespace}/${key}`;
  return {
    gets,
    get: <T>(namespace: string, key: string) => {
      gets.push(id(namespace, key));
      return Promise.resolve(entries.get(id(namespace, key)) as T | undefined);
    },
    set: (namespace: string, key: string, value: unknown) => {
      entries.set(id(namespace, key), value);
      return Promise.resolve();
    },
  } as unknown as Cache & { readonly gets: string[] };
}

// ---------------------------------------------------------------------------
// A world
// ---------------------------------------------------------------------------

interface WorldOptions {
  readonly keyed?: boolean;
  readonly items?: readonly CollectionWorkRead[];
  /** Semantic Scholar's recommendations, once a seed exists. */
  readonly recommended?: readonly SourceRecord[];
  /** Every registered keyword source's answer. */
  readonly keyword?: readonly SourceRecord[];
  readonly keywordFails?: Error;
  readonly recommendFails?: Error;
  readonly lookupKeyed?: (
    ids: readonly Partial<ExternalIds>[],
  ) => readonly SourceRecord[];
  readonly lookupEpmc?: (
    ids: readonly Partial<ExternalIds>[],
  ) => readonly SourceRecord[];
  readonly lookupCrossref?: (
    ids: readonly Partial<ExternalIds>[],
  ) => readonly SourceRecord[];
  /** The vector for an id sent, or nothing for "no usable vector". */
  readonly vector?: (id: string) => readonly number[] | undefined;
  readonly fetch?: {
    fails?: (ids: readonly string[]) => Error | undefined;
    keyed?: boolean;
  };
  readonly profiles?: "memory" | "none" | "reject";
  readonly recommendations?: "memory" | "none" | "reject";
  readonly embeddings?: "memory" | "none" | "reject";
  readonly hasProviderKey?: boolean;
  readonly prices?: ModelPrices;
  readonly limits?: { run: () => number; session: () => number };
  readonly mode?: "balanced" | "strict";
  readonly modelInfo?: (
    providerId: string,
    id: string,
  ) => ModelInfo | undefined;
  readonly script?: Parameters<typeof mockLLM>[0];
  readonly byDoi?: Readonly<Record<string, number>>;
  readonly byWorkKey?: Readonly<Record<string, number>>;
  readonly recordEgress?: RecommendPipelineDeps["recordEgress"];
  readonly cacheEnabled?: boolean;
}

function knownPolicyModel(id: string): ModelInfo {
  return mockModel(id, {
    contextWindowTokens: 200_000,
    maxOutputTokens: 64_000,
    dataPolicy: {
      trainsOnInputByDefault: "no",
      retention: { days: "zero", note: "" },
    },
  });
}

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
    findExisting(ids) {
      const byId = ids.doi === undefined ? undefined : byDoi[ids.doi];
      return byId === undefined
        ? undefined
        : { itemID: byId, matchedOn: "doi" };
    },
  };
}

function registered(
  id: SourceId,
  keyword: () => readonly SourceRecord[],
  lookupAnswer?: (
    ids: readonly Partial<ExternalIds>[],
  ) => readonly SourceRecord[],
) {
  const searches: SourceQuery[] = [];
  const lookup = vi.fn((ids: readonly Partial<ExternalIds>[]) =>
    Promise.resolve(lookupAnswer?.(ids) ?? []),
  );
  const findRelated = vi.fn(() => Promise.resolve(pageOf([])));
  const source = {
    id,
    rateLimitKey: `${id}.example`,
    capabilities: { keywordSearch: true, dateFilter: true },
    explainQuery: () => "explained",
    findRelated,
    lookup,
    async *searchAll(query: SourceQuery): AsyncGenerator<SourceRecord> {
      searches.push(query);
      await Promise.resolve();
      yield* keyword();
    },
  } as unknown as LiteratureSource;
  return { source, searches, lookup, findRelated };
}

async function worldOf(options: WorldOptions = {}) {
  const keyed = options.keyed ?? true;
  const connection = await migratedConnection();
  const clock = createManualClock(NOW);
  const logs: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => void logs.push(line) },
    clock,
    level: "debug",
  });

  let items = options.items ?? membersOf(6);
  const libraryTermSources = vi.fn(() => Promise.resolve([]));
  const libraryIndex = vi.fn(() =>
    Promise.resolve(indexHolding(options.byDoi, options.byWorkKey)),
  );
  const libraryItems = vi.fn(() => Promise.resolve([]));
  const readCollection = vi.fn(() =>
    Promise.resolve({ name: "Secret collection", items }),
  );

  const keywordRecords = (): readonly SourceRecord[] => {
    if (options.keywordFails !== undefined) throw options.keywordFails;
    return options.keyword ?? [];
  };
  const epmc = registered("europepmc", keywordRecords, options.lookupEpmc);
  const silentUnlessFailing = (): readonly SourceRecord[] => {
    if (options.keywordFails !== undefined) throw options.keywordFails;
    return [];
  };
  const crossref = registered(
    "crossref",
    silentUnlessFailing,
    options.lookupCrossref,
  );
  const s2Registered = registered("semanticscholar", silentUnlessFailing);
  const sources = createSourceRegistry();
  for (const { source } of [epmc, crossref, s2Registered]) {
    sources.register(source);
  }

  const fetchEmbeddings = vi.fn((ids: readonly string[]) => {
    const failure = options.fetch?.fails?.(ids);
    if (failure !== undefined) return Promise.reject(failure);
    if (options.fetch?.keyed === false) {
      return Promise.resolve({
        keyed: false,
        vectors: new Map(),
        withoutVector: [],
      });
    }
    const vector =
      options.vector ?? ((id: string) => vectorAt((id.length % 7) * 0.2));
    const held = ids.flatMap((id) => {
      const value = vector(id);
      return value === undefined ? [] : [[id, value] as const];
    });
    return Promise.resolve({
      keyed: true,
      vectors: new Map(held),
      withoutVector: ids.filter((id) => vector(id) === undefined),
    });
  });
  const hasUsableApiKey = vi.fn(() => Promise.resolve(keyed));
  const lookupKeyed = vi.fn((ids: readonly Partial<ExternalIds>[]) =>
    Promise.resolve(options.lookupKeyed?.(ids) ?? []),
  );
  const recommend = vi.fn((): Promise<RelatedPage> =>
    options.recommendFails !== undefined
      ? Promise.reject(options.recommendFails)
      : Promise.resolve(pageOf(options.recommended ?? [])),
  );
  const findRelated = vi.fn((): Promise<RelatedPage> =>
    options.recommendFails !== undefined
      ? Promise.reject(options.recommendFails)
      : Promise.resolve(pageOf([])),
  );
  const findSimilarForSeeds = vi.fn(() => Promise.resolve([]));

  const openOr = <T>(
    how: "memory" | "none" | "reject" | undefined,
    store: T,
  ) => {
    return (): Promise<T | undefined> => {
      if (how === "none") return Promise.resolve(undefined);
      if (how === "reject") return Promise.reject(new Error("no database"));
      return Promise.resolve(store);
    };
  };
  const profileStore = createCollectionProfileStore(connection);
  const recommendationStore = createRecommendationStore(connection);
  const embeddingStore = createEmbeddingStore(connection);
  const putProfile = vi.spyOn(profileStore, "put");
  const putRow = vi.spyOn(recommendationStore, "put");

  const provider = mockLLM(options.script ?? [chatResponse(GOOD_ANSWER)], {
    id: "openrouter",
    models: [knownPolicyModel(STRONG)],
  });
  const prices = options.prices ?? PRICES;
  const router = withBudget(
    mockLLMRouter(
      [provider],
      mockSettings({
        activeProvider: "openrouter",
        reportModel: STRONG,
        keyPresent: { openrouter: true },
      }),
    ),
    { pricesFor: () => prices, now: () => clock.now() },
  );
  const settings = new Map<string, Record<string, unknown>>();
  let hasProviderKey = options.hasProviderKey ?? true;

  const deps: RecommendPipelineDeps = {
    library: {
      readCollection,
      libraryTermSources,
      libraryIndex,
      libraryItems,
    },
    semanticscholar: {
      hasUsableApiKey,
      lookupKeyed,
      fetchEmbeddings,
      rateLimitKey: SEMANTICSCHOLAR_HOST,
      recommend,
      findRelated,
    } as unknown as RecommendPipelineDeps["semanticscholar"],
    pubmed: {
      rateLimitKey: "pubmed.example",
      findSimilarForSeeds,
    } as unknown as RecommendPipelineDeps["pubmed"],
    pool: new Semaphore(4),
    profiles: openOr(options.profiles, profileStore),
    recommendations: openOr(options.recommendations, recommendationStore),
    embeddings: openOr(options.embeddings, embeddingStore),
    profileCall: {
      prompts: () => Promise.resolve(PROMPTS),
      credentials: { hasKey: () => Promise.resolve(hasProviderKey) },
      prices: () => prices,
      modelInfo:
        (options.modelInfo as
          RecommendPipelineDeps["profileCall"]["modelInfo"] | undefined) ??
        ((_provider, id) => knownPolicyModel(id)),
      baseUrls: { effectiveHost: () => "openrouter.ai" },
      egressAcknowledged: () => true,
      routine: recommendRoutineStore({
        get: (l, c) => Promise.resolve(settings.get(`${String(l)}/${c}`)),
        put: (l, c, value) => (
          settings.set(`${String(l)}/${c}`, { ...value }),
          Promise.resolve()
        ),
        delete: (l, c) => (
          settings.delete(`${String(l)}/${c}`),
          Promise.resolve()
        ),
      }),
    },
    clock,
    ...(options.recordEgress !== undefined && {
      recordEgress: options.recordEgress,
    }),
  };
  const pipeline = createRecommendPipeline(deps);

  const cache = memoryCache();
  const budget = createBudgetGuard({
    session: createSessionSpendCounter(),
    limits: options.limits ?? { run: () => 0, session: () => 0 },
  });
  const config: Partial<Record<PrefName, unknown>> = {
    cacheEnabled: options.cacheEnabled ?? true,
    logRequestBodies: false,
    searchYears: 3,
    sources: "europepmc,crossref,semanticscholar,bogus",
  };
  const contextWith = (
    token: CancellationToken = createCancellationTokenSource().token,
    onStage?: (stage: string) => void,
  ): PipelineContext & { readonly stages: string[] } => {
    const stages: string[] = [];
    return {
      stages,
      jobId: "test-job",
      token,
      progress: new CompositeProgressReporter({
        clock,
        sinks: [{ update: () => undefined }],
        throttleMs: 0,
      }),
      logger,
      clock,
      sources,
      cache,
      budget,
      llm: router,
      tts: undefined,
      zotero: undefined,
      config: {
        get: (name: PrefName) =>
          name in config ? config[name] : getPref(name),
      },
      privacy: createPrivacyPolicy(options.mode ?? "balanced"),
      checkpoint(state: unknown) {
        const { stage } = state as { readonly stage: string };
        stages.push(stage);
        onStage?.(stage);
        return Promise.resolve();
      },
      resumeState: undefined,
    } as unknown as PipelineContext & { readonly stages: string[] };
  };

  const confirm = vi.fn<RecommendSurface["confirm"]>(() =>
    Promise.resolve({ kind: "run", raise: undefined, dontAskAgain: false }),
  );
  const ask = vi.fn<RecommendSurface["ask"]>(() => Promise.resolve("resume"));
  const surface: RecommendSurface = { confirm, ask };

  return {
    connection,
    clock,
    logs,
    deps,
    pipeline,
    cache,
    provider,
    budget,
    sources,
    epmc,
    crossref,
    s2Registered,
    fetchEmbeddings,
    hasUsableApiKey,
    lookupKeyed,
    recommend,
    findRelated,
    findSimilarForSeeds,
    readCollection,
    libraryTermSources,
    libraryIndex,
    libraryItems,
    profileStore,
    recommendationStore,
    embeddingStore,
    putProfile,
    putRow,
    confirm,
    ask,
    surface,
    contextWith,
    setItems(next: readonly CollectionWorkRead[]) {
      items = next;
    },
    setProviderKey(value: boolean) {
      hasProviderKey = value;
    },
    execute(input: RecommendInput, ctx = contextWith(), on = surface) {
      return pipeline.execute(input, ctx, on);
    },
  };
}

type World = Awaited<ReturnType<typeof worldOf>>;

const PROFILE_ONLY: RecommendInput = {
  libraryID: LIBRARY_ID,
  collectionKey: COLLECTION_KEY,
  mode: "profile-only",
};

function editedInput(
  profile: CollectionProfile,
  extra: Partial<RecommendEditedProfileInput> = {},
): RecommendEditedProfileInput {
  return {
    libraryID: LIBRARY_ID,
    collectionKey: COLLECTION_KEY,
    mode: "edited-profile",
    profile,
    edits: { removedTerms: [], addedTerms: [] },
    showDismissed: false,
    peerReviewedOnly: false,
    exploration: 0.25,
    ...extra,
  };
}

function expectProfile(output: RecommendOutput): RecommendProfileResult {
  if (output.outcome !== "succeeded" || output.ending !== "profile") {
    throw new Error(`expected a profile, got ${JSON.stringify(output)}`);
  }
  return output;
}

function expectRows(output: RecommendOutput): RecommendRows {
  if (output.outcome !== "succeeded" || output.ending !== "rows") {
    throw new Error(`expected rows, got ${JSON.stringify(output)}`);
  }
  return output;
}

function expectFailed(output: RecommendOutput): RecommendFailed {
  if (output.outcome !== "failed") {
    throw new Error(`expected a failure, got ${JSON.stringify(output)}`);
  }
  return output;
}

async function shownProfile(world: World): Promise<CollectionProfile> {
  return expectProfile(await world.execute(PROFILE_ONLY)).profile;
}

/** The ids `lookupKeyed` was sent, across every call. */
function lookedUp(world: World): readonly string[] {
  return world.lookupKeyed.mock.calls.flatMap(([ids]) =>
    ids.map((entry) => entry.doi ?? JSON.stringify(entry)),
  );
}

function keysOfRows(output: RecommendRows): readonly string[] {
  return output.rows.map((row) => row.recommendation.work.workKey);
}

// ---------------------------------------------------------------------------
// The profile half
// ---------------------------------------------------------------------------

describe("a profile-only run", () => {
  it("builds, asks, stores and returns the profile, and makes no candidate request", async () => {
    const world = await worldOf({ keyword: [paper("europepmc", 1)] });
    const ctx = world.contextWith();
    const output = expectProfile(await world.execute(PROFILE_ONLY, ctx));
    expect(output.built).toBe(true);
    expect(output.vectorsIncomplete).toBe(false);
    expect(output.profile.origin).toBe("llm");
    expect(output.profile.embeddingModel).toBe("specter_v2");
    expect(output.profile.centroids.length).toBeGreaterThan(0);
    expect(output.egress).toBeDefined();
    expect(output.stageReached).toBe("ApplyingStoredEdits");
    expect(ctx.stages).toEqual([
      "ProfileCheck",
      "BuildingStats",
      "Centroids",
      "ProfileCall",
      "ApplyingStoredEdits",
    ]);
    expect(world.confirm).toHaveBeenCalledTimes(1);
    expect(world.provider.calls).toHaveLength(1);
    expect(await world.profileStore.get(PROFILE_ID)).toMatchObject({
      origin: "llm",
      membershipHash: output.profile.membershipHash,
    });

    // FR-44's order: nothing about candidates went anywhere.
    expect(world.recommend).not.toHaveBeenCalled();
    expect(world.findRelated).not.toHaveBeenCalled();
    expect(world.findSimilarForSeeds).not.toHaveBeenCalled();
    expect(world.epmc.searches).toEqual([]);
    expect(world.epmc.lookup).not.toHaveBeenCalled();
    expect(world.lookupKeyed).not.toHaveBeenCalled();
    expect(world.libraryItems).not.toHaveBeenCalled();
  });

  it("a second run on an unchanged collection makes no model call and reuses the vectors", async () => {
    const world = await worldOf();
    const first = expectProfile(await world.execute(PROFILE_ONLY));
    expect(world.fetchEmbeddings).toHaveBeenCalledTimes(1);
    const ctx = world.contextWith();
    const second = expectProfile(await world.execute(PROFILE_ONLY, ctx));
    expect(second.built).toBe(false);
    expect(second.egress).toBeUndefined();
    expect(second.profile.builtAtEpochMs).toBe(first.profile.builtAtEpochMs);
    expect(ctx.stages).toEqual(["ProfileCheck", "ApplyingStoredEdits"]);
    expect(world.provider.calls).toHaveLength(1);
    expect(world.confirm).toHaveBeenCalledTimes(1);
    expect(world.fetchEmbeddings).toHaveBeenCalledTimes(1);
    expect(world.libraryTermSources).toHaveBeenCalledTimes(1);
    expect(world.logs.some((line) => line.includes("Secret collection"))).toBe(
      false,
    );
  });

  it("a changed collection rebuilds, re-applies the stored edits, and asks only when a call is due", async () => {
    const world = await worldOf({
      script: [chatResponse(GOOD_ANSWER), chatResponse(GOOD_ANSWER)],
    });
    const shown = await shownProfile(world);
    const edits = { removedTerms: ["lipid"], addedTerms: ["mrna"] };
    expectRows(await world.execute(editedInput(shown, { edits })));
    expect(world.provider.calls).toHaveLength(1);
    expect(world.confirm).toHaveBeenCalledTimes(1);

    // The answer is cached under the membership hash, so a new hash is a call due.
    world.setItems([...membersOf(6), memberItem(7)]);
    const grown = expectProfile(await world.execute(PROFILE_ONLY));
    expect(grown.built).toBe(true);
    expect(grown.egress).toBeDefined();
    expect(grown.profile.origin).toBe("llm");
    expect(grown.profile.userEdits).toEqual(edits);
    expect(world.provider.calls).toHaveLength(2);
    expect(world.confirm).toHaveBeenCalledTimes(2);
    expect((await world.profileStore.get(PROFILE_ID))?.userEdits).toEqual(
      edits,
    );
  });

  it("a space that changed is a rebuild: keyed, then keyless", async () => {
    const world = await worldOf();
    await shownProfile(world);
    world.hasUsableApiKey.mockResolvedValue(false);
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(output.built).toBe(true);
    expect(output.profile.embeddingModel).toBeUndefined();
    expect(output.profile.centroids).toEqual([]);
    expect(world.fetchEmbeddings).toHaveBeenCalledTimes(1);
  });

  it("refuses below 5 items with the counted message, before the library pass", async () => {
    const world = await worldOf({ items: membersOf(4) });
    const output = expectFailed(await world.execute(PROFILE_ONLY));
    expect(output.tooFewItems).toEqual({ itemCount: 4, minimum: 5 });
    expect(output.error.messageKey).toBe("rh-error-recommend-too-few-items");
    expect(output.error.code).toBe("TOO_FEW_ITEMS");
    expect(output.error.retryable).toBe(false);
    expect(output.stageReached).toBe("ProfileCheck");
    expect(output.statuses).toEqual([]);
    expect(world.libraryTermSources).not.toHaveBeenCalled();
    expect(world.hasUsableApiKey).not.toHaveBeenCalled();
    expect(MAIN_WINDOW_MESSAGE_IDS).toContain(output.error.messageKey);
  });

  it("the user who declines ends Cancelled, with nothing sent and nothing stored", async () => {
    const world = await worldOf();
    world.confirm.mockResolvedValue({ kind: "cancelled" });
    const output = await world.execute(PROFILE_ONLY);
    expect(output).toEqual({
      outcome: "cancelled",
      stageReached: "ProfileCall",
    });
    expect(world.provider.calls).toHaveLength(0);
    expect(await world.profileStore.get(PROFILE_ID)).toBeUndefined();
  });

  it("`run` declines every question, so nothing is spent without a window", async () => {
    const world = await worldOf();
    const output = await world.pipeline.run(PROFILE_ONLY, world.contextWith());
    expect(output.outcome).toBe("cancelled");
    expect(world.provider.calls).toHaveLength(0);
    await expect(HEADLESS_RECOMMEND_SURFACE.ask({} as never)).resolves.toBe(
      "cancel",
    );
  });

  describe("a stored heuristic profile", () => {
    it("with no provider is fresh; with one configured since it is rebuilt", async () => {
      const world = await worldOf({ hasProviderKey: false });
      const first = expectProfile(await world.execute(PROFILE_ONLY));
      expect(first.profile.origin).toBe("heuristic");
      expect(first.heuristicReason).toBe("no-provider");
      expect(first.warningId).toBeUndefined();
      expect(first.built).toBe(true);

      const second = expectProfile(await world.execute(PROFILE_ONLY));
      expect(second.built).toBe(false);
      expect(second.heuristicReason).toBeUndefined();

      world.setProviderKey(true);
      const third = expectProfile(await world.execute(PROFILE_ONLY));
      expect(third.built).toBe(true);
      expect(third.profile.origin).toBe("llm");
      expect(world.provider.calls).toHaveLength(1);
    });

    it("with an answer in the cache it is rebuilt, for nothing", async () => {
      const world = await worldOf();
      const shown = await shownProfile(world);
      await world.profileStore.put({ ...shown, origin: "heuristic" });
      const output = expectProfile(await world.execute(PROFILE_ONLY));
      expect(output.built).toBe(true);
      expect(output.profile.origin).toBe("llm");
      expect(world.provider.calls).toHaveLength(1);
      expect(world.confirm).toHaveBeenCalledTimes(1);
    });

    it("stays fresh on an edited-profile run, which asks no model", async () => {
      const world = await worldOf({ hasProviderKey: false });
      const shown = await shownProfile(world);
      world.setProviderKey(true);
      const output = expectRows(await world.execute(editedInput(shown)));
      expect(output.profileRebuilt).toBe(false);
      expect(output.profile.origin).toBe("heuristic");
      expect(world.provider.calls).toHaveLength(0);
    });

    it("an unusable answer falls back, warns, logs its egress, and is tried again next time", async () => {
      const recordEgress = vi.fn(() => Promise.resolve());
      const world = await worldOf({
        // Repaired once, then retried once by `completeJSON`, then it falls back.
        script: [
          chatResponse(JSON.stringify({ wrong: true })),
          chatResponse(JSON.stringify({ wrong: true })),
          chatResponse(JSON.stringify({ wrong: true })),
          chatResponse(GOOD_ANSWER),
        ],
        recordEgress,
      });
      const first = expectProfile(await world.execute(PROFILE_ONLY));
      expect(first.heuristicReason).toBe("unusable-answer");
      expect(first.warningId).toBeDefined();
      expect(first.egress).toBeDefined();
      expect(recordEgress).toHaveBeenCalledTimes(1);
      expect((await world.profileStore.get(PROFILE_ID))?.origin).toBe(
        "heuristic",
      );

      const second = expectProfile(await world.execute(PROFILE_ONLY));
      expect(second.built).toBe(true);
      expect(second.profile.origin).toBe("llm");
      expect(world.confirm).toHaveBeenCalledTimes(2);
    });

    it("a privacy mode that refuses the model leaves it fresh", async () => {
      const world = await worldOf({ hasProviderKey: false });
      await shownProfile(world);
      world.setProviderKey(true);
      const strict = await worldOf({
        hasProviderKey: true,
        mode: "strict",
        modelInfo: () => undefined,
      });
      const stored = await world.profileStore.get(PROFILE_ID);
      if (stored === undefined) throw new Error("no profile");
      await strict.profileStore.put(stored);
      const output = expectProfile(await strict.execute(PROFILE_ONLY));
      expect(output.built).toBe(false);
      expect(strict.confirm).not.toHaveBeenCalled();
    });
  });

  it("a privacy mode that refuses the model on a build ends Failed, sending nothing", async () => {
    const world = await worldOf({ mode: "strict", modelInfo: () => undefined });
    const output = expectFailed(await world.execute(PROFILE_ONLY));
    expect(output.stageReached).toBe("ProfileCall");
    expect(world.provider.calls).toHaveLength(0);
    expect(world.confirm).not.toHaveBeenCalled();
    expect(await world.profileStore.get(PROFILE_ID)).toBeUndefined();
  });
});

describe("finding 3 of P5-T21: a profile from incomplete vectors", () => {
  const CASES = [
    ["a batch that failed", { fails: () => new UpstreamServerError(500, "x") }],
    ["a batch that found no key", { keyed: false }],
  ] as const;

  it.each(CASES)(
    "%s: not stored, said so, and the next run fetches again and pays nothing",
    async (_name, fetch) => {
      const options: WorldOptions = { fetch: { ...fetch } };
      const world = await worldOf(options);
      const first = expectProfile(await world.execute(PROFILE_ONLY));
      expect(first.vectorsIncomplete).toBe(true);
      expect(first.built).toBe(true);
      expect(await world.profileStore.get(PROFILE_ID)).toBeUndefined();
      expect(world.putProfile).not.toHaveBeenCalled();
      expect(world.provider.calls).toHaveLength(1);
      const fetchesBefore = world.fetchEmbeddings.mock.calls.length;

      const again = expectProfile(await world.execute(PROFILE_ONLY));
      expect(world.fetchEmbeddings.mock.calls.length).toBeGreaterThan(
        fetchesBefore,
      );
      expect(again.built).toBe(true);
      expect(world.provider.calls).toHaveLength(1);
      expect(world.confirm).toHaveBeenCalledTimes(1);
    },
  );

  it("an edited-profile run keeps the edits on the row that is there, and uses them this run", async () => {
    let failing = false;
    const world = await worldOf({
      fetch: {
        fails: () => (failing ? new UpstreamServerError(500, "x") : undefined),
      },
    });
    const shown = await shownProfile(world);
    world.setItems([...membersOf(6), memberItem(7)]);
    failing = true;
    const edits = { removedTerms: ["lipid"], addedTerms: ["mrna"] };
    const output = expectRows(
      await world.execute(editedInput(shown, { edits })),
    );
    expect(output.vectorsIncomplete).toBe(true);
    expect(output.profileRebuilt).toBe(true);
    expect(output.profile.userEdits).toEqual(edits);
    const stored = await world.profileStore.get(PROFILE_ID);
    expect(stored?.userEdits).toEqual(edits);
    expect(stored?.membershipHash).toBe(shown.membershipHash);
  });

  it("a profile-only run on failing vectors leaves the row and its edits as they were", async () => {
    let failing = false;
    const world = await worldOf({
      fetch: {
        fails: () => (failing ? new UpstreamServerError(500, "x") : undefined),
      },
    });
    const shown = await shownProfile(world);
    const edits = { removedTerms: ["lipid"], addedTerms: ["mrna"] };
    expectRows(await world.execute(editedInput(shown, { edits })));
    world.setItems([...membersOf(6), memberItem(7)]);
    failing = true;
    world.putProfile.mockClear();
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(output.vectorsIncomplete).toBe(true);
    expect(output.built).toBe(true);
    // What the user said is on this run's profile, read from the row (b-edits-stored).
    expect(output.profile.userEdits).toEqual(edits);
    expect(world.putProfile).not.toHaveBeenCalled();
    const stored = await world.profileStore.get(PROFILE_ID);
    expect(stored?.userEdits).toEqual(edits);
    expect(stored?.membershipHash).toBe(shown.membershipHash);
  });

  it("an edited-profile run with no row keeps the edits for that run only", async () => {
    const world = await worldOf({
      fetch: { fails: () => new UpstreamServerError(500, "x") },
    });
    const shown = expectProfile(await world.execute(PROFILE_ONLY)).profile;
    const edits = { removedTerms: [], addedTerms: ["mrna"] };
    const output = expectRows(
      await world.execute(editedInput(shown, { edits })),
    );
    expect(output.profile.userEdits).toEqual(edits);
    expect(await world.profileStore.get(PROFILE_ID)).toBeUndefined();
  });

  it("a member with no vector is not incomplete: the service was asked and has none", async () => {
    const world = await worldOf({
      vector: (id) => (id.endsWith("m1") ? undefined : vectorAt(0.3)),
    });
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(output.vectorsIncomplete).toBe(false);
    expect(await world.profileStore.get(PROFILE_ID)).toBeDefined();
  });
});

describe("a pause at a spend ceiling", () => {
  const CEILING = { run: () => 0.01, session: () => 0 };

  it("keeps the stage, asks once, and goes on after a raise without a second cost question", async () => {
    const world = await worldOf({ prices: DEAR, limits: CEILING });
    let stageAtAsk: string | undefined;
    const ctx = world.contextWith();
    world.ask.mockImplementation(() => {
      stageAtAsk = ctx.stages.at(-1);
      return Promise.resolve("resume");
    });
    const output = expectProfile(await world.execute(PROFILE_ONLY, ctx));
    expect(stageAtAsk).toBe("ProfileCall");
    expect(world.ask).toHaveBeenCalledTimes(1);
    const question = world.ask.mock.calls[0]?.[0];
    expect(question?.reason).toBe("budget-stop");
    expect(question?.stop.ceiling).toBe("run");
    expect(question?.raiseToUsd).toBeGreaterThan(0.01);
    expect(world.confirm).toHaveBeenCalledTimes(1);
    expect(world.provider.calls).toHaveLength(1);
    expect(output.profile.origin).toBe("llm");
    expect(world.budget.usage().run).toBeDefined();
  });

  it.each([
    ["stop", () => Promise.resolve("cancel" as const)],
    ["a question that failed", () => Promise.reject(new Error("no window"))],
  ])(
    "%s ends Cancelled with the stage it stopped at",
    async (_name, answer) => {
      const world = await worldOf({ prices: DEAR, limits: CEILING });
      world.ask.mockImplementation(answer);
      const output = await world.execute(PROFILE_ONLY);
      expect(output).toEqual({
        outcome: "cancelled",
        stageReached: "ProfileCall",
      });
      expect(world.provider.calls).toHaveLength(0);
    },
  );

  it("a refusal with no ceiling in it is not a pause", async () => {
    const world = await worldOf({
      script: [new StorageError("nope") as never],
    });
    const output = expectFailed(await world.execute(PROFILE_ONLY));
    expect(world.ask).not.toHaveBeenCalled();
    expect(output.stageReached).toBe("ProfileCall");
  });
});

describe("the egress log", () => {
  it("is written once, before the request went, and not for a cached answer", async () => {
    const recordEgress = vi.fn<
      NonNullable<RecommendPipelineDeps["recordEgress"]>
    >(() => Promise.resolve());
    // Incomplete vectors: not stored, so the second run rebuilds over the cached answer.
    const world = await worldOf({
      recordEgress,
      fetch: { fails: () => new UpstreamServerError(500, "x") },
    });
    const first = expectProfile(await world.execute(PROFILE_ONLY));
    expect(recordEgress).toHaveBeenCalledTimes(1);
    expect(recordEgress.mock.calls[0]?.[0]).toEqual({
      libraryID: LIBRARY_ID,
      collectionKey: COLLECTION_KEY,
      mode: "profile-only",
      egress: first.egress,
    });
    const second = expectProfile(await world.execute(PROFILE_ONLY));
    expect(second.built).toBe(true);
    expect(second.egress).toBeUndefined();
    expect(recordEgress).toHaveBeenCalledTimes(1);
  });

  it("a log that cannot be written warns, and the run goes on", async () => {
    const world = await worldOf({
      recordEgress: () => Promise.reject(new Error("no queue")),
    });
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(output.egress).toBeDefined();
    expect(
      world.logs.some((line) =>
        line.includes("egress log could not be written"),
      ),
    ).toBe(true);
  });

  it("is on the ending of a run cancelled after the request was sent", async () => {
    const source = createCancellationTokenSource();
    const world = await worldOf();
    const ctx = world.contextWith(source.token, (stage) => {
      if (stage === "ApplyingStoredEdits") source.cancel({ kind: "user" });
    });
    // A rows run, so a boundary follows the stage where the cancel lands.
    const shown = {
      ...(await shownProfile(await worldOf())),
      builtAtEpochMs: 1,
    };
    const output = await world.execute(editedInput(shown), ctx);
    expect(output.outcome).toBe("cancelled");
    expect(output.egress).toBeDefined();
  });

  /** A world whose log says how many requests had reached the provider when it was written. */
  async function loggingWorld(options: WorldOptions) {
    const requestsAtWrite: number[] = [];
    const records: RecommendEgressRecord[] = [];
    const holder: { world?: World } = {};
    const world = await worldOf({
      ...options,
      recordEgress: (record) => {
        requestsAtWrite.push(holder.world?.provider.calls.length ?? -1);
        records.push(record);
        return Promise.resolve();
      },
    });
    holder.world = world;
    return { world, requestsAtWrite, records };
  }

  it("a transport failure in flight leaves one entry, written before the request", async () => {
    const { world, requestsAtWrite, records } = await loggingWorld({
      script: [new NetworkError("connection reset")],
    });
    const output = expectFailed(await world.execute(PROFILE_ONLY));
    expect(world.provider.calls).toHaveLength(1);
    expect(requestsAtWrite).toEqual([0]);
    expect(records).toHaveLength(1);
    expect(records[0]?.egress).toEqual(output.egress);
    expect(output.error.code).toBe(new NetworkError("x").code);
  });

  it("a cancel in flight leaves one entry, written before the request", async () => {
    const source = createCancellationTokenSource();
    const { world, requestsAtWrite, records } = await loggingWorld({
      script: [
        () => {
          source.cancel({ kind: "user" });
          return new OperationCancelledError({ kind: "user" });
        },
      ],
    });
    const output = await world.execute(
      PROFILE_ONLY,
      world.contextWith(source.token),
    );
    expect(output.outcome).toBe("cancelled");
    expect(world.provider.calls).toHaveLength(1);
    expect(requestsAtWrite).toEqual([0]);
    expect(records).toHaveLength(1);
    expect(records[0]?.egress).toEqual(output.egress);
  });

  it("a repair and a retry add no entry", async () => {
    const { world, requestsAtWrite } = await loggingWorld({
      script: [
        chatResponse(JSON.stringify({ wrong: true })),
        chatResponse(JSON.stringify({ wrong: true })),
        chatResponse(GOOD_ANSWER),
      ],
    });
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(output.profile.origin).toBe("llm");
    expect(world.provider.calls).toHaveLength(3);
    expect(requestsAtWrite).toEqual([0]);
  });

  it("a ceiling's refusal writes nothing, and the resume that sends writes one", async () => {
    const stopped = await loggingWorld({
      prices: DEAR,
      limits: { run: () => 0.01, session: () => 0 },
    });
    stopped.world.ask.mockImplementation(() => Promise.resolve("cancel"));
    const cancelled = await stopped.world.execute(PROFILE_ONLY);
    expect(cancelled).toEqual({
      outcome: "cancelled",
      stageReached: "ProfileCall",
    });
    expect(stopped.world.provider.calls).toHaveLength(0);
    expect(stopped.records).toEqual([]);

    const resumed = await loggingWorld({
      prices: DEAR,
      limits: { run: () => 0.01, session: () => 0 },
    });
    const output = expectProfile(await resumed.world.execute(PROFILE_ONLY));
    expect(resumed.world.ask).toHaveBeenCalledTimes(1);
    expect(resumed.world.provider.calls).toHaveLength(1);
    expect(resumed.requestsAtWrite).toEqual([0]);
    expect(resumed.records[0]?.egress).toEqual(output.egress);
  });

  it("a sequence refused part-way and resumed is a second send, so a second entry", async () => {
    const dearAnswer = chatResponse(JSON.stringify({ wrong: true }), {
      usage: {
        inputTokens: 10,
        outputTokens: 500_000,
        totalTokens: 500_010,
        costUsd: undefined,
      },
    });
    const { world, requestsAtWrite } = await loggingWorld({
      // The first request fits and its answer spends the rest, so the repair is refused.
      limits: { run: () => 0.5, session: () => 0 },
      script: [dearAnswer, chatResponse(GOOD_ANSWER)],
    });
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(world.ask).toHaveBeenCalled();
    expect(world.provider.calls).toHaveLength(2);
    expect(requestsAtWrite).toEqual([0, 1]);
    expect(output.profile.origin).toBe("llm");
  });

  it("a user who declines, and a provider with no key, write nothing", async () => {
    const declined = await loggingWorld({});
    declined.world.confirm.mockImplementation(() =>
      Promise.resolve({ kind: "cancelled" }),
    );
    await declined.world.execute(PROFILE_ONLY);
    expect(declined.records).toEqual([]);

    const keyless = await loggingWorld({ hasProviderKey: false });
    await keyless.world.execute(PROFILE_ONLY);
    expect(keyless.world.provider.calls).toHaveLength(0);
    expect(keyless.records).toEqual([]);
  });

  it("holds the entry's fields and no paper's text", async () => {
    const { world, records } = await loggingWorld({
      script: [new NetworkError("connection reset")],
    });
    await world.execute(PROFILE_ONLY);
    const record = records[0] as RecommendEgressRecord;
    expect(Object.keys(record).sort()).toEqual([
      "collectionKey",
      "egress",
      "libraryID",
      "mode",
    ]);
    expect(Object.keys(record.egress).sort()).toEqual([
      "confirmedAtEpochMs",
      "host",
      "itemCount",
      "modelId",
      "privacyMode",
      "providerId",
      "scope",
    ]);
    const sent = world.provider.calls[0]?.request.messages
      .map(({ content }) => content)
      .join("\n");
    const title = membersOf(1)[0]?.work.title ?? "";
    expect(title).not.toBe("");
    expect(sent).toContain(title);
    expect(JSON.stringify(record)).not.toContain(title);
  });
});

// ---------------------------------------------------------------------------
// The candidate half
// ---------------------------------------------------------------------------

describe("an edited-profile run", () => {
  it("with a fresh profile asks no model, stores the edits, and sends them as queries", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 1)],
      keyword: [paper("europepmc", 2)],
    });
    const shown = await shownProfile(world);
    expect(shown.suggestedQueries).toContain("madeupterm");
    const calls = world.provider.calls.length;
    const edits = { removedTerms: ["madeupterm"], addedTerms: ["addedterm"] };
    const ctx = world.contextWith();
    const output = expectRows(
      await world.execute(editedInput(shown, { edits }), ctx),
    );

    expect(world.provider.calls).toHaveLength(calls);
    expect(world.confirm).toHaveBeenCalledTimes(1);
    expect(output.profileRebuilt).toBe(false);
    expect(output.profile.userEdits).toEqual(edits);
    expect((await world.profileStore.get(PROFILE_ID))?.userEdits).toEqual(
      edits,
    );
    expect(ctx.stages).toEqual([
      "ProfileCheck",
      "StoringEdits",
      "Generating",
      "IdentifierFilters",
      "FillingMetadata",
      "FetchingVectors",
      "ContentFilters",
      "Scoring",
      "Diversifying",
    ]);

    const sent = JSON.stringify(world.epmc.searches);
    expect(world.epmc.searches.length).toBeGreaterThan(0);
    expect(sent).toContain("addedterm");
    expect(sent).not.toContain("madeupterm");
    expect(sent).toContain("dose");
    expect(world.recommend).toHaveBeenCalled();
    expect(keysOfRows(output)).toHaveLength(2);
    expect(output.similarity).toEqual({ space: "specter_v2" });
    expect(output.keyNotice).toBe(false);
    expect(output.rows[0]?.recommendation.similaritySpace).toBe("specter_v2");
    expect(output.stageReached).toBe("Diversifying");
  });

  it("a second run reuses every stored vector and sends only the new candidates'", async () => {
    const world = await worldOf({ recommended: [paper("semanticscholar", 1)] });
    const shown = await shownProfile(world);
    const before = world.fetchEmbeddings.mock.calls.length;
    expectRows(await world.execute(editedInput(shown)));
    const sentFirst = world.fetchEmbeddings.mock.calls
      .slice(before)
      .flatMap(([ids]) => ids);
    expect(sentFirst).toEqual(["DOI:10.1000/p1"]);

    const middle = world.fetchEmbeddings.mock.calls.length;
    expectRows(await world.execute(editedInput(shown)));
    expect(world.fetchEmbeddings.mock.calls.length).toBe(middle);
    expect(world.provider.calls).toHaveLength(1);
  });

  it("a stale profile is rebuilt with the edits, stored, and reported", async () => {
    const world = await worldOf({
      script: [chatResponse(GOOD_ANSWER), chatResponse(GOOD_ANSWER)],
    });
    const shown = await shownProfile(world);
    world.setItems([...membersOf(6), memberItem(7)]);
    const edits = { removedTerms: ["madeupterm"], addedTerms: ["addedterm"] };
    const ctx = world.contextWith();
    const output = expectRows(
      await world.execute(editedInput(shown, { edits }), ctx),
    );
    expect(output.profileRebuilt).toBe(true);
    expect(output.profile.userEdits).toEqual(edits);
    expect(output.profile.membershipHash).not.toBe(shown.membershipHash);
    expect(ctx.stages).toContain("BuildingStats");
    expect(ctx.stages).not.toContain("StoringEdits");
    expect((await world.profileStore.get(PROFILE_ID))?.userEdits).toEqual(
      edits,
    );
    expect(world.confirm).toHaveBeenCalledTimes(2);
  });

  it("a stored row other than the one on screen is reported, with no rebuild", async () => {
    const world = await worldOf();
    const shown = await shownProfile(world);
    const other = { ...shown, builtAtEpochMs: shown.builtAtEpochMs - 1 };
    const ctx = world.contextWith();
    const output = expectRows(await world.execute(editedInput(other), ctx));
    expect(output.profileRebuilt).toBe(true);
    expect(ctx.stages).toContain("StoringEdits");
    expect(ctx.stages).not.toContain("BuildingStats");
  });

  it("reads another hash on the row as a report too", async () => {
    const world = await worldOf();
    const shown = await shownProfile(world);
    const output = expectRows(
      await world.execute(editedInput({ ...shown, membershipHash: "other" })),
    );
    expect(output.profileRebuilt).toBe(true);
  });

  it("with no profile store compares against the profile in its input", async () => {
    const world = await worldOf({
      profiles: "none",
      embeddings: "none",
      hasProviderKey: false,
    });
    const shown = await shownProfile(world);
    const ctx = world.contextWith();
    const output = expectRows(await world.execute(editedInput(shown), ctx));
    expect(output.profileRebuilt).toBe(false);
    expect(ctx.stages).not.toContain("BuildingStats");
    expect(output.profile.builtAtEpochMs).toBe(shown.builtAtEpochMs);
  });

  it("the slider and the box reach the scoring and the filters", async () => {
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 1, { type: "preprint" }),
        paper("semanticscholar", 2),
      ],
    });
    const shown = await shownProfile(world);
    const peer = expectRows(
      await world.execute(editedInput(shown, { peerReviewedOnly: true })),
    );
    expect(peer.dropped["not-peer-reviewed"]).toBe(1);
    expect(keysOfRows(peer)).toEqual(["doi:10.1000/p2"]);

    const low = expectRows(
      await world.execute(editedInput(shown, { exploration: 0 })),
    );
    const high = expectRows(
      await world.execute(editedInput(shown, { exploration: 1 })),
    );
    expect(low.rows[0]?.recommendation.score).not.toBe(
      high.rows[0]?.recommendation.score,
    );
  });

  it("every generator failing ends Failed, with the statuses", async () => {
    const error = new UpstreamServerError(500, "x");
    const world = await worldOf({
      recommendFails: error,
      keywordFails: error,
    });
    const shown = await shownProfile(world);
    const output = expectFailed(await world.execute(editedInput(shown)));
    expect(output.error.messageKey).toBe("rh-error-source");
    expect(output.error.code).toBe("SOURCE");
    expect(output.error.retryable).toBe(true);
    expect(output.stageReached).toBe("Generating");
    expect(output.statuses.length).toBeGreaterThan(0);
  });

  it("one generator failing is a partial run with rows", async () => {
    const world = await worldOf({
      recommendFails: new UpstreamServerError(500, "x"),
      keyword: [paper("europepmc", 2)],
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(keysOfRows(output)).toEqual(["doi:10.1000/p2"]);
    expect(output.statuses.some(({ state }) => state === "failed")).toBe(true);
  });

  it("no candidates is still the rows ending", async () => {
    const world = await worldOf();
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.rows).toEqual([]);
    expect(output.couplingRows).toBe(0);
  });

  it("logs the line P5-T30 reads", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 1)],
    });
    const shown = await shownProfile(world);
    expectRows(await world.execute(editedInput(shown)));
    const line = world.logs.find((entry) =>
      entry.includes("recommend: scored"),
    );
    expect(line).toBeDefined();
    expect(line).toContain("couplingRows");
    expect(line).toContain("scoreMs");
    expect(line).toContain("specter_v2");
    expect(line).toContain("in-collection");
  });
});

describe("what is asked about is only what survived", () => {
  it("the fill-in and the vector fetch see only the survivors of identifierFilters", async () => {
    const member = paper("semanticscholar", 10, {
      ids: { doi: memberDoi(0) },
      abstract: undefined,
    });
    const old = paper("semanticscholar", 11, {
      publishedDate: { year: 2001, iso: "2001" },
      abstract: undefined,
    });
    const rejected = paper("semanticscholar", 12, { abstract: undefined });
    const kept = paper("semanticscholar", 13, { abstract: undefined });
    const world = await worldOf({
      recommended: [member, old, rejected, kept],
      lookupKeyed: (ids) =>
        ids.flatMap((asked) =>
          asked.doi === "10.1000/p13"
            ? [
                paper("semanticscholar", 913, {
                  ids: { doi: asked.doi },
                  abstract: "Filled in.",
                }),
              ]
            : [],
        ),
    });
    const shown = await shownProfile(world);
    await world.recommendationStore.put({
      id: recommendationId(PROFILE_ID, "doi:10.1000/p12"),
      profileId: PROFILE_ID,
      work: {
        ...memberItem(0).work,
        workKey: "doi:10.1000/p12",
        ids: { doi: "10.1000/p12" },
      },
      score: 0.5,
      signals: {
        similarity: 0,
        novelty: 0,
        recency: 0,
        multiSource: 0,
        citationVelocity: 0,
        authorAffinity: 0,
        venueAffinity: 0,
        coupling: 0,
      },
      similaritySpace: "lexical",
      reasons: [],
      discoveredVia: [],
      generatedAtEpochMs: NOW,
    } as never);
    await world.pipeline.reject(PROFILE_ID, "doi:10.1000/p12");

    const before = world.fetchEmbeddings.mock.calls.length;
    const output = expectRows(await world.execute(editedInput(shown)));

    expect(lookedUp(world)).toEqual(["10.1000/p13"]);
    expect(
      world.fetchEmbeddings.mock.calls.slice(before).flatMap(([ids]) => ids),
    ).toEqual(["DOI:10.1000/p13"]);
    expect(output.fillIn.sent).toBe(1);
    expect(output.dropped["in-collection"]).toBe(1);
    expect(output.dropped["outside-window"]).toBe(1);
    expect(output.dropped.dismissed).toBe(1);
    expect(keysOfRows(output)).toEqual(["doi:10.1000/p13"]);
    expect(output.rows[0]?.recommendation.work.abstract).toBe("Filled in.");
  });

  it("Europe PMC and Crossref are asked for a missing title and not for an abstract", async () => {
    const untitled = paper("semanticscholar", 20, { title: "" });
    const noAbstract = paper("semanticscholar", 21, { abstract: undefined });
    const world = await worldOf({
      keyed: true,
      recommended: [untitled, noAbstract],
      lookupEpmc: (ids) =>
        ids.flatMap((asked) =>
          asked.doi === "10.1000/p20"
            ? [
                paper("europepmc", 920, {
                  ids: { doi: asked.doi },
                  title: "Found by Europe PMC",
                }),
              ]
            : [],
        ),
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    const asked = world.epmc.lookup.mock.calls.map(([ids]) =>
      ids.map(({ doi }) => doi),
    );
    expect(asked[0]).toEqual(["10.1000/p20"]);
    expect(output.rows.map((row) => row.recommendation.work.title)).toContain(
      "Found by Europe PMC",
    );
    expect(output.fillIn.untitled).toBe(0);
  });

  it("a work no lookup can title is dropped and counted; one with no abstract is dropped by reason", async () => {
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 30, { title: "" }),
        paper("semanticscholar", 31, { abstract: undefined }),
        paper("semanticscholar", 32),
      ],
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.fillIn.untitled).toBe(1);
    expect(output.dropped["no-abstract"]).toBe(1);
    expect(keysOfRows(output)).toEqual(["doi:10.1000/p32"]);
  });

  it("a lookup's record that joins no candidate is nobody's row", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 40, { abstract: undefined })],
      lookupKeyed: () => [paper("semanticscholar", 777)],
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(keysOfRows(output)).not.toContain("doi:10.1000/p777");
  });

  it("a fill-in that joins two candidates keeps both lists, each once", async () => {
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 41, {
          ids: { pmid: "4100" },
          title: "",
          abstract: undefined,
        }),
      ],
      keyword: [paper("europepmc", 42, { ids: { doi: "10.1000/p42" } })],
      lookupKeyed: (ids) =>
        ids.flatMap((asked) =>
          asked.pmid === "4100"
            ? [
                paper("semanticscholar", 942, {
                  ids: { pmid: "4100", doi: "10.1000/p42" },
                }),
              ]
            : [],
        ),
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(keysOfRows(output)).toHaveLength(1);
    const via = output.rows[0]?.recommendation.discoveredVia ?? [];
    expect(via.map(({ sourceId }) => sourceId).sort()).toEqual([
      "europepmc",
      "semanticscholar",
    ]);
  });

  it("a failed lookup is a row in the report, and the run goes on", async () => {
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 50, { abstract: undefined }),
        paper("semanticscholar", 51),
      ],
    });
    world.lookupKeyed.mockRejectedValue(new UpstreamServerError(500, "x"));
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.fillIn.failed.map(({ sourceId }) => sourceId)).toContain(
      "semanticscholar",
    );
    expect(keysOfRows(output)).toEqual(["doi:10.1000/p51"]);
  });

  it("a work with nothing Semantic Scholar can read is not sent to it", async () => {
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 150, { ids: {}, abstract: undefined }),
        paper("semanticscholar", 151, { abstract: undefined }),
      ],
    });
    const shown = await shownProfile(world);
    expectRows(await world.execute(editedInput(shown)));
    expect(lookedUp(world)).toEqual(["10.1000/p151"]);
  });

  it("Europe PMC needs a DOI, and Crossref holds no arXiv DOI", async () => {
    const arxiv = "10.48550/arxiv.2401.00001";
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 152, { ids: { pmid: "15200" }, title: "" }),
        paper("semanticscholar", 153, { ids: { doi: arxiv }, title: "" }),
        paper("semanticscholar", 154, { title: "" }),
      ],
    });
    const shown = await shownProfile(world);
    expectRows(await world.execute(editedInput(shown)));
    const sent = (lookup: World["epmc"]["lookup"]) =>
      lookup.mock.calls.flatMap(([ids]) => ids);
    expect(sent(world.epmc.lookup)).toEqual([
      { doi: arxiv },
      { doi: "10.1000/p154" },
    ]);
    expect(sent(world.crossref.lookup)).toEqual([{ doi: "10.1000/p154" }]);
  });

  it("the cache gets each identifier's own answer, without `raw`, and a missing mark for no answer", async () => {
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 155, { abstract: undefined }),
        paper("semanticscholar", 156, { abstract: undefined }),
      ],
      lookupKeyed: () => [
        {
          ...paper("semanticscholar", 955, {
            ids: { doi: "10.1000/p155" },
            abstract: "Filled in.",
          }),
          raw: { body: "a raw body" },
        } as unknown as SourceRecord,
      ],
    });
    const shown = await shownProfile(world);
    expectRows(await world.execute(editedInput(shown)));
    const cache = relatedCacheDeps(world.contextWith());
    const read = (doi: string) =>
      readRelated<readonly SourceRecord[]>(cache, "metadata", {
        sourceId: "semanticscholar",
        ids: [`DOI:${doi}`],
      });
    const answered = await read("10.1000/p155");
    expect(answered?.outcome).toBe("value");
    expect(JSON.stringify(answered)).not.toContain("a raw body");
    expect((await read("10.1000/p156"))?.outcome).toBe("missing");

    // Both are remembered, so the next run sends neither.
    world.lookupKeyed.mockClear();
    expectRows(await world.execute(editedInput(shown)));
    expect(world.lookupKeyed).not.toHaveBeenCalled();
  });

  it("the abstract ladder has Semantic Scholar on a keyed run and not on a keyless one", async () => {
    const statusOf = (output: RecommendRows) =>
      output.fillIn.backfill.steps.find(
        ({ sourceId }) => sourceId === "semanticscholar",
      )?.status;
    const keyed = await worldOf({
      recommended: [paper("semanticscholar", 164, { abstract: undefined })],
    });
    const keyedRows = expectRows(
      await keyed.execute(editedInput(await shownProfile(keyed))),
    );
    expect(statusOf(keyedRows)).toBe("asked");
    const keyless = await worldOf({
      keyed: false,
      keyword: [paper("europepmc", 165, { abstract: undefined })],
    });
    const keylessRows = expectRows(
      await keyless.execute(editedInput(await shownProfile(keyless))),
    );
    expect(statusOf(keylessRows)).toBe("not-selected");
  });

  it("links and flags are the merge's that held the survivors", async () => {
    const authors = [{ family: "Shared", given: "Bo" }];
    const linkedTitle =
      "A shared title about ribosome profiling across human tissues";
    const flaggedTitle =
      "Another shared title about hepatocyte delivery in large animals";
    const listed = [
      // One title and two DOIs, across the preprint boundary, so linked.
      paper("semanticscholar", 172, { title: linkedTitle, authors }),
      paper("semanticscholar", 173, {
        ids: { doi: "10.1101/2024.01.01.173" },
        type: "preprint",
        title: linkedTitle,
        authors,
      }),
      // One title, across the boundary, and no identifier to set them apart.
      paper("semanticscholar", 175, { title: flaggedTitle, authors }),
      paper("semanticscholar", 176, {
        ids: {},
        type: "preprint",
        title: flaggedTitle,
        authors,
      }),
      paper("semanticscholar", 174, { abstract: undefined }),
    ];
    // No lookup found anything, so no second merge: the generators' pairs stand.
    const untouched = await worldOf({ recommended: listed });
    const generators = expectRows(
      await untouched.execute(editedInput(await shownProfile(untouched))),
    );
    expect(generators.links).toHaveLength(1);
    expect(generators.flags).toHaveLength(1);

    // The box drops both preprints, and a lookup's new record forces a second merge.
    const refilled = await worldOf({
      recommended: listed,
      lookupKeyed: () => [
        paper("semanticscholar", 974, {
          ids: { doi: "10.1000/p174" },
          abstract: "Filled in.",
        }),
      ],
    });
    const merged = expectRows(
      await refilled.execute(
        editedInput(await shownProfile(refilled), { peerReviewedOnly: true }),
      ),
    );
    expect(merged.links).toEqual([]);
    expect(merged.flags).toEqual([]);
  });

  it("with the cache off, the abstract ladder does not ask what the fill-in already asked", async () => {
    const world = await worldOf({
      cacheEnabled: false,
      recommended: [paper("semanticscholar", 157, { abstract: undefined })],
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(lookedUp(world)).toEqual(["10.1000/p157"]);
    expect(output.fillIn.sent).toBe(2);
  });

  it("with no key both title sources are still asked", async () => {
    const world = await worldOf({
      keyed: false,
      keyword: [paper("europepmc", 160, { title: "" })],
    });
    const shown = await shownProfile(world);
    expectRows(await world.execute(editedInput(shown)));
    expect(world.epmc.lookup).toHaveBeenCalled();
    expect(world.crossref.lookup).toHaveBeenCalled();
  });

  it("a source this build does not register is passed over", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 161, { title: "" })],
    });
    const shown = await shownProfile(world);
    const sources = createSourceRegistry();
    sources.register(world.s2Registered.source);
    sources.register(world.epmc.source);
    const output = await world.execute(editedInput(shown), {
      ...world.contextWith(),
      sources,
    });
    expect(output.outcome).toBe("succeeded");
    expect(world.epmc.lookup).toHaveBeenCalled();
  });

  it("a lookup's fuller copy of a record replaces the one held; a thinner one does not", async () => {
    const thin = {
      ...paper("semanticscholar", 162, { title: "", abstract: undefined }),
      missingFields: ["title", "abstract"],
    } as unknown as SourceRecord;
    const full = paper("semanticscholar", 162, {
      abstract: "The fuller copy.",
    });
    const world = await worldOf({
      recommended: [thin],
      lookupKeyed: () => [full],
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.rows[0]?.recommendation.work.abstract).toBe(
      "The fuller copy.",
    );
    expect(output.rows[0]?.recommendation.work.title).toBe(full.work.title);

    const other = await worldOf({
      recommended: [{ ...full, missingFields: [] }],
      lookupEpmc: () => [],
    });
    const seen = await shownProfile(other);
    const kept = expectRows(await other.execute(editedInput(seen)));
    expect(kept.rows[0]?.recommendation.work.abstract).toBe("The fuller copy.");
  });

  it("a cancel inside a lookup is a cancel, not a failed source", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 163, { abstract: undefined })],
    });
    world.lookupKeyed.mockRejectedValueOnce(
      new OperationCancelledError({ kind: "user" }),
    );
    const shown = await shownProfile(world);
    const output = await world.execute(editedInput(shown));
    expect(output).toMatchObject({
      outcome: "cancelled",
      stageReached: "FillingMetadata",
    });
  });

  it("identifiers past the budget are counted and not sent", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 158, { abstract: undefined })],
    });
    const shown = await shownProfile(world);
    let spent = false;
    const original = RequestBudget.prototype.takeUpTo;
    const spy = vi
      .spyOn(RequestBudget.prototype, "takeUpTo")
      .mockImplementation(function (this: RequestBudget, n: number): number {
        return spent ? 0 : original.call(this, n);
      });
    try {
      const ctx = world.contextWith(undefined, (stage) => {
        if (stage === "FillingMetadata") spent = true;
      });
      const output = expectRows(await world.execute(editedInput(shown), ctx));
      expect(world.lookupKeyed).not.toHaveBeenCalled();
      expect(output.fillIn.sent).toBe(0);
      expect(output.fillIn.unsent).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("the generators and the fill-in share one request budget of 40", async () => {
    const totals: number[] = [];
    const instances = new Set<RequestBudget>();
    const generators = new Set<RequestBudget>();
    const original = RequestBudget.prototype.takeUpTo;
    const originalTry = RequestBudget.prototype.tryTake;
    const spy = vi
      .spyOn(RequestBudget.prototype, "takeUpTo")
      .mockImplementation(function (this: RequestBudget, n: number): number {
        instances.add(this);
        totals.push(this.remaining);
        return original.call(this, n);
      });
    const spyTry = vi
      .spyOn(RequestBudget.prototype, "tryTake")
      .mockImplementation(function (this: RequestBudget, n?: number): boolean {
        instances.add(this);
        generators.add(this);
        return originalTry.call(this, n);
      });
    try {
      const world = await worldOf({
        recommended: [paper("semanticscholar", 60, { abstract: undefined })],
        keyword: [paper("europepmc", 61)],
      });
      const shown = await shownProfile(world);
      expectRows(await world.execute(editedInput(shown)));
      expect(generators.size).toBe(1);
      expect(instances.size).toBe(1);
      expect(totals[0]).toBeLessThanOrEqual(40);
      expect(world.lookupKeyed).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      spyTry.mockRestore();
    }
  });

  it("the probe is made once, and the generators get that answer", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 62)],
    });
    const shown = await shownProfile(world);
    world.hasUsableApiKey.mockClear();
    world.hasUsableApiKey.mockImplementationOnce(() => Promise.resolve(true));
    world.hasUsableApiKey.mockImplementation(() => Promise.resolve(false));
    expectRows(await world.execute(editedInput(shown)));
    expect(world.hasUsableApiKey).toHaveBeenCalledTimes(1);
    expect(world.recommend).toHaveBeenCalled();
  });

  it("a probe that fails is a run with no key", async () => {
    const world = await worldOf({ embeddings: "memory" });
    world.hasUsableApiKey.mockRejectedValue(new Error("no store"));
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(output.profile.embeddingModel).toBeUndefined();
    expect(world.fetchEmbeddings).not.toHaveBeenCalled();
  });
});

describe("a keyless run", () => {
  function realAdapter(world: World) {
    const clock = createManualClock(NOW);
    const asked: string[] = [];
    const http: HttpClient = {
      request(_method, url) {
        asked.push(url);
        return Promise.reject(new Error(`asked: ${url}`));
      },
    };
    const s2 = createSemanticScholarSource({
      http,
      clock,
      mapRecords: createSemanticScholarRecordMapper({ clock }),
    });
    const sources = createSourceRegistry();
    sources.register(s2);
    sources.register(world.epmc.source);
    sources.register(world.crossref.source);
    return { s2, sources, asked };
  }

  it("sends nothing to api.semanticscholar.org, on the real adapter, in either mode", async () => {
    const world = await worldOf({
      keyed: false,
      keyword: [
        paper("europepmc", 70, { abstract: undefined }),
        paper("europepmc", 71, { title: "" }),
        paper("europepmc", 72),
      ],
    });
    const { s2, sources, asked } = realAdapter(world);
    const pipeline = createRecommendPipeline({
      ...world.deps,
      semanticscholar: s2,
    });
    const shown = expectProfile(
      await pipeline.execute(
        PROFILE_ONLY,
        { ...world.contextWith(), sources },
        world.surface,
      ),
    );
    expect(shown.profile.embeddingModel).toBeUndefined();
    const output = expectRows(
      await pipeline.execute(
        editedInput(shown.profile),
        { ...world.contextWith(), sources },
        world.surface,
      ),
    );
    expect(asked.filter((url) => url.includes(SEMANTICSCHOLAR_HOST))).toEqual(
      [],
    );
    expect(keysOfRows(output)).toContain("doi:10.1000/p72");
    expect(output.keyNotice).toBe(true);
    expect(output.similarity).toEqual({ space: "lexical" });
    expect(output.rows[0]?.recommendation.similaritySpace).toBe("lexical");
    expect(
      output.statuses.filter(({ state }) => state === "no-key").length,
    ).toBeGreaterThan(0);
  });

  it("never calls any of Semantic Scholar's reads on a stand-in", async () => {
    const world = await worldOf({
      keyed: false,
      keyword: [paper("europepmc", 73, { abstract: undefined })],
    });
    const shown = await shownProfile(world);
    const ctx = world.contextWith();
    expectRows(await world.execute(editedInput(shown), ctx));
    expect(world.lookupKeyed).not.toHaveBeenCalled();
    expect(world.recommend).not.toHaveBeenCalled();
    expect(world.findRelated).not.toHaveBeenCalled();
    expect(world.fetchEmbeddings).not.toHaveBeenCalled();
    expect(world.s2Registered.lookup).not.toHaveBeenCalled();
    expect(world.s2Registered.searches).toEqual([]);
    expect(ctx.stages).not.toContain("FetchingVectors");
  });

  it("the abstract ladder still asks Europe PMC", async () => {
    const world = await worldOf({
      keyed: false,
      keyword: [paper("crossref", 74, { abstract: undefined })],
      lookupEpmc: (ids) =>
        ids.flatMap((asked) =>
          asked.doi === "10.1000/p74"
            ? [
                paper("europepmc", 974, {
                  ids: { doi: asked.doi },
                  abstract: "From the ladder.",
                }),
              ]
            : [],
        ),
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.rows[0]?.recommendation.work.abstract).toBe(
      "From the ladder.",
    );
    expect(output.fillIn.backfill.backfilled).toBe(1);
  });
});

describe("the vectors", () => {
  it("a keyed run with no store runs on words, and says no-store", async () => {
    const world = await worldOf({
      embeddings: "none",
      recommended: [paper("semanticscholar", 80)],
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.similarity).toEqual({ space: "lexical", notice: "no-store" });
    expect(output.keyNotice).toBe(false);
    expect(world.fetchEmbeddings).not.toHaveBeenCalled();
  });

  it("a store that will not open warns and is no store", async () => {
    const world = await worldOf({ embeddings: "reject" });
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(output.profile.centroids).toEqual([]);
    expect(
      world.logs.some((line) =>
        line.includes("vector store could not be opened"),
      ),
    ).toBe(true);
  });

  it("a keyed run that got no member's vector has no centroids, skips the fetch, and says so", async () => {
    const world = await worldOf({
      vector: () => undefined,
      recommended: [paper("semanticscholar", 81)],
    });
    const shown = await shownProfile(world);
    expect(shown.centroids).toEqual([]);
    const ctx = world.contextWith();
    const output = expectRows(await world.execute(editedInput(shown), ctx));
    expect(output.similarity).toEqual({
      space: "lexical",
      notice: "no-vectors",
    });
    expect(ctx.stages).not.toContain("FetchingVectors");
  });

  it("a batch that fails for the survivors scores them 0 and says fetch-failed", async () => {
    const error = new UpstreamServerError(500, "x");
    const world = await worldOf({
      recommended: [paper("semanticscholar", 82)],
      fetch: {
        fails: (ids) =>
          ids.some((id) => id.includes("/p")) ? error : undefined,
      },
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.similarity.space).toBe("specter_v2");
    expect(output.similarity.notice).toBe("fetch-failed");
    expect(output.similarity.error?.httpStatus).toBe(500);
    expect(output.vectorsIncomplete).toBe(false);
    expect(output.rows[0]?.recommendation.signals.similarity).toBe(0);
  });

  it("a key gone while the centroids were fetched raises the notice too", async () => {
    const world = await worldOf({ fetch: { keyed: false } });
    const shown = expectProfile(await world.execute(PROFILE_ONLY)).profile;
    const ctx = world.contextWith();
    const output = expectRows(await world.execute(editedInput(shown), ctx));
    expect(ctx.stages).not.toContain("FetchingVectors");
    expect(output.keyNotice).toBe(true);
  });

  it("a batch that finds the key gone raises the notice", async () => {
    let keyGone = false;
    const world = await worldOf({
      recommended: [paper("semanticscholar", 83)],
    });
    const shown = await shownProfile(world);
    const real = world.fetchEmbeddings.getMockImplementation();
    world.fetchEmbeddings.mockImplementation((ids) => {
      if (keyGone) {
        return Promise.resolve({
          keyed: false,
          vectors: new Map(),
          withoutVector: [],
        });
      }
      return (real as NonNullable<typeof real>)(ids);
    });
    keyGone = true;
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.keyNotice).toBe(true);
  });

  it("eviction keeps the members, what the index holds, and what matches it by identifier", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 85), paper("semanticscholar", 86)],
      byDoi: { "10.1000/p85": 9 },
      byWorkKey: { "doi:10.1000/elsewhere": 8 },
    });
    const evict = vi.spyOn(world.embeddingStore, "evictToCap");
    const shown = await shownProfile(world);
    expectRows(await world.execute(editedInput(shown)));
    const isInLibrary = evict.mock.calls.at(-1)?.[0];
    if (isInLibrary === undefined) throw new Error("no eviction");
    expect(isInLibrary(`doi:${memberDoi(0)}`)).toBe(true);
    expect(isInLibrary("doi:10.1000/p85")).toBe(true);
    expect(isInLibrary("doi:10.1000/elsewhere")).toBe(true);
    expect(isInLibrary("doi:10.1000/p86")).toBe(false);
  });

  it("a work the profile knew is left out though the collection no longer lists it", async () => {
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 190),
        paper("semanticscholar", 192),
      ],
    });
    const shown = await shownProfile(world);
    const known = {
      ...shown,
      knownWorkKeys: [...shown.knownWorkKeys, "doi:10.1000/p190"],
    };
    await world.profileStore.put(known);
    const output = expectRows(await world.execute(editedInput(known)));
    expect(keysOfRows(output)).toEqual(["doi:10.1000/p192"]);
    expect(output.dropped["in-collection"]).toBe(1);
  });

  it("a title the library holds marks the row as in the library", async () => {
    const title = "A title the library already holds about hepatocyte delivery";
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 191, {
          title,
          authors: [{ family: "Shared", given: "Bo" }],
        }),
      ],
    });
    const shown = await shownProfile(world);
    world.libraryItems.mockResolvedValue([
      {
        itemID: 5,
        deleted: false,
        title,
        year: 2026,
        firstAuthorFamily: "Shared",
      },
    ] as never);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.rows[0]?.inLibrary).toBe(true);
  });

  it("the vector fetch asks for the members as well as the survivors", async () => {
    const absent = `DOI:${memberDoi(0)}`;
    const world = await worldOf({
      recommended: [paper("semanticscholar", 193)],
      vector: (id) => (id === absent ? undefined : vectorAt(0.3)),
    });
    const shown = await shownProfile(world);
    const before = world.fetchEmbeddings.mock.calls.length;
    expectRows(await world.execute(editedInput(shown)));
    expect(
      world.fetchEmbeddings.mock.calls.slice(before).flatMap(([ids]) => ids),
    ).toContain(absent);
  });

  it("protects what the library holds from eviction", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 84)],
      byDoi: { "10.1000/p84": 9 },
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.rows[0]?.inLibrary).toBe(true);
    expect(output.rows[0]?.checkedByDefault).toBe(false);
    expect(world.libraryIndex).toHaveBeenCalledTimes(2);
  });
});

describe("dismissals and the store", () => {
  it("a dismissed paper is absent on the next run, and present and marked with show dismissed", async () => {
    const candidate = paper("semanticscholar", 90);
    const other = paper("semanticscholar", 91);
    const world = await worldOf({ recommended: [candidate, other] });
    const shown = await shownProfile(world);
    const first = expectRows(await world.execute(editedInput(shown)));
    expect(keysOfRows(first)).toContain("doi:10.1000/p90");

    expect(
      await world.pipeline.reject(first.profile.id, "doi:10.1000/p90"),
    ).toBe(true);

    const next = expectRows(await world.execute(editedInput(shown)));
    expect(keysOfRows(next)).toEqual(["doi:10.1000/p91"]);
    expect(next.dropped.dismissed).toBe(1);

    const shownDismissed = expectRows(
      await world.execute(editedInput(shown, { showDismissed: true })),
    );
    const row = shownDismissed.rows.find(
      ({ recommendation }) => recommendation.work.workKey === "doi:10.1000/p90",
    );
    expect(row?.dismissed).toBe(true);
    expect(row?.checkedByDefault).toBe(false);

    // The run that showed it did not take the rejection back.
    const after = expectRows(await world.execute(editedInput(shown)));
    expect(keysOfRows(after)).toEqual(["doi:10.1000/p91"]);
  });

  it("a dismissal is sent as a negative to the next recommendation request", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 92)],
    });
    const shown = await shownProfile(world);
    const first = expectRows(await world.execute(editedInput(shown)));
    await world.pipeline.reject(first.profile.id, "doi:10.1000/p92");
    world.recommend.mockClear();
    expectRows(await world.execute(editedInput(shown)));
    expect(JSON.stringify(world.recommend.mock.calls)).toContain("10.1000/p92");
  });

  it("reject answers false before a row is stored and true after, and the action is only ever rejected", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 93)],
    });
    expect(await world.pipeline.reject(PROFILE_ID, "doi:10.1000/p93")).toBe(
      false,
    );
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(await world.pipeline.reject(PROFILE_ID, "doi:10.1000/p93")).toBe(
      true,
    );

    expect(world.putRow).toHaveBeenCalledTimes(output.rows.length);
    for (const [row] of world.putRow.mock.calls) {
      expect(row).not.toHaveProperty("userAction");
      expect(row).not.toHaveProperty("userActionAtEpochMs");
    }
    const actions = world.connection.db
      .prepare("SELECT DISTINCT user_action FROM recommendation")
      .all()
      .map((row) => (row as { user_action: unknown }).user_action);
    expect(actions).toEqual(["rejected"]);
    const stamped = world.connection.db
      .prepare("SELECT action_at FROM recommendation")
      .all()
      .map((row) => (row as { action_at: unknown }).action_at);
    expect(stamped).toEqual([NOW]);
  });

  it("reject with no store answers false, and a store that throws rejects", async () => {
    const none = await worldOf({ recommendations: "none" });
    expect(await none.pipeline.reject(PROFILE_ID, "doi:x")).toBe(false);
    const failing = await worldOf();
    vi.spyOn(failing.recommendationStore, "reject").mockRejectedValue(
      new StorageError("nope"),
    );
    await expect(
      failing.pipeline.reject(PROFILE_ID, "doi:x"),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it.each(["none", "reject"] as const)(
    "a recommendation store that is %s still has rows, and hides nothing",
    async (how) => {
      const world = await worldOf({
        recommendations: how,
        recommended: [paper("semanticscholar", 94)],
      });
      const shown = await shownProfile(world);
      const output = expectRows(await world.execute(editedInput(shown)));
      expect(keysOfRows(output)).toEqual(["doi:10.1000/p94"]);
      expect(world.putRow).not.toHaveBeenCalled();
    },
  );

  it("rows that cannot be stored warn, and the run still ends with them", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 95)],
    });
    world.putRow.mockRejectedValue(new StorageError("nope"));
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(keysOfRows(output)).toEqual(["doi:10.1000/p95"]);
    expect(
      world.logs.some((line) => line.includes("rows could not be stored")),
    ).toBe(true);
    expect(await world.pipeline.reject(PROFILE_ID, "doi:10.1000/p95")).toBe(
      false,
    );
  });

  it.each(["none", "reject"] as const)(
    "a profile store that is %s is a run without one",
    async (how) => {
      const world = await worldOf({ profiles: how });
      const first = expectProfile(await world.execute(PROFILE_ONLY));
      expect(first.built).toBe(true);
      const second = expectProfile(await world.execute(PROFILE_ONLY));
      expect(second.built).toBe(true);
      expect(world.provider.calls).toHaveLength(1);
    },
  );

  it("a stored profile that cannot be read warns, and the run rebuilds", async () => {
    const world = await worldOf();
    vi.spyOn(world.profileStore, "get").mockRejectedValue(
      new StorageError("nope"),
    );
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(output.built).toBe(true);
    expect(
      world.logs.some((line) =>
        line.includes("stored profile could not be read"),
      ),
    ).toBe(true);
  });

  it("a profile that cannot be stored warns, and the run uses it", async () => {
    const world = await worldOf();
    world.putProfile.mockRejectedValue(new StorageError("nope"));
    const output = expectProfile(await world.execute(PROFILE_ONLY));
    expect(output.profile.origin).toBe("llm");
    expect(
      world.logs.some((line) => line.includes("profile could not be stored")),
    ).toBe(true);
  });

  it("edits that cannot be stored warn, and this run still uses them", async () => {
    const world = await worldOf();
    const shown = await shownProfile(world);
    world.putProfile.mockRejectedValue(new StorageError("nope"));
    const edits = { removedTerms: [], addedTerms: ["addedterm"] };
    const output = expectRows(
      await world.execute(editedInput(shown, { edits })),
    );
    expect(output.profile.userEdits).toEqual(edits);
  });
});

describe("no result row is a collection member", () => {
  it("by identifier, by the profile's known keys and by title", async () => {
    const world = await worldOf({
      recommended: [
        paper("semanticscholar", 100, { ids: { doi: memberDoi(1) } }),
        paper("semanticscholar", 101, {
          ids: { pmid: "10100" },
          title: memberItem(2).work.title,
          authors: memberItem(2).work.authors,
          publishedDate: { year: 2026, iso: "2026" },
        }),
        paper("semanticscholar", 102),
      ],
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    const memberKeys = membersOf(6).map(({ work }) => work.workKey);
    for (const key of keysOfRows(output)) {
      expect(memberKeys).not.toContain(key);
    }
    expect(keysOfRows(output)).toContain("doi:10.1000/p102");
    expect(keysOfRows(output)).not.toContain(`doi:${memberDoi(1)}`);
    expect(output.dropped["in-collection"]).toBeGreaterThanOrEqual(1);
  });

  it("when only the fill-in reveals it", async () => {
    const hidden = paper("semanticscholar", 103, {
      ids: { pmid: "10300" },
      title: "",
      abstract: undefined,
    });
    const world = await worldOf({
      recommended: [hidden, paper("semanticscholar", 104)],
      lookupKeyed: (ids) =>
        ids.flatMap((asked) =>
          asked.pmid === "10300"
            ? [
                paper("semanticscholar", 903, {
                  ids: { pmid: "10300", doi: memberDoi(3) },
                  title: "A title only the lookup knew",
                }),
              ]
            : [],
        ),
    });
    const shown = await shownProfile(world);
    const output = expectRows(await world.execute(editedInput(shown)));
    expect(lookedUp(world)).toContain(JSON.stringify({ pmid: "10300" }));
    expect(keysOfRows(output)).toEqual(["doi:10.1000/p104"]);
    expect(output.dropped["in-collection"]).toBe(1);
  });
});

describe("the caches shared with the related run", () => {
  /** A related run on `doi`, whose reference list and whose hydration the cache keeps. */
  async function relatedRunOn(
    world: World,
    doi: string,
    references: readonly SourceRecord[],
  ): Promise<void> {
    world.crossref.findRelated.mockImplementation(((query: {
      strategy: string;
    }) =>
      Promise.resolve(
        pageOf(query.strategy === "references" ? references : []),
      )) as never);
    const { progress: _unused, ...ctx } = world.contextWith();
    await runRelatedGenerators({ ids: { doi } as never }, ctx as never, {
      hasSemanticScholarKey: () => Promise.resolve(false),
      lookupSemanticScholar: () => Promise.resolve([]),
    });
    world.crossref.findRelated.mockImplementation(() =>
      Promise.resolve(pageOf([])),
    );
  }

  it("coupling reads the reference lists a related run cached, and sends nothing for them", async () => {
    const shared = paper("crossref", 110, { ids: { doi: "10.1000/shared" } });
    const world = await worldOf({
      recommended: [paper("semanticscholar", 111)],
    });
    const shown = await shownProfile(world);
    await relatedRunOn(world, "10.1000/p111", [shared]);
    await relatedRunOn(world, memberDoi(0), [shared]);
    const asked = world.crossref.findRelated.mock.calls.length;

    const output = expectRows(await world.execute(editedInput(shown)));
    expect(world.crossref.findRelated.mock.calls.length).toBe(asked);
    expect(output.couplingRows).toBe(1);
    expect(output.rows[0]?.recommendation.signals.coupling).toBeGreaterThan(0);
  });

  it("with no survivor's list cached the members' are not read, and coupling is 0", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 112)],
    });
    const shown = await shownProfile(world);
    await relatedRunOn(world, memberDoi(0), [paper("crossref", 113)]);
    let atScoring = 0;
    let atDiversifying = 0;
    const ctx = world.contextWith(undefined, (stage) => {
      if (stage === "Scoring") atScoring = world.cache.gets.length;
      if (stage === "Diversifying") atDiversifying = world.cache.gets.length;
    });
    const output = expectRows(await world.execute(editedInput(shown), ctx));
    // One candidate, the three reference generators, and no member.
    expect(atDiversifying - atScoring).toBe(3);
    expect(output.couplingRows).toBe(0);
    expect(output.rows[0]?.recommendation.signals.coupling).toBe(0);
  });

  it("the fill-in reads the metadata entries a related run wrote, and asks again for nothing", async () => {
    const answer = paper("europepmc", 120, {
      ids: { doi: "10.1000/p121" },
      title: "Titled by the related run",
    });
    const world = await worldOf({
      recommended: [paper("semanticscholar", 121, { title: "" })],
      lookupEpmc: (ids) =>
        ids.flatMap((asked) => (asked.doi === "10.1000/p121" ? [answer] : [])),
    });
    const shown = await shownProfile(world);
    await relatedRunOn(world, "10.1000/seed", [
      paper("crossref", 121, { ids: { doi: "10.1000/p121" }, title: "" }),
    ]);
    const asked = world.epmc.lookup.mock.calls.flatMap(([ids]) =>
      ids.map(({ doi }) => doi),
    );
    expect(asked).toContain("10.1000/p121");
    world.epmc.lookup.mockClear();

    const output = expectRows(await world.execute(editedInput(shown)));
    expect(output.rows[0]?.recommendation.work.title).toBe(
      "Titled by the related run",
    );
    expect(
      world.epmc.lookup.mock.calls
        .flatMap(([ids]) => ids.map(({ doi }) => doi))
        .filter((doi) => doi === "10.1000/p121"),
    ).toEqual([]);
  });
});

describe("cancelling", () => {
  it.each([
    "ProfileCheck",
    "BuildingStats",
    "Centroids",
    "ProfileCall",
    "ApplyingStoredEdits",
    "Generating",
    "IdentifierFilters",
    "FillingMetadata",
    "FetchingVectors",
    "ContentFilters",
    "Scoring",
  ])("at %s stops at the next boundary", async (stage) => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 130)],
    });
    const shown = {
      ...(await shownProfile(await worldOf())),
      membershipHash: "x",
    };
    const source = createCancellationTokenSource();
    const ctx = world.contextWith(source.token, (reached) => {
      if (reached === stage) source.cancel({ kind: "user" });
    });
    const output = await world.execute(editedInput(shown), ctx);
    expect(output.outcome).toBe("cancelled");
    expect(output.stageReached).toBe(stage);
    expect(ctx.stages.at(-1)).toBe(stage);
  });

  it("at StoringEdits stops at the next boundary", async () => {
    const world = await worldOf();
    const shown = await shownProfile(world);
    const source = createCancellationTokenSource();
    const ctx = world.contextWith(source.token, (reached) => {
      if (reached === "StoringEdits") source.cancel({ kind: "user" });
    });
    const output = await world.execute(editedInput(shown), ctx);
    expect(output).toEqual({
      outcome: "cancelled",
      stageReached: "StoringEdits",
    });
    expect(world.recommend).not.toHaveBeenCalled();
  });

  it("a token already cancelled reads nothing", async () => {
    const world = await worldOf();
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });
    const output = await world.execute(
      PROFILE_ONLY,
      world.contextWith(source.token),
    );
    expect(output).toEqual({
      outcome: "cancelled",
      stageReached: "ProfileCheck",
    });
    expect(world.readCollection).not.toHaveBeenCalled();
  });

  it("a cancel during scoring ends the run too", async () => {
    const world = await worldOf({
      recommended: [paper("semanticscholar", 131)],
    });
    const shown = await shownProfile(world);
    const source = createCancellationTokenSource();
    const ctx = world.contextWith(source.token, (reached) => {
      if (reached === "Diversifying") source.cancel({ kind: "user" });
    });
    const output = await world.execute(editedInput(shown), ctx);
    expect(output.outcome).toBe("cancelled");
    expect(world.putRow).not.toHaveBeenCalled();
  });

  it("a failure that is not a cancel is a Failed ending, not a rejection", async () => {
    const world = await worldOf();
    world.readCollection.mockRejectedValue(new StorageError("nope"));
    const output = expectFailed(await world.execute(PROFILE_ONLY));
    expect(output.stageReached).toBe("ProfileCheck");
    expect(output.error.code).toBe(new StorageError("nope").code);
  });
});

describe("validate", () => {
  const profile = { id: PROFILE_ID } as CollectionProfile;
  const fieldsOf = (input: unknown): readonly string[] =>
    validateRecommendInput(input as RecommendInput).errors.map(
      ({ field }) => field,
    );

  it("accepts both modes", () => {
    expect(validateRecommendInput(PROFILE_ONLY)).toEqual({
      ok: true,
      errors: [],
    });
    expect(validateRecommendInput(editedInput(profile)).ok).toBe(true);
  });

  it.each([
    [{ ...PROFILE_ONLY, libraryID: 0 }, "libraryID"],
    [{ ...PROFILE_ONLY, libraryID: 1.5 }, "libraryID"],
    [{ ...PROFILE_ONLY, collectionKey: "  " }, "collectionKey"],
    [{ ...PROFILE_ONLY, mode: "other" }, "mode"],
    [editedInput({ id: "other" } as CollectionProfile), "profile"],
    [editedInput(profile, { exploration: -0.1 }), "exploration"],
    [editedInput(profile, { exploration: 1.1 }), "exploration"],
    [editedInput(profile, { exploration: Number.NaN }), "exploration"],
  ])("refuses %j", (input, field) => {
    expect(fieldsOf(input)).toEqual([field]);
    expect(validateRecommendInput(input as RecommendInput).ok).toBe(false);
    expect(
      validateRecommendInput(input as RecommendInput).errors[0]?.messageKey,
    ).toBe("rh-error-configuration");
  });

  it("the ends of the slider are allowed", () => {
    expect(fieldsOf(editedInput(profile, { exploration: 0 }))).toEqual([]);
    expect(fieldsOf(editedInput(profile, { exploration: 1 }))).toEqual([]);
  });
});

describe("estimate", () => {
  it("sends nothing and prices the call that is due", async () => {
    const world = await worldOf();
    const estimate = await world.pipeline.estimate(
      PROFILE_ONLY,
      world.contextWith(),
    );
    expect(estimate.itemCount).toBe(6);
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedOutputTokens).toBeGreaterThan(0);
    expect(estimate.externalRequests).toBe(2);
    expect(world.provider.calls).toHaveLength(0);
    expect(world.fetchEmbeddings).not.toHaveBeenCalled();
    expect(world.confirm).not.toHaveBeenCalled();
    expect(await world.profileStore.get(PROFILE_ID)).toBeUndefined();
  });

  it("a fresh profile has no paid call, and an edited-profile run counts its budget", async () => {
    const world = await worldOf();
    const shown = await shownProfile(world);
    const fresh = await world.pipeline.estimate(
      PROFILE_ONLY,
      world.contextWith(),
    );
    expect(fresh.estimatedCostUsd).toBeUndefined();
    expect(fresh.estimatedInputTokens).toBe(0);
    expect(fresh.externalRequests).toBe(0);
    const edited = await world.pipeline.estimate(
      editedInput(shown),
      world.contextWith(),
    );
    expect(edited.externalRequests).toBe(41);
  });

  it("a cached answer, a keyless run and a refused model cost nothing", async () => {
    const world = await worldOf({ keyed: false, hasProviderKey: false });
    const none = await world.pipeline.estimate(
      PROFILE_ONLY,
      world.contextWith(),
    );
    expect(none.estimatedCostUsd).toBeUndefined();
    expect(none.externalRequests).toBe(0);
    const strict = await worldOf({
      mode: "strict",
      modelInfo: () => undefined,
    });
    const refused = await strict.pipeline.estimate(
      PROFILE_ONLY,
      strict.contextWith(),
    );
    expect(refused.estimatedCostUsd).toBeUndefined();
  });

  it("below 5 items is the count and nothing else", async () => {
    const world = await worldOf({ items: membersOf(3) });
    const estimate = await world.pipeline.estimate(
      PROFILE_ONLY,
      world.contextWith(),
    );
    expect(estimate).toMatchObject({
      itemCount: 3,
      externalRequests: 0,
      estimatedInputTokens: 0,
    });
    expect(estimate.estimatedCostUsd).toBeUndefined();
    expect(world.hasUsableApiKey).not.toHaveBeenCalled();
  });

  it("with no profile store an edited-profile run compares against its input", async () => {
    const shown = await shownProfile(
      await worldOf({ profiles: "none", embeddings: "none" }),
    );
    const world = await worldOf({ profiles: "none", embeddings: "none" });
    const unchangedInput = await world.pipeline.estimate(
      editedInput(shown),
      world.contextWith(),
    );
    expect(unchangedInput.estimatedCostUsd).toBeUndefined();
    const estimate = await world.pipeline.estimate(
      editedInput({ ...shown, membershipHash: "another" }),
      world.contextWith(),
    );
    expect(estimate.estimatedCostUsd).toBeDefined();
    const keyless = await worldOf({
      keyed: false,
      profiles: "none",
      hasProviderKey: false,
    });
    const unchanged = expectProfile(
      await keyless.execute(PROFILE_ONLY),
    ).profile;
    const fresh = await keyless.pipeline.estimate(
      editedInput(unchanged),
      keyless.contextWith(),
    );
    expect(fresh.estimatedCostUsd).toBeUndefined();
    expect(fresh.externalRequests).toBe(40);
  });
});

describe("the declaration and the wiring", () => {
  const writer = {} as never;

  it("declares §12.5's stages, weighted to 1", () => {
    expect(RECOMMEND_STAGES.map(({ key }) => key)).toEqual([
      "ProfileCheck",
      "BuildingStats",
      "Centroids",
      "ProfileCall",
      "ApplyingStoredEdits",
      "StoringEdits",
      "Generating",
      "IdentifierFilters",
      "FillingMetadata",
      "FetchingVectors",
      "ContentFilters",
      "Scoring",
      "Diversifying",
    ]);
    expect(() => stageSlices(RECOMMEND_STAGES)).not.toThrow();
    for (const { labelKey } of RECOMMEND_STAGES) {
      expect(labelKey).toBe(RECOMMEND_DISPLAY_NAME_KEY);
    }
  });

  it("buildPipelineSet builds no recommend pipeline without its dependencies", () => {
    expect(buildPipelineSet({ writer })).not.toHaveProperty("recommend");
  });

  it("buildPipelineSet hands over the adapters, the stores and the library, and logs egress as one finished job", async () => {
    const world = await worldOf();
    const calls: string[] = [];
    const inputs: unknown[] = [];
    const jobs = {
      enqueue: (pipelineId: string, input: unknown) => {
        calls.push(`enqueue:${pipelineId}`);
        inputs.push(input);
        return Promise.resolve({ id: "job-1" });
      },
      start: (id: string) => (calls.push(`start:${id}`), Promise.resolve({})),
      succeed: (id: string) => (
        calls.push(`succeed:${id}`),
        Promise.resolve({})
      ),
    };
    const { profileCall, semanticscholar, pubmed, library } = world.deps;
    const { recommend } = buildPipelineSet({
      writer,
      recommend: {
        semanticscholar,
        pubmed,
        library,
        profiles: world.deps.profiles,
        recommendations: world.deps.recommendations,
        embeddings: world.deps.embeddings,
        clock: world.clock,
        jobs: () => jobs as never,
        profileCall: {
          ...profileCall,
        },
      },
    });
    if (recommend === undefined) throw new Error("no recommend pipeline");
    expect(recommend.id).toBe("recommend");
    expect(recommend.resumable).toBe(false);
    expect(recommend.displayNameKey).toBe(RECOMMEND_DISPLAY_NAME_KEY);
    const typed = recommend as unknown as ReturnType<
      typeof createRecommendPipeline
    >;
    const output = expectProfile(
      await typed.execute(PROFILE_ONLY, world.contextWith(), world.surface),
    );
    expect(world.readCollection).toHaveBeenCalled();
    expect(calls).toEqual([
      "enqueue:recommend",
      "start:job-1",
      "succeed:job-1",
    ]);
    expect(inputs[0]).toEqual({
      libraryID: LIBRARY_ID,
      collectionKey: COLLECTION_KEY,
      mode: "profile-only",
      egress: output.egress,
    });
  });

  it("buildPipelineSet reads the shipped prompts by default", async () => {
    const world = await worldOf();
    const { prompts: _given, ...call } = world.deps.profileCall;
    const { recommend } = buildPipelineSet({
      writer,
      recommend: {
        semanticscholar: world.deps.semanticscholar,
        pubmed: world.deps.pubmed,
        library: world.deps.library,
        profiles: world.deps.profiles,
        recommendations: world.deps.recommendations,
        embeddings: world.deps.embeddings,
        clock: world.clock,
        jobs: () => ({}) as never,
        profileCall: call,
      },
    });
    expect(recommend?.id).toBe("recommend");
  });
});
