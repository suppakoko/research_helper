/**
 * The summarizer's acquisition result — `docs/06` §3.6 (`P3-T18`).
 *
 * `docs/07` §5.2 also places `StoredSummary` in this file; `P3-T25` adds it.
 * This card adds only what text acquisition produces. `model/` imports nothing
 * but `model/` (`docs/07` §2.3), so every type here is plain data.
 */

/**
 * Which rung of `docs/06` §3.1's ladder produced the text.
 *
 * `fulltext_pdf` names Tier 2, which is "the attachment's text" — Zotero's
 * `attachmentText` covers PDF, EPUB, HTML snapshots and plain text alike, and
 * `docs/06` §6.3 fixes this four-member union, so a snapshot's text is
 * recorded as `fulltext_pdf` too.
 */
export type SourceTier =
  "abstract" | "fulltext_pdf" | "fulltext_epmc" | "metadata_only";

/** `docs/06` §4.3's section labels. Nothing fills them before `P3-T21`. */
export type ImradSection =
  | "abstract"
  | "introduction"
  | "background"
  | "related_work"
  | "methods"
  | "results"
  | "discussion"
  | "conclusion"
  | "limitations"
  | "other";

/** One labelled span of the body. */
export interface AcquiredSection {
  readonly imrad: ImradSection;
  readonly heading: string;
  readonly text: string;
}

/**
 * The warnings acquisition itself raises. `docs/06` §3.6 types `warnings` as
 * `string[]` because later stages (`P3-T19`'s OCR probe and language check)
 * add their own; these are the ones `P3-T18` can emit.
 *
 * - `pdf_password_protected` — the extractor needs a password (`docs/06`
 *   §13.5's failure table); demoted to Tier 1.
 * - `attachment_text_failed` — the extractor threw for any other reason
 *   (corrupt file, file not on this computer); demoted to Tier 1.
 * - `attachment_text_empty` — Zotero looked and found no text; demoted.
 * - `content_hash_md5` — `crypto.subtle` was missing, so `contentHash` is the
 *   `md5:`-prefixed fallback rather than SHA-256.
 *
 * Truncation is not a warning: it has its own field, `truncated`.
 */
export type AcquisitionWarning =
  | "pdf_password_protected"
  | "attachment_text_failed"
  | "attachment_text_empty"
  | "content_hash_md5";

/** `docs/06` §3.6, field for field. */
export interface AcquiredSource {
  /** Zotero item key of the parent (regular) item. */
  readonly itemKey: string;
  readonly libraryID: number;
  readonly tier: SourceTier;
  /**
   * Framing preamble: the normalized abstract whenever one survived
   * `docs/06` §3.2's five steps, on full-text tiers too; otherwise `null`.
   */
  readonly abstract: string | null;
  /** Sectioned body. Empty until `P3-T21`'s detector exists. */
  readonly sections: readonly AcquiredSection[];
  /**
   * The text actually sent to the model: the abstract alone on Tier 1; the
   * abstract, a blank line, then the attachment text exactly as Zotero gave
   * it on Tier 2; `""` on `metadata_only`.
   */
  readonly text: string;
  /** `text.length`, in UTF-16 code units. */
  readonly charCount: number;
  /** The caller's estimator applied to `text` (`docs/06` §5.1). */
  readonly estTokens: number;
  /** D-06-3: a page cap was hit, so `text` does not cover every page. */
  readonly truncated: boolean;
  /** Key of the attachment the text came from; `null` unless Tier 2. */
  readonly attachmentKey: string | null;
  /**
   * Lower-case hex SHA-256 of `text` — never of the file and never of
   * `dateModified` (`docs/06` §11.2). `md5:`-prefixed when the fallback ran.
   */
  readonly contentHash: string;
  readonly warnings: readonly string[];
}
