/**
 * Recommendation filters, scoring, diversity and reasons (`plan/08` `P5-T24`).
 * `docs/05` §7.4's note of 2026-11-05 holds this file's decisions and measurements;
 * `docs/07` §12.5's note says which state each function is. This header does not
 * repeat them.
 *
 * **Caller.** `recommendPipeline.ts` (`P5-T25`) calls, in this order,
 * {@link readDismissed} and {@link recommendOwnership} once, {@link identifierFilters}
 * before its metadata fill-in, {@link contentFilters} after the vectors,
 * {@link scoreRecommendations} and {@link diversify}. `P5-T27`'s rows read
 * {@link RecommendationRow}. This file constructs `Recommendation`, every other type
 * it exports, and nothing else: the stores, the indexes and the vectors are the caller's.
 *
 * **One space per run (`plan/08` §0.2 item 22).** The profile decides: centroids mean
 * SPECTER2, none means the word overlap. A candidate with no vector on SPECTER2 is
 * never compared in words; it reads 0 on both terms.
 *
 * **A hard filter is never a score penalty.** What {@link identifierFilters} and
 * {@link contentFilters} drop is gone before a term is computed, and what they keep
 * pays nothing for having been looked at.
 *
 * **No sentence is built here.** A reason is an id for `P5-T27` to word, and no model
 * is called (`docs/07` §5.2).
 *
 * **Every number below is an unmeasured starting value** from `docs/05` §7.4 and §7.5,
 * except where its comment names a measurement. What would measure them is backlog
 * (`plan/00` §6 item 323(d)).
 */

import type { CancellationToken } from "../../core/jobQueue/cancellation";
import { ResearchHelperError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import type { CanonicalWork } from "../../model/canonicalWork";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizePmid,
  type ExternalIds,
} from "../../model/ids";
import type { CollectionProfile } from "../../model/profile";
import type {
  Recommendation,
  RecommendationReason,
  RecommendationSignals,
  SimilaritySpace,
} from "../../model/recommendation";
import {
  buildLibraryIndex as buildTitleIndex,
  defaultYieldToEventLoop,
  matchAgainstLibrary,
  normalizeTitle,
  type LibraryIndex as TitleIndex,
  type LibraryItemFields,
} from "../../sources/shared/dedupe";
import { isPreprintDoi } from "../../sources/shared/preprintServers";
import type { RecencyWindow } from "../../sources/shared/recency";
import { recommendationId, type RecommendationStore } from "../../zotero/db";
import type { CollectionWorkRead } from "../../zotero/itemMapper";
import type { LibraryIndex } from "../../zotero/libraryIndex";
import { cosine, type EmbeddingVector } from "../shared/embeddings";
import { lexicalSpace, type LexicalVector } from "../shared/lexical";

import type { RecommendCandidate } from "./generators";
import { authorName, profileOwnedSets, type OwnedIdentifiers } from "./profile";

/** `t` when the user has not moved the slider: `docs/05` §7.4's starting weights. */
export const DEFAULT_EXPLORATION = 0.25;
/** `docs/05` §7.5's `settings.topK ?? 30`. */
export const RECOMMEND_TOP_K = 30;
/** `docs/05` §7.5: no single lab dominating the list. */
export const MAX_PER_AUTHOR = 2;
export const MAX_PER_VENUE = 4;
export const MMR_LAMBDA = 0.75;

/**
 * Comparisons between two yields. Not a measured best: `docs/05` §7.4's note, item 14,
 * holds what it gave, under Node and not on Zotero's main thread.
 */
export const SCORE_YIELD_EVERY_COMPARISONS = 5000;
/** One word vector counted in comparisons, for the yield only. */
const VECTOR_COST_IN_COMPARISONS = 10;

const RECENCY_TAU_YEARS = 1.5;
const DAYS_PER_YEAR = 365;
const DAY_MS = 864e5;
const VELOCITY_FULL_CITATIONS_PER_YEAR = 20;
const VELOCITY_MIN_AGE_YEARS = 0.25;
const AUTHOR_AFFINITY_STEP = 0.5;
const VENUE_ISSN_FAMILY = 0.3;
const AGREEMENT_SPAN = 3;
const TOP_TERM_REASONS = 2;

/** The eight weights, in `docs/05` §7.4's order. */
export type RecommendationWeights = Readonly<
  Record<keyof RecommendationSignals, number>
>;

/**
 * `docs/05` §7.4's weights at one slider position: `w_sim + w_nov` is 0.40 at every
 * `t`, so all eight sum to 1.00 and a score means the same thing everywhere.
 *
 * @param t - the slider, in [0, 1]; `P5-T27`'s control is 0 to 100, divided by 100
 * @returns the eight weights
 * @throws RangeError outside [0, 1], or for `NaN`: a slider cannot produce one
 */
