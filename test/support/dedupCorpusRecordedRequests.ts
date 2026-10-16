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

// ---------------------------------------------------------------------------
// Targeted recording (owner's decision, 2026-10-16, `plan/00` §6 item 226)
// ---------------------------------------------------------------------------
//
// After the shared queries, four step-3 families were still short: the
// `10.64898/` pairs (0 of 5), series titles (1 of 5), same title in another
// year and journal (3 of 5) and same-paper sets from three or more sources
// (5 of 10). The owner approved at most 35 more unkeyed requests, Semantic
// Scholar left out. Each search below names the family it is for, and each is
// text a user could type, parsed by `parseUserQuery` like the shared queries.

/**
 * The preprint searches' closed window: August and September 2026. `docs/02`
 * §11.2's `10.64898/` examples are July–September 2026 postings, while a
 * `10.1101/` DOI was still seen for an April 2025 posting, so a window after
 * the change is the one that can return the new prefix.
 */
export const DEDUP_CORPUS_PREPRINT_WINDOW = {
  fromDate: "2026-08-01",
  toDate: "2026-09-30",
} as const;

/**
 * Europe PMC preprints posted on bioRxiv in the window (`10.64898/` family).
 *
 * **Not `SRC:PPR`.** `docs/02` §11.2's measured query was
 * `(SRC:PPR) AND (PUBLISHER:"medRxiv")`, but the shipped renderer quotes every
 * term value and has no `SRC` or `PUBLISHER` prefix, and its `raw` passthrough
 * adds parameters without touching `query=` (`src/sources/europepmc/query.ts`
 * header), so neither clause can be sent through the adapter. The bare word is
 * what the adapter can send: the committed `record-preprint` answer shows an
 * unfielded `"bioRxiv"` matching `PPR` records whose publisher is bioRxiv.
 * Which server a DOI is then looked up on is read from each `PPR` record's own
 * `bookOrReportDetails.publisher` (`biorxivRecordedRequests.ts`), never from
 * this search's word and never from the DOI prefix.
 *
 * **Measured 2026-10-16 04:15 UTC: the bare word does not reach the `PPR`
 * records first.** All 25 results of each search are `PMC` records — NIH-funded
 * preprints deposited in PubMed Central, journal title "bioRxiv : the preprint
 * server for biology" / "medRxiv" — and none carries a DOI (hit counts 11 098
 * and 3 392). Kept as recorded; {@link DEDUP_CORPUS_PPR_BIORXIV} excludes that
 * journal title.
 */
export const DEDUP_CORPUS_PREPRINTS_BIORXIV: DedupCorpusSearch = {
  scenario: "corpus-preprints-biorxiv",
  text: "bioRxiv",
  ...DEDUP_CORPUS_PREPRINT_WINDOW,
  limit: DEDUP_CORPUS_LIMIT,
};
/** As {@link DEDUP_CORPUS_PREPRINTS_BIORXIV}, for medRxiv. */
export const DEDUP_CORPUS_PREPRINTS_MEDRXIV: DedupCorpusSearch = {
  scenario: "corpus-preprints-medrxiv",
  text: "medRxiv",
  ...DEDUP_CORPUS_PREPRINT_WINDOW,
  limit: DEDUP_CORPUS_LIMIT,
};

/**
 * The bare word with the PubMed Central deposits excluded by their journal
 * title: `"bioRxiv" NOT JOURNAL:"bioRxiv"`. A `PPR` record has no journal, so
 * the exclusion can only drop journal records. Still not `SRC:PPR` (see
 * {@link DEDUP_CORPUS_PREPRINTS_BIORXIV}).
 */
export const DEDUP_CORPUS_PPR_BIORXIV: DedupCorpusSearch = {
  scenario: "corpus-ppr-biorxiv",
  text: "bioRxiv NOT journal:bioRxiv",
  ...DEDUP_CORPUS_PREPRINT_WINDOW,
  limit: DEDUP_CORPUS_LIMIT,
};
/** As {@link DEDUP_CORPUS_PPR_BIORXIV}, for medRxiv. */
export const DEDUP_CORPUS_PPR_MEDRXIV: DedupCorpusSearch = {
  scenario: "corpus-ppr-medrxiv",
  text: "medRxiv NOT journal:medRxiv",
  ...DEDUP_CORPUS_PREPRINT_WINDOW,
  limit: DEDUP_CORPUS_LIMIT,
};

