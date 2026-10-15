/**
 * `CanonicalWork` → Zotero item JSON (`docs/07-architecture-and-data-model.md`
 * §6.2), the `extra` rules that go with it (§6.3), and the inverse read-back
 * `fromZoteroItem` (§6.6, added by `P2-T19` in §7 below).
 *
 * **Scope.** `P1-T12`, with `P0-T10`'s spike surface retired by `P1-T24`.
 * `plan/README.md` §4 lists this path among the sixteen where a Phase 1
 * `create` replaces a Phase 0 spike; `P1-T12` could not finish that
 * replacement, because `src/zotero/zoteroApi.ts` and two integration specs
 * imported `buildJournalArticle()` / `JournalArticleRecord` and none of the
 * three was in its `Files` list, so it kept the spike verbatim in a fenced §7
 * and reported the gap. `P1-T24` owns all three call sites and has moved them
 * to {@link toZoteroItemJSON}; §7 is gone and **this file now contains one
 * mapper, not two**.
 *
 * {@link AUTOMATIC_TAG_TYPE} and {@link RESEARCH_HELPER_TAG} were *not* spike
 * exports and are untouched: they are declared in §1 below, {@link tagsFor}
 * needs both, and four other files import them.
 *
 * Three decisions are load-bearing.
 *
 * **`fromJSON()`, not field-by-field `setField()`** (`docs/01` §5.2.1).
 * `setField()` throws on a field invalid for the item type, so hand-mapping
 * means owning a validation matrix that moves with every schema bump.
 * `fromJSON` owns it instead, resolves base-field mappings, and migrates
 * recognised `Extra` lines into real fields. Its one hard rule is that it is a
 * **replace, not a merge**: it clears every field present on the item but
 * absent from the JSON. So the JSON this module builds is only ever handed to a
 * *new* item. Patching an existing one uses `setField` and belongs to `P1-T14`.
 *
 * **`WorkType` is kebab-case; Zotero item types are camelCase, and §6.2 is
 * where one becomes the other.** `docs/07` §5.1's union is `journal-article`,
 * `conference-paper`, `book-chapter`; `docs/02` §10.2's table names Zotero's
 * `journalArticle`, `conferencePaper`, `bookSection`. A mapper written from
 * doc 02 alone emits strings `isWorkType()` rejects. {@link zoteroItemTypeFor}
 * and {@link workTypeFor} are the only two places the conversion happens, in
 * either direction.
 *
 * **The mapping itself is pure.** No `Zotero.*` in §§2–5: the field table, the
 * creator shape, the tags and the `extra` algebra are data transforms, and
 * keeping them free of the platform is what lets them be asserted in plain
 * Node. The one thing that genuinely needs Zotero —
 * {@link detectNativeIdentifierFields}, which must await
 * `Zotero.Schema.schemaUpdatePromise` first — is isolated in §6 and its
 * result is handed *into* the pure mapper as data. Turning this module's
 * output into a `Zotero.Item` is a platform write and belongs to the caller
 * (`newItemFromMapping()` in `src/zotero/zoteroApi.ts`).
 */

import {
  isWorkType,
  type Author,
  type CanonicalWork,
  type PartialDate,
  type Subject,
  type WorkType,
} from "../model/canonicalWork";
import {
  buildWorkKey,
  isSourceId,
  normalizeArxivId,
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
  type ExternalIds,
  type SourceId,
} from "../model/ids";
import {
  ARXIV_SOURCE_ID,
  arxivArchiveId,
  parseArxivEntryId,
} from "../sources/arxiv/mapper";
import { detectServer } from "../sources/shared/preprintServers";
import {
  applyExtraUpdate,
  findExtraLine,
  parseExtra,
  readS2CorpusId,
  readWorkKey,
  RH_S2_CORPUS_ID_KEY,
  RH_SOURCES_KEY,
  RH_WORK_KEY,
  type ExtraEntry,
  type ExtraLine,
} from "./extraField";

// ---------------------------------------------------------------------------
// 1. The JSON shapes `item.fromJSON()` accepts
// ---------------------------------------------------------------------------

/**
 * One creator, in the two shapes `docs/01` §5.2 documents and `docs/07` §6.2
 * repeats: two-field for a person whose name splits, single-field
 * (`fieldMode: 1`) for one that does not.
 */
export type ZoteroCreatorJSON =
  | {
      readonly creatorType: "author";
      readonly firstName: string;
      readonly lastName: string;
    }
  | {
      readonly creatorType: "author";
      readonly name: string;
      readonly fieldMode: 1;
    };

/** One tag. `type: 1` is automatic, `0` manual (`docs/01` §5.2). */
export interface ZoteroTagJSON {
  readonly tag: string;
  readonly type: 0 | 1;
}

/**
 * The item JSON handed to `item.fromJSON()`.
 *
 * Field names are spelled exactly as Zotero spells them (`docs/07` §6.1's
 * verified key list), because they are passed through verbatim:
 * `abstractNote`, not `abstract`; `DOI` upper-case, not `doi`. The index
 * signature is what makes the table in §3 writable as a bag; every key it can
 * hold is named in §6.1.
 */
export interface ZoteroItemJSON {
  readonly itemType: string;
  readonly creators: readonly ZoteroCreatorJSON[];
  readonly tags: readonly ZoteroTagJSON[];
  readonly [field: string]: unknown;
}

/**
 * `Zotero.Item.prototype.addTag`'s type argument: `0` = manual (blue),
 * `1` = automatic (orange). `docs/01` §5.2, `docs/07` §6.2 and `docs/02` §10.3
 * all require automatic for plugin-written tags, so they are visually distinct
 * from the user's own and can be bulk-removed.
 */
export const AUTOMATIC_TAG_TYPE = 1;

/**
 * The tag every item this plugin creates carries, so a user can find — and
 * bulk-remove — everything it wrote (`docs/01` §5.2, `docs/02` §10.3's
 * "one provenance tag per run").
 */
export const RESEARCH_HELPER_TAG = "research_helper";

/**
 * The tag on an item whose type no source could determine (`docs/10` FR-7
 * scenario 3: "defaults to `journalArticle` and a
 * `research_helper/uncertain-type` tag is applied"). `docs/07` §6.2's `type`
 * row (2026-10-15, `P2-T08`) names `WorkType` `"other"` as that case: every
 * source mapper falls back to it exactly when its record could not be
 * classified, and `merge()` defaults to it. Automatic, like every tag the
 * plugin writes.
 */
