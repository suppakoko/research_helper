/**
 * Europe PMC query rendering: a {@link SourceQuery} → the `query=` string the
 * REST API reads, the full `search` / `searchPOST` request, and the native
 * rendering the UI previews.
 *
 * **Scope.** `P2-T03` steps 1 and 2. Rendering only — no HTTP, no response
 * handling, no paging policy. `europepmcSource.ts` owns `search()` and passes
 * `pageSize`, `cursorMark` and `resultType` in here.
 *
 * ## The dialect, from `docs/02` §4.3 / §12.2 / §12.3
 *
 * Europe PMC's syntax is Lucene-shaped: uppercase `AND` / `OR` / `NOT`,
 * parentheses, `"…"` phrases and `FIELD:` prefixes. Its §12.3 column has no
 * n/a cell — every row (AND, OR, NOT, Phrase, Title, Abstract, Author) is a
 * real operator or a real prefix — which is why {@link EUROPEPMC_RENDERED_FIELDS}
 * is what the adapter declares as `capabilities.query.fields` (`plan/00` §6
 * item 97). The prefixes are §4.3's table: `TITLE`, `ABSTRACT`, `TITLE_ABS`,
 * `AUTH`, `JOURNAL`, `MESH_TERM`. **`affiliation` has no prefix in §4.3**, so an
 * `affiliation:` term is rendered without a field — and `affiliation` is kept
 * *out* of {@link EUROPEPMC_RENDERED_FIELDS}, so `normalizeForSource`
 * (`src/sources/shared/queryParse.ts`) reports the loss instead of the
 * renderer widening it silently (the trap `P1-T08` recorded for PubMed).
 *
 * **Every term value is quoted**, bare words included. §12.2's worked
 * rendering writes `TITLE:"CRISPR" NOT "mouse"`, and quoting uniformly means a
 * value carrying Lucene syntax characters (`:` `[` `]` `(` `)` `-` `*` `?`
 * `~` `^` `/`) can never change the query's structure; only `"` and `\` are
 * removed from a value, because they are the two characters that end or escape
 * a quoted phrase. This is a stricter reading than the PubMed renderer's
 * (`src/sources/pubmed/query.ts` leaves `CRISPR-Cas9` bare) and is deliberate:
 * in Lucene a leading `-` is an operator, and `AUTH:Smith-Jones` would mean
 * `AUTH:Smith` and `-Jones`.
 *
 * ## The date window
 *
 * `docs/02` §4.3 offers `PUB_YEAR:[a TO b]` (whole years) and
 * `FIRST_PDATE:[a TO b]` (days). This card's step 1 renders the window as
 * `AND (FIRST_PDATE:[<from> TO <to>])`, which §4.3 names as equivalent to the
 * whole-year form when the bounds are whole years (`2024-01-01 … 2026-12-31`)
 * and is also what the "Custom…" range with day precision needs. Nothing here
 * computes a window: `src/sources/shared/recency.ts`'s `recencyWindow()` returns
 * the bounds, and this file only formats what arrives on the `SourceQuery`
 * (`docs/02` §2.0 and `docs/08` §4.2 own the window). A bound that arrives at
 * year or month precision is widened outward to whole days, so the window
 * never shrinks on the way to the wire.
 *
 * ## The three optional `SourceQuery` filters
 *
 * `docs/07` §4.2 declares `languages`, `openAccessOnly` and `raw` "where
 * supported" / "documented per adapter". Each has one stated fate here, in
 * the shape `P2-T20` gave the PubMed renderer. The flag a caller reads for
 * `languages` and `openAccessOnly` is `EUROPEPMC_CAPABILITIES.filters` —
 * {@link EUROPEPMC_FILTERS}, the object this renderer refuses from (`P2-T34`,
 * `docs/07` §4.2, 2026-10-15); `raw` stays in
 * {@link EUROPEPMC_QUERY_FILTER_SUPPORT}:
 *
 * - **`openAccessOnly` is rendered** as `AND (OPEN_ACCESS:y)` — `docs/02`
 *   §4.3's own row (`OPEN_ACCESS`, `y`/`n`). It is part of the query string,
 *   so it appears in {@link explainEuropePmcQuery} too.
 * - **`languages` is refused** with a `RangeError` naming the member. §4.3's
 *   field table has no language row, and inventing one (`LANG:`) would be a
 *   claim the corpus does not make; dropping it would silently widen the
 *   query to every language. The pipeline turns the throw into that source's
 *   `report.error` (`stages.ts`, `fetchOne`), which is the visible outcome.
 * - **`raw` is a bag of extra `search` parameters, appended; it never
 *   touches `query=`.** Every key this module emits itself, plus `page`
 *   (`docs/02` §4.6: never mixed with `cursorMark`), is reserved and refused
 *   ({@link RESERVED_RAW_PARAMS}); `synonym` (§4.3) is the kind of thing it is
 *   for. Pairs are sorted by key for byte stability and follow `cursorMark`.
 *   `raw` is not part of the query and so is absent from
 *   {@link explainEuropePmcQuery}; it is visible in
 *   {@link EuropePmcSearchRequest.transmittedQuery}.
 *
 * ## GET or POST
 *
 * `docs/02` §4.1 (corrected): the 1500-character figure in Europe PMC's own
 * error text is **not enforced** — 1500-, 2000-, 3000- and 5000-character
 * queries all returned HTTP 200 — and the real ceiling is URI length (nginx
 * `414` near ~12 000 characters). §12.2 keeps 1500 as a **design budget**:
 * above it {@link buildEuropePmcSearchRequest} switches to
 * `POST /searchPOST` with an `application/x-www-form-urlencoded` body (§4.2).
 * Nothing here asserts that a longer GET would be rejected (the card's Do NOT).
 *
 * ## Identification
 *
 * Every request carries `email=` with the **maintainer** address (`docs/02`
 * §2.2's final assignment table: "Europe PMC — `email=` maintainer (no per-user
 * benefit documented)"; §2.4 marks it accepted-but-not-enforced and says to
 * send it anyway). The `User-Agent` is the client's business (`P1-T05`).
 * `src/core/http/userAgent.ts`'s `contactParamsForHost` returns `{}` for this
 * host — it is NCBI-only by its own test — so the parameter is added here.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` and must not import `pipeline/`,
 * `ui/` or `zotero/` (`docs/07` §2.3 / §4.2). The `core/` imports below are the
 * maintainer address (D10), the redaction backstop and the host constant;
 * there is no platform access of any kind.
 */

