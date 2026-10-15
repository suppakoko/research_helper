/**
 * `P2-T18`: the translator import path behind `useTranslators` — the parts
 * that are decisions rather than platform behaviour.
 *
 * Four groups, each against the module that owns the decision:
 *
 * 1. **The shipped default** — `src/prefs/schema.ts` and `addon/prefs.js` both
 *    say `false` (`docs/07` §8.5, `docs/01` §7.2).
 * 2. **The lookups** — `src/zotero/translatorImport.ts` against a fake
 *    `Zotero.Translate.Search` seam: one search per DOI record, the whole
 *    translator list, PMID batches of 200, the PMCID route, and the per-record
 *    fallback for each reason class. No `Zotero` global is touched: the
 *    module takes its search factory, its schema promise and its timer as
 *    options, and none of the fakes can reach a network.
 * 3. **The writer** — `src/bootstrap/registerPipelines.ts` reads the
 *    preference once per run through a spying `PrefStore`, passes Strategy B
 *    to the importer only when it is on, and sums the per-run counts. The
 *    importer itself is replaced here; what it does with the option is
 *    `test/integration/zotero/translatorImport.spec.ts`'s, inside Zotero.
 * 4. **The strings** — the preference's label and slower-path caveat in
 *    `en-US`, and the Korean entries left as reviewed-later stubs.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import {
  OperationCancelledError,
  UpstreamServerError,
} from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import { KO_PENDING_REVIEW, KO_PRESENT } from "../../../src/i18n/keys";
import type { CanonicalWork, WorkType } from "../../../src/model/canonicalWork";
import type { ExternalIds } from "../../../src/model/ids";
import { getPref, setPrefStore } from "../../../src/prefs";
import { PREFS } from "../../../src/prefs/schema";
import {
  identifierFor,
  lookupThroughTranslators,
  PMID_LOOKUP_BATCH_SIZE,
  type TranslateOptions,
  type TranslatorIdentifier,
  type TranslatorImportOptions,
  type TranslatorSearch,
} from "../../../src/zotero/translatorImport";

// The writer's two Zotero-facing imports, replaced so group 3 runs in Node.
const { importWorksMock } = vi.hoisted(() => ({ importWorksMock: vi.fn() }));
vi.mock("../../../src/zotero/importer", () => ({
  DEFAULT_CHUNK_SIZE: 50,
  importWorks: (...args: unknown[]) => importWorksMock(...args) as unknown,
}));
vi.mock("../../../src/zotero/libraryIndex", () => ({
  buildLibraryIndex: vi.fn(() =>
    Promise.resolve({
      stats: { searchCount: 1 },
      findExisting: () => undefined,
    }),
  ),
}));

// Imported after the mocks are declared (vitest hoists `vi.mock` regardless).
const { createZoteroSearchImportWriter, addPathTotals } =
  await import("../../../src/bootstrap/registerPipelines");

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function work(
  slug: string,
  ids: Partial<Record<keyof ExternalIds, string>>,
  extra: { type?: WorkType; abstract?: string } = {},
): CanonicalWork {
  return {
    workKey: `test:${slug}`,
    ids: ids as ExternalIds,
    type: extra.type ?? "journal-article",
    title: `Fixture ${slug}`,
    ...(extra.abstract !== undefined && { abstract: extra.abstract }),
    authors: [{ family: "Hopper" }],
    provenance: { recordIds: [], fieldOrigin: {}, seenIn: ["pubmed"] },
    normalizedAtEpochMs: 0,
  };
}

/** A saved item as far as this module reads one: `id` and `getField`. */
function fakeItem(id: number, fields: Record<string, string> = {}) {
  return {
    id,
    getField: (name: string) => fields[name] ?? "",
  } as unknown as Zotero.Item;
}

interface SearchCall {
  identifier: TranslatorIdentifier | undefined;
  translators: readonly unknown[] | undefined;
  options: TranslateOptions | undefined;
}

/**
 * A `Translate.Search` fake. `respond` decides, per identifier, what the
 * lookup does; every call is recorded.
 */
