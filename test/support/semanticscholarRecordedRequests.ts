/**
 * The queries the committed Semantic Scholar fixtures were recorded under —
 * the one declaration `scripts/record-fixtures.ts` and
 * `test/unit/sources/semanticscholar.test.ts` both import (`P2-T05`, the
 * layout `pubmedRecordedRequests.ts` prescribes and the Europe PMC, Crossref
 * and arXiv files follow).
 *
 * A fixture is keyed on the exact method, URL and body (`fixtureKey` in
 * `fixtureReplay.ts`), so every consumer must build the same request. The
 * `recorded*Request` functions mirror the adapter: `limit` is the clamped
 * `SourceQuery.limit`, the bulk `token` is the cursor, the relevance `offset`
 * is the cursor read as a number, the batch body is `{"ids":[…]}`. **No
 * request carries a credential**: the key is a header the recorder never
 * sends (every recording is unauthenticated, on the shared anonymous pool),
 * and the hash does not include headers. Change a query here and its fixture
 * must be re-recorded; a drift shows up as "Missing fixture" in the unit test,
 * never as a network call.
 * *Updated 2026-11-02 (`P5-T04`): "never sends" holds for the fixtures directly
 * under `test/fixtures/semanticscholar/`. The relatedness scenarios at the end of
 * this file are recorded by the owner with the key (`docs/13` §3.5, `P5-T31`)
 * into `related/`; the key is still a header, so it is still outside the hash,
 * and those fixtures replay for a keyed and an unkeyed adapter alike.*
 *
 * **Every live scenario costs one 1.1-second slot** (`docs/07` §7.3's 0.9/s)
 * and draws on the shared anonymous pool `docs/02` §6.4 measured answering 429
 * on every attempt during US business hours, which is why the set is thirteen
 * independent requests plus one dependent page and not more.
 *
 * No platform import, so an integration spec inside Zotero can read it too.
 */

import {
  buildCitationsRequest,
  buildReferencesRequest,
  buildTitleMatchRequest,
} from "../../src/sources/semanticscholar/graph";
import {
  clampPageSize,
  readOffsetCursor,
} from "../../src/sources/semanticscholar/semanticscholarSource";
import {
  buildBatchRequest,
  buildBulkSearchRequest,
  buildPaperRequest,
  buildRelevanceSearchRequest,
  SEMANTICSCHOLAR_HEALTH_FIELDS,
  SEMANTICSCHOLAR_HEALTH_PAPER_ID,
  type SemanticScholarBatchRequest,
  type SemanticScholarBulkRequest,
  type SemanticScholarRelevanceRequest,
  type SemanticScholarRequest,
} from "../../src/sources/semanticscholar/query";
import {
  buildForPaperRequest,
  buildRecommendRequest,
  type SemanticScholarRecommendRequest,
} from "../../src/sources/semanticscholar/recommendations";
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
const phrase = (value: string): QueryNode => term(value, undefined, true);
const and = (...children: QueryNode[]): QueryNode => ({
  kind: "and",
  children,
});
const or = (...children: QueryNode[]): QueryNode => ({ kind: "or", children });
const not = (child: QueryNode): QueryNode => ({ kind: "not", child });

/** The closed historical year every windowed scenario uses. */
export const SEMANTICSCHOLAR_Y2023 = {
  fromDate: "2023-01-01",
  toDate: "2023-12-31",
} as const;

/**
 * `search-typical` (`limit` 20), `search-single` (`limit` 1) and
 * `paginated-*` (`limit` 3): `docs/02` §12.2's own worked example —
 * `("base editing" | "prime editing") + CRISPR - mouse` — so the recording
 * exercises `|`, `+`, `-`, quotes and parentheses at once, over 2023.
 */
export const SEMANTICSCHOLAR_QUERY_TYPICAL: SourceQuery = {
  terms: and(
    or(phrase("base editing"), phrase("prime editing")),
    term("CRISPR", "title"),
    not(term("mouse")),
  ),
  ...SEMANTICSCHOLAR_Y2023,
  limit: 20,
};

