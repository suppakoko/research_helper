/**
 * Deduplication engine — `docs/02-literature-database-apis.md` §11.
 *
 * **Scope.** `P2-T09`. Two `SourceRecord`s that are the same work are matched
 * on an identifier where one exists (§11.3 Tiers 0–4), matched conservatively
 * on title + author + year where none does (Tiers 5–6, §11.3.2–§11.3.3), and
 * **flagged rather than merged** below the confidence threshold (`docs/10`
 * FR-50 scenario 4, `docs/11` §3 R-18). A known preprint ↔ published relation
 * is a **link**, never a merge (Tier 7, §11.4).
 *
 * **What this module decides and what it does not.** It produces a
 * {@link DedupDecision} per compared pair and, over a result set, the
 * {@link DedupResult} partition of records into same-work groups plus the
 * pairs flagged for review and the pairs linked as related versions. It does
 * **not** merge fields (`P2-T10`, `model/merge.ts`), does not harvest the
 * §11.4 version-link signals from adapters (`P2-T11`), and does not touch
 * Zotero: the §11.6 library index is built from plain field values that the
 * `zotero/` layer extracts, because `sources/` may not import `zotero/`
 * (`docs/07` §2.3).
 *
 * **Verdicts.** `"match"` is the only verdict that joins two records into one
 * group; {@link dedupeRecords} unions on nothing else. `"link"` and `"flag"`
 * are reported as pairs and leave both records in the output. `"distinct"` is
 * silent.
 *
 * **Identifiers are keys, never stored values.** The normalizers of
 * `model/ids.ts` are applied to build dictionary keys; no record is rewritten.
 * `docs/02` §11.1 withdrew its "keep the original DOI spelling" instruction,
 * `docs/07` §5.1 brands `Doi` as the lowercase form and `docs/10` FR-6 requires
 * it, so there is nothing for this module to preserve: the branded ids on a
 * record already are the stored form.
 *
 * **Thresholds** live in §1 as exported constants, because `docs/02` §11.3.3
 * says to tune them against a real library and `P2-T13` is the card that does
 * it. Nothing below compares against a literal.
 */

import { createSystemClock } from "../../core/clock";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { WorkType } from "../../model/canonicalWork";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
  type ArxivId,
  type Doi,
  type Pmcid,
  type Pmid,
  type S2CorpusId,
} from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";

// ---------------------------------------------------------------------------
// 1. Thresholds and confidences — docs/02 §11.3 and §11.3.3, every one named
//
// `P2-T13` tunes these against the labelled corpus; the algorithm below reads
// them and never a literal, so tuning is a one-line diff here.
// ---------------------------------------------------------------------------

/** §11.3.3 row 1: `levSim ≥ 0.95` and `|Δyear| ≤ 1` → duplicate. */
export const LEVSIM_DUPLICATE_THRESHOLD = 0.95;

/** §11.3.3 row 2: `levSim ≥ 0.88` with Jaccard, first author and year. */
export const LEVSIM_CORROBORATED_THRESHOLD = 0.88;

/** §11.3.3 row 2: `jaccard ≥ 0.80` alongside the corroborated Levenshtein. */
export const JACCARD_CORROBORATED_THRESHOLD = 0.8;

/** §11.3.3 row 3: `jaccard ≥ 0.90` with first author and same year. */
export const JACCARD_REORDER_THRESHOLD = 0.9;

/** §11.3.3 row 4: `levSim ≥ 0.80` and nothing else → flag, never merge. */
export const LEVSIM_FLAG_THRESHOLD = 0.8;

/** §11.3 Tier 5 and §11.3.3 rows 1–2: the year tolerance, `|Δyear| ≤ 1`. */
export const MAX_YEAR_DELTA = 1;

/**
 * §11.3.3 guard 1: titles with fewer normalized tokens than this never reach
 * the title tiers — `"Retraction"`, `"Editorial"`, `"Correction"` need an id.
 */
export const MIN_FUZZY_TITLE_TOKENS = 5;

/** §11.3.3 blocking: the number of longest title tokens in a block signature. */
export const SIGNATURE_TOKEN_COUNT = 3;

/**
 * Confidence of each decision kind, from the §11.3 tier table (Tiers 0–5 and
 * 7), §11.3.3's `0.80–0.94` band for the three Tier 6 duplicate rows, §11.2
 * for the bioRxiv accession secondary key, and §11.4's `0.75 → flag` row for a
 * title match between a preprint and a non-preprint.
 */
export const TIER_CONFIDENCE = Object.freeze({
  doi: 1,
  biorxivAccession: 0.99,
  pmid: 1,
  pmcid: 1,
  arxiv: 0.99,
  s2: 0.99,
  titleExact: 0.95,
  fuzzyLevenshtein: 0.92,
  fuzzyCorroborated: 0.88,
  fuzzyReordered: 0.85,
  versionLink: 1,
  preprintPairFlag: 0.75,
});

/**
 * §11.3.3 guard 2: a trailing roman numeral or digit, optionally preceded by
 * `part`, on a normalized title. Two titles whose markers differ are a series
 * (`"… Part II"` vs `"… Part III"`, which Levenshtein rates ~0.97) and are
 * forced distinct.
 */
export const SERIES_SUFFIX_PATTERN = /\b(part\s+)?([ivxlc]+|\d+)$/;

// ---------------------------------------------------------------------------
// 2. Preprint DOI prefixes — docs/02 §11.2
//
// Future home: `P2-T08`'s `src/sources/shared/preprintServers.ts`, which did
// not exist when this card ran (`plan/README.md` §5 rule 2 forbids creating
// it from here). When `P2-T08` lands, that module owns the set and this one
// imports it. Until then the set is declared here, as a set, so that nothing
// in the dedup path tests a single prefix: §11.2 — bioRxiv/medRxiv mint under
// both `10.1101/` and `10.64898/`, and the prefix does not tell the servers
// apart.
// ---------------------------------------------------------------------------

/**
 * `docs/02` §11.2's prefix set: bioRxiv-legacy, bioRxiv/medRxiv-current,
 * arXiv, Research Square, SSRN. Membership is a weak corroborating signal
 * only; server detection is the publisher field's job (`P2-T08`).
 */
export const PREPRINT_DOI_PREFIXES: ReadonlySet<string> = new Set([
  "10.1101/",
  "10.64898/",
  "10.48550/",
  "10.21203/",
  "10.2139/",
]);

