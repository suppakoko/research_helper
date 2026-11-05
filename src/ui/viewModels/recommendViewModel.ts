/**
 * The recommend mode's view model (`plan/08` `P5-T26`; `docs/08` §5.4; FR-44, FR-45).
 *
 * **Who calls it.** `publishSearchWindowHost` in `src/bootstrap/registerUI.ts`
 * constructs it once and publishes {@link RecommendViewModel.host} as
 * `host.recommend`; `addon/content/searchDialog.js` is the one caller of that host.
 *
 * It folds one `RecommendPipeline.execute` ending into one whole state, as
 * `relatedViewModel.ts` does, so the document's `render()` draws this mode too. The
 * decisions on how the window reads are `docs/08` §5.4's note "DECIDED 2026-11-05".
 *
 * **Three rules this file holds.**
 * - The window starts no run by itself, and "Find papers" refuses until a profile is
 *   on screen, so nothing is sent for a profile the user has not seen.
 * - A model's and a library's text leaves here as plain strings, which the document
 *   writes with `textContent`. The only ones in a {@link MessageRef} are the term in a
 *   button's attributes, which Fluent does not parse.
 * - `RecommendPipeline.run` declines every question, so this file asks through
 *   `execute`, and {@link confirmProfileCall} is what opens the cost dialog.
 *
 * **`P5-T27`.** {@link reasonRefs} words a row's reasons, {@link groupedRows} puts the
 * rows under their topics, `dismiss` is the one caller of `RecommendPipeline.reject`,
 * and `importRows` runs the search pipeline's preview import, which `docs/08` §5.4's
 * section "The results" holds the decisions on.
 */

import type { SerializedError } from "../../core/errors";
import { redact, ResearchHelperError } from "../../core/errors";
import {
  createCancellationTokenSource,
  type CancellationToken,
  type CancellationTokenSource,
} from "../../core/jobQueue/cancellation";
import type { ProgressSnapshot } from "../../core/jobQueue/progress";
import type { Logger } from "../../core/logger";
import type { FluentMessageId } from "../../i18n/keys";
import type { CollectionProfile, ProfileUserEdits } from "../../model/profile";
import type {
  Recommendation,
  RecommendationReason,
  RecommendationReasonId,
  RecommendationStrategy,
} from "../../model/recommendation";
import {
  RECOMMEND_WATCH_AUTHORS,
  recommendKeywordQueries,
  recommendTermKey,
  type RecommendGeneratorState,
  type RecommendGeneratorStatus,
} from "../../pipeline/recommend/generators";
import { rankedTerms } from "../../pipeline/recommend/profile";
import type {
  ProfileConfirmAnswer,
  ProfileConfirmRequest,
  ProfileHeuristicReason,
} from "../../pipeline/recommend/profileCall";
import type { RecommendationRow } from "../../pipeline/recommend/score";
import { MAX_NEGATIVES } from "../../pipeline/recommend/seeds";
import type {
  RecommendBudgetQuestion,
  RecommendEditedProfileInput,
  RecommendFailed,
  RecommendInput,
  RecommendOutput,
  RecommendPipeline,
  RecommendProfileResult,
  RecommendProfileOnlyInput,
  RecommendRows,
  RecommendSurface,
} from "../../pipeline/recommend/types";
import type { EgressDisclosure } from "../../pipeline/shared/egressDisclosure";
import type {
  SearchImportInput,
  SearchImportOutput,
  SearchImportTarget,
} from "../../pipeline/searchImport/types";
import type { Pipeline, PipelineContext } from "../../pipeline/types";
import { PREFS } from "../../prefs/schema";
import {
  shouldOpenCostDialog,
  skippedNoticeLine,
  type CostDialogInput,
  type CostDialogOutcome,
} from "../dialogs/costConfirmDialog";
import type { SearchWindowRecord } from "../dialogs/searchDialog";
import { failureView, importOutcomeView } from "./relatedViewModel";
import {
  initialViewState,
  message,
  targetFromPicker,
  type CollectionDescriptor,
  type ErrorView,
  type MessageFormatter,
  type MessageRef,
  type SearchViewState,
  type SourceStatusLine,
} from "./searchImportViewModel";

/** How many of `termWeights`' heaviest are chips (`docs/08` §5.4's note, decision 3). */
export const RECOMMEND_TERMS_SHOWN = 20;

/** The slider's starting position, out of 100: per run and never saved (`plan/08` §0.4 line 25). */
export const RECOMMEND_DEFAULT_SLIDER = 25;

/** {@link RECOMMEND_DEFAULT_SLIDER} as the pipeline reads it. */
export const RECOMMEND_DEFAULT_EXPLORATION = RECOMMEND_DEFAULT_SLIDER / 100;

/** How many authors and venues the panel names, most frequent first. */
const RECOMMEND_NAMES_SHOWN = 10;

const NO_EDITS: ProfileUserEdits = { removedTerms: [], addedTerms: [] };

const GENERATOR_NAME: Readonly<
  Record<RecommendationStrategy, FluentMessageId>
> = {
  recommendations: "research-helper-search-recommend-generator-recommendations",
  similar: "research-helper-search-recommend-generator-similar",
  "forward-citations":
    "research-helper-search-recommend-generator-forward-citations",
  "keyword-search": "research-helper-search-recommend-generator-keyword-search",
  "author-watch": "research-helper-search-recommend-generator-author-watch",
};

/** What a generator's state reads as. */
function stateDetail(status: RecommendGeneratorStatus): MessageRef {
  const state: RecommendGeneratorState = status.state;
  switch (state) {
    case "answered":
      return message("research-helper-search-source-results", {
        count: status.records,
      });
    case "partial":
      return message("research-helper-search-recommend-source-partial");
    case "no-key":
      return message("research-helper-search-related-source-no-key");
    case "not-indexed":
      return message("research-helper-search-related-source-not-indexed");
    case "could-not-ask":
      return message("research-helper-search-recommend-source-could-not-ask");
    case "rate-limited":
      return message("research-helper-search-related-source-rate-limited");
    case "over-budget":
      return message("research-helper-search-related-source-over-budget");
    case "failed":
      return message("research-helper-search-related-source-failed", {
        code: status.errorCode ?? "SOURCE",
      });
  }
}

function statusLine(status: RecommendGeneratorStatus): SourceStatusLine {
  return {
    sourceId: status.generator,
    nameId: GENERATOR_NAME[status.generator],
    outcome:
      status.state === "failed" || status.state === "rate-limited"
        ? "failed"
        : "succeeded",
    detail: stateDetail(status),
  };
}

// ===========================================================================
// 1. The edits (`docs/08` §5.4's note, decisions 3 to 5)
// ===========================================================================

/** One term chip. `term` is the profile's or the user's own text. */
export interface RecommendTermView {
  readonly term: string;
  /** The user's, rather than the profile's. */
  readonly added: boolean;
  /** The remove button's message. Only attributes carry the term. */
  readonly removeRef: MessageRef;
}

