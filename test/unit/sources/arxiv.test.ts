import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerSources } from "../../../src/bootstrap/registerSources";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
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
  type HttpExceptionClass,
  type HttpMethod,
  type HttpOptions,
  type HttpResponse,
  type HttpTransport,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { buildUserAgent } from "../../../src/core/http/userAgent";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { ProgressReporter } from "../../../src/core/jobQueue/progress";
import type { Logger } from "../../../src/core/logger";
import {
  ARXIV_HOST,
  createHostLimiterRegistry,
  CROSSREF_HOST,
  EBI_HOST,
  HOST_POLICIES,
  NCBI_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import { TokenBucket } from "../../../src/core/rateLimit/tokenBucket";
import { SOURCE_IDS } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  ARXIV_APPROXIMATE_PREFIX,
  ARXIV_CAPABILITIES,
  ARXIV_DISPLAY_NAME_KEY,
  ARXIV_ERROR_FEED_ENTRY_ID,
  ARXIV_SOURCE_ID,
  clampMaxResults,
  createArxivSource,
  isErrorFeedEntryId,
  lossinessWarnings,
  nextStartAfter,
  parseArxivFeedBody,
  readStartCursor,
  type ArxivSourceDeps,
} from "../../../src/sources/arxiv/arxivSource";
import {
  ARXIV_ARCHIVE_ID_PREFIX,
  ARXIV_CATEGORY_SCHEME,
  ARXIV_MAPPABLE_FIELDS,
  ARXIV_NS,
  ARXIV_REPOSITORY_NAME,
  arxivArchiveId,
  arxivDataCiteDoi,
  ATOM_NS,
  childrenNS,
  createArxivRecordMapper,
  mapEntry,
  normalizeWhitespace,
  OPENSEARCH_NS,
  parseArxivEntryId,
  readAtomDate,
  splitAuthorName,
  type XmlCollectionLike,
  type XmlDocumentLike,
  type XmlElementLike,
} from "../../../src/sources/arxiv/mapper";
import {
  ARXIV_MAX_RESULTS_MAX,
  ARXIV_MAX_TOTAL_RESULTS,
  ARXIV_FILTERS,
  ARXIV_QUERY_FILTER_SUPPORT,
  ARXIV_QUERY_URL,
  ARXIV_RENDERED_FIELDS,
  ARXIV_SORT_BY,
  ARXIV_SORT_ORDER,
  buildArxivQueryRequest,
  encodeSearchQuery,
  explainArxivQuery,
  renderArxivQuery,
  renderSubmittedDate,
  RESERVED_RAW_PARAMS,
} from "../../../src/sources/arxiv/query";
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
} from "../../../scripts/record-fixtures";
import {
  ARXIV_PAGE_2_START,
  ARXIV_QUERY_EMPTY as QUERY_EMPTY,
  ARXIV_QUERY_ERROR_FEED as QUERY_ERROR_FEED,
  ARXIV_QUERY_PAGINATED as QUERY_PAGINATED,
  ARXIV_QUERY_PAIR as QUERY_PAIR,
  ARXIV_QUERY_PREPRINT as QUERY_PREPRINT,
  ARXIV_QUERY_RICH as QUERY_RICH,
  ARXIV_QUERY_SPARSE as QUERY_SPARSE,
  ARXIV_QUERY_SYNTHETIC_429 as QUERY_SYNTHETIC_429,
  ARXIV_QUERY_SYNTHETIC_500 as QUERY_SYNTHETIC_500,
  ARXIV_QUERY_SYNTHETIC_MALFORMED as QUERY_SYNTHETIC_MALFORMED,
  ARXIV_QUERY_TYPICAL as QUERY_TYPICAL,
  ARXIV_QUERY_UNICODE as QUERY_UNICODE,
  ARXIV_QUERY_WRAPPED as QUERY_WRAPPED,
  recordedArxivRequest,
} from "../../support/arxivRecordedRequests";
import { DEDUP_CORPUS_SEARCHES } from "../../support/dedupCorpusRecordedRequests";

/** `P2-T13` Part B's corpus searches, recorded beside the `docs/13` inventory. */
const CORPUS_FIXTURES = DEDUP_CORPUS_SEARCHES.arxiv.length;

/**
 * `P2-T06`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network**.
 * Two kinds of test share this file, and the card's `Verify with`
 * (`npm run test:unit -- arxiv`) runs both:
 *
 * - **Pure**: the renderer against `docs/02` §12.2 / §12.3's arXiv column,
 *   the date window of §7.3, the percent-encoding table, the request builder,
 *   the namespaced entry mapper over a Node XML stand-in, the feed parse and
 *   the error feed, the paging rule, the `export.arxiv.org` policy row read
 *   back from `docs/07` §7.3, the three-second spacing on the real
 *   `TokenBucket` under a manual clock, and `registerSources` with the new
 *   slot.
 * - **Replayed**: the shipped `createArxivSource` over the shipped
 *   `createHttpClient`, answering from `test/fixtures/arxiv/` — recorded live
 *   on 2026-10-15 (12 requests, one every three seconds; 3 written). A
 *   missing fixture is an error naming the record command, never a network
 *   call. The queries are `test/support/arxivRecordedRequests.ts`'s, the
 *   recorder's own.
 *
 * **Why this file ships its own XML parser.** Node has no `DOMParser` and the
 * sandbox does (`docs/01` §2.3), so the adapter takes the parse as a port and
 * {@link parseXmlInNode} is the Node implementation — namespace-aware, because
 * `docs/02` §7.5 note 1 makes namespaces mandatory and every lookup in the
 * mapper is by `(namespaceURI, localName)`. As Gecko does, it reports a parse
 * failure as a `<parsererror>` document and an undeclared prefix as a failure.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/arxiv",
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

/**
 * §12.2's example as this renderer spells it: the document's operators and
 * prefixes (`AND`, `OR`, `ANDNOT`, `ti:`, `all:`, `%22…%22`), with the two
 * unfielded phrases under `all:` rather than the document's `abs:` (no rule
 * is given for that split) and the grouping made explicit (the document
 * writes none; §7.2 states no precedence). Asserted exactly.
 */
const EXAMPLE_RENDERED =
  '((all:"base editing" OR all:"prime editing") AND ti:CRISPR) ANDNOT all:mouse';
const EXAMPLE_WITH_WINDOW = `(${EXAMPLE_RENDERED}) AND submittedDate:[202401010000 TO 202612312359]`;
const EXAMPLE_ENCODED =
  "%28%28all:%22base+editing%22+OR+all:%22prime+editing%22%29+AND+ti:CRISPR%29" +
  "+ANDNOT+all:mouse";

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
  headers: Readonly<Record<string, string>> = {
    "content-type": "application/atom+xml; charset=utf-8",
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

/** The feed envelope of `docs/02` §7.4 around hand-built entries. */
function feed(
  entries: readonly string[],
  totals: { total?: number; start?: number; perPage?: number } = {},
): string {
  const total = totals.total ?? entries.length;
  return (
    `<?xml version='1.0' encoding='UTF-8'?>\n` +
    `<feed xmlns:opensearch="${OPENSEARCH_NS}" xmlns:arxiv="${ARXIV_NS}" xmlns="${ATOM_NS}">\n` +
    `  <id>https://arxiv.org/api/test</id>\n` +
    `  <title>arXiv Query: test</title>\n` +
    `  <updated>2026-09-08T07:30:02Z</updated>\n` +
    `  <opensearch:itemsPerPage>${String(totals.perPage ?? entries.length)}</opensearch:itemsPerPage>\n` +
    `  <opensearch:totalResults>${String(total)}</opensearch:totalResults>\n` +
    `  <opensearch:startIndex>${String(totals.start ?? 0)}</opensearch:startIndex>\n` +
    entries.join("\n") +
    `\n</feed>`
  );
}

/** A minimal entry: `<id>`, `<title>`, one author, `<published>`. */
function entry(id: string, extra = "", title = `Paper ${id}`): string {
  return (
    `  <entry>\n    <id>http://arxiv.org/abs/${id}</id>\n` +
    `    <title>${title}</title>\n` +
    `    <updated>2026-09-04T02:40:47Z</updated>\n` +
    `    <published>2026-09-04T02:40:47Z</published>\n` +
    `    <author><name>Ada Lovelace</name></author>\n${extra}\n  </entry>`
  );
}

/** `docs/02` §7.4's own sample entry, verbatim. */
const SAMPLE_ENTRY = `  <entry>
    <id>http://arxiv.org/abs/2609.04658v1</id>
    <title>VizIt: A multi-view framework for exploring single-cell, spatial, and genetic data online</title>
    <updated>2026-09-04T02:40:47Z</updated>
    <published>2026-09-04T02:40:47Z</published>
    <link href="https://arxiv.org/abs/2609.04658v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2609.04658v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>Multi-omic studies increasingly require data to be examined from complementary
      biological perspectives, yet interactive exploration remains fragmented across modalities
      and tools. We present VizIt, an open-source framework for multi-view exploration of
      single-cell and spatial transcriptomic, epigenomic and genetic data. ...</summary>
    <category term="cs.IR" scheme="http://arxiv.org/schemas/atom"/>
    <category term="q-bio.GN" scheme="http://arxiv.org/schemas/atom"/>
    <arxiv:primary_category term="cs.IR"/>
    <author><name>Chenhang Christopher Zhang</name></author>
    <author><name>Yanqing Lou</name></author>
    <author><name>Xianjun Dong</name></author>
  </entry>`;

/** `docs/02` §7.5 note 6's error feed, in the document's own spelling (HTTP 200). */
const ERROR_FEED_200 = feed(
  [
    `  <entry>\n    <id>${ARXIV_ERROR_FEED_ENTRY_ID}</id>\n    <title>Error</title>\n` +
      `    <updated>2026-10-14T16:36:26Z</updated>\n` +
      `    <summary>incorrect id format for not-an-arxiv-id</summary>\n` +
      `    <author><name>arXiv api core</name></author>\n  </entry>`,
  ],
  { total: 1, perPage: 1 },
);

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

/** An element node. Satisfies the mapper's {@link XmlElementLike} port. */
class TestElement implements XmlElementLike {
  readonly nodes: (TestElement | string)[] = [];
  constructor(
    readonly namespaceURI: string | null,
    readonly localName: string,
    readonly qname: string,
    private readonly attrs: ReadonlyMap<string, string>,
  ) {}
  get textContent(): string {
    return this.nodes
      .map((n) => (typeof n === "string" ? n : n.textContent))
      .join("");
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  get children(): XmlCollectionLike {
    const els = this.nodes.filter(
      (n): n is TestElement => typeof n !== "string",
    );
    return { length: els.length, item: (i) => els[i] ?? null };
  }
}

/** Mimic Gecko: a parse failure is a document, not an exception. */
function parserError(message: string): XmlDocumentLike {
  const el = new TestElement(null, "parsererror", "parsererror", new Map());
  el.nodes.push(message);
  return { documentElement: el };
}

/**
 * Parse XML well enough for an arXiv Atom feed: declarations, comments,
 * CDATA, attributes, self-closing tags, mixed content, character references
 * — and **namespaces**: a default `xmlns` and `xmlns:prefix` declarations in
 * scope give every element its `namespaceURI`, and an undeclared prefix is a
 * `<parsererror>`, as Gecko reports it. Anything else malformed is a
 * `<parsererror>` too.
 */
export function parseXmlInNode(xml: string): XmlDocumentLike {
  const stack: { node: TestElement; ns: ReadonlyMap<string, string> }[] = [];
  let root: TestElement | null = null;
  let i = 0;
  const scope = (): ReadonlyMap<string, string> =>
    stack[stack.length - 1]?.ns ?? new Map<string, string>();
  const append = (node: TestElement | string): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      if (typeof node === "string") {
        if (node.trim() !== "") throw new Error("text outside the root");
        return;
      }
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
        append(xml.slice(i + 9, end));
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
        if (top === undefined || top.node.qname !== name) {
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
        const attrs = new Map<string, string>();
        const ns = new Map(scope());
        const attrRe = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/gu;
        for (const a of (match[2] ?? "").matchAll(attrRe)) {
          const aname = a[1] ?? "";
          const avalue = decode(a[3] ?? a[4] ?? "");
          if (aname === "xmlns") ns.set("", avalue);
          else if (aname.startsWith("xmlns:")) ns.set(aname.slice(6), avalue);
          attrs.set(aname, avalue);
        }
        const colon = qname.indexOf(":");
        const prefix = colon === -1 ? "" : qname.slice(0, colon);
        const local = colon === -1 ? qname : qname.slice(colon + 1);
        if (prefix !== "" && prefix !== "xml" && !ns.has(prefix)) {
          throw new Error(`undeclared prefix ${prefix}`);
        }
        const uri =
          prefix === "" ? (ns.get("") ?? null) : (ns.get(prefix) ?? null);
        const node = new TestElement(uri, local, qname, attrs);
        append(node);
        if (!selfClosing) stack.push({ node, ns });
        i = end + 1;
        continue;
      }
      const next = xml.indexOf("<", i);
      const textEnd = next === -1 ? xml.length : next;
      append(decode(xml.slice(i, textEnd)));
      i = textEnd;
    }
    if (stack.length > 0) throw new Error("unclosed element");
    if (root === null) throw new Error("no root element");
    return { documentElement: root };
  } catch (error) {
    return parserError(error instanceof Error ? error.message : String(error));
  }
}

