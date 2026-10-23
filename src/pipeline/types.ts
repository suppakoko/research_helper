/**
 * `docs/07-architecture-and-data-model.md` §4.5's pipeline contract, and the
 * one piece of arithmetic that joins it to §4.1's progress tree.
 *
 * **Scope.** `P1-T16` steps 1 and 2. Every declaration in section 1 below is
 * §4.5 transcribed — interface names, member names, types, optionality and doc
 * comments unchanged — because `plan/README.md` §5 rule 3 makes doc 07 the sole
 * authority for types. Phase 1 runs the pipeline directly, with no job queue
 * (`docs/11` §1 puts the queue in Phase 3), and §4.5's own instruction is to
 * "implement the interface even though Phase 1 runs it directly" so that the
 * queue becomes a caller rather than a rewrite.
 *
 * ## §4.5 cannot be transcribed as printed, and this is why
 *
 * `PipelineContext` names **seven** dependency types that no module in `src/`
 * declares, and four of them are named **nowhere else in the whole corpus**.
 * Measured 2026-10-07 by grep over `docs/*.md` and `src/**`:
 *
 * | type | declared in the corpus? | where it belongs (`docs/07` §2.2) |
 * |---|---|---|
 * | `Cache` | yes — §4.1, under a `// src/core/cache/cache.ts` comment (now imported, `P3-T33`) | `src/core/cache/cache.ts` |
 * | `BudgetGuard` | yes — §4.3 | `src/llm/budget.ts` |
 * | `TTSProvider` | yes — §4.4 | `src/tts/types.ts` |
 * | `LLMRouter` | **no** — one occurrence, this member (declared in §4.3 on 2026-10-21, item 248; now imported, `P3-T06`) | `src/llm/types.ts`, built by `src/llm/router.ts` |
 * | `ZoteroFacade` | **no** — one occurrence, this member | `src/zotero/zoteroApi.ts` (§3.2) |
 * | `ConfigReader` | **no** — one occurrence, this member | — nothing names one |
 * | `PrivacyPolicy` | **no** — one occurrence, this member (declared in §4.5 on 2026-10-21, item 267; now imported, `P3-T15`) | `src/pipeline/shared/privacyPolicy.ts` |
 *
 * None of those seven files is in `P1-T16`'s `Files` list, and transcribing a
 * `Cache` or a `BudgetGuard` **here** would put a `core/` declaration in
 * `pipeline/` — a parallel copy of a type doc 07 already owns, which is the
 * exact failure `plan/README.md` §5 rule 3 exists to stop.
 *
 * So each of the seven is declared below as a **forward alias to `unknown`**,
 * with the member name and the type name §4.5 wrote. That buys three things and
 * costs one:
 *
 * - the member list of {@link PipelineContext} is §4.5's, member for member and
 *   name for name, so a diff against the printed block finds no difference;
 * - `unknown` is the only type nothing can be read out of without a narrowing
 *   the author has to write, so a pipeline **cannot** quietly start depending on
 *   a service Phase 1 has not built;
 * - replacing one alias with `export type { Cache } from "../core/cache/cache"`
 *   is a one-line change for the card that ships that module, and every
 *   consumer keeps compiling.
 *
 * The cost is that `ctx.cache` is not usable until then. That is the truth of
 * the situation rather than a limitation this file introduces: Phase 1 ships no
 * cache, no budget guard, no LLM router and no privacy policy, so a context
 * that claimed to carry them would be the lie.
 *
 * **Reported, not absorbed.** `ConfigReader` has no declaration and no home
 * anywhere in the corpus, and needs a card. *(Updated 2026-10-21, `P3-T15`:
 * this sentence named `PrivacyPolicy` too; the owner declared it in §4.5,
 * `plan/00` §6 item 267, and it is now imported.)*
 *
 * **Layering.** `pipeline/` may import `core/`, `model/`, `sources/`, `llm/`,
 * `tts/` and `zotero/`, and may not import `ui/` (`docs/07` §2.3,
 * `eslint.config.js`'s `research-helper/layering/pipeline`). This file imports
 * `core/`, `sources/` and, since `P3-T06`, `llm/` (types only).
 */

import type { Cache } from "../core/cache/cache";
import type { Clock } from "../core/clock";
import type { CancellationToken } from "../core/jobQueue/cancellation";
import type { ProgressReporter } from "../core/jobQueue/progress";
import type { Logger } from "../core/logger";
import type { LLMRouter } from "../llm/types";
import type { SourceRegistry } from "../sources/registry";

import type { PrivacyPolicy } from "./shared/privacyPolicy";

// ===========================================================================
// 1. docs/07 §4.5, transcribed
// ===========================================================================

export type PipelineId =
  | "searchImport"
  | "related"
  | "summarize"
  | "trendReport"
  | "recommend"
  | "audioReport";

