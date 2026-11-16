/**
 * `plan/09` `P6-T10` — the dated TTS price table (`src/tts/pricing.ts`),
 * layer 1: the row test against `docs/04` §4.2, the override rule, the
 * unknown cost, and the amended model-id grep (`P6-T05`; decision 1).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { UserPriceOverride } from "../../../src/llm/shared/pricing";
import {
  AUDIO_TOKENS_PER_SECOND,
  audioRateMeasuredFor,
  DOCUMENTED_TTS_PRICE_TABLE,
  TTS_PRICES_AS_OF,
  TTS_PRICES_AS_OF_EPOCH_MS,
  TTS_PRICES_SOURCE,
  ttsCostOf,
  ttsPricesFor,
} from "../../../src/tts/pricing";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DOC = readFileSync(resolve(repo, "docs/04-audio-report-tts.md"), "utf8");

/** `docs/04` §4.2's heading and table, as written. */
function section42(): { date: string; rows: string[][] } {
  const start = DOC.indexOf("### 4.2 Pricing (verified ");
  const end = DOC.indexOf("\n## 5.", start);
  expect(start).toBeGreaterThan(-1);
  const body = DOC.slice(start, end);
  const date = /### 4\.2 Pricing \(verified (\d{4}-\d{2}-\d{2})\)/u.exec(
    body,
  )?.[1];
  const rows = body
    .split("\n")
    .filter((line) => /^\| `[^`]+` \|/u.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  return { date: date ?? "", rows };
}

const ID = (i: number): string => DOCUMENTED_TTS_PRICE_TABLE[i]?.modelId ?? "";

describe("DOCUMENTED_TTS_PRICE_TABLE — docs/04 §4.2", () => {
  it("transcribes §4.2 row for row, in order, with its date", () => {
    const { date, rows } = section42();
    expect(TTS_PRICES_AS_OF).toBe(date);
    expect(TTS_PRICES_AS_OF_EPOCH_MS).toBe(Date.parse(`${date}T00:00:00Z`));
    expect(TTS_PRICES_SOURCE).toBe("docs/04-audio-report-tts.md §4.2");
    expect(rows).toHaveLength(3);
    expect(
      rows.map(([id, input, output]) => ({
        modelId: id?.replace(/`/gu, ""),
        inputPerMTokUsd: Number(input?.replace("$", "")),
        outputPerMTokUsd: Number(output?.replace("$", "")),
      })),
    ).toEqual(
      DOCUMENTED_TTS_PRICE_TABLE.map((r) => ({
        modelId: r.modelId,
        inputPerMTokUsd: r.inputPerMTokUsd,
        outputPerMTokUsd: r.outputPerMTokUsd,
      })),
    );
  });

  it("marks the audio rate measured on exactly the model §4.1 names, and nowhere else", () => {
    const measured = /measured [^|]* on `([^`]+)`/u.exec(
      DOC.slice(DOC.indexOf("| Audio output rate |")),
    )?.[1];
    expect(AUDIO_TOKENS_PER_SECOND).toBe(25);
    expect(
      DOCUMENTED_TTS_PRICE_TABLE.filter((r) => r.audioRateMeasured).map(
        (r) => r.modelId,
      ),
    ).toEqual([measured]);
    expect(audioRateMeasuredFor(measured ?? "")).toBe(true);
    expect(audioRateMeasuredFor(ID(0))).toBe(false);
    expect(audioRateMeasuredFor("w-9-tts")).toBe(false);
  });
});

describe("ttsPricesFor and ttsCostOf (plan/09 §0.4 line 21)", () => {
  const override = (
    modelId: string,
    providerId: UserPriceOverride["providerId"] = "gemini",
  ): UserPriceOverride => ({
    providerId,
    modelId,
    inputPerMTokUsd: 2,
    outputPerMTokUsd: 30,
    asOfEpochMs: Date.UTC(2026, 10, 1),
  });

  it("gives a documented row its prices and date", () => {
    expect(ttsPricesFor(ID(1))).toEqual({
      inputPerMTokUsd: 0.5,
      outputPerMTokUsd: 10,
      cachedInputPerMTokUsd: undefined,
      tiers: [],
      asOfEpochMs: TTS_PRICES_AS_OF_EPOCH_MS,
      source: "documented-table",
    });
  });

  it("lets the user's gemini row win, ignores another provider's row, and leaves an unknown model unknown", () => {
    expect(ttsPricesFor(ID(1), [override(ID(1))])).toMatchObject({
      inputPerMTokUsd: 2,
      outputPerMTokUsd: 30,
      source: "user-override",
    });
    expect(ttsPricesFor(ID(1), [override(ID(1), "openai")])?.source).toBe(
      "documented-table",
    );
    expect(ttsPricesFor("w-9-tts")).toBeUndefined();
    expect(ttsPricesFor("w-9-tts", [override("w-9-tts")])?.source).toBe(
      "user-override",
    );
  });

  it("prices docs/04 §11's 2,400 input and 15,000 audio tokens as §11 does; no price is no cost", () => {
    const at = Date.UTC(2026, 10, 17);
    const tokens = { inputTokens: 2400, outputTokens: 15000 };
    expect(ttsCostOf(ttsPricesFor(ID(1)), tokens, at)).toBeCloseTo(0.1512, 6);
    expect(ttsCostOf(ttsPricesFor(ID(0)), tokens, at)).toBeCloseTo(0.3024, 6);
    expect(ttsCostOf(ttsPricesFor(ID(2)), tokens, at)).toBeCloseTo(0.3024, 6);
    expect(ttsCostOf(undefined, tokens, at)).toBeUndefined();
  });
});

describe("no TTS model is chosen from compiled-in ids (P6-T05's grep, amended; decision 1)", () => {
  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return tsFiles(path);
      return /\.ts$/u.test(name) ? [path] : [];
    });
  }

  it("finds the one marked fallback line and the marked price rows, nothing else", () => {
    const hits = tsFiles(resolve(repo, "src")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /preview-tts|tts-preview/u.test(line))
        .map((line) => ({
          file: relative(repo, file).replace(/\\/gu, "/"),
          line,
        })),
    );
    const fallback = hits.filter((h) =>
      h.line.includes("LAST-RESORT FALLBACK"),
    );
    const rows = hits.filter((h) => h.line.trimEnd().endsWith("// PRICE ROW"));
    expect(fallback.map((h) => h.file)).toEqual(["src/tts/geminiTts.ts"]);
    expect(rows.map((h) => h.file)).toEqual(
      DOCUMENTED_TTS_PRICE_TABLE.map(() => "src/tts/pricing.ts"),
    );
    expect(hits).toHaveLength(fallback.length + rows.length);
  });
});
