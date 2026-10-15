/**
 * The PubMed adapter: one `esearch` for PMIDs, batched `efetch` calls for the
 * records, and a loud failure on the errors PubMed hides inside HTTP 200.
 *
 * **Scope.** `P1-T09`. `docs/07` §4.2's `LiteratureSource`, implemented for
 * `eutils.ncbi.nlm.nih.gov`. Query *rendering* is `P1-T08`'s
 * {@link buildEsearchRequest} and is not repeated here; XML → `SourceRecord`
 * is `P1-T10`'s mapper and arrives as {@link PubmedSourceDeps.mapRecords}.
 *
 * ## What this file decides, and where each decision comes from
 *
 * - **`maxTotalResults: 9999`** — `docs/02` §3.3's hard ceiling, verified live
 *   there: `retstart=9999` comes back as `{"esearchresult":{"ERROR":"… cannot
 *   be larger than 9998 …"}}` **inside an HTTP 200**. So the highest reachable
 *   offset is {@link PUBMED_RETSTART_MAX} and the number of reachable records is
 *   {@link PUBMED_MAX_TOTAL_RESULTS}.
 * - **`abstractsInSearch: false`** — `esearch` returns PMIDs only; an abstract
 *   costs the `efetch` round trip (§3.4).
 * - **`benefitsFromApiKey: true`** — §3.1: 3 requests/second without a key, 10
 *   with one. The *budget* is not this file's to apply; see "the key" below.
 * - **`rateLimitKey`** is {@link NCBI_HOST}, imported rather than respelled, so
 *   `docs/07` §7.3's one-bucket-per-host rule is mechanical.
 * - **Every request carries `tool` and `email`** with the maintainer address
 *   (decision D10, `docs/00` §3; `docs/02` §3.1's "on **every** request";
 *   NBK25497's "not that of a third-party end user"). `esearch` gets them from
 *   `buildEsearchRequest`; `efetch` gets them from {@link buildEfetchRequest}.
 *   Neither takes them from a caller, so neither can forget them.
 * - **`efetch` is `retmode=xml&rettype=abstract`, ≤ 200 PMIDs per call, POST
 *   once the URL would pass ~2000 characters** — all three from §3.4, which
 *   also records that `retmode=json` is **not supported** for PubMed `efetch`.
 *
 * ## The key, and what is still missing
 *
 * `api_key` is accepted and passed through, and nothing here fetches it on its
 * own. {@link PubmedSourceDeps.secrets} is `src/core/secretStore.ts`'s port —
 * a `core/` module, so importing it keeps §2.3's rule that `sources/` may not
 * import `src/zotero/**`, where the only implementation lives. Given that port
 * the adapter reads {@link NCBI_SECRET_ID} and passes the value into
 * `buildEsearchRequest` / {@link buildEfetchRequest}; given no port, every
 * request goes unkeyed, which is the honest unconfigured state (`isConfigured()`
 * is `true` either way — §3.1 marks the key optional).
 *
 * **Two things are still absent at the time this file was written, and neither
 * is in this card's `Files`.** (1) Nothing in the running plugin constructs the
 * keychain store at startup, so no `SecretStore` instance exists to inject yet.
 * (2) `docs/07` §4.2's `SourceCallContext` carries `token`, `progress` and
 * `bypassCache` and has **no credential channel**, which is why the key arrives
 * as a constructor dependency rather than per call. Both are reported in
 * `P1-T09`'s hand-back.
 *
 * ## Errors
 *
 * - A body-level `esearchresult.ERROR` throws {@link SourceError} carrying the
 *   upstream text (`docs/02` §3.8: "Bad query → HTTP **200** with
 *   `esearchresult.ERROR` — **must check the body**"). It is checked before the
 *   id list is read, so a 200-with-error can never be mistaken for zero hits.
 * - A body that is not the documented JSON shape throws `ParseError`.
 * - **Transport-level failures propagate unwrapped.** §4.2's comment on
 *   `search` says "Throws SourceError subclasses", but `P1-T05`'s client throws
 *   `docs/07` §10.1's classes (`RateLimitError`, `UpstreamServerError`,
 *   `TimeoutError`, …) and this card's **Do NOT** forbids re-implementing 429
 *   handling. Wrapping those in `SourceError` would discard `retryable` and the
 *   429 classification `P1-T04`/`P1-T05` own, so they are left alone. Recorded
 *   as a corpus contradiction in this card's hand-back.
 *
 * ## Credentials never reach a log
 *
 * `docs/09` §2.1: "the primary rule is to never put a credential in a URL" —
 * but NCBI's key *is* a query parameter by its own design, so the backstop is
 * load-bearing here. Every URL this file hands to a logger or an error goes
 * through `redactUrl`, which **removes** `api_key` by name. The POST body is
 * never logged and is never put in an error; the redacted form offered to a
 * caller is built by rendering the parameter list a second time *without* the
 * key, rather than by pattern-matching it — `redact()`'s catch-all needs 40
 * characters and an NCBI key is shorter, so a form body is outside what the
 * pattern set can protect (reported with this card).
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3 / §4.2).
 * Nothing below names the `Zotero` global, touches a preference, or reads a
 * file. The sandbox has no `AbortController`, `structuredClone` or `console`
 * (`docs/01` §2.3), so cancellation goes through `ctx.token` and diagnostics
 * through the injected {@link Logger}.
 */

