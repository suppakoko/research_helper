/**
 * The audio run's failure paths — `plan/09` `P6-T14`: every way an audio run
 * can fail ends in a specific message, the written report untouched, and an
 * offer — the spoken script saved as text (FR-43), or, when only the Zotero
 * write failed, the audio itself saved with "Save as…" (FR-40).
 *
 * **Callers.** `audioReportPipeline.ts` (`P6-T16`, not built) calls
 * {@link classifyAudioFailure} on whatever stopped a run and
 * {@link withAudioScript} before the first TTS request; the report window's
 * session commands in `src/bootstrap/registerUI.ts` (`P6-T17`) call
 * {@link saveScriptAsText} and {@link saveAudioAs} with the path the save
 * dialog returned. Constructed nowhere: functions only. The text writer is
 * `reportFileWriter` (`src/zotero/notes.ts`); the byte writer is the audio
 * store's `AudioFileSystem` (`src/tts/audioStore.ts`).
 *
 * **Authority.** `docs/10` FR-40 (second scenario), FR-43; `docs/04` §7.5's
 * note of 2026-11-16 (no second provider in v1.0; owner, `plan/00` §6 item
 * 378(c)); `docs/07` §10.1 and its note of 2026-11-17 (`TTSError`'s
 * reasons); `docs/09` §2.2 (a user-chosen path is never logged).
 *
 * ## Decisions (DECIDED 2026-11-17, coordinator, under `plan/00` §6 item 313)
 *
 * 1. **401, 403 and a bad key are all `unentitled`.** The card maps 401/403;
 *    `mapProviderError` gives Gemini's 400 `API_KEY_INVALID` the same class
 *    as a 401 (`AuthenticationError`), so it is read the same way. A 404 is
 *    `model-gone` whatever class carries it.
 * 2. **A rate limit is `rate-limited` only once the retries are spent**: the
 *    loop (`synthesize.ts`) retried it under `LLM_RETRY_BUDGET`, so a
 *    `RateLimitError` that reaches this function has outlived them.
 * 3. **What keeps its own class:** a quota, a budget pause, a timeout, a
 *    network error, a cancellation and anything not named above. A
 *    `TTSError` keeps its own reason; `unsupported-format` and
 *    `malformed-response` read `rh-error-tts`'s default variant.
 * 4. **The script is offered whenever one exists and no audio was made**,
 *    validated or not: `plan/09` §0.4 line 17 offers a rejected script's text
 *    too. Never after a cancellation, which the user chose.
 * 5. **The held audio is the PCM chunks, not a WAV copy.** They are in memory
 *    after synthesis anyway; {@link saveAudioAs} builds the WAV on the
 *    user's save. Dropping them is the window's Close (`P6-T17`).
 * 6. **The script file's first line is built from data only** — the report's
 *    title, the script's language tag and the report's date — so it needs no
 *    new string and reads the same in either UI language.
 * 7. **The suggested file name** is `<safe collection name> — spoken script
 *    <YYYY-MM-DD> (<lang>).txt`, from `safeBaseName`, dated like
 *    `reportExportFileName`.
 */

import {
  AuthenticationError,
  AuthorizationError,
  OperationCancelledError,
  RateLimitError,
  redact,
  ResearchHelperError,
  TTSError,
  type SerializedError,
  type TTSErrorReason,
} from "../../core/errors";
import type { Logger } from "../../core/logger";
import type { AudioLanguage, SpokenScript } from "../../model/audio";
import type { TrendReport } from "../../model/trend";
import {
  concatPcm,
  GEMINI_PCM_FORMAT,
  pcmToWav,
  type AudioFileSystem,
  type PcmChunk,
} from "../../tts/audioStore";
import type { ReportFileWriter } from "../../zotero/notes";
import { safeBaseName } from "../trendReport/exportMarkdown";
import type { ScriptRejected } from "./script";

// ---------------------------------------------------------------------------
// 1. Classification
// ---------------------------------------------------------------------------

/** The six reasons `P6-T14` gives their own message variant. */
export type AudioFailureReason = Extract<
  TTSErrorReason,
  | "unentitled"
  | "model-gone"
  | "no-audio"
  | "sample-rate"
  | "script-rejected"
  | "rate-limited"
>;

