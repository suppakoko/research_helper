/**
 * Read Zotero's own full text for an attachment (`P0-T19`, spike `V-15`;
 * extended by `P3-T18`).
 *
 * This is the platform half of the summarizer's **Tier 2** text source
 * (`docs/06` §3.1). It is deliberately thin: it reads, it never writes, and it
 * contains no parsing, no cleaning, no chunking and no quality-gate policy.
 * The tier ladder and D-06-3's page-cap decision live in
 * `src/pipeline/summarize/acquire.ts` (`acquireSource`), which reaches this
 * module through {@link zoteroFullTextPort}; the cleaning pass (`docs/06`
 * §4.1), the language check (§4.2), the IMRaD segmentation (§4.3), the
 * chunker (§5) and R-19's gate sit above that again.
 *
 * `P3-T18` added {@link pickTextAttachment} (`docs/06` §3.3.3),
 * {@link getFullTextFirstPages} (D-06-3's over-the-cap path),
 * {@link isPartialIndexState}, {@link md5Hex} (the `contentHash` fallback,
 * here only because `Zotero.Utilities` may be named nowhere else) and the port
 * object.
 *
 * Item 285(b) (owner, 2026-10-25) added {@link readEnglishDictionary}: the
 * two files of the en-US Hunspell dictionary Zotero ships, which `docs/06`
 * §4.1 step 8's OCR probe expands into its word list. It reads two `resource:`
 * URLs and decodes them by the `.aff`'s `SET` line; the expansion is not here.
 *
 * `P3-T21` added the structure reader — {@link getStructuredDocumentText},
 * {@link narrowStructuredDocument} and {@link getDocumentStructure} — which
 * `docs/06` §4.3's PDF section detector is built on (owner, 2026-10-23,
 * `plan/00` §6 item 271(c)). It is the second direct `PDFWorker` call here;
 * like the first, it writes nothing (it does not go through `Zotero.SDT`,
 * which caches a `.zotero-sdt-cache` file).
 *
 * ### What it may and may not call
 *
 * `docs/06` §3.3.2, **decision D-06-2**: `await attachment.attachmentText` is
 * the primary Tier-2 API. It runs the whole ladder — cache file, then the sync
 * processor cache, then on-demand extraction — and every rung of it is
 * correct. So this module does **not** read `.zotero-ft-cache` itself, does not
 * call `Zotero.Fulltext.indexItems()` (that would mutate the user's index as a
 * side effect of running a report, `docs/06` §3.3.4), does not touch
 * `zotero.sqlite`, and does not go near `semanticSplitter` (§3.3.6) or the
 * removed `fulltextWords` tables (§3.3.1).
 *
 * {@link getFullTextAllPages} and {@link getFullTextFirstPages} are the
 * documented exception: `docs/06` §3.3.4's **decision D-06-3** calls
 * `Zotero.PDFWorker.getFullText` directly, and only after
 * `INDEX_STATE_PARTIAL`. They are needed because `attachmentText` does not
 * return the truncated cache in that state: Zotero 10.0.3's `item.js` getter
 * reads the cache file only when `isFullyIndexed()` is true, and otherwise
 * calls `getFullText(this.id)` with no page limit (read from the installed
 * `omni.ja`, 2026-10-21, `P3-T18`).
 *
 * ### Two typings holes are closed here, not in `typings/`
 *
 * `typings/zotero-augment.d.ts` records both, with the reason neither can be
 * fixed by augmentation:
 *
 * - hole **(a)**: `Zotero.PDFWorker` is declared `let PDFWorker: any;`
 *   upstream, so it compiles with no checking at all and cannot be augmented
 *   (a namespace or second `let` for the same name is a duplicate identifier).
 *   {@link PdfWorkerFullTextApi} states the contract `docs/06` §3.3.5 verified
 *   against `xpcom/pdfWorker/manager.js`, and {@link pdfWorker} is the single
 *   place the untyped global is narrowed to it. Nothing else in the tree
 *   should name `Zotero.PDFWorker`.
 * - hole **(f)**: `Zotero.Fulltext.getPages()` is declared
 *   `(itemID) => Promise<false | { total: number }>`, but D-06-3 needs
 *   `indexedPages` from that same row and reading it is TS2339.
 *   {@link getIndexedPageCounts} restates the row shape read from
 *   `fulltext.js`. The row is a **DB row, not a plain object**: `total` is
 *   `totalPages` under an alias, either column can be `NULL`, and
 *   `JSON.stringify` on the row throws `DB column 'toJSON' not found`
 *   (measured 2026-09-15, `P0-T23`/`P0-T18`), so its properties are read one
 *   by one and copied into a plain object here.
 */