function fakeSearches(
  respond: (identifier: TranslatorIdentifier) => {
    translators?: readonly unknown[];
    items?: readonly Zotero.Item[];
    throws?: unknown;
    hang?: boolean;
  },
) {
  const calls: SearchCall[] = [];
  const createSearch = vi.fn((): TranslatorSearch => {
    const call: SearchCall = {
      identifier: undefined,
      translators: undefined,
      options: undefined,
    };
    calls.push(call);
    return {
      setIdentifier(identifier) {
        call.identifier = identifier;
      },
      getTranslators() {
        const plan = respond(call.identifier as TranslatorIdentifier);
        return Promise.resolve(plan.translators ?? ["t1", "t2", "t3"]);
      },
      setTranslator(translators) {
        call.translators = translators;
      },
      translate(options) {
        call.options = options;
        const plan = respond(call.identifier as TranslatorIdentifier);
        if (plan.hang === true) return new Promise(() => undefined);
        if (plan.throws !== undefined) {
          return Promise.reject(plan.throws as Error);
        }
        return Promise.resolve(plan.items ?? []);
      },
    };
  });
  return { calls, createSearch };
}

function fakeLogger(): Logger & { warn: ReturnType<typeof vi.fn> } {
  const logger = {
    child: () => logger,
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    time: <T>(_msg: string, fn: () => Promise<T>) => fn(),
  };
  return logger as unknown as Logger & { warn: ReturnType<typeof vi.fn> };
}

const ready = () => Promise.resolve();

async function runLookup(
  works: readonly CanonicalWork[],
  options: TranslatorImportOptions,
) {
  return lookupThroughTranslators({
    works,
    libraryID: 1,
    collectionID: 77,
    options: { schemaReady: ready, ...options },
  });
}

// ---------------------------------------------------------------------------
// 1. The shipped default
// ---------------------------------------------------------------------------

