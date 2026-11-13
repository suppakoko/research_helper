/**
 * The per-paper chunker — `docs/06` §5.2–§5.3 and §13.5 (`P3-T23`).
 *
 * Caller: `summarizeItem` in `src/pipeline/summarize/summarizeItem.ts`
 * (`P3-T25`). {@link packByTokens} (`P4-T07`, section 8) is the synthesis
 * stages' packer: `analyseThemes` in `src/pipeline/trendReport/themeAnalysis.ts`
 * calls it for a theme's sub-batches, through `packThemeMembers` in
 * `src/pipeline/shared/estimate.ts`, which the estimate shares; `planCritique`
 * in `src/pipeline/trendReport/critique.ts` (`P4-T09`) is its other caller,
 * through its private `fitsOneCall`, packing a critique request's cited
 * summaries (corrected 2026-10-30,
 * `plan/00` §6 item 317(d): this line said "not built yet").
 * `compose.ts` (`P4-T08`) does not call it: the report trims `{{DIGESTS}}`
 * to a cited subset instead of packing them (corrected 2026-10-30,
 * `plan/00` §6 item 311; `plan/reports/P4-T08.md` finding 3).
 *
 * ## The three paths (`docs/06` §5.3)
 *
 * - **Single-shot** — the whole acquired `text` fits `PAPER_SUMMARY_FULLTEXT`'s
 *   budget: one call, no chunks. Always tried first; text that fits is never
 *   chunked.
 * - **Section-aware** — `sectionAware` is true: each section is chunked on its
 *   own, sections are taken in **synthesis-value order** (never document
 *   order), and under budget pressure each gets §5.3 step 2's share, so the
 *   lowest-value sections are the ones dropped.
 * - **Flat** — `sectionAware` is false: the whole text in document order,
 *   overlap between every adjacent pair, every chunk labelled `unknown`. This
 *   module never emits another label on this path, whatever `sections` holds.
 *
 * `sectionAware` is taken as given. Whether the detector is good enough to
 * set it is `P3-T22`'s measurement and gate `G-22` (`plan/00` §6 item
 * 298(a)); nothing here assumes it passes. *(It passed on the held-out set
 * on 2026-11-13, `P3-T41`, so the product now reaches the section-aware path
 * whenever an acquisition has two or more recognized sections; nothing in
 * this module changed for it.)*
 *
 * ## Budgets (`docs/06` §5.2, D-06-5)
 *
 * The per-call text budgets are §5.2's "input chunk budget" column in **raw**
 * estimated tokens (24 000 ≈ 88 k characters, as §5.3 says). Separately, every
 * call must satisfy §5.2's inequality with D-06-5's multiplier and reserve:
 * `1.15 × (prompt overhead + chunk label + text) ≤ contextWindow −
 * max_tokens − 800`. A model whose window is not known (`0` or `undefined`)
 * gets the column alone; the context-length retry below is its safety net.
 * A plan's total is {@link MAX_CHUNKS} chunks: `CHUNK_REDUCE` must take every
 * `CHUNK_MAP` answer within its own 12 000-token input budget, and each answer
 * may be as long as `CHUNK_MAP`'s `max_tokens`. Readings recorded in `docs/06`
 * §5.3 ("Decided 2026-10-27").
 *
 * **The budget constants live here, once** ({@link MAP_CALL_BUDGETS},
 * {@link ESTIMATE_HEADROOM}, {@link CHUNK_OVERLAP_TOKENS}); `P3-T16`'s pre-run
 * estimate (`src/pipeline/shared/estimate.ts`) re-exports them and prices
 * the chunks {@link planChunks} plans (owner, `plan/00` §6 item 299(b)).
 *
 * ## Units (§5.3 step 3, corrected D-06-4)
 *
 * `\n` is not a guaranteed paragraph boundary (`docs/06` §3.3.5). Each
 * document is measured first ({@link measureLineShape}): when the share of its
 * characters in `\n`-delimited segments of at least
 * {@link PARAGRAPH_SEGMENT_MIN_CHARS} characters reaches
 * {@link PARAGRAPH_LINE_SHARE_CUTOFF}, a `\n`-delimited segment is a paragraph
 * unit; below it, `\n` is a line break and the unit is the sentence. A unit
 * over the chunk budget is split on sentence boundaries, and a sentence over
 * it (one 50 000-character "word") at the last whitespace that fits, else at
 * the character. The cut-off is ruled (owner, `plan/00` §6 item 299(a)).
 *
 * ## Exactness
 *
 * Every chunk is a slice of `source.text` with its offsets. Within one span
 * (a section, or the whole text on the flat path) chunk *k* + 1's new content
 * starts exactly where chunk *k* ended, and its overlap — at most
 * {@link CHUNK_OVERLAP_TOKENS}, the last unit of chunk *k* — precedes it; so the
 * chunks with their overlap removed concatenate back to the span. Overlap never
 * crosses a section boundary. A chunk's own tokens never exceed the chunk
 * budget, counted as the sum of its units' estimates (never below the estimate
 * of the joined text).
 */

