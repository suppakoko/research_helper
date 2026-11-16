/**
 * Korean script measures — `plan/09` `P6-T08` steps 3–4: the Hangul syllable
 * count `docs/12` §14's length band is measured in, and the count of Arabic
 * numerals left in a Korean script, which is logged and never rejected.
 *
 * **Caller.** `./script.ts` (`scriptLengthOf` and `writeScript`). Constructed
 * nowhere: functions and constants only.
 *
 * **Authority.** `docs/12` §14 ("a Hangul syllable block is one syllable, so
 * count Hangul code points, not words"; `TARGET_MINUTES × ~330`, ±30 %);
 * `docs/04` §9.2 (no bare Arabic numerals should reach the Korean TTS call,
 * but "flag rather than hard-fail, since some numerals are acceptable in
 * context"); `plan/09` §0.4 line 17 (numerals are logged, not rejected; no
 * glossary in v1.0).
 *
 * **A numeral, as counted** (DECIDED 2026-11-17, coordinator, under
 * `plan/00` §6 item 313): one maximal run of the ASCII digits 0–9, so
 * `2024년` and `1,204` count as one and two. Fullwidth and other digits are
 * not counted: `docs/04` §9.2's check is `[0-9]`, and the acceptance run
 * (`P6-T19`) reads the figure as a signal, not a measure.
 */

/** 가, the first precomposed Hangul syllable. */
export const HANGUL_SYLLABLE_FIRST = 0xac00;
/** 힣, the last; a range ending earlier drops the last syllables. */
export const HANGUL_SYLLABLE_LAST = 0xd7a3;

/**
 * The precomposed Hangul syllables (U+AC00–U+D7A3) in `text`, counted by code
 * point. Jamo, compatibility jamo, Latin letters, digits, spaces and
 * punctuation are not syllables. The text is read as given: a decomposed
 * (NFD) syllable is jamo and is not counted, so a caller with untrusted
 * normalisation passes NFC.
 *
 * @param text - the script
 */
export function countHangulSyllables(text: string): number {
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= HANGUL_SYLLABLE_FIRST && cp <= HANGUL_SYLLABLE_LAST) count += 1;
  }
  return count;
}

/**
 * The runs of ASCII digits in `text` (module note).
 *
 * @param text - the script
 */
export function countArabicNumerals(text: string): number {
  return text.match(/[0-9]+/gu)?.length ?? 0;
}
