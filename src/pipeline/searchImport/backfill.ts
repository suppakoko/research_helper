/**
 * `docs/02` §10.4's **backfill pass** — the body of `docs/07` §12.1's
 * `BackfillingAbstracts` state.
 *
 * **Scope.** `P2-T12`. After `Merging` and `Deduping`, a `CanonicalWork` that
 * still has no abstract **and** has a DOI gets one targeted, **batched**
 * lookup per ladder step, stopping at the first step that finds one.
 *
 * ## What this file decides, and where each decision comes from
 *
 * - **Batched, never per record.** §10.4: "Batch these: never issue one lookup
 *   per record. A 200-record collection needs **2 Europe PMC calls and 2 S2
 *   calls**, not 400 requests." Each step is **one** call to that adapter's
 *   `docs/07` §4.2 `lookup` — "Batch lookup by external identifier" — with
 *   every DOI still missing; the adapter cuts it into requests (Europe PMC 100
 *   DOIs a request, `src/sources/europepmc/query.ts`'s
 *   `EUROPEPMC_DOI_LOOKUP_BATCH`; Semantic Scholar ~100 ids a `/paper/batch`,
 *   §6.8, `SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT`). §4.2's per-record
 *   `fetchAbstract` is **not** called: the Phase 1 body of this stage asked it
 *   once per work, which is the thing §10.4 forbids.
 * - **The ladder is §10.4's order** — Europe PMC, then Semantic Scholar —
 *   {@link ABSTRACT_BACKFILL_LADDER}. **§10.4's step 3, Crossref, is not in
 *   it**: the owner dropped it on 2026-10-15 (`plan/00` §6 item 193) — no
 *   document gave its "small remainder" a number, and Crossref's
 *   `/works/{doi}` is one request per record.
 * - **Only ticked databases are asked** (owner, 2026-10-15, item 194). The run
 *   hands its selection in {@link AbstractBackfillDeps.selected}; a ladder
 *   step outside it is skipped with status `"not-selected"`, so a database
 *   the user unticked receives no DOI.
 * - **Stop at the first hit.** A work a step answered with a non-empty
 *   abstract leaves the ladder; a work the step found *without* an abstract,
 *   or did not find, stays for the next step.
 * - **Provenance.** The winning step's source is written to
 *   `provenance.fieldOrigin.abstract`, so the merged record still answers
 *   "where did this abstract come from". `seenIn` and `recordIds` are left as
 *   `Merging` wrote them: the lookup's records are not merged into the work.
 * - **A backfilled work is restamped** (owner, 2026-10-19, `plan/00` §6 item
 *   198). `docs/07` §5.1 defines `normalizedAtEpochMs` as "ms since epoch when
 *   this canonical record was last rebuilt", and filling the abstract rebuilds
 *   it, so a work the pass changed gets {@link AbstractBackfillDeps.now}'s
 *   reading, taken once after the last step. A work the pass left alone keeps
 *   `Merging`'s stamp.
 * - **What the pass can cost is budgeted up front** by
 *   {@link abstractBackfillRequestBound}, which the pipeline's `estimate()`
 *   adds to the search's own requests (`plan/00` §6 item 198).
 * - **No fabricated abstract** (`docs/11` R-6 / R-17, FR-21). A work no step
 *   answers keeps no abstract; the gap is the import summary's coverage
 *   figure, not an invented string. The one fallback is the source's own:
 *   the Semantic Scholar mapper reads `tldr.text` when `abstract` is missing
 *   (`docs/02` §6.7, "a fallback when an abstract is missing").
 * - **A failed step is not a failed import.** A throw from a step is a
 *   warning naming the source and the error's code; the works it would have
 *   answered go on to the next step. Only cancellation propagates.
 * - **Cancellable and checkpointed** (`docs/07` §12.1 and §7.4). The token is
 *   checked before every step and by the adapter before every request; the
 *   checkpoint is written after every step. A cancel throws
 *   `OperationCancelledError` and returns nothing, so the caller still holds
 *   the merged works exactly as `Merging` left them.
 *
 * ## Layering
 *
 * `pipeline/` may import `core/`, `model/` and `sources/` (`docs/07` §2.3).
 * The adapters arrive through the registry, so this file never sees an HTTP
 * client, a key or a URL.
 */

import { OperationCancelledError } from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { Logger } from "../../core/logger";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { SourceId } from "../../model/ids";
import { EUROPEPMC_DOI_LOOKUP_BATCH } from "../../sources/europepmc/query";
import type { SourceRegistry } from "../../sources/registry";
import { SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT } from "../../sources/semanticscholar/query";
import { serialize } from "./stages";

/**
 * `docs/02` §10.4's ladder, in order, without step 3 (Crossref) — see the
 * module header for why that step is withheld.
 */
export const ABSTRACT_BACKFILL_LADDER: readonly SourceId[] = [
  "europepmc",
  "semanticscholar",
];

