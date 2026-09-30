/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T13`: existing-item detection by DOI and PMID, against a real Zotero
 * library.
 *
 * **Why every criterion is an integration criterion.** The card's five
 * assertions are all about the *platform*, not about a pure function:
 *
 * - that `Zotero.Search` returns an item whose PMID is in the **native** field
 *   and an item whose PMID is only in `extra`;
 * - that a **trashed** item is not returned;
 * - that a DOI stored in one casing is found by a lookup in another;
 * - that building the index issues **one** search over a large library, not one
 *   per candidate.
 *
 * A fake `Zotero.Search` could be made to report any of those, which is exactly
 * what `docs/13` §2.1 means by "a fake that lies is worse than no fake". So the
 * library is really written, really trashed, and really searched — and the
 * search count is measured by instrumenting `Zotero.Search.prototype.search`
 * rather than by trusting the module's own {@link LibraryIndexStats.searchCount}.
 *
 * The runner gives Zotero a temporary data directory that it empties before
 * every run (`docs/13` §2.3), so nothing here touches a real library. Items
 * written by earlier spec files in the same run *are* present, which is why
 * every fixture identifier below is namespaced to this card.
 *
 * Sandbox caveats (`docs/01` §2.3, measured `P0-T08`): no `performance`, no
 * `console`, no `AbortController` — `Date.now()` is the clock and `debug()` is
 * the log.
 */

import { type Doi, normalizeDoi, normalizePmid } from "../../../src/model/ids";
import { parseExtra } from "../../../src/zotero/extraField";
import {
  type LibraryIndex,
  buildLibraryIndex,
  findExistingByFlatSearches,
} from "../../../src/zotero/libraryIndex";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface MochaContext {
  timeout(ms: number): void;
  /**
   * Added 2026-09-30 for the opt-in 10 000-item test. Mocha has always had it;
   * this file (like every other integration spec) declares its own minimal
   * `MochaContext` because the scaffold injects the globals at run time and ships
   * no typings for them. Each spec carrying its own copy is a small duplication
   * worth collapsing into one shared declaration eventually.
   */
  skip(): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isUndefined(value: unknown, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T13]";

// ---------------------------------------------------------------------------
// Fixtures. Every identifier is namespaced to this card so that items written
// by other spec files in the same runner run cannot collide with them.
// ---------------------------------------------------------------------------

/** Native `PMID` field, plus a DOI. */
const NATIVE_PMID = "900000001";
const NATIVE_DOI_RAW = "10.5555/rh-p1t13.native";

/** `PMID:` in `extra` only — the pre-schema-34 item `docs/01` §5.5 warns about. */
const EXTRA_PMID = "900000002";

/**
 * An `extra`-only PMID that *contains* {@link EXTRA_PMID} as a prefix.
 *
 * `extra contains "PMID: 900000002"` matches this item too, so it is the
 * fixture that proves the flat-search fallback's verifier — not its search —
 * decides.
 */
const EXTRA_PMID_SUPERSTRING = "9000000029";

/**
 * A DOI stored in the library with an **uppercase** suffix, as Semantic
 * Scholar spells it (`docs/02` §11.1) and as a translator may have saved it.
 * The lookup uses the normalized lowercase form.
 */
const UPPERCASE_DOI_RAW = "10.18653/V1/2020.ACL-MAIN.447-rh-p1t13";

/** A trashed item's DOI. `docs/02` §11.6: it must never be returned. */
const TRASHED_DOI_RAW = "10.5555/rh-p1t13.trashed";

/** A CRLF `extra` field — the trap `P1-T12` measured, through a real field. */
const CRLF_PMID = "900000005";

/** `docs/10`'s baseline library size, which `P1-T13`'s fourth criterion names. */
const LARGE_LIBRARY_ITEMS = 10_000;
/** DOI prefix for the bulk fixtures. */
const BULK_DOI_PREFIX = "10.5555/rh-p1t13.bulk.";
/** Writing 10 000 items is minutes of DB work, well past the 30 s default. */
const LARGE_LIBRARY_TIMEOUT_MS = 900_000;

/**
 * The 10 000-item test is **opt-in**, and that is a correctness fix rather than a
 * convenience (added 2026-09-30, after `P1-T13`'s report flagged it).
 *
 * The fixture leaves the library at 10 000 items for **every spec that runs after
 * this file**. `zotero-plugin.config.ts` sets `entries: ["test/integration"]` — a
 * directory, enumerated in filesystem order — so the order is an accident, not a
 * guarantee. Today `P0-T20`'s batch-import spec happens to run first and its NFR-1
 * numbers came in unchanged at 422/352/446 ms; if that order ever shifted,
 * **`P0-T20` would silently start measuring NFR-1 against a 10 000-item library**
 * and the regression would look like a real slowdown.
 *
 * Pinning the entries list was the other option and is worse: a new spec added
 * later would be silently omitted from the run. Gating the one polluting test
 * fixes the actual problem.
 *
 * The measurement itself is **already recorded** in `P1-T13`'s `Findings`: index
 * build over exactly 10 000 items in **69–72 ms with one search** (counted from a
 * patched `Zotero.Search.prototype.search`, not the module's self-report), then 200
 * `findExisting()` calls in 0–1 ms with **zero** searches. Insertion ran at ~1.26
 * ms/item. Re-take it with:
 *
 *     Zotero.Prefs.set(LARGE_LIBRARY_PREF, true, true)
 *
 * in Run JavaScript before the run, or by adding it to the scaffold's `test.prefs`.
 * **Use a throwaway profile**: the items are not cleaned up, deliberately, because
 * deleting 9 685 items is slower than the measurement it would protect.
 */
const LARGE_LIBRARY_PREF =
  "extensions.zotero.research-helper.test.largeLibrary";

const doiOrThrow = (raw: string): Doi => {
  const doi = normalizeDoi(raw);
  if (doi === null) throw new Error(`fixture DOI must normalize: ${raw}`);
  return doi;
};

const NATIVE_DOI = doiOrThrow(NATIVE_DOI_RAW);
const UPPERCASE_DOI = doiOrThrow(UPPERCASE_DOI_RAW);
const TRASHED_DOI = doiOrThrow(TRASHED_DOI_RAW);

const pmidOrThrow = (raw: string) => {
  const pmid = normalizePmid(raw);
  if (pmid === null) throw new Error(`fixture PMID must normalize: ${raw}`);
  return pmid;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ItemFixture {
  readonly title: string;
  readonly doi?: string;
  readonly pmid?: string;
  readonly extra?: string;
  readonly trashed?: boolean;
}

/**
 * Write one `journalArticle` with the given fields.
 *
 * `setField`, not `fromJSON`: the point of these fixtures is to reproduce what
 * *other* software left in the library, including the combinations `fromJSON`
 * would normalize. `docs/01` §5.2.1's hard rule 1 also forbids `fromJSON` on an
 * existing item, and a trashed fixture has to be saved twice.
 */
async function createFixture(fixture: ItemFixture): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", fixture.title);
  if (fixture.doi !== undefined) item.setField("DOI", fixture.doi);
  if (fixture.pmid !== undefined) item.setField("PMID", fixture.pmid);
  if (fixture.extra !== undefined) item.setField("extra", fixture.extra);
  await item.saveTx();
  if (fixture.trashed === true) {
    item.deleted = true;
    await item.saveTx();
  }
  return item;
}

/**
 * Build the index while counting real `Zotero.Search#search()` calls.
 *
 * The module reports its own {@link LibraryIndexStats.searchCount}; this
 * measures the same number from the platform side, so the card's fourth
 * criterion does not rest on the module's self-report. The prototype is
 * restored in a `finally`, so a failing assertion cannot leave the patch
 * installed for the rest of the run.
 */
