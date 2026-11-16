/**
 * The `audioReport` job (`plan/09` `P6-T16`; `docs/07` §12.6 and its note of
 * 2026-11-17): one spoken report against one stored `TrendReport` — check,
 * script (or the stored script), confirm, synthesize, assemble, attach,
 * record.
 *
 * Built as the report job is (`../trendReport/trendReportPipeline.ts`): a
 * `prepare` half in a context with no record, which makes no TTS request and
 * asks the first confirmation, and an `execute` half in the record's context.
 * The report window's session (`src/bootstrap/registerUI.ts`, `P6-T17`) is
 * the caller: it enqueues the record between the two with
 * {@link audioJobInput}, so the record carries the egress log before any
 * request (§12.6's note, point 1).
 *
 * The stages are the earlier cards': `writeScript` (`P6-T07`, `P6-T08`),
 * `estimateScriptStep` and `estimateAudioPlan` (`P6-T10`), `chunkScript`
 * (`P6-T09`), `synthesizeChunks` (`P6-T11`), `checkAudioDestination` and
 * `deliverAudio` (`P6-T12`, `P6-T13`), `classifyAudioFailure` and
 * `withAudioScript` (`P6-T14`), and the tier, fingerprint and notice of
 * `P6-T15`. Constructed once, in `buildPipelineSet`
 * (`src/bootstrap/registerPipelines.ts`).
 */

import { ConfigurationError, OperationCancelledError } from "../../core/errors";
import type { JobRecord, JobResultRef } from "../../core/jobQueue/jobRecord";
import type {
  JobAdmission,
  JobQueue,
  JobTicket,
  LlmPool,
} from "../../core/jobQueue/queue";
import { GEMINI_SECRET_ID } from "../../llm/gemini/geminiProvider";
import type { BaseUrlResolver } from "../../llm/shared/baseUrl";
import type { ModelPrices, UserPriceOverride } from "../../llm/shared/pricing";
import type { ModelInfo } from "../../llm/types";
import type {
  AudioLanguage,
  AudioPlan,
  AudioRunInput,
  AudioRunOutcome,
  SpokenScriptWarning,
} from "../../model/audio";
import type { ProviderId } from "../../model/ids";
import type { TrendReport } from "../../model/trend";
import type { Usage } from "../../model/usage";
import type { PromptRegistry } from "../../prompts";
import { chooseAttachmentMode, type PcmChunk } from "../../tts/audioStore";
import { chunkScript } from "../../tts/chunk";
import { ttsPricesFor } from "../../tts/pricing";
import type { TTSProvider, VoiceInfo } from "../../tts/types";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { ZoteroAudioAttachments } from "../../zotero/attachments";
import type { ReportStore } from "../../zotero/db";
import {
  ceilingStopOf,
  suggestedLimitUsd,
  ZERO_SPEND,
  type CeilingKind,
  type CeilingStop,
  type SpendTotals,
} from "../shared/budget";
import {
  egressLogEntry,
  readEgressLog,
  withEgressLog,
  type EgressDisclosure,
  type EgressLogEntry,
} from "../shared/egressDisclosure";
import { withHeadroom } from "../shared/estimate";
import { modelRouteFor, routingHints } from "../shared/privacyPolicy";
import {
  isRunBudgetGuard,
  type SummarizeQuestion,
} from "../summarize/summarizePipeline";
import type {
  Pipeline,
  PipelineContext,
  PipelineEstimate,
  StageDescriptor,
  ValidationResult,
} from "../types";
import { type CitationSource, citationMapFor } from "./citationMap";
import {
  checkAudioDestination,
  deliverAudio,
  type AudioDeliveryDeps,
  type AudioDeliveryRefusal,
} from "./deliver";
import {
  assertAudioAllowed,
  audioEgressNotice,
  audioKeyFingerprint,
  audioTierState,
  isAudioTierRefusal,
  knownAudioKeyFingerprints,
  recordTierAnswer,
  type AudioTierPrefs,
  type OfferedTierAnswer,
  type TierAnswerWriter,
} from "./disclosure";
import {
  chunkReservation,
  estimateAudioPlan,
  estimateScriptStep,
  type ScriptStepEstimate,
} from "./estimate";
import {
  classifyAudioFailure,
  withAudioScript,
  type AudioFailure,
} from "./failures";
import {
  buildScriptInputs,
  chooseScriptSource,
  reportTargetWordsOf,
  resolveAudioLanguage,
  resolveTargetMinutes,
  SCRIPT_PROMPT_IDS,
  writeScript,
} from "./script";
import {
  STYLE_PREFIX,
  synthesizeChunks,
  type SynthesizedChunk,
} from "./synthesize";

// ===========================================================================
// 1. Constants
// ===========================================================================

/**
 * `Pipeline.displayNameKey`: the collection menu entry's id ("Generate Audio
 * Report…", `P6-T17`, which adds its string).
 */
export const AUDIO_REPORT_DISPLAY_NAME_KEY =
  "research-helper-menu-collection-audio-report";

