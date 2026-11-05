/**
 * `P5-T09`: Crossref's deposited references as `findRelated`, and the title search.
 *
 * Replayed from `test/fixtures/crossref/related/` (`P5-T04`, recorded live on
 * 2026-11-02) through the shipped `createHttpClient`. A missing fixture is an
 * error naming the record command, never a network call. The hand-written bodies
 * below are for shapes those three recordings do not hold, and each says so.
 */

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  BadRequestError,
  OperationCancelledError,
  ParseError,
  SourceError,
} from "../../../src/core/errors";
import type { HttpClient, HttpResponse } from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  CROSSREF_HOST,
  type AdvertisedLimitTarget,
} from "../../../src/core/rateLimit/hostLimiter";
import { isSourceRecord } from "../../../src/model/sourceRecord";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { RateLimiterConfig } from "../../../src/core/rateLimit/tokenBucket";
import {
  createCrossrefSource,
  CROSSREF_CAPABILITIES,
  type CrossrefSource,
} from "../../../src/sources/crossref/crossrefSource";
import { createCrossrefRecordMapper } from "../../../src/sources/crossref/mapper";
import {
  buildCrossrefDoiLookupRequest,
  buildCrossrefTitleSearchRequest,
  CROSSREF_DOI_LOOKUP_BATCH,
  CROSSREF_TITLE_SEARCH_ROWS_MAX,
  parseCrossrefReferences,
} from "../../../src/sources/crossref/references";
import type {
  RelatedQuery,
  SourceCallContext,
} from "../../../src/sources/types";
import { relatedFixtureDirFor } from "../../../scripts/record-fixtures";
import { createReplayHttpClient } from "../../contract/_transport";
import {
  CROSSREF_DOI_NON_BIOMEDICAL_SEED as NON_BIOMEDICAL_SEED,
  CROSSREF_DOI_WITH_REFERENCES as WITH_REFERENCES,
  CROSSREF_DOI_WITHOUT_REFERENCES as WITHOUT_REFERENCES,
  CROSSREF_NON_BIOMEDICAL_REFERENCE_DOIS as NON_BIOMEDICAL_DOIS,
  CROSSREF_RELATED_TITLE as TITLE,
} from "../../support/crossrefRecordedRequests";

const NOW = 1_700_000_000_000;
const URL_IN_ERRORS = "https://api.crossref.org/works/{doi}";

