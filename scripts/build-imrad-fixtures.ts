/**
 * `scripts/build-imrad-fixtures.ts` — the 40-paper IMRaD fixture set behind
 * `test/fixtures/imrad/` (`P3-T20`, gate `G-12`, `plan/00` §6 items 276–277
 * and 280).
 *
 * **What it does.**
 *
 * 1. `extract` — runs each approved PDF through the plugin's own Tier 2 path
 *    (`acquireZoteroSource`: Zotero's text extraction, then `P3-T19`'s
 *    cleaning pass) **inside Zotero**, and writes the text — never the PDF —
 *    to `text/<id>.txt` with a `text/<id>_meta.json` sidecar. It cannot run
 *    outside Zotero: the extractor is `Zotero.PDFWorker`, which exists only in
 *    a running Zotero, so this script starts the scaffold's test harness with
 *    its entries pointed at `scripts/imrad-fixtures/` alone (that directory's
 *    `extract.spec.ts` imports each PDF as a temporary attachment, acquires its
 *    text and erases it again). `--check` extracts into a scratch directory
 *    and compares byte for byte with the committed text instead of writing.
 * 2. `candidates` — writes `candidate-headings.json`, the data behind the
 *    owner's private labelling page: every line of each text that passes
 *    {@link isCandidateLine}, a plain line-shape rule. It is **not** the
 *    section detector under test (`src/pipeline/summarize/imrad.ts`, which
 *    this file never imports) and no model is involved; it errs towards too
 *    many lines.
 * 3. `ingest <export.json>` — turns the owner's decisions, exported from the
 *    labelling page's database collection, into `labels/<id>.json` files and
 *    sets each paper's `hasImradStructure` in `manifest.json`.
 * 4. `validate` — checks the manifest, every text's sidecar hash and every
 *    labels file. The unit test (`test/unit/pipeline/imradFixtureManifest
 *    .test.ts`) runs the same checks.
 *
 * **What it never does.** It never writes a label of its own: every label in
 * `labels/` is one the owner set on the page. It never reads the detector's
 * output (the in-Zotero half discards it), never calls a model, never copies a
 * PDF into the repository, and never downloads anything.
 *
 * ## Running it
 *
 * ```sh
 * npx tsx scripts/build-imrad-fixtures.ts extract --pdf-dir <folder>          # (re)build the text
 * npx tsx scripts/build-imrad-fixtures.ts extract --pdf-dir <folder> --check  # byte-compare only
 * npx tsx scripts/build-imrad-fixtures.ts extract --pdf-dir <folder> --only S1,S2
 * npx tsx scripts/build-imrad-fixtures.ts candidates
 * npx tsx scripts/build-imrad-fixtures.ts ingest <export.json>
 * npx tsx scripts/build-imrad-fixtures.ts validate
 * ```
 *
 * `extract` starts Zotero with the integration suite's profile
 * (`.scaffold/test/profile`), so it must not run while the integration suite
 * does, and it needs `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` exactly as
 * `npm run test:integration` does. The PDF folder is outside the repository
 * and is only read: each `<id>.pdf` is checked against the folder's
 * `_log.txt` (size and SHA-256 prefix) before Zotero sees it.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import type { ImradSection } from "../src/model/summary";

// ---------------------------------------------------------------------------
// 0. Paths and vocabulary
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** `test/fixtures/imrad/`, the fixture directory the card names. */
export const IMRAD_DIR = resolve(REPO_ROOT, "test/fixtures/imrad");
export const MANIFEST_FILE = "manifest.json";
export const CANDIDATES_FILE = "candidate-headings.json";
export const TEXT_DIR = "text";
export const LABELS_DIR = "labels";
/** `<id>_meta.json`, the `docs/13` §3.2 sidecar naming of the replay layer. */
export const META_SUFFIX = "_meta.json";
/** The directory the scaffold harness is pointed at for `extract`. */
const SPEC_DIR = "scripts/imrad-fixtures";
const SCRIPT = "scripts/build-imrad-fixtures.ts";

/**
 * Every `ImradSection`, in `docs/06` §4.3's table order, which is also the
 * order a section's `labels` must be written in. The type below fails to
 * compile if `src/model/summary.ts` gains a member this list lacks.
 */
export const IMRAD_SECTIONS = [
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
] as const satisfies readonly ImradSection[];

/** `true` only while {@link IMRAD_SECTIONS} lists every `ImradSection`. */
export const IMRAD_SECTIONS_COMPLETE: [
  Exclude<ImradSection, (typeof IMRAD_SECTIONS)[number]>,
] extends [never]
  ? true
  : false = true;

/** The labels the owner chooses from on the page (`plan/00` §6 item 280(b)). */
export const OWNER_LABELS = [
  "introduction",
  "methods",
  "results",
  "discussion",
  "results+discussion",
  "other",
  "not-heading",
] as const;
export type OwnerLabel = (typeof OWNER_LABELS)[number];

/** What each owner label becomes in a labels file; `not-heading` is no section. */
export const OWNER_LABEL_SECTIONS: Readonly<
  Record<Exclude<OwnerLabel, "not-heading">, readonly ImradSection[]>
> = {
  introduction: ["introduction"],
  methods: ["methods"],
  results: ["results"],
  discussion: ["discussion"],
  "results+discussion": ["results", "discussion"],
  other: ["other"],
};

/** `docs/06` §4.3's publisher families, plus the two extra groups of the set. */
export const PUBLISHER_FAMILIES = [
  "elsevier",
  "springer",
  "wiley",
  "oup",
  "plos",
  "nature",
  "ieee",
  "arxiv",
  "biorxiv",
  "us-government",
] as const;
export type PublisherFamily = (typeof PUBLISHER_FAMILIES)[number];