import type { Clock } from "../../core/clock";
import {
  OperationCancelledError,
  ParseError,
  redactUrl,
  ResearchHelperError,
  SourceError,
} from "../../core/errors";
import type {
  HttpClient,
  HttpMethod,
  HttpResponse,
} from "../../core/http/client";
import { ncbiIdentityParams } from "../../core/http/userAgent";
import type { Logger } from "../../core/logger";
import { NCBI_HOST } from "../../core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../core/secretStore";
import type { SourceId } from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";
import type {
  LiteratureSource,
  SourceCallContext,
  SourceCapabilities,
  SourceHealth,
  SourcePage,
  SourceQuery,
} from "../types";
import {
  buildEsearchRequest,
  explainPubmedQuery,
  PUBMED_FILTERS,
} from "./query";

// ---------------------------------------------------------------------------
// 1. The constants, each one a `docs/02` §3 figure
// ---------------------------------------------------------------------------

/** `docs/07` §11.1 step 3: the `SourceId` *is* the adapter's identity. */
export const PUBMED_SOURCE_ID: SourceId = "pubmed";

/**
 * `LiteratureSource.displayNameKey`.
 *
 * Spelled as a literal because `src/sources/**` importing `src/i18n/**` would
 * invent a dependency edge `docs/07` §2.3's arrow does not have — the same
 * reason `src/core/errors.ts` spells its own `rh-error-*` ids. `src/i18n/keys.ts`
 * declares this id in `MAIN_WINDOW_MESSAGE_IDS`, and
 * `test/unit/sources/pubmed-source.test.ts` compares the two copies, which a
 * test file may do because it is under no layering rule.
 */
export const PUBMED_DISPLAY_NAME_KEY = "research-helper-source-pubmed";

/**
 * The secret this adapter reads when it is given a store.
 *
 * `src/core/secretStore.ts`'s `SECRET_IDS` declares it; `docs/09` §1.7 is the
 * interface it belongs to.
 */
export const NCBI_SECRET_ID: SecretId = "source.ncbi";

/** `efetch` endpoint, `docs/02` §3.2 + §3.4. No query string. */
export const PUBMED_EFETCH_BASE_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

/** `docs/02` §3.3: `retmax` "default 20, **max 10,000**". */
export const PUBMED_RETMAX_MAX = 10_000;

/** `docs/02` §3.3: `retstart` "**max 9998**", verified live. */
export const PUBMED_RETSTART_MAX = 9998;

/**
 * How many records PubMed will page through at all: offsets `0 … 9998`
 * inclusive. `docs/02` §3.3's own wording — "ESearch can only retrieve the
 * first 9,999 records matching the query".
 */
export const PUBMED_MAX_TOTAL_RESULTS = 9999;

/** `docs/02` §3.4: "Batch up to **200 PMIDs per call** via comma-separated `id`". */
export const EFETCH_MAX_IDS_PER_CALL = 200;

/** `docs/02` §3.4: "POST if the URL would exceed ~2000 chars". */
export const EFETCH_MAX_GET_URL_LENGTH = 2000;

