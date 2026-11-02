/**
 * `P5-T06`: Semantic Scholar Recommendations, one seed (`forpaper`) and many
 * (`POST /papers/`).
 *
 * **The fixtures in `test/fixtures/semanticscholar/related/` are stand-ins until
 * `P5-T31`** (`plan/00` §6 item 335(a)), and `recommend-size-cap` stays hand-written
 * after it (`docs/13` §3.1). What these tests expect is computed from the fixture's own
 * rows, so it survives the replacement.
 *
 * `recommend` validates the exact ids of its call through one `/paper/batch`, and no
 * recorded scenario can hold every test's ids. So the routed client below composes
 * that answer from `batch-unresolvable`'s rows, and everything else is read from the
 * fixtures through the shipped `createHttpClient`.
 */

import { dirname } from "node:path";

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
import { SEMANTICSCHOLAR_HOST } from "../../../src/core/rateLimit/hostLimiter";
import type { SecretStore } from "../../../src/core/secretStore";
import type { ExternalIds } from "../../../src/model/ids";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import {
  encodePaperId,
  SEMANTICSCHOLAR_BATCH_IDS_MAX,
  SEMANTICSCHOLAR_BATCH_URL,
} from "../../../src/sources/semanticscholar/query";
import {
  clampRecommendLimit,
  identifierKeys,
  isResponseTooLarge,
  parseRecommendationsBody,
  RECOMMEND_MAX_POSITIVES,
  recommendFieldsFor,
  SEMANTICSCHOLAR_RECOMMEND_FIELDS,
  SEMANTICSCHOLAR_RECOMMEND_FIELDS_NO_ABSTRACT,
  SEMANTICSCHOLAR_RECOMMEND_FROM,
  SEMANTICSCHOLAR_SEED_CHECK_FIELDS,
} from "../../../src/sources/semanticscholar/recommendations";
import {
  createSemanticScholarSource,
  SEMANTICSCHOLAR_API_KEY_HEADER,
  SEMANTICSCHOLAR_NO_KEY_WARNING,
  SEMANTICSCHOLAR_SECRET_ID,
  type SemanticScholarSource,
  type SemanticScholarSourceDeps,
} from "../../../src/sources/semanticscholar/semanticscholarSource";
import type { SourceCallContext } from "../../../src/sources/types";
import { relatedFixtureDirFor } from "../../../scripts/record-fixtures";
import {
  createReplayHttpClient,
  nodeFixtureIo,
  type RecordedExchange,
} from "../../contract/_transport";
import {
  createMultiHostReplayHttpClient,
  readScenarioExchange,
} from "../../support/fixtureReplay";
import {
  SEMANTICSCHOLAR_RECOMMEND_NEGATIVES,
  SEMANTICSCHOLAR_RECOMMEND_POSITIVES,
  SEMANTICSCHOLAR_RELATED_LIMIT as LIMIT,
  SEMANTICSCHOLAR_RELATED_SEED,
  SEMANTICSCHOLAR_RELATED_SECOND_ID,
  SEMANTICSCHOLAR_RELATED_UNKNOWN_ID,
} from "../../support/semanticscholarRecordedRequests";

const NOW = 1_700_000_000_000;
const DIR = relatedFixtureDirFor("semanticscholar");
const SEARCH_DIR = dirname(DIR);
const FAKE_KEY = "fake-s2-key";
const URL_IN_ERRORS =
  "https://api.semanticscholar.org/recommendations/v1/papers/";

const doi = (value: string) => ({ doi: value }) as Partial<ExternalIds>;
const SEED_DOI = SEMANTICSCHOLAR_RELATED_SEED.slice("DOI:".length);
const SEED = doi(SEED_DOI);
const SEED_PMID = {
  pmid: SEMANTICSCHOLAR_RECOMMEND_POSITIVES[1]?.slice("PMID:".length),
} as Partial<ExternalIds>;
const SECOND = {
  arxivId: SEMANTICSCHOLAR_RELATED_SECOND_ID.slice("ARXIV:".length),
} as Partial<ExternalIds>;
const UNKNOWN = doi(SEMANTICSCHOLAR_RELATED_UNKNOWN_ID.slice("DOI:".length));

function ctx(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

function secretsHolding(value: string | undefined): SecretStore & {
  readonly reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    backend: "os-keychain",
    unattended: true,
    get(id) {
      reads.push(id);
      return Promise.resolve(
        id === SEMANTICSCHOLAR_SECRET_ID ? value : undefined,
      );
    },
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    has: () => Promise.resolve(value !== undefined),
    listStoredIds: () => Promise.resolve([]),
    clearAll: () => Promise.resolve(0),
  };
}

