import { describe, expect, it } from "vitest";

import { relatedFixtureDirFor } from "../../../scripts/record-fixtures";
import { createManualClock } from "../../../src/core/clock";
import {
  OperationCancelledError,
  ParseError,
  PolicyViolationError,
  SourceError,
} from "../../../src/core/errors";
import type {
  HttpClient,
  HttpMethod,
  HttpResponse,
} from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import { NCBI_HOST } from "../../../src/core/rateLimit/hostLimiter";
import type { SecretStore } from "../../../src/core/secretStore";
import type { Pmid } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  buildElinkNeighborScoreRequest,
  parseElinkNeighborScoreBody,
  PUBMED_ELINK_MAX_SEEDS,
  rankElinkLinkset,
} from "../../../src/sources/pubmed/elink";
import {
  createPubmedSource,
  EFETCH_MAX_IDS_PER_CALL,
  PUBMED_CAPABILITIES,
  PUBMED_SIMILAR_NO_PMID_WARNING,
  pubmedSimilarMalformedLinksWarning,
  pubmedSimilarMissingRecordsWarning,
  pubmedSimilarNoLinksetWarning,
  pubmedSimilarStrategyWarning,
  type PubmedSource,
  type PubmedSourceDeps,
} from "../../../src/sources/pubmed/pubmedSource";
import type {
  RelatedQuery,
  SourceCallContext,
} from "../../../src/sources/types";
import { createReplayHttpClient } from "../../contract/_transport";
import {
  PUBMED_ELINK_SEED_PMIDS,
  recordedPubmedElinkRequest,
} from "../../support/pubmedRecordedRequests";

/**
 * `P5-T08`: PubMed's similar articles. Layer 1 (`docs/13` §2.1), no network.
 *
 * `elink` answers come from the fixture `P5-T04` recorded on 2026-11-02
 * (`elink-two-seeds`) wherever one will do. Bodies written here are named
 * "hand-written" in their test, and they cover what the recording does not show.
 * `efetch` is always a stub that echoes the ids it was asked for: no neighbour's
 * record was recorded, and the XML is `P1-T10`'s to test.
 */

const [SEED_A, SEED_B] = PUBMED_ELINK_SEED_PMIDS as [string, string];

/** A fake value: no real key is used anywhere in this file. */
const FAKE_KEY = "fake-ncbi-key-for-a-test";

interface Issued {
  readonly method: HttpMethod;
  readonly url: string;
  /** The form body, when `efetch` moved to POST. */
  readonly body: string | undefined;
}

function response(url: string, body: string): HttpResponse {
  return {
    status: 200,
    url,
    body,
    rawHeaders: "",
    header: () => undefined,
  };
}

/** The recorded `elink` body, read through the shipped client. */
async function recordedBody(): Promise<string> {
  const { client } = createReplayHttpClient({
    dir: relatedFixtureDirFor("pubmed"),
    host: NCBI_HOST,
  });
  const answer = await client.request("GET", recordedPubmedElinkRequest().url, {
    responseType: "text",
  });
  return answer.body;
}

function idsOf(url: string): readonly string[] {
  return new URL(url).searchParams.getAll("id");
}

function isElink(url: string): boolean {
  return new URL(url).pathname.endsWith("/elink.fcgi");
}

/** The comma-joined PMIDs of an issued `efetch`, from the URL or the POST body. */
function efetchIds(call: Issued): readonly string[] {
  const query = call.body ?? new URL(call.url).search;
  return (new URLSearchParams(query).get("id") ?? "").split(",");
}

/** `efetch`'s stub body: the id list, which {@link echoMapper} turns into records. */
function efetchEcho(call: Issued): string {
  return `IDS:${efetchIds(call).join(",")}`;
}

function record(pmid: string, year?: number): SourceRecord {
  return {
    id: `pubmed:${pmid}`,
    sourceId: "pubmed",
    nativeId: pmid,
    work: {
      title: `Paper ${pmid}`,
      authors: [],
      ids: {},
      type: "journal-article",
      ...(year !== undefined && {
        publishedDate: { year, iso: String(year) },
      }),
    },
    retrievedAtEpochMs: 1_700_000_000_000,
    missingFields: [],
  };
}

