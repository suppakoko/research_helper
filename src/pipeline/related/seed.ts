/**
 * Seed resolution for "Find related papers": from the selected item to the
 * identifiers the generators need, or to a title match, a list to pick from, or
 * an actionable error (FR-13 scenario 3, FR-14; `docs/05` §6.1).
 *
 * **Scope.** `P5-T11`. {@link resolveSeed} is `docs/07` §12.2's `ResolvingSeed`
 * and {@link expandSeedIds} its `ExpandingIds`. They are two stages because a
 * run given `chosenSeed` starts at the second. The caller of both, and the
 * builder of {@link SeedResolverDeps}, is `createRelatedPipeline`
 * (`src/pipeline/related/relatedPipeline.ts`, `P5-T14`). The item reaches here
 * already read: `fromZoteroItem` supplies the `CanonicalWork` through that
 * pipeline's Zotero port, so nothing in this file names `Zotero`.
 *
 * **The threshold** is `docs/05` §6.1's, and {@link titleMatchPasses} is that
 * section in code. Every number is `src/sources/shared/dedupe.ts`'s constant, so
 * tuning the cascade moves this too. **They are starting values, not a
 * measurement:** one real Crossref search exists, and no real Semantic Scholar
 * answer does (`plan/08` `P5-T30`'s note of 2026-11-02 measures them).
 *
 * **Without a key nothing here asks Semantic Scholar** (`plan/08` §0.2 item 19).
 * `matchTitle` and `lookupKeyed` gate themselves on the key they read, so a store
 * that says it holds a key whose value is blank or unreadable sends nothing either
 * (`plan/00` §6 item 339(b)). {@link resolveSeed} asks `hasUsableApiKey` for the same
 * reason, and this file never calls `hasApiKey` or the unkeyed `lookup`.
 *
 * **Only a title or an identifier leaves the machine** (`docs/09` §3 row 2): no
 * abstract, note or tag is passed to any call below. Nothing is cached: a title
 * match has no signal kind and no row in `docs/05` §9.2.
 *
 * **A service's failure is a {@link SeedSourceFailure}, not a failed run**, unless
 * it could have changed the answer (`docs/05` §6.1). Only a
 * {@link ResearchHelperError} counts as a service's failure: a cancellation, or
 * an error of another kind (a bug), propagates from every call.
 */

import {
  OperationCancelledError,
  ResearchHelperError,
  type SerializedError,
} from "../../core/errors";
import type { Clock } from "../../core/clock";
import type { CanonicalWork } from "../../model/canonicalWork";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizePmid,
  type ArxivId,
  type Doi,
  type ExternalIds,
} from "../../model/ids";
import { merge } from "../../model/merge";
import type { SourceRecord } from "../../model/sourceRecord";
import { ARXIV_DOI_PREFIX } from "../../sources/arxiv/mapper";
import type { CrossrefSource } from "../../sources/crossref/crossrefSource";
import type { PmcidConverter } from "../../sources/pubmed/idConverter";
import {
  ARXIV_DATACITE_DOI,
  type SemanticScholarSource,
} from "../../sources/semanticscholar/semanticscholarSource";
import {
  candidateFromLibraryItem,
  dedupeRecords,
  innerNumbersDiffer,
  isTitleComparable,
  LEVSIM_CORROBORATED_THRESHOLD,
  LEVSIM_DUPLICATE_THRESHOLD,
  levSim,
  MAX_YEAR_DELTA,
  normalizeTitle,
  seriesMarkersDiffer,
  toCandidate,
  yearDelta,
  type DedupCandidate,
} from "../../sources/shared/dedupe";
import type { SourceCallContext } from "../../sources/types";

// ---------------------------------------------------------------------------
// 1. What a run gets back — docs/07 §12.2
// ---------------------------------------------------------------------------

/** What these two stages call. Built by `createRelatedPipeline` (`P5-T14`). */
export interface SeedResolverDeps {
  readonly semanticscholar: Pick<
    SemanticScholarSource,
    "hasUsableApiKey" | "lookupKeyed" | "matchTitle"
  >;
  readonly crossref: Pick<CrossrefSource, "matchTitle">;
  /** `createPmcidConverter`'s function, the only resolver a keyless run has. */
  readonly convertPmcids: PmcidConverter;
  /** Stamps a merged title match, as `merge` asks. */
  readonly clock: Pick<Clock, "now">;
}

/** A service that failed during a stage, for `P5-T14`'s per-source rows. */
export interface SeedSourceFailure {
  readonly source: "semanticscholar" | "crossref" | "pmc-idconv";
  readonly step: "expand" | "title";
  /** Redacted by `toSerialized`, so a job record may hold it. */
  readonly error: SerializedError;
}

