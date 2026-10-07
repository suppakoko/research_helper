/**
 * PubMed `efetch` XML → `SourceRecord`.
 *
 * **Scope.** `P1-T10`. This is the function `P1-T09`'s adapter injects as
 * {@link PubmedSourceDeps.mapRecords}: one `efetch` response body in, that
 * batch's records out, synchronously. The call-site shape is fixed by
 * `src/sources/pubmed/pubmedSource.ts`'s `PubmedRecordMapper`
 * (`(xml: string) => readonly SourceRecord[]`), not invented here.
 *
 * ## Where every field comes from
 *
 * `docs/02-literature-database-apis.md` §10.2's PubMed column is the field-by-field
 * source-path table and is followed literally. `docs/07` §5.1 owns the *target*
 * types, and where the two disagree §10.1's reconciliation note ("treat any
 * divergence from doc 07 §5.1 as a defect in this document") settles it. The
 * three divergences that bite:
 *
 * - §10.2 writes `venue.name` / `venue.abbreviation` / `venue.issn`; §5.1 has
 *   `CanonicalWork.containerTitle`, `containerAbbreviation` and `issn`.
 * - §10.2 writes `dates.issued`; §5.1 has `publishedDate`.
 * - §10.2 maps PubMed's `MeshHeadingList` to a `meshTerms` field and
 *   `PublicationTypeList` to `subjects`. §5.1 has **no** `meshTerms`: it has one
 *   `subjects: Subject[]` carrying `scheme`, `id` and `isMajor`, which is
 *   exactly what MeSH needs. `P1-T10` step 7 is explicit that MeSH is what goes
 *   in `subjects`, and §10.2's `openAccess.rightsNotice` row
 *   (`Abstract/CopyrightInformation`) has no §5.1 home at all, so that element
 *   is read by nothing here.
 *
 * ## The seven `docs/02` §3.4 parsing notes, and what each one forced
 *
 * 1. **Structured abstracts** — several `<AbstractText>`, each with `Label=`.
 *    {@link flattenAbstract} joins `"{Label}: {text}"` with `\n\n`, which is
 *    also `docs/07` §5.1's merge-rule row for `abstract` ("flattened with
 *    section labels preserved").
 * 2. **Inline markup** — `<sup>`, `<i>` and friends live *inside*
 *    `AbstractText`. Only `textContent` is ever read, here and everywhere else
 *    in this file; `innerHTML` is never touched.
 * 3. **Numeric character references** — `&#x2009;`, `&#xa9;`. Decoding them is
 *    the XML parser's job, which is why {@link XmlParser} is a port and why
 *    nothing below looks at the response text again after parsing. There is no
 *    regex over XML in this file.
 * 4. **Four date shapes**, and `PubMedPubDate[@PubStatus='pubmed']` ranked
 *    first because `<PubDate>` can be free text. See {@link readPublishedDate}.
 * 5. **Missing abstracts** are routine — a `missingFields` entry, never an
 *    error.
 * 6. **MeSH `@UI` / `@MajorTopicYN`** are both carried through.
 * 7. **PMCID** comes from `PubmedData/ArticleIdList/ArticleId[@IdType='pmc']`,
 *    not from `MedlineCitation`.
 *
 * ## `DOMParser` is injected, not imported
 *
 * `docs/01` §2.3's measured sandbox-global list — probed two independent ways on
 * Zotero 10.0.1 by `P0-T08`, and corroborated by §5.6's reading of
 * `_loadScope()`'s `wantGlobalProperties` — puts `DOMParser` in **Present**, so
 * {@link domParserXml} is the real production path and needs no shim. But
 * layer-1 unit tests run in **plain Node** (`docs/13` §2.1), where no
 * `DOMParser` exists — `scripts/spike-abstract-coverage.ts` records the same
 * fact. So the parse arrives as the {@link PubmedMapperDeps.parseXml} port, in
 * the same style as `Clock` and `HttpClient`: the sandbox default is used when
 * the caller supplies nothing.
 *
 * The port's element interface ({@link XmlElementLike}) is deliberately the
 * **smallest** slice of DOM this mapper needs — `localName`, `textContent`,
 * `getAttribute` and direct-element `children`. No `querySelector`, no
 * `getElementsByTagName`: every path below is an exact parent→child walk, so a
 * `<DescriptorName>` nested somewhere unexpected can never be silently picked
 * up as a MeSH heading.
 *
 * ## Absent in the source vs. not understood by this mapper
 *
 * A mapper that returns nothing for an input it did not parse is
 * indistinguishable from one that correctly found nothing, so the two are kept
 * apart on purpose:
 *
 * - **Absent in the source** → the field is absent from `work` and its name is
 *   in {@link SourceRecord.missingFields}. Nothing is logged.
 * - **Present but not understood** → the field is absent from `work`, its name
 *   is in `missingFields`, **and** a `warn` line is emitted through the
 *   injected {@link Logger} naming the element and the reason.
 *
 * `missingFields` is drawn from one exported list,
 * {@link PUBMED_MAPPABLE_FIELDS}: the canonical fields §10.2 says PubMed
 * `efetch` can supply. A field outside that list (`citationCount`,
 * `openAccess`, `publisher`, `url`) is not a gap in the record — PubMed never
 * supplies it — so it is never reported as one. That is what lets `P1-T22`
 * compute abstract coverage (R-17) from `missingFields` without first knowing
 * which absences are meaningful.
 *
 * ## `raw`, and NFR-7
 *
 * `NFR-7`'s first enforcement bullet is the binding one: "raw API payloads and
 * extracted full text **must not be retained after normalization**; only
 * normalized records and summaries stay resident." So `raw` is **omitted** by
 * default. `docs/07` §5.1's `raw` doc comment names the one exception —
 * retained "only when `logRequestBodies` (§8.5) is on" — and that preference is
 * read at startup by the composition root, not by `sources/` (which may not
 * touch a preference at all, §2.3). It therefore arrives as
 * {@link PubmedMapperDeps.keepRaw}, defaulting to `false`.
 *
 * When it *is* on, every record of a batch gets the same response string by
 * reference rather than a per-record slice: one string instance for the whole
 * `efetch` body (≤ 200 records, §3.4) instead of 200 re-serializations, and no
 * `XMLSerializer` dependency — which the sandbox-global list does not promise.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3). Nothing
 * here names the `Zotero` global, reads a preference, touches a file, or
 * imports `src/zotero/**` — checked by eye, because `eslint.config.js` groups
 * `src/sources/**` and `src/zotero/**` in the *same* tier and so does not
 * forbid that import. The sandbox has no `console`, `structuredClone` or
 * `AbortController` (`docs/01` §2.3); diagnostics go through {@link Logger}.
 */

