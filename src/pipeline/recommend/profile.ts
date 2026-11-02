/**
 * The statistical half of a collection profile — `docs/05` §7.2, as built by
 * `P5-T18`.
 *
 * Local only: nothing here sends anything anywhere. `docs/05` §7.2's note of
 * 2026-11-02 holds the term rules and `docs/07` §5.2's note of that date the
 * shape of the steps; this header does not repeat them.
 *
 * **Callers.** Nothing calls this yet. `recommendPipeline.ts` (`P5-T25`) runs
 * {@link readProfileCollection}, compares {@link membershipHash} with the stored
 * profile, then {@link buildProfileStats}, and after `P5-T21` and `P5-T22` have
 * filled in the rest, {@link persistProfile}. On every run it also takes
 * {@link profileOwnedSets} (`P5-T24`) and {@link addedAtByWorkKey} (`seeds.ts`,
 * `P5-T21`). {@link RecommendLibrary} is built by `createZoteroRecommendLibrary`
 * in `src/bootstrap/registerPipelines.ts`.
 *
 * **Deterministic.** Everything is keyed and sorted by UTF-16 code unit, so the
 * answer does not depend on the order items are read in, and no locale is consulted.
 */

import { sha256Hex } from "../../core/cache/keys";
import type { Author } from "../../model/canonicalWork";
import type { CollectionProfile } from "../../model/profile";
import { normalizeTitle, titleTokens } from "../../sources/shared/dedupe";
import {
  collectionProfileId,
  type CollectionProfileStore,
} from "../../zotero/db";
import type {
  CollectionWorkRead,
  CollectionWorksRead,
  ItemTermSource,
} from "../../zotero/itemMapper";
import type { LibraryIndex } from "../../zotero/libraryIndex";

/** FR-44: a profile needs a collection of at least this many items. */
export const MIN_PROFILE_ITEMS = 5;

/** `docs/05` §7.2's note of 2026-11-02, item 2: a major topic's extra share. */
export const MAJOR_TOPIC_BOOST = 0.5;

/** Item 3: a term known only from titles needs this many collection items. */
export const MIN_TITLE_TERM_ITEMS = 2;

/** Item 5: what the stored lists keep. */
export const MAX_PROFILE_TERMS = 100;
export const MAX_PROFILE_SUBJECTS = 100;
/** `docs/05` §7.4: `venueAffinity` reads the profile's top 10. */
export const MAX_PROFILE_VENUES = 10;

/** `Subject.scheme`s, as `src/zotero/itemMapper.ts` reads them back. */
export const MESH_SCHEME = "mesh";
export const ARXIV_SCHEME = "arxiv-category";

/**
 * `docs/05` §7.2's check tags, normalised: indexing artefacts, never topics. The
 * full list and its comparison with NLM's sources are in that section's note of
 * 2026-11-02, item 1.
 */
const CHECK_TAGS: ReadonlySet<string> = new Set(
  [
    "Humans",
    "Animals",
    "Male",
    "Female",
    "Infant",
    "Infant, Newborn",
    "Child",
    "Child, Preschool",
    "Adolescent",
    "Young Adult",
    "Adult",
    "Middle Aged",
    "Aged",
    "Aged, 80 and over",
    "Pregnancy",
    "Mice",
    "Rats",
    "Cats",
    "Cattle",
    "Chick Embryo",
    "Cricetinae",
    "Dogs",
    "Guinea Pigs",
    "Horses",
    "Rabbits",
    "Sheep",
    "Swine",
    "History, Ancient",
    "History, Medieval",
    "History, 15th Century",
    "History, 16th Century",
    "History, 17th Century",
    "History, 18th Century",
    "History, 19th Century",
    "History, 20th Century",
    "History, 21st Century",
  ].map(normalizeTitle),
);

/** Whether `term` is one of {@link CHECK_TAGS}. Caller: `profileCall.ts` (`P5-T22`). */
export function isCheckTag(term: string): boolean {
  return CHECK_TAGS.has(normalizeTitle(term));
}

