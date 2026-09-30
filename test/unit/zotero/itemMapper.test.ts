import { describe, expect, it } from "vitest";

import {
  isWorkType,
  WORK_TYPES,
  type CanonicalWork,
  type WorkType,
} from "../../../src/model/canonicalWork";
import {
  buildWorkKey,
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
  SOURCE_IDS,
} from "../../../src/model/ids";
import { parseExtra, readWorkKey } from "../../../src/zotero/extraField";
import {
  AUTOMATIC_TAG_TYPE,
  NATIVE_ID_FIELDS_PRESENT,
  RESEARCH_HELPER_TAG,
  SOURCE_CATALOG_LABELS,
  toZoteroItemJSON,
  toZoteroMapping,
  workTypeFor,
  zoteroItemTypeFor,
  type ZoteroCreatorJSON,
} from "../../../src/zotero/itemMapper";

/**
 * `P1-T12`, `src/zotero/itemMapper.ts`. Layer 1 (docs/13 §2.1): plain Node.
 *
 * The mapping is pure by construction, so everything `docs/07` §6.2 and §6.3
 * specify about the *content* of the item JSON is asserted here; that
 * `item.fromJSON(json, { strict: true })` accepts it is a claim about Zotero and
 * is asserted in `test/integration/zotero/itemMapper.spec.ts`.
 *
 * `options.accessedAtEpochMs` is passed everywhere a date is observable, so no
 * assertion depends on the wall clock.
 */

const DOI = normalizeDoi("10.1056/NEJMoa2300709");
const PMID = normalizePmid("37258680");
const PMCID = normalizePmcid("10949956");
if (DOI === null || PMID === null || PMCID === null) {
  throw new Error("test fixtures must normalize");
}

/** 2026-03-07T04:05:06.789Z — fixed, so `accessDate` and `Citations:` are exact. */
const AT = Date.UTC(2026, 2, 7, 4, 5, 6, 789);

/**
 * A richly populated work. `workKey` comes from `buildWorkKey()` rather than a
 * literal, because §6.6 derives the same key on read-back and a hand-written
 * one here would let the two drift.
 */
const RICH: CanonicalWork = {
  workKey: buildWorkKey(
    { doi: DOI, pmid: PMID },
    "A trial of something",
    2024,
    "Kim",
  ),
  ids: { doi: DOI, pmid: PMID, pmcid: PMCID },
  type: "journal-article",
  title: "A trial of something",
  abstract: "BACKGROUND: text. METHODS: more text.",
  authors: [
    { family: "Kim", given: "Minji", orcid: "0000-0002-1825-0097" },
    { family: "Lee", given: "Jun" },
  ],
  containerTitle: "New England Journal of Medicine",
  containerAbbreviation: "N Engl J Med",
  publisher: "Massachusetts Medical Society",
  volume: "390",
  issue: "4",
  pages: "301-312",
  issn: ["0028-4793", "1533-4406"],
  publishedDate: { year: 2024, month: 1, day: 25, iso: "2024-01-25" },
  language: "en",
  subjects: [
    { term: "Neoplasms", scheme: "mesh", id: "D009369", isMajor: true },
    { term: "Machine Learning", scheme: "mesh", isMajor: false },
    { term: "q-bio.GN", scheme: "arxiv-category" },
    { term: "oncology", scheme: "publisher-keyword" },
  ],
  keywords: ["immunotherapy", "oncology"],
  citationCount: 1220,
  openAccess: { isOpenAccess: true, status: "gold", license: "CC-BY-4.0" },
  url: "https://www.nejm.org/doi/full/10.1056/NEJMoa2300709",
  provenance: {
    recordIds: ["pubmed:37258680"],
    fieldOrigin: { citationCount: "semanticscholar", title: "pubmed" },
    seenIn: ["pubmed", "semanticscholar"],
  },
  normalizedAtEpochMs: AT,
};