/**
 * `SourceHealth.messageKey` for a healthy probe.
 *
 * **There is no `*-health-ok` Fluent id in the corpus.** `src/i18n/keys.ts`
 * declares the 16 `rh-error-*` ids and one id per source name, and nothing
 * else; `docs/07` §4.2 types `messageKey` as a bare `string` and names no id,
 * and no card in `plan/` adds one (`grep -rn healthCheck plan/` returns this
 * card's step 8 and one Phase 2 line). Adding an id means editing
 * `src/i18n/keys.ts` and both `mainWindow.ftl` bundles, none of which is in
 * this card's `Files`. So the one id that exists for this source is used, which
 * renders as "PubMed" rather than as a missing-key placeholder, and the
 * substitution is this one constant when the real id lands.
 */
export const PUBMED_HEALTH_OK_MESSAGE_KEY = PUBMED_DISPLAY_NAME_KEY;

/** `SourceHealth.messageKey` when the probe failed and carried no key of its own. */
export const PUBMED_HEALTH_FAILED_MESSAGE_KEY = "rh-error-source";

/**
 * Capabilities, filled honestly — `docs/07` §4.2 and this card's step 1.
 *
 * `relatedByWork`, `citationGraph` and `lookupById` are all empty/false because
 * `elink`, `esummary` and the PMC ID Converter are **not** implemented here
 * (this card's **Do NOT**; they are Phase 2/5 work) and `findRelated` /
 * `lookup` are therefore not declared on the object this module builds. A
 * capability flag that promises a method nobody implements is the one thing
 * §4.2's "honestly" rules out.
 *
 * `maxPageSize` is `esearch`'s own cap (§3.3, "max 10,000"), not the 200 of
 * `efetch`: `efetch` batching is this adapter's business and invisible to the
 * caller, so reporting 200 would understate what one `search()` accepts.
 * {@link EFETCH_MAX_IDS_PER_CALL} is the separate figure for the separate
 * endpoint.
 */
export const PUBMED_CAPABILITIES: SourceCapabilities = {
  keywordSearch: true,
  // `docs/02` §12.3's PubMed column has no n/a cell: `OR`, `NOT`, `"…"`,
  // `[Title]`, `[Title/Abstract]`, `[Author]`. `journal` is listed because
  // `FIELD_TAGS` (`./query.ts`) renders `[Journal]`, a row §12.3 does not yet
  // carry (`plan/00` §6 item 63). `P2-T28`.
  query: {
    or: true,
    not: true,
    phrase: true,
    fields: ["title", "abstract", "author", "journal"],
  },
  relatedByWork: false,
  lookupById: [],
  abstractsInSearch: false,
  citationGraph: false,
  dateFilter: true,
  // The renderer's own object, not a copy (`P2-T34`): what this declares is
  // what `./query.ts` refuses from, so the two cannot drift.
  filters: PUBMED_FILTERS,
  maxPageSize: PUBMED_RETMAX_MAX,
  maxTotalResults: PUBMED_MAX_TOTAL_RESULTS,
  benefitsFromApiKey: true,
};

/**
 * The warning a truncated result set carries on {@link SourcePage.warnings}.
 *
 * One string for all three ways the ceiling can bite — a clamped `retstart`, a
 * `retmax` cut short by it, and a `count` larger than PubMed will page through
 * — because they are the same fact about the same request and a caller that
 * surfaces warnings should not show three.
 */
export const PUBMED_TRUNCATION_WARNING =
  `PubMed paginates only the first ${PUBMED_MAX_TOTAL_RESULTS} records of a ` +
  `result set (retstart max ${PUBMED_RETSTART_MAX}); this result set was ` +
  `truncated at that ceiling and the remaining records were not retrieved.`;

// ---------------------------------------------------------------------------
// 2. The `efetch` request
// ---------------------------------------------------------------------------

/**
 * The `efetch` parameters, in the order they are emitted.
 *
 * Fixed for the reason `src/sources/pubmed/query.ts`'s `PARAM_ORDER` is fixed:
 * `docs/13` §2.2 keys a recorded fixture on a hash of
 * `{method, url-with-keys-redacted, body}`, so a reordering would silently
 * invalidate every recorded `efetch` fixture. Same shape as the `esearch`
 * order — the resource parameters, then the credential, then D10's identity
 * pair last.
 */
const EFETCH_PARAM_ORDER = [
  "db",
  "id",
  "retmode",
  "rettype",
  "api_key",
  "tool",
  "email",
] as const;

