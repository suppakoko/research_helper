/**
 * The arXiv adapter: one `GET /api/query` call per page, `start` pagination,
 * the Atom feed parsed with namespaces, the HTTP-200 error feed turned into a
 * typed error, and the host's three-second rule enforced by the one bucket
 * `docs/07` §7.3 gives `export.arxiv.org`.
 *
 * **Scope.** `P2-T06`. `docs/07` §4.2's `LiteratureSource`, implemented for
 * `export.arxiv.org`. Query *rendering* is `./query.ts`'s
 * {@link buildArxivQueryRequest}; `<entry>` → `SourceRecord` is `./mapper.ts`
 * and arrives as {@link ArxivSourceDeps.mapRecords}.
 *
 * ## What this file decides, and where each decision comes from
 *
 * - **The three-second rule is the limiter's, not this file's.** `docs/02`
 *   §7.1 / `docs/09` §5.4: one request every three seconds, a single
 *   connection, aggregated across every machine under our control — a hard
 *   ToU obligation. Enforcement is §7.3's `export.arxiv.org` row
 *   (`src/core/rateLimit/hostLimiter.ts`: 0.33/s, burst 1, `maxConcurrent: 1`,
 *   `minIntervalMs: 3000`), which the HTTP client paces every request through
 *   because {@link ARXIV_HOST} is the URL's authority and this adapter's
 *   `rateLimitKey`. Nothing here loops over items, issues a second connection
 *   or sleeps on its own (the card's sixth Do NOT).
 * - **The response is Atom XML, parsed with namespaces** (`docs/02` §7.1,
 *   §7.5 note 1). {@link parseArxivFeedBody} parses the body through the
 *   injected {@link XmlParser} — Gecko's `DOMParser` in the sandbox, a Node
 *   stand-in in the unit test — checks the root is `<feed>` in the Atom
 *   namespace, reads the three OpenSearch totals, and hands the `<entry>`
 *   elements to the mapper. `getElementsByTagName` is never called.
 * - **The error feed is an error, not an empty page** (§7.5 note 6; the card's
 *   third Do NOT). arXiv answers a malformed request with HTTP **200** and a
 *   feed whose single entry has `<id>http://arxiv.org/api/errors</id>`, a
 *   `<title>Error</title>` and the problem in `<summary>`.
 *   {@link parseArxivFeedBody} turns that into a {@link SourceError} carrying
 *   the summary. **Measured 2026-10-15 (`P2-T06`): the one error feed this
 *   card provoked (a malformed `id_list`) arrived with HTTP 400**, so the
 *   shipped client raised `BadRequestError` before the body got here; the
 *   parse is the path for the 200 form the document describes, and
 *   {@link isErrorFeedEntryId} accepts the measured `https` + fragment id as
 *   well as the documented one. **`totalResults` of `0` with no entries is a
 *   normal empty result** (note 7; the fourth Do NOT) and returns an empty
 *   page.
 * - **`start` is the cursor** (`docs/02` §12.3's Pagination cell): the
 *   0-based offset as a decimal string, the way the PubMed adapter spells
 *   `retstart`. `max_results` is `SourceQuery.limit` clamped to 1 … 2000
 *   ({@link clampMaxResults}) and never past the 30 000-record ceiling
 *   (`docs/02` §7.2: "slices of at most 2000, 30,000 total per query"), so
 *   `maxPageSize: 2000` and `maxTotalResults: 30000`. Termination
 *   ({@link nextStartAfter}): an empty page, a page shorter than
 *   `max_results`, the server total reached, or the ceiling reached.
 * - **A query arXiv cannot express is refused before it costs a slot.**
 *   `./query.ts` throws `RangeError` for a `NOT` with nothing to subtract
 *   from, a `languages` filter and a query that renders to nothing; the
 *   pipeline's `fetchOne` turns that into the source's own error. Fields
 *   with no arXiv prefix (`affiliation`, `meshTerm`) are rendered under
 *   `all:` and said so on `SourcePage.warnings` ({@link lossinessWarnings}),
 *   through `normalizeForSource` against {@link ARXIV_CAPABILITIES}.
 * - **No key, no contact parameter, ever.** `docs/02` §7.1: "API key: None —
 *   none exists". §2.2 and `docs/09` §5.4: arXiv's terms impose **no**
 *   `User-Agent` or contact requirement; the client's `User-Agent` goes out
 *   as good citizenship and is not documented here as compliance (the card's
 *   ninth Do NOT). `benefitsFromApiKey: false`, `isConfigured()` is `true`.
 * - **`abstractsInSearch: true`**: every entry carries `<summary>`
 *   (`docs/02` §7.4). **`dateFilter: true`**: `submittedDate` is a real
 *   server-side window (§7.3). **`citationGraph: false`**, `relatedByWork:
 *   false`, `lookupById: []` — `id_list` exists (§7.2) and a `lookup()` over
 *   it is `P2-T12`'s to wire.
 * - **`rateLimitKey` is {@link ARXIV_HOST}**, imported, so §7.3's
 *   one-bucket-per-host rule is mechanical.
 *
 * ## Errors
 *
 * - The HTTP-200 error feed → {@link SourceError} with arXiv's own text.
 * - Not XML, a `<parsererror>` root, or a root that is not an Atom `<feed>`
 *   → {@link ParseError}.
 * - **Transport-level failures propagate unwrapped**, as on the other
 *   adapters: `P1-T05`'s client throws `docs/07` §10.1's classes. **arXiv's
 *   429 is an HTML body (`Rate exceeded.`) with no `Retry-After`** —
 *   measured 2026-09-15 (`docs/02` §7.1, `P0-T21`), seven requests over
 *   fourteen minutes from this network, every one refused — and the client
 *   classifies it as a `RateLimitError` with `retryAfterMs: undefined`, which
 *   is the path §7.3's retry budget (3000 ms / 30 000 ms / 3) is for. Nothing
 *   here parses that body: it is not a feed, and the client never hands a
 *   429 to this file.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3 / §4.2).
 * Nothing below names the `Zotero` global, touches a preference or reads a
 * file; `DOMParser` arrives through a port; cancellation goes through
 * `ctx.token`, diagnostics through the injected {@link Logger}. Every URL
 * that reaches a log or an error is the builder's `transmittedUrl`.
 */