/**
 * `Zotero.PDFWorker.getFullText`'s resolved value.
 *
 * Verified in `docs/06` §3.3.5 against `xpcom/pdfWorker/manager.js`. The
 * text-layout contract is the **corrected D-06-4** (`P0-T19`, 2026-09-16):
 * `\f` is a guaranteed page boundary (`totalPages - 1` of them); `\n` is
 * **not** a guaranteed paragraph boundary — some documents emit one per
 * printed line — so nothing downstream may treat it as one. The whole string
 * is `.trim()`ed and NFC-normalized by the extractor.
 */
export interface PdfFullText {
  readonly text: string;
  /** Pages the extractor actually read — `maxPages`, or every page. */
  readonly extractedPages: number;
  /** Pages the document has. */
  readonly totalPages: number;
}

/**
 * The slice of the untyped `Zotero.PDFWorker` this module uses for flat text.
 *
 * `getStructuredDocumentText` is narrowed separately, by
 * {@link structuredTextWorker} (`P3-T21`), so that a build lacking it breaks
 * only section detection and never Tier 2 text.
 */
interface PdfWorkerFullTextApi {
  /**
   * @param itemID - **attachment** item id; throws
   *   `Error('Item must be a PDF attachment')` for anything else, including a
   *   parent item id.
   * @param maxPages - pages to extract, or `null` for all of them.
   * @param isPriority - jump the worker queue.
   * @param password - for encrypted PDFs.
   */
  getFullText(
    itemID: number,
    maxPages: number | null,
    isPriority?: boolean,
    password?: string,
  ): Promise<PdfFullText>;
}

/** `fulltextItems`' page columns, as `getPages()`'s row exposes them. */
export interface IndexedPageCounts {
  /** Pages indexed into the cache; `null` when the column is `NULL`. */
  readonly indexedPages: number | null;
  /** `totalPages`, aliased `total` by `getPages()`'s own SQL. */
  readonly total: number | null;
}

/** The `getPages()` row, restated because hole (f) leaves `indexedPages` off. */
interface FullTextPagesRow {
  readonly indexedPages?: number | null;
  readonly total?: number | null;
}

/**
 * The one narrowing of the untyped `Zotero.PDFWorker` global (hole (a)).
 *
 * The parameter is `unknown` so that the `any` upstream hands out is discarded
 * at the boundary rather than spreading; the runtime check is what earns the
 * assertion that follows it.
 */
function narrowPdfWorker(candidate: unknown): PdfWorkerFullTextApi {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    typeof (candidate as { getFullText?: unknown }).getFullText !== "function"
  ) {
    throw new Error(
      "Zotero.PDFWorker.getFullText is unavailable on this Zotero build",
    );
  }
  return candidate as PdfWorkerFullTextApi;
}

/** `Zotero.PDFWorker`, typed to {@link PdfWorkerFullTextApi}. */
function pdfWorker(): PdfWorkerFullTextApi {
  return narrowPdfWorker(Zotero.PDFWorker);
}

