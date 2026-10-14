/**
 * arXiv query rendering: a {@link SourceQuery} → the `search_query` value of
 * `GET /api/query`, the full request, and the native rendering the UI previews.
 *
 * **Scope.** `P2-T06` step 1 and the paging parameters. Rendering only — no
 * HTTP, no response handling, no paging policy beyond formatting `start` and
 * `max_results`. `arxivSource.ts` owns `search()` and passes `start` and the
 * page size in here.
 *
 * ## The dialect, from `docs/02` §7.2 / §12.2 / §12.3
 *
 * arXiv's `search_query` is a real Boolean language: `AND`, `OR` and `ANDNOT`
 * (§7.2 — there is **no bare `NOT`**), grouping with parentheses, phrases in
 * double quotes, and a field prefix on every term. §12.3's arXiv column gives
 * `ti:` (title), `abs:` (abstract) and `au:` (author); §7.2 adds `jr:`
 * (journal reference) and `all:` ("any of the above"). So:
 *
 * - a term with no field, or `field: "any"`, renders as `all:<value>`;
 * - `title` → `ti:`, `abstract` → `abs:`, `author` → `au:`, `journal` → `jr:`
 *   ({@link FIELD_PREFIXES}); `titleOrAbstract` has no prefix of its own and is
 *   rendered **exactly** as the disjunction it names, `(ti:x OR abs:x)`, so
 *   the restriction is honoured rather than widened;
 * - `affiliation` and `meshTerm` have no arXiv prefix and render as `all:`;
 *   they are absent from {@link ARXIV_RENDERED_FIELDS}, so `normalizeForSource`
 *   (`src/sources/shared/queryParse.ts`) reports the loss and the adapter says
 *   so on `SourcePage.warnings`;
 * - a value with whitespace is quoted whether or not the parser flagged it as
 *   a phrase: arXiv's syntax binds a prefix to one token, so `ti:base editing`
 *   would apply `ti:` to `base` alone and search `editing` everywhere. Quoting
 *   is the one rendering that keeps the field on every word (the same choice
 *   Europe PMC's renderer made, for the same reason);
 * - `NOT` renders as `ANDNOT`, which is **binary**: inside an `and` node the
 *   positive children come first and every negated child follows as
 *   `ANDNOT <child>`. A `not` with nothing to subtract from — a bare `NOT x`,
 *   or `a OR NOT b` — has no arXiv spelling, and {@link renderArxivQuery}
 *   refuses it with `RangeError` rather than inventing a left operand.
 *
 * **Grouping is explicit.** `docs/02` §7.2 documents the operators and the
 * parentheses but says nothing about precedence or associativity, so every
 * `and`, `or` and `ANDNOT` with more than one operand is parenthesised, and
 * the date clause is `AND`ed onto a parenthesised query. §12.2's worked
 * example writes `… AND ti:CRISPR ANDNOT all:mouse AND submittedDate:[…]`
 * with no grouping; this renderer writes the same operators and prefixes
 * with the grouping made explicit, which is a deliberate deviation recorded
 * in the card report. The same example renders the two unfielded phrases
 * under `abs:` and the unfielded `mouse` under `all:` — the document gives no
 * rule for that split, and `all:` is what §7.2 says an unfielded term is.
 *
 * ## The date window
 *
 * `docs/02` §7.3: `submittedDate:[YYYYMMDDTTTT TO YYYYMMDDTTTT]`, `TTTT` a
 * 24-hour GMT time. `SourceQuery.fromDate` / `toDate` are ISO dates at year,
 * month or day precision (`docs/07` §4.2), so a bound is widened **outward**
 * to whole days and the day gets `0000` on the lower bound and `2359` on the
 * upper. The brackets go on the wire as `%5B` / `%5D` and the space as `+`
 * (§7.3's own URL), and **no quotes** are sent around the range — arXiv
 * echoes the brackets back as quotes in the feed title, which is cosmetic
 * (§7.3, the card's fifth Do NOT). `submittedDate` filters on the **v1**
 * submission date (§7.3); `lastUpdatedDate` is a post-v1 option and is not
 * rendered.
 *
 * ## Percent-encoding
 *
 * §12.2's table: `(`→`%28`, `)`→`%29`, `"`→`%22`, `[`→`%5B`, `]`→`%5D`,
 * spaces→`+`. `encodeURIComponent` leaves `(` and `)` alone and writes a space
 * as `%20`, so {@link encodeSearchQuery} finishes the job; the `:` after a
 * prefix stays literal, as every URL in `docs/02` §7 writes it.
 *
 * ## The three optional `SourceQuery` filters
 *
 * The shape `P2-T20` gave the PubMed renderer, {@link ARXIV_QUERY_FILTER_SUPPORT}
 * being the flag a caller reads:
 *
 * - **`languages` is refused** with a `RangeError`: `docs/02` §7.2 documents
 *   no language field, and dropping the member would silently widen the query.
 * - **`openAccessOnly` is satisfied by every arXiv record**: each entry links
 *   its own free e-print (`docs/02` §7.4's `link[@title="pdf"]`, §10.2's
 *   `openAccess.pdfUrl` cell), so the restriction adds no clause and is
 *   reported as supported rather than refused.
 * - **`raw` is a bag of extra `/api/query` parameters, appended; it never
 *   touches `search_query`.** Every parameter this module emits itself is
 *   reserved ({@link RESERVED_RAW_PARAMS}); `id_list` is **not**, because
 *   §7.2 documents it as combinable with `search_query` and the recorder uses
 *   it to provoke arXiv's error feed. Pairs are sorted by key for byte
 *   stability.
 *
 * ## Sort order
 *
 * Every request carries `sortBy=relevance&sortOrder=descending`
 * ({@link ARXIV_SORT_BY}, {@link ARXIV_SORT_ORDER}): §7.2 lists the three
 * `sortBy` values without choosing, and a search adapter's pages must be
 * ranked the same way on every page for `start` paging to mean anything.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` and must not import `pipeline/`,
 * `ui/` or `zotero/` (`docs/07` §2.3 / §4.2). The `core/` imports below are
 * the redaction backstop and the host constant; there is no platform access
 * and no preference is read. arXiv has no contact parameter and no key
 * (`docs/02` §2.2: User-Agent only, "not enforced"; `docs/09` §5.4: the
 * `User-Agent` is good citizenship, not compliance), so nothing about identity
 * is this file's business — the HTTP client adds the `User-Agent`.
 */

