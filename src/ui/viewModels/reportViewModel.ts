/**
 * The report window's run (`P4-T20`; FR-25, FR-53; `docs/08` §6.1–§6.4 and
 * their notes of 2026-11-01): the state a run builds up, the model the window
 * draws from it, the run's confirmation, the language it runs in, and the
 * lines of the questions it asks.
 *
 * ## Who calls what (`plan/README.md` §5 rule 10)
 *
 * - **Caller:** the report window's session (`ReportWindowSession` in
 *   `src/ui/panes/reportWindow.ts`, which takes its ids from
 *   {@link REPORT_RUN_L10N}), built by `createReportWindowSession` in
 *   `src/bootstrap/registerUI.ts` (the constructing file, the window's host),
 *   folds every pipeline event through {@link reduceReportRun} and hands
 *   {@link buildReportRunModel}'s result to the window
 *   (`addon/content/reportWindow.js`) through `ReportWindowSink.render`, after
 *   formatting the main-window lines ({@link MainWindowLine}) as text.
 * - The run is `src/pipeline/trendReport/trendReportPipeline.ts`'s, driven by
 *   the host through the job queue — **never by the window**, and nothing
 *   here calls an adapter (`docs/07` §2.3; `research-helper/layering/ui`).
 *
 * ## What is decided here
 *
 * - **The preview** (owner, `plan/00` §6 item 286; `docs/08` §6.2's note of
 *   2026-11-01): each streamed delta is appended as raw text, labelled
 *   "draft"; a second generation (`DraftDelta.generation`) or a critique
 *   rewrite (`rewrite-started`) starts the text again, and a rewrite that
 *   could not be applied puts the kept draft back (`rewrite-not-applied`,
 *   item 314(c)). When the critique stage ends the text is the final text and
 *   is labelled so; when the report is saved it is replaced, once, by the
 *   stored report's Markdown. A stop, a cancel or a failure discards it.
 *   Markdown is never parsed here.
 * - **Six stage rows** over `docs/07` §12.4's twelve stages.
 * - **The delivery buttons** (`plan/07` `P4-T20` step 4): Export and Copy once
 *   a report is stored; Save as note when `report.saveNote` is on, the
 *   library is editable and the run's own note write did not happen (the
 *   group question answered "no", or the write failed).
 */

import type {
  MainWindowMessageId,
  ReportWindowMessageId,
} from "../../i18n/keys";
import {
  L10N_AUDIO_TIER_REFUSED,
  L10N_JOB_WALL_CLOCK_BUDGET,
  MAIN_WINDOW_MESSAGE_IDS,
} from "../../i18n/keys";
import type { AudioLanguage } from "../../model/audio";
import type { ReportLanguage as RunLanguage } from "../../model/trend";
import type {
  AudioRefusalReason,
  AudioReportOutcome,
  AudioReportRunView,
} from "../../pipeline/audioReport/audioReportPipeline";
import type { AudioSaveOutcome } from "../../pipeline/audioReport/failures";
import type { EgressDisclosure } from "../../pipeline/shared/egressDisclosure";
import type { SummarizeQuestion } from "../../pipeline/summarize/summarizePipeline";
import type { DraftDelta } from "../../pipeline/trendReport/compose";
import type { RevisionSignal } from "../../pipeline/trendReport/critique";
import type { ReportExportOutcome } from "../../pipeline/trendReport/exportMarkdown";
import {
  TREND_REPORT_STAGE_KEYS,
  type TrendReportConfirmAnswer,
  type TrendReportConfirmRequest,
  type TrendReportLanguage,
  type TrendReportOutcome,
  type TrendReportRunView,
  type TrendReportStageKey,
  type TrendReportStop,
} from "../../pipeline/trendReport/trendReportPipeline";
import { formatUsd } from "../../i18n/format";
import {
  shouldOpenCostDialog,
  skippedNoticeLine,
  type CostDialogInput,
  type CostDialogOutcome,
} from "../dialogs/costConfirmDialog";

// ===========================================================================
// 1. Lines
// ===========================================================================

/** A line of the report window's own bundle; the window places it. */
export interface ReportLine {
  readonly id: ReportWindowMessageId;
  readonly args?: Readonly<Record<string, string | number>>;
}

/**
 * A line of the main-window bundle (a stop's reason, the wall-clock pause,
 * the skipped-dialog cost line). The window links only its own bundle
 * (`docs/08` §10.1), so the host formats these and the window places text.
 */
export interface MainWindowLine {
  readonly bundle: "main";
  readonly id: MainWindowMessageId;
  readonly args?: Readonly<Record<string, string | number>>;
}

/** A line already formatted by the host. */
export interface TextLine {
  readonly text: string;
}

/** Any line of the model. */
export type ReportModelLine = ReportLine | MainWindowLine;

/** Any line the window receives: a main-window line arrives as text. */
export type ReportWindowLineOut = ReportLine | TextLine;

/** Every id of the run, in `research-helper-reportWindow.ftl`. */
export const REPORT_RUN_L10N = {
  generate: "research-helper-report-generate",
  cancel: "research-helper-report-cancel",
  saveNote: "research-helper-report-save-note",
  export: "research-helper-report-export",
  copy: "research-helper-report-copy",
  continue: "research-helper-report-continue",
  stop: "research-helper-report-stop",
  groupSave: "research-helper-report-group-save",
  groupSkip: "research-helper-report-group-skip",
  stage: "research-helper-report-stage",
  rowReading: "research-helper-report-row-reading",
  rowSummaries: "research-helper-report-row-summaries",
  rowThemes: "research-helper-report-row-themes",
  rowWriting: "research-helper-report-row-writing",
  rowReview: "research-helper-report-row-review",
  rowFinishing: "research-helper-report-row-finishing",
  spend: "research-helper-report-spend",
  previewLabel: "research-helper-report-preview-label",
  outcome: "research-helper-report-outcome",
  note: "research-helper-report-note",
  groupQuestion: "research-helper-report-group-question",
  exportOutcome: "research-helper-report-export-outcome",
  copied: "research-helper-report-copied",
  keyNeeded: "research-helper-report-key-needed",
  pausedJob: "research-helper-report-paused-job",
} as const satisfies Record<string, ReportWindowMessageId>;

