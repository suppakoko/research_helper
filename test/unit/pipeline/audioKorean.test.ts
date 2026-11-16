/**
 * `plan/09` `P6-T08` — the Korean script measures (`countHangulSyllables`
 * and `countArabicNumerals` in `src/pipeline/audioReport/korean.ts`), layer 1.
 */

import { describe, expect, it } from "vitest";

import {
  countArabicNumerals,
  countHangulSyllables,
  HANGUL_SYLLABLE_FIRST,
  HANGUL_SYLLABLE_LAST,
} from "../../../src/pipeline/audioReport/korean";

/** A fixed sample: 20 Hangul syllables, Latin, digits, jamo and punctuation. */
const SAMPLE =
  "Testa 연구팀은 2024년에 열두 개의 조위계를 보정했습니다. ㄱㄴ ᄀ, CRISPR-Cas9!";

describe("countHangulSyllables (docs/12 §14)", () => {
  it("is exact on a fixed sample", () => {
    // 연구팀은(4) 년에(2) 열두(2) 개의(2) 조위계를(4) 보정했습니다(6) = 20.
    expect(countHangulSyllables(SAMPLE)).toBe(20);
    expect(countHangulSyllables("")).toBe(0);
    expect(countHangulSyllables("plain English, 12 words")).toBe(0);
  });

  it("counts the first and last syllable of the block, and nothing just outside it", () => {
    expect(String.fromCodePoint(HANGUL_SYLLABLE_FIRST)).toBe("가");
    expect(String.fromCodePoint(HANGUL_SYLLABLE_LAST)).toBe("힣");
    expect(countHangulSyllables("가힣")).toBe(2);
    expect(
      countHangulSyllables(
        String.fromCodePoint(
          HANGUL_SYLLABLE_FIRST - 1,
          HANGUL_SYLLABLE_LAST + 1,
        ),
      ),
    ).toBe(0);
  });

  it("does not count jamo, compatibility jamo or a decomposed syllable", () => {
    expect(countHangulSyllables("ㄱㅏ")).toBe(0);
    expect(countHangulSyllables("\u1100\u1161")).toBe(0);
    expect(countHangulSyllables("한".normalize("NFD"))).toBe(0);
    expect(countHangulSyllables("한".normalize("NFD").normalize("NFC"))).toBe(
      1,
    );
  });

  it("counts by code point, so a surrogate pair beside a syllable is not miscounted", () => {
    expect(countHangulSyllables("가😀나")).toBe(2);
  });
});

describe("countArabicNumerals (docs/04 §9.2)", () => {
  it("counts maximal runs of the ASCII digits", () => {
    expect(countArabicNumerals(SAMPLE)).toBe(2);
    expect(countArabicNumerals("1,204명, 0.05, 95%")).toBe(5);
    expect(countArabicNumerals("이천이십사 년")).toBe(0);
    expect(countArabicNumerals("１２")).toBe(0);
  });
});
