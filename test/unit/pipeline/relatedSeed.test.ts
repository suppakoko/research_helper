/**
 * `P5-T11`: seed resolution and the title-match threshold (`docs/05` §6.1).
 *
 * Plain Node, no network, no key, no LLM call. **What these tests are evidence of
 * differs by route, and each test's data says which:**
 *
 * - `CROSSREF_RELATED_TITLE`'s search replays a real recording (`title-search`,
 *   `synthetic` false). One query: it shows what the threshold does to those five
 *   records, not how often the threshold is right.
 * - Semantic Scholar's `/paper/search/match` replays a hand-written stand-in
 *   (`"synthetic": true`, `plan/00` §6 item 335(a)). Passing proves this code reads
 *   that assumed shape; it is **not** evidence about the service.
 * - Every other title and record below is hand-written to reach a branch.
 *
 * Seeds go through the shipped `canonicalWorkFromSnapshot`, so each one is what
 * `fromZoteroItem` would hand the pipeline.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  OperationCancelledError,
  RateLimitError,
  ResearchHelperError,
  UpstreamServerError,
} from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  CROSSREF_HOST,
  PMC_IDCONV_HOST,
  SEMANTICSCHOLAR_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import type { SecretStore } from "../../../src/core/secretStore";
import { KO_PENDING_REVIEW, KO_PRESENT } from "../../../src/i18n/keys";
import type { CanonicalWork, WorkType } from "../../../src/model/canonicalWork";
import type { ExternalIds } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  expandSeedIds,
  resolveSeed,
  SeedUnresolvedError,
  titleMatchPasses,
  type SeedResolution,
  type SeedResolverDeps,
} from "../../../src/pipeline/related/seed";
import { createCrossrefRecordMapper } from "../../../src/sources/crossref/mapper";
import { createCrossrefSource } from "../../../src/sources/crossref/crossrefSource";
import { createPmcidConverter } from "../../../src/sources/pubmed/idConverter";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import {
  createSemanticScholarSource,
  SEMANTICSCHOLAR_SECRET_ID,
} from "../../../src/sources/semanticscholar/semanticscholarSource";
import {
  candidateFromLibraryItem,
  LEVSIM_CORROBORATED_THRESHOLD,
  LEVSIM_DUPLICATE_THRESHOLD,
  levSim,
  MAX_YEAR_DELTA,
  MIN_FUZZY_TITLE_TOKENS,
  normalizeTitle,
  toCandidate,
} from "../../../src/sources/shared/dedupe";
import type { SourceCallContext } from "../../../src/sources/types";
import { canonicalWorkFromSnapshot } from "../../../src/zotero/itemMapper";
import { relatedFixtureDirFor } from "../../../scripts/record-fixtures";
import { nodeFixtureIo } from "../../contract/_transport";
import { CROSSREF_RELATED_TITLE } from "../../support/crossrefRecordedRequests";
import { createMultiHostReplayHttpClient } from "../../support/fixtureReplay";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string =>
  readFileSync(resolve(here, "../../..", path), "utf8");

const NOW = 1_700_000_000_000;
const ID = {
  doi: "10.1000/seed" as NonNullable<ExternalIds["doi"]>,
  otherDoi: "10.1000/other" as NonNullable<ExternalIds["doi"]>,
  pmid: "12345" as NonNullable<ExternalIds["pmid"]>,
  pmcid: "PMC777" as NonNullable<ExternalIds["pmcid"]>,
  corpus: "998877" as NonNullable<ExternalIds["s2CorpusId"]>,
};
/** Five or more words, so the 0.95 row can apply. */
const TITLE = "Graph attention networks predict protein folding pathways";

