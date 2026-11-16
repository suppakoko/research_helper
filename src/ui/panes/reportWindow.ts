/**
 * The report window's opener and the model it draws (`P4-T19`; FR-53, part of
 * FR-28; `docs/08` §6.4 and its note of 2026-10-29).
 *
 * `docs/07` §2.2 places the report viewer under `src/ui/panes/`, so this file
 * is here although the search window's controller sits in `src/ui/dialogs/`.
 *
 * ## Who calls what
 *
 * - The collection menu's "Generate Research Trends Report…"
 *   (`src/ui/menus/registerMenus.ts`, `SearchMenuCommands.openReportWindow`)
 *   → `src/bootstrap/registerUI.ts`, the constructing file, which builds a
 *   {@link ReportWindowSession} over the service graph and calls
 *   {@link openReportWindow}.
 * - `addon/content/reportWindow.js` (the window) calls the session through
 *   `window.arguments[0]`.
 * - *Since `P6-T17`:* the collection menu's "Generate Audio Report…"
 *   (`SearchMenuCommands.openAudioReportWindow`, behind the hidden
 *   `audio.enabled`) opens this same window; its audio section is
 *   `../viewModels/reportViewModel.ts`'s `buildAudioSectionModel`, driven by
 *   the session's audio members.
 *
 * ## The run (`P4-T20`, 2026-11-02)
 *
 * The window draws `../viewModels/reportViewModel.ts`'s model and calls
 * {@link ReportWindowSession}: start, cancel, the delivery actions. The job is
 * `P4-T18`'s trend-report pipeline, driven on the privileged side by
 * `createReportWindowSession` in `registerUI.ts`, through the job queue;
 * nothing here runs a job, and no window is modal (`P4-T19` Do NOT).
 *
 * Like `../dialogs/summarizeDialog.ts`, this takes the host window as a
 * parameter: `src/ui/**` may not name the `Zotero` global nor import
 * `src/zotero/**` or `src/llm/**`.
 */

import { config } from "../../../package.json";
import type { ReportWindowMessageId } from "../../i18n/keys";
import type { AudioLanguage } from "../../model/audio";
import type {
  ReportLanguageChoice,
  ReportQuestion,
  ReportWindowLineOut,
  ReportWindowRunModel,
} from "../viewModels/reportViewModel";
import {
  AUDIO_SECTION_L10N,
  REPORT_RUN_L10N,
} from "../viewModels/reportViewModel";

// ===========================================================================
// 1. Strings and window constants
// ===========================================================================

/**
 * Every id the window uses, in `research-helper-reportWindow.ftl` — the
 * window's own bundle (`docs/08` §10.1). Typed so an id missing from that
 * bundle's list does not compile.
 */
export const REPORT_WINDOW_L10N = {
  title: "research-helper-report-title",
  collection: "research-helper-report-collection",
  languageLabel: "research-helper-report-language-label",
  languageAuto: "research-helper-report-language-auto",
  languageEn: "research-helper-report-language-en",
  languageKo: "research-helper-report-language-ko",
  languageBoth: "research-helper-report-language-both",
  model: "research-helper-report-model",
  modelNone: "research-helper-report-model-none",
  close: "research-helper-report-close",
  // `P4-T21`: "Report shown" (`docs/08` §6.3's note of 2026-11-02); its two
  // items are `languageEn` and `languageKo`.
  shownLabel: "research-helper-report-shown-label",
  // `P4-T20`: the run's ids (`reportViewModel.ts`).
  ...REPORT_RUN_L10N,
} as const satisfies Record<string, ReportWindowMessageId>;

/**
 * The audio section's ids (`P6-T17`; `docs/08` §6.4's note of 2026-11-17),
 * kept apart from {@link REPORT_WINDOW_L10N} because two of its keys (`cancel`,
 * `generate`) would collide with the run's.
 */
export const REPORT_WINDOW_AUDIO_L10N = AUDIO_SECTION_L10N;

/** The document the window loads (`addon/content/reportWindow.xhtml`). */
export const REPORT_WINDOW_URL = `chrome://${config.addonRef}/content/reportWindow.xhtml`;

/**
 * One window per collection: its name carries the collection id, so a second
 * menu click on the same collection raises the open window instead of a
 * second one (`docs/08` §4.1's named-window rule).
 */
export const REPORT_WINDOW_NAME_PREFIX = "research-helper-report-";

