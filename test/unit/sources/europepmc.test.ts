import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerSources } from "../../../src/bootstrap/registerSources";
import { createManualClock } from "../../../src/core/clock";
import {
  OperationCancelledError,
  ParseError,
  RateLimitError,
  SourceError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type {
  HttpClient,
  HttpMethod,
  HttpOptions,
  HttpResponse,
} from "../../../src/core/http/client";
import { MAINTAINER_EMAIL } from "../../../src/core/http/userAgent";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import {
  createHostLimiterRegistry,
  EBI_HOST,
  HOST_POLICIES,
} from "../../../src/core/rateLimit/hostLimiter";
import { MESSAGE_PREFIX } from "../../../src/i18n/keys";
import { SOURCE_IDS } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  clampPageSize,
  createEuropePmcSource,
  EUROPEPMC_CAPABILITIES,
  EUROPEPMC_DISPLAY_NAME_KEY,
  EUROPEPMC_HEALTH_FAILED_MESSAGE_KEY,
  EUROPEPMC_HEALTH_OK_MESSAGE_KEY,
  nextCursorAfter,
  parseEuropePmcSearchBody,
  type EuropePmcSourceDeps,
} from "../../../src/sources/europepmc/europepmcSource";
import {
  createEuropePmcRecordMapper,
  EUROPEPMC_MAPPABLE_FIELDS,
  EUROPEPMC_SOURCE_ID,
  flattenMarkup,
  readPartialDate,
} from "../../../src/sources/europepmc/mapper";
import {
  buildEuropePmcSearchRequest,
  EUROPEPMC_FIRST_CURSOR,
  EUROPEPMC_PAGE_SIZE_MAX,
  EUROPEPMC_QUERY_DESIGN_BUDGET,
  EUROPEPMC_QUERY_FILTER_SUPPORT,
  EUROPEPMC_RENDERED_FIELDS,
  EUROPEPMC_SEARCH_POST_URL,
  EUROPEPMC_SEARCH_URL,
  explainEuropePmcQuery,
  renderEuropePmcQuery,
  RESERVED_RAW_PARAMS,
} from "../../../src/sources/europepmc/query";
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
  listFixtureMeta,
  META_SUFFIX,
  type RecordedExchange,
} from "../../contract/_transport";
import {
  EUROPEPMC_Q1_2023 as Q1_2023,
  EUROPEPMC_QUERY_CJK as QUERY_CJK,
  EUROPEPMC_QUERY_EMPTY as QUERY_EMPTY,
  EUROPEPMC_QUERY_ERROR_EMPTY as QUERY_ERROR_EMPTY,
  EUROPEPMC_QUERY_JATS as QUERY_JATS,
  EUROPEPMC_QUERY_MANY as QUERY_MANY,
  EUROPEPMC_QUERY_PAGINATED as QUERY_PAGINATED,
  EUROPEPMC_QUERY_PAIR as QUERY_PAIR,
  EUROPEPMC_QUERY_POST_LONG as QUERY_POST_LONG,
  EUROPEPMC_QUERY_PREPRINT as QUERY_PREPRINT,
  EUROPEPMC_QUERY_RICH as QUERY_RICH,
  EUROPEPMC_QUERY_SPARSE as QUERY_SPARSE,
  EUROPEPMC_QUERY_SYNTHETIC_429 as QUERY_SYNTHETIC_429,
  EUROPEPMC_QUERY_SYNTHETIC_500 as QUERY_SYNTHETIC_500,
  EUROPEPMC_QUERY_SYNTHETIC_MALFORMED as QUERY_SYNTHETIC_MALFORMED,
  EUROPEPMC_QUERY_TYPICAL as QUERY_TYPICAL,
  EUROPEPMC_QUERY_UNICODE as QUERY_UNICODE,
  EUROPEPMC_TITLE_RICH as T_RICH,
  EUROPEPMC_TITLE_UNICODE_1 as T_UNI_1,
} from "../../support/europepmcRecordedRequests";

/**
 * `P2-T03`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network**.
 * Two kinds of test share this file, and the card's `Verify with`
 * (`npm run test:unit -- europepmc`) runs both:
 *
 * - **Pure**: the renderer against `docs/02` §12.3's Europe PMC column cell by
 *   cell, the mapper's markup/date helpers, the response validator, the paging
 *   rule, the capabilities, the `www.ebi.ac.uk` policy row read back from
 *   `docs/07` §7.3, and `registerSources` with the new slot.
 * - **Replayed**: the shipped `createEuropePmcSource` over the shipped
 *   `createHttpClient` (`test/contract/_transport.ts`'s Node face of the
 *   `P2-T25` harness), answering from `test/fixtures/europepmc/` — recorded
 *   live on 2026-10-14 (16 requests; 3 synthetic). A missing fixture is an
 *   error naming the record command, never a network call. The queries below
 *   are the recorder's, repeated: a fixture is keyed on the exact URL, so the
 *   test must build the same one (`plan/00` §6 item 76).
 *
 * The thirteen `docs/13` §3.1 names are listed in {@link DOCS_13_SCENARIOS}
 * and checked against the sidecars; `paginated` is three files.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/europepmc",
);

const DOCS_07 = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/07-architecture-and-data-model.md",
);

const NOW = 1_700_000_000_000;

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
const and = (...children: QueryNode[]): QueryNode => ({
  kind: "and",
  children,
});
const or = (...children: QueryNode[]): QueryNode => ({ kind: "or", children });
const not = (child: QueryNode): QueryNode => ({ kind: "not", child });

/** One request the stub transport answered. */
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
  headers: Readonly<Record<string, string>> = {},
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
  const fromUrl = q === -1 ? "" : issued.url.slice(q + 1);
  const body = issued.options?.body;
  return new URLSearchParams(body === undefined ? fromUrl : body);
}

/** A Europe PMC page body with the parts a test varies. */
function pageBody(fields: Record<string, unknown>): string {
  return JSON.stringify({ version: "6.9", ...fields });
}

/** A minimal `core` result. */
function result(
  id: string,
  source = "MED",
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, source, title: `Paper ${id}`, ...extra };
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

