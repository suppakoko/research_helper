import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  BadRequestError,
  OperationCancelledError,
  ParseError,
  SourceError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type { HttpClient, HttpResponse } from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { EBI_HOST } from "../../../src/core/rateLimit/hostLimiter";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { Doi, Pmcid, Pmid } from "../../../src/model/ids";
import {
  parseEuropePmcRelationBody,
  relationRowToCoreResult,
  resolveEuropePmcSeed,
  splitEuropePmcAuthorString,
} from "../../../src/sources/europepmc/citations";
import {
  createEuropePmcSource,
  EUROPEPMC_CAPABILITIES,
  relationsForStrategy,
} from "../../../src/sources/europepmc/europepmcSource";
import { createEuropePmcRecordMapper } from "../../../src/sources/europepmc/mapper";
import type {
  RelatedQuery,
  SourceCallContext,
} from "../../../src/sources/types";
import {
  createReplayHttpClient,
  listFixtureMeta,
} from "../../contract/_transport";
import {
  EUROPEPMC_RELATED_OUTAGE_SEED_PMID as OUTAGE_PMID,
  EUROPEPMC_RELATED_PAGE_SIZE as RECORDED_LIMIT,
  EUROPEPMC_RELATED_SEED_PMID as SEED_PMID,
} from "../../support/europepmcRecordedRequests";

/**
 * `P5-T07`. Plain Node, no Zotero, **no network**. The shipped adapter over the
 * shipped client replays `test/fixtures/europepmc/related/` (`P5-T04`), or a
 * stub answers from bodies derived from those recordings when a test needs a
 * shape nobody recorded: a second page, a row with no id, or a failing route.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, "../../fixtures/europepmc");
const RELATED_DIR = join(FIXTURE_DIR, "related");
const NOW = 1_700_000_000_000;
const SEED_DOI = "10.1038/s41586-023-06139-9" as Doi;

const pmid = (value: string): Pmid => value as Pmid;

function ctx(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

function adapter(http: HttpClient) {
  const clock = createManualClock(NOW);
  return createEuropePmcSource({
    http,
    clock,
    mapRecords: createEuropePmcRecordMapper({ clock }),
  });
}

/** The adapter over the recordings; a request nobody recorded fails loudly. */
function replayed() {
  const replay = createReplayHttpClient({
    dir: RELATED_DIR,
    host: EBI_HOST,
  });
  return { source: adapter(replay.client), replay };
}

function recorded(
  overrides: Partial<RelatedQuery> & { readonly seed?: string } = {},
): RelatedQuery {
  const { seed = SEED_PMID, ...rest } = overrides;
  return { ids: { pmid: pmid(seed) }, limit: RECORDED_LIMIT, ...rest };
}

function answer(url: string, body: string, status = 200): HttpResponse {
  return { status, url, body, rawHeaders: "", header: () => undefined };
}

/** A client that records each URL and answers from `handler`. */
function stubHttp(handler: (url: string, index: number) => HttpResponse): {
  readonly client: HttpClient;
  readonly urls: string[];
} {
  const urls: string[] = [];
  return {
    urls,
    client: {
      request(_method, url) {
        urls.push(url);
        try {
          return Promise.resolve(handler(url, urls.length - 1));
        } catch (error) {
          return Promise.reject(error as Error);
        }
      },
    },
  };
}

async function fixtureOf(scenario: string, dir = RELATED_DIR) {
  const meta = (await listFixtureMeta(dir)).find(
    (loaded) => loaded.meta.scenario === scenario,
  );
  if (meta === undefined) throw new Error(`no fixture ${scenario}`);
  return JSON.parse(await readFile(join(dir, `${meta.key}.json`), "utf8")) as {
    readonly status: number;
    readonly body: string;
  };
}

interface RawRow {
  readonly id: string;
  readonly source: string;
  readonly pubYear: number;
  readonly citedOrder?: number;
  readonly title: string;
}

async function citationRows(): Promise<readonly RawRow[]> {
  const body = JSON.parse((await fixtureOf("citations")).body) as {
    citationList: { citation: RawRow[] };
  };
  return body.citationList.citation;
}

async function referenceRows(): Promise<readonly RawRow[]> {
  const body = JSON.parse((await fixtureOf("references")).body) as {
    referenceList: { reference: RawRow[] };
  };
  return body.referenceList.reference;
}