export function recommendationWeights(
  t: number = DEFAULT_EXPLORATION,
): RecommendationWeights {
  if (!(t >= 0 && t <= 1)) {
    throw new RangeError(
      `[research-helper] recommendationWeights: t must be in [0, 1], got ${String(t)}`,
    );
  }
  return {
    similarity: 0.4 - 0.4 * t,
    recency: 0.15,
    velocity: 0.1,
    novelty: 0.4 * t,
    authorAffinity: 0.1,
    venueAffinity: 0.05,
    generatorAgreement: 0.12,
    coupling: 0.08,
  };
}

// ---------------------------------------------------------------------------
// 1. What the user owns
// ---------------------------------------------------------------------------

/** Who owns what, for one run. Built by {@link recommendOwnership}. */
export interface RecommendOwnership {
  /** FR-46: a candidate here is excluded. */
  readonly collection: OwnedIdentifiers;
  /** The same collection, for `docs/02` §11.3.3's title tiers. */
  readonly collectionTitles: TitleIndex;
  /** FR-46: a candidate here, and not in the collection, is marked "in library". */
  readonly library: OwnedIdentifiers;
  readonly libraryTitles: TitleIndex;
}

/** What {@link recommendOwnership} reads. */
export interface RecommendOwnershipInput {
  /** `readProfileCollection`'s items. */
  readonly items: readonly Pick<CollectionWorkRead, "work">[];
  /** `CollectionProfile.knownWorkKeys`, `docs/07` §12.5's `IdentifierFilters`. */
  readonly knownWorkKeys: readonly string[];
  readonly libraryIndex: Pick<
    LibraryIndex,
    "byDoi" | "byPmid" | "byArxiv" | "byWorkKey"
  >;
  /** The pass `RelatedLibrary.libraryItems` reads, once per run. */
  readonly libraryItems: Iterable<LibraryItemFields>;
}

/** A collection member, as the title tiers read a library item. */
function titleFieldsOf(work: CanonicalWork, itemID: number): LibraryItemFields {
  return {
    itemID,
    deleted: false,
    doi: work.ids.doi,
    pmid: work.ids.pmid,
    pmcid: work.ids.pmcid,
    arxivId: work.ids.arxivId,
    title: work.title,
    year: work.publishedDate?.year,
    firstAuthorFamily: work.authors[0]?.family,
    containerTitle: work.containerTitle,
    isPreprint: work.type === "preprint",
  };
}

/**
 * The run's ownership sets. Computed on each run and never stored (`docs/07` §5.2).
 *
 * @param input - the collection, its known keys and the library's two reads
 * @returns the sets {@link identifierFilters} and {@link scoreRecommendations} read
 */
export function recommendOwnership(
  input: RecommendOwnershipInput,
): RecommendOwnership {
  const { ownedInCollection, ownedInLibrary } = profileOwnedSets(
    input.items,
    input.libraryIndex,
  );
  return {
    collection: {
      ...ownedInCollection,
      workKeys: new Set([
        ...ownedInCollection.workKeys,
        ...input.knownWorkKeys,
      ]),
    },
    collectionTitles: buildTitleIndex(
      input.items.map(({ work }, itemID) => titleFieldsOf(work, itemID)),
    ),
    library: ownedInLibrary,
    libraryTitles: buildTitleIndex(input.libraryItems),
  };
}

function isOwned(
  owned: OwnedIdentifiers,
  ids: Partial<ExternalIds>,
  workKey?: string,
): boolean {
  const doi = normalizeDoi(ids.doi);
  const pmid = normalizePmid(ids.pmid);
  const arxiv = normalizeArxivId(ids.arxivId);
  return (
    (doi !== null && owned.doi.has(doi)) ||
    (pmid !== null && owned.pmid.has(pmid)) ||
    (arxiv !== null && owned.arxiv.has(arxiv)) ||
    (workKey !== undefined && owned.workKeys.has(workKey))
  );
}

/** A `"match"` only: a `"link"` or a `"flag"` is not ownership (`docs/02` §11.6). */
function titleMatchItem(
  candidate: RecommendCandidate,
  titles: TitleIndex,
): number | undefined {
  const [record] = candidate.records;
  if (record === undefined) return undefined;
  const match = matchAgainstLibrary(
    { ...record, work: candidate.work },
    titles,
  );
  return match?.decision.verdict === "match" ? match.itemID : undefined;
}

function titleMatches(
  candidate: RecommendCandidate,
  titles: TitleIndex,
): boolean {
  return titleMatchItem(candidate, titles) !== undefined;
}

/**
 * Whether a work carries the "preprint (not peer reviewed)" label (`plan/08` §0.4 line
 * 24). A DOI prefix decides only when no source named a type: `10.1101/` is also Cold
 * Spring Harbor's journals, so it must not overrule a source calling it an article.
 *
 * @param work - the merged work
 * @returns whether it is a preprint
 */
export function isPreprintWork(
  work: Pick<CanonicalWork, "type" | "ids">,
): boolean {
  if (work.type === "preprint") return true;
  if (work.type !== "other") return false;
  const doi = normalizeDoi(work.ids.doi);
  return doi !== null && isPreprintDoi(doi);
}

// ---------------------------------------------------------------------------
// 2. Hard filters
// ---------------------------------------------------------------------------

