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
 * ```sh
 * npm run dedup:report                                   # the committed corpus
 * npm run dedup:report -- path/to/pairs.jsonl            # another labelled file
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
  const groupOf = new Map<string, number>();
  result.groups.forEach((g, i) => {
    for (const r of g.records) groupOf.set(r.id, i);
  });
  const links = new Set(result.links.map((p) => keyOf(p.a.id, p.b.id)));
  const flags = new Set(result.flags.map((p) => keyOf(p.a.id, p.b.id)));

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
    const k = keyOf(a.id, b.id);
    const ga = groupOf.get(a.id);
    const predicted: Prediction =
      ga !== undefined && ga === groupOf.get(b.id)
        ? "merged"
        : links.has(k)
          ? "linked"
          : flags.has(k)
            ? "flagged"
            : "distinct";
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

function fmt(x: number | null): string {
  return x === null ? "n/a (no pair in the denominator)" : x.toFixed(4);
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
  },
): string {
  const out: string[] = [];
  if (context.partial !== undefined) out.push(`PARTIAL: ${context.partial}`);
  out.push(`Dedup accuracy on ${context.file}`);
  if (context.sampledOut !== undefined) out.push(context.sampledOut);
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
  out.push(
    `Precision ${fmt(metrics.precision)}   target ≥ ${String(PRECISION_TARGET)}   ` +
      (metrics.precision !== null && metrics.precision >= PRECISION_TARGET
        ? "met"
        : "NOT met"),
  );
  out.push(
    `Recall    ${fmt(metrics.recall)}   target ≥ ${String(RECALL_TARGET)}   ` +
      (metrics.recall !== null && metrics.recall >= RECALL_TARGET
        ? "met"
        : "NOT met"),
  );
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
  const positional = argv.filter((a) => !a.startsWith("--"));
  const file = positional[0] ?? resolve(DEDUP_CORPUS_DIR, PAIRS_FILE);

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

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
