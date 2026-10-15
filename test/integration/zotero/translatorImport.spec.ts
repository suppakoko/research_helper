/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3); it replaces `Zotero.Translate.Search` with a spy and reads items back off the platform, which no src/zotero/ facade exposes to a spec. */
/**
 * `P2-T18`: Strategy B against a real Zotero library, with the translator seam
 * faked.
 *
 * **No live request is made, by construction.** Every lookup goes through a
 * fake `TranslatorSearch` that saves an item the way `translate()` does —
 * `new Zotero.Item`, `setCollections`, `saveTx` — and returns it; nothing here
 * constructs a real `Zotero.Translate.Search` except the one API-surface check,
 * which calls no method on it. A real translator run would be a network round
 * trip per record (`docs/01` §6.2), so it has no place in this suite; were one
 * ever added it would sit behind an opt-in environment variable that stays
 * unset, as `phase1-dod.spec.ts`'s `RH_DOD_LIVE` does.
 *
 * What is real here, and why it needs Zotero: that the hand-mapped path makes
 * no `Translate.Search` at all when the preference is off (asserted by
 * replacing the global constructor with a counting stub), that an item the
 * translator saved without an abstract has one afterwards, that a preprint's
 * server is written onto the type the translator chose, that a failed lookup
 * still leaves an item made by hand-mapping, and that the writer reads the
 * preference as the shipped `false` on a profile where nobody set it.
 *
 * Fixtures are erased in `after()`, as `importer.spec.ts` erases its own.
 */

import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import type { CanonicalWork, WorkType } from "../../../src/model/canonicalWork";
import { type Doi, normalizeDoi } from "../../../src/model/ids";
import { createZoteroSearchImportWriter } from "../../../src/bootstrap/registerPipelines";
import {
  type ImportReport,
  type ImportRequest,
  importWorks,
} from "../../../src/zotero/importer";
import type {
  TranslateOptions,
  TranslatorIdentifier,
  TranslatorSearch,
} from "../../../src/zotero/translatorImport";

interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isAtMost(value: number, ceiling: number, message?: string): void;
  fail(message: string): never;
};
declare function debug(line: string): void;

const LOG_PREFIX = "[P2-T18]";
const TEST_TIMEOUT_MS = 120_000;
/** `docs/10` NFR-1: 100 records in ≤ 10 s on the hand-mapped path. */
const NFR1_BUDGET_MS = 10_000;
const DOI_PREFIX = "10.5555/rh-p2t18.";
const ABSTRACT = "The abstract the search results carried, for the repair.";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function doiOrThrow(raw: string): Doi {
  const doi = normalizeDoi(raw);
  if (doi === null) throw new Error(`fixture DOI must normalize: ${raw}`);
  return doi;
}

function makeWork(
  slug: string,
  options: {
    type?: WorkType;
    containerTitle?: string;
    pmcidOnly?: boolean;
  } = {},
): CanonicalWork {
  const doi = doiOrThrow(`${DOI_PREFIX}${slug}`);
  return {
    workKey: `doi:${doi}`,
    ids:
      options.pmcidOnly === true
        ? ({ pmcid: "PMC9100001" } as CanonicalWork["ids"])
        : { doi },
    type: options.type ?? "journal-article",
    title: `Research Helper translator fixture ${slug} (P2-T18)`,
    abstract: ABSTRACT,
    authors: [{ family: "Hopper", given: "Grace" }],
    containerTitle: options.containerTitle ?? "Journal of Synthetic Fixtures",
    publishedDate: { year: 2026, month: 1, day: 1, iso: "2026-01-01" },
    provenance: { recordIds: [], fieldOrigin: {}, seenIn: ["crossref"] },
    normalizedAtEpochMs: Date.now(),
  };
}

function collectionName(label: string): string {
  return `Research Helper translators (P2-T18) ${label} ${String(Date.now())}`;
}

const writtenItemIDs = new Set<number>();
const writtenCollectionIDs = new Set<number>();

function record(report: ImportReport): ImportReport {
  for (const id of report.createdItemIDs) writtenItemIDs.add(id);
  if (report.collectionCreated) writtenCollectionIDs.add(report.collection.id);
  return report;
}

/** A writer session's collection, for `after()` to erase. */
function rememberCollection(libraryId: number, key: string): void {
  const collection = Zotero.Collections.getByLibraryAndKey(libraryId, key);
  if (collection) writtenCollectionIDs.add(collection.id);
}

function itemOrFail(itemID: number): Zotero.Item {
  const item = Zotero.Items.get(itemID);
  if (!item) assert.fail(`item ${String(itemID)} is not loadable`);
  return item;
}

interface FakeLookup {
  identifier: TranslatorIdentifier | undefined;
  translators: readonly unknown[] | undefined;
}

/**
 * A `Translate.Search` that saves one item per lookup, as `translate()` does,
 * with no abstract — the case `docs/01` §6.3 item 4's repair exists for.
 * `itemType` is what the "translator" chooses.
 */
