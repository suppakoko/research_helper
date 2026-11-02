/**
 * The queries the committed Crossref fixtures were recorded under — the one
 * declaration `scripts/record-fixtures.ts` and `test/unit/sources/crossref.test.ts`
 * both import (`P2-T04`, the layout `pubmedRecordedRequests.ts` prescribes and
 * `europepmcRecordedRequests.ts` follows).
 *
 * A fixture is keyed on the exact URL (`fixtureKey` in `fixtureReplay.ts`), so
 * every consumer must build the same request. {@link recordedCrossrefRequest}
 * mirrors `search()` in `src/sources/crossref/crossrefSource.ts`: `rows` is the
 * clamped `limit`, the cursor defaults to `*`, the `select` whitelist is the
 * shipped one, and `mailto` carries the **maintainer** address because the
 * recorder runs with no `contactEmail` preference — a replay that passed a
 * user address would build a different URL and find no fixture. Change a
 * query here and its fixture must be re-recorded; a drift shows up as
 * "Missing fixture" in the unit test, never as a network call.
 *
 * No platform import, so an integration spec inside Zotero can read it too.
 */

import { clampRows } from "../../src/sources/crossref/crossrefSource";
import {
  buildCrossrefTitleSearchRequest,
  buildCrossrefWorkRequest,
  CROSSREF_TITLE_SEARCH_ROWS_MAX,
  type CrossrefRelatedRequest,
} from "../../src/sources/crossref/references";
import {
  buildCrossrefWorksRequest,
  CROSSREF_FIRST_CURSOR,
  type CrossrefWorksRequest,
} from "../../src/sources/crossref/query";
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
export const CROSSREF_Q1_2023 = {
  fromDate: "2023-01-01",
  toDate: "2023-03-31",
} as const;

/** `search-typical` (rows 20), `search-single` (`limit: 1`) and `paginated-*` (`limit: 3`). */
export const CROSSREF_QUERY_TYPICAL: SourceQuery = {
  terms: and(term("CRISPR"), term("editing")),
  ...CROSSREF_Q1_2023,
  limit: 20,
};

/**
 * `search-empty`: one token chosen to match nothing. A multi-word nonsense
 * phrase would not do here — Crossref scores every word of the bag, so
 * "nonexistent biomedical phrase" would match thousands of records.
 */
export const CROSSREF_QUERY_EMPTY: SourceQuery = {
  terms: term("zqxjkwvqpzmbt"),
  ...CROSSREF_Q1_2023,
  limit: 20,
};

/** The titles the `record-*` scenarios are looked up by, verbatim. */
export const CROSSREF_TITLE_RICH =
  "Transfer learning enables predictions in network biology";
export const CROSSREF_DOI_RICH = "10.1038/s41586-023-06139-9";
export const CROSSREF_TITLE_SPARSE = "Measures in ovine psoroptic mange";
export const CROSSREF_TITLE_JATS =
  "Editing Out Seizures? Base Editing Shows Promise for SCN8A DEE";
export const CROSSREF_TITLE_PREPRINT =
  "Precise and efficient C-to-U RNA Base Editing with SNAP-CDAR-S";
export const CROSSREF_TITLE_UNICODE_1 =
  "Role in post-translational modification of M2-type pyruvate kinase in tumorigenesis and development";
export const CROSSREF_TITLE_UNICODE_2 =
  "Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults";
export const CROSSREF_TITLE_UNICODE_3 =
  "Physical and psychological effects of neuromuscular integrative activity vs Pilates on sedentary females";

/** `record-rich`: `docs/02` §3.4's own paper (Nature, 2023), by title. */
export const CROSSREF_QUERY_RICH: SourceQuery = {
  terms: title(CROSSREF_TITLE_RICH),
  limit: 5,
};
/** `record-sparse`: a 1976 Veterinary Record paper — no abstract, coarse date. */
export const CROSSREF_QUERY_SPARSE: SourceQuery = {
  terms: title(CROSSREF_TITLE_SPARSE),
  limit: 5,
};
/** `record-jats-abstract`: `docs/02` §5.4's own example, boxed-text JATS. */
export const CROSSREF_QUERY_JATS: SourceQuery = {
  terms: title(CROSSREF_TITLE_JATS),
  limit: 5,
};
/** `record-preprint`: a bioRxiv posted-content with `relation.is-preprint-of`. */
export const CROSSREF_QUERY_PREPRINT: SourceQuery = {
  terms: title(CROSSREF_TITLE_PREPRINT),
  limit: 5,
};
/** `record-unicode`: three titles in one bag — diacritics, markup, VO2max. */
export const CROSSREF_QUERY_UNICODE: SourceQuery = {
  terms: or(
    title(CROSSREF_TITLE_UNICODE_1),
    title(CROSSREF_TITLE_UNICODE_2),
    title(CROSSREF_TITLE_UNICODE_3),
  ),
  limit: 10,
};
/** `dedup-pair-set`: PubMed's and Europe PMC's `record-rich` paper, by title, 3 rows. */
export const CROSSREF_QUERY_PAIR: SourceQuery = {
  terms: title(CROSSREF_TITLE_RICH),
  limit: 3,
};
/**
 * `search-doi-string`: the same paper asked for by its bare DOI in
 * `query.bibliographic` — a probe of whether Crossref's bibliographic index
 * resolves a DOI string, which `P2-T12`'s lookups will want to know.
 */