import { redactUrl } from "../../core/errors";
import type { HttpMethod } from "../../core/http/client";
import { ARXIV_HOST } from "../../core/rateLimit/hostLimiter";
import type { QueryField, QueryNode, SourceQuery } from "../types";

/** `docs/02` §7.1's base URL, on {@link ARXIV_HOST}, `https://` only. */
export const ARXIV_API_BASE_URL = `https://${ARXIV_HOST}`;

/** `docs/02` §7.1: `GET /api/query`. No query string. */
export const ARXIV_QUERY_URL = `${ARXIV_API_BASE_URL}/api/query`;

/** `docs/02` §7.2: `max_results` "slices of at most 2000". */
export const ARXIV_MAX_RESULTS_MIN = 1;
export const ARXIV_MAX_RESULTS_MAX = 2000;

/** `docs/02` §7.2: "30,000 total per query". */
export const ARXIV_MAX_TOTAL_RESULTS = 30_000;

/** `docs/02` §7.2's `sortBy` / `sortOrder`, fixed for every request. */
export const ARXIV_SORT_BY = "relevance";
export const ARXIV_SORT_ORDER = "descending";

/**
 * The optional `SourceQuery` members that are filters rather than the query
 * itself. Derived from the contract, not re-declared.
 */
export type ArxivQueryFilter = keyof Pick<
  SourceQuery,
  "languages" | "openAccessOnly" | "raw"
>;

/**
 * Which of the three optional filters this adapter really expresses — the
 * module header says why each is what it is. A member whose flag is `false`
 * is **refused** with `RangeError` when set, never dropped.
 */
export const ARXIV_QUERY_FILTER_SUPPORT: Readonly<
  Record<ArxivQueryFilter, boolean>
> = {
  languages: false,
  openAccessOnly: true,
  raw: true,
};

/** `docs/02` §7.2's prefix for a term with no field restriction. */
export const ARXIV_ANY_PREFIX = "all:";

