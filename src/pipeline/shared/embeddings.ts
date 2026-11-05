/**
 * SPECTER2 vectors: store first, fetch what is missing, normalise once, store
 * (`docs/05` §5.1, §5.2; `P5-T20`). `docs/07` §9.2's note "As built 2026-11-02
 * (`plan/08` `P5-T20`)" holds the decisions; this header does not repeat them.
 *
 * **Callers.** `relatedPipeline.ts` (`P5-T14`) and, when built,
 * `recommendPipeline.ts` (`P5-T25`) call {@link ensureEmbeddings}; they build
 * {@link EnsureEmbeddingsDeps} from `graph.database.embeddings()` and the typed
 * `SemanticScholarSource` `installServices` passes in.
 * `src/pipeline/recommend/score.ts` (`P5-T24`) and `centroids.ts` (`P5-T21`) read
 * {@link cosine}, and `centroids.ts` can use {@link normalizeEmbedding} on a centroid.
 *
 * **Against a stand-in.** The batch's answer is unrecorded until `P5-T31` (`plan/08`
 * `P5-T20`'s note).
 *
 * **Never mix two spaces (`plan/08` §0.2 item 22).** An {@link EmbeddingVector} carries
 * its model and {@link cosine} throws on two; a vector is not assignable to
 * `lexical.ts`'s `LexicalVector`.
 *
 * **Nothing here reaches a log but counts and an error's own key.** A vector is never
 * logged, and the key never comes near this file.
 */

import type { Clock } from "../../core/clock";
import {
  OperationCancelledError,
  ResearchHelperError,
} from "../../core/errors";
import type { Logger } from "../../core/logger";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { SimilaritySpace } from "../../model/recommendation";
import {
  SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS,
  toEmbeddingPaperId,
  type SemanticScholarSource,
} from "../../sources/semanticscholar/semanticscholarSource";
import type { SourceCallContext } from "../../sources/types";
import type { EmbeddingRow, EmbeddingStore } from "../../zotero/db";

/** A similarity space that is made of stored vectors. */
export type EmbeddingModel = Extract<SimilaritySpace, "specter_v2">;

/**
 * How long a vector of each model is: `docs/02` §6.9 and `docs/05` §5.2, measured on
 * one `GET` on 2026-09-08. `P5-T31`'s recording fails a test if `/paper/batch` disagrees.
 */
export const EMBEDDING_DIMENSIONS: Readonly<Record<EmbeddingModel, number>> = {
  specter_v2: 768,
};

/**
 * One vector of unit length with the model that made it. Constructed by
 * {@link ensureEmbeddings}.
 */
export interface EmbeddingVector {
  /** `string`, as the store's column is: {@link cosine} compares any two. */
  readonly model: string;
  readonly values: Float32Array;
}

/** What {@link ensureEmbeddings} reads of a work. Every `CanonicalWork` is one. */
export type EmbeddableWork = Pick<CanonicalWork, "workKey" | "ids">;

/** What {@link ensureEmbeddings} needs; built by each caller, per run. */
export interface EnsureEmbeddingsDeps {
  readonly source: Pick<SemanticScholarSource, "fetchEmbeddings">;
  readonly store: Pick<EmbeddingStore, "getMany" | "putMany" | "evictToCap">;
  /** `created_at` on each row written. */
  readonly clock: Clock;
  /** Over the library's work keys, in memory: `EmbeddingStore.evictToCap`'s argument. */
  readonly isInLibrary: (workKey: string) => boolean;
  readonly logger?: Logger;
}

/** What {@link ensureEmbeddings} found. Each work key is in exactly one member below. */
export interface EnsuredEmbeddings {
  readonly model: EmbeddingModel;
  /** `false`: a fetch was due and no key is present, so nothing was sent. */
  readonly keyed: boolean;
  /** By work key: every usable vector, stored or fetched. */
  readonly vectors: ReadonlyMap<string, EmbeddingVector>;
  /** Work keys asked about that came back with no usable vector. */
  readonly withoutVector: readonly string[];
  /** Work keys with no identifier the service can read, so never asked about. */
  readonly withoutIdentifier: readonly string[];
  /** Work keys no batch reached: no key, or an earlier batch failed. */
  readonly notAsked: readonly string[];
  /** The requests this pass sent. */
  readonly batchCalls: number;
  /** The failure that stopped the batches, if one did. */
  readonly failure?: ResearchHelperError;
}

/**
 * Scale to unit length, in double precision and only then to `Float32`, so values too
 * large for a `Float32` still scale correctly. Call it once per vector, at ingest.
 *
 * @param values - the raw vector
 * @returns the unit vector, or `undefined` for one that cannot be scaled (all zeros,
 *   empty, or a sum of squares that is not a finite number)
 */
export function normalizeEmbedding(
  values: readonly number[],
): Float32Array | undefined {
  let sum = 0;
  for (const value of values) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) return undefined;
  return Float32Array.from(values, (value) => value / norm);
}

/**
 * Cosine similarity of two unit vectors of one model: their dot product, in [-1, 1].
 * Rounding can pass 1 by about 1e-7, and `docs/05` §7.4 rescales this to [0, 1], so it
 * is clamped.
 *
 * @throws RangeError for two models (`docs/05` §5.1) or two lengths
 */
