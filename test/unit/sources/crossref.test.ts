import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerSources } from "../../../src/bootstrap/registerSources";
import { createManualClock } from "../../../src/core/clock";
import {
  BadRequestError,
  OperationCancelledError,
  ParseError,
  RateLimitError,
  SourceError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
  type HttpMethod,
  type HttpOptions,
  type HttpResponse,
  type RateLimiterPort,
} from "../../../src/core/http/client";
import {
  buildUserAgent,
  crossrefContactParams,
  MAINTAINER_EMAIL,
} from "../../../src/core/http/userAgent";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import {
  adoptHeaderDrivenLimits,
  createHostLimiterRegistry,
  CROSSREF_HOST,
  EBI_HOST,
  HOST_POLICIES,
} from "../../../src/core/rateLimit/hostLimiter";
import type { RateLimiterConfig } from "../../../src/core/rateLimit/tokenBucket";
import { SOURCE_IDS } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  applyNotFilter,
  clampRows,
  containsTerm,
  createCrossrefSource,
  CROSSREF_ABSTRACT_COVERAGE_NOTE,
  CROSSREF_APPROXIMATE_PREFIX,
  CROSSREF_CAPABILITIES,
  CROSSREF_DISPLAY_NAME_KEY,
  CROSSREF_SOURCE_ID,
  lossinessWarnings,
  nextCursorAfter,
  parseCrossrefWorksBody,
  type CrossrefSourceDeps,
} from "../../../src/sources/crossref/crossrefSource";
import {
  createCrossrefRecordMapper,
  CROSSREF_MAPPABLE_FIELDS,
  flattenTitle,
  jatsToText,
  readDateParts,
  xmlSafeEntities,
  type XmlDocumentLike,
  type XmlNodeLike,
  type XmlNodeListLike,
} from "../../../src/sources/crossref/mapper";
import {
  buildCrossrefWorksRequest,
  CROSSREF_FIRST_CURSOR,
  CROSSREF_ORDER,
  CROSSREF_FILTERS,
  CROSSREF_QUERY_FILTER_SUPPORT,
  CROSSREF_RENDERED_FIELDS,
  CROSSREF_ROWS_MAX,
  CROSSREF_SELECT_FIELDS,
  CROSSREF_SORT,
  CROSSREF_WORKS_URL,
  explainCrossrefQuery,
  renderCrossrefQuery,
  renderFilter,
  RESERVED_RAW_PARAMS,
} from "../../../src/sources/crossref/query";
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
  createReplayTransport,
  fixtureKey,
  listFixtureMeta,
  META_SUFFIX,
  type RecordedExchange,
} from "../../contract/_transport";
import {
  assertClean,
  planFor,
  plannedRequest,
  RECORDABLE_SOURCES,
  redactExchange,
} from "../../../scripts/record-fixtures";
import {
  CROSSREF_DOI_RICH,
  CROSSREF_QUERY_DOI_STRING as QUERY_DOI_STRING,
  CROSSREF_QUERY_EMPTY as QUERY_EMPTY,
  CROSSREF_QUERY_JATS as QUERY_JATS,
  CROSSREF_QUERY_PAGINATED as QUERY_PAGINATED,
  CROSSREF_QUERY_PAIR as QUERY_PAIR,
  CROSSREF_QUERY_PREPRINT as QUERY_PREPRINT,
  CROSSREF_QUERY_RICH as QUERY_RICH,
  CROSSREF_QUERY_SPARSE as QUERY_SPARSE,
  CROSSREF_QUERY_SYNTHETIC_400 as QUERY_SYNTHETIC_400,
  CROSSREF_QUERY_SYNTHETIC_429 as QUERY_SYNTHETIC_429,
  CROSSREF_QUERY_SYNTHETIC_500 as QUERY_SYNTHETIC_500,
  CROSSREF_QUERY_SYNTHETIC_MALFORMED as QUERY_SYNTHETIC_MALFORMED,
  CROSSREF_QUERY_TYPICAL as QUERY_TYPICAL,
  CROSSREF_QUERY_UNICODE as QUERY_UNICODE,
  CROSSREF_TITLE_PREPRINT as T_PREPRINT,
  CROSSREF_TITLE_RICH as T_RICH,
  recordedCrossrefRequest,
} from "../../support/crossrefRecordedRequests";
import { DEDUP_CORPUS_SEARCHES } from "../../support/dedupCorpusRecordedRequests";

/** `P2-T13` Part B's corpus searches, recorded beside the `docs/13` inventory. */
const CORPUS_FIXTURES = DEDUP_CORPUS_SEARCHES.crossref.length;

/**
 * `P2-T04`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network**.
 * Two kinds of test share this file, and the card's `Verify with`
 * (`npm run test:unit -- crossref`) runs both:
 *
 * - **Pure**: the renderer against `docs/02` §12.2 / §12.3's Crossref column,
 *   the JATS walk over a Node XML stand-in, the date-parts reader, the response
 *   validator, the paging rule, the client-side `NOT` filter, the lossiness
 *   notices, the capabilities, the `api.crossref.org` policy row read back from
 *   `docs/07` §7.3, the header-driven reconfiguration, and `registerSources`
 *   with the new slot.
 * - **Replayed**: the shipped `createCrossrefSource` over the shipped
 *   `createHttpClient`, answering from `test/fixtures/crossref/` — recorded live
 *   on 2026-10-15 (12 requests; 4 written). A missing fixture is an error
 *   naming the record command, never a network call. The queries are
 *   `test/support/crossrefRecordedRequests.ts`'s, the recorder's own.
 *
 * **Why this file ships its own XML parser.** Node has no `DOMParser` and the
 * sandbox does (`docs/01` §2.3), so the mapper takes the parse as a port and
 * {@link parseXmlInNode} is the Node implementation — including Gecko's two
 * behaviours the JATS walk depends on: a parse failure is a `<parsererror>`
 * document, not an exception, and an **undeclared namespace prefix is a parse
 * failure**, which is what makes the wrapper's declarations load-bearing.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/crossref",
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

/** `docs/02` §12.2's worked example, as the user types it. */
const EXAMPLE_INPUT =
  '("base editing" OR "prime editing") AND title:CRISPR NOT mouse';
const EXAMPLE_WINDOW = {
  fromDate: "2024-01-01",
  toDate: "2026-12-31",
} as const;

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

/** The polite-pool headers `docs/02` §5.1 measured, as every recorded page carries them. */
const POLITE_HEADERS = {
  "x-api-pool": "polite-array",
  "x-rate-limit-limit": "3",
  "x-rate-limit-interval": "1s",
  "x-concurrency-limit": "3",
} as const;

function response(
  url: string,
  body: string,
  status = 200,
  headers: Readonly<Record<string, string>> = POLITE_HEADERS,
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

/** A `/works` body with the parts a test varies. */
function worksBody(
  items: readonly unknown[],
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    status: "ok",
    "message-type": "work-list",
    "message-version": "1.0.0",
    message: {
      facets: {},
      "total-results": items.length,
      items,
      "items-per-page": items.length,
      query: { "start-index": 0, "search-terms": null },
      ...extra,
    },
  });
}

/** A minimal work item. */
function item(
  doi: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    DOI: doi,
    type: "journal-article",
    title: [`Paper ${doi}`],
    "container-title": ["Journal of Tests"],
    ISSN: ["1234-5678"],
    issued: { "date-parts": [[2023, 5, 31]] },
    ...extra,
  };
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

/** A limiter that paces nothing and records what it was reconfigured to. */
interface FakeLimiter extends RateLimiterPort {
  readonly applied: RateLimiterConfig[];
  readonly penalties: { untilEpochMs: number; reason: string }[];
  currentConfig: RateLimiterConfig;
  reconfigure(config: RateLimiterConfig): void;
}

function fakeLimiter(current: RateLimiterConfig): FakeLimiter {
  const applied: RateLimiterConfig[] = [];
  const penalties: { untilEpochMs: number; reason: string }[] = [];
  const limiter: FakeLimiter = {
    key: CROSSREF_HOST,
    applied,
    penalties,
    currentConfig: current,
    acquire: () => Promise.resolve(),
    run: (fn) => fn(),
    penalize(untilEpochMs, reason) {
      penalties.push({ untilEpochMs, reason });
    },
    reconfigure(next) {
      applied.push(next);
      limiter.currentConfig = next;
    },
  };
  return limiter;
}

/** §7.3's Crossref starting point. */
const CROSSREF_START: RateLimiterConfig = {
  ratePerSecond: 2,
  burst: 2,
  maxConcurrent: 3,
};

// ---------------------------------------------------------------------------
// A minimal, namespace-aware XML parser, for Node only
// ---------------------------------------------------------------------------

const XML_NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gu,
    (_m, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      const named = XML_NAMED[body];
      if (named === undefined) throw new Error(`undeclared entity &${body};`);
      return named;
    },
  );
}

class TestNode implements XmlNodeLike {
  readonly nodes: TestNode[] = [];
  constructor(
    readonly nodeType: number,
    readonly localName: string | null,
    readonly nodeValue: string | null,
    readonly attrs: ReadonlyMap<string, string> = new Map(),
  ) {}
  get childNodes(): XmlNodeListLike {
    return { length: this.nodes.length, item: (i) => this.nodes[i] ?? null };
  }
  /** Append a text child; the error document carries its message this way. */
  withText(text: string): TestNode {
    this.nodes.push(new TestNode(3, null, text));
    return this;
  }
}

/** Mimic Gecko: a parse failure is a document, not an exception. */
function parserError(message: string): XmlDocumentLike {
  return {
    documentElement: new TestNode(1, "parsererror", null).withText(message),
  };
}

/**
 * Parse XML well enough for a JATS fragment under the mapper's wrapper:
 * elements, attributes, self-closing tags, comments, CDATA, character
 * references, mixed content — and **namespace prefixes**, which must be
 * declared in scope by an `xmlns:` attribute or the document is a
 * `<parsererror>`, as Gecko reports it. Anything else malformed is a
 * `<parsererror>` too.
 */
