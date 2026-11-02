/**
 * Europe PMC's `citations` and `references` requests (`docs/02` §4.7).
 *
 * **Scope.** `P5-T04` created this file with the two request builders only:
 * address and body, no parser and no adapter method. Callers today:
 * `test/support/europepmcRecordedRequests.ts`, which the recorder and the shape
 * tests read. `P5-T07` adds the parsers beside these builders and is the product
 * caller, through `europepmcSource.ts`.
 *
 * **Two endpoints, two builders, on purpose:** `docs/02` §4.7 measured them
 * going down independently, so `/references` failing must not disable
 * `/citations`.
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

import { redactUrl } from "../../core/errors";
import { MAINTAINER_EMAIL } from "../../core/http/userAgent";

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