import {
  ConfigurationError,
  ContextLengthExceededError,
} from "../../core/errors";
import type { AcquiredSource, ImradSection } from "../../model/summary";
import { resolveMaxTokens, type PromptRegistry } from "../../prompts";

import { estTokens } from "./tokenEstimate";

// ===========================================================================
// 1. The numbers (docs/06 §5.1–§5.3, §13.5)
// ===========================================================================

/** The map-phase prompts of `docs/06` §5.2 (the synthesis ones are Phase 4's). */
export type MapCallKind =
  | "PAPER_SUMMARY_ABSTRACT"
  | "PAPER_SUMMARY_FULLTEXT"
  | "CHUNK_MAP"
  | "CHUNK_REDUCE";

/** One row of `docs/06` §5.2's table. */
export interface CallBudget {
  /** "Input chunk budget": the text the call may carry, raw estimated tokens. */
  readonly inputTokens: number;
  /** "`max_tokens` out": the output ceiling the call is sent with. */
  readonly maxOutputTokens: number;
}

/**
 * `docs/06` §5.2's per-call budgets for the four map-phase prompts,
 * transcribed (`test/unit/pipeline/estimate.test.ts` reads the table from the
 * document). The one definition: the chunker plans with it and `P3-T16`'s
 * estimate prices with it (owner, `plan/00` §6 item 299(b)).
 */
export const MAP_CALL_BUDGETS: Readonly<Record<MapCallKind, CallBudget>> =
  Object.freeze({
    PAPER_SUMMARY_ABSTRACT: { inputTokens: 2_000, maxOutputTokens: 1_200 },
    PAPER_SUMMARY_FULLTEXT: { inputTokens: 24_000, maxOutputTokens: 1_600 },
    CHUNK_MAP: { inputTokens: 6_000, maxOutputTokens: 900 },
    CHUNK_REDUCE: { inputTokens: 12_000, maxOutputTokens: 1_600 },
  });

/** §5.3 step 4: overlap carried from chunk *i* into chunk *i* + 1. */
export const CHUNK_OVERLAP_TOKENS = 250;
/**
 * D-06-5 (`docs/06` §5.1): every token estimate is multiplied by 1.15 before
 * budgeting — here before the context-window check, in the estimate before
 * pricing. Applied after `estTokens`' per-model calibration. `docs/03`
 * §10.2's "20 %" is not used: `docs/06` owns the budget model (`docs/07`
 * §4.3's `BudgetGuard` note, 2026-10-23).
 */
export const ESTIMATE_HEADROOM = 1.15;
/** D-06-5 / §5.2's `SAFETY(800)`: reserved beside `max_tokens`. */
export const RESERVE_TOKENS = 800;
/** §13.5: on a context-length error the paper's budget is halved, once. */
export const CONTEXT_RETRY_BUDGET_SCALE = 0.5;

/**
 * The single-shot prompt this module budgets for. The card's signature names
 * a prompt id; `PAPER_SUMMARY_FULLTEXT` is the only single-shot full-text
 * prompt (`docs/06` §7.2).
 */
export type SingleShotPromptId = "PAPER_SUMMARY_FULLTEXT";

/**
 * At most this many chunks per paper: ⌊`CHUNK_REDUCE`'s input budget ÷
 * `CHUNK_MAP`'s `max_tokens`⌋ = ⌊12 000 ÷ 900⌋ = 13, so `CHUNK_REDUCE` can
 * take every answer. Recomputed in {@link planChunks} from the prompt file
 * (or {@link MAP_CALL_BUDGETS} without a registry); this is the value for the
 * shipped `chunk-map.v1.0.0.md`.
 */
export const MAX_CHUNKS = 13;

/**
 * §5.3 step 1: synthesis-value order, lowest rank first. `background` and
 * `related_work` share a rank, as the step lists them together.
 */
export const SYNTHESIS_RANK: Readonly<Record<ImradSection, number>> =
  Object.freeze({
    abstract: 0,
    results: 1,
    methods: 2,
    discussion: 3,
    conclusion: 4,
    limitations: 5,
    introduction: 6,
    background: 7,
    related_work: 7,
    other: 8,
  });

/** §5.3 step 2: each label's share of the paper's budget; the rest get 0. */
export const SECTION_SHARES: Readonly<Record<ImradSection, number>> =
  Object.freeze({
    abstract: 0.08,
    results: 0.3,
    methods: 0.25,
    discussion: 0.2,
    conclusion: 0.07,
    limitations: 0.05,
    introduction: 0.05,
    background: 0,
    related_work: 0,
    other: 0,
  });

/** §3.3.5 / D-06-4's measure: segments of at least this many characters. */
export const PARAGRAPH_SEGMENT_MIN_CHARS = 200;

/**
 * At or above this share of characters in long segments, `\n` is a paragraph
 * boundary. Ruled 2026-10-27 (owner, `plan/00` §6 item 299(a); `P3-T23`'s
 * open line, as recommended — built first as a proposal). Set from
 * `P3-T20`'s 40 texts (`docs/06` §5.3, measured 2026-10-27): six are at most
 * 0.191 (hard-wrapped) and the other 34 at least 0.664; `P0-T19`'s seven
 * files had 0.39 and 0.00 against 0.64–0.85. 0.5 lies inside both gaps.
 */
