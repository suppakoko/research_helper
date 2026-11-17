/**
 * The report's bibliography and citation nodes, made by Zotero itself
 * (`P4-T11`; `docs/06` §10.2 option (b), D-06-7, §10.3; the measured entry
 * point is recorded in `docs/01` §5.11).
 *
 * **Callers.** Nothing calls this module yet. `noteHtml.ts` (`P4-T13`) puts
 * {@link CitationNode}s on the Notable Papers and Bibliography entries and
 * opens the note with {@link noteWrapperOpenTag}; `exportMarkdown.ts`
 * (`P4-T15`) prints the numbered entries. Both receive
 * {@link zoteroBibliographyPort} as a {@link BibliographyPort}, passed in by
 * the run (`trendReportPipeline.ts`, `P4-T18`), which also builds the
 * report's `bibliography` and `retracted` lists with it. The port is a
 * constant: nothing constructs it.
 *
 * ## What was measured (Zotero 10.0.3, 2026-10-27)
 *
 * - **The entry point is `Zotero.Styles.get(styleID).getCiteProc(locale,
 *   format)`**, a citeproc-js `CSL.Engine`, driven with `updateItems(ids)`
 *   and `makeBibliography()` — exactly what `Zotero.QuickCopy` and
 *   `Zotero.Cite.makeFormattedBibliographyOrCitationList` do inside. The
 *   engine is used directly rather than through either wrapper because only
 *   `makeBibliography()` says which entry belongs to which item
 *   (`bib[0].entry_ids`), and the report needs its own order (`[n]`, first
 *   appearance) whatever order the style sorts in.
 * - **`Zotero.Styles` may not be loaded yet**: `initialized()` was `false`
 *   when the spec started in two runs (the first `init()` took 3.2 s and
 *   1.7 s) and `true` in eleven, and `get()` throws before it is loaded.
 *   {@link ensureStyles} awaits `init()`; a second `init()` returns the first
 *   one's promise.
 * - **The CSL locale changes the text** and defaults to Zotero's UI locale
 *   when none is passed (`ko-KR` on the measuring machine), so every call here
 *   takes the locale explicitly.
 * - **A numeric style numbers its entries in registration order** (IEEE
 *   `[1]`, Nature `1.`), so registering the items in `[n]` order makes the
 *   style's numbers equal the report's. The number is still removed from
 *   `text` ({@link stripStyleNumbers}): `BibliographyEntry.index` carries it,
 *   and a renderer printing `[n]` would otherwise print it twice.
 *
 * - **A citation node's stored text is the plugin's** (owner, 2026-10-27,
 *   `plan/00` §6 items 294(b) and 296(a)): {@link citationPreviewText} in the
 *   note editor's own shape, with "and" and "et al." from the CSL engine of
 *   the request's style and locale. Zotero's note editor draws a node's text
 *   itself, in Zotero's interface language, and stores that text on its first
 *   save (`docs/01` §5.11, measured by `P4-T13`); the plugin's text holds in
 *   the stored HTML until then.
 *
 * The other Zotero calls are `Zotero.Utilities.Item.itemToCSLJSON` and
 * `Zotero.URI.getItemURI`, two of the three the note editor's own
 * `_digestItems` uses (`docs/06` §10.2); the third, `formatCitation`, is not
 * used, because its text follows the interface language.
 */

import type { BibliographyEntry, RetractedEntry } from "../model/trend";
import { normalizeDoi } from "../model/ids";
import {
  findExtraLine,
  parseExtra,
  RH_S2_CORPUS_ID_KEY,
  RH_SOURCES_KEY,
} from "./extraField";

// ---------------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------------

/** The citation style the user chose in Zotero, and where it was read. */
export interface UserCitationStyle {
  /** A style ID, e.g. `http://www.zotero.org/styles/apa`. */
  readonly styleId: string;
  /** The style's title as Zotero lists it. */
  readonly title: string;
  /**
   * `quickCopy`: Settings ▸ Export ▸ Quick Copy's item format
   * (`export.quickCopy.setting`). `lastStyle`: the style last used in
   * "Create Bibliography from Items" (`export.lastStyle`), read when Quick
   * Copy names an export format instead of a style.
   */
  readonly source: "quickCopy" | "lastStyle";
  /**
   * Quick Copy's own language (`export.quickCopy.locale`, or the setting's
   * `locale`), when the user set one. Informational: the bibliography takes
   * the locale the caller passes (`docs/01` §5.11).
   */
  readonly quickCopyLocale: string | undefined;
}

