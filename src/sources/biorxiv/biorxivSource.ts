/**
 * The bioRxiv / medRxiv adapter: **two `SourceId`s, one implementation**,
 * scoped to identifier lookup and preprint↔published resolution — never to
 * keyword search.
 *
 * **Scope.** `P2-T07`. `docs/07` §4.2's `LiteratureSource`, implemented for
 * `api.biorxiv.org`. `docs/07` §2.2 puts both servers in one directory —
 * "`biorxiv/` — bioRxiv + medRxiv share one adapter, two servers" — and
 * `docs/07` §5.1's `SourceId` union has both `biorxiv` and `medrxiv`, so
 * {@link createBiorxivSource} is parameterised by `server` and the composition
 * root builds it twice (card step 1). Each object has its own `id`, its own
 * display-name key and the **same** `rateLimitKey`, {@link BIORXIV_HOST}: one
 * bucket for both, as §7.3's one-row-per-host rule requires.
 *
 * ## What this file decides, and where each decision comes from
 *
 * - **No keyword search, declared honestly** (`docs/02` §8.4; `docs/07` §4.2:
 *   "the planner uses them, and faking `keywordSearch` here would route real
 *   user queries into a 35-minute sweep"). {@link BIORXIV_CAPABILITIES} says
 *   `keywordSearch: false` and an empty `query` dialect, so
 *   `normalizeForSource` reports a whole query tree as lost.
 * - **`search()` is a delegation, not a failure and not a zero result** (card
 *   step 3). It makes no request and returns an empty page whose
 *   `totalAvailable` is `undefined` — the server reported nothing, which is
 *   not "0 results" — and whose one warning,
 *   {@link biorxivKeywordSearchNotice}, says that preprint keyword search runs
 *   through Europe PMC `SRC:PPR`. `searchAll()` yields nothing and raises the
 *   same notice once through `ctx.progress`. The signal `P2-T14` renders as
 *   `⊕ ID lookup · preprint matching` is the capability itself
 *   (`docs/08` §4.2, decided 2026-09-09). **No `SRC:PPR` clause is added to
 *   the Europe PMC query** (owner, 2026-10-15, `plan/00` §6 item 177): its
 *   default search already returns preprints (`docs/02` §4.5), and
 *   `AND SRC:PPR` would drop its journal results. `biorxiv.test.ts` asserts
 *   the Europe PMC query stays unrestricted with both preprint sources on.
 * - **`lookup()` is `/details/{server}/{DOI}/na/json`, one DOI per request**
 *   (card step 4; `docs/02` §8.2). Only DOIs with a bioRxiv/medRxiv registrant
 *   prefix are sent (`./query.ts`, `biorxivLookupDoi`); each request costs one
 *   slot of the 1/s bucket. **Measured 2026-10-15: the host does not answer
 *   across servers** — a medRxiv DOI asked of `/details/biorxiv/` returns
 *   `no posts found` — and the prefix does not tell the servers apart
 *   (`docs/02` §11.2), so a caller holding an unattributed `10.64898/` DOI
 *   must ask both adapters.
 * - **{@link BiorxivSource.resolvePublished} is the cross-walk**:
 *   `/pubs/{server}/{DOI}/na/json`, whose records carry the published DOI as
 *   `relatedVersionIds` (the signal `P2-T11` consumes; `/details/`' own
 *   `published` member yields the same signal, so `lookup()` records carry it
 *   too).
 * - **Errors arrive inside HTTP 200** (`docs/02` §8.5; the card's fourth Do
 *   NOT). {@link parseBiorxivBody} reads `messages[0].status`: `"ok"` → the
 *   collection; a **not-found** status → no records (measured: `/details/`
 *   says `no posts found`, `/pubs/` says `no articles found for published
 *   version of …`, the DOI sometimes missing — §8.5's free text); anything
 *   else → a typed {@link SourceError} carrying the status. An **empty HTTP 200
 *   body** — §8.5's measured 2026-09-15 outage — is a retryable
 *   {@link BiorxivEmptyBodyError}, never "no results".
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3 / §4.2).
 * Nothing below names the `Zotero` global, touches a preference or reads a
 * file. No key and no contact parameter (`docs/02` §8.1; `docs/09` §5.6).
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
import { BIORXIV_HOST } from "../../core/rateLimit/hostLimiter";
import type { ExternalIds } from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";
import type {
  LiteratureSource,
  SourceCallContext,
  SourceCapabilities,
  SourceHealth,
  SourcePage,
  SourceQuery,
} from "../types";
import type { BiorxivRecordMapper } from "./mapper";
import {
  BIORXIV_DETAILS_PAGE_SIZE,
  BIORXIV_PREPRINT_SEARCH_ROUTE,
  BIORXIV_SERVER_LABELS,
  biorxivLookupDoi,
  buildBiorxivDetailsRequest,
  buildBiorxivPubsRequest,
  explainBiorxivQuery,
  type BiorxivEndpoint,
  type BiorxivRequest,
  type BiorxivServer,
} from "./query";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/**
 * `LiteratureSource.displayNameKey`, one per server. Literals, for the reason
 * the other adapters' keys are: `src/sources/**` importing `src/i18n/**`
 * would invent a dependency edge `docs/07` §2.3 does not have. Declared in
 * both `research-helper-mainWindow.ftl` bundles and listed in
 * `src/i18n/keys.ts` (`P2-T07`).
 */
