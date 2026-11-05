/**
 * `P5-T24`: recommendation filters, scoring, diversity and reasons.
 *
 * Plain Node, no network, no key. Expected numbers are written out rather than read
 * from `score.ts`, so a changed weight fails here and is seen. They are `docs/05`
 * §7.4's and §7.5's unmeasured starting values: a passing test says the formula is the
 * one written, not that it ranks well.
 *
 * **What the fixture run is.** "`docs/05` §8.3's checks" runs real Europe PMC answers
 * from `test/fixtures/europepmc/` through the shipped mapper and the shipped merge, on
 * the word space. It is one mechanical run: its strategies are assigned by this file,
 * and nothing here has judged a list. Every SPECTER2 vector below is synthetic, so no
 * test here says anything about Semantic Scholar's real vectors.
 */

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import {
  OperationCancelledError,
  StorageError,
} from "../../../src/core/errors";
import type { CancellationToken } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import type {
  Author,
  CanonicalWork,
  PartialDate,
} from "../../../src/model/canonicalWork";
import type { ExternalIds } from "../../../src/model/ids";
import type {
  Recommendation,
  RecommendationSignals,
  RecommendationStrategy,
} from "../../../src/model/recommendation";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import type {
  RecommendCandidate,
  RecommendFinding,
} from "../../../src/pipeline/recommend/generators";
import {
  buildProfileStats,
  type OwnedIdentifiers,
} from "../../../src/pipeline/recommend/profile";
import {
  contentFilters,
  DEFAULT_EXPLORATION,
  diversify,
  identifierFilters,
  isPreprintWork,
  MAX_PER_AUTHOR,
  MAX_PER_VENUE,
  MMR_LAMBDA,
  readDismissed,
  RECOMMEND_TOP_K,
  recommendationWeights,
  recommendOwnership,
  SCORE_YIELD_EVERY_COMPARISONS,
  scoreRecommendations,
  type RecommendationRow,
  type RecommendationScoring,
  type RecommendFilterInput,
  type RecommendOwnership,
  type RecommendScoreInput,
  type RecommendScoreProfile,
} from "../../../src/pipeline/recommend/score";
import { dedupeAndMergeAsync } from "../../../src/pipeline/searchImport/stages";
import type { EmbeddingVector } from "../../../src/pipeline/shared/embeddings";
import { lexicalSpace } from "../../../src/pipeline/shared/lexical";
import { createEuropePmcRecordMapper } from "../../../src/sources/europepmc/mapper";
import { mapPaper } from "../../../src/sources/semanticscholar/mapper";
import {
  buildLibraryIndex as buildTitleIndex,
  type LibraryItemFields,
} from "../../../src/sources/shared/dedupe";
import { recencyWindow } from "../../../src/sources/shared/recency";
import {
  collectionProfileId,
  createRecommendationStore,
  recommendationId,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";

const NOW = Date.UTC(2026, 10, 5, 12);
const WINDOW = recencyWindow(3, { now: () => NOW });
const PROFILE_ID = collectionProfileId(1, "ABCD1234");
const MODEL = "specter_v2";

function dateOf(year: number, month?: number, day?: number): PartialDate {
  return {
    year,
    ...(month !== undefined && { month }),
    ...(day !== undefined && { day }),
    iso: String(year),
  };
}

const THIS_YEAR = dateOf(2026);

let counter = 0;

/** A test names a field `undefined` to say the work has none. */
type WorkOverrides = {
  readonly [K in keyof CanonicalWork]?: CanonicalWork[K] | undefined;
};

/** A work with a unique title of many words, so no title tier fires by accident. */
function work(overrides: WorkOverrides = {}): CanonicalWork {
  counter += 1;
  const n = counter;
  return {
    workKey: `pmid:${String(9000000 + n)}`,
    ids: { pmid: String(9000000 + n) } as ExternalIds,
    type: "journal-article",
    title: `Unique study number w${String(n)} about topic x${String(n)} in model y${String(n)} with z${String(n)}`,
    abstract: `Abstract of paper w${String(n)}.`,
    authors: [{ family: `Author${String(n)}`, given: "Ann" }],
    containerTitle: `Journal ${String(n)}`,
    publishedDate: THIS_YEAR,
    provenance: { recordIds: [], fieldOrigin: {}, seenIn: [] },
    normalizedAtEpochMs: NOW,
    ...overrides,
  } as CanonicalWork;
}

function via(
  strategy: RecommendationStrategy,
  topicGroup?: number,
): RecommendFinding {
  return {
    sourceId: strategy === "recommendations" ? "semanticscholar" : "europepmc",
    strategy,
    ...(topicGroup !== undefined && { topicGroup }),
  };
}

function candidate(
  w: CanonicalWork,
  findings: readonly RecommendFinding[] = [via("keyword-search")],
): RecommendCandidate {
  const { workKey: _k, provenance: _p, normalizedAtEpochMs: _n, ...rest } = w;
  const record: SourceRecord = {
    id: `europepmc:${w.workKey}`,
    sourceId: "europepmc",
    nativeId: w.workKey,
    work: rest,
    retrievedAtEpochMs: NOW,
    missingFields: [],
  };
  return {
    work: w,
    records: [record],
    decisions: [],
    conflicts: [],
    discoveredVia: findings,
  };
}

const NOTHING_OWNED: OwnedIdentifiers = {
  doi: new Set(),
  pmid: new Set(),
  arxiv: new Set(),
  workKeys: new Set(),
};

function owned(works: readonly CanonicalWork[]): OwnedIdentifiers {
  return {
    doi: new Set(works.flatMap((w) => (w.ids.doi ? [w.ids.doi] : []))),
    pmid: new Set(works.flatMap((w) => (w.ids.pmid ? [w.ids.pmid] : []))),
    arxiv: new Set(
      works.flatMap((w) => (w.ids.arxivId ? [w.ids.arxivId] : [])),
    ),
    workKeys: new Set(works.map((w) => w.workKey)),
  };
}

function libraryItemOf(w: CanonicalWork, itemID: number): LibraryItemFields {
  return {
    itemID,
    deleted: false,
    doi: w.ids.doi,
    pmid: w.ids.pmid,
    title: w.title,
    year: w.publishedDate?.year,
    firstAuthorFamily: w.authors[0]?.family,
    containerTitle: w.containerTitle,
    isPreprint: w.type === "preprint",
  };
}

function ownershipOf(
  collection: readonly CanonicalWork[] = [],
  library: readonly CanonicalWork[] = [],
): RecommendOwnership {
  const all = [...collection, ...library];
  return {
    collection: owned(collection),
    collectionTitles: buildTitleIndex(collection.map(libraryItemOf)),
    library: owned(all),
    libraryTitles: buildTitleIndex(all.map(libraryItemOf)),
  };
}

function filterInput(
  overrides: Partial<RecommendFilterInput> = {},
): RecommendFilterInput {
  return {
    ownership: ownershipOf(),
    dismissed: NOTHING_OWNED,
    showDismissed: false,
    window: WINDOW,
    peerReviewedOnly: false,
    ...overrides,
  };
}

const LEXICAL_PROFILE: RecommendScoreProfile = {
  id: PROFILE_ID,
  centroids: [],
  topAuthors: [],
  topVenues: [],
};

function scoreInput(
  overrides: Partial<RecommendScoreInput> = {},
): RecommendScoreInput {
  return {
    profile: LEXICAL_PROFILE,
    works: [],
    vectors: new Map(),
    ownership: ownershipOf(),
    dismissed: NOTHING_OWNED,
    nowEpochMs: NOW,
    yieldToEventLoop: () => Promise.resolve(),
    ...overrides,
  };
}

/** A unit vector from raw values, as `ensureEmbeddings` hands them over. */
function vec(...values: readonly number[]): EmbeddingVector {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return {
    model: MODEL,
    values: Float32Array.from(values.map((v) => v / norm)),
  };
}

function specterProfile(
  centroids: readonly (readonly number[])[],
  rest: Partial<RecommendScoreProfile> = {},
): RecommendScoreProfile {
  return {
    ...LEXICAL_PROFILE,
    centroids,
    embeddingModel: MODEL,
    ...rest,
  };
}

async function oneRow(
  c: RecommendCandidate,
  overrides: Partial<RecommendScoreInput> = {},
): Promise<RecommendationRow> {
  const { rows } = await scoreRecommendations([c], scoreInput(overrides));
  return rows[0] as RecommendationRow;
}

async function signalsOf(
  c: RecommendCandidate,
  overrides: Partial<RecommendScoreInput> = {},
): Promise<RecommendationSignals> {
  return (await oneRow(c, overrides)).recommendation.signals;
}

function keysOf(rows: readonly RecommendationRow[]): readonly string[] {
  return rows.map((row) => row.recommendation.work.workKey);
}

// ---------------------------------------------------------------------------
// The weights
// ---------------------------------------------------------------------------

describe("recommendationWeights", () => {
  it("Done when: at t = 0.25 the weights equal the starting weights", () => {
    const weights = recommendationWeights(0.25);
    const expected = {
      similarity: 0.3,
      recency: 0.15,
      velocity: 0.1,
      novelty: 0.1,
      authorAffinity: 0.1,
      venueAffinity: 0.05,
      generatorAgreement: 0.12,
      coupling: 0.08,
    };
    expect(Object.keys(weights)).toEqual(Object.keys(expected));
    for (const [term, value] of Object.entries(expected)) {
      expect(weights[term as keyof RecommendationSignals]).toBeCloseTo(
        value,
        9,
      );
    }
  });

  it("defaults to the starting weights", () => {
    expect(DEFAULT_EXPLORATION).toBe(0.25);
    expect(recommendationWeights()).toEqual(recommendationWeights(0.25));
  });

  it.each([0, 0.1, 0.25, 0.5, 0.75, 0.9, 1])(
    "Done when: at t = %d they sum to 1.00 ± 1e-9, and the pair to 0.40",
    (t) => {
      const weights = recommendationWeights(t);
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-9);
      expect(weights.similarity + weights.novelty).toBeCloseTo(0.4, 12);
      expect(weights.novelty).toBeCloseTo(0.4 * t, 12);
    },
  );

  it.each([-0.01, 1.01, Number.NaN])("refuses t = %d", (t) => {
    expect(() => recommendationWeights(t)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

describe("recommendOwnership", () => {
  it("builds the collection's sets, its known keys and both title indexes", () => {
    const member = work({
      ids: { doi: "10.1000/member" } as ExternalIds,
      workKey: "doi:10.1000/member",
    });
    const elsewhere = work();
    const ownership = recommendOwnership({
      items: [{ work: member }],
      knownWorkKeys: ["hash:stored"],
      libraryIndex: {
        byDoi: new Map([["10.1000/member", 1]]),
        byPmid: new Map([[elsewhere.ids.pmid as string, 2]]),
        byArxiv: new Map(),
        byWorkKey: new Map(),
      },
      libraryItems: [libraryItemOf(elsewhere, 2)],
    });
    expect([...ownership.collection.doi]).toEqual(["10.1000/member"]);
    expect([...ownership.collection.workKeys].sort()).toEqual([
      "doi:10.1000/member",
      "hash:stored",
    ]);
    expect([...ownership.library.pmid]).toEqual([elsewhere.ids.pmid]);
    expect(ownership.collectionTitles.indexed).toBe(1);
    expect(ownership.libraryTitles.indexed).toBe(1);
    expect(
      ownership.libraryTitles.byPmid.get(elsewhere.ids.pmid as string),
    ).toBe(2);
  });

  it("gives the title tiers everything a collection member holds", () => {
    const member = work({
      type: "preprint",
      ids: {
        doi: "10.1000/d",
        pmid: "111",
        pmcid: "PMC222",
        arxivId: "2401.00001",
      } as ExternalIds,
      publishedDate: dateOf(2025),
      containerTitle: "Some Journal",
      authors: [{ family: "Kim", given: "Jun" }],
    });
    const { collectionTitles } = recommendOwnership({
      items: [{ work: member }],
      knownWorkKeys: [],
      libraryIndex: {
        byDoi: new Map(),
        byPmid: new Map(),
        byArxiv: new Map(),
        byWorkKey: new Map(),
      },
      libraryItems: [],
    });
    expect(collectionTitles.byDoi.get("10.1000/d")).toBe(0);
    expect(collectionTitles.byPmid.get("111")).toBe(0);
    expect(collectionTitles.byPmcid.get("PMC222")).toBe(0);
    expect(collectionTitles.byArxiv.get("2401.00001")).toBe(0);
    expect(collectionTitles.candidates.get(0)).toMatchObject({
      year: 2025,
      firstAuthor: "kim",
      container: "some journal",
      type: "preprint",
    });
  });
});

// ---------------------------------------------------------------------------
// isPreprintWork
// ---------------------------------------------------------------------------

describe("isPreprintWork", () => {
  it("reads the type first", () => {
    expect(isPreprintWork({ type: "preprint", ids: {} })).toBe(true);
    expect(isPreprintWork({ type: "journal-article", ids: {} })).toBe(false);
  });

  it("lets a DOI prefix decide only when no source named a type", () => {
    const biorxiv = { doi: "10.1101/2024.01.01.123456" } as ExternalIds;
    expect(isPreprintWork({ type: "other", ids: biorxiv })).toBe(true);
    expect(
      isPreprintWork({
        type: "other",
        ids: { doi: "10.1038/x" } as ExternalIds,
      }),
    ).toBe(false);
    expect(isPreprintWork({ type: "other", ids: {} })).toBe(false);
    // Cold Spring Harbor's journals share the prefix.
    expect(
      isPreprintWork({
        type: "journal-article",
        ids: { doi: "10.1101/gr.123456.111" } as ExternalIds,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// identifierFilters
// ---------------------------------------------------------------------------

describe("identifierFilters", () => {
  it("keeps what no rule touches, in order, with every count at 0", () => {
    const a = candidate(work());
    const b = candidate(work());
    const result = identifierFilters([a, b], filterInput());
    expect(result.kept).toEqual([a, b]);
    expect(result.dropped).toEqual({
      "in-collection": 0,
      dismissed: 0,
      "outside-window": 0,
      "published-version-owned": 0,
      "not-peer-reviewed": 0,
      "no-abstract": 0,
    });
  });

  it.each([
    ["DOI", { ids: { doi: "10.1000/same" } as ExternalIds }],
    ["PMID", { ids: { pmid: "12345" } as ExternalIds }],
    ["arXiv id", { ids: { arxivId: "2401.00001" } as ExternalIds }],
  ])("drops a collection member by %s", (_name, ids) => {
    const member = work(ids);
    const incoming = candidate(work(ids));
    const result = identifierFilters(
      [incoming],
      filterInput({ ownership: ownershipOf([member]) }),
    );
    expect(result.kept).toEqual([]);
    expect(result.dropped["in-collection"]).toBe(1);
  });

  it("normalises the candidate's identifier before asking", () => {
    const member = work({ ids: { doi: "10.1000/same" } as ExternalIds });
    const incoming = candidate(
      work({ ids: { doi: "https://doi.org/10.1000/SAME" } as ExternalIds }),
    );
    expect(
      identifierFilters(
        [incoming],
        filterInput({
          ownership: {
            ...ownershipOf(),
            collection: owned([member]),
          },
        }),
      ).dropped["in-collection"],
    ).toBe(1);
  });

  it("drops a collection member by work key, with no shared identifier", () => {
    const incoming = candidate(work({ workKey: "s2:777", ids: {} }));
    const ownership: RecommendOwnership = {
      ...ownershipOf(),
      collection: { ...NOTHING_OWNED, workKeys: new Set(["s2:777"]) },
    };
    expect(
      identifierFilters([incoming], filterInput({ ownership })).kept,
    ).toEqual([]);
  });

  it("drops a collection member by a title match, with no shared identifier", () => {
    const title =
      "A long and specific title about base editing in human primary cells";
    const member = work({
      title,
      ids: {},
      workKey: "hash:member",
      authors: [{ family: "Kim", given: "Jun" }],
    });
    const incoming = candidate(
      work({
        title,
        ids: { pmid: "4242" } as ExternalIds,
        authors: [{ family: "Kim", given: "J" }],
      }),
    );
    const result = identifierFilters(
      [incoming],
      filterInput({ ownership: ownershipOf([member]) }),
    );
    expect(result.dropped["in-collection"]).toBe(1);
  });

  it("does not treat a title flag as a member: a preprint of a member stays", () => {
    const title =
      "A long and specific title about prime editing in human primary cells";
    const member = work({
      title,
      ids: { doi: "10.1000/journal" } as ExternalIds,
    });
    const incoming = candidate(
      work({
        title,
        type: "preprint",
        ids: { doi: "10.1101/2024.01.01.000001" } as ExternalIds,
      }),
    );
    expect(
      identifierFilters(
        [incoming],
        filterInput({ ownership: ownershipOf([member]) }),
      ).dropped["in-collection"],
    ).toBe(0);
  });

  it("survives a candidate with no record", () => {
    const bare: RecommendCandidate = { ...candidate(work()), records: [] };
    expect(identifierFilters([bare], filterInput()).kept).toEqual([bare]);
  });

  it("FR-46: keeps a library item outside the collection", () => {
    const elsewhere = work();
    const incoming = candidate(work({ ids: elsewhere.ids }));
    const result = identifierFilters(
      [incoming],
      filterInput({ ownership: ownershipOf([], [elsewhere]) }),
    );
    expect(result.kept).toEqual([incoming]);
  });

  it("FR-49: hides a dismissed paper, and keeps it with show dismissed", () => {
    const seen = work();
    const incoming = candidate(work({ ids: seen.ids }));
    const dismissed = owned([seen]);
    const hidden = identifierFilters([incoming], filterInput({ dismissed }));
    expect(hidden.kept).toEqual([]);
    expect(hidden.dropped.dismissed).toBe(1);
    const shown = identifierFilters(
      [incoming],
      filterInput({ dismissed, showDismissed: true }),
    );
    expect(shown.kept).toEqual([incoming]);
  });

  it("hides a dismissed paper by its work key", () => {
    const incoming = candidate(work({ workKey: "s2:5", ids: {} }));
    expect(
      identifierFilters(
        [incoming],
        filterInput({
          dismissed: { ...NOTHING_OWNED, workKeys: new Set(["s2:5"]) },
        }),
      ).dropped.dismissed,
    ).toBe(1);
  });

  it("show dismissed does not bring back a collection member", () => {
    const member = work();
    const incoming = candidate(work({ ids: member.ids }));
    expect(
      identifierFilters(
        [incoming],
        filterInput({
          ownership: ownershipOf([member]),
          dismissed: owned([member]),
          showDismissed: true,
        }),
      ).dropped["in-collection"],
    ).toBe(1);
  });

  it("applies the window: older out; first year, ahead and undated in", () => {
    const older = candidate(work({ publishedDate: dateOf(2023, 12, 31) }));
    const first = candidate(work({ publishedDate: dateOf(2024, 1, 1) }));
    const ahead = candidate(work({ publishedDate: dateOf(2027) }));
    const undated = candidate(work({ publishedDate: undefined }));
    const result = identifierFilters(
      [older, first, ahead, undated],
      filterInput(),
    );
    expect(result.kept).toEqual([first, ahead, undated]);
    expect(result.dropped["outside-window"]).toBe(1);
  });

  it("drops a preprint whose published version the user owns", () => {
    const published = work({ ids: { doi: "10.1000/pub" } as ExternalIds });
    const preprint = candidate(
      work({
        type: "preprint",
        ids: { doi: "10.1101/2024.01.01.000002" } as ExternalIds,
        relatedVersionIds: { doi: "10.1000/pub" } as ExternalIds,
      }),
    );
    const result = identifierFilters(
      [preprint],
      filterInput({ ownership: ownershipOf([], [published]) }),
    );
    expect(result.kept).toEqual([]);
    expect(result.dropped["published-version-owned"]).toBe(1);
  });

  it("keeps a preprint whose published version the user does not own", () => {
    const preprint = candidate(
      work({
        type: "preprint",
        relatedVersionIds: { doi: "10.1000/pub" } as ExternalIds,
      }),
    );
    expect(identifierFilters([preprint], filterInput()).kept).toEqual([
      preprint,
    ]);
  });

  it("keeps a published paper whose preprint the user owns", () => {
    const owner = work({ ids: { doi: "10.1101/2024.01.01.3" } as ExternalIds });
    const published = candidate(
      work({
        type: "journal-article",
        relatedVersionIds: owner.ids,
      }),
    );
    expect(
      identifierFilters(
        [published],
        filterInput({ ownership: ownershipOf([], [owner]) }),
      ).kept,
    ).toEqual([published]);
  });

  it("the per-run box drops preprints, and only when ticked", () => {
    const preprint = candidate(work({ type: "preprint" }));
    const article = candidate(work());
    expect(
      identifierFilters([preprint, article], filterInput()).kept,
    ).toHaveLength(2);
    const ticked = identifierFilters(
      [preprint, article],
      filterInput({ peerReviewedOnly: true }),
    );
    expect(ticked.kept).toEqual([article]);
    expect(ticked.dropped["not-peer-reviewed"]).toBe(1);
  });

  it("Done when: never reads an abstract or a tldr", () => {
    const reads: string[] = [];
    const spy = (w: CanonicalWork): CanonicalWork =>
      new Proxy(w, {
        get(target, name, receiver): unknown {
          if (name === "abstract" || name === "tldr") reads.push(name);
          return Reflect.get(target, name, receiver) as unknown;
        },
      });
    const member = work();
    const base = candidate(work());
    const spied: RecommendCandidate = {
      ...base,
      work: spy(base.work),
      records: base.records,
    };
    const result = identifierFilters(
      [spied],
      filterInput({ ownership: ownershipOf([member]) }),
    );
    expect(result.kept).toHaveLength(1);
    expect(reads).toEqual([]);
  });

  it("keeps a row with no abstract: that is the later filter's to judge", () => {
    const bare = candidate(work({ abstract: undefined }));
    expect(identifierFilters([bare], filterInput()).kept).toEqual([bare]);
  });
});

// ---------------------------------------------------------------------------
// contentFilters
// ---------------------------------------------------------------------------

describe("contentFilters", () => {
  it("Done when: drops a row with neither an abstract nor a tldr", () => {
    const none = candidate(work({ abstract: undefined }));
    const blank = candidate(work({ abstract: "  \n " }));
    const kept = candidate(work());
    const result = contentFilters([none, blank, kept], filterInput());
    expect(result.kept).toEqual([kept]);
    expect(result.dropped["no-abstract"]).toBe(2);
  });

  it("keeps a row whose only text is a tldr, through the shipped mapper", () => {
    const record = mapPaper(
      {
        paperId: "abc",
        title: "A paper with only a short summary",
        abstract: null,
        tldr: { model: "tldr@v2", text: "A short machine summary." },
        authors: [],
      },
      NOW,
      false,
      () => undefined,
    ) as SourceRecord;
    const tldrOnly = candidate(work({ abstract: record.work.abstract }));
    expect(contentFilters([tldrOnly], filterInput()).kept).toEqual([tldrOnly]);
  });

  it("runs the identifier rules again: a fill-in can bring what shows them", () => {
    const member = work({ ids: { doi: "10.1000/late" } as ExternalIds });
    const filledIn = candidate(work({ ids: member.ids }));
    const old = candidate(work({ publishedDate: dateOf(2019) }));
    const preprint = candidate(work({ type: "preprint" }));
    const input = filterInput({
      ownership: ownershipOf([member]),
      peerReviewedOnly: true,
    });
    const result = contentFilters([filledIn, old, preprint], input);
    expect(result.kept).toEqual([]);
    expect(result.dropped).toMatchObject({
      "in-collection": 1,
      "outside-window": 1,
      "not-peer-reviewed": 1,
      "no-abstract": 0,
    });
  });
});

// ---------------------------------------------------------------------------
// readDismissed, on the shipped store
// ---------------------------------------------------------------------------

function sqliteConnection(): SqlConnection {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    queryAsync(sql, params) {
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params) {
      const found = db.prepare(sql).get(...bind(params));
      return Promise.resolve(
        found === undefined ? false : Object.values(found)[0],
      );
    },
    async executeTransaction(func) {
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
  };
}

function recommendationOf(
  w: CanonicalWork,
  profileId = PROFILE_ID,
): Recommendation {
  return {
    id: recommendationId(profileId, w.workKey),
    profileId,
    work: w,
    score: 0.5,
    signals: {
      similarity: 0,
      recency: 0,
      velocity: 0,
      novelty: 0,
      authorAffinity: 0,
      venueAffinity: 0,
      generatorAgreement: 0,
      coupling: 0,
    },
    similaritySpace: "lexical",
    reasons: [{ id: "similarity" }],
    discoveredVia: [{ sourceId: "europepmc", strategy: "keyword-search" }],
    generatedAtEpochMs: NOW,
  };
}

describe("readDismissed", () => {
  it("reads every rejection of this collection from the shipped store", async () => {
    const connection = sqliteConnection();
    await runMigrations(connection);
    const store = createRecommendationStore(connection);
    const other = collectionProfileId(1, "ZZZZ9999");
    const rejectedWorks = Array.from({ length: 12 }, (_unused, index) =>
      work({
        ids: {
          doi: `10.1000/d${String(index)}`,
          pmid: String(100 + index),
          arxivId: `2401.0000${String(index % 10)}`,
        } as ExternalIds,
      }),
    );
    for (const rejected of rejectedWorks) {
      const row = recommendationOf(rejected);
      await store.put(row);
      await store.reject(row.id, NOW);
    }
    const notRejected = recommendationOf(work());
    await store.put(notRejected);
    const elsewhere = recommendationOf(work(), other);
    await store.put(elsewhere);
    await store.reject(elsewhere.id, NOW);

    const dismissed = await readDismissed(store, PROFILE_ID);
    // All of them: not `recentNegatives`' newest 10.
    expect(dismissed.workKeys.size).toBe(12);
    expect(dismissed.doi.size).toBe(12);
    expect(dismissed.pmid.size).toBe(12);
    expect(dismissed.arxiv.has("2401.00003")).toBe(true);
    expect(dismissed.workKeys.has(notRejected.work.workKey)).toBe(false);
    expect(dismissed.workKeys.has(elsewhere.work.workKey)).toBe(false);
  });

  it("warns and hides none when the store cannot be read", async () => {
    const warn = vi.fn();
    const dismissed = await readDismissed(
      {
        listRejected: () =>
          Promise.reject(new StorageError("not a recommendation")),
      },
      PROFILE_ID,
      { warn } as unknown as Logger,
    );
    expect(dismissed.workKeys.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("answers none with no logger too", async () => {
    await expect(
      readDismissed(
        { listRejected: () => Promise.reject(new StorageError("x")) },
        PROFILE_ID,
      ),
    ).resolves.toMatchObject({ workKeys: new Set() });
  });

  it("lets a programming error through", async () => {
    await expect(
      readDismissed(
        { listRejected: () => Promise.reject(new TypeError("bug")) },
        PROFILE_ID,
      ),
    ).rejects.toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// The eight terms
// ---------------------------------------------------------------------------

describe("similarity and novelty on SPECTER2", () => {
  const near = vec(1, 0, 0);
  const far = vec(0, 1, 0);

  it("similarity is the maximum over centroids, rescaled, not the mean", async () => {
    const c = candidate(work());
    const signals = await signalsOf(c, {
      profile: specterProfile([
        [1, 0, 0],
        [0, 1, 0],
      ]),
      vectors: new Map([[c.work.workKey, near]]),
    });
    expect(signals.similarity).toBeCloseTo(1, 6);
  });

  it("rescales cosine into [0, 1]: opposed reads 0, square 0.5", async () => {
    const opposed = candidate(work());
    const square = candidate(work());
    const profile = specterProfile([[1, 0, 0]]);
    const vectors = new Map([
      [opposed.work.workKey, vec(-1, 0, 0)],
      [square.work.workKey, far],
    ]);
    expect(
      (await signalsOf(opposed, { profile, vectors })).similarity,
    ).toBeCloseTo(0, 6);
    expect(
      (await signalsOf(square, { profile, vectors })).similarity,
    ).toBeCloseTo(0.5, 6);
  });

  it("Do NOT: novelty is the rescaled distance from the nearest member", async () => {
    const a = work();
    const b = work();
    const c = candidate(work());
    const signals = await signalsOf(c, {
      profile: specterProfile([[1, 0, 0]]),
      works: [a, b],
      vectors: new Map([
        [a.workKey, far],
        [b.workKey, vec(-1, 0, 0)],
        [c.work.workKey, near],
      ]),
    });
    // Nearest member is at cosine 0: rescaled 0.5, so 0.5 and never the bare 1.
    expect(signals.novelty).toBeCloseTo(0.5, 6);
    const opposed = await signalsOf(c, {
      profile: specterProfile([[1, 0, 0]]),
      works: [b],
      vectors: new Map([
        [b.workKey, vec(-1, 0, 0)],
        [c.work.workKey, near],
      ]),
    });
    // The bare 1 − cosine would read 2 here, and be clipped to 1 only by luck.
    expect(opposed.novelty).toBeCloseTo(1, 6);
    const same = await signalsOf(c, {
      profile: specterProfile([[1, 0, 0]]),
      works: [a, b],
      vectors: new Map([
        [a.workKey, near],
        [b.workKey, far],
        [c.work.workKey, near],
      ]),
    });
    expect(same.novelty).toBeCloseTo(0, 6);
  });

  it("is not the mirror of similarity on this space", async () => {
    const member = work();
    const c = candidate(work());
    const signals = await signalsOf(c, {
      profile: specterProfile([[1, 0, 0]]),
      works: [member],
      vectors: new Map([
        [member.workKey, vec(1, 0, 0)],
        [c.work.workKey, vec(0.6, 0.8, 0)],
      ]),
    });
    expect(signals.similarity).toBeCloseTo(0.8, 5);
    expect(signals.novelty).toBeCloseTo(0.2, 5);
  });

  it("a candidate with no vector reads 0 on both, not 1 on novelty", async () => {
    const member = work();
    const c = candidate(work({ abstract: `${member.title} words` }));
    const signals = await signalsOf(c, {
      profile: specterProfile([[1, 0, 0]]),
      works: [member],
      vectors: new Map([[member.workKey, near]]),
    });
    expect(signals.similarity).toBe(0);
    expect(signals.novelty).toBe(0);
  });

  it("novelty reads 0 when no member has a vector", async () => {
    const member = work();
    const c = candidate(work());
    const signals = await signalsOf(c, {
      profile: specterProfile([[1, 0, 0]]),
      works: [member],
      vectors: new Map([[c.work.workKey, near]]),
    });
    expect(signals.similarity).toBeCloseTo(1, 6);
    expect(signals.novelty).toBe(0);
  });

  it("the row says which space it is on", async () => {
    const c = candidate(work());
    const scoring = await scoreRecommendations(
      [c],
      scoreInput({ profile: specterProfile([[1, 0, 0]]) }),
    );
    expect(scoring.similaritySpace).toBe("specter_v2");
    expect(scoring.rows[0]?.recommendation.similaritySpace).toBe("specter_v2");
  });

  it("treats a profile with no model name as SPECTER2", async () => {
    const c = candidate(work());
    const signals = await signalsOf(c, {
      profile: { ...LEXICAL_PROFILE, centroids: [[1, 0, 0]] },
      vectors: new Map([[c.work.workKey, near]]),
    });
    expect(signals.similarity).toBeCloseTo(1, 6);
  });

  it("throws on two models and on two lengths: a defect, not a low score", async () => {
    const c = candidate(work());
    await expect(
      signalsOf(c, {
        profile: specterProfile([[1, 0, 0]], { embeddingModel: "other" }),
        vectors: new Map([[c.work.workKey, near]]),
      }),
    ).rejects.toThrow(RangeError);
    await expect(
      signalsOf(c, {
        profile: specterProfile([[1, 0]]),
        vectors: new Map([[c.work.workKey, near]]),
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe("similarity and novelty on the word space", () => {
  const memberText = (words: string): CanonicalWork =>
    work({ title: words, abstract: words });

  it("a keyed run with no vectors scores in words, and says so", async () => {
    const member = memberText("crispr base editing human cells");
    const c = candidate(memberText("crispr base editing mouse liver"));
    const scoring = await scoreRecommendations(
      [c],
      scoreInput({
        profile: LEXICAL_PROFILE,
        works: [member],
        // Vectors on hand are not read: one space per run.
        vectors: new Map([[c.work.workKey, vec(1, 0)]]),
      }),
    );
    expect(scoring.similaritySpace).toBe("lexical");
    expect(scoring.rows[0]?.recommendation.similaritySpace).toBe("lexical");
    expect(scoring.rows[0]?.recommendation.signals.similarity).toBeGreaterThan(
      0,
    );
  });

  it("does not rescale: a pair with no word in common reads 0 and novelty 1", async () => {
    const member = memberText("alpha beta gamma delta");
    const c = candidate(memberText("epsilon zeta eta theta"));
    const signals = await signalsOf(c, { works: [member] });
    expect(signals.similarity).toBe(0);
    expect(signals.novelty).toBe(1);
  });

  it("a candidate equal to the one member reads 1 and 0", async () => {
    const words = "alpha beta gamma delta";
    const member = memberText(words);
    const c = candidate(memberText(words));
    const signals = await signalsOf(c, { works: [member] });
    expect(signals.similarity).toBeCloseTo(1, 6);
    expect(signals.novelty).toBeCloseTo(0, 6);
  });

  it("the decision: similarity reads the whole collection, novelty the nearest member", async () => {
    // Close to one member of three, so the highest cosine says "very similar" while
    // the collection as a whole does not. With the highest cosine as similarity the
    // two would sum to exactly 1, and the slider would have one term to move.
    const members = [
      memberText("alpha beta gamma delta"),
      memberText("kappa lambda mu nu"),
      memberText("sigma tau upsilon phi"),
    ];
    const c = candidate(memberText("alpha beta gamma delta"));
    const signals = await signalsOf(c, { works: members });
    expect(signals.novelty).toBeCloseTo(0, 6);
    expect(signals.similarity).toBeGreaterThan(0.4);
    expect(signals.similarity).toBeLessThan(0.7);
    expect(signals.similarity + signals.novelty).not.toBeCloseTo(1, 2);
  });

  it("reads the mean of every member, not the first", async () => {
    const members = [
      memberText("kappa lambda mu nu"),
      memberText("alpha beta gamma delta"),
    ];
    const c = candidate(memberText("alpha beta gamma delta"));
    const signals = await signalsOf(c, { works: members });
    expect(signals.similarity).toBeGreaterThan(0.5);
  });

  it("sums a word's weight over the members, then takes unit length", async () => {
    const members = [
      memberText("alpha beta gamma"),
      memberText("alpha delta epsilon"),
      memberText("alpha zeta eta"),
    ];
    const incoming = memberText("alpha beta theta");
    const space = lexicalSpace(members);
    const mean = new Map<string, number>();
    for (const member of members) {
      const vector = space.vector(member);
      vector.terms.forEach((term, index) => {
        mean.set(
          term,
          (mean.get(term) ?? 0) + (vector.weights[index] as number),
        );
      });
    }
    const norm = Math.sqrt(
      [...mean.values()].reduce((sum, value) => sum + value * value, 0),
    );
    const own = space.vector(incoming);
    let expected = 0;
    own.terms.forEach((term, index) => {
      expected +=
        ((own.weights[index] as number) * (mean.get(term) ?? 0)) / norm;
    });
    expect(expected).toBeGreaterThan(0);
    const signals = await signalsOf(candidate(incoming), { works: members });
    expect(signals.similarity).toBeCloseTo(expected, 9);
  });

  it("a candidate with no text reads 0 on both", async () => {
    const member = memberText("alpha beta gamma");
    const c = candidate(work({ title: "", abstract: undefined }));
    const signals = await signalsOf(c, { works: [member] });
    expect(signals.similarity).toBe(0);
    expect(signals.novelty).toBe(0);
  });

  it("a collection with no text gives 0 on both", async () => {
    const empty = work({ title: "", abstract: undefined });
    const c = candidate(memberText("alpha beta gamma"));
    const signals = await signalsOf(c, { works: [empty] });
    expect(signals.similarity).toBe(0);
    expect(signals.novelty).toBe(0);
  });

  it("the slider moves the order between its ends, on this space too", async () => {
    const members = [
      memberText("alpha beta gamma delta epsilon"),
      memberText("alpha beta gamma zeta eta"),
      memberText("alpha beta theta iota kappa"),
    ];
    const close = candidate(memberText("alpha beta gamma delta epsilon"));
    const far = candidate(memberText("lambda mu nu xi omicron"));
    const scored = (exploration: number) =>
      scoreRecommendations(
        [close, far],
        scoreInput({ works: members, exploration }),
      );
    expect(keysOf((await scored(0)).rows)[0]).toBe(close.work.workKey);
    expect(keysOf((await scored(1)).rows)[0]).toBe(far.work.workKey);
  });
});

describe("recency and velocity", () => {
  const YEAR_MS = 365 * 864e5;

  it("recency is exp(−ageDays / 365 / 1.5) from the publication date", async () => {
    const c = candidate(work({ publishedDate: dateOf(2025, 11, 5) }));
    const { recency } = await signalsOf(c, {
      nowEpochMs: Date.UTC(2026, 10, 5),
    });
    expect(recency).toBeCloseTo(Math.exp(-1 / 1.5), 9);
  });

  it("reads month and day when it has them", async () => {
    const c = candidate(work({ publishedDate: dateOf(2026, 3, 15) }));
    const at = Date.UTC(2026, 2, 15) + YEAR_MS;
    expect((await signalsOf(c, { nowEpochMs: at })).recency).toBeCloseTo(
      Math.exp(-1 / 1.5),
      9,
    );
  });

  it("takes the earliest day a partial date can name", async () => {
    const yearOnly = candidate(work({ publishedDate: dateOf(2026) }));
    const monthOnly = candidate(work({ publishedDate: dateOf(2026, 3) }));
    const at = Date.UTC(2027, 0, 1);
    expect((await signalsOf(yearOnly, { nowEpochMs: at })).recency).toBeCloseTo(
      Math.exp(-1 / 1.5),
      9,
    );
    const days = (at - Date.UTC(2026, 2, 1)) / 864e5;
    expect(
      (await signalsOf(monthOnly, { nowEpochMs: at })).recency,
    ).toBeCloseTo(Math.exp(-days / 365 / 1.5), 9);
  });

  it("treats a month or day out of range as absent", async () => {
    const at = Date.UTC(2027, 0, 1);
    const yearly = Math.exp(-1 / 1.5);
    const badMonth = candidate(work({ publishedDate: dateOf(2026, 0, 15) }));
    const lateMonth = candidate(work({ publishedDate: dateOf(2026, 13, 15) }));
    const badDay = candidate(work({ publishedDate: dateOf(2026, 1, 0) }));
    const lateDay = candidate(work({ publishedDate: dateOf(2026, 1, 40) }));
    for (const c of [badMonth, lateMonth, badDay, lateDay]) {
      expect((await signalsOf(c, { nowEpochMs: at })).recency).toBeCloseTo(
        yearly,
        9,
      );
    }
  });

  it("a work dated ahead reads 1, not above", async () => {
    const c = candidate(work({ publishedDate: dateOf(2027, 6) }));
    expect((await signalsOf(c)).recency).toBe(1);
  });

  it("an undated work reads 0 on both and stays", async () => {
    const c = candidate(work({ publishedDate: undefined, citationCount: 50 }));
    const signals = await signalsOf(c);
    expect(signals.recency).toBe(0);
    expect(signals.velocity).toBe(0);
    const bad = candidate(work({ publishedDate: dateOf(Number.NaN) }));
    expect((await signalsOf(bad)).recency).toBe(0);
  });

  it("velocity is citations per year over 20, with a floor of 0.25 years", async () => {
    const at = Date.UTC(2027, 0, 1);
    const twoYears = candidate(
      work({ publishedDate: dateOf(2025), citationCount: 20 }),
    );
    const { velocity } = await signalsOf(twoYears, { nowEpochMs: at });
    expect(velocity).toBeCloseTo(20 / (730 / 365) / 20, 9);
    const brandNew = candidate(
      work({ publishedDate: dateOf(2027), citationCount: 1 }),
    );
    expect(
      (await signalsOf(brandNew, { nowEpochMs: at })).velocity,
    ).toBeCloseTo(1 / 0.25 / 20, 9);
  });

  it("§7.4's example: a 2026 paper with 5 beats a 2023 paper with 12", async () => {
    const fresh = candidate(
      work({ publishedDate: dateOf(2026), citationCount: 5 }),
    );
    const older = candidate(
      work({ publishedDate: dateOf(2023), citationCount: 12 }),
    );
    const at = Date.UTC(2026, 10, 5);
    expect(
      (await signalsOf(fresh, { nowEpochMs: at })).velocity,
    ).toBeGreaterThan((await signalsOf(older, { nowEpochMs: at })).velocity);
  });

  it("velocity is capped at 1, and no count reads 0", async () => {
    const cited = candidate(work({ citationCount: 100000 }));
    expect((await signalsOf(cited)).velocity).toBe(1);
    expect((await signalsOf(candidate(work()))).velocity).toBe(0);
    const negative = candidate(work({ citationCount: -5 }));
    expect((await signalsOf(negative)).velocity).toBe(0);
  });
});

describe("authorAffinity", () => {
  const profile = specterProfile([], {
    topAuthors: [
      { name: "Doudna JA", count: 4 },
      { name: "Liu DR", count: 2, orcid: "0000-0001" },
      { name: "Zhang F", count: 2, orcid: "0000-0002" },
    ],
  });
  const doudna: Author = { family: "Doudna", given: "Jennifer A." };
  const liu: Author = { family: "Liu", given: "David R" };
  const zhang: Author = { family: "Zhang", given: "Feng" };

  it("0.5 per profile author, capped at 1", async () => {
    const none = candidate(work());
    const one = candidate(work({ authors: [doudna] }));
    const three = candidate(work({ authors: [doudna, liu, zhang] }));
    expect((await signalsOf(none, { profile })).authorAffinity).toBe(0);
    expect((await signalsOf(one, { profile })).authorAffinity).toBe(0.5);
    expect((await signalsOf(three, { profile })).authorAffinity).toBe(1);
  });

  it("counts one person once", async () => {
    const twice = candidate(work({ authors: [doudna, doudna] }));
    expect((await signalsOf(twice, { profile })).authorAffinity).toBe(0.5);
  });

  it("two ORCIDs that differ are two people, whatever the name", async () => {
    const other = candidate(
      work({ authors: [{ ...liu, orcid: "0000-9999" }] }),
    );
    expect((await signalsOf(other, { profile })).authorAffinity).toBe(0);
    const same = candidate(work({ authors: [{ ...liu, orcid: "0000-0001" }] }));
    expect((await signalsOf(same, { profile })).authorAffinity).toBe(0.5);
    const unknownSide = candidate(
      work({ authors: [{ ...doudna, orcid: "0000-7777" }] }),
    );
    expect((await signalsOf(unknownSide, { profile })).authorAffinity).toBe(
      0.5,
    );
  });

  it("an ORCID finds a person under another spelling", async () => {
    const renamed = candidate(
      work({
        authors: [{ family: "Liu", given: "Dave", orcid: "0000-0001" }],
      }),
    );
    expect((await signalsOf(renamed, { profile })).authorAffinity).toBe(0.5);
  });
});

describe("venueAffinity", () => {
  const profile: RecommendScoreProfile = {
    ...LEXICAL_PROFILE,
    topVenues: [
      { name: "Nature Biotechnology", count: 4, issn: ["1087-0156"] },
      { name: "Cell", count: 2 },
    ],
  };

  it("1 for a top venue, whatever its punctuation or case", async () => {
    const c = candidate(work({ containerTitle: "NATURE  BIOTECHNOLOGY." }));
    expect((await signalsOf(c, { profile })).venueAffinity).toBe(1);
  });

  it("1 when only the abbreviation names it", async () => {
    const c = candidate(
      work({ containerTitle: undefined, containerAbbreviation: "Cell" }),
    );
    expect((await signalsOf(c, { profile })).venueAffinity).toBe(1);
  });

  it("0.3 for the same ISSN family under another name", async () => {
    const c = candidate(
      work({ containerTitle: "Nat Biotechnol", issn: ["10870156"] }),
    );
    expect((await signalsOf(c, { profile })).venueAffinity).toBe(0.3);
    const lower = candidate(
      work({
        containerTitle: "Other",
        issn: ["2041-172x"],
      }),
    );
    const held: RecommendScoreProfile = {
      ...LEXICAL_PROFILE,
      topVenues: [{ name: "x", count: 1, issn: ["2041-172X"] }],
    };
    expect((await signalsOf(lower, { profile: held })).venueAffinity).toBe(0.3);
  });

  it("0 otherwise, and for a work with no venue at all", async () => {
    const other = candidate(work({ containerTitle: "Elsewhere", issn: ["1"] }));
    expect((await signalsOf(other, { profile })).venueAffinity).toBe(0);
    const none = candidate(work({ containerTitle: undefined }));
    expect((await signalsOf(none, { profile })).venueAffinity).toBe(0);
  });
});

describe("generatorAgreement", () => {
  it("(distinct strategies − 1) / 3, capped at 1", async () => {
    const agreement = async (
      ...strategies: RecommendationStrategy[]
    ): Promise<number> =>
      (
        await signalsOf(
          candidate(
            work(),
            strategies.map((s) => via(s)),
          ),
        )
      ).generatorAgreement;
    expect(await agreement("keyword-search")).toBe(0);
    expect(await agreement("keyword-search", "similar")).toBeCloseTo(1 / 3, 9);
    expect(
      await agreement("keyword-search", "similar", "recommendations"),
    ).toBeCloseTo(2 / 3, 9);
    expect(
      await agreement(
        "keyword-search",
        "similar",
        "recommendations",
        "forward-citations",
        "author-watch",
      ),
    ).toBe(1);
  });

  it("counts strategies, not list entries", async () => {
    const twice = candidate(work(), [
      via("forward-citations"),
      via("forward-citations"),
      via("forward-citations"),
    ]);
    expect((await signalsOf(twice)).generatorAgreement).toBe(0);
  });
});

describe("coupling", () => {
  const refs = (...dois: string[]): ReadonlySet<string> => new Set(dois);

  it("shared references over the root of the two sizes, best member", async () => {
    const c = candidate(work());
    const { coupling } = await signalsOf(c, {
      references: {
        ofCandidate: () => refs("a", "b", "c", "d"),
        ofCollection: new Map([
          ["low", refs("a", "x", "y", "z")],
          ["high", refs("a", "b", "c", "q")],
          ["none", refs("r")],
        ]),
      },
    });
    expect(coupling).toBeCloseTo(3 / Math.sqrt(16), 9);
  });

  it("reads the candidate's own list", async () => {
    const c = candidate(work());
    const seen: string[] = [];
    await signalsOf(c, {
      references: {
        ofCandidate(workKey) {
          seen.push(workKey);
          return undefined;
        },
        ofCollection: new Map(),
      },
    });
    expect(seen).toEqual([c.work.workKey]);
  });

  it("a member with no references does not spoil the ones after it", async () => {
    const c = candidate(work());
    const { coupling } = await signalsOf(c, {
      references: {
        ofCandidate: () => refs("a", "b"),
        ofCollection: new Map([
          ["empty", refs()],
          ["full", refs("a", "b")],
        ]),
      },
    });
    expect(coupling).toBeCloseTo(1, 9);
  });

  it("is 0, never NaN, with no references on either side", async () => {
    const c = candidate(work());
    expect((await signalsOf(c)).coupling).toBe(0);
    const empty = await signalsOf(c, {
      references: {
        ofCandidate: () => refs(),
        ofCollection: new Map([["m", refs("a")]]),
      },
    });
    expect(empty.coupling).toBe(0);
    const noneCached = await signalsOf(c, {
      references: {
        ofCandidate: () => undefined,
        ofCollection: new Map([["m", refs("a")]]),
      },
    });
    expect(noneCached.coupling).toBe(0);
    const emptyMember = await signalsOf(c, {
      references: {
        ofCandidate: () => refs("a"),
        ofCollection: new Map([["m", refs()]]),
      },
    });
    expect(emptyMember.coupling).toBe(0);
  });
});

describe("the score", () => {
  it("is the weighted sum of the eight terms, and not rescaled", async () => {
    const member = work({ authors: [{ family: "Liu", given: "David R" }] });
    const c = candidate(
      work({
        authors: [{ family: "Liu", given: "David R" }],
        containerTitle: "Cell",
        citationCount: 7,
      }),
      [via("recommendations"), via("similar")],
    );
    const row = await oneRow(c, {
      exploration: 0.5,
      works: [member],
      profile: {
        ...LEXICAL_PROFILE,
        topAuthors: [{ name: "Liu DR", count: 2 }],
        topVenues: [{ name: "Cell", count: 2 }],
      },
    });
    const { signals, score } = row.recommendation;
    const weights = recommendationWeights(0.5);
    const expected =
      weights.similarity * signals.similarity +
      weights.recency * signals.recency +
      weights.velocity * signals.velocity +
      weights.novelty * signals.novelty +
      weights.authorAffinity * signals.authorAffinity +
      weights.venueAffinity * signals.venueAffinity +
      weights.generatorAgreement * signals.generatorAgreement +
      weights.coupling * signals.coupling;
    expect(score).toBeCloseTo(expected, 12);
    expect(signals.authorAffinity).toBe(0.5);
    expect(signals.venueAffinity).toBe(1);
    expect(signals.generatorAgreement).toBeCloseTo(1 / 3, 9);
  });

  it("a row with every term at 1 scores exactly up to 1, at any slider position", async () => {
    const vector = vec(1, 0, 0);
    const member = work();
    const c = candidate(
      work({
        authors: [
          { family: "A", given: "A" },
          { family: "B", given: "B" },
        ],
        containerTitle: "Cell",
        citationCount: 100000,
        publishedDate: dateOf(2027),
      }),
      [
        via("recommendations"),
        via("similar"),
        via("keyword-search"),
        via("author-watch"),
      ],
    );
    const profile = specterProfile([[1, 0, 0]], {
      topAuthors: [
        { name: "A A", count: 2 },
        { name: "B B", count: 2 },
      ],
      topVenues: [{ name: "Cell", count: 2 }],
    });
    const row = await oneRow(c, {
      profile,
      works: [member],
      vectors: new Map([
        [member.workKey, vec(-1, 0, 0)],
        [c.work.workKey, vector],
      ]),
      references: {
        ofCandidate: () => new Set(["a"]),
        ofCollection: new Map([["m", new Set(["a"])]]),
      },
    });
    expect(row.recommendation.score).toBeLessThanOrEqual(1);
    expect(row.recommendation.score).toBeCloseTo(1, 6);
  });

  it("no term and no score is NaN on the sparsest row", async () => {
    const sparse = candidate(
      work({
        title: "",
        abstract: undefined,
        authors: [],
        containerTitle: undefined,
        publishedDate: undefined,
        citationCount: Number.NaN,
      }),
    );
    const row = await oneRow(sparse);
    for (const value of Object.values(row.recommendation.signals)) {
      expect(value).toBe(0);
    }
    expect(row.recommendation.score).toBe(0);
  });

  it("ranks highest first, and a tie goes to the smaller work key", async () => {
    const low = candidate(
      work({ workKey: "pmid:1", publishedDate: dateOf(2024) }),
    );
    const high = candidate(work({ workKey: "pmid:2" }));
    const tieB = candidate(
      work({ workKey: "pmid:9", publishedDate: undefined }),
    );
    const tieA = candidate(
      work({ workKey: "pmid:8", publishedDate: undefined }),
    );
    const { rows } = await scoreRecommendations(
      [tieB, low, tieA, high],
      scoreInput(),
    );
    expect(keysOf(rows)).toEqual(["pmid:2", "pmid:1", "pmid:8", "pmid:9"]);
  });

  it("drops nothing, and leaves the input alone", async () => {
    const list = [candidate(work()), candidate(work())];
    const before = [...list];
    const { rows } = await scoreRecommendations(list, scoreInput());
    expect(rows).toHaveLength(2);
    expect(list).toEqual(before);
  });

  it("refuses a slider outside [0, 1]", async () => {
    await expect(
      scoreRecommendations([], scoreInput({ exploration: 1.5 })),
    ).rejects.toThrow(RangeError);
  });

  it("uses the slider it is given", async () => {
    const member = work({ title: "alpha beta", abstract: "alpha beta" });
    const c = candidate(
      work({ title: "gamma delta", abstract: "gamma delta" }),
    );
    const at = async (exploration?: number): Promise<number> =>
      (
        await oneRow(c, {
          works: [member],
          ...(exploration !== undefined && { exploration }),
        })
      ).recommendation.score;
    expect(await at(1)).toBeGreaterThan(await at(0));
    expect(await at()).toBeCloseTo(await at(0.25), 12);
  });
});

describe("what a row records", () => {
  it("builds the record the store takes, and nothing the store must not hold", async () => {
    const c = candidate(work(), [
      via("recommendations", 1),
      via("forward-citations"),
      via("forward-citations"),
    ]);
    const row = await oneRow(c);
    const { recommendation } = row;
    expect(recommendation.id).toBe(
      recommendationId(PROFILE_ID, c.work.workKey),
    );
    expect(recommendation.profileId).toBe(PROFILE_ID);
    expect(recommendation.work).toBe(c.work);
    expect(recommendation.generatedAtEpochMs).toBe(NOW);
    // One entry per list, with the topic group left behind.
    expect(recommendation.discoveredVia).toEqual([
      { sourceId: "semanticscholar", strategy: "recommendations" },
      { sourceId: "europepmc", strategy: "forward-citations" },
      { sourceId: "europepmc", strategy: "forward-citations" },
    ]);
    expect(recommendation).not.toHaveProperty("inLibrary");
    expect(recommendation).not.toHaveProperty("topicIndex");
    expect(recommendation).not.toHaveProperty("userAction");

    const connection = sqliteConnection();
    await runMigrations(connection);
    const stored =
      await createRecommendationStore(connection).put(recommendation);
    expect(stored.id).toBe(recommendation.id);
    expect(stored.signals).toEqual(recommendation.signals);
  });

  it("FR-46: marks a library item by identifier, and starts it unticked", async () => {
    const elsewhere = work();
    const row = await oneRow(candidate(work({ ids: elsewhere.ids })), {
      ownership: ownershipOf([], [elsewhere]),
    });
    expect(row.inLibrary).toBe(true);
    expect(row.checkedByDefault).toBe(false);
  });

  it("marks a library item by identifier and by work key, with no title index", async () => {
    const elsewhere = work();
    const noTitles = ownershipOf();
    const byIdentifier = await oneRow(candidate(work({ ids: elsewhere.ids })), {
      ownership: { ...noTitles, library: owned([elsewhere]) },
    });
    expect(byIdentifier.inLibrary).toBe(true);
    const keyed = work({ workKey: "s2:keyed", ids: {} as ExternalIds });
    const byKey = await oneRow(candidate(keyed), {
      ownership: {
        ...noTitles,
        library: { ...NOTHING_OWNED, workKeys: new Set(["s2:keyed"]) },
      },
    });
    expect(byKey.inLibrary).toBe(true);
  });

  it("asks the title tiers about the merged work, not its first record", async () => {
    const title =
      "A long and specific title about lipid delivery in human primary cells";
    const elsewhere = work({
      title,
      ids: {} as ExternalIds,
      authors: [{ family: "Kim", given: "Jun" }],
    });
    const merged = candidate(
      work({
        title,
        ids: { pmid: "888" } as ExternalIds,
        authors: [{ family: "Kim", given: "J" }],
      }),
    );
    const unlike = work();
    const record = merged.records[0] as SourceRecord;
    const firstRecordDiffers: RecommendCandidate = {
      ...merged,
      records: [
        {
          ...record,
          work: {
            ...record.work,
            title: unlike.title,
            authors: unlike.authors,
          },
        },
      ],
    };
    const row = await oneRow(firstRecordDiffers, {
      ownership: ownershipOf([], [elsewhere]),
    });
    expect(row.inLibrary).toBe(true);
    expect(
      identifierFilters(
        [firstRecordDiffers],
        filterInput({ ownership: ownershipOf([elsewhere]) }),
      ).dropped["in-collection"],
    ).toBe(1);
  });

  it("marks a library item by a title match", async () => {
    const title =
      "A long and specific title about delivery vectors in human primary cells";
    const elsewhere = work({
      title,
      ids: {},
      authors: [{ family: "Kim", given: "Jun" }],
    });
    const row = await oneRow(
      candidate(
        work({
          title,
          ids: { pmid: "777" } as ExternalIds,
          authors: [{ family: "Kim", given: "J" }],
        }),
      ),
      { ownership: ownershipOf([], [elsewhere]) },
    );
    expect(row.inLibrary).toBe(true);
  });

  it("an unowned row is unmarked and starts ticked", async () => {
    const row = await oneRow(candidate(work()));
    expect(row).toMatchObject({
      inLibrary: false,
      dismissed: false,
      preprint: false,
      checkedByDefault: true,
    });
  });

  it("a dismissed row kept by show dismissed is marked and unticked", async () => {
    const seen = work();
    const row = await oneRow(candidate(work({ ids: seen.ids })), {
      dismissed: owned([seen]),
    });
    expect(row.dismissed).toBe(true);
    expect(row.inLibrary).toBe(false);
    expect(row.checkedByDefault).toBe(false);
  });

  it("carries the preprint label", async () => {
    const row = await oneRow(candidate(work({ type: "preprint" })));
    expect(row.preprint).toBe(true);
  });

  it("a collection member is excluded, not marked: the two sets are separate", async () => {
    const member = work();
    const row = await oneRow(candidate(work()), {
      ownership: ownershipOf([member]),
    });
    expect(row.inLibrary).toBe(false);
  });
});

describe("topicIndex", () => {
  const twoTopics = specterProfile([
    [1, 0, 0],
    [0, 1, 0],
  ]);

  it("is the nearest centroid when k > 1", async () => {
    const c = candidate(work());
    const row = await oneRow(c, {
      profile: twoTopics,
      vectors: new Map([[c.work.workKey, vec(0.1, 1, 0)]]),
    });
    expect(row.recommendation.topicIndex).toBe(1);
    const first = await oneRow(c, {
      profile: twoTopics,
      vectors: new Map([[c.work.workKey, vec(1, 0.1, 0)]]),
    });
    expect(first.recommendation.topicIndex).toBe(0);
  });

  it("does not take the first when an opposed one comes first", async () => {
    const c = candidate(work());
    const row = await oneRow(c, {
      profile: specterProfile([
        [-1, 0, 0],
        [1, 0, 0],
      ]),
      vectors: new Map([[c.work.workKey, vec(1, 0, 0)]]),
    });
    expect(row.recommendation.topicIndex).toBe(1);
    expect(row.recommendation.signals.similarity).toBeCloseTo(1, 6);
  });

  it("overrides the group that asked: a vector is better evidence", async () => {
    const c = candidate(work(), [via("recommendations", 0)]);
    const row = await oneRow(c, {
      profile: twoTopics,
      vectors: new Map([[c.work.workKey, vec(0, 1, 0)]]),
    });
    expect(row.recommendation.topicIndex).toBe(1);
  });

  it("with no vector, falls back to the lowest group that found it", async () => {
    const c = candidate(work(), [
      via("recommendations", 3),
      via("recommendations", 1),
      via("similar"),
    ]);
    const row = await oneRow(c, { profile: twoTopics });
    expect(row.recommendation.topicIndex).toBe(1);
  });

  it("a tie goes to the lowest topic", async () => {
    const c = candidate(work());
    const row = await oneRow(c, {
      profile: specterProfile([
        [1, 0, 0],
        [1, 0, 0],
      ]),
      vectors: new Map([[c.work.workKey, vec(1, 0, 0)]]),
    });
    expect(row.recommendation.topicIndex).toBe(0);
  });

  it("is absent with no vector and no group", async () => {
    const row = await oneRow(candidate(work()), { profile: twoTopics });
    expect(row.recommendation).not.toHaveProperty("topicIndex");
  });

  it("is absent at k = 1 and on the word space", async () => {
    const c = candidate(work(), [via("recommendations", 0)]);
    const one = await oneRow(c, {
      profile: specterProfile([[1, 0, 0]]),
      vectors: new Map([[c.work.workKey, vec(1, 0, 0)]]),
    });
    expect(one.recommendation).not.toHaveProperty("topicIndex");
    const words = await oneRow(c);
    expect(words.recommendation).not.toHaveProperty("topicIndex");
  });

  it("topic 0 is kept, not read as absent", async () => {
    const c = candidate(work());
    const row = await oneRow(c, {
      profile: twoTopics,
      vectors: new Map([[c.work.workKey, vec(1, 0, 0)]]),
    });
    expect(row.recommendation).toHaveProperty("topicIndex", 0);
  });
});

describe("reasons", () => {
  const idsOf = (row: RecommendationRow): readonly string[] =>
    row.recommendation.reasons.map(({ id }) => id);

  it("§7.6's phrases come first, in its order", async () => {
    const author: Author = { family: "Liu", given: "David R" };
    const c = candidate(work({ authors: [author] }), [
      via("forward-citations"),
      via("recommendations"),
      via("forward-citations"),
      via("forward-citations"),
    ]);
    const row = await oneRow(c, {
      profile: {
        ...LEXICAL_PROFILE,
        topAuthors: [{ name: "Liu DR", count: 2 }],
      },
    });
    expect(row.recommendation.reasons.slice(0, 3)).toEqual([
      { id: "recommended-by-semantic-scholar" },
      { id: "cites-collection", count: 3 },
      { id: "author-in-collection", names: ["Liu DR"] },
    ]);
  });

  it("says nothing it cannot back", async () => {
    const row = await oneRow(candidate(work()));
    expect(idsOf(row)).not.toContain("recommended-by-semantic-scholar");
    expect(idsOf(row)).not.toContain("cites-collection");
    expect(idsOf(row)).not.toContain("author-in-collection");
  });

  it("names only the work's authors the profile holds", async () => {
    const c = candidate(
      work({
        authors: [
          { family: "Liu", given: "David R" },
          { family: "Nobody", given: "Ann" },
          { family: "Zhang", given: "Feng" },
        ],
      }),
    );
    const row = await oneRow(c, {
      profile: {
        ...LEXICAL_PROFILE,
        topAuthors: [
          { name: "Liu DR", count: 2 },
          { name: "Zhang F", count: 2 },
        ],
      },
    });
    expect(
      row.recommendation.reasons.find(({ id }) => id === "author-in-collection")
        ?.names,
    ).toEqual(["Liu DR", "Zhang F"]);
  });

  it("then the two strongest terms, by what they added to the score", async () => {
    const vector = vec(1, 0, 0);
    const c = candidate(
      work({ containerTitle: "Cell", publishedDate: undefined }),
      [via("similar"), via("keyword-search")],
    );
    const row = await oneRow(c, {
      profile: specterProfile([[1, 0, 0]], {
        topVenues: [{ name: "Cell", count: 2 }],
      }),
      vectors: new Map([[c.work.workKey, vector]]),
    });
    // similarity 0.30, generatorAgreement 0.04, venueAffinity 0.05.
    expect(idsOf(row)).toEqual(["similarity", "venueAffinity"]);
  });

  it("weights decide, not the raw value", async () => {
    // venueAffinity reads 1 and recency about 0.97, but 0.15 × 0.97 beats 0.05 × 1.
    const c = candidate(work({ containerTitle: "Cell" }));
    const row = await oneRow(c, {
      nowEpochMs: Date.UTC(2026, 0, 15),
      profile: {
        ...LEXICAL_PROFILE,
        topVenues: [{ name: "Cell", count: 2 }],
      },
    });
    expect(idsOf(row)[0]).toBe("recency");
    expect(idsOf(row)[1]).toBe("venueAffinity");
    expect(idsOf(row)).toHaveLength(2);
  });

  it("does not say authorAffinity beside the phrase that names the people", async () => {
    const c = candidate(
      work({
        authors: [{ family: "Liu", given: "David R" }],
        publishedDate: undefined,
      }),
    );
    const row = await oneRow(c, {
      profile: {
        ...LEXICAL_PROFILE,
        topAuthors: [{ name: "Liu DR", count: 2 }],
      },
    });
    expect(idsOf(row)).toEqual(["author-in-collection"]);
  });

  it("novelty is a reason only when the user moved towards Exploratory", async () => {
    const member = work({ title: "alpha beta", abstract: "alpha beta" });
    const c = candidate(
      work({
        title: "gamma delta",
        abstract: "gamma delta",
        publishedDate: undefined,
      }),
    );
    const atDefault = await oneRow(c, { works: [member] });
    expect(atDefault.recommendation.signals.novelty).toBe(1);
    expect(idsOf(atDefault)).not.toContain("novelty");
    const towards = await oneRow(c, { works: [member], exploration: 0.5 });
    expect(idsOf(towards)).toContain("novelty");
    const away = await oneRow(c, { works: [member], exploration: 0.1 });
    expect(idsOf(away)).not.toContain("novelty");
  });

  it("every row has a reason: with nothing else, similarity, which reads 0", async () => {
    const row = await oneRow(candidate(work({ publishedDate: undefined })));
    expect(row.recommendation.reasons).toEqual([{ id: "similarity" }]);
  });
});

// ---------------------------------------------------------------------------
// diversify
// ---------------------------------------------------------------------------

/** Rows scored by citation velocity alone, so each one's score is known. */
async function scoredList(
  list: readonly CanonicalWork[],
  overrides: Partial<RecommendScoreInput> = {},
): ReturnType<typeof scoreRecommendations> {
  return scoreRecommendations(
    list.map((w) => candidate(w)),
    scoreInput(overrides),
  );
}

describe("diversify", () => {
  const person = (family: string): Author => ({ family, given: "Ann" });

  it("has §7.5's constants", () => {
    expect(MAX_PER_AUTHOR).toBe(2);
    expect(MAX_PER_VENUE).toBe(4);
    expect(MMR_LAMBDA).toBe(0.75);
    expect(RECOMMEND_TOP_K).toBe(30);
  });

  it("stops at the default top K", async () => {
    const list = Array.from({ length: RECOMMEND_TOP_K + 5 }, () => work());
    const rows = await diversify(await scoredList(list));
    expect(rows).toHaveLength(30);
  });

  it("takes a top K it is given", async () => {
    const rows = await diversify(await scoredList([work(), work(), work()]), {
      topK: 2,
    });
    expect(rows).toHaveLength(2);
  });

  it.each([0, -1, 1.5])("refuses a top K of %d", async (topK) => {
    await expect(
      diversify(await scoredList([work()]), { topK }),
    ).rejects.toThrow(RangeError);
  });

  it("picks the top score first, whatever the penalty would be", async () => {
    const list = [
      work({ citationCount: 5 }),
      work({ citationCount: 500 }),
      work({ citationCount: 50 }),
    ];
    const scoring = await scoredList(list);
    const rows = await diversify(scoring);
    expect(rows[0]).toBe(scoring.rows[0]);
    expect(rows[0]?.recommendation.work.citationCount).toBe(500);
  });

  it("no more than two rows per first or last author", async () => {
    const shared = person("Prolific");
    const list = [
      work({ authors: [shared], citationCount: 500 }),
      work({ authors: [person("Other1"), shared], citationCount: 400 }),
      work({ authors: [shared, person("Other2")], citationCount: 300 }),
      work({ authors: [person("Other3")], citationCount: 1 }),
    ];
    const rows = await diversify(await scoredList(list));
    expect(rows.map((row) => row.recommendation.work.citationCount)).toEqual([
      500, 400, 1,
    ]);
  });

  it("a middle author is not capped", async () => {
    const shared = person("Middle");
    const list = Array.from({ length: 4 }, (_unused, index) =>
      work({
        authors: [
          person(`First${String(index)}`),
          shared,
          person(`Last${String(index)}`),
        ],
      }),
    );
    expect(await diversify(await scoredList(list))).toHaveLength(4);
  });

  it("one author who is both first and last counts once", async () => {
    const solo = person("Solo");
    const list = [
      work({ authors: [solo, person("x"), solo], citationCount: 9 }),
      work({ authors: [solo], citationCount: 8 }),
      work({ authors: [solo], citationCount: 7 }),
    ];
    expect(await diversify(await scoredList(list))).toHaveLength(2);
  });

  it("no more than four rows per venue, however it is spelt", async () => {
    const list = Array.from({ length: 6 }, (_unused, index) =>
      work({
        containerTitle: index % 2 === 0 ? "Cell Reports" : "CELL REPORTS.",
      }),
    );
    expect(await diversify(await scoredList(list))).toHaveLength(4);
  });

  it("an author with no name is nobody: no cap", async () => {
    const list = Array.from({ length: 3 }, () =>
      work({ authors: [{ family: "" }] }),
    );
    expect(await diversify(await scoredList(list))).toHaveLength(3);
  });

  it("a row with no venue or no authors is not capped", async () => {
    const list = Array.from({ length: 6 }, () =>
      work({ containerTitle: undefined, authors: [] }),
    );
    expect(await diversify(await scoredList(list))).toHaveLength(6);
  });

  it("the caps are hard: a narrow pool gives a short list", async () => {
    const lab = person("Lab");
    const list = Array.from({ length: 10 }, () => work({ authors: [lab] }));
    expect(await diversify(await scoredList(list))).toHaveLength(2);
  });

  it("MMR: a slightly lower score that differs beats a near copy", async () => {
    const top = work({ citationCount: 400 });
    const copy = work({ citationCount: 390 });
    const other = work({ citationCount: 380 });
    const scoring = await scoredList([top, copy, other], {
      profile: specterProfile([[1, 0, 0]]),
      vectors: new Map([
        [top.workKey, vec(1, 0, 0)],
        [copy.workKey, vec(1, 0, 0)],
        [other.workKey, vec(0, 1, 0)],
      ]),
    });
    const rows = await diversify(scoring);
    expect(keysOf(rows)).toEqual([top.workKey, other.workKey, copy.workKey]);
  });

  it("MMR weighs them at λ = 0.75, exactly", async () => {
    // Score gap g against a cosine gap of 1: the copy wins only while
    // 0.75 × g > 0.25 × 1, so a gap of 0.34 lets it and 0.33 does not.
    const scoringWith = (gap: number) => {
      const scoreOf = (score: number): RecommendationRow =>
        ({
          recommendation: {
            work: work(),
            score,
          },
        }) as unknown as RecommendationRow;
      const top = scoreOf(0.9);
      const copy = scoreOf(0.8);
      const other = scoreOf(0.8 - gap);
      const key = (row: RecommendationRow): string =>
        row.recommendation.work.workKey;
      return {
        top,
        copy,
        other,
        scoring: {
          rows: [top, copy, other],
          similaritySpace: "specter_v2" as const,
          space: {
            knows: () => true,
            between: (a: string, b: string) => {
              const isCopy = (k: string): boolean => k === key(copy);
              const isOther = (k: string): boolean => k === key(other);
              return isOther(a) || isOther(b)
                ? 0
                : isCopy(a) || isCopy(b)
                  ? 1
                  : 0;
            },
          },
        },
      };
    };
    const wide = scoringWith(0.34);
    expect((await diversify(wide.scoring))[1]).toBe(wide.copy);
    const narrow = scoringWith(0.33);
    expect((await diversify(narrow.scoring))[1]).toBe(narrow.other);
  });

  it("MMR takes the closest of those already picked", async () => {
    const a = work({ citationCount: 400 });
    const b = work({ citationCount: 390 });
    const nearA = work({ citationCount: 380 });
    const nearNone = work({ citationCount: 370 });
    const scoring = await scoredList([a, b, nearA, nearNone], {
      profile: specterProfile([[1, 0, 0, 0]]),
      vectors: new Map([
        [a.workKey, vec(1, 0, 0, 0)],
        [b.workKey, vec(0, 1, 0, 0)],
        [nearA.workKey, vec(1, 0, 0, 0)],
        [nearNone.workKey, vec(0, 0, 1, 0)],
      ]),
    });
    expect(keysOf(await diversify(scoring)).slice(0, 3)).toEqual([
      a.workKey,
      b.workKey,
      nearNone.workKey,
    ]);
  });

  it("a row with no vector pays the full penalty, and only after the first pick", async () => {
    const first = work({ citationCount: 400 });
    const noVector = work({ citationCount: 400 });
    const withVector = work({ citationCount: 1 });
    const scoring = await scoredList([first, noVector, withVector], {
      profile: specterProfile([[1, 0, 0]]),
      vectors: new Map([
        [first.workKey, vec(1, 0, 0)],
        [withVector.workKey, vec(1, 1, 0)],
      ]),
    });
    const rows = await diversify(scoring);
    expect(rows[0]?.recommendation.work.workKey).toBe(first.workKey);
    expect(rows[1]?.recommendation.work.workKey).toBe(withVector.workKey);
  });

  /** Rows with the scores given, on a space that holds a vector for `known` only. */
  const handMade = (
    scores: readonly number[],
    known: readonly number[],
  ): { rows: readonly RecommendationRow[]; scoring: RecommendationScoring } => {
    const rows = scores.map(
      (score) =>
        ({
          recommendation: { work: work(), score },
        }) as unknown as RecommendationRow,
    );
    const keys = new Set(
      known.map((index) => rows[index]?.recommendation.work.workKey),
    );
    return {
      rows,
      scoring: {
        rows,
        similaritySpace: "specter_v2",
        space: {
          knows: (key) => keys.has(key),
          between: (a, b) => (keys.has(a) && keys.has(b) ? 0.5 : undefined),
        },
      },
    };
  };

  it("a top row with no vector is still the first pick", async () => {
    const { rows, scoring } = handMade([0.9, 0.85], [1]);
    expect((await diversify(scoring))[0]).toBe(rows[0]);
  });

  it("a row with a vector is not penalised for a picked row with none", async () => {
    // Row 1 has a vector and nothing to be near: 0.75 × 0.5 − 0 = 0.375. Row 2 has no
    // vector and pays in full: 0.75 × 0.6 − 0.25 = 0.2.
    const { rows, scoring } = handMade([0.9, 0.5, 0.6], [1]);
    expect(await diversify(scoring)).toEqual([rows[0], rows[1], rows[2]]);
  });

  it("on the word space, a row with no text pays the full penalty too", async () => {
    const member = work({ title: "alpha beta", abstract: "alpha beta" });
    const textual = work({ title: "alpha gamma", abstract: "alpha gamma" });
    const textless = work({ title: "", abstract: undefined, citationCount: 9 });
    const lower = work({ title: "alpha gamma", abstract: "alpha gamma" });
    const scoring = await scoredList([textual, textless, lower], {
      works: [member],
    });
    expect(scoring.space.knows(textual.workKey)).toBe(true);
    expect(scoring.space.knows(textless.workKey)).toBe(false);
    expect(scoring.space.knows("never-read")).toBe(false);
    expect(
      scoring.space.between(textual.workKey, textless.workKey),
    ).toBeUndefined();
    expect(
      scoring.space.between(textless.workKey, textual.workKey),
    ).toBeUndefined();
    expect(
      scoring.space.between("never-read", textual.workKey),
    ).toBeUndefined();
    expect(
      scoring.space.between(textual.workKey, "never-read"),
    ).toBeUndefined();
    expect(scoring.space.between(textual.workKey, lower.workKey)).toBeCloseTo(
      1,
      6,
    );
  });

  it("works on an empty scoring", async () => {
    expect(await diversify(await scoredList([]))).toEqual([]);
  });

  it("a negative cosine counts: it lowers the penalty below zero", async () => {
    const top = work({ citationCount: 400 });
    const away = work({ citationCount: 100 });
    const square = work({ citationCount: 120 });
    const scoring = await scoredList([top, away, square], {
      profile: specterProfile([[1, 0, 0]]),
      vectors: new Map([
        [top.workKey, vec(1, 0, 0)],
        [away.workKey, vec(-1, 0, 0)],
        [square.workKey, vec(0, 1, 0)],
      ]),
    });
    expect(keysOf(await diversify(scoring))[1]).toBe(away.workKey);
  });
});

// ---------------------------------------------------------------------------
// The yield
// ---------------------------------------------------------------------------

function cancelledAfter(calls: number): CancellationToken {
  let seen = 0;
  return {
    isCancellationRequested: false,
    reason: undefined,
    throwIfCancelled() {
      seen += 1;
      if (seen > calls) throw new OperationCancelledError({ kind: "user" });
    },
  } as unknown as CancellationToken;
}

describe("yielding to the event loop", () => {
  const manyWorks = (count: number): CanonicalWork[] =>
    Array.from({ length: count }, () => work());

  it("SPECTER2: yields every so many comparisons, not per comparison", async () => {
    const members = manyWorks(SCORE_YIELD_EVERY_COMPARISONS);
    const list = manyWorks(4).map((w) => candidate(w));
    const vectors = new Map<string, EmbeddingVector>(
      [...members, ...list.map(({ work: w }) => w)].map((w) => [
        w.workKey,
        vec(1, 0),
      ]),
    );
    const yieldToEventLoop = vi.fn(() => Promise.resolve());
    await scoreRecommendations(
      list,
      scoreInput({
        profile: specterProfile([[1, 0]]),
        works: members,
        vectors,
        yieldToEventLoop,
      }),
    );
    expect(yieldToEventLoop).toHaveBeenCalledTimes(4);
  });

  it("does not yield on a small run", async () => {
    const yieldToEventLoop = vi.fn(() => Promise.resolve());
    await scoreRecommendations(
      [candidate(work())],
      scoreInput({ works: manyWorks(3), yieldToEventLoop }),
    );
    expect(yieldToEventLoop).not.toHaveBeenCalled();
  });

  it("the word space yields while it builds its vectors too", async () => {
    const yieldToEventLoop = vi.fn(() => Promise.resolve());
    await scoreRecommendations(
      [],
      scoreInput({
        works: manyWorks(SCORE_YIELD_EVERY_COMPARISONS / 10),
        yieldToEventLoop,
      }),
    );
    expect(yieldToEventLoop).toHaveBeenCalledTimes(1);
  });

  it("a word-space read also pays for the vector it builds", async () => {
    const yieldToEventLoop = vi.fn(() => Promise.resolve());
    await scoreRecommendations(
      manyWorks(450).map((w) => candidate(w)),
      scoreInput({ works: manyWorks(10), yieldToEventLoop }),
    );
    // 100 building, then 20 a read: 9 100 in all. At 10 a read it would be 4 600.
    expect(yieldToEventLoop).toHaveBeenCalledTimes(1);
  });

  it("a word-space read counts its members and the vector it builds", async () => {
    const yieldToEventLoop = vi.fn(() => Promise.resolve());
    const members = manyWorks(990);
    const list = manyWorks(4).map((w) => candidate(w));
    await scoreRecommendations(
      list,
      scoreInput({ works: members, yieldToEventLoop }),
    );
    // 9 900 building (one yield at 5 000) then 1 000 a read: 4 900 + 1 000 passes it once.
    expect(yieldToEventLoop).toHaveBeenCalledTimes(2);
  });

  it("is the shared default when none is passed", async () => {
    const list = [candidate(work())];
    const scoring = await scoreRecommendations(list, {
      ...scoreInput(),
      yieldToEventLoop: undefined,
    } as unknown as RecommendScoreInput);
    expect(scoring.rows).toHaveLength(1);
  });

  it("cancel: rejects before starting, and within a yield", async () => {
    await expect(
      scoreRecommendations(
        [candidate(work())],
        scoreInput({ token: cancelledAfter(0) }),
      ),
    ).rejects.toThrow(OperationCancelledError);
    await expect(
      scoreRecommendations(
        [candidate(work())],
        scoreInput({
          token: cancelledAfter(1),
          works: manyWorks(SCORE_YIELD_EVERY_COMPARISONS / 10),
        }),
      ),
    ).rejects.toThrow(OperationCancelledError);
  });

  it("diversify yields, and a cancel stops it", async () => {
    const list = manyWorks(SCORE_YIELD_EVERY_COMPARISONS + 2);
    const scoring = await scoredList(list.slice(0, 2));
    const big = {
      ...scoring,
      rows: list.map(
        (w) =>
          ({
            recommendation: { work: w, score: 0.5 },
          }) as unknown as RecommendationRow,
      ),
      space: { knows: () => true, between: () => 0 },
    };
    const yieldToEventLoop = vi.fn(() => Promise.resolve());
    const rows = await diversify(big, { topK: 2, yieldToEventLoop });
    expect(rows).toHaveLength(2);
    // Two picks, each having compared at least 5 000 rows still open.
    expect(yieldToEventLoop).toHaveBeenCalledTimes(2);
    await expect(
      diversify(big, {
        topK: 2,
        token: cancelledAfter(1),
        yieldToEventLoop,
      }),
    ).rejects.toThrow(OperationCancelledError);
    await expect(
      diversify(scoring, { topK: 2, token: cancelledAfter(0) }),
    ).rejects.toThrow(OperationCancelledError);
  });
});

// ---------------------------------------------------------------------------
// docs/05 §8.3, on a fixture run
// ---------------------------------------------------------------------------

const EPMC_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/europepmc",
);

/** Real recorded Europe PMC answers, through the shipped mapper, by scenario. */
function recorded(scenario: string): readonly SourceRecord[] {
  const map = createEuropePmcRecordMapper({
    clock: { now: () => NOW },
  } as never);
  for (const name of readdirSync(EPMC_DIR)) {
    if (!name.endsWith("_meta.json")) continue;
    const meta = JSON.parse(readFileSync(resolve(EPMC_DIR, name), "utf8")) as {
      scenario?: string;
    };
    if (meta.scenario !== scenario) continue;
    const exchange = JSON.parse(
      readFileSync(
        resolve(EPMC_DIR, name.replace("_meta.json", ".json")),
        "utf8",
      ),
    ) as { body: string };
    const body = JSON.parse(exchange.body) as {
      resultList: { result: readonly never[] };
    };
    return map(body.resultList.result);
  }
  throw new Error(`no fixture for "${scenario}"`);
}

const STRATEGIES: readonly RecommendationStrategy[] = [
  "keyword-search",
  "similar",
  "forward-citations",
  "author-watch",
];

/**
 * One whole run. The collection is the first 15 of `corpus-q2`. The union is every
 * record of eleven answers, the collection's own records and the rest of its answer
 * included, so a run with no filter would fail these checks. Two more candidates go in
 * by hand: a member's paper under a second identifier, and a dismissed paper.
 */
async function fixtureRun(order: "as-read" | "reversed" = "as-read") {
  const collectionRecords = recorded("corpus-q2").slice(0, 15);
  const unionRecords = [
    "corpus-q2",
    "corpus-q3",
    "corpus-q4",
    "corpus-q5",
    "corpus-q1",
    "corpus-ppr-biorxiv",
    "corpus-ppr-medrxiv",
    "corpus-probe-series",
    "corpus-probe-short-title",
    "corpus-preprints-biorxiv",
    "search-post-long-query",
  ].flatMap(recorded);
  const inOrder =
    order === "as-read" ? unionRecords : [...unionRecords].reverse();
  const merged = await dedupeAndMergeAsync(inOrder, NOW, {
    yieldToEventLoop: () => Promise.resolve(),
  });
  const collection = await dedupeAndMergeAsync(collectionRecords, NOW, {
    yieldToEventLoop: () => Promise.resolve(),
  });
  const members = collection.merged.map(({ work: w }) => w);
  const memberKeys = new Set(members.map((w) => w.workKey));
  const candidates: RecommendCandidate[] = merged.merged
    .slice()
    .sort((a, b) => (a.work.workKey < b.work.workKey ? -1 : 1))
    .map((entry, index) => ({
      ...entry,
      discoveredVia: [
        {
          sourceId: "europepmc",
          strategy: STRATEGIES[
            index % STRATEGIES.length
          ] as RecommendationStrategy,
        },
        ...(index % 5 === 0
          ? [
              {
                sourceId: "semanticscholar" as const,
                strategy: "recommendations" as const,
              },
            ]
          : []),
      ],
    }));
  const seeds = members.slice(0, 5);
  const ownership = recommendOwnership({
    items: members.map((w) => ({ work: w })),
    knownWorkKeys: members.map((w) => w.workKey),
    libraryIndex: {
      byDoi: new Map(
        members.flatMap((w, i) => (w.ids.doi ? [[w.ids.doi, i]] : [])) as [
          string,
          number,
        ][],
      ),
      byPmid: new Map(
        members.flatMap((w, i) => (w.ids.pmid ? [[w.ids.pmid, i]] : [])) as [
          string,
          number,
        ][],
      ),
      byArxiv: new Map(),
      byWorkKey: new Map(members.map((w, i) => [w.workKey, i])),
    },
    libraryItems: members.map(libraryItemOf),
  });
  const firstNonMember = candidates.find(
    (c) => !memberKeys.has(c.work.workKey),
  ) as RecommendCandidate;
  const dismissed = owned([firstNonMember.work]);
  const input: RecommendFilterInput = {
    ownership,
    dismissed,
    showDismissed: false,
    window: WINDOW,
    peerReviewedOnly: false,
  };
  const first = identifierFilters(candidates, input);
  const second = contentFilters(first.kept, input);
  const stats = buildProfileStats({
    libraryID: 1,
    collectionKey: "ABCD1234",
    collection: {
      name: "fixture",
      items: members.map((w, index) => ({
        itemKey: `K${String(index)}`,
        dateModified: "2026-01-01 00:00:00",
        work: w,
      })),
    },
    librarySources: [],
    nowEpochMs: NOW,
  });
  const scoring = await scoreRecommendations(second.kept, {
    profile: stats,
    works: members,
    vectors: new Map(),
    ownership,
    dismissed,
    nowEpochMs: NOW,
    yieldToEventLoop: () => Promise.resolve(),
  });
  const rows = await diversify(scoring, {
    yieldToEventLoop: () => Promise.resolve(),
  });
  return {
    candidates,
    members,
    seeds,
    first,
    second,
    scoring,
    rows,
    dismissed: firstNonMember.work,
  };
}

describe("docs/05 §8.3's checks, on a fixture run", () => {
  it("the fixture run would fail them with no filter", async () => {
    const { candidates, members, first, second } = await fixtureRun();
    const memberKeys = new Set(members.map((w) => w.workKey));
    expect(
      candidates.filter((c) => memberKeys.has(c.work.workKey)).length,
    ).toBeGreaterThanOrEqual(15);
    expect(first.dropped["in-collection"]).toBeGreaterThanOrEqual(15);
    expect(first.dropped["outside-window"]).toBeGreaterThan(50);
    expect(first.dropped.dismissed).toBe(1);
    expect(second.dropped["no-abstract"]).toBeGreaterThan(5);
    expect(second.kept.length).toBeGreaterThan(30);
  });

  it("a seed paper never appears in its own recommendations", async () => {
    const { rows, seeds } = await fixtureRun();
    const seedKeys = new Set(seeds.map((w) => w.workKey));
    expect(seedKeys.size).toBe(5);
    expect(
      rows.filter((row) => seedKeys.has(row.recommendation.work.workKey)),
    ).toEqual([]);
  });

  it("≥ 95 % of results fall inside the date window", async () => {
    const { rows } = await fixtureRun();
    const inside = rows.filter(
      ({ recommendation: { work: w } }) =>
        w.publishedDate === undefined ||
        w.publishedDate.year >= WINDOW.fromYear,
    );
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(inside.length / rows.length).toBeGreaterThanOrEqual(0.95);
  });

  it("zero results are in the collection (FR-46: the collection, not the library)", async () => {
    const { rows, members } = await fixtureRun();
    const memberKeys = new Set(members.map((w) => w.workKey));
    const memberPmids = new Set(members.map((w) => w.ids.pmid));
    const memberDois = new Set(members.map((w) => w.ids.doi));
    for (const { recommendation } of rows) {
      const { work: w } = recommendation;
      expect(memberKeys.has(w.workKey)).toBe(false);
      if (w.ids.pmid !== undefined)
        expect(memberPmids.has(w.ids.pmid)).toBe(false);
      if (w.ids.doi !== undefined)
        expect(memberDois.has(w.ids.doi)).toBe(false);
    }
  });

  it("the result set has ≥ 5 distinct first authors", async () => {
    const { rows } = await fixtureRun();
    const firstAuthors = new Set(
      rows.flatMap(({ recommendation: { work: w } }) =>
        w.authors[0] === undefined ? [] : [w.authors[0].family],
      ),
    );
    expect(firstAuthors.size).toBeGreaterThanOrEqual(5);
  });

  it("the caps held on it", async () => {
    const { rows } = await fixtureRun();
    const perVenue = new Map<string, number>();
    for (const { recommendation } of rows) {
      const venue = recommendation.work.containerTitle?.toLowerCase();
      if (venue === undefined) continue;
      perVenue.set(venue, (perVenue.get(venue) ?? 0) + 1);
    }
    expect(Math.max(...perVenue.values())).toBeLessThanOrEqual(MAX_PER_VENUE);
  });

  it("the score distribution is not degenerate, and no term is constant", async () => {
    const { scoring } = await fixtureRun();
    const scores = scoring.rows.map((row) => row.recommendation.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const spread = Math.sqrt(
      scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length,
    );
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(0.05);
    expect(spread).toBeGreaterThan(0.01);
    for (const term of [
      "similarity",
      "recency",
      "novelty",
      "generatorAgreement",
    ] as const) {
      const values = new Set(
        scoring.rows.map((row) => row.recommendation.signals[term]),
      );
      expect(values.size).toBeGreaterThan(1);
    }
  });

  it("every result has an abstract or tldr, and a reason", async () => {
    const { rows } = await fixtureRun();
    for (const { recommendation } of rows) {
      expect((recommendation.work.abstract ?? "").trim()).not.toBe("");
      expect(recommendation.reasons.length).toBeGreaterThan(0);
    }
  });

  it("the dismissed paper is absent, and present with show dismissed", async () => {
    const { rows, dismissed, candidates } = await fixtureRun();
    expect(keysOf(rows)).not.toContain(dismissed.workKey);
    const incoming = candidates.find((c) => c.work === dismissed);
    expect(incoming).toBeDefined();
    const shown = identifierFilters(
      [incoming as RecommendCandidate],
      filterInput({ dismissed: owned([dismissed]), showDismissed: true }),
    );
    expect(shown.kept).toHaveLength(1);
  });

  it("two runs on one collection agree, in any union order", async () => {
    const one = await fixtureRun();
    const again = await fixtureRun();
    expect(keysOf(again.rows)).toEqual(keysOf(one.rows));
    const reversed = await fixtureRun("reversed");
    expect(keysOf(reversed.rows)).toEqual(keysOf(one.rows));
  });

  it("recommended by Semantic Scholar and cites N reach the rows", async () => {
    const { scoring } = await fixtureRun();
    const ids = scoring.rows.flatMap((row) =>
      row.recommendation.reasons.map(({ id }) => id),
    );
    expect(ids).toContain("recommended-by-semantic-scholar");
    expect(ids).toContain("cites-collection");
    expect(ids).not.toContain("novelty");
  });
});
