/**
 * "Summarize collection…" — `docs/07` §12.3's state machine, run (`P3-T29`;
 * FR-19, FR-20, FR-21, FR-23, FR-53).
 *
 * ## Callers and construction (`plan/README.md` §5 rule 10)
 *
 * - **Constructed** by `buildPipelineSet` in `src/bootstrap/registerPipelines.ts`
 *   ({@link createSummarizePipeline}), from the same `WorkerPools` the search
 *   pipeline's pool comes from: the `llm` pool, the job admission and the
 *   running-work registry are built once there and nowhere else. The Zotero
 *   port ({@link SummarizeLibrary}) is `createZoteroSummarizeLibrary` in that
 *   file; the summary store is `installPluginDatabase`'s
 *   (`src/bootstrap/pluginDatabase.ts`).
 * - **Driven** by the summarize window's host in `src/bootstrap/registerUI.ts`:
 *   {@link SummarizePipeline.prepare} in a job context with no record, then —
 *   only once the user confirmed — the record is enqueued with its egress log
 *   and {@link SummarizePipeline.execute} runs in that record's context.
 *   `Pipeline.run` does both halves for a job that already has a record.
 * - **Driven** also by the item pane's Generate, Retry and Regenerate:
 *   `runItemSummary` (`src/ui/dialogs/summarizeDialog.ts`) runs the same two
 *   halves over one item (`SummarizeInput.itemKeys`; owner, `plan/00` §6
 *   item 303(a)), bound by `publishSummarySection` in `registerUI.ts`.
 * - **Notices**: the queue's `JobNotifier` is {@link createJobNoticeRouter}'s,
 *   built in `installServices` (`src/bootstrap/container.ts`); a run registers
 *   for its own job's pauses.
 *
 * ## The stages (`docs/07` §12.3 and its note of 2026-10-29)
 *
 * `LoadingItems` (the collection's regular items) → `Planning` (skip what is
 * already summarized, acquire, screen, plan each item's scope under the
 * privacy policy) → `CacheProbe` → `Estimating` (`estimateRun`) →
 * `AwaitingConfirm` (`P3-T16`'s dialog, through the surface) — that is
 * {@link SummarizePipeline.prepare}. Then the key check (step 3),
 * `Summarizing` under the `llm` pool (`runPooledItems`) with each result
 * persisted as it arrives, and `WritingNotes` for skipped items that have a
 * row and no note — {@link SummarizePipeline.execute}.
 *
 * Nothing here is rolled back: a cancel keeps every row and note written; a
 * re-run skips them (FR-23). No note is written for an item without a stored
 * summary, and none is ever fabricated from a title (FR-21).
 *
 * **Layering.** `pipeline/` may import `core/`, `model/`, `llm/`, `prompts/`
 * and `zotero/` types; it names no `Zotero` global and imports no `ui/`.
 */

import {
  AuthenticationError,
  ConfigurationError,
  ResearchHelperError,
  type SerializedError,
} from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { JobRecord, PauseReason } from "../../core/jobQueue/jobRecord";
import {
  WALL_CLOCK_BUDGET_DEFAULT_MS,
  runPooledItems,
  type JobAdmission,
  type JobNotifier,
  type JobQueue,
  type LlmPool,
  type PooledRun,
  type RunningWork,
} from "../../core/jobQueue/queue";
import type { BaseUrlResolver } from "../../llm/shared/baseUrl";
import type { ModelPrices } from "../../llm/shared/pricing";
import { estTokens } from "../../llm/shared/tokenEstimate";
import type { BudgetGuard, ModelInfo } from "../../llm/types";
import type { ProviderId } from "../../model/ids";
import type { AcquiredSource, StoredSummary } from "../../model/summary";
import {
  renderPrompt,
  type PromptId,
  type PromptRegistry,
  type PromptTemplate,
} from "../../prompts";
import type { SummaryStore } from "../../zotero/db";
import {
  ZERO_SPEND,
  ceilingStopOf,
  suggestedLimitUsd,
  type CeilingKind,
  type CeilingStop,
  type RunBudgetGuard,
  type SpendTotals,
} from "../shared/budget";
import {
  buildEgressDisclosure,
  type EgressDisclosure,
} from "../shared/egressDisclosure";
import {
  estimateRun,
  toPipelineEstimate,
  type EstimateItem,
  type PromptOverheadTokens,
  type RunEstimate,
} from "../shared/estimate";
import {
  planInputScopeKind,
  type CollectionRef,
  type FullTextMode,
  type InputScopeKind,
} from "../shared/privacyPolicy";
import type {
  Pipeline,
  PipelineContext,
  PipelineEstimate,
  StageDescriptor,
  ValidationResult,
} from "../types";

import { detectLanguage } from "./languageDetect";
import {
  screenItems,
  screeningPolicyFrom,
  type ScreenDecision,
  type ScreenItem,
} from "./screen";
import {
  summarizeItem,
  summarizeItemDepsFrom,
  type SourcePageCounts,
  type SummarizeItemDeps,
  type SummarizeItemResult,
  type SummaryItemMetadata,
} from "./summarizeItem";

// ===========================================================================
// 1. Constants
// ===========================================================================

/** `Pipeline.displayNameKey`: the menu entry's own id. */
export const SUMMARIZE_DISPLAY_NAME_KEY =
  "research-helper-menu-collection-summarize-all";

/**
 * `docs/07` §12.3's stages, in run order. The label keys are the stage
 * selector values of `research-helper-summarize-stage` that the window shows;
 * the weights divide the progress bar (`stageSlices`) and sum to 1.
 */
export const SUMMARIZE_STAGES: readonly StageDescriptor[] = Object.freeze([
  {
    key: "LoadingItems",
    labelKey: "research-helper-summarize-stage",
    weight: 0.05,
  },
  {
    key: "Planning",
    labelKey: "research-helper-summarize-stage",
    weight: 0.15,
  },
  {
    key: "CacheProbe",
    labelKey: "research-helper-summarize-stage",
    weight: 0.05,
  },
  {
    key: "Estimating",
    labelKey: "research-helper-summarize-stage",
    weight: 0.05,
  },
  {
    key: "AwaitingConfirm",
    labelKey: "research-helper-summarize-stage",
    weight: 0,
  },
  {
    key: "Summarizing",
    labelKey: "research-helper-summarize-stage",
    weight: 0.65,
  },
  {
    key: "WritingNotes",
    labelKey: "research-helper-summarize-stage",
    weight: 0.05,
  },
]);

/** The schema version of {@link SummarizeInput} as stored in a job record. */
export const SUMMARIZE_INPUT_VERSION = 1;

