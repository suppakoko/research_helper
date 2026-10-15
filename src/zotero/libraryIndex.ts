/**
 * Existing-item detection: "does this DOI, PMID, arXiv id or work key already
 * exist in this library?" (`P1-T13`, widened by `P2-T19`; `docs/10` FR-51).
 *
 * **Why an index and not a lookup.** `docs/02` §11.6 is explicit: build the
 * index **once per run** from a single read of the library, then every
 * candidate costs an O(1) map lookup. The alternative — one
 * `Zotero.Search` per incoming record — issues N searches for N candidates,
 * and a 200-record PubMed run is 200 searches against a library that has not
 * changed between the first and the last. That is the shape `P1-T13`'s
 * **Do NOT** list forbids.
 *
 * So {@link buildLibraryIndex} performs **exactly one** `Zotero.Search` and
 * {@link LibraryIndex.findExisting} is **synchronous**. The synchronous
 * signature is not a convenience; it is the compile-time proof that the hot
 * path cannot reach the database.
 *
 * **Two places, one identifier.** `docs/01` §5.5: "Run **both** branches. Many
 * items in a real library were saved before schema 34 and still hold the
 * identifier in `Extra`." Measured on Zotero 10.0.3 (`P1-T12`),
 * `fromJSON(json, { strict: true })` happily accepts an item carrying **both**
 * a native `PMID` field and a foreign `extra` line `PMID: 999` — it does not
 * migrate, deduplicate or reject. So an identifier may live in the native
 * field, in `extra`, in both, or in both *disagreeing*, and this module indexes
 * every value it finds rather than choosing between them.
 *
 * **One `extra` parser.** Every `extra` read here goes through
 * {@link parseExtra} / {@link findExtraLine} from `./extraField`, which is the
 * write path's own parser (`docs/07` §6.3). A second, line-oriented parser is
 * how the two halves drift — and `P1-T12` measured the specific way it breaks:
 * `\r` is a JavaScript line terminator, so a value group written `.*` matches
 * nothing on a **CRLF** `extra` field and every line parses as key-less.
 *
 * **No fuzzy matching, deliberately.** `P1-T13`'s and `P2-T19`'s **Do NOT**:
 * FR-50's fuzzy title cascade is `P2-T09`'s `src/sources/shared/dedupe.ts`
 * (`matchAgainstLibrary`, over its own `byTitle` / `bySignature` buckets), and
 * `R-18` makes a false merge the expensive error. `byTitle` from `docs/02`
 * §11.6's sketch is therefore *not* built here. What **is** built, since
 * `P2-T19`: §11.6's `byArxiv`, and a `byWorkKey` map over the `rh-work-key`
 * lines this plugin itself wrote (`docs/07` §6.2), so a record whose only
 * identifier is an arXiv id or a Semantic Scholar corpus id — the records the
 * Phase 2 preprint adapters import — still has a join key the index can see.
 *
 * **Four arms, in `docs/07` §5.1's order, and the work key is last.** DOI,
 * then PMID, then arXiv id, then the stored work key. The work key is the
 * weakest evidence of the four: its own first three arms duplicate the
 * identifier maps, its `s2:` arm is the one thing only it can match, and its
 * `hash:` arm is `sha1(title|year|firstAuthor)` — which can collide on a
 * title alone, so it must never outrank an identifier that disagrees with it.
 * Only keys *stored* by this plugin are indexed; nothing here derives a hash
 * key from a library item's title, because that would be title matching by
 * another name.
 *
 * **No `ZoteroPane` selection getter is consulted.** `docs/01` §3.4(a) and §12
 * gotcha 3: `getSelectedCollection()`, `getSelectedLibraryID()` and
 * `getCollectionTreeRow()` **throw** on Zotero 10, and Zotero's own JavaScript
 * API page still shows them. This module takes its `libraryID` as an argument;
 * resolving a *selection* into one belongs to the UI cards (`P1-T21`/`P1-T22`).
 *
 * **No `Zotero.Duplicates`.** `docs/01` §5.5: it is a library-wide,
 * UI-oriented heuristic scan — "useless for 'does this DOI already exist'".
 *
 * Sandbox caveats (`docs/01` §2.3, measured `P0-T08`): no `performance`, no
 * `console`, no `AbortController`. {@link Date.now} is the clock.
 */