export const PARAGRAPH_LINE_SHARE_CUTOFF = 0.5;

/** The section text the flat path labels every chunk with. */
export const UNKNOWN_SECTION = "unknown";

/** How finely the section-aware total is bisected when it has to shrink. */
const SHRINK_RESOLUTION_TOKENS = 64;

// ===========================================================================
// 2. Inputs and results
// ===========================================================================

/** What the chunker reads of an acquisition (`docs/06` §3.6). */
export type ChunkableSource = Pick<
  AcquiredSource,
  "itemKey" | "abstract" | "sections" | "sectionAware" | "text"
>;

/**
 * The model, as far as the budget needs it. `contextWindowTokens` of `0` or
 * `undefined` means "not known" (`UNKNOWN_TOKEN_LIMIT`, `CatalogueModel`).
 */
export interface ChunkModel {
  readonly id: string;
  readonly contextWindowTokens: number | undefined;
}

/**
 * Each prompt's own tokens with no paper text — system prompt, scaffold,
 * metadata, serialized schema — measured by the caller from what it will send,
 * as `P3-T16`'s `PromptOverheadTokens` is.
 */
export interface ChunkPromptOverhead {
  readonly PAPER_SUMMARY_FULLTEXT: number;
  readonly CHUNK_MAP: number;
}

/** What {@link planChunks} takes besides the source, model and prompt id. */
export interface PlanChunksOptions {
  /**
   * The registry the calls will be rendered from (`max_tokens` per prompt,
   * `resolveMaxTokens`). Without one — `P3-T16`'s estimate, before any
   * prompt is rendered — {@link MAP_CALL_BUDGETS}' ceilings apply; both are
   * `docs/06` §5.2's column.
   */
  readonly prompts?: Pick<PromptRegistry, "get">;
  readonly overhead: ChunkPromptOverhead;
  /**
   * The token counter. Default `estTokens(text, model.id)`: the heuristic
   * with the model's stored calibration (`P3-T13`).
   */
  readonly countTokens?: (text: string) => number;
  /**
   * 1, or {@link CONTEXT_RETRY_BUDGET_SCALE} for the one retry after a
   * context-length error. Multiplies both per-call text budgets.
   */
  readonly budgetScale?: number;
}

/** How the document's line breaks were read (§5.3 step 3). */
export interface LineShape {
  /** Share of characters in `\n`-delimited segments of ≥ 200 characters. */
  readonly longSegmentShare: number;
  /** `paragraph`: `\n` delimits units; `sentence`: `\n` is a line break. */
  readonly unit: "paragraph" | "sentence";
}

/** One labelled chunk. Offsets are UTF-16 indices into `source.text`. */
export interface TextChunk {
  /** 1-based position in the paper's chunk sequence. */
  readonly index: number;
  /** The sequence's length. */
  readonly total: number;
  /** `unknown` on the flat path; else the section's labels joined by `+`. */
  readonly section: string;
  /** The section's labels; empty on the flat path. */
  readonly labels: readonly ImradSection[];
  /** `[SECTION: x] [CHUNK i/n] [PAPER: itemKey K]` (§5.3 step 5). */
  readonly label: string;
  /** First character, overlap included. */
  readonly start: number;
  /** Where the overlap ends and this chunk's new content starts. */
  readonly contentStart: number;
  /** One past the last character. */
  readonly end: number;
  /** `source.text.slice(start, end)`. */
  readonly text: string;
  /** Sum of the units' estimates, overlap included; ≤ the chunk budget. */
  readonly tokens: number;
  readonly overlapTokens: number;
}

export interface SingleShotPlan {
  readonly kind: "single-shot";
  readonly promptId: SingleShotPromptId;
  readonly textTokens: number;
  /** The text budget the text was checked against. */
  readonly budgetTokens: number;
  readonly budgetScale: number;
}

export interface ChunkedPlan {
  readonly kind: "chunked";
  readonly path: "section-aware" | "flat";
  readonly chunks: readonly TextChunk[];
  readonly textTokens: number;
  /** Per-chunk text budget, label and overhead excluded. */
  readonly chunkBudgetTokens: number;
  readonly maxChunks: number;
  /** The most tokens one chunk's label can take ({@link labelReserveTokens}). */
  readonly labelReserveTokens: number;
  readonly budgetScale: number;
  readonly lineShape: LineShape;
  /** Some of the text is in no chunk (`StoredSummary.truncated`). */
  readonly truncated: boolean;
  /**
   * Section-aware only: the sections (by their `section` text) that lost
   * text to the budget, in synthesis order; empty otherwise.
   */
  readonly cutSections: readonly string[];
}

export type ChunkPlan = SingleShotPlan | ChunkedPlan;

// ===========================================================================
// 3. Budgets
// ===========================================================================

function knownWindow(model: ChunkModel): number | undefined {
  const w = model.contextWindowTokens;
  return w !== undefined && Number.isFinite(w) && w > 0 ? w : undefined;
}