/**
 * Every {@link PipelineId}, in the union's declaration order.
 *
 * The runtime mirror of the union, for the same reason `src/model/ids.ts` keeps
 * one for `SourceId`: the union alone cannot be iterated, and
 * {@link PipelineRegistry}'s ordering has to come from somewhere other than the
 * order someone happens to type an object literal's keys.
 */
const PIPELINE_ID_SET = {
  searchImport: true,
  related: true,
  summarize: true,
  trendReport: true,
  recommend: true,
  audioReport: true,
} satisfies Record<PipelineId, true>;

/** Every {@link PipelineId}, in `docs/07` §4.5's declaration order. */
export const PIPELINE_IDS: readonly PipelineId[] = Object.keys(
  PIPELINE_ID_SET,
) as PipelineId[];

/**
 * The byte-for-byte member list of `docs/07` §4.5's `PipelineContext`.
 *
 * See this file's header for why seven of the member types are forward aliases
 * rather than imports. Nothing in `src/pipeline/` reads one of those seven.
 */
export interface PipelineContext {
  readonly jobId: string;
  readonly token: CancellationToken;
  readonly progress: ProgressReporter;
  readonly logger: Logger;
  readonly cache: Cache;
  readonly clock: Clock;
  readonly budget: BudgetGuard;
  readonly sources: SourceRegistry;
  readonly llm: LLMRouter;
  readonly tts: TTSProvider | undefined;
  readonly zotero: ZoteroFacade;
  readonly config: ConfigReader;
  /** Privacy posture in force for this job (see doc 09). */
  readonly privacy: PrivacyPolicy;
  /**
   * Persist a resumable checkpoint. Called at stage boundaries and every N items.
   * The queue writes it into the JobRecord.
   */
  checkpoint(state: unknown): Promise<void>;
  /** Checkpoint from a previous run of this job, if resuming. */
  readonly resumeState: unknown | undefined;
}

export interface Pipeline<TInput, TOutput> {
  readonly id: PipelineId;
  readonly displayNameKey: string;
  /** Ordered stage descriptors, used to build the progress tree. */
  readonly stages: readonly StageDescriptor[];

  /** Structural validation before a job is created. Cheap, synchronous. */
  validate(input: TInput): ValidationResult;
  /**
   * Pre-flight estimate shown in the confirmation dialog:
   * item counts, API calls, tokens, USD, wall-clock.
   */
  estimate(input: TInput, ctx: PipelineContext): Promise<PipelineEstimate>;
  /** The actual work. Must honour ctx.token and call ctx.checkpoint. */
  run(input: TInput, ctx: PipelineContext): Promise<TOutput>;
  /**
   * Best-effort cleanup of partial side effects after failure or cancellation.
   * Must be idempotent. Never deletes user-authored data.
   */
  compensate?(
    input: TInput,
    ctx: PipelineContext,
    partial: unknown,
  ): Promise<void>;
  /** Whether a checkpointed job of this type can be resumed after restart. */
  readonly resumable: boolean;
}

export interface StageDescriptor {
  readonly key: string;
  readonly labelKey: string;
  /** Relative cost weight used to allocate the progress bar. */
  readonly weight: number;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly { field: string; messageKey: string }[];
}

export interface PipelineEstimate {
  readonly itemCount: number;
  readonly externalRequests: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly estimatedCostUsd: number | undefined;
  readonly estimatedDurationSeconds: number;
  /** e.g. "43 of 200 summaries are already cached." */
  readonly notesKeys: readonly string[];
}

// ===========================================================================
// 2. The forward aliases — see this file's header (four since P3-T15: LLMRouter,
//    Cache and PrivacyPolicy are imported)
// ===========================================================================

/**
 * `docs/07` §4.1's `Cache`, declared in `src/core/cache/cache.ts` and built
 * over the plugin database by `src/core/cache/sqliteCache.ts` (`P3-T33`). No
 * longer a forward alias: re-exported, so `PipelineContext.cache` is the real
 * cache `installServices` builds.
 */
export type { Cache };

/** `docs/07` §4.3's `BudgetGuard`, which belongs at `src/llm/budget.ts`. */
export type BudgetGuard = unknown;

/** `docs/07` §4.4's `TTSProvider`, which belongs in `src/tts/types.ts`. */
export type TTSProvider = unknown;

/**
 * `docs/07` §4.3's `LLMRouter`, declared by the owner on 2026-10-21 (`plan/00`
 * §6 item 248) and built by `src/llm/router.ts`'s `createLLMRouter`. No longer
 * a forward alias (`P3-T06`): re-exported so `PipelineContext.llm` is the real
 * router.
 */
export type { LLMRouter };

/**
 * Named by §4.5 and **declared nowhere** — one occurrence in the whole corpus.
 * §3.2's diagram labels `src/zotero/zoteroApi.ts` "zoteroApi facade", and that
 * module ships a set of free functions rather than an interface, so there is no
 * `ZoteroFacade` type to import.
 *
 * `searchImport` therefore takes its Zotero write surface as an explicit port of
 * its own (`./searchImport/types.ts`'s `SearchImportWriter`) rather than
 * pretending this member carries it.
 */
