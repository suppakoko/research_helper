/**
 * arXiv Atom `<entry>` → `SourceRecord`.
 *
 * **Scope.** `P2-T06` steps 2 and 4–7. This is the function `arxivSource.ts`
 * injects as {@link ArxivSourceDeps.mapRecords}: one page's `<entry>` elements
 * in, that page's records out, synchronously. The call-site shape is
 * {@link ArxivRecordMapper}, the same split `P1-T09` / `P1-T10` made for
 * PubMed, `P2-T03` for Europe PMC and `P2-T04` for Crossref. The feed-level
 * parse — the root, the error feed, the OpenSearch totals — is
 * `arxivSource.ts`'s `parseArxivFeedBody`; this file sees entries only.
 *
 * ## Where every field comes from
 *
 * `docs/02` §10.2's **arXiv (Atom)** column is the field-by-field source table
 * and is followed literally; `docs/07` §5.1 owns the *target* types and wins
 * where the two disagree. `docs/02` §7.5's seven parsing notes are each
 * handled where they bite:
 *
 * - **Namespaces are mandatory** (note 1). Every lookup below is by
 *   `(namespaceURI, localName)` — {@link ATOM_NS}, {@link ARXIV_NS} — through
 *   {@link childrenNS}; nothing calls `getElementsByTagName`, which "fails" on
 *   this feed (the card's first Do NOT).
 * - **`<summary>` and `<title>` are hard-wrapped** (notes 2 and 3): both go
 *   through {@link normalizeWhitespace}, the document's own
 *   `text.replace(/\s+/g, ' ').trim()`.
 * - **The arXiv id comes from `<id>`** (note 4): `http://arxiv.org/abs/2609.04658v1`
 *   → `nativeId` **`2609.04658v1`** (the version kept, for Zotero's
 *   `archiveID` — {@link arxivArchiveId} spells that value) and
 *   `ids.arxivId` **`2609.04658`** (the version stripped, for cross-source
 *   matching, through `normalizeArxivId`). {@link parseArxivEntryId} is the
 *   split. An id `normalizeArxivId` rejects still yields a record, keyed by
 *   its DOI, with `ids.arxivId` absent, listed in `missingFields` and warned
 *   about with the id, so the corpus can be measured. (`plan/00` §6 item 91's
 *   dotted subject class, `cond-mat.mes-hall/0309136`, is accepted since
 *   2026-10-15: `docs/02` §11.3.1 widened the shape and `ARXIV_SHAPE` followed.)
 * - **Every arXiv paper has a DataCite DOI** `10.48550/arXiv.<id>` (note 5),
 *   not present in the feed: {@link arxivDataCiteDoi} constructs it from the
 *   version-stripped id and `normalizeDoi` lowercases it (`docs/02` §11.1).
 *   **`<arxiv:doi>`, when present, is the journal DOI** of the published
 *   version, never the preprint's own (note 5; the card's second Do NOT): it
 *   goes to `relatedVersionIds.doi`, which is `docs/07` §5.1's "set when this
 *   preprint has a published version" and `docs/02` §11.4's confidence-1.00
 *   signal — the published-version signal `P2-T11` reads. `ids.doi` is the
 *   constructed DataCite DOI in every case.
 * - **`<category term>`** → `subjects` with `scheme: "arxiv-category"`
 *   ({@link ARXIV_CATEGORY_SCHEME}, the spelling `docs/07` §5.1's `Subject`
 *   doc and `src/zotero/itemMapper.ts` both use), the
 *   `<arxiv:primary_category>` first.
 * - **`type` is always `preprint`** and `containerTitle` is the repository
 *   name {@link ARXIV_REPOSITORY_NAME} — §10.2's `venue.repository` cell, which
 *   `docs/07` §6.2 maps to Zotero's `repository` on a `preprint` item.
 * - **`author/name`** is split into `family` / `given` on the last whitespace
 *   (§10.2: "split from `author/name`") — the last token is the family name,
 *   everything before it the given names; a one-token name is `family` only.
 *   `<arxiv:affiliation>` children become `affiliations`. arXiv carries no
 *   ORCID (§10.2).
 * - **`published`** → `publishedDate` at day precision; `updated` is the
 *   latest version's date and has no §5.1 slot, so it is not mapped.
 * - **`link[@title="pdf"]`** → `openAccess.pdfUrl` (§10.2) with
 *   `isOpenAccess: true` — a linked free e-print is what §5.1's `pdfUrl`
 *   means; `link[@rel="alternate"]` → `url`, falling back to the `<id>` URL.
 * - **`language`** is `"en"`, §10.2's constant for this column.
 * - **`<arxiv:comment>` and `<arxiv:journal_ref>`** have no `docs/07` §5.1
 *   slot (`journal_ref` is §11.4's 0.90 text-only signal) and are not mapped;
 *   the card report records the gap.
 *
 * ## Absent vs. not understood — the same two-way split as the other mappers
 *
 * Absent → the field is absent and its name is in `missingFields`. Present but
 * not understood → absent, in `missingFields`, **and** a `warn` line through
 * the injected {@link Logger}. The domain of `missingFields` is
 * {@link ARXIV_MAPPABLE_FIELDS}; `type`, `containerTitle` and `language` are
 * constants and `relatedVersionIds` is legitimately absent for an unpublished
 * preprint, so none of the four is a gap.
 *
 * ## `DOMParser` is injected, not imported
 *
 * As `src/sources/pubmed/mapper.ts` explains: the sandbox has `DOMParser`
 * (`docs/01` §2.3), plain Node does not (`docs/13` §2.1), so the parse arrives
 * as a port — {@link XmlParser}, with {@link domParserXml} as the default —
 * and this file declares the slice of DOM it reads: `namespaceURI`,
 * `localName`, `textContent`, `getAttribute` and `children`. A real Gecko
 * `Element` satisfies it structurally. The port is declared here and the feed
 * parse in `arxivSource.ts` imports it, so the two files read one DOM.
 *
 * ## `raw`, and NFR-7
 *
 * Omitted by default. With {@link ArxivMapperDeps.keepRaw} the record keeps
 * its own `<entry>` element — the parsed node, not a re-serialisation, for the
 * reason the Crossref mapper keeps the parsed item.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3). Nothing
 * here names the `Zotero` global, reads a preference, touches a file or
 * imports `src/zotero/**`. Diagnostics go through {@link Logger}.
 */

