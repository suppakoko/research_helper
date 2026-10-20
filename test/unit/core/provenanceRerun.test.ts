/**
 * `P2-T17` — re-running a search from its stored provenance record, at layer 1.
 *
 * Plain Node (`docs/13` §2.1): no Zotero, no network. Three things are
 * asserted here, each against an authority outside the code under test:
 *
 * 1. **The schema** — `src/bootstrap/migrations.ts`'s version 1 against
 *    `docs/07` §8.3's `search_provenance` DDL, read off disk, and against a
 *    real SQLite file: the statements are executed and the schema is read back
 *    through `PRAGMA table_info` / `index_info`.
 * 2. **The store** — `src/zotero/db.ts`'s `createProvenanceStore` over the same
 *    real SQLite, so `ORDER BY finished_at DESC` is executed by SQLite rather
 *    than by a double that would agree with whatever the code says.
 * 3. **The re-hydration** — `src/core/provenance.ts`'s `toSearchParams`,
 *    `parseStoredProvenance` and `createProvenanceIndex`, which are pure.
 *
 * ## Why `node:sqlite`
 *
 * The product's connection is `Zotero.DBConnection`, which exists only inside
 * Zotero; `test/integration/zotero/provenanceStore.spec.ts` asserts against
 * that one. Node 22.13 — this repository's `engines` floor — ships SQLite
 * unflagged as `node:sqlite`, so the same SQL can be executed here at unit
 * speed without a dependency. The adapter below implements `db.ts`'s
 * {@link SqlConnection} port with the two Zotero 10.0.3 behaviours the code
 * relies on: `valueQueryAsync` resolves to `false` for no row, and
 * `executeTransaction` rolls back when its function throws.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  JOB_DDL,
  JOB_STATUS_INDEX_DDL,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  PROVENANCE_COLLECTION_INDEX_DDL,
  SCHEMA_VERSION_DDL,
  SEARCH_PROVENANCE_DDL,
  runMigrations,
} from "../../../src/bootstrap/migrations";
import {
  createProvenanceIndex,
  parseStoredProvenance,
  RERUN_ALL_YEARS,
  serializeProvenance,
  toSearchParams,
  type ProvenanceStore,
  type SearchProvenance,
  type SourceProvenance,
} from "../../../src/core/provenance";
import {
  L10N_MENU_COLLECTION_RERUN,
  L10N_MENU_COLLECTION_SEARCH_IMPORT,
} from "../../../src/i18n/keys";
import type { SourceId } from "../../../src/model/ids";
import type { SearchWindowArgs } from "../../../src/ui/dialogs/searchDialog";
import {
  collectionMenuOptions,
  type SearchMenuCommands,
} from "../../../src/ui/menus/registerMenus";
import {
  createProvenanceStore,
  PLUGIN_DATABASE_FILE,
  PLUGIN_DATABASE_NAME,
  type SqlConnection,
  type SqlParam,
  type SqlQueryOptions,
} from "../../../src/zotero/db";

const here = fileURLToPath(import.meta.url);
const DOCS_07 = readFileSync(
  resolve(dirname(here), "../../../docs/07-architecture-and-data-model.md"),
  "utf8",
);

// ---------------------------------------------------------------------------
// 1. A real SQLite behind db.ts's port
// ---------------------------------------------------------------------------

interface RecordingConnection extends SqlConnection {
  readonly db: DatabaseSync;
  /** Every statement's options, in order — for the debug-log assertion. */
  readonly options: (SqlQueryOptions | undefined)[];
}