/**
 * Raw tokens a call may carry beside its output under §5.2's inequality with
 * D-06-5: the largest `x` with `ceil(1.15 x) ≤ window − maxOut − 800`.
 */
export function windowRoom(
  contextWindowTokens: number | undefined,
  maxOutputTokens: number,
): number {
  if (contextWindowTokens === undefined) return Number.POSITIVE_INFINITY;
  const free = contextWindowTokens - maxOutputTokens - RESERVE_TOKENS;
  return free <= 0 ? 0 : Math.floor(free / ESTIMATE_HEADROOM + 1e-9);
}

/** §5.3 step 5's label. */
export function chunkLabel(
  section: string,
  index: number,
  total: number,
  itemKey: string,
): string {
  return `[SECTION: ${section}] [CHUNK ${index}/${total}] [PAPER: itemKey ${itemKey}]`;
}

/**
 * The tokens reserved for a chunk's label: the longest label this module
 * writes (a two-label section, three-digit chunk numbers) for `itemKey`.
 */
export function labelReserveTokens(
  itemKey: string,
  count: (text: string) => number,
): number {
  return count(chunkLabel("results+discussion", 999, 999, itemKey));
}

// ===========================================================================
// 4. Units: paragraphs, sentences, hard pieces
// ===========================================================================

/**
 * §5.3 step 3's measurement (owner, `plan/00` §6 item 299(a)): the share of
 * characters in `\n`-delimited segments of at least 200 characters, form
 * feeds not counted.
 */
export function measureLineShape(text: string): LineShape {
  let total = 0;
  let long = 0;
  for (const segment of text.split("\n")) {
    const n = segment.replace(/\f/g, "").length;
    total += n;
    if (n >= PARAGRAPH_SEGMENT_MIN_CHARS) long += n;
  }
  const longSegmentShare = total === 0 ? 0 : long / total;
  return {
    longSegmentShare,
    unit:
      longSegmentShare >= PARAGRAPH_LINE_SHARE_CUTOFF
        ? "paragraph"
        : "sentence",
  };
}

interface Span {
  readonly start: number;
  readonly end: number;
}

interface Unit extends Span {
  readonly tokens: number;
  /** `paragraph` units can be refined into sentences; `sentence` cannot. */
  readonly kind: "paragraph" | "sentence" | "piece";
}

/** `\n`-delimited segments, each keeping its `\n`; blank ones join the one before. */
function paragraphSpans(text: string, start: number, end: number): Span[] {
  const spans: Span[] = [];
  let s = start;
  while (s < end) {
    const nl = text.indexOf("\n", s);
    const e = nl === -1 || nl >= end ? end : nl + 1;
    const blank = text.slice(s, e).trim() === "";
    const prev = spans[spans.length - 1];
    if (blank && prev !== undefined) {
      spans[spans.length - 1] = { start: prev.start, end: e };
    } else {
      spans.push({ start: s, end: e });
    }
    s = e;
  }
  // A leading blank span takes the next one in.
  const first = spans[0];
  const second = spans[1];
  if (
    first !== undefined &&
    second !== undefined &&
    text.slice(first.start, first.end).trim() === ""
  ) {
    spans.splice(0, 2, { start: first.start, end: second.end });
  }
  return spans;
}

/** Words that end in a full stop without ending a sentence. */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "al",
  "approx",
  "ca",
  "cf",
  "dr",
  "e.g",
  "eq",
  "eqs",
  "fig",
  "figs",
  "i.e",
  "incl",
  "mr",
  "ms",
  "no",
  "nos",
  "pp",
  "ref",
  "refs",
  "resp",
  "sec",
  "suppl",
  "tab",
  "viz",
  "vol",
  "vs",
]);

/**
 * A sentence ends at `.`, `!` or `?` (closing quotes and brackets kept with
 * it) followed by whitespace and a capital or caseless letter — never a digit,
 * so "Fig. 3" holds — and not after an abbreviation or a single-letter
 * initial; or at `。！？`.
 */
