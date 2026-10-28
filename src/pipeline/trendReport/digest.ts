/**
 * The digest projection of the trend report (`P4-T04`; `docs/06` §8.2): one
 * stored summary becomes a deterministic, no-LLM block of at most
 * {@link DIGEST_MAX_TOKENS} tokens by `estTokens`, the input clustering and
 * the report call run on ("cluster on digests, synthesize on full
 * summaries").
 *
 * **Callers.** Nothing calls this module yet. The report run
 * (`trendReportPipeline.ts`, `P4-T18`) builds the digests at its "digest"
 * stage with {@link toDigest}, because it holds each item's year; `cluster.ts`
 * (`P4-T05`, and `P4-T06`'s two-stage path) joins {@link digestText} into
 * `THEME_CLUSTER`'s `{{DIGESTS}}`; `compose.ts` (`P4-T08`) and `scaffold.ts`
 * (`P4-T12`) read the same blocks. Nothing is constructed: every export is a
 * pure function or a constant.
 *
 * ## What is decided here
 *
 * The readings `docs/06` §8.2 leaves open are recorded in its note of
 * 2026-10-29; in short:
 *
 * - **Lines in §8.2's order, an empty one left out.** `head` and `tier` are
 *   always present; `Q:`, `Methods:`, `Theme(first-pass):` and `Keywords:`
 *   only when the summary has something for them.
 * - **Findings and metrics are withheld, and the block says so,** when the
 *   summary's `confidence` is `low` or `none`, or the row carries
 *   `P3-T25`'s `grounding_low_findings_excluded` (`docs/06` §12.1 L3).
 * - **Model text cannot break the block.** Every run of whitespace or
 *   control characters (line breaks of every kind included) becomes one
 *   space, so each line stays one line and no summary field can start a
 *   line of its own — a fake `[KEY]` head included. `<<<` is **not** escaped
 *   here: `renderPrompt` escapes every variable with `escapeSourceText` at
 *   render time (`docs/12` §1.1 rule 3).
 * - **Fixed truncation per line.** Each line has a token budget
 *   ({@link DIGEST_LINE_BUDGETS}) measured with `estTokens` (no model id, so
 *   no calibration and no preference read) over the line **as sent**, i.e.
 *   after `escapeSourceText`; the budgets plus the seven joining newlines sum
 *   to at most {@link DIGEST_MAX_TOKENS}, so the block can never pass it.
 *
 * Pure: no model, no preference, no clock, no platform call.
 */

import { estTokens } from "../../llm/shared/tokenEstimate";
import type { StoredSummary } from "../../model/summary";
import type { Digest, DigestLine, DigestLineKind } from "../../model/trend";
import { escapeSourceText } from "../../prompts";
import { DIGEST_MAX_TOKENS } from "../shared/estimate";
import { GROUNDING_LOW_WARNING } from "../summarize/summarizeItem";
import { ITEM_KEY_RE } from "./citations";

export { DIGEST_MAX_TOKENS };

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/**
 * Each line's budget in `estTokens` over its text as sent, label included.
 * `docs/06` §8.2's own example is 169 tokens by `estTokens` (whose
 * 3.7 characters per Latin token is cautious), so it is shortened too. The
 * sum, 137, plus the joining newlines (seven characters, at most 2 tokens) is
 * at most {@link DIGEST_MAX_TOKENS}; the unit test holds the arithmetic.
 */
export const DIGEST_LINE_BUDGETS: Readonly<Record<DigestLineKind, number>> =
  Object.freeze({
    head: 30,
    question: 18,
    methods: 15,
    findings: 24,
    metrics: 13,
    theme: 13,
    keywords: 13,
    tier: 11,
  });

/**
 * Caps inside the head line, each in `estTokens` over the piece alone. With
 * the head's fixed text (key, year and the three separators, at most 12
 * tokens) they sum to the head budget, so the population description gets
 * whatever room is left and the head can never pass its budget.
 */
export const DIGEST_HEAD_CAPS = Object.freeze({
  design: 9,
  populationKind: 4,
  populationSize: 5,
});

/**
 * The cap on the tier line's confidence (`medium` is the longest member); the
 * tier then takes the rest of the line's budget, which `fulltext_epmc` and
 * `metadata_only` fit.
 */
export const DIGEST_TIER_CAPS = Object.freeze({ confidence: 2 });

/** The text of a withheld `Findings:` or `Metrics:` line, after its label. */
export const DIGEST_WITHHELD = "withheld (low confidence)";

/** The year of an item with none. */
export const DIGEST_NO_YEAR = "n.d.";

/** What a cut field ends with. */
const ELLIPSIS = "…";