function sourceOver(
  http: HttpClient,
  overrides: Partial<SemanticScholarSourceDeps> = {},
): SemanticScholarSource {
  const clock = createManualClock(NOW);
  return createSemanticScholarSource({
    http,
    clock,
    mapRecords: createSemanticScholarRecordMapper({ clock }),
    secrets: secretsHolding(FAKE_KEY),
    ...overrides,
  });
}

const exchangeOf = (scenario: string): Promise<RecordedExchange> =>
  readScenarioExchange(DIR, scenario, nodeFixtureIo);

const ok = (body: unknown): RecordedExchange => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * The shipped client over the fixtures, with the validation batch and the POST
 * answerable by hand. `undefined` for either replays from the fixture directory.
 */
function routed(answers: {
  readonly batch?: RecordedExchange;
  readonly post?: (attempt: number) => RecordedExchange | undefined;
}) {
  let posts = 0;
  const replay = createMultiHostReplayHttpClient({
    routes: [{ host: SEMANTICSCHOLAR_HOST, dirs: [DIR] }],
    io: nodeFixtureIo,
    answerFor: (_host, request) => {
      if (request.url.startsWith(SEMANTICSCHOLAR_BATCH_URL)) {
        return answers.batch;
      }
      posts += 1;
      return answers.post?.(posts);
    },
  });
  const calls = () => replay.transport.calls;
  const batches = () =>
    calls().filter((c) => c.url.startsWith(SEMANTICSCHOLAR_BATCH_URL));
  const recommendations = () =>
    calls().filter((c) => !c.url.startsWith(SEMANTICSCHOLAR_BATCH_URL));
  return {
    ...replay,
    batches,
    recommendations,
    source: sourceOver(replay.client),
  };
}

/** A client answering 200 with `body`, recording each address. */
function canned(body: unknown): {
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
        body: JSON.stringify(body),
        rawHeaders: "",
        header: () => undefined,
      });
    },
  };
  return { client, urls };
}

interface RawPaper {
  readonly paperId?: unknown;
}

/** `batch-unresolvable`'s rows: a paper, a null, a paper. */
async function validationRows(): Promise<{
  readonly found: { readonly paperId: string; readonly externalIds: object };
  readonly missing: null;
}> {
  const rows = JSON.parse((await exchangeOf("batch-unresolvable")).body) as [
    { paperId: string; externalIds: object },
    null,
  ];
  return { found: rows[0], missing: rows[1] };
}

/** One resolving row per id, a `null` at each of `bad`, shaped like the fixture's. */
async function validationFor(
  count: number,
  bad: readonly number[] = [],
): Promise<RecordedExchange> {
  const { found, missing } = await validationRows();
  return ok(
    Array.from({ length: count }, (_, index) =>
      bad.includes(index)
        ? missing
        : { ...found, paperId: `paper${String(index)}`, externalIds: {} },
    ),
  );
}

function bodyOf(call: { readonly options: { readonly body?: unknown } }): {
  readonly positivePaperIds: readonly string[];
  readonly negativePaperIds: readonly string[];
} {
  return JSON.parse(String(call.options.body)) as {
    positivePaperIds: readonly string[];
    negativePaperIds: readonly string[];
  };
}

const limitOf = (url: string | undefined): string | null =>
  new URL(url ?? "").searchParams.get("limit");
const fieldsOf = (url: string | undefined): readonly string[] =>
  (new URL(url ?? "").searchParams.get("fields") ?? "").split(",");

const tenSeeds = Array.from({ length: 10 }, (_, index) =>
  doi(`10.1234/seed-${String(index)}`),
);
const prefixed = (index: number) => `DOI:10.1234/seed-${String(index)}`;