/** How one bibliography is formatted. */
export interface BibliographyRequest {
  readonly libraryID: number;
  /** A style ID Zotero has installed. */
  readonly styleId: string;
  /** A CSL locale, e.g. `en-US`. Required: Zotero's default is the UI's. */
  readonly locale: string;
}

/** {@link BibliographyPort.formatBibliography}'s result. */
export interface FormattedBibliography {
  readonly styleId: string;
  readonly locale: string;
  /** One per key, in the order the keys were given; `index` is position + 1. */
  readonly entries: readonly BibliographyEntry[];
  /** The style numbered its entries, and the numbers were removed from `text`. */
  readonly styleNumbered: boolean;
  /**
   * The style defines no bibliography, so each entry is the style's citation
   * of the item, as `Zotero.Cite.makeFormattedBibliographyOrCitationList`
   * falls back to.
   */
  readonly citationList: boolean;
}

/** One item of a note's `data-citation-items`, and of a node's citation. */
export interface CitationItemPayload {
  readonly uris: readonly string[];
  /** `Zotero.Utilities.Item.itemToCSLJSON(item)`, unchanged. */
  readonly itemData: Readonly<Record<string, unknown>>;
}

/** A real Zotero citation node (`docs/06` §10.2 option (b)). */
export interface CitationNode {
  readonly itemKey: string;
  /** `Zotero.URI.getItemURI(item)`. */
  readonly uri: string;
  /**
   * The item's `zotero://select` address (`docs/06` §10.2 option (a)), for
   * an inline anchor: `zotero://select/library/items/KEY` in the user's
   * library, `zotero://select/groups/ID/items/KEY` in a group's.
   */
  readonly selectUri: string;
  /**
   * The node's visible text as plain text, without the parentheses
   * ("Kim et al., 2024"): {@link citationPreviewText} in the request's CSL
   * locale. Also an inline anchor's `title`.
   */
  readonly text: string;
  /**
   * `<span class="citation" data-citation="…">(<span
   * class="citation-item">Kim et al., 2024</span>)</span>`: the note editor's
   * own markup, {@link text} HTML-escaped. Zotero's note editor draws its own
   * text in the interface language and stores that on its first save
   * (`docs/01` §5.11); this text is what the plugin stores.
   */
  readonly html: string;
  readonly citationItem: CitationItemPayload;
}

/**
 * What the report's renderers and the run take from Zotero for citations.
 * {@link zoteroBibliographyPort} is the real one; a unit test passes a fake.
 */
export interface BibliographyPort {
  userCitationStyle(): Promise<UserCitationStyle | undefined>;
  /**
   * §11's numbered entries, one per key, in the given order (`[n]` order).
   *
   * @throws Error when the style is not installed or a key names no item
   */
  formatBibliography(
    itemKeys: readonly string[],
    request: BibliographyRequest,
  ): Promise<FormattedBibliography>;
  /** The unnumbered "Retracted — not used in this report" list, in the given order. */
  formatRetracted(
    itemKeys: readonly string[],
    request: BibliographyRequest,
  ): Promise<readonly RetractedEntry[]>;
  /**
   * One citation node per key, in the given order, its text made with
   * `request`'s style and CSL locale (item 296(a)).
   *
   * @throws Error when the style is not installed or a key names no item
   */
  citationNodes(
    itemKeys: readonly string[],
    request: BibliographyRequest,
  ): Promise<readonly CitationNode[]>;
}

// ---------------------------------------------------------------------------
// 2. Pure helpers — no Zotero call
// ---------------------------------------------------------------------------

/** The note-schema version the note editor writes (`docs/06` §10.2). */
export const NOTE_SCHEMA_VERSION = 9;

/** The shapes a numeric style's label takes: `[1]`, `(1)`, `1.`, `1)`. */
const NUMBER_LABEL_SHAPES: readonly RegExp[] = [
  /^\[(\d+)\]\s+/u,
  /^\((\d+)\)\s+/u,
  /^(\d+)\.\s+/u,
  /^(\d+)\)\s+/u,
];