export function parseXmlInNode(xml: string): XmlDocumentLike {
  const stack: { node: TestNode; prefixes: Set<string> }[] = [];
  let root: TestNode | null = null;
  let i = 0;
  const declared = (prefix: string): boolean =>
    prefix === "xml" || stack.some((s) => s.prefixes.has(prefix));
  const append = (node: TestNode): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      if (root !== null) throw new Error("content after the root element");
      root = node;
    } else {
      top.node.nodes.push(node);
    }
  };
  try {
    while (i < xml.length) {
      if (xml.startsWith("<!--", i)) {
        const end = xml.indexOf("-->", i);
        if (end === -1) throw new Error("unterminated comment");
        i = end + 3;
        continue;
      }
      if (xml.startsWith("<![CDATA[", i)) {
        const end = xml.indexOf("]]>", i);
        if (end === -1) throw new Error("unterminated CDATA");
        append(new TestNode(4, null, xml.slice(i + 9, end)));
        i = end + 3;
        continue;
      }
      if (xml.startsWith("<?", i)) {
        const end = xml.indexOf("?>", i);
        if (end === -1) throw new Error("unterminated declaration");
        i = end + 2;
        continue;
      }
      if (xml.startsWith("</", i)) {
        const end = xml.indexOf(">", i);
        if (end === -1) throw new Error("unterminated end tag");
        const name = xml.slice(i + 2, end).trim();
        const top = stack.pop();
        if (top === undefined || top.node.attrs.get("\u0000qname") !== name) {
          throw new Error(`mismatched end tag </${name}>`);
        }
        i = end + 1;
        continue;
      }
      if (xml[i] === "<") {
        const end = xml.indexOf(">", i);
        if (end === -1) throw new Error("unterminated start tag");
        let tag = xml.slice(i + 1, end);
        const selfClosing = tag.endsWith("/");
        if (selfClosing) tag = tag.slice(0, -1);
        const match = /^([A-Za-z_][\w.:-]*)([\s\S]*)$/u.exec(tag.trim());
        if (match === null) throw new Error(`bad tag <${tag}>`);
        const qname = match[1] ?? "";
        const attrs = new Map<string, string>([["\u0000qname", qname]]);
        const prefixes = new Set<string>();
        const attrRe = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/gu;
        for (const a of (match[2] ?? "").matchAll(attrRe)) {
          const aname = a[1] ?? "";
          const avalue = decode(a[3] ?? a[4] ?? "");
          if (aname === "xmlns") prefixes.add("");
          else if (aname.startsWith("xmlns:")) prefixes.add(aname.slice(6));
          attrs.set(aname, avalue);
        }
        const [prefix, local] = qname.includes(":")
          ? qname.split(":", 2)
          : [undefined, qname];
        const node = new TestNode(1, local ?? qname, null, attrs);
        stack.push({ node, prefixes });
        if (prefix !== undefined && !declared(prefix)) {
          throw new Error(`undeclared prefix ${prefix}`);
        }
        for (const aname of attrs.keys()) {
          if (aname.startsWith("\u0000") || aname.startsWith("xmlns")) continue;
          const colon = aname.indexOf(":");
          if (colon > 0 && !declared(aname.slice(0, colon))) {
            throw new Error(`undeclared attribute prefix in ${aname}`);
          }
        }
        stack.pop();
        append(node);
        if (!selfClosing) stack.push({ node, prefixes });
        i = end + 1;
        continue;
      }
      const next = xml.indexOf("<", i);
      const textEnd = next === -1 ? xml.length : next;
      const text = decode(xml.slice(i, textEnd));
      if (stack.length === 0 && text.trim() !== "") {
        throw new Error("text outside the root element");
      }
      if (stack.length > 0) append(new TestNode(3, null, text));
      i = textEnd;
    }
    if (stack.length > 0) throw new Error("unclosed element");
    if (root === null) throw new Error("no root element");
    return { documentElement: root };
  } catch (error) {
    return parserError(error instanceof Error ? error.message : String(error));
  }
}

function mapper(overrides: { keepRaw?: boolean; logger?: Logger } = {}) {
  return createCrossrefRecordMapper({
    clock: createManualClock(NOW),
    parseXml: parseXmlInNode,
    ...overrides,
  });
}

