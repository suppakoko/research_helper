/**
 * The Crossref adapter: one `GET /works` call per page, `cursor` pagination,
 * client-side `NOT` filtering with the lossiness said out loud, and the
 * header-driven rate limiter `docs/07` §7.3 prescribes for this host.
 *
 * **Scope.** `P2-T04`. `docs/07` §4.2's `LiteratureSource`, implemented for
 * `api.crossref.org`. Query *rendering* is `./query.ts`'s
 * {@link buildCrossrefWorksRequest}; JSON → `SourceRecord` is `./mapper.ts` and
 * arrives as {@link CrossrefSourceDeps.mapRecords}.
 *
 * ## What this file decides, and where each decision comes from
 *
 * - **Boolean lossiness is reported, not hidden.** `docs/02` §12.2: Crossref
 *   "is the only source where the user's Boolean intent is not honoured", so
 *   "document this lossiness in the UI". {@link lossinessWarnings} asks
 *   `normalizeForSource` what the rendering loses against
 *   {@link CROSSREF_CAPABILITIES} — OR groups, phrases, fields with no
 *   `query.*` parameter — and writes one notice on `SourcePage.warnings`; the
 *   dropped `NOT` terms get a second notice naming them and saying the records
 *   were filtered client-side. A query Crossref renders faithfully (bare
 *   words, `title:`, `author:`, a date window) carries no warning at all.
 * - **`NOT` is filtered client-side** ({@link applyNotFilter}): a record is
 *   removed when an excluded term occurs, case-insensitively and whole-word, in
 *   the field the user named (`title`, `author`, …) or — for an unfielded
 *   term — in its title, abstract, container title or author names. §12.2:
 *   "drop NOT clauses entirely — then filter the results client-side against
 *   the NOT terms". The filter runs on the mapped page, before paging decides
 *   anything, and `totalAvailable` stays the server's figure.
 * - **`rows` is `SourceQuery.limit` clamped to 1 … 1000** (`docs/02` §5.2).
 *   `maxPageSize: 1000`; `maxTotalResults: undefined`, because the cursor has
 *   no documented depth ceiling (§5.5: "`offset` is capped at 10,000 … use the
 *   cursor"). `offset` is never sent.
 * - **`cursor=*` on the first page**, then `message.next-cursor` (§5.5) —
 *   always with `sort=score&order=desc`, because a cursor without a sort
 *   returns the set in index order (measured; `./query.ts`, `CROSSREF_SORT`).
 *   Termination is §5.5's rule — "Stop when `message.items` is empty" — plus
 *   the two the other adapters share: no cursor in the answer, and a page
 *   shorter than `rows` (the raw item count, before the `NOT` filter), after
 *   which the next page can only be empty. A repeated cursor also stops.
 * - **The limiter is reconfigured from every response's headers**, in both
 *   directions. The HTTP client already calls `adoptAdvertisedLimits` on every
 *   response, but that call only tightens (`src/core/rateLimit/hostLimiter.ts`
 *   records why); §7.3's Crossref row is the one marked **header-driven** —
 *   "start at 2/interval" and `reconfigure()` "from those headers on every
 *   response" — so this adapter calls `adoptHeaderDrivenLimits` with the
 *   limiter the composition root resolved for {@link CROSSREF_HOST}
 *   ({@link CrossrefSourceDeps.limiter}), and the polite pool's `3` / `1s`
 *   raises the bucket from its static 2/s as the document intends. Without a
 *   limiter (a unit test) the step is a no-op.
 * - **Both polite-pool signals on every request** (`docs/02` §5.1): the
 *   `User-Agent` with the maintainer address is the client's; the `mailto`
 *   parameter is the builder's, carrying the user's `contactEmail` when the
 *   composition root resolves one ({@link CrossrefSourceDeps.userContactEmail},
 *   a getter so a pref change needs no restart) and the maintainer's
 *   otherwise. The two are never swapped (D10).
 * - **No key, ever.** Crossref Plus is out of scope (`docs/02` §2.3), so
 *   `benefitsFromApiKey: false`, `isConfigured()` is `true`, and nothing here
 *   takes a `SecretStore`.
 * - **`abstractsInSearch: true`, with partial coverage.** `docs/02` §5.4:
 *   abstracts are deposited by "only some publishers" — about half of one
 *   recent biomedical query, a figure the document marks **Unverified** for
 *   the corpus as a whole. The display name is the one bundle line
 *   `research-helper-source-crossref = Crossref`, so the caveat lives in
 *   {@link CROSSREF_ABSTRACT_COVERAGE_NOTE} and in `missingFields`, where an
 *   absent abstract is routine; `P2-T12` backfills from Europe PMC or Semantic
 *   Scholar by DOI (§5.4's architectural consequence).
 * - **`rateLimitKey` is {@link CROSSREF_HOST}**, imported, so §7.3's
 *   one-bucket-per-host rule is mechanical.
 * - **Related papers mean the deposited references, and only those** (`P5-T09`;
 *   `docs/07` §4.2 as built by that card). `findRelated` reads `/works/{doi}`'s
 *   `reference[]`, through `./references.ts`. Crossref cannot list citing papers:
 *   `is-referenced-by-count` is an integer (`docs/05` §2.1), so `"citations"` and
 *   every other strategy is an empty page with a warning and no request. A seed
 *   with no DOI is the same. Its caller is `src/pipeline/related/generators.ts`
 *   (`P5-T12`).
 * - **`matchTitle` is a method of {@link CrossrefSource} only**, off
 *   `LiteratureSource` (`docs/07` §4.2). It returns one title search's candidates
 *   and applies no threshold; its caller, `resolveSeed` in
 *   `src/pipeline/related/seed.ts` (`P5-T11`), does. The composition root's
 *   `createCrossrefSource` call in `src/bootstrap/container.ts` already builds the
 *   instance; `P5-T14` hands it to the pipeline.
 *
 * ## Errors
 *
 * - A `status` other than `"ok"` inside an HTTP 200 → {@link SourceError}
 *   with the upstream message.
 * - Not JSON, or JSON without `message.items` → {@link ParseError}.
 * - **Transport-level failures propagate unwrapped**, as on the other
 *   adapters: `P1-T05`'s client throws `docs/07` §10.1's classes
 *   (`RateLimitError` with `retryAfterMs` for §5.6's 429, `BadRequestError`
 *   for its 400, `UpstreamServerError` for its 504), and wrapping them would
 *   discard `retryable` and the 429 handling the client owns.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3 / §4.2).
 * Nothing below names the `Zotero` global, touches a preference or reads a
 * file; the user's address arrives through a getter the composition root
 * supplies; cancellation goes through `ctx.token`, diagnostics through the
 * injected {@link Logger}. Every URL that reaches a log or an error is the
 * builder's `transmittedUrl`.
 */