/**
 * The attachment's plain text, via `attachmentText` (D-06-2).
 *
 * Returns `null` rather than text in the two cases the accessor reports by
 * returning something other than a string — it is declared
 * `readonly attachmentText: Promise<string>` upstream, which is narrower than
 * what `item.js:4158` actually returns:
 *
 * - `undefined` when the item is not an attachment;
 * - `null` when the attachment has no id (never saved).
 *
 * An **empty string** is a third, different answer and is passed through
 * unchanged: it means Zotero looked and found nothing usable — no file, an
 * unsupported content type, or an extractor that produced nothing. Deciding
 * what to do about that is R-19's gate, not this accessor's job.
 *
 * Reading this does not persist anything. On the on-demand rung the accessor
 * calls `Zotero.PDFWorker.getFullText(this.id)`, which reads the file and
 * returns; it writes no cache file and no `fulltextItems` row (read from
 * `manager.js:612` and `item.js:4158`, confirmed by measurement, `P0-T19`).
 * Note that that rung passes **no** `maxPages`, so an unindexed attachment
 * yields every page while a cached one yields at most
 * `extensions.zotero.fulltext.pdfMaxPages` of them.
 */
export async function getAttachmentText(
  attachment: Zotero.Item,
): Promise<string | null> {
  const text: unknown = await attachment.attachmentText;
  return typeof text === "string" ? text : null;
}

/**
 * `Zotero.Fulltext.getIndexedState(attachment)` — one of the
 * `INDEX_STATE_*` constants (`docs/06` §3.3.4).
 *
 * Throws `Error('Item is not an attachment')` for a non-attachment, which is
 * the platform's behaviour and is left to propagate.
 */
export function getIndexedState(attachment: Zotero.Item): Promise<number> {
  return Zotero.Fulltext.getIndexedState(attachment);
}

/**
 * The attachment's `indexedPages` / `total` page counts, or `null` when it has
 * no `fulltextItems` row at all (`getPages()` resolves to `false` then).
 *
 * D-06-3 reads this after an `INDEX_STATE_PARTIAL` to decide whether to
 * re-extract. The properties are read explicitly and copied into a plain
 * object: the value `getPages()` resolves to is a DB row, and `JSON.stringify`
 * on it throws.
 */
export async function getIndexedPageCounts(
  attachmentID: number,
): Promise<IndexedPageCounts | null> {
  const row = await Zotero.Fulltext.getPages(attachmentID);
  if (row === false) return null;
  const pages = row as FullTextPagesRow;
  return {
    indexedPages: pages.indexedPages ?? null,
    total: pages.total ?? null,
  };
}

/**
 * Every page of a PDF attachment, bypassing the cache — D-06-3's re-extraction
 * path and nothing else.
 *
 * Prefer {@link getAttachmentText}. This exists because the cache holds only
 * `extensions.zotero.fulltext.pdfMaxPages` pages (default 100), so a truncated
 * document has to be re-read from the file to be summarized honestly. It
 * writes nothing: unlike `Zotero.Fulltext.indexPDF`, which calls this and then
 * persists the result, and unlike `Zotero.SDT`, which caches a
 * `.zotero-sdt-cache` beside the file, a direct `getFullText` call reads the
 * PDF and returns.
 */
export function getFullTextAllPages(
  attachmentID: number,
): Promise<PdfFullText> {
  return pdfWorker().getFullText(attachmentID, null);
}

/**
 * The first `maxPages` pages of a PDF attachment, bypassing the cache —
 * D-06-3's over-the-cap path and nothing else (`P3-T18`).
 *
 * When an `INDEX_STATE_PARTIAL` document has more pages than
 * `fullText.hardPageCap`, D-06-3 keeps the truncated cache. No sanctioned API
 * returns the cache in that state (`attachmentText` extracts every page
 * instead, see the module note, and reading `.zotero-ft-cache` directly is
 * forbidden), so the caller passes `indexedPages` here and gets the same pages
 * the cache holds, at the same bounded cost Zotero's own indexer paid. It
 * writes nothing.
 */
export function getFullTextFirstPages(
  attachmentID: number,
  maxPages: number,
): Promise<PdfFullText> {
  return pdfWorker().getFullText(attachmentID, maxPages);
}

