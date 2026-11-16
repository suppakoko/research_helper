/**
 * The chunker — `docs/04` §5.2's `chunkScript` and `splitSentences`, ported
 * to TypeScript (`plan/09` `P6-T09`). Renamed from the `src/tts/ssml.ts` that
 * `docs/07` §2.2 once named: v1.0 sends plain text, never SSML (`plan/09`
 * §0.4 line 22; `docs/04` §2.9, "SSML is not supported").
 *
 * **Callers.** `src/pipeline/audioReport/estimate.ts` (`P6-T10`, the chunk
 * count and character total of the second confirmation) and
 * `src/pipeline/audioReport/synthesize.ts` (`P6-T11`, one TTS request per
 * chunk). Pure functions: constructed nowhere, no I/O.
 *
 * ## What is kept from §5.2's sketch, and what is not
 *
 * Kept: paragraphs first, then sentences; the upper targets (900 English and
 * 450 Korean characters, `GEMINI_TTS_MAX_CHUNK_CHARS` in `./geminiTts.ts`);
 * whole paragraphs packed into one chunk while they fit; a long paragraph
 * split on sentence ends and closed at its own end, so a paragraph boundary
 * stays a chunk boundary (§5.3); the English abbreviation guard and its list.
 *
 * Changed, each *DECIDED 2026-11-16 (coordinator, under `plan/00` §6 item
 * 313)* and recorded in `plan/reports/P6-T09.md`:
 *
 * 1. **Chunks are slices of the script, not re-joined trims.** The sketch
 *    trims each piece and re-joins with `" "` or `"\n\n"`, which loses the
 *    script's own whitespace. Here every chunk is a contiguous slice, and its
 *    `separator` is the exact text up to the next chunk, so joining the chunks
 *    with their separators reproduces the script byte for byte (`AudioChunk`
 *    in `src/model/audio.ts`).
 * 2. **The upper target is a hard ceiling.** The sketch keeps filling a chunk
 *    shorter than `minChars` even when the next sentence takes it past
 *    `maxChars`; here a chunk is closed before it would exceed the target, so
 *    the lower target is not enforced and a short last paragraph is a short
 *    chunk.
 * 3. **A sentence ends at a terminal mark followed by whitespace or the end**
 *    (closing quotes and brackets allowed between). The sketch's `\s*` also
 *    splits "3.5" after the "3.", which is a mid-sentence cut.
 * 4. **A sentence longer than the target** is split after the last comma or
 *    semicolon (followed by whitespace) that keeps the piece within the
 *    target; failing that, at the last space outside a guarded abbreviation;
 *    only failing both, at the target itself (never inside a surrogate pair).
 *    Each such split is logged, by position and length, never by text
 *    (`P6-T09` step 2).
 * 5. **Korean sentence ends are `.`, `?` and `!`**, and the abbreviation guard
 *    applies to English only (`P6-T09` step 3).
 * 6. **A paragraph break is a whitespace run holding two line breaks**, spaces
 *    between them allowed; the sketch's `\n{2,}` misses `"\n \n"`.
 *
 * No text is carried from one chunk into the next (`docs/04` §5.3), and no
 * markup is added.
 */

import type { Logger } from "../core/logger";
import type { AudioChunk, AudioLanguage } from "../model/audio";

import { GEMINI_TTS_MAX_CHUNK_CHARS } from "./geminiTts";

/** A half-open range `[start, end)` of UTF-16 code units in the script. */
interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * `docs/04` §5.2's guarded abbreviations, the sketch's list unchanged. The
 * periods inside a match never end a sentence, and the spaces inside one
 * ("et al.") are never a split point.
 */
const ENGLISH_ABBREVIATIONS =
  /\b(?:et al|e\.g|i\.e|cf|vs|Fig|Eq|Ref|approx|ca|Dr|Prof|Inc|Ltd|St|No|vol|pp)\./giu;

/** Sentence-ending marks: the same three in both languages (`P6-T09` step 3). */
const TERMINALS = new Set([".", "?", "!"]);

