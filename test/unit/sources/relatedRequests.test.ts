/**
 * `P5-T04`: the five relatedness request builders, the fixtures recorded against
 * them, and the recorder's keyed Semantic Scholar path.
 *
 * Nothing here reaches a network. The keyed path is driven with a fake transport
 * and a fake key: no real key is read, and the live path is the owner's
 * (`docs/13` §3.5, `P5-T31`).
 *
 * A fixture is found by the exact method, URL and body (`fixtureKey`), so the
 * pins below are what `P5-T05`–`P5-T09` inherit: change a builder and its fixture
 * goes missing.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import { KEYISH_FIELD, redact } from "../../../src/core/errors";
import type {
  HttpExceptionClass,
  HttpTransport,
  HttpTransportXhr,
} from "../../../src/core/http/client";
import { MAINTAINER_EMAIL } from "../../../src/core/http/userAgent";
import {
  CROSSREF_HOST,
  EBI_HOST,
  NCBI_HOST,
  SEMANTICSCHOLAR_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import {
  buildCrossrefTitleSearchRequest,
  buildCrossrefWorkRequest,
  CROSSREF_TITLE_SEARCH_ROWS_MAX,
} from "../../../src/sources/crossref/references";
import {
  buildEuropePmcCitationsRequest,
  buildEuropePmcReferencesRequest,
} from "../../../src/sources/europepmc/citations";
import {
  buildElinkNeighborScoreRequest,
  PUBMED_ELINK_BASE_URL,
} from "../../../src/sources/pubmed/elink";
import {
  buildCitationsRequest,
  buildReferencesRequest,
  buildTitleMatchRequest,
  SEMANTICSCHOLAR_RELATION_FIELDS,
  SEMANTICSCHOLAR_RELATION_LIMIT_MAX,
} from "../../../src/sources/semanticscholar/graph";
import {
  buildForPaperRequest,
  buildRecommendRequest,
  SEMANTICSCHOLAR_RECOMMEND_FIELDS,
  SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX,
  SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX_WITH_ABSTRACT,
} from "../../../src/sources/semanticscholar/recommendations";
import {
  assertNoKeyHeaderName,
  type CliOptions,
  fixtureDirFor,
  isRelatedRecordableSource,
  KEYED_RESPONSE_HEADER_ALLOW,
  literalDenyList,
  type Mode,
  parseCliArgs,
  planFor,
  type RelatedRecordableSourceId,
  relatedFixtureDirFor,
  relatedPlanFor,
  runRelatedRecorder,
  SEMANTICSCHOLAR_KEY_ENV_VAR,
  semanticScholarKeyFromEnvironment,
  stripKeyedExchange,
  UsageError,
} from "../../../scripts/record-fixtures";
import {
  assertFixturesFresh,
  createReplayHttpClient,
  fixtureKey,
  listFixtureMeta,
  META_SUFFIX,
  type RecordedExchange,
} from "../../contract/_transport";
import { recordedSemanticScholarRecommendRequest } from "../../support/semanticscholarRecordedRequests";

// ---------------------------------------------------------------------------
// 1. The five builders: method, URL and body
// ---------------------------------------------------------------------------

const SEED = "DOI:10.1038/s41586-023-06139-9";
const RELATION_FIELDS_PARAM =
  "fields=contexts%2Cintents%2CisInfluential%2Ctitle%2Cyear%2CexternalIds%2CcitationCount";
const ADDRESS_PARAM = encodeURIComponent(MAINTAINER_EMAIL);

describe("Semantic Scholar graph builders", () => {
  it("references: GET, the id's colon and slash kept, fields then limit", () => {
    const built = buildReferencesRequest({ paperId: SEED, limit: 20 });
    expect(built.method).toBe("GET");
    expect(built.url).toBe(
      `https://api.semanticscholar.org/graph/v1/paper/${SEED}/references?` +
        `${RELATION_FIELDS_PARAM}&limit=20`,
    );
    expect(built.body).toBeUndefined();
    expect(built.transmittedUrl).toBe(built.url);
    expect(built.endpointBaseUrl).not.toContain("?");
    expect(built.endpointBaseUrl).not.toContain(SEED);
  });

  it("citations: the same with contexts, intents, isInfluential; an offset only when it is not 0", () => {
    expect(SEMANTICSCHOLAR_RELATION_FIELDS.slice(0, 3)).toEqual([
      "contexts",
      "intents",
      "isInfluential",
    ]);
    expect(
      buildCitationsRequest({ paperId: "PMID:37258680", limit: 5, offset: 0 })
        .url,
    ).toBe(
      `https://api.semanticscholar.org/graph/v1/paper/PMID:37258680/citations?` +
        `${RELATION_FIELDS_PARAM}&limit=5`,
    );
    expect(
      buildCitationsRequest({ paperId: "PMID:37258680", limit: 5, offset: 10 })
        .url,
    ).toMatch(/&limit=5&offset=10$/u);
    expect(
      buildCitationsRequest({
        paperId: "PMID:37258680",
        limit: 1,
        fields: ["title"],
      }).url,
    ).toMatch(/\/citations\?fields=title&limit=1$/u);
  });

  it("refuses what would cost a request for nothing", () => {
    expect(() => buildReferencesRequest({ paperId: " ", limit: 1 })).toThrow(
      RangeError,
    );
    for (const limit of [0, 1.5, SEMANTICSCHOLAR_RELATION_LIMIT_MAX + 1]) {
      expect(() => buildCitationsRequest({ paperId: SEED, limit })).toThrow(
        RangeError,
      );
    }
    expect(
      buildCitationsRequest({
        paperId: SEED,
        limit: SEMANTICSCHOLAR_RELATION_LIMIT_MAX,
      }).url,
    ).toContain("limit=1000");
    expect(() =>
      buildCitationsRequest({ paperId: SEED, limit: 1, offset: -1 }),
    ).toThrow(RangeError);
  });

  it("title match: GET /paper/search/match, the title encoded and trimmed, no tldr", () => {
    const built = buildTitleMatchRequest("  A title: with & marks ");
    expect(built.method).toBe("GET");
    expect(built.url).toMatch(
      /^https:\/\/api\.semanticscholar\.org\/graph\/v1\/paper\/search\/match\?query=A%20title%3A%20with%20%26%20marks&fields=/u,
    );
    expect(built.url).not.toContain("tldr");
    expect(built.endpointBaseUrl).toBe(
      "https://api.semanticscholar.org/graph/v1/paper/search/match",
    );
    expect(buildTitleMatchRequest("t", ["title"]).url).toMatch(
      /\?query=t&fields=title$/u,
    );
    expect(() => buildTitleMatchRequest("  ")).toThrow(RangeError);
  });
});

describe("Semantic Scholar Recommendations builders", () => {
  it("forpaper: GET, from=recent always, then limit and fields", () => {
    const built = buildForPaperRequest({ paperId: SEED, limit: 20 });
    expect(built.method).toBe("GET");
    expect(built.url).toBe(
      `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/${SEED}?` +
        `from=recent&limit=20&fields=title%2Cyear%2CexternalIds%2Cvenue%2CcitationCount%2Cabstract`,
    );
    expect(built.body).toBeUndefined();
    expect(built.url).not.toContain("all-cs");
  });

  it("POST /papers/: limit and fields in the query string, the ids in the body, positives first", () => {
    const built = buildRecommendRequest({
      positivePaperIds: [SEED, "PMID:37258680"],
      negativePaperIds: ["ARXIV:1706.03762"],
      limit: 20,
    });
    expect(built.method).toBe("POST");
    expect(built.url).toBe(
      "https://api.semanticscholar.org/recommendations/v1/papers/?limit=20&" +
        "fields=title%2Cyear%2CexternalIds%2Cvenue%2CcitationCount%2Cabstract",
    );
    expect(built.body).toBe(
      `{"positivePaperIds":["${SEED}","PMID:37258680"],` +
        `"negativePaperIds":["ARXIV:1706.03762"]}`,
    );
    expect(built.contentType).toBe("application/json");
  });

  it("keeps §3.3's ceilings: 100 with abstract, 500 without; a positive is required", () => {
    expect(SEMANTICSCHOLAR_RECOMMEND_FIELDS).toContain("abstract");
    const limit = SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX_WITH_ABSTRACT;
    expect(() =>
      buildForPaperRequest({ paperId: SEED, limit: limit + 1 }),
    ).toThrow(RangeError);
    expect(buildForPaperRequest({ paperId: SEED, limit }).url).toContain(
      `limit=${String(limit)}`,
    );
    expect(
      buildForPaperRequest({
        paperId: SEED,
        limit: SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX,
        fields: ["title"],
      }).url,
    ).toContain("limit=500");
    expect(() =>
      buildForPaperRequest({
        paperId: SEED,
        limit: SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX + 1,
        fields: ["title"],
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildRecommendRequest({
        positivePaperIds: [],
        negativePaperIds: [SEED],
        limit: 1,
      }),
    ).toThrow(RangeError);
    expect(() => buildForPaperRequest({ paperId: "", limit: 1 })).toThrow(
      RangeError,
    );
  });
});

describe("Europe PMC builders", () => {
  it("citations and references: GET, page, pageSize, format, email, the seed in the path", () => {
    const citations = buildEuropePmcCitationsRequest({
      source: "MED",
      id: "37258680",
      pageSize: 25,
    });
    expect(citations.method).toBe("GET");
    expect(citations.url).toBe(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/MED/37258680/citations?" +
        `page=1&pageSize=25&format=json&email=${ADDRESS_PARAM}`,
    );
    expect(
      buildEuropePmcReferencesRequest({
        source: "PMC",
        id: "PMC6142073",
        page: 2,
        pageSize: 3,
      }).url,
    ).toBe(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/PMC6142073/references?" +
        `page=2&pageSize=3&format=json&email=${ADDRESS_PARAM}`,
    );
    expect(citations.endpointBaseUrl).not.toContain("37258680");
    expect(citations.endpointBaseUrl).not.toContain("email");
  });

  it("refuses an id of the wrong shape and a page out of range", () => {
    expect(() =>
      buildEuropePmcCitationsRequest({
        source: "MED",
        id: "PMC1",
        pageSize: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildEuropePmcReferencesRequest({
        source: "PMC",
        id: "1",
        pageSize: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildEuropePmcCitationsRequest({
        source: "MED",
        id: "1",
        page: 0,
        pageSize: 1,
      }),
    ).toThrow(RangeError);
    for (const pageSize of [0, 1001]) {
      expect(() =>
        buildEuropePmcCitationsRequest({ source: "MED", id: "1", pageSize }),
      ).toThrow(RangeError);
    }
  });
});

describe("NCBI elink builder", () => {
  it("GET, neighbor_score, one id parameter per seed, then the identity parameters", () => {
    const built = buildElinkNeighborScoreRequest(["37258680", "39220605"]);
    expect(built.method).toBe("GET");
    expect(built.url).toBe(
      `${PUBMED_ELINK_BASE_URL}?dbfrom=pubmed&db=pubmed&cmd=neighbor_score&` +
        `linkname=pubmed_pubmed&retmode=json&id=37258680&id=39220605&` +
        `tool=research_helper&email=${ADDRESS_PARAM}`,
    );
    expect(built.url).not.toMatch(/id=[^&]*,/u);
    expect(built.endpointBaseUrl).toBe(PUBMED_ELINK_BASE_URL);
  });

  it("refuses no seed, and a comma-joined list", () => {
    expect(() => buildElinkNeighborScoreRequest([])).toThrow(RangeError);
    expect(() => buildElinkNeighborScoreRequest(["1,2"])).toThrow(RangeError);
  });
});

describe("Crossref builders", () => {
  it("/works/{doi}: GET, the DOI encoded whole, mailto only", () => {
    const built = buildCrossrefWorkRequest("10.1038/s41586-023-06139-9");
    expect(built.method).toBe("GET");
    expect(built.url).toBe(
      `https://api.crossref.org/works/10.1038%2Fs41586-023-06139-9?mailto=${ADDRESS_PARAM}`,
    );
    expect(built.endpointBaseUrl).toBe("https://api.crossref.org/works/{doi}");
    expect(
      buildCrossrefWorkRequest("10.1000/x", "someone@example.org").url,
    ).toMatch(/\?mailto=someone%40example\.org$/u);
    expect(() => buildCrossrefWorkRequest("not a doi")).toThrow(RangeError);
  });

  it("query.bibliographic: rows at most 5, no cursor and no sort, mailto last", () => {
    const built = buildCrossrefTitleSearchRequest({
      title: " A title ",
      rows: CROSSREF_TITLE_SEARCH_ROWS_MAX,
    });
    expect(CROSSREF_TITLE_SEARCH_ROWS_MAX).toBe(5);
    expect(built.method).toBe("GET");
    expect(built.url).toMatch(
      /^https:\/\/api\.crossref\.org\/works\?query\.bibliographic=A%20title&select=DOI%2C.*&rows=5&mailto=[^&]+$/u,
    );
    expect(built.url).not.toMatch(/[?&](cursor|sort|order)=/u);
    for (const rows of [0, 6]) {
      expect(() =>
        buildCrossrefTitleSearchRequest({ title: "t", rows }),
      ).toThrow(RangeError);
    }
  });

  it("refuses a blank title, and a DOI: query.bibliographic is not a resolver", () => {
    expect(() =>
      buildCrossrefTitleSearchRequest({ title: "  ", rows: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      buildCrossrefTitleSearchRequest({
        title: "10.1038/s41586-023-06139-9",
        rows: 1,
      }),
    ).toThrow(/not a DOI resolver/u);
  });
});

// ---------------------------------------------------------------------------
// 2. The plans and the committed fixtures
// ---------------------------------------------------------------------------

/** `plan/08` card `P5-T04` step 2, plus `title-search` and `citations-outage-seed`. */
const SCENARIOS: Readonly<
  Record<
    RelatedRecordableSourceId,
    {
      readonly host: string;
      readonly live: readonly string[];
      readonly synthetic: readonly string[];
    }
  >
