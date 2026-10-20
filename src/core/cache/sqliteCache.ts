/**
 * `docs/07` §4.1's {@link Cache} over the plugin database's `cache_entry`
 * table (§8.3), with §9.2's TTLs, caps and blob spill, §9.3's tags and §9.4's
 * eviction (`P3-T33`).
 *
 * ## Ports, not platform
 *
 * `core/` may import only `model/` (`docs/07` §2.3), so this file names
 * neither `src/zotero/db.ts` nor a file API. {@link CacheSqlConnection} is the
 * slice of `db.ts`'s `SqlConnection` this store calls — the real connection
 * satisfies it structurally — and {@link CacheBlobStore} is the blob
 * directory, implemented by `src/zotero/db.ts`'s `createCacheBlobStore` over
 * `IOUtils` in `<data dir>/research-helper/cache/blobs/`. Both are handed in
 * by `installPluginDatabase` (`src/bootstrap/pluginDatabase.ts`), which
 * `installServices` calls.
 *
 * ## No database is a working configuration
 *
 * The connection arrives through {@link SqliteCacheDeps.connection}, which
 * waits for the startup migrations and resolves `undefined` when the database
 * could not be opened (or has been closed). Then every read misses, every
 * write is dropped, and the counts are zero: a cache that cannot store is a
 * cache that always misses, which is always correct — it costs a refetch or a
 * recomputation, never a wrong answer.
 *
 * ## Statements
 *
 * Every statement is one statement, so each is atomic on its own and none
 * needs a transaction. A multi-row change selects the rows it will touch
 * first (to know their blob files), then deletes by the same predicate or by
 * `rowid`. Tags are matched with `instr(',' || tags || ',', ',<tag>,')`
 * rather than `LIKE`: a tag such as `model:gpt_4` contains `_`, a `LIKE`
 * wildcard, and Zotero refuses a `LIKE` with a literal pattern anyway
 * (`test/integration/zotero/provenanceStore.spec.ts`'s header, measured
 * 2026-10-15). No bound value reaches Zotero's debug log
 * (`debugParams: false`): a cached value is an upstream payload or a summary.
 */

import type { Clock } from "../clock";
import type { Logger } from "../logger";
import {
  CACHE_BLOB_THRESHOLD_BYTES,
  CACHE_NAMESPACE_POLICIES,
  CACHE_NAMESPACES,
  type Cache,
  type CacheEntryMeta,
  type CacheNamespace,
  type CachePruneResult,
  type CacheSetOptions,
  type CacheStats,
} from "./cache";
import { CACHE_SCHEMA_VERSION, sha256Hex } from "./keys";

// ---------------------------------------------------------------------------
// 1. Ports
// ---------------------------------------------------------------------------

/** One bound parameter; `null` is SQL `NULL`. */
export type CacheSqlParam = string | number | null;

/**
 * The slice of `src/zotero/db.ts`'s `SqlConnection` this store uses. The
 * real connection (`Zotero.DBConnection`) and the unit tests' `node:sqlite`
 * adapter both satisfy it. `valueQueryAsync` resolves to `false` when no row
 * matched (Zotero 10.0.3's behaviour).
 */
export interface CacheSqlConnection {
  queryAsync(
    sql: string,
    params?: readonly CacheSqlParam[],
    options?: { readonly debugParams?: boolean },
  ): Promise<unknown>;
  valueQueryAsync(
    sql: string,
    params?: readonly CacheSqlParam[],
    options?: { readonly debugParams?: boolean },
  ): Promise<unknown>;
}

/**
 * The blob directory of `docs/07` §9.2: one file per spilled value, named by
 * a 64-character hex digest. `read` resolves `undefined` for a missing file;
 * `remove` of a missing file succeeds.
 */
export interface CacheBlobStore {
  write(name: string, text: string): Promise<void>;
  read(name: string): Promise<string | undefined>;
  remove(name: string): Promise<void>;
  /** Every file name in the directory (none when it does not exist). */
  list(): Promise<readonly string[]>;
}

