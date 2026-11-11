/**
 * `scripts/dedup-label-sample.ts` — the owner's sample of the dedup label set
 * (`P2-T13` Part B; owner's decision of 2026-10-25, `plan/00` §6 item 284(c);
 * the method is `docs/02` §11.3's note of that date).
 *
 * **What it does.** It draws, once, the **60** of `P2-T13`'s label-set pairs
 * the owner labels instead of all 267, and writes the draw with its seed to
 * `test/fixtures/dedup/label-sample.json`. `npm run dedup:report` then
 * measures the labelled pairs of that sample and states each target with its
 * Wilson interval.
 *
 * **How the 60 are drawn.**
 *
 * 1. **Strata.** Every label-set pair (`inLabelSet`) is put under the engine's
 *    outcome for it — *merged*, *linked*, *flagged* or *distinct* — read by
 *    `outcomeIndex` from one `dedupeRecords` run over the whole record pool,
 *    exactly as the report reads its columns.
 * 2. **Allocation in proportion** ({@link allocateProportional}). Stratum `h`
 *    with `N_h` of the `N` pairs gets `⌊60·N_h/N⌋`, and the pairs still owed go
 *    one each to the largest fractional parts (largest remainder; ties in
 *    `PREDICTIONS` order). A stratum that has pairs but rounds to none gets
 *    one, taken from the stratum with the most pairs drawn.
 * 3. **Within a stratum** ({@link drawStratifiedSample}), the pairs with the
 *    smallest {@link sampleRank} — SHA-256 of `seed + "\n" + pairId` — are
 *    kept, ties by pair id. The pair id is itself a hash of the two record
 *    ids, so the draw depends on the seed and the pairs only, not on input
 *    order.
 * 4. **Display order** ({@link displayRank}): the 60 sorted by SHA-256 of
 *    `seed + "\ndisplay\n" + pairId`, which mixes the strata, so the labelling
 *    page neither shows nor groups by the engine's outcome and the labels stay
 *    independent of the code under test (`P2-T13`'s Do NOT).
 *
 * **Drawn once.** The file records every label-set pair with its stratum at
 * the draw, so the draw can be re-derived from the file alone even after step
 * 6 moves a threshold; the sample is **not** redrawn when the engine changes.
 * Running this script again refuses to overwrite the file unless `--redraw` is
 * given — and redrawing is the owner's decision.
 *
 * **What it never does.** It never writes a label.
 *
 * **The top-up** (added 2026-11-11; owner's decision, `plan/00` §6 item
 * 366(a); the method is `docs/02` §11.3's note of that date). `--extend=10`
 * appends a second block, `topUp`, drawn by the same steps 1–4 under its own
 * seed ({@link TOP_UP_SEED}) from a different population: the label-set
 * pairs that carry no label and are not in the first draw's sample, each
 * under the engine's outcome on the top-up's day ({@link buildTopUp}). The
 * block records its decision, date, seed, size, method, strata, its whole
 * population with strata, and the labelled pairs it left out, so it too
 * re-derives from the file alone. It is drawn once: a second `--extend=`
 * refuses, and `--redraw` refuses while a top-up exists. `--check` then
 * re-derives each block from its own population and seed and checks that
 * today's label set is what the top-up saw ({@link checkLabelSample}). The
 * report measures the union of the two draws and says it is not one
 * stratified draw (`scripts/dedup-report.ts`).
 *
 * ```sh
 * npx tsx scripts/dedup-label-sample.ts                          # draw and write, if no sample exists
 * npx tsx scripts/dedup-label-sample.ts --check                  # exit 1 if the committed sample does not re-derive
 * npx tsx scripts/dedup-label-sample.ts --page-order=out.json    # write the labelling page's id list (first draw)
 * npx tsx scripts/dedup-label-sample.ts --extend=10              # append the top-up, once (owner, 2026-11-11)
 * npx tsx scripts/dedup-label-sample.ts --redraw                 # overwrite (the owner's decision only)
 * ```
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SourceRecord } from "../src/model/sourceRecord";
import { dedupeRecords, type DedupResult } from "../src/sources/shared/dedupe";
import { sha256Hex } from "../test/support/sha256";
import {
  DEDUP_CORPUS_DIR,
  loadCorpusRecords,
  PAIRS_FILE,
  parseJsonl,
  type PairRow,
} from "./build-dedup-corpus";
import {
  inLabelSet,
  LABEL_SAMPLE_FILE,
  outcomeIndex,
  parseLabelSample,
  PREDICTIONS,
  type LabelSample,
  type LabelSampleTopUp,
  type Prediction,
  type StratifiedPair,
} from "./dedup-report";

/** The fixed seed of the draw (`docs/02` §11.3); changing it changes the 60. */
export const LABEL_SAMPLE_SEED = "P2-T13 label sample 2026-10-25";

