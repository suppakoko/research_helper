/**
 * The queries the committed arXiv fixtures were recorded under — the one
 * declaration `scripts/record-fixtures.ts` and `test/unit/sources/arxiv.test.ts`
 * both import (`P2-T06`, the layout `pubmedRecordedRequests.ts` prescribes and
 * `europepmcRecordedRequests.ts` / `crossrefRecordedRequests.ts` follow).
 *
 * A fixture is keyed on the exact URL (`fixtureKey` in `fixtureReplay.ts`), so
 * every consumer must build the same request. {@link recordedArxivRequest}
 * mirrors `search()` in `src/sources/arxiv/arxivSource.ts`: `max_results` is
 * the clamped `limit`, `start` is the cursor read as an offset (default 0),
 * and the sort is the shipped `relevance` / `descending`. arXiv has no contact
 * parameter and no key, so nothing about identity is in the URL. Change a
 * query here and its fixture must be re-recorded; a drift shows up as
 * "Missing fixture" in the unit test, never as a network call.
 *
 * **Every live scenario costs one three-second slot** (`docs/02` §7.1), which
 * is why the set is twelve requests and not more, and why the paginated pages
 * are both independent (`start` is known up front) rather than one recorded
 * from the other's answer.
 *
 * No platform import, so an integration spec inside Zotero can read it too.
 */

import {
  clampMaxResults,
  readStartCursor,
} from "../../src/sources/arxiv/arxivSource";
import {
  buildArxivQueryRequest,
  type ArxivQueryRequest,
} from "../../src/sources/arxiv/query";
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

/** The closed historical quarter every windowed scenario uses. */
export const ARXIV_Q1_2023 = {
  fromDate: "2023-01-01",
  toDate: "2023-03-31",
} as const;

/**
 * `search-typical` (`max_results` 20), `search-single` (`limit: 1`) and
 * `paginated-*` (`limit: 3`). A phrase and a bare word under an `and`, so the
 * recording exercises `all:"…"`, `all:…`, `AND` and the `submittedDate`
 * window at once; "deep learning" + "protein" has hundreds of hits in any
 * recent quarter of `q-bio` / `cs`.
 */
export const ARXIV_QUERY_TYPICAL: SourceQuery = {
  terms: and(term("deep learning", undefined, true), term("protein")),
  ...ARXIV_Q1_2023,
  limit: 20,
};

/** `search-empty`: one token chosen to match nothing. */
export const ARXIV_QUERY_EMPTY: SourceQuery = {
  terms: term("zqxjkwvqpzmbt"),
  ...ARXIV_Q1_2023,
  limit: 20,
};

/** The titles the `record-*` scenarios are looked up by, verbatim. */
export const ARXIV_TITLE_RICH = "SciPy";
export const ARXIV_AUTHOR_RICH = "Virtanen";
export const ARXIV_TITLE_PAIR =
  "Fundamental Algorithms for Scientific Computing in Python";
export const ARXIV_TITLE_SPARSE = "VizIt";
export const ARXIV_TITLE_UNICODE_1 = "Schrödinger";
export const ARXIV_TITLE_UNICODE_2 = "cat";
export const ARXIV_TITLE_WRAPPED = "Riemann hypothesis";
export const ARXIV_TITLE_PREPRINT =
  "Deep Residual Learning for Image Recognition";

/**
 * `record-rich`: the SciPy 1.0 paper (arXiv:1907.10121), which carries
 * `<arxiv:doi>`, `<arxiv:journal_ref>`, `<arxiv:comment>`, several categories
 * and thirty-odd authors — by `ti:` and `au:`.
 */
export const ARXIV_QUERY_RICH: SourceQuery = {
  terms: and(
    term(ARXIV_TITLE_RICH, "title"),
    term(ARXIV_AUTHOR_RICH, "author"),
  ),
  limit: 5,
};
/**
 * `record-sparse`: `docs/02` §7.4's own sample entry (arXiv:2609.04658), a
 * fresh preprint with no journal DOI, no journal reference and no comment.
 * arXiv always supplies a full date and a constructed DOI, so "sparse" here
 * means "nothing beyond the mandatory elements".
 */