/** One entry of the "Removed" line. */
export interface RecommendRemovedTermView {
  readonly term: string;
  readonly restoreRef: MessageRef;
}

const heldIn = (terms: readonly string[], term: string): boolean => {
  const key = recommendTermKey(term);
  return terms.some((other) => recommendTermKey(other) === key);
};

const without = (terms: readonly string[], term: string): readonly string[] => {
  const key = recommendTermKey(term);
  return terms.filter((other) => recommendTermKey(other) !== key);
};

/**
 * What is typed, as a term: white space and control characters collapsed, and trimmed.
 *
 * @param text - the input's value
 * @returns the term; empty for nothing usable
 */
export function cleanTerm(text: string): string {
  // eslint-disable-next-line no-control-regex -- removing them is the point.
  return text.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}

/** The heaviest of the profile's terms, which the chips can hold. */
function shownProfileTerms(profile: CollectionProfile): readonly string[] {
  return rankedTerms(profile.termWeights)
    .slice(0, RECOMMEND_TERMS_SHOWN)
    .map(([term]) => term);
}

/**
 * The chips for a profile under these edits: added terms first, then the heaviest of
 * the profile's, less the removed.
 *
 * @param profile - the profile on screen
 * @param edits - the window's edits
 * @returns the chips, in the order they are drawn
 */
export function visibleTerms(
  profile: CollectionProfile,
  edits: ProfileUserEdits,
): readonly RecommendTermView[] {
  const view = (term: string, added: boolean): RecommendTermView => ({
    term,
    added,
    removeRef: message("research-helper-search-recommend-term-remove", {
      term,
    }),
  });
  const added = edits.addedTerms.filter(
    (term) => !heldIn(edits.removedTerms, term),
  );
  return [
    ...added.map((term) => view(term, true)),
    ...shownProfileTerms(profile)
      .filter(
        (term) => !heldIn(edits.removedTerms, term) && !heldIn(added, term),
      )
      .map((term) => view(term, false)),
  ];
}

/**
 * Remove a chip. An added term is dropped; a profile's goes on the "Removed" line.
 *
 * @param edits - the window's edits
 * @param term - the chip's term
 * @returns the new edits
 */
export function editsWithRemoved(
  edits: ProfileUserEdits,
  term: string,
): ProfileUserEdits {
  if (heldIn(edits.addedTerms, term)) {
    return { ...edits, addedTerms: without(edits.addedTerms, term) };
  }
  return heldIn(edits.removedTerms, term)
    ? edits
    : { ...edits, removedTerms: [...edits.removedTerms, term] };
}

/**
 * Put a removed term back.
 *
 * @param edits - the window's edits
 * @param term - the term on the "Removed" line
 * @returns the new edits
 */
export function editsWithRestored(
  edits: ProfileUserEdits,
  term: string,
): ProfileUserEdits {
  return { ...edits, removedTerms: without(edits.removedTerms, term) };
}

/**
 * Add what was typed. A removed term comes back, because `recommendKeywordQueries`
 * drops one that is both. A term that is already a chip changes nothing.
 *
 * @param profile - the profile on screen
 * @param edits - the window's edits
 * @param typed - the input's value, already refused if it held a key
 * @returns the new edits, or the same object when nothing changes
 */
export function editsWithAdded(
  profile: CollectionProfile,
  edits: ProfileUserEdits,
  typed: string,
): ProfileUserEdits {
  const term = cleanTerm(typed);
  if (recommendTermKey(term) === "") return edits;
  if (heldIn(edits.removedTerms, term)) {
    return editsWithRestored(edits, term);
  }
  const drawn = visibleTerms(profile, edits).map((chip) => chip.term);
  return heldIn(drawn, term)
    ? edits
    : { ...edits, addedTerms: [...edits.addedTerms, term] };
}

// ===========================================================================
// 2. The state
// ===========================================================================

/**
 * The heading a row stands under. Exactly one of `label`, which is the library's or a
 * model's text and is drawn as plain text, and `ref`.
 */
export interface RecommendRowGroup {
  /** Rows of one group have one key, and stand together. */
  readonly key: string;
  readonly label?: string;
  readonly ref?: MessageRef;
}

/** One row of the table. */
export interface RecommendResultRow extends SearchWindowRecord {
  /** `RecommendationRow.checkedByDefault` (FR-46). */
  readonly startsTicked: boolean;
  /** Marks the row as this mode's, so the document draws no Source, Type or DOI. */
  readonly recommended: true;
  /** The Why column, from {@link reasonRefs}. Never empty (FR-47). */
  readonly reasons: readonly MessageRef[];
  /** The "preprint (not peer reviewed)" badge (`plan/08` §0.4 line 24). */
  readonly preprint: boolean;
  /** Absent when the list has one topic or none, so it has no headings. */
  readonly group?: RecommendRowGroup;
}

/** The profile panel. Every string but the refs is the model's or the library's. */
export interface RecommendProfileView {
  /** The focus statement, read-only. Absent when no model wrote one. */
  readonly focus: string | undefined;
  readonly terms: readonly RecommendTermView[];
  readonly removed: readonly RecommendRemovedTermView[];
  /** `Name (count)`, most frequent first. */
  readonly authors: readonly string[];
  /** `Name (count)`, most frequent first. */
  readonly venues: readonly string[];
  /** The "heuristic profile" line, when no model's text is shown. */
  readonly heuristic: MessageRef | undefined;
  /** What goes to the literature databases, always non-empty. */
  readonly egress: readonly MessageRef[];
  /** `recommendKeywordQueries` over these edits, which is what would be sent. */
  readonly queries: readonly string[];
}

/** What the recommend mode draws beyond a search state. */
export interface RecommendRunView {
  /** The chip's name. Absent when the collection is not found. */
  readonly collectionName: string | undefined;
  /** Absent until a profile has been built, so "Find papers" has nothing to read. */
  readonly profile: RecommendProfileView | undefined;
  readonly canBuild: boolean;
  /** Never true without {@link profile}. */
  readonly canFind: boolean;
  /** The key-request page, when the run found no usable Semantic Scholar key. */
  readonly keyRequestUrl: string | undefined;
  /**
   * The rows of this list that are dismissed. A new array whenever one is added, so
   * the document can tell, and shown only while "Show dismissed" is ticked.
   */
  readonly dismissedKeys: readonly string[];
  /** The run on screen asked for dismissed papers, so all of them are on hand. */
  readonly dismissedAsked: boolean;
  /** `docs/08` §5.4's section "The results", decision 5: what no row says. */
  readonly listNote: MessageRef | undefined;
}

/** The whole state: a search state with this mode's panel and rows. */
export interface RecommendViewState extends Omit<SearchViewState, "records"> {
  readonly records: readonly RecommendResultRow[] | undefined;
  readonly recommend: RecommendRunView;
}

