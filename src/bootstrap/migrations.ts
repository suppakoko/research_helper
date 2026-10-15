/**
 * The plugin database's schema, as numbered migrations (`P2-T17`; `docs/07`
 * §8.3: "migrations in `src/bootstrap/migrations.ts`, versioned in a
 * `schema_version` table").
 *
 * ## Version 1 is one table and one index
 *
 * `docs/07` §8.3's schema sketch declares eleven tables. Phase 2 needs one —
 * `search_provenance`, the authoritative copy of `SearchProvenance` (§5.3) —
 * and `P2-T17`'s **Do NOT** forbids a column, an index or a table §8.3 does not
 * declare. So version 1 is §8.3's `search_provenance` DDL and its
 * `idx_provenance_collection`, **copied column for column**, and nothing else;
 * `test/unit/core/provenanceRerun.test.ts` reads §8.3 off disk and compares the
 * two statements to it. Phase 3 adds its tables as version 2 and later
 * (`P3-T15`, `P3-T29`), never by editing version 1: a migration that has run
 * on a user's machine is history.
 *
 * ## The bookkeeping
 *
 * `schema_version` is §8.3's own one-column table,
 * `CREATE TABLE schema_version (version INTEGER NOT NULL)`, holding one row:
 * the version the file is at. Each migration runs in one transaction together
 * with the row's update, so a crash part-way leaves the file at the previous
 * version rather than half-migrated.
 *
 * A file **newer** than this build — written by a later plugin version, then
 * opened after a downgrade — is refused rather than touched: this build cannot
 * know what the later version's rows mean.
 */

import type { SqlConnection } from "../zotero/db";

/** `docs/07` §8.3's bookkeeping table, verbatim. */
export const SCHEMA_VERSION_DDL =
  "CREATE TABLE schema_version (version INTEGER NOT NULL)";

/**
 * `docs/07` §8.3's `search_provenance`, column for column — names, types,
 * constraints and order. Whitespace is §8.3's too, so the comparison in the
 * unit test is a comparison and not an interpretation.
 */
export const SEARCH_PROVENANCE_DDL = `CREATE TABLE search_provenance (
  run_id         TEXT PRIMARY KEY,
  library_id     INTEGER NOT NULL,
  collection_key TEXT,
  note_key       TEXT,
  json           TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER NOT NULL
)`;

/** `docs/07` §8.3's index for FR-12's "find the record for a collection". */
export const PROVENANCE_COLLECTION_INDEX_DDL =
  "CREATE INDEX idx_provenance_collection ON search_provenance(library_id, collection_key)";

/** One schema step. */
export interface Migration {
  /** The version the file is at once this migration has run. */
  readonly version: number;
  /** The statements, run in order inside one transaction. */
  readonly statements: readonly string[];
}

/** Every migration, oldest first. Append; never edit one that has shipped. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [SEARCH_PROVENANCE_DDL, PROVENANCE_COLLECTION_INDEX_DDL],
  },
];

/** The version a fully migrated file is at. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (latest, migration) => Math.max(latest, migration.version),
  0,
);

/** What {@link runMigrations} did. */
export interface MigrationOutcome {
  /** The version the file was at before; `0` for a fresh file. */
  readonly from: number;
  /** The version it is at now. */
  readonly to: number;
}

/**
 * The file's current version: `0` for a file with no `schema_version` table
 * (a fresh file) or an empty one.
 */
async function currentVersion(db: SqlConnection): Promise<number> {
  const tables = await db.valueQueryAsync(
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
  );
  if (Number(tables) === 0) return 0;
  const version = await db.valueQueryAsync(
    "SELECT MAX(version) FROM schema_version",
  );
  return typeof version === "number" ? version : 0;
}

/**
 * Bring the file to {@link LATEST_SCHEMA_VERSION}.
 *
 * Idempotent: a file already at the latest version is read and left alone.
 *
 * @param db - the plugin's connection
 * @param migrations - the steps; {@link MIGRATIONS} outside a test
 * @returns the version before and after
 * @throws when the file is newer than every migration this build has
 */
export async function runMigrations(
  db: SqlConnection,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationOutcome> {
  const from = await currentVersion(db);
  const latest = migrations.reduce(
    (max, migration) => Math.max(max, migration.version),
    0,
  );
  if (from > latest) {
    throw new Error(
      `[research-helper] the plugin database is at schema version ` +
        `${String(from)}, newer than this build's ${String(latest)}; it was ` +
        `written by a later plugin version and is left untouched.`,
    );
  }
  let to = from;
  for (const migration of [...migrations].sort(
    (a, b) => a.version - b.version,
  )) {
    if (migration.version <= to) continue;
    const reached = migration.version;
    await db.executeTransaction(async () => {
      if (to === 0) {
        // The bookkeeping table arrives with the first migration, in the
        // same transaction, so a file is never left with a table but no row.
        const tables = await db.valueQueryAsync(
          "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
        );
        if (Number(tables) === 0) await db.queryAsync(SCHEMA_VERSION_DDL);
      }
      for (const statement of migration.statements) {
        await db.queryAsync(statement);
      }
      await db.queryAsync("DELETE FROM schema_version");
      await db.queryAsync("INSERT INTO schema_version (version) VALUES (?)", [
        reached,
      ]);
    });
    to = reached;
  }
  return { from, to };
}