/**
 * The two prefixes under which bioRxiv and medRxiv mint the *same* accession
 * (`docs/02` §11.2 implication 2: the suffix is the stable accession across
 * both). A DOI pair sharing a suffix under these prefixes is the secondary
 * key of Tier 0.
 */
export const BIORXIV_ACCESSION_PREFIXES: ReadonlySet<string> = new Set([
  "10.1101/",
  "10.64898/",
]);

/** The registrant prefix of a normalized DOI, slash included: `"10.1101/"`. */
export function doiPrefix(doi: string): string {
  return doi.slice(0, doi.indexOf("/") + 1);
}

/** Is `doi`'s prefix in the §11.2 preprint set? A hint, not a server id. */
export function isPreprintDoi(doi: string): boolean {
  return PREPRINT_DOI_PREFIXES.has(doiPrefix(doi));
}

/**
 * The bioRxiv/medRxiv accession a DOI carries, or `undefined` when its prefix
 * is not one of {@link BIORXIV_ACCESSION_PREFIXES}.
 */
export function biorxivAccession(doi: Doi | undefined): string | undefined {
  if (doi === undefined) return undefined;
  const prefix = doiPrefix(doi);
  if (!BIORXIV_ACCESSION_PREFIXES.has(prefix)) return undefined;
  const suffix = doi.slice(prefix.length);
  return suffix.length > 0 ? suffix : undefined;
}

// ---------------------------------------------------------------------------
// 3. Text normalization — docs/02 §11.3.2, verbatim
// ---------------------------------------------------------------------------

/**
 * `docs/02` §11.3.2's `normalizeTitle`, transformation for transformation:
 * NFKD, drop combining marks, lowercase, JATS/HTML tags, entities, unicode
 * dashes, smart quotes, punctuation to space, whitespace collapse, trim, and
 * PubMed's trailing period. The character classes are spelled as escapes
 * because the document's literal glyphs do not survive every editor.
 *
 * The final `.replace(/\.$/, "")` is kept although the punctuation pass
 * before it has already removed every period: §11.3.2 is transcribed
 * verbatim, and the real case it names — PubMed's `"… network biology."`
 * against Semantic Scholar's `"… network biology"` — is pinned by a test.
 */
export function normalizeTitle(t: string): string {
  return t
    .normalize("NFKD") // decompose accents
    .replace(/[̀-ͯ]/g, "") // drop combining marks
    .toLowerCase()
    .replace(/<[^>]+>/g, " ") // JATS/HTML tags from Crossref & PubMed
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ") // entities
    .replace(/[‐-―−]/g, "-") // unicode dashes → hyphen
    .replace(/[‘’“”]/g, "'") // smart quotes
    .replace(/[^a-z0-9]+/g, " ") // all punctuation → space
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, ""); // PubMed's trailing period
}

/** The word tokens of a normalized title; empty for an empty title. */
export function titleTokens(normalizedTitle: string): readonly string[] {
  return normalizedTitle.length === 0 ? [] : normalizedTitle.split(" ");
}

/**
 * A family name reduced to the letters that survive §11.3.2's treatment:
 * accents dropped, lowercased, everything but `a–z` removed. `"Müller"`,
 * `"MULLER"` and `"Muller"` compare equal; `"van der Berg"` becomes
 * `"vanderberg"`. `undefined` when nothing is left.
 */
export function normalizeFamilyName(
  family: string | undefined,
): string | undefined {
  if (family === undefined) return undefined;
  const letters = family
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return letters.length > 0 ? letters : undefined;
}

/**
 * §11.3.3's blocking signature: the {@link SIGNATURE_TOKEN_COUNT} longest
 * distinct tokens of a normalized title, ties broken alphabetically, joined
 * in alphabetical order. `undefined` for a title too short to reach the title
 * tiers at all ({@link MIN_FUZZY_TITLE_TOKENS}), so such a title is never
 * bucketed and never compared on text.
 */
export function blockingSignature(
  tokens: readonly string[],
): string | undefined {
  if (tokens.length < MIN_FUZZY_TITLE_TOKENS) return undefined;
  const longest = [...new Set(tokens)]
    .sort((x, y) => y.length - x.length || (x < y ? -1 : x > y ? 1 : 0))
    .slice(0, SIGNATURE_TOKEN_COUNT)
    .sort();
  return longest.join(" ");
}

/** A normalized title split at its §11.3.3 series marker, if it has one. */
export function splitSeriesMarker(normalizedTitle: string): {
  readonly stem: string;
  readonly marker: string | undefined;
} {
  const m = SERIES_SUFFIX_PATTERN.exec(normalizedTitle);
  if (m === null || m[2] === undefined) {
    return { stem: normalizedTitle, marker: undefined };
  }
  return { stem: normalizedTitle.slice(0, m.index).trim(), marker: m[2] };
}

// ---------------------------------------------------------------------------
// 4. Similarity — docs/02 §11.3.3's two measures
// ---------------------------------------------------------------------------

/**
 * Levenshtein edit distance, the standard two-row dynamic programme,
 * `O(|a|·|b|)` time and `O(|b|)` space. Only ever called inside a block —
 * see {@link dedupeRecords} — never over a whole set.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr: number[] = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

/**
 * Normalized Levenshtein similarity in `[0, 1]`: `1 - d / max(|a|, |b|)`.
 * Catches typos, OCR noise and missing subtitles. Two empty strings are 1.
 */
export function levSim(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Jaccard similarity over word tokens: `|A ∩ B| / |A ∪ B|`. Catches
 * reordering and word-level insertions. Two empty token lists are 1.
 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 1 : inter / union;
}

// ---------------------------------------------------------------------------
// 5. Candidates — a record or a library item reduced to what the cascade reads
// ---------------------------------------------------------------------------

/**
 * The identifiers the cascade compares, each re-run through its `model/ids`
 * normalizer so that a spelling variance upstream becomes one dictionary key.
 * `url` and `openAlexId` are not matching keys (§11.3 has no tier for them).
 */
export interface NormalizedIds {
  readonly doi: Doi | undefined;
  readonly pmid: Pmid | undefined;
  readonly pmcid: Pmcid | undefined;
  readonly arxivId: ArxivId | undefined;
  readonly s2CorpusId: S2CorpusId | undefined;
}