/**
 * `docs/06` §13.5's outage rule: "above 30 % failures stop with one message"
 * (`P3-T29` Do NOT). The share of settled items that failed.
 */
export const OUTAGE_FAILURE_SHARE = 0.3;

/**
 * The rule needs a sample: it is judged only once this many items have
 * settled, so two failures among the first three do not stop a 200-item run
 * (`docs/07` §12.3's note of 2026-10-29, item 10; the card's reading).
 */
export const OUTAGE_MIN_SETTLED = 10;

/**
 * `Pipeline.estimate`'s rough dispatch rate per `llm` permit, for its
 * duration figure only: one summary call every ten seconds.
 */
export const CALLS_PER_MINUTE_PER_PERMIT = 6;

// ===========================================================================
// 2. Input, output and the run's view
// ===========================================================================

/**
 * What a summarize job is asked to do. Plain data: it is stored in the record.
 *
 * Decided 2026-10-29 (owner, `plan/00` §6 item 303(a); `docs/07` §12.3's note
 * of that date): a run takes a collection, an item list, or both. With a list
 * and no collection it reads exactly the listed regular items and works on no
 * collection — the global privacy mode (for the item pane's run, the
 * strictest of it and the item's collections' overrides, which its job
 * context carries: item 305(a)), no "don't ask again" record; with both,
 * the collection's items are narrowed to the list. {@link SUMMARIZE_INPUT_VERSION}
 * stays 1: both members are optional.
 */
export interface SummarizeInput {
  readonly libraryID: number;
  /** The collection; absent for a run over {@link SummarizeInput.itemKeys} only. */
  readonly collectionKey?: string | undefined;
  /** Only these items (Zotero keys in `libraryID`): the item pane's one-item run. */
  readonly itemKeys?: readonly string[] | undefined;
  /** FR-19's "Re-summarize existing"; off by default. */
  readonly resummarize: boolean;
  /** `report.perPaperNotes` for this run (opt-in; `docs/07` §8.5). */
  readonly writeNotes: boolean;
  /**
   * The item pane's Regenerate (owner, `plan/00` §6 item 305(c); `docs/07`
   * §12.3's note of 2026-10-29): the listed items' stored row and cache entry
   * are not served, so each is priced, confirmed and summarized by a real
   * call whose answer replaces both. Honoured only by
   * {@link bypassesStoredResult} — a run over an item list, with no
   * collection and `resummarize` on; `validate` reports it anywhere else.
   */
  readonly bypassCache?: boolean | undefined;
}

/** The end-of-job counts (`P3-T29` step 7) and the rest the window shows. */
export interface SummarizeCounts {
  /** Stored with `abstract+fulltext`: "full text used". */
  readonly fullText: number;
  /** Stored from the abstract alone: "fell back to abstract". */
  readonly abstractOnly: number;
  /** Tier 4 or DR-1's metadata choice: "skipped: no text" (FR-21). */
  readonly noText: number;
  /** `screenItems`: "skipped: retracted". */
  readonly retracted: number;
  /** `screenItems`: "skipped: duplicate". */
  readonly duplicate: number;
  /** `screening.nonEnglishPolicy` = `skip`. */
  readonly language: number;
  /** Already summarized and not re-summarized (FR-19). */
  readonly existing: number;
  /** Summaries served by the cache: no call. */
  readonly cached: number;
  /** Summaries that cost at least one call. */
  readonly fresh: number;
  readonly failed: number;
  readonly notesWritten: number;
  /** Notes that could not be written; the summary is kept. */
  readonly notesFailed: number;
}

/** One paper's row in the window (`docs/08` §6.4's ✓ ⟳ ⚠ ·). */
export type SummarizeRowStatus =
  | "queued"
  | "running"
  | "done"
  | "cached"
  | "failed"
  | "skipped-existing"
  | "skipped-no-text"
  | "skipped-retracted"
  | "skipped-duplicate"
  | "skipped-language";

export interface SummarizeRow {
  readonly itemKey: string;
  readonly title: string;
  readonly status: SummarizeRowStatus;
}

/** Where the run is. */
export type SummarizeStage =
  | "loading"
  | "planning"
  | "estimating"
  | "confirming"
  | "waiting"
  | "summarizing"
  | "writing"
  | "done";

/** Everything the window draws, as of now. */
export interface SummarizeRunView {
  readonly stage: SummarizeStage;
  readonly collectionName: string;
  /** Regular items in the collection. */
  readonly total: number;
  /** Items to summarize in this run. */
  readonly toSummarize: number;
  /** Of those, settled (done, cached or failed). */
  readonly settled: number;
  readonly rows: readonly SummarizeRow[];
  readonly counts: SummarizeCounts;
  /** Notes can be written: the library is editable. */
  readonly notesWritable: boolean;
}

/** How a run ended. */
export type SummarizeOutcome =
  "succeeded" | "cancelled" | "declined" | "stopped-outage" | "failed";

/** What a run returns. */
export interface SummarizeOutput {
  readonly outcome: SummarizeOutcome;
  readonly view: SummarizeRunView;
  /** "cancelled at 87/200": the 1-based position, when cancelled mid-run. */
  readonly stoppedAt: number | undefined;
  /** Requests sent, repairs and retries included. */
  readonly calls: number;
  /** Every stored summary of the run's items: for the read-only export. */
  readonly summaries: readonly SummaryRef[];
  /** The error that failed the run, as stored. */
  readonly error?: SerializedError;
}

/** One stored summary, for the export. */
export interface SummaryRef {
  readonly itemKey: string;
  readonly title: string;
  readonly storedId: string;
  readonly sourceName: string | undefined;
}

// ===========================================================================
// 3. Ports
// ===========================================================================

/** One regular item of the collection, as the Zotero port reads it. */
export interface SummarizeLibraryItem {
  readonly itemID: number;
  readonly itemKey: string;
  readonly libraryID: number;
  /** `docs/07` §5.1's work key (`fromZoteroItem`). */
  readonly workKey: string;
  readonly metadata: SummaryItemMetadata;
  /** Zotero's `dateModified` (`StoredSummary.sourceItemVersion`). */
  readonly dateModified: string | undefined;
  /** `screenItems`' view of it; the language is added from the text. */
  readonly screen: Omit<ScreenItem, "language">;
}

/** The collection as the Zotero port reads it. */
export interface SummarizeCollection {
  readonly name: string;
  /** `Zotero.Libraries.get(id).editable` (`P3-T29` step 8). */
  readonly editable: boolean;
  readonly items: readonly SummarizeLibraryItem[];
}

