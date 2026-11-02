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
 * two statements to it. Phase 3 adds its tables as version 2 and later, never
 * by editing version 1: a migration that has run on a user's machine is
 * history. Version 2 is §8.3's `job` table and `idx_job_status` (`P3-T34`).
 * Version 3 is §8.3's `cache_entry` table and its two indexes (`P3-T33`).
 * Version 4 is §8.3's `user_price` table, the user-edited price table
 * (`plan/00` §6 item 265 (b), owner, 2026-10-21). Version 5 is §8.3's
 * `collection_settings` table: the per-collection privacy override and the
 * "don't ask again for this collection" record (`P3-T15`; `docs/09` §3.5,
 * §3.6 item 2). Version 6 is §8.3's `summary` table and `idx_summary_work`,
 * without the `REFERENCES work(work_key)` clause (`P3-T25`; owner, `plan/00`
 * §6 item 272(b): no phase writes `work` yet, and whether
 * `Zotero.DBConnection` enforces foreign keys is unverified — the migration
 * that first populates `work` adds it). Version 7 is §8.3's `report` table
 * (`P4-T14`), with no foreign key and no index because §8.3 declares neither;
 * the report's Markdown is a file beside the database, not a column
 * (`docs/07` §5.2's note of 2026-10-30). Versions 8, 9 and 10 are §8.3's
 * `collection_profile`, `recommendation` with `idx_rec_profile`, and
 * `embedding` with `idx_embedding_model` (`P5-T03`), one migration per table,
 * with no `REFERENCES` clause.
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

/**
 * `docs/07` §8.3's `job` table (`P3-T34`), column for column, as corrected
 * 2026-10-21: §5.2's `JobRecord` stored whole, including the pause reason and
 * the redaction marks. `src/core/jobQueue/jobRecord.ts`'s `JobRow` is the same
 * columns in the same order.
 */
export const JOB_DDL = `CREATE TABLE job (
  id            TEXT PRIMARY KEY,
  pipeline_id   TEXT NOT NULL,
  status        TEXT NOT NULL,
  priority      TEXT NOT NULL,
  exclusivity_key TEXT,
  input_json    TEXT NOT NULL,
  input_version INTEGER NOT NULL,
  checkpoint_json TEXT,
  checkpoint_at INTEGER,
  progress_json TEXT NOT NULL,
  usage_json    TEXT NOT NULL,
  error_json    TEXT,
  library_id    INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  plugin_version TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  finished_at   INTEGER,
  pause_reason  TEXT,
  warnings_json TEXT NOT NULL,
  budget_usd    REAL,
  result_ref_json TEXT,
  redaction_json TEXT NOT NULL
)`;

/** `docs/07` §8.3's index for `recover()`'s reads by state (§7.6). */
export const JOB_STATUS_INDEX_DDL =
  "CREATE INDEX idx_job_status ON job(status)";

/**
 * `docs/07` §8.3's `cache_entry` table (`P3-T33`), byte for byte — the
 * comments inside the statement included, so the unit test compares rather
 * than interprets. `src/core/cache/sqliteCache.ts` is its only reader and
 * writer.
 */
export const CACHE_ENTRY_DDL = `CREATE TABLE cache_entry (
  namespace    TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        TEXT,                  -- inline value, or NULL when blob_path set
  blob_path    TEXT,                  -- relative path for large values
  size_bytes   INTEGER NOT NULL,
  tags         TEXT NOT NULL DEFAULT '',   -- comma-joined
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  last_access  INTEGER NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (namespace, key)
)`;

/** `docs/07` §8.3's index for §9.4 step 1, the expiry sweep. */
export const CACHE_EXPIRY_INDEX_DDL =
  "CREATE INDEX idx_cache_expiry ON cache_entry(expires_at)";

/** `docs/07` §8.3's index for §9.4's least-recently-used order. */
export const CACHE_LRU_INDEX_DDL =
  "CREATE INDEX idx_cache_lru    ON cache_entry(last_access)";

/**
 * `docs/07` §8.3's `user_price` table (`plan/00` §6 item 265 (b), owner,
 * 2026-10-21), byte for byte with the comments inside the statement: one row
 * per provider and model in the shape of `UserPriceOverride`
 * (`src/llm/shared/pricing.ts`), fractional US dollars per million tokens
 * (item 252). `src/zotero/db.ts`'s `createUserPriceStore` is its only reader
 * and writer.
 */
export const USER_PRICE_DDL = `CREATE TABLE user_price (
  provider_id               TEXT NOT NULL,     -- a ProviderId
  model_id                  TEXT NOT NULL,     -- as the picker lists it for provider_id
  input_per_mtok_usd        REAL NOT NULL CHECK (input_per_mtok_usd >= 0),
  output_per_mtok_usd       REAL NOT NULL CHECK (output_per_mtok_usd >= 0),
  cached_input_per_mtok_usd REAL CHECK (cached_input_per_mtok_usd >= 0),   -- NULL: unknown
  as_of                     INTEGER NOT NULL,  -- epoch ms: when the user read these prices
  PRIMARY KEY (provider_id, model_id)
)`;

/**
 * `docs/07` §8.3's `collection_settings` table (`P3-T15`), byte for byte with
 * the comment inside the statement. `json` is a JSON object whose privacy
 * members `docs/07` §4.5's `PrivacyPolicy` note declares; a per-collection
 * override can only make the global `privacy.mode` stricter (`docs/09` §3.5),
 * and is never a preference. `src/zotero/db.ts`'s
 * `createCollectionSettingsStore` is its only reader and writer.
 */
export const COLLECTION_SETTINGS_DDL = `CREATE TABLE collection_settings (
  library_id     INTEGER NOT NULL,
  collection_key TEXT NOT NULL,
  json           TEXT NOT NULL,     -- privacy overrides, model overrides
  PRIMARY KEY (library_id, collection_key)
)`;

/**
 * `docs/07` §8.3's `summary` table (`P3-T25`), byte for byte, as corrected
 * 2026-10-28: no `REFERENCES work(work_key) ON DELETE CASCADE` on `work_key`
 * (owner, `plan/00` §6 item 272(b)). One row per `StoredSummary`
 * (`docs/07` §5.2); `src/zotero/db.ts`'s `createSummaryStore` is its only
 * reader and writer.
 */
export const SUMMARY_DDL = `CREATE TABLE summary (
  id                  TEXT PRIMARY KEY,
  work_key            TEXT NOT NULL,
  zotero_item_key     TEXT,
  prompt_version      TEXT NOT NULL,
  provider_id         TEXT NOT NULL,
  model_id            TEXT NOT NULL,
  input_scope         TEXT NOT NULL,
  source_item_version TEXT,
  json                TEXT NOT NULL,
  generated_at        INTEGER NOT NULL
)`;

/** `docs/07` §8.3's index for "queried by work + version". */
export const SUMMARY_WORK_INDEX_DDL =
  "CREATE INDEX idx_summary_work ON summary(work_key)";

/**
 * `docs/07` §8.3's `report` table (`P4-T14`), byte for byte. One row per
 * `TrendReport` (`docs/07` §5.2): `json` is the gated record without its
 * Markdown, which is always in `<data dir>/research-helper/reports/<id>.md`.
 * `src/zotero/db.ts`'s `createReportStore` is its only writer and the plugin's
 * only reader; `scripts/eval-trend-report.ts` reads it read-only, outside the
 * plugin.
 */
export const REPORT_DDL = `CREATE TABLE report (
  id             TEXT PRIMARY KEY,
  library_id     INTEGER NOT NULL,
  collection_key TEXT NOT NULL,
  json           TEXT NOT NULL,
  markdown_path  TEXT,
  note_key       TEXT,
  generated_at   INTEGER NOT NULL
)`;

/**
 * `docs/07` §8.3's `collection_profile` table (`P5-T03`), byte for byte with
 * the comments inside the statement. One row per `CollectionProfile`
 * (`docs/07` §5.2): `json` is the gated record without its centroids, which
 * are the `centroids` blob, sliced by `centroid_count`. `src/zotero/db.ts`'s
 * `createCollectionProfileStore` is its only reader and writer.
 */
export const COLLECTION_PROFILE_DDL = `CREATE TABLE collection_profile (
  id              TEXT PRIMARY KEY,
  library_id      INTEGER NOT NULL,
  collection_key  TEXT NOT NULL,
  membership_hash TEXT NOT NULL,
  json            TEXT NOT NULL,
  centroids       BLOB,              -- k × dim Float32Array bytes, row-major; NULL when k = 0
  centroid_count  INTEGER NOT NULL DEFAULT 0,   -- k, so the blob can be sliced without dim math
  built_at        INTEGER NOT NULL
)`;

/**
 * `docs/07` §8.3's `recommendation` table (`P5-T03`), byte for byte. One row
 * per `Recommendation` (`docs/07` §5.2): `json` is the gated record without
 * `userAction` and `userActionAtEpochMs`, which are `user_action` and
 * `action_at`. `src/zotero/db.ts`'s `createRecommendationStore` is its only
 * reader and writer.
 */
export const RECOMMENDATION_DDL = `CREATE TABLE recommendation (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL,
  work_key     TEXT NOT NULL,
  score        REAL NOT NULL,
  json         TEXT NOT NULL,
  user_action  TEXT,
  action_at    INTEGER,
  generated_at INTEGER NOT NULL
)`;

/** `docs/07` §8.3's index over one profile's rows. */
export const RECOMMENDATION_PROFILE_INDEX_DDL =
  "CREATE INDEX idx_rec_profile ON recommendation(profile_id, score DESC)";

/**
 * `docs/07` §8.3's `embedding` table (`P5-T03`), byte for byte with the
 * comment inside the statement. `src/zotero/db.ts`'s `createEmbeddingStore`
 * is its only reader and writer.
 */
export const EMBEDDING_DDL = `CREATE TABLE embedding (
  work_key   TEXT NOT NULL,
  model      TEXT NOT NULL,
  dim        INTEGER NOT NULL,
  vector     BLOB NOT NULL,          -- Float32Array bytes
  created_at INTEGER NOT NULL,
  PRIMARY KEY (work_key, model)
)`;

/** `docs/07` §8.3's index for "load every vector for embedding model X". */
export const EMBEDDING_MODEL_INDEX_DDL =
  "CREATE INDEX idx_embedding_model ON embedding(model)";

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
  // `P3-T34`: the job queue's records (`docs/07` §7.6, §8.3).
  {
    version: 2,
    statements: [JOB_DDL, JOB_STATUS_INDEX_DDL],
  },
  // `P3-T33`: the cache (`docs/07` §8.3, §9).
  {
    version: 3,
    statements: [CACHE_ENTRY_DDL, CACHE_EXPIRY_INDEX_DDL, CACHE_LRU_INDEX_DDL],
  },
  // `plan/00` §6 item 265 (b): the user-edited price table (`docs/07` §8.3).
  {
    version: 4,
    statements: [USER_PRICE_DDL],
  },
  // `P3-T15`: per-collection privacy settings (`docs/07` §8.3, `docs/09` §3.5).
  {
    version: 5,
    statements: [COLLECTION_SETTINGS_DDL],
  },
  // `P3-T25`: the stored summaries (`docs/07` §5.2, §8.3).
  {
    version: 6,
    statements: [SUMMARY_DDL, SUMMARY_WORK_INDEX_DDL],
  },
  // `P4-T14`: the stored trend reports (`docs/07` §5.2, §8.3).
  {
    version: 7,
    statements: [REPORT_DDL],
  },
  // `P5-T03`: the collection profile (`docs/07` §5.2, §8.3).
  {
    version: 8,
    statements: [COLLECTION_PROFILE_DDL],
  },
  // `P5-T03`: the recommendations and their rejections (`docs/07` §5.2, §8.3).
  {
    version: 9,
    statements: [RECOMMENDATION_DDL, RECOMMENDATION_PROFILE_INDEX_DDL],
  },
  // `P5-T03`: the stored paper vectors (`docs/07` §8.3, §9.2).
  {
    version: 10,
    statements: [EMBEDDING_DDL, EMBEDDING_MODEL_INDEX_DDL],
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
