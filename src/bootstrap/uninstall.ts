/**
 * `P7-T10` step 5: what `uninstall()` removes — every stored key, every row of
 * the plugin database with the cache blobs and the report Markdown files, and
 * every preference under the plugin's branch (`docs/09` §7; `docs/13` §8.1's
 * uninstall line).
 *
 * Caller: `onUninstall` in `src/hooks.ts`, loaded with a dynamic `import()`
 * from `uninstall()` in `addon/bootstrap.js` for `ADDON_UNINSTALL` only.
 * `shutdown()` never reaches it. This file is the constructing file of the
 * three {@link UninstallSteps}; `runUninstallSweep` (`src/core/dataReset.ts`)
 * orders them.
 *
 * **No Zotero item, collection or note is touched** — `FR-56`'s second
 * criterion: what the plugin saved into the library is the user's, and
 * "Remove all Research Helper content" (`P7-T11`) is the one way to move it,
 * to the trash, behind its own confirmation.
 *
 * At uninstall the plugin's own connection is closed (`shutdown()` ran first,
 * and a plugin disabled before removal never opened one), so the data step
 * opens one of its own, on a file that is already there: an absent file is
 * not created. Nothing here logs a path.
 */

import { createSqliteCache } from "../core/cache/sqliteCache";
import { createSystemClock } from "../core/clock";
import {
  deleteAllPluginData,
  runUninstallSweep,
  type DeleteAllResult,
  type UninstallReport,
  type UninstallSteps,
} from "../core/dataReset";
import { createLogger, NULL_LOG_SINK } from "../core/logger";
import {
  createCacheBlobStore,
  createReportMarkdownFiles,
  openPluginDatabase,
  pluginDatabaseExists,
} from "../zotero/db";
import { clearAllSecretsOnUninstall } from "../zotero/keychain";
import {
  clearPref,
  listBranchPrefs,
  prefHasUserValue,
} from "../zotero/prefStore";

/**
 * {@link deleteAllPluginData} over a connection of its own, closed afterwards;
 * `undefined` when there is no database file.
 */
export async function uninstallPluginData(): Promise<
  DeleteAllResult | undefined
> {
  if (!(await pluginDatabaseExists())) return undefined;
  const connection = openPluginDatabase();
  try {
    const clock = createSystemClock();
    const cache = createSqliteCache({
      connection: () => Promise.resolve(connection),
      blobs: createCacheBlobStore(),
      clock,
      logger: createLogger({ sink: NULL_LOG_SINK, clock }),
      // No eviction runs here: the sweep removes every entry.
      maxBytes: () => Number.MAX_SAFE_INTEGER,
    });
    try {
      return await deleteAllPluginData({
        connection,
        cache,
        reportFiles: createReportMarkdownFiles(),
      });
    } finally {
      await cache.close();
    }
  } finally {
    await connection.closeDatabase();
  }
}

/**
 * Clear every preference under `extensions.zotero.research-helper.`, the
 * schema's and any other; returns how many had a user value.
 */
export function uninstallPreferences(): number {
  let cleared = 0;
  for (const key of listBranchPrefs()) {
    if (prefHasUserValue(key)) cleared += 1;
    clearPref(key);
  }
  return cleared;
}

/** The three steps over the platform. */
export const ZOTERO_UNINSTALL_STEPS: UninstallSteps = {
  clearKeys: clearAllSecretsOnUninstall,
  deleteData: uninstallPluginData,
  clearPrefs: uninstallPreferences,
};

/** `onUninstall`'s body: the sweep over {@link ZOTERO_UNINSTALL_STEPS}. */
export function uninstallSweep(): Promise<UninstallReport> {
  return runUninstallSweep(ZOTERO_UNINSTALL_STEPS);
}
