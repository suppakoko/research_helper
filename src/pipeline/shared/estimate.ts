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
 * phase — one paper's summary per item — in {@link estimateRun}; the trend
 * report's synthesis calls, on top of the summaries it still has to make, in
 * {@link estimateReportRun} (`P4-T16`, section 5 below).
 *
 * - An item already summarized (a cache hit) costs nothing and is counted as
 *   cached.
 * - DR-1 decides the scope per item: full text in `always` mode whenever there
 *   is any; in `auto` mode only when it is at least
 *   {@link FULL_TEXT_MIN_RATIO} times the abstract's tokens; never in `never`
 *   mode. The `fullTextMode` passed in is the one **after** the privacy policy
 *   (`allowedInputScope`, which forces `never` in strict mode).
 * - A full text the chunker plans as one call (`planChunks`,
 *   `src/llm/shared/chunking.ts`, `P3-T23`) is one `PAPER_SUMMARY_FULLTEXT`
 *   call; a longer one is the `CHUNK_MAP` calls the chunker would plan, then
 *   one `CHUNK_REDUCE` over their outputs — exactly the plan's chunks when the
 *   item carries its sections, the chunker's worst case when it does not
 *   (section 3, {@link planItem}; owner, `plan/00` §6 item 299(b), `docs/06`
 *   §5.4).
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
import type { ReportLanguage, TrendPromptId } from "../../model/trend";
import {
  costAboveCents,
  costOf,
  type ModelPrices,
} from "../../llm/shared/pricing";
import {
  CHUNK_OVERLAP_TOKENS,
  ESTIMATE_HEADROOM,
  MAP_CALL_BUDGETS,
  planChunks,
  type CallBudget,
  type ChunkModel,
  type MapCallKind,
} from "../../llm/shared/chunking";
import { estTokens } from "../../llm/shared/tokenEstimate";
import {
  resolveMaxTokens,
  type PromptRegistry,
  type PromptTemplate,
} from "../../prompts";

import type { FullTextMode, InputScopeKind } from "./privacyPolicy";

// ===========================================================================
// 1. The numbers this estimate is made of
// ===========================================================================

/**
 * D-06-5's 1.15× headroom, §5.3's 250-token overlap and §5.2's per-call
 * budgets are defined once, in the chunker (`src/llm/shared/chunking.ts`), so
 * the plan and its price use one budget (owner, `plan/00` §6 item 299(b)).
 * Re-exported for this module's callers.
 */
export { CHUNK_OVERLAP_TOKENS, ESTIMATE_HEADROOM, MAP_CALL_BUDGETS };
export type { CallBudget, MapCallKind };