export const UNCERTAIN_TYPE_TAG = "research_helper/uncertain-type";

/**
 * `genre` on every `preprint` item — `docs/07` §6.2's `genre` row
 * (2026-10-15, `P2-T08`), the value `docs/02` §10.3 gives. A constant because
 * `CanonicalWork` carries no publication-type list to take it from.
 */
export const PREPRINT_GENRE = "Preprint";

/**
 * The non-namespaced `extra` keys this plugin writes (§6.2's rows, §6.3's
 * "standard, non-namespaced lines the ecosystem already understands") and
 * reads back (§6.6). One declaration for both directions, imported by
 * `src/zotero/libraryIndex.ts` for its `extra` branches, so the spelling the
 * index looks for is by construction the spelling the mapper writes.
 *
 * `extraField.ts`'s {@link findExtraLine} compares case-insensitively, so the
 * case here is the *written* form only; `arxiv:` and `ARXIV:` lines left by
 * other software are read all the same.
 */
export const ECOSYSTEM_EXTRA_KEY = {
  doi: "DOI",
  pmid: "PMID",
  pmcid: "PMCID",
  arxiv: "arXiv",
  orcid: "ORCID",
  citations: "Citations",
} as const;

/**
 * The plugin's own `extra` keys beyond {@link RH_WORK_KEY} and
 * {@link RH_SOURCES_KEY}: §6.2's two rows added by `P1-T12`, declared once so
 * {@link toZoteroMapping} and {@link canonicalWorkFromSnapshot} cannot drift.
 */
export const RH_WORK_TYPE_KEY = "rh-work-type";
export const RH_ISSN_KEY = "rh-issn";

// ---------------------------------------------------------------------------
// 2. WorkType ↔ Zotero item type — the camelCase/kebab-case boundary
// ---------------------------------------------------------------------------

/**
 * The Zotero item type for a {@link WorkType}.
 *
 * **Exactly two answers**: `preprint` for a preprint (mapped by
 * {@link toZoteroMapping} since `P2-T08`; Phase 1 threw), and
 * `journalArticle` for everything else. That is `P1-T12`'s specification
 * ("emitting `itemType: \"journalArticle\"` for everything Phase 1 sees") and
 * `plan/02-phase-1-pubmed.md` §2's deferral table states the same intent —
 * "`P1-T12` maps `journalArticle` and routes every other `WorkType` to
 * `journalArticle`" — which is also §6.2's "everything else → `journalArticle`
 * with a note in `extra`". {@link toZoteroItemJSON} writes that note as
 * `rh-work-type`, so nothing is silently lost.
 *
 * > **Deferred, deliberately.** §6.2's `type` row also says
 * > `conference-paper` → `conferencePaper`. That is **not** implemented here
 * > and the reason is that nothing in the authority supports implementing it:
 * > §6.1 verifies field lists for `journalArticle` and `preprint` only, §6.2's
 * > mapping table has no `conferencePaper` column, and `conferencePaper` has
 * > neither `publicationTitle` (it is `proceedingsTitle`) nor `PMID`/`PMCID` —
 * > so emitting it would mean inventing a field mapping from `docs/02` §10.3
 * > that `docs/07` does not sanction. A `conference-paper` therefore becomes a
 * > `journalArticle` carrying `rh-work-type: conference-paper`, which is
 * > recoverable, rather than a `conferencePaper` with guessed fields, which is
 * > not. Reported as a corpus contradiction needing a decision and a card.
 *
 * @param workType - `docs/07` §5.1's kebab-case type
 * @returns Zotero's camelCase item-type name
 */
export function zoteroItemTypeFor(workType: WorkType): string {
  return workType === "preprint" ? "preprint" : "journalArticle";
}

/**
 * The inverse of {@link zoteroItemTypeFor}: §6.6's read-back direction.
 *
 * Complete over the camelCase names that correspond to a `WorkType`, and
 * lossy-tolerant elsewhere — §6.6: "unknown item types map to
 * `type: \"other\"`". This is the function that keeps a camelCase Zotero name
 * from ever reaching a `WorkType`-typed field; `isWorkType()` rejects those,
 * and that rejection is asserted rather than assumed.
 *
 * @param zoteroItemType - a Zotero item-type name, e.g. `"journalArticle"`
 * @returns the matching {@link WorkType}, or `"other"`
 */
