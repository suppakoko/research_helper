import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import {
  acquireSource,
  type AcquirableAttachment,
  type AcquirableItem,
  type FullTextPort,
} from "../../../src/pipeline/summarize/acquire";
import {
  cleanFullText,
  collapsePageWhitespace,
  dropSupplementary,
  OCR_PROBE_MIN_ALNUM_PUNCT_SHARE,
  OCR_PROBE_MIN_CHARS,
  OCR_PROBE_MIN_LETTER_SHARE,
  probeOcrQuality,
  removeRunningHeads,
  splitPages,
  joinPages,
  stripLineNumberGutter,
  truncateReferences,
} from "../../../src/pipeline/summarize/clean";
import {
  detectLanguage,
  NON_LATIN_LETTER_SHARE_THRESHOLD,
} from "../../../src/pipeline/summarize/languageDetect";
import { PREF_KEYS, setPrefStore } from "../../../src/prefs";

/**
 * `docs/06` §4.1's cleaning pass, the OCR probe and §4.2's language check
 * (`P3-T19` steps 3–5), over the synthetic fixtures in
 * `test/fixtures/fulltext/` (see its README) and small inline strings.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function fixture(name: string): string {
  return readFileSync(resolve(ROOT, "test/fixtures/fulltext", name), "utf8");
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Plain English prose long enough to clear every probe threshold. */
function prose(chars: number): string {
  const sentence =
    "Widgets were counted weekly at three invented sites, and the two observers agreed closely. ";
  return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars);
}

afterEach(() => {
  setPrefStore(undefined);
});

// ---------------------------------------------------------------------------
// The whole pass over the fixtures
// ---------------------------------------------------------------------------

describe("cleanFullText over a two-column text fixture (P3-T19 step 3)", () => {
  const raw = fixture("two-column-synthetic.txt");
  const { text, report } = cleanFullText(raw);

  it("removes the running head and the page footer from every page", () => {
    expect(count(raw, "Journal of Synthetic Examples")).toBe(4);
    expect(count(text, "Journal of Synthetic Examples")).toBe(0);
    expect(text).not.toMatch(/Page \d of 4/u);
    expect(report.runningHeads).toBe(2);
    // Four heads; footers on pages 1–3 (page 4's went with the references).
    expect(report.runningHeadLinesRemoved).toBe(8);
  });

  it("removes the reference list, inside the 8–60 % band", () => {
    expect(text).not.toContain("References");
    expect(text).not.toContain("Monthly widget counts at one invented");
    expect(report.references.applied).toBe(true);
    const share = report.references.removedShare ?? 0;
    expect(share).toBeGreaterThanOrEqual(0.08);
    expect(share).toBeLessThanOrEqual(0.6);
    // Page 4 held only the references, so the text now ends with page 3.
    expect(
      text.endsWith(
        "Weekly counting is feasible, and two observers agree closely.",
      ),
    ).toBe(true);
  });

  it("keeps the page separators verbatim and every remaining line break", () => {
    // Three in the fixture; the one before the references-only page 4 went
    // with the cut.
    expect(count(raw, "\n\n\n\f")).toBe(3);
    expect(count(text, "\n\n\n\f")).toBe(2);
    expect(text).toContain("Results\nIn total 15,600 widgets were counted");
    // No line was joined, split or re-wrapped: every output line is an input line.
    const rawLines = new Set(raw.split(/[\n\f]/u));
    for (const line of text.split(/[\n\f]/u)) {
      expect(rawLines.has(line), line).toBe(true);
    }
  });

  it("leaves the split word and the suspended hyphen exactly as the extractor emitted them", () => {
    expect(text).toContain("The approach was tar\ngeted at the questions");
    expect(text).toContain("The N- and C-terminal halves");
  });

  it("probes the cleaned body and finds nothing to suspect in plain prose", () => {
    expect(report.ocr.chars).toBe(text.length);
    expect(report.ocr.chars).toBeGreaterThanOrEqual(OCR_PROBE_MIN_CHARS);
    expect(report.ocr.failed).toEqual([]);
    expect(report.ocr.suspected).toBe(false);
  });
});