describe("useTranslators ships off (docs/07 §8.5, docs/01 §7.2)", () => {
  afterEach(() => setPrefStore(undefined));

  it("reads false on a clean profile, and the schema default and the prefs.js line agree", () => {
    setPrefStore(createMemoryPrefStore());
    expect(getPref("useTranslators")).toBe(false);
    expect(PREFS.useTranslators.default).toBe(false);
    expect(PREFS.useTranslators.type).toBe("boolean");
    const prefsJs = readFileSync(resolve(repo, "addon/prefs.js"), "utf8");
    const lines = prefsJs
      .split("\n")
      .filter((line) => /^pref\("useTranslators"/u.test(line));
    expect(lines).toEqual(['pref("useTranslators", false);']);
  });
});

// ---------------------------------------------------------------------------
// 2. The lookups
// ---------------------------------------------------------------------------

describe("translatorImport — identifier lookup (docs/01 §6.2)", () => {
  it("derives the identifier in extractIdentifiers' priority, DOI then arXiv then PMID, never a PMCID", () => {
    expect(
      identifierFor(work("a", { doi: "10.1/a", arxivId: "2401.1", pmid: "1" })),
    ).toEqual({ DOI: "10.1/a" });
    expect(identifierFor(work("b", { arxivId: "2401.1", pmid: "1" }))).toEqual({
      arXiv: "2401.1",
    });
    expect(identifierFor(work("c", { pmid: "1" }))).toEqual({ PMID: "1" });
    expect(identifierFor(work("d", { pmcid: "PMC1" }))).toBeUndefined();
  });

  it("constructs exactly one Translate.Search for a DOI record and passes setTranslator the whole list", async () => {
    const translators = ["doi-cn", "crossref-rest", "pubmed"];
    const item = fakeItem(5);
    const { calls, createSearch } = fakeSearches(() => ({
      translators,
      items: [item],
    }));
    const result = await runLookup([work("doi", { doi: "10.1/x" })], {
      createSearch,
    });

    expect(createSearch).toHaveBeenCalledTimes(1);
    expect(result.searches).toBe(1);
    expect(calls[0]?.identifier).toEqual({ DOI: "10.1/x" });
    // The array itself — not `translators[0]`, not a copy of one element.
    expect(calls[0]?.translators).toBe(translators);
    expect(calls[0]?.options).toEqual({
      libraryID: 1,
      collections: [77],
      saveAttachments: true,
    });
    expect(result.translated.map((t) => t.item)).toEqual([item]);
    expect(result.fallbacks).toEqual([]);
  });

  it(`batches PMID-only records ${String(PMID_LOOKUP_BATCH_SIZE)} to a lookup as { PMID: [...] }`, async () => {
    const works = Array.from({ length: 450 }, (_, i) =>
      work(`p${String(i)}`, { pmid: String(1000 + i) }),
    );
    const { calls, createSearch } = fakeSearches((identifier) => {
      const pmids = (identifier as { PMID: readonly string[] }).PMID;
      return {
        items: pmids.map((pmid) => fakeItem(Number(pmid), { PMID: pmid })),
      };
    });
    const result = await runLookup(works, { createSearch });

    expect(createSearch).toHaveBeenCalledTimes(3);
    const sizes = calls.map(
      (call) => (call.identifier as { PMID: readonly string[] }).PMID.length,
    );
    expect(sizes).toEqual([200, 200, 50]);
    expect(
      (calls[0]?.identifier as { PMID: readonly string[] }).PMID.slice(0, 2),
    ).toEqual(["1000", "1001"]);
    expect(result.translated).toHaveLength(450);
    // Matched by the PMID on the saved item, not by position.
    expect(result.translated[449]?.item.id).toBe(1449);
  });

  it("matches a batch's items by PMID, read from extra when the type has no PMID field, and falls back the members it did not return", async () => {
    const { createSearch } = fakeSearches(() => ({
      items: [fakeItem(1, { extra: "PMID: 22\nother: x" })],
    }));
    const result = await runLookup(
      [work("a", { pmid: "11" }), work("b", { pmid: "22" })],
      { createSearch },
    );
    expect(result.translated.map((t) => t.work.workKey)).toEqual(["test:b"]);
    expect(result.fallbacks).toEqual([
      {
        work: expect.objectContaining({ workKey: "test:a" }),
        reason: "no-result",
      },
    ]);
  });

  it("routes a PMCID-only record through the PMCID resolver first, and never hands a PMCID to setIdentifier", async () => {
    const resolvePmcids = vi.fn((_pmcids: readonly string[]) =>
      Promise.resolve(
        new Map([
          ["PMC1", { pmid: "501" }],
          ["PMC2", { doi: "10.1/two" }],
        ]),
      ),
    );
    const { calls, createSearch } = fakeSearches((identifier) =>
      "PMID" in identifier
        ? { items: [fakeItem(501, { PMID: "501" })] }
        : { items: [fakeItem(2)] },
    );
    const result = await runLookup(
      [
        work("one", { pmcid: "PMC1" }),
        work("two", { pmcid: "PMC2" }),
        work("three", { pmcid: "PMC3" }),
      ],
      { createSearch, resolvePmcids },
    );

    expect(resolvePmcids).toHaveBeenCalledTimes(1);
    expect(resolvePmcids.mock.calls[0]?.[0]).toEqual(["PMC1", "PMC2", "PMC3"]);
    const sent = calls.map((call) => JSON.stringify(call.identifier));
    expect(sent).toEqual(['{"DOI":"10.1/two"}', '{"PMID":["501"]}']);
    expect(sent.join()).not.toMatch(/PMC/u);
    expect(result.translated.map((t) => t.work.workKey)).toEqual([
      "test:one",
      "test:two",
    ]);
    // Unresolved: straight to Strategy A, with no lookup attempt.
    expect(result.fallbacks).toEqual([
      {
        work: expect.objectContaining({ workKey: "test:three" }),
        reason: "no-identifier",
      },
    ]);
  });

  it("sends a PMCID-only record straight to Strategy A when no PMCID route is configured", async () => {
    const { createSearch } = fakeSearches(() => ({ items: [fakeItem(1)] }));
    const result = await runLookup([work("pmc", { pmcid: "PMC9" })], {
      createSearch,
    });
    expect(createSearch).not.toHaveBeenCalled();
    expect(result.fallbacks.map((f) => f.reason)).toEqual(["no-identifier"]);
  });

  it("falls back per record for each reason class, logs each one, and counts it", async () => {
    const logger = fakeLogger();
    const { calls, createSearch } = fakeSearches((identifier) => {
      const doi = "DOI" in identifier ? identifier.DOI : "";
      if (doi === "10.1/throws") {
        return { throws: new UpstreamServerError(503, "boom") };
      }
      if (doi === "10.1/none") return { translators: [] };
      if (doi === "10.1/empty") return { items: [] };
      if (doi === "10.1/hangs") return { hang: true };
      return { items: [fakeItem(1)] };
    });
    // The deadline's timer fires at once, so only a lookup that never settles
    // loses the race. The figure is the test's own: no document gives one.
    const delay = vi.fn(() => new Promise<void>((done) => setTimeout(done, 0)));
    const result = await runLookup(
      [
        work("ok", { doi: "10.1/ok" }),
        work("throws", { doi: "10.1/throws" }),
        work("none", { doi: "10.1/none" }),
        work("empty", { doi: "10.1/empty" }),
        work("hangs", { doi: "10.1/hangs" }),
        work("bare", {}),
      ],
      { createSearch, logger, perRecordTimeoutMs: 1, delay },
    );

    expect(result.translated.map((t) => t.work.workKey)).toEqual(["test:ok"]);
    expect(
      result.fallbacks.map((f) => [f.work.workKey, f.reason, f.code]),
    ).toEqual([
      ["test:throws", "lookup-error", "UPSTREAM_SERVER"],
      ["test:none", "no-translators", undefined],
      ["test:empty", "no-result", undefined],
      ["test:hangs", "timeout", undefined],
      ["test:bare", "no-identifier", undefined],
    ]);
    // No translator → `setTranslator` and `translate` are never reached.
    const none = calls.find(
      (call) => JSON.stringify(call.identifier) === '{"DOI":"10.1/none"}',
    );
    expect(none?.translators).toBeUndefined();
    expect(none?.options).toBeUndefined();
    // Logged once per fallback, with the reason.
    const logged = logger.warn.mock.calls.map(
      (call) => (call[1] as { reason: string }).reason,
    );
    expect(logged).toEqual([
      "no-identifier",
      "lookup-error",
      "no-translators",
      "no-result",
      "timeout",
    ]);
  });

  it("sets no deadline when no per-record timeout is configured", async () => {
    const delay = vi.fn(() => Promise.resolve());
    const { createSearch } = fakeSearches(() => ({ items: [fakeItem(1)] }));
    await runLookup([work("a", { doi: "10.1/a" })], { createSearch, delay });
    expect(delay).not.toHaveBeenCalled();
  });

  it("rethrows a cancellation instead of falling back", async () => {
    const source = createCancellationTokenSource();
    const { createSearch } = fakeSearches(() => {
      source.cancel({ kind: "user" });
      return { throws: new OperationCancelledError({ kind: "user" }) };
    });
    await expect(
      lookupThroughTranslators({
        works: [work("a", { doi: "10.1/a" }), work("b", { doi: "10.1/b" })],
        libraryID: 1,
        collectionID: 77,
        token: source.token,
        options: { createSearch, schemaReady: ready },
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("keeps every Zotero.Translate reference in code inside src/zotero/ (docs/07 §2.3, R-1)", () => {
    const outside: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(?:ts|js|mjs|xhtml)$/u.test(entry.name)) continue;
        const rel = relative(repo, path).replaceAll("\\", "/");
        if (rel.startsWith("src/zotero/")) continue;
        readFileSync(path, "utf8")
          .split("\n")
          .forEach((line, index) => {
            const code = line.trim();
            // Prose in a comment names the API; only code can call it.
            if (/^(?:\*|\/\/|\/\*)/u.test(code)) return;
            if (code.includes("Zotero.Translate")) {
              outside.push(`${rel}:${String(index + 1)}`);
            }
          });
      }
    };
    walk(resolve(repo, "src"));
    walk(resolve(repo, "addon"));
    expect(outside).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The writer
// ---------------------------------------------------------------------------

/** The importer's report, as far as the writer reads it. */
function fakeReport(works: readonly CanonicalWork[], viaTranslators: number) {
  return {
    collection: { libraryID: 1, key: "COLL" },
    collectionCreated: true,
    created: works.length,
    linkedExisting: 0,
    skipped: 0,
    failed: [],
    abstractCoverage: { withAbstract: works.length },
    importPaths: {
      translatorsRequested: viaTranslators > 0,
      viaTranslators,
      handMapped: works.length - viaTranslators,
      fellBack: works.length - viaTranslators,
      fallbackReasons: {
        "no-identifier": works.length - viaTranslators,
        "lookup-error": 0,
        "no-translators": 0,
        "no-result": 0,
        timeout: 0,
      },
      searches: viaTranslators,
    },
  };
}

async function importFifty(
  readUseTranslators: (() => boolean) | undefined,
  logger?: Logger,
) {
  const works = Array.from({ length: 50 }, (_, i) =>
    work(`w${String(i)}`, { doi: `10.1/w${String(i)}` }),
  );
  const token = createCancellationTokenSource().token;
  const writer = createZoteroSearchImportWriter({
    ...(readUseTranslators !== undefined && { readUseTranslators }),
    ...(logger !== undefined && { logger }),
  });
  const session = await writer.openTarget({ collectionName: "C" }, token);
  for (let start = 0; start < works.length; start += 10) {
    await session.writeBatch(works.slice(start, start + 10), token);
  }
  return works;
}

describe("the writer reads useTranslators once, at WritingItems' entry (docs/07 §12.1)", () => {
  afterEach(() => {
    setPrefStore(undefined);
    importWorksMock.mockReset();
  });

  it("reads the preference exactly once across a 50-record import, through a spying PrefStore", async () => {
    const store = createMemoryPrefStore({ useTranslators: true });
    const get = vi.spyOn(store, "get");
    setPrefStore(store);
    importWorksMock.mockImplementation((request: { works: CanonicalWork[] }) =>
      Promise.resolve(fakeReport(request.works, request.works.length)),
    );

    await importFifty(undefined);

    const reads = get.mock.calls.filter(([key]) => key === "useTranslators");
    expect(reads).toHaveLength(1);
    // One openTarget call and five batches, each batch carrying Strategy B.
    const batches = importWorksMock.mock.calls.slice(1);
    expect(batches).toHaveLength(5);
    for (const [request] of batches) {
      expect(request).toHaveProperty("translatorLookup");
    }
  });

  it("does not read the preference before the first batch", async () => {
    const read = vi.fn(() => false);
    importWorksMock.mockImplementation((request: { works: CanonicalWork[] }) =>
      Promise.resolve(fakeReport(request.works, 0)),
    );
    const writer = createZoteroSearchImportWriter({ readUseTranslators: read });
    await writer.openTarget(
      { collectionName: "C" },
      createCancellationTokenSource().token,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("passes the importer no translator option at all when the preference is off", async () => {
    importWorksMock.mockImplementation((request: { works: CanonicalWork[] }) =>
      Promise.resolve(fakeReport(request.works, 0)),
    );
    const logger = fakeLogger();
    await importFifty(() => false, logger);

    for (const [request] of importWorksMock.mock.calls) {
      expect(Object.keys(request as object)).not.toContain("translatorLookup");
    }
    // The off path logs no import-path counts either.
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("sums the per-run import-path counts over the run's batches", async () => {
    let batch = 0;
    importWorksMock.mockImplementation(
      (request: { works: CanonicalWork[] }) => {
        if (request.works.length === 0) {
          return Promise.resolve(fakeReport([], 0));
        }
        batch += 1;
        // 7 through translators in each batch of 10, 3 hand-mapped.
        return Promise.resolve(fakeReport(request.works, batch > 0 ? 7 : 0));
      },
    );
    const logger = fakeLogger();
    await importFifty(() => true, logger);

    const last = (logger.info as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(last?.[1]).toMatchObject({
      viaTranslators: 35,
      handMapped: 15,
      fellBack: 15,
      "no-identifier": 15,
      searches: 35,
    });
  });

  it("hands each batch's own path counts to the pipeline when the preference is on (item 212)", async () => {
    importWorksMock.mockImplementation((request: { works: CanonicalWork[] }) =>
      Promise.resolve(fakeReport(request.works, 7)),
    );
    const writer = createZoteroSearchImportWriter({
      readUseTranslators: () => true,
    });
    const token = createCancellationTokenSource().token;
    const session = await writer.openTarget({ collectionName: "C" }, token);
    const works = Array.from({ length: 10 }, (_, i) =>
      work(`b${String(i)}`, { doi: `10.1/b${String(i)}` }),
    );
    const first = await session.writeBatch(works, token);
    const second = await session.writeBatch(works, token);
    // Per batch, not cumulative: the pipeline's `accumulate` sums them.
    for (const result of [first, second]) {
      expect(result.importPaths).toStrictEqual({
        viaTranslators: 7,
        handMapped: 3,
        fallbackReasons: {
          "no-identifier": 3,
          "lookup-error": 0,
          "no-translators": 0,
          "no-result": 0,
          timeout: 0,
        },
      });
    }
  });

  it("hands the pipeline no path counts at all when the preference is off (item 212)", async () => {
    importWorksMock.mockImplementation((request: { works: CanonicalWork[] }) =>
      Promise.resolve(fakeReport(request.works, 0)),
    );
    const writer = createZoteroSearchImportWriter({
      readUseTranslators: () => false,
    });
    const token = createCancellationTokenSource().token;
    const session = await writer.openTarget({ collectionName: "C" }, token);
    const result = await session.writeBatch([work("off", {})], token);
    expect(Object.keys(result)).not.toContain("importPaths");
    expect(result.created).toBe(1);
  });

  it("adds two path reports field by field", () => {
    const a = fakeReport([work("a", {}), work("b", {})], 1).importPaths;
    const sum = addPathTotals(a, a);
    expect(sum.viaTranslators).toBe(2);
    expect(sum.fallbackReasons["no-identifier"]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. The strings
// ---------------------------------------------------------------------------

describe("the preference's strings (P2-T18 step 11; docs/01 §6.3 item 3)", () => {
  const enUS = readFileSync(
    resolve(repo, "addon/locale/en-US/research-helper-mainWindow.ftl"),
    "utf8",
  );
  const koKR = readFileSync(
    resolve(repo, "addon/locale/ko-KR/research-helper-mainWindow.ftl"),
    "utf8",
  );

  it("labels the checkbox with docs/01 §6.3 item 3's wording and says in its tooltip that the path is slower", () => {
    const block =
      /^research-helper-prefs-use-translators =\n((?: {4}.*\n)+)/mu.exec(
        enUS,
      )?.[1];
    expect(block).toBeDefined();
    expect(block).toContain(
      "    .label = Fetch metadata through Zotero translators (slower, more accurate)\n",
    );
    expect(block).toMatch(/^ {4}\.tooltiptext = .*\btakes longer\b/mu);
  });

  it("declares the import-path messages in en-US with their placeables", () => {
    expect(enUS).toMatch(
      /^research-helper-import-paths = .*\{ \$translated \}.*\{ \$handMapped \}$/mu,
    );
    for (const cause of [
      "lookup-error",
      "no-translators",
      "no-result",
      "timeout",
      "no-identifier",
    ]) {
      expect(enUS).toMatch(
        new RegExp(`\\[${cause}\\] .*\\{ \\$count \\}`, "u"),
      );
    }
  });

  it("carries every new id as a live, owner-reviewed ko-KR entry on KO_PRESENT (gate G-41, 2026-10-16)", () => {
    // Until 2026-10-16 these were commented NEEDS REVIEW stubs on
    // `KO_PENDING_REVIEW`; the owner reviewed the Korean that day and the
    // coordinator made all three live (`plan/00` §6 item 218).
    for (const id of [
      "research-helper-import-paths",
      "research-helper-import-fallback-reason",
      "research-helper-prefs-use-translators",
    ] as const) {
      expect(koKR).toMatch(new RegExp(`^${id} =`, "mu"));
      expect(KO_PRESENT).toContain(id);
      expect(KO_PENDING_REVIEW).not.toContain(id);
    }
  });
});
