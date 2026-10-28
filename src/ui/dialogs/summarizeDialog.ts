/**
 * The summarize window (`P3-T29`; FR-19, FR-23, FR-53; `docs/08` §2.5's note
 * of 2026-10-29 and §6.4's "Stage 1–2" layout): its strings, the model the
 * window draws, the run's confirmation, and the call that opens it.
 *
 * ## Who calls what (`plan/README.md` §5 rule 10)
 *
 * - `src/ui/menus/registerMenus.ts`'s collection submenu calls
 *   `SearchMenuCommands.openSummarizeWindow`, which
 *   `src/bootstrap/registerUI.ts` binds to {@link openSummarizeWindow} with a
 *   {@link SummarizeWindowSession} it builds over the service graph.
 * - `addon/content/summarize.js` (the window) calls the session; the session
 *   calls the window back through {@link SummarizeWindowSink}.
 * - The run itself is `src/pipeline/summarize/summarizePipeline.ts`, driven by
 *   the session on the privileged side — **never inside the window**, and the
 *   window is not modal (`P3-T29` Do NOT).
 *
 * ## What is decided here
 *
 * {@link buildSummarizeWindowModel} turns the run's view into Fluent lines,
 * so the window script places ids and arguments and formats nothing.
 * {@link confirmSummarizeRun} is the run's confirmation over `P3-T16`'s
 * pieces: `mustAskConfirmation` against the collection's **summarize**
 * record (`routineConfirmation`, separate from the report run's, `plan/00`
 * §6 item 292(f)), then `shouldOpenCostDialog`, so a question forced by money
 * is asked whatever "don't ask again" says (item 274(b)). When the dialog does
 * not open, the window shows the number (`skippedNoticeLine`): no run starts
 * without one.
 *
 * Like `./costConfirmDialog.ts`, this takes the host window as a parameter:
 * `src/ui/**` may not name the `Zotero` global nor import `src/zotero/**`.
 */

import { config } from "../../../package.json";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { JobRecord } from "../../core/jobQueue/jobRecord";
import {
  L10N_JOB_WALL_CLOCK_BUDGET,
  type MainWindowMessageId,
} from "../../i18n/keys";
import type { CeilingKind } from "../../pipeline/shared/budget";
import {
  mustAskConfirmation,
  routineConfirmationFor,
  type EgressDisclosure,
} from "../../pipeline/shared/egressDisclosure";
import type {
  CollectionRef,
  RoutineConfirmation,
} from "../../pipeline/shared/privacyPolicy";
import type {
  PreparedSummarizeRun,
  SummarizeConfirmAnswer,
  SummarizeConfirmRequest,
  SummarizeInput,
  SummarizeOutcome,
  SummarizeOutput,
  SummarizePipeline,
  SummarizeQuestion,
  SummarizeRunView,
  SummarizeSurface,
} from "../../pipeline/summarize/summarizePipeline";
import type { PipelineContext } from "../../pipeline/types";
import {
  SummaryNotStoredError,
  type NotSummarizedReason,
} from "../panes/summarySection";
import {
  shouldOpenCostDialog,
  skippedNoticeLine,
  type CostDialogInput,
  type CostDialogOutcome,
  type FluentLine,
} from "./costConfirmDialog";

// ===========================================================================
// 1. Strings and window constants
// ===========================================================================

/**
 * Every id the window and its host use, in `research-helper-mainWindow.ftl`
 * (`docs/08` §10.1: a dialog raised from the main window resolves against
 * the main-window bundle). Typed so an id missing from that bundle's list
 * does not compile.
 */
export const SUMMARIZE_DIALOG_L10N = {
  title: "research-helper-summarize-title",
  collection: "research-helper-summarize-collection",
  resummarize: "research-helper-summarize-resummarize",
  writeNotes: "research-helper-summarize-write-notes",
  notesReadonly: "research-helper-summarize-notes-readonly",
  start: "research-helper-summarize-start",
  cancel: "research-helper-summarize-cancel",
  close: "research-helper-summarize-close",
  export: "research-helper-summarize-export",
  stage: "research-helper-summarize-stage",
  progress: "research-helper-summarize-progress",
  remaining: "research-helper-summarize-remaining",
  row: "research-helper-summarize-row",
  counts: "research-helper-summarize-counts",
  outcome: "research-helper-summarize-outcome",
  keyNeeded: "research-helper-summarize-key-needed",
  continue: "research-helper-summarize-continue",
  stop: "research-helper-summarize-stop",
  exportOutcome: "research-helper-summarize-export-outcome",
  wallClock: L10N_JOB_WALL_CLOCK_BUDGET,
} as const satisfies Record<string, MainWindowMessageId>;