/** One seed the run can start from. */
export interface ResolvedSeed {
  readonly work: CanonicalWork;
  /** `docs/08` §5.3's "matched by title" banner reads this. */
  readonly matchedByTitle: boolean;
}

/**
 * `docs/07` §12.2's two successful endings of `ResolvingSeed`. Under `"choose"`
 * the window asks (FR-14), and the pick comes back as `chosenSeed`: one of
 * `candidates`, closest title first, each one distinct work.
 */
export type SeedResolution =
  | {
      readonly kind: "resolved";
      readonly seed: ResolvedSeed;
      readonly failures: readonly SeedSourceFailure[];
    }
  | {
      readonly kind: "choose";
      readonly candidates: readonly CanonicalWork[];
      readonly failures: readonly SeedSourceFailure[];
    };

/** What {@link expandSeedIds} returns. `work.workKey` is the seed's, unchanged. */
export interface ExpandedSeed {
  readonly work: CanonicalWork;
  readonly failures: readonly SeedSourceFailure[];
}

/** Why {@link SeedUnresolvedError} was thrown. */
export type SeedUnresolvedReason = "no-identifier" | "no-match" | "gone";

const SEED_UNRESOLVED_MESSAGE_KEY = {
  "no-identifier": "rh-error-seed-no-identifier",
  "no-match": "rh-error-seed-no-match",
  gone: "rh-error-seed-gone",
} as const satisfies Record<SeedUnresolvedReason, string>;

/**
 * `docs/07` §10.1: a seed nothing can be looked up from. Thrown by
 * {@link resolveSeed}, and with reason `"gone"` by `createRelatedPipeline` (`P5-T14`),
 * which ends the job `Failed` on any of them. The message never holds the item's
 * title, because this reaches the log.
 */
export class SeedUnresolvedError extends ResearchHelperError {
  readonly code: string = "SEED_UNRESOLVED";
  readonly messageKey: string;
  readonly retryable: boolean = false;

  constructor(readonly reason: SeedUnresolvedReason) {
    super(`Seed could not be resolved: ${reason}`, { reason });
    this.messageKey = SEED_UNRESOLVED_MESSAGE_KEY[reason];
  }
}

// ---------------------------------------------------------------------------
// 2. The threshold — docs/05 §6.1
// ---------------------------------------------------------------------------

/**
 * `docs/05` §6.1: does this candidate's title match the seed's closely enough?
 * The §11.3.3 guards come first: a differing series marker or number never
 * passes. The corroborated row comes next, because it is the only way a title
 * under `MIN_FUZZY_TITLE_TOKENS` words can pass.
 *
 * @param seed - the seed, reduced by `candidateFromLibraryItem`
 * @param candidate - a service's answer, reduced by `toCandidate`
 * @returns whether the candidate passes; an unknown year or author never corroborates
 */
export function titleMatchPasses(
  seed: DedupCandidate,
  candidate: DedupCandidate,
): boolean {
  if (seriesMarkersDiffer(seed, candidate)) return false;
  if (innerNumbersDiffer(seed, candidate)) return false;
  const similarity = levSim(seed.title, candidate.title);
  const delta = yearDelta(seed, candidate);
  if (
    similarity >= LEVSIM_CORROBORATED_THRESHOLD &&
    delta !== undefined &&
    delta <= MAX_YEAR_DELTA &&
    seed.firstAuthor !== undefined &&
    seed.firstAuthor === candidate.firstAuthor
  ) {
    return true;
  }
  return (
    similarity >= LEVSIM_DUPLICATE_THRESHOLD &&
    isTitleComparable(seed) &&
    isTitleComparable(candidate)
  );
}

/**
 * `docs/05` §6.1, additions 2 and 3: could this record be a seed at all? The
 * recorded non-paper is a Crossref `component`, which maps to `"other"` with no
 * date. Semantic Scholar's unclassified papers also read `"other"`, so a year
 * keeps a record in.
 */
function isSeedWorthy(record: SourceRecord): boolean {
  const { work } = record;
  if (!hasIdentifier(work.ids, true)) return false;
  return work.type !== "other" || toCandidate(record).year !== undefined;
}

// ---------------------------------------------------------------------------
// 3. Identifiers
// ---------------------------------------------------------------------------

/**
 * Whether these identifiers can start a run. A Semantic Scholar corpus id counts
 * only with a key, because no other service reads one.
 */