/** Modeless (`dialog=no`): a report run takes minutes and must not hold Zotero. */
export const REPORT_WINDOW_FEATURES =
  "chrome,titlebar,centerscreen,resizable,dialog=no";

/** The `<dialog>` element `Zotero.UIProperties.registerRoot` is given. */
export const REPORT_WINDOW_ROOT_ID = "rh-report-dialog";

/**
 * `reportLanguage`'s values (`docs/07` §8.5; `src/prefs/schema.ts`), in the
 * order the selector lists them.
 */
export const REPORT_LANGUAGES = ["auto", "en", "ko", "both"] as const;

export type ReportLanguage = (typeof REPORT_LANGUAGES)[number];

/**
 * Each language value's label id: the `<menuitem>`s of
 * `addon/content/reportWindow.xhtml`, which carry the same pairs.
 */
export const REPORT_LANGUAGE_L10N: Readonly<
  Record<ReportLanguage, ReportWindowMessageId>
> = {
  auto: REPORT_WINDOW_L10N.languageAuto,
  en: REPORT_WINDOW_L10N.languageEn,
  ko: REPORT_WINDOW_L10N.languageKo,
  both: REPORT_WINDOW_L10N.languageBoth,
};

/**
 * `value` as a {@link ReportLanguage}, or `"auto"` — the preference's default
 * — for anything else, so a hand-edited preference never leaves the selector
 * on no item.
 */
export function reportLanguageOf(value: unknown): ReportLanguage {
  return (REPORT_LANGUAGES as readonly unknown[]).includes(value)
    ? (value as ReportLanguage)
    : "auto";
}

// ===========================================================================
// 2. The model the window draws
// ===========================================================================

/** One Fluent line of the report window's own bundle. */
export interface ReportWindowLine {
  readonly id: ReportWindowMessageId;
  readonly args?: Readonly<Record<string, string | number>>;
}

/** What the privileged side reads for the window, before any run. */
export interface ReportWindowDescription {
  /** The collection's name and regular items; `undefined` when it is gone. */
  readonly collection:
    { readonly name: string; readonly regularItems: number } | undefined;
  /** `reportLanguage`, as stored. */
  readonly language: unknown;
  /**
   * The `strong` chain's answer (`reportModel`, then `<provider>.model`) with
   * the provider's display name; `undefined` when every setting in the chain
   * is empty.
   */
  readonly model:
    { readonly modelId: string; readonly providerName: string } | undefined;
}

/** What the window shows, as Fluent lines; the script formats nothing. */
export interface ReportWindowModel {
  /** The collection line, or `undefined` when the collection is gone. */
  readonly collection: ReportWindowLine | undefined;
  /** The language the selector starts on. */
  readonly language: ReportLanguage;
  /** The model line: the resolved model, or that none is set. */
  readonly model: ReportWindowLine;
}

/**
 * Turn the description into the window's lines.
 *
 * @param description - what the privileged side read
 */
export function buildReportWindowModel(
  description: ReportWindowDescription,
): ReportWindowModel {
  const { collection, model } = description;
  return {
    collection:
      collection === undefined
        ? undefined
        : {
            id: REPORT_WINDOW_L10N.collection,
            args: { name: collection.name, count: collection.regularItems },
          },
    language: reportLanguageOf(description.language),
    model:
      model === undefined
        ? { id: REPORT_WINDOW_L10N.modelNone }
        : {
            id: REPORT_WINDOW_L10N.model,
            args: { model: model.modelId, provider: model.providerName },
          },
  };
}

// ===========================================================================
// 3. The window and its session
// ===========================================================================

/** The window side, which the session calls. */
export interface ReportWindowSink {
  /** Draw this model. Must not throw. */
  render(model: ReportWindowRunModel): void;
  /** Ask in place: the first button answers "resume", the second "cancel". */
  ask(
    question: ReportQuestion<ReportWindowLineOut>,
  ): Promise<"resume" | "cancel">;
  /**
   * The folder dialog for a linked audio file (`P6-T13` step 4; `P6-T17`):
   * the chosen folder, or `""` when the user cancels. The path is handed on
   * once and never kept or logged. Absent, no folder can be chosen.
   */
  pickFolder?(): Promise<string>;
}

/** What "Generate audio" sends: the section's two choices. */
export interface AudioStartOptions {
  readonly language: AudioLanguage;
  readonly voice: string;
}

/**
 * The privileged side, which the window calls (`window.arguments[0].session`).
 * Built by `createReportWindowSession` in `src/bootstrap/registerUI.ts`.
 */
