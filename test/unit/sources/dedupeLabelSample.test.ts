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
  checkLabelSample,
  displayRank,
  drawStratifiedSample,
  LABEL_SAMPLE_SEED,
  LABEL_SAMPLE_SIZE,
  pageOrderOf,
  sampleRank,
  serializeLabelSample,
  stratifyLabelSet,
} from "../../../scripts/dedup-label-sample";
import {
  inLabelSet,
  judgeTarget,
  LABEL_SAMPLE_FILE,
  main as reportMain,
  minCleanDenominator,
  parseLabelSample,
  PREDICTIONS,
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

  it("re-derives byte for byte from its own seed and population, and its population is today's label set", () => {
    expect(
      checkLabelSample(
        committedSample,
        committedRows.filter(inLabelSet).map((r) => r.pairId),
      ),
    ).toEqual([]);
    expect(serializeLabelSample(committedSample)).toBe(committedSampleText);
    expect(committedSample.population).toHaveLength(267);
  });

  it("holds no label and no pair outside the label set", () => {
    expect(committedSampleText).not.toMatch(/"label"/u);
    const labelSet = new Set(
      committedRows.filter(inLabelSet).map((r) => r.pairId),
    );
    for (const s of committedSample.sample) {
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

  // Draw-day pin: the strata are the engine's outcomes as of 2026-10-25. When
  // `P2-T13` step 6 moves a threshold this expectation fails by design; the
  // sample is then NOT redrawn (docs/02 §11.3) — replace this check with the
  // moved-pair count the report prints.
  it("was stratified by the engine's own outcome on the draw day", async () => {
    const corpus = await loadCorpusRecords();
    const pool = corpus.records.map((c) => c.record);
    const byId = new Map(pool.map((r) => [r.id, r]));
    const today = buildLabelSample(
      stratifyLabelSet(committedRows, byId, dedupeRecords(pool)),
    );
    expect(serializeLabelSample(today)).toBe(committedSampleText);
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
  it("measures the committed corpus, whose 60 sampled pairs carry the owner's labels (2026-11-10)", async () => {
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      expect(await reportMain([])).toBe(0);
      const said = out.mock.calls.map((c) => String(c[0])).join("");
      expect(said).toContain("Labelled pairs measured: 60");
      expect(said).toMatch(/Precision \d/u);
      expect(said).toMatch(/Recall {4}\d/u);
    } finally {
      out.mockRestore();
    }
  });

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

  it("states each target with its Wilson interval and says plainly when the interval cannot decide", async () => {
    // Synthetic labels, in a temporary copy only: each sampled pair is given
    // the label that agrees with its stratum, so precision and recall are
    // both 23 of 23. Nothing here is a human label or reaches the repository.
    const dir = await mkdtemp(join(tmpdir(), "dedup-sample-"));
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const stratumOf = new Map(
        committedSample.sample.map((s) => [s.pairId, s.stratum]),
      );
      const outside = committedRows.find(
        (r) => inLabelSet(r) && !stratumOf.has(r.pairId),
      )?.pairId;
      const file = join(dir, "pairs.jsonl");
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
      expect(await reportMain([file])).toBe(0);
      const text = out.mock.calls.map((c) => String(c[0])).join("");
      expect(text).toContain(
        `Mode: the owner's sample (owner, 2026-10-25): 60 label-set pairs`,
      );
      expect(text).toContain(`seed "P2-T13 label sample 2026-10-25"`);
      expect(text).toMatch(/ merged +103 +23 +23\n/u);
      expect(text).toMatch(/ flagged +22 +5 +5\n/u);
      expect(text).toContain(
        "Sampled pairs whose engine outcome has changed since the draw: 0",
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
      expect(text).toContain("Labelled pairs measured: 60");
    } finally {
      out.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