function citationsBody(rows: readonly unknown[], hitCount?: number): string {
  return JSON.stringify({
    version: "6.9",
    ...(hitCount !== undefined && { hitCount }),
    citationList: { citation: rows },
  });
}

function referencesBody(rows: readonly unknown[], hitCount?: number): string {
  return JSON.stringify({
    version: "6.9",
    ...(hitCount !== undefined && { hitCount }),
    referenceList: { reference: rows },
  });
}

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
}

/** A list of `total` numbered rows, served by `page` and `pageSize`. */
function pagedList(total: number, hitCount: number | undefined) {
  return stubHttp((url) => {
    const params = paramsOf(url);
    const pageSize = Number(params.get("pageSize"));
    const start = (Number(params.get("page")) - 1) * pageSize;
    const rows = Array.from(
      { length: Math.max(0, Math.min(total - start, pageSize)) },
      (_, index) => ({
        source: "MED",
        id: String(start + index + 1),
        title: `Paper ${String(start + index + 1)}`,
        authorString: "Ahi EP.",
        pubYear: 2026,
      }),
    );
    return answer(url, citationsBody(rows, hitCount));
  });
}

// ---------------------------------------------------------------------------
// The two routes fail apart
// ---------------------------------------------------------------------------

describe("the two routes fail independently (docs/02 §4.7)", () => {
  it("the 503 fixture on /references leaves /citations working on the same seed", async () => {
    const { source } = replayed();
    await expect(
      source.findRelated(
        recorded({ seed: OUTAGE_PMID, strategy: "references" }),
        ctx(),
      ),
    ).rejects.toMatchObject({
      constructor: UpstreamServerError,
      httpStatus: 503,
    });

    const page = await source.findRelated(
      recorded({ seed: OUTAGE_PMID, strategy: "citations" }),
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["MED/41788111"]);
    expect(page.edges).toEqual([{ kind: "citation", rank: 1 }]);
    expect(page.totalAvailable).toBe(1);
    expect(page.warnings).toEqual([]);
  });

  it.each([["auto"], [undefined]] as const)(
    "strategy %s: the 503 is one warning naming /references, and the citations still return",
    async (strategy) => {
      const page = await replayed().source.findRelated(
        recorded({
          seed: OUTAGE_PMID,
          ...(strategy !== undefined && { strategy }),
        }),
        ctx(),
      );
      expect(page.records.map((r) => r.nativeId)).toEqual(["MED/41788111"]);
      expect(page.edges).toEqual([{ kind: "citation", rank: 1 }]);
      expect(page.totalAvailable).toBe(1);
      expect(page.warnings).toEqual([
        "Europe PMC: /references could not be read (UPSTREAM_SERVER); the other list was still used.",
      ]);
    },
  );

  it("a failure on /citations leaves /references working, the mirror case", async () => {
    const stub = stubHttp((url) =>
      url.includes("/citations?")
        ? answer(url, "This API is temporarily unavailable.")
        : answer(
            url,
            referencesBody([{ source: "MED", id: "9", title: "Kept" }], 1),
          ),
    );
    const page = await adapter(stub.client).findRelated(
      { ids: { pmid: pmid("1") }, limit: 5 },
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["MED/9"]);
    expect(page.edges).toEqual([{ kind: "reference", rank: 1 }]);
    expect(page.warnings).toEqual([
      "Europe PMC: /citations could not be read (PARSE); the other list was still used.",
    ]);
  });

  it("a non-JSON 200 on one named route is a ParseError on that route only", async () => {
    const stub = stubHttp((url) =>
      url.includes("/references?")
        ? answer(url, "This API is temporarily unavailable due to maintenance.")
        : answer(url, citationsBody([], 0)),
    );
    const source = adapter(stub.client);
    const query = { ids: { pmid: pmid("1") }, limit: 5 };
    await expect(
      source.findRelated({ ...query, strategy: "references" }, ctx()),
    ).rejects.toBeInstanceOf(ParseError);
    await expect(
      source.findRelated({ ...query, strategy: "citations" }, ctx()),
    ).resolves.toMatchObject({ records: [], totalAvailable: 0 });
  });

  it("when both fail, the citations failure is thrown rather than an empty page", async () => {
    const stub = stubHttp((url) =>
      url.includes("/citations?")
        ? answer(url, JSON.stringify({ errCode: 500, errMsg: "boom" }))
        : answer(url, "not json"),
    );
    await expect(
      adapter(stub.client).findRelated(
        { ids: { pmid: pmid("1") }, limit: 5 },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE" });
    expect(stub.urls).toHaveLength(2);
  });

  it("cancellation and a programming error are never turned into a warning", async () => {
    const tokens = createCancellationTokenSource();
    const cancelling = stubHttp(() => {
      tokens.cancel({ kind: "user" });
      tokens.token.throwIfCancelled();
      return answer("", "");
    });
    await expect(
      adapter(cancelling.client).findRelated(
        { ids: { pmid: pmid("1") }, limit: 5 },
        { token: tokens.token },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(cancelling.urls).toHaveLength(1);

    // Cancelled on the second route, after the first answered: still a cancel.
    const late = createCancellationTokenSource();
    const lateStub = stubHttp((url) => {
      if (url.includes("/references?")) {
        late.cancel({ kind: "user" });
        late.token.throwIfCancelled();
      }
      return answer(url, citationsBody([], 0));
    });
    await expect(
      adapter(lateStub.client).findRelated(
        { ids: { pmid: pmid("1") }, limit: 5 },
        { token: late.token },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);

    const bug = stubHttp(() => {
      throw new TypeError("a bug");
    });
    await expect(
      adapter(bug.client).findRelated(
        { ids: { pmid: pmid("1") }, limit: 5 },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(bug.urls).toHaveLength(1);
  });

  it("an already-cancelled token stops the call before any request", async () => {
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    const stub = stubHttp((url) => answer(url, citationsBody([], 0)));
    await expect(
      adapter(stub.client).findRelated(
        { ids: { pmid: pmid("1") }, limit: 5, strategy: "citations" },
        { token: tokens.token },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(stub.urls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

describe("capability flags (docs/07 §4.2)", () => {
  it("declares both flags true, and the method exists", () => {
    expect(EUROPEPMC_CAPABILITIES.citationGraph).toBe(true);
    expect(EUROPEPMC_CAPABILITIES.relatedByWork).toBe(true);
    const source = adapter(stubHttp((url) => answer(url, "")).client);
    expect(source.capabilities).toBe(EUROPEPMC_CAPABILITIES);
    expect(typeof source.findRelated).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// The recorded lists
// ---------------------------------------------------------------------------

describe("the recorded lists, through the shipped mapper", () => {
  it("/citations: one edge per record, the record cites the seed, ranks in list order", async () => {
    const rows = await citationRows();
    const page = await replayed().source.findRelated(
      recorded({ strategy: "citations" }),
      ctx(),
    );
    expect(page.records).toHaveLength(rows.length);
    expect(page.edges).toHaveLength(page.records.length);
    expect(page.records.map((r) => r.nativeId)).toEqual(
      rows.map((r) => `${r.source}/${r.id}`),
    );
    expect(page.edges).toEqual(
      rows.map((_, index) => ({ kind: "citation", rank: index + 1 })),
    );
    // `hitCount`, not the rows, and not `request.offSet`.
    expect(page.totalAvailable).toBe(927);
    expect(page.nextCursor).toBeUndefined();
    expect(page.warnings).toEqual([]);
  });

  it("/citations: a MED row's fields reach the record", async () => {
    const page = await replayed().source.findRelated(
      recorded({ strategy: "citations" }),
      ctx(),
    );
    const record = page.records[0];
    expect(record).toMatchObject({
      id: "europepmc:MED/42827388",
      sourceId: "europepmc",
      nativeId: "MED/42827388",
      retrievedAtEpochMs: NOW,
    });
    expect(record?.work).toMatchObject({
      ids: { pmid: "42827388" },
      // The mapper's trailing-period rule, so this compares equal in dedup.
      title:
        "Problems With GO Enrichment as an Endpoint for Ecological Omics Interpretation",
      containerAbbreviation: "Mol Ecol",
      volume: "35",
      issue: "19",
      pages: "e70570",
      citationCount: 0,
      publishedDate: { year: 2026, iso: "2026" },
    });
    expect(record?.work.authors.map((a) => [a.family, a.given])).toEqual([
      ["Ahi", "EP"],
      ["Karagic", "N"],
      ["Papakostas", "S"],
    ]);
    // What hydration has to fill.
    expect(record?.missingFields).toEqual(
      expect.arrayContaining(["abstract", "ids.doi", "containerTitle", "type"]),
    );
    expect(record?.missingFields).not.toContain("authors");
    expect(record?.missingFields).not.toContain("publishedDate");
  });

  it("/citations: a PPR row is a preprint with no invented identifier", async () => {
    const rows = await citationRows();
    const firstPreprint = rows.findIndex((r) => r.source === "PPR");
    expect(rows.filter((r) => r.source === "PPR")).toHaveLength(3);
    const page = await replayed().source.findRelated(
      recorded({ strategy: "citations" }),
      ctx(),
    );
    const record = page.records[firstPreprint];
    expect(record?.nativeId).toBe(`PPR/${rows[firstPreprint]?.id ?? ""}`);
    expect(record?.work.type).toBe("preprint");
    expect(record?.work.ids).toEqual({});
    expect(record?.work.publishedDate?.year).toBe(2026);
    expect(record?.work.authors[0]?.family).toBe("Wang");
    expect(page.edges[firstPreprint]).toEqual({
      kind: "citation",
      rank: firstPreprint + 1,
    });
  });

  it("/references: the seed cites the record, and rank agrees with citedOrder", async () => {
    const rows = await referenceRows();
    const page = await replayed().source.findRelated(
      recorded({ strategy: "references" }),
      ctx(),
    );
    expect(page.totalAvailable).toBe(144);
    expect(page.edges).toHaveLength(page.records.length);
    expect(page.edges).toEqual(
      rows.map((r) => ({ kind: "reference", rank: r.citedOrder })),
    );
    const last = page.records[page.records.length - 1];
    expect(last?.nativeId).toBe("MED/32398875");
    expect(last?.work).toMatchObject({
      ids: { pmid: "32398875" },
      containerAbbreviation: "Nat Med",
      issn: ["1078-8956", "1546-170X"],
      publishedDate: { year: 2020, iso: "2020" },
    });
    expect(last?.work.citationCount).toBeUndefined();
  });

  it("auto: both lists, citations first, each ranked by its own list, hit counts added", async () => {
    const page = await replayed().source.findRelated(recorded(), ctx());
    expect(page.records).toHaveLength(2 * RECORDED_LIMIT);
    expect(page.edges).toHaveLength(page.records.length);
    expect(page.edges[0]).toEqual({ kind: "citation", rank: 1 });
    expect(page.edges[RECORDED_LIMIT]).toEqual({ kind: "reference", rank: 1 });
    expect(page.totalAvailable).toBe(927 + 144);
    expect(page.warnings).toEqual([]);
  });

  it("limit is truncated to a whole number before the request is built", async () => {
    const page = await replayed().source.findRelated(
      recorded({ strategy: "citations", limit: RECORDED_LIMIT + 0.9 }),
      ctx(),
    );
    expect(page.records).toHaveLength(RECORDED_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

describe("paging to the caller's limit", () => {
  const query: RelatedQuery = {
    ids: { pmid: pmid("1") },
    strategy: "citations",
    limit: 1500,
  };

  it("keeps one pageSize across pages, stops at the limit and ranks across pages", async () => {
    const stub = pagedList(2000, 2000);
    const page = await adapter(stub.client).findRelated(query, ctx());
    expect(stub.urls.map((u) => paramsOf(u).get("page"))).toEqual(["1", "2"]);
    expect(stub.urls.map((u) => paramsOf(u).get("pageSize"))).toEqual([
      "1000",
      "1000",
    ]);
    expect(page.records).toHaveLength(1500);
    expect(page.edges).toHaveLength(1500);
    expect(page.edges[1499]).toEqual({ kind: "citation", rank: 1500 });
    expect(page.records[1499]?.nativeId).toBe("MED/1500");
    expect(page.totalAvailable).toBe(2000);
  });

  it("asks for exactly the limit when it fits one page", async () => {
    const stub = pagedList(100, 100);
    const page = await adapter(stub.client).findRelated(
      { ...query, limit: 10 },
      ctx(),
    );
    expect(stub.urls).toHaveLength(1);
    expect(paramsOf(stub.urls[0] ?? "").get("pageSize")).toBe("10");
    expect(page.records).toHaveLength(10);
  });

  it("stops after a short page", async () => {
    const stub = pagedList(1200, undefined);
    const page = await adapter(stub.client).findRelated(query, ctx());
    expect(stub.urls).toHaveLength(2);
    expect(page.records).toHaveLength(1200);
    expect(page.totalAvailable).toBeUndefined();
  });

  it("stops once hitCount says the list is exhausted, sparing the empty request", async () => {
    const stub = pagedList(1000, 1000);
    const page = await adapter(stub.client).findRelated(query, ctx());
    expect(stub.urls).toHaveLength(1);
    expect(page.records).toHaveLength(1000);
  });

  it("with no hitCount, a full last page costs one empty request and then stops", async () => {
    const stub = pagedList(1000, undefined);
    const page = await adapter(stub.client).findRelated(query, ctx());
    expect(stub.urls).toHaveLength(2);
    expect(page.records).toHaveLength(1000);
  });

  it("a limit of 0 asks the routes nothing", async () => {
    const stub = pagedList(10, 10);
    const page = await adapter(stub.client).findRelated(
      { ...query, limit: 0 },
      ctx(),
    );
    expect(stub.urls).toEqual([]);
    expect(page.records).toEqual([]);
  });

  it("checks cancellation at the top of every page", async () => {
    const tokens = createCancellationTokenSource();
    const inner = pagedList(2000, 2000);
    const client: HttpClient = {
      request: async (method, url, options) => {
        const result = await inner.client.request(method, url, options);
        tokens.cancel({ kind: "user" });
        return result;
      },
    };
    await expect(
      adapter(client).findRelated(query, { token: tokens.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(inner.urls).toHaveLength(1);
  });

  it("a row with no id leaves no record and no edge, keeps later ranks, and warns", async () => {
    const stub = stubHttp((url) =>
      answer(
        url,
        citationsBody(
          [
            { source: "MED", id: "1", title: "First" },
            { title: "Unmatched, so no id" },
            { source: "MED", id: "3", title: "Third" },
          ],
          3,
        ),
      ),
    );
    const page = await adapter(stub.client).findRelated(
      { ...query, limit: 5 },
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["MED/1", "MED/3"]);
    expect(page.edges.map((e) => e.rank)).toEqual([1, 3]);
    expect(page.warnings).toEqual([
      "Europe PMC: 1 row(s) of /citations had no id or source and were left out.",
    ]);
  });

  it("a dropped row does not cost the caller a record: the next page is read", async () => {
    const pages: readonly (readonly unknown[])[] = [
      [{ source: "MED", id: "1", title: "First" }, { title: "No id" }],
      [{ source: "MED", id: "3", title: "Third" }],
    ];
    const stub = stubHttp((url, index) =>
      answer(url, citationsBody(pages[index] ?? [], 3)),
    );
    const page = await adapter(stub.client).findRelated(
      { ...query, limit: 2 },
      ctx(),
    );
    expect(stub.urls).toHaveLength(2);
    expect(page.edges.map((e) => e.rank)).toEqual([1, 3]);
  });
});

// ---------------------------------------------------------------------------
// fromDate
// ---------------------------------------------------------------------------

describe("RelatedQuery.fromDate, which these routes cannot apply themselves", () => {
  it("drops older records, keeps ranks and the edges aligned, and sends no extra request", async () => {
    const rows = await referenceRows();
    const { source, replay } = replayed();
    const page = await source.findRelated(
      recorded({ strategy: "references", fromDate: "2020-06-01" }),
      ctx(),
    );
    const kept = rows.filter((r) => r.pubYear >= 2020);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(rows.length);
    expect(page.records.map((r) => r.nativeId)).toEqual(
      kept.map((r) => `MED/${r.id}`),
    );
    expect(page.edges.map((e) => e.rank)).toEqual(
      kept.map((r) => r.citedOrder),
    );
    expect(replay.limiter.acquired).toHaveLength(1);
  });

  it("keeps a record with no year", async () => {
    const stub = stubHttp((url) =>
      answer(
        url,
        citationsBody(
          [
            { source: "MED", id: "1", title: "Undated" },
            { source: "MED", id: "2", title: "Old", pubYear: 1999 },
          ],
          2,
        ),
      ),
    );
    const page = await adapter(stub.client).findRelated(
      {
        ids: { pmid: pmid("1") },
        strategy: "citations",
        limit: 5,
        fromDate: "2020-01-01",
      },
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["MED/1"]);
  });
});

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

describe("seed resolution", () => {
  const pmcid = "PMC7605294" as Pmcid;

  it("resolveEuropePmcSeed: PMID, then PMCID, and a malformed id counts as absent", () => {
    expect(resolveEuropePmcSeed({ pmid: pmid("7"), pmcid })).toEqual({
      source: "MED",
      id: "7",
    });
    expect(resolveEuropePmcSeed({ pmcid })).toEqual({
      source: "PMC",
      id: "PMC7605294",
    });
    expect(resolveEuropePmcSeed({ pmid: pmid("not digits"), pmcid })).toEqual({
      source: "PMC",
      id: "PMC7605294",
    });
    expect(resolveEuropePmcSeed({ doi: SEED_DOI })).toBeUndefined();
    expect(resolveEuropePmcSeed({})).toBeUndefined();
  });

  it("reads the ids from the work, and a query's own ids win", async () => {
    const stub = stubHttp((url) => answer(url, citationsBody([], 0)));
    const source = adapter(stub.client);
    // Only `ids` is read from the work.
    const work = { ids: { pmid: pmid("11") } } as unknown as CanonicalWork;
    await source.findRelated({ work, strategy: "citations", limit: 1 }, ctx());
    await source.findRelated(
      { work, ids: { pmid: pmid("22") }, strategy: "citations", limit: 1 },
      ctx(),
    );
    await source.findRelated(
      { ids: { pmcid }, strategy: "references", limit: 1 },
      ctx(),
    );
    expect(stub.urls[0]).toContain("/MED/11/citations?");
    expect(stub.urls[1]).toContain("/MED/22/citations?");
    expect(stub.urls[2]).toContain("/PMC/PMC7605294/references?");
    expect(stub.urls.every((u) => !u.includes("databaseLinks"))).toBe(true);
  });

  it("a DOI-only seed goes through lookup first, once, and then replays the recording", async () => {
    const lookupBody = (await fixtureOf("dedup-pair-set", FIXTURE_DIR)).body;
    const replay = createReplayHttpClient({ dir: RELATED_DIR, host: EBI_HOST });
    const searches: string[] = [];
    const client: HttpClient = {
      request(method, url, options) {
        if (url.includes("/search?")) {
          searches.push(url);
          return Promise.resolve(answer(url, lookupBody));
        }
        return replay.client.request(method, url, options);
      },
    };
    const page = await adapter(client).findRelated(
      { ids: { doi: SEED_DOI }, strategy: "citations", limit: RECORDED_LIMIT },
      ctx(),
    );
    expect(searches).toHaveLength(1);
    expect(paramsOf(searches[0] ?? "").get("query")).toContain(SEED_DOI);
    expect(page.totalAvailable).toBe(927);
  });

  it("a record for another DOI, or a PPR record, resolves nothing: 404, and no route is asked", async () => {
    const bodies = [
      JSON.stringify({
        hitCount: 1,
        resultList: {
          result: [
            {
              id: "5",
              source: "MED",
              pmid: "5",
              doi: "10.1000/other",
              title: "x",
            },
          ],
        },
      }),
      JSON.stringify({
        hitCount: 1,
        resultList: {
          result: [{ id: "PPR5", source: "PPR", doi: SEED_DOI, title: "x" }],
        },
      }),
    ];
    for (const body of bodies) {
      const stub = stubHttp((url) => answer(url, body));
      await expect(
        adapter(stub.client).findRelated(
          { ids: { doi: SEED_DOI }, limit: 5 },
          ctx(),
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestError,
        httpStatus: 404,
      });
      expect(stub.urls).toHaveLength(1);
      expect(stub.urls[0]).toContain("/search?");
    }
  });

  it("among records for the DOI, the first with a usable id wins", async () => {
    const stub = stubHttp((url) =>
      url.includes("/search?")
        ? answer(
            url,
            JSON.stringify({
              hitCount: 2,
              resultList: {
                result: [
                  { id: "PPR5", source: "PPR", doi: SEED_DOI, title: "x" },
                  {
                    id: "8",
                    source: "MED",
                    pmid: "8",
                    doi: SEED_DOI,
                    title: "y",
                  },
                  {
                    id: "9",
                    source: "MED",
                    pmid: "9",
                    doi: SEED_DOI,
                    title: "z",
                  },
                ],
              },
            }),
          )
        : answer(url, citationsBody([], 0)),
    );
    await adapter(stub.client).findRelated(
      { ids: { doi: SEED_DOI }, strategy: "citations", limit: 5 },
      ctx(),
    );
    expect(stub.urls[1]).toContain("/MED/8/citations?");
  });

  it("a seed with nothing usable throws the same 404 and sends no request at all", async () => {
    const stub = stubHttp((url) => answer(url, ""));
    for (const query of [
      { limit: 5 },
      { ids: {}, limit: 5 },
      { ids: { doi: "not a doi" as Doi }, limit: 5 },
    ]) {
      await expect(
        adapter(stub.client).findRelated(query, ctx()),
      ).rejects.toMatchObject({
        constructor: BadRequestError,
        httpStatus: 404,
      });
    }
    expect(stub.urls).toEqual([]);
  });

  it("an outage during the DOI lookup stays an outage, not a 'not indexed'", async () => {
    const stub = stubHttp(() => {
      throw new UpstreamServerError(503, "down");
    });
    await expect(
      adapter(stub.client).findRelated(
        { ids: { doi: SEED_DOI }, limit: 5 },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(UpstreamServerError);
  });
});

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

describe("relationsForStrategy", () => {
  it("names the routes", () => {
    expect(relationsForStrategy("citations")).toEqual(["citations"]);
    expect(relationsForStrategy("references")).toEqual(["references"]);
    expect(relationsForStrategy("auto")).toEqual(["citations", "references"]);
    expect(relationsForStrategy(undefined)).toEqual([
      "citations",
      "references",
    ]);
  });

  it.each(["recommendations", "similar", "cocitation", "embedding"] as const)(
    "refuses %s by name, before any request",
    async (strategy) => {
      const stub = stubHttp((url) => answer(url, ""));
      await expect(
        adapter(stub.client).findRelated(
          { ids: { pmid: pmid("1") }, limit: 5, strategy },
          ctx(),
        ),
      ).rejects.toThrow(new RegExp(strategy, "u"));
      expect(stub.urls).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

describe("parseEuropePmcRelationBody", () => {
  it("reads each route's own list and hitCount from the recordings", async () => {
    const citations = parseEuropePmcRelationBody(
      "citations",
      (await fixtureOf("citations")).body,
      "u",
    );
    expect(citations.rows).toHaveLength(25);
    expect(citations.hitCount).toBe(927);
    const references = parseEuropePmcRelationBody(
      "references",
      (await fixtureOf("references")).body,
      "u",
    );
    expect(references.rows).toHaveLength(25);
    expect(references.hitCount).toBe(144);
  });

  it("does not read the other route's list", () => {
    expect(() =>
      parseEuropePmcRelationBody("references", citationsBody([{}], 1), "u"),
    ).toThrow(/referenceList\.reference/u);
    expect(() =>
      parseEuropePmcRelationBody("citations", referencesBody([{}], 1), "u"),
    ).toThrow(/citationList\.citation/u);
  });

  it("an absent list is empty only when hitCount says 0", () => {
    expect(
      parseEuropePmcRelationBody("citations", '{"hitCount":0}', "u"),
    ).toEqual({ rows: [], hitCount: 0 });
    expect(() =>
      parseEuropePmcRelationBody("citations", '{"hitCount":3}', "u"),
    ).toThrow(ParseError);
    expect(() => parseEuropePmcRelationBody("citations", "{}", "u")).toThrow(
      ParseError,
    );
  });

  it("the hand-written 503's text, or JSON that is not an object, is a ParseError", async () => {
    const down = await fixtureOf("references-503");
    expect(down.status).toBe(503);
    expect(() =>
      parseEuropePmcRelationBody("references", down.body, "u"),
    ).toThrow(ParseError);
    expect(() => parseEuropePmcRelationBody("references", "[]", "u")).toThrow(
      ParseError,
    );
    expect(() => parseEuropePmcRelationBody("references", "null", "u")).toThrow(
      ParseError,
    );
  });

  it("errCode inside a 200 wins over a list, and is a SourceError with the url", () => {
    const body = JSON.stringify({
      errCode: 404,
      errMsg: "Article not found",
      citationList: { citation: [] },
    });
    let thrown: unknown;
    try {
      parseEuropePmcRelationBody("citations", body, "u");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SourceError);
    expect(thrown).not.toBeInstanceOf(ParseError);
    expect((thrown as SourceError).message).toContain(
      "errCode 404: Article not found",
    );
    expect((thrown as SourceError).context).toMatchObject({
      url: "u",
      errCode: 404,
    });
  });

  it("a hitCount that is not a number is absent", () => {
    expect(
      parseEuropePmcRelationBody(
        "citations",
        '{"hitCount":"3","citationList":{"citation":[]}}',
        "u",
      ).hitCount,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Row to core result
// ---------------------------------------------------------------------------

describe("relationRowToCoreResult", () => {
  it("names the id by its source, and only MED and PMC", () => {
    expect(relationRowToCoreResult({ source: "MED", id: "1" })).toMatchObject({
      pmid: "1",
    });
    const pmc = relationRowToCoreResult({ source: "PMC", id: "PMC1" });
    expect(pmc).toMatchObject({ pmcid: "PMC1" });
    expect(pmc).not.toHaveProperty("pmid");
    const ppr = relationRowToCoreResult({ source: "PPR", id: "PPR1" });
    expect(ppr).not.toHaveProperty("pmid");
    expect(ppr).not.toHaveProperty("pmcid");
  });

  it("turns a numeric pubYear into core's string, and passes a non-object through", () => {
    expect(relationRowToCoreResult({ pubYear: 2026 })).toMatchObject({
      pubYear: "2026",
    });
    expect(relationRowToCoreResult("not a row")).toBe("not a row");
  });
});

// ---------------------------------------------------------------------------
// authorString
// ---------------------------------------------------------------------------

describe("splitEuropePmcAuthorString", () => {
  it("splits family names and initials, and strips the final full stop", () => {
    expect(
      splitEuropePmcAuthorString("Ahi EP, Karagic N, Papakostas S."),
    ).toEqual([
      { lastName: "Ahi", firstName: "EP" },
      { lastName: "Karagic", firstName: "N" },
      { lastName: "Papakostas", firstName: "S" },
    ]);
  });

  it("keeps a many-word family name, a non-ASCII name and a lowercase initial", () => {
    expect(
      splitEuropePmcAuthorString("da Veiga Beltrame E, Grünewald J, Chen j."),
    ).toEqual([
      { lastName: "da Veiga Beltrame", firstName: "E" },
      { lastName: "Grünewald", firstName: "J" },
      { lastName: "Chen", firstName: "j" },
    ]);
  });

  it("a group or a single name is collective, and an empty string is nobody", () => {
    expect(splitEuropePmcAuthorString("UniProt Consortium, Pooja.")).toEqual([
      { collectiveName: "UniProt Consortium" },
      { collectiveName: "Pooja" },
    ]);
    expect(splitEuropePmcAuthorString(" ")).toEqual([]);
  });

  it("agrees with authorList on every Europe PMC fixture that gives both spellings", async () => {
    let compared = 0;
    for (const name of await readdir(FIXTURE_DIR)) {
      if (!name.endsWith(".json") || name.endsWith("_meta.json")) continue;
      const exchange = JSON.parse(
        await readFile(join(FIXTURE_DIR, name), "utf8"),
      ) as { body?: string };
      let body: { resultList?: { result?: unknown[] } };
      try {
        body = JSON.parse(exchange.body ?? "") as typeof body;
      } catch {
        continue; // The hand-written non-JSON fixtures.
      }
      for (const entry of body.resultList?.result ?? []) {
        const row = entry as {
          id: string;
          authorString?: string;
          authorList?: {
            author: { lastName?: string; collectiveName?: string }[];
          };
        };
        if (row.authorString === undefined || row.authorList === undefined) {
          continue;
        }
        const split = splitEuropePmcAuthorString(row.authorString).map(
          (a) => a.lastName ?? a.collectiveName,
        );
        const families = row.authorList.author.map(
          (a) => a.lastName ?? a.collectiveName,
        );
        expect(split, `${name} ${row.id}`).toEqual(families);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });
});
