/**
 * What a report run measures about itself: each answered call's counts and each
 * theme analysis's size, numbers only (`plan/07` `P4-T23` step 4's data source;
 * owner, `plan/00` §6 item 335(k); `docs/07` §5.2's note of 2026-11-02, which
 * holds the rules).
 *
 * **Callers.** `execute` in `trendReportPipeline.ts` calls all three functions
 * here: {@link createRunCallRecorder} once per run, its router going to every
 * stage; {@link themeAnalysisSize} once per analysed theme, and
 * {@link runMeasurementOf} for the run's first report. Nothing else constructs
 * these values.
 *
 * **What it never reads.** A request's `messages` and `traceId` (which holds an
 * item key on a summary call), and an answer's `text`, `json`, `raw` and
 * `servedBy`. An entry is built member by member from numbers, so no text can
 * ride along. Stage code keeps its own usage sums, whose meaning is unchanged.
 */

import { estTokens } from "../../llm/shared/tokenEstimate";
import type { ChatRequest, LLMRouter, Usage } from "../../llm/types";
import type {
  ReportCallUsage,
  ReportLanguage,
  ReportRunMeasurement,
  ThemeAnalysis,
  ThemeAnalysisSize,
} from "../../model/trend";

/** A call's `promptId` when its request carries no `accounting`. */
export const UNLABELLED_CALL = "UNLABELLED";

/** The run's one list of calls and the routers that write to it. */
export interface RunCallRecorder {
  /**
   * A router over the run's own that records each answered call.
   *
   * @param language - the report this router's calls write; absent on a stage
   *   every report of the run shares
   * @returns the recording router
   */
  llm(language?: ReportLanguage): LLMRouter;
  /** Every call answered so far, in the order the answers came. */
  calls(): readonly ReportCallUsage[];
}

/**
 * One call's entry, built member by member from what the record may hold. A
 * member the provider did not report stays absent, never 0.
 */
function entryOf(
  request: ChatRequest,
  usage: Usage | undefined,
  language: ReportLanguage | undefined,
): ReportCallUsage {
  const accounting = request.accounting;
  return {
    promptId: accounting?.promptId ?? UNLABELLED_CALL,
    ...(language !== undefined && { language }),
    ...(usage?.inputTokens !== undefined && {
      inputTokens: usage.inputTokens,
    }),
    ...(usage?.outputTokens !== undefined && {
      outputTokens: usage.outputTokens,
    }),
    ...(usage?.totalTokens !== undefined && {
      totalTokens: usage.totalTokens,
    }),
    ...(usage?.reasoningTokens !== undefined && {
      reasoningTokens: usage.reasoningTokens,
    }),
    ...(usage?.costUsd !== undefined && { costUsd: usage.costUsd }),
    ...(request.maxOutputTokens !== undefined && {
      maxOutputTokens: request.maxOutputTokens,
    }),
    ...(accounting?.papers !== undefined && { papers: accounting.papers }),
  };
}

/**
 * The run's recorder. Anything but a chat is the wrapped router's own, and an
 * answer reaches the stage exactly as it arrived. A call that throws has no
 * usage and leaves no entry.
 *
 * @param inner - the run's router
 * @returns the recorder
 */
export function createRunCallRecorder(inner: LLMRouter): RunCallRecorder {
  const calls: ReportCallUsage[] = [];
  return {
    llm(language) {
      return {
        activeProvider: () => inner.activeProvider(),
        resolveModel: (purpose) => inner.resolveModel(purpose),
        async chat(request, ctx) {
          const answer = await inner.chat(request, ctx);
          calls.push(entryOf(request, answer.usage, language));
          return answer;
        },
        async *chatStream(request, ctx) {
          for await (const chunk of inner.chatStream(request, ctx)) {
            if (chunk.done) calls.push(entryOf(request, chunk.usage, language));
            yield chunk;
          }
        },
      };
    },
    calls: () => [...calls],
  };
}

/**
 * One analysed theme's size, by the raw `estTokens` the composition measures
 * with (`docs/07` §12.4's grid): an estimate from the text, not a provider's
 * count.
 *
 * @param analysis - the theme's analysis
 * @param papers - the theme's members
 * @returns its size
 */
export function themeAnalysisSize(
  analysis: ThemeAnalysis,
  papers: number,
): ThemeAnalysisSize {
  return {
    tokens: estTokens(JSON.stringify(analysis)),
    narrativeTokens: estTokens(analysis.narrative),
    papers,
  };
}

/**
 * The run's measurement, for its first report's record.
 *
 * @param calls - {@link RunCallRecorder.calls}, after the run's last call
 * @param themeAnalyses - {@link themeAnalysisSize} of each analysed theme
 * @param resumed - whether the job was resumed after a restart
 * @returns the measurement
 */
export function runMeasurementOf(
  calls: readonly ReportCallUsage[],
  themeAnalyses: readonly ThemeAnalysisSize[],
  resumed: boolean,
): ReportRunMeasurement {
  return { calls, themeAnalyses, ...(resumed && { resumed: true }) };
}
