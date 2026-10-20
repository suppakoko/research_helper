/**
 * `docs/07` §4.1's `Cache`, and §9.2's per-namespace policy (`P3-T33`).
 *
 * The interface block below is §4.1 transcribed — names, members, types and
 * doc comments — with one correction made in `docs/07` first: an omitted
 * {@link CacheSetOptions.ttlMs} takes the namespace's §9.2 TTL (corrected
 * 2026-10-21).
 *
 * The implementation over the plugin database is
 * `src/core/cache/sqliteCache.ts`; `installServices`
 * (`src/bootstrap/container.ts`) builds it through `installPluginDatabase`
 * (`src/bootstrap/pluginDatabase.ts`), and every job's
 * `PipelineContext.cache` is that one instance.
 */

export interface CacheEntryMeta {
  readonly key: string;
  readonly namespace: CacheNamespace;
  readonly createdAtEpochMs: number;
  readonly expiresAtEpochMs: number | undefined;
  readonly lastAccessedEpochMs: number;
  readonly hits: number;
  readonly sizeBytes: number;
  /** Opaque tag used for bulk invalidation, e.g. `model:gpt-4o-mini`. */
  readonly tags: readonly string[];
}

export type CacheNamespace =
  | "source-response" // raw upstream API payloads
  | "canonical-work" // normalized works keyed by external ID
  | "summary" // StoredSummary
  | "embedding" // vectors
  | "llm-completion" // generic completion cache
  | "recommendation"
  | "report";

export interface Cache {
  get<T>(namespace: CacheNamespace, key: string): Promise<T | undefined>;
  /** Returns entry + metadata; used by cache diagnostics. */
  getWithMeta<T>(
    namespace: CacheNamespace,
    key: string,
  ): Promise<{ value: T; meta: CacheEntryMeta } | undefined>;
  set<T>(
    namespace: CacheNamespace,
    key: string,
    value: T,
    options?: CacheSetOptions,
  ): Promise<void>;
  /** Atomic get-or-compute; concurrent callers for the same key share one computation. */
  getOrCompute<T>(
    namespace: CacheNamespace,
    key: string,
    compute: () => Promise<T>,
    options?: CacheSetOptions,
  ): Promise<T>;
  has(namespace: CacheNamespace, key: string): Promise<boolean>;
  delete(namespace: CacheNamespace, key: string): Promise<void>;
  /** Bulk invalidation by tag, e.g. invalidateByTag("promptVersion:trend-v3"). */
  invalidateByTag(tag: string): Promise<number>;
  clearNamespace(namespace: CacheNamespace): Promise<number>;
  /** Run TTL expiry + size-cap eviction. Called on startup and on a timer. */
  prune(): Promise<CachePruneResult>;
  stats(): Promise<CacheStats>;
}

export interface CacheSetOptions {
  /**
   * Time-to-live in ms; omit for the namespace's §9.2 TTL ("never expires,
   * subject to eviction" for a namespace whose TTL is "none"). Corrected
   * 2026-10-21 (`P3-T33`) in `docs/07` §4.1 first.
   */
  readonly ttlMs?: number;
  readonly tags?: readonly string[];
  /** Skip writing if the serialized value exceeds this many bytes. */
  readonly maxValueBytes?: number;
}

export interface CachePruneResult {
  readonly expiredRemoved: number;
  readonly evictedForSize: number;
  readonly bytesReclaimed: number;
}

export interface CacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly byNamespace: Readonly<
    Record<CacheNamespace, { entries: number; bytes: number }>
  >;
  readonly hitRate: number;
}

// ---------------------------------------------------------------------------
// §9.2's policy table
// ---------------------------------------------------------------------------

/** Every {@link CacheNamespace}, in §4.1's order. */
export const CACHE_NAMESPACES: readonly CacheNamespace[] = [
  "source-response",
  "canonical-work",
  "summary",
  "embedding",
  "llm-completion",
  "recommendation",
  "report",
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MB = 1024 * 1024;

/** One row of `docs/07` §9.2's table. */
export interface CacheNamespacePolicy {
  /** The default TTL; `undefined` is §9.2's "none". */
  readonly ttlMs: number | undefined;
  /** §9.2's per-namespace size cap. Fixed: not a preference (§9.2, §8.5). */
  readonly capBytes: number;
}

/**
 * `docs/07` §9.2, row for row. `source-response`'s default is the search-result
 * TTL (24 h); an ID lookup passes {@link SOURCE_RESPONSE_LOOKUP_TTL_MS}.
 */
export const CACHE_NAMESPACE_POLICIES: Readonly<
  Record<CacheNamespace, CacheNamespacePolicy>
> = {
  "source-response": { ttlMs: 24 * HOUR_MS, capBytes: 200 * MB },
  "canonical-work": { ttlMs: 30 * DAY_MS, capBytes: 100 * MB },
  summary: { ttlMs: undefined, capBytes: 200 * MB },
  embedding: { ttlMs: undefined, capBytes: 100 * MB },
  "llm-completion": { ttlMs: 7 * DAY_MS, capBytes: 100 * MB },
  recommendation: { ttlMs: 7 * DAY_MS, capBytes: 20 * MB },
  report: { ttlMs: undefined, capBytes: 50 * MB },
};

/** §9.2's second `source-response` row: an ID lookup or metadata, 30 days. */
export const SOURCE_RESPONSE_LOOKUP_TTL_MS = 30 * DAY_MS;

/** §9.2: a value over this many bytes is spilled to a blob file. */
export const CACHE_BLOB_THRESHOLD_BYTES = 256 * 1024;

/**
 * A {@link Cache} that stores nothing: every read misses, every write is
 * dropped, `getOrCompute` always computes. For a `PipelineContext` built
 * outside the composition root (a unit test, a benchmark script), where a
 * pipeline that reads the cache must still run. A cache miss is always a
 * correct answer, so this is never wrong, only slower.
 */
export const NO_CACHE: Cache = {
  get: () => Promise.resolve(undefined),
  getWithMeta: () => Promise.resolve(undefined),
  set: () => Promise.resolve(),
  getOrCompute: (_namespace, _key, compute) => compute(),
  has: () => Promise.resolve(false),
  delete: () => Promise.resolve(),
  invalidateByTag: () => Promise.resolve(0),
  clearNamespace: () => Promise.resolve(0),
  prune: () =>
    Promise.resolve({
      expiredRemoved: 0,
      evictedForSize: 0,
      bytesReclaimed: 0,
    }),
  stats: () => {
    const byNamespace = {} as Record<
      CacheNamespace,
      { entries: number; bytes: number }
    >;
    for (const namespace of CACHE_NAMESPACES) {
      byNamespace[namespace] = { entries: 0, bytes: 0 };
    }
    return Promise.resolve({ entries: 0, bytes: 0, byNamespace, hitRate: 0 });
  },
};
