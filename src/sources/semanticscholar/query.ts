/**
 * Semantic Scholar query rendering and request building (`P2-T05` steps 1, 2, 5).
 *
 * **Two renderings for two endpoints** (`docs/02` §12.2, "Semantic Scholar"):
 *
 * - {@link renderBulkQuery} — `/paper/search/bulk`, the endpoint with real
 *   operators (§6.6): `AND` → `+`, `OR` → `|`, `NOT` → `-`, phrases keep their
 *   quotes, groups keep their parentheses. §12.2's example renders to exactly
 *   `("base editing" | "prime editing") + CRISPR - mouse`.
 * - {@link renderPlainQuery} — `/paper/search`, which takes **plain text only,
 *   no query syntax** (§6.5): a bag of the positive words, `NOT` subtrees
 *   dropped and returned to the caller so the adapter can say so.
 *
 * **Hyphens first, `-` second** (§12.2: "Replace `-` inside a term with a
 * space *before* using `-` as the NOT operator, or the two collide"; §6.5:
 * "Hyphenated terms yield no matches"). {@link normalizeTermValue} does the
 * replacement on every term *value* before any operator is written, so the
 * only `-` that reaches the wire is the operator this module emits. A value
 * that splits into several words is parenthesised — `(CRISPR Cas9)` — which
 * is §6.6's own spelling for a grouped implicit AND (`(fish ladder) | outflow`)
 * and keeps it from binding to a neighbouring `|`.
 *
 * **There is no field syntax** (§12.2: "`title:` prefixes are dropped"; §12.3's
 * S2 column has *n/a* in every field row). {@link SEMANTICSCHOLAR_RENDERED_FIELDS}
 * is therefore empty and `normalizeForSource` against the adapter's
 * capabilities names every fielded term as a loss, which the adapter reports
 * on `SourcePage.warnings`.
 *
 * **What is refused by name, before it costs a request.** A `NOT` with nothing
 * positive beside it (`- mouse` alone has nothing to subtract from), a `NOT`
 * under an `OR` (the bulk grammar has no place for it), a tree that renders to
 * nothing, a malformed date bound, a `languages` filter (no Semantic Scholar
 * form exists in the corpus — {@link SEMANTICSCHOLAR_FILTERS}),
 * `openAccessOnly` on the bulk endpoint (`docs/02` §12.3: "bulk: *not
 * documented*"; `/paper/search` renders §6.5's `openAccessPdf` flag) and a
 * `raw` key that would displace an emitted parameter.
 *
 * **The date window** is `publicationDateOrYear=<from>:<to>` (§6.5, §12.3's
 * Date range cell), the precise form; §12.2's plain-text block also writes
 * `year=2024-2026`, which the precise range subsumes and this module does not
 * duplicate. A half-open bound is allowed because §6.5 allows it
 * (`1981-08-25:`, `:2015-01`).
 *
 * **`fields=`.** {@link SEMANTICSCHOLAR_SEARCH_FIELDS} is every field
 * `./mapper.ts` reads. **Measured 2026-10-15 (`P2-T05`, the one live probe):
 * `/paper/search/bulk` answers HTTP 400 `Unrecognized or unsupported fields:
 * [tldr]`** — the bulk endpoint does not serve `tldr`, although `docs/02` §6.7
 * lists it in the full field set — so {@link SEMANTICSCHOLAR_BULK_FIELDS} is the
 * search list without it, and `tldr` is requested on `/paper/batch` and
 * `/paper/search` only. `embedding` is never requested (§6.9: bare `embedding`
 * is SPECTER v1 and ~16 KB per paper; embeddings are Phase 5's).
 *
 * **No credential is ever in a URL.** The key travels as the `x-api-key`
 * header (§6.4) and is the adapter's business; `transmittedUrl` is still put
 * through `redactUrl` so the invariant holds mechanically.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3). Nothing
 * here names the `Zotero` global, reads a preference or touches a file.
 */