/** What the document hands over when it connects. */
export interface RecommendWindowView {
  render(state: RecommendViewState): void;
  /** The window's `document.l10n`, for the completion toast's text. */
  readonly formatter?: MessageFormatter;
}

/**
 * What "Find papers" reads off the window: `docs/08` §5.4's three per-run controls.
 * Built by `recommendControls` in `addon/content/searchDialog.js`.
 */
export interface RecommendRunControls {
  /** The Familiar ↔ Exploratory slider, 0 to 100. */
  readonly slider: number;
  readonly peerReviewedOnly: boolean;
  readonly showDismissed: boolean;
}

/** What the window starts with, and what a host driven with no controls reads. */
export const RECOMMEND_DEFAULT_CONTROLS: RecommendRunControls = {
  slider: RECOMMEND_DEFAULT_SLIDER,
  peerReviewedOnly: false,
  showDismissed: false,
};

/**
 * What the window's Import hands over. Built by `recommendImportRequest` in
 * `addon/content/searchDialog.js`, and read by {@link RecommendWindowHost.importRows}.
 */
export interface RecommendImportRequest {
  /** The ticked visible rows' `workKey`s. */
  readonly keys: readonly string[];
  /** The target picker's value, as {@link targetFromPicker} reads it. */
  readonly collectionID: string;
  /** The picker is on the dated default, which nests under the source collection. */
  readonly parentIsSource: boolean;
}

/** `host.recommend`: what `addon/content/searchDialog.js` calls. */
export interface RecommendWindowHost {
  /** Reset to a clean window, cancelling a run still going. Returns the detach. */
  connect(view: RecommendWindowView): () => void;
  /** Say which collection the window is on. Sends nothing. */
  open(collectionID: number): void;
  /** "Build profile". Resolves when the run has been drawn. */
  build(): Promise<void>;
  /** "Find papers". Refused with no profile on screen. */
  find(controls?: RecommendRunControls): Promise<void>;
  /** Run the last input again, its controls included. */
  retry(): Promise<void>;
  /** "Not interested", by key. Resolves when the answer has been drawn. */
  dismiss(key: string): Promise<void>;
  /** Write the ticked rows of the list on screen. Resolves when it has been drawn. */
  importRows(request: RecommendImportRequest): Promise<void>;
  removeTerm(term: string): void;
  /** Add what was typed. A key is refused with a warning, and never kept. */
  addTerm(typed: string): void;
  restoreTerm(term: string): void;
  cancel(): void;
}

/** The jobs the model opens. `graph.pipelineContext` satisfies it. */
export interface RecommendJobFactory {
  openJob(options: {
    readonly pipelineId: "recommend" | "searchImport";
    readonly token: CancellationToken;
    /** A run's: its privacy override. An import sends nothing, so it has none. */
    readonly collection?: {
      readonly libraryID: number;
      readonly collectionKey: string;
    };
    readonly openOn?: "progress" | "completion";
  }): Promise<{
    readonly context: PipelineContext;
    readonly progress: {
      readonly reporter: {
        done(
          outcome: "succeeded" | "failed" | "cancelled",
          message?: string,
        ): void;
      };
      readonly events: {
        subscribe(listener: (snapshot: ProgressSnapshot) => void): () => void;
      };
    };
    dispose(): void;
  }>;
}

/** The collection the window is on. Built from `addon.platform.collectionById`. */
export interface RecommendCollection {
  readonly libraryID: number;
  readonly collectionKey: string;
  readonly name: string;
}

/** What {@link confirmProfileCall} needs. Built by `reportConfirmDeps`' shape. */
export interface RecommendConfirmDeps {
  /** `confirmRunCost` in `src/bootstrap/registerUI.ts`. */
  openDialog(input: CostDialogInput): Promise<CostDialogOutcome>;
  /** `settleDisclosure` over the user's answer. */
  settle(
    disclosure: EgressDisclosure,
    outcome: "confirmed" | "cancelled",
  ): void;
  readonly confirmAboveCents: () => number;
  readonly fullTextAutoMaxPapers: () => number;
  providerName(disclosure: EgressDisclosure): Promise<string>;
  readonly locale: () => string;
}

/**
 * What the import needs (`P5-T27`). Built by `publishSearchWindowHost` in
 * `src/bootstrap/registerUI.ts`, and read only by {@link createRecommendViewModel}.
 */
export interface RecommendImportPort {
  /** The search pipeline, for its preview import. */
  readonly pipeline: Pipeline<SearchImportInput, SearchImportOutput>;
  /** What the picker lists, to read a picked id back to its name. */
  listCollections(): readonly CollectionDescriptor[];
}

/** What {@link createRecommendViewModel} needs. */
export interface RecommendViewModelDeps {
  readonly pipeline: RecommendPipeline;
  /**
   * What words the toast: the window links its own bundle only (`docs/08` §10.1), and
   * `rh-error-cancelled` is the main one's. Absent, the window's formatter is used.
   */
  readonly toastFormatter?: MessageFormatter;
  readonly jobs: RecommendJobFactory;
  readonly logger: Logger;
  /** The Semantic Scholar key-request page: `ui/` may not name `sources/`. */
  readonly keyRequestUrl: string;
  /** `RECOMMEND_MAX_POSITIVES`, for the notice: `ui/` may not name `sources/`. */
  readonly maxPaperIdentifiers: number;
  collectionOf(collectionID: number): RecommendCollection | undefined;
  readonly confirm: RecommendConfirmDeps;
  /** The ceiling dialog, for a spend ceiling that stopped the call. */
  askBudget(question: RecommendBudgetQuestion): Promise<"resume" | "cancel">;
  readonly imports: RecommendImportPort;
}

/** What {@link createRecommendViewModel} returns. */
export interface RecommendViewModel {
  readonly host: RecommendWindowHost;
  /** The state last published. */
  state(): RecommendViewState;
}

// ===========================================================================
// 3. The cost question
// ===========================================================================

/** {@link confirmProfileCall}'s answer. */
export interface ProfileConfirmResult {
  readonly answer: ProfileConfirmAnswer;
  /** The price, when the dialog was skipped (FR-24). */
  readonly notice: MessageRef | undefined;
}

/**
 * Ask, or skip asking, before the profile call spends. `request.confirmation` is
 * already the run's own "don't ask again" decision, and money still forces the dialog
 * (`shouldOpenCostDialog`). A dialog that cannot open runs nothing.
 *
 * @param deps - see {@link RecommendConfirmDeps}
 * @param request - from `runProfileCall`
 * @param released - resolves when the window has gone or the run was cancelled
 */
