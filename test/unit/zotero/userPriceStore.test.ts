/**
 * `plan/00` §6 item 265 (b), owner, 2026-10-21: the user-edited price table
 * lives in the plugin database — `docs/07` §8.3's `user_price`, migration
 * version 4, `src/zotero/db.ts`'s `createUserPriceStore`, published by
 * `src/bootstrap/pluginDatabase.ts`'s `installPluginDatabase` as `prices`,
 * and read by `src/llm/shared/modelCatalogue.ts` through its
 * `userPriceOverrides` port.
 *
 * Plain Node (`docs/13` §2.1): no Zotero, no network. The store runs against a
 * real SQLite (`node:sqlite`, as `test/unit/core/provenanceRerun.test.ts`
 * explains) migrated by the shipped `runMigrations`, so the upsert, the
 * `CHECK`s and the `REAL` round trip are executed by SQLite rather than by a
 * double. `test/integration/zotero/provenanceStore.spec.ts` repeats the round
 * trip inside Zotero. Model IDs and prices here are SYNTHETIC test values.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createScope } from "../../../src/bootstrap/container";
import {
  LATEST_SCHEMA_VERSION,
  runMigrations,
  USER_PRICE_DDL,
} from "../../../src/bootstrap/migrations";
import {
  installPluginDatabase,
  type PluginDatabaseSource,
} from "../../../src/bootstrap/pluginDatabase";
import { NO_CACHE } from "../../../src/core/cache/cache";
import { createManualClock } from "../../../src/core/clock";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import {
  createModelCatalogue,
  findCatalogueModel,
} from "../../../src/llm/shared/modelCatalogue";
import type { UserPriceOverride } from "../../../src/llm/shared/pricing";
import {
  createUserPriceStore,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";

const here = fileURLToPath(import.meta.url);
const DOCS_07 = readFileSync(
  resolve(dirname(here), "../../../docs/07-architecture-and-data-model.md"),
  "utf8",
);

/** `docs/07` §8.3's statement that starts with `head`, up to its `;`. */
function docsStatement(head: string): string {
  const start = DOCS_07.indexOf(head);
  expect(start, `docs/07 carries "${head}"`).toBeGreaterThan(-1);
  return DOCS_07.slice(start, DOCS_07.indexOf(";", start));
}

// ---------------------------------------------------------------------------
// A real SQLite behind the port
// ---------------------------------------------------------------------------

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

async function migrated(): Promise<Connection> {
  const connection = sqlite();
  await runMigrations(connection);
  return connection;
}

function rowCount(connection: Connection): number {
  const row = connection.db
    .prepare("SELECT COUNT(*) AS n FROM user_price")
    .get() as { n: number };
  return row.n;
}

const AS_OF = Date.parse("2026-10-21T00:00:00Z");

const TERRA: UserPriceOverride = {
  providerId: "openai",
  modelId: "gpt-5.6-terra",
  inputPerMTokUsd: 2,
  outputPerMTokUsd: 12,
  cachedInputPerMTokUsd: 0.2,
  asOfEpochMs: AS_OF,
};

// ---------------------------------------------------------------------------
// 1. The migration — docs/07 §8.3
// ---------------------------------------------------------------------------

