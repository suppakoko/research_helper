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
 *   opened by `src/bootstrap/registerUI.ts` at startup and closed on shutdown.
 * - {@link createProvenanceStore} — `src/core/provenance.ts`'s
 *   `ProvenanceStore` port, with **exactly the two operations** `P2-T17` step 1
 *   names. Phase 3 widens it (`P3-T15`, `P3-T29`).
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
  parseStoredProvenance,
  serializeProvenance,
  type ProvenanceStore,
  type SearchProvenance,
} from "../core/provenance";

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