export const BIORXIV_DISPLAY_NAME_KEYS: Readonly<
  Record<BiorxivServer, string>
> = {
  biorxiv: "research-helper-source-biorxiv",
  medrxiv: "research-helper-source-medrxiv",
};

/** `SourceHealth.messageKey` when the probe failed and carried no key of its own. */
export const BIORXIV_HEALTH_FAILED_MESSAGE_KEY = "rh-error-source";

/**
 * The DOI `healthCheck` looks up, per server: a known, existing preprint
 * (`docs/02` §8.3's and §11.2's own samples), so one cheap request proves the
 * host answers. A health check never sends user content (`docs/09` §4).
 */
export const BIORXIV_HEALTH_PROBE_DOIS: Readonly<
  Record<BiorxivServer, string>
> = {
  biorxiv: "10.64898/2026.07.31.741992",
  medrxiv: "10.64898/2026.09.03.26361736",
};

/** `docs/02` §8.5: the one success status. */
export const BIORXIV_STATUS_OK = "ok";

/**
 * The not-found statuses, as prefixes — measured 2026-10-15: `/details/`
 * answers `"no posts found"`; `/pubs/` answers `"no articles found for
 * published version of <DOI>"`, with the DOI sometimes missing (`docs/02`
 * §8.5). Not an error: the DOI is simply not on this server or not published.
 */
export const BIORXIV_NOT_FOUND_STATUSES: readonly string[] = [
  "no posts found",
  "no articles found",
];

/**
 * Capabilities, declared honestly (`docs/07` §4.2; card step 2). No keyword
 * search, so the `query` dialect is empty; `lookupById` is `doi` only;
 * `maxPageSize` is `/details/`' **30** (`docs/02` §8.2) so no planner budgets
 * it as 100; no server-side date filter for a DOI lookup; abstracts are not
 * "in search results" because there are no search results.
 */
export const BIORXIV_CAPABILITIES: SourceCapabilities = {
  keywordSearch: false,
  query: { or: false, not: false, phrase: false, fields: [] },
  relatedByWork: false,
  lookupById: ["doi"],
  abstractsInSearch: false,
  citationGraph: false,
  dateFilter: false,
  maxPageSize: BIORXIV_DETAILS_PAGE_SIZE,
  maxTotalResults: undefined,
  benefitsFromApiKey: false,
};

/**
 * The warning every `search()` page carries (card step 3). English, for the
 * reason `SEMANTICSCHOLAR_UNKEYED_NOTE` is: `sources/` may not import
 * `i18n/`; `P2-T14` renders the localized role row from the capability.
 *
 * @param server - the adapter's server
 */
export function biorxivKeywordSearchNotice(server: BiorxivServer): string {
  return (
    `${BIORXIV_SERVER_LABELS[server]} has no keyword search (docs/02 §8.4): ` +
    `it contributes identifier lookup and preprint↔published matching only. ` +
    `Keyword search of preprints runs through ${BIORXIV_PREPRINT_SEARCH_ROUTE}.`
  );
}

// ---------------------------------------------------------------------------
// 2. Errors and the body
// ---------------------------------------------------------------------------

/**
 * `docs/02` §8.5, measured 2026-09-15: every `/details` request answered HTTP
 * 200 with an empty body, and the same endpoint worked again on 2026-09-30.
 * "Treat an empty HTTP 200 body as a failure and retry, never as 'no
 * results'" — so this is a {@link SourceError} that is **retryable**, unlike
 * its parent.
 */
