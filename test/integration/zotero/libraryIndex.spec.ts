/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T13`: existing-item detection by DOI and PMID, against a real Zotero
 * library — and `P2-T19`: the arXiv and work-key arms, and `docs/07` §6.6's
 * `fromZoteroItem` round trip.
 *
 * **Why every criterion is an integration criterion.** The cards' assertions
 * are all about the *platform*, not about a pure function:
 *
 * - that `Zotero.Search` returns an item whose PMID is in the **native** field
 *   and an item whose PMID is only in `extra`;
 * - that a **trashed** item is not returned, on any arm;
 * - that a DOI stored in one casing is found by a lookup in another;
 * - that building the index issues **one** search over a large library, not one
 *   per candidate — and still one with four maps instead of two;
 * - that a `CanonicalWork` written through `toZoteroMapping` and read back
 *   through `fromZoteroItem` from the **saved** item carries the same
 *   `workKey`, on each of `buildWorkKey`'s five arms.
 *
 * A fake `Zotero.Search` could be made to report any of those, which is exactly
 * what `docs/13` §2.1 means by "a fake that lies is worse than no fake". So the
 * library is really written, really trashed, and really searched — and the
 * search count is measured by instrumenting `Zotero.Search.prototype.search`
 * rather than by trusting the module's own {@link LibraryIndexStats.searchCount}.
 *
 * **Fixtures are findable and erased.** Every item either `describe` writes
 * carries {@link FIXTURE_TAG} and is tracked by id; each `describe`'s `after()`
 * erases what it wrote and then searches the tag — live and trashed — to prove
 * nothing is left, logging both counts. The one exception is `P1-T13`'s opt-in
 * 10 000-item test, whose fixtures are deliberately not cleaned up (see
 * {@link LARGE_LIBRARY_PREF}). Items written by earlier spec files in the same
 * run *are* present, which is why every fixture identifier below is namespaced
 * to its card.
 *
 * Sandbox caveats (`docs/01` §2.3, measured `P0-T08`): no `performance`, no
 * `console`, no `AbortController` — `Date.now()` is the clock and `debug()` is
 * the log.
 */

import {
  isCanonicalWork,
  type CanonicalWork,
} from "../../../src/model/canonicalWork";
import {
  buildWorkKey,
  normalizeArxivId,
  normalizeDoi,
  normalizePmid,
  type ArxivId,
  type Doi,
  type Pmid,
  type S2CorpusId,
} from "../../../src/model/ids";
import {
  parseExtra,
  readWorkKey,
  RH_WORK_KEY,
} from "../../../src/zotero/extraField";
import {
  fromZoteroItem,
  toZoteroMapping,
  type ZoteroItemJSON,
} from "../../../src/zotero/itemMapper";
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
declare function after(body: (this: MochaContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isUndefined(value: unknown, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T13]";
const LOG_PREFIX_T19 = "[P2-T19]";

/**
 * The automatic tag on every fixture this file writes, so leftovers can be
 * found again by a tag search whatever else happened to the tracked ids.
 */
const FIXTURE_TAG = "rh-test-libraryIndex-spec";

// ---------------------------------------------------------------------------
// P1-T13 fixtures. Every identifier is namespaced to this card so that items
// written by other spec files in the same runner run cannot collide with them.
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

// ---------------------------------------------------------------------------
// P2-T19 fixtures.
// ---------------------------------------------------------------------------

/** A `preprint` item's native `archiveID`, as `docs/07` §6.2 writes it. */
const ARXIV_NATIVE = "2510.01419";
/** An `arXiv:` line in a `journalArticle`'s `extra`, stored **with** a version. */
const ARXIV_EXTRA = "2510.01420";
/** The arXiv id of the arXiv-only round-trip work. */
const ARXIV_ROUNDTRIP = "2510.01421";
/** The precedence fixture's arXiv id — distinct from {@link ARXIV_EXTRA}, which test 1 also stores: `keepFirst` would otherwise answer with test 1's item. */
const ARXIV_PRECEDENCE = "2510.01423";
/** An arXiv id nothing in the library carries. */
const ARXIV_ABSENT = "2510.01499";
/** The S2 corpus id of the S2-only work — the record only `rh-work-key` can match. */
const S2_ONLY = "245190019" as S2CorpusId;
/** A DOI/PMID pair for the precedence fixture. */
const PRECEDENCE_DOI_RAW = "10.5555/rh-p2t19.precedence";
const PRECEDENCE_PMID = "900000019";
/** The four-arm trashed fixture's identifiers. */
const TRASHED4_DOI_RAW = "10.5555/rh-p2t19.trashed";
const TRASHED4_PMID = "900000020";
const TRASHED4_ARXIV = "2510.01422";
const TRASHED4_WORK_KEY = "s2:rh-p2t19-trashed";
/** The build-cost fixture: how many items, and their identifier prefixes. */
const COST_ITEMS = 2_000;
const COST_DOI_PREFIX = "10.5555/rh-p2t19.cost.";
const COST_PMID_BASE = 910_000_000;
const COST_ARXIV_BASE = 10_000; // → 2510.10000 … 2510.11999
const COST_TIMEOUT_MS = 300_000;

/** Fixed clock for the round-trip works, so `accessDate` and `Citations:` are exact. */
const AT = Date.UTC(2026, 9, 14, 1, 2, 3, 456);

const doiOrThrow = (raw: string): Doi => {
  const doi = normalizeDoi(raw);
  if (doi === null) throw new Error(`fixture DOI must normalize: ${raw}`);
  return doi;
};

const NATIVE_DOI = doiOrThrow(NATIVE_DOI_RAW);
const UPPERCASE_DOI = doiOrThrow(UPPERCASE_DOI_RAW);
const TRASHED_DOI = doiOrThrow(TRASHED_DOI_RAW);
const PRECEDENCE_DOI = doiOrThrow(PRECEDENCE_DOI_RAW);
const TRASHED4_DOI = doiOrThrow(TRASHED4_DOI_RAW);

const pmidOrThrow = (raw: string): Pmid => {
  const pmid = normalizePmid(raw);
  if (pmid === null) throw new Error(`fixture PMID must normalize: ${raw}`);
  return pmid;
};

const arxivOrThrow = (raw: string): ArxivId => {
  const id = normalizeArxivId(raw);
  if (id === null) throw new Error(`fixture arXiv id must normalize: ${raw}`);
  return id;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every item id this file saved and has not yet erased. */
const createdItemIDs: number[] = [];

interface ItemFixture {
  /** Defaults to `journalArticle`. */
  readonly itemType?: "journalArticle" | "preprint";
  readonly title: string;
  readonly doi?: string;
  readonly pmid?: string;
  /** `preprint` only: `docs/07` §6.2 writes `arXiv:<id>` here. */
  readonly archiveID?: string;
  /** `preprint` only: the server name. */
  readonly repository?: string;
  readonly extra?: string;
  readonly trashed?: boolean;
}

/**
 * Write one item with the given fields.
 *
 * `setField`, not `fromJSON`: the point of these fixtures is to reproduce what
 * *other* software left in the library, including the combinations `fromJSON`
 * would normalize. `docs/01` §5.2.1's hard rule 1 also forbids `fromJSON` on an
 * existing item, and a trashed fixture has to be saved twice.
 */
async function createFixture(fixture: ItemFixture): Promise<Zotero.Item> {
  const item = new Zotero.Item(fixture.itemType ?? "journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", fixture.title);
  if (fixture.doi !== undefined) item.setField("DOI", fixture.doi);
  if (fixture.pmid !== undefined) item.setField("PMID", fixture.pmid);
  if (fixture.archiveID !== undefined) {
    item.setField("archiveID", fixture.archiveID);
  }
  if (fixture.repository !== undefined) {
    item.setField("repository", fixture.repository);
  }
  if (fixture.extra !== undefined) item.setField("extra", fixture.extra);
  item.addTag(FIXTURE_TAG, 1);
  await item.saveTx();
  createdItemIDs.push(item.id);
  if (fixture.trashed === true) {
    item.deleted = true;
    await item.saveTx();
  }
  return item;
}

/**
 * `fromJSON(json, { strict: true })` on a new item, then `saveTx()` — the
 * write half of §6.6's round trip, in the shape `itemMapper.spec.ts` uses.
 * Strict, so an invalid field is a loud `ZoteroInvalidDataError` rather than a
 * silent sweep into `extra`.
 */
async function saveMapped(json: ZoteroItemJSON): Promise<Zotero.Item> {
  const item = new Zotero.Item();
  item.libraryID = Zotero.Libraries.userLibraryID;
  try {
    item.fromJSON(json, { strict: true });
  } catch (error) {
    const name = (error as { name?: string }).name ?? "Error";
    const message = (error as { message?: string }).message ?? String(error);
    assert.fail(`fromJSON(json, {strict: true}) threw ${name}: ${message}`);
  }
  item.addTag(FIXTURE_TAG, 1);
  await item.saveTx();
  createdItemIDs.push(item.id);
  return item;
}

/** The ids of every item carrying {@link FIXTURE_TAG}, live **and** trashed. */
async function taggedItemIDs(): Promise<number[]> {
  const out = new Set<number>();
  for (const deleted of ["false", "true"] as const) {
    const search = new Zotero.Search({
      libraryID: Zotero.Libraries.userLibraryID,
    });
    search.addCondition("tag", "is", FIXTURE_TAG);
    search.addCondition("deleted", deleted, "");
    for (const id of await search.search()) out.add(id);
  }
  return [...out];
}

/**
 * Erase every tracked fixture, then find the tag again to prove the library is
 * clean. Logs both numbers. Best effort: an `after` hook that throws fails the
 * whole run, and a cleanup failure must be visible rather than fatal.
 */
async function eraseFixtures(prefix: string): Promise<void> {
  const ids = createdItemIDs.splice(0, createdItemIDs.length);
  let erased = 0;
  try {
    if (ids.length > 0) {
      await Zotero.Items.erase(ids);
      erased = ids.length;
    }
  } catch (error) {
    debug(
      `${prefix} cleanup: erase of ${String(ids.length)} item(s) threw ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const leftover = await taggedItemIDs();
  debug(
    `${prefix} cleanup erased ${String(erased)} tagged item(s); ` +
      `${String(leftover.length)} item(s) tagged "${FIXTURE_TAG}" remain`,
  );
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

