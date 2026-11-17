/**
 * The related mode's view model (`plan/08` `P5-T16`, `P5-T17`; `docs/08` §5.2,
 * §5.3; FR-14 to FR-18).
 *
 * **Who calls it.** `publishSearchWindowHost` in `src/bootstrap/registerUI.ts`
 * constructs it once and publishes {@link RelatedViewModel.host} as
 * `host.related`; `addon/content/searchDialog.js` is the one caller of that host.
 *
 * It folds one `RelatedOutput` into one whole state, as
 * `searchImportViewModel.ts` does, so the document's `render()` draws both modes.
 * The decisions on how a run reads are `docs/08` §5.2's note "DECIDED 2026-11-05",
 * and on how an import from it works, that section's note of `P5-T17`.
 *
 * **An import is the search pipeline's preview import** over the ticked rows, so
 * no source is asked and no item is written by anything but `importWorks`. It
 * leaves the provenance note and row out by not passing through
 * `searchImportViewModel.ts`'s `renderImportOutcome`, the one place that writes
 * them (`plan/08` §0.4 line 16).
 *
 * **Two rules this file holds.**
 * - A citation context is the source's own text. It leaves here as a plain string
 *   in {@link RelatedChipView}'s `text`, never in a {@link MessageRef}, because
 *   Fluent's overlay parses an argument containing `<` as markup.
 * - The run is the only source of the key notice. `hasApiKey` is not read: a notice
 *   read from the run cannot disagree with what the run did.
 *
 * **Why the model is kept after a run ends and resets on `connect`.** There is one
 * model for the application and one window at a time, and a second "Find Related
 * Papers…" reloads that window. `connect` and the detach it returns both cancel a
 * run still going, and {@link RelatedViewModel} drops whatever that run later says.
 */

import type { SerializedError } from "../../core/errors";
import {
  createCancellationTokenSource,
  type CancellationToken,
  type CancellationTokenSource,
} from "../../core/jobQueue/cancellation";
import type { ProgressSnapshot } from "../../core/jobQueue/progress";
import type { Logger } from "../../core/logger";
import type { FluentMessageId } from "../../i18n/keys";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { RelationKind } from "../../model/related";
import type {
  SearchImportInput,
  SearchImportOutput,
  SearchImportTarget,
} from "../../pipeline/searchImport/types";
import { PREFS } from "../../prefs/schema";
import type {
  RelatedGeneratorId,
  RelatedGeneratorState,
  RelatedGeneratorStatus,
} from "../../pipeline/related/generators";
import { isCheckedByDefault } from "../../pipeline/related/score";
import type { ReasonChip } from "../../pipeline/related/score";
import type { SeedSourceFailure } from "../../pipeline/related/seed";
import type {
  RelatedFailed,
  RelatedInput,
  RelatedOutput,
  RelatedPipeline,
  RelatedRow,
  RelatedRows,
} from "../../pipeline/related/types";
import { LEXICAL_SIMILARITY_LABEL_ID } from "../../pipeline/shared/lexical";
import type { Pipeline, PipelineContext } from "../../pipeline/types";
import {
  relatedSeedHeader,
  type RelatedSeedHeader,
  type SearchWindowRecord,
} from "../dialogs/searchDialog";
import {
  errorDetails,
  errorView,
  importPathLines,
  importSummary,
  initialViewState,
  message,
  targetFromPicker,
  type CollectionDescriptor,
  type ErrorView,
  type MessageFormatter,
  type MessageRef,
  type SearchPanel,
  type SearchViewState,
  type SourceStatusLine,
} from "./searchImportViewModel";

/** How many dots a score draws out of (`docs/08` §5.2's wireframe). */
export const RELATED_SCORE_DOTS = 5;

const GENERATOR_NAME: Readonly<Record<RelatedGeneratorId, FluentMessageId>> = {
  "s2-recommendations":
    "research-helper-search-related-generator-s2-recommendations",
  pmra: "research-helper-search-related-generator-pmra",
  "s2-citations": "research-helper-search-related-generator-s2-citations",
  "s2-references": "research-helper-search-related-generator-s2-references",
  "europepmc-citations":
    "research-helper-search-related-generator-europepmc-citations",
  "europepmc-references":
    "research-helper-search-related-generator-europepmc-references",
  "crossref-references":
    "research-helper-search-related-generator-crossref-references",
};