export async function confirmProfileCall(
  deps: RecommendConfirmDeps,
  request: ProfileConfirmRequest,
  released: Promise<void> = new Promise(() => undefined),
): Promise<ProfileConfirmResult> {
  const decision = shouldOpenCostDialog({
    confirmation: request.confirmation,
    plan: request.estimate.selected,
    confirmAboveCents: deps.confirmAboveCents(),
    ceiling: request.ceilingSelected,
  });
  if (!decision.open) {
    const line =
      request.estimate.selected.calls === 0
        ? undefined
        : skippedNoticeLine(request.estimate.selected, deps.locale());
    return {
      answer: { kind: "run", raise: undefined, dontAskAgain: false },
      notice: line === undefined ? undefined : { id: line.id, args: line.args },
    };
  }
  let outcome: CostDialogOutcome;
  try {
    outcome = await Promise.race([
      openProfileDialog(deps, request),
      released.then((): CostDialogOutcome => ({ kind: "cancelled" })),
    ]);
  } catch {
    outcome = { kind: "cancelled" };
  }
  if (outcome.kind !== "run") {
    deps.settle(request.disclosure, "cancelled");
    return { answer: { kind: "cancelled" }, notice: undefined };
  }
  deps.settle(request.disclosure, "confirmed");
  return {
    answer: {
      kind: "run",
      raise: outcome.raise,
      dontAskAgain: outcome.dontAskAgain,
    },
    notice: undefined,
  };
}

/** The dialog itself, once `shouldOpenCostDialog` said to open it. */
async function openProfileDialog(
  deps: RecommendConfirmDeps,
  request: ProfileConfirmRequest,
): Promise<CostDialogOutcome> {
  return deps.openDialog({
    mode: "preflight",
    estimate: request.estimate,
    disclosure: request.disclosure,
    confirmAboveCents: deps.confirmAboveCents(),
    fullTextAutoMaxPapers: deps.fullTextAutoMaxPapers(),
    providerName: await deps.providerName(request.disclosure),
    ceilingSelected: request.ceilingSelected,
    // `estimateProfileCall`'s two plans are one object: nothing to downgrade to.
    ceilingDowngrade: undefined,
    session: request.session,
  });
}

// ===========================================================================
// 4. Folding an ending into the state
// ===========================================================================

/** `Name (count)`, for the panel's authors and venues. */
function counted(
  entries: readonly { readonly name: string; readonly count: number }[],
): readonly string[] {
  return entries
    .slice(0, RECOMMEND_NAMES_SHOWN)
    .map(({ name, count }) => `${name} (${String(count)})`);
}

/** `docs/08` §5.4's note, decision 8. A stored heuristic profile says so as well. */
function heuristicLine(
  profile: CollectionProfile,
  reason: ProfileHeuristicReason | undefined,
): MessageRef | undefined {
  if (profile.origin !== "heuristic") return undefined;
  if (reason === "no-provider") {
    return message("research-helper-search-recommend-heuristic-no-provider");
  }
  if (reason === "too-large") {
    return message("research-helper-search-recommend-heuristic-too-large");
  }
  return message("research-helper-search-recommend-heuristic");
}

/**
 * The panel for a profile under these edits. `queries` is exactly what the run would
 * send, because it is the run's own function over the same edits.
 *
 * @param profile - the profile on screen
 * @param edits - the window's edits
 * @param reason - why this run's profile has no model's text
 * @param maxPaperIdentifiers - `RECOMMEND_MAX_POSITIVES`
 */
export function profileView(
  profile: CollectionProfile,
  edits: ProfileUserEdits,
  reason: ProfileHeuristicReason | undefined,
  maxPaperIdentifiers: number,
): RecommendProfileView {
  return {
    focus: profile.narrative,
    terms: visibleTerms(profile, edits),
    removed: edits.removedTerms.map((term) => ({
      term,
      restoreRef: message("research-helper-search-recommend-term-restore", {
        term,
      }),
    })),
    authors: counted(profile.topAuthors),
    venues: counted(profile.topVenues),
    heuristic: heuristicLine(profile, reason),
    egress: [
      message("research-helper-search-recommend-egress-notice", {
        papers: maxPaperIdentifiers,
        dismissed: MAX_NEGATIVES,
        authors: RECOMMEND_WATCH_AUTHORS,
      }),
      message("research-helper-search-recommend-egress-sources"),
    ],
    queries: recommendKeywordQueries({ ...profile, userEdits: edits }),
  };
}

/** The reasons that have no argument. */
const REASON_REF: Readonly<
  Record<
    Exclude<
      RecommendationReasonId,
      "cites-collection" | "author-in-collection" | "authorAffinity"
    >,
    MessageRef
  >
> = {
  "recommended-by-semantic-scholar": message(
    "research-helper-search-recommend-reason-recommended",
  ),
  similarity: message("research-helper-search-recommend-reason-similarity"),
  recency: message("research-helper-search-recommend-reason-recency"),
  velocity: message("research-helper-search-recommend-reason-velocity"),
  novelty: message("research-helper-search-recommend-reason-novelty"),
  venueAffinity: message("research-helper-search-recommend-reason-venue"),
  generatorAgreement: message(
    "research-helper-search-recommend-reason-agreement",
  ),
  coupling: message("research-helper-search-recommend-reason-coupling"),
};

/** One reason as a line, or nothing when the window does not say it on a row. */
function reasonRef(
  reason: RecommendationReason,
  recommendation: Pick<Recommendation, "signals" | "similaritySpace">,
): readonly MessageRef[] {
  const lexical = recommendation.similaritySpace === "lexical";
  const { id } = reason;
  switch (id) {
    case "cites-collection":
      return [
        message("research-helper-search-recommend-reason-cites", {
          count: reason.count ?? 0,
        }),
      ];
    case "author-in-collection": {
      const names = reason.names ?? [];
      return [
        // Raw here: the document escapes it, in `logic.reasonRef`.
        message("research-helper-search-recommend-reason-author", {
          names: names.join(", "),
          count: names.length,
        }),
      ];
    }
    // `scoreRecommendations` never offers it, because the phrase above says it.
    case "authorAffinity":
      return [];
    // Decision 5: on the word space it reads the same on every row.
    case "novelty":
      return lexical ? [] : [REASON_REF.novelty];
    // Decision 6: `reasonsOf`'s fallback reads 0, and "close" would be untrue.
    case "similarity":
      if (recommendation.signals.similarity <= 0) return [];
      return lexical
        ? [message("research-helper-search-recommend-reason-similarity-basic")]
        : [REASON_REF.similarity];
    default:
      return [REASON_REF[id]];
  }
}

/**
 * The Why column of one row: `docs/08` §5.4's section "The results", decisions 4 to 6.
 * Never empty, because FR-47 asks every row for a rationale.
 *
 * @param recommendation - the row's record
 * @returns one message per reason, in the pipeline's order
 */
