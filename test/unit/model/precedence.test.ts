import { describe, expect, it } from "vitest";

import type {
  Author,
  OpenAccessInfo,
  Subject,
} from "../../../src/model/canonicalWork";
import type {
  Doi,
  ExternalIds,
  Pmid,
  S2CorpusId,
  SourceId,
} from "../../../src/model/ids";
import {
  DEFAULT_PRECEDENCE,
  merge,
  PRECEDENCE,
  precedenceRank,
  type PrecedenceField,
} from "../../../src/model/merge";
import type { SourceRecord } from "../../../src/model/sourceRecord";

/**
 * `P2-T10` step 7. Layer 1 (docs/13 §2.1): plain Node, no Zotero, no network.
 *
 * `docs/02` §10.4 is the corpus's single source of per-field source
 * precedence, and this file asserts the winning source for every field in
 * its table. Each field's `docs/07` §5.1 combination rule is a *quality* rule
 * (longest, most complete, earliest complete, highest) that reaches the
 * precedence row only on a tie, so every fixture here supplies values of
 * **equal quality** from every source and lets the row decide. The
 * quality rules themselves are `merge.test.ts`'s subject.
 *
 * OpenAlex is inert in v1 — no adapter, no record ever carries it — so the
 * walk below skips its entry in place and asserts that the sources on either
 * side of it keep their relative order, which is what `docs/02` §10.4's
 * opening paragraph promises.
 */

const AT = 1_700_000_000_000;

/** The five v1 sources `docs/02` §10.4 orders (bioRxiv appears in one row). */
const V1_SOURCES: readonly SourceId[] = [
  "pubmed",
  "europepmc",
  "crossref",
  "semanticscholar",
  "arxiv",
  "biorxiv",
];

interface Spec {
  readonly source: SourceId;
  readonly title?: string;
  readonly abstract?: string;
  readonly authors?: readonly Author[];
  readonly date?: { year: number; month?: number; day?: number };
  readonly container?: string;
  readonly citations?: number;
  readonly subjects?: readonly Subject[];
  readonly openAccess?: OpenAccessInfo;
  readonly ids?: ExternalIds;
}

function iso(d: { year: number; month?: number; day?: number }): string {
  const mm =
    d.month === undefined ? "" : `-${String(d.month).padStart(2, "0")}`;
  const dd = d.day === undefined ? "" : `-${String(d.day).padStart(2, "0")}`;
  return `${String(d.year)}${mm}${dd}`;
}

function record(spec: Spec): SourceRecord {
  const nativeId = `n-${spec.source}`;
  return {
    id: `${spec.source}:${nativeId}`,
    sourceId: spec.source,
    nativeId,
    work: {
      ids: spec.ids ?? {},
      type: "journal-article",
      title: spec.title ?? "Shared title of the one work",
      authors: spec.authors ?? [],
      ...(spec.abstract !== undefined && { abstract: spec.abstract }),
      ...(spec.date !== undefined && {
        publishedDate: { ...spec.date, iso: iso(spec.date) },
      }),
      ...(spec.container !== undefined && { containerTitle: spec.container }),
      ...(spec.citations !== undefined && { citationCount: spec.citations }),
      ...(spec.subjects !== undefined && { subjects: spec.subjects }),
      ...(spec.openAccess !== undefined && { openAccess: spec.openAccess }),
    },
    retrievedAtEpochMs: AT,
    missingFields: [],
  };
}

/** The v1 members of a row, in row order (OpenAlex skipped in place). */
function v1Row(field: PrecedenceField): readonly SourceId[] {
  return PRECEDENCE[field].filter((s) => V1_SOURCES.includes(s));
}

/**
 * For one field: a fixture builder that gives every source a value of equal
 * quality but recognisably its own, so the winner's identity is readable off
 * the merged value as well as off `fieldOrigin`.
 */
type Builder = (source: SourceId) => Spec;