/** Whether `state` is `Zotero.Fulltext.INDEX_STATE_PARTIAL`. */
export function isPartialIndexState(state: number): boolean {
  return state === Zotero.Fulltext.INDEX_STATE_PARTIAL;
}

/**
 * The attachment to read Tier-2 text from, or `null` — `docs/06` §3.3.3's
 * `pickTextAttachment()`, gated on `Zotero.Fulltext.canIndex()`.
 *
 * `getBestAttachment()` first, kept only if it is a PDF Zotero can index;
 * otherwise the first child attachment `canIndex()` accepts. `canIndex()` is
 * the predicate Zotero itself uses: a non-linked-URL attachment whose content
 * type is PDF, EPUB or text. Neither call downloads a file or touches the
 * index. A regular item with no attachments, and an attachment passed in
 * place of its parent, both yield `null`.
 */
export async function pickTextAttachment(
  item: Zotero.Item,
): Promise<Zotero.Item | null> {
  if (!item.isRegularItem()) return null;
  const best = await item.getBestAttachment();
  if (best && best.isPDFAttachment() && Zotero.Fulltext.canIndex(best)) {
    return best;
  }
  for (const id of item.getAttachments()) {
    const attachment = await Zotero.Items.getAsync(id);
    if (!attachment) continue;
    if (
      attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_URL
    ) {
      continue;
    }
    if (Zotero.Fulltext.canIndex(attachment)) return attachment;
  }
  return null;
}

/**
 * Lower-case hex MD5 of `text` via `Zotero.Utilities.Internal.md5` — the
 * `contentHash` fallback `docs/06` §11.2 names for a scope without
 * `crypto.subtle`. A cache key, not a security boundary.
 */
export function md5Hex(text: string): string {
  return Zotero.Utilities.Internal.md5(text, false).toLowerCase();
}

// ---------------------------------------------------------------------------
// Structured document text — the section outline and heading blocks (P3-T21)
// ---------------------------------------------------------------------------

/**
 * One entry of `catalog.outline`, flattened into document order.
 *
 * `blockIndex` is the top-level `content[]` index the entry's `ref` points
 * into (`ref[0]`), or `null` when the worker did not anchor the entry to a
 * block — `P0-T18` measured a native outline anchoring 4 of 23 entries.
 */
export interface StructuredOutlineEntry {
  readonly title: string;
  /** 0 for a top-level entry, 1 for its children, and so on. */
  readonly depth: number;
  readonly blockIndex: number | null;
  /** The anchored block's plain text; `null` when unanchored or empty. */
  readonly blockText: string | null;
  /** The anchored block's first page (0-based), when it has a box. */
  readonly pageIndex: number | null;
}

/** One top-level `content[]` block the worker classified `heading`. */
export interface StructuredHeadingBlock {
  readonly blockIndex: number;
  readonly text: string;
  readonly pageIndex: number | null;
}

/**
 * The part of `getStructuredDocumentText`'s decoded document that `docs/06`
 * §4.3's detector reads (owner, 2026-10-23, `plan/00` §6 item 271(c)): the
 * outline and the heading blocks, each with its page. Plain data; no
 * `style.bold` is read anywhere (`V-8b`: not portable).
 */