/**
 * The papers rejected for this collection, as identifier sets. Read on each run
 * through `listRejected(profileId)` (`docs/05` §7.2's note, item 10). A store that
 * cannot be read warns and answers none, because a run that shows a dismissed paper
 * again is still a good run.
 *
 * @param store - the recommendation store
 * @param profileId - `collectionProfileId`'s
 * @param logger - where the warning goes
 * @returns every rejected work's identifiers and work key
 */
export async function readDismissed(
  store: Pick<RecommendationStore, "listRejected">,
  profileId: string,
  logger?: Logger,
): Promise<OwnedIdentifiers> {
  const doi = new Set<string>();
  const pmid = new Set<string>();
  const arxiv = new Set<string>();
  const workKeys = new Set<string>();
  try {
    for (const { work } of await store.listRejected(profileId)) {
      const ownDoi = normalizeDoi(work.ids.doi);
      const ownPmid = normalizePmid(work.ids.pmid);
      const ownArxiv = normalizeArxivId(work.ids.arxivId);
      if (ownDoi !== null) doi.add(ownDoi);
      if (ownPmid !== null) pmid.add(ownPmid);
      if (ownArxiv !== null) arxiv.add(ownArxiv);
      workKeys.add(work.workKey);
    }
  } catch (error) {
    if (!(error instanceof ResearchHelperError)) throw error;
    logger?.warn("recommend: dismissals could not be read; hiding none", {
      messageKey: error.messageKey,
    });
  }
  return { doi, pmid, arxiv, workKeys };
}

/** What both filters read. */
export interface RecommendFilterInput {
  readonly ownership: Pick<
    RecommendOwnership,
    "collection" | "collectionTitles" | "library"
  >;
  /** {@link readDismissed}'s answer. */
  readonly dismissed: OwnedIdentifiers;
  /** FR-49's toggle. Dismissed rows stay, marked. */
  readonly showDismissed: boolean;
  /** `recencyWindow(searchYears, clock)`, the same one the generators got. */
  readonly window: RecencyWindow;
  /** The per-run box (`plan/08` §0.4 line 24), off by default. */
  readonly peerReviewedOnly: boolean;
}

/** Why a candidate was dropped. */
export type RecommendDropReason =
  | "in-collection"
  | "dismissed"
  | "outside-window"
  | "published-version-owned"
  | "not-peer-reviewed"
  | "no-abstract";

/** What a filter returns. */
export interface RecommendFilterResult {
  /** In the order given. */
  readonly kept: readonly RecommendCandidate[];
  /** For `P5-T25`'s log line and `P5-T30`'s reading. Every reason, 0 when none. */
  readonly dropped: Readonly<Record<RecommendDropReason, number>>;
}

/** A preprint whose published version the user owns: a lookup (`docs/05` §7.4). */
function ownsPublishedVersion(
  work: CanonicalWork,
  library: OwnedIdentifiers,
): boolean {
  return (
    work.relatedVersionIds !== undefined &&
    isPreprintWork(work) &&
    isOwned(library, work.relatedVersionIds)
  );
}

/**
 * Older than the window's first year. A work dated ahead of the window stays, as in
 * `docs/05` §6.2's note, item 8: next year's issue is new. An undated work stays, as
 * in `applyClientRecencyFilter`: nothing shows it is outside.
 */
function isBeforeWindow(work: CanonicalWork, window: RecencyWindow): boolean {
  const year = work.publishedDate?.year;
  return year !== undefined && year < window.fromYear;
}

/** Reads identifiers, title, authors, venue, date and type. Never the abstract. */
function identifierDropReason(
  candidate: RecommendCandidate,
  input: RecommendFilterInput,
): RecommendDropReason | undefined {
  const { work } = candidate;
  const { ownership } = input;
  if (
    isOwned(ownership.collection, work.ids, work.workKey) ||
    titleMatches(candidate, ownership.collectionTitles)
  ) {
    return "in-collection";
  }
  if (
    !input.showDismissed &&
    isOwned(input.dismissed, work.ids, work.workKey)
  ) {
    return "dismissed";
  }
  if (isBeforeWindow(work, input.window)) return "outside-window";
  if (ownsPublishedVersion(work, ownership.library)) {
    return "published-version-owned";
  }
  if (input.peerReviewedOnly && isPreprintWork(work)) {
    return "not-peer-reviewed";
  }
  return undefined;
}

function filtered(
  candidates: readonly RecommendCandidate[],
  reasonOf: (candidate: RecommendCandidate) => RecommendDropReason | undefined,
): RecommendFilterResult {
  const dropped: Record<RecommendDropReason, number> = {
    "in-collection": 0,
    dismissed: 0,
    "outside-window": 0,
    "published-version-owned": 0,
    "not-peer-reviewed": 0,
    "no-abstract": 0,
  };
  const kept = candidates.filter((candidate) => {
    const reason = reasonOf(candidate);
    if (reason === undefined) return true;
    dropped[reason] += 1;
    return false;
  });
  return { kept, dropped };
}