export function reasonRefs(
  recommendation: Pick<
    Recommendation,
    "reasons" | "signals" | "similaritySpace"
  >,
): readonly MessageRef[] {
  const refs = recommendation.reasons.flatMap((reason) =>
    reasonRef(reason, recommendation),
  );
  return refs.length > 0
    ? refs
    : [message("research-helper-search-recommend-reason-found")];
}

/** The group of rows with no topic, which stands last. */
const NO_TOPIC = "none";

/** A topic's heading: decisions 2 and 3. */
function topicGroup(
  topicIndex: number,
  profile: CollectionProfile,
): RecommendRowGroup {
  const key = String(topicIndex);
  const label = profile.centroidLabels?.[topicIndex];
  const removed = (profile.userEdits?.removedTerms ?? []).map(recommendTermKey);
  return label === undefined ||
    label.trim() === "" ||
    removed.includes(recommendTermKey(label))
    ? {
        key,
        ref: message("research-helper-search-recommend-group-numbered", {
          number: topicIndex + 1,
        }),
      }
    : { key, label };
}

/**
 * The rows in the order the table draws them, each with its heading: `docs/08` §5.4's
 * section "The results", decisions 1 and 2. With more than one centroid the groups
 * stand in the order of their best row and those with no topic come last. Within a
 * group the pipeline's order stands. Otherwise nothing moves and nothing has a heading.
 *
 * @param rows - in the order `diversify` picked
 * @param profile - the profile that drove the run, with its edits
 */
export function groupedRows(
  rows: readonly RecommendationRow[],
  profile: CollectionProfile,
): readonly {
  readonly row: RecommendationRow;
  readonly group?: RecommendRowGroup;
}[] {
  if (profile.centroids.length <= 1) return rows.map((row) => ({ row }));
  const groups = new Map<string, RecommendationRow[]>();
  for (const row of rows) {
    const { topicIndex } = row.recommendation;
    const key = topicIndex === undefined ? NO_TOPIC : String(topicIndex);
    const held = groups.get(key);
    if (held === undefined) groups.set(key, [row]);
    else held.push(row);
  }
  const ordered = [...groups].sort(
    ([a], [b]) => Number(a === NO_TOPIC) - Number(b === NO_TOPIC),
  );
  return ordered.flatMap(([, members]) =>
    members.map((row) => {
      const { topicIndex } = row.recommendation;
      return {
        row,
        group:
          topicIndex === undefined
            ? {
                key: NO_TOPIC,
                ref: message("research-helper-search-recommend-group-none"),
              }
            : topicGroup(topicIndex, profile),
      };
    }),
  );
}

/** The dated subcollection's input is the search pipeline's preview path. */
function recommendImportInput(
  rows: readonly RecommendationRow[],
  target: SearchImportTarget,
  libraryId: number,
): SearchImportInput {
  const existing = new Map<string, number>();
  for (const row of rows) {
    if (row.existingItemID !== undefined) {
      existing.set(row.recommendation.work.workKey, row.existingItemID);
    }
  }
  return {
    query: "",
    sourceIds: [],
    limit: PREFS.maxResults.min,
    dateFilter: "none",
    records: rows.flatMap((row) => row.records.slice(0, 1)),
    works: rows.map((row) => row.recommendation.work),
    target: {
      ...target,
      libraryId,
      duplicatePolicy: "link-existing",
      ...(existing.size > 0 && { existingItemIDs: existing }),
    },
  };
}

/**
 * The slider as the pipeline reads it. A value the control cannot produce reads as the
 * default, because `validate` would otherwise refuse the whole run for it.
 *
 * @param slider - the control's position
 * @returns in [0, 1]
 */
export function explorationOf(slider: number): number {
  return Number.isFinite(slider)
    ? Math.max(0, Math.min(100, slider)) / 100
    : RECOMMEND_DEFAULT_EXPLORATION;
}

/** One table row. `group` comes from {@link groupedRows}. */
function rowView(
  row: RecommendationRow,
  group?: RecommendRowGroup,
): RecommendResultRow {
  const { work } = row.recommendation;
  return {
    key: work.workKey,
    title: work.title,
    authors: work.authors,
    ...(work.publishedDate?.year === undefined
      ? {}
      : { year: work.publishedDate.year }),
    sourceLabels: [],
    typeLabel: "",
    doi: "",
    existing: row.inLibrary,
    startsTicked: row.checkedByDefault,
    recommended: true,
    reasons: reasonRefs(row.recommendation),
    preprint: row.preprint,
    ...(group !== undefined && { group }),
  };
}

/** Which similarity the rows were scored on, when it is not what the run wanted. */
function similarityLines(output: RecommendRows): readonly MessageRef[] {
  const { notice } = output.similarity;
  if (notice === undefined) return [];
  return [
    message(
      notice === "no-store"
        ? "research-helper-search-related-similarity-no-store"
        : notice === "no-vectors"
          ? "research-helper-search-recommend-similarity-no-vectors"
          : "research-helper-search-related-similarity-fetch-failed",
    ),
  ];
}

/** Decision 5: the line that says once what the word space's rows do not. */
function noveltyNote(output: RecommendRows): MessageRef | undefined {
  const held =
    output.similarity.space === "lexical" &&
    output.rows.some(({ recommendation }) =>
      recommendation.reasons.some(({ id }) => id === "novelty"),
    );
  return held
    ? message("research-helper-search-recommend-novelty-note")
    : undefined;
}

/** What a run says about its profile, on either success. */
function profileLines(
  output: RecommendProfileResult | RecommendRows,
): readonly MessageRef[] {
  return [
    ...(output.warningId === undefined
      ? []
      : [{ id: output.warningId, args: undefined }]),
    ...(output.vectorsIncomplete
      ? [message("research-helper-search-recommend-vectors-incomplete")]
      : []),
    ...(output.ending === "rows" && output.profileRebuilt
      ? [message("research-helper-search-recommend-profile-rebuilt")]
      : []),
    ...(output.ending === "rows" ? similarityLines(output) : []),
  ];
}

/**
 * A run's failure as the error panel. Too few papers has a message of its own and no
 * retry, because adding papers is the remedy.
 *
 * @param output - the pipeline's failed ending
 */
export function recommendFailureView(output: RecommendFailed): ErrorView {
  const error: SerializedError = output.error;
  const view = failureView(
    error,
    message("research-helper-search-recommend-state-failed"),
  );
  return output.tooFewItems === undefined
    ? view
    : {
        ...view,
        headline: message("rh-error-recommend-too-few-items", {
          count: output.tooFewItems.itemCount,
        }),
        retry: false,
      };
}

/** The state before any run, and after `connect`. */
export function initialRecommendViewState(): RecommendViewState {
  return {
    ...initialViewState(),
    records: undefined,
    recommend: {
      collectionName: undefined,
      profile: undefined,
      canBuild: false,
      canFind: false,
      keyRequestUrl: undefined,
      dismissedKeys: [],
      dismissedAsked: false,
      listNote: undefined,
    },
  };
}

