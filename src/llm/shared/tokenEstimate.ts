/**
 * The one heuristic token estimator.
 *
 * **Scope.** `P3-T06` step 6: the heuristic only. `P3-T13` adds the per-model
 * calibration (`llm.tokenEstimateCalibration`, `docs/07` §8.5) on top of it, in
 * this same file. Every adapter's `countTokens(text, modelId)` (`docs/07` §4.3)
 * delegates here, so there is exactly one estimator in the build.
 *
 * **Source.** `docs/06-summarization-and-trend-report.md` §5.1's `estTokens`,
 * transcribed with its four per-script ratios: Latin and scientific English
 * about 3.7 characters per token, Hangul syllables about 1.4, CJK ideographs
 * 1.0, and everything else 2.0. The loop walks code points, not UTF-16 units,
 * so a character outside the Basic Multilingual Plane counts once.
 *
 * **Never exact.** The result is an estimate: callers never gate a hard
 * behaviour on it (`docs/03` §10.2). §5.1's 1.15× safety multiplier and the
 * output-plus-800-token reserve (D-06-5) are applied by the budget step
 * (`P3-T16`), not here, so this function stays the raw heuristic that
 * calibration multiplies.
 */

/** Below this code point a character counts as Latin (`docs/06` §5.1). */
export const LATIN_END_EXCLUSIVE = 0x0250;
/** First Hangul syllable, 가. */
export const HANGUL_FIRST = 0xac00;
/** Last Hangul syllable, 힣 — a range ending earlier drops the last syllables. */
export const HANGUL_LAST = 0xd7a3;
/** First CJK Unified Ideograph. */
export const CJK_FIRST = 0x4e00;
/** Last CJK Unified Ideograph in §5.1's range. */
export const CJK_LAST = 0x9fff;

/** Characters per token for each script, `docs/06` §5.1. */
export const CHARS_PER_TOKEN = Object.freeze({
  latin: 3.7,
  hangul: 1.4,
  cjk: 1.0,
  other: 2.0,
});

/**
 * Estimate the number of tokens `text` costs on a typical provider tokenizer.
 *
 * @param text - any string; the empty string costs 0
 * @returns a whole, non-negative number of tokens, rounded up
 */
export function estTokens(text: string): number {
  let latin = 0;
  let hangul = 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < LATIN_END_EXCLUSIVE) latin++;
    else if (c >= HANGUL_FIRST && c <= HANGUL_LAST) hangul++;
    else if (c >= CJK_FIRST && c <= CJK_LAST) cjk++;
    else other++;
  }
  return Math.ceil(
    latin / CHARS_PER_TOKEN.latin +
      hangul / CHARS_PER_TOKEN.hangul +
      cjk / CHARS_PER_TOKEN.cjk +
      other / CHARS_PER_TOKEN.other,
  );
}