export function cosine(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.model !== b.model) {
    throw new RangeError(
      `[research-helper] cosine: vectors of two models, ${a.model} and ${b.model} ` +
        `(plan/08 §0.2 item 22)`,
    );
  }
  if (a.values.length !== b.values.length) {
    throw new RangeError(
      `[research-helper] cosine: vectors of two lengths, ` +
        `${String(a.values.length)} and ${String(b.values.length)}`,
    );
  }
  let sum = 0;
  for (let i = 0; i < a.values.length; i += 1) {
    sum += (a.values[i] as number) * (b.values[i] as number);
  }
  return Math.max(-1, Math.min(1, sum));
}

/** The stored vectors of these keys; a store that cannot read only warns. */
async function readStored(
  deps: EnsureEmbeddingsDeps,
  workKeys: readonly string[],
  model: EmbeddingModel,
): Promise<ReadonlyMap<string, Float32Array>> {
  try {
    return await deps.store.getMany(workKeys, model);
  } catch {
    deps.logger?.warn("embeddings: the store could not be read; fetching", {
      works: workKeys.length,
    });
    return new Map();
  }
}

/** One batch's rows and the eviction after them; a store that cannot write only warns. */
async function writeThrough(
  deps: EnsureEmbeddingsDeps,
  rows: readonly EmbeddingRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await deps.store.putMany(rows);
    await deps.store.evictToCap(deps.isInLibrary);
  } catch {
    deps.logger?.warn("embeddings: the store could not be written", {
      rows: rows.length,
    });
  }
}

/**
 * Make sure these works' vectors are at hand: the store first, then one
 * {@link SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS}-id request per batch for what it lacks.
 * Each batch is normalised, stored and followed by `evictToCap` before the next.
 *
 * @param deps - the source, the store, the clock and the library predicate
 * @param works - the works; a repeated work key counts once
 * @param model - the space, and the tag on what is stored
 * @param ctx - the cancellation token; a cancel propagates, and what arrived stays stored
 * @returns the vectors, and what happened to the rest
 * @throws OperationCancelledError on a cancel
 */
export async function ensureEmbeddings(
  deps: EnsureEmbeddingsDeps,
  works: readonly EmbeddableWork[],
  model: EmbeddingModel,
  ctx: SourceCallContext,
): Promise<EnsuredEmbeddings> {
  ctx.token.throwIfCancelled();
  const wanted = new Map(works.map((work) => [work.workKey, work.ids]));
  const dimensions = EMBEDDING_DIMENSIONS[model];
  const stored = await readStored(deps, [...wanted.keys()], model);

  const vectors = new Map<string, EmbeddingVector>();
  const worksById = new Map<string, string[]>();
  const withoutIdentifier: string[] = [];
  for (const [workKey, ids] of wanted) {
    const values = stored.get(workKey);
    if (values?.length === dimensions) {
      vectors.set(workKey, { model, values });
      continue;
    }
    const id = toEmbeddingPaperId(ids);
    if (id === undefined) withoutIdentifier.push(workKey);
    else worksById.set(id, [...(worksById.get(id) ?? []), workKey]);
  }

  const paperIds = [...worksById.keys()];
  const workKeysOf = (id: string): readonly string[] => worksById.get(id) ?? [];
  const withoutVector: string[] = [];
  let keyed = true;
  let failure: ResearchHelperError | undefined;
  let batchCalls = 0;
  let asked = 0;

  while (asked < paperIds.length) {
    ctx.token.throwIfCancelled();
    const batch = paperIds.slice(
      asked,
      asked + SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS,
    );
    try {
      const answer = await deps.source.fetchEmbeddings(batch, ctx);
      keyed = answer.keyed;
      if (!keyed) break;
      batchCalls += 1;
      asked += batch.length;

      const rows: EmbeddingRow[] = [];
      const createdAtEpochMs = deps.clock.now();
      let refused = 0;
      for (const id of batch) {
        const raw = answer.vectors.get(id);
        const values =
          raw?.length === dimensions ? normalizeEmbedding(raw) : undefined;
        if (raw !== undefined && values === undefined) refused += 1;
        for (const workKey of workKeysOf(id)) {
          if (values === undefined) {
            withoutVector.push(workKey);
          } else {
            vectors.set(workKey, { model, values });
            rows.push({ workKey, model, vector: values, createdAtEpochMs });
          }
        }
      }
      if (refused > 0) {
        // All zeros, or not the documented length: `P5-T31` checks the length.
        deps.logger?.warn("embeddings: vectors that could not be used", {
          refused,
          expectedLength: dimensions,
        });
      }
      await writeThrough(deps, rows);
    } catch (error) {
      if (
        error instanceof OperationCancelledError ||
        !(error instanceof ResearchHelperError)
      ) {
        throw error;
      }
      failure = error;
      deps.logger?.warn("embeddings: a batch failed; the rest were not asked", {
        messageKey: error.messageKey,
        batchCalls,
      });
      break;
    }
  }

  return {
    model,
    keyed,
    vectors,
    withoutVector,
    withoutIdentifier,
    notAsked: paperIds.slice(asked).flatMap(workKeysOf),
    batchCalls,
    ...(failure !== undefined && { failure }),
  };
}