import { redactUrl } from "../../core/errors";
import { SEMANTICSCHOLAR_HOST } from "../../core/rateLimit/hostLimiter";
import type {
  QueryField,
  QueryNode,
  SourceCapabilities,
  SourceQuery,
} from "../types";

// ---------------------------------------------------------------------------
// 1. Endpoints and limits — docs/02 §6.1, §6.2, §6.5, §6.8
// ---------------------------------------------------------------------------

/** `docs/02` §6.1: the Academic Graph base. */
export const SEMANTICSCHOLAR_GRAPH_BASE_URL = `https://${SEMANTICSCHOLAR_HOST}/graph/v1`;

/** §6.6: bulk retrieval with real query syntax and `token` pagination. */
export const SEMANTICSCHOLAR_BULK_SEARCH_URL = `${SEMANTICSCHOLAR_GRAPH_BASE_URL}/paper/search/bulk`;

/** §6.5: relevance-ranked search, plain text only, `limit ≤ 100`. */
export const SEMANTICSCHOLAR_RELEVANCE_SEARCH_URL = `${SEMANTICSCHOLAR_GRAPH_BASE_URL}/paper/search`;

/** §6.8: up to 500 ids per POST, positionally aligned answer. */
export const SEMANTICSCHOLAR_BATCH_URL = `${SEMANTICSCHOLAR_GRAPH_BASE_URL}/paper/batch`;

/** §6.7: one paper by any §6.3 id form; `/paper/{id}` is appended. */
export const SEMANTICSCHOLAR_PAPER_URL = `${SEMANTICSCHOLAR_GRAPH_BASE_URL}/paper`;

/** The smallest page either search endpoint accepts. */
export const SEMANTICSCHOLAR_PAGE_SIZE_MIN = 1;

/**
 * §6.5: `limit ≤ 100` on `/paper/search`; the card's step 7 fixes
 * `maxPageSize: 100`, and the same cap is applied to the bulk request so one
 * page never exceeds what a relevance page may hold.
 */
export const SEMANTICSCHOLAR_PAGE_SIZE_MAX = 100;

/** §6.5: on `/paper/search`, `offset + limit` is capped at 1000. */
export const SEMANTICSCHOLAR_RELEVANCE_DEPTH_MAX = 1000;

/** §6.8: documented maximum ids per `/paper/batch` call. */
export const SEMANTICSCHOLAR_BATCH_IDS_MAX = 500;

/**
 * §6.8: "with `abstract` requested, keep batches to ~100 IDs" — the 10 MB
 * response cap. Every batch this module builds requests `abstract`, so this
 * is the batch size the adapter uses.
 */
export const SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT = 100;

/**
 * Every field `./mapper.ts` reads, in `docs/02` §6.7's order, as the `fields=`
 * value of a `/paper/batch` or `/paper/search` request. `embedding` is
 * deliberately absent (§6.9).
 */
export const SEMANTICSCHOLAR_SEARCH_FIELDS: readonly string[] = [
  "paperId",
  "corpusId",
  "externalIds",
  "url",
  "title",
  "abstract",
  "venue",
  "publicationVenue",
  "year",
  "publicationDate",
  "referenceCount",
  "citationCount",
  "influentialCitationCount",
  "isOpenAccess",
  "openAccessPdf",
  "fieldsOfStudy",
  "s2FieldsOfStudy",
  "publicationTypes",
  "journal",
  "authors",
  "tldr",
];

/**
 * {@link SEMANTICSCHOLAR_SEARCH_FIELDS} without `tldr`: the list
 * `/paper/search/bulk` accepts. Measured 2026-10-15 — see the header.
 */
export const SEMANTICSCHOLAR_BULK_FIELDS: readonly string[] =
  SEMANTICSCHOLAR_SEARCH_FIELDS.filter((field) => field !== "tldr");

/**
 * `docs/02` §10.4's backfill pass: `fields=abstract,tldr`, 100 DOIs per call.
 * `paperId` is always returned (§6.5) and is what the answer is keyed by.
 */