/** One item's acquisition, with what `AcquiredSource` does not carry. */
export interface AcquiredItem {
  readonly source: AcquiredSource;
  /** D-06-3's page counts, for a page-capped text (`P3-T25` finding 1). */
  readonly pageCounts?: SourcePageCounts | undefined;
  /** FR-21's "<attachment name>". */
  readonly sourceName?: string | undefined;
}

/** The Zotero side: `createZoteroSummarizeLibrary` in the product. */
export interface SummarizeLibrary {
  /** @throws when the key names no collection */
  loadCollection(
    libraryID: number,
    collectionKey: string,
  ): Promise<SummarizeCollection>;
  /**
   * The listed regular items not in the trash, in the order given; a key that
   * names no such item is left out (item 303(a)). `name` is `""`.
   */
  loadItems(
    libraryID: number,
    itemKeys: readonly string[],
  ): Promise<SummarizeCollection>;
  acquire(
    item: SummarizeLibraryItem,
    options: {
      readonly includeFullText: boolean;
      readonly token: CancellationToken;
    },
  ): Promise<AcquiredItem>;
  /** The item's summary note, by stored key then by tag (item 296(b)). */
  findSummaryNote(
    item: SummarizeLibraryItem,
    storedNoteKey: string | undefined,
  ): Promise<string | undefined>;
  /** Write the child note; resolves to its key. */
  writeSummaryNote(
    item: SummarizeLibraryItem,
    stored: StoredSummary,
    sourceName: string | undefined,
  ): Promise<string>;
}

/** The pre-run confirmation the surface is asked for. */
export interface SummarizeConfirmRequest {
  readonly estimate: RunEstimate;
  readonly disclosure: EgressDisclosure;
  readonly ceilingSelected: CeilingStop | undefined;
  readonly ceilingDowngrade: CeilingStop | undefined;
  /**
   * The run's collection, whose "don't ask again" record applies; `undefined`
   * for a run over no collection, which has no record (item 303(a)).
   */
  readonly collection: CollectionRef | undefined;
  readonly session: SpendTotals;
}

/** The surface's answer: run a plan, or nothing. */
export type SummarizeConfirmAnswer =
  | {
      readonly kind: "run";
      readonly plan: "selected" | "abstract-only";
      readonly raise:
        | { readonly ceiling: CeilingKind; readonly limitUsd: number }
        | undefined;
    }
  | { readonly kind: "cancelled" };

/** A paused job's question. */
export type SummarizeQuestion =
  | {
      readonly reason: "credential-required";
      readonly providerId: ProviderId;
    }
  | {
      readonly reason: "budget-stop";
      readonly stop: CeilingStop;
      readonly remainingUsd: number | undefined;
      readonly raiseToUsd: number;
      readonly usage: {
        readonly run: SpendTotals;
        readonly session: SpendTotals;
      };
    }
  | {
      readonly reason: Exclude<
        PauseReason,
        "credential-required" | "budget-stop"
      >;
      readonly done: number;
      readonly total: number;
      /** The wall-clock budget in minutes. */
      readonly minutes: number;
    };

/** The window, as the run sees it. */
export interface SummarizeSurface {
  /** The run's state changed. Must not throw. */
  update(view: SummarizeRunView): void;
  /** `P3-T16`'s confirmation. A rejection runs nothing. */
  confirm(request: SummarizeConfirmRequest): Promise<SummarizeConfirmAnswer>;
  /** A paused job asks: continue, or stop. A rejection stops. */
  ask(question: SummarizeQuestion): Promise<"resume" | "cancel">;
  /**
   * An item failed, with the error its call ended in (item 303(a): the item
   * pane shows that message). Called once per failed item. Must not throw.
   */
  itemFailed?(itemKey: string, error: unknown): void;
}

/** A surface for a run nobody watches: it confirms nothing, so nothing spends. */
export const HEADLESS_SUMMARIZE_SURFACE: SummarizeSurface = Object.freeze({
  update: () => undefined,
  confirm: () => Promise.resolve({ kind: "cancelled" } as const),
  ask: () => Promise.resolve("cancel" as const),
});

/** The queue's pause notices, routed to the run that owns the job. */
export interface JobPauseNotices {
  /** Call `handler` when `jobId` pauses; returns the unsubscribe. */
  onPause(jobId: string, handler: (record: JobRecord) => void): () => void;
}

/** What {@link createSummarizePipeline} is built from. */
export interface SummarizePipelineDeps {
  readonly library: SummarizeLibrary;
  /** `installPluginDatabase`'s store; `undefined` until the database is open. */
  readonly store: () => Promise<
    Pick<SummaryStore, "put" | "get" | "listForWork"> | undefined
  >;
  /** `PROMPT_REGISTRY`, loaded lazily (`src/prompts/bundled.ts` imports `.md`). */
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
  /** The graph's one price source (item 278(b)). */
  readonly prices: (
    providerId: ProviderId,
    modelId: string,
  ) => ModelPrices | undefined;
  /** For the disclosure's effective host. */
  readonly baseUrls: Pick<BaseUrlResolver, "effectiveHost">;
  /** The adapter's `ModelInfo`: context window and data policy. */
  readonly modelInfo?: (
    providerId: ProviderId,
    modelId: string,
  ) => ModelInfo | undefined;
  /**
   * Whether the active provider's key is stored (`docs/09` §1.7). Absent:
   * assumed present, and the router refuses a keyless call with zero
   * requests anyway.
   */
  readonly credentials?: { hasKey(providerId: ProviderId): Promise<boolean> };
  /** A run with a record and no window (`Pipeline.run`): headless by default. */
  readonly surfaces?: (jobId: string) => SummarizeSurface | undefined;
  /** The batch wall-clock budget; `WALL_CLOCK_BUDGET_DEFAULT_MS` by default. */
  readonly wallClockBudgetMs?: number;
}

// ===========================================================================
// 4. The notice router (the queue's JobNotifier; plan/00 §6 items 250, 265)
// ===========================================================================

/** {@link createJobNoticeRouter}'s answer. */
export interface JobNoticeRouter extends JobPauseNotices {
  /** Pass to `createJobQueue`. */
  readonly notifier: JobNotifier;
  /**
   * Install the visible "jobs resumed" notice (`research-helper-job-resumed`).
   * Until one is installed, `resumed` rejects, and the queue resumes nothing.
   */
  setResumedNotice(
    show: ((records: readonly JobRecord[]) => Promise<void>) | undefined,
  ): void;
}

