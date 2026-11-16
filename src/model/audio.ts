/**
 * The audio-report types — `docs/07` §5.2's `// src/model/audio.ts` block
 * (`plan/09` `P6-T01`).
 *
 * **Scope.** Transcribed from `docs/07-architecture-and-data-model.md` §5.2,
 * which `plan/README.md` §5 rule 3 makes the sole authority for types; the
 * block's dated note of 2026-11-16 says why each shape exists. They are what
 * the audio job (`docs/07` §12.6) passes between its stages: the spoken script
 * the script pass returns, the plan the second confirmation shows, the job's
 * input and its outcome.
 *
 * Callers: `src/pipeline/audioReport/*` (`plan/09` `P6-T07`–`P6-T16`) and
 * `src/ui/viewModels/reportViewModel.ts` (`P6-T17`). `src/tts/types.ts`
 * re-exports {@link AudioChunk} so the provider layer has one import.
 *
 * Types only: nothing here is constructed, and `model/` imports nothing but
 * `model/` (`docs/07` §2.3).
 */

import type { Usage } from "./usage";

// ---------------------------------------------------------------------------
// The spoken script — `docs/04` §8, `docs/12` §13–§14
// ---------------------------------------------------------------------------

/**
 * The languages a spoken script is written in: the keys of
 * `TrendReport.audioScripts` and `TrendReport.audioAttachmentKeys`
 * (`src/model/trend.ts`).
 */
export type AudioLanguage = "en" | "ko";

/**
 * What a spoken script's length is counted in: English words, Korean Hangul
 * syllables (U+AC00–U+D7A3). `docs/12` §13 and §14 state the targets as
 * `TARGET_MINUTES × 150` words and `TARGET_MINUTES × ~330` syllables; the
 * English word band is never applied to Korean (`plan/09` `P6-T08`).
 */
export type SpokenScriptLengthUnit = "words" | "hangul-syllables";

/** A script's measured length against its target. */
export interface SpokenScriptLength {
  readonly unit: SpokenScriptLengthUnit;
  /** Counted in `unit` over the validated text. */
  readonly count: number;
  /** `TARGET_MINUTES` × the language's rate, in `unit`. */
  readonly target: number;
}

/**
 * A warning the script pass attaches to a script it accepts. Never a reject:
 * only marker leaks reject a script (`plan/09` §0.4 line 17); a warning is
 * shown in the second confirmation.
 */
export interface SpokenScriptWarning {
  /** Outside ±30 % of the target length. */
  readonly kind: "length-out-of-band";
  readonly length: SpokenScriptLength;
}

/**
 * A validated spoken script (`docs/04` §8.1, §8.5): plain speakable text with
 * no Markdown, citation marker, URL or DOI left in it.
 *
 * `TrendReport.audioScripts[language]` stores its `text` once it has passed
 * validation, through `ReportStore.put`; a stored script for that language is
 * read back into this shape (with `usage` absent) and skips the script call.
 */
export interface SpokenScript {
  /** The stored `TrendReport.id` it was written from. */
  readonly reportId: string;
  /** The language the script is spoken in. */
  readonly language: AudioLanguage;
  /**
   * The language of the report it was written from. `"en"` with `language`
   * `"ko"` is a Korean script newly written from an English report, in one
   * call (owner, `plan/00` §6 item 378(a)).
   */
  readonly sourceLanguage: AudioLanguage;
  readonly text: string;
  /** The `TARGET_MINUTES` the prompt was given: 1–60, never 0. */
  readonly targetMinutes: number;
  readonly length: SpokenScriptLength;
  readonly warnings: readonly SpokenScriptWarning[];
  /** The script call's usage, the retry included; absent for a stored script. */
  readonly usage: Usage | undefined;
}

// ---------------------------------------------------------------------------
// The audio plan — `docs/04` §5, §6.4, §10.2, §11
// ---------------------------------------------------------------------------

