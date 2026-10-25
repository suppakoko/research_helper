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
  findNumberedReferenceList,
  OCR_SPLIT_MAX_SHARE,
  OCR_SPLIT_MIN_WORDS,
  probeStraySpaceSplits,
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
import { expandHunspellWordList } from "../../../src/pipeline/summarize/wordList";
import { PREF_KEYS, setPrefStore } from "../../../src/prefs";
import type { HunspellFiles } from "../../../src/zotero/fulltext";

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

  it("probes the cleaned body: without a word list it judges nothing", () => {
    expect(report.ocr.words).toBeGreaterThan(0);
    expect(report.ocr.splits).toBeNull();
    expect(report.ocr.splitShare).toBeNull();
    expect(report.ocr.suspected).toBe(false);
  });

  it("with a word list, the extractor's line-broken 'tar / geted' is not a stray-space split", () => {
    const judged = cleanFullText(raw, new Set(["targeted"])).report.ocr;
    expect(judged.words).toBe(report.ocr.words);
    expect(judged.splits).toBe(0);
    expect(judged.suspected).toBe(false);
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
// Corrected 2026-10-25 (owner, plan/00 §6 item 283(a); docs/06 §4.1 steps 2,
// 6 and 7): the failure shapes P3-T20 found on real papers, rebuilt here from
// synthetic text — nothing below is copied from a fixture
// ---------------------------------------------------------------------------

/**
 * One invented reference entry per line, each citing a year; `style` picks the
 * entry-number form (`[n]`, `n.` or a number fused to the author's initial).
 */
function entries(
  from: number,
  to: number,
  style: "bracket" | "dot" | "fused",
): string {
  const lines: string[] = [];
  for (let n = from; n <= to; n += 1) {
    const mark =
      style === "bracket" ? `[${n}] ` : style === "dot" ? `${n}. ` : `${n}`;
    lines.push(
      `${mark}Q. Example, R. Invented, J. Synth. Widgets ${10 + n}, ${100 + n}–${110 + n} (${1960 + n}).`,
    );
  }
  return lines.join("\n");
}

describe("stacked page furniture (docs/06 §4.1 step 2, corrected 2026-10-25)", () => {
  it("removes a copyright footer that sits above a '(n of N)' line on every page", () => {
    // The shape of W2's footer: two furniture lines, then blank lines before the separator.
    const bodies = ["alpha", "beta", "gamma", "delta"];
    const pages = bodies.map(
      (word, i) =>
        `The ${word} site was counted first.\nThe ${word} counts were stable.\n` +
        `Synth. J. 2023, 10, 2301999 © 2023 The Authors. Published by Example Press\n` +
        `2301999 (${i + 1} of 4)\n\n`,
    );
    const { text, report } = cleanFullText(pages.join("\n\n\n\f"));
    expect(text).not.toContain("© 2023 The Authors");
    expect(text).not.toMatch(/\(\d of 4\)/u);
    expect(report.runningHeads).toBe(2);
    expect(report.runningHeadLinesRemoved).toBe(8);
    for (const word of bodies) {
      expect(text).toContain(
        `The ${word} site was counted first.\nThe ${word} counts were stable.`,
      );
    }
    expect(count(text, "\n\n\n\f")).toBe(3);
  });

  it("peels five stacked lines a round at a time, and keeps the body lines they wrap", () => {
    // E2's shape: five furniture lines at each page's end, one with a page number.
    const bodies = ["alpha", "beta", "gamma"].map(
      (word) => `The ${word} site opened.\nThe ${word} site closed.`,
    );
    const pages = bodies.map(
      (body, i) =>
        `${body}\nzz\nOPEN WIDGETS\nWidgetScience 27, 110999, August ${i + 1}, 2024 ${2 * i + 2}\nWidgetScience\nArticle`,
    );
    const { pages: cleaned, heads, linesRemoved } = removeRunningHeads(pages);
    expect(cleaned).toEqual(bodies);
    expect(heads).toBe(5);
    expect(linesRemoved).toBe(15);
  });

  it("still keeps a line that repeats at the edge of only one page in three", () => {
    const pages = [
      "Shared footer\nbody a\nInner line",
      "body b\nShared footer 2\nend b",
      "body c\nmore c\nend c",
    ];
    expect(removeRunningHeads(pages).linesRemoved).toBe(0);
  });
});

describe("reference list widenings (docs/06 §4.1 step 6, corrected 2026-10-25)", () => {
  it("(1) takes a numbered heading, Arabic or Roman", () => {
    for (const heading of ["6. References", "6 References", "VI. REFERENCES"]) {
      const text = `${prose(3000)}\n${heading}\n${entries(1, 8, "bracket")}`;
      const result = truncateReferences(text);
      expect(result.cut, heading).toMatchObject({
        applied: true,
        basis: "heading",
      });
      expect(result.text).toBe(prose(3000));
    }
  });

  it("(1) still refuses a numbered line that is a sentence", () => {
    const text = `${prose(3000)}\n6. References to earlier work are in the text.\n${prose(500)}`;
    expect(truncateReferences(text).cut.applied).toBe(false);
  });

  it("(2) stops a tail cut at a methods heading that follows the list, and keeps the methods", () => {
    const methods = `Methods\nWidgets were counted by hand. ${prose(600)}`;
    const text = `${prose(4000)}\nReferences\n${entries(1, 10, "dot")}\n\n\n\f${methods}`;
    const result = truncateReferences(text);
    expect(result.cut).toMatchObject({
      applied: true,
      basis: "heading",
      bounded: true,
    });
    expect(result.text).toBe(`${prose(4000)}\n\n\n\f${methods}`);
  });

  it("(2)+(3) cuts a list before the last 45 % only up to the body heading after it", () => {
    // E2's shape: the list at about half the text, STAR★Methods after it.
    const methods = `STAR+METHODS\nKEY RESOURCES TABLE\n${prose(2600)}`;
    const text = `${prose(3000)}\nREFERENCES\n${entries(1, 12, "dot")}\n\n\n\f${methods}`;
    expect(text.indexOf("REFERENCES") / text.length).toBeLessThan(0.55);
    const result = truncateReferences(text);
    expect(result.cut).toMatchObject({
      applied: true,
      basis: "heading_before_body",
      bounded: true,
    });
    expect(result.text).toBe(`${prose(3000)}\n\n\n\f${methods}`);
  });

  it("(3) leaves a heading before the tail alone when the span before the body heading cites no years", () => {
    const text = `${prose(3000)}\nReferences\n${prose(800)}\nMethods\n${prose(2600)}`;
    expect(truncateReferences(text)).toEqual({
      text,
      cut: { applied: false, reason: "no_heading", removedShare: null },
    });
  });

  it("(3) leaves a heading before the tail alone when no body heading follows", () => {
    const text = `${prose(3000)}\nReferences\n${entries(1, 12, "dot")}\n${prose(2600)}`;
    expect(truncateReferences(text).cut.applied).toBe(false);
  });

  it("(4) cuts a short list under 8 % when every line after the heading cites a year", () => {
    // X1 and X2's shape: a long report with a handful of references.
    const text = `${prose(8000)}\nReferences\n${entries(1, 4, "bracket")}`;
    const result = truncateReferences(text);
    expect(result.cut.applied).toBe(true);
    expect(result.cut.removedShare ?? 1).toBeLessThan(0.08);
    expect(result.text).toBe(prose(8000));
  });

  it("(4) keeps a short tail under 8 % when one line cites no year, or there are under three lines", () => {
    const missing = `${prose(8000)}\nReferences\n${entries(1, 3, "bracket")}\n[4] Q. Example, in press.`;
    expect(truncateReferences(missing).cut).toMatchObject({
      applied: false,
      reason: "outside_band",
    });
    const two = `${prose(8000)}\nReferences\n${entries(1, 2, "bracket")}`;
    expect(truncateReferences(two).cut.applied).toBe(false);
  });

  it("(5) finds a list with no heading that starts at entry 1, in each number form", () => {
    for (const style of ["bracket", "dot", "fused"] as const) {
      // A4's fused form packs several entries per line, as the extractor did.
      const list = entries(1, 12, style).replace(
        /\n(?=(?:\[?)[2468]|1[02])/gu,
        " ",
      );
      const text = `${prose(3000)}\n${list}`;
      expect(findNumberedReferenceList(text), style).toBe(
        prose(3000).length + 1,
      );
      const result = truncateReferences(text);
      expect(result.cut, style).toMatchObject({
        applied: true,
        basis: "numbered_list",
      });
      expect(result.text).toBe(prose(3000));
    }
  });

  it("(5) does not take a numbered list whose lines cite no years", () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8]
      .map((n) => `${n}. The widget count rose at site ${n}.`)
      .join("\n");
    const text = `${prose(3000)}\n${list}`;
    expect(findNumberedReferenceList(text)).toBeNull();
    expect(truncateReferences(text).cut.applied).toBe(false);
  });

  it("(5) does not take numbered lines with years whose numbers do not rise", () => {
    const list = [1, 1, 1, 1, 1, 1, 1, 1]
      .map(
        (n) =>
          `${n}. In ${1990 + n} the count was taken again, Q. Example said.`,
      )
      .join("\n");
    const text = `${prose(3000)}\n${list}`;
    expect(findNumberedReferenceList(text)).toBeNull();
  });

  it("(5) does not take a list of fewer than five rises, even with years", () => {
    const text = `${prose(3000)}\n${entries(1, 5, "bracket")}`;
    expect(findNumberedReferenceList(text)).toBeNull();
    expect(
      findNumberedReferenceList(`${prose(3000)}\n${entries(1, 6, "bracket")}`),
    ).toBe(prose(3000).length + 1);
  });

  it("(5) needs entry 1 itself to cite a year, so a numbered sentence before a list is not taken", () => {
    const text = `${prose(3000)}\n1. Counts rose at every site.\n${entries(2, 12, "dot")}`;
    expect(findNumberedReferenceList(text)).toBeNull();
  });

  it("(5) needs most lines of the list to cite a year, not just entry 1", () => {
    const list = [2, 3, 4, 5, 6, 7, 8]
      .map((n) => `${n}. The count rose at site ${n}.`)
      .join("\n");
    const text = `${prose(3000)}\n1. In 1990 the count began, Q. Example said.\n${list}`;
    expect(findNumberedReferenceList(text)).toBeNull();
  });

  it("(5) does not look before the last 45 %", () => {
    const text = `${prose(500)}\n${entries(1, 12, "bracket")}\n${prose(3000)}`;
    expect(findNumberedReferenceList(text)).toBeNull();
  });
});

describe("supplementary cut bounded by a body heading (docs/06 §4.1 step 7, corrected 2026-10-25)", () => {
  it("stops at a methods heading after the supplementary heading and keeps the methods", () => {
    const methods = `STAR★Methods\n${prose(800)}`;
    const text = `${prose(2000)}\nSupplemental Information\nTable S1 lists everything.\nAcknowledgments\nThanks.\n\n\n\f${methods}`;
    const result = dropSupplementary(text);
    expect(result.text).toBe(`${prose(2000)}\n\n\n\f${methods}`);
  });
});

// ---------------------------------------------------------------------------
// The OCR probe: the stray-space split share (docs/06 §4.1 step 8, decided
// 2026-10-25, owner, plan/00 §6 item 285(b))
// ---------------------------------------------------------------------------

/** A synthetic word list; every test that judges uses it or names its own. */
const WORDS: ReadonlySet<string> = new Set([
  "a",
  "asleep",
  "basic",
  "experiment",
  "mechanism",
  "sleep",
  "the",
  "there",
  "widget",
]);

/** `n` words on one line, `k` of them pairs split as "bas ic", the rest "widget". */
function splitText(n: number, k: number): string {
  return [
    ...Array.from({ length: k }, () => "bas ic"),
    ...Array.from({ length: n - 2 * k }, () => "widget"),
  ].join(" ");
}

describe("probeStraySpaceSplits (docs/06 §4.1 step 8, item 285(b))", () => {
  it("keeps the decided threshold and minimum: above 1 %, at least 250 words", () => {
    expect(OCR_SPLIT_MAX_SHARE).toBe(0.01);
    expect(OCR_SPLIT_MIN_WORDS).toBe(250);
  });

  it("counts a word broken by a space on one line, as the measurement did", () => {
    const probe = probeStraySpaceSplits(
      "widget bas ic widget mechani sm",
      WORDS,
    );
    expect(probe.words).toBe(6);
    expect(probe.splits).toBe(2);
    expect(probe.splitShare).toBeCloseTo(2 / 6, 12);
    // A tab is a space; a first half at a sentence start may be capitalised.
    expect(probeStraySpaceSplits("bas\tic", WORDS).splits).toBe(1);
    expect(probeStraySpaceSplits("Bas ic", WORDS).splits).toBe(1);
  });

  it("counts a split when only one half is not a word ('the re')", () => {
    expect(probeStraySpaceSplits("the re", WORDS).splits).toBe(1);
  });

  it("never counts across a line or page break: the extractor's hyphen break", () => {
    for (const text of [
      "experi\nment",
      "experi-\nment",
      "experi\fment",
      "bas\nic",
      "bas\n\nic",
    ]) {
      expect(probeStraySpaceSplits(text, WORDS).splits, text).toBe(0);
    }
    // A hyphen left on the same line is punctuation on the first half.
    expect(probeStraySpaceSplits("experi- ment", WORDS).splits).toBe(0);
  });

  it("does not count two real words, such as a one-letter word before another", () => {
    // Both halves are words and so is the join ("asleep").
    expect(probeStraySpaceSplits("a sleep", WORDS).splits).toBe(0);
    expect(probeStraySpaceSplits("widget a widget", WORDS)).toMatchObject({
      words: 3,
      splits: 0,
    });
  });

  it("is broken by punctuation, numbers and units: 'et al .', '5 mg', 'bas, ic'", () => {
    expect(probeStraySpaceSplits("et al . the", WORDS)).toMatchObject({
      words: 3,
      splits: 0,
    });
    expect(probeStraySpaceSplits("bas . ic", WORDS).splits).toBe(0);
    expect(probeStraySpaceSplits("dose of 5 mg", WORDS)).toMatchObject({
      words: 3,
      splits: 0,
    });
    expect(probeStraySpaceSplits("bas 5 ic", WORDS).splits).toBe(0);
    expect(probeStraySpaceSplits("bas, ic", WORDS).splits).toBe(0);
    // Only the first half's end matters: "(bas" has punctuation removed too.
    expect(probeStraySpaceSplits("(bas ic", WORDS).splits).toBe(0);
    expect(probeStraySpaceSplits("bas ic.", WORDS).splits).toBe(1);
  });

  it("needs the second half to start lower-case and both to be letters", () => {
    expect(probeStraySpaceSplits("bas Ic", WORDS).splits).toBe(0);
    expect(probeStraySpaceSplits("bas ic2", WORDS).splits).toBe(0);
  });

  it("warns above 1 %, not at it", () => {
    const at = probeStraySpaceSplits(splitText(300, 3), WORDS);
    expect(at.words).toBe(300);
    expect(at.splitShare).toBeCloseTo(0.01, 12);
    expect(at.suspected).toBe(false);
    expect(probeStraySpaceSplits(splitText(300, 4), WORDS).suspected).toBe(
      true,
    );
  });

  it("never warns on fewer than 250 words, however garbled", () => {
    const short = probeStraySpaceSplits(splitText(249, 100), WORDS);
    expect(short.words).toBe(249);
    expect(short.splitShare).toBeGreaterThan(0.4);
    expect(short.suspected).toBe(false);
    expect(probeStraySpaceSplits(splitText(250, 3), WORDS).suspected).toBe(
      true,
    );
  });

  it("judges nothing without a word list", () => {
    const probe = probeStraySpaceSplits(splitText(300, 100), null);
    expect(probe).toEqual({
      words: 300,
      splits: null,
      splitShare: null,
      suspected: false,
    });
  });

  it("an empty text has no words and no share", () => {
    expect(probeStraySpaceSplits("", WORDS)).toEqual({
      words: 0,
      splits: 0,
      splitShare: 0,
      suspected: false,
    });
  });
});

describe("expandHunspellWordList (item 285(b): the measurement's expansion)", () => {
  const aff = [
    "SET ISO8859-1",
    "PFX U Y 1",
    "PFX U   0     un         .",
    "PFX R N 1",
    "PFX R   0     re         .",
    "SFX S Y 2",
    "SFX S   y     ies        [^aeiou]y",
    "SFX S   0     s          [^y]",
    "SFX D N 1",
    "SFX D   0     ed/X       .",
    "",
  ].join("\n");
  const dic = ["4", "Study/SU", "tie/SR", "walk/D", "plain", ""].join("\r\n");
  const list = expandHunspellWordList(aff, dic);

  it("adds each stem, its suffix forms (strip and condition honoured) and prefix forms, lower-cased", () => {
    expect([...list].sort()).toEqual([
      "plain",
      "retie",
      "studies",
      "study",
      "tie",
      "ties",
      "unstudies",
      "unstudy",
      "walk",
      "walked",
    ]);
  });

  it("crosses a prefix with the suffix forms only when its class says Y", () => {
    expect(list.has("unstudies")).toBe(true);
    expect(list.has("reties")).toBe(false);
  });

  it("skips the entry-count line and ignores a suffix's own continuation flags", () => {
    expect(list.has("4")).toBe(false);
    expect(list.has("walked/x")).toBe(false);
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

/** The port's dictionary reader: files, a missing list, or a failed read. */
type DictionaryReader = () => Promise<HunspellFiles | null>;

function portWithText(
  text: string | null,
  readEnglishDictionary?: DictionaryReader,
): FullTextPort<Item, AcquirableAttachment> {
  return {
    ...(readEnglishDictionary !== undefined && { readEnglishDictionary }),
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

/** A two-word dictionary, as the port hands it over. */
const DICTIONARY: HunspellFiles = {
  aff: "SET ISO8859-1\n",
  dic: "2\nbasic\nwidgets\n",
};

/** 300 words on 30 lines, one stray-space split per line: 10 %. */
const GARBLED = "The bas ic widgets were counted at three invented sites.\n"
  .repeat(30)
  .trimEnd();

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
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens },
      portWithText(GARBLED, () => Promise.resolve(DICTIONARY)),
    );
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.text).toBe(`${ABSTRACT}\n\n${GARBLED}`);
    expect(source.warnings).toEqual(["ocr_suspected"]);
  });

  it("clean prose draws no ocr_suspected", async () => {
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens },
      portWithText(prose(3000), () => Promise.resolve(DICTIONARY)),
    );
    expect(source.warnings).not.toContain("ocr_suspected");
  });

  it("with no dictionary, or a failed read, the probe judges nothing and Tier 2 stands", async () => {
    for (const reader of [
      undefined,
      () => Promise.resolve(null),
      () => Promise.reject(new Error("resource missing")),
    ]) {
      const source = await acquireSource(
        item(ABSTRACT),
        { estimateTokens },
        portWithText(GARBLED, reader),
      );
      expect(source.tier).toBe("fulltext_pdf");
      expect(source.warnings).toEqual([]);
    }
  });

  it("reads and expands the dictionary once per port", async () => {
    let reads = 0;
    const port = portWithText(GARBLED, () => {
      reads += 1;
      return Promise.resolve(DICTIONARY);
    });
    const first = await acquireSource(item(ABSTRACT), { estimateTokens }, port);
    const second = await acquireSource(
      item(ABSTRACT),
      { estimateTokens },
      port,
    );
    expect(reads).toBe(1);
    expect(first.warnings).toEqual(["ocr_suspected"]);
    expect(second.warnings).toEqual(["ocr_suspected"]);
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