// ===========================================================================
// 2. The language a run is written in
// ===========================================================================

/** `reportLanguage`'s values (`docs/07` §8.5): the window's selector. */
export type ReportLanguageChoice = "auto" | "en" | "ko" | "both";

/**
 * The report language of Zotero's interface: Korean under a `ko` locale,
 * English otherwise (`docs/07` §8.5). Called by {@link resolveReportLanguage},
 * and by `createReportWindowSession` for the report a two-report run shows first
 * (`docs/08` §6.3's note of 2026-11-02).
 *
 * @param uiLocale - Zotero's interface locale, a BCP 47 tag
 */
export function interfaceReportLanguage(uiLocale: string): RunLanguage {
  return /^ko(?:-|$)/iu.test(uiLocale) ? "ko" : "en";
}

/**
 * What a run is asked to write (`TrendReportInput.language`; `docs/07` §12.4
 * readings 12 and 18): `auto` follows Zotero's interface language, and `both`
 * passes through, for one run that writes two reports (`P4-T21`).
 *
 * @param choice - the selector's value
 * @param uiLocale - Zotero's interface locale, a BCP 47 tag
 */
export function resolveReportLanguage(
  choice: ReportLanguageChoice,
  uiLocale: string,
): TrendReportLanguage {
  return choice === "auto" ? interfaceReportLanguage(uiLocale) : choice;
}

// ===========================================================================
// 3. The run's confirmation (P4-T16's dialog; plan/00 §6 items 274(b), 292(f))
// ===========================================================================

/** What {@link confirmReportRun} needs from the host. */
export interface ReportConfirmDeps {
  /** `P3-T16`'s dialog (`confirmRunCost` in `src/bootstrap/registerUI.ts`). */
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

/** {@link confirmReportRun}'s answer, and the window's cost line. */
export interface ReportConfirmResult {
  readonly answer: TrendReportConfirmAnswer;
  /** The number, when the dialog was skipped (FR-24). */
  readonly notice: MainWindowLine | undefined;
}

/**
 * Ask, or skip asking, before a report run spends. `request.confirmation` is
 * already the report run's **own** "don't ask again" decision (`prepare`
 * read `reportRoutineConfirmation`); money still forces the dialog
 * (`shouldOpenCostDialog`). A dialog that cannot open runs nothing. The
 * pipeline stores the record when the answer carries `dontAskAgain`.
 *
 * @param deps - see {@link ReportConfirmDeps}
 * @param request - from the pipeline's `prepare`
 */
export async function confirmReportRun(
  deps: ReportConfirmDeps,
  request: TrendReportConfirmRequest,
): Promise<ReportConfirmResult> {
  const decision = shouldOpenCostDialog({
    confirmation: request.confirmation,
    plan: request.estimate.selected,
    confirmAboveCents: deps.confirmAboveCents(),
    ceiling: request.ceilingSelected,
  });
  if (!decision.open) {
    const notice =
      request.estimate.selected.calls === 0
        ? undefined
        : skippedNoticeLine(request.estimate.selected, deps.locale());
    return {
      answer: {
        kind: "run",
        plan: "selected",
        raise: undefined,
        dontAskAgain: false,
      },
      notice:
        notice === undefined
          ? undefined
          : {
              bundle: "main",
              id: notice.id,
              ...(notice.args !== undefined && { args: notice.args }),
            },
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
    });
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
      plan: outcome.plan,
      raise: outcome.raise,
      dontAskAgain: outcome.dontAskAgain,
    },
    notice: undefined,
  };
}

// ===========================================================================
// 4. The run's state
// ===========================================================================

/** What became of the report's note (`docs/06` §14.2; `P4-T14`). */
export type ReportNoteState =
  "written" | "export-only" | "no-collection" | "declined" | "off" | "failed";

/** How a run ended, as the window says it. */
export type ReportRunOutcome = TrendReportOutcome | "unavailable";

/** The preview (`docs/08` §6.2's note of 2026-11-01). */
export interface ReportPreview {
  readonly state: "none" | "draft" | "final" | "discarded";
  readonly text: string;
  /** The generation the text belongs to; 0 after a rewrite started. */
  readonly generation: number;
  /** The report the text belongs to, on a two-report run's draft (`P4-T21`). */
  readonly language?: RunLanguage;
}

/**
 * One report of a two-report run, as the window can show it (`docs/08` §6.3's
 * note of 2026-11-02). Built by `createReportWindowSession`; read by
 * {@link reduceReportRun}.
 */
export interface ReportDelivered {
  readonly language: RunLanguage;
  /** What the preview shows and the export writes. */
  readonly text: string;
  readonly note: ReportNoteState | undefined;
}

/** Everything the window shows, accumulated from the run's events. */
export interface ReportRunState {
  readonly running: boolean;
  readonly view: TrendReportRunView | undefined;
  /** The last real stage the run was in (a pause shows it as current). */
  readonly lastStage: TrendReportStageKey | undefined;
  /** The critique's revision round, from `rewrite-started`; 0 before one. */
  readonly critiqueRound: number;
  readonly preview: ReportPreview;
  /** This run's spend so far (the job's budget guard). */
  readonly spendUsd: number | undefined;
  /** The skipped-dialog cost line. */
  readonly notice: MainWindowLine | undefined;
  readonly outcome: ReportRunOutcome | undefined;
  readonly stop: TrendReportStop | undefined;
  /** Whether a stored report exists to export, copy or save. */
  readonly reportStored: boolean;
  readonly note: ReportNoteState | undefined;
  readonly exported: Exclude<ReportExportOutcome, "no-path"> | undefined;
  readonly copied: boolean;
  /** A job of this collection left paused (`plan/00` §6 item 324(a)). */
  readonly pausedJob: { readonly reason: string } | undefined;
  /** A two-report run's reports, in run order; empty on any other run. */
  readonly reports: readonly ReportDelivered[];
  /** Which of {@link reports} the preview and the buttons act on. */
  readonly shown: RunLanguage | undefined;
}