/** A minimal work: nothing optional populated. */
const MINIMAL: CanonicalWork = {
  workKey: "pmid:1",
  ids: { pmid: normalizePmid("1")! },
  type: "journal-article",
  title: "Short",
  authors: [],
  provenance: { recordIds: [], fieldOrigin: {}, seenIn: ["pubmed"] },
  normalizedAtEpochMs: AT,
};

function extraOf(work: CanonicalWork, options = {}): string {
  return String(
    toZoteroItemJSON(work, { accessedAtEpochMs: AT, ...options })["extra"] ??
      "",
  );
}

// ---------------------------------------------------------------------------

describe("zoteroItemTypeFor / workTypeFor — the camelCase ↔ kebab-case boundary", () => {
  /**
   * The measured trap: `docs/02` §10.2's table is camelCase
   * (`journalArticle`, `bookSection`) and `docs/07` §5.1's `WorkType` is
   * kebab-case (`journal-article`, `book-chapter`). A mapper written from
   * doc 02 alone emits strings `isWorkType()` rejects — so both directions are
   * asserted, not just the one this card writes.
   */
  it("maps every WorkType to a Zotero item type that is NOT a WorkType", () => {
    expect(WORK_TYPES).toHaveLength(9);
    for (const workType of WORK_TYPES) {
      const itemType = zoteroItemTypeFor(workType);
      expect(["journalArticle", "preprint"]).toContain(itemType);
      if (itemType !== "preprint") {
        // "journalArticle" must never be mistaken for a WorkType value.
        expect(isWorkType(itemType)).toBe(false);
      }
    }
  });

  it("rejects camelCase Zotero names as WorkType values", () => {
    for (const camel of [
      "journalArticle",
      "conferencePaper",
      "bookSection",
      "journal_article",
    ]) {
      expect(isWorkType(camel)).toBe(false);
    }
  });

  it("returns only kebab-case WorkType values on the read-back direction", () => {
    for (const itemType of [
      "journalArticle",
      "preprint",
      "conferencePaper",
      "bookSection",
      "dataset",
      "thesis",
      "report",
      "webpage",
      "",
    ]) {
      const workType: WorkType = workTypeFor(itemType);
      expect(isWorkType(workType)).toBe(true);
    }
  });

  it("round-trips the four types that have a Zotero counterpart", () => {
    expect(workTypeFor("journalArticle")).toBe("journal-article");
    expect(workTypeFor("preprint")).toBe("preprint");
    expect(workTypeFor("conferencePaper")).toBe("conference-paper");
    expect(workTypeFor("bookSection")).toBe("book-chapter");
  });

  it('maps an unknown item type to "other" (§6.6, lossy-tolerant)', () => {
    expect(workTypeFor("webpage")).toBe("other");
    expect(workTypeFor("nonsense")).toBe("other");
  });
});

