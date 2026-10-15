/**
 * Crossref query rendering: a {@link SourceQuery} → the `query.*` parameters
 * of `GET /works`, the full request, and the native rendering the UI previews.
 *
 * **Scope.** `P2-T04` steps 1–4 and 8. Rendering only — no HTTP, no response
 * handling, no paging policy beyond formatting the `cursor` parameter.
 * `crossrefSource.ts` owns `search()` and passes `rows`, `cursor` and the
 * user's contact address in here.
 *
 * ## The dialect, from `docs/02` §5.2 / §12.2 / §12.3
 *
 * Crossref has **no Boolean operator support** in `query.*`: "Terms are
 * scored, not filtered" (§12.2). Its §12.3 column has three *n/a* cells — OR,
 * NOT and Phrase — and two real field parameters, `query.title` and
 * `query.author`. So {@link renderCrossrefQuery} does what §12.2 prescribes
 * and nothing cleverer:
 *
 * - every positive term goes into the **bag of words** that becomes
 *   `query.bibliographic` (§5.2: "the one to use for keyword search"), OR
 *   groups flattened into it, phrase quotes dropped;
 * - a `title:` term is **also** promoted into `query.title` and an `author:`
 *   term into `query.author` — §12.2's worked example writes `CRISPR` in both
 *   the bag and `query.title`, and this file follows it to the byte;
 * - a `NOT` clause is **dropped from the wire** and returned as a
 *   {@link CrossrefExcludedTerm} for `crossrefSource.ts` to filter client-side,
 *   with the lossiness said out loud on `SourcePage.warnings` (the card's
 *   second Do NOT: never silently).
 *
 * No `AND`, `OR` or `NOT` token is ever written into a `query.*` value: the
 * parser has already consumed the operators into the tree, and this renderer
 * emits term values only. {@link CROSSREF_RENDERED_FIELDS} is therefore
 * `["title", "author"]` — §12.3's two real field cells — and every other
 * `QueryField` member (`abstract`, `titleOrAbstract`, `journal`,
 * `affiliation`, `meshTerm`) is rendered into the bag unfielded and reported
 * as a loss by `normalizeForSource` (`src/sources/shared/queryParse.ts`),
 * which the adapter turns into the "results are approximate" notice.
 *
 * ## The date window
 *
 * `docs/02` §5.2: `filter=from-pub-date:<from>,until-pub-date:<to>`, the
 * filter "to use for 'last 3 years'", with `from-created-date:<from>` beside it
 * as the card's step 3 asks (§5.2's caveat: publisher-supplied `issued` cover
 * dates "can be months ahead of actual availability, and occasionally wrong by
 * years", and `from-created-date` is the strict recency guarantee). The same
 * lower bound is used for both — §5.2's own example offsets the created-date
 * bound by three months and gives no rule for the offset, so none is invented.
 * Crossref accepts `YYYY`, `YYYY-MM` and `YYYY-MM-DD` in a filter, so a bound
 * travels at the precision it arrived. Nothing here computes a window:
 * `src/sources/shared/recency.ts` does, and this file formats what arrives on
 * the `SourceQuery`.
 *
 * ## `select` is mandatory
 *
 * `docs/02` §5.2: "comma-separated field whitelist — **use it, responses are
 * otherwise enormous**", and §5.6's 504 row says the fix for a timeout is to
 * "reduce `rows`, add `select`". {@link CROSSREF_SELECT_FIELDS} is the
 * whitelist: every field `docs/02` §10.2's Crossref column consumes, plus the
 * two published-date fallbacks and `relation` (the preprint ↔ published link).
 *
 * ## The three optional `SourceQuery` filters
 *
 * The shape `P2-T20` gave the PubMed renderer. The flag a caller reads for
 * `languages` and `openAccessOnly` is `CROSSREF_CAPABILITIES.filters` —
 * {@link CROSSREF_FILTERS}, the object this renderer refuses from (`P2-T34`,
 * `docs/07` §4.2, 2026-10-15); `raw` stays in
 * {@link CROSSREF_QUERY_FILTER_SUPPORT}:
 *
 * - **`languages` is refused** with a `RangeError`: `docs/02` §5.2's filter
 *   table has no language filter, and dropping the member would silently widen
 *   the query.
 * - **`openAccessOnly` is refused** likewise: §5.2 documents `has-license` and
 *   `has-full-text`, neither of which means "open access", and inventing a
 *   mapping is what the corpus forbids.
 * - **`raw` is a bag of extra `/works` parameters, appended; it never touches
 *   `query.*`.** Every parameter this module emits itself is reserved, as are
 *   `query` (it would bypass the parser), `offset` (`docs/02` §5.5: capped at
 *   10 000 and slow — "use the cursor"; mixing the two paging mechanisms is
 *   never right) and `sample` (it ignores paging altogether). Pairs are sorted
 *   by key for byte stability and travel before `mailto`.
 *
 * ## Politeness — both signals, every request
 *
 * `docs/02` §5.1 verified that a contact address in **either** the `mailto`
 * parameter **or** the `User-Agent` promotes a request to the polite pool, and
 * says to send both anyway. The `User-Agent` is the HTTP client's
 * (`src/core/http/client.ts`, maintainer address, every host). The `mailto`
 * parameter is this file's, through `crossrefContactParams`: the **user's**
 * `contactEmail` when set, the maintainer's otherwise (decision D10). Neither
 * is gated on the other (the card's third Do NOT).
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` and must not import `pipeline/`,
 * `ui/` or `zotero/` (`docs/07` §2.3 / §4.2). The `core/` imports below are
 * the contact parameter (D10), the redaction backstop and the host constant;
 * there is no platform access of any kind and no preference is read — the
 * user's address arrives as an argument.
 */

