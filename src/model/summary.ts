/**
 * The summarizer's data: the acquisition result — `docs/06` §3.6 (`P3-T18`)
 * — and, since `P3-T25`, the payload `PaperSummary` (`docs/06` §6.3), the
 * persisted row `StoredSummary` (`docs/07` §5.2) and `deriveTldr`.
 *
 * `model/` imports nothing but `model/` (`docs/07` §2.3), so every type here
 * is plain data.
 */

import type { ProviderId } from "./ids";
import type { Usage } from "./usage";

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

/**
 * One labelled span of the body — `docs/06` §3.6 and its 2026-10-23
 * correction (`P3-T21`).
 */
export interface AcquiredSection {
  /** The first of {@link AcquiredSection.labels}. */
  readonly imrad: ImradSection;
  /**
   * Every label, in `docs/06` §4.3's table order; never empty. A combined
   * "Results and Discussion" heading carries `["results", "discussion"]`.
   */
  readonly labels: readonly ImradSection[];
  /** The heading as found; `""` for the text before the first heading. */
  readonly heading: string;
  /** `AcquiredSource.text.slice(start, end)`, the heading included. */
  readonly text: string;
  /** UTF-16 offset of the section's first character in `AcquiredSource.text`. */
  readonly start: number;
  /** UTF-16 offset one past the section's last character. */
  readonly end: number;
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
  /**
   * Sectioned body (`docs/06` §4.3, `P3-T21`); empty on Tiers 1 and 4 and
   * whenever the detector declared failure. The abstract preamble is never a
   * section.
   */
  readonly sections: readonly AcquiredSection[];
  /**
   * `docs/06` §4.3: `true` only when at least two IMRaD sections were
   * recognized in the body. When `false`, nothing downstream may claim
   * section provenance.
   */
  readonly sectionAware: boolean;
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

// ===========================================================================
// `PaperSummary` — `docs/06` §6.3, transcribed (`P3-T25`)
// ===========================================================================
//
// `docs/06` §6.3 owns the payload and `docs/07` §5.2 the row around it. No
// card creates `docs/07` §5.2's `./paperSummarySchema`, so the payload is
// declared here, field for field against §6.3 (`docs/07` §5.2's note of
// 2026-10-28). A new field goes into `docs/06` §6.2 first, with the MAJOR
// prompt-version bump `docs/12` §17.2 requires — never only here.

/** `docs/06` §6.3: the payload's schema version, the schema file's `const`. */
export const PAPER_SUMMARY_SCHEMA_VERSION = "paper-summary-v1" as const;

export type Confidence = "high" | "medium" | "low" | "none";

export type StudyDesignLabel =
  | "randomized_controlled_trial"
  | "non_randomized_trial"
  | "prospective_cohort"
  | "retrospective_cohort"
  | "case_control"
  | "cross_sectional"
  | "case_series"
  | "case_report"
  | "systematic_review"
  | "meta_analysis"
  | "scoping_review"
  | "narrative_review"
  | "in_vitro"
  | "in_vivo_animal"
  | "ex_vivo"
  | "computational_simulation"
  | "method_development"
  | "benchmark_study"
  | "retrospective_database_analysis"
  | "qualitative_study"
  | "protocol"
  | "editorial_or_commentary"
  | "other";

export type PopulationKind =
  | "human"
  | "animal"
  | "cell_line"
  | "tissue"
  | "microbial"
  | "dataset"
  | "corpus"
  | "simulation"
  | "mixed"
  | "not_applicable";

export interface KeyFinding {
  statement: string;
  direction: "positive" | "negative" | "null_result" | "mixed" | "descriptive";
  evidenceStrength: "strong" | "moderate" | "weak" | "unclear";
  /** Verbatim span from the source text; enables the substring grounding check (§12.1). */
  verbatimSupport: string | null;
}

export interface EffectSize {
  metric: string;
  /** Verbatim, never recomputed. */
  value: string;
  comparison?: string | null;
  pValue?: string | null;
  unit?: string | null;
}

/** `docs/06` §6.3's `PaperSummary`: the model's output payload, v1. */
export interface PaperSummary {
  schemaVersion: typeof PAPER_SUMMARY_SCHEMA_VERSION;
  itemKey: string;
  sourceTier: SourceTier;
  confidence: Confidence;

  researchQuestion: string | null;
  studyDesign: { label: StudyDesignLabel | null; detail: string | null };
  population: {
    kind: PopulationKind | null;
    description: string | null;
    size: string | null;
  };
  methods: string[];
  keyFindings: KeyFinding[];
  effectSizes: EffectSize[];
  limitations: string[];
  novelty: string | null;
  keywords: string[];
  researchTheme: string | null;
  citationWorthiness: { score: number; reason: string };

