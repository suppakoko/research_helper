/**
 * "Generate Research Trends Report…" — `docs/07` §12.4's state machine, run
 * (`P4-T18`; FR-23, FR-25, FR-27, FR-36, FR-53): one cancellable, resumable
 * job takes a collection to a saved report through every stage, counting its
 * reduction passes, and saves nothing when it is cancelled or stopped.
 *
 * ## Callers and construction (`plan/README.md` §5 rule 10)
 *
 * - **Constructed** by `buildPipelineSet` in `src/bootstrap/registerPipelines.ts`
 *   ({@link createTrendReportPipeline}), from the same `WorkerPools` the other
 *   pipelines take; its Zotero ports (the collection read and acquisition, the
 *   bibliography port, the report-note writer) and its stores (the summary
 *   and report stores, `collection_settings` for the report run's own "don't
 *   ask again") arrive from `installServices` (`src/bootstrap/container.ts`).
 * - **Driven** by the report window's host (`P4-T20`, `registerUI.ts`), as the
 *   summarize window's host drives `summarizePipeline.ts`:
 *   {@link TrendReportPipeline.prepare} in a job context with no record, then
 *   — only when it returns `run` — the record is enqueued with its egress log
 *   (`withEgressLog`, `egressLogEntry(prepared.disclosure, …)`) and
 *   {@link TrendReportPipeline.execute} runs in that record's context, with a
 *   {@link TrendReportSurface} the window implements.
 * - **Driven** after a restart by `createResumedJobRunner` (`container.ts`):
 *   a job `recover()` re-queued once every spend guard passed and the resume
 *   notice was shown is run through `Pipeline.run`, which reads
 *   `ctx.resumeState` and asks no second confirmation, on a
 *   {@link DeferredTrendReportSurface} a window can attach to (owner, `plan/00`
 *   §6 item 324(a)).
 *   {@link TrendReportPipeline.remaining} is the spend guards' estimate of
 *   what such a job still has to do.
 *
 * ## The stages (`plan/07` `P4-T18` step 1; `docs/07` §12.4)
 *
 * Screening → Estimating → AwaitingConfirm ({@link TrendReportPipeline.prepare});
 * then EnsuringSummaries (the summarize pipeline's per-item `summarizeItem`,
 * `P3-T29`, under the `llm` pool — no child job), Digesting (`toDigest`),
 * Clustering (`clusterThemes`), Analysing (`analyseThemes`), Composing
 * (`composeReport`), Critiquing (`critiqueReport`), Scaffolding
 * (`scaffoldReport`), Rendering (`renderReportNote`) and Saving (the report
 * store, then `writeReportNote`, then the store again with the note key) —
 * {@link TrendReportPipeline.execute}. Each synthesis stage probes its cache
 * entry (`tc`, `cr`, `rp`, `P4-T17`) before it runs and stores it after, and
 * the run checkpoints after each stage.
 *
 * **Nothing is saved but at the end.** A cancel, a "stop" at a pause, every
 * stop outcome of a stage and every failure end the job before the Saving
 * stage: no note, no `report` row, no Markdown file. The summaries made and
 * the cached stage results are kept (`docs/07` §7.4, §12.4; owner, `plan/00`
 * §6 items 307(c), 309(e)(g), 311(a)). The readings this needed are `docs/07`
 * §12.4's note of 2026-11-01, each DECIDED under `plan/00` §6 item 313.
 *
 * **Layering.** `pipeline/` may import `core/`, `model/`, `llm/`, `prompts/`
 * and `zotero/` types and pure helpers; it names no `Zotero` global (every
 * Zotero read and write arrives as a port) and imports no `ui/`.
 */

import type { Cache } from "../../core/cache/cache";
import {
  reportKey,
  sha256Hex,
  synthesisTags,
  themeAnalysisKey,
  themeClusteringKey,
  type SynthesisKey,
} from "../../core/cache/keys";
import {
  AuthenticationError,
  ConfigurationError,
  OperationCancelledError,
  type SerializedError,
} from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import { redactRecord } from "../../core/provenance";
import type { JobRecord, PauseReason } from "../../core/jobQueue/jobRecord";
import {
  WALL_CLOCK_BUDGET_DEFAULT_MS,
  runPooledItems,
  type JobAdmission,
  type JobQueue,
  type JobTicket,
  type LlmPool,
  type PooledRun,
  type RunningWork,
} from "../../core/jobQueue/queue";
import type { MainWindowMessageId } from "../../i18n/keys";
import type { BaseUrlResolver } from "../../llm/shared/baseUrl";
import { costOf, type ModelPrices } from "../../llm/shared/pricing";
import { estTokens } from "../../llm/shared/tokenEstimate";
import type { ModelInfo, ResolvedModel } from "../../llm/types";
import type { ProviderId } from "../../model/ids";
import type { StoredSummary } from "../../model/summary";
import type {
  Digest,
  ExcludedItem,
  ReportLanguage,
  TrendPromptId,
  TrendPromptUse,
  TrendReport,
} from "../../model/trend";
import type { Usage } from "../../model/usage";
import {
  promptCacheLine,
  renderPrompt,
  type PromptId,
  type PromptRegistry,
  type PromptTemplate,
} from "../../prompts";
import type { BibliographyPort } from "../../zotero/bibliography";
import type { ReportStore, SummaryStore } from "../../zotero/db";
import {
  datedReportTitle,
  type GroupWriteConfirmation,
  type ReportNoteOutcome,
  type ReportNoteRequest,
} from "../../zotero/notes";
import {
  ZERO_SPEND,
  ceilingStopOf,
  suggestedLimitUsd,
  type CeilingKind,
  type CeilingStop,
  type RemainingEstimate,
  type SpendTotals,
} from "../shared/budget";
import {
  buildEgressDisclosure,
  mustAskConfirmation,
  routineConfirmationFor,
  type ConfirmationDecision,
  type EgressDisclosure,
} from "../shared/egressDisclosure";
import {
  estimateReportRun,
  synthesisBudgets,
  toPipelineEstimate,
  type EstimateItem,
  type ModelWindowLimits,
  type ReportRunEstimate,
  type SynthesisCall,
  type SynthesisCallKind,
} from "../shared/estimate";
import {
  modelRouteFor,
  planInputScopeKind,
  routingHints,
  type CollectionRef,
  type FullTextMode,
  type InputScopeKind,
  type RoutineConfirmation,
} from "../shared/privacyPolicy";
import { detectLanguage } from "../summarize/languageDetect";
import {
  screenItems,
  screeningPolicyFrom,
  type RetractionPolicy,
  type ScreenDecision,
  type ScreenItem,
} from "../summarize/screen";
import {
  summarizeItem,
  summarizeItemDepsFrom,
  type SummarizeItemResult,
} from "../summarize/summarizeItem";
import {
  isRunBudgetGuard,
  measureOverhead,
  serializeFailure,
  type AcquiredItem,
  type JobPauseNotices,
  type SummarizeLibrary,
  type SummarizeLibraryItem,
  type SummarizeQuestion,
} from "../summarize/summarizePipeline";
import type {
  Pipeline,
  PipelineContext,
  PipelineEstimate,
  StageDescriptor,
  ValidationResult,
} from "../types";

import {
  clusterThemes,
  MERGE_TOO_LARGE_L10N,
  NO_THEMES_L10N,
  THEME_CLUSTER_EFFORT,
  themeBandFor,
  TOO_MANY_THEMES_L10N,
  type ClusteredOutcome,
} from "./cluster";
import {
  composeReport,
  prepareComposition,
  REPORT_EFFORT,
  STRUCTURE_INVALID_L10N,
  type AnalysedPaper,
  type ComposedReport,
  type ComposeInput,
  type CompositionPlan,
  type DraftDelta,
  type SearchRunSummary,
} from "./compose";
import {
  CRITIQUE_EFFORT,
  critiqueReport,
  critiqueRoundsOf,
  resolveCritiqueModel,
  type RevisionSignal,
} from "./critique";
import { digestText, toDigest } from "./digest";
import { renderReportNote } from "./noteHtml";
import { reportLabel, fillLabel } from "./reportLabels";
import { bibliographyKeys, inertText, scaffoldReport } from "./scaffold";
import {
  analyseThemes,
  NO_THEME_ANALYSED_L10N,
  summariesForReduce,
  THEME_ANALYSIS_EFFORT,
  type AnalysedTheme,
  type ThemeResult,
} from "./themeAnalysis";

// ===========================================================================
// 1. Constants
// ===========================================================================

/** `Pipeline.displayNameKey`: the menu entry's own id (`P4-T19`). */
export const TREND_REPORT_DISPLAY_NAME_KEY =
  "research-helper-menu-collection-report";

/** The stage keys, in run order (`docs/07` §12.4). */
export const TREND_REPORT_STAGE_KEYS = [
  "Screening",
  "Estimating",
  "AwaitingConfirm",
  "EnsuringSummaries",
  "Digesting",
  "Clustering",
  "Analysing",
  "Composing",
  "Critiquing",
  "Scaffolding",
  "Rendering",
  "Saving",
] as const;

export type TrendReportStageKey = (typeof TREND_REPORT_STAGE_KEYS)[number];

const STAGE_WEIGHTS: Readonly<Record<TrendReportStageKey, number>> = {
  Screening: 0.05,
  Estimating: 0.02,
  AwaitingConfirm: 0,
  EnsuringSummaries: 0.4,
  Digesting: 0.01,
  Clustering: 0.1,
  Analysing: 0.15,
  Composing: 0.12,
  Critiquing: 0.08,
  Scaffolding: 0.02,
  Rendering: 0.02,
  Saving: 0.03,
};

/**
 * `docs/07` §12.4's stages. The label key is the menu entry's: the window's
 * stage rows are its own (`REPORT_ROW_STAGES`, `P4-T20`). The weights divide
 * the progress bar.
 */
export const TREND_REPORT_STAGES: readonly StageDescriptor[] = Object.freeze(
  TREND_REPORT_STAGE_KEYS.map((key) => ({
    key,
    labelKey: TREND_REPORT_DISPLAY_NAME_KEY,
    weight: STAGE_WEIGHTS[key],
  })),
);

/** The schema version of {@link TrendReportInput} as stored in a job record. */
export const TREND_REPORT_INPUT_VERSION = 1;

/** The schema version of {@link TrendReportCheckpoint}. */
export const TREND_REPORT_CHECKPOINT_VERSION = 1;

/**
 * `docs/06` §8.5's failure policy: "the run aborts only if the failure rate
 * exceeds 30 %". Judged over every paper the report would analyse, so 11 of
 * 30 stops and 9 of 30 does not (`plan/07` `P4-T18`'s Done-when).
 */
export const FAILED_PAPERS_SHARE = 0.3;

/**
 * The stop when more than {@link FAILED_PAPERS_SHARE} of the papers' summaries
 * failed: `$failed` and `$total`. New 2026-11-01; on `KO_PENDING_REVIEW`.
 */
export const PAPERS_FAILED_L10N =
  "research-helper-report-stopped-papers-failed" as const satisfies MainWindowMessageId;

/** The stop when no paper of the collection can be analysed. No argument. */
export const NO_PAPERS_L10N =
  "research-helper-report-stopped-no-papers" as const satisfies MainWindowMessageId;