/**
 * Item 3: words that break a title n-gram: English function words, and the
 * words a title uses to name its form rather than its topic.
 */
const TITLE_STOP_WORDS: ReadonlySet<string> = new Set(
  (
    "a an and are as at based be between by can during for from has have how in " +
    "into is it its new novel of on or our over than that the their this through " +
    "to toward towards under using via we what when which with within without " +
    "analysis analyses approach approaches case effect effects evidence insights " +
    "method methods review reviews role results study studies systematic update"
  ).split(" "),
);

// ---------------------------------------------------------------------------
// 1. The port
// ---------------------------------------------------------------------------

/** The Zotero reads a profile needs; `createZoteroRecommendLibrary` builds it. */
export interface RecommendLibrary {
  /** The collection's regular items, not in the trash. */
  readCollection(
    libraryID: number,
    collectionKey: string,
  ): Promise<CollectionWorksRead>;
  /** Every regular item of the library: one pass per run. */
  libraryTermSources(libraryID: number): Promise<readonly ItemTermSource[]>;
  /** `docs/02` §11.6's index, once per run. */
  libraryIndex(libraryID: number): Promise<LibraryIndex>;
}

// ---------------------------------------------------------------------------
// 2. Reading the collection, and the refusal
// ---------------------------------------------------------------------------

/** What {@link readProfileCollection} answers. */
export type ProfileCollectionRead =
  | { readonly kind: "ready"; readonly collection: CollectionWorksRead }
  | {
      readonly kind: "too-few-items";
      readonly itemCount: number;
      readonly minimum: number;
    };

/**
 * The collection, or FR-44's refusal when it has too few regular items. The
 * refusal is a value (`docs/07` §5.2's note of 2026-11-02, item 2), and the
 * library pass has not started when it is given.
 */
export async function readProfileCollection(
  library: Pick<RecommendLibrary, "readCollection">,
  libraryID: number,
  collectionKey: string,
): Promise<ProfileCollectionRead> {
  const collection = await library.readCollection(libraryID, collectionKey);
  return collection.items.length < MIN_PROFILE_ITEMS
    ? {
        kind: "too-few-items",
        itemCount: collection.items.length,
        minimum: MIN_PROFILE_ITEMS,
      }
    : { kind: "ready", collection };
}

/**
 * `docs/07` §5.2's `membershipHash`: SHA-256 over the sorted `itemKey|dateModified`
 * lines. Changes when an item is added, removed or modified, and not otherwise.
 */
export function membershipHash(
  items: readonly Pick<CollectionWorkRead, "itemKey" | "dateModified">[],
): string {
  return sha256Hex(
    items
      .map((item) => `${item.itemKey}|${item.dateModified}`)
      .sort()
      .join("\n"),
  );
}

// ---------------------------------------------------------------------------
// 3. Terms
// ---------------------------------------------------------------------------

/** One term on one item. */
interface ItemTerm {
  /** The tag's spelling; absent for a term known only from the title. */
  readonly spelling?: string;
  readonly major: boolean;
}

/** Single words and adjacent pairs of a title; a stop word breaks a pair. */
function titleNgrams(title: string): readonly string[] {
  const grams: string[] = [];
  let previous: string | undefined;
  for (const token of titleTokens(normalizeTitle(title))) {
    if (
      TITLE_STOP_WORDS.has(token) ||
      [...token].length < 2 ||
      /^\d+$/.test(token)
    ) {
      previous = undefined;
      continue;
    }
    grams.push(token);
    if (previous !== undefined) grams.push(`${previous} ${token}`);
    previous = token;
  }
  return grams;
}

