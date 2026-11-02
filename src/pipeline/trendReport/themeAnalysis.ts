/**
 * Per-theme analysis with sub-batching, depth at most 2 (`P4-T07`; `docs/12`
 * §9 and §21, `docs/06` §8.4's last paragraph, §12.1 L3, §5.2): each theme of a
 * validated clustering becomes one validated {@link ThemeAnalysis} from its
 * members' full summaries, every theme in parallel.
 *
 * **Callers.** Nothing calls this module yet. The report run
 * (`trendReportPipeline.ts`, `P4-T18`) calls {@link analyseThemes} at its
 * analyse stage, with the `clustered` outcome's clustering (`P4-T05`/`P4-T06`),
 * the stored summaries it digested (`P4-T04`), its context's budgeted router,
 * budget and token, the `llm` pool `buildPipelineSet` builds
 * (`src/bootstrap/registerPipelines.ts`, the constructing file, `P4-T18`), and
 * the `CLUSTER_REDUCE` and `CLUSTER_REDUCE_MERGE` templates. It adds the
 * outcome's `passes` to the run's counter and lifts each analysed theme's
 * `warnings` into the report's. Nothing is constructed here: every export is
 * a function, a type or a constant.
 *
 * ## What one theme does (`plan/07` `P4-T07` steps 1–5)
 *
 * 1. {@link summariesForReduce}: each member's stored `PaperSummary`, with
 *    `keyFindings` and `effectSizes` emptied when `withholdsFindings` says
 *    `docs/06` §12.1 L3 keeps them out (`P4-T04`'s rule, one rule for every
 *    synthesis input).
 * 2. {@link packThemeSummaries} packs the summaries (`packByTokens` in
 *    `src/llm/shared/chunking.ts`, by the rule `packThemeMembers` in
 *    `src/pipeline/shared/estimate.ts` states for the estimate too)
 *    into the fewest calls within `CLUSTER_REDUCE`'s 40 000-token input
 *    budget, or the less a small context window leaves
 *    ({@link ThemeAnalysisInput.inputBudget}; owner, `plan/00` §6 item 327). One batch: one `CLUSTER_REDUCE` call. More: one call per
 *    sub-batch, in parallel, then one `CLUSTER_REDUCE_MERGE` over the partial
 *    analyses — never deeper ({@link THEME_ANALYSIS_DEPTH_MAX}). Every call on
 *    `resolveModel("strong")`, at the prompt's temperature (0.3), effort
 *    `medium` (`plan/07` §0.2), budgeted, each holding one `llm` pool permit.
 * 3. {@link citedKeyProblems}: a key outside the call's set anywhere in the
 *    answer sends the same request once more; in that answer the key is
 *    removed ({@link removeForeignKeys}) and the theme carries
 *    {@link KEYS_REMOVED_WARNING}.
 * 4. A theme fails alone: it is reported `unanalysed` with a reason and the
 *    others go on (`docs/06` §8.5's failure policy); a cancel, a budget
 *    refusal, a rejected key, a configuration or privacy error ends the stage.
 * 5. Passes (FR-27): 1 for a theme made in one call, 2 for sub-batches and
 *    their merge; the stage's is the largest.
 * 6. When every theme ends unanalysed, the stage returns the stop
 *    `stopped-no-theme-analysed` with {@link NO_THEME_ANALYSED_L10N}; it
 *    removes nothing (owner, `plan/00` §6 item 309(g)).
 *
 * The readings these steps needed are `docs/12` §9's and §21's notes of
 * 2026-10-29 and `docs/06` §8.4's.
 *
 * **Model output is untrusted.** `completeJSON` validates every answer
 * against `theme-analysis.v1.json`; this module then checks every cited key —
 * every marker in every string, every key field — against the call's set,
 * replaces the echoed `themeId` and `name` with the clustering's, and keeps
 * nothing it did not check.
 */

import {
  AuthenticationError,
  BudgetExceededError,
  ConfigurationError,
  OperationCancelledError,
  PolicyViolationError,
  PrivacyRoutingError,
  ResearchHelperError,
} from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { LlmPool } from "../../core/jobQueue/queue";
import type { Logger } from "../../core/logger";
import type { MainWindowMessageId } from "../../i18n/keys";
import {
  completeJSON,
  type JsonChatTarget,
  type StructuredRequest,
} from "../../llm/shared/jsonMode";
import { estTokens } from "../../llm/shared/tokenEstimate";
import type {
  BudgetGuard,
  ChatRequest,
  ChatResponse,
  Effort,
  LLMCallContext,
  LLMRouter,
  ProviderRoutingHints,
  Usage,
} from "../../llm/types";
import type { PaperSummary, StoredSummary } from "../../model/summary";
import type {
  ClusteredTheme,
  ThemeAnalysis,
  ThemeClustering,
  TrendPromptUse,
} from "../../model/trend";
import {
  escapeSourceText,
  renderPrompt,
  resolveMaxTokens,
  type PromptTemplate,
} from "../../prompts";
import {
  maxPartialsPerMerge,
  packThemeMembers,
  SYNTHESIS_INPUT_BUDGETS,
} from "../shared/estimate";
import { ITEM_KEY_RE } from "./citations";
import { withholdsFindings } from "./digest";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** `plan/07` §0.2 (owner, `plan/00` §6 items 286, 290(a)): both prompts send `medium`. */
export const THEME_ANALYSIS_EFFORT: Effort = "medium";

/** The `json_schema` name sent with the schema: the schema's own `title`. */
export const THEME_ANALYSIS_SCHEMA_NAME = "ThemeAnalysis";