import { redactUrl } from "../../core/errors";
import type { HttpMethod } from "../../core/http/client";
import { MAINTAINER_EMAIL } from "../../core/http/userAgent";
import { EBI_HOST } from "../../core/rateLimit/hostLimiter";
import type {
  QueryField,
  QueryNode,
  SourceCapabilities,
  SourceQuery,
} from "../types";

/** `docs/02` §4.1's base URL, on {@link EBI_HOST}. No trailing slash. */
export const EUROPEPMC_REST_BASE_URL = `https://${EBI_HOST}/europepmc/webservices/rest`;

/** `docs/02` §4.2: `GET /search`. No query string. */
export const EUROPEPMC_SEARCH_URL = `${EUROPEPMC_REST_BASE_URL}/search`;

/** `docs/02` §4.2: `POST /searchPOST`, "when the query exceeds URL limits". */
export const EUROPEPMC_SEARCH_POST_URL = `${EUROPEPMC_REST_BASE_URL}/searchPOST`;

/** `docs/02` §4.1: page size "**1–1000** (verified: `pageSize=1001` → error)". */
export const EUROPEPMC_PAGE_SIZE_MIN = 1;
export const EUROPEPMC_PAGE_SIZE_MAX = 1000;

/**
 * `docs/02` §12.2's **design budget** for the rendered `query=` value. Above
 * it the request goes by POST. Not a limit the service enforces (§4.1).
 */
export const EUROPEPMC_QUERY_DESIGN_BUDGET = 1500;

/** `docs/02` §4.6: `cursorMark=*` is the first page. */
export const EUROPEPMC_FIRST_CURSOR = "*";

/**
 * `docs/02` §4.4's three `resultType` values. `core` is the only one that
 * carries `abstractText`; `lite` is the API default and is never sent by the
 * adapter's search path (the card's Do NOT). `idlist` is for the health probe.
 */
export type EuropePmcResultType = "idlist" | "lite" | "core";