/**
 * The `JobNotifier` the queue is built with (`P3-T29`; owner, 2026-10-21,
 * `plan/00` §6 item 251). A pause goes to the run that registered for its
 * job, **once** (the queue notifies once per pause), without awaiting it: the
 * run's question waits for the user, and `JobQueue.pause` must not.
 */
export function createJobNoticeRouter(): JobNoticeRouter {
  const handlers = new Map<string, (record: JobRecord) => void>();
  let resumedNotice:
    ((records: readonly JobRecord[]) => Promise<void>) | undefined;
  return {
    notifier: {
      paused(record: JobRecord): void {
        const handler = handlers.get(record.id);
        if (handler === undefined) return;
        try {
          handler(record);
        } catch {
          // A handler that throws loses its question, not the pause.
        }
      },
      resumed(records: readonly JobRecord[]): Promise<void> {
        if (resumedNotice === undefined) {
          return Promise.reject(
            new Error(
              "[research-helper] no surface shows the resumed-jobs notice",
            ),
          );
        }
        return resumedNotice(records);
      },
    },
    onPause(jobId, handler): () => void {
      handlers.set(jobId, handler);
      return () => {
        if (handlers.get(jobId) === handler) handlers.delete(jobId);
      };
    },
    setResumedNotice(show): void {
      resumedNotice = show;
    },
  };
}

// ===========================================================================
// 5. Pure helpers
// ===========================================================================

/**
 * `docs/07` §7.5's exclusivity key: one summarize job per collection, and
 * one per item list for a run over no collection (item 303(a)):
 * `summarize:<libraryID>/items:<the keys, sorted, comma-joined>`.
 */
export function summarizeExclusivityKey(
  input: Pick<SummarizeInput, "libraryID" | "collectionKey" | "itemKeys">,
): string {
  const library = String(input.libraryID);
  if (input.collectionKey !== undefined) {
    return `summarize:${library}/${input.collectionKey}`;
  }
  const keys = [...(input.itemKeys ?? [])].sort().join(",");
  return `summarize:${library}/items:${keys}`;
}

/**
 * Whether this run bypasses the stored result (owner, `plan/00` §6 item
 * 305(c)): `bypassCache` on a run over an item list, with no collection and
 * `resummarize` on — the item pane's Regenerate, and nothing else. The one
 * place the member is read, so a collection run, a Retry or a Generate keeps
 * the cache rule whatever its input carries.
 */
export function bypassesStoredResult(
  input: Pick<
    SummarizeInput,
    "bypassCache" | "collectionKey" | "itemKeys" | "resummarize"
  >,
): boolean {
  return (
    input.bypassCache === true &&
    input.collectionKey === undefined &&
    input.itemKeys !== undefined &&
    input.resummarize
  );
}

/** The run's collection, when it has one. */
function collectionOf(input: SummarizeInput): CollectionRef | undefined {
  return input.collectionKey === undefined
    ? undefined
    : { libraryID: input.libraryID, collectionKey: input.collectionKey };
}

/**
 * `LoadingItems` (item 303(a)): the collection's items, narrowed to the list
 * when there is one; or the listed items alone, for a run over no collection.
 */
async function loadRunItems(
  library: SummarizeLibrary,
  input: SummarizeInput,
): Promise<SummarizeCollection> {
  if (input.collectionKey === undefined) {
    if (input.itemKeys === undefined) {
      throw new ConfigurationError(
        "a summarize run needs a collection or an item list; nothing was sent",
      );
    }
    return library.loadItems(input.libraryID, input.itemKeys);
  }
  const collection = await library.loadCollection(
    input.libraryID,
    input.collectionKey,
  );
  if (input.itemKeys === undefined) return collection;
  const wanted = new Set(input.itemKeys);
  return {
    ...collection,
    items: collection.items.filter((item) => wanted.has(item.itemKey)),
  };
}

/** Whether a budget guard is the job's own `RunBudgetGuard`. */
export function isRunBudgetGuard(guard: BudgetGuard): guard is RunBudgetGuard {
  const candidate = guard as Partial<RunBudgetGuard>;
  return (
    typeof candidate.check === "function" &&
    typeof candidate.raiseLimit === "function" &&
    typeof candidate.usage === "function"
  );
}

/** Whether the outage rule stops the run now (`docs/06` §13.5). */
export function isOutage(settled: number, failed: number): boolean {
  return (
    settled >= OUTAGE_MIN_SETTLED && failed / settled > OUTAGE_FAILURE_SHARE
  );
}

/** An error as the record stores it. */
export function serializeFailure(error: unknown): SerializedError {
  if (error instanceof ResearchHelperError) return error.toSerialized();
  return {
    code: "UNKNOWN",
    messageKey: "rh-error-configuration",
    detail: error instanceof Error ? error.name : typeof error,
    retryable: false,
  };
}

/** The prompt a scope's single-shot call uses. */
function promptForScope(scope: InputScopeKind): PromptId {
  return scope === "abstract+fulltext"
    ? "PAPER_SUMMARY_FULLTEXT"
    : "PAPER_SUMMARY_ABSTRACT";
}

/**
 * `estimateRun`'s per-call overhead, measured from the templates rendered
 * with the paper's text empty (`P3-T16`'s rule) and the run's longest
 * metadata in every metadata slot, so the estimate never under-states it.
 */
export function measureOverhead(
  prompts: Pick<PromptRegistry, "get">,
  items: readonly Pick<SummarizeLibraryItem, "metadata">[],
  count: (text: string) => number,
): PromptOverheadTokens {
  let longest = "";
  for (const { metadata } of items) {
    const text = [
      metadata.title,
      metadata.authors.join("; "),
      String(metadata.year ?? ""),
      metadata.venue ?? "",
      metadata.itemType ?? "",
      metadata.doi ?? "",
      metadata.tags.join(", "),
    ].join(" ");
    if (text.length > longest.length) longest = text;
  }
  const metadataTokens = count(longest);
  const of = (id: PromptId): number => {
    const template: PromptTemplate = prompts.get(id);
    const vars: Record<string, string> = {};
    for (const name of template.variables) {
      vars[name] =
        name === "JSON_SCHEMA" && template.schema !== null
          ? JSON.stringify(template.schema)
          : "";
    }
    const rendered = renderPrompt(template, vars);
    return count(rendered.system) + count(rendered.user) + metadataTokens;
  };
  return {
    PAPER_SUMMARY_ABSTRACT: of("PAPER_SUMMARY_ABSTRACT"),
    PAPER_SUMMARY_FULLTEXT: of("PAPER_SUMMARY_FULLTEXT"),
    CHUNK_MAP: of("CHUNK_MAP"),
    CHUNK_REDUCE: of("CHUNK_REDUCE"),
  };
}

