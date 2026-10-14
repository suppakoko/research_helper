/**
 * Crossref `/works` JSON → `SourceRecord`.
 *
 * **Scope.** `P2-T04` steps 5 and 6. This is the function `crossrefSource.ts`
 * injects as {@link CrossrefSourceDeps.mapRecords}: one page's
 * `message.items` array in, that page's records out, synchronously. The
 * call-site shape is {@link CrossrefRecordMapper}, the same split `P1-T09` /
 * `P1-T10` made for PubMed and `P2-T03` for Europe PMC.
 *
 * ## Where every field comes from
 *
 * `docs/02` §10.2's **Crossref** column is the field-by-field source table and
 * is followed literally; `docs/07` §5.1 owns the *target* types and wins where
 * the two disagree. The shapes `docs/02` §5.3 warns about are handled where
 * they bite:
 *
 * - **`title` and `container-title` are arrays** — `title[0]`,
 *   `container-title[0]`, `short-container-title[0]`, `ISSN[]` (§5.3, the
 *   card's Do NOT). A title carries inline markup and stray newlines in the
 *   corpus, so it goes through {@link flattenTitle}.
 * - **`issued.date-parts` is an array of arrays** whose inner array has 1, 2
 *   or 3 elements (`[[2026]]`, `[[2026,9]]`, `[[2026,9,3]]`) — or `[[null]]`
 *   when the publisher deposited nothing. {@link readDateParts} maps the three
 *   lengths to `docs/07` §5.1's `PartialDate` at exactly that precision and
 *   treats anything else as absent. `published-online` and `published-print`
 *   are the fallbacks, in that order.
 * - **`abstract` is raw JATS XML** (§5.4) and "must be parsed with
 *   `DOMParser` in XML mode; regex stripping will mangle nested markup". So
 *   {@link jatsToText} wraps the fragment in a root that declares the `jats:`
 *   prefix, parses it with the injected {@link XmlParser}, and walks the
 *   tree: `<jats:p>` becomes a paragraph break, a `<jats:title>` inside a
 *   `<jats:sec>` becomes a `Label: ` prefix (`docs/07` §5.1: "flattened with
 *   section labels preserved"), every other `<jats:title>` and the
 *   `<jats:boxed-text>` wrapper are decoration and contribute nothing but
 *   their text, inline markup is unwrapped, and the parser decodes the
 *   entities. The one pre-parse step is {@link xmlSafeEntities}: HTML's named
 *   entities (`&nbsp;`) are not XML's and would be a parse error, so they are
 *   rewritten to numeric references; nothing else about the text is touched.
 *   A fragment that still does not parse is a `missingFields` entry and a
 *   `warn` line, never a mangled abstract.
 * - **`author[].family` / `.given` / `.ORCID` / `.affiliation[].name`** →
 *   `Author`; an organisational author arrives as `name` and fills `family`
 *   and `literal`, as the other mappers do. The ORCID URL prefix is stripped
 *   (§5.1: "no URL prefix").
 * - **`type`** → §10.2's mapping table: `posted-content` → `preprint`,
 *   `proceedings-article` → `conference-paper`, `book-chapter` →
 *   `book-chapter`, `journal-article` → `journal-article`; the obvious
 *   Crossref names for the remaining §5.1 members (`dataset`, `report`,
 *   `dissertation` → `thesis`); otherwise `journal-article` when a venue with
 *   an ISSN exists and `other` when not.
 * - **`institution[].name` → `venue.repository`** in §10.2; §5.1 has no
 *   `repository`, and `docs/07` §6.2 maps a preprint's `containerTitle` to
 *   Zotero's `repository`, so a `posted-content` record's `containerTitle` is
 *   its institution (bioRxiv, medRxiv, Research Square…), falling back to
 *   `group-title` and then `publisher`.
 * - **`relation["is-preprint-of"]` / `["has-preprint"]`** are not in §10.2's
 *   table but are exactly §5.1's `relatedVersionIds` ("Set when this preprint
 *   has a published version, or vice versa"); a DOI-typed relation is mapped
 *   to `{ doi }`.
 * - **`link[].URL` with `content-type: application/pdf`** → `openAccess.pdfUrl`
 *   and `license[].URL` → `openAccess.license` (§10.2). Crossref has no
 *   open-access flag; `isOpenAccess` is `true` only when the license URL is a
 *   Creative Commons one, the one reading of a license URL that is not a
 *   guess. `openAccess` is absent when the record says nothing about either.
 * - **`subject[]`** → `subjects` with `scheme: "crossref"`; **`is-referenced-by-count`**
 *   → `citationCount`; **`references-count`** → `referenceCount` (§10.2
 *   writes `reference-count`; the `select` route knows only the plural, and
 *   the item carries both spellings — measured 2026-10-14); `volume`,
 *   `issue`, `page`, `URL`, `publisher` as named. **`language` and
 *   `institution` are not selectable on `/works`** (the same measurement), so
 *   §10.2's `language` and `venue.repository` ← `institution[].name` cells
 *   cannot be served under a mandatory `select`; `language` is therefore not
 *   a mappable field here, and a preprint's container falls back to
 *   `publisher` (`Cold Spring Harbor Laboratory` for bioRxiv).
 * - **Identity.** `nativeId` is the normalised DOI (`docs/02` §11.1), `id` is
 *   `crossref:<doi>`. An item with no usable DOI is dropped with a warning —
 *   Crossref is the DOI registry, so that is a malformed item, not a sparse
 *   one.
 *
 * ## Absent vs. not understood — the same two-way split as the other mappers
 *
 * Absent → the field is absent and its name is in `missingFields`. Present but
 * not understood → absent, in `missingFields`, **and** a `warn` line through
 * the injected {@link Logger}. The domain of `missingFields` is
 * {@link CROSSREF_MAPPABLE_FIELDS}; a field Crossref never supplies (`pmid`,
 * `pmcid`, `keywords`, `influentialCitationCount`) is not a gap and is not
 * reported. `docs/02` §5.4's coverage caveat is why an absent `abstract` is
 * routine here: deposition is voluntary and about half of recent biomedical
 * articles carry none.
 *
 * ## `DOMParser` is injected, not imported
 *
 * As `src/sources/pubmed/mapper.ts` explains: the sandbox has `DOMParser`
 * (`docs/01` §2.3), plain Node does not (`docs/13` §2.1), so the parse arrives
 * as the {@link CrossrefMapperDeps.parseXml} port with {@link domParserXml} as
 * the default. The port is the smallest slice of DOM the JATS walk needs:
 * `nodeType`, `nodeValue`, `localName` and `childNodes` — mixed content has
 * to be walked in order, which is why this port, unlike PubMed's, sees text
 * nodes.
 *
 * ## `raw`, and NFR-7
 *
 * Omitted by default. With {@link CrossrefMapperDeps.keepRaw} the record keeps
 * its own parsed item object — one per record, because the page body is
 * already parsed and re-serialising it would be the waste NFR-7 forbids.
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
  WorkType,
} from "../../model/canonicalWork";
import { normalizeDoi, type ExternalIds, type SourceId } from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";

// ---------------------------------------------------------------------------
// 1. The XML port
// ---------------------------------------------------------------------------

/** DOM `Node.ELEMENT_NODE`, `TEXT_NODE`, `CDATA_SECTION_NODE`. */
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

