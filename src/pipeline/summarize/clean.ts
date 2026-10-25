/**
 * The Tier 2 cleaning pass and the OCR quality probe — `docs/06` §4.1
 * (`P3-T19` steps 3 and 4).
 *
 * Runs on the raw `attachmentText` / `getFullText` output, **before** the
 * abstract preamble is prepended, and never on Tier 3: Europe PMC's JATS
 * arrives structurally clean (`./jats.ts`). Pure: no platform call, no
 * preference read, no network.
 *
 * ## The steps, in §4.1's order
 *
 * 1. **Page split** on `\f`. The separator is matched as `\n*\f` and kept
 *    **verbatim**, so the page delimiter survives the pass for the chunker and
 *    the section detector, and a text with no page furniture leaves this pass
 *    byte-identical. Steps 2–5 work on the page bodies between separators.
 * 2. **Running heads and feet.** The first and last non-empty line of every
 *    page are candidates; a candidate whose digit-stripped form is the first or
 *    last line on at least 60 % of the pages that have text — and on at least
 *    two pages, so a one-page text never loses its first line — is a running
 *    head or foot, and every line with that digit-stripped form is deleted. A
 *    bare page number strips to the empty string; those lines are deleted only
 *    where they are a page's first or last line, never mid-page, where a
 *    digit-only line is far more often a table cell. **Rounds** (corrected
 *    2026-10-25, owner, `plan/00` §6 item 283(a)): the collect-and-delete is
 *    repeated until a round deletes nothing, because publishers stack page
 *    furniture (a copyright footer above a "(3 of 9)" line) and one round only
 *    ever sees the outermost line.
 * 3. **Line-number gutters.** On a page where at least 50 % of the non-empty
 *    lines match `/^\s*\d{1,3}\s+/`, that leading number is stripped from each
 *    matching line.
 * 4. **De-hyphenation: nothing.** Decided 2026-10-21 (owner, `plan/00` §6 item
 *    258; `docs/06` §4.1 step 4): the extractor emits a hyphenated break as
 *    `word\nword` and the old `/(\w)-[ \t]+(\w)/` rule corrupts every
 *    suspended hyphen (`"N- and C-terminal"`), so no de-hyphenation regex
 *    ships until a contiguous-occurrence test is measured on `P3-T20`'s
 *    corpus. This module therefore has no step-4 code at all.
 * 5. **Collapse**, inside each page body: runs of three or more `\n` to
 *    `\n\n`, runs of spaces to one. **`\n` is not a paragraph boundary**
 *    (corrected D-06-4) and no step here treats it as one: steps 2 and 3 work
 *    on lines, and nothing joins, splits or re-wraps paragraphs.
 * 6. **Reference list.** The last line that is exactly a §4.1 reference
 *    heading and starts in the last 45 % of the text marks the cut; everything
 *    from it to the end is deleted **only if** that removes between 8 % and
 *    60 % of the characters. Outside the band the text is kept whole and the
 *    report says why. Corrected 2026-10-25 (owner, `plan/00` §6 item 283(a);
 *    `docs/06` §4.1 step 6, five widenings, each a shape and never a paper):
 *    the heading may carry a section number; the cut stops at a whole-line
 *    methods or appendix heading that follows it ({@link BODY_RESUMES_HEADING});
 *    a heading before the tail is cut only in that bounded form and only over a
 *    span whose lines mostly cite a year; the 8 % floor yields when every line
 *    after the heading cites a year; and with no heading at all, a numbered
 *    list in the tail that starts at entry 1 is the cut
 *    ({@link findNumberedReferenceList}).
 * 7. **Supplementary material.** The first line in the last 45 % of the text
 *    that is, on its own, a §4.1 supplementary heading marks a second cut to
 *    the end. §4.1's pattern is not anchored at the line's end; it is here,
 *    so that a sentence such as "Supplementary figures S1–S3 show…" never
 *    deletes the rest of the paper.
 * 8. **OCR probe** — {@link probeStraySpaceSplits}, on the cleaned body. It
 *    warns (`ocr_suspected`) and never demotes (owner, 2026-10-21, item 258).
 *    Decided 2026-10-25 (owner, `plan/00` §6 item 285(b)): the probe is the
 *    stray-space split share item 283(b) measured — words broken by a space
 *    on the same line ("bas ic"), judged against Zotero's en-US word list
 *    (`./wordList.ts`), which the caller supplies; the old character-share
 *    probe and its three thresholds are gone.
 */