/**
 * Two known series whose parts differ only by a trailing marker (series-title
 * family), each part also a same-paper set across PubMed, Europe PMC and
 * Crossref:
 * - W. D. Hamilton, "The genetical evolution of social behaviour. I" and
 *   "… II" (J Theor Biol 1964) — a roman numeral;
 * - "UniProt: the universal protein knowledgebase in 2021" and "… in 2023"
 *   (Nucleic Acids Res) — a trailing year. Both years are named in the
 *   phrases so that the other yearly updates stay out.
 */
export const DEDUP_CORPUS_SERIES_KNOWN: DedupCorpusSearch = {
  scenario: "corpus-series-known",
  text:
    'title:"genetical evolution of social behaviour" OR ' +
    'title:"universal protein knowledgebase in 2021" OR ' +
    'title:"universal protein knowledgebase in 2023"',
  ...years(1964, 2023),
  limit: DEDUP_CORPUS_LIMIT,
};

/**
 * Four well-known papers by exact title (same-paper sets). The first two also
 * have a conference version with the same title in an earlier year (same
 * title, different year, different journal): "Focal loss for dense object
 * detection" (ICCV 2017, IEEE TPAMI 2020) and "Spatial pyramid pooling in deep
 * convolutional networks for visual recognition" (ECCV 2014, IEEE TPAMI
 * 2015). The other two are AlphaFold 2 (Nature 2021) and DESeq2 (Genome Biol
 * 2014, with its 2014 bioRxiv preprint).
 */
export const DEDUP_CORPUS_KNOWN_PAPERS: DedupCorpusSearch = {
  scenario: "corpus-known-papers",
  text:
    'title:"Focal loss for dense object detection" OR ' +
    'title:"Spatial pyramid pooling in deep convolutional networks for visual recognition" OR ' +
    'title:"Highly accurate protein structure prediction with AlphaFold" OR ' +
    'title:"Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2"',
  ...years(2014, 2021),
  limit: DEDUP_CORPUS_LIMIT,
};

/**
 * PubMed's form of {@link DEDUP_CORPUS_SERIES_KNOWN}: title words joined by
 * AND instead of quoted phrases.
 *
 * **Why.** Measured 2026-10-16 04:19 UTC: E-utilities answered both
 * quoted-phrase searches with `count: 0` and every phrase listed under
 * `warninglist.quotedphrasesnotfound` — the long phrases are not in PubMed's
 * phrase index, although the papers are in PubMed (Europe PMC's `MED` records
 * carry their PMIDs). The two zero answers stay recorded
 * ({@link DEDUP_CORPUS_PUBMED_NO_RECORDS}); these word searches follow them.
 */
export const DEDUP_CORPUS_SERIES_WORDS: DedupCorpusSearch = {
  scenario: "corpus-series-words",
  text:
    "(title:genetical AND title:social AND title:behaviour) OR " +
    "(title:UniProt AND title:knowledgebase AND title:2021) OR " +
    "(title:UniProt AND title:knowledgebase AND title:2023)",
  ...years(1964, 2023),
  limit: DEDUP_CORPUS_LIMIT,
};

/** PubMed's form of {@link DEDUP_CORPUS_KNOWN_PAPERS}; see {@link DEDUP_CORPUS_SERIES_WORDS}. */
export const DEDUP_CORPUS_KNOWN_WORDS: DedupCorpusSearch = {
  scenario: "corpus-known-words",
  text:
    "(title:focal AND title:loss AND title:dense AND title:object AND title:detection) OR " +
    "(title:spatial AND title:pyramid AND title:pooling AND title:visual AND title:recognition) OR " +
    "(title:AlphaFold AND title:highly AND title:accurate) OR " +
    "(title:DESeq2 AND title:moderated AND title:dispersion)",
  ...years(2014, 2021),
  limit: DEDUP_CORPUS_LIMIT,
};

/**
 * PubMed corpus searches whose recorded `esearch` found no record, so no
 * `efetch` follows them — each other PubMed corpus search has both fixtures.
 */
export const DEDUP_CORPUS_PUBMED_NO_RECORDS: readonly DedupCorpusSearch[] = [
  DEDUP_CORPUS_SERIES_KNOWN,
  DEDUP_CORPUS_KNOWN_PAPERS,
];