const SENTENCE_END =
  /[.!?]["'”’)\]]*\s+(?=["'“‘([]?[\p{Lu}\p{Lo}])|[。！？]\s*/gu;

function endsWithAbbreviation(
  text: string,
  dot: number,
  from: number,
): boolean {
  let i = dot;
  while (i > from && /[\p{L}.]/u.test(text[i - 1] ?? "")) i--;
  const word = text.slice(i, dot).toLowerCase();
  return /^\p{L}$/u.test(word) || ABBREVIATIONS.has(word);
}

function sentenceSpans(text: string, start: number, end: number): Span[] {
  const slice = text.slice(start, end);
  const spans: Span[] = [];
  let s = start;
  for (const match of slice.matchAll(SENTENCE_END)) {
    const at = start + (match.index ?? 0);
    if (text[at] === "." && endsWithAbbreviation(text, at, s)) continue;
    const e = at + match[0].length;
    if (e > s && e < end) {
      spans.push({ start: s, end: e });
      s = e;
    }
  }
  if (s < end) spans.push({ start: s, end });
  return spans;
}

/**
 * Pieces of at most `budget` tokens: cut at the last whitespace in the
 * second half of what fits, else at the character (never inside a surrogate
 * pair). Docs/13's degenerate input: one 50 000-character word.
 */
function hardPieces(
  text: string,
  start: number,
  end: number,
  budget: number,
  count: (text: string) => number,
): Unit[] {
  const units: Unit[] = [];
  let s = start;
  while (s < end) {
    if (count(text.slice(s, end)) <= budget) {
      units.push({
        start: s,
        end,
        tokens: count(text.slice(s, end)),
        kind: "piece",
      });
      break;
    }
    // Largest e in (s, end) with count(s, e) <= budget: grow, then bisect.
    let lo = s + 1;
    let hi = Math.min(end, s + 64);
    while (hi < end && count(text.slice(s, hi)) <= budget) {
      lo = hi;
      hi = Math.min(end, s + (hi - s) * 2);
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (count(text.slice(s, mid)) <= budget) lo = mid;
      else hi = mid;
    }
    let e = lo;
    const ws = text.slice(s, e).search(/\s\S*$/u);
    if (ws > (e - s) / 2) e = s + ws + 1;
    const code = text.charCodeAt(e - 1);
    if (code >= 0xd800 && code <= 0xdbff && e - 1 > s) e -= 1;
    units.push({
      start: s,
      end: e,
      tokens: count(text.slice(s, e)),
      kind: "piece",
    });
    s = e;
  }
  return units;
}

/** Sentences of one span, each over `budget` cut into hard pieces. */
function sentenceUnits(
  text: string,
  span: Span,
  budget: number,
  count: (text: string) => number,
): Unit[] {
  const units: Unit[] = [];
  for (const sentence of sentenceSpans(text, span.start, span.end)) {
    const tokens = count(text.slice(sentence.start, sentence.end));
    if (tokens <= budget) units.push({ ...sentence, tokens, kind: "sentence" });
    else
      units.push(
        ...hardPieces(text, sentence.start, sentence.end, budget, count),
      );
  }
  return units;
}

/** One span's units, every one at most `budget` tokens. */
function spanUnits(
  text: string,
  span: Span,
  shape: LineShape,
  budget: number,
  count: (text: string) => number,
): Unit[] {
  if (shape.unit === "sentence")
    return sentenceUnits(text, span, budget, count);
  const units: Unit[] = [];
  for (const paragraph of paragraphSpans(text, span.start, span.end)) {
    const tokens = count(text.slice(paragraph.start, paragraph.end));
    if (tokens <= budget)
      units.push({ ...paragraph, tokens, kind: "paragraph" });
    else units.push(...sentenceUnits(text, paragraph, budget, count));
  }
  return units;
}

// ===========================================================================
// 5. Packing one span
// ===========================================================================

interface PackedChunk {
  readonly start: number;
  readonly contentStart: number;
  readonly end: number;
  readonly tokens: number;
  readonly overlapTokens: number;
}

interface PackedSpan {
  readonly chunks: PackedChunk[];
  /** New-content tokens packed. */
  readonly used: number;
  /** Whether the span's end was reached. */
  readonly complete: boolean;
}

/**
 * §5.3 step 4: the last unit of the chunk, capped at 250 tokens — the whole
 * unit when it fits, else its longest run of trailing sentences that fits,
 * else nothing.
 */
function overlapOf(
  text: string,
  last: Unit,
  count: (text: string) => number,
): { readonly start: number; readonly tokens: number } | undefined {
  if (last.tokens <= CHUNK_OVERLAP_TOKENS) {
    return { start: last.start, tokens: last.tokens };
  }
  const sentences = sentenceSpans(text, last.start, last.end);
  let tokens = 0;
  let start = last.end;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i] as Span;
    const t = count(text.slice(s.start, s.end));
    if (tokens + t > CHUNK_OVERLAP_TOKENS) break;
    tokens += t;
    start = s.start;
  }
  return start < last.end ? { start, tokens } : undefined;
}

/**
 * Greedy packing of `units` into chunks of at most `budget` tokens, overlap
 * included, taking at most `grant` tokens of new content. A paragraph that
 * would overrun the grant is refined into sentences so the grant is used up
 * to a sentence boundary; nothing past it is taken.
 */
