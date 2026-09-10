/**
 * `CanonicalWork` ↔ Zotero item (`docs/07` §6.2).
 *
 * `P0-T10` writes the first, minimal version: one `journalArticle`, built the
 * way `docs/01` §5.2.1 says to build one. Phase 1 `create`s this path again
 * against the real `CanonicalWork` type (`plan/README.md` §4's sixteen-path
 * list), so the record type below is a placeholder shaped like the subset of
 * §6.2's mapping table this card needs — not a competing model type.
 *
 * Two decisions here are load-bearing and outlive the spike.
 *
 * **`fromJSON()`, not field-by-field `setField()`** (`docs/01` §5.2.1).
 * `setField()` throws on a field invalid for the item type (§12 gotcha 17), so
 * hand-mapping means owning a validation matrix that moves with every schema
 * bump. `fromJSON` owns it instead, resolves base-field mappings, and migrates
 * recognised `Extra` lines into real fields. Its one hard rule is that it is a
 * **replace, not a merge** (§12 gotcha 24) — which is why it is only ever
 * called here, on a brand-new item, and never to patch an existing one.
 *
 * **Strict in development.** §5.2.1: "Develop with `{ strict: true }`. In
 * strict mode, an unknown or invalid field throws a `ZoteroInvalidDataError`
 * instead of being silently swept into `Extra`. Run your mapping tests strict,
 * ship non-strict." `__env__` is the same development/production switch
 * `src/addon.ts` uses for the scope's duplicate-description assertions.
 */

/**
 * One creator, in the two shapes `docs/01` §5.2 documents.
 *
 * A discriminated union rather than an object with two optional halves,
 * because `exactOptionalPropertyTypes` makes "either both name parts or the
 * single-field one" impossible to state with optionality alone — and because
 * `fieldMode: 1` and `firstName`/`lastName` are mutually exclusive at runtime.
 */
export type ArticleCreator =
  | {
      readonly kind: "two-field";
      readonly firstName: string;
      readonly lastName: string;
    }
  | {
      /** An institutional or otherwise unsplittable name. `fieldMode: 1`. */
      readonly kind: "single-field";
      readonly name: string;
    };

/**
 * The subset of `docs/07` §6.2's mapping table `P0-T10` exercises.
 *
 * Field names are spelled exactly as Zotero spells them (`docs/07` §6.1's
 * verified key list), because they are handed to `fromJSON()` verbatim:
 * `abstractNote`, not `abstract`; `DOI` upper-case, not `doi`.
 */
export interface JournalArticleRecord {
  readonly title: string;
  readonly abstractNote: string;
  /** Bare, never a URL (`docs/07` §6.2). */
  readonly DOI: string;
  readonly creators: readonly ArticleCreator[];
}

/**
 * The tag every item this plugin creates carries, so a user can find — and
 * bulk-remove — everything it wrote (`docs/01` §5.2).
 */
export const RESEARCH_HELPER_TAG = "research_helper";

/**
 * `Zotero.Item.prototype.addTag`'s type argument: `0` = manual (blue),
 * `1` = automatic (orange). `docs/01` §5.2 and `docs/07` §6.2 both require
 * automatic for plugin-written tags.
 */
export const AUTOMATIC_TAG_TYPE = 1;

/**
 * Build one unsaved `journalArticle`.
 *
 * The caller owns the transaction and the `save()` — `docs/01` §5.8's
 * single-writer rule means the decision of *when* to write belongs with the
 * code that knows how many items are coming, not with the mapper.
 *
 * **`item.libraryID = libraryID` compiles**, despite hole (b) in
 * `typings/zotero-augment.d.ts` predicting TS2540 here: `zotero-types@4.1.3`
 * re-declares `libraryID` as a mutable `number` on `Zotero.Item`, shadowing
 * the `readonly` on `Zotero.DataObject`. So the assignment `docs/01` §5.2's
 * canonical shape performs needs no cast and no augmentation. It is written
 * explicitly rather than relying on `_initSave()`'s "default to the user
 * library" fallback, because a group library is a real destination in Phase 2
 * and an implicit default would silently write to the wrong one.
 *
 * @param record - already-normalised article data
 * @param libraryID - the destination library
 * @returns the item, unsaved, with its tag already attached
 */
export function buildJournalArticle(
  record: JournalArticleRecord,
  libraryID: number,
): Zotero.Item {
  const item = new Zotero.Item();
  item.libraryID = libraryID;

  item.fromJSON(
    {
      itemType: "journalArticle",
      title: record.title,
      abstractNote: record.abstractNote,
      DOI: record.DOI,
      creators: record.creators.map(toCreatorJSON),
    },
    // Ship non-strict, develop strict (docs/01 §5.2.1).
    { strict: __env__ === "development" },
  );

  // After fromJSON, never inside it: fromJSON's `tags` key is a replace, and
  // adding the tag separately keeps the mapping table and the plugin's own
  // bookkeeping tag from being edited as one thing.
  item.addTag(RESEARCH_HELPER_TAG, AUTOMATIC_TAG_TYPE);

  return item;
}

/** One creator in the JSON shape `fromJSON()` passes to `setCreators()`. */
function toCreatorJSON(creator: ArticleCreator): Record<string, unknown> {
  if (creator.kind === "single-field") {
    return {
      creatorType: "author",
      name: creator.name,
      fieldMode: 1,
    };
  }
  return {
    creatorType: "author",
    firstName: creator.firstName,
    lastName: creator.lastName,
  };
}
