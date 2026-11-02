/**
 * Theme clustering with client-side validation (`P4-T05`; `docs/12` §8,
 * `docs/06` §8.2–§8.4, §9.2): N digests become a validated
 * {@link ThemeClustering} in which every analysed paper appears exactly once,
 * from one `THEME_CLUSTER` call when the digests fit, else from `docs/06`
 * §8.4's two stages (`P4-T06`).
 *
 * **Callers.** Nothing calls this module yet. The report run
 * (`trendReportPipeline.ts`, `P4-T18`) calls {@link clusterThemes} at its
 * cluster stage, with the digests it built (`toDigest`, `P4-T04`), the strong
 * model's `ModelInfo.maxOutputTokens` it also gives `planSynthesis` (`P4-T16`),
 * its context's budgeted router, budget and token, the active `THEME_CLUSTER`
 * and `THEME_MERGE` templates, and the `llm` pool (`WorkerPools`, `P3-T17`).
 * {@link clusterThemes} hands over to {@link clusterThemesTwoStage} itself;
 * nothing else calls that. Nothing is constructed: every export is a
 * function or a constant.
 *
 * ## Two stages (`plan/07` `P4-T06`; `docs/12` §20 and `docs/06` §8.4's notes
 * of 2026-10-29)
 *
 * {@link presortDigests} and {@link partitionDigests} make ⌈N / B⌉ balanced
 * batches (`clusterBatchSize`, shared with the estimate); one `THEME_CLUSTER`
 * call per batch under the `llm` pool, validated as above; one `THEME_MERGE`
 * call over the batch-local themes' names, definitions and paper counts
 * ({@link mergeProblems}); then re-assignment in code and the same
 * `finalizeClustering`, so the result has the one-stage shape. A pass per
 * batch call and one for the merge. Never a third stage. A batch answer over
 * its own band's `MAX_THEMES` after its one re-run is not a stop: its local
 * themes go to the merge, whose answer is checked against the run's
 * `MAX_THEMES`; and the merge input (`{{LOCAL_THEMES}}`, as rendered) is
 * measured against `THEME_MERGE`'s 60 000-token budget first, the stage
 * ending with {@link MERGE_TOO_LARGE_L10N} when it is over (owner, `plan/00`
 * §6 item 309(e)).
 *
 * ## What one stage does (`plan/07` `P4-T05` steps 1–6)
 *
 * 1. {@link clusteringPath}: one call when the joined digests fit `docs/06`
 *    §5.2's 60 000-token input budget **and** the prompt's grown output
 *    ceiling (`resolveMaxTokens`) fits the model's output limit; otherwise
 *    `docs/06` §8.4's two stages. Never a paper count.
 * 2. One `completeJSON` request on `resolveModel("strong")`, at the prompt's
 *    temperature (0.2) and effort `medium` (`plan/07` §0.2), through the
 *    budgeted router with `budget` on every request.
 * 3. {@link clusteringProblems}: any miss sends the same request once more,
 *    and that answer is final; {@link finalizeClustering} puts what is still
 *    not placed into a client-generated `Other` theme.
 * 4. A theme below `MIN_PAPERS_PER_THEME` (`Other` included) is dropped and
 *    its papers move to `unclustered` (owner, `plan/00` §6 item 286).
 * 5. One pass for the stage (FR-27); the run's counter is `P4-T18`'s.
 * 6. An answer with more themes than `MAX_THEMES` is asked for once more; a
 *    second answer over it ends the stage with a message and no further call
 *    (owner, `plan/00` §6 item 292(d)).
 * 7. When step 4 leaves no theme at all, the stage ends with a message and no
 *    further call, before anything is written (owner, `plan/00` §6 item
 *    307(c)).
 *
 * The readings these steps leave open are `docs/12` §8's note of 2026-10-29.
 * Steps 3 and 6 share one re-run ({@link CLUSTER_REQUESTS_MAX}), as built and
 * decided by the owner (`plan/00` §6 item 307(a)); see that note.
 *
 * **Model output is untrusted.** `completeJSON` validates the answer against
 * `theme-clustering.v1.json`; this module then checks every key against the
 * run's input keys and every theme id against the answer's own themes, and
 * builds the result from what passed — never from a field it did not check.
 */

import type { ThemeBandKeyInput } from "../../core/cache/keys";
import { ConfigurationError } from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { LlmPool } from "../../core/jobQueue/queue";
import type { Logger } from "../../core/logger";
import type { MainWindowMessageId } from "../../i18n/keys";
import {
  completeJSON,
  type StructuredRequest,
} from "../../llm/shared/jsonMode";
import type {
  BudgetGuard,
  Effort,
  LLMRouter,
  ProviderRoutingHints,
  Usage,
} from "../../llm/types";
import type {
  ClusteredTheme,
  Digest,
  ThemeAssignment,
  ThemeClustering,
  ThemeMerge,
  TrendPromptUse,
  UnclusteredItem,
} from "../../model/trend";
import {
  renderPrompt,
  resolveMaxTokens,
  type PromptTemplate,
} from "../../prompts";
import {
  clusterBatchSize,
  SYNTHESIS_INPUT_BUDGETS,
  themeCountBandFor,
} from "../shared/estimate";
import { ITEM_KEY_RE } from "./citations";
import { DIGEST_NO_YEAR, digestText, digestTokens } from "./digest";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** `plan/07` §0.2 (owner, `plan/00` §6 item 286): every strong-tier synthesis call. */
export const THEME_CLUSTER_EFFORT: Effort = "medium";

/** The `json_schema` name sent with the schema: the schema's own `title`. */
export const THEME_CLUSTER_SCHEMA_NAME = "ThemeClustering";

/**
 * `THEME_CLUSTER` requests one stage may send, `completeJSON`'s repair and
 * retry aside: the answer, and one re-run shared by step 3's miss and step 6's
 * theme count. Decided as built (owner, `plan/00` §6 item 307(a); `docs/12`
 * §8's note of 2026-10-29); the alternative not taken was one re-run per
 * defect, which would have made this 3.
 */
export const CLUSTER_REQUESTS_MAX = 2;

/** `docs/12` §8's `{{MIN_PAPERS_PER_THEME}}`: "Default 2, or 3 for N > 100". */
export const MIN_PAPERS_PER_THEME_DEFAULT = 2;
/** See {@link MIN_PAPERS_PER_THEME_DEFAULT}. */
export const MIN_PAPERS_PER_THEME_LARGE = 3;
/** The corpus size above which {@link MIN_PAPERS_PER_THEME_LARGE} applies. */
export const MIN_PAPERS_PER_THEME_LARGE_ABOVE = 100;

/** `docs/12` §8: "a client-generated `Other` theme". */
export const OTHER_THEME_NAME = "Other";

/** The `Other` theme's one-sentence definition (the type requires one). */
export const OTHER_THEME_DEFINITION =
  "Papers the clustering did not place in any theme.";

/** The `unclustered` reason of a paper whose theme was too small. */
export const SMALL_THEME_REASON =
  "Its theme had fewer papers than the minimum per theme and was dropped.";

/**
 * Two stages: the `unclustered` reason of a paper whose batch-local theme the
 * merge mapped to `null`, or left unmapped (`docs/12` §20).
 */
export const UNMAPPED_THEME_REASON =
  "Its batch's theme matched no theme of the whole collection.";

/** `plan/07` §0.2 (owner, `plan/00` §6 items 286, 290(a)): `THEME_MERGE`'s effort. */
export const THEME_MERGE_EFFORT: Effort = "medium";

/** The `json_schema` name sent with `THEME_MERGE`'s schema: its `title`. */
export const THEME_MERGE_SCHEMA_NAME = "ThemeMerge";

