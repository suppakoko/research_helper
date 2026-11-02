/**
 * The Semantic Scholar adapter: `/paper/search/bulk` with `token` paging as the
 * search path, `/paper/search` when relevance ranking is asked for by name,
 * `/paper/batch` for index-matched lookups, the `x-api-key` header exactly when
 * the keystore holds a key, and graceful degradation onto the shared anonymous
 * pool when it does not.
 *
 * **Scope.** `P2-T05`. `docs/07` §4.2's `LiteratureSource`, implemented for
 * `api.semanticscholar.org`. Query *rendering* and request *building* are
 * `./query.ts`'s; paper JSON → `SourceRecord` is `./mapper.ts` and arrives as
 * {@link SemanticScholarSourceDeps.mapRecords}.
 *
 * ## What this file decides, and where each decision comes from
 *
 * - **Semantic Scholar is an enhancer, never a hard dependency** (`docs/10` §5
 *   open question 8, `docs/11` R-3, the card's Goal). With no key the adapter
 *   still issues every request — the anonymous pool answers intermittently
 *   (`docs/02` §6.4) — and says so: every unkeyed page carries
 *   {@link SEMANTICSCHOLAR_UNKEYED_NOTE} on `SourcePage.warnings`, and an
 *   unkeyed 429 is rethrown as {@link SemanticScholarRateLimitError}, a
 *   `RateLimitError` whose message carries the same note, so the pipeline's
 *   per-source report names the remedy rather than a bare "rate limited". The
 *   pipeline (`src/pipeline/searchImport/stages.ts`, `fetchOne`) already turns
 *   one source's error into that source's row and lets the other sources
 *   finish, which is the "other sources' results are unaffected" half of the
 *   card's first criterion. **`isConfigured()` is therefore `true`**: §4.2
 *   defines it as "usable right now (e.g. required key present)" and the key
 *   is not required. The card's step 3 asks for `isConfigured()` "from key
 *   presence", but `SourceRegistry.listConfigured()` would then hide this
 *   source from every unkeyed user — the opposite of the card's Goal and of
 *   `docs/10` FR-2's third scenario, which shows an unconfigured Semantic
 *   Scholar *with a notice*. Key presence is {@link SemanticScholarSource.hasApiKey}.
 * - **The key is read at request time through the `SecretStore` port**
 *   (`src/core/secretStore.ts`, `SecretId` `source.semanticscholar`, `docs/09`
 *   §1.7), as the PubMed adapter reads `source.ncbi`: per call, never cached,
 *   so a key added or cleared in the preferences pane takes effect on the next
 *   request; a store that throws degrades to unkeyed with one `warn` line. The
 *   value goes into the `x-api-key` header (`docs/02` §6.4) and **nowhere
 *   else**: not a URL (`transmittedUrl` is `redactUrl`'s and this module never
 *   logs a header), not a log line (the client logs `{method, host, path,
 *   status, ms, url}` and this file logs the redacted URL, the status and the
 *   boolean `keyed`), not a fixture (`scripts/record-fixtures.ts`'s search
 *   scenarios are unauthenticated, its relatedness scenarios are the owner's with
 *   the key in the process environment, `docs/13` §3.2, and neither path writes
 *   the header). *Corrected 2026-11-02 (`P5-T05`): this read "records
 *   unauthenticated".* D5: no preference is written here or anywhere in
 *   `sources/`.
 * - **Phase 5's calls send nothing without a key** (`P5-T05`, `P5-T06`; `plan/08`
 *   §0.2 item 19; `docs/07` §4.2's note of 2026-11-02). {@link SemanticScholarSource.findRelated},
 *   {@link SemanticScholarSource.matchTitle} and {@link SemanticScholarSource.recommend}
 *   read the key first and, without one, return an empty answer and no request. That
 *   is the opposite of the search path above, on purpose: the rule is Phase 5's
 *   only, and no search calls these three.
 * - **The budget is the same with or without a key.** `docs/07` §7.3's
 *   `api.semanticscholar.org` row — 0.9/s in both modes, burst 1, max
 *   concurrent 1 — is enforced by the one bucket the HTTP client paces every
 *   request to {@link SEMANTICSCHOLAR_HOST} through; this adapter's
 *   `rateLimitKey` is that host, and nothing here loops, sleeps or opens a
 *   second connection. A key changes the *guarantee* (1 RPS guaranteed instead
 *   of a share of a saturated pool), not the number.
 * - **Bulk is the search path; relevance ranking is opt-in by name.**
 *   `docs/02` §6.6: "Use bulk for feature 1 and feature 6 candidate
 *   generation; use `/paper/search` only when relevance ranking matters more
 *   than recall." `search()` is bulk; {@link SemanticScholarSource.searchByRelevance}
 *   is the plain-text endpoint, whose rendering drops `NOT` terms (§6.5 has
 *   no syntax) and says so on `warnings`. Pagination is `token` on bulk
 *   (§6.6) and `offset` on relevance, capped at §6.5's 1000-record depth.
 * - **`lookup()` is `/paper/batch`, index-matched, ~100 ids per call.** §6.8:
 *   "unknown IDs come back as `null` entries, so index-match rather than
 *   assuming a 1:1 non-null mapping", and "with `abstract` requested, keep
 *   batches to ~100 IDs" for the 10 MB cap. Every id is sent in §6.3's
 *   prefixed form ({@link toSemanticScholarId}); the mapper skips a `null`
 *   without shifting its neighbours, and the count of unknown ids is logged.
 * - **`fetchAbstract()`** is one `/paper/batch` of one id with
 *   `fields=abstract,tldr`, returning the abstract, or the TL;DR when the
 *   abstract is missing (§6.7). **The backfill pass does not call it**
 *   (`P2-T12`): one request per record is what `docs/02` §10.4 forbids, so
 *   §10.4's step 2 is `lookup()` above, batched ~100 ids a request, read
 *   by `src/pipeline/searchImport/backfill.ts`.
 * - **`healthCheck()` is `docs/09` §2.3's test call**, verbatim: `GET
 *   /graph/v1/paper/DOI:10.1038/s41586-023-06139-9?fields=paperId`, the
 *   `x-api-key` header when a key is present, `ok` when the body carries a
 *   `paperId`. One fixed public paper, no user content (`docs/09` §4). §2.3
 *   maps a 429 here to *inconclusive*, never a pass; the probe reports the
 *   error's own message key and leaves the enum to the pane.
 * - **Capabilities** are the card's step 7: `benefitsFromApiKey: true`,
 *   `lookupById` DOI / PMID / PMCID / arXiv, `abstractsInSearch: true`,
 *   `relatedByWork` and `citationGraph` true since `P5-T05` (`docs/07` §4.2, `P2-T34`:
 *   the flag means "this adapter exposes `findRelated`"; owner, 2026-10-15, `plan/00`
 *   §6 item 184). Then `maxPageSize: 100`, `dateFilter: true`, and `query` from `docs/02` §12.3's S2 bulk column: `+`, `|`, `-`
 *   and quotes are real, every field cell is *n/a*.
 *
 * ## Errors
 *
 * - A 200 whose body is Semantic Scholar's own error envelope — `{"error": …}`
 *   (§6.10) or `{"message": …, "code": "429"}` (§6.4's 429 shape; one decoder
 *   accepts both) → {@link SourceError} with the upstream text.
 * - Not JSON, or JSON without the expected shape → {@link ParseError}.
 * - **Transport-level failures propagate unwrapped**, as on the other
 *   adapters: the client throws `docs/07` §10.1's classes — with one
 *   exception, the 429, which is rethrown as {@link SemanticScholarRateLimitError}
 *   (still a `RateLimitError`, same `retryAfterMs`, same `httpStatus`, the
 *   original as `cause`) so the remedy travels with it. §6.4: the 429 body is
 *   JSON with `message` and the *string* `"429"`, **no `Retry-After`**, and an
 *   empty `statusText` — nothing here reads any of them; the client's
 *   classification is by status alone.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3). Nothing
 * below names the `Zotero` global, touches a preference or reads a file; the
 * key arrives through the `SecretStore` port; cancellation goes through
 * `ctx.token`, diagnostics through the injected {@link Logger}.
 */

