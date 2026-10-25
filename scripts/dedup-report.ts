/**
 * `scripts/dedup-report.ts` — `npm run dedup:report` (`P2-T13` step 4).
 *
 * Runs the shipped dedup engine over the records behind a **labelled**
 * `test/fixtures/dedup/pairs.jsonl` and prints precision, recall, F1, the
 * full confusion matrix, and every false positive with its tier and score.
 *
 * **It measures only against a human's labels.** On a file with an unlabelled
 * pair it says so and exits 1 without running the engine, because a number
 * computed over a partial or empty label set is not the measurement `docs/11`
 * §1 asks for. `--allow-partial` measures the labelled subset for a progress
 * check and says so in the first line it prints.
 *
 * **What counts as a merge.** The engine runs once over the whole record pool
 * (the same pool `scripts/build-dedup-corpus.ts` built the pairs from), and a
 * pair is *merged* when `dedupeRecords` put both records in one group —
 * directly or through a third record, because a transitive merge loses a
 * record just as surely. A pair in `links` is *linked*, one in `flags` is
 * *flagged*, anything else *distinct*. The positive class is `duplicate`:
 *
 * - a merged pair labelled `not-duplicate` **or `linked-version`** is a false
 *   positive — merging a preprint into its published version is the false
 *   merge `G-16` rules out;
 * - a linked pair labelled `linked-version` is **not** a true positive — the
 *   card's Do NOT keeps it out of the precision numerator; it has its own row;
 * - a flagged pair is not merged (FR-50 scenario 4), so a flagged true
 *   duplicate is a false negative for recall, and is listed as such.
 *
 * **It measures the label set only** (owner's decision of 2026-10-16,
 * `plan/00` §6 item 223). A row with `labelSet: false` was sampled out of one
 * of the two big Crossref clusters by `scripts/build-dedup-corpus.ts`
 * (section 4b there): it is neither required to carry a label nor measured,
 * even when it carries one, and the report prints how many rows were sampled
 * out. A row with no `labelSet` member (a file written before the sampling)
 * counts as in the label set.
 *
 * The targets are `docs/11` §1's Phase 2 definition of done: precision ≥ 0.99,
 * recall ≥ 0.90. The report states whether they are met and exits 0 either way:
 * the blocking gate is `P2-T13` Part B's accuracy test, not this printer.
 *
 * **It measures the owner's sample by default** (owner's decision of
 * 2026-10-25, `plan/00` §6 item 284(c), `docs/02` §11.3): only the labelled
 * pairs among the 60 of `test/fixtures/dedup/label-sample.json`
 * (`scripts/dedup-label-sample.ts` drew them), and it states precision and
 * recall each with a 95 % Wilson score interval ({@link wilsonInterval}). A
 * target is met when the whole interval is at or above it, not met when the
 * whole interval is below it, and otherwise the report says plainly that the
 * interval is too wide to decide ({@link judgeTarget}). `--full` measures
 * every labelled label-set pair as before, and prints the interval beside the
 * point verdict.
 *
 * ```sh
 * npm run dedup:report                                   # the owner's sample of the committed corpus
 * npm run dedup:report -- --full                         # every labelled label-set pair
 * npm run dedup:report -- path/to/pairs.jsonl            # another labelled file
 * npm run dedup:report -- --sample=path/to/sample.json   # another sample file
 * npm run dedup:report -- --allow-partial                # progress while labelling
 * ```
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SourceRecord } from "../src/model/sourceRecord";
import {
  compareRecords,
  dedupeRecords,
  JACCARD_CORROBORATED_THRESHOLD,
  JACCARD_REORDER_THRESHOLD,
  LEVSIM_CORROBORATED_THRESHOLD,
  LEVSIM_DUPLICATE_THRESHOLD,
  LEVSIM_FLAG_THRESHOLD,
  MAX_YEAR_DELTA,
  MIN_FUZZY_TITLE_TOKENS,
  SIGNATURE_TOKEN_COUNT,
  type DedupDecision,
  type DedupResult,
} from "../src/sources/shared/dedupe";
import {
  DEDUP_CORPUS_DIR,
  loadCorpusRecords,
  PAIR_LABELS,
  PAIRS_FILE,
  parseJsonl,
  type PairLabel,
  type PairRow,
} from "./build-dedup-corpus";

/** `docs/11` §1 Phase 2 definition of done: "precision ≥ 0.99". */
export const PRECISION_TARGET = 0.99;
/** `docs/11` §1 Phase 2 definition of done: "recall ≥ 0.90". */
export const RECALL_TARGET = 0.9;