/**
 * Step 6's stop message (owner, `plan/00` §6 item 292(d)); `$themes` is the
 * second answer's theme count and `$max` is `MAX_THEMES`. On `KO_PRESENT`
 * since the owner reviewed its Korean (`G-41`, `plan/00` §6 item 307(f)).
 */
export const TOO_MANY_THEMES_L10N =
  "research-helper-report-stopped-too-many-themes" as const satisfies MainWindowMessageId;

/**
 * Step 7's stop message: every theme fell below `MIN_PAPERS_PER_THEME` and none
 * remains (owner, `plan/00` §6 item 307(c)). No argument. On `KO_PRESENT`
 * since the owner reviewed its Korean (`G-41`, `plan/00` §6 item 309(a)).
 */
export const NO_THEMES_L10N =
  "research-helper-report-stopped-no-themes" as const satisfies MainWindowMessageId;

/**
 * Two stages' stop when the merge input, `{{LOCAL_THEMES}}` as rendered, is
 * over `THEME_MERGE`'s input budget (owner, `plan/00` §6 item 309(e)). No
 * argument. On `KO_PRESENT` since the owner reviewed its Korean (`G-41`,
 * `plan/00` §6 item 310(a)).
 */
export const MERGE_TOO_LARGE_L10N =
  "research-helper-report-stopped-merge-too-large" as const satisfies MainWindowMessageId;

// ---------------------------------------------------------------------------
// 2. Types
// ---------------------------------------------------------------------------

/** What {@link clusterThemes} needs from the job — its context, in pieces. */
export interface ClusterDeps {
  /** `PipelineContext.llm`: the budgeted router (`withBudget`). */
  readonly llm: Pick<LLMRouter, "activeProvider" | "resolveModel" | "chat">;
  /** `PipelineContext.budget`, passed on **every** request (`plan/07` §0.2 item 11). */
  readonly budget: BudgetGuard;
  readonly token: CancellationToken;
  /** The active `THEME_CLUSTER` template. */
  readonly prompt: PromptTemplate;
  /** The active `THEME_MERGE` template; read only by two stages. */
  readonly mergePrompt: PromptTemplate;
  /**
   * The `llm` pool (`WorkerPools.llm`, `P3-T17`): every two-stage request
   * holds a permit while it runs (`plan/07` `P4-T06` step 3).
   */
  readonly pool: Pick<LlmPool, "acquire">;
  /** The privacy mode's routing hints (`routingHints`), when the run has them. */
  readonly routing?: ProviderRoutingHints;
  /** The `logRequestBodies` preference, for `completeJSON`'s error context. */
  readonly includeBodies?: boolean;
  readonly logger?: Logger;
  /** Prefix of each request's `traceId`. */
  readonly traceId?: string;
}

/** What one clustering stage is given. */
export interface ClusterInput {
  /** One per analysed paper, in the order `{{DIGESTS}}` lists them; keys unique. */
  readonly digests: readonly Digest[];
  /** `{{USER_TOPIC}}`: the collection's topic. Untrusted. */
  readonly userTopic: string;
  /** `{{YEAR_MIN}}`; `undefined` when no analysed item has a year. */
  readonly yearMin: number | undefined;
  /** `{{YEAR_MAX}}`; `undefined` when no analysed item has a year. */
  readonly yearMax: number | undefined;
  /**
   * The strong model's output limit (`ModelInfo.maxOutputTokens`): the same
   * number `planSynthesis` is given, so the run and its estimate choose the
   * same path.
   */
  readonly outputLimit: number;
  /**
   * The theme band; absent: {@link themeBandFor} the paper count. In two
   * stages it is the merge's and the final minimum's; each batch call uses
   * {@link themeBandFor} its own size.
   */
  readonly band?: ThemeBandKeyInput;
  /**
   * The clustering input budget: `docs/06` §5.2's 60 000 when absent. A
   * smaller whole number forces two stages for one run (`plan/07` `P4-T06`'s
   * Done-when, `P4-T22`'s simulated window); it is never raised above 60 000.
   * The report run passes `synthesisBudgets`' `clusterSingle`, so the model's
   * context window can force two stages (owner, `plan/00` §6 item 327(a)).
   */
  readonly inputBudget?: number;
  /**
   * One two-stage batch's budget, measured at a batch's own ceiling, so it is
   * never below {@link ClusterInput.inputBudget} in a report run; that budget
   * when absent. `synthesisBudgets`' `clusterBatch`.
   */
  readonly batchInputBudget?: number;
  /**
   * `{{LOCAL_THEMES}}`'s budget: `docs/06` §5.2's 60 000 when absent.
   * `synthesisBudgets`' `clusterMerge`.
   */
  readonly mergeInputBudget?: number;
}

/** Step 1's choice and the two measurements it rests on. */
export interface ClusteringPathChoice {
  readonly path: "single-stage" | "two-stage";
  /** `digestTokens` of the joined `{{DIGESTS}}`. */
  readonly digestTokens: number;
  /** `resolveMaxTokens(prompt, N)`. */
  readonly outputCeiling: number;
  readonly inputFits: boolean;
  readonly outputFits: boolean;
}

/** What the stage reports beside its result. */
interface ClusterOutcomeBase {
  readonly band: ThemeBandKeyInput;
  /**
   * Reduction passes (FR-27): 1 for the single-stage call; in two stages, one
   * per batch that sent a request and one for the merge call when made.
   */
  readonly passes: number;
  /**
   * `THEME_CLUSTER` and `THEME_MERGE` requests sent, re-runs included; at
   * most {@link CLUSTER_REQUESTS_MAX} per call.
   */
  readonly requests: number;
  /** Every chat request made, `completeJSON`'s repairs and retries included. */
  readonly calls: number;
  /** Summed over {@link calls}; a field is `undefined` if any answer lacked it. */
  readonly usage: Usage;
  /** The prompt, its version, the model and the temperature the stage ran on. */
  readonly prompt: TrendPromptUse;
  /** Two stages only: the number of batches (`docs/06` §8.4 step 1). */
  readonly batches?: number;
  /** Two stages only, once the merge call was made: `THEME_MERGE`'s use. */
  readonly mergePrompt?: TrendPromptUse;
}

/** A validated theme assignment. */
export interface ClusteredOutcome extends ClusterOutcomeBase {
  readonly status: "clustered";
  readonly clustering: ThemeClustering;
  /** The `Other` theme's id when leftovers made one that survived step 4. */
  readonly otherThemeId: string | undefined;
  /** Themes dropped below `MIN_PAPERS_PER_THEME`, `Other` included. */
  readonly droppedThemeIds: readonly string[];
}

/** Step 6: the second answer still had more than `MAX_THEMES` themes. */
export interface TooManyThemesOutcome extends ClusterOutcomeBase {
  readonly status: "stopped-too-many-themes";
  readonly messageId: typeof TOO_MANY_THEMES_L10N;
  readonly args: { readonly themes: number; readonly max: number };
}

/**
 * Step 7: step 4 dropped every theme, `Other` included, so none remains. The
 * run stops before anything is written; the summaries are kept (owner,
 * `plan/00` §6 item 307(c)). `P4-T18` ends the job on it.
 */
export interface NoThemesOutcome extends ClusterOutcomeBase {
  readonly status: "stopped-no-themes";
  readonly messageId: typeof NO_THEMES_L10N;
  /** Every theme step 4 dropped, `Other` included, in the answer's order. */
  readonly droppedThemeIds: readonly string[];
}

/**
 * Two stages only: the batches' local themes, as `{{LOCAL_THEMES}}` renders
 * them, measured over `THEME_MERGE`'s input budget, so no merge request was
 * sent. The run stops before anything is written; the summaries are kept
 * (owner, `plan/00` §6 item 309(e)). `P4-T18` ends the job on it.
 */