/** The item's terms by {@link normalizeTitle}'s key, check tags left out. */
function termsOfItem(source: ItemTermSource): ReadonlyMap<string, ItemTerm> {
  const terms = new Map<string, ItemTerm>();
  const addTagged = (spelling: string, major: boolean): void => {
    const key = normalizeTitle(spelling);
    if (key === "" || CHECK_TAGS.has(key)) return;
    const earlier = terms.get(key);
    terms.set(key, {
      spelling: earlier?.spelling ?? spelling,
      major: major || earlier?.major === true,
    });
  };
  for (const subject of source.subjects ?? []) {
    if (subject.scheme === MESH_SCHEME) {
      addTagged(subject.term, subject.isMajor === true);
    }
  }
  for (const keyword of source.keywords ?? []) addTagged(keyword, false);
  for (const gram of titleNgrams(source.title)) {
    if (!terms.has(gram) && !CHECK_TAGS.has(gram)) {
      terms.set(gram, { major: false });
    }
  }
  return terms;
}

/** The most frequent spelling; ties go to the smaller in code-unit order. */
function preferredSpelling(spellings: ReadonlyMap<string, number>): string {
  let best = "";
  let bestCount = 0;
  for (const [spelling, count] of spellings) {
    if (count > bestCount || (count === bestCount && spelling < best)) {
      best = spelling;
      bestCount = count;
    }
  }
  return best;
}

/** One entry of a count, across a collection's items. */
interface Tally {
  count: number;
  /** Items where a MeSH term is major, or an author is last. */
  marked: number;
  readonly spellings: Map<string, number>;
}

function tallyOf(tallies: Map<string, Tally>, key: string): Tally {
  let tally = tallies.get(key);
  if (tally === undefined) {
    tally = { count: 0, marked: 0, spellings: new Map() };
    tallies.set(key, tally);
  }
  return tally;
}

function addSpelling(tally: Tally, spelling: string): void {
  tally.spellings.set(spelling, (tally.spellings.get(spelling) ?? 0) + 1);
}

