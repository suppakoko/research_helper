/**
 * Text acquisition, tiers 1–4 — `docs/06` §3.1–§3.6, §4.1, §4.2 and §13.1
 * (`P3-T18` tiers 1–2; `P3-T19` Tier 3, the cleaning pass, the OCR probe,
 * the language check, Tier 4's stub and the §13.1 recoveries).
 *
 * Caller: `summarizeItem` (`P3-T25`).
 *
 * ## The ladder
 *
 * 1. **Tier 1** — `abstractNote` through `normalizeAbstract`'s five steps;
 *    rejected under `summary.minAbstractChars` or as a placeholder.
 * 2. **Tier 3 first when `fullText.preferJATS` is on** (D-06-1): with an
 *    {@link AcquireOptions.epmc} source, Europe PMC's open-access JATS is
 *    tried before the attachment, even when a local PDF exists; any failure
 *    falls through to Tier 2. With the preference off, Tier 3 is tried only
 *    when Tier 2 gave nothing — which is also §13.1's second recovery
 *    ("Tier 3 applies even with no local PDF").
 * 3. **Tier 2** — the attachment `pickTextAttachment` chooses, read through
 *    `attachmentText` (D-06-2), with D-06-3's page-cap rule on
 *    `INDEX_STATE_PARTIAL` (below), then `docs/06` §4.1's cleaning pass and
 *    OCR probe (`./clean.ts`). Any extraction failure demotes with a warning;
 *    nothing is thrown out of this function for it. `ocr_suspected` warns
 *    and **never demotes** (owner, 2026-10-21, `plan/00` §6 item 258).
 * 4. Nothing → §13.1's first recovery, when the caller supplies one: the
 *    abstract fetched again by identifier (a network call, never an LLM
 *    call), written back to `abstractNote` only after the run's single
 *    consent (NFR-20, {@link createRunWriteBackConsent}).
 * 5. Still nothing → `metadata_only` with empty `text`, which
 *    {@link summarizeOrStub} turns into the no-LLM stub (§3.5).
 *
 * On Tiers 2 and 3 the normalized abstract is prepended as the framing
 * preamble (§3.1 "Ordering rationale"); on Tier 3 without an item abstract,
 * the JATS abstract is normalized and used. §4.2's language check runs on
 * the final `text` of every tier.
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
 * Beyond §4.1's steps (`./clean.ts`), it is not trimmed, re-wrapped,
 * de-hyphenated or split. In particular `\n` is **not** a paragraph boundary
 * (corrected D-06-4): it is kept as the extractor emitted it, and the page
 * separators (`\n*\f`) survive the cleaning pass verbatim.
 *
 * ## Sections (`P3-T21`)
 *
 * `docs/06` §4.3's detector (`./imrad.ts`) runs on the full-text body only:
 * Tier 3 re-uses `extractJats`'s sections; Tier 2 reads the attachment's
 * section outline and heading blocks through the port's optional
 * `getDocumentStructure` (once, after cleaning, and never for a truncated
 * text — that read lays out every page) and falls back to the line scan when
 * there is none or the read fails. A structure failure never demotes the
 * tier. `sections` carry offsets into the final `text`; `sectionAware` is
 * `false` on Tiers 1 and 4 and whenever fewer than two IMRaD sections were
 * recognized.
 *
 * **The degrade switch (`P3-T22`).** While `IMRAD_DETECTOR_VALIDATED`
 * (`./imrad.ts`) is false, every tier returns `sectionAware: false` and no
 * sections, whatever the detector found: `docs/06` §4.3 forbids labels the
 * detector has not been shown to justify, so `auto` runs whole-document flat
 * chunking. The detector still runs, and its own answer stays on the
 * diagnostics line (`sectionAwareDetected`, `sectionLabels`). *Since
 * 2026-11-13 (`P3-T41`) the flag is true* — it derives from the held-out
 * record, 92.94 % against the 85 % bar (`docs/06` §4.3, note "Measured
 * 2026-11-13 (held-out)") — so the detector's answer is what is returned;
 * the switch stays, for a withdrawn record and for the override below.
 *
 * ## `contentHash`
 *
 * Lower-case hex SHA-256 over the exact `text` returned, through
 * `crypto.subtle.digest`. The global is probed once per module instance; if it
 * is missing, `md5Hex` (`Zotero.Utilities.Internal.md5`) is used, the hash is
 * prefixed `md5:` so it can never be mistaken for SHA-256, and the warning
 * `content_hash_md5` is added. Never the file, never `dateModified`.
 */