function createSource(
  client: HttpClient,
  overrides: Partial<CrossrefSourceDeps> = {},
) {
  const clock = createManualClock(NOW);
  return createCrossrefSource({
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

/** The recorded `message.items` of one scenario. */
async function recordedItems(scenario: string): Promise<readonly unknown[]> {
  const exchange = await recordedExchange(scenario);
  const body = JSON.parse(exchange.body) as {
    message: { items: unknown[] };
  };
  return body.message.items;
}

function byDoi(records: readonly SourceRecord[], doi: string): SourceRecord {
  const found = records.find((r) => r.nativeId === doi);
  if (found === undefined) throw new Error(`no record ${doi}`);
  return found;
}

// ---------------------------------------------------------------------------
// 1. The renderer — docs/02 §12.2's Crossref block and §12.3's column
// ---------------------------------------------------------------------------

describe("renderCrossrefQuery — docs/02 §12.2's bag of words", () => {
  it("renders §12.2's example as the document's own three parameters, with NOT dropped", () => {
    const rendered = renderCrossrefQuery(parseUserQuery(EXAMPLE_INPUT));
    expect(rendered.bibliographic).toBe("base editing prime editing CRISPR");
    expect(rendered.title).toBe("CRISPR");
    expect(rendered.author).toBe("");
    expect(rendered.excluded).toEqual([{ value: "mouse", field: undefined }]);
  });

  it("promotes author: into query.author and keeps it in the bag", () => {
    const rendered = renderCrossrefQuery(
      and(term("Doudna", "author"), term("CRISPR")),
    );
    expect(rendered.author).toBe("Doudna");
    expect(rendered.bibliographic).toBe("Doudna CRISPR");
  });

  it("drops phrase quotes and flattens OR groups: §12.3's Phrase and OR cells are n/a", () => {
    const rendered = renderCrossrefQuery(
      or(
        term('"base editing"', undefined, true),
        term("prime editing", undefined, true),
      ),
    );
    expect(rendered.bibliographic).toBe("base editing prime editing");
    expect(rendered.bibliographic).not.toContain('"');
  });

  it("renders a field with no Crossref parameter into the bag only", () => {
    const rendered = renderCrossrefQuery(
      and(
        term("Nature", "journal"),
        term("neurons", "abstract"),
        term("x", "any"),
      ),
    );
    expect(rendered).toEqual({
      bibliographic: "Nature neurons x",
      title: "",
      author: "",
      excluded: [],
    });
  });

  it("flips polarity through nested NOTs and excludes every term under NOT (a OR b)", () => {
    const rendered = renderCrossrefQuery(
      and(not(not(term("kept"))), not(or(term("rat"), term("mouse", "title")))),
    );
    expect(rendered.bibliographic).toBe("kept");
    expect(rendered.excluded).toEqual([
      { value: "rat", field: undefined },
      { value: "mouse", field: "title" },
    ]);
  });

  it("yields three empty strings for a tree with no renderable term", () => {
    expect(renderCrossrefQuery(and(term("   "), term('"')))).toEqual({
      bibliographic: "",
      title: "",
      author: "",
      excluded: [],
    });
  });
});

describe("explainCrossrefQuery — the native rendering and the date filter", () => {
  it("writes §12.2's example as its parameter list, window and created-date filter included", () => {
    expect(
      explainCrossrefQuery({
        terms: parseUserQuery(EXAMPLE_INPUT),
        ...EXAMPLE_WINDOW,
        limit: 20,
      }),
    ).toBe(
      "query.bibliographic=base editing prime editing CRISPR" +
        "&query.title=CRISPR" +
        "&filter=from-pub-date:2024-01-01,until-pub-date:2026-12-31,from-created-date:2024-01-01",
    );
  });

  it("omits the filter when the user asked for all years", () => {
    expect(explainCrossrefQuery({ terms: term("CRISPR"), limit: 5 })).toBe(
      "query.bibliographic=CRISPR",
    );
    expect(renderFilter({ terms: term("x"), limit: 1 })).toBeUndefined();
  });

  it("passes a YYYY or YYYY-MM bound at its own precision (docs/02 §5.2 accepts all three)", () => {
    expect(
      renderFilter({
        terms: term("x"),
        fromDate: "2024",
        toDate: "2026-06",
        limit: 1,
      }),
    ).toBe("from-pub-date:2024,until-pub-date:2026-06,from-created-date:2024");
  });

  it("refuses a half-open window and a malformed bound", () => {
    expect(() =>
      explainCrossrefQuery({
        terms: term("x"),
        fromDate: "2024-01-01",
        limit: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      explainCrossrefQuery({
        terms: term("x"),
        fromDate: "2024/01/01",
        toDate: "2026-12-31",
        limit: 1,
      }),
    ).toThrow(/YYYY, YYYY-MM or YYYY-MM-DD/u);
  });

  it("refuses languages and openAccessOnly by name, and accepts their empty forms", () => {
    // `P2-T34`: the two answers live on `SourceCapabilities.filters` now.
    expect(CROSSREF_FILTERS).toEqual({ languages: false, openAccess: false });
    expect(CROSSREF_QUERY_FILTER_SUPPORT).toEqual({ raw: true });
    expect(() =>
      explainCrossrefQuery({ terms: term("x"), languages: ["en"], limit: 1 }),
    ).toThrow(/SourceQuery\.languages/u);
    expect(() =>
      explainCrossrefQuery({
        terms: term("x"),
        openAccessOnly: true,
        limit: 1,
      }),
    ).toThrow(/SourceQuery\.openAccessOnly/u);
    expect(
      explainCrossrefQuery({
        terms: term("x"),
        languages: [],
        openAccessOnly: false,
        limit: 1,
      }),
    ).toBe("query.bibliographic=x");
  });
});

// ---------------------------------------------------------------------------
// 2. The request — parameters, politeness, select, cursor, raw
// ---------------------------------------------------------------------------

describe("buildCrossrefWorksRequest", () => {
  const example: SourceQuery = {
    terms: parseUserQuery(EXAMPLE_INPUT),
    ...EXAMPLE_WINDOW,
    limit: 20,
  };

  it("sends no AND/OR/NOT token in any query.* parameter for §12.2's example (criterion 1)", () => {
    const request = buildCrossrefWorksRequest({ query: example, rows: 20 });
    const params = new URLSearchParams(request.queryString);
    const queryParams = [...params.entries()].filter(([k]) =>
      k.startsWith("query."),
    );
    expect(queryParams.map(([k]) => k)).toEqual([
      "query.bibliographic",
      "query.title",
    ]);
    for (const [, value] of queryParams) {
      expect(value).not.toMatch(/\b(AND|OR|NOT)\b/u);
    }
    expect(params.get("query.bibliographic")).toBe(
      "base editing prime editing CRISPR",
    );
    expect(params.get("query.title")).toBe("CRISPR");
    expect(params.get("filter")).toBe(
      "from-pub-date:2024-01-01,until-pub-date:2026-12-31,from-created-date:2024-01-01",
    );
    expect(request.excluded).toEqual([{ value: "mouse", field: undefined }]);
  });

  it("emits the parameters in the fixed order the fixture key depends on", () => {
    const request = buildCrossrefWorksRequest({ query: example, rows: 20 });
    expect([...new URLSearchParams(request.queryString).keys()]).toEqual([
      "query.bibliographic",
      "query.title",
      "filter",
      "sort",
      "order",
      "select",
      "rows",
      "cursor",
      "mailto",
    ]);
    expect(request.method).toBe("GET");
    expect(request.url.startsWith(`${CROSSREF_WORKS_URL}?`)).toBe(true);
    expect(new URL(request.url).host).toBe(CROSSREF_HOST);
    expect(request.endpointBaseUrl).toBe(CROSSREF_WORKS_URL);
  });

  it("always sorts by score, descending — a cursor without a sort returns index order (measured)", () => {
    const params = new URLSearchParams(
      buildCrossrefWorksRequest({ query: example, rows: 20 }).queryString,
    );
    expect(params.get("sort")).toBe("score");
    expect(params.get("order")).toBe("desc");
    expect(CROSSREF_SORT).toBe("score");
    expect(CROSSREF_ORDER).toBe("desc");
  });

  it("never omits select, and the whitelist covers every field the mapper reads (docs/02 §5.2, §10.2)", () => {
    const params = new URLSearchParams(
      buildCrossrefWorksRequest({ query: example, rows: 20 }).queryString,
    );
    expect(params.get("select")).toBe(CROSSREF_SELECT_FIELDS.join(","));
    for (const field of [
      "DOI",
      "URL",
      "type",
      "title",
      "abstract",
      "author",
      "issued",
      "published-online",
      "published-print",
      "container-title",
      "short-container-title",
      "ISSN",
      "publisher",
      "volume",
      "issue",
      "page",
      "subject",
      "is-referenced-by-count",
      "references-count",
      "link",
      "license",
      "relation",
    ]) {
      expect(CROSSREF_SELECT_FIELDS).toContain(field);
    }
    // The three names /works rejected live on 2026-10-14 are not sent.
    for (const rejected of ["reference-count", "institution", "language"]) {
      expect(CROSSREF_SELECT_FIELDS).not.toContain(rejected);
    }
    expect(
      new URLSearchParams(
        buildCrossrefWorksRequest({ query: example, rows: 1, select: ["DOI"] })
          .queryString,
      ).get("select"),
    ).toBe("DOI");
  });

  it("sends the maintainer address as mailto when no user address is set, the user's otherwise (D10)", () => {
    const plain = buildCrossrefWorksRequest({ query: example, rows: 20 });
    expect(plain.mailto).toBe(MAINTAINER_EMAIL);
    expect(new URLSearchParams(plain.queryString).get("mailto")).toBe(
      MAINTAINER_EMAIL,
    );
    const user = buildCrossrefWorksRequest({
      query: example,
      rows: 20,
      userContactEmail: "  reader@example.org ",
    });
    expect(user.mailto).toBe("reader@example.org");
    expect(new URLSearchParams(user.queryString).get("mailto")).toBe(
      "reader@example.org",
    );
    expect(user.url).not.toContain(MAINTAINER_EMAIL);
    // The mailto is a contact address, not a credential: the stored URL keeps it.
    expect(user.transmittedUrl).toBe(user.url);
    expect(plain.transmittedUrl).toBe(plain.url);
  });

  it("treats a blank or malformed contact preference as unset", () => {
    for (const bad of [
      undefined,
      "",
      "   ",
      "not-an-address",
      "two words@x.org",
    ]) {
      expect(crossrefContactParams(bad)).toEqual({ mailto: MAINTAINER_EMAIL });
    }
    expect(crossrefContactParams("a@b.org")).toEqual({ mailto: "a@b.org" });
  });

  it("starts at cursor=* and forwards a given cursor verbatim", () => {
    expect(CROSSREF_FIRST_CURSOR).toBe("*");
    expect(
      new URLSearchParams(
        buildCrossrefWorksRequest({ query: example, rows: 20 }).queryString,
      ).get("cursor"),
    ).toBe("*");
    expect(
      new URLSearchParams(
        buildCrossrefWorksRequest({
          query: example,
          rows: 20,
          cursor: "DnF1ZXJ5VGhlbkZldGNo+/=",
        }).queryString,
      ).get("cursor"),
    ).toBe("DnF1ZXJ5VGhlbkZldGNo+/=");
  });

  it("refuses rows outside 1 … 1000", () => {
    for (const rows of [0, 1001, 2.5, Number.NaN]) {
      expect(() => buildCrossrefWorksRequest({ query: example, rows })).toThrow(
        /rows must be an integer in 1 … 1000/u,
      );
    }
    expect(CROSSREF_ROWS_MAX).toBe(1000);
  });

  it("appends raw pairs sorted by key, before mailto, and refuses every reserved name", () => {
    const request = buildCrossrefWorksRequest({
      query: { ...example, raw: { "filter-extra": "x", "a b": "c&d" } },
      rows: 20,
    });
    const keys = [...new URLSearchParams(request.queryString).keys()];
    expect(keys.slice(-3)).toEqual(["a b", "filter-extra", "mailto"]);
    expect(request.queryString).toContain("a%20b=c%26d");
    for (const reserved of [
      "query.bibliographic",
      "query.title",
      "query.author",
      "filter",
      "sort",
      "order",
      "select",
      "rows",
      "cursor",
      "mailto",
      "query",
      "offset",
      "sample",
    ]) {
      expect(RESERVED_RAW_PARAMS.has(reserved)).toBe(true);
      expect(() =>
        buildCrossrefWorksRequest({
          query: { ...example, raw: { [reserved]: "1" } },
          rows: 20,
        }),
      ).toThrow(/is reserved on Crossref/u);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Capabilities — docs/02 §12.3's column, and what normalizeForSource reports
// ---------------------------------------------------------------------------

describe("CROSSREF_CAPABILITIES", () => {
  it("declares §12.3's Crossref column: OR, NOT and Phrase n/a; title and author real", () => {
    expect(CROSSREF_CAPABILITIES).toEqual({
      keywordSearch: true,
      query: {
        or: false,
        not: false,
        phrase: false,
        fields: ["title", "author"],
      },
      relatedByWork: false,
      lookupById: [],
      abstractsInSearch: true,
      citationGraph: false,
      dateFilter: true,
      filters: { languages: false, openAccess: false },
      maxPageSize: 1000,
      maxTotalResults: undefined,
      benefitsFromApiKey: false,
    });
    expect(CROSSREF_CAPABILITIES.query.fields).toBe(CROSSREF_RENDERED_FIELDS);
    expect(CROSSREF_ABSTRACT_COVERAGE_NOTE).toMatch(/deposited/u);
  });

  it("makes normalizeForSource report the OR group, both phrases and the NOT of §12.2's example", () => {
    const lost = normalizeForSource(
      parseUserQuery(EXAMPLE_INPUT),
      CROSSREF_CAPABILITIES,
    );
    expect(lost.map((n) => n.kind)).toEqual(["or", "term", "term", "not"]);
    expect(
      lost
        .filter((n) => n.kind === "term")
        .map((n) => n.kind === "term" && n.value),
    ).toEqual(["base editing", "prime editing"]);
  });

  it("reports a field with no Crossref parameter and nothing for a faithfully rendered query", () => {
    expect(
      normalizeForSource(
        parseUserQuery("journal:Nature CRISPR"),
        CROSSREF_CAPABILITIES,
      ),
    ).toHaveLength(1);
    expect(
      normalizeForSource(
        parseUserQuery("title:CRISPR author:Doudna editing"),
        CROSSREF_CAPABILITIES,
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. The lossiness notices and the client-side NOT filter
// ---------------------------------------------------------------------------

describe("lossinessWarnings and applyNotFilter", () => {
  it("raises no warning for a query Crossref renders faithfully", () => {
    expect(
      lossinessWarnings(
        parseUserQuery("title:CRISPR author:Doudna editing"),
        [],
      ),
    ).toEqual([]);
  });

  it("names the OR group, the phrases and the dropped NOT term for §12.2's example", () => {
    const tree = parseUserQuery(EXAMPLE_INPUT);
    const { excluded } = renderCrossrefQuery(tree);
    const warnings = lossinessWarnings(tree, excluded);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(CROSSREF_APPROXIMATE_PREFIX);
    expect(warnings[0]).toMatch(/1 OR group was flattened/u);
    expect(warnings[0]).toMatch(
      /2 quoted phrases were searched as separate words/u,
    );
    expect(warnings[1]).toMatch(/no NOT operator/u);
    expect(warnings[1]).toContain('"mouse"');
    expect(warnings[1]).toMatch(/filtered out client-side/u);
  });

  it("names a field that has no Crossref parameter", () => {
    const warnings = lossinessWarnings(parseUserQuery("journal:Nature"), []);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/journal: has no Crossref parameter/u);
  });

  it("matches whole words, case-insensitively, and multi-word terms as phrases", () => {
    expect(containsTerm("A mouse model", "mouse")).toBe(true);
    expect(containsTerm("A Mouse model", "MOUSE")).toBe(true);
    expect(containsTerm("the mouseover event", "mouse")).toBe(false);
    expect(containsTerm("(mouse)", "mouse")).toBe(true);
    expect(containsTerm("base\n  editing", "base editing")).toBe(true);
    expect(containsTerm("base editor", "base editing")).toBe(false);
    expect(containsTerm("anything", "   ")).toBe(false);
  });

  it("removes a record where the excluded term occurs in the field the user named", () => {
    const records = mapper()([
      item("10.1234/mouse-title", { title: ["Base editing in mouse"] }),
      item("10.1234/mouse-abstract", {
        title: ["Base editing in humans"],
        abstract: "<jats:p>A mouse model was used.</jats:p>",
      }),
      item("10.1234/clean", { title: ["Base editing in cells"] }),
    ]);
    const unfielded = applyNotFilter(records, [
      { value: "mouse", field: undefined },
    ]);
    expect(unfielded.kept.map((r) => r.nativeId)).toEqual(["10.1234/clean"]);
    expect(unfielded.removed).toBe(2);
    const titleOnly = applyNotFilter(records, [
      { value: "mouse", field: "title" },
    ]);
    expect(titleOnly.kept.map((r) => r.nativeId)).toEqual([
      "10.1234/mouse-abstract",
      "10.1234/clean",
    ]);
    expect(applyNotFilter(records, []).kept).toBe(records);
  });
});

// ---------------------------------------------------------------------------
// 5. The api.crossref.org row — docs/07 §7.3, read back from the document
// ---------------------------------------------------------------------------

describe("hostLimiter: the api.crossref.org row", () => {
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

  it("is header-driven, starts at 2/interval, burst 2, 3 concurrent, exactly as §7.3 writes it", () => {
    expect(CROSSREF_HOST).toBe("api.crossref.org");
    const row = section73Row(CROSSREF_HOST);
    expect(row["Rate"]).toMatch(/header-driven/u);
    expect(row["Rate"]).toMatch(/start at 2\/interval/u);
    expect(row["Burst"]).toBe("2");
    expect(row["Max concurrent"]).toBe("3");
    const policy = HOST_POLICIES.find((p) => p.host === CROSSREF_HOST);
    expect(policy).toBeDefined();
    expect(policy?.withoutKey).toEqual({
      ratePerSecond: 2,
      burst: Number(row["Burst"]),
      maxConcurrent: Number(row["Max concurrent"]),
    });
    expect(policy?.headerDriven).toBe(true);
    expect(policy?.withKey).toBeUndefined();
    expect(policy?.keyPresencePref).toBeUndefined();
    // No other row is header-driven: the flag is this host's.
    expect(
      HOST_POLICIES.filter((p) => p.headerDriven === true).map((p) => p.host),
    ).toEqual([CROSSREF_HOST]);
  });

  it("carries the retry budget §7.3's three cells state, read from the document", () => {
    const row = section73Row(CROSSREF_HOST);
    const ms = (cell: string | undefined): number =>
      Number((cell ?? "").replace(/\s/g, "").replace("ms", ""));
    const retry = HOST_POLICIES.find((p) => p.host === CROSSREF_HOST)?.retry;
    expect(retry).toEqual({
      baseMs: ms(row["Retry base"]),
      capMs: ms(row["Retry cap"]),
      maxAttempts: Number(row["Attempt cap"]),
    });
    expect(retry).toEqual({ baseMs: 1000, capMs: 30_000, maxAttempts: 3 });
  });

  it("is served by the registry as its own bucket, third in table order", () => {
    const registry = createHostLimiterRegistry({
      clock: createManualClock(NOW),
    });
    // Until 2026-10-15 this pinned the whole host list to three; P2-T06's
    // arXiv row made it stale. tokenBucket.test.ts owns the full shipped-host
    // list; here only this row's place after Europe PMC is asserted.
    expect(registry.hosts).toContain(CROSSREF_HOST);
    expect(registry.hosts.indexOf(CROSSREF_HOST)).toBeGreaterThan(
      registry.hosts.indexOf(EBI_HOST),
    );
    expect(registry.limiterFor(CROSSREF_HOST)).toBeDefined();
    expect(registry.limiterFor(CROSSREF_HOST)).not.toBe(
      registry.limiterFor(EBI_HOST),
    );
  });
});

describe("adoptHeaderDrivenLimits — both directions, for the header-driven row", () => {
  const header = (h: Record<string, string>) => (name: string) =>
    new Map(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v])).get(
      name.toLowerCase(),
    );

  it("raises the static 2/s to the polite pool's advertised 3/s and keeps the burst (criterion 4)", () => {
    const limiter = fakeLimiter(CROSSREF_START);
    const adopted = adoptHeaderDrivenLimits(limiter, header(POLITE_HEADERS));
    expect(adopted).toEqual({ ratePerSecond: 3, burst: 2, maxConcurrent: 3 });
    expect(limiter.applied).toEqual([adopted]);
  });

  it("lowers to the public pool's 1/s and 1 concurrent", () => {
    const limiter = fakeLimiter({
      ratePerSecond: 3,
      burst: 2,
      maxConcurrent: 3,
    });
    expect(
      adoptHeaderDrivenLimits(
        limiter,
        header({
          "x-rate-limit-limit": "1",
          "x-rate-limit-interval": "1s",
          "x-concurrency-limit": "1",
        }),
      ),
    ).toEqual({ ratePerSecond: 1, burst: 2, maxConcurrent: 1 });
  });

  it("divides by a longer interval and makes no call when nothing changed or nothing was said", () => {
    const limiter = fakeLimiter(CROSSREF_START);
    // 6 per 3 s is the 2/s already in force: no call.
    expect(
      adoptHeaderDrivenLimits(
        limiter,
        header({ "x-rate-limit-limit": "6", "x-rate-limit-interval": "3s" }),
      ),
    ).toBeUndefined();
    expect(limiter.applied).toEqual([]);
    // 9 per 3 s is 3/s: adopted, and the interval was divided, not assumed.
    expect(
      adoptHeaderDrivenLimits(
        limiter,
        header({ "x-rate-limit-limit": "9", "x-rate-limit-interval": "3s" }),
      ),
    ).toEqual({
      ratePerSecond: 3,
      burst: 2,
      maxConcurrent: 3,
    } satisfies RateLimiterConfig);
    expect(limiter.applied).toHaveLength(1);
    limiter.applied.length = 0;
    limiter.currentConfig = CROSSREF_START;
    expect(adoptHeaderDrivenLimits(limiter, header({}))).toBeUndefined();
    expect(
      adoptHeaderDrivenLimits(
        limiter,
        header({
          "x-rate-limit-limit": "3",
          "x-rate-limit-interval": "1 minute",
        }),
      ),
    ).toBeUndefined();
    expect(limiter.applied).toEqual([]);
  });

  it("is a no-op for a limiter that publishes no config or no reconfigure", () => {
    let calls = 0;
    expect(
      adoptHeaderDrivenLimits(
        {
          reconfigure() {
            calls += 1;
          },
        },
        header(POLITE_HEADERS),
      ),
    ).toBeUndefined();
    expect(calls).toBe(0);
    expect(
      adoptHeaderDrivenLimits(
        { currentConfig: CROSSREF_START },
        header(POLITE_HEADERS),
      ),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. The mapper's helpers — titles, JATS, dates
// ---------------------------------------------------------------------------

describe("flattenTitle", () => {
  it("decodes entities, strips flat inline markup and squashes whitespace", () => {
    expect(
      flattenTitle(
        "Effect of <i>Zingiber cassumunar</i> &amp; VO<sub>2</sub>max\n   in adults",
      ),
    ).toBe("Effect of Zingiber cassumunar & VO2max in adults");
    expect(flattenTitle("&#x3b2;-catenin &nbsp; signalling")).toBe(
      "β-catenin   signalling",
    );
    expect(flattenTitle("")).toBe("");
  });
});

describe("xmlSafeEntities", () => {
  it("rewrites HTML-only entities to numeric references, escapes a bare &, and leaves XML's own alone", () => {
    expect(xmlSafeEntities("a&nbsp;b &amp; c & d &#x3b2; &lt;")).toBe(
      "a&#xa0;b &amp; c &amp; d &#x3b2; &lt;",
    );
    expect(xmlSafeEntities("&unknownthing;")).toBe("&unknownthing;");
  });
});

describe("jatsToText — docs/02 §5.4's handling as a DOM walk", () => {
  it("parses the Node stand-in the way Gecko would: a parse failure is a <parsererror> document", () => {
    expect(parseXmlInNode("<a><b></a>").documentElement?.localName).toBe(
      "parsererror",
    );
    expect(parseXmlInNode("<p>&nbsp;</p>").documentElement?.localName).toBe(
      "parsererror",
    );
    expect(
      parseXmlInNode("<jats:p>x</jats:p>").documentElement?.localName,
    ).toBe("parsererror");
    expect(
      parseXmlInNode('<r xmlns:jats="urn:x"><jats:p>x</jats:p></r>')
        .documentElement?.localName,
    ).toBe("r");
  });

  it("unwraps the boxed-text example of §5.4 into paragraphs with no residual markup (criterion 2)", async () => {
    const items = (await recordedItems("record-jats-abstract")) as {
      DOI: string;
      abstract: string;
    }[];
    const sage = items.find((i) => i.DOI === "10.1177/15357597261460897");
    if (sage === undefined)
      throw new Error("the Sage record is not in the fixture");
    expect(sage.abstract).toContain("<jats:boxed-text");
    const text = jatsToText(sage.abstract, parseXmlInNode);
    expect(text).toBeDefined();
    const paragraphs = (text ?? "").split("\n\n");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toBe(
      "Base Editing Rescues Seizures and Sudden Death in a SCN8A Mutation-associated Developmental Epileptic Encephalopathy Model",
    );
    expect(paragraphs[1]).toMatch(
      /^Reever CM, .* J Clin Invest \. 2026;136\(3\):e196402/u,
    );
    expect(paragraphs[2]).toMatch(
      /^SCN8A encodes the voltage-gated sodium channel Nav1\.6/u,
    );
    expect(text).not.toMatch(/<jats:|<\/?[a-z]+>/u);
    for (const paragraph of paragraphs) expect(paragraph).not.toContain("\n");
  });

  it("drops a top-level <jats:title>Abstract</jats:title> and keeps a section title as a label", () => {
    expect(
      jatsToText(
        "<jats:title>Abstract</jats:title><jats:p>Body.</jats:p>",
        parseXmlInNode,
      ),
    ).toBe("Body.");
    expect(
      jatsToText(
        "<jats:sec><jats:title>Background</jats:title><jats:p>Plai is a herb.</jats:p></jats:sec>" +
          "<jats:sec><jats:title>Methods</jats:title><jats:p>A trial.</jats:p></jats:sec>" +
          "<jats:sec><jats:title>Abstract</jats:title><jats:p>Decoration label dropped.</jats:p></jats:sec>",
        parseXmlInNode,
      ),
    ).toBe(
      "Background: Plai is a herb.\n\nMethods: A trial.\n\nDecoration label dropped.",
    );
  });

  it("declares whatever prefix the deposit used (F1000's ns3:) and reads bare <p> too (measured)", () => {
    expect(
      jatsToText(
        "<ns3:p><ns3:bold>Background</ns3:bold> Ashwagandha is a herb.</ns3:p><ns3:p>Methods follow.</ns3:p>",
        parseXmlInNode,
      ),
    ).toBe("Background Ashwagandha is a herb.\n\nMethods follow.");
    expect(
      jatsToText("<p>On June 7, 2023, Nature published.</p>", parseXmlInNode),
    ).toBe("On June 7, 2023, Nature published.");
    expect(
      jatsToText(
        '<jats:p><jats:ext-link xlink:href="https://x">x</jats:ext-link> y</jats:p>',
        parseXmlInNode,
      ),
    ).toBe("x y");
  });

  it("decodes entities through the parser, unwraps inline markup and drops list labels", () => {
    expect(
      jatsToText(
        "<jats:p>&#x3b2;-catenin &amp; <jats:italic>Nav1.6</jats:italic>&nbsp;signalling <jats:sup>2</jats:sup></jats:p>" +
          "<jats:list><jats:list-item><jats:label>1.</jats:label><jats:p>First</jats:p></jats:list-item></jats:list>",
        parseXmlInNode,
      ),
    ).toBe("β-catenin & Nav1.6 signalling 2\n\nFirst");
  });

  it("returns undefined for a fragment that does not parse, rather than a mangled string", () => {
    expect(jatsToText("<jats:p>unclosed", parseXmlInNode)).toBeUndefined();
    expect(
      jatsToText("<jats:p>&bogus;</jats:p>", parseXmlInNode),
    ).toBeUndefined();
  });
});

describe("readDateParts — the 1-, 2- and 3-element inner arrays of docs/02 §5.3", () => {
  it("maps [[2026]], [[2026,9]] and [[2026,9,3]] to PartialDates at exactly that precision (criterion 3)", () => {
    expect(readDateParts({ "date-parts": [[2026]] })).toEqual({
      year: 2026,
      iso: "2026",
    });
    expect(readDateParts({ "date-parts": [[2026, 9]] })).toEqual({
      year: 2026,
      month: 9,
      iso: "2026-09",
    });
    expect(readDateParts({ "date-parts": [[2026, 9, 3]] })).toEqual({
      year: 2026,
      month: 9,
      day: 3,
      iso: "2026-09-03",
    });
  });

  it("treats [[null]], an empty array, a non-object and an out-of-range part as absent or coarser", () => {
    expect(readDateParts({ "date-parts": [[null]] })).toBeUndefined();
    expect(readDateParts({ "date-parts": [] })).toBeUndefined();
    expect(readDateParts(undefined)).toBeUndefined();
    expect(readDateParts({ "date-parts": [["2026"]] })).toBeUndefined();
    expect(readDateParts({ "date-parts": [[2026, 13]] })).toEqual({
      year: 2026,
      iso: "2026",
    });
    expect(readDateParts({ "date-parts": [[2026, 9, 32]] })).toEqual({
      year: 2026,
      month: 9,
      iso: "2026-09",
    });
  });
});

// ---------------------------------------------------------------------------
// 7. The mapper on the recorded corpus and on hand-built items
// ---------------------------------------------------------------------------

describe("mapper: the journal article (record-rich, docs/02 §3.4's own paper)", () => {
  it("maps title, authors with ORCID, venue, volume/issue/pages, dates, counts and links", async () => {
    const records = mapper()(await recordedItems("record-rich"));
    const rich = byDoi(records, CROSSREF_DOI_RICH);
    expect(rich.id).toBe(`crossref:${CROSSREF_DOI_RICH}`);
    expect(rich.sourceId).toBe("crossref");
    expect(rich.work.title).toBe(T_RICH);
    expect(rich.work.type).toBe("journal-article");
    expect(rich.work.authors).toHaveLength(11);
    expect(rich.work.authors[0]).toEqual({
      family: "Theodoris",
      given: "Christina V.",
      orcid: "0000-0003-1658-1447",
      sequence: 0,
    });
    expect(rich.work.containerTitle).toBe("Nature");
    expect(rich.work.containerAbbreviation).toBe("Nature");
    expect(rich.work.issn).toEqual(["0028-0836", "1476-4687"]);
    expect(rich.work.publisher).toBe("Springer Science and Business Media LLC");
    expect(rich.work.volume).toBe("618");
    expect(rich.work.issue).toBe("7965");
    expect(rich.work.pages).toBe("616-624");
    expect(rich.work.publishedDate).toEqual({
      year: 2023,
      month: 5,
      day: 31,
      iso: "2023-05-31",
    });
    expect(rich.work.citationCount).toBe(1310);
    expect(rich.work.referenceCount).toBe(160);
    expect(rich.work.url).toBe(`https://doi.org/${CROSSREF_DOI_RICH}`);
    expect(rich.work.openAccess).toEqual({
      isOpenAccess: false,
      pdfUrl: "https://www.nature.com/articles/s41586-023-06139-9.pdf",
      license:
        "https://www.springernature.com/gp/researchers/text-and-data-mining",
    });
    // Nature deposits no abstract: docs/02 §5.4's caveat, a routine gap.
    expect(rich.work.abstract).toBeUndefined();
    expect(rich.missingFields).toEqual(["abstract", "subjects"]);
    expect(rich.raw).toBeUndefined();
    expect(rich.retrievedAtEpochMs).toBe(NOW);
  });
});

describe("mapper: the JATS abstract (record-jats-abstract, docs/02 §5.4's example)", () => {
  it("yields a plain-text abstract with paragraph breaks and a CC licence read as open access", async () => {
    const records = mapper()(await recordedItems("record-jats-abstract"));
    const sage = byDoi(records, "10.1177/15357597261460897");
    expect(sage.work.abstract?.split("\n\n")).toHaveLength(3);
    expect(sage.work.abstract).toContain(
      "SCN8A encodes the voltage-gated sodium channel",
    );
    expect(sage.work.abstract).not.toMatch(/<jats:/u);
    expect(sage.work.openAccess).toEqual({
      isOpenAccess: true,
      pdfUrl: "https://journals.sagepub.com/doi/pdf/10.1177/15357597261460897",
      license: "https://creativecommons.org/licenses/by-nc/4.0/",
    });
    expect(sage.work.publishedDate?.iso).toBe("2026-06-16");
    expect(sage.work.containerAbbreviation).toBe("Epilepsy Curr");
    expect(sage.missingFields).toEqual(["subjects"]);
    // A month-precision issued date is in the same page.
    expect(
      byDoi(records, "10.1016/j.ymthe.2023.12.001").work.publishedDate,
    ).toEqual({
      year: 2024,
      month: 1,
      iso: "2024-01",
    });
  });
});

describe("mapper: the preprint and its published version (record-preprint)", () => {
  it("classifies posted-content as a preprint and links the two through relatedVersionIds", async () => {
    const records = mapper()(await recordedItems("record-preprint"));
    const preprint = byDoi(records, "10.1101/2023.02.17.528953");
    const published = byDoi(records, "10.1093/nar/gkad598");
    expect(preprint.work.type).toBe("preprint");
    expect(preprint.work.title).toBe(T_PREPRINT);
    expect(preprint.work.containerTitle).toBe("openRxiv");
    expect(preprint.work.relatedVersionIds).toEqual({
      doi: "10.1093/nar/gkad598",
    });
    expect(preprint.work.publishedDate?.iso).toBe("2023-02-19");
    expect(published.work.type).toBe("journal-article");
    expect(published.work.relatedVersionIds).toEqual({
      doi: "10.1101/2023.02.17.528953",
    });
    for (const r of [preprint, published]) {
      // `<jats:title>Abstract</jats:title>` is decoration and is gone.
      expect(
        r.work.abstract?.startsWith("Site-directed RNA base editing"),
      ).toBe(true);
      expect(r.work.abstract).not.toMatch(/^Abstract/u);
    }
  });
});

describe("mapper: no authors, no date, no abstract (record-sparse)", () => {
  it("reports every absent field and does not warn about Crossref's own [[null]] date", async () => {
    const { logger, lines } = createSpyLogger();
    const records = mapper({ logger })(await recordedItems("record-sparse"));
    const sparse = byDoi(records, "10.1007/3-540-29835-5_2408");
    expect(sparse.work.type).toBe("book-chapter");
    expect(sparse.work.authors).toEqual([]);
    expect(sparse.work.publishedDate).toBeUndefined();
    expect(sparse.work.abstract).toBeUndefined();
    expect(sparse.work.containerTitle).toBe(
      "Encyclopedic Reference of Parasitology",
    );
    expect(sparse.work.pages).toBe("515-517");
    expect(sparse.missingFields).toEqual(
      expect.arrayContaining([
        "abstract",
        "authors",
        "publishedDate",
        "issn",
        "openAccess",
      ]),
    );
    expect(lines.filter((l) => l.includes("date not understood"))).toEqual([]);
  });
});

describe("mapper: Unicode (record-unicode) and 50+ authors (hand-built)", () => {
  it("keeps diacritics in author names byte for byte", async () => {
    const records = mapper()(await recordedItems("record-unicode"));
    const pilates = byDoi(records, "10.1016/j.jbmt.2023.01.002");
    expect(pilates.work.authors).toEqual([
      {
        family: "Aracı",
        given: "Ayça",
        orcid: "0000-0002-1089-3370",
        sequence: 0,
      },
      { family: "Aslan", given: "Ummuhan Baş", sequence: 1 },
    ]);
    const polish = byDoi(records, "10.12775/qs.2024.36.56521");
    expect(polish.work.authors.map((a) => a.family)).toEqual(
      expect.arrayContaining(["Kwaśna", "Załęska", "Kaźmierczyk"]),
    );
    expect(records).toHaveLength(10);
  });

  it("keeps a CJK title and 60 authors intact on a hand-built item", () => {
    const title =
      "基因编辑技术在范可尼贫血中的研究进展：CRISPR-Cas9 系统的应用";
    const authors = Array.from({ length: 60 }, (_, i) => ({
      given: `G${String(i)}`,
      family: i === 0 ? "高" : `F${String(i)}`,
      sequence: i === 0 ? "first" : "additional",
    }));
    const [record] = mapper()([
      item("10.1234/cjk", { title: [title], author: authors }),
    ]);
    expect(record?.work.title).toBe(title);
    expect(record?.work.authors).toHaveLength(60);
    expect(record?.work.authors[0]).toEqual({
      family: "高",
      given: "G0",
      sequence: 0,
    });
    expect(record?.work.authors[59]?.sequence).toBe(59);
  });
});

describe("mapper: hand-built edge cases", () => {
  it("maps the three date-parts precisions through the mapper, and falls back to published-online", () => {
    const records = mapper()([
      item("10.1234/y", { issued: { "date-parts": [[2026]] } }),
      item("10.1234/ym", { issued: { "date-parts": [[2026, 9]] } }),
      item("10.1234/ymd", { issued: { "date-parts": [[2026, 9, 3]] } }),
      item("10.1234/fallback", {
        issued: { "date-parts": [[null]] },
        "published-online": { "date-parts": [[2025, 1, 2]] },
      }),
    ]);
    expect(records.map((r) => r.work.publishedDate)).toEqual([
      { year: 2026, iso: "2026" },
      { year: 2026, month: 9, iso: "2026-09" },
      { year: 2026, month: 9, day: 3, iso: "2026-09-03" },
      { year: 2025, month: 1, day: 2, iso: "2025-01-02" },
    ]);
  });

  it("flattens a title with inline markup, maps an organisational author and strips the ORCID URL", () => {
    const [record] = mapper()([
      item("10.1234/markup", {
        title: ["Effect of <i>Zingiber</i> &amp; VO<sub>2</sub>max"],
        author: [
          { name: "The Consortium", sequence: "first" },
          {
            family: "Doe",
            given: "J",
            ORCID: "https://orcid.org/0000-0002-1825-0097",
          },
          { given: "nameless" },
        ],
      }),
    ]);
    expect(record?.work.title).toBe("Effect of Zingiber & VO2max");
    expect(record?.work.authors).toEqual([
      { family: "The Consortium", literal: "The Consortium", sequence: 0 },
      { family: "Doe", given: "J", orcid: "0000-0002-1825-0097", sequence: 1 },
    ]);
  });

  it("follows docs/02 §10.2's type table and the venue rule", () => {
    const types = mapper()([
      item("10.1234/a", { type: "proceedings-article" }),
      item("10.1234/b", { type: "book-chapter" }),
      item("10.1234/c", { type: "dataset" }),
      item("10.1234/d", { type: "dissertation" }),
      item("10.1234/e", { type: "report" }),
      item("10.1234/f", {
        type: "peer-review",
        "container-title": undefined,
        ISSN: undefined,
      }),
      item("10.1234/g", { type: "something-new" }),
      item("10.1234/h", {
        type: "posted-content",
        institution: [{ name: "bioRxiv" }],
        publisher: "Cold Spring Harbor Laboratory",
      }),
    ]).map((r) => [r.work.type, r.work.containerTitle]);
    expect(types).toEqual([
      ["conference-paper", "Journal of Tests"],
      ["book-chapter", "Journal of Tests"],
      ["dataset", "Journal of Tests"],
      ["thesis", "Journal of Tests"],
      ["report", "Journal of Tests"],
      ["other", undefined],
      ["journal-article", "Journal of Tests"],
      ["preprint", "bioRxiv"],
    ]);
  });

  it("reads references-count, falls back to reference-count, and maps subjects, a non-CC licence and keepRaw", () => {
    const raw = item("10.1234/counts", {
      "references-count": 12,
      subject: ["Genetics", "Molecular Biology"],
      license: [{ URL: "https://www.elsevier.com/tdm/userlicense/1.0/" }],
      link: [{ URL: "https://x/pdf", "content-type": "application/pdf" }],
    });
    const [record] = mapper({ keepRaw: true })([raw]);
    expect(record?.work.referenceCount).toBe(12);
    expect(record?.work.subjects).toEqual([
      { term: "Genetics", scheme: "crossref" },
      { term: "Molecular Biology", scheme: "crossref" },
    ]);
    expect(record?.work.openAccess).toEqual({
      isOpenAccess: false,
      pdfUrl: "https://x/pdf",
      license: "https://www.elsevier.com/tdm/userlicense/1.0/",
    });
    expect(record?.raw).toBe(raw);
    expect(
      mapper()([item("10.1234/legacy", { "reference-count": 7 })])[0]?.work
        .referenceCount,
    ).toBe(7);
  });

  it("drops an item with no usable DOI with a warning, and warns about an unparseable abstract", () => {
    const { logger, lines } = createSpyLogger();
    const records = mapper({ logger })([
      { title: ["No DOI"] },
      item("10.1234/bad-abstract", { abstract: "<jats:p>unclosed" }),
    ]);
    expect(records.map((r) => r.nativeId)).toEqual(["10.1234/bad-abstract"]);
    expect(records[0]?.work.abstract).toBeUndefined();
    expect(records[0]?.missingFields).toContain("abstract");
    expect(lines.some((l) => l.includes("no usable DOI"))).toBe(true);
    expect(lines.some((l) => l.includes("did not parse as JATS"))).toBe(true);
  });

  it("names every mappable field and nothing Crossref never supplies", () => {
    expect(CROSSREF_MAPPABLE_FIELDS).not.toContain("language");
    expect(CROSSREF_MAPPABLE_FIELDS).not.toContain("ids.pmid");
    expect(CROSSREF_MAPPABLE_FIELDS).toContain("referenceCount");
  });
});

// ---------------------------------------------------------------------------
// 8. The response validator, the paging rule, the clamp
// ---------------------------------------------------------------------------

describe("parseCrossrefWorksBody", () => {
  it("returns the items, the cursor and the totals of an ok envelope", () => {
    const result = parseCrossrefWorksBody(
      worksBody([item("10.1234/a")], {
        "next-cursor": "abc",
        "total-results": 99,
      }),
      "u",
    );
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe("abc");
    expect(result.totalResults).toBe(99);
    expect(result.itemsPerPage).toBe(1);
    expect(
      parseCrossrefWorksBody(worksBody([], { "next-cursor": "" }), "u")
        .nextCursor,
    ).toBeUndefined();
  });

  it("turns the measured validation-failure envelope into a SourceError naming the token (error-400)", async () => {
    const exchange = await recordedExchange("error-400");
    expect(exchange.status).toBe(400);
    expect(() => parseCrossrefWorksBody(exchange.body, "u")).toThrow(
      SourceError,
    );
    expect(() => parseCrossrefWorksBody(exchange.body, "u")).toThrow(
      /status "failed" \(validation-failure\).*reference-count/u,
    );
    try {
      parseCrossrefWorksBody(exchange.body, "u");
    } catch (error) {
      expect(error).not.toBeInstanceOf(ParseError);
    }
  });

  it("throws ParseError for a non-JSON body, a non-object and a message without items", () => {
    expect(() => parseCrossrefWorksBody("<html>", "u")).toThrow(ParseError);
    expect(() => parseCrossrefWorksBody("[1]", "u")).toThrow(ParseError);
    expect(() =>
      parseCrossrefWorksBody(
        JSON.stringify({ status: "ok", message: { DOI: "x" } }),
        "u",
      ),
    ).toThrow(/no message\.items array/u);
  });
});

describe("nextCursorAfter and clampRows", () => {
  it("stops on no cursor, a repeated cursor, an empty page or a short page", () => {
    expect(nextCursorAfter("*", undefined, 3, 3)).toBeUndefined();
    expect(nextCursorAfter("A", "A", 3, 3)).toBeUndefined();
    expect(nextCursorAfter("*", "B", 0, 3)).toBeUndefined();
    expect(nextCursorAfter("*", "B", 2, 3)).toBeUndefined();
    expect(nextCursorAfter("*", "B", 3, 3)).toBe("B");
  });

  it("clamps limit into 1 … 1000", () => {
    expect(clampRows(0)).toBe(1);
    expect(clampRows(-5)).toBe(1);
    expect(clampRows(2.9)).toBe(2);
    expect(clampRows(5000)).toBe(1000);
    expect(clampRows(Number.NaN)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. The adapter over a stub client
// ---------------------------------------------------------------------------

describe("createCrossrefSource — identity and requests", () => {
  it("reports its identity, its display key, its host and that it is always configured", () => {
    const source = createSource(
      createStubHttp((i) => response(i.url, worksBody([]))).client,
    );
    expect(source.id).toBe(CROSSREF_SOURCE_ID);
    expect(source.displayNameKey).toBe(CROSSREF_DISPLAY_NAME_KEY);
    expect(source.displayNameKey).toBe("research-helper-source-crossref");
    expect(source.rateLimitKey).toBe(CROSSREF_HOST);
    expect(source.capabilities).toBe(CROSSREF_CAPABILITIES);
    expect(source.isConfigured()).toBe(true);
    expect(source.explainQuery({ terms: term("x"), limit: 1 })).toBe(
      "query.bibliographic=x",
    );
  });

  it("P2-T34: capabilities.filters is the renderer's own object, and equals what the renderer does", () => {
    expect(CROSSREF_CAPABILITIES.filters).toBe(CROSSREF_FILTERS);
    const source = createSource(
      createStubHttp((i) => response(i.url, worksBody([]))).client,
    );
    const plain = { terms: term("x"), limit: 1 };
    // Both false → both refused by name, never dropped.
    expect(source.capabilities.filters).toEqual({
      languages: false,
      openAccess: false,
    });
    expect(() => source.explainQuery({ ...plain, languages: ["en"] })).toThrow(
      /SourceQuery\.languages/u,
    );
    expect(() =>
      source.explainQuery({ ...plain, openAccessOnly: true }),
    ).toThrow(/SourceQuery\.openAccessOnly/u);
  });

  it("sends both polite-pool signals on every request, reading the contact preference each time", async () => {
    const pref: { value: string | undefined } = { value: undefined };
    const { client, issued } = createStubHttp((i) =>
      response(i.url, worksBody([])),
    );
    const source = createSource(client, {
      userContactEmail: () => pref.value,
    });
    await source.search({ terms: term("x"), limit: 5 }, ctx());
    pref.value = "reader@example.org";
    await source.search({ terms: term("x"), limit: 5 }, ctx());
    expect(issued.map((i) => paramsOf(i).get("mailto"))).toEqual([
      MAINTAINER_EMAIL,
      "reader@example.org",
    ]);
    expect(issued[0]?.method).toBe("GET");
    expect(issued[0]?.options?.responseType).toBe("text");
    for (const i of issued) {
      expect(paramsOf(i).get("select")).toBe(CROSSREF_SELECT_FIELDS.join(","));
      expect(paramsOf(i).get("rows")).toBe("5");
      expect(paramsOf(i).get("cursor")).toBe("*");
    }
  });

  it("returns the mapped page, the server total and the cursor, and stops on a short page", async () => {
    const { client } = createStubHttp((i, index) =>
      response(
        i.url,
        index === 0
          ? worksBody([item("10.1234/a"), item("10.1234/b")], {
              "total-results": 50,
              "next-cursor": "C",
            })
          : worksBody([item("10.1234/c")], {
              "total-results": 50,
              "next-cursor": "D",
            }),
      ),
    );
    const source = createSource(client);
    const full = await source.search({ terms: term("x"), limit: 2 }, ctx());
    expect(full.records.map((r) => r.nativeId)).toEqual([
      "10.1234/a",
      "10.1234/b",
    ]);
    expect(full.totalAvailable).toBe(50);
    expect(full.nextCursor).toBe("C");
    expect(full.warnings).toEqual([]);
    const short = await source.search(
      { terms: term("x"), limit: 2, cursor: "C" },
      ctx(),
    );
    expect(short.records).toHaveLength(1);
    expect(short.nextCursor).toBeUndefined();
    expect(short.sourceExtras.apiPool).toBe("polite-array");
    expect(short.sourceExtras.rateLimitLimit).toBe("3");
  });

  it("removes the record matching a NOT term and warns about it (criterion 5)", async () => {
    const { client, issued } = createStubHttp((i) =>
      response(
        i.url,
        worksBody([
          item("10.1234/mouse", { title: ["Base editing in the mouse"] }),
          item("10.1234/human", { title: ["Base editing in humans"] }),
        ]),
      ),
    );
    const page = await createSource(client).search(
      { terms: parseUserQuery('"base editing" NOT mouse'), limit: 10 },
      ctx(),
    );
    expect(
      paramsOf(issued[0] ?? { method: "GET", url: "", options: undefined }).get(
        "query.bibliographic",
      ),
    ).toBe("base editing");
    expect(page.records.map((r) => r.nativeId)).toEqual(["10.1234/human"]);
    expect(page.sourceExtras.excludedByNotFilter).toBe(1);
    expect(page.warnings).toHaveLength(2);
    expect(page.warnings.join("\n")).toMatch(
      /no NOT operator.*"mouse".*client-side/su,
    );
    expect(page.warnings[0]).toMatch(
      /quoted phrase was searched as separate words/u,
    );
  });

  it("reconfigures the limiter from x-rate-limit-* on every response, upwards included (criterion 4)", async () => {
    const limiter = fakeLimiter(CROSSREF_START);
    const { logger, lines } = createSpyLogger();
    const { client } = createStubHttp((i, index) =>
      response(
        i.url,
        worksBody([]),
        200,
        index === 0
          ? POLITE_HEADERS
          : {
              "x-rate-limit-limit": "1",
              "x-rate-limit-interval": "1s",
              "x-concurrency-limit": "1",
            },
      ),
    );
    const source = createSource(client, { limiter, logger });
    await source.search({ terms: term("x"), limit: 1 }, ctx());
    expect(limiter.applied).toEqual([
      { ratePerSecond: 3, burst: 2, maxConcurrent: 3 },
    ]);
    await source.search({ terms: term("x"), limit: 1 }, ctx());
    expect(limiter.applied[1]).toEqual({
      ratePerSecond: 1,
      burst: 2,
      maxConcurrent: 1,
    });
    expect(
      lines.filter((l) => l.includes("rate limit adopted from headers")),
    ).toHaveLength(2);
    // Without a limiter the step is a no-op, not a crash.
    await createSource(client).search({ terms: term("x"), limit: 1 }, ctx());
  });

  it("propagates the client's typed transport errors unwrapped", async () => {
    const client: HttpClient = {
      request: () =>
        Promise.reject(new RateLimitError(429, 2000, CROSSREF_HOST)),
    };
    await expect(
      createSource(client).search({ terms: term("x"), limit: 1 }, ctx()),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("createCrossrefSource — searchAll", () => {
  it("pages until the limit, asks for what is still wanted, and raises the notices once", async () => {
    // Every page is full — exactly the rows asked for — so the loop runs until
    // the limit rather than stopping on the short-page rule.
    const { client, issued } = createStubHttp((i, index) => {
      const rows = Number(paramsOf(i).get("rows"));
      return response(
        i.url,
        worksBody(
          Array.from({ length: rows }, (_, k) =>
            item(`10.1234/${String(index)}-${String(k)}`),
          ),
          { "total-results": 5000, "next-cursor": `cur${String(index + 1)}` },
        ),
      );
    });
    const warned: string[] = [];
    const progress = {
      warn: (m: string) => void warned.push(m),
      setProgress: () => undefined,
    } as unknown as NonNullable<SourceCallContext["progress"]>;
    const out: string[] = [];
    for await (const r of createSource(client).searchAll(
      { terms: parseUserQuery('"base editing" NOT mouse'), limit: 1500 },
      { ...ctx(), progress },
    )) {
      out.push(r.nativeId);
    }
    expect(out).toHaveLength(1500);
    expect(new Set(out).size).toBe(1500);
    expect(issued.map((i) => paramsOf(i).get("rows"))).toEqual(["1000", "500"]);
    expect(issued.map((i) => paramsOf(i).get("cursor"))).toEqual(["*", "cur1"]);
    expect(warned).toHaveLength(2);
  });

  it("stops at a short page and honours cancellation before the next request", async () => {
    const { client, issued } = createStubHttp((i) =>
      response(
        i.url,
        worksBody([item("10.1234/only")], { "next-cursor": "more" }),
      ),
    );
    const out: string[] = [];
    for await (const r of createSource(client).searchAll(
      { terms: term("x"), limit: 50 },
      ctx(),
    )) {
      out.push(r.nativeId);
    }
    expect(out).toEqual(["10.1234/only"]);
    expect(issued).toHaveLength(1);

    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });
    await expect(
      (async () => {
        for await (const r of createSource(client).searchAll(
          { terms: term("x"), limit: 5 },
          { token: cts.token },
        )) {
          out.push(r.nativeId);
        }
      })(),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

describe("createCrossrefSource — healthCheck", () => {
  it("sends a fixed one-row DOI-only probe and reports the pool", async () => {
    const { client, issued } = createStubHttp((i) =>
      response(i.url, worksBody([item("10.1234/x")])),
    );
    const health = await createSource(client).healthCheck(ctx());
    expect(health.ok).toBe(true);
    expect(health.messageKey).toBe(CROSSREF_DISPLAY_NAME_KEY);
    expect(health.quotaHint).toBe("x-api-pool: polite-array");
    const params = paramsOf(
      issued[0] ?? { method: "GET", url: "", options: undefined },
    );
    expect(params.get("rows")).toBe("1");
    expect(params.get("select")).toBe("DOI");
    expect(params.get("query.bibliographic")).toBe("crossref");
    expect(params.get("mailto")).toBe(MAINTAINER_EMAIL);
  });

  it("reports a failed probe with the error's message key, and rethrows a cancellation", async () => {
    const failing: HttpClient = {
      request: () =>
        Promise.reject(
          new UpstreamServerError(504, "down", { host: CROSSREF_HOST }),
        ),
    };
    const health = await createSource(failing).healthCheck(ctx());
    expect(health.ok).toBe(false);
    expect(health.messageKey).toBe(
      new UpstreamServerError(504, "down", {}).messageKey,
    );
    const cancelled: HttpClient = {
      request: () =>
        Promise.reject(new OperationCancelledError({ kind: "user" })),
    };
    await expect(
      createSource(cancelled).healthCheck(ctx()),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

// ---------------------------------------------------------------------------
// 10. Replay: test/fixtures/crossref through the shipped createHttpClient
// ---------------------------------------------------------------------------

describe("replay: test/fixtures/crossref through createHttpClient", () => {
  function replaySource() {
    const replay = createReplayHttpClient({
      dir: FIXTURE_DIR,
      host: CROSSREF_HOST,
    });
    const source = createCrossrefSource({
      http: replay.client,
      clock: replay.clock,
      mapRecords: createCrossrefRecordMapper({
        clock: replay.clock,
        parseXml: parseXmlInNode,
      }),
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
        "search-doi-string",
        "error-400",
        ...DEDUP_CORPUS_SEARCHES.crossref.map((s) => s.scenario),
      ]),
    );
    expect(loaded).toHaveLength(16 + CORPUS_FIXTURES);
    const names = await readdir(FIXTURE_DIR);
    for (const { key } of loaded) {
      expect(names).toContain(`${key}.json`);
      expect(names).toContain(`${key}${META_SUFFIX}`);
    }
    for (const { meta } of loaded) {
      expect(meta.endpoint).toBe(CROSSREF_WORKS_URL);
      expect(meta.method).toBe("GET");
      expect(meta.synthetic).toBe(
        ["error-400", "error-429", "error-500", "error-malformed"].includes(
          meta.scenario,
        ),
      );
    }
  });

  it("carries no contact address in either spelling, keeps its cursors, and is fresh", async () => {
    const names = (await readdir(FIXTURE_DIR)).filter((n) =>
      n.endsWith(".json"),
    );
    for (const name of names) {
      const text = await readFile(`${FIXTURE_DIR}/${name}`, "utf8");
      expect(text).not.toMatch(/suppakoko(@|%40)gmail/iu);
      expect(text).not.toMatch(/"next-cursor":"\[redacted/u);
    }
    const report = await assertFixturesFresh(FIXTURE_DIR, Date.now());
    expect(report.checked).toBe(16 + CORPUS_FIXTURES);
  });

  it("search-typical: 20 records from the polite pool, every request carrying mailto and the User-Agent", async () => {
    const { source, transport } = replaySource();
    const page = await source.search(QUERY_TYPICAL, ctx());
    expect(page.records).toHaveLength(20);
    expect(page.totalAvailable).toBe(2475);
    expect(page.nextCursor).toBeDefined();
    expect(page.nextCursor?.length).toBeGreaterThanOrEqual(40);
    expect(page.warnings).toEqual([]);
    expect(page.sourceExtras).toMatchObject({
      apiPool: "polite-array",
      rateLimitLimit: "3",
      rateLimitInterval: "1s",
      excludedByNotFilter: 0,
    });
    const call = transport.calls[0];
    expect(call?.options.headers?.["User-Agent"]).toMatch(
      new RegExp(
        `^research_helper/.*mailto:${MAINTAINER_EMAIL.replace(".", "\\.")}`,
        "u",
      ),
    );
    expect(new URL(call?.url ?? "").searchParams.get("mailto")).toBe(
      MAINTAINER_EMAIL,
    );
    // All three docs/02 §5.3 date precisions occur in this one recorded page.
    const precisions = new Set(
      page.records.map((r) => r.work.publishedDate?.iso.length ?? 0),
    );
    expect(precisions).toEqual(new Set([4, 10]));
    expect(
      page.records.filter((r) => r.work.abstract !== undefined),
    ).toHaveLength(8);
    // SSRN deposits a second, entity-escaped HTML layer inside the JATS text
    // (measured): its <br><br> is a paragraph break and its <b> is dropped.
    const ssrn = byDoi(page.records, "10.2139/ssrn.3498384");
    const ssrnParagraphs = ssrn.work.abstract?.split("\n\n") ?? [];
    expect(ssrnParagraphs).toHaveLength(2);
    expect(ssrnParagraphs[0]).toMatch(/^French Abstract: Quelle gouvernance/u);
    expect(ssrnParagraphs[1]).toMatch(/^English Abstract: In this article/u);
    for (const r of page.records) {
      expect(r.work.abstract ?? "").not.toMatch(/<[a-z]/iu);
    }
  });

  it("reconfigures a limiter from the recorded polite-pool headers through the shipped client (criterion 4)", async () => {
    const limiter = fakeLimiter(CROSSREF_START);
    const clock = createManualClock(NOW);
    const client = createHttpClient({
      transport: createReplayTransport(FIXTURE_DIR),
      userAgent: buildUserAgent("0.0.2"),
      clock,
      limiterFor: (host) => (host === CROSSREF_HOST ? limiter : undefined),
    });
    const source = createCrossrefSource({
      http: client,
      clock,
      mapRecords: createCrossrefRecordMapper({
        clock,
        parseXml: parseXmlInNode,
      }),
      limiter,
    });
    await source.search(QUERY_TYPICAL, ctx());
    // The client's own tighten-only pass leaves 2/s alone; the adapter lands 3/s.
    expect(limiter.applied).toEqual([
      { ratePerSecond: 3, burst: 2, maxConcurrent: 3 },
    ]);
  });

  it("search-empty: zero records, total 0, no cursor", async () => {
    const page = await replaySource().source.search(QUERY_EMPTY, ctx());
    expect(page.records).toEqual([]);
    expect(page.totalAvailable).toBe(0);
    expect(page.nextCursor).toBeUndefined();
  });

  it("search-single: one record and a cursor at rows 1", async () => {
    const page = await replaySource().source.search(
      { ...QUERY_TYPICAL, limit: 1 },
      ctx(),
    );
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.nativeId).toBe("10.15252/rc.2023802641");
    expect(page.records[0]?.work.type).toBe("other");
    expect(page.nextCursor).toBeDefined();
  });

  it("paginated: page 2 replays under page 1's recorded cursor, and searchAll follows it", async () => {
    const { source, transport } = replaySource();
    const page1 = await source.search(QUERY_PAGINATED, ctx());
    expect(page1.records).toHaveLength(3);
    expect(page1.nextCursor).toBeDefined();
    const page2 = await source.search(
      { ...QUERY_PAGINATED, cursor: page1.nextCursor ?? "" },
      ctx(),
    );
    expect(page2.records.map((r) => r.nativeId)).toEqual([
      "10.29228/genediting.66930",
      "10.1007/978-1-4939-8991-1_27",
      "10.29228/genediting.66976",
    ]);
    expect(page2.nextCursor).toBeDefined();
    expect(transport.calls).toHaveLength(2);
    expect(
      new URL(transport.calls[1]?.url ?? "").searchParams.get("cursor"),
    ).toBe(page1.nextCursor);

    const again = replaySource();
    const all: string[] = [];
    // A `limit` of 3 is one full page: no second request, and the cursor the
    // page offered is left unfollowed (the two-page walk is asserted above; a
    // larger limit would ask for `rows=6` first, which no fixture holds).
    for await (const r of again.source.searchAll(
      { ...QUERY_PAGINATED, limit: 3 },
      ctx(),
    ))
      all.push(r.nativeId);
    expect(all).toHaveLength(3);
    expect(again.transport.calls).toHaveLength(1);
    expect(
      again.transport.calls.map((c) => new URL(c.url).searchParams.get("rows")),
    ).toEqual(["3"]);
  });

  it("dedup-pair-set: the title query returns PubMed's record-rich paper first, by DOI", async () => {
    const page = await replaySource().source.search(QUERY_PAIR, ctx());
    expect(page.records[0]?.nativeId).toBe(CROSSREF_DOI_RICH);
    expect(page.records[0]?.work.ids).toEqual({ doi: CROSSREF_DOI_RICH });
    expect(page.records[0]?.work.title).toBe(T_RICH);
  });

  it("search-doi-string: query.bibliographic does not resolve a bare DOI string (measured, for P2-T12)", async () => {
    const page = await replaySource().source.search(QUERY_DOI_STRING, ctx());
    expect(page.records).toHaveLength(3);
    expect(page.records.map((r) => r.nativeId)).not.toContain(
      CROSSREF_DOI_RICH,
    );
  });

  it("record scenarios replay through search() too", async () => {
    const { source } = replaySource();
    expect((await source.search(QUERY_RICH, ctx())).records[0]?.nativeId).toBe(
      CROSSREF_DOI_RICH,
    );
    expect(
      (await source.search(QUERY_SPARSE, ctx())).records[0]?.work.authors,
    ).toEqual([]);
    expect(
      (await source.search(QUERY_JATS, ctx())).records[0]?.work.abstract,
    ).toContain("SCN8A encodes");
    expect(
      (await source.search(QUERY_PREPRINT, ctx())).records.filter(
        (r) => r.work.type === "preprint",
      ),
    ).toHaveLength(1);
    expect((await source.search(QUERY_UNICODE, ctx())).records).toHaveLength(
      10,
    );
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

  it("error-400: the client classifies the measured validation failure as BadRequestError", async () => {
    await expect(
      replaySource().source.search(QUERY_SYNTHETIC_400, ctx()),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("error-500: docs/02 §5.6's 504 is UpstreamServerError", async () => {
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
// 11. Registration — docs/07 §11.1 step 8
// ---------------------------------------------------------------------------

describe("registerSources with the crossref slot", () => {
  const unreachable = () => {
    throw new Error("not called");
  };
  function stub(id: LiteratureSource["id"]): LiteratureSource {
    return {
      id,
      displayNameKey: `x-${id}`,
      capabilities: CROSSREF_CAPABILITIES,
      rateLimitKey: "h",
      isConfigured: () => true,
      healthCheck: unreachable,
      search: unreachable,
      searchAll: unreachable,
      explainQuery: unreachable,
    };
  }

  it("registers crossref third, in SOURCE_IDS order, whatever the literal's key order", () => {
    const registry = createSourceRegistry();
    const crossref = stub("crossref");
    const europepmc = stub("europepmc");
    const pubmed = stub("pubmed");
    registerSources(registry, { crossref, europepmc, pubmed });
    expect(registry.list()).toEqual([pubmed, europepmc, crossref]);
    expect(SOURCE_IDS.indexOf("europepmc")).toBeLessThan(
      SOURCE_IDS.indexOf("crossref"),
    );
  });

  it("registers the real adapter under its own id and rejects a mis-wired one", () => {
    const registry = createSourceRegistry();
    const real = createSource(
      createStubHttp((i) => response(i.url, worksBody([]))).client,
    );
    registerSources(registry, { pubmed: stub("pubmed"), crossref: real });
    expect(registry.get("crossref")).toBe(real);
    expect(registry.listConfigured()).toContain(real);
    expect(() =>
      registerSources(createSourceRegistry(), {
        pubmed: stub("pubmed"),
        crossref: stub("arxiv"),
      }),
    ).toThrow(/supplied as "crossref" reports id "arxiv"/u);
  });
});

// ---------------------------------------------------------------------------
// 12. The recorder's Crossref plan — docs/07 §11.1 step 5, docs/13 §3.2
// ---------------------------------------------------------------------------

describe("scripts/record-fixtures.ts: the Crossref plan and the cursor exemption", () => {
  it("plans every committed fixture under the key that is on disk, and nothing else", async () => {
    const plan = planFor("crossref");
    expect(plan.host).toBe(CROSSREF_HOST);
    expect(RECORDABLE_SOURCES).toContain("crossref");
    const planned = [...plan.independent(), ...plan.syntheticRequests()];
    const onDisk = (await readdir(FIXTURE_DIR))
      .filter((n) => n.endsWith(".json") && !n.endsWith(META_SUFFIX))
      .map((n) => n.replace(/\.json$/u, ""));
    const keys = planned.map((p) =>
      fixtureKey({ method: p.method, url: p.url }),
    );
    for (const key of keys) expect(onDisk).toContain(key);
    // Every committed key is planned, except page 2, which the recorder plans
    // from page 1's recorded cursor and which is asserted by the replay above.
    expect(onDisk).toHaveLength(keys.length + 1);
    expect(planned.map((p) => p.scenario)).toEqual(
      expect.arrayContaining([...DOCS_13_SCENARIOS]),
    );
    expect(plannedRequest("search-typical", "crossref").url).toBe(
      recordedCrossrefRequest(QUERY_TYPICAL).url,
    );
    // The plan vouches for exactly one opaque token per page: the cursor.
    const cursor =
      "DnF1ZXJ5VGhlbkZldGNoBQAAAAAAAAAAFkR5c2ZQ3ZTdlpzTE8R3Q3V5Q1lkRS1oVFE=";
    expect(
      plan.opaqueTokens?.(
        JSON.stringify({
          status: "ok",
          message: { "next-cursor": cursor, items: [] },
        }),
      ),
    ).toEqual([cursor]);
    expect(plan.opaqueTokens?.("not json")).toEqual([]);
  });

  it("keeps a vouched-for next-cursor through the redaction pass and the clean check, and redacts an unvouched one", () => {
    const cursor =
      "DnF1ZXJ5VGhlbkZldGNoBQAAAAAAAAAAFkR5c2ZQ3ZTdlpzTE8R3Q3V5Q1lkRS1oVFE=";
    const raw = {
      status: 200,
      headers: {},
      body: JSON.stringify({ message: { "next-cursor": cursor, items: [] } }),
    };
    const kept = redactExchange(raw, [], [cursor]);
    expect(kept.exchange.body).toBe(raw.body);
    expect(kept.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/preserved 1 opaque/u)]),
    );
    expect(() =>
      assertClean("x", kept.exchange.body, [], [cursor]),
    ).not.toThrow();
    const scrubbed = redactExchange(raw, []);
    expect(scrubbed.exchange.body).toMatch(/"next-cursor":"\[redacted:\d+\]/u);
    expect(() => assertClean("x", raw.body, [])).toThrow(/credential pattern/u);
  });
});