/** The smallest slice of a DOM node the JATS walk needs. */
export interface XmlNodeLike {
  readonly nodeType: number;
  /** Text for a text or CDATA node; `null` for an element. */
  readonly nodeValue: string | null;
  /** The element's local name (no prefix); absent or `null` for a text node. */
  readonly localName?: string | null;
  readonly childNodes: XmlNodeListLike;
}

/** `NodeList`'s two members, structurally. */
export interface XmlNodeListLike {
  readonly length: number;
  item(index: number): XmlNodeLike | null;
}

/** `Document`'s one member the walk needs. */
export interface XmlDocumentLike {
  readonly documentElement: XmlNodeLike | null;
}

/**
 * Parse an XML document. Never throws for malformed input: Gecko's `DOMParser`
 * reports a parse failure by returning a document whose root element is
 * `<parsererror>`, and {@link jatsToText} reads that as "not parseable".
 */
export type XmlParser = (xml: string) => XmlDocumentLike;

/**
 * The production parser: the sandbox's own `DOMParser` in `text/xml` mode
 * (`docs/02` §5.4: "Parse with `DOMParser` in XML mode").
 *
 * @param xml - a JATS fragment, already wrapped by {@link jatsToText}
 * @returns the parsed document
 */
export function domParserXml(xml: string): XmlDocumentLike {
  return new DOMParser().parseFromString(xml, "text/xml");
}

/** Gecko's root element for a document that failed to parse. */
const PARSER_ERROR_TAG = "parsererror";

// ---------------------------------------------------------------------------
// 2. Constants
// ---------------------------------------------------------------------------

