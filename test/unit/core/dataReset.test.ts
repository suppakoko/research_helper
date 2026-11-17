/**
 * `P7-T10`: the preferences pane's clear actions and "Delete all plugin data",
 * on a real SQLite (`node:sqlite`) migrated by the plugin's own migrations,
 * with the real `SqliteCache` over it.
 *
 * Caller: `createPreferencesHost` (`src/ui/prefs/preferencesPane.ts`) through
 * `preferencesDataResetPort`, and `uninstallPluginData`, both in
 * `src/bootstrap/registerUI.ts`.
 */

import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import {
  CACHE_BLOB_THRESHOLD_BYTES,
  CACHE_NAMESPACES,
} from "../../../src/core/cache/cache";
import {
  createSqliteCache,
  type CacheBlobStore,
  type SqliteCache,
} from "../../../src/core/cache/sqliteCache";
import { createManualClock } from "../../../src/core/clock";
import {
  DATA_KINDS,
  ENDED_JOB_STATUSES,
  PLUGIN_TABLES,
  RESPONSE_NAMESPACES,
  clearCachedResponses,
  clearData,
  clearEmbeddings,
  clearJobHistory,
  clearStoredSummaries,
  countData,
  deleteAllPluginData,
  isKeptOnReset,
  reportAudioKeys,
  resetPreferences,
  type DataResetPorts,
} from "../../../src/core/dataReset";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import { PREFS } from "../../../src/prefs/schema";
import type { SqlConnection, SqlParam } from "../../../src/zotero/db";

interface Connection extends SqlConnection {
  readonly db: DatabaseSync;
}

function sqlite(): Connection {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    db,
    queryAsync(sql, params) {
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params) {
      const row = db.prepare(sql).get(...bind(params));
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

function memoryBlobs(): CacheBlobStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    write(name, text) {
      files.set(name, text);
      return Promise.resolve();
    },
    read(name) {
      return Promise.resolve(files.get(name));
    },
    remove(name) {
      files.delete(name);
      return Promise.resolve();
    },
    list() {
      return Promise.resolve([...files.keys()]);
    },
  };
}

interface Harness {
  readonly connection: Connection;
  readonly blobs: ReturnType<typeof memoryBlobs>;
  readonly cache: SqliteCache;
  readonly removed: string[];
  readonly ports: DataResetPorts;
}

async function harness(): Promise<Harness> {
  const connection = sqlite();
  await runMigrations(connection);
  const blobs = memoryBlobs();
  const clock = createManualClock();
  const cache = createSqliteCache({
    connection: () => Promise.resolve(connection),
    blobs,
    clock,
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    maxBytes: () => 10 * 1024 * 1024 * 1024,
  });
  const removed: string[] = [];
  const ports: DataResetPorts = {
    connection,
    cache,
    reportFiles: {
      remove(id) {
        removed.push(id);
        return Promise.resolve();
      },
    },
  };
  return { connection, blobs, cache, removed, ports };
}

function count(h: Harness, table: string, where = ""): number {
  const row = h.connection.db
    .prepare(
      `SELECT COUNT(*) AS n FROM ${table}${where === "" ? "" : ` WHERE ${where}`}`,
    )
    .get() as { n: number };
  return row.n;
}

function job(h: Harness, id: string, status: string): void {
  h.connection.db
    .prepare(
      `INSERT INTO job (id, pipeline_id, status, priority, input_json, input_version,
        progress_json, usage_json, plugin_version, created_at, warnings_json, redaction_json)
       VALUES (?, 'summarize', ?, 'normal', '{}', 1, '{}', '{}', '1.0.0', 1, '[]', '{}')`,
    )
    .run(id, status);
}