/** `search-empty`: one token chosen to match nothing. */
export const SEMANTICSCHOLAR_QUERY_EMPTY: SourceQuery = {
  terms: term("zqxjkwvqpzmbt"),
  ...SEMANTICSCHOLAR_Y2023,
  limit: 20,
};

/** The titles the `record-*` scenarios are looked up by, verbatim. */
export const SEMANTICSCHOLAR_TITLE_RICH =
  "Transfer learning enables predictions in network biology";
export const SEMANTICSCHOLAR_TITLE_SPARSE =
  "Cramming more components onto integrated circuits";
export const SEMANTICSCHOLAR_TITLE_UNICODE_1 = "Schrödinger";
export const SEMANTICSCHOLAR_TITLE_UNICODE_2 = "cat";
export const SEMANTICSCHOLAR_TITLE_PREPRINT = "VizIt";
export const SEMANTICSCHOLAR_TITLE_PAIR =
  "SciPy 1.0: fundamental algorithms for scientific computing in Python";

/**
 * `record-rich`: `docs/02` §6.7's own worked example (Geneformer, Nature
 * 2023) — `externalIds` with a **bare** `PubMedCentral`, `tldr`, `journal`,
 * `openAccessPdf` with a `disclaimer`, a four-figure `citationCount`. The
 * same paper the PubMed, Crossref and Europe PMC fixtures hold.
 */
export const SEMANTICSCHOLAR_QUERY_RICH: SourceQuery = {
  terms: phrase(SEMANTICSCHOLAR_TITLE_RICH),
  limit: 5,
};
/**
 * `record-sparse`: Moore's 1965 *Electronics* note — a paper old enough that
 * Semantic Scholar usually holds no abstract and no full publication date.
 * What it lacks is asserted from the recording, not assumed.
 */
export const SEMANTICSCHOLAR_QUERY_SPARSE: SourceQuery = {
  terms: phrase(SEMANTICSCHOLAR_TITLE_SPARSE),
  limit: 3,
};
/**
 * `record-unicode`: diacritics in titles (and, usually, author names). The
 * 2023 window is load-bearing: **measured 2026-10-15, the bulk endpoint
 * ignores `limit`** and returned 1000 records (1.98 MB) for the unwindowed
 * query; windowed, the set is small enough to commit.
 */
export const SEMANTICSCHOLAR_QUERY_UNICODE: SourceQuery = {
  terms: and(
    term(SEMANTICSCHOLAR_TITLE_UNICODE_1),
    term(SEMANTICSCHOLAR_TITLE_UNICODE_2),
  ),
  ...SEMANTICSCHOLAR_Y2023,
  limit: 5,
};
/**
 * `record-jats-abstract`: Semantic Scholar abstracts are plain text — there
 * is no JATS — so `docs/13` §3.1's row was aimed at its analogue, a
 * `/paper/batch` answer carrying both `abstract` and `tldr.text`, through
 * the DataCite DOI of "Attention is all you need". **Measured 2026-10-15: the
 * batch endpoint answers HTTP 400 `{"error":"No valid paper ids given"}` for
 * a `10.48550/arXiv.…` DataCite DOI** — Semantic Scholar does not resolve
 * arXiv's constructed DOIs as `DOI:` ids (`ARXIV:` is the form, §6.3). The
 * fixture is kept as the measured 400 shape on this endpoint; the
 * abstract-plus-TL;DR pairing is asserted on `batch-lookup` instead.
 */
export const SEMANTICSCHOLAR_BATCH_DATACITE_ID =
  "DOI:10.48550/arXiv.1706.03762";
/**
 * `record-preprint`: the arXiv e-print `docs/02` §7.4 uses as its sample
 * (VizIt, 2026), whose `venue` is `arXiv.org` — §10.2's preprint rule.
 */