/** The id kinds that have a cascade tier, in §11.3 tier order. */
export const ID_KINDS: readonly (keyof NormalizedIds)[] = [
  "doi",
  "pmid",
  "pmcid",
  "arxivId",
  "s2CorpusId",
];

/**
 * What the cascade reads about one record or one library item. Built once
 * per record by {@link toCandidate}; every field below is a key or a score
 * input and none is ever written back to the record.
 */
export interface DedupCandidate {
  /** `SourceRecord.id`, or `zotero:<itemID>` for a library item. */
  readonly key: string;
  readonly ids: NormalizedIds;
  /** bioRxiv/medRxiv accession when the DOI prefix is one of theirs. */
  readonly accession: string | undefined;
  /** {@link normalizeTitle} of the record's title. */
  readonly title: string;
  readonly tokens: readonly string[];
  /** {@link blockingSignature}; `undefined` when the title is too short. */
  readonly signature: string | undefined;
  readonly year: number | undefined;
  /** {@link normalizeFamilyName} of the first author's family name. */
  readonly firstAuthor: string | undefined;
  /** {@link normalizeTitle} of the container title (journal), if known. */
  readonly container: string | undefined;
  readonly type: WorkType | undefined;
  /** `CanonicalWork.relatedVersionIds`, normalized — Tier 7's input. */
  readonly relatedVersionIds: NormalizedIds | undefined;
}

/**
 * Identifier spellings as a source, a Zotero field or an `extra` line gave
 * them. `Partial<ExternalIds>` is assignable here because every brand is a
 * string; so is a bag of raw `getField` strings.
 */
export interface RawIds {
  readonly doi?: string | null | undefined;
  readonly pmid?: string | null | undefined;
  readonly pmcid?: string | null | undefined;
  readonly arxivId?: string | null | undefined;
  readonly s2CorpusId?: string | null | undefined;
}

/**
 * `docs/02` §11.3.1 defines no S2 normalizer and `docs/07` §5.1 brands
 * `S2CorpusId` without a shape comment, so the key is the trimmed string.
 */
function normalizeS2CorpusId(
  raw: string | null | undefined,
): S2CorpusId | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  return s.length > 0 ? (s as S2CorpusId) : undefined;
}

/** Run every id through its normalizer; absent and malformed both → undefined. */
export function normalizeIds(ids: RawIds | undefined): NormalizedIds {
  return {
    doi: normalizeDoi(ids?.doi) ?? undefined,
    pmid: normalizePmid(ids?.pmid) ?? undefined,
    pmcid: normalizePmcid(ids?.pmcid) ?? undefined,
    arxivId: normalizeArxivId(ids?.arxivId) ?? undefined,
    s2CorpusId: normalizeS2CorpusId(ids?.s2CorpusId),
  };
}

/** Does `ids` carry at least one matching key? */
function hasAnyId(ids: NormalizedIds | undefined): boolean {
  return ids !== undefined && ID_KINDS.some((k) => ids[k] !== undefined);
}

/** Reduce a `SourceRecord` to its {@link DedupCandidate}. Pure; no mutation. */
export function toCandidate(record: SourceRecord): DedupCandidate {
  const work = record.work;
  const ids = normalizeIds(work.ids);
  const title = normalizeTitle(work.title);
  const tokens = titleTokens(title);
  const container =
    work.containerTitle === undefined
      ? undefined
      : normalizeTitle(work.containerTitle) || undefined;
  const related =
    work.relatedVersionIds === undefined
      ? undefined
      : normalizeIds(work.relatedVersionIds);
  return {
    key: record.id,
    ids,
    accession: biorxivAccession(ids.doi),
    title,
    tokens,
    signature: blockingSignature(tokens),
    year: work.publishedDate?.year ?? work.onlineDate?.year,
    firstAuthor: normalizeFamilyName(work.authors[0]?.family),
    container,
    type: work.type,
    relatedVersionIds: hasAnyId(related) ? related : undefined,
  };
}

// ---------------------------------------------------------------------------
// 6. The cascade — docs/02 §11.3, an ordered, data-driven tier list
// ---------------------------------------------------------------------------

export type DedupVerdict = "match" | "link" | "flag" | "distinct";

/** One tier of §11.3's table, named rather than numbered so evidence reads. */
export type DedupTierId =
  | "doi"
  | "pmid"
  | "pmcid"
  | "arxiv"
  | "s2"
  | "title-exact"
  | "title-fuzzy"
  | "version-link";

/** Flat, serializable facts behind a decision — FR-50 scenario 2's record. */
export type DedupEvidence = Readonly<Record<string, string | number | boolean>>;

export interface DedupDecision {
  readonly verdict: DedupVerdict;
  /** The tier that decided; `null` only for `"distinct"`. */
  readonly tier: DedupTierId | null;
  /**
   * For a `"match"` or `"link"`: the tier's confidence from
   * {@link TIER_CONFIDENCE}. For a `"flag"`: the title similarity that raised
   * it (so a reviewer can sort), or {@link TIER_CONFIDENCE}'s
   * `preprintPairFlag`. `0` for `"distinct"`.
   */
  readonly confidence: number;
  readonly evidence: DedupEvidence;
}

/** Scratch state shared by the tiers of one comparison. */
interface TierContext {
  /** Id kinds present on both sides with different values (§11.5 rule 1). */
  readonly conflicts: (keyof NormalizedIds)[];
}

export interface DedupTier {
  readonly id: DedupTierId;
  /** The row number in `docs/02` §11.3's table. */
  readonly docTier: number;
  /** `null` means "this tier has nothing to say; try the next". */
  run(
    a: DedupCandidate,
    b: DedupCandidate,
    ctx: TierContext,
  ): DedupDecision | null;
}

function decide(
  verdict: DedupVerdict,
  tier: DedupTierId | null,
  confidence: number,
  evidence: DedupEvidence,
): DedupDecision {
  return { verdict, tier, confidence, evidence };
}

/** `|Δyear|`, or `undefined` when either side has no year. */
export function yearDelta(
  a: DedupCandidate,
  b: DedupCandidate,
): number | undefined {
  if (a.year === undefined || b.year === undefined) return undefined;
  return Math.abs(a.year - b.year);
}

function withinYearTolerance(delta: number | undefined): boolean {
  return delta !== undefined && delta <= MAX_YEAR_DELTA;
}

