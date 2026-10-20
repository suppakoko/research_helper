/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P2-T17` — FR-12's re-run, against a real Zotero, a real plugin database
 * and a real library.
 *
 * ## What is real here
 *
 * The plugin database `src/bootstrap/registerUI.ts` opened at startup —
 * `<Zotero.DataDirectory.dir>/research-helper.sqlite` through
 * `Zotero.DBConnection` — and its schema as `src/bootstrap/migrations.ts`
 * left it; the composition root's store and index over it, read off
 * `addon.api.provenance`; the view model's dependencies as the composition root
 * bound them (`addon.api.searchWindowDeps`), including the **real** note writer
 * and the **real** `searchImport` pipeline for every write; the importer and
 * `P1-T13`'s DOI detector writing into the real user library; the real
 * collection context menu, built by `Zotero.MenuManager` and opened on a real
 * selection; and the real search window.
 *
 * ## What is a double, and why
 *
 * Only the **search half**: a run that is not an import (no `records` on its
 * input) returns forty fixture records instead of asking a source. No HTTP
 * request is made by this spec. The write half — the half FR-12's "already
 * present" is about — is the shipped pipeline end to end.
 *
 * ## The plugin database is read through the plugin's own connection
 *
 * Zotero opens a named `DBConnection` with `PRAGMA locking_mode=EXCLUSIVE`
 * (read out of Zotero 10.0.3's `db.js`), so a second connection from this spec
 * would be refused. The connection is read off `addon.api.provenance` instead.
 * Zotero's own `zotero.sqlite` is never opened or written by this spec.
 *
 * Zotero's `parseQueryAndParams` refuses a `LIKE` with a literal pattern
 * ("Please enter a LIKE clause with bindings", measured 2026-10-15), so the
 * schema read below filters SQLite's own objects with `substr` instead.
 *
 * ## Cleanup
 *
 * Every collection this spec creates is erased with its items and notes in
 * `after()`, and every `search_provenance` row it caused is deleted again —
 * test hygiene only: the plugin itself never deletes a row (§5.3, "written
 * once").
 */

import { config } from "../../../package.json";
import schema from "../../../schema/provenance.schema.json";
import type Addon from "../../../src/addon";
import { JOB_COLUMNS } from "../../../src/core/jobQueue/jobRecord";
import {
  serializeProvenance,
  type SearchProvenance,
} from "../../../src/core/provenance";
import {
  L10N_MENU_COLLECTION_RERUN,
  L10N_MENU_ROOT,
} from "../../../src/i18n/keys";
import { normalizeDoi, type Doi } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import type {
  SearchImportInput,
  SearchImportOutput,
} from "../../../src/pipeline/searchImport/types";
import type { Pipeline, PipelineContext } from "../../../src/pipeline/types";
import {
  NEW_COLLECTION_VALUE,
  openSearchWindow,
  type SearchWindowQuery,
} from "../../../src/ui/dialogs/searchDialog";
import {
  createSearchImportViewModel,
  type SearchImportViewModel,
} from "../../../src/ui/viewModels/searchImportViewModel";
import { PLUGIN_DATABASE_FILE } from "../../../src/zotero/db";

/** The slice of Mocha's test context this file uses. */
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function before(body: (this: MochaContext) => Promise<void>): void;
declare function after(body: (this: MochaContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isDefined(value: unknown, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const TEST_TIMEOUT_MS = 120_000;
/** Forty, as `P2-T17`'s "already present: 40" criterion counts them. */
const RECORD_COUNT = 40;
/** This run's tag: collection names, DOIs and row keys all carry it. */
const TAG = `p2t17-${String(Date.now())}`;
const COLLECTION_NAME = `RH P2-T17 re-run ${TAG}`;
const KEYWORD = "lipid nanoparticle CRISPR delivery";

function log(line: string): void {
  debug(`[P2-T17] ${line}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what}`,
      );
    }
    await delay(50);
  }
}

function pluginInstance(): Addon | undefined {
  return (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
}

async function plugin(): Promise<Addon> {
  await waitUntil(
    () => pluginInstance()?.data.initialized === true,
    `Zotero.${config.addonInstance}.data.initialized`,
  );
  const instance = pluginInstance();
  if (!instance) assert.fail("the plugin instance is gone");
  return instance;
}

/** The store the composition root opened — awaited, since the open is backgrounded. */
async function provenance(): Promise<NonNullable<Addon["api"]["provenance"]>> {
  const instance = await plugin();
  await waitUntil(
    () => instance.api.provenance !== undefined,
    "api.provenance (the plugin database to open)",
  );
  const found = instance.api.provenance;
  if (!found) assert.fail("api.provenance vanished");
  return found;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function doiOrThrow(raw: string): Doi {
  const doi = normalizeDoi(raw);
  if (doi === null) throw new Error(`fixture DOI must normalize: ${raw}`);
  return doi;
}

/** Forty journal articles, each with its own DOI under this run's tag. */
function fixtureRecords(): SourceRecord[] {
  return Array.from({ length: RECORD_COUNT }, (_, at) => ({
    id: `pubmed:${TAG}-${String(at)}`,
    sourceId: "pubmed" as const,
    nativeId: `${TAG}-${String(at)}`,
    work: {
      ids: { doi: doiOrThrow(`10.5555/${TAG}.${String(at)}`) },
      type: "journal-article" as const,
      title: `P2-T17 re-run fixture ${String(at)}`,
      authors: [{ family: "Kim", given: "Jisoo" }],
      publishedDate: { year: 2020, iso: "2020" },
    },
    retrievedAtEpochMs: Date.now(),
    missingFields: [],
  }));
}

/** What the search half answers: forty records from one source, asked for forty. */
function searchOutput(records: readonly SourceRecord[]): SearchImportOutput {
  return {
    outcome: "succeeded",
    stageReached: "fetching",
    records,
    works: [],
    flags: [],
    links: [],
    mergeDecisions: [],
    perSource: [
      {
        sourceId: "pubmed",
        transmittedQuery: "term=lipid+nanoparticle",
        requestedLimit: RECORD_COUNT,
        dateFilterApplied: "server",
        recordsRetrieved: records.length,
        droppedOutOfWindow: 0,
        keptWithoutDate: 0,
        recordsDeduplicatedAway: 0,
        error: undefined,
        warnings: [],
      },
    ],
    write: undefined,
    error: undefined,
    warnings: [],
    cancellationKind: undefined,
  };
}

/**
 * The composition root's view model dependencies, with the search half
 * doubled: an import (records supplied) runs the shipped pipeline; anything
 * else answers {@link searchOutput} without asking a source.
 */
async function viewModel(
  records: readonly SourceRecord[],
): Promise<SearchImportViewModel> {
  const instance = await plugin();
  const deps = instance.api.searchWindowDeps;
  if (!deps) assert.fail("api.searchWindowDeps is not published");
  const real = deps.pipeline;
  const pipeline: Pipeline<SearchImportInput, SearchImportOutput> = {
    ...real,
    run: (input: SearchImportInput, context: PipelineContext) =>
      input.records === undefined
        ? Promise.resolve(searchOutput(records))
        : real.run(input, context),
  };
  return createSearchImportViewModel({ ...deps, pipeline });
}

function query(overrides: Partial<SearchWindowQuery> = {}): SearchWindowQuery {
  return {
    mode: "keyword",
    keyword: KEYWORD,
    fromYear: 2019,
    toYear: 2021,
    maxResults: RECORD_COUNT,
    sources: ["pubmed"],
    filter: "",
    hideExisting: false,
    duplicates: "link",
    collectionID: `${NEW_COLLECTION_VALUE}:${COLLECTION_NAME}`,
    ...overrides,
  };
}

async function searchThenImport(
  model: SearchImportViewModel,
  overrides: Partial<SearchWindowQuery> = {},
): Promise<void> {
  await model.runSearch(query(overrides));
  await model.runImport({
    ...query(overrides),
    records: model.state.records ?? [],
  });
}

// ---------------------------------------------------------------------------
// Reading the plugin database
// ---------------------------------------------------------------------------

/** `search_provenance` rows for one collection, oldest first. */
interface Row {
  readonly run_id: string;
  readonly library_id: number;
  readonly collection_key: string | null;
  readonly note_key: string | null;
  readonly json: string;
  readonly started_at: number;
  readonly finished_at: number;
}

async function rowsFor(collectionKey: string): Promise<Row[]> {
  const { database } = await provenance();
  const rows = (await database.queryAsync(
    "SELECT run_id, library_id, collection_key, note_key, json, started_at, " +
      "finished_at FROM search_provenance WHERE library_id = ? AND " +
      "collection_key = ? ORDER BY rowid",
    [Zotero.Libraries.userLibraryID, collectionKey],
  )) as Record<string, unknown>[];
  // Zotero's rows are proxies over mozIStorageRow; copy the seven columns out.
  return rows.map((row) => ({
    run_id: String(row["run_id"]),
    library_id: Number(row["library_id"]),
    collection_key: row["collection_key"] as string | null,
    note_key: row["note_key"] as string | null,
    json: String(row["json"]),
    started_at: Number(row["started_at"]),
    finished_at: Number(row["finished_at"]),
  }));
}

/**
 * The stored JSON against `schema/provenance.schema.json`'s structural rules:
 * every `required` member present, nothing outside `properties`
 * (`additionalProperties: false`), the `schemaVersion` constant, and the same
 * two rules for every `perSource` entry against `$defs.SourceProvenance`. The
 * full draft-2020-12 validation of the same bytes is
 * `test/unit/core/provenance.test.ts`'s — the column holds exactly
 * `serializeProvenance`'s output, asserted below.
 */
function schemaViolations(record: Record<string, unknown>): string[] {
  const violations: string[] = [];
  const check = (
    value: Record<string, unknown>,
    node: { required?: readonly string[]; properties?: object },
    path: string,
  ): void => {
    for (const name of node.required ?? []) {
      if (!(name in value)) violations.push(`${path}.${name} missing`);
    }
    const declared = Object.keys(node.properties ?? {});
    for (const name of Object.keys(value)) {
      if (!declared.includes(name)) violations.push(`${path}.${name} extra`);
    }
  };
  check(record, schema, "$");
  if (record["schemaVersion"] !== 1) violations.push("$.schemaVersion");
  const sourceSchema = schema.$defs.SourceProvenance;
  const perSource = record["perSource"];
  if (!Array.isArray(perSource)) {
    violations.push("$.perSource not an array");
  } else {
    perSource.forEach((entry: Record<string, unknown>, at) => {
      check(entry, sourceSchema, `$.perSource[${String(at)}]`);
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The real collection context menu
// ---------------------------------------------------------------------------

interface CollectionTree {
  selectCollection(id: number): Promise<unknown>;
}

/**
 * Open the real collection context menu on `collectionID` and report the
 * re-run entry's `hidden` and `disabled`, after giving the store's answer
 * time to arrive.
 *
 * The open is `test/integration/menus.spec.ts`'s `readMenu`: build through
 * `Zotero.MenuManager.updateMenuPopup`, then the context menu's own
 * `popupshowing` (the submenu's `onShowing`, which primes the lookup), then the
 * submenu popup's `popupshowing`, which builds the entries and runs theirs.
 */
async function rerunEntry(
  collectionID: number,
): Promise<{ hidden: boolean; disabled: boolean; present: boolean }> {
  const win = Zotero.getMainWindow();
  const tree = (
    win.ZoteroPane as unknown as { collectionsView: CollectionTree }
  ).collectionsView;
  await tree.selectCollection(collectionID);
  const popup = win.document.getElementById(
    "zotero-collectionmenu",
  ) as XULPopupElement | null;
  if (!popup) assert.fail("#zotero-collectionmenu not found");
  Zotero.MenuManager.updateMenuPopup(popup, "main/library/collection", {
    tabType: "library",
    tabID: "zotero-pane",
  });
  const root = Array.from(popup.children).find(
    (el) =>
      el.classList.contains("zotero-custom-menu-item") &&
      el.getAttribute("data-l10n-id") === L10N_MENU_ROOT,
  );
  const submenu = root?.querySelector(":scope > menupopup") ?? undefined;
  popup.dispatchEvent(new win.Event("popupshowing"));
  // One indexed read of the plugin database; generous, because the suite is
  // load-sensitive.
  await delay(400);
  submenu?.dispatchEvent(new win.Event("popupshowing"));
  await delay(400);
  const entry = submenu
    ? Array.from(submenu.children).find(
        (el) => el.getAttribute("data-l10n-id") === L10N_MENU_COLLECTION_RERUN,
      )
    : undefined;
  const state = {
    present: entry !== undefined,
    hidden: entry ? (entry as unknown as { hidden: boolean }).hidden : true,
    disabled: entry
      ? (entry as unknown as { disabled: boolean }).disabled === true
      : false,
  };
  submenu?.dispatchEvent(new win.Event("popuphidden"));
  popup.dispatchEvent(new win.Event("popuphidden"));
  await new Promise<void>((resolve) => {
    win.requestIdleCallback(() => resolve());
  });
  return state;
}

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

describe("P2-T17: re-run a search from its stored provenance record", () => {
  /** Collection keys this spec created, erased in `after()`. */
  const createdKeys: string[] = [];
  const records = fixtureRecords();
  let model: SearchImportViewModel | undefined;
  let imported: Zotero.Collection | undefined;
  let originalRow: Row | undefined;

  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await provenance();
    model = await viewModel(records);
  });

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    let items = 0;
    for (const key of createdKeys) {
      try {
        const found = Zotero.Collections.getByLibraryAndKey(
          Zotero.Libraries.userLibraryID,
          key,
        );
        if (!found) continue;
        const childIDs = found.getChildItems(true) as number[];
        if (childIDs.length > 0) await Zotero.Items.erase(childIDs);
        items += childIDs.length;
        await found.eraseTx();
      } catch {
        /* cleanup is best effort */
      }
    }
    try {
      const { database } = await provenance();
      for (const key of [...createdKeys, `${TAG}-three`]) {
        await database.queryAsync(
          "DELETE FROM search_provenance WHERE collection_key = ?",
          [key],
        );
      }
    } catch {
      /* cleanup is best effort */
    }
    log(
      `cleanup erased ${String(items)} item(s) in ${String(createdKeys.length)} collection(s)`,
    );
  });

  // Moved to schema_version 2 by P3-T34, which appended docs/07 §8.3's `job`
  // table and `idx_job_status` as migration version 2, and to 3 by P3-T33,
  // which appended `cache_entry` and its two indexes as version 3.
  it("creates research-helper.sqlite under Zotero.DataDirectory.dir at schema_version 3, with docs/07 §8.3's tables and indexes", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const store = await provenance();
    const expected = PathUtils.join(
      Zotero.DataDirectory.dir,
      PLUGIN_DATABASE_FILE,
    );
    log(`plugin database ${store.path}`);
    assert.strictEqual(store.path, expected, "the data directory, by name");
    assert.notStrictEqual(
      PathUtils.filename(store.path),
      "zotero.sqlite",
      "never Zotero's own database",
    );
    assert.isTrue(await IOUtils.exists(store.path), "the file exists");
    assert.strictEqual(store.schemaVersion, 3);

    const { database } = store;
    assert.strictEqual(
      Number(
        await database.valueQueryAsync(
          "SELECT MAX(version) FROM schema_version",
        ),
      ),
      3,
      "schema_version reads 3",
    );
    assert.strictEqual(
      Number(
        await database.valueQueryAsync("SELECT COUNT(*) FROM schema_version"),
      ),
      1,
      "one bookkeeping row",
    );
    const columns = (await database.queryAsync(
      "SELECT name, type, \"notnull\" AS nn, pk FROM pragma_table_info('search_provenance') ORDER BY cid",
    )) as Record<string, unknown>[];
    assert.deepEqual(
      columns.map((row) => [
        String(row["name"]),
        String(row["type"]),
        Number(row["nn"]),
        Number(row["pk"]),
      ]),
      [
        ["run_id", "TEXT", 0, 1],
        ["library_id", "INTEGER", 1, 0],
        ["collection_key", "TEXT", 0, 0],
        ["note_key", "TEXT", 0, 0],
        ["json", "TEXT", 1, 0],
        ["started_at", "INTEGER", 1, 0],
        ["finished_at", "INTEGER", 1, 0],
      ],
      "docs/07 §8.3's columns, read back",
    );
    const indexed = (await database.queryAsync(
      "SELECT name FROM pragma_index_info('idx_provenance_collection') ORDER BY seqno",
    )) as Record<string, unknown>[];
    assert.deepEqual(
      indexed.map((row) => String(row["name"])),
      ["library_id", "collection_key"],
      "idx_provenance_collection, read back",
    );
    const objects = (await database.queryAsync(
      "SELECT type, name FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name",
    )) as Record<string, unknown>[];
    assert.deepEqual(
      objects.map((row) => `${String(row["type"])}:${String(row["name"])}`),
      [
        "index:idx_cache_expiry",
        "index:idx_cache_lru",
        "index:idx_job_status",
        "index:idx_provenance_collection",
        "table:cache_entry",
        "table:job",
        "table:schema_version",
        "table:search_provenance",
      ],
      "no table or index docs/07 §8.3 does not declare",
    );
    // P3-T34: the job table's columns, in the order `JobRow` writes them.
    const jobColumns = (await database.queryAsync(
      "SELECT name FROM pragma_table_info('job') ORDER BY cid",
    )) as Record<string, unknown>[];
    assert.deepEqual(
      jobColumns.map((row) => String(row["name"])),
      [...JOB_COLUMNS],
      "docs/07 §8.3's job columns, read back",
    );
    // P3-T33: cache_entry's columns, in docs/07 §8.3's order.
    const cacheColumns = (await database.queryAsync(
      "SELECT name FROM pragma_table_info('cache_entry') ORDER BY cid",
    )) as Record<string, unknown>[];
    assert.deepEqual(
      cacheColumns.map((row) => String(row["name"])),
      [
        "namespace",
        "key",
        "value",
        "blob_path",
        "size_bytes",
        "tags",
        "created_at",
        "expires_at",
        "last_access",
        "hits",
      ],
      "docs/07 §8.3's cache_entry columns, read back",
    );
  });

  // P3-T33 (plan/00 §6 item 249): the database installServices opened is the
  // one the cache writes through — measured here inside Zotero 10.0.3: the
  // `ON CONFLICT … DO UPDATE` upsert, the `instr` tag match, and a value over
  // 256 KB spilled through IOUtils to <data dir>/research-helper/cache/blobs.
  it("round-trips the service graph's cache on the same connection, spilling a value over 256 KB to a blob file", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { database } = await provenance();
    const graph = (await plugin()).api.services;
    if (!graph) assert.fail("no ServiceGraph is published at api.services");
    const open = await graph.database.ready;
    if (!open) assert.fail("the graph has no open database");
    assert.strictEqual(open.connection, database, "one connection, shared");
    assert.isTrue(graph.jobs.attached, "the job store is attached");

    const cache = graph.cache;
    const small = { tag: TAG, n: 1 };
    const large = { tag: TAG, text: "x".repeat(300 * 1024) };
    const tag = `work:${TAG}`;
    try {
      await cache.set("report", `${TAG}-small`, small, { tags: [tag] });
      await cache.set(
        "report",
        `${TAG}-small`,
        { ...small, n: 2 },
        { tags: [tag] },
      );
      await cache.set("report", `${TAG}-large`, large, { tags: [tag] });
      assert.deepEqual(
        await cache.get("report", `${TAG}-small`),
        { ...small, n: 2 },
        "the upsert replaced the row",
      );
      assert.deepEqual(
        await cache.get("report", `${TAG}-large`),
        large,
        "the spilled value reads back identical",
      );
      const blobPath = await database.valueQueryAsync(
        "SELECT blob_path FROM cache_entry WHERE namespace = ? AND key = ?",
        ["report", `${TAG}-large`],
      );
      if (typeof blobPath !== "string") assert.fail("no blob_path on the row");
      const file = PathUtils.join(
        Zotero.DataDirectory.dir,
        "research-helper",
        ...blobPath.split("/"),
      );
      log(`cache blob ${file}`);
      assert.isTrue(await IOUtils.exists(file), "the blob file exists");
      assert.strictEqual(
        Number(
          await database.valueQueryAsync(
            "SELECT COUNT(*) FROM cache_entry WHERE namespace = ? AND key = ?",
            ["report", `${TAG}-small`],
          ),
        ),
        1,
        "one row after two writes",
      );
      assert.strictEqual(
        await cache.invalidateByTag(tag),
        2,
        "both entries invalidated by their tag",
      );
      assert.isFalse(await IOUtils.exists(file), "the blob file is removed");
      assert.strictEqual(
        await cache.get("report", `${TAG}-small`),
        undefined,
        "a miss after invalidation",
      );
    } finally {
      await cache.invalidateByTag(tag).catch(() => 0);
    }
  });

  it("writes exactly one row for a completed run, after its note, whose json is the export's and passes the schema", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (!model) assert.fail("no view model");
    await searchThenImport(model);
    const collection = Zotero.Collections.getByLibrary(
      Zotero.Libraries.userLibraryID,
    ).find((found) => found.name === COLLECTION_NAME);
    if (!collection) assert.fail("the import created no collection");
    imported = collection;
    createdKeys.push(collection.key);
    log(
      `imported into ${collection.key}: ${JSON.stringify(model.state.status)}`,
    );

    const rows = await rowsFor(collection.key);
    assert.strictEqual(rows.length, 1, "exactly one search_provenance row");
    const [row] = rows;
    if (!row) assert.fail("no row");
    originalRow = row;

    // The note was written first, and its key is on the row.
    assert.isTrue(row.note_key !== null, "the row carries the note's key");
    const note = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      String(row.note_key),
    );
    if (!note) assert.fail("the row's note_key names no item");
    assert.isTrue(note.isNote(), "the key is the FR-8 note's");
    assert.isTrue(
      note.getCollections().includes(collection.id),
      "the note is in the run's collection",
    );

    const stored = JSON.parse(row.json) as Record<string, unknown>;
    assert.deepEqual(
      schemaViolations(stored),
      [],
      "the json passes the schema",
    );
    assert.strictEqual(
      row.json,
      serializeProvenance(stored as unknown as SearchProvenance),
      "the column holds serializeProvenance's bytes — the export's",
    );
    assert.strictEqual(row.run_id, stored["runId"]);
    assert.strictEqual(
      row.finished_at,
      Date.parse(String(stored["finishedAt"])),
    );
    const perSource = stored["perSource"] as Record<string, unknown>[];
    assert.deepEqual(
      perSource.map((entry) => [entry["sourceId"], entry["requestedLimit"]]),
      [["pubmed", RECORD_COUNT]],
      "the search's sources reach the import's record",
    );
  });

  it("returns the run with the greatest finished_at among three for one collection", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { index } = await provenance();
    if (!originalRow) assert.fail("no stored record to copy");
    const base = JSON.parse(originalRow.json) as SearchProvenance;
    const key = `${TAG}-three`;
    for (const [runId, day] of [
      [`${TAG}-middle`, 14],
      [`${TAG}-latest`, 20],
      [`${TAG}-earliest`, 2],
    ] as const) {
      const at = `2026-03-${String(day).padStart(2, "0")}T09:00:00.000Z`;
      await index.putProvenance(
        { ...base, runId, startedAt: at, finishedAt: at },
        Zotero.Libraries.userLibraryID,
        key,
        undefined,
      );
    }
    const found = await index.findProvenanceByCollection(
      Zotero.Libraries.userLibraryID,
      key,
    );
    assert.strictEqual(found?.runId, `${TAG}-latest`);
  });

  it("shows no Re-run entry on a collection with no row, and shows it — enabled — on one with a row", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (!imported) assert.fail("the import test did not run");
    const handBuilt = new Zotero.Collection({
      libraryID: Zotero.Libraries.userLibraryID,
      name: `RH P2-T17 hand-built ${TAG}`,
    });
    await handBuilt.saveTx();
    createdKeys.push(handBuilt.key);

    const without = await rerunEntry(handBuilt.id);
    log(`hand-built collection: ${JSON.stringify(without)}`);
    assert.isTrue(without.present, "the entry is registered in the submenu");
    assert.isTrue(without.hidden, "absent from view, not merely disabled");

    const withRow = await rerunEntry(imported.id);
    log(`searched collection: ${JSON.stringify(withRow)}`);
    assert.isFalse(withRow.hidden, "the entry is shown");
    assert.isFalse(withRow.disabled, "and is not disabled");
  });

  it("re-runs into the collection: 0 imported, already present 40, a second row with a new runId, the original untouched", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (!model || !imported || !originalRow) {
      assert.fail("the import test did not run");
    }
    const seed = await model.loadRerun(imported.id);
    if (!seed) assert.fail("no seed for a collection with a row");
    assert.strictEqual(seed.asRecorded.userQuery, KEYWORD);
    assert.deepEqual([...seed.asRecorded.sourceIds], ["pubmed"]);
    assert.strictEqual(seed.asRecorded.requestedLimit, RECORD_COUNT);
    assert.deepEqual(seed.asRecorded.dateWindow, {
      fromIso: "2019-01-01",
      toIso: "2021-12-31",
    });

    await searchThenImport(model, {
      mode: "rerun",
      collectionID: String(imported.id),
      dateWindow: seed.asRecorded.dateWindow,
    });
    log(`re-run summary ${JSON.stringify(model.state.status)}`);
    assert.deepEqual(model.state.status, {
      id: "research-helper-search-import-summary-rerun",
      args: { imported: 0, present: RECORD_COUNT, failed: 0 },
    });
    const regular = (imported.getChildItems(false) as Zotero.Item[]).filter(
      (item) => item.isRegularItem(),
    );
    assert.strictEqual(regular.length, RECORD_COUNT, "nothing duplicated");

    const rows = await rowsFor(imported.key);
    assert.strictEqual(rows.length, 2, "a second row");
    assert.deepEqual(rows[0], originalRow, "the original row is untouched");
    assert.notStrictEqual(rows[1]?.run_id, originalRow.run_id, "a new runId");
    const latest = await (
      await provenance()
    ).index.findProvenanceByCollection(
      Zotero.Libraries.userLibraryID,
      imported.key,
    );
    assert.strictEqual(
      latest?.runId,
      rows[1]?.run_id,
      "the re-run is now the latest",
    );
  });

  it("opens one window when invoked twice, pre-filled from the row", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (!imported) assert.fail("the import test did not run");
    const main = Zotero.getMainWindow();
    const args = { mode: "rerun" as const, collectionID: imported.id };
    const first = openSearchWindow(main, args);
    const second = openSearchWindow(main, args);
    const win = second as unknown as Window & {
      RHSearchWindow?: {
        state: { initialized?: boolean; rerun?: unknown };
      };
    };
    try {
      assert.strictEqual(first, second, "the window name makes it one window");
      await waitUntil(
        () =>
          win.document.readyState === "complete" &&
          win.RHSearchWindow?.state.rerun !== null &&
          win.RHSearchWindow?.state.rerun !== undefined,
        "the window to load and seed itself",
        30_000,
      );
      const doc = win.document;
      assert.strictEqual(
        doc.getElementById("rh-search-mode")?.getAttribute("data-l10n-id"),
        "research-helper-search-mode-rerun",
        "the Re-run chip",
      );
      assert.isFalse(
        (doc.getElementById("rh-state-rerun") as unknown as { hidden: boolean })
          .hidden,
        "the §4.6 banner is the panel shown",
      );
      assert.strictEqual(
        (doc.getElementById("rh-rerun-dates") as unknown as { value: string })
          .value,
        "recorded",
        "as recorded is selected",
      );
      assert.strictEqual(
        (
          doc.getElementById("rh-search-keyword") as unknown as {
            value: string;
          }
        ).value,
        KEYWORD,
        "the keyword is the recorded one",
      );
    } finally {
      (second as unknown as { close?: () => void }).close?.();
      await delay(300);
    }
  });
});
