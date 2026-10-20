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
 * Items 213 and 214 (owner, 2026-10-19) add two specs: the PMCID route runs
 * the real NCBI ID Converter code over a **fake `HttpClient`**, so it sends
 * nothing, and the late-save measurement uses a fake translator that saves
 * after its own short deadline. Neither turns Strategy B on for any other
 * spec: each passes its own writer or `translatorLookup`.
 *
 * Item 227 (owner, 2026-10-20) turns the late-save measurement into an
 * assertion — the late copy goes to the Zotero trash, and no other item is
 * touched — and adds two PMID-batch specs for the scaled deadline. Item 229:
 * the whole suite now runs against a refusing `Zotero.Translate.Search` stub
 * (`../_suite-guards.spec.ts`); the R-1 check reaches the real constructor
 * only through `withRealTranslateSearch`.
 *
 * Fixtures are erased in `after()`, as `importer.spec.ts` erases its own.
 */

import type { HttpClient } from "../../../src/core/http/client";
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
import { withRealTranslateSearch } from "../support/translateSearchGuard";

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
    /** The PMCID a `pmcidOnly` work carries; `PMC9100001` by default. */
    pmcid?: string;
    /** Makes the work PMID-only, with this PMID (item 227's batch specs). */
    pmidOnly?: string;
  } = {},
): CanonicalWork {
  const doi = doiOrThrow(`${DOI_PREFIX}${slug}`);
  return {
    workKey: `doi:${doi}`,
    ids:
      options.pmidOnly !== undefined
        ? ({ pmid: options.pmidOnly } as CanonicalWork["ids"])
        : options.pmcidOnly === true
          ? ({ pmcid: options.pmcid ?? "PMC9100001" } as CanonicalWork["ids"])
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

/** The regular items in a collection, by id. */
function collectionItemIDs(libraryId: number, key: string): number[] {
  const collection = Zotero.Collections.getByLibraryAndKey(libraryId, key);
  if (!collection) return [];
  return collection.getChildItems(true) as unknown as number[];
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

type RecordingLogger = Logger & {
  infos: Record<string, unknown>[];
  warns: { msg: string; ctx: Record<string, unknown> | undefined }[];
};

function recordingLogger(): RecordingLogger {
  const infos: Record<string, unknown>[] = [];
  const warns: RecordingLogger["warns"] = [];
  const logger = {
    infos,
    warns,
    child: () => logger,
    error: () => undefined,
    warn: (msg: string, ctx?: Record<string, unknown>) => {
      warns.push({ msg, ctx });
    },
    info: (_msg: string, ctx?: Record<string, unknown>) => {
      if (ctx !== undefined) infos.push(ctx);
    },
    debug: () => undefined,
    time: <T>(_msg: string, fn: () => Promise<T>) => fn(),
  };
  return logger as unknown as RecordingLogger;
}

/** The warn line item 227's trash step logs, once it has run. */
function trashLog(logger: RecordingLogger) {
  return logger.warns.find((line) => line.msg.includes("Zotero trash"));
}

/** Poll until `done()` or `ms` pass; the platform's own timer. */
async function waitFor(done: () => boolean, ms: number): Promise<void> {
  const from = Date.now();
  while (!done() && Date.now() - from < ms) {
    await Zotero.Promise.delay(100);
  }
}

/**
 * A slow `Translate.Search` that saves, as `translate()` does, `delayMs`
 * after it is asked: one item per DOI, or one per PMID of a batch (the PMID
 * written as an `extra` line, which `pmidOfItem` reads). Every save is listed
 * in `saved`.
 */
function slowSavingSearches(
  delayMs: (identifier: TranslatorIdentifier) => number,
) {
  const saved: number[] = [];
  const createSearch = (): TranslatorSearch => {
    let asked: TranslatorIdentifier | undefined;
    return {
      setIdentifier(identifier) {
        asked = identifier;
      },
      getTranslators: () => Promise.resolve(["fake-slow"]),
      setTranslator: () => undefined,
      async translate(options: TranslateOptions) {
        const identifier = asked ?? { DOI: "" };
        await Zotero.Promise.delay(delayMs(identifier));
        const pmids =
          "PMID" in identifier ? [identifier.PMID].flat() : [undefined];
        const items: Zotero.Item[] = [];
        for (const pmid of pmids) {
          const item = new Zotero.Item("journalArticle");
          item.libraryID = options.libraryID;
          item.setField("title", "As the slow translator spelled it");
          if (pmid !== undefined) item.setField("extra", `PMID: ${pmid}`);
          if (options.collections !== false) {
            item.setCollections(options.collections);
          }
          await item.saveTx();
          writtenItemIDs.add(item.id);
          saved.push(item.id);
          items.push(item);
        }
        return items;
      },
    };
  };
  return { saved, createSearch };
}

/** True when the item exists and is in the trash — moved, not erased. */
function inTrash(itemID: number): boolean {
  const item = Zotero.Items.get(itemID);
  return item !== false && item.deleted;
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

  it("resolves a PMCID-only record through the NCBI ID Converter over a fake client, looks up its DOI, and hand-maps the PMCID it did not resolve (item 214)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const token = createCancellationTokenSource().token;
    const { lookups, createSearch } = savingSearches("journalArticle");
    const resolvedDoi = doiOrThrow(`${DOI_PREFIX}pmc-resolved`);
    // A fake client, so no request leaves Zotero: the real converter runs
    // over it. The body has `docs/02` §3.7's documented record shape with a
    // fixture DOI; PMC9100012 is absent from it, so it does not resolve.
    const urls: string[] = [];
    const http: HttpClient = {
      request(_method, url) {
        urls.push(url);
        return Promise.resolve({
          status: 200,
          url,
          body: JSON.stringify({
            status: "ok",
            records: [
              {
                doi: resolvedDoi,
                pmcid: "PMC9100011",
                pmid: 9100011,
                "requested-id": "PMC9100011",
              },
            ],
          }),
          rawHeaders: "",
          header: () => undefined,
        });
      },
    };
    const writer = createZoteroSearchImportWriter({
      readUseTranslators: () => true,
      http,
      translatorLookup: { createSearch },
    });
    const session = await writer.openTarget(
      {
        collectionName: collectionName("pmcid-route"),
        duplicatePolicy: "import-anyway",
      },
      token,
    );
    rememberCollection(session.libraryId, session.collectionKey);
    const batch = await session.writeBatch(
      [
        makeWork("pmc-resolved", { pmcidOnly: true, pmcid: "PMC9100011" }),
        makeWork("pmc-unresolved", { pmcidOnly: true, pmcid: "PMC9100012" }),
      ],
      token,
    );
    for (const id of collectionItemIDs(
      session.libraryId,
      session.collectionKey,
    )) {
      writtenItemIDs.add(id);
    }

    assert.strictEqual(urls.length, 1, "one converter request for both");
    const asked = new URL(urls[0] ?? "").searchParams;
    assert.strictEqual(asked.get("ids"), "PMC9100011,PMC9100012");
    assert.strictEqual(asked.get("idtype"), "pmcid");
    assert.strictEqual(lookups.length, 1, "one lookup, for the resolved DOI");
    assert.deepEqual(lookups[0]?.identifier, { DOI: resolvedDoi });
    assert.strictEqual(batch.created, 2);
    assert.strictEqual(batch.importPaths?.viaTranslators, 1);
    assert.strictEqual(batch.importPaths?.handMapped, 1);
    assert.strictEqual(
      batch.importPaths?.fallbackReasons["no-identifier"],
      1,
      "the unresolved PMCID is hand-mapped without a lookup",
    );
  });

  it("moves the copy a lookup saves after its deadline to the Zotero trash, and touches no other item (item 227; was item 213's open risk)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // Figures of the test's own, so the measurement takes seconds; the
    // shipped deadline is 30 s and the mechanism is the same. The margin
    // between the in-time save and the deadline is wide on purpose: the
    // suite is load-sensitive, and a lookup that loses the race is trashed.
    const DEADLINE_MS = 1000;
    const LATE_MS = 3000;
    const name = collectionName("late-save");
    // An item already in the collection before the run, made by another
    // path (the hand-mapped importer): it must stay untouched.
    const before = await runImport({
      works: [makeWork("late-existing")],
      collectionName: name,
      duplicatePolicy: "import-anyway",
    });
    const existingID = before.createdItemIDs[0] ?? -1;

    const lateDoi = doiOrThrow(`${DOI_PREFIX}late-save`);
    const { saved, createSearch } = slowSavingSearches((identifier) =>
      "DOI" in identifier && identifier.DOI === lateDoi ? LATE_MS : 0,
    );
    const logger = recordingLogger();
    const report = await runImport({
      works: [makeWork("late-in-time"), makeWork("late-save")],
      collectionName: name,
      duplicatePolicy: "import-anyway",
      translatorLookup: {
        createSearch,
        perRecordTimeoutMs: DEADLINE_MS,
        logger,
      },
    });
    const { libraryID, key } = report.collection;
    const atReturn = collectionItemIDs(libraryID, key).length;
    const savesAtReturn = saved.length;
    const [inTimeID = -1, handMappedID = -1] = report.createdItemIDs;

    await waitFor(() => trashLog(logger) !== undefined, 4 * LATE_MS);
    const lateID = saved.find((id) => id !== inTimeID) ?? -1;
    const later = collectionItemIDs(libraryID, key);
    debug(
      `${LOG_PREFIX} item 227 late save: ${String(atReturn)} item(s) when the ` +
        `import returned, ${String(saved.length - savesAtReturn)} late save, ` +
        `${String(later.length)} outside the trash after it settled; late ` +
        `item in trash: ${String(inTrash(lateID))}`,
    );

    assert.deepEqual(report.createdVia, ["translator", "hand-map"]);
    assert.strictEqual(report.importPaths.fallbackReasons.timeout, 1);
    assert.strictEqual(savesAtReturn, 1, "only the in-time save at return");
    assert.strictEqual(atReturn, 3, "existing + in-time + hand-mapped");
    assert.strictEqual(saved.length, 2, "the abandoned lookup still saved");
    // The late copy: moved to the trash, not erased.
    assert.isTrue(Zotero.Items.get(lateID) !== false, "the late item exists");
    assert.isTrue(inTrash(lateID), "the late item is in the trash");
    // Nothing else touched.
    for (const [label, id] of [
      ["existing", existingID],
      ["in-time translator item", inTimeID],
      ["hand-mapped copy", handMappedID],
    ] as const) {
      assert.isTrue(
        Zotero.Items.get(id) !== false && !inTrash(id),
        `${label} stays out of the trash`,
      );
    }
    assert.deepEqual(
      [...later].sort((a, b) => a - b),
      [existingID, inTimeID, handMappedID].sort((a, b) => a - b),
      "the collection holds exactly what it held when the import returned",
    );
    assert.deepEqual(trashLog(logger)?.ctx, { saved: 1, trashed: 1 });
  });

  it("gives a PMID batch 30 s + 1 s per PMID in the real platform: a two-PMID batch slower than the per-record deadline still lands (item 227)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // Per-record 500 ms; the batch of 2 gets 500 + 2 × 1000 = 2500 ms. The
    // fake answers after 1200 ms: too slow for one record, in time for two.
    const { saved, createSearch } = slowSavingSearches(() => 1200);
    const report = await runImport({
      works: [
        makeWork("pmid-a", { pmidOnly: "91000001" }),
        makeWork("pmid-b", { pmidOnly: "91000002" }),
      ],
      collectionName: collectionName("pmid-batch"),
      duplicatePolicy: "import-anyway",
      translatorLookup: { createSearch, perRecordTimeoutMs: 500 },
    });
    assert.strictEqual(report.importPaths.searches, 1, "one batch lookup");
    assert.deepEqual(report.createdVia, ["translator", "translator"]);
    assert.strictEqual(report.importPaths.fallbackReasons.timeout, 0);
    assert.strictEqual(saved.length, 2);
  });

  it("moves every item a late PMID batch saved to the Zotero trash, and keeps both hand-mapped copies (item 227)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // Batch deadline 50 + 2 × 1000 = 2050 ms; the fake answers at 3000 ms.
    const LATE_MS = 3000;
    const { saved, createSearch } = slowSavingSearches(() => LATE_MS);
    const logger = recordingLogger();
    const report = await runImport({
      works: [
        makeWork("pmid-late-a", { pmidOnly: "91000011" }),
        makeWork("pmid-late-b", { pmidOnly: "91000012" }),
      ],
      collectionName: collectionName("pmid-late"),
      duplicatePolicy: "import-anyway",
      translatorLookup: { createSearch, perRecordTimeoutMs: 50, logger },
    });
    assert.deepEqual(report.createdVia, ["hand-map", "hand-map"]);
    assert.strictEqual(report.importPaths.fallbackReasons.timeout, 2);

    await waitFor(() => trashLog(logger) !== undefined, 4 * LATE_MS);
    const { libraryID, key } = report.collection;
    assert.strictEqual(saved.length, 2, "the late batch saved two items");
    for (const id of saved) {
      assert.isTrue(Zotero.Items.get(id) !== false, "moved, not erased");
      assert.isTrue(inTrash(id), "the late item is in the trash");
    }
    for (const id of report.createdItemIDs) {
      assert.isTrue(!inTrash(id), "a hand-mapped copy stays");
    }
    assert.deepEqual(
      [...collectionItemIDs(libraryID, key)].sort((a, b) => a - b),
      [...report.createdItemIDs].sort((a, b) => a - b),
    );
    assert.deepEqual(trashLog(logger)?.ctx, { saved: 2, trashed: 2 });
  });

  it("still finds the four Translate.Search calls Strategy B uses on this Zotero (R-1), without calling any", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // The suite guard (`../_suite-guards.spec.ts`) keeps the global a
    // refusing stub; this check asks for the real constructor by name.
    const types = withRealTranslateSearch(
      "R-1 API-surface check: constructs one search object, calls nothing",
      (RealSearch) => {
        const search = new RealSearch() as Record<string, unknown>;
        return Object.fromEntries(
          ["setIdentifier", "getTranslators", "setTranslator", "translate"].map(
            (method) => [method, typeof search[method]],
          ),
        );
      },
    );
    for (const [method, type] of Object.entries(types)) {
      assert.strictEqual(type, "function", method);
    }
    assert.strictEqual(Object.keys(types).length, 4);
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