/** Requests one call may send for step 3, `completeJSON`'s repair and retry aside: the answer and one retry. */
export const THEME_ANALYSIS_REQUESTS_MAX = 2;

/** `docs/06` §8.4: sub-batches, then one merge; never a third level. */
export const THEME_ANALYSIS_DEPTH_MAX = 2;

/** On an analysed theme whose final answer had keys removed (step 3). */
export const KEYS_REMOVED_WARNING = "theme_analysis_keys_removed";

/** On an analysed theme whose answer echoed another `themeId` or `name`. */
export const ECHO_CORRECTED_WARNING = "theme_analysis_echo_corrected";

/** Why a theme is `unanalysed` when no error code says it. */
export const UNANALYSED_REASONS = Object.freeze({
  /** Step 3's removal left no representative paper; `ThemeAnalysis` needs one. */
  noRepresentativePapers: "no_representative_papers",
  /**
   * More sub-batches than one merge can take: depth 3 would be needed. Or, on
   * a small context window, one summary alone over the input budget.
   */
  tooLarge: "theme_too_large",
  /** The partial analyses, as measured, did not fit the merge's input budget. */
  mergeInputOverBudget: "merge_input_over_budget",
});

/**
 * The stop message when every theme ended unanalysed (owner, `plan/00` §6
 * item 309(g)). No argument. On `KO_PRESENT` since the owner reviewed its
 * Korean (`G-41`, `plan/00` §6 item 310(a)).
 */
export const NO_THEME_ANALYSED_L10N =
  "research-helper-report-stopped-no-theme-analysed" as const satisfies MainWindowMessageId;

/** A marker-shaped run, as `citations.ts` finds one: `[[`, one line without brackets, `]]`. */
const MARKER_RE = /\[\[([^[\]\r\n]*)\]\]/g;

/** A marker with the horizontal space before it, for removal. */
const SPACED_MARKER_RE = /[ \t]*\[\[([^[\]\r\n]*)\]\]/g;

/** What separates a combined marker's parts (`plan/00` §6 item 292(c)). */
const PART_SEPARATOR_RE = /\s*[,;]\s*/;

/** Every run of whitespace or control characters. */
const BREAKING_RE = /[\s\p{Cc}]+/gu;

// ---------------------------------------------------------------------------
// 2. Types
// ---------------------------------------------------------------------------

/** What {@link analyseThemes} needs from the job — its context, in pieces. */
export interface ThemeAnalysisDeps {
  /** `PipelineContext.llm`: the budgeted router (`withBudget`). */
  readonly llm: Pick<LLMRouter, "activeProvider" | "resolveModel" | "chat">;
  /** `PipelineContext.budget`, passed on **every** request (`plan/07` §0.2 item 11). */
  readonly budget: BudgetGuard;
  readonly token: CancellationToken;
  /** The plugin's `llm` pool (`createLlmPool`): one permit per request. */
  readonly pool: Pick<LlmPool, "acquire">;
  /** The active `CLUSTER_REDUCE` template. */
  readonly reducePrompt: PromptTemplate;
  /** The active `CLUSTER_REDUCE_MERGE` template. */
  readonly mergePrompt: PromptTemplate;
  /** The privacy mode's routing hints, when the run has them. */
  readonly routing?: ProviderRoutingHints;
  /** The `logRequestBodies` preference, for `completeJSON`'s error context. */
  readonly includeBodies?: boolean;
  readonly logger?: Logger;
  /** Prefix of each request's `traceId`. */
  readonly traceId?: string;
  /**
   * Each theme's analysis the moment it is validated, before the stage
   * settles — so a theme already paid for survives a stage-ending error (a
   * budget refusal pauses the job and "continue" runs the stage again).
   * Called once per analysed theme; awaited; an error it throws is ignored.
   * Caller: `trendReportPipeline.ts`'s Analysing stage, which keeps the
   * result for the run and stores its `cr` entry (`plan/00` §6 item 322(e),
   * `P4-T18` finding 3; added 2026-11-01 by `P4-T20`).
   */
  readonly onThemeAnalysed?: (theme: AnalysedTheme) => void | Promise<void>;
}

/** What the analyse stage is given. */
export interface ThemeAnalysisInput {
  /** The `clustered` outcome's clustering; each theme's `itemKeys` are its members. */
  readonly clustering: Pick<ThemeClustering, "themes">;
  /** One stored summary per analysed paper, found by `content.itemKey`. */
  readonly summaries: readonly StoredSummary[];
  /** `{{USER_TOPIC}}`: the collection's topic. Untrusted. */
  readonly userTopic: string;
  /**
   * `CLUSTER_REDUCE`'s input budget: `docs/06` §5.2's 40 000 when absent, never
   * raised above it. The report run passes `synthesisBudgets`' `reduce`, which
   * follows the model's context window (owner, `plan/00` §6 item 327(a)).
   */
  readonly inputBudget?: number;
  /** `CLUSTER_REDUCE_MERGE`'s, the same way: `synthesisBudgets`' `reduceMerge`. */
  readonly mergeInputBudget?: number;
}

interface ThemeResultBase {
  readonly themeId: string;
  /** Levels at which this theme sent a request: 0, 1 or 2. */
  readonly passes: number;
  /** `CLUSTER_REDUCE` calls planned: 1, or the sub-batch count. */
  readonly subBatches: number;
  /** Requests for steps 2–3, retries included, `completeJSON`'s repairs aside. */
  readonly requests: number;
  /** Every chat request made, `completeJSON`'s repairs and retries included. */
  readonly calls: number;
}

