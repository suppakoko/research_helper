/**
 * `scripts/measure-imrad.ts` — the IMRaD section detector's accuracy against
 * the owner's ground truth (`P3-T22`, risk `R-19b`, gate `G-22`).
 *
 * **What it measures.** For each of `P3-T20`'s 40 papers
 * (`test/fixtures/imrad/`), the detector runs on the committed text and every
 * counted character is scored against the owner's labels
 * (`labels/<id>.json`, `plan/00` §6 item 364). How a character is scored is
 * `docs/06` §4.3's note of 2026-11-10 (decided by the coordinator under item
 * 313), restated where each rule is coded below:
 *
 * - only the body counts: from the owner's first labelled start to the end of
 *   the text (the abstract preamble before it does not);
 * - the detector's labels are read in the owner's vocabulary
 *   ({@link SCORE_CLASS});
 * - a character is correct only when the two label sets are **equal**, so a
 *   "Results and discussion" section needs both labels;
 * - `other` counts both ways; a declared failure (`sectionAware: false`)
 *   scores zero;
 * - figures are pooled over characters; papers whose `hasImradStructure` is
 *   false are scored the same way and reported separately, never pooled.
 *
 * **What runs.** The fixtures are text only — no document structure was saved
 * with them — so the detector is `detectSectionsFromPdf(text, null)`
 * ({@link DETECTOR_WITHOUT_STRUCTURE}): the PDF path as it runs whenever no
 * structure is read. The outline path is not measured here.
 *
 * **What it prints.** The overall figure against `IMRAD_ACCURACY_BAR`, three
 * breakdowns (publisher family, column count, preprint or published), the
 * excluded papers, every paper, the comparison with the recorded value
 * (`IMRAD_MEASUREMENT` in `src/pipeline/summarize/imrad.ts`), and — for
 * information only — the "table ceiling": what §4.3's heading table gives
 * when it is handed the owner's own heading positions. As Markdown tables, so
 * `docs/spikes/imrad-accuracy-report.md` can carry them as printed.
 *
 * **Which set (`P3-T40`).** `--set first` (the default) is `P3-T20`'s 40
 * papers, and everything above is about it. `--set heldout` is the held-out
 * set in `test/fixtures/imrad-heldout/` (`plan/00` §6 item 374), and it is
 * **sealed**: this script refuses it, before reading any of it and before any
 * detector runs, unless {@link FINAL_HELDOUT_FLAG} is also given. **That flag
 * may be used only by `P3-T41`, once, after its detector change is
 * committed**; a second run on the same held-out set needs the owner's
 * decision. Under the flag the held-out figure is printed against the bar
 * and is not checked against `IMRAD_MEASUREMENT`, which records the first
 * set.
 *
 * **Exit status.** 0 at or above the bar and not below the recorded value; 1
 * below either; 2 when the corpus is missing or empty, a labels file does
 * not validate against its text, or the arguments are wrong; 3 when the
 * held-out set is asked for without {@link FINAL_HELDOUT_FLAG}. Since
 * `P3-T41` the detector is tuned against the first set, so 0 on the first set
 * is a regression pass, not validation: `IMRAD_DETECTOR_VALIDATED` derives
 * only from the held-out record (`detectorValidatedBy` in
 * `src/pipeline/summarize/imrad.ts`).
 *
 * **Callers.** Run by hand (`npx tsx scripts/measure-imrad.ts`), and imported
 * by `test/unit/pipeline/imradAccuracy.test.ts`, the regression test, and by
 * `test/unit/pipeline/imradHeldout.test.ts`, which tests the refusal.
 *
 * It never writes a file, never changes a label, and never calls a model.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ImradSection } from "../src/model/summary";
import {
  detectSectionsFromPdf,
  IMRAD_ACCURACY_BAR,
  IMRAD_MEASUREMENT,
  labelHeading,
  type ImradMeasurement,
  type SectionDetection,
} from "../src/pipeline/summarize/imrad";

import {
  FIXTURE_SETS,
  fixtureSetFromArgs,
  IMRAD_DIR,
  LABELS_DIR,
  MANIFEST_FILE,
  readManifest,
  readText,
  TEXT_DIR,
  validateLabels,
  type FixtureSet,
  type LabelledSection,
  type LabelsFile,
  type ManifestPaper,
} from "./build-imrad-fixtures";

// ---------------------------------------------------------------------------
// The owner's vocabulary
// ---------------------------------------------------------------------------

/** The classes the owner labels with (`plan/00` §6 item 364(a)). */
export const SCORE_CLASSES = [
  "introduction",
  "methods",
  "results",
  "discussion",
  "other",
] as const;
export type ScoreClass = (typeof SCORE_CLASSES)[number];

