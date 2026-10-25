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
 * ```sh
 * npx tsx scripts/dedup-label-sample.ts                          # draw and write, if no sample exists
 * npx tsx scripts/dedup-label-sample.ts --check                  # exit 1 if the committed sample does not re-derive
 * npx tsx scripts/dedup-label-sample.ts --page-order=out.json    # write the labelling page's id list
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

/** JSON with one pair per line, so a diff of the file reads pair by pair. */
export function serializeLabelSample(s: LabelSample): string {
  const pair = (p: StratifiedPair): string => `    ${JSON.stringify(p)}`;
  const strata = PREDICTIONS.map(
    (p) => `    ${JSON.stringify(p)}: ${JSON.stringify(s.strata[p])}`,
  ).join(",\n");
  return (
    "{\n" +
    `  "card": ${JSON.stringify(s.card)},\n` +
    `  "decision": ${JSON.stringify(s.decision)},\n` +
    `  "seed": ${JSON.stringify(s.seed)},\n` +
    `  "size": ${String(s.size)},\n` +
    `  "method": ${JSON.stringify(s.method)},\n` +
    `  "strata": {\n${strata}\n  },\n` +
    `  "sample": [\n${s.sample.map(pair).join(",\n")}\n  ],\n` +
    `  "displayOrder": [\n${s.displayOrder.map((id) => `    ${JSON.stringify(id)}`).join(",\n")}\n  ],\n` +
    `  "population": [\n${s.population.map(pair).join(",\n")}\n  ]\n` +
    "}\n"
  );
}

/**
 * The labelling page's list: the sampled ids in display order, and nothing
 * about strata or outcomes (the coordinator republishes the page from it).
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

/**
 * Problems with a committed sample against the corpus: its population must be
 * today's label set, and its draw must re-derive from its own population.
 */
export function checkLabelSample(
  committed: LabelSample,
  labelSetIds: readonly string[],
): string[] {
  const problems: string[] = [];
  const pop = committed.population.map((p) => p.pairId).sort(compareStrings);
  const now = [...labelSetIds].sort(compareStrings);
  if (pop.length !== now.length || pop.some((id, i) => id !== now[i])) {
    problems.push(
      `the sample's population (${String(pop.length)} pairs) is not today's label set ` +
        `(${String(now.length)} pairs)`,
    );
  }
  const redrawn = buildLabelSample(
    committed.population,
    committed.size,
    committed.seed,
  );
  if (serializeLabelSample(redrawn) !== serializeLabelSample(committed)) {
    problems.push(
      "the committed sample does not re-derive from its population and seed",
    );
  }
  return problems;
}

/**
 * The command.
 *
 * @returns 0 on success; 1 when `--check` finds a problem or a sample exists
 *   and `--redraw` was not given; 2 on an unreadable input
 */
export async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes("--check");
  const redraw = argv.includes("--redraw");
  const pageOrder = argv
    .find((a) => a.startsWith("--page-order="))
    ?.slice("--page-order=".length);
  const sampleFile = resolve(DEDUP_CORPUS_DIR, LABEL_SAMPLE_FILE);

  let rows: readonly PairRow[];
  try {
    rows = parseJsonl(
      await readFile(resolve(DEDUP_CORPUS_DIR, PAIRS_FILE), "utf8"),
    );
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

  if (check) {
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
      `${sampleFile} re-derives from its seed and population.\n`,
    );
  } else if (committed === undefined || redraw) {
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