/** The removal command's prompt (FR-20), shown by the host with `Services.prompt`. */
export const REMOVE_NOTES_L10N = {
  title: "research-helper-remove-notes-title",
  confirm: "research-helper-remove-notes-confirm",
  none: "research-helper-remove-notes-none",
  done: "research-helper-remove-notes-done",
} as const satisfies Record<string, MainWindowMessageId>;

/** The document the window loads (`addon/content/summarize.xhtml`). */
export const SUMMARIZE_WINDOW_URL = `chrome://${config.addonRef}/content/summarize.xhtml`;

/** One window per collection: its name carries the collection id. */
export const SUMMARIZE_WINDOW_NAME_PREFIX = "research-helper-summarize-";

/** Modeless (`dialog=no`): the run must not hold the main window. */
export const SUMMARIZE_WINDOW_FEATURES =
  "chrome,titlebar,centerscreen,resizable,dialog=no";

/** The window's root element id. */
export const SUMMARIZE_WINDOW_ROOT_ID = "rh-summarize-window";

// ===========================================================================
// 2. The model the window draws
// ===========================================================================

/** What the window shows, as Fluent lines; the script formats nothing. */
export interface SummarizeWindowModel {
  readonly header: FluentLine | undefined;
  readonly stage: FluentLine | undefined;
  readonly progress: FluentLine | undefined;
  readonly remaining: FluentLine | undefined;
  /** The cost line when the dialog was skipped (FR-24: no run without a number). */
  readonly notice: FluentLine | undefined;
  readonly rows: readonly FluentLine[];
  readonly counts: FluentLine | undefined;
  readonly outcome: FluentLine | undefined;
  /** A run is in progress: Start and the options are disabled, Cancel enabled. */
  readonly running: boolean;
  /** Notes can be written; otherwise the option is disabled and explained. */
  readonly notesWritable: boolean;
  /** The read-only export is offered (a finished run left summaries). */
  readonly exportAvailable: boolean;
}

/** An outcome the window states that is not the pipeline's own. */
export type SummarizeWindowOutcome =
  SummarizeOutcome | "nothing" | "unavailable";

/** What the host adds to the run's view. */
export interface SummarizeModelExtras {
  readonly running: boolean;
  /** FR-53's remaining time, from the job's progress snapshot. */
  readonly etaSeconds?: number | undefined;
  readonly notice?: FluentLine | undefined;
  readonly outcome?:
    | {
        readonly kind: SummarizeWindowOutcome;
        readonly stoppedAt?: number | undefined;
      }
    | undefined;
  readonly exportAvailable?: boolean;
}

/**
 * The window's model for one moment of the run.
 *
 * @param view - the pipeline's view (`SummarizeSurface.update`)
 * @param extras - what the host knows besides
 */
export function buildSummarizeWindowModel(
  view: SummarizeRunView,
  extras: SummarizeModelExtras,
): SummarizeWindowModel {
  const c = view.counts;
  const showProgress =
    view.stage === "summarizing" ||
    view.stage === "waiting" ||
    view.stage === "writing" ||
    view.stage === "done";
  const finished = view.stage === "done" || extras.outcome !== undefined;
  const outcome = extras.outcome;
  return {
    header:
      view.collectionName === ""
        ? undefined
        : {
            id: SUMMARIZE_DIALOG_L10N.collection,
            args: { name: view.collectionName, count: view.total },
          },
    stage: { id: SUMMARIZE_DIALOG_L10N.stage, args: { stage: view.stage } },
    progress:
      showProgress && view.toSummarize > 0
        ? {
            id: SUMMARIZE_DIALOG_L10N.progress,
            args: {
              done: view.settled,
              total: view.toSummarize,
              cached: c.cached,
              fresh: c.fresh,
            },
          }
        : undefined,
    remaining:
      extras.running &&
      view.stage === "summarizing" &&
      extras.etaSeconds !== undefined &&
      Number.isFinite(extras.etaSeconds)
        ? {
            id: SUMMARIZE_DIALOG_L10N.remaining,
            args: { minutes: Math.max(0, Math.round(extras.etaSeconds / 60)) },
          }
        : undefined,
    notice: extras.notice,
    rows: view.rows.map((row) => ({
      id: SUMMARIZE_DIALOG_L10N.row,
      args: { status: row.status, title: row.title },
    })),
    counts: finished
      ? {
          id: SUMMARIZE_DIALOG_L10N.counts,
          args: {
            fulltext: c.fullText,
            abstract: c.abstractOnly,
            notext: c.noText,
            retracted: c.retracted,
            duplicate: c.duplicate,
          },
        }
      : undefined,
    outcome:
      outcome === undefined
        ? undefined
        : {
            id: SUMMARIZE_DIALOG_L10N.outcome,
            args: {
              outcome: outcome.kind,
              done: c.cached + c.fresh,
              total: view.toSummarize,
              at: outcome.stoppedAt ?? view.settled + 1,
              failed: c.failed,
              notes: c.notesWritten,
            },
          },
    running: extras.running,
    notesWritable: view.notesWritable,
    exportAvailable: extras.exportAvailable === true,
  };
}