/** `docs/07` §11.1 step 3: the `SourceId` *is* the adapter's identity. */
export const CROSSREF_SOURCE_ID: SourceId = "crossref";

/**
 * The canonical fields `docs/02` §10.2's Crossref column says `/works` can
 * supply, in `docs/07` §5.1's spelling — the domain of
 * {@link SourceRecord.missingFields}.
 */
export const CROSSREF_MAPPABLE_FIELDS: readonly string[] = [
  "title",
  "abstract",
  "authors",
  "type",
  "containerTitle",
  "containerAbbreviation",
  "publisher",
  "volume",
  "issue",
  "pages",
  "issn",
  "publishedDate",
  "subjects",
  "citationCount",
  "referenceCount",
  "openAccess",
  "url",
  "ids.doi",
];

/**
 * `docs/02` §10.2's `type` mapping table, Crossref triggers, plus the Crossref
 * type names that are unambiguously §5.1's remaining members. Anything else
 * falls to the venue rule in {@link mapItem}.
 */
const TYPE_MAP: Readonly<Record<string, WorkType>> = {
  "journal-article": "journal-article",
  "posted-content": "preprint",
  "proceedings-article": "conference-paper",
  "book-chapter": "book-chapter",
  dataset: "dataset",
  report: "report",
  "report-component": "report",
  dissertation: "thesis",
};

// ---------------------------------------------------------------------------
// 3. JSON walking helpers — no `any`, every read guarded
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** `{...}` and not `null`, `[]` or a primitive. */
function asRecord(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A non-empty string, whitespace-trimmed; `undefined` otherwise. */
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A finite non-negative integer; `undefined` otherwise. */
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** `array[0]` as a non-empty string — the §5.3 array unwrapping. */
function firstString(value: unknown): string | undefined {
  const [first] = asArray(value);
  return str(first);
}

// ---------------------------------------------------------------------------
// 4. Inline markup in titles, and JATS in abstracts
// ---------------------------------------------------------------------------

/**
 * HTML's named entities that are **not** XML's five. Crossref deposits are
 * JATS, but publishers' abstracts and titles carry `&nbsp;` and friends;
 * inside XML each is an undeclared entity and a parse error, so they are
 * rewritten to numeric references before parsing. The five XML entities are
 * left for the parser.
 */
const HTML_ONLY_ENTITIES: Readonly<Record<string, number>> = {
  nbsp: 0xa0,
  ensp: 0x2002,
  emsp: 0x2003,
  thinsp: 0x2009,
  ndash: 0x2013,
  mdash: 0x2014,
  lsquo: 0x2018,
  rsquo: 0x2019,
  ldquo: 0x201c,
  rdquo: 0x201d,
  hellip: 0x2026,
  deg: 0xb0,
  plusmn: 0xb1,
  micro: 0xb5,
  middot: 0xb7,
  times: 0xd7,
  alpha: 0x3b1,
  beta: 0x3b2,
  gamma: 0x3b3,
  delta: 0x3b4,
  mu: 0x3bc,
  copy: 0xa9,
  reg: 0xae,
  trade: 0x2122,
};

const XML_ENTITIES: ReadonlySet<string> = new Set([
  "amp",
  "lt",
  "gt",
  "quot",
  "apos",
]);

/** Any `&…;` reference, named or numeric. */
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gu;

/** An `&` that does not start a well-formed reference. */
const BARE_AMPERSAND = /&(?!(?:#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);)/gu;

/**
 * Make a JATS fragment XML-safe without touching its markup: HTML-only named
 * entities become numeric references and a bare `&` becomes `&amp;`. An
 * unknown named entity is left as it is, so the parser reports it.
 */
export function xmlSafeEntities(text: string): string {
  return text
    .replace(BARE_AMPERSAND, "&amp;")
    .replace(ENTITY, (whole, body: string) => {
      if (body.startsWith("#") || XML_ENTITIES.has(body)) return whole;
      const cp = HTML_ONLY_ENTITIES[body];
      return cp === undefined ? whole : `&#x${cp.toString(16)};`;
    });
}

/** Decode every entity in plain (non-XML) text, for titles. */
function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return safeCodePoint(Number.parseInt(body.slice(2), 16), whole);
    }
    if (body.startsWith("#")) {
      return safeCodePoint(Number.parseInt(body.slice(1), 10), whole);
    }
    if (XML_ENTITIES.has(body)) {
      return (
        { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[body] ?? whole
      );
    }
    const cp = HTML_ONLY_ENTITIES[body];
    return cp === undefined ? whole : String.fromCodePoint(cp);
  });
}

