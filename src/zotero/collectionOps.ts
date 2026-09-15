/**
 * Create/find collections and move items in and out of them (`docs/07` §2.2).
 *
 * `P0-T10` needs exactly one operation — "the collection with this name, or a
 * new one" — and one answer recorded: whether
 * `Zotero.Collection.prototype.addItems()` exists on Zotero 10.
 *
 * ### `addItems()` exists. Read from the shipped client, not from a changelog.
 *
 * `docs/01` §5.4 carries a `> **Unverified:**` marker asking "whether
 * `collection.addItems()` exists as a plural alongside `addItem()` in
 * Zotero 10, and whether either auto-saves or requires a subsequent
 * `saveTx()`". Both halves are answered by
 * `chrome/content/zotero/xpcom/data/collection.js` inside the installed
 * Zotero 10.0.1's `omni.ja`:
 *
 * ```javascript
 * Zotero.Collection.prototype.addItem = function (itemID, options) {
 *   return this.addItems([itemID], options);
 * };
 *
 * // Requires a transaction
 * // Does not require a separate save()
 * Zotero.Collection.prototype.addItems = async function (itemIDs, options = {}) {
 *   options.skipDateModifiedUpdate = true;
 *   ...
 *   Zotero.DB.requireTransaction();
 *   ...
 *     item.addToCollection(this.id);
 *     await item.save(options);
 * };
 * ```
 *
 * So: `addItems()` is the primitive and `addItem()` delegates to it; it
 * **requires an open transaction** and calls `Zotero.DB.requireTransaction()`
 * to say so; it needs no `save()` on the collection, because internally it is
 * the documented-safe *item*-side pattern §5.4 recommends
 * (`item.addToCollection(id)` then `await item.save()`).
 *
 * `zotero-types@4.1.3` already declares both with those same JSDoc notes, so
 * this is not a hole in the typings either.
 *
 * **`P0-T10` still does not call it**, and the reason is worth keeping:
 * `addItems()` operates on items that are already saved, so using it for a
 * *new* item would mean saving the item, then saving it again from inside
 * `addItems()`. `Zotero.Item.prototype.setCollections()` before the item's
 * single `save()` is one write instead of two, and is what `docs/01` §5.2
 * recommends "at creation time". `addItems()` is the right call when adding
 * *existing* items to a collection, which is Phase 1's import path.
 *
 * `P0-T20` adds the second operation, {@link saveNewItemsToCollection}: the
 * batch write `V-12` times against `NFR-1`.
 */

/** A collection, and whether this call is what created it. */
export interface CollectionLookup {
  readonly collection: Zotero.Collection;
  /** False when an existing same-named collection was reused. */
  readonly created: boolean;
}

/**
 * Find a top-level collection by name in `libraryID`, or create one.
 *
 * **Must be called inside a `Zotero.DB.executeTransaction`**, because it uses
 * `save()` rather than `saveTx()` (`docs/01` §5.8, §12 gotcha 12).
 *
 * **Top-level only.** `Zotero.Collections.getByLibrary(libraryID)` is called
 * without its `recursive` flag on purpose: matching nested collections too
 * would make the result depend on where in *the user's* hierarchy a same-named
 * collection happens to sit, and this function's whole job is to be
 * deterministic across runs.
 *
 * **No `ZoteroPane` selection getter is consulted** — `docs/01` §12 gotcha 3:
 * `getSelectedCollection()` and the other singular getters throw on Zotero 10.
 * This card creates its collection outright instead, so the question does not
 * arise.
 *
 * `libraryID` reaches the new collection through the constructor's `params`
 * argument rather than by assignment. `Zotero.Collection` — unlike
 * `Zotero.Item` — does not re-declare `libraryID` as mutable, so
 * `collection.libraryID = n` is TS2540 against `zotero-types@4.1.3`'s
 * `readonly Zotero.DataObject.libraryID`. The constructor accepts
 * `{ name, libraryID, parentID, parentKey }`, which is both type-clean and
 * exactly what `Zotero.Collection`'s own `assignProps()` call handles.
 *
 * @param name - the collection name, matched exactly
 * @param libraryID - the library to search and, if needed, to create in
 */