/** What the engine did with one pair. */
export const PREDICTIONS = ["merged", "linked", "flagged", "distinct"] as const;
export type Prediction = (typeof PREDICTIONS)[number];

/** One labelled pair, with the engine's outcome. */
export interface ScoredPair {
  readonly row: PairRow;
  readonly label: PairLabel;
  readonly predicted: Prediction;
  /** `compareRecords` on the two records alone: the tier and score that spoke. */
  readonly direct: DedupDecision;
  /** `true` when merged only through a third record. */
  readonly transitive: boolean;
}

/** The measurement. `null` when a ratio's denominator is zero. */
export interface DedupMetrics {
  readonly matrix: Readonly<
    Record<PairLabel, Readonly<Record<Prediction, number>>>
  >;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1: number | null;
  readonly scored: readonly ScoredPair[];
}

/** Is this row in the owner's label set? A row from before the sampling is. */
export function inLabelSet(row: PairRow): boolean {
  return (row as { readonly labelSet?: boolean }).labelSet !== false;
}

/** One line naming how many rows were sampled out, per cluster. */
export function sampledOutLine(rows: readonly PairRow[]): string {
  const out = rows.filter((r) => !inLabelSet(r));
  const byCluster = new Map<string, number>();
  for (const r of out) {
    const c = r.sampleCluster ?? "unnamed";
    byCluster.set(c, (byCluster.get(c) ?? 0) + 1);
  }
  const parts = [...byCluster]
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([c, n]) => `${c} ${String(n)}`);
  return (
    `Sampled out of the label set (owner, 2026-10-16): ${String(out.length)} ` +
    `of ${String(rows.length)} pairs, not measured` +
    (parts.length > 0 ? ` (${parts.join(", ")})` : "")
  );
}