export interface MergeOverBudgetOutcome extends ClusterOutcomeBase {
  readonly status: "stopped-merge-over-budget";
  readonly messageId: typeof MERGE_TOO_LARGE_L10N;
  /** The local themes the batches kept. */
  readonly localThemes: number;
  /** `digestTokens` of `{{LOCAL_THEMES}}`. */
  readonly mergeInputTokens: number;
  /** The budget it was measured against: `THEME_MERGE`'s 60 000. */
  readonly mergeInputBudget: number;
}

export type ClusterOutcome =
  | ClusteredOutcome
  | TooManyThemesOutcome
  | NoThemesOutcome
  | MergeOverBudgetOutcome;

/** What {@link clusteringProblems} found in one answer. */
export interface ClusteringProblems {
  /** Input keys in neither `assignments` nor `unclustered`, in input order. */
  readonly missingKeys: readonly string[];
  /** Input keys placed more than once, in input order. */
  readonly repeatedKeys: readonly string[];
  /** Entries naming a key that is not an input key. */
  readonly foreignKeyEntries: number;
  /** `primaryThemeId` / `secondaryThemeIds` values naming no (single) theme. */
  readonly unresolvedThemeRefs: number;
  /** `themeId`s two or more themes share. */
  readonly duplicateThemeIds: readonly string[];
}

/** What {@link mergeProblems} found in one `THEME_MERGE` answer (`docs/12` §20). */
export interface MergeProblems {
  /** Local theme ids given and absent from `mapping`, in the order given. */
  readonly missingLocalIds: readonly string[];
  /** Local theme ids given and in `mapping` more than once, in the order given. */
  readonly repeatedLocalIds: readonly string[];
  /** `mapping` rows naming a local theme id that was not given. */
  readonly foreignLocalIds: number;
  /** `mapping` rows whose non-null `globalThemeId` names no (single) theme. */
  readonly unresolvedGlobalRefs: number;
  /** `themeId`s two or more global themes share. */
  readonly duplicateThemeIds: readonly string[];
}

// ---------------------------------------------------------------------------
// 3. Pure helpers
// ---------------------------------------------------------------------------

/**
 * `docs/12` §8's `{{MIN_PAPERS_PER_THEME}}`: 2, or 3 for more than 100 papers.
 *
 * @param papers - the papers clustered
 */
export function minPapersPerThemeFor(papers: number): number {
  return papers > MIN_PAPERS_PER_THEME_LARGE_ABOVE
    ? MIN_PAPERS_PER_THEME_LARGE
    : MIN_PAPERS_PER_THEME_DEFAULT;
}

/**
 * The theme band for `papers`: `docs/06` §9.2's row (`themeCountBandFor`,
 * shared with the estimate) and {@link minPapersPerThemeFor}. The shape is
 * `docs/07`'s `ThemeBandKeyInput`, which the `tc` cache key carries.
 *
 * @param papers - the papers clustered
 */
export function themeBandFor(papers: number): ThemeBandKeyInput {
  const row = themeCountBandFor(papers);
  return {
    minThemes: row.minThemes,
    maxThemes: row.maxThemes,
    minPapersPerTheme: minPapersPerThemeFor(papers),
  };
}

/** `{{DIGESTS}}`: every block, in order, joined by `"\n"` (`docs/06` §8.5). */
function digestsVariable(digests: readonly Digest[]): string {
  return digests.map(digestText).join("\n");
}

/**
 * Step 1: one call or two stages. Measured as `P4-T04` caps a digest —
 * `digestTokens`, raw `estTokens` after escaping, no calibration — against
 * `docs/06` §5.2's 60 000; and `resolveMaxTokens` for `digests.length`
 * papers against the model's output limit. Equal to a limit fits.
 *
 * @param digests - the papers to cluster, at least one
 * @param prompt - the active `THEME_CLUSTER` template
 * @param outputLimit - the model's `maxOutputTokens`
 * @param inputBudget - {@link ClusterInput.inputBudget}; `docs/06` §5.2's
 *   60 000 by default
 */
export function clusteringPath(
  digests: readonly Digest[],
  prompt: PromptTemplate,
  outputLimit: number,
  inputBudget: number = SYNTHESIS_INPUT_BUDGETS.THEME_CLUSTER,
): ClusteringPathChoice {
  const tokens = digestTokens(digestsVariable(digests));
  const outputCeiling = resolveMaxTokens(prompt, digests.length);
  const inputFits = tokens <= inputBudget;
  const outputFits = outputCeiling <= outputLimit;
  return {
    path: inputFits && outputFits ? "single-stage" : "two-stage",
    digestTokens: tokens,
    outputCeiling,
    inputFits,
    outputFits,
  };
}

/** The theme ids exactly one theme of `answer` uses. */
function resolvableThemeIds(answer: {
  readonly themes: readonly { readonly themeId: string }[];
}): Set<string> {
  const seen = new Map<string, number>();
  for (const theme of answer.themes) {
    seen.set(theme.themeId, (seen.get(theme.themeId) ?? 0) + 1);
  }
  return new Set(
    [...seen].filter(([, count]) => count === 1).map(([id]) => id),
  );
}

/**
 * Step 3's four rules (`docs/12` §8 "Client-side validation"), on one
 * schema-valid answer.
 *
 * @param answer - the answer, already valid against the schema
 * @param inputKeys - the run's item keys, in input order
 */
export function clusteringProblems(
  answer: ThemeClustering,
  inputKeys: readonly string[],
): ClusteringProblems {
  const valid = new Set(inputKeys);
  const ids = resolvableThemeIds(answer);
  const placed = new Map<string, number>();
  let foreign = 0;
  let unresolved = 0;
  const place = (key: string): void => {
    if (valid.has(key)) placed.set(key, (placed.get(key) ?? 0) + 1);
    else foreign += 1;
  };
  for (const row of answer.assignments) {
    place(row.itemKey);
    if (!ids.has(row.primaryThemeId)) unresolved += 1;
    for (const id of row.secondaryThemeIds ?? []) {
      if (!ids.has(id)) unresolved += 1;
    }
  }
  for (const row of answer.unclustered ?? []) place(row.itemKey);
  for (const theme of answer.themes) {
    for (const key of theme.itemKeys) if (!valid.has(key)) foreign += 1;
  }
  const counts = new Map<string, number>();
  for (const theme of answer.themes) {
    counts.set(theme.themeId, (counts.get(theme.themeId) ?? 0) + 1);
  }
  return {
    missingKeys: inputKeys.filter((key) => (placed.get(key) ?? 0) === 0),
    repeatedKeys: inputKeys.filter((key) => (placed.get(key) ?? 0) > 1),
    foreignKeyEntries: foreign,
    unresolvedThemeRefs: unresolved,
    duplicateThemeIds: [...counts]
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  };
}

/**
 * Whether {@link clusteringProblems} found anything step 3 re-runs for.
 *
 * @param problems - one answer's problems
 */
export function isMiss(problems: ClusteringProblems): boolean {
  return (
    problems.missingKeys.length > 0 ||
    problems.repeatedKeys.length > 0 ||
    problems.foreignKeyEntries > 0 ||
    problems.unresolvedThemeRefs > 0 ||
    problems.duplicateThemeIds.length > 0
  );
}

