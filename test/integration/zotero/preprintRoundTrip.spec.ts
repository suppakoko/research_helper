/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P2-T08` step 6: one arXiv, one bioRxiv and one medRxiv record imported
 * through the shipped caller — `importWorks()` in `src/zotero/importer.ts`,
 * which calls `toZoteroMapping()` — into a live Zotero, with
 * `fromJSON(json, { strict: true })`, and every field read back off the saved
 * item.
 *
 * **Why inside Zotero.** The unit suite
 * (`test/unit/zotero/preprintMapping.test.ts`) proves what the JSON contains;
 * only Zotero can prove that its `preprint` type **accepts** it — that
 * `repository` and `archiveID` resolve onto their base fields (`publisher`,
 * `number`), that strict mode rejects nothing, and that a `PMID:` line in
 * `extra` is not migrated into a field the type does not have (`docs/07`
 * §6.1).
 *
 * The works are built by hand in the shape the source mappers produce
 * (`containerTitle` holding the server, the arXiv record id carrying the
 * version), as `importer.spec.ts` does: a fixture that went through a mapper
 * would be measuring the mapper, which has its own unit suite.
 *
 * The runner gives Zotero a temporary data directory that it empties before
 * every run (`docs/13` §2.3), and this file erases what it wrote in `after()`
 * so later specs see nothing of it. Sandbox caveats (`docs/01` §2.3): no
 * `console` — `debug()` is the log.
 */

import type { CanonicalWork } from "../../../src/model/canonicalWork";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
} from "../../../src/model/ids";
import { parseExtra } from "../../../src/zotero/extraField";
import { importWorks } from "../../../src/zotero/importer";
import {
  AUTOMATIC_TAG_TYPE,
  fromZoteroItem,
  toZoteroItemJSON,
  UNCERTAIN_TYPE_TAG,
} from "../../../src/zotero/itemMapper";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function before(body: (this: MochaContext) => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  include<T>(haystack: readonly T[], needle: T, message?: string): void;
  notInclude<T>(haystack: readonly T[], needle: T, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P2-T08]";
const TEST_TIMEOUT_MS = 120_000;

function must<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`fixture must normalize: ${what}`);
  return value;
}

const AT = Date.UTC(2026, 9, 15, 1, 2, 3);

const ARXIV_ID = must(normalizeArxivId("2609.04658"), "arXiv id");
const ARXIV_DOI = must(normalizeDoi("10.48550/arXiv.2609.04658"), "arXiv DOI");
const BIORXIV_DOI = must(
  normalizeDoi("10.64898/2026.08.20.745440"),
  "bioRxiv DOI",
);
const MEDRXIV_DOI = must(
  normalizeDoi("10.64898/2026.09.03.26361736"),
  "medRxiv DOI",
);
const PMID = must(normalizePmid("41234567"), "PMID");
const PMCID = must(normalizePmcid("PMC12345678"), "PMCID");

/** What the arXiv mapper produces for `http://arxiv.org/abs/2609.04658v1`. */
const ARXIV: CanonicalWork = {
  workKey: `doi:${ARXIV_DOI}`,
  ids: { doi: ARXIV_DOI, arxivId: ARXIV_ID },
  type: "preprint",
  title: "Research Helper preprint fixture: arXiv (P2-T08)",
  authors: [{ family: "Kim", given: "Minji" }],
  containerTitle: "arXiv",
  publishedDate: { year: 2026, month: 9, day: 4, iso: "2026-09-04" },
  language: "en",
  subjects: [{ term: "q-bio.GN", scheme: "arxiv-category" }],
  provenance: {
    recordIds: ["arxiv:2609.04658v1"],
    fieldOrigin: {},
    seenIn: ["arxiv"],
  },
  normalizedAtEpochMs: AT,
};

/** A bioRxiv preprint with a PMID and PMCID, as Europe PMC returns it. */
const BIORXIV: CanonicalWork = {
  workKey: `doi:${BIORXIV_DOI}`,
  ids: { doi: BIORXIV_DOI, pmid: PMID, pmcid: PMCID },
  type: "preprint",
  title: "Research Helper preprint fixture: bioRxiv (P2-T08)",
  authors: [{ family: "Lee", given: "Jun" }],
  containerTitle: "bioRxiv",
  publisher: "bioRxiv",
  issn: ["1234-5678"],
  publishedDate: { year: 2026, month: 8, day: 20, iso: "2026-08-20" },
  provenance: {
    recordIds: ["europepmc:PPR/PPR1000001"],
    fieldOrigin: {},
    seenIn: ["europepmc"],
  },
  normalizedAtEpochMs: AT,
};