export interface DocumentStructure {
  readonly schemaVersion: string | null;
  /** `catalog.pages.length`. */
  readonly pageCount: number;
  /** `catalog.outline`, depth-first, in document order. */
  readonly outline: readonly StructuredOutlineEntry[];
  /**
   * Top-level blocks of type `heading` whose `flowClass` is absent (running
   * heads and footers carry `flowClass: "excluded"`), in `content[]` order.
   */
  readonly headingBlocks: readonly StructuredHeadingBlock[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/**
 * A block's plain text, the way the bundled reader's own
 * `getNestedBlockPlainText` builds it: a text node's `text`; a block whose
 * children are all text nodes, their concatenation; otherwise the child
 * blocks' texts joined by `\n`. Whitespace runs are then collapsed to one
 * space, because only the words are used — to find the heading in the flat
 * text and to label it.
 */
function blockPlainText(node: unknown): string {
  const raw = (function text(n: unknown): string {
    if (!isRecord(n)) return "";
    if (typeof n.text === "string") return n.text;
    const children = arrayOf(n.content);
    if (children.every((c) => isRecord(c) && typeof c.text === "string")) {
      return children.map((c) => (c as { text: string }).text).join("");
    }
    return children
      .filter((c) => !(isRecord(c) && typeof c.text === "string"))
      .map(text)
      .filter((t) => t !== "")
      .join("\n");
  })(node);
  return raw.replace(/\s+/gu, " ").trim();
}

/** `anchor.pageRects[0][0]`: the block's first page, 0-based. */
function blockPageIndex(node: unknown): number | null {
  if (!isRecord(node) || !isRecord(node.anchor)) return null;
  const first = arrayOf(node.anchor.pageRects)[0];
  const page = Array.isArray(first) ? (first as unknown[])[0] : undefined;
  return typeof page === "number" && Number.isInteger(page) && page >= 0
    ? page
    : null;
}

/**
 * Narrow a materialized SDT document (`{ schemaVersion, metadata, catalog,
 * content }`, `docs/06` §3.3.5) to {@link DocumentStructure}. Pure: every
 * field is read defensively, so a shape this build does not expect yields
 * fewer headings rather than an exception.
 */
export function narrowStructuredDocument(doc: unknown): DocumentStructure {
  const record = isRecord(doc) ? doc : {};
  const catalog = isRecord(record.catalog) ? record.catalog : {};
  const content = arrayOf(record.content);

  const outline: StructuredOutlineEntry[] = [];
  const visit = (entries: readonly unknown[], depth: number): void => {
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const ref = arrayOf(entry.ref);
      const head = ref[0];
      const blockIndex =
        typeof head === "number" &&
        Number.isInteger(head) &&
        head >= 0 &&
        head < content.length
          ? head
          : null;
      const block = blockIndex === null ? undefined : content[blockIndex];
      const blockText = block === undefined ? "" : blockPlainText(block);
      outline.push({
        title:
          typeof entry.title === "string"
            ? entry.title.replace(/\s+/gu, " ").trim()
            : "",
        depth,
        blockIndex,
        blockText: blockText === "" ? null : blockText,
        pageIndex: block === undefined ? null : blockPageIndex(block),
      });
      visit(arrayOf(entry.children), depth + 1);
    }
  };
  visit(arrayOf(catalog.outline), 0);

  const headingBlocks: StructuredHeadingBlock[] = [];
  content.forEach((block, blockIndex) => {
    if (!isRecord(block) || block.type !== "heading") return;
    if (block.flowClass !== undefined) return;
    const text = blockPlainText(block);
    if (text === "") return;
    headingBlocks.push({ blockIndex, text, pageIndex: blockPageIndex(block) });
  });

  return {
    schemaVersion:
      typeof record.schemaVersion === "string" ? record.schemaVersion : null,
    pageCount: arrayOf(catalog.pages).length,
    outline,
    headingBlocks,
  };
}

/** The slice of `Zotero.PDFWorker` the structure reader uses. */
interface PdfWorkerStructuredTextApi {
  /**
   * @param itemID - **attachment** item id (PDF, EPUB or snapshot).
   * @returns `{ buf: ArrayBuffer }` (an SDTPack), or `null` when the file is
   *   missing (`xpcom/pdfWorker/manager.js`).
   */
  getStructuredDocumentText(
    itemID: number,
    options?: { isPriority?: boolean; password?: string },
  ): Promise<unknown>;
}

/** The narrowing of `Zotero.PDFWorker` for {@link getStructuredDocument}. */
function structuredTextWorker(): PdfWorkerStructuredTextApi {
  const candidate: unknown = Zotero.PDFWorker;
  if (
    !isRecord(candidate) ||
    typeof candidate.getStructuredDocumentText !== "function"
  ) {
    throw new Error(
      "Zotero.PDFWorker.getStructuredDocumentText is unavailable on this Zotero build",
    );
  }
  return candidate as unknown as PdfWorkerStructuredTextApi;
}

/** `resource://zotero/document-worker/structured-document-text.js`'s reader. */
interface SdtPackReader {
  materialize(): Promise<unknown>;
}

/** The two exports of Zotero's bundled SDT reader module this file calls. */
interface SdtModule {
  openStructuredDocumentTextPack(
    input: Uint8Array,
    options: { inflate(bytes: Uint8Array): Uint8Array },
  ): Promise<SdtPackReader>;
}

/** `resource://zotero/pako.js`, as `xpcom/sdt.js` uses it. */
interface PakoModule {
  inflateRaw(bytes: Uint8Array): Uint8Array;
}

const SDT_MODULE_URL =
  "resource://zotero/document-worker/structured-document-text.js";
const PAKO_MODULE_URL = "resource://zotero/pako.js";

/**
 * Evaluate one of Zotero's bundled CommonJS files and return its exports.
 *
 * `xpcom/sdt.js` reaches both files through `require()`, which the plugin
 * sandbox does not have (`addon/bootstrap.js`'s `ctx` carries no loader). A
 * subscript loaded with a `{ module, exports }` scope object gives each file
 * exactly what its CommonJS / UMD wrapper looks for; everything else it names
 * (`Object`, `TextDecoder`, `Uint8Array`) resolves from the sandbox global.
 */
function loadBundledCommonJs<T>(url: string): T {
  const module = { exports: {} as unknown };
  const scope = { module, exports: module.exports };
  Services.scriptloader.loadSubScript(url, scope);
  return module.exports as T;
}

let bundledModules:
  { readonly sdt: SdtModule; readonly pako: PakoModule } | undefined;

function sdtModules(): { readonly sdt: SdtModule; readonly pako: PakoModule } {
  if (bundledModules === undefined) {
    const sdt = loadBundledCommonJs<Partial<SdtModule>>(SDT_MODULE_URL);
    const pako = loadBundledCommonJs<Partial<PakoModule>>(PAKO_MODULE_URL);
    if (
      typeof sdt.openStructuredDocumentTextPack !== "function" ||
      typeof pako.inflateRaw !== "function"
    ) {
      throw new Error(
        "Zotero's bundled SDT reader or pako did not load on this Zotero build",
      );
    }
    bundledModules = { sdt: sdt as SdtModule, pako: pako as PakoModule };
  }
  return bundledModules;
}

/**
 * The attachment's structured document text, decoded and materialized:
 * `{ schemaVersion, metadata, catalog, content }` (`docs/06` §3.3.5), or
 * `null` when the worker returned no pack (the file is missing).
 *
 * Calls `Zotero.PDFWorker.getStructuredDocumentText` **directly** and decodes
 * the pack with Zotero's own reader module and `pako.inflateRaw`, exactly as
 * `xpcom/sdt.js`'s `_openPack` does. Unlike `Zotero.SDT.getPack`, this writes
 * nothing: no `.zotero-sdt-cache` file, no index row. It is one worker job per
 * call — layout analysis of every page — so callers make it once per
 * acquisition. Throws whatever the worker throws (non-PDF/EPUB/snapshot item,
 * password, corrupt file); the caller decides what that means.
 */
export async function getStructuredDocumentText(
  attachmentID: number,
): Promise<unknown> {
  const result = await structuredTextWorker().getStructuredDocumentText(
    attachmentID,
    {},
  );
  if (result === null || result === undefined) return null;
  const buf = isRecord(result) ? result.buf : undefined;
  // A tag test, not `instanceof`: the buffer comes from Zotero's global, and an
  // `instanceof` against the plugin sandbox's own `ArrayBuffer` is false
  // across compartments (the bundled reader tests the same way).
  let bytes: Uint8Array;
  if (Object.prototype.toString.call(buf) === "[object ArrayBuffer]") {
    bytes = new Uint8Array(buf as ArrayBuffer);
  } else if (ArrayBuffer.isView(buf)) {
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } else {
    throw new Error(
      "Zotero.PDFWorker.getStructuredDocumentText resolved without a pack buffer",
    );
  }
  const { sdt, pako } = sdtModules();
  const reader = await sdt.openStructuredDocumentTextPack(bytes, {
    inflate: (chunk) => pako.inflateRaw(chunk),
  });
  return reader.materialize();
}

/**
 * {@link getStructuredDocumentText}, narrowed to the outline and heading
 * blocks `docs/06` §4.3's detector reads; `null` when there is no pack.
 */
export async function getDocumentStructure(
  attachment: Zotero.Item,
): Promise<DocumentStructure | null> {
  const doc = await getStructuredDocumentText(attachment.id);
  return doc === null ? null : narrowStructuredDocument(doc);
}

// ---------------------------------------------------------------------------
// The en-US word list (`docs/06` §4.1 step 8, decided 2026-10-25, owner,
// `plan/00` §6 item 285(b))
// ---------------------------------------------------------------------------

/** A Hunspell dictionary's two files, decoded to text. */
export interface HunspellFiles {
  readonly aff: string;
  readonly dic: string;
}

/**
 * The en-US Hunspell dictionary Zotero ships in its GRE `omni.ja`
 * (`dictionaries/en-US.aff` and `.dic`, read from Zotero 10.0.3's install,
 * 2026-10-25). It is the word list item 283(b) measured the stray-space split
 * share with; the plugin ships none of its own.
 */
const EN_US_AFF_URL = "resource://gre/dictionaries/en-US.aff";
const EN_US_DIC_URL = "resource://gre/dictionaries/en-US.dic";

/** Bytes to a string one code unit per byte: ISO-8859-1 exactly. */
function decodeLatin1(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let out = "";
  for (let at = 0; at < bytes.length; at += chunk) {
    out += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return out;
}

async function readBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Read the two dictionary files, decoded as the `.aff`'s `SET` line says
 * (`ISO8859-1` for Zotero 10.0.3's en-US; `UTF-8` is accepted too). `null`
 * when either file is empty or the encoding is another one. Reads only;
 * the expansion is the pipeline's (`src/pipeline/summarize/wordList.ts`).
 * The sandbox's `fetch` reads `resource:` URLs (`addon/bootstrap.js` lists
 * it among the sandbox globals).
 */
export async function readEnglishDictionary(): Promise<HunspellFiles | null> {
  const [affBytes, dicBytes] = await Promise.all([
    readBytes(EN_US_AFF_URL),
    readBytes(EN_US_DIC_URL),
  ]);
  if (affBytes.length === 0 || dicBytes.length === 0) return null;
  const aff = decodeLatin1(affBytes);
  const set = /^SET[ \t]+(\S+)/mu.exec(aff)?.[1]?.toUpperCase() ?? "";
  if (set === "UTF-8") {
    return {
      aff: new TextDecoder("utf-8").decode(affBytes),
      dic: new TextDecoder("utf-8").decode(dicBytes),
    };
  }
  if (set === "ISO8859-1") return { aff, dic: decodeLatin1(dicBytes) };
  return null;
}

/**
 * Everything `acquireSource` needs from the platform, as one object, so the
 * pipeline module never names the `Zotero` global (`docs/07` §2.3).
 */
export const zoteroFullTextPort = {
  pickTextAttachment,
  getIndexedState,
  isPartialIndexState,
  getIndexedPageCounts,
  getAttachmentText,
  getFullTextAllPages,
  getFullTextFirstPages,
  getDocumentStructure,
  readEnglishDictionary,
  md5Hex,
} as const;