export const SEMANTICSCHOLAR_ABSTRACT_FIELDS: readonly string[] = [
  "paperId",
  "externalIds",
  "abstract",
  "tldr",
];

/**
 * `docs/09` §2.3's Semantic Scholar test call: one fixed public paper
 * (`docs/02` §6.7's worked example) with `fields=paperId`, "the smallest
 * response the API will return".
 */
export const SEMANTICSCHOLAR_HEALTH_PAPER_ID = "DOI:10.1038/s41586-023-06139-9";

/** The `fields=` of the health probe — `paperId` is always returned (§6.5). */
export const SEMANTICSCHOLAR_HEALTH_FIELDS: readonly string[] = ["paperId"];

// ---------------------------------------------------------------------------
// 2. The two renderings — docs/02 §12.2, §6.5, §6.6
// ---------------------------------------------------------------------------

/**
 * §12.3's S2 bulk column has *n/a* in every field row: nothing is rendered
 * field-restricted, so this is empty and every fielded term is a reported loss.
 */
export const SEMANTICSCHOLAR_RENDERED_FIELDS: readonly QueryField[] = [];

/** The §6.6 operator characters a term value may not carry into the wire. */
const BULK_OPERATOR_CHARS = /["()|+*~]/gu;

/**
 * One term value, made safe for either endpoint: **hyphens become spaces
 * first** (§12.2's rule, §6.5's "hyphenated terms yield no matches"), then
 * the bulk operator characters are removed and whitespace collapsed.
 *
 * @param value - the user's term as the parser produced it
 * @returns the cleaned value, possibly several words, possibly empty
 */
export function normalizeTermValue(value: string): string {
  return value
    .replace(/-/gu, " ")
    .replace(BULK_OPERATOR_CHARS, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** A positive bulk rendering and the `NOT` children to append after it. */
interface BulkParts {
  readonly positive: readonly string[];
  readonly negative: readonly string[];
}

/** One term for the bulk endpoint: quoted phrase, grouped words, or a word. */
function renderBulkTerm(node: {
  readonly value: string;
  readonly phrase?: boolean;
}): string | undefined {
  const value = normalizeTermValue(node.value);
  if (value === "") return undefined;
  if (node.phrase === true) return `"${value}"`;
  return value.includes(" ") ? `(${value})` : value;
}

/**
 * Render one node for the bulk endpoint. `nested` says whether the result
 * sits inside another group and must therefore be parenthesised when it is a
 * conjunction; a disjunction is always parenthesised, because `|` would
 * otherwise bind to whatever `+` stands beside it.
 */
function renderBulkNode(node: QueryNode, nested: boolean): string | undefined {
  switch (node.kind) {
    case "term":
      return renderBulkTerm(node);
    case "or": {
      const children = node.children
        .map((child) => {
          if (child.kind === "not") {
            throw new RangeError(
              "[research-helper] Semantic Scholar's bulk query syntax has no " +
                "place for a NOT under an OR; rewrite the query so every " +
                "exclusion sits beside a positive clause.",
            );
          }
          return renderBulkNode(child, true);
        })
        .filter((child): child is string => child !== undefined);
      if (children.length === 0) return undefined;
      if (children.length === 1) return children[0];
      return `(${children.join(" | ")})`;
    }
    case "and": {
      const parts = collectBulkParts(node.children);
      if (parts.positive.length === 0) {
        if (parts.negative.length === 0) return undefined;
        throw new RangeError(
          "[research-helper] Semantic Scholar's bulk query needs a positive " +
            "clause to subtract from; a query of only NOT terms cannot be sent.",
        );
      }
      const positive = parts.positive.join(" + ");
      const negative = parts.negative.map((n) => ` - ${n}`).join("");
      const rendered = `${positive}${negative}`;
      return nested && parts.positive.length + parts.negative.length > 1
        ? `(${rendered})`
        : rendered;
    }
    case "not":
      throw new RangeError(
        "[research-helper] Semantic Scholar's bulk query needs a positive " +
          "clause to subtract from; a query of only NOT terms cannot be sent.",
      );
  }
}

/** Split an `and`'s children into the positives and the `NOT` operands. */
function collectBulkParts(children: readonly QueryNode[]): BulkParts {
  const positive: string[] = [];
  const negative: string[] = [];
  for (const child of children) {
    if (child.kind === "not") {
      const operand = renderBulkNode(child.child, true);
      if (operand !== undefined) negative.push(operand);
      continue;
    }
    const rendered = renderBulkNode(child, true);
    if (rendered !== undefined) positive.push(rendered);
  }
  return { positive, negative };
}

/**
 * `docs/02` §12.2's bulk rendering: `+` for AND, `|` for OR, `-` for NOT,
 * quotes kept on phrases, parentheses kept on groups, field prefixes dropped.
 *
 * @param node - the query tree
 * @returns the `query=` value for `/paper/search/bulk`, or `""` when nothing
 *   in the tree renders
 * @throws RangeError for a `NOT` with no positive clause beside it, or a `NOT`
 *   under an `OR`
 */
export function renderBulkQuery(node: QueryNode): string {
  return renderBulkNode(node, false) ?? "";
}

/** A `NOT` term `/paper/search` cannot carry, returned to the caller. */
export interface SemanticScholarExcludedTerm {
  readonly value: string;
  readonly field: QueryField | undefined;
}

/** The plain-text rendering and what it dropped. */
export interface PlainQueryRendering {
  /** The `query=` value for `/paper/search`: words separated by one space. */
  readonly text: string;
  /** Every `NOT` subtree's terms, in order; never on the wire. */
  readonly excluded: readonly SemanticScholarExcludedTerm[];
}

/**
 * `docs/02` §12.2's plain-text rendering for `/paper/search`: every positive
 * term's words in order, no quotes, no operators, no field prefixes; `NOT`
 * subtrees are dropped and returned so the adapter can report the loss.
 * §12.2's example renders to `base editing prime editing CRISPR`.
 *
 * @param node - the query tree
 * @returns the text and the excluded terms
 */
export function renderPlainQuery(node: QueryNode): PlainQueryRendering {
  const words: string[] = [];
  const excluded: SemanticScholarExcludedTerm[] = [];
  const collectExcluded = (current: QueryNode): void => {
    switch (current.kind) {
      case "term":
        excluded.push({ value: current.value, field: current.field });
        return;
      case "and":
      case "or":
        for (const child of current.children) collectExcluded(child);
        return;
      case "not":
        collectExcluded(current.child);
    }
  };
  const visit = (current: QueryNode): void => {
    switch (current.kind) {
      case "term": {
        const value = normalizeTermValue(current.value);
        if (value !== "") words.push(value);
        return;
      }
      case "and":
      case "or":
        for (const child of current.children) visit(child);
        return;
      case "not":
        collectExcluded(current.child);
    }
  };
  visit(node);
  return { text: words.join(" "), excluded };
}

// ---------------------------------------------------------------------------
// 3. The three optional SourceQuery filters — the P2-T20 pattern
// ---------------------------------------------------------------------------

/**
 * Semantic Scholar's answer to `docs/07` §4.2's `SourceCapabilities.filters`,
 * for the **default search path** — `/paper/search/bulk`, what `search()`,
 * `searchAll()` and `explainQuery()` render — read off `docs/02` §12.3's S2
 * bulk column. `languages`: the Language row is *n/a*, so a non-empty list is
 * refused by name rather than dropped. `openAccess`: the Open-access row reads
 * "`openAccessPdf` flag on `/paper/search` (§6.5); bulk: *not documented*"
 * (row added 2026-10-15), so `openAccessOnly: true` is refused by name here
 * rather than sent as an undocumented flag the bulk endpoint may ignore — the
 * `P2-T20` rule. **The object `SEMANTICSCHOLAR_CAPABILITIES.filters` is**
 * (`semanticscholarSource.ts` assigns this constant), and the bulk renderers
 * refuse from it, so the declaration and the renderer cannot drift
 * (`P2-T34`). The relevance endpoint's answers are
 * {@link SEMANTICSCHOLAR_RELEVANCE_FILTERS}.
 */
export const SEMANTICSCHOLAR_FILTERS: SourceCapabilities["filters"] = {
  languages: false,
  openAccess: false,
};

/**
 * The same two for `/paper/search` (`searchByRelevance`), the one endpoint
 * where §6.5 documents the valueless `openAccessPdf` flag. Adapter-level: the
 * capabilities describe the default path, and this endpoint is an extra
 * method of this adapter only.
 */
export const SEMANTICSCHOLAR_RELEVANCE_FILTERS: SourceCapabilities["filters"] =
  {
    languages: false,
    openAccess: true,
  };

/**
 * The optional `SourceQuery` member that stays adapter-level: `raw`.
 * `languages` and `openAccessOnly` moved to {@link SEMANTICSCHOLAR_FILTERS} on
 * 2026-10-15 (`P2-T34`).
 */
export type SemanticScholarQueryFilter = keyof Pick<SourceQuery, "raw">;

/**
 * Whether `raw` is honoured, on both endpoints: `true` — extra parameters,
 * appended sorted by key, never one {@link RESERVED_RAW_PARAMS} names.
 */
export const SEMANTICSCHOLAR_QUERY_FILTER_SUPPORT: Readonly<
  Record<SemanticScholarQueryFilter, boolean>
> = {
  raw: true,
};

/** §6.5's valueless open-access flag, written bare (no `=`). */
export const SEMANTICSCHOLAR_OPEN_ACCESS_FLAG = "openAccessPdf";

/**
 * Every parameter name this module emits on either search endpoint, plus the
 * ones whose meaning `raw` must not be allowed to take over. A `raw` key that
 * collides is refused with `RangeError`.
 */
export const RESERVED_RAW_PARAMS: readonly string[] = [
  "query",
  "fields",
  "publicationDateOrYear",
  "limit",
  "token",
  "offset",
  SEMANTICSCHOLAR_OPEN_ACCESS_FLAG,
];

/** A date bound §6.5 accepts: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
const DATE_BOUND = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u;

/**
 * `publicationDateOrYear=<from>:<to>` (§6.5). Either bound may be absent
 * (§6.5's open-ended forms); both absent means no filter.
 *
 * @param fromDate - inclusive lower bound, ISO date or prefix
 * @param toDate - inclusive upper bound, ISO date or prefix
 * @returns the parameter value, or `undefined` when neither bound is set
 * @throws RangeError for a bound that is not a `YYYY[-MM[-DD]]` prefix
 */
export function renderPublicationDateFilter(
  fromDate: string | undefined,
  toDate: string | undefined,
): string | undefined {
  if (fromDate === undefined && toDate === undefined) return undefined;
  for (const bound of [fromDate, toDate]) {
    if (bound !== undefined && !DATE_BOUND.test(bound)) {
      throw new RangeError(
        `[research-helper] Semantic Scholar date bound ${JSON.stringify(bound)} ` +
          `is not a YYYY, YYYY-MM or YYYY-MM-DD value (docs/02 §6.5).`,
      );
    }
  }
  return `${fromDate ?? ""}:${toDate ?? ""}`;
}

/**
 * Refuse what the endpoint whose `filters` are given cannot express —
 * {@link SEMANTICSCHOLAR_FILTERS} (the capabilities' own object) for bulk,
 * {@link SEMANTICSCHOLAR_RELEVANCE_FILTERS} for `/paper/search`.
 * `languages` is refused on both endpoints; `openAccessOnly: true` on the
 * bulk endpoint only (`false` is the same as absent).
 */
function assertExpressible(
  query: SourceQuery,
  filters: SourceCapabilities["filters"],
): void {
  if (
    !filters.languages &&
    query.languages !== undefined &&
    query.languages.length > 0
  ) {
    throw new RangeError(
      "[research-helper] Semantic Scholar has no language filter " +
        "(SEMANTICSCHOLAR_CAPABILITIES.filters.languages is false); drop " +
        "`languages` for this source.",
    );
  }
  if (!filters.openAccess && query.openAccessOnly === true) {
    throw new RangeError(
      "[research-helper] Semantic Scholar's bulk search documents no " +
        "open-access filter (docs/02 §12.3; " +
        "SEMANTICSCHOLAR_CAPABILITIES.filters.openAccess is false) — the " +
        "openAccessPdf flag is /paper/search's (§6.5); drop `openAccessOnly` " +
        "for this source or use its relevance search.",
    );
  }
  for (const name of Object.keys(query.raw ?? {})) {
    if (RESERVED_RAW_PARAMS.includes(name)) {
      throw new RangeError(
        `[research-helper] raw parameter ${JSON.stringify(name)} is reserved: ` +
          `it is emitted by the Semantic Scholar request builder and may not ` +
          `be replaced through raw.`,
      );
    }
  }
}

/** One `name=value` pair, both halves percent-encoded. */
function pair(name: string, value: string): string {
  return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}

/** `raw` as pairs, sorted by key so the URL is byte-stable for fixtures. */
function rawPairs(raw: SourceQuery["raw"]): readonly string[] {
  return Object.entries(raw ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => pair(name, String(value)));
}

// ---------------------------------------------------------------------------
// 4. Requests
// ---------------------------------------------------------------------------

/** One request exactly as the adapter issues it. */
export interface SemanticScholarRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  /**
   * `redactUrl(url)`. No request this module builds carries a credential in
   * its URL — the key is a header — so this equals `url`; it is kept so the
   * invariant is mechanical and so every log line uses one name for it.
   */
  readonly transmittedUrl: string;
  /** The endpoint without its query string, for fixture sidecars. */
  readonly endpointBaseUrl: string;
  /** The JSON body, on a POST only. Never carries a credential. */
  readonly body?: string;
  /** `Content-Type` for the body, on a POST only. */
  readonly contentType?: string;
}

/** A `/paper/search/bulk` request. */
export interface SemanticScholarBulkRequest extends SemanticScholarRequest {
  readonly method: "GET";
  /** The rendered `query=` value. */
  readonly rendered: string;
  readonly limit: number;
  /** The `token` sent, or `undefined` on the first page. */
  readonly token: string | undefined;
}

/** A `/paper/search` request. */
export interface SemanticScholarRelevanceRequest extends SemanticScholarRequest {
  readonly method: "GET";
  readonly rendered: PlainQueryRendering;
  readonly limit: number;
  readonly offset: number;
}

/** A `/paper/batch` request. */
export interface SemanticScholarBatchRequest extends SemanticScholarRequest {
  readonly method: "POST";
  readonly body: string;
  readonly contentType: "application/json";
  /** The ids in the body, in order — what the answer is aligned with. */
  readonly ids: readonly string[];
}

/** What {@link buildBulkSearchRequest} takes. */
export interface BulkSearchOptions {
  readonly query: SourceQuery;
  /** The page size, already clamped by the adapter. */
  readonly limit: number;
  /** The continuation `token` from the previous page, if any. */
  readonly token?: string;
}

/**
 * Build one `/paper/search/bulk` request (§6.6). Parameter order is fixed —
 * `query`, `fields`, `publicationDateOrYear`, `limit`, `token`, then `raw`
 * sorted by key — so a fixture's hash is stable.
 *
 * @param options - the query, the clamped page size and the token
 * @returns the request
 * @throws RangeError when the tree renders to nothing, carries a `NOT` with
 *   nothing to subtract from or under an `OR`, a `languages` list,
 *   `openAccessOnly: true` (§12.3: not documented on bulk), a bad date bound
 *   or a reserved `raw` key
 */
export function buildBulkSearchRequest(
  options: BulkSearchOptions,
): SemanticScholarBulkRequest {
  const { query, limit, token } = options;
  assertExpressible(query, SEMANTICSCHOLAR_FILTERS);
  assertPageSize(limit);
  const rendered = renderBulkQuery(query.terms);
  if (rendered === "") {
    throw new RangeError(
      "[research-helper] the query renders to nothing Semantic Scholar can " +
        "search for; refusing to issue an empty bulk search.",
    );
  }
  const window = renderPublicationDateFilter(query.fromDate, query.toDate);
  const parts: string[] = [
    pair("query", rendered),
    pair("fields", SEMANTICSCHOLAR_BULK_FIELDS.join(",")),
  ];
  if (window !== undefined) parts.push(pair("publicationDateOrYear", window));
  parts.push(pair("limit", String(limit)));
  if (token !== undefined && token !== "") parts.push(pair("token", token));
  parts.push(...rawPairs(query.raw));
  const url = `${SEMANTICSCHOLAR_BULK_SEARCH_URL}?${parts.join("&")}`;
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: SEMANTICSCHOLAR_BULK_SEARCH_URL,
    rendered,
    limit,
    token: token === undefined || token === "" ? undefined : token,
  };
}

/** What {@link buildRelevanceSearchRequest} takes. */
export interface RelevanceSearchOptions {
  readonly query: SourceQuery;
  /** The page size, already clamped by the adapter. */
  readonly limit: number;
  /** The 0-based offset, already clamped by the adapter. */
  readonly offset: number;
}

/**
 * Build one `/paper/search` request (§6.5): plain text, `offset`/`limit`,
 * `offset + limit ≤ 1000`. Parameter order: `query`, `fields`,
 * `publicationDateOrYear`, `openAccessPdf`, `offset`, `limit`, `raw` sorted.
 *
 * @param options - the query and the clamped page
 * @returns the request
 * @throws RangeError when the text renders to nothing, the page would pass
 *   the 1000-record depth, or a filter cannot be expressed
 */
export function buildRelevanceSearchRequest(
  options: RelevanceSearchOptions,
): SemanticScholarRelevanceRequest {
  const { query, limit, offset } = options;
  assertExpressible(query, SEMANTICSCHOLAR_RELEVANCE_FILTERS);
  assertPageSize(limit);
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset + limit > SEMANTICSCHOLAR_RELEVANCE_DEPTH_MAX
  ) {
    throw new RangeError(
      `[research-helper] Semantic Scholar /paper/search caps offset + limit at ` +
        `${String(SEMANTICSCHOLAR_RELEVANCE_DEPTH_MAX)} (docs/02 §6.5); got ` +
        `offset ${String(offset)}, limit ${String(limit)}.`,
    );
  }
  const rendered = renderPlainQuery(query.terms);
  if (rendered.text === "") {
    throw new RangeError(
      "[research-helper] the query renders to no plain text Semantic Scholar " +
        "can search for; refusing to issue an empty relevance search.",
    );
  }
  const window = renderPublicationDateFilter(query.fromDate, query.toDate);
  const parts: string[] = [
    pair("query", rendered.text),
    pair("fields", SEMANTICSCHOLAR_SEARCH_FIELDS.join(",")),
  ];
  if (window !== undefined) parts.push(pair("publicationDateOrYear", window));
  if (query.openAccessOnly === true)
    parts.push(SEMANTICSCHOLAR_OPEN_ACCESS_FLAG);
  parts.push(pair("offset", String(offset)), pair("limit", String(limit)));
  parts.push(...rawPairs(query.raw));
  const url = `${SEMANTICSCHOLAR_RELEVANCE_SEARCH_URL}?${parts.join("&")}`;
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: SEMANTICSCHOLAR_RELEVANCE_SEARCH_URL,
    rendered,
    limit,
    offset,
  };
}