/** The state before any run. */
export const IDLE_REPORT_RUN: ReportRunState = Object.freeze({
  running: false,
  view: undefined,
  lastStage: undefined,
  critiqueRound: 0,
  preview: Object.freeze({ state: "none", text: "", generation: 0 }),
  spendUsd: undefined,
  notice: undefined,
  outcome: undefined,
  stop: undefined,
  reportStored: false,
  note: undefined,
  exported: undefined,
  copied: false,
  pausedJob: undefined,
  reports: Object.freeze([]),
  shown: undefined,
}) as ReportRunState;

/**
 * The stop line of a run that failed because Zotero is offline (`plan/10`
 * `P7-T33`; `plan/00` §6 item 393, owner, 2026-11-17): `rh-error-offline`, the
 * message the keyword search shows, under the window's own "could not be
 * generated" outcome line. Any other ending keeps the stop the run gave.
 *
 * Caller: `finishRun` and `runJob`'s catch in `publishReportWindowCommands`
 * (`src/bootstrap/registerUI.ts`).
 *
 * @param outcome - how the run ended
 * @param stop - the run's own stop line, if any
 * @param code - the failing error's `code` (`SerializedError.code`, or a thrown
 *   `ResearchHelperError`'s), if any
 */
export function stopForFailure(
  outcome: ReportRunOutcome,
  stop: TrendReportStop | undefined,
  code: string | undefined,
): TrendReportStop | undefined {
  if (stop !== undefined) return stop;
  return outcome === "failed" && code === "OFFLINE"
    ? { messageId: "rh-error-offline" }
    : undefined;
}

/** One thing that happened to the run. */
export type ReportRunEvent =
  | { readonly kind: "started" }
  | { readonly kind: "view"; readonly view: TrendReportRunView }
  | { readonly kind: "draft"; readonly delta: DraftDelta }
  | { readonly kind: "revision"; readonly signal: RevisionSignal }
  | { readonly kind: "spend"; readonly usd: number }
  | { readonly kind: "notice"; readonly line: MainWindowLine | undefined }
  | {
      readonly kind: "finished";
      readonly outcome: ReportRunOutcome;
      readonly stop?: TrendReportStop | undefined;
      /** The stored report's Markdown, on `succeeded`. */
      readonly markdown?: string | undefined;
      readonly note?: ReportNoteState | undefined;
      /** A two-report run's reports; `markdown` and `note` are the shown one's. */
      readonly reports?: readonly ReportDelivered[] | undefined;
      readonly shown?: RunLanguage | undefined;
    }
  | {
      readonly kind: "note";
      readonly note: ReportNoteState;
      /** Which report of a two-report run; `undefined` on any other run. */
      readonly language?: RunLanguage | undefined;
    }
  | { readonly kind: "show-report"; readonly language: RunLanguage }
  | {
      readonly kind: "exported";
      readonly outcome: Exclude<ReportExportOutcome, "no-path">;
    }
  | { readonly kind: "copied" }
  | { readonly kind: "paused-job"; readonly reason: string | undefined };

const STAGE_INDEX = new Map<string, number>(
  TREND_REPORT_STAGE_KEYS.map((key, index) => [key, index]),
);
const CRITIQUING = STAGE_INDEX.get("Critiquing") as number;

/**
 * Fold one event into the state. Pure: the same events give the same state.
 *
 * @param state - the state so far
 * @param event - what happened
 */
export function reduceReportRun(
  state: ReportRunState,
  event: ReportRunEvent,
): ReportRunState {
  switch (event.kind) {
    case "started":
      return { ...IDLE_REPORT_RUN, running: true };
    case "view": {
      const stage = event.view.stage;
      const real =
        stage === "waiting" || stage === "done" ? state.lastStage : stage;
      let preview = state.preview;
      // The critique stage ended: the text is the final text (item 286).
      if (
        preview.state === "draft" &&
        real !== undefined &&
        (STAGE_INDEX.get(real) as number) > CRITIQUING
      ) {
        preview = { ...preview, state: "final" };
      }
      return {
        ...state,
        view: event.view,
        lastStage: real,
        preview,
        // A two-report run's next language starts with no revision round.
        critiqueRound:
          real === "Composing" && state.lastStage === "Critiquing"
            ? 0
            : state.critiqueRound,
      };
    }
    case "draft": {
      const { delta } = event;
      const { preview } = state;
      if (preview.state === "final" || preview.state === "discarded") {
        return state;
      }
      const fresh =
        preview.state !== "draft" ||
        delta.generation !== preview.generation ||
        delta.language !== preview.language;
      return {
        ...state,
        preview: {
          state: "draft",
          text: fresh ? delta.deltaText : preview.text + delta.deltaText,
          generation: delta.generation,
          ...(delta.language !== undefined && { language: delta.language }),
        },
      };
    }
    case "revision":
      if (event.signal.kind === "rewrite-started") {
        return {
          ...state,
          critiqueRound: event.signal.round,
          preview: { state: "draft", text: "", generation: 0 },
        };
      }
      // The rewrite could not be applied: the kept draft again (item 314(c)).
      return {
        ...state,
        critiqueRound: event.signal.round,
        preview: {
          state: "draft",
          text: event.signal.markdown,
          generation: -1,
        },
      };
    case "spend":
      return { ...state, spendUsd: event.usd };
    case "notice":
      return { ...state, notice: event.line };
    case "finished": {
      const succeeded = event.outcome === "succeeded";
      return {
        ...state,
        running: false,
        outcome: event.outcome,
        stop: event.stop,
        reportStored: succeeded,
        note: event.note,
        pausedJob: undefined,
        reports: event.reports ?? [],
        shown: event.shown,
        preview: succeeded
          ? {
              state: "final",
              text: event.markdown ?? state.preview.text,
              generation: state.preview.generation,
            }
          : event.outcome === "declined" || event.outcome === "unavailable"
            ? state.preview
            : { state: "discarded", text: "", generation: 0 },
      };
    }
    case "note":
      if (event.language === undefined) return { ...state, note: event.note };
      return {
        ...state,
        note: event.language === state.shown ? event.note : state.note,
        reports: state.reports.map((one) =>
          one.language === event.language ? { ...one, note: event.note } : one,
        ),
      };
    case "show-report": {
      const one = state.reports.find((r) => r.language === event.language);
      if (one === undefined) return state;
      return {
        ...state,
        shown: one.language,
        note: one.note,
        exported: undefined,
        copied: false,
        preview: { ...state.preview, text: one.text },
      };
    }
    case "exported":
      return { ...state, exported: event.outcome, copied: false };
    case "copied":
      return { ...state, copied: true, exported: undefined };
    case "paused-job":
      return {
        ...state,
        pausedJob:
          event.reason === undefined ? undefined : { reason: event.reason },
      };
  }
}