// ===========================================================================
// 5. The model
// ===========================================================================

/**
 * Build the model. See the file header for who calls it.
 *
 * @param deps - see {@link RecommendViewModelDeps}
 */
export function createRecommendViewModel(
  deps: RecommendViewModelDeps,
): RecommendViewModel {
  let state = initialRecommendViewState();
  let view: RecommendWindowView | undefined;
  /** Bumped when a run is left behind. A run with an older number draws nothing. */
  let generation = 0;
  let running: CancellationTokenSource | undefined;
  /** Closes the open job's surfaces, once. Set while a job is open. */
  let closeSurfaces: (() => void) | undefined;
  /** `openJob` is out for the current run, so no reporter holds its token yet. */
  let jobOpening = false;
  /** Answers a question still open as cancelled. Set while a run goes. */
  let releaseQuestions: (() => void) | undefined;
  let target: RecommendCollection | undefined;
  /** The id `open` was given, to read the collection again at an import. */
  let targetID: number | undefined;
  let profile: CollectionProfile | undefined;
  let heuristicReason: ProfileHeuristicReason | undefined;
  let edits: ProfileUserEdits = NO_EDITS;
  /** Once true, the window's edits win over a profile a later run returns. */
  let touched = false;
  let lastKind: "build" | "find" | undefined;
  /** The lines the last run left, which a refused term must not take away. */
  let runWarnings: readonly MessageRef[] = [];
  let keyRequestUrl: string | undefined;
  /** The controls of the last "Find papers", which Retry repeats. */
  let lastControls: RecommendRunControls = RECOMMEND_DEFAULT_CONTROLS;
  /** The finished list on screen, which a dismissal and an import read. */
  let lastRows: RecommendRows | undefined;
  let dismissedKeys: readonly string[] = [];
  let dismissedAsked = false;
  let listNote: MessageRef | undefined;
  /** Dismissals out to the store, so a second click cannot send a second one. */
  const dismissing = new Set<string>();

  function publish(patch: Partial<RecommendViewState>): void {
    state = { ...state, ...patch };
    view?.render(state);
  }

  /** The part of the state that depends on the profile and on whether a run goes. */
  function runView(): RecommendRunView {
    const idleWithTarget = target !== undefined && running === undefined;
    return {
      collectionName: target?.name,
      profile:
        profile === undefined
          ? undefined
          : profileView(
              profile,
              edits,
              heuristicReason,
              deps.maxPaperIdentifiers,
            ),
      canBuild: idleWithTarget,
      canFind: idleWithTarget && profile !== undefined,
      keyRequestUrl,
      dismissedKeys,
      dismissedAsked,
      listNote,
    };
  }

  /** As `relatedViewModel.ts`'s, whose comment says why the surfaces close first. */
  function leaveRun(): void {
    generation += 1;
    releaseQuestions?.();
    releaseQuestions = undefined;
    if (!jobOpening) {
      closeSurfaces?.();
      running?.cancel({ kind: "user" });
    }
    closeSurfaces = undefined;
    jobOpening = false;
    running = undefined;
  }

  /** Remember how to close this job's surfaces, for {@link leaveRun}. */
  function surfacesOf(job: { dispose(): void }): () => void {
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      job.dispose();
    };
    closeSurfaces = close;
    return close;
  }

  /** The state a finished, failed or stopped run leaves, whatever else it drew. */
  const idle = {
    running: false,
    cancelVisible: false,
    progressPercent: undefined,
    status: undefined,
  } as const;

  /** A defect below `execute`, or a job that could not open. */
  function drawDefect(): void {
    publish({
      ...idle,
      panel: "error",
      error: {
        headline: message("research-helper-search-recommend-state-failed"),
        lines: [],
        details: [],
        retry: true,
        openPreferences: false,
      },
      recommend: runView(),
    });
  }

  function adoptProfile(output: RecommendProfileResult | RecommendRows): void {
    profile = output.profile;
    heuristicReason = output.heuristicReason;
    if (!touched) edits = output.profile.userEdits ?? NO_EDITS;
  }

  /** Fold one ending into the state. */
  function draw(output: RecommendOutput): void {
    if (output.outcome === "cancelled") {
      runWarnings = [];
      publish({
        ...idle,
        panel: "initial",
        status: message("research-helper-search-related-status-cancelled"),
        warnings: [],
        recommend: runView(),
      });
      return;
    }
    if (output.outcome === "failed") {
      runWarnings = [];
      publish({
        ...idle,
        panel: "error",
        error: recommendFailureView(output),
        sources: output.statuses.map(statusLine),
        warnings: [],
        recommend: runView(),
      });
      return;
    }
    adoptProfile(output);
    runWarnings = profileLines(output);
    if (output.ending === "profile") {
      publish({
        ...idle,
        panel: "initial",
        warnings: runWarnings,
        recommend: runView(),
      });
      return;
    }
    keyRequestUrl = output.keyNotice ? deps.keyRequestUrl : undefined;
    lastRows = output;
    dismissedKeys = output.rows
      .filter((row) => row.dismissed)
      .map((row) => row.recommendation.work.workKey);
    dismissedAsked = lastControls.showDismissed;
    listNote = noveltyNote(output);
    const records = groupedRows(output.rows, output.profile).map(
      ({ row, group }) => rowView(row, group),
    );
    publish({
      ...idle,
      panel: records.length === 0 ? "empty" : "results",
      records,
      recordsRevision: state.recordsRevision + 1,
      emptyHeadline:
        records.length === 0
          ? message("research-helper-search-recommend-state-empty")
          : undefined,
      sources: output.statuses.map(statusLine),
      warnings: runWarnings,
      recommend: runView(),
    });
  }

  /** The completion toast's text. */
  function toastOf(output: RecommendRows): Promise<string | undefined> {
    return textOf(
      message("research-helper-search-result-count", {
        total: output.rows.length,
        new: output.rows.filter((row) => !row.inLibrary).length,
      }),
    );
  }

  /** A toast's text, or nothing when it cannot be worded. */
  async function textOf(ref: MessageRef): Promise<string | undefined> {
    const formatter = deps.toastFormatter ?? view?.formatter;
    if (formatter === undefined) return undefined;
    try {
      const [formatted] = await formatter.formatMessages([
        { id: ref.id, args: ref.args },
      ]);
      return formatted?.value ?? undefined;
    } catch {
      return undefined;
    }
  }

  async function start(
    kind: "build" | "find",
    input: RecommendInput,
    status: MessageRef,
  ): Promise<void> {
    if (running !== undefined) {
      deps.logger.warn("a recommend run is already going; ignoring", {
        panel: state.panel,
      });
      return;
    }
    const checked = deps.pipeline.validate(input);
    if (!checked.ok) {
      deps.logger.warn("a recommend input did not validate", {
        errors: checked.errors.length,
      });
      drawDefect();
      return;
    }

    generation += 1;
    const mine = generation;
    const tokenSource = createCancellationTokenSource();
    running = tokenSource;
    lastKind = kind;
    keyRequestUrl = undefined;
    runWarnings = [];
    lastRows = undefined;
    dismissedKeys = [];
    dismissedAsked = false;
    listNote = undefined;
    let freeQuestions: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      freeQuestions = resolve;
    });
    releaseQuestions = freeQuestions;
    publish({
      // No list has answered yet, so the panel still says what will appear.
      panel: "initial",
      running: true,
      cancelVisible: true,
      progressPercent: 0,
      status,
      records: [],
      recordsRevision: state.recordsRevision + 1,
      emptyHeadline: undefined,
      error: undefined,
      warnings: [],
      notices: [],
      sources: [],
      recommend: runView(),
    });

    const current = (): boolean => mine === generation;
    /** Let go of a run this model has stopped listening to, or a run with no toast. */
    const release = (dispose: () => void): void => {
      dispose();
      tokenSource.dispose();
      if (current()) {
        running = undefined;
        releaseQuestions = undefined;
      }
    };

    const surface: RecommendSurface = {
      confirm: async (request) => {
        const { answer, notice } = await confirmProfileCall(
          deps.confirm,
          request,
          released,
        );
        if (notice !== undefined && current()) publish({ notices: [notice] });
        return answer;
      },
      ask: (question) =>
        Promise.race([
          deps.askBudget(question),
          released.then(() => "cancel" as const),
        ]),
    };

    let job: Awaited<ReturnType<RecommendJobFactory["openJob"]>>;
    jobOpening = true;
    try {
      job = await deps.jobs.openJob({
        pipelineId: "recommend",
        token: tokenSource.token,
        // Applies the collection's privacy override, which can only tighten.
        collection: {
          libraryID: input.libraryID,
          collectionKey: input.collectionKey,
        },
        // `docs/08` §4.4: nothing is drawn outside this window until the end.
        openOn: "completion",
      });
    } catch (error) {
      if (current()) jobOpening = false;
      release(() => undefined);
      if (current()) drawDefect();
      throw error;
    }
    if (!current()) {
      release(() => job.dispose());
      return;
    }
    jobOpening = false;
    const closeJob = surfacesOf(job);

    const unsubscribe = job.progress.events.subscribe((snapshot) => {
      if (!current() || snapshot.fraction === undefined) return;
      publish({
        progressPercent: Math.max(
          0,
          Math.min(100, Math.round(snapshot.fraction * 100)),
        ),
      });
    });
    const quietly = (): void => {
      unsubscribe();
      release(closeJob);
    };

    let output: RecommendOutput;
    try {
      output = await deps.pipeline.execute(input, job.context, surface);
    } catch (error) {
      // `execute()` returns its failures, so reaching here is a defect below this
      // line. The surfaces still close, or the window keeps its Cancel for ever.
      const wasCurrent = current();
      quietly();
      if (wasCurrent) drawDefect();
      throw error;
    }
    if (!current()) {
      quietly();
      return;
    }

    running = undefined;
    releaseQuestions = undefined;
    draw(output);

    const toast =
      output.outcome === "succeeded" && output.ending === "rows"
        ? await toastOf(output)
        : output.outcome === "cancelled"
          ? await textOf(
              message("research-helper-search-related-status-cancelled"),
            )
          : undefined;
    unsubscribe();
    // A window closed while the toast was being worded raises nothing.
    if (current()) {
      job.progress.reporter.done(output.outcome, toast);
    }
    closeJob();
    tokenSource.dispose();
  }

  function build(): Promise<void> {
    if (target === undefined) return Promise.resolve();
    const input: RecommendProfileOnlyInput = {
      libraryID: target.libraryID,
      collectionKey: target.collectionKey,
      mode: "profile-only",
    };
    return start(
      "build",
      input,
      message("research-helper-search-recommend-status-building"),
    );
  }

  function find(
    controls: RecommendRunControls = RECOMMEND_DEFAULT_CONTROLS,
  ): Promise<void> {
    // The card's Do NOT: nothing is generated before the user saw the profile.
    if (target === undefined || profile === undefined) {
      deps.logger.warn("Find papers with no profile on screen; ignoring");
      return Promise.resolve();
    }
    lastControls = controls;
    const input: RecommendEditedProfileInput = {
      libraryID: target.libraryID,
      collectionKey: target.collectionKey,
      mode: "edited-profile",
      profile,
      edits,
      showDismissed: controls.showDismissed,
      peerReviewedOnly: controls.peerReviewedOnly,
      exploration: explorationOf(controls.slider),
    };
    return start(
      "find",
      input,
      message("research-helper-search-recommend-status-finding"),
    );
  }

  /** A change to the edits, drawn at once. */
  function edited(next: ProfileUserEdits, warnings = runWarnings): void {
    if (profile === undefined) return;
    if (next !== edits) touched = true;
    edits = next;
    publish({ warnings, recommend: runView() });
  }

  /**
   * "Not interested" (`docs/08` §5.4's section "The results", decision 9). The row goes
   * only once the store has said so, because `reject` answers `false` when no row was
   * stored and that is not done.
   *
   * @param key - the row's work key
   */
  async function dismiss(key: string): Promise<void> {
    const list = lastRows;
    const row = list?.rows.find(
      ({ recommendation }) => recommendation.work.workKey === key,
    );
    if (
      running !== undefined ||
      list === undefined ||
      row === undefined ||
      dismissedKeys.includes(key) ||
      dismissing.has(key)
    ) {
      deps.logger.warn("a dismissal had nothing to do; ignoring", {
        running: running !== undefined,
      });
      return;
    }
    dismissing.add(key);
    let stored = false;
    try {
      stored = await deps.pipeline.reject(
        row.recommendation.profileId,
        row.recommendation.work.workKey,
      );
    } catch (error) {
      deps.logger.warn("a dismissal could not be stored", {
        code: error instanceof ResearchHelperError ? error.code : "UNKNOWN",
      });
    } finally {
      dismissing.delete(key);
    }
    // A new run or a closed window has another list by now.
    if (lastRows !== list) return;
    if (!stored) {
      publish({
        warnings: [
          ...runWarnings,
          message("research-helper-search-recommend-dismiss-failed"),
        ],
      });
      return;
    }
    dismissedKeys = [...dismissedKeys, key];
    publish({
      warnings: runWarnings,
      // An import going on keeps its own line.
      ...(running === undefined && {
        status: message(
          list.keyNotice
            ? "research-helper-search-recommend-dismissed-status-no-key"
            : "research-helper-search-recommend-dismissed-status",
        ),
      }),
      recommend: runView(),
    });
  }

  /**
   * The import (`P5-T27`; `docs/08` §5.4's section "The results", decision 11). A refusal
   * writes nothing and leaves the window as it was. Stores nothing about what was
   * imported (`plan/08` §0.2 item 27).
   *
   * @param request - what the document read off its controls
   */
  async function importRows(request: RecommendImportRequest): Promise<void> {
    if (running !== undefined) {
      deps.logger.warn("a recommend run or import is going; ignoring", {
        panel: state.panel,
      });
      return;
    }
    const picked = targetFromPicker(
      request.collectionID,
      deps.imports.listCollections(),
    );
    const wanted = new Set(request.keys);
    const rows = (lastRows?.rows ?? []).filter(
      (row) =>
        wanted.has(row.recommendation.work.workKey) && row.records.length > 0,
    );
    if (picked === undefined || rows.length === 0) {
      deps.logger.warn("a recommend import had nothing to write; ignoring", {
        rows: rows.length,
        target: picked !== undefined,
      });
      return;
    }
    if (rows.length !== wanted.size) {
      deps.logger.warn("a recommend import named rows the run does not have", {
        asked: wanted.size,
        kept: rows.length,
      });
    }
    const standing = runWarnings;
    const source =
      targetID === undefined ? undefined : deps.collectionOf(targetID);
    if (targetID === undefined || source === undefined) {
      publish({
        ...idle,
        warnings: [
          ...standing,
          message("research-helper-search-recommend-collection-gone"),
        ],
      });
      return;
    }
    const importTarget: SearchImportTarget = {
      ...picked,
      ...(request.parentIsSource && { parentCollectionId: targetID }),
    };

    generation += 1;
    const mine = generation;
    const tokenSource = createCancellationTokenSource();
    // Taken before the first await, so a second click cannot start a second write.
    running = tokenSource;
    const current = (): boolean => mine === generation;
    publish({
      running: true,
      cancelVisible: true,
      progressPercent: 0,
      status: message("research-helper-search-status-importing", {
        done: 0,
        total: rows.length,
      }),
      error: undefined,
      warnings: standing,
      notices: [],
      recommend: runView(),
    });
    const release = (dispose: () => void): void => {
      dispose();
      tokenSource.dispose();
      if (current()) running = undefined;
    };
    const defect = (): void => {
      if (!current()) return;
      publish({
        ...idle,
        warnings: [
          ...standing,
          message("research-helper-search-recommend-state-failed"),
        ],
        recommend: runView(),
      });
    };

    let job: Awaited<ReturnType<RecommendJobFactory["openJob"]>>;
    jobOpening = true;
    try {
      job = await deps.jobs.openJob({
        pipelineId: "searchImport",
        token: tokenSource.token,
        // `docs/08` §4.4, as a run's: nothing outside this window until the end.
        openOn: "completion",
      });
    } catch (error) {
      if (current()) jobOpening = false;
      release(() => undefined);
      defect();
      throw error;
    }
    if (!current()) {
      release(() => job.dispose());
      return;
    }
    jobOpening = false;
    const closeJob = surfacesOf(job);

    const unsubscribe = job.progress.events.subscribe((snapshot) => {
      if (!current()) return;
      publish({
        status: message("research-helper-search-status-importing", {
          done: snapshot.completed,
          total: snapshot.total ?? snapshot.completed,
        }),
        ...(snapshot.fraction !== undefined && {
          progressPercent: Math.max(
            0,
            Math.min(100, Math.round(snapshot.fraction * 100)),
          ),
        }),
      });
    });
    const quietly = (): void => {
      unsubscribe();
      release(closeJob);
    };

    let output: SearchImportOutput;
    try {
      output = await deps.imports.pipeline.run(
        recommendImportInput(rows, importTarget, source.libraryID),
        job.context,
      );
    } catch (error) {
      // `run()` returns its failures, as `start` says of its own.
      const wasCurrent = current();
      quietly();
      if (wasCurrent) defect();
      throw error;
    }
    if (!current()) {
      quietly();
      return;
    }

    running = undefined;
    const { patch, summary } = importOutcomeView(
      output,
      standing,
      message("research-helper-search-recommend-state-failed"),
    );
    publish({ ...idle, ...patch, recommend: runView() });
    deps.logger.info("a recommend import ended", {
      outcome: output.outcome,
      created: output.write?.created ?? 0,
      linkedExisting: output.write?.linkedExisting ?? 0,
    });
    const toast = summary === undefined ? undefined : await textOf(summary);
    unsubscribe();
    // A window closed while the toast was being worded raises nothing.
    if (current()) {
      job.progress.reporter.done(
        // `"partial"` is a completed run (FR-9), so the job succeeded.
        output.outcome === "partial" ? "succeeded" : output.outcome,
        toast,
      );
    }
    closeJob();
    tokenSource.dispose();
  }

  const host: RecommendWindowHost = {
    connect(next: RecommendWindowView): () => void {
      leaveRun();
      target = undefined;
      targetID = undefined;
      lastControls = RECOMMEND_DEFAULT_CONTROLS;
      lastRows = undefined;
      dismissedKeys = [];
      dismissedAsked = false;
      listNote = undefined;
      profile = undefined;
      heuristicReason = undefined;
      edits = NO_EDITS;
      touched = false;
      lastKind = undefined;
      runWarnings = [];
      keyRequestUrl = undefined;
      view = next;
      state = initialRecommendViewState();
      next.render(state);
      return () => {
        // A reload's new document can attach before the old one unloads, and the
        // old detach must not take the new window's view away.
        if (view !== next) return;
        leaveRun();
        view = undefined;
      };
    },

    open(collectionID: number): void {
      targetID = collectionID;
      target = deps.collectionOf(collectionID);
      if (target === undefined) {
        publish({
          ...idle,
          panel: "error",
          error: {
            headline: message(
              "research-helper-search-recommend-collection-gone",
            ),
            lines: [],
            details: [],
            retry: false,
            openPreferences: false,
          },
          recommend: runView(),
        });
        return;
      }
      publish({ recommend: runView() });
    },

    build,
    find,

    retry(): Promise<void> {
      if (lastKind === "find") return find(lastControls);
      return build();
    },

    dismiss,
    importRows,

    removeTerm(term: string): void {
      edited(editsWithRemoved(edits, term));
    },

    addTerm(typed: string): void {
      const term = cleanTerm(typed);
      // `docs/08` §5.4's note, decision 5: an added term is sent as a query.
      if (redact(term) !== term) {
        edited(edits, [
          ...runWarnings,
          message("research-helper-search-recommend-term-refused"),
        ]);
        return;
      }
      if (profile !== undefined) {
        edited(editsWithAdded(profile, edits, term));
      }
    },

    restoreTerm(term: string): void {
      edited(editsWithRestored(edits, term));
    },

    cancel(): void {
      releaseQuestions?.();
      running?.cancel({ kind: "user" });
    },
  };

  return {
    host,
    state: () => state,
  };
}
