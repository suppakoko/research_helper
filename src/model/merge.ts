/**
 * Field-merge policy, source precedence and record provenance.
 *
 * **Scope.** `P2-T10`. One `CanonicalWork` is assembled from the
 * `SourceRecord`s the dedup cascade (`src/sources/shared/dedupe.ts`, `P2-T09`)
 * judged to be one work. The assembly is a **pure, deterministic function**:
 * same records in, byte-identical work out, whatever order the records arrive
 * in, with no clock and no network. `docs/07` §8.3 keeps every `SourceRecord`
 * in its own table "to enable re-merge without refetch", and that promise is
 * only worth anything if the merge is a function of the records alone.
 *
 * **Two documents, one half each.** The policy was two views of one table
 * until 2026-09-09, when the corpus gave each half an owner (`P2-T10`'s
 * Notes):
 *
 * - **`docs/02` §10.4 owns the per-field *source ordering*** — which source
 *   to believe first for `title`, `abstract`, `authors`, … — with the *why*
 *   beside each row (Semantic Scholar abbreviates given names; Crossref cover
 *   dates lead reality; only PubMed and Europe PMC carry MeSH). §11.5 of that
 *   document states it normatively: "field precedence is the table in §10.4".
 *   {@link PRECEDENCE} transcribes those rows.
 * - **`docs/07` §5.1 "Merge rules" owns the per-field *combination rule*** —
 *   longest non-truncated title, longest abstract, most complete author list
 *   taken wholesale, earliest *complete* date, highest citation count, unions
 *   for `ids` and `subjects` — and says explicitly that it does **not**
 *   restate the ordering. The `pick*` functions below implement those rules
 *   and fall back to the §10.4 ordering only to break a tie.
 *
 * **OpenAlex is in four of the orderings and is inert.** No adapter ships for
 * it in v1 (`docs/02` §9.3, decision D2), so no record ever carries that
 * `sourceId`, and the surviving sources keep exactly the relative order §10.4
 * lists. The entries are kept in place rather than dropped because they are
 * the ordering a v1.1 adoption inherits — `docs/02` §9.2: "prefer any other
 * source's abstract over OpenAlex's", which is why it is last in `abstract`.
 * The CI guard (`P2-T15`) allowlists `src/model/` for the word; the host name
 * is not allowed anywhere and does not appear here.
 *
 * **Layering.** `model/` imports nothing but `model/` (docs/07 §2.3). The
 * dedup decisions (tier fired, confidence) that FR-50 scenario 2 wants beside
 * the merged work are `sources/` types, so they are carried by the caller
 * (`src/pipeline/searchImport/stages.ts`), not by this file.
 */

import type {
  Author,
  CanonicalWork,
  OpenAccessInfo,
  PartialDate,
  Subject,
  WorkProvenance,
} from "./canonicalWork";
import {
  buildWorkKey,
  SOURCE_IDS,
  type ExternalIds,
  type SourceId,
} from "./ids";
import { isSourceRecord, type SourceRecord } from "./sourceRecord";

// ---------------------------------------------------------------------------
// 1. Precedence — docs/02 §10.4, transcribed row by row
// ---------------------------------------------------------------------------

/**
 * The `CanonicalWork` fields `docs/02` §10.4 gives a source ordering for.
 *
 * The table's row names are `docs/02` §10.1's working names; the keys here
 * are `docs/07` §5.1's shipped field names, mapped as follows:
 *
 * | §10.4 row | key here | covers |
 * |---|---|---|
 * | `title` | `title` | `title` |
 * | `abstract` | `abstract` | `abstract` |
 * | `authors` | `authors` | `authors` |
 * | `dates.issued` | `publishedDate` | `publishedDate` |
 * | `venue.*` | `venue` | `containerTitle`, `containerAbbreviation`, `publisher`, `volume`, `issue`, `pages`, `issn` |
 * | `metrics.citationCount` | `citationCount` | `citationCount` |
 * | `meshTerms` | `subjects` | `subjects` (a union; the order is the union's order) |
 * | `openAccess` | `openAccess` | `openAccess` |
 *
 * Two §10.4 rows are not here. `ids.*` is "union of all" with no source
 * ordering — its rule is {@link unionIds}. `tldr` ("S2 only") names a field
 * `docs/07` §5.1's `CanonicalWork` does not have, so there is nothing to
 * assign it to; it is recorded as a gap in `P2-T10`'s report rather than
 * invented here.
 */