export interface ReportWindowSession {
  /** What the window draws on open. */
  describe(): Promise<ReportWindowModel>;
  /**
   * The window is ready. A run of this collection resumed after a restart
   * attaches here, and a job left paused asks its question here (owner,
   * `plan/00` §6 item 324(a)).
   */
  attach(sink: ReportWindowSink): Promise<void>;
  /** Run once, in the language chosen; resolves when the run has ended. */
  start(
    options: { readonly language: ReportLanguageChoice },
    sink: ReportWindowSink,
  ): Promise<void>;
  /** Cancel the run: the report is discarded, every summary made is kept. */
  cancel(): void;
  /**
   * Which report of a two-report run the preview and the delivery buttons act
   * on (`docs/08` §6.3's note of 2026-11-02). Called by the window's "Report
   * shown" selector; built by `createReportWindowSession`.
   */
  showReport(language: "en" | "ko"): void;
  /** "Save as note": the named-group question first, in a group library. */
  saveNote(): Promise<void>;
  /** The save dialog's suggested name, once a report is stored. */
  exportFileName(): string | undefined;
  /** "Export Markdown", to a path the user chose; never kept or logged. */
  exportMarkdown(path: string): Promise<void>;
  /** The text "Copy" puts on the clipboard, once a report is stored. */
  copyText(): string | undefined;
  /** The window put {@link copyText}'s text on the clipboard. */
  copied(): void;
  /**
   * The window is closing: a run it started is cancelled; a resumed run or a
   * paused job goes on waiting for the next window.
   */
  closed(): void;

  // --- The audio section (`P6-T17`; `docs/08` §6.4's note of 2026-11-17).
  // Every member is optional for the window, which checks before calling.

  /**
   * Read what the section needs: `audio.enabled`, the report it works on (the
   * window's run's, else `ReportStore.latestForCollection`) and the voices;
   * then draw. Called by the window once the session is attached.
   */
  audioDescribe(): Promise<void>;
  /** The audio language changed: the source line follows; never written back. */
  setAudioLanguage(language: AudioLanguage): void;
  /** The voice changed: written back to `tts.voice` at once. */
  setAudioVoice(voice: string): void;
  /** "Generate audio": the `audioReport` job; resolves when it has ended. */
  startAudio(options: AudioStartOptions, sink: ReportWindowSink): Promise<void>;
  /** "Cancel audio": the audio is discarded, a written script is kept. */
  cancelAudio(): void;
  /** The save dialog's suggested name for the script, once one is offered. */
  scriptFileName(): string | undefined;
  /** FR-43: write the script to a path the user chose; never kept or logged. */
  saveScript(path: string): Promise<void>;
  /** The save dialog's suggested name for the audio, once it is offered. */
  audioFileName(): string | undefined;
  /** FR-40: write the held audio to a path the user chose; never kept or logged. */
  saveAudio(path: string): Promise<void>;
}

/** What the window receives as `window.arguments[0]`. */
export interface ReportWindowArgs {
  readonly session: ReportWindowSession;
  /** The ids the script needs for its own chrome (title, Close). */
  readonly l10n: typeof REPORT_WINDOW_L10N;
}
/** The window `openDialog` returns: focused here, closed by the host. */
export interface ReportWindowHandle {
  focus(): void;
  close?(): void;
  readonly closed?: boolean;
}

/** The host window's one member this module calls. */
export interface ReportWindowHost {
  openDialog(
    url?: string,
    name?: string,
    features?: string,
    ...extraArguments: unknown[]
  ): ReportWindowHandle | null;
}

/**
 * Open the report window over `host`, or raise the one already open for this
 * collection.
 *
 * @param host - the main window the menu was clicked in
 * @param collectionID - names the window, so a second open raises the first
 * @param session - the privileged side
 * @returns the window, so the host can close it at shutdown
 * @throws when the window cannot be opened
 */
export function openReportWindow(
  host: ReportWindowHost,
  collectionID: number,
  session: ReportWindowSession,
): ReportWindowHandle {
  const args: ReportWindowArgs = { session, l10n: REPORT_WINDOW_L10N };
  const win = host.openDialog(
    REPORT_WINDOW_URL,
    `${REPORT_WINDOW_NAME_PREFIX}${String(collectionID)}`,
    REPORT_WINDOW_FEATURES,
    args,
  );
  if (!win) {
    throw new Error(
      `[research-helper] openDialog("${REPORT_WINDOW_URL}") returned no window.`,
    );
  }
  win.focus();
  return win;
}