/**
 * Europe PMC's answer to `docs/07` §4.2's `SourceCapabilities.filters` — the
 * module header says why each is what it is. **The object
 * `EUROPEPMC_CAPABILITIES.filters` is** (`europepmcSource.ts` assigns this
 * constant), and {@link assertExpressible} refuses from it, so the declaration
 * and the renderer cannot drift (`P2-T34`). A member whose flag is `false` is
 * **refused** with `RangeError` when set, never dropped.
 */
export const EUROPEPMC_FILTERS: SourceCapabilities["filters"] = {
  languages: false,
  openAccess: true,
};

/**
 * The optional `SourceQuery` member that stays adapter-level: `raw`.
 * `languages` and `openAccessOnly` moved to {@link EUROPEPMC_FILTERS} on
 * 2026-10-15 (`P2-T34`).
 */
export type EuropePmcQueryFilter = keyof Pick<SourceQuery, "raw">;

/** Whether `raw` is honoured: `true` — the module header says how. */
export const EUROPEPMC_QUERY_FILTER_SUPPORT: Readonly<
  Record<EuropePmcQueryFilter, boolean>
> = {
  raw: true,
};

/** `docs/02` §4.3: `OPEN_ACCESS:y`, the clause `openAccessOnly` renders to. */
const OPEN_ACCESS_CLAUSE = "(OPEN_ACCESS:y)";

/**
 * The `FIELD:` prefix for each `docs/07` §4.2 `QueryField` member, from
 * `docs/02` §4.3's table. `undefined` means "no prefix exists in §4.3": the
 * term is rendered unfielded, and the member is absent from
 * {@link EUROPEPMC_RENDERED_FIELDS} so the loss is reported upstream.
 */
const FIELD_PREFIXES: Readonly<Record<QueryField, string | undefined>> = {
  title: "TITLE",
  abstract: "ABSTRACT",
  titleOrAbstract: "TITLE_ABS",
  author: "AUTH",
  journal: "JOURNAL",
  affiliation: undefined,
  meshTerm: "MESH_TERM",
  any: undefined,
};

/**
 * The `QueryField` members this renderer gives a real prefix — the adapter's
 * `capabilities.query.fields` (`plan/00` §6 item 97). Derived from
 * {@link FIELD_PREFIXES} rather than listed twice, so the declaration cannot
 * drift from the rendering. `"any"` is excluded by the contract's own rule
 * (it is the absence of a field).
 */
export const EUROPEPMC_RENDERED_FIELDS: readonly QueryField[] = (
  Object.keys(FIELD_PREFIXES) as QueryField[]
).filter((field) => field !== "any" && FIELD_PREFIXES[field] !== undefined);

/**
 * The two characters removed from a term value: `"` ends the phrase every
 * value is wrapped in, and `\` escapes inside one. Everything else is literal
 * inside a quoted Lucene phrase.
 */