/** What the run had made when it stopped. */
export interface AudioFailureState {
  /** A script exists for the language: stored, validated, or rejected. */
  readonly scriptAvailable: boolean;
  /**
   * The audio was synthesized and assembled, and only the Zotero write
   * failed: FR-40's "Save as…" applies.
   */
  readonly audioAssembled: boolean;
}

/** {@link classifyAudioFailure}'s answer: what the window shows and offers. */
export interface AudioFailure {
  /** The `TTSError` reason, or `undefined` when the error kept its own class. */
  readonly reason: TTSErrorReason | undefined;
  /** The Fluent message to show: `rh-error-tts` or the error's own key. */
  readonly messageKey: string;
  /** `{ reason }` for `rh-error-tts`; the caller supplies any other key's. */
  readonly messageArgs: Readonly<Record<string, string>>;
  /** Redacted, with no stack (the DoD's third line: no stack trace shown). */
  readonly error: Omit<SerializedError, "stack">;
  readonly cancelled: boolean;
  /** FR-43: offer the spoken script as a text file. */
  readonly offerScriptText: boolean;
  /** FR-40: offer the assembled audio with "Save as…". */
  readonly offerAudioSaveAs: boolean;
}

function isScriptRejected(value: unknown): value is ScriptRejected {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "script-rejected"
  );
}

function httpStatusOf(error: unknown): number | undefined {
  if (!(error instanceof ResearchHelperError)) return undefined;
  const status = error.context.httpStatus;
  return typeof status === "number" ? status : undefined;
}

/** The `TTSError` an error becomes, or `undefined` when it keeps its class. */
function asTtsError(error: unknown): TTSError | undefined {
  if (error instanceof TTSError) return error;
  if (isScriptRejected(error)) {
    return new TTSError(
      "the spoken script still held written markup after one retry",
      {
        reason: "script-rejected",
        language: error.language,
        leaks: error.leaks.join(","),
      },
    );
  }
  const reasonFor = (): AudioFailureReason | undefined => {
    if (
      error instanceof AuthenticationError ||
      error instanceof AuthorizationError
    ) {
      return "unentitled";
    }
    if (error instanceof RateLimitError) return "rate-limited";
    if (httpStatusOf(error) === 404) return "model-gone";
    return undefined;
  };
  const reason = reasonFor();
  if (reason === undefined) return undefined;
  const status = httpStatusOf(error);
  return new TTSError(
    redact(error instanceof Error ? error.message : String(error)),
    { reason, ...(status !== undefined && { httpStatus: status }) },
    { cause: error },
  );
}

function withoutStack(
  serialized: SerializedError,
): Omit<SerializedError, "stack"> {
  const { stack: _stack, ...rest } = serialized;
  return rest;
}

/**
 * What a stopped audio run shows and offers (`plan/09` `P6-T14` step 1).
 *
 * @param error - what stopped the run: a thrown error, or `writeScript`'s
 *   `ScriptRejected` outcome
 * @param state - whether a script exists and whether the audio was assembled
 */
export function classifyAudioFailure(
  error: unknown,
  state: AudioFailureState,
): AudioFailure {
  const cancelled = error instanceof OperationCancelledError;
  const tts = asTtsError(error);
  let serialized: SerializedError;
  if (tts !== undefined) {
    serialized = tts.toSerialized();
  } else if (error instanceof ResearchHelperError) {
    serialized = error.toSerialized();
  } else {
    serialized = new TTSError(
      redact(error instanceof Error ? error.message : String(error)),
    ).toSerialized();
  }
  const reason = tts?.reason;
  const status = httpStatusOf(tts ?? error);
  return {
    reason,
    messageKey: serialized.messageKey,
    messageArgs:
      serialized.messageKey === "rh-error-tts"
        ? { reason: reason ?? "other" }
        : {},
    error: {
      ...withoutStack(serialized),
      ...(status !== undefined && { httpStatus: status }),
    },
    cancelled,
    offerScriptText: state.scriptAvailable && !cancelled,
    offerAudioSaveAs: state.audioAssembled && !cancelled,
  };
}

// ---------------------------------------------------------------------------
// 2. The script kept before any TTS request (step 4)
// ---------------------------------------------------------------------------

