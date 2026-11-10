import { describe, expect, it } from "vitest";

import type {
  Author,
  CanonicalWork,
  WorkType,
} from "../../../src/model/canonicalWork";
import {
  normalizeDoi,
  type Doi,
  type EpmcId,
  type ExternalIds,
  type Pmid,
  type SourceId,
} from "../../../src/model/ids";
import { merge, type IdConflict } from "../../../src/model/merge";
import {
  isSourceRecord,
  type SourceRecord,
} from "../../../src/model/sourceRecord";
import {
  attributeDeduplicatedAway,
  dedupeAndMerge,
  mergeDecisionsOf,
  SUPERSEDED_BY_PUBLISHED_TAG,
} from "../../../src/pipeline/searchImport/stages";
import type { SearchImportSourceReport } from "../../../src/pipeline/searchImport/types";

/**
 * `P2-T10`. Layer 1 (docs/13 §2.1): plain Node, no Zotero, no network.
 *
 * Three subjects. (1) `merge()`'s **combination rules** — `docs/07` §5.1's
 * "longest non-truncated title", "most complete author list wholesale",
 * "earliest *complete* date", "highest citation count", "ids unioned, never
 * overwritten" — each exercised where the quality rule and the `docs/02`
 * §10.4 ordering would disagree, so a test that passes proves the rule and
 * not the ordering (`precedence.test.ts` proves the ordering). (2) The
 * provenance and determinism criteria on the card. (3) The stage hookup in
 * `stages.ts`: `dedupeAndMerge` calls the cascade once and `merge()` per
 * group, and a `"flag"` or `"link"` pair is **never** merged — gate `G-16`'s
 * decision that a preprint and its published version stay two linked works.
 * The hookup's tests live here because the card's `Files` lists no pipeline
 * test file.
 */

const AT = 1_700_000_000_000;

interface Spec {
  readonly source: SourceId;
  readonly nativeId?: string;
  readonly title?: string;
  readonly abstract?: string;
  readonly authors?: readonly Author[];
  readonly type?: WorkType;
  readonly date?: { year: number; month?: number; day?: number };
  readonly container?: string;
  readonly citations?: number;
  readonly ids?: ExternalIds;
  readonly related?: ExternalIds;
  readonly url?: string;
}

function iso(d: { year: number; month?: number; day?: number }): string {
  const mm =
    d.month === undefined ? "" : `-${String(d.month).padStart(2, "0")}`;
  const dd = d.day === undefined ? "" : `-${String(d.day).padStart(2, "0")}`;
  return `${String(d.year)}${mm}${dd}`;
}

let serial = 0;

/** A `SourceRecord` with the spec's fields and nothing else. */
function record(spec: Spec): SourceRecord {
  serial += 1;
  const nativeId = spec.nativeId ?? `n${String(serial)}`;
  return {
    id: `${spec.source}:${nativeId}`,
    sourceId: spec.source,
    nativeId,
    work: {
      ids: spec.ids ?? {},
      type: spec.type ?? "journal-article",
      title: spec.title ?? "A sufficiently long shared title for the cascade",
      authors: spec.authors ?? [{ family: "Lee", given: "A" }],
      ...(spec.abstract !== undefined && { abstract: spec.abstract }),
      ...(spec.date !== undefined && {
        publishedDate: { ...spec.date, iso: iso(spec.date) },
      }),
      ...(spec.container !== undefined && { containerTitle: spec.container }),
      ...(spec.citations !== undefined && { citationCount: spec.citations }),
      ...(spec.related !== undefined && { relatedVersionIds: spec.related }),
      ...(spec.url !== undefined && { url: spec.url }),
    },
    retrievedAtEpochMs: AT,
    missingFields: [],
  };
}

const doi = (s: string): Doi => {
  const d = normalizeDoi(s);
  if (d === null) throw new Error(`fixture DOI must normalize: ${s}`);
  return d;
};
const pmid = (s: string): Pmid => s as Pmid;

/** Every ordering of `items` (small `n` only). */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

// ---------------------------------------------------------------------------
// 1. Combination rules — docs/07 §5.1
// ---------------------------------------------------------------------------