// ===========================================================================
// 5. The model the window draws
// ===========================================================================

/** One stage row: its line and where the run is relative to it. */
export interface ReportStageRow {
  readonly key: ReportRowKey;
  readonly line: ReportLine;
  readonly status: "pending" | "active" | "done";
}

/** The six rows, in run order. */
export type ReportRowKey =
  "reading" | "summaries" | "themes" | "writing" | "review" | "finishing";

/** Which of `docs/07` §12.4's stages each row covers. */
export const REPORT_ROW_STAGES: Readonly<
  Record<ReportRowKey, readonly TrendReportStageKey[]>
> = Object.freeze({
  reading: ["Screening", "Estimating", "AwaitingConfirm"],
  summaries: ["EnsuringSummaries"],
  themes: ["Digesting", "Clustering", "Analysing"],
  writing: ["Composing"],
  review: ["Critiquing"],
  finishing: ["Scaffolding", "Rendering", "Saving"],
});

const ROW_KEYS = Object.keys(REPORT_ROW_STAGES) as ReportRowKey[];

/** The stage line's token per stage (`research-helper-report-stage`). */
const STAGE_TOKEN: Readonly<Record<TrendReportStageKey, string>> = {
  Screening: "reading",
  Estimating: "reading",
  AwaitingConfirm: "confirming",
  EnsuringSummaries: "summaries",
  Digesting: "themes",
  Clustering: "themes",
  Analysing: "themes",
  Composing: "writing",
  Critiquing: "reviewing",
  Scaffolding: "finishing",
  Rendering: "finishing",
  Saving: "finishing",
};

/** What the host knows besides the run's events. */
export interface ReportModelExtras {
  /** A run can be started: the collection exists and a report model is set. */
  readonly canStart: boolean;
  /** `report.saveNote`. */
  readonly saveNoteSetting: boolean;
  /** The collection's library can be written to. */
  readonly libraryEditable: boolean;
  /** For the spend line. */
  readonly locale: string;
}

/** The buttons the window enables. */
export interface ReportButtons {
  readonly generate: boolean;
  readonly cancel: boolean;
  readonly saveNote: boolean;
  readonly export: boolean;
  readonly copy: boolean;
}

/** What the window draws. Lines of the main bundle are formatted by the host. */
export interface ReportRunModel {
  readonly running: boolean;
  readonly stage: ReportModelLine | undefined;
  readonly rows: readonly ReportStageRow[];
  readonly spend: ReportModelLine | undefined;
  readonly notice: ReportModelLine | undefined;
  readonly preview: {
    readonly label: ReportModelLine | undefined;
    readonly text: string;
    /** No more deltas follow: the window may announce it (`aria-live`). */
    readonly final: boolean;
  };
  readonly outcome: ReportModelLine | undefined;
  /** A stop's reason, from the main bundle. */
  readonly stop: ReportModelLine | undefined;
  readonly note: ReportModelLine | undefined;
  /** The last export or copy's result. */
  readonly delivery: ReportModelLine | undefined;
  readonly buttons: ReportButtons;
  /** The "Report shown" selector, only when a run gave two reports. */
  readonly reportChoice: ReportChoice | undefined;
}

/** What the "Report shown" selector draws (`docs/08` §6.3's note of 2026-11-02). */
export interface ReportChoice {
  readonly languages: readonly RunLanguage[];
  readonly shown: RunLanguage;
}

function rowLine(key: ReportRowKey, state: ReportRunState): ReportLine {
  const view = state.view;
  switch (key) {
    case "reading":
      return { id: REPORT_RUN_L10N.rowReading };
    case "summaries":
      return {
        id: REPORT_RUN_L10N.rowSummaries,
        args: {
          made: view?.summaries.made ?? 0,
          cached: view?.summaries.cached ?? 0,
          toMake: view?.summaries.toMake ?? 0,
          failed: view?.summaries.failed ?? 0,
        },
      };
    case "themes":
      return {
        id: REPORT_RUN_L10N.rowThemes,
        args: {
          done: view?.themes.done ?? 0,
          total: view?.themes.total ?? 0,
        },
      };
    case "writing":
      return { id: REPORT_RUN_L10N.rowWriting };
    case "review":
      return {
        id: REPORT_RUN_L10N.rowReview,
        args: { round: state.critiqueRound },
      };
    case "finishing":
      return { id: REPORT_RUN_L10N.rowFinishing };
  }
}

/** Each row's status from the furthest stage reached and the outcome. */
function rowStatus(
  key: ReportRowKey,
  state: ReportRunState,
): ReportStageRow["status"] {
  if (state.outcome === "succeeded") return "done";
  const reached =
    state.lastStage === undefined
      ? -1
      : (STAGE_INDEX.get(state.lastStage) as number);
  const indices = REPORT_ROW_STAGES[key].map(
    (stage) => STAGE_INDEX.get(stage) as number,
  );
  const first = Math.min(...indices);
  const last = Math.max(...indices);
  if (reached > last) return "done";
  if (reached >= first) return state.running ? "active" : "pending";
  return "pending";
}

