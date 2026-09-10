/**
 * The narrow facade over the `Zotero` global (`docs/07` §2.2).
 *
 * `docs/07` §2.3 makes `src/zotero/` the only directory permitted to name
 * `Zotero.*`, and `eslint.config.js`'s `research-helper/zotero-global` rule
 * enforces it. This file is the entry point of that directory: everything the
 * rest of the plugin needs from the platform arrives through a function
 * declared here or in one of `src/zotero/`'s siblings.
 *
 * `P0-T10` gives it three jobs:
 *
 * 1. `debug()` / `reportError()` — the log sink. `docs/01` §2.3 (measured by
 *    `P0-T08` on Zotero 10.0.1) records that the plugin sandbox has **no
 *    `console`**: a stray `console.log` throws. `Zotero.debug()` is the only
 *    way out, and `docs/01` §12 gotcha 15 limits what may go into it.
 * 2. `schemaReady()` — the gate `docs/01` §12 gotcha 29 requires before any
 *    `Zotero.ItemTypes` / `Zotero.ItemFields` lookup.
 * 3. `createSpikeArticle()` — the `P0-T10` spike command itself.
 *
 * **`createSpikeArticle()` is deliberately in the wrong layer, and only for
 * this card.** Orchestration belongs in `src/pipeline/` (`docs/07` §2.2), but
 * `P0-T10`'s `Files` list does not include a pipeline path, and the two
 * candidate homes are both closed: `src/ui/**` may not import `src/zotero/**`
 * (the `research-helper/layering/ui` rule) and `src/bootstrap/registerUI.ts`
 * may not name the `Zotero` global. Phase 1 `create`s
 * `src/pipeline/searchImport/searchImportPipeline.ts` and this function's job
 * moves there; `plan/README.md` §4's sixteen-path list already anticipates
 * this file being rewritten then.
 */

import { findOrCreateCollection } from "./collectionOps";
import {
  RESEARCH_HELPER_TAG,
  buildJournalArticle,
  type JournalArticleRecord,
} from "./itemMapper";

/** The `[Research Helper]` prefix every line of ours carries in Debug Output. */
const LOG_PREFIX = "[research-helper]";

/**
 * Write one line to Help → Debug Output Logging.
 *
 * `docs/01` §12 gotcha 15: users paste this into bug reports. Log shapes,
 * identifiers and status codes — never a key, a request body or library
 * content.
 */
export function debug(message: string): void {
  Zotero.debug(`${LOG_PREFIX} ${message}`);
}