/** The families `docs/06` §4.3 names, each needing ≥ 4 papers (card step 1). */
export const NAMED_FAMILIES: readonly PublisherFamily[] = [
  "elsevier",
  "springer",
  "wiley",
  "oup",
  "plos",
  "nature",
  "ieee",
  "arxiv",
];

/**
 * The licences the owner approved for this set. Extracted text under each of
 * them may be committed (CC BY and CC0 permit redistribution with
 * attribution; a US-government work has no copyright under 17 U.S.C. 105).
 */
export const REDISTRIBUTABLE_LICENCES = [
  "CC BY 2.0",
  "CC BY 4.0",
  "CC0 1.0",
  "US government work (17 U.S.C. 105)",
] as const;

// ---------------------------------------------------------------------------
// 1. Small helpers
// ---------------------------------------------------------------------------

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Pretty JSON with a trailing newline, as every file here is written. */
export function toJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Lines of `text` with their UTF-16 start offsets. A line ends at `\n` or at
 * a page separator `\f` (the cleaning pass keeps `\n*\f` between pages); the
 * separator belongs to neither line.
 */
export function splitLines(
  text: string,
): { readonly start: number; readonly raw: string }[] {
  const lines: { start: number; raw: string }[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (i === text.length || ch === "\n" || ch === "\f") {
      lines.push({ start, raw: text.slice(start, i) });
      start = i + 1;
    }
  }
  return lines;
}

/** The 1-based page a UTF-16 offset falls on (`\f` separates pages). */
export function pageAt(text: string, offset: number): number {
  let page = 1;
  for (let i = text.indexOf("\f"); i !== -1 && i < offset;) {
    page++;
    i = text.indexOf("\f", i + 1);
  }
  return page;
}

// ---------------------------------------------------------------------------
// 2. The candidate-line rule (the labelling page's data; NOT the detector)
// ---------------------------------------------------------------------------

/** A candidate line is at most this many characters, after trimming. */
export const CANDIDATE_MAX_CHARS = 120;
/** Characters of the next non-empty line shown beside a candidate. */
export const CANDIDATE_CONTEXT_CHARS = 60;

/**
 * The plain line-shape rule, stated in full in `test/fixtures/imrad/README.md`.
 * A line (split on `\n` and `\f`, then trimmed of surrounding white space) is
 * a candidate when:
 *
 * 1. it is 1 to {@link CANDIDATE_MAX_CHARS} characters long;
 * 2. it contains at least one letter (`\p{L}`);
 * 3. it does not end with a full stop (`.`), the mark of a sentence.
 *
 * Numbering (`2`, `2.1`, `II.`, `A`) is allowed anywhere and never required.
 * Nothing here knows a section name: no word list, no regex for
 * "Methods"/"Results", no font, no position, no model.
 */
export function isCandidateLine(trimmed: string): boolean {
  return (
    trimmed.length >= 1 &&
    trimmed.length <= CANDIDATE_MAX_CHARS &&
    /\p{L}/u.test(trimmed) &&
    !trimmed.endsWith(".")
  );
}

export interface CandidateLine {
  /** UTF-16 offset of the line's first non-white-space character. */
  readonly offset: number;
  /** The line, trimmed; `text.startsWith(line, offset)` holds. */
  readonly line: string;
  /** The start of the next non-empty line, for context. */
  readonly next: string;
  /** 1-based page (`\f`-delimited). */
  readonly page: number;
}

export function candidateLines(text: string): CandidateLine[] {
  const lines = splitLines(text);
  const out: CandidateLine[] = [];
  lines.forEach(({ start, raw }, index) => {
    const trimmed = raw.trim();
    if (!isCandidateLine(trimmed)) return;
    let next = "";
    for (let j = index + 1; j < lines.length; j++) {
      const t = lines[j]?.raw.trim() ?? "";
      if (t !== "") {
        next = t.slice(0, CANDIDATE_CONTEXT_CHARS);
        break;
      }
    }
    const offset = start + (raw.length - raw.trimStart().length);
    out.push({ offset, line: trimmed, next, page: pageAt(text, offset) });
  });
  return out;
}

export interface PaperCandidates {
  readonly id: string;
  readonly textFile: string;
  readonly textSha256: string;
  readonly textChars: number;
  readonly lineCount: number;
  readonly candidateCount: number;
  readonly candidates: readonly CandidateLine[];
}

export interface CandidatesFile {
  readonly schema: "imrad-candidate-headings-v1";
  readonly generatedBy: string;
  readonly rule: readonly string[];
  readonly papers: readonly PaperCandidates[];
}

export const CANDIDATE_RULE_TEXT: readonly string[] = [
  "Split the text into lines at every \\n and every \\f (page separator); trim each line.",
  `Keep a line when it is 1 to ${CANDIDATE_MAX_CHARS} characters long, contains at least one letter, and does not end with a full stop.`,
  "Numbering is allowed and never required. No word list, no section names, no fonts, no positions, no model; not the detector in src/pipeline/summarize/imrad.ts.",
  "offset is the UTF-16 index of the line's first non-space character in the text file; next is the first characters of the next non-empty line; page counts \\f separators.",
];