  openQuestions?: string[];
  contradictsOrChallenges?: string | null;
  notEnoughInformation?: string[];
}

// ===========================================================================
// `StoredSummary` — `docs/07` §5.2 (`P3-T25`)
// ===========================================================================

/**
 * `RedactionMark`'s members (`src/core/provenance.ts`), declared here because
 * `model/` imports nothing but `model/` (`docs/07` §2.3). Added 2026-10-28.
 */
export interface StoredRedactionMark {
  readonly partlyRedacted: boolean;
  readonly redactedStrings: number;
  readonly droppedFields: number;
}

/** What the model was shown (`docs/07` §5.2). */
export type SummaryInputScope =
  | { readonly kind: "metadata-only" }
  | { readonly kind: "abstract" }
  | {
      readonly kind: "abstract+fulltext";
      readonly charsSent: number;
      readonly chunks: number;
    }
  | { readonly kind: "abstract+notes"; readonly noteCount: number };

/** The prompts whose answer is a stored payload (`docs/07` §5.2, corrected 2026-10-28). */
export type StoredSummaryPromptId =
  "PAPER_SUMMARY_ABSTRACT" | "PAPER_SUMMARY_FULLTEXT" | "CHUNK_REDUCE";

/**
 * `docs/07` §5.2's persisted row: one {@link PaperSummary} with its identity,
 * provenance and input-scope envelope. The only envelope around a
 * `PaperSummary`; no third summary shape may be added. Readings of the
 * members are `docs/07` §5.2's note of 2026-10-28.
 */
export interface StoredSummary {
  /**
   * `${workKey}:${promptVersion}:${modelId}` — the row's identity in the
   * `summary` table, and **not** the cache key (`summaryKey`, `docs/07`
   * §9.1, keys strictly more).
   */
  readonly id: string;
  readonly workKey: string;
  /** Zotero item key this summary is attached to, once written. */
  readonly zoteroItemKey?: string;

  /** The model's output, exactly as `docs/06` §6.2 defines it. Never widened here. */
  readonly content: PaperSummary;

  /** What the model was actually shown — critical for privacy auditing. */
  readonly inputScope: SummaryInputScope;
  /** Which prompt produced `content`. Semantics owned by `docs/06` §7. */
  readonly promptId: StoredSummaryPromptId;
  readonly promptVersion: string;
  readonly providerId: ProviderId;
  readonly modelId: string;
  /** Sampling temperature actually used; also a `summaryKey` component. */
  readonly temperature: number;
  readonly usage: Usage | undefined;
  readonly generatedAtEpochMs: number;
  /** Zotero item `dateModified` at generation time; drives invalidation. */
  readonly sourceItemVersion: string | undefined;
  /** SHA-256 of the text actually sent — not of the file, not `dateModified`. */
  readonly contentHash: string;
  /** The text was cut to fit the chunk budget or the page cap before it was sent. */
  readonly truncated: boolean;
  /**
   * Fraction of `content.keyFindings` whose `verbatimSupport` was found in
   * the source text; `undefined` when the check did not run or had nothing
   * to check (`docs/06` §12.1's note of 2026-10-28).
   */
  readonly groundingScore: number | undefined;
  readonly warnings: readonly string[];
  /** What the redaction gate changed in this row (`docs/07` §5.2, 2026-10-28). */
  readonly redaction: StoredRedactionMark;
}

// ===========================================================================
// `deriveTldr` — `docs/07` §5.2
// ===========================================================================

/**
 * Short gist for list and card rendering (`docs/08` §3.3). Pure function of
 * `PaperSummary`; recomputed on every render, never persisted, never sent to a
 * model. First non-empty wins: the first key finding's statement, the first
 * sentence of the research question, the research theme. `""` when all three
 * are empty, so the card shows its empty state rather than a made-up sentence.
 *
 * @param content - the stored payload
 * @returns the gist, trimmed; `""` when there is none
 */
export function deriveTldr(content: PaperSummary): string {
  const finding = content.keyFindings[0]?.statement.trim() ?? "";
  if (finding !== "") return finding;
  const question = content.researchQuestion?.trim() ?? "";
  if (question !== "") {
    const sentence = /^.*?[.!?](?=\s|$)/su.exec(question)?.[0] ?? question;
    return sentence.trim();
  }
  return content.researchTheme?.trim() ?? "";
}
