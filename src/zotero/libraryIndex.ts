/**
 * Existing-item detection: "does this DOI or PMID already exist in this
 * library?" (`P1-T13`, `docs/10` FR-51).
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
 * **No fuzzy matching, deliberately.** `P1-T13`'s **Do NOT**: FR-50's fuzzy
 * title cascade is Phase 2 (`P2-T09`), and `R-18` makes a false merge the
 * expensive error. `byTitle` from `docs/02` §11.6's sketch is therefore *not*
 * built here, and neither is `byArxiv` — `P1-T13` names `byDoi` and `byPmid`
 * and nothing else.
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
  type Doi,
  type ExternalIds,
  type Pmid,
  normalizeDoi,
  normalizePmid,
} from "../model/ids";
import { findExtraLine, parseExtra } from "./extraField";

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
 * `Zotero.Item.prototype.getField()` returns `""` — it does not throw — for a
 * field that is not valid for the item's type (read from `item.js` on
 * 10.0.3: `if (value === undefined) return ''`), so these are safe to ask of
 * every item the search returns, including a standalone note or attachment.
 */
const FIELD = {
  doi: "DOI",
  pmid: "PMID",
  extra: "extra",
} as const;

/**
 * The non-namespaced `extra` keys the ecosystem writes for these identifiers
 * (`docs/07` §6.3's "standard, non-namespaced lines the ecosystem already
 * understands"). Matched case-insensitively by {@link findExtraLine}.
 */
const EXTRA_KEY = {
  doi: "DOI",
  pmid: "PMID",
} as const;

// ---------------------------------------------------------------------------
// 2. The result type
// ---------------------------------------------------------------------------

/**
 * One hit: the library item an incoming record turned out to already be.
 *
 * `matchedOn` is exactly `P1-T13`'s two arms. It is **not** the work-key
 * precedence of `docs/07` §5.1/§6.6 — there is deliberately no `"workKey"`
 * arm, because this card detects "by DOI and PMID" and widening the union
 * would be widening the card (`plan/README.md` §5 rule 2).
 */
export interface ExistingItemMatch {
  readonly itemID: number;
  readonly matchedOn: "doi" | "pmid";
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
 * A snapshot of one library's DOI and PMID identifiers.
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
  readonly stats: LibraryIndexStats;
  /**
   * Is this record already in the library?
   *
   * Synchronous by design — see the module comment. DOI is tried before PMID,
   * matching FR-51's wording ("by DOI or PMID") and §5.1's identifier
   * precedence, so a record whose DOI and PMID point at different items
   * reports the DOI one.
   *
   * Both identifiers are re-normalized on the way in, so a caller that has not
   * been through {@link normalizeDoi} still matches: that is what makes
   * `10.18653/V1/2020.acl-main.447` find the stored
   * `10.18653/v1/2020.acl-main.447`.
   */
  findExisting(ids: ExternalIds): ExistingItemMatch | undefined;
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
 * Read the library once and index its DOIs and PMIDs.
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
 * @returns the snapshot, its two maps, and what the build cost
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

  const byDoi = new Map<string, number>();
  const byPmid = new Map<string, number>();
  let trashedSkipped = 0;

  for (const item of items) {
    if (item.deleted) {
      trashedSkipped += 1;
      continue;
    }
    const itemID = item.id;
    for (const doi of doisOf(item)) keepFirst(byDoi, doi, itemID);
    for (const pmid of pmidsOf(item)) keepFirst(byPmid, pmid, itemID);
  }

  const stats: LibraryIndexStats = {
    searchCount,
    itemsScanned: items.length,
    trashedSkipped,
    elapsedMs: Date.now() - startedAt,
  };

  return {
    libraryID,
    byDoi,
    byPmid,
    stats,
    findExisting: (ids) => lookup(byDoi, byPmid, ids),
  };
}

/**
 * The O(1) half of the card: two map reads, no I/O.
 *
 * Extracted so {@link buildLibraryIndex} and any future caller that already
 * holds the maps share one precedence rule.
 */
function lookup(
  byDoi: ReadonlyMap<string, number>,
  byPmid: ReadonlyMap<string, number>,
  ids: ExternalIds,
): ExistingItemMatch | undefined {
  const doi = normalizeDoi(ids.doi);
  if (doi !== null) {
    const itemID = byDoi.get(doi);
    if (itemID !== undefined) return { itemID, matchedOn: "doi" };
  }
  const pmid = normalizePmid(ids.pmid);
  if (pmid !== null) {
    const itemID = byPmid.get(pmid);
    if (itemID !== undefined) return { itemID, matchedOn: "pmid" };
  }
  return undefined;
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
 * with no group and no `joinMode`.
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