/**
 * The citation style when the user has none (`userCitationStyle` returns
 * `undefined`): APA, one of the fifteen styles every Zotero 10 bundles
 * (`docs/01` §5.11). DECIDED 2026-11-01 (coordinator, under item 313).
 */
export const REPORT_FALLBACK_STYLE_ID = "http://www.zotero.org/styles/apa";

/** Every report's CSL locale (owner, `plan/00` §6 item 294(a)). */
export const REPORT_CSL_LOCALE = "en-US";

/**
 * The report model's output limit when its `ModelInfo` gives none: small, so
 * the clustering takes the two-stage path the estimate also prices rather than
 * a single call that a real limit could truncate. DECIDED 2026-11-01
 * (coordinator, under item 313).
 */
export const REPORT_OUTPUT_LIMIT_UNKNOWN = 8_192;

/** The cache namespace synthesis entries live in (`docs/07` §9.2's `report`). */
export const SYNTHESIS_CACHE_NAMESPACE = "report" as const;

/** `Pipeline.estimate`'s rough dispatch rate: one synthesis call every 20 s. */
const CALLS_PER_MINUTE_PER_PERMIT = 3;

/** Appendix A's codes for the run's own exclusions (`EXCLUSION_PHRASES`). */
const NO_TEXT_REASON = "no_abstract_no_pdf";
const SUMMARY_FAILED_REASON = "llm_failed_after_retries";

// ===========================================================================
// 2. Input, output, view
// ===========================================================================

/** What a report job is asked to do. Plain data: it is stored in the record. */
export interface TrendReportInput {
  readonly libraryID: number;
  readonly collectionKey: string;
  /**
   * One report language. `report.language`'s `both` and `auto` are the
   * window's to resolve (`P4-T20`, `P4-T21`); this run writes one report.
   */
  readonly language: ReportLanguage;
  /**
   * `P4-T24`'s determinism runs: skip the `tc`, `cr` and `rp` probes (the
   * results are still stored). Never set by the UI; the `ps` summary cache is
   * kept.
   */
  readonly skipSynthesisCache?: boolean | undefined;
  /**
   * The answer to the group-library question, when the window asked it before
   * the run (`P4-T14`); otherwise a group library's note waits for it.
   */
  readonly groupConfirmation?: GroupWriteConfirmation | undefined;
}

/**
 * How a run ended. `interrupted`: the plugin shut down under it (its token
 * was cancelled with `{ kind: "shutdown" }`); the record was left as it was,
 * for `recover()` at the next start (`P4-T20` step 0c).
 */
export type TrendReportOutcome =
  "succeeded" | "stopped" | "cancelled" | "declined" | "failed" | "interrupted";

/** A stop's message (`docs/12` §8–§10's stops and this module's two). */
export interface TrendReportStop {
  readonly messageId: MainWindowMessageId;
  readonly args?: Readonly<Record<string, number>>;
}

/** Where the run is, for the window (`P4-T20` draws it). */
export interface TrendReportRunView {
  readonly stage: TrendReportStageKey | "waiting" | "done";
  readonly collectionName: string;
  /** Regular items in the collection. */
  readonly total: number;
  /** Papers the report analyses (after screening; summaries present or to make). */
  readonly papers: number;
  readonly summaries: {
    readonly toMake: number;
    readonly made: number;
    readonly cached: number;
    readonly failed: number;
  };
  readonly themes: { readonly done: number; readonly total: number };
  /** FR-27's counter so far. */
  readonly passes: number;
}

/** What a run returns. */
export interface TrendReportOutput {
  readonly outcome: TrendReportOutcome;
  readonly view: TrendReportRunView;
  /** The stored report, on `succeeded`. */
  readonly report?: TrendReport;
  /** The note write's outcome, on `succeeded` with `report.saveNote` on. */
  readonly note?: ReportNoteOutcome;
  /**
   * The rendered note HTML, on `succeeded`: what the report window hands
   * `writeReportNote` again after the named-group question, or on "Save as
   * note" when `report.saveNote` was off (`P4-T20` step 4). Kept in memory
   * only, never stored.
   */
  readonly noteHtml?: string;
  /** The stop's message, on `stopped`. */
  readonly stop?: TrendReportStop;
  /** FR-27's reduction passes. */
  readonly passes: number;
  /** The error that failed the run, as stored. */
  readonly error?: SerializedError;
}

// ===========================================================================
// 3. Ports and the surface
// ===========================================================================

/** The pre-run confirmation the surface is asked for (`P4-T16`'s dialog). */
export interface TrendReportConfirmRequest {
  readonly estimate: ReportRunEstimate;
  readonly disclosure: EgressDisclosure;
  /**
   * `mustAskConfirmation` against the report run's **own** "don't ask again"
   * record, never the summarize run's (owner, `plan/00` §6 item 292(f)). The
   * surface still asks whatever this says when money forces it
   * (`shouldOpenCostDialog`; item 274(b)).
   */
  readonly confirmation: ConfirmationDecision;
  readonly ceilingSelected: CeilingStop | undefined;
  readonly ceilingDowngrade: CeilingStop | undefined;
  readonly collection: CollectionRef;
  readonly session: SpendTotals;
}

/** The surface's answer. */
export type TrendReportConfirmAnswer =
  | {
      readonly kind: "run";
      readonly plan: "selected" | "abstract-only";
      readonly raise:
        | { readonly ceiling: CeilingKind; readonly limitUsd: number }
        | undefined;
      /** The report dialog's own "don't ask again" box was ticked. */
      readonly dontAskAgain: boolean;
    }
  | { readonly kind: "cancelled" };

/** The report window, as the run sees it (`P4-T20` implements it). */
export interface TrendReportSurface {
  /** The run's state changed. Must not throw. */
  update(view: TrendReportRunView): void;
  /** `P4-T16`'s confirmation. A rejection runs nothing. */
  confirm(
    request: TrendReportConfirmRequest,
  ): Promise<TrendReportConfirmAnswer>;
  /** A paused job asks: continue, or stop. A rejection stops. */
  ask(question: SummarizeQuestion): Promise<"resume" | "cancel">;
  /** Each streamed delta of a report generation (`composeReport`'s `onDraft`). */
  onDraft?(delta: DraftDelta): void;
  /** A critique rewrite started, or could not be applied (item 314(c)). */
  onRevision?(signal: RevisionSignal): void;
}

/**
 * A surface for a run nobody watches and nobody can watch: it confirms
 * nothing and stops at a pause. `Pipeline.estimate` uses it; a job resumed
 * after a restart gets a {@link DeferredTrendReportSurface} instead (owner,
 * `plan/00` §6 item 324(a)).
 */
export const HEADLESS_TREND_REPORT_SURFACE: TrendReportSurface = Object.freeze({
  update: () => undefined,
  confirm: () => Promise.resolve({ kind: "cancelled" } as const),
  ask: () => Promise.resolve("cancel" as const),
});

/** A window watching a {@link DeferredTrendReportSurface}'s run. */
export interface TrendReportListener {
  update(view: TrendReportRunView): void;
  /** The pending question; a rejection counts as no answer yet. */
  ask(question: SummarizeQuestion): Promise<"resume" | "cancel">;
  onDraft?(delta: DraftDelta): void;
  onRevision?(signal: RevisionSignal): void;
  /** The run ended. */
  finished?(output: TrendReportOutput): void;
}

/**
 * The surface of a job resumed after a restart (owner, `plan/00` §6 item
 * 324(a); `P4-T20` step 0c). Until a report window attaches, a pause is
 * **not** answered: the job stays `paused` with its checkpoint and every
 * paid-for result, and the question waits; the window asks it when it opens
 * ({@link attach}). A question a window was asked and had not answered when
 * it detached waits again. A cancel of the run's token answers "stop" (a
 * shutdown leaves the record for `recover()`; see `execute`). It confirms
 * nothing: a resumed run is not asked again (`prepare`'s `resume`).
 *
 * Constructed by `installServices`' resumed-job runner (`container.ts`),
 * which hands it to the pipeline through `TrendReportPipelineDeps.surfaces`;
 * attached by the report window's session (`registerUI.ts`).
 */
export interface DeferredTrendReportSurface extends TrendReportSurface {
  /** Attach a window; returns its detach. Replaces any earlier window. */
  attach(listener: TrendReportListener): () => void;
  /** The run's last view, or `undefined` before the first. */
  readonly view: TrendReportRunView | undefined;
  /** The question waiting for an answer, if any. */
  readonly pending: SummarizeQuestion | undefined;
  /** Called by the runner when the run ends; tells the window, if any. */
  finish(output: TrendReportOutput): void;
  /** The run's output once it ended. */
  readonly output: TrendReportOutput | undefined;
}

/**
 * Build a {@link DeferredTrendReportSurface} over the run's token.
 *
 * @param token - the run's token: its cancel answers a waiting question "stop"
 */
export function createDeferredTrendReportSurface(
  token: CancellationToken,
): DeferredTrendReportSurface {
  let listener: TrendReportListener | undefined;
  let view: TrendReportRunView | undefined;
  let output: TrendReportOutput | undefined;
  let waiting:
    | {
        readonly question: SummarizeQuestion;
        readonly resolve: (answer: "resume" | "cancel") => void;
      }
    | undefined;

  /** Put the waiting question to the attached window. */
  const forward = (): void => {
    const current = waiting;
    const asked = listener;
    if (current === undefined || asked === undefined) return;
    let answer: Promise<"resume" | "cancel">;
    try {
      answer = asked.ask(current.question);
    } catch {
      return; // no answer yet: the question waits
    }
    answer.then(
      (choice) => {
        // A window that detached first did not answer for the run.
        if (listener !== asked || waiting !== current) return;
        waiting = undefined;
        current.resolve(choice);
      },
      () => undefined,
    );
  };

  token.onCancelled(() => {
    const current = waiting;
    waiting = undefined;
    current?.resolve("cancel");
  });

  const safely = (call: () => void): void => {
    try {
      call();
    } catch {
      // A window that throws loses the view, not the run.
    }
  };

  return {
    update(next) {
      view = next;
      const current = listener;
      if (current !== undefined) safely(() => current.update(next));
    },
    confirm: () => Promise.resolve({ kind: "cancelled" } as const),
    ask(question) {
      if (token.isCancellationRequested) return Promise.resolve("cancel");
      // One question at a time: an unanswered earlier one is stopped.
      waiting?.resolve("cancel");
      return new Promise((resolve) => {
        waiting = { question, resolve };
        forward();
      });
    },
    onDraft(delta) {
      const current = listener;
      if (current?.onDraft !== undefined) {
        safely(() => current.onDraft?.(delta));
      }
    },
    onRevision(signal) {
      const current = listener;
      if (current?.onRevision !== undefined) {
        safely(() => current.onRevision?.(signal));
      }
    },
    attach(next) {
      listener = next;
      if (view !== undefined) {
        const seen = view;
        safely(() => next.update(seen));
      }
      if (output !== undefined) {
        const ended = output;
        safely(() => next.finished?.(ended));
      } else {
        forward();
      }
      return () => {
        if (listener === next) listener = undefined;
      };
    },
    get view() {
      return view;
    },
    get pending() {
      return waiting?.question;
    },
    finish(ended) {
      output = ended;
      const current = listener;
      if (current?.finished !== undefined) {
        safely(() => current.finished?.(ended));
      }
    },
    get output() {
      return output;
    },
  };
}