/**
 * The filters that can run before the survivors' metadata is filled in (`docs/05`
 * §7.5's note of 2026-11-02). Never reads an abstract.
 *
 * @param candidates - `RecommendGenerationResult.candidates`
 * @param input - ownership, dismissals, window and the per-run box
 * @returns the survivors, and how many each reason dropped
 */
export function identifierFilters(
  candidates: readonly RecommendCandidate[],
  input: RecommendFilterInput,
): RecommendFilterResult {
  return filtered(candidates, (candidate) =>
    identifierDropReason(candidate, input),
  );
}

/**
 * After the fill-in: no abstract and no tldr. `CanonicalWork` has no tldr slot, and
 * the Semantic Scholar mapper puts a tldr in `abstract` when the abstract is missing,
 * so reading `abstract` reads both.
 *
 * **It runs {@link identifierFilters}' rules again,** because a fill-in can bring the
 * identifier that shows a work is a collection member, a date older than the window,
 * or the type that makes it a preprint (`docs/05` §7.4's note, item 5).
 *
 * @param candidates - the survivors with their metadata filled in
 * @param input - the same input as {@link identifierFilters}
 * @returns the survivors, and how many each reason dropped
 */
export function contentFilters(
  candidates: readonly RecommendCandidate[],
  input: RecommendFilterInput,
): RecommendFilterResult {
  return filtered(candidates, (candidate) => {
    const reason = identifierDropReason(candidate, input);
    if (reason !== undefined) return reason;
    return (candidate.work.abstract ?? "").trim() === ""
      ? "no-abstract"
      : undefined;
  });
}

// ---------------------------------------------------------------------------
// 3. The run's space
// ---------------------------------------------------------------------------

/** What one candidate reads on the run's space. */
interface SpaceReading {
  readonly similarity: number;
  readonly novelty: number;
  /** Highest-cosine centroid; absent with no vector and on the lexical space. */
  readonly nearestCentroid?: number;
}

/** One run's similarity, on one space. */
interface ScoringSpace {
  readonly id: SimilaritySpace;
  /** Comparisons one {@link read} costs, for the yield. */
  readonly comparisonsPerRead: number;
  read(work: CanonicalWork): SpaceReading;
  /** Whether {@link between} can judge this work. */
  knows(workKey: string): boolean;
  /** `undefined` unless {@link knows} holds for both. Works {@link read} has seen. */
  between(a: string, b: string): number | undefined;
}

/** Nothing to compare with, or nothing to compare: 0 on both (`docs/07` §5.2). */
const NO_READING: SpaceReading = { similarity: 0, novelty: 0 };

function specterSpace(
  profile: RecommendScoreProfile,
  vectors: ReadonlyMap<string, EmbeddingVector>,
  works: readonly CanonicalWork[],
): ScoringSpace {
  const model = profile.embeddingModel ?? "specter_v2";
  const centroids: readonly EmbeddingVector[] = profile.centroids.map(
    (row) => ({ model, values: Float32Array.from(row) }),
  );
  const members = works.flatMap(({ workKey }) => {
    const vector = vectors.get(workKey);
    return vector === undefined ? [] : [vector];
  });
  return {
    id: "specter_v2",
    comparisonsPerRead: centroids.length + members.length,
    read({ workKey }) {
      const vector = vectors.get(workKey);
      if (vector === undefined) return NO_READING;
      let nearestCentroid = 0;
      let closest = -1;
      centroids.forEach((centroid, index) => {
        const value = cosine(vector, centroid);
        if (value > closest) {
          closest = value;
          nearestCentroid = index;
        }
      });
      let nearestMember = -1;
      for (const member of members) {
        nearestMember = Math.max(nearestMember, cosine(vector, member));
      }
      return {
        similarity: (closest + 1) / 2,
        novelty: members.length === 0 ? 0 : 1 - (nearestMember + 1) / 2,
        nearestCentroid,
      };
    },
    knows: (workKey) => vectors.has(workKey),
    between(a, b) {
      const left = vectors.get(a);
      const right = vectors.get(b);
      return left === undefined || right === undefined
        ? undefined
        : cosine(left, right);
    },
  };
}

/** The collection's mean word vector, at unit length; empty when no member has text. */
function unitMean(
  vectors: readonly LexicalVector[],
): ReadonlyMap<string, number> {
  const mean = new Map<string, number>();
  for (const vector of vectors) {
    vector.terms.forEach((term, index) => {
      mean.set(term, (mean.get(term) ?? 0) + (vector.weights[index] as number));
    });
  }
  const norm = Math.sqrt(
    [...mean.values()].reduce((sum, value) => sum + value * value, 0),
  );
  return new Map([...mean].map(([term, value]) => [term, value / norm]));
}

function dotWithMean(
  vector: LexicalVector,
  mean: ReadonlyMap<string, number>,
): number {
  let dot = 0;
  vector.terms.forEach((term, index) => {
    dot += (vector.weights[index] as number) * (mean.get(term) ?? 0);
  });
  return dot;
}

