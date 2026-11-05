/**
 * `P5-T17`: the importer's two additions, from their control flow alone.
 *
 * {@link relateToSeed}, {@link usableExistingItems} and {@link planImport}'s
 * caller-matched arm, over items that record what they are asked. **A pass here
 * says the code asks Zotero for the right things in the right order, and nothing
 * about what Zotero then does.** `test/integration/zotero/relatedLinkage.spec.ts`
 * is that proof.
 *
 * The fake items answer `addRelatedItem` as 10.0.3's `omni.ja` reads
 * (`chrome/content/zotero/xpcom/data/item.js`, read 2026-11-05): `false` when the
 * relation is already there, `true` when it is new. The global is stubbed per test
 * here, rather than enlarging `test/setup/zotero-global.ts` (`docs/13` §2.1).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanonicalWork } from "../../../src/model/canonicalWork";
import { FakeZotero } from "../../setup/zotero-global";
import {
  planImport,
  relateToSeed,
  usableExistingItems,
} from "../../../src/zotero/importer";
import type { LibraryIndex } from "../../../src/zotero/libraryIndex";

interface FakeRelatable {
  readonly id: number;
  readonly libraryID: number;
  readonly deleted: boolean;
  readonly related: Set<number>;
  readonly saves: unknown[];
  readonly reloads: unknown[];
  isRegularItem(): boolean;
  addRelatedItem(other: { id: number }): boolean;
  save(options: unknown): Promise<void>;
  reload(types: unknown, unchanged: unknown): Promise<void>;
}

function fakeItem(
  id: number,
  extra: Partial<
    Pick<FakeRelatable, "libraryID" | "deleted"> & {
      regular: boolean;
      related: number[];
      failSave: boolean;
      failReload: boolean;
    }
  > = {},
): FakeRelatable {
  const related = new Set(extra.related ?? []);
  const saves: unknown[] = [];
  const reloads: unknown[] = [];
  return {
    id,
    libraryID: extra.libraryID ?? 1,
    deleted: extra.deleted ?? false,
    related,
    saves,
    reloads,
    isRegularItem: () => extra.regular ?? true,
    addRelatedItem(other) {
      if (related.has(other.id)) return false;
      related.add(other.id);
      return true;
    },
    save(options) {
      if (extra.failSave === true) return Promise.reject(new Error("no save"));
      saves.push(options);
      return Promise.resolve();
    },
    reload(types, unchanged) {
      reloads.push([types, unchanged]);
      return extra.failReload === true
        ? Promise.reject(new Error("no reload"))
        : Promise.resolve();
    },
  };
}

/** A Zotero with these items, recording the transactions and the data loads. */
function zoteroOf(items: readonly FakeRelatable[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const order: string[] = [];
  const executeTransaction = vi.fn(async (body: () => Promise<void>) => {
    order.push("transaction");
    await body();
  });
  const loadDataTypes = vi.fn((_objects: unknown) => {
    order.push("load");
    return Promise.resolve();
  });
  const getAsync = vi.fn((ids: number | number[]) =>
    Promise.resolve(
      Array.isArray(ids)
        ? ids.flatMap((id) => {
            const found = byId.get(id);
            return found === undefined ? [] : [found];
          })
        : (byId.get(ids) ?? false),
    ),
  );
  vi.stubGlobal("Zotero", {
    ...FakeZotero,
    Items: { getAsync, loadDataTypes },
    DB: { executeTransaction },
  });
  return { executeTransaction, loadDataTypes, getAsync, order };
}

afterEach(() => {
  vi.stubGlobal("Zotero", FakeZotero);
});

const QUIET = { skipDateModifiedUpdate: true };

describe("relateToSeed: related on both sides, in one transaction", () => {
  it("relates each item to the seed and the seed to each, and saves both sides once", async () => {
    const seed = fakeItem(1);
    const a = fakeItem(2);
    const b = fakeItem(3);
    const z = zoteroOf([seed, a, b]);

    const report = await relateToSeed(1, [2, 3]);

    expect(report).toStrictEqual({ linked: 2, error: undefined });
    expect([...seed.related]).toStrictEqual([2, 3]);
    expect([...a.related]).toStrictEqual([1]);
    expect([...b.related]).toStrictEqual([1]);
    expect(z.executeTransaction).toHaveBeenCalledTimes(1);
    expect(seed.saves).toStrictEqual([QUIET]);
    expect(a.saves).toStrictEqual([QUIET]);
    expect(b.saves).toStrictEqual([QUIET]);
  });

  it("loads the relations of every object before the transaction opens", async () => {
    const seed = fakeItem(1);
    const a = fakeItem(2);
    const z = zoteroOf([seed, a]);
    await relateToSeed(1, [2]);
    expect(z.order).toStrictEqual(["load", "transaction"]);
    expect(z.loadDataTypes.mock.calls[0]?.[0]).toStrictEqual([seed, a]);
  });

  it("saves neither side of a relation already there, and still counts it", async () => {
    const seed = fakeItem(1, { related: [2] });
    const a = fakeItem(2, { related: [1] });
    zoteroOf([seed, a]);
    expect(await relateToSeed(1, [2])).toStrictEqual({
      linked: 1,
      error: undefined,
    });
    expect(seed.saves).toStrictEqual([]);
    expect(a.saves).toStrictEqual([]);
  });

  it("saves only the side that changed", async () => {
    const seed = fakeItem(1, { related: [2] });
    const a = fakeItem(2);
    zoteroOf([seed, a]);
    await relateToSeed(1, [2]);
    expect(seed.saves).toStrictEqual([]);
    expect(a.saves).toStrictEqual([QUIET]);
  });

  it("never relates the seed to itself", async () => {
    const seed = fakeItem(1);
    const a = fakeItem(2);
    zoteroOf([seed, a]);
    expect(await relateToSeed(1, [1, 2])).toStrictEqual({
      linked: 1,
      error: undefined,
    });
    expect([...seed.related]).toStrictEqual([2]);
  });

  it("counts an item two works matched once", async () => {
    const seed = fakeItem(1);
    const a = fakeItem(2);
    zoteroOf([seed, a]);
    expect(await relateToSeed(1, [2, 2])).toStrictEqual({
      linked: 1,
      error: undefined,
    });
    expect(a.saves).toHaveLength(1);
  });

  it("does nothing at all with nothing to relate", async () => {
    const seed = fakeItem(1);
    const z = zoteroOf([seed]);
    expect(await relateToSeed(1, [])).toStrictEqual({
      linked: 0,
      error: undefined,
    });
    expect(await relateToSeed(1, [1])).toStrictEqual({
      linked: 0,
      error: undefined,
    });
    expect(z.getAsync).not.toHaveBeenCalled();
    expect(z.executeTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["gone", []],
    ["in the trash", [fakeItem(1, { deleted: true })]],
  ])("reports a seed that is %s, and writes nothing", async (_name, items) => {
    const a = fakeItem(2);
    const z = zoteroOf([...items, a]);
    const report = await relateToSeed(1, [2]);
    expect(report.linked).toBe(0);
    expect(report.error?.code).toBe("ZOTERO_API");
    expect(z.executeTransaction).not.toHaveBeenCalled();
    expect(a.related.size).toBe(0);
  });

  it("reports a failed save instead of throwing it, and drops what the rollback undid", async () => {
    const seed = fakeItem(1);
    const a = fakeItem(2, { failSave: true });
    const b = fakeItem(3);
    zoteroOf([seed, a, b]);

    const report = await relateToSeed(1, [2, 3]);

    expect(report.linked).toBe(0);
    expect(report.error?.code).toBe("ZOTERO_API");
    expect(report.error?.detail).toContain("no save");
    for (const object of [seed, a, b]) {
      expect(object.reloads).toStrictEqual([[["relations"], true]]);
    }
  });

  it("still reports the save when a reload fails too, and reloads the rest", async () => {
    const seed = fakeItem(1, { failReload: true });
    const a = fakeItem(2, { failSave: true });
    zoteroOf([seed, a]);
    const report = await relateToSeed(1, [2]);
    expect(report.error?.detail).toContain("no save");
    expect(a.reloads).toHaveLength(1);
  });
});

describe("usableExistingItems: a match is checked again at import", () => {
  it("keeps a live regular item in this library", async () => {
    zoteroOf([fakeItem(5)]);
    const usable = await usableExistingItems(new Map([["k", 5]]), 1);
    expect([...usable]).toStrictEqual([["k", 5]]);
  });

  it.each([
    ["in the trash", fakeItem(5, { deleted: true })],
    ["in another library", fakeItem(5, { libraryID: 2 })],
    ["not a regular item", fakeItem(5, { regular: false })],
  ])("drops an item %s", async (_name, item) => {
    zoteroOf([item]);
    const usable = await usableExistingItems(new Map([["k", 5]]), 1);
    expect(usable.size).toBe(0);
  });

  it("drops an item that no longer exists, and keeps the others", async () => {
    zoteroOf([fakeItem(6)]);
    const usable = await usableExistingItems(
      new Map([
        ["gone", 5],
        ["here", 6],
      ]),
      1,
    );
    expect([...usable]).toStrictEqual([["here", 6]]);
  });

  it("asks Zotero nothing for an empty map", async () => {
    const z = zoteroOf([]);
    expect((await usableExistingItems(new Map(), 1)).size).toBe(0);
    expect(z.getAsync).not.toHaveBeenCalled();
  });
});

describe("planImport: the caller's match", () => {
  const work = (key: string): CanonicalWork =>
    ({ workKey: key, ids: {} }) as unknown as CanonicalWork;
  const index = (
    answer: { itemID: number; matchedOn: "doi" } | undefined,
  ): LibraryIndex =>
    ({ findExisting: () => answer }) as unknown as LibraryIndex;
  const KNOWN = new Map([["title-matched", 40]]);

  it("links a work the index does not know to the item the caller matched", () => {
    const plan = planImport(
      [work("title-matched")],
      index(undefined),
      "link-existing",
      KNOWN,
    );
    expect(plan.toCreate).toStrictEqual([]);
    expect(plan.toLink.map((link) => link.match)).toStrictEqual([
      { itemID: 40, matchedOn: "caller" },
    ]);
  });

  it("lets an identifier match in the index win over it", () => {
    const plan = planImport(
      [work("title-matched")],
      index({ itemID: 9, matchedOn: "doi" }),
      "link-existing",
      KNOWN,
    );
    expect(plan.toLink.map((link) => link.match)).toStrictEqual([
      { itemID: 9, matchedOn: "doi" },
    ]);
  });

  it("creates a work neither of them knows", () => {
    const plan = planImport(
      [work("other")],
      index(undefined),
      "link-existing",
      KNOWN,
    );
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toLink).toStrictEqual([]);
  });

  it("creates as before with no map at all", () => {
    const plan = planImport(
      [work("title-matched")],
      index(undefined),
      "link-existing",
    );
    expect(plan.toCreate).toHaveLength(1);
  });

  it("applies the policy to the caller's match as to any other", () => {
    expect(
      planImport([work("title-matched")], index(undefined), "skip", KNOWN)
        .skipped,
    ).toBe(1);
    expect(
      planImport(
        [work("title-matched")],
        index(undefined),
        "import-anyway",
        KNOWN,
      ).toCreate,
    ).toHaveLength(1);
  });
});