import {
  type ArxivId,
  type Doi,
  type ExternalIds,
  type Pmid,
  buildWorkKey,
  normalizeArxivId,
  normalizeDoi,
  normalizePmid,
} from "../model/ids";
import {
  findExtraLine,
  parseExtra,
  readS2CorpusId,
  readWorkKey,
} from "./extraField";
import { ECOSYSTEM_EXTRA_KEY } from "./itemMapper";

// ---------------------------------------------------------------------------
// 1. Field and `extra`-line names
// ---------------------------------------------------------------------------

/**
 * The Zotero field keys read, and the `extra` keys read as their fallback.
 *
 * `DOI`/`PMID` are `journalArticle` fields (`docs/07` §6.1) and therefore
 * automatically search conditions too: `docs/01` §5.5, and confirmed by
 * reading Zotero 10.0.3's `searchConditions.js`, where every name in
 * `fieldsCombined` except `accessDate`, `date`, `pages`, `section`,
 * `seriesNumber` and `issue` is registered as an alias of the generic `field`
 * condition. No registration is needed.
 *
 * `archiveID` is the `preprint` field `docs/07` §6.2 fills with
 * `arXiv:<id>` (and `docs/02` §11.6 names as the `byArxiv` source); on every
 * other type it reads as `""`.
 *
 * `Zotero.Item.prototype.getField()` returns `""` — it does not throw — for a
 * field that is not valid for the item's type (read from `item.js` on
 * 10.0.3: `if (value === undefined) return ''`), so these are safe to ask of
 * every item the search returns, including a standalone note or attachment.
 */
const FIELD = {
  doi: "DOI",
  pmid: "PMID",
  archiveID: "archiveID",
  extra: "extra",
} as const;

/**
 * The non-namespaced `extra` keys the ecosystem writes for these identifiers
 * (`docs/07` §6.3's "standard, non-namespaced lines the ecosystem already
 * understands"). The *same declaration* the write path uses
 * (`itemMapper.ts`'s {@link ECOSYSTEM_EXTRA_KEY}), so the spelling looked for
 * here is the spelling written there. Matched case-insensitively by
 * {@link findExtraLine}.
 */
const EXTRA_KEY = ECOSYSTEM_EXTRA_KEY;

// ---------------------------------------------------------------------------
// 2. The result type
// ---------------------------------------------------------------------------

/**
 * One hit: the library item an incoming record turned out to already be.
 *
 * `matchedOn` names the arm that hit, in the order the arms are tried:
 * `P1-T13`'s `"doi"` and `"pmid"`, then `P2-T19`'s `"arxiv"` (the `archiveID`
 * field or an `arXiv:` line) and `"workKey"` (a stored `rh-work-key` line).
 * `"workKey"` is last because it is the weakest evidence — see the module
 * comment — so a caller that sees it knows no identifier corroborated the hit.
 */
export interface ExistingItemMatch {
  readonly itemID: number;
  readonly matchedOn: "doi" | "pmid" | "arxiv" | "workKey";
}

/** What building the index cost, so a caller can assert and log it. */
export interface LibraryIndexStats {
  /**
   * `Zotero.Search#search()` calls made while building. **One**, per
   * `docs/02` §11.6 and `P1-T13`'s fourth criterion — independent of library
   * size, because the single search has no per-candidate component.
   */
  readonly searchCount: number;
  /** Items the search returned, before the trashed and identifier-less ones are dropped. */
  readonly itemsScanned: number;
  /** Items dropped because {@link Zotero.Item.deleted} was true (`docs/02` §11.6). */
  readonly trashedSkipped: number;
  /** Wall-clock build time, ms. `Date.now()`: the sandbox has no `performance`. */
  readonly elapsedMs: number;
}

/**
 * A snapshot of one library's DOI, PMID and arXiv identifiers and of the work
 * keys this plugin stored in it.
 *
 * **A snapshot, not a live view.** `docs/02` §11.6's "once per run" is the
 * whole point; nothing here observes `Zotero.Notifier`. A run that writes
 * items and then wants to see them must rebuild.
 */