import type { WordList } from "./wordList";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The warning §4.1 step 8 names. */
export const OCR_SUSPECTED_WARNING = "ocr_suspected";

/** §4.1 step 2: a running head appears on at least this share of pages. */
export const RUNNING_HEAD_MIN_PAGE_SHARE = 0.6;

/** Not in §4.1: a running head must also appear on at least this many pages. */
export const RUNNING_HEAD_MIN_PAGES = 2;

/** §4.1 step 3: a page is guttered when this share of its lines is numbered. */
export const GUTTER_MIN_LINE_SHARE = 0.5;

/** §4.1 step 3's line-number pattern. */
const GUTTER_NUMBER = /^\s*\d{1,3}\s+/u;

/** §4.1 step 6: the heading must start in the last 45 % of the text. */
export const TAIL_REGION_SHARE = 0.45;

/** §4.1 step 6's sanity band on the share of characters removed. */
export const REFERENCE_CUT_MIN_SHARE = 0.08;
export const REFERENCE_CUT_MAX_SHARE = 0.6;

/**
 * §4.1 step 6's heading, `/^\s*(references|bibliography|literature cited|참고\s*문헌)\s*$/im`,
 * with `\s` narrowed to spaces and tabs so a match never spans lines, and a
 * page's first line (straight after `\f`, where `^` does not match) accepted.
 * Corrected 2026-10-25 (item 283(a)): an Arabic (`6.`, `6`) or Roman (`VI.`)
 * section number may precede the word.
 */
const REFERENCE_HEADING =
  /(^|\f)[ \t]*(?:(?:\d{1,2}\.?|[IVXL]{1,6}\.)[ \t]*)?(?:references|bibliography|literature cited|참고[ \t]*문헌)[ \t]*$/gimu;

/**
 * Step 6, corrected 2026-10-25 (item 283(a)): a whole-line heading after which
 * the body resumes, so a reference cut stops there instead of running to the
 * end — methods that a publisher prints after the list (Cell Press's
 * `STAR★Methods`, which the extractor writes as `STAR+METHODS`; Nature's
 * `Online Methods`). An optional section number and a trailing colon are
 * allowed, as in step 7. Appendices are deliberately not here: an appendix
 * after the list went with the cut before 2026-10-25 and still does.
 */
export const BODY_RESUMES_HEADING =
  /(^|\f)[ \t]*(?:(?:\d{1,2}\.?|[IVXL]{1,6}\.)[ \t]*)?(?:star\W{0,3}methods|(?:online[ \t]+)?methods|materials?[ \t]+and[ \t]+methods|methods[ \t]+and[ \t]+materials|experimental(?:[ \t]+(?:section|procedures))?)[ \t]*:?[ \t]*$/gimu;

/** A year 1800–2099 standing alone (a citation's year). */
const CITATION_YEAR = /(?<!\d)(?:1[89]|20)\d{2}(?!\d)/u;

/**
 * Step 6, corrected 2026-10-25 (item 283(a)): below the 8 % floor the cut
 * still applies when at least this many non-empty lines follow the heading and
 * every one of them cites a year.
 */
export const SHORT_LIST_MIN_LINES = 3;

/**
 * Step 6, corrected 2026-10-25 (item 283(a)): a bounded cut before the tail,
 * and a list with no heading, need at least this share of their non-empty
 * lines (and at least {@link SHORT_LIST_MIN_LINES} of them) to cite a year.
 */
export const REFERENCE_YEAR_LINE_SHARE = 2 / 3;

/** A line that starts with entry 1 of a numbered list: `[1]`, `(1)`, `1. A…`, `1E. J. Heller`. */
const FIRST_ENTRY = /^[ \t]*(?:\[1\]|\(1\)|1\.(?=[ \t]+\p{Lu})|1(?=\p{Lu}\.))/u;

