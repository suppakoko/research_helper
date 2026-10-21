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
 * (`P2-T17`), the cache (`P3-T33`), the job store (`P3-T34`), and the summary
 * store when `P3-T26` adds it.
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
 * the job store; close the connection. `closeDatabase(true)` checkpoints the
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
import {
  createJobStore,
  createProvenanceStore,
  type SqlConnection,
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
   * Attach the job queue's store once the database is ready, then run
   * `docs/07` §7.6's startup recovery (not awaited; teardown awaits it).
   * `installServices` calls this once, after it has built the queue.
   */
  attachJobs(jobs: JobQueue): void;
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

  scope.defer(
    "the plugin database (research-helper.sqlite), its cache and its job store",
    async () => {
      await ready;
      pruneTimer.cancel({ kind: "shutdown" });
      await pruneLoop;
      await cache.close();
      await recovering;
      jobsAttached?.detachStore();
      jobsAttached = undefined;
      pruneTimer.dispose();
      const opened = connection;
      connection = undefined;
      await opened?.closeDatabase(true);
    },
  );

  return {
    ready,
    cache,
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
  };
}
