/**
 * IMRaD section detection — `docs/06` §4.3 (`P3-T21`).
 *
 * Caller: `acquireSource` in `./acquire.ts`, once per acquisition, on the
 * full-text body only (Tiers 2 and 3); never on Tier 1 or Tier 4 text.
 *
 * ## Two sources of section positions
 *
 * - **Tier 3 (JATS)** — {@link detectSectionsFromJats}. The sections already
 *   exist: `P3-T19`'s `extractJats` keeps each `body/sec` with its
 *   `@sec-type` and title. Nothing is re-detected here; `@sec-type` is mapped
 *   ({@link JATS_SEC_TYPES}) and an untyped or unmapped section falls through
 *   to the heading table on its title. `supplementary-material` sections never
 *   reach this module (`extractJats` drops them).
 * - **Tier 2 (PDF)** — {@link detectSectionsFromPdf}. Built, by the owner's
 *   ruling (2026-10-23, `plan/00` §6 item 271(c)), on
 *   `getStructuredDocumentText`'s section outline (`catalog.outline`) and its
 *   classified `heading` blocks, read through `src/zotero/fulltext.ts`'s
 *   {@link DocumentStructure}. The outline and heading blocks give *where*
 *   headings are; the table gives *what* each one is. The line scan with the
 *   table runs only as the fallback, for headings the outline does not anchor.
 *   Nothing here reads `style.bold` (`V-8b`: not portable).
 *
 * ## The heading table
 *
 * {@link IMRAD_HEADING_TABLE} is §4.3's table, row for row and in its order:
 * tried top to bottom, first match wins, so the combined "Results and
 * Discussion" row is tested before the bare "Results" row. Do not reorder it.
 *
 * ## Failure is declared, not guessed
 *
 * Fewer than {@link MIN_IMRAD_SECTIONS} recognized sections → `sectionAware:
 * false` and no sections at all, so nothing downstream can attribute text to
 * a label the detector could not justify. "Recognized" counts distinct label
 * sets among sections that are not `other`.
 *
 * ## Offsets
 *
 * Every returned section carries `start` / `end` into the caller's text
 * (`offset` is where the body starts in it), and `text` is exactly that slice.
 * Sections are contiguous from the first character of the body to its last,
 * so `P3-T22` can score attribution per character.
 *
 * ## Validation (`P3-T22`, risk `R-19b`, gate `G-22`)
 *
 * {@link IMRAD_MEASUREMENT} is the committed result of
 * `scripts/measure-imrad.ts` over `P3-T20`'s 40-paper fixture set, scored as
 * `docs/06` §4.3's note of 2026-11-10 defines. Since `P3-T41` the detector is
 * **tuned against that set**, so its figure overstates real accuracy and
 * validates nothing: it is a regression pin only.
 * {@link IMRAD_DETECTOR_VALIDATED} derives **only** from
 * {@link IMRAD_HELDOUT_MEASUREMENT}, the one measurement on the held-out set
 * (`test/fixtures/imrad-heldout/`, `P3-T40`), against
 * {@link IMRAD_ACCURACY_BAR} — see {@link detectorValidatedBy}. That record
 * was made on 2026-11-13 (92.94 %, at or above the bar), so the flag is
 * `true`. Callers: `acquireSource` (`./acquire.ts`) passes the detector's
 * sections on while it is true (and would return `sectionAware: false` and no
 * sections were it false), and the summarize and trend-report pipelines pass
 * it to `summarizeItem` as `imradDetectorValidated`.
 * `test/unit/pipeline/imradAccuracy.test.ts` re-measures the first set and
 * fails below its recorded value, and pins the held-out record.
 */

import type { AcquiredSection, ImradSection } from "../../model/summary";
import type { DocumentStructure } from "../../zotero/fulltext";

import type { JatsSection } from "./jats";

/** §4.3: fewer than this many recognized sections → segmentation failed. */
export const MIN_IMRAD_SECTIONS = 2;

/** §4.3's candidate-heading length bound for the line-scan fallback. */
export const MAX_HEADING_LINE_CHARS = 90;