// ===========================================================================
// 3. The run's confirmation (P3-T16's pieces; plan/00 §6 items 274(b), 292(f))
// ===========================================================================

/** What {@link confirmSummarizeRun} needs from the host. */
export interface SummarizeConfirmDeps {
  /** The collection's summarize record (`routineConfirmation`), if any. */
  readRoutine(
    collection: CollectionRef,
  ): Promise<RoutineConfirmation | undefined>;
  /** Store the record "don't ask again" was ticked under. */
  writeRoutine(
    collection: CollectionRef,
    record: RoutineConfirmation,
  ): Promise<void>;
  /** `P3-T16`'s dialog (`confirmRunCost` in `src/bootstrap/registerUI.ts`). */
  openDialog(input: CostDialogInput): Promise<CostDialogOutcome>;
  /** `settleDisclosure` over the user's answer. */
  settle(
    disclosure: EgressDisclosure,
    outcome: "confirmed" | "cancelled",
  ): void;
  /** `summary.confirmAboveCents`, `summary.fullTextAutoMaxPapers`. */
  readonly confirmAboveCents: () => number;
  readonly fullTextAutoMaxPapers: () => number;
  /** The provider's display name. */
  providerName(disclosure: EgressDisclosure): Promise<string>;
  /** For the skipped-dialog line. */
  readonly locale: () => string;
}

/** {@link confirmSummarizeRun}'s answer: the pipeline's, and the window's line. */
export interface SummarizeConfirmResult {
  readonly answer: SummarizeConfirmAnswer;
  /** The number, when the dialog was skipped (FR-24). */
  readonly notice: FluentLine | undefined;
}

/**
 * Ask, or skip asking, before a summarize run spends (`docs/09` §3.6's note
 * of 2026-10-23). A record that cannot be read counts as none, so the
 * question is asked. A dialog that cannot open runs nothing.
 *
 * @param deps - see {@link SummarizeConfirmDeps}
 * @param request - from the pipeline's `prepare`
 */
