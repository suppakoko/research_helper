/**
 * `P3-T06` step 6: `estTokens`, `docs/06` §5.1's per-script heuristic, and the
 * rule that it is exported from exactly one module.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHARS_PER_TOKEN,
  estTokens,
  HANGUL_FIRST,
  HANGUL_LAST,
} from "../../../src/llm/shared/tokenEstimate";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFilesUnder(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("estTokens — docs/06 §5.1's per-script ratios", () => {
  it("costs nothing for the empty string", () => {
    expect(estTokens("")).toBe(0);
  });

  it("uses 3.7 characters per token for Latin text, rounded up", () => {
    expect(CHARS_PER_TOKEN).toEqual({
      latin: 3.7,
      hangul: 1.4,
      cjk: 1.0,
      other: 2.0,
    });
    expect(estTokens("a".repeat(37))).toBe(10);
    expect(estTokens("a".repeat(38))).toBe(11);
    expect(estTokens("a")).toBe(1);
    // U+024F is the last Latin code point; U+0250 is "other" (2.0).
    expect(estTokens("ɏ".repeat(37))).toBe(10);
    expect(estTokens("ɐ".repeat(4))).toBe(2);
  });

  it("covers the whole Hangul syllable block, U+AC00 to U+D7A3, at 1.4", () => {
    expect(HANGUL_FIRST).toBe(0xac00);
    expect(HANGUL_LAST).toBe(0xd7a3);
    expect(estTokens("가".repeat(7))).toBe(5); // U+AC00
    expect(estTokens("힣".repeat(7))).toBe(5); // U+D7A3, the last syllable
    expect(estTokens("힠".repeat(7))).toBe(5); // past 힝 (U+D799), where docs/03 §10.2 says a short range ended
    // Just outside both ends: "other", 2.0 characters per token.
    expect(estTokens("꯿".repeat(7))).toBe(4);
    expect(estTokens("힤".repeat(7))).toBe(4);
  });

  it("counts CJK ideographs U+4E00 to U+9FFF at one token each", () => {
    expect(estTokens("一".repeat(5))).toBe(5);
    expect(estTokens("鿿".repeat(5))).toBe(5);
    expect(estTokens("䷿".repeat(5))).toBe(3); // just before: other
  });

  it("walks code points, so a character outside the BMP counts once", () => {
    // Four emoji: 4 / 2.0 = 2. Counting UTF-16 units would give 4.
    expect(estTokens("😀😀😀😀")).toBe(2);
  });

  it("rounds the sum once, not each script separately", () => {
    // 1/3.7 + 1/1.4 ≈ 0.98 → 1, where rounding each part would give 2.
    expect(estTokens("a가")).toBe(1);
  });

  it("is a Korean abstract's realistic order of magnitude", () => {
    const korean =
      "패혈증 환자의 사망률을 예측하는 기계 학습 모델을 개발하였다.";
    const tokens = estTokens(korean);
    expect(tokens).toBeGreaterThan(korean.length / 3);
    expect(tokens).toBeLessThan(korean.length);
  });
});

describe("estTokens is the one estimator", () => {
  it("is declared in exactly one module under src/", () => {
    const declaring = tsFilesUnder(resolve(ROOT, "src")).filter((file) =>
      /\b(?:function|const|let)\s+(?:estTokens|estimateTokens)\b/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(
      declaring.map((file) => relative(ROOT, file).replace(/\\/g, "/")),
    ).toEqual(["src/llm/shared/tokenEstimate.ts"]);
  });
});
