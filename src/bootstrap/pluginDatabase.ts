/**
 * The plugin database's lifetime, owned by the service graph (`P3-T33`;
 * `plan/00` §6 item 249, owner, 2026-10-21; `docs/07` §8.3's dated note).
 *
 * `installServices` (`src/bootstrap/container.ts`) calls
 * {@link installPluginDatabase} once at startup. It opens
 * `research-helper.sqlite` — **the one connection**: Zotero opens a named
 * `DBConnection` with `PRAGMA locking_mode=EXCLUSIVE` (read out of Zotero
 * 10.0.3's `db.js`), so a second connection would be refused — and every
 * store the plugin keeps in the file is built over it: the provenance store
 * (`P2-T17`), the cache (`P3-T33`), the job store (`P3-T34`), the user price
 * table (`user_price`, `plan/00` §6 item 265 (b), owner, 2026-10-21) and the
 * summary store (`createSummaryStore`, built here by `P3-T29`; this line
 * said "when `P3-T26` adds it" until 2026-10-29) and the report store
 * (`createReportStore`, `P4-T14`: the `report` table and the Markdown files
 * in `<data dir>/research-helper/reports/`) and the three stores Phase 5 reads
 * (`P5-T03`: `createCollectionProfileStore`, `createRecommendationStore`,
 * `createEmbeddingStore`).
 *
 * ## Why the open is synchronous and the migrations are not
 *
 * `Zotero.DBConnection` connects on its first query, so
 * `openPluginDatabase()` returns at once and `installServices` can call it in
 * line. The migrations are queries, and `docs/10` NFR-10 gives the whole
 * plugin 200 ms of startup that `P1-T23`'s measurement already runs close to,
 * so they run **in the background**: {@link PluginDatabase.ready} is that
 * work, and every store waits on it rather than startup waiting on the file.
 * This is the same arrangement `src/bootstrap/registerUI.ts`'s
 * `openProvenanceStore` had since `P2-T17`; only the owner moved.
 *
 * ## Teardown order
 *
 * Registered in the root scope at the point `installServices` calls this, so
 * it runs after every registration made later (the search window host, the
 * menus, the published provenance store) has been undone, and before the
 * preference store, the HTTP client and the limiters go. In order: wait for
 * the open-and-migrate; stop the scheduled prune; close the cache (waits for
 * its operations in flight); await the job queue's startup recovery; detach
 * the job store; wait for the user price table's calls in flight; close the
 * connection. `closeDatabase(true)` checkpoints the
 * WAL and releases the exclusive lock, so the fresh instance a disable/enable
 * cycle creates can open the file again.
 *
 * ## No database is a working configuration
 *
 * When no {@link PluginDatabaseSource} is given (a layer-1 unit test of the
 * graph) or the open or a migration fails, {@link PluginDatabase.ready}
 * resolves `undefined` — it never rejects — the job queue stays storeless, and
 * the cache stores nothing. "Re-run This Search…" is then absent rather than
 * broken (`P2-T17`'s Notes).
 */

import type { CacheBlobStore } from "../core/cache/sqliteCache";
import { createSqliteCache, type SqliteCache } from "../core/cache/sqliteCache";
import type { Cache } from "../core/cache/cache";
import type { Clock } from "../core/clock";
import { createCancellationTokenSource } from "../core/jobQueue/cancellation";
import type { JobQueue } from "../core/jobQueue/queue";
import type { Logger } from "../core/logger";
import type { ProvenanceStore } from "../core/provenance";
import type { UserPriceStore } from "../llm/shared/pricing";
import {
  createCollectionProfileStore,
  createEmbeddingStore,
  createJobStore,
  createProvenanceStore,
  createRecommendationStore,
  createReportStore,
  createSummaryStore,
  createUserPriceStore,
  type CollectionProfileStore,
  type EmbeddingStore,
  type RecommendationStore,
  type ReportMarkdownFiles,
  type ReportStore,
  type SqlConnection,
  type SummaryStore,
} from "../zotero/db";
import type { Scope } from "./container";
import { runMigrations } from "./migrations";

/** The platform halves `src/bootstrap/registerUI.ts` passes in. */
export interface PluginDatabaseSource {
  /** `src/zotero/db.ts`'s `openPluginDatabase`. Synchronous; may throw. */
  open(): SqlConnection;
  /** `src/zotero/db.ts`'s `pluginDatabasePath`, for the log and the spec. */
  path(): string;
  /** `src/zotero/db.ts`'s `createCacheBlobStore()`. */
  readonly blobs: CacheBlobStore;
  /**
   * The report Markdown files (`P4-T14`); absent, `src/zotero/db.ts`'s
   * `createReportMarkdownFiles()` in `<data dir>/research-helper/reports/`.
   */
  readonly reportFiles?: ReportMarkdownFiles;
}