import type { Clock } from "../../core/clock";
import {
  BadRequestError,
  OperationCancelledError,
  ParseError,
  RateLimitError,
  ResearchHelperError,
} from "../../core/errors";
import type { HttpClient, HttpResponse } from "../../core/http/client";
import type { Logger } from "../../core/logger";
import { SEMANTICSCHOLAR_HOST } from "../../core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../core/secretStore";
import type { ExternalIds } from "../../model/ids";
import type { RelationEdge } from "../../model/related";
import type { SourceRecord } from "../../model/sourceRecord";
import { normalizeForSource } from "../shared/queryParse";
import type {
  LiteratureSource,
  QueryField,
  QueryNode,
  RelatedPage,
  RelatedQuery,
  SourceCallContext,
  SourceCapabilities,
  SourceHealth,
  SourcePage,
  SourceQuery,
} from "../types";
import {
  buildCitationsRequest,
  buildReferencesRequest,
  buildTitleMatchRequest,
  parseRelationBody,
  parseSemanticScholarJson,
  parseTitleMatchBody,
  SEMANTICSCHOLAR_RELATION_EDGE_KIND,
  SEMANTICSCHOLAR_RELATION_LIMIT_MAX,
  type SemanticScholarRelation,
} from "./graph";
import {
  readTldr,
  SEMANTICSCHOLAR_SOURCE_ID,
  type SemanticScholarRecordMapper,
} from "./mapper";
import {
  buildBatchRequest,
  buildBulkSearchRequest,
  buildPaperRequest,
  buildRelevanceSearchRequest,
  explainSemanticScholarQuery,
  SEMANTICSCHOLAR_ABSTRACT_FIELDS,
  SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT,
  SEMANTICSCHOLAR_FILTERS,
  SEMANTICSCHOLAR_HEALTH_FIELDS,
  SEMANTICSCHOLAR_HEALTH_PAPER_ID,
  SEMANTICSCHOLAR_PAGE_SIZE_MAX,
  SEMANTICSCHOLAR_PAGE_SIZE_MIN,
  SEMANTICSCHOLAR_RELEVANCE_DEPTH_MAX,
  SEMANTICSCHOLAR_RENDERED_FIELDS,
  type SemanticScholarExcludedTerm,
  type SemanticScholarRequest,
} from "./query";
import {
  buildForPaperRequest,
  buildRecommendRequest,
  clampRecommendLimit,
  identifierKeys,
  isResponseTooLarge,
  parseRecommendationsBody,
  RECOMMEND_MAX_POSITIVES,
  recommendFieldsFor,
  SEMANTICSCHOLAR_SEED_CHECK_FIELDS,
} from "./recommendations";

export { SEMANTICSCHOLAR_SOURCE_ID } from "./mapper";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/**
 * `LiteratureSource.displayNameKey`. A literal, for the reason
 * `PUBMED_DISPLAY_NAME_KEY` and the other three are: `src/sources/**`
 * importing `src/i18n/**` would invent a dependency edge `docs/07` §2.3 does
 * not have. Declared in both `research-helper-mainWindow.ftl` bundles and
 * listed in `src/i18n/keys.ts` (`P2-T05`).
 */
export const SEMANTICSCHOLAR_DISPLAY_NAME_KEY =
  "research-helper-source-semanticscholar";

/** `SourceHealth.messageKey` for a healthy probe. */
export const SEMANTICSCHOLAR_HEALTH_OK_MESSAGE_KEY =
  SEMANTICSCHOLAR_DISPLAY_NAME_KEY;

/** `SourceHealth.messageKey` when the probe failed and carried no key of its own. */
export const SEMANTICSCHOLAR_HEALTH_FAILED_MESSAGE_KEY = "rh-error-source";

/** `docs/09` §1.7's `SecretId` for this source's key. */
export const SEMANTICSCHOLAR_SECRET_ID: SecretId = "source.semanticscholar";

/** `docs/02` §6.4: the one header the key travels in. */
export const SEMANTICSCHOLAR_API_KEY_HEADER = "x-api-key";

/** `docs/02` §6.4: where a free key is requested. */
export const SEMANTICSCHOLAR_KEY_REQUEST_URL =
  "https://www.semanticscholar.org/product/api#api-key-form";

/**
 * The note every unkeyed page carries and every unkeyed 429 is explained
 * with — `docs/02` §6.4's first design decision ("an in-app prompt asking the
 * user to obtain a free S2 key, with a deep link to the form") and `docs/10`
 * FR-2's third scenario, in the one place an adapter can say it. It is an
 * English string, like the other adapters' lossiness notices: the search
 * dialog's bundles carry no message for it and `docs/08` §10.3 forbids
 * building a localized sentence in code, so a Fluent id for it is a bundle
 * change first (reported with the card).
 */
export const SEMANTICSCHOLAR_UNKEYED_NOTE =
  "Semantic Scholar: no API key is configured, so requests draw on the " +
  "shared anonymous pool, which is heavily rate-limited and may answer " +
  "HTTP 429. Add a free key under Preferences to improve results " +
  `(request one at ${SEMANTICSCHOLAR_KEY_REQUEST_URL}).`;

/**
 * What a Phase 5 call says when it sent nothing for want of a key (`plan/08` §0.2
 * item 19). English, on the adapters' warning precedent above; the pipelines' "no
 * key" row is `P5-T12`'s and `P5-T23`'s and reaches the user first.
 */