/** Entry numbers at a line's start or after a full stop, in the same four forms. */
const ENTRY_NUMBER =
  /(?:^|(?<=\f)|(?<=[.)\]][ \t]))[ \t]*(?:\[(\d{1,3})\]|\((\d{1,3})\)|(\d{1,3})\.(?=[ \t]+\p{Lu})|(\d{1,3})(?=\p{Lu}\.))/gmu;

/** A headingless list needs its entry numbers to rise at least this often… */
export const NUMBERED_LIST_MIN_RISES = 5;
/** …in at least this share of consecutive pairs. */
export const NUMBERED_LIST_MIN_RISE_SHARE = 0.8;

/**
 * §4.1 step 7's heading, anchored at the line's end (module note, step 7). An
 * optional section number and a trailing colon are allowed.
 */
const SUPPLEMENTARY_HEADING =
  /(^|\f)[ \t]*(?:\d+\.?[ \t]*)?(?:supplement(?:ary|al)?(?: (?:material|information|data|figures?|tables?))?|supporting information)[ \t]*:?[ \t]*$/gimu;

/**
 * §4.1 step 8 (decided 2026-10-25, owner, `plan/00` §6 item 285(b)): a
 * stray-space split share **above** this warns `ocr_suspected`. Measured on
 * `P3-T20`'s 40 texts: X1, the one garbled OCR layer, 5.00 %; every other
 * paper at most 0.05 %. 1 % is 5× below X1 and 20× above the worst clean
 * paper (`docs/06` §4.1 step 8 gives the reasoning).
 */
export const OCR_SPLIT_MAX_SHARE = 0.01;

/**
 * §4.1 step 8 (decided 2026-10-25, item 285(b)): a body with fewer words than
 * this is measured but never warned on. Below 100 words one coincidental split
 * already exceeds 1 %; at 250, three are needed, which a clean text reaches
 * about 4 times in 10,000 at the worst clean rate measured.
 */
export const OCR_SPLIT_MIN_WORDS = 250;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** {@link probeStraySpaceSplits}'s measurement. Numbers only, never text. */
export interface OcrProbe {
  /** Words in the probed text: tokens that are letters only, once stripped. */
  readonly words: number;
  /** Same-line stray-space splits; `null` when no word list was available. */
  readonly splits: number | null;
  /** `splits / words` (`0` with no words); `null` without a word list. */
  readonly splitShare: number | null;
  /**
   * `splitShare` is above {@link OCR_SPLIT_MAX_SHARE} and `words` is at least
   * {@link OCR_SPLIT_MIN_WORDS}. Warns only; nothing demotes on it.
   */
  readonly suspected: boolean;
}

/**
 * Which form of step 6 found the list (corrected 2026-10-25, item 283(a)):
 * the original rule's heading in the tail, a heading before the tail bounded
 * by a body heading, or a numbered list with no heading.
 */
export type ReferenceCutBasis =
  "heading" | "heading_before_body" | "numbered_list";

/** Step 6's outcome. */
export type ReferenceCut =
  | {
      readonly applied: true;
      readonly removedShare: number;
      readonly basis: ReferenceCutBasis;
      /** The cut stopped at a {@link BODY_RESUMES_HEADING}; the rest is kept. */
      readonly bounded: boolean;
    }
  | {
      readonly applied: false;
      readonly reason: "no_heading" | "outside_band";
      /** The share the cut would have removed; `null` with no heading. */
      readonly removedShare: number | null;
    };

/** What the pass did, for logging and for `P3-T20`'s measurements. */
export interface CleanReport {
  readonly pages: number;
  /** Distinct running heads and feet found (step 2). */
  readonly runningHeads: number;
  /** Lines step 2 deleted. */
  readonly runningHeadLinesRemoved: number;
  /** Pages whose line-number gutter step 3 stripped. */
  readonly gutterPages: number;
  readonly references: ReferenceCut;
  /** Characters step 7 removed; `0` when no heading was found. */
  readonly supplementaryCharsRemoved: number;
  readonly ocr: OcrProbe;
}

/** {@link cleanFullText}'s result. */
export interface CleanedText {
  readonly text: string;
  readonly report: CleanReport;
}