/** The database once it is open and migrated. */
export interface OpenPluginDatabase {
  /** The one connection. */
  readonly connection: SqlConnection;
  /** `<Zotero.DataDirectory.dir>/research-helper.sqlite`. */
  readonly path: string;
  /** The schema version the file was at before this start (`0`: new). */
  readonly schemaFrom: number;
  /** The schema version `runMigrations` left it at. */
  readonly schemaVersion: number;
  /** FR-12's store (`P2-T17`), on the connection. */
  readonly provenance: ProvenanceStore;
  /** The user price table (`plan/00` §6 item 265 (b)), on the connection. */
  readonly prices: UserPriceStore;
  /**
   * The `summary` table (`P3-T25`'s `createSummaryStore`), on the connection
   * — built here by `P3-T29`, the first card that runs `summarizeItem` in the
   * product.
   */
  readonly summaries: SummaryStore;
  /**
   * The `report` table and its Markdown files (`P4-T14`'s
   * `createReportStore`), on the connection. The trend-report run
   * (`trendReportPipeline.ts`, `P4-T18`) receives it through
   * {@link PluginDatabase.reports}.
   */
  readonly reports: ReportStore;
  /** The `collection_profile` table (`P5-T03`), on the connection. */
  readonly collectionProfiles: CollectionProfileStore;
  /** The `recommendation` table (`P5-T03`), on the connection. */
  readonly recommendations: RecommendationStore;
  /** The `embedding` table (`P5-T03`), on the connection. */
  readonly embeddings: EmbeddingStore;
}

/** {@link installPluginDatabase}'s answer, held on the service graph. */
export interface PluginDatabase {
  /**
   * The open-and-migrate, not awaited by startup. Resolves `undefined` —
   * never rejects — when there is no database this run.
   */
  readonly ready: Promise<OpenPluginDatabase | undefined>;
  /** `docs/07` §4.1's cache over `cache_entry`; stores nothing without a database. */
  readonly cache: Cache;
  /**
   * The user-edited price table (`user_price`; `plan/00` §6 item 265 (b),
   * owner, 2026-10-21), usable before {@link ready} settles: each call waits
   * for it. Without a database, or once teardown has begun, `list()` answers
   * an empty table and `upsert()` / `delete()` reject. Teardown waits for
   * calls in flight before it closes the connection. The model catalogue
   * reads it as `userPriceOverrides: () => graph.database.prices.list()`.
   */
  readonly prices: UserPriceStore;
  /**
   * The summary store (`P3-T29`) once the database is open: each call waits
   * for {@link ready}, and resolves `undefined` without a database or once
   * teardown has begun. Every call made through the store it returns is
   * tracked, and teardown waits for it before the connection closes. The
   * summarize pipeline reads it as `store`; the item pane may too.
   */
  readonly summaries: () => Promise<SummaryStore | undefined>;
  /**
   * The report store (`P4-T14`) once the database is open, handed out as
   * {@link summaries} is: each call waits for {@link ready}, resolves
   * `undefined` without a database or once teardown has begun, and every
   * call made through the store it returns is tracked, so teardown waits for
   * a report being written before the connection closes. `installServices`
   * passes it to the trend-report run (`P4-T18`).
   */
  readonly reports: () => Promise<ReportStore | undefined>;
  /**
   * The collection profile store (`P5-T03`), handed out as {@link summaries}
   * is. Its callers are the recommend pipeline's: `P5-T18` and `P5-T25`, which
   * `installServices` wires (`P5-T25`).
   */
  readonly collectionProfiles: () => Promise<
    CollectionProfileStore | undefined
  >;
  /**
   * The recommendation store (`P5-T03`), handed out as {@link summaries} is.
   * Its callers are `P5-T21`, `P5-T24` and `P5-T25`.
   */
  readonly recommendations: () => Promise<RecommendationStore | undefined>;
  /**
   * The vector store (`P5-T03`), handed out as {@link summaries} is, so teardown
   * waits for a `putMany` or an eviction in flight. Its caller is
   * `ensureEmbeddings` (`P5-T20`).
   */
  readonly embeddings: () => Promise<EmbeddingStore | undefined>;
  /**
   * Attach the job queue's store once the database is ready, then run
   * `docs/07` §7.6's startup recovery (not awaited; teardown awaits it).
   * `installServices` calls this once, after it has built the queue.
   */
  attachJobs(jobs: JobQueue): void;
  /**
   * Settles when {@link attachJobs}' recovery has ended, whatever its outcome;
   * at once before it is called. `publishReportWindowCommands` waits for it, so
   * the paused-job notice reads the records as recovery left them (`P4-T21`).
   */
  recovery(): Promise<void>;
}