/** The stage keys, in run order (`docs/07` §12.6). */
export const AUDIO_REPORT_STAGE_KEYS = [
  "Scripting",
  "AwaitingConfirm",
  "Synthesizing",
  "Attaching",
] as const;

export type AudioReportStageKey = (typeof AUDIO_REPORT_STAGE_KEYS)[number];

const STAGE_WEIGHTS: Readonly<Record<AudioReportStageKey, number>> = {
  Scripting: 0.15,
  AwaitingConfirm: 0,
  Synthesizing: 0.8,
  Attaching: 0.05,
};

/** `docs/07` §12.6's stages; the label key is the menu entry's. */
export const AUDIO_REPORT_STAGES: readonly StageDescriptor[] = Object.freeze(
  AUDIO_REPORT_STAGE_KEYS.map((key) => ({
    key,
    labelKey: AUDIO_REPORT_DISPLAY_NAME_KEY,
    weight: STAGE_WEIGHTS[key],
  })),
);

/** The schema version of {@link AudioRunInput} as stored in a job record. */
export const AUDIO_REPORT_INPUT_VERSION = 1;

/** One audio job per report at a time (`docs/07` §7.5). */
export function audioReportExclusivityKey(
  input: Pick<AudioRunInput, "reportId">,
): string {
  return `audioReport:${input.reportId}`;
}

// ===========================================================================
// 2. The surface, the halves and the output
// ===========================================================================

/** Why `prepare` refused, before anything was sent (§12.6's note, point 2). */
export type AudioRefusalReason =
  "disabled" | "no-report" | "tier-refused" | "no-key" | AudioDeliveryRefusal;

/** Where the run is, for the window's one progress line. */
export interface AudioReportRunView {
  readonly stage: AudioReportStageKey | "checking" | "waiting" | "done";
  readonly language: AudioLanguage | undefined;
  /** "chunk n of N" during `Synthesizing`: `done` is n, 1-based. */
  readonly chunk: { readonly done: number; readonly total: number } | undefined;
}

/** What both confirmations carry (`buildAudioDialogModel`'s common input). */
interface AudioConfirmCommon {
  /** `audioEgressNotice`'s disclosure. */
  readonly disclosure: EgressDisclosure;
  /** The ceiling this step's estimate would pass, when it would not. */
  readonly ceiling: CeilingStop | undefined;
  readonly session: SpendTotals;
  /** `audioTierState(…).askTierQuestion`, read now. */
  readonly askTierQuestion: boolean;
  readonly pricesAsOfEpochMs: number | undefined;
}

/**
 * A confirmation: `buildAudioDialogModel`'s input without the two members
 * the session adds (the provider's display name and `confirmAboveCents`).
 */
export type AudioConfirmRequest =
  | (AudioConfirmCommon & {
      readonly step: "script";
      readonly estimate: ScriptStepEstimate;
      readonly targetMinutes: number;
    })
  | (AudioConfirmCommon & {
      readonly step: "audio";
      readonly plan: AudioPlan;
      readonly warnings: readonly SpokenScriptWarning[];
    });

/** The surface's answer to a confirmation. */
export type AudioConfirmAnswer =
  | {
      readonly kind: "run";
      readonly raise?:
        | { readonly ceiling: CeilingKind; readonly limitUsd: number }
        | undefined;
      /** Present only when the dialog asked the tier question. */
      readonly tierAnswer?: OfferedTierAnswer | undefined;
    }
  | { readonly kind: "cancelled" };

/** The report window's audio section, as the run sees it (`P6-T17`). */
export interface AudioReportSurface {
  /** The run's state changed. Must not throw. */
  update(view: AudioReportRunView): void;
  /** A confirmation; a rejection runs nothing. */
  confirm(request: AudioConfirmRequest): Promise<AudioConfirmAnswer>;
  /** A budget stop during synthesis: continue, or stop. A rejection stops. */
  ask(question: SummarizeQuestion): Promise<"resume" | "cancel">;
  /** The folder for a linked file; `undefined` when the user cancels. */
  pickFolder(): Promise<string | undefined>;
  /** FR-40's attachment title; `defaultAudioTitle` (English) when absent. */
  title?(language: AudioLanguage, isoDate: string): string;
}

/** A surface nobody watches: it confirms nothing and picks no folder. */
export const HEADLESS_AUDIO_REPORT_SURFACE: AudioReportSurface = Object.freeze({
  update: () => undefined,
  confirm: () => Promise.resolve({ kind: "cancelled" } as const),
  ask: () => Promise.resolve("cancel" as const),
  pickFolder: () => Promise.resolve(undefined),
});