import type { Clock } from "../../core/clock";
import type { Logger } from "../../core/logger";
import type {
  Author,
  OpenAccessInfo,
  PartialDate,
  Subject,
} from "../../model/canonicalWork";
import {
  normalizeArxivId,
  normalizeDoi,
  type ArxivId,
  type Doi,
  type SourceId,
} from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";

// ---------------------------------------------------------------------------
// 1. The XML port
// ---------------------------------------------------------------------------

/** A live `HTMLCollection`-shaped list, as this mapper reads one. */
export interface XmlCollectionLike {
  readonly length: number;
  item(index: number): XmlElementLike | null;
}

/**
 * The slice of a DOM `Element` this mapper and the feed parse use. A real
 * Gecko `Element` satisfies this structurally, so {@link domParserXml} needs
 * no cast.
 */
export interface XmlElementLike {
  /** The element's namespace, `null` for an element in no namespace. */
  readonly namespaceURI: string | null;
  /** Local tag name, without any prefix. */
  readonly localName: string;
  /** Concatenated descendant text. */
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  /** Direct *element* children, in document order. */
  readonly children: XmlCollectionLike;
}

/** The slice of a DOM `Document` the feed parse uses. */
export interface XmlDocumentLike {
  readonly documentElement: XmlElementLike | null;
}

