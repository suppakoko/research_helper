/**
 * The preferences pane's clear actions, "Delete all plugin data" and "Reset to
 * defaults" (`plan/10` `P7-T10`; `docs/09` §3.7, §7's storage lines;
 * `docs/13` §8.7, §8.1's uninstall line).
 *
 * ## Who calls what (`plan/README.md` §5 rule 10)
 *
 * - The pane's host, `createPreferencesHost` in `src/ui/prefs/preferencesPane.ts`,
 *   through the `DataResetPort` that `preferencesDataResetPort` in
 *   `src/bootstrap/registerUI.ts` builds over the open plugin database. That
 *   file is the constructing file.
 * - `uninstallPluginData` in `src/bootstrap/registerUI.ts`, which `onUninstall`
 *   (`src/hooks.ts`) calls from `uninstall()` in `addon/bootstrap.js`, over a
 *   connection of its own: at uninstall the plugin's own connection is closed.
 *
 * ## What each action removes
 *
 * The cache's seven namespaces are split between the clears with no overlap
 * (`DECIDED 2026-11-17 (coordinator, under item 313)`, `plan/reports/P7-T10.md`):
 * a stored summary and a stored vector each live in a table **and** may be served
 * from the cache, so "Clear stored summaries" also clears the `summary`
 * namespace and "Clear embeddings" the `embedding` namespace — otherwise the
 * next run would serve what the user just cleared. "Clear cached responses" is
 * the other five namespaces ({@link RESPONSE_NAMESPACES}).
 *
 * | Action | Tables | Cache namespaces |
 * |---|---|---|
 * | {@link clearCachedResponses} | none | {@link RESPONSE_NAMESPACES} |
 * | {@link clearStoredSummaries} | `summary` | `summary` |
 * | {@link clearJobHistory} | `job`, ended rows only | none |
 * | {@link clearEmbeddings} | `embedding` | `embedding` |
 * | {@link deleteAllPluginData} | every {@link PLUGIN_TABLES} row, and each stored report's Markdown file | every namespace, with its blobs |
 *
 * **No action touches a Zotero item, a note or a key.** The Zotero notes a
 * summary or a report was saved as stay (`docs/09` §3.7); "Remove all Research
 * Helper content" (`P7-T11`) is the one command that moves notes, and only to
 * the trash. Keys have their own button, and only uninstall removes them.
 *
 * This file names no platform: the connection, the cache and the report files are
 * ports (`docs/07` §2.3), so `test/unit/core/dataReset.test.ts` runs it on a real
 * SQLite in Node.
 */

import type { Cache, CacheNamespace } from "./cache/cache";
import { CACHE_NAMESPACES } from "./cache/cache";

/** A SQL parameter, as `src/zotero/db.ts`'s `SqlParam` is. */
export type ResetSqlParam = string | number | null;

/** The three calls this file makes on the plugin's connection. */
export interface ResetConnection {
  queryAsync(sql: string, params?: readonly ResetSqlParam[]): Promise<unknown>;
  valueQueryAsync(
    sql: string,
    params?: readonly ResetSqlParam[],
  ): Promise<unknown>;
  executeTransaction<T>(func: () => Promise<T>): Promise<T>;
}

/** What the actions run over. */
export interface DataResetPorts {
  readonly connection: ResetConnection;
  /** The cache over the same file: its clear removes each entry's blob too. */
  readonly cache: Pick<Cache, "clearNamespace" | "stats" | "prune">;
  /**
   * The stored reports' Markdown files (`src/zotero/db.ts`'s
   * `createReportMarkdownFiles`); absent, none is removed.
   */
  readonly reportFiles?: { remove(id: string): Promise<void> };
}

/**
 * Every table the plugin's migrations create, `schema_version` excepted
 * (`src/bootstrap/migrations.ts`; `test/unit/core/dataReset.test.ts` checks the
 * two agree).
 */
export const PLUGIN_TABLES = [
  "search_provenance",
  "job",
  "cache_entry",
  "user_price",
  "collection_settings",
  "summary",
  "report",
  "collection_profile",
  "recommendation",
  "embedding",
] as const;

export type PluginTable = (typeof PLUGIN_TABLES)[number];