export interface LibraryIndex {
  readonly libraryID: number;
  /** Normalized DOI → `itemID` (`docs/02` §11.1: the normalized form is the dictionary key). */
  readonly byDoi: ReadonlyMap<string, number>;
  /** Bare-digits PMID → `itemID`. */
  readonly byPmid: ReadonlyMap<string, number>;
  /**
   * Version-stripped arXiv id → `itemID` (`docs/02` §11.6's `byArxiv`), from
   * the `preprint` type's `archiveID` field and from `arXiv:` lines in `extra`
   * — both, always, for the reason the module comment gives for DOI and PMID.
   */
  readonly byArxiv: ReadonlyMap<string, number>;
  /**
   * Stored `rh-work-key` → `itemID`. Exactly the string `docs/07` §6.2 wrote
   * (`doi:…`, `pmid:…`, `arxiv:…`, `s2:…` or `hash:…`), read back through
   * `extraField.ts`'s `readWorkKey`, never derived from the item's title.
   *
   * **Plus one derived key per item, since `P2-T34` (2026-10-15):** the
   * `s2:<corpusId>` key of an item carrying §6.2's `rh-s2-corpus-id` line, so
   * the S2 arm of {@link findExisting} reaches an item whose `rh-work-key` was
   * lost — or whose stored key is another arm (`doi:…`) while a record names
   * it by its corpus id alone. It is built by `buildWorkKey` from the
   * identifier, never from a title, so it is no title matching.
   */
  readonly byWorkKey: ReadonlyMap<string, number>;
  readonly stats: LibraryIndexStats;
  /**
   * Is this record already in the library?
   *
   * Synchronous by design — see the module comment. The arms are tried in
   * `docs/07` §5.1's order — DOI, PMID, arXiv id, work key — so a record whose
   * identifiers point at different items reports the strongest one, and the
   * work key, the weakest, decides only when no identifier matched anything.
   *
   * `workKey` is the record's `CanonicalWork.workKey` when the caller has one.
   * When it is omitted the key is derived from `ids` through
   * {@link buildWorkKey} — the only place the five-arm precedence is defined —
   * **but only as far as its identifier arms reach**: with no DOI, PMID, arXiv
   * id or S2 corpus id the derivation would be the hash arm over a title this
   * function does not have, so no key is tried at all. A caller that wants a
   * `hash:` key matched must pass the key it built.
   *
   * Every identifier is re-normalized on the way in, so a caller that has not
   * been through {@link normalizeDoi} still matches: that is what makes
   * `10.18653/V1/2020.acl-main.447` find the stored
   * `10.18653/v1/2020.acl-main.447`, and `arXiv:2106.15928v2` find the stored
   * `2106.15928`.
   */
  findExisting(
    ids: ExternalIds,
    workKey?: string,
  ): ExistingItemMatch | undefined;
}

// ---------------------------------------------------------------------------
// 3. Reading one item's identifiers
// ---------------------------------------------------------------------------

/**
 * Every DOI this item carries, normalized: the native `DOI` field and a
 * non-namespaced `DOI:` line in `extra`.
 *
 * `docs/02` §11.6 populates the index "from `item.getField('DOI')`,
 * `item.getField('PMID')` … and `extra` lines", so both places are read for
 * both identifiers. An item type with no native `DOI` field (and Zotero's own
 * convention of putting `DOI: …` in `extra` for those types) is the case the
 * second branch exists for.
 *
 * Returns at most two values, deduplicated by the caller's map insert.
 */
function doisOf(item: Zotero.Item): readonly Doi[] {
  const out: Doi[] = [];
  const native = normalizeDoi(item.getField(FIELD.doi));
  if (native !== null) out.push(native);
  const line = findExtraLine(
    parseExtra(item.getField(FIELD.extra)),
    EXTRA_KEY.doi,
  );
  const fromExtra = normalizeDoi(line?.value);
  if (fromExtra !== null && fromExtra !== native) out.push(fromExtra);
  return out;
}

/**
 * Every PMID this item carries, bare-digits: the native `PMID` field **and** a
 * `PMID:` line in `extra`.
 *
 * Both branches always run — `docs/01` §5.5's instruction, and `P1-T12`'s
 * measurement that a single item can legitimately hold both. The `extra`
 * branch is not a fallback for the native one; they are two independent
 * sources and either may be the one an incoming record matches.
 */
