/**
 * The owner's sample of the dedup label set and the report's sampling error
 * (owner's decision of 2026-10-25, `plan/00` §6 item 284(c); the method is
 * `docs/02` §11.3's note of that date).
 *
 * 1. **The draw** (`scripts/dedup-label-sample.ts`): proportional allocation
 *    by largest remainder with at least one pair per non-empty stratum, the
 *    smallest seeded hashes within a stratum, deterministic under the seed and
 *    independent of input order; the committed file re-derives from its own
 *    seed and population, and its population is today's label set.
 * 2. **The interval maths** (`scripts/dedup-report.ts`): the Wilson score
 *    interval against published values, the met / not met / undecided rule,
 *    and the smallest error-free denominator that can confirm a target.
 * 3. **The report in sample mode**, on the committed corpus (it measures the
 *    owner's 60 labels, given in chat on 2026-11-09 and 2026-11-10) and on a
 *    temporary copy carrying synthetic labels that exist only inside this
 *    test — no label is ever written to the repository by code.
 * 4. **The top-up** (added 2026-11-11; owner's decision, `plan/00` §6 item
 *    366(a); `docs/02` §11.3's note of that date): ten more pairs drawn by
 *    the same method under a new seed from the label-set pairs with no label
 *    outside the first draw — deterministic, never drawn twice, never writing a
 *    label, and measured with the first draw as their union.
 * 5. **Several top-ups** (added 2026-11-12; owner's decision of 2026-11-11,
 *    `plan/00` §6 item 370(d); `docs/02` §11.3's note of 2026-11-12): the
 *    file's numbered blocks `topUp`, `topUp2`, …, the first kept byte for
 *    byte; `--extend=` appends the next and refuses only a repeated seed;
 *    `--check` re-derives each; the report measures the union of all draws.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { dedupeRecords } from "../../../src/sources/shared/dedupe";
import {
  DEDUP_CORPUS_DIR,
  loadCorpusRecords,
  PAIRS_FILE,
  parseJsonl,
  type PairRow,
} from "../../../scripts/build-dedup-corpus";
import {
  allocateProportional,
  buildLabelSample,
  buildTopUp,
  checkLabelSample,
  displayRank,
  drawStratifiedSample,
  LABEL_SAMPLE_SEED,
  LABEL_SAMPLE_SIZE,
  main as sampleMain,
  pageOrderOf,
  sampleRank,
  serializeLabelSample,
  stratifyLabelSet,
  TOP_UP_DATE,
  TOP_UP_SEED,
  TOP_UP_SIZE,
  topUpSeed,
} from "../../../scripts/dedup-label-sample";
import {
  inLabelSet,
  judgeTarget,
  LABEL_SAMPLE_FILE,
  main as reportMain,
  minCleanDenominator,
  parseLabelSample,
  PREDICTIONS,
  sampledPairsOf,
  topUpKey,
  wilsonInterval,
  Z_95,
  type LabelSample,
  type Prediction,
  type StratifiedPair,
} from "../../../scripts/dedup-report";

let committedRows: readonly PairRow[];
let committedSample: LabelSample;
let committedSampleText: string;

beforeAll(async () => {
  committedRows = parseJsonl(
    await readFile(resolve(DEDUP_CORPUS_DIR, PAIRS_FILE), "utf8"),
  );
  committedSampleText = await readFile(
    resolve(DEDUP_CORPUS_DIR, LABEL_SAMPLE_FILE),
    "utf8",
  );
  committedSample = parseLabelSample(committedSampleText);
}, 120_000);

/** A synthetic population: `counts[h]` pairs per stratum, ids `p-<h>-<i>`. */
function population(
  counts: Readonly<Record<Prediction, number>>,
): StratifiedPair[] {
  return PREDICTIONS.flatMap((p) =>
    Array.from({ length: counts[p] }, (_, i) => ({
      pairId: `p-${p}-${String(i)}`,
      stratum: p,
    })),
  );
}

function counts(
  merged: number,
  linked: number,
  flagged: number,
  distinct: number,
): Record<Prediction, number> {
  return { merged, linked, flagged, distinct };
}

const sum = (r: Readonly<Record<Prediction, number>>): number =>
  PREDICTIONS.reduce((n, p) => n + r[p], 0);

// ---------------------------------------------------------------------------
// 1. The draw
// ---------------------------------------------------------------------------

describe("allocateProportional", () => {
  it("splits 60 of the label set's 103 / 65 / 22 / 77 as 23 / 15 / 5 / 17", () => {
    // 60·N_h/267 = 23.15, 14.61, 4.94, 17.30: floors 23 + 14 + 4 + 17 = 58,
    // and the two owed go to the largest remainders, flagged (.94) and linked (.61).
    expect(allocateProportional(counts(103, 65, 22, 77), 60)).toEqual(
      counts(23, 15, 5, 17),
    );
  });

  it("stays within one pair of the exact proportional share, sums to the size, and never exceeds a stratum", () => {
    // A deterministic spread of population shapes, none with a stratum so
    // small that the at-least-one rule has to step in.
    for (let a = 5; a <= 120; a += 23) {
      for (let b = 5; b <= 90; b += 17) {
        for (let c = 5; c <= 40; c += 7) {
          for (const d of [5, 33, 77]) {
            const pop = counts(a, b, c, d);
            const total = sum(pop);
            for (const size of [1, 10, 37, 60, total]) {
              if (size > total) continue;
              const got = allocateProportional(pop, size);
              expect(sum(got)).toBe(size);
              for (const p of PREDICTIONS) {
                expect(got[p]).toBeLessThanOrEqual(pop[p]);
                if (size >= 4 * 5) {
                  expect(
                    Math.abs(got[p] - (size * pop[p]) / total),
                  ).toBeLessThan(1);
                }
              }
            }
          }
        }
      }
    }
  });

  it("gives every non-empty stratum at least one pair, taken from the largest", () => {
    // Exact shares 44.94, 13.48, 0.22, 1.35: largest remainder gives 45 / 14 / 0 / 1,
    // and flagged's one pair comes out of merged.
    expect(allocateProportional(counts(200, 60, 1, 6), 60)).toEqual(
      counts(44, 14, 1, 1),
    );
    expect(allocateProportional(counts(50, 0, 10, 0), 6)).toEqual(
      counts(5, 0, 1, 0),
    );
  });

  it("refuses a size it cannot draw", () => {
    expect(() => allocateProportional(counts(1, 1, 1, 1), 5)).toThrow(
      RangeError,
    );
    expect(() => allocateProportional(counts(1, 1, 1, 1), -1)).toThrow(
      RangeError,
    );
    expect(allocateProportional(counts(1, 1, 1, 1), 0)).toEqual(
      counts(0, 0, 0, 0),
    );
  });
});