/** Larger first, then the smaller name in code-unit order. */
function byValueThenName(
  a: readonly [string, number],
  b: readonly [string, number],
): number {
  return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

/**
 * A profile's terms, heaviest first. Ties go to the smaller term in code-unit
 * order, so two runs agree. A plain object cannot hold this order, because a
 * term like `2019` sorts first in any object. Callers: `P5-T23`'s "top-weighted
 * terms" and `P5-T26`'s term chips.
 */
export function rankedTerms(
  termWeights: Readonly<Record<string, number>>,
): readonly (readonly [term: string, weight: number])[] {
  return Object.entries(termWeights).sort(byValueThenName);
}

/** `docs/05` §7.2's weight, with item 2's major-topic factor. */
function termWeight(
  tally: Pick<Tally, "count" | "marked">,
  collectionSize: number,
  librarySize: number,
  countInLibrary: number,
): number {
  return (
    (tally.count / collectionSize) *
    Math.log(1 + librarySize / (1 + countInLibrary)) *
    (1 + (MAJOR_TOPIC_BOOST * tally.marked) / tally.count)
  );
}

function termWeightsOf(
  items: readonly CollectionWorkRead[],
  librarySources: readonly ItemTermSource[],
): Readonly<Record<string, number>> {
  const tallies = new Map<string, Tally>();
  for (const { work } of items) {
    for (const [key, term] of termsOfItem(work)) {
      const tally = tallyOf(tallies, key);
      tally.count += 1;
      if (term.major) tally.marked += 1;
      if (term.spelling !== undefined) addSpelling(tally, term.spelling);
    }
  }
  for (const [key, tally] of tallies) {
    if (tally.spellings.size === 0 && tally.count < MIN_TITLE_TERM_ITEMS) {
      tallies.delete(key);
    }
  }
  // Item 3: a title's single word gives way to a term that holds it, because
  // "editing" is a poor search query where "gene editing" is a term.
  const wordsOfPhrases = new Set(
    [...tallies.keys()].flatMap((key) =>
      key.includes(" ") ? titleTokens(key) : [],
    ),
  );
  for (const [key, tally] of tallies) {
    if (tally.spellings.size === 0 && wordsOfPhrases.has(key)) {
      tallies.delete(key);
    }
  }

  // Only the terms the collection has are counted across the library.
  const inLibrary = new Map<string, number>();
  for (const source of librarySources) {
    for (const key of termsOfItem(source).keys()) {
      if (tallies.has(key)) inLibrary.set(key, (inLibrary.get(key) ?? 0) + 1);
    }
  }

  const weighted: (readonly [string, number])[] = [];
  for (const [key, tally] of tallies) {
    weighted.push([
      // NFC: `normalizeTitle` decomposes, and a key can reach a search query.
      tally.spellings.size === 0
        ? key.normalize("NFC")
        : preferredSpelling(tally.spellings),
      termWeight(
        tally,
        items.length,
        librarySources.length,
        inLibrary.get(key) ?? 0,
      ),
    ]);
  }
  return Object.fromEntries(
    weighted.sort(byValueThenName).slice(0, MAX_PROFILE_TERMS),
  );
}

/** MeSH without the check tags, and arXiv categories, each counted once per item. */
function subjectCountsOf(
  items: readonly CollectionWorkRead[],
): Readonly<Record<string, number>> {
  const tallies = new Map<string, Tally>();
  for (const { work } of items) {
    const seen = new Map<string, string>();
    for (const subject of work.subjects ?? []) {
      const key = normalizeTitle(subject.term);
      const counted =
        subject.scheme === ARXIV_SCHEME ||
        (subject.scheme === MESH_SCHEME && !CHECK_TAGS.has(key));
      if (counted && key !== "" && !seen.has(key)) seen.set(key, subject.term);
    }
    for (const [key, spelling] of seen) {
      const tally = tallyOf(tallies, key);
      tally.count += 1;
      addSpelling(tally, spelling);
    }
  }
  const counted = [...tallies.values()].map(
    (tally) => [preferredSpelling(tally.spellings), tally.count] as const,
  );
  return Object.fromEntries(
    counted.sort(byValueThenName).slice(0, MAX_PROFILE_SUBJECTS),
  );
}

// ---------------------------------------------------------------------------
// 4. Authors, venues, years
// ---------------------------------------------------------------------------

/** Initials of a given name: `Jun-Hee` and `J. H.` are both `JH`; `JH` stays. */
function initialsOf(given: string): string {
  return given
    .split(/[\s.\-‐-―]+/u)
    .filter((part) => part !== "")
    .map((part) =>
      /^\p{Lu}{1,3}$/u.test(part) ? part : ([...part][0] ?? "").toUpperCase(),
    )
    .join("");
}

/** `Family Initials`, as `docs/05` §7.3's `AUTH:"Doudna J"`; a single-field name whole. */
function authorName(author: Author): string {
  const literal = (author.literal ?? "").trim();
  if (literal !== "") return literal;
  const initials = initialsOf(author.given ?? "");
  return initials === "" ? author.family : `${author.family} ${initials}`;
}

function topAuthorsOf(
  items: readonly CollectionWorkRead[],
): CollectionProfile["topAuthors"] {
  const tallies = new Map<string, Tally>();
  const orcids = new Map<string, string>();
  for (const { work } of items) {
    const seen = new Set<string>();
    for (const author of work.authors) {
      const name = authorName(author);
      const key = normalizeTitle(name);
      if (key === "") continue;
      // The smaller of two, so the answer does not depend on reading order.
      const { orcid } = author;
      const known = orcids.get(key);
      if (orcid !== undefined && (known === undefined || orcid < known)) {
        orcids.set(key, orcid);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const tally = tallyOf(tallies, key);
      tally.count += 1;
      addSpelling(tally, name);
    }
    const last = work.authors[work.authors.length - 1];
    const lastTally =
      last === undefined
        ? undefined
        : tallies.get(normalizeTitle(authorName(last)));
    if (lastTally !== undefined) lastTally.marked += 1;
  }
  return [...tallies.entries()]
    .filter(([, tally]) => tally.count >= 2 || tally.marked > 0)
    .map(([key, tally]) => ({
      name: preferredSpelling(tally.spellings),
      count: tally.count,
      marked: tally.marked,
      orcid: orcids.get(key),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.marked - a.marked ||
        byValueThenName([a.name, 0], [b.name, 0]),
    )
    .map(({ name, count, orcid }) => ({
      name,
      count,
      ...(orcid !== undefined && { orcid }),
    }));
}

function topVenuesOf(
  items: readonly CollectionWorkRead[],
): CollectionProfile["topVenues"] {
  const tallies = new Map<string, Tally>();
  const issns = new Map<string, Set<string>>();
  for (const { work } of items) {
    const name = (work.containerTitle ?? "").trim();
    const key = normalizeTitle(name);
    if (key === "") continue;
    const tally = tallyOf(tallies, key);
    tally.count += 1;
    addSpelling(tally, name);
    const known = issns.get(key) ?? new Set<string>();
    for (const issn of work.issn ?? []) known.add(issn);
    issns.set(key, known);
  }
  return [...tallies.entries()]
    .map(([key, tally]) => ({
      name: preferredSpelling(tally.spellings),
      count: tally.count,
      issn: [...(issns.get(key) ?? [])].sort(),
    }))
    .sort((a, b) => byValueThenName([a.name, a.count], [b.name, b.count]))
    .slice(0, MAX_PROFILE_VENUES)
    .map(({ name, count, issn }) => ({
      name,
      count,
      ...(issn.length > 0 && { issn }),
    }));
}

/** The lower middle year, so the answer is always a year some item has. */
function medianOf(years: readonly number[]): number | undefined {
  const sorted = [...years].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

// ---------------------------------------------------------------------------
// 5. The profile
// ---------------------------------------------------------------------------

/** What {@link buildProfileStats} reads. */
export interface ProfileStatsInput {
  readonly libraryID: number;
  readonly collectionKey: string;
  readonly collection: CollectionWorksRead;
  /** {@link RecommendLibrary.libraryTermSources}'s answer; its length is the library's size. */
  readonly librarySources: readonly ItemTermSource[];
  readonly nowEpochMs: number;
}

/**
 * The statistical half of `CollectionProfile`. `centroids`, `seeds` and
 * `suggestedQueries` are empty and `origin` is `"heuristic"` until `P5-T21` and
 * `P5-T22` fill them in. Stores nothing: see {@link persistProfile}.
 *
 * @throws RangeError for fewer than {@link MIN_PROFILE_ITEMS} items, which
 *   {@link readProfileCollection} has already refused
 */
export function buildProfileStats(input: ProfileStatsInput): CollectionProfile {
  const { collection, librarySources } = input;
  const { items } = collection;
  if (items.length < MIN_PROFILE_ITEMS) {
    throw new RangeError(
      "[research-helper] a profile needs at least " +
        `${String(MIN_PROFILE_ITEMS)} items; nothing was built`,
    );
  }
  const years: number[] = [];
  const yearHistogram: Record<number, number> = {};
  for (const { work } of items) {
    const year = work.publishedDate?.year;
    if (year === undefined) continue;
    years.push(year);
    yearHistogram[year] = (yearHistogram[year] ?? 0) + 1;
  }
  return {
    id: collectionProfileId(input.libraryID, input.collectionKey),
    libraryID: input.libraryID,
    collectionKey: input.collectionKey,
    collectionName: collection.name,
    builtAtEpochMs: input.nowEpochMs,
    itemCount: items.length,
    membershipHash: membershipHash(items),
    termWeights: termWeightsOf(items, librarySources),
    subjectCounts: subjectCountsOf(items),
    topAuthors: topAuthorsOf(items),
    topVenues: topVenuesOf(items),
    yearHistogram,
    medianYear: medianOf(years),
    centroids: [],
    seeds: [],
    suggestedQueries: [],
    origin: "heuristic",
    knownWorkKeys: [...new Set(items.map(({ work }) => work.workKey))].sort(),
  };
}

/**
 * Store a whole profile, keeping the stored `userEdits` when it carries none,
 * because `put` replaces the row (`docs/07` §5.2). `P5-T25` calls this once
 * `P5-T21` and `P5-T22` have run: `docs/07` §5.2's note of 2026-11-02, item 1,
 * says why not sooner.
 *
 * @returns the profile as the store will read it
 */
export async function persistProfile(
  store: Pick<CollectionProfileStore, "get" | "put">,
  profile: CollectionProfile,
): Promise<CollectionProfile> {
  const userEdits =
    profile.userEdits ?? (await store.get(profile.id))?.userEdits;
  return store.put(
    userEdits === undefined ? profile : { ...profile, userEdits },
  );
}

// ---------------------------------------------------------------------------
// 6. Computed on each run, never stored
// ---------------------------------------------------------------------------

/** Identifier sets, in the normalised forms `CanonicalWork.ids` holds. */
export interface OwnedIdentifiers {
  readonly doi: ReadonlySet<string>;
  readonly pmid: ReadonlySet<string>;
  readonly arxiv: ReadonlySet<string>;
  readonly workKeys: ReadonlySet<string>;
}

/** {@link profileOwnedSets}' answer. */
export interface ProfileOwnedSets {
  /** FR-46: a candidate here is excluded. */
  readonly ownedInCollection: OwnedIdentifiers;
  /** FR-46: a candidate here, and not in the collection, is marked "in library". */
  readonly ownedInLibrary: OwnedIdentifiers;
}

/**
 * The collection's and the library's identifier sets, on each run and never on
 * the profile (`docs/07` §5.2, DECIDED item 3 of `P5-T01`'s note). Callers:
 * `P5-T24`'s `identifierFilters`, through `P5-T25`.
 */
export function profileOwnedSets(
  items: readonly Pick<CollectionWorkRead, "work">[],
  index: Pick<LibraryIndex, "byDoi" | "byPmid" | "byArxiv" | "byWorkKey">,
): ProfileOwnedSets {
  const doi = new Set<string>();
  const pmid = new Set<string>();
  const arxiv = new Set<string>();
  const workKeys = new Set<string>();
  for (const { work } of items) {
    if (work.ids.doi !== undefined) doi.add(work.ids.doi);
    if (work.ids.pmid !== undefined) pmid.add(work.ids.pmid);
    if (work.ids.arxivId !== undefined) arxiv.add(work.ids.arxivId);
    workKeys.add(work.workKey);
  }
  return {
    ownedInCollection: { doi, pmid, arxiv, workKeys },
    ownedInLibrary: {
      doi: new Set(index.byDoi.keys()),
      pmid: new Set(index.byPmid.keys()),
      arxiv: new Set(index.byArxiv.keys()),
      workKeys: new Set(index.byWorkKey.keys()),
    },
  };
}

/** Zotero's `YYYY-MM-DD HH:MM:SS` (UTC) as ms since epoch; `undefined` when it is not that. */
export function zoteroDateToEpochMs(date: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(date);
  if (match === null) return undefined;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

/**
 * `docs/05` §7.2's `addedAt`: work key → when the item was added, the latest of
 * two items holding one work. An item with no readable date has no entry. Caller:
 * `selectSeeds` (`seeds.ts`, `P5-T21`), through `P5-T25`.
 */
export function addedAtByWorkKey(
  items: readonly Pick<CollectionWorkRead, "work" | "dateAdded">[],
): ReadonlyMap<string, number> {
  const addedAt = new Map<string, number>();
  for (const { work, dateAdded } of items) {
    const at =
      dateAdded === undefined ? undefined : zoteroDateToEpochMs(dateAdded);
    if (at === undefined) continue;
    addedAt.set(work.workKey, Math.max(at, addedAt.get(work.workKey) ?? at));
  }
  return addedAt;
}