/** The report run's own "don't ask again" record (`reportRoutineConfirmation`). */
export interface ReportRoutineStore {
  read(collection: CollectionRef): Promise<RoutineConfirmation | undefined>;
  write(collection: CollectionRef, record: RoutineConfirmation): Promise<void>;
}

/** The Zotero side of a report run; built in `registerPipelines.ts`. */
export interface TrendReportLibrary extends Pick<
  SummarizeLibrary,
  "loadCollection" | "acquire"
> {
  /** `zoteroBibliographyPort` (`P4-T11`). */
  readonly bibliography: BibliographyPort;
  /** `writeReportNote` (`P4-T14`). */
  writeReportNote(request: ReportNoteRequest): Promise<ReportNoteOutcome>;
  /** The collection's search records, oldest first; empty when hand-built. */
  searchRuns?(
    libraryID: number,
    collectionKey: string,
  ): Promise<readonly SearchRunSummary[]>;
}

/** What {@link createTrendReportPipeline} is built from. */
export interface TrendReportPipelineDeps {
  readonly library: TrendReportLibrary;
  /** `installPluginDatabase`'s summary store; `undefined` until it is open. */
  readonly summaries: () => Promise<
    Pick<SummaryStore, "put" | "get" | "listForWork"> | undefined
  >;
  /** `installPluginDatabase`'s report store (`P4-T14`). */
  readonly reports: () => Promise<Pick<ReportStore, "put"> | undefined>;
  readonly prompts: () => Promise<
    Pick<PromptRegistry, "get" | "versions" | "cacheEpochs">
  >;
  readonly queue: Pick<
    JobQueue,
    | "start"
    | "pause"
    | "resume"
    | "cancel"
    | "finishCancel"
    | "succeed"
    | "fail"
    | "get"
  >;
  readonly pool: LlmPool;
  readonly admission: JobAdmission;
  readonly runningWork?: RunningWork;
  readonly pauseNotices?: JobPauseNotices;
  readonly prices: (
    providerId: ProviderId,
    modelId: string,
  ) => ModelPrices | undefined;
  readonly baseUrls: Pick<BaseUrlResolver, "effectiveHost">;
  /** `privacy.egressAcknowledged`; the preference by default (a test injects it). */
  readonly egressAcknowledged?: () => boolean;
  readonly modelInfo?: (
    providerId: ProviderId,
    modelId: string,
  ) => ModelInfo | undefined;
  readonly credentials?: { hasKey(providerId: ProviderId): Promise<boolean> };
  /** The report run's own "don't ask again"; absent: always asked. */
  readonly routine?: ReportRoutineStore;
  /** `package.json`'s version, for the title block. */
  readonly pluginVersion: string;
  /** Minutes east of UTC the title block's times are written in. */
  readonly utcOffsetMinutes?: (atEpochMs: number) => number;
  /** A run with a record and no window (`Pipeline.run`): headless by default. */
  readonly surfaces?: (jobId: string) => TrendReportSurface | undefined;
  /** The batch wall-clock budget; `WALL_CLOCK_BUDGET_DEFAULT_MS` by default. */
  readonly wallClockBudgetMs?: number;
  /** Report ids (`REPORT_ID_RE`); a random UUID by default. */
  readonly newReportId?: () => string;
}

// ===========================================================================
// 4. The checkpoint and the remaining-work estimate
// ===========================================================================

/** One stage's priced share of the confirmed estimate. */
export interface StageSpend {
  readonly stage: TrendReportStageKey;
  readonly calls: number;
  /** `null` when a model with a call has no known price. */
  readonly costUsd: number | null;
}

/**
 * What the job record keeps between stages (`docs/07` §7.6): the last
 * completed stage, the user's confirmed choice, and the confirmed estimate per
 * stage, so a resumed job is priced from what is left.
 */
export interface TrendReportCheckpoint {
  readonly version: typeof TREND_REPORT_CHECKPOINT_VERSION;
  readonly stage: TrendReportStageKey;
  readonly choice: {
    readonly fullTextMode: FullTextMode;
    readonly costGateBlocksFullText: boolean;
  };
  readonly spend: readonly StageSpend[];
}

/** Whether `value` is a checkpoint this build wrote. */
export function isTrendReportCheckpoint(
  value: unknown,
): value is TrendReportCheckpoint {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<TrendReportCheckpoint>;
  return (
    c.version === TREND_REPORT_CHECKPOINT_VERSION &&
    typeof c.stage === "string" &&
    (TREND_REPORT_STAGE_KEYS as readonly string[]).includes(c.stage) &&
    typeof c.choice === "object" &&
    c.choice !== null &&
    (c.choice.fullTextMode === "never" ||
      c.choice.fullTextMode === "auto" ||
      c.choice.fullTextMode === "always") &&
    typeof c.choice.costGateBlocksFullText === "boolean" &&
    Array.isArray(c.spend)
  );
}

/**
 * The work a checkpointed job still has to do, priced from the confirmed
 * estimate: every stage after the checkpoint's (`ResumeGuards.confirm` and
 * `.ceilings`, `plan/00` §6 item 250). Fails closed: a record of another
 * pipeline, or one with no checkpoint this build can read, is one call of
 * unknown cost, so the confirm guard asks.
 */
export function remainingFromCheckpoint(
  record: Pick<JobRecord, "pipelineId" | "checkpoint">,
): RemainingEstimate {
  const unknown: RemainingEstimate = { calls: 1, costUsd: undefined };
  if (record.pipelineId !== "trendReport") return unknown;
  const checkpoint = record.checkpoint;
  if (!isTrendReportCheckpoint(checkpoint)) return unknown;
  const done = TREND_REPORT_STAGE_KEYS.indexOf(checkpoint.stage);
  let calls = 0;
  let costUsd: number | undefined = 0;
  for (const share of checkpoint.spend) {
    if (TREND_REPORT_STAGE_KEYS.indexOf(share.stage) <= done) continue;
    if (share.calls === 0) continue;
    calls += share.calls;
    costUsd =
      costUsd === undefined || share.costUsd === null
        ? undefined
        : costUsd + share.costUsd;
  }
  return { calls, costUsd: calls === 0 ? 0 : costUsd };
}

/** The synthesis stage a planned call belongs to. */
function stageOfCall(call: SynthesisCall): TrendReportStageKey {
  switch (call.kind) {
    case "THEME_CLUSTER":
    case "THEME_MERGE":
      return "Clustering";
    case "CLUSTER_REDUCE":
    case "CLUSTER_REDUCE_MERGE":
      return "Analysing";
    case "SELF_CRITIQUE":
      return "Critiquing";
    default:
      // A report call: the first is the composition; a conditional one is a
      // critique round's rewrite.
      return call.conditional ? "Critiquing" : "Composing";
  }
}

/** The selected plan, priced per stage (`spend` of the checkpoint). */
export function stageSpendOf(
  estimate: ReportRunEstimate,
  prices: (modelId: string) => ModelPrices | undefined,
  atEpochMs: number,
): readonly StageSpend[] {
  const plan = estimate.selected;
  const shares = new Map<
    TrendReportStageKey,
    { calls: number; cost: number | null }
  >();
  const add = (
    stage: TrendReportStageKey,
    calls: number,
    cost: number | undefined,
  ): void => {
    const share = shares.get(stage) ?? { calls: 0, cost: 0 };
    share.calls += calls;
    share.cost =
      share.cost === null || cost === undefined ? null : share.cost + cost;
    shares.set(stage, share);
  };
  if (plan.map.calls > 0) {
    add("EnsuringSummaries", plan.map.calls, plan.map.costUsd);
  }
  for (const call of plan.synthesis.calls) {
    const modelPrices = prices(call.modelId);
    add(
      stageOfCall(call),
      1,
      modelPrices === undefined
        ? undefined
        : costOf(
            modelPrices,
            { inputTokens: call.inputTokens, outputTokens: call.outputTokens },
            atEpochMs,
          ).costUsd,
    );
  }
  return TREND_REPORT_STAGE_KEYS.filter((stage) => shares.has(stage)).map(
    (stage) => {
      const share = shares.get(stage) as { calls: number; cost: number | null };
      return { stage, calls: share.calls, costUsd: share.cost };
    },
  );
}

// ===========================================================================
// 5. Pure helpers
// ===========================================================================

/** `docs/07` §7.5's exclusivity key: one report job per collection. */
export function trendReportExclusivityKey(
  input: Pick<TrendReportInput, "libraryID" | "collectionKey">,
): string {
  return `trendReport:${String(input.libraryID)}/${input.collectionKey}`;
}

/** Whether more than {@link FAILED_PAPERS_SHARE} of `total` papers failed. */
export function tooManyPapersFailed(failed: number, total: number): boolean {
  return total > 0 && failed / total > FAILED_PAPERS_SHARE;
}

/** The report prompt of a language. */
function reportPromptId(language: ReportLanguage): PromptId {
  return language === "ko" ? "TREND_REPORT_KO" : "TREND_REPORT_EN";
}

const SYNTHESIS_KINDS: readonly SynthesisCallKind[] = [
  "THEME_CLUSTER",
  "THEME_MERGE",
  "CLUSTER_REDUCE",
  "CLUSTER_REDUCE_MERGE",
  "TREND_REPORT_EN",
  "TREND_REPORT_KO",
  "SELF_CRITIQUE",
];

/**
 * Each synthesis prompt's own tokens, its variables empty (`P4-T16` finding
 * 7; `measureOverhead`'s rule for the map prompts), on `modelId`'s calibration.
 */
export function measureSynthesisOverhead(
  prompts: Pick<PromptRegistry, "get">,
  count: (text: string) => number,
): Readonly<Record<SynthesisCallKind, number>> {
  const out = {} as Record<SynthesisCallKind, number>;
  for (const kind of SYNTHESIS_KINDS) {
    const template: PromptTemplate = prompts.get(kind as PromptId);
    const vars: Record<string, string> = {};
    for (const name of template.variables) {
      vars[name] =
        name === "JSON_SCHEMA" && template.schema !== null
          ? JSON.stringify(template.schema)
          : "";
    }
    const rendered = renderPrompt(template, vars);
    out[kind] = count(rendered.system) + count(rendered.user);
  }
  return out;
}