/** Every run of whitespace or control characters (`\p{Cc}` covers U+0085). */
const BREAKING_RE = /[\s\p{Cc}]+/gu;

/** The confidences whose findings never reach synthesis. */
const WITHHOLDING_CONFIDENCES: ReadonlySet<string> = new Set(["low", "none"]);

// ---------------------------------------------------------------------------
// 2. Input
// ---------------------------------------------------------------------------

export interface DigestInput {
  /** The stored row; its `content` is the payload §8.2 projects. */
  readonly summary: StoredSummary;
  /**
   * The item's year, a whole number 0–9999, from the Zotero item (the
   * summary carries none); `undefined` prints {@link DIGEST_NO_YEAR}.
   */
  readonly year: number | undefined;
}

// ---------------------------------------------------------------------------
// 3. Measuring and cutting
// ---------------------------------------------------------------------------

/**
 * What a piece of digest text costs as sent: `estTokens` (raw, no model id)
 * over the text after `escapeSourceText`, which `renderPrompt` applies.
 *
 * @param text - any digest text
 * @returns whole tokens
 */
export function digestTokens(text: string): number {
  return estTokens(escapeSourceText(text));
}

/** One line of model text: NFC, every breaking run one space, trimmed. */
function oneLine(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.normalize("NFC").replace(BREAKING_RE, " ").trim();
}

/**
 * The longest start of `content` such that `prefix + start + suffix` costs at
 * most `budget`, ending in {@link ELLIPSIS} when cut. A cut backs off to the
 * last space when that keeps at least half of what fitted, and drops trailing
 * separators before the ellipsis. `""` when not even one character fits.
 */
function fit(
  prefix: string,
  content: string,
  suffix: string,
  budget: number,
): string {
  if (content === "") return "";
  if (digestTokens(prefix + content + suffix) <= budget) return content;
  const chars = Array.from(content);
  const costAt = (n: number): number =>
    digestTokens(prefix + chars.slice(0, n).join("") + ELLIPSIS + suffix);
  // Cost is non-decreasing in n: a character never lowers it, and escaping
  // only ever adds a space.
  let low = 0;
  let high = chars.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (costAt(mid) <= budget) low = mid;
    else high = mid - 1;
  }
  if (low === 0) return "";
  const fitted = chars.slice(0, low).join("");
  let kept = fitted;
  // Back off to a word boundary unless the cut already falls on one.
  const space = kept.lastIndexOf(" ");
  if (chars[low] !== " " && space >= Math.ceil(kept.length / 2)) {
    kept = kept.slice(0, space);
  }
  kept = kept.replace(/[\s;,:|—-]+$/u, "");
  if (kept === "") return "";
  // A shorter start never costs more; the check keeps that a guarantee.
  return digestTokens(prefix + kept + ELLIPSIS + suffix) <= budget
    ? kept + ELLIPSIS
    : fitted + ELLIPSIS;
}

/** `label + content`, the content cut to the line's budget; `undefined` when empty. */
function labelled(
  kind: DigestLineKind,
  label: string,
  content: string,
): DigestLine | undefined {
  const kept = fit(label, content, "", DIGEST_LINE_BUDGETS[kind]);
  return kept === "" ? undefined : { kind, text: label + kept };
}

/** Non-empty one-line items joined by `"; "`. */
function list(items: readonly string[]): string {
  return items
    .map(oneLine)
    .filter((item) => item !== "")
    .join("; ");
}

// ---------------------------------------------------------------------------
// 4. The projection
// ---------------------------------------------------------------------------

/**
 * Whether a summary's `keyFindings` (and so its effect sizes) are kept out of
 * synthesis: `confidence` `low` or `none`, or `P3-T25`'s
 * `grounding_low_findings_excluded` on the row (`docs/06` §12.1 L3).
 *
 * @param summary - the stored row
 * @returns `true` when the digest withholds `Findings` and `Metrics`
 */
export function withholdsFindings(summary: StoredSummary): boolean {
  return (
    WITHHOLDING_CONFIDENCES.has(summary.content.confidence) ||
    summary.warnings.includes(GROUNDING_LOW_WARNING)
  );
}

function yearText(year: number | undefined): string {
  if (year === undefined) return DIGEST_NO_YEAR;
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError(
      `[research-helper] a digest year is a whole number 0–9999 or undefined, not ${String(year)}`,
    );
  }
  return String(year);
}