type EfetchParamName = (typeof EFETCH_PARAM_ORDER)[number];

/** One built `efetch` call: what to send, and what is safe to keep about it. */
export interface PubmedEfetchRequest {
  /** `"GET"`, or `"POST"` once the GET URL would pass ~2000 characters. */
  readonly method: HttpMethod;
  /** The URL actually transmitted. Carries the parameters only on a GET. */
  readonly url: string;
  /** The form body, on a POST only. May contain `api_key`; never log it. */
  readonly body: string | undefined;
  /** `docs/07` §5.3 `endpointBaseUrl` — the endpoint with no query string. */
  readonly endpointBaseUrl: string;
  /** §5.3 `transmittedUrl` — {@link url} with credentials removed. */
  readonly transmittedUrl: string;
  /** {@link body} with `api_key` left out, or `undefined` on a GET. */
  readonly transmittedBody: string | undefined;
}

/**
 * Build one `efetch` call for up to {@link EFETCH_MAX_IDS_PER_CALL} PMIDs.
 *
 * `docs/02` §3.4 fixes every choice: `retmode=xml` because it "is the only mode
 * that yields structured abstracts, MeSH headings, and the full ID list",
 * `rettype=abstract` as in its worked example, 200 ids per call, and POST once
 * the URL "would exceed ~2000 chars". `tool` and `email` come from
 * `ncbiIdentityParams()` and cannot be overridden (D10).
 *
 * @param pmids - 1 … 200 PMIDs, in the order `esearch` returned them
 * @param apiKey - NCBI's optional `api_key`; omitted when absent or empty
 * @returns the request, with a redacted form of whichever half carried the key
 * @throws RangeError when `pmids` is empty or longer than 200 — §3.4 gives the
 *   batch limit, and a silently split or silently truncated batch would make
 *   "a 250-PMID result set issues exactly two `efetch` calls" unobservable
 */
export function buildEfetchRequest(
  pmids: readonly string[],
  apiKey?: string,
): PubmedEfetchRequest {
  if (pmids.length === 0) {
    throw new RangeError(
      `[research-helper] efetch needs at least one PMID; docs/02 §3.8 returns ` +
        `an empty <PubmedArticleSet/> for an unknown id, so an empty id list ` +
        `is a caller bug rather than an empty result.`,
    );
  }
  if (pmids.length > EFETCH_MAX_IDS_PER_CALL) {
    throw new RangeError(
      `[research-helper] efetch takes at most ${EFETCH_MAX_IDS_PER_CALL} ` +
        `PMIDs per call (docs/02 §3.4); got ${pmids.length}.`,
    );
  }

  const identity = ncbiIdentityParams();
  const values: Partial<Record<EfetchParamName, string>> = {
    db: "pubmed",
    id: pmids.join(","),
    retmode: "xml",
    rettype: "abstract",
    tool: identity.tool,
    email: identity.email,
  };
  // The redacted form is rendered a *second time* from the same values with
  // `api_key` left out, rather than pattern-matched out of the first: an NCBI
  // key is shorter than `redact()`'s 40-character catch-all, so a form body is
  // outside what `src/core/errors.ts`'s pattern set can protect.
  const withoutKey = renderEfetchParams(values);
  const withKey =
    apiKey === undefined || apiKey === ""
      ? withoutKey
      : renderEfetchParams({ ...values, api_key: apiKey });
  const getUrl = `${PUBMED_EFETCH_BASE_URL}?${withKey}`;

  if (getUrl.length <= EFETCH_MAX_GET_URL_LENGTH) {
    return {
      method: "GET",
      url: getUrl,
      body: undefined,
      endpointBaseUrl: PUBMED_EFETCH_BASE_URL,
      transmittedUrl: redactUrl(getUrl),
      transmittedBody: undefined,
    };
  }

  // The whole parameter set moves into the body and the URL keeps none of it.
  // Splitting it — identity in the query string, `id=` in the body — would be
  // a guess about how NCBI's CGI merges the two sources, and nothing in the
  // corpus records that it does.
  return {
    method: "POST",
    url: PUBMED_EFETCH_BASE_URL,
    body: withKey,
    endpointBaseUrl: PUBMED_EFETCH_BASE_URL,
    transmittedUrl: redactUrl(PUBMED_EFETCH_BASE_URL),
    transmittedBody: withoutKey,
  };
}