const ZERO_COUNTS: SummarizeCounts = Object.freeze({
  fullText: 0,
  abstractOnly: 0,
  noText: 0,
  retracted: 0,
  duplicate: 0,
  language: 0,
  existing: 0,
  cached: 0,
  fresh: 0,
  failed: 0,
  notesWritten: 0,
  notesFailed: 0,
});

/** The row status a screening decision that keeps an item out gives it. */
function screenedOutStatus(decision: ScreenDecision): SummarizeRowStatus {
  if (decision.reason === "retracted") return "skipped-retracted";
  if (decision.duplicateOf !== undefined) return "skipped-duplicate";
  return "skipped-language";
}

// ===========================================================================
// 6. The pipeline
// ===========================================================================

/** One item the run will summarize. */
interface PlannedItem {
  readonly item: SummarizeLibraryItem;
  readonly acquired: AcquiredItem;
  readonly scope: InputScopeKind;
  readonly decision: ScreenDecision | undefined;
  readonly cached: boolean;
  /** A note this item already has (re-summarize keeps it). */
  readonly existingNote: string | undefined;
}

/** A skipped item with a row and no note, when notes are on. */
interface NoteFromStore {
  readonly item: SummarizeLibraryItem;
  readonly stored: StoredSummary;
}

/** What {@link SummarizePipeline.prepare} hands to `execute`. */
export interface PreparedSummarizeRun {
  readonly input: SummarizeInput;
  /** `run`: confirmed (or nothing to confirm); `declined`: nothing is sent. */
  readonly status: "run" | "declined";
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly fullTextMode: FullTextMode;
  readonly costGateBlocksFullText: boolean;
  readonly raise:
    { readonly ceiling: CeilingKind; readonly limitUsd: number } | undefined;
  /** The confirmed disclosure, for the record's egress log. */
  readonly disclosure: EgressDisclosure | undefined;
  readonly estimate: RunEstimate | undefined;
  /** Exactly what `execute` starts from; not for the caller to change. */
  readonly state: PreparedState;
}

/** The run's working state, carried from `prepare` to `execute`. */
export interface PreparedState {
  readonly collectionName: string;
  readonly notesWritable: boolean;
  readonly writeNotes: boolean;
  readonly total: number;
  readonly planned: readonly PlannedItem[];
  readonly fromStore: readonly NoteFromStore[];
  readonly rows: ReadonlyMap<string, SummarizeRow>;
  readonly counts: SummarizeCounts;
  readonly summaries: readonly SummaryRef[];
}

/** The summarize pipeline: `docs/07` §4.5's contract, plus its two halves. */
export interface SummarizePipeline extends Pipeline<
  SummarizeInput,
  SummarizeOutput
> {
  /**
   * `LoadingItems` → `AwaitingConfirm`, in a context with no record. Sends
   * nothing to a model. `confirm: false` skips the question (`estimate`).
   */
  prepare(
    input: SummarizeInput,
    ctx: PipelineContext,
    surface: SummarizeSurface,
    options?: { readonly confirm?: boolean },
  ): Promise<PreparedSummarizeRun>;
  /** The key check, `Summarizing` and `WritingNotes`, in the record's context. */
  execute(
    prepared: PreparedSummarizeRun,
    ctx: PipelineContext,
    surface: SummarizeSurface,
  ): Promise<SummarizeOutput>;
}

/**
 * Build the pipeline. `buildPipelineSet` calls this once.
 *
 * @param deps - see {@link SummarizePipelineDeps}
 */
