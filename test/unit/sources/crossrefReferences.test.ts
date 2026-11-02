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
  buildCrossrefTitleSearchRequest,
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
  CROSSREF_DOI_WITH_REFERENCES as WITH_REFERENCES,
  CROSSREF_DOI_WITHOUT_REFERENCES as WITHOUT_REFERENCES,
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
  it("declare the citation graph and related papers, and no identifier lookup", () => {
    const { source: crossref } = replayed();
    expect(CROSSREF_CAPABILITIES.relatedByWork).toBe(true);
    expect(CROSSREF_CAPABILITIES.citationGraph).toBe(true);
    expect(CROSSREF_CAPABILITIES.lookupById).toEqual([]);
    expect(typeof crossref.findRelated).toBe("function");
    expect(crossref.capabilities).toBe(CROSSREF_CAPABILITIES);
  });
});