import { ConfigurationError, OperationCancelledError } from "../../core/errors";
import { httpRequest, type HttpClient } from "../../core/http/client";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { Logger } from "../../core/logger";
import {
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
  type ExternalIds,
} from "../../model/ids";
import type {
  AcquiredSource,
  AcquisitionWarning,
  SourceTier,
} from "../../model/summary";
import { getPref } from "../../prefs";
import type { LiteratureSource, SourceCallContext } from "../../sources/types";
import { parseExtra } from "../../zotero/extraField";
import {
  zoteroFullTextPort,
  type DocumentStructure,
  type HunspellFiles,
  type IndexedPageCounts,
  type PdfFullText,
} from "../../zotero/fulltext";

import {
  cleanFullText,
  OCR_SUSPECTED_WARNING,
  type CleanReport,
} from "./clean";
import {
  detectSectionsFromJats,
  detectSectionsFromPdf,
  IMRAD_DETECTOR_VALIDATED,
  NO_SECTIONS,
  type PdfDetectionStats,
  type SectionDetection,
} from "./imrad";
import {
  fetchEpmcFullText,
  type EpmcFullTextOutcome,
  type EpmcIdentifiers,
  type JatsSection,
} from "./jats";
import { detectLanguage, LANGUAGE_NON_ENGLISH_WARNING } from "./languageDetect";
import { normalizeAbstract } from "./normalizeAbstract";
import { expandHunspellWordList, type WordList } from "./wordList";

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
  /**
   * The attachment's section outline and heading blocks (`docs/06` §4.3,
   * `P3-T21`). Optional: without it, Tier 2's section detector runs on the
   * line-scan fallback alone.
   */
  getDocumentStructure?(attachment: A): Promise<DocumentStructure | null>;
  /**
   * §4.1 step 8's word list (decided 2026-10-25, owner, `plan/00` §6 item
   * 285(b)): the two files of Zotero's en-US Hunspell dictionary, which
   * {@link loadWordList} expands. Optional; `null` or a rejection when they
   * cannot be read, and either way the OCR probe then judges nothing and
   * Tier 2 goes on.
   */
  readEnglishDictionary?(): Promise<HunspellFiles | null>;
  md5Hex(text: string): string;
}

/**
 * Tier 3 for one item (`docs/06` §3.4): the identifiers and the fetch.
 * `acquireZoteroSource` builds the real one from {@link fetchEpmcFullText};
 * a unit test passes a fake.
 */
export interface EpmcTier3 {
  readonly identifiers: EpmcIdentifiers;
  readonly fetch: (ids: EpmcIdentifiers) => Promise<EpmcFullTextOutcome>;
}

/**
 * The run's one consent to write recovered abstracts back (`docs/06` §13.1:
 * "requires explicit user consent, once per run, not per item"; NFR-20).
 * Build it with {@link createRunWriteBackConsent} once per run and pass the
 * same object for every item.
 */
export interface WriteBackConsent {
  /** Resolves the run's answer, asking the user at most once. */
  allowed(): Promise<boolean>;
}

/** §13.1's first recovery, as the caller wires it. */
export interface AbstractRecovery<I> {
  /**
   * The item's abstract fetched again by identifier — a network call, never
   * an LLM call. `null` when no source has one.
   */
  fetchAbstract(item: I): Promise<string | null>;
  readonly consent: WriteBackConsent;
  /** Write `abstract` to the item's `abstractNote`. Called only after consent. */
  writeBack(item: I, abstract: string): Promise<void>;
}