describe("drawStratifiedSample", () => {
  const pop = population(counts(103, 65, 22, 77));

  it("is deterministic under the seed and does not depend on input order", () => {
    const one = drawStratifiedSample(pop, 60, LABEL_SAMPLE_SEED);
    const again = drawStratifiedSample(pop, 60, LABEL_SAMPLE_SEED);
    const reversed = drawStratifiedSample(
      [...pop].reverse(),
      60,
      LABEL_SAMPLE_SEED,
    );
    expect(again).toEqual(one);
    expect(reversed).toEqual(one);
  });

  it("draws a different sample under a different seed", () => {
    const one = drawStratifiedSample(pop, 60, LABEL_SAMPLE_SEED);
    const other = drawStratifiedSample(pop, 60, `${LABEL_SAMPLE_SEED} (other)`);
    expect(other.allocation).toEqual(one.allocation);
    expect(other.sample.map((s) => s.pairId)).not.toEqual(
      one.sample.map((s) => s.pairId),
    );
  });

  it("takes each stratum's allocation, and within it exactly the smallest seeded hashes", () => {
    const draw = drawStratifiedSample(pop, 60, LABEL_SAMPLE_SEED);
    const drawn = new Set(draw.sample.map((s) => s.pairId));
    for (const p of PREDICTIONS) {
      const inStratum = pop.filter((x) => x.stratum === p);
      const kept = inStratum.filter((x) => drawn.has(x.pairId));
      const left = inStratum.filter((x) => !drawn.has(x.pairId));
      expect(kept).toHaveLength(draw.allocation[p]);
      const maxKept = kept
        .map((x) => sampleRank(LABEL_SAMPLE_SEED, x.pairId))
        .sort()
        .at(-1);
      for (const x of left) {
        expect(sampleRank(LABEL_SAMPLE_SEED, x.pairId) > (maxKept ?? "")).toBe(
          true,
        );
      }
    }
    expect(draw.sample.map((s) => s.stratum)).toEqual(
      PREDICTIONS.flatMap((p) =>
        Array.from({ length: draw.allocation[p] }, () => p),
      ),
    );
  });

  it("orders the display by the second hash, a permutation of the sample", () => {
    const draw = drawStratifiedSample(pop, 60, LABEL_SAMPLE_SEED);
    expect([...draw.displayOrder].sort()).toEqual(
      draw.sample.map((s) => s.pairId).sort(),
    );
    const ranks = draw.displayOrder.map((id) =>
      displayRank(LABEL_SAMPLE_SEED, id),
    );
    expect(ranks).toEqual([...ranks].sort());
  });

  it("refuses a population that repeats a pair", () => {
    const first = pop[0];
    if (first === undefined) throw new Error("empty population");
    expect(() =>
      drawStratifiedSample([...pop, first], 60, LABEL_SAMPLE_SEED),
    ).toThrow(/repeats/u);
  });
});