function headLine(input: DigestInput, itemKey: string): DigestLine {
  const content = input.summary.content;
  const budget = DIGEST_LINE_BUDGETS.head;
  const start = `[${itemKey}] ${yearText(input.year)}`;
  const design = fit(
    "",
    oneLine(content.studyDesign.label),
    "",
    DIGEST_HEAD_CAPS.design,
  );
  const kind = fit(
    "",
    oneLine(content.population.kind),
    "",
    DIGEST_HEAD_CAPS.populationKind,
  );
  const size = fit(
    "",
    oneLine(content.population.size),
    "",
    DIGEST_HEAD_CAPS.populationSize,
  );
  const designPart = design === "" ? "" : ` | design: ${design}`;
  const sizePart = size === "" ? "" : `n = ${size}`;

  // The description takes what the head has left after everything else.
  const popWith = (description: string): string => {
    const parts = [kind, description].filter((part) => part !== "").join(" — ");
    const whole = [parts, sizePart].filter((part) => part !== "").join(", ");
    return whole === "" ? "" : ` | pop: ${whole}`;
  };
  const rawDescription = oneLine(content.population.description);
  let description = "";
  if (rawDescription !== "") {
    // `fit` cuts the end of its content, so measure with the description in
    // its place: the head before it and the size after it.
    const before =
      start + designPart + " | pop: " + (kind === "" ? "" : `${kind} — `);
    const after = sizePart === "" ? "" : `, ${sizePart}`;
    description = fit(before, rawDescription, after, budget);
  }
  return { kind: "head", text: start + designPart + popWith(description) };
}

function findingsContent(summary: StoredSummary): string {
  return list(
    summary.content.keyFindings.map((finding) => {
      const statement = oneLine(finding.statement);
      return statement === ""
        ? ""
        : `${statement} (${oneLine(finding.direction)}, ${oneLine(finding.evidenceStrength)})`;
    }),
  );
}

function metricsContent(summary: StoredSummary): string {
  return list(
    summary.content.effectSizes.map((effect) => {
      const words = [
        oneLine(effect.metric),
        oneLine(effect.value),
        oneLine(effect.unit),
      ]
        .filter((word) => word !== "")
        .join(" ");
      const comparison = oneLine(effect.comparison);
      return comparison === "" || words === ""
        ? words
        : `${words} vs ${comparison}`;
    }),
  );
}

function tierLine(summary: StoredSummary): DigestLine {
  const confidence = fit(
    "",
    oneLine(summary.content.confidence),
    "",
    DIGEST_TIER_CAPS.confidence,
  );
  // The tier is measured in its place, so the line never passes its budget.
  const suffix = ` | Confidence: ${confidence}`;
  const tier = fit(
    "Tier: ",
    oneLine(summary.content.sourceTier),
    suffix,
    DIGEST_LINE_BUDGETS.tier,
  );
  return { kind: "tier", text: `Tier: ${tier}${suffix}` };
}

/**
 * `docs/06` §8.2's digest of one stored summary: the same input gives the
 * same lines on every call.
 *
 * @param input - the row and the item's year
 * @returns the digest, its lines in {@link DigestLineKind}'s order
 * @throws RangeError when `content.itemKey` is not a Zotero item key or the
 *   year is not a whole number 0–9999
 */
export function toDigest(input: DigestInput): Digest {
  const summary = input.summary;
  const content = summary.content;
  const itemKey = content.itemKey;
  if (!ITEM_KEY_RE.test(itemKey)) {
    throw new RangeError(
      `[research-helper] a digest needs a Zotero item key, not ${JSON.stringify(itemKey)}`,
    );
  }
  const withheld = withholdsFindings(summary);
  const lines: (DigestLine | undefined)[] = [
    headLine(input, itemKey),
    labelled("question", "Q: ", oneLine(content.researchQuestion)),
    labelled("methods", "Methods: ", list(content.methods)),
    withheld
      ? { kind: "findings", text: `Findings: ${DIGEST_WITHHELD}` }
      : labelled("findings", "Findings: ", findingsContent(summary)),
    withheld
      ? { kind: "metrics", text: `Metrics: ${DIGEST_WITHHELD}` }
      : labelled("metrics", "Metrics: ", metricsContent(summary)),
    labelled("theme", "Theme(first-pass): ", oneLine(content.researchTheme)),
    labelled("keywords", "Keywords: ", list(content.keywords)),
    tierLine(summary),
  ];
  return Object.freeze({
    itemKey,
    lines: Object.freeze(
      lines
        .filter((line): line is DigestLine => line !== undefined)
        .map((line) => Object.freeze(line)),
    ),
  });
}

/**
 * The block a prompt receives: the lines' text joined by `"\n"` (`docs/07`
 * §5.2's `Digest`). Not escaped — `renderPrompt` does that.
 *
 * @param digest - one digest
 * @returns the block
 */
export function digestText(digest: Digest): string {
  return digest.lines.map((line) => line.text).join("\n");
}