export class BiorxivEmptyBodyError extends SourceError {
  override readonly retryable: boolean = true;
}

/** One validated response body. */
export interface BiorxivBody {
  /** `messages[0].status`, verbatim. */
  readonly status: string;
  /** `false` for a not-found status; the collection is then empty. */
  readonly found: boolean;
  readonly collection: readonly unknown[];
}

/**
 * Parse and classify one `/details/` or `/pubs/` body (`docs/02` §8.3, §8.5).
 *
 * @param body - the response text
 * @param sourceId - the adapter's id, for the thrown error
 * @param transmittedUrl - the URL, for the thrown error's context
 * @throws BiorxivEmptyBodyError for an empty body (retryable)
 * @throws ParseError when the body is not JSON, or has no
 *   `messages[0].status`, or an `ok` body has no `collection` array
 * @throws SourceError for any status that is neither `ok` nor not-found
 */
export function parseBiorxivBody(
  body: string,
  sourceId: BiorxivServer,
  transmittedUrl: string,
): BiorxivBody {
  if (body.trim() === "") {
    throw new BiorxivEmptyBodyError(
      sourceId,
      `[research-helper] api.biorxiv.org answered with an empty body; ` +
        `docs/02 §8.5 records this as a transient outage, not "no results".`,
      { url: transmittedUrl },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ParseError(
      sourceId,
      `[research-helper] api.biorxiv.org returned a body that is not JSON.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }
  const envelope =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : undefined;
  const messages = envelope?.["messages"];
  const first: unknown = Array.isArray(messages) ? messages[0] : undefined;
  const status =
    typeof first === "object" && first !== null
      ? (first as Readonly<Record<string, unknown>>)["status"]
      : undefined;
  if (envelope === undefined || typeof status !== "string") {
    throw new ParseError(
      sourceId,
      `[research-helper] api.biorxiv.org returned JSON with no ` +
        `messages[0].status; docs/02 §8.5 makes that the success check.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }
  if (status === BIORXIV_STATUS_OK) {
    const collection = envelope["collection"];
    if (!Array.isArray(collection)) {
      throw new ParseError(
        sourceId,
        `[research-helper] api.biorxiv.org said "ok" with no collection array.`,
        { url: transmittedUrl, bodyLength: body.length },
      );
    }
    return { status, found: true, collection };
  }
  if (BIORXIV_NOT_FOUND_STATUSES.some((prefix) => status.startsWith(prefix))) {
    return { status, found: false, collection: [] };
  }
  throw new SourceError(
    sourceId,
    `[research-helper] api.biorxiv.org reported an error inside HTTP 200: ` +
      `${status}`,
    { url: transmittedUrl, upstreamError: status },
  );
}

// ---------------------------------------------------------------------------
// 3. The adapter
// ---------------------------------------------------------------------------

/** What {@link createBiorxivSource} needs from the composition root. */
export interface BiorxivSourceDeps {
  /** Which server this instance is — and therefore its `SourceId`. */
  readonly server: BiorxivServer;
  /** `P1-T05`'s client. Pacing (the 1/s row), retry and 429 handling live behind it. */
  readonly http: HttpClient;
  /** `src/core/clock.ts`; only `healthCheck`'s `latencyMs` reads it. */
  readonly clock: Clock;
  /** `./mapper.ts`'s mapper — one for both servers. */
  readonly mapRecords: BiorxivRecordMapper;
  /** Diagnostics. Never given a response body. */
  readonly logger?: Logger;
}

/** The adapter, with the two DOI-scoped calls named. */
export interface BiorxivSource extends LiteratureSource {
  readonly id: BiorxivServer;
  /** `/details/{server}/{DOI}/na/json` for each bioRxiv/medRxiv DOI in `ids`. */
  lookup(
    ids: readonly Partial<ExternalIds>[],
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]>;
  /**
   * The preprint→published cross-walk: `/pubs/{server}/{DOI}/na/json` for
   * each bioRxiv/medRxiv DOI in `ids`. Only DOIs with a published version
   * yield a record; each carries `relatedVersionIds`.
   */
  resolvePublished(
    ids: readonly Partial<ExternalIds>[],
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]>;
}

/** The distinct DOIs in `ids` this host can answer for, in first-seen order. */
function lookupDois(ids: readonly Partial<ExternalIds>[]): string[] {
  const out: string[] = [];
  for (const entry of ids) {
    const doi = biorxivLookupDoi(entry.doi);
    if (doi !== undefined && !out.includes(doi)) out.push(doi);
  }
  return out;
}

/**
 * Build one server's adapter. The composition root calls this once with
 * `server: "biorxiv"` and once with `server: "medrxiv"`.
 *
 * @param deps - the server, the HTTP client, the clock, the mapper and an
 *   optional logger
 * @returns a `docs/07` §4.2 `LiteratureSource` whose `id` is `deps.server`
 */
export function createBiorxivSource(deps: BiorxivSourceDeps): BiorxivSource {
  const { server, http, clock, mapRecords } = deps;
  const notice = biorxivKeywordSearchNotice(server);

  /** One request and the in-200 status check. */
  async function fetchBody(
    request: BiorxivRequest,
    ctx: SourceCallContext,
  ): Promise<BiorxivBody> {
    ctx.token.throwIfCancelled();
    // `responseType: "text"` is not optional: `HttpResponse.body` is `""` for
    // every other value — which this adapter would read as the §8.5 outage.
    const response = await http.request(request.method, request.url, {
      responseType: "text",
      token: ctx.token,
    });
    deps.logger?.debug("biorxiv request", {
      sourceId: server,
      endpoint: request.endpoint,
      url: request.transmittedUrl,
      status: response.status,
    });
    return parseBiorxivBody(response.body, server, request.transmittedUrl);
  }

  /** Every DOI in `ids` through one endpoint, one request each, in order. */
  async function each(
    endpoint: BiorxivEndpoint,
    ids: readonly Partial<ExternalIds>[],
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]> {
    const build =
      endpoint === "details"
        ? buildBiorxivDetailsRequest
        : buildBiorxivPubsRequest;
    const out: SourceRecord[] = [];
    let notFound = 0;
    for (const doi of lookupDois(ids)) {
      const parsed = await fetchBody(build(server, doi), ctx);
      if (!parsed.found) {
        notFound += 1;
        continue;
      }
      out.push(
        ...mapRecords(parsed.collection, { endpoint, requestedServer: server }),
      );
    }
    if (notFound > 0) {
      deps.logger?.debug("biorxiv: DOIs not found", {
        sourceId: server,
        endpoint,
        notFound,
      });
    }
    return out;
  }

  /** Card step 3: no request, an empty page, the routing notice. */
  async function search(
    _query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<SourcePage> {
    ctx.token.throwIfCancelled();
    return {
      records: [],
      totalAvailable: undefined,
      nextCursor: undefined,
      warnings: [notice],
    };
  }

  /** Yields nothing; raises the routing notice once (the pipeline's only page channel). */
  // eslint-disable-next-line require-yield
  async function* searchAll(
    _query: SourceQuery,
    ctx: SourceCallContext,
  ): AsyncGenerator<SourceRecord, void, undefined> {
    ctx.token.throwIfCancelled();
    ctx.progress?.warn(notice);
  }

  /** One `/details/` lookup of a known DOI. Never throws except on cancellation. */
  async function healthCheck(ctx: SourceCallContext): Promise<SourceHealth> {
    const startedAtMs = clock.now();
    try {
      const parsed = await fetchBody(
        buildBiorxivDetailsRequest(server, BIORXIV_HEALTH_PROBE_DOIS[server]),
        ctx,
      );
      return {
        ok: parsed.found,
        messageKey: parsed.found
          ? BIORXIV_DISPLAY_NAME_KEYS[server]
          : BIORXIV_HEALTH_FAILED_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
      };
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      return {
        ok: false,
        messageKey:
          error instanceof ResearchHelperError
            ? error.messageKey
            : BIORXIV_HEALTH_FAILED_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
      };
    }
  }

  return {
    id: server,
    displayNameKey: BIORXIV_DISPLAY_NAME_KEYS[server],
    capabilities: BIORXIV_CAPABILITIES,
    rateLimitKey: BIORXIV_HOST,
    /** `docs/02` §8.1: no key exists, so both servers are always usable. */
    isConfigured: () => true,
    healthCheck,
    search,
    searchAll,
    lookup: (ids, ctx) => each("details", ids, ctx),
    resolvePublished: (ids, ctx) => each("pubs", ids, ctx),
    explainQuery: () => explainBiorxivQuery(server),
  };
}
