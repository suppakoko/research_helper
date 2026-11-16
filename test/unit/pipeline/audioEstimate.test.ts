/**
 * `plan/09` `P6-T10` — the two-step audio estimate
 * (`src/pipeline/audioReport/estimate.ts`), layer 1: `docs/04` §11's worked
 * example, the unknown cost, the confirmation rule and the script step.
 * Plain Node; the chunker and the prompt files are the real ones.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ModelPrices } from "../../../src/llm/shared/pricing";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type { TrendReport } from "../../../src/model/trend";
import {
  audioDialogPlan,
  audioTokensFor,
  chunkReservation,
  estimateAudioPlan,
  estimateScriptStep,
  PCM_BYTES_PER_SECOND,
  spokenSecondsOf,
  wavBytesFor,
} from "../../../src/pipeline/audioReport/estimate";
import { scriptOutputCeiling } from "../../../src/pipeline/audioReport/script";
import { STYLE_PREFIX } from "../../../src/pipeline/audioReport/synthesize";
import {
  ESTIMATE_HEADROOM,
  secondAcknowledgementFor,
  withHeadroom,
} from "../../../src/pipeline/shared/estimate";
import {
  createPromptRegistry,
  PROMPT_FILE_NAMES,
  PROMPT_IDS,
} from "../../../src/prompts";
import {
  IMPORT_MAX_BYTES,
  WAV_HEADER_BYTES,
} from "../../../src/tts/audioStore";
import { chunkScript } from "../../../src/tts/chunk";
import {
  DOCUMENTED_TTS_PRICE_TABLE,
  ttsCostOf,
  ttsPricesFor,
} from "../../../src/tts/pricing";
import { shouldOpenCostDialog } from "../../../src/ui/dialogs/costConfirmDialog";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const AT = Date.UTC(2026, 10, 17);

/** The documented rows, by position, so this file names no TTS model id. */
const NEWER = DOCUMENTED_TTS_PRICE_TABLE[0]?.modelId ?? "";
const MEASURED = DOCUMENTED_TTS_PRICE_TABLE[1]?.modelId ?? "";
const UNKNOWN = "w-9-flash-tts";

/**
 * `docs/04` §11's script: 1,500 words, about 9,000 characters. Each sentence
 * is 15 words and 89 characters, so ten of them and their nine spaces fill
 * one 900-character chunk: ten chunks, as §11 counts.
 */