// ---------------------------------------------------------------------------
// Validation (`P3-T22`, module note)
// ---------------------------------------------------------------------------

/** §4.3's bar: ≥ 85 % correct section attribution, per character. */
export const IMRAD_ACCURACY_BAR = 0.85;

/** One recorded run of `scripts/measure-imrad.ts`. */
export interface ImradMeasurement {
  /** The day it was measured (ISO date). */
  readonly measuredOn: string;
  /**
   * Which fixture set was measured: `first` (`test/fixtures/imrad/`, which
   * the detector is tuned against) or `heldout` (`test/fixtures/imrad-heldout/`,
   * measured once, never tuned against).
   */
  readonly set: "first" | "heldout";
  /**
   * What ran: the PDF path with no document structure, the only input the
   * text-only fixtures allow (`docs/06` §4.3's note of 2026-11-10, (9)).
   */
  readonly path: "pdf-without-structure";
  /** Papers pooled: those whose `hasImradStructure` is true. */
  readonly papers: number;
  /** Characters scored over those papers. */
  readonly countedChars: number;
  /** Of those, characters attributed correctly. */
  readonly correctChars: number;
}

/**
 * The committed first-set measurement (`docs/spikes/imrad-accuracy-report.md`),
 * the regression pin `test/unit/pipeline/imradAccuracy.test.ts` checks.
 * **Tuned** (`P3-T41`): the detector was changed against these labels, so
 * this figure is not evidence of accuracy and never validates the detector.
 * Change it only from a run of `scripts/measure-imrad.ts`, never by hand.
 */
export const IMRAD_MEASUREMENT: ImradMeasurement = {
  measuredOn: "2026-11-13",
  set: "first",
  path: "pdf-without-structure",
  papers: 34,
  countedChars: 1_474_524,
  correctChars: 1_380_235,
};

/** The one held-out measurement: a held-out run, with the commit it measured. */
export interface ImradHeldoutMeasurement extends ImradMeasurement {
  readonly set: "heldout";
  /** The commit whose detector was measured. */
  readonly commit: string;
}

/**
 * The one measurement on the held-out set (`P3-T41` step 4, run once with
 * `--final-heldout-measurement` by the coordinator), recorded by hand from
 * that run's printout (`plan/reports/imrad-heldout-measurement-2026-11-13.md`)
 * with its date and the commit it measured: **92.94 %**, not tuned, the
 * validation figure (`docs/06` §4.3, note "Measured 2026-11-13 (held-out)").
 * `scripts/measure-imrad.ts` checks a held-out run against it; a second run
 * on the held-out set needs the owner's decision. `null` would mean "not
 * measured", and the flag false.
 */
export const IMRAD_HELDOUT_MEASUREMENT: ImradHeldoutMeasurement | null = {
  measuredOn: "2026-11-13",
  set: "heldout",
  path: "pdf-without-structure",
  papers: 15,
  countedChars: 634_062,
  correctChars: 589_282,
  commit: "257b244",
};

/**
 * Whether `record` validates the detector: it must be a **held-out**
 * measurement at or above {@link IMRAD_ACCURACY_BAR}. A first-set record never
 * validates, whatever its figure, because the detector is tuned against that
 * set (`P3-T41`: "do not derive `IMRAD_DETECTOR_VALIDATED` from the tuned
 * first-set figure").
 */
export function detectorValidatedBy(record: ImradMeasurement | null): boolean {
  return (
    record !== null &&
    record.set === "heldout" &&
    record.countedChars > 0 &&
    record.correctChars >= IMRAD_ACCURACY_BAR * record.countedChars
  );
}

/**
 * Whether the detector met {@link IMRAD_ACCURACY_BAR} on the held-out set
 * ({@link IMRAD_HELDOUT_MEASUREMENT}); `true` since that record (2026-11-13).
 * Were it false, `auto` would degrade to whole-document flat chunking and no
 * prompt would claim section provenance (`docs/06` §4.3, `docs/11` R-19b;
 * the owner's `G-22` choice, which now stands only as that fallback).
 */