/** `limit` must be a whole number inside §6.5's 1 … 100. */
function assertPageSize(limit: number): void {
  if (
    !Number.isInteger(limit) ||
    limit < SEMANTICSCHOLAR_PAGE_SIZE_MIN ||
    limit > SEMANTICSCHOLAR_PAGE_SIZE_MAX
  ) {
    throw new RangeError(
      `[research-helper] Semantic Scholar page size must be ` +
        `${String(SEMANTICSCHOLAR_PAGE_SIZE_MIN)} … ` +
        `${String(SEMANTICSCHOLAR_PAGE_SIZE_MAX)} (docs/02 §6.5); got ${String(limit)}.`,
    );
  }
}

/**
 * Build one `/paper/batch` POST (§6.8): `fields` in the query string, the ids
 * as the JSON body `{"ids":[…]}`, at most {@link SEMANTICSCHOLAR_BATCH_IDS_MAX}
 * of them.
 *
 * @param ids - §6.3-prefixed ids (`DOI:…`, `PMID:…`, `PMCID:…`, `ARXIV:…`,
 *   `CorpusId:…`), in the order the answer will be aligned with
 * @param fields - the `fields=` list; defaults to the full search set
 * @returns the request
 * @throws RangeError for an empty list or one over the documented maximum
 */