/** What `prepare` resolved for a confirmed run. */
export interface AudioRunPlan {
  /** The stored report the job runs against; the script and key go on it. */
  readonly report: TrendReport;
  /** The run's other record, when the script's language is not the report's. */
  readonly companion: TrendReport | undefined;
  readonly language: AudioLanguage;
  readonly voice: string;
  readonly ttsModel: string;
  readonly ttsPrices: ModelPrices | undefined;
  /** `script`: no script is stored for the language, so one is written. */
  readonly step: "script" | "audio";
  /** The resolved `TARGET_MINUTES`, for the script call. */
  readonly targetMinutes: number;
  /** The confirmed plan, for a stored script. */
  readonly plan: AudioPlan | undefined;
  /** `checkAudioDestination`'s folder, for a linked file. */
  readonly linkedFolder: string | undefined;
  /** What the user confirmed: the record's egress log is built from it. */
  readonly disclosure: EgressDisclosure;
  /** `audioKeyFingerprint` of the key `prepare` read; never the key. */
  readonly keyFingerprint: string;
  readonly raise:
    { readonly ceiling: CeilingKind; readonly limitUsd: number } | undefined;
}

/** `prepare`'s answer. */
export type PreparedAudioReport =
  | {
      readonly status: "refused";
      readonly input: AudioRunInput;
      readonly refusal: AudioRefusalReason;
    }
  | {
      readonly status: "declined";
      readonly input: AudioRunInput;
      /** The figures, for `Pipeline.estimate` (`confirm: false`). */
      readonly estimate?: ScriptStepEstimate | AudioPlan;
    }
  | {
      readonly status: "run";
      readonly input: AudioRunInput;
      readonly run: AudioRunPlan;
    };

export type AudioReportOutcome =
  "succeeded" | "declined" | "refused" | "cancelled" | "failed" | "interrupted";

/** What the window needs to show the end and make FR-40's and FR-43's offers. */
export interface AudioReportOutput {
  readonly outcome: AudioReportOutcome;
  readonly view: AudioReportRunView;
  readonly language?: AudioLanguage;
  /** `prepare`'s refusal, or a destination that refused at delivery. */
  readonly refusal?: AudioRefusalReason;
  readonly delivered?: AudioRunOutcome;
  /** `classifyAudioFailure`'s answer, for a failed or cancelled run. */
  readonly failure?: AudioFailure;
  /** The script, validated or rejected: FR-43's "save as text". */
  readonly script?: { readonly language: AudioLanguage; readonly text: string };
  /** The assembled chunks, when only the Zotero write failed: FR-40. */
  readonly audio?: {
    readonly chunks: readonly PcmChunk[];
    readonly sampleRateHz: number;
  };
  /** The record as last stored (with the script, then the key). */
  readonly report?: TrendReport;
}

/**
 * The record's input: the run's input with the egress log of what the user
 * confirmed (`withEgressLog`), the first-use record `docs/09` §3.4 rule 5
 * reads back. The session enqueues with it (§12.6's note, point 1).
 *
 * @throws ConfigurationError for a run that was not confirmed
 */
export function audioJobInput(
  prepared: PreparedAudioReport,
  confirmedAtEpochMs: number,
): AudioRunInput & { readonly egress: EgressLogEntry } {
  if (prepared.status !== "run") {
    throw new ConfigurationError(
      "an audio job is enqueued only after its confirmation",
    );
  }
  return withEgressLog(
    prepared.input,
    egressLogEntry(prepared.run.disclosure, confirmedAtEpochMs),
  );
}

// ===========================================================================
// 3. Dependencies
// ===========================================================================

/** What the job needs from the composition root. */
export interface AudioReportPipelineDeps {
  /** The report store; `undefined` before the database is open. */
  readonly reports: () => Promise<
    Pick<ReportStore, "get" | "put" | "companionOf"> | undefined
  >;
  /** `AUDIO_SCRIPT_EN` and `AUDIO_SCRIPT_KO` come from it. */
  readonly prompts: () => Promise<Pick<PromptRegistry, "get">>;
  /** The queue, read through a getter in the graph. */
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
    | "list"
  >;
  /**
   * `LLMServices.tts`, built by `registerProviders` only. `listVoices` is the
   * report window's voice list (`P6-T17`), through {@link AudioReportPipeline.voices}.
   */
  readonly tts: Pick<TTSProvider, "resolveModel" | "synthesize" | "listVoices">;
  /**
   * The Gemini key (`GEMINI_SECRET_ID`), read once for the fingerprint;
   * never stored or logged.
   */
  readonly ttsKey: () => Promise<string | undefined>;
  /** The Zotero read behind the citation map. */
  readonly citations: CitationSource;
  /** The attachment writer of `P6-T13`; built lazily (it reads the data dir). */
  readonly attachments: () => ZoteroAudioAttachments;
  /** The script model's prices (`modelPrices.pricesFor`). */
  readonly prices: (
    providerId: ProviderId,
    modelId: string,
  ) => ModelPrices | undefined;
  /** The user's price overrides, for `ttsPricesFor`. */
  readonly priceOverrides: () => Promise<readonly UserPriceOverride[]>;
  readonly baseUrls: Pick<BaseUrlResolver, "effectiveHost">;
  readonly pool?: Pick<LlmPool, "acquire">;
  readonly admission?: JobAdmission;
  /** The adapters' model descriptions; absent: every policy is unknown. */
  readonly modelInfo?: (
    providerId: ProviderId,
    modelId: string,
  ) => ModelInfo | undefined;
  /** `privacy.egressAcknowledged`; the preference by default. */
  readonly egressAcknowledged?: () => boolean;
  /** The tier preferences; the preferences by default. */
  readonly tierPrefs?: AudioTierPrefs;
  readonly tierWriter?: TierAnswerWriter;
  /** `tts.linkedFileDir`; the preference by default. */
  readonly linkedFolder?: {
    readonly read: () => string;
    readonly write: (path: string) => void;
  };
  /** The window's surface for a job; absent: headless. */
  readonly surfaces?: (jobId: string) => AudioReportSurface | undefined;
}

