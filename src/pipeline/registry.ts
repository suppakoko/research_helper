/**
 * The pipeline registry — the one place that knows which pipelines this build
 * can run.
 *
 * **Scope.** `P1-T16`. `register`, `get(id)` and `list()`, and nothing else.
 * It is deliberately the same shape as `src/sources/registry.ts`, down to the
 * duplicate-registration throw, because the two solve the same problem for the
 * same reason and a second idiom for it would be a second thing to learn.
 *
 * **Why it exists at all.** `docs/07` §11.3 lists the registration of a new
 * pipeline as one numbered step of adding a feature, and §4.5's `PipelineId`
 * union is what a UI surface or a job queue would name when it asks for one.
 * Phase 1 registers exactly one pipeline and runs it directly — there is no job
 * queue until Phase 3 (`docs/11` §1) — so the registry's present job is to be
 * the single thing `src/bootstrap/registerPipelines.ts` fills and the single
 * thing a caller reads, rather than to be looked up by a scheduler.
 *
 * **`get()` is typed `Pipeline<unknown, unknown>` and that is on purpose.** A
 * registry keyed by a closed union of *ids* cannot also be keyed by each
 * pipeline's input and output types without a per-id lookup table, and the
 * caller that knows it wants `searchImport` is better served by being handed the
 * concretely-typed pipeline at the construction site (which is what
 * `installServices` does) than by casting the result of a string lookup. So the
 * registry is for enumeration and for the Phase 3 queue; it is not the typed
 * route to a specific pipeline.
 *
 * **Layering.** `pipeline/` may not import `ui/` (`docs/07` §2.3). This file
 * imports nothing but its own sibling's types.
 */

import type { Pipeline, PipelineId } from "./types";
import { PIPELINE_IDS } from "./types";

/**
 * A pipeline as the registry holds it: its input and output types erased.
 *
 * `unknown` on both sides rather than `any`, so a caller that pulls one out
 * cannot call `run()` without first narrowing the input it means to pass — the
 * same discipline the forward aliases in `./types.ts` enforce.
 */
export type ErasedPipeline = Pipeline<never, unknown>;

/**
 * A mutable collection of {@link Pipeline}s, keyed by {@link PipelineId}.
 *
 * Read order is **registration order**, and
 * `src/bootstrap/registerPipelines.ts` registers in `PIPELINE_IDS` order so the
 * two coincide — the same arrangement `src/bootstrap/registerSources.ts` makes
 * for sources, and for the same reason: the ordering rule belongs at the single
 * wiring point rather than being re-derived on every read.
 */
export interface PipelineRegistry {
  /**
   * Add a pipeline. Throws if one with the same `id` is already registered: two
   * pipelines for one id means one of them is unreachable and every later
   * `get()` silently resolves to whichever won.
   */
  register(pipeline: ErasedPipeline): void;

  /** The pipeline for `id`, or `undefined` if this build has none. */
  get(id: PipelineId): ErasedPipeline | undefined;

  /** Every registered pipeline, in registration order. */
  list(): readonly ErasedPipeline[];
}

/** Create an empty registry. The composition root fills it exactly once. */
export function createPipelineRegistry(): PipelineRegistry {
  // A Map for the reason `createSourceRegistry` uses one: insertion order for
  // string keys without the prototype surface of a `Record` built from
  // untrusted input.
  const pipelines = new Map<PipelineId, ErasedPipeline>();

  return {
    register(pipeline: ErasedPipeline): void {
      if (pipelines.has(pipeline.id)) {
        throw new Error(
          `[research-helper] a pipeline is already registered for ` +
            `"${pipeline.id}". docs/07 §11.3 makes registerPipelines.ts the ` +
            `single wiring point; registering twice usually means the ` +
            `composition root ran twice.`,
        );
      }
      pipelines.set(pipeline.id, pipeline);
    },

    get(id: PipelineId): ErasedPipeline | undefined {
      return pipelines.get(id);
    },

    list(): readonly ErasedPipeline[] {
      return [...pipelines.values()];
    },
  };
}

