/**
 * Europe PMC's `citations` and `references` requests and answers (`docs/02` §4.7).
 *
 * **Scope.** `P5-T04` created this file with the two request builders.
 * `P5-T07` added everything under "Answers" and the seed resolver. Callers:
 * `findRelated` in `./europepmcSource.ts` is the product caller of all of it;
 * `test/support/europepmcRecordedRequests.ts` also calls the builders, for the
 * recorder and the shape tests.
 *
 * **Two endpoints, two builders, on purpose:** `docs/02` §4.7 measured them
 * going down independently, so `/references` failing must not disable
 * `/citations`.
 *
 * **The rows are not `core` results.** `docs/02` §4.7's dated note lists what
 * they lack, and {@link relationRowToCoreResult} is the one place that knows.
 * `request.offSet` is never read: it differs between the routes for the same
 * `page` (measured 2026-11-02).
 *
 * **Identification.** Every request carries `email=` with the maintainer
 * address, as `./query.ts`'s search requests do (`docs/02` §2.2's final
 * assignment table).
 *
 * **Page size.** `docs/02` §4.7 records `pageSize=2` working and states no bound
 * for these routes, so {@link EUROPEPMC_PAGE_SIZE_MAX} (§4.1's, for `search`) is
 * a local sanity bound here, not a measured limit of these endpoints.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3).
 */

import { ParseError, redactUrl, SourceError } from "../../core/errors";
import { MAINTAINER_EMAIL } from "../../core/http/userAgent";
import {
  normalizePmcid,
  normalizePmid,
  type ExternalIds,
} from "../../model/ids";

import { EUROPEPMC_SOURCE_ID } from "./mapper";
import {
  EUROPEPMC_PAGE_SIZE_MAX,
  EUROPEPMC_PAGE_SIZE_MIN,
  EUROPEPMC_REST_BASE_URL,
} from "./query";

/**
 * The two sources `docs/02` §4.7 measured these endpoints on. `P5-T07` step 1
 * resolves a seed to one of them; a preprint's `PPR` id is not among them.
 */
export type EuropePmcRelationSource = "MED" | "PMC";

/** What both builders take. */
export interface EuropePmcRelationOptions {
  readonly source: EuropePmcRelationSource;
  /** Digits for `MED`; `PMC` and digits for `PMC`. */
  readonly id: string;
  /** The 1-based page. Defaults to `1`. */
  readonly page?: number;
  readonly pageSize: number;
}

/** A built request: what to send, and what a sidecar may store about it. */
export interface EuropePmcRelationRequest {
  readonly method: "GET";
  readonly url: string;
  /** `redactUrl(url)`. */
  readonly transmittedUrl: string;
  /** The endpoint with its seed as a placeholder and no query string. */
  readonly endpointBaseUrl: string;
}

const ID_SHAPE: Readonly<Record<EuropePmcRelationSource, RegExp>> = {
  MED: /^\d+$/u,
  PMC: /^PMC\d+$/u,
};

/** One relation request. Parameter order: `page`, `pageSize`, `format`, `email`. */
function buildRelationRequest(
  relation: "citations" | "references",
  options: EuropePmcRelationOptions,
): EuropePmcRelationRequest {
  const { source, id, page = 1, pageSize } = options;
  if (!ID_SHAPE[source].test(id)) {
    throw new RangeError(
      `[research-helper] ${JSON.stringify(id)} is not a Europe PMC ${source} id ` +
        `(docs/02 §4.7).`,
    );
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(
      `[research-helper] Europe PMC /${relation} pages start at 1; got ` +
        `${String(page)}.`,
    );
  }
  if (
    !Number.isInteger(pageSize) ||
    pageSize < EUROPEPMC_PAGE_SIZE_MIN ||
    pageSize > EUROPEPMC_PAGE_SIZE_MAX
  ) {
    throw new RangeError(
      `[research-helper] Europe PMC /${relation} pageSize must be ` +
        `${String(EUROPEPMC_PAGE_SIZE_MIN)} … ${String(EUROPEPMC_PAGE_SIZE_MAX)}; ` +
        `got ${String(pageSize)}.`,
    );
  }
  const url =
    `${EUROPEPMC_REST_BASE_URL}/${source}/${id}/${relation}?` +
    [
      `page=${String(page)}`,
      `pageSize=${String(pageSize)}`,
      "format=json",
      `email=${encodeURIComponent(MAINTAINER_EMAIL)}`,
    ].join("&");
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: `${EUROPEPMC_REST_BASE_URL}/{source}/{id}/${relation}`,
  };
}