export type PrecedenceField =
  | "title"
  | "abstract"
  | "authors"
  | "publishedDate"
  | "venue"
  | "citationCount"
  | "subjects"
  | "openAccess";

/**
 * Per-field source precedence, best first — **`docs/02` §10.4, row for row,
 * nothing dropped and nothing reordered.** The combination rule each field
 * is resolved with is `docs/07` §5.1's and lives in the `pick*` function
 * named in the comment.
 *
 * The one exported constant `docs/07` §5.1 and `docs/02` §10.4 both call for,
 * "so it is tunable and unit-testable in one place". `openalex` entries are
 * inert in v1 (this file's header); skip them in place when reading.
 */
export const PRECEDENCE: Readonly<
  Record<PrecedenceField, readonly SourceId[]>
> = Object.freeze({
  // Publisher-deposited first; PubMed appends a trailing `.` (which
  // `comparableTitleLength` discounts). Rule: {@link pickTitle}.
  title: [
    "crossref",
    "pubmed",
    "europepmc",
    "openalex",
    "semanticscholar",
    "arxiv",
  ],
  // Ordered by fidelity; OpenAlex last because its abstracts are
  // reconstructed from an inverted index (§9.2). medRxiv sits beside bioRxiv
  // (owner, 2026-10-15, `plan/00` §6 item 179): one adapter, one abstract
  // field. Rule: {@link pickAbstract}.
  abstract: [
    "europepmc",
    "pubmed",
    "semanticscholar",
    "crossref",
    "arxiv",
    "biorxiv",
    "medrxiv",
    "openalex",
  ],
  // Semantic Scholar abbreviates given names (§6.7), so it is last.
  // Rule: {@link pickAuthors}.
  authors: [
    "pubmed",
    "europepmc",
    "crossref",
    "openalex",
    "arxiv",
    "semanticscholar",
  ],
  // Europe PMC `firstPublicationDate`, PubMed's `pubmed` history date,
  // then Crossref `issued` — Crossref cover dates can lead reality.
  // Rule: {@link pickPublishedDate}.
  publishedDate: [
    "europepmc",
    "pubmed",
    "crossref",
    "semanticscholar",
    "openalex",
  ],
  // Rule: {@link pickVenue}.
  venue: ["crossref", "pubmed", "europepmc", "openalex", "semanticscholar"],
  // S2 and OpenAlex count preprints; Crossref counts only Crossref-deposited
  // references. Rule: {@link pickCitationCount}.
  citationCount: ["semanticscholar", "openalex", "crossref", "europepmc"],
  // §10.4's `meshTerms` row: only these two have MeSH. Rule: {@link unionSubjects}.
  subjects: ["pubmed", "europepmc"],
  // Europe PMC `fullTextUrlList`, Crossref `license[]`/`link[]`, S2
  // `openAccessPdf`, OpenAlex `best_oa_location` — the row as corrected on
  // 2026-10-15 (owner review rows 100–103), followed by `P2-T34`. A source
  // that supplies a `license` outranks the order. Rule: {@link pickOpenAccess}.
  openAccess: ["europepmc", "crossref", "semanticscholar", "openalex"],
});