/** The namespaces "Clear cached responses" removes: every one but `summary` and `embedding`. */
export const RESPONSE_NAMESPACES: readonly CacheNamespace[] =
  CACHE_NAMESPACES.filter(
    (namespace) => namespace !== "summary" && namespace !== "embedding",
  );

/**
 * The job states that are history: the job has ended. A queued, running,
 * paused, cancelling or interrupted job may still run, so its row stays
 * (`DECIDED 2026-11-17 (coordinator, under item 313)`).
 */
export const ENDED_JOB_STATUSES = ["succeeded", "failed", "cancelled"] as const;

/** One action's figures: rows of its tables, and entries and bytes of its namespaces. */
export interface DataCounts {
  readonly rows: number;
  readonly entries: number;
  readonly bytes: number;
}

/** The pane's four clears and the one delete. */
export type DataKind =
  "cached-responses" | "summaries" | "job-history" | "embeddings" | "all";

export const DATA_KINDS: readonly DataKind[] = [
  "cached-responses",
  "summaries",
  "job-history",
  "embeddings",
  "all",
];

/** {@link deleteAllPluginData}'s options. */
export interface DeleteAllOptions {
  /**
   * Keep the rows of jobs that have not ended ({@link ENDED_JOB_STATUSES}). The
   * pane sets it, because a running job writes its row again; uninstall does not.
   */
  readonly keepActiveJobs?: boolean;
}

/** What {@link deleteAllPluginData} removed. */
export interface DeleteAllResult extends DataCounts {
  /** Rows removed, per table that exists in the file. */
  readonly byTable: Readonly<Partial<Record<PluginTable, number>>>;
  /** Report Markdown files removed. */
  readonly files: number;
}

function asCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The plugin tables this file holds: a file at an older schema lacks some. */
async function presentTables(
  db: ResetConnection,
): Promise<ReadonlySet<PluginTable>> {
  const rows = await db.queryAsync(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  const names = new Set(
    (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []).map(
      (row) => String(row["name"]),
    ),
  );
  return new Set(PLUGIN_TABLES.filter((table) => names.has(table)));
}

const ENDED_IN = `status IN (${ENDED_JOB_STATUSES.map(() => "?").join(", ")})`;

/** `SELECT COUNT(*)` of `table`, under `where` when given. */
async function countRows(
  db: ResetConnection,
  table: PluginTable,
  where?: { readonly sql: string; readonly params: readonly ResetSqlParam[] },
): Promise<number> {
  return asCount(
    await db.valueQueryAsync(
      `SELECT COUNT(*) FROM ${table}${where === undefined ? "" : ` WHERE ${where.sql}`}`,
      where?.params ?? [],
    ),
  );
}

/** Count, then delete, in one transaction; returns the count. */
async function deleteRows(
  db: ResetConnection,
  table: PluginTable,
  where?: { readonly sql: string; readonly params: readonly ResetSqlParam[] },
): Promise<number> {
  return db.executeTransaction(async () => {
    const n = await countRows(db, table, where);
    if (n > 0) {
      await db.queryAsync(
        `DELETE FROM ${table}${where === undefined ? "" : ` WHERE ${where.sql}`}`,
        where?.params ?? [],
      );
    }
    return n;
  });
}

/** Entries and bytes of `namespaces`, from `Cache.stats()`. */
async function cacheFigures(
  cache: DataResetPorts["cache"],
  namespaces: readonly CacheNamespace[],
): Promise<{ entries: number; bytes: number }> {
  const stats = await cache.stats();
  let entries = 0;
  let bytes = 0;
  for (const namespace of namespaces) {
    const one = stats.byNamespace[namespace] as
      { entries?: unknown; bytes?: unknown } | undefined;
    entries += asCount(one?.entries);
    bytes += asCount(one?.bytes);
  }
  return { entries, bytes };
}

async function clearNamespaces(
  cache: DataResetPorts["cache"],
  namespaces: readonly CacheNamespace[],
): Promise<number> {
  let removed = 0;
  for (const namespace of namespaces) {
    removed += asCount(await cache.clearNamespace(namespace));
  }
  return removed;
}

/**
 * What an action would remove, read without writing: the confirmation names
 * these figures (`P7-T10` step 1).
 *
 * @param ports - the connection, the cache and the report files
 * @param kind - the action
 */
export async function countData(
  ports: DataResetPorts,
  kind: DataKind,
): Promise<DataCounts> {
  const db = ports.connection;
  const tables = await presentTables(db);
  const rowsOf = async (
    table: PluginTable,
    where?: { readonly sql: string; readonly params: readonly ResetSqlParam[] },
  ): Promise<number> => (tables.has(table) ? countRows(db, table, where) : 0);
  switch (kind) {
    case "cached-responses":
      return {
        rows: 0,
        ...(await cacheFigures(ports.cache, RESPONSE_NAMESPACES)),
      };
    case "summaries":
      return {
        rows: await rowsOf("summary"),
        ...(await cacheFigures(ports.cache, ["summary"])),
      };
    case "job-history":
      return {
        rows: await rowsOf("job", {
          sql: ENDED_IN,
          params: ENDED_JOB_STATUSES,
        }),
        entries: 0,
        bytes: 0,
      };
    case "embeddings":
      return {
        rows: await rowsOf("embedding"),
        ...(await cacheFigures(ports.cache, ["embedding"])),
      };
    case "all": {
      let rows = 0;
      for (const table of PLUGIN_TABLES) {
        if (table === "cache_entry") continue; // counted as entries below
        rows += await rowsOf(table);
      }
      return { rows, ...(await cacheFigures(ports.cache, CACHE_NAMESPACES)) };
    }
  }
}

/**
 * "Clear cached API responses": {@link RESPONSE_NAMESPACES}, with their blobs.
 *
 * @returns what was removed: entries, and the bytes they held before
 */
export async function clearCachedResponses(
  ports: DataResetPorts,
): Promise<DataCounts> {
  const before = await cacheFigures(ports.cache, RESPONSE_NAMESPACES);
  const entries = await clearNamespaces(ports.cache, RESPONSE_NAMESPACES);
  return { rows: 0, entries, bytes: before.bytes };
}

/**
 * "Clear stored summaries": the `summary` table and the `summary` namespace.
 * **No Zotero note is touched** (`docs/09` §3.7).
 */
export async function clearStoredSummaries(
  ports: DataResetPorts,
): Promise<DataCounts> {
  const tables = await presentTables(ports.connection);
  const before = await cacheFigures(ports.cache, ["summary"]);
  const rows = tables.has("summary")
    ? await deleteRows(ports.connection, "summary")
    : 0;
  const entries = await clearNamespaces(ports.cache, ["summary"]);
  return { rows, entries, bytes: before.bytes };
}

/** "Clear job history": the `job` rows of ended jobs ({@link ENDED_JOB_STATUSES}). */
export async function clearJobHistory(
  ports: DataResetPorts,
): Promise<DataCounts> {
  const tables = await presentTables(ports.connection);
  const rows = tables.has("job")
    ? await deleteRows(ports.connection, "job", {
        sql: ENDED_IN,
        params: ENDED_JOB_STATUSES,
      })
    : 0;
  return { rows, entries: 0, bytes: 0 };
}

/** "Clear embeddings": the `embedding` table and the `embedding` namespace. */
export async function clearEmbeddings(
  ports: DataResetPorts,
): Promise<DataCounts> {
  const tables = await presentTables(ports.connection);
  const before = await cacheFigures(ports.cache, ["embedding"]);
  const rows = tables.has("embedding")
    ? await deleteRows(ports.connection, "embedding")
    : 0;
  const entries = await clearNamespaces(ports.cache, ["embedding"]);
  return { rows, entries, bytes: before.bytes };
}

/**
 * "Delete all plugin data" (`P7-T10` step 3), and uninstall's sweep (step 5):
 * every plugin table's rows, every cache entry with its blob, and each stored
 * report's Markdown file. `schema_version` stays, so the file stays at its
 * schema. Keys are not touched; the pane has a button for them, and uninstall
 * clears them itself.
 *
 * @param ports - the connection, the cache and the report files
 * @param options - see {@link DeleteAllOptions}
 */
export async function deleteAllPluginData(
  ports: DataResetPorts,
  options: DeleteAllOptions = {},
): Promise<DeleteAllResult> {
  const db = ports.connection;
  const tables = await presentTables(db);
  const byTable: Partial<Record<PluginTable, number>> = {};

  // The Markdown files first, while the rows still name them.
  let files = 0;
  if (tables.has("report") && ports.reportFiles !== undefined) {
    const rows = await db.queryAsync("SELECT id FROM report");
    for (const row of Array.isArray(rows)
      ? (rows as Record<string, unknown>[])
      : []) {
      const id = row["id"];
      if (typeof id !== "string") continue;
      try {
        await ports.reportFiles.remove(id);
        files += 1;
      } catch {
        // A file that cannot be removed is left; its row still goes. No path
        // is logged here or anywhere (docs/09 §2.2).
      }
    }
  }

  // The cache through its own clear, so every entry's blob goes with it; a row
  // of a namespace this build does not know is deleted below, and the prune's
  // orphan sweep removes its blob.
  const before = await cacheFigures(ports.cache, CACHE_NAMESPACES);
  let entries = await clearNamespaces(ports.cache, CACHE_NAMESPACES);
  if (tables.has("cache_entry")) {
    entries += await deleteRows(db, "cache_entry");
    await ports.cache.prune();
  }

  let rows = 0;
  for (const table of PLUGIN_TABLES) {
    if (table === "cache_entry" || !tables.has(table)) continue;
    const n =
      table === "job" && options.keepActiveJobs === true
        ? await deleteRows(db, "job", {
            sql: ENDED_IN,
            params: ENDED_JOB_STATUSES,
          })
        : await deleteRows(db, table);
    byTable[table] = n;
    rows += n;
  }
  byTable.cache_entry = entries;
  return { rows, entries, bytes: before.bytes, byTable, files };
}

/** One preference as {@link resetPreferences} reads it: `src/prefs/schema.ts`'s `PrefDef`. */
export interface ResettablePref {
  readonly key: string;
  readonly secret?: boolean;
}

/**
 * The preferences "Reset to defaults" keeps, by their `PREFS` property name:
 * rows that record state rather than a choice
 * (`DECIDED 2026-11-17 (coordinator, under item 313)`, `plan/reports/P7-T10.md`).
 *
 * - `secretBackend` says which store holds the keys; the keys stay, so it does.
 * - `*KeyPresent`, `*LastValidatedAt` and `*LastValidationResult` describe the
 *   stored keys (`docs/09` §1.9); reset, the pane would say a stored key is
 *   absent.
 * - `prefsSchemaVersion` is the preferences' migration marker (`docs/07`
 *   §8.5.3), and `cacheLastSeenPromptVersions` the cache's prompt-version
 *   marker (§9.3); reset, the next start would migrate or invalidate again.
 *
 * @param name - a `PREFS` property name
 */
export function isKeptOnReset(name: string): boolean {
  return (
    name === "secretBackend" ||
    name === "prefsSchemaVersion" ||
    name === "cacheLastSeenPromptVersions" ||
    /(?:KeyPresent|LastValidatedAt|LastValidationResult)$/.test(name)
  );
}

/**
 * "Reset to defaults" (`P7-T10` step 4): clear the user value of every
 * non-secret preference, which restores its shipped default — the `docs/07`
 * §8.5 default `addon/prefs.js` declares. A `secret: true` row is never
 * touched, nor a row {@link isKeptOnReset} keeps, and no key is.
 *
 * @param store - `clear(key)` over the branch (`src/prefs`' `PrefStore`)
 * @param prefs - every preference by property name: `PREFS` in the product
 * @returns how many preferences were cleared
 */
export function resetPreferences(
  store: { clear(key: string): void },
  prefs: Readonly<Record<string, ResettablePref>>,
): number {
  let cleared = 0;
  for (const [name, def] of Object.entries(prefs)) {
    if (def.secret === true || isKeptOnReset(name)) continue;
    store.clear(def.key);
    cleared += 1;
  }
  return cleared;
}

/**
 * The action for `kind`.
 *
 * @param ports - the connection, the cache and the report files
 * @param kind - which clear, or `"all"`
 * @returns what was removed
 */
export async function clearData(
  ports: DataResetPorts,
  kind: DataKind,
): Promise<DataCounts> {
  switch (kind) {
    case "cached-responses":
      return clearCachedResponses(ports);
    case "summaries":
      return clearStoredSummaries(ports);
    case "job-history":
      return clearJobHistory(ports);
    case "embeddings":
      return clearEmbeddings(ports);
    case "all":
      return deleteAllPluginData(ports, { keepActiveJobs: true });
  }
}

/** {@link runUninstallSweep}'s three steps, bound by `src/bootstrap/uninstall.ts`. */
export interface UninstallSteps {
  /** Remove every stored key; resolves to how many. */
  clearKeys(): Promise<number>;
  /**
   * {@link deleteAllPluginData} over a connection of its own; `undefined` when
   * there is no database file to open.
   */
  deleteData(): Promise<DeleteAllResult | undefined>;
  /** Clear every preference under the plugin's branch; returns how many had a user value. */
  clearPrefs(): number;
}

/** What uninstall removed. Counts only: no path, no key, no value. */
export interface UninstallReport {
  readonly keys: number;
  readonly rows: number;
  readonly entries: number;
  readonly files: number;
  readonly prefs: number;
  /** The steps that threw, by name; the others still ran. */
  readonly failed: readonly ("keys" | "data" | "prefs")[];
}

/**
 * `P7-T10` step 5: uninstall's sweep — keys, then data, then preferences. Keys
 * go first, because the key store reads `secretBackend`; preferences go last
 * for the same reason. Each step runs whatever the one before it did, and
 * none throws out of here: uninstall goes ahead (`addon/bootstrap.js`).
 *
 * @param steps - the three platform steps
 */
export async function runUninstallSweep(
  steps: UninstallSteps,
): Promise<UninstallReport> {
  const failed: ("keys" | "data" | "prefs")[] = [];
  let keys = 0;
  try {
    keys = asCount(await steps.clearKeys());
  } catch {
    failed.push("keys");
  }
  let data: DeleteAllResult | undefined;
  try {
    data = await steps.deleteData();
  } catch {
    failed.push("data");
  }
  let prefs = 0;
  try {
    prefs = asCount(steps.clearPrefs());
  } catch {
    failed.push("prefs");
  }
  return {
    keys,
    rows: data?.rows ?? 0,
    entries: data?.entries ?? 0,
    files: data?.files ?? 0,
    prefs,
    failed,
  };
}

/** An audio attachment a stored report names, by library and key. */
export interface ReportAudioKey {
  readonly libraryID: number;
  readonly key: string;
}

/**
 * `P7-T11` step 1 (c): the audio attachments every stored report names —
 * `TrendReport.audioAttachmentKeys` (`src/model/trend.ts`) of each `report`
 * row, in the row's library. A row whose `json` does not parse, or names no
 * audio, gives none. Read before {@link deleteAllPluginData} removes the rows.
 *
 * Caller: `preferencesContentRemovalPort` in `src/bootstrap/registerUI.ts`.
 *
 * @param db - the plugin's connection
 */
export async function reportAudioKeys(
  db: ResetConnection,
): Promise<ReportAudioKey[]> {
  if (!(await presentTables(db)).has("report")) return [];
  const rows = await db.queryAsync("SELECT library_id, json FROM report");
  const found: ReportAudioKey[] = [];
  for (const row of Array.isArray(rows)
    ? (rows as Record<string, unknown>[])
    : []) {
    const libraryID = Number(row["library_id"]);
    if (!Number.isInteger(libraryID)) continue;
    let keys: unknown;
    try {
      keys = (
        JSON.parse(String(row["json"])) as { audioAttachmentKeys?: unknown }
      ).audioAttachmentKeys;
    } catch {
      continue;
    }
    if (typeof keys !== "object" || keys === null) continue;
    for (const key of Object.values(keys as Record<string, unknown>)) {
      if (
        typeof key === "string" &&
        key !== "" &&
        !found.some((one) => one.libraryID === libraryID && one.key === key)
      ) {
        found.push({ libraryID, key });
      }
    }
  }
  return found;
}
