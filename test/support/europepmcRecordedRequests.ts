/**
 * The queries the committed Europe PMC fixtures were recorded under — the one
 * declaration `scripts/record-fixtures.ts` and `test/unit/sources/europepmc.test.ts`
 * both import.
 *
 * **Why this file exists (`P2-T33`).** `P2-T03` recorded `test/fixtures/europepmc/`
 * from a scratch script that was never committed and pinned the queries as
 * constants in its unit test, where nothing outside Vitest can import them: the
 * test file calls `describe` at module load, and the constants were not
 * exported. The card asked that the recorder import them rather than copy them,
 * so they moved here, beside `pubmedRecordedRequests.ts`, whose header already
 * says "a Phase 2 adapter card that records its own source adds its own file
 * beside this one". No platform import, so an integration spec inside Zotero
 * can read it too.
 *
 * A fixture is keyed on the exact URL (`fixtureKey` in `fixtureReplay.ts`), so
 * every consumer must build the same request. {@link recordedEuropePmcRequest}
 * mirrors `search()` in `src/sources/europepmc/europepmcSource.ts`: `pageSize`
 * is the clamped `limit`, the cursor defaults to `*`, `resultType` is `core`.
 * Change a query here and its fixture must be re-recorded; a drift shows up as
 * "Missing fixture" in the unit test, never as a network call.
 */

import {
  buildEuropePmcCitationsRequest,
  buildEuropePmcReferencesRequest,
  type EuropePmcRelationRequest,
} from "../../src/sources/europepmc/citations";
import { clampPageSize } from "../../src/sources/europepmc/europepmcSource";
import {
  buildEuropePmcSearchRequest,
  EUROPEPMC_FIRST_CURSOR,
  type EuropePmcSearchRequest,
} from "../../src/sources/europepmc/query";
import type {
  QueryField,
  QueryNode,
  SourceQuery,
} from "../../src/sources/types";

const term = (
  value: string,
  field?: QueryField,
  phrase?: boolean,
): QueryNode => ({
  kind: "term",
  value,
  ...(field !== undefined && { field }),
  ...(phrase !== undefined && { phrase }),
});
const title = (value: string): QueryNode => term(value, "title", true);
const and = (...children: QueryNode[]): QueryNode => ({
  kind: "and",
  children,
});
const or = (...children: QueryNode[]): QueryNode => ({ kind: "or", children });

/** The closed historical quarter every windowed scenario uses. */
export const EUROPEPMC_Q1_2023 = {
  fromDate: "2023-01-01",
  toDate: "2023-03-31",
} as const;

/** `search-typical` (pageSize 20) and `search-single` (`limit: 1`). */
export const EUROPEPMC_QUERY_TYPICAL: SourceQuery = {
  terms: and(term("CRISPR"), term("editing")),
  ...EUROPEPMC_Q1_2023,
  limit: 20,
};

/** `search-empty`: a term chosen to match nothing. */
export const EUROPEPMC_QUERY_EMPTY: SourceQuery = {
  terms: term("zqxjkwv nonexistent biomedical phrase"),
  ...EUROPEPMC_Q1_2023,
  limit: 20,
};

/** The titles the `record-*` scenarios are looked up by, verbatim. */
export const EUROPEPMC_TITLE_RICH =
  "Transfer learning enables predictions in network biology";
export const EUROPEPMC_TITLE_SPARSE = "Measures in ovine psoroptic mange";
export const EUROPEPMC_TITLE_JATS =
  "Effect of topical Zingiber cassumunar on painful diabetic neuropathy";
export const EUROPEPMC_TITLE_MANY =
  "A reference map of the human binary protein interactome";
export const EUROPEPMC_TITLE_UNICODE_1 =
  "Role in post-translational modification of M2-type pyruvate kinase in tumorigenesis and development";
export const EUROPEPMC_TITLE_UNICODE_2 =
  "Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults";
export const EUROPEPMC_TITLE_UNICODE_3 =
  "Physical and psychological effects of neuromuscular integrative activity vs Pilates on sedentary females";