/** The number of a `^T[0-9]+$` id; `0` for anything else. */
function themeNumber(id: string): number {
  const match = /^T([0-9]+)$/.exec(id);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

/** What {@link finalizeClustering} returns. */
export interface FinalizedClustering {
  readonly clustering: ThemeClustering;
  readonly otherThemeId: string | undefined;
  readonly droppedThemeIds: readonly string[];
}

/**
 * Steps 3 and 4 on the final answer: keep what is validly placed, give the
 * leftovers a client-generated `Other` theme, then move every theme below
 * `minPapersPerTheme` to `unclustered`. Every input key ends up exactly once
 * across `assignments` and `unclustered`, and each theme's `itemKeys` are its
 * primary assignments, in input order.
 *
 * @param answer - the final, schema-valid answer
 * @param inputKeys - the run's item keys, in input order, unique
 * @param minPapersPerTheme - `{{MIN_PAPERS_PER_THEME}}`
 */
export function finalizeClustering(
  answer: ThemeClustering,
  inputKeys: readonly string[],
  minPapersPerTheme: number,
): FinalizedClustering {
  const ids = resolvableThemeIds(answer);
  const entries = new Map<
    string,
    { assigned: ThemeAssignment[]; unclustered: UnclusteredItem[] }
  >(inputKeys.map((key) => [key, { assigned: [], unclustered: [] }]));
  for (const row of answer.assignments) {
    entries.get(row.itemKey)?.assigned.push(row);
  }
  for (const row of answer.unclustered ?? []) {
    entries.get(row.itemKey)?.unclustered.push(row);
  }

  // Step 3: what is validly placed stays; everything else is a leftover.
  const primary = new Map<string, ThemeAssignment>();
  const unclustered = new Map<string, string>();
  const leftovers: string[] = [];
  for (const key of inputKeys) {
    const found = entries.get(key) ?? { assigned: [], unclustered: [] };
    const only = found.assigned[0];
    if (found.assigned.length + found.unclustered.length !== 1) {
      leftovers.push(key);
    } else if (only === undefined) {
      unclustered.set(key, (found.unclustered[0] as UnclusteredItem).reason);
    } else if (ids.has(only.primaryThemeId)) {
      primary.set(key, only);
    } else {
      leftovers.push(key);
    }
  }

  const themes: ClusteredTheme[] = answer.themes.filter((theme) =>
    ids.has(theme.themeId),
  );
  let otherThemeId: string | undefined;
  if (leftovers.length > 0) {
    const highest = Math.max(
      0,
      ...answer.themes.map((theme) => themeNumber(theme.themeId)),
    );
    otherThemeId = `T${String(highest + 1)}`;
    themes.push({
      themeId: otherThemeId,
      name: OTHER_THEME_NAME,
      definition: OTHER_THEME_DEFINITION,
      itemKeys: [],
    });
    for (const key of leftovers) {
      primary.set(key, {
        itemKey: key,
        primaryThemeId: otherThemeId,
        fit: "weak",
      });
    }
  }

  // Step 4: a theme below the minimum is dropped; its papers are unclustered.
  const members = new Map<string, number>();
  for (const row of primary.values()) {
    members.set(row.primaryThemeId, (members.get(row.primaryThemeId) ?? 0) + 1);
  }
  const dropped = themes
    .filter((theme) => (members.get(theme.themeId) ?? 0) < minPapersPerTheme)
    .map((theme) => theme.themeId);
  const droppedSet = new Set(dropped);
  for (const [key, row] of primary) {
    if (droppedSet.has(row.primaryThemeId)) {
      primary.delete(key);
      unclustered.set(key, SMALL_THEME_REASON);
    }
  }
  const kept = themes.filter((theme) => !droppedSet.has(theme.themeId));
  const keptIds = new Set(kept.map((theme) => theme.themeId));

  const assignments: ThemeAssignment[] = [];
  for (const key of inputKeys) {
    const row = primary.get(key);
    if (row === undefined) continue;
    // `ids.has` too (P4-T06): a secondary id the answer's themes never used
    // stays unresolved even when `Other` was given that number.
    const secondary = [
      ...new Set(
        (row.secondaryThemeIds ?? []).filter(
          (id) => ids.has(id) && keptIds.has(id) && id !== row.primaryThemeId,
        ),
      ),
    ];
    assignments.push({
      itemKey: key,
      primaryThemeId: row.primaryThemeId,
      ...(secondary.length > 0 && { secondaryThemeIds: secondary }),
      fit: row.fit,
    });
  }
  const finalThemes: ClusteredTheme[] = kept.map((theme) => ({
    themeId: theme.themeId,
    name: theme.name,
    definition: theme.definition,
    itemKeys: assignments
      .filter((row) => row.primaryThemeId === theme.themeId)
      .map((row) => row.itemKey),
    ...(theme.rationale !== undefined && { rationale: theme.rationale }),
  }));
  const unclusteredItems: UnclusteredItem[] = inputKeys.flatMap((key) => {
    const reason = unclustered.get(key);
    return reason === undefined ? [] : [{ itemKey: key, reason }];
  });

  return {
    clustering: {
      themes: finalThemes,
      assignments,
      unclustered: unclusteredItems,
      ...(answer.crossCuttingObservations !== undefined && {
        crossCuttingObservations: [...answer.crossCuttingObservations],
      }),
    },
    otherThemeId:
      otherThemeId !== undefined && keptIds.has(otherThemeId)
        ? otherThemeId
        : undefined,
    droppedThemeIds: dropped,
  };
}

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

function yearVariable(name: string, year: number | undefined): string {
  if (year === undefined) return DIGEST_NO_YEAR;
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError(
      `[research-helper] ${name} is a whole number 0–9999 or undefined, not ${String(year)}`,
    );
  }
  return String(year);
}

function checkBand(band: ThemeBandKeyInput): void {
  const { minThemes, maxThemes, minPapersPerTheme } = band;
  const whole = [minThemes, maxThemes, minPapersPerTheme].every(
    (value) => Number.isInteger(value) && value >= 1,
  );
  if (!whole || minThemes > maxThemes) {
    throw new RangeError(
      `[research-helper] a theme band needs whole numbers of at least 1 and minThemes ≤ maxThemes, got ${JSON.stringify(band)}`,
    );
  }
}

/** The input keys, checked: unique Zotero item keys. */
function inputKeysOf(digests: readonly Digest[]): readonly string[] {
  if (digests.length === 0) {
    throw new RangeError(
      "[research-helper] clustering needs at least one digest",
    );
  }
  const keys = digests.map((digest) => digest.itemKey);
  const bad = keys.find((key) => !ITEM_KEY_RE.test(key));
  if (bad !== undefined) {
    throw new RangeError(
      `[research-helper] a digest key must be a Zotero item key, not ${JSON.stringify(bad)}`,
    );
  }
  if (new Set(keys).size !== keys.length) {
    throw new RangeError("[research-helper] digest keys must be unique");
  }
  return keys;
}

/** What {@link checkStage} returns: the checked input, ready to render. */
interface CheckedStage {
  readonly inputKeys: readonly string[];
  readonly band: ThemeBandKeyInput;
  /** `THEME_CLUSTER`'s schema. */
  readonly schema: NonNullable<PromptTemplate["schema"]>;
  /** `{{YEAR_MIN}}` and `{{YEAR_MAX}}` as rendered. */
  readonly yearMin: string;
  readonly yearMax: string;
  readonly inputBudget: number;
  readonly batchInputBudget: number;
  readonly mergeInputBudget: number;
}

/** A budget, or a RangeError: a whole number from 1 to its §5.2 row. */
function checkedBudget(budget: number, row: number): number {
  if (!Number.isInteger(budget) || budget < 1 || budget > row) {
    throw new RangeError(
      `[research-helper] the clustering input budget must be a whole number from 1 to ${String(row)}, got ${String(budget)}`,
    );
  }
  return budget;
}