export const SEMANTICSCHOLAR_QUERY_PREPRINT: SourceQuery = {
  terms: and(term(SEMANTICSCHOLAR_TITLE_PREPRINT), phrase("multi-view")),
  limit: 3,
};
/**
 * `dedup-pair-set`: the SciPy 1.0 paper (arXiv 1907.10121, PMID 32015543,
 * DOI 10.1038/s41592-019-0686-2), which the arXiv fixtures hold and which is
 * in PubMed, Crossref and Europe PMC live — the four-way pair `P2-T06`'s
 * report proposed.
 */
export const SEMANTICSCHOLAR_QUERY_PAIR: SourceQuery = {
  terms: phrase(SEMANTICSCHOLAR_TITLE_PAIR),
  limit: 3,
};
/** `paginated-page-1/2`: the typical query at three results a page. */
export const SEMANTICSCHOLAR_QUERY_PAGINATED: SourceQuery = {
  ...SEMANTICSCHOLAR_QUERY_TYPICAL,
  limit: 3,
};
/**
 * `relevance-search`: §12.2's example on `/paper/search` — plain text, the
 * `NOT` term dropped — at `limit` 5.
 */
export const SEMANTICSCHOLAR_QUERY_RELEVANCE: SourceQuery = {
  ...SEMANTICSCHOLAR_QUERY_TYPICAL,
  limit: 5,
};
/**
 * `batch-lookup`: `docs/02` §6.8's `/paper/batch` with four ids — the
 * Geneformer paper by DOI and again by PMID (the same paper twice, §6.3's
 * cross-id resolution), an id that resolves to nothing at **index 2** (the
 * card's third criterion: a `null` there must not shift index 3), and §6.8's
 * own `ARXIV:2106.15928`.
 */
export const SEMANTICSCHOLAR_BATCH_IDS: readonly string[] = [
  "DOI:10.1038/s41586-023-06139-9",
  "PMID:37258680",
  "DOI:10.1234/research-helper-unknown-id",
  "ARXIV:2106.15928",
];
/**
 * `corpus-batch` (`P2-T13` Part B): one `/paper/batch` POST, so that the
 * deduplication corpus holds Semantic Scholar's record of every preprint the
 * bioRxiv and medRxiv corpus lookups hold, and of each preprint's journal
 * version. Three groups, all read from committed fixtures on 2026-10-16:
 *
 * 1. the preprint DOIs the corpus searches returned
 *    (`biorxivRecordedRequests.ts`'s `BIORXIV_CORPUS_DOIS` and
 *    `MEDRXIV_CORPUS_DOIS`);
 * 2. the journal DOIs those lookups name in `published`;
 * 3. the two current-prefix (`10.64898/`) DOIs the committed bioRxiv and
 *    medRxiv `record-sparse` fixtures hold — no corpus search could return a
 *    `10.64898/` DOI (every window predates the prefix), and `P2-T13` step 3
 *    asks for such pairs on both servers.
 *
 * Recorded 2026-10-16 01:29 UTC as HTTP 429 (the anonymous pool refused it);
 * the committed fixture is that answer and yields no record.
 */
export const SEMANTICSCHOLAR_CORPUS_BATCH_IDS: readonly string[] = [
  "DOI:10.1101/2024.06.16.599202",
  "DOI:10.1101/2024.07.14.603469",
  "DOI:10.1101/2024.10.29.620871",
  "DOI:10.1101/2021.10.19.21265219",
  "DOI:10.1101/2021.12.02.21266871",
  "DOI:10.1101/2021.12.28.21268451",
  "DOI:10.1101/2024.09.27.24314505",
  "DOI:10.1101/2024.10.31.24316386",
  "DOI:10.1101/2024.12.10.24317471",
  "DOI:10.7554/eLife.104978.3",
  "DOI:10.1038/s41746-025-01684-1",
  "DOI:10.7759/cureus.27428",
  "DOI:10.1128/mSphere.00685-21",
  "DOI:10.1016/j.jbi.2025.104830",
  "DOI:10.1371/journal.pgph.0000647",
  "DOI:10.64898/2026.07.31.741992",
  "DOI:10.64898/2026.09.03.26361736",
];

