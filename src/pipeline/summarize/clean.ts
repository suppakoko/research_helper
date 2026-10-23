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
 *    digit-only line is far more often a table cell.
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
 *    report says why.
 * 7. **Supplementary material.** The first line in the last 45 % of the text
 *    that is, on its own, a §4.1 supplementary heading marks a second cut to
 *    the end. §4.1's pattern is not anchored at the line's end; it is here,
 *    so that a sentence such as "Supplementary figures S1–S3 show…" never
 *    deletes the rest of the paper.
 * 8. **OCR probe** — {@link probeOcrQuality}, on the cleaned body. It warns
 *    (`ocr_suspected`) and never demotes (owner, 2026-10-21, item 258).
 */

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
 */
const REFERENCE_HEADING =
  /(^|\f)[ \t]*(?:references|bibliography|literature cited|참고[ \t]*문헌)[ \t]*$/gimu;

/**
 * §4.1 step 7's heading, anchored at the line's end (module note, step 7). An
 * optional section number and a trailing colon are allowed.
 */
const SUPPLEMENTARY_HEADING =
  /(^|\f)[ \t]*(?:\d+\.?[ \t]*)?(?:supplement(?:ary|al)?(?: (?:material|information|data|figures?|tables?))?|supporting information)[ \t]*:?[ \t]*$/gimu;

/**
 * §4.1 step 8's threshold on (letters + digits + punctuation) / total.
 * **Provisional — to be replaced by the figure `P3-T20`'s corpus measures**
 * (`docs/06` §4.1 step 8, decided 2026-10-21). `V-15` measured 0.834–0.852
 * on seven real files, so it separates almost nothing yet.
 */
export const OCR_PROBE_MIN_ALNUM_PUNCT_SHARE = 0.8;

/**
 * PROPOSAL (`P0-T19`; `docs/06` §4.1 step 8, decided 2026-10-21). No document
 * fixes a minimum for Tier 2 text; 1,500 characters is about 250 words. Stays
 * a proposal until `P3-T20`'s corpus measures a value that separates.
 */
export const OCR_PROBE_MIN_CHARS = 1500;

/**
 * PROPOSAL (`P0-T19`; `docs/06` §4.1 step 8, decided 2026-10-21). R-19's
 * letters/total ratio; `P0-T19` measured 0.71–0.78 on real articles. Stays a
 * proposal until `P3-T20`'s corpus measures a value that separates.
 */
export const OCR_PROBE_MIN_LETTER_SHARE = 0.6;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Which probe threshold failed. */
export type OcrProbeFailure =
  "alnum_punct_share" | "letter_share" | "too_short";

/** {@link probeOcrQuality}'s measurement. Numbers only, never text. */
export interface OcrProbe {
  /** Code points in the probed text. */
  readonly chars: number;
  readonly letters: number;
  readonly digits: number;
  /** Unicode `\p{P}` and `\p{S}`. */
  readonly punctuation: number;
  readonly whitespace: number;
  /** §4.1 step 8's measure: (letters + digits + punctuation) / chars. */
  readonly alnumPunctShare: number;
  /** letters / chars. */
  readonly letterShare: number;
  /** Every threshold that failed; empty when none did. */
  readonly failed: readonly OcrProbeFailure[];
  /** `failed` is not empty. Warns only; nothing demotes on it. */
  readonly suspected: boolean;
}

/** Step 6's outcome. */
export type ReferenceCut =
  | { readonly applied: true; readonly removedShare: number }
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

/** Step 2. Returns the new pages and what was removed. */
export function removeRunningHeads(pages: readonly string[]): {
  readonly pages: string[];
  readonly heads: number;
  readonly linesRemoved: number;
} {
  const pageLines = pages.map((page) => page.split("\n"));
  const pagesWithText = pageLines.filter((lines) =>
    lines.some((line) => line.trim() !== ""),
  ).length;
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

/** Step 6. */
export function truncateReferences(text: string): {
  readonly text: string;
  readonly cut: ReferenceCut;
} {
  const tailStart = text.length * (1 - TAIL_REGION_SHARE);
  let start = -1;
  for (const match of text.matchAll(REFERENCE_HEADING)) {
    const at = headingStart(match);
    if (at >= tailStart) start = at;
  }
  if (start === -1) {
    return {
      text,
      cut: { applied: false, reason: "no_heading", removedShare: null },
    };
  }
  const removedShare = (text.length - start) / text.length;
  if (
    removedShare < REFERENCE_CUT_MIN_SHARE ||
    removedShare > REFERENCE_CUT_MAX_SHARE
  ) {
    return {
      text,
      cut: { applied: false, reason: "outside_band", removedShare },
    };
  }
  return {
    text: text.slice(0, start).trimEnd(),
    cut: { applied: true, removedShare },
  };
}

/** Step 7. */
export function dropSupplementary(text: string): {
  readonly text: string;
  readonly removed: number;
} {
  const tailStart = text.length * (1 - TAIL_REGION_SHARE);
  for (const match of text.matchAll(SUPPLEMENTARY_HEADING)) {
    const at = headingStart(match);
    if (at < tailStart) continue;
    const kept = text.slice(0, at).trimEnd();
    return { text: kept, removed: text.length - kept.length };
  }
  return { text, removed: 0 };
}

// ---------------------------------------------------------------------------
// Step 8 — the OCR probe
// ---------------------------------------------------------------------------

const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;

/**
 * §4.1 step 8 and the two `PROPOSAL` thresholds. Whitespace is in the total
 * and not in the numerator — the reading `P0-T19` measured as 0.834–0.852;
 * the other reading puts every real file at 0.999–1.000 and is inert.
 *
 * @param text - the cleaned Tier 2 body, without the abstract preamble
 */
export function probeOcrQuality(text: string): OcrProbe {
  let chars = 0;
  let letters = 0;
  let digits = 0;
  let punctuation = 0;
  let whitespace = 0;
  for (const ch of text) {
    chars += 1;
    if (WHITESPACE.test(ch)) whitespace += 1;
    else if (LETTER.test(ch)) letters += 1;
    else if (DIGIT.test(ch)) digits += 1;
    else if (PUNCTUATION.test(ch)) punctuation += 1;
  }
  const alnumPunctShare =
    chars === 0 ? 0 : (letters + digits + punctuation) / chars;
  const letterShare = chars === 0 ? 0 : letters / chars;
  const failed: OcrProbeFailure[] = [];
  if (alnumPunctShare < OCR_PROBE_MIN_ALNUM_PUNCT_SHARE) {
    failed.push("alnum_punct_share");
  }
  if (letterShare < OCR_PROBE_MIN_LETTER_SHARE) failed.push("letter_share");
  if (chars < OCR_PROBE_MIN_CHARS) failed.push("too_short");
  return {
    chars,
    letters,
    digits,
    punctuation,
    whitespace,
    alnumPunctShare,
    letterShare,
    failed,
    suspected: failed.length > 0,
  };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/**
 * Run §4.1 steps 1–8 over raw Tier 2 text.
 *
 * @param raw - the attachment text exactly as Zotero returned it
 * @returns the cleaned text and a numbers-only report
 */
export function cleanFullText(raw: string): CleanedText {
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
      ocr: probeOcrQuality(text),
    },
  };
}