describe("de-hyphenation does nothing (P3-T19 step 3; owner, 2026-10-21, item 258)", () => {
  it('a fixture with "N- and C-terminal" and "tar\\ngeted" comes out of the pass unchanged', () => {
    const raw = fixture("hyphenation-synthetic.txt");
    expect(raw).toContain("N- and C-terminal");
    expect(raw).toContain("tar\ngeted");
    const { text } = cleanFullText(raw);
    expect(text).toBe(raw);
    expect(text).toContain("N- and C-terminal");
    expect(text).toContain("open- and closed");
    expect(text).toContain("a- and b-wave");
    expect(text).toContain("tar\ngeted");
    expect(text).toContain("rho\ndopsin");
  });

  it("clean.ts carries no de-hyphenation regex outside its comments", () => {
    const source = readFileSync(
      resolve(ROOT, "src/pipeline/summarize/clean.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gmu, "$1");
    expect(source).not.toContain("-\\n");
    expect(source).not.toContain(")-[ \\t]+(");
    expect(source).not.toContain("\\p{Ll})\\n(");
  });
});

describe("line-number gutters (docs/06 §4.1 step 3)", () => {
  it("strips the leading number on every guttered page and keeps inner numbers", () => {
    const { text, report } = cleanFullText(
      fixture("line-numbers-synthetic.txt"),
    );
    expect(report.gutterPages).toBe(2);
    expect(text).toContain(
      "An invented preprint about counting widgets\nWidgets were",
    );
    expect(text).toContain(
      "A table row such as 12 widgets keeps its inner number.",
    );
    expect(text).not.toMatch(/^\d{1,3} /mu);
  });

  it("leaves a page alone when under half its lines are numbered", () => {
    const page =
      "Intro line\n12 widgets were seen\nAnother line\nA fourth line";
    expect(stripLineNumberGutter(page)).toEqual({ page, stripped: false });
  });
});

// ---------------------------------------------------------------------------
// Steps one at a time
// ---------------------------------------------------------------------------

describe("pages and running heads (docs/06 §4.1 steps 1–2)", () => {
  it("splitPages / joinPages round-trip any text byte for byte", () => {
    for (const text of [
      "",
      "one page only",
      "a\n\n\n\fb\fc\n\fd",
      "\fleading\n\n\n\ftrailing\n\n\n\f",
    ]) {
      expect(joinPages(splitPages(text))).toBe(text);
    }
  });

  it("never removes the first line of a one-page text", () => {
    expect(removeRunningHeads(["Title\nBody\nPage 1"]).linesRemoved).toBe(0);
  });

  it("removes a head seen on two of two pages, and keeps one seen on one of three", () => {
    const two = removeRunningHeads(["Head 1\nbody a", "Head 2\nbody b"]);
    expect(two.pages).toEqual(["body a", "body b"]);
    const three = removeRunningHeads([
      "Title page\nbody a\nend a",
      "Other\nbody b\nend b",
      "More\nbody c\nend c",
    ]);
    expect(three.linesRemoved).toBe(0);
  });

  it("removes bare page numbers only where they are a page's first or last line", () => {
    const { pages } = removeRunningHeads([
      "body a\n7\nmore a\n1",
      "body b\nmore b\n2",
      "body c\nmore c\n3",
    ]);
    expect(pages).toEqual([
      "body a\n7\nmore a",
      "body b\nmore b",
      "body c\nmore c",
    ]);
  });
});

describe("whitespace (docs/06 §4.1 step 5)", () => {
  it("collapses 3+ newlines and space runs inside a page, and never joins single newlines", () => {
    expect(collapsePageWhitespace("a  b\n\n\n\nc\nd   e")).toBe(
      "a b\n\nc\nd e",
    );
  });

  it("keeps the page separator itself", () => {
    const { text } = cleanFullText(`${prose(2000)}\n\n\n\f${prose(2000)}`);
    expect(count(text, "\n\n\n\f")).toBe(1);
  });
});

describe("reference list (docs/06 §4.1 step 6)", () => {
  it("does not cut a heading outside the last 45 %", () => {
    const text = `${prose(500)}\nReferences\n${prose(2000)}`;
    expect(truncateReferences(text)).toEqual({
      text,
      cut: { applied: false, reason: "no_heading", removedShare: null },
    });
  });

  it("does not cut when the removal would be under 8 %", () => {
    const text = `${prose(3000)}\nReferences\n1. One reference.`;
    const result = truncateReferences(text);
    expect(result.text).toBe(text);
    expect(result.cut).toMatchObject({
      applied: false,
      reason: "outside_band",
    });
  });

  it("cuts at the last heading in the tail, including one at the top of a page", () => {
    const text = `${prose(2000)}\n\n\n\fREFERENCES\n${prose(600)}`;
    const result = truncateReferences(text);
    expect(result.cut.applied).toBe(true);
    expect(result.text).toBe(prose(2000));
  });

  it("does not take a sentence that merely starts with the word", () => {
    const text = `${prose(2000)}\nReferences to earlier work are in the text.\n${prose(500)}`;
    expect(truncateReferences(text).cut.applied).toBe(false);
  });
});

describe("supplementary material (docs/06 §4.1 step 7)", () => {
  it("cuts at a heading that is the whole line, in the tail", () => {
    const text = `${prose(2000)}\nSupplementary Material\nTable S1 lists everything.`;
    expect(dropSupplementary(text).text).toBe(prose(2000));
  });

  it("does not cut at a sentence that starts with the phrase", () => {
    const text = `${prose(2000)}\nSupplementary figures S1-S3 show the raw counts.\n${prose(200)}`;
    expect(dropSupplementary(text)).toEqual({ text, removed: 0 });
  });

  it("does not cut at a heading in the first part of the text", () => {
    const text = `Supporting Information\n${prose(2000)}`;
    expect(dropSupplementary(text).removed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The OCR probe (P3-T19 step 4)
// ---------------------------------------------------------------------------

describe("probeOcrQuality (P3-T19 step 4, docs/06 §4.1 step 8)", () => {
  it("keeps the decided thresholds: 0.80 provisional, 1,500 and 0.60 as PROPOSALs", () => {
    expect(OCR_PROBE_MIN_ALNUM_PUNCT_SHARE).toBe(0.8);
    expect(OCR_PROBE_MIN_CHARS).toBe(1500);
    expect(OCR_PROBE_MIN_LETTER_SHARE).toBe(0.6);
  });

  it("passes clean prose", () => {
    const probe = probeOcrQuality(
      prose(3000).replace(/ /gu, "\n").replace(/\n/gu, " "),
    );
    expect(probe.failed).toEqual([]);
    expect(probe.suspected).toBe(false);
    expect(probe.alnumPunctShare).toBeGreaterThan(0.8);
  });

  it("flags glyph soup on the step 8 measure, digit soup on letters/total, and a short text", () => {
    const soup = prose(1600).replace(/[aeiou]/gu, "");
    expect(probeOcrQuality(soup).failed).toContain("alnum_punct_share");
    const digits = "12 34 56 78 90 ".repeat(150);
    expect(probeOcrQuality(digits).failed).toContain("letter_share");
    expect(probeOcrQuality(prose(1499)).failed).toEqual(["too_short"]);
    expect(probeOcrQuality(prose(1500)).failed).toEqual([]);
  });

  it("counts whitespace in the total and not in the numerator", () => {
    const probe = probeOcrQuality("ab  ");
    expect(probe.alnumPunctShare).toBe(0.5);
    expect(probe.whitespace).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Through acquireSource: the pass runs on Tier 2, the probe warns and never
// demotes, and the language check runs on every tier
// ---------------------------------------------------------------------------

interface Item extends AcquirableItem {
  readonly abstract: string;
}

function item(abstract: string): Item {
  return { key: "ITEMKEY1", libraryID: 1, abstract, getField: () => abstract };
}

function portWithText(
  text: string | null,
): FullTextPort<Item, AcquirableAttachment> {
  return {
    pickTextAttachment: () =>
      Promise.resolve(text === null ? null : { id: 9, key: "ATTKEY09" }),
    getIndexedState: () => Promise.resolve(3),
    isPartialIndexState: () => false,
    getIndexedPageCounts: () => Promise.resolve(null),
    getAttachmentText: () => Promise.resolve(text),
    getFullTextAllPages: () => Promise.reject(new Error("not used")),
    getFullTextFirstPages: () => Promise.reject(new Error("not used")),
    md5Hex: () => "0".repeat(32),
  };
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const ABSTRACT =
  "BACKGROUND: Synthetic widgets were studied at three invented field sites. " +
  "METHODS: Widgets were counted weekly for one simulated year by two observers. " +
  "RESULTS: Counts rose by 4% (95% CI 2-6%) between the first and last quarter. " +
  "CONCLUSIONS: Widgets are countable, and the counts are stable between observers.";

describe("the pass inside acquireSource (P3-T19 steps 3–5)", () => {
  it("Tier 2 text is the cleaned text, after the abstract preamble", async () => {
    const raw = fixture("two-column-synthetic.txt");
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens },
      portWithText(raw),
    );
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.text).toBe(`${ABSTRACT}\n\n${cleanFullText(raw).text}`);
  });

  it("ocr_suspected is a warning only: a suspected body stays Tier 2 though an abstract exists", async () => {
    const soup = prose(2000).replace(/[aeiou]/gu, "");
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens },
      portWithText(soup),
    );
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.warnings).toContain("ocr_suspected");
  });

  it("clean prose draws no ocr_suspected", async () => {
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens },
      portWithText(prose(3000)),
    );
    expect(source.warnings).not.toContain("ocr_suspected");
  });

  it("a body the pass empties demotes as attachment_text_empty", async () => {
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens },
      portWithText("   \n\n  "),
    );
    expect(source.tier).toBe("abstract");
    expect(source.warnings).toEqual(["attachment_text_empty"]);
  });

  it("a Korean-abstract fixture sets language_non_english", async () => {
    const korean = fixture("korean-abstract-synthetic.txt");
    const source = await acquireSource(
      item(korean),
      { estimateTokens },
      portWithText(null),
    );
    expect(source.tier).toBe("abstract");
    expect(source.warnings).toContain("language_non_english");
  });

  it("an English abstract does not", async () => {
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens },
      portWithText(null),
    );
    expect(source.warnings).not.toContain("language_non_english");
  });

  it("metadata_only text is not language-checked", async () => {
    setPrefStore(
      createMemoryPrefStore({ [PREF_KEYS.summaryMinAbstractChars]: 250 }),
    );
    const source = await acquireSource(
      item(""),
      { estimateTokens },
      portWithText(null),
    );
    expect(source.tier).toBe("metadata_only");
    expect(source.warnings).toEqual([]);
  });
});