function safeCodePoint(cp: number, fallback: string): string {
  return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
    ? String.fromCodePoint(cp)
    : fallback;
}

/** The whitespace layout introduces, and only that (`P1-T10`'s lesson). */
const PRINT_WHITESPACE = /[\t\n\f\r ]+/gu;

function squash(value: string): string {
  return value.replace(PRINT_WHITESPACE, " ").replace(/^ | $/gu, "");
}

/** Any tag, opening, closing or self-closing — for the flat title markup only. */
const ANY_TAG = /<\/?[A-Za-z][^<>]*>/gu;

/**
 * Flatten a Crossref title: decode entities, strip the flat inline markup
 * (`<i>`, `<sub>`, `<scp>`…) titles carry, squash whitespace. Titles are not
 * JATS documents — they are strings with inline tags — so the flat rule is the
 * right one here and the XML parse is reserved for abstracts (`docs/02` §5.4).
 *
 * @param text - `title[0]` as Crossref sent it
 * @returns plain text; `""` for empty input
 */
export function flattenTitle(text: string): string {
  return squash(decodeEntities(text).replace(ANY_TAG, ""));
}

/** Elements that start and end a paragraph in the JATS walk. */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  "p",
  "sec",
  "abstract",
  "boxed-text",
  "list",
  "list-item",
  "disp-quote",
  "def-list",
  "def-item",
  "table-wrap",
  "fig",
]);

/**
 * The namespaces the wrapper root always declares: JATS itself and the three
 * vocabularies JATS documents embed. A fragment's `jats:` prefix is undeclared
 * on the wire (`docs/02` §5.4's example), and an XML parser refuses an
 * undeclared prefix, so the declaration has to come from here.
 */
const WRAPPER_NAMESPACES: Readonly<Record<string, string>> = {
  jats: "http://www.ncbi.nlm.nih.gov/JATS1",
  mml: "http://www.w3.org/1998/Math/MathML",
  xlink: "http://www.w3.org/1999/xlink",
  ali: "http://www.niso.org/schemas/ali/1.0/",
};

/** One markup tag, whatever kind. */
const TAG = /<[^>]+>/gu;

/** A prefixed element or attribute name inside a tag: `<jats:p`, ` xlink:href`. */
const PREFIXED_NAME = /(?:^<\/?|\s)([A-Za-z_][\w.-]*):[A-Za-z_]/gu;

/**
 * The prefixes a fragment's tags use that {@link WRAPPER_NAMESPACES} does not
 * declare. **Measured 2026-10-15:** publishers do not all deposit under
 * `jats:` — F1000's abstracts arrive as `<ns3:p>`, OSF's as bare `<p>` — and a
 * prefix the wrapper does not declare is a parse error that would cost the
 * whole abstract. Only tag text is read here; nothing is stripped or altered.
 */
function undeclaredPrefixes(fragment: string): readonly string[] {
  const found = new Set<string>();
  for (const tag of fragment.match(TAG) ?? []) {
    if (tag.startsWith("<!") || tag.startsWith("<?")) continue;
    for (const match of tag.matchAll(PREFIXED_NAME)) {
      const prefix = match[1];
      if (
        prefix !== undefined &&
        prefix !== "xml" &&
        prefix !== "xmlns" &&
        WRAPPER_NAMESPACES[prefix] === undefined
      ) {
        found.add(prefix);
      }
    }
  }
  return [...found];
}

/** The wrapper root {@link jatsToText} parses `fragment` under. */
function wrapperOpen(fragment: string): string {
  const declared = Object.entries(WRAPPER_NAMESPACES).map(
    ([prefix, uri]) => `xmlns:${prefix}="${uri}"`,
  );
  const extra = undeclaredPrefixes(fragment).map(
    (prefix) =>
      `xmlns:${prefix}="urn:research-helper:undeclared-prefix:${prefix}"`,
  );
  return `<rh-abstract ${[...declared, ...extra].join(" ")}>`;
}
const JATS_WRAPPER_CLOSE = "</rh-abstract>";

/** Section titles that are decoration, not labels, wherever they sit. */
const DECORATION_TITLES: ReadonlySet<string> = new Set(["abstract", "summary"]);

/**
 * JATS → plain text, `docs/02` §5.4's handling as a DOM walk.
 *
 * @param xml - the `abstract` field as Crossref sent it: a JATS fragment,
 *   usually `<jats:p>…</jats:p>` with the prefix undeclared
 * @param parse - the XML parser port
 * @returns paragraphs joined by `\n\n`, section labels as `Label: ` prefixes;
 *   `undefined` when the fragment does not parse — the caller warns and the
 *   abstract is a `missingFields` entry
 */
