/**
 * The plugin-owned SQLite database, and the one store Phase 2 keeps in it
 * (`P2-T17`; `docs/07` §8.2, §8.3, §8.4).
 *
 * ## Where the file is, and what it is not
 *
 * `docs/07` §8.2: `new Zotero.DBConnection("research-helper")` resolves the
 * name through `Zotero.DataDirectory.getDatabase(name)`, which is
 * `<Zotero.DataDirectory.dir>/research-helper.sqlite`. So the file lives in the
 * **data directory** — `docs/07` §8.4's home for plugin-owned files, the one a
 * user's backup reaches and a relocated data directory carries — and neither
 * path is hard-coded: a user who moved their data directory moves this file
 * with it. It is **never** Zotero's own `zotero.sqlite`: `docs/07` §8.2 quotes
 * Better BibTeX's author on why a plugin table inside Zotero's database "could
 * also easily break zotero database migrations".
 *
 * A name rather than an absolute path, on purpose. Read out of the installed
 * Zotero 10.0.3's `db.js`: an absolute path marks the connection
 * `_externalDB`, which skips Zotero's WAL setup, its exclusive lock and its
 * corruption handling. The name gets all three, and the name is what §8.2's
 * decision ("`Zotero.DBConnection("research-helper")` — primary") specifies.
 *
 * ## What this file exposes
 *
 * - {@link openPluginDatabase} and {@link pluginDatabasePath} — the connection,
 *   opened once by `installServices` (`src/bootstrap/container.ts`, through
 *   `src/bootstrap/pluginDatabase.ts`'s `installPluginDatabase`) at startup and
 *   closed in the service graph's teardown (`plan/00` §6 item 249, owner,
 *   2026-10-21). Until then `src/bootstrap/registerUI.ts` opened it.
 * - {@link createProvenanceStore} — `src/core/provenance.ts`'s
 *   `ProvenanceStore` port, with **exactly the two operations** `P2-T17` step 1
 *   names. Phase 3 widens it (`P3-T15`, `P3-T29`).
 * - {@link createJobStore} — `src/core/jobQueue/queue.ts`'s `JobStore` port
 *   over the `job` table (`P3-T34`), on the same connection.
 * - {@link createUserPriceStore} — `src/llm/shared/pricing.ts`'s
 *   `UserPriceStore` port over the `user_price` table (`plan/00` §6 item 265
 *   (b), owner, 2026-10-21), on the same connection.
 * - {@link createCollectionSettingsStore} — {@link CollectionSettingsStore}
 *   over the `collection_settings` table (`P3-T15`; `docs/07` §8.3), on the
 *   same connection. The port is declared here, not by its reader
 *   (`src/pipeline/shared/privacyPolicy.ts`), because `zotero/` may not import
 *   `pipeline/` (`docs/07` §2.3); the store keeps a JSON object and the
 *   pipeline gives it meaning.
 * - {@link createSummaryStore} — {@link SummaryStore} over the `summary`
 *   table (`P3-T25`; `docs/07` §5.2, §8.3), on the same connection; every
 *   row passes the redaction gate ({@link gateStoredSummary}).
 * - {@link createReportStore} — {@link ReportStore} over the `report` table
 *   and its Markdown files in `<data dir>/research-helper/reports/`
 *   (`P4-T14`; `docs/07` §5.2, §8.3), on the same connection; every report
 *   passes the redaction gate ({@link gateTrendReport}).
 * - {@link createCollectionProfileStore} — {@link CollectionProfileStore} over
 *   the `collection_profile` table (`P5-T03`; `docs/07` §5.2, §8.3), on the same
 *   connection; every profile passes the gate ({@link gateCollectionProfile}).
 * - {@link createRecommendationStore} — {@link RecommendationStore} over the
 *   `recommendation` table (`P5-T03`; `docs/07` §5.2, §8.3), on the same
 *   connection; every row passes the gate ({@link gateRecommendation}).
 * - {@link createEmbeddingStore} — {@link EmbeddingStore} over the `embedding`
 *   table (`P5-T03`; `docs/07` §8.3, §9.2), on the same connection. No JSON
 *   column, so nothing to gate; the table is capped ({@link EMBEDDING_CAP_BYTES}).
 * - {@link createCacheBlobStore} — `src/core/cache/sqliteCache.ts`'s
 *   `CacheBlobStore` port: `docs/07` §9.2's blob directory for cache values
 *   over 256 KB (`P3-T33`). The `cache_entry` rows themselves are written by
 *   `sqliteCache.ts` through the connection.
 *
 * The schema is not here: `src/bootstrap/migrations.ts` owns it, as `docs/07`
 * §8.3 says ("migrations in `src/bootstrap/migrations.ts`, versioned in a
 * `schema_version` table").
 *
 * ## Two things that stay Phase 3
 *
 * The §8.2 capability probe that chooses between `Zotero.DBConnection`,
 * `Sqlite.sys.mjs` and the `JsonFilePluginStore` fallback is **not** built
 * here (`P2-T17` Notes). Until it is, a profile where the connection cannot be
 * opened degrades to "Re-run This Search…" being absent rather than broken.
 */

import {
  JOB_COLUMNS,
  type JobRow,
  type JobStatus,
} from "../core/jobQueue/jobRecord";
import type { JobStore } from "../core/jobQueue/queue";
import type { CacheBlobStore } from "../core/cache/sqliteCache";
import { StorageError } from "../core/errors";
import {
  parseStoredProvenance,
  redactRecord,
  serializeProvenance,
  type ProvenanceStore,
  type SearchProvenance,
} from "../core/provenance";
import {
  isUsableUserPriceOverride,
  type UserPriceOverride,
  type UserPriceStore,
} from "../llm/shared/pricing";
import type { ProviderId } from "../model/ids";
import type { CollectionProfile } from "../model/profile";
import type { Recommendation } from "../model/recommendation";
import type { StoredRedactionMark, StoredSummary } from "../model/summary";
import type { TrendReport } from "../model/trend";

/** The name `Zotero.DBConnection` resolves in the data directory (§8.2). */
export const PLUGIN_DATABASE_NAME = "research-helper";

/**
 * The file name the name above resolves to — `Zotero.DataDirectory`'s
 * `getDatabaseFilename(name)` is `name + ".sqlite"`. Stated here so a test can
 * look for the file without repeating the rule.
 */
export const PLUGIN_DATABASE_FILE = `${PLUGIN_DATABASE_NAME}.sqlite`;

/**
 * Per-query options this file passes. `debugParams: false` keeps a bound
 * parameter out of Zotero's debug log: read out of Zotero 10.0.3's `db.js`,
 * `logQuery` writes every bound value to `Zotero.debug` when debug output is
 * on, and the `json` parameter is a whole provenance record. The record is
 * already redacted, but the debug log is a channel the record does not need
 * to reach.
 */
export interface SqlQueryOptions {
  readonly debugParams?: boolean;
  /**
   * Read out of Zotero 10.0.3's `db.js`: `queryAsync` uses `conn.execute`
   * instead of `executeCached`, which keeps one prepared statement per distinct
   * SQL text for the connection's life. For a statement whose placeholder count
   * varies ({@link EMBEDDING_IN_LIST_MAX}).
   */
  readonly noCache?: boolean;
}

/**
 * One bound parameter. `null` is SQL `NULL`. A `Uint8Array` is a `BLOB`:
 * `Sqlite.sys.mjs`'s `bindParam` binds one with `bindBlobByIndex` (read out of
 * Zotero 10.0.3's `omni.ja`; `P5-T03`).
 */
export type SqlParam = string | number | null | Uint8Array;

/**
 * The slice of `Zotero.DBConnection` this plugin uses, as a port.
 *
 * Narrow on purpose — `docs/07` §8.2 trap 3: `Zotero.DBConnection` "is not a
 * documented-stable plugin API", so the fewer of its members the code above
 * this line names, the less a Zotero release can break. The signatures are the
 * installed Zotero 10.0.3's: `valueQueryAsync` resolves to **`false`** when no
 * row matched, not to `undefined`.
 */
export interface SqlConnection {
  queryAsync(
    sql: string,
    params?: readonly SqlParam[],
    options?: SqlQueryOptions,
  ): Promise<unknown>;
  valueQueryAsync(
    sql: string,
    params?: readonly SqlParam[],
    options?: SqlQueryOptions,
  ): Promise<unknown>;
  executeTransaction<T>(func: () => Promise<T>): Promise<T>;
  closeDatabase(permanent?: boolean): Promise<void>;
}

/**
 * Open (lazily — `Zotero.DBConnection` connects on first query) the plugin's
 * own database in the data directory.
 *
 * @returns the connection, as the {@link SqlConnection} port
 */
export function openPluginDatabase(): SqlConnection {
  const Connection = Zotero.DBConnection as unknown as new (
    name: string,
  ) => SqlConnection;
  return new Connection(PLUGIN_DATABASE_NAME);
}

/**
 * Where {@link openPluginDatabase}'s file is: `Zotero.DataDirectory.dir` plus
 * {@link PLUGIN_DATABASE_FILE}. For a log line and for the integration spec
 * that reads the file back; the connection itself resolves the same path from
 * the name.
 */