/**
 * The word overlap, with the collection as its corpus (`docs/05` §5.5). `similarity`
 * is against the collection's mean word vector and `novelty` against its nearest
 * member, so the two do not collapse into one term (`docs/05` §7.4's note, item 1,
 * which holds the measurement). No `(cosine + 1) / 2`: these are in [0, 1] already.
 */
async function lexicalScoringSpace(
  works: readonly CanonicalWork[],
  spend: (comparisons: number) => Promise<void>,
): Promise<ScoringSpace> {
  const space = lexicalSpace(works);
  const members: LexicalVector[] = [];
  for (const work of works) {
    const vector = space.vector(work);
    if (vector.terms.length > 0) members.push(vector);
    await spend(VECTOR_COST_IN_COMPARISONS);
  }
  const mean = unitMean(members);
  const seen = new Map<string, LexicalVector>();
  return {
    id: "lexical",
    comparisonsPerRead: members.length + VECTOR_COST_IN_COMPARISONS,
    read(work) {
      const vector = space.vector(work);
      seen.set(work.workKey, vector);
      if (vector.terms.length === 0 || members.length === 0) return NO_READING;
      let nearestMember = 0;
      for (const member of members) {
        nearestMember = Math.max(nearestMember, space.cosine(vector, member));
      }
      return {
        similarity: dotWithMean(vector, mean),
        novelty: 1 - nearestMember,
      };
    },
    knows: (workKey) => (seen.get(workKey)?.terms.length ?? 0) > 0,
    between(a, b) {
      const left = seen.get(a);
      const right = seen.get(b);
      return left === undefined ||
        right === undefined ||
        left.terms.length === 0 ||
        right.terms.length === 0
        ? undefined
        : space.cosine(left, right);
    },
  };
}

// ---------------------------------------------------------------------------
// 4. The eight terms
// ---------------------------------------------------------------------------

/** Clip to [0, 1]. Absent and `NaN` read as 0 (`docs/07` §5.2: no `NaN`). */
function unit(value: number | undefined): number {
  return value !== undefined && value > 0 ? Math.min(1, value) : 0;
}

/** Days since the earliest day the date can name, never below 0; `undefined` undated. */
function ageDaysOf(
  work: CanonicalWork,
  nowEpochMs: number,
): number | undefined {
  const date = work.publishedDate;
  if (date === undefined || !Number.isFinite(date.year)) return undefined;
  const month = date.month ?? 1;
  const validMonth = month >= 1 && month <= 12;
  const day = validMonth ? (date.day ?? 1) : 1;
  const epochMs = Date.UTC(
    date.year,
    validMonth ? month - 1 : 0,
    day >= 1 && day <= 31 ? day : 1,
  );
  return Math.max(0, (nowEpochMs - epochMs) / DAY_MS);
}

/** What {@link scoreRecommendations} reads of a profile. */
export type RecommendScoreProfile = Pick<
  CollectionProfile,
  "id" | "centroids" | "embeddingModel" | "topAuthors" | "topVenues"
>;

/** The profile's authors and venues, keyed once per run. */
interface ProfileKeys {
  /** Normalised name → the ORCID held for it, if any. */
  readonly authorNames: ReadonlyMap<string, string | undefined>;
  readonly orcids: ReadonlySet<string>;
  readonly venueNames: ReadonlySet<string>;
  readonly issns: ReadonlySet<string>;
}

function issnKey(issn: string): string {
  return issn.replace(/-/g, "").toUpperCase();
}

function profileKeysOf(profile: RecommendScoreProfile): ProfileKeys {
  return {
    authorNames: new Map(
      profile.topAuthors.map(({ name, orcid }) => [
        normalizeTitle(name),
        orcid,
      ]),
    ),
    orcids: new Set(
      profile.topAuthors.flatMap(({ orcid }) =>
        orcid === undefined ? [] : [orcid],
      ),
    ),
    venueNames: new Set(
      profile.topVenues.map(({ name }) => normalizeTitle(name)),
    ),
    issns: new Set(
      profile.topVenues.flatMap(({ issn }) => (issn ?? []).map(issnKey)),
    ),
  };
}

/**
 * The work's authors the profile holds, as the work's own names. An ORCID decides when
 * both sides have one, so `Kim J` and another `Kim J` stay two people (`docs/11` R-18).
 */
function authorsInProfile(work: CanonicalWork, keys: ProfileKeys): string[] {
  const names = new Set<string>();
  for (const author of work.authors) {
    const name = authorName(author);
    const { orcid } = author;
    const known = keys.authorNames.get(normalizeTitle(name));
    const sameName =
      keys.authorNames.has(normalizeTitle(name)) &&
      (orcid === undefined || known === undefined || known === orcid);
    if (sameName || (orcid !== undefined && keys.orcids.has(orcid))) {
      names.add(name);
    }
  }
  return [...names];
}

function venueAffinityOf(work: CanonicalWork, keys: ProfileKeys): number {
  const names = [work.containerTitle, work.containerAbbreviation];
  if (names.some((name) => keys.venueNames.has(normalizeTitle(name ?? "")))) {
    return 1;
  }
  return (work.issn ?? []).some((issn) => keys.issns.has(issnKey(issn)))
    ? VENUE_ISSN_FAMILY
    : 0;
}

