/**
 * `P3-T16` step 1: `estimateRun()` — the pre-run estimate the cost dialog
 * shows (`docs/06` §5.4, DR-1, §5.2). Every paper below is SYNTHETIC: runs of
 * one Latin letter whose `estTokens` is exact, so the arithmetic can be read
 * against the document's worked example. No network, no key, no LLM call.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import type { ModelPrices } from "../../../src/llm/shared/pricing";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import { PREF_KEYS, setPrefStore } from "../../../src/prefs";
import {
  CHUNK_OVERLAP_TOKENS,
  ESTIMATE_HEADROOM,
  MAP_CALL_BUDGETS,
  estimateRun,
  planItem,
  secondAcknowledgementFor,
  toPipelineEstimate,
  withHeadroom,
  type EstimateItem,
  type EstimateRunInput,
  type PromptOverheadTokens,
} from "../../../src/pipeline/shared/estimate";

afterEach(() => {
  setPrefStore(undefined);
});

/** Latin text of exactly `tokens` tokens under `docs/06` §5.1 (3.7 chars per token). */
function textOf(tokens: number): string {
  const text = "a".repeat(Math.round(tokens * 3.7));
  expect(estTokens(text)).toBe(tokens);
  return text;
}

/** The raw heuristic: no calibration, so the example's figures are exact. */
const raw = (text: string): number => estTokens(text);

/**
 * The prompts' own tokens. `docs/06` §5.4 states ~3.4 k for an abstract-only
 * call (system, scaffold, schema and the abstract) and ~12 k for a full-text
 * one; with a 400-token abstract that is 3 000 of overhead per call.
 */
const OVERHEAD: PromptOverheadTokens = {
  PAPER_SUMMARY_ABSTRACT: 3_000,
  PAPER_SUMMARY_FULLTEXT: 3_000,
  CHUNK_MAP: 3_000,
  CHUNK_REDUCE: 3_000,
};

/** `docs/06` §5.4: "$3 / M input and $15 / M output purely so the arithmetic is checkable". */
const EXAMPLE_PRICES: ModelPrices = {
  inputPerMTokUsd: 3,
  outputPerMTokUsd: 15,
  cachedInputPerMTokUsd: undefined,
  tiers: [],
  asOfEpochMs: Date.UTC(2026, 8, 8),
  source: "documented-table",
};

const ABSTRACT = textOf(400);
/** A body of 9 000 tokens after a 400-token abstract and a blank line. */
const FULL_TEXT = `${ABSTRACT}\n\n${textOf(9_000 - 400 - 1)}`;

function fullTextItem(key: string, cached = false): EstimateItem {
  return {
    workKey: key,
    cached,
    source: { tier: "fulltext_pdf", abstract: ABSTRACT, text: FULL_TEXT },
  };
}

function abstractItem(key: string, cached = false): EstimateItem {
  return {
    workKey: key,
    cached,
    source: { tier: "abstract", abstract: ABSTRACT, text: ABSTRACT },
  };
}

function input(overrides: Partial<EstimateRunInput>): EstimateRunInput {
  return {
    items: [],
    fullTextMode: "auto",
    modelId: "mock-small",
    prices: EXAMPLE_PRICES,
    overhead: OVERHEAD,
    fullTextAutoMaxPapers: 25,
    atEpochMs: Date.UTC(2026, 9, 23),
    countTokens: raw,
    ...overrides,
  };
}

/** `|a − b| ≤ 10 % of b`. */
function within10(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(expected * 0.1);
}