export function jatsToText(xml: string, parse: XmlParser): string | undefined {
  const document = parse(
    `${wrapperOpen(xml)}${xmlSafeEntities(xml)}${JATS_WRAPPER_CLOSE}`,
  );
  const root = document.documentElement;
  if (root === null || root.localName === PARSER_ERROR_TAG) return undefined;

  const paragraphs: string[] = [];
  let current: string[] = [];
  let pendingLabel: string | undefined;

  const flush = (): void => {
    const joined = current.join("");
    current = [];
    // **Measured 2026-10-15 (SSRN, `10.2139/ssrn.3498384`):** a deposit can
    // carry a second, entity-escaped layer of flat HTML *inside* the JATS text
    // (`&lt;b&gt;French Abstract:&lt;/b&gt; … &lt;br&gt;&lt;br&gt;`), which
    // the XML parser rightly decodes to literal `<b>` and `<br>` text. That
    // layer is flat, never nested JATS, so it gets the title rule: `<br>` runs
    // break paragraphs and the remaining flat tags vanish.
    for (const piece of joined.split(/(?:<br\s*\/?>\s*)+/iu)) {
      const text = squash(piece.replace(ANY_TAG, ""));
      if (text === "") continue;
      paragraphs.push(
        pendingLabel === undefined ? text : `${pendingLabel}: ${text}`,
      );
      pendingLabel = undefined;
    }
  };

  const visit = (node: XmlNodeLike, parentName: string | undefined): void => {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
      current.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const name = node.localName ?? "";

    if (name === "title") {
      // A section's title is `docs/07` §5.1's preserved label; a title
      // anywhere else (the fragment's own heading, a boxed-text caption) is
      // decoration (`docs/02` §5.4) and is dropped.
      if (parentName === "sec") {
        flush();
        const label = squash(textOf(node));
        if (label !== "" && !DECORATION_TITLES.has(label.toLowerCase())) {
          pendingLabel = label;
        }
      }
      return;
    }
    if (name === "label") return; // list-item numbering, never prose

    const block = BLOCK_ELEMENTS.has(name);
    if (block) flush();
    const children = node.childNodes;
    for (let i = 0; i < children.length; i += 1) {
      const child = children.item(i);
      if (child !== null) visit(child, name);
    }
    if (block) flush();
  };

  const children = root.childNodes;
  for (let i = 0; i < children.length; i += 1) {
    const child = children.item(i);
    if (child !== null) visit(child, undefined);
  }
  flush();
  return paragraphs.join("\n\n");
}