/** What {@link installPluginDatabase} needs. */
export interface PluginDatabaseDeps {
  /** Absent: no database this run (a unit test of the graph). */
  readonly source: PluginDatabaseSource | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The global cache cap in bytes, from `cache.maxSizeMB` (§8.5), on demand. */
  readonly cacheMaxBytes: () => number;
  /**
   * §9.4 step 4: the `work:<workKey>` tags of running jobs, which `prune()`
   * never evicts. `installServices` passes `RunningWork.pinnedTags`
   * (`src/core/jobQueue/queue.ts`, `P3-T17`); absent, nothing is pinned.
   */
  readonly pinnedTags?: () => readonly string[];
}

/** `docs/07` §9.4: the first prune waits ~30 s, so it does not compete with startup. */
export const CACHE_PRUNE_STARTUP_DELAY_MS = 30_000;

/** `docs/07` §9.4: then every 6 hours while running. */
export const CACHE_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Open the plugin database, start its migrations, build the cache over it,
 * and register the teardown that closes it — see this file's header.
 *
 * @param scope - the root scope; the teardown is registered here
 * @param deps - the source, clock, logger and the global cache cap
 * @returns the database's lifetime, for the service graph
 */
export function installPluginDatabase(
  scope: Scope,
  deps: PluginDatabaseDeps,
): PluginDatabase {
  const { logger } = deps;
  let connection: SqlConnection | undefined;
  let recovering: Promise<void> | undefined;
  let jobsAttached: JobQueue | undefined;

  const ready: Promise<OpenPluginDatabase | undefined> = (async () => {
    const source = deps.source;
    if (source === undefined) return undefined;
    try {
      connection = source.open();
      const outcome = await runMigrations(connection);
      logger.info("the plugin database is open", {
        schemaFrom: outcome.from,
        schemaTo: outcome.to,
      });
      return {
        connection,
        path: source.path(),
        schemaFrom: outcome.from,
        schemaVersion: outcome.to,
        provenance: createProvenanceStore(connection),
        prices: createUserPriceStore(connection),
        summaries: createSummaryStore(connection),
        reports:
          source.reportFiles === undefined
            ? createReportStore(connection)
            : createReportStore(connection, source.reportFiles),
        collectionProfiles: createCollectionProfileStore(connection),
        recommendations: createRecommendationStore(connection),
        embeddings: createEmbeddingStore(connection),
      };
    } catch (error) {
      logger.error(
        "the plugin database could not be opened or migrated; the cache, " +
          "the job store and Re-run This Search… stay unavailable until the next start",
        { reason: reasonOf(error) },
      );
      const opened = connection;
      connection = undefined;
      await opened?.closeDatabase(true).catch(() => undefined);
      return undefined;
    }
  })();

  const cache: SqliteCache = createSqliteCache({
    connection: async () => {
      await ready;
      return connection;
    },
    blobs: deps.source?.blobs ?? {
      write: () => Promise.resolve(),
      read: () => Promise.resolve(undefined),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve([]),
    },
    clock: deps.clock,
    logger: logger.child({ surface: "cache" }),
    maxBytes: deps.cacheMaxBytes,
    ...(deps.pinnedTags !== undefined && { pinnedTags: deps.pinnedTags }),
  });

  // §9.4's schedule: once ~30 s after startup, then every 6 hours. Only with
  // a database; cancelled by the teardown below.
  const pruneTimer = createCancellationTokenSource();
  const pruneLoop: Promise<void> =
    deps.source === undefined
      ? Promise.resolve()
      : (async () => {
          let delay = CACHE_PRUNE_STARTUP_DELAY_MS;
          for (;;) {
            try {
              await deps.clock.sleep(delay, pruneTimer.token);
            } catch {
              return; // cancelled: the plugin is shutting down
            }
            try {
              const result = await cache.prune();
              logger.debug("cache pruned", { ...result });
            } catch (error) {
              logger.warn("the cache prune failed", {
                reason: reasonOf(error),
              });
            }
            delay = CACHE_PRUNE_INTERVAL_MS;
          }
        })();

  // The user price table: each call waits for the open, and teardown waits
  // for the calls in flight before the connection closes.
  let closing = false;
  const inFlight = new Set<Promise<unknown>>();
  function tracked<T>(work: Promise<T>): Promise<T> {
    inFlight.add(work);
    const done = (): void => {
      inFlight.delete(work);
    };
    work.then(done, done);
    return work;
  }
  async function openPrices(): Promise<UserPriceStore | undefined> {
    const open = await ready;
    return closing ? undefined : open?.prices;
  }
  const PRICES_UNAVAILABLE =
    "[research-helper] the plugin database is not available; the user price " +
    "table was not changed";
  const prices: UserPriceStore = {
    list: () =>
      tracked(
        (async () => {
          const store = await openPrices();
          return store === undefined ? [] : store.list();
        })(),
      ),
    upsert: (row) =>
      tracked(
        (async () => {
          const store = await openPrices();
          if (store === undefined) throw new Error(PRICES_UNAVAILABLE);
          await store.upsert(row);
        })(),
      ),
    delete: (providerId, modelId) =>
      tracked(
        (async () => {
          const store = await openPrices();
          if (store === undefined) throw new Error(PRICES_UNAVAILABLE);
          await store.delete(providerId, modelId);
        })(),
      ),
  };

  scope.defer(
    "the plugin database (research-helper.sqlite), its cache and its job store",
    async () => {
      await ready;
      closing = true;
      pruneTimer.cancel({ kind: "shutdown" });
      await pruneLoop;
      await cache.close();
      await recovering;
      jobsAttached?.detachStore();
      jobsAttached = undefined;
      pruneTimer.dispose();
      await Promise.allSettled([...inFlight]);
      const opened = connection;
      connection = undefined;
      await opened?.closeDatabase(true);
    },
  );

  // The summary store (`P3-T29`): handed out per call, each call tracked like
  // the price table's, and nothing once teardown has begun.
  const summaries = async (): Promise<SummaryStore | undefined> => {
    const open = await ready;
    if (open === undefined || closing) return undefined;
    const store = open.summaries;
    return {
      put: (record) => tracked(store.put(record)),
      get: (id) => tracked(store.get(id)),
      listForWork: (workKey) => tracked(store.listForWork(workKey)),
    };
  };

  // The report store (`P4-T14`), handed out and tracked as the summary
  // store is.
  const reports = async (): Promise<ReportStore | undefined> => {
    const open = await ready;
    if (open === undefined || closing) return undefined;
    const store = open.reports;
    return {
      put: (report) => tracked(store.put(report)),
      get: (id) => tracked(store.get(id)),
    };
  };

  // The three stores Phase 5 reads (`P5-T03`), handed out and tracked as the
  // summary store is.
  const collectionProfiles = async (): Promise<
    CollectionProfileStore | undefined
  > => {
    const open = await ready;
    if (open === undefined || closing) return undefined;
    const store = open.collectionProfiles;
    return {
      put: (profile) => tracked(store.put(profile)),
      get: (id) => tracked(store.get(id)),
    };
  };
  const recommendations = async (): Promise<
    RecommendationStore | undefined
  > => {
    const open = await ready;
    if (open === undefined || closing) return undefined;
    const store = open.recommendations;
    return {
      put: (recommendation) => tracked(store.put(recommendation)),
      reject: (id, atEpochMs) => tracked(store.reject(id, atEpochMs)),
      listRejected: (profileId, limit) =>
        tracked(store.listRejected(profileId, limit)),
    };
  };
  const embeddings = async (): Promise<EmbeddingStore | undefined> => {
    const open = await ready;
    if (open === undefined || closing) return undefined;
    const store = open.embeddings;
    return {
      putMany: (rows) => tracked(store.putMany(rows)),
      getMany: (workKeys, model) => tracked(store.getMany(workKeys, model)),
      allForModel: (model) => tracked(store.allForModel(model)),
      evictToCap: (isInLibrary) => tracked(store.evictToCap(isInLibrary)),
    };
  };

  return {
    ready,
    cache,
    prices,
    summaries,
    reports,
    collectionProfiles,
    recommendations,
    embeddings,
    attachJobs(jobs: JobQueue): void {
      recovering = ready.then(async (open) => {
        if (open === undefined) return;
        // The job queue's store, on this same connection (`P3-T34`), then
        // §7.6's startup recovery. A failure is logged and closes nothing.
        jobs.attachStore(createJobStore(open.connection));
        jobsAttached = jobs;
        try {
          const recovery = await jobs.recover();
          logger.info("job recovery done", {
            interrupted: recovery.interrupted.length,
            autoResumed: recovery.autoResumed.length,
            waitingForGuards: recovery.waitingForGuards.length,
            pausedByGuard: recovery.pausedByGuard.length,
            awaitingUserDecision: recovery.awaitingUserDecision.length,
            failed: recovery.failed.length,
          });
        } catch (error) {
          logger.warn("job recovery failed", { reason: reasonOf(error) });
        }
      });
    },
    recovery(): Promise<void> {
      return recovering ?? Promise.resolve();
    },
  };
}
