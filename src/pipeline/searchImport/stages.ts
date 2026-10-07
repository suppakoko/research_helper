/**
 * `searchImport`'s stage list — `docs/07` §12.1's states, as
 * `docs/07` §4.5 `StageDescriptor`s.
 *
 * **Scope.** `P1-T16` step 2. The seven states the card's `Read first` names:
 * `Planning → Fetching → Merging → Deduping → BackfillingAbstracts →
 * CreatingCollection → WritingItems`.
 *
 * ## What is deliberately **not** a stage
 *
 * §12.1's diagram also draws `Queued`, `Estimating`, `AwaitingConfirm`,
 * `PartialFetch`, `Cancelling`, `Paused`, `Interrupted` and the three terminals.
 * None of them is a stage, and each is left out for a reason rather than for
 * brevity:
 *
 * - `Queued`, `Paused` and `Interrupted` are the **queue's** states, not the
 *   pipeline's — §7.5 and §7.6 own them and Phase 3 owns the queue.
 * - `Estimating` and `AwaitingConfirm` are `Pipeline.estimate()` and the
 *   confirmation dialog around it; they happen *before* `run()` is called, so a
 *   slice of `run()`'s progress bar is the wrong place for them.
 * - **`PartialFetch` is a state of `Fetching`, not a stage after it.** §12.1
 *   draws `Fetching → PartialFetch → Merging`, and §12.1's note says
 *   "`PartialFetch` is a first-class state, not an error". Giving it a slice of
 *   the bar would mean the bar jumped differently depending on whether a source
 *   failed, which is backwards: the work done is the same. It is carried on the
 *   outcome instead (`./types.ts`'s `SearchImportOutcome`).
 * - `Cancelling` and the terminals are what `ProgressReporter.done()` reports.
 *
 * ## The weights
 *
 * The weights allocate one progress bar, so they are a statement about relative
 * *cost*, and `docs/07` publishes no measured figures for these seven. They are
 * therefore chosen, and the reasoning is written down here so a later card with
 * a measurement can replace them against something:
 *
 * - `fetching` is the network, paced by `docs/07` §7.3's token bucket at 3
 *   requests a second unkeyed, and PubMed needs two round trips per page
 *   (`esearch` then `efetch`, `docs/02` §3.3–§3.4). It is the largest.
 * - `writingItems` is the only other stage that does real work per record —
 *   `docs/01` §5.2's `fromJSON()` plus one transaction per batch of 50 — and
 *   `P1-T14`'s own `ImportStats.chunkMs` is the thing that will eventually
 *   measure it. It is second.
 * - `backfillingAbstracts` gets a small slice rather than zero because
 *   `docs/01` §6.3 step 4 makes it a real step; on the PubMed path it is
 *   normally a no-op, because `efetch` returns the abstract with the record.
 * - `planning`, `merging`, `deduping` and `creatingCollection` are bookkeeping:
 *   a query parse, a lift, an identity pass and one collection write. They get
 *   the same small slice each so that a bar which stops in one of them still
 *   moves visibly, which is the whole reason they are not zero.
 *
 * **The sum is exactly `1` in IEEE-754, and that is checked rather than
 * assumed.** `stageSlices()` rejects a list that does not sum to 1, and
 * `STAGE_WEIGHT_SUM_EPSILON`'s own comment records that this particular decimal
 * set sums exactly while an equally reasonable one does not.
 *
 * ## The label keys do not exist yet, and that is reported rather than fixed
 *
 * §4.5 types `labelKey` as a Fluent message id, and **none of the seven ids
 * below is in either `.ftl` bundle**: verified by grep over
 * `addon/locale/<lang>/research-helper-mainWindow.ftl and -searchDialog.ftl` on 2026-10-07. The bundles and
 * `src/i18n/keys.ts` are `P1-T18`'s files and neither is in `P1-T16`'s `Files`
 * list, so adding them here would be the scope-widening `plan/README.md` §5
 * rule 2 forbids. Nothing in `src/pipeline/` resolves a message — §2.3 keeps
 * Fluent and the DOM in `ui/` — so an absent id costs nothing until a surface
 * renders a stage name, which is `P1-T22`'s. **It needs a card** (or a line in
 * `P1-T18`'s bundles): seven stage labels plus
 * {@link SEARCH_IMPORT_DISPLAY_NAME_KEY}.
 */

import type { StageDescriptor } from "../types";

/**
 * `Pipeline.displayNameKey` for `searchImport`.
 *
 * Not in either bundle yet — see this file's header.
 */
export const SEARCH_IMPORT_DISPLAY_NAME_KEY =
  "research-helper-pipeline-search-import";

/**
 * The seven stage keys, as a union, so a `switch` over them is exhaustive and a
 * typo in a stage transition is a compile error rather than a bar that never
 * moves.
 */
export type SearchImportStageKey =
  | "planning"
  | "fetching"
  | "merging"
  | "deduping"
  | "backfillingAbstracts"
  | "creatingCollection"
  | "writingItems";

/**
 * `docs/07` §12.1's states in run order, with `docs/07` §4.5's three members.
 *
 * Frozen, and exported as the pipeline's `stages`: `StageDescriptor` is
 * `readonly` in every member, but the array itself would otherwise be mutable
 * through the `readonly StageDescriptor[]` the interface declares.
 */
export const SEARCH_IMPORT_STAGES: readonly StageDescriptor[] = Object.freeze([
  {
    key: "planning",
    labelKey: "research-helper-stage-planning",
    weight: 0.05,
  },
  {
    key: "fetching",
    labelKey: "research-helper-stage-fetching",
    weight: 0.45,
  },
  {
    key: "merging",
    labelKey: "research-helper-stage-merging",
    weight: 0.05,
  },
  {
    key: "deduping",
    labelKey: "research-helper-stage-deduping",
    weight: 0.05,
  },
  {
    key: "backfillingAbstracts",
    labelKey: "research-helper-stage-backfilling-abstracts",
    weight: 0.1,
  },
  {
    key: "creatingCollection",
    labelKey: "research-helper-stage-creating-collection",
    weight: 0.05,
  },
  {
    key: "writingItems",
    labelKey: "research-helper-stage-writing-items",
    weight: 0.25,
  },
] satisfies readonly (StageDescriptor & { key: SearchImportStageKey })[]);

/**
 * The stage keys in run order, derived from {@link SEARCH_IMPORT_STAGES} rather
 * than listed a second time.
 *
 * A second hand-written list is how a stage comes to exist in one place and not
 * the other; `docs/07` §12.1's order is the one thing here that must not be
 * reproduced twice.
 */
export const SEARCH_IMPORT_STAGE_KEYS: readonly SearchImportStageKey[] =
  SEARCH_IMPORT_STAGES.map((stage) => stage.key as SearchImportStageKey);