function hasIdentifier(ids: ExternalIds, keyed: boolean): boolean {
  return (
    ids.doi !== undefined ||
    ids.pmid !== undefined ||
    ids.pmcid !== undefined ||
    ids.arxivId !== undefined ||
    (keyed && ids.s2CorpusId !== undefined)
  );
}

/** `own` with what it lacks taken from `found`. `url` is a landing page, not an id. */
function fillMissingIds(
  own: ExternalIds,
  found: Partial<ExternalIds>,
): ExternalIds {
  const { doi, pmid, pmcid, arxivId, s2CorpusId, openAlexId } = found;
  return {
    ...(doi !== undefined && { doi }),
    ...(pmid !== undefined && { pmid }),
    ...(pmcid !== undefined && { pmcid }),
    ...(arxivId !== undefined && { arxivId }),
    ...(s2CorpusId !== undefined && { s2CorpusId }),
    ...(openAlexId !== undefined && { openAlexId }),
    ...own,
  };
}

/** The arXiv id inside `10.48550/arXiv.<id>`, or `undefined` for any other DOI. */
function arxivIdFromDoi(doi: Doi): ArxivId | undefined {
  if (!ARXIV_DATACITE_DOI.test(doi)) return undefined;
  return normalizeArxivId(doi.slice(ARXIV_DOI_PREFIX.length)) ?? undefined;
}

/**
 * What `lookup` is asked with. `toSemanticScholarId` prefers a DOI, and `P2-T05`
 * measured `/paper/batch` refusing `10.48550/arXiv.*` (`SEMANTICSCHOLAR_BATCH_DATACITE_ID`
 * in `test/support/semanticscholarRecordedRequests.ts`), so such a DOI is left out
 * and the next identifier goes instead.
 */
function lookupIds(ids: ExternalIds): Partial<ExternalIds> {
  if (ids.doi === undefined || arxivIdFromDoi(ids.doi) === undefined) {
    return ids;
  }
  const { doi: _unreadable, ...others } = ids;
  return others;
}

/** Rethrow anything that is not a service's failure; hand the rest back. */
function serviceFailure(error: unknown): ResearchHelperError {
  if (
    error instanceof ResearchHelperError &&
    !(error instanceof OperationCancelledError)
  ) {
    return error;
  }
  throw error;
}

// ---------------------------------------------------------------------------
// 4. The two stages
// ---------------------------------------------------------------------------

/**
 * `docs/07` §12.2's `ExpandingIds`: fill in the identifiers this seed lacks.
 * Semantic Scholar with a key; the PMC converter for a PMCID without one, or when
 * Semantic Scholar did not answer with a record. A failure here costs identifiers,
 * not the run.
 *
 * @param seed - a resolved seed's work, or `chosenSeed`
 * @param deps - the services
 * @param ctx - the cancellation token
 * @returns the work with its identifiers filled in, its own values winning
 * @throws OperationCancelledError when cancelled
 */
export async function expandSeedIds(
  seed: CanonicalWork,
  deps: SeedResolverDeps,
  ctx: SourceCallContext,
): Promise<ExpandedSeed> {
  ctx.token.throwIfCancelled();
  const failures: SeedSourceFailure[] = [];
  const doiArxivId =
    seed.ids.doi === undefined ? undefined : arxivIdFromDoi(seed.ids.doi);
  let ids = fillMissingIds(
    seed.ids,
    doiArxivId === undefined ? {} : { arxivId: doiArxivId },
  );

  let answered = false;
  try {
    const [record] = await deps.semanticscholar.lookupKeyed(
      [lookupIds(ids)],
      ctx,
    );
    if (record !== undefined) {
      ids = fillMissingIds(ids, record.work.ids);
      answered = true;
    }
  } catch (error) {
    failures.push({
      source: "semanticscholar",
      step: "expand",
      error: serviceFailure(error).toSerialized(),
    });
  }

  const { pmcid } = ids;
  if (
    !answered &&
    pmcid !== undefined &&
    (ids.doi === undefined || ids.pmid === undefined)
  ) {
    try {
      const converted = (await deps.convertPmcids([pmcid], ctx.token)).get(
        pmcid,
      );
      const doi = normalizeDoi(converted?.doi);
      const pmid = normalizePmid(converted?.pmid);
      ids = fillMissingIds(ids, {
        ...(doi !== null && { doi }),
        ...(pmid !== null && { pmid }),
      });
    } catch (error) {
      failures.push({
        source: "pmc-idconv",
        step: "expand",
        error: serviceFailure(error).toSerialized(),
      });
    }
  }
  return { work: { ...seed, ids }, failures };
}