describe("estimateRun reproduces docs/06 §5.4's worked example (map phase)", () => {
  // 42 papers, auto mode, 38 full text and 4 abstract-only. The 8 synthesis
  // calls (THEME_CLUSTER, 5 × CLUSTER_REDUCE, the report, SELF_CRITIQUE) are
  // Phase 4's, so the map phase is 42 calls and 456 k + 14 k input.
  const items = [
    ...Array.from({ length: 38 }, (_, i) => fullTextItem(`F${String(i)}`)),
    ...Array.from({ length: 4 }, (_, i) => abstractItem(`A${String(i)}`)),
  ];
  const estimate = estimateRun(input({ items }));

  it("makes 42 calls: 38 single-shot full text and 4 abstract-only", () => {
    expect(estimate.selected.calls).toBe(42);
    expect(estimate.selected.counts).toEqual({
      items: 42,
      cached: 0,
      fullText: 38,
      abstractOnly: 4,
      metadataOnly: 0,
      chunked: 0,
    });
  });

  it("states map-phase input within 10 % of 456 k + 14 k, before headroom", () => {
    within10(estimate.selected.rawInputTokens, 456_000 + 14_000);
    expect(estimate.selected.rawInputTokens).toBe(38 * 12_000 + 4 * 3_400);
  });

  it("prices the headroomed input and the §5.2 output ceilings at $3 / $15 per M", () => {
    const fullIn = withHeadroom(12_000);
    const absIn = withHeadroom(3_400);
    expect(estimate.selected.inputTokens).toBe(38 * fullIn + 4 * absIn);
    expect(estimate.selected.outputTokens).toBe(38 * 1_600 + 4 * 1_200);
    const expected =
      (38 * (fullIn * 3 + 1_600 * 15) + 4 * (absIn * 3 + 1_200 * 15)) / 1e6;
    expect(estimate.selected.costUsd).toBeCloseTo(expected, 10);
    // Above the $2.00 default threshold, like the document's ~$2.90 whole run.
    expect(secondAcknowledgementFor(estimate.selected, 200)).toBe(
      "above-threshold",
    );
  });

  it("offers the abstract-only downgrade within 10 % of the example's map phase (280 k − 137 k)", () => {
    // §5.4: the downgrade is "~280 k input" over the whole pipeline, of which
    // THEME_CLUSTER 6 k, CLUSTER_REDUCE 55 k, the report 19 k and
    // SELF_CRITIQUE 57 k are synthesis: 143 k for the map phase.
    expect(estimate.abstractOnly.calls).toBe(42);
    expect(estimate.abstractOnly.counts.abstractOnly).toBe(42);
    within10(estimate.abstractOnly.rawInputTokens, 280_000 - 137_000);
    expect(estimate.abstractOnly.costUsd).toBeLessThan(
      estimate.selected.costUsd as number,
    );
  });

  it("marks every figure as an estimate, with the prices' date", () => {
    expect(estimate.isEstimate).toBe(true);
    expect(estimate.pricesAsOfEpochMs).toBe(EXAMPLE_PRICES.asOfEpochMs);
  });

  it("pre-selects the downgrade above summary.fullTextAutoMaxPapers in auto mode, and only there", () => {
    expect(estimate.preselectDowngrade).toBe(true); // 42 > 25
    expect(
      estimateRun(input({ items, fullTextAutoMaxPapers: 42 }))
        .preselectDowngrade,
    ).toBe(false);
    expect(
      estimateRun(input({ items, fullTextMode: "always" })).preselectDowngrade,
    ).toBe(false);
    expect(
      estimateRun(input({ items: items.slice(38) })).preselectDowngrade,
    ).toBe(false);
  });
});

describe("DR-1 per item (docs/06 §5.4)", () => {
  const plan = (item: EstimateItem, mode: "auto" | "never" | "always") =>
    planItem(item, mode, OVERHEAD, raw);

  it("auto sends full text only at three times the abstract; always sends it anyway; never sends none", () => {
    const thin: EstimateItem = {
      workKey: "thin",
      cached: false,
      // 1 000 tokens of text against a 400-token abstract: below 3×.
      source: {
        tier: "fulltext_pdf",
        abstract: ABSTRACT,
        text: `${ABSTRACT}\n\n${textOf(599)}`,
      },
    };
    expect(plan(thin, "auto").scope).toBe("abstract");
    expect(plan(thin, "always").scope).toBe("abstract+fulltext");
    expect(plan(fullTextItem("x"), "auto").scope).toBe("abstract+fulltext");
    expect(plan(fullTextItem("x"), "never").scope).toBe("abstract");
  });

  it("makes no call for a metadata-only item (docs/06 §3.5) or a cached one", () => {
    const bare: EstimateItem = {
      workKey: "bare",
      cached: false,
      source: { tier: "metadata_only", abstract: null, text: "" },
    };
    expect(plan(bare, "always")).toMatchObject({
      scope: "metadata-only",
      calls: [],
    });
    const cached = plan(fullTextItem("c", true), "auto");
    expect(cached.calls).toEqual([]);
    expect(cached.cached).toBe(true);
    const run = estimateRun(
      input({ items: [bare, fullTextItem("c", true), abstractItem("a")] }),
    );
    expect(run.selected.calls).toBe(1);
    expect(run.selected.counts).toMatchObject({
      items: 3,
      cached: 1,
      metadataOnly: 1,
      abstractOnly: 1,
    });
  });

  it("chunks a full text above the 24 000-token budget: CHUNK_MAP with 250 overlap, then one CHUNK_REDUCE", () => {
    const body = 50_000;
    const long: EstimateItem = {
      workKey: "long",
      cached: false,
      source: { tier: "fulltext_epmc", abstract: ABSTRACT, text: textOf(body) },
    };
    const planned = plan(long, "auto");
    const chunks = Math.ceil(
      (body - CHUNK_OVERLAP_TOKENS) / (6_000 - CHUNK_OVERLAP_TOKENS),
    );
    expect(planned.chunked).toBe(true);
    expect(planned.calls.filter((c) => c.kind === "CHUNK_MAP")).toHaveLength(
      chunks,
    );
    const reduce = planned.calls.at(-1);
    expect(reduce?.kind).toBe("CHUNK_REDUCE");
    expect(reduce?.rawInputTokens).toBe(3_000 + chunks * 900);
    const mapBodies = planned.calls
      .filter((c) => c.kind === "CHUNK_MAP")
      .map((c) => c.rawInputTokens - 3_000);
    expect(Math.max(...mapBodies)).toBeLessThanOrEqual(6_000);
    expect(mapBodies.reduce((a, b) => a + b, 0)).toBe(
      body + (chunks - 1) * CHUNK_OVERLAP_TOKENS,
    );
    // A text exactly at the budget is still one call.
    const atBudget: EstimateItem = {
      workKey: "edge",
      cached: false,
      source: {
        tier: "fulltext_pdf",
        abstract: ABSTRACT,
        text: textOf(24_000),
      },
    };
    expect(plan(atBudget, "auto").calls).toHaveLength(1);
  });
});

