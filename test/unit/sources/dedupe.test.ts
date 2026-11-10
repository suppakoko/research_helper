import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { OperationCancelledError } from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { WorkType } from "../../../src/model/canonicalWork";
import {
  doiFamilyStem,
  isPerVersionReviewDoi,
  isReviewDocumentDoi,
  normalizeArxivId,
  sameDoiFamily,
  type ArxivId,
  type Doi,
  type ExternalIds,
  type Pmcid,
  type Pmid,
  type S2CorpusId,
  type SourceId,
} from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  BIORXIV_ACCESSION_PREFIXES,
  biorxivAccession,
  blockingSignature,
  buildLibraryIndex,
  compareRecords,
  DEDUP_TIERS,
  DEDUP_YIELD_EVERY_COMPARISONS,
  dedupeRecords,
  dedupeRecordsAsync,
  defaultYieldToEventLoop,
  isPreprintDoi,
  JACCARD_CORROBORATED_THRESHOLD,
  JACCARD_REORDER_THRESHOLD,
  jaccard,
  LEVSIM_CORROBORATED_THRESHOLD,
  LEVSIM_DUPLICATE_THRESHOLD,
  LEVSIM_FLAG_THRESHOLD,
  levenshtein,
  levSim,
  matchAgainstLibrary,
  MAX_YEAR_DELTA,
  MIN_FUZZY_TITLE_TOKENS,
  normalizeFamilyName,
  normalizeTitle,
  PREPRINT_DOI_PREFIXES,
  SIGNATURE_TOKEN_COUNT,
  TIER_CONFIDENCE,
  titleNumbers,
  titleTokens,
  toCandidate,
  type DedupDecision,
  type LibraryItemFields,
} from "../../../src/sources/shared/dedupe";

/**
 * `P2-T09`. Layer 1 (docs/13 §2.1): plain Node, no Zotero, no network.
 *
 * Every tier of `docs/02` §11.3's table has a real fixture pair below; the
 * identifier spellings are the ones §11.1 and §11.3.1 record from live
 * probes (OpenAlex's resolver URL, Semantic Scholar's uppercase DOI suffix
 * and bare PMCID, bioRxiv's two prefixes), and the title pair is §11.3.2's
 * PubMed-versus-Semantic-Scholar case.
 */

interface Spec {
  readonly id?: string;
  readonly source?: SourceId;
  readonly title: string;
  readonly year?: number;
  readonly ids?: ExternalIds;
  readonly authors?: readonly string[];
  readonly container?: string;
  readonly type?: WorkType;
  readonly related?: ExternalIds;
}

let serial = 0;

/** A minimal `SourceRecord`; branded ids are cast because a mapper would have. */
function record(spec: Spec): SourceRecord {
  serial += 1;
  const source = spec.source ?? "pubmed";
  const nativeId = spec.id ?? `n${serial}`;
  return {
    id: `${source}:${nativeId}`,
    sourceId: source,
    nativeId,
    work: {
      ids: spec.ids ?? {},
      type: spec.type ?? "journal-article",
      title: spec.title,
      authors: (spec.authors ?? []).map((family) => ({ family })),
      ...(spec.year !== undefined && {
        publishedDate: { year: spec.year, iso: String(spec.year) },
      }),
      ...(spec.container !== undefined && { containerTitle: spec.container }),
      ...(spec.related !== undefined && { relatedVersionIds: spec.related }),
    },
    retrievedAtEpochMs: 0,
    missingFields: [],
  };
}

const doi = (s: string): Doi => s as Doi;
const pmid = (s: string): Pmid => s as Pmid;
const pmcid = (s: string): Pmcid => s as Pmcid;
const arxiv = (s: string): ArxivId => s as ArxivId;
const s2 = (s: string): S2CorpusId => s as S2CorpusId;

/** §11.3.2's real pair, both spellings. */
const PUBMED_TITLE =
  "Transfer learning enables predictions in network biology.";
const S2_TITLE = "Transfer learning enables predictions in network biology";

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

describe("normalizeTitle (docs/02 §11.3.2)", () => {
  it("makes PubMed's trailing-period title equal Semantic Scholar's", () => {
    expect(normalizeTitle(PUBMED_TITLE)).toBe(normalizeTitle(S2_TITLE));
    expect(normalizeTitle(PUBMED_TITLE)).toBe(
      "transfer learning enables predictions in network biology",
    );
  });

  it("drops accents via NFKD and combining-mark removal", () => {
    expect(normalizeTitle("Müller–Lyer illusion in naïve observers")).toBe(
      "muller lyer illusion in naive observers",
    );
  });

  it("strips JATS/HTML tags and entities", () => {
    expect(
      normalizeTitle("<i>In vivo</i> imaging of &beta;-cells &amp; islets"),
    ).toBe("in vivo imaging of cells islets");
  });

  it("maps unicode dashes and smart quotes before the punctuation pass", () => {
    expect(normalizeTitle("‘Smart’ “quotes” — and a minus − sign")).toBe(
      "smart quotes and a minus sign",
    );
  });

  it("collapses whitespace and lowercases", () => {
    expect(normalizeTitle("  Deep   LEARNING\tfor\nProteins ")).toBe(
      "deep learning for proteins",
    );
  });
});

describe("normalizeArxivId (docs/02 §11.3.1, added to model/ids)", () => {
  it("strips the arXiv: scheme and the version", () => {
    expect(normalizeArxivId("arXiv:2106.15928v2")).toBe("2106.15928");
  });

  it("strips the abs/ and pdf/ URL forms and a .pdf extension", () => {
    expect(normalizeArxivId("https://arxiv.org/abs/2106.15928v1")).toBe(
      "2106.15928",
    );
    expect(normalizeArxivId("https://arxiv.org/pdf/2106.15928.pdf")).toBe(
      "2106.15928",
    );
  });

  it("accepts old-style ids with and without a subject class", () => {
    expect(normalizeArxivId("math.GT/0309136")).toBe("math.GT/0309136");
    expect(normalizeArxivId("hep-th/9901001v3")).toBe("hep-th/9901001");
  });

  it("returns null for non-ids, null and undefined", () => {
    expect(normalizeArxivId("10.1101/2025.09.17.676679")).toBeNull();
    expect(normalizeArxivId("")).toBeNull();
    expect(normalizeArxivId(null)).toBeNull();
    expect(normalizeArxivId(undefined)).toBeNull();
  });
});

