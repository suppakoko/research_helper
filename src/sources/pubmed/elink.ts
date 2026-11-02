/**
 * PubMed's related-articles request: `elink` with `cmd=neighbor_score`
 * (`docs/05` §4.2–§4.3, `docs/02` §3.6).
 *
 * **Scope.** `P5-T04` created this file with the request builder only: address,
 * no parser and no adapter method. Callers today:
 * `test/support/pubmedRecordedRequests.ts`, which the recorder and the shape
 * tests read. `P5-T08` adds the parser beside this builder and is the product
 * caller, through `pubmedSource.ts`.
 *
 * **One `id=` parameter per seed, never a comma-joined list** (`docs/05` §4.3):
 * with `cmd=neighbor_score` a comma-joined list merges the results and loses
 * which seed each neighbour belongs to. Separate parameters give one `linkset`
 * per seed.
 *
 * **The identity parameters are the existing builders'** (`docs/02` §2.2,
 * decision D10): `tool` and `email` come from `ncbiIdentityParams()`, and
 * `createHttpClient` refuses this host anything else.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3).
 */

import { redactUrl } from "../../core/errors";
import { ncbiIdentityParams } from "../../core/http/userAgent";

/** `docs/05` §4.2: the endpoint, with no query string. */
export const PUBMED_ELINK_BASE_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi";

/** `docs/05` §4.3: "always use `neighbor_score`". */
export const PUBMED_ELINK_CMD = "neighbor_score";

/** `docs/02` §3.6: pmra "Related Articles". */
export const PUBMED_ELINK_LINKNAME = "pubmed_pubmed";

/** A built `elink` request. */
export interface PubmedElinkRequest {
  readonly method: "GET";
  readonly url: string;
  /** `redactUrl(url)`. */
  readonly transmittedUrl: string;
  /** The endpoint with no query string. */
  readonly endpointBaseUrl: string;
}

/**
 * Build one `elink` request for `pmids`. Parameter order: `dbfrom`, `db`, `cmd`,
 * `linkname`, `retmode`, one `id` per seed in the order given, `tool`, `email`.
 *
 * @param pmids - the seeds, digits only, at least one
 * @returns the request
 * @throws RangeError for an empty list or an id that is not all digits
 */
export function buildElinkNeighborScoreRequest(
  pmids: readonly string[],
): PubmedElinkRequest {
  if (pmids.length === 0) {
    throw new RangeError(
      "[research-helper] elink needs at least one PMID (docs/05 §4.2).",
    );
  }
  for (const pmid of pmids) {
    if (!/^\d+$/u.test(pmid)) {
      throw new RangeError(
        `[research-helper] ${JSON.stringify(pmid)} is not a PMID: elink takes ` +
          `one id per parameter, digits only (docs/05 §4.3).`,
      );
    }
  }
  const identity = ncbiIdentityParams();
  const url =
    `${PUBMED_ELINK_BASE_URL}?` +
    [
      "dbfrom=pubmed",
      "db=pubmed",
      `cmd=${PUBMED_ELINK_CMD}`,
      `linkname=${PUBMED_ELINK_LINKNAME}`,
      "retmode=json",
      ...pmids.map((pmid) => `id=${pmid}`),
      `tool=${encodeURIComponent(identity.tool)}`,
      `email=${encodeURIComponent(identity.email)}`,
    ].join("&");
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: PUBMED_ELINK_BASE_URL,
  };
}