export function buildBatchRequest(
  ids: readonly string[],
  fields: readonly string[] = SEMANTICSCHOLAR_SEARCH_FIELDS,
): SemanticScholarBatchRequest {
  if (ids.length === 0) {
    throw new RangeError(
      "[research-helper] /paper/batch needs at least one id (docs/02 §6.8).",
    );
  }
  if (ids.length > SEMANTICSCHOLAR_BATCH_IDS_MAX) {
    throw new RangeError(
      `[research-helper] /paper/batch takes at most ` +
        `${String(SEMANTICSCHOLAR_BATCH_IDS_MAX)} ids (docs/02 §6.8); got ` +
        `${String(ids.length)}.`,
    );
  }
  const url = `${SEMANTICSCHOLAR_BATCH_URL}?${pair("fields", fields.join(","))}`;
  return {
    method: "POST",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: SEMANTICSCHOLAR_BATCH_URL,
    body: JSON.stringify({ ids }),
    contentType: "application/json",
    ids,
  };
}

/**
 * Build one `/paper/{id}` GET (§6.7). The health probe uses it with
 * {@link SEMANTICSCHOLAR_HEALTH_PAPER_ID} and {@link SEMANTICSCHOLAR_HEALTH_FIELDS},
 * which is `docs/09` §2.3's test call for `source.semanticscholar` exactly.
 *
 * @param paperId - any §6.3 id form
 * @param fields - the `fields=` list
 * @returns the request
 */
