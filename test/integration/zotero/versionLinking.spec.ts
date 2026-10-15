/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P2-T11`: a preprint and its published version, written by the shipped
 * importer (`importWorks()` in `src/zotero/importer.ts`) into a live Zotero.
 *
 * Gate `G-16` (decided 2026-10-14) and `docs/07` §6.2's `relatedVersionIds`
 * rows: the two stay **two items**; when one import creates both, each item
 * names the other through Zotero *Related* (`dc:relation`) and the preprint
 * carries the automatic tag `research_helper/superseded-by-published`; when
 * only one is imported, its `extra` names the other as `Published DOI:` /
 * `Preprint DOI:` (`docs/02` §11.4). An item already in the library is never
 * modified (`P1-T14`).
 *
 * **Why inside Zotero.** Only Zotero can show that the relation survives the
 * writer — that `addRelatedItem` plus `save()` on both sides leaves each
 * item's `relatedItems` holding the other's key — and that `fromJSON()` keeps a
 * `Published DOI:` line in `extra` rather than migrating it into the `DOI`
 * field (`plan/00` §6 item 148: no test asserted the relation before this).
 *
 * The works are built by hand in the shape `dedupeAndMerge` hands the writer
 * (each side's ids in the other's `relatedVersionIds`); the cascade that
 * produces that shape has its own unit suite
 * (`test/unit/sources/versionLinking.test.ts`).
 *
 * The runner gives Zotero a temporary data directory that it empties before
 * every run (`docs/13` §2.3), and this file erases what it wrote in `after()`.
 * Sandbox caveats (`docs/01` §2.3): no `console` — `debug()` is the log.
 */

import type { CanonicalWork } from "../../../src/model/canonicalWork";
import { normalizeDoi, type Doi } from "../../../src/model/ids";
import { parseExtra } from "../../../src/zotero/extraField";
import { type ImportReport, importWorks } from "../../../src/zotero/importer";
import {
  AUTOMATIC_TAG_TYPE,
  SUPERSEDED_BY_PUBLISHED_TAG,
  VERSION_DOI_EXTRA_KEY,
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
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isUndefined(value: unknown, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P2-T11]";
const TEST_TIMEOUT_MS = 120_000;
const AT = Date.UTC(2026, 9, 15, 1, 2, 3);

function doiOrThrow(raw: string): Doi {
  const doi = normalizeDoi(raw);
  if (doi === null) throw new Error(`fixture DOI must normalize: ${raw}`);
  return doi;
}

/**
 * A preprint and its published version, each naming the other — what
 * `stages.ts`'s `relate` leaves on a linked pair. `slug` keeps every pair's
 * identifiers apart from the other tests' and from other spec files.
 */
function pair(slug: string): {
  readonly preprint: CanonicalWork;
  readonly published: CanonicalWork;
} {
  const preDoi = doiOrThrow(`10.64898/2026.10.15.${slug}`);
  const pubDoi = doiOrThrow(`10.5555/rh-p2t11.${slug}`);
  const provenance = (source: "biorxiv" | "crossref", id: string) => ({
    recordIds: [`${source}:${id}`],
    fieldOrigin: {},
    seenIn: [source],
  });
  return {
    preprint: {
      workKey: `doi:${preDoi}`,
      ids: { doi: preDoi },
      type: "preprint",
      title: `Research Helper version-linking fixture ${slug}: the preprint (P2-T11)`,
      authors: [{ family: "Hopper", given: "Grace" }],
      containerTitle: "bioRxiv",
      publishedDate: { year: 2025, month: 3, day: 1, iso: "2025-03-01" },
      relatedVersionIds: { doi: pubDoi },
      provenance: provenance("biorxiv", preDoi),
      normalizedAtEpochMs: AT,
    },
    published: {
      workKey: `doi:${pubDoi}`,
      ids: { doi: pubDoi },
      type: "journal-article",
      title: `Research Helper version-linking fixture ${slug}: the article (P2-T11)`,
      authors: [{ family: "Hopper", given: "Grace" }],
      containerTitle: "Journal of Synthetic Fixtures",
      publishedDate: { year: 2026, month: 1, day: 1, iso: "2026-01-01" },
      relatedVersionIds: { doi: preDoi },
      provenance: provenance("crossref", pubDoi),
      normalizedAtEpochMs: AT,
    },
  };
}

const writtenItemIDs = new Set<number>();
const writtenCollectionIDs = new Set<number>();

async function runImport(
  works: readonly CanonicalWork[],
  label: string,
): Promise<ImportReport> {
  const report = await importWorks({
    works,
    collectionName: `Research Helper version linking (P2-T11) ${label} ${String(Date.now())}`,
    strict: true,
    mapping: { accessedAtEpochMs: AT },
  });
  for (const id of report.createdItemIDs) writtenItemIDs.add(id);
  if (report.collectionCreated) writtenCollectionIDs.add(report.collection.id);
  debug(
    `${LOG_PREFIX} ${label}: created=${String(report.created)} ` +
      `linked=${String(report.linkedExisting)} failed=${String(report.failed.length)} ` +
      `versionLinks=${JSON.stringify(report.versionLinks)} ` +
      `versionLinkError=${report.versionLinkError?.code ?? "none"} ` +
      `transactions=${String(report.stats.transactions)} [${report.failed
        .map((f) => `${f.phase}:${f.error.code}:${f.error.detail}`)
        .join(" | ")}]`,
  );
  if (report.failed.length > 0) {
    assert.fail(`${label}: ${String(report.failed.length)} record(s) failed`);
  }
  return report;
}

/** The created item for `work`, found by its DOI among the report's items. */
function createdItem(report: ImportReport, work: CanonicalWork): Zotero.Item {
  for (const id of report.createdItemIDs) {
    const item = Zotero.Items.get(id);
    if (item && item.getField("DOI") === work.ids.doi) return item;
  }
  return assert.fail(`no created item for ${work.workKey}`);
}

function extraValue(item: Zotero.Item, key: string): string | undefined {
  return parseExtra(item.getField("extra")).find((line) => line.key === key)
    ?.value;
}

function tagType(item: Zotero.Item, tag: string): number | undefined {
  return item.getTags().find((t) => t.tag === tag)?.type;
}

describe("preprint ↔ published version in a live Zotero (P2-T11, gate G-16)", function () {
  it("both imported together: two items, each Related to the other, the preprint tagged", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;
    const { preprint, published } = pair("911001");
    const report = await runImport([preprint, published], "both");

    assert.strictEqual(report.created, 2, "two items, never one");
    assert.strictEqual(report.versionLinks.length, 1, "one pair related");
    assert.isUndefined(report.versionLinkError, "the relation was written");
    const pre = createdItem(report, preprint);
    const pub = createdItem(report, published);
    assert.strictEqual(pre.itemType, "preprint");
    assert.strictEqual(pub.itemType, "journalArticle");

    // Read back after the save, from Zotero's own store of the relation.
    debug(
      `${LOG_PREFIX} relatedItems: preprint=${JSON.stringify(pre.relatedItems)} ` +
        `published=${JSON.stringify(pub.relatedItems)}`,
    );
    assert.deepEqual(pre.relatedItems, [pub.key], "preprint → published");
    assert.deepEqual(pub.relatedItems, [pre.key], "published → preprint");

    assert.strictEqual(
      tagType(pre, SUPERSEDED_BY_PUBLISHED_TAG),
      AUTOMATIC_TAG_TYPE,
      "the preprint carries the automatic superseded tag",
    );
    assert.isUndefined(
      tagType(pub, SUPERSEDED_BY_PUBLISHED_TAG),
      "the published version is not tagged",
    );
    // Both sides are imported, so neither needs the `extra` line.
    assert.isUndefined(extraValue(pre, VERSION_DOI_EXTRA_KEY.published));
    assert.isUndefined(extraValue(pub, VERSION_DOI_EXTRA_KEY.preprint));
    // Each item keeps its own DOI.
    assert.strictEqual(pre.getField("DOI"), preprint.ids.doi);
    assert.strictEqual(pub.getField("DOI"), published.ids.doi);
  });

  it("only the preprint imported: 'Published DOI:' kept in extra, tagged, nothing related", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { preprint, published } = pair("911002");
    const report = await runImport([preprint], "preprint-only");
    const pre = createdItem(report, preprint);
    assert.strictEqual(report.versionLinks.length, 0);
    assert.strictEqual(
      extraValue(pre, VERSION_DOI_EXTRA_KEY.published),
      published.ids.doi,
      "fromJSON kept the line in extra",
    );
    assert.strictEqual(pre.getField("DOI"), preprint.ids.doi, "own DOI kept");
    assert.strictEqual(
      tagType(pre, SUPERSEDED_BY_PUBLISHED_TAG),
      AUTOMATIC_TAG_TYPE,
    );
    assert.deepEqual(pre.relatedItems, []);
  });

  it("only the published version imported: 'Preprint DOI:' in extra, no tag", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { preprint, published } = pair("911003");
    const report = await runImport([published], "published-only");
    const pub = createdItem(report, published);
    assert.strictEqual(
      extraValue(pub, VERSION_DOI_EXTRA_KEY.preprint),
      preprint.ids.doi,
    );
    assert.strictEqual(pub.getField("DOI"), published.ids.doi);
    assert.isUndefined(tagType(pub, SUPERSEDED_BY_PUBLISHED_TAG));
    assert.deepEqual(pub.relatedItems, []);
  });

  it("an item already in the library is not modified by its other version's import (P1-T14)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { preprint, published } = pair("911004");
    const first = await runImport([published], "existing-first");
    const pub = createdItem(first, published);
    const before = pub.dateModified;
    const second = await runImport([preprint], "existing-second");
    const pre = createdItem(second, preprint);
    assert.strictEqual(second.versionLinks.length, 0);
    assert.deepEqual(
      pub.relatedItems,
      [],
      "the existing item gains no relation",
    );
    assert.strictEqual(pub.dateModified, before, "and is not re-saved");
    assert.strictEqual(
      extraValue(pre, VERSION_DOI_EXTRA_KEY.published),
      published.ids.doi,
      "the new item records the version already in the library",
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
