/**
 * The Europe PMC adapter: one `search` call per page with inline abstracts,
 * `cursorMark` pagination, and a loud failure on the errors Europe PMC hides
 * inside HTTP 200.
 *
 * **Scope.** `P2-T03`. `docs/07` §4.2's `LiteratureSource`, implemented for
 * `www.ebi.ac.uk`. Query *rendering* is `./query.ts`'s
 * {@link buildEuropePmcSearchRequest}; JSON → `SourceRecord` is `./mapper.ts`
 * and arrives as {@link EuropePmcSourceDeps.mapRecords}, the split `P1-T09` /
 * `P1-T10` made for PubMed.
 *
 * ## What this file decides, and where each decision comes from
 *
 * - **`resultType=core` on every search request.** `docs/02` §4.4: only `core`
 *   carries `abstractText`; `lite` is the API default and has no abstract (the
 *   card's Do NOT). That is the whole reason this is a one-round-trip source
 *   and `abstractsInSearch: true`.
 * - **`pageSize` is `SourceQuery.limit` clamped to 1 … 1000** (`docs/02` §4.1,
 *   verified: `pageSize=1001` is an error). `maxPageSize: 1000` says the same
 *   to the planner. `maxTotalResults` is `undefined`: `cursorMark` paging has
 *   no documented depth ceiling (§4.6, "required for deep paging").
 * - **`cursorMark=*` on the first page**, then `nextCursorMark` (§4.6).
 *   Termination is §4.6's two rules — `nextCursorMark` equals the cursor sent,
 *   or `resultList.result` is empty — plus two the recorded corpus supplied
 *   (2026-10-14): no `nextCursorMark` at all (the service omits the member on
 *   a final page), and a page shorter than `pageSize`, after which the next
 *   page was measured empty (hitCount 5, pageSize 3: page 2 held 2 records
 *   *and* a cursor, page 3 held none). The short-page rule saves that empty
 *   request. `page=` is never sent and `nextPageUrl` is never followed (both
 *   Do NOTs; the URL is also where the service echoes the contact address).
 * - **`errCode` is checked before `resultList` is read** (`docs/02` §4.9).
 *   The recorded `search-error-empty-query` fixture is exactly this: HTTP 200,
 *   `{"errCode":404,"errMsg":"No search criteria provided…"}`. It becomes a
 *   {@link SourceError}; a body that is not JSON (§4.7 measured
 *   `Content-Type: text/plain` on a 503) becomes a {@link ParseError}.
 * - **No key, ever.** `docs/02` §4.1: "None required, none available", so
 *   `benefitsFromApiKey: false`, `isConfigured()` is `true`, and nothing here
 *   takes a `SecretStore`. `email=` carries the maintainer address on every
 *   request, added by the request builder (§2.2's final assignment table).
 * - **`rateLimitKey` is {@link EBI_HOST}**, imported, so `docs/07` §7.3's
 *   one-bucket-per-host rule is mechanical. The budget itself lives in
 *   `hostLimiter.ts` and nowhere else (`plan/README.md` §5 rule 4).
 * - **`citationGraph: true`** — the card's step 6 and `docs/02` §4.7: the
 *   service has `/citations` and `/references`. Neither is called by this
 *   file (`findRelated` is not declared here; `relatedByWork: false`), so the
 *   flag describes the service, not a method this adapter exposes yet. The
 *   tension with `docs/07` §4.2's "declare honestly" is recorded in the card
 *   report; the card asked for `true` in so many words.
 * - **`fullTextXML` is never called** (`docs/02` §4.8: 404 with an empty body
 *   for both "not OA here" and "no such id"; the card's Do NOT). The mapper
 *   carries `openAccess` so a later card can gate on it.
 *
 * ## Errors
 *
 * - `errCode` inside a 200 → {@link SourceError} with the upstream text.
 * - Not JSON, or JSON without `resultList.result` → {@link ParseError}.
 * - **Transport-level failures propagate unwrapped**, exactly as the PubMed
 *   adapter leaves them: `P1-T05`'s client throws `docs/07` §10.1's classes
 *   (`RateLimitError` with `retryAfterMs`, `UpstreamServerError`, …), and
 *   wrapping them would discard `retryable` and the 429 handling the client
 *   owns. The `search-post-long-query` and `error-500` fixtures exercise
 *   both halves.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3 / §4.2).
 * Nothing below names the `Zotero` global, touches a preference or reads a
 * file; cancellation goes through `ctx.token`, diagnostics through the
 * injected {@link Logger}. Every URL that reaches a log or an error is the
 * builder's `transmittedUrl` (already through `redactUrl`).
 */