import { redactUrl } from "../../core/errors";
import type { HttpMethod } from "../../core/http/client";
import { crossrefContactParams } from "../../core/http/userAgent";
import { CROSSREF_HOST } from "../../core/rateLimit/hostLimiter";
import type {
  QueryField,
  QueryNode,
  SourceCapabilities,
  SourceQuery,
} from "../types";

/** `docs/02` §5.1's base URL, on {@link CROSSREF_HOST}. No trailing slash. */
export const CROSSREF_API_BASE_URL = `https://${CROSSREF_HOST}`;

/** `docs/02` §5.2: `GET /works`. No query string. */
export const CROSSREF_WORKS_URL = `${CROSSREF_API_BASE_URL}/works`;

/** `docs/02` §5.2: `rows` "default 20, **max 1000**". */
export const CROSSREF_ROWS_MIN = 1;
export const CROSSREF_ROWS_MAX = 1000;

/** `docs/02` §5.2 / §5.5: `cursor=*` is the first page. */
export const CROSSREF_FIRST_CURSOR = "*";

/**
 * **Measured 2026-10-15 (`P2-T04`, three probes):** with `cursor=*` and no
 * `sort`, `/works` returns the matching set in **index order** — the first
 * three hits for `docs/02` §3.4's own title scored 3.9, 4.5 and 4.4 and were
 * 1990s Elsevier records — while the same request without a cursor, and the
 * same request with `cursor=*&sort=score&order=desc`, both returned the paper
 * itself first at 29.4 and still offered a cursor. §5.5's bare-cursor example
 * therefore silently discards relevance; every request this adapter builds
 * carries these two parameters (§5.2 lists `score` among the `sort` values).
 */
export const CROSSREF_SORT = "score";
export const CROSSREF_ORDER = "desc";

/**
 * The `select` whitelist, in the order it is sent: `docs/02` §10.2's Crossref
 * column, plus `published-online` / `published-print` (the `issued` fallbacks
 * `mapper.ts` reads), `URL`, `publisher`, `relation` (`is-preprint-of` /
 * `has-preprint` → `relatedVersionIds`) and `group-title`. `abstract` is here
 * because `abstractsInSearch: true` depends on it (§5.4).
 *
 * **Measured 2026-10-14 (`P2-T04`, 11 live 400s):** `/works` validates every
 * `select` name and answers `validation-failure` / `select-not-available`
 * for one it does not know, listing the names it does. Three of §10.2's
 * Crossref cells are not among them: `reference-count` (the route spells it
 * `references-count`), `institution` and `language` (not selectable at all, so
 * the mapper never sees them). The recorded `error-400` fixture carries the
 * answer verbatim.
 */