function packSpan(
  text: string,
  units: readonly Unit[],
  budget: number,
  grant: number,
  count: (text: string) => number,
): PackedSpan {
  const queue = [...units];
  const chunks: PackedChunk[] = [];
  let used = 0;
  let carry: { readonly start: number; readonly tokens: number } | undefined;
  let i = 0;
  let stopped = false;
  while (i < queue.length && !stopped) {
    let start = carry?.start ?? (queue[i] as Unit).start;
    let tokens = carry?.tokens ?? 0;
    let overlapTokens = tokens;
    const contentStart = (queue[i] as Unit).start;
    let added = 0;
    let last: Unit | undefined;
    while (i < queue.length) {
      const unit = queue[i] as Unit;
      if (used + unit.tokens > grant) {
        if (unit.kind === "paragraph") {
          queue.splice(i, 1, ...sentenceUnits(text, unit, budget, count));
          continue;
        }
        stopped = true;
        break;
      }
      if (tokens + unit.tokens > budget) {
        // Every unit fits an empty chunk by construction; the guard keeps a
        // broken invariant from looping.
        if (added > 0 || overlapTokens === 0) break;
        // Only the overlap is in the way: this chunk starts without it.
        start = contentStart;
        tokens = 0;
        overlapTokens = 0;
        continue;
      }
      tokens += unit.tokens;
      used += unit.tokens;
      added += 1;
      last = unit;
      i += 1;
    }
    if (last === undefined) break;
    chunks.push({ start, contentStart, end: last.end, tokens, overlapTokens });
    carry = overlapOf(text, last, count);
  }
  return { chunks, used, complete: i >= queue.length };
}

// ===========================================================================
// 6. Planning
// ===========================================================================

interface SectionSpan extends Span {
  readonly labels: readonly ImradSection[];
}

interface Group {
  readonly key: string;
  readonly labels: readonly ImradSection[];
  readonly rank: number;
  readonly share: number;
  /** In document order. */
  readonly spans: Array<{ readonly span: SectionSpan; readonly units: Unit[] }>;
  readonly size: number;
  readonly firstStart: number;
}

/**
 * The section-aware path's spans: the abstract preamble (`abstract`, never a
 * detected section, `docs/06` §3.6) and every detected section with text.
 */
function sectionSpans(source: ChunkableSource): SectionSpan[] {
  const spans: SectionSpan[] = [];
  const abstract = source.abstract;
  if (
    abstract !== null &&
    abstract.trim() !== "" &&
    source.text.startsWith(abstract)
  ) {
    spans.push({ start: 0, end: abstract.length, labels: ["abstract"] });
  }
  for (const section of source.sections) {
    if (source.text.slice(section.start, section.end).trim() === "") continue;
    spans.push({
      start: section.start,
      end: section.end,
      labels: section.labels.length > 0 ? section.labels : [section.imrad],
    });
  }
  return spans;
}