describe("normalizeFamilyName", () => {
  it("folds case, accents and particles", () => {
    expect(normalizeFamilyName("Müller")).toBe("muller");
    expect(normalizeFamilyName("MULLER")).toBe("muller");
    expect(normalizeFamilyName("van der Berg")).toBe("vanderberg");
    expect(normalizeFamilyName("O'Brien")).toBe("obrien");
  });

  it("is undefined for nothing", () => {
    expect(normalizeFamilyName(undefined)).toBeUndefined();
    expect(normalizeFamilyName("  ")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Similarity measures and blocking
// ---------------------------------------------------------------------------

describe("levenshtein / levSim / jaccard (docs/02 §11.3.3)", () => {
  it("computes the standard edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("normalizes by the longer string", () => {
    expect(levSim("kitten", "sitting")).toBeCloseTo(1 - 3 / 7, 10);
    expect(levSim("", "")).toBe(1);
  });

  it("is Jaccard over distinct tokens", () => {
    expect(jaccard(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(0.5, 10);
    expect(jaccard(["a", "a"], ["a"])).toBe(1);
    expect(jaccard([], [])).toBe(1);
  });
});

describe("blockingSignature", () => {
  it("is the three longest distinct tokens, alphabetically", () => {
    const tokens = normalizeTitle(S2_TITLE).split(" ");
    expect(blockingSignature(tokens)).toBe("learning predictions transfer");
  });

  it("is stable under reordering and under short-word changes", () => {
    const a = normalizeTitle(
      "Transfer learning enables predictions in network biology",
    );
    const b = normalizeTitle(
      "Predictions in network biology: transfer learning enables them",
    );
    expect(blockingSignature(a.split(" "))).toBe(
      blockingSignature(b.split(" ")),
    );
  });

  it("is undefined for a title below the short-title floor", () => {
    expect(blockingSignature(["retraction"])).toBeUndefined();
    expect(blockingSignature(["a", "b", "c", "d"])).toBeUndefined();
  });

  it("uses SIGNATURE_TOKEN_COUNT tokens", () => {
    const sig = blockingSignature(["aaaa", "bbbb", "cccc", "dddd", "eeee"]);
    expect(sig?.split(" ")).toHaveLength(SIGNATURE_TOKEN_COUNT);
  });
});

// ---------------------------------------------------------------------------
// The cascade, tier by tier — docs/02 §11.3's table
// ---------------------------------------------------------------------------

describe("DEDUP_TIERS is the §11.3 table, in order", () => {
  it("lists the eight tiers with their doc numbers", () => {
    expect(DEDUP_TIERS.map((t) => [t.id, t.docTier])).toEqual([
      ["doi", 0],
      ["pmid", 1],
      ["pmcid", 2],
      ["arxiv", 3],
      ["s2", 4],
      ["title-exact", 5],
      ["title-fuzzy", 6],
      ["version-link", 7],
    ]);
  });
});

describe("Tier 0 — exact normalized DOI", () => {
  it("matches OpenAlex's resolver URL against Crossref's bare DOI", () => {
    const a = record({
      source: "crossref",
      title: "Tirzepatide once weekly for the treatment of obesity",
      ids: { doi: doi("10.1056/NEJMoa2300709") },
    });
    const b = record({
      source: "europepmc",
      title: "Tirzepatide once weekly for the treatment of obesity",
      ids: { doi: doi("https://doi.org/10.1056/nejmoa2300709") },
    });
    const d = compareRecords(a, b);
    expect(d).toMatchObject({ verdict: "match", tier: "doi", confidence: 1 });
    expect(d.evidence["doi"]).toBe("10.1056/nejmoa2300709");
  });

  it("matches Semantic Scholar's uppercase suffix against Crossref's lowercase", () => {
    const a = record({
      source: "semanticscholar",
      title: "A primer in BERTology: what we know about how BERT works",
      ids: { doi: doi("10.18653/V1/2020.ACL-MAIN.447") },
    });
    const b = record({
      source: "crossref",
      title: "A Primer in BERTology: What We Know About How BERT Works",
      ids: { doi: doi("10.18653/v1/2020.acl-main.447") },
    });
    expect(compareRecords(a, b).verdict).toBe("match");
    expect(compareRecords(a, b).tier).toBe("doi");
  });

  it("matches the same bioRxiv accession across the two live prefixes (§11.2)", () => {
    const a = record({
      source: "biorxiv",
      title: "Short",
      type: "preprint",
      ids: { doi: doi("10.1101/2025.09.17.676679") },
    });
    const b = record({
      source: "europepmc",
      title: "Short",
      type: "preprint",
      ids: { doi: doi("10.64898/2025.09.17.676679") },
    });
    const d = compareRecords(a, b);
    expect(d).toMatchObject({
      verdict: "match",
      tier: "doi",
      confidence: TIER_CONFIDENCE.biorxivAccession,
    });
    expect(d.evidence["rule"]).toBe("biorxiv-accession");
    expect(d.evidence["accession"]).toBe("2025.09.17.676679");
  });

  it("does not use the accession key outside the bioRxiv prefixes", () => {
    expect(biorxivAccession(doi("10.48550/arxiv.2106.15928"))).toBeUndefined();
    expect(biorxivAccession(doi("10.1056/nejmoa2300709"))).toBeUndefined();
    expect(biorxivAccession(doi("10.64898/2026.08.20.745440"))).toBe(
      "2026.08.20.745440",
    );
    expect(biorxivAccession(undefined)).toBeUndefined();
  });

  it("does not match two different DOIs, and records the conflict", () => {
    const a = record({
      title: "Alpha beta gamma delta epsilon zeta",
      ids: { doi: doi("10.64898/2026.08.20.745440") },
    });
    const b = record({
      title: "Completely unrelated words here now please",
      ids: { doi: doi("10.64898/2026.07.31.741992") },
    });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("distinct");
    expect(d.tier).toBeNull();
    expect(d.evidence["conflictingIds"]).toBe("doi");
  });
});

// ---------------------------------------------------------------------------
// P2-T38 — the documents of one paper are one work (owner, 2026-11-10,
// plan/00 §6 item 362(b); docs/02 §11.3's note of that date). The DOIs and
// titles are the corpus records of the eleven pairs the owner labelled.
// ---------------------------------------------------------------------------

const NK_TITLE =
  "NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis";
const ATLAS_TITLE =
  "Spatial transcriptomics and single-nucleus RNA sequencing reveal a transcriptomic atlas of adult human spinal cord";
const LEISH_TITLE =
  "Gene editing and scalable functional genomic screening in Leishmania species using the CRISPR/Cas9 cytosine base editor toolbox LeishBASEedit";
const ASHWA_V1 =
  "Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study";
const ASHWA_V2 = ASHWA_V1.replace("preforming", "performing");
const REPORT_V1 = `Peer Review Report For: ${ASHWA_V1} [version 1; peer review: 1 approved with reservations, 1 not approved]`;
const REPORT_V2 = `Peer Review Report For: ${ASHWA_V2} [version 2; peer review: 1 approved, 2 approved with reservations]`;

/** A Crossref record carrying one DOI, as the corpus's review records do. */
function crossref(
  doiText: string,
  title: string,
  year: number,
  type: WorkType = "other",
): SourceRecord {
  return record({
    source: "crossref",
    id: doiText,
    title,
    year,
    type,
    ids: { doi: doi(doiText) },
  });
}

describe("P2-T38 — the DOI forms of docs/02 §11.3's table", () => {
  it.each([
    ["10.7554/elife.98867.1.sa1", "10.7554/elife.98867", true, false],
    ["10.7554/elife.85605.sa2", "10.7554/elife.85605", true, false],
    [
      "10.1111/2041-210x.14397/v1/review2",
      "10.1111/2041-210x.14397",
      true,
      false,
    ],
    ["10.3410/f.740477161.793587507", "10.3410/f.740477161", true, false],
    [
      "10.5256/f1000research.143730.r200814",
      "10.5256/f1000research.143730",
      true,
      true,
    ],
    [
      "10.12688/f1000research.130932.2",
      "10.12688/f1000research.130932",
      false,
      false,
    ],
  ])("%s reduces to %s", (text, stem, review, perVersion) => {
    expect(doiFamilyStem(doi(text))).toBe(stem);
    expect(isReviewDocumentDoi(doi(text))).toBe(review);
    expect(isPerVersionReviewDoi(doi(text))).toBe(perVersion);
  });

  it.each([
    // An eLife version DOI without `.sa` is deliberately not a form (G-16).
    "10.7554/elife.98867.3",
    "10.7554/elife.85605",
    // The F1000 platform's sibling journals are not listed.
    "10.12688/wellcomeopenres.17555.2",
    "10.5256/wellcomeopenres.19349.r50001",
    "10.1056/nejmoa2300709",
  ])("%s is of no listed form", (text) => {
    expect(doiFamilyStem(doi(text))).toBeUndefined();
    expect(isReviewDocumentDoi(doi(text))).toBe(false);
  });

  it("a DOI of no listed form is its own stem; equal or absent DOIs are no family", () => {
    expect(
      sameDoiFamily(doi("10.7554/elife.85605"), doi("10.7554/elife.85605.sa2")),
    ).toBe(true);
    expect(
      sameDoiFamily(
        doi("10.1111/2041-210x.14397"),
        doi("10.1111/2041-210x.14397/v1/review1"),
      ),
    ).toBe(true);
    expect(
      sameDoiFamily(
        doi("10.7554/elife.85605.sa2"),
        doi("10.7554/elife.85605.sa2"),
      ),
    ).toBe(false);
    expect(sameDoiFamily(doi("10.7554/elife.85605.sa2"), undefined)).toBe(
      false,
    );
    expect(
      sameDoiFamily(doi("10.1056/nejmoa2300709"), doi("10.1056/nejmoa2300710")),
    ).toBe(false);
  });
});

describe("P2-T38 rule 1 — Tier 0's DOI family merges the reviews and versions of one paper", () => {
  it.each([
    [
      "two eLife reviewer reports of one version (p-6caef4b71a46)",
      crossref(
        "10.7554/elife.92046.2.sa2",
        `Reviewer #2 (Public Review): ${ATLAS_TITLE}`,
        2024,
      ),
      crossref(
        "10.7554/elife.92046.2.sa3",
        `Reviewer #3 (Public Review): ${ATLAS_TITLE}`,
        2024,
      ),
    ],
    [
      "one eLife reviewer across versions 1 and 3 (p-3a7cc467c9f3)",
      crossref(
        "10.7554/elife.98867.1.sa0",
        `Reviewer #2 (Public Review): ${NK_TITLE}`,
        2024,
      ),
      crossref(
        "10.7554/elife.98867.3.sa1",
        `Reviewer #2 (Public review): ${NK_TITLE.toLowerCase()}`,
        2024,
      ),
    ],
    [
      "an eLife article and its author response (p-136a40c667ec)",
      crossref("10.7554/elife.85605", LEISH_TITLE, 2023, "journal-article"),
      crossref(
        "10.7554/elife.85605.sa2",
        `Author response: ${LEISH_TITLE}`,
        2023,
      ),
    ],
    [
      "two transparent peer review reports of one article (p-940c511c1fe1)",
      crossref(
        "10.1111/2041-210x.14397/v1/review1",
        'Review for "Pressure to publish introduces large‐language model risks"',
        2024,
      ),
      crossref(
        "10.1111/2041-210x.14397/v1/review2",
        'Review for "Pressure to publish introduces large‐language model risks"',
        2024,
      ),
    ],
    [
      "two Faculty Opinions recommendations of one article (p-5671166c13d8)",
      crossref(
        "10.3410/f.740477161.793587507",
        "Faculty Opinions recommendation of Highly accurate protein structure prediction with AlphaFold.",
        2021,
        "dataset",
      ),
      crossref(
        "10.3410/f.740477161.793587604",
        "Faculty Opinions recommendation of Highly accurate protein structure prediction with AlphaFold.",
        2021,
        "dataset",
      ),
    ],
    [
      "two F1000Research reports on version 1 (p-f446658730ea)",
      crossref("10.5256/f1000research.143730.r200814", REPORT_V1, 2023),
      crossref("10.5256/f1000research.143730.r219543", REPORT_V1, 2023),
    ],
    [
      "F1000Research versions 1 and 2 (p-770263a3b79f)",
      crossref(
        "10.12688/f1000research.130932.1",
        ASHWA_V1,
        2023,
        "journal-article",
      ),
      crossref(
        "10.12688/f1000research.130932.2",
        ASHWA_V2,
        2024,
        "journal-article",
      ),
    ],
    [
      "F1000Research version 1 and Europe PMC's preprint record of version 2 (p-1714f98efd0e)",
      crossref(
        "10.12688/f1000research.130932.1",
        ASHWA_V1,
        2023,
        "journal-article",
      ),
      record({
        source: "europepmc",
        id: "PPR/PPR834057",
        title: ASHWA_V2,
        year: 2024,
        type: "preprint",
        ids: { doi: doi("10.12688/f1000research.130932.2") },
      }),
    ],
  ])("%s", (_, a, b) => {
    for (const d of [compareRecords(a, b), compareRecords(b, a)]) {
      expect(d).toMatchObject({
        verdict: "match",
        tier: "doi",
        confidence: TIER_CONFIDENCE.doiFamily,
      });
      expect(d.evidence["rule"]).toBe("doi-family");
    }
    expect(dedupeRecords([a, b]).groups).toHaveLength(1);
  });

  it("names the family stem in the evidence", () => {
    const d = compareRecords(
      crossref(
        "10.7554/elife.98867.1.sa1",
        `Reviewer #1 (Public Review): ${NK_TITLE}`,
        2024,
      ),
      crossref(
        "10.7554/elife.98867.2.sa1",
        `Reviewer #2 (Public review): ${NK_TITLE}`,
        2024,
      ),
    );
    expect(d.evidence["family"]).toBe("10.7554/elife.98867");
  });

  it("does not merge the reviews of two different eLife papers, even under one title (negative)", () => {
    // One journal DOI prefix, two articles: the stems differ, the DOI
    // conflict stands (§11.5 rule 1), so an identical title is a link.
    const a = crossref(
      "10.7554/elife.92046.2.sa2",
      `Reviewer #2 (Public Review): ${ATLAS_TITLE}`,
      2024,
    );
    const b = crossref(
      "10.7554/elife.98867.1.sa0",
      `Reviewer #2 (Public Review): ${ATLAS_TITLE}`,
      2024,
    );
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("link");
    expect(d.evidence["conflictingIds"]).toBe("doi");
    expect(dedupeRecords([a, b]).groups).toHaveLength(2);
    const other = crossref(
      "10.7554/elife.98867.1.sa1",
      `Reviewer #1 (Public Review): ${NK_TITLE}`,
      2024,
    );
    expect(compareRecords(a, other).verdict).not.toBe("match");
  });

  it("does not merge the reviews of two different articles of one Wiley journal (negative)", () => {
    const a = crossref(
      "10.1002/eng2.12854/v1/review1",
      'Review for "Preserving node similarity adversarial learning graph representation with graph neural network"',
      2023,
    );
    const b = crossref(
      "10.1002/eng2.12999/v1/review1",
      'Review for "Preserving node similarity adversarial learning graph representation with graph neural network"',
      2023,
    );
    expect(compareRecords(a, b).verdict).toBe("link");
    expect(dedupeRecords([a, b]).groups).toHaveLength(2);
  });

  it("does not merge F1000Research articles with different base numbers (negative)", () => {
    const a = crossref(
      "10.12688/f1000research.130932.1",
      ASHWA_V1,
      2023,
      "journal-article",
    );
    const b = crossref(
      "10.12688/f1000research.131344.2",
      ASHWA_V1,
      2023,
      "journal-article",
    );
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("link");
    expect(d.evidence["conflictingIds"]).toBe("doi");
    expect(dedupeRecords([a, b]).groups).toHaveLength(2);
  });

  it("leaves two eLife version DOIs to §11.4's handling: no family without `.sa`", () => {
    const a = crossref("10.7554/elife.98867.1", NK_TITLE, 2024, "preprint");
    const b = crossref(
      "10.7554/elife.98867.3",
      NK_TITLE,
      2024,
      "journal-article",
    );
    const d = compareRecords(a, b);
    expect(d.verdict).not.toBe("match");
    expect(d.evidence["rule"]).not.toBe("doi-family");
  });

  it("joins an article, its reviews and its author response into one group, whatever the input order", () => {
    const records = [
      crossref(
        "10.7554/elife.85605.sa2",
        `Author response: ${LEISH_TITLE}`,
        2023,
      ),
      crossref("10.7554/elife.85605", LEISH_TITLE, 2023, "journal-article"),
      crossref(
        "10.7554/elife.85605.sa1",
        `Decision letter: ${LEISH_TITLE}`,
        2023,
      ),
      crossref(
        "10.7554/elife.92046.2.sa2",
        `Reviewer #2 (Public Review): ${ATLAS_TITLE}`,
        2024,
      ),
    ];
    for (const order of [records, [...records].reverse()]) {
      const sizes = dedupeRecords(order)
        .groups.map((g) => g.records.length)
        .sort();
      expect(sizes).toEqual([1, 3]);
    }
  });
});

describe("P2-T38 rule 2 — F1000Research reports on two versions are compared on the article's title", () => {
  it("merges the version 1 and version 2 reports of one article (p-f581335f8a55)", () => {
    const a = crossref("10.5256/f1000research.143730.r200814", REPORT_V1, 2023);
    const b = crossref("10.5256/f1000research.163630.r264045", REPORT_V2, 2024);
    for (const d of [compareRecords(a, b), compareRecords(b, a)]) {
      expect(d).toMatchObject({ verdict: "match", tier: "title-fuzzy" });
      expect(d.evidence["peerReviewReportsAcrossVersions"]).toBe(true);
      expect(d.evidence["conflictingIds"]).toBeUndefined();
    }
    expect(dedupeRecords([a, b]).groups).toHaveLength(1);
  });

  it("reads the full titles for any other pair: the same two titles under article DOIs stay a flag", () => {
    // Without rule 2 the version note keeps the pair under 0.95 (the corpus
    // measured 0.907 before P2-T38), and the DOIs conflict.
    const a = crossref("10.1234/one", REPORT_V1, 2023);
    const b = crossref("10.1234/two", REPORT_V2, 2024);
    expect(compareRecords(a, b).verdict).toBe("flag");
  });

  it("does not merge reports on two different articles (negative)", () => {
    const a = crossref("10.5256/f1000research.143730.r200814", REPORT_V1, 2023);
    const b = crossref(
      "10.5256/f1000research.163631.r264046",
      `Peer Review Report For: Effect of topical Zingiber cassumunar on painful diabetic neuropathy: a double-blind randomized-controlled trial [version 2; peer review: 2 approved]`,
      2024,
    );
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("distinct");
    expect(dedupeRecords([a, b]).groups).toHaveLength(2);
  });

  it("keeps every title guard: a version-2 report of a part II is not the part I's", () => {
    const partOne = `Peer Review Report For: Regional risk assessment of coastal flooding in three estuaries Part I [version 1; peer review: 2 approved]`;
    const partTwo = `Peer Review Report For: Regional risk assessment of coastal flooding in three estuaries Part II [version 2; peer review: 2 approved]`;
    const a = crossref("10.5256/f1000research.111111.r1", partOne, 2023);
    const b = crossref("10.5256/f1000research.222222.r2", partTwo, 2023);
    expect(compareRecords(a, b).verdict).toBe("distinct");
  });
});

describe("Tier 1 — exact PMID", () => {
  it("matches when only PubMed's PMID is shared (no DOI on one side)", () => {
    const a = record({
      source: "pubmed",
      title: PUBMED_TITLE,
      year: 2023,
      ids: { pmid: pmid("37258680") },
    });
    const b = record({
      source: "semanticscholar",
      title: S2_TITLE,
      year: 2023,
      ids: { pmid: pmid("PMID: 37258680") },
    });
    expect(compareRecords(a, b)).toMatchObject({
      verdict: "match",
      tier: "pmid",
      confidence: 1,
    });
  });
});

describe("Tier 2 — exact PMCID, with Semantic Scholar's bare form", () => {
  it("matches PubMed's PMC10949956 against S2's bare 10949956", () => {
    const a = record({
      source: "pubmed",
      title: "Anything at all",
      ids: { pmcid: pmcid("PMC10949956") },
    });
    const b = record({
      source: "semanticscholar",
      title: "Anything at all",
      ids: { pmcid: pmcid("10949956") },
    });
    const d = compareRecords(a, b);
    expect(d).toMatchObject({ verdict: "match", tier: "pmcid", confidence: 1 });
    expect(d.evidence["pmcid"]).toBe("PMC10949956");
  });
});

describe("Tier 3 — exact arXiv id, version-stripped", () => {
  it("matches arXiv:2106.15928v2 against 2106.15928", () => {
    const a = record({
      source: "arxiv",
      type: "preprint",
      title: "Evaluating large language models trained on code",
      ids: { arxivId: arxiv("arXiv:2106.15928v2") },
    });
    const b = record({
      source: "semanticscholar",
      type: "preprint",
      title: "Evaluating Large Language Models Trained on Code",
      ids: { arxivId: arxiv("2106.15928") },
    });
    expect(compareRecords(a, b)).toMatchObject({
      verdict: "match",
      tier: "arxiv",
      confidence: TIER_CONFIDENCE.arxiv,
    });
  });
});

describe("Tier 4 — exact S2 corpus id", () => {
  it("matches on s2CorpusId when nothing above it is present", () => {
    const a = record({
      source: "semanticscholar",
      title: "One title",
      ids: { s2CorpusId: s2("235755472") },
    });
    const b = record({
      source: "semanticscholar",
      title: "Another title entirely",
      ids: { s2CorpusId: s2(" 235755472 ") },
    });
    expect(compareRecords(a, b)).toMatchObject({
      verdict: "match",
      tier: "s2",
      confidence: TIER_CONFIDENCE.s2,
    });
  });
});

describe("Tier 5 — normalized title exact and |Δyear| ≤ 1", () => {
  it("matches §11.3.2's real PubMed / Semantic Scholar pair", () => {
    const a = record({ source: "pubmed", title: PUBMED_TITLE, year: 2023 });
    const b = record({
      source: "semanticscholar",
      title: S2_TITLE,
      year: 2023,
    });
    const d = compareRecords(a, b);
    expect(d).toMatchObject({
      verdict: "match",
      tier: "title-exact",
      confidence: TIER_CONFIDENCE.titleExact,
    });
    expect(d.evidence["yearDelta"]).toBe(0);
  });

  it("tolerates a one-year difference", () => {
    const a = record({ title: PUBMED_TITLE, year: 2023 });
    const b = record({ title: S2_TITLE, year: 2024 });
    expect(compareRecords(a, b).verdict).toBe("match");
  });

  it("flags, not matches, when the year is unknown on one side", () => {
    const a = record({ title: PUBMED_TITLE, year: 2023 });
    const b = record({ title: S2_TITLE });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("flag");
    expect(d.tier).toBe("title-exact");
    expect(d.evidence["yearDelta"]).toBe("unknown");
  });

  it("flags, not matches, when the years are more than one apart", () => {
    const a = record({ title: PUBMED_TITLE, year: 2021 });
    const b = record({ title: S2_TITLE, year: 2024 });
    expect(compareRecords(a, b).verdict).toBe("flag");
  });
});

describe("Tier 6 — the §11.3.3 threshold table", () => {
  const base =
    "Machine learning approaches for predicting protein structure from sequence";

  it("row 1: levSim ≥ 0.95 and |Δyear| ≤ 1 is a duplicate", () => {
    const a = record({ title: base, year: 2022, authors: ["Jumper"] });
    const b = record({
      title:
        "Machine learning approaches for predicting protein structure from sequences",
      year: 2023,
      authors: ["Someone Else"],
    });
    const d = compareRecords(a, b);
    expect(d.evidence["levSim"]).toBeGreaterThanOrEqual(
      LEVSIM_DUPLICATE_THRESHOLD,
    );
    expect(d).toMatchObject({
      verdict: "match",
      tier: "title-fuzzy",
      confidence: TIER_CONFIDENCE.fuzzyLevenshtein,
    });
    expect(d.evidence["rule"]).toBe("levenshtein");
  });

  it("row 1 needs |Δyear| ≤ 1: far-apart or unknown years are only a flag", () => {
    const near =
      "Machine learning approaches for predicting protein structure from sequences";
    const far = compareRecords(
      record({ title: base, year: 2020 }),
      record({ title: near, year: 2020 + MAX_YEAR_DELTA + 2 }),
    );
    expect(far.evidence["levSim"]).toBeGreaterThanOrEqual(
      LEVSIM_DUPLICATE_THRESHOLD,
    );
    expect(far.verdict).toBe("flag");
    const unknown = compareRecords(
      record({ title: base, year: 2020 }),
      record({ title: near }),
    );
    expect(unknown.verdict).toBe("flag");
    expect(unknown.evidence["yearDelta"]).toBe("unknown");
  });
  it("row 2: levSim ≥ 0.88, jaccard ≥ 0.80, same first author, |Δyear| ≤ 1", () => {
    const a = record({ title: base, year: 2022, authors: ["Jumper"] });
    const b = record({
      title:
        "Machine learning techniques for predicting protein structure from sequence",
      year: 2022,
      authors: ["JUMPER"],
    });
    const d = compareRecords(a, b);
    const lev = d.evidence["levSim"] as number;
    const jac = d.evidence["jaccard"] as number;
    expect(lev).toBeGreaterThanOrEqual(LEVSIM_CORROBORATED_THRESHOLD);
    expect(lev).toBeLessThan(LEVSIM_DUPLICATE_THRESHOLD);
    expect(jac).toBeGreaterThanOrEqual(JACCARD_CORROBORATED_THRESHOLD);
    expect(d).toMatchObject({
      verdict: "match",
      confidence: TIER_CONFIDENCE.fuzzyCorroborated,
    });
    expect(d.evidence["rule"]).toBe("corroborated");
  });

  it("row 2 without the author is only a flag", () => {
    const a = record({ title: base, year: 2022, authors: ["Jumper"] });
    const b = record({
      title:
        "Machine learning techniques for predicting protein structure from sequence",
      year: 2022,
      authors: ["Hassabis"],
    });
    expect(compareRecords(a, b).verdict).toBe("flag");
  });

  it("row 3: jaccard ≥ 0.90 with first author and same year catches reordering", () => {
    const a = record({
      title:
        "Protein structure prediction from sequence using deep learning methods",
      year: 2021,
      authors: ["Baek"],
    });
    const b = record({
      title:
        "Using deep learning methods: protein structure prediction from sequence",
      year: 2021,
      authors: ["Baek"],
    });
    const d = compareRecords(a, b);
    const lev = d.evidence["levSim"] as number;
    expect(lev).toBeLessThan(LEVSIM_CORROBORATED_THRESHOLD);
    expect(d.evidence["jaccard"]).toBeGreaterThanOrEqual(
      JACCARD_REORDER_THRESHOLD,
    );
    expect(d).toMatchObject({
      verdict: "match",
      confidence: TIER_CONFIDENCE.fuzzyReordered,
    });
    expect(d.evidence["rule"]).toBe("reordered");
  });

  it("row 3 needs the same year, not ±1", () => {
    const a = record({
      title:
        "Protein structure prediction from sequence using deep learning methods",
      year: 2021,
      authors: ["Baek"],
    });
    const b = record({
      title:
        "Using deep learning methods: protein structure prediction from sequence",
      year: 2022,
      authors: ["Baek"],
    });
    expect(compareRecords(a, b).verdict).not.toBe("match");
  });

  it("row 4: levSim ≈ 0.82 with nothing else corroborating is a flag", () => {
    const a = record({ title: S2_TITLE, year: 2023, authors: ["Theodoris"] });
    const b = record({
      // 10 edits over 56 characters: levSim = 1 - 10/56 ≈ 0.821.
      title: "Transfer learning enables prediction in protein ecology",
      year: 2023,
      authors: ["Nobody"],
    });
    const d = compareRecords(a, b);
    const lev = d.evidence["levSim"] as number;
    expect(lev).toBeGreaterThanOrEqual(LEVSIM_FLAG_THRESHOLD);
    expect(lev).toBeLessThan(LEVSIM_CORROBORATED_THRESHOLD);
    expect(lev).toBeCloseTo(0.82, 2);
    expect(d.verdict).toBe("flag");
    expect(d.tier).toBe("title-fuzzy");
    expect(d.confidence).toBe(lev);
    expect(d.evidence["rule"]).toBe("flag");
  });

  it("below the flag threshold is distinct", () => {
    const a = record({ title: S2_TITLE, year: 2023 });
    const b = record({
      title: "Single-cell atlas of the human heart across development",
      year: 2023,
    });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("distinct");
    expect(d.tier).toBeNull();
  });
});

describe("Tier 7 — known preprint ↔ published link", () => {
  it("links two records whose titles diverged when relatedVersionIds names the other", () => {
    const a = record({
      source: "biorxiv",
      type: "preprint",
      title: "A completely different working title for the preprint",
      ids: { doi: doi("10.64898/2026.08.20.745440") },
      related: { doi: doi("10.1038/s41586-026-00001-1") },
    });
    const b = record({
      source: "crossref",
      title: "The published article's final title after review",
      ids: { doi: doi("10.1038/s41586-026-00001-1") },
    });
    const d = compareRecords(a, b);
    expect(d).toMatchObject({
      verdict: "link",
      tier: "version-link",
      confidence: TIER_CONFIDENCE.versionLink,
    });
    expect(d.evidence["knownVersionLink"]).toBe(true);
  });

  it("wins over an exact title match too — never a merge", () => {
    const a = record({
      type: "preprint",
      title: S2_TITLE,
      year: 2023,
      ids: { doi: doi("10.64898/2023.01.01.000001") },
    });
    const b = record({
      title: S2_TITLE,
      year: 2023,
      ids: { doi: doi("10.1038/s41586-023-06139-9") },
      related: { doi: doi("10.64898/2023.01.01.000001") },
    });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("link");
    expect(d.tier).toBe("version-link");
  });
});

// ---------------------------------------------------------------------------
// False-positive guards — docs/02 §11.3.3, §11.5 rule 1, §11.4
// ---------------------------------------------------------------------------

describe("guard 1 — short titles need an exact id", () => {
  it("never title-matches 'Retraction' against 'Retraction'", () => {
    const a = record({ title: "Retraction", year: 2024, authors: ["Smith"] });
    const b = record({ title: "Retraction", year: 2024, authors: ["Smith"] });
    expect(compareRecords(a, b).verdict).toBe("distinct");
  });

  it("but matches them on a shared identifier", () => {
    const a = record({ title: "Correction", ids: { pmid: pmid("1") } });
    const b = record({ title: "Correction", ids: { pmid: pmid("1") } });
    expect(compareRecords(a, b).verdict).toBe("match");
  });

  it("applies at exactly MIN_FUZZY_TITLE_TOKENS", () => {
    const four = "one two three four";
    const five = "one two three four five";
    expect(
      compareRecords(
        record({ title: four, year: 1 }),
        record({ title: four, year: 1 }),
      ).verdict,
    ).toBe("distinct");
    expect(
      compareRecords(
        record({ title: five, year: 1 }),
        record({ title: five, year: 1 }),
      ).verdict,
    ).toBe("match");
    expect(five.split(" ")).toHaveLength(MIN_FUZZY_TITLE_TOKENS);
  });
});

describe("guard 2 — series titles differing by a trailing numeral", () => {
  it("forces 'Part II' vs 'Part III' distinct despite levSim > 0.95", () => {
    const a = record({
      title: "Studies on the mechanism of enzyme catalysis, Part II",
      year: 1998,
      authors: ["Fersht"],
    });
    const b = record({
      title: "Studies on the mechanism of enzyme catalysis, Part III",
      year: 1998,
      authors: ["Fersht"],
    });
    const d = compareRecords(a, b);
    expect(d.evidence["levSim"]).toBeGreaterThan(0.95);
    expect(d.verdict).toBe("distinct");
    expect(d.evidence["seriesMarkersDiffer"]).toBe(true);
  });

  it("forces a trailing digit difference distinct as well", () => {
    const a = record({
      title: "Results of the national cohort study 1",
      year: 2020,
    });
    const b = record({
      title: "Results of the national cohort study 2",
      year: 2020,
    });
    expect(compareRecords(a, b).verdict).toBe("distinct");
  });

  it("forces one-sided marker distinct when the stems are equal", () => {
    const a = record({
      title: "Studies on the mechanism of enzyme catalysis",
      year: 1998,
    });
    const b = record({
      title: "Studies on the mechanism of enzyme catalysis part ii",
      year: 1998,
    });
    expect(compareRecords(a, b).verdict).toBe("distinct");
  });

  it("does not fire on a word that merely spells like a numeral", () => {
    const a = record({
      title: "Caring for the mentally ill in rural areas",
      year: 2001,
    });
    const b = record({
      title: "Caring for the mentally ill in rural areas",
      year: 2001,
    });
    expect(compareRecords(a, b).verdict).toBe("match");
  });
});

describe("item 281(c) — a number inside the title (owner, 2026-10-24; docs/02 §11.3.3's note)", () => {
  /** `P3-T27` finding 7's pair: the same author and year, one inner number apart. */
  const NUMBER_1 =
    "A synthetic study number 1 of widget counts in three regions";
  const NUMBER_2 =
    "A synthetic study number 2 of widget counts in three regions";

  it("reads a title's numbers in order, with leading zeros dropped", () => {
    expect(titleNumbers(normalizeTitle("COVID-19 in 2021: wave 03"))).toEqual([
      "19",
      "2021",
      "3",
    ]);
    expect(titleNumbers(normalizeTitle("3D printing"))).toEqual(["3"]);
    expect(titleNumbers(normalizeTitle("3-D printing"))).toEqual(["3"]);
    expect(titleNumbers(normalizeTitle("No numbers here at all"))).toEqual([]);
  });

  it("never makes the two titles one work — flagged for review, not merged", () => {
    const a = record({ title: NUMBER_1, year: 2024, authors: ["Okafor"] });
    const b = record({ title: NUMBER_2, year: 2024, authors: ["Okafor"] });
    const d = compareRecords(a, b);
    // The pair cleared the duplicate thresholds — the case the guard is for.
    expect(d.evidence["levSim"]).toBeGreaterThanOrEqual(
      LEVSIM_DUPLICATE_THRESHOLD,
    );
    expect(d.tier).toBe("title-fuzzy");
    expect(d.verdict).toBe("flag");
    expect(d.evidence["titleNumbersDiffer"]).toBe(true);
    const result = dedupeRecords([a, b]);
    expect(result.groups).toHaveLength(2);
    expect(result.flags).toHaveLength(1);
  });

  it("treats a number on one side only as a difference", () => {
    const a = record({
      title: "A synthetic study of widget counts in three regions",
      year: 2024,
      authors: ["Okafor"],
    });
    const b = record({
      title: "A synthetic study 2 of widget counts in three regions",
      year: 2024,
      authors: ["Okafor"],
    });
    expect(compareRecords(a, b).verdict).not.toBe("match");
  });

  it("still matches the same title whose numbers are written the same way", () => {
    // Over-correction guard: punctuation and spacing around a number are not
    // a different number, so §11.3.3's typo-tolerant match still fires.
    const a = record({
      title: "COVID-19 vaccine uptake among health workers in 2021: a survey",
      year: 2022,
      authors: ["Nakamura"],
    });
    const b = record({
      title: "COVID 19 vaccine uptake among health-workers in 2021 - a surveys",
      year: 2022,
      authors: ["Nakamura"],
    });
    const d = compareRecords(a, b);
    expect(d.tier).toBe("title-fuzzy");
    expect(d.verdict).toBe("match");
    expect(d.evidence["titleNumbersDiffer"]).toBeUndefined();
  });

  it("leaves a link the earlier guards gave exactly as it was", () => {
    // §11.5 rule 1: a title match across conflicting DOIs is a link. The
    // number guard lowers only a match, so this stays a link, not a flag.
    const a = record({
      title: NUMBER_1,
      year: 2024,
      authors: ["Okafor"],
      ids: { doi: doi("10.1000/rh.n1") },
    });
    const b = record({
      title: NUMBER_2,
      year: 2024,
      authors: ["Okafor"],
      ids: { doi: doi("10.1000/rh.n2") },
    });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("link");
    expect(d.evidence["conflictingIds"]).toBe("doi");
    expect(d.evidence["titleNumbersDiffer"]).toBeUndefined();
  });

  it("leaves §11.3.3's own flag row as it was", () => {
    // levSim 0.85, different first authors: nothing corroborates, so the
    // table's flag row speaks, and the number guard adds nothing to it.
    const a = record({ title: NUMBER_1, year: 2024, authors: ["Okafor"] });
    const b = record({
      title: "A synthetic study number 2 of gadget tallies in three regions",
      year: 2024,
      authors: ["Lindqvist"],
    });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("flag");
    expect(d.evidence["rule"]).toBe("flag");
    expect(d.evidence["titleNumbersDiffer"]).toBeUndefined();
  });

  it("leaves an identical numbered title to Tier 5's match", () => {
    const a = record({ title: NUMBER_1, year: 2024, authors: ["Okafor"] });
    const b = record({
      title: `${NUMBER_1}.`,
      year: 2024,
      authors: ["Okafor"],
    });
    expect(compareRecords(a, b).verdict).toBe("match");
  });
});

describe("guard 3 — same title, different year, different journal", () => {
  it("links instead of merging", () => {
    const a = record({
      title: S2_TITLE,
      year: 2022,
      container:
        "Proceedings of the 39th International Conference on Machine Learning",
    });
    const b = record({ title: S2_TITLE, year: 2023, container: "Nature" });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("link");
    expect(d.tier).toBe("title-exact");
    expect(d.evidence["containerDiffers"]).toBe(true);
  });

  it("still merges when the year is the same", () => {
    const a = record({ title: S2_TITLE, year: 2023, container: "Nature" });
    const b = record({
      title: S2_TITLE,
      year: 2023,
      container: "Nature (London)",
    });
    expect(compareRecords(a, b).verdict).toBe("match");
  });

  it("still merges when the journal is unknown on one side", () => {
    const a = record({ title: S2_TITLE, year: 2022, container: "Nature" });
    const b = record({ title: S2_TITLE, year: 2023 });
    expect(compareRecords(a, b).verdict).toBe("match");
  });
});

describe("§11.5 rule 1 — title match with conflicting ids is a link", () => {
  it("downgrades an exact-title match with two different DOIs", () => {
    const a = record({
      title: S2_TITLE,
      year: 2023,
      ids: { doi: doi("10.1038/s41586-023-06139-9") },
    });
    const b = record({
      title: S2_TITLE,
      year: 2023,
      ids: { doi: doi("10.1101/2022.08.10.503517") },
    });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("link");
    expect(d.tier).toBe("title-exact");
    expect(d.evidence["conflictingIds"]).toBe("doi");
  });

  it("downgrades a fuzzy match with conflicting PMIDs", () => {
    const a = record({
      title:
        "Machine learning approaches for predicting protein structure from sequence",
      year: 2022,
      ids: { pmid: pmid("111") },
    });
    const b = record({
      title:
        "Machine learning approaches for predicting protein structure from sequences",
      year: 2022,
      ids: { pmid: pmid("222") },
    });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("link");
    expect(d.evidence["conflictingIds"]).toBe("pmid");
  });
});

describe("§11.5 under rule 1 — a shared Tier 1–4 id across conflicting DOIs and a version naming is a link (plan/00 §6 item 200)", () => {
  const PREPRINT_DOI = doi("10.1101/2024.02.02.000200");
  const JOURNAL_DOI = doi("10.5555/rh-item200.journal");
  const PMID_NAMED = pmid("40000200");

  /** One identifier tier, the id kind it reads and a value both sides share. */
  const identifierTiers: readonly [string, keyof ExternalIds, ExternalIds][] = [
    ["pmid", "pmid", { pmid: pmid("39000200") }],
    ["pmcid", "pmcid", { pmcid: pmcid("PMC11000200") }],
    ["arxiv", "arxivId", { arxivId: arxiv("2402.00200") }],
    ["s2", "s2CorpusId", { s2CorpusId: s2("267000200") }],
  ];

  it.each(identifierTiers)(
    "Tier %s: conflicting DOIs and one side naming the other → 'link', never 'match'",
    (_tier, kind, shared) => {
      const pre = record({
        type: "preprint",
        title: "A preprint title, unlike the published one",
        ids: { doi: PREPRINT_DOI, ...shared },
        related: { doi: JOURNAL_DOI },
      });
      const pub = record({
        source: "semanticscholar",
        title: "The journal's final title, chosen after review",
        ids: { doi: JOURNAL_DOI, ...shared },
      });
      for (const d of [compareRecords(pre, pub), compareRecords(pub, pre)]) {
        expect(d).toMatchObject({
          verdict: "link",
          tier: "version-link",
          confidence: TIER_CONFIDENCE.versionLink,
        });
        expect(d.evidence["knownVersionLink"]).toBe(true);
        expect(d.evidence["conflictingIds"]).toBe("doi");
        expect(d.evidence[kind]).toBeDefined();
      }
    },
  );

  it.each(identifierTiers)(
    "Tier %s: the same pair with no version naming is still a match at that tier",
    (tier, _kind, shared) => {
      const a = record({
        type: "preprint",
        title: "A preprint title, unlike the published one",
        ids: { doi: PREPRINT_DOI, ...shared },
      });
      const b = record({
        source: "semanticscholar",
        title: "The journal's final title, chosen after review",
        ids: { doi: JOURNAL_DOI, ...shared },
      });
      expect(compareRecords(a, b)).toMatchObject({ verdict: "match", tier });
    },
  );

  it.each(identifierTiers)(
    "Tier %s: a version naming with no DOI on one side is no DOI conflict, so still a match",
    (tier, _kind, shared) => {
      const a = record({
        type: "preprint",
        title: "A preprint title, unlike the published one",
        ids: { ...shared },
        related: { doi: JOURNAL_DOI },
      });
      const b = record({
        source: "semanticscholar",
        title: "The journal's final title, chosen after review",
        ids: { doi: JOURNAL_DOI, ...shared },
      });
      expect(compareRecords(a, b)).toMatchObject({ verdict: "match", tier });
    },
  );

  it("only a DOI conflict triggers it: conflicting PMIDs, a shared PMCID and a naming stay a match", () => {
    // The owner's rule names DOIs; any other verdict change is out of scope.
    const a = record({
      title: "A preprint title, unlike the published one",
      ids: { pmid: pmid("39000201"), pmcid: pmcid("PMC11000201") },
      related: { doi: JOURNAL_DOI },
    });
    const b = record({
      source: "semanticscholar",
      title: "The journal's final title, chosen after review",
      ids: {
        doi: JOURNAL_DOI,
        pmid: pmid("39000202"),
        pmcid: pmcid("PMC11000201"),
      },
    });
    const d = compareRecords(a, b);
    expect(d).toMatchObject({ verdict: "match", tier: "pmcid" });
  });

  it("equal DOIs and a version naming: the cascade matches at Tier 0", () => {
    const a = record({
      title: "One work under one DOI",
      ids: { doi: JOURNAL_DOI, arxivId: arxiv("2402.00200") },
      related: { pmid: PMID_NAMED },
    });
    const b = record({
      source: "semanticscholar",
      title: "One work under one DOI",
      ids: { doi: JOURNAL_DOI, arxivId: arxiv("2402.00200"), pmid: PMID_NAMED },
    });
    expect(compareRecords(a, b)).toMatchObject({
      verdict: "match",
      tier: "doi",
    });
  });

  it.each(identifierTiers)(
    "Tier %s run on its own: equal DOIs and a version naming are still a match",
    (tier, _kind, shared) => {
      const run = DEDUP_TIERS.find((t) => t.id === tier);
      if (run === undefined) throw new Error(`no tier ${tier}`);
      // The naming goes through a kind other than the shared one, so it
      // cannot be the shared value itself.
      const related: ExternalIds =
        tier === "pmid"
          ? { arxivId: arxiv("2402.09999") }
          : { pmid: PMID_NAMED };
      const a = toCandidate(
        record({
          title: "One work under one DOI",
          ids: { doi: JOURNAL_DOI, ...shared },
          related,
        }),
      );
      const b = toCandidate(
        record({
          source: "semanticscholar",
          title: "One work under one DOI",
          ids: { doi: JOURNAL_DOI, ...shared, ...related },
        }),
      );
      // What Tier 0 leaves behind when the DOIs are equal: no conflict.
      expect(
        run.run(a, b, { conflicts: [], reportsAcrossVersions: false }),
      ).toMatchObject({
        verdict: "match",
        tier,
      });
    },
  );

  it("dedupeRecords and dedupeRecordsAsync agree: two groups and one link", async () => {
    const pre = record({
      type: "preprint",
      title: "A preprint title, unlike the published one",
      ids: { doi: PREPRINT_DOI, arxivId: arxiv("2402.00200") },
      related: { doi: JOURNAL_DOI },
    });
    const pub = record({
      source: "semanticscholar",
      title: "The journal's final title, chosen after review",
      ids: { doi: JOURNAL_DOI, arxivId: arxiv("2402.00200") },
    });
    const sync = dedupeRecords([pre, pub]);
    expect(sync.groups).toHaveLength(2);
    expect(sync.links).toHaveLength(1);
    expect(sync.links[0]?.decision.tier).toBe("version-link");
    expect(await dedupeRecordsAsync([pre, pub])).toEqual(sync);
  });
});

describe("§11.5 under rule 1 — the group-level check: a third record never joins two versions into one work (plan/00 §6 item 209)", () => {
  const PREPRINT_DOI = doi("10.48550/arxiv.2402.00209");
  const JOURNAL_DOI = doi("10.5555/rh-item209.journal");
  const ARXIV = arxiv("2402.00209");
  const TITLE =
    "Group level checks keep a preprint apart from its journal version";

  /** The preprint that names the journal DOI as its other version. */
  const naming = (): SourceRecord =>
    record({
      id: "naming",
      source: "arxiv",
      type: "preprint",
      title: TITLE,
      year: 2024,
      ids: { doi: PREPRINT_DOI, arxivId: ARXIV },
      related: { doi: JOURNAL_DOI },
    });
  /** A second copy of the preprint: same DOI and arXiv id, no naming. */
  const plain = (id = "plain"): SourceRecord =>
    record({
      id,
      source: "arxiv",
      type: "preprint",
      title: TITLE,
      year: 2024,
      ids: { doi: PREPRINT_DOI, arxivId: ARXIV },
    });
  /** The journal version: the journal DOI and the same arXiv id. */
  const journal = (): SourceRecord =>
    record({
      id: "journal",
      source: "semanticscholar",
      title: TITLE,
      year: 2025,
      ids: { doi: JOURNAL_DOI, arxivId: ARXIV },
    });

  function orders<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [[...items]];
    return items.flatMap((item, k) =>
      orders([...items.slice(0, k), ...items.slice(k + 1)]).map((rest) => [
        item,
        ...rest,
      ]),
    );
  }

  /** Each group as its sorted record ids, the groups sorted: order removed. */
  function membership(groups: readonly { records: readonly SourceRecord[] }[]) {
    return groups
      .map((g) => g.records.map((r) => r.id).sort())
      .sort((x, y) => x.join().localeCompare(y.join()));
  }

  /** Each link as its sorted record ids plus its decision: order removed. */
  function linkSet(
    links: readonly {
      a: SourceRecord;
      b: SourceRecord;
      decision: DedupDecision;
    }[],
  ) {
    return links
      .map((l) => ({ ids: [l.a.id, l.b.id].sort(), decision: l.decision }))
      .sort((x, y) => x.ids.join().localeCompare(y.ids.join()));
  }

  it("the measured shape: the bridging copy matches each version, yet all six orders give two works and one link", () => {
    const records = [naming(), plain(), journal()];
    const [n, p, j] = records;
    if (n === undefined || p === undefined || j === undefined) {
      throw new Error("three records");
    }
    // The bridge, pair by pair: Tier 0 with the preprint, Tier 3 (DOIs in
    // conflict, no naming) with the journal version; the versions: a link.
    expect(compareRecords(p, n)).toMatchObject({
      verdict: "match",
      tier: "doi",
    });
    expect(compareRecords(p, j)).toMatchObject({
      verdict: "match",
      tier: "arxiv",
    });
    expect(compareRecords(n, j)).toMatchObject({
      verdict: "link",
      tier: "version-link",
    });
    const results = orders(records).map((o) => dedupeRecords(o));
    expect(results).toHaveLength(6);
    for (const result of results) {
      expect(membership(result.groups)).toEqual([
        ["arxiv:naming", "arxiv:plain"],
        ["semanticscholar:journal"],
      ]);
      expect(result.links).toHaveLength(1);
      expect(result.links[0]?.decision).toMatchObject({
        verdict: "link",
        tier: "version-link",
        confidence: TIER_CONFIDENCE.versionLink,
        evidence: { groupSplit: true, knownVersionLink: true },
      });
      expect(result.flags).toEqual([]);
      expect(result.recordsDeduplicatedAway).toBe(1);
      expect(linkSet(result.links)).toEqual(linkSet(results[0]?.links ?? []));
    }
  });

  it("the bridging copy joins the version it matches at the earlier tier, and the split is in the group's decisions", () => {
    for (const o of orders([naming(), plain(), journal()])) {
      const result = dedupeRecords(o);
      const preprint = result.groups.find((g) =>
        g.records.some((r) => r.id === "arxiv:naming"),
      );
      const published = result.groups.find((g) =>
        g.records.some((r) => r.id === "semanticscholar:journal"),
      );
      expect(preprint?.decisions.map((d) => d.tier)).toEqual(["doi"]);
      expect(published?.records).toHaveLength(1);
      expect(published?.decisions).toEqual([]);
    }
  });

  it("a record matching both versions at the same tier joins neither, in every order", () => {
    // No DOI, so nothing conflicts: Tier 3 matches it with both versions.
    const bridge = record({
      id: "bridge",
      source: "arxiv",
      type: "preprint",
      title: TITLE,
      year: 2024,
      ids: { arxivId: ARXIV },
    });
    for (const o of orders([naming(), bridge, journal()])) {
      const result = dedupeRecords(o);
      expect(membership(result.groups)).toEqual([
        ["arxiv:bridge"],
        ["arxiv:naming"],
        ["semanticscholar:journal"],
      ]);
      expect(linkSet(result.links).map((l) => l.ids)).toEqual([
        ["arxiv:naming", "semanticscholar:journal"],
      ]);
    }
  });

  it("a genuine three-way duplicate with no version naming still merges into one, in every order", () => {
    const a = record({
      id: "a",
      title: TITLE,
      year: 2024,
      ids: { doi: PREPRINT_DOI, arxivId: ARXIV },
    });
    const b = record({
      id: "b",
      title: TITLE,
      year: 2024,
      ids: { doi: PREPRINT_DOI, arxivId: ARXIV },
    });
    const c = record({
      id: "c",
      source: "semanticscholar",
      title: TITLE,
      year: 2025,
      ids: { doi: JOURNAL_DOI, arxivId: ARXIV },
    });
    for (const o of orders([a, b, c])) {
      const result = dedupeRecords(o);
      expect(result.groups).toHaveLength(1);
      expect(result.links).toEqual([]);
    }
  });

  it("a duplicate joined through a chain, with one pair not a match and no version naming, still merges into one", () => {
    // a–b share the DOI, b–c the PMID; a and c share nothing and their
    // titles differ, so a–c is not a match — and must not split the group.
    const a = record({
      id: "a",
      title: TITLE,
      year: 2024,
      ids: { doi: JOURNAL_DOI },
    });
    const b = record({
      id: "b",
      title: TITLE,
      year: 2024,
      ids: { doi: JOURNAL_DOI, pmid: pmid("40000209") },
    });
    const c = record({
      id: "c",
      title: "Entirely different words describing another thing",
      year: 2024,
      ids: { pmid: pmid("40000209") },
    });
    expect(compareRecords(a, c).verdict).not.toBe("match");
    for (const o of orders([a, b, c])) {
      const result = dedupeRecords(o);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]?.records).toHaveLength(3);
    }
  });

  it("only a version naming splits: a §11.5 rule 1 title link (conflicting DOIs, no naming) inside a chained group does not", () => {
    // a–b share the PMID; b has no DOI, so b–c is a plain title match; a–c
    // match on title across conflicting DOIs, which rule 1 makes a link —
    // but neither names the other, so item 209's check leaves the group.
    const a = record({
      id: "a",
      title: TITLE,
      year: 2024,
      ids: { doi: PREPRINT_DOI, pmid: pmid("40000210") },
    });
    const b = record({
      id: "b",
      title: TITLE,
      year: 2024,
      ids: { pmid: pmid("40000210") },
    });
    const c = record({
      id: "c",
      title: TITLE,
      year: 2024,
      ids: { doi: JOURNAL_DOI },
    });
    expect(compareRecords(a, c)).toMatchObject({
      verdict: "link",
      evidence: { conflictingIds: "doi" },
    });
    expect(compareRecords(a, c).evidence["knownVersionLink"]).toBeUndefined();
    for (const o of orders([a, b, c])) {
      expect(dedupeRecords(o).groups).toHaveLength(1);
    }
  });

  it("a named pair the cascade calls distinct (series markers differ) is split too, and stays distinct: no link", () => {
    // a names c; a–b share the DOI, b–c the PMID; a–c differ only in the
    // trailing part number, so §11.3.3 guard 2 makes them distinct.
    const SERIES = "Deep protein language models for structure prediction part";
    const a = record({
      id: "a",
      title: `${SERIES} 1`,
      year: 2024,
      ids: { doi: PREPRINT_DOI },
      related: { doi: JOURNAL_DOI },
    });
    const b = record({
      id: "b",
      title: `${SERIES} 1`,
      year: 2024,
      ids: { doi: PREPRINT_DOI, pmid: pmid("40000211") },
    });
    const c = record({
      id: "c",
      title: `${SERIES} 2`,
      year: 2024,
      ids: { doi: JOURNAL_DOI, pmid: pmid("40000211") },
    });
    expect(compareRecords(a, c)).toMatchObject({
      verdict: "distinct",
      evidence: { seriesMarkersDiffer: true },
    });
    for (const o of orders([a, b, c])) {
      const result = dedupeRecords(o);
      expect(membership(result.groups)).toEqual([
        ["pubmed:a", "pubmed:b"],
        ["pubmed:c"],
      ]);
      expect(result.links).toEqual([]);
    }
  });

  it("dedupeRecords and dedupeRecordsAsync agree in all six orders", async () => {
    for (const o of orders([naming(), plain(), journal()])) {
      expect(await dedupeRecordsAsync(o)).toEqual(dedupeRecords(o));
    }
  });

  it("a split of a large group still yields at most every DEDUP_YIELD_EVERY_COMPARISONS comparisons", async () => {
    const copies = Array.from({ length: 30 }, (_, k) => plain(`plain${k}`));
    const records = [naming(), ...copies, journal()];
    const counter = { comparisons: 0 };
    const marks: number[] = [];
    const result = await dedupeRecordsAsync(records, {
      counter,
      yieldToEventLoop: () => {
        marks.push(counter.comparisons);
        return Promise.resolve();
      },
    });
    // The check compares every pair of the 32-record group (496 pairs), so
    // it spans more than one slice.
    expect(counter.comparisons).toBe(496);
    expect(counter.comparisons).toBeGreaterThan(DEDUP_YIELD_EVERY_COMPARISONS);
    const slices = [...marks, counter.comparisons].map(
      (m, k, all) => m - (k === 0 ? 0 : (all[k - 1] ?? 0)),
    );
    for (const slice of slices) {
      expect(slice).toBeLessThanOrEqual(DEDUP_YIELD_EVERY_COMPARISONS);
    }
    expect(result.groups).toHaveLength(2);
    expect(result.links).toHaveLength(1);
    expect(result).toEqual(dedupeRecords(records));
  });
});

describe("§11.4 — a title match across the preprint boundary is a 0.75 flag", () => {
  it("flags rather than merges a preprint against a journal article", () => {
    const a = record({ type: "preprint", title: S2_TITLE, year: 2022 });
    const b = record({ type: "journal-article", title: S2_TITLE, year: 2023 });
    const d = compareRecords(a, b);
    expect(d).toMatchObject({
      verdict: "flag",
      confidence: TIER_CONFIDENCE.preprintPairFlag,
    });
    expect(d.evidence["preprintPair"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Korean titles — docs/02 §11.3.2 as corrected 2026-10-15 (owner review of
// 2026-10-14, row 88; `P2-T36`)
// ---------------------------------------------------------------------------

/**
 * A Korean title of seven space-separated words — above the short-title floor
 * ({@link MIN_FUZZY_TITLE_TOKENS}), so it reaches the title tiers. Under the
 * old ASCII-only punctuation pass it normalised to `""`.
 */
const KO_TITLE = "한국 성인에서 비만과 대사증후군의 관련성에 대한 연구";
/** The same title as PubMed prints it, with the trailing period. */
const KO_TITLE_PUBMED = `${KO_TITLE}.`;
/**
 * One word changed (`대한` → `관한`, "about" in two spellings): three jamo of
 * 65, measured `levSim` 0.9538, and the three longest words are untouched, so
 * the pair shares a blocking signature.
 */
const KO_TITLE_NEAR = "한국 성인에서 비만과 대사증후군의 관련성에 관한 연구";
/** One word changed inside a long word (`관련성` → `연관성`): `levSim` 0.9375. */
const KO_TITLE_FLAG = "한국 성인에서 비만과 대사증후군의 연관성에 대한 연구";
/** A different Korean study that shares only the frame `… 관련성에 대한 연구`. */
const KO_TITLE_OTHER =
  "한국 노인에서 수면 시간과 우울 증상의 관련성에 대한 연구";
/** {@link KO_TITLE}'s English rendering, as a bilingual journal prints it. */
const KO_TITLE_ENGLISH =
  "Association between obesity and metabolic syndrome in Korean adults";

describe("Korean titles are compared as titles (row 88)", () => {
  it("keeps Hangul through normalizeTitle, as NFKD jamo, in words", () => {
    const normalized = normalizeTitle(KO_TITLE);
    expect(normalized).not.toBe("");
    // No punctuation and nothing to lowercase: the normal form is the title
    // itself, decomposed — what §11.3.2's NFKD step does to a syllable.
    expect(normalized).toBe(KO_TITLE.normalize("NFKD"));
    expect(titleTokens(normalized)).toHaveLength(7);
    expect(blockingSignature(titleTokens(normalized))).toBeDefined();
  });

  it("treats precomposed and decomposed Hangul alike", () => {
    expect(normalizeTitle(KO_TITLE.normalize("NFD"))).toBe(
      normalizeTitle(KO_TITLE.normalize("NFC")),
    );
  });

  it("still turns punctuation into a space in a mixed-script title", () => {
    expect(normalizeTitle("COVID-19 대유행 기간: 한국 성인의 우울 증상")).toBe(
      "covid 19 대유행 기간 한국 성인의 우울 증상".normalize("NFKD"),
    );
    // Fullwidth Latin folds to ASCII under NFKD, as it always did.
    expect(normalizeTitle("ＣＯＶＩＤ－１９ 대유행")).toBe(
      "covid 19 대유행".normalize("NFKD"),
    );
  });

  it("exact match: PubMed's trailing period against the bare title is Tier 5", () => {
    const a = record({ title: KO_TITLE_PUBMED, year: 2023, authors: ["Kim"] });
    const b = record({
      source: "semanticscholar",
      title: KO_TITLE,
      year: 2023,
      authors: ["Kim"],
    });
    expect(compareRecords(a, b)).toMatchObject({
      verdict: "match",
      tier: "title-exact",
      confidence: TIER_CONFIDENCE.titleExact,
    });
    const r = dedupeRecords([a, b]);
    expect(r.groups).toHaveLength(1);
    expect(r.recordsDeduplicatedAway).toBe(1);
    expect(r.comparisons).toBe(1);
  });

  it("near match: levSim ≥ 0.95 within a year is Tier 6 row 1, and the pair shares a block", () => {
    const a = record({ title: KO_TITLE, year: 2023, authors: ["Kim"] });
    const b = record({ title: KO_TITLE_NEAR, year: 2024, authors: ["Lee"] });
    const d = compareRecords(a, b);
    expect(d.evidence["levSim"]).toBeGreaterThanOrEqual(
      LEVSIM_DUPLICATE_THRESHOLD,
    );
    expect(d.evidence["levSim"]).toBeCloseTo(0.9538, 4);
    expect(d).toMatchObject({
      verdict: "match",
      tier: "title-fuzzy",
      confidence: TIER_CONFIDENCE.fuzzyLevenshtein,
    });
    expect(d.evidence["rule"]).toBe("levenshtein");
    const r = dedupeRecords([a, b]);
    expect(r.groups).toHaveLength(1);
    expect(r.comparisons).toBe(1);
  });

  it("a Korean pair below 0.95 with nothing corroborating is a flag, never a merge", () => {
    const a = record({ title: KO_TITLE, year: 2023, authors: ["Kim"] });
    const b = record({ title: KO_TITLE_FLAG, year: 2023, authors: ["Kim"] });
    const d = compareRecords(a, b);
    expect(d.evidence["levSim"]).toBeCloseTo(0.9375, 4);
    expect(d).toMatchObject({ verdict: "flag", tier: "title-fuzzy" });
  });

  it("a Latin/Korean pair of the same study stays distinct", () => {
    const korean = record({ title: KO_TITLE, year: 2023, authors: ["Kim"] });
    const english = record({
      title: KO_TITLE_ENGLISH,
      year: 2023,
      authors: ["Kim"],
    });
    expect(compareRecords(korean, english).verdict).toBe("distinct");
    const r = dedupeRecords([korean, english]);
    expect(r.groups).toHaveLength(2);
    expect(r.flags).toHaveLength(0);
    expect(r.comparisons).toBe(0);
  });

  it("two different Korean studies stay distinct", () => {
    const a = record({ title: KO_TITLE, year: 2023, authors: ["Kim"] });
    const b = record({ title: KO_TITLE_OTHER, year: 2023, authors: ["Kim"] });
    expect(compareRecords(a, b).verdict).toBe("distinct");
    expect(dedupeRecords([a, b]).groups).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// dedupeRecords — grouping, blocking, and the flag-never-merges invariant
// ---------------------------------------------------------------------------

describe("dedupeRecords", () => {
  it("groups transitively across identifier tiers", () => {
    const a = record({ title: "a", ids: { doi: doi("10.1000/x") } });
    const b = record({
      title: "b",
      ids: { doi: doi("10.1000/X"), pmid: pmid("42") },
    });
    const c = record({ title: "c", ids: { pmid: pmid("42") } });
    const r = dedupeRecords([a, b, c]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.records).toEqual([a, b, c]);
    expect(r.groups[0]?.decisions.map((d) => d.tier)).toEqual(["doi", "pmid"]);
    expect(r.recordsDeduplicatedAway).toBe(2);
    expect(r.comparisons).toBe(2);
  });

  it("keeps a flagged pair as two groups and reports the flag", () => {
    const a = record({ title: S2_TITLE, year: 2023, authors: ["Theodoris"] });
    const b = record({
      // "predictions" kept so the pair shares a blocking signature.
      title: "Transfer learning enables predictions in protein biology",
      year: 2023,
      authors: ["Nobody"],
    });
    const r = dedupeRecords([a, b]);
    expect(r.groups).toHaveLength(2);
    expect(r.flags).toHaveLength(1);
    expect(r.flags[0]?.decision.verdict).toBe("flag");
    expect(r.links).toHaveLength(0);
    expect(r.recordsDeduplicatedAway).toBe(0);
  });

  it("keeps a linked pair as two groups and reports the link", () => {
    const a = record({
      title: S2_TITLE,
      year: 2023,
      ids: { doi: doi("10.1000/a") },
    });
    const b = record({
      title: S2_TITLE,
      year: 2023,
      ids: { doi: doi("10.1000/b") },
    });
    const r = dedupeRecords([a, b]);
    expect(r.groups).toHaveLength(2);
    expect(r.links).toHaveLength(1);
    expect(r.links[0]?.decision.verdict).toBe("link");
  });

  it("only 'match' decisions ever join a group — on a mixed set", () => {
    const records = [
      record({
        title: S2_TITLE,
        year: 2023,
        ids: { doi: doi("10.1038/s41586-023-06139-9") },
      }),
      record({
        title: PUBMED_TITLE,
        year: 2023,
        ids: { pmid: pmid("37258680") },
      }),
      record({ title: S2_TITLE, year: 2023, ids: { pmid: pmid("37258680") } }),
      record({
        title: "Transfer learning enables predictions in protein biology",
        year: 2023,
      }),
      record({
        type: "preprint",
        title: S2_TITLE,
        year: 2022,
        ids: { doi: doi("10.1101/2022.08.10.503517") },
      }),
      record({
        title: "Studies on the mechanism of enzyme catalysis, Part II",
        year: 1998,
      }),
      record({
        title: "Studies on the mechanism of enzyme catalysis, Part III",
        year: 1998,
      }),
    ];
    const r = dedupeRecords(records);
    const allDecisions: DedupDecision[] = r.groups.flatMap((g) => [
      ...g.decisions,
    ]);
    expect(allDecisions.length).toBeGreaterThan(0);
    expect(allDecisions.every((d) => d.verdict === "match")).toBe(true);
    for (const f of [...r.flags, ...r.links]) {
      const groupOf = (x: SourceRecord): number =>
        r.groups.findIndex((g) => g.records.includes(x));
      expect(groupOf(f.a)).not.toBe(groupOf(f.b));
    }
    expect(r.groups.length + r.recordsDeduplicatedAway).toBe(records.length);
    // The first three are one work (title-exact, then pmid); nothing else merges.
    expect(r.groups[0]?.records).toHaveLength(3);
    expect(r.groups).toHaveLength(5);
  });

  it("does not compare records in different title blocks at all", () => {
    const a = record({
      title: "Alpha beta gamma delta epsilon zeta",
      year: 2020,
    });
    const b = record({
      title: "Completely unrelated words here now please",
      year: 2020,
    });
    const r = dedupeRecords([a, b]);
    expect(r.comparisons).toBe(0);
    expect(r.groups).toHaveLength(2);
  });

  it("does not compare same-block records more than MAX_YEAR_DELTA apart", () => {
    const a = record({ title: S2_TITLE, year: 2020 });
    const b = record({ title: S2_TITLE, year: 2020 + MAX_YEAR_DELTA + 1 });
    const r = dedupeRecords([a, b]);
    expect(r.comparisons).toBe(0);
    expect(r.groups).toHaveLength(2);
    expect(r.flags).toHaveLength(0);
  });

  it("does not rewrite any input record (ids stay the mapper's)", () => {
    const a = record({
      title: PUBMED_TITLE,
      ids: { doi: doi("10.18653/V1/2020.ACL-MAIN.447") },
    });
    const b = record({
      title: S2_TITLE,
      ids: { doi: doi("10.18653/v1/2020.acl-main.447") },
    });
    const before = structuredClone([a, b]);
    const r = dedupeRecords([a, b]);
    expect(r.groups).toHaveLength(1);
    expect([a, b]).toEqual(before);
    expect(a.work.ids.doi).toBe("10.18653/V1/2020.ACL-MAIN.447");
  });

  it("increments an externally supplied counter in place", () => {
    const counter = { comparisons: 10 };
    dedupeRecords(
      [
        record({ title: "a", ids: { doi: doi("10.1000/x") } }),
        record({ title: "b", ids: { doi: doi("10.1000/x") } }),
      ],
      counter,
    );
    expect(counter.comparisons).toBe(11);
  });

  it("blocking trade-off: a changed long word moves a pair out of its block", () => {
    // compareRecords would flag this pair (levSim ≈ 0.82) — but the three
    // longest tokens differ ("prediction" vs "predictions"), so §11.3.3's
    // blocking never presents it to the cascade. A false split, recoverable;
    // P2-T13 measures how often it happens.
    const a = record({ title: S2_TITLE, year: 2023 });
    const b = record({
      title: "Transfer learning enables prediction in protein biology",
      year: 2023,
    });
    expect(compareRecords(a, b).verdict).toBe("flag");
    expect(toCandidate(a).signature).not.toBe(toCandidate(b).signature);
    const r = dedupeRecords([a, b]);
    expect(r.comparisons).toBe(0);
    expect(r.flags).toHaveLength(0);
    expect(r.groups).toHaveLength(2);
  });

  it("handles an empty input", () => {
    const r = dedupeRecords([]);
    expect(r.groups).toEqual([]);
    expect(r.comparisons).toBe(0);
    expect(r.recordsDeduplicatedAway).toBe(0);
  });
});

/**
 * 50 families × 10 variants; every variant keeps the family's three longest
 * words, so the set falls into 50 blocks of 10. Shared by the blocking bound
 * below and the `dedupeRecordsAsync` yield tests.
 */
function synthetic(): SourceRecord[] {
  const out: SourceRecord[] = [];
  const words = [
    "alpha",
    "bravo",
    "charlie",
    "delta",
    "echo",
    "foxtrot",
    "golf",
    "hotel",
    "india",
    "juliet",
  ];
  for (let f = 0; f < 50; f += 1) {
    const long1 = `${words[f % 10]}ization${f}`;
    const long2 = `${words[(f + 3) % 10]}ological${f}`;
    const long3 = `${words[(f + 7) % 10]}morphism${f}`;
    for (let v = 0; v < 10; v += 1) {
      const filler = words[v] ?? "x";
      out.push(
        record({
          title: `${long1} and ${long2} in ${long3} of ${filler} cells ${v}`,
          year: 2020 + (v % 2),
          authors: [`Author${f}`],
        }),
      );
    }
  }
  return out;
}

/**
 * `P1-T23`'s NFR-1 shape: 100 records whose titles share their longest words,
 * so `blockingSignature` puts them in one block — the set `P2-T29` measured
 * stalling the main thread 246–274 ms unchunked.
 */
function oneBlockOfHundred(): SourceRecord[] {
  return Array.from({ length: 100 }, (_, i) =>
    record({
      title: `Pre-fetched record ${String(i + 1)} for NFR-1`,
      year: 2025,
      authors: ["Kim", "Park"],
      ids: { doi: doi(`10.5555/p1t23.${String(i + 1)}`) },
    }),
  );
}

describe("blocking keeps a 500-record set far below n²/10 comparisons", () => {
  it("asserts the instrumented comparison counter", () => {
    const records = synthetic();
    expect(records).toHaveLength(500);
    const r = dedupeRecords(records);
    const bound = (500 * 500) / 10;
    expect(r.comparisons).toBeGreaterThan(0);
    expect(r.comparisons).toBeLessThan(bound);
    // 50 buckets of 10 → at most C(10,2) = 45 pairs each.
    expect(r.comparisons).toBeLessThanOrEqual(50 * 45);
    // Trailing-digit variants are a series: forced distinct, so nothing merges.
    expect(r.groups).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
// The yielding form — P2-T30, docs/10 NFR-3
// ---------------------------------------------------------------------------

describe("dedupeRecordsAsync (P2-T30)", () => {
  /** A yield that counts itself and otherwise behaves like the default. */
  function countingYield(): {
    readonly yieldToEventLoop: () => Promise<void>;
    readonly calls: () => number;
  } {
    let calls = 0;
    return {
      yieldToEventLoop: () => {
        calls += 1;
        return new Promise((resolve) => setTimeout(resolve, 0));
      },
      calls: () => calls,
    };
  }

  /**
   * Every fixture the synchronous `dedupeRecords` tests above use, built once
   * so both forms see the very same record objects, plus the two large sets.
   */
  const fixtures: readonly (readonly [string, readonly SourceRecord[]])[] = [
    [
      "transitive identifier trio",
      [
        record({ title: "a", ids: { doi: doi("10.1000/x") } }),
        record({
          title: "b",
          ids: { doi: doi("10.1000/X"), pmid: pmid("42") },
        }),
        record({ title: "c", ids: { pmid: pmid("42") } }),
      ],
    ],
    [
      "flagged pair",
      [
        record({ title: S2_TITLE, year: 2023, authors: ["Theodoris"] }),
        record({
          title: "Transfer learning enables predictions in protein biology",
          year: 2023,
          authors: ["Nobody"],
        }),
      ],
    ],
    [
      "linked pair",
      [
        record({ title: S2_TITLE, year: 2023, ids: { doi: doi("10.1000/a") } }),
        record({ title: S2_TITLE, year: 2023, ids: { doi: doi("10.1000/b") } }),
      ],
    ],
    [
      "mixed seven",
      [
        record({
          title: S2_TITLE,
          year: 2023,
          ids: { doi: doi("10.1038/s41586-023-06139-9") },
        }),
        record({
          title: PUBMED_TITLE,
          year: 2023,
          ids: { pmid: pmid("37258680") },
        }),
        record({
          title: S2_TITLE,
          year: 2023,
          ids: { pmid: pmid("37258680") },
        }),
        record({
          title: "Transfer learning enables predictions in protein biology",
          year: 2023,
        }),
        record({
          type: "preprint",
          title: S2_TITLE,
          year: 2022,
          ids: { doi: doi("10.1101/2022.08.10.503517") },
        }),
        record({
          title: "Studies on the mechanism of enzyme catalysis, Part II",
          year: 1998,
        }),
        record({
          title: "Studies on the mechanism of enzyme catalysis, Part III",
          year: 1998,
        }),
      ],
    ],
    [
      "different title blocks",
      [
        record({ title: "Alpha beta gamma delta epsilon zeta", year: 2020 }),
        record({
          title: "Completely unrelated words here now please",
          year: 2020,
        }),
      ],
    ],
    [
      "same block, years too far apart",
      [
        record({ title: S2_TITLE, year: 2020 }),
        record({ title: S2_TITLE, year: 2020 + MAX_YEAR_DELTA + 1 }),
      ],
    ],
    [
      "same DOI, two spellings",
      [
        record({
          title: PUBMED_TITLE,
          ids: { doi: doi("10.18653/V1/2020.ACL-MAIN.447") },
        }),
        record({
          title: S2_TITLE,
          ids: { doi: doi("10.18653/v1/2020.acl-main.447") },
        }),
      ],
    ],
    [
      "blocking trade-off pair",
      [
        record({ title: S2_TITLE, year: 2023 }),
        record({
          title: "Transfer learning enables prediction in protein biology",
          year: 2023,
        }),
      ],
    ],
    [
      "Korean exact pair (P2-T36)",
      [
        record({ title: KO_TITLE_PUBMED, year: 2023, authors: ["Kim"] }),
        record({ title: KO_TITLE, year: 2023, authors: ["Kim"] }),
      ],
    ],
    [
      "Korean near pair and a Korean flag (P2-T36)",
      [
        record({ title: KO_TITLE, year: 2023, authors: ["Kim"] }),
        record({ title: KO_TITLE_NEAR, year: 2024, authors: ["Lee"] }),
        record({ title: KO_TITLE_FLAG, year: 2023, authors: ["Kim"] }),
      ],
    ],
    [
      "Latin/Korean pair and a second Korean study (P2-T36)",
      [
        record({ title: KO_TITLE, year: 2023, authors: ["Kim"] }),
        record({ title: KO_TITLE_ENGLISH, year: 2023, authors: ["Kim"] }),
        record({ title: KO_TITLE_OTHER, year: 2023, authors: ["Kim"] }),
      ],
    ],
    ["empty", []],
    ["500 records in 50 blocks", synthetic()],
    ["100 records in one block (NFR-1's shape)", oneBlockOfHundred()],
  ];

  it.each(fixtures)(
    "returns a result deep-equal to dedupeRecords on: %s",
    async (_name, records) => {
      const sync = dedupeRecords(records);
      const async = await dedupeRecordsAsync(records);
      expect(async).toEqual(sync);
      // The two share the record objects too, not just their shape.
      expect(async.groups.flatMap((g) => g.records)).toEqual(
        sync.groups.flatMap((g) => g.records),
      );
      expect(async.comparisons).toBe(sync.comparisons);
    },
  );

  it("yields every DEDUP_YIELD_EVERY_COMPARISONS comparisons inside one block", async () => {
    const records = oneBlockOfHundred();
    const counting = countingYield();
    const r = await dedupeRecordsAsync(records, {
      yieldToEventLoop: counting.yieldToEventLoop,
    });
    // One block, nothing in the identifier pass: the yields are the in-block
    // ones plus the boundary yield for the remainder, i.e. the ceiling.
    expect(r.comparisons).toBeGreaterThan(DEDUP_YIELD_EVERY_COMPARISONS);
    expect(counting.calls()).toBe(
      Math.ceil(r.comparisons / DEDUP_YIELD_EVERY_COMPARISONS),
    );
    // And the constant is the measured one: 250 comparisons is about 12 ms
    // on Zotero's main thread at P2-T29's 50 µs a comparison.
    expect(DEDUP_YIELD_EVERY_COMPARISONS).toBe(250);
  });

  it("yields once at the end of every block that compared something", async () => {
    const records = synthetic();
    const counting = countingYield();
    const r = await dedupeRecordsAsync(records, {
      yieldToEventLoop: counting.yieldToEventLoop,
    });
    // 50 blocks of 10, 45 comparisons each — below the in-block interval, so
    // exactly one boundary yield per block.
    expect(r.comparisons).toBe(50 * 45);
    expect(counting.calls()).toBe(50);
  });

  it("does not yield at all when nothing is compared", async () => {
    const counting = countingYield();
    const apart = await dedupeRecordsAsync(
      [
        record({ title: "Alpha beta gamma delta epsilon zeta", year: 2020 }),
        record({
          title: "Completely unrelated words here now please",
          year: 2020,
        }),
      ],
      { yieldToEventLoop: counting.yieldToEventLoop },
    );
    expect(apart.comparisons).toBe(0);
    const empty = await dedupeRecordsAsync([], {
      yieldToEventLoop: counting.yieldToEventLoop,
    });
    expect(empty.groups).toEqual([]);
    expect(counting.calls()).toBe(0);
  });

  it("increments an externally supplied counter in place", async () => {
    const counter = { comparisons: 10 };
    await dedupeRecordsAsync(
      [
        record({ title: "a", ids: { doi: doi("10.1000/x") } }),
        record({ title: "b", ids: { doi: doi("10.1000/x") } }),
      ],
      { counter },
    );
    expect(counter.comparisons).toBe(11);
  });

  it("stops at the next yield once the token is cancelled, with OperationCancelledError", async () => {
    const records = oneBlockOfHundred();
    const source = createCancellationTokenSource();
    const counter = { comparisons: 0 };
    let yields = 0;
    const cancelOnSecondYield = (): Promise<void> => {
      yields += 1;
      if (yields === 2) source.cancel({ kind: "user" });
      return new Promise((resolve) => setTimeout(resolve, 0));
    };
    await expect(
      dedupeRecordsAsync(records, {
        counter,
        token: source.token,
        yieldToEventLoop: cancelOnSecondYield,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    // Exactly two slices ran: the cancel landed inside the second yield and
    // was seen right after it, before a third slice could start.
    expect(yields).toBe(2);
    expect(counter.comparisons).toBe(2 * DEDUP_YIELD_EVERY_COMPARISONS);
    expect(counter.comparisons).toBeLessThan(
      dedupeRecords(records).comparisons,
    );
  });

  it("rejects on entry for an already-cancelled token, before any comparison", async () => {
    const source = createCancellationTokenSource();
    source.cancel({ kind: "shutdown" });
    const counter = { comparisons: 0 };
    const counting = countingYield();
    await expect(
      dedupeRecordsAsync(oneBlockOfHundred(), {
        counter,
        token: source.token,
        yieldToEventLoop: counting.yieldToEventLoop,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(counter.comparisons).toBe(0);
    expect(counting.calls()).toBe(0);
  });

  it("the default yield is a macrotask, so the event loop runs in between", async () => {
    // A timer queued before the yield has fired by the time the yield
    // resolves; a microtask yield (`await Promise.resolve()`) would resolve
    // first and leave the main thread exactly as blocked as before.
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);
    await defaultYieldToEventLoop();
    expect(timerFired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The existing-library index — docs/02 §11.6, FR-51
// ---------------------------------------------------------------------------

describe("buildLibraryIndex / matchAgainstLibrary", () => {
  const library: LibraryItemFields[] = [
    {
      itemID: 1,
      deleted: false,
      doi: "https://doi.org/10.1056/NEJMoa2300709",
      title: "Tirzepatide once weekly for the treatment of obesity",
      year: 2022,
    },
    {
      itemID: 2,
      deleted: false,
      pmid: "37258680",
      title: PUBMED_TITLE,
      year: 2023,
      firstAuthorFamily: "Theodoris",
      containerTitle: "Nature",
    },
    {
      itemID: 3,
      deleted: true,
      doi: "10.1101/2025.09.17.676679",
      title: "A trashed preprint about something",
      year: 2025,
      isPreprint: true,
    },
    {
      itemID: 4,
      deleted: false,
      pmcid: "10949956",
      title: "Something with only a PMCID in extra",
      year: 2024,
    },
    {
      itemID: 5,
      deleted: false,
      arxivId: "arXiv:2106.15928v2",
      title: "Evaluating large language models trained on code",
      year: 2021,
      isPreprint: true,
    },
    {
      itemID: 6,
      deleted: false,
      title:
        "Machine learning approaches for predicting protein structure from sequence",
      year: 2022,
      firstAuthorFamily: "Jumper",
    },
  ];
  const index = buildLibraryIndex(library);

  it("indexes every live item and skips the trashed one", () => {
    expect(index.indexed).toBe(5);
    expect(index.skippedTrashed).toBe(1);
    expect(index.byDoi.get("10.1056/nejmoa2300709")).toBe(1);
    expect(index.byDoi.has("10.1101/2025.09.17.676679")).toBe(false);
    expect(index.byPmid.get("37258680")).toBe(2);
    expect(index.byPmcid.get("PMC10949956")).toBe(4);
    expect(index.byArxiv.get("2106.15928")).toBe(5);
    expect(index.byTitle.get(normalizeTitle(PUBMED_TITLE))).toEqual([2]);
  });

  it("matches an incoming record by DOI (FR-51) regardless of year", () => {
    const incoming = record({
      title: "Tirzepatide once weekly for the treatment of obesity",
      year: 2025,
      ids: { doi: doi("10.1056/nejmoa2300709") },
    });
    const m = matchAgainstLibrary(incoming, index);
    expect(m?.itemID).toBe(1);
    expect(m?.decision).toMatchObject({ verdict: "match", tier: "doi" });
  });

  it("matches by PMID, by bare-vs-prefixed PMCID and by version-stripped arXiv id", () => {
    expect(
      matchAgainstLibrary(
        record({ title: "x", ids: { pmid: pmid("37258680") } }),
        index,
      )?.itemID,
    ).toBe(2);
    expect(
      matchAgainstLibrary(
        record({ title: "x", ids: { pmcid: pmcid("PMC10949956") } }),
        index,
      )?.itemID,
    ).toBe(4);
    expect(
      matchAgainstLibrary(
        record({ title: "x", ids: { arxivId: arxiv("2106.15928") } }),
        index,
      )?.itemID,
    ).toBe(5);
  });

  it("does not match the trashed item's DOI, so it can be re-recommended", () => {
    const incoming = record({
      type: "preprint",
      title: "A trashed preprint about something",
      year: 2025,
      ids: { doi: doi("10.64898/2025.09.17.676679") },
    });
    expect(matchAgainstLibrary(incoming, index)).toBeNull();
  });

  it("matches on exact normalized title within the year tolerance", () => {
    const incoming = record({
      source: "semanticscholar",
      title: S2_TITLE,
      year: 2023,
    });
    const m = matchAgainstLibrary(incoming, index);
    expect(m?.itemID).toBe(2);
    expect(m?.decision.tier).toBe("title-exact");
    expect(m?.decision.verdict).toBe("match");
  });

  it("flags a fuzzy title hit instead of matching it", () => {
    // Short words changed only, so the blocking signature matches item 6's.
    const incoming = record({
      title:
        "Machine learning approaches in predicting protein structure using sequence",
      year: 2022,
      authors: ["Hassabis"],
    });
    const m = matchAgainstLibrary(incoming, index);
    expect(m?.itemID).toBe(6);
    expect(m?.decision.verdict).toBe("flag");
  });

  it("returns null when nothing in the library is close", () => {
    const incoming = record({
      title: "Single-cell atlas of the human heart across development",
      year: 2023,
    });
    expect(matchAgainstLibrary(incoming, index)).toBeNull();
  });

  it("accepts a prebuilt candidate and counts comparisons", () => {
    const counter = { comparisons: 0 };
    const c = toCandidate(record({ title: S2_TITLE, year: 2023 }));
    expect(matchAgainstLibrary(c, index, counter)?.itemID).toBe(2);
    expect(counter.comparisons).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Constants and the §11.2 prefix set
// ---------------------------------------------------------------------------

describe("thresholds are exported constants", () => {
  it("every threshold is a number reachable by name", () => {
    for (const v of [
      LEVSIM_DUPLICATE_THRESHOLD,
      LEVSIM_CORROBORATED_THRESHOLD,
      JACCARD_CORROBORATED_THRESHOLD,
      JACCARD_REORDER_THRESHOLD,
      LEVSIM_FLAG_THRESHOLD,
      MAX_YEAR_DELTA,
      MIN_FUZZY_TITLE_TOKENS,
      SIGNATURE_TOKEN_COUNT,
    ]) {
      expect(typeof v).toBe("number");
    }
    expect(Object.isFrozen(TIER_CONFIDENCE)).toBe(true);
    expect(Object.values(TIER_CONFIDENCE).every((v) => v > 0 && v <= 1)).toBe(
      true,
    );
  });

  it("starts from docs/02 §11.3.3's published values", () => {
    expect(LEVSIM_DUPLICATE_THRESHOLD).toBe(0.95);
    expect(LEVSIM_CORROBORATED_THRESHOLD).toBe(0.88);
    expect(JACCARD_CORROBORATED_THRESHOLD).toBe(0.8);
    expect(JACCARD_REORDER_THRESHOLD).toBe(0.9);
    expect(LEVSIM_FLAG_THRESHOLD).toBe(0.8);
    expect(MAX_YEAR_DELTA).toBe(1);
    expect(MIN_FUZZY_TITLE_TOKENS).toBe(5);
  });
});

describe("preprint DOI prefixes (docs/02 §11.2)", () => {
  it("is the five-member set, and the accession pair is a subset", () => {
    expect([...PREPRINT_DOI_PREFIXES].sort()).toEqual(
      ["10.1101/", "10.64898/", "10.48550/", "10.21203/", "10.2139/"].sort(),
    );
    for (const p of BIORXIV_ACCESSION_PREFIXES) {
      expect(PREPRINT_DOI_PREFIXES.has(p)).toBe(true);
    }
    expect(isPreprintDoi("10.64898/2026.08.20.745440")).toBe(true);
    expect(isPreprintDoi("10.1101/2025.09.17.676679")).toBe(true);
    expect(isPreprintDoi("10.1056/nejmoa2300709")).toBe(false);
  });

  it("the engine never tests a single legacy prefix", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../../src/sources/shared/dedupe.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/startsWith\(\s*["']10\.1101\//);
  });
});