/** What the caller supplies. */
export interface AcquireOptions<I = unknown> {
  /**
   * `docs/06` §5.1's `estTokens`. Injected, not imported: `P3-T06` owns the
   * one exported estimator (`src/llm/shared/tokenEstimate.ts`), and this card
   * may not declare a second one.
   */
  readonly estimateTokens: (text: string) => number;
  /**
   * `false` skips Tiers 2 and 3 entirely — for a run whose
   * `summary.fullTextMode` is `never`, so no attachment is opened and no full
   * text is fetched for nothing. Default `true`.
   */
  readonly includeFullText?: boolean;
  /** Tier 3. Absent: Tier 3 is never tried. */
  readonly epmc?: EpmcTier3 | undefined;
  /** §13.1's first recovery. Absent: an item with no text stays Tier 4. */
  readonly recovery?: AbstractRecovery<I> | undefined;
  /** Diagnostics: tier, sizes and the probe's numbers, never text. */
  readonly logger?: Logger | undefined;
  /**
   * Overrides `IMRAD_DETECTOR_VALIDATED` (module note, "The degrade switch").
   * For tests of the detector's wiring only: the product never passes it, so
   * the committed held-out record decides (`true` since 2026-11-13).
   */
  readonly imradDetectorValidated?: boolean;
}

/**
 * The warnings `P3-T19` adds to {@link AcquisitionWarning}'s.
 *
 * - `ocr_suspected` — §4.1 step 8's stray-space split share is above its
 *   threshold (decided 2026-10-25, item 285(b)). Warns only.
 * - `language_non_english` — §4.2: counted scripts above 15 % of letters.
 * - `epmc_fulltext_failed` — Tier 3 was tried and failed (not merely
 *   unavailable); the ladder went on.
 * - `abstract_recovered` — §13.1 recovery 1 supplied the Tier 1 abstract.
 * - `abstract_recovery_failed` — that refetch threw.
 * - `abstract_written_back` — the recovered abstract was saved, with consent.
 * - `abstract_write_back_failed` — consent was given but the save threw.
 */
export type AcquisitionStageWarning =
  | typeof OCR_SUSPECTED_WARNING
  | typeof LANGUAGE_NON_ENGLISH_WARNING
  | "epmc_fulltext_failed"
  | "abstract_recovered"
  | "abstract_recovery_failed"
  | "abstract_written_back"
  | "abstract_write_back_failed";

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

/** Cancellation and composition-root bugs are never demoted to a warning. */
function rethrowIfFatal(error: unknown): void {
  if (
    error instanceof OperationCancelledError ||
    error instanceof ConfigurationError
  ) {
    throw error;
  }
}

/** A full-text body one of Tiers 2 and 3 produced. */
interface FullTextBody {
  readonly tier: Extract<SourceTier, "fulltext_pdf" | "fulltext_epmc">;
  readonly text: string;
  readonly truncated: boolean;
  readonly attachmentKey: string | null;
  /** Tier 3's own abstract, used when the item has none. */
  readonly jatsAbstract: string | null;
  /** Tier 2's cleaning report. */
  readonly clean: CleanReport | null;
  /**
   * Tier 2's section outline and heading blocks; `null` on Tier 3, when the
   * port has no reader, when the read failed, and when the text is truncated.
   */
  readonly structure: DocumentStructure | null;
  /** Why Tier 2 has no structure, for the diagnostics line. */
  readonly structureSkipped:
    "no_reader" | "truncated" | "failed" | "no_pack" | null;
  /** Tier 3's sections as `extractJats` built them; `null` on Tier 2. */
  readonly jatsSections: readonly JatsSection[] | null;
}

/**
 * Read the attachment's structure for §4.3's detector. A failure here never
 * demotes Tier 2: the text is already in hand, and the detector falls back to
 * its line scan. A truncated text is not given a structure at all — reading
 * one means layout analysis of **every** page, which is exactly the cost
 * D-06-3's page cap exists to refuse.
 */