import type { Clock } from "../../core/clock";
import {
  OperationCancelledError,
  ParseError,
  ResearchHelperError,
  SourceError,
} from "../../core/errors";
import type { HttpClient, HttpResponse } from "../../core/http/client";
import type { Logger } from "../../core/logger";
import { ARXIV_HOST } from "../../core/rateLimit/hostLimiter";
import type { SourceRecord } from "../../model/sourceRecord";
import { normalizeForSource } from "../shared/queryParse";
import type {
  LiteratureSource,
  QueryField,
  QueryNode,
  SourceCallContext,
  SourceCapabilities,
  SourceHealth,
  SourcePage,
  SourceQuery,
} from "../types";
import {
  ARXIV_SOURCE_ID,
  ATOM_NS,
  childrenNS,
  domParserXml,
  OPENSEARCH_NS,
  PARSER_ERROR_TAG,
  type ArxivRecordMapper,
  type XmlElementLike,
  type XmlParser,
} from "./mapper";
import {
  ARXIV_MAX_RESULTS_MAX,
  ARXIV_MAX_RESULTS_MIN,
  ARXIV_MAX_TOTAL_RESULTS,
  ARXIV_RENDERED_FIELDS,
  buildArxivQueryRequest,
  explainArxivQuery,
  type ArxivQueryRequest,
} from "./query";

export { ARXIV_SOURCE_ID } from "./mapper";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/**
 * `LiteratureSource.displayNameKey`. A literal, for the reason
 * `PUBMED_DISPLAY_NAME_KEY`, `EUROPEPMC_DISPLAY_NAME_KEY` and
 * `CROSSREF_DISPLAY_NAME_KEY` are: `src/sources/**` importing `src/i18n/**`
 * would invent a dependency edge `docs/07` §2.3 does not have. Declared in
 * both `research-helper-mainWindow.ftl` bundles and listed in
 * `src/i18n/keys.ts` (`P2-T06`).
 */