/** DR-1 condition 3: full text is worth sending at three times the abstract. */
export const FULL_TEXT_MIN_RATIO = 3;

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
  /**
   * What acquisition found (`docs/06` §3.6): its tier, abstract and text,
   * and — when the caller has them — its item key, `sectionAware` and
   * `sections`. With both of the last two the estimate prices the chunker's
   * exact plan; without them, its worst case ({@link planItem}).
   */
  readonly source: Pick<AcquiredSource, "tier" | "abstract" | "text"> &
    Partial<Pick<AcquiredSource, "itemKey" | "sectionAware" | "sections">>;
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
  /**
   * The model's context window, for the chunker's §5.2 inequality (`docs/06`
   * §5.4, item 299(b)); omitted or `0` means not known, and §5.2's column
   * applies alone, as in `planChunks`.
   */
  readonly contextWindowTokens?: number;
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
 * The calls one full text needs, as the chunker would plan them (`planChunks`,
 * `docs/06` §5.3; owner, `plan/00` §6 item 299(b), recorded in `docs/06`
 * §5.4).
 *
 * - **Single-shot** — one `PAPER_SUMMARY_FULLTEXT` call carrying the text.
 * - **Sections known** (the item carries `sectionAware` and `sections`) —
 *   exactly the plan's chunks: one `CHUNK_MAP` call each, carrying its label
 *   and its chunk, overlap included.
 * - **Sections not known** — the chunker's worst case for this text: the
 *   section-aware path with every section starting its own chunk, so
 *   `maxChunks` (13) `CHUNK_MAP` calls. Between them they carry at most what
 *   13 chunks hold, and at most the text plus every overlap plus one token of
 *   rounding per chunk (a section boundary splits at most one unit, and each
 *   unit's estimate is rounded up). That is never below the flat path's count
 *   or tokens, and never above what can be sent.
 *
 * Then one `CHUNK_REDUCE` over the map outputs, each at its `max_tokens`.
 */
function fullTextCalls(
  source: EstimateItem["source"],
  itemKey: string,
  overhead: PromptOverheadTokens,
  count: (text: string) => number,
  model: ChunkModel,
): { readonly calls: PlannedCall[]; readonly chunked: boolean } {
  const known =
    source.sectionAware !== undefined && source.sections !== undefined;
  const plan = planChunks(
    {
      itemKey,
      abstract: source.abstract,
      text: source.text,
      sectionAware: known ? (source.sectionAware as boolean) : false,
      sections: known ? (source.sections ?? []) : [],
    },
    model,
    "PAPER_SUMMARY_FULLTEXT",
    { overhead, countTokens: count },
  );
  if (plan.kind === "single-shot") {
    return {
      calls: [
        call(
          "PAPER_SUMMARY_FULLTEXT",
          overhead.PAPER_SUMMARY_FULLTEXT + plan.textTokens,
        ),
      ],
      chunked: false,
    };
  }
  const calls: PlannedCall[] = [];
  if (known) {
    for (const chunk of plan.chunks) {
      calls.push(
        call(
          "CHUNK_MAP",
          overhead.CHUNK_MAP + count(chunk.label) + chunk.tokens,
        ),
      );
    }
  } else {
    const n = plan.maxChunks;
    const flatContent = plan.chunks.reduce(
      (sum, chunk) => sum + chunk.tokens - chunk.overlapTokens,
      0,
    );
    const total = Math.min(
      n * plan.chunkBudgetTokens,
      Math.max(plan.textTokens, flatContent) +
        n +
        (n - 1) * CHUNK_OVERLAP_TOKENS,
    );
    for (let i = 0; i < n; i += 1) {
      const body = Math.floor(total / n) + (i < total % n ? 1 : 0);
      calls.push(
        call("CHUNK_MAP", overhead.CHUNK_MAP + plan.labelReserveTokens + body),
      );
    }
  }
  const reduceBody = Math.min(
    MAP_CALL_BUDGETS.CHUNK_REDUCE.inputTokens,
    calls.length * MAP_CALL_BUDGETS.CHUNK_MAP.maxOutputTokens,
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
 * @param model - the map model's id and context window, for the chunker's
 *   §5.2 inequality; an unknown window applies §5.2's column alone
 * @returns the plan
 */
export function planItem(
  item: EstimateItem,
  mode: FullTextMode,
  overhead: PromptOverheadTokens,
  count: (text: string) => number,
  model: ChunkModel = { id: "", contextWindowTokens: undefined },
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
      const { calls, chunked } = fullTextCalls(
        source,
        source.itemKey ?? item.workKey,
        overhead,
        count,
        model,
      );
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
    planItem(item, mode, input.overhead, count, {
      id: input.modelId,
      contextWindowTokens: input.contextWindowTokens,
    }),
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

// ===========================================================================
// 5. The trend report: the summaries still to make, plus every synthesis call
//    (P4-T16; docs/06 §5.2, §5.4, §8.3–§8.5, §9.2, §12.2)
// ===========================================================================

/**
 * The synthesis prompts a report run calls: `docs/06` §5.2's rows after the
 * map phase, which are `docs/07` §5.2's `TrendPromptId`.
 */
export type SynthesisCallKind = TrendPromptId;

/**
 * `docs/06` §5.2's "Input chunk budget" for each synthesis prompt, transcribed
 * (a test reads the table from the document). The pipeline keeps every call
 * inside its row — clustering hands over to two stages, a theme is split, the
 * report's digests are trimmed, the critique's evidence is packed (`P4-T05`
 * to `P4-T09`) — so the budget is an upper bound on what one call carries, and
 * that bound is what is priced: before the run, the summaries the calls will
 * carry do not all exist. The output ceilings are not repeated here; they are
 * the prompt files' own (`resolveMaxTokens`), so `THEME_CLUSTER`'s grows with
 * the papers it clusters (`P4-T03`).
 */
export const SYNTHESIS_INPUT_BUDGETS: Readonly<
  Record<SynthesisCallKind, number>
> = Object.freeze({
  THEME_CLUSTER: 60_000,
  THEME_MERGE: 60_000,
  CLUSTER_REDUCE: 40_000,
  CLUSTER_REDUCE_MERGE: 40_000,
  TREND_REPORT_EN: 60_000,
  TREND_REPORT_KO: 60_000,
  SELF_CRITIQUE: 60_000,
});

/** `docs/06` §8.4 step 1: two-stage clustering's batch size `B`. */
export const CLUSTER_BATCH_SIZE = 60;

/**
 * `docs/06` §8.4 step 1's `B` for one model (`P4-T06`; `docs/06` §8.4's note of
 * 2026-10-29): {@link CLUSTER_BATCH_SIZE}, or the largest smaller batch size
 * whose `THEME_CLUSTER` ceiling (`resolveMaxTokens`) is within the model's
 * output limit, because a 60-paper batch's 4 400 tokens may not be
 * (`plan/reports/P4-T16.md` finding 6). At least 1: when not even one paper's
 * ceiling fits, the plan prices one paper per batch (an over-quote) and the
 * run refuses before any request (`clusterThemesTwoStage`). The run and
 * {@link planSynthesis} both call this, so they make the same number of
 * batches.
 *
 * @param prompt - the active `THEME_CLUSTER` template
 * @param outputLimit - the report model's `ModelInfo.maxOutputTokens`
 * @returns a whole number from 1 to {@link CLUSTER_BATCH_SIZE}
 */
export function clusterBatchSize(
  prompt: PromptTemplate,
  outputLimit: number,
): number {
  for (let size = CLUSTER_BATCH_SIZE; size > 1; size -= 1) {
    if (resolveMaxTokens(prompt, size) <= outputLimit) return size;
  }
  return 1;
}

/**
 * The most tokens one digest takes: `docs/06` §8.2's ~90–140-token block,
 * which `P4-T04`'s fixed truncation caps at 140 by `estTokens`. Used only to
 * decide whether the digests fit one `THEME_CLUSTER` call.
 */
export const DIGEST_MAX_TOKENS = 140;

/**
 * The most tokens one summary takes as synthesis sends it: the largest map
 * call's output ceiling, 1 600 (`docs/06` §5.2; §8.1 puts a serialized summary
 * at "900–1 600 tokens"). Used only to make sure the theme calls reserved can
 * carry every summary.
 */
export const SUMMARY_MAX_TOKENS = Math.max(
  ...Object.values(MAP_CALL_BUDGETS).map((budget) => budget.maxOutputTokens),
);

/** One row of `docs/06` §9.2's length table: corpus size → themes (K). */
export interface ThemeCountBand {
  readonly minPapers: number;
  readonly maxPapers: number;
  readonly minThemes: number;
  readonly maxThemes: number;
}

/** `docs/06` §9.2's "Themes (K)" column, transcribed (a test reads the table). */
export const THEME_COUNT_BANDS: readonly ThemeCountBand[] = Object.freeze([
  { minPapers: 10, maxPapers: 25, minThemes: 3, maxThemes: 5 },
  { minPapers: 26, maxPapers: 75, minThemes: 4, maxThemes: 7 },
  { minPapers: 76, maxPapers: 150, minThemes: 6, maxThemes: 9 },
  { minPapers: 151, maxPapers: 400, minThemes: 7, maxThemes: 12 },
]);

/**
 * The §9.2 row for `papers`. The table starts at 10 and stops at 400; a
 * smaller corpus reads its first row and a larger one its last.
 *
 * @param papers - the papers the report analyses
 * @returns the row
 */
export function themeCountBandFor(papers: number): ThemeCountBand {
  const last = THEME_COUNT_BANDS[
    THEME_COUNT_BANDS.length - 1
  ] as ThemeCountBand;
  return THEME_COUNT_BANDS.find((band) => papers <= band.maxPapers) ?? last;
}

/** A model and its prices, as the cost dialog prices it (item 278(b)). */
export interface PricedModel {
  readonly modelId: string;
  /** The graph's `modelPrices` for it; `undefined` when not known. */
  readonly prices: ModelPrices | undefined;
}

/** One synthesis call the plan reserves. */
export interface SynthesisCall {
  readonly kind: SynthesisCallKind;
  /** The model it is sent to: the report model, or the critique model. */
  readonly modelId: string;
  /** The prompt's own tokens plus its input budget, before headroom. */
  readonly rawInputTokens: number;
  /** `rawInputTokens` × {@link ESTIMATE_HEADROOM}, rounded up. */
  readonly inputTokens: number;
  /** The prompt's `max_tokens` ceiling (`resolveMaxTokens`). */
  readonly outputTokens: number;
  /**
   * Made only when an earlier answer asks for it — a rewrite after a
   * critique, a later critique round, a sub-batch of a theme too large for
   * one call and its merge — and reserved all the same.
   */
  readonly conditional: boolean;
  /** The report a composition or critique call is for. */
  readonly language?: ReportLanguage;
}

/** Every synthesis call of one report run, in the order the stages run. */
export interface SynthesisPlan {
  /** The papers the synthesis covers (each sends one summary). */
  readonly papers: number;
  /**
   * K, the themes the model may make: the run's own, or §9.2's upper end.
   * With the latter one more theme analysis is reserved beyond K for the
   * client-generated `Other` theme ({@link OTHER_THEME_RESERVE}).
   */
  readonly themes: number;
  /** Whether the digests take `docs/06` §8.4's two-stage path. */
  readonly twoStageClustering: boolean;
  readonly calls: readonly SynthesisCall[];
}

/** What {@link planSynthesis} is given. */
export interface SynthesisPlanInput {
  /** The papers the report analyses, after screening. */
  readonly papers: number;
  /**
   * `reportModel`: every `strong`-tier call (clustering, its merge, the theme
   * analyses and their merges, the report and its rewrites). Its output limit
   * (`ModelInfo.maxOutputTokens`) decides two-stage clustering (`P4-T05`).
   */
  readonly reportModel: PricedModel & { readonly maxOutputTokens: number };
  /** `report.critiqueModel`, else `summaryModel` (`P4-T09` step 3). */
  readonly critiqueModel: PricedModel;
  /** The active templates, for their output ceilings. */
  readonly prompts: Pick<PromptRegistry, "get">;
  /**
   * Each synthesis prompt's own tokens (system prompt, scaffold, serialized
   * schema) without its variable text, measured by the caller with
   * `estTokens(…, modelId)` over the template it will send, as
   * {@link PromptOverheadTokens} is for the map phase.
   */
  readonly synthesisOverhead: Readonly<Record<SynthesisCallKind, number>>;
  /** One per report written: `["en"]`, `["ko"]`, or both for `both`. */
  readonly languages: readonly ReportLanguage[];
  /** `report.maxCritiqueRounds`, 0–2. */
  readonly critiqueRounds: number;
  /**
   * K when the run already knows it (a clustering read back on resume, a
   * test) — the finished clustering's count, `Other` included; absent: the
   * upper end of `papers`' §9.2 band, plus {@link OTHER_THEME_RESERVE}.
   */
  readonly themeCount?: number;
}

function wholeNumber(name: string, value: number, min: number): number {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(
      `[research-helper] ${name} must be an integer of at least ${String(min)}, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * The theme analyses reserved for the client-generated `Other` theme beyond
 * §9.2's upper K: `P4-T05` adds it after counting the model's themes against
 * `MAX_THEMES`, so a clustering can hold `MAX_THEMES` + 1 themes (owner,
 * `plan/00` §6 item 307(b); `docs/07` §4.5's note of 2026-10-29).
 */
export const OTHER_THEME_RESERVE = 1;

/** The theme stage's reservation for one theme count. */
interface ThemeStage {
  /** `CLUSTER_REDUCE` calls: one per theme, or enough to carry every summary. */
  readonly reduceCalls: number;
  /** `CLUSTER_REDUCE_MERGE` calls: one per theme that could split. */
  readonly merges: number;
}

/**
 * `docs/06` §8.4's theme stage for `themes` themes when carrying every
 * summary takes `neededCalls` calls: at least one call per theme, and one
 * merge per theme that could split — no more than the themes, nor than the
 * calls beyond one per theme.
 */
function themeStage(themes: number, neededCalls: number): ThemeStage {
  const reduceCalls = Math.max(themes, neededCalls);
  return { reduceCalls, merges: Math.min(themes, reduceCalls - themes) };
}

/** The larger count of each kind, so neither theme count is under-stated. */
function largerThemeStage(a: ThemeStage, b: ThemeStage): ThemeStage {
  return {
    reduceCalls: Math.max(a.reduceCalls, b.reduceCalls),
    merges: Math.max(a.merges, b.merges),
  };
}

function synthesisCall(
  kind: SynthesisCallKind,
  model: PricedModel,
  input: SynthesisPlanInput,
  options: {
    readonly batchSize?: number;
    readonly conditional?: boolean;
    readonly language?: ReportLanguage;
  } = {},
): SynthesisCall {
  const rawInputTokens =
    input.synthesisOverhead[kind] + SYNTHESIS_INPUT_BUDGETS[kind];
  const planned: SynthesisCall = {
    kind,
    modelId: model.modelId,
    rawInputTokens,
    inputTokens: withHeadroom(rawInputTokens),
    outputTokens: resolveMaxTokens(input.prompts.get(kind), options.batchSize),
    conditional: options.conditional ?? false,
  };
  return options.language === undefined
    ? planned
    : { ...planned, language: options.language };
}

/**
 * Every synthesis call a report run may make, each at its §5.2 input budget
 * and its prompt's output ceiling (`P4-T16` steps 1–2):
 *
 * - **L1, clustering.** One `THEME_CLUSTER` call when the digests fit its
 *   input budget **and** its grown output ceiling for this many papers is
 *   within the report model's output limit — `P4-T05` step 1's rule, never a
 *   paper count. The digests are taken at {@link DIGEST_MAX_TOKENS} each with
 *   the 1.15× headroom, so near the line the estimate takes the dearer path.
 *   Otherwise `docs/06` §8.4's two stages: one call per batch of
 *   {@link clusterBatchSize} papers, each at its own batch's ceiling, then one
 *   `THEME_MERGE`.
 * - **L2, themes.** One `CLUSTER_REDUCE` per theme, K from the run or the
 *   upper end of §9.2's band. When K calls at the 40 000-token budget could
 *   not carry every summary at {@link SUMMARY_MAX_TOKENS} (with headroom, and
 *   one summary's room lost per call to packing), the extra sub-batch calls
 *   that would, plus one `CLUSTER_REDUCE_MERGE` per theme that could need
 *   splitting (at most K) — `docs/06` §8.4's last paragraph. With K from the
 *   band, one more theme is reserved for `P4-T05`'s client-generated `Other`
 *   ({@link OTHER_THEME_RESERVE}, conditional): the stage is worked out for K
 *   and for K + 1 themes and the larger count of each kind is kept, so the
 *   merges reach K + 1 where `Other` too could split (owner, `plan/00` §6
 *   item 307(b)). A K the run passes is its finished clustering's own count,
 *   `Other` included, and gets no extra theme.
 * - **L3 and L4, per report language** (`both` writes two, `P4-T21`): the
 *   report call, then per critique round one `SELF_CRITIQUE` on the critique
 *   model and one possible rewrite (a fresh report call, `docs/06` §12.2).
 *
 * Not reserved, because no estimate can predict them: a call that follows a
 * malformed answer (`completeJSON`'s repair and retry; `P4-T05`'s re-run; the
 * one fresh generation for a missing heading, `P4-T08`) and the per-section
 * critique calls of an overflowing cited set (`P4-T09` step 4). Each is
 * reserved at dispatch by `withBudget`, so a ceiling it would pass pauses the
 * job and asks (`plan/07` §0.2 items 11, 12 and 18).
 *
 * @param input - see {@link SynthesisPlanInput}
 * @returns the plan; no call at all for zero papers
 * @throws RangeError for a count that is not a whole number, or no language
 */
export function planSynthesis(input: SynthesisPlanInput): SynthesisPlan {
  const papers = wholeNumber("papers", input.papers, 0);
  const rounds = wholeNumber("critiqueRounds", input.critiqueRounds, 0);
  if (
    input.languages.length === 0 ||
    new Set(input.languages).size !== input.languages.length
  ) {
    throw new RangeError(
      "[research-helper] a report run writes one report per language: at least one, each once",
    );
  }
  if (papers === 0) {
    return { papers, themes: 0, twoStageClustering: false, calls: [] };
  }
  const report = input.reportModel;
  const calls: SynthesisCall[] = [];

  // L1 — clustering (docs/06 §8.4; P4-T05 step 1, P4-T06).
  const twoStageClustering =
    withHeadroom(papers * DIGEST_MAX_TOKENS) >
      SYNTHESIS_INPUT_BUDGETS.THEME_CLUSTER ||
    resolveMaxTokens(input.prompts.get("THEME_CLUSTER"), papers) >
      report.maxOutputTokens;
  if (twoStageClustering) {
    // P4-T06: the run's own B, so a small output limit is priced as it runs.
    const batchSize = clusterBatchSize(
      input.prompts.get("THEME_CLUSTER"),
      report.maxOutputTokens,
    );
    for (let start = 0; start < papers; start += batchSize) {
      calls.push(
        synthesisCall("THEME_CLUSTER", report, input, {
          batchSize: Math.min(batchSize, papers - start),
        }),
      );
    }
    calls.push(synthesisCall("THEME_MERGE", report, input));
  } else {
    calls.push(
      synthesisCall("THEME_CLUSTER", report, input, { batchSize: papers }),
    );
  }

  // L2 — one analysis per theme, and room for every summary (docs/06 §8.4).
  const themes =
    input.themeCount === undefined
      ? themeCountBandFor(papers).maxThemes
      : wholeNumber("themeCount", input.themeCount, 1);
  const carriedPerCall =
    SYNTHESIS_INPUT_BUDGETS.CLUSTER_REDUCE - SUMMARY_MAX_TOKENS;
  const neededCalls = Math.ceil(
    withHeadroom(papers * SUMMARY_MAX_TOKENS) / carriedPerCall,
  );
  // Owner, plan/00 §6 item 307(b): P4-T05's client-generated `Other` theme can
  // make MAX_THEMES + 1 themes, so a K from the band reserves for both counts
  // and keeps the larger of each; a K the run passes already counts `Other`.
  const bare = themeStage(themes, neededCalls);
  const stage =
    input.themeCount === undefined
      ? largerThemeStage(
          bare,
          themeStage(themes + OTHER_THEME_RESERVE, neededCalls),
        )
      : bare;
  const reduceCalls = stage.reduceCalls;
  for (let at = 0; at < reduceCalls; at += 1) {
    calls.push(
      synthesisCall("CLUSTER_REDUCE", report, input, {
        conditional: at >= themes,
      }),
    );
  }
  const merges = stage.merges;
  for (let at = 0; at < merges; at += 1) {
    calls.push(
      synthesisCall("CLUSTER_REDUCE_MERGE", report, input, {
        conditional: true,
      }),
    );
  }

  // L3 and L4 — per language: the report, then critique and rewrite rounds.
  for (const language of input.languages) {
    const kind = language === "ko" ? "TREND_REPORT_KO" : "TREND_REPORT_EN";
    calls.push(synthesisCall(kind, report, input, { language }));
    for (let round = 1; round <= rounds; round += 1) {
      calls.push(
        synthesisCall("SELF_CRITIQUE", input.critiqueModel, input, {
          conditional: round > 1,
          language,
        }),
      );
      calls.push(
        synthesisCall(kind, report, input, { conditional: true, language }),
      );
    }
  }
  return { papers, themes, twoStageClustering, calls };
}

/** One way of running the report, priced: the map phase plus the synthesis. */
export interface ReportPlan extends RunPlan {
  /** The summaries still to make, at the map model's prices. */
  readonly map: RunPlan;
  /** The same for both plans: the synthesis does not depend on the map's mode. */
  readonly synthesis: SynthesisPlan;
  /**
   * Every model with a call in this plan whose price is not known, in the
   * order map, report, critique. Not empty exactly when `costUsd` is
   * `undefined`.
   */
  readonly unpricedModelIds: readonly string[];
}

/** The three models one report run can send to (`plan/07` `P4-T16` step 2). */
export interface ReportRunModels {
  /** `summaryModel`: the summaries still to make. */
  readonly map: string;
  /** `reportModel`: every synthesis call but the critique. */
  readonly report: string;
  /** `report.critiqueModel`, else `summaryModel`. */
  readonly critique: string;
}

/** What {@link estimateReportRun} returns: a {@link RunEstimate}, for a report. */
export interface ReportRunEstimate extends RunEstimate {
  /** The report model; all three are in {@link ReportRunEstimate.models}. */
  readonly modelId: string;
  readonly selected: ReportPlan;
  readonly abstractOnly: ReportPlan;
  readonly models: ReportRunModels;
}

/** What {@link estimateReportRun} is given. */
export interface EstimateReportRunInput extends Omit<
  SynthesisPlanInput,
  "papers"
> {
  /**
   * The papers the report analyses, after screening; `cached` means the
   * paper's summary exists, so only the others cost a map call.
   */
  readonly items: readonly EstimateItem[];
  /** The run's mode after the privacy policy (`allowedInputScope`). */
  readonly fullTextMode: FullTextMode;
  /** `summaryModel`, which makes the missing summaries. */
  readonly mapModel: PricedModel;
  /** The map prompts' own tokens, as for {@link estimateRun}. */
  readonly overhead: PromptOverheadTokens;
  /** `summary.fullTextAutoMaxPapers`. */
  readonly fullTextAutoMaxPapers: number;
  /** When the run would start, for a promotion's end date (`costOf`). */
  readonly atEpochMs: number;
  /** The map phase's token counter; `estTokens(text, mapModel)` by default. */
  readonly countTokens?: (text: string) => number;
  /** The map model's context window, as {@link EstimateRunInput}'s. */
  readonly contextWindowTokens?: number;
}

function reportPlan(
  map: RunPlan,
  synthesis: SynthesisPlan,
  input: EstimateReportRunInput,
): ReportPlan {
  const pricesOf = new Map<string, ModelPrices | undefined>([
    [input.critiqueModel.modelId, input.critiqueModel.prices],
    [input.reportModel.modelId, input.reportModel.prices],
  ]);
  const unpriced: string[] = [];
  const noteUnpriced = (modelId: string): void => {
    if (!unpriced.includes(modelId)) unpriced.push(modelId);
  };
  let { calls, rawInputTokens, inputTokens, outputTokens } = map;
  // A map phase that makes no call costs nothing, whatever its model's price.
  let costUsd: number | undefined = map.calls === 0 ? 0 : map.costUsd;
  if (map.calls > 0 && map.costUsd === undefined) {
    noteUnpriced(input.mapModel.modelId);
  }
  for (const planned of synthesis.calls) {
    calls += 1;
    rawInputTokens += planned.rawInputTokens;
    inputTokens += planned.inputTokens;
    outputTokens += planned.outputTokens;
    const prices = pricesOf.get(planned.modelId);
    const cost =
      prices === undefined
        ? undefined
        : costOf(
            prices,
            {
              inputTokens: planned.inputTokens,
              outputTokens: planned.outputTokens,
            },
            input.atEpochMs,
          ).costUsd;
    if (cost === undefined) noteUnpriced(planned.modelId);
    costUsd =
      costUsd === undefined || cost === undefined ? undefined : costUsd + cost;
  }
  return {
    fullTextMode: map.fullTextMode,
    items: map.items,
    counts: map.counts,
    calls,
    rawInputTokens,
    inputTokens,
    outputTokens,
    costUsd,
    map,
    synthesis,
    unpricedModelIds: unpriced,
  };
}

/** The oldest price date among the priced models a plan calls, or `undefined`. */
function oldestPriceDate(
  plan: ReportPlan,
  input: EstimateReportRunInput,
): number | undefined {
  const used = new Set(plan.synthesis.calls.map((c) => c.modelId));
  const dates: number[] = [];
  if (plan.map.calls > 0 && input.mapModel.prices !== undefined) {
    dates.push(input.mapModel.prices.asOfEpochMs);
  }
  for (const model of [input.reportModel, input.critiqueModel]) {
    if (used.has(model.modelId) && model.prices !== undefined) {
      dates.push(model.prices.asOfEpochMs);
    }
  }
  return dates.length === 0 ? undefined : Math.min(...dates);
}

/**
 * `P4-T16`: one estimate for a report run — the summaries it still has to
 * make (`estimateRun` at `summaryModel`'s prices, unchanged) plus every
 * synthesis call ({@link planSynthesis}), each priced through `costOf` at its
 * own model's prices (item 278(b)). An unknown price on any model the plan
 * calls makes the plan's cost unknown, never zero, so the dialog demands the
 * second acknowledgement (`secondAcknowledgementFor`). The abstract-only
 * downgrade changes only the map phase.
 *
 * The result is a {@link RunEstimate}, so the cost dialog's threshold,
 * ceilings, second acknowledgement and "don't ask again" rules apply to it
 * unchanged; the report's own lines read {@link ReportPlan.synthesis}. The
 * caller is the trend-report pipeline's estimate stage (`P4-T18`).
 *
 * @param input - see {@link EstimateReportRunInput}
 * @returns both plans, priced
 */
export function estimateReportRun(
  input: EstimateReportRunInput,
): ReportRunEstimate {
  const mapEstimate = estimateRun({
    items: input.items,
    fullTextMode: input.fullTextMode,
    modelId: input.mapModel.modelId,
    prices: input.mapModel.prices,
    overhead: input.overhead,
    fullTextAutoMaxPapers: input.fullTextAutoMaxPapers,
    atEpochMs: input.atEpochMs,
    ...(input.countTokens !== undefined && { countTokens: input.countTokens }),
    ...(input.contextWindowTokens !== undefined && {
      contextWindowTokens: input.contextWindowTokens,
    }),
  });
  const synthesis = planSynthesis({ ...input, papers: input.items.length });
  const selected = reportPlan(mapEstimate.selected, synthesis, input);
  const abstractOnly =
    mapEstimate.abstractOnly === mapEstimate.selected
      ? selected
      : reportPlan(mapEstimate.abstractOnly, synthesis, input);
  return {
    modelId: input.reportModel.modelId,
    selected,
    abstractOnly,
    preselectDowngrade: mapEstimate.preselectDowngrade,
    pricesAsOfEpochMs: oldestPriceDate(selected, input),
    isEstimate: true,
    models: {
      map: input.mapModel.modelId,
      report: input.reportModel.modelId,
      critique: input.critiqueModel.modelId,
    },
  };
}

/**
 * Whether `estimate` is a report run's ({@link estimateReportRun}).
 *
 * @param estimate - either estimate
 * @returns true for a report run's
 */
export function isReportRunEstimate(
  estimate: RunEstimate,
): estimate is ReportRunEstimate {
  return "models" in estimate && "synthesis" in estimate.selected;
}