export const IMRAD_DETECTOR_VALIDATED: boolean = detectorValidatedBy(
  IMRAD_HELDOUT_MEASUREMENT,
);

/** The order labels are listed in when a section carries more than one. */
const LABEL_ORDER: readonly ImradSection[] = [
  "abstract",
  "introduction",
  "background",
  "related_work",
  "methods",
  "results",
  "discussion",
  "conclusion",
  "limitations",
  "other",
];

function inLabelOrder(labels: Iterable<ImradSection>): ImradSection[] {
  const set = new Set(labels);
  return LABEL_ORDER.filter((label) => set.has(label));
}

// ---------------------------------------------------------------------------
// The heading table (§4.3), in its order
// ---------------------------------------------------------------------------

/** One row of §4.3's table. */
export interface HeadingRow {
  /** Tried, case-insensitively, against the heading's name ({@link headingName}). */
  readonly pattern: RegExp;
  /** The labels a match yields; a function where the row has two targets. */
  readonly labels: (match: RegExpExecArray) => readonly ImradSection[];
  /**
   * `true` for `plan/00` §6 item 364(b)'s back matter: such a heading is a
   * boundary only **after the last main heading** (note of 2026-11-13, (3));
   * before it ("2.1 Ethics statement" inside the Methods) it starts nothing.
   */
  readonly backMatter?: true;
}

const fixed =
  (...labels: ImradSection[]) =>
  (): readonly ImradSection[] =>
    labels;

/**
 * §4.3's numbering prefix (note of 2026-11-13, (1)), removed before a row is
 * tried. **Case-sensitive on purpose**: an Arabic number with optional
 * decimal parts and an optional closing period ("4", "2.", "5.1", "2.1."), or
 * an upper-case Roman numeral from I to XXXIX with its period ("I.", "IV."),
 * either one optionally followed by a pipe ("1 |"). Letter labels ("A.",
 * "C.") number subsections and are not stripped. Always matches, possibly
 * the empty string.
 */
export const HEADING_NUMBERING =
  /^(?:(?:\d+(?:\.\d+)*\.?|(?=[IVX])X{0,3}(?:IX|IV|V?I{0,3})\.)(?:\s*\|)?\s*)?/u;

/**
 * A heading's *name*: leading white space and {@link HEADING_NUMBERING}
 * removed, "&" read as "and", and white-space runs as one space (`plan/00`
 * §6 item 364(a): "numbering and case are ignored and '&' reads as 'and'").
 */