> = {
  europepmc: {
    host: EBI_HOST,
    live: ["citations", "references", "citations-outage-seed"],
    synthetic: ["references-503"],
  },
  pubmed: { host: NCBI_HOST, live: ["elink-two-seeds"], synthetic: [] },
  crossref: {
    host: CROSSREF_HOST,
    live: ["work-with-references", "work-without-references", "title-search"],
    synthetic: [],
  },
  semanticscholar: {
    host: SEMANTICSCHOLAR_HOST,
    live: [
      "references",
      "citations",
      "forpaper",
      "recommend-post",
      "match-title",
      "match-title-absent",
      "batch-embedding",
      "batch-references",
      "batch-unresolvable",
      "seed-not-found",
      "citations-unknown-field",
    ],
    synthetic: ["recommend-size-cap"],
  },
};

const RECORDED_BY_THE_AGENT = ["europepmc", "pubmed", "crossref"] as const;

/** The exchange a scenario's plan names, read from its committed file. */
async function committed(
  source: RelatedRecordableSourceId,
  scenario: string,
): Promise<RecordedExchange> {
  const plan = relatedPlanFor(source);
  const planned = [
    ...plan.independent(),
    ...plan.synthetic().map((s) => s.planned),
  ].find((p) => p.scenario === scenario);
  if (planned === undefined) throw new Error(`no scenario ${scenario}`);
  return JSON.parse(
    await readFile(
      join(
        relatedFixtureDirFor(source),
        `${fixtureKey({
          method: planned.method,
          url: planned.url,
          ...(planned.body !== undefined && { body: planned.body }),
        })}.json`,
      ),
      "utf8",
    ),
  ) as RecordedExchange;
}