function sameFirstAuthor(a: DedupCandidate, b: DedupCandidate): boolean {
  return (
    a.firstAuthor !== undefined &&
    b.firstAuthor !== undefined &&
    a.firstAuthor === b.firstAuthor
  );
}

function containersDiffer(a: DedupCandidate, b: DedupCandidate): boolean {
  return (
    a.container !== undefined &&
    b.container !== undefined &&
    a.container !== b.container
  );
}

/** §11.3.3 guard 1: may this candidate be compared on its title at all? */
export function isTitleComparable(c: DedupCandidate): boolean {
  return c.tokens.length >= MIN_FUZZY_TITLE_TOKENS;
}

/** §11.3.3 guard 2: do the two titles end in different series markers? */
export function seriesMarkersDiffer(
  a: DedupCandidate,
  b: DedupCandidate,
): boolean {
  const sa = splitSeriesMarker(a.title);
  const sb = splitSeriesMarker(b.title);
  if (sa.marker === sb.marker) return false;
  if (sa.marker !== undefined && sb.marker !== undefined) return true;
  return sa.stem === sb.stem;
}

/** Tier 7's input: does either side name the other as a related version? */
export function isKnownVersionLink(
  a: DedupCandidate,
  b: DedupCandidate,
): boolean {
  const names = (x: DedupCandidate, y: DedupCandidate): boolean =>
    x.relatedVersionIds !== undefined &&
    ID_KINDS.some((k) => {
      const v = x.relatedVersionIds?.[k];
      return v !== undefined && v === y.ids[k];
    });
  return names(a, b) || names(b, a);
}

/** §11.4's derived signal: exactly one side is a preprint. */
export function isPreprintPair(a: DedupCandidate, b: DedupCandidate): boolean {
  return a.type !== b.type && (a.type === "preprint" || b.type === "preprint");
}

/**
 * The three §11.3.3 false-positive guards, §11.5 rule 1 and §11.4, applied
 * to a provisional title-tier verdict. Order matters and is deliberate:
 * a series difference is proof of distinctness and wins over everything; a
 * known version link is a certain relation and wins over any text score; the
 * remaining guards only ever *lower* a provisional `"match"`.
 */
function guardTitleVerdict(
  a: DedupCandidate,
  b: DedupCandidate,
  provisional: DedupDecision,
  ctx: TierContext,
): DedupDecision {
  const { tier, confidence, evidence } = provisional;
  if (seriesMarkersDiffer(a, b)) {
    return decide("distinct", tier, 0, {
      ...evidence,
      seriesMarkersDiffer: true,
    });
  }
  if (isKnownVersionLink(a, b)) {
    return decide("link", "version-link", TIER_CONFIDENCE.versionLink, {
      ...evidence,
      knownVersionLink: true,
    });
  }
  const delta = yearDelta(a, b);
  const yearDiffers = delta !== undefined && delta !== 0;
  if (provisional.verdict === "match") {
    if (ctx.conflicts.length > 0) {
      // §11.5 rule 1: a title match with conflicting ids is evidence the
      // records are not duplicates. Downgrade; `P2-T11` logs it.
      return decide("link", tier, confidence, {
        ...evidence,
        conflictingIds: ctx.conflicts.join(","),
      });
    }
    if (isPreprintPair(a, b)) {
      // §11.4's last row: a title match across the preprint boundary is a
      // 0.75 flag, never a merge and (that row says) not a link either.
      return decide("flag", tier, TIER_CONFIDENCE.preprintPairFlag, {
        ...evidence,
        preprintPair: true,
      });
    }
  }
  if (
    (provisional.verdict === "match" || a.title === b.title) &&
    yearDiffers &&
    containersDiffer(a, b)
  ) {
    // §11.3.3 guard 3: same title, different year, different journal is
    // almost always a conference paper later extended. Link, don't merge.
    return decide("link", tier, confidence, {
      ...evidence,
      containerDiffers: true,
    });
  }
  if (ctx.conflicts.length > 0) {
    return decide(provisional.verdict, tier, confidence, {
      ...evidence,
      conflictingIds: ctx.conflicts.join(","),
    });
  }
  return provisional;
}

/** Tiers 1–4: one exact-identifier tier. Equal → match; both present and unequal → conflict. */
function identifierTier(
  id: DedupTierId,
  docTier: number,
  kind: keyof NormalizedIds,
  confidence: number,
): DedupTier {
  return {
    id,
    docTier,
    run(a, b, ctx) {
      const x = a.ids[kind];
      const y = b.ids[kind];
      if (x === undefined || y === undefined) return null;
      if (x === y) return decide("match", id, confidence, { [kind]: x });
      ctx.conflicts.push(kind);
      return null;
    },
  };
}

/** Tier 0: exact normalized DOI, with §11.2's accession suffix as secondary key. */
const DOI_TIER: DedupTier = {
  id: "doi",
  docTier: 0,
  run(a, b, ctx) {
    const x = a.ids.doi;
    const y = b.ids.doi;
    if (x === undefined || y === undefined) return null;
    if (x === y) return decide("match", "doi", TIER_CONFIDENCE.doi, { doi: x });
    if (a.accession !== undefined && a.accession === b.accession) {
      return decide("match", "doi", TIER_CONFIDENCE.biorxivAccession, {
        rule: "biorxiv-accession",
        accession: a.accession,
      });
    }
    ctx.conflicts.push("doi");
    return null;
  },
};

/** Tier 5: normalized title exact and `|Δyear| ≤ 1`. */
const TITLE_EXACT_TIER: DedupTier = {
  id: "title-exact",
  docTier: 5,
  run(a, b, ctx) {
    if (!isTitleComparable(a) || !isTitleComparable(b)) return null;
    if (a.title !== b.title) return null;
    const delta = yearDelta(a, b);
    const evidence: DedupEvidence = {
      titleExact: true,
      yearDelta: delta ?? "unknown",
    };
    const provisional = withinYearTolerance(delta)
      ? decide("match", "title-exact", TIER_CONFIDENCE.titleExact, evidence)
      : // Same title but the year is missing or too far apart: nothing
        // corroborates, so §11.3.3's flag row applies with similarity 1.
        decide("flag", "title-exact", 1, evidence);
    return guardTitleVerdict(a, b, provisional, ctx);
  },
};