/**
 * DOIs one request of each ladder step carries — the adapters' own batch
 * sizes (Europe PMC: `EUROPEPMC_DOI_LOOKUP_BATCH`, one `DOI:"…" OR …` search
 * per 100 DOIs; Semantic Scholar: `SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT`,
 * one `/paper/batch` per about 100 ids). A ladder source missing here is
 * budgeted one DOI a request, the safe side of an estimate.
 */
const ABSTRACT_BACKFILL_BATCH: Readonly<Partial<Record<SourceId, number>>> = {
  europepmc: EUROPEPMC_DOI_LOOKUP_BATCH,
  semanticscholar: SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT,
};

/**
 * The most requests {@link backfillAbstracts} can send for `works` works
 * (`plan/00` §6 items 180 and 198).
 *
 * **An upper bound, not a forecast.** The pass asks only works that reached it
 * with no abstract and a DOI, and a later step only those an earlier step did
 * not answer; this charges every ladder step for every work. Per step: one
 * request per batch (Europe PMC 100 works, Semantic Scholar about 100), and
 * only for a step the pass could actually ask — a database the user ticked
 * (item 194) whose adapter is registered with a `lookup`. Nothing is charged
 * for `works <= 0`.
 *
 * @param works - the most works the run can hold when the pass starts
 * @param selected - the databases ticked for the run
 * @param sources - the registry, to skip a step with no adapter or `lookup`
 * @param ladder - defaults to {@link ABSTRACT_BACKFILL_LADDER}
 * @returns the request count, 0 or more
 */
export function abstractBackfillRequestBound(
  works: number,
  selected: readonly SourceId[],
  sources: Pick<SourceRegistry, "get">,
  ladder: readonly SourceId[] = ABSTRACT_BACKFILL_LADDER,
): number {
  if (works <= 0) return 0;
  return ladder.reduce((total, sourceId) => {
    if (!selected.includes(sourceId)) return total;
    if (sources.get(sourceId)?.lookup === undefined) return total;
    const batch = Math.max(1, ABSTRACT_BACKFILL_BATCH[sourceId] ?? 1);
    return total + Math.ceil(works / batch);
  }, 0);
}

/** What one ladder step did. */
export interface AbstractBackfillStep {
  readonly sourceId: SourceId;
  /**
   * `"asked"` — the adapter's `lookup` was called; `"no-adapter"` — the
   * registry holds no adapter for the source, or one without `lookup`;
   * `"failed"` — `lookup` threw something other than a cancellation;
   * `"not-selected"` — the user did not tick this database for the run.
   */
  readonly status: "asked" | "no-adapter" | "failed" | "not-selected";
  /** Distinct DOIs sent in this step (0 when no adapter was asked). */
  readonly asked: number;
  /** Of {@link asked}, how many came back with a non-empty abstract. */
  readonly found: number;
}

/** The pass's own account of itself, for the log and for tests. */
export interface AbstractBackfillReport {
  /** Works that reached the pass with no abstract. */
  readonly missing: number;
  /** Of {@link missing}, those with no DOI — never asked (card step 1). */
  readonly withoutDoi: number;
  /** Works that left the pass with an abstract they did not have. */
  readonly backfilled: number;
  /** One entry per ladder step reached, in ladder order. */
  readonly steps: readonly AbstractBackfillStep[];
}

/** What {@link backfillAbstracts} hands back. */
export interface AbstractBackfillResult {
  /** The input works, in order; backfilled ones replaced, the rest identical. */
  readonly works: readonly CanonicalWork[];
  readonly report: AbstractBackfillReport;
  /** One line per failed step, in ladder order. Never a response body. */
  readonly warnings: readonly string[];
}

/** What the pass needs from the run. */
export interface AbstractBackfillDeps {
  /** `PipelineContext.sources`; only `get` is read. */
  readonly sources: Pick<SourceRegistry, "get">;
  readonly token: CancellationToken;
  /** The stage's reporter: one unit of progress per ladder step. */
  readonly progress?: ProgressReporter;
  /** `PipelineContext.checkpoint`, written after every step. */
  readonly checkpoint?: (state: unknown) => Promise<void>;
  readonly logger?: Logger;
  /** Defaults to {@link ABSTRACT_BACKFILL_LADDER}; a test seam only. */
  readonly ladder?: readonly SourceId[];
  /**
   * The databases the user ticked for this run (`SearchImportInput.sourceIds`).
   * A ladder step outside it is skipped (item 194). Absent means no
   * restriction — a test seam; the pipeline always passes it.
   */
  readonly selected?: readonly SourceId[];
  /**
   * `PipelineContext.clock.now`, read once after the last step and stamped on
   * every work the pass changed as its `normalizedAtEpochMs` (item 198).
   * Absent keeps the old stamp — a test seam; the pipeline always passes it.
   */
  readonly now?: () => number;
}

/** True when a work has no usable abstract. */
function lacksAbstract(work: CanonicalWork): boolean {
  return work.abstract === undefined || work.abstract.trim() === "";
}