/**
 * The detector's labels read in the owner's vocabulary (§4.3's note of
 * 2026-11-10, (3)): Background and related work are introduction (item
 * 364(a), (e)); Conclusions is other (364(a)); limitations and abstract are
 * not owner section starts, so other.
 */
export const SCORE_CLASS: Readonly<Record<ImradSection, ScoreClass>> = {
  abstract: "other",
  introduction: "introduction",
  background: "introduction",
  related_work: "introduction",
  methods: "methods",
  results: "results",
  discussion: "discussion",
  conclusion: "other",
  limitations: "other",
  other: "other",
};

/**
 * One label set as a comparable key in the owner's vocabulary, e.g.
 * `"results+discussion"`. `other` is dropped beside a main class (no detector
 * row or owner label combines them), and an empty set is `other`.
 */
export function scoreKey(labels: readonly ImradSection[]): string {
  const classes = new Set(labels.map((label) => SCORE_CLASS[label]));
  if (classes.size > 1) classes.delete("other");
  const key = SCORE_CLASSES.filter((c) => classes.has(c)).join("+");
  return key === "" ? "other" : key;
}

// ---------------------------------------------------------------------------
// Spans and the per-character score
// ---------------------------------------------------------------------------

/** `[start, end)` of the text carrying one label key. */
export interface Span {
  readonly start: number;
  readonly end: number;
  readonly key: string;
}

/**
 * The owner's sections as spans: each from its start to the next start, the
 * last to the end of the text. The preamble before the first start is no
 * span, so it is never counted (§4.3's note of 2026-11-10, (1)).
 */
export function truthSpans(
  labels: {
    readonly sections: readonly Pick<LabelledSection, "start" | "labels">[];
  },
  textLength: number,
): Span[] {
  return labels.sections.map((section, i) => ({
    start: section.start,
    end: labels.sections[i + 1]?.start ?? textLength,
    key: scoreKey(section.labels),
  }));
}

/** What a detector answers, as far as scoring needs it. */
export type DetectorAnswer = Pick<
  SectionDetection,
  "sections" | "sectionAware" | "recognized"
>;

/**
 * The detector's sections as spans. A declared failure has none, so none of
 * the paper's characters is attributed (§4.3's note of 2026-11-10, (6)).
 */
export function detectedSpans(answer: DetectorAnswer): Span[] {
  if (!answer.sectionAware) return [];
  return answer.sections.map((section) => ({
    start: section.start,
    end: section.end,
    key: scoreKey(section.labels),
  }));
}

function sortedSpans(spans: readonly Span[]): Span[] {
  return [...spans].sort((a, b) => a.start - b.start);
}

/**
 * Characters inside a truth span that a detected span covers with an
 * **equal** key (§4.3's note of 2026-11-10, (4), (5)). Both span lists must
 * be free of overlaps within themselves.
 */
export function correctCharacters(
  truth: readonly Span[],
  detected: readonly Span[],
): number {
  const t = sortedSpans(truth);
  const d = sortedSpans(detected);
  let correct = 0;
  let j = 0;
  for (const span of t) {
    while (j < d.length && (d[j] as Span).end <= span.start) j += 1;
    for (let k = j; k < d.length; k += 1) {
      const other = d[k] as Span;
      if (other.start >= span.end) break;
      if (other.key !== span.key) continue;
      correct +=
        Math.min(span.end, other.end) - Math.max(span.start, other.start);
    }
  }
  return correct;
}