function pmidsOf(item: Zotero.Item): readonly Pmid[] {
  const out: Pmid[] = [];
  const native = normalizePmid(item.getField(FIELD.pmid));
  if (native !== null) out.push(native);
  const line = findExtraLine(
    parseExtra(item.getField(FIELD.extra)),
    EXTRA_KEY.pmid,
  );
  const fromExtra = normalizePmid(line?.value);
  if (fromExtra !== null && fromExtra !== native) out.push(fromExtra);
  return out;
}

/**
 * Every arXiv id this item carries, version-stripped: the `preprint` type's
 * native `archiveID` field (`docs/07` §6.2 writes `arXiv:<id>` there, and
 * {@link normalizeArxivId} strips that scheme) **and** an `arXiv:` line in
 * `extra` (§6.2's row for every other item type, since no type but `preprint`
 * has a native home for it — `docs/02` §10.3).
 *
 * Same two-branches-always shape as {@link doisOf} / {@link pmidsOf}, for the
 * same measured reason: nothing migrates between the two homes.
 */
function arxivIdsOf(item: Zotero.Item): readonly ArxivId[] {
  const out: ArxivId[] = [];
  const native = normalizeArxivId(item.getField(FIELD.archiveID));
  if (native !== null) out.push(native);
  const line = findExtraLine(
    parseExtra(item.getField(FIELD.extra)),
    EXTRA_KEY.arxiv,
  );
  const fromExtra = normalizeArxivId(line?.value);
  if (fromExtra !== null && fromExtra !== native) out.push(fromExtra);
  return out;
}

/**
 * The work key this plugin stored on the item, if any: the `rh-work-key`
 * line `docs/07` §6.2 writes on every import, read through the write path's
 * own `readWorkKey` (§6.3: one parser). Taken verbatim — it is already the
 * canonical string, and re-deriving it from the item's fields is what
 * {@link fromZoteroItem} in `itemMapper.ts` does for an item that has none.
 */
function workKeyOf(item: Zotero.Item): string | undefined {
  return readWorkKey(item.getField(FIELD.extra));
}

/**
 * The `s2:<corpusId>` key of an item carrying `docs/07` §6.2's
 * `rh-s2-corpus-id` line (`P2-T34`), or `undefined` without one. Built by
 * {@link buildWorkKey} from the corpus id alone — the one place the key's
 * spelling is defined — so it is exactly the key the write path stores for an
 * S2-only work and the key {@link identifierWorkKey} derives for a record
 * whose only identifier is that corpus id.
 */
function s2WorkKeyOf(item: Zotero.Item): string | undefined {
  const s2CorpusId = readS2CorpusId(item.getField(FIELD.extra));
  return s2CorpusId === undefined
    ? undefined
    : buildWorkKey({ s2CorpusId }, "");
}

/**
 * First value wins.
 *
 * A library can hold two items with the same DOI — Zotero does not enforce
 * uniqueness — and FR-51 only needs *an* existing item to add to the
 * collection, so the choice merely has to be stable for a given scan order.
 * Keeping the first is that; overwriting would make the answer depend on which
 * duplicate the scan happened to reach last, which is the same information with
 * an extra chance to change under a Zotero query-planner change. The search
 * emits no `ORDER BY`, so which duplicate is "first" is Zotero's to decide and
 * is deliberately not asserted anywhere.
 */
function keepFirst<K>(map: Map<K, number>, key: K, itemID: number): void {
  if (!map.has(key)) map.set(key, itemID);
}

// ---------------------------------------------------------------------------
// 4. Building the index — one search
// ---------------------------------------------------------------------------