describe("title — longest non-truncated, ties on precedence", () => {
  it("a longer title from a lower-precedence source beats Crossref's", () => {
    const { work } = merge(
      [
        record({ source: "crossref", title: "Short title" }),
        record({
          source: "arxiv",
          title: "Short title with its subtitle intact",
        }),
      ],
      AT,
    );
    expect(work.title).toBe("Short title with its subtitle intact");
    expect(work.provenance.fieldOrigin["title"]).toBe("arxiv");
  });

  it("a truncated title loses even when it is the longest", () => {
    const { work } = merge(
      [
        record({
          source: "semanticscholar",
          title: "A long title that was cut off by the…",
        }),
        record({ source: "pubmed", title: "A long title." }),
      ],
      AT,
    );
    expect(work.title).toBe("A long title.");
    expect(work.provenance.fieldOrigin["title"]).toBe("pubmed");
  });

  it("PubMed's trailing `.` does not buy it the longest-title verdict over Crossref", () => {
    const { work } = merge(
      [
        record({ source: "pubmed", title: "Base editing of the liver." }),
        record({ source: "crossref", title: "Base editing of the liver" }),
      ],
      AT,
    );
    expect(work.title).toBe("Base editing of the liver");
    expect(work.provenance.fieldOrigin["title"]).toBe("crossref");
  });

  it("returns the winner's title verbatim — merging chooses, it does not rewrite", () => {
    const { work } = merge(
      [record({ source: "pubmed", title: "Kept as is." })],
      AT,
    );
    expect(work.title).toBe("Kept as is.");
  });
});

describe("abstract — longest non-empty", () => {
  it("a longer Crossref abstract beats a shorter Europe PMC one", () => {
    const { work } = merge(
      [
        record({ source: "europepmc", abstract: "Short." }),
        record({
          source: "crossref",
          abstract: "A much longer abstract with real content.",
        }),
      ],
      AT,
    );
    expect(work.abstract).toBe("A much longer abstract with real content.");
    expect(work.provenance.fieldOrigin["abstract"]).toBe("crossref");
  });

  it("an empty abstract is not a candidate", () => {
    const { work } = merge(
      [
        record({ source: "europepmc", abstract: "   " }),
        record({ source: "arxiv", abstract: "x" }),
      ],
      AT,
    );
    expect(work.abstract).toBe("x");
    // One real supplier: not contested, so not recorded.
    expect(work.provenance.fieldOrigin["abstract"]).toBeUndefined();
  });
});

describe("authors — most complete list wins wholesale, never interleaved", () => {
  it("a longer Semantic Scholar list beats PubMed's shorter one, taken whole", () => {
    const s2: Author[] = [
      { family: "Kim", given: "J." },
      { family: "Park" },
      { family: "Choi" },
    ];
    const { work } = merge(
      [
        record({
          source: "pubmed",
          authors: [{ family: "Kim", given: "Jisoo" }, { family: "Park" }],
        }),
        record({ source: "semanticscholar", authors: s2 }),
      ],
      AT,
    );
    expect(work.authors).toEqual(s2);
    expect(work.provenance.fieldOrigin["authors"]).toBe("semanticscholar");
  });

  it("equal length: the list with more ORCIDs wins", () => {
    const withOrcid: Author[] = [
      { family: "Kim", orcid: "0000-0002-1825-0097" },
      { family: "Park" },
    ];
    const { work } = merge(
      [
        record({
          source: "pubmed",
          authors: [{ family: "Kim" }, { family: "Park" }],
        }),
        record({ source: "crossref", authors: withOrcid }),
      ],
      AT,
    );
    expect(work.authors).toEqual(withOrcid);
    expect(work.provenance.fieldOrigin["authors"]).toBe("crossref");
  });

  it("equal length and ORCIDs: Semantic Scholar never wins (abbreviated given names)", () => {
    const { work } = merge(
      [
        record({
          source: "semanticscholar",
          authors: [{ family: "Kim", given: "J." }],
        }),
        record({
          source: "arxiv",
          authors: [{ family: "Kim", given: "Jisoo" }],
        }),
      ],
      AT,
    );
    expect(work.authors).toEqual([{ family: "Kim", given: "Jisoo" }]);
    expect(work.provenance.fieldOrigin["authors"]).toBe("arxiv");
  });
});

