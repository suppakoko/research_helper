/**
 * The audio script pass — `plan/09` `P6-T07`: a stored trend report becomes a
 * spoken script in one call to the report model, validated in code, retried
 * once with the failures listed, and returned (never stored here).
 * `P6-T08` adds the language default ({@link resolveAudioLanguage}), the
 * source report ({@link chooseScriptSource}, {@link isSameRun}) and the
 * Korean length and numeral measures (`korean.ts`).
 *
 * **Caller.** `audioReportPipeline.ts` (`P6-T16`, not built) calls
 * {@link writeScript} when no script is stored for the language, then writes
 * the result to `TrendReport.audioScripts[language]` through `ReportStore.put`
 * (step 5). `P6-T10`'s `estimateScriptStep` reads {@link scriptOutputCeiling}
 * and {@link buildScriptInputs} so the estimate prices what is sent.
 * Constructed nowhere: functions and constants only. The prompts come from
 * `PROMPT_REGISTRY` (`src/prompts/bundled.ts`), the citation read from the
 * {@link CitationSource} port `P6-T16` builds in
 * `src/bootstrap/registerPipelines.ts`.
 *
 * **Authority.** `docs/04` §8.1 (what the rewrite does), §8.4 (the report
 * model, never the summary model), §8.5 (`LEAKS`, one retry), §12 item 1
 * (`targetMinutes = round(reportTargetWords / 300)`, clamped 1–60); `docs/12`
 * §13–§14 (the variables, the marker rejects, the ±30 % band, the notes of
 * 2026-11-17); `docs/09` §3 row 5's clarification of 2026-11-16 (what is sent).
 *
 * ## Decisions (DECIDED 2026-11-16, coordinator, under `plan/00` §6 item 313,
 * as `plan/09` §0.4 lines 15–17 and 23 record them)
 *
 * - **What is sent** (line 15): `{{REPORT_MARKDOWN}}` is the report's own
 *   sections, never the bibliography, the retracted list or an appendix;
 *   `{{COLLECTION_NAME}}` is the name the report already holds; the citation
 *   map is built from Zotero items. Nothing else leaves the machine.
 * - **The retry's correction list is English** for both languages (line 16).
 * - **Length is a warning, a marker leak a reject** (line 17).
 * - **The output ceiling** (line 23): `docs/12`'s 2 500 and 3 500 tokens are
 *   floors; above them the ceiling follows the target ({@link scriptOutputCeiling}).
 *
 * ## Readings taken here (DECIDED 2026-11-17, coordinator, under item 313)
 *
 * 1. **"The eleven sections" are §1–§10.** A stored report's §11 body is the
 *    numbered bibliography followed by the retracted list (`docs/06` §9.1, the
 *    `P4-T12` note), which line 15 keeps out; `draftForCritique`
 *    (`critique.ts`) already builds exactly §1–§10 under their headings, and
 *    is reused so the two calls read one shape.
 * 2. **The report's target length** for `tts.targetMinutes` `0` is
 *    `resolveTargetWords(report.targetWords, scope.analysedCount)`, the
 *    function the report run used (`docs/06` §9.2). The card names
 *    `targetWordsForOutput`, which converts an output ceiling into words; it
 *    is not the report's target, and the stored report does not record which
 *    ceiling its run had.
 * 3. **The union of `docs/04` §8.5's `LEAKS` and `docs/12` §13's rejects** is
 *    {@link SCRIPT_LEAKS}: where one list's test contains the other's
 *    (`|` against a table row, `**` against `**|__`), the wider one is kept,
 *    so each leak is named once. An empty answer is a leak too.
 * 4. **The retry appends the correction list to the user message**; the
 *    rejected answer is not quoted back (`compose.ts`'s rule: no text of the
 *    answer is copied into the regeneration's prompt).
 * 5. **A cut-off or filtered answer is not a script**: `finishReason`
 *    `length` throws `OutputTruncatedError` and `content_filter`
 *    `ContentFilterError`, neither retried, as for every other call.
 * 6. **The privacy and tier checks are the pipeline's** (`P6-T15`, `P6-T16`
 *    step 1), made before this function is called; the egress log is too,
 *    and this pass takes `beforeSend` as `synthesize.ts` does.
 */

