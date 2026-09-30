import { describe, expect, it } from "vitest";

import {
  isCanonicalWork,
  isWorkType,
  WORK_TYPES,
  type CanonicalWork,
} from "../../../src/model/canonicalWork";
import {
  buildWorkKey,
  normalizeDoi,
  normalizePmcid,
} from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";

/**
 * `P1-T01`. Layer 1 (docs/13 §2.1): plain Node, no Zotero, no network.
 *
 * Two jobs. {@link FULL} is a *compile-time* assertion: it populates every
 * member docs/07 §5.1 declares, so a field renamed or dropped during
 * transcription is a typecheck failure rather than a runtime surprise. The
 * `describe` blocks then exercise the step-5 type guards.
 */

const DOI = normalizeDoi("10.1056/nejmoa2300709");
const PMCID = normalizePmcid("7605294");
if (DOI === null || PMCID === null) {
  throw new Error("test fixtures must normalize");
}

/**
 * Every field of docs/07 §5.1's `CanonicalWork`, `Author`, `PartialDate`,
 * `OpenAccessInfo`, `Subject` and `WorkProvenance`, populated. Written as a
 * `const` with an explicit annotation so excess-property checking applies:
 * a member that does not exist on the interface is an error here.
 */
const FULL: CanonicalWork = {
  workKey: `doi:${DOI}`,
  ids: {
    doi: DOI,
    pmcid: PMCID,
    url: "https://doi.org/10.1056/nejmoa2300709",
  },
  type: "journal-article",
  title: "A trial of something",
  abstract: "BACKGROUND: text. METHODS: more text.",
  authors: [
    {
      family: "Kim",
      given: "Minji",
      literal: "Minji Kim",
      orcid: "0000-0002-1825-0097",
      affiliations: ["KIST"],
      sequence: 0,
      isCorresponding: true,
    },
  ],
  containerTitle: "New England Journal of Medicine",
  containerAbbreviation: "N Engl J Med",
  publisher: "Massachusetts Medical Society",
  volume: "389",
  issue: "1",
  pages: "1-11",
  issn: ["0028-4793", "1533-4406"],
  publishedDate: { year: 2023, month: 7, day: 6, iso: "2023-07-06" },
  onlineDate: { year: 2023, iso: "2023" },
  language: "en",
  subjects: [
    { term: "Neoplasms", scheme: "mesh", id: "D009369", isMajor: true },
  ],
  keywords: ["oncology"],
  citationCount: 42,
  referenceCount: 31,
  influentialCitationCount: 7,
  openAccess: {
    isOpenAccess: true,
    status: "hybrid",
    pdfUrl: "https://example.test/paper.pdf",
    landingPageUrl: "https://example.test/paper",
    license: "CC-BY-4.0",
  },
  url: "https://example.test/paper",
  relatedVersionIds: { doi: DOI },
  provenance: {
    recordIds: ["pubmed:32020029"],
    fieldOrigin: { title: "pubmed", abstract: "europepmc" },
    seenIn: ["pubmed", "europepmc"],
  },
  normalizedAtEpochMs: 1_757_000_000_000,
};

/**
 * The same work as a pre-merge `SourceRecord`, which is where §5.1's
 * `Omit<CanonicalWork, "workKey" | "provenance" | "normalizedAtEpochMs">` is
 * exercised: omitting one of those three must still compile, and *including*
 * one must not.
 */
const RECORD: SourceRecord = {
  id: "pubmed:32020029",
  sourceId: "pubmed",
  nativeId: "32020029",
  work: {
    ids: FULL.ids,
    type: FULL.type,
    title: FULL.title,
    authors: FULL.authors,
  },
  retrievedAtEpochMs: 1_757_000_000_000,
  raw: { PMID: "32020029" },
  relevanceScore: 0.87,
  missingFields: ["abstract"],
};

