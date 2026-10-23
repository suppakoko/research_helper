/**
 * The pre-run estimate: how many calls, how many tokens and how many dollars a
 * summarize run will spend, before any of it is spent.
 *
 * **Scope.** `P3-T16` step 1. The caller is the summarize pipeline's
 * `Estimating` state (`docs/07` §12.3; `P3-T29`), and the result is what the
 * cost dialog (`src/ui/dialogs/costConfirmDialog.ts`) shows. Pure: no
 * preference, no network, no clock of its own — every input is a parameter,
 * so the arithmetic can be checked against `docs/06` §5.4's worked example.
 *
 * **What is counted** (`docs/06` §5.4, DR-1, and §5.2's budget table). The map
 * phase only — one paper's summary per item; the synthesis calls of the trend
 * report are Phase 4's.
 *
 * - An item already summarized (a cache hit) costs nothing and is counted as
 *   cached.
 * - DR-1 decides the scope per item: full text in `always` mode whenever there
 *   is any; in `auto` mode only when it is at least
 *   {@link FULL_TEXT_MIN_RATIO} times the abstract's tokens; never in `never`
 *   mode. The `fullTextMode` passed in is the one **after** the privacy policy
 *   (`allowedInputScope`, which forces `never` in strict mode).
 * - A full text within `PAPER_SUMMARY_FULLTEXT`'s 24 000-token input budget is
 *   one call; a longer one is chunked: `CHUNK_MAP` calls of up to 6 000 tokens
 *   with the 250-token overlap of §5.3, then one `CHUNK_REDUCE` over the map
 *   outputs.
 * - An item with no abstract and no full text is `metadata-only`: **no call at
 *   all** (`docs/06` §3.5 — a stub summary, never an LLM call).
 *
 * **Tokens.** Input per call = the prompt's own overhead (system prompt,
 * scaffold, serialized schema — the caller measures it from the real templates
 * with `estTokens(…, modelId)`, so calibrated, and passes
 * {@link PromptOverheadTokens}) plus the text's
 * `estTokens` with the model's calibration (`P3-T13`). The **raw** figure is
 * what `docs/06` §5.4's worked example states; the **budgeted** figure applies
 * D-06-5's {@link ESTIMATE_HEADROOM} (1.15×) and is the one that is priced and
 * reserved. Output per call is §5.2's `max_tokens` ceiling, never its typical
 * fill: an estimate may over-quote, never under-quote.
 *
 * **Dollars** come from `src/llm/shared/pricing.ts`'s `costOf`, call by call,
 * so a long prompt that crosses a price tier is priced at that tier. Money
 * stays fractional US dollars (`plan/00` §6 item 252); the cent preferences are
 * compared only through `costAboveCents`. A model with no known price gives an
 * `undefined` cost, never `0`.
 *
 * **Two plans.** The selected one, and the abstract-only downgrade (the same
 * items in `never` mode), which the dialog offers as "use abstracts instead"
 * and pre-selects — never silently applies — above
 * `summary.fullTextAutoMaxPapers` in `auto` mode (`docs/06` §5.4).
 */

import type { PipelineEstimate } from "../types";
import type { AcquiredSource } from "../../model/summary";
import {
  costAboveCents,
  costOf,
  type ModelPrices,
} from "../../llm/shared/pricing";
import { estTokens } from "../../llm/shared/tokenEstimate";

import type { FullTextMode, InputScopeKind } from "./privacyPolicy";

// ===========================================================================
// 1. The numbers this estimate is made of
// ===========================================================================

/**
 * D-06-5 (`docs/06` §5.1): every token estimate is multiplied by 1.15 before
 * budgeting. Applied after `estTokens`' per-model calibration. `docs/03`
 * §10.2's "20 %" is not used: `docs/06` owns the budget model, and `P3-T13`'s
 * note in `docs/03` §10.2 already names this factor (`docs/07` §4.3's
 * `BudgetGuard` note, 2026-10-23).
 */
export const ESTIMATE_HEADROOM = 1.15;

/** DR-1 condition 3: full text is worth sending at three times the abstract. */
export const FULL_TEXT_MIN_RATIO = 3;

/** `docs/06` §5.3 step 4: overlap carried between adjacent chunks. */
export const CHUNK_OVERLAP_TOKENS = 250;

/** The map-phase prompts of `docs/06` §5.2 (the synthesis ones are Phase 4's). */
export type MapCallKind =
  | "PAPER_SUMMARY_ABSTRACT"
  | "PAPER_SUMMARY_FULLTEXT"
  | "CHUNK_MAP"
  | "CHUNK_REDUCE";