describe("publishedDate — earliest complete date; year-only never overrides a full date", () => {
  it("a full date from the last-ranked source beats an earlier year-only date from the first", () => {
    const { work } = merge(
      [
        record({ source: "europepmc", date: { year: 2023 } }),
        record({
          source: "semanticscholar",
          date: { year: 2024, month: 2, day: 9 },
        }),
      ],
      AT,
    );
    expect(work.publishedDate).toEqual({
      year: 2024,
      month: 2,
      day: 9,
      iso: "2024-02-09",
    });
    expect(work.provenance.fieldOrigin["publishedDate"]).toBe(
      "semanticscholar",
    );
  });

  it("among full dates the earliest wins, whatever the source rank", () => {
    const { work } = merge(
      [
        record({ source: "europepmc", date: { year: 2024, month: 3, day: 1 } }),
        record({ source: "crossref", date: { year: 2024, month: 2, day: 28 } }),
      ],
      AT,
    );
    expect(work.publishedDate?.iso).toBe("2024-02-28");
    expect(work.provenance.fieldOrigin["publishedDate"]).toBe("crossref");
  });

  it("a month-precise date beats a year-only one and loses to a day-precise one", () => {
    const { work } = merge(
      [
        record({ source: "pubmed", date: { year: 2022 } }),
        record({ source: "crossref", date: { year: 2024, month: 1 } }),
        record({ source: "arxiv", date: { year: 2024, month: 5, day: 5 } }),
      ],
      AT,
    );
    expect(work.publishedDate?.iso).toBe("2024-05-05");
  });
});

describe("citationCount — highest, origin recorded", () => {
  it("Crossref's higher count beats Semantic Scholar's lower one", () => {
    const { work } = merge(
      [
        record({ source: "semanticscholar", citations: 10 }),
        record({ source: "crossref", citations: 12 }),
      ],
      AT,
    );
    expect(work.citationCount).toBe(12);
    expect(work.provenance.fieldOrigin["citationCount"]).toBe("crossref");
  });
});

describe("ids — union, never overwritten", () => {
  it("two records with conflicting DOIs produce an IdConflict and the kept DOI is the higher-precedence source's", () => {
    const { work, conflicts } = merge(
      [
        record({
          source: "arxiv",
          ids: { doi: doi("10.48550/arxiv.2401.00001") },
        }),
        record({
          source: "crossref",
          ids: { doi: doi("10.1038/s41586-024-00001-0") },
        }),
      ],
      AT,
    );
    expect(work.ids.doi).toBe("10.1038/s41586-024-00001-0");
    expect(conflicts).toEqual<IdConflict[]>([
      {
        field: "ids.doi",
        kept: "10.1038/s41586-024-00001-0",
        keptFrom: "crossref",
        rejected: [{ value: "10.48550/arxiv.2401.00001", sourceId: "arxiv" }],
      },
    ]);
    expect(work.provenance.fieldOrigin["ids.doi"]).toBe("crossref");
  });

  it("agreeing ids are unioned without a conflict; `url` differences are not conflicts", () => {
    const { work, conflicts } = merge(
      [
        record({
          source: "pubmed",
          ids: { pmid: pmid("1"), url: "https://pubmed.example/1" },
        }),
        record({
          source: "crossref",
          ids: {
            doi: doi("10.1000/x"),
            pmid: pmid("1"),
            url: "https://doi.example/x",
          },
        }),
      ],
      AT,
    );
    expect(work.ids).toEqual({
      doi: "10.1000/x",
      pmid: "1",
      url: "https://doi.example/x",
    });
    expect(conflicts).toEqual([]);
  });

  it("the kept identifier is the first in precedence order, not the first in input order", () => {
    const a = record({ source: "semanticscholar", ids: { pmid: pmid("111") } });
    const b = record({ source: "pubmed", ids: { pmid: pmid("222") } });
    expect(merge([a, b], AT).work.ids.pmid).toBe("222");
    expect(merge([b, a], AT).work.ids.pmid).toBe("222");
  });
});