/** How many label-set pairs the owner labels (`plan/00` §6 item 284(c)). */
export const LABEL_SAMPLE_SIZE = 60;

/** The decision the file cites. */
const DECISION = "owner, 2026-10-25, plan/00 §6 item 284(c); docs/02 §11.3";

/** One sentence the file carries, so it explains itself. */
const METHOD =
  "Label-set pairs stratified by the engine's outcome at the draw (merged / linked / " +
  "flagged / distinct); per-stratum counts in proportion to the label set, rounded by " +
  "largest remainder (ties in that order) with at least one pair per non-empty stratum; " +
  'within a stratum the smallest sha256(seed + "\\n" + pairId), ties by pair id; ' +
  'displayOrder is the sample sorted by sha256(seed + "\\ndisplay\\n" + pairId).';

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The selection key of a pair inside its stratum: smaller is drawn first. */
export function sampleRank(seed: string, pairId: string): string {
  return sha256Hex(`${seed}\n${pairId}`);
}

/** The labelling page's ordering key: mixes the strata. */
export function displayRank(seed: string, pairId: string): string {
  return sha256Hex(`${seed}\ndisplay\n${pairId}`);
}

/**
 * Split `size` across the strata in proportion to `counts` (largest
 * remainder, ties in {@link PREDICTIONS} order), then give every non-empty
 * stratum at least one, taken from the stratum with the most drawn.
 *
 * @throws RangeError when `size` exceeds the population or is negative
 */