/** What may follow a terminal mark before the whitespace: closing quotes and brackets. */
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]"]);

/** Clause breaks a long sentence may be split after (`P6-T09` step 2). */
const CLAUSE_BREAKS = new Set([",", ";", "，", "；"]);

function isSpace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

/** `span` without its leading and trailing whitespace, or `undefined` if nothing is left. */
function trimmed(text: string, span: Span): Span | undefined {
  let { start, end } = span;
  while (start < end && isSpace(text[start])) start += 1;
  while (end > start && isSpace(text[end - 1])) end -= 1;
  return start < end ? { start, end } : undefined;
}

/**
 * Which code units sit inside a guarded abbreviation (English only).
 *
 * @param text - the whole script
 * @param language - the script's language
 * @returns one flag per code unit
 */
function guardedMask(text: string, language: AudioLanguage): Uint8Array {
  const mask = new Uint8Array(text.length);
  if (language !== "en") return mask;
  for (const match of text.matchAll(ENGLISH_ABBREVIATIONS)) {
    mask.fill(1, match.index, match.index + match[0].length);
  }
  return mask;
}

/** The paragraphs of `text`, trimmed, in order (decision 6). */
function paragraphSpans(text: string): Span[] {
  const out: Span[] = [];
  let start = 0;
  for (const gap of text.matchAll(/\s*\n[^\S\n]*\n\s*/gu)) {
    const span = trimmed(text, { start, end: gap.index });
    if (span !== undefined) out.push(span);
    start = gap.index + gap[0].length;
  }
  const last = trimmed(text, { start, end: text.length });
  if (last !== undefined) out.push(last);
  return out;
}

/**
 * The sentences of `text[span]`, trimmed, in order (decisions 3 and 5).
 *
 * @param text - the whole script
 * @param span - the paragraph to split
 * @param guarded - {@link guardedMask}'s flags
 * @returns the sentences
 */
function sentenceSpans(text: string, span: Span, guarded: Uint8Array): Span[] {
  const out: Span[] = [];
  let start = span.start;
  for (let i = span.start; i < span.end; i += 1) {
    if (!TERMINALS.has(text[i] ?? "") || guarded[i] === 1) continue;
    let j = i + 1;
    while (j < span.end && TERMINALS.has(text[j] ?? "")) j += 1;
    while (j < span.end && CLOSERS.has(text[j] ?? "")) j += 1;
    if (j < span.end && !isSpace(text[j])) {
      i = j - 1;
      continue;
    }
    const sentence = trimmed(text, { start, end: j });
    if (sentence !== undefined) out.push(sentence);
    start = j;
    i = j - 1;
  }
  const rest = trimmed(text, { start, end: span.end });
  if (rest !== undefined) out.push(rest);
  return out;
}

/** What {@link chunkScript} reports when it splits inside a sentence. */
export type ForcedSplit = "clause" | "space" | "length";

/**
 * Split one over-long sentence into pieces of at most `max` (decision 4).
 *
 * @returns the pieces, each trimmed and at most `max` long
 */
