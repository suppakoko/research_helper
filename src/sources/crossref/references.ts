/**
 * Crossref's requests for related-paper work: one work by DOI, for its deposited
 * `reference[]`, and a title search (`docs/05` §2.1, `docs/02` §5.2).
 *
 * **Scope.** `P5-T04` created this file with the two request builders only:
 * address, no parser and no adapter method. Callers today:
 * `test/support/crossrefRecordedRequests.ts`, which the recorder and the shape
 * tests read. `P5-T09` adds the parsers beside these builders and is the product
 * caller, through `crossrefSource.ts`.
 *
 * **Why neither is `./query.ts`'s `buildCrossrefWorksRequest`.** That builder
 * always sends `sort`, `order` and `cursor`, for a paged keyword search. `P2-T04`
 * measured the same title search without a cursor already returning the paper
 * first (2026-10-15, `CROSSREF_SORT` in `./query.ts`), and a title search here
 * takes one page of at most {@link CROSSREF_TITLE_SEARCH_ROWS_MAX}.
 *
 * **`query.bibliographic` is not a resolver** (`docs/02` §5.2, measured
 * 2026-10-15): a bare DOI there returned three unrelated records, so
 * {@link buildCrossrefTitleSearchRequest} refuses one.
 *
 * **Identification.** `mailto` is the user's `contactEmail` when set and the
 * maintainer's otherwise, as on every Crossref request (`crossrefContactParams`,
 * decision D10). It stays the last parameter, as in `./query.ts`.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3).
 */

import { redactUrl } from "../../core/errors";
import { crossrefContactParams } from "../../core/http/userAgent";

import { CROSSREF_SELECT_FIELDS, CROSSREF_WORKS_URL } from "./query";

/** `P5-T09` step 2: a title search wants a few candidates, not a page. */
export const CROSSREF_TITLE_SEARCH_ROWS_MAX = 5;

/** A DOI as `docs/02` §5 uses it: the `10.` prefix, a registrant, a slash, a suffix. */
const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/u;

/** A built request: what to send, and what a sidecar may store about it. */
export interface CrossrefRelatedRequest {
  readonly method: "GET";
  readonly url: string;
  /** `redactUrl(url)`. */
  readonly transmittedUrl: string;
  /** The endpoint with its DOI as a placeholder and no query string. */
  readonly endpointBaseUrl: string;
}

/**
 * `GET /works/{doi}` (`docs/02` §5.1's single-DOI route). No `select`: this is
 * the one record, and `reference[]` is what it is fetched for. The DOI is
 * percent-encoded whole, its slash included.
 *
 * @param doi - the DOI, without a resolver prefix
 * @param userContactEmail - the `contactEmail` preference's value, if any
 * @returns the request
 * @throws RangeError for anything that is not DOI-shaped
 */
export function buildCrossrefWorkRequest(
  doi: string,
  userContactEmail?: string,
): CrossrefRelatedRequest {
  if (!DOI_SHAPE.test(doi)) {
    throw new RangeError(
      `[research-helper] ${JSON.stringify(doi)} is not a DOI (docs/02 §5.2).`,
    );
  }
  const { mailto } = crossrefContactParams(userContactEmail);
  const url =
    `${CROSSREF_WORKS_URL}/${encodeURIComponent(doi)}?` +
    `mailto=${encodeURIComponent(mailto)}`;
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: `${CROSSREF_WORKS_URL}/{doi}`,
  };
}

/** What {@link buildCrossrefTitleSearchRequest} takes. */
export interface CrossrefTitleSearchOptions {
  readonly title: string;
  /** 1 … {@link CROSSREF_TITLE_SEARCH_ROWS_MAX}. */
  readonly rows: number;
  /** The `contactEmail` preference's value, if any. */
  readonly userContactEmail?: string;
}

/**
 * `GET /works?query.bibliographic=…`. Parameter order: `query.bibliographic`,
 * `select`, `rows`, `mailto`, which is `./query.ts`'s order without the paging.
 *
 * @param options - the title and the number of candidates
 * @returns the request
 * @throws RangeError for a blank title, a DOI given as the title, or `rows`
 *   out of range
 */
export function buildCrossrefTitleSearchRequest(
  options: CrossrefTitleSearchOptions,
): CrossrefRelatedRequest {
  const title = options.title.trim();
  if (title === "") {
    throw new RangeError(
      "[research-helper] a Crossref title search needs a title.",
    );
  }
  if (DOI_SHAPE.test(title)) {
    throw new RangeError(
      "[research-helper] query.bibliographic is not a DOI resolver (docs/02 " +
        "§5.2); look a DOI up with buildCrossrefWorkRequest.",
    );
  }
  const { rows } = options;
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > CROSSREF_TITLE_SEARCH_ROWS_MAX
  ) {
    throw new RangeError(
      `[research-helper] a Crossref title search takes rows 1 … ` +
        `${String(CROSSREF_TITLE_SEARCH_ROWS_MAX)}; got ${String(rows)}.`,
    );
  }
  const { mailto } = crossrefContactParams(options.userContactEmail);
  const url =
    `${CROSSREF_WORKS_URL}?` +
    [
      `query.bibliographic=${encodeURIComponent(title)}`,
      `select=${encodeURIComponent(CROSSREF_SELECT_FIELDS.join(","))}`,
      `rows=${String(rows)}`,
      `mailto=${encodeURIComponent(mailto)}`,
    ].join("&");
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: CROSSREF_WORKS_URL,
  };
}