const SECTION_11_SCRIPT: string = (() => {
  const bank = ["tidal", "gauge", "coast", "level", "shore", "drift", "basin"];
  const sentences: string[] = [];
  for (let s = 0; s < 100; s += 1) {
    const words = Array.from(
      { length: 14 },
      (_, w) => bank[(s + w) % bank.length] ?? "",
    );
    words.push("land");
    const text = words.join(" ");
    sentences.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}.`);
  }
  return sentences.join(" ");
})();

function planFor(
  model: string,
  script = SECTION_11_SCRIPT,
  language: "en" | "ko" = "en",
) {
  return estimateAudioPlan({
    reportId: "report-en-1",
    script: { text: script, language },
    chunks: chunkScript(script, { language }),
    model,
    voice: "Charon",
    stylePrefix: STYLE_PREFIX,
    prices: ttsPricesFor(model),
    atEpochMs: AT,
  });
}

describe("estimateAudioPlan — docs/04 §11's worked example", () => {
  it("has §11's words, characters, chunks, seconds and size, and links its 28.8 MB", () => {
    expect(SECTION_11_SCRIPT.split(" ")).toHaveLength(1500);
    const plan = planFor(MEASURED);
    expect(plan.chunks).toHaveLength(10);
    expect(plan.totalChars + 9).toBe(SECTION_11_SCRIPT.length);
    expect(SECTION_11_SCRIPT.length).toBe(8999);
    expect(plan.estimatedSeconds).toBe(600);
    expect(plan.estimatedBytes).toBe(600 * 48_000 + 44);
    expect(plan.estimatedBytes).toBeGreaterThan(IMPORT_MAX_BYTES);
    expect(plan.mode).toBe("linked");
    expect(plan.stylePrefix).toBe(STYLE_PREFIX);
    expect(plan.voice).toBe("Charon");
  });

  it("reproduces §11's tokens and dollars within the headroom on the measured model", () => {
    const plan = planFor(MEASURED);
    // §11: 600 s × 25 tok/s = 15,000 audio tokens, then the headroom.
    expect(plan.cost.outputTokens).toBe(withHeadroom(15_000));
    const rawInput = plan.chunks.reduce(
      (sum, c) => sum + estTokens(STYLE_PREFIX + c.text, MEASURED),
      0,
    );
    expect(plan.cost.inputTokens).toBe(withHeadroom(rawInput));
    // The raw figure is §11's $0.151 within 1 % (docs/06 §5.1's 3.7
    // characters a token puts the input above §11's 2,400; input is under
    // 1 % of the bill)...
    const raw = ttsCostOf(
      ttsPricesFor(MEASURED),
      { inputTokens: rawInput, outputTokens: 15_000 },
      AT,
    );
    expect(Math.abs((raw ?? 0) / 0.151 - 1)).toBeLessThan(0.01);
    // ...and the quote is never below §11, and at most the headroom above it.
    const usd = plan.cost.usd ?? 0;
    expect(usd).toBeGreaterThanOrEqual(0.151);
    expect(usd).toBeLessThanOrEqual(0.151 * ESTIMATE_HEADROOM * 1.01);
    expect(plan.cost.rateMeasuredOnModel).toBe(true);
  });

  it("doubles on the newer model, as §11's $0.302 does, and says its rate was measured on another model", () => {
    const newer = planFor(NEWER);
    const measured = planFor(MEASURED);
    expect(newer.cost.usd ?? 0).toBeCloseTo((measured.cost.usd ?? 0) * 2, 9);
    expect(newer.cost.rateMeasuredOnModel).toBe(false);
  });

  it("refuses chunks that do not rebuild the script, and a plan with none", () => {
    const chunks = chunkScript(SECTION_11_SCRIPT, { language: "en" });
    const base = {
      reportId: "r",
      script: { text: SECTION_11_SCRIPT, language: "en" as const },
      model: MEASURED,
      voice: "Charon",
      stylePrefix: STYLE_PREFIX,
      prices: undefined,
      atEpochMs: AT,
    };
    expect(() =>
      estimateAudioPlan({ ...base, chunks: chunks.slice(1) }),
    ).toThrow(RangeError);
    expect(() => estimateAudioPlan({ ...base, chunks: [] })).toThrow(
      RangeError,
    );
    expect(() =>
      estimateAudioPlan({
        ...base,
        script: { text: "", language: "en" },
        chunks: [],
      }),
    ).toThrow(RangeError);
  });
});

describe("the confirmation (plan/09 §0.4 line 21; docs/09 §3.6)", () => {
  it("an unknown model gives an unknown cost and forces the confirmation", () => {
    const plan = planFor(UNKNOWN);
    expect(plan.cost.usd).toBeUndefined();
    expect(plan.cost.rateMeasuredOnModel).toBe(false);
    expect(plan.cost.outputTokens).toBe(withHeadroom(15_000));
    expect(secondAcknowledgementFor(audioDialogPlan(plan), 10_000)).toBe(
      "unknown-cost",
    );
    expect(
      shouldOpenCostDialog({
        confirmation: { ask: false } as Parameters<
          typeof shouldOpenCostDialog
        >[0]["confirmation"],
        plan: audioDialogPlan(plan),
        confirmAboveCents: 10_000,
        ceiling: undefined,
      }),
    ).toEqual({ open: true, reasons: ["unknown-cost"] });
  });

  it("a priced plan above summary.confirmAboveCents needs the second acknowledgement; one below does not", () => {
    const plan = planFor(MEASURED);
    expect(audioDialogPlan(plan)).toEqual({
      calls: 10,
      costUsd: plan.cost.usd,
    });
    expect(secondAcknowledgementFor(audioDialogPlan(plan), 10)).toBe(
      "above-threshold",
    );
    expect(secondAcknowledgementFor(audioDialogPlan(plan), 50)).toBeUndefined();
  });
});

describe("speaking time, size and one chunk's reservation", () => {
  it("English is 150 words a minute; Korean 330 syllables plus its Latin words at 150", () => {
    expect(spokenSecondsOf("one two three", "en")).toBeCloseTo(1.2, 9);
    expect(spokenSecondsOf(" — ", "en")).toBe(0);
    expect(spokenSecondsOf("가".repeat(330), "ko")).toBeCloseTo(60, 9);
    expect(
      spokenSecondsOf(`${"가".repeat(330)} CRISPR-Cas Testa`, "ko"),
    ).toBeCloseTo(60.8, 9);
  });

  it("a one-minute plan is imported; bytes are whole seconds of 24 kHz 16-bit PCM plus the header", () => {
    expect(PCM_BYTES_PER_SECOND).toBe(48_000);
    expect(wavBytesFor(0.4)).toBe(48_000 + WAV_HEADER_BYTES);
    expect(audioTokensFor(0.4)).toBe(10);
    expect(audioTokensFor(0.41)).toBe(11);
    const oneMinute = SECTION_11_SCRIPT.split(" ").slice(0, 150).join(" ");
    expect(planFor(MEASURED, oneMinute).mode).toBe("imported");
  });

  it("a Korean script is timed by its syllables", () => {
    const text = `${"가나다라마 ".repeat(66)}끝.`;
    const plan = planFor(MEASURED, text, "ko");
    expect(plan.estimatedSeconds).toBe(Math.ceil((331 / 330) * 60));
  });

  it("chunkReservation: the chunk's input and audio tokens with headroom, its cost and the prices settled at", () => {
    const plan = planFor(MEASURED);
    const prices = ttsPricesFor(MEASURED) as ModelPrices;
    const chunk = plan.chunks[0];
    if (chunk === undefined) throw new Error("no chunk");
    const r = chunkReservation(chunk, plan, prices, AT);
    expect(r.outputTokens).toBe(withHeadroom(1500));
    expect(r.inputTokens).toBe(
      withHeadroom(estTokens(STYLE_PREFIX + chunk.text, MEASURED)),
    );
    expect(r.costUsd).toBe(ttsCostOf(prices, r, AT));
    expect(r.prices).toBe(prices);
    const unpriced = chunkReservation(chunk, plan, undefined, AT);
    expect(unpriced).toEqual({
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
    });
  });
});

describe("estimateScriptStep — the first confirmation (plan/09 §0.4 line 13)", () => {
  const REGISTRY = createPromptRegistry(
    PROMPT_IDS.map((id) => ({
      fileName: PROMPT_FILE_NAMES[id],
      text: readFileSync(
        resolve(repo, "src/prompts", PROMPT_FILE_NAMES[id]),
        "utf8",
      ),
    })),
  );
  const STRONG: ModelPrices = {
    inputPerMTokUsd: 0.75,
    outputPerMTokUsd: 3.75,
    cachedInputPerMTokUsd: undefined,
    tiers: [],
    asOfEpochMs: Date.UTC(2026, 8, 8),
    source: "documented-table",
  };
  const source: Pick<TrendReport, "sections" | "collectionName" | "scope"> = {
    collectionName: "Coastal sea level",
    scope: {
      totalCount: 6,
      analysedCount: 5,
      excludedCount: 1,
      fullTextCount: 2,
      abstractCount: 3,
      yearMin: 2019,
      yearMax: 2025,
    },
    sections: [
      {
        number: 1,
        heading: "1. Executive Summary",
        markdown: "Tide gauges sink [[KEY00001]].",
        citedItemKeys: ["KEY00001"],
      },
    ],
  };
  const step = (
    language: "en" | "ko",
    scriptPrices: ModelPrices | null = STRONG,
    ttsModel = MEASURED,
  ) =>
    estimateScriptStep({
      source,
      language,
      targetMinutes: 10,
      prompt: REGISTRY.get(
        language === "en" ? "AUDIO_SCRIPT_EN" : "AUDIO_SCRIPT_KO",
      ),
      citationMap: 'KEY00001 → "Testa and colleagues, 2025"',
      scriptModel: {
        modelId: "vendor/strong-model",
        prices: scriptPrices ?? undefined,
      },
      ttsModel: { modelId: ttsModel, prices: ttsPricesFor(ttsModel) },
      stylePrefix: STYLE_PREFIX,
      atEpochMs: AT,
    });

  it("prices the script call and its one retry at the ceiling, and the TTS step from TARGET_MINUTES, provisionally", () => {
    const e = step("en");
    const prompt = REGISTRY.get("AUDIO_SCRIPT_EN");
    expect(e.script.calls).toBe(2);
    expect(e.script.outputTokens).toBe(
      2 * scriptOutputCeiling(prompt, "en", 10),
    );
    expect(e.script.inputTokens).toBeGreaterThan(0);
    expect(e.script.pricesAsOfEpochMs).toBe(STRONG.asOfEpochMs);
    expect(e.tts).toMatchObject({
      provisional: true,
      totalChars: 9000,
      chunks: 10,
      estimatedSeconds: 600,
      estimatedBytes: 600 * 48_000 + 44,
      mode: "linked",
      outputTokens: withHeadroom(15_000),
      rateMeasuredOnModel: true,
    });
    expect(e.calls).toBe(12);
    expect(e.costUsd).toBeCloseTo(
      (e.script.costUsd ?? 0) + (e.tts.usd ?? 0),
      12,
    );
  });

  it("a Korean ten minutes is 3,300 characters in eight chunks, with the same audio tokens", () => {
    const e = step("ko");
    expect(e.tts.totalChars).toBe(3300);
    expect(e.tts.chunks).toBe(Math.ceil(3300 / 450));
    expect(e.tts.outputTokens).toBe(step("en").tts.outputTokens);
    expect(e.script.outputTokens).toBe(
      2 * scriptOutputCeiling(REGISTRY.get("AUDIO_SCRIPT_KO"), "ko", 10),
    );
  });

  it("an unpriced script model or TTS model makes the total unknown, which forces the confirmation", () => {
    const noScriptPrice = step("en", null);
    expect(noScriptPrice.script.costUsd).toBeUndefined();
    expect(noScriptPrice.costUsd).toBeUndefined();
    const noTtsPrice = step("en", STRONG, UNKNOWN);
    expect(noTtsPrice.tts.usd).toBeUndefined();
    expect(noTtsPrice.costUsd).toBeUndefined();
    expect(
      secondAcknowledgementFor(
        { calls: noTtsPrice.calls, costUsd: noTtsPrice.costUsd },
        10_000,
      ),
    ).toBe("unknown-cost");
  });
});