function savingSearches(
  itemType: "journalArticle" | "preprint",
  behaviour: "save" | "throw" = "save",
) {
  const lookups: FakeLookup[] = [];
  const translators = ["fake-doi-cn", "fake-crossref-rest"];
  const createSearch = (): TranslatorSearch => {
    const lookup: FakeLookup = {
      identifier: undefined,
      translators: undefined,
    };
    lookups.push(lookup);
    return {
      setIdentifier(identifier) {
        lookup.identifier = identifier;
      },
      getTranslators: () => Promise.resolve(translators),
      setTranslator(list) {
        lookup.translators = list;
      },
      async translate(options: TranslateOptions) {
        if (behaviour === "throw") throw new Error("ERROR_NO_RESULTS");
        const item = new Zotero.Item(itemType);
        item.libraryID = options.libraryID;
        item.setField("title", "As the translator spelled it");
        if (options.collections !== false) {
          item.setCollections(options.collections);
        }
        await item.saveTx();
        writtenItemIDs.add(item.id);
        return [item];
      },
    };
  };
  return { lookups, translators, createSearch };
}

/** Replace the real constructor with a counting stub that refuses to run. */
async function countingTranslateSearch<T>(
  body: () => Promise<T>,
): Promise<{ value: T; constructed: number }> {
  const translate = Zotero.Translate as { Search: unknown };
  const original = translate.Search;
  let constructed = 0;
  translate.Search = function CountingSearch() {
    constructed += 1;
    throw new Error("P2-T18: Translate.Search constructed on the off path");
  };
  try {
    return { value: await body(), constructed };
  } finally {
    translate.Search = original;
  }
}

function recordingLogger(): Logger & { infos: Record<string, unknown>[] } {
  const infos: Record<string, unknown>[] = [];
  const logger = {
    infos,
    child: () => logger,
    error: () => undefined,
    warn: () => undefined,
    info: (_msg: string, ctx?: Record<string, unknown>) => {
      if (ctx !== undefined) infos.push(ctx);
    },
    debug: () => undefined,
    time: <T>(_msg: string, fn: () => Promise<T>) => fn(),
  };
  return logger as unknown as Logger & { infos: Record<string, unknown>[] };
}

async function runImport(request: ImportRequest): Promise<ImportReport> {
  return record(await importWorks(request));
}

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

