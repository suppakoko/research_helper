/**
 * Related-paper scoring, reason chips and the recency flag (`plan/08` `P5-T13`).
 * `docs/05` §6.2's note of 2026-11-05 holds this file's decisions; `docs/07` §12.2's
 * note names what it returns. This header does not repeat them.
 *
 * **Callers.** {@link scoreRelatedCandidates} is called by `relatedPipeline.ts`
 * (`P5-T14`), between the candidate vectors and the self and type filter.
 * {@link isCheckedByDefault} is called by `relatedViewModel.ts` (`P5-T16`). `P5-T14`
 * constructs the injected {@link SimilarityFn} and resolves the `RecencyWindow`; this
 * file constructs every other type it exports.
 *
 * **Every number below is an unmeasured starting value** from `docs/05` §6.2. What
 * would measure them is backlog, and §6.2's note names it.
 *
 * **Nothing is dropped here (FR-18), and nothing here knows the library (FR-16).** A
 * row keeps its place however old it is, and `P5-T14` marks ownership afterwards.
 *
 * **No sentence is built here.** A chip is an id for the window to word (`P5-T16`). A
 * citation context is the source's own text, so the window must show it as plain text.
 */

import type { CanonicalWork } from "../../model/canonicalWork";
import type { RelationKind } from "../../model/related";
import type { RecencyWindow } from "../../sources/shared/recency";
import type { GeneratorEdge, RelatedCandidate } from "./generators";

const WEIGHT_RECOMMENDATION = 0.3;
const WEIGHT_PMRA = 0.2;
const WEIGHT_CITATION = 0.2;
const WEIGHT_SIMILARITY = 0.2;
const WEIGHT_RECENCY = 0.05;
const WEIGHT_QUALITY = 0.05;

const AGREEMENT_BONUS = 0.08;
const AGREEMENT_CAP = 3;
const RECENCY_TAU_YEARS = 2;
/** `quality` reaches 1 at 10^3 − 1 citations. */
const QUALITY_LOG10_SPAN = 3;

/**
 * The similarity term for one candidate: a value already in [0, 1], and 0 for one with
 * no vector. `P5-T14` builds it from one space per run and rescales SPECTER2's cosine
 * itself; the lexical cosine goes through as it is (`docs/05` §5.5 item 6). What it
 * throws propagates: `cosine` throws on two spaces, which is a defect, not a low score.
 */
export type SimilarityFn = (work: CanonicalWork) => number;

/** What {@link scoreRelatedCandidates} needs beside the candidates. */
export interface RelatedScoreOptions {
  readonly similarity: SimilarityFn;
  /** `recencyWindow(searchYears, clock)`, resolved once per run by `P5-T14`. */
  readonly window: RecencyWindow;
}

/** The chip for one relation kind. */
export type RelationChipId =
  "cites-seed" | "cited-by-seed" | "recommended" | "similar-pubmed";

/** One reason a row is on the list. The window words the id. */
export type ReasonChip =
  | { readonly id: RelationChipId }
  | { readonly id: "similar"; readonly similarity: number }
  | { readonly id: "citation-context"; readonly context: string };

/** A candidate with its score, its reasons and its recency flag. */
export interface ScoredRelatedCandidate extends RelatedCandidate {
  /** In [0, 1], never `NaN`. */
  readonly score: number;
  /** At least one: `P5-T12` hands over no candidate without an edge. */
  readonly chips: readonly ReasonChip[];
  /** Older than the window's first year (FR-18). Kept on the list, never dropped. */
  readonly outsideWindow: boolean;
}

/** `docs/07` §4.2's reading of each kind; this order is the chips' order. */
const CHIP_OF_KIND: Readonly<Record<RelationKind, RelationChipId>> = {
  citation: "cites-seed",
  reference: "cited-by-seed",
  recommendation: "recommended",
  similar: "similar-pubmed",
};

/** Clip to [0, 1]. Absent and `NaN` read as 0: a missing signal is 0 (`docs/05` §2.3). */
function unit(value: number | undefined): number {
  return value !== undefined && value > 0 ? Math.min(1, value) : 0;
}

/** The best value `read` gives over the edges of one kind, or 0 with none. */
function best(
  edges: readonly GeneratorEdge[],
  kind: RelationKind,
  read: (edge: GeneratorEdge) => number | undefined,
): number {
  return edges
    .filter(({ edge }) => edge.kind === kind)
    .reduce((top, edge) => Math.max(top, unit(read(edge))), 0);
}

