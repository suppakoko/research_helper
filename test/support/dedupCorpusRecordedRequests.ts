/**
 * The searches `P2-T13` Part B recorded for the deduplication corpus — the one
 * declaration `scripts/record-fixtures.ts` plans them from, for every source
 * that runs them (the layout `pubmedRecordedRequests.ts` prescribes and the
 * other sources' `*RecordedRequests.ts` follow).
 *
 * **Why one file for seven sources.** The corpus is only useful where the
 * sources were asked the *same* question: Part A measured 47 candidate pairs
 * from the committed fixtures because each source had been recorded with its
 * own queries (`plan/reports/P2-T13-partA.md` §1). So the queries live here
 * once, and each source's plan in the recorder renders them with its own
 * shipped builder. A source-specific scenario (PubMed's fetch of the committed
 * `search-typical` identifiers, the bioRxiv/medRxiv DOI lookups, Semantic
 * Scholar's batch) lives in that source's own `*RecordedRequests.ts`.
 *
 * **What was approved** (`plan/00` §6 item 222, 2026-10-16): at most 85
 * unkeyed live requests, the Part A plan — five queries, each over one shared
 * date window, plus probes for short titles, series titles and a Korean title.
 * Every query is built the way the product builds it: `parseUserQuery` on the
 * text a user would type, whole-year bounds (`toPipelineInput`), and the limit
 * as the page size (`queryFor` in `src/pipeline/searchImport/stages.ts`).
 *
 * **The probes' window is recent on purpose** (2026-01-01 … 2026-08-31,
 * closed). `P2-T13` step 3 asks for pairs carrying the `10.64898/` prefix,
 * which bioRxiv and medRxiv began minting in 2025–2026 (`docs/02` §11.2), so
 * no query over 2020–2024 can return one. The Korean probe keeps Q5's window
 * and topic instead.
 *
 * **The short-title probe asks for 10, not 25.** Records titled exactly
 * "Correction" or "Retraction" have no blocking signature, so the corpus
 * builder pairs every two of them (`short-title-identical`): 25 such records
 * would be 300 pairs of one kind for the owner to label.
 *
 * No platform import, so an integration spec inside Zotero can read it too.
 */

import { parseUserQuery } from "../../src/sources/shared/queryParse";
import type { SourceQuery } from "../../src/sources/types";

/** Part A's page size for every corpus search (`P2-T13-partA.md` §8). */
export const DEDUP_CORPUS_LIMIT = 25;

/** The short-title probe's page size; see the file header. */
export const DEDUP_CORPUS_SHORT_TITLE_LIMIT = 10;

/** One corpus search: what a user would type, over which closed window. */
export interface DedupCorpusSearch {
  /** The scenario name, `corpus-<id>`; PubMed suffixes `-esearch` / `-efetch`. */
  readonly scenario: string;
  /** The text typed into the search box, parsed by `parseUserQuery`. */
  readonly text: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly limit: number;
}

/** Whole calendar years, as the search window renders its two year menus. */
function years(from: number, to: number): { fromDate: string; toDate: string } {
  return { fromDate: `${String(from)}-01-01`, toDate: `${String(to)}-12-31` };
}

/** The probes' closed recent window; see the file header. */
export const DEDUP_CORPUS_PROBE_WINDOW = {
  fromDate: "2026-01-01",
  toDate: "2026-08-31",
} as const;

/** Q1 — biomedical, 2023. */
export const DEDUP_CORPUS_Q1: DedupCorpusSearch = {
  scenario: "corpus-q1",
  text: "CRISPR base editing",
  ...years(2023, 2023),
  limit: DEDUP_CORPUS_LIMIT,
};
/** Q2 — biomedical and computational, 2024. */
export const DEDUP_CORPUS_Q2: DedupCorpusSearch = {
  scenario: "corpus-q2",
  text: "single-cell RNA sequencing atlas",
  ...years(2024, 2024),
  limit: DEDUP_CORPUS_LIMIT,
};
/** Q3 — computer science meets medicine, 2024 (medRxiv's share is large). */
export const DEDUP_CORPUS_Q3: DedupCorpusSearch = {
  scenario: "corpus-q3",
  text: "large language model clinical",
  ...years(2024, 2024),
  limit: DEDUP_CORPUS_LIMIT,
};
/** Q4 — computer science, 2022–2023. */
export const DEDUP_CORPUS_Q4: DedupCorpusSearch = {
  scenario: "corpus-q4",
  text: "graph neural network molecular property",
  ...years(2022, 2023),
  limit: DEDUP_CORPUS_LIMIT,
};
/** Q5 — medRxiv preprints and their journal versions, 2020–2021. */
export const DEDUP_CORPUS_Q5: DedupCorpusSearch = {
  scenario: "corpus-q5",
  text: "COVID-19 seroprevalence",
  ...years(2020, 2021),
  limit: DEDUP_CORPUS_LIMIT,
};