import type { Clock } from "../../core/clock";
import {
  OperationCancelledError,
  ParseError,
  ResearchHelperError,
} from "../../core/errors";
import type {
  HttpClient,
  HttpMethod,
  HttpResponse,
} from "../../core/http/client";
import type { Logger } from "../../core/logger";
import {
  adoptHeaderDrivenLimits,
  CROSSREF_HOST,
  type AdvertisedLimitTarget,
} from "../../core/rateLimit/hostLimiter";
import { normalizeDoi } from "../../model/ids";
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
import { CROSSREF_SOURCE_ID, type CrossrefRecordMapper } from "./mapper";
import {
  buildCrossrefWorksRequest,
  CROSSREF_FILTERS,
  CROSSREF_FIRST_CURSOR,
  CROSSREF_RENDERED_FIELDS,
  CROSSREF_ROWS_MAX,
  CROSSREF_ROWS_MIN,
  explainCrossrefQuery,
  type CrossrefExcludedTerm,
} from "./query";
import {
  buildCrossrefTitleSearchRequest,
  buildCrossrefWorkRequest,
  CROSSREF_TITLE_SEARCH_ROWS_MAX,
  parseCrossrefEnvelope,
  parseCrossrefReferences,
} from "./references";

export { CROSSREF_SOURCE_ID } from "./mapper";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/**
 * `LiteratureSource.displayNameKey`. A literal, for the reason
 * `PUBMED_DISPLAY_NAME_KEY` and `EUROPEPMC_DISPLAY_NAME_KEY` are: `src/sources/**`
 * importing `src/i18n/**` would invent a dependency edge `docs/07` §2.3 does
 * not have. Declared in both `research-helper-mainWindow.ftl` bundles and
 * listed in `src/i18n/keys.ts` (`P2-T04`).
 */