/** A medRxiv preprint under the shared `10.64898/` prefix (`docs/02` §11.2). */
const MEDRXIV: CanonicalWork = {
  workKey: `doi:${MEDRXIV_DOI}`,
  ids: { doi: MEDRXIV_DOI },
  type: "preprint",
  title: "Research Helper preprint fixture: medRxiv (P2-T08)",
  authors: [{ family: "Park", given: "Soo" }],
  containerTitle: "medRxiv",
  publishedDate: { year: 2026, month: 9, day: 3, iso: "2026-09-03" },
  provenance: {
    recordIds: ["medrxiv:10.64898/2026.09.03.26361736"],
    fieldOrigin: {},
    seenIn: ["medrxiv"],
  },
  normalizedAtEpochMs: AT,
};

/** No source could classify it (`WorkType` `"other"`, FR-7 scenario 3). */
const UNCERTAIN: CanonicalWork = {
  workKey: "hash:p2t08-uncertain-type-fixture",
  ids: {},
  type: "other",
  title: "Research Helper preprint fixture: undetermined type (P2-T08)",
  authors: [{ family: "Choi", given: "Ara" }],
  provenance: { recordIds: [], fieldOrigin: {}, seenIn: ["pubmed"] },
  normalizedAtEpochMs: AT,
};

const writtenItemIDs = new Set<number>();
const writtenCollectionIDs = new Set<number>();
const imported = new Map<string, Zotero.Item>();

function itemOrFail(itemID: number): Zotero.Item {
  const item = Zotero.Items.get(itemID);
  if (!item) assert.fail(`item ${String(itemID)} is not loadable`);
  return item;
}

function importedOrFail(work: CanonicalWork): Zotero.Item {
  const item = imported.get(work.workKey);
  if (item === undefined) assert.fail(`${work.title} was not imported`);
  return item;
}

function extraLines(item: Zotero.Item): readonly string[] {
  return parseExtra(item.getField("extra")).map((line) => line.raw);
}