const PHRASE_BREAKERS = /["\\]/gu;

/**
 * Render a query tree into a Europe PMC `query=` value.
 *
 * @param node - the tree, from `parseUserQuery` or anything else that builds a
 *   `docs/07` §4.2 `QueryNode`
 * @returns the query, with uppercase Booleans, balanced parentheses and every
 *   value quoted; `""` when the tree carries no renderable term at all
 *
 * **`NOT` is rendered binary**, as the PubMed renderer does and for the same
 * reason: `docs/07` §4.2's node is unary, Lucene's `NOT` already means "and
 * not", and §12.2's rendering is `… AND TITLE:"CRISPR" NOT "mouse"`. A `not`
 * child of an `and` therefore contributes `NOT x` *in place of* the `AND`
 * that would otherwise join it. A `not` with no left operand (top level, or
 * inside an `or`) is rendered as a bare `NOT x`; Lucene matches nothing for
 * it, and that is the honest outcome rather than an invented left operand.
 */
export function renderEuropePmcQuery(node: QueryNode): string {
  switch (node.kind) {
    case "term":
      return renderTerm(node.value, node.field);

    case "not": {
      const inner = renderEuropePmcQuery(node.child);
      return inner === "" ? "" : `NOT ${inner}`;
    }

    case "or": {
      const parts = node.children
        .map((child) => renderEuropePmcQuery(child))
        .filter((part) => part !== "");
      if (parts.length === 0) return "";
      if (parts.length === 1) return firstPart(parts);
      return `(${parts.join(" OR ")})`;
    }

    case "and": {
      const parts: string[] = [];
      for (const child of node.children) {
        const rendered = renderEuropePmcQuery(child);
        if (rendered !== "") parts.push(rendered);
      }
      if (parts.length === 0) return "";
      if (parts.length === 1) return firstPart(parts);

      let out = firstPart(parts);
      for (const part of parts.slice(1)) {
        out += part.startsWith("NOT ") ? ` ${part}` : ` AND ${part}`;
      }
      return `(${out})`;
    }
  }
}

/** One `PREFIX:"value"` or `"value"` atom. */
function renderTerm(value: string, field: QueryField | undefined): string {
  const cleaned = value
    .replace(PHRASE_BREAKERS, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") return "";
  const prefix = FIELD_PREFIXES[field ?? "any"];
  const quoted = `"${cleaned}"`;
  return prefix === undefined ? quoted : `${prefix}:${quoted}`;
}

/** `noUncheckedIndexedAccess` makes `parts[0]` optional; the caller checked. */
function firstPart(parts: readonly string[]): string {
  return parts[0] ?? "";
}

/**
 * The native rendering shown in the UI preview and stored with the run —
 * `LiteratureSource.explainQuery`'s return value (`docs/07` §4.2). For Europe
 * PMC it is **exactly** the `query=` value transmitted, window included,
 * because the window is part of the query here (§4.3) rather than a separate
 * parameter as on PubMed.
 *
 * @param query - the normalized query
 * @returns the rendered query, followed by ` AND (FIRST_PDATE:[from TO to])`
 *   when the query carries both bounds, and ` AND (OPEN_ACCESS:y)` when
 *   `openAccessOnly` is set
 * @throws RangeError for an unexpressible filter ({@link assertExpressible})
 */
export function explainEuropePmcQuery(query: SourceQuery): string {
  assertExpressible(query);
  const clauses: string[] = [];
  const rendered = renderEuropePmcQuery(query.terms);
  if (rendered !== "") clauses.push(rendered);
  const window = resolveWindow(query);
  if (window !== undefined) {
    clauses.push(`(FIRST_PDATE:[${window.from} TO ${window.to}])`);
  }
  if (query.openAccessOnly === true) clauses.push(OPEN_ACCESS_CLAUSE);
  return clauses.join(" AND ");
}

/**
 * Refuse every optional filter this adapter cannot express — read off
 * {@link EUROPEPMC_FILTERS}, the object `EUROPEPMC_CAPABILITIES.filters` is —
 * by name, so the drop is an error at the call site and never a quietly wider
 * result set. An empty `languages` list and `openAccessOnly: false` ask for
 * nothing and pass.
 */
function assertExpressible(query: SourceQuery): void {
  if (
    query.languages !== undefined &&
    query.languages.length > 0 &&
    !EUROPEPMC_FILTERS.languages
  ) {
    throw new RangeError(
      `[research-helper] Europe PMC cannot express SourceQuery.languages=` +
        `${JSON.stringify(query.languages)}: docs/02 §4.3 documents no ` +
        `language field for Europe PMC, and the member would otherwise be ` +
        `silently dropped. EUROPEPMC_CAPABILITIES.filters.languages is false.`,
    );
  }
  if (query.openAccessOnly === true && !EUROPEPMC_FILTERS.openAccess) {
    throw new RangeError(
      `[research-helper] Europe PMC cannot express SourceQuery.openAccessOnly: ` +
        `the member would otherwise be silently dropped. ` +
        `EUROPEPMC_CAPABILITIES.filters.openAccess is false.`,
    );
  }
}

/** What {@link buildEuropePmcSearchRequest} is told, beyond the query. */
export interface EuropePmcSearchOptions {
  /** The normalized query. `terms`, `fromDate` and `toDate` are read. */
  readonly query: SourceQuery;
  /** `pageSize`, 1 … 1000 (`docs/02` §4.1). `europepmcSource.ts` clamps. */
  readonly pageSize: number;
  /** `cursorMark`. Defaults to {@link EUROPEPMC_FIRST_CURSOR}. */
  readonly cursor?: string;
  /** `resultType`. Defaults to `"core"` — the only one with abstracts (§4.4). */
  readonly resultType?: EuropePmcResultType;
}

/**
 * A built search request: what to send, and what to store about it.
 *
 * The provenance members are `docs/07` §5.3's `SourceProvenance` names, as on
 * the PubMed builder. Europe PMC has no credential, so `transmittedUrl` equals
 * `url` after `redactUrl` has confirmed there is nothing to remove — the
 * backstop runs anyway so the two can never diverge if a key is ever added.
 */
export interface EuropePmcSearchRequest {
  /** `"GET"` below the design budget, `"POST"` above it. */
  readonly method: HttpMethod;
  /** The URL actually transmitted. Carries the parameters on a GET only. */
  readonly url: string;
  /** The form body, on a POST only. */
  readonly body: string | undefined;
  /** The rendered `query=` value, window included — `explainQuery`'s string. */
  readonly renderedQuery: string;
  /** §5.3 `endpointBaseUrl` — the endpoint with no query string. */
  readonly endpointBaseUrl: string;
  /** The ordered, URL-encoded parameter string, wherever it travelled. */
  readonly queryString: string;
  /** §5.3 `transmittedQuery` — {@link queryString} with credentials removed. */
  readonly transmittedQuery: string;
  /** §5.3 `transmittedUrl` — {@link url} with credentials removed. */
  readonly transmittedUrl: string;
}

/**
 * The parameters, in the order they are emitted. Fixed so that the URL is
 * byte-stable for a given query, which is what `docs/13` §2.2's fixture key —
 * a hash of `{method, url-with-keys-redacted, body}` — depends on. Reordering
 * a member silently invalidates every recorded fixture.
 */
const PARAM_ORDER = [
  "query",
  "resultType",
  "format",
  "pageSize",
  "cursorMark",
  "email",
] as const;

type ParamName = (typeof PARAM_ORDER)[number];

/**
 * `raw` keys refused with `RangeError`: everything this module emits itself,
 * and `page` — `docs/02` §4.6: "Do **not** mix `cursorMark` with `page=`".
 */
export const RESERVED_RAW_PARAMS: ReadonlySet<string> = new Set<string>([
  ...PARAM_ORDER,
  "page",
]);

/**
 * Build one `search` (or `searchPOST`) request.
 *
 * @param options - the query and the paging parameters `europepmcSource.ts`
 *   owns
 * @returns the transmitted and the storable forms of the request
 * @throws RangeError when `pageSize` is outside 1 … 1000 — `docs/02` §4.1
 *   verified `pageSize=1001` as an error, and a silently clamped value here
 *   would hide a caller bug behind a different page than it asked for
 * @throws RangeError when exactly one of `fromDate` / `toDate` is present, or a
 *   bound is not `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (see {@link resolveWindow})
 * @throws RangeError for an unexpressible filter ({@link assertExpressible})
 *   or a reserved `raw` key ({@link RESERVED_RAW_PARAMS})
 */
export function buildEuropePmcSearchRequest(
  options: EuropePmcSearchOptions,
): EuropePmcSearchRequest {
  const { pageSize } = options;
  if (
    !Number.isInteger(pageSize) ||
    pageSize < EUROPEPMC_PAGE_SIZE_MIN ||
    pageSize > EUROPEPMC_PAGE_SIZE_MAX
  ) {
    throw new RangeError(
      `[research-helper] Europe PMC pageSize must be an integer in ` +
        `${EUROPEPMC_PAGE_SIZE_MIN} … ${EUROPEPMC_PAGE_SIZE_MAX} (docs/02 §4.1); ` +
        `got ${String(pageSize)}.`,
    );
  }

  const renderedQuery = explainEuropePmcQuery(options.query);
  const values: Record<ParamName, string> = {
    query: renderedQuery,
    resultType: options.resultType ?? "core",
    format: "json",
    pageSize: String(pageSize),
    cursorMark: options.cursor ?? EUROPEPMC_FIRST_CURSOR,
    email: MAINTAINER_EMAIL,
  };
  const rawPairs = renderRawParams(options.query.raw);
  const queryString = [
    ...PARAM_ORDER.filter((name) => name !== "email").map(
      (name) => `${name}=${encodeURIComponent(values[name])}`,
    ),
    ...rawPairs,
    `email=${encodeURIComponent(values.email)}`,
  ].join("&");

  if (renderedQuery.length <= EUROPEPMC_QUERY_DESIGN_BUDGET) {
    const url = `${EUROPEPMC_SEARCH_URL}?${queryString}`;
    const transmittedUrl = redactUrl(url);
    const queryStart = transmittedUrl.indexOf("?");
    return {
      method: "GET",
      url,
      body: undefined,
      renderedQuery,
      endpointBaseUrl: EUROPEPMC_SEARCH_URL,
      queryString,
      transmittedQuery:
        queryStart === -1 ? "" : transmittedUrl.slice(queryStart + 1),
      transmittedUrl,
    };
  }

  // The whole parameter set moves into the body and the URL keeps none of it
  // (`docs/02` §4.2: "`POST /searchPOST` with `application/x-www-form-urlencoded`
  // body"). Splitting parameters between the two would be a guess about how
  // the service merges them, and nothing in the corpus records that it does.
  return {
    method: "POST",
    url: EUROPEPMC_SEARCH_POST_URL,
    body: queryString,
    renderedQuery,
    endpointBaseUrl: EUROPEPMC_SEARCH_POST_URL,
    queryString,
    transmittedQuery: redactUrl(`?${queryString}`).slice(1),
    transmittedUrl: redactUrl(EUROPEPMC_SEARCH_POST_URL),
  };
}

/**
 * `SourceQuery.raw` as `key=value` pairs, sorted by key; `[]` when absent.
 * A value is `String(value)`, so a caller wanting Europe PMC's `y`/`n` or
 * `true`/`false` passes the spelling the service reads.
 *
 * @throws RangeError for a reserved key ({@link RESERVED_RAW_PARAMS}) — a raw
 *   `query` would bypass the parser, a raw `cursorMark` the paging loop, and
 *   a raw `page` would mix the two paging mechanisms §4.6 forbids mixing
 */
function renderRawParams(raw: SourceQuery["raw"]): readonly string[] {
  if (raw === undefined) return [];
  const keys = Object.keys(raw).sort();
  for (const key of keys) {
    if (RESERVED_RAW_PARAMS.has(key)) {
      throw new RangeError(
        `[research-helper] SourceQuery.raw.${key} is reserved on Europe PMC: ` +
          `the adapter emits that parameter itself (docs/02 §4.2 / §4.6), and ` +
          `raw may add parameters, never replace them.`,
      );
    }
  }
  return keys.map(
    (key) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(String(raw[key]))}`,
  );
}

const ISO_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u;

/**
 * The `FIRST_PDATE` bounds for a query, as `YYYY-MM-DD`, or `undefined` when
 * the user asked for all years.
 *
 * `SourceQuery.fromDate` / `toDate` are ISO (`docs/07` §4.2) at whatever
 * precision arrived. The shipped caller hands over `recencyWindow().fromDate` /
 * `.toDate`, which are always full days; a shorter bound is widened **outward**
 * (`2024` → `2024-01-01` as a lower bound, `2024-12-31` as an upper one), so
 * the window on the wire is never narrower than the one the user was shown.
 */
function resolveWindow(
  query: SourceQuery,
): { from: string; to: string } | undefined {
  const { fromDate, toDate } = query;
  if (fromDate === undefined && toDate === undefined) return undefined;
  if (fromDate === undefined || toDate === undefined) {
    throw new RangeError(
      `[research-helper] Europe PMC needs both date bounds or neither; got ` +
        `fromDate=${JSON.stringify(fromDate)} toDate=${JSON.stringify(toDate)}. ` +
        `docs/02 §4.3 renders the window as one FIRST_PDATE:[a TO b] range.`,
    );
  }
  return { from: toDayBound(fromDate, "from"), to: toDayBound(toDate, "to") };
}

/** Widen an ISO bound outward to a whole day; see {@link resolveWindow}. */
function toDayBound(iso: string, side: "from" | "to"): string {
  const match = ISO_DATE.exec(iso);
  if (match === null) {
    throw new RangeError(
      `[research-helper] Europe PMC date bound must be YYYY, YYYY-MM or ` +
        `YYYY-MM-DD; got ${JSON.stringify(iso)}.`,
    );
  }
  const year = match[1] ?? "";
  const month = match[2];
  const day = match[3];
  if (month !== undefined && day !== undefined) return iso;
  if (month !== undefined) {
    return side === "from"
      ? `${year}-${month}-01`
      : `${year}-${month}-${String(daysInMonth(Number(year), Number(month))).padStart(2, "0")}`;
  }
  return side === "from" ? `${year}-01-01` : `${year}-12-31`;
}

/** Days in a Gregorian month; `month` is 1 … 12. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the following month is the last day of this one. UTC so no
  // zone can shift the date.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