export type ZoteroFacade = unknown;

/**
 * Named by §4.5 and **declared nowhere** — one occurrence in the whole corpus.
 * Needs a card: `docs/07` §8.5 is the preference schema's authority and
 * `src/prefs/index.ts` the typed accessor, but no `ConfigReader` interface is
 * declared anywhere.
 */
export type ConfigReader = unknown;

/**
 * `docs/07` §4.5's `PrivacyPolicy`, declared by the owner on 2026-10-21
 * (`plan/00` §6 item 267) and built by `./shared/privacyPolicy.ts`'s
 * `createPrivacyPolicy` (`P3-T15`). No longer a forward alias: re-exported so
 * `PipelineContext.privacy` is the real policy.
 */
export type { PrivacyPolicy };

// ===========================================================================
// 3. Weights → fractions
// ===========================================================================

/**
 * One stage's slice of the progress bar: the `[from, to]` pair
 * `ProgressReporter.child()` takes.
 */
export interface StageSlice {
  readonly stage: StageDescriptor;
  /** Lower bound of this stage's slice of the parent's range, in `[0, 1]`. */
  readonly from: number;
  /** Upper bound. Equal to the next stage's `from`. */
  readonly to: number;
}

/**
 * How close to `1` a weight sum has to be for {@link stageSlices} to accept it.
 *
 * It exists because the criterion is "the weights sum to 1" and **floating-point
 * addition of decimal weights frequently does not**: measured on this
 * repository's Node, `0.02 + 0.55 + 0.01 + 0.02 + 0.05 + 0.02 + 0.33` is
 * `1.0000000000000002`, while
 * `0.05 + 0.45 + 0.05 + 0.05 + 0.10 + 0.05 + 0.25` — the set
 * `./searchImport/stages.ts` ships — is exactly `1`. A `=== 1` check would
 * therefore pass or fail on which decimals a later card happened to choose,
 * which is not the property anyone wants asserted.
 */
export const STAGE_WEIGHT_SUM_EPSILON = 1e-9;

/**
 * Turn `docs/07` §4.5's `StageDescriptor.weight` list into §4.1's
 * `child(label, fromFraction, toFraction)` arguments.
 *
 * **This conversion had no owner, and that is why it is here.** §4.1's
 * `child()` doc promises that "weights let stages of unequal cost divide the bar
 * fairly" while its parameters are two *fractions*; the weight carrier is
 * §4.5's `StageDescriptor.weight`. `P1-T15`'s report says no card's `Files`
 * named a home for the conversion and names `P1-T16` step 2 as the natural
 * owner. This is that function, written once so no pipeline computes running
 * sums by hand.
 *
 * Slices are **contiguous and cumulative**: stage *n*'s `to` is stage *n+1*'s
 * `from`, and the last stage's `to` is `1`. The last `to` is set to exactly `1`
 * rather than to the accumulated sum, so a weight list that sums to
 * `0.9999999999999999` still reaches 100 % — which is the criterion "the
 * progress tree reaches exactly 100 % on success".
 *
 * @param stages - a pipeline's `stages`, in run order
 * @returns one slice per stage, in the same order
 * @throws RangeError if the list is empty, if any weight is not a finite
 *   non-negative number, or if the weights do not sum to `1` within
 *   {@link STAGE_WEIGHT_SUM_EPSILON}. It throws rather than normalising,
 *   because a weight list that does not sum to 1 is a mistake in a declaration
 *   and silently rescaling it would make the mistake invisible for the lifetime
 *   of the pipeline.
 */
export function stageSlices(
  stages: readonly StageDescriptor[],
): readonly StageSlice[] {
  if (stages.length === 0) {
    throw new RangeError(
      "[research-helper] a pipeline must declare at least one stage; " +
        "docs/07 §4.5 uses `stages` to build the progress tree.",
    );
  }

  let sum = 0;
  for (const stage of stages) {
    if (!Number.isFinite(stage.weight) || stage.weight < 0) {
      throw new RangeError(
        `[research-helper] stage "${stage.key}" declares weight ` +
          `${String(stage.weight)}; docs/07 §4.5 calls it a relative cost ` +
          `weight, so it must be a finite number ≥ 0.`,
      );
    }
    sum += stage.weight;
  }

  if (Math.abs(sum - 1) > STAGE_WEIGHT_SUM_EPSILON) {
    throw new RangeError(
      `[research-helper] stage weights sum to ${String(sum)}, not 1. ` +
        `The slices are fractions of one progress bar, so the sum is the ` +
        `bar; rescaling silently would hide the declaration's mistake.`,
    );
  }

  const slices: StageSlice[] = [];
  let from = 0;
  for (const [index, stage] of stages.entries()) {
    const last = index === stages.length - 1;
    const to = last ? 1 : from + stage.weight;
    slices.push({ stage, from, to });
    from = to;
  }
  return slices;
}