export function createSummarizePipeline(
  deps: SummarizePipelineDeps,
): SummarizePipeline {
  const requireStore = async (): Promise<
    Pick<SummaryStore, "put" | "get" | "listForWork">
  > => {
    const store = await deps.store();
    if (store === undefined) {
      throw new ConfigurationError(
        "the plugin database is not available, so no summary can be stored; " +
          "nothing was sent",
      );
    }
    return store;
  };

  const prepare: SummarizePipeline["prepare"] = async (
    input,
    ctx,
    surface,
    options = {},
  ) => {
    const store = await requireStore();
    const rows = new Map<string, SummarizeRow>();
    const counts: { -readonly [K in keyof SummarizeCounts]: number } = {
      ...ZERO_COUNTS,
    };
    let stage: SummarizeStage = "loading";
    let collectionName = "";
    let total = 0;
    let notesWritable = false;
    let toSummarize = 0;
    const show = (): void => {
      surface.update({
        stage,
        collectionName,
        total,
        toSummarize,
        settled: 0,
        rows: [...rows.values()],
        counts: { ...counts },
        notesWritable,
      });
    };
    const setRow = (
      item: SummarizeLibraryItem,
      status: SummarizeRowStatus,
    ): void => {
      rows.set(item.itemKey, {
        itemKey: item.itemKey,
        title: item.metadata.title,
        status,
      });
    };

    // LoadingItems.
    show();
    ctx.token.throwIfCancelled();
    const collection = await loadRunItems(deps.library, input);
    collectionName = collection.name;
    total = collection.items.length;
    notesWritable = collection.editable;
    const writeNotes = input.writeNotes && collection.editable;
    for (const item of collection.items) setRow(item, "queued");
    await ctx.checkpoint({ version: 1, stage: "LoadingItems" });

    // Planning: skip what is summarized, acquire the rest.
    stage = "planning";
    show();
    const prompts = await deps.prompts();
    const model = ctx.llm.resolveModel("standard");
    const fullTextPref = ctx.config.get("summaryFullTextMode") as FullTextMode;
    const allowed = ctx.privacy.allowedInputScope(ctx.privacy.mode, {
      fullTextMode: fullTextPref,
    });
    const summaries: SummaryRef[] = [];
    const fromStore: NoteFromStore[] = [];
    const candidates: {
      item: SummarizeLibraryItem;
      acquired: AcquiredItem;
      existingNote: string | undefined;
    }[] = [];
    for (const item of collection.items) {
      ctx.token.throwIfCancelled();
      const existing = await store.listForWork(item.workKey);
      const newest = existing[0];
      const note = await deps.library.findSummaryNote(
        item,
        newest?.zoteroNoteKey,
      );
      if (!input.resummarize && (newest !== undefined || note !== undefined)) {
        counts.existing += 1;
        setRow(item, "skipped-existing");
        if (newest !== undefined) {
          summaries.push({
            itemKey: item.itemKey,
            title: item.metadata.title,
            storedId: newest.id,
            sourceName: undefined,
          });
          if (writeNotes && note === undefined) {
            fromStore.push({ item, stored: newest });
          }
        }
        continue;
      }
      const acquired = await deps.library.acquire(item, {
        includeFullText: allowed.fullTextMode !== "never",
        token: ctx.token,
      });
      candidates.push({ item, acquired, existingNote: note });
    }

    // Screening (`P3-T27`): over every item, so duplicates are collection-wide.
    const acquiredByKey = new Map(
      candidates.map((c) => [c.item.itemKey, c.acquired.source]),
    );
    const report = screenItems(
      collection.items.map((item): ScreenItem => {
        const source = acquiredByKey.get(item.itemKey);
        const text = source === undefined ? "" : source.text;
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

    // Input scope under the privacy policy, and the cache probe.
    stage = "estimating";
    const bypass = bypassesStoredResult(input);
    const planned: PlannedItem[] = [];
    for (const candidate of candidates) {
      const decision = decisions.get(candidate.item.itemKey);
      if (decision !== undefined && !decision.summarize) {
        if (decision.reason === "retracted") counts.retracted += 1;
        else if (decision.duplicateOf !== undefined) counts.duplicate += 1;
        else counts.language += 1;
        setRow(candidate.item, screenedOutStatus(decision));
        continue;
      }
      const scope = planInputScopeKind(allowed, candidate.acquired.source);
      if (scope === "metadata-only") {
        counts.noText += 1;
        setRow(candidate.item, "skipped-no-text");
        continue;
      }
      const promptVersion = prompts.versions[promptForScope(scope)];
      const row = await store.get(
        `${candidate.item.workKey}:${promptVersion}:${model.modelId}`,
      );
      // Regenerate's bypass (item 305(c)): nothing stored is served, so the
      // call is priced and confirmed.
      const cached =
        !bypass &&
        row !== undefined &&
        row.contentHash === candidate.acquired.source.contentHash;
      planned.push({
        item: candidate.item,
        acquired: candidate.acquired,
        scope,
        decision,
        cached,
        existingNote: candidate.existingNote,
      });
    }
    toSummarize = planned.length;
    show();
    await ctx.checkpoint({ version: 1, stage: "Estimating" });

    const base = {
      input,
      providerId: model.providerId,
      modelId: model.modelId,
      fullTextMode: allowed.fullTextMode,
    };
    const state = (): PreparedState => ({
      collectionName,
      notesWritable,
      writeNotes,
      total,
      planned,
      fromStore,
      rows,
      counts: { ...counts },
      summaries,
    });
    if (planned.length === 0) {
      return {
        ...base,
        status: "run",
        costGateBlocksFullText: false,
        raise: undefined,
        disclosure: undefined,
        estimate: undefined,
        state: state(),
      };
    }

    // Estimating (`P3-T16`; followup-299 finding 1: sections and window).
    const info = deps.modelInfo?.(model.providerId, model.modelId);
    const count = (text: string): number => estTokens(text, model.modelId);
    const estimate = estimateRun({
      items: planned.map((p): EstimateItem => ({
        workKey: p.item.workKey,
        source: {
          tier: p.acquired.source.tier,
          abstract: p.acquired.source.abstract,
          text: p.acquired.source.text,
          itemKey: p.acquired.source.itemKey,
          sectionAware: p.acquired.source.sectionAware,
          sections: p.acquired.source.sections,
        },
        cached: p.cached,
      })),
      fullTextMode: allowed.fullTextMode,
      modelId: model.modelId,
      prices: deps.prices(model.providerId, model.modelId),
      overhead: measureOverhead(
        prompts,
        planned.map((p) => p.item),
        count,
      ),
      fullTextAutoMaxPapers: ctx.config.get("summaryFullTextAutoMaxPapers"),
      atEpochMs: ctx.clock.now(),
      countTokens: count,
      ...(info?.contextWindowTokens !== undefined && {
        contextWindowTokens: info.contextWindowTokens,
      }),
    });
    const disclosure = buildEgressDisclosure(
      {
        providerId: model.providerId,
        modelId: model.modelId,
        privacyMode: ctx.privacy.mode,
        items: planned.map((p) => p.scope),
      },
      { baseUrls: deps.baseUrls },
    );
    if (options.confirm === false) {
      return {
        ...base,
        status: "declined",
        costGateBlocksFullText: false,
        raise: undefined,
        disclosure,
        estimate,
        state: state(),
      };
    }

    // AwaitingConfirm: the surface decides whether the dialog opens.
    stage = "confirming";
    show();
    const guard = isRunBudgetGuard(ctx.budget) ? ctx.budget : undefined;
    const stopFor = (costUsd: number | undefined): CeilingStop | undefined => {
      if (guard === undefined) return undefined;
      const check = guard.check(costUsd ?? 0);
      return check.ok ? undefined : check.stop;
    };
    let answer: SummarizeConfirmAnswer;
    try {
      answer = await surface.confirm({
        estimate,
        disclosure,
        ceilingSelected: stopFor(estimate.selected.costUsd),
        ceilingDowngrade: stopFor(estimate.abstractOnly.costUsd),
        collection: collectionOf(input),
        session: guard?.usage().session ?? ZERO_SPEND,
      });
    } catch (error) {
      ctx.logger.warn("the cost confirmation failed; nothing is sent", {
        reason: error instanceof Error ? error.name : typeof error,
      });
      answer = { kind: "cancelled" };
    }
    if (answer.kind !== "run") {
      stage = "done";
      show();
      return {
        ...base,
        status: "declined",
        costGateBlocksFullText: false,
        raise: undefined,
        disclosure,
        estimate,
        state: state(),
      };
    }
    const downgrade = answer.plan === "abstract-only";
    return {
      ...base,
      status: "run",
      // `docs/06` §5.4's note of 2026-10-28: the cost gate in `auto`; in
      // `always` a downgrade arrives as `never`.
      fullTextMode:
        downgrade && allowed.fullTextMode === "always"
          ? "never"
          : allowed.fullTextMode,
      costGateBlocksFullText: downgrade && allowed.fullTextMode === "auto",
      raise: answer.raise,
      disclosure,
      estimate,
      state: state(),
    };
  };

  const execute: SummarizePipeline["execute"] = async (
    prepared,
    ctx,
    surface,
  ) => {
    const jobId = ctx.jobId;
    const store = await requireStore();
    const { state } = prepared;
    const rows = new Map(state.rows);
    const counts: { -readonly [K in keyof SummarizeCounts]: number } = {
      ...state.counts,
    };
    const summaries = [...state.summaries];
    let stage: SummarizeStage = "summarizing";
    let settled = 0;
    let calls = 0;
    const planned = state.planned;
    const view = (): SummarizeRunView => ({
      stage,
      collectionName: state.collectionName,
      total: state.total,
      toSummarize: planned.length,
      settled,
      rows: [...rows.values()],
      counts: { ...counts },
      notesWritable: state.notesWritable,
    });
    const show = (): void => {
      surface.update(view());
    };
    const setStatus = (
      item: SummarizeLibraryItem,
      status: SummarizeRowStatus,
    ): void => {
      rows.set(item.itemKey, {
        itemKey: item.itemKey,
        title: item.metadata.title,
        status,
      });
    };
    const finishWith = (
      outcome: SummarizeOutcome,
      extra: { stoppedAt?: number | undefined; error?: SerializedError } = {},
    ): SummarizeOutput => {
      stage = "done";
      show();
      return {
        outcome,
        view: view(),
        stoppedAt: extra.stoppedAt,
        calls,
        summaries,
        ...(extra.error !== undefined && { error: extra.error }),
      };
    };

    if (prepared.status === "declined") {
      return finishWith("declined");
    }

    await deps.queue.start(jobId);
    const ticket = await deps.admission.admit(
      {
        id: jobId,
        priority: "normal",
        exclusivityKey: summarizeExclusivityKey(prepared.input),
      },
      ctx.token,
    );
    const unsubscribe: (() => void)[] = [];
    try {
      const guard = isRunBudgetGuard(ctx.budget) ? ctx.budget : undefined;
      if (prepared.raise !== undefined && guard !== undefined) {
        guard.raiseLimit(prepared.raise.ceiling, prepared.raise.limitUsd);
      }

      // Step 3: no key, no request — pause and ask (`docs/09` §1.7 tier 2).
      if (planned.length > 0 && deps.credentials !== undefined) {
        while (!(await deps.credentials.hasKey(prepared.providerId))) {
          stage = "waiting";
          show();
          await deps.queue.pause(jobId, "credential-required");
          ticket.suspend();
          let answer: "resume" | "cancel";
          try {
            answer = await surface.ask({
              reason: "credential-required",
              providerId: prepared.providerId,
            });
          } catch {
            answer = "cancel";
          }
          if (answer === "cancel" || ctx.token.isCancellationRequested) {
            await deps.queue.cancel(jobId);
            return finishWith("cancelled", { stoppedAt: 1 });
          }
          await ticket.reacquire(ctx.token);
          await deps.queue.resume(jobId);
        }
      }

      // WritingNotes for items that have a row and no note (no call).
      if (state.fromStore.length > 0) {
        stage = "writing";
        show();
        for (const { item, stored } of state.fromStore) {
          ctx.token.throwIfCancelled();
          try {
            const noteKey = await deps.library.writeSummaryNote(
              item,
              stored,
              undefined,
            );
            await store.put({ ...stored, zoteroNoteKey: noteKey });
            counts.notesWritten += 1;
          } catch (error) {
            counts.notesFailed += 1;
            ctx.logger.warn("a summary note could not be written", {
              reason: error instanceof Error ? error.name : typeof error,
            });
          }
        }
      }

      if (planned.length === 0) {
        await deps.queue.succeed(jobId);
        return finishWith("succeeded");
      }

      // Summarizing: one `summarizeItem` per item under the `llm` pool.
      stage = "summarizing";
      show();
      const prompts = await deps.prompts();
      const itemDeps: SummarizeItemDeps = summarizeItemDepsFrom(ctx, {
        prompts,
        store,
        ...(deps.modelInfo !== undefined && { modelInfo: deps.modelInfo }),
        // The run's confirmation covered the model: `prepare` returned "run"
        // only after the surface confirmed, or found nothing to confirm.
        modelConfirmed: true,
        // Flat until `P3-T22` and `G-22` rule (`plan/00` §6 item 300).
        imradDetectorValidated: false,
      });
      let lastStop: CeilingStop | undefined;
      let failed = 0;
      let outage = false;
      // Set once the run is built; read by the pause handler and the outage
      // stop, which are defined before it.
      const pooledRef: { current: PooledRun | undefined } = {
        current: undefined,
      };

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
              const remainingUsd = prepared.estimate?.selected.costUsd;
              const raiseToUsd = suggestedLimitUsd(lastStop, remainingUsd);
              raiseTo = { ceiling: lastStop.ceiling, limitUsd: raiseToUsd };
              answer = await surface.ask({
                reason: "budget-stop",
                stop: lastStop,
                remainingUsd,
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
                done: settled,
                total: planned.length,
                minutes: Math.round(
                  (deps.wallClockBudgetMs ?? WALL_CLOCK_BUDGET_DEFAULT_MS) /
                    60_000,
                ),
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
                // Already at or above it: continue as asked.
              }
            }
            stage = "summarizing";
            show();
            await run.resume();
          } else {
            await run.cancel({ kind: "user" });
          }
        })();
      };
      if (deps.pauseNotices !== undefined) {
        unsubscribe.push(deps.pauseNotices.onPause(jobId, onPaused));
      }

      const call = async (
        p: PlannedItem,
        token: CancellationToken,
      ): Promise<SummarizeItemResult> => {
        setStatus(p.item, "running");
        show();
        return summarizeItem(
          {
            source: p.acquired.source,
            workKey: p.item.workKey,
            metadata: p.item.metadata,
            fullTextMode: prepared.fullTextMode,
            costGateBlocksFullText: prepared.costGateBlocksFullText,
            pageCounts: p.acquired.pageCounts,
            sourceItemVersion: p.item.dateModified,
            // Regenerate's bypass (item 305(c)): no cache lookup, a real call.
            ...(bypassesStoredResult(prepared.input) && { bypassCache: true }),
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
      };

      const onResult = async (
        p: PlannedItem,
        result: SummarizeItemResult,
      ): Promise<void> => {
        settled += 1;
        if (result.kind === "stub") {
          counts.noText += 1;
          setStatus(p.item, "skipped-no-text");
          ctx.progress.setProgress(settled, planned.length);
          show();
          return;
        }
        calls += result.calls;
        let stored = result.stored;
        if (stored.inputScope.kind === "abstract+fulltext")
          counts.fullText += 1;
        else counts.abstractOnly += 1;
        if (result.fromCache) counts.cached += 1;
        else counts.fresh += 1;
        setStatus(p.item, result.fromCache ? "cached" : "done");
        if (state.writeNotes && p.existingNote === undefined) {
          // A note only for a stored summary, written after the row; a note
          // that fails never fails the summary.
          try {
            const noteKey = await deps.library.writeSummaryNote(
              p.item,
              stored,
              p.acquired.sourceName,
            );
            stored = await store.put({ ...stored, zoteroNoteKey: noteKey });
            counts.notesWritten += 1;
          } catch (error) {
            counts.notesFailed += 1;
            ctx.logger.warn("a summary note could not be written", {
              reason: error instanceof Error ? error.name : typeof error,
            });
          }
        }
        summaries.push({
          itemKey: p.item.itemKey,
          title: p.item.metadata.title,
          storedId: stored.id,
          sourceName: p.acquired.sourceName,
        });
        ctx.progress.setProgress(settled, planned.length);
        show();
      };

      const run = runPooledItems<PlannedItem, SummarizeItemResult>({
        jobId,
        items: planned,
        workKey: (p) => p.item.workKey,
        // Skipping what is stored happened in `prepare`; a cache hit inside
        // `summarizeItem` still makes no call.
        isDone: () => Promise.resolve(false),
        call: async (p, token) => {
          try {
            return await call(p, token);
          } catch (error) {
            // The runner's own reading of the error, mirrored: a cancel, a
            // budget refusal and a rejected key leave the item pending;
            // anything else fails it (`runPooledItems`).
            const pending =
              token.isCancellationRequested ||
              ceilingStopOf(error) !== undefined ||
              error instanceof AuthenticationError;
            if (pending) {
              setStatus(p.item, "queued");
              show();
            } else {
              settled += 1;
              failed += 1;
              counts.failed += 1;
              setStatus(p.item, "failed");
              try {
                surface.itemFailed?.(p.item.itemKey, error);
              } catch {
                // A surface that throws loses the message, not the run.
              }
              ctx.progress.setProgress(settled, planned.length);
              show();
              if (!outage && isOutage(settled, failed)) {
                // One stop, one message (`docs/06` §13.5): no row per item.
                outage = true;
                ctx.logger.warn(
                  "more than 30 % of the papers failed; stopping",
                  {
                    settled,
                    failed,
                  },
                );
                void pooledRef.current?.cancel({ kind: "user" });
              }
            }
            throw error;
          }
        },
        onResult,
        pool: deps.pool,
        queue: deps.queue,
        clock: ctx.clock,
        logger: ctx.logger,
        token: ctx.token,
        checkpoint: {
          checkpoint: (checkpointState) => ctx.checkpoint(checkpointState),
        },
        ticket,
        ...(deps.runningWork !== undefined && {
          runningWork: deps.runningWork,
        }),
        ...(deps.wallClockBudgetMs !== undefined && {
          wallClockBudgetMs: deps.wallClockBudgetMs,
        }),
        budgetStopOf: (error) => {
          const stop = ceilingStopOf(error);
          if (stop !== undefined) lastStop = stop;
          return stop;
        },
      });
      pooledRef.current = run;
      unsubscribe.push(
        ctx.token.onCancelled(() => {
          void run.cancel({ kind: "user" });
        }),
      );
      const outcome = await run.result;

      if (outcome.stop === "cancelled") {
        const record = await deps.queue.get(jobId);
        if (record?.status === "running" || record?.status === "paused") {
          await deps.queue.cancel(jobId);
        }
        const after = await deps.queue.get(jobId);
        if (after?.status === "cancelling")
          await deps.queue.finishCancel(jobId);
        return finishWith(outage ? "stopped-outage" : "cancelled", {
          stoppedAt: outcome.stoppedAt,
        });
      }
      await deps.queue.succeed(jobId);
      return finishWith("succeeded");
    } catch (error) {
      if (ctx.token.isCancellationRequested) {
        const record = await deps.queue.get(jobId).catch(() => undefined);
        if (
          record !== undefined &&
          (record.status === "running" ||
            record.status === "paused" ||
            record.status === "queued")
        ) {
          await deps.queue.cancel(jobId).catch(() => undefined);
        }
        const after = await deps.queue.get(jobId).catch(() => undefined);
        if (after?.status === "cancelling") {
          await deps.queue.finishCancel(jobId).catch(() => undefined);
        }
        return finishWith("cancelled", { stoppedAt: settled + 1 });
      }
      const serialized = serializeFailure(error);
      await deps.queue.fail(jobId, serialized).catch(() => undefined);
      ctx.logger.error("the summarize run failed", { code: serialized.code });
      return finishWith("failed", { error: serialized });
    } finally {
      for (const stop of unsubscribe) stop();
      ticket.release();
    }
  };

  const validate = (input: SummarizeInput): ValidationResult => {
    const errors: { field: string; messageKey: string }[] = [];
    if (!Number.isInteger(input.libraryID) || input.libraryID < 1) {
      errors.push({ field: "libraryID", messageKey: "rh-error-configuration" });
    }
    // A collection, an item list, or both (item 303(a)); each, when given,
    // must name something.
    const hasCollection = input.collectionKey !== undefined;
    const hasItems = input.itemKeys !== undefined;
    if (
      (hasCollection &&
        (typeof input.collectionKey !== "string" ||
          input.collectionKey === "")) ||
      (!hasCollection && !hasItems)
    ) {
      errors.push({
        field: "collectionKey",
        messageKey: "rh-error-configuration",
      });
    }
    if (
      hasItems &&
      (!Array.isArray(input.itemKeys) ||
        input.itemKeys.length === 0 ||
        input.itemKeys.some((key) => typeof key !== "string" || key === ""))
    ) {
      errors.push({ field: "itemKeys", messageKey: "rh-error-configuration" });
    }
    // Regenerate's bypass belongs to an item run only (item 305(c)).
    if (
      input.bypassCache !== undefined &&
      input.bypassCache !== false &&
      !bypassesStoredResult(input)
    ) {
      errors.push({
        field: "bypassCache",
        messageKey: "rh-error-configuration",
      });
    }
    return { ok: errors.length === 0, errors };
  };

  return {
    id: "summarize",
    displayNameKey: SUMMARIZE_DISPLAY_NAME_KEY,
    stages: SUMMARIZE_STAGES,
    // Nothing runs a queued job without its window yet, so an interrupted run
    // is not resumed after a restart; re-running it skips what is stored
    // (`docs/07` §12.3's note of 2026-10-29, item 13; FR-23).
    resumable: false,
    validate,
    async estimate(input, ctx): Promise<PipelineEstimate> {
      const prepared = await prepare(input, ctx, HEADLESS_SUMMARIZE_SURFACE, {
        confirm: false,
      });
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
    async run(input, ctx): Promise<SummarizeOutput> {
      const surface = deps.surfaces?.(ctx.jobId) ?? HEADLESS_SUMMARIZE_SURFACE;
      const prepared = await prepare(input, ctx, surface);
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
  };
}