/**
 * Imported into Zotero's storage (at most `IMPORT_MAX_BYTES`, 10 MiB) or
 * linked from `tts.linkedFileDir` above it (`chooseAttachmentMode` in
 * `src/tts/audioStore.ts`; `plan/09` §0.4 line 6). The same two values as
 * `src/tts/audioStore.ts`'s `AttachmentMode`, so a chosen mode passes through
 * unconverted (`docs/07` §5.2's note of 2026-11-16, reading 3).
 */
export type AudioAttachmentMode = "imported" | "linked";

/**
 * One piece of the script, sent as one TTS request (`docs/04` §5.2). Joining
 * every chunk's `text` with its `separator` reproduces the script exactly.
 */
export interface AudioChunk {
  /** 0-based position in the script. */
  readonly index: number;
  readonly text: string;
  /** `text.length`, in UTF-16 code units, as `docs/04` §5.2 measures. */
  readonly chars: number;
  /** What followed this chunk in the script (`""` after the last). */
  readonly separator: string;
}

/**
 * A cost estimate in US dollars. `usd` absent means **unknown cost**: no
 * documented or user price for the model, which forces the confirmation
 * (`plan/09` §0.4 line 21).
 */
export interface AudioCostEstimate {
  readonly usd: number | undefined;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /**
   * `false` when the audio token rate used was measured on another model
   * (`docs/04` §4.2 measured it on one model only, `P0-T25`'s); the
   * dialog then says so and shows no per-minute quote. *(Reworded 2026-11-16,
   * `plan/09` `P6-T05`: this comment named that model's id, and `src/` may
   * name a TTS model id on one marked fallback line only.)*
   */
  readonly rateMeasuredOnModel: boolean;
}

/**
 * Everything the second confirmation shows before any request reaches
 * Google (FR-42; `plan/09` §0.4 line 13), built from the real script.
 * Voice, model and style prefix are captured once here and sent unchanged with
 * every chunk, a retried one included (`docs/04` §5.3).
 */
export interface AudioPlan {
  readonly reportId: string;
  readonly language: AudioLanguage;
  readonly model: string;
  readonly voice: string;
  /** `docs/04` §5.3's `STYLE_PREFIX`, prepended to every chunk. */
  readonly stylePrefix: string;
  readonly chunks: readonly AudioChunk[];
  /** The sum of the chunks' `chars`. */
  readonly totalChars: number;
  readonly estimatedSeconds: number;
  /** The WAV file's size: PCM bytes plus the 44-byte header. */
  readonly estimatedBytes: number;
  readonly mode: AudioAttachmentMode;
  readonly cost: AudioCostEstimate;
}

// ---------------------------------------------------------------------------
// The job — `docs/07` §12.6
// ---------------------------------------------------------------------------

/**
 * What an `audioReport` job is started with: a stored report, by id
 * (`plan/09` §0.4 line 12), and the choices made in the report window's audio
 * section.
 */
export interface AudioRunInput {
  /** `TrendReport.id`, read through `ReportStore.get`. */
  readonly reportId: string;
  /**
   * The window's language choice; `"auto"` resolves from `tts.language` and
   * then the report's `language` (`plan/09` §0.4 line 10).
   */
  readonly language: AudioLanguage | "auto";
  /** The window's voice choice; absent reads `tts.voice`. */
  readonly voice?: string;
}

/**
 * A finished audio job. `TrendReport.audioAttachmentKeys[language]` is set to
 * `attachmentKey` through `ReportStore.put`, so it names the newest one.
 */
export interface AudioRunOutcome {
  readonly reportId: string;
  readonly language: AudioLanguage;
  /** The standalone attachment in the report's collection (`docs/07` §6.5). */
  readonly attachmentKey: string;
  readonly mode: AudioAttachmentMode;
  /** `audioFileName`'s result: a name, never a path. */
  readonly fileName: string;
  /** Measured from the assembled PCM. */
  readonly seconds: number;
  /** The written file's size. */
  readonly bytes: number;
  /** The TTS calls' usage, summed over every chunk. */
  readonly usage: Usage | undefined;
  /** The script call's usage; absent when a stored script was used. */
  readonly scriptUsage: Usage | undefined;
}