/** The query the hand-written `error-429` fixture is keyed under. */
export const SEMANTICSCHOLAR_QUERY_SYNTHETIC_429: SourceQuery = {
  terms: term("synthetic rate limit fixture"),
  limit: 20,
};
/** The query the hand-written `error-400` fixture is keyed under. */
export const SEMANTICSCHOLAR_QUERY_SYNTHETIC_400: SourceQuery = {
  terms: term("synthetic bad request fixture"),
  limit: 20,
};
/** The query the hand-written `error-500` fixture is keyed under. */
export const SEMANTICSCHOLAR_QUERY_SYNTHETIC_500: SourceQuery = {
  terms: term("synthetic server error fixture"),
  limit: 20,
};
/** The query the derived `error-malformed` fixture is keyed under. */
export const SEMANTICSCHOLAR_QUERY_SYNTHETIC_MALFORMED: SourceQuery = {
  terms: term("synthetic malformed body fixture"),
  limit: 20,
};

/**
 * One `/paper/search/bulk` request exactly as the shipped adapter issues it.
 *
 * @param query - one of the queries above, or a `limit`/`cursor` variant
 * @param token - overrides `query.cursor`; page 2 passes page 1's `token`
 * @returns the built request `fixtureKey` hashes (method, URL)
 */
export function recordedSemanticScholarBulkRequest(
  query: SourceQuery,
  token?: string,
): SemanticScholarBulkRequest {
  const cursor = token ?? query.cursor;
  return buildBulkSearchRequest({
    query,
    limit: clampPageSize(query.limit),
    ...(cursor !== undefined && { token: cursor }),
  });
}

/** One `/paper/search` request exactly as `searchByRelevance` issues it. */
export function recordedSemanticScholarRelevanceRequest(
  query: SourceQuery,
): SemanticScholarRelevanceRequest {
  const offset = readOffsetCursor(query.cursor);
  return buildRelevanceSearchRequest({
    query,
    limit: clampPageSize(query.limit, offset),
    offset,
  });
}

/** One `/paper/batch` POST exactly as `lookup` issues it for `ids`. */
export function recordedSemanticScholarBatchRequest(
  ids: readonly string[] = SEMANTICSCHOLAR_BATCH_IDS,
): SemanticScholarBatchRequest {
  return buildBatchRequest(ids);
}

/** `docs/09` §2.3's test call exactly as `healthCheck` issues it. */
export function recordedSemanticScholarHealthRequest(): SemanticScholarRequest {
  return buildPaperRequest(
    SEMANTICSCHOLAR_HEALTH_PAPER_ID,
    SEMANTICSCHOLAR_HEALTH_FIELDS,
  );
}

// ---------------------------------------------------------------------------
// The relatedness scenarios (`P5-T04`), recorded by the owner in `P5-T31` into
// `test/fixtures/semanticscholar/related/`
// ---------------------------------------------------------------------------

/**
 * The seed of every relatedness scenario: `docs/05`'s own probe paper
 * (Geneformer, Nature 2023), which §2.1 and §3.1 record real answers for.
 */
export const SEMANTICSCHOLAR_RELATED_SEED = "DOI:10.1038/s41586-023-06139-9";
/** The second paper of the batch scenarios: `docs/05` §3.1's negative example. */
export const SEMANTICSCHOLAR_RELATED_SECOND_ID = "ARXIV:1706.03762";
/** Enough rows to show the shape, few enough to commit. */
export const SEMANTICSCHOLAR_RELATED_LIMIT = 20;
/** An id that resolves to nothing, the one `batch-lookup` already uses. */
export const SEMANTICSCHOLAR_RELATED_UNKNOWN_ID =
  "DOI:10.1234/research-helper-unknown-id";