/**
 * `report` with `script` stored under its language, and nothing else
 * changed: the record `P6-T16` writes through `ReportStore.put` once the
 * script has passed validation and before the first TTS request, so a retry
 * or a save needs no second script call.
 */
export function withAudioScript(
  report: TrendReport,
  script: Pick<SpokenScript, "language" | "text">,
): TrendReport {
  return {
    ...report,
    audioScripts: { ...report.audioScripts, [script.language]: script.text },
  };
}

// ---------------------------------------------------------------------------
// 3. Save the script as text (FR-43) and the audio as a file (FR-40)
// ---------------------------------------------------------------------------

/** How a save ended; the path is in none of them. */
export type AudioSaveOutcome = "saved" | "no-path" | "failed";

/** The date a report is filed under: its generation day, UTC. */
function reportDate(generatedAtEpochMs: number): string {
  return new Date(generatedAtEpochMs).toISOString().slice(0, 10);
}

/**
 * The save dialog's suggested name for the script (decision 7).
 *
 * @param report - its collection's name and its generation time
 * @param language - the script's language
 */
export function scriptTextFileName(
  report: Pick<TrendReport, "collectionName" | "generatedAtEpochMs">,
  language: AudioLanguage,
): string {
  return `${safeBaseName(report.collectionName)} — spoken script ${reportDate(
    report.generatedAtEpochMs,
  )} (${language}).txt`;
}

/** The file's text: the header line (decision 6), a blank line, the script. */
export function scriptTextFileContent(
  report: Pick<TrendReport, "title" | "generatedAtEpochMs">,
  script: Pick<SpokenScript, "language" | "text">,
): string {
  const header = `${report.title} · ${script.language} · ${reportDate(
    report.generatedAtEpochMs,
  )}`;
  return `${header}\n\n${script.text.trim()}\n`;
}

/**
 * FR-43: write the spoken script to `path` as UTF-8 text. The path is used
 * once and never stored or logged, nor is an error's message, which can
 * quote it; the written report and its note are not touched.
 *
 * @param path - the save dialog's answer; `""` writes nothing
 * @returns which {@link AudioSaveOutcome} happened; never rejects
 */
export async function saveScriptAsText(
  path: string,
  report: Pick<TrendReport, "id" | "title" | "generatedAtEpochMs">,
  script: Pick<SpokenScript, "language" | "text">,
  deps: { readonly files: ReportFileWriter; readonly logger: Logger },
): Promise<AudioSaveOutcome> {
  const ctx = { reportId: report.id, language: script.language };
  if (path === "") {
    deps.logger.warn("spoken script save was asked for no destination", ctx);
    return "no-path";
  }
  try {
    await deps.files.writeTextFile(path, scriptTextFileContent(report, script));
  } catch {
    deps.logger.warn(
      "spoken script could not be written; the destination and the error are not logged",
      ctx,
    );
    return "failed";
  }
  deps.logger.info("spoken script saved as text", ctx);
  return "saved";
}

/**
 * FR-40's fallback: write the held audio (decision 5) to `path` as one WAV
 * file, chunks joined as the store joins them. The path is used once and
 * never stored or logged.
 *
 * @param path - the save dialog's answer; `""` writes nothing
 * @param audio - the run's chunks and their one sample rate
 * @returns which {@link AudioSaveOutcome} happened; never rejects
 */
export async function saveAudioAs(
  path: string,
  audio: {
    readonly chunks: readonly PcmChunk[];
    readonly sampleRateHz: number;
  },
  deps: {
    readonly files: Pick<AudioFileSystem, "writeFile">;
    readonly logger: Logger;
    readonly reportId: string;
  },
): Promise<AudioSaveOutcome> {
  const ctx = { reportId: deps.reportId };
  if (path === "") {
    deps.logger.warn("audio save was asked for no destination", ctx);
    return "no-path";
  }
  try {
    const format = { ...GEMINI_PCM_FORMAT, sampleRateHz: audio.sampleRateHz };
    await deps.files.writeFile(
      path,
      pcmToWav(concatPcm(audio.chunks, { format }), format),
    );
  } catch {
    deps.logger.warn(
      "audio could not be saved; the destination and the error are not logged",
      ctx,
    );
    return "failed";
  }
  deps.logger.info("audio saved with Save as", ctx);
  return "saved";
}