// ---------------------------------------------------------------------------
// 2. Provenance, key, determinism — the card's criteria
// ---------------------------------------------------------------------------

/** The same work from five sources, every contested field supplied by all. */
function fiveSourceCorpus(): SourceRecord[] {
  const base = {
    title: "Programmable base editing of A to G in genomic DNA",
    abstract: "We describe base editors that convert A to G.",
    authors: [{ family: "Gaudelli" }, { family: "Liu" }] as Author[],
    date: { year: 2017, month: 11, day: 23 },
    citations: 3000,
    ids: { doi: doi("10.1038/NATURE24644") },
  };
  return [
    record({
      source: "pubmed",
      ...base,
      ids: { ...base.ids, pmid: pmid("29160308") },
    }),
    record({
      source: "europepmc",
      ...base,
      abstract: `${base.abstract} Extended.`,
    }),
    record({ source: "crossref", ...base, citations: 2900 }),
    record({ source: "semanticscholar", ...base, citations: 3100 }),
    record({ source: "arxiv", ...base, title: `${base.title}.` }),
  ];
}

describe("relatedVersionIds.epmcId — carried through the merge (P2-T34)", () => {
  // `docs/07` §5.1's `ExternalIds.epmcId`, 2026-10-15: Europe PMC's mapper
  // sets it on a published record that names its preprint, and every work —
  // a singleton included — passes through `merge()`, so a union that did not
  // list the key would drop it before it reached the pipeline's output.
  const epmcId = "PPR578427" as EpmcId;

  it("keeps it on a singleton", () => {
    const { work } = merge(
      [record({ source: "europepmc", related: { epmcId } })],
      AT,
    );
    expect(work.relatedVersionIds).toEqual({ epmcId });
  });

  it("unions it with another record's pointer in a group", () => {
    const shared = doi("10.1000/p2t34");
    const { work } = merge(
      [
        record({
          source: "europepmc",
          ids: { doi: shared },
          related: { epmcId },
        }),
        record({
          source: "crossref",
          ids: { doi: shared },
          related: { doi: doi("10.1101/2023.01.01.000001") },
        }),
      ],
      AT,
    );
    expect(work.relatedVersionIds).toEqual({
      doi: "10.1101/2023.01.01.000001",
      epmcId,
    });
  });
});

describe("provenance", () => {
  it("fieldOrigin names a SourceId for title, abstract, authors, publishedDate and citationCount", () => {
    const { work } = merge(fiveSourceCorpus(), AT);
    for (const field of [
      "title",
      "abstract",
      "authors",
      "publishedDate",
      "citationCount",
    ]) {
      expect(work.provenance.fieldOrigin[field], field).toBeDefined();
    }
    expect(work.provenance.fieldOrigin["abstract"]).toBe("europepmc");
    expect(work.provenance.fieldOrigin["citationCount"]).toBe(
      "semanticscholar",
    );
    expect(work.provenance.fieldOrigin["publishedDate"]).toBe("europepmc");
    expect(work.provenance.fieldOrigin["authors"]).toBe("pubmed");
  });

  it("recordIds lists every contributor in merge order and seenIn every source once", () => {
    const corpus = fiveSourceCorpus();
    const { work } = merge([...corpus].reverse(), AT);
    const idOf = (source: SourceId): string | undefined =>
      corpus.find((r) => r.sourceId === source)?.id;
    expect(work.provenance.recordIds).toEqual(
      ["crossref", "pubmed", "europepmc", "semanticscholar", "arxiv"].map((s) =>
        idOf(s as SourceId),
      ),
    );
    expect(work.provenance.recordIds.every((id) => id !== undefined)).toBe(
      true,
    );
    expect(work.provenance.seenIn).toEqual([
      "crossref",
      "pubmed",
      "europepmc",
      "semanticscholar",
      "arxiv",
    ]);
  });

  it("seenIn is deduplicated when one source returned the same work twice", () => {
    const { work } = merge(
      [
        record({ source: "pubmed", nativeId: "a" }),
        record({ source: "pubmed", nativeId: "b" }),
      ],
      AT,
    );
    expect(work.provenance.seenIn).toEqual(["pubmed"]);
    expect(work.provenance.recordIds).toEqual(["pubmed:a", "pubmed:b"]);
  });

  it("a single record merges with an empty fieldOrigin — nothing was contested", () => {
    const { work } = merge(
      [record({ source: "pubmed", abstract: "x", citations: 1 })],
      AT,
    );
    expect(work.provenance.fieldOrigin).toEqual({});
  });
});