/** `record-rich`: `docs/02` §3.4's own paper, by title. */
export const EUROPEPMC_QUERY_RICH: SourceQuery = {
  terms: title(EUROPEPMC_TITLE_RICH),
  limit: 5,
};
/** `record-sparse`: `MED/60000`, no abstract, no DOI. */
export const EUROPEPMC_QUERY_SPARSE: SourceQuery = {
  terms: title(EUROPEPMC_TITLE_SPARSE),
  limit: 5,
};
/** `record-jats-abstract`: structured abstract with inline markup. */
export const EUROPEPMC_QUERY_JATS: SourceQuery = {
  terms: title(EUROPEPMC_TITLE_JATS),
  limit: 5,
};
/** `record-many-authors`: 88 authors. */
export const EUROPEPMC_QUERY_MANY: SourceQuery = {
  terms: title(EUROPEPMC_TITLE_MANY),
  limit: 5,
};
/** `record-unicode`: three titles in one request — diacritics, markup, VO2max. */
export const EUROPEPMC_QUERY_UNICODE: SourceQuery = {
  terms: or(
    title(EUROPEPMC_TITLE_UNICODE_1),
    title(EUROPEPMC_TITLE_UNICODE_2),
    title(EUROPEPMC_TITLE_UNICODE_3),
  ),
  limit: 5,
};
/** `record-unicode-cjk`: the CJK probe, kept as evidence that `title` is Latin. */
export const EUROPEPMC_QUERY_CJK: SourceQuery = {
  terms: title("基因编辑"),
  limit: 3,
};
/** `dedup-pair-set`: PubMed's `record-rich` paper, by DOI. */
export const EUROPEPMC_QUERY_PAIR: SourceQuery = {
  terms: term("10.1038/s41586-023-06139-9"),
  limit: 5,
};
/** `record-preprint`: `PPR` records with a linked published version. */
export const EUROPEPMC_QUERY_PREPRINT: SourceQuery = {
  terms: and(title("base editing"), term("bioRxiv")),
  fromDate: "2023-01-01",
  toDate: "2023-06-30",
  limit: 3,
};
/** `paginated-page-1/2/3`: five hits at pageSize 3; pages 2 and 3 carry cursors. */
export const EUROPEPMC_QUERY_PAGINATED: SourceQuery = {
  terms: or(
    title(EUROPEPMC_TITLE_RICH),
    title(EUROPEPMC_TITLE_SPARSE),
    title(EUROPEPMC_TITLE_MANY),
    title(EUROPEPMC_TITLE_JATS),
  ),
  limit: 3,
};
/** `search-error-empty-query`: `errCode` 404 inside an HTTP 200. */
export const EUROPEPMC_QUERY_ERROR_EMPTY: SourceQuery = {
  terms: term('""'),
  limit: 20,
};
/** `search-post-long-query`: 3085 rendered characters, so `POST /searchPOST`. */
export const EUROPEPMC_QUERY_POST_LONG: SourceQuery = {
  terms: or(
    ...Array.from({ length: 99 }, (_, i) =>
      term(`zqxjkwv filler phrase ${String(i).padStart(3, "0")}`),
    ),
    title("CRISPR"),
  ),
  limit: 5,
};
/** The query the hand-written `error-429` fixture is keyed under. */
export const EUROPEPMC_QUERY_SYNTHETIC_429: SourceQuery = {
  terms: term("synthetic rate limit fixture"),
  limit: 20,
};
/** The query the hand-written `error-500` fixture is keyed under. */
export const EUROPEPMC_QUERY_SYNTHETIC_500: SourceQuery = {
  terms: term("synthetic server error fixture"),
  limit: 20,
};
/** The query the derived `error-malformed` fixture is keyed under. */
export const EUROPEPMC_QUERY_SYNTHETIC_MALFORMED: SourceQuery = {
  terms: term("synthetic malformed body fixture"),
  limit: 20,
};

/**
 * One `search` request exactly as the shipped adapter issues it for `query`.
 *
 * @param query - one of the queries above, or a `limit`/`cursor` variant of one
 * @param cursor - overrides `query.cursor`; pages 2 and 3 pass the previous
 *   page's `nextCursorMark`
 * @returns the built request `fixtureKey` hashes (method, URL, body)
 */
export function recordedEuropePmcRequest(
  query: SourceQuery,
  cursor?: string,
): EuropePmcSearchRequest {
  return buildEuropePmcSearchRequest({
    query,
    pageSize: clampPageSize(query.limit),
    cursor: cursor ?? query.cursor ?? EUROPEPMC_FIRST_CURSOR,
    resultType: "core",
  });
}

// ---------------------------------------------------------------------------
// The relatedness scenarios (`P5-T04`), in `test/fixtures/europepmc/related/`
// ---------------------------------------------------------------------------

/** `docs/02` §4.7's own example, and `docs/05`'s probe paper. */
export const EUROPEPMC_RELATED_SEED_PMID = "37258680";
/**
 * The seed of `citations-outage-seed` and the hand-written `references-503`,
 * so `P5-T07` can show, from fixtures alone, `/citations` working on the seed
 * whose `/references` is down. It is PubMed's `record-jats-abstract` paper.
 */
export const EUROPEPMC_RELATED_OUTAGE_SEED_PMID = "39220605";
/** Enough rows to show the shape, few enough to commit. */
export const EUROPEPMC_RELATED_PAGE_SIZE = 25;

/** `citations` and `citations-outage-seed`. */
export function recordedEuropePmcCitationsRequest(
  pmid: string = EUROPEPMC_RELATED_SEED_PMID,
): EuropePmcRelationRequest {
  return buildEuropePmcCitationsRequest({
    source: "MED",
    id: pmid,
    pageSize: EUROPEPMC_RELATED_PAGE_SIZE,
  });
}

/** `references` and the hand-written `references-503`. */
export function recordedEuropePmcReferencesRequest(
  pmid: string = EUROPEPMC_RELATED_SEED_PMID,
): EuropePmcRelationRequest {
  return buildEuropePmcReferencesRequest({
    source: "MED",
    id: pmid,
    pageSize: EUROPEPMC_RELATED_PAGE_SIZE,
  });
}