async function readStructure<I, A extends AcquirableAttachment>(
  port: FullTextPort<I, A>,
  attachment: A,
  truncated: boolean,
): Promise<Pick<FullTextBody, "structure" | "structureSkipped">> {
  if (port.getDocumentStructure === undefined) {
    return { structure: null, structureSkipped: "no_reader" };
  }
  if (truncated) return { structure: null, structureSkipped: "truncated" };
  try {
    const structure = await port.getDocumentStructure(attachment);
    return structure === null
      ? { structure: null, structureSkipped: "no_pack" }
      : { structure, structureSkipped: null };
  } catch (error) {
    rethrowIfFatal(error);
    return { structure: null, structureSkipped: "failed" };
  }
}

type WarningSink = (AcquisitionWarning | AcquisitionStageWarning)[];

/** Each port's expanded word list, built once (about 130,000 forms). */
const WORD_LISTS = new WeakMap<object, Promise<WordList | null>>();

/**
 * §4.1 step 8's word list through the port, expanded once per port object
 * and kept for the session. A port without a reader, or a read that fails,
 * gives `null`: the probe then judges nothing, and Tier 2 is never lost over
 * it.
 */
function loadWordList<I, A extends AcquirableAttachment>(
  port: FullTextPort<I, A>,
): Promise<WordList | null> {
  const read = port.readEnglishDictionary;
  if (read === undefined) return Promise.resolve(null);
  let list = WORD_LISTS.get(port);
  if (list === undefined) {
    list = read
      .call(port)
      .then((files) =>
        files === null ? null : expandHunspellWordList(files.aff, files.dic),
      )
      .catch(() => null);
    WORD_LISTS.set(port, list);
  }
  return list;
}

/** Tier 2: read, then §4.1's cleaning pass and OCR probe. */
async function tryTier2<I, A extends AcquirableAttachment>(
  item: I,
  port: FullTextPort<I, A>,
  warnings: WarningSink,
): Promise<FullTextBody | null> {
  const hardPageCap = getPref("fullTextHardPageCap");
  try {
    const attachment = await port.pickTextAttachment(item);
    if (attachment === null) return null;
    const read = await readAttachment(port, attachment, hardPageCap);
    if (read.text.trim() === "") {
      warnings.push("attachment_text_empty");
      return null;
    }
    const cleaned = cleanFullText(read.text, await loadWordList(port));
    if (cleaned.text.trim() === "") {
      warnings.push("attachment_text_empty");
      return null;
    }
    if (cleaned.report.ocr.suspected) warnings.push(OCR_SUSPECTED_WARNING);
    return {
      tier: "fulltext_pdf",
      text: cleaned.text,
      truncated: read.truncated,
      attachmentKey: attachment.key,
      jatsAbstract: null,
      clean: cleaned.report,
      ...(await readStructure(port, attachment, read.truncated)),
      jatsSections: null,
    };
  } catch (error) {
    warnings.push(
      isPasswordError(error)
        ? "pdf_password_protected"
        : "attachment_text_failed",
    );
    return null;
  }
}

/** Tier 3: gate, fetch and parse, through the caller's {@link EpmcTier3}. */
async function tryTier3(
  epmc: EpmcTier3,
  warnings: WarningSink,
): Promise<FullTextBody | null> {
  const outcome = await epmc.fetch(epmc.identifiers);
  if (outcome.kind === "failed") {
    warnings.push("epmc_fulltext_failed");
    return null;
  }
  if (outcome.kind === "unavailable") return null;
  return {
    tier: "fulltext_epmc",
    text: outcome.extraction.text,
    truncated: false,
    attachmentKey: null,
    jatsAbstract: outcome.extraction.abstract,
    clean: null,
    structure: null,
    structureSkipped: null,
    jatsSections: outcome.extraction.sections,
  };
}