export function pluginDatabasePath(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, PLUGIN_DATABASE_FILE);
}

/** `docs/07` §8.3's `search_provenance` columns, in the DDL's order. */
const INSERT_PROVENANCE =
  "INSERT INTO search_provenance " +
  "(run_id, library_id, collection_key, note_key, json, started_at, finished_at) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?)";

/**
 * The most recent row for one collection.
 *
 * `idx_provenance_collection` serves the `WHERE`; the order is §5.3's "most
 * recent" — the greatest `finished_at` — with SQLite's `rowid` as the tie-break,
 * so two runs finished in the same millisecond still have one answer (the one
 * inserted last).
 */
const SELECT_LATEST_FOR_COLLECTION =
  "SELECT json FROM search_provenance " +
  "WHERE library_id = ? AND collection_key = ? " +
  "ORDER BY finished_at DESC, rowid DESC LIMIT 1";

/** No bound value of these two statements reaches the debug log. */
const QUIET: SqlQueryOptions = { debugParams: false };

/**
 * An ISO 8601 timestamp as the `INTEGER` §8.3's `started_at` / `finished_at`
 * columns hold — epoch milliseconds, the unit `src/core/clock.ts` uses.
 *
 * @throws when the string is not a date: both columns are `NOT NULL`, and a
 *   row that cannot be ordered would break {@link SELECT_LATEST_FOR_COLLECTION}
 *   for every later run of the collection.
 */
function epochMs(iso: string, column: string): number {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) {
    throw new Error(
      `[research-helper] search_provenance.${column} needs an ISO 8601 ` +
        `timestamp; the record's value does not parse as one.`,
    );
  }
  return value;
}

/**
 * `src/core/provenance.ts`'s `ProvenanceStore`, over the plugin's database.
 *
 * `json` is `serializeProvenance(record)`: the same bytes "Export provenance as
 * JSON" writes (§8.3: "`json` … is what 'Export provenance as JSON' writes
 * out"), produced by the project's single redaction gate — so a row holds only
 * what `redactSearchProvenance` lets through, whatever the caller handed in.
 *
 * @param db - the connection {@link openPluginDatabase} returned, migrated
 * @returns the store
 */