/** Characters the truth spans count. */
export function countedCharacters(truth: readonly Span[]): number {
  return truth.reduce((sum, span) => sum + (span.end - span.start), 0);
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** One fixture paper with its text and the owner's labels. */
export interface CorpusPaper {
  readonly paper: ManifestPaper;
  readonly text: string;
  readonly labels: LabelsFile;
}

/**
 * Why the corpus is absent, or `null` when it is there: the manifest, the
 * text folder and the labels folder must exist. Synchronous, so a test can
 * skip with this as its reported reason. A corpus that is there but
 * incomplete is not "absent": {@link loadCorpus} refuses it, and the test
 * fails.
 */
export function corpusAbsentReason(dir = IMRAD_DIR): string | null {
  for (const path of [
    join(dir, MANIFEST_FILE),
    join(dir, TEXT_DIR),
    join(dir, LABELS_DIR),
  ]) {
    if (!existsSync(path)) return `no ${path}`;
  }
  return null;
}

/**
 * Every paper of the fixture set, each labels file validated against its
 * text (hash, length, offsets at line starts). Throws, listing every
 * problem, when a paper has no labels or a labels file does not validate.
 */
export async function loadCorpus(dir = IMRAD_DIR): Promise<CorpusPaper[]> {
  const manifest = await readManifest(dir);
  const problems: string[] = [];
  const corpus: CorpusPaper[] = [];
  for (const paper of manifest.papers) {
    if (paper.hasImradStructure === null) {
      problems.push(`${paper.id}: not labelled yet (hasImradStructure null)`);
      continue;
    }
    const labelsPath = join(dir, paper.labelsFile);
    if (!existsSync(labelsPath)) {
      problems.push(`${paper.id}: no ${paper.labelsFile}`);
      continue;
    }
    const text = await readText(paper.id, dir);
    const value: unknown = JSON.parse(await readFile(labelsPath, "utf8"));
    const errors = validateLabels(value, paper.id, text);
    if (errors.length > 0) {
      problems.push(...errors);
      continue;
    }
    const labels = value as LabelsFile;
    if (labels.hasImradStructure !== paper.hasImradStructure) {
      problems.push(`${paper.id}: manifest and labels disagree`);
      continue;
    }
    corpus.push({ paper, text, labels });
  }
  if (problems.length > 0) {
    throw new Error(
      `the IMRaD corpus cannot be measured:\n  ${problems.join("\n  ")}`,
    );
  }
  return corpus;
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/** A section detector over one paper's text. */
export type Detector = (text: string) => DetectorAnswer;

/**
 * §4.3's PDF path with no document structure — all the committed fixtures
 * allow, and the detector's whole behaviour whenever no structure is read.
 */
export const DETECTOR_WITHOUT_STRUCTURE: Detector = (text) =>
  detectSectionsFromPdf(text, null);

/** One paper's score. */
export interface PaperScore {
  readonly id: string;
  readonly family: string;
  readonly columns: string;
  readonly publication: "preprint" | "published";
  readonly hasImradStructure: boolean;
  readonly counted: number;
  readonly correct: number;
  readonly sectionAware: boolean;
  readonly recognized: number;
}

/** Pooled figures over a group of papers. */
export interface GroupScore {
  readonly group: string;
  readonly papers: number;
  readonly counted: number;
  readonly correct: number;
  /** `correct ÷ counted`, the gating figure. */
  readonly accuracy: number;
  /** The mean of the papers' own figures, for information only. */
  readonly meanOfPapers: number;
}

/** What {@link measureCorpus} returns. */
export interface Measurement {
  /** The papers whose `hasImradStructure` is true, pooled. */
  readonly overall: GroupScore;
  readonly byFamily: readonly GroupScore[];
  readonly byColumns: readonly GroupScore[];
  readonly byPublication: readonly GroupScore[];
  /** The `hasImradStructure: false` papers, pooled — reported, never gating. */
  readonly excluded: GroupScore;
  /** Every paper, counted and excluded, in manifest order. */
  readonly papers: readonly PaperScore[];
}

function columnsOf(paper: ManifestPaper): string {
  if (paper.columnCount === 1) return "1 column";
  if (paper.columnCount === 2) return "2 columns";
  return "unknown";
}

/** Score one paper. */
export function scorePaper(entry: CorpusPaper, detector: Detector): PaperScore {
  const truth = truthSpans(entry.labels, entry.text.length);
  const answer = detector(entry.text);
  return {
    id: entry.paper.id,
    family: entry.paper.publisher,
    columns: columnsOf(entry.paper),
    publication: entry.paper.preprint ? "preprint" : "published",
    hasImradStructure: entry.labels.hasImradStructure,
    counted: countedCharacters(truth),
    correct: correctCharacters(truth, detectedSpans(answer)),
    sectionAware: answer.sectionAware,
    recognized: answer.recognized,
  };
}

function ratio(correct: number, counted: number): number {
  return counted === 0 ? 0 : correct / counted;
}

/** Pool `scores` into one group (character-weighted). */
export function pool(group: string, scores: readonly PaperScore[]): GroupScore {
  const counted = scores.reduce((sum, s) => sum + s.counted, 0);
  const correct = scores.reduce((sum, s) => sum + s.correct, 0);
  const meanOfPapers =
    scores.length === 0
      ? 0
      : scores.reduce((sum, s) => sum + ratio(s.correct, s.counted), 0) /
        scores.length;
  return {
    group,
    papers: scores.length,
    counted,
    correct,
    accuracy: ratio(correct, counted),
    meanOfPapers,
  };
}

function groupBy(
  scores: readonly PaperScore[],
  keyOf: (score: PaperScore) => string,
): GroupScore[] {
  const groups = new Map<string, PaperScore[]>();
  for (const score of scores) {
    const key = keyOf(score);
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }
  return [...groups.entries()].map(([key, members]) => pool(key, members));
}

/** Pool scored papers into the overall figure, the breakdowns and the excluded group. */
function poolPapers(papers: readonly PaperScore[]): Measurement {
  const counted = papers.filter((p) => p.hasImradStructure);
  const excluded = papers.filter((p) => !p.hasImradStructure);
  return {
    overall: pool("overall", counted),
    byFamily: groupBy(counted, (p) => p.family),
    byColumns: groupBy(counted, (p) => p.columns),
    byPublication: groupBy(counted, (p) => p.publication),
    excluded: pool("excluded", excluded),
    papers,
  };
}

/** Score every paper and pool them (module note). */
export function measureCorpus(
  corpus: readonly CorpusPaper[],
  detector: Detector = DETECTOR_WITHOUT_STRUCTURE,
): Measurement {
  return poolPapers(corpus.map((entry) => scorePaper(entry, detector)));
}

/**
 * For information only, never gating: what §4.3's heading table gives when it
 * is handed the owner's own heading positions — each owner heading labelled
 * by `labelHeading`, an unlabelled one read as other, no two-section gate.
 * It shows how much of the shortfall is the table's vocabulary rather than
 * where headings are found. It is not a bound on the outline path.
 */
export function tableCeiling(corpus: readonly CorpusPaper[]): Measurement {
  const atOwnerPositions =
    (entry: CorpusPaper): Detector =>
    () => ({
      sectionAware: true,
      recognized: 0,
      sections: entry.labels.sections.map((section, i) => {
        const end = entry.labels.sections[i + 1]?.start ?? entry.text.length;
        const labels = labelHeading(section.heading) ?? (["other"] as const);
        return {
          imrad: labels[0] ?? "other",
          labels,
          heading: section.heading,
          text: entry.text.slice(section.start, end),
          start: section.start,
          end,
        };
      }),
    });
  return poolPapers(
    corpus.map((entry) => scorePaper(entry, atOwnerPositions(entry))),
  );
}

// ---------------------------------------------------------------------------
// The bar and the recorded value
// ---------------------------------------------------------------------------

/** `true` when `group` is at or above `IMRAD_ACCURACY_BAR`. */
export function meetsBar(
  group: Pick<GroupScore, "correct" | "counted">,
): boolean {
  return group.correct >= IMRAD_ACCURACY_BAR * group.counted;
}

/**
 * The regression check: the measurement covers the recorded corpus (same
 * papers, same counted characters) and its accuracy is not below the
 * recorded one. Compared in whole characters, so no rounding is involved.
 */
export function checkAgainstRecord(
  measurement: Measurement,
  record: ImradMeasurement = IMRAD_MEASUREMENT,
): { readonly ok: boolean; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const { overall } = measurement;
  if (overall.papers !== record.papers) {
    problems.push(
      `${String(overall.papers)} papers counted, ${String(record.papers)} recorded`,
    );
  }
  if (overall.counted !== record.countedChars) {
    problems.push(
      `${String(overall.counted)} characters counted, ${String(record.countedChars)} recorded`,
    );
  }
  if (
    overall.correct * record.countedChars <
    record.correctChars * overall.counted
  ) {
    problems.push(
      `accuracy ${percent(overall.accuracy)} is below the recorded ${percent(
        ratio(record.correctChars, record.countedChars),
      )}`,
    );
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** A ratio as a percentage with two decimals. */
export function percent(value: number): string {
  return `${(100 * value).toFixed(2)} %`;
}

function groupTable(title: string, groups: readonly GroupScore[]): string[] {
  return [
    `| ${title} | Papers | Counted characters | Correct characters | Accuracy | Mean of papers |`,
    "|---|---:|---:|---:|---:|---:|",
    ...groups.map(
      (g) =>
        `| ${g.group} | ${String(g.papers)} | ${String(g.counted)} | ${String(g.correct)} | ${percent(g.accuracy)} | ${percent(g.meanOfPapers)} |`,
    ),
  ];
}

function paperTable(scores: readonly PaperScore[]): string[] {
  return [
    "| Paper | Family | Columns | Publication | IMRaD structure | Counted | Correct | Accuracy | sectionAware | Recognized |",
    "|---|---|---|---|---|---:|---:|---:|---|---:|",
    ...scores.map(
      (s) =>
        `| ${s.id} | ${s.family} | ${s.columns} | ${s.publication} | ${String(s.hasImradStructure)} | ${String(s.counted)} | ${String(s.correct)} | ${percent(ratio(s.correct, s.counted))} | ${String(s.sectionAware)} | ${String(s.recognized)} |`,
    ),
  ];
}

/**
 * The whole printout, as Markdown. `record` is the value the run is checked
 * against; `null` (the held-out set) prints no such check. `setPath` names the
 * measured set's directory.
 */
export function formatMeasurement(
  measurement: Measurement,
  ceiling: Measurement,
  record: ImradMeasurement | null = IMRAD_MEASUREMENT,
  setPath: string = FIXTURE_SETS.first.path,
): string {
  const { overall } = measurement;
  const recordLine =
    record === null ? [] : ["", recordSentence(measurement, record)];
  return [
    `Detector: detectSectionsFromPdf(text, null), the PDF path with no document structure, over ${TEXT_DIR}/ in ${setPath}.`,
    "",
    `**Overall: ${percent(overall.accuracy)}** (${String(overall.correct)} of ${String(overall.counted)} counted characters, ${String(overall.papers)} papers with IMRaD structure) against the bar of ${percent(IMRAD_ACCURACY_BAR)}: ${meetsBar(overall) ? "MEETS the bar" : "BELOW the bar"}. Mean of the papers' own figures: ${percent(overall.meanOfPapers)} (information only).`,
    "",
    ...groupTable("Publisher family", measurement.byFamily),
    "",
    ...groupTable("Column count", measurement.byColumns),
    "",
    ...groupTable("Publication", measurement.byPublication),
    "",
    `Excluded (hasImradStructure false), scored the same way and not pooled: ${percent(measurement.excluded.accuracy)} over ${String(measurement.excluded.papers)} papers (${String(measurement.excluded.correct)} of ${String(measurement.excluded.counted)} characters).`,
    "",
    ...paperTable(measurement.papers),
    "",
    `Table ceiling (information only, not a bound): §4.3's heading table at the owner's own heading positions gives ${percent(ceiling.overall.accuracy)} overall (${String(ceiling.overall.correct)} of ${String(ceiling.overall.counted)}). Per paper: ${ceiling.papers
      .filter((p) => p.hasImradStructure)
      .map((p) => `${p.id} ${percent(ratio(p.correct, p.counted))}`)
      .join(", ")}.`,
    ...recordLine,
  ].join("\n");
}

/** The closing sentence comparing a run with the recorded value. */
function recordSentence(
  measurement: Measurement,
  record: ImradMeasurement,
): string {
  const check = checkAgainstRecord(measurement, record);
  // `P3-T41`: the detector is tuned against the first set, so its figure is a
  // regression pin and validates nothing (`detectorValidatedBy`).
  const tuned =
    record.set === "first"
      ? " The detector is tuned against this set, so this figure overstates real accuracy and does not validate it: IMRAD_DETECTOR_VALIDATED derives only from the held-out record."
      : "";
  return `Recorded value (IMRAD_MEASUREMENT, ${record.measuredOn}): ${String(record.correctChars)} of ${String(record.countedChars)} characters over ${String(record.papers)} papers, ${percent(ratio(record.correctChars, record.countedChars))}. ${check.ok ? "This run is not below it." : `This run fails the regression check: ${check.problems.join("; ")}.`}${tuned}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The one flag that unseals the held-out set (module note, "Which set"). Only
 * `P3-T41` uses it, once, after its detector change is committed.
 */
export const FINAL_HELDOUT_FLAG = "--final-heldout-measurement";

/** Exit status when the held-out set is asked for without the flag. */
export const SEALED_EXIT = 3;

/** What a command line asks for: a set to measure, or a refusal. */
export type MeasureRequest =
  | {
      readonly kind: "measure";
      readonly set: FixtureSet;
      /** `true` only for the held-out set under {@link FINAL_HELDOUT_FLAG}. */
      readonly final: boolean;
    }
  | { readonly kind: "refuse"; readonly code: number; readonly reason: string };

/**
 * Reads the arguments, nothing else: no file is opened and no detector runs,
 * so a refusal here is a refusal before the held-out set is touched.
 */
export function measureRequest(args: readonly string[]): MeasureRequest {
  const set = fixtureSetFromArgs(args);
  if (typeof set === "string") return { kind: "refuse", code: 2, reason: set };
  const known = new Set(["--set", set.name, FINAL_HELDOUT_FLAG]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    return {
      kind: "refuse",
      code: 2,
      reason: `unknown arguments: ${unknown.join(" ")}`,
    };
  }
  const final = args.includes(FINAL_HELDOUT_FLAG);
  if (set.name === "heldout" && !final) {
    return {
      kind: "refuse",
      code: SEALED_EXIT,
      reason: `the held-out set (${set.path}) is sealed: it is measured once, by P3-T41 after its detector change is committed, with ${FINAL_HELDOUT_FLAG}. Nothing was read and no detector ran.`,
    };
  }
  if (set.name !== "heldout" && final) {
    return {
      kind: "refuse",
      code: 2,
      reason: `${FINAL_HELDOUT_FLAG} applies only to --set heldout`,
    };
  }
  return { kind: "measure", set, final };
}

/** What {@link main} can be given instead of the defaults, for tests. */
export interface MainOptions {
  /** The detector to measure; {@link DETECTOR_WITHOUT_STRUCTURE} by default. */
  readonly detector?: Detector;
  /** The directory a set is read from; the set's own by default. */
  readonly dirFor?: (set: FixtureSet) => string;
}

/** Measure and print; the exit status is the module note's. */
export async function main(
  args: readonly string[] = [],
  options: MainOptions = {},
): Promise<number> {
  const request = measureRequest(args);
  if (request.kind === "refuse") {
    process.stderr.write(`measure-imrad: ${request.reason}\n`);
    return request.code;
  }
  const { set, final } = request;
  const dir = options.dirFor?.(set) ?? set.dir;
  const absent = corpusAbsentReason(dir);
  if (absent !== null) {
    process.stderr.write(`measure-imrad: the corpus is absent: ${absent}\n`);
    return 2;
  }
  let corpus: CorpusPaper[];
  try {
    corpus = await loadCorpus(dir);
  } catch (error) {
    process.stderr.write(
      `measure-imrad: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  if (final && corpus.length === 0) {
    process.stderr.write(
      `measure-imrad: the held-out set (${set.path}) has no papers to measure.\n`,
    );
    return 2;
  }
  const measurement = measureCorpus(
    corpus,
    options.detector ?? DETECTOR_WITHOUT_STRUCTURE,
  );
  if (final) {
    process.stdout.write(
      `FINAL held-out measurement (${FINAL_HELDOUT_FLAG}, ${new Date().toISOString()}): record this figure with its date and set; a second run on this set needs the owner's decision.\n\n`,
    );
    process.stdout.write(
      `${formatMeasurement(measurement, tableCeiling(corpus), null, set.path)}\n`,
    );
    return meetsBar(measurement.overall) ? 0 : 1;
  }
  process.stdout.write(
    `${formatMeasurement(measurement, tableCeiling(corpus))}\n`,
  );
  const ok =
    meetsBar(measurement.overall) && checkAgainstRecord(measurement).ok;
  return ok ? 0 : 1;
}

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