/** The pipeline: `docs/07` §4.5's contract, plus its two halves. */
export interface AudioReportPipeline extends Pipeline<
  AudioRunInput,
  AudioReportOutput
> {
  /** Check and the first confirmation, with no record; no TTS request. */
  prepare(
    input: AudioRunInput,
    ctx: PipelineContext,
    surface: AudioReportSurface,
    options?: { readonly confirm?: boolean },
  ): Promise<PreparedAudioReport>;
  /** The rest, in the record's context. */
  execute(
    prepared: PreparedAudioReport,
    ctx: PipelineContext,
    surface: AudioReportSurface,
  ): Promise<AudioReportOutput>;
  /**
   * The voices for `language` (`TTSProvider.listVoices`), for the report
   * window's selector (`P6-T17`). On Gemini a fixed list: no request.
   */
  voices(
    language: AudioLanguage,
    token: CancellationToken,
  ): Promise<readonly VoiceInfo[]>;
}

// ===========================================================================
// 4. Helpers
// ===========================================================================

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

/** The pause was answered "stop": a cancel, so the script is kept. */
function stoppedAtPause(): OperationCancelledError {
  return new OperationCancelledError({ kind: "user" });
}

// ===========================================================================
// 5. The pipeline
// ===========================================================================

/**
 * Build the pipeline. `buildPipelineSet` calls this once.
 *
 * @param deps - see {@link AudioReportPipelineDeps}
 */