describe("workKey", () => {
  it("for a DOI-bearing work is `doi:<lowercased doi>`, exactly", () => {
    const { work } = merge(fiveSourceCorpus(), AT);
    expect(work.workKey).toBe("doi:10.1038/nature24644");
  });

  it("falls back to the prefixed PMID when no DOI is present", () => {
    const { work } = merge(
      [record({ source: "pubmed", ids: { pmid: pmid("42") } })],
      AT,
    );
    expect(work.workKey).toBe("pmid:42");
  });
});

describe("determinism and purity", () => {
  it("every permutation of a 4-record set produces a byte-identical CanonicalWork", () => {
    const four = fiveSourceCorpus().slice(0, 4);
    const perms = permutations(four);
    expect(perms).toHaveLength(24);
    const reference = JSON.stringify(merge(four, AT).work);
    for (const p of perms) {
      expect(JSON.stringify(merge(p, AT).work)).toBe(reference);
    }
  });

  it("stamps the caller's normalizedAtEpochMs and reads no clock", () => {
    const corpus = fiveSourceCorpus();
    const a = merge(corpus, 1);
    const b = merge(corpus, 1);
    expect(a.work.normalizedAtEpochMs).toBe(1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(merge(corpus, 2).work.normalizedAtEpochMs).toBe(2);
  });

  it("does not mutate its input", () => {
    const corpus = fiveSourceCorpus();
    const before = JSON.stringify(corpus);
    merge(corpus, AT);
    expect(JSON.stringify(corpus)).toBe(before);
  });

  it("rejects an empty group and a malformed record", () => {
    expect(() => merge([], AT)).toThrow(RangeError);
    const bad = {
      ...record({ source: "pubmed" }),
      sourceId: "scholar-x",
    } as unknown as SourceRecord;
    expect(() => merge([bad], AT)).toThrow(TypeError);
  });
});

describe("isSourceRecord", () => {
  const good = record({ source: "crossref", ids: { doi: doi("10.1000/y") } });

  it("accepts a well-formed record", () => {
    expect(isSourceRecord(good)).toBe(true);
  });

  it.each([
    ["not an object", 7],
    ["empty id", { ...good, id: "" }],
    ["unknown sourceId", { ...good, sourceId: "google-scholar" }],
    ["non-string nativeId", { ...good, nativeId: 1 }],
    [
      "work without title",
      { ...good, work: { ...good.work, title: undefined } },
    ],
    ["work with bad type", { ...good, work: { ...good.work, type: "paper" } }],
    [
      "author without family",
      { ...good, work: { ...good.work, authors: [{ given: "A" }] } },
    ],
    ["ids not an object", { ...good, work: { ...good.work, ids: null } }],
    ["non-finite retrievedAt", { ...good, retrievedAtEpochMs: Number.NaN }],
    ["missingFields not strings", { ...good, missingFields: [1] }],
  ])("rejects %s", (_label, value) => {
    expect(isSourceRecord(value)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The stage hookup — stages.ts's dedupeAndMerge
// ---------------------------------------------------------------------------

describe("mergeDecisionsOf — FR-50 scenario 2's record (P2-T34)", () => {
  it("lists each match decision with its merged work's key, tier, confidence and evidence; a singleton adds none", () => {
    const shared = doi("10.1000/p2t34-decisions");
    const result = dedupeAndMerge(
      [
        record({ source: "pubmed", ids: { doi: shared } }),
        record({ source: "crossref", ids: { doi: shared } }),
        record({
          source: "pubmed",
          title: "A wholly different and unrelated paper about something else",
          ids: { doi: doi("10.1000/p2t34-alone") },
        }),
      ],
      AT,
    );
    expect(result.merged).toHaveLength(2);
    expect(mergeDecisionsOf(result)).toStrictEqual([
      {
        workKey: `doi:${shared}`,
        tier: "doi",
        confidence: 1,
        evidence: { doi: shared },
      },
    ]);
  });

  it("is [] when nothing merged", () => {
    const result = dedupeAndMerge(
      [record({ source: "pubmed", ids: { doi: doi("10.1000/p2t34-one") } })],
      AT,
    );
    expect(mergeDecisionsOf(result)).toStrictEqual([]);
  });
});

describe("dedupeAndMerge", () => {
  const sharedTitle =
    "Adenine base editors convert A to G in genomic DNA without cleavage";

  it("one group from two sources sharing a DOI becomes one work with filled provenance", () => {
    const a = record({
      source: "pubmed",
      title: sharedTitle,
      ids: { doi: doi("10.1000/one") },
      abstract: "short",
    });
    const b = record({
      source: "crossref",
      title: sharedTitle,
      ids: { doi: doi("10.1000/one") },
      abstract: "a longer abstract",
    });
    const result = dedupeAndMerge([a, b], AT);
    expect(result.works).toHaveLength(1);
    expect(result.records).toEqual([a]);
    expect(result.works[0]?.abstract).toBe("a longer abstract");
    expect(result.works[0]?.provenance.seenIn).toEqual(["crossref", "pubmed"]);
    expect(result.works[0]?.provenance.fieldOrigin["abstract"]).toBe(
      "crossref",
    );
    expect(result.merged[0]?.decisions.map((d) => d.tier)).toEqual(["doi"]);
    expect(result.merged[0]?.records).toEqual([a, b]);
    expect(result.recordsDeduplicatedAway).toBe(1);
    expect(result.deduplicatedAwayBySource).toEqual({ crossref: 1 });
    expect(result.flags).toEqual([]);
    expect(result.links).toEqual([]);
  });

  it("a preprint and its published version stay two works, linked, never merged", () => {
    const published = record({
      source: "crossref",
      title: sharedTitle,
      ids: { doi: doi("10.1038/s41586-024-07000-0") },
      date: { year: 2024 },
    });
    const preprint = record({
      source: "biorxiv",
      type: "preprint",
      title: sharedTitle,
      ids: { doi: doi("10.1101/2023.12.01.569000") },
      related: { doi: doi("10.1038/s41586-024-07000-0") },
      date: { year: 2023 },
    });
    const result = dedupeAndMerge([published, preprint], AT);
    expect(result.works).toHaveLength(2);
    expect(result.recordsDeduplicatedAway).toBe(0);
    expect(result.links).toHaveLength(1);
    const link = result.links[0];
    expect(link?.decision.verdict).toBe("link");
    expect(link?.decision.tier).toBe("version-link");
    expect(link?.preprintWorkKey).toBe("doi:10.1101/2023.12.01.569000");
    expect(new Set([link?.aWorkKey, link?.bWorkKey])).toEqual(
      new Set([
        "doi:10.1038/s41586-024-07000-0",
        "doi:10.1101/2023.12.01.569000",
      ]),
    );
    // Each work points at the other; neither absorbed the other's record.
    const pub = result.works.find((w) => w.workKey.startsWith("doi:10.1038/"));
    const pre = result.works.find((w) => w.workKey.startsWith("doi:10.1101/"));
    expect(pub?.relatedVersionIds?.doi).toBe("10.1101/2023.12.01.569000");
    expect(pre?.relatedVersionIds?.doi).toBe("10.1038/s41586-024-07000-0");
    expect(pub?.provenance.recordIds).toEqual([published.id]);
    expect(pre?.provenance.recordIds).toEqual([preprint.id]);
    expect(pre?.type).toBe("preprint");
  });

  it("a title match with conflicting DOIs is downgraded to a link, not merged (§11.5 rule 1)", () => {
    const a = record({
      source: "pubmed",
      title: sharedTitle,
      ids: { doi: doi("10.1000/aaa") },
      date: { year: 2024 },
    });
    const b = record({
      source: "crossref",
      title: sharedTitle,
      ids: { doi: doi("10.1000/bbb") },
      date: { year: 2024 },
    });
    const result = dedupeAndMerge([a, b], AT);
    expect(result.works).toHaveLength(2);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]?.decision.evidence["conflictingIds"]).toBe("doi");
    expect(result.links[0]?.preprintWorkKey).toBeUndefined();
    expect(result.works.map((w) => w.ids.doi).sort()).toEqual([
      "10.1000/aaa",
      "10.1000/bbb",
    ]);
  });

  it("a flagged pair reaches the review list and never the merge", () => {
    const article = record({
      source: "pubmed",
      title: sharedTitle,
      date: { year: 2024 },
    });
    const preprint = record({
      source: "arxiv",
      type: "preprint",
      title: sharedTitle,
      date: { year: 2024 },
    });
    const result = dedupeAndMerge([article, preprint], AT);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]?.decision.verdict).toBe("flag");
    expect(result.flags[0]?.decision.evidence["preprintPair"]).toBe(true);
    expect(result.works).toHaveLength(2);
    expect(result.links).toEqual([]);
    expect(result.recordsDeduplicatedAway).toBe(0);
    expect(result.works.every((w) => w.provenance.recordIds.length === 1)).toBe(
      true,
    );
  });

  it("keeps records and works positionally aligned, representatives in fetch order", () => {
    const x1 = record({
      source: "pubmed",
      title: "First distinct work about something else entirely",
      ids: { pmid: pmid("1") },
    });
    const y1 = record({
      source: "crossref",
      title: sharedTitle,
      ids: { doi: doi("10.1000/y") },
    });
    const x2 = record({
      source: "crossref",
      title: "First distinct work about something else entirely",
      ids: { pmid: pmid("1") },
    });
    const result = dedupeAndMerge([x1, y1, x2], AT);
    expect(result.records).toEqual([x1, y1]);
    expect(result.works.map((w) => w.workKey)).toEqual([
      "pmid:1",
      "doi:10.1000/y",
    ]);
    expect(result.deduplicatedAwayBySource).toEqual({ crossref: 1 });
  });

  it("attributeDeduplicatedAway re-stamps each source's count and leaves the rest alone", () => {
    const reports: SearchImportSourceReport[] = (
      ["pubmed", "crossref", "arxiv"] as const
    ).map((sourceId) => ({
      sourceId,
      transmittedQuery: `q-${sourceId}`,
      requestedLimit: 10,
      dateFilterApplied: "none",
      recordsRetrieved: 3,
      droppedOutOfWindow: 0,
      keptWithoutDate: 0,
      recordsDeduplicatedAway: 0,
      error: undefined,
      warnings: [],
    }));
    const stamped = attributeDeduplicatedAway(reports, {
      deduplicatedAwayBySource: { crossref: 2 },
    });
    expect(stamped.map((r) => r.recordsDeduplicatedAway)).toEqual([0, 2, 0]);
    expect(stamped.map((r) => r.transmittedQuery)).toEqual([
      "q-pubmed",
      "q-crossref",
      "q-arxiv",
    ]);
    expect(stamped[1]).toEqual({ ...reports[1], recordsDeduplicatedAway: 2 });
  });

  it("names the tag the zotero layer puts on the superseded preprint", () => {
    expect(SUPERSEDED_BY_PUBLISHED_TAG).toBe(
      "research_helper/superseded-by-published",
    );
  });

  it("an empty fetch merges to nothing", () => {
    const result = dedupeAndMerge([], AT);
    expect(result.works).toEqual([]);
    expect(result.recordsDeduplicatedAway).toBe(0);
  });
});

/** Compile-time: the merge's output is a full `CanonicalWork`. */
const _typeCheck: CanonicalWork = merge(
  [record({ source: "pubmed" })],
  AT,
).work;
void _typeCheck;

// ---------------------------------------------------------------------------
// P2-T38 — a review document yields to its paper (docs/07 §5.1's merge note
// of 2026-11-10, owner, plan/00 §6 item 362(b))
// ---------------------------------------------------------------------------

describe("a review document yields to its paper (P2-T38)", () => {
  const LEISH =
    "Gene editing and scalable functional genomic screening in Leishmania species using the CRISPR/Cas9 cytosine base editor toolbox LeishBASEedit";
  const article = (): SourceRecord =>
    record({
      source: "crossref",
      nativeId: "10.7554/elife.85605",
      title: LEISH,
      type: "journal-article",
      abstract: "The article's abstract.",
      authors: [
        { family: "Engstler", given: "M" },
        { family: "Beneke", given: "T" },
      ],
      date: { year: 2023, month: 5, day: 2 },
      container: "eLife",
      ids: { doi: doi("10.7554/elife.85605") },
    });
  const response = (): SourceRecord =>
    record({
      source: "crossref",
      nativeId: "10.7554/elife.85605.sa2",
      title: `Author response: ${LEISH}`,
      type: "other",
      abstract: "A much longer author response text than the article abstract.",
      authors: [
        { family: "Engstler", given: "M" },
        { family: "Beneke", given: "T" },
        { family: "Third", given: "X" },
      ],
      date: { year: 2023, month: 1, day: 10 },
      ids: { doi: doi("10.7554/elife.85605.sa2") },
    });

  it("keeps the article's title, type, DOI, authors, date and abstract, in every input order", () => {
    for (const order of permutations([article(), response()])) {
      const { work, conflicts } = merge(order, AT);
      expect(work.title).toBe(LEISH);
      expect(work.type).toBe("journal-article");
      expect(work.ids.doi).toBe("10.7554/elife.85605");
      expect(work.workKey).toBe("doi:10.7554/elife.85605");
      expect(work.abstract).toBe("The article's abstract.");
      expect(work.authors.map((a) => a.family)).toEqual(["Engstler", "Beneke"]);
      expect(work.publishedDate?.iso).toBe("2023-05-02");
      expect(work.containerTitle).toBe("eLife");
      // Every record is still named, the review last; its DOI is a conflict.
      expect(work.provenance.recordIds).toEqual([
        "crossref:10.7554/elife.85605",
        "crossref:10.7554/elife.85605.sa2",
      ]);
      expect(conflicts).toEqual([
        {
          field: "ids.doi",
          kept: "10.7554/elife.85605",
          keptFrom: "crossref",
          rejected: [
            { value: "10.7554/elife.85605.sa2", sourceId: "crossref" },
          ],
        },
      ]);
      // Only one record supplied each field the review lost, so none was contested.
      expect(work.provenance.fieldOrigin["title"]).toBeUndefined();
    }
  });

  it("combines a group of review documents only exactly as before: longest title, first DOI in canonical order", () => {
    const one = record({
      source: "crossref",
      nativeId: "10.7554/elife.98867.1.sa2",
      title:
        "eLife Assessment: NK cell exhaustion in Wilson's disease predicts cholecystitis",
      type: "other",
      ids: { doi: doi("10.7554/elife.98867.1.sa2") },
    });
    const two = record({
      source: "crossref",
      nativeId: "10.7554/elife.98867.1.sa1",
      title:
        "Reviewer #1 (Public Review): NK cell exhaustion in Wilson's disease predicts cholecystitis",
      type: "other",
      ids: { doi: doi("10.7554/elife.98867.1.sa1") },
    });
    const { work } = merge([one, two], AT);
    expect(work.title).toBe(two.work.title);
    expect(work.ids.doi).toBe("10.7554/elife.98867.1.sa1");
    expect(work.provenance.recordIds).toEqual([two.id, one.id]);
  });

  it("dedupeAndMerge represents the group by the article even when the review was fetched first", () => {
    const a = article();
    const r = response();
    const result = dedupeAndMerge([r, a], AT);
    expect(result.works).toHaveLength(1);
    expect(result.records).toEqual([a]);
    expect(result.works[0]?.title).toBe(LEISH);
    expect(result.merged[0]?.records).toEqual([r, a]);
    expect(result.merged[0]?.decisions[0]?.evidence["rule"]).toBe("doi-family");
    expect(result.recordsDeduplicatedAway).toBe(1);
    expect(result.deduplicatedAwayBySource).toEqual({ crossref: 1 });
  });
});