describe("the relatedness plans", () => {
  it.each(Object.keys(SCENARIOS) as RelatedRecordableSourceId[])(
    "%s plans exactly its scenarios, under its host, in related/",
    (source) => {
      const plan = relatedPlanFor(source);
      const expected = SCENARIOS[source];
      expect(plan.host).toBe(expected.host);
      expect(plan.independent().map((p) => p.scenario)).toEqual(expected.live);
      expect(plan.synthetic().map((s) => s.planned.scenario)).toEqual(
        expected.synthetic,
      );
      expect(plan.fixtureDir).toBe(join(fixtureDirFor(source), "related"));
      expect(plan.keyRequired).toBe(source === "semanticscholar");
      expect(isRelatedRecordableSource(source)).toBe(true);
    },
  );

  it("leaves the search plans and their pinned directories alone", () => {
    const search = planFor("semanticscholar")
      .independent()
      .map((p) => p.scenario);
    for (const scenario of SCENARIOS.semanticscholar.live) {
      if (scenario !== "references" && scenario !== "citations") {
        expect(search).not.toContain(scenario);
      }
    }
    expect(search).not.toContain("forpaper");
    expect(isRelatedRecordableSource("arxiv")).toBe(false);
  });

  it("marks every hand-written response, with a reason that says so", () => {
    for (const source of Object.keys(
      SCENARIOS,
    ) as RelatedRecordableSourceId[]) {
      for (const fixture of relatedPlanFor(source).synthetic()) {
        expect(fixture.reason).toMatch(/^Hand-written, not recorded/u);
      }
    }
    const [cap] = relatedPlanFor("semanticscholar").synthetic();
    expect(cap?.exchange.status).toBe(400);
    expect(cap?.exchange.body).toContain("Response would exceed maximum size");
    expect(cap?.planned.purpose).toMatch(/HAND-WRITTEN, never observed/u);
    expect(cap?.reason).toMatch(/not evidence about the service/u);
  });

  it("keys the size-cap 400 so that half its limit is the recorded POST", () => {
    const [cap] = relatedPlanFor("semanticscholar").synthetic();
    const post = relatedPlanFor("semanticscholar")
      .independent()
      .find((p) => p.scenario === "recommend-post");
    expect(cap?.planned.url).toContain("limit=40");
    expect(post?.url).toContain("limit=20");
    expect(post?.url).toBe(recordedSemanticScholarRecommendRequest().url);
    expect(cap?.planned.body).toBe(post?.body);
  });
});