/**
 * References shared with the collection, `docs/05` §2.3's sketch. Free once the
 * references are cached, and 0 otherwise (`plan/00` §6 item 321(c)).
 */
export interface RecommendReferences {
  /** The candidate's reference DOIs, when cached. */
  ofCandidate(workKey: string): ReadonlySet<string> | undefined;
  /** Member key → its reference DOIs, as far as they are cached. */
  readonly ofCollection: ReadonlyMap<string, ReadonlySet<string>>;
}

function couplingOf(
  workKey: string,
  references: RecommendReferences | undefined,
): number {
  const own = references?.ofCandidate(workKey);
  if (references === undefined || own === undefined || own.size === 0) return 0;
  let best = 0;
  for (const refs of references.ofCollection.values()) {
    if (refs.size === 0) continue;
    let shared = 0;
    for (const ref of own) if (refs.has(ref)) shared += 1;
    best = Math.max(best, shared / Math.sqrt(refs.size * own.size));
  }
  return best;
}

function signalsOf(
  candidate: RecommendCandidate,
  reading: SpaceReading,
  authorCount: number,
  keys: ProfileKeys,
  input: RecommendScoreInput,
): RecommendationSignals {
  const { work, discoveredVia } = candidate;
  const ageDays = ageDaysOf(work, input.nowEpochMs);
  const strategies = new Set(discoveredVia.map(({ strategy }) => strategy));
  return {
    similarity: unit(reading.similarity),
    recency:
      ageDays === undefined
        ? 0
        : Math.exp(-ageDays / DAYS_PER_YEAR / RECENCY_TAU_YEARS),
    velocity:
      ageDays === undefined
        ? 0
        : unit(
            (work.citationCount ?? 0) /
              Math.max(VELOCITY_MIN_AGE_YEARS, ageDays / DAYS_PER_YEAR) /
              VELOCITY_FULL_CITATIONS_PER_YEAR,
          ),
    novelty: unit(reading.novelty),
    authorAffinity: unit(AUTHOR_AFFINITY_STEP * authorCount),
    venueAffinity: venueAffinityOf(work, keys),
    generatorAgreement: unit((strategies.size - 1) / AGREEMENT_SPAN),
    coupling: unit(couplingOf(work.workKey, input.references)),
  };
}

function scoreOf(
  signals: RecommendationSignals,
  weights: RecommendationWeights,
): number {
  const terms = Object.keys(weights) as (keyof RecommendationSignals)[];
  return Math.min(
    1,
    terms.reduce((sum, term) => sum + weights[term] * signals[term], 0),
  );
}

/**
 * §7.6's phrases, then the two strongest terms by what they added to the score. Every
 * row gets at least one: with nothing else to say it is `similarity`, which reads 0.
 * `authorAffinity` is not offered, because `author-in-collection` already says it and
 * names the people. `novelty` is offered only when the user moved the slider towards
 * Exploratory (`docs/05` §7.4's note, item 9).
 */
function reasonsOf(
  candidate: RecommendCandidate,
  signals: RecommendationSignals,
  authorNames: readonly string[],
  weights: RecommendationWeights,
  exploration: number,
): readonly RecommendationReason[] {
  const reasons: RecommendationReason[] = [];
  const { discoveredVia } = candidate;
  if (discoveredVia.some(({ strategy }) => strategy === "recommendations")) {
    reasons.push({ id: "recommended-by-semantic-scholar" });
  }
  const cites = discoveredVia.filter(
    ({ strategy }) => strategy === "forward-citations",
  ).length;
  if (cites > 0) reasons.push({ id: "cites-collection", count: cites });
  if (authorNames.length > 0) {
    reasons.push({ id: "author-in-collection", names: authorNames });
  }
  const terms = (Object.keys(weights) as (keyof RecommendationSignals)[])
    .filter(
      (term) =>
        term !== "authorAffinity" &&
        (term !== "novelty" || exploration > DEFAULT_EXPLORATION) &&
        weights[term] * signals[term] > 0,
    )
    .sort((a, b) => weights[b] * signals[b] - weights[a] * signals[a])
    .slice(0, TOP_TERM_REASONS);
  for (const id of terms) reasons.push({ id });
  return reasons.length > 0 ? reasons : [{ id: "similarity" }];
}

/** The topic a row is grouped under: `docs/07` §12.5's `Scoring` note and §5.2. */
function topicIndexOf(
  candidate: RecommendCandidate,
  reading: SpaceReading,
  topics: number,
): number | undefined {
  if (topics <= 1) return undefined;
  if (reading.nearestCentroid !== undefined) return reading.nearestCentroid;
  const groups = candidate.discoveredVia.flatMap(({ topicGroup }) =>
    topicGroup === undefined ? [] : [topicGroup],
  );
  return groups.length === 0 ? undefined : Math.min(...groups);
}

// ---------------------------------------------------------------------------
// 5. Scoring
// ---------------------------------------------------------------------------