describe("Translator import path behind useTranslators (P2-T18)", function () {
  it("with the preference at its shipped false, imports 100 records with zero Translate.Search objects inside NFR-1", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;
    const works = Array.from({ length: 100 }, (_, i) =>
      makeWork(`off-${String(i)}`),
    );
    const token = createCancellationTokenSource().token;
    // No `readUseTranslators`: the writer reads `getPref("useTranslators")`,
    // which is the schema default on a profile where nobody set it.
    const writer = createZoteroSearchImportWriter({});

    const startedAt = Date.now();
    const { value: created, constructed } = await countingTranslateSearch(
      async () => {
        const session = await writer.openTarget(
          { collectionName: collectionName("off") },
          token,
        );
        rememberCollection(session.libraryId, session.collectionKey);
        let total = 0;
        for (let start = 0; start < works.length; start += 50) {
          const batch = await session.writeBatch(
            works.slice(start, start + 50),
            token,
          );
          total += batch.created;
        }
        return total;
      },
    );
    const elapsedMs = Date.now() - startedAt;
    debug(
      `${LOG_PREFIX} off path: ${String(created)} created in ${String(elapsedMs)} ms, ` +
        `${String(constructed)} Translate.Search`,
    );

    // Cleanup for the writer path: find what it made by DOI prefix.
    const search = new Zotero.Search();
    search.addCondition("DOI", "contains", `${DOI_PREFIX}off-`);
    for (const id of await search.search()) writtenItemIDs.add(id);

    assert.strictEqual(constructed, 0, "no Translate.Search on the off path");
    assert.strictEqual(created, 100);
    assert.isAtMost(elapsedMs, NFR1_BUDGET_MS, "NFR-1's 10 s budget");
  });

  it("with the preference on, makes one Translate.Search for a DOI record, passes the whole translator list, and repairs the dropped abstract", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { lookups, translators, createSearch } =
      savingSearches("journalArticle");
    const report = await runImport({
      works: [makeWork("doi-on")],
      collectionName: collectionName("on"),
      duplicatePolicy: "import-anyway",
      translatorLookup: { createSearch },
    });

    assert.strictEqual(lookups.length, 1);
    assert.deepEqual(lookups[0]?.identifier, {
      DOI: doiOrThrow(`${DOI_PREFIX}doi-on`),
    });
    assert.isTrue(
      lookups[0]?.translators === translators,
      "setTranslator got the array getTranslators returned",
    );
    assert.deepEqual(report.createdVia, ["translator"]);
    assert.strictEqual(report.importPaths.viaTranslators, 1);
    assert.strictEqual(report.importPaths.searches, 1);
    const item = itemOrFail(report.createdItemIDs[0] ?? -1);
    // The translator's title stands; the missing abstract is repaired.
    assert.strictEqual(item.getField("title"), "As the translator spelled it");
    assert.strictEqual(item.getField("abstractNote"), ABSTRACT);
    assert.strictEqual(report.abstractCoverage.backfilled, 1);
    assert.isTrue(
      item.getCollections().includes(report.collection.id),
      "the item is in the target collection",
    );
  });

  it("writes a preprint's server onto the type the translator chose, and never re-maps that type", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const preprint = makeWork("pp-preprint", {
      type: "preprint",
      containerTitle: "bioRxiv",
    });
    const asPreprint = await runImport({
      works: [preprint],
      collectionName: collectionName("preprint"),
      duplicatePolicy: "import-anyway",
      translatorLookup: {
        createSearch: savingSearches("preprint").createSearch,
      },
    });
    const ppItem = itemOrFail(asPreprint.createdItemIDs[0] ?? -1);
    assert.strictEqual(ppItem.itemType, "preprint");
    assert.strictEqual(ppItem.getField("repository"), "bioRxiv");

    // A translator that says journalArticle is believed: no re-map, and no
    // `repository` (the type has none).
    const asArticle = await runImport({
      works: [
        makeWork("pp-article", { type: "preprint", containerTitle: "bioRxiv" }),
      ],
      collectionName: collectionName("preprint-article"),
      duplicatePolicy: "import-anyway",
      translatorLookup: {
        createSearch: savingSearches("journalArticle").createSearch,
      },
    });
    const jaItem = itemOrFail(asArticle.createdItemIDs[0] ?? -1);
    assert.strictEqual(jaItem.itemType, "journalArticle");
    assert.deepEqual(asArticle.createdVia, ["translator"]);
  });

  it("with the translator throwing, still imports the record by hand-mapping and reports one fallback for the run", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const token = createCancellationTokenSource().token;
    const logger = recordingLogger();
    const writer = createZoteroSearchImportWriter({
      logger,
      readUseTranslators: () => true,
      translatorLookup: {
        createSearch: savingSearches("journalArticle", "throw").createSearch,
      },
    });
    const session = await writer.openTarget(
      {
        collectionName: collectionName("fallback"),
        duplicatePolicy: "import-anyway",
      },
      token,
    );
    rememberCollection(session.libraryId, session.collectionKey);
    const batch = await session.writeBatch([makeWork("throws")], token);

    const search = new Zotero.Search();
    search.addCondition("DOI", "is", doiOrThrow(`${DOI_PREFIX}throws`));
    const ids = await search.search();
    for (const id of ids) writtenItemIDs.add(id);

    assert.strictEqual(batch.created, 1, "the record is still imported");
    assert.strictEqual(batch.failed, 0);
    const item = itemOrFail(ids[0] ?? -1);
    // Hand-mapped: the search results' title, not the translator's.
    assert.strictEqual(
      item.getField("title"),
      "Research Helper translator fixture throws (P2-T18)",
    );
    const totals = logger.infos.at(-1);
    assert.strictEqual(totals?.["fellBack"], 1);
    assert.strictEqual(totals?.["lookup-error"], 1);
    assert.strictEqual(totals?.["viaTranslators"], 0);
  });

  it("never hands a PMCID-only record to setIdentifier: without a PMCID route it is hand-mapped", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { lookups, createSearch } = savingSearches("journalArticle");
    const report = await runImport({
      works: [makeWork("pmc-only", { pmcidOnly: true })],
      collectionName: collectionName("pmcid"),
      duplicatePolicy: "import-anyway",
      translatorLookup: { createSearch },
    });
    assert.strictEqual(lookups.length, 0);
    assert.deepEqual(report.createdVia, ["hand-map"]);
    assert.strictEqual(report.importPaths.fallbackReasons["no-identifier"], 1);
  });

  it("still finds the four Translate.Search calls Strategy B uses on this Zotero (R-1), without calling any", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const Search = (Zotero.Translate as { Search: new () => object }).Search;
    const search = new Search() as Record<string, unknown>;
    for (const method of [
      "setIdentifier",
      "getTranslators",
      "setTranslator",
      "translate",
    ]) {
      assert.strictEqual(typeof search[method], "function", method);
    }
  });

  after(async function () {
    try {
      if (writtenItemIDs.size > 0) {
        await Zotero.Items.erase([...writtenItemIDs]);
      }
      for (const id of writtenCollectionIDs) {
        const collection = Zotero.Collections.get(id);
        if (collection) await collection.eraseTx();
      }
    } catch (error) {
      debug(`${LOG_PREFIX} cleanup failed (ignored): ${String(error)}`);
    }
  });
});
