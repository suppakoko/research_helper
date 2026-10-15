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
 *   boolean `keyed`), not a fixture (`scripts/record-fixtures.ts` records
 *   unauthenticated and its `HEADER_DENY_LIST` drops `x-api-key` on the
 *   response side). D5: no preference is written here or anywhere in
 *   `sources/`.
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
 *   `fields=abstract,tldr` — `docs/02` §10.4's backfill step 2 — returning the
 *   abstract, or the TL;DR when the abstract is missing (§6.7).
 * - **`healthCheck()` is `docs/09` §2.3's test call**, verbatim: `GET
 *   /graph/v1/paper/DOI:10.1038/s41586-023-06139-9?fields=paperId`, the
 *   `x-api-key` header when a key is present, `ok` when the body carries a
 *   `paperId`. One fixed public paper, no user content (`docs/09` §4). §2.3
 *   maps a 429 here to *inconclusive*, never a pass; the probe reports the
 *   error's own message key and leaves the enum to the pane.
 * - **Capabilities** are the card's step 7: `benefitsFromApiKey: true`,
 *   `lookupById` DOI / PMID / PMCID / arXiv, `abstractsInSearch: true`,
 *   `citationGraph: true` (§6.2's `citations` / `references` endpoints exist;
 *   `findRelated` is `P2-T11`'s to wire), `maxPageSize: 100`, `dateFilter:
 *   true`, and `query` from `docs/02` §12.3's S2 bulk column: `+`, `|`, `-`
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
  OperationCancelledError,
  ParseError,
  RateLimitError,
  ResearchHelperError,
  SourceError,
} from "../../core/errors";
import type { HttpClient, HttpResponse } from "../../core/http/client";
import type { Logger } from "../../core/logger";
import { SEMANTICSCHOLAR_HOST } from "../../core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../core/secretStore";
import type { ExternalIds } from "../../model/ids";
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
  relatedByWork: false,
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

/** `JSON.parse`, or a {@link ParseError} naming the redacted URL. */
function parseJson(body: string, transmittedUrl: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (cause) {
    throw new ParseError(
      SEMANTICSCHOLAR_SOURCE_ID,
      `[research-helper] Semantic Scholar returned a body that is not JSON.`,
      { url: transmittedUrl, bodyLength: body.length },
      { cause },
    );
  }
}

/**
 * Semantic Scholar's two error envelopes inside an HTTP 200, if `parsed` is
 * one: `{"error": "…"}` (§6.10) or `{"message": "…", "code": "…"}` (§6.4's
 * 429 body, `code` a *string*). One decoder for both.
 */
function throwIfErrorEnvelope(parsed: unknown, transmittedUrl: string): void {
  const envelope = asRecord(parsed);
  if (envelope === undefined) return;
  const error =
    typeof envelope.error === "string"
      ? envelope.error
      : typeof envelope.message === "string" && envelope.code !== undefined
        ? envelope.message
        : undefined;
  if (error === undefined) return;
  throw new SourceError(
    SEMANTICSCHOLAR_SOURCE_ID,
    `[research-helper] Semantic Scholar answered with an error: ${error}`,
    {
      url: transmittedUrl,
      upstreamError: error,
      ...(envelope.code !== undefined && { upstreamCode: envelope.code }),
    },
  );
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
  const parsed = parseJson(body, transmittedUrl);
  throwIfErrorEnvelope(parsed, transmittedUrl);
  const envelope = asRecord(parsed);
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
  const parsed = parseJson(body, transmittedUrl);
  throwIfErrorEnvelope(parsed, transmittedUrl);
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
  const parsed = parseJson(body, transmittedUrl);
  throwIfErrorEnvelope(parsed, transmittedUrl);
  const paper = asRecord(parsed);
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
   * One request: the key resolved and sent as a header, a 429 rethrown with
   * its remedy, the redacted URL and the status logged — never a header.
   */
  async function issue(
    request: SemanticScholarRequest,
    ctx: SourceCallContext,
  ): Promise<{ readonly response: HttpResponse; readonly keyed: boolean }> {
    ctx.token.throwIfCancelled();
    const apiKey = await resolveApiKey();
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
    explainQuery: (query) => explainSemanticScholarQuery(query),
  };
}