export async function findOrCreateCollection(
  name: string,
  libraryID: number,
): Promise<CollectionLookup> {
  const existing = Zotero.Collections.getByLibrary(libraryID).find(
    (collection) => collection.name === name,
  );
  if (existing) {
    return { collection: existing, created: false };
  }

  const collection = new Zotero.Collection({ name, libraryID });
  // save(), not saveTx(): the caller's transaction is already open.
  await collection.save();
  return { collection, created: true };
}

/** What {@link saveNewItemsToCollection} wrote. */
export interface BatchSaveResult {
  readonly collection: Zotero.Collection;
  /** False when an existing same-named collection was reused. */
  readonly collectionCreated: boolean;
  /** The saved items' IDs, in input order. */
  readonly itemIDs: readonly number[];
}

/**
 * Save a batch of **new, unsaved** items into the named collection, in one
 * `Zotero.DB.executeTransaction` (`docs/01` §5.8, `P0-T20`).
 *
 * The shape `P0-T10` established for one item, applied to many: the
 * collection is found or created *inside* the transaction, so a failure on
 * item 57 rolls back the collection and items 1–56 with it instead of leaving
 * a half-filled collection behind; each item gets
 * `setCollections([collection.id])` before its single `save()`; `saveTx()` is
 * never called (`docs/01` §12 gotcha 12). `docs/01` §5.8: "one
 * `executeTransaction` around 50 `save()` calls is one" transaction, not 50.
 *
 * **The caller must have finished every network fetch first.** Nothing here
 * awaits anything but the DB, and nothing may: holding Zotero's single-writer
 * transaction across an HTTP round-trip stalls the whole application
 * (`docs/01` §12 gotcha 13).
 *
 * **No per-item UI refresh.** Zotero queues each save's notifier events and
 * delivers them once, after the commit, which is the "defer collection-tree
 * updates until the batch completes" `docs/11` R-16 asks for. The collection's
 * in-memory child list is likewise updated only on commit, so it goes from 0
 * to all-of-them in one step.
 *
 * **Only for new items.** `setCollections()` *replaces* an item's membership
 * (`docs/01` §5.2), so calling this with an already-saved item would silently
 * pull it out of every other collection. That is refused up front, before the
 * transaction opens. Existing items take `collection.addItems()` instead (see
 * the file header).
 *
 * @param items - unsaved items, e.g. from `buildJournalArticle()`
 * @param collectionName - matched exactly among top-level collections
 * @param libraryID - the library both the collection and the items live in
 */
export async function saveNewItemsToCollection(
  items: readonly Zotero.Item[],
  collectionName: string,
  libraryID: number,
): Promise<BatchSaveResult> {
  const saved = items.findIndex((item) => Boolean(item.id));
  if (saved !== -1) {
    throw new Error(
      `saveNewItemsToCollection: item at index ${saved} is already saved ` +
        `(id ${String(items[saved]?.id)}); setCollections() would replace ` +
        `its existing collection membership`,
    );
  }

  return Zotero.DB.executeTransaction(async (): Promise<BatchSaveResult> => {
    const { collection, created } = await findOrCreateCollection(
      collectionName,
      libraryID,
    );

    const itemIDs: number[] = [];
    for (const item of items) {
      item.setCollections([collection.id]);
      // save(), not saveTx(): docs/01 §5.8 / §12 gotcha 12. Sequential on
      // purpose — the DB is single-writer, so Promise.all would buy nothing
      // but interleaved statements.
      await item.save();
      itemIDs.push(item.id);
    }

    return { collection, collectionCreated: created, itemIDs };
  });
}