export function workTypeFor(zoteroItemType: string): WorkType {
  switch (zoteroItemType) {
    case "journalArticle":
      return "journal-article";
    case "preprint":
      return "preprint";
    case "conferencePaper":
      return "conference-paper";
    case "bookSection":
      return "book-chapter";
    case "dataset":
      return "dataset";
    case "thesis":
      return "thesis";
    case "report":
      return "report";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// 3. Mapping options
// ---------------------------------------------------------------------------

/**
 * Which identifier fields this client has natively (`docs/01` §5.3: **feature
 * detect**, never version-check).
 *
 * `PMID`/`PMCID` became real `journalArticle` fields in schema 34; schema 42 is
 * what `docs/07` §6.1 and `docs/02` §10.3 verify against. When they exist the
 * identifier goes in the native field **and not in `Extra`** (`docs/07` §6.1's
 * implementer note, `docs/10` FR-6, conflict `C2` closed). When they do not,
 * the ecosystem's `PMID: ` line is the fallback — and that is the *only* case
 * in which this plugin writes one.
 */
export interface NativeIdentifierFields {
  readonly pmid: boolean;
  readonly pmcid: boolean;
}

/** Both present — the shipped baseline, Zotero ≥ 7.0.31 / schema ≥ 34. */
export const NATIVE_ID_FIELDS_PRESENT: NativeIdentifierFields = {
  pmid: true,
  pmcid: true,
};

/**
 * Everything the mapping needs that is not in the `CanonicalWork`.
 *
 * All optional, so §6.2's documented one-argument call
 * `toZoteroItemJSON(work)` stays valid. They exist as options rather than as
 * reads of the ambient environment because the mapper is pure: the clock and
 * the schema are capabilities, and a pure function receives capabilities as
 * arguments.
 */
export interface ZoteroMappingOptions {
  /**
   * Import time, ms since epoch. Drives `accessDate` (§6.2: "set to import
   * time") and the date inside the `Citations:` line.
   *
   * Defaults to `Date.now()`. Never `performance.now()`, which is a
   * monotonic clock with an arbitrary origin and not a wall-clock time.
   */
  readonly accessedAtEpochMs?: number;
  /**
   * `libraryCatalog` — §6.2: "the winning source's display name, matching
   * Zotero translator convention".
   *
   * Supplied by the caller when it knows the winning source; otherwise derived
   * from `work.provenance.seenIn[0]` (merge order, §5.1) through
   * {@link SOURCE_CATALOG_LABELS}.
   */
  readonly libraryCatalog?: string;
  /** Result of {@link detectNativeIdentifierFields}. Defaults to both present. */
  readonly nativeIdentifierFields?: NativeIdentifierFields;
  /**
   * Write the `rh-sources` line? §6.2 calls it a "debug aid; togglable".
   * Defaults to `true`; the pref that toggles it is not this card's.
   */
  readonly includeSourcesLine?: boolean;
  /**
   * The item's current `extra`, when there is one.
   *
   * Only ever used to *preserve* foreign lines (§6.3). Note that handing
   * `fromJSON` the merged field is safe for a **new** item only; patching an
   * existing item through `fromJSON` is forbidden (`docs/01` §5.2.1 hard rule
   * 1) regardless of what happens to `extra`.
   */
  readonly existingExtra?: string;
}

/**
 * `libraryCatalog` labels, per source.
 *
 * These are catalogue names in the sense Zotero's own translators use — data,
 * not UI text — which is why they are literals here and not Fluent keys.
 * `docs/02` §10.3 gives the form explicitly ("source label, e.g.
 * `\"Europe PMC\"`"). `LiteratureSource.displayNameKey` (`docs/07` §4.2) is the
 * *localizable* name shown in the UI and is a different thing; putting a
 * Fluent id in a Zotero field would write `rh-source-pubmed` into a user's
 * library.
 */
export const SOURCE_CATALOG_LABELS: Readonly<Record<SourceId, string>> = {
  pubmed: "PubMed",
  europepmc: "Europe PMC",
  crossref: "Crossref",
  semanticscholar: "Semantic Scholar",
  arxiv: "arXiv",
  biorxiv: "bioRxiv",
  medrxiv: "medRxiv",
  // Reserved, never written: OpenAlex ships no adapter in v1 (decision D2), so
  // no work can carry it in `seenIn`. Present so the record is exhaustive.
  openalex: "OpenAlex",
};

// ---------------------------------------------------------------------------
// 4. The mapping
// ---------------------------------------------------------------------------

/** What one mapping produced: the item JSON, plus anything §6.3's cap deferred. */
export interface ZoteroMapping {
  readonly itemJSON: ZoteroItemJSON;
  /**
   * HTML for a child note, when the `extra` growth cap tripped (§6.3) and
   * `extra` therefore carries only `rh-work-key`. `undefined` otherwise.
   *
   * The note is *content*, produced here; creating the note item is a platform
   * write and belongs to the caller.
   */
  readonly overflowNote?: string;
}

/**
 * Map a {@link CanonicalWork} to Zotero item JSON, per §6.2's table.
 *
 * **Two columns** (`P2-T08` replaced Phase 1's throw for `preprint`). A
 * `preprint` is filled from §6.2's `preprint` column and nothing else: §6.1
 * verifies that the type has **no** `publicationTitle`, `ISSN`, `PMID` or
 * `PMCID`, and `repository` / `archiveID` are base-mapped onto `publisher` /
 * `number`, so writing a `journalArticle` field there would be rejected in
 * strict mode or silently land somewhere else. Its identifiers without a
 * field — PMID, PMCID — go to `PMID:` / `PMCID:` `extra` lines whatever
 * `nativeIdentifierFields` reports, because that detection is about
 * `journalArticle`.
 *
 * @param work - the merged canonical record
 * @param options - clock, schema and catalogue facts the work does not carry
 * @returns the item JSON and any deferred `extra` payload
 */
export function toZoteroMapping(
  work: CanonicalWork,
  options: ZoteroMappingOptions = {},
): ZoteroMapping {
  const itemType = zoteroItemTypeFor(work.type);
  const isPreprint = itemType === "preprint";

  const accessedAtEpochMs = options.accessedAtEpochMs ?? Date.now();
  const native = options.nativeIdentifierFields ?? NATIVE_ID_FIELDS_PRESENT;

  // The plugin's own lines. rh-work-key is first because §6.3's overflow rule
  // keeps exactly the first one.
  const pluginLines: ExtraEntry[] = [{ key: RH_WORK_KEY, value: work.workKey }];
  if (
    (options.includeSourcesLine ?? true) &&
    work.provenance.seenIn.length > 0
  ) {
    pluginLines.push({
      key: RH_SOURCES_KEY,
      value: work.provenance.seenIn.join(","),
    });
  }
  if (!isPreprint && work.type !== "journal-article") {
    // §6.2's "everything else → journalArticle with a note in extra". The note
    // is namespaced because §6.3 gives the plugin exactly one prefix, and it
    // records the real type so §6.6's read-back is not lossy. A `preprint`
    // item's type *is* its WorkType, so it has nothing to record.
    pluginLines.push({ key: RH_WORK_TYPE_KEY, value: work.type });
  }
  // A preprint carries no ISSN at all (§6.1; §6.2's `issn[1..]` row has no
  // preprint column since 2026-10-15) — not the first, not the rest.
  const extraIssns = isPreprint ? [] : (work.issn?.slice(1) ?? []);
  if (extraIssns.length > 0) {
    // §6.2: "Additional ISSNs → extra". Namespaced, not a bare `ISSN:` line:
    // `journalArticle` *has* a native `ISSN` field (holding issn[0]), and §6.3
    // permits a non-namespaced line only where there is no native field.
    pluginLines.push({ key: RH_ISSN_KEY, value: extraIssns.join(", ") });
  }
  if (work.ids.s2CorpusId !== undefined && work.ids.s2CorpusId !== "") {
    // §6.2's `ids.s2CorpusId` row (`P2-T34`, 2026-10-15): no item type has a
    // field for it, so it is a namespaced line, written beside any other
    // identifier the work has. Without it an S2-only item kept its identity
    // only inside `rh-work-key`.
    pluginLines.push({ key: RH_S2_CORPUS_ID_KEY, value: work.ids.s2CorpusId });
  }

  // Non-namespaced ecosystem lines. Written only where there is no native
  // field, and only when no such line already exists (§6.3) — the second half
  // is enforced by applyExtraUpdate().
  // The native-field test is per item type: `nativeIdentifierFields` answers
  // it for `journalArticle`, and §6.1 answers it for `preprint` — no PMID, no
  // PMCID field, ever.
  const pmidNative = !isPreprint && native.pmid;
  const pmcidNative = !isPreprint && native.pmcid;
  const standardLines: ExtraEntry[] = [];
  if (work.ids.pmid !== undefined && !pmidNative) {
    standardLines.push({ key: ECOSYSTEM_EXTRA_KEY.pmid, value: work.ids.pmid });
  }
  if (work.ids.pmcid !== undefined && !pmcidNative) {
    standardLines.push({
      key: ECOSYSTEM_EXTRA_KEY.pmcid,
      value: work.ids.pmcid,
    });
  }
  if (work.ids.arxivId !== undefined && !isPreprint) {
    // No Zotero item type has a native arXiv-ID field (`docs/02` §10.3); on
    // `preprint` it goes in `archiveID` instead (§6.2), never in `extra`.
    standardLines.push({
      key: ECOSYSTEM_EXTRA_KEY.arxiv,
      value: work.ids.arxivId,
    });
  }
  const firstOrcid = work.authors[0]?.orcid;
  if (firstOrcid !== undefined && firstOrcid !== "") {
    // §6.2: "ORCID → extra line `ORCID: <orcid>` only for the first author
    // (Zotero has no creator-level ORCID field)."
    standardLines.push({ key: ECOSYSTEM_EXTRA_KEY.orcid, value: firstOrcid });
  }
  if (work.citationCount !== undefined) {
    standardLines.push({
      key: ECOSYSTEM_EXTRA_KEY.citations,
      value: citationsValue(work, accessedAtEpochMs),
    });
  }

  const extra = applyExtraUpdate(options.existingExtra, {
    pluginLines,
    standardLines,
  });

  const json: Record<string, unknown> = {
    itemType,
    title: work.title,
    creators: work.authors.map(toCreatorJSON),
    tags: tagsFor(work),
    accessDate: isoUtcSeconds(accessedAtEpochMs),
  };

  set(json, "abstractNote", work.abstract);
  if (isPreprint) {
    // §6.2's preprint column: the server is the repository, the server-native
    // identifier the archiveID, and nothing journal-shaped is written.
    set(json, "genre", PREPRINT_GENRE);
    set(json, "repository", repositoryFor(work));
    set(json, "archiveID", archiveIdFor(work));
  } else {
    set(json, "publicationTitle", work.containerTitle);
    set(json, "journalAbbreviation", work.containerAbbreviation);
    set(json, "publisher", work.publisher);
    set(json, "volume", work.volume);
    set(json, "issue", work.issue);
    set(json, "pages", work.pages);
    set(json, "ISSN", work.issn?.[0]);
  }
  set(json, "date", work.publishedDate?.iso);
  // Bare, never a resolver URL (§6.2), and always `normalizeDoi()`'s lowercase
  // output — the only DOI spelling the plugin stores (`docs/02` §11.1, FR-6;
  // conflict C9 closed).
  set(json, "DOI", work.ids.doi);
  if (pmidNative) set(json, "PMID", work.ids.pmid);
  if (pmcidNative) set(json, "PMCID", work.ids.pmcid);
  set(json, "url", work.url ?? work.ids.url);
  set(json, "language", work.language);
  set(json, "rights", work.openAccess?.license);
  set(json, "libraryCatalog", options.libraryCatalog ?? catalogLabelFor(work));
  if (extra.extra !== "") json["extra"] = extra.extra;

  const itemJSON = json as unknown as ZoteroItemJSON;
  return extra.overflowed
    ? { itemJSON, overflowNote: overflowNoteHtml(work, extra.deferred) }
    : { itemJSON };
}

/**
 * §6.2's documented entry point: the item JSON alone.
 *
 * Callers that must honour §6.3's overflow rule — which means writing the
 * child note — use {@link toZoteroMapping} instead. This wrapper exists
 * because §6.2 publishes the signature `toZoteroItemJSON(work): ZoteroItemJSON`
 * and a great many call sites want exactly that.
 */
export function toZoteroItemJSON(
  work: CanonicalWork,
  options: ZoteroMappingOptions = {},
): ZoteroItemJSON {
  return toZoteroMapping(work, options).itemJSON;
}

// ---------------------------------------------------------------------------
// 5. The pieces
// ---------------------------------------------------------------------------

/** Assign `key` only when `value` is a non-empty string or a number. */
function set(
  json: Record<string, unknown>,
  key: string,
  value: string | number | undefined,
): void {
  if (value === undefined) return;
  if (typeof value === "string" && value === "") return;
  json[key] = value;
}

/**
 * One creator, in `fromJSON()`'s shape.
 *
 * Single-field mode (`fieldMode: 1`) when the source gave a `literal` name and
 * no `given` — §6.2: "use single-field mode when only `literal` is known", and
 * `docs/02` §10.3's institutional-author row. With no given name a two-field
 * creator degrades to a lastName-only creator, which throws away the verbatim
 * spelling the `literal` was kept for; `docs/07` §5.1 requires `family` on
 * every {@link Author}, so "only literal" in a `CanonicalWork` means exactly
 * this — a name that did not split.
 */
function toCreatorJSON(author: Author): ZoteroCreatorJSON {
  const given = author.given ?? "";
  const literal = author.literal ?? "";
  if (given === "" && literal !== "") {
    return { creatorType: "author", name: literal, fieldMode: 1 };
  }
  return {
    creatorType: "author",
    firstName: given,
    lastName: author.family,
  };
}

/**
 * Prefixes for the subject schemes where a bare term would be ambiguous
 * (§6.2: "prefix scheme where ambiguous, e.g. `MeSH: Neoplasms`"; `docs/02`
 * §10.3 for the arXiv-category form). A scheme not listed here contributes its
 * term unprefixed, which is what `docs/02` specifies for author keywords.
 */
const SUBJECT_TAG_PREFIXES: Readonly<Record<string, string>> = {
  mesh: "MeSH",
  "arxiv-category": "arXiv",
};

/** `MeSH: Neoplasms`, or `MeSH*: Neoplasms` for a major topic (`docs/02` §10.3). */
function subjectTag(subject: Subject): string {
  const prefix = SUBJECT_TAG_PREFIXES[subject.scheme.toLowerCase()];
  if (prefix === undefined) return subject.term;
  return `${prefix}${subject.isMajor === true ? "*" : ""}: ${subject.term}`;
}

/**
 * Subjects, keywords and the run tag, all **automatic** (`type: 1`).
 *
 * Deduplicated on the rendered tag, so a term that arrives as both a MeSH
 * descriptor and an author keyword does not produce two tags. Order is
 * subjects, then keywords, then the run tag — stable, so a re-import diffs
 * cleanly.
 */
function tagsFor(work: CanonicalWork): readonly ZoteroTagJSON[] {
  const seen = new Set<string>();
  const tags: ZoteroTagJSON[] = [];
  const add = (tag: string): void => {
    const trimmed = tag.trim();
    if (trimmed === "" || seen.has(trimmed)) return;
    seen.add(trimmed);
    tags.push({ tag: trimmed, type: AUTOMATIC_TAG_TYPE });
  };
  for (const subject of work.subjects ?? []) add(subjectTag(subject));
  for (const keyword of work.keywords ?? []) add(keyword);
  // FR-7 scenario 3: an undetermined type still imports (as journalArticle,
  // via zoteroItemTypeFor) but says so where the user can see and filter it.
  if (work.type === "other") add(UNCERTAIN_TYPE_TAG);
  add(RESEARCH_HELPER_TAG);
  return tags;
}

/**
 * A preprint's `repository` (§6.2's `containerTitle` row): the server
 * {@link detectServer} finds in the work's server/publisher fields, in its
 * canonical spelling, else `containerTitle` verbatim. The DOI is handed over
 * for corroboration only; it can never name the server (`docs/02` §11.2).
 */
function repositoryFor(work: CanonicalWork): string | undefined {
  const detected = detectServer({
    serverFields: [work.containerTitle, work.publisher],
    doi: work.ids.doi,
  });
  return detected?.server ?? work.containerTitle;
}

/**
 * A preprint's `archiveID` (§6.2's `ids.arxivId` row): `arXiv:` and the id
 * **with its version** (`docs/02` §7.5 note 4), spelled by the arXiv mapper's
 * {@link arxivArchiveId}.
 *
 * `ids.arxivId` is version-stripped (§5.1), so the version comes from the
 * arXiv `SourceRecord` that contributed to the work — its id is
 * `arxiv:<versioned id>` in `provenance.recordIds` — and only when that
 * record's id strips to the same `ids.arxivId`. A work whose arXiv id came
 * from another source (Semantic Scholar's `externalIds.ArXiv`) has no version
 * to give and gets `arXiv:<id>`. `undefined` without an arXiv id: §6.2 maps
 * no other identifier to `archiveID`.
 */
function archiveIdFor(work: CanonicalWork): string | undefined {
  const arxivId = work.ids.arxivId;
  if (arxivId === undefined) return undefined;
  const prefix = `${ARXIV_SOURCE_ID}:`;
  for (const recordId of work.provenance.recordIds) {
    if (!recordId.startsWith(prefix)) continue;
    const entry = parseArxivEntryId(recordId.slice(prefix.length));
    if (entry !== undefined && normalizeArxivId(entry.versioned) === arxivId) {
      return arxivArchiveId(entry.versioned);
    }
  }
  return arxivArchiveId(arxivId);
}

/**
 * §6.2's `Citations: <n> (source, YYYY-MM-DD)`.
 *
 * The source is the one that won the field — `provenance.fieldOrigin`, which
 * §5.1's merge table records for `citationCount` precisely because "counts
 * differ legitimately between sources" — falling back to the first source that
 * returned the work.
 */
function citationsValue(work: CanonicalWork, atEpochMs: number): string {
  const origin =
    work.provenance.fieldOrigin["citationCount"] ??
    work.provenance.seenIn[0] ??
    "unknown";
  const day = new Date(atEpochMs).toISOString().slice(0, 10);
  return `${String(work.citationCount)} (${origin}, ${day})`;
}

/** The winning source's catalogue label (§6.2's `libraryCatalog` row). */
function catalogLabelFor(work: CanonicalWork): string | undefined {
  const winner = work.provenance.seenIn[0];
  return winner === undefined ? undefined : SOURCE_CATALOG_LABELS[winner];
}

/**
 * ISO 8601 UTC to second precision, e.g. `2026-09-30T04:15:00Z`.
 *
 * `accessDate` is stored as a SQL UTC datetime and `setField` "silently
 * discards anything that is not a SQL date/datetime" (`docs/01` §5.3's
 * warning); it does accept an ISO date and convert internally, which is the
 * one form a pure function can produce — `Zotero.Date.dateToSQL()` is a
 * platform call and this module's §§2–5 take no platform capability. The
 * integration spec is what proves `fromJSON(json, {strict: true})` accepts it.
 */
function isoUtcSeconds(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `&`, `<`, `>` escaped, so a title with markup cannot break the note HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The child note §6.3 substitutes when the `extra` growth cap trips.
 *
 * §6.3 says what happens ("writes a child note instead and stores only
 * `rh-work-key` in `extra`") but not what the note contains, so it carries
 * exactly the deferred lines, in the order they would have had in `extra`, and
 * a marker comment in the shape §6.4 established for the plugin's other notes
 * so this one is findable and re-writable rather than duplicated.
 */
function overflowNoteHtml(
  work: CanonicalWork,
  deferred: readonly ExtraEntry[],
): string {
  const lines = deferred
    .map(
      (entry) => `<p>${escapeHtml(entry.key)}: ${escapeHtml(entry.value)}</p>`,
    )
    .join("");
  return (
    `<!-- rh:extra v=1 workKey=${escapeHtml(work.workKey)} -->` +
    `<p><strong>research_helper metadata</strong></p>${lines}`
  );
}

// ---------------------------------------------------------------------------
// 6. Schema feature detection — the one Zotero-touching part of the mapper
// ---------------------------------------------------------------------------

/**
 * Ask this client whether `PMID`/`PMCID` are real `journalArticle` fields.
 *
 * `docs/01` §5.3: "**Feature-detect** rather than version-check:
 * `Zotero.ItemFields.getID('PMID')` returning a truthy ID is the correct way to
 * ask 'does this client have real PMID fields?'" — and the schema is versioned
 * independently of Zotero releases, so a hard-coded field list silently rots.
 *
 * ⚠️ The `await` on the first line is not optional. §5.3: `getID()` throws
 * `Zotero.Exception.UnloadedDataException` if called before the schema is
 * loaded. That is why this is async and why the result is passed *into* the
 * pure mapper instead of being read inside it.
 *
 * `isValidForType` is checked as well as `getID`, because a field can exist in
 * the schema without being valid for `journalArticle`, and it is validity for
 * the type that decides whether the value may go in the field or has to fall
 * back to an `extra` line.
 *
 * @returns which of the two identifier fields this client will accept
 */
export async function detectNativeIdentifierFields(): Promise<NativeIdentifierFields> {
  await Zotero.Schema.schemaUpdatePromise;
  const typeID = Zotero.ItemTypes.getID("journalArticle");
  const has = (field: string): boolean => {
    try {
      const fieldID: unknown = Zotero.ItemFields.getID(field);
      if (typeof fieldID !== "number" || fieldID === 0) return false;
      return Zotero.ItemFields.isValidForType(fieldID, typeID) === true;
    } catch {
      // An unknown field name is a "no", not a crash: that is exactly the
      // pre-schema-34 client this detection exists for.
      return false;
    }
  };
  return { pmid: has("PMID"), pmcid: has("PMCID") };
}

// ---------------------------------------------------------------------------
// 7. Reading from Zotero — `docs/07` §6.6's `fromZoteroItem` (`P2-T19`)
//
// The same split as §§2–5 vs §6: everything that decides what a `CanonicalWork`
// looks like is a pure function of a plain snapshot (§7.1–7.2), and the one
// function that touches a `Zotero.Item` only takes that snapshot (§7.3). That
// is what lets the round trip `toZoteroMapping` → `fromZoteroItem` be asserted
// against a real item in the integration spec while every branch of the
// derivation stays assertable in plain Node.
// ---------------------------------------------------------------------------

// ---- 7.1 The snapshot ------------------------------------------------------

/**
 * One creator as `Zotero.Item#getCreatorsJSON()` reports it: two-field
 * (`firstName`/`lastName`) or single-field (`name`), with Zotero's creator-type
 * name. Mirrors {@link ZoteroCreatorJSON} without the `fieldMode` discriminant,
 * because the read side gets `name` *or* the pair and never both.
 */
export interface ZoteroCreatorSnapshot {
  readonly creatorType: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly name?: string;
}

/**
 * The plain data `fromZoteroItem` reads off a `Zotero.Item` before mapping.
 *
 * Every member is a string or an array of strings so the snapshot can be built
 * by hand in a unit test. `fields` holds `getField(name)` for each name in
 * {@link READ_FIELDS}, with `""` where the item has no such field — which is
 * exactly what `Zotero.Item#getField` returns for a field that is not valid
 * for the item's type (read from 10.0.3's `item.js`: `if (value === undefined)
 * return ''`), so `repository` can be asked of a `journalArticle` and
 * `publicationTitle` of a `preprint` without a per-type matrix.
 */
export interface ZoteroItemSnapshot {
  /** Zotero's camelCase item-type name, e.g. `"journalArticle"`. */
  readonly itemType: string;
  readonly fields: Readonly<Partial<Record<ReadField, string>>>;
  /**
   * `getField("date", true)`: Zotero's **unformatted multipart** value,
   * `"YYYY-MM-DD <original string>"` with `00` for an unknown month or day
   * (`docs/01` §6.1 "Dates": `setField` runs `strToMultipart` on every date it
   * is given). The SQL half is what {@link partialDateFrom} parses, so the
   * read-back needs no `Zotero.Date` call and stays pure.
   */
  readonly dateMultipart: string;
  readonly creators: readonly ZoteroCreatorSnapshot[];
  /** Tag names only; the automatic/manual type is not needed to invert §6.2. */
  readonly tags: readonly string[];
}

/**
 * The fields §6.2's table writes and §6.6 therefore reads back, as Zotero
 * spells them. `date` is read separately (unformatted) and `extra` is parsed
 * through `extraField.ts`.
 */
export const READ_FIELDS = [
  "title",
  "abstractNote",
  "publicationTitle",
  "repository",
  "journalAbbreviation",
  "publisher",
  "volume",
  "issue",
  "pages",
  "ISSN",
  "DOI",
  "PMID",
  "PMCID",
  "archiveID",
  "url",
  "language",
  "extra",
] as const;

export type ReadField = (typeof READ_FIELDS)[number];

/** Options for {@link fromZoteroItem} / {@link canonicalWorkFromSnapshot}. */
export interface FromZoteroItemOptions {
  /**
   * `normalizedAtEpochMs` for the returned work — §5.1: "ms since epoch when
   * this canonical record was last rebuilt", which a read-back is. Defaults to
   * `Date.now()`; passed in so a test can pin it.
   */
  readonly nowEpochMs?: number;
}

// ---- 7.2 The pure inverse --------------------------------------------------

/**
 * `docs/07` §6.6's inverse mapping, over a plain snapshot.
 *
 * **Lossy-tolerant, as §6.6 requires**: an unknown item type maps to
 * `type: "other"` through {@link workTypeFor} unless the write path left its
 * `rh-work-type` line, which is trusted first because it records the real
 * type §6.2 could not express as an item type; a missing or unparseable date
 * yields `publishedDate: undefined`; a creator with no family name is dropped
 * (§5.1: "an author with no name is dropped").
 *
 * **The work key.** `rh-work-key` in `extra` "is trusted when present;
 * otherwise a key is derived by §5.1's five-arm precedence" — and the
 * derivation is {@link buildWorkKey} itself, called with the same four inputs
 * `src/model/merge.ts`'s `merge()` gives it when `stages.ts`'s
 * `dedupeAndMerge` builds the work (the merged `ids`, title,
 * `publishedDate.year`, first author's family name — `P2-T29` deleted the
 * pipeline's Phase 1 lift that used to make the same call), never a
 * re-implementation of the order. Two consequences worth stating:
 *
 * - For a record whose only identifier is a Semantic Scholar corpus id the
 *   round trip no longer rests on `rh-work-key` alone (`P2-T34`, 2026-10-15):
 *   §6.2's `rh-s2-corpus-id` line gives `ids.s2CorpusId` back, so the
 *   derived key is `s2:<corpusId>` — §6.6's 2026-09-30 correction — even on
 *   an item whose `rh-work-key` line was lost. Before that row the derived key
 *   for such an item was the hash arm.
 * - The hash arm hashes the title **verbatim**, as `buildWorkKey` does:
 *   `docs/07` §5.1's hash is pinned literal and `P2-T09` keys on it.
 *
 * **Identifiers are read from both homes.** `docs/01` §5.5 and `P1-T13`'s
 * measurement: `setField` performs no Extra→field migration and strict-mode
 * `fromJSON` does not either, so a `PMID` may sit in the native field, in a
 * `PMID:` line, or both. The native field wins when both are present; the
 * line is read when it is empty. Every `extra` read goes through
 * `extraField.ts`'s parser (§6.3; the CRLF trap `P1-T12` measured).
 *
 * **What is not recovered.** `openAccess` — `rights` holds a licence string
 * but §5.1's `OpenAccessInfo.isOpenAccess` is a required boolean nothing on the
 * item answers, so inventing one would be a claim, not a read; and
 * `provenance.recordIds` / `fieldOrigin`, which describe the source records
 * that were merged and have no representation on the item. `seenIn` is read
 * from `rh-sources` when present.
 *
 * @param snapshot - the item's plain data, from {@link snapshotZoteroItem}
 * @param options - the clock
 * @returns a {@link CanonicalWork} whose `workKey` the write path will reproduce
 */
export function canonicalWorkFromSnapshot(
  snapshot: ZoteroItemSnapshot,
  options: FromZoteroItemOptions = {},
): CanonicalWork {
  const field = (name: ReadField): string => snapshot.fields[name] ?? "";
  const lines = parseExtra(field("extra"));
  const extra = (key: string): string | undefined => {
    const hit = findExtraLine(lines, key);
    return hit === undefined || hit.value === "" ? undefined : hit.value;
  };

  const title = field("title");
  const authors = authorsFrom(snapshot.creators);
  const publishedDate = partialDateFrom(snapshot.dateMultipart);
  const ids = identifiersFrom(field, lines);

  const rhType = extra(RH_WORK_TYPE_KEY);
  const type: WorkType = isWorkType(rhType)
    ? rhType
    : workTypeFor(snapshot.itemType);

  const issn = [field("ISSN"), ...(extra(RH_ISSN_KEY)?.split(",") ?? [])]
    .map((value) => value.trim())
    .filter((value) => value !== "");

  const { subjects, keywords } = tagsToSubjects(snapshot.tags);
  const citations = extra(ECOSYSTEM_EXTRA_KEY.citations);
  const citationCount =
    citations === undefined ? undefined : leadingInt(citations);
  const seenIn = (extra(RH_SOURCES_KEY)?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(isSourceId);

  const work: CanonicalWork = {
    workKey:
      readWorkKey(field("extra")) ??
      buildWorkKey(ids, title, publishedDate?.year, authors[0]?.family),
    ids,
    type,
    title,
    authors,
    provenance: { recordIds: [], fieldOrigin: {}, seenIn },
    normalizedAtEpochMs: options.nowEpochMs ?? Date.now(),
  };
  return {
    ...work,
    ...optional("abstract", field("abstractNote")),
    // §6.2: `containerTitle` → `publicationTitle` on a journalArticle and
    // `repository` on a preprint. Whichever the type has is the one set.
    ...optional(
      "containerTitle",
      field("publicationTitle") || field("repository"),
    ),
    ...optional("containerAbbreviation", field("journalAbbreviation")),
    ...optional("publisher", field("publisher")),
    ...optional("volume", field("volume")),
    ...optional("issue", field("issue")),
    ...optional("pages", field("pages")),
    ...(issn.length > 0 ? { issn } : {}),
    ...(publishedDate === undefined ? {} : { publishedDate }),
    ...optional("language", field("language")),
    ...(subjects.length > 0 ? { subjects } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(citationCount === undefined ? {} : { citationCount }),
    ...optional("url", field("url")),
  };
}

/** `{ [key]: value }` when `value` is non-empty, `{}` otherwise. */
function optional<K extends string>(
  key: K,
  value: string,
): Partial<Record<K, string>> {
  return value === "" ? {} : ({ [key]: value } as Record<K, string>);
}

/**
 * The five identifiers §6.2 writes, each read from its native field first and
 * its ecosystem `extra` line second, normalized through `model/ids.ts` so the
 * value is the branded form `buildWorkKey` expects. `archiveID` is the
 * `preprint` field holding `arXiv:<id>`; {@link normalizeArxivId} strips that
 * prefix, which is what makes the native and the `extra` spelling one key.
 *
 * `s2CorpusId` has no native field on any item type; since `P2-T34`
 * (2026-10-15) it is read from the `rh-s2-corpus-id` line §6.2 now writes.
 */
function identifiersFrom(
  field: (name: ReadField) => string,
  lines: readonly ExtraLine[],
): ExternalIds {
  const line = (key: string): string | undefined =>
    findExtraLine(lines, key)?.value;
  const doi =
    normalizeDoi(field("DOI")) ?? normalizeDoi(line(ECOSYSTEM_EXTRA_KEY.doi));
  const pmid =
    normalizePmid(field("PMID")) ??
    normalizePmid(line(ECOSYSTEM_EXTRA_KEY.pmid));
  const pmcid =
    normalizePmcid(field("PMCID")) ??
    normalizePmcid(line(ECOSYSTEM_EXTRA_KEY.pmcid));
  const arxivId =
    normalizeArxivId(field("archiveID")) ??
    normalizeArxivId(line(ECOSYSTEM_EXTRA_KEY.arxiv));
  const s2CorpusId = readS2CorpusId(field("extra"));
  const url = field("url");
  return {
    ...(doi === null ? {} : { doi }),
    ...(pmid === null ? {} : { pmid }),
    ...(pmcid === null ? {} : { pmcid }),
    ...(arxivId === null ? {} : { arxivId }),
    ...(s2CorpusId === undefined ? {} : { s2CorpusId }),
    ...(url === "" ? {} : { url }),
  };
}

/**
 * The inverse of {@link toCreatorJSON}: `author` creators only, single-field
 * creators becoming an {@link Author} whose `family` and `literal` are both the
 * verbatim name (the shape §6.2 says a single-field creator came from), and a
 * creator with no family name dropped (§5.1).
 */
function authorsFrom(
  creators: readonly ZoteroCreatorSnapshot[],
): readonly Author[] {
  const out: Author[] = [];
  for (const creator of creators) {
    if (creator.creatorType !== "author") continue;
    const name = (creator.name ?? "").trim();
    if (name !== "") {
      out.push({ family: name, literal: name });
      continue;
    }
    const family = (creator.lastName ?? "").trim();
    if (family === "") continue;
    const given = (creator.firstName ?? "").trim();
    out.push(given === "" ? { family } : { family, given });
  }
  return out;
}

/** The SQL half of a multipart date: `YYYY-MM-DD`, `00` for an unknown part. */
const MULTIPART_SQL = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * §5.1's {@link PartialDate} from Zotero's multipart `date`, or `undefined`
 * when there is no year — §6.6: "missing dates yield `publishedDate:
 * undefined`". Precision follows the parts Zotero knew: a `00` month stops
 * the ISO string at the year, a `00` day at the month.
 */
export function partialDateFrom(
  dateMultipart: string,
): PartialDate | undefined {
  const match = MULTIPART_SQL.exec(dateMultipart);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0) return undefined;
  const yyyy = String(year).padStart(4, "0");
  if (month === 0) return { year, iso: yyyy };
  const mm = String(month).padStart(2, "0");
  if (day === 0) return { year, month, iso: `${yyyy}-${mm}` };
  return {
    year,
    month,
    day,
    iso: `${yyyy}-${mm}-${String(day).padStart(2, "0")}`,
  };
}

/** `MeSH: Neoplasms` / `MeSH*: Neoplasms` / `arXiv: cs.LG` back to a scheme. */
const SUBJECT_TAG = /^(MeSH|arXiv)(\*?): (.+)$/;

/** Scheme names by rendered prefix — the inverse of {@link SUBJECT_TAG_PREFIXES}. */
const SUBJECT_SCHEMES: Readonly<Record<string, string>> = {
  MeSH: "mesh",
  arXiv: "arxiv-category",
};

/**
 * The inverse of {@link tagsFor}: prefixed tags become {@link Subject}s, the
 * plugin's run tag is dropped, and everything else is a keyword. Lossy where
 * §6.2 was: an author keyword that happened to be written `MeSH: x` by someone
 * else reads back as a MeSH subject.
 */
function tagsToSubjects(tags: readonly string[]): {
  subjects: readonly Subject[];
  keywords: readonly string[];
} {
  const subjects: Subject[] = [];
  const keywords: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    // The plugin's own two tags describe the import, not the work.
    if (tag === "" || tag === RESEARCH_HELPER_TAG || tag === UNCERTAIN_TYPE_TAG)
      continue;
    const match = SUBJECT_TAG.exec(tag);
    const scheme = match === null ? undefined : SUBJECT_SCHEMES[match[1] ?? ""];
    if (match === null || scheme === undefined) {
      keywords.push(tag);
      continue;
    }
    const term = (match[3] ?? "").trim();
    subjects.push(
      scheme === "mesh"
        ? { term, scheme, isMajor: match[2] === "*" }
        : { term, scheme },
    );
  }
  return { subjects, keywords };
}

/** The leading integer of `Citations: 1220 (semanticscholar, 2026-03-07)`. */
function leadingInt(value: string): number | undefined {
  const match = /^\d+/.exec(value.trim());
  return match === null ? undefined : Number(match[0]);
}

// ---- 7.3 The one Zotero-touching part --------------------------------------

/**
 * Read a {@link ZoteroItemSnapshot} off a live item.
 *
 * Requires the item's data to be loaded: `getField()` throws
 * `Zotero.Exception.UnloadedDataException` otherwise, and an item from
 * `Zotero.Items.get()` may be in the object cache without it. Callers that
 * hold a batch should `await Zotero.Items.loadDataTypes(items)` once, as
 * `libraryIndex.ts` does; a freshly saved item is loaded already.
 */
export function snapshotZoteroItem(item: Zotero.Item): ZoteroItemSnapshot {
  const fields: Partial<Record<ReadField, string>> = {};
  for (const name of READ_FIELDS) fields[name] = item.getField(name);
  return {
    itemType: Zotero.ItemTypes.getName(item.itemTypeID),
    fields,
    // `true` = unformatted: the multipart form, not the user's original text.
    dateMultipart: item.getField("date", true),
    creators: item.getCreatorsJSON().map((creator) => ({
      creatorType: creator.creatorType,
      ...(creator.firstName === undefined
        ? {}
        : { firstName: creator.firstName }),
      ...(creator.lastName === undefined ? {} : { lastName: creator.lastName }),
      ...(creator.name === undefined ? {} : { name: creator.name }),
    })),
    tags: item.getTags().map((tag) => tag.tag),
  };
}

/**
 * `docs/07` §6.6's declared entry point: `fromZoteroItem(item): CanonicalWork`.
 *
 * {@link snapshotZoteroItem} then {@link canonicalWorkFromSnapshot}; see the
 * latter for every rule. §6.6's "written back on next write" clause — storing
 * a derived key into `rh-work-key` — is a write and is not performed here.
 */
export function fromZoteroItem(
  item: Zotero.Item,
  options: FromZoteroItemOptions = {},
): CanonicalWork {
  return canonicalWorkFromSnapshot(snapshotZoteroItem(item), options);
}