/** One row of `docs/06` §5.2's table. */
export interface CallBudget {
  /** "Input chunk budget": the text the call may carry. */
  readonly inputTokens: number;
  /** "`max_tokens` out": the output ceiling the call is sent with. */
  readonly maxOutputTokens: number;
}

/**
 * `docs/06` §5.2's per-call budgets for the four map-phase prompts,
 * transcribed (a test reads the table from the document).
 */
export const MAP_CALL_BUDGETS: Readonly<Record<MapCallKind, CallBudget>> =
  Object.freeze({
    PAPER_SUMMARY_ABSTRACT: { inputTokens: 2_000, maxOutputTokens: 1_200 },
    PAPER_SUMMARY_FULLTEXT: { inputTokens: 24_000, maxOutputTokens: 1_600 },
    CHUNK_MAP: { inputTokens: 6_000, maxOutputTokens: 900 },
    CHUNK_REDUCE: { inputTokens: 12_000, maxOutputTokens: 1_600 },
  });

/**
 * Each prompt's own tokens — system prompt, scaffold, serialized schema —
 * without the paper's text. Measured by the caller from the templates it will
 * send (`estTokens` over the rendered prompt with empty text), because the
 * templates are `P3-T24`'s and the estimate must price what is sent.
 */
export type PromptOverheadTokens = Readonly<Record<MapCallKind, number>>;

// ===========================================================================
// 2. Inputs and results
// ===========================================================================

/** One item to estimate. */
export interface EstimateItem {
  /** The item's work key; carried through for the dialog and the tests. */
  readonly workKey: string;
  /** What acquisition found (`docs/06` §3.6): its tier, abstract and text. */
  readonly source: Pick<AcquiredSource, "tier" | "abstract" | "text">;
  /** A cache hit: already summarized, no call (`docs/07` §12.3 `CacheProbe`). */
  readonly cached: boolean;
}

/** One call the plan would make. */
export interface PlannedCall {
  readonly kind: MapCallKind;
  /** Overhead plus text, before headroom. */
  readonly rawInputTokens: number;
  /** `rawInputTokens` × {@link ESTIMATE_HEADROOM}, rounded up. */
  readonly inputTokens: number;
  /** The call's output ceiling (§5.2). */
  readonly outputTokens: number;
}

/** One item's plan. */
export interface ItemPlan {
  readonly workKey: string;
  readonly cached: boolean;
  /** What is sent; `metadata-only` items make no call. */
  readonly scope: InputScopeKind;
  /** Whether a full text was split into chunks. */
  readonly chunked: boolean;
  readonly calls: readonly PlannedCall[];
}

/** Totals over a plan's items. */
export interface PlanCounts {
  readonly items: number;
  readonly cached: number;
  readonly fullText: number;
  readonly abstractOnly: number;
  readonly metadataOnly: number;
  readonly chunked: number;
}

/** One way of running the job, priced. */
export interface RunPlan {
  /** The full-text mode this plan applies. */
  readonly fullTextMode: FullTextMode;
  readonly items: readonly ItemPlan[];
  readonly counts: PlanCounts;
  readonly calls: number;
  /** The worked-example figure: overhead plus text, no headroom. */
  readonly rawInputTokens: number;
  /** What is priced and reserved: raw × 1.15 per call, rounded up. */
  readonly inputTokens: number;
  /** The sum of the calls' output ceilings. */
  readonly outputTokens: number;
  /** Fractional US dollars; `undefined` when the model's price is not known. */
  readonly costUsd: number | undefined;
}

/** What {@link estimateRun} returns. */
export interface RunEstimate {
  readonly modelId: string;
  /** The plan for the requested mode. */
  readonly selected: RunPlan;
  /** The same items with full text off: the one-click downgrade. */
  readonly abstractOnly: RunPlan;
  /**
   * `auto` mode, the selected plan sends some full text, and the run has more
   * items than `summary.fullTextAutoMaxPapers`: the dialog pre-selects the
   * downgrade. It never applies it on its own.
   */
  readonly preselectDowngrade: boolean;
  /** The prices' date, shown beside every cost; `undefined` with no price. */
  readonly pricesAsOfEpochMs: number | undefined;
  /** Every cost here is an estimate (`docs/10` FR-24). */
  readonly isEstimate: true;
}

/** What {@link estimateRun} is given. */
export interface EstimateRunInput {
  readonly items: readonly EstimateItem[];
  /** The run's mode after the privacy policy (`allowedInputScope`). */
  readonly fullTextMode: FullTextMode;
  readonly modelId: string;
  /** The model's prices (catalogue, user override or bundled table). */
  readonly prices: ModelPrices | undefined;
  readonly overhead: PromptOverheadTokens;
  /** `summary.fullTextAutoMaxPapers`. */
  readonly fullTextAutoMaxPapers: number;
  /** When the run would start, for a promotion's end date (`costOf`). */
  readonly atEpochMs: number;
  /**
   * The token counter. Default: `estTokens(text, modelId)`, the heuristic
   * with the model's stored calibration (`P3-T13`).
   */
  readonly countTokens?: (text: string) => number;
}