import type { Clock } from "../../core/clock";
import {
  OperationCancelledError,
  ParseError,
  ResearchHelperError,
  SourceError,
} from "../../core/errors";
import type { HttpClient } from "../../core/http/client";
import type { Logger } from "../../core/logger";
import { EBI_HOST } from "../../core/rateLimit/hostLimiter";
import type { SourceRecord } from "../../model/sourceRecord";
import type {
  LiteratureSource,
  SourceCallContext,
  SourceCapabilities,
  SourceHealth,
  SourcePage,
  SourceQuery,
} from "../types";
import { EUROPEPMC_SOURCE_ID, type EuropePmcRecordMapper } from "./mapper";
import {
  buildEuropePmcSearchRequest,
  EUROPEPMC_FIRST_CURSOR,
  EUROPEPMC_PAGE_SIZE_MAX,
  EUROPEPMC_PAGE_SIZE_MIN,
  EUROPEPMC_RENDERED_FIELDS,
  explainEuropePmcQuery,
  type EuropePmcSearchRequest,
} from "./query";

export { EUROPEPMC_SOURCE_ID } from "./mapper";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/**
 * `LiteratureSource.displayNameKey`.
 *
 * Spelled as a literal because `src/sources/**` importing `src/i18n/**` would
 * invent a dependency edge `docs/07` §2.3 does not have — the same reason
 * `PUBMED_DISPLAY_NAME_KEY` is a literal. It follows the one convention the
 * corpus has for a source name, `research-helper-source-<SourceId>`
 * (`src/i18n/keys.ts`, `MAIN_WINDOW_MESSAGE_IDS`, where the PubMed id lives).
 *
 * **At the time of writing no bundle declares this id.** Source display names
 * belong to `research-helper-mainWindow.ftl` — the searchDialog bundle's own
 * header routes them there, and `docs/01` §9.3 makes declaring an id in two
 * files a silent defect — and neither mainWindow bundle nor `keys.ts` is in
 * `P2-T03`'s `Files`. Until the entry lands the dialog shows the raw id for
 * this source. Reported with the card; the substitution is nothing here.
 */
export const EUROPEPMC_DISPLAY_NAME_KEY = "research-helper-source-europepmc";

/** `SourceHealth.messageKey` for a healthy probe — see `PUBMED_HEALTH_OK_MESSAGE_KEY`. */
export const EUROPEPMC_HEALTH_OK_MESSAGE_KEY = EUROPEPMC_DISPLAY_NAME_KEY;

/** `SourceHealth.messageKey` when the probe failed and carried no key of its own. */
export const EUROPEPMC_HEALTH_FAILED_MESSAGE_KEY = "rh-error-source";

/**
 * Capabilities, as the card's step 6 declares them and as `./query.ts`
 * renders them (`capabilities.query` is `plan/00` §6 item 97: the adapter's
 * own `docs/02` §12.3 column, taken from the renderer's prefix table so the
 * two cannot drift).
 */
export const EUROPEPMC_CAPABILITIES: SourceCapabilities = {
  keywordSearch: true,
  // `docs/02` §12.3's Europe PMC column has no n/a cell: `OR`, `NOT`, `"…"`,
  // `TITLE:`, `ABSTRACT:`, `AUTH:`; plus §4.3's `TITLE_ABS:`, `JOURNAL:` and
  // `MESH_TERM:`. `affiliation` is absent — §4.3 has no prefix for it.
  query: {
    or: true,
    not: true,
    phrase: true,
    fields: EUROPEPMC_RENDERED_FIELDS,
  },
  relatedByWork: false,
  lookupById: [],
  abstractsInSearch: true,
  citationGraph: true,
  dateFilter: true,
  maxPageSize: EUROPEPMC_PAGE_SIZE_MAX,
  maxTotalResults: undefined,
  benefitsFromApiKey: false,
};

// ---------------------------------------------------------------------------
// 2. The response
// ---------------------------------------------------------------------------

/**
 * `docs/07` §5.3 `SourceProvenance.sourceExtras`, keyed by Europe PMC's own
 * names: `hitCount`, the echoed `request.queryString`, and the API `version`.
 */
export interface EuropePmcSourceExtras {
  readonly hitCount: number | undefined;
  readonly queryString: string | undefined;
  readonly version: string | undefined;
}

/** A page of Europe PMC results: `docs/07` §4.2's page plus the extras. */
export interface EuropePmcSearchPage extends SourcePage {
  readonly sourceExtras: EuropePmcSourceExtras;
}

