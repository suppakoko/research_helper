/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T12` step 6: `toZoteroItemJSON()`'s output, fed to a real
 * `item.fromJSON(json, { strict: true })` inside a live Zotero.
 *
 * **Why this has to be an integration spec.** The mapping is pure and every
 * claim about its *content* is asserted in plain Node
 * (`test/unit/zotero/itemMapper.test.ts`). What cannot be asserted there is the
 * only claim that matters for shipping: that Zotero **accepts** the JSON.
 * `docs/01` §5.2.1: in strict mode "an unknown or invalid field throws an
 * `Error` with `e.name === \"ZoteroInvalidDataError\"` instead of being silently
 * swept into `Extra`". A unit test with a fake cannot produce that error, and
 * `docs/13` §2.1 is explicit that a fake which lies is worse than no fake.
 *
 * So this spec runs the real validator, and then reads the *saved* item back
 * through Zotero's own accessors to prove the four things the card's
 * `Done when` list asserts about a real library: the native `PMID`/`PMCID`
 * fields hold the identifiers, nothing resembling `PMID:` was written into
 * `extra`, a foreign `extra` line survives byte-for-byte, and the MeSH tags
 * are automatic.
 *
 * **Schema gating.** Every type/field lookup here is behind
 * `await Zotero.Schema.schemaUpdatePromise` (`docs/01` §5.3: `getID()` throws
 * `Zotero.Exception.UnloadedDataException` if called too early), which is the
 * same gate {@link detectNativeIdentifierFields} awaits.
 *
 * The runner gives Zotero a temporary data directory that it empties before
 * every run (`docs/13` §2.3), so nothing here touches a real library.
 *
 * Sandbox caveats (`docs/01` §2.3, measured `P0-T08`): no `performance`, no
 * `console` — `Date.now()` is the clock and `debug()` is the log.
 */

import type { CanonicalWork } from "../../../src/model/canonicalWork";
import {
  buildWorkKey,
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
} from "../../../src/model/ids";
import { parseExtra, readWorkKey } from "../../../src/zotero/extraField";
import {
  AUTOMATIC_TAG_TYPE,
  RESEARCH_HELPER_TAG,
  detectNativeIdentifierFields,
  toZoteroItemJSON,
  toZoteroMapping,
} from "../../../src/zotero/itemMapper";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isNotEmpty(value: string, message?: string): void;
  include<T>(haystack: readonly T[], needle: T, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T12]";

const DOI = normalizeDoi("https://doi.org/10.1056/NEJMoa2300709");
const PMID = normalizePmid("37258680");
const PMCID = normalizePmcid("10949956");
if (DOI === null || PMID === null || PMCID === null) {
  throw new Error("spec fixtures must normalize");
}

/** Fixed import time, so `accessDate` is predictable. */
const AT = Date.UTC(2026, 2, 7, 4, 5, 6, 789);

/**
 * A work populating every §6.2 row `journalArticle` has a field for, so strict
 * mode has the largest possible surface to reject.
 */
const RICH: CanonicalWork = {
  workKey: buildWorkKey(
    { doi: DOI, pmid: PMID },
    "A trial of something",
    2024,
    "Kim",
  ),
  ids: { doi: DOI, pmid: PMID, pmcid: PMCID },
  type: "journal-article",
  title: "A trial of something",
  abstract: "BACKGROUND: text. METHODS: more text.",
  authors: [
    { family: "Kim", given: "Minji", orcid: "0000-0002-1825-0097" },
    {
      family: "World Health Organization",
      literal: "World Health Organization",
    },
  ],
  containerTitle: "New England Journal of Medicine",
  containerAbbreviation: "N Engl J Med",
  publisher: "Massachusetts Medical Society",
  volume: "390",
  issue: "4",
  pages: "301-312",
  issn: ["0028-4793", "1533-4406"],
  publishedDate: { year: 2024, month: 1, day: 25, iso: "2024-01-25" },
  language: "en",
  subjects: [
    { term: "Neoplasms", scheme: "mesh", id: "D009369", isMajor: true },
    { term: "Machine Learning", scheme: "mesh", isMajor: false },
  ],
  keywords: ["immunotherapy"],
  citationCount: 1220,
  openAccess: { isOpenAccess: true, status: "gold", license: "CC-BY-4.0" },
  url: "https://www.nejm.org/doi/full/10.1056/NEJMoa2300709",
  provenance: {
    recordIds: ["pubmed:37258680"],
    fieldOrigin: { citationCount: "semanticscholar" },
    seenIn: ["pubmed", "semanticscholar"],
  },
  normalizedAtEpochMs: AT,
};