const equalQuality: Readonly<Record<PrecedenceField, Builder>> = {
  // Same comparable length (11 characters) from every source; PubMed's gets
  // the trailing `.` the §10.4 row says it appends.
  title: (s) => ({
    source: s,
    title:
      s === "pubmed" ? "Title ABCDE." : `Title ${s.slice(0, 5).padEnd(5, "x")}`,
  }),
  abstract: (s) => ({
    source: s,
    abstract: `Abstract from ${s}`.padEnd(40, "."),
  }),
  // Two authors each, no ORCIDs, so length and ORCID count tie.
  authors: (s) => ({
    source: s,
    authors: [{ family: `Alpha-${s}` }, { family: `Beta-${s}` }],
  }),
  // The identical full date; only the row can separate them.
  publishedDate: (s) => ({ source: s, date: { year: 2024, month: 3, day: 7 } }),
  venue: (s) => ({ source: s, container: `Journal per ${s}` }),
  citationCount: (s) => ({ source: s, citations: 42 }),
  subjects: (s) => ({
    source: s,
    subjects: [{ scheme: "mesh", term: `Term from ${s}` }],
  }),
  openAccess: (s) => ({
    source: s,
    openAccess: {
      isOpenAccess: true,
      license: "cc-by",
      pdfUrl: `https://${s}.example/x.pdf`,
    },
  }),
};

/**
 * Where the field's winner is readable on the merged work, for the fields
 * whose fixture value embeds the source's name. `publishedDate` and
 * `citationCount` are identical across sources by construction, so only
 * `fieldOrigin` can name their winner; they return `undefined` here.
 */
function readWinner(
  field: PrecedenceField,
  work: ReturnType<typeof merge>["work"],
): string | undefined {
  switch (field) {
    case "title":
      return work.title;
    case "abstract":
      return work.abstract;
    case "authors":
      return work.authors[0]?.family;
    case "venue":
      return work.containerTitle;
    case "subjects":
      return work.subjects?.[0]?.term;
    case "openAccess":
      return work.openAccess?.pdfUrl;
    case "publishedDate":
    case "citationCount":
      return undefined;
  }
}

/** The fixture fragment that names `source` inside a field value. */
function marker(field: PrecedenceField, source: SourceId): string {
  return field === "title" && source === "pubmed"
    ? "ABCDE"
    : source.slice(0, 5);
}

/** The `fieldOrigin` key a precedence field is recorded under. */
const ORIGIN_KEY: Readonly<Record<PrecedenceField, string | undefined>> = {
  title: "title",
  abstract: "abstract",
  authors: "authors",
  publishedDate: "publishedDate",
  venue: "containerTitle",
  citationCount: "citationCount",
  subjects: undefined, // a union has no single winner
  openAccess: "openAccess",
};

describe("PRECEDENCE transcribes docs/02 §10.4", () => {
  it("holds the eight rows that map onto CanonicalWork fields", () => {
    expect(Object.keys(PRECEDENCE).sort()).toEqual(
      [
        "title",
        "abstract",
        "authors",
        "publishedDate",
        "venue",
        "citationCount",
        "subjects",
        "openAccess",
      ].sort(),
    );
  });

  it.each([
    [
      "title",
      [
        "crossref",
        "pubmed",
        "europepmc",
        "openalex",
        "semanticscholar",
        "arxiv",
      ],
    ],
    [
      "abstract",
      [
        "europepmc",
        "pubmed",
        "semanticscholar",
        "crossref",
        "arxiv",
        "biorxiv",
        "openalex",
      ],
    ],
    [
      "authors",
      [
        "pubmed",
        "europepmc",
        "crossref",
        "openalex",
        "arxiv",
        "semanticscholar",
      ],
    ],
    [
      "publishedDate",
      ["europepmc", "pubmed", "crossref", "semanticscholar", "openalex"],
    ],
    [
      "venue",
      ["crossref", "pubmed", "europepmc", "openalex", "semanticscholar"],
    ],
    ["citationCount", ["semanticscholar", "openalex", "crossref", "europepmc"]],
    ["subjects", ["pubmed", "europepmc"]],
    ["openAccess", ["semanticscholar", "openalex", "europepmc"]],
  ] as const)("row %s is §10.4's, verbatim and in order", (field, row) => {
    expect(PRECEDENCE[field]).toEqual(row);
  });

  it("keeps OpenAlex in place — seven of the eight rows, last in `abstract`", () => {
    // `docs/02` §10.4's paragraph says "four of the orderings"; the table it
    // introduces has OpenAlex in seven (every row but `ids.*`, `meshTerms`
    // and `tldr`). The table is what is transcribed; the count is reported.
    const rowsWithOpenAlex = (
      Object.keys(PRECEDENCE) as PrecedenceField[]
    ).filter((f) => PRECEDENCE[f].includes("openalex"));
    expect(rowsWithOpenAlex).toHaveLength(7);
    expect(PRECEDENCE.abstract.at(-1)).toBe("openalex");
    expect(PRECEDENCE.title.indexOf("openalex")).toBe(3);
  });

  it("DEFAULT_PRECEDENCE is the title row followed by the rest in declaration order", () => {
    expect(DEFAULT_PRECEDENCE).toEqual([
      "crossref",
      "pubmed",
      "europepmc",
      "openalex",
      "semanticscholar",
      "arxiv",
      "biorxiv",
      "medrxiv",
    ]);
    expect(new Set(DEFAULT_PRECEDENCE).size).toBe(8);
  });

  it("precedenceRank puts an unlisted source after every listed one", () => {
    expect(precedenceRank(PRECEDENCE.citationCount, "semanticscholar")).toBe(0);
    expect(precedenceRank(PRECEDENCE.citationCount, "europepmc")).toBe(3);
    const unlistedPubmed = precedenceRank(PRECEDENCE.citationCount, "pubmed");
    const unlistedArxiv = precedenceRank(PRECEDENCE.citationCount, "arxiv");
    expect(unlistedPubmed).toBeGreaterThan(3);
    expect(unlistedArxiv).toBeGreaterThan(unlistedPubmed);
  });
});