export async function confirmSummarizeRun(
  deps: SummarizeConfirmDeps,
  request: SummarizeConfirmRequest,
): Promise<SummarizeConfirmResult> {
  // A run over no collection has no "don't ask again" record to read, and
  // its dialog offers no box to store one (item 303(a); as the search's
  // screening dialog, `docs/08` §4.2's note of 2026-10-24).
  const collection = request.collection;
  let routine: RoutineConfirmation | undefined;
  try {
    routine =
      collection === undefined ? undefined : await deps.readRoutine(collection);
  } catch {
    routine = undefined;
  }
  const confirmation = mustAskConfirmation(request.disclosure, routine);
  const decision = shouldOpenCostDialog({
    confirmation,
    plan: request.estimate.selected,
    confirmAboveCents: deps.confirmAboveCents(),
    ceiling: request.ceilingSelected,
  });
  if (!decision.open) {
    return {
      answer: { kind: "run", plan: "selected", raise: undefined },
      notice:
        request.estimate.selected.calls === 0
          ? undefined
          : skippedNoticeLine(request.estimate.selected, deps.locale()),
    };
  }
  let outcome: CostDialogOutcome;
  try {
    outcome = await deps.openDialog({
      mode: "preflight",
      estimate: request.estimate,
      disclosure: request.disclosure,
      confirmAboveCents: deps.confirmAboveCents(),
      fullTextAutoMaxPapers: deps.fullTextAutoMaxPapers(),
      providerName: await deps.providerName(request.disclosure),
      ceilingSelected: request.ceilingSelected,
      ceilingDowngrade: request.ceilingDowngrade,
      session: request.session,
      ...(collection === undefined && { offerDontAskAgain: false }),
    });
  } catch {
    outcome = { kind: "cancelled" };
  }
  if (outcome.kind !== "run") {
    deps.settle(request.disclosure, "cancelled");
    return { answer: { kind: "cancelled" }, notice: undefined };
  }
  deps.settle(request.disclosure, "confirmed");
  if (outcome.dontAskAgain && collection !== undefined) {
    try {
      await deps.writeRoutine(
        collection,
        routineConfirmationFor(request.disclosure),
      );
    } catch {
      // Not stored: the next run asks again, which is the safe direction.
    }
  }
  const raise:
    { readonly ceiling: CeilingKind; readonly limitUsd: number } | undefined =
    outcome.raise;
  return {
    answer: { kind: "run", plan: outcome.plan, raise },
    notice: undefined,
  };
}

// ===========================================================================
// 4. The window and its session
// ===========================================================================

/** What the window tells its host it may draw: the collection before a run. */
export interface SummarizeWindowDescription {
  readonly model: SummarizeWindowModel;
  /** `report.perPaperNotes`, the option's starting value. */
  readonly writeNotesDefault: boolean;
}

/** The window side, which the session calls. */
export interface SummarizeWindowSink {
  /** Draw this model. Must not throw. */
  render(model: SummarizeWindowModel): void;
  /** Ask a paused run's question in the window: continue, or stop. */
  ask(line: FluentLine): Promise<"resume" | "cancel">;
}

/** The privileged side, which the window calls (`window.arguments[0].session`). */
export interface SummarizeWindowSession {
  describe(): Promise<SummarizeWindowDescription>;
  /** Run once; resolves when the run has ended. */
  start(
    options: { readonly resummarize: boolean; readonly writeNotes: boolean },
    sink: SummarizeWindowSink,
  ): Promise<void>;
  /** Cancel the run, keeping every summary made. */
  cancel(): void;
  /** The read-only export, to a path the user chose; the path is never kept. */
  exportSummaries(path: string): Promise<"written" | "failed">;
  /** The window is closing: a running job is cancelled. */
  closed(): void;
}

/** What the window receives as `window.arguments[0]`. */
export interface SummarizeWindowArgs {
  readonly session: SummarizeWindowSession;
  /** The ids the script needs for its own chrome (title, buttons). */
  readonly l10n: typeof SUMMARIZE_DIALOG_L10N;
}

/** The host window's one member this module calls. */
export interface SummarizeWindowHost {
  openDialog(
    url?: string,
    name?: string,
    features?: string,
    ...extraArguments: unknown[]
  ): { focus(): void } | null;
}

/**
 * Open the summarize window over `host`.
 *
 * @param host - the main window the menu was clicked in
 * @param collectionID - names the window, so a second open raises the first
 * @param session - the privileged side
 * @throws when the window cannot be opened
 */
export function openSummarizeWindow(
  host: SummarizeWindowHost,
  collectionID: number,
  session: SummarizeWindowSession,
): void {
  const args: SummarizeWindowArgs = { session, l10n: SUMMARIZE_DIALOG_L10N };
  const win = host.openDialog(
    SUMMARIZE_WINDOW_URL,
    `${SUMMARIZE_WINDOW_NAME_PREFIX}${String(collectionID)}`,
    SUMMARIZE_WINDOW_FEATURES,
    args,
  );
  if (!win) {
    throw new Error(
      `[research-helper] openDialog("${SUMMARIZE_WINDOW_URL}") returned no window.`,
    );
  }
  win.focus();
}

/**
 * The question line for a paused run that the window asks itself (the money
 * question is the cost dialog's).
 *
 * @param question - the reason and its figures
 */