export function allocateProportional(
  counts: Readonly<Record<Prediction, number>>,
  size: number,
): Record<Prediction, number> {
  const total = PREDICTIONS.reduce((n, p) => n + counts[p], 0);
  if (!Number.isInteger(size) || size < 0 || size > total) {
    throw new RangeError(
      `cannot draw ${String(size)} of ${String(total)} pairs`,
    );
  }
  const out = Object.fromEntries(PREDICTIONS.map((p) => [p, 0])) as Record<
    Prediction,
    number
  >;
  if (size === 0) return out;
  const quota = PREDICTIONS.map((p, i) => {
    const exact = (size * counts[p]) / total;
    return { p, i, floor: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  for (const q of quota) out[q.p] = q.floor;
  let owed = size - quota.reduce((n, q) => n + q.floor, 0);
  const byRest = [...quota].sort((x, y) => y.rest - x.rest || x.i - y.i);
  for (const q of byRest) {
    if (owed === 0) break;
    out[q.p] += 1;
    owed -= 1;
  }
  for (const p of PREDICTIONS) {
    if (counts[p] > 0 && out[p] === 0) {
      const donor = [...PREDICTIONS]
        .filter((d) => out[d] > 1)
        .sort((x, y) => out[y] - out[x])[0];
      if (donor === undefined) break;
      out[donor] -= 1;
      out[p] = 1;
    }
  }
  return out;
}

/** {@link drawStratifiedSample}'s result. */
export interface StratifiedDraw {
  readonly allocation: Readonly<Record<Prediction, number>>;
  /** By stratum in {@link PREDICTIONS} order, then by {@link sampleRank}. */
  readonly sample: readonly StratifiedPair[];
  /** The sampled ids by {@link displayRank}, ties by pair id. */
  readonly displayOrder: readonly string[];
}

/**
 * Draw `size` pairs from a stratified population under `seed`.
 *
 * @throws Error when a pair id repeats
 */
export function drawStratifiedSample(
  population: readonly StratifiedPair[],
  size: number,
  seed: string,
): StratifiedDraw {
  if (new Set(population.map((p) => p.pairId)).size !== population.length) {
    throw new Error("the population repeats a pair id");
  }
  const counts = Object.fromEntries(
    PREDICTIONS.map((p) => [
      p,
      population.filter((x) => x.stratum === p).length,
    ]),
  ) as Record<Prediction, number>;
  const allocation = allocateProportional(counts, size);
  const sample: StratifiedPair[] = [];
  for (const p of PREDICTIONS) {
    const kept = population
      .filter((x) => x.stratum === p)
      .map((x) => ({ x, rank: sampleRank(seed, x.pairId) }))
      .sort(
        (u, v) =>
          compareStrings(u.rank, v.rank) ||
          compareStrings(u.x.pairId, v.x.pairId),
      )
      .slice(0, allocation[p])
      .map((u) => ({ pairId: u.x.pairId, stratum: p }));
    sample.push(...kept);
  }
  const displayOrder = sample
    .map((s) => ({ id: s.pairId, rank: displayRank(seed, s.pairId) }))
    .sort(
      (u, v) => compareStrings(u.rank, v.rank) || compareStrings(u.id, v.id),
    )
    .map((u) => u.id);
  return { allocation, sample, displayOrder };
}

/**
 * The label set with each pair's engine outcome, by pair id.
 *
 * @throws Error when a row names a record the pool does not hold
 */
export function stratifyLabelSet(
  rows: readonly PairRow[],
  records: ReadonlyMap<string, SourceRecord>,
  result: DedupResult,
): StratifiedPair[] {
  const outcomeOf = outcomeIndex(result);
  return rows
    .filter(inLabelSet)
    .map((r) => {
      if (!records.has(r.a.recordId) || !records.has(r.b.recordId)) {
        throw new Error(
          `pair ${r.pairId} names a record the committed fixtures no longer hold`,
        );
      }
      return {
        pairId: r.pairId,
        stratum: outcomeOf(r.a.recordId, r.b.recordId),
      };
    })
    .sort((x, y) => compareStrings(x.pairId, y.pairId));
}

/** The whole file's content for a stratified population. */
export function buildLabelSample(
  population: readonly StratifiedPair[],
  size: number = LABEL_SAMPLE_SIZE,
  seed: string = LABEL_SAMPLE_SEED,
): LabelSample {
  const sorted = [...population].sort((x, y) =>
    compareStrings(x.pairId, y.pairId),
  );
  const draw = drawStratifiedSample(sorted, size, seed);
  const strata = Object.fromEntries(
    PREDICTIONS.map((p) => [
      p,
      {
        population: sorted.filter((x) => x.stratum === p).length,
        sampled: draw.allocation[p],
      },
    ]),
  ) as LabelSample["strata"];
  return {
    card: "P2-T13",
    decision: DECISION,
    seed,
    size,
    method: METHOD,
    strata,
    population: sorted,
    sample: draw.sample,
    displayOrder: draw.displayOrder,
  };
}

// ---------------------------------------------------------------------------
// The top-up (owner's decision of 2026-11-11, plan/00 §6 item 366(a); the
// method is docs/02 §11.3's note of that date)
// ---------------------------------------------------------------------------

/** The top-up's fixed seed (`docs/02` §11.3); changing it changes the ten. */
export const TOP_UP_SEED = "P2-T13 label sample top-up 2026-11-11";

/** How many pairs the top-up draws (`plan/00` §6 item 366(a)). */
export const TOP_UP_SIZE = 10;

/** The top-up's day, recorded in its block. */
export const TOP_UP_DATE = "2026-11-11";

/** The decision the top-up block cites. */
const TOP_UP_DECISION =
  "owner, 2026-11-11, plan/00 §6 item 366(a); docs/02 §11.3";

/** One sentence the top-up block carries, so it explains itself. */
const TOP_UP_METHOD =
  "Label-set pairs that carried no label and were not in the first draw's sample, stratified " +
  "by the engine's outcome on the top-up's date (merged / linked / flagged / distinct); " +
  "allocation, within-stratum rank and display order exactly as the first draw, under this " +
  "block's seed. Drawn after the engine changed (P2-T38, P2-T39): the union of the two draws " +
  "is not one stratified draw.";

/**
 * The top-up block for a committed first draw: the population is every
 * label-set pair of `today` (the label set with today's engine outcome, as
 * {@link stratifyLabelSet} gives it) that carries no label in `rows` and is
 * not in the first draw's sample, and it is drawn by
 * {@link drawStratifiedSample} under `seed`. Pure: it reads `rows` and never
 * writes a label anywhere.
 *
 * @throws Error when `committed` already holds a top-up, or when `today`
 *   names a pair `rows` does not hold
 * @throws RangeError when the population holds fewer than `size` pairs
 */
export function buildTopUp(
  committed: LabelSample,
  rows: readonly PairRow[],
  today: readonly StratifiedPair[],
  size: number = TOP_UP_SIZE,
  seed: string = TOP_UP_SEED,
  date: string = TOP_UP_DATE,
): LabelSampleTopUp {
  if (committed.topUp !== undefined) {
    throw new Error(
      `the sample already holds a top-up (seed "${committed.topUp.seed}"); it is drawn once`,
    );
  }
  const byPair = new Map(rows.map((r) => [r.pairId, r]));
  const firstSampled = new Set(committed.sample.map((s) => s.pairId));
  const population: StratifiedPair[] = [];
  const excludedLabelled: string[] = [];
  for (const p of today) {
    const row = byPair.get(p.pairId);
    if (row === undefined) {
      throw new Error(`pair ${p.pairId} is not in the corpus`);
    }
    if (firstSampled.has(p.pairId)) continue;
    if (row.label !== "") excludedLabelled.push(p.pairId);
    else population.push({ pairId: p.pairId, stratum: p.stratum });
  }
  population.sort((x, y) => compareStrings(x.pairId, y.pairId));
  excludedLabelled.sort(compareStrings);
  const draw = drawStratifiedSample(population, size, seed);
  const strata = Object.fromEntries(
    PREDICTIONS.map((p) => [
      p,
      {
        population: population.filter((x) => x.stratum === p).length,
        sampled: draw.allocation[p],
      },
    ]),
  ) as LabelSampleTopUp["strata"];
  return {
    decision: TOP_UP_DECISION,
    date,
    seed,
    size,
    method: TOP_UP_METHOD,
    strata,
    excludedLabelled,
    population,
    sample: draw.sample,
    displayOrder: draw.displayOrder,
  };
}

/** The top-up re-drawn from its own recorded population, seed and size. */
function redrawTopUp(t: LabelSampleTopUp): LabelSampleTopUp {
  const draw = drawStratifiedSample(t.population, t.size, t.seed);
  return {
    ...t,
    strata: Object.fromEntries(
      PREDICTIONS.map((p) => [
        p,
        {
          population: t.population.filter((x) => x.stratum === p).length,
          sampled: draw.allocation[p],
        },
      ]),
    ) as LabelSampleTopUp["strata"],
    sample: draw.sample,
    displayOrder: draw.displayOrder,
  };
}

/** The first draw alone: the file's content without its top-up block. */
function firstDrawOf(s: LabelSample): LabelSample {
  const { topUp: _topUp, ...first } = s;
  return first;
}

/** JSON with one pair per line, so a diff of the file reads pair by pair. */
export function serializeLabelSample(s: LabelSample): string {
  const pair = (p: StratifiedPair, indent = "    "): string =>
    `${indent}${JSON.stringify(p)}`;
  const strataOf = (strata: LabelSample["strata"], indent: string): string =>
    PREDICTIONS.map(
      (p) => `${indent}${JSON.stringify(p)}: ${JSON.stringify(strata[p])}`,
    ).join(",\n");
  const ids = (list: readonly string[], indent: string): string =>
    list.map((id) => `${indent}${JSON.stringify(id)}`).join(",\n");
  const t = s.topUp;
  const topUp =
    t === undefined
      ? ""
      : ",\n" +
        `  "topUp": {\n` +
        `    "decision": ${JSON.stringify(t.decision)},\n` +
        `    "date": ${JSON.stringify(t.date)},\n` +
        `    "seed": ${JSON.stringify(t.seed)},\n` +
        `    "size": ${String(t.size)},\n` +
        `    "method": ${JSON.stringify(t.method)},\n` +
        `    "strata": {\n${strataOf(t.strata, "      ")}\n    },\n` +
        `    "sample": [\n${t.sample.map((p) => pair(p, "      ")).join(",\n")}\n    ],\n` +
        `    "displayOrder": [\n${ids(t.displayOrder, "      ")}\n    ],\n` +
        `    "excludedLabelled": [${t.excludedLabelled.length === 0 ? "" : `\n${ids(t.excludedLabelled, "      ")}\n    `}],\n` +
        `    "population": [\n${t.population.map((p) => pair(p, "      ")).join(",\n")}\n    ]\n` +
        `  }`;
  return (
    "{\n" +
    `  "card": ${JSON.stringify(s.card)},\n` +
    `  "decision": ${JSON.stringify(s.decision)},\n` +
    `  "seed": ${JSON.stringify(s.seed)},\n` +
    `  "size": ${String(s.size)},\n` +
    `  "method": ${JSON.stringify(s.method)},\n` +
    `  "strata": {\n${strataOf(s.strata, "    ")}\n  },\n` +
    `  "sample": [\n${s.sample.map((p) => pair(p)).join(",\n")}\n  ],\n` +
    `  "displayOrder": [\n${ids(s.displayOrder, "    ")}\n  ],\n` +
    `  "population": [\n${s.population.map((p) => pair(p)).join(",\n")}\n  ]` +
    topUp +
    "\n}\n"
  );
}

/**
 * The labelling page's list: the sampled ids in display order, and nothing
 * about strata or outcomes (the coordinator republishes the page from it).
 * The first draw only; the top-up is labelled in chat (`plan/00` §6 item
 * 366(a)) and its ids are in its own block's `displayOrder`.
 */
export function pageOrderOf(s: LabelSample): string {
  return `${JSON.stringify(
    {
      source: `test/fixtures/dedup/${LABEL_SAMPLE_FILE}`,
      decision: s.decision,
      seed: s.seed,
      count: s.displayOrder.length,
      pairIds: s.displayOrder,
    },
    null,
    2,
  )}\n`;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const x = [...a].sort(compareStrings);
  const y = [...b].sort(compareStrings);
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/**
 * Problems with a committed sample against the corpus.
 *
 * Without a top-up: its population must be today's label set, and its draw
 * must re-derive from its own population. *Since 2026-11-11 (`plan/00` §6
 * item 366(a)):* with a top-up, each draw must re-derive from its own
 * recorded population and seed; the first draw's population must still be
 * inside today's label set; and today's label set must be exactly what the
 * top-up saw — the first draw's sample, the top-up's population and the
 * labelled pairs it left out.
 */
export function checkLabelSample(
  committed: LabelSample,
  labelSetIds: readonly string[],
): string[] {
  const problems: string[] = [];
  const t = committed.topUp;
  const pop = committed.population.map((p) => p.pairId);
  if (t === undefined) {
    if (!sameIds(pop, labelSetIds)) {
      problems.push(
        `the sample's population (${String(pop.length)} pairs) is not today's label set ` +
          `(${String(labelSetIds.length)} pairs)`,
      );
    }
  } else {
    const now = new Set(labelSetIds);
    const gone = pop.filter((id) => !now.has(id));
    if (gone.length > 0) {
      problems.push(
        `${String(gone.length)} pairs of the first draw's population are no longer in the ` +
          `label set (${gone.slice(0, 3).join(", ")}${gone.length > 3 ? ", …" : ""})`,
      );
    }
    const seen = [
      ...committed.sample.map((s) => s.pairId),
      ...t.population.map((p) => p.pairId),
      ...t.excludedLabelled,
    ];
    if (!sameIds(seen, labelSetIds)) {
      problems.push(
        `the label set the top-up saw (${String(seen.length)} pairs: the first draw's ` +
          `${String(committed.sample.length)}, its population of ${String(t.population.length)} ` +
          `and ${String(t.excludedLabelled.length)} labelled pairs left out) is not today's ` +
          `label set (${String(labelSetIds.length)} pairs)`,
      );
    }
  }
  const first = firstDrawOf(committed);
  const redrawn = buildLabelSample(first.population, first.size, first.seed);
  if (serializeLabelSample(redrawn) !== serializeLabelSample(first)) {
    problems.push(
      "the committed sample does not re-derive from its population and seed",
    );
  }
  if (
    t !== undefined &&
    serializeLabelSample({ ...first, topUp: redrawTopUp(t) }) !==
      serializeLabelSample(committed)
  ) {
    problems.push(
      "the committed top-up does not re-derive from its own population and seed",
    );
  }
  return problems;
}

/** Where {@link main} reads and writes; tests point it at a temporary copy. */
export interface MainOptions {
  /** The directory holding `pairs.jsonl` and `label-sample.json`. */
  readonly dir?: string;
}

/**
 * The command.
 *
 * @returns 0 on success; 1 when `--check` finds a problem, when a sample
 *   exists and neither `--redraw` nor `--extend=` was given, or when
 *   `--extend=` finds a top-up already drawn or no first draw; 2 on an
 *   unreadable input or a bad `--extend=` value
 */
export async function main(
  argv: readonly string[],
  options: MainOptions = {},
): Promise<number> {
  const dir = options.dir ?? DEDUP_CORPUS_DIR;
  const check = argv.includes("--check");
  const redraw = argv.includes("--redraw");
  const pageOrder = argv
    .find((a) => a.startsWith("--page-order="))
    ?.slice("--page-order=".length);
  const extendArg = argv
    .find((a) => a.startsWith("--extend="))
    ?.slice("--extend=".length);
  const sampleFile = resolve(dir, LABEL_SAMPLE_FILE);

  let extendSize: number | undefined;
  if (extendArg !== undefined) {
    extendSize = Number(extendArg);
    if (!/^[1-9]\d*$/u.test(extendArg)) {
      process.stderr.write(
        `--extend= takes a positive whole number of pairs, not "${extendArg}".\n`,
      );
      return 2;
    }
    if (check || redraw) {
      process.stderr.write(
        "--extend= cannot be used with --check or --redraw.\n",
      );
      return 2;
    }
  }

  let rows: readonly PairRow[];
  try {
    rows = parseJsonl(await readFile(resolve(dir, PAIRS_FILE), "utf8"));
  } catch (error) {
    process.stderr.write(
      `Cannot read ${PAIRS_FILE}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  let committed: LabelSample | undefined;
  try {
    committed = parseLabelSample(await readFile(sampleFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(
        `Cannot read ${sampleFile}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
  }

  if (extendSize !== undefined) {
    if (committed === undefined) {
      process.stderr.write(
        `${sampleFile} does not exist; a top-up needs the first draw.\n`,
      );
      return 1;
    }
    if (committed.topUp !== undefined) {
      process.stderr.write(
        `${sampleFile} already holds a top-up (seed "${committed.topUp.seed}", ` +
          `${committed.topUp.date}); it is drawn once (docs/02 §11.3). Nothing was written.\n`,
      );
      return 1;
    }
    const corpus = await loadCorpusRecords();
    const pool = corpus.records.map((c) => c.record);
    const byId = new Map(pool.map((r) => [r.id, r]));
    const topUp = buildTopUp(
      committed,
      rows,
      stratifyLabelSet(rows, byId, dedupeRecords(pool)),
      extendSize,
    );
    committed = { ...committed, topUp };
    await writeFile(sampleFile, serializeLabelSample(committed), "utf8");
    process.stdout.write(
      `Appended a top-up to ${sampleFile}: ${String(topUp.size)} of ${String(topUp.population.length)} ` +
        `label-set pairs with no label outside the first draw ` +
        `(${String(topUp.excludedLabelled.length)} labelled pairs left out), seed "${topUp.seed}"; ` +
        `per stratum ` +
        PREDICTIONS.map(
          (p) =>
            `${p} ${String(topUp.strata[p].sampled)} of ${String(topUp.strata[p].population)}`,
        ).join(", ") +
        ". No label was written.\n",
    );
  } else if (check) {
    if (committed === undefined) {
      process.stderr.write(`${sampleFile} does not exist.\n`);
      return 1;
    }
    const problems = checkLabelSample(
      committed,
      rows.filter(inLabelSet).map((r) => r.pairId),
    );
    for (const p of problems) process.stderr.write(`${p}\n`);
    if (problems.length > 0) return 1;
    process.stdout.write(
      committed.topUp === undefined
        ? `${sampleFile} re-derives from its seed and population.\n`
        : `${sampleFile} re-derives: the first draw from its seed and population, and the ` +
            `top-up from its own; today's label set is what the top-up saw.\n`,
    );
  } else if (committed === undefined || redraw) {
    if (committed?.topUp !== undefined) {
      process.stderr.write(
        `${sampleFile} holds a top-up; redrawing the first draw would drop it. ` +
          `Nothing was written.\n`,
      );
      return 1;
    }
    const corpus = await loadCorpusRecords();
    const pool = corpus.records.map((c) => c.record);
    const byId = new Map(pool.map((r) => [r.id, r]));
    const drawn = buildLabelSample(
      stratifyLabelSet(rows, byId, dedupeRecords(pool)),
    );
    committed = drawn;
    await writeFile(sampleFile, serializeLabelSample(drawn), "utf8");
    process.stdout.write(
      `Wrote ${sampleFile}: ${String(drawn.size)} of ${String(drawn.population.length)} ` +
        `label-set pairs, seed "${drawn.seed}"; per stratum ` +
        PREDICTIONS.map(
          (p) =>
            `${p} ${String(drawn.strata[p].sampled)} of ${String(drawn.strata[p].population)}`,
        ).join(", ") +
        ".\n",
    );
  } else if (pageOrder === undefined) {
    process.stderr.write(
      `${sampleFile} exists and the sample is drawn once (docs/02 §11.3). ` +
        `Pass --redraw only on the owner's decision.\n`,
    );
    return 1;
  }

  if (pageOrder !== undefined) {
    await writeFile(pageOrder, pageOrderOf(committed), "utf8");
    process.stdout.write(
      `Wrote ${pageOrder}: ${String(committed.displayOrder.length)} pair ids in display order.\n`,
    );
  }
  return 0;
}

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