describe("test/fixtures/dedup/label-sample.json", () => {
  it("is the owner's 60 under the recorded seed, stratified 23 / 15 / 5 / 17 over 103 / 65 / 22 / 77", () => {
    expect(committedSample.seed).toBe(LABEL_SAMPLE_SEED);
    expect(committedSample.seed).toBe("P2-T13 label sample 2026-10-25");
    expect(committedSample.size).toBe(LABEL_SAMPLE_SIZE);
    expect(LABEL_SAMPLE_SIZE).toBe(60);
    expect(committedSample.strata).toEqual({
      merged: { population: 103, sampled: 23 },
      linked: { population: 65, sampled: 15 },
      flagged: { population: 22, sampled: 5 },
      distinct: { population: 77, sampled: 17 },
    });
  });

  // Updated 2026-11-10 (`P2-T39`, plan/00 §6 item 366(b)): the DOI-family
  // pass added 18 pairs to the label set after the draw. The sample is not
  // redrawn here (item 366(a) draws ten more pairs, by the owner's method,
  // after this card), so its population is today's label set less exactly
  // those 18 — each found only by the DOI-family pass, and unlabelled.
  //
  // Updated 2026-11-11 (plan/00 §6 item 366(a)): the top-up is drawn, so
  // `checkLabelSample` now passes against today's whole label set (285
  // pairs): the first draw re-derives from its 267, the top-up from its own
  // 225, and the label set is what the top-up saw. The 18 stay unlabelled
  // unless the top-up sampled them (the owner labels those in chat).
  //
  // Updated 2026-11-12 (item 370(d)): "the top-up" is now every top-up.
  it("re-derives byte for byte from its own seed and population, and its population is today's label set less the 18 P2-T39 pairs", () => {
    const population = new Set(committedSample.population.map((p) => p.pairId));
    const topUpSampled = new Set(
      committedSample.topUps.flatMap((t) => t.sample.map((s) => s.pairId)),
    );
    const added = committedRows.filter(
      (r) => inLabelSet(r) && !population.has(r.pairId),
    );
    expect(added).toHaveLength(18);
    for (const r of added) {
      expect(r.origins, r.pairId).toEqual(["doi-family"]);
      if (!topUpSampled.has(r.pairId)) expect(r.label, r.pairId).toBe("");
    }
    expect(
      checkLabelSample(
        committedSample,
        committedRows.filter(inLabelSet).map((r) => r.pairId),
      ),
    ).toEqual([]);
    expect(serializeLabelSample(committedSample)).toBe(committedSampleText);
    expect(committedSample.population).toHaveLength(267);
  });

  // Updated 2026-11-11 (plan/00 §6 item 366(a)): both draws' pairs, the
  // first draw's 60 and the top-up's 10. Updated 2026-11-12 (item 370(d)):
  // and top-up 2's 20.
  it("holds no label and no pair outside the label set", () => {
    expect(committedSampleText).not.toMatch(/"label"/u);
    const labelSet = new Set(
      committedRows.filter(inLabelSet).map((r) => r.pairId),
    );
    const sampled = sampledPairsOf(committedSample);
    expect(sampled).toHaveLength(90);
    expect(new Set(sampled.map((s) => s.pairId)).size).toBe(90);
    for (const s of sampled) {
      expect(labelSet.has(s.pairId)).toBe(true);
    }
  });

  it("mixes the strata in display order (the page must not group by the engine's outcome)", () => {
    const stratumOf = new Map(
      committedSample.sample.map((s) => [s.pairId, s.stratum]),
    );
    const sequence = committedSample.displayOrder.map((id) =>
      stratumOf.get(id),
    );
    let runs = 1;
    for (let i = 1; i < sequence.length; i += 1) {
      if (sequence[i] !== sequence[i - 1]) runs += 1;
    }
    expect(runs).toBeGreaterThan(20);
  });

  it("gives the labelling page the 60 ids in display order and nothing about strata", () => {
    const page = JSON.parse(pageOrderOf(committedSample)) as {
      pairIds: string[];
      count: number;
    };
    expect(page.count).toBe(60);
    expect(page.pairIds).toEqual(committedSample.displayOrder);
    expect(pageOrderOf(committedSample)).not.toMatch(
      /merged|linked|flagged|distinct|stratum/u,
    );
  });

  // Draw-day pin, replaced as it said it would be (`P2-T38`, 2026-11-10): the
  // strata are the engine's outcomes as of 2026-10-25, and the DOI-family
  // rule (docs/02 §11.3's note of 2026-11-10, plan/00 §6 item 362(b)) moved
  // eleven sampled pairs to merged. The sample is NOT redrawn (docs/02 §11.3);
  // this pins which pairs moved, and how, instead — the count the report
  // prints as "Sampled pairs whose engine outcome has changed since the draw".
  //
  // Replaced again 2026-11-12 (`P2-T40`, plan/00 §6 item 370(a)–(c)): the
  // family now links, so ten of the eleven are back under their draw-day
  // stratum (linked) and the eleventh, a pair of F1000Research reports on two
  // versions, moved from flagged to linked. The top-up's draw-day pin is
  // replaced by the list of what moved, as it said it would be: 45 of its
  // population, every one from merged to linked, two of them sampled. Top-up 2
  // was drawn after `P2-T40`, so it carries its own draw-day pin.
  it("was stratified by the engine's own outcome on each draw day; since P2-T40 one first-draw pair and 45 of top-up 1's population moved, all to linked", async () => {
    const corpus = await loadCorpusRecords();
    const pool = corpus.records.map((c) => c.record);
    const byId = new Map(pool.map((r) => [r.id, r]));
    const today = new Map(
      stratifyLabelSet(committedRows, byId, dedupeRecords(pool)).map((s) => [
        s.pairId,
        s.stratum,
      ]),
    );
    const moved = committedSample.sample
      .filter((s) => today.get(s.pairId) !== s.stratum)
      .map((s) => `${s.pairId} ${s.stratum} -> ${String(today.get(s.pairId))}`)
      .sort();
    expect(moved).toEqual(["p-f581335f8a55 flagged -> linked"]);
    // The committed file's first draw still re-derives from its own
    // population (updated 2026-11-11: the file now also carries the top-up
    // blocks, kept as they are).
    expect(
      serializeLabelSample({
        ...buildLabelSample(committedSample.population),
        topUps: committedSample.topUps,
      }),
    ).toBe(committedSampleText);
    const [one, two] = committedSample.topUps;
    if (one === undefined || two === undefined) throw new Error("top-ups");
    // Top-up 1: what moved since 2026-11-11.
    const movedOne = one.population.filter(
      (s) => today.get(s.pairId) !== s.stratum,
    );
    expect(movedOne).toHaveLength(45);
    expect(
      new Set(
        movedOne.map((s) => `${s.stratum} -> ${String(today.get(s.pairId))}`),
      ),
    ).toEqual(new Set(["merged -> linked"]));
    const sampledOne = new Set(one.sample.map((s) => s.pairId));
    expect(
      movedOne
        .filter((s) => sampledOne.has(s.pairId))
        .map((s) => s.pairId)
        .sort(),
    ).toEqual(["p-7e83a20f4a2b", "p-df298cf5ca83"]);
    // Draw-day pin for top-up 2 (2026-11-12): stratified by today's engine,
    // so every pair of its population is under its recorded stratum. When the
    // engine moves one, this pin is replaced by a list of what moved.
    expect(
      two.population.filter((s) => today.get(s.pairId) !== s.stratum),
    ).toEqual([]);
  }, 120_000);

  it("refuses a sample file with a defect", () => {
    const raw = JSON.parse(committedSampleText) as Record<string, unknown>;
    const broken = (patch: Record<string, unknown>): string =>
      JSON.stringify({ ...raw, ...patch });
    expect(() => parseLabelSample(broken({ size: 59 }))).toThrow(/size/u);
    expect(() =>
      parseLabelSample(
        broken({ displayOrder: committedSample.displayOrder.slice(1) }),
      ),
    ).toThrow(/permutation/u);
    const first = committedSample.sample[0];
    if (first === undefined) throw new Error("empty sample");
    expect(() =>
      parseLabelSample(
        broken({
          sample: [
            {
              ...first,
              stratum: first.stratum === "merged" ? "distinct" : "merged",
            },
            ...committedSample.sample.slice(1),
          ],
        }),
      ),
    ).toThrow(/not in the population/u);
    // Added 2026-11-11: a top-up that repeats a first-draw pair, or lists a
    // left-out labelled pair that a draw holds, is refused too.
    // Updated 2026-11-12 (item 370(d)): "an earlier draw" for any top-up.
    const t = raw.topUp as Record<string, unknown>;
    const brokenTopUp = (patch: Record<string, unknown>): string =>
      JSON.stringify({ ...raw, topUp: { ...t, ...patch } });
    expect(() => parseLabelSample(brokenTopUp({ size: 9 }))).toThrow(
      /topUp\.sample holds/u,
    );
    const topUpStrata = committedSample.topUps[0]?.strata;
    if (topUpStrata === undefined) throw new Error("no top-up");
    expect(() =>
      parseLabelSample(
        brokenTopUp({
          population: [
            ...(committedSample.topUps[0]?.population ?? []),
            { pairId: first.pairId, stratum: first.stratum },
          ],
          strata: {
            ...topUpStrata,
            [first.stratum]: {
              ...topUpStrata[first.stratum],
              population: topUpStrata[first.stratum].population + 1,
            },
          },
        }),
      ),
    ).toThrow(/which an earlier draw sampled/u);
    expect(() =>
      parseLabelSample(brokenTopUp({ excludedLabelled: [first.pairId] })),
    ).toThrow(/excludedLabelled holds/u);
    expect(() => parseLabelSample(brokenTopUp({ date: 20261111 }))).toThrow(
      /topUp\."date"/u,
    );
    // Added 2026-11-12 (item 370(d)): a later block may not repeat a seed,
    // hold a pair an earlier top-up sampled, or skip a number.
    const t2 = raw.topUp2 as Record<string, unknown>;
    const brokenTopUp2 = (patch: Record<string, unknown>): string =>
      JSON.stringify({ ...raw, topUp2: { ...t2, ...patch } });
    expect(() =>
      parseLabelSample(brokenTopUp2({ seed: committedSample.seed })),
    ).toThrow(/topUp2\.seed repeats the seed of an earlier draw/u);
    const oneSampled = committedSample.topUps[0]?.sample[0];
    const two = committedSample.topUps[1];
    if (oneSampled === undefined || two === undefined) {
      throw new Error("top-ups");
    }
    expect(() =>
      parseLabelSample(
        brokenTopUp2({
          population: [...two.population, oneSampled],
          strata: {
            ...two.strata,
            [oneSampled.stratum]: {
              ...two.strata[oneSampled.stratum],
              population: two.strata[oneSampled.stratum].population + 1,
            },
          },
        }),
      ),
    ).toThrow(/topUp2\.population holds .*which an earlier draw sampled/u);
    const { topUp2: moved, ...withoutTwo } = raw;
    expect(() =>
      parseLabelSample(JSON.stringify({ ...withoutTwo, topUp3: moved })),
    ).toThrow(/"topUp3" is not the next top-up block \(expected "topUp2"\)/u);
    expect([0, 1, 2].map(topUpKey)).toEqual(["topUp", "topUp2", "topUp3"]);
  });
});

