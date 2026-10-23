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
 */

import type { AcquiredSection, ImradSection } from "../../model/summary";
import type { DocumentStructure } from "../../zotero/fulltext";

import type { JatsSection } from "./jats";

/** §4.3: fewer than this many recognized sections → segmentation failed. */
export const MIN_IMRAD_SECTIONS = 2;

/** §4.3's candidate-heading length bound for the line-scan fallback. */
export const MAX_HEADING_LINE_CHARS = 90;

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
  readonly pattern: RegExp;
  /** The labels a match yields; a function where the row has two targets. */
  readonly labels: (match: RegExpExecArray) => readonly ImradSection[];
}

const fixed =
  (...labels: ImradSection[]) =>
  (): readonly ImradSection[] =>
    labels;

/**
 * `docs/06` §4.3's table, case-insensitive, **in the documented order**. The
 * `background | related work | prior work` row splits its target by which
 * alternative matched.
 */
export const IMRAD_HEADING_TABLE: readonly HeadingRow[] = [
  {
    pattern: /^\s*(\d+\.?\s*)?(abstract|summary)\s*$/i,
    labels: fixed("abstract"),
  },
  {
    pattern: /^\s*(\d+\.?\s*)?(introduction)\b/i,
    labels: fixed("introduction"),
  },
  {
    pattern: /^\s*(\d+\.?\s*)?(background|related work|prior work)\b/i,
    labels: (match) =>
      (match[2] ?? "").toLowerCase() === "background"
        ? ["background"]
        : ["related_work"],
  },
  {
    pattern:
      /^\s*(\d+\.?\s*)?(materials? and methods?|methods?|methodology|experimental( section)?|study design|patients and methods)\b/i,
    labels: fixed("methods"),
  },
  {
    pattern: /^\s*(\d+\.?\s*)?(results? and discussion)\b/i,
    labels: fixed("results", "discussion"),
  },
  {
    pattern: /^\s*(\d+\.?\s*)?(results?|findings)\b/i,
    labels: fixed("results"),
  },
  {
    pattern: /^\s*(\d+\.?\s*)?(discussion)\b/i,
    labels: fixed("discussion"),
  },
  {
    pattern: /^\s*(\d+\.?\s*)?(limitations?)\b/i,
    labels: fixed("limitations"),
  },
  {
    pattern: /^\s*(\d+\.?\s*)?(conclusions?|concluding remarks)\b/i,
    labels: fixed("conclusion"),
  },
];

/**
 * The labels §4.3's table gives `heading` — first matching row, top to bottom
 * — or `null` when no row matches.
 */
export function labelHeading(heading: string): readonly ImradSection[] | null {
  for (const row of IMRAD_HEADING_TABLE) {
    const match = row.pattern.exec(heading);
    if (match !== null) return row.labels(match);
  }
  return null;
}

/**
 * §4.3's candidate-heading rule, for the line-scan fallback: shorter than
 * {@link MAX_HEADING_LINE_CHARS}, no terminal period, and followed by a blank
 * line (or the end of the page / text) or a capitalized sentence.
 */
export function isCandidateHeadingLine(
  line: string,
  nextLine: string | undefined,
): boolean {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.length >= MAX_HEADING_LINE_CHARS) return false;
  if (trimmed.endsWith(".")) return false;
  if (nextLine === undefined) return true;
  const next = nextLine.replace(/^[\s\f]+/u, "");
  return next === "" || /^\p{Lu}/u.test(next);
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
  const depths = anchored
    .filter((_, i) => labelled[i] !== null)
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
    out.push({
      blockIndex,
      text: entry.blockText ?? entry.title,
      pageIndex: entry.pageIndex,
      labels: labels ?? ["other"],
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
        anchors.push({ start: at + lead, heading: content.trim(), labels });
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

  const anchors = [...located, ...fallbackKept].sort(
    (a, b) => a.start - b.start,
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