describe("detectLanguage (P3-T19 step 5, docs/06 §4.2)", () => {
  it("is above 15 % of letters, not at it", () => {
    expect(NON_LATIN_LETTER_SHARE_THRESHOLD).toBe(0.15);
    const at = `${"a".repeat(85)}${"가".repeat(15)}`;
    expect(detectLanguage(at).nonLatinShare).toBeCloseTo(0.15, 10);
    expect(detectLanguage(at).nonEnglish).toBe(false);
    expect(
      detectLanguage(`${"a".repeat(84)}${"가".repeat(16)}`).nonEnglish,
    ).toBe(true);
  });

  it("counts Hangul, CJK, Cyrillic and Arabic, and names the dominant script", () => {
    expect(detectLanguage("基因编辑技术研究进展").dominantScript).toBe("cjk");
    expect(detectLanguage("Исследование виджетов").dominantScript).toBe(
      "cyrillic",
    );
    expect(detectLanguage("دراسة").dominantScript).toBe("arabic");
    expect(
      detectLanguage(fixture("korean-abstract-synthetic.txt")).dominantScript,
    ).toBe("hangul");
  });

  it("ignores digits, punctuation and Latin-script languages", () => {
    expect(detectLanguage("12345 !!! ...").letters).toBe(0);
    expect(detectLanguage("12345 !!! ...").nonEnglish).toBe(false);
    expect(detectLanguage("Über die Zählung von Widgets").nonEnglish).toBe(
      false,
    );
  });
});
