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
}

/** One bound parameter. `null` is SQL `NULL`. */
export type SqlParam = string | number | null;

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