/**
 * Remove a numeric style's own labels from its entries.
 *
 * The labels are removed only when **every** entry starts with a label of the
 * **same** shape and the numbers are exactly 1…k, each once — so an
 * author-date entry that happens to start with a number is never touched.
 * The order of the numbers is not checked: a numeric style that sorts its
 * bibliography still numbers 1…k.
 *
 * @param texts - the entries as the style wrote them, trimmed
 * @returns the entries without labels, and whether labels were removed
 */
export function stripStyleNumbers(texts: readonly string[]): {
  readonly texts: readonly string[];
  readonly numbered: boolean;
} {
  if (texts.length === 0) return { texts, numbered: false };
  for (const shape of NUMBER_LABEL_SHAPES) {
    const numbers: number[] = [];
    const stripped: string[] = [];
    for (const text of texts) {
      const match = shape.exec(text);
      if (match === null) break;
      numbers.push(Number(match[1]));
      stripped.push(text.slice(match[0].length));
    }
    if (stripped.length !== texts.length) continue;
    const sorted = [...numbers].sort((a, b) => a - b);
    if (sorted.every((n, i) => n === i + 1)) {
      return { texts: stripped, numbered: true };
    }
  }
  return { texts, numbered: false };
}

/**
 * The entry text for each item id, from a citeproc-js bibliography.
 *
 * @param entryIds - `bib[0].entry_ids`: per entry, the ids it formats
 * @param entries - `bib[1]`: per entry, its text
 * @param ids - the ids wanted, in the wanted order
 * @returns one trimmed text per id, in `ids`' order
 * @throws Error when an id has no entry
 */
export function entriesInOrder(
  entryIds: readonly (readonly (string | number)[])[],
  entries: readonly string[],
  ids: readonly number[],
): readonly string[] {
  const byId = new Map<string, string>();
  entryIds.forEach((group, i) => {
    for (const id of group) byId.set(String(id), (entries[i] ?? "").trim());
  });
  return ids.map((id) => {
    const text = byId.get(String(id));
    if (text === undefined) {
      throw new Error(`the bibliography has no entry for item id ${id}`);
    }
    return text;
  });
}

/** `text` with `& < > "` escaped for HTML text and attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/** The CSL locale's words {@link citationPreviewText} joins names with. */
export interface CitationTerms {
  /** The `and` term: "and" in `en-US`. */
  readonly and: string;
  /** The `et-al` term: "et al." in `en-US`. */
  readonly etAl: string;
}

/** A CSL name's display form: the family name, else the literal. */
function nameOf(name: unknown): string {
  if (typeof name !== "object" || name === null) return "";
  const { family, literal } = name as { family?: unknown; literal?: unknown };
  if (typeof family === "string" && family !== "") return family;
  return typeof literal === "string" ? literal : "";
}

/**
 * A citation's text in the note editor's own shape (read from 10.0.3's
 * `editorInstance.js` `_formatCitationItemPreview` and the note editor's
 * bundle, `docs/01` §5.11): one author "Family", two "A and B", three or more
 * "A et al.", no author the title in curly quotes; then ", year" when the item
 * has one. The words come from `terms` — the CSL locale's, not Zotero's
 * interface language (owner, 2026-10-27, `plan/00` §6 item 296(a)).
 *
 * @param itemData - CSL-JSON, as `itemToCSLJSON` returns it
 * @returns plain text, not escaped, without parentheses
 */
export function citationPreviewText(
  itemData: Readonly<Record<string, unknown>>,
  terms: CitationTerms,
): string {
  const authors = Array.isArray(itemData["author"])
    ? (itemData["author"] as readonly unknown[])
    : [];
  let text = "";
  if (authors.length === 1) {
    text = nameOf(authors[0]);
  } else if (authors.length === 2) {
    text = `${nameOf(authors[0])} ${terms.and} ${nameOf(authors[1])}`;
  } else if (authors.length >= 3) {
    text = `${nameOf(authors[0])} ${terms.etAl}`;
  }
  const title = itemData["title"];
  if (text === "" && typeof title === "string" && title !== "") {
    text = `“${title}”`;
  }
  const issued = itemData["issued"] as
    { "date-parts"?: readonly (readonly unknown[])[] } | undefined;
  const year = issued?.["date-parts"]?.[0]?.[0];
  if (
    (typeof year === "string" || typeof year === "number") &&
    String(year) !== "" &&
    String(year) !== "0000"
  ) {
    text += `, ${String(year)}`;
  }
  return text;
}