/**
 * Run `docs/02` §10.4's backfill pass over `works`.
 *
 * @param works - the merged works, in the order the run holds them
 * @param deps - the registry, the token and the optional reporter, checkpoint
 *   and logger
 * @returns the works with every backfilled abstract filled in, the report, and
 *   the warnings of failed steps
 * @throws OperationCancelledError when the token is cancelled before or during
 *   a step; nothing is returned, so the caller's works are untouched
 */
export async function backfillAbstracts(
  works: readonly CanonicalWork[],
  deps: AbstractBackfillDeps,
): Promise<AbstractBackfillResult> {
  const ladder = deps.ladder ?? ABSTRACT_BACKFILL_LADDER;

  // DOI → the positions of the works still waiting for an abstract. A list,
  // not one index: two works can carry one DOI when `Merging` kept them apart
  // (a flagged pair), and both deserve the answer.
  const pending = new Map<string, number[]>();
  let missing = 0;
  let withoutDoi = 0;
  works.forEach((work, index) => {
    if (!lacksAbstract(work)) return;
    missing += 1;
    const doi = work.ids.doi;
    if (doi === undefined) {
      withoutDoi += 1;
      return;
    }
    const key = doi.toLowerCase();
    const at = pending.get(key);
    if (at === undefined) pending.set(key, [index]);
    else at.push(index);
  });

  const filled = new Map<number, { abstract: string; sourceId: SourceId }>();
  const steps: AbstractBackfillStep[] = [];
  const warnings: string[] = [];

  if (pending.size > 0) deps.progress?.setProgress(0, ladder.length);

  for (const sourceId of ladder) {
    if (pending.size === 0) break;
    // `docs/07` §7.4 check point 1: before a step's network call.
    deps.token.throwIfCancelled();

    if (deps.selected !== undefined && !deps.selected.includes(sourceId)) {
      steps.push({ sourceId, status: "not-selected", asked: 0, found: 0 });
      deps.progress?.increment();
      continue;
    }
    const source = deps.sources.get(sourceId);
    const lookup = source?.lookup;
    const asked = pending.size;
    if (source === undefined || lookup === undefined) {
      steps.push({ sourceId, status: "no-adapter", asked: 0, found: 0 });
      deps.progress?.increment();
      continue;
    }

    let found = 0;
    try {
      const ids = [...pending.values()].flatMap((at) => {
        const doi = works[at[0] ?? -1]?.ids.doi;
        return doi === undefined ? [] : [{ doi }];
      });
      const records = await lookup.call(source, ids, { token: deps.token });
      for (const record of records) {
        const doi = record.work.ids.doi;
        const abstract = record.work.abstract?.trim();
        if (doi === undefined || abstract === undefined || abstract === "") {
          continue;
        }
        const key = doi.toLowerCase();
        const at = pending.get(key);
        // Absent: not asked, or already answered by an earlier record of this
        // step — the first record with an abstract wins.
        if (at === undefined) continue;
        for (const index of at) filled.set(index, { abstract, sourceId });
        pending.delete(key);
        found += 1;
      }
      steps.push({ sourceId, status: "asked", asked, found });
    } catch (caught) {
      if (caught instanceof OperationCancelledError) throw caught;
      // An enhancement pass: a missing abstract is a reported statistic, not
      // an error (`P2-T12`'s Do NOT). The works go on to the next step.
      const line =
        `${sourceId}: could not backfill abstracts ` +
        `(${serialize(caught).code}).`;
      warnings.push(line);
      deps.progress?.warn(line);
      steps.push({ sourceId, status: "failed", asked, found: 0 });
    }

    deps.progress?.increment();
    await deps.checkpoint?.({
      stage: "backfillingAbstracts",
      step: sourceId,
      remaining: pending.size,
    });
  }

  // `docs/07` §5.1: "when this canonical record was last rebuilt" — one
  // reading for the whole pass, taken after its last request.
  const restampedAt = filled.size === 0 ? undefined : deps.now?.();
  const out =
    filled.size === 0
      ? works
      : works.map((work, index) => {
          const hit = filled.get(index);
          if (hit === undefined) return work;
          return {
            ...work,
            abstract: hit.abstract,
            normalizedAtEpochMs: restampedAt ?? work.normalizedAtEpochMs,
            provenance: {
              ...work.provenance,
              fieldOrigin: {
                ...work.provenance.fieldOrigin,
                abstract: hit.sourceId,
              },
            },
          };
        });

  const report: AbstractBackfillReport = {
    missing,
    withoutDoi,
    backfilled: filled.size,
    steps,
  };
  deps.logger?.debug("searchImport: abstract backfill", {
    missing,
    withoutDoi,
    backfilled: filled.size,
    steps: steps.map(
      (s) => `${s.sourceId}:${s.status}:${String(s.found)}/${String(s.asked)}`,
    ),
  });
  return { works: out, report, warnings };
}