/** The concatenated text of a node, in document order. */
function textOf(node: XmlNodeLike): string {
  if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
    return node.nodeValue ?? "";
  }
  const parts: string[] = [];
  const children = node.childNodes;
  for (let i = 0; i < children.length; i += 1) {
    const child = children.item(i);
    if (child !== null) parts.push(textOf(child));
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------
// 5. Dates
// ---------------------------------------------------------------------------

/**
 * `issued.date-parts[0]` → `docs/07` §5.1's `PartialDate`, at the precision
 * the inner array's length gives (`docs/02` §5.3: 1, 2 or 3 elements) and no
 * finer. `[[null]]`, a non-integer, a month or day out of range, or an empty
 * array is `undefined`.
 *
 * @param dateField - a Crossref date object such as `issued`
 * @returns the partial date, or `undefined`
 */
export function readDateParts(dateField: unknown): PartialDate | undefined {
  const inner = asArray(asRecord(dateField)?.["date-parts"])[0];
  const parts = asArray(inner);
  const year = parts[0];
  if (typeof year !== "number" || !Number.isInteger(year) || year <= 0) {
    return undefined;
  }
  const month = parts[1];
  const day = parts[2];
  const monthOk =
    typeof month === "number" &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12;
  const dayOk =
    monthOk &&
    typeof day === "number" &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= 31;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const iso = dayOk
    ? `${String(year)}-${pad(month)}-${pad(day)}`
    : monthOk
      ? `${String(year)}-${pad(month)}`
      : String(year);
  return {
    year,
    ...(monthOk && { month }),
    ...(dayOk && { day }),
    iso,
  };
}

/**
 * `publishedDate`, in `docs/02` §10.2's order: `issued`, then the two
 * `published-*` fallbacks. A candidate that is present but unreadable is
 * logged and the next is tried.
 */
function readPublishedDate(
  item: Json,
  warn: (msg: string, ctx: Record<string, unknown>) => void,
): PartialDate | undefined {
  for (const path of ["issued", "published-online", "published-print"]) {
    const value = item[path];
    if (value === undefined) continue;
    const date = readDateParts(value);
    if (date !== undefined) return date;
    const parts = asArray(asRecord(value)?.["date-parts"])[0];
    // `[[null]]` is Crossref's own spelling of "no date" and is not a defect.
    if (Array.isArray(parts) && parts.every((p) => p === null)) continue;
    warn("crossref mapper: date not understood", {
      field: "publishedDate",
      path,
      value: JSON.stringify(value).slice(0, 40),
    });
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 6. Authors
// ---------------------------------------------------------------------------

/** `docs/07` §5.1: bare ORCID, no URL prefix; anything else is dropped. */
function normalizeOrcid(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const digits = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//iu, "")
    .replace(/[\s-]/gu, "");
  if (!/^\d{15}[\dX]$/iu.test(digits)) return undefined;
  return [
    digits.slice(0, 4),
    digits.slice(4, 8),
    digits.slice(8, 12),
    digits.slice(12, 16).toUpperCase(),
  ].join("-");
}

/**
 * One `author[]` entry (`docs/02` §10.2: `family`, `given`, `ORCID`,
 * `affiliation[].name`). An organisational author arrives as `name`. An entry
 * with neither is dropped (the caller warns).
 */
function mapAuthor(entry: unknown, sequence: number): Author | null {
  const author = asRecord(entry);
  if (author === undefined) return null;
  const family = str(author.family);
  const given = str(author.given);
  const organisation = str(author.name);
  const name = family ?? organisation;
  if (name === undefined) return null;

  const orcid = normalizeOrcid(str(author.ORCID));
  const affiliations = asArray(author.affiliation)
    .map((a) => str(asRecord(a)?.name))
    .filter((a): a is string => a !== undefined)
    .map((a) => squash(a));

  return {
    family: squash(name),
    ...(family !== undefined &&
      given !== undefined && { given: squash(given) }),
    ...(family === undefined &&
      organisation !== undefined && { literal: organisation }),
    ...(orcid !== undefined && { orcid }),
    ...(affiliations.length > 0 && { affiliations }),
    sequence,
  };
}

// ---------------------------------------------------------------------------
// 7. Subjects, open access, related versions
// ---------------------------------------------------------------------------

/** `subject[]` → one `Subject` each, `scheme: "crossref"`. */
function readSubjects(item: Json): Subject[] {
  return asArray(item.subject)
    .map((s) => str(s))
    .filter((s): s is string => s !== undefined)
    .map((term) => ({ term, scheme: "crossref" }));
}

/**
 * `docs/02` §10.2: `openAccess.pdfUrl` from `link[].URL` where `content-type`
 * is `application/pdf`, `openAccess.license` from `license[].URL`. Emitted
 * only when the record says anything about either.
 */
function readOpenAccess(item: Json): OpenAccessInfo | undefined {
  let pdfUrl: string | undefined;
  for (const entry of asArray(item.link)) {
    const link = asRecord(entry);
    if (link === undefined) continue;
    if (str(link["content-type"])?.toLowerCase() !== "application/pdf")
      continue;
    pdfUrl ??= str(link.URL);
  }
  const license = str(asRecord(asArray(item.license)[0])?.URL);
  if (pdfUrl === undefined && license === undefined) return undefined;
  return {
    isOpenAccess:
      license !== undefined && /creativecommons\.org\//iu.test(license),
    ...(pdfUrl !== undefined && { pdfUrl }),
    ...(license !== undefined && { license }),
  };
}

/**
 * `relation["is-preprint-of"]` (on a preprint) or `relation["has-preprint"]`
 * (on the published version): the first DOI-typed entry → `{ doi }`.
 */
function readRelatedVersionIds(item: Json): ExternalIds | undefined {
  const relation = asRecord(item.relation);
  for (const name of ["is-preprint-of", "has-preprint"]) {
    for (const entry of asArray(relation?.[name])) {
      const link = asRecord(entry);
      if (link === undefined) continue;
      if (str(link["id-type"])?.toLowerCase() !== "doi") continue;
      const doi = normalizeDoi(str(link.id));
      if (doi !== null) return { doi };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 8. One item
// ---------------------------------------------------------------------------

/** What {@link createCrossrefRecordMapper} needs from the composition root. */
export interface CrossrefMapperDeps {
  /** `src/core/clock.ts`. Supplies `SourceRecord.retrievedAtEpochMs`. */
  readonly clock: Clock;
  /**
   * The XML parse for JATS abstracts. Defaults to {@link domParserXml}, the
   * sandbox's own `DOMParser`; a Node unit test injects its own.
   */
  readonly parseXml?: XmlParser;
  /**
   * `docs/07` §5.1 / §8.5's `logRequestBodies`, resolved by the composition
   * root. `true` keeps each record's own parsed item; `false` — the default,
   * and what NFR-7 requires — keeps nothing.
   */
  readonly keepRaw?: boolean;
  /** Diagnostics. Never given an abstract or a whole item. */
  readonly logger?: Logger;
}

/**
 * The mapper as `crossrefSource.ts` consumes it: one page's `message.items`
 * array in, that page's records out, in order.
 */
export type CrossrefRecordMapper = (
  items: readonly unknown[],
) => readonly SourceRecord[];

function mapItem(
  entry: unknown,
  retrievedAtEpochMs: number,
  keepRaw: boolean,
  parseXml: XmlParser,
  warn: (msg: string, ctx: Record<string, unknown>) => void,
): SourceRecord | null {
  const item = asRecord(entry);
  const rawDoi = str(item?.DOI);
  const doi = normalizeDoi(rawDoi);
  if (item === undefined || doi === null) {
    warn("crossref mapper: item has no usable DOI, dropped", {
      field: "ids.doi",
      path: "message.items[].DOI",
      ...(rawDoi !== undefined && { value: rawDoi.slice(0, 64) }),
    });
    return null;
  }

  // --- title and abstract --------------------------------------------------
  const rawTitle = firstString(item.title);
  const title = rawTitle === undefined ? "" : flattenTitle(rawTitle);
  if (rawTitle !== undefined && title.length === 0) {
    warn("crossref mapper: title present but empty after flattening", {
      field: "title",
      path: "title[0]",
    });
  }
  const rawAbstract = str(item.abstract);
  let abstract: string | undefined;
  if (rawAbstract !== undefined) {
    abstract = jatsToText(rawAbstract, parseXml);
    if (abstract === undefined || abstract.length === 0) {
      abstract = undefined;
      warn("crossref mapper: abstract did not parse as JATS XML", {
        field: "abstract",
        path: "abstract",
        length: rawAbstract.length,
      });
    }
  }

  // --- authors ------------------------------------------------------------
  const authors: Author[] = [];
  let dropped = 0;
  for (const author of asArray(item.author)) {
    const mapped = mapAuthor(author, authors.length);
    if (mapped === null) dropped += 1;
    else authors.push(mapped);
  }
  if (dropped > 0) {
    warn("crossref mapper: authors dropped for having no name", {
      field: "authors",
      path: "author",
      dropped,
    });
  }

  // --- venue --------------------------------------------------------------
  const journalTitle = firstString(item["container-title"]);
  const containerAbbreviation = firstString(item["short-container-title"]);
  const issn = asArray(item.ISSN)
    .map((v) => str(v))
    .filter(
      (v, i, all): v is string => v !== undefined && all.indexOf(v) === i,
    );
  const publisher = str(item.publisher);
  // `institution` is read when present but is not in the `select` whitelist
  // (not selectable on `/works`, measured 2026-10-14), so the fallback below
  // is what a preprint normally gets.
  const institution = str(asRecord(asArray(item.institution)[0])?.name);
  const volume = str(item.volume);
  const issue = str(item.issue);
  const pages = str(item.page);

  // --- type: docs/02 §10.2's mapping table, Crossref triggers -------------
  const crossrefType = str(item.type)?.toLowerCase();
  const hasVenueWithIssn = journalTitle !== undefined && issn.length > 0;
  const mappedType =
    crossrefType === undefined ? undefined : TYPE_MAP[crossrefType];
  const type: WorkType =
    mappedType ?? (hasVenueWithIssn ? "journal-article" : "other");
  const typeClassified = mappedType !== undefined || hasVenueWithIssn;
  const isPreprint = type === "preprint";
  // A preprint's container is its server (`docs/07` §6.2 → Zotero `repository`).
  const containerTitle = isPreprint
    ? (institution ?? publisher ?? journalTitle)
    : journalTitle === undefined
      ? undefined
      : flattenTitle(journalTitle);

  // --- the rest -----------------------------------------------------------
  const publishedDate = readPublishedDate(item, warn);
  const language = str(item.language);
  const subjects = readSubjects(item);
  const citationCount = count(item["is-referenced-by-count"]);
  const referenceCount =
    count(item["references-count"]) ?? count(item["reference-count"]);
  const openAccess = readOpenAccess(item);
  const url = str(item.URL);
  const relatedVersionIds = readRelatedVersionIds(item);

  const work: SourceRecord["work"] = {
    ids: { doi },
    type,
    title,
    ...(abstract !== undefined && { abstract }),
    authors,
    ...(containerTitle !== undefined && { containerTitle }),
    ...(containerAbbreviation !== undefined && { containerAbbreviation }),
    ...(publisher !== undefined && { publisher }),
    ...(volume !== undefined && { volume }),
    ...(issue !== undefined && { issue }),
    ...(pages !== undefined && { pages }),
    ...(issn.length > 0 && { issn }),
    ...(publishedDate !== undefined && { publishedDate }),
    ...(language !== undefined && { language }),
    ...(subjects.length > 0 && { subjects }),
    ...(citationCount !== undefined && { citationCount }),
    ...(referenceCount !== undefined && { referenceCount }),
    ...(openAccess !== undefined && { openAccess }),
    ...(url !== undefined && { url }),
    ...(relatedVersionIds !== undefined && { relatedVersionIds }),
  };

  return {
    id: `${CROSSREF_SOURCE_ID}:${doi}`,
    sourceId: CROSSREF_SOURCE_ID,
    nativeId: doi,
    work,
    retrievedAtEpochMs,
    ...(keepRaw && { raw: item }),
    missingFields: collectMissingFields(work, typeClassified),
  };
}

/**
 * Every {@link CROSSREF_MAPPABLE_FIELDS} member the item did not supply.
 * `type` counts as supplied when it was classified, not when it fell back to
 * `"other"`.
 */
function collectMissingFields(
  work: SourceRecord["work"],
  typeClassified: boolean,
): readonly string[] {
  const present = new Set<string>();
  if (work.title.length > 0) present.add("title");
  if (work.abstract !== undefined) present.add("abstract");
  if (work.authors.length > 0) present.add("authors");
  if (typeClassified) present.add("type");
  if (work.containerTitle !== undefined) present.add("containerTitle");
  if (work.containerAbbreviation !== undefined) {
    present.add("containerAbbreviation");
  }
  if (work.publisher !== undefined) present.add("publisher");
  if (work.volume !== undefined) present.add("volume");
  if (work.issue !== undefined) present.add("issue");
  if (work.pages !== undefined) present.add("pages");
  if (work.issn !== undefined) present.add("issn");
  if (work.publishedDate !== undefined) present.add("publishedDate");
  if (work.subjects !== undefined) present.add("subjects");
  if (work.citationCount !== undefined) present.add("citationCount");
  if (work.referenceCount !== undefined) present.add("referenceCount");
  if (work.openAccess !== undefined) present.add("openAccess");
  if (work.url !== undefined) present.add("url");
  if (work.ids.doi !== undefined) present.add("ids.doi");
  return CROSSREF_MAPPABLE_FIELDS.filter((f) => !present.has(f));
}

// ---------------------------------------------------------------------------
// 9. The mapper
// ---------------------------------------------------------------------------

/**
 * Build the `message.items[]` → `SourceRecord[]` mapper the adapter injects.
 * Synchronous; an item with no usable DOI is dropped with a warning rather
 * than emitted broken; nothing here throws for a malformed entry, because the
 * page-level shape is `crossrefSource.ts`'s to validate.
 *
 * @param deps - the clock, and optionally the XML parser, `keepRaw` and a logger
 * @returns the mapper
 */
export function createCrossrefRecordMapper(
  deps: CrossrefMapperDeps,
): CrossrefRecordMapper {
  const keepRaw = deps.keepRaw ?? false;
  const parseXml = deps.parseXml ?? domParserXml;
  const { clock, logger } = deps;
  const warn = (msg: string, ctx: Record<string, unknown>): void => {
    logger?.warn(msg, { ...ctx, sourceId: CROSSREF_SOURCE_ID });
  };
  return (items) => {
    const retrievedAtEpochMs = clock.now();
    const out: SourceRecord[] = [];
    for (const entry of items) {
      const record = mapItem(
        entry,
        retrievedAtEpochMs,
        keepRaw,
        parseXml,
        warn,
      );
      if (record !== null) out.push(record);
    }
    return out;
  };
}