/**
 * `GET /{source}/{id}/citations` (`docs/02` §4.7).
 *
 * @param options - the seed and the page
 * @returns the request
 * @throws RangeError for an id of the wrong shape, or a page out of range
 */
export function buildEuropePmcCitationsRequest(
  options: EuropePmcRelationOptions,
): EuropePmcRelationRequest {
  return buildRelationRequest("citations", options);
}

/**
 * `GET /{source}/{id}/references` (`docs/02` §4.7).
 *
 * @param options - the seed and the page
 * @returns the request
 * @throws RangeError for an id of the wrong shape, or a page out of range
 */
export function buildEuropePmcReferencesRequest(
  options: EuropePmcRelationOptions,
): EuropePmcRelationRequest {
  return buildRelationRequest("references", options);
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

/** A seed these routes accept. */
export interface EuropePmcRelationSeed {
  readonly source: EuropePmcRelationSource;
  readonly id: string;
}

/**
 * The route a seed's identifiers name: PMID first, then PMCID. A malformed id
 * counts as absent. A DOI names no route: `findRelated` resolves it with
 * `lookup` and passes the record's identifiers back through here.
 *
 * @param ids - the seed's identifiers
 * @returns the seed, or `undefined` when neither identifier is usable
 */
export function resolveEuropePmcSeed(
  ids: Partial<ExternalIds>,
): EuropePmcRelationSeed | undefined {
  const pmid = normalizePmid(ids.pmid);
  if (pmid !== null) return { source: "MED", id: pmid };
  const pmcid = normalizePmcid(ids.pmcid);
  if (pmcid !== null) return { source: "PMC", id: pmcid };
  return undefined;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** The two relation routes. */
export type EuropePmcRelation = "citations" | "references";

/** Where each route's answer keeps its rows (`docs/02` §4.7). */
const ROW_PATH: Readonly<
  Record<EuropePmcRelation, { readonly list: string; readonly row: string }>
> = {
  citations: { list: "citationList", row: "citation" },
  references: { list: "referenceList", row: "reference" },
};

/** A validated answer. */
export interface EuropePmcRelationPage {
  /** The rows, unmapped: {@link relationRowToCoreResult}'s input. */
  readonly rows: readonly unknown[];
  /** The list's whole length, as the service reports it. */
  readonly hitCount: number | undefined;
}

/** `{...}` and not `null`, `[]` or a primitive. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Validate one answer of either route.
 *
 * `errCode` is checked first, as `parseEuropePmcSearchBody` checks it
 * (`docs/02` §4.9). An absent list is an empty page only when `hitCount` says 0;
 * that body was never recorded, so anything else stays a parse failure rather
 * than a seed that looks uncited.
 *
 * @param relation - the route that answered
 * @param body - the response text
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @returns the rows and `hitCount`
 * @throws SourceError when the body carries `errCode`
 * @throws ParseError when the body is not JSON, or holds no list
 */
export function parseEuropePmcRelationBody(
  relation: EuropePmcRelation,
  body: string,
  transmittedUrl: string,
): EuropePmcRelationPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (cause) {
    throw new ParseError(
      EUROPEPMC_SOURCE_ID,
      `[research-helper] Europe PMC /${relation} returned a body that is not ` +
        `JSON (docs/02 §4.7: not every Europe PMC response is a JSON envelope).`,
      { url: transmittedUrl, bodyLength: body.length },
      { cause },
    );
  }
  const envelope = asRecord(parsed);
  if (envelope === undefined) {
    throw new ParseError(
      EUROPEPMC_SOURCE_ID,
      `[research-helper] Europe PMC /${relation} returned JSON that is not an object.`,
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
      `[research-helper] Europe PMC /${relation} failed inside an HTTP 200: ` +
        `errCode ${String(envelope.errCode)}: ${errMsg}`,
      {
        url: transmittedUrl,
        errCode: envelope.errCode,
        upstreamError: errMsg,
      },
    );
  }

  const hitCount =
    typeof envelope.hitCount === "number" && Number.isFinite(envelope.hitCount)
      ? envelope.hitCount
      : undefined;
  const path = ROW_PATH[relation];
  const list = envelope[path.list];
  if (list === undefined && hitCount === 0) return { rows: [], hitCount };
  const rows = asRecord(list)?.[path.row];
  if (!Array.isArray(rows)) {
    throw new ParseError(
      EUROPEPMC_SOURCE_ID,
      `[research-helper] Europe PMC /${relation} returned JSON with no ` +
        `${path.list}.${path.row} array; docs/02 §4.7 gives that array as the page.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }
  return { rows, hitCount };
}

/** `"Ahi EP"`: a family name, then at most four capitals, or `"Chen j"`. */
const FAMILY_AND_INITIALS = /^(.+?)\s+(\p{Lu}{1,4}|\p{Ll})$/u;

/**
 * Split an `authorString` into the members `./mapper.ts` reads from
 * `authorList.author[]`. An entry with no trailing initials is a group or a
 * single name, and goes in `collectiveName`, as the mapper expects.
 *
 * A test holds this against every Europe PMC fixture that gives both spellings.
 *
 * @param authorString - `"Ahi EP, Karagic N, Papakostas S."`
 * @returns one object per author, in order
 */
export function splitEuropePmcAuthorString(
  authorString: string,
): readonly Record<string, string>[] {
  return authorString
    .trim()
    .replace(/\.$/u, "")
    .split(/,\s*/u)
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const match = FAMILY_AND_INITIALS.exec(entry);
      return match === null
        ? { collectiveName: entry }
        : { lastName: match[1] ?? "", firstName: match[2] ?? "" };
    });
}

/**
 * One relation row, reshaped to the `core` result `./mapper.ts` reads, so one
 * mapper serves both. `docs/02` §4.7's dated note has the row's members.
 *
 * `pubYear` becomes a string because the mapper reads `core`'s string, and a
 * number would lose the year. A row's `id` is a PMID on `MED` and a PMCID on
 * `PMC`; a `PPR` row keeps its id in `SourceRecord.nativeId` only, as `docs/07`
 * §5.1 has it, and so has no `ExternalIds` member at all.
 *
 * @param row - one entry of {@link EuropePmcRelationPage.rows}
 * @returns the object to hand the mapper, which drops a row with no `id` or
 *   `source`
 */
export function relationRowToCoreResult(row: unknown): unknown {
  const fields = asRecord(row);
  if (fields === undefined) return row;
  const { source, id, pubYear, authorString, journalAbbreviation } = fields;
  return {
    ...fields,
    ...(source === "MED" && { pmid: id }),
    ...(source === "PMC" && { pmcid: id }),
    ...(typeof pubYear === "number" && { pubYear: String(pubYear) }),
    ...(typeof authorString === "string" && {
      authorList: { author: splitEuropePmcAuthorString(authorString) },
    }),
    journalInfo: {
      volume: fields.volume,
      issue: fields.issue,
      journal: {
        medlineAbbreviation: journalAbbreviation,
        issn: fields.issn,
        essn: fields.essn,
      },
    },
  };
}