/** The four-way pair key a `DedupPair` lands under. */
function keyOf(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/**
 * Index one engine run so that a pair's outcome can be read off it: *merged*
 * when both records sit in one group (directly or through a third record),
 * else *linked* when the pair is in `links`, else *flagged* when it is in
 * `flags`, else *distinct*. {@link computeMetrics} and
 * `scripts/dedup-label-sample.ts`'s stratification both read outcomes here,
 * so the strata are the report's own columns.
 */
export function outcomeIndex(
  result: DedupResult,
): (aId: string, bId: string) => Prediction {
  const groupOf = new Map<string, number>();
  result.groups.forEach((g, i) => {
    for (const r of g.records) groupOf.set(r.id, i);
  });
  const links = new Set(result.links.map((p) => keyOf(p.a.id, p.b.id)));
  const flags = new Set(result.flags.map((p) => keyOf(p.a.id, p.b.id)));
  return (aId, bId) => {
    const k = keyOf(aId, bId);
    const ga = groupOf.get(aId);
    return ga !== undefined && ga === groupOf.get(bId)
      ? "merged"
      : links.has(k)
        ? "linked"
        : flags.has(k)
          ? "flagged"
          : "distinct";
  };
}

/**
 * Score labelled rows against one engine run.
 *
 * @param rows - labelled rows; an unlabelled one throws
 * @param records - the pool, by record id
 * @param result - `dedupeRecords` over that pool
 */
export function computeMetrics(
  rows: readonly PairRow[],
  records: ReadonlyMap<string, SourceRecord>,
  result: DedupResult,
): DedupMetrics {
  const outcomeOf = outcomeIndex(result);

  const matrix = Object.fromEntries(
    PAIR_LABELS.map((l) => [
      l,
      Object.fromEntries(PREDICTIONS.map((p) => [p, 0])),
    ]),
  ) as Record<PairLabel, Record<Prediction, number>>;
  const scored: ScoredPair[] = [];
  for (const row of rows) {
    if (row.label === "") {
      throw new Error(`pair ${row.pairId} is unlabelled`);
    }
    const a = records.get(row.a.recordId);
    const b = records.get(row.b.recordId);
    if (a === undefined || b === undefined) {
      throw new Error(
        `pair ${row.pairId} names a record the committed fixtures no longer ` +
          `hold (${a === undefined ? row.a.recordId : row.b.recordId})`,
      );
    }
    const predicted = outcomeOf(a.id, b.id);
    const direct = compareRecords(a, b);
    matrix[row.label][predicted] += 1;
    scored.push({
      row,
      label: row.label,
      predicted,
      direct,
      transitive: predicted === "merged" && direct.verdict !== "match",
    });
  }
  const truePositives = matrix.duplicate.merged;
  const falsePositives =
    matrix["not-duplicate"].merged + matrix["linked-version"].merged;
  const falseNegatives =
    matrix.duplicate.linked +
    matrix.duplicate.flagged +
    matrix.duplicate.distinct;
  const ratio = (n: number, d: number): number | null =>
    d === 0 ? null : n / d;
  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return {
    matrix,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
    scored,
  };
}

// ---------------------------------------------------------------------------
// Sampling error (owner, 2026-10-25, `plan/00` §6 item 284(c); `docs/02` §11.3)
// ---------------------------------------------------------------------------

/** The two-sided 95 % normal quantile, Φ⁻¹(0.975). */
export const Z_95 = 1.959963984540054;

/** A closed interval inside [0, 1]. */
export interface Interval {
  readonly low: number;
  readonly high: number;
}

/**
 * The Wilson score interval for a proportion `successes / n`.
 *
 * Chosen over the normal ("Wald") approximation because it stays inside
 * [0, 1] and keeps close to its nominal coverage at small `n` and at
 * proportions near 0 or 1 — a sample of 60 pairs and a precision target of
 * 0.99 are both. At `successes === n` the low end is `n / (n + z²)`. No
 * finite-population correction is applied, so the interval is a little wider
 * than a draw without replacement strictly needs.
 *
 * @returns `null` when `n` is 0 (no pair in the denominator)
 * @throws RangeError on counts that are not integers with 0 ≤ successes ≤ n
 */
export function wilsonInterval(
  successes: number,
  n: number,
  z: number = Z_95,
): Interval | null {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(n) ||
    successes < 0 ||
    successes > n
  ) {
    throw new RangeError(
      `wilsonInterval needs integers 0 ≤ successes ≤ n, got ${String(successes)} of ${String(n)}`,
    );
  }
  if (n === 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half =
    (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    low: successes === 0 ? 0 : Math.max(0, centre - half),
    high: successes === n ? 1 : Math.min(1, centre + half),
  };
}

/** What an interval says about a `≥ target` criterion. */
export type TargetVerdict = "met" | "not met" | "undecided";

/**
 * Met when the whole interval is at or above the target, not met when the
 * whole interval is below it, undecided when it straddles the target (or
 * there is no interval at all).
 */
export function judgeTarget(
  interval: Interval | null,
  target: number,
): TargetVerdict {
  if (interval === null) return "undecided";
  if (interval.low >= target) return "met";
  if (interval.high < target) return "not met";
  return "undecided";
}

/**
 * The smallest denominator at which an error-free count's Wilson low end
 * reaches `target`: `n / (n + z²) ≥ t` ⇔ `n ≥ t·z² / (1 − t)`. 381 for 0.99
 * and 35 for 0.90 at 95 %.
 */
export function minCleanDenominator(target: number, z: number = Z_95): number {
  return Math.ceil((target * z * z) / (1 - target));
}

// ---------------------------------------------------------------------------
// The owner's sample of the label set (`scripts/dedup-label-sample.ts` draws it)
// ---------------------------------------------------------------------------

/** The committed sample, next to `pairs.jsonl`. */
export const LABEL_SAMPLE_FILE = "label-sample.json";

/** One pair and the engine outcome it was stratified under at the draw. */
export interface StratifiedPair {
  readonly pairId: string;
  readonly stratum: Prediction;
}

/** `test/fixtures/dedup/label-sample.json`. */
export interface LabelSample {
  readonly card: string;
  readonly decision: string;
  readonly seed: string;
  readonly size: number;
  readonly method: string;
  /** Per stratum: label-set pairs at the draw, and how many were drawn. */
  readonly strata: Readonly<
    Record<
      Prediction,
      { readonly population: number; readonly sampled: number }
    >
  >;
  /** Every label-set pair at the draw with its stratum, by pair id. */
  readonly population: readonly StratifiedPair[];
  /** The drawn pairs, by stratum in {@link PREDICTIONS} order, then by rank. */
  readonly sample: readonly StratifiedPair[];
  /** The drawn pair ids in the order the labelling page shows them. */
  readonly displayOrder: readonly string[];
}

function isPrediction(v: unknown): v is Prediction {
  return (
    typeof v === "string" && (PREDICTIONS as readonly string[]).includes(v)
  );
}

function stratifiedPairsOf(v: unknown, what: string): StratifiedPair[] {
  if (!Array.isArray(v)) throw new Error(`${what} is not an array`);
  return v.map((e: unknown, i) => {
    const o = e as { pairId?: unknown; stratum?: unknown } | null;
    if (
      o === null ||
      typeof o !== "object" ||
      typeof o.pairId !== "string" ||
      !isPrediction(o.stratum)
    ) {
      throw new Error(`${what}[${String(i)}] is not {pairId, stratum}`);
    }
    return { pairId: o.pairId, stratum: o.stratum };
  });
}

/**
 * Read a sample file, checking its shape: unique pair ids, the sample inside
 * the population with the same strata, `size` pairs, and a display order that
 * is a permutation of the sample.
 *
 * @throws Error naming the first defect
 */
export function parseLabelSample(text: string): LabelSample {
  const raw = JSON.parse(text) as Record<string, unknown>;
  for (const k of ["card", "decision", "seed", "method"] as const) {
    if (typeof raw[k] !== "string") throw new Error(`"${k}" is not a string`);
  }
  if (typeof raw.size !== "number") throw new Error(`"size" is not a number`);
  const population = stratifiedPairsOf(raw.population, "population");
  const sample = stratifiedPairsOf(raw.sample, "sample");
  if (!Array.isArray(raw.displayOrder)) {
    throw new Error(`"displayOrder" is not an array`);
  }
  const displayOrder = raw.displayOrder.map((x: unknown) => {
    if (typeof x !== "string")
      throw new Error(`displayOrder holds a non-string`);
    return x;
  });
  const strataRaw = raw.strata as
    Record<string, { population?: unknown; sampled?: unknown }> | undefined;
  const strata = Object.fromEntries(
    PREDICTIONS.map((p) => {
      const s = strataRaw?.[p];
      if (
        s === undefined ||
        typeof s.population !== "number" ||
        typeof s.sampled !== "number"
      ) {
        throw new Error(`strata.${p} is not {population, sampled}`);
      }
      return [p, { population: s.population, sampled: s.sampled }];
    }),
  ) as Record<Prediction, { population: number; sampled: number }>;

  const byId = new Map<string, Prediction>();
  for (const p of population) {
    if (byId.has(p.pairId)) throw new Error(`population repeats ${p.pairId}`);
    byId.set(p.pairId, p.stratum);
  }
  const seen = new Set<string>();
  for (const s of sample) {
    if (seen.has(s.pairId)) throw new Error(`sample repeats ${s.pairId}`);
    seen.add(s.pairId);
    if (byId.get(s.pairId) !== s.stratum) {
      throw new Error(
        `sample pair ${s.pairId} is not in the population as ${s.stratum}`,
      );
    }
  }
  if (sample.length !== raw.size) {
    throw new Error(
      `sample holds ${String(sample.length)} pairs, size says ${String(raw.size)}`,
    );
  }
  if (
    displayOrder.length !== sample.length ||
    new Set(displayOrder).size !== displayOrder.length ||
    !displayOrder.every((id) => seen.has(id))
  ) {
    throw new Error("displayOrder is not a permutation of the sample");
  }
  for (const p of PREDICTIONS) {
    const pop = population.filter((x) => x.stratum === p).length;
    const smp = sample.filter((x) => x.stratum === p).length;
    if (strata[p].population !== pop || strata[p].sampled !== smp) {
      throw new Error(
        `strata.${p} disagrees with the population or the sample`,
      );
    }
  }
  return {
    card: raw.card as string,
    decision: raw.decision as string,
    seed: raw.seed as string,
    size: raw.size,
    method: raw.method as string,
    strata,
    population,
    sample,
    displayOrder,
  };
}

/** What the report prints about the sample, besides the measurement. */
export interface SampleContext {
  /** The sample file's path, as given. */
  readonly file: string;
  readonly seed: string;
  readonly size: number;
  /** Per stratum: label-set pairs at the draw, drawn, and drawn and labelled. */
  readonly strata: Readonly<
    Record<
      Prediction,
      {
        readonly population: number;
        readonly sampled: number;
        readonly labelled: number;
      }
    >
  >;
  /** Measured pairs whose outcome today differs from their stratum at the draw. */
  readonly movedSinceDraw: number;
  /** Labelled label-set pairs outside the sample: not measured in this mode. */
  readonly labelledOutside: number;
}

function fmt(x: number | null): string {
  return x === null ? "n/a (no pair in the denominator)" : x.toFixed(4);
}

function intervalText(interval: Interval | null): string {
  return interval === null
    ? "n/a (no pair in the denominator)"
    : `[${interval.low.toFixed(4)}, ${interval.high.toFixed(4)}]`;
}

/**
 * One target line in sample mode: point estimate, interval, and the verdict
 * the interval supports — saying plainly when it is too wide to decide.
 */
function sampledTargetLine(
  name: string,
  point: number | null,
  successes: number,
  n: number,
  denominatorName: string,
  target: number,
): string {
  const interval = wilsonInterval(successes, n);
  const verdict = judgeTarget(interval, target);
  const head =
    `${name.padEnd(9)} ${fmt(point)}   95 % Wilson interval ${intervalText(interval)} ` +
    `over ${String(n)} ${denominatorName}   target ≥ ${String(target)}   `;
  if (verdict === "met")
    return `${head}met (the whole interval is at or above the target)`;
  if (verdict === "not met") {
    return `${head}NOT met (the whole interval is below the target)`;
  }
  return (
    `${head}UNDECIDED: the interval is too wide to decide the target — ` +
    `even with no error the low end reaches ${String(target)} only from ` +
    `${String(minCleanDenominator(target))} ${denominatorName}`
  );
}

function describePair(s: ScoredPair): string {
  const d = s.direct;
  return (
    `  ${s.row.pairId}  labelled ${s.label}, engine ${s.predicted}` +
    (s.transitive ? " (through a third record)" : "") +
    `\n    direct decision: ${d.verdict}, tier ${d.tier ?? "none"}, ` +
    `score ${d.confidence.toFixed(3)}` +
    `\n    A ${s.row.a.recordId}: ${s.row.a.title}` +
    `\n    B ${s.row.b.recordId}: ${s.row.b.title}` +
    (s.row.reason === "" ? "" : `\n    reason given: ${s.row.reason}`)
  );
}

/** The printed report. */
export function formatReport(
  metrics: DedupMetrics,
  context: {
    readonly file: string;
    readonly partial: string | undefined;
    /** {@link sampledOutLine}'s text; absent when nothing was sampled out. */
    readonly sampledOut?: string;
    /** Present in sample mode (the default); absent under `--full`. */
    readonly sample?: SampleContext;
  },
): string {
  const out: string[] = [];
  const sample = context.sample;
  if (context.partial !== undefined) out.push(`PARTIAL: ${context.partial}`);
  out.push(`Dedup accuracy on ${context.file}`);
  if (context.sampledOut !== undefined) out.push(context.sampledOut);
  if (sample === undefined) {
    out.push(
      "Mode: --full (every labelled label-set pair; the owner's sample is not applied)",
    );
  } else {
    out.push(
      `Mode: the owner's sample (owner, 2026-10-25): ${String(sample.size)} label-set pairs ` +
        `drawn from ${sample.file}, seed "${sample.seed}", stratified by the engine's ` +
        `outcome at the draw in proportion (docs/02 §11.3)`,
    );
    out.push(
      `  ${"stratum".padEnd(10)}${"label set".padStart(11)}${"sampled".padStart(9)}${"labelled".padStart(10)}`,
    );
    for (const p of PREDICTIONS) {
      const s = sample.strata[p];
      out.push(
        `  ${p.padEnd(10)}${String(s.population).padStart(11)}${String(s.sampled).padStart(9)}${String(s.labelled).padStart(10)}`,
      );
    }
    out.push(
      `Sampled pairs whose engine outcome has changed since the draw: ${String(sample.movedSinceDraw)}` +
        (sample.movedSinceDraw > 0
          ? " (the sample is not redrawn; they are measured under today's outcome)"
          : ""),
    );
    if (sample.labelledOutside > 0) {
      out.push(
        `Labelled label-set pairs outside the sample, not measured in this mode: ` +
          `${String(sample.labelledOutside)} (npm run dedup:report -- --full measures them)`,
      );
    }
  }
  out.push(
    `Thresholds (src/sources/shared/dedupe.ts): ` +
      `LEVSIM_DUPLICATE_THRESHOLD ${String(LEVSIM_DUPLICATE_THRESHOLD)}, ` +
      `LEVSIM_CORROBORATED_THRESHOLD ${String(LEVSIM_CORROBORATED_THRESHOLD)}, ` +
      `JACCARD_CORROBORATED_THRESHOLD ${String(JACCARD_CORROBORATED_THRESHOLD)}, ` +
      `JACCARD_REORDER_THRESHOLD ${String(JACCARD_REORDER_THRESHOLD)}, ` +
      `LEVSIM_FLAG_THRESHOLD ${String(LEVSIM_FLAG_THRESHOLD)}, ` +
      `MAX_YEAR_DELTA ${String(MAX_YEAR_DELTA)}, ` +
      `MIN_FUZZY_TITLE_TOKENS ${String(MIN_FUZZY_TITLE_TOKENS)}, ` +
      `SIGNATURE_TOKEN_COUNT ${String(SIGNATURE_TOKEN_COUNT)}`,
  );
  out.push(`Labelled pairs measured: ${String(metrics.scored.length)}`);
  out.push("");
  out.push("Confusion matrix (rows: human label; columns: engine outcome)");
  const w = 16;
  out.push(
    `  ${"".padEnd(w)}${PREDICTIONS.map((p) => p.padStart(10)).join("")}${"total".padStart(10)}`,
  );
  for (const l of PAIR_LABELS) {
    const row = metrics.matrix[l];
    const total = PREDICTIONS.reduce((n, p) => n + row[p], 0);
    out.push(
      `  ${l.padEnd(w)}${PREDICTIONS.map((p) => String(row[p]).padStart(10)).join("")}${String(total).padStart(10)}`,
    );
  }
  out.push("");
  out.push(
    `True positives ${String(metrics.truePositives)}, false positives ` +
      `${String(metrics.falsePositives)}, false negatives ${String(metrics.falseNegatives)}`,
  );
  const tp = metrics.truePositives;
  const merged = tp + metrics.falsePositives;
  const duplicates = tp + metrics.falseNegatives;
  if (sample === undefined) {
    out.push(
      `Precision ${fmt(metrics.precision)}   target ≥ ${String(PRECISION_TARGET)}   ` +
        (metrics.precision !== null && metrics.precision >= PRECISION_TARGET
          ? "met"
          : "NOT met") +
        `   (95 % Wilson interval ${intervalText(wilsonInterval(tp, merged))})`,
    );
    out.push(
      `Recall    ${fmt(metrics.recall)}   target ≥ ${String(RECALL_TARGET)}   ` +
        (metrics.recall !== null && metrics.recall >= RECALL_TARGET
          ? "met"
          : "NOT met") +
        `   (95 % Wilson interval ${intervalText(wilsonInterval(tp, duplicates))})`,
    );
  } else {
    out.push(
      sampledTargetLine(
        "Precision",
        metrics.precision,
        tp,
        merged,
        "merged pairs",
        PRECISION_TARGET,
      ),
    );
    out.push(
      sampledTargetLine(
        "Recall",
        metrics.recall,
        tp,
        duplicates,
        "true duplicates",
        RECALL_TARGET,
      ),
    );
  }
  out.push(`F1        ${fmt(metrics.f1)}`);
  const linkRow = metrics.matrix["linked-version"];
  const linkTotal = PREDICTIONS.reduce((n, p) => n + linkRow[p], 0);
  out.push(
    `Linked versions recognised as links: ${String(linkRow.linked)} of ${String(linkTotal)} ` +
      `(not counted in precision; docs/02 §11.4)`,
  );
  const fps = metrics.scored.filter(
    (s) => s.predicted === "merged" && s.label !== "duplicate",
  );
  out.push("");
  out.push(`False positives (${String(fps.length)}):`);
  for (const s of fps) out.push(describePair(s));
  const fns = metrics.scored.filter(
    (s) => s.label === "duplicate" && s.predicted !== "merged",
  );
  out.push("");
  out.push(`False negatives (${String(fns.length)}):`);
  for (const s of fns) out.push(describePair(s));
  return out.join("\n");
}

/**
 * The command.
 *
 * @returns 0 when a report was printed; 1 when the file is unlabelled (or
 *   partly labelled without `--allow-partial`) or names records the fixtures
 *   no longer hold; 2 on a usage error or an unreadable file
 */
export async function main(argv: readonly string[]): Promise<number> {
  const allowPartial = argv.includes("--allow-partial");
  const full = argv.includes("--full");
  const sampleArg = argv.find((a) => a.startsWith("--sample="));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const file = positional[0] ?? resolve(DEDUP_CORPUS_DIR, PAIRS_FILE);
  if (full && sampleArg !== undefined) {
    process.stderr.write("--full and --sample= cannot be used together.\n");
    return 2;
  }
  if (!full) {
    return mainSampled(
      file,
      sampleArg?.slice("--sample=".length) ??
        resolve(DEDUP_CORPUS_DIR, LABEL_SAMPLE_FILE),
      allowPartial,
    );
  }

  let rows: readonly PairRow[];
  try {
    rows = parseJsonl(await readFile(file, "utf8"));
  } catch (error) {
    process.stderr.write(
      `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  if (rows.length === 0) {
    process.stderr.write(`${file} holds no pairs.\n`);
    return 2;
  }
  const labelSet = rows.filter(inLabelSet);
  const sampledOut =
    labelSet.length === rows.length ? undefined : sampledOutLine(rows);
  const labelled = labelSet.filter((r) => r.label !== "");
  const unlabelled = labelSet.length - labelled.length;
  if (labelled.length === 0 || (unlabelled > 0 && !allowPartial)) {
    process.stderr.write(
      `${file} is ${labelled.length === 0 ? "unlabelled" : "not fully labelled"}: ` +
        `${String(unlabelled)} of ${String(labelSet.length)} label-set pairs have no label. ` +
        `No measurement is made on unlabelled pairs. Label them by hand ` +
        `(${PAIR_LABELS.join(" / ")}) in test/fixtures/dedup/pairs.csv, then run ` +
        `npx tsx scripts/build-dedup-corpus.ts --merge-labels test/fixtures/dedup/pairs.csv.\n` +
        (sampledOut === undefined ? "" : `${sampledOut}.\n`),
    );
    return 1;
  }

  const corpus = await loadCorpusRecords();
  const pool = corpus.records.map((c) => c.record);
  const byId = new Map(pool.map((r) => [r.id, r]));
  let metrics: DedupMetrics;
  try {
    metrics = computeMetrics(labelled, byId, dedupeRecords(pool));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `Rebuild the candidate file with npx tsx scripts/build-dedup-corpus.ts.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `${formatReport(metrics, {
      file,
      partial:
        unlabelled > 0
          ? `${String(unlabelled)} of ${String(labelSet.length)} label-set pairs are unlabelled and not measured`
          : undefined,
      ...(sampledOut !== undefined && { sampledOut }),
    })}\n`,
  );
  return 0;
}

/**
 * Sample mode, the default since the owner's decision of 2026-10-25: measure
 * the labelled pairs of the committed sample and state each target with its
 * Wilson interval. Refuses, as `--full` does, while a sampled pair is
 * unlabelled (unless `--allow-partial`), and refuses a sample naming a pair
 * the corpus no longer holds in its label set — redrawing is the owner's
 * call, not this printer's.
 */
async function mainSampled(
  file: string,
  sampleFile: string,
  allowPartial: boolean,
): Promise<number> {
  let rows: readonly PairRow[];
  try {
    rows = parseJsonl(await readFile(file, "utf8"));
  } catch (error) {
    process.stderr.write(
      `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  if (rows.length === 0) {
    process.stderr.write(`${file} holds no pairs.\n`);
    return 2;
  }
  let sample: LabelSample;
  try {
    sample = parseLabelSample(await readFile(sampleFile, "utf8"));
  } catch (error) {
    process.stderr.write(
      `Cannot read the owner's sample ${sampleFile}: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        `Draw it with npx tsx scripts/dedup-label-sample.ts, or measure every ` +
        `label-set pair with npm run dedup:report -- --full.\n`,
    );
    return 2;
  }
  const byPair = new Map(rows.map((r) => [r.pairId, r]));
  const stratumOf = new Map(sample.sample.map((s) => [s.pairId, s.stratum]));
  const sampledRows: PairRow[] = [];
  for (const s of sample.sample) {
    const row = byPair.get(s.pairId);
    if (row === undefined || !inLabelSet(row)) {
      process.stderr.write(
        `The owner's sample names pair ${s.pairId}, which ${file} ` +
          `${row === undefined ? "no longer holds" : "no longer has in its label set"}. ` +
          `The sample is drawn once (docs/02 §11.3); redrawing it is the owner's decision.\n`,
      );
      return 1;
    }
    sampledRows.push(row);
  }
  const labelled = sampledRows.filter((r) => r.label !== "");
  const unlabelled = sampledRows.length - labelled.length;
  if (labelled.length === 0 || (unlabelled > 0 && !allowPartial)) {
    process.stderr.write(
      `${file} is ${labelled.length === 0 ? "unlabelled" : "not fully labelled"} ` +
        `on the owner's sample: ${String(unlabelled)} of ${String(sampledRows.length)} ` +
        `sampled pairs have no label. No measurement is made on unlabelled pairs. ` +
        `The owner labels the ${String(sample.size)} pairs of ${sampleFile} by hand ` +
        `(${PAIR_LABELS.join(" / ")}); merge them with ` +
        `npx tsx scripts/build-dedup-corpus.ts --merge-labels test/fixtures/dedup/pairs.csv.\n`,
    );
    return 1;
  }
  const labelledOutside = rows.filter(
    (r) => inLabelSet(r) && r.label !== "" && !stratumOf.has(r.pairId),
  ).length;

  const corpus = await loadCorpusRecords();
  const pool = corpus.records.map((c) => c.record);
  const byId = new Map(pool.map((r) => [r.id, r]));
  let metrics: DedupMetrics;
  try {
    metrics = computeMetrics(labelled, byId, dedupeRecords(pool));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `Rebuild the candidate file with npx tsx scripts/build-dedup-corpus.ts.\n`,
    );
    return 1;
  }
  const strata = Object.fromEntries(
    PREDICTIONS.map((p) => [
      p,
      {
        population: sample.strata[p].population,
        sampled: sample.strata[p].sampled,
        labelled: labelled.filter((r) => stratumOf.get(r.pairId) === p).length,
      },
    ]),
  ) as SampleContext["strata"];
  const movedSinceDraw = metrics.scored.filter(
    (s) => stratumOf.get(s.row.pairId) !== s.predicted,
  ).length;
  process.stdout.write(
    `${formatReport(metrics, {
      file,
      partial:
        unlabelled > 0
          ? `${String(unlabelled)} of ${String(sampledRows.length)} sampled pairs are unlabelled and not measured`
          : undefined,
      sample: {
        file: sampleFile,
        seed: sample.seed,
        size: sample.size,
        strata,
        movedSinceDraw,
        labelledOutside,
      },
    })}\n`,
  );
  return 0;
}

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