import {
  ConfigurationError,
  ContentFilterError,
  OutputTruncatedError,
} from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { LlmPool } from "../../core/jobQueue/queue";
import type { Logger } from "../../core/logger";
import { CHARS_PER_TOKEN } from "../../llm/shared/tokenEstimate";
import type {
  BudgetGuard,
  ChatRequest,
  ChatResponse,
  LLMRouter,
  ProviderRoutingHints,
} from "../../llm/types";
import type {
  AudioLanguage,
  SpokenScript,
  SpokenScriptLength,
  SpokenScriptWarning,
} from "../../model/audio";
import type { TrendReport } from "../../model/trend";
import type { Usage } from "../../model/usage";
import {
  renderPrompt,
  resolveMaxTokens,
  type PromptTemplate,
} from "../../prompts";
import { citedKeysOf } from "../trendReport/citations";
import { resolveTargetWords } from "../trendReport/compose";
import { draftForCritique } from "../trendReport/critique";
import { DIGEST_NO_YEAR } from "../trendReport/digest";
import { citationMapFor, type CitationSource } from "./citationMap";
import { countArabicNumerals, countHangulSyllables } from "./korean";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** `docs/12` §13: the English target, `TARGET_MINUTES × 150` words. */
export const SPOKEN_WORDS_PER_MINUTE = 150;

/** `docs/04` §12 item 1: 150 words a minute × the rewrite's ≈2× compression. */
export const REPORT_WORDS_PER_AUDIO_MINUTE = 300;

/** `docs/07` §8.5's `tts.targetMinutes` range once `0` is resolved. */
export const TARGET_MINUTES_MIN = 1;
export const TARGET_MINUTES_MAX = 60;

/** `docs/12` §13–§14: a script within ±30 % of its target raises no warning. */
export const SCRIPT_LENGTH_BAND = 0.3;

/** The first answer and the one retry `docs/04` §8.5 allows. */
export const SCRIPT_ATTEMPTS_MAX = 2;

/**
 * Speech per minute in characters, `docs/04` §9.3: English ~900, Korean ~330.
 * With `docs/06` §5.1's characters per token ({@link CHARS_PER_TOKEN}) it
 * sizes the output ceiling.
 */
export const SPOKEN_CHARS_PER_MINUTE: Readonly<Record<AudioLanguage, number>> =
  Object.freeze({ en: 900, ko: 330 });

/** The prompt each script language uses (`docs/12` §13–§14). */
export const SCRIPT_PROMPT_IDS = Object.freeze({
  en: "AUDIO_SCRIPT_EN",
  ko: "AUDIO_SCRIPT_KO",
} as const satisfies Record<AudioLanguage, string>);

/** The line that opens the retry's correction list (English for both, line 16). */
export const SCRIPT_RETRY_HEADER =
  "CORRECTIONS: your previous script was rejected for the problems below. " +
  "Write the whole spoken script again, as plain text, with none of them:";

// ---------------------------------------------------------------------------
// 2. Validation — `docs/04` §8.5 ∪ `docs/12` §13
// ---------------------------------------------------------------------------

/** One way a script can fail validation. */
export type ScriptLeakId =
  | "empty"
  | "citation-marker"
  | "heading"
  | "bullet"
  | "pipe"
  | "bold"
  | "bracket-citation"
  | "backtick"
  | "url"
  | "doi"
  | "et-al";

/** A leak test and the English correction the retry names it by. */
export interface ScriptLeak {
  readonly id: ScriptLeakId;
  readonly re: RegExp;
  readonly message: string;
}

/**
 * Every leak, in the order the retry lists them. `docs/12` §13's rejects are
 * `[[`, `##`, `|`, `**`, a backtick and `http`; `docs/04` §8.5 adds headings,
 * bullets, `__`, bracket citations, DOIs and `et al.` (reading 3).
 */
