/**
 * The relatedness cache: `docs/05` §9.2's per-signal lifetimes and negative
 * cache over the one `cache_entry` table (`P5-T10`). `docs/07` §9.2's note
 * "As built 2026-11-02" holds the decisions; `docs/05` §9.2 owns the table.
 *
 * **Callers.** `src/pipeline/related/generators.ts` (`P5-T12`) and
 * `src/pipeline/recommend/generators.ts` (`P5-T23`), which build
 * {@link RelatedCacheDeps} with {@link relatedCacheDeps} from their job's
 * `PipelineContext`. A generator with one request per seed uses
 * {@link planRelatedSeeds} and then {@link cachedRelated}, so each call goes
 * cache → budget → limiter. One request over several seeds (`elink`,
 * `/paper/batch`) uses {@link readRelated}, `RequestBudget.tryTake`, and then
 * {@link writeRelated} or {@link writeRelatedMissing} per seed.
 *
 * Transient failures are never remembered: only a permanent 404 or an
 * unresolvable id writes a negative entry.
 */

import type { Cache, CacheNamespace } from "../../core/cache/cache";
import { NO_CACHE } from "../../core/cache/cache";
import { cacheKey, encodeTagValue } from "../../core/cache/keys";
import { BadRequestError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import { redactRecord, type RedactionMark } from "../../core/provenance";
import type { SourceId } from "../../model/ids";
import type { PipelineContext } from "../types";
import type { RequestBudget } from "./requestBudget";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `docs/05` §9.2: every relatedness payload is a `source-response` entry. */
export const RELATED_CACHE_NAMESPACE: CacheNamespace = "source-response";

/**
 * `docs/05` §9.2's "permanent", in effect. An omitted `ttlMs` would take the
 * namespace's 24 h, and `Cache` has no way to say "never" in this namespace.
 */
export const RELATED_PERMANENT_TTL_MS = 100 * 365 * DAY_MS;

/** `docs/05` §9.2's negative-cache row: a 404 or an unresolvable id. */
export const RELATED_NEGATIVE_TTL_MS = 7 * DAY_MS;

/**
 * Each signal this wrapper stores, one per row of `docs/05` §9.2's table. Its
 * SPECTER2 row is not here: vectors live in the `embedding` table (`P5-T03`,
 * `P5-T20`).
 */
export type RelatedSignalKind =
  | "metadata"
  | "id-crosswalk"
  | "references"
  | "citations"
  | "citation-count"
  | "pmra"
  | "s2-recommendations"
  | "keyword-search";

/** `docs/05` §9.2's lifetimes, held equal to that table by a test. */
export const RELATED_TTL_MS: Readonly<Record<RelatedSignalKind, number>> = {
  metadata: 30 * DAY_MS,
  "id-crosswalk": RELATED_PERMANENT_TTL_MS,
  references: 90 * DAY_MS,
  citations: 7 * DAY_MS,
  "citation-count": 7 * DAY_MS,
  pmra: 14 * DAY_MS,
  "s2-recommendations": 3 * DAY_MS,
  "keyword-search": 1 * DAY_MS,
};

/**
 * The identifier fields of a `SourceRecord` that `redactRecord` copies
 * unchanged. Without them it rewrites every Semantic Scholar record's `id`,
 * `nativeId` and `work.url`, each of which holds a 40-hexadecimal paper id
 * (`docs/07` §9.2's note gives the measurement).
 */
export const RELATED_VERBATIM_KEYS: readonly string[] = [
  "id",
  "nativeId",
  "url",
  "doi",
  "pmid",
  "pmcid",
  "arxivId",
  "s2CorpusId",
  "openAlexId",
  "epmcId",
];

/** Everything that could change an answer, per `docs/07` §9.1. */
export interface RelatedCacheKey {
  readonly sourceId: SourceId;
  /** The seed or seeds, in the order sent. Not gated: they are identifiers. */
  readonly ids: readonly string[];
  /** Negative examples, for a request that sends them. Not gated either. */
  readonly negativeIds?: readonly string[];
  /** Limit, fields, date window, query. Passed through `redactRecord` first. */
  readonly params?: Readonly<Record<string, string | number | boolean | null>>;
}

/** What a relatedness call came to. Any other failure is thrown. */
export type RelatedOutcome<T> =
  | {
      readonly outcome: "value";
      readonly value: T;
      readonly fromCache: boolean;
      /** The "partly redacted" mark from when the value was first gated. */
      readonly redaction: RedactionMark;
    }
  | { readonly outcome: "missing"; readonly fromCache: boolean };

/** What the wrapper reads and warns through. See {@link relatedCacheDeps}. */
export interface RelatedCacheDeps {
  readonly cache: Cache;
  readonly logger: Pick<Logger, "warn">;
}

/** One stored entry; the key's `CACHE_SCHEMA_VERSION` covers a change of shape. */
type StoredEntry<T> =
  | {
      readonly outcome: "value";
      readonly value: T;
      readonly redaction: RedactionMark;
    }
  | { readonly outcome: "missing" };

/**
 * The job's cache, or `NO_CACHE` when `cache.enabled` (`docs/07` §8.5) is off.
 *
 * @param ctx - the running job's context
 * @returns the deps every function here takes
 */
export function relatedCacheDeps(
  ctx: Pick<PipelineContext, "cache" | "config" | "logger">,
): RelatedCacheDeps {
  return {
    cache: ctx.config.get("cacheEnabled") ? ctx.cache : NO_CACHE,
    logger: ctx.logger,
  };
}

/**
 * The key: `docs/07` §9.1's `sourceResponseKey`, with the signal as its
 * `endpoint`, hashed by `cacheKey`.
 *
 * @throws RangeError when `params` has a field the gate would remove, which is
 *   a caller's bug: such a field could only hold a credential
 */
export function relatedCacheKey(
  kind: RelatedSignalKind,
  key: RelatedCacheKey,
): string {
  const params = redactRecord(key.params ?? {});
  if (params.mark.droppedFields > 0) {
    throw new RangeError(
      "[research-helper] a relatedness cache key may not hold a credential field",
    );
  }
  return cacheKey(
    "source",
    key.sourceId,
    kind,
    key.ids,
    key.negativeIds ?? [],
    params.record,
  );
}

function warnOf(
  deps: RelatedCacheDeps,
  message: string,
  kind: RelatedSignalKind,
  error: unknown,
): void {
  deps.logger.warn(message, {
    kind,
    reason: error instanceof Error ? error.name : typeof error,
  });
}

function setOptions(key: RelatedCacheKey, ttlMs: number) {
  return { ttlMs, tags: [`source:${encodeTagValue(key.sourceId)}`] };
}

/**
 * What the cache holds for this call, with no request made. A cache that cannot
 * be read warns and counts as a miss.
 *
 * @returns the outcome, or `undefined` for a miss
 */
export async function readRelated<T>(
  deps: RelatedCacheDeps,
  kind: RelatedSignalKind,
  key: RelatedCacheKey,
): Promise<RelatedOutcome<T> | undefined> {
  const cacheId = relatedCacheKey(kind, key);
  let entry: StoredEntry<T> | undefined;
  try {
    entry = await deps.cache.get<StoredEntry<T>>(
      RELATED_CACHE_NAMESPACE,
      cacheId,
    );
  } catch (error) {
    warnOf(deps, "a relatedness cache entry could not be read", kind, error);
    return undefined;
  }
  if (entry?.outcome === "missing") {
    return { outcome: "missing", fromCache: true };
  }
  if (entry?.outcome === "value") {
    return {
      outcome: "value",
      value: entry.value,
      fromCache: true,
      redaction: entry.redaction,
    };
  }
  return undefined;
}

/**
 * Gate a value and store it for `kind`'s lifetime. A cache that cannot be
 * written warns; the value is still returned.
 *
 * @returns the outcome as a later hit would report it, except `fromCache`
 */
export async function writeRelated<T>(
  deps: RelatedCacheDeps,
  kind: RelatedSignalKind,
  key: RelatedCacheKey,
  value: T,
): Promise<RelatedOutcome<T>> {
  const cacheId = relatedCacheKey(kind, key);
  const gated = redactRecord(value, { verbatimKeys: RELATED_VERBATIM_KEYS });
  const entry: StoredEntry<T> = {
    outcome: "value",
    value: gated.record,
    redaction: gated.mark,
  };
  try {
    await deps.cache.set(
      RELATED_CACHE_NAMESPACE,
      cacheId,
      entry,
      setOptions(key, RELATED_TTL_MS[kind]),
    );
  } catch (error) {
    warnOf(deps, "a relatedness answer could not be cached", kind, error);
  }
  return {
    outcome: "value",
    value: gated.record,
    fromCache: false,
    redaction: gated.mark,
  };
}

/**
 * Remember for {@link RELATED_NEGATIVE_TTL_MS} that a source lacks this key: a
 * 404, or an unresolvable id inside a successful answer (`/paper/batch`'s
 * `null`). A cache that cannot be written warns.
 */
export async function writeRelatedMissing(
  deps: RelatedCacheDeps,
  kind: RelatedSignalKind,
  key: RelatedCacheKey,
): Promise<RelatedOutcome<never>> {
  const cacheId = relatedCacheKey(kind, key);
  const entry: StoredEntry<never> = { outcome: "missing" };
  try {
    await deps.cache.set(
      RELATED_CACHE_NAMESPACE,
      cacheId,
      entry,
      setOptions(key, RELATED_NEGATIVE_TTL_MS),
    );
  } catch (error) {
    warnOf(deps, "a relatedness miss could not be cached", kind, error);
  }
  return { outcome: "missing", fromCache: false };
}

/**
 * Cache first; on a miss, `fetch` (which goes through the host's limiter), and
 * remember the answer. A permanent 404 becomes `"missing"`, remembered for
 * 7 days; every other failure is thrown and remembers nothing.
 *
 * @param fetch - sends the request; take its budget before calling this, with
 *   {@link planRelatedSeeds} or `RequestBudget.tryTake`
 * @throws whatever `fetch` throws, except a 404
 */
export async function cachedRelated<T>(
  deps: RelatedCacheDeps,
  kind: RelatedSignalKind,
  key: RelatedCacheKey,
  fetch: () => Promise<T>,
): Promise<RelatedOutcome<T>> {
  const hit = await readRelated<T>(deps, kind, key);
  if (hit !== undefined) return hit;
  let value: T;
  try {
    value = await fetch();
  } catch (error) {
    if (error instanceof BadRequestError && error.httpStatus === 404) {
      return writeRelatedMissing(deps, kind, key);
    }
    throw error;
  }
  return writeRelated(deps, kind, key, value);
}

/** One generator's seeds, sorted out before it sends anything. */
export interface RelatedSeedPlan<S, T> {
  /** Answered by the cache, at no cost. */
  readonly cached: readonly {
    readonly seed: S;
    readonly outcome: RelatedOutcome<T>;
  }[];
  /** Misses with one request of budget already taken each, best first. */
  readonly toFetch: readonly S[];
  /** Misses the budget could not cover; the generator does not touch them. */
  readonly dropped: readonly S[];
}

/**
 * Read the cache for every seed, then take one request of budget per miss, in
 * seed order. Nothing is sent. `P5-T23` calls this per generator in
 * `GENERATOR_VALUE_ORDER`, then starts them all.
 *
 * @param seeds - best first
 * @param keyOf - each seed's key
 */
export async function planRelatedSeeds<S, T>(
  deps: RelatedCacheDeps,
  budget: RequestBudget,
  kind: RelatedSignalKind,
  seeds: readonly S[],
  keyOf: (seed: S) => RelatedCacheKey,
): Promise<RelatedSeedPlan<S, T>> {
  const cached: { seed: S; outcome: RelatedOutcome<T> }[] = [];
  const misses: S[] = [];
  for (const seed of seeds) {
    const outcome = await readRelated<T>(deps, kind, keyOf(seed));
    if (outcome === undefined) misses.push(seed);
    else cached.push({ seed, outcome });
  }
  const share = budget.takeUpTo(misses.length);
  return {
    cached,
    toFetch: misses.slice(0, share),
    dropped: misses.slice(share),
  };
}