/** The yield, shared by scoring and {@link diversify}. */
export interface RecommendYieldOptions {
  /** Checked after each yield. A cancel rejects with `OperationCancelledError`. */
  readonly token?: CancellationToken;
  /** Defaults to `defaultYieldToEventLoop`; a test counts through it. */
  readonly yieldToEventLoop?: () => Promise<void>;
}

/** What {@link scoreRecommendations} reads. */
export interface RecommendScoreInput extends RecommendYieldOptions {
  readonly profile: RecommendScoreProfile;
  /** The collection's works: novelty, the word space's corpus. */
  readonly works: readonly CanonicalWork[];
  /** `ensureEmbeddings`' vectors for members and survivors. Unread on the word space. */
  readonly vectors: ReadonlyMap<string, EmbeddingVector>;
  /** The slider, in [0, 1]. Defaults to {@link DEFAULT_EXPLORATION}. */
  readonly exploration?: number;
  readonly ownership: Pick<RecommendOwnership, "library" | "libraryTitles">;
  /** {@link readDismissed}'s answer: marks a row kept by "show dismissed". */
  readonly dismissed: OwnedIdentifiers;
  readonly references?: RecommendReferences;
  /** `ctx.clock.now()`, once per run. */
  readonly nowEpochMs: number;
}

/**
 * One row of the list. `inLibrary` is beside the record, not on it: it changes when
 * the library does and the record is stored (`docs/07` §5.2's note, item 2), so
 * `recommendation` is exactly what `RecommendationStore.put` takes.
 */
export interface RecommendationRow {
  readonly recommendation: Recommendation;
  /** The candidate's records, for the window's import (`P5-T27`). Never stored. */
  readonly records: RecommendCandidate["records"];
  /** FR-46: elsewhere in the library. */
  readonly inLibrary: boolean;
  /**
   * The item a title match named, so an import links it rather than writing a second
   * copy (`docs/08` §5.4's section "The results", decision 12). Absent for a row owned
   * through an identifier, which the importer's own index finds.
   */
  readonly existingItemID?: number;
  /** FR-49: kept only because the run asked to show dismissed papers. */
  readonly dismissed: boolean;
  /** {@link isPreprintWork}, for the label on every preprint row. */
  readonly preprint: boolean;
  /** FR-46: a library row, or a dismissed one, starts unticked. */
  readonly checkedByDefault: boolean;
}

/** What {@link scoreRecommendations} hands {@link diversify}. */
export interface RecommendationScoring {
  /** Highest score first; a tie goes to the smaller work key, so two runs agree. */
  readonly rows: readonly RecommendationRow[];
  readonly similaritySpace: SimilaritySpace;
  /** This run's similarity, for {@link diversify} only. */
  readonly space: Pick<ScoringSpace, "knows" | "between">;
}

function yieldMeter(
  options: RecommendYieldOptions,
): (comparisons: number) => Promise<void> {
  const yieldNow = options.yieldToEventLoop ?? defaultYieldToEventLoop;
  let spent = 0;
  return async (comparisons) => {
    spent += comparisons;
    if (spent < SCORE_YIELD_EVERY_COMPARISONS) return;
    spent = 0;
    await yieldNow();
    options.token?.throwIfCancelled();
  };
}

/**
 * `docs/05` §7.4's eight terms on each survivor, ranked, with reasons and its topic.
 * Nothing is dropped here, and the score is not rescaled across the batch.
 *
 * **The profile decides the space:** centroids mean SPECTER2, and a run with none is
 * on the word space, a keyed run whose vectors all failed included (`docs/05` §7.2's
 * note, item 1).
 *
 * @param candidates - {@link contentFilters}' survivors
 * @param input - the profile, the collection, the vectors, the slider and the marks
 * @returns the ranked rows and what {@link diversify} needs
 * @throws RangeError from `cosine` on two models or two lengths: a defect, not a low
 *   score; from {@link recommendationWeights} on a bad slider;
 *   `OperationCancelledError` after a yield
 */