export const CROSSREF_DISPLAY_NAME_KEY = "research-helper-source-crossref";

/** `SourceHealth.messageKey` for a healthy probe. */
export const CROSSREF_HEALTH_OK_MESSAGE_KEY = CROSSREF_DISPLAY_NAME_KEY;

/** `SourceHealth.messageKey` when the probe failed and carried no key of its own. */
export const CROSSREF_HEALTH_FAILED_MESSAGE_KEY = "rh-error-source";

/**
 * The card's step 9 asks that the display string note partial abstract
 * coverage; the display string is a database name the bundles never
 * translate or decorate (`docs/08` §10.3), so the note lives here, beside the
 * capability it qualifies, and in the card report. `docs/02` §5.4's figure is
 * one recent biomedical query's and is **Unverified** for Crossref as a whole.
 */
export const CROSSREF_ABSTRACT_COVERAGE_NOTE =
  "Crossref returns an abstract only when the publisher deposited one " +
  "(about half of recent biomedical journal articles in docs/02 §5.4's one " +
  "measured query); a record without one is backfilled from another source.";

/**
 * Capabilities, as the card's step 9 declares them and as `./query.ts` renders
 * them: `capabilities.query` is `docs/02` §12.3's Crossref column — OR, NOT
 * and Phrase are *n/a*, the two real field cells are `query.title` and
 * `query.author` — taken from the renderer's own table so the two cannot
 * drift (`P2-T28`).
 */
export const CROSSREF_CAPABILITIES: SourceCapabilities = {
  keywordSearch: true,
  query: {
    or: false,
    not: false,
    phrase: false,
    fields: CROSSREF_RENDERED_FIELDS,
  },
  // `findRelated` exists since `P5-T09` (`plan/00` §6 item 184's rule).
  relatedByWork: true,
  lookupById: [],
  abstractsInSearch: true,
  citationGraph: true,
  dateFilter: true,
  // The renderer's own object (`P2-T34`): `./query.ts` refuses from it.
  filters: CROSSREF_FILTERS,
  maxPageSize: CROSSREF_ROWS_MAX,
  maxTotalResults: undefined,
  benefitsFromApiKey: false,
};

// ---------------------------------------------------------------------------
// 2. The response
// ---------------------------------------------------------------------------

/**
 * `docs/07` §5.3 `SourceProvenance.sourceExtras`, keyed by Crossref's own
 * names plus what the response said about the pool it was served from.
 */
export interface CrossrefSourceExtras {
  readonly totalResults: number | undefined;
  readonly itemsPerPage: number | undefined;
  /** `x-api-pool`: `polite-array` or `public-array` (`docs/02` §5.1). */
  readonly apiPool: string | undefined;
  /** `x-rate-limit-limit` / `x-rate-limit-interval`, as sent. */
  readonly rateLimitLimit: string | undefined;
  readonly rateLimitInterval: string | undefined;
  /** How many mapped records the client-side `NOT` filter removed. */
  readonly excludedByNotFilter: number;
}

/** A page of Crossref results: `docs/07` §4.2's page plus the extras. */
export interface CrossrefSearchPage extends SourcePage {
  readonly sourceExtras: CrossrefSourceExtras;
}

