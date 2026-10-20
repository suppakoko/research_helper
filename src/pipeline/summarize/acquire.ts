/**
 * Text acquisition, tiers 1–2 — `docs/06` §3.1–§3.3 and §3.6 (`P3-T18`).
 *
 * Caller: `summarizeItem` (`P3-T25`). `P3-T19` adds Tier 3 (Europe PMC JATS),
 * Tier 4's stub, the cleaning pass and the OCR probe to this file.
 *
 * ## The ladder this card implements
 *
 * 1. **Tier 1** — `abstractNote` through `normalizeAbstract`'s five steps;
 *    rejected under `summary.minAbstractChars` or as a placeholder.
 * 2. **Tier 2** — the attachment `pickTextAttachment` chooses, read through
 *    `attachmentText` (D-06-2), with D-06-3's page-cap rule on
 *    `INDEX_STATE_PARTIAL` (below). Any extraction failure demotes to Tier 1
 *    with a warning; nothing is thrown out of this function for it.
 * 3. Neither → `metadata_only` with empty `text`. `P3-T19` turns that into the
 *    no-LLM stub.
 *
 * On Tier 2 the normalized abstract is prepended as the framing preamble
 * (§3.1 "Ordering rationale").
 *
 * ## D-06-3 as built, and why it differs from the card's wording
 *
 * `P3-T18` step 4 reads "on `INDEX_STATE_PARTIAL`, re-extract with
 * `getFullText` only when `total <= fullText.hardPageCap`; otherwise keep the
 * text". That assumes `attachmentText` returns the truncated cache in that
 * state. It does not: Zotero 10.0.3's getter reads the cache only when
 * `isFullyIndexed()` is true and otherwise extracts **every** page itself
 * (`src/zotero/fulltext.ts` module note). So on `INDEX_STATE_PARTIAL` this
 * module does not call `attachmentText` at all:
 *
 * - `total <= hardPageCap` → one `getFullTextAllPages` call; `truncated` is
 *   `false`.
 * - `total > hardPageCap` → one `getFullTextFirstPages(id, indexedPages)`
 *   call, which yields the pages the cache holds at the cost Zotero's indexer
 *   already paid; `truncated` is `true`.
 *
 * Every other state goes through `attachmentText`: a fully indexed attachment
 * costs zero `PDFWorker` calls; an unindexed one is extracted on demand by
 * Zotero without persisting anything. Nothing here calls the indexer, reads
 * the cache file or the full-text tables, or downloads a file.
 *
 * ## What is never done to the attachment text
 *
 * It is not trimmed, re-wrapped, de-hyphenated or split. In particular `\n`
 * is **not** a paragraph boundary (corrected D-06-4): it is kept exactly as
 * the extractor emitted it, and only `\f` may later be read as a page break.
 *
 * ## `contentHash`
 *
 * Lower-case hex SHA-256 over the exact `text` returned, through
 * `crypto.subtle.digest`. The global is probed once per module instance; if it
 * is missing, `md5Hex` (`Zotero.Utilities.Internal.md5`) is used, the hash is
 * prefixed `md5:` so it can never be mistaken for SHA-256, and the warning
 * `content_hash_md5` is added. Never the file, never `dateModified`.
 */

import type { AcquiredSource, AcquisitionWarning } from "../../model/summary";
import { getPref } from "../../prefs";
import {
  zoteroFullTextPort,
  type IndexedPageCounts,
  type PdfFullText,
} from "../../zotero/fulltext";

import { normalizeAbstract } from "./normalizeAbstract";

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** The parent item, as far as acquisition reads it. */
export interface AcquirableItem {
  readonly key: string;
  readonly libraryID: number;
  getField(field: "abstractNote"): unknown;
}

/** The attachment, as far as acquisition reads it. */
export interface AcquirableAttachment {
  readonly id: number;
  readonly key: string;
}

/**
 * The platform calls acquisition makes. `zoteroFullTextPort` in
 * `src/zotero/fulltext.ts` is the real one; a unit test passes a fake.
 */
export interface FullTextPort<I, A extends AcquirableAttachment> {
  pickTextAttachment(item: I): Promise<A | null>;
  getIndexedState(attachment: A): Promise<number>;
  isPartialIndexState(state: number): boolean;
  getIndexedPageCounts(attachmentID: number): Promise<IndexedPageCounts | null>;
  getAttachmentText(attachment: A): Promise<string | null>;
  getFullTextAllPages(attachmentID: number): Promise<PdfFullText>;
  getFullTextFirstPages(
    attachmentID: number,
    maxPages: number,
  ): Promise<PdfFullText>;
  md5Hex(text: string): string;
}

/** What the caller supplies. */
export interface AcquireOptions {
  /**
   * `docs/06` §5.1's `estTokens`. Injected, not imported: `P3-T06` owns the
   * one exported estimator (`src/llm/shared/tokenEstimate.ts`), and this card
   * may not declare a second one.
   */
  readonly estimateTokens: (text: string) => number;
  /**
   * `false` skips Tier 2 entirely — for a run whose `summary.fullTextMode` is
   * `never`, so no attachment is opened for nothing. Default `true`.
   */
  readonly includeFullText?: boolean;
}

// ---------------------------------------------------------------------------
// contentHash
// ---------------------------------------------------------------------------

/** The one Web Crypto call used. */
export interface DigestApi {
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
}

/** The probe result, cached for the life of the module instance. */
let probedDigest: { readonly api: DigestApi | undefined } | undefined;