export const SCRIPT_LEAKS: readonly ScriptLeak[] = Object.freeze([
  {
    id: "citation-marker",
    re: /\[\[/u,
    message: "a [[itemKey]] citation marker survived",
  },
  {
    id: "heading",
    re: /^#{1,6}\s|##/mu,
    message: 'a Markdown heading or "##" survived',
  },
  { id: "bullet", re: /^\s*[-*+]\s/mu, message: "a bullet list survived" },
  { id: "pipe", re: /\|/u, message: 'a table pipe "|" survived' },
  { id: "bold", re: /\*\*|__/u, message: "bold markers survived" },
  {
    id: "bracket-citation",
    re: /\[\d+([,;]\s*\d+)*\]/u,
    message: "a bracket citation such as [12] survived",
  },
  { id: "backtick", re: /`/u, message: "a backtick or code fence survived" },
  { id: "url", re: /http/u, message: "a URL survived" },
  { id: "doi", re: /\b10\.\d{4,}\//u, message: "a DOI survived" },
  { id: "et-al", re: /\bet al\./u, message: '"et al." survived' },
] satisfies ScriptLeak[]);

/** The `empty` leak, which no pattern tests. */
export const EMPTY_SCRIPT_MESSAGE = "the script was empty";

/**
 * The leaks a script holds, in {@link SCRIPT_LEAKS}' order; empty means it
 * passes. The same markers for both languages (`docs/12` §14).
 *
 * @param text - the model's answer, as returned
 */
export function validateScript(text: string): readonly ScriptLeakId[] {
  if (text.trim() === "") return ["empty"];
  return SCRIPT_LEAKS.filter((leak) => leak.re.test(text)).map((l) => l.id);
}

/** The English correction for each leak id. */
export function leakMessage(id: ScriptLeakId): string {
  if (id === "empty") return EMPTY_SCRIPT_MESSAGE;
  return (SCRIPT_LEAKS.find((leak) => leak.id === id) as ScriptLeak).message;
}

/** The retry's correction list, appended to the user message (reading 4). */
export function correctionNote(leaks: readonly ScriptLeakId[]): string {
  return [
    SCRIPT_RETRY_HEADER,
    ...leaks.map((id) => `- ${leakMessage(id)}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 3. Target length and the output ceiling
// ---------------------------------------------------------------------------

/**
 * `TARGET_MINUTES` for the prompt: the preference when set, else
 * `round(reportTargetWords / 300)` clamped to 1–60 (`docs/04` §12 item 1).
 * Never `0`.
 *
 * @param preference - `tts.targetMinutes`, 0–60 (`0` = automatic)
 * @param reportTargetWords - the report's target length in words
 * @throws RangeError for a preference that is not a whole number 0–60
 */
export function resolveTargetMinutes(
  preference: number,
  reportTargetWords: number,
): number {
  if (
    !Number.isInteger(preference) ||
    preference < 0 ||
    preference > TARGET_MINUTES_MAX
  ) {
    throw new RangeError(
      `[research-helper] tts.targetMinutes is a whole number from 0 to ${String(TARGET_MINUTES_MAX)}, not ${String(preference)}`,
    );
  }
  if (preference > 0) return preference;
  const derived = Math.round(
    Math.max(0, reportTargetWords) / REPORT_WORDS_PER_AUDIO_MINUTE,
  );
  return Math.min(TARGET_MINUTES_MAX, Math.max(TARGET_MINUTES_MIN, derived));
}

/**
 * The report's target length in words, as its run resolved it (reading 2).
 *
 * @param report - the stored report
 * @param storedTargetWords - the `report.targetWords` preference
 */
export function reportTargetWordsOf(
  report: Pick<TrendReport, "scope">,
  storedTargetWords: number,
): number {
  return resolveTargetWords(storedTargetWords, report.scope.analysedCount);
}

/**
 * The script's target in its own unit: words for English, Hangul syllables
 * for Korean (`docs/12` §13–§14).
 */
export function scriptTargetCount(
  language: AudioLanguage,
  targetMinutes: number,
): number {
  return (
    targetMinutes *
    (language === "en"
      ? SPOKEN_WORDS_PER_MINUTE
      : SPOKEN_KO_SYLLABLES_PER_MINUTE)
  );
}

/** `docs/12` §14: `TARGET_MINUTES × ~330` Hangul syllables. */
export const SPOKEN_KO_SYLLABLES_PER_MINUTE = 330;

/**
 * The script call's `max_tokens` (`plan/09` §0.4 line 23): the prompt's own
 * figure is a floor; above it, the target's speech converted to tokens by
 * `docs/04` §9.3's characters a minute and `docs/06` §5.1's characters a
 * token, plus the ±30 % band. `P6-T10`'s estimate uses the same figure.
 *
 * At 10 minutes this gives 3 163 English tokens (above the 2 500 floor) and
 * 3 065 Korean tokens (below the 3 500 floor, which stands).
 *
 * @param prompt - `AUDIO_SCRIPT_EN` or `AUDIO_SCRIPT_KO`
 * @param language - the script's language
 * @param targetMinutes - 1–60
 */
export function scriptOutputCeiling(
  prompt: PromptTemplate,
  language: AudioLanguage,
  targetMinutes: number,
): number {
  const charsPerToken =
    language === "en" ? CHARS_PER_TOKEN.latin : CHARS_PER_TOKEN.hangul;
  const scaled = Math.ceil(
    ((targetMinutes * SPOKEN_CHARS_PER_MINUTE[language]) / charsPerToken) *
      (1 + SCRIPT_LENGTH_BAND),
  );
  return Math.max(resolveMaxTokens(prompt), scaled);
}

/**
 * English words in a script: whitespace-separated runs holding a letter or a
 * digit, so a lone dash is not a word.
 */
export function countSpokenWords(text: string): number {
  return text.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * The script's length against its target, and the band warning when it is
 * outside ±30 % (never a reject, `plan/09` §0.4 line 17).
 */
export function scriptLengthOf(
  text: string,
  language: AudioLanguage,
  targetMinutes: number,
): { length: SpokenScriptLength; warnings: readonly SpokenScriptWarning[] } {
  const target = scriptTargetCount(language, targetMinutes);
  const length: SpokenScriptLength =
    language === "en"
      ? { unit: "words", count: countSpokenWords(text), target }
      : { unit: "hangul-syllables", count: countHangulSyllables(text), target };
  const outside =
    length.count < target * (1 - SCRIPT_LENGTH_BAND) ||
    length.count > target * (1 + SCRIPT_LENGTH_BAND);
  return {
    length,
    warnings: outside ? [{ kind: "length-out-of-band", length }] : [],
  };
}

// ---------------------------------------------------------------------------
// 4. The language and the source report — `plan/09` `P6-T08`
// ---------------------------------------------------------------------------

/** `tts.language` (`docs/07` §8.5). */
export type AudioLanguagePreference = AudioLanguage | "auto";

/**
 * The script's language (`plan/09` §0.4 line 10): the run's choice in the
 * report window when it names one, else `tts.language` when it names one,
 * else the report's own `language`.
 *
 * @param preference - `tts.language`
 * @param report - the stored report the job runs against
 * @param choice - the window's choice for this run (`AudioRunInput.language`)
 */
export function resolveAudioLanguage(
  preference: AudioLanguagePreference,
  report: Pick<TrendReport, "language">,
  choice: AudioLanguagePreference = "auto",
): AudioLanguage {
  if (choice !== "auto") return choice;
  if (preference !== "auto") return preference;
  return report.language;
}

/**
 * Whether `a` and `b` are the two records of one `reportLanguage` `both`
 * run: one library, one collection, one generation instant, two languages.
 * `execute` gives both records the run's one `generatedAtEpochMs`
 * (`trendReportPipeline.ts`); no other link between them is stored
 * (`plan/reports/P6-T08.md`).
 */
export function isSameRun(
  a: Pick<
    TrendReport,
    "libraryID" | "collectionKey" | "generatedAtEpochMs" | "language"
  >,
  b: Pick<
    TrendReport,
    "libraryID" | "collectionKey" | "generatedAtEpochMs" | "language"
  >,
): boolean {
  return (
    a.libraryID === b.libraryID &&
    a.collectionKey === b.collectionKey &&
    a.generatedAtEpochMs === b.generatedAtEpochMs &&
    a.language !== b.language
  );
}

/**
 * The report a script in `language` is written from (`P6-T08` step 2): the
 * job's report when it is in that language; else the run's other report when
 * it is given, is of the same run and is in that language; else the job's
 * report, in one call either way (owner, `plan/00` §6 item 378(a)). A Korean
 * script from an English report is newly written in Korean, not translated.
 *
 * @param report - the stored report the job runs against
 * @param language - the script's language
 * @param companion - the run's other record, when the caller found one
 */
export function chooseScriptSource(
  report: TrendReport,
  language: AudioLanguage,
  companion?: TrendReport,
): TrendReport {
  if (report.language === language) return report;
  if (
    companion !== undefined &&
    companion.language === language &&
    isSameRun(report, companion)
  ) {
    return companion;
  }
  return report;
}

// ---------------------------------------------------------------------------
// 5. The prompt inputs — `plan/09` §0.4 line 15
// ---------------------------------------------------------------------------

/** What {@link buildScriptInputs} returns. */
export interface ScriptInputs {
  /** The seven `docs/12` §13 variables, as sent. */
  readonly variables: Readonly<Record<string, string>>;
  /** The keys `{{REPORT_MARKDOWN}}` cites, in order of first citation. */
  readonly citedItemKeys: readonly string[];
}

/**
 * `{{REPORT_MARKDOWN}}`: §1–§10 under their headings (reading 1).
 *
 * @param report - the report the script is written from
 */
export function reportMarkdownFor(
  report: Pick<TrendReport, "sections">,
): string {
  return draftForCritique(report.sections);
}

/**
 * Every variable but the citation map's text, which the caller reads through
 * the port, from the report the script is written from.
 *
 * @param report - the source report
 * @param targetMinutes - the resolved `TARGET_MINUTES`, 1–60
 * @param citationMap - `{{CITATION_MAP}}`
 * @throws RangeError for a target outside 1–60
 */
export function buildScriptInputs(
  report: Pick<TrendReport, "sections" | "collectionName" | "scope">,
  targetMinutes: number,
  citationMap: string,
): ScriptInputs {
  if (
    !Number.isInteger(targetMinutes) ||
    targetMinutes < TARGET_MINUTES_MIN ||
    targetMinutes > TARGET_MINUTES_MAX
  ) {
    throw new RangeError(
      `[research-helper] TARGET_MINUTES is a whole number from 1 to 60, not ${String(targetMinutes)}`,
    );
  }
  const markdown = reportMarkdownFor(report);
  const year = (y: number | undefined): string =>
    y === undefined ? DIGEST_NO_YEAR : String(y);
  return {
    variables: Object.freeze({
      REPORT_MARKDOWN: markdown,
      CITATION_MAP: citationMap,
      COLLECTION_NAME: report.collectionName,
      TARGET_MINUTES: String(targetMinutes),
      N_ANALYSED: String(report.scope.analysedCount),
      YEAR_MIN: year(report.scope.yearMin),
      YEAR_MAX: year(report.scope.yearMax),
    }),
    citedItemKeys: citedKeysOf(markdown),
  };
}

// ---------------------------------------------------------------------------
// 6. The call
// ---------------------------------------------------------------------------

/** What the script pass is given. */
export interface ScriptInput {
  /** The stored report the job runs against; `SpokenScript.reportId` is its id. */
  readonly report: TrendReport;
  /**
   * The run's other record, when the job's report came from a `both` run
   * and the caller found it; {@link chooseScriptSource} decides whether the
   * script is written from it.
   */
  readonly companion?: TrendReport;
  /** The script's language. */
  readonly language: AudioLanguage;
  /** {@link resolveTargetMinutes}'s result, 1–60. */
  readonly targetMinutes: number;
}

/** What the script pass needs from the job. */
export interface ScriptDeps {
  /** `PipelineContext.llm`: the budgeted router (`withBudget`). */
  readonly llm: Pick<LLMRouter, "resolveModel" | "chat">;
  /** `PipelineContext.budget`; a missing one fails closed (item 278(a)). */
  readonly budget: BudgetGuard | undefined;
  readonly token: CancellationToken;
  /** The plugin's `llm` pool: one permit per request, when given. */
  readonly pool?: Pick<LlmPool, "acquire">;
  /** `AUDIO_SCRIPT_EN` and `AUDIO_SCRIPT_KO`, from the registry. */
  readonly prompts: Readonly<Record<AudioLanguage, PromptTemplate>>;
  /** The Zotero read behind the citation map. */
  readonly citations: CitationSource;
  readonly logger?: Logger;
  readonly progress?: ProgressReporter;
  /** The privacy mode's routing hints, passed through. */
  readonly routing?: ProviderRoutingHints;
  /** The job's egress-log hook, awaited before each request (`P6-T16`). */
  readonly beforeSend?: () => Promise<void>;
  readonly traceId?: string;
}

/**
 * A script that still leaked after the retry: no TTS call follows, and
 * `P6-T14` turns it into FR-43's offer to save the text.
 */
export interface ScriptRejected {
  readonly kind: "script-rejected";
  readonly reportId: string;
  readonly language: AudioLanguage;
  /** The last answer's leaks. */
  readonly leaks: readonly ScriptLeakId[];
  /** The last answer, unvalidated: what FR-43's "save as text" offers. */
  readonly text: string;
  readonly usage: Usage | undefined;
  readonly calls: number;
}

/** What {@link writeScript} returns. */
export type ScriptResult =
  | {
      readonly kind: "written";
      readonly script: SpokenScript;
      readonly calls: number;
      /** The keys the citation map had no line for. */
      readonly unmappedItemKeys: readonly string[];
    }
  | ScriptRejected;

/** A logger that drops everything, when the caller passes none. */
const SILENT_LOGGER: Logger = {
  child: () => SILENT_LOGGER,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  time: (_msg, fn) => fn(),
};

function sumUsage(usages: readonly Usage[]): Usage | undefined {
  if (usages.length === 0) return undefined;
  const field = (name: keyof Usage): number | undefined => {
    let total = 0;
    for (const usage of usages) {
      const value = usage[name];
      if (value === undefined) return undefined;
      total += value;
    }
    return total;
  };
  return {
    inputTokens: field("inputTokens"),
    outputTokens: field("outputTokens"),
    totalTokens: field("totalTokens"),
    costUsd: field("costUsd"),
  };
}

function refuseUnusable(
  response: ChatResponse,
  providerId: string,
  request: ChatRequest,
): void {
  if (response.finishReason === "length") {
    throw new OutputTruncatedError(
      providerId,
      request.model,
      "The spoken script was cut off by the output limit (finishReason length); not retried",
      {
        finishReason: "length",
        maxOutputTokens: request.maxOutputTokens,
        outputLength: response.text.length,
      },
    );
  }
  if (response.finishReason === "content_filter") {
    throw new ContentFilterError(
      providerId,
      request.model,
      "The spoken script was stopped by the provider's content filter; not retried",
      { finishReason: "content_filter" },
    );
  }
}

/**
 * Write one spoken script (module note): the citation map, one call on the
 * `strong` model, validation, at most one retry naming the leaks.
 *
 * @returns the validated script, or {@link ScriptRejected} after the retry
 * @throws ConfigurationError without a budget or for a prompt that does not
 *   match the language; OperationCancelledError, BudgetExceededError and the
 *   router's `LLMError`s unchanged; OutputTruncatedError and
 *   ContentFilterError for an answer that is not a script
 */
export async function writeScript(
  input: ScriptInput,
  deps: ScriptDeps,
): Promise<ScriptResult> {
  if (deps.budget === undefined) {
    throw new ConfigurationError(
      "[research-helper] the audio script call needs a budget guard (plan/00 §6 item 278(a))",
    );
  }
  const prompt = deps.prompts[input.language];
  if (prompt.id !== SCRIPT_PROMPT_IDS[input.language]) {
    throw new ConfigurationError(
      `[research-helper] the ${input.language} audio script needs ${SCRIPT_PROMPT_IDS[input.language]}, not ${prompt.id}`,
    );
  }
  const logger = deps.logger ?? SILENT_LOGGER;
  const source = chooseScriptSource(
    input.report,
    input.language,
    input.companion,
  );
  deps.token.throwIfCancelled();

  const markdown = reportMarkdownFor(source);
  const map = await citationMapFor(
    source.libraryID,
    citedKeysOf(markdown),
    deps.citations,
    logger,
  );
  const inputs = buildScriptInputs(source, input.targetMinutes, map.text);
  const rendered = renderPrompt(prompt, inputs.variables);
  const model = deps.llm.resolveModel("strong");
  const maxOutputTokens = scriptOutputCeiling(
    prompt,
    input.language,
    input.targetMinutes,
  );
  const traceBase = deps.traceId ?? "audio-script";

  const usages: Usage[] = [];
  let leaks: readonly ScriptLeakId[] = [];
  let text = "";
  let calls = 0;
  for (let attempt = 1; attempt <= SCRIPT_ATTEMPTS_MAX; attempt += 1) {
    deps.token.throwIfCancelled();
    const user =
      attempt === 1
        ? rendered.user
        : `${rendered.user}\n\n${correctionNote(leaks)}`;
    const request: ChatRequest = {
      model: model.modelId,
      messages: [
        { role: "system", content: rendered.system },
        { role: "user", content: user },
      ],
      temperature: prompt.defaultTemperature,
      maxOutputTokens,
      ...(deps.routing !== undefined && { routing: deps.routing }),
      traceId: `${traceBase}:${input.language}:script-${String(attempt)}`,
      accounting: { promptId: prompt.id },
    };
    const release =
      deps.pool === undefined ? undefined : await deps.pool.acquire(deps.token);
    let response: ChatResponse;
    try {
      calls += 1;
      response = await deps.llm.chat(request, {
        token: deps.token,
        budget: deps.budget,
        ...(deps.progress !== undefined && { progress: deps.progress }),
        ...(deps.beforeSend !== undefined && { beforeSend: deps.beforeSend }),
      });
    } finally {
      release?.();
    }
    usages.push(response.usage);
    refuseUnusable(response, model.providerId, request);
    text = response.text;
    leaks = validateScript(text);
    if (leaks.length === 0) break;
    logger.info("audio script: the answer leaked written markup", {
      attempt,
      language: input.language,
      leaks: leaks.join(","),
    });
  }

  if (leaks.length > 0) {
    return {
      kind: "script-rejected",
      reportId: input.report.id,
      language: input.language,
      leaks,
      text,
      usage: sumUsage(usages),
      calls,
    };
  }
  const trimmed = text.trim();
  if (input.language === "ko") {
    // Logged, never rejected (docs/04 §9.2; plan/09 §0.4 line 17): the
    // acceptance run reads this figure (P6-T19).
    logger.info("audio script: Arabic numerals left in the Korean script", {
      numerals: countArabicNumerals(trimmed),
      sourceLanguage: source.language,
    });
  }
  const { length, warnings } = scriptLengthOf(
    trimmed,
    input.language,
    input.targetMinutes,
  );
  return {
    kind: "written",
    script: {
      reportId: input.report.id,
      language: input.language,
      sourceLanguage: source.language,
      text: trimmed,
      targetMinutes: input.targetMinutes,
      length,
      warnings,
      usage: sumUsage(usages),
    },
    calls,
    unmappedItemKeys: map.unmapped,
  };
}
