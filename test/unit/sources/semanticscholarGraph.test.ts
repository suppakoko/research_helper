/**
 * `P5-T05`: Semantic Scholar's references, citations and title match.
 *
 * **The fixtures in `test/fixtures/semanticscholar/related/` are stand-ins until
 * `P5-T31`** (`plan/00` §6 item 335(a)): hand-written from `docs/02` §6 and `docs/05`
 * §2, each `"synthetic": true` with its reason. The owner's run overwrites them under
 * the same keys, so what these tests expect is computed from the fixture's own rows and
 * survives the replacement. Passing here proves the adapter reads the *documented*
 * shapes; it says nothing about the service until then.
 *
 * Replay goes through the shipped `createHttpClient`, so every typed error is
 * production's. A missing fixture is an error naming the record command, never a call.
 */

import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  BadRequestError,
  OperationCancelledError,
  ParseError,
  RateLimitError,
  SourceError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type { HttpClient, HttpResponse } from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import { SEMANTICSCHOLAR_HOST } from "../../../src/core/rateLimit/hostLimiter";
import type { SecretStore } from "../../../src/core/secretStore";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { ExternalIds } from "../../../src/model/ids";
import {
  parseRelationBody,
  parseTitleMatchBody,
  SEMANTICSCHOLAR_RELATION_FIELDS,
  SEMANTICSCHOLAR_RELATION_LIMIT_MAX,
} from "../../../src/sources/semanticscholar/graph";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import {
  encodePaperId,
  SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT,
} from "../../../src/sources/semanticscholar/query";
import {
  clampRelationLimit,
  createSemanticScholarSource,
  SEMANTICSCHOLAR_API_KEY_HEADER,
  SEMANTICSCHOLAR_CAPABILITIES,
  SEMANTICSCHOLAR_NO_KEY_WARNING,
  SEMANTICSCHOLAR_SECRET_ID,
  SemanticScholarRateLimitError,
  type SemanticScholarSource,
  type SemanticScholarSourceDeps,
} from "../../../src/sources/semanticscholar/semanticscholarSource";
import type {
  RelatedQuery,
  SourceCallContext,
} from "../../../src/sources/types";
import {
  relatedFixtureDirFor,
  semanticscholarRelatedPlan,
} from "../../../scripts/record-fixtures";
import {
  createReplayHttpClient,
  fixtureKey,
  listFixtureMeta,
  nodeFixtureIo,
  type RecordedExchange,
} from "../../contract/_transport";
import {
  createMultiHostReplayHttpClient,
  readScenarioExchange,
} from "../../support/fixtureReplay";
import {
  SEMANTICSCHOLAR_RELATED_LIMIT as LIMIT,
  SEMANTICSCHOLAR_RELATED_SEED,
  SEMANTICSCHOLAR_RELATED_UNKNOWN_ID,
  SEMANTICSCHOLAR_TITLE_ABSENT as TITLE_ABSENT,
  SEMANTICSCHOLAR_TITLE_RICH as TITLE_RICH,
} from "../../support/semanticscholarRecordedRequests";

const NOW = 1_700_000_000_000;
const DIR = relatedFixtureDirFor("semanticscholar");
const SEARCH_DIR = dirname(DIR);
const FAKE_KEY = "fake-s2-key";
const URL_IN_ERRORS = "https://api.semanticscholar.org/graph/v1/paper/x";

const SEED = {
  doi: SEMANTICSCHOLAR_RELATED_SEED.slice("DOI:".length),
} as Partial<ExternalIds>;
const UNKNOWN = {
  doi: SEMANTICSCHOLAR_RELATED_UNKNOWN_ID.slice("DOI:".length),
} as Partial<ExternalIds>;

