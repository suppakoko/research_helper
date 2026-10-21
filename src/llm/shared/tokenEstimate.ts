/**
 * The one heuristic token estimator.
 *
 * **Scope.** `P3-T06` step 6: the heuristic. `P3-T13` step 5: the per-model
 * calibration (`llm.tokenEstimateCalibration`, `docs/07` §8.5) on top of it, in
 * this same file — {@link estTokens} with a model ID applies the stored factor,
 * and {@link createCalibrationRecorder} measures and stores it. Every adapter's
 * `countTokens(text, modelId)` (`docs/07` §4.3) delegates here, so there is
 * exactly one estimator in the build.
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
 *
 * **Calibration** (`docs/03` §10.2, "Correcting the drift"; `docs/06` §5.1
 * D-06-5). The factor is applied after the heuristic and before any headroom
 * the budget step adds. It is read from the preference on each call with a
 * model ID; an absent, unparseable or non-positive entry means "not calibrated
 * yet" and the raw heuristic stands. It is written at most once per job, at job
 * end, never per call (`docs/07` §8.5, §8.2). The preference is read and
 * written through `src/prefs/`'s `getPref` / `setPref`: `docs/07` §8.5 names
 * this file as the row's reader.
 */

import { getPref, setPref } from "../../prefs";
import type { Logger } from "../../core/logger";

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
 * With a `modelId` whose calibration factor is stored, the heuristic's result
 * is multiplied by that factor and rounded up again. Without one, or with no
 * usable factor, it is the raw heuristic.
 *
 * @param text - any string; the empty string costs 0
 * @param modelId - the model the text is for; omit for the raw heuristic
 * @returns a whole, non-negative number of tokens, rounded up
 */
export function estTokens(text: string, modelId?: string): number {
  const raw = rawEstimate(text);
  if (modelId === undefined || raw === 0) return raw;
  const factor = calibrationFactor(modelId);
  // The epsilon keeps 10 × 1.2 at 12 when floating point lands a hair above.
  return factor === undefined ? raw : Math.ceil(raw * factor - 1e-9);
}