/**
 * Read the library once and index its DOIs, PMIDs, arXiv ids and stored work
 * keys. **Still one search** (`P2-T19` step 4): the third and fourth maps are
 * filled from the same item pass as the first two, so they cost `getField`
 * reads, not queries.
 *
 * The search is deliberately condition-poor: `deleted false` and
 * `noChildren true` are both *special* conditions in Zotero's search compiler
 * (they set flags on the generated SQL rather than adding a predicate), so the
 * query is "every top-level, non-trashed item in this library" — one
 * `SELECT`, no per-candidate component. Verified by reading
 * `data/search.js`'s `_buildQuery()` in the installed Zotero 10.0.3: with no
 * primary condition it emits `SELECT itemID FROM items WHERE (itemID NOT IN
 * (…deletedItems…)) AND (…noChildren…) AND (itemID IN (SELECT itemID FROM
 * items WHERE libraryID=?))`.
 *
 * `noChildren` is asked for because a child note or attachment can never carry
 * a DOI or a PMID, and loading tens of thousands of them is the whole cost of
 * this function. Standalone notes and attachments are *not* excluded — there
 * is no condition for that which does not also add a primary predicate — and
 * they are harmless: {@link Zotero.Item.getField} returns `""` for a field the
 * type does not have.
 *
 * Trashed items are excluded twice: by the search condition, and again by
 * `item.deleted` when populating. `docs/02` §11.6 asks for the second check by
 * name, and it is also what makes the guarantee survive a caller that hands in
 * items from somewhere else.
 *
 * **`addCondition` takes three arguments, never four.** `docs/01` §5.5 and
 * §3.4(b): Zotero 10 *throws* on the legacy `required` parameter — confirmed
 * in 10.0.3's source, whose first statement is
 * `if (required) throw new Error("The 'required' parameter is no longer
 * supported; use a condition group")`.
 *
 * **No condition group.** `docs/01` §5.5 flags `joinMode`-inside-a-group
 * semantics as *unverified*; this function needs no group at all, which is the
 * cheapest way to respect that.
 *
 * @param libraryID - the library to index; defaults to the user library
 * @returns the snapshot, its four maps, and what the build cost
 */
export async function buildLibraryIndex(
  libraryID: number = Zotero.Libraries.userLibraryID,
): Promise<LibraryIndex> {
  const startedAt = Date.now();

  // `new Zotero.Search({ libraryID })`, not `s.libraryID = …`. `docs/01` §5.5's
  // samples assign the property, but `Zotero.DataObject#libraryID` is declared
  // `readonly` by `zotero-types@4.1.3`, so the documented form is a TS2540. The
  // constructor's `params` reach the same setter — 10.0.3's `Zotero.Search`
  // calls `Zotero.Utilities.Internal.assignProps(this, params, ['name',
  // 'libraryID'])` — so this is the same assignment, spelled compilably.
  const search = new Zotero.Search({ libraryID });
  // Special conditions: no SQL predicate, no primary condition, no group.
  // The third argument is the value, which these two ignore; the *fourth*
  // argument is the one that throws, and is never passed.
  search.addCondition("deleted", "false", "");
  search.addCondition("noChildren", "true", "");
  const itemIDs = await search.search();
  const searchCount = 1;

  const items = await Zotero.Items.getAsync(itemIDs);
  // `getField()` throws `Zotero.Exception.UnloadedDataException` when the
  // item's `itemData` has not been loaded, and an item already in Zotero's
  // object cache may have arrived there without it. One batched load here is
  // also far cheaper than the lazy per-item load it replaces.
  await Zotero.Items.loadDataTypes(items);

  const maps: IndexMaps = {
    byDoi: new Map<string, number>(),
    byPmid: new Map<string, number>(),
    byArxiv: new Map<string, number>(),
    byWorkKey: new Map<string, number>(),
  };
  let trashedSkipped = 0;

  for (const item of items) {
    // One skip for all four maps: a trashed item is in none of them
    // (`docs/02` §11.6), so it cannot be returned on any arm.
    if (item.deleted) {
      trashedSkipped += 1;
      continue;
    }
    const itemID = item.id;
    for (const doi of doisOf(item)) keepFirst(maps.byDoi, doi, itemID);
    for (const pmid of pmidsOf(item)) keepFirst(maps.byPmid, pmid, itemID);
    for (const arxivId of arxivIdsOf(item)) {
      keepFirst(maps.byArxiv, arxivId, itemID);
    }
    const workKey = workKeyOf(item);
    if (workKey !== undefined) keepFirst(maps.byWorkKey, workKey, itemID);
    const s2Key = s2WorkKeyOf(item);
    if (s2Key !== undefined) keepFirst(maps.byWorkKey, s2Key, itemID);
  }

  const stats: LibraryIndexStats = {
    searchCount,
    itemsScanned: items.length,
    trashedSkipped,
    elapsedMs: Date.now() - startedAt,
  };

  return {
    libraryID,
    ...maps,
    stats,
    findExisting: (ids, workKey) => lookup(maps, ids, workKey),
  };
}

