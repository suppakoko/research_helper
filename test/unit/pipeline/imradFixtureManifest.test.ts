/**
 * `P3-T20`: the 40-paper IMRaD fixture set (`test/fixtures/imrad/`).
 *
 * Pins three things:
 *
 * 1. **The manifest** — 40 papers, the card's composition rule (≥ 4 per
 *    family `docs/06` §4.3 names, ≥ 6 preprints), a redistributable licence
 *    on every paper, and each paper's committed text matching its sidecar's
 *    SHA-256 byte for byte.
 * 2. **The label format** — {@link validateLabels} refuses offsets that are
 *    not strictly increasing, outside the text, off a line start or not
 *    followed by their heading; and {@link decisionsToLabels} turns the
 *    owner's page decisions into labels without inventing any.
 * 3. **The labels on disk** — none exists yet, or every one validates.
 *
 * And the line-shape rule behind the labelling page: plain, and **not** the
 * detector under test.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildCandidatesFile,
  CANDIDATE_MAX_CHARS,
  CANDIDATES_FILE,
  candidateLines,
  columnCountFromGeometry,
  decisionsToLabels,
  IMRAD_DIR,
  IMRAD_SECTIONS,
  IMRAD_SECTIONS_COMPLETE,
  isCandidateLine,
  LABELS_DIR,
  locateAddedLine,
  NAMED_FAMILIES,
  OWNER_LABEL_SECTIONS,
  OWNER_LABELS,
  pageAt,
  parseDownloadLog,
  readDecisionExport,
  readManifest,
  REDISTRIBUTABLE_LICENCES,
  sha256Hex,
  splitLines,
  validateFixtureSet,
  validateLabels,
  validateManifest,
  type CandidatesFile,
  type LabelsFile,
  type PaperCandidates,
} from "../../../scripts/build-imrad-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../../../scripts/build-imrad-fixtures.ts");
const SPEC = resolve(HERE, "../../../scripts/imrad-fixtures/extract.spec.ts");

// ---------------------------------------------------------------------------
// A small synthetic text, so the label checks do not depend on any paper
// ---------------------------------------------------------------------------

const TEXT = [
  "A Synthetic Title",
  "Abstract",
  "We counted invented widgets at three sites over one year.",
  "1 Introduction",
  "Widgets have a fictional history.",
  "\f2 Methods",
  "Observers walked a transect.",
  "  3 Results and Discussion",
  "Counts rose. We read the rise as seasonal.",
  "Acknowledgements",
  "Thanks to nobody.",
].join("\n");

const at = (needle: string): number => {
  const i = TEXT.indexOf(needle);
  if (i < 0) throw new Error(`no ${needle}`);
  return i;
};

function labels(overrides: Partial<LabelsFile> = {}): LabelsFile {
  return {
    schema: "imrad-labels-v1",
    id: "S1",
    textFile: "text/S1.txt",
    textSha256: sha256Hex(TEXT),
    textChars: TEXT.length,
    hasImradStructure: true,
    sections: [
      {
        start: at("1 Introduction"),
        heading: "1 Introduction",
        labels: ["introduction"],
        origin: "candidate",
      },
      {
        start: at("2 Methods"),
        heading: "2 Methods",
        labels: ["methods"],
        origin: "candidate",
      },
      {
        start: at("3 Results"),
        heading: "3 Results and Discussion",
        labels: ["results", "discussion"],
        origin: "candidate",
      },
    ],
    adjudication: { by: "owner", source: "export.json", decidedAt: null },
    ...overrides,
  };
}

function candidatesFor(text: string): PaperCandidates {
  const file = buildCandidatesFile([{ id: "S1", text }]);
  const paper = file.papers[0];
  if (paper === undefined) throw new Error("no paper");
  return paper;
}

// ---------------------------------------------------------------------------
// 1. The manifest
// ---------------------------------------------------------------------------

describe("imrad fixture manifest", () => {
  it("lists 40 papers with every field the card names", async () => {
    const raw: unknown = JSON.parse(
      await readFile(join(IMRAD_DIR, "manifest.json"), "utf8"),
    );
    expect(validateManifest(raw)).toEqual([]);
    const manifest = await readManifest();
    expect(manifest.papers).toHaveLength(40);
    for (const paper of manifest.papers) {
      expect(typeof paper.publisher).toBe("string");
      expect(paper.layout).toBeDefined();
      expect([1, 2, null]).toContain(paper.columnCount);
      expect(typeof paper.preprint).toBe("boolean");
      expect(REDISTRIBUTABLE_LICENCES).toContain(paper.licence);
      expect([true, false, null]).toContain(paper.hasImradStructure);
    }
  });

  it("meets the composition rule: ≥ 4 per docs/06 §4.3 family, ≥ 6 preprints", async () => {
    const { papers } = await readManifest();
    for (const family of NAMED_FAMILIES) {
      expect(
        papers.filter((p) => p.publisher === family).length,
        family,
      ).toBeGreaterThanOrEqual(4);
    }
    expect(papers.filter((p) => p.preprint).length).toBeGreaterThanOrEqual(6);
    expect(
      papers.every(
        (p) => p.preprint === ["arxiv", "biorxiv"].includes(p.publisher),
      ),
    ).toBe(true);
  });

  it("has, for every paper, its text and a sidecar whose SHA-256 matches it byte for byte", async () => {
    expect(await validateFixtureSet()).toEqual([]);
  });

  it("refuses a manifest entry with a non-redistributable licence or a bad id", () => {
    const paper = {
      id: "S1",
      title: "t",
      venue: "v",
      publisher: "springer",
      doi: "10.1/x",
      otherId: null,
      landingUrl: "u",
      sourceUrl: "u",
      licence: "CC BY-NC 4.0",
      licenceEvidence: "e",
      preprint: false,
      scanned: false,
      layout: {
        columnsExpected: 2,
        columnsExpectedBasis: "b",
        headingNumbering: "none",
        webHeadings: null,
        notes: [],
      },
      columnCount: null,
      columnCountBasis: "b",
      textFile: "text/S1.txt",
      labelsFile: "labels/S1.json",
      hasImradStructure: null,
    };
    expect(
      validateManifest({ schema: "imrad-manifest-v1", papers: [paper] }),
    ).toEqual(["S1: licence CC BY-NC 4.0"]);
    expect(
      validateManifest({
        schema: "imrad-manifest-v1",
        papers: [{ ...paper, licence: "CC BY 4.0", id: "../x" }],
      }),
    ).toEqual(["papers[0]: id"]);
  });

  it("reads the PDF folder's download log", () => {
    const log = parseDownloadLog(
      "S1 ok 200 application/pdf 726547 999152186529bc6a\r\nX3 removed (owner, item 277)\n",
    );
    expect([...log.entries()]).toEqual([
      ["S1", { bytes: 726547, sha256Prefix: "999152186529bc6a" }],
    ]);
  });

  it("decides the column count from the structured text's geometry", () => {
    expect(columnCountFromGeometry(undefined)).toBeNull();
    expect(
      columnCountFromGeometry({ pagesWithBody: 0, twoColumnPages: 0 }),
    ).toBeNull();
    expect(
      columnCountFromGeometry({ pagesWithBody: 10, twoColumnPages: 5 }),
    ).toBe(2);
    expect(
      columnCountFromGeometry({ pagesWithBody: 10, twoColumnPages: 4 }),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. The label format and its ingestion
// ---------------------------------------------------------------------------

describe("imrad labels format", () => {
  it("lists every ImradSection, in docs/06 §4.3 order", () => {
    expect(IMRAD_SECTIONS_COMPLETE).toBe(true);
    expect(IMRAD_SECTIONS).toHaveLength(10);
  });

  it("accepts a well-formed file", () => {
    expect(validateLabels(labels(), "S1", TEXT)).toEqual([]);
  });

  it("refuses offsets that are not strictly increasing", () => {
    const base = labels();
    const [a, b, c] = base.sections;
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error("fixture");
    }
    expect(
      validateLabels({ ...base, sections: [a, c, b] }, "S1", TEXT).join("\n"),
    ).toMatch(/is not after the previous start/u);
    expect(
      validateLabels({ ...base, sections: [a, a] }, "S1", TEXT).join("\n"),
    ).toMatch(/is not after the previous start/u);
  });

  it("refuses an offset outside the text, off a line start, or not at its heading", () => {
    const base = labels();
    const one = (section: object): string =>
      validateLabels(
        { ...base, sections: [{ ...base.sections[0], ...section }] },
        "S1",
        TEXT,
      ).join("\n");
    expect(one({ start: TEXT.length })).toMatch(/outside the text/u);
    expect(one({ start: -1 })).toMatch(/outside the text/u);
    expect(one({ start: 1.5 })).toMatch(/outside the text/u);
    expect(one({ start: at("Introduction"), heading: "Introduction" })).toMatch(
      /not at the start of a line/u,
    );
    expect(one({ heading: "2 Methods" })).toMatch(/is not "2 Methods"/u);
    expect(one({ heading: "1 Introduction\nx" })).toMatch(/one trimmed/u);
  });

  it("accepts a heading after a page separator or indentation", () => {
    expect(validateLabels(labels(), "S1", TEXT)).toEqual([]);
    expect(TEXT[at("2 Methods") - 1]).toBe("\f");
    expect(TEXT.slice(at("3 Results") - 3, at("3 Results"))).toBe("\n  ");
  });

  it("refuses labels outside the enum, out of table order, or other with company", () => {
    const base = labels();
    const one = (labelList: readonly string[]): string =>
      validateLabels(
        {
          ...base,
          sections: [{ ...base.sections[0], labels: labelList }],
        },
        "S1",
        TEXT,
      ).join("\n");
    expect(one([])).toMatch(/non-empty/u);
    expect(one(["intro"])).toMatch(/not an ImradSection/u);
    expect(one(["discussion", "results"])).toMatch(/table order/u);
    expect(one(["results", "results"])).toMatch(/table order/u);
    expect(one(["methods", "other"])).toMatch(/stands alone/u);
  });

  it("binds a file to its exact text: hash, length, id", () => {
    expect(validateLabels(labels(), "S1", `${TEXT} `).join("\n")).toMatch(
      /textSha256/u,
    );
    expect(validateLabels(labels(), "S2", TEXT).join("\n")).toMatch(/id S1/u);
    expect(
      validateLabels(
        labels({ hasImradStructure: null as unknown as boolean }),
        "S1",
        TEXT,
      ).join("\n"),
    ).toMatch(/hasImradStructure/u);
  });
});

describe("ingesting the owner's decisions", () => {
  const cands = candidatesFor(TEXT);
  const cand = (line: string): { offset: number; line: string } => {
    const hit = cands.candidates.find((c) => c.line === line);
    if (hit === undefined) throw new Error(`no candidate ${line}`);
    return { offset: hit.offset, line: hit.line };
  };

  it("maps each owner label, drops not-heading and unmarked lines, adds by line text", () => {
    const outcome = decisionsToLabels(
      "S1",
      {
        hasImradStructure: true,
        updatedAt: "2026-10-25T00:00:00Z",
        headings: [
          { ...cand("A Synthetic Title"), label: "not-heading" },
          { ...cand("Abstract") },
          { ...cand("1 Introduction"), label: "introduction" },
          { ...cand("2 Methods"), label: "methods" },
          { ...cand("3 Results and Discussion"), label: "results+discussion" },
          { ...cand("Acknowledgements"), label: "other", note: "x" },
        ],
        added: [{ line: "Counts rose", label: "results" }],
      },
      TEXT,
      cands,
      "export.json",
    );
    expect(outcome.kind).toBe("labels");
    if (outcome.kind !== "labels") return;
    expect(
      outcome.labels.sections.map((s) => [
        s.heading,
        s.labels.join("+"),
        s.origin,
      ]),
    ).toEqual([
      ["1 Introduction", "introduction", "candidate"],
      ["2 Methods", "methods", "candidate"],
      ["3 Results and Discussion", "results+discussion", "candidate"],
      ["Counts rose", "results", "owner-added"],
      ["Acknowledgements", "other", "candidate"],
    ]);
    expect(outcome.labels.adjudication).toEqual({
      by: "owner",
      source: "export.json",
      decidedAt: "2026-10-25T00:00:00Z",
    });
    expect(validateLabels(outcome.labels, "S1", TEXT)).toEqual([]);
  });

  it("keeps a paper pending until hasImradStructure is set, and writes nothing for it", () => {
    expect(decisionsToLabels("S1", undefined, TEXT, cands, "e").kind).toBe(
      "pending",
    );
    expect(
      decisionsToLabels(
        "S1",
        { headings: [{ ...cand("2 Methods"), label: "methods" }] },
        TEXT,
        cands,
        "e",
      ).kind,
    ).toBe("pending");
  });

  it("records a paper with no IMRaD structure and no headings", () => {
    const outcome = decisionsToLabels(
      "S1",
      { hasImradStructure: false },
      TEXT,
      cands,
      "e",
    );
    expect(outcome.kind).toBe("labels");
    if (outcome.kind === "labels") {
      expect(outcome.labels.hasImradStructure).toBe(false);
      expect(outcome.labels.sections).toEqual([]);
    }
  });

  it("refuses a stale or unknown candidate, an unknown label, and a clash", () => {
    const errorsOf = (doc: unknown): string => {
      const outcome = decisionsToLabels("S1", doc, TEXT, cands, "e");
      return outcome.kind === "invalid" ? outcome.errors.join("\n") : "";
    };
    expect(
      errorsOf({
        hasImradStructure: true,
        headings: [{ offset: 3, line: "Synthetic", label: "methods" }],
      }),
    ).toMatch(/no candidate/u);
    expect(
      errorsOf({
        hasImradStructure: true,
        headings: [{ ...cand("2 Methods"), label: "conclusion" }],
      }),
    ).toMatch(/label conclusion/u);
    expect(
      errorsOf({
        hasImradStructure: true,
        headings: [{ ...cand("2 Methods"), label: "methods" }],
        added: [{ line: "2 Methods", label: "results" }],
      }),
    ).toMatch(/two headings at offset/u);
    expect(
      errorsOf({
        hasImradStructure: true,
        added: [{ line: "No such line", label: "results" }],
      }),
    ).toMatch(/no line reads/u);
  });

  it("refuses decisions made on an older text", () => {
    const outcome = decisionsToLabels(
      "S1",
      { hasImradStructure: true },
      `${TEXT}\nmore`,
      cands,
      "e",
    );
    expect(outcome.kind).toBe("invalid");
  });

  it("finds an owner-added line exactly first, then as a line prefix, and asks for an occurrence when ambiguous", () => {
    const text = "Methods\nx\nMethods\nResults: we saw\nResultsish";
    expect(locateAddedLine(text, "Methods")).toEqual({
      error: '2 lines read "Methods"; give an occurrence',
    });
    expect(locateAddedLine(text, "Methods", 2)).toEqual({ offset: 10 });
    expect(locateAddedLine(text, "Results")).toEqual({ offset: 18 });
    expect(locateAddedLine(text, "Methods", 3)).toEqual({
      error: '"Methods" has no occurrence 3',
    });
  });

  it("reads the export in the shapes a collection export takes", () => {
    const doc = { hasImradStructure: true };
    for (const shape of [
      { S1: doc },
      [{ id: "S1", ...doc }],
      [{ doc_id: "S1", data: doc }],
      { docs: [{ docId: "S1", data: doc }] },
    ]) {
      const map = readDecisionExport(shape);
      expect([...map.keys()]).toEqual(["S1"]);
      expect(map.get("S1")).toMatchObject(doc);
    }
    expect(() => readDecisionExport([{ data: doc }])).toThrow(/no id/u);
  });

  it("offers the owner exactly the page's seven labels", () => {
    expect(OWNER_LABELS).toEqual([
      "introduction",
      "methods",
      "results",
      "discussion",
      "results+discussion",
      "other",
      "not-heading",
    ]);
    expect(OWNER_LABEL_SECTIONS["results+discussion"]).toEqual([
      "results",
      "discussion",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. The labels on disk
// ---------------------------------------------------------------------------

describe("imrad labels on disk", () => {
  it("has no labels file yet, or every one validates against its text", async () => {
    const dir = join(IMRAD_DIR, LABELS_DIR);
    const names = existsSync(dir)
      ? (await readdir(dir)).filter((n) => n.endsWith(".json"))
      : [];
    const manifest = await readManifest();
    for (const name of names) {
      const id = name.slice(0, -".json".length);
      expect(manifest.papers.map((p) => p.id)).toContain(id);
      const text = await readFile(join(IMRAD_DIR, "text", `${id}.txt`), "utf8");
      const value: unknown = JSON.parse(
        await readFile(join(dir, name), "utf8"),
      );
      expect(validateLabels(value, id, text), name).toEqual([]);
    }
    // Until the owner labels, hasImradStructure stays null everywhere.
    const labelled = new Set(names.map((n) => n.slice(0, -".json".length)));
    for (const paper of manifest.papers) {
      expect(paper.hasImradStructure === null, paper.id).toBe(
        !labelled.has(paper.id),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The labelling page's candidate lines
// ---------------------------------------------------------------------------

describe("candidate heading lines (plain line-shape rule)", () => {
  it("keeps short lines with a letter that do not end with a full stop", () => {
    expect(isCandidateLine("Methods")).toBe(true);
    expect(isCandidateLine("2.1 Cell culture")).toBe(true);
    expect(isCandidateLine("III. RESULTS AND DISCUSSION")).toBe(true);
    expect(isCandidateLine("Results: see below")).toBe(true);
    expect(isCandidateLine("Counts rose.")).toBe(false);
    expect(isCandidateLine("12.5")).toBe(false);
    expect(isCandidateLine("")).toBe(false);
    expect(isCandidateLine("x".repeat(CANDIDATE_MAX_CHARS))).toBe(true);
    expect(isCandidateLine("x".repeat(CANDIDATE_MAX_CHARS + 1))).toBe(false);
  });

  it("gives each candidate its offset, the next line's start and its page", () => {
    const lines = candidateLines(TEXT);
    for (const c of lines) expect(TEXT.startsWith(c.line, c.offset)).toBe(true);
    const results = lines.find((c) => c.line.startsWith("3 Results"));
    expect(results).toEqual({
      offset: at("3 Results"),
      line: "3 Results and Discussion",
      next: "Counts rose. We read the rise as seasonal.",
      page: 2,
    });
    expect(pageAt(TEXT, 0)).toBe(1);
    expect(splitLines("a\nb\fc")).toEqual([
      { start: 0, raw: "a" },
      { start: 2, raw: "b" },
      { start: 4, raw: "c" },
    ]);
  });

  it("is not the detector under test: neither half imports src/pipeline/summarize/imrad", async () => {
    for (const file of [SCRIPT, SPEC]) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/summarize\/imrad["']/u);
      expect(source, file).not.toMatch(
        /IMRAD_HEADING_TABLE|labelHeading|isCandidateHeadingLine|detectSections/u,
      );
    }
  });

  it("matches the committed candidate-headings.json, rebuilt from the committed text", async () => {
    const committed = JSON.parse(
      await readFile(join(IMRAD_DIR, CANDIDATES_FILE), "utf8"),
    ) as CandidatesFile;
    const manifest = await readManifest();
    const texts = await Promise.all(
      manifest.papers.map(async (p) => ({
        id: p.id,
        text: await readFile(join(IMRAD_DIR, p.textFile), "utf8"),
      })),
    );
    expect(committed).toEqual(buildCandidatesFile(texts));
    expect(committed.papers).toHaveLength(40);
  });
});
