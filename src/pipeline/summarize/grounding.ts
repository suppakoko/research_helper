/**
 * The mechanical checks on one `PaperSummary` — `docs/06` §12.1 L3 and
 * `docs/12` §18.4 (`P3-T25` steps 4–5). No model, no network, no clock.
 *
 * - {@link checkGrounding} is §12.1's sketch, line for line: each key
 *   finding's `verbatimSupport` is looked for in the source text, by exact
 *   containment after §12.1's normalization, else by {@link tokenOverlap} at
 *   {@link GROUNDING_TOKEN_OVERLAP_MIN} or more.
 * - {@link tokenOverlap} is the function the sketch calls and nothing
 *   defined; its reading is `docs/06` §12.1's note of 2026-10-28, item (1).
 * - {@link checkNumeralInvariants} is §18.4's last invariant: every numeral of
 *   `effectSizes[].value` and `population.size` appears in the source text.
 *   It reports; it never changes or recomputes a value (`P3-T25` **Do NOT**).
 *
 * The policy built on these — the one retry, `confidence: "low"`, the warning
 * that keeps the key findings out of synthesis — is the caller's,
 * `summarizeItem` (`./summarizeItem.ts`).
 */

import type { PaperSummary } from "../../model/summary";

/** §12.1's policy line: below this a summary is retried, then marked low. */
export const GROUNDING_LOW_SCORE = 0.5;

/** §12.1's sketch: the token-overlap fallback's pass mark. */
export const GROUNDING_TOKEN_OVERLAP_MIN = 0.85;

/** What {@link checkGrounding} found. */
export interface GroundingResult {
  /** Supported findings ÷ findings; `null` when there are no findings. */
  readonly score: number | null;
  /** The statements of the findings that were not supported, in order. */
  readonly missing: readonly string[];
}

/** §12.1's `norm`: lower-case, whitespace collapsed, NFC, trimmed. */
function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").normalize("NFC").trim();
}

/** Letters-and-digits tokens of NFKC-folded, lower-cased text. */
function tokens(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * The share of `needle`'s tokens (counted with repeats) found in the best
 * window of `hay`'s tokens as long as the needle — `docs/06` §12.1's note of
 * 2026-10-28, item (1). Locality is the point: words scattered across a long
 * text do not make a quotation.
 *
 * @param needle - the quotation
 * @param hay - the source text
 * @returns a share in [0, 1]; `0` for a needle with no token
 */
export function tokenOverlap(needle: string, hay: string): number {
  const wanted = tokens(needle);
  const m = wanted.length;
  if (m === 0) return 0;
  const need = new Map<string, number>();
  for (const token of wanted) need.set(token, (need.get(token) ?? 0) + 1);

  const seq = tokens(hay);
  const window = new Map<string, number>();
  let matched = 0;
  let best = 0;
  for (let i = 0; i < seq.length; i += 1) {
    const add = seq[i] as string;
    const had = window.get(add) ?? 0;
    if (had < (need.get(add) ?? 0)) matched += 1;
    window.set(add, had + 1);
    if (i >= m) {
      const drop = seq[i - m] as string;
      const left = (window.get(drop) ?? 0) - 1;
      window.set(drop, left);
      if (left < (need.get(drop) ?? 0)) matched -= 1;
    }
    if (matched > best) {
      best = matched;
      if (best === m) break;
    }
  }
  return best / m;
}

/**
 * `docs/06` §12.1's `checkGrounding`, as the sketch writes it.
 *
 * @param summary - the payload's key findings
 * @param sourceText - the text the summary's calls carried (§12.1 note (2))
 * @returns the score and the unsupported statements
 */
export function checkGrounding(
  summary: Pick<PaperSummary, "keyFindings">,
  sourceText: string,
): GroundingResult {
  const hay = norm(sourceText);
  const findings = summary.keyFindings;
  let supported = 0;
  const missing: string[] = [];
  for (const finding of findings) {
    if (!finding.verbatimSupport) {
      missing.push(finding.statement);
      continue;
    }
    const needle = norm(finding.verbatimSupport);
    // Exact containment, else token overlap for whitespace/ligature drift.
    if (
      hay.includes(needle) ||
      tokenOverlap(needle, hay) >= GROUNDING_TOKEN_OVERLAP_MIN
    ) {
      supported += 1;
    } else {
      missing.push(finding.statement);
    }
  }
  return {
    score: findings.length > 0 ? supported / findings.length : null,
    missing,
  };
}

// ---------------------------------------------------------------------------
// `docs/12` §18.4: numerals that must appear in the source text
// ---------------------------------------------------------------------------

/** The warning a numeral of `effectSizes[].value` absent from the source adds. */
export const EFFECT_SIZE_NUMERAL_WARNING = "effect_size_numeral_not_in_source";

/** The warning a numeral of `population.size` absent from the source adds. */
export const POPULATION_SIZE_NUMERAL_WARNING =
  "population_size_numeral_not_in_source";

/** A run of digits with `.` or `,` only between digits: `0.62`, `1,204`. */
const NUMERAL = /\d+(?:[.,]\d+)*/g;

/**
 * The numerals in `text`, in order.
 *
 * @param text - a model-written value
 * @returns each numeral once per occurrence
 */
export function numeralsIn(text: string): string[] {
  return text.match(NUMERAL) ?? [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `numeral` stands in `source` as a numeral of its own: no digit,
 * and no digit followed by a separator, directly before it; no digit, and no
 * separator followed by a digit, directly after it. So `62` is not found in
 * `0.62`, nor `0.6` in `0.62`.
 *
 * @param numeral - from {@link numeralsIn}
 * @param source - the source text
 */
export function numeralInSource(numeral: string, source: string): boolean {
  const re = new RegExp(
    `(?<!\\d)(?<!\\d[.,])${escapeRegExp(numeral)}(?!\\d)(?![.,]\\d)`,
    "u",
  );
  return re.test(source);
}

/** What {@link checkNumeralInvariants} found. */
export interface NumeralCheck {
  /** Numerals of `effectSizes[].value` the source text does not hold. */
  readonly effectSizes: readonly string[];
  /** Numerals of `population.size` the source text does not hold. */
  readonly populationSize: readonly string[];
  /** One warning per kind of absence, at most two. */
  readonly warnings: readonly string[];
}

/**
 * `docs/12` §18.4: "Numeric strings in `effectSizes[].value` and
 * `population.size` appear in the source text." Reports only.
 *
 * @param summary - the payload
 * @param sourceText - the text the summary's calls carried
 * @returns the absent numerals and their warnings
 */
export function checkNumeralInvariants(
  summary: Pick<PaperSummary, "effectSizes" | "population">,
  sourceText: string,
): NumeralCheck {
  const absent = (values: readonly string[]): string[] => {
    const out: string[] = [];
    for (const value of values) {
      for (const numeral of numeralsIn(value)) {
        if (!numeralInSource(numeral, sourceText)) out.push(numeral);
      }
    }
    return out;
  };
  const effectSizes = absent(summary.effectSizes.map((e) => e.value));
  const size = summary.population.size;
  const populationSize = absent(size === null ? [] : [size]);
  const warnings: string[] = [];
  if (effectSizes.length > 0) warnings.push(EFFECT_SIZE_NUMERAL_WARNING);
  if (populationSize.length > 0) warnings.push(POPULATION_SIZE_NUMERAL_WARNING);
  return { effectSizes, populationSize, warnings };
}