function groupSections(
  text: string,
  spans: readonly SectionSpan[],
  shape: LineShape,
  budget: number,
  count: (text: string) => number,
): Group[] {
  const byKey = new Map<string, Group>();
  for (const span of spans) {
    const key = span.labels.join("+");
    const units = spanUnits(text, span, shape, budget, count);
    const size = units.reduce((sum, u) => sum + u.tokens, 0);
    const group = byKey.get(key);
    if (group === undefined) {
      byKey.set(key, {
        key,
        labels: span.labels,
        rank: Math.min(...span.labels.map((l) => SYNTHESIS_RANK[l])),
        share: span.labels.reduce((sum, l) => sum + SECTION_SHARES[l], 0),
        spans: [{ span, units }],
        size,
        firstStart: span.start,
      });
    } else {
      group.spans.push({ span, units });
      byKey.set(key, { ...group, size: group.size + size });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.rank - b.rank || a.firstStart - b.firstStart,
  );
}

/**
 * §5.3 step 2: under pressure each group gets `share × total` (no more than
 * it holds); what is left goes to the groups in synthesis order, the 0 %
 * ones included. Without pressure every group gets all of itself.
 */
function allocate(groups: readonly Group[], total: number): number[] {
  const sum = groups.reduce((s, g) => s + g.size, 0);
  if (sum <= total) return groups.map((g) => g.size);
  const grants = groups.map((g) =>
    Math.min(g.size, Math.floor(g.share * total)),
  );
  let left = total - grants.reduce((s, g) => s + g, 0);
  groups.forEach((g, i) => {
    const add = Math.min(g.size - (grants[i] as number), left);
    if (add > 0) {
      grants[i] = (grants[i] as number) + add;
      left -= add;
    }
  });
  return grants;
}

interface Placed {
  readonly chunk: PackedChunk;
  readonly labels: readonly ImradSection[];
  readonly section: string;
}

function packSections(
  text: string,
  groups: readonly Group[],
  grants: readonly number[],
  budget: number,
  count: (text: string) => number,
): { readonly placed: Placed[]; readonly cut: string[] } {
  const placed: Placed[] = [];
  const cut: string[] = [];
  groups.forEach((group, g) => {
    let left = grants[g] as number;
    let whole = true;
    for (const { units } of group.spans) {
      const packed = packSpan(text, units, budget, left, count);
      left -= packed.used;
      if (!packed.complete) whole = false;
      for (const chunk of packed.chunks) {
        placed.push({ chunk, labels: group.labels, section: group.key });
      }
    }
    if (!whole) cut.push(group.key);
  });
  return { placed, cut };
}

function finish(
  source: ChunkableSource,
  placed: readonly Placed[],
): TextChunk[] {
  const total = placed.length;
  return placed.map(({ chunk, labels, section }, i) => ({
    index: i + 1,
    total,
    section,
    labels,
    label: chunkLabel(section, i + 1, total, source.itemKey),
    start: chunk.start,
    contentStart: chunk.contentStart,
    end: chunk.end,
    text: source.text.slice(chunk.start, chunk.end),
    tokens: chunk.tokens,
    overlapTokens: chunk.overlapTokens,
  }));
}

/**
 * `P3-T23`: one single-shot call, or a labelled chunk sequence that fits the
 * model's window (module note).
 *
 * @param source - the acquisition (`docs/06` §3.6)
 * @param model - its id (calibration) and context window
 * @param promptId - the single-shot prompt the text is budgeted against
 * @param options - see {@link PlanChunksOptions}
 * @returns the plan
 * @throws ConfigurationError if the model's window cannot hold a chunk of at
 *   least twice the overlap beside `CHUNK_MAP`'s prompt and answer
 */
export function planChunks(
  source: ChunkableSource,
  model: ChunkModel,
  promptId: SingleShotPromptId,
  options: PlanChunksOptions,
): ChunkPlan {
  const count =
    options.countTokens ?? ((text: string) => estTokens(text, model.id));
  const scale = options.budgetScale ?? 1;
  if (!(scale > 0 && scale <= 1)) {
    throw new RangeError(
      `[research-helper] budgetScale must be in (0, 1], got ${String(scale)}`,
    );
  }
  const window = knownWindow(model);
  const text = source.text;
  const textTokens = count(text);

  const maxOut = (kind: "PAPER_SUMMARY_FULLTEXT" | "CHUNK_MAP"): number =>
    options.prompts === undefined
      ? MAP_CALL_BUDGETS[kind].maxOutputTokens
      : resolveMaxTokens(options.prompts.get(kind));
  const singleOut = maxOut(promptId);
  const singleBudget = Math.floor(
    Math.min(
      MAP_CALL_BUDGETS.PAPER_SUMMARY_FULLTEXT.inputTokens,
      windowRoom(window, singleOut) - options.overhead[promptId],
    ) * scale,
  );
  if (textTokens <= singleBudget) {
    return {
      kind: "single-shot",
      promptId,
      textTokens,
      budgetTokens: singleBudget,
      budgetScale: scale,
    };
  }

  const mapOut = maxOut("CHUNK_MAP");
  const maxChunks = Math.max(
    1,
    Math.floor(MAP_CALL_BUDGETS.CHUNK_REDUCE.inputTokens / mapOut),
  );
  const labelReserve = labelReserveTokens(source.itemKey, count);
  const budget = Math.floor(
    Math.min(
      MAP_CALL_BUDGETS.CHUNK_MAP.inputTokens,
      windowRoom(window, mapOut) - options.overhead.CHUNK_MAP - labelReserve,
    ) * scale,
  );
  if (budget < 2 * CHUNK_OVERLAP_TOKENS) {
    throw new ConfigurationError(
      "The model's context window cannot hold a chunk beside the CHUNK_MAP prompt",
      { modelId: model.id, contextWindowTokens: window, chunkBudget: budget },
    );
  }
  const lineShape = measureLineShape(text);
  const base = {
    kind: "chunked" as const,
    textTokens,
    chunkBudgetTokens: budget,
    maxChunks,
    labelReserveTokens: labelReserve,
    budgetScale: scale,
    lineShape,
  };

  const spans = source.sectionAware ? sectionSpans(source) : [];
  if (spans.length === 0) {
    const units = spanUnits(
      text,
      { start: 0, end: text.length },
      lineShape,
      budget,
      count,
    );
    const packed = packSpan(
      text,
      units,
      budget,
      Number.POSITIVE_INFINITY,
      count,
    );
    const kept = packed.chunks.slice(0, maxChunks);
    return {
      ...base,
      path: "flat",
      chunks: finish(
        source,
        kept.map((chunk) => ({ chunk, labels: [], section: UNKNOWN_SECTION })),
      ),
      truncated: kept.length < packed.chunks.length,
      cutSections: [],
    };
  }

  // The paper's total starts at MAX_CHUNKS full chunks. Each section starts a
  // chunk of its own, so the shares can need more chunks than that; the total
  // then shrinks until they fit, and is bisected back up to the largest total
  // found that still fits.
  const groups = groupSections(text, spans, lineShape, budget, count);
  const attempt = (total: number) =>
    packSections(text, groups, allocate(groups, total), budget, count);
  let total = maxChunks * budget;
  let best = attempt(total);
  let failing: number | undefined;
  while (best.placed.length > maxChunks && total > 1) {
    failing = total;
    total = Math.min(
      total - 1,
      Math.floor((total * maxChunks) / best.placed.length),
    );
    best = attempt(total);
  }
  if (failing !== undefined && best.placed.length <= maxChunks) {
    let fits = total;
    let over = failing;
    while (over - fits > SHRINK_RESOLUTION_TOKENS) {
      const mid = Math.floor((fits + over) / 2);
      const tried = attempt(mid);
      if (tried.placed.length <= maxChunks) {
        fits = mid;
        best = tried;
      } else {
        over = mid;
      }
    }
  }
  return {
    ...base,
    path: "section-aware",
    chunks: finish(source, best.placed.slice(0, maxChunks)),
    truncated: best.cut.length > 0 || best.placed.length > maxChunks,
    cutSections: best.cut,
  };
}

// ===========================================================================
// 7. The context-length retry (docs/06 §13.5)
// ===========================================================================

function samePlan(a: ChunkPlan, b: ChunkPlan): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "single-shot") return true;
  const bc = (b as ChunkedPlan).chunks;
  return (
    a.chunks.length === bc.length &&
    a.chunks.every((c, i) => c.start === bc[i]?.start && c.end === bc[i]?.end)
  );
}