export const ARXIV_DISPLAY_NAME_KEY = "research-helper-source-arxiv";

/** `SourceHealth.messageKey` for a healthy probe. */
export const ARXIV_HEALTH_OK_MESSAGE_KEY = ARXIV_DISPLAY_NAME_KEY;

/** `SourceHealth.messageKey` when the probe failed and carried no key of its own. */
export const ARXIV_HEALTH_FAILED_MESSAGE_KEY = "rh-error-source";

/** `docs/02` §7.5 note 6: the `<id>` of the error feed's single entry. */
export const ARXIV_ERROR_FEED_ENTRY_ID = "http://arxiv.org/api/errors";

/**
 * Is `id` the error feed's entry id? `docs/02` §7.5 note 6 writes it as
 * `http://arxiv.org/api/errors`; **measured 2026-10-15 (`P2-T06`,
 * `search-error-feed`)** it arrives as
 * `https://arxiv.org/api/errors#incorrect_id_format_for_not-an-arxiv-id` —
 * `https`, with the problem repeated as a fragment — and with HTTP **400**,
 * not the 200 the note describes. So the check is a prefix match over both
 * schemes, and the 400 means the shipped client classifies the measured case
 * as `BadRequestError` before the body reaches this file; the parse below is
 * the path for the 200 form the document describes.
 */