/** Every check made before any request, in one place for both paths. */
function checkStage(input: ClusterInput, deps: ClusterDeps): CheckedStage {
  const inputKeys = inputKeysOf(input.digests);
  if (!Number.isInteger(input.outputLimit) || input.outputLimit < 1) {
    throw new RangeError(
      `[research-helper] the model's output limit must be a positive whole number, got ${String(input.outputLimit)}`,
    );
  }
  const ceiling = SYNTHESIS_INPUT_BUDGETS.THEME_CLUSTER;
  const inputBudget = checkedBudget(input.inputBudget ?? ceiling, ceiling);
  const batchInputBudget = checkedBudget(
    input.batchInputBudget ?? inputBudget,
    ceiling,
  );
  const mergeInputBudget = checkedBudget(
    input.mergeInputBudget ?? SYNTHESIS_INPUT_BUDGETS.THEME_MERGE,
    SYNTHESIS_INPUT_BUDGETS.THEME_MERGE,
  );
  const band = input.band ?? themeBandFor(inputKeys.length);
  checkBand(band);
  const prompt = deps.prompt;
  if (prompt.id !== "THEME_CLUSTER" || prompt.schema === null) {
    throw new ConfigurationError(
      "clusterThemes needs the THEME_CLUSTER template with its schema",
      { promptId: prompt.id },
    );
  }
  return {
    inputKeys,
    band,
    schema: prompt.schema,
    yearMin: yearVariable("yearMin", input.yearMin),
    yearMax: yearVariable("yearMax", input.yearMax),
    inputBudget,
    batchInputBudget,
    mergeInputBudget,
  };
}

// ---------------------------------------------------------------------------
// 4. Two stages (`P4-T06`; `docs/06` §8.4, `docs/12` §20 and their notes of
//    2026-10-29)
// ---------------------------------------------------------------------------

/** `P4-T04`'s labels for the lines the pre-sort reads (`toDigest`). */
const THEME_LINE_LABEL = "Theme(first-pass): ";
const KEYWORDS_LINE_LABEL = "Keywords: ";
const KEYWORD_SEPARATOR = "; ";
/** A digest head's year: `[KEY] 2024 | …`; `n.d.` does not match. */
const HEAD_YEAR_RE = /^\[[^\]]*\] ([0-9]{1,4})(?: |$)/;
/** Every run of whitespace or control characters (as `P4-T04`'s `oneLine`). */
const BREAKING_RE = /[\s\p{Cc}]+/gu;

/** One line of model text, so a name cannot start another `{{LOCAL_THEMES}}` block. */
function flatLine(value: string): string {
  return value.normalize("NFC").replace(BREAKING_RE, " ").trim();
}

/** The labelled content of a digest line; `undefined` when absent or empty. */
function digestField(
  digest: Digest,
  kind: Digest["lines"][number]["kind"],
  label: string,
): string | undefined {
  const line = digest.lines.find((candidate) => candidate.kind === kind);
  if (line === undefined || !line.text.startsWith(label)) return undefined;
  const text = line.text.slice(label.length).trim();
  return text === "" ? undefined : text;
}

interface PresortKey {
  readonly theme: string | undefined;
  readonly keyword: string | undefined;
  readonly year: number | undefined;
  readonly itemKey: string;
}

function presortKey(digest: Digest): PresortKey {
  const keywords = digestField(digest, "keywords", KEYWORDS_LINE_LABEL);
  const keyword = keywords?.split(KEYWORD_SEPARATOR)[0]?.trim();
  const head = digest.lines.find((line) => line.kind === "head");
  const year = head === undefined ? undefined : HEAD_YEAR_RE.exec(head.text);
  return {
    theme: digestField(digest, "theme", THEME_LINE_LABEL),
    keyword: keyword === "" ? undefined : keyword,
    year: year?.[1] === undefined ? undefined : Number(year[1]),
    itemKey: digest.itemKey,
  };
}

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Lower-cased, so `Alpha` and `alpha` are one key and the next key decides;
 * a missing value after every present one.
 */
function compareText(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return compareCodeUnits(a.toLowerCase(), b.toLowerCase());
}

/** Earlier years first; `n.d.` after every year. */
function compareYear(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

/**
 * `docs/06` §8.4 step 1's deterministic, content-aware pre-sort: first-pass
 * `researchTheme`, then the top keyword, then the year, each read from the
 * digest's own lines; equal keys by item key, so the order does not depend
 * on the order given (`docs/06` §8.4's note of 2026-10-29, reading (3)).
 *
 * @param digests - the run's digests
 * @returns a sorted copy
 */
export function presortDigests(digests: readonly Digest[]): Digest[] {
  return digests
    .map((digest) => ({ digest, key: presortKey(digest) }))
    .sort(
      (a, b) =>
        compareText(a.key.theme, b.key.theme) ||
        compareText(a.key.keyword, b.key.keyword) ||
        compareYear(a.key.year, b.key.year) ||
        compareCodeUnits(a.key.itemKey, b.key.itemKey),
    )
    .map((entry) => entry.digest);
}

/** `items` in `count` consecutive runs whose sizes differ by at most one, the larger first. */
function balancedRuns<T>(items: readonly T[], count: number): T[][] {
  const base = Math.floor(items.length / count);
  const larger = items.length % count;
  const runs: T[][] = [];
  let start = 0;
  for (let at = 0; at < count; at += 1) {
    const size = base + (at < larger ? 1 : 0);
    runs.push(items.slice(start, start + size));
    start += size;
  }
  return runs;
}

/**
 * `docs/06` §8.4 step 1: the pre-sorted digests in ⌈N / `batchSize`⌉
 * balanced batches, one more at a time while a batch's joined digests would
 * exceed `inputBudget` (`docs/06` §8.4's note of 2026-10-29, reading (2)).
 *
 * @param digests - the run's digests, at least one
 * @param batchSize - `B`, a whole number of at least 1 (`clusterBatchSize`)
 * @param inputBudget - the most `digestTokens` one batch may carry
 * @returns the batches, in order; each non-empty
 * @throws RangeError for a bad batch size; ConfigurationError when one
 *   digest alone exceeds `inputBudget`
 */
export function partitionDigests(
  digests: readonly Digest[],
  batchSize: number,
  inputBudget: number = SYNTHESIS_INPUT_BUDGETS.THEME_CLUSTER,
): Digest[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError(
      `[research-helper] a batch size is a whole number of at least 1, got ${String(batchSize)}`,
    );
  }
  const sorted = presortDigests(digests);
  for (
    let count = Math.ceil(sorted.length / batchSize);
    count <= sorted.length;
    count += 1
  ) {
    const batches = balancedRuns(sorted, count);
    if (
      batches.every(
        (batch) => digestTokens(digestsVariable(batch)) <= inputBudget,
      )
    ) {
      return batches;
    }
  }
  throw new ConfigurationError(
    "a single digest exceeds the clustering input budget",
    { inputBudget },
  );
}

/**
 * `docs/12` §20's checks on one schema-valid `THEME_MERGE` answer.
 *
 * @param answer - the answer, already valid against `theme-merge.v1.json`
 * @param localIds - the local theme ids given, in `{{LOCAL_THEMES}}` order
 */
export function mergeProblems(
  answer: ThemeMerge,
  localIds: readonly string[],
): MergeProblems {
  const given = new Set(localIds);
  const ids = resolvableThemeIds(answer);
  const seen = new Map<string, number>();
  let foreign = 0;
  let unresolved = 0;
  for (const row of answer.mapping) {
    if (given.has(row.localThemeId)) {
      seen.set(row.localThemeId, (seen.get(row.localThemeId) ?? 0) + 1);
    } else {
      foreign += 1;
    }
    if (row.globalThemeId !== null && !ids.has(row.globalThemeId)) {
      unresolved += 1;
    }
  }
  const counts = new Map<string, number>();
  for (const theme of answer.themes) {
    counts.set(theme.themeId, (counts.get(theme.themeId) ?? 0) + 1);
  }
  return {
    missingLocalIds: localIds.filter((id) => (seen.get(id) ?? 0) === 0),
    repeatedLocalIds: localIds.filter((id) => (seen.get(id) ?? 0) > 1),
    foreignLocalIds: foreign,
    unresolvedGlobalRefs: unresolved,
    duplicateThemeIds: [...counts]
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  };
}