/** A validated analysis. */
export interface AnalysedTheme extends ThemeResultBase {
  readonly status: "analysed";
  readonly analysis: ThemeAnalysis;
  /** Well-formed keys step 3 removed from the final answer, in order. */
  readonly removedKeys: readonly string[];
  /** Malformed markers or parts step 3 removed (their text is not kept). */
  readonly removedMalformed: number;
  /** {@link KEYS_REMOVED_WARNING}, {@link ECHO_CORRECTED_WARNING}. */
  readonly warnings: readonly string[];
}

/** A theme the report shows as not analysed (`docs/06` §8.5). */
export interface UnanalysedTheme extends ThemeResultBase {
  readonly status: "unanalysed";
  /** An error's `code`, or one of {@link UNANALYSED_REASONS}. */
  readonly reason: string;
}

export type ThemeResult = AnalysedTheme | UnanalysedTheme;

/** What every analyse-stage outcome reports. */
interface ThemeAnalysisOutcomeBase {
  /** One per theme, in the clustering's order. */
  readonly themes: readonly ThemeResult[];
  /** Reduction passes (FR-27): the largest of the themes', 0 with no theme. */
  readonly passes: number;
  readonly requests: number;
  readonly calls: number;
  /** Summed over every answer received; a field is `undefined` if any lacked it. */
  readonly usage: Usage;
  /** `CLUSTER_REDUCE`, and `CLUSTER_REDUCE_MERGE` when a merge was sent. */
  readonly prompts: readonly TrendPromptUse[];
}

/** At least one theme analysed (or no theme given); the others are reported unanalysed. */
export interface ThemesAnalysedOutcome extends ThemeAnalysisOutcomeBase {
  readonly status: "analysed";
}

/**
 * Every theme ended unanalysed, so the report has nothing to write about: the
 * run stops before anything is written and says why; the summaries and the
 * cached stage results are kept (owner, `plan/00` §6 item 309(g); `docs/12`
 * §9's note of 2026-10-29). `P4-T18` ends the job on it. `themes` still holds
 * each theme's result, its reason included.
 */
export interface NoThemeAnalysedOutcome extends ThemeAnalysisOutcomeBase {
  readonly status: "stopped-no-theme-analysed";
  readonly messageId: typeof NO_THEME_ANALYSED_L10N;
}

/** The analyse stage's result. */
export type ThemeAnalysisOutcome =
  ThemesAnalysedOutcome | NoThemeAnalysedOutcome;

/** What {@link citedKeyProblems} found. */
export interface CitedKeyProblems {
  /** Well-formed keys outside the set, each once, in order. */
  readonly foreignKeys: readonly string[];
  /** Markers or parts that are not item keys. */
  readonly malformed: number;
}

// ---------------------------------------------------------------------------
// 3. Pure helpers
// ---------------------------------------------------------------------------

/** One line: every breaking run one space, trimmed. */
function oneLine(value: string): string {
  return value.replace(BREAKING_RE, " ").trim();
}

/** A marker's content, split into its parts as written. */
function partsOf(content: string): readonly string[] {
  return content.split(PART_SEPARATOR_RE);
}

/** Every string field of an analysis that can hold a marker. */
function stringsOf(analysis: ThemeAnalysis): readonly string[] {
  return [
    analysis.narrative,
    analysis.trajectory,
    ...analysis.representativePapers.map((p) => p.why),
    ...(analysis.methodologicalPatterns ?? []).map((p) => p.pattern),
    ...(analysis.convergentFindings ?? []).map((f) => f.statement),
    ...(analysis.contradictions ?? []).flatMap((c) => [
      c.statement,
      c.sideA.claim,
      c.sideB.claim,
      ...(typeof c.possibleExplanation === "string"
        ? [c.possibleExplanation]
        : []),
    ]),
    ...(analysis.gaps ?? []).flatMap((g) => [g.gap, g.basis]),
  ];
}

/** Every item-key field of an analysis. */
function keyFieldsOf(analysis: ThemeAnalysis): readonly string[] {
  return [
    ...analysis.representativePapers.map((p) => p.itemKey),
    ...(analysis.methodologicalPatterns ?? []).flatMap((p) => p.itemKeys),
    ...(analysis.convergentFindings ?? []).flatMap((f) => f.itemKeys),
    ...(analysis.contradictions ?? []).flatMap((c) => [
      ...c.sideA.itemKeys,
      ...c.sideB.itemKeys,
    ]),
    ...(analysis.gaps ?? []).flatMap((g) => g.itemKeys ?? []),
  ];
}

/**
 * Every key an analysis cites, as written, in order: each part of each marker
 * in every string field, then every key field (`docs/12` §9's note of
 * 2026-10-29, reading (1)). Malformed parts are included.
 *
 * @param analysis - a schema-valid analysis
 */
export function citedKeysOfAnalysis(
  analysis: ThemeAnalysis,
): readonly string[] {
  const cited: string[] = [];
  for (const text of stringsOf(analysis)) {
    for (const match of text.matchAll(MARKER_RE)) {
      cited.push(...partsOf(match[1] ?? ""));
    }
  }
  cited.push(...keyFieldsOf(analysis));
  return cited;
}

/**
 * Step 3's check: the cited keys outside `allowed`.
 *
 * @param analysis - a schema-valid analysis
 * @param allowed - the call's set
 */