/** Tier 6: the §11.3.3 threshold table over `levSim` and `jaccard`. */
const TITLE_FUZZY_TIER: DedupTier = {
  id: "title-fuzzy",
  docTier: 6,
  run(a, b, ctx) {
    if (!isTitleComparable(a) || !isTitleComparable(b)) return null;
    if (a.title === b.title) return null; // Tier 5 has already spoken.
    const lev = levSim(a.title, b.title);
    const jac = jaccard(a.tokens, b.tokens);
    const delta = yearDelta(a, b);
    const author = sameFirstAuthor(a, b);
    const evidence: DedupEvidence = {
      levSim: lev,
      jaccard: jac,
      yearDelta: delta ?? "unknown",
      firstAuthorMatches: author,
    };
    let provisional: DedupDecision;
    if (lev >= LEVSIM_DUPLICATE_THRESHOLD && withinYearTolerance(delta)) {
      provisional = decide(
        "match",
        "title-fuzzy",
        TIER_CONFIDENCE.fuzzyLevenshtein,
        { ...evidence, rule: "levenshtein" },
      );
    } else if (
      lev >= LEVSIM_CORROBORATED_THRESHOLD &&
      jac >= JACCARD_CORROBORATED_THRESHOLD &&
      author &&
      withinYearTolerance(delta)
    ) {
      provisional = decide(
        "match",
        "title-fuzzy",
        TIER_CONFIDENCE.fuzzyCorroborated,
        { ...evidence, rule: "corroborated" },
      );
    } else if (jac >= JACCARD_REORDER_THRESHOLD && author && delta === 0) {
      provisional = decide(
        "match",
        "title-fuzzy",
        TIER_CONFIDENCE.fuzzyReordered,
        { ...evidence, rule: "reordered" },
      );
    } else if (lev >= LEVSIM_FLAG_THRESHOLD) {
      provisional = decide("flag", "title-fuzzy", lev, {
        ...evidence,
        rule: "flag",
      });
    } else {
      return null;
    }
    return guardTitleVerdict(a, b, provisional, ctx);
  },
};

/** Tier 7: a known preprint ↔ published relation is a link, never a merge. */
const VERSION_LINK_TIER: DedupTier = {
  id: "version-link",
  docTier: 7,
  run(a, b) {
    if (!isKnownVersionLink(a, b)) return null;
    return decide("link", "version-link", TIER_CONFIDENCE.versionLink, {
      knownVersionLink: true,
    });
  },
};

/**
 * `docs/02` §11.3's cascade as data: run in order, stop at the first tier
 * that returns a decision. Exported so a test can assert the order and so
 * `P2-T11` can see where Tier 7 sits.
 */
export const DEDUP_TIERS: readonly DedupTier[] = Object.freeze([
  DOI_TIER,
  identifierTier("pmid", 1, "pmid", TIER_CONFIDENCE.pmid),
  identifierTier("pmcid", 2, "pmcid", TIER_CONFIDENCE.pmcid),
  identifierTier("arxiv", 3, "arxivId", TIER_CONFIDENCE.arxiv),
  identifierTier("s2", 4, "s2CorpusId", TIER_CONFIDENCE.s2),
  TITLE_EXACT_TIER,
  TITLE_FUZZY_TIER,
  VERSION_LINK_TIER,
]);

/** Compare two candidates through the cascade. Pure and symmetric in verdict. */
export function compareCandidates(
  a: DedupCandidate,
  b: DedupCandidate,
): DedupDecision {
  const ctx: TierContext = { conflicts: [] };
  for (const tier of DEDUP_TIERS) {
    const decision = tier.run(a, b, ctx);
    if (decision !== null) return decision;
  }
  return decide(
    "distinct",
    null,
    0,
    ctx.conflicts.length > 0 ? { conflictingIds: ctx.conflicts.join(",") } : {},
  );
}

/** {@link compareCandidates} over two records. Builds both candidates. */
export function compareRecords(
  a: SourceRecord,
  b: SourceRecord,
): DedupDecision {
  return compareCandidates(toCandidate(a), toCandidate(b));
}

// ---------------------------------------------------------------------------
// 7. Dedup within a result set — blocking first, then the cascade per pair
// ---------------------------------------------------------------------------

/** Instrumentation: how many pairs went through {@link compareCandidates}. */
export interface DedupCounter {
  comparisons: number;
}

export interface DedupPair {
  readonly a: SourceRecord;
  readonly b: SourceRecord;
  readonly decision: DedupDecision;
}

export interface DedupGroup {
  /** The records judged to be one work, in input order. */
  readonly records: readonly SourceRecord[];
  /** The `"match"` decisions that joined them; empty for a singleton. */
  readonly decisions: readonly DedupDecision[];
}

export interface DedupResult {
  /** One group per distinct work, in order of each group's first record. */
  readonly groups: readonly DedupGroup[];
  /** Possible duplicates for user review. Never merged (FR-50 scenario 4). */
  readonly flags: readonly DedupPair[];
  /** Related versions (§11.4) and title matches with conflicting ids (§11.5). */
  readonly links: readonly DedupPair[];
  /** Pairs passed to the cascade — the figure the `O(n²)` criterion bounds. */
  readonly comparisons: number;
  /** `records.length - groups.length`: the pipeline report's count. */
  readonly recordsDeduplicatedAway: number;
}

/** Minimal union–find over indices, with path halving. */
class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i: number): number {
    let x = i;
    while ((this.parent[x] ?? x) !== x) {
      const grand = this.parent[this.parent[x] ?? x] ?? x;
      this.parent[x] = grand;
      x = grand;
    }
    return x;
  }

  union(i: number, j: number): void {
    const ri = this.find(i);
    const rj = this.find(j);
    if (ri !== rj) this.parent[Math.max(ri, rj)] = Math.min(ri, rj);
  }
}