function noteLine(note: ReportNoteState | undefined): ReportLine | undefined {
  return note === undefined
    ? undefined
    : { id: REPORT_RUN_L10N.note, args: { state: note } };
}

/**
 * Build what the window draws from the run's state.
 *
 * @param state - from {@link reduceReportRun}
 * @param extras - what the host knows besides the run
 */
export function buildReportRunModel(
  state: ReportRunState,
  extras: ReportModelExtras,
): ReportRunModel {
  const view = state.view;
  const stageToken =
    state.pausedJob !== undefined
      ? "waiting"
      : view === undefined
        ? undefined
        : view.stage === "waiting" || view.stage === "done"
          ? view.stage
          : STAGE_TOKEN[view.stage];
  const stored = state.reportStored && !state.running;
  const noteWritable =
    stored &&
    extras.saveNoteSetting &&
    extras.libraryEditable &&
    (state.note === "declined" || state.note === "failed");
  const preview = state.preview;
  return {
    running: state.running,
    stage:
      stageToken === undefined
        ? undefined
        : { id: REPORT_RUN_L10N.stage, args: { stage: stageToken } },
    rows: ROW_KEYS.map((key) => ({
      key,
      line: rowLine(key, state),
      status: rowStatus(key, state),
    })),
    spend:
      state.spendUsd === undefined
        ? undefined
        : {
            id: REPORT_RUN_L10N.spend,
            args: { cost: formatUsd(state.spendUsd, extras.locale) },
          },
    notice: state.notice,
    preview: {
      label:
        preview.state === "none"
          ? undefined
          : {
              id: REPORT_RUN_L10N.previewLabel,
              args: { state: preview.state },
            },
      text: preview.text,
      final: preview.state === "final" || preview.state === "discarded",
    },
    // A stop says why in `stop`; a paused job asks in the question box.
    outcome:
      state.outcome === undefined || state.outcome === "stopped"
        ? undefined
        : { id: REPORT_RUN_L10N.outcome, args: { outcome: state.outcome } },
    stop:
      state.stop === undefined
        ? undefined
        : {
            bundle: "main",
            id: state.stop.messageId,
            ...(state.stop.args !== undefined && { args: state.stop.args }),
          },
    note: noteLine(state.note),
    delivery: state.copied
      ? { id: REPORT_RUN_L10N.copied }
      : state.exported === undefined
        ? undefined
        : {
            id: REPORT_RUN_L10N.exportOutcome,
            args: { outcome: state.exported },
          },
    buttons: {
      generate:
        extras.canStart && !state.running && state.pausedJob === undefined,
      cancel: state.running,
      saveNote: noteWritable,
      export: stored,
      copy: stored,
    },
    reportChoice:
      stored && state.reports.length > 1 && state.shown !== undefined
        ? {
            languages: state.reports.map((one) => one.language),
            shown: state.shown,
          }
        : undefined,
  };
}

/** The run's model as the window receives it: main-bundle lines are text. */
export interface ReportWindowRunModel {
  readonly running: boolean;
  readonly stage: ReportWindowLineOut | undefined;
  readonly rows: readonly ReportStageRow[];
  readonly spend: ReportWindowLineOut | undefined;
  readonly notice: ReportWindowLineOut | undefined;
  readonly preview: {
    readonly label: ReportWindowLineOut | undefined;
    readonly text: string;
    readonly final: boolean;
  };
  readonly outcome: ReportWindowLineOut | undefined;
  readonly stop: ReportWindowLineOut | undefined;
  readonly note: ReportWindowLineOut | undefined;
  readonly delivery: ReportWindowLineOut | undefined;
  readonly buttons: ReportButtons;
  readonly reportChoice: ReportChoice | undefined;
  /**
   * The audio section (`P6-T17`), from {@link windowAudioModel}; absent, the
   * window hides it.
   */
  readonly audio?: AudioSectionModel<ReportWindowLineOut>;
}

/**
 * One line as the window receives it: a main-bundle line becomes its text,
 * or `undefined` until the host has formatted it.
 *
 * @param line - from the model
 * @param formatted - the host's text for a main-bundle line
 */
export function windowLine(
  line: ReportModelLine | undefined,
  formatted: (line: MainWindowLine) => string | undefined,
): ReportWindowLineOut | undefined {
  if (line === undefined) return undefined;
  if (!isMainWindowLine(line)) return line;
  const text = formatted(line);
  return text === undefined ? undefined : { text };
}

/**
 * The model as the window receives it (`docs/08` §10.1: the window links only
 * its own bundle).
 *
 * @param model - from {@link buildReportRunModel}
 * @param formatted - the host's text for a main-bundle line
 */
export function windowRunModel(
  model: ReportRunModel,
  formatted: (line: MainWindowLine) => string | undefined,
): ReportWindowRunModel {
  const line = (
    one: ReportModelLine | undefined,
  ): ReportWindowLineOut | undefined => windowLine(one, formatted);
  return {
    running: model.running,
    stage: line(model.stage),
    rows: model.rows,
    spend: line(model.spend),
    notice: line(model.notice),
    preview: {
      label: line(model.preview.label),
      text: model.preview.text,
      final: model.preview.final,
    },
    outcome: line(model.outcome),
    stop: line(model.stop),
    note: line(model.note),
    delivery: line(model.delivery),
    buttons: model.buttons,
    reportChoice: model.reportChoice,
  };
}

// ===========================================================================
// 6. The questions
// ===========================================================================

/** A question the window asks in place: its line and its two buttons. */
export interface ReportQuestion<Line = ReportModelLine> {
  readonly line: Line;
  /** The button that answers "resume" (yes). */
  readonly yes: ReportWindowMessageId;
  /** The button that answers "cancel" (no). */
  readonly no: ReportWindowMessageId;
}

/**
 * A paused run's question the window asks itself (the money question is the
 * cost dialog's, in its ceiling mode).
 *
 * @param question - the pipeline's question; not `budget-stop`
 * @param providerName - the provider's display name (not translated)
 */