/**
 * Parse an XML document. Never throws for malformed input: Gecko's `DOMParser`
 * reports a parse failure by returning a document whose root element is
 * `<parsererror>`, and `parseArxivFeedBody` turns that into a `ParseError`.
 */
export type XmlParser = (xml: string) => XmlDocumentLike;

/**
 * The production parser: the sandbox's own `DOMParser` in `application/xml`
 * mode, exactly as `docs/02` §7.5's snippet writes it.
 *
 * @param xml - an Atom feed, as `responseType: "text"` gave it
 * @returns the parsed document
 */
export function domParserXml(xml: string): XmlDocumentLike {
  return new DOMParser().parseFromString(xml, "application/xml");
}

/** Gecko's root element for a document that failed to parse. */
export const PARSER_ERROR_TAG = "parsererror";

// ---------------------------------------------------------------------------
// 2. Constants — the three namespaces and the identity rules
// ---------------------------------------------------------------------------

/** `docs/02` §7.5: the Atom 1.0 namespace. */
export const ATOM_NS = "http://www.w3.org/2005/Atom";
/** `docs/02` §7.5: arXiv's own extension namespace. */
export const ARXIV_NS = "http://arxiv.org/schemas/atom";
/** `docs/02` §7.5: the OpenSearch namespace of the three totals. */
export const OPENSEARCH_NS = "http://a9.com/-/spec/opensearch/1.1/";

/** `docs/07` §11.1 step 3: the `SourceId` *is* the adapter's identity. */
export const ARXIV_SOURCE_ID: SourceId = "arxiv";

/** `docs/02` §10.2's `venue.repository` cell for this column. */
export const ARXIV_REPOSITORY_NAME = "arXiv";

/** `docs/07` §5.1's `Subject.scheme` spelling for an arXiv category. */
export const ARXIV_CATEGORY_SCHEME = "arxiv-category";

/** `docs/02` §10.2's `language` cell for this column. */
export const ARXIV_LANGUAGE = "en";

/** `docs/02` §7.5 note 5: the DataCite DOI prefix every e-print has. */
export const ARXIV_DOI_PREFIX = "10.48550/arXiv.";

/** `docs/07` §6.2: Zotero's `archiveID` carries `arXiv:<id>`. */
export const ARXIV_ARCHIVE_ID_PREFIX = "arXiv:";

/**
 * The canonical fields `docs/02` §10.2's arXiv column says the feed can
 * supply, in `docs/07` §5.1's spelling — the domain of
 * {@link SourceRecord.missingFields}.
 */
export const ARXIV_MAPPABLE_FIELDS: readonly string[] = [
  "title",
  "abstract",
  "authors",
  "publishedDate",
  "subjects",
  "openAccess",
  "url",
  "ids.doi",
  "ids.arxivId",
];

// ---------------------------------------------------------------------------
// 3. DOM walking helpers — namespaced, every read guarded
// ---------------------------------------------------------------------------

/**
 * The direct children of `el` in namespace `ns` with local name `local`, in
 * document order. The only way this file reaches a child (§7.5 note 1).
 */
export function childrenNS(
  el: XmlElementLike,
  ns: string,
  local: string,
): readonly XmlElementLike[] {
  const out: XmlElementLike[] = [];
  const { children } = el;
  for (let i = 0; i < children.length; i += 1) {
    const child = children.item(i);
    if (
      child !== null &&
      child.namespaceURI === ns &&
      child.localName === local
    ) {
      out.push(child);
    }
  }
  return out;
}

/** The first such child, or `undefined`. */
function firstNS(
  el: XmlElementLike,
  ns: string,
  local: string,
): XmlElementLike | undefined {
  return childrenNS(el, ns, local)[0];
}