function echoMapper(body: string): readonly SourceRecord[] {
  const list = body.startsWith("IDS:") ? body.slice(4) : "";
  return list === "" ? [] : list.split(",").map((pmid) => record(pmid));
}

/**
 * The adapter over a client that answers `elink` with `elinkBody`, through
 * `elinkClient` when one is given, and echoes every `efetch`.
 */
function harness(
  elinkBody: string,
  extra: Partial<PubmedSourceDeps> = {},
  elinkClient?: HttpClient,
): {
  readonly pubmed: PubmedSource;
  readonly issued: Issued[];
  readonly elinks: () => readonly Issued[];
  readonly efetches: () => readonly Issued[];
} {
  const issued: Issued[] = [];
  const http: HttpClient = {
    request(method, url, options) {
      const call: Issued = { method, url, body: options?.body };
      issued.push(call);
      if (isElink(url) && elinkClient !== undefined) {
        return elinkClient.request(method, url, options);
      }
      return Promise.resolve(
        response(url, isElink(url) ? elinkBody : efetchEcho(call)),
      );
    },
  };
  return {
    pubmed: createPubmedSource({
      http,
      clock: createManualClock(0),
      mapRecords: echoMapper,
      ...extra,
    }),
    issued,
    elinks: () => issued.filter((call) => isElink(call.url)),
    efetches: () => issued.filter((call) => !isElink(call.url)),
  };
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

function ctx(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

/** A hand-written `elink` body: one linkset per entry, links as `[id, score]`. */
function elinkBody(
  sets: Readonly<Record<string, readonly (readonly [string, number])[]>>,
): string {
  return JSON.stringify({
    header: { type: "elink", version: "0.3" },
    linksets: Object.entries(sets).map(([seed, links]) => ({
      dbfrom: "pubmed",
      ids: [seed],
      linksetdbs: [
        {
          dbto: "pubmed",
          linkname: "pubmed_pubmed",
          links: links.map(([id, score]) => ({ id, score })),
        },
      ],
    })),
  });
}

function storeHolding(value: string): SecretStore {
  return { get: () => Promise.resolve(value) } as unknown as SecretStore;
}

function spyLogger(): { readonly logger: Logger; readonly lines: string[] } {
  const lines: string[] = [];
  const log = (msg: string, context?: Record<string, unknown>): void => {
    lines.push(`${msg} ${JSON.stringify(context ?? {})}`);
  };
  const logger: Logger = {
    child: () => logger,
    error: log,
    warn: log,
    info: log,
    debug: log,
    time: (_msg, fn) => fn(),
  };
  return { logger, lines };
}

// ---------------------------------------------------------------------------
// The recorded two-seed fixture
// ---------------------------------------------------------------------------

describe("the recorded two-seed answer", () => {
  it("is what the rest of this file assumes: sorted by score, neighbours only", async () => {
    const sets = parseElinkNeighborScoreBody(await recordedBody(), "u");
    expect(sets.map((set) => set.seedPmid)).toEqual([SEED_A, SEED_B]);
    for (const set of sets) {
      expect(set.malformedLinks).toBe(0);
      expect(set.links).toHaveLength(100);
      const scores = set.links.map((link) => link.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it("yields one page per seed, scores in (0, 1], no seed in its own list, edges as long as records", async () => {
    const { pubmed } = harness(await recordedBody());
    const pages = await pubmed.findSimilarForSeeds(
      PUBMED_ELINK_SEED_PMIDS,
      { limit: 100 },
      ctx(),
    );

    expect(pages.map((page) => page.seedPmid)).toEqual([SEED_A, SEED_B]);
    for (const page of pages) {
      expect(page.records).toHaveLength(100);
      expect(page.edges).toHaveLength(page.records.length);
      expect(page.totalAvailable).toBe(100);
      expect(page.nextCursor).toBeUndefined();
      expect(page.warnings).toEqual([]);
      expect(page.records.map((r) => r.nativeId)).not.toContain(page.seedPmid);
      page.edges.forEach((edge, index) => {
        expect(edge.kind).toBe("similar");
        expect(edge.rank).toBe(index + 1);
        expect(edge.score).toBeGreaterThan(0);
        expect(edge.score).toBeLessThanOrEqual(1);
      });
      expect(page.edges[0]?.score).toBe(1);
    }
  });

  it("divides each list by its own maximum, read from the recorded numbers", async () => {
    const { pubmed } = harness(await recordedBody());
    const [a, b] = await pubmed.findSimilarForSeeds(
      PUBMED_ELINK_SEED_PMIDS,
      { limit: 100 },
      ctx(),
    );
    // `docs/05` §4.2's first two links, and the second seed's, as recorded.
    expect(a?.records[1]?.nativeId).toBe("39636237");
    expect(a?.edges[1]?.score).toBeCloseTo(24718838 / 28347383, 12);
    expect(b?.records[1]?.nativeId).toBe("32936427");
    expect(b?.edges[1]?.score).toBeCloseTo(30938993 / 36804128, 12);
  });

  it("sends one elink with one id parameter per seed, and fetches each neighbour once in batches", async () => {
    const { pubmed, elinks, efetches } = harness(await recordedBody());
    const pages = await pubmed.findSimilarForSeeds(
      PUBMED_ELINK_SEED_PMIDS,
      { limit: 100 },
      ctx(),
    );

    expect(elinks()).toHaveLength(1);
    expect(idsOf(elinks()[0]?.url ?? "")).toEqual([SEED_A, SEED_B]);

    const distinct = new Set(
      pages.flatMap((page) => page.records.map((r) => r.nativeId)),
    );
    const fetched = efetches().flatMap(efetchIds);
    expect(new Set(fetched)).toEqual(distinct);
    expect(fetched).toHaveLength(distinct.size);
    expect(efetches()).toHaveLength(
      Math.ceil(distinct.size / EFETCH_MAX_IDS_PER_CALL),
    );
  });

  it("slices to the limit per seed, after normalising, and fetches only the survivors", async () => {
    const { pubmed, efetches } = harness(await recordedBody());
    const pages = await pubmed.findSimilarForSeeds(
      PUBMED_ELINK_SEED_PMIDS,
      { limit: 5 },
      ctx(),
    );
    for (const page of pages) {
      expect(page.records).toHaveLength(5);
      expect(page.edges.map((edge) => edge.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(page.totalAvailable).toBe(100);
    }
    expect(efetches()).toHaveLength(1);
    expect(efetchIds(must(efetches()[0])).length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Decision D10, through the shipped client
// ---------------------------------------------------------------------------

describe("createHttpClient's NCBI identity check", () => {
  it("accepts the request the adapter sends, through the adapter", async () => {
    const replay = createReplayHttpClient({
      dir: relatedFixtureDirFor("pubmed"),
      host: NCBI_HOST,
    });
    const { pubmed, elinks } = harness("unused", {}, replay.client);
    const pages = await pubmed.findSimilarForSeeds(
      PUBMED_ELINK_SEED_PMIDS,
      { limit: 3 },
      ctx(),
    );
    expect(pages).toHaveLength(2);
    expect(elinks()[0]?.url).toBe(recordedPubmedElinkRequest().url);
    const sent = new URL(elinks()[0]?.url ?? "").searchParams;
    expect(sent.get("tool")).toBe("research_helper");
    expect(sent.get("email")).not.toBeNull();
  });

  it("is really on: the same request with another address is refused", async () => {
    const replay = createReplayHttpClient({
      dir: relatedFixtureDirFor("pubmed"),
      host: NCBI_HOST,
    });
    const url = new URL(recordedPubmedElinkRequest().url);
    url.searchParams.set("email", "someone.else@example.org");
    await expect(
      replay.client.request("GET", url.toString(), { responseType: "text" }),
    ).rejects.toBeInstanceOf(PolicyViolationError);
  });
});

// ---------------------------------------------------------------------------
// The flags
// ---------------------------------------------------------------------------

describe("capabilities", () => {
  it("declares both flags and has the method they promise", () => {
    expect(PUBMED_CAPABILITIES.relatedByWork).toBe(true);
    expect(PUBMED_CAPABILITIES.citationGraph).toBe(true);
    const { pubmed } = harness("{}");
    expect(pubmed.capabilities).toBe(PUBMED_CAPABILITIES);
    expect(pubmed.findRelated).toBeTypeOf("function");
  });
});

// ---------------------------------------------------------------------------
// `findRelated`: one seed
// ---------------------------------------------------------------------------

describe("findRelated", () => {
  const seedQuery: RelatedQuery = {
    ids: { pmid: SEED_A as Pmid },
    limit: 3,
    strategy: "similar",
  };

  it("answers strategy similar from one id parameter", async () => {
    const { pubmed, elinks } = harness(await recordedBody());
    const page = await pubmed.findRelated(seedQuery, ctx());
    expect(idsOf(elinks()[0]?.url ?? "")).toEqual([SEED_A]);
    expect(page.records.map((r) => r.nativeId)).toEqual([
      "42026145",
      "39636237",
      "41896605",
    ]);
    expect(page.edges.map((edge) => edge.rank)).toEqual([1, 2, 3]);
    expect(page.edges.map((edge) => edge.kind)).toEqual([
      "similar",
      "similar",
      "similar",
    ]);
  });

  it.each(["auto", undefined] as const)(
    "treats strategy %s as similar",
    async (strategy) => {
      const { pubmed, elinks } = harness(await recordedBody());
      const { strategy: _dropped, ...rest } = seedQuery;
      const page = await pubmed.findRelated(
        { ...rest, ...(strategy !== undefined && { strategy }) },
        ctx(),
      );
      expect(elinks()).toHaveLength(1);
      expect(page.records).toHaveLength(3);
    },
  );

  it.each([
    "citations",
    "references",
    "recommendations",
    "cocitation",
    "embedding",
  ] as const)(
    "sends nothing for strategy %s and says why",
    async (strategy) => {
      const { pubmed, issued } = harness("{}");
      const page = await pubmed.findRelated({ ...seedQuery, strategy }, ctx());
      expect(issued).toEqual([]);
      expect(page.records).toEqual([]);
      expect(page.edges).toEqual([]);
      expect(page.warnings).toEqual([pubmedSimilarStrategyWarning(strategy)]);
    },
  );

  it("sends nothing for a seed with no PMID and says why", async () => {
    const { pubmed, issued } = harness("{}");
    const page = await pubmed.findRelated(
      { ids: { doi: "10.1000/x" as never }, limit: 3 },
      ctx(),
    );
    expect(issued).toEqual([]);
    expect(page.records).toEqual([]);
    expect(page.edges).toEqual([]);
    expect(page.warnings).toEqual([PUBMED_SIMILAR_NO_PMID_WARNING]);
  });

  it("reads the PMID from the work when ids has none", async () => {
    const { pubmed, elinks } = harness(await recordedBody());
    await pubmed.findRelated(
      {
        work: { ids: { pmid: SEED_B as Pmid } } as RelatedQuery["work"] &
          object,
        limit: 1,
      },
      ctx(),
    );
    expect(idsOf(elinks()[0]?.url ?? "")).toEqual([SEED_B]);
  });
});

// ---------------------------------------------------------------------------
// What the recording does not show (hand-written `elink` bodies)
// ---------------------------------------------------------------------------

describe("hand-written lists", () => {
  it("drops the seed before normalising, so the seed's score is not the maximum", async () => {
    const { pubmed } = harness(
      elinkBody({
        "1": [
          ["1", 1000],
          ["2", 500],
          ["3", 250],
        ],
      }),
    );
    const [page] = await pubmed.findSimilarForSeeds(
      ["1"],
      { limit: 10 },
      ctx(),
    );
    expect(page?.records.map((r) => r.nativeId)).toEqual(["2", "3"]);
    expect(page?.edges).toEqual([
      { kind: "similar", rank: 1, score: 1 },
      { kind: "similar", rank: 2, score: 0.5 },
    ]);
    expect(page?.totalAvailable).toBe(2);
  });

  it("normalises before slicing: a limit does not change a neighbour's score", () => {
    const linkset = {
      seedPmid: "1",
      malformedLinks: 0,
      links: [
        { pmid: "2", score: 400 },
        { pmid: "3", score: 300 },
        { pmid: "4", score: 100 },
      ],
    };
    expect(rankElinkLinkset(linkset, 2).neighbours).toEqual([
      { pmid: "2", rank: 1, score: 1 },
      { pmid: "3", rank: 2, score: 0.75 },
    ]);
    expect(rankElinkLinkset(linkset, 2).listLength).toBe(3);

    // The list's maximum sits past the slice: `elink`'s order is kept as sent.
    const unsorted = {
      seedPmid: "1",
      malformedLinks: 0,
      links: [
        { pmid: "2", score: 100 },
        { pmid: "3", score: 400 },
      ],
    };
    expect(rankElinkLinkset(unsorted, 1).neighbours).toEqual([
      { pmid: "2", rank: 1, score: 0.25 },
    ]);
  });

  it("keeps one seed in another seed's list, and fetches a shared neighbour once", async () => {
    const { pubmed, efetches } = harness(
      elinkBody({
        "1": [
          ["2", 90],
          ["7", 30],
        ],
        "2": [
          ["7", 80],
          ["1", 40],
        ],
      }),
    );
    const [a, b] = await pubmed.findSimilarForSeeds(
      ["1", "2"],
      { limit: 10 },
      ctx(),
    );
    expect(a?.records.map((r) => r.nativeId)).toEqual(["2", "7"]);
    expect(b?.records.map((r) => r.nativeId)).toEqual(["7", "1"]);
    expect(a?.edges[1]?.score).toBeCloseTo(30 / 90, 12);
    expect(b?.edges[0]?.score).toBe(1);
    expect(efetches()).toHaveLength(1);
    expect(efetchIds(must(efetches()[0]))).toEqual(["2", "7", "1"]);
  });

  it("attributes a list by its own ids, not by its position in the response", async () => {
    // Spelled out, because an object literal would sort these two integer keys.
    const { pubmed } = harness(
      JSON.stringify({
        linksets: [
          {
            ids: ["2"],
            linksetdbs: [
              { linkname: "pubmed_pubmed", links: [{ id: "20", score: 5 }] },
            ],
          },
          {
            ids: ["1"],
            linksetdbs: [
              { linkname: "pubmed_pubmed", links: [{ id: "10", score: 5 }] },
            ],
          },
        ],
      }),
    );
    const [a, b] = await pubmed.findSimilarForSeeds(
      ["1", "2"],
      { limit: 10 },
      ctx(),
    );
    expect(a?.seedPmid).toBe("1");
    expect(a?.records.map((r) => r.nativeId)).toEqual(["10"]);
    expect(b?.records.map((r) => r.nativeId)).toEqual(["20"]);
  });

  it("gives a seed with no list an empty page and a warning, and leaves the other seed alone", async () => {
    const { pubmed } = harness(elinkBody({ "1": [["10", 5]] }));
    const [a, b] = await pubmed.findSimilarForSeeds(
      ["1", "2"],
      { limit: 10 },
      ctx(),
    );
    expect(a?.records).toHaveLength(1);
    expect(a?.warnings).toEqual([]);
    expect(b?.seedPmid).toBe("2");
    expect(b?.records).toEqual([]);
    expect(b?.edges).toEqual([]);
    expect(b?.totalAvailable).toBeUndefined();
    expect(b?.warnings).toEqual([pubmedSimilarNoLinksetWarning("2")]);
  });

  it("keeps edges beside their records when efetch drops or reorders some", async () => {
    const issuedMapper = (body: string): readonly SourceRecord[] =>
      // Reordered, and PMID 3 is gone: `docs/02` §3.8, unknown PMID.
      echoMapper(body)
        .filter((r) => r.nativeId !== "3")
        .reverse();
    const { pubmed } = harness(
      elinkBody({
        "1": [
          ["2", 100],
          ["3", 50],
          ["4", 25],
        ],
      }),
      { mapRecords: issuedMapper },
    );
    const [page] = await pubmed.findSimilarForSeeds(
      ["1"],
      { limit: 10 },
      ctx(),
    );
    expect(page?.records.map((r) => r.nativeId)).toEqual(["2", "4"]);
    expect(page?.edges).toEqual([
      { kind: "similar", rank: 1, score: 1 },
      { kind: "similar", rank: 3, score: 0.25 },
    ]);
    expect(page?.warnings).toEqual([pubmedSimilarMissingRecordsWarning(1)]);
  });

  it("filters by fromDate after hydration, keeps undated records, and keeps edges aligned", async () => {
    const dated = (body: string): readonly SourceRecord[] =>
      echoMapper(body).map((r) => {
        if (r.nativeId === "2") return record("2", 2019);
        if (r.nativeId === "4") return record("4", 2024);
        return r;
      });
    const { pubmed } = harness(
      elinkBody({
        "1": [
          ["2", 100],
          ["3", 50],
          ["4", 25],
        ],
      }),
      { mapRecords: dated },
    );
    const [page] = await pubmed.findSimilarForSeeds(
      ["1"],
      { limit: 10, fromDate: "2023-01-01" },
      ctx(),
    );
    expect(page?.records.map((r) => r.nativeId)).toEqual(["3", "4"]);
    expect(page?.edges.map((edge) => edge.rank)).toEqual([2, 3]);
    expect(page?.totalAvailable).toBe(3);
  });

  it("passes fromDate through findRelated", async () => {
    const dated = (body: string): readonly SourceRecord[] =>
      echoMapper(body).map((r) => record(r.nativeId, 2019));
    const { pubmed } = harness(elinkBody({ "1": [["2", 100]] }), {
      mapRecords: dated,
    });
    const page = await pubmed.findRelated(
      { ids: { pmid: "1" as Pmid }, limit: 5, fromDate: "2023-01-01" },
      ctx(),
    );
    expect(page.records).toEqual([]);
    expect(page.edges).toEqual([]);
  });

  it("leaves out links with no usable id or score, and says how many", async () => {
    const body = JSON.stringify({
      linksets: [
        {
          ids: ["1"],
          linksetdbs: [
            {
              linkname: "pubmed_pubmed",
              links: [
                { id: "2", score: 100 },
                { id: "3", score: 0 },
                { id: "4", score: -5 },
                { id: "x5", score: 10 },
                { id: "6", score: "10" },
                "7",
              ],
            },
          ],
        },
      ],
    });
    const { pubmed } = harness(body);
    const [page] = await pubmed.findSimilarForSeeds(
      ["1"],
      { limit: 10 },
      ctx(),
    );
    expect(page?.records.map((r) => r.nativeId)).toEqual(["2"]);
    expect(page?.warnings).toEqual([pubmedSimilarMalformedLinksWarning(5)]);
  });

  it("reads only the pubmed_pubmed entry, and a linkset with none is no neighbours", () => {
    const sets = parseElinkNeighborScoreBody(
      JSON.stringify({
        linksets: [
          {
            ids: ["1"],
            linksetdbs: [
              {
                linkname: "pubmed_pubmed_reviews",
                links: [{ id: "9", score: 1 }],
              },
              { linkname: "pubmed_pubmed", links: [{ id: "2", score: 1 }] },
            ],
          },
          { ids: ["3"] },
        ],
      }),
      "u",
    );
    expect(sets).toEqual([
      { seedPmid: "1", links: [{ pmid: "2", score: 1 }], malformedLinks: 0 },
      { seedPmid: "3", links: [], malformedLinks: 0 },
    ]);
  });

  it("does not list a neighbour twice", () => {
    const { neighbours } = rankElinkLinkset(
      {
        seedPmid: "1",
        malformedLinks: 0,
        links: [
          { pmid: "2", score: 10 },
          { pmid: "2", score: 5 },
          { pmid: "3", score: 5 },
        ],
      },
      10,
    );
    expect(neighbours.map((n) => n.rank)).toEqual([1, 2]);
    expect(neighbours.map((n) => n.pmid)).toEqual(["2", "3"]);
  });

  it("answers an empty list without dividing by zero", () => {
    expect(
      rankElinkLinkset(
        {
          seedPmid: "1",
          malformedLinks: 0,
          links: [{ pmid: "1", score: 10 }],
        },
        5,
      ),
    ).toEqual({ listLength: 0, neighbours: [] });
  });
});

// ---------------------------------------------------------------------------
// Bodies that must not look like an empty answer
// ---------------------------------------------------------------------------

describe("parseElinkNeighborScoreBody refuses", () => {
  it.each([
    ["not JSON", "<html>"],
    ["JSON that is not an object", "[]"],
    ["no linksets", '{"header":{}}'],
    ["a linkset with no ids", '{"linksets":[{"linksetdbs":[]}]}'],
    ["a linkset that merged two seeds", '{"linksets":[{"ids":["1","2"]}]}'],
    ["a linkset with a numeric id", '{"linksets":[{"ids":[1]}]}'],
    ["a linkset that is not an object", '{"linksets":[7]}'],
  ])("%s", (_name, body) => {
    expect(() => parseElinkNeighborScoreBody(body, "the-url")).toThrow(
      ParseError,
    );
  });

  it("a top-level ERROR, as a source error carrying the upstream text", () => {
    let caught: unknown;
    try {
      parseElinkNeighborScoreBody('{"ERROR":"hand-written"}', "the-url");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SourceError);
    expect(caught).not.toBeInstanceOf(ParseError);
    expect((caught as SourceError).message).toContain("hand-written");
    expect((caught as SourceError).context.url).toBe("the-url");
  });
});

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

describe("findSimilarForSeeds seeds", () => {
  it("sends nothing for no seeds", async () => {
    const { pubmed, issued } = harness("{}");
    await expect(
      pubmed.findSimilarForSeeds([], { limit: 5 }, ctx()),
    ).resolves.toEqual([]);
    expect(issued).toEqual([]);
  });

  it("takes the cap and refuses one more, before any request", async () => {
    const seeds = Array.from({ length: PUBMED_ELINK_MAX_SEEDS + 1 }, (_, i) =>
      String(100 + i),
    );
    const refused = harness("{}");
    await expect(
      refused.pubmed.findSimilarForSeeds(seeds, { limit: 5 }, ctx()),
    ).rejects.toBeInstanceOf(RangeError);
    expect(refused.issued).toEqual([]);

    const taken = harness(elinkBody({}));
    const pages = await taken.pubmed.findSimilarForSeeds(
      seeds.slice(1),
      { limit: 5 },
      ctx(),
    );
    expect(pages).toHaveLength(PUBMED_ELINK_MAX_SEEDS);
    expect(taken.elinks()).toHaveLength(1);
  });

  it("collapses a repeated seed into one parameter and one page", async () => {
    const { pubmed, elinks } = harness(elinkBody({ "1": [["2", 5]] }));
    const pages = await pubmed.findSimilarForSeeds(
      ["1", "1"],
      { limit: 5 },
      ctx(),
    );
    expect(pages).toHaveLength(1);
    expect(idsOf(elinks()[0]?.url ?? "")).toEqual(["1"]);
  });

  it("refuses a comma-joined seed, which would merge the lists (docs/05 §4.3)", async () => {
    const { pubmed, issued } = harness("{}");
    await expect(
      pubmed.findSimilarForSeeds(["1,2"], { limit: 5 }, ctx()),
    ).rejects.toBeInstanceOf(RangeError);
    expect(issued).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cancellation and failures
// ---------------------------------------------------------------------------

describe("cancellation and failures", () => {
  it("sends nothing when already cancelled", async () => {
    const { pubmed, issued } = harness(elinkBody({ "1": [["2", 5]] }));
    const cancellation = createCancellationTokenSource();
    cancellation.cancel({ kind: "user" });
    await expect(
      pubmed.findSimilarForSeeds(
        ["1"],
        { limit: 5 },
        {
          token: cancellation.token,
        },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(issued).toEqual([]);
  });

  it("sends no efetch once cancelled during the elink", async () => {
    const cancellation = createCancellationTokenSource();
    const issued: string[] = [];
    const http: HttpClient = {
      request(_method, url) {
        issued.push(url);
        cancellation.cancel({ kind: "user" });
        return Promise.resolve(response(url, elinkBody({ "1": [["2", 5]] })));
      },
    };
    const pubmed = createPubmedSource({
      http,
      clock: createManualClock(0),
      mapRecords: echoMapper,
    });
    await expect(
      pubmed.findSimilarForSeeds(
        ["1"],
        { limit: 5 },
        {
          token: cancellation.token,
        },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(issued).toHaveLength(1);
  });

  it("does not turn a failed efetch into an empty page", async () => {
    const http: HttpClient = {
      request(_method, url) {
        return isElink(url)
          ? Promise.resolve(response(url, elinkBody({ "1": [["2", 5]] })))
          : Promise.reject(new Error("efetch down"));
      },
    };
    const pubmed = createPubmedSource({
      http,
      clock: createManualClock(0),
      mapRecords: echoMapper,
    });
    await expect(
      pubmed.findSimilarForSeeds(["1"], { limit: 5 }, ctx()),
    ).rejects.toThrow("efetch down");
  });
});

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

describe("the NCBI key", () => {
  it("goes out between the seeds and the identity parameters, and into no log line", async () => {
    const { logger, lines } = spyLogger();
    const { pubmed, elinks, efetches } = harness(
      elinkBody({ "1": [["2", 5]] }),
      { secrets: storeHolding(FAKE_KEY), logger },
    );
    await pubmed.findSimilarForSeeds(["1"], { limit: 5 }, ctx());

    const url = elinks()[0]?.url ?? "";
    expect([...new URL(url).searchParams.keys()]).toEqual([
      "dbfrom",
      "db",
      "cmd",
      "linkname",
      "retmode",
      "id",
      "api_key",
      "tool",
      "email",
    ]);
    expect(new URL(url).searchParams.get("api_key")).toBe(FAKE_KEY);
    expect(efetches()[0]?.url).toContain(`api_key=${FAKE_KEY}`);
    expect(lines.some((line) => line.includes("pubmed elink"))).toBe(true);
    expect(lines.join("\n")).not.toContain(FAKE_KEY);
    expect(lines.join("\n")).not.toContain("api_key");
  });

  it("is removed from transmittedUrl, and so from a thrown error", async () => {
    const built = buildElinkNeighborScoreRequest(["1"], FAKE_KEY);
    expect(built.url).toContain(FAKE_KEY);
    expect(built.transmittedUrl).not.toContain(FAKE_KEY);
    expect(built.transmittedUrl).not.toContain("api_key");

    const { pubmed } = harness("not json", {
      secrets: storeHolding(FAKE_KEY),
    });
    const caught: unknown = await pubmed
      .findSimilarForSeeds(["1"], { limit: 5 }, ctx())
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ParseError);
    expect(JSON.stringify((caught as ParseError).context)).not.toContain(
      FAKE_KEY,
    );
    expect((caught as ParseError).message).not.toContain(FAKE_KEY);
  });

  it("leaves an unkeyed URL byte for byte what the fixture is named by", () => {
    const seeds = PUBMED_ELINK_SEED_PMIDS;
    const unkeyed = buildElinkNeighborScoreRequest(seeds).url;
    expect(unkeyed).toBe(recordedPubmedElinkRequest().url);
    expect(buildElinkNeighborScoreRequest(seeds, "").url).toBe(unkeyed);
    expect(unkeyed).not.toContain("api_key");
  });
});
