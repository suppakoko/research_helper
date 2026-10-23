import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import {
  acquireSource,
  type AcquirableAttachment,
  type AcquirableItem,
  type FullTextPort,
} from "../../../src/pipeline/summarize/acquire";
import {
  detectSectionsFromJats,
  detectSectionsFromPdf,
  IMRAD_HEADING_TABLE,
  isCandidateHeadingLine,
  JATS_SEC_TYPES,
  labelHeading,
  labelJatsSection,
  MIN_IMRAD_SECTIONS,
  NO_SECTIONS,
} from "../../../src/pipeline/summarize/imrad";
import {
  extractJats,
  type JatsDocumentLike,
  type JatsNode,
} from "../../../src/pipeline/summarize/jats";
import { PREF_KEYS, setPrefStore } from "../../../src/prefs";
import {
  narrowStructuredDocument,
  type DocumentStructure,
  type StructuredOutlineEntry,
} from "../../../src/zotero/fulltext";

/**
 * `P3-T21`: `docs/06` §4.3's IMRaD detector — the heading table, the JATS
 * path (reusing `extractJats`'s sections), the PDF path on the structure
 * reader's outline and heading blocks with the line-scan fallback, and the
 * `sectionAware` flag on `AcquiredSource`.
 *
 * Every fixture is synthetic text written here. The outline / heading-block
 * shapes follow what `test/integration/zotero/imradStructure.spec.ts`
 * measured on Zotero 10.0.3.
 */

afterEach(() => {
  setPrefStore(undefined);
});

// ---------------------------------------------------------------------------
// The heading table
// ---------------------------------------------------------------------------