export function reportPauseQuestion(
  question: Exclude<SummarizeQuestion, { readonly reason: "budget-stop" }>,
  providerName: string,
): ReportQuestion {
  const buttons = {
    yes: REPORT_RUN_L10N.continue,
    no: REPORT_RUN_L10N.stop,
  } as const;
  if (question.reason === "credential-required") {
    return {
      line: { id: REPORT_RUN_L10N.keyNeeded, args: { provider: providerName } },
      ...buttons,
    };
  }
  if (question.reason === "wall-clock-budget") {
    return {
      line: {
        bundle: "main",
        id: L10N_JOB_WALL_CLOCK_BUDGET,
        args: {
          minutes: question.minutes,
          done: question.done,
          total: question.total,
        },
      },
      ...buttons,
    };
  }
  return {
    line: { id: REPORT_RUN_L10N.stage, args: { stage: "waiting" } },
    ...buttons,
  };
}

/**
 * The named-group question before a report note is written into a group
 * library (`P4-T14` step 3; `plan/07` `P4-T20` step 4).
 *
 * @param groupName - the group's name as `writeReportNote` reported it
 */
export function groupSaveQuestion(groupName: string): ReportQuestion {
  return {
    line: { id: REPORT_RUN_L10N.groupQuestion, args: { group: groupName } },
    yes: REPORT_RUN_L10N.groupSave,
    no: REPORT_RUN_L10N.groupSkip,
  };
}

/**
 * The question of a job of this collection left `paused` — by a spend guard
 * at restart, or by a shutdown while it waited (owner, `plan/00` §6 item
 * 324(a)).
 *
 * @param reason - the record's `pauseReason`
 */
export function pausedJobQuestion(reason: string | undefined): ReportQuestion {
  return {
    line: {
      id: REPORT_RUN_L10N.pausedJob,
      args: { reason: reason ?? "other" },
    },
    yes: REPORT_RUN_L10N.continue,
    no: REPORT_RUN_L10N.stop,
  };
}

/** Whether a line is the main bundle's, which the host formats. */
export function isMainWindowLine(
  line: ReportModelLine | TextLine | undefined,
): line is MainWindowLine {
  return line !== undefined && "bundle" in line && line.bundle === "main";
}

// ===========================================================================
// 7. The report's note (P4-T14; plan/07 P4-T20 step 4)
// ===========================================================================

/** `writeReportNote`'s outcome, as far as the window's flow reads it. */
export type ReportNoteAnswer =
  | { readonly kind: "written"; readonly noteKey: string }
  | { readonly kind: "export-only" }
  | {
      readonly kind: "group-confirmation-required";
      readonly libraryID: number;
      readonly groupName: string;
    }
  | { readonly kind: "no-collection" };

/** The answer naming a group, as `writeReportNote` reads it. */
export interface ReportGroupAnswer {
  readonly confirmed: true;
  readonly libraryID: number;
  readonly groupName: string;
}

/** What {@link settleReportNote} needs from the host. */
export interface ReportNoteDeps {
  /** Ask the named-group question; "resume" is yes. */
  ask(question: ReportQuestion): Promise<"resume" | "cancel">;
  /** `writeReportNote` with the report and its HTML, and the group's answer. */
  write(answer: ReportGroupAnswer | undefined): Promise<ReportNoteAnswer>;
  /** `ReportStore.put` with the note's key. */
  store(noteKey: string): Promise<void>;
}

/**
 * One group question for a run's notes: the first asks, and every later note of
 * that run takes the same answer (`docs/07` §12.4 reading 22). Caller:
 * `createReportWindowSession`'s `finishRun`.
 *
 * @param ask - {@link ReportNoteDeps.ask}
 */
export function askOnce(ask: ReportNoteDeps["ask"]): ReportNoteDeps["ask"] {
  let asked: Promise<"resume" | "cancel"> | undefined;
  return (question) => (asked ??= ask(question));
}

/**
 * Follow a note write to its end (`P4-T14` step 3; `plan/07` `P4-T20` step 4):
 * a group library is asked by name first, and "no" writes nothing; "yes"
 * writes with the answer and stores the key. A failure says so; the report
 * itself is already stored.
 *
 * @param first - the run's own write's outcome, or `undefined` to write now
 * @param deps - see {@link ReportNoteDeps}
 * @returns what the window says about the note
 */
export async function settleReportNote(
  first: ReportNoteAnswer | undefined,
  deps: ReportNoteDeps,
): Promise<ReportNoteState> {
  try {
    let outcome = first ?? (await deps.write(undefined));
    if (outcome.kind === "group-confirmation-required") {
      const answer = await deps.ask(groupSaveQuestion(outcome.groupName));
      if (answer !== "resume") return "declined";
      outcome = await deps.write({
        confirmed: true,
        libraryID: outcome.libraryID,
        groupName: outcome.groupName,
      });
      // The group was renamed under the question: nothing was written.
      if (outcome.kind === "group-confirmation-required") return "failed";
    }
    if (outcome.kind === "written") {
      // The run stored the key for its own write (`first`).
      if (first?.kind !== "written") await deps.store(outcome.noteKey);
      return "written";
    }
    return outcome.kind;
  } catch {
    return "failed";
  }
}

// ===========================================================================
// 8. The audio section (P6-T17; docs/08 §6.4's note of 2026-11-17)
// ===========================================================================

/**
 * Every id of the audio section, in `research-helper-reportWindow.ftl`. The
 * language items are {@link REPORT_RUN_L10N}'s neighbours `-language-en` and
 * `-language-ko` (`REPORT_WINDOW_L10N`).
 */
export const AUDIO_SECTION_L10N = {
  heading: "research-helper-report-audio-heading",
  languageLabel: "research-helper-report-audio-language-label",
  voiceLabel: "research-helper-report-audio-voice-label",
  none: "research-helper-report-audio-none",
  source: "research-helper-report-audio-source",
  generate: "research-helper-report-audio-generate",
  cancel: "research-helper-report-audio-cancel",
  stage: "research-helper-report-audio-stage",
  outcome: "research-helper-report-audio-outcome",
  refused: "research-helper-report-audio-refused",
  saveScript: "research-helper-report-audio-save-script",
  saveAudio: "research-helper-report-audio-save-audio",
  saved: "research-helper-report-audio-saved",
} as const satisfies Record<string, ReportWindowMessageId>;