export const ARXIV_QUERY_SPARSE: SourceQuery = {
  terms: term(ARXIV_TITLE_SPARSE, "title"),
  limit: 5,
};
/** `record-unicode`: diacritics in titles (and, usually, author names). */
export const ARXIV_QUERY_UNICODE: SourceQuery = {
  terms: and(
    term(ARXIV_TITLE_UNICODE_1, "title"),
    term(ARXIV_TITLE_UNICODE_2, "title"),
  ),
  limit: 5,
};
/**
 * `record-jats-abstract`: arXiv has no JATS — its abstracts are plain text —
 * so `docs/13` §3.1's row is served by its arXiv analogue: a hard-wrapped
 * `<summary>` carrying LaTeX markup (`docs/02` §7.5 note 2, the card's third
 * criterion).
 */
export const ARXIV_QUERY_WRAPPED: SourceQuery = {
  terms: title(ARXIV_TITLE_WRAPPED),
  limit: 2,
};
/** `record-preprint`: a preprint with a linked published DOI (`<arxiv:doi>`). */
export const ARXIV_QUERY_PREPRINT: SourceQuery = {
  terms: title(ARXIV_TITLE_PREPRINT),
  limit: 3,
};
/**
 * `dedup-pair-set`: the SciPy 1.0 paper again, by its subtitle — a paper
 * that is also in PubMed (32015543), Crossref and Europe PMC, so the three
 * other sources can record the same work.
 */
export const ARXIV_QUERY_PAIR: SourceQuery = {
  terms: title(ARXIV_TITLE_PAIR),
  limit: 3,
};
/** `paginated-page-1/2`: the typical query at three results a page. */
export const ARXIV_QUERY_PAGINATED: SourceQuery = {
  ...ARXIV_QUERY_TYPICAL,
  limit: 3,
};
/** The `start` page 2 is recorded at: page 1's three results. */
export const ARXIV_PAGE_2_START = "3";
/**
 * `search-error-feed`: `docs/02` §7.5 note 6's HTTP-200 error feed, provoked
 * through `raw.id_list` with a malformed id — arXiv answers "incorrect id
 * format" as a feed whose one entry is `http://arxiv.org/api/errors`.
 */
export const ARXIV_QUERY_ERROR_FEED: SourceQuery = {
  terms: term("electron"),
  limit: 1,
  raw: { id_list: "not-an-arxiv-id" },
};
/** The query the hand-written `error-429` fixture is keyed under. */
export const ARXIV_QUERY_SYNTHETIC_429: SourceQuery = {
  terms: term("synthetic rate limit fixture"),
  limit: 20,
};
/** The query the hand-written `error-500` fixture is keyed under. */
export const ARXIV_QUERY_SYNTHETIC_500: SourceQuery = {
  terms: term("synthetic server error fixture"),
  limit: 20,
};
/** The query the derived `error-malformed` fixture is keyed under. */
export const ARXIV_QUERY_SYNTHETIC_MALFORMED: SourceQuery = {
  terms: term("synthetic malformed body fixture"),
  limit: 20,
};

/**
 * One `/api/query` request exactly as the shipped adapter issues it for
 * `query`.
 *
 * @param query - one of the queries above, or a `limit`/`cursor` variant of one
 * @param cursor - overrides `query.cursor`; page 2 passes {@link ARXIV_PAGE_2_START}
 * @returns the built request `fixtureKey` hashes (method, URL)
 */
export function recordedArxivRequest(
  query: SourceQuery,
  cursor?: string,
): ArxivQueryRequest {
  const start = readStartCursor(cursor ?? query.cursor);
  return buildArxivQueryRequest({
    query,
    start,
    maxResults: clampMaxResults(query.limit, start),
  });
}