function ctx(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

/** Titles are what these tests read; a stand-in parse leaves abstracts absent. */
function source(
  http: HttpClient,
  overrides: Partial<Parameters<typeof createCrossrefSource>[0]> = {},
): CrossrefSource {
  const clock = createManualClock(NOW);
  return createCrossrefSource({
    http,
    clock,
    mapRecords: createCrossrefRecordMapper({
      clock,
      parseXml: () => ({ documentElement: null }),
    }),
    ...overrides,
  });
}

/** The shipped client over the recorded exchanges. */
function replayed(
  overrides: Partial<Parameters<typeof createCrossrefSource>[0]> = {},
) {
  const replay = createReplayHttpClient({
    dir: relatedFixtureDirFor("crossref"),
    host: CROSSREF_HOST,
  });
  return { ...replay, source: source(replay.client, overrides) };
}

/** A client answering every request with `body`, recording each address. */
function canned(body: string): {
  readonly client: HttpClient;
  readonly urls: string[];
} {
  const urls: string[] = [];
  const client: HttpClient = {
    request(_method, url): Promise<HttpResponse> {
      urls.push(url);
      return Promise.resolve({
        status: 200,
        url,
        body,
        rawHeaders: "",
        header: () => undefined,
      });
    },
  };
  return { client, urls };
}

/** A hand-written `/works/{doi}` body with this `reference` member. */
function workBody(reference: unknown): string {
  return JSON.stringify({
    status: "ok",
    "message-type": "work",
    message: { DOI: "10.1000/seed", reference },
  });
}

const SEED_IDS: RelatedQuery["ids"] & object = {
  doi: WITH_REFERENCES as never,
};

const SEED: RelatedQuery = {
  ids: SEED_IDS,
  limit: 500,
  strategy: "references",
};

describe("findRelated over the recorded reference list", () => {
  it("maps each entry with a DOI to one record and one edge, of the same length", async () => {
    const { source: crossref, transport } = replayed();
    const page = await crossref.findRelated(SEED, ctx());

    expect(transport.calls).toHaveLength(1);
    expect(page.records).toHaveLength(155);
    expect(page.edges).toHaveLength(page.records.length);
    expect(page.totalAvailable).toBe(155);
    expect(page.nextCursor).toBeUndefined();
    expect(page.edges.every((edge) => edge.kind === "reference")).toBe(true);
    expect(new Set(page.records.map((r) => r.id)).size).toBe(155);
    expect(page.records.every(isSourceRecord)).toBe(true);
  });

  it("uses the list's own numbering as the rank, counting what was dropped", async () => {
    const { source: crossref } = replayed();
    const page = await crossref.findRelated(SEED, ctx());

    // Entries 2, 9, 12, 13 and 150 have no DOI in the recording.
    expect(page.edges.slice(0, 3).map((edge) => edge.rank)).toEqual([1, 3, 4]);
    const ranks = page.edges.map((edge) => edge.rank);
    for (const dropped of [2, 9, 12, 13, 150]) {
      expect(ranks).not.toContain(dropped);
    }
    expect(ranks.at(-1)).toBe(160);
    expect(page.records[1]?.work.ids.doi).toBe("10.1109/cvpr.2016.90");
  });

  it("counts the entries without a DOI on a warning, and keeps nothing else from them", async () => {
    const { source: crossref } = replayed();
    const page = await crossref.findRelated(SEED, ctx());

    expect(page.warnings).toEqual([
      "Crossref: 5 of 160 deposited references have no DOI and were left out.",
    ]);
    // The recording's one `[redacted:42]` sits in an entry with no DOI.
    expect(JSON.stringify(page.records)).not.toContain("redacted");
  });

  it("builds a record of the DOI alone, and says what filling it in must supply", async () => {
    const { source: crossref } = replayed();
    const page = await crossref.findRelated(SEED, ctx());
    const record = page.records[0];

    expect(record).toEqual({
      id: "crossref:10.48550/arxiv.1706.03762",
      sourceId: "crossref",
      nativeId: "10.48550/arxiv.1706.03762",
      work: {
        ids: { doi: "10.48550/arxiv.1706.03762" },
        type: "other",
        title: "",
        authors: [],
      },
      retrievedAtEpochMs: NOW,
      missingFields: expect.arrayContaining(["title", "authors", "type"]),
    });
    expect(record?.missingFields).not.toContain("ids.doi");
  });

  it("cuts to the limit, records and edges together, and keeps the list's total", async () => {
    const { source: crossref } = replayed();
    const page = await crossref.findRelated({ ...SEED, limit: 3 }, ctx());

    expect(page.records).toHaveLength(3);
    expect(page.edges.map((edge) => edge.rank)).toEqual([1, 3, 4]);
    expect(page.totalAvailable).toBe(155);
    expect(page.nextCursor).toBeUndefined();
  });

  it.each([
    [0, 0],
    [-1, 0],
    [Number.NaN, 0],
    [2.9, 2],
  ])("treats a limit of %s as %s", async (limit, expected) => {
    const { source: crossref } = replayed();
    const page = await crossref.findRelated({ ...SEED, limit }, ctx());
    expect(page.records).toHaveLength(expected);
    expect(page.edges).toHaveLength(expected);
  });

  it.each([
    ["no strategy", { ids: SEED_IDS, limit: 5 } satisfies RelatedQuery],
    ["auto", { ...SEED, limit: 5, strategy: "auto" } satisfies RelatedQuery],
  ])("reads the references for %s", async (_name, query) => {
    const { source: crossref } = replayed();
    expect((await crossref.findRelated(query, ctx())).records).toHaveLength(5);
  });

  it("reads the seed's DOI from `work` when `ids` has none, and normalises it", async () => {
    const { source: crossref } = replayed();
    const page = await crossref.findRelated(
      {
        work: {
          ids: { doi: WITH_REFERENCES.toUpperCase() },
        } as unknown as CanonicalWork,
        limit: 5,
      },
      ctx(),
    );
    expect(page.records).toHaveLength(5);
  });

  it("prefers `ids` over `work`", async () => {
    const { source: crossref } = replayed();
    const page = await crossref.findRelated(
      {
        ...SEED,
        work: {
          ids: { doi: WITHOUT_REFERENCES },
        } as unknown as CanonicalWork,
        limit: 5,
      },
      ctx(),
    );
    expect(page.records).toHaveLength(5);
  });

  it("says a date limit was not applied, rather than dropping it silently", async () => {
    const { source: crossref } = replayed();
    const page = await crossref.findRelated(
      { ...SEED, fromDate: "2023-01-01" },
      ctx(),
    );
    expect(page.records).toHaveLength(155);
    expect(page.warnings).toContainEqual(
      expect.stringMatching(/date limit was not applied/u),
    );
  });
});

describe("findRelated with nothing deposited", () => {
  it("answers the no-reference[] fixture with an empty page and a warning, not an error", async () => {
    const { source: crossref, transport } = replayed();
    const page = await crossref.findRelated(
      { ids: { doi: WITHOUT_REFERENCES as never }, limit: 20 },
      ctx(),
    );

    expect(transport.calls).toHaveLength(1);
    expect(page.records).toEqual([]);
    expect(page.edges).toEqual([]);
    expect(page.totalAvailable).toBe(0);
    expect(page.nextCursor).toBeUndefined();
    expect(page.warnings).toEqual([
      `Crossref holds no reference list for ${WITHOUT_REFERENCES}. Publishers ` +
        `deposit these by choice, so this does not mean the paper cites nothing.`,
    ]);
  });

  it("reads an empty reference[] the same way (hand-written; not recorded)", async () => {
    const { client } = canned(workBody([]));
    const page = await source(client).findRelated(
      { ids: { doi: "10.1000/seed" as never }, limit: 20 },
      ctx(),
    );
    expect(page.records).toEqual([]);
    expect(page.warnings).toEqual([
      expect.stringMatching(/holds no reference list/u),
    ]);
  });
});

describe("findRelated with what Crossref cannot answer sends nothing", () => {
  it.each([
    "citations",
    "recommendations",
    "similar",
    "cocitation",
    "embedding",
  ] as const)(
    "strategy %s is an empty page with a warning",
    async (strategy) => {
      const { client, urls } = canned("must not be read");
      const page = await source(client).findRelated(
        { ...SEED, strategy },
        ctx(),
      );
      expect(urls).toEqual([]);
      expect(page.records).toEqual([]);
      expect(page.edges).toEqual([]);
      expect(page.totalAvailable).toBeUndefined();
      expect(page.warnings).toEqual([expect.stringContaining(strategy)]);
    },
  );

  it("never reads is-referenced-by-count as a citation list", async () => {
    const body = JSON.stringify({
      status: "ok",
      "message-type": "work",
      message: { "is-referenced-by-count": 900 },
    });
    const { client } = canned(body);
    const page = await source(client).findRelated(
      { ids: { doi: "10.1000/seed" as never }, limit: 20 },
      ctx(),
    );
    expect(page.records).toEqual([]);
    expect(page.edges).toEqual([]);
    expect(page.totalAvailable).toBe(0);
  });

  it.each([
    ["a PMID-only seed", { ids: { pmid: "37258680" as never }, limit: 5 }],
    ["a seed with no identifiers", { limit: 5 }],
    [
      "a seed whose DOI is not one",
      { ids: { doi: "nope" as never }, limit: 5 },
    ],
  ] satisfies [string, RelatedQuery][])(
    "%s is an empty page with a warning",
    async (_name, query) => {
      const { client, urls } = canned("must not be read");
      const page = await source(client).findRelated(query, ctx());
      expect(urls).toEqual([]);
      expect(page.records).toEqual([]);
      expect(page.warnings).toEqual([
        expect.stringMatching(/by its DOI and this seed has none/u),
      ]);
    },
  );
});

describe("parseCrossrefReferences on shapes the recordings do not hold (hand-written)", () => {
  it("drops a malformed entry as having no DOI, and counts it in position", () => {
    const list = parseCrossrefReferences(
      workBody([
        "not an object",
        { key: "a", DOI: 42 },
        { key: "b", DOI: "not a doi" },
        { key: "c", DOI: "10.1000/KEPT" },
      ]),
      URL_IN_ERRORS,
      NOW,
    );
    expect(list.deposited).toBe(4);
    expect(list.withoutDoi).toBe(3);
    expect(list.records.map((r) => r.nativeId)).toEqual(["10.1000/kept"]);
    expect(list.edges).toEqual([{ kind: "reference", rank: 4 }]);
  });

  it("keeps a DOI listed twice once, at its first position", () => {
    const list = parseCrossrefReferences(
      workBody([
        { DOI: "10.1000/a" },
        { DOI: "10.1000/b" },
        { DOI: "10.1000/A" },
      ]),
      URL_IN_ERRORS,
      NOW,
    );
    expect(list.deposited).toBe(3);
    expect(list.withoutDoi).toBe(0);
    expect(list.records.map((r) => r.id)).toEqual([
      "crossref:10.1000/a",
      "crossref:10.1000/b",
    ]);
    expect(list.edges.map((edge) => edge.rank)).toEqual([1, 2]);
  });

  it.each([
    ["a body that is not JSON", "<html>", /not JSON/u],
    ["JSON that is not an object", "[]", /not an object/u],
    [
      "a work-list, which must not read as no references",
      JSON.stringify({
        status: "ok",
        "message-type": "work-list",
        message: { items: [] },
      }),
      /not a single work/u,
    ],
    [
      "a work with no message",
      JSON.stringify({ status: "ok", "message-type": "work" }),
      /not a single work/u,
    ],
    ["a reference member that is not an array", workBody({}), /not an array/u],
  ])("refuses %s", (_name, body, message) => {
    const parse = (): unknown =>
      parseCrossrefReferences(body, URL_IN_ERRORS, NOW);
    expect(parse).toThrow(ParseError);
    expect(parse).toThrow(message);
  });

  it("reports Crossref's own error envelope as a SourceError", () => {
    const body = JSON.stringify({
      status: "error",
      "message-type": "validation-failure",
      message: [{ type: "x" }],
    });
    expect(() => parseCrossrefReferences(body, URL_IN_ERRORS, NOW)).toThrow(
      SourceError,
    );
  });
});

describe("findRelated and the transport", () => {
  it("lets a transport failure through unwrapped, for the caller's negative cache", async () => {
    const failure = new BadRequestError(404, "HTTP 404 from api.crossref.org", {
      host: CROSSREF_HOST,
    });
    const client: HttpClient = { request: () => Promise.reject(failure) };
    await expect(source(client).findRelated(SEED, ctx())).rejects.toBe(failure);
  });

  it("checks cancellation before it sends", async () => {
    const { client, urls } = canned(workBody([]));
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });
    await expect(
      source(client).findRelated(SEED, { token: cts.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(urls).toEqual([]);
  });

  it("adopts the limits the recorded response advertises", async () => {
    const applied: RateLimiterConfig[] = [];
    const limiter: AdvertisedLimitTarget = {
      currentConfig: { ratePerSecond: 2, burst: 2, maxConcurrent: 3 },
      reconfigure: (config) => {
        applied.push(config);
      },
    };
    const { source: crossref } = replayed({ limiter });
    await crossref.findRelated(SEED, ctx());
    expect(applied).toHaveLength(1);
  });

  it("carries the user's contact address", async () => {
    const { client, urls } = canned(workBody([]));
    await source(client, {
      userContactEmail: () => "someone@example.org",
    }).findRelated(SEED, ctx());
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("mailto=someone%40example.org");
    expect(urls[0]).toContain("/works/10.1038%2Fs41586-023-06139-9?");
  });
});

describe("matchTitle", () => {
  it("returns the recorded search's candidates, in Crossref's order, unthresholded", async () => {
    const { source: crossref, transport } = replayed();
    const candidates = await crossref.matchTitle(TITLE, ctx());

    expect(transport.calls).toHaveLength(1);
    expect(candidates.map((c) => c.nativeId)).toEqual([
      "10.1038/s41586-023-06139-9",
      "10.1038/d41586-023-01504-0",
      "10.1021/jacs.5c03749.s001",
      "10.7717/peerj-cs.2321/table-5",
      "10.1007/s42832-024-0258-y",
    ]);
    expect(candidates[0]?.work.title).toBe(TITLE);
    expect(candidates[0]?.work.publishedDate?.year).toBe(2023);
    expect(candidates[0]?.work.authors.length).toBeGreaterThan(0);
  });

  it("asks for five rows at most, with the user's contact address", async () => {
    const { client, urls } = canned(
      JSON.stringify({
        status: "ok",
        "message-type": "work-list",
        message: { items: [] },
      }),
    );
    const candidates = await source(client, {
      userContactEmail: () => "someone@example.org",
    }).matchTitle("A title", ctx());
    expect(candidates).toEqual([]);
    expect(CROSSREF_TITLE_SEARCH_ROWS_MAX).toBe(5);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("rows=5&");
    expect(urls[0]).toContain("query.bibliographic=A%20title");
    expect(urls[0]).toContain("mailto=someone%40example.org");
  });

  it.each([
    "10.1038/s41586-023-06139-9",
    "https://doi.org/10.1038/s41586-023-06139-9",
    "doi:10.1038/s41586-023-06139-9",
    "  10.1038/S41586-023-06139-9  ",
  ])("refuses the DOI %s, before any request", async (title) => {
    const { client, urls } = canned("must not be read");
    await expect(source(client).matchTitle(title, ctx())).rejects.toThrow(
      /not a DOI resolver/u,
    );
    expect(urls).toEqual([]);
  });

  it("refuses a blank title, before any request", async () => {
    const { client, urls } = canned("must not be read");
    await expect(source(client).matchTitle("   ", ctx())).rejects.toThrow(
      RangeError,
    );
    expect(urls).toEqual([]);
  });

  it("does not take a title that merely mentions a DOI for one", () => {
    const title = "On the DOI 10.1000/abc and what it means";
    expect(buildCrossrefTitleSearchRequest({ title, rows: 1 }).url).toContain(
      "query.bibliographic=On%20the%20DOI",
    );
  });

  it("reports a malformed body as the search does", async () => {
    const { client } = canned("<html>");
    await expect(source(client).matchTitle("A title", ctx())).rejects.toThrow(
      ParseError,
    );
  });
});

describe("the capability flags", () => {
  it("declare the citation graph, related papers and a lookup by DOI", () => {
    const { source: crossref } = replayed();
    expect(CROSSREF_CAPABILITIES.relatedByWork).toBe(true);
    expect(CROSSREF_CAPABILITIES.citationGraph).toBe(true);
    expect(CROSSREF_CAPABILITIES.lookupById).toEqual(["doi"]);
    expect(typeof crossref.findRelated).toBe("function");
    expect(typeof crossref.lookup).toBe("function");
    expect(crossref.capabilities).toBe(CROSSREF_CAPABILITIES);
  });
});

describe("buildCrossrefDoiLookupRequest (P5-T32)", () => {
  it("asks filter=doi: with rows equal to the count, in the documented order", () => {
    const built = buildCrossrefDoiLookupRequest(["10.1000/a", "10.1000/b:c"]);
    expect(built.method).toBe("GET");
    expect(built.url).toMatch(
      /^https:\/\/api\.crossref\.org\/works\?filter=doi%3A10\.1000%2Fa%2Cdoi%3A10\.1000%2Fb%3Ac&select=DOI%2C[^&]+&rows=2&mailto=[^&]+$/u,
    );
    expect(built.endpointBaseUrl).toBe("https://api.crossref.org/works");
    expect(new URL(built.url).searchParams.get("filter")).toBe(
      "doi:10.1000/a,doi:10.1000/b:c",
    );
  });

  it("carries the contact address it is given", () => {
    const built = buildCrossrefDoiLookupRequest(
      ["10.1000/a"],
      "me@example.org",
    );
    expect(new URL(built.url).searchParams.get("mailto")).toBe(
      "me@example.org",
    );
  });

  it("takes exactly CROSSREF_DOI_LOOKUP_BATCH, and refuses one more or none", () => {
    const dois = Array.from(
      { length: CROSSREF_DOI_LOOKUP_BATCH + 1 },
      (_, index) => `10.1000/${String(index)}`,
    );
    expect(CROSSREF_DOI_LOOKUP_BATCH).toBe(100);
    expect(
      new URL(
        buildCrossrefDoiLookupRequest(dois.slice(1)).url,
      ).searchParams.get("rows"),
    ).toBe("100");
    expect(() => buildCrossrefDoiLookupRequest(dois)).toThrow(RangeError);
    expect(() => buildCrossrefDoiLookupRequest([])).toThrow(RangeError);
  });

  it("refuses what would fail or change the whole list", () => {
    expect(() => buildCrossrefDoiLookupRequest(["10.5555/rh,comma"])).toThrow(
      RangeError,
    );
    expect(() => buildCrossrefDoiLookupRequest(["not a doi"])).toThrow(
      RangeError,
    );
  });
});

describe("lookup (P5-T32)", () => {
  const items = (...dois: string[]) =>
    JSON.stringify({
      status: "ok",
      message: {
        "total-results": dois.length,
        items: dois.map((DOI) => ({
          DOI,
          title: [`Title of ${DOI}`],
          type: "journal-article",
        })),
      },
    });

  it("Done when: maps the recorded answer for the 60 reference DOIs", async () => {
    const { source: crossref, transport } = replayed();
    const records = await crossref.lookup(
      NON_BIOMEDICAL_DOIS.map((doi) => ({ doi: doi as never })),
      ctx(),
    );
    expect(transport.calls).toHaveLength(1);
    expect(records).toHaveLength(60);
    const dois = records.map((record) => record.work.ids.doi);
    expect(new Set(dois)).toEqual(new Set(NON_BIOMEDICAL_DOIS));
    for (const record of records) {
      expect(isSourceRecord(record)).toBe(true);
      expect(record.work.title.trim()).not.toBe("");
      expect(record.work.type).not.toBe("other");
      expect(record.id).toBe(`crossref:${record.work.ids.doi ?? ""}`);
    }
  });

  it("gives a filled record the id of the reference row it fills, on the recorded bodies", async () => {
    const { source: crossref } = replayed();
    const rows = await crossref.findRelated(
      {
        ids: { doi: NON_BIOMEDICAL_SEED as never },
        limit: 100,
        strategy: "references",
      },
      ctx(),
    );
    const filled = await crossref.lookup(
      NON_BIOMEDICAL_DOIS.map((doi) => ({ doi: doi as never })),
      ctx(),
    );
    expect(rows.records.map((record) => record.work.ids.doi)).toEqual(
      NON_BIOMEDICAL_DOIS,
    );
    expect(new Set(filled.map((record) => record.id))).toEqual(
      new Set(rows.records.map((record) => record.id)),
    );
    const before = new Map(
      rows.records.map((record) => [record.id, record.missingFields.length]),
    );
    for (const record of filled) {
      expect(record.missingFields.length).toBeLessThan(
        before.get(record.id) ?? 0,
      );
    }
  });

  it("normalizes, dedupes and skips what is no DOI, with one request", async () => {
    const { client, urls } = canned(items("10.1000/a", "10.1000/b"));
    const records = await source(client).lookup(
      [
        { doi: "https://doi.org/10.1000/A" as never },
        { doi: "10.1000/a" as never },
        { doi: "10.1000/b" as never },
        { doi: "nonsense" as never },
        { pmid: "123" as never },
        {},
      ],
      ctx(),
    );
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0] ?? "").searchParams.get("filter")).toBe(
      "doi:10.1000/a,doi:10.1000/b",
    );
    expect(new URL(urls[0] ?? "").searchParams.get("rows")).toBe("2");
    expect(records).toHaveLength(2);
  });

  it("sends nothing when nothing can be asked", async () => {
    const { client, urls } = canned(items());
    await expect(
      source(client).lookup([{ pmid: "123" as never }], ctx()),
    ).resolves.toEqual([]);
    await expect(source(client).lookup([], ctx())).resolves.toEqual([]);
    expect(urls).toEqual([]);
  });

  it("leaves a DOI with a comma out, and asks the rest", async () => {
    const debug: string[] = [];
    const { client, urls } = canned(items("10.1000/a"));
    const logger = {
      debug: (message: string) => debug.push(message),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as NonNullable<
      Parameters<typeof createCrossrefSource>[0]["logger"]
    >;
    await source(client, { logger }).lookup(
      [{ doi: "10.5555/rh,comma" as never }, { doi: "10.1000/a" as never }],
      ctx(),
    );
    expect(new URL(urls[0] ?? "").searchParams.get("filter")).toBe(
      "doi:10.1000/a",
    );
    expect(debug).toContain("crossref: a DOI with a comma is not asked");
  });

  it("sends nothing for a list of only such DOIs", async () => {
    const { client, urls } = canned(items());
    await source(client).lookup([{ doi: "10.5555/rh,comma" as never }], ctx());
    expect(urls).toEqual([]);
  });

  it("sends CROSSREF_DOI_LOOKUP_BATCH to a request, rows matching each", async () => {
    const { client, urls } = canned(items("10.1000/1"));
    const ids = Array.from({ length: 250 }, (_, index) => ({
      doi: `10.1000/${String(index)}` as never,
    }));
    const records = await source(client).lookup(ids, ctx());
    expect(urls.map((url) => new URL(url).searchParams.get("rows"))).toEqual([
      "100",
      "100",
      "50",
    ]);
    const asked = urls.flatMap((url) =>
      (new URL(url).searchParams.get("filter") ?? "").split(","),
    );
    expect(new Set(asked).size).toBe(250);
    expect(records).toHaveLength(3);
  });

  it("carries the contactEmail preference's value", async () => {
    const { client, urls } = canned(items());
    await source(client, { userContactEmail: () => "me@example.org" }).lookup(
      [{ doi: "10.1000/a" as never }],
      ctx(),
    );
    expect(new URL(urls[0] ?? "").searchParams.get("mailto")).toBe(
      "me@example.org",
    );
  });

  it("adopts the limits the recorded answer advertises", async () => {
    const applied: RateLimiterConfig[] = [];
    const limiter: AdvertisedLimitTarget = {
      currentConfig: { ratePerSecond: 2, burst: 2, maxConcurrent: 3 },
      reconfigure: (config) => {
        applied.push(config);
      },
    };
    const { source: crossref } = replayed({ limiter });
    await crossref.lookup(
      NON_BIOMEDICAL_DOIS.map((doi) => ({ doi: doi as never })),
      ctx(),
    );
    expect(applied).toHaveLength(1);
  });

  it("reports a malformed body and a status other than ok as the search does", async () => {
    await expect(
      source(canned("<html>").client).lookup(
        [{ doi: "10.1000/a" as never }],
        ctx(),
      ),
    ).rejects.toThrow(ParseError);
    await expect(
      source(
        canned(JSON.stringify({ status: "failed", message: "no" })).client,
      ).lookup([{ doi: "10.1000/a" as never }], ctx()),
    ).rejects.toThrow(SourceError);
  });

  it("lets a failed request throw", async () => {
    const failure = new Error("transport");
    const client: HttpClient = { request: () => Promise.reject(failure) };
    await expect(
      source(client).lookup([{ doi: "10.1000/a" as never }], ctx()),
    ).rejects.toBe(failure);
  });

  it("is cancelled before a request", async () => {
    const { client, urls } = canned(items());
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    await expect(
      source(client).lookup([{ doi: "10.1000/a" as never }], {
        token: tokens.token,
      }),
    ).rejects.toThrow(OperationCancelledError);
    expect(urls).toEqual([]);
  });
});