/** §13.1 recovery 1. Returns the normalized abstract, or `null`. */
async function tryRecovery<I>(
  item: I,
  recovery: AbstractRecovery<I>,
  minAbstractChars: number,
  warnings: WarningSink,
): Promise<string | null> {
  let fetched: string | null;
  try {
    fetched = await recovery.fetchAbstract(item);
  } catch (error) {
    rethrowIfFatal(error);
    warnings.push("abstract_recovery_failed");
    return null;
  }
  if (fetched === null) return null;
  const abstract = normalizeAbstract(fetched, minAbstractChars).text;
  if (abstract === null) return null;
  warnings.push("abstract_recovered");
  if (await recovery.consent.allowed()) {
    try {
      await recovery.writeBack(item, abstract);
      warnings.push("abstract_written_back");
    } catch (error) {
      rethrowIfFatal(error);
      warnings.push("abstract_write_back_failed");
    }
  }
  return abstract;
}

// ---------------------------------------------------------------------------
// Sections (docs/06 §4.3, P3-T21)
// ---------------------------------------------------------------------------

/**
 * §4.3's detector on the full-text body, with offsets into the final `text`
 * (the body follows the abstract preamble and a blank line when there is
 * one). Tiers 1 and 4 have no body and are never given to the detector.
 */
