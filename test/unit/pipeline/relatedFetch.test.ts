/**
 * `P5-T10`: the relatedness cache, the negative cache and the request budget.
 *
 * Plain Node, no network. The cache is the shipped `createSqliteCache` on a real
 * SQLite (`node:sqlite`) migrated by `runMigrations`, as
 * `test/unit/core/cache.test.ts` does it, so expiry is SQLite's and the manual
 * clock's, not a double's.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import { NO_CACHE, type Cache } from "../../../src/core/cache/cache";
import { cacheKey } from "../../../src/core/cache/keys";
import { createSqliteCache } from "../../../src/core/cache/sqliteCache";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import {
  BadRequestError,
  RateLimitError,
  TimeoutError,
  UpstreamServerError,
} from "../../../src/core/errors";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import { mapPaper } from "../../../src/sources/semanticscholar/mapper";
import {
  cachedRelated,
  planRelatedSeeds,
  readRelated,
  RELATED_CACHE_NAMESPACE,
  RELATED_NEGATIVE_TTL_MS,
  RELATED_PERMANENT_TTL_MS,
  RELATED_TTL_MS,
  relatedCacheDeps,
  relatedCacheKey,
  writeRelated,
  writeRelatedMissing,
  type RelatedCacheDeps,
  type RelatedCacheKey,
  type RelatedSignalKind,
} from "../../../src/pipeline/shared/relatedFetch";
import {
  GENERATOR_VALUE_ORDER,
  RequestBudget,
} from "../../../src/pipeline/shared/requestBudget";
import type { SqlConnection, SqlParam } from "../../../src/zotero/db";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_05 = readFileSync(
  resolve(here, "../../../docs/05-related-work-discovery.md"),
  "utf8",
);

const DAY_MS = 24 * 60 * 60 * 1000;
const S2_ID = "649def34f8be52c8b66281af98ae884c09aef38b";
const OTHER_S2_ID = "a49def34f8be52c8b66281af98ae884c09aef38c";

function sqlite(): SqlConnection {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
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

interface Harness {
  readonly cache: Cache;
  readonly clock: ManualClock;
  readonly deps: RelatedCacheDeps;
  readonly warn: ReturnType<typeof vi.fn>;
}

async function harness(): Promise<Harness> {
  const connection = sqlite();
  await runMigrations(connection);
  const clock = createManualClock();
  const cache = createSqliteCache({
    connection: () => Promise.resolve(connection),
    blobs: {
      write: () => Promise.resolve(),
      read: () => Promise.resolve(undefined),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve([]),
    },
    clock,
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    maxBytes: () => 10 * 1024 * 1024 * 1024,
  });
  const warn = vi.fn();
  return { cache, clock, warn, deps: { cache, logger: { warn } } };
}

const seedKey = (id: string): RelatedCacheKey => ({
  sourceId: "semanticscholar",
  ids: [id],
  params: { limit: 100 },
});

const http404 = (): BadRequestError =>
  new BadRequestError(404, "HTTP 404 from api.semanticscholar.org");

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe("cachedRelated: cache first, then the request", () => {
  it("makes no request on a second identical call", async () => {
    const fetch = vi.fn(() => Promise.resolve({ records: ["a"] }));
    const first = await cachedRelated(
      h.deps,
      "citations",
      seedKey(S2_ID),
      fetch,
    );
    const second = await cachedRelated(
      h.deps,
      "citations",
      seedKey(S2_ID),
      fetch,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ outcome: "value", fromCache: false });
    expect(second).toMatchObject({
      outcome: "value",
      fromCache: true,
      value: { records: ["a"] },
    });
  });

  it("requests again once the entry has expired, and not a moment before", async () => {
    const fetch = vi.fn(() => Promise.resolve({ n: 1 }));
    await cachedRelated(h.deps, "citations", seedKey(S2_ID), fetch);
    h.clock.advance(RELATED_TTL_MS.citations - 1);
    await cachedRelated(h.deps, "citations", seedKey(S2_ID), fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    h.clock.advance(1);
    const later = await cachedRelated(
      h.deps,
      "citations",
      seedKey(S2_ID),
      fetch,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(later).toMatchObject({ outcome: "value", fromCache: false });
  });

  it("stores in the one source-response namespace, with the source's tag", async () => {
    await cachedRelated(h.deps, "pmra", seedKey(S2_ID), () =>
      Promise.resolve({ n: 1 }),
    );
    expect(RELATED_CACHE_NAMESPACE).toBe("source-response");
    const stored = await h.cache.getWithMeta(
      "source-response",
      relatedCacheKey("pmra", seedKey(S2_ID)),
    );
    expect(stored?.meta.tags).toContain("source:semanticscholar");
    expect(stored?.meta.expiresAtEpochMs).toBe(
      h.clock.now() + RELATED_TTL_MS.pmra,
    );
  });

  it("does not let one signal's answer serve another", async () => {
    const fetch = vi.fn(() => Promise.resolve({ n: 1 }));
    await cachedRelated(h.deps, "citations", seedKey(S2_ID), fetch);
    await cachedRelated(h.deps, "references", seedKey(S2_ID), fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("docs/05 §9.2's lifetimes", () => {
  /** The table's rows this wrapper stores, by their label in the document. */
  const ROWS: Readonly<Record<string, RelatedSignalKind>> = {
    "Paper metadata (title, authors, venue, year, abstract)": "metadata",
    "ID cross-walk (PMID↔DOI↔PMCID)": "id-crosswalk",
    "References of a paper": "references",
    "Citations of a paper": "citations",
    "`citationCount`": "citation-count",
    "pmra `elink` neighbours": "pmra",
    "S2 recommendations": "s2-recommendations",
    "Keyword search results": "keyword-search",
  };

  function documentedTtls(): Map<string, string> {
    const start = DOCS_05.indexOf("**TTLs, chosen by");
    const end = DOCS_05.indexOf("**The negative cache is not", start);
    expect(start).toBeGreaterThan(-1);
    const rows = new Map<string, string>();
    for (const line of DOCS_05.slice(start, end).split("\n")) {
      const cells = line.split("|").map((cell) => cell.trim());
      const ttl = cells[2]?.match(/^\*\*(.+?)\*\*/)?.[1];
      if (cells[1] !== undefined && ttl !== undefined) rows.set(cells[1], ttl);
    }
    return rows;
  }

  function msOf(ttl: string): number {
    if (ttl === "permanent") return RELATED_PERMANENT_TTL_MS;
    const days = /^(\d+) days?$/.exec(ttl)?.[1];
    if (days === undefined) throw new Error(`unread TTL: ${ttl}`);
    return Number(days) * DAY_MS;
  }

  it("transcribes the table, row for row", () => {
    const rows = documentedTtls();
    expect(rows.size).toBe(10);
    for (const [label, kind] of Object.entries(ROWS)) {
      const ttl = rows.get(label);
      expect(ttl, label).toBeDefined();
      expect(RELATED_TTL_MS[kind], label).toBe(msOf(ttl ?? ""));
    }
    expect(RELATED_NEGATIVE_TTL_MS).toBe(
      msOf(rows.get("Negative cache (404 / unresolvable ID)") ?? ""),
    );
    // The two rows not in `RELATED_TTL_MS`: vectors live in the `embedding`
    // table, and the negative row is checked just above.
    expect([...rows.keys()].filter((label) => !(label in ROWS)).sort()).toEqual(
      ["Negative cache (404 / unresolvable ID)", "SPECTER2 embedding"],
    );
    expect(Object.keys(RELATED_TTL_MS).sort()).toEqual(
      Object.values(ROWS).sort(),
    );
  });

  it.each(Object.entries(RELATED_TTL_MS) as [RelatedSignalKind, number][])(
    "%s is stored for its own lifetime",
    async (kind, ttlMs) => {
      const fetch = vi.fn(() => Promise.resolve({ n: 1 }));
      await cachedRelated(h.deps, kind, seedKey(S2_ID), fetch);
      h.clock.advance(ttlMs - 1);
      await cachedRelated(h.deps, kind, seedKey(S2_ID), fetch);
      expect(fetch).toHaveBeenCalledTimes(1);
      h.clock.advance(1);
      await cachedRelated(h.deps, kind, seedKey(S2_ID), fetch);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps a permanent row past the namespace's 24 h, at a safe integer", async () => {
    const fetch = vi.fn(() => Promise.resolve({ pmid: "1" }));
    await cachedRelated(h.deps, "id-crosswalk", seedKey(S2_ID), fetch);
    h.clock.advance(10 * 365 * DAY_MS);
    await cachedRelated(h.deps, "id-crosswalk", seedKey(S2_ID), fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Number.isSafeInteger(h.clock.now() + RELATED_PERMANENT_TTL_MS)).toBe(
      true,
    );
  });
});