import type { Clock } from "../../core/clock";
import { ParseError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import type {
  Author,
  PartialDate,
  Subject,
  WorkType,
} from "../../model/canonicalWork";
import {
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
  type ExternalIds,
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
 * The slice of a DOM `Element` this mapper uses.
 *
 * A real Gecko `Element` satisfies this structurally, so
 * {@link domParserXml} needs no cast.
 */
export interface XmlElementLike {
  /** Local tag name. PubMed's `efetch` XML is namespace-free. */
  readonly localName: string;
  /** Concatenated descendant text — note 2's answer to inline markup. */
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  /** Direct *element* children, in document order. */
  readonly children: XmlCollectionLike;
}

/** The slice of a DOM `Document` this mapper uses. */
export interface XmlDocumentLike {
  readonly documentElement: XmlElementLike | null;
}

/**
 * Parse an XML document. Never throws for malformed input: Gecko's `DOMParser`
 * reports a parse failure by returning a document whose root element is
 * `<parsererror>`, and {@link createPubmedRecordMapper} turns that into a
 * {@link ParseError}.
 */
export type XmlParser = (xml: string) => XmlDocumentLike;

/**
 * The production parser: the sandbox's own `DOMParser` in `text/xml` mode
 * (`P1-T10` step 1).
 *
 * @param xml - an `efetch` response body, as `responseType: "text"` gave it
 * @returns the parsed document
 */
export function domParserXml(xml: string): XmlDocumentLike {
  return new DOMParser().parseFromString(xml, "text/xml");
}

// ---------------------------------------------------------------------------
// 2. Constants
// ---------------------------------------------------------------------------

/** `docs/07` §11.1 step 3: the `SourceId` *is* the adapter's identity. */
export const PUBMED_SOURCE_ID: SourceId = "pubmed";

/** Gecko's root element for a document that failed to parse. */
const PARSER_ERROR_TAG = "parsererror";

/** The only document element an `efetch` XML response may have (§3.4). */
const ARTICLE_SET_TAG = "PubmedArticleSet";

/** The element each record lives in (`P1-T10` step 1). */
const ARTICLE_TAG = "PubmedArticle";

/**
 * The canonical fields `docs/02` §10.2's PubMed column says `efetch` can
 * supply, in `docs/07` §5.1's spelling.
 *
 * This list is the domain of {@link SourceRecord.missingFields}: a name in it
 * that is absent from `work` is a real gap in *this record*, while a canonical
 * field outside it is one PubMed never supplies and so is never reported.
 * `ids.pmid` is absent from the list because a record without a PMID has no
 * `SourceRecord.id` and is dropped rather than reported.
 */
export const PUBMED_MAPPABLE_FIELDS: readonly string[] = [
  "title",
  "abstract",
  "authors",
  "type",
  "containerTitle",
  "containerAbbreviation",
  "volume",
  "issue",
  "pages",
  "issn",
  "publishedDate",
  "language",
  "subjects",
  "keywords",
  "ids.doi",
  "ids.pmcid",
];

/**
 * PubMed's month spellings. `<Month>` is `6` in `PubmedData/History` and `Jun`
 * in `JournalIssue/PubDate` in the same record (`docs/02` §3.4's sample), so
 * both forms have to be read.
 */
const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

// ---------------------------------------------------------------------------
// 3. DOM walking helpers — direct children only, by exact name
// ---------------------------------------------------------------------------

/** Materialize a collection as an array, skipping nothing silently. */
function elements(list: XmlCollectionLike): XmlElementLike[] {
  const out: XmlElementLike[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list.item(i);
    if (item !== null) out.push(item);
  }
  return out;
}

/** Direct element children of `el` named `name`, in document order. */
function kids(el: XmlElementLike | null, name: string): XmlElementLike[] {
  if (el === null) return [];
  return elements(el.children).filter((c) => c.localName === name);
}

/** The first direct child named `name`, or `null`. */
function kid(el: XmlElementLike | null, name: string): XmlElementLike | null {
  return kids(el, name)[0] ?? null;
}

/** Walk an exact parent→child path, e.g. `at(article, "Article", "Journal")`. */
function at(
  el: XmlElementLike | null,
  ...names: readonly string[]
): XmlElementLike | null {
  let cursor = el;
  for (const name of names) {
    cursor = kid(cursor, name);
    if (cursor === null) return null;
  }
  return cursor;
}

/**
 * The whitespace XML pretty-printing introduces, and **only** that: tab, line
 * feed, form feed, carriage return and the ASCII space.
 *
 * `\s` would be wrong here and the mistake is invisible. `\s` includes the
 * Unicode `Zs` category, so `/\s+/g → " "` silently rewrites the `&#x2009;`
 * **thin space** of `docs/02` §3.4's own sample — and `&#xa0;`, `&#x2002;` and
 * the rest — into an ordinary space. `P1-T10`'s third criterion ("appears as a
 * thin space") then fails for a reason that looks nothing like whitespace
 * handling. `String.prototype.trim()` has the same reach, which is why the trim
 * below is spelled out rather than called.
 */
const PRINT_WHITESPACE = /[\t\n\f\r ]+/gu;

/**
 * Collapse runs of layout whitespace to one space, and trim the ends.
 *
 * `docs/07` §5.1 requires "whitespace normalized" of `abstract`, and the §3.4
 * sample's `<AbstractText>` is pretty-printed across three indented lines, so
 * without this the abstract carries the document's layout. It is deliberately
 * whitespace-only — no case folding, no punctuation stripping, no Unicode
 * normalization — so a CJK or Greek title survives byte-identically, and
 * {@link PRINT_WHITESPACE} keeps a significant Unicode space intact.
 */
function squash(value: string): string {
  return value.replace(PRINT_WHITESPACE, " ").replace(/^ | $/gu, "");
}

/** `textContent`, whitespace-normalized; `""` when the element is absent. */
function text(el: XmlElementLike | null): string {
  if (el === null) return "";
  return squash(el.textContent ?? "");
}

/** `text()` of the first child named `name`. */
function childText(el: XmlElementLike | null, name: string): string {
  return text(kid(el, name));
}

/** `undefined` for an empty string, so an optional field stays absent. */
function orUndefined(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

// ---------------------------------------------------------------------------
// 4. Dates — note 4 and `docs/13` §2.1's required shapes
// ---------------------------------------------------------------------------

/** Parse a PubMed `<Month>`: `6`, `06` or `Jun`. */
function parseMonth(raw: string): number | null {
  if (raw.length === 0) return null;
  const byName = MONTH_NAMES[raw.slice(0, 3).toLowerCase()];
  if (byName !== undefined) return byName;
  if (!/^\d{1,2}$/u.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 12 ? n : null;
}

/** Render `docs/07` §5.1's `PartialDate.iso` at the precision available. */
function isoOf(year: number, month?: number, day?: number): string {
  const y = String(year).padStart(4, "0");
  if (month === undefined) return y;
  const m = String(month).padStart(2, "0");
  if (day === undefined) return `${y}-${m}`;
  return `${y}-${m}-${String(day).padStart(2, "0")}`;
}

/** Build a {@link PartialDate}, dropping precision that is out of range. */
function partialDate(
  year: number,
  month: number | null,
  day: number | null,
): PartialDate {
  const m = month ?? undefined;
  const d =
    m !== undefined && day !== null && day >= 1 && day <= 31 ? day : undefined;
  return {
    year,
    ...(m !== undefined && { month: m }),
    ...(d !== undefined && { day: d }),
    iso: isoOf(year, m, d),
  };
}

/**
 * The outcome of reading one date element.
 *
 * `"unparsed"` is what keeps "the source had no date" apart from "the source
 * had something this mapper could not read": only the latter is logged.
 */
type DateRead =
  | { readonly kind: "absent" }
  | { readonly kind: "ok"; readonly date: PartialDate }
  | {
      readonly kind: "unparsed";
      readonly reason: string;
      readonly raw: string;
    };

/**
 * Read one `<Year>/<Month>/<Day>` or `<MedlineDate>` container.
 *
 * `<MedlineDate>` is note 4's trap: `2023 Jun-Jul` and `2024 Spring` are free
 * text, so only the leading four-digit year is taken and the result is
 * year-only. Inventing a month from `Jun-Jul` would be inventing precision the
 * source does not have, and `P1-T10`'s fifth criterion asks for exactly
 * year-only here.
 */
function readDateElement(el: XmlElementLike | null): DateRead {
  if (el === null) return { kind: "absent" };

  const medline = kid(el, "MedlineDate");
  if (medline !== null) {
    const raw = text(medline);
    const year = /(\d{4})/u.exec(raw)?.[1];
    if (year === undefined) {
      return { kind: "unparsed", reason: "MedlineDate has no year", raw };
    }
    return { kind: "ok", date: partialDate(Number(year), null, null) };
  }

  const rawYear = childText(el, "Year");
  if (rawYear.length === 0) {
    return { kind: "absent" };
  }
  if (!/^\d{1,4}$/u.test(rawYear)) {
    return { kind: "unparsed", reason: "Year is not a number", raw: rawYear };
  }

  const rawMonth = childText(el, "Month");
  const month = rawMonth.length > 0 ? parseMonth(rawMonth) : null;
  if (rawMonth.length > 0 && month === null) {
    return { kind: "unparsed", reason: "Month is not a month", raw: rawMonth };
  }

  const rawDay = childText(el, "Day");
  const day =
    rawDay.length > 0 && /^\d{1,2}$/u.test(rawDay) ? Number(rawDay) : null;
  if (rawDay.length > 0 && day === null) {
    return { kind: "unparsed", reason: "Day is not a number", raw: rawDay };
  }

  return { kind: "ok", date: partialDate(Number(rawYear), month, day) };
}

/** One candidate date container, with the §10.2 path it came from. */
interface DateCandidate {
  readonly path: string;
  readonly el: XmlElementLike | null;
}

/**
 * `publishedDate`, in note 4's order:
 * `PubmedData/History/PubMedPubDate[@PubStatus='pubmed']` → `ArticleDate` →
 * `JournalIssue/PubDate`.
 *
 * A candidate that is present but unreadable does **not** stop the walk — it is
 * logged and the next candidate is tried, which is why a record whose history
 * date is corrupt still gets its `PubDate`.
 */
function readPublishedDate(
  article: XmlElementLike,
  warn: (msg: string, ctx: Record<string, unknown>) => void,
): PartialDate | undefined {
  const history = at(article, "PubmedData", "History");
  const pubmedStatus =
    kids(history, "PubMedPubDate").find(
      (d) => d.getAttribute("PubStatus") === "pubmed",
    ) ?? null;

  const candidates: readonly DateCandidate[] = [
    {
      path: "PubmedData/History/PubMedPubDate[@PubStatus='pubmed']",
      el: pubmedStatus,
    },
    {
      path: "Article/ArticleDate",
      el: at(article, "MedlineCitation", "Article", "ArticleDate"),
    },
    {
      path: "Article/Journal/JournalIssue/PubDate",
      el: at(
        article,
        "MedlineCitation",
        "Article",
        "Journal",
        "JournalIssue",
        "PubDate",
      ),
    },
  ];

  for (const candidate of candidates) {
    const read = readDateElement(candidate.el);
    if (read.kind === "ok") return read.date;
    if (read.kind === "unparsed") {
      warn("pubmed mapper: date element not understood", {
        field: "publishedDate",
        path: candidate.path,
        reason: read.reason,
        value: read.raw.slice(0, 40),
      });
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 5. Abstract — notes 1, 2 and 5
// ---------------------------------------------------------------------------

/**
 * Flatten `Abstract/AbstractText[]`.
 *
 * One unlabelled element is its own text. Several elements, or any single one
 * carrying `Label=`, become `"{Label}: {text}"` paragraphs joined by `\n\n`
 * (note 1; `docs/07` §5.1's `abstract` merge row). An element with a label but
 * no text contributes nothing — a bare `"METHODS: "` is noise, not content.
 *
 * `CopyrightInformation` is a sibling of `AbstractText`, not a part of it, and
 * is not read: §10.2 maps it to `openAccess.rightsNotice`, which `docs/07`
 * §5.1's `OpenAccessInfo` does not declare.
 */
function flattenAbstract(abstractEl: XmlElementLike): string {
  const parts = kids(abstractEl, "AbstractText");
  const labelled = parts.filter((p) => text(p).length > 0);
  if (labelled.length === 0) return "";

  const anyLabel = labelled.some(
    (p) => (p.getAttribute("Label") ?? "").trim().length > 0,
  );
  if (labelled.length === 1 && !anyLabel) {
    return text(labelled[0] ?? null);
  }

  return labelled
    .map((p) => {
      const label = (p.getAttribute("Label") ?? "").trim();
      const body = text(p);
      return label.length > 0 ? `${label}: ${body}` : body;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// 6. Authors — `P1-T10` step 4
// ---------------------------------------------------------------------------

/**
 * Map one `<Author>`.
 *
 * `docs/07` §5.1: "Required — an author with no name is dropped", so an element
 * with neither `LastName` nor `CollectiveName` yields `null` and the caller
 * warns. `sequence` is document order, 0-based, as §5.1 specifies.
 *
 * `<CollectiveName>` is the corporate-author form PubMed uses for consortium
 * bylines. §10.2's `authors[].lastName` row names only `Author/LastName`, so
 * the collective name is read into `family` *and* `literal` rather than into a
 * field §5.1 does not have — that keeps the author from being dropped, which is
 * what §10.4's "PubMed → … authors" precedence row assumes.
 */
function mapAuthor(el: XmlElementLike, sequence: number): Author | null {
  const family = childText(el, "LastName");
  const given = childText(el, "ForeName");
  const collective = childText(el, "CollectiveName");

  const name = family.length > 0 ? family : collective;
  if (name.length === 0) return null;

  const orcidRaw =
    kids(el, "Identifier").find((i) => i.getAttribute("Source") === "ORCID") ??
    null;
  const orcid = normalizeOrcid(text(orcidRaw));

  const affiliations = kids(el, "AffiliationInfo")
    .map((info) => childText(info, "Affiliation"))
    .filter((a) => a.length > 0);

  const literal = family.length > 0 ? undefined : collective;

  return {
    family: name,
    ...(orUndefined(given) !== undefined && { given }),
    ...(literal !== undefined && { literal }),
    ...(orcid !== null && { orcid }),
    ...(affiliations.length > 0 && { affiliations }),
    sequence,
  };
}

/**
 * `docs/07` §5.1: "Bare ORCID, e.g. \"0000-0002-1825-0097\" (no URL prefix)".
 *
 * PubMed sends the bare form in the §3.4 sample but the full
 * `https://orcid.org/…` URL in other records, so the prefix is stripped. The
 * final character may be `X` (the checksum is mod-11). Anything else is not an
 * ORCID and becomes `null` rather than a wrong-shaped identifier.
 */
function normalizeOrcid(raw: string): string | null {
  const bare = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//iu, "")
    .replace(/\s+/gu, "");
  const digits = bare.replace(/-/gu, "");
  if (!/^\d{15}[\dX]$/iu.test(digits)) return null;
  return [
    digits.slice(0, 4),
    digits.slice(4, 8),
    digits.slice(8, 12),
    digits.slice(12, 16).toUpperCase(),
  ].join("-");
}

// ---------------------------------------------------------------------------
// 7. Subjects and keywords — `P1-T10` step 7, note 6
// ---------------------------------------------------------------------------

/**
 * One `Subject` per `MeshHeading/DescriptorName`.
 *
 * `@UI` is note 6's stable identifier and `@MajorTopicYN="Y"` is the flag
 * `docs/05`'s collection profiling reads, so both are carried. A
 * `DescriptorName` whose `@MajorTopicYN` is neither `Y` nor `N` keeps
 * `isMajor: false` and is warned about — the attribute was present and was not
 * understood.
 *
 * `QualifierName` is **not** emitted as a second subject: `docs/07` §5.1's
 * `Subject` has no qualifier slot, and `docs/02` §10.1's `meshTerms.qualifiers`
 * is the sketch doc 07 supersedes.
 */
function readSubjects(
  citation: XmlElementLike | null,
  warn: (msg: string, ctx: Record<string, unknown>) => void,
): Subject[] {
  const headings = kids(kid(citation, "MeshHeadingList"), "MeshHeading");
  const out: Subject[] = [];
  for (const heading of headings) {
    const descriptor = kid(heading, "DescriptorName");
    if (descriptor === null) continue;
    const term = text(descriptor);
    if (term.length === 0) continue;

    const ui = (descriptor.getAttribute("UI") ?? "").trim();
    if (ui.length === 0) {
      warn("pubmed mapper: MeSH descriptor has no UI", {
        field: "subjects",
        path: "MeshHeading/DescriptorName/@UI",
        term,
      });
    }

    const major = descriptor.getAttribute("MajorTopicYN");
    if (major !== null && major !== "Y" && major !== "N") {
      warn("pubmed mapper: MajorTopicYN not understood", {
        field: "subjects",
        path: "MeshHeading/DescriptorName/@MajorTopicYN",
        value: major.slice(0, 16),
      });
    }

    out.push({
      term,
      scheme: "mesh",
      ...(ui.length > 0 && { id: ui }),
      isMajor: major === "Y",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8. One article
// ---------------------------------------------------------------------------

/** What {@link createPubmedRecordMapper} needs from the composition root. */
export interface PubmedMapperDeps {
  /** `src/core/clock.ts`. Supplies `SourceRecord.retrievedAtEpochMs`. */
  readonly clock: Clock;
  /**
   * The XML parse. Defaults to {@link domParserXml}, the sandbox's own
   * `DOMParser`; a Node unit test injects its own, because Node has none.
   */
  readonly parseXml?: XmlParser;
  /**
   * `docs/07` §5.1 / §8.5's `logRequestBodies`, resolved by the composition
   * root. `true` keeps the response body on every record of the batch;
   * `false` — the default, and what NFR-7 requires — keeps none of it.
   */
  readonly keepRaw?: boolean;
  /** Diagnostics. Never given the response body or an abstract. */
  readonly logger?: Logger;
}

/**
 * Map one `<PubmedArticle>`.
 *
 * @returns the record, or `null` when the article has no usable PMID — which
 *   would leave `SourceRecord.id` and `nativeId` empty and so is dropped (with
 *   a warning) rather than emitted broken.
 */
function mapArticle(
  article: XmlElementLike,
  retrievedAtEpochMs: number,
  raw: string | undefined,
  warn: (msg: string, ctx: Record<string, unknown>) => void,
): SourceRecord | null {
  const citation = kid(article, "MedlineCitation");
  const articleEl = kid(citation, "Article");
  const journal = kid(articleEl, "Journal");
  const issue = kid(journal, "JournalIssue");
  const idList = at(article, "PubmedData", "ArticleIdList");
  const articleIds = kids(idList, "ArticleId");

  // --- identity -----------------------------------------------------------
  const rawPmid = childText(citation, "PMID");
  const pmid = normalizePmid(rawPmid);
  if (pmid === null) {
    warn("pubmed mapper: article has no usable PMID, dropped", {
      field: "ids.pmid",
      path: "MedlineCitation/PMID",
      value: rawPmid.slice(0, 32),
    });
    return null;
  }

  const byIdType = (idType: string): string =>
    text(articleIds.find((a) => a.getAttribute("IdType") === idType) ?? null);

  const rawDoi = byIdType("doi");
  const doi = normalizeDoi(rawDoi);
  if (rawDoi.length > 0 && doi === null) {
    warn("pubmed mapper: DOI not understood", {
      field: "ids.doi",
      path: "ArticleIdList/ArticleId[@IdType='doi']",
      value: rawDoi.slice(0, 64),
    });
  }

  const rawPmcid = byIdType("pmc");
  const pmcid = normalizePmcid(rawPmcid);
  if (rawPmcid.length > 0 && pmcid === null) {
    warn("pubmed mapper: PMCID not understood", {
      field: "ids.pmcid",
      path: "ArticleIdList/ArticleId[@IdType='pmc']",
      value: rawPmcid.slice(0, 32),
    });
  }

  const ids: ExternalIds = {
    pmid,
    ...(doi !== null && { doi }),
    ...(pmcid !== null && { pmcid }),
  };

  // --- title: §10.4's "PubMed appends a trailing `.` to strip" ------------
  const titleEl = kid(articleEl, "ArticleTitle");
  const title = squash(text(titleEl).replace(/\.$/u, ""));
  if (titleEl !== null && title.length === 0) {
    warn("pubmed mapper: ArticleTitle is present but empty", {
      field: "title",
      path: "Article/ArticleTitle",
    });
  }

  // --- abstract: notes 1, 2, 5 --------------------------------------------
  const abstractEl = kid(articleEl, "Abstract");
  const abstract = abstractEl === null ? "" : flattenAbstract(abstractEl);
  if (abstractEl !== null && abstract.length === 0) {
    warn("pubmed mapper: Abstract is present but has no text", {
      field: "abstract",
      path: "Article/Abstract/AbstractText",
    });
  }

  // --- authors ------------------------------------------------------------
  const authorEls = kids(kid(articleEl, "AuthorList"), "Author");
  const authors: Author[] = [];
  let droppedAuthors = 0;
  for (const el of authorEls) {
    const author = mapAuthor(el, authors.length);
    if (author === null) droppedAuthors += 1;
    else authors.push(author);
  }
  if (droppedAuthors > 0) {
    warn("pubmed mapper: authors dropped for having no name", {
      field: "authors",
      path: "Article/AuthorList/Author",
      dropped: droppedAuthors,
    });
  }

  // --- venue --------------------------------------------------------------
  const containerTitle = childText(journal, "Title");
  const containerAbbreviation = childText(journal, "ISOAbbreviation");
  const issn = kids(journal, "ISSN")
    .map((e) => text(e))
    .filter((v) => v.length > 0);
  const volume = childText(issue, "Volume");
  const issueNumber = childText(issue, "Issue");
  const pagination = kid(articleEl, "Pagination");
  const pages =
    childText(pagination, "MedlinePgn") ||
    [childText(pagination, "StartPage"), childText(pagination, "EndPage")]
      .filter((p) => p.length > 0)
      .join("-");

  // --- the rest -----------------------------------------------------------
  const language = childText(articleEl, "Language");
  const publishedDate = readPublishedDate(article, warn);
  const subjects = readSubjects(citation, warn);
  const keywords = kids(citation, "KeywordList")
    .flatMap((list) => kids(list, "Keyword"))
    .map((k) => text(k))
    .filter((k) => k.length > 0);

  // `docs/02` §10.2's type-mapping table gives PubMed exactly one trigger:
  // "default when a venue with an ISSN exists". None of its other rows name a
  // PubMed condition, so there is no second arm to implement here, and the
  // spelling is `docs/07` §5.1's kebab-case union, not §10.2's camelCase
  // Zotero item types (`P1-T10`'s Do NOT, `docs/02` §10.1's authority note).
  const hasVenueWithIssn = containerTitle.length > 0 && issn.length > 0;
  const type: WorkType = hasVenueWithIssn ? "journal-article" : "other";

  const work: SourceRecord["work"] = {
    ids,
    type,
    title,
    ...(orUndefined(abstract) !== undefined && { abstract }),
    authors,
    ...(orUndefined(containerTitle) !== undefined && { containerTitle }),
    ...(orUndefined(containerAbbreviation) !== undefined && {
      containerAbbreviation,
    }),
    ...(orUndefined(volume) !== undefined && { volume }),
    ...(orUndefined(issueNumber) !== undefined && { issue: issueNumber }),
    ...(orUndefined(pages) !== undefined && { pages }),
    ...(issn.length > 0 && { issn }),
    ...(publishedDate !== undefined && { publishedDate }),
    ...(orUndefined(language) !== undefined && { language }),
    ...(subjects.length > 0 && { subjects }),
    ...(keywords.length > 0 && { keywords }),
  };

  return {
    id: `${PUBMED_SOURCE_ID}:${pmid}`,
    sourceId: PUBMED_SOURCE_ID,
    nativeId: pmid,
    work,
    retrievedAtEpochMs,
    ...(raw !== undefined && { raw }),
    missingFields: collectMissingFields(work, hasVenueWithIssn),
  };
}

/**
 * `P1-T10` step 9: "every canonical field the record could not supply".
 *
 * The domain is {@link PUBMED_MAPPABLE_FIELDS}, so a field PubMed never carries
 * is not counted as a gap. `type` is reported when it fell back to `"other"`:
 * the field is always *populated*, but `"other"` means the record supplied no
 * venue-with-ISSN and therefore nothing §10.2 could classify.
 */
function collectMissingFields(
  work: SourceRecord["work"],
  hasVenueWithIssn: boolean,
): readonly string[] {
  const present = new Set<string>();
  if (work.title.length > 0) present.add("title");
  if (work.abstract !== undefined) present.add("abstract");
  if (work.authors.length > 0) present.add("authors");
  if (hasVenueWithIssn) present.add("type");
  if (work.containerTitle !== undefined) present.add("containerTitle");
  if (work.containerAbbreviation !== undefined) {
    present.add("containerAbbreviation");
  }
  if (work.volume !== undefined) present.add("volume");
  if (work.issue !== undefined) present.add("issue");
  if (work.pages !== undefined) present.add("pages");
  if (work.issn !== undefined) present.add("issn");
  if (work.publishedDate !== undefined) present.add("publishedDate");
  if (work.language !== undefined) present.add("language");
  if (work.subjects !== undefined) present.add("subjects");
  if (work.keywords !== undefined) present.add("keywords");
  if (work.ids.doi !== undefined) present.add("ids.doi");
  if (work.ids.pmcid !== undefined) present.add("ids.pmcid");
  return PUBMED_MAPPABLE_FIELDS.filter((f) => !present.has(f));
}

// ---------------------------------------------------------------------------
// 9. The mapper
// ---------------------------------------------------------------------------

/**
 * Build the `efetch` XML → `SourceRecord[]` mapper `P1-T09`'s adapter injects.
 *
 * The returned function is the `PubmedRecordMapper` of
 * `src/sources/pubmed/pubmedSource.ts`: synchronous, one response body in, that
 * batch's records out, in the order PubMed returned them.
 *
 * @param deps - the clock, and optionally the XML parser, `keepRaw` and a logger
 * @returns the mapper
 * @throws ParseError when the body is not a `PubmedArticleSet` — a malformed or
 *   truncated response, which `docs/13` §3.1 records as the `error-malformed`
 *   fixture and which must never look like zero results.
 */
export function createPubmedRecordMapper(
  deps: PubmedMapperDeps,
): (xml: string) => readonly SourceRecord[] {
  const parseXml = deps.parseXml ?? domParserXml;
  const keepRaw = deps.keepRaw ?? false;
  const { clock, logger } = deps;

  const warn = (msg: string, ctx: Record<string, unknown>): void => {
    logger?.warn(msg, { ...ctx, sourceId: PUBMED_SOURCE_ID });
  };

  return (xml: string): readonly SourceRecord[] => {
    const root = parseXml(xml).documentElement;
    if (root === null) {
      throw new ParseError(
        PUBMED_SOURCE_ID,
        "efetch response has no root element",
      );
    }
    if (root.localName === PARSER_ERROR_TAG) {
      // Gecko's DOMParser does not throw; it hands back this document instead.
      throw new ParseError(
        PUBMED_SOURCE_ID,
        "efetch response is not well-formed XML",
        { detail: text(root).slice(0, 200) },
      );
    }
    if (root.localName !== ARTICLE_SET_TAG) {
      throw new ParseError(
        PUBMED_SOURCE_ID,
        `efetch response root is <${root.localName}>, expected <${ARTICLE_SET_TAG}>`,
      );
    }

    const retrievedAtEpochMs = clock.now();
    const raw = keepRaw ? xml : undefined;
    const records: SourceRecord[] = [];

    for (const child of elements(root.children)) {
      if (child.localName !== ARTICLE_TAG) {
        // `<PubmedBookArticle>` and `<DeleteCitation>` both appear here and
        // neither is a `PubmedArticle`. Skipping them quietly would be
        // indistinguishable from a batch that returned nothing.
        warn("pubmed mapper: unmapped PubmedArticleSet child skipped", {
          path: `${ARTICLE_SET_TAG}/${child.localName}`,
        });
        continue;
      }
      const mapped = mapArticle(child, retrievedAtEpochMs, raw, warn);
      if (mapped !== null) records.push(mapped);
    }

    return records;
  };
}
