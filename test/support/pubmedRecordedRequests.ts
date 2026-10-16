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
 *
 * **The window's two fixtures are owned here, not copied (`P2-T36`).** The
 * whole-year `esearch` at `retmax=10` and its `efetch`, which let the search
 * window replay through the real PubMed adapter, are planned by
 * `scripts/record-fixtures.ts` **from the constants below** — the recorder
 * imports {@link pubmedWindowQuery}, as it already does for the other
 * sources' `*RecordedRequests.ts` — so the request the recorder made and the
 * request the window makes come from one definition and cannot drift.
 */

import { buildEsearchRequest } from "../../src/sources/pubmed/query";
import { parseUserQuery } from "../../src/sources/shared/queryParse";
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

/**
 * The 20 PMIDs the committed `search-typical` fixture resolved to, in NCBI's
 * order, frozen here for `P2-T13` Part B's `search-typical-efetch` scenario.
 * Phase 1 recorded that search's identifiers but never their records, so
 * PubMed contributed none to the overlap with Europe PMC's and Crossref's
 * `search-typical` (the same question over the same quarter). Read from
 * `test/fixtures/pubmed/790a326635d71fbc.json`'s `idlist` on 2026-10-16, not
 * re-searched; written down rather than planned from that answer because the
 * recorder plans a dependent request only from what the same run captured.
 */
export const PUBMED_TYPICAL_PMIDS: readonly string[] = [
  "39086673",
  "36997768",
  "36997683",
  "36997680",
  "36997536",
  "36997524",
  "36997438",
  "36997428",
  "36997024",
  "36995680",
  "36995678",
  "36995675",
  "36995672",
  "36995671",
  "36995669",
  "36995667",
  "36995665",
  "36995664",
  "36995662",
  "36995636",
];

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
 * What the search window is set to when it replays the recorded `window-*`
 * fixtures (`P2-T36`): the keyword `P1-T22`'s block types, one **closed**
 * calendar year, and `PREFS.maxResults`' minimum.
 *
 * Why these three and no others: `toPipelineInput` in
 * `src/ui/viewModels/searchImportViewModel.ts` renders the two year
 * menulists as whole years, and `PREFS.maxResults` in `src/prefs/schema.ts`
 * has `min: 10`, enforced by `validate` in `searchImportPipeline.ts` — so the
 * cheapest request the window can make is one year at `retmax=10`. A past
 * year keeps the request byte-stable however long the fixture lives; the
 * window's default span ends in the current year and would not.
 */
export const PUBMED_WINDOW_KEYWORD = "ionizable lipid nanoparticle";
/** The one calendar year both year menulists are set to. */
export const PUBMED_WINDOW_YEAR = 2023;
/** `PREFS.maxResults`' minimum, which is the `limit` and so the `retmax`. */
export const PUBMED_WINDOW_MAX_RESULTS = 10;

/**
 * The `SourceQuery` the pipeline hands the PubMed adapter when the window
 * runs {@link PUBMED_WINDOW_KEYWORD} over {@link PUBMED_WINDOW_YEAR} at
 * {@link PUBMED_WINDOW_MAX_RESULTS} — the same three steps the product takes:
 * `parseUserQuery` on the keyword, `toPipelineInput`'s whole-year bounds, and
 * `queryFor` in `stages.ts` passing them through because PubMed declares
 * `dateFilter: true`.
 *
 * @returns a fresh query each call
 */
export function pubmedWindowQuery(): SourceQuery {
  const year = String(PUBMED_WINDOW_YEAR);
  return {
    terms: parseUserQuery(PUBMED_WINDOW_KEYWORD),
    limit: PUBMED_WINDOW_MAX_RESULTS,
    fromDate: `${year}-01-01`,
    toDate: `${year}-12-31`,
  };
}

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
