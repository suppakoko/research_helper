import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { OperationCancelledError } from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { WorkType } from "../../../src/model/canonicalWork";
import {
  normalizeArxivId,
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