/**
 * The `search_query` prefix a fielded term renders under, from `docs/02`
 * §12.3's arXiv column plus §7.2's `jr:`. `undefined` means "no arXiv
 * prefix": the term renders under {@link ARXIV_ANY_PREFIX} and the member is
 * absent from {@link ARXIV_RENDERED_FIELDS}, so the loss is reported upstream.
 * `titleOrAbstract` is listed as rendered because it is spelled as the
 * disjunction `(ti:x OR abs:x)` — see {@link renderArxivQuery}.
 */
const FIELD_PREFIXES: Readonly<Record<QueryField, string | undefined>> = {
  title: "ti:",
  abstract: "abs:",
  titleOrAbstract: undefined,
  author: "au:",
  journal: "jr:",
  affiliation: undefined,
  meshTerm: undefined,
  any: ARXIV_ANY_PREFIX,
};

/** The two prefixes `titleOrAbstract` is spelled with. */
const TITLE_OR_ABSTRACT_PREFIXES = ["ti:", "abs:"] as const;

/**
 * The `QueryField` members this renderer honours — the adapter's
 * `capabilities.query.fields`. Derived from {@link FIELD_PREFIXES} plus
 * `titleOrAbstract` rather than listed twice. `"any"` is excluded by the
 * contract's own rule.
 */
export const ARXIV_RENDERED_FIELDS: readonly QueryField[] = (
  Object.keys(FIELD_PREFIXES) as QueryField[]
).filter(
  (field) =>
    field !== "any" &&
    (FIELD_PREFIXES[field] !== undefined || field === "titleOrAbstract"),
);

/**
 * Characters removed from a term value before it is rendered: the double
 * quote (this renderer supplies the phrase quotes itself) and the two
 * grouping characters (they would open or close a group the user did not
 * write). Everything else is the user's text.
 */