/** Append `value` under `key` in a map of lists. */
function pushInto<K>(map: Map<K, number[]>, key: K, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** Could these two be the same work by year? Unknown years are compatible. */
function yearsCompatible(a: DedupCandidate, b: DedupCandidate): boolean {
  const delta = yearDelta(a, b);
  return delta === undefined || delta <= MAX_YEAR_DELTA;
}

/**
 * How many cascade comparisons {@link dedupeRecordsAsync} runs between two
 * yields to the event loop **inside one block**.
 *
 * `docs/10` NFR-3 caps a single main-thread task at 100 ms and says long
 * normalization work "is chunked with yields". `P2-T29` measured the
 * unchunked cascade at 246–274 ms on Zotero's main thread for one block of
 * 100 records (4 851 comparisons — every title of one query shares its
 * longest words, so one block is the normal case, not a fixture artefact).
 * That is roughly 50 µs a comparison under the Browser Toolbox; 250
 * comparisons is then about 12 ms of work per slice, an order of magnitude
 * under the budget, and some 20 yields for that import. Tuned by measurement
 * (`P2-T30`), not derived; the figure to re-measure if the cascade changes.
 */
export const DEDUP_YIELD_EVERY_COMPARISONS = 250;

/** What {@link dedupeRecordsAsync} takes beside the records. */
export interface DedupeAsyncOptions {
  /** External comparison counter, incremented in place, as {@link dedupeRecords}'. */
  readonly counter?: DedupCounter;
  /**
   * Checked on entry and after **every** yield: a cancelled token stops the
   * cascade at the next yield with `OperationCancelledError` (`docs/07` §7.4;
   * FR-10's "within 2 seconds" is then bounded by one slice).
   */
  readonly token?: CancellationToken;
  /**
   * The yield itself. Defaults to {@link defaultYieldToEventLoop}; injectable
   * so a test can count the yields instead of inferring them — `P1-T14`'s
   * `ImportRequest.yieldToUi` pattern in `src/zotero/importer.ts`.
   */
  readonly yieldToEventLoop?: () => Promise<void>;
}

const systemClock = createSystemClock();

/**
 * One macrotask yield: `Clock.sleep(0)` on the system clock, which is a
 * `setTimeout(…, 0)` — the primitive `src/core/clock.ts` already offers, and
 * the same mechanism as the inter-chunk `Zotero.Promise.delay(0)` in
 * `src/zotero/importer.ts`, which this module may not call (`sources/` never
 * names `Zotero`, `docs/13` §2.1). A microtask (`await Promise.resolve()`)
 * would **not** do: the main window's event loop runs only between
 * macrotasks, so a microtask yield leaves the stall exactly as long.
 */
export function defaultYieldToEventLoop(): Promise<void> {
  return systemClock.sleep(0);
}

/**
 * The cascade over a result set, as a generator.
 *
 * It is the one body behind {@link dedupeRecords} and
 * {@link dedupeRecordsAsync}: the synchronous driver drains it in one go, the
 * asynchronous one hands the event loop back at every `yield`. Both therefore
 * run exactly the same comparisons in exactly the same order, which is what
 * makes their results deep-equal by construction (and asserted, in
 * `test/unit/sources/dedupe.test.ts`).
 *
 * Where it yields (`P2-T30`): after every {@link DEDUP_YIELD_EVERY_COMPARISONS}
 * comparisons inside a block, and at every block boundary that had at least
 * one comparison since the last yield — the end of the identifier pass, and
 * the end of each title bucket. A boundary with nothing compared since the
 * last yield is not a yield, so a set of 500 singleton buckets does not pay
 * 500 timer ticks.
 */
function* dedupeCascade(
  records: readonly SourceRecord[],
  counter: DedupCounter,
): Generator<void, DedupResult, void> {
  const candidates = records.map(toCandidate);
  const uf = new UnionFind(candidates.length);
  const seen = new Set<string>();
  const matchPairs: { i: number; j: number; decision: DedupDecision }[] = [];
  const flags: DedupPair[] = [];
  const links: DedupPair[] = [];
  /** Comparisons since the last yield; the generator's only yield state. */
  let sinceYield = 0;

  const pair = (i: number, j: number, decision: DedupDecision): DedupPair => {
    const a = records[i];
    const b = records[j];
    if (a === undefined || b === undefined) {
      throw new Error(`dedupeRecords: index out of range (${i}, ${j})`);
    }
    return { a, b, decision };
  };

  /** Compare the pair unless already seen or already one group; true if compared. */
  const consider = (i: number, j: number): boolean => {
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const pairKey = `${lo}:${hi}`;
    if (seen.has(pairKey)) return false;
    seen.add(pairKey);
    if (uf.find(lo) === uf.find(hi)) return false;
    const a = candidates[lo];
    const b = candidates[hi];
    if (a === undefined || b === undefined) return false;
    counter.comparisons += 1;
    const decision = compareCandidates(a, b);
    switch (decision.verdict) {
      case "match":
        uf.union(lo, hi);
        matchPairs.push({ i: lo, j: hi, decision });
        break;
      case "link":
        links.push(pair(lo, hi, decision));
        break;
      case "flag":
        flags.push(pair(lo, hi, decision));
        break;
      case "distinct":
        break;
    }
    return true;
  };

  // Pass 1: identifiers.
  for (const kind of ID_KINDS) {
    const byKey = new Map<string, number[]>();
    candidates.forEach((c, i) => {
      const v = c.ids[kind];
      if (v !== undefined) pushInto(byKey, v, i);
    });
    for (const holders of byKey.values()) {
      const first = holders[0];
      if (first === undefined) continue;
      for (let k = 1; k < holders.length; k += 1) {
        const other = holders[k];
        if (other !== undefined && consider(first, other)) {
          sinceYield += 1;
          if (sinceYield >= DEDUP_YIELD_EVERY_COMPARISONS) {
            yield;
            sinceYield = 0;
          }
        }
      }
    }
  }
  const byAccession = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    if (c.accession !== undefined) pushInto(byAccession, c.accession, i);
  });
  for (const holders of byAccession.values()) {
    const first = holders[0];
    if (first === undefined) continue;
    for (let k = 1; k < holders.length; k += 1) {
      const other = holders[k];
      if (other !== undefined && consider(first, other)) {
        sinceYield += 1;
        if (sinceYield >= DEDUP_YIELD_EVERY_COMPARISONS) {
          yield;
          sinceYield = 0;
        }
      }
    }
  }
  // The identifier pass is one block for yielding purposes.
  if (sinceYield > 0) {
    yield;
    sinceYield = 0;
  }

  // Pass 2: blocking by title signature, then year.
  const bySignature = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    if (c.signature !== undefined) pushInto(bySignature, c.signature, i);
  });
  for (const bucket of bySignature.values()) {
    for (let x = 0; x < bucket.length; x += 1) {
      for (let y = x + 1; y < bucket.length; y += 1) {
        const i = bucket[x];
        const j = bucket[y];
        if (i === undefined || j === undefined) continue;
        const a = candidates[i];
        const b = candidates[j];
        if (a === undefined || b === undefined) continue;
        if (yearsCompatible(a, b) && consider(i, j)) {
          sinceYield += 1;
          if (sinceYield >= DEDUP_YIELD_EVERY_COMPARISONS) {
            yield;
            sinceYield = 0;
          }
        }
      }
    }
    // Block boundary.
    if (sinceYield > 0) {
      yield;
      sinceYield = 0;
    }
  }

  // Assemble groups in order of first appearance.
  const members = new Map<number, number[]>();
  candidates.forEach((_, i) => pushInto(members, uf.find(i), i));
  const decisionsByRoot = new Map<number, DedupDecision[]>();
  for (const { i, decision } of matchPairs) {
    const root = uf.find(i);
    const list = decisionsByRoot.get(root);
    if (list === undefined) decisionsByRoot.set(root, [decision]);
    else list.push(decision);
  }
  const groups: DedupGroup[] = [];
  for (const [root, indices] of members) {
    const groupRecords: SourceRecord[] = [];
    for (const i of indices) {
      const r = records[i];
      if (r !== undefined) groupRecords.push(r);
    }
    groups.push({
      records: groupRecords,
      decisions: decisionsByRoot.get(root) ?? [],
    });
  }

  return {
    groups,
    flags,
    links,
    comparisons: counter.comparisons,
    recordsDeduplicatedAway: records.length - groups.length,
  };
}