/**
 * The ordering used where §10.4 gives none: for the fields it has no row for
 * (`type`, `language`, `keywords`, `url`, `onlineDate`, `referenceCount`,
 * `influentialCitationCount`, `relatedVersionIds`), for ranking a source a
 * row does not list (`biorxiv` and `medrxiv` appear in one row between them),
 * for choosing which conflicting identifier is *kept* (`docs/07` §5.1 `ids`:
 * "keep the one from the higher-precedence source"), and for the canonical
 * record order {@link merge} sorts into before it does anything else.
 *
 * It is the `title` row — the one §10.4 row that is a general statement about
 * record quality rather than about one field — followed by the remaining
 * `SourceId`s in their declaration order. This is a **choice the corpus does
 * not make** and is reported as such; it is one constant so that a later
 * decision replaces one line.
 */
export const DEFAULT_PRECEDENCE: readonly SourceId[] = Object.freeze([
  ...PRECEDENCE.title,
  ...SOURCE_IDS.filter((id) => !PRECEDENCE.title.includes(id)),
]);

/**
 * Rank of `sourceId` under `order`: its index in the row, or — for a source
 * the row does not list — the row's length plus its {@link DEFAULT_PRECEDENCE}
 * index, so unlisted sources sort after every listed one and among
 * themselves in a fixed order. Lower is better.
 */
export function precedenceRank(
  order: readonly SourceId[],
  sourceId: SourceId,
): number {
  const inRow = order.indexOf(sourceId);
  if (inRow !== -1) return inRow;
  return order.length + DEFAULT_PRECEDENCE.indexOf(sourceId);
}

// ---------------------------------------------------------------------------
// 2. Result types
// ---------------------------------------------------------------------------

/** The `ExternalIds` members that are identifiers; `url` is a locator. */
const ID_KEYS = [
  "doi",
  "pmid",
  "pmcid",
  "arxivId",
  "s2CorpusId",
  "openAlexId",
  // `docs/07` §5.1, 2026-10-15 (`P2-T34`): a Europe PMC preprint's id, which
  // reaches a work through `relatedVersionIds`; listed so the union below
  // carries it through a merge rather than dropping it.
  "epmcId",
] as const satisfies readonly (keyof ExternalIds)[];

type IdKey = (typeof ID_KEYS)[number];

/**
 * Two records claimed different values for the same identifier type.
 *
 * `docs/02` §10.4 (`ids.*` row) and §11.5 rule 1: "never overwrite a present
 * ID with a conflicting one — flag instead". The kept value is the
 * higher-precedence source's ({@link DEFAULT_PRECEDENCE}); every other value
 * is listed, never dropped, because a DOI conflict on a title match is
 * evidence the records are *not* duplicates and the caller may want to say so.
 */
export interface IdConflict {
  readonly field: `ids.${IdKey}`;
  readonly kept: string;
  readonly keptFrom: SourceId;
  readonly rejected: readonly {
    readonly value: string;
    readonly sourceId: SourceId;
  }[];
}

/** What {@link merge} returns. */
export interface MergeResult {
  readonly work: CanonicalWork;
  readonly conflicts: readonly IdConflict[];
}

// ---------------------------------------------------------------------------
// 3. The merge
// ---------------------------------------------------------------------------

/**
 * Sort records into the canonical merge order: {@link DEFAULT_PRECEDENCE} rank
 * first, then `SourceRecord.id`, so two records from one source (a source
 * that returned the same work twice) still land in a fixed order. This is
 * what makes every later "first defined value wins" deterministic, and it is
 * the order `provenance.recordIds` reports.
 */