describe("toZoteroItemJSON — §6.2's field table", () => {
  const json = toZoteroItemJSON(RICH, {
    accessedAtEpochMs: AT,
    nativeIdentifierFields: NATIVE_ID_FIELDS_PRESENT,
  });

  it("emits journalArticle", () => {
    expect(json["itemType"]).toBe("journalArticle");
  });

  it("maps every scalar field to its verified §6.1 key", () => {
    expect(json["title"]).toBe("A trial of something");
    expect(json["abstractNote"]).toBe("BACKGROUND: text. METHODS: more text.");
    expect(json["publicationTitle"]).toBe("New England Journal of Medicine");
    expect(json["journalAbbreviation"]).toBe("N Engl J Med");
    expect(json["publisher"]).toBe("Massachusetts Medical Society");
    expect(json["volume"]).toBe("390");
    expect(json["issue"]).toBe("4");
    expect(json["pages"]).toBe("301-312");
    expect(json["ISSN"]).toBe("0028-4793");
    expect(json["date"]).toBe("2024-01-25");
    expect(json["language"]).toBe("en");
    expect(json["rights"]).toBe("CC-BY-4.0");
    expect(json["url"]).toBe(
      "https://www.nejm.org/doi/full/10.1056/NEJMoa2300709",
    );
  });

  it("stores the DOI bare and lowercase, never as a URL (§6.2, FR-6, C9)", () => {
    expect(json["DOI"]).toBe("10.1056/nejmoa2300709");
    expect(String(json["DOI"])).not.toContain("doi.org");
    expect(String(json["DOI"])).not.toContain("https");
  });

  it("sets accessDate to import time as ISO 8601 UTC", () => {
    expect(json["accessDate"]).toBe("2026-03-07T04:05:06Z");
  });

  it("sets libraryCatalog to the winning source's catalogue label", () => {
    expect(json["libraryCatalog"]).toBe("PubMed");
    expect(
      toZoteroItemJSON(RICH, {
        accessedAtEpochMs: AT,
        libraryCatalog: "Europe PMC",
      })["libraryCatalog"],
    ).toBe("Europe PMC");
  });

  it("has a catalogue label for every SourceId", () => {
    for (const sourceId of SOURCE_IDS) {
      expect(SOURCE_CATALOG_LABELS[sourceId]).toBeTruthy();
    }
  });

  it("omits every field the work does not carry", () => {
    const minimal = toZoteroItemJSON(MINIMAL, { accessedAtEpochMs: AT });
    for (const absent of [
      "abstractNote",
      "publicationTitle",
      "journalAbbreviation",
      "publisher",
      "volume",
      "issue",
      "pages",
      "ISSN",
      "date",
      "DOI",
      "PMCID",
      "url",
      "language",
      "rights",
    ]) {
      expect(Object.hasOwn(minimal, absent)).toBe(false);
    }
    expect(minimal["PMID"]).toBe("1");
  });

  it("falls back to ids.url when there is no canonical url", () => {
    const work: CanonicalWork = {
      ...MINIMAL,
      ids: { ...MINIMAL.ids, url: "https://example.org/a" },
    };
    expect(toZoteroItemJSON(work, { accessedAtEpochMs: AT })["url"]).toBe(
      "https://example.org/a",
    );
  });
});

describe("identifiers — native fields, never an Extra line (§6.1, FR-6, C2)", () => {
  /** The card's second `Done when` criterion. */
  it("puts PMID and PMCID in the native fields and nothing like PMID: in extra", () => {
    const json = toZoteroItemJSON(RICH, {
      accessedAtEpochMs: AT,
      nativeIdentifierFields: NATIVE_ID_FIELDS_PRESENT,
    });
    expect(json["PMID"]).toBe("37258680");
    expect(json["PMCID"]).toBe("PMC10949956");
    const extra = String(json["extra"] ?? "");
    expect(extra).not.toMatch(/(^|\n)\s*PMID\s*:/i);
    expect(extra).not.toMatch(/(^|\n)\s*PMCID\s*:/i);
  });

  it("falls back to the ecosystem Extra lines only on a client without the fields", () => {
    const json = toZoteroItemJSON(RICH, {
      accessedAtEpochMs: AT,
      nativeIdentifierFields: { pmid: false, pmcid: false },
    });
    expect(Object.hasOwn(json, "PMID")).toBe(false);
    expect(Object.hasOwn(json, "PMCID")).toBe(false);
    const lines = parseExtra(String(json["extra"]));
    expect(lines.find((l) => l.key === "PMID")?.value).toBe("37258680");
    expect(lines.find((l) => l.key === "PMCID")?.value).toBe("PMC10949956");
  });

  it("writes arXiv: to extra, since no item type has a native arXiv field", () => {
    const work: CanonicalWork = {
      ...MINIMAL,
      ids: { ...MINIMAL.ids, arxivId: "2401.01234" as never },
    };
    expect(extraOf(work)).toContain("arXiv: 2401.01234");
  });
});