function ctx(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

/** A store holding `value`; `undefined` is a store holding no key. */
function secretsHolding(
  value: string | undefined,
  options: { readonly throwOnGet?: boolean } = {},
): SecretStore {
  return {
    backend: "os-keychain",
    unattended: true,
    get(id) {
      if (options.throwOnGet === true) {
        return Promise.reject(new Error("keystore down"));
      }
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

/** `null` for `secrets` builds the source with no store at all. */
type Overrides = Partial<Omit<SemanticScholarSourceDeps, "secrets">> & {
  readonly secrets?: SecretStore | null;
};

function sourceOver(
  http: HttpClient,
  overrides: Overrides = {},
): SemanticScholarSource {
  const clock = createManualClock(NOW);
  const { secrets = secretsHolding(FAKE_KEY), ...rest } = overrides;
  return createSemanticScholarSource({
    http,
    clock,
    mapRecords: createSemanticScholarRecordMapper({ clock }),
    ...(secrets !== null && { secrets }),
    ...rest,
  });
}

/** The shipped client over the fixtures. */
function replayed(overrides: Overrides = {}) {
  const replay = createReplayHttpClient({
    dir: DIR,
    host: SEMANTICSCHOLAR_HOST,
  });
  return { ...replay, source: sourceOver(replay.client, overrides) };
}

/** The shipped client, with this exchange answering every request. */
function answering(exchange: RecordedExchange) {
  const replay = createMultiHostReplayHttpClient({
    routes: [{ host: SEMANTICSCHOLAR_HOST, dirs: [DIR] }],
    io: nodeFixtureIo,
    answerFor: () => exchange,
  });
  return { ...replay, source: sourceOver(replay.client) };
}

/** A client answering 200 with `body`, recording each address. */
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

const exchangeOf = (scenario: string): Promise<RecordedExchange> =>
  readScenarioExchange(DIR, scenario, nodeFixtureIo);

interface RawPaper {
  readonly paperId?: unknown;
  readonly title?: unknown;
}

interface RawRow {
  readonly contexts?: readonly string[];
  readonly citedPaper?: RawPaper;
  readonly citingPaper?: RawPaper;
}

function fieldsOf(url: string): readonly string[] {
  return (new URL(url).searchParams.get("fields") ?? "").split(",");
}

describe("P5-T05: the stand-in fixtures", () => {
  const plan = semanticscholarRelatedPlan();
  const planned = [
    ...plan.independent(),
    ...plan.synthetic().map((fixture) => fixture.planned),
  ];

  it("each sits under the fixture key of the plan's scenario of that name", async () => {
    const loaded = await listFixtureMeta(DIR);
    expect(loaded.length).toBeGreaterThanOrEqual(10);
    for (const { key, meta } of loaded) {
      const scenario = planned.find((p) => p.scenario === meta.scenario);
      expect(scenario, meta.scenario).toBeDefined();
      expect(key, meta.scenario).toBe(
        fixtureKey({
          method: scenario?.method ?? "",
          url: scenario?.url ?? "",
          ...(scenario?.body !== undefined && { body: scenario.body }),
        }),
      );
    }
  });

  it("every scenario these two cards read has a fixture; only P5-T20's and P5-T04's two may be missing", async () => {
    const held = (await listFixtureMeta(DIR)).map((l) => l.meta.scenario);
    const missing = planned
      .map((p) => p.scenario)
      .filter((scenario) => !held.includes(scenario));
    for (const scenario of missing) {
      expect(["batch-embedding", "batch-references"]).toContain(scenario);
    }
  });

  it("a synthetic fixture says, in one line, that it is hand-written and which document it came from", async () => {
    for (const { meta } of await listFixtureMeta(DIR)) {
      // `P5-T31` turns these false one by one; a recorded one owes no reason.
      if (meta.synthetic !== true) continue;
      const reason = meta.syntheticReason ?? "";
      expect(reason, meta.scenario).not.toContain("\n");
      expect(reason, meta.scenario).toMatch(/^Hand-written, not recorded/u);
      expect(reason, meta.scenario).toContain("docs/");
    }
  });

  it("recommend-size-cap is byte for byte the plan's own hand-written entry, and stays synthetic", async () => {
    const [fixture] = plan.synthetic();
    const exchange = await exchangeOf("recommend-size-cap");
    expect(exchange.status).toBe(fixture?.exchange.status);
    expect(exchange.body).toBe(fixture?.exchange.body);
    const meta = (await listFixtureMeta(DIR)).find(
      (l) => l.meta.scenario === "recommend-size-cap",
    )?.meta;
    expect(meta?.synthetic).toBe(true);
    expect(meta?.syntheticReason).toBe(fixture?.reason);
  });
});

describe("P5-T05: findRelated, references and citations", () => {
  for (const [strategy, kind, member] of [
    ["references", "reference", "citedPaper"],
    ["citations", "citation", "citingPaper"],
  ] as const) {
    it(`${strategy}: reads the fixture, and each row's contexts.length survives into its edge`, async () => {
      const exchange = await exchangeOf(strategy);
      const rows = (JSON.parse(exchange.body) as { data: readonly RawRow[] })
        .data;
      const usable = rows.flatMap((row, index) =>
        typeof row[member]?.paperId === "string"
          ? [{ row, rank: index + 1, paperId: row[member]?.paperId }]
          : [],
      );
      expect(usable.length).toBeGreaterThan(0);

      const { source, transport } = replayed();
      const page = await source.findRelated(
        { ids: SEED, limit: LIMIT, strategy },
        ctx(),
      );

      expect(page.records.map((r) => r.nativeId)).toEqual(
        usable.map((u) => u.paperId),
      );
      expect(page.edges.map((e) => e.kind)).toEqual(usable.map(() => kind));
      expect(page.edges.map((e) => e.rank)).toEqual(usable.map((u) => u.rank));
      expect(page.edges.map((e) => e.contexts?.length)).toEqual(
        usable.map((u) => u.row.contexts?.length),
      );
      expect(page.edges.map((e) => e.contexts)).toEqual(
        usable.map((u) => u.row.contexts),
      );
      expect(page.nextCursor).toBeUndefined();
      expect(page.totalAvailable).toBeUndefined();
      expect(transport.calls).toHaveLength(1);
    });

    it(`${strategy}: sends the key as a header, never in the address, and never the nested selector`, async () => {
      const { source, transport } = replayed();
      await source.findRelated({ ids: SEED, limit: LIMIT, strategy }, ctx());
      const [call] = transport.calls;
      expect(call?.options.headers?.[SEMANTICSCHOLAR_API_KEY_HEADER]).toBe(
        FAKE_KEY,
      );
      expect(call?.url).not.toContain(FAKE_KEY);
      expect(fieldsOf(call?.url ?? "")).toEqual(
        SEMANTICSCHOLAR_RELATION_FIELDS,
      );
      for (const wanted of [
        "externalIds",
        "year",
        "title",
        "citationCount",
        "contexts",
        "intents",
        "isInfluential",
      ]) {
        expect(fieldsOf(call?.url ?? "")).toContain(wanted);
      }
      // `docs/05` §2.2: ignored silently, and the trap this card must not fall in.
      expect(call?.url).not.toMatch(/(?:citingPaper|citedPaper)\.references/u);
    });
  }

  it("a seed the service does not hold is the existing BadRequestError, status 404, after one request", async () => {
    const { source, transport } = replayed();
    const refused = await source
      .findRelated(
        { ids: UNKNOWN, limit: LIMIT, strategy: "references" },
        ctx(),
      )
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BadRequestError);
    expect((refused as BadRequestError).httpStatus).toBe(404);
    expect(transport.calls).toHaveLength(1);
  });

  it("a field error is the existing BadRequestError, status 400, with no retry", async () => {
    const { source, transport } = answering(
      await exchangeOf("citations-unknown-field"),
    );
    const refused = await source
      .findRelated({ ids: SEED, limit: LIMIT, strategy: "citations" }, ctx())
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BadRequestError);
    expect((refused as BadRequestError).httpStatus).toBe(400);
    expect(transport.calls).toHaveLength(1);
  });

  it("a 429 is the existing rate-limit class, with this adapter's remedy for a keyed request", async () => {
    const { source } = answering(
      await readScenarioExchange(SEARCH_DIR, "error-429", nodeFixtureIo),
    );
    const refused = await source
      .findRelated({ ids: SEED, limit: LIMIT, strategy: "citations" }, ctx())
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RateLimitError);
    expect(refused).toBeInstanceOf(SemanticScholarRateLimitError);
    expect((refused as SemanticScholarRateLimitError).keyed).toBe(true);
    expect((refused as Error).message).not.toContain(FAKE_KEY);
  });

  it("a 5xx is the existing server error class, unwrapped", async () => {
    const { source } = answering({ status: 500, headers: {}, body: "{}" });
    await expect(
      source.findRelated(
        { ids: SEED, limit: LIMIT, strategy: "references" },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(UpstreamServerError);
  });

  it.each([
    [5000, SEMANTICSCHOLAR_RELATION_LIMIT_MAX],
    [1000, 1000],
    [1001, 1000],
    [20, 20],
    [2.9, 2],
    [1, 1],
  ])("limit %s is sent as %s", async (asked, sent) => {
    const { client, urls } = canned('{"data":[]}');
    await sourceOver(client).findRelated(
      { ids: SEED, limit: asked, strategy: "references" },
      ctx(),
    );
    expect(new URL(urls[0] ?? "").searchParams.get("limit")).toBe(String(sent));
  });

  it.each([[0], [0.5], [-3], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "limit %s asks for nothing and sends nothing",
    async (asked) => {
      const { client, urls } = canned('{"data":[]}');
      const page = await sourceOver(client).findRelated(
        { ids: SEED, limit: asked, strategy: "citations" },
        ctx(),
      );
      expect(urls).toEqual([]);
      expect(page.records).toEqual([]);
      expect(page.edges).toEqual([]);
      expect(page.warnings).toEqual([]);
    },
  );

  it("clampRelationLimit: docs/05 §2.1's ceiling, whole numbers, and 0 for nonsense", () => {
    expect(SEMANTICSCHOLAR_RELATION_LIMIT_MAX).toBe(1000);
    expect(clampRelationLimit(1000.9)).toBe(1000);
    expect(clampRelationLimit(-1)).toBe(0);
    expect(clampRelationLimit(Number.NaN)).toBe(0);
    expect(clampRelationLimit(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("a seed with no usable identifier is an empty page with a warning and no request", async () => {
    for (const query of [
      { ids: {}, limit: LIMIT, strategy: "references" },
      { limit: LIMIT, strategy: "citations" },
      { limit: LIMIT, strategy: "recommendations" },
    ] satisfies RelatedQuery[]) {
      const { client, urls } = canned('{"data":[]}');
      const page = await sourceOver(client).findRelated(query, ctx());
      expect(urls).toEqual([]);
      expect(page.records).toEqual([]);
      expect(page.edges).toEqual([]);
      expect(page.warnings).toHaveLength(1);
      expect(page.warnings[0]).toMatch(/this seed has none/u);
    }
  });

  it("the seed is read from query.work, and query.ids wins over it", async () => {
    const work = {
      ids: { doi: "10.1234/from-work" },
    } as unknown as CanonicalWork;
    const { client, urls } = canned('{"data":[]}');
    const source = sourceOver(client);
    await source.findRelated({ work, limit: 5, strategy: "references" }, ctx());
    await source.findRelated(
      {
        work,
        ids: { doi: "10.1234/from-ids" } as Partial<ExternalIds>,
        limit: 5,
        strategy: "references",
      },
      ctx(),
    );
    expect(urls[0]).toContain(encodePaperId("DOI:10.1234/from-work"));
    expect(urls[1]).toContain(encodePaperId("DOI:10.1234/from-ids"));
    expect(urls[1]).not.toContain("from-work");
  });

  it("a strategy this source does not offer is an empty page with a warning and no request", async () => {
    for (const strategy of ["similar", "cocitation", "embedding"] as const) {
      const { client, urls } = canned('{"data":[]}');
      const page = await sourceOver(client).findRelated(
        { ids: SEED, limit: LIMIT, strategy },
        ctx(),
      );
      expect(urls).toEqual([]);
      expect(page.records).toEqual([]);
      expect(page.warnings).toHaveLength(1);
      expect(page.warnings[0]).toContain(strategy);
    }
  });

  it("a row with no paper id is left out, counted, and its place in the list still counts", async () => {
    const { client } = canned(
      JSON.stringify({
        data: [
          { citingPaper: { paperId: null, title: "no id" } },
          { citingPaper: { paperId: "aaa", title: "kept" } },
          { contexts: ["a row with no paper at all"] },
          { citingPaper: { paperId: "bbb", title: "kept too" } },
          null,
        ],
      }),
    );
    const page = await sourceOver(client).findRelated(
      { ids: SEED, limit: LIMIT, strategy: "citations" },
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual(["aaa", "bbb"]);
    expect(page.edges.map((e) => e.rank)).toEqual([2, 4]);
    expect(page.warnings).toEqual([
      "Semantic Scholar: 3 row(s) of /citations had no paper id and were left out.",
    ]);
  });

  it("a whole list of usable rows carries no warning", async () => {
    const { client } = canned(
      JSON.stringify({ data: [{ citedPaper: { paperId: "aaa" } }] }),
    );
    const page = await sourceOver(client).findRelated(
      { ids: SEED, limit: LIMIT, strategy: "references" },
      ctx(),
    );
    expect(page.warnings).toEqual([]);
  });

  it("reads each list's paper from its own member, not the other's", async () => {
    const both = JSON.stringify({
      data: [
        {
          citedPaper: { paperId: "cited" },
          citingPaper: { paperId: "citing" },
        },
      ],
    });
    const source = sourceOver(canned(both).client);
    const references = await source.findRelated(
      { ids: SEED, limit: LIMIT, strategy: "references" },
      ctx(),
    );
    const citations = await source.findRelated(
      { ids: SEED, limit: LIMIT, strategy: "citations" },
      ctx(),
    );
    expect(references.records.map((r) => r.nativeId)).toEqual(["cited"]);
    expect(citations.records.map((r) => r.nativeId)).toEqual(["citing"]);
    expect(references.edges[0]?.kind).toBe("reference");
    expect(citations.edges[0]?.kind).toBe("citation");
  });

  it("fromDate applies to the year, keeps an undated record, and keeps the survivors' ranks", async () => {
    const { client, urls } = canned(
      JSON.stringify({
        data: [
          { citedPaper: { paperId: "old", year: 2022 } },
          { citedPaper: { paperId: "same", year: 2023 } },
          { citedPaper: { paperId: "undated" } },
          { citedPaper: { paperId: "new", year: 2024 } },
        ],
      }),
    );
    const page = await sourceOver(client).findRelated(
      {
        ids: SEED,
        limit: LIMIT,
        strategy: "references",
        fromDate: "2023-06-01",
      },
      ctx(),
    );
    expect(page.records.map((r) => r.nativeId)).toEqual([
      "same",
      "undated",
      "new",
    ]);
    expect(page.edges.map((e) => e.rank)).toEqual([2, 3, 4]);
    expect(urls[0]).not.toContain("2023");
  });

  it("no fromDate keeps every year", async () => {
    const { client } = canned(
      JSON.stringify({
        data: [{ citedPaper: { paperId: "old", year: 1950 } }],
      }),
    );
    const page = await sourceOver(client).findRelated(
      { ids: SEED, limit: LIMIT, strategy: "references" },
      ctx(),
    );
    expect(page.records).toHaveLength(1);
  });

  it("a cancelled token stops it before any request", async () => {
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    const { client, urls } = canned('{"data":[]}');
    await expect(
      sourceOver(client).findRelated(
        { ids: SEED, limit: LIMIT, strategy: "references" },
        { token: tokens.token },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(urls).toEqual([]);
  });

  it("a token already cancelled does not even read the key", async () => {
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    const reads: string[] = [];
    const secrets: SecretStore = {
      ...secretsHolding(FAKE_KEY),
      get(id) {
        reads.push(id);
        return Promise.resolve(FAKE_KEY);
      },
    };
    const { client } = canned('{"data":[]}');
    await expect(
      sourceOver(client, { secrets }).findRelated(
        { ids: SEED, limit: LIMIT, strategy: "references" },
        { token: tokens.token },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(reads).toEqual([]);
  });

  it("a token cancelled while the key was being read stops it before the request", async () => {
    const tokens = createCancellationTokenSource();
    const { client, urls } = canned('{"data":[]}');
    const secrets: SecretStore = {
      ...secretsHolding(FAKE_KEY),
      get() {
        tokens.cancel({ kind: "user" });
        return Promise.resolve(FAKE_KEY);
      },
    };
    await expect(
      sourceOver(client, { secrets }).findRelated(
        { ids: SEED, limit: LIMIT, strategy: "references" },
        { token: tokens.token },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(urls).toEqual([]);
  });

  it("never logs the key", async () => {
    const lines: string[] = [];
    const log = (message: string, fields?: unknown): void => {
      lines.push(`${message} ${JSON.stringify(fields)}`);
    };
    const logger: Logger = {
      error: log,
      warn: log,
      info: log,
      debug: log,
      time: (_message, fn) => fn(),
      child: () => logger,
    };
    const { source } = replayed({ logger });
    await source.findRelated(
      { ids: SEED, limit: LIMIT, strategy: "citations" },
      ctx(),
    );
    await source.matchTitle(TITLE_RICH, ctx());
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(FAKE_KEY);
  });
});

describe("P5-T05: no key, no request (plan/08 §0.2 item 19)", () => {
  const keyless: readonly [string, Overrides][] = [
    ["no store", { secrets: null }],
    ["a store holding no key", { secrets: secretsHolding(undefined) }],
    [
      "a store that throws",
      { secrets: secretsHolding(FAKE_KEY, { throwOnGet: true }) },
    ],
  ];

  it.each(keyless)(
    "%s: findRelated sends nothing, says why",
    async (_, deps) => {
      for (const strategy of [
        "references",
        "citations",
        "recommendations",
        "auto",
      ] as const) {
        const { client, urls } = canned('{"data":[]}');
        const page = await sourceOver(client, deps).findRelated(
          { ids: SEED, limit: LIMIT, strategy },
          ctx(),
        );
        expect(urls).toEqual([]);
        expect(page.records).toEqual([]);
        expect(page.edges).toEqual([]);
        expect(page.warnings).toEqual([SEMANTICSCHOLAR_NO_KEY_WARNING]);
      }
    },
  );

  it.each(keyless)(
    "%s: matchTitle sends nothing, finds nothing",
    async (_, deps) => {
      const { client, urls } = canned('{"data":[]}');
      expect(
        await sourceOver(client, deps).matchTitle(TITLE_RICH, ctx()),
      ).toEqual([]);
      expect(urls).toEqual([]);
    },
  );
});

describe("P5-T14: lookupKeyed and hasUsableApiKey (plan/00 §6 item 339(b))", () => {
  const IDS = [{ doi: "10.1000/one" } as Partial<ExternalIds>];
  const PAPER = {
    paperId: "abc",
    title: "A paper",
    externalIds: { DOI: "10.1000/one", CorpusId: 42 },
  };

  /** Each store says it holds a key, or holds none; none gives a usable one. */
  const unusable: readonly [string, Overrides][] = [
    ["no store", { secrets: null }],
    ["a store holding no key", { secrets: secretsHolding(undefined) }],
    [
      "a store whose has says yes over a blank value",
      { secrets: secretsHolding("   ") },
    ],
    [
      "a store whose has says yes over an empty value",
      { secrets: secretsHolding("") },
    ],
    [
      "a store whose has says yes over an unreadable value",
      { secrets: secretsHolding(FAKE_KEY, { throwOnGet: true }) },
    ],
  ];

  it.each(unusable)("%s: lookupKeyed sends nothing", async (_, deps) => {
    const { client, urls } = canned(JSON.stringify([PAPER]));
    expect(await sourceOver(client, deps).lookupKeyed(IDS, ctx())).toEqual([]);
    expect(urls).toEqual([]);
  });

  it.each(unusable)("%s: hasUsableApiKey is false", async (_, deps) => {
    const { client } = canned("[]");
    expect(await sourceOver(client, deps).hasUsableApiKey()).toBe(false);
  });

  it("the gap this closes: hasApiKey says yes over a blank value, and lookup sends", async () => {
    const { client, urls } = canned(JSON.stringify([PAPER]));
    const source = sourceOver(client, { secrets: secretsHolding("   ") });
    expect(await source.hasApiKey()).toBe(true);
    await source.lookup(IDS, ctx());
    expect(urls).toHaveLength(1);
  });

  it("a usable key: hasUsableApiKey is true, and each lookupKeyed batch carries the key", async () => {
    const requests: { url: string; headers: unknown }[] = [];
    const client: HttpClient = {
      request(_method, url, options): Promise<HttpResponse> {
        requests.push({ url, headers: options?.headers });
        return Promise.resolve({
          status: 200,
          url,
          body: JSON.stringify([PAPER]),
          rawHeaders: "",
          header: () => undefined,
        });
      },
    };
    const source = sourceOver(client);
    expect(await source.hasUsableApiKey()).toBe(true);
    const many = Array.from(
      { length: SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT + 1 },
      (_, n) => ({ doi: `10.1000/${String(n)}` }) as Partial<ExternalIds>,
    );
    const records = await source.lookupKeyed(many, ctx());
    expect(requests).toHaveLength(2);
    for (const { url, headers } of requests) {
      expect(headers).toMatchObject({
        [SEMANTICSCHOLAR_API_KEY_HEADER]: FAKE_KEY,
      });
      expect(url).not.toContain(FAKE_KEY);
    }
    expect(records.map(({ work }) => work.ids.doi)).toContain("10.1000/one");
  });

  it("reads the key once, however many batches go out", async () => {
    const { client, urls } = canned("[]");
    let reads = 0;
    const secrets: SecretStore = {
      ...secretsHolding(FAKE_KEY),
      get() {
        reads += 1;
        return Promise.resolve(FAKE_KEY);
      },
    };
    const many = Array.from(
      { length: SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT + 1 },
      (_, n) => ({ doi: `10.1000/${String(n)}` }) as Partial<ExternalIds>,
    );
    await sourceOver(client, { secrets }).lookupKeyed(many, ctx());
    expect(urls).toHaveLength(2);
    expect(reads).toBe(1);
  });

  it("a token already cancelled does not even read the key", async () => {
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    const reads: string[] = [];
    const secrets: SecretStore = {
      ...secretsHolding(FAKE_KEY),
      get(id) {
        reads.push(id);
        return Promise.resolve(FAKE_KEY);
      },
    };
    const { client } = canned("[]");
    await expect(
      sourceOver(client, { secrets }).lookupKeyed(IDS, { token: tokens.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(reads).toEqual([]);
  });

  it("a failed batch rejects rather than reading as no record", async () => {
    const client: HttpClient = {
      request: () => Promise.reject(new UpstreamServerError(500, "x")),
    };
    await expect(
      sourceOver(client).lookupKeyed(IDS, ctx()),
    ).rejects.toBeInstanceOf(UpstreamServerError);
  });
});

describe("P5-T05: matchTitle", () => {
  it("reads the match-title fixture into one record, with the key as a header", async () => {
    const exchange = await exchangeOf("match-title");
    const parsed = JSON.parse(exchange.body) as
      { data: readonly RawPaper[] } | RawPaper;
    const paper: RawPaper | undefined =
      "data" in parsed ? parsed.data[0] : parsed;
    const { source, transport } = replayed();
    const records = await source.matchTitle(TITLE_RICH, ctx());
    expect(records.map((r) => r.nativeId)).toEqual([paper?.paperId]);
    expect(records[0]?.work.title).toBe(paper?.title);
    expect(transport.calls).toHaveLength(1);
    expect(
      transport.calls[0]?.options.headers?.[SEMANTICSCHOLAR_API_KEY_HEADER],
    ).toBe(FAKE_KEY);
    expect(transport.calls[0]?.url).not.toContain(FAKE_KEY);
  });

  it("no match is a result, not an error, whatever the fixture answers", async () => {
    const { source, transport } = replayed();
    expect(await source.matchTitle(TITLE_ABSENT, ctx())).toEqual([]);
    expect(transport.calls).toHaveLength(1);
  });

  it.each([
    ["a 200 with an empty data", '{"data":[]}'],
    ["a 200 whose data holds null", '{"data":[null]}'],
  ])("%s is no match", async (_, body) => {
    expect(
      await sourceOver(canned(body).client).matchTitle("t", ctx()),
    ).toEqual([]);
  });

  it("a bare paper object is read too, because no document records the envelope", async () => {
    const records = await sourceOver(
      canned('{"paperId":"bare","title":"T"}').client,
    ).matchTitle("t", ctx());
    expect(records.map((r) => r.nativeId)).toEqual(["bare"]);
  });

  it("a longer data keeps its first entry: a list of zero or one, always", async () => {
    const records = await sourceOver(
      canned('{"data":[{"paperId":"first"},{"paperId":"second"}]}').client,
    ).matchTitle("t", ctx());
    expect(records.map((r) => r.nativeId)).toEqual(["first"]);
  });

  it("a 400 is not 'no match': it propagates", async () => {
    const { source } = answering(await exchangeOf("citations-unknown-field"));
    const refused = await source
      .matchTitle("t", ctx())
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BadRequestError);
    expect((refused as BadRequestError).httpStatus).toBe(400);
  });

  it("a 429 and a 5xx propagate", async () => {
    const limited = answering(
      await readScenarioExchange(SEARCH_DIR, "error-429", nodeFixtureIo),
    );
    await expect(limited.source.matchTitle("t", ctx())).rejects.toBeInstanceOf(
      SemanticScholarRateLimitError,
    );
    const broken = answering({ status: 503, headers: {}, body: "{}" });
    await expect(broken.source.matchTitle("t", ctx())).rejects.toBeInstanceOf(
      UpstreamServerError,
    );
  });

  it("a blank title is the caller's bug, as it is on Crossref: RangeError, no request", async () => {
    const { client, urls } = canned('{"data":[]}');
    await expect(
      sourceOver(client).matchTitle("   ", ctx()),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      sourceOver(client, { secrets: null }).matchTitle("", ctx()),
    ).rejects.toBeInstanceOf(RangeError);
    expect(urls).toEqual([]);
  });

  it("a cancelled token stops it before any request", async () => {
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    const { client, urls } = canned('{"data":[]}');
    await expect(
      sourceOver(client).matchTitle("t", { token: tokens.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(urls).toEqual([]);
  });
});

describe("P5-T05: the parsers", () => {
  it("parseRelationBody: contexts are copied, an empty list stays, anything else is absent", () => {
    const rows = parseRelationBody(
      "citations",
      JSON.stringify({
        data: [
          { contexts: ["a", "b", "c"], citingPaper: { paperId: "1" } },
          { contexts: [], citingPaper: { paperId: "2" } },
          { contexts: "not a list", citingPaper: { paperId: "3" } },
          { citingPaper: { paperId: "4" } },
          { contexts: ["kept", 7, null], citingPaper: { paperId: "5" } },
        ],
      }),
      URL_IN_ERRORS,
    );
    expect(rows.map((row) => row.contexts)).toEqual([
      ["a", "b", "c"],
      [],
      undefined,
      undefined,
      ["kept"],
    ]);
    expect(rows.map((row) => row.paper)).toEqual([
      { paperId: "1" },
      { paperId: "2" },
      { paperId: "3" },
      { paperId: "4" },
      { paperId: "5" },
    ]);
  });

  it("parseRelationBody: an empty list is no error", () => {
    expect(
      parseRelationBody("references", '{"data":[]}', URL_IN_ERRORS),
    ).toEqual([]);
  });

  it.each([
    ["not JSON", "<html>"],
    ["no data", "{}"],
    ["data not a list", '{"data":{}}'],
    ["a bare list", "[]"],
    ["null", "null"],
  ])("parseRelationBody: %s is a ParseError", (_, body) => {
    expect(() => parseRelationBody("citations", body, URL_IN_ERRORS)).toThrow(
      ParseError,
    );
  });

  it.each([
    ["{error}", '{"error":"boom"}'],
    ["{message,code}, code a string", '{"message":"boom","code":"429"}'],
  ])("a 200 holding %s is a SourceError on both parsers", (_, body) => {
    expect(() => parseRelationBody("references", body, URL_IN_ERRORS)).toThrow(
      SourceError,
    );
    expect(() => parseTitleMatchBody(body, URL_IN_ERRORS)).toThrow(SourceError);
  });

  it.each([
    ["not JSON", "<html>"],
    ["neither envelope", '{"total":1}'],
    ["paperId not a string", '{"paperId":7}'],
    ["null", "null"],
  ])("parseTitleMatchBody: %s is a ParseError", (_, body) => {
    expect(() => parseTitleMatchBody(body, URL_IN_ERRORS)).toThrow(ParseError);
  });

  it("a body that is not JSON says so, rather than failing later for a missing member", () => {
    expect(() =>
      parseRelationBody("citations", "<html>", URL_IN_ERRORS),
    ).toThrow(/not JSON/u);
    expect(() => parseTitleMatchBody("<html>", URL_IN_ERRORS)).toThrow(
      /not JSON/u,
    );
  });

  it("a message with no code is not the error envelope", () => {
    expect(
      parseRelationBody(
        "citations",
        '{"message":"a note","data":[]}',
        URL_IN_ERRORS,
      ),
    ).toEqual([]);
  });

  it("parseTitleMatchBody: no match is undefined, a match is the paper", () => {
    expect(parseTitleMatchBody('{"data":[]}', URL_IN_ERRORS)).toBeUndefined();
    expect(
      parseTitleMatchBody('{"data":[null]}', URL_IN_ERRORS),
    ).toBeUndefined();
    expect(
      parseTitleMatchBody('{"data":[{"paperId":"a"}]}', URL_IN_ERRORS),
    ).toEqual({ paperId: "a" });
    expect(parseTitleMatchBody('{"paperId":"a"}', URL_IN_ERRORS)).toEqual({
      paperId: "a",
    });
  });
});

describe("P5-T05: the capability flags", () => {
  it("relatedByWork and citationGraph are true, and findRelated is there for them", () => {
    expect(SEMANTICSCHOLAR_CAPABILITIES.relatedByWork).toBe(true);
    expect(SEMANTICSCHOLAR_CAPABILITIES.citationGraph).toBe(true);
    const { client } = canned("{}");
    const source = sourceOver(client);
    expect(source.findRelated).toBeTypeOf("function");
    expect(source.matchTitle).toBeTypeOf("function");
    expect(source.recommend).toBeTypeOf("function");
  });
});