/** A `journal-article` work with one author and a month-precision date. */
function workWith(
  ids: CanonicalWork["ids"],
  title: string,
  options: { readonly bare?: boolean } = {},
): CanonicalWork {
  const authors =
    options.bare === true ? [] : [{ family: "Park", given: "Jiwoo" }];
  const publishedDate =
    options.bare === true
      ? undefined
      : { year: 2023, month: 5, iso: "2023-05" };
  return {
    workKey: buildWorkKey(ids, title, publishedDate?.year, authors[0]?.family),
    ids,
    type: "journal-article",
    title,
    authors,
    ...(publishedDate === undefined ? {} : { publishedDate }),
    containerTitle: "Journal of P2-T19 Fixtures",
    provenance: {
      recordIds: ["fixture:p2t19"],
      fieldOrigin: {},
      seenIn: ["pubmed"],
    },
    normalizedAtEpochMs: AT,
  };
}

/** The same JSON with its `rh-work-key` line removed — a translator's item. */
function withoutWorkKeyLine(json: ZoteroItemJSON): ZoteroItemJSON {
  const extra = typeof json["extra"] === "string" ? json["extra"] : "";
  const kept = parseExtra(extra)
    .filter((line) => line.key?.toLowerCase() !== RH_WORK_KEY)
    .map((line) => line.raw)
    .join("\n");
  const copy: Record<string, unknown> = { ...json };
  if (kept === "") delete copy["extra"];
  else copy["extra"] = kept;
  return copy as unknown as ZoteroItemJSON;
}