describe("preprint mapping round-trips through a live Zotero (P2-T08, FR-7)", function () {
  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;
    const works = [ARXIV, BIORXIV, MEDRXIV, UNCERTAIN];
    const report = await importWorks({
      works,
      collectionName: `Research Helper preprints (P2-T08) ${String(Date.now())}`,
      strict: true,
      mapping: { accessedAtEpochMs: AT },
    });
    for (const id of report.createdItemIDs) writtenItemIDs.add(id);
    if (report.collectionCreated) {
      writtenCollectionIDs.add(report.collection.id);
    }
    debug(
      `${LOG_PREFIX} import: created=${String(report.created)} ` +
        `linked=${String(report.linkedExisting)} failed=${String(
          report.failed.length,
        )} [${report.failed
          .map((f) => `${f.phase}:${f.error.code}:${f.error.detail}`)
          .join(" | ")}]`,
    );
    if (report.failed.length > 0 || report.created !== works.length) {
      assert.fail(
        `expected ${String(works.length)} created and none failed; got ` +
          `${String(report.created)} created, ${String(report.failed.length)} failed`,
      );
    }
    report.createdItemIDs.forEach((itemID, index) => {
      const work = works[index];
      if (work !== undefined) imported.set(work.workKey, itemOrFail(itemID));
    });
  });

  it('imports the arXiv record as a preprint with repository "arXiv" and archiveID "arXiv:2609.04658v1"', async function () {
    const item = importedOrFail(ARXIV);
    assert.strictEqual(Zotero.ItemTypes.getName(item.itemTypeID), "preprint");
    assert.strictEqual(item.getField("repository"), "arXiv");
    assert.strictEqual(item.getField("archiveID"), "arXiv:2609.04658v1");
    assert.strictEqual(item.getField("genre"), "Preprint");
    assert.strictEqual(item.getField("DOI"), ARXIV_DOI);
    const keys = parseExtra(item.getField("extra")).map((l) =>
      (l.key ?? "").toLowerCase(),
    );
    assert.notInclude(keys, "arxiv", "the arXiv id is in archiveID, not extra");
  });

  it("imports the bioRxiv record with its PMID and PMCID in extra and no orphan native field", async function () {
    const item = importedOrFail(BIORXIV);
    assert.strictEqual(Zotero.ItemTypes.getName(item.itemTypeID), "preprint");
    assert.strictEqual(item.getField("repository"), "bioRxiv");
    assert.strictEqual(item.getField("archiveID"), "");
    const lines = extraLines(item);
    assert.include(lines, `PMID: ${PMID}`);
    assert.include(lines, `PMCID: ${PMCID}`);
    // `getField` returns "" for a field invalid for the type (item.js on
    // 10.0.3); asking proves nothing was force-written under another name.
    assert.strictEqual(item.getField("PMID"), "");
    assert.strictEqual(item.getField("PMCID"), "");
    assert.strictEqual(item.getField("ISSN"), "");
    assert.strictEqual(item.getField("publicationTitle"), "");
    assert.isFalse(
      Zotero.ItemFields.isValidForType(
        Zotero.ItemFields.getID("PMID"),
        item.itemTypeID,
      ),
      "Zotero's preprint type has no PMID field (docs/07 §6.1)",
    );
  });

  it("imports the medRxiv record (10.64898/ DOI) as repository medRxiv", async function () {
    const item = importedOrFail(MEDRXIV);
    assert.strictEqual(Zotero.ItemTypes.getName(item.itemTypeID), "preprint");
    assert.strictEqual(item.getField("repository"), "medRxiv");
    assert.strictEqual(item.getField("DOI"), MEDRXIV_DOI);
  });

  it("reads all three back to a preprint CanonicalWork with the same identifiers (docs/07 §6.6)", async function () {
    for (const work of [ARXIV, BIORXIV, MEDRXIV]) {
      const back = fromZoteroItem(importedOrFail(work), { nowEpochMs: AT });
      assert.strictEqual(back.type, "preprint", work.title);
      assert.strictEqual(back.workKey, work.workKey, work.title);
      assert.strictEqual(back.containerTitle, work.containerTitle, work.title);
      assert.strictEqual(back.ids.doi, work.ids.doi, work.title);
      assert.strictEqual(back.ids.arxivId, work.ids.arxivId, work.title);
      assert.strictEqual(back.ids.pmid, work.ids.pmid, work.title);
      assert.strictEqual(back.ids.pmcid, work.ids.pmcid, work.title);
    }
  });

  it("imports an undeterminable type as journalArticle carrying research_helper/uncertain-type (FR-7 scenario 3)", async function () {
    const item = importedOrFail(UNCERTAIN);
    assert.strictEqual(
      Zotero.ItemTypes.getName(item.itemTypeID),
      "journalArticle",
    );
    const tag = item.getTags().find((t) => t.tag === UNCERTAIN_TYPE_TAG);
    if (tag === undefined) assert.fail("the uncertain-type tag is missing");
    assert.strictEqual(tag.type ?? 0, AUTOMATIC_TAG_TYPE, "automatic tag");
  });

  it("keeps a foreign extra line byte-identical through a preprint write (docs/07 §6.3)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const foreign = "Citation Key: smith2024\ntex.howpublished: preprint";
    const json = toZoteroItemJSON(
      { ...BIORXIV, workKey: `${BIORXIV.workKey}#extra` },
      { accessedAtEpochMs: AT, existingExtra: foreign },
    );
    const item = new Zotero.Item();
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.fromJSON(json, { strict: true });
    await item.saveTx();
    writtenItemIDs.add(item.id);
    const extra = itemOrFail(item.id).getField("extra");
    assert.isTrue(
      extra.startsWith(`${foreign}\n`),
      `foreign lines must lead, unchanged; extra was:\n${extra}`,
    );
  });
});

after(async function () {
  const itemIDs = [...writtenItemIDs];
  try {
    if (itemIDs.length > 0) await Zotero.Items.erase(itemIDs);
    for (const collectionID of writtenCollectionIDs) {
      const collection = Zotero.Collections.get(collectionID);
      if (collection) await collection.eraseTx();
    }
    debug(`${LOG_PREFIX} cleanup erased ${String(itemIDs.length)} items`);
  } catch (error) {
    debug(
      `${LOG_PREFIX} cleanup FAILED (${
        error instanceof Error ? error.message : String(error)
      }); ${String(itemIDs.length)} items may remain`,
    );
  }
});