// ===========================================================================
// 3. Planning
// ===========================================================================

/** `raw` × {@link ESTIMATE_HEADROOM}, rounded up; the epsilon absorbs float noise. */
export function withHeadroom(raw: number): number {
  return raw <= 0 ? 0 : Math.ceil(raw * ESTIMATE_HEADROOM - 1e-9);
}

function call(kind: MapCallKind, rawInputTokens: number): PlannedCall {
  return {
    kind,
    rawInputTokens,
    inputTokens: withHeadroom(rawInputTokens),
    outputTokens: MAP_CALL_BUDGETS[kind].maxOutputTokens,
  };
}

function hasText(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}

/**
 * The calls one full text needs: one single-shot call within
 * `PAPER_SUMMARY_FULLTEXT`'s budget, else `CHUNK_MAP` calls of at most 6 000
 * tokens overlapping by 250, then one `CHUNK_REDUCE` over their outputs.
 */
function fullTextCalls(
  textTokens: number,
  overhead: PromptOverheadTokens,
): { readonly calls: PlannedCall[]; readonly chunked: boolean } {
  const single = MAP_CALL_BUDGETS.PAPER_SUMMARY_FULLTEXT.inputTokens;
  if (textTokens <= single) {
    return {
      calls: [
        call(
          "PAPER_SUMMARY_FULLTEXT",
          overhead.PAPER_SUMMARY_FULLTEXT + textTokens,
        ),
      ],
      chunked: false,
    };
  }
  const chunk = MAP_CALL_BUDGETS.CHUNK_MAP.inputTokens;
  const stride = chunk - CHUNK_OVERLAP_TOKENS;
  const chunks = Math.max(
    1,
    Math.ceil((textTokens - CHUNK_OVERLAP_TOKENS) / stride),
  );
  const calls: PlannedCall[] = [];
  let left = textTokens + (chunks - 1) * CHUNK_OVERLAP_TOKENS;
  for (let i = 0; i < chunks; i += 1) {
    const body = Math.min(chunk, left);
    left -= body;
    calls.push(call("CHUNK_MAP", overhead.CHUNK_MAP + body));
  }
  const reduceBody = Math.min(
    MAP_CALL_BUDGETS.CHUNK_REDUCE.inputTokens,
    chunks * MAP_CALL_BUDGETS.CHUNK_MAP.maxOutputTokens,
  );
  calls.push(call("CHUNK_REDUCE", overhead.CHUNK_REDUCE + reduceBody));
  return { calls, chunked: true };
}

/**
 * One item's plan under one mode (DR-1).
 *
 * @param item - the item
 * @param mode - the mode after the privacy policy
 * @param overhead - the prompts' own tokens
 * @param count - the token counter
 * @returns the plan
 */
export function planItem(
  item: EstimateItem,
  mode: FullTextMode,
  overhead: PromptOverheadTokens,
  count: (text: string) => number,
): ItemPlan {
  const { source } = item;
  const fullTextTier =
    source.tier === "fulltext_pdf" || source.tier === "fulltext_epmc";
  const abstract = hasText(source.abstract) ? source.abstract : undefined;
  const base = { workKey: item.workKey, cached: item.cached };

  if (fullTextTier && mode !== "never" && hasText(source.text)) {
    const textTokens = count(source.text);
    const abstractTokens = abstract === undefined ? 0 : count(abstract);
    const worthIt =
      mode === "always" || textTokens >= FULL_TEXT_MIN_RATIO * abstractTokens;
    if (worthIt) {
      const { calls, chunked } = fullTextCalls(textTokens, overhead);
      return {
        ...base,
        scope: "abstract+fulltext",
        chunked,
        calls: item.cached ? [] : calls,
      };
    }
  }
  if (abstract !== undefined) {
    return {
      ...base,
      scope: "abstract",
      chunked: false,
      calls: item.cached
        ? []
        : [
            call(
              "PAPER_SUMMARY_ABSTRACT",
              overhead.PAPER_SUMMARY_ABSTRACT + count(abstract),
            ),
          ],
    };
  }
  return { ...base, scope: "metadata-only", chunked: false, calls: [] };
}

