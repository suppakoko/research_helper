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
  CLUSTER_BATCH_SIZE,
  ESTIMATE_HEADROOM,
  MAP_CALL_BUDGETS,
  SUMMARY_MAX_TOKENS,
  SYNTHESIS_INPUT_BUDGETS,
  THEME_COUNT_BANDS,
  estimateReportRun,
  estimateRun,
  isReportRunEstimate,
  planItem,
  planSynthesis,
  secondAcknowledgementFor,
  themeCountBandFor,
  toPipelineEstimate,
  withHeadroom,
  type EstimateItem,
  type EstimateReportRunInput,
  type EstimateRunInput,
  type ItemPlan,
  type PromptOverheadTokens,
  type SynthesisCall,
  type SynthesisCallKind,
  type SynthesisPlanInput,
} from "../../../src/pipeline/shared/estimate";
import {
  MAX_CHUNKS,
  labelReserveTokens,
  planChunks,
  type ChunkableSource,
} from "../../../src/llm/shared/chunking";
import {
  PROMPT_FILE_NAMES,
  PROMPT_IDS,
  createPromptRegistry,
} from "../../../src/prompts";

import {
  SIXTY_K,
  flowing,
  paper,
  sentence,
} from "../../support/syntheticPaper";

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

  it("chunks a full text above the 24 000-token budget: the chunker's worst case when its sections are not known, then one CHUNK_REDUCE", () => {
    const body = 50_000;
    const long: EstimateItem = {
      workKey: "long",
      cached: false,
      source: { tier: "fulltext_epmc", abstract: ABSTRACT, text: textOf(body) },
    };
    const planned = plan(long, "auto");
    // Corrected 2026-10-27 (owner, plan/00 §6 item 299(b)): no longer the
    // flat count ⌈(50 000 − 250) ÷ 5 750⌉ = 9, but MAX_CHUNKS.
    expect(planned.chunked).toBe(true);
    expect(planned.calls.filter((c) => c.kind === "CHUNK_MAP")).toHaveLength(
      MAX_CHUNKS,
    );
    const reduce = planned.calls.at(-1);
    expect(reduce?.kind).toBe("CHUNK_REDUCE");
    expect(reduce?.rawInputTokens).toBe(3_000 + MAX_CHUNKS * 900);
    const label = labelReserveTokens("long", raw);
    const bodies = planned.calls
      .filter((c) => c.kind === "CHUNK_MAP")
      .map((c) => c.rawInputTokens - 3_000 - label);
    expect(Math.max(...bodies)).toBeLessThanOrEqual(6_000);
    const sent = bodies.reduce((a, b) => a + b, 0);
    expect(sent).toBeGreaterThanOrEqual(
      body + (MAX_CHUNKS - 1) * CHUNK_OVERLAP_TOKENS,
    );
    expect(sent).toBeLessThanOrEqual(MAX_CHUNKS * 6_000);
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

// ===========================================================================
// Corrected 2026-10-27 (owner, plan/00 §6 item 299(b); docs/06 §5.4): a
// chunked paper is priced as the chunker (P3-T23) would plan it. SYNTHETIC
// papers from test/support/syntheticPaper.ts.
// ===========================================================================

/** The tokens each CHUNK_MAP call carries besides its overhead. */
function mapBodies(item: ItemPlan): number[] {
  return item.calls
    .filter((c) => c.kind === "CHUNK_MAP")
    .map((c) => c.rawInputTokens - OVERHEAD.CHUNK_MAP);
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** An item from a synthetic paper, with or without its sections. */
function paperItem(
  source: ChunkableSource,
  withSections: boolean,
): EstimateItem {
  return {
    workKey: "W",
    cached: false,
    source: withSections
      ? { tier: "fulltext_pdf", ...source }
      : { tier: "fulltext_pdf", abstract: source.abstract, text: source.text },
  };
}

/** SIXTY_K's sections scaled to `factor` of their length. */
function scaled(factor: number, sectionAware = true): ChunkableSource {
  return paper(
    sentence(9_999).repeat(20),
    // The title block is headed "T", as in P3-T23's report, so factor 0.5 is
    // its 30 830-token paper.
    SIXTY_K.map((spec, i) => ({
      ...spec,
      heading: i === 0 ? "T" : spec.heading,
      tokens: spec.tokens * factor,
    })),
    sectionAware,
  );
}

describe("chunked papers as the chunker plans them (docs/06 §5.4, item 299(b))", () => {
  const planOf = (item: EstimateItem, window?: number): ItemPlan =>
    planItem(item, "always", OVERHEAD, raw, {
      id: "mock-small",
      contextWindowTokens: window,
    });
  const chunkerPlan = (source: ChunkableSource, window?: number) =>
    planChunks(
      source,
      { id: "mock-small", contextWindowTokens: window },
      "PAPER_SUMMARY_FULLTEXT",
      { overhead: OVERHEAD, countTokens: raw },
    );

  it("never under-states the 30 830-token paper's section-aware plan, sections known or not", () => {
    const source = scaled(0.5);
    expect(raw(source.text)).toBe(30_830);
    const chunker = chunkerPlan(source);
    expect(chunker.kind).toBe("chunked");
    const chunks = chunker.kind === "chunked" ? chunker.chunks : [];
    expect(chunks).toHaveLength(12);
    // The old flat count was ⌈(30 830 − 250) ÷ 5 750⌉ = 6.
    const known = planOf(paperItem(source, true));
    expect(mapBodies(known)).toEqual(
      chunks.map((c) => raw(c.label) + c.tokens),
    );
    const unknown = planOf(paperItem(source, false));
    expect(mapBodies(unknown)).toHaveLength(MAX_CHUNKS);
    expect(mapBodies(unknown).length).toBeGreaterThanOrEqual(chunks.length);
    expect(sum(mapBodies(unknown))).toBeGreaterThanOrEqual(
      sum(mapBodies(known)),
    );
    for (const item of [known, unknown]) {
      expect(item.calls.at(-1)?.kind).toBe("CHUNK_REDUCE");
    }
  });

  it("prices exactly the flat plan when the item says it is not section-aware", () => {
    const source = scaled(0.5, false);
    const chunker = chunkerPlan(source);
    const chunks = chunker.kind === "chunked" ? chunker.chunks : [];
    expect(chunks).toHaveLength(6);
    expect(mapBodies(planOf(paperItem(source, true)))).toEqual(
      chunks.map((c) => raw(c.label) + c.tokens),
    );
  });

  it.each([0.45, 0.5, 0.7, 1, 1.6])(
    "prices a paper of %f × 60 000 tokens at least as high without its sections as with them",
    (factor) => {
      for (const sectionAware of [true, false]) {
        const source = scaled(factor, sectionAware);
        const known = planOf(paperItem(source, true));
        const unknown = planOf(paperItem(source, false));
        const input = (p: ItemPlan) => sum(p.calls.map((c) => c.inputTokens));
        const output = (p: ItemPlan) => sum(p.calls.map((c) => c.outputTokens));
        expect(unknown.calls.length).toBeGreaterThanOrEqual(known.calls.length);
        expect(input(unknown)).toBeGreaterThanOrEqual(input(known));
        expect(output(unknown)).toBeGreaterThanOrEqual(output(known));
      }
    },
  );

  it("never prices more than 13 chunks can carry, nor less than they do carry", () => {
    const text = flowing(150_000);
    const known = planOf({
      workKey: "huge",
      cached: false,
      source: {
        tier: "fulltext_pdf",
        abstract: null,
        text,
        sectionAware: false,
        sections: [],
      },
    });
    expect(mapBodies(known)).toHaveLength(MAX_CHUNKS);
    const unknown = planOf({
      workKey: "huge",
      cached: false,
      source: { tier: "fulltext_pdf", abstract: null, text },
    });
    const label = labelReserveTokens("huge", raw);
    // What can be sent: 13 chunks of 6 000 tokens and their labels.
    expect(sum(mapBodies(unknown))).toBe(MAX_CHUNKS * (6_000 + label));
    expect(sum(mapBodies(known))).toBeLessThanOrEqual(sum(mapBodies(unknown)));
    // The old count priced all 150 000 tokens, in 27 calls.
    expect(sum(mapBodies(unknown))).toBeLessThan(150_000);
  });

  it("follows the model's context window when the caller passes it", () => {
    const source = scaled(0.5);
    const wide = planOf(paperItem(source, true));
    const narrow = planOf(paperItem(source, true), 6_000);
    const narrowChunker = chunkerPlan(source, 6_000);
    expect(mapBodies(narrow).length).toBe(
      narrowChunker.kind === "chunked" ? narrowChunker.chunks.length : -1,
    );
    expect(Math.max(...mapBodies(narrow))).toBeLessThan(
      Math.max(...mapBodies(wide)),
    );
    const run = estimateRun(
      input({
        items: [paperItem(source, true)],
        contextWindowTokens: 6_000,
        fullTextMode: "always",
      }),
    );
    expect(run.selected.items[0]?.calls).toHaveLength(narrow.calls.length);
  });

  it("passes the map model's window through the report run's estimate (P4-T16)", () => {
    const items = [paperItem(scaled(0.5), true)];
    const wide = estimateReportRun(
      reportInput({ items, fullTextMode: "always" }),
    );
    const narrow = estimateReportRun(
      reportInput({
        items,
        fullTextMode: "always",
        contextWindowTokens: 6_000,
      }),
    );
    const narrowMap = planOf(paperItem(scaled(0.5), true), 6_000);
    const wideMap = planOf(paperItem(scaled(0.5), true));
    expect(narrow.selected.calls - wide.selected.calls).toBe(
      narrowMap.calls.length - wideMap.calls.length,
    );
    expect(narrowMap.calls.length).toBeGreaterThan(wideMap.calls.length);
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

// ===========================================================================
// P4-T16 — the trend report's estimate: missing summaries plus every
// synthesis call (docs/06 §5.2, §5.4, §8.4, §9.2, §12.2). SYNTHETIC figures;
// the prompt files are read from disk, as test/unit/prompts does.
// ===========================================================================

const PROMPTS = createPromptRegistry(
  PROMPT_IDS.map((id) => ({
    fileName: PROMPT_FILE_NAMES[id],
    text: readFileSync(
      resolve(process.cwd(), "src/prompts", PROMPT_FILE_NAMES[id]),
      "utf8",
    ),
  })),
);

/** Each synthesis prompt's own tokens: a round 2 000, so the sums read. */
const SYNTH_OVERHEAD: Readonly<Record<SynthesisCallKind, number>> = {
  THEME_CLUSTER: 2_000,
  THEME_MERGE: 2_000,
  CLUSTER_REDUCE: 2_000,
  CLUSTER_REDUCE_MERGE: 2_000,
  TREND_REPORT_EN: 2_000,
  TREND_REPORT_KO: 2_000,
  SELF_CRITIQUE: 2_000,
};

/** docs/06 §5.4's 42 papers: 38 full text, 4 abstract only. */
const EXAMPLE_ITEMS: readonly EstimateItem[] = [
  ...Array.from({ length: 38 }, (_, i) => fullTextItem(`F${String(i)}`)),
  ...Array.from({ length: 4 }, (_, i) => abstractItem(`A${String(i)}`)),
];

function synthesisInput(
  overrides: Partial<SynthesisPlanInput> = {},
): SynthesisPlanInput {
  return {
    papers: 42,
    reportModel: {
      modelId: "mock-strong",
      prices: EXAMPLE_PRICES,
      maxOutputTokens: 64_000,
    },
    critiqueModel: { modelId: "mock-small", prices: EXAMPLE_PRICES },
    prompts: PROMPTS,
    synthesisOverhead: SYNTH_OVERHEAD,
    languages: ["en"],
    critiqueRounds: 1,
    ...overrides,
  };
}

function reportInput(
  overrides: Partial<EstimateReportRunInput> = {},
): EstimateReportRunInput {
  const { papers: _papers, ...synthesis } = synthesisInput();
  return {
    ...synthesis,
    items: EXAMPLE_ITEMS,
    fullTextMode: "auto",
    mapModel: { modelId: "mock-small", prices: EXAMPLE_PRICES },
    overhead: OVERHEAD,
    fullTextAutoMaxPapers: 25,
    atEpochMs: Date.UTC(2026, 9, 27),
    countTokens: raw,
    ...overrides,
  };
}

const kinds = (calls: readonly SynthesisCall[]): SynthesisCallKind[] =>
  calls.map((c) => c.kind);
const countOf = (
  calls: readonly SynthesisCall[],
  kind: SynthesisCallKind,
): number => calls.filter((c) => c.kind === kind).length;

describe("P4-T16: the synthesis calls of docs/06 §5.4's 42-paper example", () => {
  it("reserves 1 + 5 + 1 + 1 calls plus one possible rewrite with K fixed at 5 and rounds 1", () => {
    const plan = planSynthesis(synthesisInput({ themeCount: 5 }));
    expect(kinds(plan.calls)).toEqual([
      "THEME_CLUSTER",
      "CLUSTER_REDUCE",
      "CLUSTER_REDUCE",
      "CLUSTER_REDUCE",
      "CLUSTER_REDUCE",
      "CLUSTER_REDUCE",
      "TREND_REPORT_EN",
      "SELF_CRITIQUE",
      "TREND_REPORT_EN",
    ]);
    expect(plan.calls.map((c) => c.conditional)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(plan).toMatchObject({
      papers: 42,
      themes: 5,
      twoStageClustering: false,
    });
  });

  it("reserves the 26–75 band's upper K, 7, when K is unset (§9.2)", () => {
    const plan = planSynthesis(synthesisInput());
    expect(plan.themes).toBe(7);
    expect(countOf(plan.calls, "CLUSTER_REDUCE")).toBe(7);
    expect(countOf(plan.calls, "CLUSTER_REDUCE_MERGE")).toBe(0);
  });

  it("prices each call at its §5.2 input budget with headroom and its prompt's output ceiling", () => {
    const plan = planSynthesis(synthesisInput({ themeCount: 5 }));
    const byKind = (kind: SynthesisCallKind) =>
      plan.calls.find((c) => c.kind === kind) as SynthesisCall;
    expect(byKind("THEME_CLUSTER")).toMatchObject({
      modelId: "mock-strong",
      rawInputTokens: 62_000,
      inputTokens: withHeadroom(62_000),
      // P4-T03's grown ceiling: 2 000 + 40 × 42.
      outputTokens: 2_000 + 40 * 42,
    });
    expect(byKind("CLUSTER_REDUCE")).toMatchObject({
      rawInputTokens: 42_000,
      inputTokens: withHeadroom(42_000),
      outputTokens: 3_000,
    });
    expect(byKind("TREND_REPORT_EN")).toMatchObject({
      inputTokens: withHeadroom(62_000),
      outputTokens: 6_000,
      language: "en",
    });
    expect(byKind("SELF_CRITIQUE")).toMatchObject({
      modelId: "mock-small",
      inputTokens: withHeadroom(62_000),
      outputTokens: 2_500,
      language: "en",
    });
  });

  it("never states less than the example's own whole-run figures", () => {
    const run = estimateReportRun(reportInput({ themeCount: 5 }));
    // 42 map calls + 9 synthesis reservations: the example's 50 and the rewrite.
    expect(run.selected.calls).toBe(51);
    // §5.4: input ~610 k, output ~71 k, ~$2.90 at typical fill.
    expect(run.selected.rawInputTokens).toBeGreaterThan(610_000);
    expect(run.selected.outputTokens).toBeGreaterThan(71_000);
    expect(run.selected.costUsd as number).toBeGreaterThan(2.9);
  });
});

describe("P4-T16: languages, critique rounds and models", () => {
  it("doubles the report calls for both languages, from one set of theme analyses", () => {
    const one = planSynthesis(synthesisInput({ themeCount: 5 }));
    const both = planSynthesis(
      synthesisInput({ themeCount: 5, languages: ["en", "ko"] }),
    );
    expect(countOf(both.calls, "TREND_REPORT_EN")).toBe(2);
    expect(countOf(both.calls, "TREND_REPORT_KO")).toBe(2);
    expect(countOf(both.calls, "SELF_CRITIQUE")).toBe(2);
    expect(countOf(both.calls, "THEME_CLUSTER")).toBe(1);
    expect(countOf(both.calls, "CLUSTER_REDUCE")).toBe(5);
    expect(both.calls.length).toBe(one.calls.length + 3);
    // TREND_REPORT_KO's ceiling is its own 7 000 (docs/06 §5.2), no factor.
    const ko = both.calls.filter((c) => c.kind === "TREND_REPORT_KO");
    expect(ko.map((c) => [c.outputTokens, c.language])).toEqual([
      [7_000, "ko"],
      [7_000, "ko"],
    ]);
  });

  it("rounds 0 reserves no critique; rounds 2 adds two critique and two rewrite reservations", () => {
    const zero = planSynthesis(
      synthesisInput({ themeCount: 5, critiqueRounds: 0 }),
    );
    const two = planSynthesis(
      synthesisInput({ themeCount: 5, critiqueRounds: 2 }),
    );
    expect(countOf(zero.calls, "SELF_CRITIQUE")).toBe(0);
    expect(countOf(zero.calls, "TREND_REPORT_EN")).toBe(1);
    expect(countOf(two.calls, "SELF_CRITIQUE")).toBe(2);
    expect(countOf(two.calls, "TREND_REPORT_EN")).toBe(3);
    expect(two.calls.length - zero.calls.length).toBe(4);
    expect(
      two.calls
        .filter((c) => c.kind === "SELF_CRITIQUE")
        .map((c) => c.conditional),
    ).toEqual([false, true]);
  });

  it("prices map, report and critique calls each at its own model's prices", () => {
    const strong: ModelPrices = {
      ...EXAMPLE_PRICES,
      inputPerMTokUsd: 5,
      outputPerMTokUsd: 25,
    };
    const small: ModelPrices = {
      ...EXAMPLE_PRICES,
      inputPerMTokUsd: 1,
      outputPerMTokUsd: 5,
    };
    const run = estimateReportRun(
      reportInput({
        themeCount: 5,
        reportModel: {
          modelId: "mock-strong",
          prices: strong,
          maxOutputTokens: 64_000,
        },
        critiqueModel: { modelId: "mock-critic", prices: small },
      }),
    );
    const synthesisUsd = run.selected.synthesis.calls.reduce(
      (sum, c) =>
        sum +
        (c.modelId === "mock-critic"
          ? (c.inputTokens * 1 + c.outputTokens * 5) / 1e6
          : (c.inputTokens * 5 + c.outputTokens * 25) / 1e6),
      0,
    );
    expect(run.selected.costUsd).toBeCloseTo(
      (run.selected.map.costUsd as number) + synthesisUsd,
      10,
    );
    expect(run.selected.map.costUsd).toBeCloseTo(
      estimateRun(input({ items: EXAMPLE_ITEMS })).selected.costUsd as number,
      10,
    );
    expect(run.models).toEqual({
      map: "mock-small",
      report: "mock-strong",
      critique: "mock-critic",
    });
    expect(run.modelId).toBe("mock-strong");
    expect(isReportRunEstimate(run)).toBe(true);
    expect(isReportRunEstimate(estimateRun(input({})))).toBe(false);
  });

  it("an unpriced report model makes the cost unknown and needs the second acknowledgement", () => {
    const run = estimateReportRun(
      reportInput({
        reportModel: {
          modelId: "mock-strong",
          prices: undefined,
          maxOutputTokens: 64_000,
        },
      }),
    );
    expect(run.selected.costUsd).toBeUndefined();
    expect(run.selected.unpricedModelIds).toEqual(["mock-strong"]);
    expect(secondAcknowledgementFor(run.selected, 200)).toBe("unknown-cost");
    expect(secondAcknowledgementFor(run.abstractOnly, 200)).toBe(
      "unknown-cost",
    );
  });

  it("an unpriced model with no call in the plan leaves the cost known", () => {
    // Every summary exists: the map model is never called.
    const cached = EXAMPLE_ITEMS.map((item) => ({ ...item, cached: true }));
    const run = estimateReportRun(
      reportInput({
        items: cached,
        mapModel: { modelId: "mock-map", prices: undefined },
        critiqueModel: { modelId: "mock-critic", prices: undefined },
        critiqueRounds: 0,
      }),
    );
    expect(run.selected.map.calls).toBe(0);
    expect(run.selected.unpricedModelIds).toEqual([]);
    expect(run.selected.costUsd).toBeGreaterThan(0);
    expect(run.pricesAsOfEpochMs).toBe(EXAMPLE_PRICES.asOfEpochMs);
  });

  it("names every unpriced model in the order map, report, critique", () => {
    const run = estimateReportRun(
      reportInput({
        mapModel: { modelId: "mock-map", prices: undefined },
        reportModel: {
          modelId: "mock-strong",
          prices: undefined,
          maxOutputTokens: 64_000,
        },
        critiqueModel: { modelId: "mock-critic", prices: undefined },
      }),
    );
    expect(run.selected.unpricedModelIds).toEqual([
      "mock-map",
      "mock-strong",
      "mock-critic",
    ]);
    expect(run.pricesAsOfEpochMs).toBeUndefined();
  });

  it("the abstract-only downgrade changes only the map phase", () => {
    const run = estimateReportRun(reportInput({ themeCount: 5 }));
    expect(run.abstractOnly.synthesis).toBe(run.selected.synthesis);
    expect(run.abstractOnly.map.counts.abstractOnly).toBe(42);
    expect(run.abstractOnly.calls).toBe(
      run.abstractOnly.map.calls + run.selected.synthesis.calls.length,
    );
    expect(run.preselectDowngrade).toBe(true); // 42 > 25, as for summaries
    expect(run.abstractOnly.costUsd as number).toBeLessThan(
      run.selected.costUsd as number,
    );
  });

  it("is docs/07 §4.5's PipelineEstimate like any plan", () => {
    const run = estimateReportRun(reportInput({ themeCount: 5 }));
    expect(toPipelineEstimate(run.selected, 5)).toMatchObject({
      itemCount: 42,
      externalRequests: 51,
      estimatedInputTokens: run.selected.inputTokens,
      estimatedOutputTokens: run.selected.outputTokens,
      estimatedCostUsd: run.selected.costUsd,
    });
  });
});

describe("P4-T16: clustering's two stages and the theme stage's room (docs/06 §8.4)", () => {
  it("takes two stages when THEME_CLUSTER's grown ceiling passes the report model's output limit", () => {
    const limit = 2_000 + 40 * 150;
    const single = planSynthesis(
      synthesisInput({
        papers: 150,
        reportModel: {
          modelId: "mock-strong",
          prices: EXAMPLE_PRICES,
          maxOutputTokens: limit,
        },
      }),
    );
    expect(single.twoStageClustering).toBe(false);
    const split = planSynthesis(
      synthesisInput({
        papers: 151,
        reportModel: {
          modelId: "mock-strong",
          prices: EXAMPLE_PRICES,
          maxOutputTokens: limit,
        },
      }),
    );
    expect(split.twoStageClustering).toBe(true);
    const clusters = split.calls.filter((c) => c.kind === "THEME_CLUSTER");
    expect(CLUSTER_BATCH_SIZE).toBe(60);
    expect(clusters.map((c) => c.outputTokens)).toEqual([
      2_000 + 40 * 60,
      2_000 + 40 * 60,
      2_000 + 40 * 31,
    ]);
    expect(countOf(split.calls, "THEME_MERGE")).toBe(1);
    expect(
      split.calls.find((c) => c.kind === "THEME_MERGE")?.outputTokens,
    ).toBe(4_000);
  });

  it("takes two stages when 140-token digests with headroom pass the 60 000-token input budget", () => {
    expect(
      planSynthesis(synthesisInput({ papers: 372 })).twoStageClustering,
    ).toBe(false); // 372 × 140 × 1.15 = 59 892
    const split = planSynthesis(synthesisInput({ papers: 373 })); // 60 053
    expect(split.twoStageClustering).toBe(true);
    expect(countOf(split.calls, "THEME_CLUSTER")).toBe(7);
  });

  it("reserves enough theme calls to carry every summary, and a merge for each theme that could split", () => {
    const plan = planSynthesis(synthesisInput({ papers: 400 }));
    expect(plan.themes).toBe(12);
    const needed = Math.ceil(
      withHeadroom(400 * SUMMARY_MAX_TOKENS) /
        (SYNTHESIS_INPUT_BUDGETS.CLUSTER_REDUCE - SUMMARY_MAX_TOKENS),
    );
    expect(needed).toBe(20);
    const reduces = plan.calls.filter((c) => c.kind === "CLUSTER_REDUCE");
    expect(reduces).toHaveLength(20);
    expect(reduces.filter((c) => c.conditional)).toHaveLength(8);
    expect(countOf(plan.calls, "CLUSTER_REDUCE_MERGE")).toBe(8);
    // Every summary fits the theme calls priced.
    expect(
      reduces.length * SYNTHESIS_INPUT_BUDGETS.CLUSTER_REDUCE,
    ).toBeGreaterThan(400 * SUMMARY_MAX_TOKENS);
  });

  it("makes no synthesis call for no papers, and refuses a malformed count", () => {
    expect(planSynthesis(synthesisInput({ papers: 0 })).calls).toEqual([]);
    expect(() => planSynthesis(synthesisInput({ languages: [] }))).toThrow(
      RangeError,
    );
    expect(() =>
      planSynthesis(synthesisInput({ languages: ["en", "en"] })),
    ).toThrow(RangeError);
    expect(() =>
      planSynthesis(synthesisInput({ critiqueRounds: 1.5 })),
    ).toThrow(RangeError);
    expect(() => planSynthesis(synthesisInput({ themeCount: 0 }))).toThrow(
      RangeError,
    );
  });
});

describe("P4-T16: the tables it transcribes", () => {
  const doc = readFileSync(
    resolve(process.cwd(), "docs/06-summarization-and-trend-report.md"),
    "utf8",
  );

  it("transcribes docs/06 §5.2's seven synthesis input budgets, and the fixed ceilings match the prompt files", () => {
    for (const [kind, budget] of Object.entries(SYNTHESIS_INPUT_BUDGETS)) {
      const row = new RegExp(
        String.raw`^\| \`${kind}\`[^|]*\| ([\d ]+) \| (~~)?([\d ]+)`,
        "m",
      ).exec(doc);
      expect(row, kind).not.toBeNull();
      expect(Number(row?.[1]?.replace(/ /g, "")), kind).toBe(budget);
      if (kind !== "THEME_CLUSTER") {
        expect(Number(row?.[3]?.replace(/ /g, "")), kind).toBe(
          PROMPTS.get(kind as SynthesisCallKind).defaultMaxTokens,
        );
      }
    }
  });

  it("transcribes docs/06 §9.2's theme bands, and reads the first and last rows beyond the table", () => {
    const rows = [
      ...doc.matchAll(/^\| (\d+)–(\d+) \| [^|]+ \| (\d+)–(\d+) \|$/gm),
    ].map((m) => ({
      minPapers: Number(m[1]),
      maxPapers: Number(m[2]),
      minThemes: Number(m[3]),
      maxThemes: Number(m[4]),
    }));
    expect(rows).toEqual(THEME_COUNT_BANDS);
    expect(themeCountBandFor(5).maxThemes).toBe(5);
    expect(themeCountBandFor(42).maxThemes).toBe(7);
    expect(themeCountBandFor(1_000).maxThemes).toBe(12);
  });
});