export async function scoreRecommendations(
  candidates: readonly RecommendCandidate[],
  input: RecommendScoreInput,
): Promise<RecommendationScoring> {
  input.token?.throwIfCancelled();
  const exploration = input.exploration ?? DEFAULT_EXPLORATION;
  const weights = recommendationWeights(exploration);
  const spend = yieldMeter(input);
  const { profile, ownership } = input;
  const space =
    profile.centroids.length > 0
      ? specterSpace(profile, input.vectors, input.works)
      : await lexicalScoringSpace(input.works, spend);
  const keys = profileKeysOf(profile);

  const rows: RecommendationRow[] = [];
  for (const candidate of candidates) {
    const { work } = candidate;
    const reading = space.read(work);
    const authorNames = authorsInProfile(work, keys);
    const signals = signalsOf(
      candidate,
      reading,
      authorNames.length,
      keys,
      input,
    );
    const topicIndex = topicIndexOf(
      candidate,
      reading,
      profile.centroids.length,
    );
    const ownedById = isOwned(ownership.library, work.ids, work.workKey);
    const titleItem = ownedById
      ? undefined
      : titleMatchItem(candidate, ownership.libraryTitles);
    const inLibrary = ownedById || titleItem !== undefined;
    const dismissed = isOwned(input.dismissed, work.ids, work.workKey);
    rows.push({
      recommendation: {
        id: recommendationId(profile.id, work.workKey),
        profileId: profile.id,
        work,
        score: scoreOf(signals, weights),
        signals,
        similaritySpace: space.id,
        reasons: reasonsOf(
          candidate,
          signals,
          authorNames,
          weights,
          exploration,
        ),
        discoveredVia: candidate.discoveredVia.map(
          ({ sourceId, strategy }) => ({
            sourceId,
            strategy,
          }),
        ),
        ...(topicIndex !== undefined && { topicIndex }),
        generatedAtEpochMs: input.nowEpochMs,
      },
      records: candidate.records,
      inLibrary,
      ...(titleItem !== undefined && { existingItemID: titleItem }),
      dismissed,
      preprint: isPreprintWork(work),
      checkedByDefault: !inLibrary && !dismissed,
    });
    await spend(space.comparisonsPerRead);
  }
  rows.sort(
    (a, b) =>
      b.recommendation.score - a.recommendation.score ||
      (a.recommendation.work.workKey < b.recommendation.work.workKey ? -1 : 1),
  );
  return { rows, similaritySpace: space.id, space };
}

// ---------------------------------------------------------------------------
// 6. Diversity
// ---------------------------------------------------------------------------

/** What {@link diversify} takes beside the scoring. */
export interface DiversifyOptions extends RecommendYieldOptions {
  /** Defaults to {@link RECOMMEND_TOP_K}. */
  readonly topK?: number;
}

/** The people a row counts for: its first and last authors (`docs/05` §7.4's note, item 6). */
function capAuthorsOf(work: CanonicalWork): readonly string[] {
  const { authors } = work;
  const ends = [authors[0], authors[authors.length - 1]];
  return [
    ...new Set(
      ends.flatMap((author) =>
        author === undefined ? [] : [normalizeTitle(authorName(author))],
      ),
    ),
  ].filter((key) => key !== "");
}

/**
 * `docs/05` §7.5: at most {@link MAX_PER_AUTHOR} rows per author and
 * {@link MAX_PER_VENUE} per venue, picked by maximal marginal relevance, λ
 * {@link MMR_LAMBDA}, up to the top K. The caps are hard, so a narrow pool gives a
 * short list. A row with no vector pays the full penalty once something is picked:
 * no vector is no evidence that it differs.
 *
 * @param scoring - {@link scoreRecommendations}' answer
 * @param options - the top K, and the yield
 * @returns the rows, in the order picked
 * @throws RangeError when the top K is not a positive integer;
 *   `OperationCancelledError` after a yield
 */
export async function diversify(
  scoring: RecommendationScoring,
  options: DiversifyOptions = {},
): Promise<readonly RecommendationRow[]> {
  const topK = options.topK ?? RECOMMEND_TOP_K;
  if (!Number.isInteger(topK) || topK < 1) {
    throw new RangeError(
      `[research-helper] diversify: topK must be a positive integer, got ${String(topK)}`,
    );
  }
  options.token?.throwIfCancelled();
  const spend = yieldMeter(options);
  const { space } = scoring;
  const perAuthor = new Map<string, number>();
  const perVenue = new Map<string, number>();
  const picked: RecommendationRow[] = [];
  let open = scoring.rows.map((row) => ({
    row,
    key: row.recommendation.work.workKey,
    authors: capAuthorsOf(row.recommendation.work),
    venue: normalizeTitle(row.recommendation.work.containerTitle ?? ""),
    nearest: undefined as number | undefined,
  }));

  while (picked.length < topK) {
    open = open.filter(
      ({ authors, venue }) =>
        authors.every(
          (author) => (perAuthor.get(author) ?? 0) < MAX_PER_AUTHOR,
        ) && (perVenue.get(venue) ?? 0) < MAX_PER_VENUE,
    );
    let best: (typeof open)[number] | undefined;
    let bestValue = -Infinity;
    for (const entry of open) {
      let penalty = 0;
      if (picked.length > 0) {
        penalty = space.knows(entry.key) ? (entry.nearest ?? 0) : 1;
      }
      const value =
        MMR_LAMBDA * entry.row.recommendation.score -
        (1 - MMR_LAMBDA) * penalty;
      if (value > bestValue) {
        best = entry;
        bestValue = value;
      }
    }
    if (best === undefined) break;
    const chosen = best;
    picked.push(chosen.row);
    for (const author of chosen.authors) {
      perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
    }
    if (chosen.venue !== "") {
      perVenue.set(chosen.venue, (perVenue.get(chosen.venue) ?? 0) + 1);
    }
    open = open.filter((entry) => entry !== chosen);
    for (const entry of open) {
      const value = space.between(chosen.key, entry.key);
      if (value !== undefined) {
        entry.nearest = Math.max(entry.nearest ?? -Infinity, value);
      }
    }
    await spend(open.length);
  }
  return picked;
}