export function pauseQuestionLine(
  question:
    | { readonly reason: "credential-required"; readonly provider: string }
    | {
        readonly reason: "wall-clock-budget" | "other";
        readonly done: number;
        readonly total: number;
        readonly minutes: number;
      },
): FluentLine {
  if (question.reason === "credential-required") {
    return {
      id: SUMMARIZE_DIALOG_L10N.keyNeeded,
      args: { provider: question.provider },
    };
  }
  if (question.reason === "wall-clock-budget") {
    return {
      id: SUMMARIZE_DIALOG_L10N.wallClock,
      args: {
        minutes: question.minutes,
        done: question.done,
        total: question.total,
      },
    };
  }
  return { id: SUMMARIZE_DIALOG_L10N.stage, args: { stage: "waiting" } };
}

// ===========================================================================
// 5. The item pane's one-item run (owner, plan/00 §6 item 303(a))
// ===========================================================================

/** One job context {@link runItemSummary} runs a half of the pipeline in. */
export interface ItemSummaryJob {
  readonly context: PipelineContext;
  /**
   * The half is over: report its end to the job's progress (`undefined` for
   * the prepare half, which has no record) and close its surfaces.
   */
  finish(
    outcome: "succeeded" | "failed" | "cancelled" | undefined,
  ): Promise<void>;
}

/** What {@link runItemSummary} runs over: the host's pieces, injected. */
export interface ItemSummaryDeps {
  /** The graph's summarize pipeline, or `undefined` when there is none. */
  readonly pipeline: Pick<SummarizePipeline, "prepare" | "execute"> | undefined;
  /**
   * The collections the item belongs to (`collectionsOfItem` in the
   * product). Read once, before the first job context; a throw stops the run
   * before anything is sent.
   */
  collectionsOf(libraryID: number, itemKey: string): readonly CollectionRef[];
  /**
   * A job context over no collection, under the strictest privacy mode of
   * `itemCollections`' overrides and the global setting (owner, `plan/00` §6
   * item 305(a); was the global mode alone, item 278(c)): with no record for
   * `prepare`, in the record's for `execute`.
   */
  openJob(
    record: JobRecord | undefined,
    token: CancellationToken,
    itemCollections: readonly CollectionRef[],
  ): Promise<ItemSummaryJob>;
  /** Enqueue the record, with the confirmed disclosure's egress log. */
  enqueue(
    input: SummarizeInput,
    disclosure: EgressDisclosure | undefined,
  ): Promise<JobRecord>;
  /** The run's confirmation, as the summarize window's ({@link confirmSummarizeRun}). */
  readonly confirm: SummarizeConfirmDeps;
  /** A spend ceiling's question: the cost dialog's ceiling mode. */
  askCeiling(
    question: Extract<SummarizeQuestion, { readonly reason: "budget-stop" }>,
  ): Promise<"resume" | "cancel">;
}

/** One item, as the item pane asks for it. */
export interface ItemSummaryRequest {
  readonly libraryID: number;
  readonly itemKey: string;
  /** Regenerate (and Retry): FR-19's "Re-summarize existing". */
  readonly regenerate: boolean;
  /**
   * Regenerate only (owner, `plan/00` §6 item 305(c)): the item's stored row
   * and cache entry are not served; a real call, after the cost confirmation,
   * replaces both. Retry leaves it unset and keeps the cache rule. Ignored
   * unless {@link ItemSummaryRequest.regenerate} is set.
   */
  readonly bypassCache?: boolean | undefined;
}

type RowStatus = SummarizeRunView["rows"][number]["status"];

/** The reason a skipped row gives the banner. */
function reasonForRow(status: RowStatus | undefined): NotSummarizedReason {
  switch (status) {
    case "skipped-no-text":
      return "no-text";
    case "skipped-retracted":
      return "retracted";
    case "skipped-language":
      return "language";
    case "skipped-existing":
      return "existing";
    default:
      return "other";
  }
}