export function citedKeyProblems(
  analysis: ThemeAnalysis,
  allowed: ReadonlySet<string>,
): CitedKeyProblems {
  const foreign: string[] = [];
  let malformed = 0;
  for (const key of citedKeysOfAnalysis(analysis)) {
    if (allowed.has(key)) continue;
    if (!ITEM_KEY_RE.test(key)) malformed += 1;
    else if (!foreign.includes(key)) foreign.push(key);
  }
  return { foreignKeys: foreign, malformed };
}

/** Whether {@link citedKeyProblems} found anything. */
export function hasKeyProblems(problems: CitedKeyProblems): boolean {
  return problems.foreignKeys.length > 0 || problems.malformed > 0;
}

/** What {@link removeForeignKeys} returns. */
export interface KeyRemoval {
  readonly analysis: ThemeAnalysis;
  /** Well-formed keys removed, in order, repeats kept. */
  readonly removedKeys: readonly string[];
  readonly removedMalformed: number;
}

/**
 * Step 3's removal from a final answer (`docs/12` §9's note of 2026-10-29,
 * reading (3)): a marker outside `allowed` goes with the spaces before it, and
 * a combined marker keeps its allowed parts, one marker each; a key leaves its
 * list; a convergent finding or methodological pattern whose keys were all
 * removed is dropped, as is a contradiction either side of which was; a gap
 * stays with `itemKeys` omitted when none is left; a representative paper with
 * a removed key is dropped. The caller decides what an empty
 * `representativePapers` means.
 *
 * @param analysis - a schema-valid analysis
 * @param allowed - the call's set
 */
export function removeForeignKeys(
  analysis: ThemeAnalysis,
  allowed: ReadonlySet<string>,
): KeyRemoval {
  const removedKeys: string[] = [];
  let removedMalformed = 0;
  const note = (key: string): void => {
    if (ITEM_KEY_RE.test(key)) removedKeys.push(key);
    else removedMalformed += 1;
  };
  const text = (value: string): string =>
    value.replace(SPACED_MARKER_RE, (whole, content: string) => {
      const parts = partsOf(content);
      const kept = parts.filter((part) => allowed.has(part));
      if (kept.length === parts.length) return whole;
      parts.filter((part) => !allowed.has(part)).forEach(note);
      if (kept.length === 0) return "";
      const lead = /^[ \t]*/.exec(whole)?.[0] ?? "";
      return lead + kept.map((key) => `[[${key}]]`).join(" ");
    });
  /** The list without foreign keys, or `undefined` when it had keys and lost them all. */
  const keyList = (keys: readonly string[]): readonly string[] | undefined => {
    const kept = keys.filter((key) => allowed.has(key));
    keys.filter((key) => !allowed.has(key)).forEach(note);
    return keys.length > 0 && kept.length === 0 ? undefined : kept;
  };

  const representativePapers = analysis.representativePapers.flatMap(
    (paper) => {
      if (!allowed.has(paper.itemKey)) {
        note(paper.itemKey);
        return [];
      }
      return [{ itemKey: paper.itemKey, why: text(paper.why) }];
    },
  );
  const methodologicalPatterns = analysis.methodologicalPatterns?.flatMap(
    (p) => {
      const itemKeys = keyList(p.itemKeys);
      return itemKeys === undefined
        ? []
        : [{ pattern: text(p.pattern), itemKeys }];
    },
  );
  const convergentFindings = analysis.convergentFindings?.flatMap((f) => {
    const itemKeys = keyList(f.itemKeys);
    return itemKeys === undefined
      ? []
      : [{ statement: text(f.statement), itemKeys, strength: f.strength }];
  });
  const contradictions = analysis.contradictions?.flatMap((c) => {
    const a = keyList(c.sideA.itemKeys);
    const b = keyList(c.sideB.itemKeys);
    if (a === undefined || b === undefined) return [];
    return [
      {
        statement: text(c.statement),
        sideA: { claim: text(c.sideA.claim), itemKeys: a },
        sideB: { claim: text(c.sideB.claim), itemKeys: b },
        ...(c.possibleExplanation !== undefined && {
          possibleExplanation:
            c.possibleExplanation === null ? null : text(c.possibleExplanation),
        }),
      },
    ];
  });
  const gaps = analysis.gaps?.map((g) => {
    const itemKeys =
      g.itemKeys === undefined ? undefined : (keyList(g.itemKeys) ?? []);
    return {
      gap: text(g.gap),
      basis: text(g.basis),
      ...(itemKeys !== undefined && itemKeys.length > 0 && { itemKeys }),
    };
  });

  return {
    analysis: {
      themeId: analysis.themeId,
      name: analysis.name,
      narrative: text(analysis.narrative),
      representativePapers,
      ...(methodologicalPatterns !== undefined && { methodologicalPatterns }),
      ...(convergentFindings !== undefined && { convergentFindings }),
      ...(contradictions !== undefined && { contradictions }),
      ...(gaps !== undefined && { gaps }),
      trajectory: text(analysis.trajectory),
    },
    removedKeys,
    removedMalformed,
  };
}

/**
 * Step 1: the payloads `{{SUMMARIES_JSON}}` carries, in `memberKeys`' order.
 * A member whose findings `docs/06` §12.1 L3 keeps out (`withholdsFindings`)
 * is sent with `keyFindings` and `effectSizes` empty.
 *
 * @param memberKeys - the call's members
 * @param byKey - the stored summaries, by `content.itemKey`
 */