function citationTerm(edges: readonly GeneratorEdge[]): number {
  return edges.some(
    ({ edge }) => edge.kind === "reference" || edge.kind === "citation",
  )
    ? 1
    : 0;
}

/** The publication year, or `undefined` when there is none to read. */
function yearOf(work: CanonicalWork): number | undefined {
  const year = work.publishedDate?.year;
  return year !== undefined && Number.isFinite(year) ? year : undefined;
}

function recencyTerm(year: number | undefined, window: RecencyWindow): number {
  if (year === undefined) return 0;
  return Math.exp(-Math.max(0, window.toYear - year) / RECENCY_TAU_YEARS);
}

function qualityTerm(work: CanonicalWork): number {
  return unit(Math.log10(1 + (work.citationCount ?? 0)) / QUALITY_LOG10_SPAN);
}

function agreementBonus(edges: readonly GeneratorEdge[]): number {
  const kinds = new Set(edges.map(({ edge }) => edge.kind)).size;
  return AGREEMENT_BONUS * Math.max(0, Math.min(kinds - 1, AGREEMENT_CAP));
}

/** The first usable context of the lowest-ranked edge holding one: edges have no order. */
function firstContext(edges: readonly GeneratorEdge[]): string | undefined {
  const usable = edges.flatMap(({ generator, edge }) => {
    const context = edge.contexts?.find((text) => text.trim() !== "");
    return context === undefined ? [] : [{ generator, context, edge }];
  });
  usable.sort(
    (a, b) => a.edge.rank - b.edge.rank || (a.generator < b.generator ? -1 : 1),
  );
  return usable[0]?.context;
}

function chipsOf(
  edges: readonly GeneratorEdge[],
  similarity: number,
): readonly ReasonChip[] {
  const kinds = new Set(edges.map(({ edge }) => edge.kind));
  const chips: ReasonChip[] = (Object.keys(CHIP_OF_KIND) as RelationKind[])
    .filter((kind) => kinds.has(kind))
    .map((kind) => ({ id: CHIP_OF_KIND[kind] }));
  if (similarity > 0) chips.push({ id: "similar", similarity });
  const context = firstContext(edges);
  if (context !== undefined) chips.push({ id: "citation-context", context });
  return chips;
}

function scoreOne(
  candidate: RelatedCandidate,
  options: RelatedScoreOptions,
): ScoredRelatedCandidate {
  const { edges, work } = candidate;
  const similarity = unit(options.similarity(work));
  const year = yearOf(work);
  const blend =
    WEIGHT_RECOMMENDATION *
      best(
        edges,
        "recommendation",
        ({ edge, limit }) => 1 - edge.rank / limit,
      ) +
    WEIGHT_PMRA * best(edges, "similar", ({ edge }) => edge.score) +
    WEIGHT_CITATION * citationTerm(edges) +
    WEIGHT_SIMILARITY * similarity +
    WEIGHT_RECENCY * recencyTerm(year, options.window) +
    WEIGHT_QUALITY * qualityTerm(work);
  return {
    ...candidate,
    score: unit(blend + agreementBonus(edges)),
    chips: chipsOf(edges, similarity),
    outsideWindow: year !== undefined && year < options.window.fromYear,
  };
}

/**
 * Score every candidate and rank them, highest first; a tie keeps the given order.
 *
 * @param candidates - `RelatedGenerationResult.candidates`, in union order
 * @param options - the injected similarity and the run's recency window
 * @returns one row per candidate, none dropped, in a new array
 * @throws whatever {@link SimilarityFn} throws
 */
export function scoreRelatedCandidates(
  candidates: readonly RelatedCandidate[],
  options: RelatedScoreOptions,
): readonly ScoredRelatedCandidate[] {
  return candidates
    .map((candidate) => scoreOne(candidate, options))
    .sort((a, b) => b.score - a.score);
}

/**
 * Whether a row starts ticked: FR-16's library rows and FR-18's older rows do not.
 *
 * @param row - the row's two marks
 * @returns `true` when the row starts ticked
 */
export function isCheckedByDefault(row: {
  readonly inLibrary: boolean;
  readonly outsideWindow: boolean;
}): boolean {
  return !row.inLibrary && !row.outsideWindow;
}