/**
 * Deduplicate a result set, synchronously.
 *
 * Two passes, neither of them `O(n²)` over the set:
 *
 * 1. **Identifier pass.** Every candidate is indexed by each id it carries
 *    (and by bioRxiv accession). Records sharing a key are compared with the
 *    first holder of that key — a cascade call that terminates at Tier 0–4.
 * 2. **Blocking pass** (§11.3.3). Candidates with a comparable title are
 *    bucketed by {@link blockingSignature}; within a bucket, pairs within
 *    {@link MAX_YEAR_DELTA} of each other (or with an unknown year) are
 *    compared, unless pass 1 already put them in one group.
 *
 * Only a `"match"` unions two records. A `"flag"` or `"link"` is reported as
 * a pair and both records stay in the output — there is no path from either
 * to a group merge, which is FR-50 scenario 4 and R-18's mitigation.
 *
 * **Kept beside {@link dedupeRecordsAsync}** (`P2-T30`) for the callers that
 * have no event loop to yield to: the unit tests in
 * `test/unit/sources/dedupe.test.ts` and `test/unit/model/merge.test.ts`, and
 * `src/pipeline/searchImport/stages.ts`'s synchronous `dedupeAndMerge`. The
 * pipeline's `Merging` stage runs the asynchronous form. The two share
 * {@link dedupeCascade}, so there is one cascade and not two to drift.
 *
 * @param records - the fetched records, in fetch order
 * @param counter - optional external comparison counter, incremented in place
 */
export function dedupeRecords(
  records: readonly SourceRecord[],
  counter: DedupCounter = { comparisons: 0 },
): DedupResult {
  const cascade = dedupeCascade(records, counter);
  for (;;) {
    const step = cascade.next();
    if (step.done) return step.value;
  }
}

/**
 * {@link dedupeRecords}, yielding to the event loop as it goes — the form the
 * pipeline's `Merging` stage runs (`P2-T30`, `docs/10` NFR-3).
 *
 * Same cascade, same verdicts, same result: the two drivers drain one
 * generator ({@link dedupeCascade}), and the asynchronous one awaits
 * {@link DedupeAsyncOptions.yieldToEventLoop} at each of its yields — every
 * {@link DEDUP_YIELD_EVERY_COMPARISONS} comparisons inside a block and at
 * every block boundary that compared something — then checks
 * {@link DedupeAsyncOptions.token}, so a Cancel lands within one slice
 * (`docs/07` §7.4, FR-10). A set that compares nothing never yields.
 *
 * @param records - the fetched records, in fetch order
 * @param options - counter, cancellation token and the yield, all optional
 * @returns the same {@link DedupResult} {@link dedupeRecords} returns
 * @throws OperationCancelledError when `options.token` is cancelled, at the
 *   first yield after the request (or on entry if already cancelled)
 */
export async function dedupeRecordsAsync(
  records: readonly SourceRecord[],
  options: DedupeAsyncOptions = {},
): Promise<DedupResult> {
  const counter = options.counter ?? { comparisons: 0 };
  const yieldToEventLoop = options.yieldToEventLoop ?? defaultYieldToEventLoop;
  options.token?.throwIfCancelled();
  const cascade = dedupeCascade(records, counter);
  for (;;) {
    const step = cascade.next();
    if (step.done) return step.value;
    await yieldToEventLoop();
    options.token?.throwIfCancelled();
  }
}

// ---------------------------------------------------------------------------
// 8. The existing-library index — docs/02 §11.6, feeding FR-51
// ---------------------------------------------------------------------------

/**
 * One Zotero item's matching fields, already read out by the `zotero/` layer
 * (`item.getField("DOI")`, `getField("PMID")`, `getField("archiveID")`, the
 * `extra` lines for the rest, `item.deleted`). Plain values only: this
 * module may not see a `Zotero.Item`.
 */
export interface LibraryItemFields {
  readonly itemID: number;
  /** `item.deleted` — trashed. Skipped, so a deleted paper can come back. */
  readonly deleted: boolean;
  readonly doi?: string | null | undefined;
  readonly pmid?: string | null | undefined;
  readonly pmcid?: string | null | undefined;
  readonly arxivId?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly year?: number | null | undefined;
  readonly firstAuthorFamily?: string | null | undefined;
  readonly containerTitle?: string | null | undefined;
  /** `true` for a Zotero `preprint` item. */
  readonly isPreprint?: boolean | undefined;
}