describe("the heading table (docs/06 §4.3)", () => {
  it.each([
    ["Abstract", ["abstract"]],
    ["SUMMARY", ["abstract"]],
    ["1. Introduction", ["introduction"]],
    ["Background", ["background"]],
    ["2 Related Work", ["related_work"]],
    ["Prior work", ["related_work"]],
    ["Materials and Methods", ["methods"]],
    ["2. Methods", ["methods"]],
    ["Experimental Section", ["methods"]],
    ["Patients and methods", ["methods"]],
    ["Results", ["results"]],
    ["Findings", ["results"]],
    ["3. Results and Discussion", ["results", "discussion"]],
    ["RESULTS AND DISCUSSION", ["results", "discussion"]],
    ["Discussion", ["discussion"]],
    ["Limitations", ["limitations"]],
    ["4. Conclusions", ["conclusion"]],
    ["Concluding remarks", ["conclusion"]],
  ] as const)("%s → %j", (heading, labels) => {
    expect(labelHeading(heading)).toEqual(labels);
  });

  it.each([
    "Acknowledgements",
    "Abstract and keywords", // the abstract row is anchored with `\s*$`
    "Case presentation",
    "Data availability",
    "",
  ])("%j matches no row", (heading) => {
    expect(labelHeading(heading)).toBeNull();
  });

  it("is ordered most-specific-first: the combined row precedes the bare Results row", () => {
    const matching = IMRAD_HEADING_TABLE.flatMap((row, i) =>
      row.pattern.test("Results and Discussion") ? [i] : [],
    );
    // Two rows match the combined heading — the combined row (4) and the bare
    // Results row (5) — so only the order makes the label right.
    expect(matching).toEqual([4, 5]);
    expect(labelHeading("Results and Discussion")).toEqual([
      "results",
      "discussion",
    ]);
    expect(IMRAD_HEADING_TABLE).toHaveLength(9);
  });

  it("applies the candidate-heading rule to the line scan", () => {
    expect(isCandidateHeadingLine("2. Methods", "")).toBe(true);
    expect(isCandidateHeadingLine("2. Methods", "Two observers walked")).toBe(
      true,
    );
    expect(isCandidateHeadingLine("2. Methods", "two observers walked")).toBe(
      false,
    );
    expect(isCandidateHeadingLine("Methods were simple.", "")).toBe(false);
    expect(isCandidateHeadingLine("Results ".repeat(12), "")).toBe(false);
    expect(isCandidateHeadingLine("Results", undefined)).toBe(true);
    expect(isCandidateHeadingLine("Results", "\fNext page")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — JATS
// ---------------------------------------------------------------------------

/** A tiny DOM builder satisfying `extractJats`'s node port. */
function el(
  name: string,
  attributes: Record<string, string>,
  ...children: (JatsNode | string)[]
): JatsNode {
  const nodes: JatsNode[] = children.map((child) =>
    typeof child === "string"
      ? {
          nodeType: 3,
          localName: null,
          textContent: child,
          childNodes: { length: 0, item: () => null },
        }
      : child,
  );
  return {
    nodeType: 1,
    localName: name,
    get textContent() {
      return nodes.map((n) => n.textContent ?? "").join("");
    },
    childNodes: { length: nodes.length, item: (i) => nodes[i] ?? null },
    getAttribute: (attr) => attributes[attr] ?? null,
  };
}

function sec(
  secType: string | null,
  title: string,
  ...paragraphs: string[]
): JatsNode {
  return el(
    "sec",
    secType === null ? {} : { "sec-type": secType },
    el("title", {}, title),
    ...paragraphs.map((p) => el("p", {}, p)),
  );
}

function article(...sections: JatsNode[]): JatsDocumentLike {
  return {
    documentElement: el(
      "article",
      {},
      el(
        "front",
        {},
        el(
          "article-meta",
          {},
          el("abstract", {}, el("p", {}, "An invented abstract.")),
        ),
      ),
      el("body", {}, ...sections),
    ),
  };
}

describe("detectSectionsFromJats (P3-T21 step 1)", () => {
  it('a @sec-type="methods" section yields a methods section at the right offsets', () => {
    const extraction = extractJats(
      article(
        sec("intro", "Introduction", "Widgets are invented."),
        sec("methods", "Study procedures", "Two observers counted widgets."),
        sec("results", "Results", "Counts rose."),
      ),
    );
    const detection = detectSectionsFromJats(extraction);
    expect(detection.sectionAware).toBe(true);
    const methods = detection.sections.find((s) => s.imrad === "methods");
    expect(methods).toBeDefined();
    // The title says nothing the table knows; @sec-type alone labels it.
    expect(labelHeading("Study procedures")).toBeNull();
    const expectedStart = extraction.text.indexOf("Study procedures");
    expect(methods?.start).toBe(expectedStart);
    expect(methods?.end).toBe(extraction.text.indexOf("Results"));
    expect(methods?.text).toBe(
      "Study procedures\nTwo observers counted widgets.\n\n",
    );
    expect(methods?.heading).toBe("Study procedures");
    for (const section of detection.sections) {
      expect(extraction.text.slice(section.start, section.end)).toBe(
        section.text,
      );
    }
    expect(detection.sections.map((s) => s.labels)).toEqual([
      ["introduction"],
      ["methods"],
      ["results"],
    ]);
  });

  it("shifts every offset by the preamble the caller prepends", () => {
    const extraction = extractJats(
      article(
        sec("intro", "Introduction", "A."),
        sec("methods", "Methods", "B."),
      ),
    );
    const detection = detectSectionsFromJats(extraction, 100);
    expect(detection.sections[0]?.start).toBe(100);
    expect(detection.sections.at(-1)?.end).toBe(100 + extraction.text.length);
  });

  it("falls through to the heading table for an untyped or unknown @sec-type", () => {
    expect(labelJatsSection({ secType: null, heading: "2. Methods" })).toEqual([
      "methods",
    ]);
    expect(
      labelJatsSection({ secType: "cases", heading: "Discussion" }),
    ).toEqual(["discussion"]);
    expect(
      labelJatsSection({ secType: null, heading: "Case presentation" }),
    ).toEqual(["other"]);
  });

  it("maps a compound @sec-type part by part", () => {
    expect(
      labelJatsSection({ secType: "materials|methods", heading: "" }),
    ).toEqual(["methods"]);
    expect(
      labelJatsSection({ secType: "results|discussion", heading: "" }),
    ).toEqual(["results", "discussion"]);
    expect(JATS_SEC_TYPES.conclusions).toBe("conclusion");
  });

  it("a supplementary-material section never reaches the detector (extractJats drops it)", () => {
    const extraction = extractJats(
      article(
        sec("intro", "Introduction", "A."),
        sec("supplementary-material", "Extra files", "S1."),
        sec("methods", "Methods", "B."),
      ),
    );
    const detection = detectSectionsFromJats(extraction);
    expect(detection.sections.map((s) => s.imrad)).toEqual([
      "introduction",
      "methods",
    ]);
    expect(detection.sections.some((s) => s.text.includes("S1."))).toBe(false);
  });

  it("declares failure on fewer than two recognized sections", () => {
    const extraction = extractJats(
      article(
        sec(null, "Case presentation", "A patient."),
        sec("discussion", "Discussion", "We discuss."),
      ),
    );
    expect(detectSectionsFromJats(extraction)).toEqual({
      sections: [],
      sectionAware: false,
      recognized: 1,
    });
  });

  it("declares failure when the text was not built from the sections", () => {
    const extraction = extractJats(
      article(sec("intro", "Introduction", "A."), sec("methods", "M", "B.")),
    );
    expect(
      detectSectionsFromJats({ ...extraction, text: `${extraction.text} ` }),
    ).toBe(NO_SECTIONS);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — PDF
// ---------------------------------------------------------------------------

/** A cleaned two-page body, `\f`-delimited, as Tier 2 hands it over. */
const PAGE_1 =
  "Counting Synthetic Widgets\nA. Example, Invented Studies\nAbstract\n" +
  "Widgets were counted.\n1. Introduction\nWidget counting is invented.\n" +
  "2. Methods\nTwo observers walked a transect.";
const PAGE_2 =
  "3. Results and Discussion\nCounts rose. Results of this kind recur.\n" +
  "4. Conclusions\nWidgets are countable.";
const PDF_BODY = `${PAGE_1}\n\n\n\f${PAGE_2}`;

function entry(
  title: string,
  blockIndex: number | null,
  pageIndex: number | null,
  depth = 0,
  blockText: string | null = title,
): StructuredOutlineEntry {
  return {
    title,
    depth,
    blockIndex,
    blockText: blockIndex === null ? null : blockText,
    pageIndex: blockIndex === null ? null : pageIndex,
  };
}

function structure(
  outline: StructuredOutlineEntry[],
  headingBlocks: DocumentStructure["headingBlocks"] = [],
): DocumentStructure {
  return { schemaVersion: "1.2.0", pageCount: 2, outline, headingBlocks };
}

describe("detectSectionsFromPdf (P3-T21 step 2)", () => {
  it('a "3. Results and Discussion" heading yields one section marked both results and discussion', () => {
    const detection = detectSectionsFromPdf(
      PDF_BODY,
      structure([
        entry("Abstract", 2, 0),
        entry("1. Introduction", 4, 0),
        entry("2. Methods", 6, 0),
        entry("3. Results and Discussion", 8, 1),
        entry("4. Conclusions", 10, 1),
      ]),
    );
    expect(detection.sectionAware).toBe(true);
    const combined = detection.sections.filter((s) =>
      s.labels.includes("results"),
    );
    expect(combined).toHaveLength(1);
    expect(combined[0]?.labels).toEqual(["results", "discussion"]);
    expect(combined[0]?.imrad).toBe("results");
    expect(combined[0]?.heading).toBe("3. Results and Discussion");
    expect(combined[0]?.start).toBe(PDF_BODY.indexOf("3. Results"));
    expect(detection.stats).toMatchObject({
      structure: true,
      outlineEntries: 5,
      outlineAnchored: 5,
      structureLocated: 5,
      fallbackAdded: 0,
    });
  });

  it("covers the body contiguously, text before the first heading as other", () => {
    const detection = detectSectionsFromPdf(
      PDF_BODY,
      structure([entry("1. Introduction", 4, 0), entry("2. Methods", 6, 0)]),
      10,
    );
    const sections = detection.sections;
    expect(sections[0]).toMatchObject({
      imrad: "other",
      heading: "",
      start: 10,
    });
    for (let i = 1; i < sections.length; i += 1) {
      expect(sections[i]?.start).toBe(sections[i - 1]?.end);
    }
    expect(sections.at(-1)?.end).toBe(10 + PDF_BODY.length);
    for (const s of sections) {
      expect(PDF_BODY.slice(s.start - 10, s.end - 10)).toBe(s.text);
    }
  });

  it("a fixture with only a title page and body text yields sectionAware: false", () => {
    const body =
      "A Report With No Sections\nC. Example\nThis document has running " +
      "text and no headings.\n\n\n\fThe second page continues the text.";
    const withStructure = detectSectionsFromPdf(
      body,
      structure(
        [entry("A Report With No Sections", 0, 0)],
        [{ blockIndex: 0, text: "A Report With No Sections", pageIndex: 0 }],
      ),
    );
    expect(withStructure.sectionAware).toBe(false);
    expect(withStructure.sections).toEqual([]);
    expect(detectSectionsFromPdf(body, null).sectionAware).toBe(false);
  });

  it("does not guess from one recognized heading", () => {
    const detection = detectSectionsFromPdf(
      "Title\n2. Methods\nWe counted.",
      structure([entry("2. Methods", 1, 0)]),
    );
    expect(detection).toMatchObject({ sectionAware: false, recognized: 1 });
    expect(detection.sections).toEqual([]);
  });

  it("finds each structure heading on its own page", () => {
    // Page 1 has a line starting with the word "Results"; the outline's
    // Results heading is on page 2 and must not land on page 1's line.
    const body =
      "Introduction\nText.\nResults of earlier work vary\nMore text.\n\n\n\f" +
      "Results\nCounts rose.";
    const detection = detectSectionsFromPdf(
      body,
      structure([entry("Introduction", 0, 0), entry("Results", 4, 1)]),
    );
    const results = detection.sections.find((s) => s.imrad === "results");
    expect(results?.start).toBe(body.lastIndexOf("Results"));
  });

  it("drops a structure heading its own page does not contain, rather than taking a later page's", () => {
    const body =
      "Introduction\nText.\n\n\n\fMethods of others vary\nmore text.";
    const detection = detectSectionsFromPdf(
      body,
      structure([entry("Introduction", 0, 0), entry("Methods", 2, 0)]),
    );
    expect(detection.stats.structureLocated).toBe(1);
    expect(detection.sections.some((s) => s.imrad === "methods")).toBe(false);
  });

  it("never places a heading before the previous one", () => {
    // Same page, no page known: the second "Methods" entry is searched only
    // after the first heading, so it cannot land on the earlier mention.
    const body =
      "Methods used before\nIntroduction\nText.\nMethods\nWe walked.";
    const detection = detectSectionsFromPdf(
      body,
      structure([entry("Introduction", 1, null), entry("Methods", 3, null)]),
    );
    const methods = detection.sections.find((s) => s.imrad === "methods");
    expect(methods?.start).toBe(body.lastIndexOf("Methods"));
  });

  it("prefers a line-start occurrence over an earlier mid-line mention", () => {
    const body =
      "Introduction\nThe Methods section follows.\nMethods\nWe walked.";
    const detection = detectSectionsFromPdf(
      body,
      structure([entry("Introduction", 0, 0), entry("Methods", 3, 0)]),
    );
    expect(detection.sections.find((s) => s.imrad === "methods")?.start).toBe(
      body.lastIndexOf("Methods"),
    );
  });

  it("labels an anchored entry by its block text, then by its outline title", () => {
    const detection = detectSectionsFromPdf(
      "Front\nMATERIALS AND METHODS\nWe walked.\nOUTCOMES\nCounts.",
      structure([
        entry("Materials and Methods", 1, 0, 0, "MATERIALS AND METHODS"),
        entry("Results", 3, 0, 0, "OUTCOMES"),
      ]),
    );
    expect(detection.sections.map((s) => [s.imrad, s.heading])).toEqual([
      ["other", ""],
      ["methods", "MATERIALS AND METHODS"],
      ["results", "OUTCOMES"],
    ]);
  });

  it("uses heading blocks the outline does not point at", () => {
    const detection = detectSectionsFromPdf(
      PDF_BODY,
      structure(
        [],
        [
          { blockIndex: 0, text: "Counting Synthetic Widgets", pageIndex: 0 },
          { blockIndex: 4, text: "1. Introduction", pageIndex: 0 },
          { blockIndex: 6, text: "2. Methods", pageIndex: 0 },
        ],
      ),
    );
    expect(detection.stats.structureCandidates).toBe(2); // the title is unlabelled
    expect(detection.sections.map((s) => s.imrad)).toContain("methods");
  });

  it("an unlabelled outline entry at the section level ends the section; a deeper one does not", () => {
    const body =
      "Intro\n1. Introduction\nText.\n2. Methods\nWe walked.\n2.1 Sites\n" +
      "Three sites.\n3. Results\nCounts.\nAcknowledgements\nThanks.";
    const detection = detectSectionsFromPdf(
      body,
      structure([
        entry("1. Introduction", 1, 0),
        entry("2. Methods", 3, 0),
        entry("2.1 Sites", 5, 0, 1),
        entry("3. Results", 7, 0),
        entry("Acknowledgements", 9, 0),
      ]),
    );
    expect(detection.sections.map((s) => s.labels.join("+"))).toEqual([
      "other",
      "introduction",
      "methods",
      "results",
      "other",
    ]);
    const methods = detection.sections.find((s) => s.imrad === "methods");
    expect(methods?.text).toContain("Three sites.");
  });

  it("the line scan is only the fallback: it adds a label the outline did not anchor", () => {
    // A native outline that anchors Introduction only (P0-T18 measured 4 of
    // 23); "2. Methods" and "3. Results and Discussion" come from the scan.
    const detection = detectSectionsFromPdf(
      PDF_BODY,
      structure([
        entry("1. Introduction", 4, 0),
        entry("2. Methods", null, null),
        entry("3. Results and Discussion", null, null),
      ]),
    );
    expect(detection.stats).toMatchObject({
      outlineAnchored: 1,
      structureLocated: 1,
    });
    expect(detection.sections.map((s) => s.labels.join("+"))).toEqual([
      "other",
      "abstract",
      "introduction",
      "methods",
      "results+discussion",
      "conclusion",
    ]);
  });

  it("the fallback never re-adds a label a located structure heading carries", () => {
    // "Results of this kind recur." is a candidate line for the scan; with the
    // combined heading located from the structure, it adds nothing.
    const body =
      "1. Introduction\nText.\n2. Results\nRows.\nResults of this kind recur\nMore.";
    const detection = detectSectionsFromPdf(
      body,
      structure([entry("1. Introduction", 0, 0), entry("2. Results", 2, 0)]),
    );
    expect(
      detection.sections.filter((s) => s.imrad === "results"),
    ).toHaveLength(1);
    expect(detection.stats.fallbackAdded).toBe(0);
  });

  it("with no structure, the line scan alone applies §4.3's table", () => {
    const detection = detectSectionsFromPdf(PDF_BODY, null);
    expect(detection.sectionAware).toBe(true);
    expect(detection.sections.map((s) => s.labels.join("+"))).toEqual([
      "other",
      "abstract",
      "introduction",
      "methods",
      "results+discussion",
      "conclusion",
    ]);
    expect(detection.stats).toMatchObject({
      structure: false,
      structureCandidates: 0,
      fallbackAdded: 5,
    });
  });

  it(`gates at MIN_IMRAD_SECTIONS = 2 distinct label sets`, () => {
    expect(MIN_IMRAD_SECTIONS).toBe(2);
    const twoMethods = detectSectionsFromPdf("Methods\nA.\nMethods\nB.", null);
    expect(twoMethods).toMatchObject({ sectionAware: false, recognized: 1 });
  });
});

// ---------------------------------------------------------------------------
// The structure reader's narrowing
// ---------------------------------------------------------------------------

describe("narrowStructuredDocument (src/zotero/fulltext.ts)", () => {
  it("flattens the outline, resolves refs to block text and page, and keeps body heading blocks", () => {
    const doc = {
      schemaVersion: "1.2.0",
      metadata: {},
      catalog: {
        pages: [{}, {}],
        outline: [
          {
            title: "Methods",
            ref: [1],
            children: [{ title: "Sites", ref: [2, 0] }, { title: "Lost" }],
          },
          { title: "Out of range", ref: [99] },
        ],
      },
      content: [
        {
          type: "heading",
          flowClass: "excluded",
          content: [{ text: "Running head" }],
        },
        {
          type: "heading",
          anchor: { pageRects: [[1, 72, 700, 300, 714]] },
          content: [
            { text: "2. " },
            { text: "Methods", style: { bold: true } },
          ],
        },
        {
          type: "paragraph",
          anchor: { pageRects: [[1, 72, 600, 540, 690]] },
          content: [
            { type: "heading", content: [{ text: "Sites" }] },
            { type: "paragraph", content: [{ text: "Three\n sites." }] },
          ],
        },
      ],
    };
    expect(narrowStructuredDocument(doc)).toEqual({
      schemaVersion: "1.2.0",
      pageCount: 2,
      outline: [
        {
          title: "Methods",
          depth: 0,
          blockIndex: 1,
          blockText: "2. Methods",
          pageIndex: 1,
        },
        {
          title: "Sites",
          depth: 1,
          blockIndex: 2,
          blockText: "Sites Three sites.",
          pageIndex: 1,
        },
        {
          title: "Lost",
          depth: 1,
          blockIndex: null,
          blockText: null,
          pageIndex: null,
        },
        {
          title: "Out of range",
          depth: 0,
          blockIndex: null,
          blockText: null,
          pageIndex: null,
        },
      ],
      headingBlocks: [{ blockIndex: 1, text: "2. Methods", pageIndex: 1 }],
    });
  });

  it("yields an empty structure for a shape it does not know", () => {
    expect(narrowStructuredDocument(null)).toEqual({
      schemaVersion: null,
      pageCount: 0,
      outline: [],
      headingBlocks: [],
    });
  });
});

// ---------------------------------------------------------------------------
// The flag on AcquiredSource (step 4)
// ---------------------------------------------------------------------------

const ABSTRACT =
  "BACKGROUND: Synthetic widgets were studied at three invented field sites. " +
  "METHODS: Widgets were counted weekly for one simulated year by two observers. " +
  "RESULTS: Counts rose by four percent between the first and last quarter. " +
  "CONCLUSIONS: Widgets are countable, and the counts are stable between observers.";

const ITEM: AcquirableItem = {
  key: "ITEMKEY1",
  libraryID: 1,
  getField: () => ABSTRACT,
};
const ATTACHMENT: AcquirableAttachment = { id: 42, key: "ATTKEY01" };

function port(
  text: string | null,
  getDocumentStructure?: () => Promise<DocumentStructure | null>,
): FullTextPort<AcquirableItem, AcquirableAttachment> & {
  structureCalls: number;
} {
  const fake = {
    structureCalls: 0,
    pickTextAttachment: () =>
      Promise.resolve(text === null ? null : ATTACHMENT),
    getIndexedState: () => Promise.resolve(3),
    isPartialIndexState: () => false,
    getIndexedPageCounts: () => Promise.resolve(null),
    getAttachmentText: () => Promise.resolve(text),
    getFullTextAllPages: () => Promise.reject(new Error("unused")),
    getFullTextFirstPages: () => Promise.reject(new Error("unused")),
    md5Hex: () => "0".repeat(32),
  };
  if (getDocumentStructure === undefined) return fake;
  return {
    ...fake,
    getDocumentStructure() {
      this.structureCalls += 1;
      return getDocumentStructure();
    },
  };
}

const OPTIONS = { estimateTokens: (t: string) => t.length };

describe("acquireSource exposes sectionAware (P3-T21 step 4)", () => {
  it("Tier 2: sections are offsets into the final text, after the abstract preamble", async () => {
    setPrefStore(createMemoryPrefStore());
    const fake = port(PDF_BODY, () =>
      Promise.resolve(
        structure([
          entry("1. Introduction", 4, 0),
          entry("2. Methods", 6, 0),
          entry("3. Results and Discussion", 8, 1),
        ]),
      ),
    );
    const source = await acquireSource(ITEM, OPTIONS, fake);
    expect(source.tier).toBe("fulltext_pdf");
    expect(fake.structureCalls).toBe(1);
    expect(source.sectionAware).toBe(true);
    expect(source.sections[0]?.start).toBe(ABSTRACT.length + 2);
    expect(source.sections.at(-1)?.end).toBe(source.text.length);
    for (const s of source.sections) {
      expect(source.text.slice(s.start, s.end)).toBe(s.text);
    }
    expect(source.sections.some((s) => s.text.includes("BACKGROUND:"))).toBe(
      false,
    );
  });

  it("Tier 2: a structure read that throws falls back to the line scan and does not demote", async () => {
    setPrefStore(createMemoryPrefStore());
    const source = await acquireSource(
      ITEM,
      OPTIONS,
      port(PDF_BODY, () => Promise.reject(new Error("worker failed"))),
    );
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.sectionAware).toBe(true);
    expect(source.warnings).not.toContain("attachment_text_failed");
  });

  it("Tier 2 never reads the structure of a text D-06-3 truncated", async () => {
    setPrefStore(createMemoryPrefStore({ [PREF_KEYS.fullTextHardPageCap]: 3 }));
    const fake = port(PDF_BODY, () => Promise.resolve(structure([])));
    const partial = {
      ...fake,
      isPartialIndexState: () => true,
      getIndexedPageCounts: () =>
        Promise.resolve({ indexedPages: 2, total: 50 }),
      getFullTextFirstPages: (_id: number, maxPages: number) =>
        Promise.resolve({
          text: PDF_BODY,
          extractedPages: maxPages,
          totalPages: 50,
        }),
    };
    const source = await acquireSource(ITEM, OPTIONS, partial);
    expect(source.truncated).toBe(true);
    expect(partial.structureCalls).toBe(0);
    // The line scan still runs on the truncated text.
    expect(source.sectionAware).toBe(true);
  });

  it("Tier 2 without a structure reader runs the line scan", async () => {
    setPrefStore(createMemoryPrefStore());
    const source = await acquireSource(ITEM, OPTIONS, port(PDF_BODY));
    expect(source.sectionAware).toBe(true);
  });

  it("Tier 2 with a headingless body: sectionAware false and no sections", async () => {
    setPrefStore(createMemoryPrefStore());
    const source = await acquireSource(
      ITEM,
      OPTIONS,
      port("Just running text.\n\n\n\fMore running text.", () =>
        Promise.resolve(structure([])),
      ),
    );
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.sectionAware).toBe(false);
    expect(source.sections).toEqual([]);
  });

  it("Tier 1 never runs the detector, and never reads a structure", async () => {
    setPrefStore(createMemoryPrefStore());
    const fake = port(null, () => Promise.resolve(structure([])));
    const source = await acquireSource(ITEM, OPTIONS, fake);
    expect(source.tier).toBe("abstract");
    expect(source.sectionAware).toBe(false);
    expect(source.sections).toEqual([]);
    expect(fake.structureCalls).toBe(0);
  });

  it("Tier 4 (metadata only) has no sections", async () => {
    setPrefStore(createMemoryPrefStore());
    const source = await acquireSource(
      { ...ITEM, getField: () => "" },
      OPTIONS,
      port(null),
    );
    expect(source.tier).toBe("metadata_only");
    expect(source).toMatchObject({ sectionAware: false, sections: [] });
  });

  it("Tier 3: the JATS sections are labelled, offsets after the preamble", async () => {
    setPrefStore(createMemoryPrefStore());
    const extraction = extractJats(
      article(
        sec("intro", "Introduction", "A."),
        sec("methods", "Methods", "B."),
        sec("results", "Results", "C."),
      ),
    );
    const source = await acquireSource(
      ITEM,
      {
        ...OPTIONS,
        epmc: {
          identifiers: { pmcid: "PMC1" },
          fetch: () =>
            Promise.resolve({
              kind: "ok",
              extraction,
            } as unknown as Awaited<
              ReturnType<
                NonNullable<
                  Parameters<typeof acquireSource>[1]["epmc"]
                >["fetch"]
              >
            >),
        },
      },
      port(null),
    );
    expect(source.tier).toBe("fulltext_epmc");
    expect(source.sectionAware).toBe(true);
    expect(source.sections.map((s) => s.imrad)).toEqual([
      "introduction",
      "methods",
      "results",
    ]);
    for (const s of source.sections) {
      expect(source.text.slice(s.start, s.end)).toBe(s.text);
    }
  });
});