function detectBodySections(
  body: FullTextBody | null,
  abstract: string | null,
): SectionDetection & { readonly stats?: PdfDetectionStats } {
  if (body === null) return NO_SECTIONS;
  const offset = abstract === null ? 0 : abstract.length + 2;
  if (body.jatsSections !== null) {
    return detectSectionsFromJats(
      { sections: body.jatsSections, text: body.text },
      offset,
    );
  }
  return detectSectionsFromPdf(body.text, body.structure, offset);
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * Acquire the text to summarize for `item` (module note, "The ladder").
 *
 * Never throws for an extraction, fetch or recovery failure; a preference or
 * programming error and a cancellation still propagate.
 */
export async function acquireSource<
  I extends AcquirableItem,
  A extends AcquirableAttachment,
>(
  item: I,
  options: AcquireOptions<I>,
  port: FullTextPort<I, A>,
): Promise<AcquiredSource> {
  const warnings: WarningSink = [];
  const minAbstractChars = getPref("summaryMinAbstractChars");

  const rawAbstract = item.getField("abstractNote");
  let abstract = normalizeAbstract(
    typeof rawAbstract === "string" ? rawAbstract : "",
    minAbstractChars,
  ).text;

  let body: FullTextBody | null = null;
  if (options.includeFullText !== false) {
    const epmc = options.epmc;
    const jatsFirst = epmc !== undefined && getPref("fullTextPreferJATS");
    if (jatsFirst) body = await tryTier3(epmc, warnings);
    if (body === null) body = await tryTier2(item, port, warnings);
    if (body === null && epmc !== undefined && !jatsFirst) {
      body = await tryTier3(epmc, warnings);
    }
  }

  if (body?.tier === "fulltext_epmc" && abstract === null) {
    abstract =
      body.jatsAbstract === null
        ? null
        : normalizeAbstract(body.jatsAbstract, minAbstractChars).text;
  }

  if (body === null && abstract === null && options.recovery !== undefined) {
    abstract = await tryRecovery(
      item,
      options.recovery,
      minAbstractChars,
      warnings,
    );
  }

  let tier: SourceTier;
  let text: string;
  if (body !== null) {
    tier = body.tier;
    text = abstract === null ? body.text : `${abstract}\n\n${body.text}`;
  } else if (abstract !== null) {
    tier = "abstract";
    text = abstract;
  } else {
    tier = "metadata_only";
    text = "";
  }

  const detected = detectBodySections(body, abstract);
  const validated = options.imradDetectorValidated ?? IMRAD_DETECTOR_VALIDATED;
  const sections = validated
    ? detected
    : { ...detected, sections: [], sectionAware: false };

  const language = text === "" ? null : detectLanguage(text);
  if (language?.nonEnglish === true) {
    warnings.push(LANGUAGE_NON_ENGLISH_WARNING);
  }

  const { hash, fallback } = await hashAcquiredText(
    text,
    probeSubtleDigest(),
    port.md5Hex,
  );
  if (fallback) warnings.push("content_hash_md5");

  options.logger?.debug("summarize acquisition", {
    itemKey: item.key,
    tier,
    charCount: text.length,
    truncated: body?.truncated ?? false,
    nonLatinShare: language?.nonLatinShare ?? null,
    ...(body?.clean != null && {
      pages: body.clean.pages,
      runningHeadLinesRemoved: body.clean.runningHeadLinesRemoved,
      gutterPages: body.clean.gutterPages,
      referencesCut: body.clean.references.applied,
      referencesShare: body.clean.references.removedShare,
      supplementaryCharsRemoved: body.clean.supplementaryCharsRemoved,
      ocrWords: body.clean.ocr.words,
      ocrSplits: body.clean.ocr.splits,
      ocrSplitShare: body.clean.ocr.splitShare,
    }),
    sectionAware: sections.sectionAware,
    sectionAwareDetected: detected.sectionAware,
    imradDetectorValidated: validated,
    sectionsRecognized: detected.recognized,
    sectionLabels: detected.sections.map((s) => s.labels.join("+")).join(","),
    ...(body?.tier === "fulltext_pdf" && {
      structureSkipped: body.structureSkipped,
    }),
    ...(sections.stats !== undefined && {
      outlineEntries: sections.stats.outlineEntries,
      outlineAnchored: sections.stats.outlineAnchored,
      headingBlocks: sections.stats.headingBlocks,
      structureCandidates: sections.stats.structureCandidates,
      structureLocated: sections.stats.structureLocated,
      fallbackAdded: sections.stats.fallbackAdded,
    }),
    warnings: warnings.join(","),
  });

  return {
    itemKey: item.key,
    libraryID: item.libraryID,
    tier,
    abstract,
    sections: sections.sections,
    sectionAware: sections.sectionAware,
    text,
    charCount: text.length,
    estTokens: options.estimateTokens(text),
    truncated: body?.truncated ?? false,
    attachmentKey: body?.attachmentKey ?? null,
    contentHash: hash,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Tier 4 — the stub, and the gate that keeps it away from a model
// ---------------------------------------------------------------------------

/**
 * `docs/06` §3.5's stub: the `PaperSummary` v1 shape (§6.2) with every
 * analytical field empty and `confidence: "none"`. Typed here, field for
 * field against §6.3, because `src/` has no `PaperSummary` type yet (its home,
 * `docs/07` §5.2's `./paperSummarySchema`, is not created by any card so
 * far); every member is assignable to §6.3's.
 */
export interface MetadataOnlySummary {
  schemaVersion: "paper-summary-v1";
  itemKey: string;
  sourceTier: "metadata_only";
  confidence: "none";
  researchQuestion: null;
  studyDesign: { label: null; detail: null };
  population: { kind: null; description: null; size: null };
  methods: string[];
  keyFindings: never[];
  effectSizes: never[];
  limitations: string[];
  novelty: null;
  keywords: string[];
  researchTheme: null;
  citationWorthiness: { score: number; reason: string };
  notEnoughInformation: string[];
}

/** The §6.2 fields a stub cannot support, listed in `notEnoughInformation`. */
export const METADATA_ONLY_UNSUPPORTED_FIELDS: readonly string[] =
  Object.freeze([
    "researchQuestion",
    "studyDesign",
    "population",
    "methods",
    "keyFindings",
    "effectSizes",
    "limitations",
    "novelty",
    "researchTheme",
    "citationWorthiness",
  ]);

/** §6.2's `keywords` bounds. */
const MAX_KEYWORDS = 12;
const MAX_KEYWORD_CHARS = 60;

/**
 * Build §3.5's stub for a `metadata_only` source. No model is involved.
 *
 * @param source - an {@link AcquiredSource} whose tier is `metadata_only`
 * @param tags - the item's tags (§3.5 "item tags"), kept as `keywords`
 *   within §6.2's bounds: lowercased, 1–60 characters, at most 12, no repeats
 * @throws RangeError for any other tier — a stub must never stand in for text
 *   that exists
 */
export function buildMetadataOnlySummary(
  source: AcquiredSource,
  tags: readonly string[] = [],
): MetadataOnlySummary {
  if (source.tier !== "metadata_only") {
    throw new RangeError(
      `[research-helper] a metadata-only stub was asked for a ` +
        `${source.tier} source (docs/06 §3.5).`,
    );
  }
  const keywords: string[] = [];
  for (const tag of tags) {
    const keyword = tag.trim().toLowerCase();
    if (
      keyword === "" ||
      keyword.length > MAX_KEYWORD_CHARS ||
      keywords.includes(keyword)
    ) {
      continue;
    }
    keywords.push(keyword);
    if (keywords.length === MAX_KEYWORDS) break;
  }
  return {
    schemaVersion: "paper-summary-v1",
    itemKey: source.itemKey,
    sourceTier: "metadata_only",
    confidence: "none",
    researchQuestion: null,
    studyDesign: { label: null, detail: null },
    population: { kind: null, description: null, size: null },
    methods: [],
    keyFindings: [],
    effectSizes: [],
    limitations: [],
    novelty: null,
    keywords,
    researchTheme: null,
    citationWorthiness: { score: 0, reason: "" },
    notEnoughInformation: [...METADATA_ONLY_UNSUPPORTED_FIELDS],
  };
}

/** {@link summarizeOrStub}'s result. */
export type SummaryOrStub<S> =
  | { readonly kind: "stub"; readonly summary: MetadataOnlySummary }
  | { readonly kind: "summarized"; readonly summary: S };

/**
 * The structural guard of §3.5: a `metadata_only` source gets the stub and
 * `summarize` — the only path to a model — is not called at all.
 *
 * @param source - the acquired source
 * @param summarize - the caller's LLM path, for every other tier
 * @param tags - passed to {@link buildMetadataOnlySummary}
 */
export async function summarizeOrStub<S>(
  source: AcquiredSource,
  summarize: (source: AcquiredSource) => Promise<S>,
  tags: readonly string[] = [],
): Promise<SummaryOrStub<S>> {
  if (source.tier === "metadata_only") {
    return { kind: "stub", summary: buildMetadataOnlySummary(source, tags) };
  }
  return { kind: "summarized", summary: await summarize(source) };
}

// ---------------------------------------------------------------------------
// §13.1 recovery 1 — the consent gate and a lookup-based fetcher
// ---------------------------------------------------------------------------

/**
 * One consent per run (`docs/06` §13.1; NFR-20). `ask` is the caller's
 * question to the user — a dialog this card does not own — and is called at
 * most once however many items recover an abstract, concurrently or not. A
 * rejected `ask` counts as "no" and is not asked again.
 */
export function createRunWriteBackConsent(
  ask: () => Promise<boolean>,
): WriteBackConsent {
  let answer: Promise<boolean> | undefined;
  return {
    allowed() {
      answer ??= ask().then(
        (yes) => yes,
        () => false,
      );
      return answer;
    },
  };
}

/**
 * A {@link AbstractRecovery.fetchAbstract} over the registered sources'
 * `lookup` (`docs/07` §4.2). Each source with a `lookup` is asked, in the
 * order given, with the identifiers its `capabilities.lookupById` accepts;
 * the first non-empty `work.abstract` wins. A source that throws is skipped;
 * if every source asked threw, the last error is rethrown so the ladder
 * records `abstract_recovery_failed`.
 *
 * @param sources - the sources to ask, most preferred first
 * @param identifiers - the item's identifiers ({@link readItemIdentifiers})
 * @param ctx - cancellation and progress for the lookups
 */
export function createLookupAbstractFetcher<I>(
  sources: readonly Pick<LiteratureSource, "capabilities" | "lookup">[],
  identifiers: (item: I) => Partial<ExternalIds>,
  ctx: SourceCallContext,
): (item: I) => Promise<string | null> {
  return async (item) => {
    const ids = identifiers(item);
    let answered = 0;
    let lastError: unknown;
    for (const source of sources) {
      if (source.lookup === undefined) continue;
      const subset: Partial<Record<keyof ExternalIds, unknown>> = {};
      for (const key of source.capabilities.lookupById) {
        if (ids[key] !== undefined) subset[key] = ids[key];
      }
      if (Object.keys(subset).length === 0) continue;
      try {
        const records = await source.lookup(
          [subset as Partial<ExternalIds>],
          ctx,
        );
        answered += 1;
        const found = records.find(
          (record) => (record.work.abstract ?? "").trim() !== "",
        );
        if (found?.work.abstract !== undefined) return found.work.abstract;
      } catch (error) {
        rethrowIfFatal(error);
        lastError = error;
      }
    }
    if (answered === 0 && lastError !== undefined) throw lastError;
    return null;
  };
}

// ---------------------------------------------------------------------------
// The real platform
// ---------------------------------------------------------------------------

/** The Zotero item type `zoteroFullTextPort` works on, without naming the global. */
export type ZoteroAcquirableItem = Parameters<
  typeof zoteroFullTextPort.pickTextAttachment
>[0];

/** Anything with Zotero's `getField`. */
export interface FieldReader {
  getField(field: string): unknown;
}

function readField(item: FieldReader, field: string): string {
  try {
    const value = item.getField(field);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/**
 * The identifiers Tier 3 and §13.1 start from: the `DOI` field, then
 * `DOI:`, `PMID:` and `PMCID:` lines of `extra` (Zotero's own convention for
 * fields an item type lacks), each through its `model/ids.ts` normalizer.
 */
export function readItemIdentifiers(item: FieldReader): Partial<ExternalIds> {
  const extra = new Map<string, string>();
  for (const line of parseExtra(readField(item, "extra"))) {
    if (line.key !== undefined) extra.set(line.key.toLowerCase(), line.value);
  }
  const doi =
    normalizeDoi(readField(item, "DOI")) ?? normalizeDoi(extra.get("doi"));
  const pmid = normalizePmid(extra.get("pmid"));
  const pmcid = normalizePmcid(extra.get("pmcid"));
  return {
    ...(doi !== null && { doi }),
    ...(pmid !== null && { pmid }),
    ...(pmcid !== null && { pmcid }),
  };
}

/**
 * The installed `HttpClient`, by way of `httpRequest` — so Tier 3 shares the
 * Europe PMC adapter's per-host limiter and never opens a second pool.
 */
const SHARED_HTTP: Pick<HttpClient, "request"> = {
  request: (method, url, options) =>
    httpRequest({ method, url, ...(options ?? {}) }),
};

/** {@link acquireZoteroSource}'s options. */
export interface ZoteroAcquireOptions extends Omit<
  AcquireOptions<ZoteroAcquirableItem>,
  "epmc"
> {
  /** `false` never tries Tier 3. Default `true`. */
  readonly tryEuropePmc?: boolean;
  /** Cancels a Tier 3 request in flight. */
  readonly token?: CancellationToken | undefined;
}

/** {@link acquireSource} against the real platform, Tier 3 included. */
export function acquireZoteroSource(
  item: ZoteroAcquirableItem,
  options: ZoteroAcquireOptions,
): Promise<AcquiredSource> {
  const { tryEuropePmc, token, ...rest } = options;
  let epmc: EpmcTier3 | undefined;
  if (tryEuropePmc !== false) {
    const ids = readItemIdentifiers(item as unknown as FieldReader);
    epmc = {
      identifiers: { doi: ids.doi ?? null, pmcid: ids.pmcid ?? null },
      fetch: (identifiers) =>
        fetchEpmcFullText(identifiers, {
          http: SHARED_HTTP,
          ...(token !== undefined && { token }),
          ...(rest.logger !== undefined && { logger: rest.logger }),
        }),
    };
  }
  return acquireSource(item, { ...rest, epmc }, zoteroFullTextPort);
}