/** Probe: titles "Retraction" / "Correction" (`P2-T13` step 3's short titles). */
export const DEDUP_CORPUS_PROBE_SHORT_TITLE: DedupCorpusSearch = {
  scenario: "corpus-probe-short-title",
  text: "title:Retraction OR title:Correction",
  ...DEDUP_CORPUS_PROBE_WINDOW,
  limit: DEDUP_CORPUS_SHORT_TITLE_LIMIT,
};
/** Probe: a "Part II" / "Part III" title phrase (step 3's series titles). */
export const DEDUP_CORPUS_PROBE_SERIES: DedupCorpusSearch = {
  scenario: "corpus-probe-series",
  text: 'title:"part II" OR title:"part III"',
  ...DEDUP_CORPUS_PROBE_WINDOW,
  limit: DEDUP_CORPUS_LIMIT,
};
/**
 * Probe: a Korean title (`docs/02` §11.3.3's "carries Korean titles"). "코로나19"
 * is the Korean name of COVID-19, over Q5's window. Whether Crossref returns
 * Hangul titles for it was unverified before this recording.
 */
export const DEDUP_CORPUS_PROBE_KOREAN: DedupCorpusSearch = {
  scenario: "corpus-probe-korean",
  text: "코로나19",
  ...years(2020, 2021),
  limit: DEDUP_CORPUS_LIMIT,
};

/** The five shared queries, in order. */
export const DEDUP_CORPUS_QUERIES: readonly DedupCorpusSearch[] = [
  DEDUP_CORPUS_Q1,
  DEDUP_CORPUS_Q2,
  DEDUP_CORPUS_Q3,
  DEDUP_CORPUS_Q4,
  DEDUP_CORPUS_Q5,
];

/**
 * Which searches each searchable source runs — Part A's table
 * (`P2-T13-partA.md` §8). arXiv runs Q2–Q4 and the series probe only (Q1 and
 * Q5 are biomedical); the Korean probe was planned for Crossref and Semantic
 * Scholar. Semantic Scholar's row holds Q1 only: the rest is
 * {@link DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR}.
 * bioRxiv and medRxiv have no keyword search (`docs/02` §8.4); their corpus
 * scenarios are DOI lookups in `biorxivRecordedRequests.ts`.
 */
export const DEDUP_CORPUS_SEARCHES = {
  pubmed: [
    ...DEDUP_CORPUS_QUERIES,
    DEDUP_CORPUS_PROBE_SHORT_TITLE,
    DEDUP_CORPUS_PROBE_SERIES,
  ],
  europepmc: [
    ...DEDUP_CORPUS_QUERIES,
    DEDUP_CORPUS_PROBE_SHORT_TITLE,
    DEDUP_CORPUS_PROBE_SERIES,
  ],
  crossref: [
    ...DEDUP_CORPUS_QUERIES,
    DEDUP_CORPUS_PROBE_SHORT_TITLE,
    DEDUP_CORPUS_PROBE_SERIES,
    DEDUP_CORPUS_PROBE_KOREAN,
  ],
  arxiv: [
    DEDUP_CORPUS_Q2,
    DEDUP_CORPUS_Q3,
    DEDUP_CORPUS_Q4,
    DEDUP_CORPUS_PROBE_SERIES,
  ],
  // Q1 only: see DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR.
  semanticscholar: [DEDUP_CORPUS_Q1],
} as const satisfies Readonly<Record<string, readonly DedupCorpusSearch[]>>;

/**
 * Semantic Scholar's corpus searches that were **planned but not sent**.
 * Measured 2026-10-15 21:15 UTC to 2026-10-16 01:29 UTC: the anonymous pool
 * answered HTTP 429 to all five Semantic Scholar requests of this recording —
 * `corpus-q1` four times (21:15, 21:37, 22:23, 01:29 UTC) and `corpus-batch`
 * once — so the remaining five searches were not sent, to keep the 85-request
 * budget for nothing that could not land. `corpus-q1` and `corpus-batch` are
 * committed as those measured 429 answers, the way `relevance-search` was
 * (`P2-T05`).
 *
 * **Tried again 2026-10-16, still refused.** The owner approved up to 7 more
 * Semantic Scholar requests (`plan/00` §6 item 223), with the rule "two
 * consecutive 429 answers stop Semantic Scholar". The five searches were moved
 * into {@link DEDUP_CORPUS_SEARCHES}' row and one request was sent per run:
 * `corpus-batch` at 03:34:07 UTC and `corpus-q1` at 03:34:28 UTC both
 * answered 429, so the other five were not sent and are back here. The two
 * re-recorded 429 answers are the committed `corpus-batch` and `corpus-q1`.
 */
export const DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR: readonly DedupCorpusSearch[] =
  [
    DEDUP_CORPUS_Q2,
    DEDUP_CORPUS_Q3,
    DEDUP_CORPUS_Q4,
    DEDUP_CORPUS_Q5,
    DEDUP_CORPUS_PROBE_KOREAN,
  ];

/**
 * The `SourceQuery` the pipeline hands an adapter for `search` — the same
 * three steps the product takes (see the file header).
 *
 * @param search - one of the searches above
 * @returns a fresh query each call
 */
export function dedupCorpusQuery(search: DedupCorpusSearch): SourceQuery {
  return {
    terms: parseUserQuery(search.text),
    limit: search.limit,
    fromDate: search.fromDate,
    toDate: search.toDate,
  };
}