export function createProvenanceStore(db: SqlConnection): ProvenanceStore {
  return {
    async putProvenance(
      record: SearchProvenance,
      libraryId: number,
      collectionKey: string | undefined,
      noteKey: string | undefined,
    ): Promise<void> {
      await db.queryAsync(
        INSERT_PROVENANCE,
        [
          record.runId,
          libraryId,
          collectionKey ?? null,
          noteKey ?? null,
          serializeProvenance(record),
          epochMs(record.startedAt, "started_at"),
          epochMs(record.finishedAt, "finished_at"),
        ],
        QUIET,
      );
    },

    async findProvenanceByCollection(
      libraryId: number,
      collectionKey: string,
    ): Promise<SearchProvenance | undefined> {
      const json = await db.valueQueryAsync(
        SELECT_LATEST_FOR_COLLECTION,
        [libraryId, collectionKey],
        QUIET,
      );
      return typeof json === "string" ? parseStoredProvenance(json) : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// The job store (`P3-T34`)
// ---------------------------------------------------------------------------

/** `docs/07` §8.3's `job` columns, in the DDL's order. */
const JOB_COLUMN_LIST = JOB_COLUMNS.join(", ");

/**
 * An upsert: a job row is written whole, on every change of its record.
 * `ON CONFLICT … DO UPDATE` rather than `INSERT OR REPLACE`, which deletes and
 * re-inserts and so gives the row a new `rowid` — the tie-break of
 * {@link JOBS_ORDER}.
 */
const UPSERT_JOB =
  `INSERT INTO job (${JOB_COLUMN_LIST}) ` +
  `VALUES (${JOB_COLUMNS.map(() => "?").join(", ")}) ` +
  `ON CONFLICT(id) DO UPDATE SET ${JOB_COLUMNS.filter(
    (column) => column !== "id",
  )
    .map((column) => `${column} = excluded.${column}`)
    .join(", ")}`;

const SELECT_JOB = `SELECT ${JOB_COLUMN_LIST} FROM job WHERE id = ?`;

/** Oldest first; `rowid` breaks a tie between two jobs made in one millisecond. */
const SELECT_JOBS = `SELECT ${JOB_COLUMN_LIST} FROM job`;
const JOBS_ORDER = " ORDER BY created_at, rowid";

/**
 * A `SELECT`'s rows. Anything that is not an array — `undefined`, or a
 * `false` like `valueQueryAsync`'s no-row answer — is read as no rows.
 */
function resultRows(result: unknown): readonly unknown[] {
  return Array.isArray(result) ? (result as unknown[]) : [];
}

/**
 * A result row as {@link JobRow}. Zotero's rows answer a column name as a
 * property (what `test/integration/zotero/provenanceStore.spec.ts` relies on);
 * `node:sqlite`'s are plain objects. Either way each column is read by name,
 * so the row is copied into a plain object rather than kept as the platform's
 * proxy.
 */
function jobRowFrom(result: unknown): JobRow {
  const source = result as Record<string, unknown>;
  const row: Record<string, unknown> = {};
  for (const column of JOB_COLUMNS) {
    const value = source[column];
    row[column] = value === undefined ? null : value;
  }
  return row as unknown as JobRow;
}

/**
 * `src/core/jobQueue/queue.ts`'s `JobStore`, over the plugin's database.
 *
 * It takes and returns {@link JobRow}s only, and the one producer of a row is
 * `toJobRow` in `src/core/jobQueue/jobRecord.ts`, which is where the redaction
 * gate runs: this store cannot be handed an ungated `input_json`,
 * `progress_json`, `usage_json`, `error_json` or `warnings_json`. Every
 * statement is {@link QUIET}: a bound value is a whole job input.
 *
 * @param db - the connection {@link openPluginDatabase} returned, migrated
 * @returns the store
 */
export function createJobStore(db: SqlConnection): JobStore {
  return {
    async put(row: JobRow): Promise<void> {
      await db.queryAsync(
        UPSERT_JOB,
        JOB_COLUMNS.map((column) => row[column]),
        QUIET,
      );
    },

    async get(id: string): Promise<JobRow | undefined> {
      const first = resultRows(await db.queryAsync(SELECT_JOB, [id], QUIET))[0];
      return first === undefined ? undefined : jobRowFrom(first);
    },

    async list(statuses?: readonly JobStatus[]): Promise<readonly JobRow[]> {
      if (statuses !== undefined && statuses.length === 0) return [];
      const sql =
        statuses === undefined
          ? SELECT_JOBS + JOBS_ORDER
          : `${SELECT_JOBS} WHERE status IN (${statuses
              .map(() => "?")
              .join(", ")})${JOBS_ORDER}`;
      return resultRows(await db.queryAsync(sql, statuses ?? [], QUIET)).map(
        jobRowFrom,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// The user price table (`plan/00` §6 item 265 (b))
// ---------------------------------------------------------------------------

/** `docs/07` §8.3's `user_price` columns, in the DDL's order. */
const USER_PRICE_COLUMN_LIST =
  "provider_id, model_id, input_per_mtok_usd, output_per_mtok_usd, " +
  "cached_input_per_mtok_usd, as_of";

/** An upsert on the primary key, for {@link UPSERT_JOB}'s reason. */
const UPSERT_USER_PRICE =
  `INSERT INTO user_price (${USER_PRICE_COLUMN_LIST}) ` +
  "VALUES (?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(provider_id, model_id) DO UPDATE SET " +
  "input_per_mtok_usd = excluded.input_per_mtok_usd, " +
  "output_per_mtok_usd = excluded.output_per_mtok_usd, " +
  "cached_input_per_mtok_usd = excluded.cached_input_per_mtok_usd, " +
  "as_of = excluded.as_of";

const SELECT_USER_PRICES = `SELECT ${USER_PRICE_COLUMN_LIST} FROM user_price ORDER BY provider_id, model_id`;

const DELETE_USER_PRICE =
  "DELETE FROM user_price WHERE provider_id = ? AND model_id = ?";

/** A stored row as a {@link UserPriceOverride}, or `undefined` if unusable. */
function userPriceFrom(result: unknown): UserPriceOverride | undefined {
  const source = result as Record<string, unknown>;
  const cached = source["cached_input_per_mtok_usd"];
  const row = {
    providerId: source["provider_id"] as ProviderId,
    modelId: source["model_id"] as string,
    inputPerMTokUsd: source["input_per_mtok_usd"] as number,
    outputPerMTokUsd: source["output_per_mtok_usd"] as number,
    ...(cached !== null &&
      cached !== undefined && { cachedInputPerMTokUsd: cached as number }),
    asOfEpochMs: source["as_of"] as number,
  };
  return isUsableUserPriceOverride(row) ? row : undefined;
}

/**
 * `src/llm/shared/pricing.ts`'s `UserPriceStore`, over the plugin's database
 * (`plan/00` §6 item 265 (b), owner, 2026-10-21; `docs/07` §8.3).
 *
 * **What a row holds:** a provider ID from the closed `ProviderId` set, a
 * model ID, three prices in fractional US dollars per million tokens (item
 * 252; never rounded, never cents) and the epoch-millisecond date the user
 * read them. The model ID is the one text field that a typed entry in the
 * pane could fill, so it goes through the redaction gate (`redactRecord`,
 * `src/core/provenance.ts`, `P3-T36`) before it is stored; a row the gate
 * would change is **refused**, not stored redacted, because a changed model
 * ID would no longer name its model. A row `isUsableUserPriceOverride`
 * refuses is refused too, and nothing is written. Reading back drops a row
 * that is no longer usable (a provider a later build added). Every statement
 * is {@link QUIET}.
 *
 * @param db - the connection {@link openPluginDatabase} returned, migrated
 * @returns the store
 */
export function createUserPriceStore(db: SqlConnection): UserPriceStore {
  return {
    async list(): Promise<readonly UserPriceOverride[]> {
      const rows = resultRows(
        await db.queryAsync(SELECT_USER_PRICES, [], QUIET),
      );
      const out: UserPriceOverride[] = [];
      for (const result of rows) {
        const row = userPriceFrom(result);
        if (row !== undefined) out.push(row);
      }
      return out;
    },

    async upsert(row: UserPriceOverride): Promise<void> {
      if (!isUsableUserPriceOverride(row)) {
        throw new RangeError(
          "[research-helper] a user price row needs a known provider, a model " +
            "ID, non-negative finite prices and a date; nothing was stored",
        );
      }
      const gated = redactRecord({ modelId: row.modelId });
      if (gated.mark.partlyRedacted) {
        throw new RangeError(
          "[research-helper] the model ID looks like a credential and was not " +
            "stored (docs/09 §2.1)",
        );
      }
      await db.queryAsync(
        UPSERT_USER_PRICE,
        [
          row.providerId,
          gated.record.modelId,
          row.inputPerMTokUsd,
          row.outputPerMTokUsd,
          row.cachedInputPerMTokUsd ?? null,
          row.asOfEpochMs,
        ],
        QUIET,
      );
    },

    async delete(providerId: ProviderId, modelId: string): Promise<void> {
      await db.queryAsync(DELETE_USER_PRICE, [providerId, modelId], QUIET);
    },
  };
}

// ---------------------------------------------------------------------------
// Per-collection settings (`P3-T15`)
// ---------------------------------------------------------------------------

/** One collection's `collection_settings.json`, parsed: a JSON object. */
export type CollectionSettings = Readonly<Record<string, unknown>>;

/**
 * The `collection_settings` table (`docs/07` §8.3, migration version 5), one
 * JSON object per collection.
 *
 * The store gives the object no meaning; `src/pipeline/shared/privacyPolicy.ts`
 * reads and writes its privacy members (`docs/07` §4.5's `PrivacyPolicy`
 * note). A per-collection setting lives here and never in a preference
 * (`docs/09` §3.5).
 */
export interface CollectionSettingsStore {
  /**
   * The collection's object, or `undefined` when it has no row.
   *
   * @throws StorageError when the stored text is not a JSON object — never
   *   `undefined`, because an override that cannot be read must not read as
   *   "no override" (the caller fails closed)
   */
  get(
    libraryID: number,
    collectionKey: string,
  ): Promise<CollectionSettings | undefined>;
  /**
   * Replace the collection's object.
   *
   * @throws RangeError, writing nothing, for a library id that is not an
   *   integer, an empty collection key, a value that is not a plain object, or
   *   an object the redaction gate would change
   */
  put(
    libraryID: number,
    collectionKey: string,
    settings: CollectionSettings,
  ): Promise<void>;
  /** Remove the collection's row; a missing row changes nothing. */
  delete(libraryID: number, collectionKey: string): Promise<void>;
}

const UPSERT_COLLECTION_SETTINGS =
  "INSERT INTO collection_settings (library_id, collection_key, json) " +
  "VALUES (?, ?, ?) " +
  "ON CONFLICT(library_id, collection_key) DO UPDATE SET json = excluded.json";

const SELECT_COLLECTION_SETTINGS =
  "SELECT json FROM collection_settings WHERE library_id = ? AND collection_key = ?";

const DELETE_COLLECTION_SETTINGS =
  "DELETE FROM collection_settings WHERE library_id = ? AND collection_key = ?";

/** A plain JSON object: not null, not an array. */
function isJsonObject(value: unknown): value is CollectionSettings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The row key, checked. */
function collectionRowKey(
  libraryID: number,
  collectionKey: string,
): [number, string] {
  if (!Number.isInteger(libraryID) || collectionKey.trim() === "") {
    throw new RangeError(
      "[research-helper] collection settings need an integer library id and " +
        "a collection key; nothing was read or written",
    );
  }
  return [libraryID, collectionKey];
}

/**
 * {@link CollectionSettingsStore} over the plugin's database (`P3-T15`;
 * `docs/07` §8.3).
 *
 * **What a row holds:** whatever object the caller puts, serialized. It can
 * carry a model id a user typed (§8.3's "model overrides"), so `put` passes
 * the whole object through the redaction gate (`redactRecord`,
 * `src/core/provenance.ts`, `P3-T36`) and **refuses** an object the gate would
 * change, as {@link createUserPriceStore} does: a setting stored redacted
 * would no longer say what the user chose. Every statement is {@link QUIET}.
 *
 * @param db - the connection {@link openPluginDatabase} returned, migrated
 * @returns the store
 */
export function createCollectionSettingsStore(
  db: SqlConnection,
): CollectionSettingsStore {
  return {
    async get(
      libraryID: number,
      collectionKey: string,
    ): Promise<CollectionSettings | undefined> {
      const key = collectionRowKey(libraryID, collectionKey);
      const rows = resultRows(
        await db.queryAsync(SELECT_COLLECTION_SETTINGS, key, QUIET),
      );
      const first = rows[0] as Record<string, unknown> | undefined;
      if (first === undefined) return undefined;
      let value: unknown;
      try {
        value = JSON.parse(String(first["json"]));
      } catch {
        value = undefined;
      }
      if (!isJsonObject(value)) {
        throw new StorageError(
          "[research-helper] a collection_settings row is not a JSON object",
          { libraryID },
        );
      }
      return value;
    },

    async put(
      libraryID: number,
      collectionKey: string,
      settings: CollectionSettings,
    ): Promise<void> {
      const key = collectionRowKey(libraryID, collectionKey);
      if (!isJsonObject(settings)) {
        throw new RangeError(
          "[research-helper] collection settings must be a JSON object; " +
            "nothing was stored",
        );
      }
      const gated = redactRecord(settings);
      if (gated.mark.partlyRedacted) {
        throw new RangeError(
          "[research-helper] a collection setting looks like a credential and " +
            "was not stored (docs/09 §2.1)",
        );
      }
      await db.queryAsync(
        UPSERT_COLLECTION_SETTINGS,
        [...key, JSON.stringify(gated.record)],
        QUIET,
      );
    },

    async delete(libraryID: number, collectionKey: string): Promise<void> {
      const key = collectionRowKey(libraryID, collectionKey);
      await db.queryAsync(DELETE_COLLECTION_SETTINGS, key, QUIET);
    },
  };
}

// ---------------------------------------------------------------------------
// Stored summaries (`P3-T25`)
// ---------------------------------------------------------------------------

/**
 * `StoredSummary`'s identifier fields, copied through the redaction gate
 * unchanged (`docs/07` §5.2's note of 2026-10-28, item 6): a 64-character
 * `contentHash` or a `hash:` work key is exactly what `redact()`'s catch-all
 * would otherwise destroy. Never a field a user or a model writes free text
 * into; `warnings` is gated.
 */
export const STORED_SUMMARY_VERBATIM_KEYS: readonly string[] = Object.freeze([
  "id",
  "workKey",
  "zoteroItemKey",
  // `P3-T29` (`docs/07` §5.2's note of 2026-10-29): the summary note's key.
  "zoteroNoteKey",
  "contentHash",
  "promptId",
  "promptVersion",
  "providerId",
  "modelId",
  "sourceItemVersion",
  "itemKey",
  "schemaVersion",
  "sourceTier",
]);

/** A `StoredSummary` before its own pass through the gate. */
export type UngatedStoredSummary = Omit<StoredSummary, "redaction"> & {
  /** A mark an earlier pass produced (the summary cache's), summed in. */
  readonly redaction?: StoredRedactionMark | undefined;
};

/**
 * The one gate (`redactRecord`, `src/core/provenance.ts`; `P3-T36`) applied to
 * a whole row, `content` included, with {@link STORED_SUMMARY_VERBATIM_KEYS}
 * copied unchanged. The returned mark is the earlier one plus this pass's.
 *
 * @param row - the row about to be stored
 * @returns the row as it may be stored, with its mark
 */
export function gateStoredSummary(row: UngatedStoredSummary): StoredSummary {
  const { redaction: earlier, ...rest } = row;
  const gated = redactRecord(rest, {
    verbatimKeys: STORED_SUMMARY_VERBATIM_KEYS,
  });
  const before = earlier ?? {
    partlyRedacted: false,
    redactedStrings: 0,
    droppedFields: 0,
  };
  return {
    ...gated.record,
    redaction: {
      partlyRedacted: before.partlyRedacted || gated.mark.partlyRedacted,
      redactedStrings: before.redactedStrings + gated.mark.redactedStrings,
      droppedFields: before.droppedFields + gated.mark.droppedFields,
    },
  };
}

/**
 * The `summary` table (`docs/07` §8.3, migration version 6), one
 * `StoredSummary` per row. The port is declared here, as
 * {@link CollectionSettingsStore} is, because `zotero/` may not import
 * `pipeline/` (`docs/07` §2.3).
 *
 * Writer: `summarizeItem` (`src/pipeline/summarize/summarizeItem.ts`,
 * `P3-T25`), called by the summarize pipeline (`P3-T29`) and the item pane's
 * Generate (`P3-T28`). Readers: the item pane (`P3-T28`) and the trend report
 * (Phase 4).
 */
export interface SummaryStore {
  /**
   * Gate `record` again (idempotent; its mark is kept and summed) and write
   * it, replacing a row with the same `id`.
   *
   * @returns the row as written
   * @throws RangeError, writing nothing, for an empty `id` or `workKey`
   */
  put(record: StoredSummary): Promise<StoredSummary>;
  /**
   * The row with `id`, or `undefined`.
   *
   * @throws StorageError when the stored text is not a summary row
   */
  get(id: string): Promise<StoredSummary | undefined>;
  /**
   * Every row of one work, newest first.
   *
   * @throws StorageError when a stored text is not a summary row
   */
  listForWork(workKey: string): Promise<readonly StoredSummary[]>;
}

const UPSERT_SUMMARY =
  "INSERT INTO summary (id, work_key, zotero_item_key, prompt_version, provider_id, " +
  "model_id, input_scope, source_item_version, json, generated_at) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET work_key = excluded.work_key, " +
  "zotero_item_key = excluded.zotero_item_key, prompt_version = excluded.prompt_version, " +
  "provider_id = excluded.provider_id, model_id = excluded.model_id, " +
  "input_scope = excluded.input_scope, source_item_version = excluded.source_item_version, " +
  "json = excluded.json, generated_at = excluded.generated_at";

const SELECT_SUMMARY = "SELECT json FROM summary WHERE id = ?";

const SELECT_SUMMARIES_FOR_WORK =
  "SELECT json FROM summary WHERE work_key = ? ORDER BY generated_at DESC, rowid DESC";

/** A parsed `json` column, checked for the members every reader needs. */
function storedSummaryFrom(result: unknown): StoredSummary {
  const json = (result as Record<string, unknown>)["json"];
  let value: unknown;
  try {
    value = JSON.parse(String(json));
  } catch {
    value = undefined;
  }
  const row = value as Partial<StoredSummary> | undefined;
  if (
    row === undefined ||
    row === null ||
    typeof row !== "object" ||
    typeof row.id !== "string" ||
    typeof row.workKey !== "string" ||
    typeof row.content !== "object" ||
    row.content === null ||
    typeof row.contentHash !== "string" ||
    !Array.isArray(row.warnings)
  ) {
    throw new StorageError(
      "[research-helper] a summary row is not a stored summary",
    );
  }
  return row as StoredSummary;
}

/**
 * {@link SummaryStore} over the plugin's database (`P3-T25`; `docs/07` §5.2,
 * §8.3). Every row passes {@link gateStoredSummary} on the way in, so a row
 * holds only what the gate lets through whatever the caller handed in. Every
 * statement is {@link QUIET}: the `json` parameter is a whole summary.
 *
 * Constructed on the one shared connection by `installPluginDatabase`
 * (`src/bootstrap/pluginDatabase.ts`) — wired by `P3-T29`, the first card that
 * runs `summarizeItem` in the product.
 *
 * @param db - the connection {@link openPluginDatabase} returned, migrated
 * @returns the store
 */
export function createSummaryStore(db: SqlConnection): SummaryStore {
  return {
    async put(record: StoredSummary): Promise<StoredSummary> {
      if (record.id === "" || record.workKey === "") {
        throw new RangeError(
          "[research-helper] a summary row needs an id and a work key; " +
            "nothing was stored",
        );
      }
      const row = gateStoredSummary(record);
      await db.queryAsync(
        UPSERT_SUMMARY,
        [
          row.id,
          row.workKey,
          row.zoteroItemKey ?? null,
          row.promptVersion,
          row.providerId,
          row.modelId,
          JSON.stringify(row.inputScope),
          row.sourceItemVersion ?? null,
          JSON.stringify(row),
          row.generatedAtEpochMs,
        ],
        QUIET,
      );
      return row;
    },

    async get(id: string): Promise<StoredSummary | undefined> {
      const rows = resultRows(await db.queryAsync(SELECT_SUMMARY, [id], QUIET));
      const first = rows[0];
      return first === undefined ? undefined : storedSummaryFrom(first);
    },

    async listForWork(workKey: string): Promise<readonly StoredSummary[]> {
      const rows = resultRows(
        await db.queryAsync(SELECT_SUMMARIES_FOR_WORK, [workKey], QUIET),
      );
      return rows.map(storedSummaryFrom);
    },
  };
}

// ---------------------------------------------------------------------------
// Stored trend reports (`P4-T14`)
// ---------------------------------------------------------------------------

/**
 * `TrendReport`'s identifier fields, copied through the redaction gate
 * unchanged (`docs/07` §5.2's note of 2026-10-30, item 1). Each is computed by
 * code or read from Zotero, never written by a model or typed by the user: a
 * `summaryIds` entry carries a `hash:` work key of 40 hexadecimal characters,
 * which `redact()`'s catch-all would otherwise destroy, and `id` names the
 * Markdown file. Every other field — the Markdown, the sections, the
 * clustering, the critique, the warnings — is gated.
 */
export const REPORT_VERBATIM_KEYS: readonly string[] = Object.freeze([
  "id",
  "collectionKey",
  "zoteroNoteKey",
  "summaryIds",
  "citedItemKeys",
  "doi",
  "providerId",
  "promptId",
  "promptVersion",
  "modelId",
  "pluginVersion",
]);

/**
 * A report id the store accepts (`docs/07` §5.2's note of 2026-10-30, item 4):
 * runs of letters and digits joined by single `-` or `_` — no dot, no path
 * separator, no `--` — so `<id>.md` is a file name on every platform, can
 * reach no other directory, and fits inside the note's marker comment.
 */
export const REPORT_ID_RE = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;

/** The longest report id the store accepts, in characters. */
export const REPORT_ID_MAX_LENGTH = 128;

/** Whether `id` is a report id the store accepts ({@link REPORT_ID_RE}). */
export function isReportId(id: string): boolean {
  return id.length <= REPORT_ID_MAX_LENGTH && REPORT_ID_RE.test(id);
}

/**
 * `report.markdown_path` for a report: relative to
 * `<data dir>/research-helper/`, because the data directory can move
 * (`docs/07` §8.4) and an absolute path would also store the account's
 * folder name.
 */
export function reportMarkdownPath(id: string): string {
  return `reports/${id}.md`;
}

/**
 * The one gate (`redactRecord`, `src/core/provenance.ts`) applied to a whole
 * report, `markdown` included, with {@link REPORT_VERBATIM_KEYS} copied
 * unchanged. The returned mark is the earlier one (a report gated before)
 * plus this pass's, as {@link gateStoredSummary} does.
 *
 * @param report - the report about to be stored
 * @returns the report as it may be stored, with its mark
 */
export function gateTrendReport(report: TrendReport): TrendReport {
  const { redaction: earlier, ...rest } = report;
  const gated = redactRecord(rest, { verbatimKeys: REPORT_VERBATIM_KEYS });
  const before = earlier ?? {
    partlyRedacted: false,
    redactedStrings: 0,
    droppedFields: 0,
  };
  return {
    ...gated.record,
    redaction: {
      partlyRedacted: before.partlyRedacted || gated.mark.partlyRedacted,
      redactedStrings: before.redactedStrings + gated.mark.redactedStrings,
      droppedFields: before.droppedFields + gated.mark.droppedFields,
    },
  };
}

/**
 * The report Markdown files, by report id, as a port: `IOUtils` in the
 * product ({@link createReportMarkdownFiles}), a map in a unit test.
 */
export interface ReportMarkdownFiles {
  /** Write the file, atomically: the old file or the new one, never half. */
  write(id: string, text: string): Promise<void>;
  /** The file's text, or `undefined` when there is no file. */
  read(id: string): Promise<string | undefined>;
  exists(id: string): Promise<boolean>;
  /** Remove the file; no error when it is already gone. */
  remove(id: string): Promise<void>;
}

/**
 * `docs/07` §8.3 and `docs/06` §11.3 D-06-8: report Markdown lives in
 * `<data dir>/research-helper/reports/`, beside the database in the data
 * directory (§8.4) — `research-helper` with a hyphen.
 */
export function reportMarkdownDirectory(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, "research-helper", "reports");
}

/**
 * {@link ReportMarkdownFiles} over `IOUtils`, the way
 * {@link createCacheBlobStore} keeps cache blobs: a write goes to a temporary
 * file renamed into place, the directory is made on the first write and
 * resolved on every call (a relocated data directory is followed), and only
 * an id {@link isReportId} accepts becomes a path. No path is logged.
 *
 * @param directory - the directory; {@link reportMarkdownDirectory} outside a test
 * @returns the files
 */
export function createReportMarkdownFiles(
  directory: () => string = reportMarkdownDirectory,
): ReportMarkdownFiles {
  const pathOf = (id: string): string => {
    if (!isReportId(id)) {
      throw new RangeError(
        "[research-helper] a report id must be letters and digits joined by " +
          "single - or _, at most 128 characters",
      );
    }
    return PathUtils.join(directory(), `${id}.md`);
  };
  return {
    async write(id: string, text: string): Promise<void> {
      const path = pathOf(id);
      await IOUtils.makeDirectory(directory(), {
        createAncestors: true,
        ignoreExisting: true,
      });
      await IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` });
    },

    async read(id: string): Promise<string | undefined> {
      const path = pathOf(id);
      if (!(await IOUtils.exists(path))) return undefined;
      return IOUtils.readUTF8(path);
    },

    exists: (id: string): Promise<boolean> => IOUtils.exists(pathOf(id)),

    async remove(id: string): Promise<void> {
      await IOUtils.remove(pathOf(id), { ignoreAbsent: true });
    },
  };
}

/**
 * The `report` table (`docs/07` §8.3, migration version 7) and its Markdown
 * files, one `TrendReport` per row. The port is declared here, as
 * {@link SummaryStore} is, because `zotero/` may not import `pipeline/`.
 *
 * Writer: the trend-report run (`trendReportPipeline.ts`, `P4-T18`), which
 * stores the report, writes its note with `writeReportNote`
 * (`src/zotero/notes.ts`), then stores it again with `zoteroNoteKey`.
 * Reader: the report window (`P4-T20`), for the export.
 */
export interface ReportStore {
  /**
   * Gate `report` ({@link gateTrendReport}; idempotent, its mark kept and
   * summed), write its Markdown file, then its row, replacing a row and a
   * file with the same `id`. When the row write fails, a file this call
   * created is removed again.
   *
   * @returns the report as written, with its mark
   * @throws RangeError, writing nothing, for an id {@link isReportId}
   *   refuses or an empty collection key
   */
  put(report: TrendReport): Promise<TrendReport>;
  /**
   * The report with `id`, its Markdown read back from the file; `undefined`
   * when there is no such row.
   *
   * @throws StorageError when the row is not a report or its file is gone
   */
  get(id: string): Promise<TrendReport | undefined>;
}

const UPSERT_REPORT =
  "INSERT INTO report (id, library_id, collection_key, json, markdown_path, " +
  "note_key, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET library_id = excluded.library_id, " +
  "collection_key = excluded.collection_key, json = excluded.json, " +
  "markdown_path = excluded.markdown_path, note_key = excluded.note_key, " +
  "generated_at = excluded.generated_at";

const SELECT_REPORT = "SELECT json FROM report WHERE id = ?";

/** A parsed `json` column, checked for the members every reader needs. */
function storedReportFrom(result: unknown): Omit<TrendReport, "markdown"> {
  const json = (result as Record<string, unknown>)["json"];
  let value: unknown;
  try {
    value = JSON.parse(String(json));
  } catch {
    value = undefined;
  }
  const row = value as Partial<TrendReport> | undefined;
  if (
    row === undefined ||
    row === null ||
    typeof row !== "object" ||
    typeof row.id !== "string" ||
    typeof row.libraryID !== "number" ||
    typeof row.collectionKey !== "string" ||
    !Array.isArray(row.sections) ||
    !Array.isArray(row.bibliography) ||
    !Array.isArray(row.warnings) ||
    "markdown" in row
  ) {
    throw new StorageError(
      "[research-helper] a report row is not a stored report",
    );
  }
  return row as Omit<TrendReport, "markdown">;
}

/**
 * {@link ReportStore} over the plugin's database and the report files
 * (`P4-T14`; `docs/07` §5.2's note of 2026-10-30, §8.3). Every report passes
 * {@link gateTrendReport} on the way in, so the row and the file hold only
 * what the gate lets through, whatever the caller handed in. Every statement
 * is {@link QUIET}: the `json` parameter is a whole report.
 *
 * Constructed on the one shared connection by `installPluginDatabase`
 * (`src/bootstrap/pluginDatabase.ts`).
 *
 * @param db - the connection {@link openPluginDatabase} returned, migrated
 * @param files - the Markdown files; {@link createReportMarkdownFiles} outside a test
 * @returns the store
 */
export function createReportStore(
  db: SqlConnection,
  files: ReportMarkdownFiles = createReportMarkdownFiles(),
): ReportStore {
  return {
    async put(report: TrendReport): Promise<TrendReport> {
      if (!isReportId(report.id) || report.collectionKey === "") {
        throw new RangeError(
          "[research-helper] a report needs a file-name-safe id and a " +
            "collection key; nothing was stored",
        );
      }
      const row = gateTrendReport(report);
      const { markdown, ...record } = row;
      const existed = await files.exists(row.id);
      await files.write(row.id, markdown);
      try {
        await db.queryAsync(
          UPSERT_REPORT,
          [
            row.id,
            row.libraryID,
            row.collectionKey,
            JSON.stringify(record),
            reportMarkdownPath(row.id),
            row.zoteroNoteKey ?? null,
            row.generatedAtEpochMs,
          ],
          QUIET,
        );
      } catch (error) {
        if (!existed) await files.remove(row.id).catch(() => undefined);
        throw error;
      }
      return row;
    },

    async get(id: string): Promise<TrendReport | undefined> {
      if (!isReportId(id)) return undefined;
      const rows = resultRows(await db.queryAsync(SELECT_REPORT, [id], QUIET));
      const first = rows[0];
      if (first === undefined) return undefined;
      const record = storedReportFrom(first);
      const markdown = await files.read(id);
      if (markdown === undefined) {
        throw new StorageError(
          "[research-helper] a stored report's Markdown file is missing",
        );
      }
      return { ...record, markdown };
    },
  };
}

// ---------------------------------------------------------------------------
// `BLOB` columns (`P5-T03`)
// ---------------------------------------------------------------------------

/** A `Float32Array`'s own bytes, as a `BLOB` parameter ({@link SqlParam}). */
function float32Blob(values: Float32Array): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
}

/**
 * A `BLOB` column's value as bytes in a buffer of their own, or `undefined`
 * when it is not one.
 *
 * Inside Zotero 10.0.3 a `BLOB` reads back as an array of numbers
 * (`test/integration/zotero/recommendStores.spec.ts` asserts it); `node:sqlite`
 * hands back a `Uint8Array`, which may sit at an offset no `Float32Array` can
 * start from. So the bytes are copied either way.
 */
function blobBytes(value: unknown): Uint8Array | undefined {
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice();
  }
  return undefined;
}

/** {@link blobBytes}' answer as floats; the length must be a multiple of 4. */
function floatsOf(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, 0, bytes.length / 4);
}

/** The earlier mark plus one gate pass's, as `gateTrendReport` sums them. */
function summedMark(
  earlier: StoredRedactionMark | undefined,
  mark: StoredRedactionMark,
): StoredRedactionMark {
  return {
    partlyRedacted: (earlier?.partlyRedacted ?? false) || mark.partlyRedacted,
    redactedStrings: (earlier?.redactedStrings ?? 0) + mark.redactedStrings,
    droppedFields: (earlier?.droppedFields ?? 0) + mark.droppedFields,
  };
}

/** `ExternalIds`' members, by name: each can hold a 40-character identifier. */
const EXTERNAL_ID_VERBATIM_KEYS: readonly string[] = [
  "doi",
  "pmid",
  "pmcid",
  "arxivId",
  "s2CorpusId",
  "openAlexId",
  "epmcId",
  "url",
];

// ---------------------------------------------------------------------------
// The collection profile (`P5-T03`)
// ---------------------------------------------------------------------------

/**
 * `CollectionProfile`'s identifier fields, copied through the redaction gate
 * unchanged (`docs/07` §5.2's note of 2026-11-02, with the measurement):
 * without them `membershipHash` becomes `[redacted:64]`, a `hash:` entry of
 * `knownWorkKeys` loses its 40 hexadecimal characters, and a seed's
 * `ids.url` its paper id. Each is computed by code or read from a source's
 * answer. `narrative`, `suggestedQueries`, the name, terms and authors are gated.
 */
export const COLLECTION_PROFILE_VERBATIM_KEYS: readonly string[] =
  Object.freeze([
    "id",
    "collectionKey",
    "membershipHash",
    "knownWorkKeys",
    "embeddingModel",
    ...EXTERNAL_ID_VERBATIM_KEYS,
  ]);

/** `docs/07` §5.2: `CollectionProfile.id` is `${libraryID}:${collectionKey}`. */
export function collectionProfileId(
  libraryID: number,
  collectionKey: string,
): string {
  return `${String(libraryID)}:${collectionKey}`;
}

/**
 * The one gate (`redactRecord`, `src/core/provenance.ts`) applied to a whole
 * profile, with {@link COLLECTION_PROFILE_VERBATIM_KEYS} copied unchanged. The
 * returned mark is the earlier one plus this pass's. `centroids` hold numbers
 * only, which the gate leaves alone.
 *
 * @param profile - the profile about to be stored
 * @returns the profile as it may be stored, with its mark
 */
export function gateCollectionProfile(
  profile: CollectionProfile,
): CollectionProfile {
  const { redaction: earlier, ...rest } = profile;
  const gated = redactRecord(rest, {
    verbatimKeys: COLLECTION_PROFILE_VERBATIM_KEYS,
  });
  return { ...gated.record, redaction: summedMark(earlier, gated.mark) };
}

/**
 * The `collection_profile` table (`docs/07` §8.3, migration version 8), one
 * `CollectionProfile` per collection. The port is declared here, as
 * {@link SummaryStore} is, because `zotero/` may not import `pipeline/`.
 *
 * Writers: `buildProfileStats`' caller (`P5-T18`) and the recommend pipeline
 * (`P5-T25`). Reader: the recommend pipeline, for its profile check.
 */
export interface CollectionProfileStore {
  /**
   * Gate `profile` ({@link gateCollectionProfile}) and write it, replacing the
   * row with the same `id`. A rebuild therefore replaces `userEdits` too: the
   * caller carries them over (`docs/07` §5.2).
   *
   * @returns the profile as {@link get} will read it: each centroid value as
   *   the `Float32` it is stored as
   * @throws RangeError, writing nothing, for an id that is not
   *   {@link collectionProfileId}'s, an empty `membershipHash`, or centroids
   *   that are not rectangular, finite and of `embeddingDim` (when given)
   */
  put(profile: CollectionProfile): Promise<CollectionProfile>;
  /**
   * The row with `id`, or `undefined`.
   *
   * @throws StorageError when the stored text is not a profile or the blob does
   *   not divide by `centroid_count`
   */
  get(id: string): Promise<CollectionProfile | undefined>;
}

const UPSERT_COLLECTION_PROFILE =
  "INSERT INTO collection_profile (id, library_id, collection_key, membership_hash, " +
  "json, centroids, centroid_count, built_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET library_id = excluded.library_id, " +
  "collection_key = excluded.collection_key, " +
  "membership_hash = excluded.membership_hash, json = excluded.json, " +
  "centroids = excluded.centroids, centroid_count = excluded.centroid_count, " +
  "built_at = excluded.built_at";

const SELECT_COLLECTION_PROFILE =
  "SELECT json, centroids, centroid_count FROM collection_profile WHERE id = ?";

/**
 * The centroids as the `Float32` values the blob holds: k rows of one length.
 *
 * @throws RangeError when they are not rectangular, finite as `Float32`, or of
 *   `embeddingDim`
 */
function centroidFloats(profile: CollectionProfile): Float32Array {
  const { centroids, embeddingDim } = profile;
  const dim = centroids[0]?.length ?? 0;
  const floats = new Float32Array(centroids.length * dim);
  centroids.forEach((centroid, row) => {
    if (centroid.length !== dim || dim === 0) {
      throw new RangeError(
        "[research-helper] every centroid needs the same non-zero length; " +
          "nothing was stored",
      );
    }
    floats.set(centroid, row * dim);
  });
  if (
    !floats.every(Number.isFinite) ||
    (centroids.length > 0 && embeddingDim !== undefined && embeddingDim !== dim)
  ) {
    throw new RangeError(
      "[research-helper] a centroid is not finite or disagrees with " +
        "embeddingDim; nothing was stored",
    );
  }
  return floats;
}

/** k rows of the blob's floats (`docs/07` §8.3: row-major). */
function centroidRows(
  floats: Float32Array,
  count: number,
): readonly (readonly number[])[] {
  const dim = count === 0 ? 0 : floats.length / count;
  const rows: number[][] = [];
  for (let row = 0; row < count; row += 1) {
    rows.push(Array.from(floats.subarray(row * dim, (row + 1) * dim)));
  }
  return rows;
}

/** A row's `json`, `centroids` and `centroid_count`, joined and checked. */
function storedProfileFrom(result: unknown): CollectionProfile {
  const source = result as Record<string, unknown>;
  let value: unknown;
  try {
    value = JSON.parse(String(source["json"]));
  } catch {
    value = undefined;
  }
  const row = value as Partial<CollectionProfile> | undefined;
  if (
    row === undefined ||
    row === null ||
    typeof row !== "object" ||
    typeof row.id !== "string" ||
    typeof row.membershipHash !== "string" ||
    !Array.isArray(row.knownWorkKeys) ||
    !Array.isArray(row.seeds) ||
    "centroids" in row
  ) {
    throw new StorageError(
      "[research-helper] a collection_profile row is not a stored profile",
    );
  }
  const count = Number(source["centroid_count"]);
  if (count === 0) return { ...(row as CollectionProfile), centroids: [] };
  const bytes = blobBytes(source["centroids"]);
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    bytes === undefined ||
    bytes.length === 0 ||
    bytes.length % (4 * count) !== 0
  ) {
    throw new StorageError(
      "[research-helper] a collection_profile row's centroids do not divide " +
        "by its centroid_count",
    );
  }
  return {
    ...(row as CollectionProfile),
    centroids: centroidRows(floatsOf(bytes), count),
  };
}

/**
 * {@link CollectionProfileStore} over the plugin's database (`P5-T03`; `docs/07`
 * §5.2's note of 2026-11-02, §8.3). Every statement is {@link QUIET}: `json` is
 * a whole profile.
 *
 * Constructed on the one shared connection by `installPluginDatabase`
 * (`src/bootstrap/pluginDatabase.ts`).
 *
 * @param db - the connection {@link openPluginDatabase} returned, migrated
 * @returns the store
 */
export function createCollectionProfileStore(
  db: SqlConnection,
): CollectionProfileStore {
  return {
    async put(profile: CollectionProfile): Promise<CollectionProfile> {
      if (
        !Number.isInteger(profile.libraryID) ||
        profile.collectionKey === "" ||
        profile.id !==
          collectionProfileId(profile.libraryID, profile.collectionKey) ||
        profile.membershipHash === ""
      ) {
        throw new RangeError(
          "[research-helper] a profile needs the id of its library and " +
            "collection and a membership hash; nothing was stored",
        );
      }
      const floats = centroidFloats(profile);
      const row = gateCollectionProfile(profile);
      const { centroids, ...record } = row;
      const count = centroids.length;
      await db.queryAsync(
        UPSERT_COLLECTION_PROFILE,
        [
          row.id,
          row.libraryID,
          row.collectionKey,
          row.membershipHash,
          JSON.stringify(record),
          count === 0 ? null : float32Blob(floats),
          count,
          row.builtAtEpochMs,
        ],
        QUIET,
      );
      return { ...record, centroids: centroidRows(floats, count) };
    },

    async get(id: string): Promise<CollectionProfile | undefined> {
      const rows = resultRows(
        await db.queryAsync(SELECT_COLLECTION_PROFILE, [id], QUIET),
      );
      const first = rows[0];
      return first === undefined ? undefined : storedProfileFrom(first);
    },
  };
}

// ---------------------------------------------------------------------------
// The recommendations and their rejections (`P5-T03`)
// ---------------------------------------------------------------------------

/**
 * `Recommendation`'s identifier fields, copied through the redaction gate
 * unchanged (`docs/07` §5.2's note of 2026-11-02, with the measurement):
 * without them the gate rewrites `work.provenance.recordIds` and `work.url` of
 * every Semantic Scholar paper, and `id` and `work.workKey` of a `hash:` work.
 * `title`, `abstract`, authors, `pdfUrl` and `landingPageUrl` are gated.
 */
export const RECOMMENDATION_VERBATIM_KEYS: readonly string[] = Object.freeze([
  "id",
  "profileId",
  "workKey",
  "recordIds",
  ...EXTERNAL_ID_VERBATIM_KEYS,
]);

/** `docs/07` §5.2: `Recommendation.id` is `${profileId}:${workKey}`. */
export function recommendationId(profileId: string, workKey: string): string {
  return `${profileId}:${workKey}`;
}

/**
 * The one gate (`redactRecord`) applied to a whole recommendation, with
 * {@link RECOMMENDATION_VERBATIM_KEYS} copied unchanged. The returned mark is
 * the earlier one plus this pass's.
 *
 * @param recommendation - the row about to be stored
 * @returns the row as it may be stored, with its mark
 */
export function gateRecommendation(
  recommendation: Recommendation,
): Recommendation {
  const { redaction: earlier, ...rest } = recommendation;
  const gated = redactRecord(rest, {
    verbatimKeys: RECOMMENDATION_VERBATIM_KEYS,
  });
  return { ...gated.record, redaction: summedMark(earlier, gated.mark) };
}

/**
 * The `recommendation` table (`docs/07` §8.3, migration version 9). The port is
 * declared here, as {@link SummaryStore} is, because `zotero/` may not import
 * `pipeline/`.
 *
 * Writer: the recommend pipeline (`P5-T25`), `put` for a run's rows and
 * `reject` for "Not interested". Readers of {@link listRejected}: seed selection
 * (`P5-T21`, the newest 10 as negatives) and the filters (`P5-T24`, every
 * rejected work). Nothing records what the user imports (`plan/00` §6 item 323(b)).
 */
export interface RecommendationStore {
  /**
   * Gate `recommendation` ({@link gateRecommendation}) and write it, replacing
   * the row with the same `id` but keeping a rejection that row already has.
   *
   * @returns the row as written, with its mark
   * @throws RangeError, writing nothing, for an id that is not
   *   {@link recommendationId}'s, a score that is not finite, a `userAction`
   *   other than `"rejected"`, or one with no finite time
   */
  put(recommendation: Recommendation): Promise<Recommendation>;
  /**
   * Record "Not interested". A row already rejected keeps its first time.
   *
   * @param id - {@link recommendationId}'s
   * @param atEpochMs - when; `action_at`
   * @returns whether the store holds that row; `false` wrote nothing
   * @throws RangeError for a time that is not finite
   */
  reject(id: string, atEpochMs: number): Promise<boolean>;
  /**
   * The rejected rows of one profile, and so of one collection (`docs/07` §5.2's
   * note of 2026-11-02, item 4), most recently rejected first.
   *
   * @param profileId - {@link collectionProfileId}'s
   * @param limit - the most to return; absent, all of them
   * @throws RangeError for a limit that is not a positive integer
   * @throws StorageError when a stored text is not a recommendation
   */
  listRejected(
    profileId: string,
    limit?: number,
  ): Promise<readonly Recommendation[]>;
}

/** The one `user_action` this plugin writes (`plan/00` §6 item 323(b)). */
const USER_ACTION_REJECTED = "rejected";

const UPSERT_RECOMMENDATION =
  "INSERT INTO recommendation (id, profile_id, work_key, score, json, user_action, " +
  "action_at, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET profile_id = excluded.profile_id, " +
  "work_key = excluded.work_key, score = excluded.score, json = excluded.json, " +
  "user_action = COALESCE(recommendation.user_action, excluded.user_action), " +
  "action_at = COALESCE(recommendation.action_at, excluded.action_at), " +
  "generated_at = excluded.generated_at";

const COUNT_RECOMMENDATION = "SELECT COUNT(*) FROM recommendation WHERE id = ?";

const REJECT_RECOMMENDATION =
  "UPDATE recommendation SET user_action = ?, action_at = ? " +
  "WHERE id = ? AND user_action IS NULL";

const SELECT_REJECTED_RECOMMENDATIONS =
  "SELECT json, user_action, action_at FROM recommendation " +
  "WHERE profile_id = ? AND user_action = ? " +
  "ORDER BY action_at DESC, rowid DESC";

/** A row's `json`, `user_action` and `action_at`, joined and checked. */
function storedRecommendationFrom(result: unknown): Recommendation {
  const source = result as Record<string, unknown>;
  let value: unknown;
  try {
    value = JSON.parse(String(source["json"]));
  } catch {
    value = undefined;
  }
  const row = value as Partial<Recommendation> | undefined;
  if (
    row === undefined ||
    row === null ||
    typeof row !== "object" ||
    typeof row.id !== "string" ||
    typeof row.profileId !== "string" ||
    typeof row.work !== "object" ||
    row.work === null ||
    typeof row.work.workKey !== "string"
  ) {
    throw new StorageError(
      "[research-helper] a recommendation row is not a stored recommendation",
    );
  }
  return {
    ...(row as Recommendation),
    ...(source["user_action"] === USER_ACTION_REJECTED && {
      userAction: USER_ACTION_REJECTED,
      userActionAtEpochMs: Number(source["action_at"]),
    }),
  };
}

/**
 * {@link RecommendationStore} over the plugin's database (`P5-T03`; `docs/07`
 * §5.2's note of 2026-11-02, §8.3). Every statement is {@link QUIET}: `json` is
 * a whole recommendation.
 *
 * Constructed on the one shared connection by `installPluginDatabase`
 * (`src/bootstrap/pluginDatabase.ts`).
 *
 * @param db - the connection {@link openPluginDatabase} returned, migrated
 * @returns the store
 */
export function createRecommendationStore(
  db: SqlConnection,
): RecommendationStore {
  return {
    async put(recommendation: Recommendation): Promise<Recommendation> {
      const action = recommendation.userAction as string | undefined;
      const at = recommendation.userActionAtEpochMs;
      if (
        recommendation.profileId === "" ||
        recommendation.work.workKey === "" ||
        recommendation.id !==
          recommendationId(
            recommendation.profileId,
            recommendation.work.workKey,
          ) ||
        !Number.isFinite(recommendation.score) ||
        (action !== undefined && action !== USER_ACTION_REJECTED) ||
        (action !== undefined && !Number.isFinite(at))
      ) {
        throw new RangeError(
          "[research-helper] a recommendation needs the id of its profile and " +
            "work, a finite score, and no user action but a dated rejection; " +
            "nothing was stored",
        );
      }
      const row = gateRecommendation(recommendation);
      const { userAction, userActionAtEpochMs: actionAt, ...record } = row;
      await db.queryAsync(
        UPSERT_RECOMMENDATION,
        [
          row.id,
          row.profileId,
          row.work.workKey,
          row.score,
          JSON.stringify(record),
          userAction ?? null,
          userAction === undefined ? null : (actionAt ?? null),
          row.generatedAtEpochMs,
        ],
        QUIET,
      );
      return row;
    },

    async reject(id: string, atEpochMs: number): Promise<boolean> {
      if (!Number.isFinite(atEpochMs)) {
        throw new RangeError(
          "[research-helper] a rejection needs a time; nothing was stored",
        );
      }
      const held = await db.valueQueryAsync(COUNT_RECOMMENDATION, [id], QUIET);
      if (Number(held) === 0) return false;
      await db.queryAsync(
        REJECT_RECOMMENDATION,
        [USER_ACTION_REJECTED, atEpochMs, id],
        QUIET,
      );
      return true;
    },

    async listRejected(
      profileId: string,
      limit?: number,
    ): Promise<readonly Recommendation[]> {
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new RangeError(
          "[research-helper] a limit must be a positive integer",
        );
      }
      const rows = resultRows(
        await db.queryAsync(
          limit === undefined
            ? SELECT_REJECTED_RECOMMENDATIONS
            : `${SELECT_REJECTED_RECOMMENDATIONS} LIMIT ?`,
          limit === undefined
            ? [profileId, USER_ACTION_REJECTED]
            : [profileId, USER_ACTION_REJECTED, limit],
          QUIET,
        ),
      );
      return rows.map(storedRecommendationFrom);
    },
  };
}

// ---------------------------------------------------------------------------
// The stored paper vectors (`P5-T03`)
// ---------------------------------------------------------------------------

/**
 * `docs/07` §9.2's 100 MB for the `embedding` table, in the unit
 * `src/core/cache/cache.ts` uses (`plan/08` §0.4 line 31; §9.2's note of
 * 2026-11-02): 34 133 vectors of 768 dimensions.
 */
export const EMBEDDING_CAP_BYTES = 100 * 1024 * 1024;

/**
 * The most work keys one statement names. Zotero 10.0.3's `db.js` declares
 * `MAX_BOUND_PARAMETERS = 999`, and the model takes one more.
 */
export const EMBEDDING_IN_LIST_MAX = 500;

/** One vector to store, tagged with the model that made it (`docs/05` §5.1). */
export interface EmbeddingRow {
  readonly workKey: string;
  readonly model: string;
  readonly vector: Float32Array;
  /** `created_at`, the order {@link EmbeddingStore.evictToCap} deletes in. */
  readonly createdAtEpochMs: number;
}

/** What {@link EmbeddingStore.evictToCap} did. */
export interface EmbeddingEviction {
  /** Vectors deleted. */
  readonly evicted: number;
  /** The table's size afterwards, `dim × 4` bytes per vector. */
  readonly bytes: number;
}

/** {@link createEmbeddingStore}'s options. */
export interface EmbeddingStoreOptions {
  /** The table's cap in bytes; absent, {@link EMBEDDING_CAP_BYTES}. */
  readonly capBytes?: number;
}

/**
 * The `embedding` table (`docs/07` §8.3, migration version 10). Every read names
 * one model, so two vector spaces are never mixed (`plan/08` §0.2 item 22).
 *
 * Caller: `ensureEmbeddings` (`src/pipeline/shared/embeddings.ts`, `P5-T20`),
 * which also calls {@link evictToCap}, because this store cannot tell what is in
 * the library.
 */
export interface EmbeddingStore {
  /**
   * Write the vectors in one transaction, replacing a row with the same work and
   * model.
   *
   * @throws RangeError, writing nothing, for an empty `workKey` or `model`, an
   *   empty vector or a value that is not finite, or a time that is not finite
   */
  putMany(rows: readonly EmbeddingRow[]): Promise<void>;
  /**
   * The stored vectors of these works under `model`, by work key. A work with no
   * vector, or a row whose blob is not `dim × 4` bytes, is absent.
   */
  getMany(
    workKeys: readonly string[],
    model: string,
  ): Promise<ReadonlyMap<string, Float32Array>>;
  /** Every stored vector under `model`, by work key; {@link getMany}'s rule. */
  allForModel(model: string): Promise<ReadonlyMap<string, Float32Array>>;
  /**
   * Bring the table to its cap (`docs/07` §9.2's note of 2026-11-02): nothing at
   * or under it; over it, the oldest vectors of works `isInLibrary` rejects, then,
   * if still over, the oldest of the rest. One transaction.
   *
   * @param isInLibrary - whether a work key names a paper in the library
   * @returns how many went, and the size left
   */
  evictToCap(
    isInLibrary: (workKey: string) => boolean,
  ): Promise<EmbeddingEviction>;
}

const UPSERT_EMBEDDING =
  "INSERT INTO embedding (work_key, model, dim, vector, created_at) " +
  "VALUES (?, ?, ?, ?, ?) ON CONFLICT(work_key, model) DO UPDATE SET " +
  "dim = excluded.dim, vector = excluded.vector, created_at = excluded.created_at";

const SELECT_EMBEDDINGS_FOR_MODEL =
  "SELECT work_key, dim, vector FROM embedding WHERE model = ?";

const SUM_EMBEDDING_BYTES = "SELECT COALESCE(SUM(dim * 4), 0) FROM embedding";

/** Oldest first; `rowid` breaks a tie. Never reads a vector. */
const SELECT_EMBEDDINGS_OLDEST_FIRST =
  "SELECT work_key, model, dim FROM embedding ORDER BY created_at, rowid";

const DELETE_EMBEDDING =
  "DELETE FROM embedding WHERE work_key = ? AND model = ?";

/** A statement's text differs by list length, so it is not kept prepared. */
const QUIET_UNCACHED: SqlQueryOptions = { ...QUIET, noCache: true };

/** Rows into {@link EmbeddingStore.getMany}'s map; a bad blob reads as absent. */
function addVectors(
  into: Map<string, Float32Array>,
  rows: readonly unknown[],
): void {
  for (const result of rows) {
    const source = result as Record<string, unknown>;
    const bytes = blobBytes(source["vector"]);
    const dim = Number(source["dim"]);
    if (bytes !== undefined && dim > 0 && bytes.length === dim * 4) {
      into.set(String(source["work_key"]), floatsOf(bytes));
    }
  }
}

/**
 * {@link EmbeddingStore} over the plugin's database (`P5-T03`; `docs/07` §8.3,
 * §9.2's note of 2026-11-02). No JSON column, so `redactRecord` has nothing to
 * gate. Every statement is {@link QUIET}: Zotero's debug log would otherwise
 * print a vector's bytes.
 *
 * Constructed on the one shared connection by `installPluginDatabase`
 * (`src/bootstrap/pluginDatabase.ts`).
 *
 * @param db - the connection {@link openPluginDatabase} returned, migrated
 * @param options - the cap; a test lowers it
 * @returns the store
 */
export function createEmbeddingStore(
  db: SqlConnection,
  options: EmbeddingStoreOptions = {},
): EmbeddingStore {
  const capBytes = options.capBytes ?? EMBEDDING_CAP_BYTES;
  return {
    async putMany(rows: readonly EmbeddingRow[]): Promise<void> {
      for (const row of rows) {
        if (
          row.workKey === "" ||
          row.model === "" ||
          row.vector.length === 0 ||
          !row.vector.every(Number.isFinite) ||
          !Number.isFinite(row.createdAtEpochMs)
        ) {
          throw new RangeError(
            "[research-helper] a vector needs a work key, a model, finite " +
              "values and a time; nothing was stored",
          );
        }
      }
      if (rows.length === 0) return;
      await db.executeTransaction(async () => {
        for (const row of rows) {
          await db.queryAsync(
            UPSERT_EMBEDDING,
            [
              row.workKey,
              row.model,
              row.vector.length,
              float32Blob(row.vector),
              row.createdAtEpochMs,
            ],
            QUIET,
          );
        }
      });
    },

    async getMany(
      workKeys: readonly string[],
      model: string,
    ): Promise<ReadonlyMap<string, Float32Array>> {
      const found = new Map<string, Float32Array>();
      for (
        let start = 0;
        start < workKeys.length;
        start += EMBEDDING_IN_LIST_MAX
      ) {
        const keys = workKeys.slice(start, start + EMBEDDING_IN_LIST_MAX);
        addVectors(
          found,
          resultRows(
            await db.queryAsync(
              `${SELECT_EMBEDDINGS_FOR_MODEL} AND work_key IN (${keys
                .map(() => "?")
                .join(", ")})`,
              [model, ...keys],
              QUIET_UNCACHED,
            ),
          ),
        );
      }
      return found;
    },

    async allForModel(
      model: string,
    ): Promise<ReadonlyMap<string, Float32Array>> {
      const found = new Map<string, Float32Array>();
      addVectors(
        found,
        resultRows(
          await db.queryAsync(SELECT_EMBEDDINGS_FOR_MODEL, [model], QUIET),
        ),
      );
      return found;
    },

    async evictToCap(
      isInLibrary: (workKey: string) => boolean,
    ): Promise<EmbeddingEviction> {
      let bytes = Number(
        await db.valueQueryAsync(SUM_EMBEDDING_BYTES, [], QUIET),
      );
      if (bytes <= capBytes) return { evicted: 0, bytes };
      const rows = resultRows(
        await db.queryAsync(SELECT_EMBEDDINGS_OLDEST_FIRST, [], QUIET),
      ).map((result) => {
        const source = result as Record<string, unknown>;
        return {
          workKey: String(source["work_key"]),
          model: String(source["model"]),
          bytes: Number(source["dim"]) * 4,
        };
      });
      const outside: typeof rows = [];
      const inside: typeof rows = [];
      for (const row of rows) {
        (isInLibrary(row.workKey) ? inside : outside).push(row);
      }
      const victims: typeof rows = [];
      for (const row of [...outside, ...inside]) {
        if (bytes <= capBytes) break;
        victims.push(row);
        bytes -= row.bytes;
      }
      await db.executeTransaction(async () => {
        for (const victim of victims) {
          await db.queryAsync(
            DELETE_EMBEDDING,
            [victim.workKey, victim.model],
            QUIET,
          );
        }
      });
      return { evicted: victims.length, bytes };
    },
  };
}

// ---------------------------------------------------------------------------
// The cache's blob directory (`P3-T33`)
// ---------------------------------------------------------------------------

/**
 * `docs/07` §8.3 and §9.2: spilled cache values live in
 * `<data dir>/research-helper/cache/blobs/<sha256>`, in the data directory
 * beside the database (§8.4), never in the profile directory.
 */
export function cacheBlobDirectory(): string {
  return PathUtils.join(
    Zotero.DataDirectory.dir,
    "research-helper",
    "cache",
    "blobs",
  );
}

/** A blob file name: exactly the 64 hex characters `sqliteCache.ts` makes. */
const BLOB_NAME = /^[0-9a-f]{64}$/;

function checkedName(name: string): string {
  if (!BLOB_NAME.test(name)) {
    throw new RangeError(
      "[research-helper] a cache blob name must be 64 lower-case hex characters",
    );
  }
  return name;
}

/**
 * `src/core/cache/sqliteCache.ts`'s `CacheBlobStore` over `IOUtils`.
 *
 * A write goes to a temporary file that is renamed into place (`tmpPath`), so
 * a crash mid-write leaves the old file or none, never half of one. The
 * directory is created on the first write. Only names of the shape the cache
 * makes are accepted, so no caller can reach a path outside the directory.
 * The directory is resolved on every call, from `Zotero.DataDirectory.dir`, so
 * a relocated data directory is followed (§8.4).
 *
 * @param directory - the blob directory; {@link cacheBlobDirectory} outside a test
 * @returns the store
 */
export function createCacheBlobStore(
  directory: () => string = cacheBlobDirectory,
): CacheBlobStore {
  const pathOf = (name: string): string =>
    PathUtils.join(directory(), checkedName(name));
  return {
    async write(name: string, text: string): Promise<void> {
      const path = pathOf(name);
      await IOUtils.makeDirectory(directory(), {
        createAncestors: true,
        ignoreExisting: true,
      });
      await IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` });
    },

    async read(name: string): Promise<string | undefined> {
      const path = pathOf(name);
      if (!(await IOUtils.exists(path))) return undefined;
      return IOUtils.readUTF8(path);
    },

    async remove(name: string): Promise<void> {
      await IOUtils.remove(pathOf(name), { ignoreAbsent: true });
    },

    async list(): Promise<readonly string[]> {
      const children = await IOUtils.getChildren(directory(), {
        ignoreAbsent: true,
      });
      return children
        .map((child) => PathUtils.filename(child))
        .filter((name) => BLOB_NAME.test(name));
    },
  };
}