export const CROSSREF_SELECT_FIELDS: readonly string[] = [
  "DOI",
  "URL",
  "type",
  "title",
  "subtitle",
  "abstract",
  "author",
  "issued",
  "published-online",
  "published-print",
  "container-title",
  "short-container-title",
  "ISSN",
  "publisher",
  "group-title",
  "volume",
  "issue",
  "page",
  "subject",
  "is-referenced-by-count",
  "references-count",
  "link",
  "license",
  "relation",
];

/**
 * Crossref's answer to `docs/07` §4.2's `SourceCapabilities.filters` — the
 * module header says why both are `false`. **The object
 * `CROSSREF_CAPABILITIES.filters` is** (`crossrefSource.ts` assigns this
 * constant), and {@link assertExpressible} refuses from it, so the declaration
 * and the renderer cannot drift (`P2-T34`). A member whose flag is `false` is
 * **refused** with `RangeError` when set, never dropped.
 */
export const CROSSREF_FILTERS: SourceCapabilities["filters"] = {
  languages: false,
  openAccess: false,
};

/**
 * The optional `SourceQuery` member that stays adapter-level: `raw`.
 * `languages` and `openAccessOnly` moved to {@link CROSSREF_FILTERS} on
 * 2026-10-15 (`P2-T34`).
 */
export type CrossrefQueryFilter = keyof Pick<SourceQuery, "raw">;

/** Whether `raw` is honoured: `true` — the module header says how. */
export const CROSSREF_QUERY_FILTER_SUPPORT: Readonly<
  Record<CrossrefQueryFilter, boolean>
> = {
  raw: true,
};

/**
 * The `query.<field>` parameter a fielded term is promoted into, from
 * `docs/02` §12.3's Crossref column. `undefined` means "no field parameter":
 * the term stays in the bag only, and the member is absent from
 * {@link CROSSREF_RENDERED_FIELDS} so the loss is reported upstream.
 */
const FIELD_PARAMS: Readonly<Record<QueryField, string | undefined>> = {
  title: "query.title",
  abstract: undefined,
  titleOrAbstract: undefined,
  author: "query.author",
  journal: undefined,
  affiliation: undefined,
  meshTerm: undefined,
  any: undefined,
};

/**
 * The `QueryField` members this renderer gives a real parameter — the
 * adapter's `capabilities.query.fields`. Derived from {@link FIELD_PARAMS}
 * rather than listed twice. `"any"` is excluded by the contract's own rule.
 */
export const CROSSREF_RENDERED_FIELDS: readonly QueryField[] = (
  Object.keys(FIELD_PARAMS) as QueryField[]
).filter((field) => field !== "any" && FIELD_PARAMS[field] !== undefined);

/** A `NOT` term the wire never sees; `crossrefSource.ts` filters on it. */
export interface CrossrefExcludedTerm {
  /** The cleaned term value. */
  readonly value: string;
  /** The field the user restricted it to, if any (`"any"` is normalised away). */
  readonly field: QueryField | undefined;
}

/** What {@link renderCrossrefQuery} produces: three bags and the exclusions. */
export interface CrossrefRenderedQuery {
  /** `query.bibliographic`: every positive term, space-joined. `""` if none. */
  readonly bibliographic: string;
  /** `query.title`: the positive `title:` terms. `""` if none. */
  readonly title: string;
  /** `query.author`: the positive `author:` terms. `""` if none. */
  readonly author: string;
  /** The `NOT` terms, dropped from the wire. */
  readonly excluded: readonly CrossrefExcludedTerm[];
}

/**
 * Characters removed from a term value before it joins a bag. The double
 * quote is the only one: §12.3's Phrase cell is *n/a*, so quotes would be
 * scored as tokens. Everything else is the user's text.
 */
const QUOTE = /"/gu;

/** Collapse a value to single-spaced, trimmed text; `""` when nothing is left. */
function cleanValue(value: string): string {
  return value.replace(QUOTE, " ").replace(/\s+/gu, " ").trim();
}