/** The trimmed text of the first such child, or `undefined` when absent or blank. */
function textNS(
  el: XmlElementLike,
  ns: string,
  local: string,
): string | undefined {
  const text = firstNS(el, ns, local)?.textContent;
  if (text === undefined || text === null) return undefined;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A trimmed, non-empty attribute value, or `undefined`. */
function attr(el: XmlElementLike, name: string): string | undefined {
  const value = el.getAttribute(name);
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** `docs/02` §7.5 notes 2 and 3, verbatim: collapse runs of whitespace. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

// ---------------------------------------------------------------------------
// 4. Identity — the arXiv id, the two DOIs, the archive id
// ---------------------------------------------------------------------------

/** What `<id>` says about the paper, split as §7.5 note 4 asks. */
export interface ArxivEntryId {
  /** The id with its version: `2609.04658v1`. `nativeId`, and the `archiveID` value. */
  readonly versioned: string;
  /** The id without its version: `2609.04658`. The matching key. */
  readonly unversioned: string;
  /** The version number, when `<id>` carried one. */
  readonly version: number | undefined;
}

/** `http://arxiv.org/abs/<id>` in either scheme, with or without `www.`. */
const ABS_URL = /^https?:\/\/(?:www\.)?arxiv\.org\/abs\//iu;

/** A trailing `vN`. */
const VERSION_SUFFIX = /v(\d+)$/iu;

/**
 * Split an Atom `<id>` (`http://arxiv.org/abs/2609.04658v1`) into the
 * versioned id, the version-stripped id and the version.
 *
 * Only the URL form and a bare id are accepted; the shape of the id itself is
 * **not** checked here, so an old-style id with a dotted subject class
 * (`cond-mat.mes-hall/0309136v1`) still splits — `normalizeArxivId` is where
 * `docs/02` §11.3.1's shape rule applies, and {@link mapEntry} reports what
 * it rejects.
 *
 * @param idText - the `<id>` element's text
 * @returns the split, or `undefined` for text that is not an arXiv id at all
 */
export function parseArxivEntryId(
  idText: string | undefined,
): ArxivEntryId | undefined {
  if (idText === undefined) return undefined;
  const versioned = idText.trim().replace(ABS_URL, "");
  if (
    versioned === "" ||
    /[\s<>"]/u.test(versioned) ||
    versioned.includes("://")
  ) {
    return undefined;
  }
  const match = VERSION_SUFFIX.exec(versioned);
  const version = match?.[1] === undefined ? undefined : Number(match[1]);
  return {
    versioned,
    unversioned: versioned.replace(VERSION_SUFFIX, ""),
    version:
      version !== undefined && Number.isSafeInteger(version)
        ? version
        : undefined,
  };
}

/**
 * The value `docs/07` §6.2 writes into Zotero's `archiveID` on a `preprint`
 * item: `arXiv:` plus the **versioned** id (`docs/02` §7.5 note 4: "keep it
 * for the Zotero `archiveID`"). The item mapper that writes it is
 * `src/zotero/itemMapper.ts`'s `preprint` arm (`P2-T08`), which calls this
 * with the version read back from the record's `arxiv:<nativeId>` id in
 * `provenance.recordIds`; `normalizeArxivId` reads it back.
 *
 * @param versionedId - {@link ArxivEntryId.versioned}, or a record's `nativeId`
 * @returns `arXiv:2609.04658v1`
 */
export function arxivArchiveId(versionedId: string): string {
  return `${ARXIV_ARCHIVE_ID_PREFIX}${versionedId}`;
}

/**
 * The DataCite DOI every arXiv paper has (`docs/02` §7.5 note 5), constructed
 * from the version-stripped id and normalised the way every DOI in the plugin
 * is (`docs/02` §11.1: lowercase).
 *
 * @param unversionedId - {@link ArxivEntryId.unversioned}
 * @returns the branded, lowercase DOI, or `null` for an id that cannot form one
 */
export function arxivDataCiteDoi(unversionedId: string): Doi | null {
  if (unversionedId.trim() === "") return null;
  return normalizeDoi(`${ARXIV_DOI_PREFIX}${unversionedId}`);
}

// ---------------------------------------------------------------------------
// 5. Dates, authors, subjects, links
// ---------------------------------------------------------------------------

/** `2026-09-04T02:40:47Z` → day precision; anything else `undefined`. */
const ATOM_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/u;

/**
 * An Atom timestamp → `docs/07` §5.1's `PartialDate` at day precision. arXiv
 * always writes a full RFC 3339 instant, so there is no coarser form to read.
 *
 * @param text - `<published>`'s text
 * @returns the date, or `undefined` for text that is not one
 */
export function readAtomDate(
  text: string | undefined,
): PartialDate | undefined {
  if (text === undefined) return undefined;
  const match = ATOM_DATE.exec(text.trim());
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  return { year, month, day, iso: `${match[1]}-${match[2]}-${match[3]}` };
}

/**
 * `docs/02` §10.2: `authors[].lastName` / `firstName` are "split from
 * `author/name`". The last whitespace-separated token is the family name and
 * the rest the given names; a one-token name is `family` alone.
 *
 * @param name - `<author><name>` text, already whitespace-normalised
 * @returns the two halves
 */
export function splitAuthorName(name: string): {
  readonly family: string;
  readonly given: string | undefined;
} {
  const tokens = name.split(" ");
  const family = tokens[tokens.length - 1] ?? name;
  const given = tokens.slice(0, -1).join(" ");
  return { family, given: given === "" ? undefined : given };
}

/** One `<author>`: `name` split, `arxiv:affiliation` children kept. */
function mapAuthor(el: XmlElementLike, sequence: number): Author | null {
  const raw = textNS(el, ATOM_NS, "name");
  if (raw === undefined) return null;
  const { family, given } = splitAuthorName(normalizeWhitespace(raw));
  const affiliations = childrenNS(el, ARXIV_NS, "affiliation")
    .map((a) => normalizeWhitespace(a.textContent ?? ""))
    .filter((a) => a.length > 0);
  return {
    family,
    ...(given !== undefined && { given }),
    ...(affiliations.length > 0 && { affiliations }),
    sequence,
  };
}

/**
 * `category[@term]` → one `Subject` each, `scheme: "arxiv-category"`, the
 * `arxiv:primary_category` first and every term once.
 */
function readSubjects(entry: XmlElementLike): Subject[] {
  const terms: string[] = [];
  const primary = firstNS(entry, ARXIV_NS, "primary_category");
  const primaryTerm = primary === undefined ? undefined : attr(primary, "term");
  if (primaryTerm !== undefined) terms.push(primaryTerm);
  for (const category of childrenNS(entry, ATOM_NS, "category")) {
    const term = attr(category, "term");
    if (term !== undefined && !terms.includes(term)) terms.push(term);
  }
  return terms.map((term) => ({ term, scheme: ARXIV_CATEGORY_SCHEME }));
}

/** The `href` of the first `<link>` matching `predicate`. */
function linkHref(
  entry: XmlElementLike,
  predicate: (link: XmlElementLike) => boolean,
): string | undefined {
  for (const link of childrenNS(entry, ATOM_NS, "link")) {
    if (predicate(link)) return attr(link, "href");
  }
  return undefined;
}

/**
 * `docs/02` §10.2: `openAccess.pdfUrl` from `link[@title='pdf']`. Every
 * e-print is freely readable at that link, so a record that has it is open
 * access; a record without the link says nothing and gets no `openAccess`.
 */
function readOpenAccess(entry: XmlElementLike): OpenAccessInfo | undefined {
  const pdfUrl = linkHref(entry, (l) => attr(l, "title") === "pdf");
  if (pdfUrl === undefined) return undefined;
  return { isOpenAccess: true, pdfUrl };
}

// ---------------------------------------------------------------------------
// 6. One entry
// ---------------------------------------------------------------------------

/** What {@link createArxivRecordMapper} needs from the composition root. */
export interface ArxivMapperDeps {
  /** `src/core/clock.ts`. Supplies `SourceRecord.retrievedAtEpochMs`. */
  readonly clock: Clock;
  /**
   * `docs/07` §5.1 / §8.5's `logRequestBodies`, resolved by the composition
   * root. `true` keeps each record's own `<entry>` element; `false` — the
   * default, and what NFR-7 requires — keeps nothing.
   */
  readonly keepRaw?: boolean;
  /** Diagnostics. Never given a summary or a whole entry. */
  readonly logger?: Logger;
}

/**
 * The mapper as `arxivSource.ts` consumes it: one page's `<entry>` elements
 * in, that page's records out, in order.
 */
export type ArxivRecordMapper = (
  entries: readonly XmlElementLike[],
) => readonly SourceRecord[];

type Warn = (msg: string, ctx: Record<string, unknown>) => void;

/**
 * Map one `<entry>`. Exported for the unit test's hand-built cases; the
 * adapter goes through {@link createArxivRecordMapper}.
 *
 * @returns the record, or `null` when `<id>` is not an arXiv id (the caller
 *   has warned) — there is then no identity to key the record by
 */
export function mapEntry(
  entry: XmlElementLike,
  retrievedAtEpochMs: number,
  keepRaw: boolean,
  warn: Warn,
): SourceRecord | null {
  // --- identity -----------------------------------------------------------
  const idText = textNS(entry, ATOM_NS, "id");
  const entryId = parseArxivEntryId(idText);
  if (entryId === undefined) {
    warn("arxiv mapper: entry has no usable <id>, dropped", {
      field: "nativeId",
      path: "entry/id",
      ...(idText !== undefined && { value: idText.slice(0, 64) }),
    });
    return null;
  }
  const arxivId = normalizeArxivId(entryId.unversioned);
  if (arxivId === null) {
    // `plan/00` §6 item 91: §11.3.1's shape rule rejects a real id. The record
    // still ships, keyed by its DataCite DOI; the id is logged so the corpus
    // can be measured.
    warn("arxiv mapper: <id> is not a docs/02 §11.3.1 arXiv id shape", {
      field: "ids.arxivId",
      path: "entry/id",
      value: entryId.unversioned.slice(0, 64),
    });
  }
  const doi = arxivDataCiteDoi(entryId.unversioned);
  if (doi === null) {
    warn("arxiv mapper: DataCite DOI could not be formed from the id", {
      field: "ids.doi",
      path: "entry/id",
      value: entryId.unversioned.slice(0, 64),
    });
  }
  const ids: { doi?: Doi; arxivId?: ArxivId } = {};
  if (doi !== null) ids.doi = doi;
  if (arxivId !== null) ids.arxivId = arxivId;

  // --- title and abstract ---------------------------------------------------
  const rawTitle = textNS(entry, ATOM_NS, "title");
  const title = rawTitle === undefined ? "" : normalizeWhitespace(rawTitle);
  const rawSummary = textNS(entry, ATOM_NS, "summary");
  const abstract =
    rawSummary === undefined ? undefined : normalizeWhitespace(rawSummary);

  // --- authors ------------------------------------------------------------
  const authors: Author[] = [];
  let dropped = 0;
  for (const author of childrenNS(entry, ATOM_NS, "author")) {
    const mapped = mapAuthor(author, authors.length);
    if (mapped === null) dropped += 1;
    else authors.push(mapped);
  }
  if (dropped > 0) {
    warn("arxiv mapper: authors dropped for having no <name>", {
      field: "authors",
      path: "entry/author",
      dropped,
    });
  }

  // --- the published version (docs/02 §7.5 note 5, §11.4) -----------------
  const journalDoiText = textNS(entry, ARXIV_NS, "doi");
  const journalDoi =
    journalDoiText === undefined ? null : normalizeDoi(journalDoiText);
  if (journalDoiText !== undefined && journalDoi === null) {
    warn("arxiv mapper: <arxiv:doi> is not a DOI", {
      field: "relatedVersionIds",
      path: "entry/arxiv:doi",
      value: journalDoiText.slice(0, 64),
    });
  }

  // --- the rest -------------------------------------------------------------
  const publishedText = textNS(entry, ATOM_NS, "published");
  const publishedDate = readAtomDate(publishedText);
  if (publishedText !== undefined && publishedDate === undefined) {
    warn("arxiv mapper: <published> is not an Atom date", {
      field: "publishedDate",
      path: "entry/published",
      value: publishedText.slice(0, 40),
    });
  }
  const subjects = readSubjects(entry);
  const openAccess = readOpenAccess(entry);
  const url =
    linkHref(entry, (l) => attr(l, "rel") === "alternate") ??
    (idText === undefined ? undefined : idText.trim());

  const work: SourceRecord["work"] = {
    ids,
    type: "preprint",
    title,
    ...(abstract !== undefined && abstract.length > 0 && { abstract }),
    authors,
    containerTitle: ARXIV_REPOSITORY_NAME,
    ...(publishedDate !== undefined && { publishedDate }),
    language: ARXIV_LANGUAGE,
    ...(subjects.length > 0 && { subjects }),
    ...(openAccess !== undefined && { openAccess }),
    ...(url !== undefined && { url }),
    ...(journalDoi !== null && { relatedVersionIds: { doi: journalDoi } }),
  };

  return {
    id: `${ARXIV_SOURCE_ID}:${entryId.versioned}`,
    sourceId: ARXIV_SOURCE_ID,
    nativeId: entryId.versioned,
    work,
    retrievedAtEpochMs,
    ...(keepRaw && { raw: entry }),
    missingFields: collectMissingFields(work),
  };
}

/** Every {@link ARXIV_MAPPABLE_FIELDS} member the entry did not supply. */
function collectMissingFields(work: SourceRecord["work"]): readonly string[] {
  const present = new Set<string>();
  if (work.title.length > 0) present.add("title");
  if (work.abstract !== undefined) present.add("abstract");
  if (work.authors.length > 0) present.add("authors");
  if (work.publishedDate !== undefined) present.add("publishedDate");
  if (work.subjects !== undefined) present.add("subjects");
  if (work.openAccess !== undefined) present.add("openAccess");
  if (work.url !== undefined) present.add("url");
  if (work.ids.doi !== undefined) present.add("ids.doi");
  if (work.ids.arxivId !== undefined) present.add("ids.arxivId");
  return ARXIV_MAPPABLE_FIELDS.filter((f) => !present.has(f));
}

// ---------------------------------------------------------------------------
// 7. The mapper
// ---------------------------------------------------------------------------

/**
 * Build the `<entry>[]` → `SourceRecord[]` mapper the adapter injects.
 * Synchronous; an entry with no usable `<id>` is dropped with a warning rather
 * than emitted broken; nothing here throws for a malformed entry, because the
 * feed-level shape is `arxivSource.ts`'s to validate.
 *
 * @param deps - the clock, and optionally `keepRaw` and a logger
 * @returns the mapper
 */
export function createArxivRecordMapper(
  deps: ArxivMapperDeps,
): ArxivRecordMapper {
  const keepRaw = deps.keepRaw ?? false;
  const { clock, logger } = deps;
  const warn: Warn = (msg, ctx) => {
    logger?.warn(msg, { ...ctx, sourceId: ARXIV_SOURCE_ID });
  };
  return (entries) => {
    const retrievedAtEpochMs = clock.now();
    const out: SourceRecord[] = [];
    for (const entry of entries) {
      const record = mapEntry(entry, retrievedAtEpochMs, keepRaw, warn);
      if (record !== null) out.push(record);
    }
    return out;
  };
}