describe("prices, headroom and the confirmation gate", () => {
  it("applies D-06-5's 1.15× headroom per call, rounded up", () => {
    expect(ESTIMATE_HEADROOM).toBe(1.15);
    expect(withHeadroom(10_000)).toBe(11_500);
    expect(withHeadroom(1)).toBe(2);
    expect(withHeadroom(0)).toBe(0);
  });

  it("gives an unknown cost, never zero, without a price — and that needs the second acknowledgement", () => {
    const run = estimateRun(
      input({ items: [abstractItem("a")], prices: undefined }),
    );
    expect(run.selected.costUsd).toBeUndefined();
    expect(run.pricesAsOfEpochMs).toBeUndefined();
    expect(secondAcknowledgementFor(run.selected, 200)).toBe("unknown-cost");
  });

  it("prices each call at the tier its own prompt selects", () => {
    const tiered: ModelPrices = {
      ...EXAMPLE_PRICES,
      tiers: [
        {
          abovePromptTokens: 20_000,
          inputPerMTokUsd: 6,
          outputPerMTokUsd: 30,
        },
      ],
    };
    const big: EstimateItem = {
      workKey: "big",
      cached: false,
      source: {
        tier: "fulltext_pdf",
        abstract: ABSTRACT,
        text: textOf(20_000),
      },
    };
    const run = estimateRun(input({ items: [big], prices: tiered }));
    const inputTokens = withHeadroom(23_000); // 26 450, above 20 000
    expect(run.selected.costUsd).toBeCloseTo(
      (inputTokens * 6 + 1_600 * 30) / 1e6,
      12,
    );
  });

  it("asks for the second acknowledgement only above summary.confirmAboveCents, compared in dollars", () => {
    expect(secondAcknowledgementFor({ calls: 3, costUsd: 2.0 }, 200)).toBe(
      undefined,
    );
    expect(secondAcknowledgementFor({ calls: 3, costUsd: 2.0001 }, 200)).toBe(
      "above-threshold",
    );
    expect(secondAcknowledgementFor({ calls: 0, costUsd: undefined }, 0)).toBe(
      undefined,
    );
  });

  it("uses the model's stored calibration by default (P3-T13)", () => {
    setPrefStore(
      createMemoryPrefStore({
        [PREF_KEYS.llmTokenEstimateCalibration]: '{"mock-small": 2}',
      }),
    );
    const { countTokens: _raw, ...calibrated } = input({
      items: [abstractItem("a")],
    });
    const run = estimateRun(calibrated);
    // The text is calibrated here; the overhead is the caller's measurement.
    expect(run.selected.rawInputTokens).toBe(3_000 + 400 * 2);
  });

  it("transcribes docs/06 §5.2's four map-phase rows", () => {
    const doc = readFileSync(
      resolve(process.cwd(), "docs/06-summarization-and-trend-report.md"),
      "utf8",
    );
    for (const [kind, budget] of Object.entries(MAP_CALL_BUDGETS)) {
      const row = new RegExp(
        String.raw`^\| \`${kind}\`[^|]*\| ([\d ]+) \| ([\d ]+) \|`,
        "m",
      ).exec(doc);
      expect(row, kind).not.toBeNull();
      expect(Number(row?.[1]?.replace(/ /g, "")), kind).toBe(
        budget.inputTokens,
      );
      expect(Number(row?.[2]?.replace(/ /g, "")), kind).toBe(
        budget.maxOutputTokens,
      );
    }
  });

  it("becomes docs/07 §4.5's PipelineEstimate", () => {
    const run = estimateRun(input({ items: [abstractItem("a")] }));
    expect(toPipelineEstimate(run.selected, 5)).toEqual({
      itemCount: 1,
      externalRequests: 1,
      estimatedInputTokens: withHeadroom(3_400),
      estimatedOutputTokens: 1_200,
      estimatedCostUsd: run.selected.costUsd,
      estimatedDurationSeconds: 12,
      notesKeys: [],
    });
    expect(() => toPipelineEstimate(run.selected, 0)).toThrow(RangeError);
  });
});