export function summariesForReduce(
  memberKeys: readonly string[],
  byKey: ReadonlyMap<string, StoredSummary>,
): readonly PaperSummary[] {
  return memberKeys.map((key) => {
    const stored = byKey.get(key);
    if (stored === undefined) {
      throw new RangeError(
        `[research-helper] theme member ${key} has no stored summary`,
      );
    }
    return withholdsFindings(stored)
      ? { ...stored.content, keyFindings: [], effectSizes: [] }
      : stored.content;
  });
}

/**
 * What a JSON array of values costs as sent: `estTokens`, raw (no model id,
 * no calibration), over the compact JSON after `escapeSourceText` — how
 * `P4-T05` measures the digests, against `docs/06` §5.2's input budget.
 *
 * @param values - the array's members
 */
export function jsonArrayTokens(values: readonly unknown[]): number {
  return estTokens(escapeSourceText(JSON.stringify(values)));
}

/** One member's own cost inside a packed array: its JSON, escaped. */
function memberOwnTokens(value: unknown): number {
  return estTokens(escapeSourceText(JSON.stringify(value)));
}

/**
 * Step 2's packing: the payloads in the fewest `CLUSTER_REDUCE` calls within
 * its input budget, order kept, evened — `packThemeMembers`
 * (`src/pipeline/shared/estimate.ts`), the one packing rule, which
 * `planSynthesis` also counts with (owner, `plan/00` §6 item 309(b)): each
 * member its own escaped JSON plus one token for the separator, within the
 * budget less one for the brackets, so a batch's sum is never below
 * {@link jsonArrayTokens} of the batch.
 *
 * @param payloads - one theme's {@link summariesForReduce}
 * @param inputBudget - {@link ThemeAnalysisInput.inputBudget}; the row by default
 * @returns the sub-batches; one batch when the theme fits one call
 * @throws RangeError when one summary alone exceeds the budget
 */
export function packThemeSummaries(
  payloads: readonly PaperSummary[],
  inputBudget?: number,
): readonly (readonly PaperSummary[])[] {
  return packThemeMembers(payloads, memberOwnTokens, inputBudget);
}

/**
 * Whether one summary alone cannot go in a `CLUSTER_REDUCE` call on this budget
 * (packing would refuse it). Only a small context window makes this happen; the
 * theme is then `theme_too_large`, one theme's failure (owner, `plan/00` §6 item
 * 327(b)), not a packing defect.
 */
function memberOverBudget(
  payloads: readonly PaperSummary[],
  inputBudget: number,
): boolean {
  return payloads.some((p) => memberOwnTokens(p) + 1 > inputBudget - 1);
}

/** A budget, or a RangeError: a whole number from 1 to its §5.2 row. */
function checkedBudget(budget: number, row: number): number {
  if (!Number.isInteger(budget) || budget < 1 || budget > row) {
    throw new RangeError(
      `[research-helper] a theme analysis input budget is a whole number from 1 to ${String(row)}, got ${String(budget)}`,
    );
  }
  return budget;
}

/**
 * The most partial analyses one `CLUSTER_REDUCE_MERGE` call is sure to carry.
 * Declared in `src/pipeline/shared/estimate.ts` since 2026-10-29, so
 * `planSynthesis` can count with it without an import cycle (owner,
 * `plan/00` §6 item 309(b)); re-exported here, where `P4-T07` declared it.
 */
export { maxPartialsPerMerge };