/** The adapter, with `search`'s return narrowed to {@link EuropePmcSearchPage}. */
export interface EuropePmcSource extends LiteratureSource {
  search(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<EuropePmcSearchPage>;
}

/** A validated `search` body. */
export interface EuropePmcSearchResult {
  /** `resultList.result`, unmapped — the mapper's input. */
  readonly results: readonly unknown[];
  /** `nextCursorMark`, or `undefined` when the service omitted it. */
  readonly nextCursorMark: string | undefined;
  readonly extras: EuropePmcSourceExtras;
}

/**
 * Validate one `search` JSON body.
 *
 * **`errCode` is checked before anything else** (`docs/02` §4.9: "Always check
 * for an `errCode` key before reading `resultList`"), so a 200 carrying an
 * error can never be returned as an empty page.
 *
 * @param body - the response text, `format=json`
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @throws SourceError when the body carries `errCode`
 * @throws ParseError when the body is not JSON or has no `resultList.result`
 *   array — the §4.7 text/plain case and a truncated body (`error-malformed`)
 */
export function parseEuropePmcSearchBody(
  body: string,
  transmittedUrl: string,
): EuropePmcSearchResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (cause) {
    throw new ParseError(
      EUROPEPMC_SOURCE_ID,
      `[research-helper] Europe PMC returned a body that is not JSON ` +
        `(docs/02 §4.7: not every Europe PMC response is a JSON envelope).`,
      { url: transmittedUrl, bodyLength: body.length },
      { cause },
    );
  }
  const envelope = asRecord(parsed);
  if (envelope === undefined) {
    throw new ParseError(
      EUROPEPMC_SOURCE_ID,
      `[research-helper] Europe PMC returned JSON that is not an object.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }

  if (envelope.errCode !== undefined && envelope.errCode !== null) {
    const errMsg =
      typeof envelope.errMsg === "string"
        ? envelope.errMsg
        : JSON.stringify(envelope.errMsg);
    throw new SourceError(
      EUROPEPMC_SOURCE_ID,
      `[research-helper] Europe PMC search failed inside an HTTP 200: ` +
        `errCode ${String(envelope.errCode)}: ${errMsg}`,
      {
        url: transmittedUrl,
        errCode: envelope.errCode,
        upstreamError: errMsg,
      },
    );
  }

  const resultList = asRecord(envelope.resultList);
  const results = resultList?.result;
  if (!Array.isArray(results)) {
    throw new ParseError(
      EUROPEPMC_SOURCE_ID,
      `[research-helper] Europe PMC search returned JSON with no ` +
        `resultList.result array; docs/02 §4.4 gives that array as the page.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }

  const request = asRecord(envelope.request);
  return {
    results,
    nextCursorMark:
      typeof envelope.nextCursorMark === "string" &&
      envelope.nextCursorMark.length > 0
        ? envelope.nextCursorMark
        : undefined,
    extras: {
      hitCount:
        typeof envelope.hitCount === "number" &&
        Number.isFinite(envelope.hitCount)
          ? envelope.hitCount
          : undefined,
      queryString:
        typeof request?.queryString === "string"
          ? request.queryString
          : undefined,
      version:
        typeof envelope.version === "string" ? envelope.version : undefined,
    },
  };
}

/** `{...}` and not `null`, `[]` or a primitive. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// ---------------------------------------------------------------------------
// 3. The adapter
// ---------------------------------------------------------------------------

/** What {@link createEuropePmcSource} needs from the composition root. */
export interface EuropePmcSourceDeps {
  /** `P1-T05`'s client. Pacing, retry and 429 handling all live behind it. */
  readonly http: HttpClient;
  /** `src/core/clock.ts`; only `healthCheck`'s `latencyMs` reads it. */
  readonly clock: Clock;
  /** `./mapper.ts`'s mapper. Required: without it a page has no records. */
  readonly mapRecords: EuropePmcRecordMapper;
  /** Diagnostics. Never given a response body. */
  readonly logger?: Logger;
}

/**
 * The probe query `healthCheck` sends: a fixed word, `pageSize=1`,
 * `resultType=idlist` (`docs/02` §4.4: "cheapest"), so one request and no
 * record. A health check never sends user content (`docs/09` §4).
 */
const HEALTH_PROBE_QUERY: SourceQuery = {
  terms: { kind: "term", value: "europepmc" },
  limit: 1,
};

/**
 * Decide whether another page exists. The four rules of the module header:
 * no cursor, a repeated cursor, an empty page, or a short page all mean "no".
 */
export function nextCursorAfter(
  sentCursor: string,
  nextCursorMark: string | undefined,
  pageLength: number,
  pageSize: number,
): string | undefined {
  if (nextCursorMark === undefined) return undefined;
  if (nextCursorMark === sentCursor) return undefined;
  if (pageLength === 0) return undefined;
  if (pageLength < pageSize) return undefined;
  return nextCursorMark;
}

/**
 * Build the Europe PMC adapter.
 *
 * @param deps - the HTTP client, the clock, the mapper and optionally a logger
 * @returns a `docs/07` §4.2 `LiteratureSource` for Europe PMC
 */
export function createEuropePmcSource(
  deps: EuropePmcSourceDeps,
): EuropePmcSource {
  const { http, clock, mapRecords } = deps;

  /** One request, however it travels, with the body-level error checked first. */
  async function fetchPage(
    request: EuropePmcSearchRequest,
    ctx: SourceCallContext,
  ): Promise<EuropePmcSearchResult> {
    ctx.token.throwIfCancelled();
    // `responseType: "text"` is not optional: `HttpResponse.body` is `""` for
    // every other value.
    const response = await http.request(request.method, request.url, {
      responseType: "text",
      token: ctx.token,
      ...(request.body !== undefined && {
        body: request.body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    });
    deps.logger?.debug("europepmc search", {
      sourceId: EUROPEPMC_SOURCE_ID,
      method: request.method,
      url: request.transmittedUrl,
      status: response.status,
    });
    return parseEuropePmcSearchBody(response.body, request.transmittedUrl);
  }

  /** One page. */
  async function search(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<EuropePmcSearchPage> {
    const pageSize = clampPageSize(query.limit);
    const cursor = query.cursor ?? EUROPEPMC_FIRST_CURSOR;
    const request = buildEuropePmcSearchRequest({
      query,
      pageSize,
      cursor,
      resultType: "core",
    });
    const result = await fetchPage(request, ctx);
    const records = mapRecords(result.results);
    return {
      records,
      totalAvailable: result.extras.hitCount,
      nextCursor: nextCursorAfter(
        cursor,
        result.nextCursorMark,
        result.results.length,
        pageSize,
      ),
      warnings: [],
      sourceExtras: result.extras,
    };
  }

  /**
   * Page until `limit` or exhaustion. Each page asks for exactly what is still
   * wanted, capped at `docs/02` §4.1's 1000 — so a replayed `limit` must match
   * a recorded `pageSize` (`plan/00` §6 item 76). `ctx.token.throwIfCancelled()`
   * runs at the top of every page (`docs/07` §7.4 check point 1).
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

    while (emitted < limit) {
      ctx.token.throwIfCancelled();
      const page = await search(
        {
          ...query,
          limit: Math.min(limit - emitted, EUROPEPMC_PAGE_SIZE_MAX),
          ...(cursor !== undefined && { cursor }),
        },
        ctx,
      );
      for (const warning of page.warnings) ctx.progress?.warn(warning);
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

  /** One cheap `idlist` probe. Never throws except on cancellation. */
  async function healthCheck(ctx: SourceCallContext): Promise<SourceHealth> {
    const startedAtMs = clock.now();
    try {
      const request = buildEuropePmcSearchRequest({
        query: HEALTH_PROBE_QUERY,
        pageSize: 1,
        resultType: "idlist",
      });
      // Checked, not ignored: a 200 carrying `errCode` is not a healthy source.
      await fetchPage(request, ctx);
      return {
        ok: true,
        messageKey: EUROPEPMC_HEALTH_OK_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
      };
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      return {
        ok: false,
        messageKey:
          error instanceof ResearchHelperError
            ? error.messageKey
            : EUROPEPMC_HEALTH_FAILED_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
      };
    }
  }

  return {
    id: EUROPEPMC_SOURCE_ID,
    displayNameKey: EUROPEPMC_DISPLAY_NAME_KEY,
    capabilities: EUROPEPMC_CAPABILITIES,
    rateLimitKey: EBI_HOST,
    /** `docs/02` §4.1: no key exists, so Europe PMC is always usable. */
    isConfigured: () => true,
    healthCheck,
    search,
    searchAll,
    explainQuery: (query) => explainEuropePmcQuery(query),
  };
}

/** `SourceQuery.limit` → `pageSize`, clamped to `docs/02` §4.1's 1 … 1000. */
export function clampPageSize(limit: number): number {
  if (!Number.isFinite(limit)) return EUROPEPMC_PAGE_SIZE_MIN;
  return Math.min(
    EUROPEPMC_PAGE_SIZE_MAX,
    Math.max(EUROPEPMC_PAGE_SIZE_MIN, Math.trunc(limit)),
  );
}
