import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerSources } from "../../../src/bootstrap/registerSources";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import {
  BadRequestError,
  KEYISH_FIELD,
  OperationCancelledError,
  ParseError,
  RateLimitError,
  SourceError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpMethod,
  type HttpOptions,
  type HttpResponse,
  type HttpTransport,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { buildUserAgent } from "../../../src/core/http/userAgent";
import { Semaphore } from "../../../src/core/concurrency";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  CompositeProgressReporter,
  type ProgressReporter,
} from "../../../src/core/jobQueue/progress";
import { createLogger, type Logger } from "../../../src/core/logger";
import {
  fanOut,
  NETWORK_METADATA_POOL_SIZE,
} from "../../../src/pipeline/searchImport/stages";
import {
  ARXIV_HOST,
  createHostLimiterRegistry,
  CROSSREF_HOST,
  EBI_HOST,
  HOST_POLICIES,
  NCBI_HOST,
  SEMANTICSCHOLAR_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import { TokenBucket } from "../../../src/core/rateLimit/tokenBucket";
import type { SecretStore } from "../../../src/core/secretStore";
import { SOURCE_IDS } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import { PREFS } from "../../../src/prefs/schema";
import {
  createSemanticScholarRecordMapper,
  mapPaper,
  readExternalIds,
  readOpenAccess,
  readPublishedDate,
  readSubjects,
  readTldr,
  readType,
  SEMANTICSCHOLAR_FIELD_OF_STUDY_SCHEME,
  SEMANTICSCHOLAR_MAPPABLE_FIELDS,
  SEMANTICSCHOLAR_PREPRINT_VENUES,
  splitAuthorName,
} from "../../../src/sources/semanticscholar/mapper";
import {
  buildBatchRequest,
  buildBulkSearchRequest,
  buildPaperRequest,
  buildRelevanceSearchRequest,
  encodePaperId,
  explainSemanticScholarQuery,
  normalizeTermValue,
  renderBulkQuery,
  renderPlainQuery,
  renderPublicationDateFilter,
  RESERVED_RAW_PARAMS,
  SEMANTICSCHOLAR_ABSTRACT_FIELDS,
  SEMANTICSCHOLAR_BATCH_IDS_MAX,
  SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT,
  SEMANTICSCHOLAR_BATCH_URL,
  SEMANTICSCHOLAR_BULK_FIELDS,
  SEMANTICSCHOLAR_BULK_SEARCH_URL,
  SEMANTICSCHOLAR_GRAPH_BASE_URL,
  SEMANTICSCHOLAR_HEALTH_FIELDS,
  SEMANTICSCHOLAR_HEALTH_PAPER_ID,
  SEMANTICSCHOLAR_OPEN_ACCESS_FLAG,
  SEMANTICSCHOLAR_PAGE_SIZE_MAX,
  SEMANTICSCHOLAR_FILTERS,
  SEMANTICSCHOLAR_QUERY_FILTER_SUPPORT,
  SEMANTICSCHOLAR_RELEVANCE_DEPTH_MAX,
  SEMANTICSCHOLAR_RELEVANCE_FILTERS,
  SEMANTICSCHOLAR_RELEVANCE_SEARCH_URL,
  SEMANTICSCHOLAR_RENDERED_FIELDS,
  SEMANTICSCHOLAR_SEARCH_FIELDS,
} from "../../../src/sources/semanticscholar/query";
import {
  clampPageSize,
  createSemanticScholarSource,
  excludedTermsWarning,
  lossinessWarnings,
  nextOffsetAfter,
  nextTokenAfter,
  parseBatchBody,
  parsePaperBody,
  parseSearchBody,
  readOffsetCursor,
  SEMANTICSCHOLAR_API_KEY_HEADER,
  SEMANTICSCHOLAR_APPROXIMATE_PREFIX,
  SEMANTICSCHOLAR_CAPABILITIES,
  SEMANTICSCHOLAR_DISPLAY_NAME_KEY,
  SEMANTICSCHOLAR_KEY_REQUEST_URL,
  SEMANTICSCHOLAR_SECRET_ID,
  SEMANTICSCHOLAR_SOURCE_ID,
  SEMANTICSCHOLAR_UNKEYED_NOTE,
  SemanticScholarRateLimitError,
  toSemanticScholarId,
  type SemanticScholarSourceDeps,
} from "../../../src/sources/semanticscholar/semanticscholarSource";
import { createSourceRegistry } from "../../../src/sources/registry";
import {
  normalizeForSource,
  parseUserQuery,
} from "../../../src/sources/shared/queryParse";
import type {
  LiteratureSource,
  QueryField,
  QueryNode,
  SourceCallContext,
  SourceQuery,
} from "../../../src/sources/types";
import {
  assertFixturesFresh,
  createReplayHttpClient,
  fixtureKey,
  listFixtureMeta,
  META_SUFFIX,
  type RecordedExchange,
} from "../../contract/_transport";
import {
  planFor,
  plannedRequest,
  RECORDABLE_SOURCES,
  redactExchange,
  selectScenarios,
  UsageError,
} from "../../../scripts/record-fixtures";
import {
  recordedSemanticScholarBatchRequest,
  recordedSemanticScholarBulkRequest,
  recordedSemanticScholarHealthRequest,
  SEMANTICSCHOLAR_BATCH_DATACITE_ID,
  SEMANTICSCHOLAR_BATCH_IDS,
  SEMANTICSCHOLAR_QUERY_EMPTY as QUERY_EMPTY,
  SEMANTICSCHOLAR_QUERY_PAGINATED as QUERY_PAGINATED,
  SEMANTICSCHOLAR_QUERY_PAIR as QUERY_PAIR,
  SEMANTICSCHOLAR_QUERY_PREPRINT as QUERY_PREPRINT,
  SEMANTICSCHOLAR_QUERY_RELEVANCE as QUERY_RELEVANCE,
  SEMANTICSCHOLAR_QUERY_RICH as QUERY_RICH,
  SEMANTICSCHOLAR_QUERY_SPARSE as QUERY_SPARSE,
  SEMANTICSCHOLAR_QUERY_SYNTHETIC_400 as QUERY_SYNTHETIC_400,
  SEMANTICSCHOLAR_QUERY_SYNTHETIC_429 as QUERY_SYNTHETIC_429,
  SEMANTICSCHOLAR_QUERY_SYNTHETIC_500 as QUERY_SYNTHETIC_500,
  SEMANTICSCHOLAR_QUERY_SYNTHETIC_MALFORMED as QUERY_SYNTHETIC_MALFORMED,
  SEMANTICSCHOLAR_QUERY_TYPICAL as QUERY_TYPICAL,
  SEMANTICSCHOLAR_QUERY_UNICODE as QUERY_UNICODE,
} from "../../support/semanticscholarRecordedRequests";
import { DEDUP_CORPUS_SEARCHES } from "../../support/dedupCorpusRecordedRequests";

/**
 * `P2-T13` Part B's corpus scenarios, recorded beside the `docs/13`
 * inventory: one relevance search per corpus search, and `corpus-batch`.
 */
const CORPUS_SCENARIOS = [
  ...DEDUP_CORPUS_SEARCHES.semanticscholar.map((s) => s.scenario),
  "corpus-batch",
];

/**
 * `P2-T05`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network,
 * no key**. Two kinds of test share this file, and the card's `Verify with`
 * (`npm run test:unit -- semanticscholar`) runs both:
 *
 * - **Pure**: the two renderings against `docs/02` §12.2 / §12.3's S2 column,
 *   the request builders, the paper mapper over hand-built objects (`docs/02`
 *   §6.7's own sample), the body parsers, the paging rules, the
 *   `api.semanticscholar.org` policy row read back from `docs/07` §7.3, the
 *   keyed path against a **fake** `SecretStore` returning a short synthetic
 *   placeholder (never a key-shaped string), the 1.1-second spacing on the
 *   real `TokenBucket` under a manual clock, and `registerSources` with the
 *   new slot.
 * - **Replayed**: the shipped `createSemanticScholarSource` over the shipped
 *   `createHttpClient`, answering from `test/fixtures/semanticscholar/` —
 *   recorded live and **unauthenticated** on 2026-10-15 (two paced runs, 13 +
 *   7 requests; 4 written). The shared anonymous pool refused 7 of the first
 *   13 and 1 of the next 7; two of those refusals are kept as the real
 *   recorded 429 the card asks to test against. A missing fixture is an error
 *   naming the record command, never a network call.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/semanticscholar",
);

const DOCS_07 = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/07-architecture-and-data-model.md",
);

const NOW = 1_700_000_000_000;

/**
 * The fake store's value. Deliberately **short and un-key-shaped** (11
 * characters; `redact()`'s catch-all starts at 40, its hexadecimal shape at
 * 32), so nothing in this file is ever mistaken for a credential, and so the
 * assertions below prove the header is carried by *name*, not caught by a
 * pattern.
 */
const PLACEHOLDER_KEY = "fake-s2-key";

function ctx(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

const term = (
  value: string,
  field?: QueryField,
  phrase?: boolean,
): QueryNode => ({
  kind: "term",
  value,
  ...(field !== undefined && { field }),
  ...(phrase !== undefined && { phrase }),
});
const phrase = (value: string): QueryNode => term(value, undefined, true);
const and = (...children: QueryNode[]): QueryNode => ({
  kind: "and",
  children,
});
const or = (...children: QueryNode[]): QueryNode => ({ kind: "or", children });
const not = (child: QueryNode): QueryNode => ({ kind: "not", child });

/** `docs/02` §12.2's worked example, as the user types it. */
const EXAMPLE_INPUT =
  '("base editing" OR "prime editing") AND title:CRISPR NOT mouse';
const EXAMPLE_WINDOW = {
  fromDate: "2024-01-01",
  toDate: "2026-12-31",
} as const;
/** §12.2's bulk rendering, verbatim. */
const EXAMPLE_BULK = '("base editing" | "prime editing") + CRISPR - mouse';
/** §12.2's plain-text rendering, verbatim. */
const EXAMPLE_PLAIN = "base editing prime editing CRISPR";

/** One request the stub client answered. */
interface Issued {
  readonly method: HttpMethod;
  readonly url: string;
  readonly options: HttpOptions | undefined;
}

function createStubHttp(
  handler: (issued: Issued, index: number) => HttpResponse,
): { readonly client: HttpClient; readonly issued: Issued[] } {
  const issued: Issued[] = [];
  const client: HttpClient = {
    request(method, url, options) {
      const call: Issued = { method, url, options };
      issued.push(call);
      return Promise.resolve(handler(call, issued.length - 1));
    },
  };
  return { client, issued };
}

function response(
  url: string,
  body: string,
  status = 200,
  headers: Readonly<Record<string, string>> = {
    "content-type": "application/json",
  },
): HttpResponse {
  const byName = new Map(
    Object.entries(headers).map(([n, v]) => [n.toLowerCase(), v]),
  );
  return {
    status,
    url,
    body,
    rawHeaders: "",
    header: (name) => byName.get(name.toLowerCase()),
  };
}

function paramsOf(issued: Issued): URLSearchParams {
  const q = issued.url.indexOf("?");
  return new URLSearchParams(q === -1 ? "" : issued.url.slice(q + 1));
}

/** The header `name` the stub client saw on `issued`, case-insensitively. */
function headerOf(issued: Issued, name: string): string | undefined {
  const entry = Object.entries(issued.options?.headers ?? {}).find(
    ([n]) => n.toLowerCase() === name.toLowerCase(),
  );
  return entry?.[1];
}

/** A bulk/relevance page envelope around paper objects. */
function page(
  data: readonly unknown[],
  extra: { total?: number; token?: string | null; next?: number } = {},
): string {
  return JSON.stringify({
    total: extra.total ?? data.length,
    ...(extra.token !== undefined && { token: extra.token }),
    ...(extra.next !== undefined && { next: extra.next }),
    data,
  });
}

function createSpyLogger(): {
  readonly logger: Logger;
  readonly lines: string[];
} {
  const lines: string[] = [];
  const log = (level: string) => (msg: string, c?: Record<string, unknown>) => {
    lines.push(`${level} ${msg} ${JSON.stringify(c ?? {})}`);
  };
  const logger: Logger = {
    child: () => logger,
    error: log("error"),
    warn: log("warn"),
    info: log("info"),
    debug: log("debug"),
    time: (_msg, fn) => fn(),
  };
  return { logger, lines };
}

/**
 * A `SecretStore` that answers `source.semanticscholar` with the placeholder
 * when called with no argument, and with exactly the given value otherwise:
 * `fakeSecrets(undefined)` is a store that **holds no key**. The value comes
 * from `args.length`, not from a default parameter, because a default also
 * replaces an explicitly passed `undefined` — which is how the "no key" tests
 * first ran against a keyed store (P2-T05, 2026-10-15).
 */
function fakeSecrets(
  ...args: [value?: string | undefined, options?: { throwOnGet?: boolean }]
): SecretStore & { readonly reads: string[] } {
  const value = args.length === 0 ? PLACEHOLDER_KEY : args[0];
  const options = args[1] ?? {};
  const reads: string[] = [];
  return {
    reads,
    backend: "os-keychain",
    unattended: true,
    get(id) {
      reads.push(id);
      if (options.throwOnGet) return Promise.reject(new Error("keystore down"));
      return Promise.resolve(
        id === SEMANTICSCHOLAR_SECRET_ID ? value : undefined,
      );
    },
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    has: (id) =>
      Promise.resolve(id === SEMANTICSCHOLAR_SECRET_ID && value !== undefined),
    listStoredIds: () =>
      Promise.resolve(value === undefined ? [] : [SEMANTICSCHOLAR_SECRET_ID]),
    clearAll: () => Promise.resolve(0),
  };
}

function mapper(overrides: { keepRaw?: boolean; logger?: Logger } = {}) {
  return createSemanticScholarRecordMapper({
    clock: createManualClock(NOW),
    ...overrides,
  });
}

function createSource(
  client: HttpClient,
  overrides: Partial<SemanticScholarSourceDeps> = {},
) {
  const clock = createManualClock(NOW);
  return createSemanticScholarSource({
    http: client,
    clock,
    mapRecords: mapper(),
    ...overrides,
  });
}

/** `docs/13` §3.1's thirteen names, as this corpus spells them. */
const DOCS_13_SCENARIOS: readonly string[] = [
  "search-typical",
  "search-empty",
  "search-single",
  "record-rich",
  "record-sparse",
  "record-unicode",
  "record-jats-abstract",
  "record-preprint",
  "error-429",
  "error-500",
  "error-malformed",
  "paginated-page-1",
  "dedup-pair-set",
];

/** The recorded exchange of one scenario, straight from disk. */
async function recordedExchange(scenario: string): Promise<RecordedExchange> {
  const loaded = await listFixtureMeta(FIXTURE_DIR);
  const hit = loaded.find((m) => m.meta.scenario === scenario);
  if (hit === undefined) throw new Error(`no fixture for ${scenario}`);
  const text = await readFile(`${FIXTURE_DIR}/${hit.key}.json`, "utf8");
  return JSON.parse(text) as RecordedExchange;
}

function byNativeId(
  records: readonly SourceRecord[],
  id: string,
): SourceRecord {
  const found = records.find((r) => r.nativeId === id);
  if (found === undefined) throw new Error(`no record ${id}`);
  return found;
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/**
 * `docs/02` §6.7's real `/paper/{id}` response, verbatim (the Geneformer
 * paper), as the hand-built mapper input.
 */
const SAMPLE_PAPER = {
  paperId: "7d1e59ce254bea5228da634dbe7c5c4160df6f98",
  externalIds: {
    PubMedCentral: "10949956",
    DOI: "10.1038/s41586-023-06139-9",
    CorpusId: 259002047,
    PubMed: "37258680",
  },
  title: "Transfer learning enables predictions in network biology",
  venue: "Nature",
  year: 2023,
  referenceCount: 159,
  citationCount: 1220,
  influentialCitationCount: 137,
  openAccessPdf: {
    url: "https://escholarship.org/content/qt8st2d5mx/qt8st2d5mx.pdf",
    status: "GREEN",
    license: null,
    disclaimer:
      "Notice: Paper or abstract available at https://pmc.ncbi.nlm.nih.gov/articles/PMC10949956, which is subject to the license by the author or copyright owner provided with this content. ...",
  },
  tldr: {
    model: "tldr@v2.0.0",
    text: "A context-aware, attention-based deep learning model pretrained on single-cell transcriptomes enables predictions in settings with limited data in network biology and could accelerate discovery of key network regulators and candidate therapeutic targets.",
  },
  publicationTypes: ["JournalArticle"],
  publicationDate: "2023-05-31",
  journal: { name: "Nature", pages: "616 - 624", volume: "618" },
  authors: [
    { authorId: "4401918", name: "C. Theodoris" },
    { authorId: "2218974530", name: "Ling Xiao" },
    { authorId: "4504266", name: "P. Ellinor" },
  ],
  abstract:
    "Mapping gene networks requires large amounts of transcriptomic data to learn the connections between genes, ...",
};

/** `docs/02` §6.4's measured 429 body, byte for byte. */
const MEASURED_429_BODY =
  '{"message": "Too Many Requests. Please wait and try again or apply for a ' +
  "key for higher rate limits. " +
  'https://www.semanticscholar.org/product/api#api-key-form", "code": "429"}';

// ---------------------------------------------------------------------------
// 1. The bulk rendering — docs/02 §12.2's Semantic Scholar block, §6.6
// ---------------------------------------------------------------------------

describe("renderBulkQuery — docs/02 §12.2's bulk block", () => {
  it("renders §12.2's example exactly (criterion 4)", () => {
    expect(renderBulkQuery(parseUserQuery(EXAMPLE_INPUT))).toBe(EXAMPLE_BULK);
    expect(renderBulkQuery(QUERY_TYPICAL.terms)).toBe(EXAMPLE_BULK);
  });

  it("AND → `+`, OR → `|` in parentheses, NOT → `-` after the positives", () => {
    expect(renderBulkQuery(and(term("a"), term("b")))).toBe("a + b");
    expect(renderBulkQuery(or(term("a"), term("b")))).toBe("(a | b)");
    expect(renderBulkQuery(and(term("a"), not(term("b"))))).toBe("a - b");
    expect(
      renderBulkQuery(and(not(term("b")), term("a"), not(term("c")))),
    ).toBe("a - b - c");
  });

  it("keeps quotes on phrases and parentheses on groups; an AND nested in a group is parenthesised", () => {
    expect(renderBulkQuery(phrase("fish ladder"))).toBe('"fish ladder"');
    expect(renderBulkQuery(or(and(term("a"), term("b")), term("c")))).toBe(
      "((a + b) | c)",
    );
    expect(renderBulkQuery(and(term("a"), not(or(term("b"), term("c")))))).toBe(
      "a - (b | c)",
    );
    expect(renderBulkQuery(or(term("a")))).toBe("a");
  });

  it("replaces hyphens inside a term with spaces BEFORE `-` is used as NOT, and groups the words", () => {
    expect(normalizeTermValue("CRISPR-Cas9")).toBe("CRISPR Cas9");
    expect(renderBulkQuery(and(term("CRISPR-Cas9"), not(term("mouse"))))).toBe(
      "(CRISPR Cas9) - mouse",
    );
    expect(renderBulkQuery(phrase("base-editing"))).toBe('"base editing"');
    // The only `-` on the wire is the operator this module emits.
    const rendered = renderBulkQuery(
      and(term("single-cell"), phrase("off-target"), not(term("in-vivo"))),
    );
    expect(rendered).toBe('(single cell) + "off target" - (in vivo)');
    expect(rendered.match(/-/gu)).toHaveLength(1);
  });

  it("strips the §6.6 operator characters out of a term value", () => {
    expect(normalizeTermValue('say "hi" (now) | later + more * ~ x')).toBe(
      "say hi now later more x",
    );
    expect(renderBulkQuery(term("fish~"))).toBe("fish");
  });

  it("drops field prefixes: there is no field syntax (§12.2)", () => {
    expect(renderBulkQuery(term("CRISPR", "title"))).toBe("CRISPR");
    expect(renderBulkQuery(term("Doudna", "author"))).toBe("Doudna");
    expect(SEMANTICSCHOLAR_RENDERED_FIELDS).toEqual([]);
  });

  it("refuses a NOT with nothing to subtract from, and a NOT under an OR, by name", () => {
    expect(() => renderBulkQuery(not(term("mouse")))).toThrow(
      /positive clause to subtract from/u,
    );
    expect(() => renderBulkQuery(and(not(term("a")), not(term("b"))))).toThrow(
      RangeError,
    );
    expect(() => renderBulkQuery(or(term("a"), not(term("b"))))).toThrow(
      /NOT under an OR/u,
    );
  });

  it("renders nothing for a tree with nothing renderable, and skips such children", () => {
    expect(renderBulkQuery(term("  "))).toBe("");
    expect(renderBulkQuery(and(term("a"), term("~")))).toBe("a");
    expect(renderBulkQuery(and())).toBe("");
  });
});

describe("renderPlainQuery — /paper/search takes plain text only (§6.5)", () => {
  it("renders §12.2's example as the bag of positive words and returns the NOT term", () => {
    const rendered = renderPlainQuery(parseUserQuery(EXAMPLE_INPUT));
    expect(rendered.text).toBe(EXAMPLE_PLAIN);
    expect(rendered.excluded).toEqual([{ value: "mouse", field: undefined }]);
  });

  it("writes no quotes, no operators and no field prefixes; hyphens become spaces", () => {
    const rendered = renderPlainQuery(
      and(
        phrase("off-target"),
        term("Cas9", "title"),
        not(term("x", "author")),
      ),
    );
    expect(rendered.text).toBe("off target Cas9");
    expect(rendered.text).not.toMatch(/["()|+~-]/u);
    expect(rendered.excluded).toEqual([{ value: "x", field: "author" }]);
  });
});

describe("renderPublicationDateFilter — §6.5's publicationDateOrYear", () => {
  it("renders <from>:<to>, either bound alone, and nothing when neither is set", () => {
    expect(renderPublicationDateFilter("2024-01-01", "2026-12-31")).toBe(
      "2024-01-01:2026-12-31",
    );
    expect(renderPublicationDateFilter("1981-08-25", undefined)).toBe(
      "1981-08-25:",
    );
    expect(renderPublicationDateFilter(undefined, "2015-01")).toBe(":2015-01");
    expect(renderPublicationDateFilter(undefined, undefined)).toBeUndefined();
  });

  it("refuses a bound that is not a YYYY, YYYY-MM or YYYY-MM-DD prefix", () => {
    expect(() => renderPublicationDateFilter("2024/01/01", undefined)).toThrow(
      RangeError,
    );
    expect(() => renderPublicationDateFilter(undefined, "yesterday")).toThrow(
      /YYYY, YYYY-MM or YYYY-MM-DD/u,
    );
  });
});

describe("explainSemanticScholarQuery", () => {
  it("writes §12.2's bulk block: query=…&publicationDateOrYear=…, unencoded", () => {
    expect(
      explainSemanticScholarQuery({
        terms: parseUserQuery(EXAMPLE_INPUT),
        ...EXAMPLE_WINDOW,
        limit: 20,
      }),
    ).toBe(`query=${EXAMPLE_BULK}&publicationDateOrYear=2024-01-01:2026-12-31`);
    expect(
      explainSemanticScholarQuery({
        terms: term("x"),
        limit: 1,
        openAccessOnly: false,
      }),
    ).toBe("query=x");
  });

  it("refuses languages, open access (bulk: not documented, §12.3) and a reserved raw key before any request", () => {
    expect(() =>
      explainSemanticScholarQuery({
        terms: term("x"),
        limit: 1,
        languages: ["en"],
      }),
    ).toThrow(/no language filter/u);
    expect(() =>
      explainSemanticScholarQuery({
        terms: term("x"),
        limit: 1,
        openAccessOnly: true,
      }),
    ).toThrow(/openAccessOnly/u);
    expect(() =>
      explainSemanticScholarQuery({
        terms: term("x"),
        limit: 1,
        raw: { token: "t" },
      }),
    ).toThrow(/reserved/u);
  });
});

// ---------------------------------------------------------------------------
// 2. Request builders
// ---------------------------------------------------------------------------

describe("buildBulkSearchRequest", () => {
  it("emits query, fields, publicationDateOrYear, limit, token in a fixed order, on the §6.1 host", () => {
    const request = buildBulkSearchRequest({
      query: {
        terms: parseUserQuery(EXAMPLE_INPUT),
        ...EXAMPLE_WINDOW,
        limit: 20,
      },
      limit: 20,
      token: "abc",
    });
    expect(request.method).toBe("GET");
    expect(request.endpointBaseUrl).toBe(SEMANTICSCHOLAR_BULK_SEARCH_URL);
    expect(new URL(request.url).host).toBe(SEMANTICSCHOLAR_HOST);
    expect(SEMANTICSCHOLAR_GRAPH_BASE_URL).toBe(
      "https://api.semanticscholar.org/graph/v1",
    );
    const params = new URLSearchParams(new URL(request.url).search);
    expect([...params.keys()]).toEqual([
      "query",
      "fields",
      "publicationDateOrYear",
      "limit",
      "token",
    ]);
    expect(params.get("query")).toBe(EXAMPLE_BULK);
    expect(params.get("fields")).toBe(SEMANTICSCHOLAR_BULK_FIELDS.join(","));
    expect(params.get("publicationDateOrYear")).toBe("2024-01-01:2026-12-31");
    expect(params.get("limit")).toBe("20");
    expect(params.get("token")).toBe("abc");
    expect(request.rendered).toBe(EXAMPLE_BULK);
    expect(request.token).toBe("abc");
  });

  it("asks the bulk endpoint for every mapped field except tldr (measured 400) and never embedding (§6.9)", () => {
    expect(SEMANTICSCHOLAR_BULK_FIELDS).not.toContain("tldr");
    expect(SEMANTICSCHOLAR_SEARCH_FIELDS).toContain("tldr");
    expect(SEMANTICSCHOLAR_BULK_FIELDS).toEqual(
      SEMANTICSCHOLAR_SEARCH_FIELDS.filter((f) => f !== "tldr"),
    );
    for (const list of [
      SEMANTICSCHOLAR_SEARCH_FIELDS,
      SEMANTICSCHOLAR_BULK_FIELDS,
      SEMANTICSCHOLAR_ABSTRACT_FIELDS,
      SEMANTICSCHOLAR_HEALTH_FIELDS,
    ]) {
      expect(list.some((f) => f.startsWith("embedding"))).toBe(false);
    }
    for (const needed of [
      "paperId",
      "externalIds",
      "title",
      "abstract",
      "venue",
      "publicationVenue",
      "year",
      "publicationDate",
      "citationCount",
      "referenceCount",
      "influentialCitationCount",
      "isOpenAccess",
      "openAccessPdf",
      "fieldsOfStudy",
      "s2FieldsOfStudy",
      "publicationTypes",
      "journal",
      "authors",
      "url",
      "corpusId",
    ]) {
      expect(SEMANTICSCHOLAR_BULK_FIELDS).toContain(needed);
    }
  });

  it("omits the window and the token when absent, appends raw sorted, and refuses openAccessOnly by name (§12.3: bulk not documented)", () => {
    const request = buildBulkSearchRequest({
      query: {
        terms: term("x"),
        limit: 5,
        openAccessOnly: false,
        raw: { year: "2020-", minCitationCount: 5 },
      },
      limit: 5,
    });
    expect(request.url).toBe(
      `${SEMANTICSCHOLAR_BULK_SEARCH_URL}?query=x&fields=${encodeURIComponent(
        SEMANTICSCHOLAR_BULK_FIELDS.join(","),
      )}&limit=5&minCitationCount=5&year=2020-`,
    );
    expect(request.token).toBeUndefined();
    expect(() =>
      buildBulkSearchRequest({
        query: { terms: term("x"), limit: 5, openAccessOnly: true },
        limit: 5,
      }),
    ).toThrow(/openAccessOnly/u);
  });

  it("has no credential anywhere in the URL, so transmittedUrl is the URL itself", () => {
    const request = buildBulkSearchRequest({
      query: { terms: term("x"), limit: 1 },
      limit: 1,
    });
    expect(request.transmittedUrl).toBe(request.url);
    expect(request.url).not.toMatch(/key|token/iu);
  });

  it("refuses a page size outside §6.5's 1 … 100, an empty rendering, languages and a reserved raw key", () => {
    const query: SourceQuery = { terms: term("x"), limit: 1 };
    expect(() => buildBulkSearchRequest({ query, limit: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      buildBulkSearchRequest({
        query,
        limit: SEMANTICSCHOLAR_PAGE_SIZE_MAX + 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildBulkSearchRequest({
        query: { terms: term("~"), limit: 1 },
        limit: 1,
      }),
    ).toThrow(/renders to nothing/u);
    expect(() =>
      buildBulkSearchRequest({
        query: { ...query, languages: ["en"] },
        limit: 1,
      }),
    ).toThrow(/languages/u);
    for (const name of RESERVED_RAW_PARAMS) {
      expect(() =>
        buildBulkSearchRequest({
          query: { ...query, raw: { [name]: "v" } },
          limit: 1,
        }),
      ).toThrow(/reserved/u);
    }
    expect(RESERVED_RAW_PARAMS).toEqual([
      "query",
      "fields",
      "publicationDateOrYear",
      "limit",
      "token",
      "offset",
      "openAccessPdf",
    ]);
    // `P2-T34`: the two answers live on `SourceCapabilities.filters` now —
    // the bulk path's on the capabilities, the relevance endpoint's beside them.
    expect(SEMANTICSCHOLAR_FILTERS).toEqual({
      languages: false,
      openAccess: false,
    });
    expect(SEMANTICSCHOLAR_RELEVANCE_FILTERS).toEqual({
      languages: false,
      openAccess: true,
    });
    expect(SEMANTICSCHOLAR_QUERY_FILTER_SUPPORT).toEqual({ raw: true });
  });
});

describe("buildRelevanceSearchRequest — /paper/search (§6.5)", () => {
  it("sends the plain text with offset and limit, the full field list including tldr", () => {
    const request = buildRelevanceSearchRequest({
      query: {
        terms: parseUserQuery(EXAMPLE_INPUT),
        ...EXAMPLE_WINDOW,
        limit: 5,
      },
      limit: 5,
      offset: 10,
    });
    expect(request.endpointBaseUrl).toBe(SEMANTICSCHOLAR_RELEVANCE_SEARCH_URL);
    const params = new URLSearchParams(new URL(request.url).search);
    expect([...params.keys()]).toEqual([
      "query",
      "fields",
      "publicationDateOrYear",
      "offset",
      "limit",
    ]);
    expect(params.get("query")).toBe(EXAMPLE_PLAIN);
    expect(params.get("fields")).toBe(SEMANTICSCHOLAR_SEARCH_FIELDS.join(","));
    expect(params.get("offset")).toBe("10");
    expect(params.get("limit")).toBe("5");
    expect(request.rendered.excluded).toEqual([
      { value: "mouse", field: undefined },
    ]);
  });

  it("writes §6.5's openAccessPdf flag bare, between the window and offset, and refuses languages", () => {
    const request = buildRelevanceSearchRequest({
      query: { terms: term("x"), limit: 5, openAccessOnly: true },
      limit: 5,
      offset: 0,
    });
    expect(request.url).toBe(
      `${SEMANTICSCHOLAR_RELEVANCE_SEARCH_URL}?query=x&fields=${encodeURIComponent(
        SEMANTICSCHOLAR_SEARCH_FIELDS.join(","),
      )}&${SEMANTICSCHOLAR_OPEN_ACCESS_FLAG}&offset=0&limit=5`,
    );
    expect(() =>
      buildRelevanceSearchRequest({
        query: { terms: term("x"), limit: 5, languages: ["en"] },
        limit: 5,
        offset: 0,
      }),
    ).toThrow(/no language filter/u);
  });

  it("refuses offset + limit past §6.5's 1000, a negative offset and an empty text", () => {
    const query: SourceQuery = { terms: term("x"), limit: 1 };
    expect(() =>
      buildRelevanceSearchRequest({ query, limit: 100, offset: 901 }),
    ).toThrow(/1000/u);
    expect(() =>
      buildRelevanceSearchRequest({ query, limit: 100, offset: 900 }),
    ).not.toThrow();
    expect(() =>
      buildRelevanceSearchRequest({ query, limit: 1, offset: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      buildRelevanceSearchRequest({
        query: { terms: not(term("x")), limit: 1 },
        limit: 1,
        offset: 0,
      }),
    ).toThrow(/no plain text/u);
    expect(SEMANTICSCHOLAR_RELEVANCE_DEPTH_MAX).toBe(1000);
  });
});

describe("buildBatchRequest and buildPaperRequest", () => {
  it("POSTs {ids} as JSON with fields in the query string, §6.8's shape", () => {
    const request = buildBatchRequest(SEMANTICSCHOLAR_BATCH_IDS);
    expect(request.method).toBe("POST");
    expect(request.contentType).toBe("application/json");
    expect(request.url).toBe(
      `${SEMANTICSCHOLAR_BATCH_URL}?fields=${encodeURIComponent(
        SEMANTICSCHOLAR_SEARCH_FIELDS.join(","),
      )}`,
    );
    expect(JSON.parse(request.body)).toEqual({
      ids: SEMANTICSCHOLAR_BATCH_IDS,
    });
    expect(request.ids).toBe(SEMANTICSCHOLAR_BATCH_IDS);
    expect(request.transmittedUrl).toBe(request.url);
  });

  it("refuses an empty list and one over §6.8's 500", () => {
    expect(() => buildBatchRequest([])).toThrow(/at least one id/u);
    expect(() =>
      buildBatchRequest(
        Array.from(
          { length: SEMANTICSCHOLAR_BATCH_IDS_MAX + 1 },
          (_, i) => `CorpusId:${String(i)}`,
        ),
      ),
    ).toThrow(/at most 500/u);
    expect(SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT).toBe(100);
  });

  it("builds docs/09 §2.3's Semantic Scholar test call verbatim", () => {
    const request = buildPaperRequest(
      SEMANTICSCHOLAR_HEALTH_PAPER_ID,
      SEMANTICSCHOLAR_HEALTH_FIELDS,
    );
    expect(request.url).toBe(
      "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1038/s41586-023-06139-9?fields=paperId",
    );
    expect(request.method).toBe("GET");
    expect(request.body).toBeUndefined();
  });

  it("keeps the id prefix colon and a DOI's slash in the path, encodes the rest", () => {
    expect(encodePaperId("DOI:10.1038/s41586-023-06139-9")).toBe(
      "DOI:10.1038/s41586-023-06139-9",
    );
    expect(encodePaperId("URL:https://arxiv.org/abs/2106.15928v1")).toBe(
      "URL:https:%2F%2Farxiv.org/abs/2106.15928v1".replace("%2F%2F", "//"),
    );
    expect(encodePaperId("DOI:10.1000/a b#c")).toBe("DOI:10.1000/a%20b%23c");
  });
});

// ---------------------------------------------------------------------------
// 3. Capabilities, lossiness, the policy row
// ---------------------------------------------------------------------------

describe("SEMANTICSCHOLAR_CAPABILITIES", () => {
  it("declares the card's step 7 values and §12.3's S2 bulk column", () => {
    expect(SEMANTICSCHOLAR_CAPABILITIES).toEqual({
      keywordSearch: true,
      query: { or: true, not: true, phrase: true, fields: [] },
      relatedByWork: true,
      lookupById: ["doi", "pmid", "pmcid", "arxivId"],
      abstractsInSearch: true,
      citationGraph: true,
      dateFilter: true,
      filters: { languages: false, openAccess: false },
      maxPageSize: 100,
      maxTotalResults: undefined,
      benefitsFromApiKey: true,
    });
  });

  it("renders §12.2's example losing only the title: restriction", () => {
    const lost = normalizeForSource(
      parseUserQuery(EXAMPLE_INPUT),
      SEMANTICSCHOLAR_CAPABILITIES,
    );
    expect(lost).toEqual([{ kind: "term", value: "CRISPR", field: "title" }]);
    expect(
      normalizeForSource(
        parseUserQuery('"base editing" NOT mouse'),
        SEMANTICSCHOLAR_CAPABILITIES,
      ),
    ).toEqual([]);
  });

  it("names the display key by the one convention the corpus has, source-<id>", () => {
    expect(SEMANTICSCHOLAR_DISPLAY_NAME_KEY).toBe(
      `research-helper-source-${SEMANTICSCHOLAR_SOURCE_ID}`,
    );
    expect(SEMANTICSCHOLAR_SOURCE_ID).toBe("semanticscholar");
  });
});

describe("lossinessWarnings and excludedTermsWarning", () => {
  it("is silent for a faithfully rendered query and names every dropped field once", () => {
    expect(
      lossinessWarnings(parseUserQuery('"base editing" NOT mouse')),
    ).toEqual([]);
    const [warning] = lossinessWarnings(
      and(term("a", "title"), term("b", "title"), term("c", "author")),
    );
    expect(warning).toContain(SEMANTICSCHOLAR_APPROXIMATE_PREFIX);
    expect(warning).toContain("title:, author:");
    expect(warning).toContain("were dropped");
    expect(lossinessWarnings(term("a", "any"))).toEqual([]);
  });

  it("names the NOT terms the relevance endpoint dropped", () => {
    expect(excludedTermsWarning([])).toEqual([]);
    const [warning] = excludedTermsWarning([
      { value: "mouse", field: undefined },
      { value: "rat", field: "title" },
    ]);
    expect(warning).toContain(
      '2 excluded terms ("mouse", "title:rat") were dropped',
    );
    expect(warning).toContain("bulk search for a real NOT");
  });
});

describe("hostLimiter: the api.semanticscholar.org row", () => {
  function section73Row(host: string): Record<string, string> {
    const lines = readFileSync(DOCS_07, "utf8").split("\n");
    const start = lines.findIndex((l) => l.startsWith("### 7.3 "));
    expect(start).toBeGreaterThan(0);
    const header = lines.findIndex(
      (l, i) => i > start && l.startsWith("| Host |"),
    );
    const cells = (l: string) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
    const columns = cells(lines[header] ?? "");
    const row = lines
      .slice(header + 2)
      .find((l) => l.startsWith(`| \`${host}\``));
    if (row === undefined) throw new Error(`§7.3 has no row for ${host}`);
    const values = cells(row);
    expect(values).toHaveLength(columns.length);
    return Object.fromEntries(columns.map((c, i) => [c, values[i] ?? ""]));
  }

  it("is 0.9/s in both modes, burst 1, max concurrent 1, exactly as §7.3 writes it, with no keyed mode", () => {
    expect(SEMANTICSCHOLAR_HOST).toBe("api.semanticscholar.org");
    const row = section73Row(SEMANTICSCHOLAR_HOST);
    const rate = must(row["Rate"], "the Rate cell");
    expect(rate).toBe("0.9/s in both modes");
    expect(row["Burst"]).toBe("1");
    expect(row["Max concurrent"]).toBe("1");
    expect(row["Basis"]).toMatch(/guaranteed but lower 1 RPS/u);
    const policy = HOST_POLICIES.find((p) => p.host === SEMANTICSCHOLAR_HOST);
    expect(policy).toBeDefined();
    expect(policy?.withoutKey).toEqual({
      ratePerSecond: Number(rate.replace(/\/s.*$/u, "")),
      burst: Number(row["Burst"]),
      maxConcurrent: Number(row["Max concurrent"]),
    });
    expect(policy?.withoutKey.ratePerSecond).toBeLessThan(1);
    // "in both modes": a key changes the guarantee, not the budget, so the
    // row carries no second configuration and nothing paces on a flag.
    expect(policy?.withKey).toBeUndefined();
    expect(policy?.keyPresencePref).toBeUndefined();
    expect(policy?.headerDriven).toBeUndefined();
  });

  it("carries the retry budget §7.3's three cells state, read from the document", () => {
    const row = section73Row(SEMANTICSCHOLAR_HOST);
    const ms = (cell: string | undefined): number =>
      Number((cell ?? "").replace(/\s/g, "").replace("ms", ""));
    const retry = HOST_POLICIES.find(
      (p) => p.host === SEMANTICSCHOLAR_HOST,
    )?.retry;
    expect(retry).toEqual({
      baseMs: ms(row["Retry base"]),
      capMs: ms(row["Retry cap"]),
      maxAttempts: Number(row["Attempt cap"]),
    });
    expect(retry).toEqual({ baseMs: 2000, capMs: 30_000, maxAttempts: 3 });
  });

  it("is served by the registry as its own bucket, in table order after arXiv", () => {
    const registry = createHostLimiterRegistry({
      clock: createManualClock(NOW),
    });
    // Not a pin on the whole list: `tokenBucket.test.ts`'s `shippedHosts` and
    // `container.test.ts` own that expectation and grow by one per adapter
    // card (`P2-T07` is next).
    expect(registry.hosts).toContain(SEMANTICSCHOLAR_HOST);
    expect(registry.hosts.indexOf(SEMANTICSCHOLAR_HOST)).toBe(
      registry.hosts.indexOf(ARXIV_HOST) + 1,
    );
    expect(registry.hosts.slice(0, 4)).toEqual([
      NCBI_HOST,
      EBI_HOST,
      CROSSREF_HOST,
      ARXIV_HOST,
    ]);
    expect(registry.limiterFor(SEMANTICSCHOLAR_HOST)).toBeDefined();
    expect(registry.limiterFor(SEMANTICSCHOLAR_HOST)).not.toBe(
      registry.limiterFor(ARXIV_HOST),
    );
  });

  it("has a prefs row for key presence whose default is false and which is not secret (criterion 6)", () => {
    expect(PREFS.semanticscholarKeyPresent).toEqual({
      key: "semanticscholar.keyPresent",
      type: "boolean",
      default: false,
    });
    // Nothing under src/sources/semanticscholar/ names a preference writer
    // (criterion 5): the key is a header read from the SecretStore, never a
    // pref. Checked by reading the three modules' text.
    const dir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../src/sources/semanticscholar",
    );
    for (const name of ["query.ts", "mapper.ts", "semanticscholarSource.ts"]) {
      const text = readFileSync(`${dir}/${name}`, "utf8");
      expect(text).not.toMatch(/Zotero\.Prefs|setPref\(|getPref\(/u);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The mapper
// ---------------------------------------------------------------------------

describe("mapper: docs/02 §6.7's own sample response", () => {
  it("maps every field of the sample as §10.2's Semantic Scholar column prescribes", () => {
    const [record] = mapper()([SAMPLE_PAPER]);
    const r = must(record, "the record");
    expect(r.id).toBe(
      "semanticscholar:7d1e59ce254bea5228da634dbe7c5c4160df6f98",
    );
    expect(r.sourceId).toBe("semanticscholar");
    expect(r.nativeId).toBe("7d1e59ce254bea5228da634dbe7c5c4160df6f98");
    expect(r.retrievedAtEpochMs).toBe(NOW);
    expect(r.raw).toBeUndefined();
    expect(r.work.ids).toEqual({
      doi: "10.1038/s41586-023-06139-9",
      pmid: "37258680",
      // `PubMedCentral` arrives bare; `normalizePmcid` adds the prefix.
      pmcid: "PMC10949956",
      s2CorpusId: "259002047",
    });
    expect(r.work.title).toBe(SAMPLE_PAPER.title);
    expect(r.work.abstract).toBe(SAMPLE_PAPER.abstract);
    expect(r.work.type).toBe("journal-article");
    expect(r.work.containerTitle).toBe("Nature");
    expect(r.work.volume).toBe("618");
    expect(r.work.pages).toBe("616 - 624");
    expect(r.work.publishedDate).toEqual({
      year: 2023,
      month: 5,
      day: 31,
      iso: "2023-05-31",
    });
    expect(r.work.citationCount).toBe(1220);
    expect(r.work.referenceCount).toBe(159);
    expect(r.work.influentialCitationCount).toBe(137);
    expect(r.work.openAccess).toEqual({
      isOpenAccess: true,
      status: "green",
      pdfUrl: "https://escholarship.org/content/qt8st2d5mx/qt8st2d5mx.pdf",
    });
    expect(r.work.authors).toEqual([
      { family: "Theodoris", given: "C.", sequence: 0 },
      { family: "Xiao", given: "Ling", sequence: 1 },
      { family: "Ellinor", given: "P.", sequence: 2 },
    ]);
    expect(r.work.url).toBeUndefined();
    expect(r.work.subjects).toBeUndefined();
    expect(r.missingFields).toEqual(
      expect.arrayContaining(["issn", "subjects", "url", "ids.arxivId"]),
    );
    expect(r.missingFields).not.toContain("abstract");
    expect(r.missingFields).not.toContain("ids.pmcid");
  });

  it("uses tldr.text only as the fallback for a missing abstract (§6.7), and exposes it through readTldr", () => {
    const { abstract: _dropped, ...withoutAbstract } = SAMPLE_PAPER;
    const [record] = mapper()([withoutAbstract]);
    expect(must(record, "the record").work.abstract).toBe(
      SAMPLE_PAPER.tldr.text,
    );
    expect(readTldr(SAMPLE_PAPER)).toBe(SAMPLE_PAPER.tldr.text);
    expect(readTldr({ paperId: "x" })).toBeUndefined();
    const [withBoth] = mapper()([SAMPLE_PAPER]);
    expect(must(withBoth, "the record").work.abstract).toBe(
      SAMPLE_PAPER.abstract,
    );
  });

  it("does not carry openAccessPdf.disclaimer: docs/07 §5.1's OpenAccessInfo has no rights slot", () => {
    const oa = readOpenAccess(SAMPLE_PAPER);
    expect(oa).toBeDefined();
    expect(JSON.stringify(oa)).not.toContain("Notice: Paper or abstract");
    expect(Object.keys(oa ?? {}).sort()).toEqual([
      "isOpenAccess",
      "pdfUrl",
      "status",
    ]);
  });

  it("keeps the parsed paper as raw only when asked", () => {
    const [record] = mapper({ keepRaw: true })([SAMPLE_PAPER]);
    expect(must(record, "the record").raw).toBe(SAMPLE_PAPER);
  });
});

describe("mapper: hand-built edge cases", () => {
  it("normalises a bare PubMedCentral id to PMC<digits> and the other ids through src/model/ids.ts", () => {
    expect(
      readExternalIds({
        paperId: "p",
        corpusId: 7,
        externalIds: {
          PubMedCentral: "2323736",
          DOI: "10.18653/V1/N18-3011",
          PubMed: "19872477",
          ArXiv: "2106.15928v2",
        },
      }),
    ).toEqual({
      doi: "10.18653/v1/n18-3011",
      pmid: "19872477",
      pmcid: "PMC2323736",
      arxivId: "2106.15928",
      s2CorpusId: "7",
    });
    // An already-prefixed value is accepted too, and a non-id is dropped.
    expect(
      readExternalIds({
        externalIds: { PubMedCentral: "PMC10949956", DOI: "not a doi" },
      }),
    ).toEqual({ pmcid: "PMC10949956" });
    // `url` is the fallback identifier only when no stable one exists.
    expect(
      readExternalIds({ url: "https://www.semanticscholar.org/paper/x" }),
    ).toEqual({
      url: "https://www.semanticscholar.org/paper/x",
    });
    expect(
      readExternalIds({ url: "https://x", externalIds: { CorpusId: 5 } }),
    ).toEqual({ s2CorpusId: "5" });
  });

  it("maps publicationDate at day precision and falls back to year (§6.5's null publicationDate)", () => {
    expect(readPublishedDate("2023-05-31", 2023)).toEqual({
      year: 2023,
      month: 5,
      day: 31,
      iso: "2023-05-31",
    });
    expect(readPublishedDate(null, 2019)).toEqual({ year: 2019, iso: "2019" });
    expect(readPublishedDate("2023-13-01", 2023)).toEqual({
      year: 2023,
      iso: "2023",
    });
    expect(readPublishedDate(undefined, undefined)).toBeUndefined();
    expect(readPublishedDate("2023-05", 0)).toBeUndefined();
  });

  it("splits an author name on its last space; a one-token name is family only", () => {
    expect(splitAuthorName("C. Theodoris")).toEqual({
      family: "Theodoris",
      given: "C.",
    });
    expect(splitAuthorName("Chenhang Christopher Zhang")).toEqual({
      family: "Zhang",
      given: "Chenhang Christopher",
    });
    expect(splitAuthorName("Plato")).toEqual({
      family: "Plato",
      given: undefined,
    });
  });

  it("applies §10.2's type rules in rule order: preprint venue, Conference, BookSection, JournalArticle, then the venue default", () => {
    const type = (
      paper: Record<string, unknown>,
      venue?: string,
      hasJournal = false,
    ) => readType(paper, venue, hasJournal).type;
    expect(type({ publicationTypes: ["JournalArticle"] }, "bioRxiv")).toBe(
      "preprint",
    );
    expect(type({}, "arXiv.org")).toBe("preprint");
    expect(type({}, "Research Square")).toBe("preprint");
    expect(
      type({ publicationTypes: ["JournalArticle", "Conference"] }, "CLEO"),
    ).toBe("conference-paper");
    expect(type({ publicationTypes: ["BookSection"] })).toBe("book-chapter");
    expect(
      type(
        { publicationTypes: ["Review", "JournalArticle"] },
        "Nature Methods",
      ),
    ).toBe("journal-article");
    expect(type({ publicationTypes: ["Review"] })).toBe("review");
    expect(type({ publicationTypes: ["Dataset"] })).toBe("dataset");
    expect(type({ publicationTypes: ["News"] }, "Nature", true)).toBe(
      "journal-article",
    );
    expect(readType({ publicationTypes: null }, undefined, false)).toEqual({
      type: "other",
      classified: false,
    });
    // Beyond §10.2's cell: an arXiv-only record with no venue is a preprint.
    expect(readType({}, undefined, false, true)).toEqual({
      type: "preprint",
      classified: true,
    });
    expect(SEMANTICSCHOLAR_PREPRINT_VENUES.has("medrxiv")).toBe(true);
  });

  it("types a venue-less, arXiv-only paper as a preprint through the mapper (measured on record-preprint)", () => {
    const [record] = mapper()([
      {
        paperId: "bbb932b6b54a773300fc4333d0bd61581a97c35e",
        externalIds: { ArXiv: "2609.04658", CorpusId: 291767761 },
        venue: "",
        journal: null,
        publicationTypes: null,
        title: "VizIt",
        authors: [],
      },
    ]);
    const r = must(record, "the record");
    expect(r.work.type).toBe("preprint");
    expect(r.work.ids).toEqual({
      arxivId: "2609.04658",
      s2CorpusId: "291767761",
    });
    expect(r.work.containerTitle).toBeUndefined();
    expect(r.missingFields).not.toContain("type");
  });

  it("merges fieldsOfStudy and s2FieldsOfStudy into one scheme, every term once", () => {
    expect(
      readSubjects({
        fieldsOfStudy: ["Medicine", "Biology"],
        s2FieldsOfStudy: [
          { category: "Medicine", source: "external" },
          { category: "Computer Science", source: "s2-fos-model" },
        ],
      }),
    ).toEqual([
      { term: "Medicine", scheme: SEMANTICSCHOLAR_FIELD_OF_STUDY_SCHEME },
      { term: "Biology", scheme: SEMANTICSCHOLAR_FIELD_OF_STUDY_SCHEME },
      {
        term: "Computer Science",
        scheme: SEMANTICSCHOLAR_FIELD_OF_STUDY_SCHEME,
      },
    ]);
    expect(readSubjects({ fieldsOfStudy: null })).toEqual([]);
  });

  it("reads open access from isOpenAccess and openAccessPdf, and nothing when the paper says nothing", () => {
    expect(
      readOpenAccess({
        isOpenAccess: false,
        openAccessPdf: { url: "", status: null },
      }),
    ).toEqual({
      isOpenAccess: false,
    });
    expect(
      readOpenAccess({
        openAccessPdf: { url: "https://x/a.pdf", license: "CCBY" },
      }),
    ).toEqual({
      isOpenAccess: true,
      pdfUrl: "https://x/a.pdf",
      license: "CCBY",
    });
    expect(readOpenAccess({})).toBeUndefined();
  });

  it("skips a null entry without shifting its neighbours, and drops a paper with no paperId with a warning", () => {
    const { logger, lines } = createSpyLogger();
    const records = mapper({ logger })([
      { ...SAMPLE_PAPER, paperId: "a" },
      null,
      { title: "no id" },
      { ...SAMPLE_PAPER, paperId: "d" },
    ]);
    expect(records.map((r) => r.nativeId)).toEqual(["a", "d"]);
    expect(lines.filter((l) => l.includes("no paperId"))).toHaveLength(1);
    expect(lines.some((l) => l.includes("null"))).toBe(false);
  });

  it("reports what is absent in missingFields, and the constants cover every §10.2 cell the mapper reads", () => {
    const sparse = must(
      // `mapPaper` answers `null` for a dropped entry; `must` checks `undefined`.
      mapPaper(
        { paperId: "s", title: "T", authors: [{ name: "A B" }] },
        NOW,
        false,
        () => undefined,
      ) ?? undefined,
      "the record",
    );
    expect(sparse.missingFields).toEqual(
      SEMANTICSCHOLAR_MAPPABLE_FIELDS.filter(
        (f) => !["title", "authors"].includes(f),
      ),
    );
    expect(SEMANTICSCHOLAR_MAPPABLE_FIELDS).toContain("ids.pmcid");
    expect(SEMANTICSCHOLAR_MAPPABLE_FIELDS).toContain(
      "influentialCitationCount",
    );
  });

  it("drops authors with no name, with one warning, and keeps sequence contiguous", () => {
    const { logger, lines } = createSpyLogger();
    const [record] = mapper({ logger })([
      {
        paperId: "p",
        authors: [
          { name: "A B" },
          { authorId: "1" },
          { name: "" },
          { name: "C D" },
        ],
      },
    ]);
    expect(must(record, "the record").work.authors).toEqual([
      { family: "B", given: "A", sequence: 0 },
      { family: "D", given: "C", sequence: 1 },
    ]);
    expect(
      lines.filter(
        (l) => l.includes("authors dropped") && l.includes('"dropped":2'),
      ),
    ).toHaveLength(1);
  });

  it("reads publicationVenue.issn as a string or a list", () => {
    const [asString] = mapper()([
      { paperId: "a", publicationVenue: { issn: "0028-0836" } },
    ]);
    expect(must(asString, "a").work.issn).toEqual(["0028-0836"]);
    const [asList] = mapper()([
      {
        paperId: "b",
        publicationVenue: { issn: ["1548-7091", "1548-7105", "1548-7091"] },
      },
    ]);
    expect(must(asList, "b").work.issn).toEqual(["1548-7091", "1548-7105"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Bodies, ids and paging
// ---------------------------------------------------------------------------

describe("parseSearchBody, parseBatchBody, parsePaperBody", () => {
  it("returns data, total, token and next", () => {
    expect(
      parseSearchBody(page([{ paperId: "a" }], { total: 9, token: "t" }), "u"),
    ).toEqual({
      data: [{ paperId: "a" }],
      total: 9,
      token: "t",
      next: undefined,
    });
    expect(parseSearchBody(page([], { total: 0, token: null }), "u")).toEqual({
      data: [],
      total: 0,
      token: undefined,
      next: undefined,
    });
    expect(
      parseSearchBody(page([{ paperId: "a" }], { next: 5 }), "u").next,
    ).toBe(5);
  });

  it("turns both of Semantic Scholar's error envelopes into a SourceError (§6.4, §6.10)", () => {
    expect(() =>
      parseSearchBody(
        '{"error":"Unrecognized or unsupported fields: [x]"}',
        "u",
      ),
    ).toThrow(SourceError);
    expect(() => parseSearchBody(MEASURED_429_BODY, "u")).toThrow(
      /Too Many Requests/u,
    );
    expect(() =>
      parseBatchBody('{"error":"No valid paper ids given"}', "u"),
    ).toThrow(SourceError);
    expect(() =>
      parsePaperBody('{"error":"Paper with id x not found"}', "u"),
    ).toThrow(SourceError);
  });

  it("throws ParseError for a body that is not JSON or not the expected shape", () => {
    expect(() => parseSearchBody("<html>", "u")).toThrow(ParseError);
    expect(() => parseSearchBody('{"total":1}', "u")).toThrow(/no data/u);
    expect(() => parseBatchBody('{"data":[]}', "u")).toThrow(/not an array/u);
    expect(() => parsePaperBody('{"title":"x"}', "u")).toThrow(/no paperId/u);
    expect(parseBatchBody('[null, {"paperId":"a"}]', "u")).toEqual([
      null,
      { paperId: "a" },
    ]);
    expect(parsePaperBody('{"paperId": "a"}', "u")).toEqual({ paperId: "a" });
  });
});

describe("toSemanticScholarId — §6.3's prefixes", () => {
  it("prefers DOI, then PMID, then a bare-digit PMCID, then ARXIV, then CorpusId", () => {
    const doi = "10.1038/x" as SourceRecord["work"]["ids"]["doi"] & string;
    const pmid = "37258680" as SourceRecord["work"]["ids"]["pmid"] & string;
    const pmcid = "PMC2323736" as SourceRecord["work"]["ids"]["pmcid"] & string;
    const arxivId = "2106.15928" as SourceRecord["work"]["ids"]["arxivId"] &
      string;
    const s2CorpusId =
      "215416146" as SourceRecord["work"]["ids"]["s2CorpusId"] & string;
    expect(toSemanticScholarId({ doi, pmid, pmcid, arxivId, s2CorpusId })).toBe(
      "DOI:10.1038/x",
    );
    expect(toSemanticScholarId({ pmid, pmcid })).toBe("PMID:37258680");
    expect(toSemanticScholarId({ pmcid })).toBe("PMCID:2323736");
    expect(toSemanticScholarId({ arxivId })).toBe("ARXIV:2106.15928");
    expect(toSemanticScholarId({ s2CorpusId })).toBe("CorpusId:215416146");
    expect(toSemanticScholarId({})).toBeUndefined();
    expect(toSemanticScholarId({ url: "https://x" })).toBeUndefined();
  });
});

describe("nextTokenAfter, nextOffsetAfter, readOffsetCursor and clampPageSize", () => {
  it("continues on a fresh token, a short page included; stops on no token, a repeated token or an empty page", () => {
    expect(nextTokenAfter(undefined, "t2", 100)).toBe("t2");
    expect(nextTokenAfter("t1", "t2", 100)).toBe("t2");
    // The bulk endpoint ignores `limit` (measured), so a page shorter than the
    // limit sent is no end signal: the server's token is (P2-T05, 2026-10-15).
    expect(nextTokenAfter(undefined, "t2", 3)).toBe("t2");
    expect(nextTokenAfter("t1", undefined, 100)).toBeUndefined();
    expect(nextTokenAfter("t1", "t1", 100)).toBeUndefined();
    expect(nextTokenAfter(undefined, "t2", 0)).toBeUndefined();
  });

  it("uses the server's next offset below the 1000 depth, short page included; stops on an empty page or a next that does not advance", () => {
    expect(nextOffsetAfter(100, 100, 0)).toBe("100");
    expect(nextOffsetAfter(5, 3, 0)).toBe("5");
    expect(nextOffsetAfter(undefined, 100, 0)).toBeUndefined();
    expect(nextOffsetAfter(1000, 100, 900)).toBeUndefined();
    expect(nextOffsetAfter(999, 1, 998)).toBe("999");
    expect(nextOffsetAfter(5, 0, 0)).toBeUndefined();
    expect(nextOffsetAfter(10, 5, 10)).toBeUndefined();
    expect(nextOffsetAfter(9, 5, 10)).toBeUndefined();
  });

  it("reads a decimal cursor as an offset and restarts at 0 for anything else", () => {
    expect(readOffsetCursor("10")).toBe(10);
    expect(readOffsetCursor("abc")).toBe(0);
    expect(readOffsetCursor(undefined)).toBe(0);
    expect(readOffsetCursor("-1")).toBe(0);
    expect(readOffsetCursor("99999")).toBe(999);
  });

  it("clamps limit to 1 … 100 and to what is left below 1000", () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(20)).toBe(20);
    expect(clampPageSize(500)).toBe(100);
    expect(clampPageSize(Number.NaN)).toBe(1);
    expect(clampPageSize(100, 950)).toBe(50);
    expect(clampPageSize(3.9)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 6. The adapter — identity, the key header, the degradation path
// ---------------------------------------------------------------------------

describe("createSemanticScholarSource — identity", () => {
  it("reports its identity, its display key, its host, and that it is usable without a key", async () => {
    const source = createSource(
      createStubHttp((i) => response(i.url, page([]))).client,
    );
    expect(source.id).toBe("semanticscholar");
    expect(source.displayNameKey).toBe(
      "research-helper-source-semanticscholar",
    );
    expect(source.rateLimitKey).toBe(SEMANTICSCHOLAR_HOST);
    expect(source.capabilities).toBe(SEMANTICSCHOLAR_CAPABILITIES);
    expect(source.isConfigured()).toBe(true);
    expect(await source.hasApiKey()).toBe(false);
    expect(source.explainQuery(QUERY_TYPICAL)).toBe(
      `query=${EXAMPLE_BULK}&publicationDateOrYear=2023-01-01:2023-12-31`,
    );
    expect(source.lookup).toBeDefined();
    expect(source.fetchAbstract).toBeDefined();
    expect(source.findRelated).toBeDefined();
  });

  it("P2-T34: capabilities.filters is the bulk renderer's own object, and equals what it does", () => {
    expect(SEMANTICSCHOLAR_CAPABILITIES.filters).toBe(SEMANTICSCHOLAR_FILTERS);
    const source = createSource(
      createStubHttp((i) => response(i.url, page([]))).client,
    );
    expect(source.capabilities.filters).toEqual({
      languages: false,
      openAccess: false,
    });
    // Both false on the default (bulk) path → both refused by name.
    expect(() =>
      source.explainQuery({ ...QUERY_TYPICAL, languages: ["en"] }),
    ).toThrow("SEMANTICSCHOLAR_CAPABILITIES.filters.languages is false");
    expect(() =>
      source.explainQuery({ ...QUERY_TYPICAL, openAccessOnly: true }),
    ).toThrow("SEMANTICSCHOLAR_CAPABILITIES.filters.openAccess is false");
  });

  it("reports key presence through the store's cheap has(), and false when the store throws", async () => {
    const keyed = createSource(
      createStubHttp((i) => response(i.url, page([]))).client,
      {
        secrets: fakeSecrets(),
      },
    );
    expect(await keyed.hasApiKey()).toBe(true);
    const absent = createSource(
      createStubHttp((i) => response(i.url, page([]))).client,
      {
        secrets: fakeSecrets(undefined),
      },
    );
    expect(await absent.hasApiKey()).toBe(false);
    expect(absent.isConfigured()).toBe(true);
  });
});

describe("createSemanticScholarSource — the x-api-key header (criterion 2's first half)", () => {
  it("sends no x-api-key and says so on the page when no store is injected (the degradation path)", async () => {
    const stub = createStubHttp((i) => response(i.url, page([SAMPLE_PAPER])));
    const source = createSource(stub.client);
    const result = await source.search(QUERY_TYPICAL, ctx());
    const [issued] = stub.issued;
    expect(
      headerOf(must(issued, "the request"), SEMANTICSCHOLAR_API_KEY_HEADER),
    ).toBeUndefined();
    expect(headerOf(must(issued, "the request"), "Accept")).toBe(
      "application/json",
    );
    expect(result.warnings).toContain(SEMANTICSCHOLAR_UNKEYED_NOTE);
    expect(SEMANTICSCHOLAR_UNKEYED_NOTE).toContain(
      SEMANTICSCHOLAR_KEY_REQUEST_URL,
    );
    expect(SEMANTICSCHOLAR_UNKEYED_NOTE).toMatch(/Add a free key/u);
    expect(result.sourceExtras.keyed).toBe(false);
    expect(result.records).toHaveLength(1);
  });

  it("sends no x-api-key when the store holds no key, or an empty one", async () => {
    for (const value of [undefined, "   "]) {
      const stub = createStubHttp((i) => response(i.url, page([])));
      const source = createSource(stub.client, { secrets: fakeSecrets(value) });
      const result = await source.search(QUERY_TYPICAL, ctx());
      expect(
        headerOf(
          must(stub.issued[0], "the request"),
          SEMANTICSCHOLAR_API_KEY_HEADER,
        ),
      ).toBeUndefined();
      expect(result.warnings).toContain(SEMANTICSCHOLAR_UNKEYED_NOTE);
    }
  });

  it("sends x-api-key with exactly the store's value on every request — search, lookup, fetchAbstract, healthCheck — and drops the note", async () => {
    const secrets = fakeSecrets();
    const stub = createStubHttp((i) =>
      i.method === "POST"
        ? response(i.url, JSON.stringify([SAMPLE_PAPER]))
        : i.url.includes("/paper/DOI:")
          ? response(i.url, '{"paperId": "7d1e"}')
          : response(i.url, page([SAMPLE_PAPER])),
    );
    const source = createSource(stub.client, { secrets });
    const result = await source.search(QUERY_TYPICAL, ctx());
    expect(result.warnings).not.toContain(SEMANTICSCHOLAR_UNKEYED_NOTE);
    expect(result.sourceExtras.keyed).toBe(true);
    await source.searchByRelevance(QUERY_RELEVANCE, ctx());
    await source.lookup([{ pmid: "37258680" as never }], ctx());
    await source.fetchAbstract({ pmid: "37258680" as never }, ctx());
    const health = await source.healthCheck(ctx());
    expect(health.ok).toBe(true);
    expect(health.quotaHint).toMatch(/^keyed/u);
    expect(stub.issued).toHaveLength(5);
    for (const issued of stub.issued) {
      expect(headerOf(issued, SEMANTICSCHOLAR_API_KEY_HEADER)).toBe(
        PLACEHOLDER_KEY,
      );
      // The header carries the key; the URL never does.
      expect(issued.url).not.toContain(PLACEHOLDER_KEY);
    }
    // Read per request, never cached: five requests, five reads.
    expect(secrets.reads).toEqual(Array(5).fill(SEMANTICSCHOLAR_SECRET_ID));
    expect(SEMANTICSCHOLAR_SECRET_ID).toBe("source.semanticscholar");
  });

  it("takes a key added mid-session on the very next request", async () => {
    let value: string | undefined = undefined;
    const store = fakeSecrets();
    const live: SecretStore = { ...store, get: () => Promise.resolve(value) };
    const stub = createStubHttp((i) => response(i.url, page([])));
    const source = createSource(stub.client, { secrets: live });
    await source.search(QUERY_TYPICAL, ctx());
    value = PLACEHOLDER_KEY;
    await source.search(QUERY_TYPICAL, ctx());
    expect(
      stub.issued.map((i) => headerOf(i, SEMANTICSCHOLAR_API_KEY_HEADER)),
    ).toEqual([undefined, PLACEHOLDER_KEY]);
  });

  it("degrades to unkeyed with one warn line when the store throws, and never logs the key", async () => {
    const { logger, lines } = createSpyLogger();
    const stub = createStubHttp((i) => response(i.url, page([SAMPLE_PAPER])));
    const broken = createSource(stub.client, {
      secrets: fakeSecrets(PLACEHOLDER_KEY, { throwOnGet: true }),
      logger,
    });
    const result = await broken.search(QUERY_TYPICAL, ctx());
    expect(
      headerOf(
        must(stub.issued[0], "the request"),
        SEMANTICSCHOLAR_API_KEY_HEADER,
      ),
    ).toBeUndefined();
    expect(result.warnings).toContain(SEMANTICSCHOLAR_UNKEYED_NOTE);
    expect(
      lines.filter((l) => l.startsWith("warn") && l.includes("going unkeyed")),
    ).toHaveLength(1);

    const spy = createSpyLogger();
    const keyedStub = createStubHttp((i) =>
      response(i.url, page([SAMPLE_PAPER])),
    );
    const keyed = createSource(keyedStub.client, {
      secrets: fakeSecrets(),
      logger: spy.logger,
    });
    await keyed.search(QUERY_TYPICAL, ctx());
    expect(spy.lines.length).toBeGreaterThan(0);
    for (const line of spy.lines) {
      expect(line).not.toContain(PLACEHOLDER_KEY);
      expect(line).not.toMatch(/x-api-key/iu);
    }
    expect(spy.lines.some((l) => l.includes('"keyed":true'))).toBe(true);
  });

  it("is caught by both redaction gates if it ever did reach one: the logger's field-name rule and the recorder's header deny-list", () => {
    // `src/core/logger.ts` redacts every context field whose name matches
    // KEYISH_FIELD before it is written; `x-api-key` matches.
    expect(KEYISH_FIELD.test(SEMANTICSCHOLAR_API_KEY_HEADER)).toBe(true);
    // `scripts/record-fixtures.ts` drops the header from every recorded
    // exchange (docs/13 §3.2) — so even a keyed recording could not write it.
    const { exchange, notes } = redactExchange(
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "X-Api-Key": PLACEHOLDER_KEY,
        },
        body: "{}",
      },
      [],
    );
    expect(exchange.headers).toEqual({ "content-type": "application/json" });
    expect(notes).toContain("dropped header x-api-key");
  });
});

describe("createSemanticScholarSource — search (bulk) and searchByRelevance", () => {
  it("sends the bulk request as text with the cursor as token, maps the page, carries total, token and the lossiness notice", async () => {
    const stub = createStubHttp((i) =>
      response(
        i.url,
        page([SAMPLE_PAPER, { ...SAMPLE_PAPER, paperId: "b" }], {
          total: 50,
          token: "t2",
        }),
      ),
    );
    const source = createSource(stub.client);
    const result = await source.search(
      { ...QUERY_TYPICAL, limit: 2, cursor: "t1" },
      ctx(),
    );
    const [issued] = stub.issued;
    expect(must(issued, "the request").method).toBe("GET");
    expect(must(issued, "the request").options?.responseType).toBe("text");
    expect(paramsOf(must(issued, "the request")).get("token")).toBe("t1");
    expect(paramsOf(must(issued, "the request")).get("limit")).toBe("2");
    expect(result.records.map((r) => r.nativeId)).toEqual([
      SAMPLE_PAPER.paperId,
      "b",
    ]);
    expect(result.totalAvailable).toBe(50);
    expect(result.nextCursor).toBe("t2");
    expect(result.sourceExtras).toEqual({
      endpoint: "bulk",
      total: 50,
      token: "t1",
      offset: undefined,
      keyed: false,
    });
    // The typical query carries `title:CRISPR`, which the bulk syntax drops.
    expect(result.warnings.some((w) => w.includes("title:"))).toBe(true);
  });

  it("follows the server's token past a short page; stops on an empty page, a repeated token or no token", async () => {
    const stub = createStubHttp(
      (i, index) =>
        [
          response(i.url, page([SAMPLE_PAPER], { total: 9, token: "t" })),
          response(i.url, page([], { total: 9, token: "u" })),
          response(i.url, page([SAMPLE_PAPER], { total: 9, token: "t" })),
          response(i.url, page([SAMPLE_PAPER], { total: 9 })),
        ][index] ?? response(i.url, page([])),
    );
    const source = createSource(stub.client);
    // 1 record for limit 5, with a token: the bulk endpoint ignores `limit`
    // (measured), so only the token says whether more exists.
    expect(
      (await source.search({ ...QUERY_TYPICAL, limit: 5 }, ctx())).nextCursor,
    ).toBe("t");
    expect(
      (await source.search({ ...QUERY_TYPICAL, limit: 5 }, ctx())).nextCursor,
    ).toBeUndefined();
    expect(
      (await source.search({ ...QUERY_TYPICAL, limit: 5, cursor: "t" }, ctx()))
        .nextCursor,
    ).toBeUndefined();
    expect(
      (await source.search({ ...QUERY_TYPICAL, limit: 5 }, ctx())).nextCursor,
    ).toBeUndefined();
  });

  it("searchByRelevance sends plain text with offset/limit and names the dropped NOT term", async () => {
    const stub = createStubHttp((i) =>
      response(i.url, page([SAMPLE_PAPER], { total: 500, next: 5 })),
    );
    const source = createSource(stub.client);
    const result = await source.searchByRelevance(
      { ...QUERY_RELEVANCE, cursor: "0" },
      ctx(),
    );
    const params = paramsOf(must(stub.issued[0], "the request"));
    expect(
      must(stub.issued[0], "the request").url.startsWith(
        SEMANTICSCHOLAR_RELEVANCE_SEARCH_URL,
      ),
    ).toBe(true);
    expect(params.get("query")).toBe(EXAMPLE_PLAIN);
    expect(params.get("offset")).toBe("0");
    expect(params.get("limit")).toBe("5");
    expect(result.nextCursor).toBe("5");
    expect(result.sourceExtras.endpoint).toBe("relevance");
    expect(result.sourceExtras.offset).toBe(0);
    expect(
      result.warnings.some(
        (w) => w.includes('"mouse"') && w.includes("plain text"),
      ),
    ).toBe(true);
    expect(result.warnings).toContain(SEMANTICSCHOLAR_UNKEYED_NOTE);
  });

  it("refuses an unrenderable query before any request and honours cancellation", async () => {
    const stub = createStubHttp((i) => response(i.url, page([])));
    const source = createSource(stub.client);
    await expect(
      source.search({ terms: not(term("x")), limit: 1 }, ctx()),
    ).rejects.toThrow(RangeError);
    await expect(
      source.search({ terms: term("x"), limit: 1, languages: ["en"] }, ctx()),
    ).rejects.toThrow(/language/u);
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });
    await expect(
      source.search(QUERY_TYPICAL, { token: cts.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(stub.issued).toHaveLength(0);
  });
});

describe("createSemanticScholarSource — searchAll (token paging, criterion 'token paging')", () => {
  it("pages by token until limit, raising the notices once and reporting progress", async () => {
    const stub = createStubHttp((i, index) => {
      const token = paramsOf(i).get("token");
      if (index === 0) {
        expect(token).toBeNull();
        return response(
          i.url,
          page(
            [
              { ...SAMPLE_PAPER, paperId: "a" },
              { ...SAMPLE_PAPER, paperId: "b" },
            ],
            { total: 5, token: "T1" },
          ),
        );
      }
      if (index === 1) {
        expect(token).toBe("T1");
        return response(
          i.url,
          page(
            [
              { ...SAMPLE_PAPER, paperId: "c" },
              { ...SAMPLE_PAPER, paperId: "d" },
            ],
            { total: 5, token: "T2" },
          ),
        );
      }
      expect(token).toBe("T2");
      return response(
        i.url,
        page([{ ...SAMPLE_PAPER, paperId: "e" }], { total: 5 }),
      );
    });
    const warnings: string[] = [];
    const progress: number[] = [];
    const reporter: ProgressReporter = {
      warn: (w: string) => warnings.push(w),
      setProgress: (done: number) => progress.push(done),
    } as unknown as ProgressReporter;
    const source = createSource(stub.client);
    const seen: string[] = [];
    for await (const record of source.searchAll(
      { ...QUERY_TYPICAL, limit: 5 },
      { ...ctx(), progress: reporter },
    )) {
      seen.push(record.nativeId);
    }
    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
    expect(stub.issued.map((i) => paramsOf(i).get("limit"))).toEqual([
      "5",
      "3",
      "1",
    ]);
    expect(
      warnings.filter((w) => w === SEMANTICSCHOLAR_UNKEYED_NOTE),
    ).toHaveLength(1);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops at limit inside a page and on exhaustion", async () => {
    const stub = createStubHttp((i) =>
      response(
        i.url,
        page(
          [
            { ...SAMPLE_PAPER, paperId: "a" },
            { ...SAMPLE_PAPER, paperId: "b" },
            { ...SAMPLE_PAPER, paperId: "c" },
          ],
          { total: 3, token: "more" },
        ),
      ),
    );
    const source = createSource(stub.client);
    const seen: string[] = [];
    for await (const record of source.searchAll(
      { ...QUERY_TYPICAL, limit: 2 },
      ctx(),
    ))
      seen.push(record.nativeId);
    expect(seen).toEqual(["a", "b"]);
    expect(stub.issued).toHaveLength(1);
  });
});

describe("createSemanticScholarSource — lookup over /paper/batch (criterion 3) and fetchAbstract", () => {
  it("index-matches the answer: a null at index 2 is skipped without shifting index 3", async () => {
    const stub = createStubHttp((i) => {
      const body = JSON.parse(must(i.options?.body, "the body")) as {
        ids: string[];
      };
      expect(body.ids).toEqual([
        "DOI:10.1/a",
        "PMID:2",
        "PMCID:3",
        "ARXIV:2106.15928",
      ]);
      return response(
        i.url,
        JSON.stringify([
          { ...SAMPLE_PAPER, paperId: "pa" },
          { ...SAMPLE_PAPER, paperId: "pb" },
          null,
          { ...SAMPLE_PAPER, paperId: "pd" },
        ]),
      );
    });
    const { logger, lines } = createSpyLogger();
    const source = createSource(stub.client, { logger });
    const records = await source.lookup(
      [
        { doi: "10.1/a" as never },
        { pmid: "2" as never },
        { pmcid: "PMC3" as never },
        { arxivId: "2106.15928" as never },
        {},
        { doi: "10.1/a" as never },
      ],
      ctx(),
    );
    expect(records.map((r) => r.nativeId)).toEqual(["pa", "pb", "pd"]);
    expect(must(stub.issued[0], "the request").method).toBe("POST");
    expect(headerOf(must(stub.issued[0], "the request"), "Content-Type")).toBe(
      "application/json",
    );
    expect(
      lines.some((l) => l.includes("unknown ids") && l.includes('"unknown":1')),
    ).toBe(true);
  });

  it("sends ~100 ids per POST when abstracts are requested (§6.8's 10 MB cap)", async () => {
    const stub = createStubHttp((i) => {
      const { ids } = JSON.parse(must(i.options?.body, "the body")) as {
        ids: string[];
      };
      return response(
        i.url,
        JSON.stringify(ids.map((id) => ({ ...SAMPLE_PAPER, paperId: id }))),
      );
    });
    const source = createSource(stub.client);
    const ids = Array.from({ length: 250 }, (_, n) => ({
      pmid: String(1000 + n) as never,
    }));
    const records = await source.lookup(ids, ctx());
    expect(records).toHaveLength(250);
    expect(
      stub.issued.map(
        (i) =>
          (JSON.parse(must(i.options?.body, "b")) as { ids: string[] }).ids
            .length,
      ),
    ).toEqual([100, 100, 50]);
    expect(await source.lookup([{}], ctx())).toEqual([]);
  });

  it("fetchAbstract asks for abstract and tldr by one id and falls back to the TL;DR", async () => {
    const stub = createStubHttp((i, index) =>
      response(
        i.url,
        JSON.stringify([
          index === 0
            ? {
                paperId: "a",
                abstract: "  The abstract.  ",
                tldr: { text: "tl" },
              }
            : { paperId: "a", abstract: null, tldr: { text: "the tldr" } },
        ]),
      ),
    );
    const source = createSource(stub.client);
    expect(await source.fetchAbstract({ doi: "10.1/a" as never }, ctx())).toBe(
      "The abstract.",
    );
    expect(await source.fetchAbstract({ doi: "10.1/a" as never }, ctx())).toBe(
      "the tldr",
    );
    expect(paramsOf(must(stub.issued[0], "the request")).get("fields")).toBe(
      SEMANTICSCHOLAR_ABSTRACT_FIELDS.join(","),
    );
    expect(await source.fetchAbstract({}, ctx())).toBeUndefined();
    expect(stub.issued).toHaveLength(2);
  });
});

describe("createSemanticScholarSource — healthCheck (docs/09 §2.3's test call)", () => {
  it("is ok on a body with paperId, unkeyed hint without a store, and never sends user content", async () => {
    const stub = createStubHttp((i) =>
      response(
        i.url,
        '{"paperId": "7d1e59ce254bea5228da634dbe7c5c4160df6f98"}',
      ),
    );
    const source = createSource(stub.client);
    const health = await source.healthCheck(ctx());
    expect(health.ok).toBe(true);
    expect(health.messageKey).toBe(SEMANTICSCHOLAR_DISPLAY_NAME_KEY);
    expect(health.quotaHint).toMatch(/^unkeyed/u);
    expect(must(stub.issued[0], "the request").url).toBe(
      "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1038/s41586-023-06139-9?fields=paperId",
    );
  });

  it("reports the error's own message key when the probe fails, and rethrows a cancellation", async () => {
    const stub = createStubHttp((i) =>
      response(i.url, '{"error":"Paper with id x not found"}'),
    );
    const source = createSource(stub.client);
    const health = await source.healthCheck(ctx());
    expect(health.ok).toBe(false);
    expect(health.messageKey).toBe("rh-error-source");
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });
    await expect(
      source.healthCheck({ token: cts.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

// ---------------------------------------------------------------------------
// 7. Through the shipped HTTP client: the 429 and the bucket
// ---------------------------------------------------------------------------

class StubUnexpectedStatusException extends Error {
  constructor(readonly xmlhttp: HttpTransportXhr) {
    super("unexpected status");
  }
}
class StubTimeoutException extends Error {}
class StubBrowserOfflineException extends Error {}
class StubSecurityException extends Error {}
class StubCancelledException extends Error {}

function cannedTransport(
  clock: ManualClock,
  exchange: { status: number; body: string; headers?: Record<string, string> },
): HttpTransport & {
  readonly startedAt: number[];
  readonly sentHeaders: Record<string, string>[];
} {
  const startedAt: number[] = [];
  const sentHeaders: Record<string, string>[] = [];
  return {
    startedAt,
    sentHeaders,
    request(_method, _url, options) {
      startedAt.push(clock.now());
      sentHeaders.push({ ...(options.headers ?? {}) });
      const block = Object.entries(exchange.headers ?? {})
        .map(([n, v]) => `${n}: ${v}`)
        .join("\r\n");
      return Promise.resolve({
        status: exchange.status,
        responseText: exchange.body,
        responseURL: "",
        getAllResponseHeaders: () => block,
      });
    },
    UnexpectedStatusException:
      StubUnexpectedStatusException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: StubTimeoutException,
    BrowserOfflineException: StubBrowserOfflineException,
    SecurityException: StubSecurityException,
    CancelledException: StubCancelledException,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("createSemanticScholarSource through createHttpClient", () => {
  function clientOver(
    clock: ManualClock,
    exchange: {
      status: number;
      body: string;
      headers?: Record<string, string>;
    },
  ) {
    const transport = cannedTransport(clock, exchange);
    const client = createHttpClient({
      transport,
      userAgent: buildUserAgent("0.0.2"),
      clock,
    });
    return { transport, client };
  }

  it("rethrows the measured unkeyed 429 as a SemanticScholarRateLimitError — still a RateLimitError, no retryAfterMs — carrying the add-a-key note (criterion 1)", async () => {
    const clock = createManualClock(NOW);
    const { client } = clientOver(clock, {
      status: 429,
      body: MEASURED_429_BODY,
      headers: {
        "content-type": "application/json",
        "x-amzn-errortype": "TooManyRequestsException",
      },
    });
    const source = createSource(client);
    const failure = source.search(QUERY_TYPICAL, ctx());
    await expect(failure).rejects.toBeInstanceOf(SemanticScholarRateLimitError);
    await expect(failure).rejects.toBeInstanceOf(RateLimitError);
    await failure.catch((error: SemanticScholarRateLimitError) => {
      expect(error.retryAfterMs).toBeUndefined();
      expect(error.httpStatus).toBe(429);
      expect(error.retryable).toBe(true);
      expect(error.keyed).toBe(false);
      expect(error.messageKey).toBe("rh-error-rate-limit");
      expect(error.code).toBe("RATE_LIMIT");
      expect(error.message).toContain(
        `Rate limited by ${SEMANTICSCHOLAR_HOST}`,
      );
      expect(error.message).toContain(SEMANTICSCHOLAR_UNKEYED_NOTE);
      expect(error.cause).toBeInstanceOf(RateLimitError);
      expect(error.toSerialized().detail).toContain("Add a free key");
    });
  });

  it("criterion 1 end to end: with no key, a search over Semantic Scholar's measured 429 and a healthy source completes, S2's row carries the rate-limit error and the add-a-key note, and the other source's results are untouched", async () => {
    const clock = createManualClock(NOW);
    const { client } = clientOver(clock, {
      status: 429,
      body: MEASURED_429_BODY,
      headers: {
        "content-type": "application/json",
        "x-amzn-errortype": "TooManyRequestsException",
      },
    });
    const s2 = createSource(client);
    const healthyRecord: SourceRecord = {
      id: "pubmed:1",
      sourceId: "pubmed",
      nativeId: "1",
      work: {
        ids: {},
        type: "journal-article",
        title: "Healthy",
        authors: [],
      },
      retrievedAtEpochMs: NOW,
      missingFields: [],
    };
    const healthy: LiteratureSource = {
      ...s2,
      id: "pubmed",
      displayNameKey: "research-helper-source-pubmed",
      rateLimitKey: "eutils.ncbi.nlm.nih.gov",
      explainQuery: () => "crispr",
      async *searchAll() {
        yield healthyRecord;
      },
    };
    const cancel = createCancellationTokenSource();
    const root = new CompositeProgressReporter({
      clock,
      sinks: [],
      throttleMs: 0,
      token: cancel.token,
    });
    const result = await fanOut({
      sources: [healthy, s2],
      input: { query: "crispr", limit: 10, dateFilter: "none" },
      token: cancel.token,
      clock,
      progress: root.child("fetching", 0.05, 0.5),
      logger: createLogger({ sink: { write: () => undefined }, clock }),
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
    });
    expect(result.state).toBe("partial");
    expect(result.records.map((r) => r.id)).toEqual(["pubmed:1"]);
    expect(result.perSource[0]?.error).toBeUndefined();
    expect(result.perSource[0]?.recordsRetrieved).toBe(1);
    const row = must(result.perSource[1], "the Semantic Scholar row");
    expect(row.sourceId).toBe("semanticscholar");
    expect(row.recordsRetrieved).toBe(0);
    expect(row.error).toMatchObject({
      code: "RATE_LIMIT",
      httpStatus: 429,
      retryable: true,
    });
    expect(row.error?.detail).toContain("Add a free key");
  });

  it("explains a keyed 429 as the key not being honoured, without the key", async () => {
    const clock = createManualClock(NOW);
    const { client, transport } = clientOver(clock, {
      status: 429,
      body: MEASURED_429_BODY,
    });
    const source = createSource(client, { secrets: fakeSecrets() });
    const failure = source.search(QUERY_TYPICAL, ctx());
    await expect(failure).rejects.toBeInstanceOf(SemanticScholarRateLimitError);
    await failure.catch((error: SemanticScholarRateLimitError) => {
      expect(error.keyed).toBe(true);
      expect(error.message).toMatch(/not being honoured/u);
      expect(error.message).not.toContain(PLACEHOLDER_KEY);
      expect(error.message).not.toContain(SEMANTICSCHOLAR_UNKEYED_NOTE);
    });
    expect(transport.sentHeaders[0]?.[SEMANTICSCHOLAR_API_KEY_HEADER]).toBe(
      PLACEHOLDER_KEY,
    );
  });

  it("classifies a 400 and a 500 through the client's own classes, untouched", async () => {
    const clock = createManualClock(NOW);
    const bad = createSource(
      clientOver(clock, { status: 400, body: '{"error":"x"}' }).client,
    );
    await expect(bad.search(QUERY_TYPICAL, ctx())).rejects.toBeInstanceOf(
      BadRequestError,
    );
    const down = createSource(
      clientOver(clock, { status: 503, body: "" }).client,
    );
    await expect(down.search(QUERY_TYPICAL, ctx())).rejects.toBeInstanceOf(
      UpstreamServerError,
    );
  });

  it("with a key configured, sends x-api-key on every request and spaces consecutive searches >= 1111 ms on §7.3's bucket under a fake clock (criterion 2)", async () => {
    const clock = createManualClock(NOW);
    const policy = must(
      HOST_POLICIES.find((p) => p.host === SEMANTICSCHOLAR_HOST),
      "the Semantic Scholar row",
    );
    const bucket = new TokenBucket(
      SEMANTICSCHOLAR_HOST,
      policy.withoutKey,
      clock,
    );
    const transport = cannedTransport(clock, {
      status: 200,
      body: page([SAMPLE_PAPER]),
    });
    const client = createHttpClient({
      transport,
      userAgent: buildUserAgent("0.0.2"),
      clock,
      limiterFor: (host) =>
        host === SEMANTICSCHOLAR_HOST ? bucket : undefined,
    });
    const source = createSource(client, { secrets: fakeSecrets() });

    const first = source.search(QUERY_TYPICAL, ctx());
    const second = source.search(QUERY_EMPTY, ctx());
    await flush();
    // Burst 1: the first starts at once, the second is parked.
    expect(transport.startedAt).toEqual([NOW]);
    let elapsed = 0;
    while (transport.startedAt.length < 2 && elapsed < 10_000) {
      clock.advance(1);
      elapsed += 1;
      await flush();
    }
    const [a, b] = transport.startedAt;
    const gap = must(b, "the second start") - must(a, "the first start");
    // 1000 / 0.9 = 1111.1 ms: the bucket refills one token after that.
    expect(gap).toBeGreaterThanOrEqual(1111);
    expect(gap).toBeLessThan(1200);
    const pages = await Promise.all([first, second]);
    expect(pages.map((p) => p.records.length)).toEqual([1, 1]);
    expect(transport.sentHeaders).toHaveLength(2);
    for (const headers of transport.sentHeaders) {
      expect(headers[SEMANTICSCHOLAR_API_KEY_HEADER]).toBe(PLACEHOLDER_KEY);
      expect(headers["User-Agent"]).toContain("research_helper/0.0.2");
    }
    // The same bucket, the same spacing, without a key: "0.9/s in both modes".
    expect(policy.withKey).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Replay: test/fixtures/semanticscholar through the shipped createHttpClient
// ---------------------------------------------------------------------------

describe("replay: test/fixtures/semanticscholar through createHttpClient", () => {
  function replaySource(secrets?: SecretStore) {
    const replay = createReplayHttpClient({
      dir: FIXTURE_DIR,
      host: SEMANTICSCHOLAR_HOST,
    });
    const source = createSemanticScholarSource({
      http: replay.client,
      clock: replay.clock,
      mapRecords: createSemanticScholarRecordMapper({ clock: replay.clock }),
      ...(secrets !== undefined && { secrets }),
    });
    return { ...replay, source };
  }

  it("holds docs/13 §3.1's thirteen scenarios, each with a sidecar, plus relevance-search, batch-lookup, health-probe and error-400", async () => {
    const loaded = await listFixtureMeta(FIXTURE_DIR);
    const scenarios = loaded.map((m) => m.meta.scenario);
    for (const name of DOCS_13_SCENARIOS) expect(scenarios).toContain(name);
    expect(scenarios).toEqual(
      expect.arrayContaining([
        "relevance-search",
        "batch-lookup",
        "health-probe",
        "error-400",
        ...CORPUS_SCENARIOS,
      ]),
    );
    // Page 1 of the typical query exhausted its 27-record set, so no token
    // and no page 2 were recorded (measured 2026-10-15).
    expect(scenarios).not.toContain("paginated-page-2");
    expect(loaded).toHaveLength(17 + CORPUS_SCENARIOS.length);
    const names = await readdir(FIXTURE_DIR);
    for (const { key } of loaded) {
      expect(names).toContain(`${key}.json`);
      expect(names).toContain(`${key}${META_SUFFIX}`);
    }
    for (const { meta } of loaded) {
      expect(meta.synthetic).toBe(
        ["error-429", "error-400", "error-500", "error-malformed"].includes(
          meta.scenario,
        ),
      );
      expect(meta.method).toBe(
        ["batch-lookup", "record-jats-abstract", "corpus-batch"].includes(
          meta.scenario,
        )
          ? "POST"
          : "GET",
      );
    }
  });

  it("carries no contact address in either spelling, no x-api-key, and is fresh", async () => {
    const names = (await readdir(FIXTURE_DIR)).filter((n) =>
      n.endsWith(".json"),
    );
    for (const name of names) {
      const text = await readFile(`${FIXTURE_DIR}/${name}`, "utf8");
      expect(text).not.toMatch(/suppakoko(@|%40)gmail/iu);
      expect(text).not.toMatch(/x-api-key/iu);
    }
    const report = await assertFixturesFresh(FIXTURE_DIR, Date.now());
    expect(report.checked).toBe(17 + CORPUS_SCENARIOS.length);
  });

  it("search-typical: 27 records of 27, 21 with abstracts, 4 bioRxiv preprints, no next page, both notices", async () => {
    const { source, limiter } = replaySource();
    const result = await source.search(QUERY_TYPICAL, ctx());
    expect(result.records).toHaveLength(27);
    expect(result.totalAvailable).toBe(27);
    expect(result.nextCursor).toBeUndefined();
    expect(
      result.records.filter((r) => r.work.abstract !== undefined),
    ).toHaveLength(21);
    expect(
      result.records
        .filter((r) => r.work.type === "preprint")
        .map((r) => r.work.containerTitle),
    ).toEqual(["bioRxiv", "bioRxiv", "bioRxiv", "bioRxiv"]);
    expect(result.warnings).toContain(SEMANTICSCHOLAR_UNKEYED_NOTE);
    expect(result.warnings.some((w) => w.includes("title:"))).toBe(true);
    expect(result.sourceExtras.keyed).toBe(false);
    expect(limiter.acquired).toHaveLength(1);
    for (const record of result.records) {
      expect(record.nativeId).toMatch(/^[0-9a-f]{40}$/u);
      expect(record.id).toBe(`semanticscholar:${record.nativeId}`);
      expect(record.work.publishedDate?.year).toBe(2023);
    }
  });

  it("search-single and paginated-page-1: the bulk endpoint ignores limit (measured) — 27 records for limit 1 and for limit 3", async () => {
    const { source } = replaySource();
    const single = await source.search({ ...QUERY_TYPICAL, limit: 1 }, ctx());
    expect(single.records).toHaveLength(27);
    expect(single.nextCursor).toBeUndefined();
    const page1 = await source.search(QUERY_PAGINATED, ctx());
    expect(page1.records).toHaveLength(27);
    expect(page1.nextCursor).toBeUndefined();
    // searchAll still honours the caller's limit over such a page.
    const seen: string[] = [];
    for await (const record of source.searchAll(
      { ...QUERY_TYPICAL, limit: 3 },
      ctx(),
    ))
      seen.push(record.nativeId);
    expect(seen).toHaveLength(3);
  });

  it("search-empty: total 0, no records, no cursor, no error", async () => {
    const { source } = replaySource();
    const result = await source.search(QUERY_EMPTY, ctx());
    expect(result.records).toEqual([]);
    expect(result.totalAvailable).toBe(0);
    expect(result.nextCursor).toBeUndefined();
  });

  it("record-rich: docs/02 §6.7's Geneformer paper with a bare PubMedCentral id normalised, journal, counts and open access", async () => {
    const { source } = replaySource();
    const result = await source.search(QUERY_RICH, ctx());
    expect(result.records).toHaveLength(1);
    const r = must(result.records[0], "the record");
    expect(r.nativeId).toBe("7d1e59ce254bea5228da634dbe7c5c4160df6f98");
    expect(r.work.ids).toEqual({
      doi: "10.1038/s41586-023-06139-9",
      pmid: "37258680",
      pmcid: "PMC10949956",
      s2CorpusId: "259002047",
    });
    expect(r.work.title).toBe(
      "Transfer learning enables predictions in network biology",
    );
    expect(r.work.type).toBe("journal-article");
    expect(r.work.containerTitle).toBe("Nature");
    expect(r.work.volume).toBe("618");
    expect(r.work.pages).toBe("616 - 624");
    expect(r.work.issn).toEqual(["0028-0836"]);
    expect(r.work.publishedDate?.iso).toBe("2023-05-31");
    expect(r.work.referenceCount).toBe(159);
    expect(r.work.influentialCitationCount).toBeGreaterThanOrEqual(137);
    expect(r.work.citationCount).toBeGreaterThanOrEqual(1220);
    expect(r.work.openAccess).toEqual({
      isOpenAccess: true,
      status: "green",
      pdfUrl: "https://escholarship.org/content/qt8st2d5mx/qt8st2d5mx.pdf",
    });
    expect(r.work.abstract).toMatch(/^Mapping gene networks/u);
    expect(must(r.work.authors[0], "first author")).toEqual({
      family: "Theodoris",
      given: "C.",
      sequence: 0,
    });
    // docs/02 §10.2: `subjects` ← `fieldsOfStudy` AND `s2FieldsOfStudy`. The recorded paper carries
    // Medicine in the first and Medicine, Computer Science, Biology in the second (2026-10-15).
    expect(r.work.subjects).toEqual([
      { term: "Medicine", scheme: SEMANTICSCHOLAR_FIELD_OF_STUDY_SCHEME },
      {
        term: "Computer Science",
        scheme: SEMANTICSCHOLAR_FIELD_OF_STUDY_SCHEME,
      },
      { term: "Biology", scheme: SEMANTICSCHOLAR_FIELD_OF_STUDY_SCHEME },
    ]);
    expect(r.work.url).toBe(
      "https://www.semanticscholar.org/paper/7d1e59ce254bea5228da634dbe7c5c4160df6f98",
    );
    // The bulk endpoint serves no tldr (measured 400), so the abstract is the abstract.
    expect(r.missingFields).toEqual(expect.arrayContaining(["ids.arxivId"]));
  });

  it("record-sparse: a 1965 note's Japanese reprint — no abstract, no DOI, empty venue and journal, a CJK author name", async () => {
    const { source } = replaySource();
    const result = await source.search(QUERY_SPARSE, ctx());
    expect(result.records).toHaveLength(17);
    const moore = byNativeId(
      result.records,
      "15146117a7843f57610604369ec31be7a1573bd3",
    );
    expect(moore.work.abstract).toBeUndefined();
    expect(moore.work.ids).toEqual({ s2CorpusId: "63405049" });
    expect(moore.work.containerTitle).toBeUndefined();
    expect(moore.work.type).toBe("other");
    expect(moore.work.publishedDate).toEqual({
      year: 2005,
      month: 10,
      day: 15,
      iso: "2005-10-15",
    });
    expect(moore.work.authors).toEqual([
      { family: "木村", given: "康則", sequence: 0 },
    ]);
    expect(moore.missingFields).toEqual(
      expect.arrayContaining([
        "abstract",
        "ids.doi",
        "ids.pmid",
        "ids.pmcid",
        "containerTitle",
        "type",
        "issn",
      ]),
    );
    expect(moore.work.openAccess).toEqual({ isOpenAccess: false });
  });

  it("record-unicode: diacritics and typographic quotes survive in titles and author names; Conference wins over JournalArticle", async () => {
    const { source } = replaySource();
    const result = await source.search(QUERY_UNICODE, ctx());
    expect(result.records).toHaveLength(93);
    const cat = byNativeId(
      result.records,
      "00751a123441e8651c366081b81c6938b17422e4",
    );
    expect(cat.work.title).toBe(
      "The life and entangled adventures of Schrödinger’s cat",
    );
    expect(cat.work.type).toBe("conference-paper");
    expect(cat.work.ids.arxivId).toBe("2309.06387");
    expect(
      result.records
        .flatMap((r) => r.work.authors)
        .some((a) => a.family === "Panković"),
    ).toBe(true);
    expect(
      result.records.filter((r) => /\P{ASCII}/u.test(r.work.title)),
    ).toHaveLength(34);
  });

  it("record-preprint: docs/02 §7.4's VizIt e-print arrives venue-less and arXiv-only, and is a preprint", async () => {
    const { source } = replaySource();
    const result = await source.search(QUERY_PREPRINT, ctx());
    expect(result.records).toHaveLength(1);
    const r = must(result.records[0], "the record");
    expect(r.nativeId).toBe("bbb932b6b54a773300fc4333d0bd61581a97c35e");
    expect(r.work.type).toBe("preprint");
    expect(r.work.ids).toEqual({
      arxivId: "2609.04658",
      s2CorpusId: "291767761",
    });
    expect(r.work.containerTitle).toBeUndefined();
    expect(r.work.publishedDate?.iso).toBe("2026-09-04");
    expect(r.work.openAccess).toEqual({ isOpenAccess: false });
  });

  it("dedup-pair-set: the SciPy 1.0 paper with PMC, PMID, DOI and corpus id — the four-way pair with arXiv's fixture", async () => {
    const { source } = replaySource();
    const result = await source.search(QUERY_PAIR, ctx());
    expect(result.records).toHaveLength(6);
    const scipy = byNativeId(
      result.records,
      "854eca61a57d2c1ea1019663caf022bc8fd0b909",
    );
    expect(scipy.work.ids).toEqual({
      doi: "10.1038/s41592-019-0686-2",
      pmid: "32015543",
      pmcid: "PMC7056644",
      s2CorpusId: "198229805",
    });
    expect(scipy.work.type).toBe("journal-article");
    expect(scipy.work.containerTitle).toBe("Nature Methods");
    expect(scipy.work.citationCount).toBeGreaterThan(30_000);
  });

  it("batch-lookup: four ids, a null at index 2 skipped without shifting index 3 (criterion 3 on the recorded body)", async () => {
    const recorded = await recordedExchange("batch-lookup");
    const answers = parseBatchBody(recorded.body, "");
    expect(answers).toHaveLength(4);
    expect(answers[2]).toBeNull();
    const { source, transport } = replaySource();
    const records = await source.lookup(
      [
        { doi: "10.1038/s41586-023-06139-9" as never },
        { pmid: "37258680" as never },
        { doi: "10.1234/research-helper-unknown-id" as never },
        { arxivId: "2106.15928" as never },
      ],
      ctx(),
    );
    expect(records.map((r) => r.nativeId)).toEqual([
      "7d1e59ce254bea5228da634dbe7c5c4160df6f98",
      "7d1e59ce254bea5228da634dbe7c5c4160df6f98",
      "f712fab0d58ae6492e3cdfc1933dae103ec12d5d",
    ]);
    expect(must(records[2], "the arXiv record").work.ids.arxivId).toBe(
      "2106.15928",
    );
    // tldr is served here (the batch endpoint accepts it); every answer has one.
    expect(
      answers.filter((a) => a !== null).every((a) => readTldr(a) !== undefined),
    ).toBe(true);
    expect(must(transport.calls[0], "the call").method).toBe("POST");
    expect(must(transport.calls[0], "the call").options.body).toBe(
      recordedSemanticScholarBatchRequest().body,
    );
  });

  it("record-jats-abstract: a DataCite arXiv DOI is not a valid /paper/batch id — HTTP 400 'No valid paper ids given' (measured)", async () => {
    const recorded = await recordedExchange("record-jats-abstract");
    expect(recorded.status).toBe(400);
    expect(JSON.parse(recorded.body)).toEqual({
      error: "No valid paper ids given",
    });
    const { client } = replaySource();
    const request = buildBatchRequest([SEMANTICSCHOLAR_BATCH_DATACITE_ID]);
    await expect(
      client.request(request.method, request.url, {
        responseType: "text",
        body: request.body,
        headers: { "Content-Type": request.contentType },
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("health-probe: docs/09 §2.3's call answers a paperId unkeyed", async () => {
    const { source, transport } = replaySource();
    const health = await source.healthCheck(ctx());
    expect(health.ok).toBe(true);
    expect(health.quotaHint).toMatch(/^unkeyed/u);
    expect(must(transport.calls[0], "the call").url).toBe(
      recordedSemanticScholarHealthRequest().url,
    );
  });

  it("relevance-search: the REAL recorded unauthenticated 429 is a SemanticScholarRateLimitError with the note and no penalty (criterion 1)", async () => {
    const recorded = await recordedExchange("relevance-search");
    expect(recorded.status).toBe(429);
    expect(recorded.body).toBe(MEASURED_429_BODY);
    expect(recorded.headers["x-amzn-errortype"]).toBe(
      "TooManyRequestsException",
    );
    expect(recorded.headers["retry-after"]).toBeUndefined();
    const { source, limiter } = replaySource();
    const failure = source.searchByRelevance(QUERY_RELEVANCE, ctx());
    await expect(failure).rejects.toBeInstanceOf(SemanticScholarRateLimitError);
    await failure.catch((error: SemanticScholarRateLimitError) => {
      expect(error.retryAfterMs).toBeUndefined();
      expect(error.keyed).toBe(false);
      expect(error.message).toContain(SEMANTICSCHOLAR_UNKEYED_NOTE);
    });
    expect(limiter.penalties).toEqual([]);
  });

  it("error-429: the written measured shape replays identically to the live one", async () => {
    const recorded = await recordedExchange("error-429");
    expect(recorded.body).toBe(MEASURED_429_BODY);
    expect(recorded.headers["content-length"]).toBe("174");
    expect(recorded.body.length).toBe(174);
    const { source } = replaySource(fakeSecrets());
    const failure = source.search(QUERY_SYNTHETIC_429, ctx());
    await expect(failure).rejects.toBeInstanceOf(SemanticScholarRateLimitError);
    await failure.catch((error: SemanticScholarRateLimitError) => {
      expect(error.keyed).toBe(true);
      expect(error.message).not.toContain(PLACEHOLDER_KEY);
    });
  });

  it("error-400 is a BadRequestError, error-500 an UpstreamServerError and error-malformed a ParseError", async () => {
    const { source } = replaySource();
    await expect(
      source.search(QUERY_SYNTHETIC_400, ctx()),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      source.search(QUERY_SYNTHETIC_500, ctx()),
    ).rejects.toBeInstanceOf(UpstreamServerError);
    await expect(
      source.search(QUERY_SYNTHETIC_MALFORMED, ctx()),
    ).rejects.toBeInstanceOf(ParseError);
    const malformed = await recordedExchange("error-malformed");
    expect(malformed.status).toBe(200);
    expect(malformed.body).toHaveLength(1024);
  });
});

// ---------------------------------------------------------------------------
// 9. Registration and the recorder's plan
// ---------------------------------------------------------------------------

describe("registerSources with the semanticscholar slot", () => {
  const unreachable = () => {
    throw new Error("not called");
  };
  function stub(id: LiteratureSource["id"]): LiteratureSource {
    return {
      id,
      displayNameKey: `x-${id}`,
      capabilities: SEMANTICSCHOLAR_CAPABILITIES,
      rateLimitKey: "h",
      isConfigured: () => true,
      healthCheck: unreachable,
      search: unreachable,
      searchAll: unreachable,
      explainQuery: unreachable,
    };
  }

  it("registers semanticscholar between crossref and arxiv, in SOURCE_IDS order, whatever the literal's key order", () => {
    const registry = createSourceRegistry();
    const arxiv = stub("arxiv");
    const semanticscholar = stub("semanticscholar");
    const crossref = stub("crossref");
    const europepmc = stub("europepmc");
    const pubmed = stub("pubmed");
    registerSources(registry, {
      arxiv,
      semanticscholar,
      crossref,
      europepmc,
      pubmed,
    });
    expect(registry.list()).toEqual([
      pubmed,
      europepmc,
      crossref,
      semanticscholar,
      arxiv,
    ]);
    expect(SOURCE_IDS.indexOf("semanticscholar")).toBe(
      SOURCE_IDS.indexOf("arxiv") - 1,
    );
  });

  it("registers the real adapter under its own id, configured without a key, and rejects a mis-wired one", () => {
    const registry = createSourceRegistry();
    const real = createSource(
      createStubHttp((i) => response(i.url, page([]))).client,
    );
    registerSources(registry, {
      pubmed: stub("pubmed"),
      semanticscholar: real,
    });
    expect(registry.get("semanticscholar")).toBe(real);
    expect(registry.listConfigured()).toContain(real);
    expect(() =>
      registerSources(createSourceRegistry(), {
        pubmed: stub("pubmed"),
        semanticscholar: stub("biorxiv"),
      }),
    ).toThrow(/supplied as "semanticscholar" reports id "biorxiv"/u);
  });
});

describe("scripts/record-fixtures.ts: the Semantic Scholar plan", () => {
  it("plans every committed fixture under the key that is on disk, and nothing else", async () => {
    const plan = planFor("semanticscholar");
    expect(plan.host).toBe(SEMANTICSCHOLAR_HOST);
    expect(RECORDABLE_SOURCES).toContain("semanticscholar");
    // Page 1 exhausted its set: no token, so no dependent page from disk.
    const fromDisk = async (planned: {
      method: string;
      url: string;
      body?: string;
    }) => {
      try {
        const text = await readFile(
          `${FIXTURE_DIR}/${fixtureKey(planned)}.json`,
          "utf8",
        );
        return JSON.parse(text) as RecordedExchange;
      } catch {
        return undefined;
      }
    };
    expect(await plan.dependent(fromDisk)).toEqual([]);
    const planned = [...plan.independent(), ...plan.syntheticRequests()];
    expect(plan.independent()).toHaveLength(13 + CORPUS_SCENARIOS.length);
    const onDisk = (await readdir(FIXTURE_DIR))
      .filter((n) => n.endsWith(".json") && !n.endsWith(META_SUFFIX))
      .map((n) => n.replace(/\.json$/u, ""));
    const keys = planned.map((p) =>
      fixtureKey({
        method: p.method,
        url: p.url,
        ...(p.body !== undefined && { body: p.body }),
      }),
    );
    expect([...keys].sort()).toEqual([...onDisk].sort());
    expect(planned.map((p) => p.scenario)).toEqual(
      expect.arrayContaining([
        ...DOCS_13_SCENARIOS,
        "relevance-search",
        "batch-lookup",
        "health-probe",
        "error-400",
      ]),
    );
    expect(plannedRequest("search-typical", "semanticscholar").url).toBe(
      recordedSemanticScholarBulkRequest(QUERY_TYPICAL).url,
    );
    const batch = plannedRequest("batch-lookup", "semanticscholar");
    expect(batch.body).toBe(JSON.stringify({ ids: SEMANTICSCHOLAR_BATCH_IDS }));
    expect(batch.contentType).toBe("application/json");
    expect(batch.method).toBe("POST");
    expect(
      plan.opaqueTokens?.(
        page([{ paperId: "a".repeat(40) }], { token: "x".repeat(60) }),
      ),
    ).toEqual(["a".repeat(40), "x".repeat(60)]);
  });

  it("--only keeps the named scenarios in plan order and refuses an unknown name", () => {
    const planned = planFor("semanticscholar").independent();
    expect(selectScenarios(planned, undefined)).toBe(planned);
    expect(
      selectScenarios(planned, ["health-probe", "search-empty"]).map(
        (p) => p.scenario,
      ),
    ).toEqual(["search-empty", "health-probe"]);
    expect(() => selectScenarios(planned, ["bogus"])).toThrow(UsageError);
  });
});