describe("the negative cache", () => {
  it("does not request a 404 seed again within 7 days, and does at 7 days", async () => {
    const fetch = vi.fn(() => Promise.reject(http404()));
    const first = await cachedRelated(
      h.deps,
      "references",
      seedKey(S2_ID),
      fetch,
    );
    expect(first).toEqual({ outcome: "missing", fromCache: false });
    h.clock.advance(7 * DAY_MS - 1);
    const within = await cachedRelated(
      h.deps,
      "references",
      seedKey(S2_ID),
      fetch,
    );
    expect(within).toEqual({ outcome: "missing", fromCache: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    h.clock.advance(1);
    await cachedRelated(h.deps, "references", seedKey(S2_ID), fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses 7 days even for a signal with a longer lifetime", () => {
    expect(RELATED_NEGATIVE_TTL_MS).toBe(7 * DAY_MS);
    expect(RELATED_TTL_MS.references).toBeGreaterThan(RELATED_NEGATIVE_TTL_MS);
  });

  it("belongs to one signal: another signal still asks", async () => {
    const fetch = vi.fn(() => Promise.reject(http404()));
    await cachedRelated(h.deps, "references", seedKey(S2_ID), fetch);
    await cachedRelated(h.deps, "citations", seedKey(S2_ID), fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("is replaced by an answer once it has expired", async () => {
    await cachedRelated(h.deps, "references", seedKey(S2_ID), () =>
      Promise.reject(http404()),
    );
    h.clock.advance(RELATED_NEGATIVE_TTL_MS);
    const fetch = vi.fn(() => Promise.resolve({ n: 1 }));
    await cachedRelated(h.deps, "references", seedKey(S2_ID), fetch);
    const hit = await readRelated(h.deps, "references", seedKey(S2_ID));
    expect(hit).toMatchObject({ outcome: "value", value: { n: 1 } });
  });

  it.each([
    ["a 400", new BadRequestError(400, "HTTP 400")],
    ["a 429", new RateLimitError(429, undefined, "api.semanticscholar.org")],
    ["a 503", new UpstreamServerError(503, "HTTP 503")],
    ["a timeout", new TimeoutError(1000, "https://example.invalid/")],
    ["a plain throw", new Error("bug")],
  ])("remembers nothing for %s, and throws it", async (_name, error) => {
    const fetch = vi.fn(() => Promise.reject(error));
    await expect(
      cachedRelated(h.deps, "citations", seedKey(S2_ID), fetch),
    ).rejects.toBe(error);
    expect(
      await readRelated(h.deps, "citations", seedKey(S2_ID)),
    ).toBeUndefined();
    await expect(
      cachedRelated(h.deps, "citations", seedKey(S2_ID), fetch),
    ).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("writeRelatedMissing covers an unresolvable id inside a good answer", async () => {
    expect(
      await writeRelatedMissing(h.deps, "metadata", seedKey(S2_ID)),
    ).toEqual({ outcome: "missing", fromCache: false });
    const fetch = vi.fn(() => Promise.resolve({ n: 1 }));
    expect(
      await cachedRelated(h.deps, "metadata", seedKey(S2_ID), fetch),
    ).toEqual({ outcome: "missing", fromCache: true });
    expect(fetch).not.toHaveBeenCalled();
    h.clock.advance(RELATED_NEGATIVE_TTL_MS);
    await cachedRelated(h.deps, "metadata", seedKey(S2_ID), fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("the request budget", () => {
  it("draws docs/05 §9.3's tryTake: all or nothing", () => {
    const budget = new RequestBudget(3);
    expect(budget.tryTake(4)).toBe(false);
    expect(budget.remaining).toBe(3);
    expect(budget.tryTake()).toBe(true);
    expect(budget.tryTake(2)).toBe(true);
    expect(budget.remaining).toBe(0);
    expect(budget.tryTake()).toBe(false);
    expect(budget.tryTake(0)).toBe(true);
  });

  it("takeUpTo gives what is left", () => {
    const budget = new RequestBudget(5);
    expect(budget.takeUpTo(3)).toBe(3);
    expect(budget.takeUpTo(3)).toBe(2);
    expect(budget.takeUpTo(3)).toBe(0);
    expect(budget.remaining).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s requests",
    (n) => {
      expect(() => new RequestBudget(n)).toThrow(RangeError);
      expect(() => new RequestBudget(5).tryTake(n)).toThrow(RangeError);
      expect(() => new RequestBudget(5).takeUpTo(n)).toThrow(RangeError);
    },
  );

  const SEEDS = Array.from({ length: 20 }, (_, i) => `seed-${String(i)}`);
  const keyOf = (seed: string): RelatedCacheKey => ({
    sourceId: "semanticscholar",
    ids: [seed],
  });

  /** A generator as `P5-T23` builds one: plan, then fetch what the plan took. */
  async function runGenerator(
    budget: RequestBudget,
    fetch: (seed: string) => Promise<unknown>,
  ) {
    const plan = await planRelatedSeeds(
      h.deps,
      budget,
      "citations",
      SEEDS,
      keyOf,
    );
    for (const seed of plan.toFetch) {
      await cachedRelated(h.deps, "citations", keyOf(seed), () => fetch(seed));
    }
    return plan;
  }

  it("a budget of 5 with a 20-seed generator processes exactly the top 5 seeds", async () => {
    const budget = new RequestBudget(5);
    const fetch = vi.fn((seed: string) => Promise.resolve({ seed }));
    const plan = await runGenerator(budget, fetch);
    expect(fetch.mock.calls.map(([seed]) => seed)).toEqual(SEEDS.slice(0, 5));
    expect(plan.toFetch).toEqual(SEEDS.slice(0, 5));
    expect(plan.dropped).toEqual(SEEDS.slice(5));
    expect(budget.remaining).toBe(0);
  });

  it("takes the whole share before the first request goes out", async () => {
    const budget = new RequestBudget(5);
    const seen: number[] = [];
    await runGenerator(budget, (seed) => {
      seen.push(budget.remaining);
      return Promise.resolve({ seed });
    });
    expect(seen).toEqual([0, 0, 0, 0, 0]);
  });

  it("a cached answer costs nothing, and a cached miss costs nothing", async () => {
    await writeRelated(h.deps, "citations", keyOf("seed-0"), { n: 0 });
    await writeRelated(h.deps, "citations", keyOf("seed-7"), { n: 7 });
    await writeRelatedMissing(h.deps, "citations", keyOf("seed-1"));
    const budget = new RequestBudget(5);
    const fetch = vi.fn((seed: string) => Promise.resolve({ seed }));
    const plan = await runGenerator(budget, fetch);
    expect(plan.cached.map(({ seed }) => seed)).toEqual([
      "seed-0",
      "seed-1",
      "seed-7",
    ]);
    expect(plan.cached[1]?.outcome).toEqual({
      outcome: "missing",
      fromCache: true,
    });
    expect(plan.toFetch).toEqual([
      "seed-2",
      "seed-3",
      "seed-4",
      "seed-5",
      "seed-6",
    ]);
    expect(plan.dropped).toHaveLength(20 - 3 - 5);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("takes nothing when every seed is cached, and fits a budget larger than the misses", async () => {
    const budget = new RequestBudget(30);
    await runGenerator(budget, (seed) => Promise.resolve({ seed }));
    expect(budget.remaining).toBe(10);
    const plan = await planRelatedSeeds(
      h.deps,
      budget,
      "citations",
      SEEDS,
      keyOf,
    );
    expect(plan.toFetch).toEqual([]);
    expect(plan.dropped).toEqual([]);
    expect(plan.cached).toHaveLength(20);
    expect(budget.remaining).toBe(10);
  });

  it("gives a short budget to generators in value order", async () => {
    const budget = new RequestBudget(6);
    const taken = new Map<string, number>();
    for (const generator of GENERATOR_VALUE_ORDER) {
      taken.set(generator, budget.takeUpTo(generator === "pmra" ? 5 : 1));
    }
    expect([...taken]).toEqual([
      ["s2-recommendations", 1],
      ["pmra", 5],
      ["author-watch", 0],
      ["keyword-search", 0],
      ["forward-citations", 0],
      ["keyword-arxiv", 0],
    ]);
  });

  it("GENERATOR_VALUE_ORDER follows docs/05 §9.3's ranks", () => {
    const start = DOCS_05.indexOf("### 9.3 Request budgeting");
    const end = DOCS_05.indexOf("### 9.4", start);
    const ranks = new Map<string, number>();
    for (const line of DOCS_05.slice(start, end).split("\n")) {
      const cells = line.split("|").map((cell) => cell.trim());
      const rank = Number(cells[1]);
      if (cells[2] !== undefined && Number.isInteger(rank) && rank > 0) {
        ranks.set(cells[2], rank);
      }
    }
    expect(ranks.size).toBe(8);
    const documentRow: Record<(typeof GENERATOR_VALUE_ORDER)[number], string> =
      {
        "s2-recommendations": "S2 Recommendations POST",
        pmra: "pmra elink",
        "author-watch": "Europe PMC author/venue watch",
        "keyword-search": "Europe PMC keyword search",
        "forward-citations": "S2 forward citations",
        "keyword-arxiv": "arXiv keyword search",
      };
    const inOrder = GENERATOR_VALUE_ORDER.map(
      (generator) => ranks.get(documentRow[generator]) ?? 0,
    );
    expect(inOrder).toEqual([1, 3, 4, 5, 6, 7]);
    expect(GENERATOR_VALUE_ORDER).toHaveLength(ranks.size - 2);
  });
});

describe("nothing secret in a value or a key", () => {
  const OPENROUTER_SHAPE = `sk-or-v1-${"a".repeat(40)}`;

  it("keeps a Semantic Scholar record whole, with no mark", async () => {
    const record = mapPaper(
      {
        paperId: S2_ID,
        url: `https://www.semanticscholar.org/paper/${S2_ID}`,
        title: "A paper",
        externalIds: { DOI: "10.1000/xyz" },
        openAccessPdf: { url: "https://example.org/a.pdf" },
      },
      1,
      false,
      () => undefined,
    );
    const page = {
      records: [record],
      warnings: [],
      edges: [{ kind: "citation", rank: 1 }],
    };
    const fresh = await cachedRelated(h.deps, "citations", seedKey(S2_ID), () =>
      Promise.resolve(page),
    );
    const again = await readRelated(h.deps, "citations", seedKey(S2_ID));
    for (const outcome of [fresh, again]) {
      expect(outcome).toMatchObject({
        outcome: "value",
        value: page,
        redaction: { partlyRedacted: false },
      });
    }
    expect(JSON.stringify(again)).toContain(`semanticscholar:${S2_ID}`);
  });

  it("gates every other field, marks it, and answers the same when fresh and when cached", async () => {
    const page = {
      records: [
        {
          id: `semanticscholar:${S2_ID}`,
          work: {
            abstract: `pasted ${OPENROUTER_SHAPE} here`,
            openAccess: { pdfUrl: "https://example.org/a.pdf?api_key=abc123" },
          },
          apiKey: "abc123",
        },
      ],
    };
    const fresh = await cachedRelated(h.deps, "citations", seedKey(S2_ID), () =>
      Promise.resolve(page),
    );
    const again = await readRelated(h.deps, "citations", seedKey(S2_ID));
    expect(again).toEqual({ ...fresh, fromCache: true });
    const stored = JSON.stringify(
      await h.cache.get(
        RELATED_CACHE_NAMESPACE,
        relatedCacheKey("citations", seedKey(S2_ID)),
      ),
    );
    expect(stored).not.toContain(OPENROUTER_SHAPE);
    expect(stored).not.toContain("abc123");
    expect(stored).toContain(`semanticscholar:${S2_ID}`);
    expect(fresh).toMatchObject({
      redaction: { partlyRedacted: true, droppedFields: 1 },
    });
    expect(again).toMatchObject({ redaction: { partlyRedacted: true } });
  });

  it("keeps two 40-hexadecimal seeds apart in the key", () => {
    expect(relatedCacheKey("citations", seedKey(S2_ID))).not.toBe(
      relatedCacheKey("citations", seedKey(OTHER_S2_ID)),
    );
  });

  it("builds docs/07 §9.1's key from every component", () => {
    const key: RelatedCacheKey = {
      sourceId: "semanticscholar",
      ids: ["a"],
      negativeIds: ["b"],
      params: { limit: 5 },
    };
    expect(relatedCacheKey("citations", key)).toBe(
      cacheKey("source", "semanticscholar", "citations", ["a"], ["b"], {
        limit: 5,
      }),
    );
    expect(relatedCacheKey("citations", { ...key, negativeIds: [] })).not.toBe(
      relatedCacheKey("citations", key),
    );
    expect(
      relatedCacheKey("citations", { ...key, params: { limit: 6 } }),
    ).not.toBe(relatedCacheKey("citations", key));
    expect(
      relatedCacheKey("citations", { ...key, sourceId: "europepmc" }),
    ).not.toBe(relatedCacheKey("citations", key));
    expect(relatedCacheKey("pmra", key)).not.toBe(
      relatedCacheKey("citations", key),
    );
  });

  it("refuses a credential field in a key before anything is sent", async () => {
    const fetch = vi.fn(() => Promise.resolve({ n: 1 }));
    await expect(
      cachedRelated(
        h.deps,
        "keyword-search",
        { sourceId: "pubmed", ids: [], params: { api_key: "abc123" } },
        fetch,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hashes a credential-shaped query in its redacted form", () => {
    const query = (text: string): RelatedCacheKey => ({
      sourceId: "pubmed",
      ids: [],
      params: { query: text },
    });
    expect(
      relatedCacheKey("keyword-search", query(`find ${OPENROUTER_SHAPE}`)),
    ).toBe(
      relatedCacheKey(
        "keyword-search",
        query(`find sk-or-v1-${"b".repeat(40)}`),
      ),
    );
  });
});

describe("a cache that fails, or is switched off", () => {
  const throwing = (): Cache => ({
    ...NO_CACHE,
    get: () => Promise.reject(new Error("disk")),
    set: () => Promise.reject(new Error("disk")),
  });

  it("still answers, and warns without the value", async () => {
    const warn = vi.fn();
    const deps: RelatedCacheDeps = { cache: throwing(), logger: { warn } };
    const fetch = vi.fn(() => Promise.resolve({ secret: "no" }));
    const outcome = await cachedRelated(
      deps,
      "citations",
      seedKey(S2_ID),
      fetch,
    );
    expect(outcome).toMatchObject({ outcome: "value", fromCache: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([, ctx]) => ctx)).toEqual([
      { kind: "citations", reason: "Error" },
      { kind: "citations", reason: "Error" },
    ]);
  });

  it("still reports a 404 when the negative entry cannot be written", async () => {
    const warn = vi.fn();
    const deps: RelatedCacheDeps = { cache: throwing(), logger: { warn } };
    const outcome = await cachedRelated(deps, "citations", seedKey(S2_ID), () =>
      Promise.reject(http404()),
    );
    expect(outcome).toEqual({ outcome: "missing", fromCache: false });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("treats an entry of an unknown shape as a miss", async () => {
    await h.cache.set(
      RELATED_CACHE_NAMESPACE,
      relatedCacheKey("citations", seedKey(S2_ID)),
      { outcome: "other" },
    );
    expect(
      await readRelated(h.deps, "citations", seedKey(S2_ID)),
    ).toBeUndefined();
  });

  it("relatedCacheDeps honours cache.enabled", () => {
    const logger = createLogger({
      sink: NULL_LOG_SINK,
      clock: createManualClock(),
    });
    const ctx = (enabled: boolean) =>
      ({
        cache: h.cache,
        logger,
        config: { get: () => enabled },
      }) as unknown as Parameters<typeof relatedCacheDeps>[0];
    expect(relatedCacheDeps(ctx(true)).cache).toBe(h.cache);
    expect(relatedCacheDeps(ctx(false)).cache).toBe(NO_CACHE);
    expect(relatedCacheDeps(ctx(true)).logger).toBe(logger);
  });

  it("asks config for cache.enabled by its schema name", () => {
    const get = vi.fn(() => true);
    relatedCacheDeps({
      cache: h.cache,
      logger: createLogger({ sink: NULL_LOG_SINK, clock: createManualClock() }),
      config: { get },
    } as unknown as Parameters<typeof relatedCacheDeps>[0]);
    expect(get).toHaveBeenCalledWith("cacheEnabled");
  });
});