describe("the winning source for every field in §10.4's table", () => {
  const fields = Object.keys(PRECEDENCE) as PrecedenceField[];

  describe.each(fields)("%s", (field) => {
    const row = v1Row(field);

    it("with every v1 source present, the row's first v1 entry wins", () => {
      const records = row.map((s) => record(equalQuality[field](s)));
      const { work } = merge(records, AT);
      const expected = row[0];
      if (expected === undefined) throw new Error("row is empty");
      const key = ORIGIN_KEY[field];
      if (key !== undefined)
        expect(work.provenance.fieldOrigin[key]).toBe(expected);
      const value = readWinner(field, work);
      if (value !== undefined) expect(value).toContain(marker(field, expected));
    });

    it.each(row.map((_, i) => i))(
      "with the %i best removed, the next entry in the row wins",
      (skip) => {
        const remaining = row.slice(skip);
        const expected = remaining[0];
        if (expected === undefined) throw new Error("walked off the row");
        // Reverse the input so the winner is never simply "the first record".
        const records = [...remaining]
          .reverse()
          .map((s) => record(equalQuality[field](s)));
        const { work } = merge(records, AT);
        const key = ORIGIN_KEY[field];
        if (key !== undefined) {
          if (remaining.length >= 2) {
            expect(work.provenance.fieldOrigin[key]).toBe(expected);
          } else {
            // One supplier: nothing was contested, nothing is recorded.
            expect(work.provenance.fieldOrigin[key]).toBeUndefined();
          }
        }
        const value = readWinner(field, work);
        if (value !== undefined)
          expect(value).toContain(marker(field, expected));
      },
    );
  });

  it("subjects: the union is in `meshTerms` row order, PubMed's terms first", () => {
    const records = [
      record({
        source: "europepmc",
        subjects: [
          { scheme: "mesh", term: "Neoplasms" },
          { scheme: "mesh", term: "Shared" },
        ],
      }),
      record({
        source: "pubmed",
        subjects: [
          { scheme: "mesh", term: "Shared", id: "D000001", isMajor: true },
          { scheme: "mesh", term: "Humans" },
        ],
      }),
      record({
        source: "crossref",
        subjects: [{ scheme: "publisher-keyword", term: "Shared" }],
      }),
    ];
    const { work } = merge(records, AT);
    expect(work.subjects).toEqual([
      { scheme: "mesh", term: "Shared", id: "D000001", isMajor: true },
      { scheme: "mesh", term: "Humans" },
      { scheme: "mesh", term: "Neoplasms" },
      // A different scheme is a different pair, so it is kept.
      { scheme: "publisher-keyword", term: "Shared" },
    ]);
  });

  it("ids: union of all, per §10.4's `ids.*` row", () => {
    const records = [
      record({ source: "pubmed", ids: { pmid: "123" as Pmid } }),
      record({
        source: "crossref",
        ids: { doi: "10.1000/abc" as Doi },
      }),
      record({
        source: "semanticscholar",
        ids: {
          doi: "10.1000/abc" as Doi,
          s2CorpusId: "99" as S2CorpusId,
        },
      }),
    ];
    const { work, conflicts } = merge(records, AT);
    expect(work.ids).toEqual({
      doi: "10.1000/abc",
      pmid: "123",
      s2CorpusId: "99",
    });
    expect(conflicts).toEqual([]);
  });
});