// ---------------------------------------------------------------------------
// 2. The interval maths
// ---------------------------------------------------------------------------

describe("wilsonInterval", () => {
  it("matches published 95 % Wilson intervals (Newcombe 1998, Table I)", () => {
    const cases: [number, number, number, number][] = [
      [81, 263, 0.2553, 0.3662],
      [15, 148, 0.0624, 0.1605],
      [0, 20, 0, 0.1611],
      [1, 29, 0.0061, 0.1718],
    ];
    for (const [k, n, low, high] of cases) {
      const w = wilsonInterval(k, n);
      expect(w?.low).toBeCloseTo(low, 4);
      expect(w?.high).toBeCloseTo(high, 4);
    }
  });

  it("is exact at the ends: [0, ·] for no success, [n/(n+z²), 1] for all", () => {
    for (const n of [1, 5, 23, 60, 381]) {
      expect(wilsonInterval(0, n)?.low).toBe(0);
      expect(wilsonInterval(n, n)?.high).toBe(1);
      expect(wilsonInterval(n, n)?.low).toBeCloseTo(n / (n + Z_95 * Z_95), 12);
    }
  });

  it("is symmetric: the interval for k of n mirrors the one for n − k", () => {
    for (const [k, n] of [
      [3, 23],
      [12, 25],
      [59, 60],
    ] as const) {
      const w = wilsonInterval(k, n);
      const m = wilsonInterval(n - k, n);
      expect(w?.low).toBeCloseTo(1 - (m?.high ?? Number.NaN), 12);
      expect(w?.high).toBeCloseTo(1 - (m?.low ?? Number.NaN), 12);
    }
  });

  it("gives the figures docs/02 §11.3 quotes for the sample", () => {
    expect(wilsonInterval(23, 23)?.low).toBeCloseTo(0.8569, 4);
    expect(wilsonInterval(22, 23)?.low).toBeCloseTo(0.7901, 4);
    expect(wilsonInterval(22, 23)?.high).toBeCloseTo(0.9923, 4);
    expect(wilsonInterval(21, 23)?.high).toBeCloseTo(0.9758, 4);
    expect(wilsonInterval(22, 25)?.low).toBeCloseTo(0.7004, 4);
    expect(wilsonInterval(22, 25)?.high).toBeCloseTo(0.9583, 4);
    expect(wilsonInterval(103, 103)?.low).toBeCloseTo(0.964, 3);
  });

  it("returns null for an empty denominator and refuses impossible counts", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(() => wilsonInterval(3, 2)).toThrow(RangeError);
    expect(() => wilsonInterval(-1, 2)).toThrow(RangeError);
    expect(() => wilsonInterval(1.5, 2)).toThrow(RangeError);
  });
});