/** The page size of Crossref's one-title searches: the paper and a few near titles. */
export const DEDUP_CORPUS_TITLE_LIMIT = 5;

/**
 * Crossref has no Boolean operators (`docs/02` §12.2: "Terms are scored, not
 * filtered"), so the OR of titles above would become one bag of words.
 * Crossref is asked one title at a time instead, each over its paper's years.
 */
export const DEDUP_CORPUS_CROSSREF_TITLES: readonly DedupCorpusSearch[] = [
  {
    scenario: "corpus-title-hamilton",
    text: 'title:"The genetical evolution of social behaviour"',
    ...years(1964, 1964),
    limit: DEDUP_CORPUS_TITLE_LIMIT,
  },
  {
    scenario: "corpus-title-uniprot",
    text: 'title:"UniProt: the universal protein knowledgebase"',
    ...years(2021, 2023),
    limit: DEDUP_CORPUS_TITLE_LIMIT,
  },
  {
    scenario: "corpus-title-focal-loss",
    text: 'title:"Focal loss for dense object detection"',
    ...years(2017, 2020),
    limit: DEDUP_CORPUS_TITLE_LIMIT,
  },
  {
    scenario: "corpus-title-spp",
    text: 'title:"Spatial pyramid pooling in deep convolutional networks for visual recognition"',
    ...years(2014, 2015),
    limit: DEDUP_CORPUS_TITLE_LIMIT,
  },
  {
    scenario: "corpus-title-alphafold",
    text: 'title:"Highly accurate protein structure prediction with AlphaFold"',
    ...years(2021, 2021),
    limit: DEDUP_CORPUS_TITLE_LIMIT,
  },
  {
    scenario: "corpus-title-deseq2",
    text: 'title:"Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2"',
    ...years(2014, 2014),
    limit: DEDUP_CORPUS_TITLE_LIMIT,
  },
];

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
 * {@link DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR}. The targeted searches of
 * 2026-10-16 (item 226) follow the probes: PubMed and Europe PMC run the two
 * known-title searches, Europe PMC also the two preprint searches, Crossref
 * one search per title ({@link DEDUP_CORPUS_CROSSREF_TITLES}), and arXiv the
 * known-papers search.
 * bioRxiv and medRxiv have no keyword search (`docs/02` §8.4); their corpus
 * scenarios are DOI lookups in `biorxivRecordedRequests.ts`.
 */
export const DEDUP_CORPUS_SEARCHES = {
  pubmed: [
    ...DEDUP_CORPUS_QUERIES,
    DEDUP_CORPUS_PROBE_SHORT_TITLE,
    DEDUP_CORPUS_PROBE_SERIES,
    DEDUP_CORPUS_SERIES_KNOWN,
    DEDUP_CORPUS_KNOWN_PAPERS,
    DEDUP_CORPUS_SERIES_WORDS,
    DEDUP_CORPUS_KNOWN_WORDS,
  ],
  europepmc: [
    ...DEDUP_CORPUS_QUERIES,
    DEDUP_CORPUS_PROBE_SHORT_TITLE,
    DEDUP_CORPUS_PROBE_SERIES,
    DEDUP_CORPUS_PREPRINTS_BIORXIV,
    DEDUP_CORPUS_PREPRINTS_MEDRXIV,
    DEDUP_CORPUS_SERIES_KNOWN,
    DEDUP_CORPUS_KNOWN_PAPERS,
    DEDUP_CORPUS_PPR_MEDRXIV,
    DEDUP_CORPUS_PPR_BIORXIV,
  ],
  crossref: [
    ...DEDUP_CORPUS_QUERIES,
    DEDUP_CORPUS_PROBE_SHORT_TITLE,
    DEDUP_CORPUS_PROBE_SERIES,
    DEDUP_CORPUS_PROBE_KOREAN,
    ...DEDUP_CORPUS_CROSSREF_TITLES,
  ],
  arxiv: [
    DEDUP_CORPUS_Q2,
    DEDUP_CORPUS_Q3,
    DEDUP_CORPUS_Q4,
    DEDUP_CORPUS_PROBE_SERIES,
    DEDUP_CORPUS_KNOWN_PAPERS,
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