describe("extra — §6.2's plugin lines and §6.3's contract", () => {
  it("writes rh-work-key and rh-sources", () => {
    const extra = extraOf(RICH);
    expect(readWorkKey(extra)).toBe(RICH.workKey);
    expect(extra).toContain("rh-sources: pubmed,semanticscholar");
  });

  it("never revives the research_helper- spellings (C1)", () => {
    expect(extraOf(RICH)).not.toContain("research_helper-");
  });

  it('omits rh-sources when the line is toggled off (§6.2 "togglable")', () => {
    const extra = extraOf(RICH, { includeSourcesLine: false });
    expect(extra).not.toContain("rh-sources");
    expect(readWorkKey(extra)).toBe(RICH.workKey);
  });

  it("writes Citations with the winning source and the import date", () => {
    expect(extraOf(RICH)).toContain(
      "Citations: 1220 (semanticscholar, 2026-03-07)",
    );
  });

  it("writes the first author's ORCID, and only the first author's", () => {
    const extra = extraOf({
      ...RICH,
      authors: [
        { family: "Kim", given: "Minji", orcid: "0000-0002-1825-0097" },
        { family: "Lee", given: "Jun", orcid: "0000-0001-0000-0000" },
      ],
    });
    expect(extra).toContain("ORCID: 0000-0002-1825-0097");
    expect(extra).not.toContain("0000-0001-0000-0000");
  });

  it("namespaces the additional ISSNs, because ISSN has a native field", () => {
    const extra = extraOf(RICH);
    expect(extra).toContain("rh-issn: 1533-4406");
    expect(extra).not.toMatch(/(^|\n)ISSN\s*:/);
  });

  it("records a non-journal-article type in extra rather than losing it", () => {
    const extra = extraOf({ ...RICH, type: "review" });
    expect(extra).toContain("rh-work-type: review");
    expect(extraOf(RICH)).not.toContain("rh-work-type");
  });

  /** The card's third `Done when` criterion, on the mapper's own call path. */
  it('leaves an existing "Citation Key: smith2024\\nPMID: 999" untouched', () => {
    const existing = "Citation Key: smith2024\nPMID: 999";
    const extra = extraOf(MINIMAL, { existingExtra: existing });
    const lines = extra.split("\n");
    expect(lines[0]).toBe("Citation Key: smith2024");
    expect(lines[1]).toBe("PMID: 999");
    expect(extra.startsWith(existing)).toBe(true);
    expect(readWorkKey(extra)).toBe("pmid:1");
  });

  it("omits extra entirely only when there is nothing to write", () => {
    // rh-work-key always applies, so `extra` is always present in practice.
    expect(extraOf(MINIMAL)).toContain("rh-work-key: pmid:1");
  });
});

describe("extra overflow — the ~500-character cap (§6.3)", () => {
  /** The card's sixth `Done when` criterion. */
  it("keeps only rh-work-key and produces a child note", () => {
    const bloated: CanonicalWork = {
      ...RICH,
      issn: [
        "0028-4793",
        ...Array.from({ length: 60 }, (_, i) => `1533-${1000 + i}`),
      ],
    };
    const mapping = toZoteroMapping(bloated, { accessedAtEpochMs: AT });
    const extra = String(mapping.itemJSON["extra"]);

    expect(extra).toBe(`rh-work-key: ${bloated.workKey}`);
    expect(extra).not.toContain("rh-sources");
    expect(extra).not.toContain("rh-issn");
    expect(mapping.overflowNote).toBeDefined();
    expect(mapping.overflowNote).toContain("rh:extra v=1");
    expect(mapping.overflowNote).toContain(
      "rh-sources: pubmed,semanticscholar",
    );
    expect(mapping.overflowNote).toContain("1533-1059");
  });

  it("produces no note when the cap is not reached", () => {
    expect(
      toZoteroMapping(RICH, { accessedAtEpochMs: AT }).overflowNote,
    ).toBeUndefined();
  });

  it("escapes the note HTML", () => {
    const work: CanonicalWork = {
      ...RICH,
      workKey: "hash:<script>&",
      issn: [
        "0028-4793",
        ...Array.from({ length: 60 }, (_, i) => `1533-${1000 + i}`),
      ],
    };
    const note = toZoteroMapping(work, { accessedAtEpochMs: AT }).overflowNote;
    expect(note).toContain("&lt;script&gt;&amp;");
    expect(note).not.toContain("<script>");
  });
});