function splitLongSentence(
  text: string,
  sentence: Span,
  max: number,
  guarded: Uint8Array,
  onSplit: (kind: ForcedSplit, at: number, length: number) => void,
): Span[] {
  const out: Span[] = [];
  let rest: Span | undefined = sentence;
  while (rest !== undefined && rest.end - rest.start > max) {
    const limit = rest.start + max;
    let cut: number | undefined;
    let kind: ForcedSplit = "clause";
    // The piece is `[rest.start, p + 1)`: the break mark stays with it.
    for (let p = limit - 1; p > rest.start; p -= 1) {
      if (CLAUSE_BREAKS.has(text[p] ?? "") && isSpace(text[p + 1])) {
        cut = p + 1;
        break;
      }
    }
    if (cut === undefined) {
      kind = "space";
      for (let p = limit; p > rest.start; p -= 1) {
        if (isSpace(text[p]) && guarded[p] !== 1) {
          cut = p;
          break;
        }
      }
    }
    if (cut === undefined) {
      kind = "length";
      cut = limit;
      // Never between the halves of a surrogate pair.
      const code = text.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    const piece = trimmed(text, { start: rest.start, end: cut });
    if (piece !== undefined) {
      out.push(piece);
      onSplit(kind, piece.end, piece.end - piece.start);
    }
    rest = trimmed(text, { start: cut, end: rest.end });
  }
  if (rest !== undefined) out.push(rest);
  return out;
}

/**
 * `docs/04` §5.2's sentence splitter, tolerant of academic abbreviations
 * (English) and with Korean's three sentence ends.
 *
 * @param text - one paragraph, or any text
 * @param language - `"en"` (the default) or `"ko"`
 * @returns the sentences, trimmed, empty ones dropped
 */
export function splitSentences(
  text: string,
  language: AudioLanguage = "en",
): string[] {
  const guarded = guardedMask(text, language);
  const whole = trimmed(text, { start: 0, end: text.length });
  if (whole === undefined) return [];
  return sentenceSpans(text, whole, guarded).map((s) =>
    text.slice(s.start, s.end),
  );
}

/** What {@link chunkScript} is asked for. */
export interface ChunkOptions {
  /** The script's language; it sets the ceiling and the guard. */
  readonly language: AudioLanguage;
  /**
   * The ceiling per chunk, in UTF-16 code units. Defaults to the language's
   * `GEMINI_TTS_MAX_CHUNK_CHARS` (`docs/04` §5.2); must be a positive integer.
   */
  readonly maxChars?: number;
  /** Receives one line per sentence split inside itself; never the text. */
  readonly logger?: Logger;
}

/**
 * Split a validated spoken script into TTS-sized chunks on paragraph, then
 * sentence, boundaries; never mid-sentence unless one sentence alone is over
 * the ceiling (decision 4).
 *
 * `chunks.map((c) => c.text + c.separator).join("")` is the script, exactly.
 * A script with no visible text yields no chunk.
 *
 * @param script - the validated spoken script
 * @param options - see {@link ChunkOptions}
 * @returns the chunks, in order, each at most the ceiling long
 */
export function chunkScript(
  script: string,
  options: ChunkOptions,
): AudioChunk[] {
  const max = options.maxChars ?? GEMINI_TTS_MAX_CHUNK_CHARS[options.language];
  if (!Number.isInteger(max) || max <= 0) {
    throw new RangeError(`maxChars must be a positive integer, got ${max}`);
  }
  const guarded = guardedMask(script, options.language);
  const onSplit = (kind: ForcedSplit, at: number, length: number): void => {
    options.logger?.info("tts chunk: long sentence split", {
      kind,
      at,
      length,
      maxChars: max,
    });
  };

  const spans: Span[] = [];
  let current: Span | undefined;
  const flush = (): void => {
    if (current !== undefined) spans.push(current);
    current = undefined;
  };
  const add = (unit: Span): void => {
    if (current !== undefined && unit.end - current.start > max) flush();
    current =
      current === undefined ? unit : { start: current.start, end: unit.end };
  };

  for (const paragraph of paragraphSpans(script)) {
    if (paragraph.end - paragraph.start > max) {
      flush();
      for (const sentence of sentenceSpans(script, paragraph, guarded)) {
        const pieces =
          sentence.end - sentence.start > max
            ? splitLongSentence(script, sentence, max, guarded, onSplit)
            : [sentence];
        for (const piece of pieces) add(piece);
      }
      flush();
    } else {
      add(paragraph);
    }
  }
  flush();

  return spans.map((span, index): AudioChunk => {
    // The first chunk starts at 0, so leading whitespace is not lost.
    const start = index === 0 ? 0 : span.start;
    const text = script.slice(start, span.end);
    const next = spans[index + 1];
    return {
      index,
      text,
      chars: text.length,
      separator: script.slice(span.end, next?.start ?? script.length),
    };
  });
}