/** One row in each table this file's actions name, and one cache entry per namespace. */
async function seed(h: Harness): Promise<void> {
  const db = h.connection.db;
  db.prepare(
    `INSERT INTO summary (id, work_key, prompt_version, provider_id, model_id, input_scope, json, generated_at)
     VALUES ('s1', 'w1', 'v1', 'p', 'm', 'abstract', '{}', 1), ('s2', 'w2', 'v1', 'p', 'm', 'abstract', '{}', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO embedding (work_key, model, dim, vector, created_at) VALUES ('w1', 'e', 1, x'00000000', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO report (id, library_id, collection_key, json, generated_at)
     VALUES ('r1', 1, 'C1', '{}', 1), ('r2', 1, 'C2', '{}', 1)`,
  ).run();
  for (const status of [
    "queued",
    "running",
    "paused",
    "cancelling",
    "interrupted",
    ...ENDED_JOB_STATUSES,
  ]) {
    job(h, `j-${status}`, status);
  }
  for (const namespace of CACHE_NAMESPACES) {
    await h.cache.set(namespace, `${namespace}-small`, "v");
  }
  // One entry over the blob threshold, so its text lives in a blob file.
  await h.cache.set(
    "source-response",
    "big",
    "x".repeat(CACHE_BLOB_THRESHOLD_BYTES + 10),
  );
}

describe("P7-T10 — the clear actions' tables and namespaces", () => {
  it("names every table the migrations create, schema_version excepted", async () => {
    const h = await harness();
    const rows = h.connection.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const created = rows
      .map((row) => row.name)
      .filter(
        (name) => name !== "schema_version" && !name.startsWith("sqlite_"),
      );
    expect([...PLUGIN_TABLES].sort()).toStrictEqual(created.sort());
  });

  it("splits the cache namespaces between the clears with no overlap and no gap", () => {
    expect(RESPONSE_NAMESPACES).not.toContain("summary");
    expect(RESPONSE_NAMESPACES).not.toContain("embedding");
    expect(
      [...RESPONSE_NAMESPACES, "summary", "embedding"].sort(),
    ).toStrictEqual([...CACHE_NAMESPACES].sort());
  });

  it("treats only succeeded, failed and cancelled jobs as history", () => {
    expect([...ENDED_JOB_STATUSES]).toStrictEqual([
      "succeeded",
      "failed",
      "cancelled",
    ]);
  });
});

describe("P7-T10 — each clear removes its kind and nothing else", () => {
  it("clear cached responses: the five response namespaces with their blobs; tables and the summary and embedding entries stay", async () => {
    const h = await harness();
    await seed(h);
    expect(h.blobs.files.size).toBe(1);
    const before = await countData(h.ports, "cached-responses");
    expect(before.entries).toBe(RESPONSE_NAMESPACES.length + 1);
    expect(before.rows).toBe(0);
    const result = await clearCachedResponses(h.ports);
    expect(result.entries).toBe(RESPONSE_NAMESPACES.length + 1);
    expect(result.bytes).toBe(before.bytes);
    expect(h.blobs.files.size).toBe(0);
    const stats = await h.cache.stats();
    expect(stats.entries).toBe(2);
    expect(stats.byNamespace.summary.entries).toBe(1);
    expect(stats.byNamespace.embedding.entries).toBe(1);
    expect(count(h, "summary")).toBe(2);
    expect(count(h, "job")).toBe(8);
  });

  it("clear stored summaries: the summary table and namespace, nothing else", async () => {
    const h = await harness();
    await seed(h);
    expect(await countData(h.ports, "summaries")).toMatchObject({
      rows: 2,
      entries: 1,
    });
    const result = await clearStoredSummaries(h.ports);
    expect(result).toMatchObject({ rows: 2, entries: 1 });
    expect(count(h, "summary")).toBe(0);
    expect((await h.cache.stats()).byNamespace.summary.entries).toBe(0);
    expect((await h.cache.stats()).entries).toBe(CACHE_NAMESPACES.length);
    expect(count(h, "embedding")).toBe(1);
    expect(count(h, "report")).toBe(2);
    expect(h.removed).toStrictEqual([]);
  });

  it("clear job history: ended jobs go; queued, running, paused, cancelling and interrupted stay", async () => {
    const h = await harness();
    await seed(h);
    expect((await countData(h.ports, "job-history")).rows).toBe(3);
    const result = await clearJobHistory(h.ports);
    expect(result.rows).toBe(3);
    const left = (
      h.connection.db
        .prepare("SELECT status FROM job ORDER BY status")
        .all() as {
        status: string;
      }[]
    ).map((row) => row.status);
    expect(left).toStrictEqual([
      "cancelling",
      "interrupted",
      "paused",
      "queued",
      "running",
    ]);
    expect((await h.cache.stats()).entries).toBe(CACHE_NAMESPACES.length + 1);
  });

  it("clear embeddings: the embedding table and namespace, nothing else", async () => {
    const h = await harness();
    await seed(h);
    expect(await countData(h.ports, "embeddings")).toMatchObject({
      rows: 1,
      entries: 1,
    });
    const result = await clearEmbeddings(h.ports);
    expect(result).toMatchObject({ rows: 1, entries: 1 });
    expect(count(h, "embedding")).toBe(0);
    expect((await h.cache.stats()).byNamespace.embedding.entries).toBe(0);
    expect(count(h, "summary")).toBe(2);
  });

  it("a second clear finds nothing", async () => {
    const h = await harness();
    await seed(h);
    for (const kind of DATA_KINDS) {
      await clearData(h.ports, kind);
      expect(await clearData(h.ports, kind), kind).toMatchObject({
        rows: 0,
        entries: 0,
      });
    }
  });
});