/** The ordered, URL-encoded parameter string. */
function renderEfetchParams(
  values: Partial<Record<EfetchParamName, string>>,
): string {
  return EFETCH_PARAM_ORDER.flatMap((name) => {
    const value = values[name];
    return value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`];
  }).join("&");
}

// ---------------------------------------------------------------------------
// 3. The `esearch` response
// ---------------------------------------------------------------------------

/**
 * What `docs/02` §3.3's `esearchresult` object yields, after validation.
 *
 * `count`, `querytranslation` and `translationset` are step 5's three fields,
 * kept under NCBI's own spellings because `docs/07` §5.3 types
 * `SourceProvenance.sourceExtras` as "source-specific extras … keyed by the
 * source's own field names — e.g. PubMed's `count`, `querytranslation` and
 * `translationset`".
 */
export interface PubmedSourceExtras {
  /** `esearchresult.count`, as a number; `undefined` when NCBI omitted it. */
  readonly count: number | undefined;
  /** PubMed's MeSH-expanded rendering of the term. */
  readonly querytranslation: string | undefined;
  /** The per-term expansion table; empty when NCBI sent none. */
  readonly translationset: readonly PubmedTranslation[];
}

/** One `translationset` entry. */
export interface PubmedTranslation {
  readonly from: string;
  readonly to: string;
}

/** A page of PubMed results: `docs/07` §4.2's page plus step 5's extras. */
export interface PubmedSearchPage extends SourcePage {
  /** Fed straight into `SourceProvenance.sourceExtras` by `P1-T17`. */
  readonly sourceExtras: PubmedSourceExtras;
}

/** The adapter, with `search`'s return narrowed to {@link PubmedSearchPage}. */
export interface PubmedSource extends LiteratureSource {
  search(query: SourceQuery, ctx: SourceCallContext): Promise<PubmedSearchPage>;
}

/** What {@link createPubmedSource} needs from the composition root. */
export interface PubmedSourceDeps {
  /** `P1-T05`'s client. Pacing, retry and 429 handling all live behind it. */
  readonly http: HttpClient;
  /** `src/core/clock.ts`; only `healthCheck`'s `latencyMs` reads it. */
  readonly clock: Clock;
  /** `P1-T10`'s XML mapper. Required: without it a page has no records. */
  readonly mapRecords: PubmedRecordMapper;
  /**
   * The key store (`src/core/secretStore.ts`). Omitted — as in a unit test of
   * the unkeyed path, and as in the plugin today, where nothing constructs one
   * at startup — every request goes out without `api_key`.
   */
  readonly secrets?: SecretStore;
  /** Diagnostics. Never given a raw URL or a request body. */
  readonly logger?: Logger;
}

/**
 * `P1-T10`'s mapper, as this adapter consumes it.
 *
 * One `efetch` response body in, that batch's records out. The body arrives as
 * text because `docs/02` §3.4 has no JSON mode and `P1-T10` step 1 parses it
 * with `DOMParser`; `retrievedAtEpochMs` is the mapper's own injected clock
 * (`P1-T10` step 10), not this adapter's.
 *
 * This adapter never builds a `SourceRecord` and never holds the response text
 * after handing it over, so `docs/07` §5.1's `raw` field — kept only when
 * `logRequestBodies` is on, NFR-7 — stays entirely the mapper's decision.
 */
export type PubmedRecordMapper = (xml: string) => readonly SourceRecord[];

// ---------------------------------------------------------------------------
// 4. The adapter
// ---------------------------------------------------------------------------

/**
 * The probe query `healthCheck` sends.
 *
 * `retmax=0` makes it return a count and no identifiers, which is this card's
 * step 8 and `docs/07` §4.2's "must not consume meaningful quota": one request,
 * no `efetch`, no record. The term is a fixed word rather than anything a user
 * typed — a health check must not send user content (`docs/09` §4).
 */
const HEALTH_PROBE_QUERY: SourceQuery = {
  terms: { kind: "term", value: "pubmed" },
  limit: 0,
};

/**
 * Build the PubMed adapter.
 *
 * @param deps - the HTTP client, the clock, `P1-T10`'s mapper, and optionally a
 *   key store and a logger
 * @returns a `docs/07` §4.2 `LiteratureSource` for PubMed
 */
export function createPubmedSource(deps: PubmedSourceDeps): PubmedSource {
  const { http, clock, mapRecords } = deps;

  /**
   * The `api_key` for the next request, or `undefined`.
   *
   * Read per call rather than cached: `docs/09` §2.3's prefs pane lets the user
   * add or clear the key while Zotero runs, and the store is the only thing
   * that knows. A store that throws is treated as "no key" — §3.1 makes the key
   * optional, so an unreadable keychain must degrade to the unkeyed budget
   * rather than fail a search. The value itself never reaches the log.
   */
  async function resolveApiKey(): Promise<string | undefined> {
    const { secrets } = deps;
    if (secrets === undefined) return undefined;
    try {
      const value = await secrets.get(NCBI_SECRET_ID);
      return value === undefined || value.trim() === "" ? undefined : value;
    } catch {
      deps.logger?.warn("NCBI api_key could not be read; going unkeyed", {
        sourceId: PUBMED_SOURCE_ID,
        secretId: NCBI_SECRET_ID,
      });
      return undefined;
    }
  }

  /** One `esearch`, validated, with the body-level error checked first. */
  async function esearch(
    query: SourceQuery,
    retmax: number,
    retstart: number,
    ctx: SourceCallContext,
  ): Promise<PubmedEsearchResult> {
    ctx.token.throwIfCancelled();
    const apiKey = await resolveApiKey();
    const request = buildEsearchRequest({
      query,
      retmax,
      retstart,
      retmode: "json",
      ...(apiKey !== undefined && { apiKey }),
    });

    // `responseType: "text"` is not optional: `HttpResponse.body` is `""` for
    // every other value, because XHR's `responseText` getter throws.
    const response = await http.request("GET", request.url, {
      responseType: "text",
      token: ctx.token,
    });

    // `request.transmittedUrl` is `redactUrl`'s output, built by `P1-T08`.
    deps.logger?.debug("pubmed esearch", {
      sourceId: PUBMED_SOURCE_ID,
      url: request.transmittedUrl,
      status: response.status,
    });

    return parseEsearchBody(response.body, request.transmittedUrl);
  }

  /** One page: `esearch`, then one `efetch` per batch of ≤ 200 PMIDs. */
  async function search(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<PubmedSearchPage> {
    const requestedStart = readCursor(query.cursor);
    const retstart = Math.min(requestedStart, PUBMED_RETSTART_MAX);
    const requestedMax = normalizeLimit(query.limit);
    const retmax = Math.min(
      requestedMax,
      PUBMED_RETMAX_MAX,
      PUBMED_MAX_TOTAL_RESULTS - retstart,
    );

    const result = await esearch(query, retmax, retstart, ctx);
    const total = result.extras.count;

    // Never take more identifiers than were asked for. `retstart + retmax` is
    // held at or below the ceiling above, so honouring an over-long `idlist`
    // would page past `retstart=9998` by the back door — which this card's
    // **Do NOT** forbids, and which a server is under no obligation to prevent.
    const found = result.pmids.slice(0, retmax);

    const warnings: string[] = [];
    const truncated =
      requestedStart > PUBMED_RETSTART_MAX ||
      retmax < requestedMax ||
      (total !== undefined && total > PUBMED_MAX_TOTAL_RESULTS);
    if (truncated) warnings.push(PUBMED_TRUNCATION_WARNING);

    const records: SourceRecord[] = [];
    for (const batch of chunk(found, EFETCH_MAX_IDS_PER_CALL)) {
      ctx.token.throwIfCancelled();
      // No `catch`: a failed `efetch` must not return the `esearch` ids as if
      // they were records. The first step's work is lost and that is correct —
      // `docs/02` §3.8's 429 and 5xx are retried by `P1-T05`, not papered over
      // here.
      records.push(...(await efetch(batch, ctx)));
    }

    const reached = retstart + found.length;
    const reachable = Math.min(
      total ?? PUBMED_MAX_TOTAL_RESULTS,
      PUBMED_MAX_TOTAL_RESULTS,
    );
    const nextCursor =
      found.length > 0 && reached < reachable ? String(reached) : undefined;

    return {
      records,
      totalAvailable: total,
      nextCursor,
      warnings,
      sourceExtras: result.extras,
    };
  }

  /** One `efetch` batch, mapped by `P1-T10`'s mapper. */
  async function efetch(
    pmids: readonly string[],
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]> {
    const apiKey = await resolveApiKey();
    const request = buildEfetchRequest(pmids, apiKey);
    const response = await http.request(request.method, request.url, {
      responseType: "text",
      token: ctx.token,
      ...(request.body !== undefined && {
        body: request.body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    });

    // The body is deliberately absent from this line; see the module header.
    deps.logger?.debug("pubmed efetch", {
      sourceId: PUBMED_SOURCE_ID,
      method: request.method,
      url: request.transmittedUrl,
      pmids: pmids.length,
      status: response.status,
    });

    return mapRecords(response.body);
  }

  /**
   * Page until `limit` or exhaustion.
   *
   * The page size is {@link EFETCH_MAX_IDS_PER_CALL}, so one page is exactly
   * one `efetch` call — derived from `docs/02` §3.4's batch limit rather than
   * chosen, and it keeps a cancellation between pages cheap. `docs/07` §8.5
   * caps `maxResults` at 200 anyway, so Phase 1 normally makes one pass.
   *
   * `ctx.token.throwIfCancelled()` runs at the top of every page, which is
   * `docs/07` §7.4 check point 1; `search` runs it again before every `efetch`
   * batch.
   */
  async function* searchAll(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): AsyncGenerator<SourceRecord, void, undefined> {
    const limit = normalizeLimit(query.limit);
    let cursor = query.cursor;
    let emitted = 0;
    let total: number | undefined;

    while (emitted < limit) {
      ctx.token.throwIfCancelled();
      const pageSize = Math.min(limit - emitted, EFETCH_MAX_IDS_PER_CALL);
      const page = await search(
        {
          ...query,
          limit: pageSize,
          ...(cursor !== undefined && { cursor }),
        },
        ctx,
      );

      // `SourcePage.warnings` has no return path out of an async iterable, so
      // the truncation notice travels on the reporter's warning list instead —
      // which is what `docs/07` §4.1's `ProgressReporter.warn` is for.
      for (const warning of page.warnings) ctx.progress?.warn(warning);
      total ??= page.totalAvailable;

      for (const record of page.records) {
        if (emitted >= limit) return;
        yield record;
        emitted += 1;
        ctx.progress?.setProgress(emitted, progressTotal(total, limit));
      }

      if (page.nextCursor === undefined) return;
      cursor = page.nextCursor;
    }
  }

  /** One cheap `esearch` with `retmax=0`. Never throws except on cancellation. */
  async function healthCheck(ctx: SourceCallContext): Promise<SourceHealth> {
    const startedAtMs = clock.now();
    try {
      ctx.token.throwIfCancelled();
      const apiKey = await resolveApiKey();
      const request = buildEsearchRequest({
        query: HEALTH_PROBE_QUERY,
        retmax: 0,
        retstart: 0,
        retmode: "json",
        ...(apiKey !== undefined && { apiKey }),
      });
      const response = await http.request("GET", request.url, {
        responseType: "text",
        token: ctx.token,
      });
      // Checked, not ignored: a 200 carrying `esearchresult.ERROR` is not a
      // healthy source (`docs/02` §3.8).
      parseEsearchBody(response.body, request.transmittedUrl);

      const quotaHint = readQuotaHint(response);
      return {
        ok: true,
        messageKey: PUBMED_HEALTH_OK_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
        ...(quotaHint !== undefined && { quotaHint }),
      };
    } catch (error) {
      // Cancellation is not a health verdict.
      if (error instanceof OperationCancelledError) throw error;
      return {
        ok: false,
        messageKey:
          error instanceof ResearchHelperError
            ? error.messageKey
            : PUBMED_HEALTH_FAILED_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
      };
    }
  }

  return {
    id: PUBMED_SOURCE_ID,
    displayNameKey: PUBMED_DISPLAY_NAME_KEY,
    capabilities: PUBMED_CAPABILITIES,
    rateLimitKey: NCBI_HOST,
    /** `docs/02` §3.1 marks the key optional, so PubMed is always usable. */
    isConfigured: () => true,
    healthCheck,
    search,
    searchAll,
    explainQuery: (query) => explainPubmedQuery(query),
  };
}

// ---------------------------------------------------------------------------
// 5. Response validation — pure, and exported so the fixtures can reach it
// ---------------------------------------------------------------------------

/** A validated `esearch` body. */
export interface PubmedEsearchResult {
  /** `idlist`, digits only, in the order NCBI returned them. */
  readonly pmids: readonly string[];
  /** Step 5's three provenance fields. */
  readonly extras: PubmedSourceExtras;
}

/**
 * Validate one `esearch` JSON body.
 *
 * **`esearchresult.ERROR` is checked before anything else** (this card's step 3,
 * `docs/02` §3.8): the identifier list is not read, so a 200 carrying an error
 * can never be returned as an empty page.
 *
 * @param body - the response text, `retmode=json`
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @returns the identifier list and the provenance extras
 * @throws SourceError when the body carries `esearchresult.ERROR`
 * @throws ParseError when the body is not the documented shape
 */
export function parseEsearchBody(
  body: string,
  transmittedUrl: string,
): PubmedEsearchResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (cause) {
    throw new ParseError(
      PUBMED_SOURCE_ID,
      `[research-helper] PubMed esearch returned a body that is not JSON.`,
      { url: transmittedUrl, bodyLength: body.length },
      { cause },
    );
  }

  const envelope = asRecord(parsed);
  const result =
    envelope === undefined ? undefined : asRecord(envelope.esearchresult);
  if (result === undefined) {
    throw new ParseError(
      PUBMED_SOURCE_ID,
      `[research-helper] PubMed esearch returned JSON with no esearchresult ` +
        `object; docs/02 §3.3 gives that object as the whole response.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }

  const upstream = result.ERROR;
  if (upstream !== undefined && upstream !== null) {
    const text =
      typeof upstream === "string" ? upstream : JSON.stringify(upstream);
    throw new SourceError(
      PUBMED_SOURCE_ID,
      `[research-helper] PubMed esearch failed inside an HTTP 200: ${text}`,
      { url: transmittedUrl, upstreamError: text },
    );
  }

  return {
    pmids: readIdList(result.idlist),
    extras: {
      count: readCount(result.count),
      querytranslation:
        typeof result.querytranslation === "string"
          ? result.querytranslation
          : undefined,
      translationset: readTranslationSet(result.translationset),
    },
  };
}

/** `{...}` and not `null`, `[]` or a primitive. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const DIGITS_ONLY = /^\d+$/u;

/** `idlist`, keeping the digit strings NCBI documents and dropping the rest. */
function readIdList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && DIGITS_ONLY.test(entry)) out.push(entry);
  }
  return out;
}

