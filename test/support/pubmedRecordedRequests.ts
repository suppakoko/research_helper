/**
 * The queries the committed PubMed fixtures were recorded under, spelled so an
 * integration spec inside Zotero can issue the same requests.
 *
 * **Why a second copy exists (`P2-T25`).** `scripts/record-fixtures.ts` owns
 * these — `QUERY_TYPICAL` and `PAGE_SIZE` are exported from it, the two
 * synthetic queries are private to it — but that file imports `node:fs`,
 * `node:path`, `node:timers` and `node:url`, so nothing the scaffold bundles
 * for the sandbox can import it. These constants are therefore repeated here,
 * once, with no platform import, and the drift guard is mechanical rather than
 * a reminder: `test/contract/replayHarness.test.ts` asserts that every request
 * built from this file hashes to a fixture **already on disk**, so a copy that
 * stopped matching the recorder would fail in Node before any Zotero run.
 *
 * Only what the `P2-T25` block needs is here. A Phase 2 adapter card that
 * records its own source adds its own file beside this one — a parameter, not
 * a copy of the harness.
 */

import { buildEsearchRequest } from "../../src/sources/pubmed/query";
import type { SourceQuery } from "../../src/sources/types";

/**
 * `scripts/record-fixtures.ts`'s `QUERY_TYPICAL`: two bare terms under an
 * `and`, a closed historical quarter. `search-typical`, `search-single`,
 * `search-error-retstart`, `paginated-page-1` and `paginated-page-2` were all
 * recorded under it, at different `retmax` / `retstart` values.
 */
export const PUBMED_TYPICAL_QUERY: SourceQuery = {
  terms: {
    kind: "and",
    children: [
      { kind: "term", value: "CRISPR" },
      { kind: "term", value: "editing" },
    ],
  },
  fromDate: "2023-01-01",
  toDate: "2023-03-31",
  limit: 20,
};

/** `scripts/record-fixtures.ts`'s `PAGE_SIZE`: three per page, two pages. */
export const PUBMED_PAGE_SIZE = 3;

/** The query the hand-written `error-429` fixture is keyed under. */
export const PUBMED_SYNTHETIC_429_QUERY: SourceQuery = {
  terms: { kind: "term", value: "synthetic rate limit fixture" },
  limit: 20,
};

/** The query the hand-written `error-500` fixture is keyed under. */
export const PUBMED_SYNTHETIC_500_QUERY: SourceQuery = {
  terms: { kind: "term", value: "synthetic server error fixture" },
  limit: 20,
};

/**
 * One `esearch` request as the recorder planned it: the shipped builder, JSON
 * mode, no key.
 *
 * @param query - one of the queries above
 * @param retmax - the page size the scenario was recorded at
 * @param retstart - the offset the scenario was recorded at
 * @returns the method and URL `fixtureKey` hashes
 */
export function recordedEsearchRequest(
  query: SourceQuery,
  retmax: number,
  retstart = 0,
): { readonly method: "GET"; readonly url: string } {
  return {
    method: "GET",
    url: buildEsearchRequest({ query, retmax, retstart, retmode: "json" }).url,
  };
}