function canonicalOrder(records: readonly SourceRecord[]): SourceRecord[] {
  return [...records].sort((a, b) => {
    const byRank =
      precedenceRank(DEFAULT_PRECEDENCE, a.sourceId) -
      precedenceRank(DEFAULT_PRECEDENCE, b.sourceId);
    if (byRank !== 0) return byRank;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Who supplied a value: the record and the value, for the pickers. */
interface Supplied<T> {
  readonly record: SourceRecord;
  readonly value: T;
}

/** The records that supply a non-`undefined` value for `read`. */
function suppliers<T>(
  ordered: readonly SourceRecord[],
  read: (work: SourceRecord["work"]) => T | undefined,
): Supplied<T>[] {
  const out: Supplied<T>[] = [];
  for (const record of ordered) {
    const value = read(record.work);
    if (value !== undefined) out.push({ record, value });
  }
  return out;
}

/**
 * Pick the best supplier: highest `score` first, then lowest precedence rank
 * under `order`, then the canonical record order (the input's). `scores` are
 * compared left to right, so a picker can say "longest, then most ORCIDs".
 */
function best<T>(
  candidates: readonly Supplied<T>[],
  order: readonly SourceId[],
  score: (candidate: Supplied<T>) => readonly number[],
): Supplied<T> | undefined {
  let winner: Supplied<T> | undefined;
  let winnerScore: readonly number[] = [];
  for (const candidate of candidates) {
    const s = score(candidate);
    if (winner === undefined) {
      winner = candidate;
      winnerScore = s;
      continue;
    }
    const byScore = compareScores(s, winnerScore);
    // Equal scores: the §10.4 row decides; `candidates` is already in
    // canonical order, so an equal rank keeps the earlier record.
    if (
      byScore > 0 ||
      (byScore === 0 &&
        precedenceRank(order, candidate.record.sourceId) <
          precedenceRank(order, winner.record.sourceId))
    ) {
      winner = candidate;
      winnerScore = s;
    }
  }
  return winner;
}

/** Lexicographic comparison; a missing component reads as `0`. */
function compareScores(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** `"…"` or `"..."` at the end is the one truncation marker a title can carry. */
const TRUNCATED_TITLE = /(…|\.\.\.)\s*$/;

/**
 * The length a title competes on: trailing whitespace and a trailing `.`
 * removed, because `docs/02` §10.4's `title` row says PubMed appends one and
 * it must not buy PubMed the "longest" verdict over Crossref's identical
 * title. The winner's title is still returned **verbatim** — merging chooses,
 * it does not rewrite.
 */
function comparableTitleLength(title: string): number {
  return title.trim().replace(/\.$/, "").length;
}

/** `docs/07` §5.1 `title`: longest non-truncated; ties on the §10.4 row. */
function pickTitle(
  ordered: readonly SourceRecord[],
): Supplied<string> | undefined {
  const all = suppliers(ordered, (w) =>
    w.title.trim() === "" ? undefined : w.title,
  );
  const untruncated = all.filter((c) => !TRUNCATED_TITLE.test(c.value));
  // Every title truncated is still a title; fall back rather than return none.
  const pool = untruncated.length > 0 ? untruncated : all;
  return best(pool, PRECEDENCE.title, (c) => [comparableTitleLength(c.value)]);
}

/** `docs/07` §5.1 `abstract`: longest non-empty; ties on the §10.4 row. */
function pickAbstract(
  ordered: readonly SourceRecord[],
): Supplied<string> | undefined {
  const all = suppliers(ordered, (w) =>
    w.abstract === undefined || w.abstract.trim() === ""
      ? undefined
      : w.abstract,
  );
  return best(all, PRECEDENCE.abstract, (c) => [c.value.length]);
}

/**
 * `docs/07` §5.1 `authors`: "source with the most complete list wins
 * wholesale (never interleave). Tie → the one with more ORCIDs." A second tie
 * goes to the §10.4 row, which is where Semantic Scholar's abbreviated given
 * names cost it the field when the lists are otherwise equal.
 */
function pickAuthors(
  ordered: readonly SourceRecord[],
): Supplied<readonly Author[]> | undefined {
  const all = suppliers(ordered, (w) =>
    w.authors.length === 0 ? undefined : w.authors,
  );
  return best(all, PRECEDENCE.authors, (c) => [
    c.value.length,
    c.value.filter((a) => a.orcid !== undefined && a.orcid !== "").length,
  ]);
}

/** Day-precise is 3, month-precise 2, year-only 1 — the completeness tiers. */
function datePrecision(d: PartialDate): number {
  if (d.day !== undefined) return 3;
  if (d.month !== undefined) return 2;
  return 1;
}

/** A sortable integer: `YYYYMMDD` with absent parts as `01`; earlier is smaller. */
function dateOrdinal(d: PartialDate): number {
  return d.year * 10_000 + (d.month ?? 1) * 100 + (d.day ?? 1);
}

/**
 * `docs/07` §5.1 `publishedDate`: "earliest *complete* date wins; a year-only
 * date never overrides a full date." Most precise first, then earliest, then
 * the §10.4 `dates.issued` row.
 */
function pickPublishedDate(
  ordered: readonly SourceRecord[],
): Supplied<PartialDate> | undefined {
  const all = suppliers(ordered, (w) => w.publishedDate);
  // `best` maximises, so earliness is the negated ordinal.
  return best(all, PRECEDENCE.publishedDate, (c) => [
    datePrecision(c.value),
    -dateOrdinal(c.value),
  ]);
}

/** `docs/07` §5.1 `citationCount`: highest; ties on the §10.4 row. */
function pickCitationCount(
  ordered: readonly SourceRecord[],
): Supplied<number> | undefined {
  const all = suppliers(ordered, (w) => w.citationCount);
  return best(all, PRECEDENCE.citationCount, (c) => [c.value]);
}

/**
 * `docs/07` §5.1 `openAccess`: "prefer the source that supplies a `license`";
 * then the §10.4 `openAccess` row, which since 2026-10-15 puts Europe PMC and
 * Crossref — the two §5.1 calls authoritative — first (`P2-T10` reported the
 * gap; `P2-T34` followed the corrected row).
 */
function pickOpenAccess(
  ordered: readonly SourceRecord[],
): Supplied<OpenAccessInfo> | undefined {
  const all = suppliers(ordered, (w) => w.openAccess);
  return best(all, PRECEDENCE.openAccess, (c) => [
    c.value.license !== undefined && c.value.license !== "" ? 1 : 0,
  ]);
}

/** First defined value by `order`: the rule for `venue.*` and the unlisted fields. */
function pickFirst<T>(
  ordered: readonly SourceRecord[],
  order: readonly SourceId[],
  read: (work: SourceRecord["work"]) => T | undefined,
): Supplied<T> | undefined {
  return best(suppliers(ordered, read), order, () => []);
}

/** A string field is supplied only when non-empty. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** `docs/02` §10.4 `venue.*`: first defined value in that row's order. */
function pickVenue<T>(
  ordered: readonly SourceRecord[],
  read: (work: SourceRecord["work"]) => T | undefined,
): Supplied<T> | undefined {
  return pickFirst(ordered, PRECEDENCE.venue, read);
}

/**
 * `docs/07` §5.1 `subjects`: "union, deduplicated by `(scheme, term)`", in
 * §10.4 `meshTerms` order then canonical order, each record's own order kept.
 * The first occurrence of a `(scheme, term)` pair supplies its `id` and
 * `isMajor`.
 */
function unionSubjects(ordered: readonly SourceRecord[]): readonly Subject[] {
  const byRank = [...ordered].sort(
    (a, b) =>
      precedenceRank(PRECEDENCE.subjects, a.sourceId) -
      precedenceRank(PRECEDENCE.subjects, b.sourceId),
  );
  const seen = new Set<string>();
  const out: Subject[] = [];
  for (const record of byRank) {
    for (const subject of record.work.subjects ?? []) {
      const key = `${subject.scheme}\u0000${subject.term}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(subject);
    }
  }
  return out;
}

/**
 * `docs/07` §5.1 `ids`: "union; conflicting values for the same ID type →
 * keep the one from the higher-precedence source and record a warning".
 * `ordered` is already in {@link DEFAULT_PRECEDENCE} order, so the first
 * holder of each identifier is the one kept; every later different value
 * becomes an {@link IdConflict} and **nothing is overwritten**. `url` is a
 * locator, not an identifier: first wins, differences are not conflicts.
 *
 * @returns the union, the conflicts, and which source supplied each kept id
 */
function unionIds(ordered: readonly SourceRecord[]): {
  readonly ids: ExternalIds;
  readonly conflicts: readonly IdConflict[];
  readonly origin: ReadonlyMap<IdKey, SourceId>;
  readonly supplierCount: ReadonlyMap<IdKey, number>;
} {
  const kept = new Map<IdKey, { value: string; sourceId: SourceId }>();
  const rejected = new Map<IdKey, { value: string; sourceId: SourceId }[]>();
  const supplierCount = new Map<IdKey, number>();
  let url: string | undefined;
  for (const record of ordered) {
    for (const key of ID_KEYS) {
      const value = record.work.ids[key];
      if (value === undefined) continue;
      supplierCount.set(key, (supplierCount.get(key) ?? 0) + 1);
      const current = kept.get(key);
      if (current === undefined) {
        kept.set(key, { value, sourceId: record.sourceId });
      } else if (current.value !== value) {
        const list = rejected.get(key);
        const entry = { value, sourceId: record.sourceId };
        if (list === undefined) rejected.set(key, [entry]);
        else list.push(entry);
      }
    }
    if (url === undefined) url = nonEmpty(record.work.ids.url);
  }
  const ids: Record<string, string> = {};
  const origin = new Map<IdKey, SourceId>();
  for (const key of ID_KEYS) {
    const entry = kept.get(key);
    if (entry === undefined) continue;
    ids[key] = entry.value;
    origin.set(key, entry.sourceId);
  }
  if (url !== undefined) ids["url"] = url;
  const conflicts: IdConflict[] = [];
  for (const key of ID_KEYS) {
    const list = rejected.get(key);
    const entry = kept.get(key);
    if (list === undefined || entry === undefined) continue;
    conflicts.push({
      field: `ids.${key}`,
      kept: entry.value,
      keptFrom: entry.sourceId,
      rejected: list,
    });
  }
  return { ids: ids as ExternalIds, conflicts, origin, supplierCount };
}

/**
 * Merge the records the cascade judged to be one work into one
 * `CanonicalWork`.
 *
 * Pure and deterministic: the records are first sorted into
 * {@link canonicalOrder}, so any permutation of the same input produces a
 * byte-identical result (the output object's keys are written in one fixed
 * order for the same reason). No clock is read — `normalizedAtEpochMs` is the
 * caller's, because `docs/07` §5.1 defines the field as "when this canonical
 * record was last rebuilt" and only the caller knows when that is.
 *
 * Every field goes through its `docs/07` §5.1 combination rule, tie-broken by
 * its `docs/02` §10.4 ordering ({@link PRECEDENCE}); fields neither document
 * orders use {@link DEFAULT_PRECEDENCE}. `provenance.fieldOrigin` names the
 * winning source for every **contested** field — one that two or more records
 * supplied, whether or not they agreed — so that "why did the plugin pick this
 * title?" (`docs/02` §11.5 rule 2) is answerable; a field one record supplied
 * was not contested and is not listed, which keeps a single-record merge's
 * `fieldOrigin` empty exactly as the Phase 1 lift left it. Unions (`ids` as
 * a whole, `subjects`) have no single winner and are not listed; each kept
 * identifier is, under `ids.<key>`.
 *
 * @param records - one dedup group, in any order; at least one
 * @param normalizedAtEpochMs - the caller's clock reading for the rebuild
 * @returns the merged work and every identifier conflict found on the way
 * @throws RangeError when `records` is empty
 * @throws TypeError when an element is not a `SourceRecord`
 */
export function merge(
  records: readonly SourceRecord[],
  normalizedAtEpochMs: number,
): MergeResult {
  if (records.length === 0) {
    throw new RangeError("merge: at least one SourceRecord is required");
  }
  for (const record of records) {
    if (!isSourceRecord(record)) {
      throw new TypeError("merge: every element must be a SourceRecord");
    }
  }
  const ordered = canonicalOrder(records);
  const fieldOrigin: Record<string, SourceId> = {};
  /** Record a winner when the field was contested (two or more suppliers). */
  const won = (
    field: string,
    pick: Supplied<unknown> | undefined,
    count: number,
  ): void => {
    if (pick !== undefined && count >= 2)
      fieldOrigin[field] = pick.record.sourceId;
  };
  const count = <T>(read: (w: SourceRecord["work"]) => T | undefined): number =>
    suppliers(ordered, read).length;

  const { ids, conflicts, origin, supplierCount } = unionIds(ordered);
  for (const key of ID_KEYS) {
    const from = origin.get(key);
    if (from !== undefined && (supplierCount.get(key) ?? 0) >= 2) {
      fieldOrigin[`ids.${key}`] = from;
    }
  }

  const type = pickFirst(ordered, DEFAULT_PRECEDENCE, (w) => w.type);
  const title = pickTitle(ordered);
  const abstract = pickAbstract(ordered);
  const authors = pickAuthors(ordered);
  const containerTitle = pickVenue(ordered, (w) => nonEmpty(w.containerTitle));
  const containerAbbreviation = pickVenue(ordered, (w) =>
    nonEmpty(w.containerAbbreviation),
  );
  const publisher = pickVenue(ordered, (w) => nonEmpty(w.publisher));
  const volume = pickVenue(ordered, (w) => nonEmpty(w.volume));
  const issue = pickVenue(ordered, (w) => nonEmpty(w.issue));
  const pages = pickVenue(ordered, (w) => nonEmpty(w.pages));
  const issn = pickVenue(ordered, (w) =>
    w.issn === undefined || w.issn.length === 0 ? undefined : w.issn,
  );
  const publishedDate = pickPublishedDate(ordered);
  const onlineDate = pickFirst(
    ordered,
    DEFAULT_PRECEDENCE,
    (w) => w.onlineDate,
  );
  const language = pickFirst(ordered, DEFAULT_PRECEDENCE, (w) =>
    nonEmpty(w.language),
  );
  const subjects = unionSubjects(ordered);
  const keywords = pickFirst(ordered, DEFAULT_PRECEDENCE, (w) =>
    w.keywords === undefined || w.keywords.length === 0
      ? undefined
      : w.keywords,
  );
  const citationCount = pickCitationCount(ordered);
  const referenceCount = pickFirst(
    ordered,
    DEFAULT_PRECEDENCE,
    (w) => w.referenceCount,
  );
  const influentialCitationCount = pickFirst(
    ordered,
    DEFAULT_PRECEDENCE,
    (w) => w.influentialCitationCount,
  );
  const openAccess = pickOpenAccess(ordered);
  const url = pickFirst(ordered, DEFAULT_PRECEDENCE, (w) => nonEmpty(w.url));
  const relatedVersionIds = unionRelatedVersionIds(ordered);

  won(
    "type",
    type,
    count((w) => w.type),
  );
  won(
    "title",
    title,
    count((w) => nonEmpty(w.title)),
  );
  won(
    "abstract",
    abstract,
    count((w) => nonEmpty(w.abstract)),
  );
  won(
    "authors",
    authors,
    count((w) => (w.authors.length === 0 ? undefined : w.authors)),
  );
  won(
    "containerTitle",
    containerTitle,
    count((w) => nonEmpty(w.containerTitle)),
  );
  won(
    "containerAbbreviation",
    containerAbbreviation,
    count((w) => nonEmpty(w.containerAbbreviation)),
  );
  won(
    "publisher",
    publisher,
    count((w) => nonEmpty(w.publisher)),
  );
  won(
    "volume",
    volume,
    count((w) => nonEmpty(w.volume)),
  );
  won(
    "issue",
    issue,
    count((w) => nonEmpty(w.issue)),
  );
  won(
    "pages",
    pages,
    count((w) => nonEmpty(w.pages)),
  );
  won(
    "issn",
    issn,
    count((w) =>
      w.issn === undefined || w.issn.length === 0 ? undefined : w.issn,
    ),
  );
  won(
    "publishedDate",
    publishedDate,
    count((w) => w.publishedDate),
  );
  won(
    "onlineDate",
    onlineDate,
    count((w) => w.onlineDate),
  );
  won(
    "language",
    language,
    count((w) => nonEmpty(w.language)),
  );
  won(
    "keywords",
    keywords,
    count((w) =>
      w.keywords === undefined || w.keywords.length === 0
        ? undefined
        : w.keywords,
    ),
  );
  won(
    "citationCount",
    citationCount,
    count((w) => w.citationCount),
  );
  won(
    "referenceCount",
    referenceCount,
    count((w) => w.referenceCount),
  );
  won(
    "influentialCitationCount",
    influentialCitationCount,
    count((w) => w.influentialCitationCount),
  );
  won(
    "openAccess",
    openAccess,
    count((w) => w.openAccess),
  );
  won(
    "url",
    url,
    count((w) => nonEmpty(w.url)),
  );

  const titleValue = title?.value ?? "";
  const authorsValue = authors?.value ?? [];
  const provenance: WorkProvenance = {
    recordIds: ordered.map((r) => r.id),
    fieldOrigin,
    seenIn: distinct(ordered.map((r) => r.sourceId)),
  };

  // Keys in one fixed order, optional members present only when defined
  // (`exactOptionalPropertyTypes`), so equal inputs serialize identically.
  const work: CanonicalWork = {
    workKey: buildWorkKey(
      ids,
      titleValue,
      publishedDate?.value.year,
      authorsValue[0]?.family,
    ),
    ids,
    type: type?.value ?? "other",
    title: titleValue,
    ...(abstract !== undefined && { abstract: abstract.value }),
    authors: authorsValue,
    ...(containerTitle !== undefined && {
      containerTitle: containerTitle.value,
    }),
    ...(containerAbbreviation !== undefined && {
      containerAbbreviation: containerAbbreviation.value,
    }),
    ...(publisher !== undefined && { publisher: publisher.value }),
    ...(volume !== undefined && { volume: volume.value }),
    ...(issue !== undefined && { issue: issue.value }),
    ...(pages !== undefined && { pages: pages.value }),
    ...(issn !== undefined && { issn: issn.value }),
    ...(publishedDate !== undefined && { publishedDate: publishedDate.value }),
    ...(onlineDate !== undefined && { onlineDate: onlineDate.value }),
    ...(language !== undefined && { language: language.value }),
    ...(subjects.length > 0 && { subjects }),
    ...(keywords !== undefined && { keywords: keywords.value }),
    ...(citationCount !== undefined && { citationCount: citationCount.value }),
    ...(referenceCount !== undefined && {
      referenceCount: referenceCount.value,
    }),
    ...(influentialCitationCount !== undefined && {
      influentialCitationCount: influentialCitationCount.value,
    }),
    ...(openAccess !== undefined && { openAccess: openAccess.value }),
    ...(url !== undefined && { url: url.value }),
    ...(relatedVersionIds !== undefined && { relatedVersionIds }),
    provenance,
    normalizedAtEpochMs,
  };

  return { work, conflicts };
}

/**
 * `relatedVersionIds` across the group: the union of every record's, first
 * holder wins per key, no conflict record — the field is a pointer to the
 * *other* version (`docs/02` §11.4), and the version link itself is decided by
 * the cascade's Tier 7, not here.
 */
function unionRelatedVersionIds(
  ordered: readonly SourceRecord[],
): ExternalIds | undefined {
  const out: Record<string, string> = {};
  for (const record of ordered) {
    const related = record.work.relatedVersionIds;
    if (related === undefined) continue;
    for (const key of [...ID_KEYS, "url"] as const) {
      const value = related[key];
      if (value !== undefined && out[key] === undefined) out[key] = value;
    }
  }
  return Object.keys(out).length === 0 ? undefined : (out as ExternalIds);
}

/** Order-preserving distinct. */
function distinct<T>(items: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