/** Log a caught error with its stack. Never rethrows. */
export function reportError(message: string, error: unknown): void {
  const detail =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? "(no stack)"}`
      : String(error);
  debug(`${message}: ${detail}`);
}

/**
 * Resolve once Zotero's item-type/field schema is loaded.
 *
 * `docs/01` §12 gotcha 29 / §5.3: `Zotero.ItemFields.getID()` and
 * `Zotero.ItemTypes.getID()` throw `UnloadedDataException` if called before
 * this settles, and `Zotero.Item.fromJSON()` calls both internally.
 */
export async function schemaReady(): Promise<void> {
  await Zotero.Schema.schemaUpdatePromise;
}

/** The library this spike writes into. */
export function userLibraryID(): number {
  return Zotero.Libraries.userLibraryID;
}

/**
 * The collection `createSpikeArticle()` writes into.
 *
 * ASCII and free of path separators on purpose (`docs/01` §12 gotcha 19), and
 * carrying the task ID so it is obvious in a library what put it there.
 */
export const SPIKE_COLLECTION_NAME = "Research Helper spike (P0-T10)";

/**
 * The one article the spike creates. Fixed data, not fetched: `docs/01` §5.8
 * and §12 gotcha 13 forbid network I/O inside a transaction, and this card
 * establishes the pattern even though it has nothing to fetch.
 */
const SPIKE_RECORD: JournalArticleRecord = {
  title: "Research Helper spike article (P0-T10)",
  abstractNote:
    "Created by the research_helper P0-T10 toolchain spike to prove that the " +
    "plugin can write a journalArticle, its creator, its DOI and its " +
    "collection membership into a Zotero library.",
  DOI: "10.5555/research-helper-p0-t10",
  creators: [{ kind: "two-field", firstName: "Ada", lastName: "Lovelace" }],
};

/** What one run of the spike command produced. */
export interface SpikeArticleResult {
  readonly itemID: number;
  readonly itemKey: string;
  readonly collectionID: number;
  readonly collectionName: string;
  /** False when an earlier run's collection was reused. */
  readonly collectionCreated: boolean;
}

/**
 * The Tools-menu command: create one `journalArticle` inside a named
 * collection.
 *
 * **Transaction shape (`P0-T10` step 4).** One `Zotero.DB.executeTransaction`
 * covers both writes — the collection and the item — and both use `save()`.
 * `saveTx()` is never called inside it (`docs/01` §12 gotcha 12: it deadlocks
 * or throws). Taking the collection inside rather than outside is what makes
 * the pair atomic: a failure while saving the item cannot leave an orphan
 * collection behind, and `collection.save()` assigns `collection.id`
 * synchronously enough for `item.setCollections([id])` in the next statement.
 *
 * **Collection membership.** Set on the *item* side with `setCollections()`
 * before its single `save()`, which `docs/01` §5.2 recommends "at creation
 * time". `Zotero.Collection.prototype.addItems()` does exist on Zotero 10.0.1
 * (see `collectionOps.ts`), but it is the wrong tool here: it re-saves an
 * already-saved item, so using it would mean two `save()` calls for one new
 * item.
 *
 * **No `undoAction`.** `docs/01` §5.2 marks `'undo-action-add-item'`
 * unverified; it does not exist in Zotero 10.0.1's `zotero.ftl` (grepped —
 * see the card report), and `P0-T10` says omit rather than invent. `save()`
 * inside a transaction takes no undo option in any case.
 *
 * **Second click.** Deliberately creates a *second* item and reuses the
 * existing collection. There is no de-duplication in this spike: dedupe is
 * Phase 2 (`docs/07` §6, `src/sources/shared/dedupe.ts`), and a spike that
 * silently did nothing on the second click would hide the very failure
 * `P0-T11` cycles looking for.
 */
export async function createSpikeArticle(): Promise<SpikeArticleResult> {
  // Gate first, and outside the transaction: the schema promise can involve a
  // network fetch, and docs/01 §12 gotcha 13 forbids that inside one.
  await schemaReady();

  const libraryID = userLibraryID();
  logFieldSupport();

  const result = await Zotero.DB.executeTransaction(
    async (): Promise<SpikeArticleResult> => {
      const { collection, created } = await findOrCreateCollection(
        SPIKE_COLLECTION_NAME,
        libraryID,
      );

      const item = buildJournalArticle(SPIKE_RECORD, libraryID);
      item.setCollections([collection.id]);
      // save(), not saveTx(): docs/01 §5.8 / §12 gotcha 12.
      await item.save();

      return {
        itemID: item.id,
        itemKey: item.key,
        collectionID: collection.id,
        collectionName: collection.name,
        collectionCreated: created,
      };
    },
  );

  debug(
    `P0-T10 created item ${result.itemID} (key ${result.itemKey}) tagged ` +
      `"${RESEARCH_HELPER_TAG}" in collection ${result.collectionID} ` +
      `"${result.collectionName}" (${result.collectionCreated ? "created" : "reused"})`,
  );
  return result;
}

/**
 * Feature-detect the field keys this card writes, rather than trusting a
 * hand-copied list (`docs/01` §12 gotcha 28).
 *
 * Purely diagnostic: `fromJSON()` in strict mode is what actually fails the
 * run if a key is wrong. This exists so the debug log says *which* key, which
 * is the difference between a five-minute and a one-hour diagnosis when a
 * schema bump moves something.
 *
 * Must run after {@link schemaReady} (gotcha 29).
 */
function logFieldSupport(): void {
  const fields = ["title", "abstractNote", "DOI"];
  const missing = fields.filter((field) => !Zotero.ItemFields.getID(field));
  if (missing.length > 0) {
    debug(
      `schema ${String(Zotero.Schema.globalSchemaVersion)} has no field key ` +
        `for: ${missing.join(", ")}`,
    );
  }
}