/**
 * Whether {@link mergeProblems} found anything the merge is re-run for.
 *
 * @param problems - one answer's problems
 */
export function isMergeMiss(problems: MergeProblems): boolean {
  return (
    problems.missingLocalIds.length > 0 ||
    problems.repeatedLocalIds.length > 0 ||
    problems.foreignLocalIds > 0 ||
    problems.unresolvedGlobalRefs > 0 ||
    problems.duplicateThemeIds.length > 0
  );
}

/**
 * The final answer's mapping: a local id exactly once in `mapping`, to `null`
 * or to a global id that resolves, keeps it; every other local id is `null`.
 */
function finalMapping(
  answer: ThemeMerge,
  localIds: readonly string[],
): Map<string, string | null> {
  const ids = resolvableThemeIds(answer);
  const rows = new Map<string, (string | null)[]>();
  for (const row of answer.mapping) {
    const list = rows.get(row.localThemeId) ?? [];
    list.push(row.globalThemeId);
    rows.set(row.localThemeId, list);
  }
  return new Map(
    localIds.map((id) => {
      const found = rows.get(id) ?? [];
      const only = found.length === 1 ? found[0] : undefined;
      return [
        id,
        only === undefined || only === null || !ids.has(only) ? null : only,
      ];
    }),
  );
}

/** One batch-local theme as the merge is given it. */
interface LocalTheme {
  /** `B<batch>-<themeId>`. */
  readonly id: string;
  readonly theme: ClusteredTheme;
}

/** `{{LOCAL_THEMES}}`: one block per local theme (`docs/12` §20's note, reading (3)). */
function localThemesVariable(locals: readonly LocalTheme[]): string {
  return locals
    .map(
      (local) =>
        `[${local.id}] papers: ${String(local.theme.itemKeys.length)}\n` +
        `Name: ${flatLine(local.theme.name)}\n` +
        `Definition: ${flatLine(local.theme.definition)}`,
    )
    .join("\n");
}

/** One batch's result, after its re-run (`docs/12` §20's note, reading (2)). */
interface BatchDone {
  readonly kind: "done";
  /** 1-based. */
  readonly batch: number;
  /** The kept local themes, `Other` excluded; each with at least one paper. */
  readonly themes: readonly ClusteredTheme[];
  /** The primary assignments to those themes. */
  readonly assignments: readonly ThemeAssignment[];
  /** The model's own `unclustered` entries. */
  readonly unclustered: readonly UnclusteredItem[];
  /** Keys held for the global `Other` theme. */
  readonly leftovers: readonly string[];
}

/**
 * A batch that sent no further request because another failed. (A batch's
 * second answer over its band's `MAX_THEMES` no longer stops the stage:
 * owner, `plan/00` §6 item 309(e).)
 */
interface BatchHalted {
  readonly kind: "halted";
}

type BatchResult = BatchDone | BatchHalted;

/** Thrown inside the stage only, when another batch has failed. */
class StageHalted extends Error {
  override readonly name = "StageHalted";
}

/** One call's counters: requests, chat calls and their usage. */
interface CallTally {
  requests: number;
  calls: number;
  readonly usages: Usage[];
}

function newTally(): CallTally {
  return { requests: 0, calls: 0, usages: [] };
}

/**
 * `docs/06` §8.4's two stages (`plan/07` `P4-T06`): batches of `THEME_CLUSTER`
 * under the `llm` pool, one `THEME_MERGE`, then re-assignment in code. Called
 * by {@link clusterThemes} when {@link clusteringPath} says `two-stage`.
 *
 * @param input - see {@link ClusterInput}
 * @param deps - see {@link ClusterDeps}; `mergePrompt` and `pool` are read here
 * @param choice - step 1's measurement, for the log
 * @returns the validated clustering (at least one theme), or a stop
 * @throws as {@link clusterThemes}; ConfigurationError, before any request,
 *   for a `mergePrompt` that is not `THEME_MERGE` with its schema, or a model
 *   whose output limit cannot hold one paper's `THEME_CLUSTER` ceiling or
 *   `THEME_MERGE`'s, or a digest alone over the input budget
 */