/**
 * `crypto.subtle`, if this scope has one — probed once (`P3-T18` step 6).
 * `docs/01` §2.3 measured it present in the plugin sandbox and the test
 * window on Zotero 10.0.3; this probe is what keeps a scope without it
 * working.
 */
export function probeSubtleDigest(): DigestApi | undefined {
  if (probedDigest === undefined) {
    const subtle = (globalThis as { crypto?: { subtle?: Partial<DigestApi> } })
      .crypto?.subtle;
    probedDigest = {
      api:
        subtle !== undefined && typeof subtle.digest === "function"
          ? (subtle as DigestApi)
          : undefined,
    };
  }
  return probedDigest.api;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Hash `text` for `contentHash`: SHA-256 through `digest` when given, else
 * `md5:` + `md5Hex(text)`.
 */
export async function hashAcquiredText(
  text: string,
  digest: DigestApi | undefined,
  md5Hex: (text: string) => string,
): Promise<{ readonly hash: string; readonly fallback: boolean }> {
  if (digest !== undefined) {
    const bytes = new TextEncoder().encode(text);
    return {
      hash: toHex(await digest.digest("SHA-256", bytes)),
      fallback: false,
    };
  }
  return { hash: `md5:${md5Hex(text)}`, fallback: true };
}

// ---------------------------------------------------------------------------
// Tier 2
// ---------------------------------------------------------------------------

/** What reading one attachment produced. */
interface AttachmentRead {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Whether `error` is the extractor asking for a password. Zotero's
 * `PDFWorker` rethrows worker failures with `name` copied from the worker's
 * own error (`_throwWorkerError`), so pdf.js's `PasswordException` arrives by
 * name; the message test is the fallback for a build that does not copy it.
 */
export function isPasswordError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "PasswordException") return true;
  return typeof message === "string" && /PasswordException/u.test(message);
}

/**
 * Read one attachment's text, applying D-06-3 (module note). Throws whatever
 * the platform throws; the caller demotes.
 */
async function readAttachment<I, A extends AcquirableAttachment>(
  port: FullTextPort<I, A>,
  attachment: A,
  hardPageCap: number,
): Promise<AttachmentRead> {
  const state = await port.getIndexedState(attachment);
  if (port.isPartialIndexState(state)) {
    const counts = await port.getIndexedPageCounts(attachment.id);
    const indexed = counts?.indexedPages ?? null;
    const total = counts?.total ?? null;
    if (indexed !== null && total !== null && total > indexed) {
      if (total <= hardPageCap) {
        const all = await port.getFullTextAllPages(attachment.id);
        return {
          text: all.text,
          truncated: all.extractedPages < all.totalPages,
        };
      }
      // `getFullText(id, 0)` would mean "every page" to the worker, so the
      // bound is never allowed below one page.
      const first = await port.getFullTextFirstPages(
        attachment.id,
        Math.max(1, indexed),
      );
      return { text: first.text, truncated: true };
    }
  }
  const text = await port.getAttachmentText(attachment);
  return { text: text ?? "", truncated: false };
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * Acquire the text to summarize for `item`, tiers 1–2.
 *
 * Never throws for an extraction failure; a preference or programming error
 * still propagates.
 */
export async function acquireSource<
  I extends AcquirableItem,
  A extends AcquirableAttachment,
>(
  item: I,
  options: AcquireOptions,
  port: FullTextPort<I, A>,
): Promise<AcquiredSource> {
  const warnings: AcquisitionWarning[] = [];

  const rawAbstract = item.getField("abstractNote");
  const normalized = normalizeAbstract(
    typeof rawAbstract === "string" ? rawAbstract : "",
    getPref("summaryMinAbstractChars"),
  );
  const abstract = normalized.text;

  let body: AttachmentRead | null = null;
  let attachmentKey: string | null = null;
  if (options.includeFullText !== false) {
    const hardPageCap = getPref("fullTextHardPageCap");
    try {
      const attachment = await port.pickTextAttachment(item);
      if (attachment !== null) {
        const read = await readAttachment(port, attachment, hardPageCap);
        if (read.text.trim() === "") {
          warnings.push("attachment_text_empty");
        } else {
          body = read;
          attachmentKey = attachment.key;
        }
      }
    } catch (error) {
      warnings.push(
        isPasswordError(error)
          ? "pdf_password_protected"
          : "attachment_text_failed",
      );
    }
  }

  let tier: AcquiredSource["tier"];
  let text: string;
  if (body !== null) {
    tier = "fulltext_pdf";
    text = abstract === null ? body.text : `${abstract}\n\n${body.text}`;
  } else if (abstract !== null) {
    tier = "abstract";
    text = abstract;
  } else {
    tier = "metadata_only";
    text = "";
  }

  const { hash, fallback } = await hashAcquiredText(
    text,
    probeSubtleDigest(),
    port.md5Hex,
  );
  if (fallback) warnings.push("content_hash_md5");

  return {
    itemKey: item.key,
    libraryID: item.libraryID,
    tier,
    abstract,
    sections: [],
    text,
    charCount: text.length,
    estTokens: options.estimateTokens(text),
    truncated: body?.truncated ?? false,
    attachmentKey,
    contentHash: hash,
    warnings,
  };
}

/** The Zotero item type `zoteroFullTextPort` works on, without naming the global. */
export type ZoteroAcquirableItem = Parameters<
  typeof zoteroFullTextPort.pickTextAttachment
>[0];

/** {@link acquireSource} against the real platform. */
export function acquireZoteroSource(
  item: ZoteroAcquirableItem,
  options: AcquireOptions,
): Promise<AcquiredSource> {
  return acquireSource(item, options, zoteroFullTextPort);
}