/** The four maps, mutable while building and read-only once returned. */
interface IndexMaps {
  readonly byDoi: Map<string, number>;
  readonly byPmid: Map<string, number>;
  readonly byArxiv: Map<string, number>;
  readonly byWorkKey: Map<string, number>;
}

/**
 * The O(1) half of the card: at most four map reads, no I/O.
 *
 * The order is `docs/07` §5.1's and is load-bearing — see the module comment
 * on why the work key is last. Extracted so {@link buildLibraryIndex} and any
 * future caller that already holds the maps share one precedence rule.
 */
function lookup(
  maps: IndexMaps,
  ids: ExternalIds,
  workKey: string | undefined,
): ExistingItemMatch | undefined {
  const doi = normalizeDoi(ids.doi);
  if (doi !== null) {
    const itemID = maps.byDoi.get(doi);
    if (itemID !== undefined) return { itemID, matchedOn: "doi" };
  }
  const pmid = normalizePmid(ids.pmid);
  if (pmid !== null) {
    const itemID = maps.byPmid.get(pmid);
    if (itemID !== undefined) return { itemID, matchedOn: "pmid" };
  }
  const arxivId = normalizeArxivId(ids.arxivId);
  if (arxivId !== null) {
    const itemID = maps.byArxiv.get(arxivId);
    if (itemID !== undefined) return { itemID, matchedOn: "arxiv" };
  }
  // Last, and only now: the weakest arm. See the module comment.
  const key = workKey ?? identifierWorkKey(ids, doi, pmid, arxivId);
  if (key !== undefined) {
    const itemID = maps.byWorkKey.get(key);
    if (itemID !== undefined) return { itemID, matchedOn: "workKey" };
  }
  return undefined;
}

/**
 * The work key `buildWorkKey` derives from identifiers alone, or `undefined`
 * when it would have to fall through to the hash arm.
 *
 * `buildWorkKey` owns the precedence (`docs/07` §5.1; `P2-T19`'s **Read
 * first**: "call it; never reimplement"), so it is called with the normalized
 * identifiers and an empty title, and its answer is kept only if it is not a
 * hash — a `hash:` here would be `sha1("|year|author")` over a title this
 * module never sees, a key no write path ever stored. The S2 corpus id is
 * passed through as the caller gave it: `docs/02` §11.3.1 defines no
 * normalizer for it and `buildWorkKey` wrote it verbatim.
 */
function identifierWorkKey(
  ids: ExternalIds,
  doi: Doi | null,
  pmid: Pmid | null,
  arxivId: ArxivId | null,
): string | undefined {
  const key = buildWorkKey(
    {
      ...(doi === null ? {} : { doi }),
      ...(pmid === null ? {} : { pmid }),
      ...(arxivId === null ? {} : { arxivId }),
      ...(ids.s2CorpusId === undefined || ids.s2CorpusId === ""
        ? {}
        : { s2CorpusId: ids.s2CorpusId }),
    },
    "",
  );
  return key.startsWith("hash:") ? undefined : key;
}

// ---------------------------------------------------------------------------
// 5. The fallback — flat searches, unioned
// ---------------------------------------------------------------------------

