/**
 * Identifier types and normalization.
 *
 * **Scope.** This is the `P0-T12` spike version: it carries only the `Doi` brand
 * and `normalizeDoi`, the smallest genuinely pure function Phase 1 needs anyway.
 * `P1-T01` rewrites this file as the shipped module — the full brand set
 * (`Pmid`, `Pmcid`, `ArxivId`, `S2CorpusId`, `OpenAlexId`), the `SourceId` /
 * `ProviderId` unions and `ExternalIds` of docs/07 §5.1. `plan/README.md` §4
 * names `src/model/ids.ts` as one of the sixteen paths where the later card's
 * `create` wins: nothing here is load-bearing.
 *
 * `model/` imports nothing but `model/` (docs/07 §2.3) and never references
 * `Zotero.*`; both are enforced by `eslint.config.js`.
 */

/** Branded string types so a DOI can never be passed where a PMID is expected. */
export type Doi = string & { readonly __brand: "Doi" }; // lowercase, no prefix

/**
 * Normalize a DOI to the single spelling this plugin stores, displays, keys on
 * and writes to Zotero.
 *
 * The body is docs/02 §11.1's reference implementation; the return type is
 * narrowed to the branded `Doi` of docs/07 §5.1, which is the form `P1-T01`
 * specifies. There is deliberately no second, original-spelling output: docs/02
 * §11.1 withdrew that instruction, docs/07 §5.1's `ExternalIds` has nowhere to
 * put it, §6.2 maps `ids.doi` straight into Zotero's `DOI` field, and docs/10
 * FR-6 requires the stored DOI be lowercase.
 *
 * @param raw - a DOI as some source spelled it, or nothing
 * @returns the normalized DOI, or `null` if `raw` is not a syntactic DOI
 */
export function normalizeDoi(raw: string | null | undefined): Doi | null {
  if (!raw) return null;
  let d = String(raw).trim();
  // Strip resolver prefixes and the doi: scheme (OpenAlex sends full URLs).
  d = d
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/^info:doi\//i, "");
  // Strip surrounding angle brackets / quotes seen in some deposits.
  d = d.replace(/^[<"']+|[>"']+$/g, "");
  // Trailing punctuation from text extraction.
  d = d.replace(/[.,;)\]]+$/, "");
  // DOIs are case-insensitive; lowercase for comparison.
  d = d.toLowerCase();
  // Percent-decode once (some sources over-encode the suffix).
  try {
    if (/%[0-9a-f]{2}/i.test(d)) d = decodeURIComponent(d);
  } catch {
    /* keep as-is */
  }
  return /^10\.\d{4,9}\/\S+$/.test(d) ? (d as Doi) : null;
}
