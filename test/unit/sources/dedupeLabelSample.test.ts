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
  it("re-derives byte for byte from its own seed and population, and its population is today's label set less the 18 P2-T39 pairs", () => {
    const population = new Set(committedSample.population.map((p) => p.pairId));
    const topUpSampled = new Set(
      committedSample.topUp?.sample.map((s) => s.pairId) ?? [],
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
  // first draw's 60 and the top-up's 10.
  it("holds no label and no pair outside the label set", () => {
    expect(committedSampleText).not.toMatch(/"label"/u);
    const labelSet = new Set(
      committedRows.filter(inLabelSet).map((r) => r.pairId),
    );
    const sampled = sampledPairsOf(committedSample);
    expect(sampled).toHaveLength(70);
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
  it("was stratified by the engine's own outcome on the draw day; since then exactly the P2-T38 eleven moved, all to merged", async () => {
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
    expect(moved).toEqual(
      [
        "p-136a40c667ec linked -> merged",
        "p-1588230667d8 linked -> merged",
        "p-1714f98efd0e linked -> merged",
        "p-3a7cc467c9f3 linked -> merged",
        "p-5671166c13d8 linked -> merged",
        "p-6caef4b71a46 linked -> merged",
        "p-770263a3b79f linked -> merged",
        "p-940c511c1fe1 linked -> merged",
        "p-95df2d7ba01d linked -> merged",
        "p-f446658730ea linked -> merged",
        "p-f581335f8a55 flagged -> merged",
      ].sort(),
    );
    // The committed file's first draw still re-derives from its own
    // population (updated 2026-11-11: the file now also carries the top-up
    // block, kept as it is).
    expect(
      serializeLabelSample({
        ...buildLabelSample(committedSample.population),
        ...(committedSample.topUp !== undefined && {
          topUp: committedSample.topUp,
        }),
      }),
    ).toBe(committedSampleText);
    // Draw-day pin for the top-up (2026-11-11): it was stratified by the
    // engine's outcome that day, so today every one of its population's
    // pairs is under its recorded stratum. When the engine moves one, this
    // pin is replaced by a list of what moved, as the first draw's was.
    const topUp = committedSample.topUp;
    if (topUp === undefined) throw new Error("no top-up");
    expect(
      topUp.population.filter((s) => today.get(s.pairId) !== s.stratum),
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
    const t = raw.topUp as Record<string, unknown>;
    const brokenTopUp = (patch: Record<string, unknown>): string =>
      JSON.stringify({ ...raw, topUp: { ...t, ...patch } });
    expect(() => parseLabelSample(brokenTopUp({ size: 9 }))).toThrow(
      /topUp\.sample holds/u,
    );
    const topUpStrata = committedSample.topUp?.strata;
    if (topUpStrata === undefined) throw new Error("no top-up");
    expect(() =>
      parseLabelSample(
        brokenTopUp({
          population: [
            ...(committedSample.topUp?.population ?? []),
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
    ).toThrow(/which the first draw sampled/u);
    expect(() =>
      parseLabelSample(brokenTopUp({ excludedLabelled: [first.pairId] })),
    ).toThrow(/excludedLabelled holds/u);
    expect(() => parseLabelSample(brokenTopUp({ date: 20261111 }))).toThrow(
      /topUp\."date"/u,
    );
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
  it("measures the committed corpus over both draws, and refuses without --allow-partial while a top-up pair is unlabelled", async () => {
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const labelOf = new Map(committedRows.map((r) => [r.pairId, r.label]));
      const topUpIds = committedSample.topUp?.sample.map((s) => s.pairId) ?? [];
      expect(topUpIds).toHaveLength(10);
      const topUpLabelled = topUpIds.filter(
        (id) => labelOf.get(id) !== "",
      ).length;
      const firstLabelled = committedSample.sample.filter(
        (s) => labelOf.get(s.pairId) !== "",
      ).length;
      expect(firstLabelled).toBe(60);
      const labelled = firstLabelled + topUpLabelled;
      const byDraw =
        `(of the 70 sampled pairs, ${String(labelled)} have labels: first draw 60 of 60, ` +
        `top-up ${String(topUpLabelled)} of 10)`;
      if (topUpLabelled < 10) {
        expect(await reportMain([])).toBe(1);
        expect(err.mock.calls.map((c) => String(c[0])).join("")).toContain(
          `${String(10 - topUpLabelled)} of 70 sampled pairs have no label ` +
            `(first draw 60 of 60 labelled, top-up ${String(topUpLabelled)} of 10 labelled)`,
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
  it("states each target with its Wilson interval and says plainly when the interval cannot decide", async () => {
    // Synthetic labels, in a temporary copy only: each sampled pair is given
    // the label that agrees with the engine's outcome today, so precision and
    // recall are both 34 of 34 on the first draw — the 23 merged at the draw
    // and the eleven `P2-T38` moved to merged — and 39 of 39 on the union,
    // the top-up adding 5 merged. Nothing here is a human label or reaches
    // the repository.
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
      const { topUp: _topUp, ...firstDraw } = committedSample;
      const firstOnly = join(dir, "first-draw-only.json");
      await writeFile(firstOnly, serializeLabelSample(firstDraw));

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
        "Sampled pairs whose engine outcome has changed since the draw: 11",
      );
      expect(text).toContain(
        "Labelled label-set pairs outside the sample, not measured in this mode: 1",
      );
      expect(text).toContain(
        "Precision 1.0000   95 % Wilson interval [0.8985, 1.0000] over 34 merged pairs   " +
          "target ≥ 0.99   UNDECIDED: the interval is too wide to decide the target — " +
          "even with no error the low end reaches 0.99 only from 381 merged pairs",
      );
      expect(text).toContain(
        "Recall    1.0000   95 % Wilson interval [0.8985, 1.0000] over 34 true duplicates   " +
          "target ≥ 0.9   UNDECIDED",
      );
      expect(text).toContain("Labelled pairs measured: 60\n");
      expect(text).not.toContain("Top-up");

      // The union of the two draws, on the committed sample file.
      const union = await synthetic(
        "union.jsonl",
        sampledPairsOf(committedSample),
      );
      expect(await reportMain([union])).toBe(0);
      const both = out.mock.calls.map((c) => String(c[0])).join("");
      expect(both).toContain(
        `Top-up (owner, 2026-11-11, plan/00 §6 item 366(a)): 10 more pairs, ` +
          `seed "P2-T13 label sample top-up 2026-11-11", drawn from the 225 label-set pairs`,
      );
      expect(both).toMatch(/ merged +103 +23 +23\n/u);
      expect(both).toMatch(/ merged +125 +5 +5\n/u);
      expect(both).toMatch(/ distinct +60 +3 +3\n/u);
      expect(both).toContain(
        "The measured sample is the union of the two draws (60 + 10 = 70 pairs). " +
          "The top-up was drawn after the engine changed (P2-T38, P2-T39)",
      );
      expect(both).toContain(
        "Sampled pairs whose engine outcome has changed since their draw: 11",
      );
      expect(both).toContain(
        "Labelled pairs measured: 70 (of the 70 sampled pairs, 70 have labels: " +
          "first draw 60 of 60, top-up 10 of 10)",
      );
      expect(both).toContain(
        "Precision 1.0000   95 % Wilson interval [0.9103, 1.0000] over 39 merged pairs   " +
          "target ≥ 0.99   UNDECIDED",
      );
      expect(both).toContain(
        "Recall    1.0000   95 % Wilson interval [0.9103, 1.0000] over 39 true duplicates   " +
          "target ≥ 0.9   met (the whole interval is at or above the target)",
      );
    } finally {
      out.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 4. The top-up (owner's decision of 2026-11-11, plan/00 §6 item 366(a);
//    docs/02 §11.3's note of that date)
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
  });

  it("is deterministic under its seed, independent of input order, and differs under another seed", () => {
    const one = buildTopUp(first, rows, today);
    expect(
      buildTopUp(first, [...rows].reverse(), [...today].reverse()),
    ).toEqual(one);
    expect(one.seed).toBe(TOP_UP_SEED);
    expect(one.seed).toBe("P2-T13 label sample top-up 2026-11-11");
    expect(one.date).toBe(TOP_UP_DATE);
    const other = buildTopUp(first, rows, today, 10, `${TOP_UP_SEED} (other)`);
    expect(other.sample.map((s) => s.pairId)).not.toEqual(
      one.sample.map((s) => s.pairId),
    );
    const ranks = one.displayOrder.map((id) => displayRank(TOP_UP_SEED, id));
    expect(ranks).toEqual([...ranks].sort());
  });

  it("refuses to draw a second top-up", () => {
    const once = { ...first, topUp: buildTopUp(first, rows, today) };
    expect(() => buildTopUp(once, rows, today)).toThrow(
      /already holds a top-up/u,
    );
  });

  it("never writes a label: its rows are untouched and its block holds none", () => {
    const before = JSON.stringify(rows);
    const withTopUp = { ...first, topUp: buildTopUp(first, rows, today) };
    expect(JSON.stringify(rows)).toBe(before);
    expect(serializeLabelSample(withTopUp)).not.toMatch(/"label"/u);
    // The serialized file reads back as written, and its check passes
    // against the label set the top-up saw.
    expect(parseLabelSample(serializeLabelSample(withTopUp))).toEqual(
      withTopUp,
    );
    expect(
      checkLabelSample(
        withTopUp,
        today.map((p) => p.pairId),
      ),
    ).toEqual([]);
  });

  it("makes --check fail when the label set grows again, when a first-draw pair goes, or when the top-up is edited", () => {
    const withTopUp = { ...first, topUp: buildTopUp(first, rows, today) };
    const ids = today.map((p) => p.pairId);
    expect(checkLabelSample(withTopUp, [...ids, "p-new"])).toEqual([
      expect.stringMatching(/the label set the top-up saw \(285 pairs/u),
    ]);
    const gone = firstPop.find((p) => !firstSampled.has(p.pairId))?.pairId;
    expect(
      checkLabelSample(
        withTopUp,
        ids.filter((id) => id !== gone),
      ).join("\n"),
    ).toMatch(/no longer in the label set/u);
    const t = withTopUp.topUp;
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
          topUp: {
            ...t,
            sample: edited,
            displayOrder: edited.map((s) => s.pairId),
          },
        },
        ids,
      ),
    ).toEqual([
      "the committed top-up does not re-derive from its own population and seed",
    ]);
  });
});

describe("dedup-label-sample.ts --extend=10 on a temporary copy", () => {
  it("draws the committed top-up from today's corpus, writes no label, and refuses a second run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dedup-topup-"));
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const committedTopUp = committedSample.topUp;
      if (committedTopUp === undefined) throw new Error("no top-up");
      // The corpus as it was at the draw: the top-up's ten unlabelled (the
      // owner labels them in chat afterwards; this clears them in the copy
      // only).
      const drawn = new Set(committedTopUp.sample.map((s) => s.pairId));
      const pairsText = committedRows
        .map(
          (r) =>
            `${JSON.stringify(drawn.has(r.pairId) ? { ...r, label: "", reason: "" } : r)}\n`,
        )
        .join("");
      await writeFile(join(dir, PAIRS_FILE), pairsText);
      const { topUp: _topUp, ...firstDraw } = committedSample;
      const firstText = serializeLabelSample(firstDraw);
      await writeFile(join(dir, LABEL_SAMPLE_FILE), firstText);

      expect(await sampleMain(["--extend=10"], { dir })).toBe(0);
      const written = await readFile(join(dir, LABEL_SAMPLE_FILE), "utf8");
      // Draw-day pin (2026-11-11): today's engine draws exactly the
      // committed ten. Replaced, as the first draw's was, when the engine
      // moves a pair of the top-up's population.
      expect(written).toBe(committedSampleText);
      expect(written.startsWith(firstText.slice(0, -"\n  ]\n}\n".length))).toBe(
        true,
      );
      expect(await readFile(join(dir, PAIRS_FILE), "utf8")).toBe(pairsText);
      expect(written).not.toMatch(/"label"/u);
      expect(String(out.mock.calls.at(-1)?.[0])).toContain(
        "No label was written.",
      );

      expect(await sampleMain(["--extend=10"], { dir })).toBe(1);
      expect(String(err.mock.calls.at(-1)?.[0])).toMatch(
        /already holds a top-up .* Nothing was written/u,
      );
      expect(await sampleMain(["--redraw"], { dir })).toBe(1);
      expect(await readFile(join(dir, LABEL_SAMPLE_FILE), "utf8")).toBe(
        written,
      );
      expect(await sampleMain(["--check"], { dir })).toBe(0);
      expect(await sampleMain(["--extend=ten"], { dir })).toBe(2);
    } finally {
      out.mockRestore();
      err.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