// ---------------------------------------------------------------------------
// Step 1 — pages
// ---------------------------------------------------------------------------

/** Page bodies and the separators between them, verbatim. */
export interface SplitPages {
  readonly pages: string[];
  /** `separators[i]` sits between `pages[i]` and `pages[i + 1]`. */
  readonly separators: string[];
}

/** Step 1: split on `\n*\f`, keeping each separator exactly as it was. */
export function splitPages(text: string): SplitPages {
  const parts = text.split(/(\n*\f)/u);
  const pages: string[] = [];
  const separators: string[] = [];
  parts.forEach((part, index) => {
    if (index % 2 === 0) pages.push(part);
    else separators.push(part);
  });
  return { pages, separators };
}

/** Put {@link splitPages}' output back together. */
export function joinPages(split: SplitPages): string {
  let out = split.pages[0] ?? "";
  for (let i = 1; i < split.pages.length; i += 1) {
    out += (split.separators[i - 1] ?? "") + (split.pages[i] ?? "");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 2 — running heads and feet
// ---------------------------------------------------------------------------

/** The form two running-head lines are compared in: digits stripped. */
export function runningHeadKey(line: string): string {
  return line.replace(/\d/gu, "").replace(/\s+/gu, " ").trim();
}

function edgeLineIndexes(lines: readonly string[]): number[] {
  let first = -1;
  let last = -1;
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    if (first === -1) first = index;
    last = index;
  });
  if (first === -1) return [];
  return first === last ? [first] : [first, last];
}

/**
 * Step 2, in rounds until a round deletes nothing (corrected 2026-10-25,
 * item 283(a)). Returns the new pages and what was removed in all rounds.
 */
export function removeRunningHeads(pages: readonly string[]): {
  readonly pages: string[];
  readonly heads: number;
  readonly linesRemoved: number;
} {
  // The share is always of the pages that had text before the first round, so
  // a page a round empties does not lower the bar for the next one.
  const pagesWithText = pages.filter((page) => page.trim() !== "").length;
  let current = [...pages];
  let heads = 0;
  let linesRemoved = 0;
  for (;;) {
    const round = removeRunningHeadsOnce(current, pagesWithText);
    if (round.linesRemoved === 0) break;
    current = round.pages;
    heads += round.heads;
    linesRemoved += round.linesRemoved;
  }
  return { pages: current, heads, linesRemoved };
}

/** One round of step 2. */
function removeRunningHeadsOnce(
  pages: readonly string[],
  pagesWithText: number,
): {
  readonly pages: string[];
  readonly heads: number;
  readonly linesRemoved: number;
} {
  const pageLines = pages.map((page) => page.split("\n"));
  const pageCount = new Map<string, number>();
  for (const lines of pageLines) {
    const keys = new Set(
      edgeLineIndexes(lines).map((i) => runningHeadKey(lines[i] ?? "")),
    );
    for (const key of keys) pageCount.set(key, (pageCount.get(key) ?? 0) + 1);
  }
  const heads = new Set<string>();
  for (const [key, count] of pageCount) {
    if (
      pagesWithText > 0 &&
      count >= RUNNING_HEAD_MIN_PAGES &&
      count / pagesWithText >= RUNNING_HEAD_MIN_PAGE_SHARE
    ) {
      heads.add(key);
    }
  }
  if (heads.size === 0) {
    return { pages: [...pages], heads: 0, linesRemoved: 0 };
  }
  let linesRemoved = 0;
  const cleaned = pageLines.map((lines) => {
    const edges = new Set(edgeLineIndexes(lines));
    const kept = lines.filter((line, index) => {
      if (line.trim() === "") return true;
      const key = runningHeadKey(line);
      if (!heads.has(key)) return true;
      // A bare page number only goes where it is a page's first or last line.
      if (key === "" && !edges.has(index)) return true;
      linesRemoved += 1;
      return false;
    });
    return kept.join("\n");
  });
  return { pages: cleaned, heads: heads.size, linesRemoved };
}

// ---------------------------------------------------------------------------
// Step 3 — line-number gutters
// ---------------------------------------------------------------------------