/**
 * Render a query tree into Crossref's three `query.*` bags and the list of
 * excluded terms.
 *
 * The walk carries a polarity: a `not` flips it for its subtree, so `NOT NOT
 * x` is positive again and `NOT (a OR b)` excludes both. An `or` and an `and`
 * contribute their children with the polarity unchanged — Crossref scores a
 * bag, so the two are the same bag. **A `not` under an `or`** (`a OR NOT b`)
 * is still an exclusion here; that is approximate, which is what §12.2 says
 * every Crossref rendering is, and the notice names it.
 *
 * @param node - the tree, from `parseUserQuery` or anything else that builds a
 *   `docs/07` §4.2 `QueryNode`
 * @returns the bags and the exclusions; a tree with no renderable positive
 *   term yields three empty strings
 */
export function renderCrossrefQuery(node: QueryNode): CrossrefRenderedQuery {
  const bag: string[] = [];
  const title: string[] = [];
  const author: string[] = [];
  const excluded: CrossrefExcludedTerm[] = [];

  const visit = (current: QueryNode, negated: boolean): void => {
    switch (current.kind) {
      case "term": {
        const value = cleanValue(current.value);
        if (value === "") return;
        const field =
          current.field === undefined || current.field === "any"
            ? undefined
            : current.field;
        if (negated) {
          excluded.push({ value, field });
          return;
        }
        bag.push(value);
        if (field !== undefined && FIELD_PARAMS[field] === "query.title") {
          title.push(value);
        }
        if (field !== undefined && FIELD_PARAMS[field] === "query.author") {
          author.push(value);
        }
        return;
      }
      case "not":
        visit(current.child, !negated);
        return;
      case "and":
      case "or":
        for (const child of current.children) visit(child, negated);
        return;
    }
  };
  visit(node, false);

  return {
    bibliographic: bag.join(" "),
    title: title.join(" "),
    author: author.join(" "),
    excluded,
  };
}

/**
 * The native rendering shown in the UI preview and stored with the run —
 * `LiteratureSource.explainQuery`'s return value (`docs/07` §4.2). Crossref's
 * native syntax is its parameter list, so this is the `query.*` and `filter`
 * parameters as `docs/02` §12.2's worked example writes them: decoded,
 * `&`-joined, without the paging, `select` and `mailto` plumbing. The dropped
 * `NOT` terms are **not** in it — they are not sent — and the adapter's
 * warning is where they are named.
 *
 * @param query - the normalized query
 * @returns the decoded parameter rendering; `""` for a query with no positive
 *   term and no window
 * @throws RangeError for an unexpressible filter ({@link assertExpressible})
 *   or a half-open date window ({@link resolveWindow})
 */
export function explainCrossrefQuery(query: SourceQuery): string {
  assertExpressible(query);
  const rendered = renderCrossrefQuery(query.terms);
  const parts: string[] = [];
  if (rendered.bibliographic !== "") {
    parts.push(`query.bibliographic=${rendered.bibliographic}`);
  }
  if (rendered.title !== "") parts.push(`query.title=${rendered.title}`);
  if (rendered.author !== "") parts.push(`query.author=${rendered.author}`);
  const filter = renderFilter(query);
  if (filter !== undefined) parts.push(`filter=${filter}`);
  return parts.join("&");
}

/**
 * Refuse every optional filter this adapter cannot express — read off
 * {@link CROSSREF_FILTERS}, the object `CROSSREF_CAPABILITIES.filters` is — by
 * name, so the drop is an error at the call site and never a quietly wider
 * result set. An empty `languages`
 * list asks for nothing and passes; `openAccessOnly: false` is the default.
 */