function planRun(
  input: EstimateRunInput,
  mode: FullTextMode,
  count: (text: string) => number,
): RunPlan {
  const items = input.items.map((item) =>
    planItem(item, mode, input.overhead, count),
  );
  let calls = 0;
  let rawInputTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | undefined = input.prices === undefined ? undefined : 0;
  const counts = {
    items: items.length,
    cached: 0,
    fullText: 0,
    abstractOnly: 0,
    metadataOnly: 0,
    chunked: 0,
  };
  for (const item of items) {
    if (item.cached) counts.cached += 1;
    else if (item.scope === "abstract+fulltext") counts.fullText += 1;
    else if (item.scope === "abstract") counts.abstractOnly += 1;
    else counts.metadataOnly += 1;
    if (item.chunked && !item.cached) counts.chunked += 1;
    for (const planned of item.calls) {
      calls += 1;
      rawInputTokens += planned.rawInputTokens;
      inputTokens += planned.inputTokens;
      outputTokens += planned.outputTokens;
      if (costUsd !== undefined && input.prices !== undefined) {
        const cost = costOf(
          input.prices,
          {
            inputTokens: planned.inputTokens,
            outputTokens: planned.outputTokens,
          },
          input.atEpochMs,
        ).costUsd;
        costUsd = cost === undefined ? undefined : costUsd + cost;
      }
    }
  }
  return {
    fullTextMode: mode,
    items,
    counts,
    calls,
    rawInputTokens,
    inputTokens,
    outputTokens,
    costUsd,
  };
}

/**
 * `P3-T16` step 1: the selected plan and the abstract-only downgrade, priced.
 *
 * @param input - see {@link EstimateRunInput}
 * @returns both plans, and whether the dialog pre-selects the downgrade
 */
export function estimateRun(input: EstimateRunInput): RunEstimate {
  const count =
    input.countTokens ?? ((text: string) => estTokens(text, input.modelId));
  const selected = planRun(input, input.fullTextMode, count);
  const abstractOnly =
    input.fullTextMode === "never" ? selected : planRun(input, "never", count);
  return {
    modelId: input.modelId,
    selected,
    abstractOnly,
    preselectDowngrade:
      input.fullTextMode === "auto" &&
      selected.counts.fullText > 0 &&
      input.items.length > input.fullTextAutoMaxPapers,
    pricesAsOfEpochMs: input.prices?.asOfEpochMs,
    isEstimate: true,
  };
}

// ===========================================================================
// 4. The confirmation gate (docs/06 §5.4; docs/10 FR-24)
// ===========================================================================

/** Why the confirm button needs a second, explicit acknowledgement. */
export type SecondAcknowledgementReason = "above-threshold" | "unknown-cost";

/**
 * Whether confirming `plan` needs FR-24's second acknowledgement: its cost is
 * above `summary.confirmAboveCents`, or its cost cannot be known (no price) —
 * an unknown cost is never treated as a small one. A plan that makes no call
 * needs none.
 *
 * @param plan - the plan the user would run
 * @param confirmAboveCents - `summary.confirmAboveCents`, whole cents
 * @returns the reason, or `undefined` when one click is enough
 */
export function secondAcknowledgementFor(
  plan: Pick<RunPlan, "calls" | "costUsd">,
  confirmAboveCents: number,
): SecondAcknowledgementReason | undefined {
  if (plan.calls === 0) return undefined;
  if (plan.costUsd === undefined) return "unknown-cost";
  return costAboveCents(plan.costUsd, confirmAboveCents)
    ? "above-threshold"
    : undefined;
}

/**
 * `docs/07` §4.5's `PipelineEstimate` for a plan: the shape `Pipeline.estimate`
 * returns. The duration is the calls at `callsPerMinute`, which the caller
 * derives from the `llm` pool's concurrency and the host's rate limit.
 *
 * @param plan - the plan
 * @param callsPerMinute - the expected dispatch rate, > 0
 * @param notesKeys - Fluent ids of notes to show beside the estimate
 * @returns the estimate
 */
export function toPipelineEstimate(
  plan: RunPlan,
  callsPerMinute: number,
  notesKeys: readonly string[] = [],
): PipelineEstimate {
  if (!Number.isFinite(callsPerMinute) || callsPerMinute <= 0) {
    throw new RangeError(
      `[research-helper] callsPerMinute must be a positive number, got ${String(callsPerMinute)}`,
    );
  }
  return {
    itemCount: plan.counts.items,
    externalRequests: plan.calls,
    estimatedInputTokens: plan.inputTokens,
    estimatedOutputTokens: plan.outputTokens,
    estimatedCostUsd: plan.costUsd,
    estimatedDurationSeconds: Math.ceil((plan.calls / callsPerMinute) * 60),
    notesKeys,
  };
}