describe("P7-T10 — delete all plugin data", () => {
  it("empties every plugin table and namespace, removes blobs and report files, keeps schema_version", async () => {
    const h = await harness();
    await seed(h);
    const version = count(h, "schema_version");
    expect(version).toBeGreaterThan(0);
    const counted = await countData(h.ports, "all");
    expect(counted.rows).toBe(2 + 1 + 2 + 8);
    expect(counted.entries).toBe(CACHE_NAMESPACES.length + 1);
    const result = await deleteAllPluginData(h.ports);
    expect(result.rows).toBe(counted.rows);
    expect(result.entries).toBe(counted.entries);
    expect(result.files).toBe(2);
    expect(result.byTable).toMatchObject({ summary: 2, report: 2, job: 8 });
    expect([...h.removed].sort()).toStrictEqual(["r1", "r2"]);
    for (const table of PLUGIN_TABLES) {
      expect(count(h, table), table).toBe(0);
    }
    expect(h.blobs.files.size).toBe(0);
    expect(count(h, "schema_version")).toBe(version);
  });

  it("from the pane, keeps the rows of jobs that have not ended", async () => {
    const h = await harness();
    await seed(h);
    const result = await clearData(h.ports, "all");
    expect(result.rows).toBe(2 + 1 + 2 + 3);
    expect(count(h, "job")).toBe(5);
    expect(
      count(h, "job", "status IN ('succeeded','failed','cancelled')"),
    ).toBe(0);
  });

  it("removes a cache row of a namespace this build does not know, and its blob", async () => {
    const h = await harness();
    await seed(h);
    // A stray row and blob a later build could have left.
    h.connection.db
      .prepare(
        "UPDATE cache_entry SET namespace = 'later-namespace' WHERE key LIKE '%' AND namespace = 'report'",
      )
      .run();
    h.blobs.files.set("stray-blob", "x");
    await deleteAllPluginData(h.ports);
    expect(count(h, "cache_entry")).toBe(0);
    expect(h.blobs.files.has("stray-blob")).toBe(false);
  });

  it("leaves a report file that cannot be removed, and still deletes the rows", async () => {
    const h = await harness();
    await seed(h);
    const result = await deleteAllPluginData({
      ...h.ports,
      reportFiles: {
        remove: () => Promise.reject(new Error("locked")),
      },
    });
    expect(result.files).toBe(0);
    expect(count(h, "report")).toBe(0);
  });

  it("skips a table a file at an older schema lacks", async () => {
    const h = await harness();
    await seed(h);
    h.connection.db.exec("DROP TABLE embedding");
    expect((await countData(h.ports, "embeddings")).rows).toBe(0);
    expect((await clearEmbeddings(h.ports)).rows).toBe(0);
    const result = await deleteAllPluginData(h.ports);
    expect(result.byTable.embedding).toBeUndefined();
    expect(count(h, "summary")).toBe(0);
  });

  it("removes no file without a report-files port", async () => {
    const h = await harness();
    await seed(h);
    const { reportFiles: _unused, ...withoutFiles } = h.ports;
    void _unused;
    const result = await deleteAllPluginData(withoutFiles);
    expect(result.files).toBe(0);
    expect(h.removed).toStrictEqual([]);
  });
});