/**
 * Register every pipeline in `pipelines` into `registry`, in `PIPELINE_IDS`
 * order.
 *
 * Written as a loop over the id list rather than over the object's keys for the
 * reason `registerSources` gives: Phase 2 and Phase 3 add members to
 * {@link PipelineSet} and inherit the ordering instead of depending on where in
 * the literal someone typed the new key.
 *
 * @param registry - the registry from {@link createPipelineRegistry}, empty
 * @param pipelines - constructed pipelines, supplied by the composition root
 * @throws if a pipeline's own `id` does not match the key it was supplied
 *   under — a mis-wired container would otherwise put `searchImport` behind
 *   `summarize`'s id, and `registry.get()` would agree with it
 */
export function registerPipelines(
  registry: PipelineRegistry,
  pipelines: PipelineSet,
): void {
  const byId: Readonly<Partial<Record<PipelineId, ErasedPipeline>>> = pipelines;

  for (const id of PIPELINE_IDS) {
    const pipeline = byId[id];
    if (pipeline === undefined) continue;

    if (pipeline.id !== id) {
      throw new Error(
        `[research-helper] the pipeline supplied as "${id}" reports id ` +
          `"${pipeline.id}". docs/07 §4.5 makes PipelineId the pipeline's ` +
          `identity; a mismatch here means the registry and every caller ` +
          `disagree about what was asked for.`,
      );
    }

    registry.register(pipeline);
  }
}

/**
 * The pipelines this build has. One member per pipeline the phase ships, so a
 * missing one is a compile error at the call site rather than an id that
 * resolves to nothing at run time.
 *
 * Phase 2 adds `related`, Phase 3 `summarize`, `trendReport`, `recommend` and
 * `audioReport` (`docs/11` §1).
 */
export interface PipelineSet {
  /** Phase 1's only pipeline. `P1-T16` builds it. */
  readonly searchImport: ErasedPipeline;
  /**
   * "Summarize collection…" (`P3-T29`): `createSummarizePipeline` in
   * `./summarize/summarizePipeline.ts`. Erased here like every member; the
   * summarize window's host (`src/bootstrap/registerUI.ts`) narrows it to
   * `SummarizePipeline` at its one construction site, as the search window's
   * host does for `searchImport`. Optional so a registry test can register
   * one pipeline alone (`test/unit/pipeline/searchImport.test.ts`);
   * `buildPipelineSet` always supplies it.
   */
  readonly summarize?: ErasedPipeline;
  /**
   * "Generate Research Trends Report…" (`P4-T18`): `createTrendReportPipeline`
   * in `./trendReport/trendReportPipeline.ts`, erased like every member; the
   * report window's host (`P4-T20`, `src/bootstrap/registerUI.ts`) narrows it
   * to `TrendReportPipeline`. Optional for the reason `summarize` is;
   * `buildPipelineSet` always supplies it.
   */
  readonly trendReport?: ErasedPipeline;
  /**
   * "Find Related Papers…" (`P5-T14`): `createRelatedPipeline` in
   * `./related/relatedPipeline.ts`, erased like every member; the search window's
   * host (`P5-T16`) narrows it to `RelatedPipeline`. `buildPipelineSet` supplies it
   * when given the adapters, which `installServices` always passes.
   */
  readonly related?: ErasedPipeline;
  /**
   * "Recommend Papers…" (`P5-T25`): `createRecommendPipeline` in
   * `./recommend/recommendPipeline.ts`, erased like every member; the window's host
   * (`P5-T26`) narrows it to `RecommendPipeline`. `buildPipelineSet` supplies it when
   * given the adapters and the stores, which `installServices` always passes.
   */
  readonly recommend?: ErasedPipeline;
}