/** `count`, which §3.3's real response sends as a *string*. */
function readCount(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !DIGITS_ONLY.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** `translationset`, keeping only entries that have both halves. */
function readTranslationSet(value: unknown): readonly PubmedTranslation[] {
  if (!Array.isArray(value)) return [];
  const out: PubmedTranslation[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    if (row === undefined) continue;
    const { from, to } = row;
    if (typeof from === "string" && typeof to === "string")
      out.push({ from, to });
  }
  return out;
}

/**
 * `X-Ratelimit-Limit` / `X-Ratelimit-Remaining` as a `SourceHealth.quotaHint`.
 *
 * `docs/02` §3.1 records both headers live-verified. The hint is
 * `remaining/limit` and not a sentence, because `SourceHealth.quotaHint` is
 * shown beside a localized message and is not itself localizable.
 */
function readQuotaHint(response: HttpResponse): string | undefined {
  const limit = response.header("X-Ratelimit-Limit");
  const remaining = response.header("X-Ratelimit-Remaining");
  if (limit === undefined || remaining === undefined) return undefined;
  return `${remaining}/${limit}`;
}

/** `SourceQuery.cursor` → a `retstart`. An unusable cursor restarts at 0. */
function readCursor(cursor: string | undefined): number {
  if (cursor === undefined || !DIGITS_ONLY.test(cursor)) return 0;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `SourceQuery.limit` as a non-negative integer. */
function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
}

/** The denominator `ctx.progress` is given: neither side can exceed the ceiling. */
function progressTotal(
  total: number | undefined,
  limit: number,
): number | undefined {
  if (total === undefined) return undefined;
  return Math.min(total, limit, PUBMED_MAX_TOTAL_RESULTS);
}

/** Split into runs of at most `size`. */
function chunk<T>(items: readonly T[], size: number): readonly T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