/**
 * The item pane's Generate, Retry and Regenerate (`docs/08` §3.2's and
 * `docs/07` §12.3's notes of 2026-10-29): `P3-T29`'s summarize pipeline over
 * this one item, under the strictest privacy mode of the item's collections
 * and the global setting (item 305(a)), its two halves exactly as the
 * summarize window's session
 * runs them — `prepare` (the estimate, and the cost and egress confirmation)
 * in a context with no record; then, only on "run", the record enqueued with
 * its egress log and `execute` (the key check, the `llm` pool, the spending
 * ceilings, cancel) in the record's context. The run writes no note.
 *
 * Where its questions go: the confirmation is {@link confirmSummarizeRun}
 * with no collection (no "don't ask again" record or box; money still asks,
 * item 274(b); asked every time, item 305(b)); a ceiling asks the cost dialog's question; the key and
 * wall-clock questions, which a collection run asks as lines in its window,
 * have no window here and are answered "stop", as `HEADLESS_SUMMARIZE_SURFACE`
 * answers them, so nothing more is sent.
 *
 * @param deps - see {@link ItemSummaryDeps}
 * @param request - the item, and whether to re-summarize
 * @param token - the section's Cancel
 * @returns resolves once the item's summary is stored, or when the user
 *   declined the cost dialog; rejects with the failed call's own error, with
 *   a {@link SummaryNotStoredError} naming why nothing was stored, or with
 *   the error that stopped the run
 */
export async function runItemSummary(
  deps: ItemSummaryDeps,
  request: ItemSummaryRequest,
  token: CancellationToken,
): Promise<void> {
  const pipeline = deps.pipeline;
  if (pipeline === undefined) throw new SummaryNotStoredError("other");
  // The strictest privacy mode of the item's collections and the global
  // setting (item 305(a)): read once, for both halves.
  const collections = deps.collectionsOf(request.libraryID, request.itemKey);
  const input: SummarizeInput = {
    libraryID: request.libraryID,
    itemKeys: [request.itemKey],
    resummarize: request.regenerate,
    // Regenerate's bypass (item 305(c)); `bypassesStoredResult` reads it.
    ...(request.regenerate &&
      request.bypassCache === true && { bypassCache: true }),
    // The section's explicit "Save as child note" is the only way a summary
    // becomes a note (`docs/08` §3.2).
    writeNotes: false,
  };
  let failure: { readonly error: unknown } | undefined;
  let stoppedFor: NotSummarizedReason | undefined;
  const surface: SummarizeSurface = {
    update: () => undefined,
    confirm: async (confirmRequest) =>
      (await confirmSummarizeRun(deps.confirm, confirmRequest)).answer,
    ask: (question) => {
      if (question.reason === "budget-stop") return deps.askCeiling(question);
      stoppedFor =
        question.reason === "credential-required"
          ? "no-key"
          : question.reason === "wall-clock-budget"
            ? "time-limit"
            : "other";
      return Promise.resolve("cancel");
    },
    itemFailed: (_itemKey, error) => {
      failure = { error };
    },
  };
  const statusOf = (
    rows: Iterable<{ readonly itemKey: string; readonly status: RowStatus }>,
  ): RowStatus | undefined =>
    [...rows].find((row) => row.itemKey === request.itemKey)?.status;

  const before = await deps.openJob(undefined, token, collections);
  let prepared: PreparedSummarizeRun;
  try {
    prepared = await pipeline.prepare(input, before.context, surface);
  } finally {
    await before.finish(undefined);
  }
  // The cost dialog's Cancel: the user chose to send nothing.
  if (prepared.status === "declined") return;
  if (
    prepared.state.planned.length === 0 &&
    prepared.state.fromStore.length === 0
  ) {
    throw new SummaryNotStoredError(
      reasonForRow(statusOf(prepared.state.rows.values())),
    );
  }

  const record = await deps.enqueue(input, prepared.disclosure);
  const job = await deps.openJob(record, token, collections);
  let output: SummarizeOutput | undefined;
  try {
    output = await pipeline.execute(prepared, job.context, surface);
  } finally {
    await job.finish(
      output === undefined || output.outcome === "failed"
        ? "failed"
        : output.outcome === "succeeded"
          ? "succeeded"
          : "cancelled",
    );
  }
  if (failure !== undefined) throw failure.error;
  if (output.outcome === "declined") return;
  if (output.outcome === "succeeded") {
    const status = statusOf(output.view.rows);
    if (status === "done" || status === "cached") return;
    throw new SummaryNotStoredError(reasonForRow(status));
  }
  if (output.outcome === "failed") {
    // `SerializedError.detail` is already redacted.
    throw new Error(output.error?.detail ?? output.error?.code ?? "failed");
  }
  // Cancelled or stopped: by the section's Cancel (which ignores this), or by
  // a question this surface answered "stop".
  throw new SummaryNotStoredError(stoppedFor ?? "other");
}