describe("creators — §6.2 and docs/01 §5.2's two shapes", () => {
  it("uses two-field mode for a split name", () => {
    const creators = toZoteroItemJSON(RICH, { accessedAtEpochMs: AT })[
      "creators"
    ] as readonly ZoteroCreatorJSON[];
    expect(creators[0]).toEqual({
      creatorType: "author",
      firstName: "Minji",
      lastName: "Kim",
    });
  });

  /** The card's fifth `Done when` criterion. */
  it("uses fieldMode: 1 for an author known only by a literal name", () => {
    const work: CanonicalWork = {
      ...MINIMAL,
      authors: [
        {
          family: "World Health Organization",
          literal: "World Health Organization",
        },
      ],
    };
    const creators = toZoteroItemJSON(work, { accessedAtEpochMs: AT })[
      "creators"
    ] as readonly ZoteroCreatorJSON[];
    expect(creators).toEqual([
      {
        creatorType: "author",
        name: "World Health Organization",
        fieldMode: 1,
      },
    ]);
  });

  it("prefers two-field mode when a given name exists, literal or not", () => {
    const work: CanonicalWork = {
      ...MINIMAL,
      authors: [{ family: "Kim", given: "Minji", literal: "Minji Kim" }],
    };
    const creators = toZoteroItemJSON(work, { accessedAtEpochMs: AT })[
      "creators"
    ] as readonly ZoteroCreatorJSON[];
    expect(creators[0]).toEqual({
      creatorType: "author",
      firstName: "Minji",
      lastName: "Kim",
    });
  });

  it("emits no creators for a work with no authors", () => {
    expect(
      toZoteroItemJSON(MINIMAL, { accessedAtEpochMs: AT })["creators"],
    ).toEqual([]);
  });
});

describe("tags — automatic, MeSH-prefixed, with the run tag", () => {
  const tags = toZoteroItemJSON(RICH, { accessedAtEpochMs: AT })[
    "tags"
  ] as readonly { tag: string; type: number }[];

  /** The card's fourth `Done when` criterion. */
  it("marks every tag automatic (type 1)", () => {
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => t.type === AUTOMATIC_TAG_TYPE)).toBe(true);
    expect(AUTOMATIC_TAG_TYPE).toBe(1);
  });

  it("prefixes MeSH descriptors, with * for major topics", () => {
    const names = tags.map((t) => t.tag);
    expect(names).toContain("MeSH*: Neoplasms");
    expect(names).toContain("MeSH: Machine Learning");
  });

  it("prefixes arXiv categories and leaves other schemes bare", () => {
    const names = tags.map((t) => t.tag);
    expect(names).toContain("arXiv: q-bio.GN");
    expect(names).toContain("oncology");
  });

  it("carries the research_helper run tag exactly once", () => {
    expect(tags.filter((t) => t.tag === RESEARCH_HELPER_TAG)).toHaveLength(1);
  });

  it("deduplicates a term that arrives as both a subject and a keyword", () => {
    const names = tags.map((t) => t.tag);
    expect(names.filter((n) => n === "oncology")).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the preprint gap is loud, not silent (card Notes)", () => {
  it("throws rather than half-mapping a preprint", () => {
    expect(() =>
      toZoteroItemJSON(
        { ...RICH, type: "preprint" },
        { accessedAtEpochMs: AT },
      ),
    ).toThrow(/preprint/i);
  });

  it("maps every other WorkType without throwing", () => {
    for (const workType of WORK_TYPES.filter((t) => t !== "preprint")) {
      const json = toZoteroItemJSON(
        { ...RICH, type: workType },
        { accessedAtEpochMs: AT },
      );
      expect(json["itemType"]).toBe("journalArticle");
    }
  });
});