/** What {@link createSqliteCache} is built from. */
export interface SqliteCacheDeps {
  /**
   * The migrated plugin connection, or `undefined` when there is none. Called
   * once per operation, so an operation started after teardown finds none.
   */
  readonly connection: () => Promise<CacheSqlConnection | undefined>;
  readonly blobs: CacheBlobStore;
  readonly clock: Pick<Clock, "now">;
  readonly logger: Logger;
  /** The global cap in bytes: `cache.maxSizeMB` (§8.5), read on demand. */
  readonly maxBytes: () => number;
  /**
   * Tags whose entries `prune()` must not evict — §9.4 step 4, "never evict
   * an entry whose `work_key` belongs to a currently running job", as
   * `work:<workKey>` tags. Absent until a job runner supplies it.
   */
  readonly pinnedTags?: () => readonly string[];
}

/** The cache plus its teardown. */
export interface SqliteCache extends Cache {
  /**
   * Refuse new operations and wait for every one in flight, so the
   * connection can close under nothing. Called by `installPluginDatabase`'s
   * teardown before the connection closes.
   */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// 2. Constants
// ---------------------------------------------------------------------------

/** `blob_path` is relative to `<data dir>/research-helper/` (§8.3, §9.2). */
export const CACHE_BLOB_PATH_PREFIX = "cache/blobs/";

/**
 * §9.4 step 2's `bonusMs`: one hour of recency per hit. `docs/07` gives no
 * number; chosen by `P3-T33` and recorded there (owner to confirm).
 */
export const CACHE_HIT_BONUS_MS = 60 * 60 * 1000;

/**
 * §9.4 step 2's retention bonus: `summary` and `embedding` cost money and
 * tokens; everything else is re-fetchable. 30 days, chosen by `P3-T33` and
 * recorded in `docs/07` §9.4 (owner to confirm).
 */
export const CACHE_RETENTION_BONUS_MS: Readonly<
  Record<CacheNamespace, number>
> = {
  "source-response": 0,
  "canonical-work": 0,
  summary: 30 * 24 * 60 * 60 * 1000,
  embedding: 30 * 24 * 60 * 60 * 1000,
  "llm-completion": 0,
  recommendation: 0,
  report: 0,
};

/** §9.4 step 3: evict to 90 % of a cap, not to the cap itself. */
export const CACHE_LOW_WATER_FRACTION = 0.9;

/** The tag every entry carries for §9.3 trigger 4. */
export const CACHE_SCHEMA_TAG = `schema:${String(CACHE_SCHEMA_VERSION)}`;

const QUIET = { debugParams: false } as const;
const DELETE_BATCH = 200;

const UPSERT =
  "INSERT INTO cache_entry " +
  "(namespace, key, value, blob_path, size_bytes, tags, created_at, expires_at, last_access, hits) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0) " +
  "ON CONFLICT(namespace, key) DO UPDATE SET " +
  "value = excluded.value, blob_path = excluded.blob_path, " +
  "size_bytes = excluded.size_bytes, tags = excluded.tags, " +
  "created_at = excluded.created_at, expires_at = excluded.expires_at, " +
  "last_access = excluded.last_access, hits = 0";

const SELECT_ENTRY =
  "SELECT value, blob_path, size_bytes, tags, created_at, expires_at, last_access, hits " +
  "FROM cache_entry WHERE namespace = ? AND key = ?";

/** A live (unexpired) entry exists. */
const LIVE = "(expires_at IS NULL OR expires_at > ?)";

const TAG_MATCH = "instr(',' || tags || ',', ?) > 0";

// ---------------------------------------------------------------------------
// 3. Helpers
// ---------------------------------------------------------------------------

function resultRows(result: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asOptionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined || value === false
    ? undefined
    : asNumber(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function splitTags(value: unknown): string[] {
  return typeof value === "string" && value !== "" ? value.split(",") : [];
}

function blobName(blobPath: string | undefined): string | undefined {
  return blobPath?.startsWith(CACHE_BLOB_PATH_PREFIX)
    ? blobPath.slice(CACHE_BLOB_PATH_PREFIX.length)
    : undefined;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The tags stored for an entry: the caller's, de-duplicated, plus
 * {@link CACHE_SCHEMA_TAG}.
 *
 * @throws RangeError for an empty tag or one containing `,` — `tags` is a
 *   comma-joined column (§8.3), so such a tag could never be invalidated alone
 */
function normalizeTags(tags: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const tag of [...(tags ?? []), CACHE_SCHEMA_TAG]) {
    if (tag === "" || tag.includes(",")) {
      throw new RangeError(
        `[research-helper] a cache tag must be non-empty and contain no comma; got ${JSON.stringify(tag)}`,
      );
    }
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

interface EntryRow {
  readonly rowid: number;
  readonly namespace: CacheNamespace;
  readonly key: string;
  readonly blobPath: string | undefined;
  readonly sizeBytes: number;
  readonly lastAccess: number;
  readonly hits: number;
  readonly tags: readonly string[];
}

const SELECT_META =
  "SELECT rowid AS rid, namespace, key, blob_path, size_bytes, last_access, hits, tags FROM cache_entry";

function entryRow(row: Record<string, unknown>): EntryRow {
  return {
    rowid: asNumber(row["rid"]),
    namespace: String(row["namespace"]) as CacheNamespace,
    key: String(row["key"]),
    blobPath: asOptionalString(row["blob_path"]),
    sizeBytes: asNumber(row["size_bytes"]),
    lastAccess: asNumber(row["last_access"]),
    hits: asNumber(row["hits"]),
    tags: splitTags(row["tags"]),
  };
}

/** §9.4 step 2's score, corrected 2026-10-21: lowest is evicted first. */
export function evictionScore(entry: {
  readonly namespace: CacheNamespace;
  readonly lastAccess: number;
  readonly hits: number;
}): number {
  return (
    entry.lastAccess +
    entry.hits * CACHE_HIT_BONUS_MS +
    CACHE_RETENTION_BONUS_MS[entry.namespace]
  );
}

function emptyByNamespace(): Record<
  CacheNamespace,
  { entries: number; bytes: number }
> {
  const out = {} as Record<CacheNamespace, { entries: number; bytes: number }>;
  for (const namespace of CACHE_NAMESPACES) {
    out[namespace] = { entries: 0, bytes: 0 };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. The store
// ---------------------------------------------------------------------------

/**
 * Build the cache. `installPluginDatabase` calls this once per enabled
 * lifetime; every job's `PipelineContext.cache` is the instance.
 */
export function createSqliteCache(deps: SqliteCacheDeps): SqliteCache {
  let closed = false;
  const inFlight = new Set<Promise<unknown>>();
  /** Blob names written whose row is not in yet: the orphan sweep skips them. */
  const pendingBlobs = new Set<string>();
  const computing = new Map<string, Promise<unknown>>();
  let pruning: Promise<CachePruneResult> | undefined;
  let hitCount = 0;
  let missCount = 0;

  const connection = async (): Promise<CacheSqlConnection | undefined> =>
    closed ? undefined : deps.connection();

  /** Run `work` as a tracked operation, so {@link SqliteCache.close} waits for it. */
  const track = <T>(work: () => Promise<T>): Promise<T> => {
    const promise = work();
    inFlight.add(promise);
    const forget = (): void => {
      inFlight.delete(promise);
    };
    promise.then(forget, forget);
    return promise;
  };

  const removeBlob = async (blobPath: string | undefined): Promise<void> => {
    const name = blobName(blobPath);
    if (name === undefined) return;
    try {
      await deps.blobs.remove(name);
    } catch (error) {
      // Left for prune()'s orphan sweep (§9.4 step 5).
      deps.logger.warn("a cache blob could not be removed", {
        reason: error instanceof Error ? error.name : typeof error,
      });
    }
  };

  const deleteRows = async (
    db: CacheSqlConnection,
    rows: readonly EntryRow[],
  ): Promise<void> => {
    for (let start = 0; start < rows.length; start += DELETE_BATCH) {
      const batch = rows.slice(start, start + DELETE_BATCH);
      await db.queryAsync(
        `DELETE FROM cache_entry WHERE rowid IN (${batch.map(() => "?").join(", ")})`,
        batch.map((row) => row.rowid),
        QUIET,
      );
    }
    for (const row of rows) await removeBlob(row.blobPath);
  };

  /** Select by `where`, delete by the same predicate, remove their blobs. */
  const deleteWhere = async (
    db: CacheSqlConnection,
    where: string,
    params: readonly CacheSqlParam[],
  ): Promise<readonly EntryRow[]> => {
    const rows = resultRows(
      await db.queryAsync(`${SELECT_META} WHERE ${where}`, params, QUIET),
    ).map(entryRow);
    if (rows.length === 0) return rows;
    await db.queryAsync(
      `DELETE FROM cache_entry WHERE ${where}`,
      params,
      QUIET,
    );
    for (const row of rows) await removeBlob(row.blobPath);
    return rows;
  };

  /** The live entry's value and meta, or `undefined`. Touches nothing. */
  const read = async <T>(
    db: CacheSqlConnection,
    namespace: CacheNamespace,
    key: string,
  ): Promise<{ value: T; meta: CacheEntryMeta } | undefined> => {
    const row = resultRows(
      await db.queryAsync(SELECT_ENTRY, [namespace, key], QUIET),
    )[0];
    if (row === undefined) return undefined;
    const expiresAt = asOptionalNumber(row["expires_at"]);
    if (expiresAt !== undefined && expiresAt <= deps.clock.now()) {
      return undefined;
    }
    const blobPath = asOptionalString(row["blob_path"]);
    let text = asOptionalString(row["value"]);
    if (blobPath !== undefined) {
      const name = blobName(blobPath);
      text = name === undefined ? undefined : await deps.blobs.read(name);
      if (text === undefined) {
        // The row outlived its file: drop the row, report a miss.
        await db.queryAsync(
          "DELETE FROM cache_entry WHERE namespace = ? AND key = ?",
          [namespace, key],
          QUIET,
        );
        deps.logger.warn("a cache entry's blob file was missing", {
          namespace,
        });
        return undefined;
      }
    }
    if (text === undefined) return undefined;
    return {
      value: JSON.parse(text) as T,
      meta: {
        key,
        namespace,
        createdAtEpochMs: asNumber(row["created_at"]),
        expiresAtEpochMs: expiresAt,
        lastAccessedEpochMs: asNumber(row["last_access"]),
        hits: asNumber(row["hits"]),
        sizeBytes: asNumber(row["size_bytes"]),
        tags: splitTags(row["tags"]),
      },
    };
  };

  /** A hit: count it and touch the row (§9.4's LRU input). */
  const lookup = async <T>(
    namespace: CacheNamespace,
    key: string,
  ): Promise<{ value: T; meta: CacheEntryMeta } | undefined> => {
    const db = await connection();
    if (db === undefined) return undefined;
    const found = await read<T>(db, namespace, key);
    if (found === undefined) {
      missCount += 1;
      return undefined;
    }
    hitCount += 1;
    const now = deps.clock.now();
    await db.queryAsync(
      "UPDATE cache_entry SET last_access = ?, hits = hits + 1 WHERE namespace = ? AND key = ?",
      [now, namespace, key],
      QUIET,
    );
    return {
      value: found.value,
      meta: {
        ...found.meta,
        lastAccessedEpochMs: now,
        hits: found.meta.hits + 1,
      },
    };
  };

  const totals = async (
    db: CacheSqlConnection,
    namespace?: CacheNamespace,
  ): Promise<number> =>
    asNumber(
      await db.valueQueryAsync(
        namespace === undefined
          ? "SELECT SUM(size_bytes) FROM cache_entry"
          : "SELECT SUM(size_bytes) FROM cache_entry WHERE namespace = ?",
        namespace === undefined ? [] : [namespace],
        QUIET,
      ),
    );

  const write = async <T>(
    namespace: CacheNamespace,
    key: string,
    value: T,
    options: CacheSetOptions | undefined,
  ): Promise<void> => {
    const json = JSON.stringify(value) as string | undefined;
    if (json === undefined) {
      throw new TypeError(
        "[research-helper] a cache value must have a JSON form; undefined, a function or a symbol has none",
      );
    }
    const tags = normalizeTags(options?.tags);
    const ttlMs = options?.ttlMs ?? CACHE_NAMESPACE_POLICIES[namespace].ttlMs;
    if (ttlMs !== undefined && !(Number.isFinite(ttlMs) && ttlMs >= 0)) {
      throw new RangeError(
        `[research-helper] a cache TTL must be a non-negative number of ms; got ${String(ttlMs)}`,
      );
    }
    const sizeBytes = utf8Length(json);
    if (
      options?.maxValueBytes !== undefined &&
      sizeBytes > options.maxValueBytes
    ) {
      return;
    }
    const db = await connection();
    if (db === undefined) return;

    const previous = asOptionalString(
      resultRows(
        await db.queryAsync(
          "SELECT blob_path FROM cache_entry WHERE namespace = ? AND key = ?",
          [namespace, key],
          QUIET,
        ),
      )[0]?.["blob_path"],
    );
    const spill = sizeBytes > CACHE_BLOB_THRESHOLD_BYTES;
    // One file per entry, named by the entry rather than by the value, so two
    // entries holding equal values never share (and never delete) one file.
    const name = spill ? sha256Hex(`${namespace}|${key}`) : undefined;
    const now = deps.clock.now();
    if (name !== undefined) pendingBlobs.add(name);
    try {
      if (name !== undefined) await deps.blobs.write(name, json);
      await db.queryAsync(
        UPSERT,
        [
          namespace,
          key,
          name === undefined ? json : null,
          name === undefined ? null : `${CACHE_BLOB_PATH_PREFIX}${name}`,
          sizeBytes,
          tags.join(","),
          now,
          ttlMs === undefined ? null : now + ttlMs,
          now,
        ],
        QUIET,
      );
    } finally {
      if (name !== undefined) pendingBlobs.delete(name);
    }
    if (previous !== undefined && name === undefined) {
      await removeBlob(previous);
    }

    // §9.4: "immediately after any write that pushes the cache over its cap".
    if (
      (await totals(db, namespace)) >
        CACHE_NAMESPACE_POLICIES[namespace].capBytes ||
      (await totals(db)) > deps.maxBytes()
    ) {
      await pruneOnce();
    }
  };

  /** Evict lowest-scoring, unpinned rows until `total` ≤ `lowWater`. */
  const evict = async (
    db: CacheSqlConnection,
    namespace: CacheNamespace | undefined,
    total: number,
    lowWater: number,
  ): Promise<{ count: number; bytes: number }> => {
    const pinned = new Set(deps.pinnedTags?.() ?? []);
    const rows = resultRows(
      await db.queryAsync(
        namespace === undefined
          ? SELECT_META
          : `${SELECT_META} WHERE namespace = ?`,
        namespace === undefined ? [] : [namespace],
        QUIET,
      ),
    )
      .map(entryRow)
      .filter((row) => !row.tags.some((tag) => pinned.has(tag)))
      .sort((a, b) => evictionScore(a) - evictionScore(b) || a.rowid - b.rowid);
    const victims: EntryRow[] = [];
    let remaining = total;
    let bytes = 0;
    for (const row of rows) {
      if (remaining <= lowWater) break;
      victims.push(row);
      remaining -= row.sizeBytes;
      bytes += row.sizeBytes;
    }
    await deleteRows(db, victims);
    return { count: victims.length, bytes };
  };

  const prune = async (): Promise<CachePruneResult> => {
    const db = await connection();
    if (db === undefined) {
      return { expiredRemoved: 0, evictedForSize: 0, bytesReclaimed: 0 };
    }
    // 1. Expired entries.
    const expired = await deleteWhere(
      db,
      "expires_at IS NOT NULL AND expires_at <= ?",
      [deps.clock.now()],
    );
    let bytesReclaimed = expired.reduce((sum, row) => sum + row.sizeBytes, 0);
    let evictedForSize = 0;

    // 2. Per-namespace caps first, so a runaway namespace cannot starve
    //    summaries; then 3. the global cap. Both to a 90 % low-water mark.
    for (const namespace of CACHE_NAMESPACES) {
      const cap = CACHE_NAMESPACE_POLICIES[namespace].capBytes;
      const total = await totals(db, namespace);
      if (total > cap) {
        const out = await evict(
          db,
          namespace,
          total,
          cap * CACHE_LOW_WATER_FRACTION,
        );
        evictedForSize += out.count;
        bytesReclaimed += out.bytes;
      }
    }
    const globalCap = deps.maxBytes();
    const total = await totals(db);
    if (total > globalCap) {
      const out = await evict(
        db,
        undefined,
        total,
        globalCap * CACHE_LOW_WATER_FRACTION,
      );
      evictedForSize += out.count;
      bytesReclaimed += out.bytes;
    }

    // 5. Orphaned blob files.
    const referenced = new Set(
      resultRows(
        await db.queryAsync(
          "SELECT blob_path FROM cache_entry WHERE blob_path IS NOT NULL",
          [],
          QUIET,
        ),
      ).map((row) => blobName(asOptionalString(row["blob_path"]))),
    );
    for (const name of await deps.blobs.list()) {
      if (!referenced.has(name) && !pendingBlobs.has(name)) {
        await removeBlob(`${CACHE_BLOB_PATH_PREFIX}${name}`);
      }
    }
    return { expiredRemoved: expired.length, evictedForSize, bytesReclaimed };
  };

  /** One prune at a time; a second caller shares the first's result. */
  const pruneOnce = (): Promise<CachePruneResult> => {
    pruning ??= prune().finally(() => {
      pruning = undefined;
    });
    return pruning;
  };

  const cache: SqliteCache = {
    get<T>(namespace: CacheNamespace, key: string): Promise<T | undefined> {
      return track(async () => (await lookup<T>(namespace, key))?.value);
    },

    getWithMeta<T>(namespace: CacheNamespace, key: string) {
      return track(() => lookup<T>(namespace, key));
    },

    set<T>(
      namespace: CacheNamespace,
      key: string,
      value: T,
      options?: CacheSetOptions,
    ): Promise<void> {
      return track(() => write(namespace, key, value, options));
    },

    getOrCompute<T>(
      namespace: CacheNamespace,
      key: string,
      compute: () => Promise<T>,
      options?: CacheSetOptions,
    ): Promise<T> {
      const id = `${namespace}\u0000${key}`;
      const running = computing.get(id);
      if (running !== undefined) return running as Promise<T>;
      const shared = track(async () => {
        const found = await lookup<T>(namespace, key);
        if (found !== undefined) return found.value;
        const value = await compute();
        await write(namespace, key, value, options);
        return value;
      }).finally(() => {
        computing.delete(id);
      });
      computing.set(id, shared);
      return shared;
    },

    has(namespace: CacheNamespace, key: string): Promise<boolean> {
      return track(async () => {
        const db = await connection();
        if (db === undefined) return false;
        const found = await db.valueQueryAsync(
          `SELECT 1 FROM cache_entry WHERE namespace = ? AND key = ? AND ${LIVE}`,
          [namespace, key, deps.clock.now()],
          QUIET,
        );
        return found !== false && found !== undefined && found !== null;
      });
    },

    delete(namespace: CacheNamespace, key: string): Promise<void> {
      return track(async () => {
        const db = await connection();
        if (db === undefined) return;
        await deleteWhere(db, "namespace = ? AND key = ?", [namespace, key]);
      });
    },

    invalidateByTag(tag: string): Promise<number> {
      return track(async () => {
        const db = await connection();
        if (db === undefined) return 0;
        const rows = await deleteWhere(db, TAG_MATCH, [`,${tag},`]);
        return rows.length;
      });
    },

    clearNamespace(namespace: CacheNamespace): Promise<number> {
      return track(async () => {
        const db = await connection();
        if (db === undefined) return 0;
        const rows = await deleteWhere(db, "namespace = ?", [namespace]);
        return rows.length;
      });
    },

    prune(): Promise<CachePruneResult> {
      return track(pruneOnce);
    },

    stats(): Promise<CacheStats> {
      return track(async () => {
        const byNamespace = emptyByNamespace();
        let entries = 0;
        let bytes = 0;
        const db = await connection();
        if (db !== undefined) {
          const rows = resultRows(
            await db.queryAsync(
              "SELECT namespace, COUNT(*) AS n, SUM(size_bytes) AS b FROM cache_entry GROUP BY namespace",
              [],
              QUIET,
            ),
          );
          for (const row of rows) {
            const namespace = String(row["namespace"]) as CacheNamespace;
            const n = asNumber(row["n"]);
            const b = asNumber(row["b"]);
            if (namespace in byNamespace) {
              byNamespace[namespace] = { entries: n, bytes: b };
            }
            entries += n;
            bytes += b;
          }
        }
        const lookups = hitCount + missCount;
        return {
          entries,
          bytes,
          byNamespace,
          hitRate: lookups === 0 ? 0 : hitCount / lookups,
        };
      });
    },

    async close(): Promise<void> {
      closed = true;
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },
  };
  return cache;
}
