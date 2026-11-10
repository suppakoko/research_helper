/**
 * `P3-T22`: the IMRaD detector's accuracy harness, the 85 % bar and the
 * degrade switch.
 *
 * Pins four things:
 *
 * 1. **The scoring rules** of `docs/06` §4.3's note of 2026-11-10, each on a
 *    synthetic paper written here: only the body counts, labels are read in
 *    the owner's vocabulary, a results-and-discussion section needs both
 *    labels, `other` counts both ways, a declared failure scores zero, and
 *    figures pool over characters.
 * 2. **The regression check** over the committed 40-paper corpus: the
 *    detector as shipped is not below `IMRAD_MEASUREMENT`, and a deliberately
 *    degraded test double is caught. Skipped, with the reason in the title,
 *    only when the corpus is absent.
 * 3. **The degrade switch**: with `IMRAD_DETECTOR_VALIDATED` as committed, a
 *    full-text acquisition returns `sectionAware: false` and no sections.
 * 4. **The prompt selector**: on the flat path the rendered
 *    `PAPER_SUMMARY_FULLTEXT` has no section-provenance sentence.
 *
 * No network, no model; the labels are only read.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import { ConfigurationError } from "../../../src/core/errors";
import type { AcquiredSection, ImradSection } from "../../../src/model/summary";
import {
  acquireSource,
  type AcquirableAttachment,
  type AcquirableItem,
  type FullTextPort,
} from "../../../src/pipeline/summarize/acquire";
import {
  IMRAD_ACCURACY_BAR,
  IMRAD_DETECTOR_VALIDATED,
  IMRAD_MEASUREMENT,
} from "../../../src/pipeline/summarize/imrad";
import {
  fullTextPromptFor,
  SECTION_PROVENANCE_CLAUSE,
} from "../../../src/pipeline/summarize/summarizeItem";
import { setPrefStore } from "../../../src/prefs";
import { createPromptRegistry, renderPrompt } from "../../../src/prompts";
import type { ManifestPaper } from "../../../scripts/build-imrad-fixtures";
import {
  checkAgainstRecord,
  corpusAbsentReason,
  countedCharacters,
  correctCharacters,
  DETECTOR_WITHOUT_STRUCTURE,
  detectedSpans,
  loadCorpus,
  measureCorpus,
  meetsBar,
  pool,
  scoreKey,
  truthSpans,
  type CorpusPaper,
  type Detector,
  type DetectorAnswer,
  type PaperScore,
} from "../../../scripts/measure-imrad";

afterEach(() => {
  setPrefStore(undefined);
});

// ---------------------------------------------------------------------------
// Synthetic papers
// ---------------------------------------------------------------------------

/** A section the detector "found", spanning `[start, end)`. */
function found(
  start: number,
  end: number,
  labels: ImradSection[],
): AcquiredSection {
  return {
    imrad: labels[0] ?? "other",
    labels,
    heading: "",
    text: "",
    start,
    end,
  };
}

function answer(
  sections: AcquiredSection[],
  sectionAware = true,
): DetectorAnswer {
  return { sections, sectionAware, recognized: sections.length };
}

/**
 * A 100-character paper: preamble 0–10, introduction 10–30, results and
 * discussion 30–70, other 70–100.
 */
const TEXT = "x".repeat(100);
const LABELS = {
  sections: [
    { start: 10, labels: ["introduction"] as ImradSection[] },
    { start: 30, labels: ["results", "discussion"] as ImradSection[] },
    { start: 70, labels: ["other"] as ImradSection[] },
  ],
};

function paper(
  id: string,
  over: Partial<ManifestPaper> = {},
  hasImradStructure = true,
): CorpusPaper {
  return {
    paper: {
      id,
      publisher: "plos",
      columnCount: 1,
      preprint: false,
      ...over,
    } as ManifestPaper,
    text: TEXT,
    labels: {
      hasImradStructure,
      sections: LABELS.sections.map((s) => ({
        ...s,
        heading: "",
        origin: "candidate" as const,
      })),
    } as unknown as CorpusPaper["labels"],
  };
}