/**
 * The adapter, with `search`'s return narrowed to {@link CrossrefSearchPage},
 * `findRelated` always present, and the one adapter-specific call `docs/07` §4.2
 * declares for it.
 */
export interface CrossrefSource extends LiteratureSource {
  search(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<CrossrefSearchPage>;
  findRelated(
    query: RelatedQuery,
    ctx: SourceCallContext,
  ): Promise<RelatedPage>;
  /**
   * One `query.bibliographic` search for a title: the mapped candidates, at most
   * {@link CROSSREF_TITLE_SEARCH_ROWS_MAX}, in Crossref's order, unthresholded.
   *
   * @throws RangeError for a blank title or a DOI, before any request
   */
  matchTitle(
    title: string,
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]>;
}

/** A validated `/works` body. */
export interface CrossrefWorksResult {
  /** `message.items`, unmapped — the mapper's input. */
  readonly items: readonly unknown[];
  /** `message.next-cursor`, or `undefined` when absent. */
  readonly nextCursor: string | undefined;
  readonly totalResults: number | undefined;
  readonly itemsPerPage: number | undefined;
}

/**
 * Validate one `/works` JSON body (`docs/02` §5.3's envelope).
 *
 * @param body - the response text
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @throws SourceError when `status` is not `"ok"` — Crossref's own error
 *   envelope, `{"status":"error","message-type":"validation-failure",…}`
 * @throws ParseError when the body is not JSON, or has no `message.items`
 *   array — a truncated body (`error-malformed`) or a single-work envelope
 */
export function parseCrossrefWorksBody(
  body: string,
  transmittedUrl: string,
): CrossrefWorksResult {
  const envelope = parseCrossrefEnvelope(body, transmittedUrl);
  const message = asRecord(envelope.message);
  const items = message?.items;
  if (!Array.isArray(items)) {
    throw new ParseError(
      CROSSREF_SOURCE_ID,
      `[research-helper] Crossref /works returned JSON with no message.items ` +
        `array; docs/02 §5.3 gives that array as the page.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }

  return {
    items,
    nextCursor:
      typeof message?.["next-cursor"] === "string" &&
      message["next-cursor"].length > 0
        ? message["next-cursor"]
        : undefined,
    totalResults: finite(message?.["total-results"]),
    itemsPerPage: finite(message?.["items-per-page"]),
  };
}

/** `{...}` and not `null`, `[]` or a primitive. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

// ---------------------------------------------------------------------------
// 3. Lossiness — the notices, and the client-side NOT filter
// ---------------------------------------------------------------------------

/**
 * The first sentence of every Crossref lossiness notice — `docs/02` §12.2's
 * "Crossref results are approximate" note, verbatim in spirit.
 */
export const CROSSREF_APPROXIMATE_PREFIX = "Crossref results are approximate";

/**
 * The warnings a query earns before any request is made: what the rendering
 * loses, by kind, as `normalizeForSource` reports it against this adapter's
 * declared dialect; and, separately, the `NOT` terms that were dropped from
 * the wire and filtered client-side.
 *
 * @param terms - the query tree
 * @param excluded - the `NOT` terms the renderer returned
 * @returns zero, one or two strings for `SourcePage.warnings`
 */
export function lossinessWarnings(
  terms: QueryNode,
  excluded: readonly CrossrefExcludedTerm[],
): readonly string[] {
  const lost = normalizeForSource(terms, CROSSREF_CAPABILITIES);
  const kinds: string[] = [];
  const ors = lost.filter((n) => n.kind === "or").length;
  const phrases = lost.filter(
    (n) => n.kind === "term" && n.phrase === true,
  ).length;
  const fields = new Set<QueryField>();
  for (const node of lost) {
    if (
      node.kind === "term" &&
      node.field !== undefined &&
      !CROSSREF_RENDERED_FIELDS.includes(node.field)
    ) {
      fields.add(node.field);
    }
  }
  if (ors > 0) {
    kinds.push(
      `${String(ors)} OR group${ors === 1 ? " was" : "s were"} flattened into ` +
        `the bag of words`,
    );
  }
  if (phrases > 0) {
    kinds.push(
      `${String(phrases)} quoted phrase${phrases === 1 ? " was" : "s were"} ` +
        `searched as separate words`,
    );
  }
  if (fields.size > 0) {
    kinds.push(
      `the field restriction${fields.size === 1 ? "" : "s"} ` +
        `${[...fields].map((f) => `${f}:`).join(", ")} ` +
        `${fields.size === 1 ? "has" : "have"} no Crossref parameter and ` +
        `${fields.size === 1 ? "was" : "were"} searched across all fields`,
    );
  }

  const warnings: string[] = [];
  if (kinds.length > 0) {
    warnings.push(
      `${CROSSREF_APPROXIMATE_PREFIX}: Crossref scores terms rather than ` +
        `filtering on them, so ${kinds.join("; ")}.`,
    );
  }
  if (excluded.length > 0) {
    const named = excluded
      .map((t) => (t.field === undefined ? t.value : `${t.field}:${t.value}`))
      .map((t) => JSON.stringify(t))
      .join(", ");
    warnings.push(
      `${CROSSREF_APPROXIMATE_PREFIX}: Crossref has no NOT operator, so ` +
        `${String(excluded.length)} excluded term${excluded.length === 1 ? "" : "s"} ` +
        `(${named}) ${excluded.length === 1 ? "was" : "were"} removed from the ` +
        `query and matching records were filtered out client-side after ` +
        `retrieval.`,
    );
  }
  return warnings;
}

/** Escape a term for use inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Does `haystack` contain `term` as whole words, case-insensitively? A
 * multi-word term matches as a phrase with any run of whitespace between the
 * words. Word boundaries are "not a letter or digit", so `mouse` does not
 * match `mouseover` but does match `(mouse)`.
 */
export function containsTerm(haystack: string, term: string): boolean {
  const words = term.split(/\s+/u).filter((w) => w.length > 0);
  if (words.length === 0) return false;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${words.map(escapeRegExp).join("\\s+")}(?![\\p{L}\\p{N}])`,
    "iu",
  );
  return pattern.test(haystack);
}

/** The text an excluded term is matched against, per field. */
function fieldText(
  record: SourceRecord,
  field: QueryField | undefined,
): string {
  const { work } = record;
  const authors = work.authors
    .map((a) => [a.given, a.family, a.literal].filter(Boolean).join(" "))
    .join("\n");
  switch (field) {
    case "title":
      return work.title;
    case "abstract":
      return work.abstract ?? "";
    case "titleOrAbstract":
      return `${work.title}\n${work.abstract ?? ""}`;
    case "author":
      return authors;
    case "journal":
      return `${work.containerTitle ?? ""}\n${work.containerAbbreviation ?? ""}`;
    case "affiliation":
      return work.authors.flatMap((a) => a.affiliations ?? []).join("\n");
    case "meshTerm":
      return (work.subjects ?? []).map((s) => s.term).join("\n");
    case "any":
    case undefined:
      return [
        work.title,
        work.abstract ?? "",
        work.containerTitle ?? "",
        authors,
        (work.subjects ?? []).map((s) => s.term).join("\n"),
      ].join("\n");
  }
}

/**
 * `docs/02` §12.2's client-side half of `NOT`: drop every record in which an
 * excluded term occurs in the field it names.
 *
 * @param records - one mapped page
 * @param excluded - the renderer's dropped `NOT` terms
 * @returns the kept records, in order, and how many were removed
 */
export function applyNotFilter(
  records: readonly SourceRecord[],
  excluded: readonly CrossrefExcludedTerm[],
): { readonly kept: readonly SourceRecord[]; readonly removed: number } {
  if (excluded.length === 0) return { kept: records, removed: 0 };
  const kept = records.filter(
    (record) =>
      !excluded.some((term) =>
        containsTerm(fieldText(record, term.field), term.value),
      ),
  );
  return { kept, removed: records.length - kept.length };
}

// ---------------------------------------------------------------------------
// 4. Paging
// ---------------------------------------------------------------------------

/**
 * Decide whether another page exists. `docs/02` §5.5's rule — an empty
 * `items` ends the loop — plus no cursor, a repeated cursor, and a short page
 * (raw item count below `rows`, after which the next page can only be empty).
 */
export function nextCursorAfter(
  sentCursor: string,
  nextCursor: string | undefined,
  pageLength: number,
  rows: number,
): string | undefined {
  if (nextCursor === undefined) return undefined;
  if (nextCursor === sentCursor) return undefined;
  if (pageLength === 0) return undefined;
  if (pageLength < rows) return undefined;
  return nextCursor;
}

/** `SourceQuery.limit` → `rows`, clamped to `docs/02` §5.2's 1 … 1000. */
export function clampRows(limit: number): number {
  if (!Number.isFinite(limit)) return CROSSREF_ROWS_MIN;
  return Math.min(
    CROSSREF_ROWS_MAX,
    Math.max(CROSSREF_ROWS_MIN, Math.trunc(limit)),
  );
}

// ---------------------------------------------------------------------------
// 5. Related papers — what `findRelated` says when it has nothing to return
// ---------------------------------------------------------------------------

/** The strategies a deposited reference list can answer. */
const REFERENCE_STRATEGIES: ReadonlySet<RelatedQuery["strategy"]> = new Set([
  undefined,
  "references",
  "auto",
]);

function unsupportedStrategyWarning(strategy: string | undefined): string {
  return (
    `Crossref can list only the references a publisher deposited, not ` +
    `${String(strategy)}, so nothing was requested from it.`
  );
}

const NO_DOI_SEED_WARNING =
  "Crossref finds a paper's references by its DOI and this seed has none, so " +
  "nothing was requested from it.";

function noReferencesWarning(doi: string): string {
  return (
    `Crossref holds no reference list for ${doi}. Publishers deposit these by ` +
    `choice, so this does not mean the paper cites nothing.`
  );
}

function referencesWithoutDoiWarning(
  withoutDoi: number,
  deposited: number,
): string {
  return (
    `Crossref: ${String(withoutDoi)} of ${String(deposited)} deposited ` +
    `references have no DOI and were left out.`
  );
}

const FROM_DATE_NOT_APPLIED_WARNING =
  "Crossref's reference list carries no publication dates, so the date limit " +
  "was not applied to it.";

/** A page with nothing on it: one document, so no total and no next page. */
function emptyRelatedPage(warnings: readonly string[]): RelatedPage {
  return {
    records: [],
    edges: [],
    totalAvailable: undefined,
    nextCursor: undefined,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 6. The adapter
// ---------------------------------------------------------------------------

/** What {@link createCrossrefSource} needs from the composition root. */
export interface CrossrefSourceDeps {
  /** `P1-T05`'s client. Pacing, retry and 429 handling all live behind it. */
  readonly http: HttpClient;
  /** `src/core/clock.ts`; only `healthCheck`'s `latencyMs` reads it. */
  readonly clock: Clock;
  /** `./mapper.ts`'s mapper. Required: without it a page has no records. */
  readonly mapRecords: CrossrefRecordMapper;
  /**
   * The `contactEmail` preference, read on every request so a change needs no
   * restart. `sources/` may not read a preference (`docs/07` §2.3); the
   * composition root passes `() => getPref("contactEmail")`. Absent or blank
   * means the maintainer address fills `mailto` (D10).
   */
  readonly userContactEmail?: () => string | undefined;
  /**
   * The host's limiter — `limiters.limiterFor(CROSSREF_HOST)` — so the
   * adapter can adopt the limits every response advertises, in both
   * directions (`docs/07` §7.3's header-driven row). Absent means no
   * reconfiguration from here; the client's tighten-only call still runs.
   */
  readonly limiter?: AdvertisedLimitTarget;
  /** Diagnostics. Never given a response body. */
  readonly logger?: Logger;
}

/**
 * The probe query `healthCheck` sends: a fixed word, `rows=1`, `select=DOI`,
 * so one request and almost no body. A health check never sends user content
 * (`docs/09` §4).
 */
const HEALTH_PROBE_QUERY: SourceQuery = {
  terms: { kind: "term", value: "crossref" },
  limit: 1,
};

/**
 * Build the Crossref adapter.
 *
 * @param deps - the HTTP client, the clock, the mapper and the optional
 *   contact getter, limiter and logger
 * @returns a `docs/07` §4.2 `LiteratureSource` for Crossref
 */
export function createCrossrefSource(deps: CrossrefSourceDeps): CrossrefSource {
  const { http, clock, mapRecords } = deps;

  /** One request, with the header-driven reconfiguration. */
  async function send(
    request: {
      readonly method: HttpMethod;
      readonly url: string;
      readonly transmittedUrl: string;
    },
    ctx: SourceCallContext,
  ): Promise<HttpResponse> {
    ctx.token.throwIfCancelled();
    // `responseType: "text"` is not optional: `HttpResponse.body` is `""` for
    // every other value.
    const response = await http.request(request.method, request.url, {
      responseType: "text",
      token: ctx.token,
    });
    // `docs/07` §7.3: "`reconfigure()` is called from those headers on every
    // response". The client tightened already if it had to; this lands the
    // advertised figure exactly, upwards included.
    if (deps.limiter !== undefined) {
      const adopted = adoptHeaderDrivenLimits(deps.limiter, (name) =>
        response.header(name),
      );
      if (adopted !== undefined) {
        deps.logger?.info("crossref: rate limit adopted from headers", {
          sourceId: CROSSREF_SOURCE_ID,
          host: CROSSREF_HOST,
          ratePerSecond: adopted.ratePerSecond,
          maxConcurrent: adopted.maxConcurrent,
          apiPool: response.header("x-api-pool"),
        });
      }
    }
    deps.logger?.debug("crossref works", {
      sourceId: CROSSREF_SOURCE_ID,
      url: request.transmittedUrl,
      status: response.status,
      apiPool: response.header("x-api-pool"),
    });
    return response;
  }

  /** {@link send}, and the `/works` envelope check. */
  async function fetchPage(
    request: Parameters<typeof send>[0],
    ctx: SourceCallContext,
  ): Promise<{ result: CrossrefWorksResult; response: HttpResponse }> {
    const response = await send(request, ctx);
    return {
      result: parseCrossrefWorksBody(response.body, request.transmittedUrl),
      response,
    };
  }

  /**
   * The seed's deposited references, cut to `query.limit`. `totalAvailable` is
   * how many the list could give at any limit; one document, so no next page.
   * A transport failure propagates, as on `search`; `P5-T10`'s negative cache
   * reads a 404 from it.
   */
  async function findRelated(
    query: RelatedQuery,
    ctx: SourceCallContext,
  ): Promise<RelatedPage> {
    if (!REFERENCE_STRATEGIES.has(query.strategy)) {
      return emptyRelatedPage([unsupportedStrategyWarning(query.strategy)]);
    }
    const doi = normalizeDoi(query.ids?.doi ?? query.work?.ids.doi);
    if (doi === null) return emptyRelatedPage([NO_DOI_SEED_WARNING]);

    const request = buildCrossrefWorkRequest(doi, deps.userContactEmail?.());
    const response = await send(request, ctx);
    const list = parseCrossrefReferences(
      response.body,
      request.transmittedUrl,
      clock.now(),
    );

    const warnings: string[] = [];
    if (list.deposited === 0) warnings.push(noReferencesWarning(doi));
    if (list.withoutDoi > 0) {
      warnings.push(
        referencesWithoutDoiWarning(list.withoutDoi, list.deposited),
      );
    }
    if (query.fromDate !== undefined) {
      warnings.push(FROM_DATE_NOT_APPLIED_WARNING);
    }
    const limit = Number.isFinite(query.limit)
      ? Math.max(0, Math.trunc(query.limit))
      : 0;
    return {
      records: list.records.slice(0, limit),
      edges: list.edges.slice(0, limit),
      totalAvailable: list.records.length,
      nextCursor: undefined,
      warnings,
    };
  }

  /** {@link CrossrefSource.matchTitle}. */
  async function matchTitle(
    title: string,
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]> {
    const request = buildCrossrefTitleSearchRequest({
      title,
      rows: CROSSREF_TITLE_SEARCH_ROWS_MAX,
      userContactEmail: deps.userContactEmail?.(),
    });
    const { result } = await fetchPage(request, ctx);
    return mapRecords(result.items);
  }

  /** One page. */
  async function search(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): Promise<CrossrefSearchPage> {
    const rows = clampRows(query.limit);
    const cursor = query.cursor ?? CROSSREF_FIRST_CURSOR;
    const request = buildCrossrefWorksRequest({
      query,
      rows,
      cursor,
      ...(deps.userContactEmail !== undefined && {
        userContactEmail: deps.userContactEmail(),
      }),
    });
    const { result, response } = await fetchPage(request, ctx);
    const mapped = mapRecords(result.items);
    const { kept, removed } = applyNotFilter(mapped, request.excluded);
    return {
      records: kept,
      totalAvailable: result.totalResults,
      nextCursor: nextCursorAfter(
        cursor,
        result.nextCursor,
        result.items.length,
        rows,
      ),
      warnings: lossinessWarnings(query.terms, request.excluded),
      sourceExtras: {
        totalResults: result.totalResults,
        itemsPerPage: result.itemsPerPage,
        apiPool: response.header("x-api-pool"),
        rateLimitLimit: response.header("x-rate-limit-limit"),
        rateLimitInterval: response.header("x-rate-limit-interval"),
        excludedByNotFilter: removed,
      },
    };
  }

  /**
   * Page until `limit` or exhaustion. Each page asks for what is still wanted,
   * capped at `docs/02` §5.2's 1000. `ctx.token.throwIfCancelled()` runs at
   * the top of every page (`docs/07` §7.4 check point 1). The lossiness
   * notices are raised once, on the first page, through `ctx.progress`.
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
          limit: Math.min(limit - emitted, CROSSREF_ROWS_MAX),
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

  /** One cheap `rows=1`, `select=DOI` probe. Never throws except on cancellation. */
  async function healthCheck(ctx: SourceCallContext): Promise<SourceHealth> {
    const startedAtMs = clock.now();
    try {
      const request = buildCrossrefWorksRequest({
        query: HEALTH_PROBE_QUERY,
        rows: 1,
        select: ["DOI"],
        ...(deps.userContactEmail !== undefined && {
          userContactEmail: deps.userContactEmail(),
        }),
      });
      const { response } = await fetchPage(request, ctx);
      return {
        ok: true,
        messageKey: CROSSREF_HEALTH_OK_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
        ...(response.header("x-api-pool") !== undefined && {
          quotaHint: `x-api-pool: ${String(response.header("x-api-pool"))}`,
        }),
      };
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      return {
        ok: false,
        messageKey:
          error instanceof ResearchHelperError
            ? error.messageKey
            : CROSSREF_HEALTH_FAILED_MESSAGE_KEY,
        latencyMs: clock.now() - startedAtMs,
      };
    }
  }

  return {
    id: CROSSREF_SOURCE_ID,
    displayNameKey: CROSSREF_DISPLAY_NAME_KEY,
    capabilities: CROSSREF_CAPABILITIES,
    rateLimitKey: CROSSREF_HOST,
    /** `docs/02` §5.1: no key is required, so Crossref is always usable. */
    isConfigured: () => true,
    healthCheck,
    search,
    searchAll,
    findRelated,
    matchTitle,
    explainQuery: (query) => explainCrossrefQuery(query),
  };
}