/**
 * `fromJSON(json, { strict: true })` on a new item, then `saveTx()`.
 *
 * `fromJSON` is a **replace, not a merge** (`docs/01` §5.2.1 hard rule 1), so
 * it is only ever called on a brand-new item — which is exactly what this does.
 * The error is re-thrown with `e.name` in the message because
 * `ZoteroInvalidDataError`'s own message names the offending field and the
 * `name` is what identifies the failure class.
 */
async function saveMapped(json: object): Promise<Zotero.Item> {
  const item = new Zotero.Item();
  item.libraryID = Zotero.Libraries.userLibraryID;
  try {
    item.fromJSON(json, { strict: true });
  } catch (error) {
    const name = (error as { name?: string }).name ?? "Error";
    const message = (error as { message?: string }).message ?? String(error);
    assert.fail(`fromJSON(json, {strict: true}) threw ${name}: ${message}`);
  }
  await item.saveTx();
  return item;
}

describe("CanonicalWork → Zotero item JSON, validated by Zotero (P1-T12)", function () {
  it("is accepted by fromJSON in strict mode and round-trips its fields", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    debug(
      `${LOG_PREFIX} globalSchemaVersion=${String(
        Zotero.Schema.globalSchemaVersion,
      )}`,
    );

    const native = await detectNativeIdentifierFields();
    debug(
      `${LOG_PREFIX} native identifier fields: PMID=${String(
        native.pmid,
      )} PMCID=${String(native.pmcid)}`,
    );

    const json = toZoteroItemJSON(RICH, {
      accessedAtEpochMs: AT,
      nativeIdentifierFields: native,
    });
    const item = await saveMapped(json);

    assert.strictEqual(
      Zotero.ItemTypes.getName(item.itemTypeID),
      "journalArticle",
      "itemType",
    );
    assert.strictEqual(item.getField("title"), "A trial of something");
    assert.strictEqual(
      item.getField("DOI"),
      "10.1056/nejmoa2300709",
      "DOI is bare and lowercase (§6.2, FR-6)",
    );
    assert.strictEqual(
      item.getField("publicationTitle"),
      "New England Journal of Medicine",
    );
    assert.strictEqual(item.getField("journalAbbreviation"), "N Engl J Med");
    assert.strictEqual(item.getField("volume"), "390");
    assert.strictEqual(item.getField("issue"), "4");
    assert.strictEqual(item.getField("pages"), "301-312");
    assert.strictEqual(item.getField("ISSN"), "0028-4793");
    assert.strictEqual(item.getField("language"), "en");
    assert.strictEqual(item.getField("rights"), "CC-BY-4.0");
    assert.strictEqual(item.getField("libraryCatalog"), "PubMed");
    assert.isNotEmpty(item.getField("date"), "date");
    assert.isNotEmpty(
      item.getField("accessDate"),
      "accessDate survived the ISO → SQL UTC conversion (docs/01 §5.3)",
    );
  });

  it("puts PMID and PMCID in the native fields, and nothing like PMID: in extra", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const native = await detectNativeIdentifierFields();
    // The shipped baseline is schema ≥ 34 (docs/07 §6.1, docs/02 §10.3). If
    // this client lacks the fields the fallback path is correct behaviour, not
    // a failure, so the branch is recorded rather than asserted away.
    if (!native.pmid || !native.pmcid) {
      debug(
        `${LOG_PREFIX} SKIPPED native-field assertions: this client has ` +
          `PMID=${String(native.pmid)} PMCID=${String(native.pmcid)}`,
      );
      return;
    }

    const item = await saveMapped(
      toZoteroItemJSON(RICH, {
        accessedAtEpochMs: AT,
        nativeIdentifierFields: native,
      }),
    );

    assert.strictEqual(item.getField("PMID"), "37258680", "native PMID");
    assert.strictEqual(item.getField("PMCID"), "PMC10949956", "native PMCID");

    const extra = item.getField("extra");
    assert.isFalse(
      /(^|\n)\s*PMID\s*:/i.test(extra),
      `extra must carry no PMID: line (conflict C2, FR-6). extra was:\n${extra}`,
    );
    assert.isFalse(
      /(^|\n)\s*PMCID\s*:/i.test(extra),
      `extra must carry no PMCID: line. extra was:\n${extra}`,
    );
    assert.strictEqual(readWorkKey(extra), RICH.workKey, "rh-work-key");
    assert.isTrue(
      extra.includes("rh-sources: pubmed,semanticscholar"),
      `rh-sources. extra was:\n${extra}`,
    );
  });

  it("preserves a foreign extra line byte-for-byte and in order", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const native = await detectNativeIdentifierFields();

    // The card's third Done-when criterion, through a real Zotero: the item is
    // created with these two lines already in `extra`, and the plugin's write
    // must not disturb them.
    const existingExtra = "Citation Key: smith2024\nPMID: 999";
    const item = await saveMapped(
      toZoteroItemJSON(RICH, {
        accessedAtEpochMs: AT,
        nativeIdentifierFields: native,
        existingExtra,
      }),
    );

    const lines = parseExtra(item.getField("extra"));
    debug(`${LOG_PREFIX} extra after write:\n${item.getField("extra")}`);
    assert.strictEqual(
      lines[0]?.raw,
      "Citation Key: smith2024",
      "the first foreign line, byte-identical and still first",
    );
    assert.strictEqual(
      lines[1]?.raw,
      "PMID: 999",
      "the second foreign line, byte-identical and still second",
    );
    assert.strictEqual(
      readWorkKey(item.getField("extra")),
      RICH.workKey,
      "rh-work-key was appended",
    );
  });

  it("writes MeSH tags as automatic, with * for major topics", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const native = await detectNativeIdentifierFields();
    const item = await saveMapped(
      toZoteroItemJSON(RICH, {
        accessedAtEpochMs: AT,
        nativeIdentifierFields: native,
      }),
    );

    const tags = item.getTags();
    assert.include(
      tags.map((tag) => tag.tag),
      "MeSH*: Neoplasms",
      "major MeSH topic carries the distinguishing prefix",
    );
    assert.include(
      tags.map((tag) => tag.tag),
      "MeSH: Machine Learning",
    );
    assert.include(
      tags.map((tag) => tag.tag),
      RESEARCH_HELPER_TAG,
    );
    for (const tag of tags) {
      assert.strictEqual(
        tag.type,
        AUTOMATIC_TAG_TYPE,
        `tag "${tag.tag}" must be automatic (type 1)`,
      );
    }
  });

  it("writes the institutional author in single-field mode", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const native = await detectNativeIdentifierFields();
    const item = await saveMapped(
      toZoteroItemJSON(RICH, {
        accessedAtEpochMs: AT,
        nativeIdentifierFields: native,
      }),
    );

    const creators = item.getCreators();
    assert.strictEqual(creators.length, 2, "both authors survived");
    assert.strictEqual(
      Zotero.CreatorTypes.getName(creators[0]!.creatorTypeID),
      "author",
    );
    assert.strictEqual(creators[0]!.firstName, "Minji");
    assert.strictEqual(creators[0]!.lastName, "Kim");
    assert.strictEqual(
      creators[1]!.fieldMode,
      1,
      "an author known only by a literal name is single-field",
    );
    assert.strictEqual(creators[1]!.lastName, "World Health Organization");
  });

  it("caps extra and hands the overflow to a child note (§6.3)", async function () {
    await Zotero.Schema.schemaUpdatePromise;
    const native = await detectNativeIdentifierFields();

    const bloated: CanonicalWork = {
      ...RICH,
      issn: [
        "0028-4793",
        ...Array.from({ length: 60 }, (_, i) => `1533-${1000 + i}`),
      ],
    };
    const mapping = toZoteroMapping(bloated, {
      accessedAtEpochMs: AT,
      nativeIdentifierFields: native,
    });
    if (mapping.overflowNote === undefined) {
      assert.fail("the bloated fixture must trip the ~500-character cap");
    }

    const item = await saveMapped(mapping.itemJSON);
    assert.strictEqual(
      item.getField("extra"),
      `rh-work-key: ${bloated.workKey}`,
      "extra carries only rh-work-key past the cap",
    );

    // The caller's half of §6.3: the deferred payload becomes a child note.
    const note = new Zotero.Item("note");
    note.libraryID = item.libraryID;
    note.setNote(mapping.overflowNote);
    note.parentID = item.id;
    await note.saveTx();

    const children = item.getNotes();
    assert.strictEqual(children.length, 1, "exactly one child note");
    // `Zotero.Items.get()` returns `false` for an id it cannot load.
    const saved = Zotero.Items.get(children[0]!);
    if (!saved) {
      assert.fail(`child note ${String(children[0])} is not loadable`);
    }
    const html = saved.getNote();
    assert.isTrue(
      html.includes("rh:extra v=1"),
      "the note carries the plugin's marker comment",
    );
    assert.isTrue(
      html.includes("rh-sources"),
      "the note carries the deferred lines",
    );
  });

  it("refuses to half-map a preprint (card Notes)", async function () {
    let threw = false;
    try {
      toZoteroItemJSON(
        { ...RICH, type: "preprint" },
        { accessedAtEpochMs: AT },
      );
    } catch {
      threw = true;
    }
    assert.isTrue(
      threw,
      "docs/07 §6.2's preprint column is Phase 2's; the gap must be loud",
    );
  });
});