/** The stored report the section works on (point 2 of the note). */
export interface AudioSectionReport {
  readonly id: string;
  readonly language: AudioLanguage;
  /** The language of the same run's other record, when one is stored. */
  readonly companionLanguage: AudioLanguage | undefined;
}

/** One voice of `TTSProvider.listVoices`: its id and its display name. */
export interface AudioVoiceOption {
  readonly id: string;
  /** Not translated (`docs/08` §10.3); placed as text. */
  readonly label: string;
}

/** What a failed or cancelled run said, as `classifyAudioFailure` gave it. */
export interface AudioSectionFailure {
  readonly messageKey: string;
  readonly messageArgs: Readonly<Record<string, string>>;
}

/** What the section has seen. */
export interface AudioSectionState {
  /** `audio.enabled`: off, the section is not drawn at all. */
  readonly enabled: boolean;
  /** The report lookup has answered. */
  readonly loaded: boolean;
  readonly report: AudioSectionReport | undefined;
  /** The audio language chosen for the next run; never written back. */
  readonly language: AudioLanguage | undefined;
  /** The voice chosen; the host writes it back to `tts.voice`. */
  readonly voice: string | undefined;
  readonly voices: readonly AudioVoiceOption[];
  readonly running: boolean;
  readonly view: AudioReportRunView | undefined;
  readonly outcome: AudioReportOutcome | undefined;
  readonly refusal: AudioRefusalReason | undefined;
  readonly failure: AudioSectionFailure | undefined;
  /** FR-43's and FR-40's offers, as the run's output made them. */
  readonly offers: { readonly script: boolean; readonly audio: boolean };
  /** The last save's result; a cancelled save dialog changes nothing. */
  readonly saved:
    | {
        readonly kind: "script" | "audio";
        readonly outcome: "saved" | "failed";
      }
    | undefined;
}

/** Before anything is known. */
export const IDLE_AUDIO_SECTION: AudioSectionState = Object.freeze({
  enabled: false,
  loaded: false,
  report: undefined,
  language: undefined,
  voice: undefined,
  voices: Object.freeze([]) as readonly AudioVoiceOption[],
  running: false,
  view: undefined,
  outcome: undefined,
  refusal: undefined,
  failure: undefined,
  offers: Object.freeze({ script: false, audio: false }),
  saved: undefined,
});

/** What changes the section. */
export type AudioSectionEvent =
  | { readonly kind: "audio-enabled"; readonly enabled: boolean }
  /** The report the section works on, and the language it starts on. */
  | {
      readonly kind: "audio-report";
      readonly report: AudioSectionReport | undefined;
      readonly language: AudioLanguage;
    }
  | {
      readonly kind: "audio-voices";
      readonly voices: readonly AudioVoiceOption[];
      readonly voice: string | undefined;
    }
  | { readonly kind: "audio-language"; readonly language: AudioLanguage }
  | { readonly kind: "audio-voice"; readonly voice: string }
  | { readonly kind: "audio-started" }
  | { readonly kind: "audio-view"; readonly view: AudioReportRunView }
  | {
      readonly kind: "audio-finished";
      readonly outcome: AudioReportOutcome;
      readonly refusal?: AudioRefusalReason | undefined;
      readonly failure?: AudioSectionFailure | undefined;
      readonly offers: { readonly script: boolean; readonly audio: boolean };
    }
  | {
      readonly kind: "audio-saved";
      readonly saveKind: "script" | "audio";
      readonly outcome: AudioSaveOutcome;
    };

const NO_OFFERS = IDLE_AUDIO_SECTION.offers;

/** The fields one run's end sets, cleared for the next. */
const CLEARED_RESULT = {
  outcome: undefined,
  refusal: undefined,
  failure: undefined,
  offers: NO_OFFERS,
  saved: undefined,
} as const;

/**
 * The voice the selector starts on: the stored `tts.voice` when it is listed,
 * otherwise the first voice (`docs/08` §6.4's note, point 3).
 *
 * @param voices - `listVoices`'s answer
 * @param stored - `tts.voice`
 */
export function initialAudioVoice(
  voices: readonly AudioVoiceOption[],
  stored: string,
): string | undefined {
  return voices.some((one) => one.id === stored) ? stored : voices[0]?.id;
}

/**
 * Fold one event into the section's state. A choice or a new report while a
 * run is going is ignored: the run keeps the ones it started with.
 */
export function reduceAudioSection(
  state: AudioSectionState,
  event: AudioSectionEvent,
): AudioSectionState {
  switch (event.kind) {
    case "audio-enabled":
      return { ...state, enabled: event.enabled };
    case "audio-report":
      if (state.running) return state;
      return {
        ...state,
        ...CLEARED_RESULT,
        loaded: true,
        report: event.report,
        language: event.report === undefined ? undefined : event.language,
      };
    case "audio-voices":
      return { ...state, voices: event.voices, voice: event.voice };
    case "audio-language":
      if (state.running || state.report === undefined) return state;
      return { ...state, language: event.language };
    case "audio-voice":
      if (state.running || !state.voices.some((v) => v.id === event.voice)) {
        return state;
      }
      return { ...state, voice: event.voice };
    case "audio-started":
      return { ...state, ...CLEARED_RESULT, running: true, view: undefined };
    case "audio-view":
      return state.running ? { ...state, view: event.view } : state;
    case "audio-finished":
      return {
        ...state,
        running: false,
        view: undefined,
        outcome: event.outcome,
        refusal: event.refusal,
        failure: event.failure,
        offers: event.offers,
        saved: undefined,
      };
    case "audio-saved":
      if (event.outcome === "no-path") return state;
      return {
        ...state,
        saved: { kind: event.saveKind, outcome: event.outcome },
      };
  }
}