export const SEMANTICSCHOLAR_NO_KEY_WARNING =
  "Semantic Scholar: no API key is configured, so nothing was requested from " +
  "it for related papers or recommendations.";

const NO_IDENTIFIER_SEED_WARNING =
  "Semantic Scholar finds related papers by a DOI, PMID, PMCID, arXiv ID or " +
  "corpus ID and this seed has none, so nothing was requested from it.";

const NO_IDENTIFIER_POSITIVES_WARNING =
  "Semantic Scholar recommends from example papers with a DOI, PMID, PMCID, " +
  "arXiv ID or corpus ID and none was given, so nothing was requested from it.";

function unsupportedStrategyWarning(strategy: string | undefined): string {
  return (
    `Semantic Scholar offers references, citations and recommendations, not ` +
    `${String(strategy)}, so nothing was requested from it.`
  );
}

function unusableRowsWarning(count: number, list: string): string {
  return (
    `Semantic Scholar: ${String(count)} row(s) of ${list} had no paper id and ` +
    `were left out.`
  );
}

function responseTooLargeWarning(limit: number, half: number): string {
  return (
    `Semantic Scholar refused ${String(limit)} recommendations as too large a ` +
    `response, so ${String(half)} were asked for instead.`
  );
}

function unusableSeedsWarning(count: number): string {
  return (
    `Semantic Scholar: ${String(count)} example paper(s) could not be resolved ` +
    `and were left out of the recommendation request.`
  );
}

function positivesCappedWarning(count: number): string {
  return (
    `Semantic Scholar: ${String(count)} example papers were usable and the ` +
    `first ${String(RECOMMEND_MAX_POSITIVES)} were sent.`
  );
}

/** A page with nothing on it: no list was read, so no total and no next page. */
function emptyRelatedPage(warning?: string): RelatedPage {
  return {
    records: [],
    edges: [],
    totalAvailable: undefined,
    nextCursor: undefined,
    warnings: warning === undefined ? [] : [warning],
  };
}

/**
 * The batch's own answer when it can read none of the ids. Measured 2026-10-15
 * for a lone `10.48550/arXiv.…` DOI (`test/support/semanticscholarRecordedRequests.ts`,
 * `record-jats-abstract`).
 */
const NO_VALID_IDS_OPENING = "No valid paper ids";

/** The first sentence of every Semantic Scholar lossiness notice. */
export const SEMANTICSCHOLAR_APPROXIMATE_PREFIX =
  "Semantic Scholar results are approximate";

/**
 * Capabilities, as the card's step 7 declares them and as `./query.ts` renders
 * them: `capabilities.query` is `docs/02` §12.3's S2 bulk column — `+`, `|`,
 * `-` and quotes are real; every field cell is *n/a*, so `fields` is the
 * renderer's own (empty) table and the two cannot drift (`P2-T28`).
 */
export const SEMANTICSCHOLAR_CAPABILITIES: SourceCapabilities = {
  keywordSearch: true,
  query: {
    or: true,
    not: true,
    phrase: true,
    fields: SEMANTICSCHOLAR_RENDERED_FIELDS,
  },
  // `findRelated` exists since `P5-T05` (`plan/00` §6 item 184's rule).
  relatedByWork: true,
  lookupById: ["doi", "pmid", "pmcid", "arxivId"],
  abstractsInSearch: true,
  citationGraph: true,
  dateFilter: true,
  // The bulk renderer's own object (`P2-T34`): `./query.ts` refuses from it.
  filters: SEMANTICSCHOLAR_FILTERS,
  maxPageSize: SEMANTICSCHOLAR_PAGE_SIZE_MAX,
  maxTotalResults: undefined,
  benefitsFromApiKey: true,
};

// ---------------------------------------------------------------------------
// 2. The 429 with its remedy
// ---------------------------------------------------------------------------

/**
 * A Semantic Scholar 429 as this adapter rethrows it: still a `RateLimitError`
 * (`retryable`, `httpStatus`, `retryAfterMs` unchanged, the client's error as
 * `cause`), with the message extended by the remedy — the unkeyed note when
 * no key was sent, the keyed budget when one was. `messageKey` stays
 * `rh-error-rate-limit`; the extra sentence reaches the per-source report's
 * `detail` through `toSerialized()`.
 */