/** `docs/05` §3.1's two positives (one paper, by two ids) and one negative. */
export const SEMANTICSCHOLAR_RECOMMEND_POSITIVES: readonly string[] = [
  SEMANTICSCHOLAR_RELATED_SEED,
  "PMID:37258680",
];
export const SEMANTICSCHOLAR_RECOMMEND_NEGATIVES: readonly string[] = [
  SEMANTICSCHOLAR_RELATED_SECOND_ID,
];
/** A title chosen to match nothing, for `match-title-absent`. */
export const SEMANTICSCHOLAR_TITLE_ABSENT = "zqxjkwvqpzmbt no such paper title";
/** A field the service does not have, for `citations-unknown-field`. */
export const SEMANTICSCHOLAR_UNKNOWN_FIELD = "researchHelperNoSuchField";

/** `references` and `seed-not-found` (the unknown id). */
export function recordedSemanticScholarReferencesRequest(
  paperId: string = SEMANTICSCHOLAR_RELATED_SEED,
): SemanticScholarRequest {
  return buildReferencesRequest({
    paperId,
    limit: SEMANTICSCHOLAR_RELATED_LIMIT,
  });
}

/** `citations`. */
export function recordedSemanticScholarCitationsRequest(): SemanticScholarRequest {
  return buildCitationsRequest({
    paperId: SEMANTICSCHOLAR_RELATED_SEED,
    limit: SEMANTICSCHOLAR_RELATED_LIMIT,
  });
}

/** `citations-unknown-field`: one row is enough to draw the 400. */
export function recordedSemanticScholarUnknownFieldRequest(): SemanticScholarRequest {
  return buildCitationsRequest({
    paperId: SEMANTICSCHOLAR_RELATED_SEED,
    limit: 1,
    fields: [SEMANTICSCHOLAR_UNKNOWN_FIELD],
  });
}

/** `match-title` and `match-title-absent`. */
export function recordedSemanticScholarMatchRequest(
  title: string,
): SemanticScholarRequest {
  return buildTitleMatchRequest(title);
}

/** `forpaper`. */
export function recordedSemanticScholarForPaperRequest(): SemanticScholarRequest {
  return buildForPaperRequest({
    paperId: SEMANTICSCHOLAR_RELATED_SEED,
    limit: SEMANTICSCHOLAR_RELATED_LIMIT,
  });
}

/**
 * `recommend-post` at {@link SEMANTICSCHOLAR_RELATED_LIMIT}, and the hand-written
 * `recommend-size-cap` at twice that: halving the refused limit, as `P5-T06`
 * step 3 retries, lands on the recorded answer.
 */
export function recordedSemanticScholarRecommendRequest(
  limit: number = SEMANTICSCHOLAR_RELATED_LIMIT,
): SemanticScholarRecommendRequest {
  return buildRecommendRequest({
    positivePaperIds: SEMANTICSCHOLAR_RECOMMEND_POSITIVES,
    negativePaperIds: SEMANTICSCHOLAR_RECOMMEND_NEGATIVES,
    limit,
  });
}

/** `batch-embedding`: `P5-T20`'s `fields=embedding.specter_v2`, two papers. */
export function recordedSemanticScholarEmbeddingBatchRequest(): SemanticScholarBatchRequest {
  return buildBatchRequest(
    [SEMANTICSCHOLAR_RELATED_SEED, SEMANTICSCHOLAR_RELATED_SECOND_ID],
    ["embedding.specter_v2"],
  );
}

/** `batch-references`: the reference ids of two papers. */
export function recordedSemanticScholarReferencesBatchRequest(): SemanticScholarBatchRequest {
  return buildBatchRequest(
    [SEMANTICSCHOLAR_RELATED_SEED, SEMANTICSCHOLAR_RELATED_SECOND_ID],
    ["references.externalIds"],
  );
}

/** `batch-unresolvable`: `docs/05` §3.3 pitfall 2's check, one bad id in the middle. */
export function recordedSemanticScholarUnresolvableBatchRequest(): SemanticScholarBatchRequest {
  return buildBatchRequest(
    [
      SEMANTICSCHOLAR_RELATED_SEED,
      SEMANTICSCHOLAR_RELATED_UNKNOWN_ID,
      SEMANTICSCHOLAR_RELATED_SECOND_ID,
    ],
    ["paperId", "externalIds"],
  );
}