function assertExpressible(query: SourceQuery): void {
  if (
    query.languages !== undefined &&
    query.languages.length > 0 &&
    !CROSSREF_FILTERS.languages
  ) {
    throw new RangeError(
      `[research-helper] Crossref cannot express SourceQuery.languages=` +
        `${JSON.stringify(query.languages)}: docs/02 §5.2 documents no ` +
        `language filter for /works, and the member would otherwise be ` +
        `silently dropped. CROSSREF_CAPABILITIES.filters.languages is false.`,
    );
  }
  if (query.openAccessOnly === true && !CROSSREF_FILTERS.openAccess) {
    throw new RangeError(
      `[research-helper] Crossref cannot express SourceQuery.openAccessOnly: ` +
        `docs/02 §5.2 documents has-license and has-full-text filters, ` +
        `neither of which means open access, and the member would otherwise ` +
        `be silently dropped. CROSSREF_CAPABILITIES.filters.openAccess ` +
        `is false.`,
    );
  }
}

/** What {@link buildCrossrefWorksRequest} is told, beyond the query. */
export interface CrossrefWorksOptions {
  /** The normalized query. `terms`, `fromDate`, `toDate` and `raw` are read. */
  readonly query: SourceQuery;
  /** `rows`, 1 … 1000 (`docs/02` §5.2). `crossrefSource.ts` clamps. */
  readonly rows: number;
  /** `cursor`. Defaults to {@link CROSSREF_FIRST_CURSOR}. */
  readonly cursor?: string;
  /**
   * The `contactEmail` preference's value, resolved by the composition root;
   * absent or blank means the maintainer address fills `mailto` (D10).
   */
  readonly userContactEmail?: string | undefined;
  /** The `select` whitelist. Defaults to {@link CROSSREF_SELECT_FIELDS}. */
  readonly select?: readonly string[];
}

/**
 * A built `/works` request: what to send, and what to store about it.
 *
 * The provenance members are `docs/07` §5.3's `SourceProvenance` names, as on
 * the PubMed and Europe PMC builders. Crossref has no credential, so
 * `transmittedUrl` equals `url` after `redactUrl` has confirmed there is
 * nothing to remove — the backstop runs anyway. The `mailto` value is a
 * contact address, not a secret, and stays in the stored URL as it does for
 * NCBI's `email`.
 */