export function buildCandidatesFile(
  texts: readonly { id: string; text: string }[],
): CandidatesFile {
  return {
    schema: "imrad-candidate-headings-v1",
    generatedBy: `npx tsx ${SCRIPT} candidates`,
    rule: CANDIDATE_RULE_TEXT,
    papers: texts.map(({ id, text }) => {
      const candidates = candidateLines(text);
      return {
        id,
        textFile: `${TEXT_DIR}/${id}.txt`,
        textSha256: sha256Hex(text),
        textChars: text.length,
        lineCount: splitLines(text).length,
        candidateCount: candidates.length,
        candidates,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// 3. Column count
// ---------------------------------------------------------------------------

/**
 * The column evidence the in-Zotero half measures (`columnGeometry` in
 * `scripts/imrad-fixtures/extract.spec.ts`). The extracted text cannot show
 * columns — Zotero 10.0.3's extractor writes one line per text block — so the
 * count is observed on the same PDF's structured document text instead: per
 * page, whether at least half the body-paragraph area sits in boxes no wider
 * than 55 % of the page.
 */
export interface ColumnGeometry {
  readonly pagesWithBody: number;
  readonly twoColumnPages: number;
}

/** Two columns when at least half the pages with body text are two-column. */
export function columnCountFromGeometry(
  geometry: ColumnGeometry | undefined,
): 1 | 2 | null {
  if (geometry === undefined || geometry.pagesWithBody === 0) return null;
  return geometry.twoColumnPages * 2 >= geometry.pagesWithBody ? 2 : 1;
}

// ---------------------------------------------------------------------------
// 4. The manifest
// ---------------------------------------------------------------------------

export interface ManifestPaper {
  readonly id: string;
  readonly title: string;
  readonly venue: string;
  readonly publisher: PublisherFamily;
  readonly doi: string | null;
  readonly otherId: string | null;
  readonly landingUrl: string;
  readonly sourceUrl: string;
  readonly licence: (typeof REDISTRIBUTABLE_LICENCES)[number];
  readonly licenceEvidence: string;
  readonly preprint: boolean;
  readonly scanned: boolean;
  readonly layout: {
    readonly columnsExpected: 1 | 2 | null;
    readonly columnsExpectedBasis: string;
    readonly headingNumbering: "none" | "arabic" | "roman" | "unknown";
    readonly webHeadings: string | null;
    readonly notes: readonly string[];
  };
  readonly columnCount: 1 | 2 | null;
  readonly columnCountBasis: string;
  readonly textFile: string;
  readonly labelsFile: string;
  readonly hasImradStructure: boolean | null;
}

export interface Manifest {
  readonly schema: "imrad-manifest-v1";
  readonly description: string;
  readonly papers: readonly ManifestPaper[];
}

const ID_PATTERN = /^[A-Z]{1,2}R?\d{1,2}$/u;

/** Shape errors of a parsed `manifest.json`; empty when it is valid. */
export function validateManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["manifest: not an object"];
  if (value.schema !== "imrad-manifest-v1") errors.push("manifest: schema");
  if (!Array.isArray(value.papers)) return [...errors, "manifest: no papers"];
  const seen = new Set<string>();
  for (const [i, paper] of value.papers.entries()) {
    const at = `papers[${i}]`;
    if (!isRecord(paper)) {
      errors.push(`${at}: not an object`);
      continue;
    }
    const id = paper.id;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      errors.push(`${at}: id`);
      continue;
    }
    if (seen.has(id)) errors.push(`${id}: duplicate id`);
    seen.add(id);
    for (const key of [
      "title",
      "venue",
      "landingUrl",
      "sourceUrl",
      "licenceEvidence",
      "columnCountBasis",
    ]) {
      if (typeof paper[key] !== "string" || paper[key] === "") {
        errors.push(`${id}: ${key}`);
      }
    }
    if (!PUBLISHER_FAMILIES.includes(paper.publisher as PublisherFamily)) {
      errors.push(`${id}: publisher`);
    }
    if (
      !REDISTRIBUTABLE_LICENCES.includes(
        paper.licence as (typeof REDISTRIBUTABLE_LICENCES)[number],
      )
    ) {
      errors.push(`${id}: licence ${String(paper.licence)}`);
    }
    const doi = paper.doi;
    const otherId = paper.otherId;
    if (!(doi === null || (typeof doi === "string" && doi.startsWith("10.")))) {
      errors.push(`${id}: doi`);
    }
    if (!(otherId === null || typeof otherId === "string")) {
      errors.push(`${id}: otherId`);
    }
    if (doi === null && (otherId === null || otherId === "")) {
      errors.push(`${id}: neither a DOI nor another identifier`);
    }
    for (const key of ["preprint", "scanned"]) {
      if (typeof paper[key] !== "boolean") errors.push(`${id}: ${key}`);
    }
    if (![1, 2, null].includes(paper.columnCount as 1 | 2 | null)) {
      errors.push(`${id}: columnCount`);
    }
    if (paper.textFile !== `${TEXT_DIR}/${id}.txt`) {
      errors.push(`${id}: textFile`);
    }
    if (paper.labelsFile !== `${LABELS_DIR}/${id}.json`) {
      errors.push(`${id}: labelsFile`);
    }
    if (![true, false, null].includes(paper.hasImradStructure as boolean)) {
      errors.push(`${id}: hasImradStructure`);
    }
    const layout = paper.layout;
    if (!isRecord(layout)) {
      errors.push(`${id}: layout`);
    } else {
      if (![1, 2, null].includes(layout.columnsExpected as 1 | 2 | null)) {
        errors.push(`${id}: layout.columnsExpected`);
      }
      if (
        !["none", "arabic", "roman", "unknown"].includes(
          layout.headingNumbering as string,
        )
      ) {
        errors.push(`${id}: layout.headingNumbering`);
      }
      if (
        !Array.isArray(layout.notes) ||
        !layout.notes.every((n) => typeof n === "string")
      ) {
        errors.push(`${id}: layout.notes`);
      }
    }
  }
  return errors;
}

export async function readManifest(dir = IMRAD_DIR): Promise<Manifest> {
  const value: unknown = JSON.parse(
    await readFile(join(dir, MANIFEST_FILE), "utf8"),
  );
  const errors = validateManifest(value);
  if (errors.length > 0) {
    throw new Error(`manifest.json is invalid:\n  ${errors.join("\n  ")}`);
  }
  return value as Manifest;
}

/** A paper's committed text, read as bytes and decoded as UTF-8. */
export async function readText(id: string, dir = IMRAD_DIR): Promise<string> {
  return readFile(join(dir, TEXT_DIR, `${id}.txt`), "utf8");
}

// ---------------------------------------------------------------------------
// 5. The labels format
// ---------------------------------------------------------------------------

/** One ground-truth section boundary. */
export interface LabelledSection {
  /** UTF-16 offset of the heading's first character in the text file. */
  readonly start: number;
  /** The heading as it appears there: `text.startsWith(heading, start)`. */
  readonly heading: string;
  /** `ImradSection`s in {@link IMRAD_SECTIONS} order; `other` stands alone. */
  readonly labels: readonly ImradSection[];
  /** A candidate line the owner labelled, or a heading the owner added. */
  readonly origin: "candidate" | "owner-added";
}

/**
 * `labels/<id>.json`. A section runs from its `start` to the next section's
 * `start` (the last one to the end of the text); text before the first
 * section belongs to none.
 */
export interface LabelsFile {
  readonly schema: "imrad-labels-v1";
  readonly id: string;
  readonly textFile: string;
  /** SHA-256 of the text file the offsets index into. */
  readonly textSha256: string;
  readonly textChars: number;
  /** The owner's answer to "does this paper have IMRaD structure at all?". */
  readonly hasImradStructure: boolean;
  readonly sections: readonly LabelledSection[];
  readonly adjudication: {
    readonly by: "owner";
    /** Basename of the export the decisions were ingested from. */
    readonly source: string;
    /** The decision document's own timestamp, when it carries one. */
    readonly decidedAt: string | null;
  };
}

/** Is `start` at the beginning of a line, white space before it allowed? */
function atLineStart(text: string, start: number): boolean {
  for (let i = start - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "\n" || ch === "\f") return true;
    if (ch !== " " && ch !== "\t" && ch !== "\r") return false;
  }
  return true;
}

/**
 * Errors in one labels file against its text; empty when it is valid.
 * Offsets must be integers inside the text, **strictly increasing**, each at
 * the start of a line, each followed by its heading.
 */
export function validateLabels(
  value: unknown,
  id: string,
  text: string,
): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return [`${id}: not an object`];
  if (value.schema !== "imrad-labels-v1") errors.push(`${id}: schema`);
  if (value.id !== id) errors.push(`${id}: id ${String(value.id)}`);
  if (value.textFile !== `${TEXT_DIR}/${id}.txt`) {
    errors.push(`${id}: textFile`);
  }
  if (value.textSha256 !== sha256Hex(text)) {
    errors.push(`${id}: textSha256 does not match the text file`);
  }
  if (value.textChars !== text.length) errors.push(`${id}: textChars`);
  if (typeof value.hasImradStructure !== "boolean") {
    errors.push(`${id}: hasImradStructure must be true or false`);
  }
  const adjudication = value.adjudication;
  if (
    !isRecord(adjudication) ||
    adjudication.by !== "owner" ||
    typeof adjudication.source !== "string" ||
    !(
      adjudication.decidedAt === null ||
      typeof adjudication.decidedAt === "string"
    )
  ) {
    errors.push(`${id}: adjudication`);
  }
  if (!Array.isArray(value.sections)) return [...errors, `${id}: sections`];
  let previous = -1;
  for (const [i, section] of value.sections.entries()) {
    const at = `${id}: sections[${i}]`;
    if (!isRecord(section)) {
      errors.push(`${at}: not an object`);
      continue;
    }
    const { start, heading, labels, origin } = section;
    if (!isNonNegativeInteger(start) || start >= text.length) {
      errors.push(`${at}: start ${String(start)} is outside the text`);
      continue;
    }
    if (start <= previous) {
      errors.push(
        `${at}: start ${start} is not after the previous start ${previous}`,
      );
    }
    previous = start;
    if (!atLineStart(text, start)) {
      errors.push(`${at}: start ${start} is not at the start of a line`);
    }
    if (
      typeof heading !== "string" ||
      heading.trim() === "" ||
      heading !== heading.trim() ||
      /[\n\f]/u.test(heading)
    ) {
      errors.push(`${at}: heading must be one trimmed, non-empty line`);
    } else if (!text.startsWith(heading, start)) {
      errors.push(`${at}: the text at ${start} is not "${heading}"`);
    }
    if (origin !== "candidate" && origin !== "owner-added") {
      errors.push(`${at}: origin`);
    }
    if (!Array.isArray(labels) || labels.length === 0) {
      errors.push(`${at}: labels must be a non-empty array`);
      continue;
    }
    const order = labels.map((label) =>
      IMRAD_SECTIONS.indexOf(label as (typeof IMRAD_SECTIONS)[number]),
    );
    if (order.some((n) => n === -1)) {
      errors.push(`${at}: a label is not an ImradSection`);
    } else if (order.some((n, k) => k > 0 && n <= (order[k - 1] ?? -1))) {
      errors.push(`${at}: labels must be unique and in table order`);
    }
    if (labels.includes("other") && labels.length > 1) {
      errors.push(`${at}: "other" stands alone`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 6. Ingesting the owner's decisions
// ---------------------------------------------------------------------------

/**
 * One paper's document in the labelling page's database collection (doc id =
 * paper id), as the coordinator's page writes it:
 *
 * - `headings` — the owner's mark per candidate line: `{ offset, line, label }`
 *   with `offset` and `line` copied from `candidate-headings.json`. A
 *   candidate the owner left unmarked (absent, or `label` null) counts as
 *   `not-heading`.
 * - `added` — headings the list missed, by their exact line text: `{ line,
 *   label, occurrence? }`. `occurrence` (1-based) picks one when the text has
 *   several matching lines.
 * - `hasImradStructure` — `true` or `false`. While it is unset the paper is
 *   **pending** and no labels file is written for it.
 */
export interface DecisionDoc {
  readonly headings?: readonly {
    readonly offset: number;
    readonly line: string;
    readonly label?: OwnerLabel | null;
  }[];
  readonly added?: readonly {
    readonly line: string;
    readonly label: OwnerLabel;
    readonly occurrence?: number;
  }[];
  readonly hasImradStructure?: boolean | null;
  readonly updatedAt?: string;
}

/**
 * The export, keyed by paper id. Accepts the shapes a collection export
 * plausibly takes: an object keyed by doc id; an array of documents carrying
 * `id` / `doc_id` / `docId` / `_id` with the fields either inline or under
 * `data`; or either of those under a top-level `docs` / `documents` /
 * `items` / `rows`.
 */
export function readDecisionExport(value: unknown): Map<string, unknown> {
  const docs = new Map<string, unknown>();
  let body: unknown = value;
  if (isRecord(body)) {
    for (const key of ["docs", "documents", "items", "rows"]) {
      if (Array.isArray(body[key])) {
        body = body[key];
        break;
      }
    }
  }
  if (Array.isArray(body)) {
    for (const entry of body) {
      if (!isRecord(entry))
        throw new Error("export: an entry is not an object");
      const id = entry.id ?? entry.doc_id ?? entry.docId ?? entry._id;
      if (typeof id !== "string") throw new Error("export: an entry has no id");
      docs.set(id, isRecord(entry.data) ? entry.data : entry);
    }
  } else if (isRecord(body)) {
    for (const [id, doc] of Object.entries(body)) docs.set(id, doc);
  } else {
    throw new Error("export: neither an array nor an object");
  }
  return docs;
}

function isOwnerLabel(value: unknown): value is OwnerLabel {
  return OWNER_LABELS.includes(value as OwnerLabel);
}

/** Where an owner-added heading is in the text, by its exact line text. */
export function locateAddedLine(
  text: string,
  line: string,
  occurrence?: number,
): { readonly offset: number } | { readonly error: string } {
  const wanted = line.trim();
  if (wanted === "" || /[\n\f]/u.test(wanted)) {
    return { error: `"${line}" is not one non-empty line` };
  }
  const exact: number[] = [];
  const prefix: number[] = [];
  for (const { start, raw } of splitLines(text)) {
    const trimmed = raw.trim();
    const offset = start + (raw.length - raw.trimStart().length);
    if (trimmed === wanted) exact.push(offset);
    else if (
      trimmed.startsWith(wanted) &&
      /[\s.:;,—–-]/u.test(trimmed[wanted.length] ?? "")
    ) {
      prefix.push(offset);
    }
  }
  const matches = exact.length > 0 ? exact : prefix;
  if (matches.length === 0) return { error: `no line reads "${wanted}"` };
  if (occurrence === undefined) {
    if (matches.length > 1) {
      return {
        error: `${matches.length} lines read "${wanted}"; give an occurrence`,
      };
    }
    return { offset: matches[0] as number };
  }
  const hit = matches[occurrence - 1];
  return hit === undefined
    ? { error: `"${wanted}" has no occurrence ${occurrence}` }
    : { offset: hit };
}

export type IngestOutcome =
  | { readonly kind: "labels"; readonly labels: LabelsFile }
  | { readonly kind: "pending"; readonly reason: string }
  | { readonly kind: "invalid"; readonly errors: readonly string[] };

/** One paper's decisions → its labels file, or why there is none. */
export function decisionsToLabels(
  id: string,
  doc: unknown,
  text: string,
  candidates: PaperCandidates | undefined,
  source: string,
): IngestOutcome {
  if (doc === undefined) return { kind: "pending", reason: "no decisions" };
  if (!isRecord(doc))
    return { kind: "invalid", errors: [`${id}: not an object`] };
  if (typeof doc.hasImradStructure !== "boolean") {
    return { kind: "pending", reason: "hasImradStructure not set" };
  }
  const errors: string[] = [];
  if (candidates === undefined) {
    errors.push(`${id}: not in candidate-headings.json`);
  } else if (candidates.textSha256 !== sha256Hex(text)) {
    errors.push(
      `${id}: the text changed since candidate-headings.json was built; rebuild the page`,
    );
  }
  const byOffset = new Map<number, string>(
    (candidates?.candidates ?? []).map((c) => [c.offset, c.line]),
  );
  const sections: LabelledSection[] = [];
  const headings = doc.headings ?? [];
  if (!Array.isArray(headings)) errors.push(`${id}: headings`);
  for (const [i, entry] of (Array.isArray(headings)
    ? headings
    : []
  ).entries()) {
    const at = `${id}: headings[${i}]`;
    if (!isRecord(entry)) {
      errors.push(`${at}: not an object`);
      continue;
    }
    const { offset, line, label } = entry;
    if (label === undefined || label === null) continue;
    if (!isOwnerLabel(label)) {
      errors.push(`${at}: label ${String(label)}`);
      continue;
    }
    if (label === "not-heading") continue;
    if (!isNonNegativeInteger(offset) || typeof line !== "string") {
      errors.push(`${at}: offset and line`);
      continue;
    }
    if (byOffset.get(offset) !== line) {
      errors.push(`${at}: no candidate "${line}" at ${offset}`);
      continue;
    }
    sections.push({
      start: offset,
      heading: line,
      labels: OWNER_LABEL_SECTIONS[label],
      origin: "candidate",
    });
  }
  const added = doc.added ?? [];
  if (!Array.isArray(added)) errors.push(`${id}: added`);
  for (const [i, entry] of (Array.isArray(added) ? added : []).entries()) {
    const at = `${id}: added[${i}]`;
    if (!isRecord(entry) || typeof entry.line !== "string") {
      errors.push(`${at}: line`);
      continue;
    }
    const label = entry.label;
    if (!isOwnerLabel(label)) {
      errors.push(`${at}: label ${String(label)}`);
      continue;
    }
    if (label === "not-heading") continue;
    const occurrence = entry.occurrence;
    if (
      occurrence !== undefined &&
      !(isNonNegativeInteger(occurrence) && occurrence >= 1)
    ) {
      errors.push(`${at}: occurrence`);
      continue;
    }
    const found = locateAddedLine(text, entry.line, occurrence);
    if ("error" in found) {
      errors.push(`${at}: ${found.error}`);
      continue;
    }
    sections.push({
      start: found.offset,
      heading: entry.line.trim(),
      labels: OWNER_LABEL_SECTIONS[label],
      origin: "owner-added",
    });
  }
  sections.sort((a, b) => a.start - b.start);
  for (let k = 1; k < sections.length; k++) {
    if (sections[k]?.start === sections[k - 1]?.start) {
      errors.push(`${id}: two headings at offset ${sections[k]?.start}`);
    }
  }
  if (errors.length > 0) return { kind: "invalid", errors };
  const labels: LabelsFile = {
    schema: "imrad-labels-v1",
    id,
    textFile: `${TEXT_DIR}/${id}.txt`,
    textSha256: sha256Hex(text),
    textChars: text.length,
    hasImradStructure: doc.hasImradStructure,
    sections,
    adjudication: {
      by: "owner",
      source,
      decidedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
    },
  };
  const invalid = validateLabels(labels, id, text);
  return invalid.length > 0
    ? { kind: "invalid", errors: invalid }
    : { kind: "labels", labels };
}

// ---------------------------------------------------------------------------
// 7. Whole-directory checks (shared with the unit test)
// ---------------------------------------------------------------------------

/** Every problem in `test/fixtures/imrad/`; empty when the set is consistent. */
export async function validateFixtureSet(dir = IMRAD_DIR): Promise<string[]> {
  const errors: string[] = [];
  const manifest = await readManifest(dir);
  const ids = new Set(manifest.papers.map((p) => p.id));
  for (const paper of manifest.papers) {
    const textPath = join(dir, paper.textFile);
    if (!existsSync(textPath)) {
      errors.push(`${paper.id}: ${paper.textFile} is missing`);
      continue;
    }
    const bytes = await readFile(textPath);
    const metaPath = join(dir, TEXT_DIR, `${paper.id}${META_SUFFIX}`);
    if (!existsSync(metaPath)) {
      errors.push(`${paper.id}: sidecar missing`);
    } else {
      const meta: unknown = JSON.parse(await readFile(metaPath, "utf8"));
      const text = isRecord(meta) ? meta.text : undefined;
      if (!isRecord(text) || text.sha256 !== sha256Hex(bytes)) {
        errors.push(`${paper.id}: sidecar text.sha256 does not match`);
      }
    }
    const labelsPath = join(dir, paper.labelsFile);
    if (existsSync(labelsPath)) {
      const labels: unknown = JSON.parse(await readFile(labelsPath, "utf8"));
      errors.push(...validateLabels(labels, paper.id, bytes.toString("utf8")));
      if (
        isRecord(labels) &&
        labels.hasImradStructure !== paper.hasImradStructure
      ) {
        errors.push(`${paper.id}: manifest hasImradStructure differs`);
      }
    } else if (paper.hasImradStructure !== null) {
      errors.push(`${paper.id}: hasImradStructure set but no labels file`);
    }
  }
  const labelsDir = join(dir, LABELS_DIR);
  if (existsSync(labelsDir)) {
    for (const name of await readdir(labelsDir)) {
      if (name.startsWith(".")) continue;
      const id = name.replace(/\.json$/u, "");
      if (!name.endsWith(".json") || !ids.has(id)) {
        errors.push(`labels/${name}: not a paper of the manifest`);
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 8. extract — the Node half (the Zotero half is scripts/imrad-fixtures/)
// ---------------------------------------------------------------------------

/** `_log.txt` in the PDF folder: `<id> ok <status> <type> <bytes> <sha256 prefix>`. */
export function parseDownloadLog(
  log: string,
): Map<string, { bytes: number; sha256Prefix: string }> {
  const entries = new Map<string, { bytes: number; sha256Prefix: string }>();
  for (const line of log.split(/\r?\n/u)) {
    const m = /^(\S+) ok \d+ \S+ (\d+) ([0-9a-f]{8,64})$/u.exec(line.trim());
    if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
      entries.set(m[1], { bytes: Number(m[2]), sha256Prefix: m[3] });
    }
  }
  return entries;
}

/** Fields of the in-Zotero `<id>.run.json`. */
interface RunInfo {
  readonly zoteroVersion: string;
  readonly contentHash: string;
  readonly warnings: readonly string[];
  readonly diagnostics: Record<string, unknown>;
  readonly columns?: ColumnGeometry;
}

/** The command the child process runs: the scaffold harness, entries narrowed. */
const HARNESS = `
const { Config, Test } = await import("zotero-plugin-scaffold");
const ctx = await Config.loadConfig({ test: { watch: false, abortOnFail: false } });
ctx.test.entries = [process.env.RH_IMRAD_SPEC_DIR];
const tester = new Test(ctx);
process.on("SIGINT", tester.exit.bind(tester));
await tester.run();
`;

function runHarness(env: Record<string, string>): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", HARNESS],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, NODE_ENV: "test", ...env },
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

interface ExtractOptions {
  readonly pdfDir: string;
  readonly only: readonly string[] | null;
  readonly check: boolean;
  readonly keepWork: boolean;
}

async function packageVersion(): Promise<string> {
  const pkg: unknown = JSON.parse(
    await readFile(join(REPO_ROOT, "package.json"), "utf8"),
  );
  return isRecord(pkg) && typeof pkg.version === "string" ? pkg.version : "?";
}

async function extract(options: ExtractOptions): Promise<number> {
  const manifest = await readManifest();
  const papers = manifest.papers.filter(
    (p) => options.only === null || options.only.includes(p.id),
  );
  if (options.only !== null && papers.length !== options.only.length) {
    process.stderr.write("--only names an id the manifest does not have.\n");
    return 2;
  }
  const pdfDir = resolve(options.pdfDir);
  const fromRepo = relative(REPO_ROOT, pdfDir);
  if (
    fromRepo === "" ||
    (!fromRepo.startsWith("..") && !isAbsolute(fromRepo))
  ) {
    process.stderr.write("The PDF folder must be outside the repository.\n");
    return 2;
  }
  const log = parseDownloadLog(
    await readFile(join(pdfDir, "_log.txt"), "utf8"),
  );
  const pdfs = new Map<string, { bytes: number; sha256: string }>();
  for (const paper of papers) {
    const bytes = await readFile(join(pdfDir, `${paper.id}.pdf`));
    const sha256 = sha256Hex(bytes);
    const logged = log.get(paper.id);
    if (
      logged === undefined ||
      logged.bytes !== bytes.length ||
      !sha256.startsWith(logged.sha256Prefix) ||
      bytes.subarray(0, 5).toString("latin1") !== "%PDF-"
    ) {
      process.stderr.write(
        `${paper.id}.pdf does not match _log.txt (size, hash or header); refusing.\n`,
      );
      return 2;
    }
    pdfs.set(paper.id, { bytes: bytes.length, sha256 });
  }

  const work = await mkdtemp(join(tmpdir(), "rh-imrad-"));
  process.stdout.write(`Work directory: ${work}\n`);
  const code = await runHarness({
    RH_IMRAD_SPEC_DIR: SPEC_DIR,
    RH_IMRAD_IDS: papers.map((p) => p.id).join(","),
    RH_IMRAD_PDF_DIR: pdfDir,
    RH_IMRAD_WORK_DIR: work,
  });
  const missing = papers.filter(
    (p) =>
      !existsSync(join(work, `${p.id}.txt`)) ||
      !existsSync(join(work, `${p.id}.run.json`)),
  );
  if (code !== 0 || missing.length > 0) {
    process.stderr.write(
      `The Zotero run exited ${code}; no text for: ${missing.map((p) => p.id).join(", ") || "none"}. ` +
        `Nothing was written to the repository; the work directory is kept.\n`,
    );
    return 1;
  }

  if (options.check) {
    let differ = 0;
    for (const paper of papers) {
      const fresh = await readFile(join(work, `${paper.id}.txt`));
      const committedPath = join(IMRAD_DIR, paper.textFile);
      const committed = existsSync(committedPath)
        ? await readFile(committedPath)
        : null;
      const same = committed !== null && committed.equals(fresh);
      if (!same) differ++;
      process.stdout.write(
        `${paper.id}: ${same ? "identical" : "DIFFERS"} (${sha256Hex(fresh).slice(0, 16)})\n`,
      );
    }
    process.stdout.write(
      `${papers.length - differ} of ${papers.length} byte-identical.\n`,
    );
    if (!options.keepWork) await rm(work, { recursive: true, force: true });
    return differ === 0 ? 0 : 1;
  }

  const version = await packageVersion();
  const now = new Date().toISOString();
  await mkdir(join(IMRAD_DIR, TEXT_DIR), { recursive: true });
  const updated = new Map<string, ManifestPaper>();
  for (const paper of papers) {
    const bytes = await readFile(join(work, `${paper.id}.txt`));
    const run = JSON.parse(
      await readFile(join(work, `${paper.id}.run.json`), "utf8"),
    ) as RunInfo;
    const text = bytes.toString("utf8");
    const textSha = sha256Hex(bytes);
    const metaPath = join(IMRAD_DIR, TEXT_DIR, `${paper.id}${META_SUFFIX}`);
    let extractedAt = now;
    let tool: Record<string, unknown> = {
      script: SCRIPT,
      zotero: run.zoteroVersion,
      plugin: version,
      path: "acquireZoteroSource, Tier 2 (attachmentText, then cleanFullText); tryEuropePmc false; parent item without abstract",
    };
    if (existsSync(metaPath)) {
      const old: unknown = JSON.parse(await readFile(metaPath, "utf8"));
      if (
        isRecord(old) &&
        isRecord(old.text) &&
        old.text.sha256 === textSha &&
        typeof old.extractedAt === "string" &&
        isRecord(old.tool)
      ) {
        // Same bytes: keep the date and tool of the run that first made them.
        extractedAt = old.extractedAt;
        tool = old.tool;
      }
    }
    const columns = columnCountFromGeometry(run.columns);
    const pdf = pdfs.get(paper.id);
    const meta = {
      scenario: "imrad-fixture-text",
      id: paper.id,
      title: paper.title,
      venue: paper.venue,
      publisher: paper.publisher,
      layout: paper.layout,
      doi: paper.doi,
      otherId: paper.otherId,
      licence: paper.licence,
      licenceEvidence: paper.licenceEvidence,
      sourceUrl: paper.sourceUrl,
      landingUrl: paper.landingUrl,
      recordedAt: extractedAt,
      extractedAt,
      tool,
      pdf: { file: `${paper.id}.pdf`, bytes: pdf?.bytes, sha256: pdf?.sha256 },
      text: {
        file: `${paper.id}.txt`,
        bytes: bytes.length,
        chars: text.length,
        sha256: textSha,
        encoding:
          "UTF-8, no BOM; \\n line breaks and \\f page separators exactly as the cleaning pass left them",
      },
      extraction: {
        warnings: run.warnings,
        diagnostics: run.diagnostics,
        columnGeometry: run.columns ?? null,
      },
      redactions: [
        "none: the text is the paper's own published text under the licence above",
      ],
    };
    await writeFile(join(IMRAD_DIR, paper.textFile), bytes);
    await writeFile(metaPath, toJsonText(meta), "utf8");
    updated.set(paper.id, {
      ...paper,
      columnCount: columns,
      columnCountBasis:
        run.columns === undefined || columns === null
          ? "not observable: no body paragraphs in the structured document text"
          : `observed in the structured document text: ${run.columns.twoColumnPages} of ${run.columns.pagesWithBody} pages with body text are two-column`,
    });
    process.stdout.write(
      `${paper.id}: ${text.length} chars, columns ${String(columns)} (${JSON.stringify(run.columns ?? null)}), warnings ${run.warnings.join(",") || "none"}\n`,
    );
  }
  await writeFile(
    join(IMRAD_DIR, MANIFEST_FILE),
    toJsonText({
      ...manifest,
      papers: manifest.papers.map((p) => updated.get(p.id) ?? p),
    }),
    "utf8",
  );
  if (!options.keepWork) await rm(work, { recursive: true, force: true });
  return writeCandidates();
}

// ---------------------------------------------------------------------------
// 9. candidates, ingest, validate
// ---------------------------------------------------------------------------

async function writeCandidates(): Promise<number> {
  const manifest = await readManifest();
  const texts: { id: string; text: string }[] = [];
  for (const paper of manifest.papers) {
    if (!existsSync(join(IMRAD_DIR, paper.textFile))) continue;
    texts.push({ id: paper.id, text: await readText(paper.id) });
  }
  const file = buildCandidatesFile(texts);
  await writeFile(join(IMRAD_DIR, CANDIDATES_FILE), toJsonText(file), "utf8");
  for (const paper of file.papers) {
    process.stdout.write(
      `${paper.id}: ${paper.candidateCount} candidate lines of ${paper.lineCount}\n`,
    );
  }
  const total = file.papers.reduce((sum, p) => sum + p.candidateCount, 0);
  process.stdout.write(
    `Wrote ${CANDIDATES_FILE}: ${file.papers.length} papers, ${total} candidate lines.\n`,
  );
  return 0;
}

async function ingest(exportPath: string): Promise<number> {
  const manifest = await readManifest();
  const docs = readDecisionExport(
    JSON.parse(await readFile(resolve(exportPath), "utf8")),
  );
  const candidates = JSON.parse(
    await readFile(join(IMRAD_DIR, CANDIDATES_FILE), "utf8"),
  ) as CandidatesFile;
  const unknown = [...docs.keys()].filter(
    (id) => !manifest.papers.some((p) => p.id === id),
  );
  if (unknown.length > 0) {
    process.stderr.write(`The export has unknown ids: ${unknown.join(", ")}\n`);
    return 1;
  }
  const outcomes = new Map<string, IngestOutcome>();
  for (const paper of manifest.papers) {
    const text = await readText(paper.id);
    outcomes.set(
      paper.id,
      decisionsToLabels(
        paper.id,
        docs.get(paper.id),
        text,
        candidates.papers.find((p) => p.id === paper.id),
        basename(exportPath),
      ),
    );
  }
  const invalid = [...outcomes.values()].flatMap((o) =>
    o.kind === "invalid" ? o.errors : [],
  );
  if (invalid.length > 0) {
    process.stderr.write(
      `Nothing written; the export has problems:\n  ${invalid.join("\n  ")}\n`,
    );
    return 1;
  }
  await mkdir(join(IMRAD_DIR, LABELS_DIR), { recursive: true });
  const papers: ManifestPaper[] = [];
  for (const paper of manifest.papers) {
    const outcome = outcomes.get(paper.id);
    if (outcome?.kind === "labels") {
      await writeFile(
        join(IMRAD_DIR, paper.labelsFile),
        toJsonText(outcome.labels),
        "utf8",
      );
      papers.push({
        ...paper,
        hasImradStructure: outcome.labels.hasImradStructure,
      });
      process.stdout.write(
        `${paper.id}: ${outcome.labels.sections.length} sections, hasImradStructure ${String(outcome.labels.hasImradStructure)}\n`,
      );
    } else {
      papers.push(paper);
      process.stdout.write(
        `${paper.id}: pending (${outcome?.kind === "pending" ? outcome.reason : "?"})\n`,
      );
    }
  }
  await writeFile(
    join(IMRAD_DIR, MANIFEST_FILE),
    toJsonText({ ...manifest, papers }),
    "utf8",
  );
  return 0;
}

async function validate(): Promise<number> {
  const errors = await validateFixtureSet();
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    return 1;
  }
  process.stdout.write("test/fixtures/imrad/ is consistent.\n");
  return 0;
}

function argValue(args: readonly string[], name: string): string | null {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}

export async function main(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "extract": {
      const pdfDir = argValue(rest, "--pdf-dir");
      if (pdfDir === null) {
        process.stderr.write("extract needs --pdf-dir <folder>.\n");
        return 2;
      }
      if (!(await stat(pdfDir)).isDirectory()) return 2;
      const only = argValue(rest, "--only");
      return extract({
        pdfDir,
        only: only === null ? null : only.split(",").map((s) => s.trim()),
        check: rest.includes("--check"),
        keepWork: rest.includes("--keep-work"),
      });
    }
    case "candidates":
      return writeCandidates();
    case "ingest": {
      const file = rest[0];
      if (file === undefined) {
        process.stderr.write("ingest needs the export file.\n");
        return 2;
      }
      return ingest(file);
    }
    case "validate":
      return validate();
    default:
      process.stderr.write(
        "Usage: build-imrad-fixtures.ts extract --pdf-dir <folder> [--check] [--only A,B] [--keep-work] | candidates | ingest <export.json> | validate\n",
      );
      return 2;
  }
}

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