type SearchRunner = (asTempTable?: boolean) => Promise<number[] | string>;

async function buildCountingSearches(): Promise<{
  index: LibraryIndex;
  observedSearches: number;
}> {
  const proto = Zotero.Search.prototype as unknown as { search: SearchRunner };
  const original: SearchRunner = proto.search;
  let observedSearches = 0;
  proto.search = function (this: Zotero.Search, asTempTable?: boolean) {
    observedSearches += 1;
    return original.call(this, asTempTable);
  };
  try {
    const index = await buildLibraryIndex(Zotero.Libraries.userLibraryID);
    return { index, observedSearches };
  } finally {
    proto.search = original;
  }
}

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

describe("Existing-item detection by DOI and PMID (P1-T13)", function () {
  it("finds an item by its native PMID and one that carries only a PMID: extra line", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    debug(
      `${LOG_PREFIX} globalSchemaVersion=${String(
        Zotero.Schema.globalSchemaVersion,
      )}`,
    );

    const nativeItem = await createFixture({
      title: "P1-T13 native PMID fixture",
      doi: NATIVE_DOI_RAW,
      pmid: NATIVE_PMID,
    });
    const extraItem = await createFixture({
      title: "P1-T13 extra-only PMID fixture",
      extra: `PMID: ${EXTRA_PMID}`,
    });

    // The fixture is only meaningful if Zotero left the identifier where it was
    // put. `docs/01` §5.2.1 documents an Extra → field migration for
    // `fromJSON` in *non*-strict mode; `setField` performs none, and this
    // asserts it rather than assuming it.
    assert.strictEqual(
      extraItem.getField("PMID"),
      "",
      "the extra-only fixture must have an empty native PMID field",
    );
    assert.strictEqual(
      extraItem.getField("extra"),
      `PMID: ${EXTRA_PMID}`,
      "the extra-only fixture must still carry its extra line",
    );

    const { index, observedSearches } = await buildCountingSearches();
    debug(
      `${LOG_PREFIX} indexed ${String(index.stats.itemsScanned)} items in ` +
        `${String(index.stats.elapsedMs)} ms; byDoi=${String(
          index.byDoi.size,
        )} byPmid=${String(index.byPmid.size)} ` +
        `searchCount=${String(index.stats.searchCount)} ` +
        `observedSearches=${String(observedSearches)}`,
    );

    const nativeHit = index.findExisting({ pmid: pmidOrThrow(NATIVE_PMID) });
    if (nativeHit === undefined) {
      assert.fail("an item with a native PMID field must be found");
    }
    assert.strictEqual(nativeHit.itemID, nativeItem.id, "native PMID itemID");
    assert.strictEqual(nativeHit.matchedOn, "pmid", "native PMID matchedOn");

    const extraHit = index.findExisting({ pmid: pmidOrThrow(EXTRA_PMID) });
    if (extraHit === undefined) {
      assert.fail(
        "an item carrying only `PMID: <n>` in extra must be found " +
          "(docs/01 §5.5: run both branches)",
      );
    }
    assert.strictEqual(extraHit.itemID, extraItem.id, "extra PMID itemID");
    assert.strictEqual(extraHit.matchedOn, "pmid", "extra PMID matchedOn");

    // DOI takes precedence over PMID when both are present and both hit.
    const doiHit = index.findExisting({
      doi: NATIVE_DOI,
      pmid: pmidOrThrow(EXTRA_PMID),
    });
    assert.strictEqual(
      doiHit?.matchedOn,
      "doi",
      "DOI is tried before PMID (FR-51, docs/07 §5.1 precedence)",
    );
    assert.strictEqual(doiHit?.itemID, nativeItem.id, "DOI-matched itemID");

    // An identifier nothing in the library carries.
    assert.isUndefined(
      index.findExisting({ doi: doiOrThrow("10.5555/rh-p1t13.absent") }),
      "an unknown DOI must not match",
    );
    assert.isUndefined(
      index.findExisting({}),
      "a record with no identifiers must not match",
    );
  });

  it("does not return a trashed item with a matching DOI", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const trashed = await createFixture({
      title: "P1-T13 trashed fixture",
      doi: TRASHED_DOI_RAW,
      trashed: true,
    });
    assert.isTrue(trashed.deleted, "the fixture must really be in the trash");

    const index = await buildLibraryIndex(Zotero.Libraries.userLibraryID);
    debug(
      `${LOG_PREFIX} trashed fixture itemID=${String(trashed.id)}; ` +
        `trashedSkipped=${String(index.stats.trashedSkipped)}`,
    );

    assert.isFalse(
      index.byDoi.has(TRASHED_DOI),
      "a trashed item's DOI must not be in the index (docs/02 §11.6)",
    );
    assert.isUndefined(
      index.findExisting({ doi: TRASHED_DOI }),
      "findExisting must not return a trashed item",
    );
    assert.isUndefined(
      await findExistingByFlatSearches({ doi: TRASHED_DOI }),
      "the flat-search fallback must not return a trashed item either",
    );
  });

  it("matches DOI case-insensitively across spellings", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const item = await createFixture({
      title: "P1-T13 uppercase-DOI fixture",
      doi: UPPERCASE_DOI_RAW,
    });
    assert.strictEqual(
      item.getField("DOI"),
      UPPERCASE_DOI_RAW,
      "Zotero stores the DOI verbatim; only ISBN is rewritten by setField",
    );

    const index = await buildLibraryIndex(Zotero.Libraries.userLibraryID);
    debug(
      `${LOG_PREFIX} stored "${UPPERCASE_DOI_RAW}" -> indexed as ` +
        `"${UPPERCASE_DOI}"`,
    );

    const hit = index.findExisting({ doi: UPPERCASE_DOI });
    assert.strictEqual(
      hit?.itemID,
      item.id,
      `${UPPERCASE_DOI} must match the stored ${UPPERCASE_DOI_RAW}`,
    );

    // A caller that has not normalized at all still matches: findExisting
    // re-normalizes its input. The cast is deliberate — the brand exists to
    // stop this happening in production, and this asserts the defence.
    const unnormalized = index.findExisting({
      doi: `https://doi.org/${UPPERCASE_DOI_RAW}` as Doi,
    });
    assert.strictEqual(
      unnormalized?.itemID,
      item.id,
      "findExisting re-normalizes a caller-supplied DOI",
    );

    // And through the fallback, whose search has to be case-insensitive too.
    const viaFallback = await findExistingByFlatSearches({
      doi: UPPERCASE_DOI,
    });
    assert.strictEqual(
      viaFallback?.itemID,
      item.id,
      "the flat-search fallback must find a case-variant stored DOI",
    );
  });

  it("reads a PMID out of a CRLF extra field", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const item = await createFixture({
      title: "P1-T13 CRLF extra fixture",
      extra: `Citation Key: rhP1T13\r\nPMID: ${CRLF_PMID}`,
    });
    const stored = item.getField("extra");
    debug(
      `${LOG_PREFIX} CRLF extra stored as ${JSON.stringify(stored)}; ` +
        `parsed keys=${JSON.stringify(
          parseExtra(stored).map((line) => line.key),
        )}`,
    );

    const index = await buildLibraryIndex(Zotero.Libraries.userLibraryID);
    const hit = index.findExisting({ pmid: pmidOrThrow(CRLF_PMID) });
    assert.strictEqual(
      hit?.itemID,
      item.id,
      "a PMID on the second line of a CRLF extra field must be found " +
        "(P1-T12's `[\\s\\S]*` fix; `.*` would parse every line as key-less)",
    );
  });

  it("verifies flat-search candidates instead of trusting the substring match", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const exact = await createFixture({
      title: "P1-T13 flat-search exact fixture",
      extra: `PMID: ${EXTRA_PMID}`,
    });
    const superstring = await createFixture({
      title: "P1-T13 flat-search superstring fixture",
      extra: `PMID: ${EXTRA_PMID_SUPERSTRING}`,
    });

    // `extra contains "PMID: 900000002"` returns BOTH items, because
    // `PMID: 9000000029` contains it. The fallback must still answer with the
    // exact one.
    const hit = await findExistingByFlatSearches({
      pmid: pmidOrThrow(EXTRA_PMID),
    });
    if (hit === undefined) {
      assert.fail("the flat-search fallback must find the extra-only PMID");
    }
    assert.strictEqual(hit.matchedOn, "pmid");
    assert.isFalse(
      hit.itemID === superstring.id,
      `the substring match ${String(superstring.id)} must be rejected by the ` +
        `verifier; got itemID ${String(hit.itemID)}`,
    );
    debug(
      `${LOG_PREFIX} flat-search fallback returned itemID ` +
        `${String(hit.itemID)}; exact fixture ids are ` +
        `${String(exact.id)} / first-written duplicate`,
    );

    const superstringHit = await findExistingByFlatSearches({
      pmid: pmidOrThrow(EXTRA_PMID_SUPERSTRING),
    });
    assert.strictEqual(
      superstringHit?.itemID,
      superstring.id,
      "the superstring PMID resolves to its own item",
    );

    // Native-field branch, through the fallback.
    const nativeHit = await findExistingByFlatSearches({
      pmid: pmidOrThrow(NATIVE_PMID),
    });
    assert.strictEqual(
      nativeHit?.matchedOn,
      "pmid",
      "the fallback's native-PMID branch",
    );
  });

  it("builds the index over a 10 000-item library with exactly one search", async function () {
    // Opt-in: see LARGE_LIBRARY_PREF above. Skipping is the default because this
    // test's fixture outlives it and would silently change what every later spec
    // measures.
    if (Zotero.Prefs.get(LARGE_LIBRARY_PREF, true) !== true) {
      debug(
        `[P1-T13] SKIPPED the 10 000-item test; set ${LARGE_LIBRARY_PREF} to run it ` +
          "(69-72 ms / 1 search when last measured, 2026-09-30)",
      );
      this.skip();
      return;
    }
    this.timeout(LARGE_LIBRARY_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const libraryID = Zotero.Libraries.userLibraryID;
    const before = await buildLibraryIndex(libraryID);
    const toWrite = Math.max(
      0,
      LARGE_LIBRARY_ITEMS - before.stats.itemsScanned,
    );
    debug(
      `${LOG_PREFIX} library holds ${String(
        before.stats.itemsScanned,
      )} items; writing ${String(toWrite)} more to reach ${String(
        LARGE_LIBRARY_ITEMS,
      )}`,
    );

    const writeStartedAt = Date.now();
    // One transaction, `save()` not `saveTx()` (docs/01 §5.8, §12 gotcha 12),
    // sequential because the DB is single-writer.
    await Zotero.DB.executeTransaction(async () => {
      for (let i = 0; i < toWrite; i += 1) {
        const item = new Zotero.Item("journalArticle");
        item.libraryID = libraryID;
        item.setField("title", `P1-T13 bulk fixture ${String(i)}`);
        item.setField("DOI", `${BULK_DOI_PREFIX}${String(i)}`);
        await item.save();
      }
    });
    const writeMs = Date.now() - writeStartedAt;

    const { index, observedSearches } = await buildCountingSearches();
    debug(
      `${LOG_PREFIX} wrote ${String(toWrite)} items in ${String(writeMs)} ms; ` +
        `indexed ${String(index.stats.itemsScanned)} items in ${String(
          index.stats.elapsedMs,
        )} ms ` +
        `(byDoi=${String(index.byDoi.size)}, byPmid=${String(
          index.byPmid.size,
        )}); observedSearches=${String(observedSearches)}`,
    );

    assert.isTrue(
      index.stats.itemsScanned >= LARGE_LIBRARY_ITEMS,
      `the library must hold at least ${String(
        LARGE_LIBRARY_ITEMS,
      )} indexable items; scanned ${String(index.stats.itemsScanned)}`,
    );
    assert.strictEqual(
      observedSearches,
      1,
      "building the index must issue exactly one Zotero.Search, " +
        "independent of library size (docs/02 §11.6)",
    );
    assert.strictEqual(
      index.stats.searchCount,
      observedSearches,
      "the module's self-reported search count must match the measured one",
    );

    // N candidate lookups after the build cost no searches at all —
    // `findExisting` is synchronous, so it cannot reach the database. Measured
    // here as well as typed, over a realistic 200-record run.
    const proto = Zotero.Search.prototype as unknown as {
      search: SearchRunner;
    };
    const original: SearchRunner = proto.search;
    let lookupSearches = 0;
    proto.search = function (this: Zotero.Search, asTempTable?: boolean) {
      lookupSearches += 1;
      return original.call(this, asTempTable);
    };
    let found = 0;
    const lookupStartedAt = Date.now();
    try {
      for (let i = 0; i < 200; i += 1) {
        const hit = index.findExisting({
          doi: doiOrThrow(`${BULK_DOI_PREFIX}${String(i)}`),
        });
        if (hit !== undefined) found += 1;
      }
    } finally {
      proto.search = original;
    }
    const lookupMs = Date.now() - lookupStartedAt;
    debug(
      `${LOG_PREFIX} 200 findExisting() calls: ${String(found)} hits in ` +
        `${String(lookupMs)} ms, ${String(lookupSearches)} searches`,
    );
    assert.strictEqual(
      lookupSearches,
      0,
      "findExisting must issue no searches (docs/02 §11.6: O(1) per candidate)",
    );
    assert.strictEqual(found, 200, "every bulk fixture must be found");
  });
});