export async function clusterThemesTwoStage(
  input: ClusterInput,
  deps: ClusterDeps,
  choice: ClusteringPathChoice,
): Promise<ClusterOutcome> {
  const {
    inputKeys,
    band,
    schema,
    yearMin,
    yearMax,
    batchInputBudget,
    mergeInputBudget,
  } = checkStage(input, deps);
  const papers = inputKeys.length;
  const prompt = deps.prompt;
  const mergePrompt = deps.mergePrompt;
  if (mergePrompt.id !== "THEME_MERGE" || mergePrompt.schema === null) {
    throw new ConfigurationError(
      "two-stage clustering needs the THEME_MERGE template with its schema",
      { promptId: mergePrompt.id },
    );
  }
  const mergeSchema = mergePrompt.schema;
  const batchSize = clusterBatchSize(prompt, input.outputLimit);
  const mergeCeiling = resolveMaxTokens(mergePrompt);
  if (
    resolveMaxTokens(prompt, batchSize) > input.outputLimit ||
    mergeCeiling > input.outputLimit
  ) {
    throw new ConfigurationError(
      "the model's output limit cannot hold two-stage clustering's calls (docs/06 §8.4)",
      {
        outputLimit: input.outputLimit,
        onePaperCeiling: resolveMaxTokens(prompt, 1),
        mergeCeiling,
      },
    );
  }
  const batches = partitionDigests(input.digests, batchSize, batchInputBudget);
  deps.logger?.info("theme clustering: two stages", {
    papers,
    batches: batches.length,
    batchSize,
    digestTokens: choice.digestTokens,
    outputCeiling: choice.outputCeiling,
    outputLimit: input.outputLimit,
    batchInputBudget,
  });

  deps.token.throwIfCancelled();
  const model = deps.llm.resolveModel("strong");
  const trace = deps.traceId ?? "theme-cluster";
  const halt = { halted: false };

  /**
   * One request under a pool permit; refused once the stage has halted. A
   * failure halts the stage **before the permit is given back**, so no
   * waiting batch sends after it. (No answer halts it since item 309(e).)
   */
  const send = async <T>(
    tally: CallTally,
    build: (request: number) => StructuredRequest,
  ): Promise<T> => {
    const release = await deps.pool.acquire(deps.token);
    try {
      if (halt.halted) throw new StageHalted();
      deps.token.throwIfCancelled();
      tally.requests += 1;
      const completed = await completeJSON<T>(
        deps.llm,
        build(tally.requests),
        { token: deps.token, budget: deps.budget },
        { includeBodies: deps.includeBodies ?? false },
      );
      tally.usages.push(completed.usage);
      tally.calls += completed.calls;
      return completed.value;
    } catch (error) {
      if (!(error instanceof StageHalted)) halt.halted = true;
      throw error;
    } finally {
      release();
    }
  };

  // Stage 1 — one THEME_CLUSTER call per batch (docs/06 §8.4 step 2).
  const batchTallies = batches.map(newTally);
  const runBatch = async (
    index: number,
    digests: readonly Digest[],
  ): Promise<BatchResult> => {
    const batch = index + 1;
    const keys = digests.map((digest) => digest.itemKey);
    const batchBand = themeBandFor(keys.length);
    const rendered = renderPrompt(prompt, {
      N_PAPERS: String(keys.length),
      YEAR_MIN: yearMin,
      YEAR_MAX: yearMax,
      USER_TOPIC: input.userTopic,
      MIN_THEMES: String(batchBand.minThemes),
      MAX_THEMES: String(batchBand.maxThemes),
      MIN_PAPERS_PER_THEME: String(batchBand.minPapersPerTheme),
      DIGESTS: digestsVariable(digests),
    });
    const ceiling = resolveMaxTokens(prompt, keys.length);
    const tally = batchTallies[index] as CallTally;
    const ask = (): Promise<ThemeClustering> =>
      send<ThemeClustering>(tally, (request) => ({
        model: model.modelId,
        messages: [
          { role: "system", content: rendered.system },
          { role: "user", content: rendered.user },
        ],
        temperature: prompt.defaultTemperature,
        maxOutputTokens: ceiling,
        effort: THEME_CLUSTER_EFFORT,
        responseFormat: {
          kind: "json_schema",
          name: THEME_CLUSTER_SCHEMA_NAME,
          schema,
        },
        ...(deps.routing !== undefined && { routing: deps.routing }),
        traceId: `${trace}:batch-${String(batch)}:request-${String(request)}`,
      }));
    try {
      let answer = await ask();
      const first = clusteringProblems(answer, keys);
      if (isMiss(first) || answer.themes.length > batchBand.maxThemes) {
        // docs/12 §8 rules (3) and (5), per batch: one shared re-run.
        deps.logger?.warn(
          "theme clustering: a batch answer is asked for once more",
          {
            batch,
            papers: keys.length,
            themes: answer.themes.length,
            maxThemes: batchBand.maxThemes,
            missing: first.missingKeys.length,
            repeated: first.repeatedKeys.length,
            foreign: first.foreignKeyEntries,
            unresolved: first.unresolvedThemeRefs,
            duplicateThemeIds: first.duplicateThemeIds.length,
          },
        );
        answer = await ask();
        // Owner, plan/00 §6 item 309(e): a re-run still over the batch's band
        // is not a stop; its local themes go to the merge, which the run's
        // MAX_THEMES bounds.
        if (answer.themes.length > batchBand.maxThemes) {
          deps.logger?.warn(
            "theme clustering: a batch answer is still over its band; its themes go to the merge",
            {
              batch,
              themes: answer.themes.length,
              maxThemes: batchBand.maxThemes,
            },
          );
        }
      }
      // A local theme is dropped only when it has no paper (reading (2)).
      const finalized = finalizeClustering(answer, keys, 1);
      const other = finalized.otherThemeId;
      return {
        kind: "done",
        batch,
        themes: finalized.clustering.themes.filter(
          (theme) => theme.themeId !== other,
        ),
        assignments: finalized.clustering.assignments.filter(
          (row) => row.primaryThemeId !== other,
        ),
        unclustered: finalized.clustering.unclustered ?? [],
        leftovers: finalized.clustering.assignments
          .filter((row) => row.primaryThemeId === other)
          .map((row) => row.itemKey),
      };
    } catch (error) {
      if (error instanceof StageHalted) return { kind: "halted" };
      throw error;
    }
  };
  const settled = await Promise.allSettled(
    batches.map(async (digests, index) => {
      try {
        return await runBatch(index, digests);
      } catch (error) {
        halt.halted = true;
        throw error;
      }
    }),
  );

  const mergeTally = newTally();
  const mergeUse: TrendPromptUse = {
    promptId: "THEME_MERGE",
    promptVersion: mergePrompt.version,
    modelId: model.modelId,
    temperature: mergePrompt.defaultTemperature,
  };
  const base = (): ClusterOutcomeBase => {
    const tallies = [...batchTallies, mergeTally];
    return {
      band,
      passes: tallies.filter((tally) => tally.requests > 0).length,
      requests: tallies.reduce((sum, tally) => sum + tally.requests, 0),
      calls: tallies.reduce((sum, tally) => sum + tally.calls, 0),
      usage: sumUsage(tallies.flatMap((tally) => tally.usages)),
      prompt: {
        promptId: "THEME_CLUSTER",
        promptVersion: prompt.version,
        modelId: model.modelId,
        temperature: prompt.defaultTemperature,
      },
      batches: batches.length,
      ...(mergeTally.requests > 0 && { mergePrompt: mergeUse }),
    };
  };

  // The first failure in batch order ends the stage.
  const results: BatchResult[] = [];
  for (const outcome of settled) {
    if (outcome.status === "rejected") throw outcome.reason;
    results.push(outcome.value);
  }
  const done = results.filter(
    (result): result is BatchDone => result.kind === "done",
  );

  // Stage 2 — one THEME_MERGE call (docs/06 §8.4 step 3; docs/12 §20).
  const locals: LocalTheme[] = done.flatMap((result) =>
    result.themes.map((theme) => ({
      id: `B${String(result.batch)}-${theme.themeId}`,
      theme,
    })),
  );
  const localIds = locals.map((local) => local.id);
  let merge: ThemeMerge | undefined;
  if (locals.length > 0) {
    // Owner, plan/00 §6 item 309(e): the batches' local themes are unbounded,
    // so {{LOCAL_THEMES}} is measured as rendered, as {{DIGESTS}} is, against
    // THEME_MERGE's input budget before the merge request.
    const localThemes = localThemesVariable(locals);
    const mergeInputTokens = digestTokens(localThemes);
    if (mergeInputTokens > mergeInputBudget) {
      deps.logger?.warn(
        "theme clustering: the merge input is over its budget; the run stops",
        {
          localThemes: locals.length,
          mergeInputTokens,
          mergeInputBudget,
        },
      );
      return {
        ...base(),
        status: "stopped-merge-over-budget",
        messageId: MERGE_TOO_LARGE_L10N,
        localThemes: locals.length,
        mergeInputTokens,
        mergeInputBudget,
      };
    }
    const rendered = renderPrompt(mergePrompt, {
      N_PAPERS: String(papers),
      N_BATCHES: String(batches.length),
      USER_TOPIC: input.userTopic,
      MIN_THEMES: String(band.minThemes),
      MAX_THEMES: String(band.maxThemes),
      MIN_PAPERS_PER_THEME: String(band.minPapersPerTheme),
      LOCAL_THEMES: localThemes,
    });
    const askMerge = (): Promise<ThemeMerge> =>
      send<ThemeMerge>(mergeTally, (request) => ({
        model: model.modelId,
        messages: [
          { role: "system", content: rendered.system },
          { role: "user", content: rendered.user },
        ],
        temperature: mergePrompt.defaultTemperature,
        maxOutputTokens: mergeCeiling,
        effort: THEME_MERGE_EFFORT,
        responseFormat: {
          kind: "json_schema",
          name: THEME_MERGE_SCHEMA_NAME,
          schema: mergeSchema,
        },
        ...(deps.routing !== undefined && { routing: deps.routing }),
        traceId: `${trace}:merge:request-${String(request)}`,
      }));
    merge = await askMerge();
    const first = mergeProblems(merge, localIds);
    if (isMergeMiss(first) || merge.themes.length > band.maxThemes) {
      // docs/12 §20's one re-run, shared with §8 rule (5) as item 307(a).
      deps.logger?.warn("theme clustering: the merge is asked for once more", {
        localThemes: localIds.length,
        themes: merge.themes.length,
        maxThemes: band.maxThemes,
        missing: first.missingLocalIds.length,
        repeated: first.repeatedLocalIds.length,
        foreign: first.foreignLocalIds,
        unresolved: first.unresolvedGlobalRefs,
        duplicateThemeIds: first.duplicateThemeIds.length,
      });
      merge = await askMerge();
      if (merge.themes.length > band.maxThemes) {
        deps.logger?.warn(
          "theme clustering: the merge still has more themes than MAX_THEMES; the run stops",
          { themes: merge.themes.length, maxThemes: band.maxThemes },
        );
        return {
          ...base(),
          status: "stopped-too-many-themes",
          messageId: TOO_MANY_THEMES_L10N,
          args: { themes: merge.themes.length, max: band.maxThemes },
        };
      }
    }
  }

  // Re-assignment (docs/06 §8.4 step 4; docs/12 §20's note, reading (5)).
  const mapping =
    merge === undefined
      ? new Map<string, string | null>()
      : finalMapping(merge, localIds);
  const assignments: ThemeAssignment[] = [];
  const unclustered: UnclusteredItem[] = [];
  for (const result of done) {
    const global = (localId: string): string | null =>
      mapping.get(`B${String(result.batch)}-${localId}`) ?? null;
    for (const row of result.assignments) {
      const primary = global(row.primaryThemeId);
      if (primary === null) {
        unclustered.push({
          itemKey: row.itemKey,
          reason: UNMAPPED_THEME_REASON,
        });
        continue;
      }
      const secondary = (row.secondaryThemeIds ?? [])
        .map(global)
        .filter((id): id is string => id !== null);
      assignments.push({
        itemKey: row.itemKey,
        primaryThemeId: primary,
        ...(secondary.length > 0 && { secondaryThemeIds: secondary }),
        fit: row.fit,
      });
    }
    unclustered.push(...result.unclustered);
  }
  // The held leftovers are in neither list, so finalizeClustering gives them
  // `Other` (docs/12 §8 rule (3)) and then applies the run's minimum, rule (6).
  const finalized = finalizeClustering(
    {
      themes: (merge?.themes ?? []).map((theme) => ({
        themeId: theme.themeId,
        name: theme.name,
        definition: theme.definition,
        itemKeys: [],
        ...(theme.rationale !== undefined && { rationale: theme.rationale }),
      })),
      assignments,
      unclustered,
    },
    inputKeys,
    band.minPapersPerTheme,
  );
  if (finalized.clustering.themes.length === 0) {
    deps.logger?.warn(
      "theme clustering: every theme fell below the minimum; the run stops",
      {
        papers,
        minPapersPerTheme: band.minPapersPerTheme,
        dropped: finalized.droppedThemeIds.length,
      },
    );
    return {
      ...base(),
      status: "stopped-no-themes",
      messageId: NO_THEMES_L10N,
      droppedThemeIds: finalized.droppedThemeIds,
    };
  }
  return {
    ...base(),
    status: "clustered",
    clustering: finalized.clustering,
    otherThemeId: finalized.otherThemeId,
    droppedThemeIds: finalized.droppedThemeIds,
  };
}