function sumField(
  usages: readonly (Usage | undefined)[],
  field: keyof Usage,
): number | undefined {
  let total = 0;
  for (const usage of usages) {
    const value = usage?.[field];
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

/** Summed field by field; a field is `undefined` when any part lacks it. */
function sumUsage(usages: readonly (Usage | undefined)[]): Usage {
  return {
    inputTokens: sumField(usages, "inputTokens"),
    outputTokens: sumField(usages, "outputTokens"),
    totalTokens: sumField(usages, "totalTokens"),
    costUsd: sumField(usages, "costUsd"),
  };
}

/** A model whose policy is unknown: what an absent `ModelInfo` is judged as. */
function unknownPolicyModel(modelId: string): ModelInfo {
  return {
    id: modelId,
    displayName: modelId,
    contextWindowTokens: 0,
    maxOutputTokens: 0,
    supportsJsonSchema: false,
    supportsStreaming: false,
    supportsSystemPrompt: true,
    inputCostPerMTokUsd: undefined,
    outputCostPerMTokUsd: undefined,
    dataPolicy: {
      trainsOnInputByDefault: "unknown",
      retention: { days: "unknown", note: "" },
    },
  };
}

/** A random UUID: `crypto` is in the sandbox (`docs/01` §2.3) and in Node. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}

/** A stop raised inside a stage, carried to the run's end. */
class StageStop extends Error {
  constructor(readonly stop: TrendReportStop) {
    super(`report stopped: ${stop.messageId}`);
    this.name = "StageStop";
  }
}

/** `SerializedError.code` of a job a stop outcome ended. */
export const STOPPED_CODE = "REPORT_STOPPED";

/** A stop's id without its common prefix: `no-theme-analysed`, short enough to store. */
export function stopName(messageId: string): string {
  return messageId.replace(/^research-helper-report-stopped-/u, "");
}

/** "Stop" answered at a pause: a cancel (`plan/07` §0.2 item 18). */
function stoppedAtPause(): OperationCancelledError {
  return new OperationCancelledError({ kind: "user" });
}

/**
 * The dated note title and the report's level-1 line (`P4-T14` finding 1):
 * `report.title` is `datedReportTitle` over the title label without its date
 * (to the second, in UTC), and the Markdown's first line carries the same
 * title, so the note shows one heading. DECIDED 2026-11-01 (coordinator,
 * under item 313).
 */
export function withDatedTitle(
  markdown: string,
  language: ReportLanguage,
  collectionName: string,
  generatedAtEpochMs: number,
): { readonly title: string; readonly markdown: string } {
  const heading = fillLabel(reportLabel(language, "reportTitle"), {
    collection: collectionName.replace(/[\s\p{Cc}]+/gu, " ").trim(),
    date: "",
  })
    .replace(/\s*\(\s*\)\s*$/u, "")
    .trim();
  const title = datedReportTitle(heading, generatedAtEpochMs);
  const lines = markdown.split("\n");
  if ((lines[0] ?? "").startsWith("# ")) {
    lines[0] = `# ${inertText(title)}`;
  }
  return { title, markdown: lines.join("\n") };
}

// ===========================================================================
// 6. The pipeline
// ===========================================================================

/** One paper the report analyses. */
interface PlannedPaper {
  readonly item: SummarizeLibraryItem;
  /** Its newest stored summary; `undefined` until made. */
  readonly stored: StoredSummary | undefined;
  /** Acquired only when no summary is stored. */
  readonly acquired: AcquiredItem | undefined;
  readonly scope: InputScopeKind | undefined;
  readonly decision: ScreenDecision | undefined;
}

/** What `prepare` hands to `execute`. */
export interface PreparedTrendReport {
  readonly input: TrendReportInput;
  /** `run`: confirmed (or resumed); `declined`: nothing is sent. */
  readonly status: "run" | "declined";
  readonly providerId: ProviderId;
  readonly fullTextMode: FullTextMode;
  readonly costGateBlocksFullText: boolean;
  readonly raise:
    { readonly ceiling: CeilingKind; readonly limitUsd: number } | undefined;
  /** The confirmed disclosure, for the record's egress log. */
  readonly disclosure: EgressDisclosure | undefined;
  readonly estimate: ReportRunEstimate | undefined;
  /** Exactly what `execute` starts from; not for the caller to change. */
  readonly state: PreparedTrendState;
}

/** The run's working state, carried from `prepare` to `execute`. */
export interface PreparedTrendState {
  readonly collectionName: string;
  readonly total: number;
  readonly papers: readonly PlannedPaper[];
  readonly excluded: readonly ExcludedItem[];
  readonly retractedKeys: readonly string[];
  readonly titles: ReadonlyMap<string, string>;
  readonly retractionReasons: ReadonlyMap<string, string>;
  readonly duplicateOf: ReadonlyMap<string, string>;
  readonly spend: readonly StageSpend[];
  readonly stop: TrendReportStop | undefined;
}

/** The report pipeline: `docs/07` §4.5's contract, plus its two halves. */
export interface TrendReportPipeline extends Pipeline<
  TrendReportInput,
  TrendReportOutput
> {
  /**
   * Screening → AwaitingConfirm, in a context with no record. Sends nothing
   * to a model. `confirm: false` skips the question (`estimate`); a resumed
   * job passes its checkpoint and is not asked again.
   */
  prepare(
    input: TrendReportInput,
    ctx: PipelineContext,
    surface: TrendReportSurface,
    options?: {
      readonly confirm?: boolean;
      readonly resume?: TrendReportCheckpoint;
    },
  ): Promise<PreparedTrendReport>;
  /** EnsuringSummaries → Saving, in the record's context. */
  execute(
    prepared: PreparedTrendReport,
    ctx: PipelineContext,
    surface: TrendReportSurface,
  ): Promise<TrendReportOutput>;
  /** The spend guards' estimate of a checkpointed job's remaining work. */
  remaining(record: JobRecord): Promise<RemainingEstimate>;
}

/**
 * Build the pipeline. `buildPipelineSet` calls this once.
 *
 * @param deps - see {@link TrendReportPipelineDeps}
 */
export function createTrendReportPipeline(
  deps: TrendReportPipelineDeps,
): TrendReportPipeline {
  const requireSummaries = async (): Promise<
    Pick<SummaryStore, "put" | "get" | "listForWork">
  > => {
    const store = await deps.summaries();
    if (store === undefined) {
      throw new ConfigurationError(
        "the plugin database is not available, so no summary can be read; " +
          "nothing was sent",
      );
    }
    return store;
  };

  const modelInfoOf = (model: ResolvedModel): ModelInfo | undefined =>
    deps.modelInfo?.(model.providerId, model.modelId);
  const limitsOf = (model: ResolvedModel): ModelWindowLimits =>
    windowLimitsOf(modelInfoOf(model));

  const prepare: TrendReportPipeline["prepare"] = async (
    input,
    ctx,
    surface,
    options = {},
  ) => {
    const store = await requireSummaries();
    const collectionRef: CollectionRef = {
      libraryID: input.libraryID,
      collectionKey: input.collectionKey,
    };
    let collectionName = "";
    let total = 0;
    let paperCount = 0;
    let toMake = 0;
    const show = (stage: TrendReportStageKey | "done"): void => {
      surface.update({
        stage,
        collectionName,
        total,
        papers: paperCount,
        summaries: { toMake, made: 0, cached: 0, failed: 0 },
        themes: { done: 0, total: 0 },
        passes: 0,
      });
    };

    // Screening.
    show("Screening");
    ctx.token.throwIfCancelled();
    const collection = await deps.library.loadCollection(
      input.libraryID,
      input.collectionKey,
    );
    collectionName = collection.name;
    total = collection.items.length;
    const prompts = await deps.prompts();
    const mapModel = ctx.llm.resolveModel("standard");
    const fullTextPref = ctx.config.get("summaryFullTextMode") as FullTextMode;
    const allowed = ctx.privacy.allowedInputScope(ctx.privacy.mode, {
      fullTextMode: fullTextPref,
    });
    const storedByKey = new Map<string, StoredSummary>();
    const acquiredByKey = new Map<string, AcquiredItem>();
    for (const item of collection.items) {
      ctx.token.throwIfCancelled();
      const newest = (await store.listForWork(item.workKey))[0];
      if (newest !== undefined) {
        storedByKey.set(item.itemKey, newest);
        continue;
      }
      acquiredByKey.set(
        item.itemKey,
        await deps.library.acquire(item, {
          includeFullText: allowed.fullTextMode !== "never",
          token: ctx.token,
        }),
      );
    }
    const report = screenItems(
      collection.items.map((item): ScreenItem => {
        const text = acquiredByKey.get(item.itemKey)?.source.text ?? "";
        const language =
          text === ""
            ? undefined
            : (({ nonEnglish, dominantScript }) => ({
                nonEnglish,
                dominantScript,
              }))(detectLanguage(text));
        return { ...item.screen, ...(language !== undefined && { language }) };
      }),
      screeningPolicyFrom(ctx.config),
    );
    const decisions = new Map(report.decisions.map((d) => [d.key, d]));
    const papers: PlannedPaper[] = [];
    const excluded: ExcludedItem[] = [];
    const retractedKeys: string[] = [];
    const titles = new Map<string, string>();
    const retractionReasons = new Map<string, string>();
    const duplicateOf = new Map<string, string>();
    for (const item of collection.items) {
      titles.set(item.itemKey, item.metadata.title);
      const reasons = item.screen.retraction?.zotero?.reasons ?? [];
      if (reasons.length > 0) {
        retractionReasons.set(item.itemKey, reasons.join("; "));
      }
      const decision = decisions.get(item.itemKey);
      if (decision?.duplicateOf !== undefined) {
        duplicateOf.set(item.itemKey, decision.duplicateOf);
      }
      if (decision !== undefined && !decision.synthesize) {
        excluded.push({
          itemKey: item.itemKey,
          reason: decision.reason ?? "excluded",
        });
        if (decision.reason === "retracted") retractedKeys.push(item.itemKey);
        continue;
      }
      const stored = storedByKey.get(item.itemKey);
      const acquired = acquiredByKey.get(item.itemKey);
      const scope =
        acquired === undefined
          ? undefined
          : planInputScopeKind(allowed, acquired.source);
      if (stored === undefined && scope === "metadata-only") {
        excluded.push({ itemKey: item.itemKey, reason: NO_TEXT_REASON });
        continue;
      }
      papers.push({ item, stored, acquired, scope, decision });
    }
    paperCount = papers.length;
    toMake = papers.filter((p) => p.stored === undefined).length;
    // No checkpoint here: `prepare` runs before the record exists, or (for a
    // resumed job) must not overwrite the checkpoint it resumes from.

    const base = {
      input,
      providerId: ctx.llm.activeProvider(),
      fullTextMode: allowed.fullTextMode,
      costGateBlocksFullText: false,
      raise: undefined,
    } as const;
    const state = (
      spend: readonly StageSpend[],
      stop: TrendReportStop | undefined,
    ): PreparedTrendState => ({
      collectionName,
      total,
      papers,
      excluded,
      retractedKeys,
      titles,
      retractionReasons,
      duplicateOf,
      spend,
      stop,
    });
    if (papers.length === 0) {
      // Nothing to analyse: the run stops before any request (docs/07 §12.4's
      // "too few summarizable items").
      show("done");
      return {
        ...base,
        status: "run",
        disclosure: undefined,
        estimate: undefined,
        state: state([], { messageId: NO_PAPERS_L10N }),
      };
    }

    // Estimating (`P4-T16`).
    show("Estimating");
    const reportModel = ctx.llm.resolveModel("strong");
    const critiqueModel = resolveCritiqueModel(ctx.llm, ctx.config);
    const rounds = critiqueRoundsOf(ctx.config);
    const providerId = reportModel.providerId;
    const priceOf = (modelId: string): ModelPrices | undefined =>
      deps.prices(providerId, modelId);
    const mapInfo = modelInfoOf(mapModel);
    const count = (text: string): number => estTokens(text, mapModel.modelId);
    const toSummarize = papers.filter((p) => p.stored === undefined);
    const now = ctx.clock.now();
    const estimate = estimateReportRun({
      items: papers.map((p): EstimateItem => ({
        workKey: p.item.workKey,
        source:
          p.acquired === undefined
            ? { tier: "abstract", abstract: null, text: "" }
            : {
                tier: p.acquired.source.tier,
                abstract: p.acquired.source.abstract,
                text: p.acquired.source.text,
                itemKey: p.acquired.source.itemKey,
                sectionAware: p.acquired.source.sectionAware,
                sections: p.acquired.source.sections,
              },
        cached: p.stored !== undefined,
      })),
      fullTextMode: allowed.fullTextMode,
      mapModel: {
        modelId: mapModel.modelId,
        prices: priceOf(mapModel.modelId),
      },
      overhead: measureOverhead(
        prompts,
        toSummarize.map((p) => p.item),
        count,
      ),
      fullTextAutoMaxPapers: ctx.config.get("summaryFullTextAutoMaxPapers"),
      atEpochMs: now,
      countTokens: count,
      ...(mapInfo?.contextWindowTokens !== undefined && {
        contextWindowTokens: mapInfo.contextWindowTokens,
      }),
      reportModel: {
        modelId: reportModel.modelId,
        prices: priceOf(reportModel.modelId),
        maxOutputTokens: outputLimitOf(modelInfoOf(reportModel)),
        limits: limitsOf(reportModel),
      },
      critiqueModel: {
        modelId: critiqueModel.modelId,
        prices: priceOf(critiqueModel.modelId),
        limits: limitsOf(critiqueModel),
      },
      prompts,
      synthesisOverhead: measureSynthesisOverhead(prompts, (text) =>
        estTokens(text, reportModel.modelId),
      ),
      languages: [input.language],
      critiqueRounds: rounds,
    });
    const disclosure = buildEgressDisclosure(
      {
        providerId,
        modelId: reportModel.modelId,
        privacyMode: ctx.privacy.mode,
        items: toSummarize.map((p) => p.scope ?? "abstract"),
        report: {
          papers: papers.length,
          models: {
            ...(toSummarize.length > 0 && { map: mapModel.modelId }),
            report: reportModel.modelId,
            ...(rounds > 0 && { critique: critiqueModel.modelId }),
          },
        },
      },
      {
        baseUrls: deps.baseUrls,
        ...(deps.egressAcknowledged !== undefined && {
          egressAcknowledged: deps.egressAcknowledged,
        }),
      },
    );
    const spend = stageSpendOf(estimate, priceOf, now);

    if (options.resume !== undefined) {
      // A resumed job: the spend guards passed and the notice was shown at
      // restart (`plan/00` §6 item 250); its first answer stands.
      return {
        ...base,
        status: "run",
        fullTextMode: options.resume.choice.fullTextMode,
        costGateBlocksFullText: options.resume.choice.costGateBlocksFullText,
        disclosure,
        estimate,
        state: state(options.resume.spend, undefined),
      };
    }
    if (options.confirm === false) {
      return {
        ...base,
        status: "declined",
        disclosure,
        estimate,
        state: state(spend, undefined),
      };
    }

    // AwaitingConfirm: the report run's own record, never the summarize
    // run's (owner, plan/00 §6 item 292(f)).
    show("AwaitingConfirm");
    let routine: RoutineConfirmation | undefined;
    try {
      routine = await deps.routine?.read(collectionRef);
    } catch {
      routine = undefined; // asked again: the safe direction
    }
    const guard = isRunBudgetGuard(ctx.budget) ? ctx.budget : undefined;
    const stopFor = (costUsd: number | undefined): CeilingStop | undefined => {
      if (guard === undefined) return undefined;
      const check = guard.check(costUsd ?? 0);
      return check.ok ? undefined : check.stop;
    };
    let answer: TrendReportConfirmAnswer;
    try {
      answer = await surface.confirm({
        estimate,
        disclosure,
        confirmation: mustAskConfirmation(disclosure, routine),
        ceilingSelected: stopFor(estimate.selected.costUsd),
        ceilingDowngrade: stopFor(estimate.abstractOnly.costUsd),
        collection: collectionRef,
        session: guard?.usage().session ?? ZERO_SPEND,
      });
    } catch (error) {
      ctx.logger.warn(
        "the report's cost confirmation failed; nothing is sent",
        {
          reason: error instanceof Error ? error.name : typeof error,
        },
      );
      answer = { kind: "cancelled" };
    }
    if (answer.kind !== "run") {
      show("done");
      return {
        ...base,
        status: "declined",
        disclosure,
        estimate,
        state: state(spend, undefined),
      };
    }
    if (answer.dontAskAgain && deps.routine !== undefined) {
      try {
        await deps.routine.write(
          collectionRef,
          routineConfirmationFor(disclosure),
        );
      } catch {
        // Not stored: the next report run asks again.
      }
    }
    const downgrade = answer.plan === "abstract-only";
    return {
      ...base,
      status: "run",
      fullTextMode:
        downgrade && allowed.fullTextMode === "always"
          ? "never"
          : allowed.fullTextMode,
      costGateBlocksFullText: downgrade && allowed.fullTextMode === "auto",
      raise: answer.raise,
      disclosure,
      estimate,
      state: state(
        downgrade
          ? stageSpendOf(
              { ...estimate, selected: estimate.abstractOnly },
              priceOf,
              now,
            )
          : spend,
        undefined,
      ),
    };
  };

  const execute: TrendReportPipeline["execute"] = async (
    prepared,
    ctx,
    surface,
  ) => {
    const jobId = ctx.jobId;
    const { input, state } = prepared;
    let stage: TrendReportStageKey | "waiting" | "done" = "EnsuringSummaries";
    let passes = 0;
    const counts = { made: 0, cached: 0, failed: 0 };
    let themesDone = 0;
    let themesTotal = 0;
    const toMake = state.papers.filter((p) => p.stored === undefined).length;
    const view = (): TrendReportRunView => ({
      stage,
      collectionName: state.collectionName,
      total: state.total,
      papers: state.papers.length,
      summaries: { toMake, ...counts },
      themes: { done: themesDone, total: themesTotal },
      passes,
    });
    const show = (): void => {
      try {
        surface.update(view());
      } catch {
        // A surface that throws loses the view, not the run.
      }
    };
    const finish = (
      outcome: TrendReportOutcome,
      extra: Omit<TrendReportOutput, "outcome" | "view" | "passes"> = {},
    ): TrendReportOutput => {
      stage = "done";
      show();
      return { outcome, view: view(), passes, ...extra };
    };

    if (prepared.status === "declined") return finish("declined");

    await deps.queue.start(jobId);
    const ticket: JobTicket = await deps.admission.admit(
      {
        id: jobId,
        priority: "normal",
        exclusivityKey: trendReportExclusivityKey(input),
      },
      ctx.token,
    );
    const unsubscribe: (() => void)[] = [];
    const guard = isRunBudgetGuard(ctx.budget) ? ctx.budget : undefined;
    const wallClockMs = deps.wallClockBudgetMs ?? WALL_CLOCK_BUDGET_DEFAULT_MS;
    let activeSince = ctx.clock.now();

    /** The cost still ahead, from the confirmed per-stage estimate. */
    const remainingUsd = (from: TrendReportStageKey): number | undefined => {
      const index = TREND_REPORT_STAGE_KEYS.indexOf(from);
      let sum = 0;
      for (const share of state.spend) {
        if (TREND_REPORT_STAGE_KEYS.indexOf(share.stage) < index) continue;
        if (share.costUsd === null) return undefined;
        sum += share.costUsd;
      }
      return sum;
    };

    /** Pause, ask, and resume or throw a cancel (the stage stays pending). */
    const pauseAndAsk = async (
      reason: PauseReason,
      question: SummarizeQuestion,
      onResume?: () => void,
    ): Promise<void> => {
      const resumeStage = stage;
      stage = "waiting";
      show();
      await deps.queue.pause(jobId, reason);
      ticket.suspend();
      let answer: "resume" | "cancel";
      try {
        answer = await surface.ask(question);
      } catch {
        answer = "cancel";
      }
      if (answer === "cancel" || ctx.token.isCancellationRequested) {
        throw stoppedAtPause();
      }
      onResume?.();
      await ticket.reacquire(ctx.token);
      await deps.queue.resume(jobId);
      activeSince = ctx.clock.now();
      stage = resumeStage;
      show();
    };

    /**
     * One synthesis stage, its pauses kept pending (`plan/07` §0.2 items 12
     * and 18): the wall-clock budget is checked before it, a budget refusal
     * or a rejected key inside it pauses and asks, and "continue" runs the
     * stage again (its cache entries make finished parts free).
     */
    const synthesisStage = async <T>(
      key: TrendReportStageKey,
      work: () => Promise<T>,
    ): Promise<T> => {
      stage = key;
      show();
      for (;;) {
        ctx.token.throwIfCancelled();
        if (ctx.clock.now() - activeSince >= wallClockMs) {
          await pauseAndAsk("wall-clock-budget", {
            reason: "wall-clock-budget",
            done: TREND_REPORT_STAGE_KEYS.indexOf(key),
            total: TREND_REPORT_STAGE_KEYS.length,
            minutes: Math.round(wallClockMs / 60_000),
          });
        }
        try {
          return await work();
        } catch (error) {
          if (ctx.token.isCancellationRequested) throw error;
          const stop = ceilingStopOf(error);
          if (stop !== undefined && guard !== undefined) {
            const remaining = remainingUsd(key);
            const raiseToUsd = suggestedLimitUsd(stop, remaining);
            await pauseAndAsk(
              "budget-stop",
              {
                reason: "budget-stop",
                stop,
                remainingUsd: remaining,
                raiseToUsd,
                usage: guard.usage(),
              },
              () => {
                try {
                  guard.raiseLimit(stop.ceiling, raiseToUsd);
                } catch {
                  // Already at or above it: continue as asked.
                }
              },
            );
            continue;
          }
          if (error instanceof AuthenticationError) {
            await pauseAndAsk("credential-required", {
              reason: "credential-required",
              providerId: prepared.providerId,
            });
            continue;
          }
          throw error;
        }
      }
    };

    const checkpoint = async (done: TrendReportStageKey): Promise<void> => {
      const value: TrendReportCheckpoint = {
        version: TREND_REPORT_CHECKPOINT_VERSION,
        stage: done,
        choice: {
          fullTextMode: prepared.fullTextMode,
          costGateBlocksFullText: prepared.costGateBlocksFullText,
        },
        spend: state.spend,
      };
      await ctx.checkpoint(value);
    };

    try {
      if (state.stop !== undefined) throw new StageStop(state.stop);
      if (prepared.raise !== undefined && guard !== undefined) {
        guard.raiseLimit(prepared.raise.ceiling, prepared.raise.limitUsd);
      }

      // No key, no request: pause and ask (docs/09 §1.7).
      if (deps.credentials !== undefined) {
        while (!(await deps.credentials.hasKey(prepared.providerId))) {
          await pauseAndAsk("credential-required", {
            reason: "credential-required",
            providerId: prepared.providerId,
          });
        }
      }

      const prompts = await deps.prompts();
      const store = await requireSummaries();
      const cacheEnabled = ctx.config.get("cacheEnabled");
      const probe = cacheEnabled && input.skipSynthesisCache !== true;
      const promptLines: Record<string, string> = {};
      for (const [id, version] of Object.entries(prompts.versions)) {
        promptLines[id] = promptCacheLine(version);
      }
      const cache: Cache = ctx.cache;
      const cached = async <T>(key: SynthesisKey): Promise<T | undefined> =>
        probe ? cache.get<T>(SYNTHESIS_CACHE_NAMESPACE, key.key) : undefined;
      const remember = async <T>(
        key: SynthesisKey,
        value: T,
      ): Promise<void> => {
        if (!cacheEnabled) return;
        try {
          // The one gate for a persisted record (`docs/09` §2.1, `P3-T36`).
          await cache.set(
            SYNTHESIS_CACHE_NAMESPACE,
            key.key,
            redactRecord(value).record,
            { tags: synthesisTags(key, promptLines) },
          );
        } catch (error) {
          ctx.logger.warn("a synthesis result could not be cached", {
            kind: key.kind,
            reason: error instanceof Error ? error.name : typeof error,
          });
        }
      };

      // ------------------------------------------------ EnsuringSummaries
      stage = "EnsuringSummaries";
      show();
      const summariesByKey = new Map<string, StoredSummary>();
      for (const paper of state.papers) {
        if (paper.stored !== undefined) {
          summariesByKey.set(paper.item.itemKey, paper.stored);
        }
      }
      const failedKeys = new Set<string>();
      const noTextKeys = new Set<string>();
      const madeUsages: (Usage | undefined)[] = [];
      const missing = state.papers.filter((p) => p.stored === undefined);
      if (missing.length > 0) {
        let lastStop: CeilingStop | undefined;
        let outage = false;
        const pooledRef: { current: PooledRun | undefined } = {
          current: undefined,
        };
        const itemDeps = summarizeItemDepsFrom(ctx, {
          prompts,
          store,
          ...(deps.modelInfo !== undefined && { modelInfo: deps.modelInfo }),
          modelConfirmed: true,
          imradDetectorValidated: false,
        });
        const onPaused = (record: JobRecord): void => {
          const run = pooledRef.current;
          if (run === undefined) return;
          void (async () => {
            const reason = record.pauseReason ?? "user";
            stage = "waiting";
            show();
            let answer: "resume" | "cancel";
            let raiseTo: { ceiling: CeilingKind; limitUsd: number } | undefined;
            try {
              if (
                reason === "budget-stop" &&
                lastStop !== undefined &&
                guard !== undefined
              ) {
                const remaining = remainingUsd("EnsuringSummaries");
                const raiseToUsd = suggestedLimitUsd(lastStop, remaining);
                raiseTo = { ceiling: lastStop.ceiling, limitUsd: raiseToUsd };
                answer = await surface.ask({
                  reason: "budget-stop",
                  stop: lastStop,
                  remainingUsd: remaining,
                  raiseToUsd,
                  usage: guard.usage(),
                });
              } else if (reason === "credential-required") {
                answer = await surface.ask({
                  reason: "credential-required",
                  providerId: prepared.providerId,
                });
              } else {
                answer = await surface.ask({
                  reason: reason as Exclude<
                    PauseReason,
                    "credential-required" | "budget-stop"
                  >,
                  done: counts.made + counts.cached + counts.failed,
                  total: missing.length,
                  minutes: Math.round(wallClockMs / 60_000),
                });
              }
            } catch {
              answer = "cancel";
            }
            if (answer === "resume") {
              if (raiseTo !== undefined && guard !== undefined) {
                try {
                  guard.raiseLimit(raiseTo.ceiling, raiseTo.limitUsd);
                } catch {
                  // Already at or above it.
                }
              }
              stage = "EnsuringSummaries";
              show();
              await run.resume();
            } else if (ctx.token.reason?.kind !== "shutdown") {
              // A shutdown stops the run through its token and moves no job
              // state: the record is `recover()`'s (step 0c).
              await run.cancel({ kind: "user" });
            }
          })();
        };
        // Registered for this stage only: a synthesis stage asks its own
        // question (`pauseAndAsk`), and must not be asked twice.
        const stopListening =
          deps.pauseNotices?.onPause(jobId, onPaused) ??
          ((): void => undefined);
        unsubscribe.push(stopListening);
        const run = runPooledItems<PlannedPaper, SummarizeItemResult>({
          jobId,
          items: missing,
          workKey: (p) => p.item.workKey,
          isDone: () => Promise.resolve(false),
          call: async (p, token: CancellationToken) => {
            const acquired = p.acquired as AcquiredItem;
            try {
              return await summarizeItem(
                {
                  source: acquired.source,
                  workKey: p.item.workKey,
                  metadata: p.item.metadata,
                  fullTextMode: prepared.fullTextMode,
                  costGateBlocksFullText: prepared.costGateBlocksFullText,
                  pageCounts: acquired.pageCounts,
                  sourceItemVersion: p.item.dateModified,
                  nonEnglish:
                    p.decision?.nonEnglishPolicy === undefined
                      ? undefined
                      : {
                          nonEnglishPolicy: p.decision.nonEnglishPolicy,
                          ...(p.decision.sourceLanguage !== undefined && {
                            sourceLanguage: p.decision.sourceLanguage,
                          }),
                        },
                },
                { ...itemDeps, token },
              );
            } catch (error) {
              const pending =
                token.isCancellationRequested ||
                ceilingStopOf(error) !== undefined ||
                error instanceof AuthenticationError;
              if (!pending) {
                failedKeys.add(p.item.itemKey);
                counts.failed += 1;
                show();
                if (
                  !outage &&
                  tooManyPapersFailed(failedKeys.size, state.papers.length)
                ) {
                  // One stop, one message (docs/06 §8.5): no row per item.
                  outage = true;
                  ctx.logger.warn(
                    "more than 30 % of the report's papers failed; stopping",
                    { failed: failedKeys.size, papers: state.papers.length },
                  );
                  void pooledRef.current?.cancel({ kind: "user" });
                }
              }
              throw error;
            }
          },
          onResult: (p, result) => {
            if (result.kind === "stub") {
              noTextKeys.add(p.item.itemKey);
            } else {
              summariesByKey.set(p.item.itemKey, result.stored);
              if (result.fromCache) counts.cached += 1;
              else {
                counts.made += 1;
                madeUsages.push(result.stored.usage);
              }
            }
            show();
            return Promise.resolve();
          },
          pool: deps.pool,
          queue: deps.queue,
          clock: ctx.clock,
          logger: ctx.logger,
          token: ctx.token,
          checkpoint: {
            checkpoint: () => Promise.resolve(),
          },
          ticket,
          ...(deps.runningWork !== undefined && {
            runningWork: deps.runningWork,
          }),
          wallClockBudgetMs: wallClockMs,
          budgetStopOf: (error) => {
            const found = ceilingStopOf(error);
            if (found !== undefined) lastStop = found;
            return found;
          },
        });
        pooledRef.current = run;
        unsubscribe.push(
          ctx.token.onCancelled((reason) => {
            // A shutdown moves no job state (the run's own token stops it).
            if (reason.kind !== "shutdown") void run.cancel({ kind: "user" });
          }),
        );
        const outcome = await run.result;
        stopListening();
        if (outage) {
          throw new StageStop({
            messageId: PAPERS_FAILED_L10N,
            args: { failed: failedKeys.size, total: state.papers.length },
          });
        }
        if (outcome.stop === "cancelled") throw stoppedAtPause();
        activeSince = ctx.clock.now();
      }
      await checkpoint("EnsuringSummaries");

      // The papers the synthesis covers, in collection order.
      const excluded: ExcludedItem[] = [...state.excluded];
      const analysed: { paper: PlannedPaper; summary: StoredSummary }[] = [];
      for (const paper of state.papers) {
        const key = paper.item.itemKey;
        const summary = summariesByKey.get(key);
        if (summary !== undefined) analysed.push({ paper, summary });
        else if (noTextKeys.has(key)) {
          excluded.push({ itemKey: key, reason: NO_TEXT_REASON });
        } else {
          excluded.push({ itemKey: key, reason: SUMMARY_FAILED_REASON });
        }
      }
      if (analysed.length === 0) {
        throw new StageStop({ messageId: NO_PAPERS_L10N });
      }
      // A summary's key is the item's: the synthesis checks markers by it.
      const summaries = analysed.map(({ paper, summary }) =>
        summary.content.itemKey === paper.item.itemKey
          ? summary
          : {
              ...summary,
              content: { ...summary.content, itemKey: paper.item.itemKey },
            },
      );
      const yearOf = new Map(
        analysed.map(({ paper }) => [
          paper.item.itemKey,
          yearNumber(paper.item.metadata.year),
        ]),
      );

      // ------------------------------------------------ Digesting
      stage = "Digesting";
      show();
      const digests: Digest[] = summaries.map((summary) =>
        toDigest({
          summary,
          year: yearOf.get(summary.content.itemKey),
        }),
      );
      const digestHash = new Map(
        digests.map((d) => [d.itemKey, sha256Hex(digestText(d))]),
      );
      const years = [...yearOf.values()].filter(
        (y): y is number => y !== undefined,
      );
      const searchRuns =
        (await deps.library.searchRuns?.(
          input.libraryID,
          input.collectionKey,
        )) ?? [];
      // DECIDED 2026-11-01 (coordinator, item 313): the collection's topic is
      // its latest search's query, else its name.
      const userTopic =
        searchRuns.at(-1)?.userQuery.trim() || state.collectionName;
      await checkpoint("Digesting");

      const reportModel = ctx.llm.resolveModel("strong");
      const providerId = reportModel.providerId;
      const routing = routingHints(ctx.privacy.mode);
      const includeBodies = ctx.config.get("logRequestBodies");

      // Step 5: the report model passes the mode before the first synthesis
      // call; the critique model is checked inside critiqueReport.
      // It throws PolicyViolationError when the mode refuses the model; a
      // confirmation it asks for was the run's own (`prepare`).
      const reportCheck = ctx.privacy.assertModelAllowed(
        modelInfoOf(reportModel) ?? unknownPolicyModel(reportModel.modelId),
        ctx.privacy.mode,
        modelRouteFor(providerId, () => ctx.config.get("geminiPaidTier")),
      );
      if (reportCheck.warnings.length > 0) {
        ctx.logger.info("the report model passes with warnings", {
          warnings: reportCheck.warnings.join(","),
        });
      }

      const promptUses: TrendPromptUse[] = [];
      const usages: (Usage | undefined)[] = [...madeUsages];

      // ------------------------------------------------ Clustering
      const clusterPrompt = prompts.get("THEME_CLUSTER");
      const band = themeBandFor(digests.length);
      const outputLimit = outputLimitOf(modelInfoOf(reportModel));
      const critiqueModel = resolveCritiqueModel(ctx.llm, ctx.config);
      const reportLimits = limitsOf(reportModel);
      // Every stage's input budget, on the model's context window, from the
      // function the estimate counts with (owner, plan/00 §6 item 327(a);
      // docs/06 §8.4's note of 2026-11-02).
      const budgets = synthesisBudgets({
        papers: digests.length,
        outputLimit,
        reportLimits,
        critiqueLimits: limitsOf(critiqueModel),
        prompts,
        synthesisOverhead: measureSynthesisOverhead(prompts, (text) =>
          estTokens(text, reportModel.modelId),
        ),
      });
      // In `tc` and `cr` only when known, so an unknown window keeps its keys.
      const windowInput =
        reportLimits.contextWindowTokens === undefined
          ? {}
          : { contextWindowTokens: reportLimits.contextWindowTokens };
      const tcKey = themeClusteringKey({
        members: digests.map((d) => ({
          id: d.itemKey,
          hash: digestHash.get(d.itemKey) as string,
        })),
        themeBand: band,
        promptCacheEpochs: prompts.cacheEpochs,
        providerId,
        call: {
          modelId: reportModel.modelId,
          temperature: clusterPrompt.defaultTemperature,
          effort: THEME_CLUSTER_EFFORT,
        },
        stageInputs: {
          USER_TOPIC: userTopic,
          YEAR_MIN: years.length === 0 ? null : Math.min(...years),
          YEAR_MAX: years.length === 0 ? null : Math.max(...years),
          outputLimit,
          ...windowInput,
        },
      });
      const clustered = await synthesisStage("Clustering", async () => {
        const hit = await cached<ClusteredOutcome>(tcKey);
        if (hit !== undefined) return hit;
        const outcome = await clusterThemes(
          {
            digests,
            userTopic,
            yearMin: years.length === 0 ? undefined : Math.min(...years),
            yearMax: years.length === 0 ? undefined : Math.max(...years),
            outputLimit,
            band,
            inputBudget: budgets.clusterSingle,
            batchInputBudget: budgets.clusterBatch,
            mergeInputBudget: budgets.clusterMerge,
          },
          {
            llm: ctx.llm,
            budget: ctx.budget,
            token: ctx.token,
            prompt: clusterPrompt,
            mergePrompt: prompts.get("THEME_MERGE"),
            pool: deps.pool,
            routing,
            includeBodies,
            logger: ctx.logger,
            traceId: `${jobId}:cluster`,
          },
        );
        usages.push(outcome.usage);
        if (outcome.status === "stopped-too-many-themes") {
          throw new StageStop({
            messageId: TOO_MANY_THEMES_L10N,
            args: { ...outcome.args },
          });
        }
        if (outcome.status === "stopped-no-themes") {
          throw new StageStop({ messageId: NO_THEMES_L10N });
        }
        if (outcome.status === "stopped-merge-over-budget") {
          throw new StageStop({ messageId: MERGE_TOO_LARGE_L10N });
        }
        await remember(tcKey, outcome);
        return outcome;
      });
      passes += clustered.passes;
      promptUses.push(clustered.prompt);
      if (clustered.mergePrompt !== undefined) {
        promptUses.push(clustered.mergePrompt);
      }
      themesTotal = clustered.clustering.themes.length;
      await checkpoint("Clustering");

      // ------------------------------------------------ Analysing
      const byKey = new Map(summaries.map((s) => [s.content.itemKey, s]));
      const reducePrompt = prompts.get("CLUSTER_REDUCE");
      const crKeys = new Map(
        clustered.clustering.themes.map((theme) => [
          theme.themeId,
          themeAnalysisKey({
            themeId: theme.themeId,
            themeName: theme.name,
            themeDefinition: theme.definition,
            members: theme.itemKeys.map((itemKey) => ({
              id: itemKey,
              hash: sha256Hex(
                JSON.stringify(summariesForReduce([itemKey], byKey)[0]),
              ),
            })),
            promptCacheEpochs: prompts.cacheEpochs,
            providerId,
            call: {
              modelId: reportModel.modelId,
              temperature: reducePrompt.defaultTemperature,
              effort: THEME_ANALYSIS_EFFORT,
            },
            stageInputs: { USER_TOPIC: userTopic, ...windowInput },
          }),
        ]),
      );
      // Each theme is kept the moment it is analysed (`onThemeAnalysed`), for
      // this run and in its `cr` entry, so "continue" after a budget pause
      // re-sends only the themes not yet analysed — with the cache off too
      // (`plan/00` §6 item 322(e), P4-T18 finding 3; DECIDED 2026-11-01,
      // coordinator, under item 313).
      const keptThemes = new Map<string, AnalysedTheme>();
      const analysis = await synthesisStage("Analysing", async () => {
        const fromCache = new Map<string, AnalysedTheme>(keptThemes);
        for (const theme of clustered.clustering.themes) {
          if (fromCache.has(theme.themeId)) continue;
          const hit = await cached<AnalysedTheme>(
            crKeys.get(theme.themeId) as SynthesisKey,
          );
          if (hit !== undefined) fromCache.set(theme.themeId, hit);
        }
        const misses = clustered.clustering.themes.filter(
          (theme) => !fromCache.has(theme.themeId),
        );
        themesDone = fromCache.size;
        show();
        let fresh: readonly ThemeResult[] = [];
        let freshPasses = 0;
        let freshPrompts: readonly TrendPromptUse[] = [];
        if (misses.length > 0) {
          const outcome = await analyseThemes(
            {
              clustering: { themes: misses },
              summaries,
              userTopic,
              inputBudget: budgets.reduce,
              mergeInputBudget: budgets.reduceMerge,
            },
            {
              llm: ctx.llm,
              budget: ctx.budget,
              token: ctx.token,
              pool: deps.pool,
              reducePrompt,
              mergePrompt: prompts.get("CLUSTER_REDUCE_MERGE"),
              routing,
              includeBodies,
              logger: ctx.logger,
              traceId: `${jobId}:theme`,
              onThemeAnalysed: async (theme) => {
                keptThemes.set(theme.themeId, theme);
                themesDone += 1;
                show();
                await remember(
                  crKeys.get(theme.themeId) as SynthesisKey,
                  theme,
                );
              },
            },
          );
          usages.push(outcome.usage);
          fresh = outcome.themes;
          freshPasses = outcome.passes;
          freshPrompts = outcome.prompts;
        }
        const freshById = new Map(fresh.map((r) => [r.themeId, r]));
        const themes = clustered.clustering.themes.map(
          (theme): ThemeResult =>
            fromCache.get(theme.themeId) ??
            (freshById.get(theme.themeId) as ThemeResult),
        );
        if (!themes.some((t) => t.status === "analysed")) {
          // Owner, plan/00 §6 item 309(g): every theme unanalysed.
          throw new StageStop({ messageId: NO_THEME_ANALYSED_L10N });
        }
        const cachedPasses = Math.max(
          0,
          ...[...fromCache.values()].map((t) => t.passes),
        );
        return {
          themes,
          passes: Math.max(freshPasses, cachedPasses),
          prompts:
            freshPrompts.length > 0
              ? freshPrompts
              : [
                  {
                    promptId: "CLUSTER_REDUCE" as TrendPromptId,
                    promptVersion: reducePrompt.version,
                    modelId: reportModel.modelId,
                    temperature: reducePrompt.defaultTemperature,
                  },
                ],
        };
      });
      passes += analysis.passes;
      promptUses.push(...analysis.prompts);
      themesDone = analysis.themes.length;
      await checkpoint("Analysing");

      // ------------------------------------------------ Composing + Critiquing
      const language = input.language;
      const reportPrompt = prompts.get(reportPromptId(language));
      const memberCount = new Map(
        clustered.clustering.themes.map((t) => [t.themeId, t.itemKeys.length]),
      );
      const analysedThemes = analysis.themes.filter(
        (t): t is AnalysedTheme => t.status === "analysed",
      );
      const composeInput: ComposeInput = {
        language,
        collectionName: state.collectionName,
        userTopic,
        totalCount: state.total,
        analysed: analysed.map(({ paper, summary }): AnalysedPaper => ({
          itemKey: paper.item.itemKey,
          year: yearNumber(paper.item.metadata.year),
          sourceTier: summary.content.sourceTier,
          libraryCatalog: undefined,
        })),
        excluded,
        searchRuns,
        themes: analysedThemes.map((t) => ({
          analysis: t.analysis,
          memberCount: memberCount.get(t.themeId) ?? 0,
        })),
        digests,
        targetWords: ctx.config.get("reportTargetWords"),
        duplicateOf: state.duplicateOf,
        citationReplacement: reportLabel(language, "invalidCitation"),
        inputBudget: budgets.report[language],
      };
      // The current run's plan (never a cached report's, item 312(c)).
      const plan: CompositionPlan = prepareComposition(
        composeInput,
        reportPrompt,
        reportModel,
      );
      const rounds = critiqueRoundsOf(ctx.config);
      const critiquePrompt = prompts.get("SELF_CRITIQUE");
      const rpKey = reportKey({
        language,
        themeAnalyses: analysedThemes.map((t) => ({
          id: t.themeId,
          hash: sha256Hex(JSON.stringify(t.analysis)),
        })),
        digests: plan.digestKeys.map((key) => ({
          id: key,
          hash: digestHash.get(key) as string,
        })),
        summaries: summaries.map((s) => ({
          id: s.content.itemKey,
          hash: sha256Hex(JSON.stringify(s.content)),
        })),
        targetWords: plan.targetWords,
        critique: {
          rounds,
          call: {
            modelId: critiqueModel.modelId,
            temperature: critiquePrompt.defaultTemperature,
            effort: CRITIQUE_EFFORT,
          },
        },
        promptCacheEpochs: prompts.cacheEpochs,
        providerId,
        call: {
          modelId: reportModel.modelId,
          temperature: reportPrompt.defaultTemperature,
          effort: REPORT_EFFORT,
        },
        stageInputs: stageInputsOf(plan, composeInput),
      });
      interface CachedReport {
        readonly draft: ComposedReport;
        readonly outcome: TrendReport["critique"];
        readonly warnings: readonly string[];
        readonly prompts: readonly TrendPromptUse[];
        readonly passes: number;
      }
      let shipped = probe ? await cached<CachedReport>(rpKey) : undefined;
      if (shipped === undefined) {
        const draft = await synthesisStage("Composing", async () => {
          const outcome = await composeReport(composeInput, {
            llm: ctx.llm,
            budget: ctx.budget,
            token: ctx.token,
            pool: deps.pool,
            reportPrompt,
            progress: ctx.progress,
            routing,
            logger: ctx.logger,
            traceId: `${jobId}:report`,
            ...(surface.onDraft !== undefined && {
              onDraft: (delta: DraftDelta) => surface.onDraft?.(delta),
            }),
          });
          usages.push(outcome.usage);
          if (outcome.status === "stopped-structure-invalid") {
            // Owner, plan/00 §6 item 311(a): the composition's own stop.
            throw new StageStop({ messageId: STRUCTURE_INVALID_L10N });
          }
          return outcome;
        });
        await checkpoint("Composing");
        const critique = await synthesisStage("Critiquing", async () => {
          const result = await critiqueReport(
            {
              draft,
              compose: composeInput,
              summaries,
              inputBudget: budgets.critique,
            },
            {
              llm: ctx.llm,
              budget: ctx.budget,
              token: ctx.token,
              pool: deps.pool,
              reportPrompt,
              critiquePrompt,
              privacy: ctx.privacy,
              config: ctx.config,
              ...(deps.modelInfo !== undefined && {
                modelInfo: deps.modelInfo,
              }),
              modelConfirmed: true,
              progress: ctx.progress,
              routing,
              logger: ctx.logger,
              traceId: `${jobId}:report`,
              ...(surface.onDraft !== undefined && {
                onDraft: (delta: DraftDelta) => surface.onDraft?.(delta),
              }),
              ...(surface.onRevision !== undefined && {
                onRevision: (signal: RevisionSignal) =>
                  surface.onRevision?.(signal),
              }),
            },
          );
          usages.push(result.usage);
          return result;
        });
        shipped = {
          draft: critique.draft,
          outcome: critique.outcome,
          warnings: critique.warnings,
          prompts: [draft.prompt, ...critique.prompts],
          // L3: the composition; L4: one pass per critique round run.
          passes: 1 + critique.outcome.rounds,
        };
        await remember(rpKey, shipped);
      }
      passes += shipped.passes;
      promptUses.push(
        ...(rounds > 0 ? shipped.prompts : shipped.prompts.slice(0, 1)),
      );
      await checkpoint("Critiquing");

      // ------------------------------------------------ Scaffolding
      stage = "Scaffolding";
      show();
      ctx.token.throwIfCancelled();
      const style = await deps.library.bibliography.userCitationStyle();
      const request = {
        libraryID: input.libraryID,
        styleId: style?.styleId ?? REPORT_FALLBACK_STYLE_ID,
        locale: REPORT_CSL_LOCALE,
      };
      const citedKeys = bibliographyKeys(shipped.draft.sections);
      const bibliography = await deps.library.bibliography.formatBibliography(
        citedKeys,
        request,
      );
      const retractionPolicy = ctx.config.get(
        "screeningRetractionPolicy",
      ) as RetractionPolicy;
      const retracted =
        retractionPolicy === "exclude_entirely" ||
        state.retractedKeys.length === 0
          ? []
          : await deps.library.bibliography.formatRetracted(
              state.retractedKeys,
              request,
            );
      const generatedAtEpochMs = ctx.clock.now();
      const scaffolded = scaffoldReport({
        language,
        collectionName: state.collectionName,
        pluginVersion: deps.pluginVersion,
        generatedAtEpochMs,
        utcOffsetMinutes: deps.utcOffsetMinutes?.(generatedAtEpochMs) ?? 0,
        providerId,
        prompts: promptUses,
        usage: sumUsage(usages),
        totalCount: state.total,
        analysed: analysed.map(({ paper }, i) => ({
          itemKey: paper.item.itemKey,
          year: yearNumber(paper.item.metadata.year),
          summary: summaries[i] as StoredSummary,
        })),
        excluded,
        titles: state.titles,
        retractionReasons: state.retractionReasons,
        clustering: clustered.clustering,
        otherThemeId: clustered.otherThemeId,
        themes: analysis.themes,
        reductionPasses: passes,
        composed: shipped.draft,
        plan,
        critique: shipped.outcome,
        critiqueWarnings: shipped.warnings,
        bibliography: bibliography.entries,
        retracted,
        retractionPolicy,
      });
      const dated = withDatedTitle(
        scaffolded.markdown,
        language,
        state.collectionName,
        generatedAtEpochMs,
      );
      const reportId = (deps.newReportId ?? randomUuid)();
      const { notablePapers: _notable, ...parts } = scaffolded;
      let trendReport: TrendReport = {
        ...parts,
        id: reportId,
        libraryID: input.libraryID,
        collectionKey: input.collectionKey,
        collectionName: state.collectionName,
        title: dated.title,
        markdown: dated.markdown,
        language,
        generatedAtEpochMs,
        pluginVersion: deps.pluginVersion,
        audioScripts: {},
        providerId,
        prompts: promptUses,
        usage: sumUsage(usages),
      };
      await checkpoint("Scaffolding");

      // ------------------------------------------------ Rendering
      stage = "Rendering";
      show();
      const html = await renderReportNote(trendReport, {
        port: deps.library.bibliography,
        request,
        labels: { retractedHeading: reportLabel(language, "retractedHeading") },
      });

      // ------------------------------------------------ Saving
      // The last point a cancel discards everything; past it the write runs
      // to its end (row and file, then the note), so nothing half-saved is left.
      ctx.token.throwIfCancelled();
      stage = "Saving";
      show();
      const reports = await deps.reports();
      if (reports === undefined) {
        throw new ConfigurationError(
          "the plugin database is not available, so the report cannot be saved",
        );
      }
      trendReport = await reports.put(trendReport);
      let note: ReportNoteOutcome | undefined;
      if (ctx.config.get("reportSaveNote")) {
        note = await deps.library.writeReportNote({
          report: trendReport,
          html,
          groupConfirmation: input.groupConfirmation,
        });
        if (note.kind === "written") {
          trendReport = await reports.put({
            ...trendReport,
            zoteroNoteKey: note.noteKey,
          });
        }
      }
      await deps.queue.succeed(jobId, { kind: "report", key: trendReport.id });
      return finish("succeeded", {
        report: trendReport,
        noteHtml: html,
        ...(note !== undefined && { note }),
      });
    } catch (error) {
      if (ctx.token.reason?.kind === "shutdown") {
        // The plugin is shutting down (`P4-T20` step 0c): the record is left
        // `running` or `paused`, with its checkpoint and every paid-for
        // result, for `recover()` at the next start; nothing is written to a
        // closing database.
        ctx.logger.info("the report run was interrupted by shutdown", {
          stage,
        });
        return finish("interrupted");
      }
      if (error instanceof StageStop) {
        ctx.logger.warn("the report run stopped before anything was written", {
          messageId: error.stop.messageId,
        });
        // The stop's full id (42–48 characters) would be redacted by the
        // record's gate, whose catch-all takes any run of 40 or more
        // (`KEY_PATTERNS`), so the record keeps its short name in `detail`;
        // the window shows the output's `stop` (DECIDED 2026-11-01,
        // coordinator, under item 313).
        await endJob(jobId, "stopped", {
          code: STOPPED_CODE,
          messageKey: "rh-error-llm",
          detail: stopName(error.stop.messageId),
          retryable: false,
        });
        return finish("stopped", { stop: error.stop });
      }
      if (
        ctx.token.isCancellationRequested ||
        error instanceof OperationCancelledError
      ) {
        await endJob(jobId, "cancelled");
        return finish("cancelled");
      }
      const serialized = serializeFailure(error);
      await endJob(jobId, "failed", serialized);
      ctx.logger.error("the report run failed", { code: serialized.code });
      return finish("failed", { error: serialized });
    } finally {
      for (const stop of unsubscribe) stop();
      ticket.release();
    }
  };

  /** Move the record to its end state; a failure here is logged, never thrown. */
  const endJob = async (
    jobId: string,
    how: "stopped" | "cancelled" | "failed",
    error?: SerializedError,
  ): Promise<void> => {
    try {
      const record = await deps.queue.get(jobId);
      if (record === undefined) return;
      if (how === "cancelled" || record.status === "cancelling") {
        if (
          record.status === "running" ||
          record.status === "paused" ||
          record.status === "queued"
        ) {
          await deps.queue.cancel(jobId);
        }
        const after = await deps.queue.get(jobId);
        if (after?.status === "cancelling")
          await deps.queue.finishCancel(jobId);
        return;
      }
      if (record.status === "paused") await deps.queue.resume(jobId);
      if (error !== undefined) await deps.queue.fail(jobId, error);
    } catch {
      // The record keeps its last state; the run's answer is unchanged.
    }
  };

  const validate = (input: TrendReportInput): ValidationResult => {
    const errors: { field: string; messageKey: string }[] = [];
    if (!Number.isInteger(input.libraryID) || input.libraryID < 1) {
      errors.push({ field: "libraryID", messageKey: "rh-error-configuration" });
    }
    if (typeof input.collectionKey !== "string" || input.collectionKey === "") {
      errors.push({
        field: "collectionKey",
        messageKey: "rh-error-configuration",
      });
    }
    if (input.language !== "en" && input.language !== "ko") {
      errors.push({ field: "language", messageKey: "rh-error-configuration" });
    }
    return { ok: errors.length === 0, errors };
  };

  const pipeline: TrendReportPipeline = {
    id: "trendReport",
    displayNameKey: TREND_REPORT_DISPLAY_NAME_KEY,
    stages: TREND_REPORT_STAGES,
    // docs/07 §12.4: an interrupted run restarts from its last completed
    // stage once every spend guard passed (plan/00 §6 item 250).
    resumable: true,
    validate,
    async estimate(input, ctx): Promise<PipelineEstimate> {
      const prepared = await prepare(
        input,
        ctx,
        HEADLESS_TREND_REPORT_SURFACE,
        { confirm: false },
      );
      const plan = prepared.estimate?.selected;
      if (plan === undefined) {
        return {
          itemCount: 0,
          externalRequests: 0,
          estimatedInputTokens: 0,
          estimatedOutputTokens: 0,
          estimatedCostUsd: 0,
          estimatedDurationSeconds: 0,
          notesKeys: [],
        };
      }
      return toPipelineEstimate(
        plan,
        Math.max(1, deps.pool.size) * CALLS_PER_MINUTE_PER_PERMIT,
      );
    },
    async run(input, ctx): Promise<TrendReportOutput> {
      const surface =
        deps.surfaces?.(ctx.jobId) ?? HEADLESS_TREND_REPORT_SURFACE;
      const resume = isTrendReportCheckpoint(ctx.resumeState)
        ? ctx.resumeState
        : undefined;
      const prepared = await prepare(
        input,
        ctx,
        surface,
        resume === undefined ? {} : { resume },
      );
      if (prepared.status === "declined") {
        const record = await deps.queue.get(ctx.jobId).catch(() => undefined);
        if (record !== undefined && record.status === "queued") {
          await deps.queue.cancel(ctx.jobId).catch(() => undefined);
        }
      }
      return execute(prepared, ctx, surface);
    },
    prepare,
    execute,
    remaining(record) {
      return Promise.resolve(remainingFromCheckpoint(record));
    },
  };
  return pipeline;
}

/** An item's year as a whole number 0–9999, when it has one (`toDigest`'s rule). */
function yearNumber(year: string | number | undefined): number | undefined {
  const value =
    typeof year === "number"
      ? year
      : Number(/\b(\d{4})\b/.exec(year ?? "")?.[1]);
  return Number.isInteger(value) && value >= 0 && value <= 9999
    ? value
    : undefined;
}

/** The report model's output limit, or {@link REPORT_OUTPUT_LIMIT_UNKNOWN}. */
function outputLimitOf(info: ModelInfo | undefined): number {
  const limit = info?.maxOutputTokens;
  return limit !== undefined && Number.isInteger(limit) && limit > 0
    ? limit
    : REPORT_OUTPUT_LIMIT_UNKNOWN;
}

/**
 * What the catalogue knows of a model's window and output limit, each only when
 * positive: `unknownPolicyModel`-style zeros mean not known, and
 * {@link REPORT_OUTPUT_LIMIT_UNKNOWN} is deliberately not used, since nothing
 * clamps `max_tokens` to it (`windowInputBudget`).
 */
function windowLimitsOf(info: ModelInfo | undefined): ModelWindowLimits {
  const window = info?.contextWindowTokens;
  const output = info?.maxOutputTokens;
  return {
    ...(window !== undefined && window > 0 && { contextWindowTokens: window }),
    ...(output !== undefined && output > 0 && { maxOutputTokens: output }),
  };
}

/**
 * `rp`'s `stageInputs`: every report variable but the two the key carries as
 * hashed inputs (`THEME_ANALYSES_JSON`, `DIGESTS`), and the replacement text.
 */
function stageInputsOf(
  plan: CompositionPlan,
  input: ComposeInput,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(plan.variables)) {
    if (name === "THEME_ANALYSES_JSON" || name === "DIGESTS") continue;
    out[name] = value;
  }
  out["CITATION_REPLACEMENT"] = input.citationReplacement ?? "";
  return out;
}