export function isErrorFeedEntryId(id: string | undefined): boolean {
  if (id === undefined) return false;
  const path = ARXIV_ERROR_FEED_ENTRY_ID.replace(/^http:\/\//u, "");
  return (
    id === `http://${path}` ||
    id === `https://${path}` ||
    id.startsWith(`http://${path}#`) ||
    id.startsWith(`https://${path}#`)
  );
}

/**
 * Capabilities, as the card's step 9 declares them and as `./query.ts` renders
 * them: `capabilities.query` is `docs/02` §12.3's arXiv column — `AND`, `OR`,
 * `ANDNOT`, `%22…%22`, `ti:`, `abs:`, `au:` are all real — with the fields
 * taken from the renderer's own prefix table so the two cannot drift
 * (`P2-T28`).
 */
export const ARXIV_CAPABILITIES: SourceCapabilities = {
  keywordSearch: true,
  query: {
    or: true,
    not: true,
    phrase: true,
    fields: ARXIV_RENDERED_FIELDS,
  },
  relatedByWork: false,
  lookupById: [],
  abstractsInSearch: true,
  citationGraph: false,
  dateFilter: true,
  maxPageSize: ARXIV_MAX_RESULTS_MAX,
  maxTotalResults: ARXIV_MAX_TOTAL_RESULTS,
  benefitsFromApiKey: false,
};

// ---------------------------------------------------------------------------
// 2. The response
// ---------------------------------------------------------------------------

/**
 * `docs/07` §5.3 `SourceProvenance.sourceExtras`, keyed by the feed's own
 * OpenSearch names plus the offset this page was asked for.
 */
export interface ArxivSourceExtras {
  readonly totalResults: number | undefined;
  readonly startIndex: number | undefined;
  readonly itemsPerPage: number | undefined;
  /** The `start` this page was requested at. */
  readonly start: number;
}

/** A page of arXiv results: `docs/07` §4.2's page plus the extras. */
export interface ArxivSearchPage extends SourcePage {
  readonly sourceExtras: ArxivSourceExtras;
}

/** The adapter, with `search`'s return narrowed to {@link ArxivSearchPage}. */
export interface ArxivSource extends LiteratureSource {
  search(query: SourceQuery, ctx: SourceCallContext): Promise<ArxivSearchPage>;
}

/** A validated feed. */
export interface ArxivFeedResult {
  /** The `<entry>` elements, unmapped — the mapper's input. */
  readonly entries: readonly XmlElementLike[];
  /** `opensearch:totalResults`, when a non-negative integer. */
  readonly totalResults: number | undefined;
  readonly startIndex: number | undefined;
  readonly itemsPerPage: number | undefined;
}

/** A non-negative integer from an OpenSearch total's text; `undefined` otherwise. */
function readTotal(root: XmlElementLike, local: string): number | undefined {
  const text = childrenNS(root, OPENSEARCH_NS, local)[0]?.textContent?.trim();
  if (text === undefined || !/^\d+$/u.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** The trimmed text of an entry's first Atom child, or `undefined`. */
function entryText(entry: XmlElementLike, local: string): string | undefined {
  const text = childrenNS(entry, ATOM_NS, local)[0]?.textContent;
  if (text === undefined || text === null) return undefined;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parse and validate one `/api/query` body (`docs/02` §7.4's feed).
 *
 * @param body - the response text
 * @param parseXml - the XML parser port
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @throws SourceError for the error feed — HTTP 200, one entry whose `<id>`
 *   is {@link ARXIV_ERROR_FEED_ENTRY_ID} (§7.5 note 6); the message carries
 *   arXiv's `<summary>`
 * @throws ParseError when the body does not parse as XML, or its root is not
 *   an Atom `<feed>` — a truncated body (`error-malformed`), an HTML page
 */
export function parseArxivFeedBody(
  body: string,
  parseXml: XmlParser,
  transmittedUrl: string,
): ArxivFeedResult {
  const root = parseXml(body).documentElement;
  if (root === null || root.localName === PARSER_ERROR_TAG) {
    throw new ParseError(
      ARXIV_SOURCE_ID,
      `[research-helper] arXiv returned a body that is not well-formed XML.`,
      {
        url: transmittedUrl,
        bodyLength: body.length,
        ...(root !== null && {
          parserError: (root.textContent ?? "").trim().slice(0, 200),
        }),
      },
    );
  }
  if (root.localName !== "feed" || root.namespaceURI !== ATOM_NS) {
    throw new ParseError(
      ARXIV_SOURCE_ID,
      `[research-helper] arXiv returned XML whose root is <${root.localName}> ` +
        `in namespace ${JSON.stringify(root.namespaceURI)}; docs/02 §7.4 ` +
        `gives an Atom <feed>.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }

  const entries = childrenNS(root, ATOM_NS, "entry");
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only !== undefined && isErrorFeedEntryId(entryText(only, "id"))) {
    const summary = entryText(only, "summary") ?? "(no summary)";
    throw new SourceError(
      ARXIV_SOURCE_ID,
      `[research-helper] arXiv answered with its error feed: ${summary}`,
      {
        url: transmittedUrl,
        upstreamError: summary,
        upstreamTitle: entryText(only, "title"),
      },
    );
  }

  return {
    entries,
    totalResults: readTotal(root, "totalResults"),
    startIndex: readTotal(root, "startIndex"),
    itemsPerPage: readTotal(root, "itemsPerPage"),
  };
}

// ---------------------------------------------------------------------------
// 3. Lossiness and paging
// ---------------------------------------------------------------------------

/** The first sentence of every arXiv lossiness notice. */
export const ARXIV_APPROXIMATE_PREFIX = "arXiv results are approximate";

/**
 * The warning a query earns before any request is made: the `QueryField`
 * members arXiv has no prefix for, as `normalizeForSource` reports them
 * against this adapter's declared dialect. arXiv renders `AND`, `OR`,
 * `ANDNOT` and phrases faithfully, so a field is the only thing it can lose.
 *
 * @param terms - the query tree
 * @returns zero or one string for `SourcePage.warnings`
 */
export function lossinessWarnings(terms: QueryNode): readonly string[] {
  const lost = normalizeForSource(terms, ARXIV_CAPABILITIES);
  const fields = new Set<QueryField>();
  for (const node of lost) {
    if (
      node.kind === "term" &&
      node.field !== undefined &&
      !ARXIV_RENDERED_FIELDS.includes(node.field)
    ) {
      fields.add(node.field);
    }
  }
  if (fields.size === 0) return [];
  return [
    `${ARXIV_APPROXIMATE_PREFIX}: the field restriction` +
      `${fields.size === 1 ? "" : "s"} ` +
      `${[...fields].map((f) => `${f}:`).join(", ")} ` +
      `${fields.size === 1 ? "has" : "have"} no arXiv prefix and ` +
      `${fields.size === 1 ? "was" : "were"} searched across all fields (all:).`,
  ];
}

/**
 * Decide whether another page exists. An empty page, a page shorter than
 * `max_results`, the server's total reached, or `docs/02` §7.2's 30 000
 * ceiling reached all end the loop; otherwise the next `start`, as a string.
 */
export function nextStartAfter(
  start: number,
  pageLength: number,
  maxResults: number,
  totalResults: number | undefined,
): string | undefined {
  if (pageLength === 0) return undefined;
  if (pageLength < maxResults) return undefined;
  const next = start + pageLength;
  if (totalResults !== undefined && next >= totalResults) return undefined;
  if (next >= ARXIV_MAX_TOTAL_RESULTS) return undefined;
  return String(next);
}

/** `SourceQuery.cursor` → a `start`. An unusable cursor restarts at 0. */
export function readStartCursor(cursor: string | undefined): number {
  if (cursor === undefined || !/^\d+$/u.test(cursor)) return 0;
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed)) return 0;
  return Math.min(parsed, ARXIV_MAX_TOTAL_RESULTS - 1);
}

/**
 * `SourceQuery.limit` → `max_results`, clamped to `docs/02` §7.2's 1 … 2000
 * and to what is left below the 30 000 ceiling from `start`.
 */
export function clampMaxResults(limit: number, start = 0): number {
  const wanted = Number.isFinite(limit)
    ? Math.trunc(limit)
    : ARXIV_MAX_RESULTS_MIN;
  const remaining = ARXIV_MAX_TOTAL_RESULTS - start;
  return Math.max(
    ARXIV_MAX_RESULTS_MIN,
    Math.min(ARXIV_MAX_RESULTS_MAX, wanted, remaining),
  );
}

// ---------------------------------------------------------------------------
// 4. The adapter
// ---------------------------------------------------------------------------

/** What {@link createArxivSource} needs from the composition root. */
export interface ArxivSourceDeps {
  /** `P1-T05`'s client. Pacing — the three-second rule — retry and 429 handling all live behind it. */
  readonly http: HttpClient;
  /** `src/core/clock.ts`; only `healthCheck`'s `latencyMs` reads it. */
  readonly clock: Clock;
  /** `./mapper.ts`'s mapper. Required: without it a page has no records. */
  readonly mapRecords: ArxivRecordMapper;
  /**
   * The XML parse for the feed. Defaults to `./mapper.ts`'s `domParserXml`,
   * the sandbox's own `DOMParser`; a Node unit test injects its own.
   */
  readonly parseXml?: XmlParser;
  /** Diagnostics. Never given a response body. */
  readonly logger?: Logger;
}

/**
 * The probe query `healthCheck` sends: a fixed word, `max_results=1`, so one
 * request and a small body — and one three-second slot. A health check never
 * sends user content (`docs/09` §4).
 */
const HEALTH_PROBE_QUERY: SourceQuery = {
  terms: { kind: "term", value: "electron" },
  limit: 1,
};

/**
 * Build the arXiv adapter.
 *
 * @param deps - the HTTP client, the clock, the mapper and the optional
 *   parser and logger
 * @returns a `docs/07` §4.2 `LiteratureSource` for arXiv
 */
export function createArxivSource(deps: ArxivSourceDeps): ArxivSource {
  const { http, clock, mapRecords } = deps;
  const parseXml = deps.parseXml ?? domParserXml;

  /** One request and the feed check. */
  async function fetchFeed(
    request: ArxivQueryRequest,
    ctx: SourceCallContext,
  ): Promise<{ result: ArxivFeedResult; response: HttpResponse }> {
    ctx.token.throwIfCancelled();
    // `responseType: "text"` is not optional: `HttpResponse.body` is `""` for
    // every other value, and the feed is parsed from text here.
    const response = await http.request(request.method, request.url, {
      responseType: "text",
      token: ctx.token,
    });
    deps.logger?.debug("arxiv query", {
      sourceId: ARXIV_SOURCE_ID,
      url: request.transmittedUrl,
      status: response.status,
    });
    return {
      result: parseArxivFeedBody(
        response.body,
        parseXml,
        request.transmittedUrl,
      ),
      response,
    };
  }

  /** One page. */
  async function search(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<ArxivSearchPage> {
    const start = readStartCursor(query.cursor);
    const maxResults = clampMaxResults(query.limit, start);
    const request = buildArxivQueryRequest({ query, start, maxResults });
    const { result } = await fetchFeed(request, ctx);
    return {
      records: mapRecords(result.entries),
      totalAvailable: result.totalResults,
      nextCursor: nextStartAfter(
        start,
        result.entries.length,
        maxResults,
        result.totalResults,
      ),
      warnings: lossinessWarnings(query.terms),
      sourceExtras: {
        totalResults: result.totalResults,
        startIndex: result.startIndex,
        itemsPerPage: result.itemsPerPage,
        start,
      },
    };
  }

  /**
   * Page until `limit` or exhaustion. Each page asks for what is still wanted,
   * capped at `docs/02` §7.2's 2000, and each page costs one three-second
   * slot (§7.1: "A search returning 200 arXiv results at 100/page costs 6
   * seconds minimum"). `ctx.token.throwIfCancelled()` runs at the top of
   * every page (`docs/07` §7.4 check point 1). The lossiness notice is raised
   * once, on the first page, through `ctx.progress`.
   */
  async function* searchAll(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): AsyncGenerator<SourceRecord, void, undefined> {
    const limit = Number.isFinite(query.limit)
      ? Math.max(0, Math.trunc(query.limit))
      : 0;
    let cursor = query.cursor;
    let emitted = 0;
    let total: number | undefined;
    let warned = false;

    while (emitted < limit) {
      ctx.token.throwIfCancelled();
      const page = await search(
        {
          ...query,
          limit: Math.min(limit - emitted, ARXIV_MAX_RESULTS_MAX),
          ...(cursor !== undefined && { cursor }),
        },
        ctx,
      );
      if (!warned) {
        for (const warning of page.warnings) ctx.progress?.warn(warning);
        warned = true;
      }
      total ??= page.totalAvailable;

      for (const record of page.records) {
        if (emitted >= limit) return;
        yield record;
        emitted += 1;
        ctx.progress?.setProgress(
          emitted,
          total === undefined ? undefined : Math.min(total, limit),
        );
      }

      if (page.nextCursor === undefined) return;
      cursor = page.nextCursor;
    }
  }

  /** One `max_results=1` probe. Never throws except on cancellation. */
  async function healthCheck(ctx: SourceCallContext): Promise<SourceHealth> {
    const startedAtMs = clock.now();
    try {
      const request = buildArxivQueryRequest({
        query: HEALTH_PROBE_QUERY,
        start: 0,
        maxResults: 1,
      });
      const { result } = await fetchFeed(request, ctx);
      return {
        ok: true,
        messageKey: ARXIV_HEALTH_OK_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
        ...(result.totalResults !== undefined && {
          quotaHint: `totalResults: ${String(result.totalResults)}`,
        }),
      };
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      return {
        ok: false,
        messageKey:
          error instanceof ResearchHelperError
            ? error.messageKey
            : ARXIV_HEALTH_FAILED_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
      };
    }
  }

  return {
    id: ARXIV_SOURCE_ID,
    displayNameKey: ARXIV_DISPLAY_NAME_KEY,
    capabilities: ARXIV_CAPABILITIES,
    rateLimitKey: ARXIV_HOST,
    /** `docs/02` §7.1: no key exists, so arXiv is always usable. */
    isConfigured: () => true,
    healthCheck,
    search,
    searchAll,
    explainQuery: (query) => explainArxivQuery(query),
  };
}