function sqlite(): RecordingConnection {
  const db = new DatabaseSync(":memory:");
  const options: (SqlQueryOptions | undefined)[] = [];
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    db,
    options,
    queryAsync(sql, params, opts) {
      options.push(opts);
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params, opts) {
      options.push(opts);
      const row = db.prepare(sql).get(...bind(params));
      // Zotero 10.0.3's `db.js`: `rows.length ? rows[0].getResultByIndex(0) : false`.
      return Promise.resolve(row === undefined ? false : Object.values(row)[0]);
    },
    async executeTransaction(func) {
      db.exec("BEGIN");
      try {
        const result = await func();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    closeDatabase() {
      db.close();
      return Promise.resolve();
    },
  };
}

async function migrated(): Promise<RecordingConnection> {
  const connection = sqlite();
  await runMigrations(connection);
  return connection;
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

function columns(db: DatabaseSync, table: string): ColumnInfo[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as ColumnInfo[];
}

/**
 * `node:sqlite` hands rows back as null-prototype objects, which
 * `toStrictEqual` tells apart from a literal; spread them into plain ones.
 */
function plain(row: unknown): Record<string, unknown> {
  return { ...(row as Record<string, unknown>) };
}

/** One statement's single row, as a plain object. */
function one(db: DatabaseSync, sql: string): Record<string, unknown> {
  return plain(db.prepare(sql).get());
}

function rows(db: DatabaseSync): Record<string, unknown>[] {
  return db
    .prepare("SELECT * FROM search_provenance ORDER BY rowid")
    .all()
    .map(plain);
}

// ---------------------------------------------------------------------------
// 2. Fixtures
// ---------------------------------------------------------------------------

function source(
  sourceId: SourceId,
  overrides: Partial<SourceProvenance> = {},
): SourceProvenance {
  return {
    sourceId,
    endpointBaseUrl: "",
    transmittedQuery: "term=crispr",
    transmittedUrl: "",
    dateFilterApplied: "server",
    requestedLimit: 50,
    rawHitCount: undefined,
    recordsRetrieved: 40,
    recordsDeduplicatedAway: 0,
    recordsImported: 40,
    error: undefined,
    sourceExtras: undefined,
    ...overrides,
  };
}

/**
 * A recorded run. The default window's lower bound, 2019-01-01, is **before**
 * `currentYear − 2` in any year this suite can run in, so a recomputation of
 * `docs/08` §4.2's calendar-year window would move it — which is what the
 * advance-to-today assertion is built to catch.
 */
function run(overrides: Partial<SearchProvenance> = {}): SearchProvenance {
  return {
    schemaVersion: 1,
    runId: "1760000000000-1",
    pluginVersion: "0.0.2-test",
    zoteroVersion: "10.0.3-test",
    startedAt: "2026-03-14T09:00:00.000Z",
    finishedAt: "2026-03-14T09:00:30.000Z",
    userQuery: "lipid nanoparticle CRISPR delivery",
    dateFilter: { fromIso: "2019-01-01", toIso: "2021-12-31" },
    targetLibraryId: 1,
    targetCollectionKey: "ABCD2345",
    perSource: [source("pubmed"), source("crossref")],
    totals: { retrieved: 80, deduplicatedAway: 40, imported: 40 },
    mergeDecisions: [],
    ...overrides,
  };
}

/** Wednesday 2026-10-15, 10:00 local time. */
const TODAY = new Date(2026, 9, 15, 10, 0, 0).getTime();

// ---------------------------------------------------------------------------
// 3. The schema — docs/07 §8.3, column for column
// ---------------------------------------------------------------------------

/** `docs/07` §8.3's statement that starts with `head`, up to its `;`. */
function docsStatement(head: string): string {
  const start = DOCS_07.indexOf(head);
  expect(start, `docs/07 carries "${head}"`).toBeGreaterThan(-1);
  const end = DOCS_07.indexOf(";", start);
  return DOCS_07.slice(start, end);
}

describe("P2-T17 — migrations.ts version 1 is docs/07 §8.3's DDL", () => {
  it("copies search_provenance column for column, byte for byte", () => {
    expect(SEARCH_PROVENANCE_DDL).toBe(
      docsStatement("CREATE TABLE search_provenance ("),
    );
  });

  it("copies idx_provenance_collection and the schema_version table", () => {
    expect(PROVENANCE_COLLECTION_INDEX_DDL).toBe(
      docsStatement("CREATE INDEX idx_provenance_collection"),
    );
    expect(SCHEMA_VERSION_DDL).toBe(
      docsStatement("CREATE TABLE schema_version"),
    );
  });

  // Moved with P3-T34, which appended version 2 (the `job` table; its own
  // byte-for-byte checks are in test/unit/core/jobQueue.test.ts).
  it("is version 1 of exactly those two statements, then P3-T34's job table as version 2", () => {
    expect(LATEST_SCHEMA_VERSION).toBe(2);
    expect(MIGRATIONS).toStrictEqual([
      {
        version: 1,
        statements: [SEARCH_PROVENANCE_DDL, PROVENANCE_COLLECTION_INDEX_DDL],
      },
      {
        version: 2,
        statements: [JOB_DDL, JOB_STATUS_INDEX_DDL],
      },
    ]);
  });

  it("brings a fresh file to schema_version 2 with §8.3's columns and index, read back", async () => {
    const connection = sqlite();
    expect(await runMigrations(connection)).toStrictEqual({ from: 0, to: 2 });
    const { db } = connection;

    expect(
      db.prepare("SELECT version FROM schema_version").all().map(plain),
    ).toStrictEqual([{ version: 2 }]);
    expect(
      columns(db, "search_provenance").map(({ name, type, notnull, pk }) => [
        name,
        type,
        notnull,
        pk,
      ]),
    ).toStrictEqual([
      ["run_id", "TEXT", 0, 1],
      ["library_id", "INTEGER", 1, 0],
      ["collection_key", "TEXT", 0, 0],
      ["note_key", "TEXT", 0, 0],
      ["json", "TEXT", 1, 0],
      ["started_at", "INTEGER", 1, 0],
      ["finished_at", "INTEGER", 1, 0],
    ]);
    expect(
      db
        .prepare("PRAGMA index_info(idx_provenance_collection)")
        .all()
        .map((row) => (row as { name: string }).name),
    ).toStrictEqual(["library_id", "collection_key"]);
    // The **Do NOT**: no table and no index §8.3 does not declare. SQLite's
    // own primary-key index is `sqlite_autoindex_*` and is not ours.
    expect(
      db
        .prepare(
          "SELECT type, name FROM sqlite_master " +
            "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .all()
        .map((row) => `${String(row.type)}:${String(row.name)}`),
    ).toStrictEqual([
      "index:idx_job_status",
      "index:idx_provenance_collection",
      "table:job",
      "table:schema_version",
      "table:search_provenance",
    ]);
  });

  it("is idempotent: a second run reads the version and changes nothing", async () => {
    const connection = await migrated();
    expect(await runMigrations(connection)).toStrictEqual({ from: 2, to: 2 });
    expect(
      one(connection.db, "SELECT COUNT(*) AS n FROM schema_version"),
    ).toStrictEqual({ n: 1 });
  });

  it("refuses a file a later plugin version wrote, and leaves it untouched", async () => {
    const connection = await migrated();
    connection.db.exec("UPDATE schema_version SET version = 7");
    await expect(runMigrations(connection)).rejects.toThrow(/newer/);
    expect(
      one(connection.db, "SELECT version FROM schema_version"),
    ).toStrictEqual({ version: 7 });
  });

  it("rolls a failed migration back, leaving the file at its old version", async () => {
    const connection = sqlite();
    await expect(
      runMigrations(connection, [
        { version: 1, statements: ["CREATE TABLE ok (a)", "NOT SQL"] },
      ]),
    ).rejects.toThrow();
    expect(
      one(
        connection.db,
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('ok', 'schema_version')",
      ),
    ).toStrictEqual({ n: 0 });
  });

  it("names the data-directory file docs/07 §8.2 resolves, never zotero.sqlite", () => {
    expect(PLUGIN_DATABASE_NAME).toBe("research-helper");
    expect(PLUGIN_DATABASE_FILE).toBe("research-helper.sqlite");
  });
});

// ---------------------------------------------------------------------------
// 4. The store — db.ts over a real SQLite
// ---------------------------------------------------------------------------

describe("P2-T17 — createProvenanceStore writes and reads search_provenance", () => {
  it("writes exactly one row carrying the note key, the export's bytes and both timestamps", async () => {
    const connection = await migrated();
    const store = createProvenanceStore(connection);
    const record = run();
    await store.putProvenance(record, 1, "ABCD2345", "NOTE7777");

    expect(rows(connection.db)).toStrictEqual([
      {
        run_id: record.runId,
        library_id: 1,
        collection_key: "ABCD2345",
        note_key: "NOTE7777",
        // The same bytes "Export provenance as JSON" writes (§8.3), which
        // `test/unit/core/provenance.test.ts` validates against
        // `schema/provenance.schema.json`.
        json: serializeProvenance(record),
        started_at: Date.parse(record.startedAt),
        finished_at: Date.parse(record.finishedAt),
      },
    ]);
  });

  it("stores NULL for a run with no collection and no note", async () => {
    const connection = await migrated();
    await createProvenanceStore(connection).putProvenance(
      run({ targetCollectionKey: undefined }),
      1,
      undefined,
      undefined,
    );
    const [row] = rows(connection.db);
    expect(row?.collection_key).toBeNull();
    expect(row?.note_key).toBeNull();
  });

  it("stores only what the redaction gate lets through", async () => {
    const connection = await migrated();
    // 48 characters: inside KEY_PATTERNS' catch-all, so the gate removes it.
    const key = "sk-" + "A1b2C3d4".repeat(6);
    await createProvenanceStore(connection).putProvenance(
      run({
        userQuery: `crispr ${key}`,
        perSource: [
          source("pubmed", {
            transmittedUrl: `https://eutils.ncbi.nlm.nih.gov/esearch.fcgi?term=crispr&api_key=${"0123456789abcdef".repeat(2)}`,
          }),
        ],
      }),
      1,
      "ABCD2345",
      undefined,
    );
    const json = String(rows(connection.db)[0]?.json);
    expect(json).not.toContain(key);
    expect(json).not.toContain("api_key");
  });

  it("keeps every bound value out of Zotero's debug log", async () => {
    const connection = await migrated();
    const store = createProvenanceStore(connection);
    connection.options.length = 0;
    await store.putProvenance(run(), 1, "ABCD2345", "NOTE7777");
    await store.findProvenanceByCollection(1, "ABCD2345");
    expect(connection.options).toStrictEqual([
      { debugParams: false },
      { debugParams: false },
    ]);
  });

  it("returns the run with the greatest finished_at of three, whatever order they were written in", async () => {
    const connection = await migrated();
    const store = createProvenanceStore(connection);
    const at = (day: number): string =>
      `2026-03-${String(day).padStart(2, "0")}T09:00:00.000Z`;
    for (const [runId, day] of [
      ["middle", 14],
      ["latest", 20],
      ["earliest", 2],
    ] as const) {
      await store.putProvenance(
        run({ runId, startedAt: at(day), finishedAt: at(day) }),
        1,
        "ABCD2345",
        undefined,
      );
    }
    expect((await store.findProvenanceByCollection(1, "ABCD2345"))?.runId).toBe(
      "latest",
    );
  });

  it("answers per collection and per library, and undefined where there is no row", async () => {
    const connection = await migrated();
    const store = createProvenanceStore(connection);
    await store.putProvenance(run(), 1, "ABCD2345", undefined);
    expect(await store.findProvenanceByCollection(1, "ZZZZ9999")).toBe(
      undefined,
    );
    expect(await store.findProvenanceByCollection(2, "ABCD2345")).toBe(
      undefined,
    );
    expect(await store.findProvenanceByCollection(1, "ABCD2345")).toStrictEqual(
      JSON.parse(serializeProvenance(run())),
    );
  });

  it("adds a re-run as a second row with its own runId and leaves the original untouched", async () => {
    const connection = await migrated();
    const store = createProvenanceStore(connection);
    await store.putProvenance(run(), 1, "ABCD2345", "NOTE0001");
    const [original] = rows(connection.db);

    const rerun = run({
      runId: "1760000099999-2",
      finishedAt: "2026-10-15T01:00:00.000Z",
    });
    await store.putProvenance(rerun, 1, "ABCD2345", "NOTE0002");

    const after = rows(connection.db);
    expect(after).toHaveLength(2);
    expect(after[0]).toStrictEqual(original);
    expect(after[1]?.run_id).toBe(rerun.runId);
    expect(after[1]?.run_id).not.toBe(original?.run_id);
  });

  it("refuses to overwrite: a second write of one runId throws and the row is unchanged", async () => {
    const connection = await migrated();
    const store = createProvenanceStore(connection);
    await store.putProvenance(run(), 1, "ABCD2345", "NOTE0001");
    const [original] = rows(connection.db);
    await expect(
      store.putProvenance(
        run({ userQuery: "something else" }),
        1,
        "ABCD2345",
        "NOTE0002",
      ),
    ).rejects.toThrow();
    expect(rows(connection.db)).toStrictEqual([original]);
  });

  it("refuses a record whose timestamp cannot be ordered", async () => {
    const connection = await migrated();
    await expect(
      createProvenanceStore(connection).putProvenance(
        run({ finishedAt: "not a date" }),
        1,
        "ABCD2345",
        undefined,
      ),
    ).rejects.toThrow(/finished_at/);
    expect(rows(connection.db)).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. toSearchParams — the re-hydration
// ---------------------------------------------------------------------------

describe("P2-T17 — toSearchParams", () => {
  it("returns the recorded parameters as recorded", () => {
    expect(
      toSearchParams(run(), { advanceDateWindow: false, now: TODAY }),
    ).toStrictEqual({
      userQuery: "lipid nanoparticle CRISPR delivery",
      sourceIds: ["pubmed", "crossref"],
      requestedLimit: 50,
      dateWindow: { fromIso: "2019-01-01", toIso: "2021-12-31" },
    });
  });

  it("advances only the upper bound to today, never recomputing docs/08 §4.2's window", () => {
    const params = toSearchParams(run(), {
      advanceDateWindow: true,
      now: TODAY,
    });
    // 2019 predates currentYear − 2 = 2024: a recomputed window would read
    // 2024-01-01 here.
    expect(params.dateWindow).toStrictEqual({
      fromIso: "2019-01-01",
      toIso: "2026-10-15",
    });
    expect(params.userQuery).toBe(run().userQuery);
    expect(params.sourceIds).toStrictEqual(["pubmed", "crossref"]);
    expect(params.requestedLimit).toBe(50);
  });

  it("reads today in the local calendar, as the window's year menulists do", () => {
    const lateEvening = new Date(2026, 11, 31, 23, 30, 0).getTime();
    expect(
      toSearchParams(run(), { advanceDateWindow: true, now: lateEvening })
        .dateWindow,
    ).toStrictEqual({ fromIso: "2019-01-01", toIso: "2026-12-31" });
  });

  it("never moves the upper bound backwards: a recorded end after today is kept (item 217)", () => {
    // Owner, 2026-10-16: the advanced upper bound is max(recorded, today).
    // The lower bound is also after today here, so a `max` wrongly applied to
    // it would leave it unchanged — the next test catches that instead.
    const future = run({
      dateFilter: { fromIso: "2026-11-01", toIso: "2027-06-30" },
    });
    expect(
      toSearchParams(future, { advanceDateWindow: true, now: TODAY })
        .dateWindow,
    ).toStrictEqual({ fromIso: "2026-11-01", toIso: "2027-06-30" });
    // A recorded end equal to today is today either way.
    const endsToday = run({
      dateFilter: { fromIso: "2019-01-01", toIso: "2026-10-15" },
    });
    expect(
      toSearchParams(endsToday, { advanceDateWindow: true, now: TODAY })
        .dateWindow,
    ).toStrictEqual({ fromIso: "2019-01-01", toIso: "2026-10-15" });
    // One day later than today still wins over today.
    const endsTomorrow = run({
      dateFilter: { fromIso: "2019-01-01", toIso: "2026-10-16" },
    });
    expect(
      toSearchParams(endsTomorrow, { advanceDateWindow: true, now: TODAY })
        .dateWindow,
    ).toStrictEqual({ fromIso: "2019-01-01", toIso: "2026-10-16" });
  });

  it("applies the max to the upper bound only: a lower bound before today stays where it was recorded", () => {
    // A `max(recorded, today)` applied to `fromIso` would read 2026-10-15
    // here; a recorded end before today still advances to today.
    const params = toSearchParams(
      run({ dateFilter: { fromIso: "2025-03-01", toIso: "2025-09-30" } }),
      { advanceDateWindow: true, now: TODAY },
    );
    expect(params.dateWindow).toStrictEqual({
      fromIso: "2025-03-01",
      toIso: "2026-10-15",
    });
    // "As recorded" never consults today at all.
    expect(
      toSearchParams(
        run({ dateFilter: { fromIso: "2026-11-01", toIso: "2027-06-30" } }),
        { advanceDateWindow: false, now: TODAY },
      ).dateWindow,
    ).toStrictEqual({ fromIso: "2026-11-01", toIso: "2027-06-30" });
  });

  it('re-hydrates dateFilter "none" as All years, with or without the advance', () => {
    for (const advanceDateWindow of [false, true]) {
      expect(
        toSearchParams(run({ dateFilter: "none" }), {
          advanceDateWindow,
          now: TODAY,
        }).dateWindow,
      ).toBe(RERUN_ALL_YEARS);
    }
    expect(RERUN_ALL_YEARS).toBe("all-years");
  });

  it("takes each source once, in the record's order", () => {
    expect(
      toSearchParams(
        run({
          perSource: [
            source("crossref"),
            source("pubmed"),
            source("crossref"),
            source("arxiv"),
          ],
        }),
        { advanceDateWindow: false, now: TODAY },
      ).sourceIds,
    ).toStrictEqual(["crossref", "pubmed", "arxiv"]);
  });

  it("takes the limit only when every source asked for the same one", () => {
    const params = (limits: readonly number[]): number | undefined =>
      toSearchParams(
        run({
          perSource: limits.map((requestedLimit) =>
            source("pubmed", { requestedLimit }),
          ),
        }),
        { advanceDateWindow: false, now: TODAY },
      ).requestedLimit;
    expect(params([100, 100, 100])).toBe(100);
    expect(params([100, 50])).toBeUndefined();
    expect(params([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. parseStoredProvenance and the synchronous index
// ---------------------------------------------------------------------------

describe("P2-T17 — parseStoredProvenance", () => {
  it("round-trips the export's bytes", () => {
    expect(parseStoredProvenance(serializeProvenance(run()))).toStrictEqual(
      JSON.parse(serializeProvenance(run())),
    );
  });

  it("refuses a row it cannot read rather than half-reading it", () => {
    const stored = JSON.parse(serializeProvenance(run())) as Record<
      string,
      unknown
    >;
    for (const broken of [
      "{",
      "null",
      JSON.stringify({ ...stored, schemaVersion: 2 }),
      JSON.stringify({ ...stored, userQuery: 7 }),
      JSON.stringify({ ...stored, perSource: "pubmed" }),
      JSON.stringify({ ...stored, dateFilter: { fromIso: "2019-01-01" } }),
      JSON.stringify({ ...stored, runId: undefined }),
    ]) {
      expect(parseStoredProvenance(broken), broken).toBeUndefined();
    }
    expect(
      parseStoredProvenance(JSON.stringify({ ...stored, dateFilter: "none" }))
        ?.dateFilter,
    ).toBe("none");
  });
});

describe("P2-T17 — createProvenanceIndex answers the menu synchronously", () => {
  function counting(found: SearchProvenance | undefined): ProvenanceStore & {
    reads: number;
    writes: number;
  } {
    const store = {
      reads: 0,
      writes: 0,
      putProvenance(): Promise<void> {
        store.writes += 1;
        return Promise.resolve();
      },
      findProvenanceByCollection(): Promise<SearchProvenance | undefined> {
        store.reads += 1;
        return Promise.resolve(found);
      },
    };
    return store;
  }

  it("knows nothing until asked, then caches the answer", async () => {
    const store = counting(run());
    const index = createProvenanceIndex(store);
    expect(index.known(1, "ABCD2345")).toBeUndefined();
    expect(await index.hasRun(1, "ABCD2345")).toBe(true);
    expect(index.known(1, "ABCD2345")).toBe(true);
    expect(index.known(1, "OTHER000")).toBeUndefined();
    expect(store.reads).toBe(1);
  });

  it("caches a no, and a write through it turns the no into a yes", async () => {
    const store = counting(undefined);
    const index = createProvenanceIndex(store);
    expect(await index.hasRun(1, "ABCD2345")).toBe(false);
    expect(index.known(1, "ABCD2345")).toBe(false);
    await index.putProvenance(run(), 1, "ABCD2345", "NOTE0001");
    expect(store.writes).toBe(1);
    expect(index.known(1, "ABCD2345")).toBe(true);
  });

  it("keeps a failed write from claiming a row", async () => {
    const store = counting(undefined);
    store.putProvenance = (): Promise<void> =>
      Promise.reject(new Error("disk full"));
    const index = createProvenanceIndex(store);
    await expect(
      index.putProvenance(run(), 1, "ABCD2345", undefined),
    ).rejects.toThrow("disk full");
    expect(index.known(1, "ABCD2345")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. The menu entry — hidden, not disabled (docs/08 §2.4, §2.5)
// ---------------------------------------------------------------------------

/** What one `onShowing` / `onCommand` did to its context. */
interface MenuProbe {
  visible: boolean[];
  enabled: boolean[];
  opened: SearchWindowArgs[];
  errors: string[];
}

type LibraryMenuData =
  _ZoteroTypes.MenuManager.MenuData<_ZoteroTypes.MenuManager.LibraryMenuContext>;

/** A main window whose collections pane selects `ids`, recording opens. */
function menuWindow(ids: { current: readonly number[] }, probe: MenuProbe) {
  return {
    ZoteroPane: {
      getSelectedCollections: () => ids.current.map((id) => ({ id })),
    },
    openDialog: (
      _url?: string,
      _name?: string,
      _features?: string,
      ...extra: unknown[]
    ) => {
      probe.opened.push(extra[0] as SearchWindowArgs);
      return { focus: () => undefined };
    },
  };
}

function menuContext(
  win: unknown,
  probe: MenuProbe,
): _ZoteroTypes.MenuManager.LibraryMenuContext {
  return {
    menuElem: {
      ownerDocument: { defaultView: win },
    } as unknown as XULElement,
    setL10nArgs: () => undefined,
    setEnabled: (enabled: boolean) => {
      probe.enabled.push(enabled);
    },
    setVisible: (visible: boolean) => {
      probe.visible.push(visible);
    },
    setIcon: () => undefined,
    tabType: "library",
    tabSubType: undefined,
    tabID: "zotero-pane",
  } as unknown as _ZoteroTypes.MenuManager.LibraryMenuContext;
}

/**
 * The collection submenu over a lookup whose answers are `answers` (keyed by
 * collection id; absent means the store holds no row), with every lookup
 * counted and each one resolved only when `release()` is called.
 */
function rerunMenu(answers: ReadonlyMap<number, boolean>) {
  const probe: MenuProbe = { visible: [], enabled: [], opened: [], errors: [] };
  const known = new Map<number, boolean>();
  const pending: (() => void)[] = [];
  let lookups = 0;
  const commands: SearchMenuCommands = {
    openSearchWindow: (host, args) => host.openDialog("u", "n", "f", args),
    onError: (message) => {
      probe.errors.push(message);
    },
    provenance: {
      hasRunForCollection: (id) => known.get(id),
      lookupRunForCollection: (id) => {
        lookups += 1;
        return new Promise<boolean>((resolve) => {
          pending.push(() => {
            const answer = answers.get(id) ?? false;
            known.set(id, answer);
            resolve(answer);
          });
        });
      },
    },
  };
  const [submenu] = collectionMenuOptions(commands).menus;
  const entries = (submenu?.menus ?? []) as LibraryMenuData[];
  const rerun = entries.find(
    (entry) => entry.l10nID === L10N_MENU_COLLECTION_RERUN,
  );
  if (!submenu || !rerun) throw new Error("no re-run entry registered");
  return {
    probe,
    submenu: submenu as LibraryMenuData,
    entries,
    rerun,
    lookups: () => lookups,
    async release(): Promise<void> {
      for (const settle of pending.splice(0)) settle();
      await flushMicrotasks();
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("P2-T17 — Re-run This Search… is hidden, not disabled, without a row", () => {
  it("sits in the collection submenu with docs/08 §10.2's id, after Search & Import, no separator", () => {
    const { entries } = rerunMenu(new Map());
    expect(
      entries.map((entry) => [entry.menuType, entry.l10nID]),
    ).toStrictEqual([
      ["menuitem", L10N_MENU_COLLECTION_SEARCH_IMPORT],
      ["menuitem", "research-helper-menu-collection-rerun"],
    ]);
  });

  it("hides the entry for a collection with no row — setVisible(false), never setEnabled", async () => {
    const menu = rerunMenu(new Map([[7, false]]));
    const win = menuWindow({ current: [7] }, menu.probe);
    menu.rerun.onShowing?.(
      new Event("popupshowing"),
      menuContext(win, menu.probe),
    );
    expect(menu.probe.visible).toStrictEqual([false]);
    await menu.release();
    expect(menu.probe.visible).toStrictEqual([false, false]);
    expect(menu.probe.enabled).toStrictEqual([]);

    // Known now: the next open answers synchronously and asks nothing.
    menu.rerun.onShowing?.(
      new Event("popupshowing"),
      menuContext(win, menu.probe),
    );
    expect(menu.probe.visible).toStrictEqual([false, false, false]);
    expect(menu.lookups()).toBe(1);
  });

  it("shows the entry for a collection that has a row, once the store has answered", async () => {
    const menu = rerunMenu(new Map([[7, true]]));
    const win = menuWindow({ current: [7] }, menu.probe);
    menu.rerun.onShowing?.(
      new Event("popupshowing"),
      menuContext(win, menu.probe),
    );
    await menu.release();
    expect(menu.probe.visible).toStrictEqual([false, true]);
    menu.rerun.onShowing?.(
      new Event("popupshowing"),
      menuContext(win, menu.probe),
    );
    expect(menu.probe.visible.at(-1)).toBe(true);
    expect(menu.probe.enabled).toStrictEqual([]);
  });

  it("primes the lookup from the submenu's own onShowing, so the entry is ready when it opens", async () => {
    const menu = rerunMenu(new Map([[7, true]]));
    const win = menuWindow({ current: [7] }, menu.probe);
    menu.submenu.onShowing?.(
      new Event("popupshowing"),
      menuContext(win, menu.probe),
    );
    expect(menu.lookups()).toBe(1);
    await menu.release();
    menu.probe.visible.length = 0;
    menu.rerun.onShowing?.(
      new Event("popupshowing"),
      menuContext(win, menu.probe),
    );
    expect(menu.probe.visible).toStrictEqual([true]);
    expect(menu.lookups()).toBe(1);
  });

  it("never applies a late answer for collection A after the selection moved to B", async () => {
    const menu = rerunMenu(new Map([[7, true]]));
    const selection = { current: [7] as readonly number[] };
    const win = menuWindow(selection, menu.probe);
    menu.rerun.onShowing?.(
      new Event("popupshowing"),
      menuContext(win, menu.probe),
    );
    selection.current = [8];
    await menu.release();
    expect(menu.probe.visible).toStrictEqual([false]);
  });

  it("stays hidden with no store, and with a selection that is not exactly one collection", () => {
    const menu = rerunMenu(new Map([[7, true]]));
    for (const ids of [[], [7, 8]]) {
      const win = menuWindow({ current: ids }, menu.probe);
      menu.rerun.onShowing?.(
        new Event("popupshowing"),
        menuContext(win, menu.probe),
      );
    }
    expect(menu.probe.visible).toStrictEqual([false, false]);
    expect(menu.lookups()).toBe(0);

    const bare = collectionMenuOptions({
      openSearchWindow: () => undefined,
      onError: () => undefined,
    }).menus[0]?.menus?.find(
      (entry) => entry.l10nID === L10N_MENU_COLLECTION_RERUN,
    );
    const probe: MenuProbe = {
      visible: [],
      enabled: [],
      opened: [],
      errors: [],
    };
    bare?.onShowing?.(
      new Event("popupshowing"),
      menuContext(menuWindow({ current: [7] }, probe), probe),
    );
    expect(probe.visible).toStrictEqual([false]);
  });

  it('opens the window with mode: "rerun" and the collection\'s id (docs/08 §2.4)', () => {
    const menu = rerunMenu(new Map([[7, true]]));
    const win = menuWindow({ current: [4242] }, menu.probe);
    menu.rerun.onCommand?.(new Event("command"), menuContext(win, menu.probe));
    expect(menu.probe.opened).toStrictEqual([
      { mode: "rerun", collectionID: 4242 },
    ]);
    expect(menu.probe.errors).toStrictEqual([]);
  });
});
