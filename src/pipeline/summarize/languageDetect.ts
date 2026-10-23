/**
 * `docs/06` §4.2's language heuristic (`P3-T19` step 5).
 *
 * "Cheap heuristic, no library: count characters in Unicode blocks. If Hangul
 * (`가-힣`), CJK Unified Ideographs, Cyrillic or Arabic exceeds 15 % of
 * letters, mark `language_non_english`." Nothing more is claimed: a French or
 * German paper is Latin script and passes as English here, which is §4.2's
 * own limit, not a defect of this module.
 *
 * The four blocks are the ones `scripts/spike-structured-text.ts` measured
 * with (`P0-T19`): Hangul syllables U+AC00–U+D7A3 plus Hangul Jamo
 * U+1100–U+11FF, CJK Unified Ideographs U+4E00–U+9FFF, Cyrillic U+0400–U+04FF
 * and Arabic U+0600–U+06FF. "Letters" are Unicode `\p{L}`.
 *
 * Pure: no platform call, no preference read.
 */

/** The warning `docs/06` §3.6 and §13.2 name. */
export const LANGUAGE_NON_ENGLISH_WARNING = "language_non_english";

/** §4.2: a share of letters **above** this marks the text non-English. */
export const NON_LATIN_LETTER_SHARE_THRESHOLD = 0.15;

/** The four script groups §4.2 counts. */
export type CountedScript = "hangul" | "cjk" | "cyrillic" | "arabic";

/** What {@link detectLanguage} measured. */
export interface LanguageDetection {
  /** `\p{L}` characters in the text. */
  readonly letters: number;
  /** Letters in the four counted blocks, together. */
  readonly nonLatinLetters: number;
  /** `nonLatinLetters / letters`; `0` when there are no letters. */
  readonly nonLatinShare: number;
  /** `nonLatinShare > 0.15`. */
  readonly nonEnglish: boolean;
  /** The counted script with the most letters, or `null` when none occurs. */
  readonly dominantScript: CountedScript | null;
}

const SCRIPT_RANGES: readonly (readonly [CountedScript, RegExp])[] = [
  ["hangul", /[가-힣ᄀ-ᇿ]/u],
  ["cjk", /[一-鿿]/u],
  ["cyrillic", /[Ѐ-ӿ]/u],
  ["arabic", /[؀-ۿ]/u],
];

const LETTER = /\p{L}/u;

/**
 * Measure `text` against §4.2.
 *
 * @param text - any acquired text; the abstract preamble included
 * @returns the counts, the share and the verdict
 */
export function detectLanguage(text: string): LanguageDetection {
  const counts: Record<CountedScript, number> = {
    hangul: 0,
    cjk: 0,
    cyrillic: 0,
    arabic: 0,
  };
  let letters = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    letters += 1;
    for (const [script, range] of SCRIPT_RANGES) {
      if (range.test(ch)) {
        counts[script] += 1;
        break;
      }
    }
  }
  const nonLatinLetters =
    counts.hangul + counts.cjk + counts.cyrillic + counts.arabic;
  const nonLatinShare = letters === 0 ? 0 : nonLatinLetters / letters;
  let dominantScript: CountedScript | null = null;
  for (const [script] of SCRIPT_RANGES) {
    if (
      counts[script] > 0 &&
      (dominantScript === null || counts[script] > counts[dominantScript])
    ) {
      dominantScript = script;
    }
  }
  return {
    letters,
    nonLatinLetters,
    nonLatinShare,
    nonEnglish: nonLatinShare > NON_LATIN_LETTER_SHARE_THRESHOLD,
    dominantScript,
  };
}