describe("the committed Europe PMC, NCBI and Crossref fixtures", () => {
  it.each(RECORDED_BY_THE_AGENT)(
    "%s: every scenario has one fixture and one sidecar, live or marked, and nothing else",
    async (source) => {
      const dir = relatedFixtureDirFor(source);
      const expected = SCENARIOS[source];
      const loaded = await listFixtureMeta(dir);
      expect(loaded.map((l) => l.meta.scenario).sort()).toEqual(
        [...expected.live, ...expected.synthetic].sort(),
      );
      const names = await readdir(dir);
      expect(names).toHaveLength(2 * loaded.length);
      for (const { key, meta } of loaded) {
        expect(names).toContain(`${key}.json`);
        expect(names).toContain(`${key}${META_SUFFIX}`);
        expect(meta.synthetic).toBe(expected.synthetic.includes(meta.scenario));
        if (meta.synthetic) expect(meta.syntheticReason ?? "").not.toBe("");
        expect(meta.endpoint).not.toContain("?");
      }
      const report = await assertFixturesFresh(dir, Date.now());
      expect(report.checked).toBe(loaded.length);
    },
  );

  it.each(RECORDED_BY_THE_AGENT)(
    "%s: holds no address, no credential shape and no credential header",
    async (source) => {
      const dir = relatedFixtureDirFor(source);
      for (const name of await readdir(dir)) {
        const text = await readFile(join(dir, name), "utf8");
        expect(text, name).not.toMatch(/suppakoko(@|%40)gmail/iu);
        expect(text, name).not.toMatch(/api[_-]?key\s*=/iu);
        expect(text, name).not.toMatch(/"(authorization|set-cookie)"\s*:/iu);
        expect(text, name).not.toMatch(/"x-api-key"\s*:/iu);
        expect(redact(text), name).toBe(text);
      }
    },
  );

  it("elink answers one linkset per seed, through the shipped client's NCBI check", async () => {
    const [planned] = relatedPlanFor("pubmed").independent();
    if (planned === undefined) throw new Error("no elink scenario");
    const { client } = createReplayHttpClient({
      dir: relatedFixtureDirFor("pubmed"),
      host: NCBI_HOST,
    });
    const answer = await client.request("GET", planned.url, {
      responseType: "text",
    });
    const body = JSON.parse(answer.body) as {
      linksets: { ids: string[]; linksetdbs: { links: unknown[] }[] }[];
    };
    expect(body.linksets.map((l) => l.ids)).toEqual([
      ["37258680"],
      ["39220605"],
    ]);
    for (const set of body.linksets) {
      expect(set.linksetdbs[0]?.links.length).toBeGreaterThan(0);
    }
  });

  it("Europe PMC: both lists answer for the seed, and the outage seed's /citations is live", async () => {
    const citations = JSON.parse(
      (await committed("europepmc", "citations")).body,
    ) as { citationList: { citation: unknown[] } };
    expect(citations.citationList.citation.length).toBeGreaterThan(0);
    const references = JSON.parse(
      (await committed("europepmc", "references")).body,
    ) as { referenceList: { reference: unknown[] } };
    expect(references.referenceList.reference.length).toBeGreaterThan(0);
    const outage = JSON.parse(
      (await committed("europepmc", "citations-outage-seed")).body,
    ) as { citationList: { citation: unknown[] } };
    expect(outage.citationList.citation.length).toBeGreaterThan(0);
    const down = await committed("europepmc", "references-503");
    expect(down.status).toBe(503);
    expect(down.headers["content-type"]).toBe("text/plain");
  });

  it("Crossref: one work with a deposited reference[], one without, and the title search", async () => {
    type Work = {
      message: { reference?: unknown[]; "references-count": number };
    };
    const withRefs = JSON.parse(
      (await committed("crossref", "work-with-references")).body,
    ) as Work;
    expect(withRefs.message.reference?.length).toBeGreaterThan(0);
    const without = JSON.parse(
      (await committed("crossref", "work-without-references")).body,
    ) as Work;
    expect(without.message.reference).toBeUndefined();
    expect(without.message["references-count"]).toBe(0);
    const search = JSON.parse(
      (await committed("crossref", "title-search")).body,
    ) as { message: { items: { DOI: string }[] } };
    expect(search.message.items).toHaveLength(5);
    expect(search.message.items[0]?.DOI).toBe("10.1038/s41586-023-06139-9");
  });

  it("no committed Semantic Scholar file names the key header, related/ included once it exists", async () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    const dir = fixtureDirFor("semanticscholar");
    expect(existsSync(dir)).toBe(true);
    // `P5-T31`'s own check, over the whole directory, whichever files exist.
    for (const path of walk(dir)) {
      expect(await readFile(path, "utf8"), path).not.toMatch(/x-api-key/iu);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The keyed path, with a fake key and a fake transport
// ---------------------------------------------------------------------------

/**
 * Fake values, assembled so that nothing key-shaped sits in this file. The short
 * one matches no `KEY_PATTERNS` shape and is under `literalDenyList`'s 8-character
 * floor, so only the keyed path's own deny entry can catch it. The long one is the
 * shape a real key may have.
 */
const FAKE_KEYS = {
  short: ["f4k", "3k"].join(""),
  long: ["FakeKeyForTheRecorderTest", "OnlyNotARealValue1"].join("0"),
} as const;

interface FakeCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

interface FakeService {
  readonly calls: FakeCall[];
  created(): number;
  readonly factory: () => HttpTransport;
}

/**
 * A stand-in for the service that echoes the key back everywhere a careless
 * gateway could: a response header named for it, another header's value, a list
 * of allowed headers, and the body.
 */
function fakeService(
  statusFor: (call: FakeCall) => number = () => 200,
): FakeService {
  const calls: FakeCall[] = [];
  let created = 0;
  class Stub extends Error {}
  return {
    calls,
    created: () => created,
    factory: (): HttpTransport => {
      created += 1;
      return {
        request(method, url, options): Promise<HttpTransportXhr> {
          const call: FakeCall = {
            method,
            url,
            headers: options.headers ?? {},
            body: options.body,
          };
          calls.push(call);
          const key = call.headers["x-api-key"] ?? "(no key sent)";
          const block = [
            "content-type: application/json",
            `x-api-key: ${key}`,
            `x-echo-of-the-caller: ${key}`,
            "access-control-allow-headers: Content-Type,X-Api-Key",
            "set-cookie: session=fake",
            "x-amzn-requestid: fake-request-id",
            "x-amzn-errortype: FakeError",
          ].join("\r\n");
          return Promise.resolve({
            status: statusFor(call),
            responseText: JSON.stringify({
              echoedKey: key,
              echoedHeader: "the X-API-KEY header was accepted",
              data: [{ paperId: "a".repeat(40), title: "A title" }],
            }),
            responseURL: url,
            getAllResponseHeaders: () => block,
          });
        },
        UnexpectedStatusException: Stub as unknown as HttpExceptionClass<
          Error & { readonly xmlhttp: HttpTransportXhr }
        >,
        TimeoutException: Stub,
        BrowserOfflineException: Stub,
        SecurityException: Stub,
        CancelledException: Stub,
      };
    },
  };
}

/** One recorder run in a throwaway directory, every stream captured. */
async function runKeyedRecorder(
  args: readonly string[],
  mode: Mode,
  env: Readonly<Record<string, string | undefined>>,
  service: FakeService,
): Promise<{
  readonly code: number;
  readonly dir: string;
  readonly printed: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "rh-keyed-"));
  const out: string[] = [];
  const cli = parseCliArgs(["--source", "semanticscholar", ...args]);
  const code = await runRelatedRecorder(
    { ...cli, source: "semanticscholar" } as CliOptions & {
      readonly source: "semanticscholar";
    },
    mode,
    {
      env,
      stdout: (text) => out.push(text),
      stderr: (text) => out.push(text),
      fixtureDir: dir,
      transport: service.factory,
      clock: createManualClock(Date.UTC(2026, 10, 2)),
      toolVersion: "0.0.2",
    },
  );
  return { code, dir, printed: out.join("") };
}

/** Every stored file in `dir`, with its text. */
async function storedFiles(
  dir: string,
): Promise<readonly { readonly name: string; readonly text: string }[]> {
  const names = await readdir(dir);
  return Promise.all(
    names.map(async (name) => ({
      name,
      text: await readFile(join(dir, name), "utf8"),
    })),
  );
}

const keyEnv = (key: string): Record<string, string> => ({
  [SEMANTICSCHOLAR_KEY_ENV_VAR]: key,
});

describe("the keyed path — where the key comes from", () => {
  it("reads the one variable from the record it is given, and nothing when it is absent or blank", () => {
    expect(semanticScholarKeyFromEnvironment({})).toBeUndefined();
    expect(semanticScholarKeyFromEnvironment(keyEnv("  "))).toBeUndefined();
    expect(semanticScholarKeyFromEnvironment(keyEnv(" v "))).toBe("v");
    expect(
      semanticScholarKeyFromEnvironment({ S2_KEY: FAKE_KEYS.long }),
    ).toBeUndefined();
    expect(SEMANTICSCHOLAR_KEY_ENV_VAR).toBe("SEMANTIC_SCHOLAR_API_KEY");
    expect(KEYISH_FIELD.test(SEMANTICSCHOLAR_KEY_ENV_VAR)).toBe(true);
  });

  it("puts a long key on the deny-list by its variable's name as well", () => {
    expect(literalDenyList(keyEnv(FAKE_KEYS.long))).toContain(FAKE_KEYS.long);
    // The floor the keyed path's own entry exists for.
    expect(literalDenyList(keyEnv(FAKE_KEYS.short))).not.toContain(
      FAKE_KEYS.short,
    );
  });
});

describe("the keyed path — the gates, before anything is sent", () => {
  it("FIXTURE_MODE=record without --keyed and with no key: refused, the owner's command printed, nothing sent", async () => {
    const service = fakeService();
    const { code, dir, printed } = await runKeyedRecorder(
      [],
      "record",
      {},
      service,
    );
    try {
      expect(code).toBe(2);
      expect(printed).toMatch(/nothing was sent/u);
      expect(printed).toContain(
        "FIXTURE_MODE=record npm run fixtures:record -- --source semanticscholar --keyed",
      );
      expect(printed).toContain(SEMANTICSCHOLAR_KEY_ENV_VAR);
      expect(printed).toContain("docs/13 §3.5");
      expect(service.created()).toBe(0);
      expect(service.calls).toEqual([]);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("without --keyed and with a key in the environment: still refused, and the key is not printed", async () => {
    const service = fakeService();
    const { code, dir, printed } = await runKeyedRecorder(
      [],
      "record",
      keyEnv(FAKE_KEYS.long),
      service,
    );
    try {
      expect(code).toBe(2);
      expect(service.created()).toBe(0);
      expect(printed).not.toContain(FAKE_KEYS.long);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--keyed with no key: refused, with no anonymous attempt", async () => {
    const service = fakeService();
    const { code, dir, printed } = await runKeyedRecorder(
      ["--keyed"],
      "record",
      keyEnv("   "),
      service,
    );
    try {
      expect(code).toBe(2);
      expect(printed).toMatch(/SEMANTIC_SCHOLAR_API_KEY is not set/u);
      expect(service.created()).toBe(0);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a dry run lists every scenario, says only whether a key is present, and sends nothing", async () => {
    const service = fakeService();
    const yes = await runKeyedRecorder(
      ["--keyed"],
      "dry-run",
      keyEnv(FAKE_KEYS.long),
      service,
    );
    const no = await runKeyedRecorder(["--keyed"], "dry-run", {}, service);
    try {
      expect(yes.code).toBe(0);
      expect(yes.printed).toMatch(
        /Key present in SEMANTIC_SCHOLAR_API_KEY: yes/u,
      );
      expect(no.printed).toMatch(
        /Key present in SEMANTIC_SCHOLAR_API_KEY: no/u,
      );
      expect(yes.printed).not.toContain(FAKE_KEYS.long);
      expect(yes.printed).not.toContain(String(FAKE_KEYS.long.length));
      for (const scenario of [
        ...SCENARIOS.semanticscholar.live,
        ...SCENARIOS.semanticscholar.synthetic,
      ]) {
        expect(yes.printed).toContain(scenario);
      }
      expect(yes.printed).toMatch(/recommend-size-cap \(synthetic\)/u);
      expect(service.created()).toBe(0);
    } finally {
      await rm(yes.dir, { recursive: true, force: true });
      await rm(no.dir, { recursive: true, force: true });
    }
  });

  it("synthetic mode writes the hand-written 400 with no key and no request", async () => {
    const service = fakeService();
    const { code, dir, printed } = await runKeyedRecorder(
      ["--related"],
      "synthetic",
      {},
      service,
    );
    try {
      expect(code).toBe(0);
      expect(service.created()).toBe(0);
      expect(printed).toMatch(/no key read/u);
      const metas = await listFixtureMeta(dir);
      expect(metas.map((m) => m.meta.scenario)).toEqual(["recommend-size-cap"]);
      expect(metas[0]?.meta.synthetic).toBe(true);
      expect(metas[0]?.meta.syntheticReason).toMatch(/not evidence/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps --keyed to Semantic Scholar and --related to the sources with a plan", () => {
    expect(() => parseCliArgs(["--source", "crossref", "--keyed"])).toThrow(
      UsageError,
    );
    expect(() => parseCliArgs(["--source", "arxiv", "--related"])).toThrow(
      UsageError,
    );
    expect(parseCliArgs(["--source=semanticscholar", "--keyed"])).toEqual({
      source: "semanticscholar",
      dryRun: false,
      related: true,
      keyed: true,
    });
    expect(parseCliArgs(["--source", "pubmed", "--related"])).toEqual({
      source: "pubmed",
      dryRun: false,
      related: true,
    });
    expect(parseCliArgs(["--source", "semanticscholar"])).toEqual({
      source: "semanticscholar",
      dryRun: false,
    });
  });
});

describe("the keyed path — a recording carries no key", () => {
  it.each(Object.entries(FAKE_KEYS))(
    "the %s fake key: sent as the one header, stored nowhere, printed nowhere",
    async (_name, key) => {
      const service = fakeService();
      const { code, dir, printed } = await runKeyedRecorder(
        ["--keyed"],
        "record",
        keyEnv(key),
        service,
      );
      try {
        expect(code, printed).toBe(0);
        // Sent: every scenario once, in the header and nowhere else.
        expect(service.calls.map((c) => c.url)).toEqual(
          relatedPlanFor("semanticscholar")
            .independent()
            .map((p) => p.url),
        );
        for (const call of service.calls) {
          expect(call.headers["x-api-key"]).toBe(key);
          expect(call.url).not.toContain(key);
          expect(call.body ?? "").not.toContain(key);
        }
        const posted = service.calls.filter((c) => c.method === "POST");
        expect(posted).toHaveLength(4);
        for (const call of posted) {
          expect(call.headers["Content-Type"]).toBe("application/json");
        }

        // Stored: eleven recorded, one hand-written, each with its sidecar.
        const files = await storedFiles(dir);
        expect(files).toHaveLength(24);
        for (const { name, text } of files) {
          expect(text, `${name} carries the key`).not.toContain(key);
          expect(text, `${name} names the key header`).not.toMatch(
            /x-api-key/iu,
          );
          expect(text, `${name} carries a cookie`).not.toMatch(/set-cookie/iu);
        }

        // Printed: whether a key is present, and nothing of it.
        expect(printed).toMatch(/Key present: yes/u);
        expect(printed).not.toContain(key);

        // What a fixture keeps.
        const loaded = await listFixtureMeta(dir);
        const references = loaded.find((l) => l.meta.scenario === "references");
        if (references === undefined) throw new Error("no references fixture");
        const stored = JSON.parse(
          await readFile(join(dir, `${references.key}.json`), "utf8"),
        ) as RecordedExchange;
        expect(Object.keys(stored.headers).sort()).toEqual([
          "content-type",
          "x-amzn-errortype",
        ]);
        expect(stored.body).toContain("[redacted:env-secret]");
        expect(stored.body).toContain("[redacted:key-header-name]");
        // A paper SHA is kept, as the unkeyed plan keeps it.
        expect(stored.body).toContain("a".repeat(40));
        expect(references.meta.synthetic).toBe(false);
        expect(references.meta.redactions[0]).toMatch(
          /kept 2 response header\(s\) from the allow-list, dropped 5/u,
        );
        expect(
          loaded.filter((l) => l.meta.synthetic).map((l) => l.meta.scenario),
        ).toEqual(["recommend-size-cap"]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it("a fixture recorded with a key replays with none: the key is outside the hash", async () => {
    const service = fakeService();
    const { code, dir } = await runKeyedRecorder(
      ["--keyed", "--only", "references,recommend-post"],
      "record",
      keyEnv(FAKE_KEYS.long),
      service,
    );
    try {
      expect(code).toBe(0);
      const { client, transport } = createReplayHttpClient({
        dir,
        host: SEMANTICSCHOLAR_HOST,
      });
      const plan = relatedPlanFor("semanticscholar").independent();
      const references = plan.find((p) => p.scenario === "references");
      const post = plan.find((p) => p.scenario === "recommend-post");
      if (references === undefined || post === undefined) {
        throw new Error("missing scenario");
      }
      await client.request("GET", references.url, { responseType: "text" });
      await client.request("POST", post.url, {
        responseType: "text",
        ...(post.body !== undefined && { body: post.body }),
      });
      expect(transport.calls).toHaveLength(2);
      for (const call of transport.calls) {
        expect(call.options.headers?.["x-api-key"]).toBeUndefined();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--only records the named scenarios and leaves the hand-written one alone; an unknown name is refused", async () => {
    const service = fakeService();
    const run = await runKeyedRecorder(
      ["--keyed", "--only", "citations"],
      "record",
      keyEnv(FAKE_KEYS.long),
      service,
    );
    const bad = await runKeyedRecorder(
      ["--keyed", "--only", "no-such-scenario"],
      "record",
      keyEnv(FAKE_KEYS.long),
      service,
    );
    try {
      expect(run.code).toBe(0);
      expect(service.calls).toHaveLength(1);
      expect(
        (await listFixtureMeta(run.dir)).map((l) => l.meta.scenario),
      ).toEqual(["citations"]);
      expect(bad.code).toBe(2);
      expect(service.calls).toHaveLength(1);
    } finally {
      await rm(run.dir, { recursive: true, force: true });
      await rm(bad.dir, { recursive: true, force: true });
    }
  });
});

describe("the keyed path — what does not become a fixture", () => {
  it("a 401 or 403 stops the run and writes nothing, not even what was already answered", async () => {
    for (const refusal of [401, 403]) {
      let seen = 0;
      const service = fakeService(() => {
        seen += 1;
        return seen === 3 ? refusal : 200;
      });
      const { code, dir, printed } = await runKeyedRecorder(
        ["--keyed"],
        "record",
        keyEnv(FAKE_KEYS.long),
        service,
      );
      try {
        expect(code).toBe(1);
        expect(service.calls).toHaveLength(3);
        expect(printed).toMatch(/Nothing was written/u);
        expect(printed).not.toContain(FAKE_KEYS.long);
        expect(await readdir(dir)).toEqual([]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("a 429 stops the requests, keeps what was answered and prints the command for the rest", async () => {
    let seen = 0;
    const service = fakeService(() => {
      seen += 1;
      return seen === 2 ? 429 : 200;
    });
    const { code, dir, printed } = await runKeyedRecorder(
      ["--keyed"],
      "record",
      keyEnv(FAKE_KEYS.long),
      service,
    );
    try {
      expect(code).toBe(1);
      expect(service.calls).toHaveLength(2);
      const scenarios = (await listFixtureMeta(dir)).map(
        (l) => l.meta.scenario,
      );
      expect(scenarios.sort()).toEqual(["recommend-size-cap", "references"]);
      expect(printed).toMatch(
        /--source semanticscholar --keyed --only citations,forpaper,/u,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a 5xx is reported and not written, and the run goes on", async () => {
    let seen = 0;
    const service = fakeService(() => {
      seen += 1;
      return seen === 1 ? 503 : 200;
    });
    const { code, dir, printed } = await runKeyedRecorder(
      ["--keyed"],
      "record",
      keyEnv(FAKE_KEYS.long),
      service,
    );
    try {
      expect(code).toBe(1);
      expect(service.calls).toHaveLength(11);
      const scenarios = (await listFixtureMeta(dir)).map(
        (l) => l.meta.scenario,
      );
      expect(scenarios).not.toContain("references");
      expect(scenarios).toHaveLength(11);
      expect(printed).toMatch(/references: HTTP 503, not written/u);
      expect(printed).toMatch(/--keyed --only references/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a failure whose message holds the key is printed without it", async () => {
    const service = fakeService();
    const failing: FakeService = {
      ...service,
      factory: () => ({
        ...service.factory(),
        request: () =>
          Promise.reject(new Error(`refused for ${FAKE_KEYS.short}`)),
      }),
    };
    const { code, dir, printed } = await runKeyedRecorder(
      ["--keyed", "--only", "references"],
      "record",
      keyEnv(FAKE_KEYS.short),
      failing,
    );
    try {
      expect(code).toBe(1);
      expect(printed).toMatch(/references: .*refused for/u);
      expect(printed).not.toContain(FAKE_KEYS.short);
      expect(printed).toMatch(/--keyed --only references/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a 404 and a 400 are answers, and are recorded", async () => {
    const service = fakeService((call) =>
      call.url.includes("research-helper-unknown-id") ? 404 : 200,
    );
    const { code, dir } = await runKeyedRecorder(
      ["--keyed", "--only", "seed-not-found"],
      "record",
      keyEnv(FAKE_KEYS.long),
      service,
    );
    try {
      expect(code).toBe(0);
      const [only] = await listFixtureMeta(dir);
      const stored = JSON.parse(
        await readFile(join(dir, `${only?.key ?? ""}.json`), "utf8"),
      ) as RecordedExchange;
      expect(stored.status).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the keyed pass itself", () => {
  it("keeps only the allow-listed headers and takes the key header's name out of the body", () => {
    const { exchange, notes } = stripKeyedExchange(
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "value",
          "X-API-KEY": "value",
          "retry-after": "1",
          "x-ratelimit-remaining": "9",
          "x-ratelimit-note": "send X-Api-Key",
          "x-ratelimit-echo": `was ${FAKE_KEYS.short}`,
          "x-amzn-requestid": "id",
        },
        body: `use x-api-key or X-API-KEY, ${FAKE_KEYS.long}`,
      },
      FAKE_KEYS.long,
    );
    expect(exchange.headers).toEqual({
      "content-type": "application/json",
      "retry-after": "1",
      "x-ratelimit-remaining": "9",
      "x-ratelimit-echo": `was ${FAKE_KEYS.short}`,
    });
    expect(exchange.body).toBe(
      "use [redacted:key-header-name] or [redacted:key-header-name], " +
        "[redacted:env-secret]",
    );
    expect(exchange.status).toBe(200);
    for (const note of notes) expect(note).not.toMatch(/x-api-key/iu);
    expect(notes).toEqual([
      "keyed recording: kept 4 response header(s) from the allow-list, dropped 4",
      "scrubbed body: what named the key",
    ]);
    const echoed = stripKeyedExchange(
      {
        status: 200,
        headers: { "x-ratelimit-echo": `was ${FAKE_KEYS.short}` },
        body: "",
      },
      FAKE_KEYS.short,
    );
    expect(echoed.exchange.headers).toEqual({});
    expect(KEYED_RESPONSE_HEADER_ALLOW.some((re) => re.test("x-api-key"))).toBe(
      false,
    );
  });

  it("refuses a text that still names the header, in any case, without quoting it", () => {
    expect(() => assertNoKeyHeaderName("s", '{"X-Api-Key":"v"}')).toThrow(
      /still names the key header/u,
    );
    expect(() => assertNoKeyHeaderName("s", "clean")).not.toThrow();
  });
});