export const CROSSREF_QUERY_DOI_STRING: SourceQuery = {
  terms: term(CROSSREF_DOI_RICH),
  limit: 3,
};
/** `paginated-page-1/2`: the typical query at three rows a page. */
export const CROSSREF_QUERY_PAGINATED: SourceQuery = {
  ...CROSSREF_QUERY_TYPICAL,
  limit: 3,
};
/** The query the hand-written `error-429` fixture is keyed under. */
export const CROSSREF_QUERY_SYNTHETIC_429: SourceQuery = {
  terms: term("synthetic rate limit fixture"),
  limit: 20,
};
/**
 * The query the `error-400` fixture is keyed under. Its body was **measured**
 * (2026-10-14: eleven requests whose `select` named `reference-count`,
 * `institution` and `language` all drew it), then written by the recorder
 * under a reproducible key, because the request that drew it live is one the
 * shipped builder no longer makes.
 */
export const CROSSREF_QUERY_SYNTHETIC_400: SourceQuery = {
  terms: term("synthetic validation failure fixture"),
  limit: 20,
};
/** The query the hand-written `error-500` fixture is keyed under. */
export const CROSSREF_QUERY_SYNTHETIC_500: SourceQuery = {
  terms: term("synthetic server error fixture"),
  limit: 20,
};
/** The query the derived `error-malformed` fixture is keyed under. */
export const CROSSREF_QUERY_SYNTHETIC_MALFORMED: SourceQuery = {
  terms: term("synthetic malformed body fixture"),
  limit: 20,
};

/**
 * One `/works` request exactly as the shipped adapter issues it for `query`
 * with no `contactEmail` preference set.
 *
 * @param query - one of the queries above, or a `limit`/`cursor` variant of one
 * @param cursor - overrides `query.cursor`; page 2 passes page 1's `next-cursor`
 * @returns the built request `fixtureKey` hashes (method, URL)
 */
export function recordedCrossrefRequest(
  query: SourceQuery,
  cursor?: string,
): CrossrefWorksRequest {
  return buildCrossrefWorksRequest({
    query,
    rows: clampRows(query.limit),
    cursor: cursor ?? query.cursor ?? CROSSREF_FIRST_CURSOR,
  });
}

// ---------------------------------------------------------------------------
// The relatedness scenarios (`P5-T04`), in `test/fixtures/crossref/related/`
// ---------------------------------------------------------------------------

/**
 * `work-with-references`: `docs/05`'s probe paper. The committed `record-rich`
 * fixture reads `references-count` 160 for it.
 */
export const CROSSREF_DOI_WITH_REFERENCES = "10.1038/s41586-023-06139-9";
/**
 * `work-without-references`. The committed `record-sparse` fixture reads
 * `references-count` 0 for it; the recording shows what `/works/{doi}` answers.
 */
export const CROSSREF_DOI_WITHOUT_REFERENCES = "10.1007/3-540-29835-5_2408";
/** `title-search`: the probe paper by its title, as `P5-T09` step 2 asks. */
export const CROSSREF_RELATED_TITLE =
  "Transfer learning enables predictions in network biology";

/** `work-with-references` and `work-without-references`, with no `contactEmail`. */
export function recordedCrossrefWorkRequest(
  doi: string,
): CrossrefRelatedRequest {
  return buildCrossrefWorkRequest(doi);
}

/** `title-search`, at the most rows the builder takes, with no `contactEmail`. */
export function recordedCrossrefTitleSearchRequest(): CrossrefRelatedRequest {
  return buildCrossrefTitleSearchRequest({
    title: CROSSREF_RELATED_TITLE,
    rows: CROSSREF_TITLE_SEARCH_ROWS_MAX,
  });
}