export function createAudioReportPipeline(
  deps: AudioReportPipelineDeps,
): AudioReportPipeline {
  const deliveryDeps = (
    ctx: PipelineContext,
    surface: AudioReportSurface,
  ): AudioDeliveryDeps => ({
    zotero: deps.attachments(),
    clock: ctx.clock,
    pickFolder: () => surface.pickFolder(),
    logger: ctx.logger,
    ...(deps.linkedFolder !== undefined && {
      readLinkedFolder: deps.linkedFolder.read,
      writeLinkedFolder: deps.linkedFolder.write,
    }),
    ...(surface.title !== undefined && {
      title: (language: AudioLanguage, isoDate: string) =>
        surface.title?.(language, isoDate) ?? "",
    }),
  });

  const knownFingerprints = async (): Promise<string[]> => {
    const records = await deps.queue.list().catch(() => []);
    return knownAudioKeyFingerprints(
      records.filter((r: JobRecord) => r.pipelineId === "audioReport"),
    );
  };

  const disclosureFor = async (
    ctx: PipelineContext,
    ttsModelId: string,
    scriptCall: { providerId: ProviderId; modelId: string } | undefined,
    keyFingerprint: string,
  ): Promise<EgressDisclosure> =>
    audioEgressNotice(
      {
        privacyMode: ctx.privacy.mode,
        ttsModelId,
        scriptCall,
        keyFingerprint,
        knownKeyFingerprints: await knownFingerprints(),
      },
      {
        baseUrls: deps.baseUrls,
        geminiPaidTier: () => audioTierState(deps.tierPrefs).tier === "paid",
        ...(deps.egressAcknowledged !== undefined && {
          egressAcknowledged: deps.egressAcknowledged,
        }),
      },
    );

  const stopFor =
    (ctx: PipelineContext) =>
    (costUsd: number | undefined): CeilingStop | undefined => {
      if (!isRunBudgetGuard(ctx.budget)) return undefined;
      const check = ctx.budget.check(costUsd ?? 0);
      return check.ok ? undefined : check.stop;
    };

  const sessionOf = (ctx: PipelineContext): SpendTotals =>
    isRunBudgetGuard(ctx.budget) ? ctx.budget.usage().session : ZERO_SPEND;

  /** Ask; a surface that throws is a "cancel". */
  const ask = async (
    surface: AudioReportSurface,
    request: AudioConfirmRequest,
    ctx: PipelineContext,
  ): Promise<AudioConfirmAnswer> => {
    try {
      return await surface.confirm(request);
    } catch (error) {
      ctx.logger.warn("the audio confirmation failed; nothing is sent", {
        reason: error instanceof Error ? error.name : typeof error,
      });
      return { kind: "cancelled" };
    }
  };

  const planFor = (
    reportId: string,
    language: AudioLanguage,
    text: string,
    ttsModel: string,
    voice: string,
    ttsPrices: ModelPrices | undefined,
    atEpochMs: number,
  ): AudioPlan =>
    estimateAudioPlan({
      reportId,
      script: { text, language },
      chunks: chunkScript(text, { language }),
      model: ttsModel,
      voice,
      stylePrefix: STYLE_PREFIX,
      prices: ttsPrices,
      atEpochMs,
    });

  const prepare: AudioReportPipeline["prepare"] = async (
    input,
    ctx,
    surface,
    options = {},
  ) => {
    const refused = (refusal: AudioRefusalReason): PreparedAudioReport => {
      ctx.logger.info("the audio run was refused before any request", {
        refusal,
      });
      return { status: "refused", input, refusal };
    };
    const show = (stage: AudioReportRunView["stage"]): void => {
      try {
        surface.update({ stage, language: undefined, chunk: undefined });
      } catch {
        // A surface that throws loses the view, not the run.
      }
    };
    show("checking");

    // (a)–(e): refused before any request (docs/07 §12.6's note, point 2).
    if (!ctx.config.get("audioEnabled")) return refused("disabled");
    const store = await deps.reports();
    const report =
      store === undefined ? undefined : await store.get(input.reportId);
    if (store === undefined || report === undefined) {
      return refused("no-report");
    }
    const delivery = deliveryDeps(ctx, surface);
    const library = await checkAudioDestination(
      {
        libraryID: report.libraryID,
        collectionKey: report.collectionKey,
        mode: "imported",
      },
      delivery,
    );
    if (library.kind === "refused") return refused(library.reason);
    try {
      assertAudioAllowed(ctx.privacy.mode, audioTierState(deps.tierPrefs).tier);
    } catch (error) {
      if (isAudioTierRefusal(error)) return refused("tier-refused");
      throw error;
    }
    const key = await deps.ttsKey();
    if (key === undefined || key === "") return refused("no-key");
    const keyFingerprint = audioKeyFingerprint(GEMINI_SECRET_ID, key);

    const preference = ctx.config.get("ttsLanguage");
    const language = resolveAudioLanguage(
      preference === "en" || preference === "ko" ? preference : "auto",
      report,
      input.language,
    );
    const voice = input.voice ?? ctx.config.get("ttsVoice");
    // Point 3: with `tts.model` empty this reads Gemini's model list.
    const ttsModel = await deps.tts.resolveModel(ctx.config.get("ttsModel"), {
      token: ctx.token,
    });
    const ttsPrices = ttsPricesFor(ttsModel, await deps.priceOverrides());
    const now = ctx.clock.now();
    const stored = report.audioScripts[language];
    const ceilingOf = stopFor(ctx);

    let request: AudioConfirmRequest;
    let companion: TrendReport | undefined;
    let plan: AudioPlan | undefined;
    let targetMinutes = 0;
    let estimatedBytes: number;
    let scriptStep: ScriptStepEstimate | undefined;
    if (stored === undefined || stored === "") {
      companion =
        report.language === language
          ? undefined
          : await store.companionOf(report);
      const source = chooseScriptSource(report, language, companion);
      targetMinutes = resolveTargetMinutes(
        ctx.config.get("ttsTargetMinutes"),
        reportTargetWordsOf(source, ctx.config.get("reportTargetWords")),
      );
      const scriptModel = ctx.llm.resolveModel("strong");
      // The script call sends the report: the mode must allow its model
      // before the first confirmation (point 2), as the report run's does.
      ctx.privacy.assertModelAllowed(
        deps.modelInfo?.(scriptModel.providerId, scriptModel.modelId) ??
          unknownPolicyModel(scriptModel.modelId),
        ctx.privacy.mode,
        modelRouteFor(
          scriptModel.providerId,
          () => audioTierState(deps.tierPrefs).tier === "paid",
        ),
      );
      const prompts = await deps.prompts();
      const map = await citationMapFor(
        source.libraryID,
        buildScriptInputs(source, targetMinutes, "").citedItemKeys,
        deps.citations,
        ctx.logger,
      );
      const scriptPrices = deps.prices(
        scriptModel.providerId,
        scriptModel.modelId,
      );
      scriptStep = estimateScriptStep({
        source,
        language,
        targetMinutes,
        prompt: prompts.get(SCRIPT_PROMPT_IDS[language]),
        citationMap: map.text,
        scriptModel: { modelId: scriptModel.modelId, prices: scriptPrices },
        ttsModel: { modelId: ttsModel, prices: ttsPrices },
        stylePrefix: STYLE_PREFIX,
        atEpochMs: now,
      });
      if (options.confirm === false) {
        return { status: "declined", input, estimate: scriptStep };
      }
      estimatedBytes = scriptStep.tts.estimatedBytes;
      request = {
        step: "script",
        estimate: scriptStep,
        targetMinutes,
        disclosure: await disclosureFor(
          ctx,
          ttsModel,
          {
            providerId: scriptModel.providerId,
            modelId: scriptModel.modelId,
          },
          keyFingerprint,
        ),
        ceiling: ceilingOf(scriptStep.costUsd),
        session: sessionOf(ctx),
        askTierQuestion: audioTierState(deps.tierPrefs).askTierQuestion,
        pricesAsOfEpochMs:
          scriptStep.script.pricesAsOfEpochMs ?? ttsPrices?.asOfEpochMs,
      };
    } else {
      plan = planFor(
        report.id,
        language,
        stored,
        ttsModel,
        voice,
        ttsPrices,
        now,
      );
      if (options.confirm === false) {
        return { status: "declined", input, estimate: plan };
      }
      estimatedBytes = plan.estimatedBytes;
      request = {
        step: "audio",
        plan,
        warnings: [],
        disclosure: await disclosureFor(
          ctx,
          ttsModel,
          undefined,
          keyFingerprint,
        ),
        ceiling: ceilingOf(plan.cost.usd),
        session: sessionOf(ctx),
        askTierQuestion: audioTierState(deps.tierPrefs).askTierQuestion,
        pricesAsOfEpochMs: ttsPrices?.asOfEpochMs,
      };
    }

    // Point 4: the size checks use the estimate with headroom.
    const destination = await checkAudioDestination(
      {
        libraryID: report.libraryID,
        collectionKey: report.collectionKey,
        mode: chooseAttachmentMode(withHeadroom(estimatedBytes)),
      },
      delivery,
    );
    if (destination.kind === "refused") return refused(destination.reason);

    show("AwaitingConfirm");
    const answer = await ask(surface, request, ctx);
    if (answer.kind !== "run") {
      show("done");
      return { status: "declined", input };
    }
    recordTierAnswer(answer.tierAnswer, deps.tierWriter);
    return {
      status: "run",
      input,
      run: {
        report,
        companion,
        language,
        voice,
        ttsModel,
        ttsPrices,
        step: request.step,
        targetMinutes,
        plan,
        linkedFolder: destination.linkedFolder,
        disclosure: request.disclosure,
        keyFingerprint,
        raise: answer.raise,
      },
    };
  };

  const execute: AudioReportPipeline["execute"] = async (
    prepared,
    ctx,
    surface,
  ) => {
    const { jobId } = ctx;
    let stage: AudioReportRunView["stage"] = "checking";
    let chunk: AudioReportRunView["chunk"];
    const language =
      prepared.status === "run" ? prepared.run.language : undefined;
    const view = (): AudioReportRunView => ({ stage, language, chunk });
    const show = (): void => {
      try {
        surface.update(view());
      } catch {
        // A surface that throws loses the view, not the run.
      }
    };
    const finish = (
      outcome: AudioReportOutcome,
      extra: Omit<AudioReportOutput, "outcome" | "view"> = {},
    ): AudioReportOutput => {
      stage = "done";
      show();
      return {
        outcome,
        view: view(),
        ...(language !== undefined && { language }),
        ...extra,
      };
    };

    if (prepared.status === "refused") {
      return finish("refused", { refusal: prepared.refusal });
    }
    if (prepared.status === "declined") return finish("declined");
    const { run } = prepared;

    const store = await deps.reports();
    if (store === undefined) {
      throw new ConfigurationError(
        "the report store is not open; nothing was sent",
      );
    }
    await deps.queue.start(jobId);
    const ticket: JobTicket | undefined = await deps.admission?.admit(
      {
        id: jobId,
        priority: "normal",
        exclusivityKey: audioReportExclusivityKey(prepared.input),
      },
      ctx.token,
    );
    const guard = isRunBudgetGuard(ctx.budget) ? ctx.budget : undefined;
    const raise = (
      to:
        | { readonly ceiling: CeilingKind; readonly limitUsd: number }
        | undefined,
    ): void => {
      if (to === undefined || guard === undefined) return;
      try {
        guard.raiseLimit(to.ceiling, to.limitUsd);
      } catch {
        // Already at or above it: continue as asked.
      }
    };

    // Point 1: no request without the record's audio egress log.
    let logChecked = false;
    const beforeSend = async (): Promise<void> => {
      if (logChecked) return;
      const record = await deps.queue.get(jobId);
      if (record === undefined || readEgressLog(record)?.audio === undefined) {
        throw new ConfigurationError(
          "the audio job's record carries no egress log; nothing was sent",
        );
      }
      logChecked = true;
    };

    let report = run.report;
    let script: { language: AudioLanguage; text: string } | undefined =
      run.step === "audio"
        ? {
            language: run.language,
            text: report.audioScripts[run.language] ?? "",
          }
        : undefined;
    let scriptUsage: Usage | undefined;
    let assembled:
      | {
          chunks: readonly SynthesizedChunk[];
          sampleRateHz: number;
          usage: Usage | undefined;
        }
      | undefined;

    const endJob = async (
      how: "cancelled" | "failed",
      failure?: AudioFailure,
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
          if (after?.status === "cancelling") {
            await deps.queue.finishCancel(jobId);
          }
          return;
        }
        if (record.status === "paused") await deps.queue.resume(jobId);
        if (failure !== undefined) await deps.queue.fail(jobId, failure.error);
      } catch {
        // The record keeps its last state; the run's answer is unchanged.
      }
    };

    try {
      raise(run.raise);
      let plan = run.plan;
      let linkedFolder = run.linkedFolder;

      if (run.step === "script") {
        stage = "Scripting";
        show();
        const prompts = await deps.prompts();
        const written = await writeScript(
          {
            report,
            ...(run.companion !== undefined && { companion: run.companion }),
            language: run.language,
            targetMinutes: run.targetMinutes,
          },
          {
            llm: ctx.llm,
            budget: ctx.budget,
            token: ctx.token,
            ...(deps.pool !== undefined && { pool: deps.pool }),
            prompts: {
              en: prompts.get(SCRIPT_PROMPT_IDS.en),
              ko: prompts.get(SCRIPT_PROMPT_IDS.ko),
            },
            citations: deps.citations,
            logger: ctx.logger,
            progress: ctx.progress,
            routing: routingHints(ctx.privacy.mode),
            beforeSend,
            traceId: jobId,
          },
        );
        if (written.kind === "script-rejected") {
          script = { language: run.language, text: written.text };
          throw written;
        }
        script = { language: run.language, text: written.script.text };
        scriptUsage = written.script.usage;
        // Kept before any TTS request (P6-T14 step 4).
        report = await store.put(withAudioScript(report, written.script));

        plan = planFor(
          report.id,
          run.language,
          written.script.text,
          run.ttsModel,
          run.voice,
          run.ttsPrices,
          ctx.clock.now(),
        );
        const delivery = deliveryDeps(ctx, surface);
        const destination = await checkAudioDestination(
          {
            libraryID: report.libraryID,
            collectionKey: report.collectionKey,
            mode: chooseAttachmentMode(withHeadroom(plan.estimatedBytes)),
          },
          delivery,
        );
        if (destination.kind === "refused") {
          await endJob("cancelled");
          return finish("refused", {
            refusal: destination.reason,
            script,
            report,
          });
        }
        linkedFolder = destination.linkedFolder;

        stage = "AwaitingConfirm";
        show();
        const answer = await ask(
          surface,
          {
            step: "audio",
            plan,
            warnings: written.script.warnings,
            disclosure: await disclosureFor(
              ctx,
              run.ttsModel,
              undefined,
              run.keyFingerprint,
            ),
            ceiling: stopFor(ctx)(plan.cost.usd),
            session: sessionOf(ctx),
            askTierQuestion: audioTierState(deps.tierPrefs).askTierQuestion,
            pricesAsOfEpochMs: run.ttsPrices?.asOfEpochMs,
          },
          ctx,
        );
        if (answer.kind !== "run") {
          await endJob("cancelled");
          return finish("cancelled", { script, report });
        }
        recordTierAnswer(answer.tierAnswer, deps.tierWriter);
        raise(answer.raise);
      }
      if (plan === undefined) {
        throw new ConfigurationError(
          "an audio run reached synthesis with no plan",
        );
      }

      stage = "Synthesizing";
      chunk = { done: 0, total: plan.chunks.length };
      show();
      let completed: readonly SynthesizedChunk[] = [];
      for (;;) {
        const result = await synthesizeChunks(
          { plan, completed, traceId: jobId },
          {
            tts: deps.tts,
            prices: run.ttsPrices,
            clock: ctx.clock,
            onChunk: (index, total) => {
              chunk = { done: index + 1, total };
              show();
            },
            logger: ctx.logger,
          },
          {
            token: ctx.token,
            budget: ctx.budget,
            progress: ctx.progress,
            beforeSend,
          },
        );
        if (result.kind === "done") {
          assembled = {
            chunks: result.chunks,
            sampleRateHz: result.sampleRateHz,
            usage: result.usage,
          };
          break;
        }
        const stop = ceilingStopOf(result.error);
        if (
          result.reason !== "budget" ||
          stop === undefined ||
          guard === undefined ||
          ctx.token.isCancellationRequested
        ) {
          throw result.error;
        }
        // Point 9: pause, ask, and re-send the pending chunk.
        const now = ctx.clock.now();
        let remainingUsd: number | undefined = 0;
        for (const pending of plan.chunks.slice(result.pendingIndex)) {
          const cost = chunkReservation(
            pending,
            plan,
            run.ttsPrices,
            now,
          ).costUsd;
          remainingUsd =
            cost === undefined || remainingUsd === undefined
              ? undefined
              : remainingUsd + cost;
        }
        const raiseToUsd = suggestedLimitUsd(stop, remainingUsd);
        const resumeStage: AudioReportRunView["stage"] = stage;
        stage = "waiting";
        show();
        await deps.queue.pause(jobId, "budget-stop");
        ticket?.suspend();
        let answer: "resume" | "cancel";
        try {
          answer = await surface.ask({
            reason: "budget-stop",
            stop,
            remainingUsd,
            raiseToUsd,
            usage: guard.usage(),
          });
        } catch {
          answer = "cancel";
        }
        if (answer === "cancel" || ctx.token.isCancellationRequested) {
          throw stoppedAtPause();
        }
        raise({ ceiling: stop.ceiling, limitUsd: raiseToUsd });
        await ticket?.reacquire(ctx.token);
        await deps.queue.resume(jobId);
        stage = resumeStage;
        show();
        completed = result.completed;
      }

      // Attaching: not cancelled once begun (docs/07 §12.6).
      stage = "Attaching";
      show();
      const delivered = await deliverAudio(
        {
          report,
          language: run.language,
          chunks: assembled.chunks,
          sampleRateHz: assembled.sampleRateHz,
          usage: assembled.usage,
          scriptUsage,
          ...(linkedFolder !== undefined && { linkedFolder }),
        },
        deliveryDeps(ctx, surface),
      );
      if (delivered.kind === "refused") {
        const failure = classifyAudioFailure(
          new ConfigurationError(
            `the audio could not be attached: ${delivered.reason}`,
          ),
          { scriptAvailable: true, audioAssembled: true },
        );
        await endJob("failed", failure);
        return finish("failed", {
          refusal: delivered.reason,
          failure,
          ...(script !== undefined && { script }),
          audio: assembled,
          report,
        });
      }
      const key = delivered.outcome.attachmentKey;
      report = await store.put({
        ...report,
        audioAttachmentKeys: {
          ...report.audioAttachmentKeys,
          [run.language]: key,
        },
      });
      const ref: JobResultRef = { kind: "report", key: report.id };
      await deps.queue.succeed(jobId, ref);
      return finish("succeeded", {
        delivered: delivered.outcome,
        ...(script !== undefined && { script }),
        report,
      });
    } catch (error) {
      if (ctx.token.reason?.kind === "shutdown") {
        // Left for recover(), which marks a non-resumable job failed (point 9).
        ctx.logger.info("the audio run was interrupted by shutdown", { stage });
        return finish("interrupted", {
          ...(script !== undefined && { script }),
          report,
        });
      }
      const failure = classifyAudioFailure(error, {
        scriptAvailable: script !== undefined,
        audioAssembled: assembled !== undefined,
      });
      const cancelled = failure.cancelled || ctx.token.isCancellationRequested;
      await endJob(cancelled ? "cancelled" : "failed", failure);
      if (!cancelled) {
        ctx.logger.error("the audio run failed", { code: failure.error.code });
      }
      return finish(cancelled ? "cancelled" : "failed", {
        failure,
        ...(script !== undefined && { script }),
        ...(assembled !== undefined && !cancelled && { audio: assembled }),
        report,
      });
    } finally {
      ticket?.release();
    }
  };

  const validate = (input: AudioRunInput): ValidationResult => {
    const errors: { field: string; messageKey: string }[] = [];
    if (typeof input.reportId !== "string" || input.reportId === "") {
      errors.push({ field: "reportId", messageKey: "rh-error-configuration" });
    }
    if (
      input.language !== "en" &&
      input.language !== "ko" &&
      input.language !== "auto"
    ) {
      errors.push({ field: "language", messageKey: "rh-error-configuration" });
    }
    if (
      input.voice !== undefined &&
      (typeof input.voice !== "string" || input.voice.trim() === "")
    ) {
      errors.push({ field: "voice", messageKey: "rh-error-configuration" });
    }
    return { ok: errors.length === 0, errors };
  };

  return {
    id: "audioReport",
    displayNameKey: AUDIO_REPORT_DISPLAY_NAME_KEY,
    stages: AUDIO_REPORT_STAGES,
    // docs/07 §12.6: no Interrupted → resume edge (plan/09 §0.4 line 14).
    resumable: false,
    validate,
    async estimate(input, ctx): Promise<PipelineEstimate> {
      const prepared = await prepare(
        input,
        ctx,
        HEADLESS_AUDIO_REPORT_SURFACE,
        { confirm: false },
      );
      const figures =
        prepared.status === "declined" ? prepared.estimate : undefined;
      const step =
        figures === undefined
          ? undefined
          : "script" in figures
            ? {
                calls: figures.calls,
                input: figures.script.inputTokens + figures.tts.inputTokens,
                output: figures.script.outputTokens + figures.tts.outputTokens,
                cost: figures.costUsd,
              }
            : {
                calls: figures.chunks.length,
                input: figures.cost.inputTokens,
                output: figures.cost.outputTokens,
                cost: figures.cost.usd,
              };
      return {
        itemCount: 1,
        externalRequests: step?.calls ?? 0,
        estimatedInputTokens: step?.input ?? 0,
        estimatedOutputTokens: step?.output ?? 0,
        estimatedCostUsd: step?.cost,
        // Not measured: P6-T19's acceptance run is the first timing.
        estimatedDurationSeconds: 0,
        notesKeys: [],
      };
    },
    async run(input, ctx): Promise<AudioReportOutput> {
      const surface =
        deps.surfaces?.(ctx.jobId) ?? HEADLESS_AUDIO_REPORT_SURFACE;
      const prepared = await prepare(input, ctx, surface);
      if (prepared.status !== "run") {
        const record = await deps.queue.get(ctx.jobId).catch(() => undefined);
        if (record !== undefined && record.status === "queued") {
          await deps.queue.cancel(ctx.jobId).catch(() => undefined);
        }
      }
      return execute(prepared, ctx, surface);
    },
    prepare,
    execute,
    voices: (language, token) => deps.tts.listVoices(language, { token }),
  };
}