/** Step 3 on one page. */
export function stripLineNumberGutter(page: string): {
  readonly page: string;
  readonly stripped: boolean;
} {
  const lines = page.split("\n");
  const nonEmpty = lines.filter((line) => line.trim() !== "");
  if (nonEmpty.length === 0) return { page, stripped: false };
  const numbered = nonEmpty.filter((line) => GUTTER_NUMBER.test(line)).length;
  if (numbered / nonEmpty.length < GUTTER_MIN_LINE_SHARE) {
    return { page, stripped: false };
  }
  return {
    page: lines.map((line) => line.replace(GUTTER_NUMBER, "")).join("\n"),
    stripped: true,
  };
}

// ---------------------------------------------------------------------------
// Step 5 — whitespace
// ---------------------------------------------------------------------------

/** Step 5 on one page body. */
export function collapsePageWhitespace(page: string): string {
  return page.replace(/\n{3,}/gu, "\n\n").replace(/ {2,}/gu, " ");
}

// ---------------------------------------------------------------------------
// Steps 6 and 7 — cuts to the end
// ---------------------------------------------------------------------------

/** Start of the heading line a match found (after the `\f`, if any). */
function headingStart(match: RegExpMatchArray): number {
  return (match.index ?? 0) + (match[1] ?? "").length;
}

/** Where the line starting at `at` ends: its `\n` or `\f`, or the text's end. */
function lineEnd(text: string, at: number): number {
  for (let i = at; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\n" || ch === "\f") return i;
  }
  return text.length;
}

/** The non-empty lines of a span; `\f` ends a line as `\n` does. */
function nonEmptyLines(span: string): string[] {
  return span.split(/[\n\f]/u).filter((line) => line.trim() !== "");
}

/** The share of `lines` citing a year; 0 below {@link SHORT_LIST_MIN_LINES} lines. */
function yearLineShare(lines: readonly string[]): number {
  if (lines.length < SHORT_LIST_MIN_LINES) return 0;
  return lines.filter((line) => CITATION_YEAR.test(line)).length / lines.length;
}

/**
 * Step 6: the start of the first {@link BODY_RESUMES_HEADING} after the line
 * at `after`, or `null` when the body does not resume.
 */
function bodyResumesAt(text: string, after: number): number | null {
  const from = lineEnd(text, after);
  for (const match of text.matchAll(BODY_RESUMES_HEADING)) {
    const at = headingStart(match);
    if (at > from) return at;
  }
  return null;
}

/**
 * Step 6 with no heading (corrected 2026-10-25, item 283(a)): the start of
 * the last line in the last 45 % that begins with entry 1 of a numbered list
 * and cites a year, accepted only when, from there to the end (or to a
 * {@link BODY_RESUMES_HEADING}), at least {@link REFERENCE_YEAR_LINE_SHARE}
 * of the non-empty lines cite a year and the entry numbers rise at least
 * {@link NUMBERED_LIST_MIN_RISES} times, in at least
 * {@link NUMBERED_LIST_MIN_RISE_SHARE} of consecutive pairs. `null` when no
 * line qualifies.
 */
export function findNumberedReferenceList(text: string): number | null {
  const tailStart = text.length * (1 - TAIL_REGION_SHARE);
  const candidates: number[] = [];
  let offset = 0;
  for (const piece of text.split(/(?<=[\n\f])/u)) {
    if (
      offset >= tailStart &&
      FIRST_ENTRY.test(piece) &&
      CITATION_YEAR.test(piece)
    ) {
      candidates.push(offset);
    }
    offset += piece.length;
  }
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const start = candidates[i] ?? 0;
    const block = text.slice(start, bodyResumesAt(text, start) ?? text.length);
    if (yearLineShare(nonEmptyLines(block)) < REFERENCE_YEAR_LINE_SHARE) {
      continue;
    }
    const numbers = [...block.matchAll(ENTRY_NUMBER)].map((m) =>
      Number(m[1] ?? m[2] ?? m[3] ?? m[4]),
    );
    let rises = 0;
    for (let j = 1; j < numbers.length; j += 1) {
      if ((numbers[j] ?? 0) > (numbers[j - 1] ?? 0)) rises += 1;
    }
    if (
      rises >= NUMBERED_LIST_MIN_RISES &&
      rises / (numbers.length - 1) >= NUMBERED_LIST_MIN_RISE_SHARE
    ) {
      return start;
    }
  }
  return null;
}