describe("P7-T10 — reset to defaults", () => {
  it("clears every non-secret preference and never a secret one", () => {
    const cleared: string[] = [];
    const n = resetPreferences(
      { clear: (key) => cleared.push(key) },
      {
        a: { key: "a" },
        s: { key: "s", secret: true },
        b: { key: "b", secret: false },
      },
    );
    expect(n).toBe(2);
    expect(cleared).toStrictEqual(["a", "b"]);
  });

  it("keeps the rows that record state: the key store, the key and validation rows, and the two markers", () => {
    for (const name of [
      "secretBackend",
      "prefsSchemaVersion",
      "cacheLastSeenPromptVersions",
      "ncbiKeyPresent",
      "openrouterLastValidatedAt",
      "anthropicLastValidationResult",
    ]) {
      expect(isKeptOnReset(name), name).toBe(true);
    }
    for (const name of [
      "llmProvider",
      "privacyMode",
      "concurrency",
      "logLevel",
      "ttsLinkedFileDir",
    ]) {
      expect(isKeptOnReset(name), name).toBe(false);
    }
  });

  it("over the shipped schema, clears every row but the secret and kept ones", () => {
    const cleared: string[] = [];
    const n = resetPreferences({ clear: (key) => cleared.push(key) }, PREFS);
    const entries = Object.entries(PREFS) as [
      string,
      { key: string; secret?: boolean },
    ][];
    const kept = entries.filter(
      ([name, def]) => def.secret === true || isKeptOnReset(name),
    );
    // 1 + 1 + 1 markers and store, and 6 × 3 key and validation rows.
    expect(kept).toHaveLength(21);
    expect(n).toBe(entries.length - kept.length);
    for (const [, def] of kept) expect(cleared).not.toContain(def.key);
    expect(cleared).toContain(PREFS.privacyMode.key);
  });
});

describe("P7-T11 — reportAudioKeys reads the audio every stored report names", () => {
  it("gives each report's audio keys in the report's library, once each, and skips a row that names none or does not parse", async () => {
    const h = await harness();
    const insert = h.connection.db.prepare(
      "INSERT INTO report (id, library_id, collection_key, json, generated_at) VALUES (?, ?, 'C', ?, 1)",
    );
    insert.run(
      "r1",
      1,
      JSON.stringify({
        audioAttachmentKeys: { en: "AAAA1111", ko: "BBBB2222" },
      }),
    );
    insert.run(
      "r2",
      1,
      JSON.stringify({ audioAttachmentKeys: { en: "AAAA1111" } }),
    );
    insert.run(
      "r3",
      7,
      JSON.stringify({ audioAttachmentKeys: { ko: "CCCC3333", en: "" } }),
    );
    insert.run("r4", 1, JSON.stringify({ title: "no audio" }));
    insert.run("r5", 1, "{not json");
    insert.run("r6", 1, JSON.stringify({ audioAttachmentKeys: null }));
    expect(await reportAudioKeys(h.connection)).toStrictEqual([
      { libraryID: 1, key: "AAAA1111" },
      { libraryID: 1, key: "BBBB2222" },
      { libraryID: 7, key: "CCCC3333" },
    ]);
  });

  it("gives none from a file without a report table", async () => {
    const h = await harness();
    h.connection.db.exec("DROP TABLE report");
    expect(await reportAudioKeys(h.connection)).toStrictEqual([]);
  });
});