/**
 * One citation's span, as the note editor writes it (`docs/06` §10.2 (b)).
 *
 * @param citationItem - the item's URI and CSL-JSON
 * @param formatted - the visible text, already HTML
 */
export function citationSpan(
  citationItem: CitationItemPayload,
  formatted: string,
): string {
  const citation = { citationItems: [citationItem], properties: {} };
  return (
    `<span class="citation" data-citation="` +
    `${encodeURIComponent(JSON.stringify(citation))}">${formatted}</span>`
  );
}

/**
 * The note's opening wrapper tag, carrying every cited item's payload so the
 * note editor resolves citations without a library lookup (`docs/06` §10.2,
 * "The note wrapper"). Close it with `</div>`.
 *
 * @param nodes - the note's citation nodes; a repeated URI is kept once
 */
export function noteWrapperOpenTag(nodes: readonly CitationNode[]): string {
  const seen = new Set<string>();
  const items: CitationItemPayload[] = [];
  for (const node of nodes) {
    if (seen.has(node.uri)) continue;
    seen.add(node.uri);
    items.push(node.citationItem);
  }
  return (
    `<div data-citation-items="${encodeURIComponent(JSON.stringify(items))}" ` +
    `data-schema-version="${NOTE_SCHEMA_VERSION}">`
  );
}

/** The URIs a parsed citation payload names, in order. */
function urisOf(citationItems: unknown): string[] {
  if (!Array.isArray(citationItems)) return [];
  const out: string[] = [];
  for (const entry of citationItems as unknown[]) {
    const uris =
      typeof entry === "object" && entry !== null
        ? (entry as { uris?: unknown }).uris
        : undefined;
    if (!Array.isArray(uris)) continue;
    for (const uri of uris as unknown[]) {
      if (typeof uri === "string") out.push(uri);
    }
  }
  return out;
}

/**
 * Read note HTML back: the URIs of every `span.citation`'s `data-citation`,
 * in document order, and of the wrapper's `data-citation-items`. A payload
 * that does not decode is skipped. Matches the attributes as this module and
 * the note editor write them (double-quoted, URI-encoded).
 */
export function parseCitationUris(html: string): {
  readonly citations: readonly (readonly string[])[];
  readonly wrapper: readonly string[];
} {
  const decode = (value: string): unknown => {
    try {
      return JSON.parse(decodeURIComponent(value)) as unknown;
    } catch {
      return undefined;
    }
  };
  const citations: string[][] = [];
  for (const match of html.matchAll(
    /<span class="citation" data-citation="([^"]*)"/gu,
  )) {
    const citation = decode(match[1] ?? "");
    citations.push(
      urisOf(
        typeof citation === "object" && citation !== null
          ? (citation as { citationItems?: unknown }).citationItems
          : undefined,
      ),
    );
  }
  const wrapperMatch = /<div data-citation-items="([^"]*)"/u.exec(html);
  return {
    citations,
    wrapper: wrapperMatch === null ? [] : urisOf(decode(wrapperMatch[1] ?? "")),
  };
}

// ---------------------------------------------------------------------------
// 3. The Zotero side
// ---------------------------------------------------------------------------

/** The citeproc-js engine, as far as this module drives it. */
interface CslEngine {
  setOutputFormat(format: "text" | "html"): void;
  updateItems(ids: readonly number[]): void;
  /** `false` when the style defines no bibliography. */
  makeBibliography():
    | false
    | [
        { readonly entry_ids: readonly (readonly (string | number)[])[] },
        readonly string[],
      ];
  previewCitationCluster(
    citation: {
      citationItems: readonly { id: number }[];
      properties: Record<string, never>;
    },
    citationsPre: readonly never[],
    citationsPost: readonly never[],
    format: "text" | "html",
  ): string;
  /**
   * A term of the engine's locale (citeproc-js `CSL.Engine.prototype.getTerm`,
   * read from 10.0.3's `xpcom/citeproc.js`); `undefined` when the locale has
   * none.
   */
  getTerm(term: string): string | undefined;
  free(): void;
}

