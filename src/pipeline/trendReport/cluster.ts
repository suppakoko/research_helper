/**
 * Theme clustering with client-side validation (`P4-T05`; `docs/12` §8,
 * `docs/06` §8.2–§8.4, §9.2): N digests become a validated
 * {@link ThemeClustering} in which every analysed paper appears exactly once,
 * from one `THEME_CLUSTER` call when the digests fit.
 *
 * **Callers.** Nothing calls this module yet. The report run
 * (`trendReportPipeline.ts`, `P4-T18`) calls {@link clusterThemes} at its
 * cluster stage, with the digests it built (`toDigest`, `P4-T04`), the strong
 * model's `ModelInfo.maxOutputTokens` it also gives `planSynthesis` (`P4-T16`),
 * and its context's budgeted router, budget and token. `P4-T06` replaces
 * {@link clusterThemesTwoStage}. Nothing is constructed: every export is a
 * function or a constant.
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
 *
 * The readings these steps leave open are `docs/12` §8's note of 2026-10-29.
 * **Open for the owner** (`plan/reports/followup-292.md` finding 2): steps 3
 * and 6 share one re-run here ({@link CLUSTER_REQUESTS_MAX}); see that note.
 *
 * **Model output is untrusted.** `completeJSON` validates the answer against
 * `theme-clustering.v1.json`; this module then checks every key against the
 * run's input keys and every theme id against the answer's own themes, and
 * builds the result from what passed — never from a field it did not check.
 */

import type { ThemeBandKeyInput } from "../../core/cache/keys";
import { ConfigurationError } from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
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
  TrendPromptUse,
  UnclusteredItem,
} from "../../model/trend";
import {
  renderPrompt,
  resolveMaxTokens,
  type PromptTemplate,
} from "../../prompts";
import { SYNTHESIS_INPUT_BUDGETS, themeCountBandFor } from "../shared/estimate";
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
 * theme count. **Open for the owner** (`docs/12` §8's note of 2026-10-29): the
 * alternative is one re-run per defect, which would make this 3.
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
 * Step 6's stop message (owner, `plan/00` §6 item 292(d)); `$themes` is the
 * second answer's theme count and `$max` is `MAX_THEMES`. On
 * `KO_PENDING_REVIEW` (`G-41`).
 */
export const TOO_MANY_THEMES_L10N =
  "research-helper-report-stopped-too-many-themes" as const satisfies MainWindowMessageId;

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
  /** The theme band; absent: {@link themeBandFor} the paper count. */
  readonly band?: ThemeBandKeyInput;
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
  /** Reduction passes (FR-27): 1 for the single-stage call. */
  readonly passes: number;
  /** `THEME_CLUSTER` requests sent, the re-run included; at most {@link CLUSTER_REQUESTS_MAX}. */
  readonly requests: number;
  /** Every chat request made, `completeJSON`'s repairs and retries included. */
  readonly calls: number;
  /** Summed over {@link calls}; a field is `undefined` if any answer lacked it. */
  readonly usage: Usage;
  /** The prompt, its version, the model and the temperature the stage ran on. */
  readonly prompt: TrendPromptUse;
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

export type ClusterOutcome = ClusteredOutcome | TooManyThemesOutcome;

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
 */
export function clusteringPath(
  digests: readonly Digest[],
  prompt: PromptTemplate,
  outputLimit: number,
): ClusteringPathChoice {
  const tokens = digestTokens(digestsVariable(digests));
  const outputCeiling = resolveMaxTokens(prompt, digests.length);
  const inputFits = tokens <= SYNTHESIS_INPUT_BUDGETS.THEME_CLUSTER;
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
function resolvableThemeIds(answer: ThemeClustering): Set<string> {
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
    const secondary = [
      ...new Set(
        (row.secondaryThemeIds ?? []).filter(
          (id) => keptIds.has(id) && id !== row.primaryThemeId,
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

// ---------------------------------------------------------------------------
// 4. The stage
// ---------------------------------------------------------------------------

/**
 * `docs/06` §8.4's two stages: `P4-T06`'s. **A stub that throws until that
 * card lands**, so a corpus that needs it fails loudly before any request.
 *
 * @throws ConfigurationError always
 */
export function clusterThemesTwoStage(
  input: ClusterInput,
  _deps: ClusterDeps,
  choice: ClusteringPathChoice,
): Promise<never> {
  return Promise.reject(
    new ConfigurationError(
      "two-stage theme clustering (docs/06 §8.4) is P4-T06's and not built yet",
      {
        papers: input.digests.length,
        digestTokens: choice.digestTokens,
        outputCeiling: choice.outputCeiling,
        outputLimit: input.outputLimit,
      },
    ),
  );
}

/**
 * Cluster `input.digests` into themes (`plan/07` `P4-T05`).
 *
 * @param input - see {@link ClusterInput}
 * @param deps - see {@link ClusterDeps}
 * @returns the validated clustering, or step 6's stop
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
  const inputKeys = inputKeysOf(input.digests);
  const papers = inputKeys.length;
  if (!Number.isInteger(input.outputLimit) || input.outputLimit < 1) {
    throw new RangeError(
      `[research-helper] the model's output limit must be a positive whole number, got ${String(input.outputLimit)}`,
    );
  }
  const band = input.band ?? themeBandFor(papers);
  checkBand(band);
  const prompt = deps.prompt;
  if (prompt.id !== "THEME_CLUSTER" || prompt.schema === null) {
    throw new ConfigurationError(
      "clusterThemes needs the THEME_CLUSTER template with its schema",
      { promptId: prompt.id },
    );
  }
  const schema = prompt.schema;
  const vars: Record<string, string> = {
    N_PAPERS: String(papers),
    YEAR_MIN: yearVariable("yearMin", input.yearMin),
    YEAR_MAX: yearVariable("yearMax", input.yearMax),
    USER_TOPIC: input.userTopic,
    MIN_THEMES: String(band.minThemes),
    MAX_THEMES: String(band.maxThemes),
    MIN_PAPERS_PER_THEME: String(band.minPapersPerTheme),
    DIGESTS: digestsVariable(input.digests),
  };

  // Step 1.
  const choice = clusteringPath(input.digests, prompt, input.outputLimit);
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
  return {
    ...base(),
    status: "clustered",
    clustering: finalized.clustering,
    otherThemeId: finalized.otherThemeId,
    droppedThemeIds: finalized.droppedThemeIds,
  };
}