const UNSAFE_IN_VALUE = /["()]/gu;

/** Collapse a value to single-spaced, trimmed text; `""` when nothing is left. */
function cleanValue(value: string): string {
  return value.replace(UNSAFE_IN_VALUE, " ").replace(/\s+/gu, " ").trim();
}

/** `prefix:value`, the value quoted when it holds whitespace. */
function renderTerm(prefix: string, value: string): string {
  return /\s/u.test(value) ? `${prefix}"${value}"` : `${prefix}${value}`;
}

/** Wrap in parentheses when the rendering holds an operator. */
function group(rendered: string, operands: number): string {
  return operands > 1 ? `(${rendered})` : rendered;
}

/**
 * Render a query tree into arXiv's `search_query` syntax, decoded.
 *
 * @param node - the tree, from `parseUserQuery` or anything else that builds a
 *   `docs/07` §4.2 `QueryNode`
 * @returns the decoded `search_query`, or `""` for a tree with no renderable
 *   term
 * @throws RangeError for a `not` with nothing to subtract from: a bare `NOT x`
 *   at the root, a `not` under an `or`, or an `and` whose every child is
 *   negated — arXiv has no unary `NOT` (`docs/02` §7.2), so the only honest
 *   rendering is none
 */
export function renderArxivQuery(node: QueryNode): string {
  const rendered = visit(node);
  return rendered ?? "";
}

/** `undefined` means "nothing renderable here"; a `not` is handled by its `and`. */
function visit(node: QueryNode): string | undefined {
  switch (node.kind) {
    case "term": {
      const value = cleanValue(node.value);
      if (value === "") return undefined;
      const field = node.field ?? "any";
      if (field === "titleOrAbstract") {
        return group(
          TITLE_OR_ABSTRACT_PREFIXES.map((p) => renderTerm(p, value)).join(
            " OR ",
          ),
          TITLE_OR_ABSTRACT_PREFIXES.length,
        );
      }
      return renderTerm(FIELD_PREFIXES[field] ?? ARXIV_ANY_PREFIX, value);
    }
    case "or": {
      const parts = node.children.map((child) => {
        if (child.kind === "not") {
          throw new RangeError(
            `[research-helper] arXiv cannot render NOT under OR: docs/02 ` +
              `§7.2 gives ANDNOT as the only negation, which needs a left ` +
              `operand to subtract from.`,
          );
        }
        return visit(child);
      });
      const kept = parts.filter((p): p is string => p !== undefined);
      if (kept.length === 0) return undefined;
      return group(kept.join(" OR "), kept.length);
    }
    case "and": {
      const positive: string[] = [];
      const negative: string[] = [];
      for (const child of node.children) {
        if (child.kind === "not") {
          const inner = visitNegated(child);
          if (inner !== undefined) negative.push(inner);
          continue;
        }
        const part = visit(child);
        if (part !== undefined) positive.push(part);
      }
      if (positive.length === 0) {
        if (negative.length === 0) return undefined;
        throw new RangeError(
          `[research-helper] arXiv cannot render a query that only excludes ` +
            `terms: docs/02 §7.2 gives ANDNOT as the only negation, which ` +
            `needs a positive left operand.`,
        );
      }
      let out = group(positive.join(" AND "), positive.length);
      if (negative.length > 0) {
        out = `${out} ANDNOT ${group(negative.join(" OR "), negative.length)}`;
      }
      return out;
    }
    case "not":
      // A root-level `not`, or one under a `not`: nothing to subtract from.
      if (visitNegated(node) === undefined) return undefined;
      throw new RangeError(
        `[research-helper] arXiv cannot render a bare NOT: docs/02 §7.2 ` +
          `gives ANDNOT as the only negation, which needs a left operand.`,
      );
  }
}

/**
 * The operand of a `not`: what goes after `ANDNOT`. `NOT NOT x` is `x`
 * again and is treated as positive by the caller's rules — here it simply
 * renders `x`, and an `and` containing it would subtract `x`, which is what
 * the user wrote twice-negated, so the double negation is rendered literally
 * as a subtraction of the inner subtraction's operand. In practice
 * `parseUserQuery` never produces it.
 */
function visitNegated(node: { readonly child: QueryNode }): string | undefined {
  return visit(node.child);
}

/**
 * The native rendering shown in the UI preview and stored with the run —
 * `LiteratureSource.explainQuery`'s return value (`docs/07` §4.2): the
 * decoded `search_query`, date clause included, without the paging and sort
 * plumbing.
 *
 * @param query - the normalized query
 * @returns the decoded `search_query`; `""` for a query with no renderable
 *   term and no window
 * @throws RangeError for an unexpressible filter ({@link assertExpressible}),
 *   a half-open or malformed date window ({@link resolveWindow}) or an
 *   unrenderable `NOT` ({@link renderArxivQuery})
 */
export function explainArxivQuery(query: SourceQuery): string {
  assertExpressible(query);
  const terms = renderArxivQuery(query.terms);
  const window = renderSubmittedDate(query);
  if (window === undefined) return terms;
  if (terms === "") return window;
  const grouped = needsGrouping(terms) ? `(${terms})` : terms;
  return `${grouped} AND ${window}`;
}

/**
 * Does `rendered` need parentheses before an operator is applied to it? Yes
 * when it holds an operator at its top level — that is, it is neither one
 * term nor already one balanced group. Every `(` and `)` in a rendering is
 * structural: {@link cleanValue} removes both from term values.
 */
function needsGrouping(rendered: string): boolean {
  if (!/\s(?:AND|OR|ANDNOT)\s/u.test(rendered)) return false;
  if (!rendered.startsWith("(") || !rendered.endsWith(")")) return true;
  let depth = 0;
  for (let i = 0; i < rendered.length; i += 1) {
    if (rendered[i] === "(") depth += 1;
    else if (rendered[i] === ")") {
      depth -= 1;
      // The opening group closed before the end: not one group.
      if (depth === 0 && i < rendered.length - 1) return true;
    }
  }
  return false;
}

/**
 * Refuse every optional filter this adapter cannot express
 * ({@link ARXIV_QUERY_FILTER_SUPPORT}), by name, so the drop is an error at
 * the call site and never a quietly wider result set. An empty `languages`
 * list asks for nothing and passes; `openAccessOnly` is always expressible.
 */
function assertExpressible(query: SourceQuery): void {
  if (
    query.languages !== undefined &&
    query.languages.length > 0 &&
    !ARXIV_QUERY_FILTER_SUPPORT.languages
  ) {
    throw new RangeError(
      `[research-helper] arXiv cannot express SourceQuery.languages=` +
        `${JSON.stringify(query.languages)}: docs/02 §7.2 documents no ` +
        `language field, and the member would otherwise be silently ` +
        `dropped. ARXIV_QUERY_FILTER_SUPPORT.languages is false.`,
    );
  }
}

const ISO_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u;

/** The last day of `month` in `year`, 1-based month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The `submittedDate:[… TO …]` clause for a query's window, decoded, or
 * `undefined` when the user asked for all years (`docs/02` §7.3).
 */
export function renderSubmittedDate(query: SourceQuery): string | undefined {
  const window = resolveWindow(query);
  if (window === undefined) return undefined;
  return `submittedDate:[${window.from}0000 TO ${window.to}2359]`;
}

/**
 * The window's two bounds as `YYYYMMDD`, validated and widened outward to
 * whole days: `2024` → `20240101` / `20241231`, `2024-02` → `20240201` /
 * `20240229`.
 */
function resolveWindow(
  query: SourceQuery,
): { from: string; to: string } | undefined {
  const { fromDate, toDate } = query;
  if (fromDate === undefined && toDate === undefined) return undefined;
  if (fromDate === undefined || toDate === undefined) {
    throw new RangeError(
      `[research-helper] arXiv needs both date bounds or neither; got ` +
        `fromDate=${JSON.stringify(fromDate)} toDate=${JSON.stringify(toDate)}. ` +
        `docs/02 §7.3 renders the window as submittedDate:[a TO b].`,
    );
  }
  return { from: widen(fromDate, "from"), to: widen(toDate, "to") };
}

function widen(bound: string, end: "from" | "to"): string {
  const match = ISO_DATE.exec(bound);
  if (match === null) {
    throw new RangeError(
      `[research-helper] arXiv date bound must be YYYY, YYYY-MM or ` +
        `YYYY-MM-DD; got ${JSON.stringify(bound)}.`,
    );
  }
  const year = match[1] ?? "";
  const month = match[2] ?? (end === "from" ? "01" : "12");
  const day =
    match[3] ??
    (end === "from"
      ? "01"
      : String(daysInMonth(Number(year), Number(month))).padStart(2, "0"));
  return `${year}${month}${day}`;
}

/**
 * `docs/02` §12.2's percent-encoding of a `search_query` value: everything
 * `encodeURIComponent` encodes, plus `(`→`%28` and `)`→`%29`, with the space
 * as `+` and the prefix colon left literal.
 */
export function encodeSearchQuery(value: string): string {
  return encodeURIComponent(value)
    .replace(/\(/gu, "%28")
    .replace(/\)/gu, "%29")
    .replace(/%20/gu, "+")
    .replace(/%3A/gu, ":");
}

/** What {@link buildArxivQueryRequest} is told, beyond the query. */
export interface ArxivQueryOptions {
  /** The normalized query. `terms`, `fromDate`, `toDate` and `raw` are read. */
  readonly query: SourceQuery;
  /** `start`, the 0-based offset (`docs/02` §7.2). `arxivSource.ts` reads the cursor. */
  readonly start: number;
  /** `max_results`, 1 … 2000 (`docs/02` §7.2). `arxivSource.ts` clamps. */
  readonly maxResults: number;
}

/**
 * A built `/api/query` request: what to send, and what to store about it.
 *
 * The provenance members are `docs/07` §5.3's `SourceProvenance` names, as on
 * the other builders. arXiv has no credential and no contact parameter, so
 * `transmittedUrl` equals `url` after `redactUrl` has confirmed there is
 * nothing to remove — the backstop runs anyway.
 */
export interface ArxivQueryRequest {
  /** Always `"GET"`: `docs/02` §7 documents no POST form. */
  readonly method: HttpMethod;
  /** The URL actually transmitted. */
  readonly url: string;
  /** The decoded `search_query` — `explainQuery`'s string. */
  readonly renderedQuery: string;
  /** §5.3 `endpointBaseUrl` — the endpoint with no query string. */
  readonly endpointBaseUrl: string;
  /** The ordered, URL-encoded parameter string. */
  readonly queryString: string;
  /** §5.3 `transmittedQuery` — {@link queryString} with credentials removed. */
  readonly transmittedQuery: string;
  /** §5.3 `transmittedUrl` — {@link url} with credentials removed. */
  readonly transmittedUrl: string;
}

/**
 * The parameters, in the order they are emitted. Fixed so that the URL is
 * byte-stable for a given query, which is what `docs/13` §2.2's fixture key —
 * a hash of `{method, url, body}` — depends on. Reordering a member silently
 * invalidates every recorded fixture.
 */
const PARAM_ORDER = [
  "search_query",
  "start",
  "max_results",
  "sortBy",
  "sortOrder",
] as const;

/**
 * `raw` keys refused with `RangeError`: everything this module emits itself.
 * `id_list` is deliberately **not** here (module header).
 */
export const RESERVED_RAW_PARAMS: ReadonlySet<string> = new Set<string>(
  PARAM_ORDER,
);

/**
 * Build one `GET /api/query` request.
 *
 * @param options - the query and the paging parameters `arxivSource.ts` owns
 * @returns the transmitted and the storable forms of the request
 * @throws RangeError when `maxResults` is outside 1 … 2000 or `start` is not
 *   a non-negative integer below 30 000 — `docs/02` §7.2's ceilings, and a
 *   silently clamped value here would hide a caller bug behind a different
 *   page than it asked for
 * @throws RangeError for everything {@link explainArxivQuery} refuses, for a
 *   reserved `raw` key ({@link RESERVED_RAW_PARAMS}), and for a query that
 *   renders to nothing at all — arXiv answers an empty `search_query` with
 *   its error feed, so the request is refused before it costs a 3-second slot
 */
export function buildArxivQueryRequest(
  options: ArxivQueryOptions,
): ArxivQueryRequest {
  const { start, maxResults } = options;
  if (
    !Number.isInteger(maxResults) ||
    maxResults < ARXIV_MAX_RESULTS_MIN ||
    maxResults > ARXIV_MAX_RESULTS_MAX
  ) {
    throw new RangeError(
      `[research-helper] arXiv max_results must be an integer in ` +
        `${ARXIV_MAX_RESULTS_MIN} … ${ARXIV_MAX_RESULTS_MAX} (docs/02 §7.2); ` +
        `got ${String(maxResults)}.`,
    );
  }
  if (
    !Number.isInteger(start) ||
    start < 0 ||
    start >= ARXIV_MAX_TOTAL_RESULTS
  ) {
    throw new RangeError(
      `[research-helper] arXiv start must be an integer in 0 … ` +
        `${String(ARXIV_MAX_TOTAL_RESULTS - 1)} (docs/02 §7.2: 30,000 total ` +
        `per query); got ${String(start)}.`,
    );
  }

  const renderedQuery = explainArxivQuery(options.query);
  const rawPairs = renderRawParams(options.query.raw);
  if (renderedQuery === "" && rawPairs.length === 0) {
    throw new RangeError(
      `[research-helper] arXiv query renders to nothing: no term survived ` +
        `cleaning and no date window was set. An empty search_query draws ` +
        `arXiv's error feed (docs/02 §7.5 note 6), so it is refused here.`,
    );
  }
  const values: Readonly<Record<(typeof PARAM_ORDER)[number], string>> = {
    search_query: encodeSearchQuery(renderedQuery),
    start: String(start),
    max_results: String(maxResults),
    sortBy: ARXIV_SORT_BY,
    sortOrder: ARXIV_SORT_ORDER,
  };
  const pairs: string[] = [];
  for (const name of PARAM_ORDER) {
    if (name === "search_query" && renderedQuery === "") continue;
    pairs.push(`${name}=${values[name]}`);
  }
  const queryString = [...pairs, ...rawPairs].join("&");

  const url = `${ARXIV_QUERY_URL}?${queryString}`;
  const transmittedUrl = redactUrl(url);
  const queryStart = transmittedUrl.indexOf("?");
  return {
    method: "GET",
    url,
    renderedQuery,
    endpointBaseUrl: ARXIV_QUERY_URL,
    queryString,
    transmittedQuery:
      queryStart === -1 ? "" : transmittedUrl.slice(queryStart + 1),
    transmittedUrl,
  };
}

/**
 * `SourceQuery.raw` as `key=value` pairs, sorted by key; `[]` when absent.
 *
 * @throws RangeError for a reserved key ({@link RESERVED_RAW_PARAMS})
 */
function renderRawParams(raw: SourceQuery["raw"]): readonly string[] {
  if (raw === undefined) return [];
  const keys = Object.keys(raw).sort();
  for (const key of keys) {
    if (RESERVED_RAW_PARAMS.has(key)) {
      throw new RangeError(
        `[research-helper] SourceQuery.raw.${key} is reserved on arXiv: the ` +
          `adapter emits that parameter itself (docs/02 §7.2), and raw may ` +
          `add parameters, never replace them.`,
      );
    }
  }
  return keys.map(
    (key) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(String(raw[key]))}`,
  );
}