/**
 * Step 6's band, then the cut. The span `[start, end)` goes; when `end` is a
 * body heading the whitespace before it (a page separator, say) is kept with
 * it. `entriesFrom` is where the list's entries begin (after the heading line,
 * or at `start` for a list with no heading): below the 8 % floor the cut
 * applies only when at least {@link SHORT_LIST_MIN_LINES} non-empty lines from
 * there all cite a year.
 */
function cutSpan(
  text: string,
  start: number,
  end: number,
  entriesFrom: number,
  basis: ReferenceCutBasis,
): { readonly text: string; readonly cut: ReferenceCut } {
  const removedShare = (end - start) / text.length;
  const entries = nonEmptyLines(text.slice(entriesFrom, end));
  const shortList =
    entries.length >= SHORT_LIST_MIN_LINES &&
    entries.every((line) => CITATION_YEAR.test(line));
  if (
    removedShare > REFERENCE_CUT_MAX_SHARE ||
    (removedShare < REFERENCE_CUT_MIN_SHARE && !shortList)
  ) {
    return {
      text,
      cut: { applied: false, reason: "outside_band", removedShare },
    };
  }
  return {
    text: removeSpan(text, start, end),
    cut: { applied: true, removedShare, basis, bounded: end < text.length },
  };
}

/**
 * Delete `[start, end)`: to the end, the text before is trimmed at its end;
 * up to a body heading, the whitespace just before that heading (a page
 * separator, say) stays with it.
 */
function removeSpan(text: string, start: number, end: number): string {
  const kept = text.slice(0, start).trimEnd();
  if (end >= text.length) return kept;
  let gap = end;
  while (gap > start && /\s/u.test(text[gap - 1] ?? "")) gap -= 1;
  return kept + text.slice(gap);
}

/** Step 6 (`docs/06` §4.1, corrected 2026-10-25 — module note). */
export function truncateReferences(text: string): {
  readonly text: string;
  readonly cut: ReferenceCut;
} {
  const tailStart = text.length * (1 - TAIL_REGION_SHARE);
  const headings = [...text.matchAll(REFERENCE_HEADING)].map(headingStart);
  const inTail = headings.filter((at) => at >= tailStart);
  const last = inTail[inTail.length - 1];
  if (last !== undefined) {
    return cutSpan(
      text,
      last,
      bodyResumesAt(text, last) ?? text.length,
      lineEnd(text, last),
      "heading",
    );
  }
  // A heading before the tail: only bounded by a body heading, and only over
  // a span whose lines mostly cite a year.
  for (let i = headings.length - 1; i >= 0; i -= 1) {
    const at = headings[i] ?? 0;
    const end = bodyResumesAt(text, at);
    if (end === null) continue;
    const entries = nonEmptyLines(text.slice(lineEnd(text, at), end));
    if (yearLineShare(entries) < REFERENCE_YEAR_LINE_SHARE) continue;
    return cutSpan(text, at, end, lineEnd(text, at), "heading_before_body");
  }
  const listStart = findNumberedReferenceList(text);
  if (listStart !== null) {
    return cutSpan(
      text,
      listStart,
      bodyResumesAt(text, listStart) ?? text.length,
      listStart,
      "numbered_list",
    );
  }
  return {
    text,
    cut: { applied: false, reason: "no_heading", removedShare: null },
  };
}

/**
 * Step 7. Corrected 2026-10-25 (item 283(a)): like step 6, the cut stops at a
 * {@link BODY_RESUMES_HEADING} after the heading and keeps the rest — once
 * step 6 has taken a list out from before Cell Press's STAR★Methods, the
 * `SUPPLEMENTAL INFORMATION` line before that list lands in the tail and would
 * otherwise take the Methods with it.
 */
export function dropSupplementary(text: string): {
  readonly text: string;
  readonly removed: number;
} {
  const tailStart = text.length * (1 - TAIL_REGION_SHARE);
  for (const match of text.matchAll(SUPPLEMENTARY_HEADING)) {
    const at = headingStart(match);
    if (at < tailStart) continue;
    const kept = removeSpan(text, at, bodyResumesAt(text, at) ?? text.length);
    return { text: kept, removed: text.length - kept.length };
  }
  return { text, removed: 0 };
}