describe("P5-T06: findRelated, one seed through forpaper", () => {
  for (const strategy of ["recommendations", "auto", undefined] as const) {
    it(`strategy ${String(strategy)}: reads the forpaper fixture into ranked recommendation edges`, async () => {
      const raw = JSON.parse((await exchangeOf("forpaper")).body) as {
        recommendedPapers: readonly RawPaper[];
      };
      const expected = raw.recommendedPapers.map((p) => p.paperId);
      expect(expected.length).toBeGreaterThan(0);

      const replay = createReplayHttpClient({
        dir: DIR,
        host: SEMANTICSCHOLAR_HOST,
      });
      const page = await sourceOver(replay.client).findRelated(
        {
          ids: SEED,
          limit: LIMIT,
          ...(strategy !== undefined && { strategy }),
        },
        ctx(),
      );

      expect(page.records.map((r) => r.nativeId)).toEqual(expected);
      expect(page.edges).toEqual(
        expected.map((_, index) => ({
          kind: "recommendation",
          rank: index + 1,
        })),
      );
      expect(page.nextCursor).toBeUndefined();
      expect(page.totalAvailable).toBeUndefined();
      const [call] = replay.transport.calls;
      expect(replay.transport.calls).toHaveLength(1);
      expect(call?.method).toBe("GET");
      expect(new URL(call?.url ?? "").searchParams.get("from")).toBe(
        SEMANTICSCHOLAR_RECOMMEND_FROM,
      );
      expect(SEMANTICSCHOLAR_RECOMMEND_FROM).toBe("recent");
      expect(call?.url).not.toContain("all-cs");
      expect(call?.options.headers?.[SEMANTICSCHOLAR_API_KEY_HEADER]).toBe(
        FAKE_KEY,
      );
      expect(call?.url).not.toContain(FAKE_KEY);
    });
  }

  it.each([
    [100, 100, true],
    [101, 101, false],
    [200, 200, false],
    [500, 500, false],
    [501, 500, false],
    [9000, 500, false],
    [20.7, 20, true],
  ])(
    "limit %s is sent as %s, with abstract requested: %s",
    async (asked, sent, withAbstract) => {
      const { client, urls } = canned({ recommendedPapers: [] });
      await sourceOver(client).findRelated(
        { ids: SEED, limit: asked, strategy: "recommendations" },
        ctx(),
      );
      expect(limitOf(urls[0])).toBe(String(sent));
      expect(fieldsOf(urls[0]).includes("abstract")).toBe(withAbstract);
    },
  );

  it.each([[0], [0.4], [-1], [Number.NaN]])(
    "limit %s asks for nothing and sends nothing",
    async (asked) => {
      const { client, urls } = canned({ recommendedPapers: [] });
      const page = await sourceOver(client).findRelated(
        { ids: SEED, limit: asked, strategy: "recommendations" },
        ctx(),
      );
      expect(urls).toEqual([]);
      expect(page.records).toEqual([]);
      expect(page.warnings).toEqual([]);
    },
  );

  it("sends the seed in the address", async () => {
    const { client, urls } = canned({ recommendedPapers: [] });
    await sourceOver(client).findRelated(
      { ids: SEED, limit: 5, strategy: "recommendations" },
      ctx(),
    );
    expect(urls[0]).toContain(encodePaperId(SEMANTICSCHOLAR_RELATED_SEED));
  });

  it("filters the seed out by any identifier it shares, and ranks what remains without a gap", async () => {
    const { client } = canned({
      recommendedPapers: [
        { paperId: "a", externalIds: { DOI: "10.1/a" } },
        // The same DOI in the other case: a DOI's case is not significant.
        { paperId: "seed", externalIds: { DOI: SEED_DOI.toUpperCase() } },
        { paperId: "b", externalIds: {} },
        { paperId: "seed2", externalIds: { PubMed: "37258680" } },
        { paperId: "c" },
      ],
    });
    const page = await sourceOver(client).findRelated(
      {
        ids: { ...SEED, ...SEED_PMID },
        limit: LIMIT,
        strategy: "recommendations",
      },
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["a", "b", "c"]);
    expect(page.edges.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(page.warnings).toEqual([]);
  });

  it("a short list is normal: no warning; an empty one too", async () => {
    for (const papers of [[{ paperId: "a" }], []]) {
      const { client } = canned({ recommendedPapers: papers });
      const page = await sourceOver(client).findRelated(
        { ids: SEED, limit: 100, strategy: "recommendations" },
        ctx(),
      );
      expect(page.records).toHaveLength(papers.length);
      expect(page.warnings).toEqual([]);
    }
  });

  it("a row with no paper id is left out and counted, and its place still counts", async () => {
    const { client } = canned({
      recommendedPapers: [{ title: "no id" }, null, { paperId: "kept" }],
    });
    const page = await sourceOver(client).findRelated(
      { ids: SEED, limit: LIMIT, strategy: "recommendations" },
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["kept"]);
    expect(page.edges.map((e) => e.rank)).toEqual([3]);
    expect(page.warnings).toEqual([
      "Semantic Scholar: 2 row(s) of the recommendations had no paper id and were left out.",
    ]);
  });

  it("fromDate is applied here, never sent (pitfall 3), and an undated record stays", async () => {
    const { client, urls } = canned({
      recommendedPapers: [
        { paperId: "old", year: 2020 },
        { paperId: "undated" },
        { paperId: "same", year: 2024 },
        { paperId: "new", year: 2025 },
      ],
    });
    const page = await sourceOver(client).findRelated(
      {
        ids: SEED,
        limit: LIMIT,
        strategy: "recommendations",
        fromDate: "2024-01-01",
      },
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual([
      "undated",
      "same",
      "new",
    ]);
    expect(page.edges.map((e) => e.rank)).toEqual([2, 3, 4]);
    expect(urls[0]).not.toContain("2024");
  });

  it("without a key it sends nothing, and says why", async () => {
    const { client, urls } = canned({ recommendedPapers: [] });
    const page = await sourceOver(client, {
      secrets: secretsHolding(undefined),
    }).findRelated(
      { ids: SEED, limit: LIMIT, strategy: "recommendations" },
      ctx(),
    );
    expect(urls).toEqual([]);
    expect(page.warnings).toEqual([SEMANTICSCHOLAR_NO_KEY_WARNING]);
  });

  it("an unindexed seed is the 404 that means 'not indexed', unwrapped", async () => {
    const exchange = await exchangeOf("seed-not-found");
    const { source } = routed({ post: () => exchange });
    const refused = await source
      .findRelated(
        { ids: UNKNOWN, limit: LIMIT, strategy: "recommendations" },
        ctx(),
      )
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BadRequestError);
    expect((refused as BadRequestError).httpStatus).toBe(404);
  });

  it("the size cap is retried once at half the limit here too, with a warning", async () => {
    const cap = await exchangeOf("recommend-size-cap");
    const replay = routed({
      post: (attempt) =>
        attempt === 1 ? cap : ok({ recommendedPapers: [{ paperId: "a" }] }),
    });
    const page = await replay.source.findRelated(
      { ids: SEED, limit: 80, strategy: "recommendations" },
      ctx(),
    );
    expect(replay.recommendations().map((c) => limitOf(c.url))).toEqual([
      "80",
      "40",
    ]);
    expect(page.records).toHaveLength(1);
    expect(page.warnings).toHaveLength(1);
  });
});

describe("P5-T06: recommend, many seeds", () => {
  it("Done when: one bad seed among ten does not fail the POST", async () => {
    const postAnswer = await exchangeOf("recommend-post");
    const raw = JSON.parse(postAnswer.body) as {
      recommendedPapers: readonly RawPaper[];
    };
    const replay = routed({
      batch: await validationFor(10, [4]),
      post: () => postAnswer,
    });

    const page = await replay.source.recommend(tenSeeds, [], LIMIT, ctx());

    expect(replay.batches()).toHaveLength(1);
    expect(replay.recommendations()).toHaveLength(1);
    const sent = bodyOf(replay.recommendations()[0] ?? { options: {} });
    expect(sent.positivePaperIds).toHaveLength(9);
    expect(sent.positivePaperIds).not.toContain(prefixed(4));
    expect(sent.positivePaperIds[4]).toBe(prefixed(5));
    expect(sent.negativePaperIds).toEqual([]);
    expect(page.records.map((r) => r.nativeId)).toEqual(
      raw.recommendedPapers.map((p) => p.paperId),
    );
    expect(page.edges).toEqual(
      raw.recommendedPapers.map((_, index) => ({
        kind: "recommendation",
        rank: index + 1,
      })),
    );
    expect(page.warnings).toEqual([
      "Semantic Scholar: 1 example paper(s) could not be resolved and were left out of the recommendation request.",
    ]);
  });

  it("validates positives and negatives together in one batch, and sends limit and fields in the address and the ids in the body", async () => {
    const replay = routed({
      batch: await validationFor(3),
      post: () => ok({ recommendedPapers: [] }),
    });
    await replay.source.recommend([SEED, SEED_PMID], [SECOND], LIMIT, ctx());
    const [batch] = replay.batches();
    expect(replay.batches()).toHaveLength(1);
    expect(batch?.method).toBe("POST");
    expect(JSON.parse(String(batch?.options.body))).toEqual({
      ids: [
        ...SEMANTICSCHOLAR_RECOMMEND_POSITIVES,
        ...SEMANTICSCHOLAR_RECOMMEND_NEGATIVES,
      ],
    });
    expect(fieldsOf(batch?.url)).toEqual(SEMANTICSCHOLAR_SEED_CHECK_FIELDS);
    expect(batch?.options.headers?.[SEMANTICSCHOLAR_API_KEY_HEADER]).toBe(
      FAKE_KEY,
    );

    const [post] = replay.recommendations();
    expect(post?.method).toBe("POST");
    expect(limitOf(post?.url)).toBe(String(LIMIT));
    expect(fieldsOf(post?.url)).toEqual(SEMANTICSCHOLAR_RECOMMEND_FIELDS);
    expect(post?.url).not.toContain("10.1038");
    expect(post?.url).not.toContain(FAKE_KEY);
    expect(bodyOf(post ?? { options: {} })).toEqual({
      positivePaperIds: SEMANTICSCHOLAR_RECOMMEND_POSITIVES,
      negativePaperIds: SEMANTICSCHOLAR_RECOMMEND_NEGATIVES,
    });
    expect(post?.options.headers?.[SEMANTICSCHOLAR_API_KEY_HEADER]).toBe(
      FAKE_KEY,
    );
  });

  it("reads the batch-unresolvable fixture as the validation of its own ids: a positive drops, a negative stays", async () => {
    const replay = routed({ post: () => ok({ recommendedPapers: [] }) });
    const page = await replay.source.recommend(
      [SEED, UNKNOWN],
      [SECOND],
      LIMIT,
      ctx(),
    );
    expect(replay.batches()[0]?.fixture).toContain(DIR.split(/[\\/]/u).pop());
    expect(bodyOf(replay.recommendations()[0] ?? { options: {} })).toEqual({
      positivePaperIds: [SEMANTICSCHOLAR_RELATED_SEED],
      negativePaperIds: [SEMANTICSCHOLAR_RELATED_SECOND_ID],
    });
    expect(page.warnings).toHaveLength(1);
  });

  it("a bad negative is dropped from the body, and counted", async () => {
    const replay = routed({
      batch: await validationFor(3, [1]),
      post: () => ok({ recommendedPapers: [] }),
    });
    const page = await replay.source.recommend(
      [doi("10.1/p")],
      [doi("10.1/bad"), doi("10.1/good")],
      LIMIT,
      ctx(),
    );
    expect(bodyOf(replay.recommendations()[0] ?? { options: {} })).toEqual({
      positivePaperIds: ["DOI:10.1/p"],
      negativePaperIds: ["DOI:10.1/good"],
    });
    expect(page.warnings).toEqual([
      "Semantic Scholar: 1 example paper(s) could not be resolved and were left out of the recommendation request.",
    ]);
  });

  it("the cap of 15 applies after validation, so a bad seed does not use up a place", async () => {
    expect(RECOMMEND_MAX_POSITIVES).toBe(15);
    const seventeen = Array.from({ length: 17 }, (_, index) =>
      doi(`10.1234/seed-${String(index)}`),
    );
    const replay = routed({
      batch: await validationFor(17, [0, 3]),
      post: () => ok({ recommendedPapers: [] }),
    });
    const page = await replay.source.recommend(seventeen, [], LIMIT, ctx());
    const batchBody = JSON.parse(String(replay.batches()[0]?.options.body)) as {
      ids: readonly string[];
    };
    expect(batchBody.ids).toHaveLength(17);
    const sent = bodyOf(replay.recommendations()[0] ?? { options: {} });
    expect(sent.positivePaperIds).toEqual(
      seventeen.map((_, i) => prefixed(i)).filter((_, i) => i !== 0 && i !== 3),
    );
    expect(page.warnings).toEqual([
      "Semantic Scholar: 2 example paper(s) could not be resolved and were left out of the recommendation request.",
    ]);
  });

  it("more usable positives than the cap: the first 15 go, and a warning says so", async () => {
    const twenty = Array.from({ length: 20 }, (_, index) =>
      doi(`10.1234/seed-${String(index)}`),
    );
    const replay = routed({
      batch: await validationFor(20),
      post: () => ok({ recommendedPapers: [] }),
    });
    const page = await replay.source.recommend(twenty, [], LIMIT, ctx());
    const sent = bodyOf(replay.recommendations()[0] ?? { options: {} });
    expect(sent.positivePaperIds).toEqual(
      twenty.slice(0, 15).map((_, i) => prefixed(i)),
    );
    expect(page.warnings).toEqual([
      "Semantic Scholar: 20 example papers were usable and the first 15 were sent.",
    ]);
  });

  it("exactly the cap carries no warning", async () => {
    const fifteen = Array.from({ length: 15 }, (_, index) =>
      doi(`10.1234/seed-${String(index)}`),
    );
    const replay = routed({
      batch: await validationFor(15),
      post: () => ok({ recommendedPapers: [] }),
    });
    const page = await replay.source.recommend(fifteen, [], LIMIT, ctx());
    expect(
      bodyOf(replay.recommendations()[0] ?? { options: {} }).positivePaperIds,
    ).toHaveLength(15);
    expect(page.warnings).toEqual([]);
  });

  it("no positive resolving is the 404 that means 'not indexed', and no POST", async () => {
    const replay = routed({ batch: await validationFor(2, [0, 1]) });
    const refused = await replay.source
      .recommend([SEED, UNKNOWN], [], LIMIT, ctx())
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BadRequestError);
    expect((refused as BadRequestError).httpStatus).toBe(404);
    expect((refused as BadRequestError).context.seedNotIndexed).toBe(true);
    expect(replay.recommendations()).toEqual([]);
  });

  it("only negatives resolving is that same 404, and no POST", async () => {
    const replay = routed({ batch: await validationFor(2, [0]) });
    const refused = await replay.source
      .recommend([UNKNOWN], [SECOND], LIMIT, ctx())
      .catch((error: unknown) => error);
    expect((refused as BadRequestError).httpStatus).toBe(404);
    expect(replay.recommendations()).toEqual([]);
  });

  it("the batch's own 'No valid paper ids given' (measured 2026-10-15) is that same 404, and no POST", async () => {
    const replay = routed({
      batch: await readScenarioExchange(
        SEARCH_DIR,
        "record-jats-abstract",
        nodeFixtureIo,
      ),
    });
    const refused = await replay.source
      .recommend([SEED], [], LIMIT, ctx())
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BadRequestError);
    expect((refused as BadRequestError).httpStatus).toBe(404);
    expect(replay.batches()).toHaveLength(1);
    expect(replay.recommendations()).toEqual([]);
  });

  it("any other batch 400 propagates as itself", async () => {
    const replay = routed({
      batch: await exchangeOf("citations-unknown-field"),
    });
    const refused = await replay.source
      .recommend([SEED], [], LIMIT, ctx())
      .catch((error: unknown) => error);
    expect((refused as BadRequestError).httpStatus).toBe(400);
    expect(replay.recommendations()).toEqual([]);
  });

  it("a batch 404 is not read as 'no valid ids': it propagates with no seedNotIndexed flag", async () => {
    const replay = routed({
      batch: {
        status: 404,
        headers: {},
        body: '{"error":"No valid paper ids given"}',
      },
    });
    const refused = await replay.source
      .recommend([SEED], [], LIMIT, ctx())
      .catch((error: unknown) => error);
    expect((refused as BadRequestError).httpStatus).toBe(404);
    expect((refused as BadRequestError).context.seedNotIndexed).toBeUndefined();
  });

  it("no positive with an identifier is an empty page with a warning and no request", async () => {
    const replay = routed({});
    const page = await replay.source.recommend(
      [{}, {}],
      [SECOND],
      LIMIT,
      ctx(),
    );
    expect(replay.transport.calls).toEqual([]);
    expect(page.records).toEqual([]);
    expect(page.edges).toEqual([]);
    expect(page.warnings).toHaveLength(1);
    expect(page.warnings[0]).toMatch(/none was given/u);
  });

  it("entries with no identifier are counted in the warning, on both sides", async () => {
    const replay = routed({
      batch: await validationFor(2),
      post: () => ok({ recommendedPapers: [] }),
    });
    const page = await replay.source.recommend(
      [SEED, {}],
      [SECOND, {}],
      LIMIT,
      ctx(),
    );
    expect(page.warnings).toEqual([
      "Semantic Scholar: 2 example paper(s) could not be resolved and were left out of the recommendation request.",
    ]);
  });

  it("the same id twice goes once; an id on both sides stays a positive", async () => {
    const replay = routed({
      batch: await validationFor(2),
      post: () => ok({ recommendedPapers: [] }),
    });
    await replay.source.recommend(
      [SEED, SEED, doi("10.1/other")],
      [SEED, doi("10.1/other")],
      LIMIT,
      ctx(),
    );
    expect(JSON.parse(String(replay.batches()[0]?.options.body))).toEqual({
      ids: [SEMANTICSCHOLAR_RELATED_SEED, "DOI:10.1/other"],
    });
    expect(bodyOf(replay.recommendations()[0] ?? { options: {} })).toEqual({
      positivePaperIds: [SEMANTICSCHOLAR_RELATED_SEED, "DOI:10.1/other"],
      negativePaperIds: [],
    });
  });

  it("without a key it sends nothing, and says why; the key is read once per call", async () => {
    const without = secretsHolding(undefined);
    const stub = canned({ recommendedPapers: [] });
    const page = await sourceOver(stub.client, {
      secrets: without,
    }).recommend([SEED], [], LIMIT, ctx());
    expect(stub.urls).toEqual([]);
    expect(page.warnings).toEqual([SEMANTICSCHOLAR_NO_KEY_WARNING]);

    const held = secretsHolding(FAKE_KEY);
    const replay = routed({
      batch: await validationFor(1),
      post: () => ok({ recommendedPapers: [] }),
    });
    await sourceOver(replay.client, { secrets: held }).recommend(
      [SEED],
      [],
      LIMIT,
      ctx(),
    );
    expect(held.reads).toEqual([SEMANTICSCHOLAR_SECRET_ID]);
  });

  it.each([[0], [-2], [Number.NaN]])(
    "limit %s asks for nothing and sends nothing",
    async (limit) => {
      const replay = routed({});
      const page = await replay.source.recommend([SEED], [], limit, ctx());
      expect(replay.transport.calls).toEqual([]);
      expect(page.records).toEqual([]);
      expect(page.warnings).toEqual([]);
    },
  );

  it("more ids than one batch takes is RangeError, before any request", async () => {
    const tooMany = Array.from(
      { length: SEMANTICSCHOLAR_BATCH_IDS_MAX + 1 },
      (_, index) => doi(`10.1234/seed-${String(index)}`),
    );
    const replay = routed({});
    await expect(
      replay.source.recommend(tooMany, [], LIMIT, ctx()),
    ).rejects.toBeInstanceOf(RangeError);
    expect(replay.transport.calls).toEqual([]);
  });

  it("filters every seed out of the answer: paper id, input identifier, batch's identifier, negatives too", async () => {
    const { found } = await validationRows();
    const replay = routed({
      batch: ok([
        {
          ...found,
          paperId: "POSITIVESHA",
          externalIds: { PubMed: "111", DOI: "10.1234/pos" },
        },
        { ...found, paperId: "negativesha", externalIds: {} },
      ]),
      post: () =>
        ok({
          recommendedPapers: [
            { paperId: "a" },
            { paperId: "positivesha" },
            { paperId: "b" },
            { paperId: "NEGATIVESHA" },
            { paperId: "byinput", externalIds: { DOI: "10.1234/POS" } },
            { paperId: "bybatch", externalIds: { PubMed: "111" } },
            { paperId: "bynegative", externalIds: { DOI: "10.1234/neg" } },
            { paperId: "c" },
          ],
        }),
    });
    const page = await replay.source.recommend(
      [doi("10.1234/pos")],
      [doi("10.1234/neg")],
      LIMIT,
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["a", "b", "c"]);
    expect(page.edges.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("a positive dropped by validation is still filtered out of the answer", async () => {
    const replay = routed({
      batch: await validationFor(2, [1]),
      post: () =>
        ok({
          recommendedPapers: [
            { paperId: "x", externalIds: { DOI: "10.1234/dropped" } },
            { paperId: "y" },
          ],
        }),
    });
    const page = await replay.source.recommend(
      [doi("10.1/kept"), doi("10.1234/dropped")],
      [],
      LIMIT,
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["y"]);
  });

  it("a short list is normal: no warning", async () => {
    const replay = routed({
      batch: await validationFor(1),
      post: () => ok({ recommendedPapers: [{ paperId: "only" }] }),
    });
    const page = await replay.source.recommend([SEED], [], 100, ctx());
    expect(page.records).toHaveLength(1);
    expect(page.warnings).toEqual([]);
  });

  it("Done when: the size-cap fixture at twice the limit is retried once, and lands on recommend-post", async () => {
    const raw = JSON.parse((await exchangeOf("recommend-post")).body) as {
      recommendedPapers: readonly RawPaper[];
    };
    // Both POSTs replay from disk, so the keys prove the exact requests.
    const replay = routed({ batch: await validationFor(3) });
    const page = await replay.source.recommend(
      [SEED, SEED_PMID],
      [SECOND],
      2 * LIMIT,
      ctx(),
    );
    expect(replay.recommendations().map((c) => limitOf(c.url))).toEqual([
      String(2 * LIMIT),
      String(LIMIT),
    ]);
    expect(page.records.map((r) => r.nativeId)).toEqual(
      raw.recommendedPapers.map((p) => p.paperId),
    );
    expect(page.warnings).toEqual([
      `Semantic Scholar refused ${String(2 * LIMIT)} recommendations as too large a response, so ${String(LIMIT)} were asked for instead.`,
    ]);
  });

  it("Done when: a second refusal is reported, after exactly two POSTs", async () => {
    const cap = await exchangeOf("recommend-size-cap");
    const replay = routed({
      batch: await validationFor(1),
      post: () => cap,
    });
    const refused = await replay.source
      .recommend([SEED], [], 41, ctx())
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BadRequestError);
    expect((refused as BadRequestError).httpStatus).toBe(400);
    expect(isResponseTooLarge(refused)).toBe(true);
    expect(replay.recommendations().map((c) => limitOf(c.url))).toEqual([
      "41",
      "20",
    ]);
    expect(replay.batches()).toHaveLength(1);
  });

  it("a limit of 1 has no half to retry at", async () => {
    const cap = await exchangeOf("recommend-size-cap");
    const replay = routed({ batch: await validationFor(1), post: () => cap });
    await expect(
      replay.source.recommend([SEED], [], 1, ctx()),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(replay.recommendations()).toHaveLength(1);
  });

  it("a limit of 2 retries at 1", async () => {
    const cap = await exchangeOf("recommend-size-cap");
    const replay = routed({
      batch: await validationFor(1),
      post: (attempt) => (attempt === 1 ? cap : ok({ recommendedPapers: [] })),
    });
    await replay.source.recommend([SEED], [], 2, ctx());
    expect(replay.recommendations().map((c) => limitOf(c.url))).toEqual([
      "2",
      "1",
    ]);
  });

  it("a retry keeps the fields it started with", async () => {
    const cap = await exchangeOf("recommend-size-cap");
    const replay = routed({
      batch: await validationFor(1),
      post: (attempt) => (attempt === 1 ? cap : ok({ recommendedPapers: [] })),
    });
    await replay.source.recommend([SEED], [], 150, ctx());
    const [first, second] = replay.recommendations();
    expect(limitOf(second?.url)).toBe("75");
    expect(fieldsOf(first?.url)).toEqual(
      SEMANTICSCHOLAR_RECOMMEND_FIELDS_NO_ABSTRACT,
    );
    expect(fieldsOf(second?.url)).toEqual(
      SEMANTICSCHOLAR_RECOMMEND_FIELDS_NO_ABSTRACT,
    );
  });

  it("a 400 that is not the size cap is not retried", async () => {
    const other = await exchangeOf("citations-unknown-field");
    const replay = routed({
      batch: await validationFor(1),
      post: () => other,
    });
    await expect(
      replay.source.recommend([SEED], [], 40, ctx()),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(replay.recommendations()).toHaveLength(1);
  });

  it("a cancelled token stops it before any request", async () => {
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    const replay = routed({});
    await expect(
      replay.source.recommend([SEED], [], LIMIT, { token: tokens.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(replay.transport.calls).toEqual([]);
  });

  it("a token already cancelled does not even read the key", async () => {
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    const secrets = secretsHolding(FAKE_KEY);
    const replay = routed({});
    await expect(
      sourceOver(replay.client, { secrets }).recommend([SEED], [], LIMIT, {
        token: tokens.token,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(secrets.reads).toEqual([]);
  });
});

describe("P5-T06: the rules beside the builders", () => {
  it("clampRecommendLimit: docs/05 §3.3's 500, whole numbers, and 0 for nonsense", () => {
    expect(clampRecommendLimit(500)).toBe(500);
    expect(clampRecommendLimit(501)).toBe(500);
    expect(clampRecommendLimit(3.9)).toBe(3);
    expect(clampRecommendLimit(-1)).toBe(0);
    expect(clampRecommendLimit(Number.NaN)).toBe(0);
    expect(clampRecommendLimit(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("recommendFieldsFor: abstract at or under 100 only", () => {
    expect(recommendFieldsFor(100)).toEqual(SEMANTICSCHOLAR_RECOMMEND_FIELDS);
    expect(recommendFieldsFor(101)).toEqual(
      SEMANTICSCHOLAR_RECOMMEND_FIELDS_NO_ABSTRACT,
    );
    expect(SEMANTICSCHOLAR_RECOMMEND_FIELDS).toContain("abstract");
    expect(SEMANTICSCHOLAR_RECOMMEND_FIELDS_NO_ABSTRACT).not.toContain(
      "abstract",
    );
  });

  it("isResponseTooLarge: a 400 holding the documented opening, and nothing else", () => {
    const with400 = (body: string, status = 400) =>
      new BadRequestError(status, "refused", { body });
    expect(
      isResponseTooLarge(
        with400(
          '{"error":"Response would exceed maximum size of 10MB, sorry"}',
        ),
      ),
    ).toBe(true);
    expect(isResponseTooLarge(with400('{"error":"Other"}'))).toBe(false);
    expect(
      isResponseTooLarge(
        with400('{"error":"Response would exceed maximum size"}', 404),
      ),
    ).toBe(false);
    expect(
      isResponseTooLarge({
        httpStatus: 400,
        body: "Response would exceed maximum size",
      }),
    ).toBe(false);
    expect(isResponseTooLarge(new BadRequestError(400, "no body", {}))).toBe(
      false,
    );
    expect(
      isResponseTooLarge(new Error("Response would exceed maximum size")),
    ).toBe(false);
  });

  it.each([
    ["not JSON", "<html>", ParseError],
    ["no such member", "{}", ParseError],
    ["member not a list", '{"recommendedPapers":{}}', ParseError],
    ["null", "null", ParseError],
    ["a bare list", "[]", ParseError],
    ["the error envelope", '{"error":"boom"}', SourceError],
  ])("parseRecommendationsBody: %s throws", (_, body, thrown) => {
    expect(() => parseRecommendationsBody(body, URL_IN_ERRORS)).toThrow(thrown);
  });

  it("parseRecommendationsBody: an empty list is no error", () => {
    expect(
      parseRecommendationsBody('{"recommendedPapers":[]}', URL_IN_ERRORS),
    ).toEqual([]);
  });

  it("identifierKeys: one lowercase tagged string per identifier present", () => {
    expect(
      identifierKeys({
        doi: "10.1/ABC",
        pmid: "1",
        pmcid: "PMC2",
        arxivId: "2106.15928",
        s2CorpusId: "99",
      } as unknown as Partial<ExternalIds>),
    ).toEqual([
      "doi:10.1/abc",
      "pmid:1",
      "pmcid:pmc2",
      "arxiv:2106.15928",
      "corpus:99",
    ]);
    expect(identifierKeys({})).toEqual([]);
  });
});