export class SemanticScholarRateLimitError extends RateLimitError {
  constructor(
    cause: RateLimitError,
    /** Whether the refused request carried the `x-api-key` header. */
    readonly keyed: boolean,
  ) {
    super(cause.httpStatus, cause.retryAfterMs, SEMANTICSCHOLAR_HOST);
    this.message = keyed
      ? `${cause.message}: the keyed budget is 1 request per second on every ` +
        `endpoint (docs/02 §6.4); the plugin paces at 0.9/s, so a 429 with a ` +
        `key usually means the key is not being honoured.`
      : `${cause.message}. ${SEMANTICSCHOLAR_UNKEYED_NOTE}`;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// 3. Response bodies
// ---------------------------------------------------------------------------

/** A validated search body — `/paper/search/bulk` or `/paper/search`. */
export interface SemanticScholarSearchResult {
  /** `data`, unmapped — the mapper's input. */
  readonly data: readonly unknown[];
  /** `total`, when a non-negative integer. */
  readonly total: number | undefined;
  /** Bulk: the continuation `token`, or `undefined` on the last page. */
  readonly token: string | undefined;
  /** Relevance: the `next` offset, or `undefined` on the last page. */
  readonly next: number | undefined;
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Validate one search body.
 *
 * @param body - the response text
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @throws SourceError for Semantic Scholar's own error envelope
 * @throws ParseError when the body is not JSON or has no `data` array
 */
export function parseSearchBody(
  body: string,
  transmittedUrl: string,
): SemanticScholarSearchResult {
  const envelope = asRecord(parseSemanticScholarJson(body, transmittedUrl));
  const data = envelope?.data;
  if (envelope === undefined || !Array.isArray(data)) {
    throw new ParseError(
      SEMANTICSCHOLAR_SOURCE_ID,
      `[research-helper] Semantic Scholar search returned JSON with no data ` +
        `array; docs/02 §6.5 and §6.6 give that array as the page.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }
  return {
    data,
    total: count(envelope.total),
    token:
      typeof envelope.token === "string" && envelope.token.length > 0
        ? envelope.token
        : undefined,
    next: count(envelope.next),
  };
}

/**
 * Validate one `/paper/batch` body: an array positionally aligned with the
 * request's `ids`, `null` for an unknown id (§6.8).
 *
 * @throws SourceError for the error envelope
 * @throws ParseError when the body is not JSON or not an array
 */
export function parseBatchBody(
  body: string,
  transmittedUrl: string,
): readonly unknown[] {
  const parsed = parseSemanticScholarJson(body, transmittedUrl);
  if (!Array.isArray(parsed)) {
    throw new ParseError(
      SEMANTICSCHOLAR_SOURCE_ID,
      `[research-helper] Semantic Scholar /paper/batch returned JSON that is ` +
        `not an array; docs/02 §6.8 gives an array aligned with ids.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }
  return parsed;
}

/**
 * Validate one `/paper/{id}` body: an object with a string `paperId` (§6.5:
 * `paperId` is always returned).
 *
 * @throws SourceError for the error envelope
 * @throws ParseError otherwise
 */
export function parsePaperBody(body: string, transmittedUrl: string): Json {
  const paper = asRecord(parseSemanticScholarJson(body, transmittedUrl));
  if (paper === undefined || typeof paper.paperId !== "string") {
    throw new ParseError(
      SEMANTICSCHOLAR_SOURCE_ID,
      `[research-helper] Semantic Scholar /paper/{id} returned JSON with no ` +
        `paperId; docs/02 §6.5 says it is always returned.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }
  return paper;
}

// ---------------------------------------------------------------------------
// 4. Lossiness, ids and paging
// ---------------------------------------------------------------------------

/**
 * The warning a query earns before any request is made: the fielded terms
 * (§12.2: "There is no field-specific syntax; `title:` prefixes are
 * dropped"), as `normalizeForSource` reports them against this adapter's
 * declared dialect; `+`, `|`, `-` and phrases are rendered faithfully, so a
 * field is the only thing the bulk endpoint can lose.
 *
 * @param terms - the query tree
 * @returns zero or one string for `SourcePage.warnings`
 */
export function lossinessWarnings(terms: QueryNode): readonly string[] {
  const lost = normalizeForSource(terms, SEMANTICSCHOLAR_CAPABILITIES);
  const fields = new Set<QueryField>();
  for (const node of lost) {
    if (node.kind === "term" && node.field !== undefined) {
      fields.add(node.field);
    }
  }
  if (fields.size === 0) return [];
  return [
    `${SEMANTICSCHOLAR_APPROXIMATE_PREFIX}: Semantic Scholar has no field ` +
      `syntax, so the field restriction${fields.size === 1 ? "" : "s"} ` +
      `${[...fields].map((f) => `${f}:`).join(", ")} ` +
      `${fields.size === 1 ? "was" : "were"} dropped and the term${fields.size === 1 ? "" : "s"} ` +
      `searched across the whole record.`,
  ];
}

/**
 * The second notice the relevance endpoint earns: the `NOT` terms its
 * plain-text query cannot carry (§6.5), named.
 */
export function excludedTermsWarning(
  excluded: readonly SemanticScholarExcludedTerm[],
): readonly string[] {
  if (excluded.length === 0) return [];
  const named = excluded
    .map((t) => (t.field === undefined ? t.value : `${t.field}:${t.value}`))
    .map((t) => JSON.stringify(t))
    .join(", ");
  return [
    `${SEMANTICSCHOLAR_APPROXIMATE_PREFIX}: /paper/search takes plain text ` +
      `only, so ${String(excluded.length)} excluded term${excluded.length === 1 ? "" : "s"} ` +
      `(${named}) ${excluded.length === 1 ? "was" : "were"} dropped from the ` +
      `query; use the default bulk search for a real NOT.`,
  ];
}

/**
 * One `ExternalIds` → the §6.3 id Semantic Scholar resolves, best first:
 * `DOI:`, `PMID:`, `PMCID:` (digits only — §6.3's own example is
 * `PMCID:2323736`, so the `PMC` prefix `normalizePmcid` adds is removed
 * again here), `ARXIV:`, `CorpusId:`. `undefined` when the record carries
 * none of the five.
 *
 * @param ids - a record's identifiers
 * @returns the prefixed id, or `undefined`
 */
export function toSemanticScholarId(
  ids: Partial<ExternalIds>,
): string | undefined {
  if (ids.doi !== undefined && ids.doi !== "") return `DOI:${ids.doi}`;
  if (ids.pmid !== undefined && ids.pmid !== "") return `PMID:${ids.pmid}`;
  if (ids.pmcid !== undefined && ids.pmcid !== "") {
    return `PMCID:${ids.pmcid.replace(/^PMC/iu, "")}`;
  }
  if (ids.arxivId !== undefined && ids.arxivId !== "") {
    return `ARXIV:${ids.arxivId}`;
  }
  if (ids.s2CorpusId !== undefined && ids.s2CorpusId !== "") {
    return `CorpusId:${ids.s2CorpusId}`;
  }
  return undefined;
}

/**
 * Decide whether another bulk page exists (§6.6's `token`). **The server's
 * token is the signal**: no token ends the loop, and so do the two guards
 * that keep a misbehaving server from looping it — a repeated token and an
 * empty page. Otherwise the token, which the caller passes back as the
 * cursor.
 *
 * **There is no short-page rule here**, unlike Crossref's and Europe PMC's
 * `nextCursorAfter` (`P2-T05`, 2026-10-15). Those compare the page with the
 * size the request asked for; the bulk endpoint **ignores `limit`** (measured
 * 2026-10-15 — `search-single` and `paginated-page-1` returned 27 records for
 * `limit` 1 and 3, `record-unicode` 1000 unwindowed), so a page's length says
 * nothing about the size that was asked for, and a page shorter than our
 * `limit` that still carries a token would be cut off with its remaining
 * records silently lost. `docs/07` §4.2: `nextCursor` undefined means "no
 * more pages", which only the server knows.
 */
export function nextTokenAfter(
  sentToken: string | undefined,
  token: string | undefined,
  pageLength: number,
): string | undefined {
  if (token === undefined) return undefined;
  if (token === sentToken) return undefined;
  if (pageLength === 0) return undefined;
  return token;
}

/**
 * Decide whether another relevance page exists (§6.5's `offset`/`next`):
 * the server's `next`, as long as the page was not empty, `next` advances
 * past the offset sent (the relevance endpoint's counterpart of a repeated
 * token) and it is below §6.5's 1000-record depth; `undefined` otherwise.
 * No short-page rule, for {@link nextTokenAfter}'s reason: `next` is the
 * server's own statement that more exists.
 */
export function nextOffsetAfter(
  next: number | undefined,
  pageLength: number,
  sentOffset: number,
): string | undefined {
  if (next === undefined) return undefined;
  if (pageLength === 0) return undefined;
  if (next <= sentOffset) return undefined;
  if (next >= SEMANTICSCHOLAR_RELEVANCE_DEPTH_MAX) return undefined;
  return String(next);
}

/** `SourceQuery.cursor` → an `offset` for the relevance endpoint. Unusable → 0. */
export function readOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined || !/^\d+$/u.test(cursor)) return 0;
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed)) return 0;
  return Math.min(parsed, SEMANTICSCHOLAR_RELEVANCE_DEPTH_MAX - 1);
}

/**
 * `SourceQuery.limit` → a page size, clamped to §6.5's 1 … 100 and, for the
 * relevance endpoint, to what is left below the 1000-record depth.
 */
export function clampPageSize(limit: number, offset = 0): number {
  const wanted = Number.isFinite(limit)
    ? Math.trunc(limit)
    : SEMANTICSCHOLAR_PAGE_SIZE_MIN;
  const remaining = SEMANTICSCHOLAR_RELEVANCE_DEPTH_MAX - offset;
  return Math.max(
    SEMANTICSCHOLAR_PAGE_SIZE_MIN,
    Math.min(SEMANTICSCHOLAR_PAGE_SIZE_MAX, wanted, remaining),
  );
}

/**
 * `RelatedQuery.limit` → a relation list's `limit`: a whole number up to
 * `docs/05` §2.1's 1000, or 0 for one that asks for nothing and sends no request.
 */
export function clampRelationLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 0;
  return Math.min(
    SEMANTICSCHOLAR_RELATION_LIMIT_MAX,
    Math.max(0, Math.trunc(limit)),
  );
}

/** Each entry's `docs/02` §6.3 id, once; `withoutId` counts those that have none. */
function prefixedIds(entries: readonly Partial<ExternalIds>[]): {
  readonly ids: readonly string[];
  readonly withoutId: number;
} {
  const ids: string[] = [];
  let withoutId = 0;
  for (const entry of entries) {
    const id = toSemanticScholarId(entry);
    if (id === undefined) withoutId += 1;
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, withoutId };
}

/** Whether a record is one of the seeds, by paper id or by any identifier. */
function isSeedRecord(
  record: SourceRecord,
  seedKeys: ReadonlySet<string>,
): boolean {
  return (
    seedKeys.has(record.nativeId.toLowerCase()) ||
    identifierKeys(record.work.ids).some((key) => seedKeys.has(key))
  );
}

/** `fromDate`'s year, or `undefined` when there is none to apply. */
function fromYearOf(fromDate: string | undefined): number | undefined {
  const year = Number(fromDate?.slice(0, 4));
  return Number.isInteger(year) ? year : undefined;
}

// ---------------------------------------------------------------------------
// 5. The adapter
// ---------------------------------------------------------------------------

/** What {@link createSemanticScholarSource} needs from the composition root. */
export interface SemanticScholarSourceDeps {
  /** `P1-T05`'s client. Pacing, retry and the 429 classification live behind it. */
  readonly http: HttpClient;
  /** `src/core/clock.ts`; only `healthCheck`'s `latencyMs` reads it. */
  readonly clock: Clock;
  /** `./mapper.ts`'s mapper. Required: without it a page has no records. */
  readonly mapRecords: SemanticScholarRecordMapper;
  /**
   * The key store (`src/core/secretStore.ts`). Omitted — as in a unit test of
   * the unkeyed path, or in a build whose keystore probe failed — every
   * request goes out without `x-api-key`, onto the shared anonymous pool.
   */
  readonly secrets?: SecretStore;
  /** Diagnostics. Never given a header, a body or a key. */
  readonly logger?: Logger;
}

/**
 * `docs/07` §5.3 `SourceProvenance.sourceExtras`, keyed by the endpoint's own
 * names plus which endpoint and which mode served the page.
 */
export interface SemanticScholarSourceExtras {
  readonly endpoint: "bulk" | "relevance";
  readonly total: number | undefined;
  /** Bulk: the `token` sent for this page, or `undefined` on the first. */
  readonly token: string | undefined;
  /** Relevance: the `offset` sent for this page. */
  readonly offset: number | undefined;
  /** Whether the request carried the `x-api-key` header. Never the key. */
  readonly keyed: boolean;
}

/** A page of Semantic Scholar results: `docs/07` §4.2's page plus the extras. */
export interface SemanticScholarSearchPage extends SourcePage {
  readonly sourceExtras: SemanticScholarSourceExtras;
}

/** The adapter, with the two search paths and the key-presence probe named. */
export interface SemanticScholarSource extends LiteratureSource {
  /** `/paper/search/bulk` — the default path (§6.6). */
  search(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<SemanticScholarSearchPage>;
  /**
   * `/paper/search` — relevance ranking, requested by name (§6.5, card step
   * 2). Plain text only: `NOT` terms are dropped and reported.
   */
  searchByRelevance(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<SemanticScholarSearchPage>;
  lookup(
    ids: readonly Partial<ExternalIds>[],
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]>;
  fetchAbstract(
    ids: Partial<ExternalIds>,
    ctx: SourceCallContext,
  ): Promise<string | undefined>;
  /**
   * Whether the keystore holds a key for `source.semanticscholar` — the cheap
   * `has()` that never decrypts (`docs/09` §1.7). `false` without a store.
   */
  hasApiKey(): Promise<boolean>;
  /**
   * `docs/07` §4.2: `"references"` and `"citations"` are `docs/05` §2.1's lists,
   * `"recommendations"`, `"auto"` and no strategy are §3.1's `forpaper`. Sends
   * nothing without a key. Callers: `src/pipeline/related/generators.ts`
   * (`P5-T12`), `src/pipeline/recommend/generators.ts` (`P5-T23`).
   *
   * @throws BadRequestError with status 404 for a seed the service does not hold,
   *   and every other transport failure unwrapped
   */
  findRelated(
    query: RelatedQuery,
    ctx: SourceCallContext,
  ): Promise<RelatedPage>;
  /**
   * `/paper/search/match`: zero or one record, unthresholded, as
   * `CrossrefSource.matchTitle` returns a list, so `resolveSeed`
   * (`src/pipeline/related/seed.ts`, `P5-T11`) reads both alike. "No match" is an
   * empty list, and so is having no key.
   *
   * @throws RangeError for a blank title, as Crossref's does
   */
  matchTitle(
    title: string,
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]>;
  /**
   * `docs/05` §3.1's `POST /papers/`, after one `/paper/batch` that drops the
   * seeds the service cannot resolve (§3.3 pitfall 2). Edges of kind
   * `"recommendation"`. Sends nothing without a key. Caller:
   * `src/pipeline/recommend/generators.ts` (`P5-T23`).
   *
   * @param positives - the example papers; the first {@link RECOMMEND_MAX_POSITIVES} that resolve are sent
   * @param negatives - papers to steer away from; an id also in `positives` stays a positive
   * @param limit - the most recommendations wanted, clamped to §3.3's 500
   * @param ctx - the cancellation token
   * @returns the page; a short list is normal (§3.3 pitfall 1)
   * @throws BadRequestError with status 404 when no positive resolves, so no POST
   *   was sent; with status 400 when the answer is too large twice (§3.3)
   * @throws RangeError for more than `docs/02` §6.8's 500 ids in all
   */
  recommend(
    positives: readonly Partial<ExternalIds>[],
    negatives: readonly Partial<ExternalIds>[],
    limit: number,
    ctx: SourceCallContext,
  ): Promise<RelatedPage>;
}

/**
 * Build the Semantic Scholar adapter.
 *
 * @param deps - the HTTP client, the clock, the mapper and the optional key
 *   store and logger
 * @returns a `docs/07` §4.2 `LiteratureSource` for Semantic Scholar
 */
export function createSemanticScholarSource(
  deps: SemanticScholarSourceDeps,
): SemanticScholarSource {
  const { http, clock, mapRecords } = deps;

  /**
   * The key for the next request, or `undefined`. Read per call, never
   * cached, as the PubMed adapter does: the preferences pane can add or clear
   * it while Zotero runs. A store that throws is "no key" — the source is an
   * enhancer and an unreadable keychain must degrade, not fail a search. The
   * value never reaches a log.
   */
  async function resolveApiKey(): Promise<string | undefined> {
    const { secrets } = deps;
    if (secrets === undefined) return undefined;
    try {
      const value = await secrets.get(SEMANTICSCHOLAR_SECRET_ID);
      return value === undefined || value.trim() === "" ? undefined : value;
    } catch {
      deps.logger?.warn(
        "Semantic Scholar key could not be read; going unkeyed",
        {
          sourceId: SEMANTICSCHOLAR_SOURCE_ID,
          secretId: SEMANTICSCHOLAR_SECRET_ID,
        },
      );
      return undefined;
    }
  }

  /** The request headers: `Accept`, the key when present, the body type on a POST. */
  function headersFor(
    apiKey: string | undefined,
    contentType: string | undefined,
  ): Record<string, string> {
    return {
      Accept: "application/json",
      ...(apiKey !== undefined && { [SEMANTICSCHOLAR_API_KEY_HEADER]: apiKey }),
      ...(contentType !== undefined && { "Content-Type": contentType }),
    };
  }

  /**
   * One request under a key already read, or none: a 429 rethrown with its remedy,
   * the redacted URL and the status logged — never a header.
   */
  async function send(
    request: SemanticScholarRequest,
    apiKey: string | undefined,
    ctx: SourceCallContext,
  ): Promise<{ readonly response: HttpResponse; readonly keyed: boolean }> {
    ctx.token.throwIfCancelled();
    const keyed = apiKey !== undefined;
    let response: HttpResponse;
    try {
      // `responseType: "text"` is not optional: `HttpResponse.body` is `""`
      // for every other value.
      response = await http.request(request.method, request.url, {
        responseType: "text",
        token: ctx.token,
        headers: headersFor(apiKey, request.contentType),
        ...(request.body !== undefined && { body: request.body }),
      });
    } catch (error) {
      if (
        error instanceof RateLimitError &&
        !(error instanceof SemanticScholarRateLimitError)
      ) {
        throw new SemanticScholarRateLimitError(error, keyed);
      }
      throw error;
    }
    deps.logger?.debug("semanticscholar request", {
      sourceId: SEMANTICSCHOLAR_SOURCE_ID,
      url: request.transmittedUrl,
      status: response.status,
      keyed,
    });
    return { response, keyed };
  }

  /** One request with the key read for it, the search path's way. */
  async function issue(
    request: SemanticScholarRequest,
    ctx: SourceCallContext,
  ): Promise<{ readonly response: HttpResponse; readonly keyed: boolean }> {
    ctx.token.throwIfCancelled();
    return send(request, await resolveApiKey(), ctx);
  }

  /** The notice an unkeyed page carries, or nothing. */
  function keyNotice(keyed: boolean): readonly string[] {
    return keyed ? [] : [SEMANTICSCHOLAR_UNKEYED_NOTE];
  }

  /** One bulk page (§6.6). */
  async function search(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<SemanticScholarSearchPage> {
    const limit = clampPageSize(query.limit);
    const request = buildBulkSearchRequest({
      query,
      limit,
      ...(query.cursor !== undefined && { token: query.cursor }),
    });
    const { response, keyed } = await issue(request, ctx);
    const result = parseSearchBody(response.body, request.transmittedUrl);
    return {
      records: mapRecords(result.data),
      totalAvailable: result.total,
      nextCursor: nextTokenAfter(
        request.token,
        result.token,
        result.data.length,
      ),
      warnings: [...lossinessWarnings(query.terms), ...keyNotice(keyed)],
      sourceExtras: {
        endpoint: "bulk",
        total: result.total,
        token: request.token,
        offset: undefined,
        keyed,
      },
    };
  }

  /** One relevance page (§6.5). */
  async function searchByRelevance(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<SemanticScholarSearchPage> {
    const offset = readOffsetCursor(query.cursor);
    const limit = clampPageSize(query.limit, offset);
    const request = buildRelevanceSearchRequest({ query, limit, offset });
    const { response, keyed } = await issue(request, ctx);
    const result = parseSearchBody(response.body, request.transmittedUrl);
    return {
      records: mapRecords(result.data),
      totalAvailable: result.total,
      nextCursor: nextOffsetAfter(result.next, result.data.length, offset),
      warnings: [
        ...lossinessWarnings(query.terms),
        ...excludedTermsWarning(request.rendered.excluded),
        ...keyNotice(keyed),
      ],
      sourceExtras: {
        endpoint: "relevance",
        total: result.total,
        token: undefined,
        offset,
        keyed,
      },
    };
  }

  /**
   * Page the bulk endpoint until `limit` or exhaustion. Each page asks for
   * what is still wanted, capped at §6.5's 100; `ctx.token.throwIfCancelled()`
   * runs at the top of every page (`docs/07` §7.4 check point 1). The notices
   * are raised once, on the first page, through `ctx.progress`.
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
          limit: Math.min(limit - emitted, SEMANTICSCHOLAR_PAGE_SIZE_MAX),
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

  /**
   * `/paper/batch`, ~100 ids per call, index-matched (§6.8). Ids with no
   * §6.3 form are skipped; duplicates are sent once; `null` answers are
   * counted and skipped without shifting their neighbours.
   */
  async function lookup(
    ids: readonly Partial<ExternalIds>[],
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]> {
    const wanted: string[] = [];
    for (const entry of ids) {
      const id = toSemanticScholarId(entry);
      if (id !== undefined && !wanted.includes(id)) wanted.push(id);
    }
    const out: SourceRecord[] = [];
    let unknown = 0;
    for (
      let start = 0;
      start < wanted.length;
      start += SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT
    ) {
      const chunk = wanted.slice(
        start,
        start + SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT,
      );
      const request = buildBatchRequest(chunk);
      const { response } = await issue(request, ctx);
      const answers = parseBatchBody(response.body, request.transmittedUrl);
      if (answers.length !== chunk.length) {
        deps.logger?.warn(
          "semanticscholar batch: answer length differs from ids sent",
          {
            sourceId: SEMANTICSCHOLAR_SOURCE_ID,
            sent: chunk.length,
            received: answers.length,
          },
        );
      }
      unknown += answers.filter((a) => a === null).length;
      out.push(...mapRecords(answers));
    }
    if (unknown > 0) {
      deps.logger?.debug("semanticscholar batch: unknown ids", {
        sourceId: SEMANTICSCHOLAR_SOURCE_ID,
        unknown,
        sent: wanted.length,
      });
    }
    return out;
  }

  /** `docs/02` §10.4's backfill step 2, for one record. */
  async function fetchAbstract(
    ids: Partial<ExternalIds>,
    ctx: SourceCallContext,
  ): Promise<string | undefined> {
    const id = toSemanticScholarId(ids);
    if (id === undefined) return undefined;
    const request = buildBatchRequest([id], SEMANTICSCHOLAR_ABSTRACT_FIELDS);
    const { response } = await issue(request, ctx);
    const [answer] = parseBatchBody(response.body, request.transmittedUrl);
    const paper = asRecord(answer);
    if (paper === undefined) return undefined;
    const abstract =
      typeof paper.abstract === "string" && paper.abstract.trim() !== ""
        ? paper.abstract.trim()
        : undefined;
    return abstract ?? readTldr(paper);
  }

  /**
   * One relation list. `rank` is the row's position, a row with no paper id
   * included. `fromDate` applies to the year, since `docs/05` §3.3 pitfall 3's "no
   * date filter" is the graph's too, and an undated record is kept.
   */
  async function fetchRelation(
    relation: SemanticScholarRelation,
    paperId: string,
    query: RelatedQuery,
    apiKey: string,
    ctx: SourceCallContext,
  ): Promise<RelatedPage> {
    const limit = clampRelationLimit(query.limit);
    if (limit === 0) {
      return emptyRelatedPage();
    }
    const request = (
      relation === "references" ? buildReferencesRequest : buildCitationsRequest
    )({ paperId, limit });
    const { response } = await send(request, apiKey, ctx);
    const rows = parseRelationBody(
      relation,
      response.body,
      request.transmittedUrl,
    );

    const fromYear = fromYearOf(query.fromDate);
    const records: SourceRecord[] = [];
    const edges: RelationEdge[] = [];
    let unusable = 0;
    rows.forEach((row, index) => {
      // One row at a time, so a row the mapper drops cannot shift an edge.
      const [record] = mapRecords([row.paper ?? null]);
      if (record === undefined) {
        unusable += 1;
        return;
      }
      const year = record.work.publishedDate?.year;
      if (fromYear !== undefined && year !== undefined && year < fromYear) {
        return;
      }
      records.push(record);
      edges.push({
        kind: SEMANTICSCHOLAR_RELATION_EDGE_KIND[relation],
        rank: index + 1,
        ...(row.contexts !== undefined && { contexts: row.contexts }),
      });
    });
    return {
      records,
      edges,
      totalAvailable: undefined,
      nextCursor: undefined,
      warnings:
        unusable === 0 ? [] : [unusableRowsWarning(unusable, `/${relation}`)],
    };
  }

  /**
   * One Recommendations request, and `docs/05` §3.3's size cap: one retry at half
   * the limit with the same fields, then the error propagates. Seeds are dropped
   * from the answer before ranking (pitfall 4).
   */
  async function fetchRecommendations(
    build: (limit: number, fields: readonly string[]) => SemanticScholarRequest,
    limit: number,
    seedKeys: ReadonlySet<string>,
    fromYear: number | undefined,
    apiKey: string,
    earlierWarnings: readonly string[],
    ctx: SourceCallContext,
  ): Promise<RelatedPage> {
    const fields = recommendFieldsFor(limit);
    const warnings = [...earlierWarnings];
    let request = build(limit, fields);
    let response: HttpResponse;
    try {
      ({ response } = await send(request, apiKey, ctx));
    } catch (error) {
      const half = Math.floor(limit / 2);
      if (!isResponseTooLarge(error) || half < 1) throw error;
      warnings.push(responseTooLargeWarning(limit, half));
      request = build(half, fields);
      ({ response } = await send(request, apiKey, ctx));
    }
    const papers = parseRecommendationsBody(
      response.body,
      request.transmittedUrl,
    );

    const records: SourceRecord[] = [];
    const edges: RelationEdge[] = [];
    let position = 0;
    let unusable = 0;
    for (const paper of papers) {
      const [record] = mapRecords([paper]);
      if (record === undefined) {
        position += 1;
        unusable += 1;
        continue;
      }
      if (isSeedRecord(record, seedKeys)) continue;
      position += 1;
      const year = record.work.publishedDate?.year;
      if (fromYear !== undefined && year !== undefined && year < fromYear) {
        continue;
      }
      records.push(record);
      edges.push({ kind: "recommendation", rank: position });
    }
    if (unusable > 0) {
      warnings.push(unusableRowsWarning(unusable, "the recommendations"));
    }
    return {
      records,
      edges,
      totalAvailable: undefined,
      nextCursor: undefined,
      warnings,
    };
  }

  /** {@link SemanticScholarSource.findRelated}. */
  async function findRelated(
    query: RelatedQuery,
    ctx: SourceCallContext,
  ): Promise<RelatedPage> {
    const strategy = query.strategy ?? "auto";
    if (
      strategy !== "references" &&
      strategy !== "citations" &&
      strategy !== "recommendations" &&
      strategy !== "auto"
    ) {
      return emptyRelatedPage(unsupportedStrategyWarning(strategy));
    }
    ctx.token.throwIfCancelled();
    const apiKey = await resolveApiKey();
    if (apiKey === undefined) {
      return emptyRelatedPage(SEMANTICSCHOLAR_NO_KEY_WARNING);
    }
    const ids: Partial<ExternalIds> = { ...query.work?.ids, ...query.ids };
    const paperId = toSemanticScholarId(ids);
    if (paperId === undefined) {
      return emptyRelatedPage(NO_IDENTIFIER_SEED_WARNING);
    }
    if (strategy === "references" || strategy === "citations") {
      return fetchRelation(strategy, paperId, query, apiKey, ctx);
    }
    const limit = clampRecommendLimit(query.limit);
    if (limit === 0) {
      return emptyRelatedPage();
    }
    return fetchRecommendations(
      (asked, fields) =>
        buildForPaperRequest({ paperId, limit: asked, fields }),
      limit,
      new Set(identifierKeys(ids)),
      fromYearOf(query.fromDate),
      apiKey,
      [],
      ctx,
    );
  }

  /** {@link SemanticScholarSource.matchTitle}. */
  async function matchTitle(
    title: string,
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]> {
    const request = buildTitleMatchRequest(title);
    ctx.token.throwIfCancelled();
    const apiKey = await resolveApiKey();
    if (apiKey === undefined) return [];
    let response: HttpResponse;
    try {
      ({ response } = await send(request, apiKey, ctx));
    } catch (error) {
      // `plan/08` `P5-T05` step 2: unverified until `P5-T31`, and read by status alone.
      if (error instanceof BadRequestError && error.httpStatus === 404) {
        return [];
      }
      throw error;
    }
    const paper = parseTitleMatchBody(response.body, request.transmittedUrl);
    return paper === undefined ? [] : mapRecords([paper]);
  }

  /**
   * `docs/05` §3.3 pitfall 2: one batch over every seed, index-matched. A row that
   * is `null`, or a batch that could read no id at all, leaves that id out.
   *
   * @returns the ids that resolved, and the identifiers the service gave for them
   */
  async function resolveSeedIds(
    wanted: readonly string[],
    apiKey: string,
    ctx: SourceCallContext,
  ): Promise<{
    readonly resolved: ReadonlySet<string>;
    readonly seedKeys: readonly string[];
  }> {
    const request = buildBatchRequest(
      wanted,
      SEMANTICSCHOLAR_SEED_CHECK_FIELDS,
    );
    let answers: readonly unknown[];
    try {
      const { response } = await send(request, apiKey, ctx);
      answers = parseBatchBody(response.body, request.transmittedUrl);
    } catch (error) {
      if (
        error instanceof BadRequestError &&
        error.httpStatus === 400 &&
        error.body?.includes(NO_VALID_IDS_OPENING) === true
      ) {
        return { resolved: new Set(), seedKeys: [] };
      }
      throw error;
    }
    const resolved = new Set<string>();
    const seedKeys: string[] = [];
    wanted.forEach((id, index) => {
      const [record] = mapRecords([answers[index] ?? null]);
      if (record === undefined) return;
      resolved.add(id);
      seedKeys.push(
        record.nativeId.toLowerCase(),
        ...identifierKeys(record.work.ids),
      );
    });
    return { resolved, seedKeys };
  }

  /** {@link SemanticScholarSource.recommend}. */
  async function recommend(
    positives: readonly Partial<ExternalIds>[],
    negatives: readonly Partial<ExternalIds>[],
    limit: number,
    ctx: SourceCallContext,
  ): Promise<RelatedPage> {
    ctx.token.throwIfCancelled();
    const apiKey = await resolveApiKey();
    if (apiKey === undefined) {
      return emptyRelatedPage(SEMANTICSCHOLAR_NO_KEY_WARNING);
    }
    const wantedPositives = prefixedIds(positives);
    if (wantedPositives.ids.length === 0) {
      return emptyRelatedPage(NO_IDENTIFIER_POSITIVES_WARNING);
    }
    const wantedNegatives = prefixedIds(negatives);
    const negativeIds = wantedNegatives.ids.filter(
      (id) => !wantedPositives.ids.includes(id),
    );
    const clamped = clampRecommendLimit(limit);
    if (clamped === 0) {
      return emptyRelatedPage();
    }

    const { resolved, seedKeys } = await resolveSeedIds(
      [...wantedPositives.ids, ...negativeIds],
      apiKey,
      ctx,
    );
    const usablePositives = wantedPositives.ids.filter((id) =>
      resolved.has(id),
    );
    if (usablePositives.length === 0) {
      throw new BadRequestError(
        404,
        `[research-helper] Semantic Scholar resolved none of the ` +
          `${String(wantedPositives.ids.length)} example paper(s), so nothing ` +
          `was asked of Recommendations (docs/05 §3.3 pitfall 2).`,
        { sourceId: SEMANTICSCHOLAR_SOURCE_ID, seedNotIndexed: true },
      );
    }
    const usableNegatives = negativeIds.filter((id) => resolved.has(id));
    const positivePaperIds = usablePositives.slice(0, RECOMMEND_MAX_POSITIVES);

    const left =
      wantedPositives.ids.length -
      usablePositives.length +
      negativeIds.length -
      usableNegatives.length +
      wantedPositives.withoutId +
      wantedNegatives.withoutId;
    const warnings = [
      ...(left > 0 ? [unusableSeedsWarning(left)] : []),
      ...(usablePositives.length > RECOMMEND_MAX_POSITIVES
        ? [positivesCappedWarning(usablePositives.length)]
        : []),
    ];

    return fetchRecommendations(
      (asked, fields) =>
        buildRecommendRequest({
          positivePaperIds,
          negativePaperIds: usableNegatives,
          limit: asked,
          fields,
        }),
      clamped,
      new Set([
        ...seedKeys,
        ...[...positives, ...negatives].flatMap((ids) => identifierKeys(ids)),
      ]),
      undefined,
      apiKey,
      warnings,
      ctx,
    );
  }

  /** `docs/09` §2.3's test call. Never throws except on cancellation. */
  async function healthCheck(ctx: SourceCallContext): Promise<SourceHealth> {
    const startedAtMs = clock.now();
    try {
      const request = buildPaperRequest(
        SEMANTICSCHOLAR_HEALTH_PAPER_ID,
        SEMANTICSCHOLAR_HEALTH_FIELDS,
      );
      const { response, keyed } = await issue(request, ctx);
      parsePaperBody(response.body, request.transmittedUrl);
      return {
        ok: true,
        messageKey: SEMANTICSCHOLAR_HEALTH_OK_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
        quotaHint: keyed
          ? "keyed: x-api-key sent, 1 request/s guaranteed (docs/02 §6.4)"
          : "unkeyed: shared anonymous pool (docs/02 §6.4)",
      };
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      return {
        ok: false,
        messageKey:
          error instanceof ResearchHelperError
            ? error.messageKey
            : SEMANTICSCHOLAR_HEALTH_FAILED_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
      };
    }
  }

  async function hasApiKey(): Promise<boolean> {
    const { secrets } = deps;
    if (secrets === undefined) return false;
    try {
      return await secrets.has(SEMANTICSCHOLAR_SECRET_ID);
    } catch {
      return false;
    }
  }

  return {
    id: SEMANTICSCHOLAR_SOURCE_ID,
    displayNameKey: SEMANTICSCHOLAR_DISPLAY_NAME_KEY,
    capabilities: SEMANTICSCHOLAR_CAPABILITIES,
    rateLimitKey: SEMANTICSCHOLAR_HOST,
    /**
     * `true`: the key is optional and the source works without one (file
     * header, first decision). Key presence is {@link hasApiKey}.
     */
    isConfigured: () => true,
    healthCheck,
    search,
    searchByRelevance,
    searchAll,
    lookup,
    fetchAbstract,
    hasApiKey,
    findRelated,
    matchTitle,
    recommend,
    explainQuery: (query) => explainSemanticScholarQuery(query),
  };
}