export interface LibraryIndex {
  readonly byDoi: ReadonlyMap<string, number>;
  readonly byPmid: ReadonlyMap<string, number>;
  readonly byPmcid: ReadonlyMap<string, number>;
  readonly byArxiv: ReadonlyMap<string, number>;
  /** Normalized title → itemIDs: Tier 5's bucket. */
  readonly byTitle: ReadonlyMap<string, readonly number[]>;
  /** Blocking signature → itemIDs: Tier 6's bucket. */
  readonly bySignature: ReadonlyMap<string, readonly number[]>;
  readonly candidates: ReadonlyMap<number, DedupCandidate>;
  readonly indexed: number;
  readonly skippedTrashed: number;
}

/** Build a candidate from library fields; the same shape the cascade reads. */
export function candidateFromLibraryItem(
  item: LibraryItemFields,
): DedupCandidate {
  const ids = normalizeIds({
    doi: item.doi,
    pmid: item.pmid,
    pmcid: item.pmcid,
    arxivId: item.arxivId,
  });
  const title = normalizeTitle(item.title ?? "");
  const tokens = titleTokens(title);
  const container =
    item.containerTitle == null
      ? undefined
      : normalizeTitle(item.containerTitle) || undefined;
  return {
    key: `zotero:${item.itemID}`,
    ids,
    accession: biorxivAccession(ids.doi),
    title,
    tokens,
    signature: blockingSignature(tokens),
    year: item.year ?? undefined,
    firstAuthor: normalizeFamilyName(item.firstAuthorFamily ?? undefined),
    container,
    type: item.isPreprint === true ? "preprint" : undefined,
    relatedVersionIds: undefined,
  };
}

/**
 * Build the §11.6 index once per run. Trashed items are skipped (`docs/02`
 * §11.6: so a paper the user deliberately deleted can be re-recommended).
 * The first item to claim an identifier keeps it; a library that itself
 * holds two items with one DOI is not this module's problem to resolve.
 */
export function buildLibraryIndex(
  items: Iterable<LibraryItemFields>,
): LibraryIndex {
  const byDoi = new Map<string, number>();
  const byPmid = new Map<string, number>();
  const byPmcid = new Map<string, number>();
  const byArxiv = new Map<string, number>();
  const byTitle = new Map<string, number[]>();
  const bySignature = new Map<string, number[]>();
  const candidates = new Map<number, DedupCandidate>();
  let skippedTrashed = 0;

  for (const item of items) {
    if (item.deleted) {
      skippedTrashed += 1;
      continue;
    }
    const c = candidateFromLibraryItem(item);
    candidates.set(item.itemID, c);
    if (c.ids.doi !== undefined && !byDoi.has(c.ids.doi)) {
      byDoi.set(c.ids.doi, item.itemID);
    }
    if (c.ids.pmid !== undefined && !byPmid.has(c.ids.pmid)) {
      byPmid.set(c.ids.pmid, item.itemID);
    }
    if (c.ids.pmcid !== undefined && !byPmcid.has(c.ids.pmcid)) {
      byPmcid.set(c.ids.pmcid, item.itemID);
    }
    if (c.ids.arxivId !== undefined && !byArxiv.has(c.ids.arxivId)) {
      byArxiv.set(c.ids.arxivId, item.itemID);
    }
    if (isTitleComparable(c)) pushInto(byTitle, c.title, item.itemID);
    if (c.signature !== undefined) {
      pushInto(bySignature, c.signature, item.itemID);
    }
  }

  return {
    byDoi,
    byPmid,
    byPmcid,
    byArxiv,
    byTitle,
    bySignature,
    candidates,
    indexed: candidates.size,
    skippedTrashed,
  };
}

export interface LibraryMatch {
  readonly itemID: number;
  readonly decision: DedupDecision;
}

/** Rank for choosing the strongest of several library decisions. */
const VERDICT_RANK: Readonly<Record<DedupVerdict, number>> = {
  match: 3,
  link: 2,
  flag: 1,
  distinct: 0,
};

function isSourceRecord(x: SourceRecord | DedupCandidate): x is SourceRecord {
  return "work" in x;
}

/**
 * Match one incoming record against the library: `O(1)` identifier lookups
 * first, then the cascade over the exact-title bucket and the signature
 * bucket only (§11.6: "each candidate costs O(1) lookups plus a fuzzy pass
 * only within its title bucket"). Returns the strongest non-distinct
 * decision, a `"match"` as soon as one is found, or `null`.
 *
 * FR-51 acts on a `"match"` (link the existing item instead of creating
 * one); a `"flag"` or `"link"` is for the caller to surface, never to act on
 * as a match.
 */
export function matchAgainstLibrary(
  incoming: SourceRecord | DedupCandidate,
  index: LibraryIndex,
  counter: DedupCounter = { comparisons: 0 },
): LibraryMatch | null {
  const c = isSourceRecord(incoming) ? toCandidate(incoming) : incoming;
  const itemIDs: number[] = [];
  const add = (id: number | undefined): void => {
    if (id !== undefined && !itemIDs.includes(id)) itemIDs.push(id);
  };
  // Identifier hits are compared whatever their year: a same-DOI item is the
  // same item even when one side carries the online year and the other the
  // print year. Year blocking (§11.3.3) applies to the title buckets only.
  if (c.ids.doi !== undefined) add(index.byDoi.get(c.ids.doi));
  if (c.ids.pmid !== undefined) add(index.byPmid.get(c.ids.pmid));
  if (c.ids.pmcid !== undefined) add(index.byPmcid.get(c.ids.pmcid));
  if (c.ids.arxivId !== undefined) add(index.byArxiv.get(c.ids.arxivId));
  const idHits = itemIDs.length;
  if (isTitleComparable(c)) {
    for (const id of index.byTitle.get(c.title) ?? []) add(id);
  }
  if (c.signature !== undefined) {
    for (const id of index.bySignature.get(c.signature) ?? []) add(id);
  }

  let best: LibraryMatch | null = null;
  for (const [position, itemID] of itemIDs.entries()) {
    const other = index.candidates.get(itemID);
    if (other === undefined) continue;
    if (position >= idHits && !yearsCompatible(c, other)) continue;
    counter.comparisons += 1;
    const decision = compareCandidates(c, other);
    if (decision.verdict === "match") return { itemID, decision };
    if (
      decision.verdict !== "distinct" &&
      (best === null ||
        VERDICT_RANK[decision.verdict] > VERDICT_RANK[best.decision.verdict])
    ) {
      best = { itemID, decision };
    }
  }
  return best;
}