function ctx(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

/** A seed as `fromZoteroItem` reads it, with nothing on it the options do not name. */
function seedItem(
  options: {
    readonly title?: string;
    readonly extra?: string;
    readonly DOI?: string;
    readonly archiveID?: string;
    readonly abstractNote?: string;
    readonly year?: number;
    readonly author?: string;
    readonly tags?: readonly string[];
  } = {},
): CanonicalWork {
  return canonicalWorkFromSnapshot(
    {
      itemType: "journalArticle",
      fields: {
        title: options.title ?? "",
        extra: options.extra ?? "",
        DOI: options.DOI ?? "",
        archiveID: options.archiveID ?? "",
        abstractNote: options.abstractNote ?? "",
      },
      dateMultipart:
        options.year === undefined ? "" : `${String(options.year)}-00-00`,
      creators:
        options.author === undefined
          ? []
          : [{ creatorType: "author", lastName: options.author }],
      tags: options.tags ?? [],
    },
    { nowEpochMs: NOW },
  );
}

/** A hand-written record, with a DOI unless told otherwise. */
function record(
  options: {
    readonly sourceId?: SourceRecord["sourceId"];
    readonly title?: string;
    readonly ids?: ExternalIds;
    readonly type?: WorkType;
    readonly year?: number | null;
    readonly author?: string;
  } = {},
): SourceRecord {
  const ids = options.ids ?? { doi: ID.doi };
  const sourceId = options.sourceId ?? "crossref";
  const nativeId = ids.doi ?? ids.pmid ?? ids.s2CorpusId ?? "no-id";
  const year = options.year === undefined ? 2023 : options.year;
  return {
    id: `${sourceId}:${nativeId}`,
    sourceId,
    nativeId,
    work: {
      ids,
      type: options.type ?? "journal-article",
      title: options.title ?? TITLE,
      authors: options.author === undefined ? [] : [{ family: options.author }],
      ...(year !== null && {
        publishedDate: { year, iso: String(year) },
      }),
    },
    retrievedAtEpochMs: NOW,
    missingFields: [],
  };
}

/** Fake services; anything not given answers as an empty, keyless world. */
function fakeDeps(
  options: {
    readonly keyed?: boolean;
    readonly s2Match?: () => Promise<readonly SourceRecord[]>;
    readonly crossrefMatch?: () => Promise<readonly SourceRecord[]>;
    readonly lookup?: () => Promise<readonly SourceRecord[]>;
    readonly convert?: SeedResolverDeps["convertPmcids"];
  } = {},
) {
  const hasApiKey = vi.fn(() => Promise.resolve(options.keyed ?? false));
  const s2MatchTitle = vi.fn(
    (_title: string, _ctx: SourceCallContext) =>
      options.s2Match?.() ?? Promise.resolve([] as readonly SourceRecord[]),
  );
  const crossrefMatchTitle = vi.fn(
    (_title: string, _ctx: SourceCallContext) =>
      options.crossrefMatch?.() ??
      Promise.resolve([] as readonly SourceRecord[]),
  );
  const lookup = vi.fn(
    (_ids: readonly Partial<ExternalIds>[], _ctx: SourceCallContext) =>
      options.lookup?.() ?? Promise.resolve([] as readonly SourceRecord[]),
  );
  const convertPmcids = vi.fn<SeedResolverDeps["convertPmcids"]>(
    options.convert ?? (() => Promise.resolve(new Map())),
  );
  const deps: SeedResolverDeps = {
    semanticscholar: {
      hasUsableApiKey: hasApiKey,
      // The adapter's own gate, so a keyless fake sends nothing either.
      lookupKeyed: async (ids, call) =>
        (await hasApiKey()) ? lookup(ids, call) : [],
      matchTitle: s2MatchTitle,
    },
    crossref: { matchTitle: crossrefMatchTitle },
    convertPmcids,
    clock: createManualClock(NOW),
  };
  return {
    deps,
    hasApiKey,
    s2MatchTitle,
    crossrefMatchTitle,
    lookup,
    convertPmcids,
  };
}

function expectResolved(
  resolution: SeedResolution,
): Extract<SeedResolution, { kind: "resolved" }> {
  if (resolution.kind !== "resolved") {
    throw new Error(`expected resolved, got ${resolution.kind}`);
  }
  return resolution;
}

function expectChoose(
  resolution: SeedResolution,
): Extract<SeedResolution, { kind: "choose" }> {
  if (resolution.kind !== "choose") {
    throw new Error(`expected choose, got ${resolution.kind}`);
  }
  return resolution;
}

/** What a promise rejected with, or a failure if it did not. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

/**
 * The shipped adapters over one transport, refusing any host with no route
 * (`createMultiHostReplayTransport`). Semantic Scholar is routed only when
 * `keyed`, so a keyless request to it fails the run and is on `calls`.
 */
function realAdapters(
  options: {
    readonly keyed?: boolean;
    readonly store?: SecretStore;
    readonly answerFor?: Parameters<
      typeof createMultiHostReplayHttpClient
    >[0]["answerFor"];
  } = {},
) {
  const keyed = options.keyed ?? false;
  const { client, transport } = createMultiHostReplayHttpClient({
    io: nodeFixtureIo,
    routes: [
      { host: CROSSREF_HOST, dirs: [relatedFixtureDirFor("crossref")] },
      ...(keyed
        ? [
            {
              host: SEMANTICSCHOLAR_HOST,
              dirs: [relatedFixtureDirFor("semanticscholar")],
            },
          ]
        : []),
      { host: PMC_IDCONV_HOST, dirs: [] },
    ],
    ...(options.answerFor !== undefined && { answerFor: options.answerFor }),
  });
  const clock = createManualClock(NOW);
  const secrets = options.store ?? (keyed ? storeHolding("fake-s2-key") : null);
  const deps: SeedResolverDeps = {
    semanticscholar: createSemanticScholarSource({
      http: client,
      clock,
      mapRecords: createSemanticScholarRecordMapper({ clock }),
      ...(secrets !== null && { secrets }),
    }),
    crossref: createCrossrefSource({
      http: client,
      clock,
      mapRecords: createCrossrefRecordMapper({
        clock,
        parseXml: () => ({ documentElement: null }),
      }),
    }),
    convertPmcids: createPmcidConverter({ http: client }),
    clock,
  };
  return { deps, calls: transport.calls };
}

function storeHolding(value: string | undefined): SecretStore {
  return {
    backend: "os-keychain",
    unattended: true,
    get: (id) =>
      Promise.resolve(id === SEMANTICSCHOLAR_SECRET_ID ? value : undefined),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    has: () => Promise.resolve(value !== undefined),
    listStoredIds: () => Promise.resolve([]),
    clearAll: () => Promise.resolve(0),
  };
}

/** Exact shape of `docs/02` §3.7's verified example; the values are hand-written. */
function idconvAnswer(pmcid: string) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "ok",
      records: [
        {
          doi: "10.1000/FROM-CONVERTER",
          pmcid,
          pmid: 424242,
          "requested-id": pmcid,
        },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// The threshold, row by row. Titles of 100 characters, so k edits is 1 - k/100.
// ---------------------------------------------------------------------------

const LONG = `${"abcdefghi ".repeat(9)}abcdefghij`;

/** {@link LONG} with its first `edits` letters replaced, keeping the spaces. */
function edited(edits: number): string {
  let left = edits;
  return [...LONG]
    .map((char) => {
      if (char === " " || left === 0) return char;
      left -= 1;
      return "z";
    })
    .join("");
}

function seedFor(
  title: string,
  options: { readonly year?: number; readonly author?: string } = {},
) {
  return candidateFromLibraryItem({
    itemID: 0,
    deleted: false,
    title,
    year: options.year,
    firstAuthorFamily: options.author,
  });
}

function candidateFor(
  title: string,
  options: { readonly year?: number | null; readonly author?: string } = {},
) {
  return toCandidate(
    record({
      title,
      year: options.year === undefined ? null : options.year,
      ...(options.author !== undefined && { author: options.author }),
    }),
  );
}

describe("titleMatchPasses, docs/05 §6.1", () => {
  it("is built on titles whose similarity the test can state", () => {
    expect(LONG).toHaveLength(100);
    expect(levSim(LONG, edited(5))).toBeCloseTo(0.95, 10);
    expect(levSim(LONG, edited(12))).toBeCloseTo(0.88, 10);
  });

  it("reads the dedupe cascade's constants, whose values docs/05 §6.1 states", () => {
    expect(LEVSIM_DUPLICATE_THRESHOLD).toBe(0.95);
    expect(LEVSIM_CORROBORATED_THRESHOLD).toBe(0.88);
    expect(MAX_YEAR_DELTA).toBe(1);
    const section = read("docs/05-related-work-discovery.md");
    expect(section).toContain("`LEVSIM_DUPLICATE_THRESHOLD` (0.95)");
    expect(section).toContain("`LEVSIM_CORROBORATED_THRESHOLD` (0.88)");
    expect(section).toContain("`MAX_YEAR_DELTA` (1)");
  });

  it("states in docs/05 §6.1 that the values are unmeasured, and what measures them", () => {
    const section = read("docs/05-related-work-discovery.md");
    expect(section).toContain("**Starting values, not measured.**");
    expect(section).toContain("**What will measure it:** `plan/08` `P5-T30`");
    expect(read("plan/08-phase-5-related-papers.md")).toContain(
      "names this as what measures the title-match threshold",
    );
  });

  it("the 0.95 row: passes with nothing to corroborate, at the boundary and not below it", () => {
    const seed = seedFor(LONG);
    expect(titleMatchPasses(seed, candidateFor(LONG))).toBe(true);
    expect(titleMatchPasses(seed, candidateFor(edited(5)))).toBe(true);
    expect(titleMatchPasses(seed, candidateFor(edited(6)))).toBe(false);
  });

  it("the 0.95 row asks for no year: a far year does not stop an exact title", () => {
    const seed = seedFor(LONG, { year: 2001 });
    expect(titleMatchPasses(seed, candidateFor(LONG, { year: 2020 }))).toBe(
      true,
    );
  });

  it("the 0.88 row: needs year and first author, at the boundary and not below it", () => {
    const seed = seedFor(LONG, { year: 2020, author: "Müller" });
    const near = (edits: number, year: number, author: string): boolean =>
      titleMatchPasses(seed, candidateFor(edited(edits), { year, author }));
    expect(near(12, 2020, "Muller")).toBe(true);
    expect(near(13, 2020, "Muller")).toBe(false);
    expect(near(6, 2020, "Muller")).toBe(true);
    expect(near(12, 2021, "Muller")).toBe(true);
    expect(near(12, 2019, "Muller")).toBe(true);
    expect(near(12, 2022, "Muller")).toBe(false);
    expect(near(12, 2018, "Muller")).toBe(false);
    expect(near(12, 2020, "Schmidt")).toBe(false);
  });

  it("the 0.88 row: an unknown year or author never corroborates", () => {
    const candidate = candidateFor(edited(8), { year: 2020, author: "Muller" });
    expect(
      titleMatchPasses(seedFor(LONG, { author: "Muller" }), candidate),
    ).toBe(false);
    expect(titleMatchPasses(seedFor(LONG, { year: 2020 }), candidate)).toBe(
      false,
    );
    const neither = candidateFor(edited(8), { year: 2020 });
    expect(titleMatchPasses(seedFor(LONG, { year: 2020 }), neither)).toBe(
      false,
    );
    expect(
      titleMatchPasses(
        seedFor(LONG, { author: "Muller" }),
        candidateFor(edited(8), { author: "Muller" }),
      ),
    ).toBe(false);
  });

  it("guard: a differing series marker never passes, even corroborated", () => {
    const stem = "A long study of widget counts across many regions and years";
    const options = { year: 2020, author: "Muller" };
    expect(levSim(`${stem} part ii`, `${stem} part iii`)).toBeGreaterThan(0.95);
    expect(
      titleMatchPasses(
        seedFor(`${stem} part ii`, options),
        candidateFor(`${stem} part iii`, options),
      ),
    ).toBe(false);
  });

  it("guard: a number differing anywhere never passes, even corroborated", () => {
    const options = { year: 2020, author: "Muller" };
    const a =
      "A long synthetic study number 1 of widget counts in many regions";
    const b =
      "A long synthetic study number 2 of widget counts in many regions";
    expect(levSim(a, b)).toBeGreaterThan(0.95);
    expect(
      titleMatchPasses(seedFor(a, options), candidateFor(b, options)),
    ).toBe(false);
  });

  it("guard: a short title passes only when corroborated", () => {
    expect(MIN_FUZZY_TITLE_TOKENS).toBe(5);
    expect(
      titleMatchPasses(seedFor("Editorial"), candidateFor("Editorial")),
    ).toBe(false);
    const options = { year: 2015, author: "LeCun" };
    expect(
      titleMatchPasses(
        seedFor("Deep learning", options),
        candidateFor("Deep learning", options),
      ),
    ).toBe(true);
  });

  it("guard: a short title on either side stops the 0.95 row", () => {
    const words = "abcdefghijklmnopqrstuvwxyz ".repeat(4).trim();
    const five = `${words} ab`;
    expect(levSim(words, five)).toBeGreaterThan(0.95);
    expect(titleMatchPasses(seedFor(five), candidateFor(five))).toBe(true);
    expect(titleMatchPasses(seedFor(words), candidateFor(five))).toBe(false);
    expect(titleMatchPasses(seedFor(five), candidateFor(words))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Done when: DOI seed, PMID-only seed
// ---------------------------------------------------------------------------

describe("a seed with an identifier", () => {
  it("resolves a DOI seed with no request, no key probe and no title search", async () => {
    const seed = seedItem({ DOI: "10.1000/SEED", title: TITLE });
    const fake = fakeDeps({ keyed: true });
    const resolution = expectResolved(
      await resolveSeed(seed, fake.deps, ctx()),
    );
    expect(resolution.seed).toEqual({ work: seed, matchedByTitle: false });
    expect(resolution.seed.work.ids.doi).toBe("10.1000/seed");
    expect(resolution.failures).toEqual([]);
    expect(fake.hasApiKey).not.toHaveBeenCalled();
    expect(fake.crossrefMatchTitle).not.toHaveBeenCalled();
    expect(fake.s2MatchTitle).not.toHaveBeenCalled();
    expect(fake.lookup).not.toHaveBeenCalled();
  });

  it("resolves a PMID-only seed read from Extra", async () => {
    const seed = seedItem({ extra: "PMID: 12345" });
    const fake = fakeDeps();
    const resolution = expectResolved(
      await resolveSeed(seed, fake.deps, ctx()),
    );
    expect(resolution.seed.work.ids.pmid).toBe("12345");
    expect(resolution.seed.matchedByTitle).toBe(false);
    expect(fake.crossrefMatchTitle).not.toHaveBeenCalled();
  });

  it("resolves a PMCID-only seed and an arXiv-only seed", async () => {
    for (const seed of [
      seedItem({ extra: "PMCID: PMC777" }),
      seedItem({ archiveID: "arXiv:2101.00001" }),
    ]) {
      const fake = fakeDeps();
      expectResolved(await resolveSeed(seed, fake.deps, ctx()));
      expect(fake.crossrefMatchTitle).not.toHaveBeenCalled();
    }
  });

  it("counts a Semantic Scholar corpus id only with a key", async () => {
    const seed = seedItem({ extra: "rh-s2-corpus-id: 998877", title: TITLE });
    expect(seed.ids.s2CorpusId).toBe("998877");

    const keyed = fakeDeps({ keyed: true });
    const resolved = expectResolved(await resolveSeed(seed, keyed.deps, ctx()));
    expect(resolved.seed.work).toBe(seed);
    expect(resolved.failures).toEqual([]);
    expect(keyed.crossrefMatchTitle).not.toHaveBeenCalled();

    const keyless = fakeDeps({
      crossrefMatch: () => Promise.resolve([record()]),
    });
    const matched = expectResolved(
      await resolveSeed(seed, keyless.deps, ctx()),
    );
    expect(matched.seed.matchedByTitle).toBe(true);
    expect(keyless.crossrefMatchTitle).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Done when: title-only one match, on the real Crossref recording
// ---------------------------------------------------------------------------

describe("a title-only seed, on the recorded Crossref search (one real query)", () => {
  it("resolves to the one paper, flagged, rejecting the other four records", async () => {
    const { deps, calls } = realAdapters();
    const seed = seedItem({ title: CROSSREF_RELATED_TITLE });
    const resolution = expectResolved(await resolveSeed(seed, deps, ctx()));
    expect(resolution.seed.matchedByTitle).toBe(true);
    expect(resolution.seed.work.ids.doi).toBe("10.1038/s41586-023-06139-9");
    expect(resolution.failures).toEqual([]);
    expect(calls.map((call) => call.host)).toEqual([CROSSREF_HOST]);
  });

  it("records docs/05 §6.1's similarities: 1.000, then nothing in the 0.88–0.95 band", async () => {
    const { deps } = realAdapters();
    const records = await deps.crossref.matchTitle(
      CROSSREF_RELATED_TITLE,
      ctx(),
    );
    const seed = normalizeTitle(CROSSREF_RELATED_TITLE);
    const similarities = records.map((r) =>
      Number(levSim(seed, normalizeTitle(r.work.title)).toFixed(3)),
    );
    expect(similarities).toEqual([1, 0.677, 0.352, 0.266, 0.75]);
    expect(
      similarities.filter((s) => s >= LEVSIM_CORROBORATED_THRESHOLD && s < 1),
    ).toEqual([]);
  });

  it("rejects a recorded component even when its title is the seed's: text cannot", async () => {
    const { deps } = realAdapters();
    const records = await deps.crossref.matchTitle(
      CROSSREF_RELATED_TITLE,
      ctx(),
    );
    const component = records.find(
      (r) => r.work.ids.doi === "10.1021/jacs.5c03749.s001",
    );
    if (component === undefined) throw new Error("recording changed");
    expect(component.work.type).toBe("other");
    expect(component.work.publishedDate).toBeUndefined();

    const seed = seedItem({ title: component.work.title });
    expect(
      titleMatchPasses(seedFor(component.work.title), toCandidate(component)),
    ).toBe(true);
    const fake = fakeDeps({ crossrefMatch: () => Promise.resolve(records) });
    const error = await rejection(resolveSeed(seed, fake.deps, ctx()));
    expect(error).toBeInstanceOf(SeedUnresolvedError);
    expect((error as SeedUnresolvedError).reason).toBe("no-match");
  });
});

// ---------------------------------------------------------------------------
// Done when: two matches → choose. Hand-written records.
// ---------------------------------------------------------------------------

describe("several candidates", () => {
  const seed = seedItem({ title: TITLE, year: 2023, author: "Muller" });
  const near = "Graph attention networks predict protein folding pathway";

  it("two distinct works passing is 'choose': nothing is picked, closest first", async () => {
    const closer = record({ title: TITLE, ids: { doi: ID.otherDoi } });
    const farther = record({ title: near, ids: { doi: ID.doi } });
    const fake = fakeDeps({
      crossrefMatch: () => Promise.resolve([farther, closer]),
    });
    const resolution = expectChoose(await resolveSeed(seed, fake.deps, ctx()));
    expect(resolution.candidates.map((work) => work.ids.doi)).toEqual([
      ID.otherDoi,
      ID.doi,
    ]);
    expect(resolution.failures).toEqual([]);
  });

  it("keeps the services' order between equally close works", async () => {
    const fake = fakeDeps({
      crossrefMatch: () =>
        Promise.resolve([
          record({ ids: { doi: ID.doi } }),
          record({ ids: { doi: ID.otherDoi } }),
        ]),
    });
    const resolution = expectChoose(await resolveSeed(seed, fake.deps, ctx()));
    expect(resolution.candidates.map((work) => work.ids.doi)).toEqual([
      ID.doi,
      ID.otherDoi,
    ]);
  });

  it("the same paper from both services counts once and merges their identifiers", async () => {
    const fake = fakeDeps({
      keyed: true,
      s2Match: () =>
        Promise.resolve([
          record({
            sourceId: "semanticscholar",
            ids: { doi: ID.doi, pmid: ID.pmid, s2CorpusId: ID.corpus },
          }),
        ]),
      crossrefMatch: () => Promise.resolve([record({ ids: { doi: ID.doi } })]),
    });
    const resolution = expectResolved(
      await resolveSeed(seed, fake.deps, ctx()),
    );
    expect(resolution.seed.matchedByTitle).toBe(true);
    expect(resolution.seed.work.ids).toMatchObject({
      doi: ID.doi,
      pmid: ID.pmid,
      s2CorpusId: ID.corpus,
    });
    expect(resolution.seed.work.normalizedAtEpochMs).toBe(NOW);
    expect(resolution.seed.work.provenance.seenIn).toEqual(
      expect.arrayContaining(["crossref", "semanticscholar"]),
    );
  });

  it("a preprint and its journal version with one title are two works to choose from", async () => {
    const fake = fakeDeps({
      crossrefMatch: () =>
        Promise.resolve([
          record({ ids: { doi: ID.doi } }),
          record({ ids: { doi: ID.otherDoi }, type: "preprint" }),
        ]),
    });
    expect(
      expectChoose(await resolveSeed(seed, fake.deps, ctx())).candidates,
    ).toHaveLength(2);
  });

  it("drops the failing candidates before counting: one left of three resolves", async () => {
    const fake = fakeDeps({
      crossrefMatch: () =>
        Promise.resolve([
          record({ ids: { doi: ID.doi } }),
          record({
            ids: { doi: ID.otherDoi },
            title: "Something else altogether here",
          }),
          record({
            ids: { doi: "10.1000/component" as never },
            type: "other",
            year: null,
          }),
        ]),
    });
    expect(
      expectResolved(await resolveSeed(seed, fake.deps, ctx())).seed.work.ids
        .doi,
    ).toBe(ID.doi);
  });
});

describe("what could be a seed", () => {
  const seed = seedItem({ title: TITLE });
  const crossrefOf = (candidate: SourceRecord) =>
    fakeDeps({ crossrefMatch: () => Promise.resolve([candidate]) }).deps;

  it("rejects 'other' with no year, and keeps 'other' with a year", async () => {
    const error = await rejection(
      resolveSeed(
        seed,
        crossrefOf(record({ type: "other", year: null })),
        ctx(),
      ),
    );
    expect((error as SeedUnresolvedError).reason).toBe("no-match");
    const kept = expectResolved(
      await resolveSeed(
        seed,
        crossrefOf(record({ type: "other", year: 2023 })),
        ctx(),
      ),
    );
    expect(kept.seed.matchedByTitle).toBe(true);
  });

  it("keeps a typed record with no year", async () => {
    expectResolved(
      await resolveSeed(seed, crossrefOf(record({ year: null })), ctx()),
    );
  });

  it("keeps a record known by an onlineDate alone", async () => {
    const base = record({ type: "other", year: null });
    const online: SourceRecord = {
      ...base,
      work: { ...base.work, onlineDate: { year: 2023, iso: "2023" } },
    };
    expectResolved(await resolveSeed(seed, crossrefOf(online), ctx()));
  });

  it("rejects a candidate with no identifier", async () => {
    const error = await rejection(
      resolveSeed(seed, crossrefOf(record({ ids: {} })), ctx()),
    );
    expect((error as SeedUnresolvedError).reason).toBe("no-match");
  });

  it.each([
    ["doi", { doi: ID.doi }],
    ["pmid", { pmid: ID.pmid }],
    ["pmcid", { pmcid: ID.pmcid }],
    ["arxivId", { arxivId: "2101.00001" as never }],
    ["s2CorpusId", { s2CorpusId: ID.corpus }],
  ] as const)("accepts a candidate holding only %s", async (_name, ids) => {
    expectResolved(await resolveSeed(seed, crossrefOf(record({ ids })), ctx()));
  });

  it("uses the seed's year and first author to corroborate", async () => {
    const near = "Graph attention networks predict protein folded pathway";
    expect(levSim(normalizeTitle(TITLE), normalizeTitle(near))).toBeLessThan(
      0.95,
    );
    expect(levSim(normalizeTitle(TITLE), normalizeTitle(near))).toBeGreaterThan(
      0.88,
    );
    const candidate = record({ title: near, author: "Muller", year: 2023 });
    expectResolved(
      await resolveSeed(
        seedItem({ title: TITLE, year: 2023, author: "Muller" }),
        crossrefOf(candidate),
        ctx(),
      ),
    );
    const noYear = await rejection(
      resolveSeed(
        seedItem({ title: TITLE, author: "Muller" }),
        crossrefOf(candidate),
        ctx(),
      ),
    );
    expect(noYear).toBeInstanceOf(SeedUnresolvedError);
    // `toCandidate`'s rule on the seed's side too: an online date is a year.
    expectResolved(
      await resolveSeed(
        {
          ...seedItem({ title: TITLE, author: "Muller" }),
          onlineDate: { year: 2023, iso: "2023" },
        },
        crossrefOf(candidate),
        ctx(),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Done when: nothing → the named error
// ---------------------------------------------------------------------------

describe("nothing to go on", () => {
  it("no identifier and no title: the no-identifier error, with nothing sent", async () => {
    const fake = fakeDeps({ keyed: true });
    const error = await rejection(resolveSeed(seedItem(), fake.deps, ctx()));
    expect(error).toBeInstanceOf(SeedUnresolvedError);
    expect((error as SeedUnresolvedError).reason).toBe("no-identifier");
    expect((error as SeedUnresolvedError).messageKey).toBe(
      "rh-error-seed-no-identifier",
    );
    expect(fake.crossrefMatchTitle).not.toHaveBeenCalled();
    expect(fake.s2MatchTitle).not.toHaveBeenCalled();
  });

  it.each([
    ["blank", "   "],
    ["punctuation alone", "?? -- !!"],
    ["a DOI", "10.1000/not-a-title"],
    ["a DOI URL", "https://doi.org/10.1000/not-a-title"],
  ])("a title that is %s is no title", async (_name, title) => {
    // The real Crossref adapter, because it throws RangeError on these two DOIs.
    const { deps, calls } = realAdapters();
    const error = await rejection(
      resolveSeed(seedItem({ title }), deps, ctx()),
    );
    expect((error as SeedUnresolvedError).reason).toBe("no-identifier");
    expect(calls).toEqual([]);
  });

  it("a title nothing matches: the no-match error", async () => {
    const fake = fakeDeps({
      crossrefMatch: () =>
        Promise.resolve([
          record({ title: "Wholly unrelated words about something" }),
        ]),
    });
    const error = await rejection(
      resolveSeed(seedItem({ title: TITLE }), fake.deps, ctx()),
    );
    expect(error).toBeInstanceOf(SeedUnresolvedError);
    expect((error as SeedUnresolvedError).reason).toBe("no-match");
    expect((error as SeedUnresolvedError).messageKey).toBe(
      "rh-error-seed-no-match",
    );
  });

  it("the error says neither the title nor anything else about the item", () => {
    const error = new SeedUnresolvedError("no-match");
    expect(error.code).toBe("SEED_UNRESOLVED");
    expect(error.retryable).toBe(false);
    expect(error.userFacing).toBe(true);
    expect(error.context).toEqual({ reason: "no-match" });
    expect(error.toSerialized()).toMatchObject({
      code: "SEED_UNRESOLVED",
      messageKey: "rh-error-seed-no-match",
      detail: "Seed could not be resolved: no-match",
    });
  });

  it.each(["rh-error-seed-no-identifier", "rh-error-seed-no-match"] as const)(
    "%s names DOI, PMID, arXiv ID and title in en-US, and has the owner's Korean in ko-KR (G-41, plan/00 §6 item 357)",
    (id) => {
      const line = read("addon/locale/en-US/research-helper-mainWindow.ftl")
        .split("\n")
        .find((l) => l.startsWith(`${id} = `));
      for (const name of ["DOI", "PMID", "arXiv ID", "title"]) {
        expect(line).toContain(name);
      }
      const korean = read("addon/locale/ko-KR/research-helper-mainWindow.ftl");
      expect(korean).not.toContain(`# NEEDS REVIEW ${id} = `);
      expect(korean).toContain(`\n${id} = `);
      expect(KO_PENDING_REVIEW).not.toContain(id);
      expect(KO_PRESENT).toContain(id);
    },
  );
});

// ---------------------------------------------------------------------------
// Done when: keyless runs make no Semantic Scholar call, over a real transport
// ---------------------------------------------------------------------------

describe("a keyless run, over a transport that refuses api.semanticscholar.org", () => {
  /** Both stages, as `createRelatedPipeline` will call them. */
  async function run(seed: CanonicalWork, deps: SeedResolverDeps) {
    const resolution = expectResolved(await resolveSeed(seed, deps, ctx()));
    return expandSeedIds(resolution.seed.work, deps, ctx());
  }

  const stores: readonly [string, SecretStore | undefined][] = [
    ["no key store", undefined],
    ["a key store holding no key", storeHolding(undefined)],
    // `plan/00` §6 item 339(b): `has` says yes, and the value cannot be used.
    ["a key store saying yes over a blank value", storeHolding("   ")],
    [
      "a key store saying yes over an unreadable value",
      {
        ...storeHolding("fake-s2-key"),
        get: () => Promise.reject(new Error("keystore down")),
      },
    ],
  ];

  describe.each(stores)("with %s", (_name, store) => {
    const adapters = () =>
      realAdapters({
        ...(store !== undefined && { store }),
        answerFor: (host, request) =>
          host === PMC_IDCONV_HOST && request.url.includes("PMC777")
            ? idconvAnswer("PMC777")
            : undefined,
      });
    const s2Calls = (calls: ReturnType<typeof adapters>["calls"]) =>
      calls.filter((call) => call.host === SEMANTICSCHOLAR_HOST);

    it("a DOI seed sends nothing at all", async () => {
      const { deps, calls } = adapters();
      await run(seedItem({ DOI: "10.1000/seed" }), deps);
      expect(calls).toEqual([]);
    });

    it("a PMID-only seed sends nothing at all", async () => {
      const { deps, calls } = adapters();
      await run(seedItem({ extra: "PMID: 12345" }), deps);
      expect(calls).toEqual([]);
    });

    it("a PMCID-only seed asks the converter and not Semantic Scholar", async () => {
      const { deps, calls } = adapters();
      const { work, failures } = await run(
        seedItem({ extra: "PMCID: PMC777" }),
        deps,
      );
      expect(work.ids).toMatchObject({
        doi: "10.1000/from-converter",
        pmid: "424242",
        pmcid: "PMC777",
      });
      expect(failures).toEqual([]);
      expect(calls.map((call) => call.host)).toEqual([PMC_IDCONV_HOST]);
      expect(s2Calls(calls)).toEqual([]);
    });

    it("a title-only seed asks Crossref and not Semantic Scholar", async () => {
      const { deps, calls } = adapters();
      const { work } = await run(
        seedItem({ title: CROSSREF_RELATED_TITLE }),
        deps,
      );
      expect(work.ids.doi).toBe("10.1038/s41586-023-06139-9");
      expect(calls.map((call) => call.host)).toEqual([CROSSREF_HOST]);
    });

    it("a seed with only a corpus id and no title has no identifier here", async () => {
      const { deps, calls } = adapters();
      const seed = {
        ...seedItem({ title: "" }),
        ids: { s2CorpusId: "215416146" },
      } as CanonicalWork;
      expect(await rejection(resolveSeed(seed, deps, ctx()))).toBeInstanceOf(
        SeedUnresolvedError,
      );
      expect(calls).toEqual([]);
    });
  });

  it("does not call the adapter's matchTitle or lookup at all", async () => {
    const fake = fakeDeps({ crossrefMatch: () => Promise.resolve([record()]) });
    const seed = seedItem({ title: TITLE });
    const resolution = expectResolved(
      await resolveSeed(seed, fake.deps, ctx()),
    );
    await expandSeedIds(resolution.seed.work, fake.deps, ctx());
    expect(fake.s2MatchTitle).not.toHaveBeenCalled();
    expect(fake.lookup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// With a key. Semantic Scholar's bodies below are stand-ins or hand-written:
// these tests prove this code's handling, and say nothing about the service.
// ---------------------------------------------------------------------------

describe("a keyed run", () => {
  it("title-only, S2 stand-in plus recorded Crossref: one work, one request each", async () => {
    const { deps, calls } = realAdapters({ keyed: true });
    const resolution = expectResolved(
      await resolveSeed(
        seedItem({ title: CROSSREF_RELATED_TITLE }),
        deps,
        ctx(),
      ),
    );
    expect(resolution.seed.matchedByTitle).toBe(true);
    expect(resolution.seed.work.ids.doi).toBe("10.1038/s41586-023-06139-9");
    expect(calls.map((call) => call.host).sort()).toEqual([
      CROSSREF_HOST,
      SEMANTICSCHOLAR_HOST,
    ]);
  });

  it("asks both services the seed's own title, and passes the context through", async () => {
    const fake = fakeDeps({ keyed: true });
    const context = ctx();
    await rejection(
      resolveSeed(seedItem({ title: TITLE }), fake.deps, context),
    );
    expect(fake.s2MatchTitle).toHaveBeenCalledWith(TITLE, context);
    expect(fake.crossrefMatchTitle).toHaveBeenCalledWith(TITLE, context);
  });

  it("an S2 match alone resolves", async () => {
    const fake = fakeDeps({
      keyed: true,
      s2Match: () => Promise.resolve([record({ sourceId: "semanticscholar" })]),
    });
    expectResolved(
      await resolveSeed(seedItem({ title: TITLE }), fake.deps, ctx()),
    );
  });
});

// ---------------------------------------------------------------------------
// Privacy: docs/09 §3 row 2
// ---------------------------------------------------------------------------

describe("what leaves the machine", () => {
  const SECRET_ABSTRACT = "privateabstractword";
  const SECRET_TAG = "privatetagword";

  it("a title-only seed sends the title alone, on a keyed run", async () => {
    const { deps, calls } = realAdapters({ keyed: true });
    await resolveSeed(
      seedItem({
        title: CROSSREF_RELATED_TITLE,
        abstractNote: SECRET_ABSTRACT,
        tags: [SECRET_TAG],
      }),
      deps,
      ctx(),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const sent = `${call.url} ${String(call.options.body ?? "")}`;
      expect(sent).not.toContain(SECRET_ABSTRACT);
      expect(sent).not.toContain(SECRET_TAG);
    }
  });

  it("expansion sends identifiers alone", async () => {
    const fake = fakeDeps({ keyed: true });
    await expandSeedIds(
      seedItem({
        DOI: "10.1000/seed",
        title: TITLE,
        abstractNote: SECRET_ABSTRACT,
        tags: [SECRET_TAG],
      }),
      fake.deps,
      ctx(),
    );
    const asked = JSON.stringify(fake.lookup.mock.calls[0]?.[0]);
    expect(asked).not.toContain(SECRET_ABSTRACT);
    expect(asked).not.toContain(SECRET_TAG);
    expect(asked).not.toContain("Graph");
  });
});

// ---------------------------------------------------------------------------
// A service failing during the title step
// ---------------------------------------------------------------------------

describe("a service failing during the title step", () => {
  const seed = seedItem({ title: TITLE });
  const rateLimited = () =>
    Promise.reject(new RateLimitError(429, 1000, SEMANTICSCHOLAR_HOST));
  const down = () =>
    Promise.reject(new UpstreamServerError(503, "crossref down"));

  it("S2 failing while Crossref found it: resolved, with the failure reported", async () => {
    const fake = fakeDeps({
      keyed: true,
      s2Match: rateLimited,
      crossrefMatch: () => Promise.resolve([record()]),
    });
    const resolution = expectResolved(
      await resolveSeed(seed, fake.deps, ctx()),
    );
    expect(resolution.failures).toHaveLength(1);
    expect(resolution.failures[0]).toMatchObject({
      source: "semanticscholar",
      step: "title",
      error: { code: "RATE_LIMIT" },
    });
  });

  it("Crossref failing while S2 found it: resolved, with the failure reported", async () => {
    const fake = fakeDeps({
      keyed: true,
      s2Match: () => Promise.resolve([record({ sourceId: "semanticscholar" })]),
      crossrefMatch: down,
    });
    const resolution = expectResolved(
      await resolveSeed(seed, fake.deps, ctx()),
    );
    expect(resolution.failures[0]).toMatchObject({
      source: "crossref",
      step: "title",
      error: { code: "UPSTREAM_SERVER" },
    });
  });

  it("a failure is reported on 'choose' too", async () => {
    const fake = fakeDeps({
      keyed: true,
      s2Match: rateLimited,
      crossrefMatch: () =>
        Promise.resolve([
          record({ ids: { doi: ID.doi } }),
          record({ ids: { doi: ID.otherDoi } }),
        ]),
    });
    const resolution = expectChoose(await resolveSeed(seed, fake.deps, ctx()));
    expect(resolution.failures).toHaveLength(1);
  });

  it("every service failing rethrows the first service's own error", async () => {
    const fake = fakeDeps({
      keyed: true,
      s2Match: rateLimited,
      crossrefMatch: down,
    });
    expect(await rejection(resolveSeed(seed, fake.deps, ctx()))).toBeInstanceOf(
      RateLimitError,
    );
  });

  it("no match from one and a failure from the other is the failure, not 'no match'", async () => {
    const fake = fakeDeps({ keyed: true, crossrefMatch: down });
    expect(await rejection(resolveSeed(seed, fake.deps, ctx()))).toBeInstanceOf(
      UpstreamServerError,
    );
  });

  it("keyless, Crossref failing is that failure", async () => {
    const fake = fakeDeps({ crossrefMatch: down });
    expect(await rejection(resolveSeed(seed, fake.deps, ctx()))).toBeInstanceOf(
      UpstreamServerError,
    );
  });

  it("a bug in a service is never reported as its failure", async () => {
    const bug = new TypeError("a bug");
    const fake = fakeDeps({
      crossrefMatch: () => Promise.reject(bug),
    });
    expect(await rejection(resolveSeed(seed, fake.deps, ctx()))).toBe(bug);

    const beside = fakeDeps({
      keyed: true,
      s2Match: () => Promise.reject(bug),
      crossrefMatch: () => Promise.resolve([record()]),
    });
    expect(await rejection(resolveSeed(seed, beside.deps, ctx()))).toBe(bug);

    const inLookup = fakeDeps({
      keyed: true,
      lookup: () => Promise.reject(bug),
    });
    expect(await rejection(expandSeedIds(seed, inLookup.deps, ctx()))).toBe(
      bug,
    );
  });

  it("every failure class it accepts is a ResearchHelperError", () => {
    expect(new RateLimitError(429, 1, "h")).toBeInstanceOf(ResearchHelperError);
    expect(new UpstreamServerError(503, "x")).toBeInstanceOf(
      ResearchHelperError,
    );
  });
});

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

describe("expandSeedIds", () => {
  it("keyless, with no PMCID: no call at all", async () => {
    const fake = fakeDeps();
    const seed = seedItem({ DOI: "10.1000/seed" });
    const { work, failures } = await expandSeedIds(seed, fake.deps, ctx());
    expect(work.ids).toEqual(seed.ids);
    expect(failures).toEqual([]);
    expect(fake.lookup).not.toHaveBeenCalled();
    expect(fake.convertPmcids).not.toHaveBeenCalled();
  });

  it("a seed's own value of every identifier beats the service's", async () => {
    const fake = fakeDeps({
      keyed: true,
      lookup: () =>
        Promise.resolve([
          record({
            sourceId: "semanticscholar",
            ids: {
              doi: ID.otherDoi,
              pmid: "999" as never,
              pmcid: "PMC999" as never,
              arxivId: "2202.00002" as never,
              s2CorpusId: "111" as never,
            },
          }),
        ]),
    });
    const seed = seedItem({
      DOI: "10.1000/seed",
      archiveID: "arXiv:2101.00001",
      extra: "PMID: 12345\nPMCID: PMC777\nrh-s2-corpus-id: 998877",
    });
    const { work } = await expandSeedIds(seed, fake.deps, ctx());
    expect(work.ids).toEqual({
      doi: "10.1000/seed",
      pmid: "12345",
      pmcid: "PMC777",
      arxivId: "2101.00001",
      s2CorpusId: "998877",
    });
  });

  it("keyed: one lookup, filling what the seed lacks and keeping its own values", async () => {
    const fake = fakeDeps({
      keyed: true,
      lookup: () =>
        Promise.resolve([
          record({
            sourceId: "semanticscholar",
            ids: {
              doi: ID.otherDoi,
              pmid: ID.pmid,
              pmcid: ID.pmcid,
              arxivId: "2101.00001" as never,
              s2CorpusId: ID.corpus,
              openAlexId: "W1" as never,
              url: "https://example.org/landing",
            },
          }),
        ]),
    });
    const seed = seedItem({ DOI: "10.1000/seed" });
    const { work, failures } = await expandSeedIds(seed, fake.deps, ctx());
    expect(work.ids).toEqual({
      doi: "10.1000/seed",
      pmid: ID.pmid,
      pmcid: ID.pmcid,
      arxivId: "2101.00001",
      s2CorpusId: ID.corpus,
      openAlexId: "W1",
    });
    expect(work.workKey).toBe(seed.workKey);
    expect(work.title).toBe(seed.title);
    expect(failures).toEqual([]);
    expect(fake.lookup).toHaveBeenCalledTimes(1);
    expect(fake.lookup.mock.calls[0]?.[0]).toEqual([{ doi: "10.1000/seed" }]);
    expect(fake.convertPmcids).not.toHaveBeenCalled();
  });

  it("keyed, lookup answering with a record: the converter is not asked", async () => {
    const fake = fakeDeps({
      keyed: true,
      lookup: () =>
        Promise.resolve([
          record({
            sourceId: "semanticscholar",
            ids: { s2CorpusId: ID.corpus },
          }),
        ]),
    });
    await expandSeedIds(seedItem({ extra: "PMCID: PMC777" }), fake.deps, ctx());
    expect(fake.convertPmcids).not.toHaveBeenCalled();
  });

  it("keyed, lookup finding nothing: the converter answers for a PMCID", async () => {
    const fake = fakeDeps({
      keyed: true,
      convert: () =>
        Promise.resolve(new Map([["PMC777", { doi: "10.1000/C", pmid: "9" }]])),
    });
    const { work } = await expandSeedIds(
      seedItem({ extra: "PMCID: PMC777" }),
      fake.deps,
      ctx(),
    );
    expect(work.ids).toMatchObject({ doi: "10.1000/c", pmid: "9" });
  });

  it("keyed, lookup failing: reported, and the converter still answers", async () => {
    const fake = fakeDeps({
      keyed: true,
      lookup: () =>
        Promise.reject(new RateLimitError(429, 1, SEMANTICSCHOLAR_HOST)),
      convert: () => Promise.resolve(new Map([["PMC777", { pmid: "9" }]])),
    });
    const { work, failures } = await expandSeedIds(
      seedItem({ extra: "PMCID: PMC777" }),
      fake.deps,
      ctx(),
    );
    expect(work.ids.pmid).toBe("9");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      source: "semanticscholar",
      step: "expand",
      error: { code: "RATE_LIMIT" },
    });
  });

  it("keyed, lookup failing with no PMCID: the seed's identifiers stand", async () => {
    const fake = fakeDeps({
      keyed: true,
      lookup: () => Promise.reject(new UpstreamServerError(500, "x")),
    });
    const seed = seedItem({ DOI: "10.1000/seed" });
    const { work, failures } = await expandSeedIds(seed, fake.deps, ctx());
    expect(work.ids).toEqual(seed.ids);
    expect(failures).toHaveLength(1);
  });

  it("the converter is asked with the PMCID and the token, and only when it can add", async () => {
    const lacking = fakeDeps();
    const context = ctx();
    await expandSeedIds(
      seedItem({ extra: "PMCID: PMC777\nPMID: 12345" }),
      lacking.deps,
      context,
    );
    expect(lacking.convertPmcids).toHaveBeenCalledWith(
      ["PMC777"],
      context.token,
    );

    const lackingPmid = fakeDeps();
    await expandSeedIds(
      seedItem({ extra: "PMCID: PMC777", DOI: "10.1000/seed" }),
      lackingPmid.deps,
      ctx(),
    );
    expect(lackingPmid.convertPmcids).toHaveBeenCalledTimes(1);

    const full = fakeDeps();
    await expandSeedIds(
      seedItem({ extra: "PMCID: PMC777\nPMID: 12345", DOI: "10.1000/seed" }),
      full.deps,
      ctx(),
    );
    expect(full.convertPmcids).not.toHaveBeenCalled();
  });

  it("a converter answer that does not normalize is dropped; an unresolved PMCID adds nothing", async () => {
    const malformed = fakeDeps({
      convert: () =>
        Promise.resolve(
          new Map([["PMC777", { doi: "not a doi", pmid: "not digits" }]]),
        ),
    });
    const seed = seedItem({ extra: "PMCID: PMC777" });
    expect((await expandSeedIds(seed, malformed.deps, ctx())).work.ids).toEqual(
      seed.ids,
    );
    const absent = fakeDeps();
    expect((await expandSeedIds(seed, absent.deps, ctx())).work.ids).toEqual(
      seed.ids,
    );
  });

  it("the converter's own values lose to the seed's", async () => {
    const fake = fakeDeps({
      convert: () =>
        Promise.resolve(new Map([["PMC777", { doi: "10.1000/c", pmid: "9" }]])),
    });
    const { work } = await expandSeedIds(
      seedItem({ extra: "PMCID: PMC777", DOI: "10.1000/seed" }),
      fake.deps,
      ctx(),
    );
    expect(work.ids).toMatchObject({ doi: "10.1000/seed", pmid: "9" });
  });

  it("a converter failing is reported", async () => {
    const fake = fakeDeps({
      convert: () => Promise.reject(new UpstreamServerError(502, "x")),
    });
    const { failures } = await expandSeedIds(
      seedItem({ extra: "PMCID: PMC777" }),
      fake.deps,
      ctx(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      source: "pmc-idconv",
      step: "expand",
      error: { code: "UPSTREAM_SERVER" },
    });
  });

  it("an arXiv DOI gives its arXiv id with no request", async () => {
    const fake = fakeDeps();
    const { work } = await expandSeedIds(
      seedItem({ DOI: "10.48550/arXiv.2101.00001" }),
      fake.deps,
      ctx(),
    );
    expect(work.ids.arxivId).toBe("2101.00001");
    expect(work.ids.doi).toBe("10.48550/arxiv.2101.00001");
  });

  it("another DOI gives no arXiv id, and a malformed arXiv DOI gives none", async () => {
    const other = await expandSeedIds(
      seedItem({ DOI: "10.1000/arxiv.2101.00001" }),
      fakeDeps().deps,
      ctx(),
    );
    expect(other.work.ids.arxivId).toBeUndefined();
    // As long as the prefix, so its tail would read as an id if the prefix went unchecked.
    expect("10.1000/journal".length).toBe("10.48550/arxiv.".length);
    const samePrefixLength = await expandSeedIds(
      seedItem({ DOI: "10.1000/journal2101.00001" }),
      fakeDeps().deps,
      ctx(),
    );
    expect(samePrefixLength.work.ids.arxivId).toBeUndefined();
    const malformed = await expandSeedIds(
      seedItem({ DOI: "10.48550/arXiv.not-an-id" }),
      fakeDeps().deps,
      ctx(),
    );
    expect(malformed.work.ids.arxivId).toBeUndefined();
  });

  it("lookup of an arXiv-DOI seed sends ARXIV:, never the DOI /paper/batch refuses", async () => {
    const fake = fakeDeps({ keyed: true });
    await expandSeedIds(
      seedItem({ DOI: "10.48550/arXiv.2101.00001" }),
      fake.deps,
      ctx(),
    );
    expect(fake.lookup.mock.calls[0]?.[0]).toEqual([{ arxivId: "2101.00001" }]);

    let body = "";
    const { deps } = realAdapters({
      keyed: true,
      answerFor: (host, request) => {
        if (host !== SEMANTICSCHOLAR_HOST) return undefined;
        body = (request as { body?: string }).body ?? "";
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: "[null]",
        };
      },
    });
    await expandSeedIds(
      seedItem({ DOI: "10.48550/arXiv.2101.00001" }),
      deps,
      ctx(),
    );
    expect(body).toContain("ARXIV:2101.00001");
    expect(body).not.toContain("10.48550");
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe("cancellation", () => {
  const cancelled = () => {
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });
    return { token: source.token };
  };

  it("resolveSeed sends nothing once cancelled", async () => {
    const fake = fakeDeps();
    expect(
      await rejection(
        resolveSeed(seedItem({ DOI: "10.1000/seed" }), fake.deps, cancelled()),
      ),
    ).toBeInstanceOf(OperationCancelledError);
    expect(fake.hasApiKey).not.toHaveBeenCalled();
  });

  it("expandSeedIds sends nothing once cancelled", async () => {
    const fake = fakeDeps({ keyed: true });
    expect(
      await rejection(
        expandSeedIds(
          seedItem({ DOI: "10.1000/seed" }),
          fake.deps,
          cancelled(),
        ),
      ),
    ).toBeInstanceOf(OperationCancelledError);
    expect(fake.lookup).not.toHaveBeenCalled();
  });

  it("a cancellation during the title step is not reported as a failure", async () => {
    const context = ctx();
    const fake = fakeDeps({
      crossrefMatch: () =>
        Promise.reject(new OperationCancelledError({ kind: "user" })),
    });
    expect(
      await rejection(
        resolveSeed(seedItem({ title: TITLE }), fake.deps, context),
      ),
    ).toBeInstanceOf(OperationCancelledError);
  });

  it("a cancellation arriving while the title answers came back stops there", async () => {
    const source = createCancellationTokenSource();
    const fake = fakeDeps({
      crossrefMatch: () => {
        source.cancel({ kind: "user" });
        return Promise.resolve([record()]);
      },
    });
    expect(
      await rejection(
        resolveSeed(seedItem({ title: TITLE }), fake.deps, {
          token: source.token,
        }),
      ),
    ).toBeInstanceOf(OperationCancelledError);
  });

  it("a cancellation during lookup or the converter is not reported as a failure", async () => {
    const cancel = () =>
      Promise.reject(new OperationCancelledError({ kind: "user" }));
    const duringLookup = fakeDeps({ keyed: true, lookup: cancel });
    expect(
      await rejection(
        expandSeedIds(
          seedItem({ DOI: "10.1000/seed" }),
          duringLookup.deps,
          ctx(),
        ),
      ),
    ).toBeInstanceOf(OperationCancelledError);
    const duringConverter = fakeDeps({ convert: cancel });
    expect(
      await rejection(
        expandSeedIds(
          seedItem({ extra: "PMCID: PMC777" }),
          duringConverter.deps,
          ctx(),
        ),
      ),
    ).toBeInstanceOf(OperationCancelledError);
  });
});