/**
 * Find one record's existing item with **flat searches only**, unioning the
 * results.
 *
 * `P1-T13` step 5 requires this, and `docs/01` §5.5 says why: the exact
 * semantics of `joinMode` inside a `groupStart`/`groupEnd` pair on Zotero 10
 * are *unverified*, "so keep a fallback that runs two flat searches and unions
 * the results". This is that fallback. It issues up to three searches — one
 * for the DOI, and §5.5's two `findByPMID` branches — every one of them flat,
 * with no group and no `joinMode`. It still has `P1-T13`'s two arms only:
 * `P2-T19` widened the *index*, and its criteria name the index; the arXiv
 * and work-key arms of a per-record search would be two more `extra contains`
 * queries nothing yet calls for.
 *
 * **It is the fallback, not the path.** It costs O(candidates) searches, which
 * is exactly what {@link buildLibraryIndex} exists to avoid. Use it for a
 * single record (a re-check of one row, a diagnostic), never in a loop over an
 * import batch.
 *
 * **Why `contains` and not `is`.** `docs/01` §5.5's reference `findByDOI` uses
 * `addCondition('DOI', 'is', doi)`, and on Zotero 10.0.3 that is
 * **case-sensitive**: `data/search.js` compiles `is` on a non-numeric value to
 * `value=?` against the raw column, while `contains` compiles to `LIKE ?`
 * against the `COALESCE(valueNormalized, value)` shadow column with a
 * `normalizeForSearch()`-ed term — case- and diacritic-insensitive. A library
 * item stored as `10.18653/V1/…` by a translator would therefore be *missed*
 * by an `is` search for the normalized lowercase DOI, which is precisely
 * `P1-T13`'s third criterion. So the search is widened to `contains` and every
 * candidate is then verified exactly, in memory, against
 * {@link doisOf}/{@link pmidsOf} — the same readers the index uses. The
 * widening cannot produce a false positive for that reason: `contains` is a
 * substring match, so `10.1/abc` would otherwise match `10.1/abcd`.
 *
 * A numeric `is` is kept for the native `PMID` field: Zotero compiles `is` on
 * an all-digits value to `LIKE ?` with no wildcards, which is exact.
 *
 * @param ids - the incoming record's identifiers
 * @param libraryID - the library to search; defaults to the user library
 * @returns the first verified match, or `undefined`
 */
export async function findExistingByFlatSearches(
  ids: ExternalIds,
  libraryID: number = Zotero.Libraries.userLibraryID,
): Promise<ExistingItemMatch | undefined> {
  const doi = normalizeDoi(ids.doi);
  if (doi !== null) {
    const hit = await firstVerified(
      libraryID,
      [{ condition: FIELD.doi, operator: "contains", value: doi }],
      (item) => doisOf(item).includes(doi),
    );
    if (hit !== undefined) return { itemID: hit, matchedOn: "doi" };
  }

  const pmid = normalizePmid(ids.pmid);
  if (pmid !== null) {
    // §5.5's two branches, run as two flat searches and unioned by
    // `firstVerified` rather than combined into one condition group.
    const hit = await firstVerified(
      libraryID,
      [
        { condition: FIELD.pmid, operator: "is", value: pmid },
        // The ecosystem's spelling (`docs/07` §6.3). `contains` is a substring
        // match, so this also returns `PMID: 9991` when asked for `999` —
        // which is why the verifier, not the search, decides.
        {
          condition: FIELD.extra,
          operator: "contains",
          value: `${EXTRA_KEY.pmid}: ${pmid}`,
        },
      ],
      (item) => pmidsOf(item).includes(pmid),
    );
    if (hit !== undefined) return { itemID: hit, matchedOn: "pmid" };
  }

  return undefined;
}

/** One flat `Zotero.Search` condition. */
interface FlatCondition {
  readonly condition: string;
  readonly operator: "is" | "contains";
  readonly value: string;
}

/**
 * Run each condition as its own flat search, union the ids in order, and
 * return the first item `verify` accepts.
 *
 * Every search carries `deleted false`, and each candidate's `item.deleted` is
 * checked again, so a trashed item can never be returned (`docs/02` §11.6).
 */
async function firstVerified(
  libraryID: number,
  conditions: readonly FlatCondition[],
  verify: (item: Zotero.Item) => boolean,
): Promise<number | undefined> {
  const seen = new Set<number>();
  for (const flat of conditions) {
    // See `buildLibraryIndex` on why `libraryID` goes through the constructor.
    const search = new Zotero.Search({ libraryID });
    search.addCondition(flat.condition, flat.operator, flat.value);
    search.addCondition("deleted", "false", "");
    for (const itemID of await search.search()) {
      if (seen.has(itemID)) continue;
      seen.add(itemID);
    }
  }
  if (seen.size === 0) return undefined;

  const candidates = await Zotero.Items.getAsync([...seen]);
  await Zotero.Items.loadDataTypes(candidates);
  for (const item of candidates) {
    if (item.deleted) continue;
    if (verify(item)) return item.id;
  }
  return undefined;
}