function createSource(
  client: HttpClient,
  overrides: Partial<EuropePmcSourceDeps> = {},
) {
  const clock = createManualClock(NOW);
  return createEuropePmcSource({
    http: client,
    clock,
    mapRecords: createEuropePmcRecordMapper({ clock }),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// The recorder's queries — one declaration, imported (P2-T33)
// ---------------------------------------------------------------------------

/*
 * `test/support/europepmcRecordedRequests.ts` is the single home of the
 * queries the fixtures are keyed under; `scripts/record-fixtures.ts` imports
 * the same names. The local aliases keep this file's vocabulary.
 */

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

/** The recorded `resultList.result` of one scenario, straight from disk. */
async function recordedResults(scenario: string): Promise<readonly unknown[]> {
  const loaded = await listFixtureMeta(FIXTURE_DIR);
  const hit = loaded.find((m) => m.meta.scenario === scenario);
  if (hit === undefined) throw new Error(`no fixture for ${scenario}`);
  const text = await readFile(`${FIXTURE_DIR}/${hit.key}.json`, "utf8");
  const exchange = JSON.parse(text) as RecordedExchange;
  const body = JSON.parse(exchange.body) as {
    resultList: { result: unknown[] };
  };
  return body.resultList.result;
}

function mapper(keepRaw = false) {
  return createEuropePmcRecordMapper({
    clock: createManualClock(NOW),
    keepRaw,
  });
}

function byNativeId(
  records: readonly SourceRecord[],
  nativeId: string,
): SourceRecord {
  const found = records.find((r) => r.nativeId === nativeId);
  if (found === undefined) throw new Error(`no record ${nativeId}`);
  return found;
}

// ---------------------------------------------------------------------------
// 1. The renderer — docs/02 §12.3's Europe PMC column, cell by cell
// ---------------------------------------------------------------------------

describe("renderEuropePmcQuery — docs/02 §12.3's Europe PMC column", () => {
  it("AND: uppercase AND inside parentheses", () => {
    expect(renderEuropePmcQuery(and(term("CRISPR"), term("editing")))).toBe(
      '("CRISPR" AND "editing")',
    );
  });

  it("OR: uppercase OR inside parentheses", () => {
    expect(renderEuropePmcQuery(or(term("a"), term("b")))).toBe('("a" OR "b")');
  });

  it("NOT: binary, in place of the AND that would join it (§12.2)", () => {
    expect(renderEuropePmcQuery(and(term("CRISPR"), not(term("mouse"))))).toBe(
      '("CRISPR" NOT "mouse")',
    );
  });

  it("NOT with no left operand stays a bare NOT rather than an invented operand", () => {
    expect(renderEuropePmcQuery(not(term("mouse")))).toBe('NOT "mouse"');
    expect(renderEuropePmcQuery(or(not(term("a")), term("b")))).toBe(
      '(NOT "a" OR "b")',
    );
  });

  it('Phrase: "…", and every value is quoted whether or not it is a phrase', () => {
    expect(renderEuropePmcQuery(term("base editing", undefined, true))).toBe(
      '"base editing"',
    );
    expect(renderEuropePmcQuery(term("CRISPR"))).toBe('"CRISPR"');
    expect(renderEuropePmcQuery(term("CRISPR-Cas9"))).toBe('"CRISPR-Cas9"');
  });

  it("Title field: TITLE:", () => {
    expect(renderEuropePmcQuery(term("CRISPR", "title"))).toBe(
      'TITLE:"CRISPR"',
    );
  });

  it("Abstract: ABSTRACT:", () => {
    expect(renderEuropePmcQuery(term("CRISPR", "abstract"))).toBe(
      'ABSTRACT:"CRISPR"',
    );
  });

  it("Author: AUTH:", () => {
    expect(renderEuropePmcQuery(term("Doudna J", "author"))).toBe(
      'AUTH:"Doudna J"',
    );
  });

  it("renders §4.3's other prefixes, and no prefix for affiliation or any", () => {
    expect(renderEuropePmcQuery(term("x", "titleOrAbstract"))).toBe(
      'TITLE_ABS:"x"',
    );
    expect(renderEuropePmcQuery(term("Nature", "journal"))).toBe(
      'JOURNAL:"Nature"',
    );
    expect(renderEuropePmcQuery(term("Gene Editing", "meshTerm"))).toBe(
      'MESH_TERM:"Gene Editing"',
    );
    expect(renderEuropePmcQuery(term("Harvard", "affiliation"))).toBe(
      '"Harvard"',
    );
    expect(renderEuropePmcQuery(term("x", "any"))).toBe('"x"');
  });

  it("renders §12.2's worked example byte for byte", () => {
    const parsed = parseUserQuery(
      '("base editing" OR "prime editing") AND title:CRISPR NOT mouse',
    );
    expect(
      explainEuropePmcQuery({
        terms: parsed,
        fromDate: "2024-01-01",
        toDate: "2026-12-31",
        limit: 20,
      }),
    ).toBe(
      '(("base editing" OR "prime editing") AND TITLE:"CRISPR" NOT "mouse") AND (FIRST_PDATE:[2024-01-01 TO 2026-12-31])',
    );
  });

  it("removes only the two phrase-breaking characters and collapses whitespace", () => {
    expect(renderEuropePmcQuery(term(' say "hi"  \\ there '))).toBe(
      '"say hi there"',
    );
    // Lucene syntax characters are harmless inside the quotes and stay.
    expect(renderEuropePmcQuery(term("a:b (c) [d] e*"))).toBe(
      '"a:b (c) [d] e*"',
    );
  });

  it("renders nothing for a tree with nothing renderable, and skips such children", () => {
    expect(renderEuropePmcQuery(term('""'))).toBe("");
    expect(renderEuropePmcQuery(and(term('"'), term("x")))).toBe('"x"');
    expect(renderEuropePmcQuery(not(term('"')))).toBe("");
  });

  it("balances parentheses on nested trees", () => {
    const rendered = renderEuropePmcQuery(
      and(or(term("a"), and(term("b"), not(term("c")))), term("d", "title")),
    );
    expect(rendered).toBe('(("a" OR ("b" NOT "c")) AND TITLE:"d")');
    let depth = 0;
    for (const ch of rendered) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});

describe("explainEuropePmcQuery — date range, open access, languages", () => {
  it("Date range: FIRST_PDATE:[a TO b] (§12.3), ANDed after the terms", () => {
    expect(explainEuropePmcQuery(QUERY_TYPICAL)).toBe(
      '("CRISPR" AND "editing") AND (FIRST_PDATE:[2023-01-01 TO 2023-03-31])',
    );
  });

  it("widens a year or month bound outward to whole days", () => {
    expect(
      explainEuropePmcQuery({
        terms: term("x"),
        fromDate: "2024",
        toDate: "2026",
        limit: 1,
      }),
    ).toBe('"x" AND (FIRST_PDATE:[2024-01-01 TO 2026-12-31])');
    expect(
      explainEuropePmcQuery({
        terms: term("x"),
        fromDate: "2024-02",
        toDate: "2024-02",
        limit: 1,
      }),
    ).toBe('"x" AND (FIRST_PDATE:[2024-02-01 TO 2024-02-29])');
  });

  it("omits the window when neither bound is set, and refuses a half-open one", () => {
    expect(explainEuropePmcQuery({ terms: term("x"), limit: 1 })).toBe('"x"');
    expect(() =>
      explainEuropePmcQuery({ terms: term("x"), fromDate: "2024", limit: 1 }),
    ).toThrow(/both date bounds or neither/u);
    expect(() =>
      explainEuropePmcQuery({
        terms: term("x"),
        fromDate: "01/01/2024",
        toDate: "2024-12-31",
        limit: 1,
      }),
    ).toThrow(/YYYY, YYYY-MM or YYYY-MM-DD/u);
  });

  it("renders a window-only query when the tree is empty", () => {
    expect(
      explainEuropePmcQuery({ terms: term('"'), ...Q1_2023, limit: 1 }),
    ).toBe("(FIRST_PDATE:[2023-01-01 TO 2023-03-31])");
  });

  it("openAccessOnly renders §4.3's OPEN_ACCESS:y; false renders nothing", () => {
    expect(EUROPEPMC_QUERY_FILTER_SUPPORT.openAccessOnly).toBe(true);
    expect(
      explainEuropePmcQuery({
        terms: term("x"),
        openAccessOnly: true,
        limit: 1,
      }),
    ).toBe('"x" AND (OPEN_ACCESS:y)');
    expect(
      explainEuropePmcQuery({
        terms: term("x"),
        ...Q1_2023,
        openAccessOnly: true,
        limit: 1,
      }),
    ).toBe(
      '"x" AND (FIRST_PDATE:[2023-01-01 TO 2023-03-31]) AND (OPEN_ACCESS:y)',
    );
    expect(
      explainEuropePmcQuery({
        terms: term("x"),
        openAccessOnly: false,
        limit: 1,
      }),
    ).toBe('"x"');
  });

  it("languages is refused by name, never dropped; an empty list passes", () => {
    expect(EUROPEPMC_QUERY_FILTER_SUPPORT.languages).toBe(false);
    const query: SourceQuery = {
      terms: term("x"),
      languages: ["eng"],
      limit: 1,
    };
    expect(() => explainEuropePmcQuery(query)).toThrow(
      /SourceQuery\.languages=\["eng"\]/u,
    );
    expect(() => buildEuropePmcSearchRequest({ query, pageSize: 1 })).toThrow(
      /languages/u,
    );
    expect(
      explainEuropePmcQuery({ terms: term("x"), languages: [], limit: 1 }),
    ).toBe('"x"');
  });
});

// ---------------------------------------------------------------------------
// 2. The request
// ---------------------------------------------------------------------------

describe("buildEuropePmcSearchRequest", () => {
  it("emits the parameters in a fixed, fixture-hashable order with email last", () => {
    const built = buildEuropePmcSearchRequest({
      query: QUERY_TYPICAL,
      pageSize: 20,
    });
    expect(built.method).toBe("GET");
    expect(built.endpointBaseUrl).toBe(EUROPEPMC_SEARCH_URL);
    expect(built.url.startsWith(`${EUROPEPMC_SEARCH_URL}?`)).toBe(true);
    const params = new URLSearchParams(built.queryString);
    expect([...params.keys()]).toEqual([
      "query",
      "resultType",
      "format",
      "pageSize",
      "cursorMark",
      "email",
    ]);
    expect(params.get("query")).toBe(explainEuropePmcQuery(QUERY_TYPICAL));
    expect(params.get("resultType")).toBe("core");
    expect(params.get("format")).toBe("json");
    expect(params.get("pageSize")).toBe("20");
    expect(params.get("cursorMark")).toBe(EUROPEPMC_FIRST_CURSOR);
    // docs/02 §2.2's final assignment: Europe PMC gets the maintainer address.
    expect(params.get("email")).toBe(MAINTAINER_EMAIL);
    expect(built.url).toContain(
      `email=${encodeURIComponent(MAINTAINER_EMAIL)}`,
    );
  });

  it("Pagination (§12.3): cursorMark=* first, then the cursor it is handed", () => {
    expect(
      new URLSearchParams(
        buildEuropePmcSearchRequest({ query: QUERY_TYPICAL, pageSize: 3 })
          .queryString,
      ).get("cursorMark"),
    ).toBe("*");
    expect(
      new URLSearchParams(
        buildEuropePmcSearchRequest({
          query: QUERY_TYPICAL,
          pageSize: 3,
          cursor: "AoIIQDGUpSg1MTQ2NzgxMA==",
        }).queryString,
      ).get("cursorMark"),
    ).toBe("AoIIQDGUpSg1MTQ2NzgxMA==");
  });

  it("takes resultType idlist for the probe and defaults to core", () => {
    expect(
      new URLSearchParams(
        buildEuropePmcSearchRequest({
          query: QUERY_TYPICAL,
          pageSize: 1,
          resultType: "idlist",
        }).queryString,
      ).get("resultType"),
    ).toBe("idlist");
  });

  it("refuses a pageSize outside docs/02 §4.1's 1 … 1000", () => {
    for (const bad of [0, 1001, 2.5, Number.NaN]) {
      expect(() =>
        buildEuropePmcSearchRequest({ query: QUERY_TYPICAL, pageSize: bad }),
      ).toThrow(/pageSize must be an integer in 1 … 1000/u);
    }
    expect(
      buildEuropePmcSearchRequest({ query: QUERY_TYPICAL, pageSize: 1000 })
        .method,
    ).toBe("GET");
  });

  it("switches to POST /searchPOST above the 1500-character design budget", () => {
    const built = buildEuropePmcSearchRequest({
      query: QUERY_POST_LONG,
      pageSize: 5,
    });
    expect(built.renderedQuery.length).toBeGreaterThan(
      EUROPEPMC_QUERY_DESIGN_BUDGET,
    );
    expect(built.method).toBe("POST");
    expect(built.url).toBe(EUROPEPMC_SEARCH_POST_URL);
    expect(built.endpointBaseUrl).toBe(EUROPEPMC_SEARCH_POST_URL);
    expect(built.body).toBe(built.queryString);
    expect(new URLSearchParams(built.body ?? "").get("query")).toBe(
      built.renderedQuery,
    );
    expect(built.transmittedUrl).toBe(EUROPEPMC_SEARCH_POST_URL);
    expect(built.transmittedQuery).toBe(built.queryString);
  });

  it("stays on GET exactly at the budget", () => {
    const value = "x".repeat(EUROPEPMC_QUERY_DESIGN_BUDGET - 2);
    const built = buildEuropePmcSearchRequest({
      query: { terms: term(value), limit: 1 },
      pageSize: 1,
    });
    expect(built.renderedQuery.length).toBe(EUROPEPMC_QUERY_DESIGN_BUDGET);
    expect(built.method).toBe("GET");
  });

  it("appends raw parameters sorted by key, before email, never touching query", () => {
    const built = buildEuropePmcSearchRequest({
      query: {
        terms: term("x"),
        raw: { synonym: "true", sort: "P_PDATE_D desc" },
        limit: 1,
      },
      pageSize: 1,
    });
    const params = new URLSearchParams(built.queryString);
    expect([...params.keys()]).toEqual([
      "query",
      "resultType",
      "format",
      "pageSize",
      "cursorMark",
      "sort",
      "synonym",
      "email",
    ]);
    expect(params.get("synonym")).toBe("true");
    expect(params.get("query")).toBe('"x"');
    // Not part of the preview.
    expect(
      explainEuropePmcQuery({
        terms: term("x"),
        raw: { synonym: "true" },
        limit: 1,
      }),
    ).toBe('"x"');
  });

  it("refuses every reserved raw key by name", () => {
    expect([...RESERVED_RAW_PARAMS].sort()).toEqual(
      [
        "cursorMark",
        "email",
        "format",
        "page",
        "pageSize",
        "query",
        "resultType",
      ].sort(),
    );
    for (const key of RESERVED_RAW_PARAMS) {
      expect(() =>
        buildEuropePmcSearchRequest({
          query: { terms: term("x"), raw: { [key]: "1" }, limit: 1 },
          pageSize: 1,
        }),
      ).toThrow(new RegExp(`raw\\.${key} is reserved`, "u"));
    }
  });

  it("round-trips a CJK phrase, `&`, `+` and `#` through a real URL parse", () => {
    const value = "基因编辑 & Cas9 + #1";
    const built = buildEuropePmcSearchRequest({
      query: { terms: term(value, "title"), limit: 1 },
      pageSize: 1,
    });
    expect(new URL(built.url).searchParams.get("query")).toBe(
      `TITLE:"${value}"`,
    );
  });

  it("has no credential to redact, so transmittedUrl is the URL itself", () => {
    const built = buildEuropePmcSearchRequest({
      query: QUERY_TYPICAL,
      pageSize: 20,
    });
    expect(built.transmittedUrl).toBe(built.url);
    expect(built.transmittedQuery).toBe(built.queryString);
  });
});

// ---------------------------------------------------------------------------
// 3. Capabilities and the §12.3 column as a declaration
// ---------------------------------------------------------------------------

describe("EUROPEPMC_CAPABILITIES", () => {
  it("declares the card's step 6 values", () => {
    expect(EUROPEPMC_CAPABILITIES).toMatchObject({
      keywordSearch: true,
      abstractsInSearch: true,
      dateFilter: true,
      citationGraph: true,
      benefitsFromApiKey: false,
      maxPageSize: 1000,
      maxTotalResults: undefined,
      relatedByWork: false,
      lookupById: [],
    });
    expect(EUROPEPMC_PAGE_SIZE_MAX).toBe(1000);
  });

  it("fills capabilities.query from the renderer's own prefix table (item 97)", () => {
    expect(EUROPEPMC_CAPABILITIES.query).toEqual({
      or: true,
      not: true,
      phrase: true,
      fields: EUROPEPMC_RENDERED_FIELDS,
    });
    expect([...EUROPEPMC_RENDERED_FIELDS].sort()).toEqual(
      [
        "abstract",
        "author",
        "journal",
        "meshTerm",
        "title",
        "titleOrAbstract",
      ].sort(),
    );
    expect(EUROPEPMC_RENDERED_FIELDS).not.toContain("affiliation");
    expect(EUROPEPMC_RENDERED_FIELDS).not.toContain("any");
  });

  it("normalizeForSource reports only the affiliation loss against this column", () => {
    const fine = parseUserQuery(
      '("a" OR b) AND title:c NOT abstract:d author:e',
    );
    expect(normalizeForSource(fine, EUROPEPMC_CAPABILITIES)).toEqual([]);
    const affiliation = term("Harvard", "affiliation");
    expect(
      normalizeForSource(and(term("x"), affiliation), EUROPEPMC_CAPABILITIES),
    ).toEqual([affiliation]);
  });

  it("names the display key by the one convention the corpus has, source-<id>", () => {
    expect(EUROPEPMC_DISPLAY_NAME_KEY).toBe(
      `${MESSAGE_PREFIX}source-${EUROPEPMC_SOURCE_ID}`,
    );
    expect(EUROPEPMC_HEALTH_OK_MESSAGE_KEY).toBe(EUROPEPMC_DISPLAY_NAME_KEY);
    expect(EUROPEPMC_HEALTH_FAILED_MESSAGE_KEY).toBe("rh-error-source");
  });
});

// ---------------------------------------------------------------------------
// 4. Markup and dates
// ---------------------------------------------------------------------------

describe("flattenMarkup", () => {
  it("strips raw tags (post<b>-</b>translational — the recorded title)", () => {
    expect(
      flattenMarkup(
        "Role in post<b>-</b>translational modification of M2<b>-</b>type pyruvate kinase.",
      ),
    ).toBe(
      "Role in post-translational modification of M2-type pyruvate kinase.",
    );
  });

  it("decodes entities before stripping, so escaped tags vanish too", () => {
    expect(
      flattenMarkup(
        "Effect of topical &lt;i&gt;Zingiber cassumunar&lt;/i&gt; on pain.",
      ),
    ).toBe("Effect of topical Zingiber cassumunar on pain.");
    expect(
      flattenMarkup("A &amp; B &#x2009;C &#8201;D &nbsp;E &quot;F&quot;"),
    ).toBe('A & B  C  D  E "F"');
  });

  it("turns <h4> headings into labelled paragraphs (docs/07 §5.1 abstract rule)", () => {
    expect(
      flattenMarkup(
        "<h4>Background</h4>Plai or <i>Zingiber</i> Roxb.<h4>Methods</h4>A RCT, 2 <sup>nd</sup> week.",
      ),
    ).toBe("Background: Plai or Zingiber Roxb.\n\nMethods: A RCT, 2 nd week.");
  });

  it("keeps a subscript's text and the text order (textContent semantics)", () => {
    expect(flattenMarkup("VO <sub>2max</sub> and H<sub>2</sub>O")).toBe(
      "VO 2max and H2O",
    );
  });

  it("squashes layout whitespace only, keeping a significant Unicode space", () => {
    expect(flattenMarkup("  a \n\t b c  ")).toBe("a b c");
    expect(flattenMarkup("")).toBe("");
    expect(flattenMarkup("<i></i>")).toBe("");
  });

  it("leaves an unknown entity and a lone < alone", () => {
    expect(flattenMarkup("a &foo; b < c")).toBe("a &foo; b < c");
  });
});

describe("readPartialDate", () => {
  it("reads YYYY, YYYY-MM and YYYY-MM-DD at their own precision", () => {
    expect(readPartialDate("2024")).toEqual({ year: 2024, iso: "2024" });
    expect(readPartialDate("2024-03")).toEqual({
      year: 2024,
      month: 3,
      iso: "2024-03",
    });
    expect(readPartialDate("2024-03-15")).toEqual({
      year: 2024,
      month: 3,
      day: 15,
      iso: "2024-03-15",
    });
  });

  it("returns undefined for free text, a zero year, or an impossible month", () => {
    expect(readPartialDate("2023 Sept 28")).toBeUndefined();
    expect(readPartialDate("0000")).toBeUndefined();
    expect(readPartialDate("2024-13")).toBeUndefined();
    expect(readPartialDate(undefined)).toBeUndefined();
    expect(readPartialDate(2024)).toBeUndefined();
  });

  it("drops an out-of-range day rather than inventing one", () => {
    expect(readPartialDate("2024-03-00")).toEqual({
      year: 2024,
      month: 3,
      iso: "2024-03",
    });
  });
});

// ---------------------------------------------------------------------------
// 5. The mapper over the recorded fixtures — docs/07 §11.1 step 6
// ---------------------------------------------------------------------------

describe("mapper: the journal article (record-rich, docs/02 §3.4's own paper)", () => {
  it("maps MED/37258680 field for field", async () => {
    const records = mapper()(await recordedResults("record-rich"));
    expect(records).toHaveLength(1);
    const r = byNativeId(records, "MED/37258680");
    expect(r.id).toBe("europepmc:MED/37258680");
    expect(r.sourceId).toBe("europepmc");
    expect(r.retrievedAtEpochMs).toBe(NOW);
    expect(r.raw).toBeUndefined();
    expect(r.work.ids).toEqual({
      doi: "10.1038/s41586-023-06139-9",
      pmid: "37258680",
      pmcid: "PMC10949956",
    });
    expect(r.work.type).toBe("journal-article");
    // Trailing period stripped, as the PubMed mapper does (docs/02 §10.4).
    expect(r.work.title).toBe(
      "Transfer learning enables predictions in network biology",
    );
    expect(r.work.abstract).toMatch(/^Mapping gene networks requires/u);
    expect(r.work.abstract).toContain(
      "natural language understanding1,2 and computer vision3",
    );
    expect(r.work.abstract).not.toMatch(/<|&lt;/u);
    expect(r.work.authors).toHaveLength(11);
    expect(r.work.authors[0]).toEqual({
      family: "Theodoris",
      given: "Christina V",
      orcid: "0000-0003-1658-1447",
      affiliations: expect.arrayContaining([
        expect.stringContaining("Department of Data Science, Dana-Farber"),
      ]),
      sequence: 0,
    });
    expect(r.work.authors.map((a) => a.sequence)).toEqual([
      ...Array(11).keys(),
    ]);
    expect(r.work.containerTitle).toBe("Nature");
    expect(r.work.containerAbbreviation).toBe("Nature");
    expect(r.work.issn).toEqual(["0028-0836", "1476-4687"]);
    expect(r.work.volume).toBe("618");
    expect(r.work.issue).toBe("7965");
    expect(r.work.pages).toBe("616-624");
    // firstPublicationDate wins over printPublicationDate (§10.2's order).
    expect(r.work.publishedDate).toEqual({
      year: 2023,
      month: 5,
      day: 31,
      iso: "2023-05-31",
    });
    expect(r.work.language).toBe("eng");
    expect(r.work.subjects?.map((s) => s.term)).toEqual([
      "Chromatin",
      "Humans",
      "Cardiomyopathies",
      "Biology",
      "Datasets as Topic",
      "Machine Learning",
      "Neural Networks, Computer",
      "Single-Cell Gene Expression Analysis",
    ]);
    expect(
      r.work.subjects?.filter((s) => s.isMajor).map((s) => s.term),
    ).toEqual(["Biology", "Machine Learning", "Neural Networks, Computer"]);
    expect(
      r.work.subjects?.every((s) => s.scheme === "mesh" && s.id === undefined),
    ).toBe(true);
    expect(r.work.citationCount).toBe(866);
    expect(r.work.openAccess).toEqual({
      isOpenAccess: false,
      pdfUrl: "https://europepmc.org/articles/PMC10949956?pdf=render",
      landingPageUrl: "https://europepmc.org/articles/PMC10949956",
    });
    expect(r.work.keywords).toBeUndefined();
    expect(r.work.publisher).toBeUndefined();
    expect(r.work.relatedVersionIds).toBeUndefined();
    expect(r.missingFields).toEqual(["keywords"]);
  });

  it("writes no workKey, provenance or normalizedAtEpochMs", async () => {
    const [r] = mapper()(await recordedResults("record-rich"));
    expect(r).toBeDefined();
    expect(Object.keys(r?.work ?? {})).not.toEqual(
      expect.arrayContaining(["workKey", "provenance", "normalizedAtEpochMs"]),
    );
  });

  it("keeps the parsed result as raw only when asked", async () => {
    const results = await recordedResults("record-rich");
    const [kept] = mapper(true)(results);
    expect(kept?.raw).toBe(results[0]);
  });
});

describe("mapper: the preprint (record-preprint, SRC:PPR with a published version)", () => {
  it("maps three bioRxiv preprints with type preprint and the server as container", async () => {
    const records = mapper()(await recordedResults("record-preprint"));
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r.work.type).toBe("preprint");
      expect(r.work.containerTitle).toBe("bioRxiv");
      expect(r.work.publisher).toBe("bioRxiv");
      expect(r.nativeId).toMatch(/^PPR\/PPR\d+$/u);
      expect(r.work.ids.pmid).toBeUndefined();
      expect(r.missingFields).toEqual(
        expect.arrayContaining(["ids.pmid", "ids.pmcid"]),
      );
      expect(r.missingFields).not.toContain("type");
    }
  });

  it("links the published version through commentCorrectionList 'Preprint of'", async () => {
    const records = mapper()(await recordedResults("record-preprint"));
    expect(byNativeId(records, "PPR/PPR657399").work.relatedVersionIds).toEqual(
      {
        pmid: "37347132",
      },
    );
    expect(byNativeId(records, "PPR/PPR618576").work.relatedVersionIds).toEqual(
      {
        pmid: "37462074",
      },
    );
    expect(
      byNativeId(records, "PPR/PPR600375").work.relatedVersionIds,
    ).toBeUndefined();
    expect(byNativeId(records, "PPR/PPR657399").work.ids).toEqual({
      doi: "10.1101/2023.05.08.539865",
    });
    expect(byNativeId(records, "PPR/PPR657399").work.publishedDate?.iso).toBe(
      "2023-05-10",
    );
  });
});

// `plan/00` §6 item 177, owner's decision of 2026-10-15: no `SRC:PPR` clause
// is added when bioRxiv or medRxiv is enabled, because an unrestricted query
// already returns preprints. This is the measurement behind that decision
// (`docs/02` §4.5); `biorxiv.test.ts` asserts the query stays unrestricted.
describe("an unrestricted search already returns preprints (paginated-page-1)", () => {
  it("renders no SRC: clause and maps a preprint beside journal articles", async () => {
    expect(explainEuropePmcQuery(QUERY_PAGINATED)).not.toMatch(/\bSRC:/u);
    const records = mapper()(await recordedResults("paginated-page-1"));
    const preprints = records.filter((r) => r.nativeId.startsWith("PPR/"));
    const journal = records.filter((r) => r.nativeId.startsWith("MED/"));
    expect(preprints).toHaveLength(1);
    expect(preprints[0]?.work.type).toBe("preprint");
    expect(journal).toHaveLength(2);
  });
});

describe("mapper: no abstract, no DOI (record-sparse, MED/60000)", () => {
  it("reports the gaps in missingFields and never invents a field", async () => {
    const records = mapper()(await recordedResults("record-sparse"));
    const r = byNativeId(records, "MED/60000");
    expect(r.work.abstract).toBeUndefined();
    expect(r.work.ids).toEqual({ pmid: "60000" });
    expect(r.work.title).toBe("[Measures in ovine psoroptic mange]");
    expect(r.work.type).toBe("journal-article");
    expect(r.work.containerTitle).toBe("Veterinariia");
    expect(r.work.issn).toEqual(["0042-4846"]);
    expect(r.work.language).toBe("rus");
    expect(r.work.publishedDate?.iso).toBe("1976-06-01");
    expect(r.work.citationCount).toBe(0);
    expect(r.work.openAccess).toEqual({ isOpenAccess: false });
    expect(r.missingFields).toEqual([
      "abstract",
      "volume",
      "keywords",
      "ids.doi",
      "ids.pmcid",
    ]);
  });
});

describe("mapper: partial dates (hand-built, docs/13 §2.1's shapes)", () => {
  it("falls back to pubYear as a year-only date and reports an unreadable one", () => {
    const { logger, lines } = createSpyLogger();
    const map = createEuropePmcRecordMapper({
      clock: createManualClock(NOW),
      logger,
    });
    const [yearOnly] = map([result("1", "MED", { pubYear: "2024" })]);
    expect(yearOnly?.work.publishedDate).toEqual({ year: 2024, iso: "2024" });
    const [monthOnly] = map([
      result("2", "MED", { firstPublicationDate: "2024-03" }),
    ]);
    expect(monthOnly?.work.publishedDate).toEqual({
      year: 2024,
      month: 3,
      iso: "2024-03",
    });
    const [none] = map([result("3", "MED", {})]);
    expect(none?.work.publishedDate).toBeUndefined();
    expect(none?.missingFields).toContain("publishedDate");
    expect(lines).toEqual([]);

    const [odd] = map([
      result("4", "MED", {
        firstPublicationDate: "2023 Sept 28",
        pubYear: "2023",
      }),
    ]);
    expect(odd?.work.publishedDate).toEqual({ year: 2023, iso: "2023" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("date not understood");
    expect(lines[0]).toContain("firstPublicationDate");
  });

  it("prefers firstPublicationDate over printPublicationDate over pubYear", () => {
    const [r] = mapper()([
      result("1", "MED", {
        firstPublicationDate: "2023-05-31",
        journalInfo: { printPublicationDate: "2023-06-01" },
        pubYear: "2023",
      }),
    ]);
    expect(r?.work.publishedDate?.iso).toBe("2023-05-31");
    const [p] = mapper()([
      result("2", "MED", {
        journalInfo: { printPublicationDate: "2023-06-01" },
        pubYear: "2023",
      }),
    ]);
    expect(p?.work.publishedDate?.iso).toBe("2023-06-01");
  });
});

describe("mapper: 50+ authors (record-many-authors, MED/32296183)", () => {
  it("keeps all 88 authors in order with ORCIDs and affiliations", async () => {
    const records = mapper()(await recordedResults("record-many-authors"));
    const r = byNativeId(records, "MED/32296183");
    expect(r.work.authors.length).toBeGreaterThanOrEqual(50);
    expect(r.work.authors).toHaveLength(88);
    expect(r.work.authors.map((a) => a.sequence)).toEqual([
      ...Array(88).keys(),
    ]);
    expect(r.work.authors[0]?.family).toBe("Luck");
    expect(r.work.authors[0]?.given).toBe("Katja");
    expect(r.work.authors[0]?.orcid).toBe("0000-0003-2336-9225");
    expect(r.work.authors[1]?.given).toBe("Dae-Kyum");
    expect(r.work.authors.every((a) => a.family.length > 0)).toBe(true);
    expect(r.work.citationCount).toBe(1083);
  });
});

describe("mapper: Unicode (record-unicode, and a CJK title byte for byte)", () => {
  it("keeps diacritics and strips the raw <b> tags the service put in a title", async () => {
    const records = mapper()(await recordedResults("record-unicode"));
    expect(records).toHaveLength(3);
    expect(byNativeId(records, "MED/38044647").work.title).toBe(T_UNI_1);
    const turkish = byNativeId(records, "MED/39593466");
    expect(
      turkish.work.authors.map((a) => `${a.family}|${a.given ?? ""}`),
    ).toEqual(["Aracı|Ayça", "Aslan|Ummuhan Baş"]);
    const f1000 = byNativeId(records, "PPR/PPR834057");
    expect(f1000.work.type).toBe("preprint");
    expect(f1000.work.containerTitle).toBe("F1000Res");
    expect(f1000.work.title).toContain("Withania somnifera");
  });

  it("maps a CJK title and author names byte-identically (criterion 4)", () => {
    const cjkTitle =
      "基因编辑技术在范可尼贫血中的研究进展：CRISPR-Cas9 系统的应用";
    const greek = "β-catenin and the Δ32 allele: ∆F508 — a résumé";
    const [cjk] = mapper()([
      result("40355359", "MED", {
        title: cjkTitle,
        authorList: {
          author: [
            { lastName: "高", firstName: "亚明" },
            { lastName: "Αλεξίου", firstName: "Ιωάννης" },
          ],
        },
        abstractText: greek,
      }),
    ]);
    expect(cjk?.work.title).toBe(cjkTitle);
    expect(cjk?.work.abstract).toBe(greek);
    expect(cjk?.work.authors).toEqual([
      { family: "高", given: "亚明", sequence: 0 },
      { family: "Αλεξίου", given: "Ιωάννης", sequence: 1 },
    ]);
  });
});

describe("mapper: inline HTML in abstracts (record-jats-abstract, MED/39220605)", () => {
  it("flattens <h4> sections into labelled paragraphs and strips <i>, <sup> and &lt;i&gt;", async () => {
    const records = mapper()(await recordedResults("record-jats-abstract"));
    const med = byNativeId(records, "MED/39220605");
    expect(med.work.title).toBe(
      "Effect of topical Zingiber cassumunar on painful diabetic neuropathy: a double-blind randomized-controlled trial",
    );
    const paragraphs = (med.work.abstract ?? "").split("\n\n");
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(paragraphs[0]).toMatch(
      /^Background: Plai or Zingiber cassumunar Roxb\./u,
    );
    expect(paragraphs[1]).toMatch(/^Methods: A RCT was conducted/u);
    expect(med.work.abstract).not.toMatch(/<[a-z]|&lt;|&gt;/iu);
    // The preprint twin in the same page carries the same DOI: dedup material.
    const ppr = byNativeId(records, "PPR/PPR758373");
    expect(ppr.work.ids.doi).toBe(med.work.ids.doi);
    expect(ppr.work.type).toBe("preprint");
  });
});

describe("mapper: edge cases (hand-built)", () => {
  it("drops a result with no id or source, with a warning, and keeps the rest", () => {
    const { logger, lines } = createSpyLogger();
    const map = createEuropePmcRecordMapper({
      clock: createManualClock(NOW),
      logger,
    });
    const records = map([{ title: "no id" }, null, "x", result("1")]);
    expect(records.map((r) => r.nativeId)).toEqual(["MED/1"]);
    expect(lines.filter((l) => l.includes("no id/source"))).toHaveLength(3);
  });

  it("keeps a collective author as family and literal, drops a nameless one", () => {
    const { logger, lines } = createSpyLogger();
    const map = createEuropePmcRecordMapper({
      clock: createManualClock(NOW),
      logger,
    });
    const [r] = map([
      result("1", "MED", {
        authorList: {
          author: [
            { collectiveName: "GBD Collaborators" },
            { initials: "X" },
            {},
          ],
        },
      }),
    ]);
    expect(r?.work.authors).toEqual([
      {
        family: "GBD Collaborators",
        literal: "GBD Collaborators",
        sequence: 0,
      },
    ]);
    expect(
      lines.some(
        (l) => l.includes("authors dropped") && l.includes('"dropped":2'),
      ),
    ).toBe(true);
  });

  it("classifies type from docs/02 §10.2's Europe PMC triggers only", () => {
    const map = mapper();
    expect(map([result("1", "PPR")])[0]?.work.type).toBe("preprint");
    expect(
      map([result("2", "MED", { pubTypeList: { pubType: ["Preprint"] } })])[0]
        ?.work.type,
    ).toBe("preprint");
    expect(
      map([
        result("3", "MED", {
          journalInfo: { journal: { title: "J", issn: "1" } },
        }),
      ])[0]?.work.type,
    ).toBe("journal-article");
    const other = map([
      result("4", "MED", { journalInfo: { journal: { title: "J" } } }),
    ])[0];
    expect(other?.work.type).toBe("other");
    expect(other?.missingFields).toContain("type");
    expect(other?.work.containerTitle).toBe("J");
  });

  it("maps open-access links by availability code and document style", () => {
    const [r] = mapper()([
      result("1", "MED", {
        isOpenAccess: "Y",
        license: "cc by",
        fullTextUrlList: {
          fullTextUrl: [
            {
              availabilityCode: "S",
              documentStyle: "pdf",
              url: "https://paywall/x.pdf",
            },
            {
              availabilityCode: "OA",
              documentStyle: "html",
              url: "https://oa/x",
            },
            {
              availabilityCode: "F",
              documentStyle: "pdf",
              url: "https://free/x.pdf",
            },
          ],
        },
      }),
    ]);
    expect(r?.work.openAccess).toEqual({
      isOpenAccess: true,
      pdfUrl: "https://free/x.pdf",
      landingPageUrl: "https://oa/x",
      license: "cc by",
    });
    expect(mapper()([result("2")])[0]?.work.openAccess).toBeUndefined();
  });

  it("normalizes identifiers and warns on ones it cannot read", () => {
    const { logger, lines } = createSpyLogger();
    const map = createEuropePmcRecordMapper({
      clock: createManualClock(NOW),
      logger,
    });
    const [r] = map([
      result("1", "MED", {
        doi: "https://doi.org/10.1038/X",
        pmid: "abc",
        pmcid: "10949956",
      }),
    ]);
    expect(r?.work.ids).toEqual({ doi: "10.1038/x", pmcid: "PMC10949956" });
    expect(lines.some((l) => l.includes("PMID not understood"))).toBe(true);
  });

  it("declares every missingFields member in EUROPEPMC_MAPPABLE_FIELDS", () => {
    const [bare] = mapper()([result("1", "MED", { title: "" })]);
    expect(bare?.missingFields).toEqual(EUROPEPMC_MAPPABLE_FIELDS);
  });
});

// ---------------------------------------------------------------------------
// 6. The response validator and the paging rule
// ---------------------------------------------------------------------------

describe("parseEuropePmcSearchBody", () => {
  it("throws SourceError on errCode inside a 200, before reading resultList", () => {
    const body =
      '{"errCode":404,"errMsg":"No search criteria provided.","resultList":{"result":[]}}';
    expect(() => parseEuropePmcSearchBody(body, "u")).toThrow(SourceError);
    expect(() => parseEuropePmcSearchBody(body, "u")).toThrow(
      /errCode 404: No search criteria provided\./u,
    );
    try {
      parseEuropePmcSearchBody(body, "u");
    } catch (error) {
      expect(error).not.toBeInstanceOf(ParseError);
      expect((error as SourceError).sourceId).toBe("europepmc");
      expect((error as SourceError).context).toMatchObject({
        errCode: 404,
        url: "u",
      });
    }
  });

  it("throws ParseError for text/plain, a non-object, and a page without resultList.result", () => {
    expect(() =>
      parseEuropePmcSearchBody(
        "This API is temporarily unavailable due to maintenance.",
        "u",
      ),
    ).toThrow(ParseError);
    expect(() => parseEuropePmcSearchBody("[]", "u")).toThrow(ParseError);
    expect(() => parseEuropePmcSearchBody('{"hitCount":1}', "u")).toThrow(
      /no resultList\.result array/u,
    );
  });

  it("reads hitCount, nextCursorMark, the echoed queryString and version", () => {
    const parsed = parseEuropePmcSearchBody(
      pageBody({
        hitCount: 5,
        nextCursorMark: "AoII",
        request: { queryString: "q" },
        resultList: { result: [result("1")] },
      }),
      "u",
    );
    expect(parsed.results).toHaveLength(1);
    expect(parsed.nextCursorMark).toBe("AoII");
    expect(parsed.extras).toEqual({
      hitCount: 5,
      queryString: "q",
      version: "6.9",
    });
    expect(
      parseEuropePmcSearchBody(pageBody({ resultList: { result: [] } }), "u")
        .nextCursorMark,
    ).toBeUndefined();
  });
});

describe("nextCursorAfter — docs/02 §4.6's two rules and the two measured ones", () => {
  it("continues only on a new cursor after a full page", () => {
    expect(nextCursorAfter("*", "A", 3, 3)).toBe("A");
  });
  it("stops when nextCursorMark repeats the cursor sent (criterion 3)", () => {
    expect(nextCursorAfter("A", "A", 3, 3)).toBeUndefined();
  });
  it("stops on an empty page", () => {
    expect(nextCursorAfter("A", "B", 0, 3)).toBeUndefined();
  });
  it("stops when the service omits nextCursorMark", () => {
    expect(nextCursorAfter("A", undefined, 3, 3)).toBeUndefined();
  });
  it("stops after a short page (measured: page 2 of 5 hits at pageSize 3 held 2 and a cursor; page 3 held none)", () => {
    expect(nextCursorAfter("A", "B", 2, 3)).toBeUndefined();
  });
});

describe("clampPageSize", () => {
  it("clamps SourceQuery.limit into 1 … 1000", () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-5)).toBe(1);
    expect(clampPageSize(20)).toBe(20);
    expect(clampPageSize(20.9)).toBe(20);
    expect(clampPageSize(5000)).toBe(1000);
    expect(clampPageSize(Number.NaN)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. The adapter over a stub transport
// ---------------------------------------------------------------------------

describe("createEuropePmcSource — identity and requests", () => {
  it("reports its identity from the constants, keyed on the EBI host", () => {
    const source = createSource(createStubHttp(() => response("", "")).client);
    expect(source.id).toBe("europepmc");
    expect(source.displayNameKey).toBe(EUROPEPMC_DISPLAY_NAME_KEY);
    expect(source.capabilities).toBe(EUROPEPMC_CAPABILITIES);
    expect(source.rateLimitKey).toBe(EBI_HOST);
    expect(source.rateLimitKey).toBe("www.ebi.ac.uk");
    expect(source.isConfigured()).toBe(true);
    expect(source.explainQuery(QUERY_TYPICAL)).toBe(
      explainEuropePmcQuery(QUERY_TYPICAL),
    );
    // Not declared, so nothing promises a method nobody implements.
    expect(source.findRelated).toBeUndefined();
    expect(source.lookup).toBeUndefined();
    expect(source.fetchAbstract).toBeUndefined();
  });

  it("issues GET /search with resultType=core, a clamped pageSize and cursorMark=*", async () => {
    const stub = createStubHttp((issued) =>
      response(
        issued.url,
        pageBody({ hitCount: 1, resultList: { result: [result("1")] } }),
      ),
    );
    const page = await createSource(stub.client).search(
      { ...QUERY_TYPICAL, limit: 5000 },
      ctx(),
    );
    expect(stub.issued).toHaveLength(1);
    const [call] = stub.issued;
    expect(call?.method).toBe("GET");
    expect(call?.options?.responseType).toBe("text");
    expect(call?.url.startsWith(`${EUROPEPMC_SEARCH_URL}?`)).toBe(true);
    const params = paramsOf(call as Issued);
    expect(params.get("resultType")).toBe("core");
    expect(params.get("pageSize")).toBe("1000");
    expect(params.get("cursorMark")).toBe("*");
    expect(params.get("email")).toBe(MAINTAINER_EMAIL);
    expect(page.records.map((r) => r.nativeId)).toEqual(["MED/1"]);
    expect(page.totalAvailable).toBe(1);
    expect(page.warnings).toEqual([]);
    expect(page.sourceExtras.hitCount).toBe(1);
  });

  it("passes the cursor through and never emits page=", async () => {
    const stub = createStubHttp((issued) =>
      response(
        issued.url,
        pageBody({
          hitCount: 9,
          nextCursorMark: "B",
          resultList: { result: [result("1"), result("2")] },
        }),
      ),
    );
    const page = await createSource(stub.client).search(
      { ...QUERY_TYPICAL, limit: 2, cursor: "A" },
      ctx(),
    );
    const params = paramsOf(stub.issued[0] as Issued);
    expect(params.get("cursorMark")).toBe("A");
    expect(params.has("page")).toBe(false);
    expect(page.nextCursor).toBe("B");
  });

  it("POSTs a form body above the design budget with the right content type", async () => {
    const stub = createStubHttp((issued) =>
      response(
        issued.url,
        pageBody({ hitCount: 0, resultList: { result: [] } }),
      ),
    );
    await createSource(stub.client).search(QUERY_POST_LONG, ctx());
    const [call] = stub.issued;
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(EUROPEPMC_SEARCH_POST_URL);
    expect(call?.options?.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(paramsOf(call as Issued).get("pageSize")).toBe("5");
  });

  it("turns errCode inside a 200 into SourceError and a non-JSON 200 into ParseError", async () => {
    const errored = createStubHttp((issued) =>
      response(
        issued.url,
        '{"errCode":404,"errMsg":"Invalid page size provided."}',
      ),
    );
    await expect(
      createSource(errored.client).search(QUERY_TYPICAL, ctx()),
    ).rejects.toBeInstanceOf(SourceError);
    const text = createStubHttp((issued) =>
      response(issued.url, "<html>oops</html>"),
    );
    await expect(
      createSource(text.client).search(QUERY_TYPICAL, ctx()),
    ).rejects.toBeInstanceOf(ParseError);
  });

  it("never gives the logger a response body or an abstract", async () => {
    const { logger, lines } = createSpyLogger();
    const stub = createStubHttp((issued) =>
      response(
        issued.url,
        pageBody({
          hitCount: 1,
          resultList: {
            result: [
              result("1", "MED", { abstractText: "SECRET-ABSTRACT-TEXT" }),
            ],
          },
        }),
      ),
    );
    await createSource(stub.client, { logger }).search(QUERY_TYPICAL, ctx());
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("SECRET-ABSTRACT-TEXT");
    expect(lines.join("\n")).toContain("europepmc search");
  });

  it("honours cancellation before the request goes out", async () => {
    const stub = createStubHttp((issued) =>
      response(issued.url, pageBody({ resultList: { result: [] } })),
    );
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });
    await expect(
      createSource(stub.client).search(QUERY_TYPICAL, { token: cts.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(stub.issued).toHaveLength(0);
  });
});

describe("createEuropePmcSource — searchAll", () => {
  /**
   * A service-shaped stub: `total` records, each page returns at most
   * `pageSize` of them from the offset the cursor encodes, and — as the
   * recorded corpus showed on its last short page — a cursor is offered even
   * when nothing follows.
   */
  function servedStub(total: number) {
    return createStubHttp((issued) => {
      const params = paramsOf(issued);
      const sent = params.get("cursorMark") ?? "*";
      const offset = sent === "*" ? 0 : Number(sent.slice(1));
      const pageSize = Number(params.get("pageSize"));
      const ids = Array.from(
        { length: Math.max(0, Math.min(pageSize, total - offset)) },
        (_, i) => String(offset + i + 1),
      );
      return response(
        issued.url,
        pageBody({
          hitCount: total,
          nextCursorMark: `c${String(offset + ids.length)}`,
          resultList: { result: ids.map((id) => result(id)) },
        }),
      );
    });
  }

  it("asks for exactly what is still wanted, capped at 1000, and stops at limit", async () => {
    const stub = servedStub(5000);
    const out: string[] = [];
    for await (const r of createSource(stub.client).searchAll(
      { ...QUERY_TYPICAL, limit: 2200 },
      ctx(),
    )) {
      out.push(r.nativeId);
    }
    expect(out).toHaveLength(2200);
    expect(out[0]).toBe("MED/1");
    expect(out[2199]).toBe("MED/2200");
    expect(stub.issued.map((i) => paramsOf(i).get("pageSize"))).toEqual([
      "1000",
      "1000",
      "200",
    ]);
    expect(stub.issued.map((i) => paramsOf(i).get("cursorMark"))).toEqual([
      "*",
      "c1000",
      "c2000",
    ]);
  });

  it("stops after a short page even though the service offered a cursor (the measured case)", async () => {
    const stub = servedStub(7);
    const out: string[] = [];
    for await (const r of createSource(stub.client).searchAll(
      { ...QUERY_TYPICAL, limit: 1000 },
      ctx(),
    )) {
      out.push(r.nativeId);
    }
    expect(out).toHaveLength(7);
    expect(stub.issued).toHaveLength(1);
  });

  it("stops when nextCursorMark repeats the cursor sent (criterion 3)", async () => {
    // Through `search()`: a full page whose cursor repeats offers no next page.
    const repeating = createStubHttp((issued) =>
      response(
        issued.url,
        pageBody({
          hitCount: 99,
          nextCursorMark: "same",
          resultList: { result: [result("1"), result("2")] },
        }),
      ),
    );
    const source = createSource(repeating.client);
    const first = await source.search(
      { ...QUERY_TYPICAL, limit: 2, cursor: "*" },
      ctx(),
    );
    expect(first.nextCursor).toBe("same");
    const second = await source.search(
      { ...QUERY_TYPICAL, limit: 2, cursor: "same" },
      ctx(),
    );
    expect(second.nextCursor).toBeUndefined();

    // Through `searchAll`, against a stub that over-delivers a full page with
    // a repeating cursor forever: the loop ends by limit, never spinning — and
    // because each page asks for exactly what remains, a full page always
    // satisfies the limit, so the repeat rule's own stop is `search()`'s to
    // make (above), not this loop's.
    const forever = createStubHttp((issued) => {
      const pageSize = Number(paramsOf(issued).get("pageSize"));
      return response(
        issued.url,
        pageBody({
          hitCount: 99,
          nextCursorMark: "same",
          resultList: {
            result: Array.from({ length: pageSize }, (_, i) =>
              result(String(i)),
            ),
          },
        }),
      );
    });
    const out: string[] = [];
    for await (const r of createSource(forever.client).searchAll(
      { ...QUERY_TYPICAL, limit: 5 },
      ctx(),
    )) {
      out.push(r.nativeId);
    }
    expect(out).toHaveLength(5);
    expect(forever.issued).toHaveLength(1);
  });

  it("emits nothing and requests nothing for limit 0", async () => {
    const stub = createStubHttp((issued) =>
      response(issued.url, pageBody({ resultList: { result: [] } })),
    );
    const out: SourceRecord[] = [];
    for await (const r of createSource(stub.client).searchAll(
      { ...QUERY_TYPICAL, limit: 0 },
      ctx(),
    ))
      out.push(r);
    expect(out).toEqual([]);
    expect(stub.issued).toHaveLength(0);
  });
});

describe("createEuropePmcSource — healthCheck", () => {
  it("probes with pageSize=1 and resultType=idlist and reports ok", async () => {
    const stub = createStubHttp((issued) =>
      response(
        issued.url,
        pageBody({
          hitCount: 3,
          resultList: { result: [{ id: "1", source: "MED" }] },
        }),
      ),
    );
    const clock = createManualClock(NOW);
    const health = await createSource(stub.client, { clock }).healthCheck(
      ctx(),
    );
    const params = paramsOf(stub.issued[0] as Issued);
    expect(params.get("pageSize")).toBe("1");
    expect(params.get("resultType")).toBe("idlist");
    expect(params.get("query")).toBe('"europepmc"');
    expect(health).toEqual({
      ok: true,
      messageKey: EUROPEPMC_HEALTH_OK_MESSAGE_KEY,
      latencyMs: 0,
    });
  });

  it("reports an errCode-inside-200 as unhealthy with the error's own messageKey", async () => {
    const stub = createStubHttp((issued) =>
      response(issued.url, '{"errCode":404,"errMsg":"x"}'),
    );
    const health = await createSource(stub.client).healthCheck(ctx());
    expect(health.ok).toBe(false);
    expect(health.messageKey).toBe("rh-error-source");
  });

  it("reports a thrown non-plugin error with the fallback key, and rethrows cancellation", async () => {
    const boom: HttpClient = {
      request: () => Promise.reject(new Error("socket")),
    };
    const health = await createSource(boom).healthCheck(ctx());
    expect(health).toMatchObject({
      ok: false,
      messageKey: EUROPEPMC_HEALTH_FAILED_MESSAGE_KEY,
    });
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });
    await expect(
      createSource(boom).healthCheck({ token: cts.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

// ---------------------------------------------------------------------------
// 8. The recorded corpus through the shipped client — docs/13 §2.2 in Node
// ---------------------------------------------------------------------------

describe("replay: test/fixtures/europepmc through createHttpClient", () => {
  function replaySource() {
    const replay = createReplayHttpClient({ dir: FIXTURE_DIR, host: EBI_HOST });
    const source = createEuropePmcSource({
      http: replay.client,
      clock: replay.clock,
      mapRecords: createEuropePmcRecordMapper({ clock: replay.clock }),
    });
    return { ...replay, source };
  }

  it("holds docs/13 §3.1's thirteen scenarios, each with a sidecar, plus the extras", async () => {
    const loaded = await listFixtureMeta(FIXTURE_DIR);
    const scenarios = loaded.map((m) => m.meta.scenario);
    for (const name of DOCS_13_SCENARIOS) expect(scenarios).toContain(name);
    expect(scenarios).toEqual(
      expect.arrayContaining([
        "paginated-page-2",
        "paginated-page-3",
        "search-error-empty-query",
        "search-post-long-query",
        "record-many-authors",
        "record-unicode-cjk",
      ]),
    );
    expect(loaded).toHaveLength(19);
    const names = await readdir(FIXTURE_DIR);
    for (const { key } of loaded) {
      expect(names).toContain(`${key}.json`);
      expect(names).toContain(`${key}${META_SUFFIX}`);
    }
    for (const { meta } of loaded) {
      expect(
        meta.endpoint.startsWith(
          `https://${EBI_HOST}/europepmc/webservices/rest/search`,
        ),
      ).toBe(true);
      expect(["GET", "POST"]).toContain(meta.method);
      expect(meta.synthetic).toBe(
        ["error-429", "error-500", "error-malformed"].includes(meta.scenario),
      );
    }
  });

  it("carries no contact address, in either spelling, and is fresh", async () => {
    const names = (await readdir(FIXTURE_DIR)).filter((n) =>
      n.endsWith(".json"),
    );
    for (const name of names) {
      const text = await readFile(`${FIXTURE_DIR}/${name}`, "utf8");
      expect(text).not.toMatch(/suppakoko(@|%40)gmail/iu);
    }
    const report = await assertFixturesFresh(FIXTURE_DIR, Date.now());
    expect(report.checked).toBe(19);
  });

  it("search-typical: 20 records, each with an abstract where abstractText was present (criterion 1)", async () => {
    const { source, transport } = replaySource();
    const page = await source.search(QUERY_TYPICAL, ctx());
    expect(page.records.length).toBeGreaterThanOrEqual(20);
    expect(page.totalAvailable).toBe(4186);
    expect(page.nextCursor).toBe("AoIIP8zOvCg0ODA0Mjc5NQ==");
    const raw = await recordedResults("search-typical");
    const withAbstract = raw.filter(
      (r) => typeof (r as { abstractText?: unknown }).abstractText === "string",
    );
    expect(withAbstract).toHaveLength(19);
    for (const record of page.records) {
      const source = raw.find(
        (r) =>
          `${String((r as { source: string }).source)}/${String((r as { id: string }).id)}` ===
          record.nativeId,
      );
      const hadAbstract =
        typeof (source as { abstractText?: unknown }).abstractText === "string";
      if (hadAbstract)
        expect(record.work.abstract?.length ?? 0).toBeGreaterThan(0);
      else expect(record.missingFields).toContain("abstract");
      expect(record.work.abstract ?? "").not.toMatch(/<[a-z]/iu);
      expect(record.work.title).not.toMatch(/<[a-z]|&lt;/iu);
    }
    expect(
      page.records
        .filter((r) => r.work.abstract === undefined)
        .map((r) => r.nativeId),
    ).toEqual(["MED/36952053"]);
    expect(transport.calls[0]?.options.headers?.["User-Agent"]).toMatch(
      /^research_helper\//u,
    );
  });

  it("search-empty: zero records and no next cursor", async () => {
    const page = await replaySource().source.search(QUERY_EMPTY, ctx());
    expect(page.records).toEqual([]);
    expect(page.totalAvailable).toBe(0);
    expect(page.nextCursor).toBeUndefined();
  });

  it("search-single: one record, a next cursor (hitCount 4186), pageSize 1", async () => {
    const page = await replaySource().source.search(
      { ...QUERY_TYPICAL, limit: 1 },
      ctx(),
    );
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.nativeId).toBe("MED/37050104");
    expect(page.nextCursor).toBeDefined();
  });

  it("search-error-empty-query: errCode 404 inside HTTP 200 is a SourceError, not an empty page (criterion 2)", async () => {
    const { source } = replaySource();
    const pending = source.search(QUERY_ERROR_EMPTY, ctx());
    await expect(pending).rejects.toBeInstanceOf(SourceError);
    await expect(pending).rejects.not.toBeInstanceOf(ParseError);
    await expect(pending).rejects.toThrow(
      /errCode 404: No search criteria provided/u,
    );
  });

  it("paginated: three recorded pages drive the cursor loop to termination (criterion 3)", async () => {
    const { source, transport } = replaySource();
    const page1 = await source.search(QUERY_PAGINATED, ctx());
    expect(page1.records).toHaveLength(3);
    expect(page1.totalAvailable).toBe(5);
    expect(page1.nextCursor).toBe("AoIIQDGUpSg1MTQ2NzgxMA==");

    const page2 = await source.search(
      { ...QUERY_PAGINATED, cursor: page1.nextCursor ?? "" },
      ctx(),
    );
    expect(page2.records.map((r) => r.nativeId)).toEqual([
      "MED/32296183",
      "MED/60000",
    ]);
    // The service still offered a cursor; the short-page rule says stop.
    expect(page2.nextCursor).toBeUndefined();

    // The recorded page 3 proves that stopping was right: it is empty.
    const page3 = await source.search(
      { ...QUERY_PAGINATED, cursor: "AoIIPsVcJic0ODQwMjU5" },
      ctx(),
    );
    expect(page3.records).toEqual([]);
    expect(page3.nextCursor).toBeUndefined();
    expect(transport.calls).toHaveLength(3);

    // And searchAll over the same corpus stops after two requests.
    const { source: again, transport: calls } = replaySource();
    const all: string[] = [];
    for await (const r of again.searchAll(
      { ...QUERY_PAGINATED, limit: 3 },
      ctx(),
    ))
      all.push(r.nativeId);
    expect(all).toHaveLength(3);
    expect(calls.calls).toHaveLength(1);
  });

  it("search-post-long-query: the POST path replays and the service honoured the body", async () => {
    const { source, transport } = replaySource();
    const page = await source.search(QUERY_POST_LONG, ctx());
    expect(transport.calls[0]?.method).toBe("POST");
    expect(transport.calls[0]?.url).toBe(EUROPEPMC_SEARCH_POST_URL);
    expect(page.sourceExtras.queryString?.length).toBe(3085);
    expect(page.totalAvailable).toBe(27156);
    expect(page.records).toHaveLength(5);
  });

  it("record-unicode-cjk: the live title field carries no CJK — the probe is kept as evidence", async () => {
    const page = await replaySource().source.search(QUERY_CJK, ctx());
    expect(page.totalAvailable).toBe(11);
    expect(page.records).toHaveLength(3);
    for (const r of page.records) {
      expect(r.work.title).not.toMatch(/[㐀-鿿]/u);
      expect(r.work.language).toMatch(/^(chi|eng)$/u);
    }
  });

  it("dedup-pair-set: the DOI query returns PubMed's record-rich paper with matching ids", async () => {
    const page = await replaySource().source.search(QUERY_PAIR, ctx());
    const twin = byNativeId(page.records, "MED/37258680");
    expect(twin.work.ids).toEqual({
      doi: "10.1038/s41586-023-06139-9",
      pmid: "37258680",
      pmcid: "PMC10949956",
    });
    expect(twin.work.title).toBe(T_RICH);
  });

  it("record scenarios replay through search() too", async () => {
    const { source } = replaySource();
    expect(
      (await source.search(QUERY_RICH, ctx())).records.map((r) => r.nativeId),
    ).toEqual(["MED/37258680"]);
    expect(
      (await source.search(QUERY_SPARSE, ctx())).records.map((r) => r.nativeId),
    ).toEqual(["MED/60000"]);
    expect((await source.search(QUERY_JATS, ctx())).records).toHaveLength(2);
    expect(
      (await source.search(QUERY_MANY, ctx())).records[0]?.work.authors,
    ).toHaveLength(88);
    expect((await source.search(QUERY_UNICODE, ctx())).records).toHaveLength(3);
    expect(
      (await source.search(QUERY_PREPRINT, ctx())).records.every(
        (r) => r.work.type === "preprint",
      ),
    ).toBe(true);
  });

  it("error-429: RateLimitError with Retry-After 2 s, and the host is parked", async () => {
    const { source, limiter, clock } = replaySource();
    const pending = source.search(QUERY_SYNTHETIC_429, ctx());
    await expect(pending).rejects.toBeInstanceOf(RateLimitError);
    await pending.catch((error: unknown) => {
      expect((error as RateLimitError).retryAfterMs).toBe(2000);
    });
    expect(limiter.penalties[0]?.untilEpochMs).toBe(clock.now() + 2000);
  });

  it("error-500: a text/plain 503 (docs/02 §4.7's measured body) is UpstreamServerError", async () => {
    await expect(
      replaySource().source.search(QUERY_SYNTHETIC_500, ctx()),
    ).rejects.toBeInstanceOf(UpstreamServerError);
  });

  it("error-malformed: a truncated 200 body is ParseError, never zero results", async () => {
    const pending = replaySource().source.search(
      QUERY_SYNTHETIC_MALFORMED,
      ctx(),
    );
    await expect(pending).rejects.toBeInstanceOf(ParseError);
    await expect(pending).rejects.toThrow(/not JSON/u);
  });
});

// ---------------------------------------------------------------------------
// 9. The www.ebi.ac.uk policy row, read back from docs/07 §7.3 (criterion 5)
// ---------------------------------------------------------------------------

describe("hostLimiter: the www.ebi.ac.uk row", () => {
  function section73Row(host: string): Record<string, string> {
    const lines = readFileSync(DOCS_07, "utf8").split("\n");
    const start = lines.findIndex((l) => l.startsWith("### 7.3 "));
    expect(start).toBeGreaterThan(0);
    const header = lines.findIndex(
      (l, i) => i > start && l.startsWith("| Host |"),
    );
    expect(header).toBeGreaterThan(start);
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

  it("matches §7.3's rate, burst and concurrency exactly, with no key mode", () => {
    const row = section73Row(EBI_HOST);
    expect(row["Rate"]).toBe("5/s");
    expect(row["Burst"]).toBe("5");
    expect(row["Max concurrent"]).toBe("3");
    const policy = HOST_POLICIES.find((p) => p.host === EBI_HOST);
    expect(policy).toBeDefined();
    expect(policy?.withoutKey).toEqual({
      ratePerSecond: Number(row["Rate"]?.replace("/s", "")),
      burst: Number(row["Burst"]),
      maxConcurrent: Number(row["Max concurrent"]),
    });
    expect(policy?.withoutKey).toEqual({
      ratePerSecond: 5,
      burst: 5,
      maxConcurrent: 3,
    });
    expect(policy?.withKey).toBeUndefined();
    expect(policy?.keyPresencePref).toBeUndefined();
  });

  // Until 2026-10-14 §7.3's three retry cells for this host read `—` and this
  // test pinned the row at "no retry budget" (transcription, not omission). The
  // owner filled the cells that day (P2-T03 report, plan/00 §6 item 126) and
  // P2-T32 copied them; the pin now reads the document the same way
  // backoff.test.ts does, so a future edit to either side fails here.
  it("carries the retry budget §7.3's three cells state, read from the document", () => {
    const row = section73Row(EBI_HOST);
    const ms = (cell: string | undefined): number =>
      Number((cell ?? "").replace(/\s/g, "").replace("ms", ""));
    const retry = HOST_POLICIES.find((p) => p.host === EBI_HOST)?.retry;
    expect(retry).toBeDefined();
    expect(retry).toEqual({
      baseMs: ms(row["Retry base"]),
      capMs: ms(row["Retry cap"]),
      maxAttempts: Number(row["Attempt cap"]),
    });
    expect(retry).toEqual({ baseMs: 1000, capMs: 30_000, maxAttempts: 3 });
  });

  it("is served by the registry as its own bucket, in table order after NCBI", () => {
    const registry = createHostLimiterRegistry({
      clock: createManualClock(NOW),
    });
    // Until 2026-10-15 this pinned the whole host list to [NCBI, EBI]; a third
    // row (P2-T04's Crossref) made it stale. tokenBucket.test.ts owns the full
    // shipped-host list; here only this row's place after NCBI is asserted.
    expect(registry.hosts).toContain(EBI_HOST);
    expect(registry.hosts.indexOf(EBI_HOST)).toBeGreaterThan(
      registry.hosts.indexOf("eutils.ncbi.nlm.nih.gov"),
    );
    expect(registry.policyFor(EBI_HOST)?.withoutKey.ratePerSecond).toBe(5);
    expect(registry.limiterFor(EBI_HOST)).toBeDefined();
    expect(registry.limiterFor(EBI_HOST)).not.toBe(
      registry.limiterFor("eutils.ncbi.nlm.nih.gov"),
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Registration — docs/07 §11.1 step 8
// ---------------------------------------------------------------------------

describe("registerSources with the europepmc slot", () => {
  const unreachable = () => {
    throw new Error("not called");
  };
  function stub(id: LiteratureSource["id"]): LiteratureSource {
    return {
      id,
      displayNameKey: `x-${id}`,
      capabilities: EUROPEPMC_CAPABILITIES,
      rateLimitKey: "h",
      isConfigured: () => true,
      healthCheck: unreachable,
      search: unreachable,
      searchAll: unreachable,
      explainQuery: unreachable,
    };
  }

  it("registers europepmc after pubmed, in SOURCE_IDS order, whatever the literal's key order", () => {
    const registry = createSourceRegistry();
    const europepmc = stub("europepmc");
    const pubmed = stub("pubmed");
    registerSources(registry, { europepmc, pubmed });
    expect(registry.list()).toEqual([pubmed, europepmc]);
    expect(registry.get("europepmc")).toBe(europepmc);
    expect(SOURCE_IDS.indexOf("pubmed")).toBeLessThan(
      SOURCE_IDS.indexOf("europepmc"),
    );
  });

  it("still registers pubmed alone when the slot is absent, and rejects a mis-wired adapter", () => {
    const registry = createSourceRegistry();
    registerSources(registry, { pubmed: stub("pubmed") });
    expect(registry.get("europepmc")).toBeUndefined();
    expect(() =>
      registerSources(createSourceRegistry(), {
        pubmed: stub("pubmed"),
        europepmc: stub("crossref"),
      }),
    ).toThrow(/supplied as "europepmc" reports id "crossref"/u);
  });

  it("registers the real adapter under its own id", () => {
    const registry = createSourceRegistry();
    const real = createSource(createStubHttp(() => response("", "")).client);
    registerSources(registry, { pubmed: stub("pubmed"), europepmc: real });
    expect(registry.get("europepmc")).toBe(real);
    expect(registry.listConfigured()).toContain(real);
  });
});
