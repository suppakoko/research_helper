/**
 * Read Zotero's own full text for an attachment (`P0-T19`, spike `V-15`).
 *
 * This is the platform half of the summarizer's **Tier 2** text source
 * (`docs/06` §3.1). It is deliberately thin: it reads, it never writes, and it
 * contains no parsing, no cleaning, no chunking and no quality-gate policy.
 * The cleaning pass (`docs/06` §4.1), the language check (§4.2), the IMRaD
 * segmentation (§4.3), the chunker (§5) and R-19's gate all belong to Phase 3
 * and all sit *above* this file; `plan/README.md` §4 lists this path among the
 * spike files a later card rewrites.
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
 * {@link getFullTextAllPages} is the one documented exception: `docs/06`
 * §3.3.4's **decision D-06-3** calls `Zotero.PDFWorker.getFullText` directly,
 * and only for the "the cache was truncated, extract every page" case.
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
 * Verified in `docs/06` §3.3.5 against `xpcom/pdfWorker/manager.js:612`, whose
 * text-layout contract the rest of the pipeline depends on (**D-06-4**): `\f`
 * is a hard page boundary, `\n` a paragraph boundary, hard-wrapped lines are
 * joined into flowing paragraphs, and the whole string is `.trim()`ed and
 * NFC-normalized by the extractor.
 */
export interface PdfFullText {
  readonly text: string;
  /** Pages the extractor actually read — `maxPages`, or every page. */
  readonly extractedPages: number;
  /** Pages the document has. */
  readonly totalPages: number;
}

/**
 * The slice of the untyped `Zotero.PDFWorker` this module uses.
 *
 * `getStructuredDocumentText` is deliberately absent: `P0-T18` measured it and
 * Phase 3 owns whatever uses it, and a second consumer of the same `any` would
 * defeat the point of narrowing it in one place.
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
