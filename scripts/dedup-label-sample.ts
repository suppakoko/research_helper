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
 * **Several top-ups** (since 2026-11-12; owner's decision of 2026-11-11,
 * `plan/00` §6 item 370(d); `docs/02` §11.3's note of that date).
 * `--extend=N` now appends the **next** numbered block — `topUp`, then
 * `topUp2`, `topUp3`, … ({@link topUpKey}) — and refuses only a seed an
 * earlier draw used. Its population is the label-set pairs with no label that
 * are in no earlier draw's sample (the first draw's or an earlier top-up's),
 * under the engine's outcome on its day; `--date=`, `--seed=` and
 * `--decision=` name it, and the seed defaults to {@link topUpSeed}. The
 * first top-up's block is unchanged, so a file written before this reads and
 * writes back byte for byte. `--check` re-derives every draw from its own
 * population and seed, checks that every pair an earlier block saw is still
 * in the label set, and that today's label set is what the newest block saw.
 *
 * ```sh
 * npx tsx scripts/dedup-label-sample.ts                          # draw and write, if no sample exists
 * npx tsx scripts/dedup-label-sample.ts --check                  # exit 1 if the committed sample does not re-derive
 * npx tsx scripts/dedup-label-sample.ts --page-order=out.json    # write the labelling page's id list (first draw)
 * npx tsx scripts/dedup-label-sample.ts --extend=10 --date=2026-11-11   # the first top-up (owner, 2026-11-11)
 * npx tsx scripts/dedup-label-sample.ts --extend=20 --date=2026-11-12 \
 *   --decision="owner, 2026-11-11, plan/00 §6 item 370(d); docs/02 §11.3"   # the second (item 370(d))
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
  topUpKey,
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
    topUps: [],
  };
}

// ---------------------------------------------------------------------------
// The top-up (owner's decision of 2026-11-11, plan/00 §6 item 366(a); the
// method is docs/02 §11.3's note of that date)
// ---------------------------------------------------------------------------

/** The first top-up's fixed seed (`docs/02` §11.3); changing it changes the ten. */
export const TOP_UP_SEED = "P2-T13 label sample top-up 2026-11-11";

/** How many pairs the first top-up draws (`plan/00` §6 item 366(a)). */
export const TOP_UP_SIZE = 10;

/** The first top-up's day, recorded in its block. */
export const TOP_UP_DATE = "2026-11-11";

/** The decision the first top-up block cites. */
const TOP_UP_DECISION =
  "owner, 2026-11-11, plan/00 §6 item 366(a); docs/02 §11.3";

/**
 * The default seed of top-up `number` (1-based) drawn on `date`: the first
 * top-up's form for 1 (it equals {@link TOP_UP_SEED} on its day), and
 * `P2-T13 label sample top-up <number> <date>` after it — for the second,
 * `P2-T13 label sample top-up 2 2026-11-12` (`docs/02` §11.3's note of
 * 2026-11-12, `plan/00` §6 item 370(d)).
 */
export function topUpSeed(number: number, date: string): string {
  return number === 1
    ? `P2-T13 label sample top-up ${date}`
    : `P2-T13 label sample top-up ${String(number)} ${date}`;
}

/** One sentence the top-up block carries, so it explains itself. */
const TOP_UP_METHOD =
  "Label-set pairs that carried no label and were not in the first draw's sample, stratified " +
  "by the engine's outcome on the top-up's date (merged / linked / flagged / distinct); " +
  "allocation, within-stratum rank and display order exactly as the first draw, under this " +
  "block's seed. Drawn after the engine changed (P2-T38, P2-T39): the union of the two draws " +
  "is not one stratified draw.";

/** The method sentence of every later top-up block (since 2026-11-12, item 370(d)). */
const LATER_TOP_UP_METHOD =
  "Label-set pairs that carried no label and were in no earlier draw's sample (the first " +
  "draw's or an earlier top-up's), stratified by the engine's outcome on this block's date " +
  "(merged / linked / flagged / distinct); allocation, within-stratum rank and display order " +
  "exactly as the first draw, under this block's seed. Drawn after the engine changed: the " +
  "union of the draws is not one stratified draw.";

/** What names a top-up besides its size; each part has a default ({@link buildTopUp}). */
export interface TopUpNaming {
  readonly seed?: string;
  readonly date?: string;
  readonly decision?: string;
}

/**
 * The next top-up block for a committed sample: the population is every
 * label-set pair of `today` (the label set with today's engine outcome, as
 * {@link stratifyLabelSet} gives it) that carries no label in `rows` and is
 * in no earlier draw's sample (the first draw's or an earlier top-up's), and
 * it is drawn by {@link drawStratifiedSample} under its seed. Pure: it reads
 * `rows` and never writes a label anywhere.
 *
 * The seed defaults to {@link topUpSeed} for the block's number and date; the
 * date to {@link TOP_UP_DATE}; the decision and method to the first top-up's
 * for the first block and to a later block's otherwise. Before 2026-11-12 a
 * second top-up was refused; since then (item 370(d)) only a repeated seed is.
 *
 * @throws Error when the seed is one an earlier draw used, or when `today`
 *   names a pair `rows` does not hold
 * @throws RangeError when the population holds fewer than `size` pairs
 */
export function buildTopUp(
  committed: LabelSample,
  rows: readonly PairRow[],
  today: readonly StratifiedPair[],
  size: number = TOP_UP_SIZE,
  naming: TopUpNaming = {},
): LabelSampleTopUp {
  const number = committed.topUps.length + 1;
  const date = naming.date ?? TOP_UP_DATE;
  const seed = naming.seed ?? topUpSeed(number, date);
  const used = [committed.seed, ...committed.topUps.map((t) => t.seed)];
  if (used.includes(seed)) {
    throw new Error(
      `the seed "${seed}" is already used by an earlier draw of the sample; each draw has its own`,
    );
  }
  const byPair = new Map(rows.map((r) => [r.pairId, r]));
  const earlierSampled = new Set(
    [committed.sample, ...committed.topUps.map((t) => t.sample)].flatMap((s) =>
      s.map((x) => x.pairId),
    ),
  );
  const population: StratifiedPair[] = [];
  const excludedLabelled: string[] = [];
  for (const p of today) {
    const row = byPair.get(p.pairId);
    if (row === undefined) {
      throw new Error(`pair ${p.pairId} is not in the corpus`);
    }
    if (earlierSampled.has(p.pairId)) continue;
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
    decision:
      naming.decision ??
      (number === 1
        ? TOP_UP_DECISION
        : `owner; docs/02 §11.3's top-up note of ${date}`),
    date,
    seed,
    size,
    method: number === 1 ? TOP_UP_METHOD : LATER_TOP_UP_METHOD,
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

/** The first draw alone: the file's content without its top-up blocks. */
function firstDrawOf(s: LabelSample): LabelSample {
  return { ...s, topUps: [] };
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
  // One block per top-up, under its numbered key; the first is byte for byte
  // the single `topUp` block written before 2026-11-12.
  const topUp = s.topUps
    .map(
      (t, i) =>
        ",\n" +
        `  ${JSON.stringify(topUpKey(i))}: {\n` +
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
        `  }`,
    )
    .join("");
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
 * The first draw only; the top-ups are labelled in chat (`plan/00` §6 items
 * 366(a) and 370(d)) and their ids are in their own blocks' `displayOrder`.
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
 * labelled pairs it left out. *Since 2026-11-12 (item 370(d)), with several
 * top-ups:* every block re-derives from its own population and seed; what
 * each block saw (every earlier draw's sample, its population and the
 * labelled pairs it left out) must still be inside today's label set; and
 * today's label set must be exactly what the **newest** block saw.
 */
export function checkLabelSample(
  committed: LabelSample,
  labelSetIds: readonly string[],
): string[] {
  const problems: string[] = [];
  const pop = committed.population.map((p) => p.pairId);
  const now = new Set(labelSetIds);
  if (committed.topUps.length === 0) {
    if (!sameIds(pop, labelSetIds)) {
      problems.push(
        `the sample's population (${String(pop.length)} pairs) is not today's label set ` +
          `(${String(labelSetIds.length)} pairs)`,
      );
    }
  } else {
    const gone = pop.filter((id) => !now.has(id));
    if (gone.length > 0) {
      problems.push(
        `${String(gone.length)} pairs of the first draw's population are no longer in the ` +
          `label set (${gone.slice(0, 3).join(", ")}${gone.length > 3 ? ", …" : ""})`,
      );
    }
    const earlier: string[] = committed.sample.map((s) => s.pairId);
    const last = committed.topUps.length - 1;
    committed.topUps.forEach((t, i) => {
      const seen = [
        ...earlier,
        ...t.population.map((p) => p.pairId),
        ...t.excludedLabelled,
      ];
      const name = `top-up ${String(i + 1)}`;
      if (i === last && !sameIds(seen, labelSetIds)) {
        problems.push(
          `the label set ${name} saw (${String(seen.length)} pairs: the earlier draws' ` +
            `${String(earlier.length)}, its population of ${String(t.population.length)} ` +
            `and ${String(t.excludedLabelled.length)} labelled pairs left out) is not today's ` +
            `label set (${String(labelSetIds.length)} pairs)`,
        );
      }
      if (i < last) {
        const lost = seen.filter((id) => !now.has(id));
        if (lost.length > 0) {
          problems.push(
            `${String(lost.length)} pairs that ${name} saw are no longer in the label set ` +
              `(${lost.slice(0, 3).join(", ")}${lost.length > 3 ? ", …" : ""})`,
          );
        }
      }
      earlier.push(...t.sample.map((s) => s.pairId));
    });
  }
  const first = firstDrawOf(committed);
  const redrawn = buildLabelSample(first.population, first.size, first.seed);
  if (serializeLabelSample(redrawn) !== serializeLabelSample(first)) {
    problems.push(
      "the committed sample does not re-derive from its population and seed",
    );
  }
  committed.topUps.forEach((t, i) => {
    if (
      serializeLabelSample({ ...first, topUps: [redrawTopUp(t)] }) !==
      serializeLabelSample({ ...first, topUps: [t] })
    ) {
      problems.push(
        `top-up ${String(i + 1)} does not re-derive from its own population and seed`,
      );
    }
  });
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
 *   `--extend=` finds no first draw or a seed an earlier draw used; 2 on an
 *   unreadable input or a bad `--extend=` or `--date=` value
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
  const valueOf = (flag: string): string | undefined =>
    argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);
  const dateArg = valueOf("--date");
  const seedArg = valueOf("--seed");
  const decisionArg = valueOf("--decision");
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
  if (dateArg !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(dateArg)) {
    process.stderr.write(`--date= takes YYYY-MM-DD, not "${dateArg}".\n`);
    return 2;
  }
  if (
    extendArg === undefined &&
    [dateArg, seedArg, decisionArg].some((v) => v !== undefined)
  ) {
    process.stderr.write("--date=, --seed= and --decision= need --extend=.\n");
    return 2;
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
    const number = committed.topUps.length + 1;
    const date = dateArg ?? localDate();
    const seed = seedArg ?? topUpSeed(number, date);
    const used = [committed, ...committed.topUps].find((d) => d.seed === seed);
    if (used !== undefined) {
      process.stderr.write(
        `${sampleFile} already holds a draw under the seed "${seed}"; each draw has its own ` +
          `(docs/02 §11.3). Nothing was written.\n`,
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
      {
        seed,
        date,
        ...(decisionArg !== undefined && { decision: decisionArg }),
      },
    );
    committed = { ...committed, topUps: [...committed.topUps, topUp] };
    await writeFile(sampleFile, serializeLabelSample(committed), "utf8");
    process.stdout.write(
      `Appended top-up ${String(number)} ("${topUpKey(number - 1)}") to ${sampleFile}: ` +
        `${String(topUp.size)} of ${String(topUp.population.length)} ` +
        `label-set pairs with no label outside the earlier draws ` +
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
      committed.topUps.length === 0
        ? `${sampleFile} re-derives from its seed and population.\n`
        : committed.topUps.length === 1
          ? `${sampleFile} re-derives: the first draw from its seed and population, and the ` +
            `top-up from its own; today's label set is what the top-up saw.\n`
          : `${sampleFile} re-derives: the first draw from its seed and population, and each of ` +
            `the ${String(committed.topUps.length)} top-ups from its own; today's label set is what ` +
            `the newest top-up saw.\n`,
    );
  } else if (committed === undefined || redraw) {
    if (committed !== undefined && committed.topUps.length > 0) {
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

/** Today's local date as YYYY-MM-DD: a top-up's default `--date=`. */
function localDate(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