/** Sum one `Usage` field; `undefined` if any usage lacked it. */
function sumField(
  usages: readonly Usage[],
  field: keyof Usage,
): number | undefined {
  let total = 0;
  for (const usage of usages) {
    const value = usage[field];
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

function sumUsage(usages: readonly Usage[]): Usage {
  return {
    inputTokens: sumField(usages, "inputTokens"),
    outputTokens: sumField(usages, "outputTokens"),
    totalTokens: sumField(usages, "totalTokens"),
    costUsd: sumField(usages, "costUsd"),
  };
}

/**
 * Whether an error ends the whole stage rather than one theme: a cancel, a
 * budget refusal (it pauses the job with the stage pending, `plan/07` §0.2
 * items 12 and 18), a rejected key, a configuration or privacy error — each
 * would fail every theme — and anything that is not a `ResearchHelperError`,
 * which only a defect throws.
 */
function endsStage(error: unknown, token: CancellationToken): boolean {
  if (token.isCancellationRequested) return true;
  if (error instanceof ThemeFailure) return false;
  if (!(error instanceof ResearchHelperError)) return true;
  return (
    error instanceof OperationCancelledError ||
    error instanceof BudgetExceededError ||
    error instanceof AuthenticationError ||
    error instanceof ConfigurationError ||
    error instanceof PolicyViolationError ||
    error instanceof PrivacyRoutingError
  );
}

/** A theme that cannot be analysed for a reason of this module's. */
class ThemeFailure extends Error {
  constructor(readonly reason: string) {
    super(`theme not analysed: ${reason}`);
    this.name = "ThemeFailure";
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof ThemeFailure) return error.reason;
  if (error instanceof ResearchHelperError) return error.code;
  return error instanceof Error ? error.name : typeof error;
}

// ---------------------------------------------------------------------------
// 4. Input checks
// ---------------------------------------------------------------------------

function checkPrompt(prompt: PromptTemplate, id: PromptTemplate["id"]): void {
  if (prompt.id !== id || prompt.schema === null) {
    throw new ConfigurationError(
      `analyseThemes needs the ${id} template with its schema`,
      { promptId: prompt.id },
    );
  }
}

/** The summaries by `content.itemKey`, checked: item keys, each once. */
function summariesByKey(
  summaries: readonly StoredSummary[],
): ReadonlyMap<string, StoredSummary> {
  const byKey = new Map<string, StoredSummary>();
  for (const stored of summaries) {
    const key = stored.content.itemKey;
    if (!ITEM_KEY_RE.test(key)) {
      throw new RangeError(
        `[research-helper] a summary's itemKey must be a Zotero item key, not ${JSON.stringify(key)}`,
      );
    }
    if (byKey.has(key)) {
      throw new RangeError(
        `[research-helper] two summaries for item ${key}: pass one per paper`,
      );
    }
    byKey.set(key, stored);
  }
  return byKey;
}

/** Theme ids unique; every theme's members unique item keys with a summary. */
function checkThemes(
  themes: readonly ClusteredTheme[],
  byKey: ReadonlyMap<string, StoredSummary>,
): void {
  const ids = new Set<string>();
  for (const theme of themes) {
    if (ids.has(theme.themeId)) {
      throw new RangeError(
        `[research-helper] theme id ${theme.themeId} appears twice`,
      );
    }
    ids.add(theme.themeId);
    if (theme.itemKeys.length === 0) {
      throw new RangeError(
        `[research-helper] theme ${theme.themeId} has no member`,
      );
    }
    if (new Set(theme.itemKeys).size !== theme.itemKeys.length) {
      throw new RangeError(
        `[research-helper] theme ${theme.themeId} lists a member twice`,
      );
    }
    for (const key of theme.itemKeys) {
      if (!byKey.has(key)) {
        throw new RangeError(
          `[research-helper] theme member ${key} has no stored summary`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. The stage
// ---------------------------------------------------------------------------

/** Counters shared by every request of one theme. */
interface ThemeCounters {
  requests: number;
  calls: number;
  readonly usages: Usage[];
  levels: Set<number>;
}

/**
 * Analyse every theme of `input.clustering` (`plan/07` `P4-T07`).
 *
 * @param input - see {@link ThemeAnalysisInput}
 * @param deps - see {@link ThemeAnalysisDeps}
 * @returns one result per theme, in the clustering's order, with the passes,
 *   counts, usage and prompts of the stage: `analysed` when at least one
 *   theme was, else the stop `stopped-no-theme-analysed` (owner, `plan/00`
 *   §6 item 309(g))
 * @throws RangeError for a duplicate theme id, a member without a stored
 *   summary, a repeated or malformed summary key — before any request;
 *   ConfigurationError for a template that is not the expected prompt with
 *   its schema; and, once every theme has settled, the first stage-ending
 *   error (cancel, budget refusal, rejected key, configuration or privacy
 *   error, or a defect) unchanged
 */
export async function analyseThemes(
  input: ThemeAnalysisInput,
  deps: ThemeAnalysisDeps,
): Promise<ThemeAnalysisOutcome> {
  checkPrompt(deps.reducePrompt, "CLUSTER_REDUCE");
  checkPrompt(deps.mergePrompt, "CLUSTER_REDUCE_MERGE");
  const reduceBudget = checkedBudget(
    input.inputBudget ?? SYNTHESIS_INPUT_BUDGETS.CLUSTER_REDUCE,
    SYNTHESIS_INPUT_BUDGETS.CLUSTER_REDUCE,
  );
  const mergeBudget = checkedBudget(
    input.mergeInputBudget ?? SYNTHESIS_INPUT_BUDGETS.CLUSTER_REDUCE_MERGE,
    SYNTHESIS_INPUT_BUDGETS.CLUSTER_REDUCE_MERGE,
  );
  const byKey = summariesByKey(input.summaries);
  const themes = input.clustering.themes;
  checkThemes(themes, byKey);
  if (themes.length === 0) {
    // Cannot come from a `clustered` outcome (docs/12 §8 step 7 stops first).
    return {
      status: "analysed",
      themes: [],
      passes: 0,
      requests: 0,
      calls: 0,
      usage: sumUsage([]),
      prompts: [],
    };
  }

  deps.token.throwIfCancelled();
  const model = deps.llm.resolveModel("strong");
  const mergeLimit = maxPartialsPerMerge(deps.reducePrompt, mergeBudget);
  let mergeSent = false;

  /** One `completeJSON` request under one pool permit, counted for its theme. */
  const send = async (
    counters: ThemeCounters,
    level: number,
    prompt: PromptTemplate,
    vars: Readonly<Record<string, string>>,
    trace: string,
  ): Promise<ThemeAnalysis> => {
    deps.token.throwIfCancelled();
    const rendered = renderPrompt(prompt, vars);
    const schema = prompt.schema as object;
    counters.requests += 1;
    counters.levels.add(level);
    const request: StructuredRequest = {
      model: model.modelId,
      messages: [
        { role: "system", content: rendered.system },
        { role: "user", content: rendered.user },
      ],
      temperature: prompt.defaultTemperature,
      maxOutputTokens: resolveMaxTokens(prompt),
      effort: THEME_ANALYSIS_EFFORT,
      responseFormat: {
        kind: "json_schema",
        name: THEME_ANALYSIS_SCHEMA_NAME,
        schema,
      },
      ...(deps.routing !== undefined && { routing: deps.routing }),
      traceId: `${deps.traceId ?? "cluster-reduce"}:${trace}:request-${String(counters.requests)}`,
    };
    const counted: JsonChatTarget = {
      activeProvider: () => deps.llm.activeProvider(),
      chat: async (
        sent: ChatRequest,
        ctx: LLMCallContext,
      ): Promise<ChatResponse> => {
        counters.calls += 1;
        const answer = await deps.llm.chat(sent, ctx);
        counters.usages.push(answer.usage);
        return answer;
      },
    };
    const release = await deps.pool.acquire(deps.token);
    try {
      const done = await completeJSON<ThemeAnalysis>(
        counted,
        request,
        { token: deps.token, budget: deps.budget },
        { includeBodies: deps.includeBodies ?? false },
      );
      return done.value;
    } finally {
      release();
    }
  };

  /**
   * One call with step 3: the answer, one retry on a foreign key, then the
   * removal. The echoed `themeId` and `name` are replaced with the theme's.
   */
  const call = async (
    theme: ClusteredTheme,
    counters: ThemeCounters,
    level: number,
    prompt: PromptTemplate,
    vars: Readonly<Record<string, string>>,
    allowed: ReadonlySet<string>,
    trace: string,
  ): Promise<{
    readonly analysis: ThemeAnalysis;
    readonly removal: KeyRemoval | undefined;
    readonly echoCorrected: boolean;
  }> => {
    let answer = await send(counters, level, prompt, vars, trace);
    let problems = citedKeyProblems(answer, allowed);
    if (hasKeyProblems(problems)) {
      deps.logger?.warn(
        "theme analysis: the answer cited keys outside its set; asked once more",
        {
          themeId: theme.themeId,
          part: trace,
          foreign: problems.foreignKeys.length,
          malformed: problems.malformed,
        },
      );
      answer = await send(counters, level, prompt, vars, trace);
      problems = citedKeyProblems(answer, allowed);
    }
    let removal: KeyRemoval | undefined;
    if (hasKeyProblems(problems)) {
      removal = removeForeignKeys(answer, allowed);
      deps.logger?.warn("theme analysis: keys outside its set removed", {
        themeId: theme.themeId,
        part: trace,
        removed: removal.removedKeys.length,
        malformed: removal.removedMalformed,
      });
      answer = removal.analysis;
      if (answer.representativePapers.length === 0) {
        throw new ThemeFailure(UNANALYSED_REASONS.noRepresentativePapers);
      }
    }
    const echoCorrected =
      answer.themeId !== theme.themeId || answer.name !== theme.name;
    return {
      analysis: { ...answer, themeId: theme.themeId, name: theme.name },
      removal,
      echoCorrected,
    };
  };

  /** One theme: one call, or sub-batches and their merge. Throws only a stage-ending error. */
  const analyseOne = async (theme: ClusteredTheme): Promise<ThemeResult> => {
    const counters: ThemeCounters = {
      requests: 0,
      calls: 0,
      usages: [],
      levels: new Set(),
    };
    const themeVars = {
      THEME_ID: theme.themeId,
      THEME_NAME: oneLine(theme.name),
      THEME_DEFINITION: oneLine(theme.definition),
      USER_TOPIC: input.userTopic,
    };
    let subBatches = 0;
    const result = (status: "unanalysed", reason: string): UnanalysedTheme => ({
      status,
      reason,
      themeId: theme.themeId,
      passes: counters.levels.size,
      subBatches,
      requests: counters.requests,
      calls: counters.calls,
    });
    const usageSink = (): void => {
      allUsages.push(...counters.usages);
      totals.requests += counters.requests;
      totals.calls += counters.calls;
    };
    /** Hand a validated theme back at once (item 322(e)); never throws. */
    const handBack = async (done: AnalysedTheme): Promise<AnalysedTheme> => {
      try {
        await deps.onThemeAnalysed?.(done);
      } catch {
        // The caller's keeping failed; the stage's result is unchanged.
      }
      return done;
    };

    try {
      const payloads = summariesForReduce(theme.itemKeys, byKey);
      if (memberOverBudget(payloads, reduceBudget)) {
        deps.logger?.warn(
          "theme analysis: one summary alone is over the input budget; the theme is not analysed",
          {
            themeId: theme.themeId,
            members: theme.itemKeys.length,
            inputBudget: reduceBudget,
          },
        );
        return result("unanalysed", UNANALYSED_REASONS.tooLarge);
      }
      const batches = packThemeSummaries(payloads, reduceBudget);
      subBatches = batches.length;
      // One batch needs no merge, however small the merge's budget.
      if (batches.length > 1 && batches.length > mergeLimit) {
        deps.logger?.warn(
          "theme analysis: more sub-batches than one merge can take; the theme is not analysed",
          {
            themeId: theme.themeId,
            members: theme.itemKeys.length,
            subBatches: batches.length,
            mergeLimit,
          },
        );
        return result("unanalysed", UNANALYSED_REASONS.tooLarge);
      }

      const reduceVars = (
        batch: readonly PaperSummary[],
      ): Record<string, string> => ({
        ...themeVars,
        N_PAPERS: String(batch.length),
        SUMMARIES_JSON: JSON.stringify(batch),
      });
      const fits = (vars: Readonly<Record<string, string>>, key: string) => {
        const tokens = estTokens(escapeSourceText(vars[key] ?? ""));
        if (tokens > reduceBudget) {
          throw new RangeError(
            `[research-helper] ${key} measured ${String(tokens)} tokens, over its budget: a packing defect`,
          );
        }
      };

      if (batches.length === 1) {
        const batch = batches[0] as readonly PaperSummary[];
        const vars = reduceVars(batch);
        fits(vars, "SUMMARIES_JSON");
        const done = await call(
          theme,
          counters,
          1,
          deps.reducePrompt,
          vars,
          new Set(theme.itemKeys),
          `${theme.themeId}:all`,
        );
        return await handBack(
          analysed(theme, counters, subBatches, done, [done]),
        );
      }

      // Sub-batches in parallel; a theme with a failed sub-batch is not merged.
      const settled = await Promise.allSettled(
        batches.map((batch, index) => {
          const vars = reduceVars(batch);
          fits(vars, "SUMMARIES_JSON");
          return call(
            theme,
            counters,
            1,
            deps.reducePrompt,
            vars,
            new Set(batch.map((summary) => summary.itemKey)),
            `${theme.themeId}:b${String(index + 1)}`,
          );
        }),
      );
      const rejected = settled.filter(
        (s): s is PromiseRejectedResult => s.status === "rejected",
      );
      const ending = rejected.find((s) => endsStage(s.reason, deps.token));
      if (ending !== undefined) throw ending.reason;
      if (rejected[0] !== undefined) throw rejected[0].reason;
      const partials = settled.map(
        (s) =>
          (
            s as PromiseFulfilledResult<{
              readonly analysis: ThemeAnalysis;
              readonly removal: KeyRemoval | undefined;
              readonly echoCorrected: boolean;
            }>
          ).value,
      );

      const partialAnalyses = partials.map((p) => p.analysis);
      const partialTokens = jsonArrayTokens(partialAnalyses);
      if (partialTokens > mergeBudget) {
        deps.logger?.warn(
          "theme analysis: the partial analyses do not fit one merge; the theme is not analysed",
          { themeId: theme.themeId, partials: partials.length, partialTokens },
        );
        return result("unanalysed", UNANALYSED_REASONS.mergeInputOverBudget);
      }
      const members = new Set(theme.itemKeys);
      const carried = new Set(
        partialAnalyses
          .flatMap((p) => citedKeysOfAnalysis(p))
          .filter((key) => members.has(key)),
      );
      mergeSent = true;
      const merged = await call(
        theme,
        counters,
        2,
        deps.mergePrompt,
        {
          ...themeVars,
          N_PAPERS: String(theme.itemKeys.length),
          N_PARTIALS: String(partials.length),
          PARTIAL_ANALYSES_JSON: JSON.stringify(partialAnalyses),
        },
        carried,
        `${theme.themeId}:merge`,
      );
      return await handBack(
        analysed(theme, counters, subBatches, merged, [...partials, merged]),
      );
    } catch (error) {
      if (endsStage(error, deps.token)) throw error;
      deps.logger?.warn("theme analysis: the theme is not analysed", {
        themeId: theme.themeId,
        reason: reasonOf(error),
      });
      return result("unanalysed", reasonOf(error));
    } finally {
      usageSink();
    }
  };

  const allUsages: Usage[] = [];
  const totals = { requests: 0, calls: 0 };
  const settled = await Promise.allSettled(themes.map(analyseOne));
  const failure = settled.find(
    (s): s is PromiseRejectedResult => s.status === "rejected",
  );
  if (failure !== undefined) throw failure.reason;
  const results = settled.map(
    (s) => (s as PromiseFulfilledResult<ThemeResult>).value,
  );

  const promptUse = (prompt: PromptTemplate): TrendPromptUse => ({
    promptId: prompt.id as TrendPromptUse["promptId"],
    promptVersion: prompt.version,
    modelId: model.modelId,
    temperature: prompt.defaultTemperature,
  });
  const outcome: ThemeAnalysisOutcomeBase = {
    themes: results,
    passes: Math.max(0, ...results.map((r) => r.passes)),
    requests: totals.requests,
    calls: totals.calls,
    usage: sumUsage(allUsages),
    prompts: [
      promptUse(deps.reducePrompt),
      ...(mergeSent ? [promptUse(deps.mergePrompt)] : []),
    ],
  };
  // Owner, plan/00 §6 item 309(g): no theme analysed is a stop; nothing is
  // removed, so the summaries and cached stage results stay as they are.
  if (results.every((result) => result.status === "unanalysed")) {
    deps.logger?.warn(
      "theme analysis: no theme could be analysed; the run stops",
      {
        themes: results.length,
        reasons: results.map((result) =>
          result.status === "unanalysed" ? result.reason : "",
        ),
      },
    );
    return {
      ...outcome,
      status: "stopped-no-theme-analysed",
      messageId: NO_THEME_ANALYSED_L10N,
    };
  }
  return { ...outcome, status: "analysed" };
}

/** An analysed theme's result, from its final call and every call it made. */
function analysed(
  theme: ClusteredTheme,
  counters: ThemeCounters,
  subBatches: number,
  final: {
    readonly analysis: ThemeAnalysis;
    readonly removal: KeyRemoval | undefined;
  },
  all: readonly {
    readonly removal: KeyRemoval | undefined;
    readonly echoCorrected: boolean;
  }[],
): AnalysedTheme {
  const removals = all.flatMap((c) =>
    c.removal === undefined ? [] : [c.removal],
  );
  const warnings = [
    ...(removals.length > 0 ? [KEYS_REMOVED_WARNING] : []),
    ...(all.some((c) => c.echoCorrected) ? [ECHO_CORRECTED_WARNING] : []),
  ];
  return {
    status: "analysed",
    themeId: theme.themeId,
    analysis: final.analysis,
    passes: counters.levels.size,
    subBatches,
    requests: counters.requests,
    calls: counters.calls,
    removedKeys: removals.flatMap((r) => r.removedKeys),
    removedMalformed: removals.reduce((n, r) => n + r.removedMalformed, 0),
    warnings,
  };
}