// ---------------------------------------------------------------------------
// Step 8 — the OCR probe
// ---------------------------------------------------------------------------

/** Leading and trailing characters that are neither letters nor digits. */
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const LETTERS_ONLY = /^\p{L}+$/u;
const LOWER_CASE_WORD = /^\p{Ll}+$/u;
const STARTS_LOWER_CASE = /^\p{Ll}/u;

/**
 * §4.1 step 8 as decided 2026-10-25 (owner, `plan/00` §6 item 285(b)): the
 * stray-space split share, exactly as item 283(b) measured it.
 *
 * - A **line** is a run between `\n` or `\f`; a **token** a run between spaces
 *   or tabs on a line; a **word** a token that is letters only once its
 *   leading and trailing non-letter, non-digit characters are removed.
 * - A **split** is two consecutive words on the **same line** where the
 *   first had nothing removed and, lower-cased, is all lower-case letters (a
 *   caseless script never pairs), the second starts lower-case, and the two lower-cased and joined are in `wordList`
 *   while at least one of them is not ("bas ic", "mechani sm"). A non-word
 *   token between two words breaks the pair; a line break always does, so
 *   the extractor's `word\nword` hyphen breaks (step 4) never count.
 *
 * @param text - the cleaned Tier 2 body, without the abstract preamble
 * @param wordList - lower-cased word forms (`./wordList.ts`); `null` when the
 *   platform could not supply one, and then nothing is judged
 */
export function probeStraySpaceSplits(
  text: string,
  wordList: WordList | null,
): OcrProbe {
  let words = 0;
  let splits = 0;
  for (const line of text.split(/[\n\f]/u)) {
    let previous: string | null = null;
    for (const token of line.split(/[ \t]+/u)) {
      if (token === "") continue;
      const word = token.replace(EDGE_PUNCTUATION, "");
      if (!LETTERS_ONLY.test(word)) {
        previous = null;
        continue;
      }
      words += 1;
      const lower = word.toLowerCase();
      if (
        wordList !== null &&
        previous !== null &&
        STARTS_LOWER_CASE.test(word) &&
        LOWER_CASE_WORD.test(previous) &&
        wordList.has(previous + lower) &&
        (!wordList.has(previous) || !wordList.has(lower))
      ) {
        splits += 1;
      }
      previous = word === token ? lower : null;
    }
  }
  if (wordList === null) {
    return { words, splits: null, splitShare: null, suspected: false };
  }
  const splitShare = words === 0 ? 0 : splits / words;
  return {
    words,
    splits,
    splitShare,
    suspected: words >= OCR_SPLIT_MIN_WORDS && splitShare > OCR_SPLIT_MAX_SHARE,
  };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/**
 * Run §4.1 steps 1–8 over raw Tier 2 text.
 *
 * @param raw - the attachment text exactly as Zotero returned it
 * @param wordList - step 8's word list; without one the probe judges nothing
 * @returns the cleaned text and a numbers-only report
 */
export function cleanFullText(
  raw: string,
  wordList: WordList | null = null,
): CleanedText {
  const split = splitPages(raw);
  const heads = removeRunningHeads(split.pages);
  let gutterPages = 0;
  const pages = heads.pages.map((page) => {
    const gutter = stripLineNumberGutter(page);
    if (gutter.stripped) gutterPages += 1;
    // Step 4 is deliberately absent (module note).
    return collapsePageWhitespace(gutter.page);
  });
  const joined = joinPages({ pages, separators: split.separators });
  const references = truncateReferences(joined);
  const supplementary = dropSupplementary(references.text);
  const text = supplementary.text;
  return {
    text,
    report: {
      pages: split.pages.length,
      runningHeads: heads.heads,
      runningHeadLinesRemoved: heads.linesRemoved,
      gutterPages,
      references: references.cut,
      supplementaryCharsRemoved: supplementary.removed,
      ocr: probeStraySpaceSplits(text, wordList),
    },
  };
}