/** The minimum §5.1 requires: every optional member absent. */
const MINIMAL: CanonicalWork = {
  workKey: buildWorkKey({}, "Untitled", undefined, undefined),
  ids: {},
  type: "other",
  title: "Untitled",
  authors: [],
  provenance: { recordIds: [], fieldOrigin: {}, seenIn: [] },
  normalizedAtEpochMs: 0,
};

describe("the transcription of docs/07 §5.1", () => {
  it("accepts a work with every declared field populated", () => {
    expect(isCanonicalWork(FULL)).toBe(true);
  });

  it("accepts a work with only the required fields", () => {
    expect(isCanonicalWork(MINIMAL)).toBe(true);
  });

  it("lets a SourceRecord omit the three fields §5.1's Omit removes", () => {
    expect(RECORD.work).not.toHaveProperty("workKey");
    expect(RECORD.work).not.toHaveProperty("provenance");
    expect(RECORD.work).not.toHaveProperty("normalizedAtEpochMs");
  });
});

describe("WORK_TYPES / isWorkType", () => {
  it("lists exactly the nine members of §5.1's WorkType union", () => {
    expect(WORK_TYPES).toEqual([
      "journal-article",
      "preprint",
      "conference-paper",
      "review",
      "book-chapter",
      "dataset",
      "thesis",
      "report",
      "other",
    ]);
  });

  it("accepts every member", () => {
    for (const type of WORK_TYPES) expect(isWorkType(type)).toBe(true);
  });

  it.each([
    ["journalArticle", "docs/02 §10.2's Zotero-facing camelCase spelling"],
    ["bookSection", "the same, for book-chapter"],
    ["posted-content", "Crossref's own type name"],
    ["", "empty string"],
    ["toString", "an Object.prototype key"],
  ])("rejects %j (%s)", (value) => {
    expect(isWorkType(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isWorkType(undefined)).toBe(false);
    expect(isWorkType(null)).toBe(false);
  });
});

describe("isCanonicalWork", () => {
  /** `FULL` with one member replaced or removed, as an opaque value. */
  function mutate(patch: Record<string, unknown>): unknown {
    const copy: Record<string, unknown> = { ...FULL, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete copy[key];
    }
    return copy;
  }

  it.each([
    ["workKey missing", { workKey: undefined }],
    ["workKey empty", { workKey: "" }],
    ["workKey not a string", { workKey: 1 }],
    ["ids missing", { ids: undefined }],
    ["ids an array", { ids: [] }],
    ["type not a WorkType", { type: "journalArticle" }],
    ["title missing", { title: undefined }],
    ["authors missing", { authors: undefined }],
    ["authors not an array", { authors: {} }],
    ["an author with no family name", { authors: [{ given: "Minji" }] }],
    ["provenance missing", { provenance: undefined }],
    [
      "provenance.recordIds not an array of strings",
      { provenance: { recordIds: [7], fieldOrigin: {}, seenIn: [] } },
    ],
    [
      "provenance.seenIn carrying an unknown source",
      {
        provenance: {
          recordIds: [],
          fieldOrigin: {},
          seenIn: ["pubmedcentral"],
        },
      },
    ],
    [
      "provenance.fieldOrigin carrying an unknown source",
      {
        provenance: {
          recordIds: [],
          fieldOrigin: { title: "scopus" },
          seenIn: [],
        },
      },
    ],
    ["normalizedAtEpochMs missing", { normalizedAtEpochMs: undefined }],
    ["normalizedAtEpochMs NaN", { normalizedAtEpochMs: Number.NaN }],
  ])("rejects a work with %s", (_label, patch) => {
    expect(isCanonicalWork(mutate(patch))).toBe(false);
  });

  it("rejects anything that is not a plain object", () => {
    const notObjects: unknown[] = [null, undefined, "a string", 42, [], true];
    for (const value of notObjects) {
      expect(isCanonicalWork(value)).toBe(false);
    }
  });

  it("accepts an empty ids object, which §5.1 makes legal", () => {
    expect(isCanonicalWork(mutate({ ids: {} }))).toBe(true);
  });
});