/** The `<entry>` elements of a hand-built feed, through the Node parser. */
function entriesOf(xml: string): readonly XmlElementLike[] {
  const root = parseXmlInNode(xml).documentElement;
  if (root === null) throw new Error("no root");
  return childrenNS(root, ATOM_NS, "entry");
}

function mapper(overrides: { keepRaw?: boolean; logger?: Logger } = {}) {
  return createArxivRecordMapper({
    clock: createManualClock(NOW),
    ...overrides,
  });
}

/** Map hand-built entries straight through the shipped mapper. */
function mapped(
  xml: string,
  overrides?: { keepRaw?: boolean; logger?: Logger },
) {
  return mapper(overrides)(entriesOf(xml));
}

function createSource(
  client: HttpClient,
  overrides: Partial<ArxivSourceDeps> = {},
) {
  const clock = createManualClock(NOW);
  return createArxivSource({
    http: client,
    clock,
    mapRecords: mapper(),
    parseXml: parseXmlInNode,
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

// ---------------------------------------------------------------------------
// 1. The renderer — docs/02 §12.2's arXiv block and §12.3's column
// ---------------------------------------------------------------------------

describe("renderArxivQuery — docs/02 §12.2's arXiv block", () => {
  it("renders §12.2's example with ANDNOT, not NOT, asserted exactly", () => {
    const rendered = renderArxivQuery(parseUserQuery(EXAMPLE_INPUT));
    expect(rendered).toBe(EXAMPLE_RENDERED);
    expect(rendered).toContain(" ANDNOT ");
    expect(rendered).not.toMatch(/(?<!AND)NOT/u);
  });

  it("Title field: ti:", () => {
    expect(renderArxivQuery(term("CRISPR", "title"))).toBe("ti:CRISPR");
  });

  it("Abstract: abs:", () => {
    expect(renderArxivQuery(term("neurons", "abstract"))).toBe("abs:neurons");
  });

  it("Author: au:", () => {
    expect(renderArxivQuery(term("Doudna", "author"))).toBe("au:Doudna");
  });

  it("Journal: jr: (§7.2's journal reference prefix)", () => {
    expect(renderArxivQuery(term("Nature", "journal"))).toBe("jr:Nature");
  });

  it("no field, or any: all: (§7.2's 'any of the above')", () => {
    expect(renderArxivQuery(term("mouse"))).toBe("all:mouse");
    expect(renderArxivQuery(term("mouse", "any"))).toBe("all:mouse");
  });

  it("titleOrAbstract has no prefix of its own and renders as the disjunction it names", () => {
    expect(renderArxivQuery(term("x", "titleOrAbstract"))).toBe(
      "(ti:x OR abs:x)",
    );
    expect(
      renderArxivQuery(term("base editing", "titleOrAbstract", true)),
    ).toBe('(ti:"base editing" OR abs:"base editing")');
  });

  it("affiliation and meshTerm have no arXiv prefix and fall to all:", () => {
    expect(renderArxivQuery(term("MIT", "affiliation"))).toBe("all:MIT");
    expect(renderArxivQuery(term("Neoplasms", "meshTerm"))).toBe(
      "all:Neoplasms",
    );
  });

  it('Phrase: "…" — and any value with whitespace is quoted, phrase or not', () => {
    expect(renderArxivQuery(term("base editing", undefined, true))).toBe(
      'all:"base editing"',
    );
    expect(renderArxivQuery(term("base editing", "title"))).toBe(
      'ti:"base editing"',
    );
    expect(renderArxivQuery(term("CRISPR", "title", true))).toBe("ti:CRISPR");
  });

  it("AND and OR: uppercase, parenthesised when more than one operand", () => {
    expect(renderArxivQuery(and(term("a"), term("b"), term("c")))).toBe(
      "(all:a AND all:b AND all:c)",
    );
    expect(renderArxivQuery(or(term("a"), term("b")))).toBe("(all:a OR all:b)");
    expect(renderArxivQuery(and(term("a")))).toBe("all:a");
    expect(renderArxivQuery(or(term("a")))).toBe("all:a");
  });

  it("NOT: ANDNOT after the positive children; several exclusions become one OR group", () => {
    expect(renderArxivQuery(and(term("a"), not(term("b"))))).toBe(
      "all:a ANDNOT all:b",
    );
    expect(
      renderArxivQuery(
        and(term("a"), not(term("b")), term("c"), not(term("d", "title"))),
      ),
    ).toBe("(all:a AND all:c) ANDNOT (all:b OR ti:d)");
    expect(
      renderArxivQuery(and(term("a"), not(or(term("b"), term("c"))))),
    ).toBe("all:a ANDNOT (all:b OR all:c)");
  });

  it("refuses a NOT with nothing to subtract from, by name", () => {
    expect(() => renderArxivQuery(not(term("x")))).toThrow(/bare NOT/u);
    expect(() => renderArxivQuery(and(not(term("x"))))).toThrow(
      /only excludes/u,
    );
    expect(() => renderArxivQuery(or(term("a"), not(term("b"))))).toThrow(
      /NOT under OR/u,
    );
  });

  it("removes quotes and parentheses from a value and collapses whitespace", () => {
    expect(renderArxivQuery(term('say "hi" (now)', "title"))).toBe(
      'ti:"say hi now"',
    );
    expect(renderArxivQuery(term("  CRISPR  ", "title"))).toBe("ti:CRISPR");
  });

  it("renders nothing for a tree with nothing renderable, and skips such children", () => {
    expect(renderArxivQuery(term("   "))).toBe("");
    expect(renderArxivQuery(and(term('"'), term("kept")))).toBe("all:kept");
    expect(renderArxivQuery(and(term(" "), not(term(" "))))).toBe("");
    expect(renderArxivQuery(not(term("()")))).toBe("");
  });
});

describe("explainArxivQuery — the native rendering and the submittedDate window", () => {
  it("writes §12.2's example, window included, in YYYYMMDDTTTT GMT form", () => {
    expect(
      explainArxivQuery({
        terms: parseUserQuery(EXAMPLE_INPUT),
        ...EXAMPLE_WINDOW,
        limit: 20,
      }),
    ).toBe(EXAMPLE_WITH_WINDOW);
  });

  it("renders the window as docs/02 §7.3 writes it, without quotes", () => {
    expect(
      renderSubmittedDate({ terms: term("x"), ...EXAMPLE_WINDOW, limit: 1 }),
    ).toBe("submittedDate:[202401010000 TO 202612312359]");
    expect(
      explainArxivQuery({ terms: term("x"), ...EXAMPLE_WINDOW, limit: 1 }),
    ).toBe("all:x AND submittedDate:[202401010000 TO 202612312359]");
  });

  it("does not double-wrap a rendering that is already one group", () => {
    expect(
      explainArxivQuery({
        terms: and(term("a"), term("b")),
        ...EXAMPLE_WINDOW,
        limit: 1,
      }),
    ).toBe(
      "(all:a AND all:b) AND submittedDate:[202401010000 TO 202612312359]",
    );
    expect(
      explainArxivQuery({
        terms: and(term("a"), not(term("b"))),
        ...EXAMPLE_WINDOW,
        limit: 1,
      }),
    ).toBe(
      "(all:a ANDNOT all:b) AND submittedDate:[202401010000 TO 202612312359]",
    );
  });

  it("widens a year or month bound outward to whole days", () => {
    expect(
      explainArxivQuery({
        terms: term("x"),
        fromDate: "2024",
        toDate: "2026",
        limit: 1,
      }),
    ).toBe("all:x AND submittedDate:[202401010000 TO 202612312359]");
    expect(
      explainArxivQuery({
        terms: term("x"),
        fromDate: "2024-02",
        toDate: "2024-02",
        limit: 1,
      }),
    ).toBe("all:x AND submittedDate:[202402010000 TO 202402292359]");
  });

  it("omits the window when neither bound is set, and refuses a half-open or malformed one", () => {
    expect(explainArxivQuery({ terms: term("x"), limit: 1 })).toBe("all:x");
    expect(() =>
      explainArxivQuery({ terms: term("x"), fromDate: "2024", limit: 1 }),
    ).toThrow(/both date bounds or neither/u);
    expect(() =>
      explainArxivQuery({
        terms: term("x"),
        fromDate: "01/01/2024",
        toDate: "2024-12-31",
        limit: 1,
      }),
    ).toThrow(/YYYY, YYYY-MM or YYYY-MM-DD/u);
  });

  it("renders a window-only query when the tree is empty", () => {
    expect(
      explainArxivQuery({ terms: term('"'), ...EXAMPLE_WINDOW, limit: 1 }),
    ).toBe("submittedDate:[202401010000 TO 202612312359]");
  });

  it("refuses languages by name, accepts an empty list and openAccessOnly", () => {
    // `P2-T34`: the two answers live on `SourceCapabilities.filters` now.
    expect(ARXIV_FILTERS).toEqual({ languages: false, openAccess: true });
    expect(ARXIV_QUERY_FILTER_SUPPORT).toEqual({ raw: true });
    expect(() =>
      explainArxivQuery({ terms: term("x"), limit: 1, languages: ["en"] }),
    ).toThrow(/cannot express SourceQuery\.languages/u);
    expect(
      explainArxivQuery({ terms: term("x"), limit: 1, languages: [] }),
    ).toBe("all:x");
    expect(
      explainArxivQuery({ terms: term("x"), limit: 1, openAccessOnly: true }),
    ).toBe("all:x");
  });
});

describe("encodeSearchQuery — §12.2's percent-encoding table", () => {
  it('encodes ( ) " [ ] and the space as +, and keeps the prefix colon', () => {
    expect(encodeSearchQuery(EXAMPLE_RENDERED)).toBe(EXAMPLE_ENCODED);
    expect(
      encodeSearchQuery("submittedDate:[202401010000 TO 202612312359]"),
    ).toBe("submittedDate:%5B202401010000+TO+202612312359%5D");
    expect(encodeSearchQuery("ti:Schrödinger")).toBe("ti:Schr%C3%B6dinger");
  });
});

// ---------------------------------------------------------------------------
// 2. The request builder
// ---------------------------------------------------------------------------

describe("buildArxivQueryRequest", () => {
  it("emits the parameters in a fixed, fixture-hashable order", () => {
    const built = buildArxivQueryRequest({
      query: {
        terms: parseUserQuery(EXAMPLE_INPUT),
        ...EXAMPLE_WINDOW,
        limit: 20,
      },
      start: 0,
      maxResults: 20,
    });
    expect(built.method).toBe("GET");
    expect(built.endpointBaseUrl).toBe(ARXIV_QUERY_URL);
    expect(built.url).toBe(
      `${ARXIV_QUERY_URL}?search_query=${encodeSearchQuery(EXAMPLE_WITH_WINDOW)}` +
        `&start=0&max_results=20&sortBy=relevance&sortOrder=descending`,
    );
    expect(built.queryString.split("&").map((p) => p.split("=")[0])).toEqual([
      "search_query",
      "start",
      "max_results",
      "sortBy",
      "sortOrder",
    ]);
    expect(built.renderedQuery).toBe(EXAMPLE_WITH_WINDOW);
    expect(ARXIV_SORT_BY).toBe("relevance");
    expect(ARXIV_SORT_ORDER).toBe("descending");
  });

  it("has no credential and no contact parameter, so transmittedUrl is the URL itself", () => {
    const built = buildArxivQueryRequest({
      query: { terms: term("x"), limit: 1 },
      start: 3,
      maxResults: 3,
    });
    expect(built.transmittedUrl).toBe(built.url);
    expect(built.transmittedQuery).toBe(built.queryString);
    expect(built.url).not.toMatch(/mailto|email|api_key|suppakoko/u);
    expect(built.url).toContain("start=3&max_results=3");
  });

  it("refuses max_results outside docs/02 §7.2's 1 … 2000 and a start outside 0 … 29999", () => {
    const query: SourceQuery = { terms: term("x"), limit: 1 };
    expect(() =>
      buildArxivQueryRequest({ query, start: 0, maxResults: 0 }),
    ).toThrow(/max_results must be an integer in 1 … 2000/u);
    expect(() =>
      buildArxivQueryRequest({ query, start: 0, maxResults: 2001 }),
    ).toThrow(/max_results/u);
    expect(() =>
      buildArxivQueryRequest({ query, start: -1, maxResults: 1 }),
    ).toThrow(/start must be an integer in 0 … 29999/u);
    expect(() =>
      buildArxivQueryRequest({
        query,
        start: ARXIV_MAX_TOTAL_RESULTS,
        maxResults: 1,
      }),
    ).toThrow(/start/u);
    expect(() =>
      buildArxivQueryRequest({ query, start: 1.5, maxResults: 1 }),
    ).toThrow(/start/u);
  });

  it("refuses a query that renders to nothing before it costs a slot", () => {
    expect(() =>
      buildArxivQueryRequest({
        query: { terms: term('"'), limit: 1 },
        start: 0,
        maxResults: 1,
      }),
    ).toThrow(/renders to nothing/u);
  });

  it("appends raw parameters sorted by key, allows id_list, and refuses every emitted name", () => {
    const built = buildArxivQueryRequest({
      query: {
        terms: term("x"),
        limit: 1,
        raw: { id_list: "1907.10121", zeta: true, alpha: 2 },
      },
      start: 0,
      maxResults: 1,
    });
    expect(built.queryString).toBe(
      "search_query=all:x&start=0&max_results=1&sortBy=relevance" +
        "&sortOrder=descending&alpha=2&id_list=1907.10121&zeta=true",
    );
    expect([...RESERVED_RAW_PARAMS].sort()).toEqual([
      "max_results",
      "search_query",
      "sortBy",
      "sortOrder",
      "start",
    ]);
    for (const key of RESERVED_RAW_PARAMS) {
      expect(() =>
        buildArxivQueryRequest({
          query: { terms: term("x"), limit: 1, raw: { [key]: "y" } },
          start: 0,
          maxResults: 1,
        }),
      ).toThrow(new RegExp(`raw\\.${key} is reserved on arXiv`, "u"));
    }
  });

  it("round-trips a diacritic, `&`, `+` and `#` through a real URL parse", () => {
    const built = buildArxivQueryRequest({
      query: { terms: term("Schrödinger & cats + #1", "title"), limit: 1 },
      start: 0,
      maxResults: 1,
    });
    expect(new URL(built.url).searchParams.get("search_query")).toBe(
      'ti:"Schrödinger & cats + #1"',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Capabilities and the lossiness notice
// ---------------------------------------------------------------------------

describe("ARXIV_CAPABILITIES", () => {
  it("declares the card's step 9 values", () => {
    expect(ARXIV_CAPABILITIES).toEqual({
      keywordSearch: true,
      query: {
        or: true,
        not: true,
        phrase: true,
        fields: ["title", "abstract", "titleOrAbstract", "author", "journal"],
      },
      relatedByWork: false,
      lookupById: [],
      abstractsInSearch: true,
      citationGraph: false,
      dateFilter: true,
      filters: { languages: false, openAccess: true },
      maxPageSize: 2000,
      maxTotalResults: 30000,
      benefitsFromApiKey: false,
    });
    expect(ARXIV_CAPABILITIES.query.fields).toBe(ARXIV_RENDERED_FIELDS);
    expect(ARXIV_CAPABILITIES.maxPageSize).toBe(ARXIV_MAX_RESULTS_MAX);
  });

  it("renders §12.2's example without loss, and reports only affiliation and meshTerm", () => {
    expect(
      normalizeForSource(parseUserQuery(EXAMPLE_INPUT), ARXIV_CAPABILITIES),
    ).toEqual([]);
    const lost = normalizeForSource(
      and(
        term("MIT", "affiliation"),
        term("x", "title"),
        term("y", "meshTerm"),
      ),
      ARXIV_CAPABILITIES,
    );
    expect(lost.map((n) => (n.kind === "term" ? n.field : n.kind))).toEqual([
      "affiliation",
      "meshTerm",
    ]);
  });

  it("names the display key by the one convention the corpus has, source-<id>", () => {
    expect(ARXIV_DISPLAY_NAME_KEY).toBe(
      `research-helper-source-${ARXIV_SOURCE_ID}`,
    );
  });
});

describe("lossinessWarnings", () => {
  it("is silent for a faithfully rendered query", () => {
    expect(lossinessWarnings(parseUserQuery(EXAMPLE_INPUT))).toEqual([]);
    expect(
      lossinessWarnings(
        and(term("x", "journal"), term("y", "titleOrAbstract")),
      ),
    ).toEqual([]);
  });

  it("names every field with no arXiv prefix, once", () => {
    const [warning, ...rest] = lossinessWarnings(
      and(
        term("MIT", "affiliation"),
        term("Harvard", "affiliation"),
        term("y", "meshTerm"),
      ),
    );
    expect(rest).toEqual([]);
    expect(warning).toContain(ARXIV_APPROXIMATE_PREFIX);
    expect(warning).toContain("affiliation:, meshTerm:");
    expect(warning).toContain("all:");
  });
});

// ---------------------------------------------------------------------------
// 4. The export.arxiv.org policy row, read back from docs/07 §7.3
// ---------------------------------------------------------------------------

describe("hostLimiter: the export.arxiv.org row", () => {
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

  it("is 0.33/s, burst 1, max concurrent 1 with minIntervalMs 3000, exactly as §7.3 writes it", () => {
    expect(ARXIV_HOST).toBe("export.arxiv.org");
    const row = section73Row(ARXIV_HOST);
    const rate = must(row["Rate"], "the Rate cell");
    const concurrent = must(row["Max concurrent"], "the Max concurrent cell");
    expect(rate).toBe("0.33/s");
    expect(row["Burst"]).toBe("1");
    // §7.3 bolds this cell (`**1**`) because it is the one that matters.
    expect(concurrent.replace(/\*/gu, "")).toBe("1");
    expect(row["Basis"]).toMatch(/minIntervalMs: 3000/u);
    const policy = HOST_POLICIES.find((p) => p.host === ARXIV_HOST);
    expect(policy).toBeDefined();
    expect(policy?.withoutKey).toEqual({
      ratePerSecond: Number(rate.replace("/s", "")),
      burst: Number(row["Burst"]),
      maxConcurrent: Number(concurrent.replace(/\*/gu, "")),
      minIntervalMs: 3000,
    });
    expect(policy?.headerDriven).toBeUndefined();
    expect(policy?.withKey).toBeUndefined();
    expect(policy?.keyPresencePref).toBeUndefined();
  });

  it("carries the retry budget §7.3's three cells state, read from the document", () => {
    const row = section73Row(ARXIV_HOST);
    const ms = (cell: string | undefined): number =>
      Number((cell ?? "").replace(/\s/g, "").replace("ms", ""));
    const retry = HOST_POLICIES.find((p) => p.host === ARXIV_HOST)?.retry;
    expect(retry).toEqual({
      baseMs: ms(row["Retry base"]),
      capMs: ms(row["Retry cap"]),
      maxAttempts: Number(row["Attempt cap"]),
    });
    expect(retry).toEqual({ baseMs: 3000, capMs: 30_000, maxAttempts: 3 });
  });

  it("is served by the registry as its own bucket, in table order after Crossref", () => {
    const registry = createHostLimiterRegistry({
      clock: createManualClock(NOW),
    });
    // Not a pin on the whole list: `tokenBucket.test.ts`'s `shippedHosts` and
    // `container.test.ts` own that expectation and grow by one per adapter
    // card; a pin here would go red the moment `P2-T05` or `P2-T07` lands,
    // as `crossref.test.ts`'s did when this row shipped.
    expect(registry.hosts).toContain(ARXIV_HOST);
    expect(registry.hosts.indexOf(ARXIV_HOST)).toBe(
      registry.hosts.indexOf(CROSSREF_HOST) + 1,
    );
    expect(registry.hosts.slice(0, 3)).toEqual([
      NCBI_HOST,
      EBI_HOST,
      CROSSREF_HOST,
    ]);
    expect(registry.limiterFor(ARXIV_HOST)).toBeDefined();
    expect(registry.limiterFor(ARXIV_HOST)).not.toBe(
      registry.limiterFor(CROSSREF_HOST),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. The mapper — identity helpers and hand-built entries
// ---------------------------------------------------------------------------

describe("parseArxivEntryId, arxivArchiveId and arxivDataCiteDoi — docs/02 §7.5 notes 4 and 5", () => {
  it("splits http://arxiv.org/abs/2609.04658v1 into the versioned and the unversioned id", () => {
    expect(parseArxivEntryId("http://arxiv.org/abs/2609.04658v1")).toEqual({
      versioned: "2609.04658v1",
      unversioned: "2609.04658",
      version: 1,
    });
    expect(
      parseArxivEntryId("https://arxiv.org/abs/quant-ph/9509021v1"),
    ).toEqual({
      versioned: "quant-ph/9509021v1",
      unversioned: "quant-ph/9509021",
      version: 1,
    });
    expect(parseArxivEntryId("1711.11416v31")?.version).toBe(31);
    expect(
      parseArxivEntryId("http://arxiv.org/abs/2609.04658")?.version,
    ).toBeUndefined();
  });

  it("rejects text that is not an arXiv id", () => {
    expect(parseArxivEntryId(undefined)).toBeUndefined();
    expect(parseArxivEntryId("")).toBeUndefined();
    expect(parseArxivEntryId("https://arxiv.org/api/errors")).toBeUndefined();
    expect(parseArxivEntryId("not an id")).toBeUndefined();
  });

  it("spells the archiveID value with the version kept, and the DataCite DOI without it", () => {
    expect(arxivArchiveId("2609.04658v1")).toBe("arXiv:2609.04658v1");
    expect(ARXIV_ARCHIVE_ID_PREFIX).toBe("arXiv:");
    expect(arxivDataCiteDoi("2609.04658")).toBe("10.48550/arxiv.2609.04658");
    expect(arxivDataCiteDoi("quant-ph/9509021")).toBe(
      "10.48550/arxiv.quant-ph/9509021",
    );
    expect(arxivDataCiteDoi("")).toBeNull();
    expect(arxivDataCiteDoi("  ")).toBeNull();
  });
});

describe("readAtomDate, splitAuthorName, normalizeWhitespace", () => {
  it("reads an RFC 3339 instant at day precision and nothing else", () => {
    expect(readAtomDate("2026-09-04T02:40:47Z")).toEqual({
      year: 2026,
      month: 9,
      day: 4,
      iso: "2026-09-04",
    });
    expect(readAtomDate("2026-09-04")).toEqual({
      year: 2026,
      month: 9,
      day: 4,
      iso: "2026-09-04",
    });
    expect(readAtomDate("2026-13-04T00:00:00Z")).toBeUndefined();
    expect(readAtomDate("Sept 2026")).toBeUndefined();
    expect(readAtomDate(undefined)).toBeUndefined();
  });

  it("splits a name on the last space; a one-token name is family only", () => {
    expect(splitAuthorName("Chenhang Christopher Zhang")).toEqual({
      family: "Zhang",
      given: "Chenhang Christopher",
    });
    expect(splitAuthorName("Plato")).toEqual({
      family: "Plato",
      given: undefined,
    });
  });

  it("collapses every run of whitespace to one space and trims", () => {
    expect(normalizeWhitespace("  a\n      b\t c  ")).toBe("a b c");
  });
});

describe("mapper: docs/02 §7.4's own sample entry", () => {
  it("maps every field of the sample as §10.2's arXiv column prescribes", () => {
    const [record, ...rest] = mapped(feed([SAMPLE_ENTRY], { total: 927 }));
    expect(rest).toEqual([]);
    const r = must(record, "the sample record");
    expect(r.id).toBe("arxiv:2609.04658v1");
    expect(r.sourceId).toBe("arxiv");
    expect(r.nativeId).toBe("2609.04658v1");
    expect(arxivArchiveId(r.nativeId)).toBe("arXiv:2609.04658v1");
    expect(r.work.ids).toEqual({
      doi: "10.48550/arxiv.2609.04658",
      arxivId: "2609.04658",
    });
    expect(r.work.type).toBe("preprint");
    expect(r.work.title).toBe(
      "VizIt: A multi-view framework for exploring single-cell, spatial, and genetic data online",
    );
    expect(r.work.abstract).toBe(
      "Multi-omic studies increasingly require data to be examined from complementary " +
        "biological perspectives, yet interactive exploration remains fragmented across " +
        "modalities and tools. We present VizIt, an open-source framework for multi-view " +
        "exploration of single-cell and spatial transcriptomic, epigenomic and genetic data. ...",
    );
    expect(r.work.abstract).not.toMatch(/\s{2}|\n/u);
    expect(r.work.authors).toEqual([
      { family: "Zhang", given: "Chenhang Christopher", sequence: 0 },
      { family: "Lou", given: "Yanqing", sequence: 1 },
      { family: "Dong", given: "Xianjun", sequence: 2 },
    ]);
    expect(r.work.containerTitle).toBe(ARXIV_REPOSITORY_NAME);
    expect(r.work.containerTitle).toBe("arXiv");
    expect(r.work.publishedDate).toEqual({
      year: 2026,
      month: 9,
      day: 4,
      iso: "2026-09-04",
    });
    expect(r.work.language).toBe("en");
    expect(r.work.subjects).toEqual([
      { term: "cs.IR", scheme: ARXIV_CATEGORY_SCHEME },
      { term: "q-bio.GN", scheme: "arxiv-category" },
    ]);
    expect(r.work.openAccess).toEqual({
      isOpenAccess: true,
      pdfUrl: "https://arxiv.org/pdf/2609.04658v1",
    });
    expect(r.work.url).toBe("https://arxiv.org/abs/2609.04658v1");
    expect(r.work.relatedVersionIds).toBeUndefined();
    expect(r.retrievedAtEpochMs).toBe(NOW);
    expect(r.raw).toBeUndefined();
    expect(r.missingFields).toEqual([]);
  });

  it("keeps the parsed <entry> as raw only when asked", () => {
    const [record] = mapped(feed([SAMPLE_ENTRY]), { keepRaw: true });
    const raw = must(record, "record").raw as XmlElementLike;
    expect(raw.localName).toBe("entry");
    expect(raw.namespaceURI).toBe(ATOM_NS);
  });
});

describe("mapper: hand-built edge cases", () => {
  it("maps a hard-wrapped <summary> and <title> to single-spaced text (criterion 3)", () => {
    const xml = feed([
      `  <entry>\n    <id>http://arxiv.org/abs/2301.00001v2</id>\n` +
        `    <title>A very long title that\n      wraps onto a second\n      line</title>\n` +
        `    <summary>  First line of the abstract\n      second line, indented\n\n      third line.  </summary>\n` +
        `    <published>2023-01-01T00:00:00Z</published>\n  </entry>`,
    ]);
    const [record] = mapped(xml);
    expect(record?.work.title).toBe(
      "A very long title that wraps onto a second line",
    );
    expect(record?.work.abstract).toBe(
      "First line of the abstract second line, indented third line.",
    );
  });

  it("maps 2609.04658v1 to arxivId 2609.04658 and an archiveID value of arXiv:2609.04658v1 (criterion 4)", () => {
    const [record] = mapped(feed([entry("2609.04658v1")]));
    const r = must(record, "record");
    expect(r.work.ids.arxivId).toBe("2609.04658");
    expect(r.nativeId).toBe("2609.04658v1");
    expect(arxivArchiveId(r.nativeId)).toBe("arXiv:2609.04658v1");
  });

  it("treats <arxiv:doi> as the journal DOI: relatedVersionIds, never ids.doi (criterion 5)", () => {
    const [record] = mapped(
      feed([
        entry(
          "1907.10121v1",
          `    <arxiv:doi>10.1038/s41592-019-0686-2</arxiv:doi>\n` +
            `    <arxiv:journal_ref>Nature Methods 17, 261-272 (2020)</arxiv:journal_ref>`,
        ),
      ]),
    );
    const r = must(record, "record");
    expect(r.work.relatedVersionIds).toEqual({
      doi: "10.1038/s41592-019-0686-2",
    });
    expect(r.work.ids.doi).toBe("10.48550/arxiv.1907.10121");
    expect(r.work.ids.doi).not.toBe("10.1038/s41592-019-0686-2");
    expect(r.work.type).toBe("preprint");
  });

  it("warns about an <arxiv:doi> that is not a DOI and sets no related version", () => {
    const spy = createSpyLogger();
    const [record] = mapped(
      feed([entry("1907.10121v1", `    <arxiv:doi>not a doi</arxiv:doi>`)]),
      { logger: spy.logger },
    );
    expect(record?.work.relatedVersionIds).toBeUndefined();
    expect(spy.lines.some((l) => l.includes("<arxiv:doi> is not a DOI"))).toBe(
      true,
    );
  });

  it("keeps the primary category first and every term once, and maps affiliations", () => {
    const [record] = mapped(
      feed([
        `  <entry>\n    <id>http://arxiv.org/abs/2301.00002v1</id>\n    <title>T</title>\n` +
          `    <published>2023-01-01T00:00:00Z</published>\n` +
          `    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>\n` +
          `    <category term="q-bio.QM" scheme="http://arxiv.org/schemas/atom"/>\n` +
          `    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>\n` +
          `    <arxiv:primary_category term="q-bio.QM"/>\n` +
          `    <author>\n      <name>Léa Ingrassia</name>\n      <arxiv:affiliation>SU</arxiv:affiliation>\n` +
          `      <arxiv:affiliation>ICM</arxiv:affiliation>\n    </author>\n  </entry>`,
      ]),
    );
    expect(record?.work.subjects?.map((s) => s.term)).toEqual([
      "q-bio.QM",
      "cs.LG",
    ]);
    expect(record?.work.authors).toEqual([
      {
        family: "Ingrassia",
        given: "Léa",
        affiliations: ["SU", "ICM"],
        sequence: 0,
      },
    ]);
  });

  it("drops an entry with no usable <id>, with a warning, and keeps the others", () => {
    const spy = createSpyLogger();
    const records = mapped(
      feed([
        `  <entry>\n    <id>https://arxiv.org/api/weird</id>\n    <title>No id</title>\n  </entry>`,
        entry("2301.00003v1"),
      ]),
      { logger: spy.logger },
    );
    expect(records.map((r) => r.nativeId)).toEqual(["2301.00003v1"]);
    expect(spy.lines.some((l) => l.includes("no usable <id>"))).toBe(true);
  });

  it("P2-T34: brands an old-style id with a dotted subject class, which §11.3.1 accepts since 2026-10-15 (plan/00 §6 item 91)", () => {
    const spy = createSpyLogger();
    const [record] = mapped(feed([entry("cond-mat.mes-hall/0309136v1")]), {
      logger: spy.logger,
    });
    const r = must(record, "record");
    expect(r.nativeId).toBe("cond-mat.mes-hall/0309136v1");
    expect(r.work.ids).toEqual({
      doi: "10.48550/arxiv.cond-mat.mes-hall/0309136",
      arxivId: "cond-mat.mes-hall/0309136",
    });
    expect(r.missingFields).not.toContain("ids.arxivId");
    expect(
      spy.lines.some((l) => l.includes("not a docs/02 §11.3.1 arXiv id shape")),
    ).toBe(false);
  });

  it("ships a record for an id §11.3.1's regex rejects, keyed by its DOI, with arxivId missing", () => {
    // An upper-case archive is outside `[a-z-]+`, so the shape still refuses
    // it — the branch the dotted subject class used to reach before P2-T34.
    const spy = createSpyLogger();
    const [record] = mapped(feed([entry("COND-MAT/0309136v1")]), {
      logger: spy.logger,
    });
    const r = must(record, "record");
    expect(r.nativeId).toBe("COND-MAT/0309136v1");
    expect(r.work.ids.arxivId).toBeUndefined();
    expect(r.missingFields).toContain("ids.arxivId");
    expect(
      spy.lines.some(
        (l) =>
          l.includes("not a docs/02 §11.3.1 arXiv id shape") &&
          l.includes("COND-MAT/0309136"),
      ),
    ).toBe(true);
    // The shapes §11.3.1 does accept are branded as before.
    const [old] = mapped(feed([entry("quant-ph/9509021v1")]));
    expect(old?.work.ids.arxivId).toBe("quant-ph/9509021");
  });

  it("reports what is absent in missingFields, and nothing for the constants", () => {
    const [record] = mapped(
      feed([
        `  <entry>\n    <id>http://arxiv.org/abs/2301.00004v1</id>\n  </entry>`,
      ]),
    );
    const r = must(record, "record");
    expect(r.work.title).toBe("");
    expect(r.work.url).toBe("http://arxiv.org/abs/2301.00004v1");
    expect(r.missingFields).toEqual([
      "title",
      "abstract",
      "authors",
      "publishedDate",
      "subjects",
      "openAccess",
    ]);
    expect(ARXIV_MAPPABLE_FIELDS).not.toContain("type");
    expect(ARXIV_MAPPABLE_FIELDS).not.toContain("relatedVersionIds");
  });

  it("maps a 50+ author entry in order (docs/07 §11.1 step 6)", () => {
    const authors = Array.from(
      { length: 60 },
      (_u, i) =>
        `    <author><name>Given${String(i)} Family${String(i)}</name></author>`,
    ).join("\n");
    const [record] = mapped(feed([entry("2301.00005v1", authors)]));
    expect(record?.work.authors).toHaveLength(61);
    expect(record?.work.authors[60]).toEqual({
      family: "Family59",
      given: "Given59",
      sequence: 60,
    });
  });

  it("looks up children by namespace: an <entry> outside the Atom namespace is not an entry", () => {
    const root = parseXmlInNode(
      `<feed xmlns="${ATOM_NS}" xmlns:x="urn:other"><x:entry><x:id>a</x:id></x:entry>` +
        `<entry><id>http://arxiv.org/abs/2301.00006v1</id></entry></feed>`,
    ).documentElement;
    expect(
      childrenNS(must(root ?? undefined, "root"), ATOM_NS, "entry"),
    ).toHaveLength(1);
    expect(mapEntry).toBeTypeOf("function");
  });
});

// ---------------------------------------------------------------------------
// 6. The feed parse, the error feed, and paging
// ---------------------------------------------------------------------------

describe("parseArxivFeedBody", () => {
  it("returns the entries and the three OpenSearch totals", () => {
    const result = parseArxivFeedBody(
      feed([SAMPLE_ENTRY], { total: 927, start: 0, perPage: 1 }),
      parseXmlInNode,
      "u",
    );
    expect(result.entries).toHaveLength(1);
    expect(result.totalResults).toBe(927);
    expect(result.startIndex).toBe(0);
    expect(result.itemsPerPage).toBe(1);
  });

  it("treats totalResults 0 with no entries as a normal empty result (§7.5 note 7)", () => {
    const result = parseArxivFeedBody(
      feed([], { total: 0, perPage: 20 }),
      parseXmlInNode,
      "u",
    );
    expect(result.entries).toEqual([]);
    expect(result.totalResults).toBe(0);
  });

  it("turns the error feed into a SourceError carrying arXiv's summary (§7.5 note 6)", () => {
    expect(() =>
      parseArxivFeedBody(ERROR_FEED_200, parseXmlInNode, "u"),
    ).toThrow(SourceError);
    try {
      parseArxivFeedBody(ERROR_FEED_200, parseXmlInNode, "u");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceError);
      expect(error).not.toBeInstanceOf(ParseError);
      expect((error as SourceError).message).toContain(
        "incorrect id format for not-an-arxiv-id",
      );
      expect((error as SourceError).context).toMatchObject({
        sourceId: "arxiv",
        upstreamError: "incorrect id format for not-an-arxiv-id",
        upstreamTitle: "Error",
        url: "u",
      });
      expect((error as SourceError).cause).toBeUndefined();
    }
    // P2-T35: the optional `cause` reaches the SourceError and nothing else.
    const marker = new BadRequestError(400, "marker");
    expect(() =>
      parseArxivFeedBody(ERROR_FEED_200, parseXmlInNode, "u", {
        cause: marker,
      }),
    ).toThrow(SourceError);
    try {
      parseArxivFeedBody(ERROR_FEED_200, parseXmlInNode, "u", {
        cause: marker,
      });
    } catch (error) {
      expect((error as SourceError).cause).toBe(marker);
    }
  });

  it("recognises the documented id and the measured https + fragment form", () => {
    expect(isErrorFeedEntryId("http://arxiv.org/api/errors")).toBe(true);
    expect(isErrorFeedEntryId("https://arxiv.org/api/errors")).toBe(true);
    expect(
      isErrorFeedEntryId(
        "https://arxiv.org/api/errors#incorrect_id_format_for_not-an-arxiv-id",
      ),
    ).toBe(true);
    // The documented scheme with a fragment: a parser that accepted the
    // fragment on one scheme only would miss half the forms (mutant M49).
    expect(isErrorFeedEntryId("http://arxiv.org/api/errors#bad_id")).toBe(true);
    expect(isErrorFeedEntryId("http://arxiv.org/abs/2609.04658v1")).toBe(false);
    expect(isErrorFeedEntryId("https://arxiv.org/api/errorsx")).toBe(false);
    expect(isErrorFeedEntryId(undefined)).toBe(false);
  });

  it("does not mistake a real single-entry page for the error feed", () => {
    const result = parseArxivFeedBody(
      feed([SAMPLE_ENTRY]),
      parseXmlInNode,
      "u",
    );
    expect(result.entries).toHaveLength(1);
  });

  it("throws ParseError for a body that is not XML, and for a root that is not an Atom feed", () => {
    expect(() =>
      parseArxivFeedBody("<feed><entry>", parseXmlInNode, "u"),
    ).toThrow(ParseError);
    expect(() =>
      parseArxivFeedBody("Rate exceeded.", parseXmlInNode, "u"),
    ).toThrow(ParseError);
    expect(() =>
      parseArxivFeedBody(
        `<feed xmlns="urn:not-atom"></feed>`,
        parseXmlInNode,
        "u",
      ),
    ).toThrow(/root is <feed> in namespace "urn:not-atom"/u);
    expect(() =>
      parseArxivFeedBody(`<html><body>oops</body></html>`, parseXmlInNode, "u"),
    ).toThrow(/root is <html>/u);
  });
});

describe("nextStartAfter, readStartCursor and clampMaxResults", () => {
  it("continues at start + page length, and stops on an empty or short page, the total, or the ceiling", () => {
    expect(nextStartAfter(0, 20, 20, 26)).toBe("20");
    expect(nextStartAfter(20, 6, 20, 26)).toBeUndefined();
    expect(nextStartAfter(0, 0, 20, 0)).toBeUndefined();
    expect(nextStartAfter(0, 20, 20, 20)).toBeUndefined();
    expect(nextStartAfter(0, 20, 20, undefined)).toBe("20");
    expect(nextStartAfter(28_000, 2000, 2000, 50_000)).toBeUndefined();
    expect(nextStartAfter(26_000, 2000, 2000, 50_000)).toBe("28000");
  });

  it("reads a decimal cursor as start and restarts at 0 for anything else", () => {
    expect(readStartCursor(undefined)).toBe(0);
    expect(readStartCursor("3")).toBe(3);
    expect(readStartCursor("abc")).toBe(0);
    expect(readStartCursor("-1")).toBe(0);
    expect(readStartCursor("99999")).toBe(29_999);
  });

  it("clamps limit to 1 … 2000 and to what is left below 30 000", () => {
    expect(clampMaxResults(0)).toBe(1);
    expect(clampMaxResults(20)).toBe(20);
    expect(clampMaxResults(5000)).toBe(2000);
    expect(clampMaxResults(Number.NaN)).toBe(1);
    expect(clampMaxResults(2000, 29_000)).toBe(1000);
    expect(clampMaxResults(50, 29_999)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. The adapter over a stub client
// ---------------------------------------------------------------------------

describe("createArxivSource — identity and requests", () => {
  it("reports its identity, its display key, its host and that it is always configured", () => {
    const source = createSource(
      createStubHttp((i) => response(i.url, feed([]))).client,
    );
    expect(source.id).toBe(ARXIV_SOURCE_ID);
    expect(source.displayNameKey).toBe("research-helper-source-arxiv");
    expect(source.rateLimitKey).toBe(ARXIV_HOST);
    expect(source.rateLimitKey).toBe("export.arxiv.org");
    expect(source.capabilities).toBe(ARXIV_CAPABILITIES);
    expect(source.isConfigured()).toBe(true);
    expect(source.explainQuery({ terms: term("x"), limit: 1 })).toBe("all:x");
  });

  it("P2-T34: capabilities.filters is the renderer's own object, and equals what the renderer does", () => {
    expect(ARXIV_CAPABILITIES.filters).toBe(ARXIV_FILTERS);
    const source = createSource(
      createStubHttp((i) => response(i.url, feed([]))).client,
    );
    const plain = { terms: term("x"), limit: 1 };
    expect(source.capabilities.filters).toEqual({
      languages: false,
      openAccess: true,
    });
    // languages: false → refused by name.
    expect(() => source.explainQuery({ ...plain, languages: ["en"] })).toThrow(
      "cannot express SourceQuery.languages",
    );
    // openAccess: true → honoured, and with no clause: every arXiv record is
    // open access, so the restriction narrows nothing (module header).
    expect(source.explainQuery({ ...plain, openAccessOnly: true })).toBe(
      source.explainQuery(plain),
    );
  });

  it("sends GET /api/query with start, max_results and the sort, as text, with no contact parameter", async () => {
    const { client, issued } = createStubHttp((i) => response(i.url, feed([])));
    const source = createSource(client);
    await source.search({ terms: term("x"), limit: 5 }, ctx());
    await source.search({ terms: term("x"), limit: 5, cursor: "10" }, ctx());
    expect(issued[0]?.method).toBe("GET");
    expect(issued[0]?.url.startsWith(`https://${ARXIV_HOST}/api/query?`)).toBe(
      true,
    );
    expect(issued[0]?.options?.responseType).toBe("text");
    expect(issued.map((i) => paramsOf(i).get("start"))).toEqual(["0", "10"]);
    for (const i of issued) {
      expect(paramsOf(i).get("max_results")).toBe("5");
      expect(paramsOf(i).get("sortBy")).toBe("relevance");
      expect(paramsOf(i).get("sortOrder")).toBe("descending");
      expect(paramsOf(i).has("mailto")).toBe(false);
      expect(paramsOf(i).has("email")).toBe(false);
    }
  });

  it("returns the mapped page, the server total and the next start, and stops on a short page", async () => {
    const { client } = createStubHttp((i, index) =>
      response(
        i.url,
        index === 0
          ? feed([entry("2301.00001v1"), entry("2301.00002v1")], { total: 50 })
          : feed([entry("2301.00003v1")], { total: 50 }),
      ),
    );
    const source = createSource(client);
    const full = await source.search({ terms: term("x"), limit: 2 }, ctx());
    expect(full.records.map((r) => r.nativeId)).toEqual([
      "2301.00001v1",
      "2301.00002v1",
    ]);
    expect(full.totalAvailable).toBe(50);
    expect(full.nextCursor).toBe("2");
    expect(full.warnings).toEqual([]);
    expect(full.sourceExtras).toEqual({
      totalResults: 50,
      startIndex: 0,
      itemsPerPage: 2,
      start: 0,
    });
    const short = await source.search(
      { terms: term("x"), limit: 2, cursor: "2" },
      ctx(),
    );
    expect(short.records).toHaveLength(1);
    expect(short.nextCursor).toBeUndefined();
    expect(short.sourceExtras.start).toBe(2);
  });

  it("returns an empty page for totalResults 0 and the error feed as a SourceError", async () => {
    const empty = createSource(
      createStubHttp((i) => response(i.url, feed([], { total: 0 }))).client,
    );
    const page = await empty.search({ terms: term("x"), limit: 20 }, ctx());
    expect(page.records).toEqual([]);
    expect(page.totalAvailable).toBe(0);
    expect(page.nextCursor).toBeUndefined();

    const erroring = createSource(
      createStubHttp((i) => response(i.url, ERROR_FEED_200)).client,
    );
    await expect(
      erroring.search({ terms: term("x"), limit: 1 }, ctx()),
    ).rejects.toThrow(SourceError);
  });

  it("carries the lossiness notice on the page and refuses an unrenderable query before any request", async () => {
    const { client, issued } = createStubHttp((i) => response(i.url, feed([])));
    const source = createSource(client);
    const page = await source.search(
      { terms: and(term("x"), term("MIT", "affiliation")), limit: 1 },
      ctx(),
    );
    expect(page.warnings).toHaveLength(1);
    expect(page.warnings[0]).toContain("affiliation:");
    await expect(
      source.search({ terms: not(term("x")), limit: 1 }, ctx()),
    ).rejects.toThrow(RangeError);
    await expect(
      source.search({ terms: term("x"), limit: 1, languages: ["en"] }, ctx()),
    ).rejects.toThrow(RangeError);
    expect(issued).toHaveLength(1);
  });

  it("honours cancellation before the request", async () => {
    const { client, issued } = createStubHttp((i) => response(i.url, feed([])));
    const source = createSource(client);
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });
    await expect(
      source.search({ terms: term("x"), limit: 1 }, { token: cts.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(issued).toHaveLength(0);
  });
});

describe("createArxivSource — searchAll", () => {
  it("pages by start until limit, raising the notice once and reporting progress", async () => {
    const warnings: string[] = [];
    const progress: [number, number | undefined][] = [];
    const { client, issued } = createStubHttp((i) => {
      const start = Number(paramsOf(i).get("start"));
      const n = Number(paramsOf(i).get("max_results"));
      const ids = Array.from({ length: n }, (_u, k) =>
        entry(`2301.${String(start + k + 1).padStart(5, "0")}v1`),
      );
      return response(i.url, feed(ids, { total: 100 }));
    });
    const source = createSource(client);
    const out: string[] = [];
    for await (const record of source.searchAll(
      { terms: and(term("x"), term("MIT", "affiliation")), limit: 5 },
      {
        token: createCancellationTokenSource().token,
        progress: {
          warn: (w: string) => warnings.push(w),
          setProgress: (done: number, total?: number) =>
            progress.push([done, total]),
        } as unknown as ProgressReporter,
      },
    )) {
      out.push(record.nativeId);
    }
    expect(out).toEqual([
      "2301.00001v1",
      "2301.00002v1",
      "2301.00003v1",
      "2301.00004v1",
      "2301.00005v1",
    ]);
    expect(issued.map((i) => paramsOf(i).get("start"))).toEqual(["0"]);
    expect(warnings).toHaveLength(1);
    expect(progress[progress.length - 1]).toEqual([5, 5]);
  });

  it("stops on a short page, and pages at docs/02 §7.2's 2000-record slices when the limit is larger", async () => {
    // A server with three matching records: a page asking for more than three
    // comes back short, and the loop ends without a second request.
    const three = createStubHttp((i) => {
      const n = Math.min(3, Number(paramsOf(i).get("max_results")));
      return response(
        i.url,
        feed(
          Array.from({ length: n }, (_u, k) =>
            entry(`2301.0000${String(k + 1)}v1`),
          ),
          { total: 3 },
        ),
      );
    });
    const out: string[] = [];
    for await (const record of createSource(three.client).searchAll(
      { terms: term("x"), limit: 10 },
      ctx(),
    )) {
      out.push(record.nativeId);
    }
    expect(out).toEqual(["2301.00001v1", "2301.00002v1", "2301.00003v1"]);
    expect(three.issued).toHaveLength(1);

    // A limit above one slice: the first page asks for 2000 at start 0 and
    // the second for the one remaining record at start 2000. Entries are
    // minimal so the stub stays cheap.
    const big = createStubHttp((i) => {
      const start = Number(paramsOf(i).get("start"));
      const n = Number(paramsOf(i).get("max_results"));
      const body = feed(
        Array.from(
          { length: n },
          (_u, k) =>
            `<entry><id>http://arxiv.org/abs/2301.${String(start + k + 1).padStart(5, "0")}v1</id></entry>`,
        ),
        { total: 5000 },
      );
      return response(i.url, body);
    });
    let count = 0;
    let last = "";
    const warned: string[] = [];
    for await (const record of createSource(big.client).searchAll(
      { terms: and(term("x"), term("MIT", "affiliation")), limit: 2001 },
      {
        token: createCancellationTokenSource().token,
        progress: {
          warn: (w: string) => warned.push(w),
          setProgress: () => undefined,
        } as unknown as ProgressReporter,
      },
    )) {
      count += 1;
      last = record.nativeId;
    }
    expect(count).toBe(2001);
    expect(last).toBe("2301.02001v1");
    // The notice is raised once, on the first page, not once per page.
    expect(warned).toHaveLength(1);
    expect(
      big.issued.map((i) => [
        paramsOf(i).get("start"),
        paramsOf(i).get("max_results"),
      ]),
    ).toEqual([
      ["0", "2000"],
      ["2000", "1"],
    ]);
  });
});

describe("createArxivSource — healthCheck", () => {
  it("is ok on a feed and never sends user content", async () => {
    const { client, issued } = createStubHttp((i) =>
      response(i.url, feed([SAMPLE_ENTRY], { total: 42 })),
    );
    const health = await createSource(client).healthCheck(ctx());
    expect(health).toEqual({
      ok: true,
      messageKey: ARXIV_DISPLAY_NAME_KEY,
      latencyMs: 0,
      quotaHint: "totalResults: 42",
    });
    expect(paramsOf(must(issued[0], "probe")).get("max_results")).toBe("1");
    expect(paramsOf(must(issued[0], "probe")).get("search_query")).toBe(
      "all:electron",
    );
  });

  it("reports the error's own message key when the probe fails, and rethrows a cancellation", async () => {
    const failed = await createSource(
      createStubHttp((i) => response(i.url, "<not>xml")).client,
    ).healthCheck(ctx());
    expect(failed.ok).toBe(false);
    expect(failed.messageKey).toBe("rh-error-parse");
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });
    await expect(
      createSource(
        createStubHttp((i) => response(i.url, feed([]))).client,
      ).healthCheck({
        token: cts.token,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

// ---------------------------------------------------------------------------
// 8. Through the shipped HTTP client: the 429 path and the three-second rule
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

/** A transport that answers every request with one canned exchange and records when. */
function cannedTransport(
  clock: ManualClock,
  exchange: { status: number; body: string; headers?: Record<string, string> },
): HttpTransport & { readonly startedAt: number[] } {
  const startedAt: number[] = [];
  return {
    startedAt,
    request() {
      startedAt.push(clock.now());
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

describe("createArxivSource through createHttpClient", () => {
  it("classifies arXiv's measured 429 — text/html, 'Rate exceeded.', no Retry-After — as a RateLimitError with no retryAfterMs", async () => {
    const clock = createManualClock(NOW);
    const transport = cannedTransport(clock, {
      status: 429,
      body: "Rate exceeded.",
      headers: { "content-type": "text/html", server: "Google Frontend" },
    });
    const client = createHttpClient({
      transport,
      userAgent: buildUserAgent("0.0.2"),
      clock,
    });
    const source = createSource(client);
    const failure = source.search({ terms: term("x"), limit: 1 }, ctx());
    await expect(failure).rejects.toBeInstanceOf(RateLimitError);
    await failure.catch((error: RateLimitError) => {
      expect(error.retryAfterMs).toBeUndefined();
      expect(error.httpStatus).toBe(429);
      expect(error.retryable).toBe(true);
    });
  });

  function clientOver(exchange: {
    status: number;
    body: string;
    headers?: Record<string, string>;
  }) {
    const clock = createManualClock(NOW);
    const transport = cannedTransport(clock, exchange);
    return createHttpClient({
      transport,
      userAgent: buildUserAgent("0.0.2"),
      clock,
    });
  }

  it("P2-T35: an Atom error feed in an HTTP 400 is the parser's own SourceError, with the BadRequestError as cause", async () => {
    const source = createSource(
      clientOver({
        status: 400,
        body: ERROR_FEED_200,
        headers: { "content-type": "application/atom+xml; charset=utf-8" },
      }),
    );
    const failure = source.search({ terms: term("x"), limit: 1 }, ctx());
    await expect(failure).rejects.toBeInstanceOf(SourceError);
    await failure.catch((error: SourceError) => {
      expect(error).not.toBeInstanceOf(ParseError);
      expect(error.context.upstreamError).toBe(
        "incorrect id format for not-an-arxiv-id",
      );
      expect(error.cause).toBeInstanceOf(BadRequestError);
      expect((error.cause as BadRequestError).httpStatus).toBe(400);
    });
    // healthCheck reports the SourceError's key, not the 400's.
    const health = await source.healthCheck(ctx());
    expect(health.ok).toBe(false);
    expect(health.messageKey).toBe("rh-error-source");
  });

  it("P2-T35: a 400 whose body is not an error feed stays a BadRequestError — an HTML page, a well-formed non-error feed, no body", async () => {
    for (const body of [
      "<html><body>400 Bad Request</body></html>",
      feed([SAMPLE_ENTRY], { total: 1 }),
      "",
    ]) {
      const source = createSource(clientOver({ status: 400, body }));
      const failure = source.search({ terms: term("x"), limit: 1 }, ctx());
      await expect(failure).rejects.toBeInstanceOf(BadRequestError);
      await failure.catch((error: BadRequestError) => {
        expect(error.httpStatus).toBe(400);
        expect(error.body).toBe(body.length === 0 ? undefined : body);
      });
    }
  });

  it("P2-T35: a 404 with no body and a 500 with an error-feed body are untouched by the adapter", async () => {
    await expect(
      createSource(clientOver({ status: 404, body: "" })).search(
        { terms: term("x"), limit: 1 },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    const failure = createSource(
      clientOver({ status: 500, body: ERROR_FEED_200 }),
    ).search({ terms: term("x"), limit: 1 }, ctx());
    await expect(failure).rejects.toBeInstanceOf(UpstreamServerError);
    await failure.catch((error: UpstreamServerError) => {
      expect(error.context).not.toHaveProperty("body");
    });
  });

  it("spaces two consecutive search() calls >= 3000 ms apart on §7.3's bucket under a fake clock (criterion 6)", async () => {
    const clock = createManualClock(NOW);
    const policy = must(
      HOST_POLICIES.find((p) => p.host === ARXIV_HOST),
      "the arXiv row",
    );
    const bucket = new TokenBucket(ARXIV_HOST, policy.withoutKey, clock);
    const transport = cannedTransport(clock, {
      status: 200,
      body: feed([SAMPLE_ENTRY], { total: 1 }),
      headers: { "content-type": "application/atom+xml; charset=utf-8" },
    });
    const client = createHttpClient({
      transport,
      userAgent: buildUserAgent("0.0.2"),
      clock,
      limiterFor: (host) => (host === ARXIV_HOST ? bucket : undefined),
    });
    const source = createSource(client);

    const first = source.search({ terms: term("x"), limit: 1 }, ctx());
    const second = source.search({ terms: term("y"), limit: 1 }, ctx());
    await flush();
    // The first request started immediately (burst 1); the second is parked.
    expect(transport.startedAt).toEqual([NOW]);
    // Advance the clock one millisecond at a time until the second starts, so
    // the elapsed figure is an observation and not an assumption.
    let elapsed = 0;
    while (transport.startedAt.length < 2 && elapsed < 10_000) {
      clock.advance(1);
      elapsed += 1;
      await flush();
    }
    const [a, b] = transport.startedAt;
    expect(
      must(b, "the second start") - must(a, "the first start"),
    ).toBeGreaterThanOrEqual(3000);
    expect(
      must(b, "the second start") - must(a, "the first start"),
    ).toBeLessThan(3100);
    const pages = await Promise.all([first, second]);
    expect(pages.map((p) => p.records.length)).toEqual([1, 1]);
  });
});

// ---------------------------------------------------------------------------
// 9. Replay: test/fixtures/arxiv through the shipped createHttpClient
// ---------------------------------------------------------------------------

describe("replay: test/fixtures/arxiv through createHttpClient", () => {
  function replaySource() {
    const replay = createReplayHttpClient({
      dir: FIXTURE_DIR,
      host: ARXIV_HOST,
    });
    const source = createArxivSource({
      http: replay.client,
      clock: replay.clock,
      mapRecords: createArxivRecordMapper({ clock: replay.clock }),
      parseXml: parseXmlInNode,
    });
    return { ...replay, source };
  }

  it("holds docs/13 §3.1's thirteen scenarios, each with a sidecar, plus the error feed and page 2", async () => {
    const loaded = await listFixtureMeta(FIXTURE_DIR);
    const scenarios = loaded.map((m) => m.meta.scenario);
    for (const name of DOCS_13_SCENARIOS) expect(scenarios).toContain(name);
    expect(scenarios).toEqual(
      expect.arrayContaining([
        "paginated-page-2",
        "search-error-feed",
        ...DEDUP_CORPUS_SEARCHES.arxiv.map((s) => s.scenario),
      ]),
    );
    expect(loaded).toHaveLength(15 + CORPUS_FIXTURES);
    const names = await readdir(FIXTURE_DIR);
    for (const { key } of loaded) {
      expect(names).toContain(`${key}.json`);
      expect(names).toContain(`${key}${META_SUFFIX}`);
    }
    for (const { meta } of loaded) {
      expect(meta.endpoint).toBe(ARXIV_QUERY_URL);
      expect(meta.method).toBe("GET");
      expect(meta.synthetic).toBe(
        ["error-429", "error-500", "error-malformed"].includes(meta.scenario),
      );
    }
  });

  it("carries no contact address in either spelling, and is fresh", async () => {
    const names = (await readdir(FIXTURE_DIR)).filter((n) =>
      n.endsWith(".json"),
    );
    for (const name of names) {
      const text = await readFile(`${FIXTURE_DIR}/${name}`, "utf8");
      expect(text).not.toMatch(/suppakoko(@|%40)gmail/iu);
    }
    const report = await assertFixturesFresh(FIXTURE_DIR, Date.now());
    expect(report.checked).toBe(15 + CORPUS_FIXTURES);
  });

  it("search-typical: 20 of 26 records, a next start of 20, affiliations and one published version among them", async () => {
    const { source, transport } = replaySource();
    const page = await source.search(QUERY_TYPICAL, ctx());
    expect(page.records).toHaveLength(20);
    expect(page.totalAvailable).toBe(26);
    expect(page.nextCursor).toBe("20");
    expect(page.warnings).toEqual([]);
    const call = must(transport.calls[0], "the call");
    expect(call.options.headers?.["User-Agent"]).toMatch(
      /^research_helper\/0\.0\.2 \(https:\/\/github\.com\/suppakoko\/research_helper; mailto:suppakoko@gmail\.com\)$/u,
    );
    expect(new URL(call.url).host).toBe(ARXIV_HOST);
    for (const record of page.records) {
      expect(record.work.type).toBe("preprint");
      expect(record.work.containerTitle).toBe("arXiv");
      expect(record.work.ids.arxivId).toBeDefined();
      expect(record.work.ids.doi?.startsWith("10.48550/arxiv.")).toBe(true);
      expect(record.work.abstract).not.toMatch(/\n|\s{2}/u);
    }
    const withAffiliations = page.records.filter((r) =>
      r.work.authors.some((a) => a.affiliations !== undefined),
    );
    expect(withAffiliations.length).toBeGreaterThan(0);
    const published = page.records.filter(
      (r) => r.work.relatedVersionIds !== undefined,
    );
    expect(published.map((r) => r.work.relatedVersionIds)).toEqual([
      { doi: "10.51257/a-v1-h5030" },
    ]);
  });

  it("search-empty: totalResults 0, no entries, no cursor, no error (§7.5 note 7)", async () => {
    const page = await replaySource().source.search(QUERY_EMPTY, ctx());
    expect(page.records).toEqual([]);
    expect(page.totalAvailable).toBe(0);
    expect(page.nextCursor).toBeUndefined();
  });

  it("search-single: one record and a next start of 1", async () => {
    const page = await replaySource().source.search(
      { ...QUERY_TYPICAL, limit: 1 },
      ctx(),
    );
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.nativeId).toBe("2302.03294v2");
    expect(page.records[0]?.work.ids.arxivId).toBe("2302.03294");
    expect(page.nextCursor).toBe("1");
  });

  it("record-rich: the SciPy paper with its journal DOI as the published version and its own DataCite DOI", async () => {
    const page = await replaySource().source.search(QUERY_RICH, ctx());
    const r = byNativeId(page.records, "1907.10121v1");
    expect(r.work.title).toBe(
      "SciPy 1.0--Fundamental Algorithms for Scientific Computing in Python",
    );
    expect(r.work.ids).toEqual({
      doi: "10.48550/arxiv.1907.10121",
      arxivId: "1907.10121",
    });
    expect(r.work.relatedVersionIds).toEqual({
      doi: "10.1038/s41592-019-0686-2",
    });
    expect(r.work.subjects?.map((s) => s.term)).toEqual([
      "cs.MS",
      "cs.DS",
      "cs.SE",
      "physics.comp-ph",
    ]);
    expect(r.work.authors.length).toBeGreaterThan(30);
    expect(r.work.authors[0]).toMatchObject({
      family: "Virtanen",
      given: "Pauli",
    });
    expect(r.work.publishedDate).toEqual({
      year: 2019,
      month: 7,
      day: 23,
      iso: "2019-07-23",
    });
    expect(r.work.openAccess).toEqual({
      isOpenAccess: true,
      pdfUrl: "https://arxiv.org/pdf/1907.10121v1",
    });
    expect(r.missingFields).toEqual([]);
  });

  it("record-sparse: docs/02 §7.4's VizIt entry — criterion 4 on the recorded body", async () => {
    const page = await replaySource().source.search(QUERY_SPARSE, ctx());
    const r = byNativeId(page.records, "2609.04658v1");
    expect(r.work.ids.arxivId).toBe("2609.04658");
    expect(arxivArchiveId(r.nativeId)).toBe("arXiv:2609.04658v1");
    expect(r.work.relatedVersionIds).toBeUndefined();
    expect(r.work.authors).toHaveLength(11);
    expect(r.missingFields).toEqual([]);
  });

  it("record-unicode: diacritics survive, an old-style id is branded, a published version is linked", async () => {
    const page = await replaySource().source.search(QUERY_UNICODE, ctx());
    expect(page.records.map((r) => r.work.title)).toEqual([
      "Schrödinger's Cat",
      "On Schrödinger's cat",
      "Is Schrödinger's Cat Alive?",
      "Schrödinger's Cat -- Amended",
      "A Requiem For Schrödinger's Cat",
    ]);
    const old = byNativeId(page.records, "quant-ph/9509021v1");
    expect(old.work.ids).toEqual({
      doi: "10.48550/arxiv.quant-ph/9509021",
      arxivId: "quant-ph/9509021",
    });
    expect(
      byNativeId(page.records, "2211.17086v1").work.relatedVersionIds,
    ).toEqual({
      doi: "10.12743/quanta.v6i1.68",
    });
  });

  it("record-jats-abstract: a hard-wrapped summary maps to a single-spaced abstract (criterion 3)", async () => {
    const exchange = await recordedExchange("record-jats-abstract");
    expect(exchange.body).toMatch(/<summary>\s+\S[\s\S]*?\n\s+\S/u);
    const page = await replaySource().source.search(QUERY_WRAPPED, ctx());
    expect(page.records).toHaveLength(2);
    for (const record of page.records) {
      expect(record.work.abstract).toMatch(/^\S.*\S$/u);
      expect(record.work.abstract).not.toMatch(/\n|\s{2}/u);
    }
    expect(byNativeId(page.records, "1711.11416v31").work.ids.arxivId).toBe(
      "1711.11416",
    );
  });

  it("record-preprint: a preprint with no journal DOI — the published link is absent, not invented", async () => {
    const page = await replaySource().source.search(QUERY_PREPRINT, ctx());
    const r = byNativeId(page.records, "1512.03385v1");
    expect(r.work.type).toBe("preprint");
    expect(r.work.relatedVersionIds).toBeUndefined();
    expect(r.work.ids.doi).toBe("10.48550/arxiv.1512.03385");
  });

  it("dedup-pair-set: the SciPy paper by its subtitle", async () => {
    const page = await replaySource().source.search(QUERY_PAIR, ctx());
    expect(page.records.map((r) => r.nativeId)).toEqual(["1907.10121v1"]);
  });

  it("paginated: page 2 replays under page 1's next start with different records", async () => {
    const { source, transport } = replaySource();
    const page1 = await source.search(QUERY_PAGINATED, ctx());
    expect(page1.records.map((r) => r.nativeId)).toEqual([
      "2302.03294v2",
      "2302.07134v3",
      "2303.11494v1",
    ]);
    expect(page1.nextCursor).toBe(ARXIV_PAGE_2_START);
    const page2 = await source.search(
      { ...QUERY_PAGINATED, cursor: must(page1.nextCursor, "page 1's cursor") },
      ctx(),
    );
    expect(page2.records.map((r) => r.nativeId)).toEqual([
      "2301.02120v1",
      "2303.06945v4",
      "2302.03907v1",
    ]);
    expect(page2.nextCursor).toBe("6");
    expect(page2.totalAvailable).toBe(26);
    expect(
      transport.calls.map((c) => new URL(c.url).searchParams.get("start")),
    ).toEqual(["0", "3"]);
    // `searchAll` sizes each page to what is still wanted, so a replay of it
    // would ask for `max_results=6` and find no fixture; the loop over
    // `start` is asserted against stubs in section 7 instead.
  });

  it("search-error-feed: arrives as HTTP 400 and, through the shipped client, is the SourceError carrying arXiv's sentence (P2-T35 criterion 1)", async () => {
    const exchange = await recordedExchange("search-error-feed");
    expect(exchange.status).toBe(400);
    expect(exchange.body).toContain("<title>Error</title>");
    expect(exchange.body).toContain(
      "https://arxiv.org/api/errors#incorrect_id_format_for_not-an-arxiv-id",
    );
    const failure = replaySource().source.search(QUERY_ERROR_FEED, ctx());
    await expect(failure).rejects.toBeInstanceOf(SourceError);
    await failure.catch((error: SourceError) => {
      expect(error).not.toBeInstanceOf(ParseError);
      expect(error).not.toBeInstanceOf(BadRequestError);
      expect(error.message).toContain(
        "incorrect id format for not-an-arxiv-id",
      );
      expect(error.context).toMatchObject({
        sourceId: "arxiv",
        upstreamError: "incorrect id format for not-an-arxiv-id",
        upstreamTitle: "Error",
      });
      // The client's classification is kept underneath, body included, so a
      // debug bundle still sees the 400 and what arXiv sent.
      expect(error.cause).toBeInstanceOf(BadRequestError);
      const cause = error.cause as BadRequestError;
      expect(cause.httpStatus).toBe(400);
      expect(cause.body).toContain("<title>Error</title>");
      expect(cause.body).toContain(
        "<summary>incorrect id format for not-an-arxiv-id</summary>",
      );
    });
  });

  it("search-error-feed: the recorded body, served as the HTTP 200 the document describes, is a typed SourceError (criterion 2)", async () => {
    const exchange = await recordedExchange("search-error-feed");
    const source = createSource(
      createStubHttp((i) => response(i.url, exchange.body, 200)).client,
    );
    const failure = source.search(QUERY_ERROR_FEED, ctx());
    await expect(failure).rejects.toBeInstanceOf(SourceError);
    await failure.catch((error: SourceError) => {
      expect(error).not.toBeInstanceOf(ParseError);
      expect(error.message).toContain(
        "incorrect id format for not-an-arxiv-id",
      );
      expect(error.context.upstreamError).toBe(
        "incorrect id format for not-an-arxiv-id",
      );
    });
  });

  it("error-429: arXiv's measured shape is a RateLimitError with no retryAfterMs and no penalty", async () => {
    const { source, limiter } = replaySource();
    const failure = source.search(QUERY_SYNTHETIC_429, ctx());
    await expect(failure).rejects.toBeInstanceOf(RateLimitError);
    await failure.catch((error: RateLimitError) => {
      expect(error.retryAfterMs).toBeUndefined();
    });
    expect(limiter.penalties).toEqual([]);
  });

  it("error-500 is an UpstreamServerError and error-malformed a ParseError", async () => {
    await expect(
      replaySource().source.search(QUERY_SYNTHETIC_500, ctx()),
    ).rejects.toBeInstanceOf(UpstreamServerError);
    await expect(
      replaySource().source.search(QUERY_SYNTHETIC_MALFORMED, ctx()),
    ).rejects.toBeInstanceOf(ParseError);
  });
});

// ---------------------------------------------------------------------------
// 10. registerSources with the arxiv slot
// ---------------------------------------------------------------------------

describe("registerSources with the arxiv slot", () => {
  const unreachable = () => {
    throw new Error("not called");
  };
  function stub(id: LiteratureSource["id"]): LiteratureSource {
    return {
      id,
      displayNameKey: `x-${id}`,
      capabilities: ARXIV_CAPABILITIES,
      rateLimitKey: "h",
      isConfigured: () => true,
      healthCheck: unreachable,
      search: unreachable,
      searchAll: unreachable,
      explainQuery: unreachable,
    };
  }

  it("registers arxiv fourth, in SOURCE_IDS order, whatever the literal's key order", () => {
    const registry = createSourceRegistry();
    const arxiv = stub("arxiv");
    const crossref = stub("crossref");
    const europepmc = stub("europepmc");
    const pubmed = stub("pubmed");
    registerSources(registry, { arxiv, crossref, europepmc, pubmed });
    expect(registry.list()).toEqual([pubmed, europepmc, crossref, arxiv]);
    expect(SOURCE_IDS.indexOf("crossref")).toBeLessThan(
      SOURCE_IDS.indexOf("arxiv"),
    );
  });

  it("registers the real adapter under its own id and rejects a mis-wired one", () => {
    const registry = createSourceRegistry();
    const real = createSource(
      createStubHttp((i) => response(i.url, feed([]))).client,
    );
    registerSources(registry, { pubmed: stub("pubmed"), arxiv: real });
    expect(registry.get("arxiv")).toBe(real);
    expect(registry.listConfigured()).toContain(real);
    expect(() =>
      registerSources(createSourceRegistry(), {
        pubmed: stub("pubmed"),
        arxiv: stub("biorxiv"),
      }),
    ).toThrow(/supplied as "arxiv" reports id "biorxiv"/u);
  });
});

// ---------------------------------------------------------------------------
// 11. The recorder's arXiv plan — docs/07 §11.1 step 5, docs/13 §3.2
// ---------------------------------------------------------------------------

describe("scripts/record-fixtures.ts: the arXiv plan", () => {
  it("plans every committed fixture under the key that is on disk, and nothing else", async () => {
    const plan = planFor("arxiv");
    expect(plan.host).toBe(ARXIV_HOST);
    expect(RECORDABLE_SOURCES).toContain("arxiv");
    expect(await plan.dependent(() => Promise.resolve(undefined))).toEqual([]);
    const planned = [...plan.independent(), ...plan.syntheticRequests()];
    expect(plan.independent()).toHaveLength(12 + CORPUS_FIXTURES);
    const onDisk = (await readdir(FIXTURE_DIR))
      .filter((n) => n.endsWith(".json") && !n.endsWith(META_SUFFIX))
      .map((n) => n.replace(/\.json$/u, ""));
    const keys = planned.map((p) =>
      fixtureKey({ method: p.method, url: p.url }),
    );
    expect([...keys].sort()).toEqual([...onDisk].sort());
    expect(planned.map((p) => p.scenario)).toEqual(
      expect.arrayContaining([
        ...DOCS_13_SCENARIOS,
        "search-error-feed",
        "paginated-page-2",
      ]),
    );
    expect(plannedRequest("search-typical", "arxiv").url).toBe(
      recordedArxivRequest(QUERY_TYPICAL).url,
    );
    expect(plannedRequest("paginated-page-2", "arxiv").url).toBe(
      recordedArxivRequest(QUERY_PAGINATED, ARXIV_PAGE_2_START).url,
    );
    expect(plannedRequest("search-error-feed", "arxiv").url).toContain(
      "&id_list=not-an-arxiv-id",
    );
  });
});