// ---------------------------------------------------------------------------
// The P1-T13 spec
// ---------------------------------------------------------------------------

describe("Existing-item detection by DOI and PMID (P1-T13)", function () {
  after(async function () {
    await eraseFixtures(LOG_PREFIX);
  });

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

// ---------------------------------------------------------------------------
// The P2-T19 spec
// ---------------------------------------------------------------------------

describe("arXiv and work-key arms, and fromZoteroItem (P2-T19)", function () {
  after(async function () {
    await eraseFixtures(LOG_PREFIX_T19);
  });

  it("finds an item whose only identifier is an arXiv id, from archiveID and from an arXiv: line, with one search", async function () {
    await Zotero.Schema.schemaUpdatePromise;

    const preprint = await createFixture({
      itemType: "preprint",
      title: "P2-T19 preprint with native archiveID",
      archiveID: `arXiv:${ARXIV_NATIVE}`,
      repository: "arXiv",
    });
    assert.strictEqual(
      preprint.getField("archiveID"),
      `arXiv:${ARXIV_NATIVE}`,
      "Zotero stores archiveID verbatim",
    );
    // Stored with a version suffix, as a translator or a user may have left
    // it; the index key is the version-stripped id.
    const article = await createFixture({
      title: "P2-T19 journalArticle with arXiv: extra line",
      extra: `arXiv: ${ARXIV_EXTRA}v3`,
    });

    const { index, observedSearches } = await buildCountingSearches();
    debug(
      `${LOG_PREFIX_T19} indexed ${String(index.stats.itemsScanned)} items in ` +
        `${String(index.stats.elapsedMs)} ms; byDoi=${String(
          index.byDoi.size,
        )} byPmid=${String(index.byPmid.size)} byArxiv=${String(
          index.byArxiv.size,
        )} byWorkKey=${String(index.byWorkKey.size)} ` +
        `observedSearches=${String(observedSearches)}`,
    );
    assert.strictEqual(
      observedSearches,
      1,
      "four maps must still cost exactly one Zotero.Search (P2-T19 step 4)",
    );
    assert.strictEqual(
      index.stats.searchCount,
      observedSearches,
      "the module's self-reported search count must match the measured one",
    );

    assert.isTrue(
      index.byArxiv.has(ARXIV_NATIVE),
      "the preprint's archiveID must be indexed without its arXiv: scheme",
    );
    assert.isTrue(
      index.byArxiv.has(ARXIV_EXTRA),
      "the arXiv: extra line must be indexed without its version suffix",
    );

    // The lookup re-normalizes: scheme and version on the way in are stripped.
    const nativeHit = index.findExisting({
      arxivId: `arXiv:${ARXIV_NATIVE}v2` as ArxivId,
    });
    assert.strictEqual(nativeHit?.itemID, preprint.id, "archiveID itemID");
    assert.strictEqual(nativeHit?.matchedOn, "arxiv", "archiveID matchedOn");

    const extraHit = index.findExisting({ arxivId: arxivOrThrow(ARXIV_EXTRA) });
    assert.strictEqual(extraHit?.itemID, article.id, "arXiv: line itemID");
    assert.strictEqual(extraHit?.matchedOn, "arxiv", "arXiv: line matchedOn");

    assert.isUndefined(
      index.findExisting({ arxivId: arxivOrThrow(ARXIV_ABSENT) }),
      "an unknown arXiv id must not match",
    );
  });

  it("matches a record whose only identifier is an S2 corpus id through rh-work-key, and tries the work key last", async function () {
    await Zotero.Schema.schemaUpdatePromise;

    // Written by the plugin's own mapper: the only path that stores an S2
    // corpus id anywhere on an item, and it stores it inside `rh-work-key`.
    const s2Work = workWith({ s2CorpusId: S2_ONLY }, "P2-T19 S2-only work");
    const s2Item = await saveMapped(
      toZoteroMapping(s2Work, { accessedAtEpochMs: AT }).itemJSON,
    );
    assert.strictEqual(
      readWorkKey(s2Item.getField("extra")),
      `s2:${S2_ONLY}`,
      "the saved item must carry the s2: work key in rh-work-key",
    );
    const hashWork = workWith({}, "P2-T19 hash-arm work");
    const hashItem = await saveMapped(
      toZoteroMapping(hashWork, { accessedAtEpochMs: AT }).itemJSON,
    );
    // Identifier fixtures for the precedence assertions.
    const idItem = await createFixture({
      title: "P2-T19 precedence DOI+PMID fixture",
      doi: PRECEDENCE_DOI_RAW,
      pmid: PRECEDENCE_PMID,
    });
    const arxivItem = await createFixture({
      title: "P2-T19 precedence arXiv fixture",
      extra: `arXiv: ${ARXIV_PRECEDENCE}`,
    });
    // The key an id-less derivation would produce, stored by "the plugin".
    const emptyHashKey = buildWorkKey({}, "");
    const emptyHashItem = await createFixture({
      title: "P2-T19 empty-hash-key fixture",
      extra: `${RH_WORK_KEY}: ${emptyHashKey}`,
    });

    const index = await buildLibraryIndex(Zotero.Libraries.userLibraryID);
    assert.isTrue(
      index.byWorkKey.has(`s2:${S2_ONLY}`),
      "rh-work-key lines must populate byWorkKey",
    );
    assert.isTrue(
      index.byWorkKey.has(hashWork.workKey),
      "a hash: work key is indexed when the plugin stored it",
    );

    // Criterion 1, second half: S2-only, no workKey argument — the key is
    // derived from the ids through buildWorkKey.
    const derived = index.findExisting({ s2CorpusId: S2_ONLY });
    assert.strictEqual(derived?.itemID, s2Item.id, "S2-only itemID (derived)");
    assert.strictEqual(derived?.matchedOn, "workKey", "S2-only matchedOn");
    // And with the caller's own key.
    const explicit = index.findExisting({}, `s2:${S2_ONLY}`);
    assert.strictEqual(explicit?.itemID, s2Item.id, "S2-only itemID (given)");
    // A hash key is matched only when the caller hands it over: with no
    // identifiers and no key there is nothing to derive.
    assert.strictEqual(
      index.findExisting({}, hashWork.workKey)?.itemID,
      hashItem.id,
      "a caller-supplied hash: key is matched against stored rh-work-key lines",
    );
    assert.isUndefined(
      index.findExisting({}),
      "no identifiers and no key: nothing is derived, nothing matches",
    );
    // …even when the library holds the key such a derivation WOULD produce:
    // `buildWorkKey({}, "")` is `hash:sha1("||")`, the key of a title-less,
    // author-less, date-less item. It is indexed (the plugin stored it), the
    // caller's own key finds it, and an id-less lookup still must not. (Added
    // after a mutant removing the hash: guard survived: no item carried it.)
    assert.isTrue(
      index.byWorkKey.has(emptyHashKey),
      "the empty-hash fixture's rh-work-key is indexed",
    );
    assert.strictEqual(
      index.findExisting({}, emptyHashKey)?.itemID,
      emptyHashItem.id,
      "a caller-supplied empty-hash key is matched like any stored key",
    );
    assert.isUndefined(
      index.findExisting({ s2CorpusId: "0" as S2CorpusId }),
      "an unknown S2 corpus id must not match",
    );

    // Precedence: DOI, PMID, arXiv, then the work key (docs/07 §5.1). A record
    // carrying every identifier reports the strongest arm that hits, and the
    // work key decides only when no identifier matched anything.
    const all = index.findExisting(
      {
        doi: PRECEDENCE_DOI,
        pmid: pmidOrThrow(PRECEDENCE_PMID),
        arxivId: arxivOrThrow(ARXIV_PRECEDENCE),
        s2CorpusId: S2_ONLY,
      },
      `s2:${S2_ONLY}`,
    );
    assert.strictEqual(all?.matchedOn, "doi", "DOI outranks everything");
    assert.strictEqual(all?.itemID, idItem.id);
    const noDoi = index.findExisting({
      doi: doiOrThrow("10.5555/rh-p2t19.absent"),
      pmid: pmidOrThrow(PRECEDENCE_PMID),
      arxivId: arxivOrThrow(ARXIV_PRECEDENCE),
      s2CorpusId: S2_ONLY,
    });
    assert.strictEqual(noDoi?.matchedOn, "pmid", "PMID outranks arXiv");
    assert.strictEqual(noDoi?.itemID, idItem.id);
    const noPmid = index.findExisting({
      arxivId: arxivOrThrow(ARXIV_PRECEDENCE),
      s2CorpusId: S2_ONLY,
    });
    assert.strictEqual(noPmid?.matchedOn, "arxiv", "arXiv outranks the key");
    assert.strictEqual(noPmid?.itemID, arxivItem.id);
    // And with a caller-supplied key that WOULD hit: the arXiv arm still wins,
    // because the key is tried only after every identifier has been. (Added
    // after a mutant that swapped the two arms survived the assertions above:
    // a derived key for an arXiv record is `arxiv:<id>`, which nothing stores.)
    const keyWouldHit = index.findExisting(
      { arxivId: arxivOrThrow(ARXIV_PRECEDENCE) },
      `s2:${S2_ONLY}`,
    );
    assert.strictEqual(
      keyWouldHit?.matchedOn,
      "arxiv",
      "arXiv outranks a caller-supplied work key that would itself match",
    );
    assert.strictEqual(keyWouldHit?.itemID, arxivItem.id);
    // With a DOI present the *derived* key is the DOI arm (buildWorkKey's
    // precedence), so an S2 id beside an unknown DOI matches nothing on its
    // own: a record that has a DOI never carries an s2: work key.
    assert.isUndefined(
      index.findExisting({
        doi: doiOrThrow("10.5555/rh-p2t19.absent"),
        s2CorpusId: S2_ONLY,
      }),
      "the derived key follows buildWorkKey: DOI arm, never s2: beside a DOI",
    );
    // The caller's own key is tried only after every identifier missed.
    const onlyKey = index.findExisting(
      {
        doi: doiOrThrow("10.5555/rh-p2t19.absent"),
        arxivId: arxivOrThrow(ARXIV_ABSENT),
      },
      `s2:${S2_ONLY}`,
    );
    assert.strictEqual(
      onlyKey?.matchedOn,
      "workKey",
      "the work key is tried last, when every identifier missed",
    );
    assert.strictEqual(onlyKey?.itemID, s2Item.id);
  });

  it("round-trips the work key through a real item on all five buildWorkKey arms", async function () {
    await Zotero.Schema.schemaUpdatePromise;

    const arms: readonly {
      readonly arm: string;
      readonly work: CanonicalWork;
    }[] = [
      {
        arm: "doi",
        work: workWith(
          { doi: doiOrThrow("10.5555/rh-p2t19.roundtrip") },
          "P2-T19 round trip: DOI arm",
        ),
      },
      {
        arm: "pmid",
        work: workWith(
          { pmid: pmidOrThrow("900000021") },
          "P2-T19 round trip: PMID arm",
        ),
      },
      {
        arm: "arxiv",
        work: workWith(
          { arxivId: arxivOrThrow(ARXIV_ROUNDTRIP) },
          "P2-T19 round trip: arXiv arm",
        ),
      },
      {
        arm: "s2",
        work: workWith(
          { s2CorpusId: "245190022" as S2CorpusId },
          "P2-T19 round trip: S2 arm",
        ),
      },
      {
        arm: "hash",
        work: workWith({}, "P2-T19 round trip: hash arm"),
      },
      {
        arm: "hash (no author, no date)",
        work: workWith({}, "P2-T19 round trip: bare hash arm", {
          bare: true,
        }),
      },
    ];

    for (const { arm, work } of arms) {
      const json = toZoteroMapping(work, { accessedAtEpochMs: AT }).itemJSON;
      const item = await saveMapped(json);
      const back = fromZoteroItem(item, { nowEpochMs: AT });
      debug(
        `${LOG_PREFIX_T19} ${arm}: wrote ${work.workKey}; read back ` +
          `${back.workKey}; date(unformatted)=` +
          `${JSON.stringify(item.getField("date", true))}; ` +
          `ids=${JSON.stringify(back.ids)}`,
      );
      assert.strictEqual(
        back.workKey,
        work.workKey,
        `${arm}: toZoteroMapping -> item -> fromZoteroItem must keep the key`,
      );
      assert.isTrue(
        isCanonicalWork(back),
        `${arm}: read-back is a CanonicalWork`,
      );
      assert.strictEqual(back.title, work.title, `${arm}: title`);
      assert.strictEqual(back.type, "journal-article", `${arm}: type`);
      assert.strictEqual(back.ids.doi, work.ids.doi, `${arm}: ids.doi`);
      assert.strictEqual(back.ids.pmid, work.ids.pmid, `${arm}: ids.pmid`);
      assert.strictEqual(back.ids.arxivId, work.ids.arxivId, `${arm}: arxivId`);
      assert.strictEqual(
        back.containerTitle,
        work.containerTitle,
        `${arm}: containerTitle`,
      );
      assert.deepEqual(
        back.authors.map((a) => [a.family, a.given]),
        work.authors.map((a) => [a.family, a.given]),
        `${arm}: authors`,
      );
      assert.strictEqual(
        back.publishedDate?.year,
        work.publishedDate?.year,
        `${arm}: publishedDate.year from the multipart date`,
      );
      assert.strictEqual(
        back.publishedDate?.iso,
        work.publishedDate?.iso,
        `${arm}: publishedDate.iso keeps month precision`,
      );
      assert.deepEqual(
        [...back.provenance.seenIn],
        [...work.provenance.seenIn],
        `${arm}: seenIn from rh-sources`,
      );

      // The other half of §6.6: an item that has NO rh-work-key — a
      // translator's — must *derive* the same key, on every arm that has a
      // home on the item. The S2 arm has none (§6.2 writes s2CorpusId nowhere
      // but rh-work-key), so there the derivation falls to the hash arm, and
      // that is asserted too: it is the fact §6.6's correction is about.
      const bare = await saveMapped(withoutWorkKeyLine(json));
      assert.isUndefined(
        readWorkKey(bare.getField("extra")),
        `${arm}: the derivation fixture must carry no rh-work-key`,
      );
      const derived = fromZoteroItem(bare, { nowEpochMs: AT });
      if (arm === "s2") {
        assert.notStrictEqual(
          derived.workKey,
          work.workKey,
          "s2: without rh-work-key the key is NOT recoverable from the item",
        );
        assert.isTrue(
          derived.workKey.startsWith("hash:"),
          `s2: the derived key falls to the hash arm; got ${derived.workKey}`,
        );
      } else {
        assert.strictEqual(
          derived.workKey,
          work.workKey,
          `${arm}: fromZoteroItem must derive the written key with no rh-work-key`,
        );
      }
    }

    // And the preprint item type, read back from its native fields.
    const preprint = await createFixture({
      itemType: "preprint",
      title: "P2-T19 preprint read-back",
      archiveID: `arXiv:${ARXIV_NATIVE}`,
      repository: "arXiv",
    });
    const back = fromZoteroItem(preprint, { nowEpochMs: AT });
    assert.strictEqual(back.type, "preprint", "preprint item type");
    assert.strictEqual(back.ids.arxivId, ARXIV_NATIVE, "archiveID -> arxivId");
    assert.strictEqual(back.containerTitle, "arXiv", "repository -> container");
    assert.strictEqual(back.workKey, `arxiv:${ARXIV_NATIVE}`, "arxiv: key");
    assert.isUndefined(
      back.publishedDate,
      "no date -> publishedDate undefined",
    );
  });

  it("does not return a trashed item on any of the four arms", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const trashed = await createFixture({
      title: "P2-T19 four-arm trashed fixture",
      doi: TRASHED4_DOI_RAW,
      pmid: TRASHED4_PMID,
      extra: `arXiv: ${TRASHED4_ARXIV}\n${RH_WORK_KEY}: ${TRASHED4_WORK_KEY}`,
      trashed: true,
    });
    assert.isTrue(trashed.deleted, "the fixture must really be in the trash");

    const index = await buildLibraryIndex(Zotero.Libraries.userLibraryID);
    debug(
      `${LOG_PREFIX_T19} trashed fixture itemID=${String(trashed.id)}; ` +
        `trashedSkipped=${String(index.stats.trashedSkipped)}`,
    );
    assert.isFalse(index.byDoi.has(TRASHED4_DOI), "byDoi");
    assert.isFalse(index.byPmid.has(TRASHED4_PMID), "byPmid");
    assert.isFalse(index.byArxiv.has(TRASHED4_ARXIV), "byArxiv");
    assert.isFalse(index.byWorkKey.has(TRASHED4_WORK_KEY), "byWorkKey");
    assert.isUndefined(index.findExisting({ doi: TRASHED4_DOI }), "doi arm");
    assert.isUndefined(
      index.findExisting({ pmid: pmidOrThrow(TRASHED4_PMID) }),
      "pmid arm",
    );
    assert.isUndefined(
      index.findExisting({ arxivId: arxivOrThrow(TRASHED4_ARXIV) }),
      "arxiv arm",
    );
    assert.isUndefined(
      index.findExisting({}, TRASHED4_WORK_KEY),
      "workKey arm",
    );
  });

  it("measures the four-map build over 2 000 items with every arm populated", async function () {
    this.timeout(COST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;
    const libraryID = Zotero.Libraries.userLibraryID;

    // One transaction, `save()` not `saveTx()` (docs/01 §5.8, §12 gotcha 12).
    // Every item carries all four identifiers, so each map grows by one per
    // item and the figure is the worst case for the extra two maps.
    const writeStartedAt = Date.now();
    await Zotero.DB.executeTransaction(async () => {
      for (let i = 0; i < COST_ITEMS; i += 1) {
        const item = new Zotero.Item("journalArticle");
        item.libraryID = libraryID;
        const doi = `${COST_DOI_PREFIX}${String(i)}`;
        item.setField("title", `P2-T19 cost fixture ${String(i)}`);
        item.setField("DOI", doi);
        item.setField("PMID", String(COST_PMID_BASE + i));
        item.setField(
          "extra",
          `arXiv: 2510.${String(COST_ARXIV_BASE + i)}\n${RH_WORK_KEY}: doi:${doi}`,
        );
        item.addTag(FIXTURE_TAG, 1);
        await item.save();
        createdItemIDs.push(item.id);
      }
    });
    const writeMs = Date.now() - writeStartedAt;

    const { index, observedSearches } = await buildCountingSearches();
    const perItemUs =
      index.stats.itemsScanned === 0
        ? 0
        : Math.round((index.stats.elapsedMs * 1000) / index.stats.itemsScanned);
    debug(
      `${LOG_PREFIX_T19} wrote ${String(COST_ITEMS)} items in ${String(
        writeMs,
      )} ms; indexed ${String(index.stats.itemsScanned)} items in ${String(
        index.stats.elapsedMs,
      )} ms (${String(perItemUs)} us/item) — byDoi=${String(
        index.byDoi.size,
      )} byPmid=${String(index.byPmid.size)} byArxiv=${String(
        index.byArxiv.size,
      )} byWorkKey=${String(index.byWorkKey.size)}; ` +
        `observedSearches=${String(observedSearches)}. ` +
        `P1-T13 baseline: 10 000 items in 69-72 ms with two maps (7 us/item).`,
    );
    assert.strictEqual(observedSearches, 1, "still exactly one search");
    assert.isTrue(index.byArxiv.size >= COST_ITEMS, "byArxiv holds the batch");
    assert.isTrue(
      index.byWorkKey.size >= COST_ITEMS,
      "byWorkKey holds the batch",
    );

    // 200 lookups, 50 per arm, with zero searches.
    const proto = Zotero.Search.prototype as unknown as {
      search: SearchRunner;
    };
    const original: SearchRunner = proto.search;
    let lookupSearches = 0;
    proto.search = function (this: Zotero.Search, asTempTable?: boolean) {
      lookupSearches += 1;
      return original.call(this, asTempTable);
    };
    const hits = { doi: 0, pmid: 0, arxiv: 0, workKey: 0 };
    const lookupStartedAt = Date.now();
    try {
      for (let i = 0; i < 50; i += 1) {
        const doi = `${COST_DOI_PREFIX}${String(i)}`;
        if (index.findExisting({ doi: doiOrThrow(doi) })?.matchedOn === "doi") {
          hits.doi += 1;
        }
        if (
          index.findExisting({ pmid: pmidOrThrow(String(COST_PMID_BASE + i)) })
            ?.matchedOn === "pmid"
        ) {
          hits.pmid += 1;
        }
        if (
          index.findExisting({
            arxivId: arxivOrThrow(`2510.${String(COST_ARXIV_BASE + i)}`),
          })?.matchedOn === "arxiv"
        ) {
          hits.arxiv += 1;
        }
        if (index.findExisting({}, `doi:${doi}`)?.matchedOn === "workKey") {
          hits.workKey += 1;
        }
      }
    } finally {
      proto.search = original;
    }
    debug(
      `${LOG_PREFIX_T19} 200 findExisting() calls in ${String(
        Date.now() - lookupStartedAt,
      )} ms, ${String(lookupSearches)} searches; hits=${JSON.stringify(hits)}`,
    );
    assert.strictEqual(lookupSearches, 0, "findExisting issues no searches");
    assert.deepEqual(hits, { doi: 50, pmid: 50, arxiv: 50, workKey: 50 });
  });
});
