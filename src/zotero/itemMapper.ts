/**
 * `CanonicalWork` → Zotero item JSON (`docs/07-architecture-and-data-model.md`
 * §6.2), and the `extra` rules that go with it (§6.3).
 *
 * **Scope.** `P1-T12`. `plan/README.md` §4 lists this path among the sixteen
 * where a Phase 1 `create` replaces a Phase 0 spike, so §§1–6 below are the
 * shipped mapper. §7 keeps `P0-T10`'s `buildJournalArticle()` **unchanged**,
 * because `src/zotero/zoteroApi.ts` and two integration specs still import it
 * and none of those three files is in this card's `Files` list; deleting it
 * would break code this card does not own. See the report finding on that.
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
 * Node. The two things that genuinely need Zotero —
 * {@link detectNativeIdentifierFields}, which must await
 * `Zotero.Schema.schemaUpdatePromise` first, and `buildJournalArticle` —
 * are isolated in §6 and §7 and are handed *into* the pure mapper as data.
 */

import type {
  Author,
  CanonicalWork,
  Subject,
  WorkType,
} from "../model/canonicalWork";
import type { SourceId } from "../model/ids";
import {
  applyExtraUpdate,
  RH_SOURCES_KEY,
  RH_WORK_KEY,
  type ExtraEntry,
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

// ---------------------------------------------------------------------------
// 2. WorkType ↔ Zotero item type — the camelCase/kebab-case boundary
// ---------------------------------------------------------------------------

/**
 * The Zotero item type for a {@link WorkType}.
 *
 * **Phase 1 emits exactly two answers**: `preprint` for a preprint, and
 * `journalArticle` for everything else. That is the card's specification
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
 * `preprint` throws. `docs/07` §6.2 has a `preprint` column and Phase 2 owns
 * it (`plan/02-phase-1-pubmed.md` §2); this card's `Notes` are explicit that
 * the branch is to be "left unimplemented with an explicit throw rather than a
 * half-mapping, because Phase 2 owns preprints and a silent wrong mapping is
 * worse than a loud gap". Preprints need `repository`, `archiveID` and the
 * `PMID: ` extra fallback, none of which Phase 1 exercises or tests.
 *
 * @param work - the merged canonical record
 * @param options - clock, schema and catalogue facts the work does not carry
 * @returns the item JSON and any deferred `extra` payload
 * @throws Error when `work.type` is `"preprint"`
 */
export function toZoteroMapping(
  work: CanonicalWork,
  options: ZoteroMappingOptions = {},
): ZoteroMapping {
  const itemType = zoteroItemTypeFor(work.type);
  if (itemType !== "journalArticle") {
    // TODO(P1-T02): this must become `new ZoteroApiError(...)` once
    // `src/core/errors.ts` exists. `docs/07` §10.1 declares `ZoteroApiError`
    // and `plan/02-phase-1-pubmed.md` puts it in `P1-T02`'s `Files`, which
    // this card does not depend on — reported as a wrong dependency edge
    // rather than reimplemented here, because a second error hierarchy is
    // exactly what `plan/README.md` §5 rule 3 forbids.
    throw new Error(
      `research_helper: mapping CanonicalWork.type "${work.type}" to Zotero ` +
        `item type "${itemType}" is not implemented — docs/07 §6.2's preprint ` +
        `column is Phase 2's (plan/02-phase-1-pubmed.md §2). Refusing to ` +
        `half-map work ${work.workKey}.`,
    );
  }

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
  if (work.type !== "journal-article") {
    // §6.2's "everything else → journalArticle with a note in extra". The note
    // is namespaced because §6.3 gives the plugin exactly one prefix, and it
    // records the real type so §6.6's read-back is not lossy.
    pluginLines.push({ key: "rh-work-type", value: work.type });
  }
  const extraIssns = work.issn?.slice(1) ?? [];
  if (extraIssns.length > 0) {
    // §6.2: "Additional ISSNs → extra". Namespaced, not a bare `ISSN:` line:
    // `journalArticle` *has* a native `ISSN` field (holding issn[0]), and §6.3
    // permits a non-namespaced line only where there is no native field.
    pluginLines.push({ key: "rh-issn", value: extraIssns.join(", ") });
  }

  // Non-namespaced ecosystem lines. Written only where there is no native
  // field, and only when no such line already exists (§6.3) — the second half
  // is enforced by applyExtraUpdate().
  const standardLines: ExtraEntry[] = [];
  if (work.ids.pmid !== undefined && !native.pmid) {
    standardLines.push({ key: "PMID", value: work.ids.pmid });
  }
  if (work.ids.pmcid !== undefined && !native.pmcid) {
    standardLines.push({ key: "PMCID", value: work.ids.pmcid });
  }
  if (work.ids.arxivId !== undefined) {
    // No Zotero item type has a native arXiv-ID field (`docs/02` §10.3); on
    // `preprint` it goes in `archiveID`, which this arm never reaches.
    standardLines.push({ key: "arXiv", value: work.ids.arxivId });
  }
  const firstOrcid = work.authors[0]?.orcid;
  if (firstOrcid !== undefined && firstOrcid !== "") {
    // §6.2: "ORCID → extra line `ORCID: <orcid>` only for the first author
    // (Zotero has no creator-level ORCID field)."
    standardLines.push({ key: "ORCID", value: firstOrcid });
  }
  if (work.citationCount !== undefined) {
    standardLines.push({
      key: "Citations",
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
  set(json, "publicationTitle", work.containerTitle);
  set(json, "journalAbbreviation", work.containerAbbreviation);
  set(json, "publisher", work.publisher);
  set(json, "volume", work.volume);
  set(json, "issue", work.issue);
  set(json, "pages", work.pages);
  set(json, "ISSN", work.issn?.[0]);
  set(json, "date", work.publishedDate?.iso);
  // Bare, never a resolver URL (§6.2), and always `normalizeDoi()`'s lowercase
  // output — the only DOI spelling the plugin stores (`docs/02` §11.1, FR-6;
  // conflict C9 closed).
  set(json, "DOI", work.ids.doi);
  if (native.pmid) set(json, "PMID", work.ids.pmid);
  if (native.pmcid) set(json, "PMCID", work.ids.pmcid);
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
  add(RESEARCH_HELPER_TAG);
  return tags;
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
// 7. `P0-T10`'s spike writer, kept verbatim
//
// `plan/README.md` §4 says a Phase 1 `create` of this path replaces the spike,
// and nothing in the spike is load-bearing for the shipped mapper above. It is
// retained because `src/zotero/zoteroApi.ts`, `test/integration/zotero/
// itemCreation.spec.ts` and `test/integration/zotero/batchImport.spec.ts`
// import from it, and this card's `Files` list names none of those three — so
// removing it would break files this card does not own (`plan/README.md` §5
// rule 2). Retiring it belongs to whichever card owns `zoteroApi.ts`'s spike
// command.
// ---------------------------------------------------------------------------

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

/** The subset of `docs/07` §6.2's mapping table `P0-T10` exercises. */
export interface JournalArticleRecord {
  readonly title: string;
  readonly abstractNote: string;
  /** Bare, never a URL (`docs/07` §6.2). */
  readonly DOI: string;
  readonly creators: readonly ArticleCreator[];
}

/**
 * Build one unsaved `journalArticle` from the spike record.
 *
 * The caller owns the transaction and the `save()` — `docs/01` §5.8's
 * single-writer rule means the decision of *when* to write belongs with the
 * code that knows how many items are coming, not with the mapper.
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
      creators: record.creators.map(toSpikeCreatorJSON),
    },
    // Ship non-strict, develop strict (docs/01 §5.2.1).
    { strict: __env__ === "development" },
  );

  item.addTag(RESEARCH_HELPER_TAG, AUTOMATIC_TAG_TYPE);

  return item;
}

/** One creator in the JSON shape `fromJSON()` passes to `setCreators()`. */
function toSpikeCreatorJSON(creator: ArticleCreator): Record<string, unknown> {
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