export interface CrossrefWorksRequest {
  /** Always `"GET"`: `docs/02` §5 documents no POST form for `/works`. */
  readonly method: HttpMethod;
  /** The URL actually transmitted. */
  readonly url: string;
  /** The decoded `query.*` / `filter` rendering — `explainQuery`'s string. */
  readonly renderedQuery: string;
  /** The `NOT` terms dropped from the wire, for the client-side filter. */
  readonly excluded: readonly CrossrefExcludedTerm[];
  /** The `mailto` value sent — which address earned the polite pool. */
  readonly mailto: string;
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
 * a hash of `{method, url-with-keys-redacted, body}` — depends on. Reordering
 * a member silently invalidates every recorded fixture. `query.title` and
 * `query.author` are omitted when empty, `filter` when there is no window;
 * `sort` and `order` are always {@link CROSSREF_SORT} / {@link CROSSREF_ORDER}.
 */
const PARAM_ORDER = [
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
] as const;

type ParamName = (typeof PARAM_ORDER)[number];

/**
 * `raw` keys refused with `RangeError`: everything this module emits itself,
 * plus `query` (it would bypass the parser), `offset` (`docs/02` §5.5: use the
 * cursor) and `sample` (it ignores paging).
 */
export const RESERVED_RAW_PARAMS: ReadonlySet<string> = new Set<string>([
  ...PARAM_ORDER,
  "query",
  "offset",
  "sample",
]);

/**
 * Build one `GET /works` request.
 *
 * @param options - the query and the paging and identity parameters
 *   `crossrefSource.ts` owns
 * @returns the transmitted and the storable forms of the request
 * @throws RangeError when `rows` is outside 1 … 1000 — `docs/02` §5.2's
 *   ceiling, and a silently clamped value here would hide a caller bug behind
 *   a different page than it asked for
 * @throws RangeError when exactly one of `fromDate` / `toDate` is present, or a
 *   bound is not `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (see {@link resolveWindow})
 * @throws RangeError for an unexpressible filter ({@link assertExpressible})
 *   or a reserved `raw` key ({@link RESERVED_RAW_PARAMS})
 */
export function buildCrossrefWorksRequest(
  options: CrossrefWorksOptions,
): CrossrefWorksRequest {
  const { rows } = options;
  if (
    !Number.isInteger(rows) ||
    rows < CROSSREF_ROWS_MIN ||
    rows > CROSSREF_ROWS_MAX
  ) {
    throw new RangeError(
      `[research-helper] Crossref rows must be an integer in ` +
        `${CROSSREF_ROWS_MIN} … ${CROSSREF_ROWS_MAX} (docs/02 §5.2); ` +
        `got ${String(rows)}.`,
    );
  }

  const renderedQuery = explainCrossrefQuery(options.query);
  const rendered = renderCrossrefQuery(options.query.terms);
  const filter = renderFilter(options.query);
  const { mailto } = crossrefContactParams(options.userContactEmail);
  const values: Readonly<Record<ParamName, string | undefined>> = {
    "query.bibliographic": rendered.bibliographic,
    "query.title": rendered.title === "" ? undefined : rendered.title,
    "query.author": rendered.author === "" ? undefined : rendered.author,
    filter,
    sort: CROSSREF_SORT,
    order: CROSSREF_ORDER,
    select: (options.select ?? CROSSREF_SELECT_FIELDS).join(","),
    rows: String(rows),
    cursor: options.cursor ?? CROSSREF_FIRST_CURSOR,
    mailto,
  };
  const rawPairs = renderRawParams(options.query.raw);
  const pairs: string[] = [];
  for (const name of PARAM_ORDER) {
    if (name === "mailto") continue;
    const value = values[name];
    if (value === undefined) continue;
    pairs.push(`${name}=${encodeURIComponent(value)}`);
  }
  const queryString = [
    ...pairs,
    ...rawPairs,
    `mailto=${encodeURIComponent(mailto)}`,
  ].join("&");

  const url = `${CROSSREF_WORKS_URL}?${queryString}`;
  const transmittedUrl = redactUrl(url);
  const queryStart = transmittedUrl.indexOf("?");
  return {
    method: "GET",
    url,
    renderedQuery,
    excluded: rendered.excluded,
    mailto,
    endpointBaseUrl: CROSSREF_WORKS_URL,
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
        `[research-helper] SourceQuery.raw.${key} is reserved on Crossref: ` +
          `the adapter emits that parameter itself, or it would bypass the ` +
          `parser or the cursor (docs/02 §5.2 / §5.5), and raw may add ` +
          `parameters, never replace them.`,
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
 * The `filter` value for a query's date window, or `undefined` when the user
 * asked for all years: `from-pub-date:<from>,until-pub-date:<to>,
 * from-created-date:<from>` (`docs/02` §5.2; the card's step 3).
 */
export function renderFilter(query: SourceQuery): string | undefined {
  const window = resolveWindow(query);
  if (window === undefined) return undefined;
  return (
    `from-pub-date:${window.from},until-pub-date:${window.to},` +
    `from-created-date:${window.from}`
  );
}

/**
 * The window's two bounds, validated, at the precision they arrived.
 *
 * `SourceQuery.fromDate` / `toDate` are ISO (`docs/07` §4.2). Crossref's
 * filter dates "accept `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`" (§5.2), so no
 * widening is needed; a bound is passed through after its shape is checked.
 */
function resolveWindow(
  query: SourceQuery,
): { from: string; to: string } | undefined {
  const { fromDate, toDate } = query;
  if (fromDate === undefined && toDate === undefined) return undefined;
  if (fromDate === undefined || toDate === undefined) {
    throw new RangeError(
      `[research-helper] Crossref needs both date bounds or neither; got ` +
        `fromDate=${JSON.stringify(fromDate)} toDate=${JSON.stringify(toDate)}. ` +
        `docs/02 §5.2 renders the window as from-pub-date and until-pub-date.`,
    );
  }
  for (const bound of [fromDate, toDate]) {
    if (!ISO_DATE.test(bound)) {
      throw new RangeError(
        `[research-helper] Crossref date bound must be YYYY, YYYY-MM or ` +
          `YYYY-MM-DD; got ${JSON.stringify(bound)}.`,
      );
    }
  }
  return { from: fromDate, to: toDate };
}