export function buildPaperRequest(
  paperId: string,
  fields: readonly string[] = SEMANTICSCHOLAR_SEARCH_FIELDS,
): SemanticScholarRequest {
  const url = `${SEMANTICSCHOLAR_PAPER_URL}/${encodePaperId(paperId)}?${pair("fields", fields.join(","))}`;
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: SEMANTICSCHOLAR_PAPER_URL,
  };
}

/**
 * A §6.3 id in a path segment: the prefix colon and a DOI's slash are kept
 * (§6.7's own URL spells `DOI:10.1038/s41586-023-06139-9` literally); every
 * other reserved character is percent-encoded.
 */
export function encodePaperId(paperId: string): string {
  return paperId
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%3A/giu, ":"))
    .join("/");
}

/**
 * The native rendering for the UI preview and the provenance record
 * (`LiteratureSource.explainQuery`): the bulk query string as §12.2's block
 * writes it, `query=…&publicationDateOrYear=…`, unencoded.
 *
 * @param query - the search
 * @returns the preview text
 * @throws RangeError as {@link buildBulkSearchRequest} does, so an
 *   unrenderable query is refused before any request
 */
export function explainSemanticScholarQuery(query: SourceQuery): string {
  assertExpressible(query, SEMANTICSCHOLAR_FILTERS);
  const rendered = renderBulkQuery(query.terms);
  const window = renderPublicationDateFilter(query.fromDate, query.toDate);
  const parts = [`query=${rendered}`];
  if (window !== undefined) parts.push(`publicationDateOrYear=${window}`);
  return parts.join("&");
}