/**
 * What a list's state reads as. `records` is what `answered` counted; `code` is the
 * machine code of a failed list.
 */
function stateDetail(status: RelatedGeneratorStatus): MessageRef {
  const state: RelatedGeneratorState = status.state;
  switch (state) {
    case "answered":
      return message("research-helper-search-source-results", {
        count: status.records,
      });
    case "no-key":
      return message("research-helper-search-related-source-no-key");
    case "not-indexed":
      return message("research-helper-search-related-source-not-indexed");
    case "could-not-ask":
      return message("research-helper-search-related-source-could-not-ask");
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

/** One status row, named by the list: Semantic Scholar answers for three of them. */
function statusLine(status: RelatedGeneratorStatus): SourceStatusLine {
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

/**
 * One line of the Relation column.
 *
 * `text` is set on a citation context alone, and is the source's own words. The
 * document writes it with `textContent`, and `ref` is then only its "Cited as:"
 * label.
 */
export interface RelatedChipView {
  readonly ref: MessageRef;
  readonly text?: string;
}

/** What a related row adds to a table row. */
export interface RelatedRowView {
  /** Every kind that found this work, for the Include boxes' filter. */
  readonly kinds: readonly RelationKind[];
  /** One line per reason, in the pipeline's chip order. */
  readonly chips: readonly RelatedChipView[];
  /** How many of {@link RELATED_SCORE_DOTS} are filled. */
  readonly dots: number;
  /** The dots' accessible name, or `undefined` for a row with no reason to show. */
  readonly scoreRef: MessageRef | undefined;
  readonly outsideWindow: boolean;
}

/** One row of the related table. */
export interface RelatedResultRow extends SearchWindowRecord {
  /** `isCheckedByDefault` on this row. */
  readonly startsTicked: boolean;
  readonly related: RelatedRowView;
}

/** One title match the window offers (FR-14). */
export interface RelatedCandidateView extends RelatedSeedHeader {
  /** What {@link RelatedWindowHost.pick} takes: the work's `workKey`. */
  readonly key: string;
}

/** What the related mode draws beyond a search state. */
export interface RelatedRunView {
  /** The title matches, while the window is asking which paper the item is. */
  readonly candidates: readonly RelatedCandidateView[];
  /** The key-request page, when the run found no usable Semantic Scholar key. */
  readonly keyRequestUrl: string | undefined;
  /** The four Include boxes' labels. */
  readonly includeLabels: Readonly<Record<RelationKind, MessageRef>>;
}

/** The whole state: a search state with the related mode's panel and rows. */
export interface RelatedViewState extends Omit<
  SearchViewState,
  "panel" | "records"
> {
  readonly panel: SearchPanel | "choose";
  readonly records: readonly RelatedResultRow[] | undefined;
  readonly related: RelatedRunView;
}

/** What the document hands over when it connects. */
export interface RelatedWindowView {
  render(state: RelatedViewState): void;
  /** The window's `document.l10n`, for the completion toast's text. */
  readonly formatter?: MessageFormatter;
}

/**
 * What the window's Import hands over (`P5-T17`). Built by
 * `relatedImportRequest` in `addon/content/searchDialog.js`, and read by
 * {@link RelatedWindowHost.importRows}.
 */
export interface RelatedImportRequest {
  /** The ticked visible rows' `workKey`s. */
  readonly keys: readonly string[];
  /** The target picker's value, as {@link targetFromPicker} reads it. */
  readonly collectionID: string;
  /** The link box. Ticked, each item written is related to the seed (FR-17). */
  readonly linkToSeed: boolean;
}

/** `host.related`: what `addon/content/searchDialog.js` calls. */
export interface RelatedWindowHost {
  /** Reset to a clean window, cancelling a run still going. Returns the detach. */
  connect(view: RelatedWindowView): () => void;
  /** Start a run on the seed. Resolves when the run has been drawn. */
  run(seedItemID: number): Promise<void>;
  /** Go on with one of the offered candidates, by key. An unknown key does nothing. */
  pick(key: string): Promise<void>;
  /** Run the last input again, a pick included. */
  retry(): Promise<void>;
  /** Write the ticked rows of the run on screen. Resolves when it has been drawn. */
  importRows(request: RelatedImportRequest): Promise<void>;
  /** The link box's starting state: `related.linkToSeed` (`docs/07` §8.5). */
  linkToSeedDefault(): boolean;
  cancel(): void;
}

/** The jobs the model opens. `graph.pipelineContext` satisfies it. */
export interface RelatedJobFactory {
  openJob(options: {
    readonly pipelineId: "related" | "searchImport";
    readonly token: CancellationToken;
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

/**
 * What the related window's import needs (`P5-T17`). Built by
 * `publishSearchWindowHost` in `src/bootstrap/registerUI.ts`, and read only by
 * {@link createRelatedViewModel}: `ui/` may not name `zotero/`.
 */
export interface RelatedImportPort {
  /** The search pipeline, for its preview import. */
  readonly pipeline: Pipeline<SearchImportInput, SearchImportOutput>;
  /** What the picker lists, to read a picked id back to its name. */
  listCollections(): readonly CollectionDescriptor[];
  /** `related.linkToSeed`. */
  linkToSeed(): boolean;
  /**
   * The library the seed is in, where the items must go: Zotero refuses a relation
   * across libraries. `undefined` when it is trashed or gone.
   */
  seedLibraryId(seedItemID: number): Promise<number | undefined>;
}

/** What {@link createRelatedViewModel} needs. */
export interface RelatedViewModelDeps {
  readonly pipeline: RelatedPipeline;
  /**
   * What words the toast: the window links its own bundle only (`docs/08` §10.1), and
   * `rh-error-cancelled` is the main one's. Absent, the window's formatter is used.
   */
  readonly toastFormatter?: MessageFormatter;
  readonly jobs: RelatedJobFactory;
  readonly logger: Logger;
  /** The Semantic Scholar key-request page: `ui/` may not name `sources/`. */
  readonly keyRequestUrl: string;
  readonly imports: RelatedImportPort;
}

/** What {@link createRelatedViewModel} returns. */
export interface RelatedViewModel {
  readonly host: RelatedWindowHost;
  /** The state last published. */
  state(): RelatedViewState;
}

/**
 * The filled dots, relative to the run's highest score (`docs/08` §5.2's note,
 * decision 3): the two kinds of run score on different ranges, so an absolute scale
 * would make every keyless row look poor.
 *
 * @param score - this row's score
 * @param highest - the highest score in the run
 * @returns 0 for no score; otherwise 1 to {@link RELATED_SCORE_DOTS}
 */
export function dotsOf(score: number, highest: number): number {
  if (!(score > 0) || !(highest > 0)) return 0;
  const filled = Math.ceil((RELATED_SCORE_DOTS * score) / highest);
  return Math.max(1, Math.min(RELATED_SCORE_DOTS, filled));
}

/** The kinds that found a work, each once, in the order found. */
function kindsOf(row: RelatedRow): readonly RelationKind[] {
  return [...new Set(row.edges.map(({ edge }) => edge.kind))];
}

/**
 * One reason as a line of the Relation column. The chip id is checked here, so a new
 * chip is a compile error rather than a blank line.
 *
 * @param chip - the pipeline's reason
 * @param lexical - whether this run's similarity is the basic kind (`docs/05` §5.5)
 */
function chipView(chip: ReasonChip, lexical: boolean): RelatedChipView {
  switch (chip.id) {
    case "cites-seed":
      return { ref: message("research-helper-search-related-chip-cites-seed") };
    case "cited-by-seed":
      return {
        ref: message("research-helper-search-related-chip-cited-by-seed"),
      };
    case "recommended":
      return {
        ref: message("research-helper-search-related-chip-recommended"),
      };
    case "similar-pubmed":
      return {
        ref: message("research-helper-search-related-chip-similar-pubmed"),
      };
    case "similar": {
      const value = chip.similarity.toFixed(2);
      return {
        ref: lexical
          ? message(
              `research-helper-search-related-chip-${LEXICAL_SIMILARITY_LABEL_ID}`,
              { value },
            )
          : message("research-helper-search-related-chip-similar", { value }),
      };
    }
    case "citation-context":
      return {
        ref: message("research-helper-search-related-chip-context-label"),
        text: chip.context,
      };
  }
}

/** One table row. The pipeline's order is kept by the caller: nothing re-sorts. */
function rowView(
  row: RelatedRow,
  highest: number,
  lexical: boolean,
): RelatedResultRow {
  const reasons = row.chips.map((chip) => chipView(chip, lexical));
  // A score never shows without its reasons (`plan/08` `P5-T16`'s Do NOT).
  const dots = reasons.length === 0 ? 0 : dotsOf(row.score, highest);
  return {
    key: row.work.workKey,
    title: row.work.title,
    authors: row.work.authors,
    ...(row.work.publishedDate?.year === undefined
      ? {}
      : { year: row.work.publishedDate.year }),
    // §5.2 draws no Source, Type or DOI column, and the window's filter matches
    // what a row shows.
    sourceLabels: [],
    typeLabel: "",
    doi: "",
    existing: row.inLibrary,
    startsTicked: isCheckedByDefault(row),
    related: {
      kinds: kindsOf(row),
      chips: row.outsideWindow
        ? [
            ...reasons,
            {
              ref: message(
                "research-helper-search-related-chip-outside-window",
              ),
            },
          ]
        : reasons,
      dots,
      scoreRef:
        reasons.length === 0
          ? undefined
          : message("research-helper-search-related-score", { dots }),
      outsideWindow: row.outsideWindow,
    },
  };
}

/** The Include boxes after a run: how many rows of the run have each kind. */
function countedLabels(
  rows: readonly RelatedResultRow[],
): RelatedRunView["includeLabels"] {
  const count = (kind: RelationKind): number =>
    rows.filter((row) => row.related.kinds.includes(kind)).length;
  return {
    reference: message(
      "research-helper-search-related-include-reference-count",
      { count: count("reference") },
    ),
    citation: message("research-helper-search-related-include-citation-count", {
      count: count("citation"),
    }),
    recommendation: message(
      "research-helper-search-related-include-recommendation-count",
      { count: count("recommendation") },
    ),
    similar: message("research-helper-search-related-include-similar-count", {
      count: count("similar"),
    }),
  };
}

/** The Include boxes before a run has ended: `P5-T15`'s bare labels. */
function bareLabels(): RelatedRunView["includeLabels"] {
  return {
    reference: message("research-helper-search-related-include-reference"),
    citation: message("research-helper-search-related-include-citation"),
    recommendation: message(
      "research-helper-search-related-include-recommendation",
    ),
    similar: message("research-helper-search-related-include-similar"),
  };
}

/** The non-blocking lines every ending can carry about the seed. */
function seedFailureLines(
  failures: readonly SeedSourceFailure[],
): readonly MessageRef[] {
  return failures.length === 0
    ? []
    : [message("research-helper-search-related-seed-failures")];
}

/** FR-9's banner for a finished list (`docs/08` §5.3). */
function rowsWarnings(output: RelatedRows): readonly MessageRef[] {
  return [
    ...(output.seed.matchedByTitle
      ? [message("research-helper-search-related-matched-by-title")]
      : []),
    ...seedFailureLines(output.seedFailures),
    ...(output.similarity.notice === "no-store"
      ? [message("research-helper-search-related-similarity-no-store")]
      : []),
    ...(output.similarity.notice === "fetch-failed"
      ? [message("research-helper-search-related-similarity-fetch-failed")]
      : []),
  ];
}

/**
 * The three seed errors. Their remedy is an edit to the item, so they offer no
 * button (`docs/08` §5.3's note of 2026-11-02).
 */
const SEED_ERROR_MESSAGE: Readonly<Record<string, MessageRef>> = {
  "rh-error-seed-gone": message("rh-error-seed-gone"),
  "rh-error-seed-no-identifier": message("rh-error-seed-no-identifier"),
  "rh-error-seed-no-match": message("rh-error-seed-no-match"),
};

/**
 * The codes whose `ERROR_ROWS` message names no database. A related run's failure
 * is not one database's, so any other code reads as the generic headline below,
 * with its machine code in the disclosure. `rh-error-source`, which takes
 * `$database`, is therefore never drawn: {@link failureView} words `SOURCE` itself.
 */
const CODES_WITH_NO_DATABASE: ReadonlySet<string> = new Set([
  "OFFLINE",
  "CONFIGURATION",
  "ZOTERO_API",
  "STORAGE",
]);

/**
 * Whether a run whose every list failed failed because Zotero is offline
 * (`plan/10` `P7-T33`; `plan/00` §6 item 393, owner, 2026-11-17).
 *
 * Measured by `P7-T18`: offline, the related run ends `SOURCE` (no list
 * answered) and each list's status carries `OFFLINE`. So the answer is yes when
 * at least one list failed and every list that failed failed `OFFLINE`; a list
 * that was not asked (no key, not indexed) does not count either way.
 *
 * @param error - the run's serialized error
 * @param statuses - the lists' states, as the run ended them
 */
export function failedOffline(
  error: SerializedError,
  statuses: readonly RelatedGeneratorStatus[],
): boolean {
  if (error.code === "OFFLINE") return true;
  if (error.code !== "SOURCE") return false;
  const failed = statuses.filter(
    (status) => status.state === "failed" || status.state === "rate-limited",
  );
  return (
    failed.length > 0 &&
    failed.every((status) => status.errorCode === "OFFLINE")
  );
}

/**
 * A run's failure as the error panel. Every list's own state is on the status rows,
 * so the panel carries no lines of its own.
 *
 * *`P7-T33` (2026-11-17):* given the lists' states, a run that failed because Zotero
 * is offline ({@link failedOffline}) is drawn with `rh-error-offline`, the message
 * the keyword search shows, and Retry; its machine code stays in the disclosure.
 *
 * @param error - the pipeline's serialized error, already redacted
 * @param fallback - the headline for any other code; the recommend mode has its own
 * @param statuses - the lists' states; absent, the offline reading uses `error` alone
 */
export function failureView(
  error: SerializedError,
  fallback: MessageRef = message("research-helper-search-related-state-failed"),
  statuses: readonly RelatedGeneratorStatus[] = [],
): ErrorView {
  if (error.code === "SOURCE" && failedOffline(error, statuses)) {
    return {
      headline: message("rh-error-offline"),
      lines: [],
      details: errorDetails([error]),
      retry: true,
      openPreferences: false,
    };
  }
  const seed = SEED_ERROR_MESSAGE[error.messageKey];
  if (seed !== undefined) {
    return {
      headline: seed,
      lines: [],
      details: errorDetails([error]),
      retry: false,
      openPreferences: false,
    };
  }
  if (error.code === "SOURCE") {
    return {
      headline: message("research-helper-search-state-error"),
      lines: [],
      details: errorDetails([error]),
      retry: true,
      openPreferences: false,
    };
  }
  if (CODES_WITH_NO_DATABASE.has(error.code)) {
    const row = errorView(error, "");
    return {
      headline: row.ref,
      lines: [],
      details: errorDetails([error]),
      retry: row.retry,
      openPreferences: row.prefs,
    };
  }
  return {
    headline: fallback,
    lines: [],
    details: errorDetails([error]),
    retry: error.retryable,
    openPreferences: false,
  };
}

/** The state before any run, and after `connect`. */
export function initialRelatedViewState(): RelatedViewState {
  return {
    ...initialViewState(),
    panel: "initial",
    records: undefined,
    related: {
      candidates: [],
      keyRequestUrl: undefined,
      includeLabels: bareLabels(),
    },
  };
}

/**
 * What an import said, as a patch of the state, and the line a toast repeats when
 * anything was written. The table stays, because no line of it has changed and no
 * panel here could offer the import again (`docs/08` §5.2's note, decision 7).
 *
 * Callers: `drawImport` in this file, and `importRows` in `recommendViewModel.ts`.
 *
 * @param output - the search pipeline's answer
 * @param standing - the warnings the table already carries
 * @param fallback - the headline of a failure with no sentence of its own
 */
export function importOutcomeView(
  output: SearchImportOutput,
  standing: readonly MessageRef[],
  fallback?: MessageRef,
): {
  readonly patch: Partial<
    Pick<SearchViewState, "status" | "notices" | "warnings">
  >;
  readonly summary: MessageRef | undefined;
} {
  const write = output.write;
  const headline =
    output.outcome === "failed" && output.error !== undefined
      ? [failureView(output.error, fallback).headline]
      : [];
  if (write === undefined) {
    return {
      patch: {
        warnings: [...standing, ...headline],
        ...(output.outcome === "cancelled" && {
          status: message("rh-error-cancelled", { imported: 0 }),
        }),
      },
      summary: undefined,
    };
  }
  const summary = importSummary(write, false);
  return {
    patch: {
      status: summary,
      notices: [
        ...(output.outcome === "cancelled"
          ? [message("rh-error-cancelled", { imported: write.created })]
          : []),
        summary,
        message("research-helper-import-abstract-coverage", {
          percent: write.abstractCoveragePercent,
        }),
        ...importPathLines(write),
      ],
      warnings: [
        ...standing,
        ...headline,
        ...(write.seedLink?.error === undefined
          ? []
          : [message("research-helper-search-related-link-failed")]),
      ],
    },
    summary,
  };
}

/**
 * The search pipeline's input for an import of these rows: its preview path, so
 * Merging passes the rows' works through and Backfilling and Screening are skipped.
 * Only the rows to write are passed, so no `selectedRecordIds`.
 *
 * `records[i]` is `works[i]`'s representative. `limit` only has to be in range,
 * because no source is asked. The policy is always "add the existing item to the
 * collection": FR-16 says that is what importing an in-library row does.
 *
 * @param rows - the rows to write, each with a record
 * @param target - the collection the picker named
 * @param libraryId - the seed's library
 * @param relateTo - the seed's item id when the link box is ticked
 */
function relatedImportInput(
  rows: readonly RelatedRow[],
  target: SearchImportTarget,
  libraryId: number,
  relateTo: number | undefined,
): SearchImportInput {
  const existing = new Map<string, number>();
  for (const row of rows) {
    if (row.inLibrary && row.existingItemID !== undefined) {
      existing.set(row.work.workKey, row.existingItemID);
    }
  }
  return {
    query: "",
    sourceIds: [],
    limit: PREFS.maxResults.min,
    dateFilter: "none",
    records: rows.flatMap((row) => row.records.slice(0, 1)),
    works: rows.map((row) => row.work),
    target: {
      ...target,
      libraryId,
      duplicatePolicy: "link-existing",
      ...(relateTo !== undefined && { relateTo }),
      ...(existing.size > 0 && { existingItemIDs: existing }),
    },
  };
}

/**
 * Build the model. See the file header for who calls it.
 *
 * @param deps - the pipeline, the job factory, the logger, the key-request page and
 *   the import's port
 */
export function createRelatedViewModel(
  deps: RelatedViewModelDeps,
): RelatedViewModel {
  let state = initialRelatedViewState();
  let view: RelatedWindowView | undefined;
  /** Bumped when a run is left behind. A run with an older number draws nothing. */
  let generation = 0;
  let running: CancellationTokenSource | undefined;
  /** Closes the open job's surfaces, once. Set while a job is open. */
  let closeSurfaces: (() => void) | undefined;
  /** `openJob` is out for the current run, so no reporter holds its token yet. */
  let jobOpening = false;
  let lastInput: RelatedInput | undefined;
  let offered: readonly CanonicalWork[] = [];
  /** The finished list on screen, which is what an import reads its rows from. */
  let lastRows: RelatedRows | undefined;

  function publish(patch: Partial<RelatedViewState>): void {
    state = { ...state, ...patch };
    view?.render(state);
  }

  /**
   * Leave any run behind: cancel it and drop whatever it says from now on.
   *
   * A left run raises no toast (`docs/08` §5.2's note, corrected 2026-11-05). The
   * job's reporter answers its token's cancel with `done("cancelled")`, and the
   * popup paints that whatever this model's `current()` says, so the surfaces close
   * first. While `openJob` is out nothing runs on the token, and a reporter built on
   * a cancelled one would raise the toast at once, so the token is left alone there:
   * the run sees it is no longer current when the job comes back, and disposes it.
   */
  function leaveRun(): void {
    generation += 1;
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

  function drawFailure(
    error: SerializedError,
    statuses: RelatedFailed["statuses"],
    warnings: readonly MessageRef[],
  ): void {
    publish({
      ...idle,
      panel: "error",
      error: failureView(error, undefined, statuses),
      sources: statuses.map(statusLine),
      warnings,
    });
  }

  function drawRows(output: RelatedRows): void {
    lastRows = output;
    const highest = output.rows.reduce(
      (most, row) => Math.max(most, row.score),
      0,
    );
    const lexical = output.similarity.space === "lexical";
    const records = output.rows.map((row) => rowView(row, highest, lexical));
    publish({
      ...idle,
      panel: records.length === 0 ? "empty" : "results",
      records,
      recordsRevision: state.recordsRevision + 1,
      emptyHeadline:
        records.length === 0
          ? message("research-helper-search-related-state-empty")
          : undefined,
      sources: output.statuses.map(statusLine),
      warnings: rowsWarnings(output),
      related: {
        candidates: [],
        keyRequestUrl: output.keyNotice ? deps.keyRequestUrl : undefined,
        includeLabels: countedLabels(records),
      },
    });
  }

  /** Fold one output into the state. */
  function draw(output: RelatedOutput): void {
    if (output.outcome === "cancelled") {
      publish({
        ...idle,
        panel: "initial",
        status: message("research-helper-search-related-status-cancelled"),
        warnings: seedFailureLines(output.seedFailures),
      });
      return;
    }
    if (output.outcome === "failed") {
      drawFailure(
        output.error,
        output.statuses,
        seedFailureLines(output.seedFailures),
      );
      return;
    }
    if (output.ending === "choose") {
      offered = output.candidates;
      publish({
        ...idle,
        panel: "choose",
        warnings: seedFailureLines(output.seedFailures),
        related: {
          ...state.related,
          candidates: output.candidates.map((work) => ({
            ...relatedSeedHeader(work),
            key: work.workKey,
          })),
        },
      });
      return;
    }
    drawRows(output);
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

  /** The completion toast's text. */
  function toastOf(output: RelatedRows): Promise<string | undefined> {
    return textOf(
      message("research-helper-search-result-count", {
        total: output.rows.length,
        new: output.rows.filter((row) => !row.inLibrary).length,
      }),
    );
  }

  async function start(input: RelatedInput): Promise<void> {
    if (running !== undefined) {
      deps.logger.warn("a related run is already going; ignoring", {
        panel: state.panel,
      });
      return;
    }
    const checked = deps.pipeline.validate(input);
    if (!checked.ok) {
      const first = checked.errors[0];
      const headline =
        first === undefined ? undefined : SEED_ERROR_MESSAGE[first.messageKey];
      publish({
        ...idle,
        panel: "error",
        error: {
          headline:
            headline ?? message("research-helper-search-related-state-failed"),
          lines: [],
          details: [],
          retry: false,
          openPreferences: false,
        },
      });
      return;
    }

    generation += 1;
    const mine = generation;
    const tokenSource = createCancellationTokenSource();
    running = tokenSource;
    lastInput = input;
    offered = [];
    lastRows = undefined;
    publish({
      // No list has answered yet, so the panel still says what will appear.
      panel: "initial",
      running: true,
      cancelVisible: true,
      progressPercent: 0,
      status: message("research-helper-search-related-status-running"),
      records: [],
      recordsRevision: state.recordsRevision + 1,
      emptyHeadline: undefined,
      error: undefined,
      warnings: [],
      notices: [],
      sources: [],
      related: initialRelatedViewState().related,
    });

    const current = (): boolean => mine === generation;
    /** Let go of a run this model has stopped listening to, or a run with no toast. */
    const release = (dispose: () => void): void => {
      dispose();
      tokenSource.dispose();
      if (current()) running = undefined;
    };

    let job: Awaited<ReturnType<RelatedJobFactory["openJob"]>>;
    jobOpening = true;
    try {
      job = await deps.jobs.openJob({
        pipelineId: "related",
        token: tokenSource.token,
        // `docs/08` §4.4: nothing is drawn outside this window until the end.
        openOn: "completion",
      });
    } catch (error) {
      if (current()) jobOpening = false;
      release(() => undefined);
      if (current()) {
        publish({
          ...idle,
          panel: "error",
          error: {
            headline: message("research-helper-search-related-state-failed"),
            lines: [],
            details: [],
            retry: true,
            openPreferences: false,
          },
        });
      }
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

    let output: RelatedOutput;
    try {
      output = await deps.pipeline.run(input, job.context);
    } catch (error) {
      // `run()` returns its failures, so reaching here is a defect below this
      // line. The surfaces still close, or the window keeps its Cancel for ever.
      const wasCurrent = current();
      quietly();
      if (wasCurrent) {
        publish({
          ...idle,
          panel: "error",
          error: {
            headline: message("research-helper-search-related-state-failed"),
            lines: [],
            details: [],
            retry: true,
            openPreferences: false,
          },
        });
      }
      throw error;
    }
    if (!current()) {
      quietly();
      return;
    }

    running = undefined;
    draw(output);

    if (output.outcome === "succeeded" && output.ending === "choose") {
      // The run has not ended for the user: the window is asking them something.
      unsubscribe();
      closeJob();
      tokenSource.dispose();
      return;
    }
    const toast =
      output.outcome === "succeeded"
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

  /**
   * What an import said, drawn beside the rows it read.
   *
   * @param output - the search pipeline's answer
   * @param standing - the warnings the table already carries
   * @returns the line the toast repeats, when anything was written
   */
  function drawImport(
    output: SearchImportOutput,
    standing: readonly MessageRef[],
  ): MessageRef | undefined {
    const { patch, summary } = importOutcomeView(output, standing);
    publish({ ...idle, ...patch });
    return summary;
  }

  /**
   * `P5-T17`'s import. A refusal writes nothing and leaves the window as it was,
   * because the document's gate refuses the same cases first and a host driven
   * directly must not reach a write by another road.
   *
   * @param request - what the document read off its controls
   */
  async function importRows(request: RelatedImportRequest): Promise<void> {
    if (running !== undefined) {
      deps.logger.warn("a related run or import is going; ignoring", {
        panel: state.panel,
      });
      return;
    }
    const seedItemID = lastInput?.seedItemID;
    const list = lastRows;
    const target = targetFromPicker(
      request.collectionID,
      deps.imports.listCollections(),
    );
    const wanted = new Set(request.keys);
    const rows = (list?.rows ?? []).filter(
      (row) => wanted.has(row.work.workKey) && row.records.length > 0,
    );
    if (
      seedItemID === undefined ||
      list === undefined ||
      target === undefined ||
      rows.length === 0
    ) {
      deps.logger.warn("a related import had nothing to write; ignoring", {
        rows: rows.length,
        target: target !== undefined,
      });
      return;
    }
    if (rows.length !== wanted.size) {
      deps.logger.warn("a related import named rows the run does not have", {
        asked: wanted.size,
        kept: rows.length,
      });
    }

    generation += 1;
    const mine = generation;
    const tokenSource = createCancellationTokenSource();
    // Taken before the first await, so a second click cannot start a second write.
    running = tokenSource;
    const current = (): boolean => mine === generation;
    const standing = rowsWarnings(list);
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
          message("research-helper-search-related-state-failed"),
        ],
      });
    };

    let libraryId: number | undefined;
    let job: Awaited<ReturnType<RelatedJobFactory["openJob"]>>;
    try {
      libraryId = await deps.imports.seedLibraryId(seedItemID);
      if (libraryId === undefined) {
        release(() => undefined);
        if (current()) {
          publish({
            ...idle,
            warnings: [
              ...standing,
              message("research-helper-search-related-seed-gone"),
            ],
          });
        }
        return;
      }
      // The window left while the seed was read: a reporter built on the cancelled
      // token would raise the toast `leaveRun` keeps away.
      if (!current()) {
        release(() => undefined);
        return;
      }
      jobOpening = true;
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
        relatedImportInput(
          rows,
          target,
          libraryId,
          request.linkToSeed ? seedItemID : undefined,
        ),
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
    const summary = drawImport(output, standing);
    deps.logger.info("a related import ended", {
      outcome: output.outcome,
      created: output.write?.created ?? 0,
      linkedExisting: output.write?.linkedExisting ?? 0,
      linkedToSeed: output.write?.seedLink?.linked ?? 0,
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

  const host: RelatedWindowHost = {
    connect(next: RelatedWindowView): () => void {
      leaveRun();
      lastInput = undefined;
      offered = [];
      lastRows = undefined;
      view = next;
      state = initialRelatedViewState();
      next.render(state);
      return () => {
        // A reload's new document can attach before the old one unloads, and the
        // old detach must not take the new window's view away.
        if (view !== next) return;
        leaveRun();
        view = undefined;
      };
    },

    run(seedItemID: number): Promise<void> {
      return start({ seedItemID });
    },

    pick(key: string): Promise<void> {
      const chosenSeed = offered.find((work) => work.workKey === key);
      if (chosenSeed === undefined || lastInput === undefined) {
        deps.logger.warn("a related pick named no offered paper; ignoring");
        return Promise.resolve();
      }
      return start({ seedItemID: lastInput.seedItemID, chosenSeed });
    },

    retry(): Promise<void> {
      return lastInput === undefined ? Promise.resolve() : start(lastInput);
    },

    importRows,

    linkToSeedDefault(): boolean {
      return deps.imports.linkToSeed();
    },

    cancel(): void {
      running?.cancel({ kind: "user" });
    },
  };

  return {
    host,
    state: () => state,
  };
}