export function headingName(heading: string): string {
  return heading
    .replace(/^[\s\f]+/u, "")
    .replace(HEADING_NUMBERING, "")
    .replace(/\s*&\s*/gu, " and ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * `docs/06` §4.3's table, case-insensitive over {@link headingName}, **in the
 * documented order**: tried top to bottom, first match wins. The
 * `background | related work | prior work | literature review` row splits
 * its target by which alternative matched. The last two rows are front and
 * back matter, labelled `other` (note of 2026-11-13, (3)): a boundary, never
 * a recognized section. The first of them (item 364(a)'s names) is a boundary
 * wherever it stands; the second (item 364(b)'s back matter) only after the
 * last main heading.
 */
export const IMRAD_HEADING_TABLE: readonly HeadingRow[] = [
  {
    pattern: /^(abstract|summary)\s*$/i,
    labels: fixed("abstract"),
  },
  {
    pattern: /^(introduction)\b/i,
    labels: fixed("introduction"),
  },
  {
    pattern: /^(background|related works?|prior work|literature review)\b/i,
    labels: (match) =>
      (match[1] ?? "").toLowerCase() === "background"
        ? ["background"]
        : ["related_work"],
  },
  {
    pattern:
      /^(materials? and methods?|methods?|methodology|experimental (?:section|methods?|procedures?)|experimental(?=\s*$|\s+\d)|star\W*methods|study design|patients and methods|implementation|theoretical models?|data analysis)\b/i,
    labels: fixed("methods"),
  },
  {
    pattern: /^(results? and discussion)\b/i,
    labels: fixed("results", "discussion"),
  },
  {
    pattern: /^(results?|findings|experimental results?)\b/i,
    labels: fixed("results"),
  },
  {
    pattern: /^(discussion)\b/i,
    labels: fixed("discussion"),
  },
  {
    pattern: /^(limitations?)\b/i,
    labels: fixed("limitations"),
  },
  {
    pattern: /^(conclusions?|concluding remarks)\b/i,
    labels: fixed("conclusion"),
  },
  {
    pattern:
      /^(acknowledge?ments?|appendix|availability and requirements|author summary|research in context|significance statement|highlights|nomenclature)\b/i,
    labels: fixed("other"),
  },
  {
    pattern:
      /^(funding|authors?'?s?'? contributions?|competing interests?|conflicts? of interests?|declarations? of (?:competing )?interests?|(?:data|code)(?: and (?:code|materials?))? (?:availability|sharing)|availability of (?:data|code)|ethics?|ethical)\b/i,
    labels: fixed("other"),
    backMatter: true,
  },
];

/**
 * The labels §4.3's table gives `heading` — its {@link headingName} tried
 * against each row, top to bottom, first match wins — or `null` when no row
 * matches.
 */
export function labelHeading(heading: string): readonly ImradSection[] | null {
  return matchHeading(heading)?.labels ?? null;
}

/** The first row matching `heading`'s name, with the labels it yields. */
function matchHeading(heading: string): {
  readonly labels: readonly ImradSection[];
  readonly backMatter: boolean;
} | null {
  const name = headingName(heading);
  for (const row of IMRAD_HEADING_TABLE) {
    const match = row.pattern.exec(name);
    if (match !== null) {
      return { labels: row.labels(match), backMatter: row.backMatter === true };
    }
  }
  return null;
}

/**
 * `true` when §4.3's table matches `heading` on its back-matter row
 * (`plan/00` §6 item 364(b)), which counts only after the last main heading.
 */
export function isBackMatterHeading(heading: string): boolean {
  return matchHeading(heading)?.backMatter === true;
}

/**
 * §4.3's candidate-heading rule, for the line-scan fallback: shorter than
 * {@link MAX_HEADING_LINE_CHARS}, no terminal period, its name (after the
 * numbering) starting with an upper-case letter, and followed by a blank
 * line (or the end of the page / text), a capitalized sentence, or a line
 * starting with a digit — a numbered subheading (note of 2026-11-13, (4)).
 */
export function isCandidateHeadingLine(
  line: string,
  nextLine: string | undefined,
): boolean {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.length >= MAX_HEADING_LINE_CHARS) return false;
  if (trimmed.endsWith(".")) return false;
  if (!/^\p{Lu}/u.test(headingName(trimmed))) return false;
  if (nextLine === undefined) return true;
  const next = nextLine.replace(/^[\s\f]+/u, "");
  return next === "" || /^[\p{Lu}\p{N}]/u.test(next);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** How the PDF path found its headings — counts only, never text. */
export interface PdfDetectionStats {
  /** `true` when a {@link DocumentStructure} was supplied. */
  readonly structure: boolean;
  readonly outlineEntries: number;
  /** Outline entries the worker anchored to a content block. */
  readonly outlineAnchored: number;
  readonly headingBlocks: number;
  /** Structure headings kept (labelled, or unlabelled at the section level). */
  readonly structureCandidates: number;
  /** Structure headings found in the flat text. */
  readonly structureLocated: number;
  /** Headings the line-scan fallback added. */
  readonly fallbackAdded: number;
}

/** What a detector returns. */
export interface SectionDetection {
  /** Empty whenever {@link sectionAware} is `false`. */
  readonly sections: readonly AcquiredSection[];
  readonly sectionAware: boolean;
  /** Distinct label sets among non-`other` sections, before the gate. */
  readonly recognized: number;
}

/** The detection for a body with no detector run (Tiers 1 and 4). */
export const NO_SECTIONS: SectionDetection = {
  sections: [],
  sectionAware: false,
  recognized: 0,
};

/** One heading at a position in the body. */
interface Anchor {
  readonly start: number;
  readonly heading: string;
  readonly labels: readonly ImradSection[];
  /**
   * `true` for a back-matter heading ({@link isBackMatterHeading}) that counts
   * only after the last main heading ({@link dropEarlyBackMatter}).
   */
  readonly backMatter?: boolean;
}

/**
 * `plan/00` §6 item 364(b): back-matter headings **after the last main
 * heading** are `other`. A back-matter anchor before the last anchor that
 * carries an IMRaD label (anything but `other`) starts nothing, so
 * "2.1 Ethics statement" stays inside the Methods. `anchors` is sorted.
 */
function dropEarlyBackMatter(anchors: readonly Anchor[]): Anchor[] {
  let lastMain = -1;
  anchors.forEach((anchor) => {
    if (anchor.labels.some((label) => label !== "other")) {
      lastMain = anchor.start;
    }
  });
  return anchors.filter(
    (anchor) => anchor.backMatter !== true || anchor.start > lastMain,
  );
}

/**
 * Cut `body` at `anchors` (sorted, distinct starts) into contiguous sections,
 * shift them by `offset`, and apply the fewer-than-two gate.
 */
function assemble(
  body: string,
  anchors: readonly Anchor[],
  offset: number,
): SectionDetection {
  const sections: AcquiredSection[] = [];
  const push = (
    start: number,
    end: number,
    heading: string,
    labels: readonly ImradSection[],
  ): void => {
    if (end <= start) return;
    const list = labels.length === 0 ? (["other"] as const) : labels;
    sections.push({
      imrad: list[0] ?? "other",
      labels: list,
      heading,
      text: body.slice(start, end),
      start: offset + start,
      end: offset + end,
    });
  };
  const first = anchors[0];
  push(0, first === undefined ? body.length : first.start, "", ["other"]);
  anchors.forEach((anchor, i) => {
    const next = anchors[i + 1];
    push(
      anchor.start,
      next === undefined ? body.length : next.start,
      anchor.heading,
      anchor.labels,
    );
  });

  const recognized = new Set(
    sections
      .filter((s) => s.labels.some((label) => label !== "other"))
      .map((s) => s.labels.join("+")),
  ).size;
  return recognized < MIN_IMRAD_SECTIONS
    ? { sections: [], sectionAware: false, recognized }
    : { sections, sectionAware: true, recognized };
}

// ---------------------------------------------------------------------------
// Tier 3 — JATS
// ---------------------------------------------------------------------------

/**
 * §4.3's `@sec-type` mapping. A compound value (`materials|methods`,
 * `results|discussion`) is split on `|` and each part mapped; a value none of
 * whose parts is listed falls through to the heading table.
 */
export const JATS_SEC_TYPES: Readonly<Record<string, ImradSection>> = {
  intro: "introduction",
  introduction: "introduction",
  materials: "methods",
  methods: "methods",
  results: "results",
  discussion: "discussion",
  conclusions: "conclusion",
};

/** The labels for one JATS section: `@sec-type`, else its title, else `other`. */
export function labelJatsSection(
  section: Pick<JatsSection, "secType" | "heading">,
): readonly ImradSection[] {
  if (section.secType !== null) {
    const mapped = section.secType
      .split("|")
      .map((part) => JATS_SEC_TYPES[part.trim().toLowerCase()])
      .filter((label): label is ImradSection => label !== undefined);
    if (mapped.length > 0) return inLabelOrder(mapped);
  }
  return labelHeading(section.heading) ?? ["other"];
}

/**
 * `P3-T21` step 1: the JATS path. Re-uses `extractJats`'s sections as they
 * are and only labels them. `extraction.text` must be the text `extractJats`
 * built from `extraction.sections`; offsets are recomputed by the same join
 * (heading and paragraphs `\n`-joined, blocks `\n\n`-joined, empty ones
 * skipped), and a mismatch declares failure rather than mislabelling.
 *
 * @param offset - where `extraction.text` starts in the caller's text
 */
export function detectSectionsFromJats(
  extraction: {
    readonly sections: readonly JatsSection[];
    readonly text: string;
  },
  offset = 0,
): SectionDetection {
  const anchors: Anchor[] = [];
  let rebuilt = "";
  for (const section of extraction.sections) {
    const block = [section.heading, ...section.paragraphs]
      .filter((line) => line !== "")
      .join("\n");
    if (block === "") continue;
    if (rebuilt !== "") rebuilt += "\n\n";
    anchors.push({
      start: rebuilt.length,
      heading: section.heading,
      labels: labelJatsSection(section),
    });
    rebuilt += block;
  }
  if (rebuilt !== extraction.text) return NO_SECTIONS;
  // The first block starts at 0, so `assemble` adds no leading `other`.
  return assemble(extraction.text, anchors, offset);
}

// ---------------------------------------------------------------------------
// Tier 2 — PDF
// ---------------------------------------------------------------------------

/** `[start, end)` of each `\f`-delimited page of `body`. */
function pageSpans(body: string): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  let start = 0;
  for (let i = body.indexOf("\f"); i !== -1; i = body.indexOf("\f", i + 1)) {
    spans.push([start, i]);
    start = i + 1;
  }
  spans.push([start, body.length]);
  return spans;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The first occurrence of `heading` in `body[from, to)` as whole words, with
 * any whitespace run (including `\n`) standing for a space. An occurrence at
 * the start of a line is preferred over an earlier one inside a line, because
 * a heading usually starts its line and a mention of the same words in the
 * running text usually does not.
 */
function locate(
  body: string,
  heading: string,
  from: number,
  to: number,
): { readonly start: number; readonly end: number } | null {
  const words = heading.normalize("NFC").split(/\s+/u).filter(Boolean);
  if (words.length === 0 || from >= to) return null;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${words.map(escapeRegExp).join("\\s+")}(?![\\p{L}\\p{N}])`,
    "gu",
  );
  const window = body.slice(from, to);
  let firstAnywhere: { start: number; end: number } | null = null;
  for (const match of window.matchAll(pattern)) {
    const at = match.index;
    const found = { start: from + at, end: from + at + match[0].length };
    const lineStart = Math.max(
      window.lastIndexOf("\n", at - 1),
      window.lastIndexOf("\f", at - 1),
    );
    if (window.slice(lineStart + 1, at).trim() === "") return found;
    firstAnywhere ??= found;
  }
  return firstAnywhere;
}

/** One heading the structure offers, before it is located. */
interface StructureCandidate {
  readonly blockIndex: number;
  readonly text: string;
  readonly pageIndex: number | null;
  readonly labels: readonly ImradSection[];
  /** A back-matter heading that is not an outline entry at the section level. */
  readonly backMatter: boolean;
}

/**
 * The structure's headings, in `content[]` order: every anchored outline
 * entry and every `heading` block the outline does not point at. A heading
 * the table labels is kept; an unlabelled one is kept as an `other` boundary
 * only when it is an outline entry at the outline's **section level** (the
 * shallowest depth holding a labelled entry), so that "Acknowledgements" ends
 * the Discussion while "2.1 Cell culture" stays inside the Methods.
 */
function structureCandidates(
  structure: DocumentStructure,
): StructureCandidate[] {
  const anchored = structure.outline.filter(
    (entry) => entry.blockIndex !== null,
  );
  const labelled = anchored.map(
    (entry) =>
      labelHeading(entry.blockText ?? entry.title) ??
      (entry.blockText !== null ? labelHeading(entry.title) : null),
  );
  // The section level counts only IMRaD labels: a back-matter row's `other`
  // (note of 2026-11-13, (3)) does not set it.
  const depths = anchored
    .filter((_, i) => (labelled[i] ?? []).some((label) => label !== "other"))
    .map((entry) => entry.depth);
  const sectionLevel = depths.length === 0 ? null : Math.min(...depths);

  const out: StructureCandidate[] = [];
  const seen = new Set<number>();
  anchored.forEach((entry, i) => {
    const blockIndex = entry.blockIndex as number;
    if (seen.has(blockIndex)) return;
    const labels = labelled[i] ?? null;
    if (labels === null && entry.depth !== sectionLevel) return;
    seen.add(blockIndex);
    const text = entry.blockText ?? entry.title;
    out.push({
      blockIndex,
      text,
      pageIndex: entry.pageIndex,
      labels: labels ?? ["other"],
      // An outline entry at the section level is a boundary wherever it is.
      backMatter: entry.depth !== sectionLevel && isBackMatterHeading(text),
    });
  });
  for (const block of structure.headingBlocks) {
    if (seen.has(block.blockIndex)) continue;
    const labels = labelHeading(block.text);
    if (labels === null) continue;
    seen.add(block.blockIndex);
    out.push({
      blockIndex: block.blockIndex,
      text: block.text,
      pageIndex: block.pageIndex,
      labels,
      backMatter: isBackMatterHeading(block.text),
    });
  }
  return out.sort((a, b) => a.blockIndex - b.blockIndex);
}

/** §4.3's line scan over `body`: every candidate line the table labels. */
function scanLines(body: string): Anchor[] {
  const anchors: Anchor[] = [];
  const lines = body.split("\n");
  let at = 0;
  lines.forEach((line, i) => {
    const lead = /^[\s\f]*/u.exec(line)?.[0].length ?? 0;
    const content = line.slice(lead);
    if (isCandidateHeadingLine(content, lines[i + 1])) {
      const labels = labelHeading(content);
      if (labels !== null) {
        anchors.push({
          start: at + lead,
          heading: content.trim(),
          labels,
          backMatter: isBackMatterHeading(content),
        });
      }
    }
    at += line.length + 1;
  });
  return anchors;
}

/**
 * `P3-T21` step 2: the PDF path (module note). `body` is the cleaned Tier 2
 * text, `\f`-delimited by page; `structure` is the attachment's
 * {@link DocumentStructure}, or `null` when there is none (then the line scan
 * is the whole detector).
 *
 * Structure headings are located in `body` in document order, each within
 * its own page when the page is known, and never before the previous one.
 * The line scan then adds a heading only for a label set no located structure
 * heading already carries.
 *
 * @param offset - where `body` starts in the caller's text
 */
export function detectSectionsFromPdf(
  body: string,
  structure: DocumentStructure | null,
  offset = 0,
): SectionDetection & { readonly stats: PdfDetectionStats } {
  const pages = pageSpans(body);
  const located: Anchor[] = [];
  const candidates = structure === null ? [] : structureCandidates(structure);
  let cursor = 0;
  for (const candidate of candidates) {
    const page =
      candidate.pageIndex === null ? undefined : pages[candidate.pageIndex];
    const from = Math.max(cursor, page?.[0] ?? 0);
    const to = page?.[1] ?? body.length;
    const found = locate(body, candidate.text, from, to);
    if (found === null) continue;
    located.push({
      start: found.start,
      heading: body.slice(found.start, found.end),
      labels: candidate.labels,
      backMatter: candidate.backMatter,
    });
    cursor = found.end;
  }

  // The fallback: a scanned heading is added only for a label set no located
  // structure heading carries, and never on a structure heading's position.
  const have = new Set(located.map((anchor) => anchor.labels.join("+")));
  const taken = new Set(located.map((anchor) => anchor.start));
  const fallbackKept = scanLines(body).filter(
    (anchor) => !have.has(anchor.labels.join("+")) && !taken.has(anchor.start),
  );

  const anchors = dropEarlyBackMatter(
    [...located, ...fallbackKept].sort((a, b) => a.start - b.start),
  );
  const detection = assemble(body, anchors, offset);
  return {
    ...detection,
    stats: {
      structure: structure !== null,
      outlineEntries: structure?.outline.length ?? 0,
      outlineAnchored:
        structure?.outline.filter((entry) => entry.blockIndex !== null)
          .length ?? 0,
      headingBlocks: structure?.headingBlocks.length ?? 0,
      structureCandidates: candidates.length,
      structureLocated: located.length,
      fallbackAdded: fallbackKept.length,
    },
  };
}