function score(detected: DetectorAnswer): number {
  return correctCharacters(
    truthSpans(LABELS, TEXT.length),
    detectedSpans(detected),
  );
}

describe("the scoring rules (docs/06 §4.3, note of 2026-11-10)", () => {
  it("reads the detector's labels in the owner's vocabulary", () => {
    expect(scoreKey(["background"])).toBe("introduction");
    expect(scoreKey(["related_work"])).toBe("introduction");
    expect(scoreKey(["conclusion"])).toBe("other");
    expect(scoreKey(["limitations"])).toBe("other");
    expect(scoreKey(["abstract"])).toBe("other");
    expect(scoreKey(["results", "discussion"])).toBe("results+discussion");
    expect(scoreKey(["discussion", "results"])).toBe("results+discussion");
    expect(scoreKey([])).toBe("other");
  });

  it("counts the body only: the preamble before the first labelled start is not scored", () => {
    expect(countedCharacters(truthSpans(LABELS, TEXT.length))).toBe(90);
    // A detector right everywhere, including a wrong preamble, scores 90 of 90.
    expect(
      score(
        answer([
          found(0, 10, ["methods"]),
          found(10, 30, ["introduction"]),
          found(30, 70, ["results", "discussion"]),
          found(70, 100, ["conclusion"]),
        ]),
      ),
    ).toBe(90);
  });

  it("scores a results-and-discussion section correct only with both labels", () => {
    const only = (labels: ImradSection[]) =>
      score(
        answer([
          found(0, 30, ["introduction"]),
          found(30, 70, labels),
          found(70, 100, ["other"]),
        ]),
      );
    expect(only(["results", "discussion"])).toBe(90);
    expect(only(["results"])).toBe(50);
    expect(only(["discussion"])).toBe(50);
  });

  it("counts other both ways", () => {
    // Back matter called results is wrong; an IMRaD section called other is wrong.
    expect(
      score(
        answer([found(0, 70, ["introduction"]), found(70, 100, ["results"])]),
      ),
    ).toBe(20);
    expect(score(answer([found(0, 100, ["other"])]))).toBe(30);
  });

  it("scores a declared failure zero, whatever sections it lists", () => {
    expect(score(answer([found(0, 30, ["introduction"])], false))).toBe(0);
  });

  it("splits a detected section across owner boundaries by character", () => {
    expect(
      score(
        answer([
          found(0, 25, ["introduction"]),
          found(25, 75, ["results", "discussion"]),
          found(75, 100, ["other"]),
        ]),
      ),
    ).toBe(15 + 40 + 25);
  });

  it("pools over characters, with the mean of papers beside it", () => {
    const scores = [
      { counted: 100, correct: 100 },
      { counted: 900, correct: 0 },
    ] as PaperScore[];
    const group = pool("g", scores);
    expect(group.accuracy).toBeCloseTo(0.1);
    expect(group.meanOfPapers).toBeCloseTo(0.5);
  });

  it("passes the bar at exactly 85 % and not below", () => {
    expect(IMRAD_ACCURACY_BAR).toBe(0.85);
    expect(meetsBar({ correct: 85, counted: 100 })).toBe(true);
    expect(meetsBar({ correct: 8499, counted: 10_000 })).toBe(false);
  });

  it("pools only the papers with IMRaD structure, and breaks them down three ways", () => {
    const perfect: Detector = () =>
      answer([
        found(0, 30, ["introduction"]),
        found(30, 70, ["results", "discussion"]),
        found(70, 100, ["other"]),
      ]);
    const m = measureCorpus(
      [
        paper("P1"),
        paper("A1", { publisher: "arxiv", preprint: true, columnCount: 2 }),
        paper("N2", {}, false),
      ],
      perfect,
    );
    expect(m.overall).toMatchObject({ papers: 2, counted: 180, correct: 180 });
    expect(m.excluded).toMatchObject({ papers: 1, counted: 90 });
    expect(m.byFamily.map((g) => g.group).sort()).toEqual(["arxiv", "plos"]);
    expect(m.byColumns.map((g) => g.group).sort()).toEqual([
      "1 column",
      "2 columns",
    ]);
    expect(m.byPublication.map((g) => g.group).sort()).toEqual([
      "preprint",
      "published",
    ]);
    expect(m.papers.map((p) => p.id)).toEqual(["P1", "A1", "N2"]);
  });

  it("checks a measurement against the record in whole characters", () => {
    const m = measureCorpus([paper("P1")], () =>
      answer([found(0, 30, ["introduction"]), found(30, 100, ["other"])]),
    );
    const record = {
      measuredOn: "2026-11-10",
      path: "pdf-without-structure" as const,
      papers: 1,
      countedChars: 90,
      correctChars: 50,
    };
    expect(checkAgainstRecord(m, record).ok).toBe(true);
    expect(checkAgainstRecord(m, { ...record, correctChars: 51 }).ok).toBe(
      false,
    );
    expect(checkAgainstRecord(m, { ...record, countedChars: 91 }).ok).toBe(
      false,
    );
    expect(checkAgainstRecord(m, { ...record, papers: 2 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The regression check over the committed corpus
// ---------------------------------------------------------------------------

const absent = corpusAbsentReason();
if (absent !== null) {
  console.warn(`imradAccuracy: corpus regression skipped — ${absent}`);
}

describe.skipIf(absent !== null)(
  `the committed measurement (P3-T22 step 5)${absent === null ? "" : ` — skipped: the corpus is absent (${absent})`}`,
  () => {
    let corpus: CorpusPaper[] = [];
    beforeAll(async () => {
      corpus = await loadCorpus();
    });

    it("re-measures the detector as shipped and is not below the recorded value", () => {
      const m = measureCorpus(corpus);
      const check = checkAgainstRecord(m);
      expect(check.problems).toEqual([]);
      expect(check.ok).toBe(true);
      expect(m.overall.papers).toBe(IMRAD_MEASUREMENT.papers);
      expect(m.excluded.papers).toBe(corpus.length - IMRAD_MEASUREMENT.papers);
    });

    it("fails on a deliberately degraded test double", () => {
      // Every results label becomes discussion: a plausible regression.
      const degraded: Detector = (text) => {
        const real = DETECTOR_WITHOUT_STRUCTURE(text);
        return {
          ...real,
          sections: real.sections.map((s) =>
            s.labels.includes("results")
              ? { ...s, imrad: "discussion", labels: ["discussion"] }
              : s,
          ),
        };
      };
      const check = checkAgainstRecord(measureCorpus(corpus, degraded));
      expect(check.ok).toBe(false);
      expect(check.problems.join(" ")).toMatch(/below the recorded/u);
    });

    it("keeps every breakdown a partition of the overall figure", () => {
      const m = measureCorpus(corpus);
      for (const groups of [m.byFamily, m.byColumns, m.byPublication]) {
        expect(groups.reduce((sum, g) => sum + g.counted, 0)).toBe(
          m.overall.counted,
        );
        expect(groups.reduce((sum, g) => sum + g.correct, 0)).toBe(
          m.overall.correct,
        );
      }
    });

    it("derives IMRAD_DETECTOR_VALIDATED from the record and the bar", () => {
      expect(IMRAD_DETECTOR_VALIDATED).toBe(
        meetsBar({
          correct: IMRAD_MEASUREMENT.correctChars,
          counted: IMRAD_MEASUREMENT.countedChars,
        }),
      );
    });
  },
);

// ---------------------------------------------------------------------------
// The degrade switch in acquireSource
// ---------------------------------------------------------------------------

const ABSTRACT =
  "BACKGROUND: Synthetic widgets were studied at three invented field sites. " +
  "METHODS: Widgets were counted weekly for one simulated year by two observers.";
const BODY = [
  "1. Introduction",
  "Widgets are small and plentiful at every invented site we visited.",
  "",
  "2. Methods",
  "Two observers counted the widgets every week for one simulated year.",
  "",
  "3. Results",
  "Counts rose by four percent between the first and the last quarter.",
  "",
  "4. Discussion",
  "The rise is small and the counts agree between the two observers.",
].join("\n");

const ITEM: AcquirableItem = {
  key: "ITEMKEY1",
  libraryID: 1,
  getField: () => ABSTRACT,
};
const ATTACHMENT: AcquirableAttachment = { id: 42, key: "ATTKEY01" };

const PORT: FullTextPort<AcquirableItem, AcquirableAttachment> = {
  pickTextAttachment: () => Promise.resolve(ATTACHMENT),
  getIndexedState: () => Promise.resolve(3),
  isPartialIndexState: () => false,
  getIndexedPageCounts: () => Promise.resolve(null),
  getAttachmentText: () => Promise.resolve(BODY),
  getFullTextAllPages: () => Promise.reject(new Error("unused")),
  getFullTextFirstPages: () => Promise.reject(new Error("unused")),
  md5Hex: () => "0".repeat(32),
};

describe("the degrade switch (P3-T22 step 2)", () => {
  it("returns sectionAware false and no sections by default, and logs what the detector found", async () => {
    setPrefStore(createMemoryPrefStore());
    const lines: Record<string, unknown>[] = [];
    const source = await acquireSource(
      ITEM,
      {
        estimateTokens: (t) => t.length,
        logger: {
          child: () => {
            throw new Error("unused");
          },
          error: () => undefined,
          warn: () => undefined,
          info: () => undefined,
          debug: (_msg, ctx) => {
            if (ctx !== undefined) lines.push(ctx);
          },
          time: (_msg, fn) => fn(),
        },
      },
      PORT,
    );
    expect(IMRAD_DETECTOR_VALIDATED).toBe(false);
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.sectionAware).toBe(false);
    expect(source.sections).toEqual([]);
    expect(lines[0]).toMatchObject({
      sectionAware: false,
      sectionAwareDetected: true,
      imradDetectorValidated: false,
    });
  });

  it("passes the detector's sections through only when validated", async () => {
    setPrefStore(createMemoryPrefStore());
    const source = await acquireSource(
      ITEM,
      { estimateTokens: (t) => t.length, imradDetectorValidated: true },
      PORT,
    );
    expect(source.sectionAware).toBe(true);
    expect(source.sections.map((s) => s.labels.join("+"))).toEqual([
      "introduction",
      "methods",
      "results",
      "discussion",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The prompt selector
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const promptDir = resolve(here, "../../../src/prompts");
const PROMPTS = createPromptRegistry(
  readdirSync(promptDir)
    .filter((name) => name.endsWith(".md"))
    .map((fileName) => ({
      fileName,
      text: readFileSync(resolve(promptDir, fileName), "utf8"),
    })),
);

function renderFullText(sectionAware: boolean) {
  const template = fullTextPromptFor(
    PROMPTS.get("PAPER_SUMMARY_FULLTEXT"),
    sectionAware,
  );
  const vars = Object.fromEntries(
    template.variables.map((name) => [name, `<${name}>`]),
  );
  return renderPrompt(template, vars);
}

describe("the prompt selector (P3-T22 step 3)", () => {
  it("renders PAPER_SUMMARY_FULLTEXT with no section-provenance sentence when sectionAware is false", () => {
    const flat = renderFullText(false);
    expect(flat.user).not.toMatch(/\[SECTION|sections are label/iu);
    expect(flat.user).toContain("SOURCE TEXT (untrusted):");
    expect(flat.user).toContain("<FULL_TEXT>");
  });

  it("changes nothing but that clause: the system text and every other line are as written", () => {
    const flat = renderFullText(false);
    const aware = renderFullText(true);
    expect(aware.user).toContain(SECTION_PROVENANCE_CLAUSE);
    expect(flat.system).toBe(aware.system);
    expect(flat.user).toBe(aware.user.replace(SECTION_PROVENANCE_CLAUSE, ""));
  });

  it("refuses a template that would still claim section labels on the flat path", () => {
    const template = PROMPTS.get("PAPER_SUMMARY_FULLTEXT");
    const reworded = {
      ...template,
      user: template.user.replace(
        SECTION_PROVENANCE_CLAUSE,
        "; each section is marked [SECTION: name]",
      ),
    };
    expect(() => fullTextPromptFor(reworded, false)).toThrow(
      ConfigurationError,
    );
  });
});