/**
 * The language the script is written from (`chooseScriptSource`, `P6-T08`):
 * the report's own, or the same run's other record when it is in the chosen
 * language.
 */
export function audioScriptSourceLanguage(
  report: AudioSectionReport,
  language: AudioLanguage,
): AudioLanguage {
  // The report's own language needs no test of its own: it is the fallback.
  return report.companionLanguage === language ? language : report.language;
}

/** The section's buttons and selectors. */
export interface AudioSectionButtons {
  readonly generate: boolean;
  readonly cancel: boolean;
  /** The two selectors. */
  readonly choose: boolean;
  /** Shown only when offered; a new run clears the offers, so never during one. */
  readonly saveScript: boolean;
  readonly saveAudio: boolean;
}

/** What the window draws for the section. */
export interface AudioSectionModel<Line = ReportModelLine> {
  /** `audio.enabled`: hidden entirely otherwise. */
  readonly visible: boolean;
  readonly heading: ReportLine;
  /** "No report is stored…", once the lookup found none. */
  readonly none: ReportLine | undefined;
  readonly language: AudioLanguage | undefined;
  readonly voices: readonly AudioVoiceOption[];
  readonly voice: string | undefined;
  /** "Korean script written from the English report", when that applies. */
  readonly source: ReportLine | undefined;
  /** The one progress line, while a run is going. */
  readonly stage: ReportLine | undefined;
  readonly outcome: ReportLine | undefined;
  /** Why: a refusal, or a failure's own message (main bundle). */
  readonly reason: Line | undefined;
  readonly saved: ReportLine | undefined;
  readonly buttons: AudioSectionButtons;
  /** Which save buttons exist at all (FR-43, FR-40). */
  readonly offers: { readonly script: boolean; readonly audio: boolean };
}

/** Every refusal the section's own bundle words. */
const WORDED_REFUSALS: ReadonlySet<string> = new Set([
  "no-report",
  "no-key",
  "read-only",
  "no-collection",
  "linked-needs-personal-library",
  "no-folder",
  "disabled",
]);

const STAGE_OF_VIEW: Readonly<Record<AudioReportRunView["stage"], string>> = {
  checking: "checking",
  Scripting: "scripting",
  AwaitingConfirm: "confirming",
  Synthesizing: "synthesizing",
  Attaching: "attaching",
  waiting: "waiting",
  done: "done",
};

function audioStageLine(state: AudioSectionState): ReportLine | undefined {
  if (!state.running) return undefined;
  const view = state.view;
  const stage = view === undefined ? "checking" : STAGE_OF_VIEW[view.stage];
  const chunk = stage === "synthesizing" ? view?.chunk : undefined;
  return {
    id: AUDIO_SECTION_L10N.stage,
    args: { stage, done: chunk?.done ?? 0, total: chunk?.total ?? 0 },
  };
}

function audioReasonLine(
  state: AudioSectionState,
): ReportModelLine | undefined {
  // No test of `running`: `audio-started` clears the refusal and the failure.
  const { refusal, failure } = state;
  if (refusal === "tier-refused") {
    return { bundle: "main", id: L10N_AUDIO_TIER_REFUSED };
  }
  if (refusal !== undefined) {
    return {
      id: AUDIO_SECTION_L10N.refused,
      args: { reason: WORDED_REFUSALS.has(refusal) ? refusal : "other" },
    };
  }
  if (state.outcome !== "failed" || failure === undefined) return undefined;
  const known = (MAIN_WINDOW_MESSAGE_IDS as readonly string[]).includes(
    failure.messageKey,
  );
  return known
    ? {
        bundle: "main",
        id: failure.messageKey as MainWindowMessageId,
        args: failure.messageArgs,
      }
    : { bundle: "main", id: "rh-error-tts", args: { reason: "other" } };
}

/**
 * Build what the window draws for the audio section.
 *
 * @param state - from {@link reduceAudioSection}
 * @param extras - `reportRunning`: the report's own run is going, so audio
 *   cannot start (`docs/08` §6.4's note, point 5)
 */
export function buildAudioSectionModel(
  state: AudioSectionState,
  extras: { readonly reportRunning: boolean },
): AudioSectionModel {
  const { report, language, running } = state;
  const source =
    report === undefined || language === undefined
      ? undefined
      : audioScriptSourceLanguage(report, language);
  const between = !running && report !== undefined;
  return {
    visible: state.enabled,
    heading: { id: AUDIO_SECTION_L10N.heading },
    none:
      state.loaded && report === undefined
        ? { id: AUDIO_SECTION_L10N.none }
        : undefined,
    language,
    voices: state.voices,
    voice: state.voice,
    source:
      source === undefined || source === language
        ? undefined
        : {
            id: AUDIO_SECTION_L10N.source,
            args: { script: language ?? "en", report: source },
          },
    stage: audioStageLine(state),
    // `audio-started` clears the outcome and the offers, so neither shows
    // while a run is going.
    outcome:
      state.outcome === undefined
        ? undefined
        : { id: AUDIO_SECTION_L10N.outcome, args: { outcome: state.outcome } },
    reason: audioReasonLine(state),
    saved:
      state.saved === undefined
        ? undefined
        : {
            id: AUDIO_SECTION_L10N.saved,
            args: { kind: state.saved.kind, outcome: state.saved.outcome },
          },
    buttons: {
      generate:
        state.enabled &&
        between &&
        !extras.reportRunning &&
        language !== undefined &&
        state.voice !== undefined,
      cancel: running,
      choose: state.enabled && between,
      saveScript: state.offers.script,
      saveAudio: state.offers.audio,
    },
    offers: state.offers,
  };
}

/**
 * The section as the window receives it: the main-bundle reason as text, or
 * `undefined` until the host has formatted it.
 *
 * @param model - from {@link buildAudioSectionModel}
 * @param formatted - the host's text for a main-bundle line
 */
export function windowAudioModel(
  model: AudioSectionModel,
  formatted: (line: MainWindowLine) => string | undefined,
): AudioSectionModel<ReportWindowLineOut> {
  return { ...model, reason: windowLine(model.reason, formatted) };
}