/** `docs/06` §5.1's heuristic, uncalibrated. */
function rawEstimate(text: string): number {
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

// ---------------------------------------------------------------------------
// Calibration — P3-T13 step 5
// ---------------------------------------------------------------------------

/** A stored factor: model ID → (actual input tokens ÷ raw estimate). */
export type CalibrationTable = Readonly<Record<string, number>>;

/**
 * How much one job's measured factor moves the stored one: the new factor is
 * `stored × (1 − w) + job × w`. No document gives a number; 0.5 lets a model's
 * factor follow a sustained change within a few jobs without one odd job
 * overwriting it. A model with no stored factor takes the job's directly.
 */
export const CALIBRATION_BLEND = 0.5;

function isFactor(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Parse the preference's JSON. Never throws: anything that is not a JSON
 * object is `{}`, and an entry that is not a positive finite number is dropped.
 *
 * @param raw - the stored string
 * @returns the usable entries
 */
export function parseCalibration(raw: string): CalibrationTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const table: Record<string, number> = {};
  for (const [modelId, value] of Object.entries(parsed)) {
    if (isFactor(value)) table[modelId] = value;
  }
  return table;
}

/** The last parsed preference value, so a run of estimates parses it once. */
let lastRaw: string | undefined;
let lastTable: CalibrationTable = {};

function storedCalibration(): CalibrationTable {
  const raw = getPref("llmTokenEstimateCalibration");
  if (raw !== lastRaw) {
    lastTable = parseCalibration(raw);
    lastRaw = raw;
  }
  return lastTable;
}

/**
 * The stored factor for one model.
 *
 * @param modelId - the model ID as `ChatRequest.model` carries it
 * @returns a positive factor, or `undefined` for "not calibrated yet"
 */
export function calibrationFactor(modelId: string): number | undefined {
  const table = storedCalibration();
  return Object.prototype.hasOwnProperty.call(table, modelId)
    ? table[modelId]
    : undefined;
}

/** One model's totals over a job. */
export interface CalibrationObservation {
  readonly estimatedInputTokens: number;
  readonly actualInputTokens: number;
}

/**
 * Fold one job's observations into the stored table.
 *
 * @param stored - the table as read at job end
 * @param observed - per model, the job's summed raw estimates and actual input
 * @returns the new table; models the job did not run are kept unchanged
 */
export function foldCalibration(
  stored: CalibrationTable,
  observed: ReadonlyMap<string, CalibrationObservation>,
): CalibrationTable {
  const next: Record<string, number> = { ...stored };
  for (const [modelId, totals] of observed) {
    if (totals.estimatedInputTokens <= 0 || totals.actualInputTokens <= 0) {
      continue;
    }
    const jobFactor = totals.actualInputTokens / totals.estimatedInputTokens;
    const previous = next[modelId];
    next[modelId] = isFactor(previous)
      ? previous * (1 - CALIBRATION_BLEND) + jobFactor * CALIBRATION_BLEND
      : jobFactor;
  }
  return next;
}

/** Accumulates one job's ratios in memory and writes them once, at job end. */
export interface CalibrationRecorder {
  /**
   * One call. `estimatedInputTokens` is the **raw** heuristic of what was sent
   * ({@link estTokens} without a model ID), so a stored factor never compounds;
   * `actualInputTokens` is the provider's `usage.inputTokens`. A call whose
   * counts are missing, zero or not finite is ignored.
   */
  record(
    modelId: string,
    estimatedInputTokens: number,
    actualInputTokens: number | undefined,
  ): void;
  /**
   * Job end: read the preference, fold this job's ratios in, and write it back
   * with exactly one `setPref`. Nothing usable recorded means no write. The
   * totals are cleared either way. Never throws: a failed write is logged and
   * reported as `false`, because a job must not fail at its last step over a
   * budgeting hint.
   *
   * @returns whether the preference was written
   */
  flush(): boolean;
}

/** What {@link createCalibrationRecorder} takes. */
export interface CalibrationRecorderDeps {
  readonly logger?: Logger;
}

/**
 * A recorder for one job. The job's runner calls `record` after each call and
 * `flush` once when the job ends.
 *
 * @param deps - see {@link CalibrationRecorderDeps}
 * @returns the recorder
 */
export function createCalibrationRecorder(
  deps: CalibrationRecorderDeps = {},
): CalibrationRecorder {
  const totals = new Map<string, CalibrationObservation>();

  return {
    record(modelId, estimatedInputTokens, actualInputTokens): void {
      if (
        modelId === "" ||
        !isFactor(estimatedInputTokens) ||
        !isFactor(actualInputTokens)
      ) {
        return;
      }
      const sum = totals.get(modelId);
      totals.set(modelId, {
        estimatedInputTokens:
          (sum?.estimatedInputTokens ?? 0) + estimatedInputTokens,
        actualInputTokens: (sum?.actualInputTokens ?? 0) + actualInputTokens,
      });
    },

    flush(): boolean {
      if (totals.size === 0) return false;
      const observed = new Map(totals);
      totals.clear();
      try {
        const next = foldCalibration(
          parseCalibration(getPref("llmTokenEstimateCalibration")),
          observed,
        );
        const sorted: Record<string, number> = {};
        for (const modelId of Object.keys(next).sort()) {
          sorted[modelId] = next[modelId] as number;
        }
        setPref("llmTokenEstimateCalibration", JSON.stringify(sorted));
        return true;
      } catch (error: unknown) {
        deps.logger?.warn(
          "token-estimate calibration could not be written; the job's ratios are dropped",
          { error: error instanceof Error ? error.name : typeof error },
        );
        return false;
      }
    },
  };
}