/** `Zotero.Style`, as far as this module reads it. */
interface ZoteroStyle {
  readonly styleID: string;
  readonly title: string;
  getCiteProc(locale: string, format: "text" | "html"): CslEngine;
}

/** `Zotero.Styles`, which `zotero-types` declares `any`. */
interface ZoteroStyles {
  initialized(): boolean;
  init(): Promise<void>;
  get(id: string): ZoteroStyle | false;
}

/** `Zotero.QuickCopy.unserializeSetting`'s result. */
interface QuickCopySetting {
  readonly mode?: string;
  readonly id?: string;
  readonly locale?: string;
}

function styles(): ZoteroStyles {
  return Zotero.Styles as ZoteroStyles;
}

/** Load the style list once; Zotero loads it lazily. */
async function ensureStyles(): Promise<ZoteroStyles> {
  const all = styles();
  if (!all.initialized()) await all.init();
  return all;
}

function prefString(pref: string): string | undefined {
  const value: unknown = Zotero.Prefs.get(pref);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The citation style the user chose in Zotero: Quick Copy's item format when
 * it names a style, else the last style used to create a bibliography, else
 * `undefined` (neither is installed).
 */
async function userCitationStyle(): Promise<UserCitationStyle | undefined> {
  const all = await ensureStyles();
  const quickCopy = (
    Zotero.QuickCopy as {
      unserializeSetting(setting: unknown): QuickCopySetting;
    }
  ).unserializeSetting(Zotero.Prefs.get("export.quickCopy.setting"));
  const quickCopyLocale =
    (quickCopy.locale !== undefined && quickCopy.locale !== ""
      ? quickCopy.locale
      : undefined) ?? prefString("export.quickCopy.locale");
  const candidates: [UserCitationStyle["source"], string | undefined][] = [
    ["quickCopy", quickCopy.mode === "bibliography" ? quickCopy.id : undefined],
    ["lastStyle", prefString("export.lastStyle")],
  ];
  for (const [source, id] of candidates) {
    if (id === undefined) continue;
    const style = all.get(id);
    if (style === false) continue;
    return {
      styleId: style.styleID,
      title: style.title,
      source,
      quickCopyLocale,
    };
  }
  return undefined;
}

async function itemsFor(
  libraryID: number,
  itemKeys: readonly string[],
): Promise<Zotero.Item[]> {
  const items: Zotero.Item[] = [];
  for (const key of itemKeys) {
    const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
    if (item === false || !item.isRegularItem()) {
      throw new Error(`no regular item ${key} in library ${libraryID}`);
    }
    items.push(item);
  }
  return items;
}

/**
 * Each item's entry in `request`'s style and locale, in the given order,
 * trimmed, the style's numbers removed.
 */
async function formatEntries(
  items: readonly Zotero.Item[],
  request: BibliographyRequest,
): Promise<{
  readonly texts: readonly string[];
  readonly numbered: boolean;
  readonly citationList: boolean;
}> {
  if (items.length === 0) {
    return { texts: [], numbered: false, citationList: false };
  }
  const style = (await ensureStyles()).get(request.styleId);
  if (style === false) {
    throw new Error(`citation style not installed: ${request.styleId}`);
  }
  const engine = style.getCiteProc(request.locale, "text");
  try {
    engine.setOutputFormat("text");
    const ids = items.map((item) => item.id);
    engine.updateItems(ids);
    const bib = engine.makeBibliography();
    if (bib === false) {
      const texts = ids.map((id) =>
        engine
          .previewCitationCluster(
            { citationItems: [{ id }], properties: {} },
            [],
            [],
            "text",
          )
          .trim(),
      );
      return { texts, numbered: false, citationList: true };
    }
    const ordered = entriesInOrder(bib[0].entry_ids, bib[1], ids);
    const { texts, numbered } = stripStyleNumbers(ordered);
    return { texts, numbered, citationList: false };
  } finally {
    engine.free();
  }
}

/**
 * Whether the item's record came from Semantic Scholar, for its attribution
 * under the report's references (`docs/09` §7; owner, 2026-11-17,
 * `plan/00` §6 item 395(c), `P7-T35`): `extra`'s `rh-sources` line names
 * `semanticscholar`, or it carries an `rh-s2-corpus-id` line, which only a
 * Semantic Scholar record supplies. An item the plugin did not import has
 * neither line.
 *
 * @param extra - the item's `extra` field
 */
export function recordFromSemanticScholar(extra: unknown): boolean {
  const lines = parseExtra(typeof extra === "string" ? extra : undefined);
  if (findExtraLine(lines, RH_S2_CORPUS_ID_KEY) !== undefined) return true;
  const sources = findExtraLine(lines, RH_SOURCES_KEY)?.value ?? "";
  return sources
    .split(",")
    .some((source) => source.trim() === "semanticscholar");
}

function doiOf(item: Zotero.Item): BibliographyEntry["doi"] {
  const raw: unknown = item.getField("DOI");
  return normalizeDoi(typeof raw === "string" ? raw : undefined) ?? undefined;
}

async function formatBibliography(
  itemKeys: readonly string[],
  request: BibliographyRequest,
): Promise<FormattedBibliography> {
  const items = await itemsFor(request.libraryID, itemKeys);
  const { texts, numbered, citationList } = await formatEntries(items, request);
  return {
    styleId: request.styleId,
    locale: request.locale,
    styleNumbered: numbered,
    citationList,
    entries: items.map((item, i) => ({
      itemKey: item.key,
      index: i + 1,
      text: texts[i] ?? "",
      doi: doiOf(item),
      ...(recordFromSemanticScholar(item.getField("extra")) && {
        semanticScholar: true,
      }),
    })),
  };
}

async function formatRetracted(
  itemKeys: readonly string[],
  request: BibliographyRequest,
): Promise<readonly RetractedEntry[]> {
  const items = await itemsFor(request.libraryID, itemKeys);
  const { texts } = await formatEntries(items, request);
  return items.map((item, i) => ({
    itemKey: item.key,
    text: texts[i] ?? "",
    doi: doiOf(item),
  }));
}

/** The words `request`'s style and CSL locale join names with. */
async function citationTerms(
  request: BibliographyRequest,
): Promise<CitationTerms> {
  const style = (await ensureStyles()).get(request.styleId);
  if (style === false) {
    throw new Error(`citation style not installed: ${request.styleId}`);
  }
  const engine = style.getCiteProc(request.locale, "text");
  try {
    // A CSL locale file defines both terms; the fallback is the en-US text,
    // so a node never shows an empty joiner.
    const and = engine.getTerm("and");
    const etAl = engine.getTerm("et-al");
    return {
      and: typeof and === "string" && and !== "" ? and : "and",
      etAl: typeof etAl === "string" && etAl !== "" ? etAl : "et al.",
    };
  } finally {
    engine.free();
  }
}

/** The item's `zotero://select` address (`docs/06` §10.2 option (a)). */
function selectUriOf(item: Zotero.Item): string {
  const library = Zotero.Libraries.get(item.libraryID) as unknown as
    { readonly libraryType?: string; readonly groupID?: number } | false;
  return library !== false && library.libraryType === "group"
    ? `zotero://select/groups/${String(library.groupID)}/items/${item.key}`
    : `zotero://select/library/items/${item.key}`;
}

async function citationNodes(
  itemKeys: readonly string[],
  request: BibliographyRequest,
): Promise<readonly CitationNode[]> {
  const items = await itemsFor(request.libraryID, itemKeys);
  if (items.length === 0) return [];
  const terms = await citationTerms(request);
  const toCSL = (
    Zotero.Utilities as unknown as {
      Item: { itemToCSLJSON(item: Zotero.Item): Record<string, unknown> };
    }
  ).Item.itemToCSLJSON;
  return items.map((item) => {
    const uri = String(Zotero.URI.getItemURI(item));
    const itemData = toCSL(item);
    const citationItem: CitationItemPayload = { uris: [uri], itemData };
    const text = citationPreviewText(itemData, terms);
    return {
      itemKey: item.key,
      uri,
      selectUri: selectUriOf(item),
      text,
      html: citationSpan(
        citationItem,
        `(<span class="citation-item">${escapeHtml(text)}</span>)`,
      ),
      citationItem,
    };
  });
}

/**
 * Everything the report takes from Zotero for citations, as one object, so a
 * pipeline module never names the `Zotero` global (`docs/07` §2.3).
 */
export const zoteroBibliographyPort: BibliographyPort = {
  userCitationStyle,
  formatBibliography,
  formatRetracted,
  citationNodes,
};