/**
 * `docs/07` §12.2's `ResolvingSeed`. A seed with an identifier resolves with no
 * request. Otherwise its title is asked of Crossref, and of Semantic Scholar with
 * a key, and `docs/05` §6.1's threshold decides.
 *
 * @param seed - the item as `fromZoteroItem` read it
 * @param deps - the services
 * @param ctx - the cancellation token
 * @returns one seed, or the works the user must choose between
 * @throws SeedUnresolvedError with reason `"no-identifier"` when there is no
 *   identifier and no usable title, or `"no-match"` when every service answered
 *   and no candidate passed
 * @throws ResearchHelperError the first service's own, when none passed and a
 *   service failed, because that service might have held the paper
 * @throws OperationCancelledError when cancelled
 */
export async function resolveSeed(
  seed: CanonicalWork,
  deps: SeedResolverDeps,
  ctx: SourceCallContext,
): Promise<SeedResolution> {
  ctx.token.throwIfCancelled();
  const identified = hasIdentifier(seed.ids, false);
  const keyed = !identified && (await deps.semanticscholar.hasUsableApiKey());
  if (identified || hasIdentifier(seed.ids, keyed)) {
    return {
      kind: "resolved",
      seed: { work: seed, matchedByTitle: false },
      failures: [],
    };
  }
  // A title that reads as a DOI is not a title: `query.bibliographic` refuses one
  // (`buildCrossrefTitleSearchRequest`), and punctuation alone compares as nothing.
  const normalizedTitle = normalizeTitle(seed.title);
  if (normalizedTitle === "" || normalizeDoi(seed.title) !== null) {
    throw new SeedUnresolvedError("no-identifier");
  }
  return matchByTitle(seed, normalizedTitle, keyed, deps, ctx);
}

/** One service's answer to a title, or the failure {@link serviceFailure} let through. */
interface TitleAnswer {
  readonly records: readonly SourceRecord[];
  readonly failure:
    | {
        readonly source: SeedSourceFailure["source"];
        readonly error: ResearchHelperError;
      }
    | undefined;
}

/** Ask one service, turning its failure into a {@link TitleAnswer}. */
async function askTitle(
  source: SeedSourceFailure["source"],
  ask: () => Promise<readonly SourceRecord[]>,
): Promise<TitleAnswer> {
  try {
    return { records: await ask(), failure: undefined };
  } catch (error) {
    return { records: [], failure: { source, error: serviceFailure(error) } };
  }
}

/** The title half of {@link resolveSeed}. */
async function matchByTitle(
  seed: CanonicalWork,
  normalizedTitle: string,
  keyed: boolean,
  deps: SeedResolverDeps,
  ctx: SourceCallContext,
): Promise<SeedResolution> {
  // Different hosts, so concurrently (`docs/05` §9.4).
  const answers = await Promise.all([
    ...(keyed
      ? [
          askTitle("semanticscholar", () =>
            deps.semanticscholar.matchTitle(seed.title, ctx),
          ),
        ]
      : []),
    askTitle("crossref", () => deps.crossref.matchTitle(seed.title, ctx)),
  ]);
  ctx.token.throwIfCancelled();
  const records = answers.flatMap((answer) => answer.records);
  const failed = answers.flatMap((answer) => answer.failure ?? []);

  const seedCandidate = candidateFromLibraryItem({
    itemID: 0,
    deleted: false,
    title: seed.title,
    year: seed.publishedDate?.year ?? seed.onlineDate?.year,
    firstAuthorFamily: seed.authors[0]?.family,
  });
  const passing = records.filter(
    (record) =>
      isSeedWorthy(record) &&
      titleMatchPasses(seedCandidate, toCandidate(record)),
  );
  const [firstFailure] = failed;
  if (passing.length === 0) {
    if (firstFailure !== undefined) throw firstFailure.error;
    throw new SeedUnresolvedError("no-match");
  }

  const nowEpochMs = deps.clock.now();
  const closeness = (work: CanonicalWork): number =>
    levSim(normalizedTitle, normalizeTitle(work.title));
  const works = dedupeRecords(passing)
    .groups.map((group) => merge(group.records, nowEpochMs).work)
    .sort((a, b) => closeness(b) - closeness(a));
  const failures = failed.map(({ source, error }): SeedSourceFailure => ({
    source,
    step: "title",
    error: error.toSerialized(),
  }));
  const [only] = works;
  if (only !== undefined && works.length === 1) {
    return {
      kind: "resolved",
      seed: { work: only, matchedByTitle: true },
      failures,
    };
  }
  return { kind: "choose", candidates: works, failures };
}