/**
 * §13.5: run the paper's plan; on a {@link ContextLengthExceededError}, halve
 * the paper's budget and run once more. Whatever the retry throws — a second
 * context-length error included — propagates, and so does any other error
 * from the first run. When halving does not change the plan, the error
 * propagates at once: a context-length error is never retried unchanged.
 *
 * @param plan - builds the plan at a budget scale (`planChunks` with
 *   `budgetScale`)
 * @param run - sends the plan's calls
 */
export async function runWithContextRetry<T>(
  plan: (budgetScale: number) => ChunkPlan,
  run: (plan: ChunkPlan) => Promise<T>,
): Promise<T> {
  const first = plan(1);
  try {
    return await run(first);
  } catch (error: unknown) {
    if (!(error instanceof ContextLengthExceededError)) throw error;
    const halved = plan(CONTEXT_RETRY_BUDGET_SCALE);
    if (samePlan(first, halved)) throw error;
    return run(halved);
  }
}

// ===========================================================================
// 8. Packing items by tokens (`P4-T07`; docs/06 §8.4 last paragraph)
// ===========================================================================

/**
 * Pack whole items into the fewest batches whose token sums stay within
 * `budget`, keeping the items' order: the batches, concatenated, are `items`
 * exactly, and no item is split or repeated. The synthesis stages use it where
 * one call cannot carry every item — a theme's full summaries in
 * `CLUSTER_REDUCE` sub-batches (`docs/06` §8.4's last paragraph) and the
 * critique's cited summaries (`P4-T09`). The report's digests are trimmed,
 * not packed (`P4-T08`).
 *
 * **Fewest, then even.** A greedy pass in order gives the fewest batches any
 * order-keeping packing can (each batch is closed only when the next item does
 * not fit). The items are then packed again towards an even share — at most
 * the larger of the total ÷ that count and the largest item — and that packing
 * is kept when it needs no more batches; otherwise the greedy one is. So 22
 * equal items where 21 fit become 11 + 11, not 21 + 1: the same number of
 * calls, and no call made from one paper.
 *
 * **Counting.** `tokensOf` is the caller's cost of one item as it will be
 * sent, separator included; a batch's tokens are the sum of its items' costs.
 * `estTokens` rounds up, so the sum of the parts is never below the estimate of
 * the joined text (as {@link planChunks} counts a chunk).
 *
 * @param items - what to pack, in the order to keep
 * @param tokensOf - one item's cost: a whole number, 0 or more
 * @param budget - the most tokens one batch may hold: a whole number, 1 or more
 * @returns the batches, in order; `[]` for no items
 * @throws RangeError for a budget or a cost that is not such a whole number,
 *   or for an item whose cost alone exceeds the budget — it can be neither
 *   split nor sent, so the caller decides
 */
export function packByTokens<T>(
  items: readonly T[],
  tokensOf: (item: T) => number,
  budget: number,
): readonly (readonly T[])[] {
  if (!Number.isInteger(budget) || budget < 1) {
    throw new RangeError(
      `[research-helper] a packing budget is a whole number of at least 1, got ${String(budget)}`,
    );
  }
  const costs = items.map((item, index) => {
    const cost = tokensOf(item);
    if (!Number.isInteger(cost) || cost < 0) {
      throw new RangeError(
        `[research-helper] an item's token cost is a whole number of at least 0, got ${String(cost)} at ${String(index)}`,
      );
    }
    if (cost > budget) {
      throw new RangeError(
        `[research-helper] item ${String(index)} alone takes ${String(cost)} tokens, over the budget of ${String(budget)}`,
      );
    }
    return cost;
  });
  if (items.length === 0) return [];

  /** Greedy in order under `cap`: the batches as index ranges. */
  const greedy = (cap: number): readonly (readonly [number, number])[] => {
    const ranges: [number, number][] = [];
    let start = 0;
    let sum = 0;
    costs.forEach((cost, index) => {
      if (index > start && sum + cost > cap) {
        ranges.push([start, index]);
        start = index;
        sum = 0;
      }
      sum += cost;
    });
    ranges.push([start, costs.length]);
    return ranges;
  };

  const fewest = greedy(budget);
  const total = costs.reduce((a, b) => a + b, 0);
  const evenCap = Math.min(
    budget,
    Math.max(Math.ceil(total / fewest.length), ...costs),
  );
  const even = greedy(evenCap);
  const chosen = even.length === fewest.length ? even : fewest;
  return chosen.map(([from, to]) => items.slice(from, to));
}