describe("plan/00 §6 item 265 (b) — user_price is docs/07 §8.3's, as migration version 4", () => {
  it("copies user_price from docs/07 §8.3 byte for byte, under the owner's dated decision", () => {
    expect(USER_PRICE_DDL).toBe(docsStatement("CREATE TABLE user_price ("));
    expect(DOCS_07).toContain(
      "Decided 2026-10-21 (owner; `plan/00` §6 item 265)",
    );
  });

  it("migrates a fresh file to version 4 with user_price's columns, types and key, read back", async () => {
    const connection = sqlite();
    expect(await runMigrations(connection)).toStrictEqual({ from: 0, to: 4 });
    expect(LATEST_SCHEMA_VERSION).toBe(4);
    expect(
      connection.db
        .prepare("PRAGMA table_info(user_price)")
        .all()
        .map((r) => {
          const c = r as {
            name: string;
            type: string;
            notnull: number;
            pk: number;
          };
          return [c.name, c.type, c.notnull, c.pk];
        }),
    ).toStrictEqual([
      ["provider_id", "TEXT", 1, 1],
      ["model_id", "TEXT", 1, 2],
      ["input_per_mtok_usd", "REAL", 1, 0],
      ["output_per_mtok_usd", "REAL", 1, 0],
      ["cached_input_per_mtok_usd", "REAL", 0, 0],
      ["as_of", "INTEGER", 1, 0],
    ]);
  });

  it("brings a version-3 file to version 4 without touching cache_entry", async () => {
    const connection = sqlite();
    await runMigrations(connection, [
      { version: 1, statements: ["CREATE TABLE search_provenance (a)"] },
      { version: 2, statements: ["CREATE TABLE job (id TEXT)"] },
      { version: 3, statements: ["CREATE TABLE cache_entry (key TEXT)"] },
    ]);
    connection.db.exec("INSERT INTO cache_entry VALUES ('kept')");
    expect(await runMigrations(connection)).toStrictEqual({ from: 3, to: 4 });
    expect(
      connection.db.prepare("SELECT key FROM cache_entry").all(),
    ).toHaveLength(1);
    expect(rowCount(connection)).toBe(0);
  });

  it("refuses a negative price written around the store, and allows an unknown cached price", async () => {
    const connection = await migrated();
    const insert = connection.db.prepare(
      "INSERT INTO user_price VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const bad of [
      ["openai", "m1", -0.01, 1, null, AS_OF],
      ["openai", "m2", 1, -1, null, AS_OF],
      ["openai", "m3", 1, 1, -0.5, AS_OF],
    ] as const) {
      expect(() => insert.run(...bad)).toThrow(/CHECK constraint/);
    }
    insert.run("openai", "m4", 1, 1, null, AS_OF);
    expect(rowCount(connection)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. The store
// ---------------------------------------------------------------------------

describe("createUserPriceStore — read, upsert, delete on the plugin database", () => {
  it("round-trips fractional US dollars per million tokens exactly, never cents (item 252)", async () => {
    const store = createUserPriceStore(await migrated());
    const rows: UserPriceOverride[] = [
      {
        providerId: "gemini",
        modelId: "gemini-3.8-flash",
        inputPerMTokUsd: 0.075,
        outputPerMTokUsd: 3.75,
        cachedInputPerMTokUsd: 0.0075,
        asOfEpochMs: AS_OF,
      },
      {
        providerId: "openai",
        modelId: "gpt-5.6-luna",
        // A sum that is not a short decimal in binary: it must come back bit for bit.
        inputPerMTokUsd: 0.1 + 0.2,
        outputPerMTokUsd: 1.2,
        asOfEpochMs: AS_OF + 1,
      },
    ];
    for (const row of rows) await store.upsert(row);
    expect(await store.list()).toStrictEqual(rows);
  });

  it("upserts in place: one row per provider and model, the later edit winning", async () => {
    const connection = await migrated();
    const store = createUserPriceStore(connection);
    await store.upsert(TERRA);
    // The later edit drops the cached price: the column goes back to NULL.
    await store.upsert({
      providerId: "openai",
      modelId: "gpt-5.6-terra",
      inputPerMTokUsd: 2.5,
      outputPerMTokUsd: 12,
      asOfEpochMs: AS_OF + 86_400_000,
    });
    expect(rowCount(connection)).toBe(1);
    expect(await store.list()).toStrictEqual([
      {
        providerId: "openai",
        modelId: "gpt-5.6-terra",
        inputPerMTokUsd: 2.5,
        outputPerMTokUsd: 12,
        asOfEpochMs: AS_OF + 86_400_000,
      },
    ]);
  });

  it("keeps one model ID under two providers apart, and lists by provider then model", async () => {
    const store = createUserPriceStore(await migrated());
    const viaOpenRouter: UserPriceOverride = {
      ...TERRA,
      providerId: "openrouter",
      inputPerMTokUsd: 1.9,
    };
    const sol: UserPriceOverride = { ...TERRA, modelId: "gpt-5.6-sol" };
    await store.upsert(TERRA);
    await store.upsert(viaOpenRouter);
    await store.upsert(sol);
    expect(await store.list()).toStrictEqual([sol, TERRA, viaOpenRouter]);
  });

  it("deletes one row and leaves the others; deleting a missing row changes nothing", async () => {
    const store = createUserPriceStore(await migrated());
    const sol: UserPriceOverride = { ...TERRA, modelId: "gpt-5.6-sol" };
    await store.upsert(TERRA);
    await store.upsert(sol);
    await store.delete("openai", "gpt-5.6-terra");
    expect(await store.list()).toStrictEqual([sol]);
    await store.delete("openai", "no-such-model");
    await store.delete("anthropic", "gpt-5.6-sol");
    expect(await store.list()).toStrictEqual([sol]);
  });

  it("refuses an unusable row and writes nothing", async () => {
    const connection = await migrated();
    const store = createUserPriceStore(connection);
    const bad: UserPriceOverride[] = [
      { ...TERRA, inputPerMTokUsd: -1 },
      { ...TERRA, outputPerMTokUsd: Number.POSITIVE_INFINITY },
      { ...TERRA, cachedInputPerMTokUsd: Number.NaN },
      { ...TERRA, asOfEpochMs: Number.NaN },
      { ...TERRA, modelId: "  " },
      { ...TERRA, providerId: "mistral" as UserPriceOverride["providerId"] },
    ];
    for (const row of bad) {
      await expect(store.upsert(row)).rejects.toThrow(RangeError);
    }
    expect(rowCount(connection)).toBe(0);
  });

  it("passes the model ID through redactRecord: an ordinary ID is stored unchanged, a credential-shaped one is refused", async () => {
    const connection = await migrated();
    const store = createUserPriceStore(connection);
    const ordinary = [
      "gpt-5.6-terra",
      "anthropic/claude-haiku-4.5",
      "models/gemini-3.8-flash",
      "claude-haiku-4-5-20251001",
    ];
    for (const modelId of ordinary) {
      await store.upsert({ ...TERRA, modelId });
    }
    expect((await store.list()).map((row) => row.modelId).sort()).toStrictEqual(
      [...ordinary].sort(),
    );
    // SYNTHETIC: shaped like docs/09 §2.1's OpenAI legacy pattern, not a key.
    const keyShaped = `sk-${"A".repeat(40)}`;
    await expect(
      store.upsert({ ...TERRA, modelId: keyShaped }),
    ).rejects.toThrow(/credential/);
    expect(rowCount(connection)).toBe(ordinary.length);
    const stored = connection.db
      .prepare("SELECT model_id FROM user_price")
      .all()
      .map((row) => String((row as { model_id: string }).model_id));
    expect(stored.some((id) => id.includes("AAAA"))).toBe(false);
  });

  it("reads back only usable rows: a provider a later build added is dropped", async () => {
    const connection = await migrated();
    connection.db
      .prepare("INSERT INTO user_price VALUES (?, ?, ?, ?, ?, ?)")
      .run("mistral", "large", 1, 2, null, AS_OF);
    const store = createUserPriceStore(connection);
    await store.upsert(TERRA);
    expect(await store.list()).toStrictEqual([TERRA]);
  });
});

// ---------------------------------------------------------------------------
// 3. On the one shared connection — installPluginDatabase
// ---------------------------------------------------------------------------

interface HeldSource extends PluginDatabaseSource {
  readonly events: string[];
  /** Hold every `user_price` write until {@link release} is called. */
  hold(): void;
  release(): void;
  readonly connection: () => Connection | undefined;
}

function source(): HeldSource {
  const events: string[] = [];
  let held: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  let opened: Connection | undefined;
  return {
    events,
    hold() {
      gate = new Promise<void>((done) => {
        held = done;
      });
    },
    release() {
      held?.();
      gate = undefined;
    },
    connection: () => opened,
    open() {
      events.push("open");
      const inner = sqlite();
      opened = inner;
      return {
        ...inner,
        async queryAsync(sql, params, options) {
          if (/^INSERT INTO user_price/.test(sql) && gate !== undefined) {
            events.push("price write held");
            await gate;
            events.push("price write released");
          }
          return inner.queryAsync(sql, params, options);
        },
        closeDatabase(permanent) {
          events.push("close");
          return inner.closeDatabase(permanent);
        },
      };
    },
    path: () => "/data/research-helper.sqlite",
    blobs: {
      write: () => Promise.resolve(),
      read: () => Promise.resolve(undefined),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve([]),
    },
  };
}

function install(from: PluginDatabaseSource | undefined) {
  const clock = createManualClock();
  const scope = createScope({
    description: "userPriceStore test",
    onError: (message, error) => {
      throw new Error(`${message}: ${String(error)}`);
    },
    strict: true,
  });
  const database = installPluginDatabase(scope, {
    source: from,
    clock,
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    cacheMaxBytes: () => 1024 * 1024,
  });
  return { scope, database, clock };
}

describe("installPluginDatabase — the price table on the one shared connection", () => {
  it("publishes the store on the connection it opened, and a call made before the open settles lands in the file", async () => {
    const held = source();
    const { scope, database } = install(held);
    // Not awaited: the call waits for the open-and-migrate itself.
    const written = database.prices.upsert(TERRA);
    await written;
    const open = await database.ready;
    expect(open?.schemaVersion).toBe(4);
    expect(held.events).toStrictEqual(["open"]);
    expect(await database.prices.list()).toStrictEqual([TERRA]);
    expect(await open?.prices.list()).toStrictEqual([TERRA]);
    expect(rowCount(held.connection()!)).toBe(1);
    await database.prices.delete("openai", "gpt-5.6-terra");
    expect(await database.prices.list()).toStrictEqual([]);
    await scope.unregisterAll();
  });

  it("with no database, lists an empty table and rejects a write", async () => {
    const { scope, database } = install(undefined);
    expect(await database.ready).toBeUndefined();
    expect(await database.prices.list()).toStrictEqual([]);
    await expect(database.prices.upsert(TERRA)).rejects.toThrow(
      /not available/,
    );
    await expect(
      database.prices.delete("openai", "gpt-5.6-terra"),
    ).rejects.toThrow(/not available/);
    await scope.unregisterAll();
  });

  it("closes the connection only after a price write in flight, and refuses calls afterwards", async () => {
    const held = source();
    const { scope, database } = install(held);
    await database.ready;
    held.hold();
    const written = database.prices.upsert(TERRA);
    // Let the write reach the held query.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    const teardown = scope.unregisterAll();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((done) => setImmediate(done));
    }
    expect(held.events).toStrictEqual(["open", "price write held"]);
    held.release();
    await written;
    await teardown;
    expect(held.events).toStrictEqual([
      "open",
      "price write held",
      "price write released",
      "close",
    ]);
    expect(await database.prices.list()).toStrictEqual([]);
    await expect(database.prices.upsert(TERRA)).rejects.toThrow(
      /not available/,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The catalogue reads it through its port
// ---------------------------------------------------------------------------

describe("the model catalogue reads the stored table through userPriceOverrides", () => {
  it("prices a model at the user's stored row, even on the bundled fallback list", async () => {
    const store = createUserPriceStore(await migrated());
    await store.upsert(TERRA);
    const catalogue = createModelCatalogue({
      registry: { list: () => [], isConfigured: () => false },
      openRouterCatalogue: () =>
        Promise.reject(new Error("synthetic network failure")),
      cache: NO_CACHE,
      clock: createManualClock(AS_OF),
      userPriceOverrides: () => store.list(),
    });
    const snapshot = await catalogue.get({
      token: createCancellationTokenSource().token,
    });
    expect(snapshot.stale).toBe(true);
    const prices = findCatalogueModel(
      snapshot,
      "openai",
      "gpt-5.6-terra",
    )?.prices;
    expect(prices).toMatchObject({
      source: "user-override",
      inputPerMTokUsd: 2,
      outputPerMTokUsd: 12,
      cachedInputPerMTokUsd: 0.2,
      asOfEpochMs: AS_OF,
    });
  });
});