describe("judgeTarget and minCleanDenominator", () => {
  it("is met only above, not met only below, and undecided across the target", () => {
    expect(judgeTarget({ low: 0.991, high: 1 }, 0.99)).toBe("met");
    expect(judgeTarget({ low: 0.99, high: 1 }, 0.99)).toBe("met");
    expect(judgeTarget({ low: 0.7, high: 0.989 }, 0.99)).toBe("not met");
    expect(judgeTarget({ low: 0.857, high: 1 }, 0.99)).toBe("undecided");
    expect(judgeTarget(null, 0.99)).toBe("undecided");
    // One false merge among the 23 sampled merged pairs does not refute 0.99; two do.
    expect(judgeTarget(wilsonInterval(22, 23), 0.99)).toBe("undecided");
    expect(judgeTarget(wilsonInterval(21, 23), 0.99)).toBe("not met");
  });

  it("needs 381 error-free merged pairs to confirm 0.99 and 35 duplicates to confirm 0.90", () => {
    expect(minCleanDenominator(0.99)).toBe(381);
    expect(minCleanDenominator(0.9)).toBe(35);
    for (const t of [0.99, 0.9]) {
      const n = minCleanDenominator(t);
      expect(judgeTarget(wilsonInterval(n, n), t)).toBe("met");
      expect(judgeTarget(wilsonInterval(n - 1, n - 1), t)).toBe("undecided");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The report in sample mode
// ---------------------------------------------------------------------------

describe("npm run dedup:report in sample mode (the default)", () => {
  // Updated 2026-11-11 (plan/00 §6 item 366(a)): the sample is now the union
  // of the first draw's 60 (labelled by the owner, 2026-11-10) and the
  // top-up's 10. While any of the 70 is unlabelled the report refuses, as it
  // always has, naming the count per draw; --allow-partial measures the
  // labelled ones and says how many of the 70 carry a label.
  //
  // Updated 2026-11-12 (item 370(d)): the union of every draw, now 90 pairs
  // with top-up 2's 20, which the owner labels in chat after this card.
  it("measures the committed corpus over every draw, and refuses without --allow-partial while a sampled pair is unlabelled", async () => {
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const labelOf = new Map(committedRows.map((r) => [r.pairId, r.label]));
      const labelledOf = (ids: readonly StratifiedPair[]): number =>
        ids.filter((s) => labelOf.get(s.pairId) !== "").length;
      expect(committedSample.topUps.map((t) => t.size)).toEqual([10, 20]);
      const firstLabelled = labelledOf(committedSample.sample);
      expect(firstLabelled).toBe(60);
      const perTopUp = committedSample.topUps.map((t) => labelledOf(t.sample));
      const labelled = firstLabelled + perTopUp.reduce((n, k) => n + k, 0);
      const unlabelled = 90 - labelled;
      const byDraw =
        `(of the 90 sampled pairs, ${String(labelled)} have labels: first draw 60 of 60, ` +
        `top-up 1 ${String(perTopUp[0])} of 10, top-up 2 ${String(perTopUp[1])} of 20)`;
      if (unlabelled > 0) {
        expect(await reportMain([])).toBe(1);
        expect(err.mock.calls.map((c) => String(c[0])).join("")).toContain(
          `${String(unlabelled)} of 90 sampled pairs have no label ` +
            `(first draw 60 of 60 labelled, top-up 1 ${String(perTopUp[0])} of 10 labelled, ` +
            `top-up 2 ${String(perTopUp[1])} of 20 labelled)`,
        );
        expect(await reportMain(["--allow-partial"])).toBe(0);
      } else {
        expect(await reportMain([])).toBe(0);
      }
      const said = out.mock.calls.map((c) => String(c[0])).join("");
      expect(said).toContain(
        `Labelled pairs measured: ${String(labelled)} ${byDraw}`,
      );
      expect(said).toContain(
        "the union is NOT one stratified draw: its labelled pairs are pooled as they are, without weights",
      );
      expect(said).toMatch(/Precision \d/u);
      expect(said).toMatch(/Recall {4}\d/u);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  }, 120_000);

  it("refuses --full together with --sample=", async () => {
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      expect(await reportMain(["--full", "--sample=x.json"])).toBe(2);
    } finally {
      err.mockRestore();
    }
  });

  it("refuses a sample naming a pair the file no longer holds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dedup-sample-"));
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const gone = committedSample.sample[0]?.pairId;
      const file = join(dir, "pairs.jsonl");
      await writeFile(
        file,
        committedRows
          .filter((r) => r.pairId !== gone)
          .map((r) => `${JSON.stringify(r)}\n`)
          .join(""),
      );
      expect(await reportMain([file])).toBe(1);
      expect(String(err.mock.calls[0]?.[0])).toMatch(/no longer holds/u);
    } finally {
      err.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Updated 2026-11-11 (plan/00 §6 item 366(a)): the committed sample file
  // now carries the top-up, so the single-draw output is pinned on a copy of
  // the file without its top-up block (`--sample=`), and the union's output
  // on the committed file with the top-up's pairs given synthetic labels too.
  //
  // Updated 2026-11-12 (`P2-T40`; item 370(d)): today's engine links the
  // family, so the first draw's synthetic duplicates are its 23 merged pairs
  // again and one pair has moved; the two-draw union is pinned on a copy
  // without top-up 2, and the three-draw union on the committed file.
  it("states each target with its Wilson interval and says plainly when the interval cannot decide", async () => {
    // Synthetic labels, in a temporary copy only: each sampled pair is given
    // the label that agrees with the engine's outcome today, so precision and
    // recall are both 23 of 23 on the first draw, 26 of 26 on the first two
    // draws (top-up 1 adds the 3 of its 5 merged pairs that are still
    // merged) and 33 of 33 on all three (top-up 2 adds 7). Nothing here is a
    // human label or reaches the repository.
    const dir = await mkdtemp(join(tmpdir(), "dedup-sample-"));
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const corpus = await loadCorpusRecords();
      const pool = corpus.records.map((c) => c.record);
      const byId = new Map(pool.map((r) => [r.id, r]));
      const todayOf = new Map(
        stratifyLabelSet(committedRows, byId, dedupeRecords(pool)).map((s) => [
          s.pairId,
          s.stratum,
        ]),
      );
      const synthetic = async (
        name: string,
        sampled: readonly StratifiedPair[],
      ): Promise<string> => {
        const stratumOf = new Map(
          sampled.map((s) => [s.pairId, todayOf.get(s.pairId)]),
        );
        const outside = committedRows.find(
          (r) => inLabelSet(r) && !stratumOf.has(r.pairId),
        )?.pairId;
        const file = join(dir, name);
        await writeFile(
          file,
          committedRows
            .map((r) => {
              const s = stratumOf.get(r.pairId);
              const label =
                s === undefined
                  ? r.pairId === outside
                    ? "not-duplicate"
                    : ""
                  : s === "merged"
                    ? "duplicate"
                    : "not-duplicate";
              return `${JSON.stringify({ ...r, label, reason: label === "" ? "" : "synthetic" })}\n`;
            })
            .join(""),
        );
        return file;
      };
      const firstOnly = join(dir, "first-draw-only.json");
      await writeFile(
        firstOnly,
        serializeLabelSample({ ...committedSample, topUps: [] }),
      );

      // The first draw alone: the output as it was before the top-up.
      const file = await synthetic("first.jsonl", committedSample.sample);
      expect(await reportMain([file, `--sample=${firstOnly}`])).toBe(0);
      const text = out.mock.calls.map((c) => String(c[0])).join("");
      out.mockClear();
      expect(text).toContain(
        `Mode: the owner's sample (owner, 2026-10-25): 60 label-set pairs`,
      );
      expect(text).toContain(`seed "P2-T13 label sample 2026-10-25"`);
      expect(text).toMatch(/ merged +103 +23 +23\n/u);
      expect(text).toMatch(/ flagged +22 +5 +5\n/u);
      expect(text).toContain(
        "Sampled pairs whose engine outcome has changed since the draw: 1",
      );
      expect(text).toContain(
        "Labelled label-set pairs outside the sample, not measured in this mode: 1",
      );
      expect(text).toContain(
        "Precision 1.0000   95 % Wilson interval [0.8569, 1.0000] over 23 merged pairs   " +
          "target ≥ 0.99   UNDECIDED: the interval is too wide to decide the target — " +
          "even with no error the low end reaches 0.99 only from 381 merged pairs",
      );
      expect(text).toContain(
        "Recall    1.0000   95 % Wilson interval [0.8569, 1.0000] over 23 true duplicates   " +
          "target ≥ 0.9   UNDECIDED",
      );
      expect(text).toContain("Labelled pairs measured: 60\n");
      expect(text).not.toContain("Top-up");

      // The first draw and top-up 1: the union of two draws.
      const [one, two] = committedSample.topUps;
      if (one === undefined || two === undefined) throw new Error("top-ups");
      const firstTwo = join(dir, "first-two.json");
      await writeFile(
        firstTwo,
        serializeLabelSample({ ...committedSample, topUps: [one] }),
      );
      const twoDraws = await synthetic("two.jsonl", [
        ...committedSample.sample,
        ...one.sample,
      ]);
      expect(await reportMain([twoDraws, `--sample=${firstTwo}`])).toBe(0);
      const pair = out.mock.calls.map((c) => String(c[0])).join("");
      out.mockClear();
      expect(pair).toContain(
        `Top-up 1 (owner, 2026-11-11, plan/00 §6 item 366(a); docs/02 §11.3): 10 more pairs, ` +
          `seed "P2-T13 label sample top-up 2026-11-11", drawn from the 225 label-set pairs ` +
          `that had no label and were in no earlier draw`,
      );
      expect(pair).toMatch(/ merged +125 +5 +5\n/u);
      expect(pair).toMatch(/ distinct +60 +3 +3\n/u);
      expect(pair).toContain(
        "The measured sample is the union of the two draws (60 + 10 = 70 pairs). " +
          "Each top-up was drawn after the engine changed",
      );
      expect(pair).toContain(
        "Sampled pairs whose engine outcome has changed since their draw: 3",
      );
      expect(pair).toContain(
        "Labelled pairs measured: 70 (of the 70 sampled pairs, 70 have labels: " +
          "first draw 60 of 60, top-up 1 10 of 10)",
      );
      expect(pair).toContain(
        "Precision 1.0000   95 % Wilson interval [0.8713, 1.0000] over 26 merged pairs   " +
          "target ≥ 0.99   UNDECIDED",
      );
      expect(pair).not.toContain("Top-up 2");

      // All three draws, on the committed sample file.
      const union = await synthetic(
        "union.jsonl",
        sampledPairsOf(committedSample),
      );
      expect(await reportMain([union])).toBe(0);
      const all = out.mock.calls.map((c) => String(c[0])).join("");
      expect(all).toContain(
        `Top-up 2 (owner, 2026-11-11, plan/00 §6 item 370(d); docs/02 §11.3): 20 more pairs, ` +
          `seed "P2-T13 label sample top-up 2 2026-11-12", drawn from the 215 label-set pairs ` +
          `that had no label and were in no earlier draw, stratified by the engine's outcome ` +
          `on 2026-11-12 in proportion`,
      );
      expect(all).toMatch(/ merged +103 +23 +23\n/u);
      expect(all).toMatch(/ merged +125 +5 +5\n/u);
      expect(all).toMatch(/ merged +77 +7 +7\n/u);
      expect(all).toMatch(/ linked +70 +7 +7\n/u);
      expect(all).toContain(
        "The measured sample is the union of the three draws (60 + 10 + 20 = 90 pairs). " +
          "Each top-up was drawn after the engine changed and from a different population, " +
          "so the union is NOT one stratified draw",
      );
      expect(all).toContain(
        "Sampled pairs whose engine outcome has changed since their draw: 3",
      );
      expect(all).toContain(
        "Labelled pairs measured: 90 (of the 90 sampled pairs, 90 have labels: " +
          "first draw 60 of 60, top-up 1 10 of 10, top-up 2 20 of 20)",
      );
      expect(all).toContain(
        "Precision 1.0000   95 % Wilson interval [0.8957, 1.0000] over 33 merged pairs   " +
          "target ≥ 0.99   UNDECIDED",
      );
      expect(all).toContain(
        "Recall    1.0000   95 % Wilson interval [0.8957, 1.0000] over 33 true duplicates   " +
          "target ≥ 0.9   UNDECIDED",
      );
    } finally {
      out.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 4. The top-ups (owner's decisions of 2026-11-11, plan/00 §6 items 366(a)
//    and 370(d); docs/02 §11.3's notes of 2026-11-11 and 2026-11-12)
// ---------------------------------------------------------------------------

/** Minimal corpus rows for {@link buildTopUp}: it reads pair ids and labels only. */
function rowsOf(
  ids: readonly string[],
  labelled: ReadonlySet<string>,
): PairRow[] {
  return ids.map(
    (pairId) =>
      ({
        pairId,
        label: labelled.has(pairId) ? "duplicate" : "",
        reason: "",
      }) as unknown as PairRow,
  );
}

describe("buildTopUp", () => {
  // A synthetic label set of 267, its first draw of 60, and 18 pairs added
  // after the draw — the committed shape, with made-up ids.
  const firstPop = population(counts(103, 65, 22, 77));
  const first = buildLabelSample(firstPop);
  const added: StratifiedPair[] = Array.from({ length: 18 }, (_, i) => ({
    pairId: `p-added-${String(i)}`,
    stratum: "merged",
  }));
  const today = [...firstPop, ...added];
  const firstSampled = new Set(first.sample.map((s) => s.pairId));
  // Five pairs outside the first draw carry a label today.
  const labelled = new Set(
    today
      .filter((p) => !firstSampled.has(p.pairId))
      .slice(0, 5)
      .map((p) => p.pairId),
  );
  for (const id of firstSampled) labelled.add(id);
  const rows = rowsOf(
    today.map((p) => p.pairId),
    labelled,
  );

  it("draws its population from the unlabelled label-set pairs outside the first draw, and records the labelled ones it left out", () => {
    const t = buildTopUp(first, rows, today);
    const pop = new Set(t.population.map((p) => p.pairId));
    expect(t.population).toHaveLength(285 - 60 - 5);
    for (const id of firstSampled) expect(pop.has(id)).toBe(false);
    for (const id of labelled) expect(pop.has(id)).toBe(false);
    expect(t.excludedLabelled).toHaveLength(5);
    for (const id of t.excludedLabelled) {
      expect(firstSampled.has(id)).toBe(false);
      expect(labelled.has(id)).toBe(true);
    }
    for (const a of added) expect(pop.has(a.pairId)).toBe(true);
    for (const s of t.sample) {
      expect(pop.has(s.pairId)).toBe(true);
      expect(firstSampled.has(s.pairId)).toBe(false);
    }
  });

  it("allocates 10 in proportion by the same rule, summing to 10", () => {
    const t = buildTopUp(first, rows, today);
    expect(t.size).toBe(TOP_UP_SIZE);
    expect(TOP_UP_SIZE).toBe(10);
    expect(t.sample).toHaveLength(10);
    expect(PREDICTIONS.reduce((n, p) => n + t.strata[p].sampled, 0)).toBe(10);
    const popCounts = Object.fromEntries(
      PREDICTIONS.map((p) => [p, t.strata[p].population]),
    ) as Record<Prediction, number>;
    expect(
      Object.fromEntries(PREDICTIONS.map((p) => [p, t.strata[p].sampled])),
    ).toEqual(allocateProportional(popCounts, 10));
    // The committed top-up's own counts: 10·N_h/225 = 5.56, 1.24, 0.53, 2.67;
    // floors 5 + 1 + 0 + 2 = 8, the two owed to distinct (.67) and flagged (.53).
    expect(allocateProportional(counts(125, 28, 12, 60), 10)).toEqual(
      counts(5, 1, 1, 3),
    );
    // Top-up 2's (2026-11-12): 20·N_h/215 = 7.16, 6.51, 1.02, 5.30; floors
    // 7 + 6 + 1 + 5 = 19, the one owed to linked (.51).
    expect(allocateProportional(counts(77, 70, 11, 57), 20)).toEqual(
      counts(7, 7, 1, 5),
    );
  });

  it("is deterministic under its seed, independent of input order, and differs under another seed", () => {
    const one = buildTopUp(first, rows, today);
    expect(
      buildTopUp(first, [...rows].reverse(), [...today].reverse()),
    ).toEqual(one);
    expect(one.seed).toBe(TOP_UP_SEED);
    expect(one.seed).toBe("P2-T13 label sample top-up 2026-11-11");
    expect(one.date).toBe(TOP_UP_DATE);
    const other = buildTopUp(first, rows, today, 10, {
      seed: `${TOP_UP_SEED} (other)`,
    });
    expect(other.sample.map((s) => s.pairId)).not.toEqual(
      one.sample.map((s) => s.pairId),
    );
    const ranks = one.displayOrder.map((id) => displayRank(TOP_UP_SEED, id));
    expect(ranks).toEqual([...ranks].sort());
  });

  // Replaced 2026-11-12 (item 370(d)): a second top-up was refused; now the
  // next block is drawn, and only a seed an earlier draw used is refused.
  it("draws the next top-up from the pairs in no earlier draw, under its own default seed, and refuses only a repeated seed", () => {
    const once = { ...first, topUps: [buildTopUp(first, rows, today)] };
    const oneSampled = new Set(once.topUps[0]?.sample.map((s) => s.pairId));
    const second = buildTopUp(once, rows, today, 20, { date: "2026-11-12" });
    expect(second.seed).toBe("P2-T13 label sample top-up 2 2026-11-12");
    expect(second.seed).toBe(topUpSeed(2, "2026-11-12"));
    expect(topUpSeed(1, TOP_UP_DATE)).toBe(TOP_UP_SEED);
    expect(second.sample).toHaveLength(20);
    // Its population is the first top-up's less the ten that one drew.
    expect(second.population).toHaveLength(285 - 60 - 5 - 10);
    for (const p of second.population) {
      expect(firstSampled.has(p.pairId)).toBe(false);
      expect(oneSampled.has(p.pairId)).toBe(false);
      expect(labelled.has(p.pairId)).toBe(false);
    }
    expect(second.excludedLabelled).toEqual(once.topUps[0]?.excludedLabelled);
    expect(second.method).toMatch(/no earlier draw's sample/u);
    expect(second.method).not.toBe(once.topUps[0]?.method);
    expect(() =>
      buildTopUp(once, rows, today, 10, { seed: TOP_UP_SEED }),
    ).toThrow(/already used by an earlier draw/u);
    expect(() =>
      buildTopUp(once, rows, today, 10, { seed: first.seed }),
    ).toThrow(/already used by an earlier draw/u);
    // The default seed of the first top-up on its own day is the one it used.
    expect(() =>
      buildTopUp(once, rows, today, 10, { date: TOP_UP_DATE }),
    ).not.toThrow();
  });

  it("never writes a label: its rows are untouched and its blocks hold none", () => {
    const before = JSON.stringify(rows);
    const withTopUp = { ...first, topUps: [buildTopUp(first, rows, today)] };
    const withTwo = {
      ...withTopUp,
      topUps: [
        ...withTopUp.topUps,
        buildTopUp(withTopUp, rows, today, 20, { date: "2026-11-12" }),
      ],
    };
    expect(JSON.stringify(rows)).toBe(before);
    for (const s of [withTopUp, withTwo]) {
      expect(serializeLabelSample(s)).not.toMatch(/"label"/u);
      // The serialized file reads back as written, and its check passes
      // against the label set the newest top-up saw.
      expect(parseLabelSample(serializeLabelSample(s))).toEqual(s);
      expect(
        checkLabelSample(
          s,
          today.map((p) => p.pairId),
        ),
      ).toEqual([]);
    }
    // Appending a block changes nothing before it.
    const one = serializeLabelSample(withTopUp);
    expect(
      serializeLabelSample(withTwo).startsWith(one.slice(0, -"\n}\n".length)),
    ).toBe(true);
    expect(serializeLabelSample(withTwo)).toContain('\n  "topUp2": {\n');
  });

  it("makes --check fail when the label set grows again, when a first-draw pair goes, or when a top-up is edited", () => {
    const withTopUp = { ...first, topUps: [buildTopUp(first, rows, today)] };
    const ids = today.map((p) => p.pairId);
    expect(checkLabelSample(withTopUp, [...ids, "p-new"])).toEqual([
      expect.stringMatching(/the label set top-up 1 saw \(285 pairs/u),
    ]);
    const gone = firstPop.find((p) => !firstSampled.has(p.pairId))?.pairId;
    expect(
      checkLabelSample(
        withTopUp,
        ids.filter((id) => id !== gone),
      ).join("\n"),
    ).toMatch(/no longer in the label set/u);
    const t = withTopUp.topUps[0];
    if (t === undefined) throw new Error("no top-up");
    const swapped = t.population.find(
      (p) =>
        p.stratum === "merged" && !t.sample.some((s) => s.pairId === p.pairId),
    );
    if (swapped === undefined) throw new Error("no unsampled merged pair");
    const edited = t.sample.map((s, i) =>
      i === 0 ? { pairId: swapped.pairId, stratum: s.stratum } : s,
    );
    expect(
      checkLabelSample(
        {
          ...withTopUp,
          topUps: [
            { ...t, sample: edited, displayOrder: edited.map((s) => s.pairId) },
          ],
        },
        ids,
      ),
    ).toEqual(["top-up 1 does not re-derive from its own population and seed"]);
  });

  it("with two top-ups, checks the newest against today's label set and the earlier one only for pairs gone", () => {
    const one = buildTopUp(first, rows, today);
    const two = buildTopUp({ ...first, topUps: [one] }, rows, today, 20, {
      date: "2026-11-12",
    });
    const both = { ...first, topUps: [one, two] };
    const ids = today.map((p) => p.pairId);
    expect(checkLabelSample(both, ids)).toEqual([]);
    expect(checkLabelSample(both, [...ids, "p-new"])).toEqual([
      expect.stringMatching(
        /^the label set top-up 2 saw \(285 pairs: the earlier draws' 70, its population of 210 and 5 labelled pairs left out\)/u,
      ),
    ]);
    // A pair top-up 1 drew leaves the label set: top-up 1 saw it and top-up 2
    // counted it among the earlier draws' pairs.
    const drawnByOne = one.sample[0]?.pairId;
    expect(
      checkLabelSample(
        both,
        ids.filter((id) => id !== drawnByOne),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^1 pairs that top-up 1 saw are no longer in the label set/u,
        ),
        expect.stringMatching(/^the label set top-up 2 saw/u),
      ]),
    );
    const edited = { ...two, seed: `${two.seed} (edited)` };
    expect(checkLabelSample({ ...both, topUps: [one, edited] }, ids)).toEqual([
      "top-up 2 does not re-derive from its own population and seed",
    ]);
  });
});

// Reworked 2026-11-12 (`P2-T40`; item 370(d)): the first top-up's draw-day pin
// cannot hold after `P2-T40` moved 45 pairs of its population, so the
// re-drawing run is now top-up 2's, drawn the same day; the first top-up's
// header still re-derives under its own defaults.
describe("dedup-label-sample.ts --extend= on a temporary copy", () => {
  it("draws the committed top-up 2 from today's corpus, writes no label, and refuses only a repeated seed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dedup-topup-"));
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const [one, two] = committedSample.topUps;
      if (one === undefined || two === undefined) throw new Error("top-ups");
      // The corpus as it was at the draw: top-up 2's twenty unlabelled (the
      // owner labels them in chat afterwards; this clears them in the copy
      // only).
      const drawn = new Set(two.sample.map((s) => s.pairId));
      const pairsText = committedRows
        .map(
          (r) =>
            `${JSON.stringify(drawn.has(r.pairId) ? { ...r, label: "", reason: "" } : r)}\n`,
        )
        .join("");
      await writeFile(join(dir, PAIRS_FILE), pairsText);
      const beforeText = serializeLabelSample({
        ...committedSample,
        topUps: [one],
      });
      await writeFile(join(dir, LABEL_SAMPLE_FILE), beforeText);
      const args = [
        "--extend=20",
        "--date=2026-11-12",
        "--decision=owner, 2026-11-11, plan/00 §6 item 370(d); docs/02 §11.3",
      ];

      expect(await sampleMain(args, { dir })).toBe(0);
      const written = await readFile(join(dir, LABEL_SAMPLE_FILE), "utf8");
      // Draw-day pin (2026-11-12): today's engine draws exactly the committed
      // twenty, and everything before the new block is unchanged.
      expect(written).toBe(committedSampleText);
      expect(
        written.startsWith(beforeText.slice(0, -"\n}\n".length) + ",\n"),
      ).toBe(true);
      expect(await readFile(join(dir, PAIRS_FILE), "utf8")).toBe(pairsText);
      expect(written).not.toMatch(/"label"/u);
      expect(String(out.mock.calls.at(-1)?.[0])).toContain(
        'Appended top-up 2 ("topUp2")',
      );
      expect(String(out.mock.calls.at(-1)?.[0])).toContain(
        "No label was written.",
      );

      // The same seed again: refused, nothing written. (Without --seed= the
      // default seed carries the next block number, so repeating the command
      // as it was would draw a third block: only a repeated seed is refused.)
      expect(await sampleMain([...args, `--seed=${two.seed}`], { dir })).toBe(
        1,
      );
      expect(String(err.mock.calls.at(-1)?.[0])).toMatch(
        /already holds a draw under the seed "P2-T13 label sample top-up 2 2026-11-12".* Nothing was written/u,
      );
      expect(
        await sampleMain(
          ["--extend=5", "--date=2026-11-12", `--seed=${TOP_UP_SEED}`],
          { dir },
        ),
      ).toBe(1);
      expect(await sampleMain(["--redraw"], { dir })).toBe(1);
      expect(await readFile(join(dir, LABEL_SAMPLE_FILE), "utf8")).toBe(
        written,
      );
      expect(await sampleMain(["--check"], { dir })).toBe(0);
      expect(await sampleMain(["--extend=ten"], { dir })).toBe(2);
      expect(
        await sampleMain(["--extend=5", "--date=12 Nov 2026"], { dir }),
      ).toBe(2);
      expect(await sampleMain(["--seed=x"], { dir })).toBe(2);

      // A new seed is the next block, topUp3, and --check passes on it.
      expect(
        await sampleMain(["--extend=5", "--date=2026-11-13"], { dir }),
      ).toBe(0);
      const three = parseLabelSample(
        await readFile(join(dir, LABEL_SAMPLE_FILE), "utf8"),
      );
      expect(three.topUps.map((t) => t.seed)).toEqual([
        one.seed,
        two.seed,
        "P2-T13 label sample top-up 3 2026-11-13",
      ]);
      expect(await sampleMain(["--check"], { dir })).toBe(0);

      // The first top-up's header still comes from its own defaults: from the
      // first draw alone, --extend=10 --date=2026-11-11 names it as committed
      // (its pairs differ today, because P2-T40 moved its population).
      await writeFile(
        join(dir, LABEL_SAMPLE_FILE),
        serializeLabelSample({ ...committedSample, topUps: [] }),
      );
      await writeFile(join(dir, PAIRS_FILE), pairsText);
      expect(
        await sampleMain(["--extend=10", "--date=2026-11-11"], { dir }),
      ).toBe(0);
      const redone = parseLabelSample(
        await readFile(join(dir, LABEL_SAMPLE_FILE), "utf8"),
      ).topUps[0];
      expect(redone?.seed).toBe(one.seed);
      expect(redone?.decision).toBe(one.decision);
      expect(redone?.method).toBe(one.method);
      expect(redone?.date).toBe(one.date);
    } finally {
      out.mockRestore();
      err.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