// ---------------------------------------------------------------------------
// 5. The stage
// ---------------------------------------------------------------------------

/**
 * Cluster `input.digests` into themes (`plan/07` `P4-T05`).
 *
 * @param input - see {@link ClusterInput}
 * @param deps - see {@link ClusterDeps}
 * @returns the validated clustering (at least one theme), or step 6's or
 *   step 7's stop
 * @throws RangeError for an empty, malformed or repeated key, a bad year,
 *   band or output limit; ConfigurationError for a template that is not
 *   `THEME_CLUSTER` with its schema, and from {@link clusterThemesTwoStage};
 *   OperationCancelledError on cancel; and whatever a request throws —
 *   `StructuredOutputError`, `OutputTruncatedError`, a budget stop — unchanged
 */
export async function clusterThemes(
  input: ClusterInput,
  deps: ClusterDeps,
): Promise<ClusterOutcome> {
  const { inputKeys, band, schema, yearMin, yearMax, inputBudget } = checkStage(
    input,
    deps,
  );
  const papers = inputKeys.length;
  const prompt = deps.prompt;
  const vars: Record<string, string> = {
    N_PAPERS: String(papers),
    YEAR_MIN: yearMin,
    YEAR_MAX: yearMax,
    USER_TOPIC: input.userTopic,
    MIN_THEMES: String(band.minThemes),
    MAX_THEMES: String(band.maxThemes),
    MIN_PAPERS_PER_THEME: String(band.minPapersPerTheme),
    DIGESTS: digestsVariable(input.digests),
  };

  // Step 1.
  const choice = clusteringPath(
    input.digests,
    prompt,
    input.outputLimit,
    inputBudget,
  );
  if (choice.path === "two-stage") {
    return clusterThemesTwoStage(input, deps, choice);
  }

  // Step 2.
  deps.token.throwIfCancelled();
  const model = deps.llm.resolveModel("strong");
  const rendered = renderPrompt(prompt, vars);
  const usages: Usage[] = [];
  let requests = 0;
  let calls = 0;
  const ask = async (): Promise<ThemeClustering> => {
    deps.token.throwIfCancelled();
    requests += 1;
    const request: StructuredRequest = {
      model: model.modelId,
      messages: [
        { role: "system", content: rendered.system },
        { role: "user", content: rendered.user },
      ],
      temperature: prompt.defaultTemperature,
      maxOutputTokens: choice.outputCeiling,
      effort: THEME_CLUSTER_EFFORT,
      responseFormat: {
        kind: "json_schema",
        name: THEME_CLUSTER_SCHEMA_NAME,
        schema,
      },
      ...(deps.routing !== undefined && { routing: deps.routing }),
      traceId: `${deps.traceId ?? "theme-cluster"}:request-${String(requests)}`,
    };
    const completed = await completeJSON<ThemeClustering>(
      deps.llm,
      request,
      { token: deps.token, budget: deps.budget },
      { includeBodies: deps.includeBodies ?? false },
    );
    usages.push(completed.usage);
    calls += completed.calls;
    return completed.value;
  };
  const base = (): ClusterOutcomeBase => ({
    band,
    passes: 1,
    requests,
    calls,
    usage: sumUsage(usages),
    prompt: {
      promptId: "THEME_CLUSTER",
      promptVersion: prompt.version,
      modelId: model.modelId,
      temperature: prompt.defaultTemperature,
    },
  });

  let answer = await ask();
  const first = clusteringProblems(answer, inputKeys);
  const overFirst = answer.themes.length > band.maxThemes;
  if (isMiss(first) || overFirst) {
    // Steps 3 and 6: one re-run, shared (CLUSTER_REQUESTS_MAX); its answer is final.
    deps.logger?.warn("theme clustering: the answer is asked for once more", {
      papers,
      themes: answer.themes.length,
      maxThemes: band.maxThemes,
      missing: first.missingKeys.length,
      repeated: first.repeatedKeys.length,
      foreign: first.foreignKeyEntries,
      unresolved: first.unresolvedThemeRefs,
      duplicateThemeIds: first.duplicateThemeIds.length,
    });
    answer = await ask();
    if (answer.themes.length > band.maxThemes) {
      deps.logger?.warn(
        "theme clustering: still more themes than MAX_THEMES; the run stops",
        { themes: answer.themes.length, maxThemes: band.maxThemes },
      );
      return {
        ...base(),
        status: "stopped-too-many-themes",
        messageId: TOO_MANY_THEMES_L10N,
        args: { themes: answer.themes.length, max: band.maxThemes },
      };
    }
  }

  // Steps 3 (leftovers to Other) and 4 (small themes to unclustered).
  const finalized = finalizeClustering(
    answer,
    inputKeys,
    band.minPapersPerTheme,
  );
  // Step 7 (owner, plan/00 §6 item 307(c)): no theme left, nothing to analyse.
  if (finalized.clustering.themes.length === 0) {
    deps.logger?.warn(
      "theme clustering: every theme fell below the minimum; the run stops",
      {
        papers,
        minPapersPerTheme: band.minPapersPerTheme,
        dropped: finalized.droppedThemeIds.length,
      },
    );
    return {
      ...base(),
      status: "stopped-no-themes",
      messageId: NO_THEMES_L10N,
      droppedThemeIds: finalized.droppedThemeIds,
    };
  }
  return {
    ...base(),
    status: "clustered",
    clustering: finalized.clustering,
    otherThemeId: finalized.otherThemeId,
    droppedThemeIds: finalized.droppedThemeIds,
  };
}
